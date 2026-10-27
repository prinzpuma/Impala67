//! KI für die PWA (`impala-ai`): Anfragen, Wiederholungen, Stream-Parser, Prompt-Bau und die
//! Agent-Schleife in Rust. JS reicht Netz (`http.send`/`http.open`), Werkzeuge und Rückfragen
//! (`executor`) herein und zeigt die Ereignisse an (web/ai.js).

use std::rc::Rc;

use impala_ai::prompt::PageContext;
use impala_ai::{
    AgentEvent, AgentItem, AgentRequest, AgentSession, AiError, AiSettings, AnkiCard, AnkiView, CancelToken,
    ChatConfig, ChatEntry, ChatSummary, CloudflareAuth, HeftPage, HeftPageContent, HttpProvider, LocalTime, Message,
    Provider, RagHit, RequestOptions, Role, SleepFuture, Sources, StreamUpdate, ThinkingCapabilities, ToolDef,
    ToolExecutor, ToolOutput, Workspace,
};
use js_sys::{Function, Object, Promise};
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::{JsFuture, future_to_promise};

use crate::js::{JsHttp, call, from_js, set, to_js};

fn value(v: &JsValue) -> Value {
    from_js(v).unwrap_or(Value::Null)
}

fn text(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or("").to_owned()
}

fn providers_of(v: &Value) -> Vec<Provider> {
    serde_json::from_value(v.clone()).unwrap_or_default()
}

/// `{ providers, activeProviderId, model, thinkingEnabled }`
fn settings_of(v: &Value) -> AiSettings {
    AiSettings {
        providers: providers_of(&v["providers"]),
        active_provider_id: text(v, "activeProviderId"),
        model: text(v, "model"),
        thinking_enabled: v["thinkingEnabled"].as_bool().unwrap_or(true),
    }
}

/// `{ cloudflare: { userId, authToken, fallbackBase } | null, safetyId }`
fn options_of(v: &Value) -> RequestOptions {
    let cf = &v["cloudflare"];
    RequestOptions {
        cloudflare: cf.is_object().then(|| CloudflareAuth {
            user_id: text(cf, "userId"),
            auth_token: text(cf, "authToken"),
            fallback_base: text(cf, "fallbackBase"),
        }),
        safety_id: v["safetyId"].as_str().filter(|s| !s.is_empty()).map(str::to_owned),
    }
}

/// Warten über `setTimeout` (Wiederholungen bei Überlast).
fn js_sleep(ms: u64) -> SleepFuture {
    Box::pin(async move {
        let promise = Promise::new(&mut |resolve, _| {
            let set_timeout = js_sys::Reflect::get(&js_sys::global(), &"setTimeout".into())
                .ok()
                .and_then(|f| f.dyn_into::<Function>().ok());
            if let Some(f) = set_timeout {
                let _ = f.call2(&JsValue::NULL, &resolve, &(ms as f64).into());
            } else {
                let _ = resolve.call0(&JsValue::NULL);
            }
        });
        let _ = JsFuture::from(promise).await;
    })
}

fn provider_for(http: &JsValue, input: &Value) -> HttpProvider<JsHttp> {
    let config = ChatConfig::resolve(&settings_of(&input["settings"]));
    HttpProvider::new(JsHttp(http.clone()), config, options_of(&input["options"]))
        .with_sleep(Box::new(js_sleep))
        .with_clock(Box::new(|| js_sys::Date::now() as u64))
}

/// Fehler als JS-`Error`: `name` AbortError/AiTimeoutError, `status` und `retryAfterMs` bei HTTP.
fn ai_error(e: AiError) -> JsValue {
    let err = js_sys::Error::new(&e.to_string());
    match &e {
        AiError::Aborted => err.set_name("AbortError"),
        AiError::Timeout { .. } => err.set_name("AiTimeoutError"),
        _ => {}
    }
    let obj: &Object = err.unchecked_ref();
    if let Some(status) = e.status() {
        set(obj, "status", status);
    }
    if e.retry_after_ms() > 0 {
        set(obj, "retryAfterMs", e.retry_after_ms() as f64);
    }
    err.into()
}

