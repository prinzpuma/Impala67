//! Anfragen an den Cloudflare-Worker (`server/worker.js`) bauen und Antworten auswerten –
//! reine Funktionen, verschickt wird über [`impala_net::HttpClient`].

use impala_crypto::{StorageUsage, SyncCredentials, format_storage_usage};
use impala_net::{Method, Request, Response};
use serde_json::{Value, json};

use crate::SyncError;
use crate::js::{count_or, number, safe_integer, truthy};
use crate::wire::{CLOUD_SYNC_PROTOCOL, CLOUD_SYNC_PROTOCOL_HEADER};

/// Standard-Worker der App.
pub const DEFAULT_WORKER_URL: &str = "https://impala67-sync.joshuagayer1.workers.dev";
/// Pakete je Abruf.
pub const PAGE_LIMIT: u32 = 100;
/// Obergrenze des Servers je Datei (`MAX_BLOB_BYTES`).
pub const MAX_BLOB_BYTES: usize = 100_000_000;

/// Ein Konto auf einem Worker.
#[derive(Debug, Clone)]
pub struct Endpoint {
    base: String,
    user_id: String,
    auth_token: String,
    client_id: String,
}

impl Endpoint {
    /// `client_id`: zufällig je App-Start; der Server schickt einem Gerät sein eigenes
    /// „changed“ nicht zurück.
    pub fn new(base_url: &str, creds: &SyncCredentials, client_id: &str) -> Endpoint {
        Endpoint {
            base: base_url.trim().trim_end_matches('/').to_owned(),
            user_id: creds.user_id.clone(),
            auth_token: creds.auth_token.clone(),
            client_id: client_id.to_owned(),
        }
    }

    pub fn user_id(&self) -> &str {
        &self.user_id
    }

    pub fn client_id(&self) -> &str {
        &self.client_id
    }

    fn url(&self, endpoint: &str) -> String {
        let sep = if endpoint.contains('?') { '&' } else { '?' };
        format!("{}{endpoint}{sep}user={}", self.base, encode_uri_component(&self.user_id))
    }

    fn request(&self, method: Method, endpoint: &str) -> Request {
        Request::new(method, self.url(endpoint))
            .header("Authorization", format!("Bearer {}", self.auth_token))
            .header("X-User-Id", self.user_id.clone())
            .header("X-Impala-Client-Id", self.client_id.clone())
            .header(CLOUD_SYNC_PROTOCOL_HEADER, CLOUD_SYNC_PROTOCOL.to_string())
    }

    /// `GET /api/sync`: Pakete ab `since` (exklusiv).
    pub fn pull(&self, since: u64, limit: u32) -> Request {
        self.request(Method::Get, &format!("/api/sync?since={since}&limit={limit}"))
    }

    /// `POST /api/events` mit einem Körper aus [`crate::upload_bodies`].
    pub fn post_events(&self, body: String) -> Request {
        self.request(Method::Post, "/api/events").json_text(body)
    }

    /// `GET /api/blobs`, seitenweise über `cursor`.
    pub fn list_blobs(&self, cursor: &str) -> Request {
        let query = if cursor.is_empty() { String::new() } else { format!("?cursor={}", encode_uri_component(cursor)) };
        self.request(Method::Get, &format!("/api/blobs{query}"))
    }

    pub fn put_blob(&self, key: &str, iv: &str, bytes: Vec<u8>) -> Request {
        self.request(Method::Put, &format!("/api/blob/{key}"))
            .header("Content-Type", "application/octet-stream")
            .header("X-Impala-IV", iv)
            .body(bytes)
    }

    pub fn get_blob(&self, key: &str) -> Request {
        self.request(Method::Get, &format!("/api/blob/{key}"))
    }

    /// `POST /api/reset`: Generationsschnitt, löscht alle Pakete und Blobs des Kontos.
    pub fn reset(&self) -> Request {
        self.request(Method::Post, "/api/reset")
    }

    /// WebSocket-Adresse (`https:` → `wss:`, sonst `ws:`).
    pub fn ws_url(&self) -> String {
        let (scheme, host) = match self.base.strip_prefix("https://") {
            Some(host) => ("wss:", host),
            None => ("ws:", self.base.strip_prefix("http://").unwrap_or(&self.base)),
        };
        format!("{scheme}//{host}/ws?user={}", encode_uri_component(&self.user_id))
    }

