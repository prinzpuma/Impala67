//! KI-Assistent für native Apps: Chat mit Werkzeugen (Agent-Schleife aus `impala-ai`) gegen den
//! [`ImpalaCore`]. Die App ruft [`AiAssistant::run`] aus einem Hintergrund-Thread (oder
//! [`AiAssistant::run_async`], dann meldet der Assistent Ende und Fehler über den [`AiListener`]);
//! Text, Denktext und neue Chat-Einträge kommen über Rückrufe, `cancel` bricht ab.
//!
//! Der Assistent liest Anbieter und Modell aus den Einstellungen des Kerns (`aiProviders`, `aiProviderId`,
//! `aiModel`, `thinkingEnabled`, `customInstructions`, `alwaysSendTools`; Schlüssel gehören in
//! `aiProviders[].key`) oder aus [`AiOptions`]. Chat und Werkzeuge laufen im Kern; die Plattform liefert nur,
//! was sie allein kann ([`AiPlatform`]: Rückfragen, Heftseite als Bild, `calculate`).

use std::cell::RefCell;
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, TryLockError};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use impala_ai::{
    AgentEvent, AgentItem, AgentRequest, AgentSession, AiError, AiSettings, AnkiCard, AnkiView, CancelToken,
    ChatConfig, ChatEntry, CloudflareAuth, DEFAULT_WORKER_URL, HttpProvider, LocalTime, PageContext, Provider, RagHit,
    RequestOptions, ToolDef, Workspace, builtin_tools, default_providers, rag_query, run_agent,
};
use impala_crypto::SyncKey;
use impala_net::{HttpClient, NetError, Request, Response, UreqClient, block_on};
use impala_storage::{Storage, Write};
use serde_json::{Value, json};

use crate::ai_tools::Env;
use crate::chats::{ChatMessage, message_of};
use crate::rag::SemanticSearch;
use crate::{ImpalaCore, Inner, Shared, lock};

// ---------------------------------------------------------------------------
// Einstellungen

/// Text einer Einstellung (leer, wenn nicht gesetzt).
pub(crate) fn setting_text(inner: &Inner, key: &str) -> String {
    match inner.model.state().settings.get(key) {
        Some(Value::String(s)) => s,
        _ => String::new(),
    }
}

/// `settings[key] !== false`
fn setting_flag(inner: &Inner, key: &str) -> bool {
    inner.model.state().settings.get(key) != Some(Value::Bool(false))
}

/// Gespeicherte KI-Quellen, sonst die Voreinstellungen.
pub(crate) fn ai_providers(inner: &Inner) -> Vec<Provider> {
    let list: Vec<Provider> = inner
        .model
        .state()
        .settings
        .ai_providers
        .iter()
        .flatten()
        .filter_map(|v| serde_json::from_value(v.clone()).ok())
        .collect();
    if list.is_empty() { default_providers() } else { list }
}

/// Anbieter und Verhalten; nicht gesetzte Felder kommen aus den Einstellungen des Kerns.
#[derive(Debug, Clone, Default, uniffi::Record)]
pub struct AiOptions {
    /// Quellen als JSON-Array `[{ "id", "name", "base", "key" }]` (überschreibt `aiProviders`).
    pub providers_json: Option<String>,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub thinking_enabled: Option<bool>,
    pub custom_instructions: Option<String>,
    /// Alle Werkzeuge in jeder Anfrage mitsenden (Standard an).
    pub always_send_tools: Option<bool>,
    /// Sync-Schlüssel für „Impala AI“ (Cloudflare-Worker); ohne ihn ist diese Quelle nicht nutzbar.
    pub sync_key: Option<String>,
    pub worker_url: Option<String>,
}

struct Resolved {
    settings: AiSettings,
    request: RequestOptions,
    custom: String,
    always_tools: bool,
    embed_model: String,
}

const SAFETY_ID_KEY: &str = "aiSafetyId";

