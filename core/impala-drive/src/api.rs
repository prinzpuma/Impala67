//! Drive-REST-API v3: Anfragen bauen und Antworten auswerten (reine Funktionen, ohne Netz).
//! Ohne Ordner: Alles liegt im privaten `appDataFolder` (Bereich `drive.appdata`).

use impala_net::{Method, Request, Response};
use serde_json::{Value, json};

use crate::DriveError;
use crate::format::{DriveFile, Encoding};

pub const API_BASE: &str = "https://www.googleapis.com";
pub const USERINFO_URL: &str = "https://www.googleapis.com/oauth2/v2/userinfo";
/// OAuth-Bereiche, die die Plattform anfordert.
pub const SCOPE: &str = "https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email";
const LIST_FIELDS: &str = "nextPageToken,files(id,name,modifiedTime,size,appProperties)";
const CHANGE_FIELDS: &str =
    "nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,modifiedTime,size,appProperties,trashed))";
const UPLOAD_FIELDS: &str = "id,name,modifiedTime,appProperties";
/// Ab dieser Größe wird resumable statt multipart hochgeladen (Drive empfiehlt multipart nur bis 5 MB).
pub const RESUMABLE_FROM_BYTES: usize = 5 * 1024 * 1024;
/// Länge des Antwort-Auszugs in Fehlermeldungen.
const ERROR_EXCERPT_CHARS: usize = 200;

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

fn page_param(page_token: Option<&str>) -> String {
    page_token.filter(|t| !t.is_empty()).map(|t| format!("&pageToken={}", encode_uri_component(t))).unwrap_or_default()
}

fn authed(method: Method, url: String, token: &str) -> Request {
    Request::new(method, url).header("Authorization", format!("Bearer {token}"))
}

/// Alle nicht gelöschten Dateien des App-Ordners, seitenweise.
pub fn list_files(token: &str, page_token: Option<&str>) -> Request {
    let q = encode_uri_component("trashed=false");
    let url = format!(
        "{API_BASE}/drive/v3/files?spaces=appDataFolder&q={q}&pageSize=1000&fields={LIST_FIELDS}{}",
        page_param(page_token)
    );
    authed(Method::Get, url, token)
}

/// Größen aller Dateien (Speicheranzeige; wie JS ohne `trashed`-Filter).
pub fn list_sizes(token: &str, page_token: Option<&str>) -> Request {
    let url = format!(
        "{API_BASE}/drive/v3/files?spaces=appDataFolder&pageSize=1000&fields=nextPageToken,files(size){}",
        page_param(page_token)
    );
    authed(Method::Get, url, token)
}

pub fn start_page_token(token: &str) -> Request {
    authed(Method::Get, format!("{API_BASE}/drive/v3/changes/startPageToken"), token)
}

pub fn list_changes(token: &str, page_token: &str) -> Request {
    let url = format!(
        "{API_BASE}/drive/v3/changes?spaces=appDataFolder&pageSize=1000&fields={CHANGE_FIELDS}&pageToken={}",
        encode_uri_component(page_token)
    );
    authed(Method::Get, url, token)
}

pub fn download(token: &str, file_id: &str) -> Request {
    authed(Method::Get, format!("{API_BASE}/drive/v3/files/{file_id}?alt=media"), token)
}

pub fn delete(token: &str, file_id: &str) -> Request {
    authed(Method::Delete, format!("{API_BASE}/drive/v3/files/{file_id}"), token)
}

pub fn about(token: &str) -> Request {
    authed(Method::Get, format!("{API_BASE}/drive/v3/about?fields=storageQuota"), token)
}

pub fn user_info(token: &str) -> Request {
    authed(Method::Get, USERINFO_URL.to_owned(), token)
}

/// Eine hochzuladende Datei. Ohne `file_id` neu im App-Ordner, sonst Inhalt ersetzen.
#[derive(Debug, Clone)]
pub struct Upload<'a> {
    pub name: &'a str,
    pub file_id: Option<&'a str>,
    pub encoding: Encoding,
    /// Weitere `appProperties` nach `encoding`.
    pub properties: Vec<(&'static str, String)>,
    pub bytes: &'a [u8],
}