    /// Erste Nachricht nach dem Öffnen des WebSockets.
    pub fn ws_auth_message(&self) -> String {
        impala_crypto::json::stringify(&json!({
            "type": "auth", "protocol": CLOUD_SYNC_PROTOCOL, "token": self.auth_token, "clientId": self.client_id,
        }))
    }
}

/// Alle 30 s, damit Proxys die Verbindung offen halten.
pub const WS_PING_MESSAGE: &str = r#"{"type":"ping"}"#;
pub const WS_PING_INTERVAL_MS: u64 = 30_000;

/// `encodeURIComponent`.
pub fn encode_uri_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn json_body(res: &Response) -> Result<Value, SyncError> {
    serde_json::from_slice(&res.body)
        .map_err(|_| SyncError::BadResponse(format!("Antwort des Sync-Servers ist kein JSON (Status {}).", res.status)))
}

/// `responseError`: Meldung des Servers (`{error}`), sonst `"<fallback> (Status N)"`.
pub fn response_error(res: &Response, fallback: &str) -> SyncError {
    let message = serde_json::from_slice::<Value>(&res.body)
        .ok()
        .and_then(|v| v.get("error").map(|e| impala_crypto::json::js_string(Some(e)).trim().to_owned()))
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| format!("{fallback} (Status {})", res.status));
    SyncError::Http { status: res.status, message }
}

/// `usage`/`limit` einer Antwort, falls gemeldet (`data.usage !== undefined`).
fn usage_of(data: &Value) -> Option<StorageUsage> {
    let usage = data.get("usage")?;
    Some(format_storage_usage(number(Some(usage)), Some(number(data.get("limit")))))
}

/// Eine Seite von `GET /api/sync`.
#[derive(Debug, Clone, PartialEq)]
pub struct SyncPage {
    /// Verschlüsselte Pakete `{seq, id, iv, data, size, created_at}` (Auswertung: [`crate::open_packets`]).
    pub packets: Vec<Value>,
    /// Höchste `seq` auf dem Server (`Number(data.maxSeq) || 0`).
    pub max_seq: f64,
    pub has_more: bool,
    /// `Number(data.generation) || 1`.
    pub generation: u64,
    pub usage: Option<StorageUsage>,
}

/// Was ein Abruf ergab.
#[derive(Debug, Clone, PartialEq)]
pub enum PullResponse {
    Page(SyncPage),
    /// 410: Ein Paket fehlt in R2 – die Cloud wird gerade neu aufgebaut (dann `generation`
    /// des Servers) oder ist beschädigt.
    PacketMissing {
        generation: Option<u64>,
    },
}

pub fn parse_pull(res: &Response) -> Result<PullResponse, SyncError> {
    if res.status == 410 {
        let info = serde_json::from_slice::<Value>(&res.body).unwrap_or(Value::Null);
        let generation = Some(count_or(info.get("generation"), 0)).filter(|g| *g > 0);
        return Ok(PullResponse::PacketMissing { generation });
    }
    if !res.is_success() {
        return Err(response_error(res, "Abruf vom Cloudflare-Server fehlgeschlagen"));
    }
    let data = json_body(res)?;
    let packets = match data.get("events") {
        Some(Value::Array(p)) => p.clone(),
        _ => Vec::new(),
    };
    let max_seq = number(data.get("maxSeq"));
    Ok(PullResponse::Page(SyncPage {
        packets,
        max_seq: if max_seq.is_nan() { 0.0 } else { max_seq },
        has_more: truthy(data.get("hasMore")),
        generation: count_or(data.get("generation"), 1),
        usage: usage_of(&data),
    }))
}

/// Antwort auf `POST /api/events`.
#[derive(Debug, Clone, PartialEq)]
pub struct UploadResponse {
    pub saved_count: u64,
    /// Neuer Empfangs-Cursor, wenn die Bestätigung lückenlos an `last_synced_seq` anschließt
    /// (sonst muss ein bestätigender Abruf folgen).
    pub acknowledged_seq: Option<u64>,
    pub usage: Option<StorageUsage>,
}