fn resolve(inner: &mut Inner, o: &AiOptions) -> Resolved {
    let providers = o
        .providers_json
        .as_deref()
        .and_then(|j| serde_json::from_str::<Vec<Provider>>(j).ok())
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| ai_providers(inner));
    let settings = AiSettings {
        providers,
        active_provider_id: o.provider_id.clone().unwrap_or_else(|| setting_text(inner, "aiProviderId")),
        model: o.model.clone().unwrap_or_else(|| setting_text(inner, "aiModel")),
        thinking_enabled: o.thinking_enabled.unwrap_or_else(|| setting_flag(inner, "thinkingEnabled")),
    };
    let cloudflare = o.sync_key.as_deref().and_then(|k| SyncKey::parse(k).ok()).map(|k| CloudflareAuth {
        user_id: k.user_id().to_owned(),
        auth_token: k.auth_token().to_owned(),
        fallback_base: o
            .worker_url
            .clone()
            .filter(|u| !u.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_WORKER_URL.to_owned()),
    });
    // Anonyme, dauerhafte Kennung dieser Installation (für Missbrauchs-Erkennung beim Anbieter).
    let safety_id = inner.storage.meta(SAFETY_ID_KEY).ok().flatten().unwrap_or_else(|| {
        let id = format!("install_{}", uuid::Uuid::new_v4());
        let _ = inner.storage.apply(vec![Write::SetMeta(SAFETY_ID_KEY.into(), Some(id.clone()))]);
        id
    });
    Resolved {
        settings,
        request: RequestOptions { cloudflare, safety_id: Some(safety_id) },
        custom: o
            .custom_instructions
            .clone()
            .unwrap_or_else(|| setting_text(inner, "customInstructions"))
            .trim()
            .to_owned(),
        always_tools: o.always_send_tools.unwrap_or_else(|| setting_flag(inner, "alwaysSendTools")),
        embed_model: setting_text(inner, "embedModel"),
    }
}

// ---------------------------------------------------------------------------
// Typen an der Grenze

/// Anhang (Text- oder PDF-Datei) einer Nachricht.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct AiFile {
    pub name: String,
    pub content: String,
}

/// Karteikarten-Ansicht als Kontext (statt einer Seite).
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct AiAnki {
    pub tab: String,
    pub deck: String,
    pub new: u32,
    pub learn: u32,
    pub review: u32,
    /// Sichtbare Lernkarte; die Rückseite nur, wenn sie aufgedeckt ist.
    pub card_front: Option<String>,
    pub card_back: Option<String>,
}

/// Eine Nutzernachricht samt Umfeld.
#[derive(Debug, Clone, Default, uniffi::Record)]
pub struct AiRunRequest {
    /// Chat, in den geschrieben wird; leer = neuer Chat (die ID steht im Ergebnis).
    pub chat_id: String,
    pub text: String,
    /// Bild-Anhang als Data-URL.
    pub image: Option<String>,
    pub text_file: Option<AiFile>,
    pub pdf_file: Option<AiFile>,
    /// Geöffnete Seite (Notiz oder Heft) als Kontext.
    pub active_page_id: Option<String>,
    /// Angezeigte Heftseite (ab 0), wenn `active_page_id` ein Heft ist.
    pub heft_page_index: Option<u32>,
    /// Inhalt der geöffneten Seite mitsenden (sonst nur ihr Titel).
    pub send_page_context: bool,
    pub anki: Option<AiAnki>,
    /// Automatisch in den Notizen suchen (braucht eine [`SemanticSearch`]).
    pub use_rag: bool,
    /// Versatz der Ortszeit zu UTC in Minuten (MEZ +60) für „Heute: …“ und Tagesgrenzen.
    pub utc_offset_minutes: i32,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct AiOutcome {
    pub chat_id: String,
    /// Letzte Antwort des Modells.
    pub text: String,
    /// Wie viel vom Seitentext mitging (Anzeige „Kontext: x von y Zeichen“).
    pub context_sent: Option<u32>,
    pub context_total: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, uniffi::Error)]
pub enum AiFailure {
    /// Es läuft schon eine Anfrage dieses Assistenten.
    Busy,
    /// Mit `cancel` (oder durch Abbruch einer Rückfrage) beendet.
    Aborted,
    Timeout {
        reason: String,
    },
    Network {
        reason: String,
    },
    Http {
        status: u16,
        reason: String,
        retry_after_ms: u64,
    },
    /// Fehlende Einrichtung, unbrauchbare Antwort, Speicherfehler.
    Other {
        reason: String,
    },
}

impl std::fmt::Display for AiFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            AiFailure::Busy => f.write_str("Es läuft bereits eine KI-Anfrage."),
            AiFailure::Aborted => f.write_str("Abgebrochen."),
            AiFailure::Timeout { reason: message }
            | AiFailure::Network { reason: message }
            | AiFailure::Http { reason: message, .. }
            | AiFailure::Other { reason: message } => f.write_str(message),
        }
    }
}

impl std::error::Error for AiFailure {}

impl From<AiError> for AiFailure {
    fn from(e: AiError) -> Self {
        let message = e.to_string();
        match e {
            AiError::Aborted => AiFailure::Aborted,
            AiError::Timeout { .. } => AiFailure::Timeout { reason: message },
            AiError::Network(_) => AiFailure::Network { reason: message },
            AiError::Http { status, retry_after_ms, .. } => AiFailure::Http { status, reason: message, retry_after_ms },
            AiError::Other(_) => AiFailure::Other { reason: message },
        }
    }
}

