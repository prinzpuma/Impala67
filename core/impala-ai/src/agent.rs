//! Agent-Schleife: Modell antwortet oder ruft Werkzeuge → Ergebnisse zurück → weiter,
//! bis eine Antwort steht (höchstens [`MAX_STEPS`] Schritte). Ausgeführt werden die
//! Werkzeuge von der App über [`ToolExecutor`]; die Oberfläche erfährt alles über [`AgentEvent`].

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::Value;

use crate::chat::{ChatTurn, LlmProvider};
use crate::error::AiError;
use crate::js;
use crate::message::{Content, Message, Role, ToolCall, ToolDef, prune_run_history};
use crate::prompt::{
    ChatEntry, ChatSummary, LocalTime, PageContextInfo, RagHit, ToolMode, VISION_NOTE, Workspace, conversation,
    heft_tool_text, history_messages, model_switch_note, page_context_image, rag_context, split_history,
    summary_request, system_prompt, workspace_context,
};
use crate::stream::StreamUpdate;
use crate::tools::{
    CONFIRM_OPTIONS, REQUEST_TOOLS, cancelled_result, change_confirmation, normalize_ask_choice, request_tools_def,
    tool_detail,
};

pub const MAX_STEPS: usize = 12;
/// Längere Werkzeug-Ergebnisse werden gekürzt (UTF-16-Einheiten wie in JS).
const TOOL_RESULT_MAX: usize = 6000;
const CHIP_MAX: usize = 80;

/// Ergebnis eines Werkzeugs: JSON-Text fürs Modell (Schlüsselreihenfolge bleibt erhalten)
/// und optional ein Rückgängig-Satz für die Änderungs-Karte.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolOutput {
    pub json: String,
    pub undo: Option<Value>,
}

impl ToolOutput {
    pub fn new(json: impl Into<String>) -> Self {
        ToolOutput { json: json.into(), undo: None }
    }
}

/// Heftseite für `view_heft_page`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeftPage {
    /// Seitennummer ab 1; 0, wenn sie nicht ermittelt werden konnte.
    pub page_no: u32,
    pub result: Result<HeftPageContent, String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeftPageContent {
    pub texts: Vec<String>,
    pub ocr_text: String,
    pub image_url: String,
}

/// Zugriff auf App-Zustand für Werkzeuge und Rückfragen.
pub trait ToolExecutor {
    /// Führt ein angebotenes Werkzeug aus. `Err`: Fehlermeldung fürs Modell.
    fn run(&mut self, name: &str, args: &Value) -> Result<ToolOutput, String>;
    /// Anklickbare Rückfrage an den Nutzer; `None` = abgebrochen.
    fn ask(&mut self, question: &str, options: &[String]) -> Option<String>;
    /// Heftseite (Titel leer = aktuelles Heft; Seite ab 1, leer = aktuelle).
    fn heft_page(&mut self, title: Option<&str>, page: Option<f64>) -> HeftPage;
}