pub fn parse_upload(res: &Response, generation: u64, last_synced_seq: u64) -> Result<UploadResponse, SyncError> {
    if !res.is_success() {
        return Err(response_error(res, "Upload zum Cloudflare-Server fehlgeschlagen"));
    }
    let data = json_body(res)?;
    Ok(UploadResponse {
        saved_count: count_or(data.get("savedCount"), 0),
        acknowledged_seq: acknowledged_upload_cursor(&data, generation, last_synced_seq),
        usage: usage_of(&data),
    })
}

/// `acknowledgedUploadCursor`: Nur eine lückenlose, zur lokalen Ausgangsposition passende
/// Bestätigung darf den Empfangs-Cursor vorsetzen. Alte Server oder konkurrierende Uploads
/// liefern `None`; dann folgt der bestätigende Abruf.
pub fn acknowledged_upload_cursor(data: &Value, expected_generation: u64, current_seq: u64) -> Option<u64> {
    let ack = data.get("ack").filter(|a| truthy(Some(a)))?;
    let generation = safe_integer(data.get("generation"))?;
    if generation != expected_generation as i64 {
        return None;
    }
    let field = |k: &str| safe_integer(ack.get(k));
    let (from, to, saved) = (field("fromSeq")?, field("toSeq")?, field("savedCount")?);
    (from == current_seq as i64 && to >= from && saved == to - from).then_some(to as u64)
}

/// `GET /api/blobs`: Schlüssel und Fortsetzungs-Cursor (leer = fertig).
pub fn parse_blob_list(res: &Response) -> Result<(Vec<String>, String), SyncError> {
    if !res.is_success() {
        return Err(response_error(res, "Blob-Liste konnte nicht geladen werden"));
    }
    let data = json_body(res)?;
    let keys = data
        .get("keys")
        .and_then(Value::as_array)
        .map(|k| k.iter().map(|k| impala_crypto::json::js_string(Some(k))).collect())
        .unwrap_or_default();
    let cursor = data.get("cursor").filter(|c| truthy(Some(c))).map(|c| impala_crypto::json::js_string(Some(c)));
    Ok((keys, cursor.unwrap_or_default()))
}

/// Quota laut `X-Impala-Usage` (Blob-Anfragen).
pub fn usage_header(res: &Response) -> Option<StorageUsage> {
    let usage = number(res.header("X-Impala-Usage").map(|h| Value::String(h.to_owned())).as_ref());
    // Abweichung von JS: Dort ergab ein fehlender Header `Number(null)` = 0, die Anzeige fiel auf 0 MB.
    usage.is_finite().then(|| format_storage_usage(usage, None))
}

/// `POST /api/reset`: neue Generation (falls gemeldet).
pub fn parse_reset(res: &Response) -> Result<Option<u64>, SyncError> {
    if !res.is_success() {
        return Err(response_error(res, "Cloud-Daten konnten nicht gelöscht werden"));
    }
    Ok(Some(count_or(json_body(res)?.get("generation"), 0)).filter(|g| *g > 0))
}

/// Nachricht des Servers über den WebSocket.
#[derive(Debug, Clone, PartialEq)]
pub enum ServerMessage {
    /// Angemeldet; `generation` des Servers (falls gemeldet).
    Authenticated {
        generation: Option<u64>,
    },
    /// Neue Pakete oder Blobs; `from_self`: eigenes Echo (gleiche Client-ID).
    Changed {
        max_seq: f64,
        blob: bool,
        from_self: bool,
    },
    /// Generationsschnitt eines Geräts.
    Reset {
        generation: u64,
    },
    /// Abgewiesen (Token falsch oder Protokoll veraltet).
    Rejected(String),
    Other,
}

