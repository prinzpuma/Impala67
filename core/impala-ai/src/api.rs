//! Weitere Aufrufe der Anbieter-APIs: Modell-Liste, Verbindungstest, Embeddings.

use impala_net::{HttpClient, NetError};

use crate::error::AiError;
use crate::provider::{
    LOCAL_MODEL_PREFIX, LOCAL_PROVIDER_ID, Provider, clean_base, is_cloudflare_base, model_providers,
};
use crate::request::{embeddings_request, models_request, parse_embeddings, parse_models};

/// Wo die Quellen-Erkennung nachsieht, ob eine Adresse der Cloudflare-Worker ist.
#[derive(Debug, Clone, Copy)]
pub struct Sources<'a> {
    pub providers: &'a [Provider],
    /// Eingerichtete Sync-Adresse (leer = keine).
    pub sync_url: &'a str,
}

const MODELS_TIMEOUT_S: u64 = 5;

/// Modell-IDs einer Quelle.
pub fn model_ids(client: &dyn HttpClient, base: &str, key: &str, sources: Sources<'_>) -> Result<Vec<String>, AiError> {
    let req = models_request(base, key, is_cloudflare_base(base, sources.sync_url, sources.providers));
    let res = client.send(&req).map_err(|e| match e {
        NetError::Timeout => {
            AiError::Other(format!("Zeitüberschreitung nach {MODELS_TIMEOUT_S} s — der Server hat nicht geantwortet."))
        }
        NetError::Aborted => AiError::Aborted,
        NetError::Connect(m) | NetError::Other(m) => AiError::Network(m),
    })?;
    if !res.is_success() {
        return Err(AiError::http(res.status, &res.text(), 0));
    }
    parse_models(&res.body)
}

/// Gefundenes Modell samt Quelle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListedModel {
    pub id: String,
    pub provider_id: String,
}

/// Modelle aller abfragbaren Quellen; Fehler nur, wenn alle scheitern.
pub fn list_models(client: &dyn HttpClient, sources: Sources<'_>) -> Result<Vec<ListedModel>, AiError> {
    let mut found = vec![];
    let mut first_error = None;
    let mut any_ok = false;
    for p in model_providers(sources.providers) {
        match model_ids(client, &p.base, &p.key, sources) {
            Ok(ids) => {
                any_ok = true;
                found.extend(ids.into_iter().map(|id| ListedModel { id, provider_id: p.id.clone() }));
            }
            Err(e) => {
                first_error.get_or_insert(e);
            }
        }
    }
    match first_error {
        Some(e) if found.is_empty() && !any_ok => Err(e),
        _ => Ok(found),
    }
}

/// Ergebnis des Verbindungstests in den Einstellungen.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PingResult {
    pub ok: bool,
    pub models: usize,
    pub status: Option<u16>,
    /// Vorschlag, wenn der Server erst unter `…/v1` antwortet.
    pub suggested_base: Option<String>,
    pub error: Option<String>,
}

fn has_version_segment(base: &str) -> bool {
    let lower = base.to_lowercase();
    lower.match_indices("/v").any(|(i, _)| lower[i + 2..].starts_with(|c: char| c.is_ascii_digit()))
}

/// Verbindungstest einer (noch ungespeicherten) Quelle.
pub fn ping_provider(client: &dyn HttpClient, provider: &Provider, sources: Sources<'_>) -> PingResult {
    let fail = |status, error: String| PingResult { status, error: Some(error), ..Default::default() };
    let trimmed = crate::js::trim(&provider.base);
    if trimmed.is_empty() {
        return fail(None, "Keine Server-URL eingetragen.".into());
    }
    let base = clean_base(trimmed);
    match model_ids(client, base, &provider.key, sources) {
        Ok(ids) => PingResult { ok: true, models: ids.len(), ..Default::default() },
        Err(AiError::Http { status, .. }) => {
            if matches!(status, 401 | 403) {
                return fail(
                    Some(status),
                    format!("Server erreichbar, aber der API-Key fehlt oder ist ungültig (HTTP {status})."),
                );
            }
            if status == 404 && !has_version_segment(base) {
                let v1 = format!("{base}/v1");
                if model_ids(client, &v1, &provider.key, sources).is_ok() {
                    return PingResult {
                        error: Some(format!(
                            "Unter dieser URL gibt es keinen /models-Endpunkt — mit „{v1}“ antwortet der Server."
                        )),
                        status: Some(404),
                        suggested_base: Some(v1),
                        ..Default::default()
                    };
                }
            }
            fail(
                Some(status),
                format!(
                    "Server antwortet mit HTTP {status}. Prüfe, ob die URL auf den OpenAI-kompatiblen API-Stamm zeigt (endet meist auf /v1)."
                ),
            )
        }
        Err(e) => {
            let msg = match e {
                AiError::Network(m) => m,
                other => other.to_string(),
            };
            fail(
                None,
                format!(
                    "Keine Verbindung: {msg}. Mögliche Ursachen: Server läuft nicht, falscher Port, oder CORS blockiert (LM Studio: Developer → „Enable CORS“ aktivieren)."
                ),
            )
        }
    }
}

/// Wohin ein Embedding-Auftrag geht.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmbedRoute {
    /// Lokales Modell im Gerät (`impala-search`).
    Local,
    /// Cloud-API über [`embed_remote`].
    Remote,
}

/// Lokal, wenn die Quelle „local“ gewählt ist oder das Modell `local:` heißt.
pub fn embed_route(embed_provider_id: &str, model: &str) -> Result<EmbedRoute, AiError> {
    if model.is_empty() {
        return Err(AiError::Other("Kein Embedding-Modell konfiguriert.".into()));
    }
    Ok(if embed_provider_id == LOCAL_PROVIDER_ID || model.starts_with(LOCAL_MODEL_PREFIX) {
        EmbedRoute::Local
    } else {
        EmbedRoute::Remote
    })
}

/// Quelle für Embeddings: gewählte, sonst die aktive Chat-Quelle.
pub fn embed_provider<'a>(
    providers: &'a [Provider],
    embed_provider_id: &str,
    active_provider_id: &str,
) -> Option<&'a Provider> {
    let by_id = |id: &str| (!id.is_empty()).then(|| providers.iter().find(|p| p.id == id)).flatten();
    by_id(embed_provider_id).or_else(|| by_id(active_provider_id)).or_else(|| providers.first())
}

/// Vektoren über `POST /embeddings` einer Cloud-API (für `impala-search`).
pub fn embed_remote(
    client: &dyn HttpClient,
    provider: &Provider,
    model: &str,
    texts: &[String],
) -> Result<Vec<Vec<f32>>, AiError> {
    if provider.base.is_empty() {
        return Err(AiError::Other("Keine Quelle für Embeddings konfiguriert (Einstellungen → KI).".into()));
    }
    let res = client.send(&embeddings_request(&provider.base, &provider.key, model, texts)).map_err(|e| match e {
        NetError::Timeout => AiError::Timeout { phase: "die Embedding-Antwort", ms: 30_000 },
        NetError::Aborted => AiError::Aborted,
        NetError::Connect(m) | NetError::Other(m) => AiError::Network(m),
    })?;
    if !res.is_success() {
        return Err(AiError::http(res.status, &res.text(), 0));
    }
    parse_embeddings(&res.body, texts.len())
}
