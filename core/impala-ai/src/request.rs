//! Anfragen an die Anbieter bauen (reine Funktionen, ohne Netz testbar).

use impala_net::{Method, Request};
use serde_json::{Map, Value, json};

use crate::error::AiError;
use crate::js;
use crate::message::{Message, ToolDef, normalize_for_api};
use crate::provider::{ChatConfig, Family, SYNC_PROTOCOL, SYNC_PROTOCOL_HEADER, ThinkingCapabilities, clean_base};

/// Zugang zum Cloudflare-Worker („Impala AI“), abgeleitet aus dem Sync-Schlüssel.
#[derive(Clone, PartialEq, Eq)]
pub struct CloudflareAuth {
    pub user_id: String,
    pub auth_token: String,
    /// Sync-Adresse, falls die Quelle keine eigene Basis hat (sonst [`crate::DEFAULT_WORKER_URL`]).
    pub fallback_base: String,
}

impl std::fmt::Debug for CloudflareAuth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CloudflareAuth")
            .field("user_id", &self.user_id)
            .field("fallback_base", &self.fallback_base)
            .finish()
    }
}

/// Gerätebezogene Optionen einer Chat-Anfrage.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RequestOptions {
    pub cloudflare: Option<CloudflareAuth>,
    /// Pseudonyme Installations-ID für OpenAI (`safety_identifier`).
    pub safety_id: Option<String>,
}

/// Ein Versuch: Werkzeuge (leer = keine), Streaming, Thinking-Zusätze.
#[derive(Debug, Clone, Copy)]
pub struct Attempt<'a> {
    pub tools: &'a [ToolDef],
    pub stream: bool,
    pub thinking_extras: bool,
}

/// Körper von `/chat/completions` (OpenAI-kompatibel; Gemini über die OpenAI-Schnittstelle).
pub fn chat_body(config: &ChatConfig, messages: &[Message], attempt: Attempt<'_>, opts: &RequestOptions) -> Value {
    let family = config.family();
    let mut body = Map::new();
    body.insert("model".into(), Value::from(config.model.as_str()));
    body.insert("messages".into(), normalize_for_api(messages).iter().map(Message::to_json).collect());
    // Gemini 3.x, OpenAI und der Worker lehnen Sampling-Regler ab; lokale Server behalten 0,4.
    if !matches!(family, Family::Google | Family::Openai | Family::Cloudflare) {
        body.insert("temperature".into(), json!(0.4));
    }
    // Abweichung von JS: ohne ID (kein Speicher) entfällt das Feld statt "" zu senden.
    if let Some(id) = opts.safety_id.as_deref().filter(|id| !id.is_empty() && is_openai_api(&config.base)) {
        body.insert("safety_identifier".into(), Value::from(id));
    }
    if attempt.thinking_extras {
        let cap = ThinkingCapabilities::declared(config);
        if let Some(off) = cap.off_effort {
            // OpenAI: „none“ ist dort der Standard und wird nicht gesendet; Gemini steuert über extra_body.
            if !config.thinking_enabled && family != Family::Google && !(family == Family::Openai && off == "none") {
                body.insert("reasoning_effort".into(), Value::from(off));
            }
        }
        if family == Family::Google && cap.include_thoughts {
            body.insert("extra_body".into(), json!({ "google": { "thinking_config": { "include_thoughts": true } } }));
        }
    }
    if !attempt.tools.is_empty() {
        body.insert("tools".into(), attempt.tools.iter().map(|t| t.to_json(family)).collect());
        body.insert("tool_choice".into(), Value::from("auto"));
    }
    if attempt.stream {
        body.insert("stream".into(), Value::Bool(true));
    }
    Value::Object(body)
}

fn is_openai_api(base: &str) -> bool {
    let lower = base.to_lowercase();
    lower.strip_prefix("https://api.openai.com").is_some_and(|r| r.is_empty() || r.starts_with('/'))
}

fn auth(req: Request, key: &str) -> Request {
    if key.is_empty() { req } else { req.header("Authorization", format!("Bearer {key}")) }
}

