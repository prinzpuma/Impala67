//! Blob-IDs und Lebendprüfung (`isSyncBlobId`, `blobAliveChecker` in `web/sync-core.js`).

use std::collections::HashSet;
use std::sync::OnceLock;

use serde_json::{Map, Value};

use crate::js::truthy;

const UUID_LEN: usize = 36;
const REF_PREFIXES: [&str; 3] = ["img:", "file:", "cover:"];

/// UUID `8-4-4-4-12` (Hex, Groß-/Kleinschreibung egal) am Anfang von `s`.
fn uuid_at(s: &[u8]) -> bool {
    s.len() >= UUID_LEN
        && s[..UUID_LEN]
            .iter()
            .enumerate()
            .all(|(i, b)| if matches!(i, 8 | 13 | 18 | 23) { *b == b'-' } else { b.is_ascii_hexdigit() })
}

fn is_uuid(s: &str) -> bool {
    s.len() == UUID_LEN && uuid_at(s.as_bytes())
}

/// Präfix (`img:`, `file:`, `cover:`, Groß-/Kleinschreibung egal) direkt vor Position `end`.
fn ref_prefix_before(text: &[u8], end: usize) -> Option<usize> {
    REF_PREFIXES
        .iter()
        .find(|p| end >= p.len() && text[end - p.len()..end].eq_ignore_ascii_case(p.as_bytes()))
        .map(|p| end - p.len())
}

/// Blobs, die der Cloudflare-Sync überträgt: Bilder, Dateien, Cover, PDF-Text, Heft-Bilder (UUID).
pub fn is_sync_blob_id(id: &str) -> bool {
    ["img:", "file:", "cover:", "pdftext:"].iter().any(|p| id.starts_with(p)) || is_uuid(id)
}

/// Undurchsichtiger Server-Schlüssel eines Blobs (verrät die ID nicht).
pub fn blob_opaque_key(id: &str) -> String {
    impala_crypto::sha256_hex(&format!("impala67_blob:{id}"))
}

/// Prüft, ob ein lokaler Blob noch von einer Seite verwendet wird. Die Seitentexte werden
/// einmal eingesammelt; UUID-Verweise landen bei Bedarf in einer Menge (ein Durchlauf statt
/// eines Textvergleichs je Blob).
pub struct BlobAliveChecker<'a> {
    pages: &'a Map<String, Value>,
    /// Alle nicht-leeren Text-Felder aller Seiten, getrennt durch `\0`.
    text: String,
    refs: OnceLock<HashSet<String>>,
}

impl<'a> BlobAliveChecker<'a> {
    pub fn new(pages: &'a Map<String, Value>) -> Self {
        let mut strings = Vec::new();
        for page in pages.values() {
            if let Value::Object(fields) = page {
                strings.extend(fields.values().filter_map(Value::as_str).filter(|s| !s.is_empty()));
            }
        }
        BlobAliveChecker { pages, text: strings.join("\0"), refs: OnceLock::new() }
    }

    /// Alle Teiltexte der Form `[img:|file:|cover:]UUID` (auch überlappend), wie `BLOB_REF_SCAN`.
    fn refs(&self) -> &HashSet<String> {
        self.refs.get_or_init(|| {
            let text = self.text.as_bytes();
            let mut refs = HashSet::new();
            for at in 0..text.len().saturating_sub(UUID_LEN - 1) {
                if text[at + 8] != b'-' || !uuid_at(&text[at..]) {
                    continue;
                }
                // ASCII-Treffer liegen immer auf Zeichengrenzen.
                refs.insert(self.text[at..at + UUID_LEN].to_owned());
                if let Some(start) = ref_prefix_before(text, at) {
                    refs.insert(self.text[start..at + UUID_LEN].to_owned());
                }
            }
            refs
        })
    }

    /// Kommt `target` in einem Seitentext vor?
    fn referenced(&self, target: &str) -> bool {
        if target.is_empty() || target.contains('\0') {
            return false;
        }
        let exact = match REF_PREFIXES
            .iter()
            .find(|p| target.len() > p.len() && target.as_bytes()[..p.len()].eq_ignore_ascii_case(p.as_bytes()))
        {
            Some(p) => is_uuid(&target[p.len()..]),
            None => is_uuid(target),
        };
        if exact { self.refs().contains(target) } else { self.text.contains(target) }
    }

