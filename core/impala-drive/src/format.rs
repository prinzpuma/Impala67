//! Dateien im privaten `appDataFolder` (gleiches Format wie `web/drive.js`):
//!
//! | Datei                                         | Inhalt                                                 |
//! |-----------------------------------------------|--------------------------------------------------------|
//! | `impala67-snapshot-v2.json.gz`                | `exportAll` ohne Blobs, gzip                           |
//! | `impala67-sync.json`, `notion-sync.json` (v1) | `exportAll` mit Blobs, unkomprimiert (nur noch lesen)  |
//! | `impala67-delta-v2-<gerät>-<von>-<bis>.json.gz` | `{app, version: 2, exportedAt, events, blobs: {}}`, gzip |
//! | `impala67-blob-v2-<sha256>.json.gz`           | `{id, meta, b64}`, gzip; Hash über den JSON-Text       |
//!
//! Keine eigene Verschlüsselung: Der App-Ordner ist nur für diese App lesbar, die Dateien sind
//! lediglich gzip-komprimiert. Die Kodierung steht in `appProperties.encoding`; fehlt sie, gilt
//! die Endung `.gz`.

use impala_crypto::json::stringify;
use impala_crypto::{base64_decode, base64_encode, hex_encode, sha256};
pub use impala_sync::files::Encoding;
use impala_sync::files::RemoteFile;
use serde_json::{Map, Value, json};

pub const SNAPSHOT_NAME: &str = "impala67-snapshot-v2.json.gz";
/// Snapshot-Format v1 (Blobs im selben Dokument). Wird nur noch gelesen.
pub const V1_SNAPSHOT_NAME: &str = "impala67-sync.json";
/// v1 aus der Zeit, als das Projekt „notion“ hieß.
pub const LEGACY_SNAPSHOT_NAME: &str = "notion-sync.json";
/// Gesucht wird der neueste dieser Snapshots.
pub const SNAPSHOT_NAMES: [&str; 3] = [SNAPSHOT_NAME, V1_SNAPSHOT_NAME, LEGACY_SNAPSHOT_NAME];
pub const DELTA_PREFIX: &str = "impala67-delta-v2-";
pub const BLOB_PREFIX: &str = "impala67-blob-v2-";
const GZ_JSON: &str = ".json.gz";

/// Eine Datei im App-Ordner, wie die Dateiliste und der lokale Index sie führen
/// (`slimFile`: id, name, modifiedTime, size, appProperties).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DriveFile {
    pub id: String,
    pub name: String,
    /// RFC 3339 wie von Drive geliefert.
    pub modified_time: Option<String>,
    /// Bytes als Text (Drive liefert int64 als String).
    pub size: Option<String>,
    /// Reihenfolge bleibt; `None`, wenn Drive keine liefert.
    pub app_properties: Option<Vec<(String, String)>>,
}

/// Was eine Datei für den Sync ist (am Namen erkannt).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileKind<'a> {
    Snapshot,
    /// v1-Snapshot (`impala67-sync.json` oder `notion-sync.json`).
    V1Snapshot,
    Delta,
    /// Blob-Datei; `hash` ist der SHA-256 ihres JSON-Inhalts (aus dem Namen).
    Blob {
        hash: &'a str,
    },
    Other,
}

