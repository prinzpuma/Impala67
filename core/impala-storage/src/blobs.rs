//! Blob-Schlüssel: welche Arten es gibt, wann ein Blob verwaist ist, und der lokale
//! Heft-Verlauf (`heftver:<seite>:<ms>:<rev>`).
//!
//! Schlüsselarten: `img:`/`file:`/`cover:` + UUID oder nackte UUID (Bilder/PDFs, synchronisiert),
//! `pdftext:<pdfId>` (Volltext), `heft:<seite>` (Alt-Heft), `heftver:*` (lokaler Verlauf),
//! sonst gerätespezifisch (`bgImage`) – solche werden nie als verwaist betrachtet.

use std::collections::HashSet;

use serde_json::Value;

use crate::Error;
use crate::event::Object;
use crate::ops::StorageExt;
use crate::storage::Storage;

const PREFIXES: [&str; 3] = ["img:", "file:", "cover:"];

/// 8-4-4-4-12 Hex-Zeichen (Groß/klein egal).
fn is_uuid(s: &[u8]) -> bool {
    s.len() == 36
        && s.iter().enumerate().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => *c == b'-',
            _ => c.is_ascii_hexdigit(),
        })
}

/// `^(?:img:|file:|cover:)?UUID$` (Groß/klein egal).
fn is_exact_ref(s: &str) -> bool {
    let lower = s.get(..6).unwrap_or(s).to_ascii_lowercase();
    let rest = PREFIXES.iter().find(|p| lower.starts_with(*p)).map_or(s, |p| &s[p.len()..]);
    is_uuid(rest.as_bytes())
}

/// Wird der Blob vom Sync übertragen (`isSyncBlobId`)?
pub fn is_sync_blob_id(key: &str) -> bool {
    ["img:", "file:", "cover:", "pdftext:"].iter().any(|p| key.starts_with(p)) || is_uuid(key.as_bytes())
}

/// Prüft Blob-Schlüssel gegen die Texte einer Menge von Seiten (`blobAliveChecker`).
/// Ein Verweis zählt, wenn er in irgendeinem String-Feld einer Seite vorkommt.
pub struct Liveness {
    /// Alle String-Felder, mit `\0` getrennt (kommt in keinem Schlüssel vor).
    text: String,
    /// Alle UUID-Verweise im Text, mit und ohne Präfix – eine Suche statt einer je Blob.
    refs: HashSet<String>,
    /// Seiten-IDs für `heft:<seite>`.
    pages: HashSet<String>,
}

impl Liveness {
    /// Aus `S.pages` (Objekt Seiten-ID → Seite).
    pub fn of_pages(pages: &Object) -> Self {
        let ids = pages.iter().filter(|(_, p)| crate::js::truthy(p)).map(|(k, _)| k.clone()).collect();
        Self::new(pages.values(), ids)
    }

    /// Aus beliebigen Feld-Objekten (z. B. Seitenfassungen im Log); `heft:` zählt dort nicht.
    pub fn of_fields<'a>(fields: impl IntoIterator<Item = &'a Value>) -> Self {
        Self::new(fields, HashSet::new())
    }

    fn new<'a>(objects: impl IntoIterator<Item = &'a Value>, pages: HashSet<String>) -> Self {
        let mut parts: Vec<&str> = Vec::new();
        for obj in objects.into_iter().filter_map(Value::as_object) {
            parts.extend(obj.values().filter_map(Value::as_str).filter(|s| !s.is_empty()));
        }
        let text = parts.join("\0");
        let bytes = text.as_bytes();
        let mut refs = HashSet::new();
        for at in 0..bytes.len().saturating_sub(35) {
            if !is_uuid(&bytes[at..at + 36]) {
                continue;
            }
            refs.insert(text[at..at + 36].to_owned());
            for p in PREFIXES {
                if at >= p.len() && bytes[at - p.len()..at].eq_ignore_ascii_case(p.as_bytes()) {
                    refs.insert(text[at - p.len()..at + 36].to_owned());
                }
            }
        }
        Self { text, refs, pages }
    }

    fn mentions(&self, target: &str) -> bool {
        if target.is_empty() || target.contains('\0') {
            return false;
        }
        if is_exact_ref(target) { self.refs.contains(target) } else { self.text.contains(target) }
    }

    /// `false` = verwaist. Unbekannte Schlüsselarten gelten immer als lebendig (Fail-Safe).
    pub fn is_alive(&self, key: &str) -> bool {
        if key.is_empty() {
            return false;
        }
        if let Some(page) = key.strip_prefix("heft:") {
            return self.pages.contains(page);
        }
        if let Some(pdf) = key.strip_prefix("pdftext:") {
            return self.mentions(pdf);
        }
        if let Some(bare) = key.strip_prefix("cover:") {
            return self.mentions(key) || self.mentions(bare);
        }
        if key.starts_with("img:") || key.starts_with("file:") || is_uuid(key.as_bytes()) {
            return self.mentions(key);
        }
        true
    }
}

