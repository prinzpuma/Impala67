//! [`LlmProvider`] und die Standard-Implementierung über HTTP-APIs ([`HttpProvider`])
//! samt Wiederholungen: Überlast/Netz erneut versuchen, inkompatible Thinking-Zusätze
//! oder Werkzeug-Schemas weglassen – aber nie, nachdem schon Text geliefert wurde.

use std::sync::LazyLock;
use std::sync::atomic::{AtomicU64, Ordering};

use impala_net::{HttpClient, NetError, Response};
use regex::Regex;

use crate::error::{AiError, retry_after_header};
use crate::message::{AssistantMessage, Message, Role, ToolDef};
use crate::provider::{ChatConfig, Family};
use crate::request::{Attempt, RequestOptions, chat_body, chat_request};
use crate::stream::{StreamParser, StreamUpdate, parse_completion};

/// Modell, das eine Antwort erzeugt (für Verlauf und modellabhängige Grenzen).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelInfo {
    pub model: String,
    pub family: Family,
}

/// Eine Chat-Anfrage: Verlauf, angebotene Werkzeuge (leer = keine), Streaming gewünscht?
#[derive(Debug, Clone, Copy)]
pub struct ChatTurn<'a> {
    pub messages: &'a [Message],
    pub tools: &'a [ToolDef],
    pub stream: bool,
}

/// Sprachmodell: Nachrichten + Werkzeuge → Antwort. Zwischenstände gehen an `on_update`;
/// gibt es `false` zurück, bricht die Anfrage ab ([`AiError::Aborted`]).
/// Plattformen (Apple Foundation Models, Gemini Nano) setzen eigene Implementierungen ein.
pub trait LlmProvider {
    fn model(&self) -> ModelInfo;
    fn chat(
        &self,
        turn: ChatTurn<'_>,
        on_update: &mut dyn FnMut(StreamUpdate<'_>) -> bool,
    ) -> Result<AssistantMessage, AiError>;
}

/// Wartezeit zwischen Versuchen (ms). Plattformen ohne `thread::sleep` (WASM) setzen eine eigene.
pub type Sleeper = Box<dyn Fn(u64) + Send + Sync>;
/// Aktuelle Zeit in ms seit 1970 (für `Retry-After` als Datum).
pub type Clock = Box<dyn Fn() -> u64 + Send + Sync>;

/// Anbieter über OpenAI-kompatible HTTP-APIs bzw. den Cloudflare-Worker.
pub struct HttpProvider<C: HttpClient> {
    client: C,
    config: ChatConfig,
    options: RequestOptions,
    sleep: Sleeper,
    clock: Clock,
    calls: AtomicU64,
}

/// Längere Sperren (z. B. Tageslimit) gehen direkt an den Nutzer statt in die Warteschleife.
const MAX_RETRY_WAIT_MS: u64 = 35_000;
const WAITS: [u64; 4] = [0, 750, 1800, 3500];
const REQUEST_MS: u64 = 60_000;

static COMPAT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"reasoning_content|thinking|reasoning|thought|extra_body|unknown.*(field|parameter)|unsupported.*(field|parameter)")
        .expect("gültiges Muster")
});
static SCHEMA_A: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"tool|function|schema").expect("gültiges Muster"));
static SCHEMA_B: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"unsupported|not support|invalid|unknown|reject|schema").expect("gültiges Muster"));

fn is_bad_request(e: &AiError) -> Option<String> {
    matches!(e.status(), Some(400 | 422)).then(|| e.to_string().to_lowercase())
}

fn is_tool_schema_error(e: &AiError, tools: &[ToolDef], tool_history: bool) -> bool {
    !tools.is_empty()
        && !tool_history
        && is_bad_request(e).is_some_and(|t| SCHEMA_A.is_match(&t) && SCHEMA_B.is_match(&t))
}

fn is_compatibility_error(e: &AiError, tools: &[ToolDef], tool_history: bool) -> bool {
    is_bad_request(e).is_some_and(|t| COMPAT.is_match(&t)) || is_tool_schema_error(e, tools, tool_history)
}

fn net_error(e: NetError) -> AiError {
    match e {
        NetError::Aborted => AiError::Aborted,
        NetError::Timeout => AiError::Timeout { phase: "die Verbindung", ms: REQUEST_MS },
        NetError::Connect(m) | NetError::Other(m) => AiError::Network(m),
    }
}

fn is_json(res: &Response) -> bool {
    res.header("content-type").is_some_and(|c| c.to_lowercase().contains("application/json"))
}

impl<C: HttpClient> HttpProvider<C> {
    pub fn new(client: C, config: ChatConfig, options: RequestOptions) -> Self {
        HttpProvider {
            client,
            config,
            options,
            sleep: Box::new(default_sleep),
            clock: Box::new(default_clock),
            calls: AtomicU64::new(0),
        }
    }

    pub fn with_sleep(mut self, sleep: Sleeper) -> Self {
        self.sleep = sleep;
        self
    }

    pub fn with_clock(mut self, clock: Clock) -> Self {
        self.clock = clock;
        self
    }

    pub fn config(&self) -> &ChatConfig {
        &self.config
    }

    pub fn client(&self) -> &C {
        &self.client
    }

    fn next_id(&self, i: usize) -> String {
        format!("call_{i}_{:08x}", self.calls.fetch_add(1, Ordering::Relaxed))
    }

    fn http_error(&self, res: &Response, body: &[u8]) -> AiError {
        let retry = retry_after_header(res.header("retry-after"), (self.clock)());
        AiError::http(res.status, &String::from_utf8_lossy(body), retry)
    }