/// Rückrufe eines Laufs, vom Lauf-Thread aufgerufen: schnell zurückkehren.
#[uniffi::export(with_foreign)]
pub trait AiListener: Send + Sync {
    /// Entwurf der laufenden Antwort (der ganze bisherige Text; leer = zurücksetzen).
    fn on_draft(&self, text: String);
    /// Denktext der laufenden Antwort (ganzer Text; leer = zurücksetzen).
    fn on_thinking(&self, text: String);
    /// Ein Werkzeug startet (Statuszeile).
    fn on_tool_started(&self, name: String);
    /// Neuer Eintrag im Chat in Anzeigereihenfolge: `thought`, `assistant`, `tool` (Chip), `edit`
    /// (Änderungs-Karte mit Rückgängig), `question` (Rückfrage; die Antwort holt [`AiPlatform::ask`]).
    fn on_message(&self, message: ChatMessage);
    /// Nur bei [`AiAssistant::run_async`]: Lauf fertig.
    fn on_finished(&self, outcome: AiOutcome);
    /// Nur bei [`AiAssistant::run_async`]: Lauf gescheitert (`aborted`: vom Nutzer abgebrochen).
    fn on_failed(&self, message: String, aborted: bool);
}

/// Was nur die Plattform kann. Wird vom Lauf-Thread aufgerufen und darf blockieren (Rückfragen warten
/// auf den Nutzer).
#[uniffi::export(with_foreign)]
pub trait AiPlatform: Send + Sync {
    /// Anklickbare Rückfrage (`ask_choice` und Bestätigung löschender Änderungen: Optionen
    /// „Ja, ausführen“ / „Abbrechen“). `None` = Nutzer hat abgebrochen, der Lauf endet mit `Aborted`.
    fn ask(&self, question: String, options: Vec<String>) -> Option<String>;
    /// Heftseite als Bild (Data-URL, z. B. PNG) für `view_heft_page`; `None` = nicht möglich.
    fn heft_page_image(&self, page_id: String, page_index: u32) -> Option<String>;
    /// Namen weiterer Werkzeuge, die [`AiPlatform::run_tool`] ausführt (`calculate`, `send_to_notebooklm`).
    fn supported_tools(&self) -> Vec<String>;
    /// Führt eines davon aus: Argumente und Ergebnis als JSON-Text (das Ergebnis geht ans Modell;
    /// Fehler als `{"error": "…"}`). `None` = unbekannt.
    fn run_tool(&self, name: String, args_json: String) -> Option<String>;
}

// ---------------------------------------------------------------------------
// HTTP als Objekt (Tests liefern einen falschen Server)

type Boxed<'a, T> = Pin<Box<dyn Future<Output = T> + 'a>>;

trait DynHttp: Send + Sync {
    fn send<'a>(&'a self, req: &'a Request) -> Boxed<'a, Result<Response, NetError>>;
    fn send_streaming<'a>(
        &'a self,
        req: &'a Request,
        on_chunk: &'a mut dyn FnMut(&[u8]) -> bool,
    ) -> Boxed<'a, Result<Response, NetError>>;
}

impl<H: HttpClient + Send + Sync> DynHttp for H {
    fn send<'a>(&'a self, req: &'a Request) -> Boxed<'a, Result<Response, NetError>> {
        Box::pin(HttpClient::send(self, req))
    }

    fn send_streaming<'a>(
        &'a self,
        req: &'a Request,
        on_chunk: &'a mut dyn FnMut(&[u8]) -> bool,
    ) -> Boxed<'a, Result<Response, NetError>> {
        Box::pin(HttpClient::send_streaming(self, req, on_chunk))
    }
}

struct HttpHandle(Arc<dyn DynHttp>);

impl HttpClient for HttpHandle {
    async fn send(&self, req: &Request) -> Result<Response, NetError> {
        self.0.send(req).await
    }

    async fn send_streaming(
        &self,
        req: &Request,
        on_chunk: &mut dyn FnMut(&[u8]) -> bool,
    ) -> Result<Response, NetError> {
        self.0.send_streaming(req, on_chunk).await
    }
}

// ---------------------------------------------------------------------------
// Hilfen

fn wall_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