    pub fn is_alive(&self, key: &str) -> bool {
        if key.is_empty() {
            return false;
        }
        if let Some(page) = key.strip_prefix("heft:") {
            return truthy(self.pages.get(page));
        }
        if let Some(target) = key.strip_prefix("pdftext:") {
            return self.referenced(target);
        }
        if let Some(rest) = key.strip_prefix("cover:") {
            return self.referenced(key) || self.referenced(rest);
        }
        if key.starts_with("img:") || key.starts_with("file:") || is_uuid(key) {
            return self.referenced(key);
        }
        true // Fail-Safe: gerätespezifische Spezialschlüssel ("bgImage", "heftver:…") nie löschen
    }
}

/// Datei-Verweise eines lokalen Seiten-Events (`hasUnsyncedBlobRef`): Cover, PDF und
/// `img:`/`file:`/`cover:`-Verweise im Inhalt.
pub fn blob_refs_in_event(ev: &Value) -> Vec<String> {
    let fields = match ev.get("type").and_then(Value::as_str) {
        Some("pageCreate") => ev.get("payload"),
        Some("pageUpdate") => ev.get("payload").and_then(|p| p.get("patch")),
        _ => None,
    };
    let Some(fields) = fields.filter(|f| truthy(Some(f))) else { return Vec::new() };
    let mut refs: Vec<String> = ["coverImg", "pdfId"]
        .iter()
        .filter_map(|k| fields.get(*k).filter(|v| truthy(Some(v))))
        .map(|v| impala_crypto::json::js_string(Some(v)))
        .collect();
    if let Some(content) = fields.get("content").and_then(Value::as_str) {
        refs.extend(scan_content_refs(content));
    }
    refs
}

/// `/(?:img|file|cover):[^\s)"'<>\]]+/g`
fn scan_content_refs(content: &str) -> Vec<String> {
    let stop = |c: char| js_space(c) || matches!(c, ')' | '"' | '\'' | '<' | '>' | ']');
    let mut out = Vec::new();
    let mut at = 0;
    while at < content.len() {
        let rest = &content[at..];
        let prefix = ["img:", "file:", "cover:"].iter().find(|p| rest.starts_with(**p));
        if let Some(p) = prefix {
            let body = &rest[p.len()..];
            let len = body.find(stop).unwrap_or(body.len());
            if len > 0 {
                out.push(rest[..p.len() + len].to_owned());
                at += p.len() + len;
                continue;
            }
        }
        at += rest.chars().next().map_or(1, char::len_utf8);
    }
    out
}

/// JS `\s`: Unicode-Leerraum samt U+FEFF, ohne U+0085.
fn js_space(c: char) -> bool {
    (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}'
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const U: &str = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

    #[test]
    fn alive_rules() {
        let pages = json!({
            "p1": { "content": format!("![](img:{U}) und cover:{}", U.to_uppercase()), "n": 3 },
            "p2": { "content": "file:abc.pdf" },
            "h": { "kind": "heft" },
        });
        let pages = pages.as_object().unwrap();
        let alive = BlobAliveChecker::new(pages);
        assert!(alive.is_alive(&format!("img:{U}")));
        assert!(alive.is_alive(U));
        assert!(alive.is_alive(&U.to_uppercase()));
        assert!(alive.is_alive(&format!("cover:{}", U.to_uppercase())));
        assert!(!alive.is_alive(&format!("file:{U}")));
        assert!(alive.is_alive("file:abc.pdf"));
        assert!(alive.is_alive("pdftext:file:abc.pdf"));
        assert!(alive.is_alive("heft:h"));
        assert!(!alive.is_alive("heft:x"));
        assert!(alive.is_alive("bgImage"));
        assert!(!alive.is_alive(""));
        assert!(!alive.is_alive("img:\0"));
    }

    #[test]
    fn sync_ids_and_refs() {
        assert!(
            is_sync_blob_id("img:x") && is_sync_blob_id(U) && !is_sync_blob_id("heft:x") && !is_sync_blob_id("IMG:x")
        );
        let ev = json!({"type": "pageUpdate", "payload": {"id": "p", "patch": {"coverImg": "cover:1", "content": "a img:x.png) b file:y\u{a0}c cover:"}}});
        assert_eq!(blob_refs_in_event(&ev), ["cover:1", "img:x.png", "file:y"]);
        assert!(blob_refs_in_event(&json!({"type": "pageDelete", "payload": {"coverImg": "x"}})).is_empty());
    }
}
