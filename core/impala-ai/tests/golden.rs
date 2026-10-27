//! Vergleich mit dem letzten JS-Stand (eingefrorene Golden-Files; die PWA fragt seit dem Umbau nur noch über Rust an).
//! Netz: eine Attrappe spielt die aufgezeichneten Antworten in denselben Byte-Stücken ab.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use impala_ai::prompt::{ToolMode, system_prompt};
use impala_ai::think::split_think;
use impala_ai::*;
use impala_net::{HttpClient, Method, NetError, Request, Response, block_on};
use serde_json::{Value, json};

fn golden(name: &str) -> Value {
    let path = format!("{}/tests/golden/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).expect("Golden-File fehlt")).expect("gültiges JSON")
}

fn s(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_owned()
}

// ── Attrappe ────────────────────────────────────────────────────────────

#[derive(Clone, Default)]
struct Fake {
    queue: Arc<Mutex<VecDeque<Value>>>,
    seen: Arc<Mutex<Vec<Request>>>,
}

impl Fake {
    fn new(responses: &Value) -> Self {
        let f = Fake::default();
        f.queue.lock().unwrap().extend(responses.as_array().cloned().unwrap_or_default());
        f
    }

    fn next(&self, req: &Request) -> Result<(Response, Vec<usize>), NetError> {
        self.seen.lock().unwrap().push(req.clone());
        let Some(r) = self.queue.lock().unwrap().pop_front() else {
            return Err(NetError::Connect("fetch failed".into()));
        };
        if let Some(t) = r.get("throw") {
            return Err(NetError::Connect(s(t)));
        }
        let headers =
            r["headers"].as_object().map(|h| h.iter().map(|(k, v)| (k.clone(), s(v))).collect()).unwrap_or_default();
        let body = s(&r["body"]).into_bytes();
        let chunks = r["chunks"]
            .as_array()
            .map(|c| c.iter().map(|n| n.as_u64().unwrap() as usize).collect())
            .unwrap_or_default();
        Ok((Response { status: r["status"].as_u64().unwrap() as u16, headers, body }, chunks))
    }
}

impl HttpClient for Fake {
    async fn send(&self, req: &Request) -> Result<Response, NetError> {
        self.next(req).map(|r| r.0)
    }

    async fn send_streaming(
        &self,
        req: &Request,
        on_chunk: &mut dyn FnMut(&[u8]) -> bool,
    ) -> Result<Response, NetError> {
        let (mut res, chunks) = self.next(req)?;
        let body = std::mem::take(&mut res.body);
        let sizes = if chunks.is_empty() { vec![body.len()] } else { chunks };
        let mut at = 0;
        for n in sizes {
            if !on_chunk(&body[at..at + n]) {
                return Err(NetError::Aborted);
            }
            at += n;
        }
        Ok(res)
    }
}

/// Werkzeug-IDs ohne Vorgabe sind in JS zufällig – für den Vergleich vereinheitlichen.
fn norm_ids(v: &Value) -> Value {
    let re = regex::Regex::new(r"call_([0-9]+)_[0-9a-z]{8}").unwrap();
    serde_json::from_str(&re.replace_all(&v.to_string(), "call_${1}_ID")).unwrap()
}

fn check_requests(name: &str, js: &Value, rust: &[Request]) {
    let js = js.as_array().unwrap();
    assert_eq!(js.len(), rust.len(), "{name}: Anzahl Anfragen");
    for (i, (j, r)) in js.iter().zip(rust).enumerate() {
        assert_eq!(s(&j["url"]), r.url, "{name}#{i}: URL");
        assert_eq!(s(&j["method"]), r.method.as_str(), "{name}#{i}: Methode");
        let mut jh: Vec<(String, String)> =
            j["headers"].as_object().unwrap().iter().map(|(k, v)| (k.clone(), s(v))).collect();
        let mut rh = r.headers.clone();
        jh.sort();
        rh.sort();
        assert_eq!(jh, rh, "{name}#{i}: Kopfzeilen");
        let body: Value = if r.body.is_empty() { Value::Null } else { serde_json::from_slice(&r.body).unwrap() };
        let (a, b) = (js_exception(&format!("{name}#{i}"), norm_ids(&j["body"])), norm_ids(&body));
        if a != b {
            panic!("{name}#{i}: Körper\nJS:   {a}\nRust: {b}");
        }
        assert_eq!(r.method == Method::Get, r.body.is_empty());
    }
}

/// Bewusste Abweichung (message.rs, prune_run_history): Das per view_heft_page angeforderte
/// Bild bleibt im nächsten Schritt erhalten; JS ersetzte es sofort durch den Platzhalter.
fn js_exception(label: &str, mut body: Value) -> Value {
    if label == "heft-bild/0#1" {
        let image = json!({ "type": "image_url", "image_url": { "url": s(&env()["image"]) } });
        for m in body["messages"].as_array_mut().unwrap() {
            let fresh = m["content"][0]["text"].as_str().is_some_and(|t| t.starts_with("[Automatisch angehängt"));
            if fresh {
                m["content"][1] = image.clone();
            }
        }
    }
    body
}

fn env() -> Value {
    golden("env.json")
}

fn now() -> LocalTime {
    LocalTime { year: 2026, month: 10, day: 27, weekday: 2, hour: 14, minute: 5 }
}

fn settings(v: &Value) -> AiSettings {
    AiSettings {
        providers: serde_json::from_value(v["providers"].clone()).unwrap(),
        active_provider_id: s(&v["activeProviderId"]),
        model: s(&v["model"]),
        thinking_enabled: v["thinkingEnabled"].as_bool().unwrap(),
    }
}

fn provider(v: &Value, fake: &Fake, sleeps: Arc<Mutex<Vec<u64>>>) -> HttpProvider<Fake> {
    let e = env();
    let options = RequestOptions {
        cloudflare: Some(CloudflareAuth {
            user_id: s(&e["userId"]),
            auth_token: s(&e["authToken"]),
            fallback_base: s(&e["syncUrl"]),
        }),
        safety_id: Some(s(&e["safetyId"])),
    };
    let fixed = e["fixedNowMs"].as_u64().unwrap();
    HttpProvider::new(fake.clone(), ChatConfig::resolve(&settings(v)), options)
        .with_sleep(Box::new(move |ms| {
            sleeps.lock().unwrap().push(ms);
            Box::pin(async {})
        }))
        .with_clock(Box::new(move || fixed))
}

fn error_json(e: &AiError) -> Value {
    json!({ "message": e.to_string(), "status": e.status().unwrap_or(0) })
}

// ── Tests ───────────────────────────────────────────────────────────────

#[test]
fn denkbloecke() {
    for case in golden("think.json").as_array().unwrap() {
        let out = split_think(&s(&case["raw"]), case["skip"].as_bool().unwrap());
        assert_eq!(out.content, s(&case["content"]), "Inhalt: {case}");
        assert_eq!(out.reasoning, s(&case["reasoning"]), "Denken: {case}");
    }
}

#[test]
fn familien_und_thinking_stufen() {
    for case in golden("config.json").as_array().unwrap() {
        let p = &case["provider"];
        let provider = Provider { id: s(&p["id"]), name: s(&p["name"]), base: s(&p["base"]), key: "k".into() };
        let config = ChatConfig::resolve(&AiSettings {
            providers: vec![provider.clone()],
            active_provider_id: provider.id.clone(),
            model: s(&case["model"]),
            thinking_enabled: true,
        });
        let cap = ThinkingCapabilities::declared(&config);
        let js = &case["cap"];
        let got = json!({
            "levels": cap.levels, "includeThoughts": cap.include_thoughts, "offEffort": cap.off_effort, "offLabel": cap.off_label,
            "source": cap.source, "error": cap.unsupported_note(&config.model).unwrap_or_default(),
        });
        assert_eq!(&got, js, "{case}");
    }
}

#[test]
fn werkzeuge_und_voreinstellungen() {
    let defs: Vec<Value> = builtin_tools().iter().map(|t| t.to_json(Family::Other)).collect();
    assert_eq!(Value::from(defs), golden("tool-defs.json"));
    let presets: Vec<Value> =
        MODEL_PRESETS.iter().map(|p| json!({ "value": p.value, "label": p.label, "provider": p.provider })).collect();
    assert_eq!(Value::from(presets), golden("presets.json"));
}

/// Einzelanfrage (complete am Stück, refine gestreamt) samt Wiederholungen.
fn chat_case(case: &Value) {
    let name = s(&case["name"]);
    let fake = Fake::new(&case["responses"]);
    let sleeps = Arc::new(Mutex::new(vec![]));
    let p = provider(&case["settings"], &fake, sleeps.clone());
    let call = &case["call"];
    let (mut last_delta, mut last_reasoning) = (String::new(), String::new());
    let result = if s(&call["kind"]) == "complete" {
        let system = call["system"].as_str();
        block_on(complete(&p, &s(&call["prompt"]), system)).map(|c| (c, None))
    } else {
        let history: Vec<Message> = call["history"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| Message::text(if m["role"] == "user" { Role::User } else { Role::Assistant }, s(&m["content"])))
            .collect();
        let messages =
            refine_messages(&history, &s(&call["instruction"]), &s(&case["settings"]["customInstructions"]), now());
        block_on(p.chat(ChatTurn { messages: &messages, tools: &[], stream: true }, &mut |u| {
            match u {
                StreamUpdate::Content(t) => last_delta = t.to_owned(),
                StreamUpdate::Reasoning(t) => last_reasoning = t.to_owned(),
            }
            true
        }))
        .map(|m| (m.content.clone(), Some(m)))
    };
    check_requests(&name, &case["requests"], &fake.seen.lock().unwrap());
    let waits: Vec<u64> = sleeps.lock().unwrap().iter().copied().filter(|&ms| ms >= 100).collect();
    assert_eq!(Value::from(waits), case["sleeps"], "{name}: Wartezeiten");
    match result {
        Ok((content, msg)) => {
            assert_eq!(Value::from(content), case["result"], "{name}: Ergebnis");
            if let Some(m) = msg {
                let js = &case["message"];
                assert_eq!(m.content, s(&js["content"]), "{name}: Inhalt");
                assert_eq!(m.reasoning.clone().unwrap_or_default(), s(&js["reasoning"]), "{name}: Denken");
                assert_eq!(m.raw_content, s(&js["rawContent"]), "{name}: Rohtext");
                let calls: Vec<Value> = m
                    .tool_calls
                    .iter()
                    .map(|c| json!({ "id": c.id, "name": c.name, "arguments": c.arguments }))
                    .collect();
                assert_eq!(norm_ids(&Value::from(calls)), norm_ids(&js["toolCalls"]), "{name}: Werkzeugaufrufe");
                assert_eq!(last_delta, s(&case["lastDelta"]), "{name}: letzter Entwurf");
                assert_eq!(last_reasoning, s(&case["lastReasoning"]), "{name}: letzter Denkstand");
            }
        }
        Err(e) => assert_eq!(error_json(&e), case["error"], "{name}: Fehler"),
    }
}

#[test]
fn einzelanfragen_und_stroeme() {
    for case in golden("chats.json").as_array().unwrap() {
        chat_case(case);
    }
}

#[test]
fn wiederholungen() {
    for case in golden("retries.json").as_array().unwrap() {
        chat_case(case);
    }
}

#[test]
fn stroeme_in_beliebigen_stuecken() {
    // Dieselben Ströme in jeder anderen Stückelung (1 Byte, 2 Bytes, am Stück) → gleiches Ergebnis.
    for case in golden("chats.json").as_array().unwrap() {
        let r = &case["responses"][0];
        if r["chunks"].is_null() || !case["error"].is_null() || case["responses"].as_array().unwrap().len() != 1 {
            continue;
        }
        let body = s(&r["body"]).into_bytes();
        let mut results = vec![];
        for size in [1usize, 2, 5, body.len()] {
            let mut p = StreamParser::new(s(&case["settings"]["activeProviderId"]) == "google");
            for c in body.chunks(size) {
                p.feed(c, &mut |_| {}).unwrap();
            }
            results.push(p.finish(&mut |_| {}, &mut |i| format!("call_{i}")).unwrap());
        }
        assert!(results.windows(2).all(|w| w[0] == w[1]), "{}", case["name"]);
    }
}

// ── Agent ───────────────────────────────────────────────────────────────

struct Exec {
    results: VecDeque<Value>,
    answers: VecDeque<String>,
    runs: Vec<Value>,
    asks: Vec<Value>,
    heft: Option<(Vec<String>, String)>,
    image: String,
}

impl ToolExecutor for Exec {
    async fn run(&mut self, name: &str, args: &Value) -> Result<ToolOutput, String> {
        self.runs.push(json!({ "name": name, "args": args }));
        let Some(next) = self.results.pop_front() else { return Ok(ToolOutput::new(r#"{"ok":true}"#)) };
        if let Some(t) = next["throw"].as_str() {
            return Err(t.into());
        }
        Ok(ToolOutput { json: s(&next["json"]), undo: Some(next["undo"].clone()).filter(|u| !u.is_null()) })
    }

    async fn ask(&mut self, question: &str, options: &[String]) -> Option<String> {
        self.asks.push(json!({ "question": question, "options": options }));
        let a = self.answers.pop_front().unwrap_or_else(|| "Abbrechen".into());
        (a != "__abort__").then_some(a)
    }

    async fn heft_page(&mut self, _title: Option<&str>, page: Option<f64>) -> HeftPage {
        let page_no = page.map_or(1, |p| p.floor().max(1.0) as u32);
        // Das Golden-Heft hat nur Seite 1 mit Text; weitere Seiten sind leer.
        match &self.heft {
            Some((texts, ocr)) => HeftPage {
                page_no,
                result: Ok(HeftPageContent {
                    texts: if page_no == 1 { texts.clone() } else { vec![] },
                    ocr_text: if page_no == 1 { ocr.clone() } else { String::new() },
                    image_url: self.image.clone(),
                }),
            },
            None => HeftPage { page_no: 0, result: Err("Kein Heft".into()) },
        }
    }
}

fn workspace(ws: &Value, image: &str) -> Workspace {
    match ws["kind"].as_str().unwrap() {
        "empty" => Workspace::Empty,
        "anki" => Workspace::Anki(AnkiView {
            tab: s(&ws["tab"]),
            deck: s(&ws["deck"]),
            new: ws["new"].as_u64().unwrap() as u32,
            learn: ws["learn"].as_u64().unwrap() as u32,
            review: ws["review"].as_u64().unwrap() as u32,
            card: ws["front"]
                .as_str()
                .map(|f| AnkiCard { front: f.into(), back: ws["back"].as_str().map(String::from) }),
        }),
        "page" => Workspace::Page {
            title: s(&ws["title"]),
            context: (!ws["off"].as_bool().unwrap_or(false)).then(|| PageContext::Text { content: s(&ws["content"]) }),
        },
        "heft" => Workspace::Page {
            title: s(&ws["title"]),
            context: Some(PageContext::Heft {
                title: s(&ws["title"]),
                page_index: 0,
                texts: serde_json::from_value(ws["texts"].clone()).unwrap(),
                ocr_text: s(&ws["ocr"]),
                image_url: Some(image.into()),
            }),
        },
        other => panic!("unbekannt: {other}"),
    }
}

fn item_json(item: &AgentItem) -> Value {
    match item {
        AgentItem::Thought(r) => json!({ "role": "thought", "reasoning": r }),
        AgentItem::Assistant { content, model } if model.is_empty() => {
            json!({ "role": "assistant", "content": content })
        }
        AgentItem::Assistant { content, model } => json!({ "role": "assistant", "content": content, "model": model }),
        AgentItem::Tool { name, detail, error } => {
            json!({ "role": "tool", "name": name, "detail": detail, "error": error })
        }
        AgentItem::Change { summary, undo } => {
            json!({ "role": "edit", "summary": summary, "undo": undo, "undone": false })
        }
    }
}

#[test]
fn agent_schleife() {
    let image = s(&env()["image"]);
    for case in golden("agent.json").as_array().unwrap() {
        let name = s(&case["name"]);
        let st = &case["settings"];
        let ws = workspace(&case["workspace"], &image);
        let heft = (case["workspace"]["kind"] == "heft").then(|| {
            (serde_json::from_value(case["workspace"]["texts"].clone()).unwrap(), s(&case["workspace"]["ocr"]))
        });
        let hits: Vec<RagHit> = case["rag"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|h| RagHit {
                        page_id: s(&h["pageId"]),
                        title: s(&h["title"]),
                        score: h["score"].as_f64(),
                        snippet: s(&h["snippet"]),
                        archived: h["archived"].as_bool().unwrap_or(false),
                    })
                    .collect()
            })
            .unwrap_or_default();
        let active = (case["workspace"]["kind"] != "empty" && case["workspace"]["kind"] != "anki")
            .then(|| (s(&case["workspace"]["id"]), s(&case["workspace"]["title"])));
        let mut session = AgentSession::default();
        for (n, run) in case["runs"].as_array().unwrap().iter().enumerate() {
            let label = format!("{name}/{n}");
            let fake = Fake::new(&run["responses"]);
            let p = provider(st, &fake, Arc::new(Mutex::new(vec![])));
            let mut chat: Vec<ChatEntry> = serde_json::from_value(run["chatBefore"].clone()).unwrap();
            let mut user: ChatEntry = serde_json::from_value(run["attachment"].clone()).unwrap_or_default();
            user.role = "user".into();
            user.content = s(&run["userText"]);
            chat.push(user);
            let text = user_text(run);
            let query = rag_query(&text);
            let rag_used: Vec<String> =
                if hits.is_empty() { vec![] } else { query.map(String::from).into_iter().collect() };
            assert_eq!(Value::from(rag_used.clone()), run["ragQueries"], "{label}: RAG-Suche");
            let mut exec = Exec {
                results: run["toolResults"].as_array().unwrap().iter().cloned().collect(),
                answers: run["answers"].as_array().unwrap().iter().map(s).collect(),
                runs: vec![],
                asks: vec![],
                heft: heft.clone(),
                image: image.clone(),
            };
            let tools = builtin_tools();
            let req = AgentRequest {
                chat: &chat,
                workspace: &ws,
                rag_hits: if rag_used.is_empty() { &[] } else { &hits },
                active_page: active.as_ref().map(|(a, b)| (a.as_str(), b.as_str())),
                tools,
                always_send_tools: st["alwaysSendTools"].as_bool().unwrap(),
                custom_instructions: st["customInstructions"].as_str().unwrap_or_default(),
                embed_model: st["embedModel"].as_str().unwrap_or_default(),
                now: now(),
            };
            let mut items = vec![];
            let outcome = block_on(run_agent(&p, &mut exec, &req, &mut session, &CancelToken::default(), &mut |e| {
                if let AgentEvent::Item(i) = e {
                    items.push(item_json(&i));
                }
            }));
            check_requests(&label, &run["requests"], &fake.seen.lock().unwrap());
            assert_eq!(Value::from(items), run["items"], "{label}: Chat-Einträge");
            assert_eq!(Value::from(exec.runs), run["toolRuns"], "{label}: Werkzeuge");
            assert_eq!(Value::from(exec.asks), run["asks"], "{label}: Rückfragen");
            match outcome {
                Ok(o) => {
                    assert_eq!(Value::from(o.text), run["result"], "{label}: Antwort");
                    let info = o.page_context.map(|i| json!({ "sent": i.sent, "total": i.total }));
                    let js = run["pageCtxInfo"].as_object().map(|m| json!({ "sent": m["sent"], "total": m["total"] }));
                    assert_eq!(info, js, "{label}: Seitenkontext");
                }
                Err(e) => assert_eq!(error_json(&e), run["error"], "{label}: Fehler"),
            }
        }
    }
}

fn user_text(run: &Value) -> String {
    s(&run["userText"])
}

// ── Modelle, Verbindungstest, Embeddings ────────────────────────────────

#[test]
fn modelle_ping_embeddings() {
    for case in golden("api.json").as_array().unwrap() {
        let name = s(&case["name"]);
        let fake = Fake::new(&case["responses"]);
        let providers: Vec<Provider> = serde_json::from_value(case["providers"].clone()).unwrap();
        let sync_url = s(&case["syncUrl"]);
        let sources = Sources { providers: &providers, sync_url: &sync_url };
        let (result, error): (Value, Option<AiError>) = if name.starts_with("list-models") {
            match block_on(list_models(&fake, sources)) {
                Ok(list) => (list.iter().map(|m| json!({ "id": m.id, "providerId": m.provider_id })).collect(), None),
                Err(e) => (Value::Null, Some(e)),
            }
        } else if name.starts_with("ping") {
            let base = match name.as_str() {
                "ping-ok" => " http://p1:1/v1/ ",
                "ping-401" => "http://p2:1/v1",
                "ping-404-v1" => "http://p3:1",
                "ping-404-no-v1" => "http://p4:1",
                "ping-network" => "http://p5:1/v1",
                "ping-empty" => "  ",
                _ => "https://w.workers.dev",
            };
            let key = if name == "ping-ok" { "k" } else { "" };
            let r = block_on(ping_provider(
                &fake,
                &Provider { id: "a".into(), name: String::new(), base: base.into(), key: key.into() },
                sources,
            ));
            let mut out = json!({ "ok": r.ok });
            if r.ok {
                out["models"] = json!(r.models);
            }
            if let Some(st) = r.status {
                out["status"] = json!(st);
            }
            if let Some(b) = r.suggested_base {
                out["suggestedBase"] = json!(b);
            }
            if let Some(e) = r.error {
                out["error"] = json!(e);
            }
            (out, None)
        } else {
            let model = s(&case["settings"]["embedModel"]);
            let route = embed_route(&s(&case["settings"]["embedProviderId"]), &model).unwrap();
            assert_eq!(route, EmbedRoute::Remote);
            let p = embed_provider(&providers, &s(&case["settings"]["embedProviderId"]), &providers[0].id).unwrap();
            let texts: Vec<String> = case["requests"][0]["body"]["input"].as_array().unwrap().iter().map(s).collect();
            match block_on(embed_remote(&fake, p, &model, &texts)) {
                // Zahlen als f64 vergleichen (JS kennt keine Unterscheidung 1 vs. 1.0).
                Ok(v) => {
                    let js: Vec<Vec<f64>> = serde_json::from_value(case["result"].clone()).unwrap();
                    let rs: Vec<Vec<f64>> = v.iter().map(|x| x.iter().map(|&f| f64::from(f)).collect()).collect();
                    assert_eq!(js, rs, "{name}");
                    (case["result"].clone(), None)
                }
                Err(e) => (Value::Null, Some(e)),
            }
        };
        check_requests(&name, &case["requests"], &fake.seen.lock().unwrap());
        match error {
            None => assert_eq!(result, case["result"], "{name}"),
            Some(e) => assert_eq!(s(&case["error"]["message"]), e.to_string(), "{name}"),
        }
    }
    assert_eq!(embed_route("", "local:bekko-a8m").unwrap(), EmbedRoute::Local);
    assert!(embed_route("x", "").is_err());
}

#[test]
fn system_prompt_meta_und_eigene_anweisungen() {
    let p = system_prompt(ToolMode::Meta, "Notiz", "  eigen  ", now());
    assert!(p.contains("Heute: Di., 27.10.2026, 14:05 Uhr."));
    assert!(p.ends_with("Notiz\nZusätzliche Anweisungen (aus den Einstellungen):\neigen"));
}

#[test]
fn abbruch_ueber_rueckruf() {
    let body = "data: {\"choices\":[{\"delta\":{\"content\":\"A\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"B\"}}]}\n\n";
    let responses = json!([{ "status": 200, "headers": { "content-type": "text/event-stream" }, "body": body, "chunks": [10, body.len() - 10] }]);
    let fake = Fake::new(&responses);
    let st = json!({ "providers": [{ "id": "local", "name": "Lokal", "base": "http://x/v1" }], "activeProviderId": "local", "model": "m", "thinkingEnabled": true });
    let p = provider(&st, &fake, Arc::new(Mutex::new(vec![])));
    let messages = [Message::user("hi")];
    let r = block_on(p.chat(ChatTurn { messages: &messages, tools: &[], stream: true }, &mut |_| false));
    assert_eq!(r, Err(AiError::Aborted));
    assert_eq!(fake.seen.lock().unwrap().len(), 1, "kein Wiederholungsversuch nach Abbruch");
}