/// Ortszeit aus UTC-Millisekunden und Versatz (bürgerlicher Kalender, Algorithmus von H. Hinnant).
fn local_time(utc_ms: i64, offset_minutes: i32) -> LocalTime {
    let secs = utc_ms.div_euclid(1000) + i64::from(offset_minutes) * 60;
    let (days, day_secs) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let z = days + 719_468;
    let (era, doe) = (z.div_euclid(146_097), z.rem_euclid(146_097));
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u8;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u8;
    let year = (yoe + era * 400 + i64::from(month <= 2)) as i32;
    LocalTime {
        year,
        month,
        day,
        weekday: (days + 4).rem_euclid(7) as u8,
        hour: (day_secs / 3600) as u8,
        minute: (day_secs % 3600 / 60) as u8,
    }
}

/// Chat-Eintrag zu einem Ereignis der Agent-Schleife (wie `onEvent` in `web/ai.js`).
fn item_message(item: &AgentItem) -> Value {
    let mid = uuid::Uuid::new_v4().to_string();
    match item {
        AgentItem::Thought(r) => json!({ "mid": mid, "role": "thought", "reasoning": r, "reasoningExpanded": false }),
        AgentItem::Assistant { content, model } => {
            let mut m = json!({ "mid": mid, "role": "assistant", "content": content, "reasoning": null, "reasoningExpanded": false });
            if !model.is_empty() {
                m["model"] = Value::from(model.as_str());
            }
            m
        }
        AgentItem::Tool { name, detail, error } => {
            json!({ "mid": mid, "role": "tool", "name": name, "detail": detail, "error": error })
        }
        AgentItem::Change { summary, undo } => {
            json!({ "mid": mid, "role": "edit", "summary": summary, "undo": undo, "undone": false })
        }
    }
}

fn user_message(req: &AiRunRequest, text: &str) -> Value {
    let mut m = json!({ "mid": uuid::Uuid::new_v4().to_string(), "role": "user", "content": text });
    if let Some(img) = &req.image {
        m["image"] = Value::from(img.as_str());
    }
    for (key, file) in [("textFile", &req.text_file), ("pdfFile", &req.pdf_file)] {
        if let Some(f) = file {
            m[key] = json!({ "name": f.name, "content": f.content });
        }
    }
    m
}

/// Werkzeuge, die dieser Lauf anbieten kann: Rückfragen und Heftbilder brauchen die Plattform.
fn tool_defs(platform: Option<&Arc<dyn AiPlatform>>) -> Vec<ToolDef> {
    let extra = platform.map(|p| p.supported_tools()).unwrap_or_default();
    builtin_tools()
        .iter()
        .filter(|t| match t.name.as_str() {
            "ask_choice" | "view_heft_page" => platform.is_some(),
            "calculate" | "send_to_notebooklm" => extra.contains(&t.name),
            _ => true,
        })
        .cloned()
        .collect()
}

/// Was vor dem Lauf unter der Sperre eingesammelt wird.
struct Prepared {
    chat_id: String,
    title: String,
    created: String,
    messages: Vec<Value>,
    resolved: Resolved,
    workspace: Workspace,
    /// Heft, dessen Seitenbild nachgereicht wird (ID, Seite ab 0).
    heft: Option<(String, u32)>,
    active: Option<(String, String)>,
}

/// Arbeitsunterlagen, Heft für das Seitenbild (ID, Seite ab 0), geöffnete Seite (ID, Titel).
type WorkspaceParts = (Workspace, Option<(String, u32)>, Option<(String, String)>);

fn workspace_of(inner: &Inner, req: &AiRunRequest) -> WorkspaceParts {
    if let Some(a) = &req.anki {
        let card = a.card_front.as_ref().map(|f| AnkiCard { front: f.clone(), back: a.card_back.clone() });
        let view =
            AnkiView { tab: a.tab.clone(), deck: a.deck.clone(), new: a.new, learn: a.learn, review: a.review, card };
        return (Workspace::Anki(view), None, None);
    }
    let state = inner.model.state();
    let Some(pg) = req.active_page_id.as_deref().and_then(|id| state.pages.get(id)) else {
        return (Workspace::Empty, None, None);
    };
    let active = Some((pg.id().to_owned(), pg.title().to_owned()));
    if !req.send_page_context {
        return (Workspace::Page { title: pg.title().to_owned(), context: None }, None, active);
    }
    if pg.is_heft() {
        let doc = state.hefte.get(pg.id());
        let index = req.heft_page_index.unwrap_or(0).min(doc.map_or(0, |d| d.pages.len().saturating_sub(1)) as u32);
        let page = doc.and_then(|d| d.pages.get(index as usize));
        let context = PageContext::Heft {
            title: pg.title().to_owned(),
            page_index: index,
            texts: page
                .map(|p| p.texts.iter().filter_map(|t| t.text.clone()).filter(|t| !t.is_empty()).collect())
                .unwrap_or_default(),
            ocr_text: page.map(|p| p.ocr_text.clone()).unwrap_or_default(),
            image_url: None,
        };
        let workspace = Workspace::Page { title: pg.title().to_owned(), context: Some(context) };
        return (workspace, Some((pg.id().to_owned(), index)), active);
    }
    let context = PageContext::Text { content: pg.content().to_owned() };
    (Workspace::Page { title: pg.title().to_owned(), context: Some(context) }, None, active)
}