impl Upload<'_> {
    /// Metadaten wie `uploadNamed`: `{name, parents?, appProperties: {encoding, …}}`.
    pub fn metadata(&self) -> String {
        let mut props = serde_json::Map::new();
        props.insert("encoding".into(), Value::from(self.encoding.as_str()));
        for (k, v) in &self.properties {
            props.insert((*k).into(), Value::from(v.as_str()));
        }
        let mut meta = serde_json::Map::new();
        meta.insert("name".into(), Value::from(self.name));
        if self.file_id.is_none() {
            meta.insert("parents".into(), json!(["appDataFolder"]));
        }
        meta.insert("appProperties".into(), Value::Object(props));
        impala_crypto::json::stringify(&Value::Object(meta))
    }

    fn url(&self, kind: &str) -> String {
        let id = self.file_id.map(|id| format!("/{id}")).unwrap_or_default();
        format!("{API_BASE}/upload/drive/v3/files{id}?uploadType={kind}&fields={UPLOAD_FIELDS}")
    }

    fn method(&self) -> Method {
        if self.file_id.is_some() { Method::Patch } else { Method::Post }
    }

    pub fn is_large(&self) -> bool {
        self.bytes.len() >= RESUMABLE_FROM_BYTES
    }

    /// Multipart-Upload in einer Anfrage. `boundary` muss im Inhalt nicht vorkommen
    /// (zufällig, siehe [`crate::DriveBackup`]).
    pub fn multipart(&self, token: &str, boundary: &str) -> Request {
        let mut body = format!(
            "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{}\r\n--{boundary}\r\nContent-Type: application/octet-stream\r\n\r\n",
            self.metadata()
        )
        .into_bytes();
        body.extend_from_slice(self.bytes);
        body.extend_from_slice(format!("\r\n--{boundary}--").as_bytes());
        authed(self.method(), self.url("multipart"), token)
            .header("Content-Type", format!("multipart/related; boundary={boundary}"))
            .body(body)
    }

    /// Erster Schritt eines resumable Uploads: Sitzung anlegen (Antwort: `Location`).
    pub fn resumable_start(&self, token: &str) -> Request {
        authed(self.method(), self.url("resumable"), token)
            .header("Content-Type", "application/json; charset=UTF-8")
            .header("X-Upload-Content-Type", "application/octet-stream")
            .header("X-Upload-Content-Length", self.bytes.len().to_string())
            .body(self.metadata().into_bytes())
    }

    /// Zweiter Schritt: alle Bytes an die Sitzungs-URL.
    pub fn resumable_put(&self, token: &str, session_url: &str) -> Request {
        authed(Method::Put, session_url.to_owned(), token)
            .header("Content-Type", "application/octet-stream")
            .body(self.bytes.to_vec())
    }
}

// ---- Antworten -------------------------------------------------------------------------

/// Ergebnis einer Anfrage nach Status: Erfolg, 401, vorübergehend (429/5xx) oder Fehler.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Ok,
    Unauthorized,
    Retry,
    Failed,
}

pub fn outcome(res: &Response) -> Outcome {
    match res.status {
        401 => Outcome::Unauthorized,
        429 | 500..=599 => Outcome::Retry,
        _ if res.is_success() => Outcome::Ok,
        _ => Outcome::Failed,
    }
}

/// `"Drive-Fehler <status>: <Anfang der Antwort>"`.
pub fn http_error(res: &Response) -> DriveError {
    DriveError::Http { status: res.status, body: res.text().chars().take(ERROR_EXCERPT_CHARS).collect() }
}

fn parse_json(res: &Response) -> Result<Value, DriveError> {
    serde_json::from_slice(&res.body).map_err(|e| DriveError::BadResponse(format!("Drive-Antwort ist kein JSON: {e}")))
}

fn next_token(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_owned)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FilePage {
    pub files: Vec<DriveFile>,
    pub next_page_token: Option<String>,
}

pub fn parse_file_page(res: &Response) -> Result<FilePage, DriveError> {
    let v = parse_json(res)?;
    let files = v.get("files").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
    Ok(FilePage {
        files: files.iter().filter_map(DriveFile::from_json).collect(),
        next_page_token: next_token(&v, "nextPageToken"),
    })
}

pub fn parse_start_page_token(res: &Response) -> Result<String, DriveError> {
    next_token(&parse_json(res)?, "startPageToken")
        .ok_or_else(|| DriveError::BadResponse("changes.getStartPageToken lieferte kein Token.".into()))
}

/// Eine Änderung im App-Ordner.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Change {
    /// Gelöscht oder in den Papierkorb gelegt.
    Removed(String),
    Upsert(DriveFile),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChangePage {
    pub changes: Vec<Change>,
    pub next_page_token: Option<String>,
    /// Nur auf der letzten Seite: Token für den nächsten Abgleich.
    pub new_start_page_token: Option<String>,
}

pub fn parse_change_page(res: &Response) -> Result<ChangePage, DriveError> {
    let v = parse_json(res)?;
    let list = v.get("changes").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
    let changes = list
        .iter()
        .filter_map(|ch| {
            let file = ch.get("file");
            let removed = truthy(ch.get("removed")) || truthy(file.and_then(|f| f.get("trashed")));
            if removed {
                ch.get("fileId").and_then(Value::as_str).map(|id| Change::Removed(id.to_owned()))
            } else {
                file.and_then(DriveFile::from_json).map(Change::Upsert)
            }
        })
        .collect();
    Ok(ChangePage {
        changes,
        next_page_token: next_token(&v, "nextPageToken"),
        new_start_page_token: next_token(&v, "newStartPageToken"),
    })
}

/// Antwort auf einen Upload (`id,name,modifiedTime,appProperties`).
pub fn parse_uploaded(res: &Response) -> Result<DriveFile, DriveError> {
    DriveFile::from_json(&parse_json(res)?)
        .ok_or_else(|| DriveError::BadResponse("Upload-Antwort ohne Datei-ID.".into()))
}