fn local_time(v: &Value) -> LocalTime {
    let n = |k: &str| v[k].as_f64().unwrap_or(0.0);
    LocalTime {
        year: n("year") as i32,
        month: n("month") as u8,
        day: n("day") as u8,
        weekday: n("weekday") as u8,
        hour: n("hour") as u8,
        minute: n("minute") as u8,
    }
}

/// `{ kind: "empty" | "anki" | "page", … }` (siehe web/ai.js `workspaceOf`).
fn workspace_of(v: &Value) -> Workspace {
    let strings = |v: &Value| -> Vec<String> {
        v.as_array().map(|a| a.iter().filter_map(|t| t.as_str().map(str::to_owned)).collect()).unwrap_or_default()
    };
    match v["kind"].as_str() {
        Some("anki") => {
            let a = &v["anki"];
            let n = |k: &str| a[k].as_f64().unwrap_or(0.0).max(0.0) as u32;
            Workspace::Anki(AnkiView {
                tab: text(a, "tab"),
                deck: text(a, "deck"),
                new: n("new"),
                learn: n("learn"),
                review: n("review"),
                card: a["card"].is_object().then(|| AnkiCard {
                    front: text(&a["card"], "front"),
                    back: a["card"]["back"].as_str().map(str::to_owned),
                }),
            })
        }
        Some("page") => {
            let c = &v["context"];
            let context = match c["kind"].as_str() {
                Some("text") => Some(PageContext::Text { content: text(c, "content") }),
                Some("heft") => Some(PageContext::Heft {
                    title: text(c, "title"),
                    page_index: c["pageIndex"].as_f64().unwrap_or(0.0).max(0.0) as u32,
                    texts: strings(&c["texts"]),
                    ocr_text: text(c, "ocrText"),
                    image_url: c["imageUrl"].as_str().map(str::to_owned),
                }),
                _ => None,
            };
            Workspace::Page { title: text(v, "title"), context }
        }
        _ => Workspace::Empty,
    }
}