/// HTTP-Anfrage für einen Chat-Versuch. Cloudflare geht über `/api/ai` des Workers
/// (eigene Zugangsdaten, nur die Felder, die der Worker kennt).
pub fn chat_request(config: &ChatConfig, body: &Value, opts: &RequestOptions) -> Result<Request, AiError> {
    if config.family() == Family::Cloudflare {
        let auth =
            opts.cloudflare.as_ref().ok_or_else(|| AiError::Other("Cloudflare Sync ist nicht eingerichtet.".into()))?;
        let mut payload = Map::new();
        for key in ["model", "messages", "tools", "tool_choice", "stream", "reasoning_effort"] {
            if let Some(v) = body.get(key) {
                payload.insert(key.into(), v.clone());
            }
        }
        let target = if config.base.is_empty() { auth.fallback_base.as_str() } else { config.base.as_str() };
        let url = format!("{}/api/ai?user={}", clean_base(js::trim(target)), js::encode_uri_component(&auth.user_id));
        return Ok(Request::new(Method::Post, url)
            .header("Authorization", format!("Bearer {}", auth.auth_token))
            .header("X-User-Id", auth.user_id.as_str())
            .header(SYNC_PROTOCOL_HEADER, SYNC_PROTOCOL.to_string())
            .json_text(Value::Object(payload).to_string()));
    }
    if config.base.is_empty() {
        return Err(AiError::Other("Kein KI-Server konfiguriert (Einstellungen → KI).".into()));
    }
    let req = Request::new(Method::Post, format!("{}/chat/completions", config.base));
    Ok(auth(req.header("Content-Type", "application/json"), &config.key).body(body.to_string().into_bytes()))
}

/// `GET /models` einer Quelle (der Worker verlangt die Protokoll-Kopfzeile).
pub fn models_request(base: &str, key: &str, cloudflare: bool) -> Request {
    let req = auth(Request::new(Method::Get, format!("{}/models", clean_base(base))), key);
    if cloudflare { req.header(SYNC_PROTOCOL_HEADER, SYNC_PROTOCOL.to_string()) } else { req }
}

/// Modell-IDs aus `{data:[{id}]}`.
pub fn parse_models(body: &[u8]) -> Result<Vec<String>, AiError> {
    let json: Value =
        serde_json::from_slice(body).map_err(|e| AiError::Other(format!("Ungültige Modell-Liste: {e}")))?;
    Ok(json
        .get("data")
        .and_then(Value::as_array)
        .map(|list| list.iter().filter_map(|m| js::non_empty_str(m.get("id")).map(str::to_owned)).collect())
        .unwrap_or_default())
}

/// `POST /embeddings` (OpenAI-kompatibel).
pub fn embeddings_request(base: &str, key: &str, model: &str, texts: &[String]) -> Request {
    let body = json!({ "model": model, "input": texts });
    auth(
        Request::new(Method::Post, format!("{}/embeddings", clean_base(base)))
            .header("Content-Type", "application/json"),
        key,
    )
    .body(body.to_string().into_bytes())
}

/// Vektoren aus `{data:[{embedding}]}`; unvollständige Antworten sind ein Fehler.
pub fn parse_embeddings(body: &[u8], expected: usize) -> Result<Vec<Vec<f32>>, AiError> {
    let json: Value =
        serde_json::from_slice(body).map_err(|e| AiError::Other(format!("Ungültige Embedding-Antwort: {e}")))?;
    let data = json
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| AiError::Other("Unerwartete Antwort der Embedding-Quelle (kein data-Feld).".into()))?;
    let vectors: Vec<Option<Vec<f32>>> = data
        .iter()
        .map(|d| {
            let v = d.get("embedding")?.as_array()?;
            let out: Option<Vec<f32>> = v.iter().map(|x| x.as_f64().map(|f| f as f32)).collect();
            out.filter(|o| !o.is_empty())
        })
        .collect();
    if vectors.len() != expected || vectors.iter().any(Option::is_none) {
        return Err(AiError::Other(format!(
            "Embedding-Quelle lieferte unvollstaendige Vektoren ({}/{expected}).",
            vectors.len()
        )));
    }
    Ok(vectors.into_iter().flatten().collect())
}