impl DriveFile {
    /// Aus einer Drive-Antwort. Ohne `id` oder `name` unbrauchbar (`None`).
    // Abweichung von JS: Eine Datei ohne Namen ließ dort `f.name.startsWith` werfen und damit
    // jeden Sync scheitern; hier wird sie übergangen.
    pub fn from_json(v: &Value) -> Option<DriveFile> {
        let text = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_owned);
        let app_properties = v
            .get("appProperties")
            .and_then(Value::as_object)
            .map(|props| props.iter().filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_owned()))).collect());
        Some(DriveFile {
            id: text("id").filter(|s| !s.is_empty())?,
            name: text("name")?,
            modified_time: text("modifiedTime"),
            size: text("size"),
            app_properties,
        })
    }

    /// Wie `slimFile` (fehlende Felder entfallen).
    pub fn to_json(&self) -> Value {
        let mut m = Map::new();
        m.insert("id".into(), Value::from(self.id.as_str()));
        m.insert("name".into(), Value::from(self.name.as_str()));
        if let Some(t) = &self.modified_time {
            m.insert("modifiedTime".into(), Value::from(t.as_str()));
        }
        if let Some(s) = &self.size {
            m.insert("size".into(), Value::from(s.as_str()));
        }
        if let Some(props) = &self.app_properties {
            let props = props.iter().map(|(k, v)| (k.clone(), Value::from(v.as_str()))).collect();
            m.insert("appProperties".into(), Value::Object(props));
        }
        Value::Object(m)
    }

    pub fn app_property(&self, key: &str) -> Option<&str> {
        self.app_properties.as_ref()?.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
    }

    /// `appProperties.encoding`, sonst `.gz`-Endung → gzip.
    pub fn encoding(&self) -> Encoding {
        match self.app_property("encoding").filter(|e| !e.is_empty()) {
            Some(e) => Encoding::parse(e),
            None if self.name.ends_with(".gz") => Encoding::Gzip,
            None => Encoding::Identity,
        }
    }

    pub fn kind(&self) -> FileKind<'_> {
        match self.name.as_str() {
            SNAPSHOT_NAME => FileKind::Snapshot,
            V1_SNAPSHOT_NAME | LEGACY_SNAPSHOT_NAME => FileKind::V1Snapshot,
            n if n.starts_with(DELTA_PREFIX) => FileKind::Delta,
            n if n.starts_with(BLOB_PREFIX) => {
                let rest = &n[BLOB_PREFIX.len()..];
                FileKind::Blob { hash: rest.strip_suffix(GZ_JSON).unwrap_or(rest) }
            }
            _ => FileKind::Other,
        }
    }

    /// Stand eines Snapshots: `id:modifiedTime` (JS schrieb bei fehlender Zeit `undefined`).
    pub fn stamp(&self) -> String {
        format!("{}:{}", self.id, self.modified_time.as_deref().unwrap_or("undefined"))
    }

    pub(crate) fn remote(&self) -> RemoteFile {
        RemoteFile {
            id: self.id.clone(),
            name: self.name.clone(),
            modified_time: self.modified_time.clone().unwrap_or_default(),
        }
    }
}

/// Name eines Änderungspakets: lokale Sequenzen `from..=to` dieses Geräts.
pub fn delta_name(device: &str, from: u64, to: u64) -> String {
    format!("{DELTA_PREFIX}{device}-{from}-{to}{GZ_JSON}")
}

pub fn blob_name(hash: &str) -> String {
    format!("{BLOB_PREFIX}{hash}{GZ_JSON}")
}

/// `appProperties` eines Änderungspakets (nach `encoding`).
pub fn delta_properties(device: &str, from: u64, to: u64) -> Vec<(&'static str, String)> {
    vec![("device", device.to_owned()), ("from", from.to_string()), ("to", to.to_string())]
}

/// Inhalt eines Änderungspakets.
pub fn delta_payload(events: Vec<Value>, exported_at: &str) -> String {
    stringify(&json!({ "app": "impala67", "version": 2, "exportedAt": exported_at, "events": events, "blobs": {} }))
}

/// Inhalt einer Blob-Datei. `meta` fehlt bei Alt-Datensätzen und wird dann `{}` (JS: `meta || {}`).
pub fn blob_payload(id: &str, meta: &Value, data: &[u8]) -> String {
    let meta = if truthy(meta) { meta.clone() } else { json!({}) };
    stringify(&json!({ "id": id, "meta": meta, "b64": base64_encode(data) }))
}

/// Dateiname-Hash einer Blob-Datei: SHA-256 (Hex) über ihren JSON-Text.
pub fn blob_hash(payload: &str) -> String {
    hex_encode(&sha256(payload.as_bytes()))
}

/// Ein heruntergeladener Blob.
#[derive(Debug, Clone, PartialEq)]
pub struct BlobPayload {
    pub id: String,
    pub meta: Value,
    pub data: Vec<u8>,
}