fn rag_hits_of(v: &Value) -> Vec<RagHit> {
    v.as_array()
        .map(|a| {
            a.iter()
                .map(|h| RagHit {
                    page_id: text(h, "pageId"),
                    title: text(h, "title"),
                    score: h["score"].as_f64(),
                    snippet: text(h, "snippet"),
                    archived: h["archived"].as_bool().unwrap_or(false),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn tool_defs_of(v: &Value) -> Vec<ToolDef> {
    v.as_array().map(|a| a.iter().filter_map(ToolDef::from_json).collect()).unwrap_or_default()
}

fn item_json(item: &AgentItem) -> Value {
    match item {
        AgentItem::Thought(r) => json!({ "kind": "thought", "reasoning": r }),
        AgentItem::Assistant { content, model } => json!({ "kind": "assistant", "content": content, "model": model }),
        AgentItem::Tool { name, detail, error } => {
            json!({ "kind": "tool", "name": name, "detail": detail, "error": error })
        }
        AgentItem::Change { summary, undo } => json!({ "kind": "change", "summary": summary, "undo": undo }),
    }
}

/// Werkzeuge und Rückfragen der App: `executor.run(name, args)` → `{ json, undo }`,
/// `executor.ask(question, options)` → Antwort oder `null`, `executor.heftPage(title, page)` →
/// `{ pageNo, texts, ocrText, imageUrl }` bzw. `{ pageNo, error }`.
struct JsExecutor(JsValue);

impl ToolExecutor for JsExecutor {
    async fn run(&mut self, name: &str, args: &Value) -> Result<ToolOutput, String> {
        let out = call(&self.0, "run", &[name.into(), to_js(args)]).await?;
        let json = js_sys::Reflect::get(&out, &"json".into()).ok().and_then(|v| v.as_string()).unwrap_or_default();
        let undo = js_sys::Reflect::get(&out, &"undo".into()).ok().filter(|v| !v.is_undefined() && !v.is_null());
        Ok(ToolOutput { json, undo: undo.map(|u| value(&u)) })
    }

    async fn ask(&mut self, question: &str, options: &[String]) -> Option<String> {
        let opts: js_sys::Array = options.iter().map(|o| JsValue::from_str(o)).collect();
        call(&self.0, "ask", &[question.into(), opts.into()]).await.ok()?.as_string()
    }

    async fn heft_page(&mut self, title: Option<&str>, page: Option<f64>) -> HeftPage {
        let args = [title.map_or(JsValue::UNDEFINED, JsValue::from), page.map_or(JsValue::UNDEFINED, JsValue::from)];
        let v = match call(&self.0, "heftPage", &args).await {
            Ok(v) => value(&v),
            Err(e) => json!({ "error": e }),
        };
        let page_no = v["pageNo"].as_f64().unwrap_or(0.0).max(0.0) as u32;
        let result = match v["error"].as_str() {
            Some(e) => Err(e.to_owned()),
            None => Ok(HeftPageContent {
                texts: v["texts"]
                    .as_array()
                    .map(|a| a.iter().filter_map(|t| t.as_str().map(str::to_owned)).collect())
                    .unwrap_or_default(),
                ocr_text: text(&v, "ocrText"),
                image_url: text(&v, "imageUrl"),
            }),
        };
        HeftPage { page_no, result }
    }
}

/// Ein KI-Lauf (Agent, einfache Antwort oder Umformulieren) mit Abbruch (⏹).
#[wasm_bindgen]
pub struct AiRun {
    http: JsValue,
    cancel: CancelToken,
}

#[wasm_bindgen]
impl AiRun {
    /// `http`: `send(req)` → `{ status, headers, body }`, `open(req)` → `{ status, headers, read(), cancel() }`.
    #[wasm_bindgen(constructor)]
    pub fn new(http: JsValue) -> AiRun {
        AiRun { http, cancel: CancelToken::default() }
    }

    pub fn cancel(&self) {
        self.cancel.cancel();
    }

    /// Agent-Lauf. `input`: `{ settings, options, chat, workspace, ragHits, activePage, tools,
    /// alwaysSendTools, customInstructions, embedModel, now, session }`; `on_event(ev)` mit
    /// `{ type: "draft"|"thinking", text }`, `{ type: "tool", name }` oder `{ type: "item", item }`.
    /// Ergebnis: `{ text, pageContext, session }`.
    pub fn agent(&self, input: JsValue, executor: JsValue, on_event: Function) -> Promise {
        let input = value(&input);
        let provider = provider_for(&self.http, &input);
        let cancel = self.cancel.clone();
        future_to_promise(async move {
            let chat: Vec<ChatEntry> = serde_json::from_value(input["chat"].clone()).unwrap_or_default();
            let workspace = workspace_of(&input["workspace"]);
            let rag_hits = rag_hits_of(&input["ragHits"]);
            let active = &input["activePage"];
            let (active_id, active_title) = (text(active, "id"), text(active, "title"));
            let tools = tool_defs_of(&input["tools"]);
            let s = &input["session"];
            let mut session = AgentSession {
                summary: s["summary"].is_object().then(|| ChatSummary {
                    count: s["summary"]["count"].as_f64().unwrap_or(0.0) as usize,
                    text: text(&s["summary"], "text"),
                }),
                tools_unlocked: s["toolsUnlocked"].as_bool().unwrap_or(false),
            };
            let req = AgentRequest {
                chat: &chat,
                workspace: &workspace,
                rag_hits: &rag_hits,
                active_page: active.is_object().then_some((active_id.as_str(), active_title.as_str())),
                tools: &tools,
                always_send_tools: input["alwaysSendTools"].as_bool().unwrap_or(true),
                custom_instructions: input["customInstructions"].as_str().unwrap_or(""),
                embed_model: input["embedModel"].as_str().unwrap_or(""),
                now: local_time(&input["now"]),
            };
            let emit = |ev: Value| {
                let _ = on_event.call1(&JsValue::NULL, &to_js(&ev));
            };
            let mut on = |ev: AgentEvent<'_>| match ev {
                AgentEvent::Draft(t) => emit(json!({ "type": "draft", "text": t })),
                AgentEvent::Thinking(t) => emit(json!({ "type": "thinking", "text": t })),
                AgentEvent::ToolStarted(n) => emit(json!({ "type": "tool", "name": n })),
                AgentEvent::Item(item) => emit(json!({ "type": "item", "item": item_json(&item) })),
            };
            let mut executor = JsExecutor(executor);
            let out = impala_ai::run_agent(&provider, &mut executor, &req, &mut session, &cancel, &mut on)
                .await
                .map_err(ai_error)?;
            Ok(to_js(&json!({
                "text": out.text,
                "pageContext": out.page_context.map(|p| json!({ "sent": p.sent, "total": p.total })),
                "session": {
                    "summary": session.summary.map(|s| json!({ "count": s.count, "text": s.text })),
                    "toolsUnlocked": session.tools_unlocked,
                },
            })))
        })
    }

    /// Einfache Antwort ohne Werkzeuge (`input`: `{ settings, options }`).
    pub fn complete(&self, input: JsValue, prompt: String, system: Option<String>) -> Promise {
        let provider = provider_for(&self.http, &value(&input));
        future_to_promise(async move {
            let text = impala_ai::chat::complete(&provider, &prompt, system.as_deref()).await.map_err(ai_error)?;
            Ok(text.into())
        })
    }

    /// Antwort umformulieren: `history` (Nachrichten im API-Format), gestreamt an
    /// `on_update({ type: "content"|"reasoning", text })`.
    pub fn refine(&self, input: JsValue, history: JsValue, instruction: String, on_update: Function) -> Promise {
        let input = value(&input);
        let provider = provider_for(&self.http, &input);
        let cancel = self.cancel.clone();
        future_to_promise(async move {
            // `[{ role, content }]` als Text (der Verlauf der Nachricht, die umformuliert wird).
            let history: Vec<Message> = value(&history)
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|m| {
                            let role = match m["role"].as_str()? {
                                "user" => Role::User,
                                "assistant" => Role::Assistant,
                                "system" => Role::System,
                                _ => return None,
                            };
                            Some(Message::text(role, text(m, "content")))
                        })
                        .collect()
                })
                .unwrap_or_default();
            let mut on = |u: StreamUpdate<'_>| {
                let ev = match u {
                    StreamUpdate::Content(t) => json!({ "type": "content", "text": t }),
                    StreamUpdate::Reasoning(t) => json!({ "type": "reasoning", "text": t }),
                };
                let _ = on_update.call1(&JsValue::NULL, &to_js(&ev));
                !cancel.is_cancelled()
            };
            let text = impala_ai::refine(
                &provider,
                &history,
                &instruction,
                input["customInstructions"].as_str().unwrap_or(""),
                local_time(&input["now"]),
                &mut on,
            )
            .await
            .map_err(ai_error)?;
            Ok(text.into())
        })
    }
}