pub fn parse_server_message(text: &str, own_client_id: &str) -> Result<ServerMessage, SyncError> {
    let msg: Value =
        serde_json::from_str(text).map_err(|_| SyncError::BadResponse("WebSocket-Nachricht ungültig.".into()))?;
    let kind = msg.get("type").and_then(Value::as_str).unwrap_or_default();
    Ok(match kind {
        "authenticated" => {
            if msg.get("protocol").and_then(Value::as_f64) != Some(CLOUD_SYNC_PROTOCOL as f64) {
                return Err(SyncError::Protocol("Server und App verwenden unterschiedliche Sync-Protokolle.".into()));
            }
            ServerMessage::Authenticated { generation: Some(count_or(msg.get("generation"), 0)).filter(|g| *g > 0) }
        }
        "changed" => {
            let sender = msg.get("senderClientId").filter(|s| truthy(Some(s)));
            let max_seq = number(msg.get("maxSeq").filter(|m| truthy(Some(m))));
            ServerMessage::Changed {
                max_seq: if max_seq.is_nan() { 0.0 } else { max_seq },
                blob: truthy(msg.get("blob")),
                from_self: sender.and_then(Value::as_str) == Some(own_client_id),
            }
        }
        "reset" => ServerMessage::Reset { generation: count_or(msg.get("generation"), 1) },
        "unauthorized" | "unsupported_protocol" => ServerMessage::Rejected(
            msg.get("error")
                .filter(|e| truthy(Some(e)))
                .map(|e| impala_crypto::json::js_string(Some(e)))
                .unwrap_or_else(|| "Nicht autorisiert".into()),
        ),
        _ => ServerMessage::Other,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn res(status: u16, body: &str) -> Response {
        Response { status, headers: vec![], body: body.as_bytes().to_vec() }
    }

    #[test]
    fn errors_like_js() {
        assert_eq!(
            response_error(&res(413, r#"{"error":" Quota überschritten. "}"#), "x"),
            SyncError::Http { status: 413, message: "Quota überschritten.".into() }
        );
        assert_eq!(response_error(&res(502, "<html>"), "Abruf").to_string(), "Abruf (Status 502)");
        assert!(response_error(&res(413, r#"{"error":"Quota überschritten."}"#), "").is_quota());
    }

    #[test]
    fn ack_rules() {
        let data = |g: Value, f: Value, t: Value, s: Value| json!({"generation": g, "ack": {"fromSeq": f, "toSeq": t, "savedCount": s}});
        assert_eq!(acknowledged_upload_cursor(&data(json!(2), json!(5), json!(7), json!(2)), 2, 5), Some(7));
        assert_eq!(acknowledged_upload_cursor(&data(json!(2), json!(5), json!(5), json!(0)), 2, 5), Some(5));
        assert_eq!(acknowledged_upload_cursor(&data(json!(3), json!(5), json!(7), json!(2)), 2, 5), None);
        assert_eq!(acknowledged_upload_cursor(&data(json!(2), json!(4), json!(7), json!(3)), 2, 5), None);
        assert_eq!(acknowledged_upload_cursor(&data(json!(2), json!(5), json!(7), json!(1)), 2, 5), None);
        assert_eq!(acknowledged_upload_cursor(&data(json!("2"), json!("5"), json!(7.0), json!(2)), 2, 5), Some(7));
        assert_eq!(acknowledged_upload_cursor(&json!({"generation": 2}), 2, 5), None);
    }

    #[test]
    fn urls_and_messages() {
        let creds = impala_crypto::SyncCredentials {
            user_id: "u1".into(),
            auth_token: "tok".into(),
            key: impala_crypto::CipherKey::from_bytes([0; 32]),
        };
        let ep = Endpoint::new(" https://w.example/// ", &creds, "c1");
        assert_eq!(ep.pull(3, 100).url, "https://w.example/api/sync?since=3&limit=100&user=u1");
        assert_eq!(ep.list_blobs("a b/c").url, "https://w.example/api/blobs?cursor=a%20b%2Fc&user=u1");
        assert_eq!(ep.reset().url, "https://w.example/api/reset?user=u1");
        assert_eq!(ep.ws_url(), "wss://w.example/ws?user=u1");
        assert_eq!(Endpoint::new("http://localhost:8787", &creds, "c1").ws_url(), "ws://localhost:8787/ws?user=u1");
        let post = ep.post_events("{}".into());
        let names: Vec<&str> = post.headers.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(
            names,
            ["Authorization", "X-User-Id", "X-Impala-Client-Id", "X-Impala-Sync-Protocol", "Content-Type"]
        );
        assert_eq!(ep.ws_auth_message(), r#"{"type":"auth","protocol":4,"token":"tok","clientId":"c1"}"#);
        assert_eq!(
            parse_server_message(r#"{"type":"changed","maxSeq":9,"senderClientId":"c1"}"#, "c1").unwrap(),
            ServerMessage::Changed { max_seq: 9.0, blob: false, from_self: true }
        );
        assert!(parse_server_message(r#"{"type":"authenticated","protocol":3}"#, "c1").is_err());
        assert_eq!(parse_server_message(r#"{"type":"reset"}"#, "c").unwrap(), ServerMessage::Reset { generation: 1 });
    }
}