/// Neue Einträge im Chat (in dieser Reihenfolge anzeigen und speichern).
#[derive(Debug, Clone, PartialEq)]
pub enum AgentItem {
    Thought(String),
    Assistant {
        content: String,
        model: String,
    },
    Tool {
        name: String,
        detail: String,
        error: bool,
    },
    /// Änderungs-Karte mit Rückgängig-Satz.
    Change {
        summary: String,
        undo: Value,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub enum AgentEvent<'a> {
    /// Entwurf der laufenden Antwort (ganzer Text; leer = zurücksetzen).
    Draft(&'a str),
    Thinking(&'a str),
    /// Werkzeug startet (Statuszeile).
    ToolStarted(&'a str),
    Item(AgentItem),
}

/// Abbruch über Thread-Grenzen (⏹ in der Oberfläche).
#[derive(Debug, Clone, Default)]
pub struct CancelToken(Arc<AtomicBool>);

impl CancelToken {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Relaxed);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }
}

/// Eingaben eines Laufs.
#[derive(Debug, Clone)]
pub struct AgentRequest<'a> {
    /// Ganzer Chat; die neue Nutzernachricht (mit Anhängen) steht schon am Ende.
    pub chat: &'a [ChatEntry],
    pub workspace: &'a Workspace,
    /// Treffer der automatischen Suche (nur wenn [`crate::rag_query`] etwas lieferte).
    pub rag_hits: &'a [RagHit],
    /// Geöffnete Seite (ID, Titel) – ihre Treffer sind schon im Kontext.
    pub active_page: Option<(&'a str, &'a str)>,
    /// Volle Werkzeugliste der App.
    pub tools: &'a [ToolDef],
    pub always_send_tools: bool,
    pub custom_instructions: &'a str,
    pub embed_model: &'a str,
    pub now: LocalTime,
}

/// Zustand je Chat, der Läufe überdauert.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AgentSession {
    pub summary: Option<ChatSummary>,
    pub tools_unlocked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentOutcome {
    pub text: String,
    pub page_context: Option<PageContextInfo>,
}

/// Zusammenfassung älterer Nachrichten; Fehler (außer Abbruch) lassen sie still weg.
fn summarize(
    provider: &dyn LlmProvider,
    overflow: &[ChatEntry],
    session: &mut AgentSession,
) -> Result<String, AiError> {
    if overflow.is_empty() {
        return Ok(String::new());
    }
    let messages = match summary_request(overflow, session.summary.as_ref()) {
        Ok(m) => m,
        Err(cached) => return Ok(cached),
    };
    let cached = session.summary.as_ref().filter(|c| overflow.len() >= c.count).map(|c| c.text.clone());
    match provider.chat(ChatTurn { messages: &messages, tools: &[], stream: false }, &mut |_| true) {
        Ok(msg) => {
            let text = js::trim(&msg.content).to_owned();
            if text.is_empty() {
                return Ok(cached.unwrap_or_default());
            }
            session.summary = Some(ChatSummary { count: overflow.len(), text: text.clone() });
            Ok(text)
        }
        Err(AiError::Aborted) => Err(AiError::Aborted),
        Err(_) => Ok(String::new()),
    }
}

fn args_of(call: &ToolCall) -> Option<Value> {
    let raw = js::trim(&call.arguments);
    if raw.is_empty() {
        return Some(Value::Object(Default::default()));
    }
    serde_json::from_str::<Value>(raw).ok().filter(Value::is_object)
}

fn error_json(message: &str) -> String {
    js::object(&[("error", Value::from(message))])
}

fn field<'v>(json: &'v Option<Value>, key: &str) -> Option<&'v Value> {
    json.as_ref().and_then(|v| v.get(key))
}

struct Run<'a> {
    provider: &'a dyn LlmProvider,
    executor: &'a mut dyn ToolExecutor,
    cancel: &'a CancelToken,
    on_event: &'a mut dyn FnMut(AgentEvent<'_>),
    messages: Vec<Message>,
    edits: Vec<AgentItem>,
}