/// Wann die automatische Notizsuche läuft: Suchtext oder `undefined`.
#[wasm_bindgen(js_name = aiRagQuery)]
pub fn ai_rag_query(text: &str) -> Option<String> {
    impala_ai::rag_query(text).map(str::to_owned)
}

/// Eingebaute Werkzeug-Definitionen (`[{ type: "function", function }]`).
#[wasm_bindgen(js_name = aiToolDefs)]
pub fn ai_tool_defs() -> JsValue {
    let defs: Vec<Value> = impala_ai::builtin_tools().iter().map(|d| d.to_json(impala_ai::Family::Other)).collect();
    to_js(&Value::Array(defs))
}

/// Dokumentierte Thinking-Stufen für Quelle und Modell (`settings` wie bei [`AiRun::agent`]).
#[wasm_bindgen(js_name = aiThinkingCapabilities)]
pub fn ai_thinking_capabilities(settings: JsValue) -> JsValue {
    let config = ChatConfig::resolve(&settings_of(&value(&settings)));
    let c = ThinkingCapabilities::declared(&config);
    to_js(&json!({
        "levels": c.levels, "includeThoughts": c.include_thoughts, "offEffort": c.off_effort,
        "offLabel": c.off_label, "source": c.source,
    }))
}

/// Aktive Quelle samt Modell und Familie (Anzeige, Profiler): `{ providerId, base, model, family }`.
#[wasm_bindgen(js_name = aiChatConfig)]
pub fn ai_chat_config(settings: JsValue) -> JsValue {
    let c = ChatConfig::resolve(&settings_of(&value(&settings)));
    to_js(&json!({ "providerId": c.provider_id, "base": c.base, "model": c.model, "family": c.family() }))
}