/// Verwaiste Blobs (`purgeOrphanBlobs` in boot.js): von keiner aktuellen Seite und keiner
/// Seitenfassung im Log (`pageCreate`-Payload, `pageUpdate`-Patch) referenziert. Der
/// Aufrufer löscht – am besten nach erneuter Prüfung gegen den dann aktuellen Zustand.
pub fn orphans<S: Storage + ?Sized>(storage: &S, pages: &Object) -> Result<Vec<String>, Error> {
    let alive = Liveness::of_pages(pages);
    let candidates: Vec<String> = storage.blob_keys()?.into_iter().filter(|k| !alive.is_alive(k)).collect();
    if candidates.is_empty() {
        return Ok(candidates);
    }
    let events = storage.all_events()?;
    let versions = events.iter().filter_map(|ev| match crate::event::kind(ev) {
        "pageCreate" => ev.get("payload"),
        "pageUpdate" => ev.get("payload").and_then(|p| p.get("patch")),
        _ => None,
    });
    let history = Liveness::of_fields(versions);
    Ok(candidates.into_iter().filter(|k| !history.is_alive(k)).collect())
}

// ---- Heft-Verlauf --------------------------------------------------------------------------

/// Höchstens so viele Verlaufsstände je Heft …
pub const HEFT_VERSION_MAX: usize = 20;
/// … und keine älter als 24 h.
pub const HEFT_VERSION_TTL_MS: u64 = 24 * 60 * 60 * 1000;
/// Neuer Stand frühestens 10 Minuten nach dem letzten.
pub const HEFT_VERSION_GAP_MS: u64 = 10 * 60 * 1000;
/// MIME/Art der Verlaufs-Blobs (`{ type: "application/json", kind: "heftver" }`).
pub const HEFT_VERSION_MIME: &str = "application/json";

/// Ein lokaler Verlaufsstand eines Hefts. Zeit und Revision stecken im Schlüssel,
/// Auflisten braucht deshalb keine Metadaten.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeftVersion {
    pub key: String,
    pub t_ms: u64,
    pub rev: u64,
}

pub fn heft_version_key(page: &str, t_ms: u64, rev: u64) -> String {
    format!("heftver:{page}:{t_ms}:{rev}")
}

/// Verlaufsstände eines Hefts, neueste zuerst (`listSnapshots`).
pub fn heft_versions(keys: &[String], page: &str) -> Vec<HeftVersion> {
    let prefix = format!("heftver:{page}:");
    let mut out: Vec<HeftVersion> = keys
        .iter()
        .filter_map(|k| {
            let mut it = k.strip_prefix(&prefix)?.split(':');
            let num = |s: Option<&str>| s.and_then(|s| s.parse::<f64>().ok()).filter(|f| f.is_finite() && *f >= 0.0);
            let t_ms = num(it.next()).unwrap_or(0.0) as u64;
            let rev = num(it.next()).unwrap_or(0.0) as u64;
            Some(HeftVersion { key: k.clone(), t_ms, rev })
        })
        .collect();
    out.sort_by_key(|v| std::cmp::Reverse(v.t_ms));
    out
}

/// Was beim Aufräumen fällt (`pruneSnapshots`): alles über [`HEFT_VERSION_MAX`] und älter als die TTL.
pub fn heft_versions_to_prune(versions: &[HeftVersion], now_ms: u64) -> Vec<String> {
    let cutoff = now_ms.saturating_sub(HEFT_VERSION_TTL_MS);
    versions
        .iter()
        .enumerate()
        .filter(|(i, v)| *i >= HEFT_VERSION_MAX || v.t_ms < cutoff)
        .map(|(_, v)| v.key.clone())
        .collect()
}

/// Ist ein neuer Verlaufsstand fällig (gedrosselt)?
pub fn heft_version_due(last_ms: Option<u64>, now_ms: u64) -> bool {
    last_ms.is_none_or(|last| now_ms.saturating_sub(last) >= HEFT_VERSION_GAP_MS)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const U: &str = "0a1b2c3d-0000-4000-8000-00000000abcd";

    #[test]
    fn liveness_rules() {
        let pages = json!({
            "p1": { "id": "p1", "content": format!("![](img:{U}) und PDF {}", U.to_uppercase()) },
            "h": { "id": "h", "kind": "heft" },
        });
        let alive = Liveness::of_pages(pages.as_object().unwrap());
        assert!(alive.is_alive(&format!("img:{U}")));
        assert!(alive.is_alive(U));
        assert!(alive.is_alive(&format!("pdftext:{}", U.to_uppercase())));
        assert!(!alive.is_alive(&format!("file:{U}")));
        assert!(alive.is_alive("heft:h"));
        assert!(!alive.is_alive("heft:weg"));
        assert!(alive.is_alive("bgImage"));
        assert!(alive.is_alive("heftver:h:1:2"));
        assert!(!alive.is_alive(""));
    }

    #[test]
    fn heft_version_rules() {
        let keys: Vec<String> = (0..25).map(|i| heft_version_key("p", 1_000_000_000 + i * 1000, i)).collect();
        let v = heft_versions(&keys, "p");
        assert_eq!(v[0].rev, 24);
        assert_eq!(heft_versions_to_prune(&v, 1_000_030_000).len(), 5);
        assert!(heft_version_due(None, 5));
        assert!(!heft_version_due(Some(0), HEFT_VERSION_GAP_MS - 1));
    }
}
