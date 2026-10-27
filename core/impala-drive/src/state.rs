//! Gerätelokaler Zustand des Drive-Backups. In der PWA liegt er in einzelnen
//! `localStorage`-Einträgen; [`DriveState::from_kv`]/[`DriveState::to_kv`] lesen und schreiben
//! genau diese, damit ein Gerät nahtlos zwischen JS- und Rust-Kern wechseln kann.

use std::collections::BTreeMap;

use impala_crypto::json::stringify;
use impala_sync::files::bounded_known_ids;
use serde_json::{Map, Value, json};

use crate::format::DriveFile;

pub const KEY_DEVICE_ID: &str = "impala67_drive_device_id";
pub const KEY_FILE_INDEX: &str = "impala67_drive_file_index";
pub const KEY_KNOWN_DELTAS: &str = "impala67_drive_known_deltas";
pub const KEY_UPLOADED_SEQ: &str = "impala67_drive_uploaded_seq";
pub const KEY_SNAPSHOT_STAMP: &str = "impala67_drive_snapshot_stamp";
pub const KEY_UPLOAD_HASHES: &str = "impala67_drive_upload_hashes";
pub const KEY_SECRET_SCRUB: &str = "impala67_drive_secret_scrub";
pub const KEY_SYNCED_SEQ: &str = "impala67_drive_synced_seq";
pub const KEY_LAST_OK: &str = "impala67_drive_last_ok";
/// Altlast (vor [G2]); wird beim Speichern entfernt.
pub const KEY_KNOWN_BLOBS: &str = "impala67_drive_known_blobs";

/// Höchstens so viele gelesene Delta-IDs werden gemerkt (`boundedKnownIds`, Standard 2000).
const KNOWN_IDS_MAX: usize = 0;

/// Lokaler Stand des App-Ordners plus Changes-Token (immer gemeinsam gespeichert).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FileIndex {
    pub token: String,
    /// Reihenfolge wie die JS-Objektschlüssel (Einfügereihenfolge).
    pub files: Vec<DriveFile>,
}

impl FileIndex {
    pub fn put(&mut self, file: DriveFile) {
        match self.files.iter_mut().find(|f| f.id == file.id) {
            Some(slot) => *slot = file,
            None => self.files.push(file),
        }
    }

    pub fn remove(&mut self, id: &str) {
        self.files.retain(|f| f.id != id);
    }
}

/// Hash-Cache je lokalem Blob: spart das erneute Serialisieren und Hashen unveränderter Blobs.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UploadHash {
    /// `meta.hash` des Blobs (leer, wenn keiner).
    pub content_hash: String,
    pub size: u64,
    /// Hash der Blob-Datei (= Dateiname in Drive).
    pub hash: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DriveState {
    /// Zufällige Geräte-ID (Teil der Delta-Namen). Leer: wird beim ersten Sync vergeben.
    pub device_id: String,
    pub index: Option<FileIndex>,
    /// Schon eingespielte bzw. selbst hochgeladene Delta-Datei-IDs.
    pub known_deltas: Vec<String>,
    /// Höchste lokale `seq`, die in Drive liegt (Upload-Wasserstand).
    pub uploaded_seq: Option<u64>,
    /// `id:modifiedTime` des zuletzt eingespielten Snapshots.
    pub snapshot_stamp: Option<String>,
    pub upload_hashes: BTreeMap<String, UploadHash>,
    /// Nutzer hat die Token-Synchronisierung ausgeschaltet: alte Kopien aus Drive entfernen.
    pub secret_scrub: bool,
    pub synced_seq: Option<u64>,
    /// ISO-Zeit des letzten erfolgreichen Syncs.
    pub last_ok: Option<String>,
}

impl DriveState {
    pub fn knows_delta(&self, id: &str) -> bool {
        self.known_deltas.iter().any(|k| k == id)
    }

    pub fn add_known_delta(&mut self, id: &str) {
        if !self.knows_delta(id) {
            self.known_deltas.push(id.to_owned());
        }
    }