    /// Ein Versuch; `produced` merkt sich, ob schon Inhalt angekommen ist.
    fn attempt(
        &self,
        turn: &ChatTurn<'_>,
        attempt: Attempt<'_>,
        produced: &mut bool,
        on_update: &mut dyn FnMut(StreamUpdate<'_>) -> bool,
    ) -> Result<AssistantMessage, AiError> {
        let body = chat_body(&self.config, turn.messages, attempt, &self.options);
        let req = chat_request(&self.config, &body, &self.options)?;
        let google = self.config.family() == Family::Google;
        let mut next_id = |i| self.next_id(i);
        if !attempt.stream {
            let res = self.client.send(&req).map_err(net_error)?;
            if !res.is_success() {
                return Err(self.http_error(&res, &res.body));
            }
            return parse_completion(&res.body, google, &mut next_id);
        }
        // Der Status steht erst nach dem Strom fest: Rohdaten für Fehler- und JSON-Antworten
        // aufheben. Fehlerkörper enthalten keine `data:`-Zeilen und erzeugen keine Ausgabe.
        let (mut parser, mut raw, mut failure, mut stopped) = (StreamParser::new(google), Vec::new(), None, false);
        let result = self.client.send_streaming(&req, &mut |chunk| {
            raw.extend_from_slice(chunk);
            if let Err(e) = parser.feed(chunk, &mut |u| stopped |= !on_update(u)) {
                failure = Some(e);
            }
            failure.is_none() && !stopped
        });
        *produced |= parser.produced();
        let res = match result {
            Err(e) => return Err(failure.unwrap_or_else(|| if stopped { AiError::Aborted } else { net_error(e) })),
            Ok(res) => res,
        };
        if !res.is_success() {
            return Err(self.http_error(&res, &raw));
        }
        if let Some(e) = failure {
            return Err(e);
        }
        if is_json(&res) {
            return parse_completion(&raw, google, &mut next_id);
        }
        let msg = parser.finish(&mut |u| stopped |= !on_update(u), &mut next_id)?;
        if stopped { Err(AiError::Aborted) } else { Ok(msg) }
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn default_sleep(ms: u64) {
    std::thread::sleep(std::time::Duration::from_millis(ms));
}

/// In WASM gibt es kein blockierendes Warten; die Plattform setzt [`HttpProvider::with_sleep`].
#[cfg(target_arch = "wasm32")]
fn default_sleep(_ms: u64) {}

fn default_clock() -> u64 {
    #[cfg(not(target_arch = "wasm32"))]
    {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
    }
    #[cfg(target_arch = "wasm32")]
    {
        0
    }
}

impl<C: HttpClient> LlmProvider for HttpProvider<C> {
    fn model(&self) -> ModelInfo {
        ModelInfo { model: self.config.model.clone(), family: self.config.family() }
    }

    fn chat(
        &self,
        turn: ChatTurn<'_>,
        on_update: &mut dyn FnMut(StreamUpdate<'_>) -> bool,
    ) -> Result<AssistantMessage, AiError> {
        let tool_history = turn.messages.iter().any(|m| m.role == Role::Tool || !m.tool_calls.is_empty());
        let may_drop_tools = !turn.tools.is_empty() && !tool_history;
        // (mit Werkzeugen?) je Versuch; der letzte lässt das Schema weg, falls das noch geht.
        let mut plans = vec![true, true, true, !may_drop_tools];
        let mut waits = WAITS.to_vec();
        let (mut extras, mut produced, mut last): (bool, bool, Option<AiError>) = (true, false, None);
        let mut i = 0;
        while i < plans.len() {
            // Ein Limit sagt nichts über das Tool-Schema – Werkzeuge bleiben dann erhalten.
            let with_tools = plans[i] || last.as_ref().and_then(AiError::status) == Some(429);
            if i > 0 {
                (self.sleep)(waits[i].max(last.as_ref().map_or(0, AiError::retry_after_ms)));
            }
            let tools = if with_tools { turn.tools } else { &[] };
            let attempt = Attempt { tools, stream: turn.stream, thinking_extras: extras };
            match self.attempt(&turn, attempt, &mut produced, on_update) {
                Ok(msg) => return Ok(msg),
                Err(e) => {
                    if e == AiError::Aborted || (e.status() == Some(429) && e.retry_after_ms() > MAX_RETRY_WAIT_MS) {
                        return Err(e);
                    }
                    let network = matches!(e, AiError::Network(_));
                    let server = e.status().is_some_and(|s| s >= 500 || s == 429);
                    let compat = is_compatibility_error(&e, tools, tool_history);
                    if produced || !(server || network || compat) {
                        return Err(e);
                    }
                    if is_tool_schema_error(&e, tools, tool_history) {
                        plans.truncate(i + 1);
                        plans.push(false);
                        waits[i + 1] = 0;
                    } else if compat {
                        extras = false;
                    }
                    last = Some(e);
                }
            }
            i += 1;
        }
        Err(last.unwrap_or_else(|| AiError::Other("KI-Anfrage fehlgeschlagen.".into())))
    }
}

/// Einfache Anfrage ohne Werkzeuge und Streaming (Zusammenfassungen, JSON-Aufgaben).
pub fn complete(provider: &dyn LlmProvider, prompt: &str, system: Option<&str>) -> Result<String, AiError> {
    let mut messages = Vec::with_capacity(2);
    if let Some(s) = system.filter(|s| !s.is_empty()) {
        messages.push(Message::system(s));
    }
    messages.push(Message::user(prompt));
    Ok(provider.chat(ChatTurn { messages: &messages, tools: &[], stream: false }, &mut |_| true)?.content)
}
