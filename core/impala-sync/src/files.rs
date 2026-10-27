//! Hilfen für dateibasierte Transporte (Drive): bekannte Dateien, neuester Snapshot, JSON+gzip.

use std::collections::HashSet;

use impala_crypto::{gunzip, gzip};
use serde_json::Value;

use crate::SyncError;

/// Eine entfernte Datei (Drive-Dateiliste).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteFile {
    pub id: String,
    pub name: String,
    /// RFC 3339, wie von Drive geliefert; leer wenn unbekannt.
    pub modified_time: String,
}

/// `unseenRemoteFiles`: Dateien mit ID, die noch nicht verarbeitet wurden (Reihenfolge bleibt).
pub fn unseen_remote_files<'a>(files: &'a [RemoteFile], known: &HashSet<String>) -> Vec<&'a RemoteFile> {
    files.iter().filter(|f| !f.id.is_empty() && !known.contains(&f.id)).collect()
}

/// `newestFile`: neueste Datei mit einem der Namen; bei Gleichstand die erste.
// JS verglich mit `localeCompare` (gebietsschemaabhängig); für RFC-3339-Zeiten ist das dieselbe
// Ordnung wie der Codepunktvergleich hier.
pub fn newest_file<'a>(files: &'a [RemoteFile], names: &[&str]) -> Option<&'a RemoteFile> {
    files.iter().filter(|f| names.contains(&f.name.as_str())).fold(None, |best: Option<&RemoteFile>, f| match best {
        Some(b) if f.modified_time <= b.modified_time => Some(b),
        _ => Some(f),
    })
}

/// `boundedKnownIds`: eindeutige IDs (erstes Auftreten zählt), davon die letzten `max`
/// (0 = Standard 2000, wie `Number(max) || 2000`).
pub fn bounded_known_ids(ids: &[String], max: usize) -> Vec<String> {
    let max = if max == 0 { 2000 } else { max };
    let mut seen = HashSet::new();
    let unique: Vec<&String> = ids.iter().filter(|id| seen.insert(id.as_str())).collect();
    let skip = unique.len().saturating_sub(max);
    unique[skip..].iter().map(|s| (*s).clone()).collect()
}

/// Kodierung einer JSON-Datei (Drive `appProperties.encoding`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Encoding {
    Gzip,
    Identity,
}

impl Encoding {
    pub fn as_str(self) -> &'static str {
        match self {
            Encoding::Gzip => "gzip",
            Encoding::Identity => "identity",
        }
    }

    /// Unbekannte Angaben zählen wie in JS als unkomprimiert.
    pub fn parse(s: &str) -> Encoding {
        if s == "gzip" { Encoding::Gzip } else { Encoding::Identity }
    }
}

/// `encodeJsonText`: schon serialisiertes JSON gzippen. Rust hat gzip immer, JS fiel ohne
/// `CompressionStream` auf `identity` zurück.
pub fn encode_json_text(text: &str) -> (Vec<u8>, Encoding) {
    (gzip(text.as_bytes()), Encoding::Gzip)
}

/// `decodeJson`.
pub fn decode_json(bytes: &[u8], encoding: Encoding) -> Result<Value, SyncError> {
    let plain = match encoding {
        Encoding::Gzip => gunzip(bytes)?,
        Encoding::Identity => bytes.to_vec(),
    };
    serde_json::from_slice(&plain).map_err(|e| SyncError::BadResponse(format!("Datei ist kein gültiges JSON: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(id: &str, name: &str, t: &str) -> RemoteFile {
        RemoteFile { id: id.into(), name: name.into(), modified_time: t.into() }
    }

    #[test]
    fn file_helpers() {
        let files =
            [f("1", "a", "2026-01-02"), f("", "a", "2026-03-01"), f("3", "b", "2026-05-01"), f("4", "a", "2026-01-02")];
        let known: HashSet<String> = ["1".to_owned()].into();
        assert_eq!(unseen_remote_files(&files, &known).iter().map(|f| f.id.as_str()).collect::<Vec<_>>(), ["3", "4"]);
        assert_eq!(newest_file(&files, &["a"]).unwrap().modified_time, "2026-03-01");
        assert_eq!(newest_file(&files[..1], &["x"]), None);
        assert_eq!(newest_file(&[files[0].clone(), files[3].clone()], &["a"]).unwrap().id, "1");
        let ids: Vec<String> = ["a", "b", "a", "c", "d"].map(String::from).to_vec();
        assert_eq!(bounded_known_ids(&ids, 2), ["c", "d"]);
        assert_eq!(bounded_known_ids(&ids, 1), ["d"]);
        assert_eq!(bounded_known_ids(&ids, 0), ["a", "b", "c", "d"]);
    }

    #[test]
    fn json_roundtrip() {
        let (bytes, enc) = encode_json_text(r#"{"a":[1,2]}"#);
        assert_eq!(decode_json(&bytes, enc).unwrap(), serde_json::json!({"a": [1, 2]}));
        assert_eq!(decode_json(b"[]", Encoding::parse("identity")).unwrap(), serde_json::json!([]));
    }
}