    /// Liest die `localStorage`-Einträge der PWA. Kaputte Werte zählen als nicht gesetzt.
    pub fn from_kv(mut get: impl FnMut(&str) -> Option<String>) -> DriveState {
        let json = |s: Option<String>| s.and_then(|s| serde_json::from_str::<Value>(&s).ok());
        let seq = |s: Option<String>| s.and_then(|s| parse_seq(&s));
        DriveState {
            device_id: get(KEY_DEVICE_ID).unwrap_or_default(),
            index: json(get(KEY_FILE_INDEX)).and_then(|v| parse_index(&v)),
            known_deltas: json(get(KEY_KNOWN_DELTAS))
                .and_then(|v| v.as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_owned)).collect()))
                .unwrap_or_default(),
            uploaded_seq: seq(get(KEY_UPLOADED_SEQ)),
            snapshot_stamp: get(KEY_SNAPSHOT_STAMP),
            upload_hashes: json(get(KEY_UPLOAD_HASHES)).map(|v| parse_hashes(&v)).unwrap_or_default(),
            secret_scrub: get(KEY_SECRET_SCRUB).as_deref() == Some("1"),
            synced_seq: seq(get(KEY_SYNCED_SEQ)),
            last_ok: get(KEY_LAST_OK),
        }
    }

    /// Alle Einträge (`None` = entfernen). Leere Listen/Maps entfallen.
    pub fn to_kv(&self) -> Vec<(&'static str, Option<String>)> {
        let some = |s: String| Some(s);
        vec![
            (KEY_DEVICE_ID, Some(self.device_id.clone()).filter(|s| !s.is_empty())),
            (KEY_FILE_INDEX, self.index.as_ref().map(index_json)),
            (
                KEY_KNOWN_DELTAS,
                (!self.known_deltas.is_empty())
                    .then(|| stringify(&json!(bounded_known_ids(&self.known_deltas, KNOWN_IDS_MAX)))),
            ),
            (KEY_UPLOADED_SEQ, self.uploaded_seq.map(|s| s.to_string())),
            (KEY_SNAPSHOT_STAMP, self.snapshot_stamp.clone()),
            (
                KEY_UPLOAD_HASHES,
                (!self.upload_hashes.is_empty()).then(|| hashes_json(&self.upload_hashes)).and_then(some),
            ),
            (KEY_SECRET_SCRUB, self.secret_scrub.then(|| "1".to_owned())),
            (KEY_SYNCED_SEQ, self.synced_seq.map(|s| s.to_string())),
            (KEY_LAST_OK, self.last_ok.clone()),
            (KEY_KNOWN_BLOBS, None),
        ]
    }
}

/// `Number(text || 0)` für Wasserstände; Unsinn zählt als nicht gesetzt.
fn parse_seq(s: &str) -> Option<u64> {
    let x: f64 = s.trim().parse().ok()?;
    (x.is_finite() && x >= 0.0).then_some(x.trunc() as u64)
}

/// `loadIndex`: nur mit Token und Dateien gültig.
fn parse_index(v: &Value) -> Option<FileIndex> {
    let token = v.get("token").and_then(Value::as_str).filter(|t| !t.is_empty())?;
    let files = v.get("files").and_then(Value::as_object)?;
    Some(FileIndex { token: token.to_owned(), files: files.values().filter_map(DriveFile::from_json).collect() })
}

fn index_json(idx: &FileIndex) -> String {
    let files: Map<String, Value> = idx.files.iter().map(|f| (f.id.clone(), f.to_json())).collect();
    stringify(&json!({ "token": idx.token, "files": files }))
}

fn parse_hashes(v: &Value) -> BTreeMap<String, UploadHash> {
    let Some(map) = v.as_object() else { return BTreeMap::new() };
    map.iter()
        .filter_map(|(id, e)| {
            let hash = e.get("hash").and_then(Value::as_str)?.to_owned();
            let content_hash = e.get("contentHash").and_then(Value::as_str).unwrap_or("").to_owned();
            let size = e.get("size").and_then(Value::as_u64).unwrap_or(0);
            Some((id.clone(), UploadHash { content_hash, size, hash }))
        })
        .collect()
}

fn hashes_json(map: &BTreeMap<String, UploadHash>) -> String {
    let obj: Map<String, Value> = map
        .iter()
        .map(|(id, h)| (id.clone(), json!({ "contentHash": h.content_hash, "size": h.size, "hash": h.hash })))
        .collect();
    stringify(&Value::Object(obj))
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    #[test]
    fn kv_roundtrip() {
        let mut s =
            DriveState { device_id: "d".into(), uploaded_seq: Some(4), secret_scrub: true, ..Default::default() };
        s.index = Some(FileIndex {
            token: "t".into(),
            files: vec![DriveFile { id: "a".into(), name: "n".into(), ..Default::default() }],
        });
        s.add_known_delta("x");
        s.add_known_delta("x");
        s.upload_hashes.insert("img:1".into(), UploadHash { content_hash: "".into(), size: 3, hash: "h".into() });
        let kv: HashMap<&str, String> = s.to_kv().into_iter().filter_map(|(k, v)| Some((k, v?))).collect();
        assert_eq!(kv[KEY_KNOWN_DELTAS], r#"["x"]"#);
        assert_eq!(kv[KEY_FILE_INDEX], r#"{"token":"t","files":{"a":{"id":"a","name":"n"}}}"#);
        assert_eq!(DriveState::from_kv(|k| kv.get(k).cloned()), s);
    }

    #[test]
    fn lenient_reading() {
        let s = DriveState::from_kv(|k| match k {
            KEY_UPLOADED_SEQ => Some("abc".into()),
            KEY_SYNCED_SEQ => Some("12".into()),
            KEY_FILE_INDEX => Some(r#"{"files":{}}"#.into()),
            KEY_KNOWN_DELTAS => Some("kaputt".into()),
            _ => None,
        });
        assert_eq!((s.uploaded_seq, s.synced_seq, s.index, s.known_deltas.len()), (None, Some(12), None, 0));
    }
}