/// Der KI-Assistent eines Kerns. Ein Lauf zur Zeit; `run` blockiert bis zum Ende.
#[derive(uniffi::Object)]
pub struct AiAssistant {
    core: Shared,
    http: Arc<dyn DynHttp>,
    options: AiOptions,
    platform: Option<Arc<dyn AiPlatform>>,
    search: Option<Arc<SemanticSearch>>,
    /// Zustand je Chat, der Läufe überdauert (Zusammenfassung, freigeschaltete Werkzeuge).
    sessions: Mutex<HashMap<String, AgentSession>>,
    cancel: Mutex<CancelToken>,
    busy: Mutex<()>,
}

impl AiAssistant {
    pub(crate) fn start<H: HttpClient + Send + Sync + 'static>(
        core: &ImpalaCore,
        http: H,
        options: AiOptions,
        platform: Option<Arc<dyn AiPlatform>>,
        search: Option<Arc<SemanticSearch>>,
    ) -> Arc<Self> {
        Arc::new(AiAssistant {
            core: core.shared(),
            http: Arc::new(http),
            options,
            platform,
            search,
            sessions: Mutex::new(HashMap::new()),
            cancel: Mutex::new(CancelToken::default()),
            busy: Mutex::new(()),
        })
    }

    fn prepare(&self, req: &AiRunRequest, text: &str) -> Result<Prepared, AiFailure> {
        let mut inner = lock(&self.core);
        let chat_id =
            if req.chat_id.trim().is_empty() { uuid::Uuid::new_v4().to_string() } else { req.chat_id.clone() };
        let (title, created, _, mut messages) = inner.chat_raw(&chat_id).unwrap_or_default();
        messages.push(user_message(req, text));
        let (workspace, heft, active) = workspace_of(&inner, req);
        let resolved = resolve(&mut inner, &self.options);
        Ok(Prepared { chat_id, title, created, messages, resolved, workspace, heft, active })
    }

    /// Lauf auf dem aufrufenden Thread.
    fn run_blocking(&self, req: AiRunRequest, listener: Option<Arc<dyn AiListener>>) -> Result<AiOutcome, AiFailure> {
        let _busy = match self.busy.try_lock() {
            Ok(g) => g,
            Err(TryLockError::Poisoned(p)) => p.into_inner(),
            Err(TryLockError::WouldBlock) => return Err(AiFailure::Busy),
        };
        let cancel = CancelToken::default();
        *self.cancel.lock().unwrap_or_else(|e| e.into_inner()) = cancel.clone();
        let text = req.text.trim().to_owned();
        if text.is_empty() && req.image.is_none() && req.text_file.is_none() && req.pdf_file.is_none() {
            return Err(AiFailure::Other { reason: "Leere Nachricht.".into() });
        }
        let mut prep = self.prepare(&req, &text)?;
        let config = ChatConfig::resolve(&prep.resolved.settings);

        // Seitenbild des Hefts (Plattform) und automatische Notizsuche: ohne Sperre auf dem Kern.
        if let (Some((id, index)), Some(p)) = (&prep.heft, &self.platform)
            && let Workspace::Page { context: Some(PageContext::Heft { image_url, .. }), .. } = &mut prep.workspace
        {
            *image_url = p.heft_page_image(id.clone(), *index);
        }
        let rag_hits: Vec<RagHit> = match (&self.search, req.use_rag, rag_query(&text)) {
            (Some(s), true, Some(q)) => s
                .search(q.to_owned(), 4)
                .map(|hits| {
                    hits.into_iter()
                        .map(|h| RagHit {
                            page_id: h.page_id,
                            title: h.title,
                            score: Some(h.score),
                            snippet: h.snippet,
                            archived: h.archived,
                        })
                        .collect()
                })
                .unwrap_or_default(),
            _ => vec![],
        };

        let provider = HttpProvider::new(HttpHandle(self.http.clone()), config, prep.resolved.request.clone());
        let tools = tool_defs(self.platform.as_ref());
        let mut session =
            self.sessions.lock().unwrap_or_else(|e| e.into_inner()).get(&prep.chat_id).cloned().unwrap_or_default();
        let now = local_time(wall_ms(), req.utc_offset_minutes);
        let chat: Vec<ChatEntry> =
            prep.messages.iter().filter_map(|m| serde_json::from_value(m.clone()).ok()).collect();
        let transcript = RefCell::new(std::mem::take(&mut prep.messages));

        let result = {
            let notify = |m: &Value| {
                if let Some(l) = &listener {
                    l.on_message(message_of(m));
                }
            };
            let mut env = Env {
                core: &self.core,
                search: self.search.as_deref(),
                platform: self.platform.as_ref(),
                active_page: req.active_page_id.clone(),
                heft_index: req.heft_page_index.unwrap_or(0),
                now,
                utc_offset: req.utc_offset_minutes,
                transcript: &transcript,
                notify: &notify,
            };
            let agent_req = AgentRequest {
                chat: &chat,
                workspace: &prep.workspace,
                rag_hits: &rag_hits,
                active_page: prep.active.as_ref().map(|(id, title)| (id.as_str(), title.as_str())),
                tools: &tools,
                always_send_tools: prep.resolved.always_tools,
                custom_instructions: &prep.resolved.custom,
                embed_model: &prep.resolved.embed_model,
                now,
            };
            let mut on_event = |ev: AgentEvent<'_>| match ev {
                AgentEvent::Draft(t) => listener.iter().for_each(|l| l.on_draft(t.to_owned())),
                AgentEvent::Thinking(t) => listener.iter().for_each(|l| l.on_thinking(t.to_owned())),
                AgentEvent::ToolStarted(n) => listener.iter().for_each(|l| l.on_tool_started(n.to_owned())),
                AgentEvent::Item(item) => {
                    let m = item_message(&item);
                    transcript.borrow_mut().push(m.clone());
                    notify(&m);
                }
            };
            block_on(run_agent(&provider, &mut env, &agent_req, &mut session, &cancel, &mut on_event))
        };

        // Auch nach Fehler und Abbruch sichern, was bis dahin entstand (die Nutzernachricht zuerst).
        let saved = lock(&self.core).save_chat_raw(&prep.chat_id, &prep.title, &prep.created, transcript.into_inner());
        self.sessions.lock().unwrap_or_else(|e| e.into_inner()).insert(prep.chat_id.clone(), session);
        let out = result.map_err(AiFailure::from)?;
        saved.map_err(|e| AiFailure::Other { reason: e.to_string() })?;
        Ok(AiOutcome {
            chat_id: prep.chat_id,
            text: out.text,
            context_sent: out.page_context.map(|p| p.sent as u32),
            context_total: out.page_context.map(|p| p.total as u32),
        })
    }
}