/// Liest eine Blob-Datei. `None` ohne ID oder mit kaputtem Base64.
// Abweichung von JS: Kaputtes Base64 ließ `atob` werfen und brach den ganzen Sync ab – bei jedem
// Lauf erneut, weil die Datei unverändert in Drive liegt. Hier wird nur diese Datei übergangen.
pub fn parse_blob_payload(v: &Value) -> Option<BlobPayload> {
    let id = v.get("id").and_then(Value::as_str).filter(|s| !s.is_empty())?;
    let data = base64_decode(v.get("b64").and_then(Value::as_str).unwrap_or(""))?;
    let meta = v.get("meta").filter(|m| truthy(m)).cloned().unwrap_or_else(|| json!({}));
    Some(BlobPayload { id: id.to_owned(), meta, data })
}

/// Events eines Snapshots oder Pakets (fehlt die Liste: keine).
pub fn payload_events(v: &Value) -> Vec<Value> {
    v.get("events").and_then(Value::as_array).cloned().unwrap_or_default()
}

/// Blobs eines v1-Snapshots (`{schlüssel: {meta, b64}}`); neuere Dateien haben keine.
// JS übernahm auch ein Array als „Objekt“ (Schlüssel „0“, „1“ …); hier zählen nur Objekte.
pub fn payload_blobs(v: &Value) -> Map<String, Value> {
    v.get("blobs").and_then(Value::as_object).cloned().unwrap_or_default()
}

/// Was der Import bekommt: alle gezogenen Events und (v1) Blobs in EINEM Durchgang.
pub fn import_payload(events: Vec<Value>, blobs: Map<String, Value>, exported_at: &str) -> Value {
    json!({ "app": "impala67", "version": 2, "exportedAt": exported_at, "events": events, "blobs": blobs })
}

fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|x| x != 0.0 && !x.is_nan()),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(name: &str, props: Option<&[(&str, &str)]>) -> DriveFile {
        DriveFile {
            id: "1".into(),
            name: name.into(),
            app_properties: props.map(|p| p.iter().map(|(k, v)| ((*k).into(), (*v).into())).collect()),
            ..DriveFile::default()
        }
    }

    #[test]
    fn kinds_and_encoding() {
        assert_eq!(file(SNAPSHOT_NAME, None).kind(), FileKind::Snapshot);
        assert_eq!(file("notion-sync.json", None).kind(), FileKind::V1Snapshot);
        assert_eq!(file(&delta_name("d", 1, 3), None).kind(), FileKind::Delta);
        assert_eq!(file(&blob_name("ab"), None).kind(), FileKind::Blob { hash: "ab" });
        assert_eq!(file("impala67-blob-v2-cd", None).kind(), FileKind::Blob { hash: "cd" });
        assert_eq!(file("x.txt", None).kind(), FileKind::Other);
        assert_eq!(file("a.json.gz", None).encoding(), Encoding::Gzip);
        assert_eq!(file("a.json", None).encoding(), Encoding::Identity);
        assert_eq!(file("a.json.gz", Some(&[("encoding", "identity")])).encoding(), Encoding::Identity);
        assert_eq!(file("a.json", Some(&[("encoding", "")])).encoding(), Encoding::Identity);
        assert_eq!(file("a.json", Some(&[("encoding", "gzip")])).encoding(), Encoding::Gzip);
    }

    #[test]
    fn file_json_roundtrip() {
        let v = json!({"id": "f1", "name": "n", "size": "3", "appProperties": {"encoding": "gzip", "x": 1}});
        let f = DriveFile::from_json(&v).unwrap();
        assert_eq!(f.stamp(), "f1:undefined");
        assert_eq!(f.to_json(), json!({"id": "f1", "name": "n", "size": "3", "appProperties": {"encoding": "gzip"}}));
        assert!(DriveFile::from_json(&json!({"id": "f"})).is_none());
        assert!(DriveFile::from_json(&json!({"id": "", "name": "n"})).is_none());
    }

    #[test]
    fn blob_payloads() {
        let text = blob_payload("img:1", &Value::Null, &[1, 2, 3]);
        assert_eq!(text, r#"{"id":"img:1","meta":{},"b64":"AQID"}"#);
        let parsed = parse_blob_payload(&serde_json::from_str(&text).unwrap()).unwrap();
        assert_eq!(parsed, BlobPayload { id: "img:1".into(), meta: json!({}), data: vec![1, 2, 3] });
        assert!(parse_blob_payload(&json!({"id": "x", "b64": "§"})).is_none());
        assert!(parse_blob_payload(&json!({"b64": ""})).is_none());
        assert_eq!(blob_hash("").len(), 64);
    }
}