impl Run<'_> {
    fn item(&mut self, item: AgentItem) {
        (self.on_event)(AgentEvent::Item(item));
    }

    fn flush_edits(&mut self) {
        for e in std::mem::take(&mut self.edits) {
            self.item(e);
        }
    }

    fn fail(&mut self, e: AiError) -> AiError {
        self.flush_edits();
        e
    }

    fn check(&mut self) -> Result<(), AiError> {
        if self.cancel.is_cancelled() { Err(self.fail(AiError::Aborted)) } else { Ok(()) }
    }

    /// Chip (außer `detail == None`) und Ergebnis-Nachricht.
    fn finish_tool(&mut self, call: &ToolCall, detail: Option<&str>, json: String) {
        if let Some(detail) = detail {
            let parsed = serde_json::from_str::<Value>(&json).ok();
            let error = field(&parsed, "error").is_some_and(js::truthy);
            let detail = js::head16(detail, CHIP_MAX).to_owned();
            self.item(AgentItem::Tool { name: call.name.clone(), detail, error });
        }
        let content = if js::len16(&json) > TOOL_RESULT_MAX {
            js::object(&[
                ("gekuerzt", Value::Bool(true)),
                (
                    "hinweis",
                    Value::from(
                        "Ergebnis war zu lang und wurde gekürzt — bei Bedarf gezielter nachfragen (Filter, Suchbegriff, limit).",
                    ),
                ),
                ("auszug", Value::from(js::head16(&json, TOOL_RESULT_MAX))),
            ])
        } else {
            json
        };
        self.messages.push(Message::tool_result(&call.id, content));
    }

    fn run_tool(&mut self, name: &str, args: &Value) -> (String, Option<Value>) {
        match self.executor.run(name, args) {
            Ok(out) => (out.json, out.undo),
            Err(e) => (error_json(&e), None),
        }
    }

    fn record_change(&mut self, json: &str, undo: Option<Value>) {
        let Some(undo) = undo else { return };
        let parsed = serde_json::from_str::<Value>(json).ok();
        let n = js::first_truthy([field(&parsed, "operations")]);
        let summary = format!("{} KI-Änderung(en)", if n.is_empty() { "0" } else { &n });
        self.edits.push(AgentItem::Change { summary, undo });
    }

    fn ask(&mut self, question: &str, options: &[String]) -> Result<String, AiError> {
        match self.executor.ask(question, options) {
            Some(answer) if !self.cancel.is_cancelled() => Ok(answer),
            _ => Err(self.fail(AiError::Aborted)),
        }
    }

    fn heft_page(&mut self, call: &ToolCall, args: &Value, pending: &mut Vec<Message>) {
        // view_heft_page {title, page}; das ältere get_heft_page_image {page_title, heft_page}.
        let (title, page) = if call.name == "view_heft_page" {
            (args.get("title"), args.get("page"))
        } else {
            (args.get("page_title"), args.get("heft_page"))
        };
        let title = title.filter(|v| js::truthy(v)).map(js::string);
        let page = page.filter(|v| js::truthy(v)).and_then(|v| v.as_f64().or_else(|| js::string(v).parse().ok()));
        let page = self.executor.heft_page(title.as_deref(), page);
        let label = title.clone().unwrap_or_else(|| "aktuelles Heft".into());
        let detail = if page.page_no > 0 { format!("{label} · Seite {}", page.page_no) } else { label };
        let json = match page.result {
            Ok(content) => {
                let hinweis = format!(
                    "Heftseite {} folgt direkt nach den Tool-Ergebnissen als Bild-Nachricht. Falls du Bilder technisch nicht sehen kannst (kein Vision-Modell), sage das kurz und ehrlich.",
                    page.page_no
                );
                let text = heft_tool_text(&content.texts, &content.ocr_text);
                let mut fields = vec![("ok", Value::Bool(true)), ("hinweis", Value::from(hinweis))];
                if !text.is_empty() {
                    fields.push(("content", Value::from(text)));
                }
                let from = title.as_ref().map(|t| format!(" aus „{t}“")).unwrap_or_default();
                pending.push(Message::user_image(
                    format!("[Automatisch angehängt: Heftseite {} als Bild{from}]", page.page_no),
                    content.image_url,
                ));
                js::object(&fields)
            }
            Err(e) => error_json(&e),
        };
        self.finish_tool(call, Some(&detail), json);
    }
}