/// Modelle aller Quellen: `[{ id, providerId }]`.
#[wasm_bindgen(js_name = aiListModels)]
pub fn ai_list_models(http: JsValue, providers: JsValue, sync_url: String) -> Promise {
    let providers = providers_of(&value(&providers));
    future_to_promise(async move {
        let http = JsHttp(http);
        let found = impala_ai::list_models(&http, Sources { providers: &providers, sync_url: &sync_url })
            .await
            .map_err(ai_error)?;
        let found: Vec<Value> = found.iter().map(|m| json!({ "id": m.id, "providerId": m.provider_id })).collect();
        Ok(to_js(&Value::Array(found)))
    })
}

/// Verbindungstest einer Quelle: `{ ok, models, status, suggestedBase, error }`.
#[wasm_bindgen(js_name = aiPingProvider)]
pub fn ai_ping_provider(http: JsValue, provider: JsValue, providers: JsValue, sync_url: String) -> Promise {
    let provider: Provider = serde_json::from_value(value(&provider)).unwrap_or_default();
    let providers = Rc::new(providers_of(&value(&providers)));
    future_to_promise(async move {
        let http = JsHttp(http);
        let r =
            impala_ai::ping_provider(&http, &provider, Sources { providers: &providers, sync_url: &sync_url }).await;
        Ok(to_js(&json!({
            "ok": r.ok, "models": r.models, "status": r.status, "suggestedBase": r.suggested_base, "error": r.error,
        })))
    })
}

/// Vektoren über `POST /embeddings` einer Cloud-Quelle (`provider`: `{ id, base, key }`).
#[wasm_bindgen(js_name = aiEmbedRemote)]
pub fn ai_embed_remote(http: JsValue, provider: JsValue, model: String, texts: Vec<String>) -> Promise {
    let provider: Provider = serde_json::from_value(value(&provider)).unwrap_or_default();
    future_to_promise(async move {
        let http = JsHttp(http);
        let vectors = impala_ai::embed_remote(&http, &provider, &model, &texts).await.map_err(ai_error)?;
        let out: js_sys::Array =
            vectors.iter().map(|v| JsValue::from(js_sys::Float32Array::from(v.as_slice()))).collect();
        Ok(out.into())
    })
}

/// Modell-Vorschläge der Einstellungen: `[{ value, label, provider }]`.
#[wasm_bindgen(js_name = aiModelPresets)]
pub fn ai_model_presets() -> JsValue {
    let presets: Vec<Value> = impala_ai::MODEL_PRESETS
        .iter()
        .map(|p| json!({ "value": p.value, "label": p.label, "provider": p.provider }))
        .collect();
    to_js(&Value::Array(presets))
}

/// Argumente von `ask_choice` säubern: `{ question, options }` oder `{ error }`.
#[wasm_bindgen(js_name = aiNormalizeAskChoice)]
pub fn ai_normalize_ask_choice(args: JsValue) -> JsValue {
    match impala_ai::tools::normalize_ask_choice(&value(&args)) {
        Ok(c) => to_js(&json!({ "question": c.question, "options": c.options })),
        Err(e) => to_js(&json!({ "error": e })),
    }
}