#[uniffi::export]
impl AiAssistant {
    /// `platform`: Rückfragen, Heftbilder, Zusatzwerkzeuge (ohne sie entfallen `ask_choice`,
    /// `view_heft_page` und `calculate`, und löschende Änderungen gelten als abgelehnt).
    /// `search`: für die automatische Notizsuche und das Werkzeug „semantische Suche“.
    #[uniffi::constructor]
    pub fn new(
        core: Arc<ImpalaCore>,
        options: AiOptions,
        platform: Option<Arc<dyn AiPlatform>>,
        search: Option<Arc<SemanticSearch>>,
    ) -> Arc<Self> {
        AiAssistant::start(&core, UreqClient::default(), options, platform, search)
    }

    /// Schickt eine Nutzernachricht, fährt die Agent-Schleife (Werkzeuge, Rückfragen) und speichert den
    /// Chat. Blockiert bis zum Ende: aus einem Hintergrund-Thread rufen. Ein Lauf zur Zeit
    /// (`Busy`). Auch bei Fehler und Abbruch wird der bisherige Verlauf gespeichert.
    pub fn run(&self, request: AiRunRequest, listener: Option<Arc<dyn AiListener>>) -> Result<AiOutcome, AiFailure> {
        self.run_blocking(request, listener)
    }

    /// Wie `run` auf einem eigenen Thread; das Ende meldet der Listener (`on_finished`/`on_failed`).
    pub fn run_async(self: Arc<Self>, request: AiRunRequest, listener: Arc<dyn AiListener>) {
        let me = self.clone();
        let spawned = thread::Builder::new().name("impala-ai".into()).spawn(move || {
            match me.run_blocking(request, Some(listener.clone())) {
                Ok(outcome) => listener.on_finished(outcome),
                Err(e) => listener.on_failed(e.to_string(), e == AiFailure::Aborted),
            }
        });
        drop(spawned);
    }