/// Ein Agent-Lauf. Gibt die Antwort zurück; bei zu vielen Schritten einen Hinweistext.
pub fn run_agent(
    provider: &dyn LlmProvider,
    executor: &mut dyn ToolExecutor,
    req: &AgentRequest<'_>,
    session: &mut AgentSession,
    cancel: &CancelToken,
    on_event: &mut dyn FnMut(AgentEvent<'_>),
) -> Result<AgentOutcome, AiError> {
    let info = provider.model();
    let (overflow, recent) = {
        let conv = conversation(req.chat);
        let (o, r) = split_history(&conv, info.family);
        (o.to_vec(), r.to_vec())
    };
    let mut history = history_messages(&recent);
    let meta_only = !req.always_send_tools && !session.tools_unlocked;
    let meta_def = [request_tools_def()];
    let mut tools: &[ToolDef] = if meta_only { &meta_def } else { req.tools };
    let rag = rag_context(req.rag_hits, req.active_page);
    let summary = summarize(provider, &overflow, session)?;
    if let Some(image) = page_context_image(req.workspace) {
        history.push(image);
    }
    let vision = if history.iter().any(|m| matches!(m.content, Some(Content::Parts(_)))) { VISION_NOTE } else { "" };
    let note = [model_switch_note(req.chat, &info.model), vision.to_owned()]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    let system = |mode| Message::system(system_prompt(mode, &note, req.custom_instructions, req.now));
    let (context, page_context) = workspace_context(req.workspace, &rag, &summary, info.family);
    let mut messages = vec![system(if meta_only { ToolMode::Meta } else { ToolMode::Full })];
    let last = history.pop();
    messages.extend(history);
    messages.push(context);
    messages.extend(last);

    let mut run = Run { provider, executor, cancel, on_event, messages, edits: vec![] };
    let mut nudged = false;
    for _ in 0..MAX_STEPS {
        run.check()?;
        (run.on_event)(AgentEvent::Draft(""));
        (run.on_event)(AgentEvent::Thinking(""));
        prune_run_history(&mut run.messages);
        let turn = ChatTurn { messages: &run.messages, tools, stream: true };
        let (cancel, on_event) = (run.cancel, &mut *run.on_event);
        let reply = run.provider.chat(turn, &mut |u| {
            match u {
                StreamUpdate::Content(t) => on_event(AgentEvent::Draft(t)),
                StreamUpdate::Reasoning(t) => on_event(AgentEvent::Thinking(t)),
            }
            !cancel.is_cancelled()
        });
        let message = reply.map_err(|e| run.fail(e))?;
        run.messages.push(message.to_message(info.family));
        let reasoning = js::trim(message.reasoning.as_deref().unwrap_or_default()).to_owned();
        let content = js::trim(&message.content).to_owned();
        if message.tool_calls.is_empty() {
            if content.is_empty() && !nudged {
                nudged = true;
                tools = &[];
                if !reasoning.is_empty() {
                    run.item(AgentItem::Thought(reasoning));
                }
                (run.on_event)(AgentEvent::Draft(""));
                (run.on_event)(AgentEvent::Thinking(""));
                run.messages.push(Message::user("Deine Antwort war leer. Sage in ein bis zwei Sätzen konkret, was du getan oder herausgefunden hast — ohne weiteren Werkzeug-Aufruf."));
                continue;
            }
            if !reasoning.is_empty() {
                run.item(AgentItem::Thought(reasoning));
            }
            let text = if !content.is_empty() {
                content
            } else if message.reasoning.as_deref().is_some_and(|r| !r.is_empty()) {
                "Aktion abgeschlossen.".into()
            } else {
                "(Keine Antwort vom Modell erhalten.)".into()
            };
            (run.on_event)(AgentEvent::Draft(""));
            (run.on_event)(AgentEvent::Thinking(""));
            run.item(AgentItem::Assistant { content: text.clone(), model: info.model.clone() });
            run.flush_edits();
            return Ok(AgentOutcome { text, page_context });
        }
        if !reasoning.is_empty() {
            run.item(AgentItem::Thought(reasoning));
        }
        if !content.is_empty() {
            run.item(AgentItem::Assistant { content, model: info.model.clone() });
        }
        (run.on_event)(AgentEvent::Thinking(""));

        let mut pending_images = vec![];
        for call in &message.tool_calls {
            run.check()?;
            let name = call.name.as_str();
            let Some(args) = args_of(call) else {
                let msg = format!(
                    "Die Argumente von {name} sind kein gültiges JSON (vermutlich abgeschnitten) — bitte den Aufruf mit vollständigen Argumenten wiederholen."
                );
                run.finish_tool(call, Some("ungültige Argumente"), error_json(&msg));
                continue;
            };
            (run.on_event)(AgentEvent::ToolStarted(name));
            if name == "view_heft_page" || name == "get_heft_page_image" {
                run.heft_page(call, &args, &mut pending_images);
                continue;
            }
            if name == REQUEST_TOOLS {
                session.tools_unlocked = true;
                tools = req.tools;
                run.messages[0] = system(ToolMode::Full);
                let ok = js::object(&[
                    ("ok", Value::Bool(true)),
                    ("hinweis", Value::from("Alle Werkzeuge sind jetzt in dieser Anfrage verfügbar.")),
                ]);
                run.finish_tool(call, Some("Werkzeuge freigeschaltet"), ok);
                continue;
            }
            // Nur angebotene Werkzeuge laufen – ein erfundener Name (etwa delete_page aus altem
            // Verlauf) käme sonst an der Bestätigung von „change“ vorbei.
            if !req.tools.iter().any(|t| t.name == name) {
                let names: Vec<&str> = req.tools.iter().map(|t| t.name.as_str()).collect();
                let msg = format!("Unbekanntes Werkzeug „{name}“. Verfügbar: {}.", names.join(", "));
                run.finish_tool(call, Some("unbekanntes Werkzeug"), error_json(&msg));
                continue;
            }
            if name == "change" {
                let (json, undo, detail) = match change_confirmation(&args) {
                    None => {
                        let (json, undo) = run.run_tool(name, &args);
                        (json, undo, Some(tool_detail(name, &args, req.embed_model)))
                    }
                    Some(c) => {
                        let options = CONFIRM_OPTIONS.map(String::from);
                        let answer = run.ask(&c.question, &options)?;
                        if answer.to_lowercase().starts_with("ja") {
                            let (json, undo) = run.run_tool(name, &args);
                            let cancelled =
                                field(&serde_json::from_str(&json).ok(), "cancelled").is_some_and(js::truthy);
                            (json, undo, (!cancelled).then_some(c.detail))
                        } else {
                            (cancelled_result(c.operations), None, None)
                        }
                    }
                };
                run.finish_tool(call, detail.as_deref(), json.clone());
                run.record_change(&json, undo);
                continue;
            }
            if name == "ask_choice" {
                match normalize_ask_choice(&args) {
                    Err(e) => run.finish_tool(call, Some(&e), error_json(&e)),
                    Ok(choice) => {
                        let answer = run.ask(&choice.question, &choice.options)?;
                        let json =
                            js::object(&[("answer", Value::from(answer)), ("question", Value::from(choice.question))]);
                        run.finish_tool(call, None, json);
                    }
                }
                continue;
            }
            let (json, _) = run.run_tool(name, &args);
            run.finish_tool(call, Some(&tool_detail(name, &args, req.embed_model)), json);
        }
        if !pending_images.is_empty() {
            if run.messages.last().is_some_and(|m| m.role == Role::Tool) {
                run.messages.push(Message::text(Role::Assistant, "Heftseite als Bild empfangen."));
            }
            run.messages.extend(pending_images);
        }
    }
    let text = "(Abgebrochen: zu viele Tool-Schritte.)".to_owned();
    (run.on_event)(AgentEvent::Draft(""));
    (run.on_event)(AgentEvent::Thinking(""));
    run.item(AgentItem::Assistant { content: text.clone(), model: String::new() });
    run.flush_edits();
    Ok(AgentOutcome { text, page_context })
}

/// Nachrichten zum Umformulieren: System-Prompt ohne Werkzeuge, Verlauf, Anweisung.
pub fn refine_messages(
    history: &[Message],
    instruction: &str,
    custom_instructions: &str,
    now: LocalTime,
) -> Vec<Message> {
    let mut messages = vec![Message::system(system_prompt(ToolMode::None, "", custom_instructions, now))];
    messages.extend_from_slice(history);
    messages.push(Message::user(instruction));
    messages
}

/// Antwort umformulieren (ohne Werkzeuge, gestreamt).
pub fn refine(
    provider: &dyn LlmProvider,
    history: &[Message],
    instruction: &str,
    custom_instructions: &str,
    now: LocalTime,
    on_update: &mut dyn FnMut(StreamUpdate<'_>) -> bool,
) -> Result<String, AiError> {
    let messages = refine_messages(history, instruction, custom_instructions, now);
    Ok(provider.chat(ChatTurn { messages: &messages, tools: &[], stream: true }, on_update)?.content)
}