/// Sitzungs-URL eines resumable Uploads.
pub fn parse_session_url(res: &Response) -> Result<String, DriveError> {
    res.header("location")
        .map(str::to_owned)
        .ok_or_else(|| DriveError::BadResponse("Resumable-Upload ohne Location-Header.".into()))
}

/// Belegung des Google-Kontos (Bytes; 0 = unbekannt bzw. unbegrenzt).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Quota {
    pub used_bytes: f64,
    pub limit_bytes: f64,
}

pub fn parse_about(res: &Response) -> Result<Quota, DriveError> {
    let v = parse_json(res)?;
    let q = v.get("storageQuota");
    let num = |k: &str| q.and_then(|q| q.get(k)).map(js_number).unwrap_or(0.0);
    Ok(Quota { used_bytes: num("usage"), limit_bytes: num("limit") })
}

/// Summe der `size`-Felder einer Seite und das Token der nächsten.
pub fn parse_size_page(res: &Response) -> Result<(f64, Option<String>), DriveError> {
    let v = parse_json(res)?;
    let files = v.get("files").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
    let sum = files.iter().map(|f| f.get("size").map(js_number).unwrap_or(0.0)).sum();
    Ok((sum, next_token(&v, "nextPageToken")))
}

pub fn parse_user_email(res: &Response) -> Option<String> {
    let v: Value = serde_json::from_slice(&res.body).ok()?;
    next_token(&v, "email")
}

/// `Number(x) || 0` für Zahlen und Zahlentexte.
fn js_number(v: &Value) -> f64 {
    let x = match v {
        Value::Number(n) => n.as_f64().unwrap_or(0.0),
        Value::String(s) => s.trim().parse().unwrap_or(0.0),
        _ => 0.0,
    };
    if x.is_finite() { x } else { 0.0 }
}

fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Number(n)) => n.as_f64().is_some_and(|x| x != 0.0),
        Some(_) => true,
    }
}

/// HTTP-Datum (`Tue, 27 Oct 2026 14:04:30 GMT`, IMF-fixdate) in ms seit 1970.
pub fn http_date_ms(s: &str) -> Option<f64> {
    let mut parts = s.split_whitespace();
    let _weekday = parts.next()?;
    let day: i64 = parts.next()?.parse().ok()?;
    const MONTHS: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let mon = parts.next()?;
    let month = MONTHS.iter().position(|m| *m == mon)? as i64 + 1;
    let year: i64 = parts.next()?.parse().ok()?;
    let mut hms = parts.next()?.split(':').map(|p| p.parse::<i64>().ok());
    let (h, m, sec) = (hms.next()??, hms.next()??, hms.next()??);
    if parts.next() != Some("GMT") || !(1..=31).contains(&day) || h > 23 || m > 59 || sec > 60 {
        return None;
    }
    let days = days_from_civil(year, month, day);
    Some(((days * 86_400 + h * 3600 + m * 60 + sec) * 1000) as f64)
}

/// Tage seit 1970-01-01 (proleptisch gregorianisch, H. Hinnant).
pub(crate) fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    fn res(status: u16, body: &str) -> Response {
        Response { status, headers: vec![], body: body.as_bytes().to_vec() }
    }

    #[test]
    fn uri_component() {
        assert_eq!(encode_uri_component("trashed=false"), "trashed%3Dfalse");
        assert_eq!(encode_uri_component("a b/ä~*'()!"), "a%20b%2F%C3%A4~*'()!");
    }

    #[test]
    fn dates() {
        assert_eq!(http_date_ms("Tue, 27 Oct 2026 14:04:30 GMT"), Some(1_793_109_870_000.0));
        assert_eq!(http_date_ms("Thu, 01 Jan 1970 00:00:00 GMT"), Some(0.0));
        assert_eq!(http_date_ms("gestern"), None);
        assert_eq!(http_date_ms("Tue, 27 Okt 2026 14:04:30 GMT"), None);
    }

    #[test]
    fn changes() {
        let page = parse_change_page(&res(
            200,
            r#"{"changes":[{"fileId":"a","removed":true},{"fileId":"b","file":{"id":"b","name":"x","trashed":true}},
            {"fileId":"c","removed":false,"file":{"id":"c","name":"y"}},{"fileId":"d"}],"newStartPageToken":"t2"}"#,
        ))
        .unwrap();
        assert_eq!(page.changes.len(), 3);
        assert_eq!(page.changes[1], Change::Removed("b".into()));
        assert_eq!(page.new_start_page_token.as_deref(), Some("t2"));
        assert_eq!(outcome(&res(503, "")), Outcome::Retry);
        assert_eq!(outcome(&res(404, "")), Outcome::Failed);
        assert_eq!(http_error(&res(404, &"x".repeat(300))).to_string().len(), "Drive-Fehler 404: ".len() + 200);
    }

    #[test]
    fn quota() {
        let q = parse_about(&res(200, r#"{"storageQuota":{"usage":"10","limit":"x"}}"#)).unwrap();
        assert_eq!((q.used_bytes, q.limit_bytes), (10.0, 0.0));
        assert_eq!(parse_size_page(&res(200, r#"{"files":[{"size":"3"},{},{"size":"4"}]}"#)).unwrap(), (7.0, None));
    }
}