    /// Bricht den laufenden Lauf ab (`Aborted`); eine offene Rückfrage beantwortet die Plattform mit `None`.
    pub fn cancel(&self) {
        self.cancel.lock().unwrap_or_else(|e| e.into_inner()).cancel();
    }

    /// Läuft gerade ein Lauf?
    pub fn is_running(&self) -> bool {
        matches!(self.busy.try_lock(), Err(TryLockError::WouldBlock))
    }

    /// Zusammenfassung und freigeschaltete Werkzeuge eines Chats vergessen (neuer Gesprächsstand).
    pub fn forget_chat_state(&self, chat_id: String) {
        self.sessions.lock().unwrap_or_else(|e| e.into_inner()).remove(&chat_id);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;
    use crate::rag::{EmbedFailure, TextEmbedder};

    /// Falscher Anbieter: erster Aufruf ruft `change` auf, danach kommt die Antwort.
    #[derive(Clone, Default)]
    struct Provider {
        bodies: Arc<Mutex<Vec<Value>>>,
        calls: Arc<AtomicUsize>,
    }

    fn sse(deltas: &[Value]) -> Response {
        let mut body = String::new();
        for d in deltas {
            body.push_str(&format!("data: {}\n\n", json!({ "choices": [{ "delta": d }] })));
        }
        body.push_str("data: [DONE]\n\n");
        Response {
            status: 200,
            headers: vec![("content-type".into(), "text/event-stream".into())],
            body: body.into_bytes(),
        }
    }

    impl HttpClient for Provider {
        async fn send(&self, req: &Request) -> Result<Response, NetError> {
            assert!(req.url.ends_with("/chat/completions"), "{}", req.url);
            self.bodies.lock().unwrap().push(serde_json::from_slice(&req.body).unwrap());
            Ok(match self.calls.fetch_add(1, Ordering::Relaxed) {
                0 => {
                    let args = json!({ "operations": [{ "op": "page.create", "title": "Zusammenfassung", "content": "Integral = Fläche" }] });
                    sse(&[
                        json!({ "reasoning": "Ich lege die Seite an." }),
                        json!({ "tool_calls": [{ "index": 0, "id": "call_1", "function": { "name": "change", "arguments": args.to_string() } }] }),
                    ])
                }
                _ => sse(&[json!({ "content": "Seite " }), json!({ "content": "angelegt." })]),
            })
        }
    }

    #[derive(Default)]
    struct Events {
        log: Mutex<Vec<String>>,
    }

    impl AiListener for Events {
        fn on_draft(&self, text: String) {
            if !text.is_empty() {
                self.log.lock().unwrap().push(format!("draft:{text}"));
            }
        }
        fn on_thinking(&self, _: String) {}
        fn on_tool_started(&self, name: String) {
            self.log.lock().unwrap().push(format!("tool:{name}"));
        }
        fn on_message(&self, m: ChatMessage) {
            self.log.lock().unwrap().push(format!("msg:{}", m.role));
        }
        fn on_finished(&self, o: AiOutcome) {
            self.log.lock().unwrap().push(format!("done:{}", o.text));
        }
        fn on_failed(&self, message: String, _: bool) {
            self.log.lock().unwrap().push(format!("failed:{message}"));
        }
    }

    fn options() -> AiOptions {
        AiOptions {
            providers_json: Some(
                json!([{ "id": "fake", "name": "Fake", "base": "https://ai.test/v1", "key": "geheim" }]).to_string(),
            ),
            provider_id: Some("fake".into()),
            model: Some("fake-model".into()),
            ..Default::default()
        }
    }

    struct Words;

    impl TextEmbedder for Words {
        fn model_key(&self) -> String {
            "words".into()
        }
        fn provider_id(&self) -> String {
            "test".into()
        }
        fn embed(&self, texts: Vec<String>) -> Result<Vec<Vec<f32>>, EmbedFailure> {
            Ok(texts
                .iter()
                .map(|t| {
                    let t = t.to_lowercase();
                    vec![t.matches("integral").count() as f32, t.matches("katze").count() as f32, 0.01]
                })
                .collect())
        }
    }

    #[test]
    fn lauf_mit_werkzeug_legt_seite_an_und_rag_kontext() {
        let core = ImpalaCore::open_in_memory().unwrap();
        core.create_page("Analysis".into(), "Das Integral einer Funktion misst die Fläche.".into(), None, None)
            .unwrap();
        core.create_page("Haustiere".into(), "Die Katze schläft.".into(), None, None).unwrap();
        let search = SemanticSearch::new(core.clone(), Arc::new(Words));
        search.update(0).unwrap();

        let net = Provider::default();
        let ai = AiAssistant::start(&core, net.clone(), options(), None, Some(search));
        let events = Arc::new(Events::default());
        let req = AiRunRequest {
            text: "Was steht in meinen Notizen über das Integral? Lege dazu eine Zusammenfassung an.".into(),
            use_rag: true,
            utc_offset_minutes: 60,
            ..Default::default()
        };
        let out = ai.run(req, Some(events.clone())).unwrap();
        assert_eq!(out.text, "Seite angelegt.");

        // Das Werkzeug lief im Kern: neue Seite mit Inhalt.
        let pages = core.children_of(None, None);
        let neu = pages.iter().find(|p| p.title == "Zusammenfassung").expect("Seite angelegt");
        assert_eq!(core.page(neu.id.clone()).unwrap().content, "Integral = Fläche");

        // Anfrage 1 enthält die Werkzeuge und den RAG-Treffer der richtigen Seite; Schlüssel nur im Header-Weg.
        let bodies = net.bodies.lock().unwrap();
        assert_eq!(bodies.len(), 2);
        let first = bodies[0].to_string();
        assert!(
            first.contains("\"name\":\"change\"") && first.contains("[Analysis]") && !first.contains("[Haustiere]"),
            "{first}"
        );
        assert!(!first.contains("geheim"));
        // Anfrage 2 trägt das Werkzeug-Ergebnis.
        assert!(bodies[1].to_string().contains("changedObjects"));
        drop(bodies);

        // Chat gespeichert: Nutzer, Denktext, Chip, Änderungs-Karte (mit Rückgängig), Antwort.
        let chat = core.chat(out.chat_id.clone()).unwrap();
        let roles: Vec<&str> = chat.messages.iter().map(|m| m.role.as_str()).collect();
        assert_eq!(roles, ["user", "thought", "tool", "assistant", "edit"], "{roles:?}");
        let log = events.log.lock().unwrap().clone();
        assert!(log.contains(&"tool:change".to_string()) && log.iter().any(|l| l == "msg:edit"), "{log:?}");

        // Rückgängig über die Karte.
        let edit = chat.messages.iter().find(|m| m.role == "edit").unwrap().clone();
        core.undo_ai_change(chat.id.clone(), edit.mid.clone().unwrap()).unwrap();
        assert!(core.children_of(None, None).iter().all(|p| p.title != "Zusammenfassung"));
        assert_eq!(core.chat(chat.id).unwrap().messages.iter().find(|m| m.role == "edit").unwrap().undone, Some(true));
    }

    #[test]
    fn fehler_abbruch_und_async() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let ai = AiAssistant::start(&core, Provider::default(), options(), None, None);
        assert_eq!(ai.run(AiRunRequest::default(), None), Err(AiFailure::Other { reason: "Leere Nachricht.".into() }));

        // Fehlende Einrichtung: Fehler, aber die Nutzernachricht ist gesichert.
        let bad = AiAssistant::start(
            &core,
            Provider::default(),
            AiOptions { providers_json: Some("[{\"id\":\"x\",\"base\":\"\"}]".into()), ..options() },
            None,
            None,
        );
        let err = bad
            .run(AiRunRequest { text: "Hallo zusammen, wie geht es?".into(), ..Default::default() }, None)
            .unwrap_err();
        assert!(matches!(err, AiFailure::Other { .. }), "{err:?}");
        assert_eq!(core.chats().len(), 1);

        let events = Arc::new(Events::default());
        ai.clone().run_async(
            AiRunRequest { text: "Hallo zusammen, wie geht es?".into(), ..Default::default() },
            events.clone(),
        );
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while !events.log.lock().unwrap().iter().any(|l| l.starts_with("done:") || l.starts_with("failed:"))
            && std::time::Instant::now() < deadline
        {
            thread::sleep(std::time::Duration::from_millis(5));
        }
        assert!(events.log.lock().unwrap().iter().any(|l| l.starts_with("done:")), "{:?}", events.log.lock().unwrap());
    }

    #[test]
    fn ortszeit() {
        // 2026-10-28 13:05 UTC ist ein Mittwoch.
        let t = local_time(1_793_192_700_000, 60);
        assert_eq!((t.year, t.month, t.day, t.weekday, t.hour, t.minute), (2026, 10, 28, 3, 14, 5));
        let t = local_time(0, 0);
        assert_eq!((t.year, t.month, t.day, t.weekday), (1970, 1, 1, 4));
    }
}
