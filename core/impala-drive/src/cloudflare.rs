//! Cloudflare-Zugang in einem Drive-Backup finden, ohne etwas zu importieren.
//!
//! Ein neues Gerät ohne Cloudflare-Schlüssel liest beim ersten Drive-Durchgang zuerst nur die
//! Einstellungen (`settingsSet` mit `cfSyncKey`/`cfUrl`) aus Snapshot und Deltas. Steht dort ein
//! Schlüssel, holt das Gerät den Bestand über Cloudflare (fortsetzbar, in kleinen Paketen) statt
//! das ganze Backup zu importieren und danach alles ein zweites Mal von Cloudflare zu empfangen.

use std::io::Read;

use flate2::read::GzDecoder;
use serde_json::Value;

use crate::DriveError;
use crate::format::Encoding;
use crate::stream::{BATCH_BYTES, EventReader};

/// Zugang zum Cloudflare-Sync aus dem Backup. `url` ist leer, wenn das Backup keine enthält
/// (dann gilt der Standard-Server der App).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CloudflareLogin {
    pub url: String,
    pub key: String,
}

/// Neuester Wert je Feld über alle gelesenen Dateien (nach Event-Zeit `t`).
#[derive(Debug, Default)]
pub(crate) struct Finder {
    key: Option<(String, String)>,
    url: Option<(String, String)>,
}

const NEEDLE: &[u8] = b"\"cfSyncKey\"";

/// Kommt `cfSyncKey` im (entpackten) Text überhaupt vor? Billiger als jedes Event zu parsen –
/// Backups ohne Cloudflare kosten so nur das Entpacken.
fn mentions_key(body: &[u8], encoding: Encoding) -> Result<bool, DriveError> {
    let mut reader: Box<dyn Read + '_> = match encoding {
        Encoding::Gzip => Box::new(GzDecoder::new(body)),
        Encoding::Identity => return Ok(body.windows(NEEDLE.len()).any(|w| w == NEEDLE)),
    };
    let mut buf = vec![0u8; 64 * 1024];
    let mut kept = 0;
    loop {
        let n = reader
            .read(&mut buf[kept..])
            .map_err(|e| DriveError::BadResponse(format!("Datei ist kein gültiges gzip: {e}")))?;
        if n == 0 {
            return Ok(false);
        }
        let end = kept + n;
        if buf[..end].windows(NEEDLE.len()).any(|w| w == NEEDLE) {
            return Ok(true);
        }
        // Überlappung behalten, damit ein Treffer über die Puffergrenze nicht verloren geht.
        kept = (NEEDLE.len() - 1).min(end);
        buf.copy_within(end - kept..end, 0);
    }
}

impl Finder {
    /// Liest eine Datei (Snapshot oder Delta) und merkt sich die neuesten Cloudflare-Einstellungen.
    pub fn scan(&mut self, body: &[u8], encoding: Encoding) -> Result<(), DriveError> {
        if !mentions_key(body, encoding)? {
            return Ok(());
        }
        let mut reader = EventReader::new(body, encoding);
        loop {
            let batch = reader.next_batch(BATCH_BYTES)?;
            batch.events.iter().for_each(|ev| self.note(ev));
            if batch.last {
                return Ok(());
            }
        }
    }

    fn note(&mut self, ev: &Value) {
        if ev.get("type").and_then(Value::as_str) != Some("settingsSet") {
            return;
        }
        let Some(payload) = ev.get("payload").and_then(Value::as_object) else { return };
        let t = ev.get("t").and_then(Value::as_str).unwrap_or("");
        let newer = |slot: &Option<(String, String)>| slot.as_ref().is_none_or(|(seen, _)| t >= seen.as_str());
        let text = |v: &Value| v.as_str().unwrap_or("").trim().to_owned();
        if let Some(v) = payload.get("cfSyncKey").filter(|_| newer(&self.key)) {
            self.key = Some((t.to_owned(), text(v)));
        }
        if let Some(v) = payload.get("cfUrl").filter(|_| newer(&self.url)) {
            self.url = Some((t.to_owned(), text(v)));
        }
    }

    /// Gefundener Zugang; ein später wieder geleerter Schlüssel zählt nicht.
    pub fn login(&self) -> Option<CloudflareLogin> {
        let key = self.key.as_ref().map(|(_, k)| k.clone()).filter(|k| !k.is_empty())?;
        let url = self.url.as_ref().map(|(_, u)| u.clone()).unwrap_or_default();
        Some(CloudflareLogin { url, key })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn file(events: Value) -> Vec<u8> {
        impala_crypto::gzip(json!({ "app": "impala67", "version": 2, "events": events }).to_string().as_bytes())
    }

    #[test]
    fn finds_newest_key_and_url() {
        let mut f = Finder::default();
        f.scan(
            &file(json!([
                { "type": "settingsSet", "t": "2026-01-01", "payload": { "cfUrl": "https://a", "cfSyncKey": "alt" } },
                { "type": "pageCreate", "t": "2026-01-02", "payload": { "cfSyncKey": "nein" } },
            ])),
            Encoding::Gzip,
        )
        .unwrap();
        f.scan(&file(json!([{ "type": "settingsSet", "t": "2026-02-01", "payload": { "cfSyncKey": " neu " } }])), Encoding::Gzip)
            .unwrap();
        // Ein älteres Delta, das später gelesen wird, überschreibt nichts.
        f.scan(&file(json!([{ "type": "settingsSet", "t": "2025-12-01", "payload": { "cfSyncKey": "uralt" } }])), Encoding::Gzip)
            .unwrap();
        assert_eq!(f.login(), Some(CloudflareLogin { url: "https://a".into(), key: "neu".into() }));
    }

    #[test]
    fn cleared_key_or_no_mention_is_no_login() {
        let mut f = Finder::default();
        f.scan(&file(json!([{ "type": "settingsSet", "t": "2026-01-01", "payload": { "theme": "dark" } }])), Encoding::Gzip)
            .unwrap();
        assert_eq!(f.login(), None);
        f.scan(&file(json!([{ "type": "settingsSet", "t": "2026-01-01", "payload": { "cfSyncKey": "k" } }])), Encoding::Gzip)
            .unwrap();
        f.scan(&file(json!([{ "type": "settingsSet", "t": "2026-03-01", "payload": { "cfSyncKey": "" } }])), Encoding::Gzip)
            .unwrap();
        assert_eq!(f.login(), None);
    }

    #[test]
    fn needle_across_buffer_boundary() {
        let pad = "x".repeat(64 * 1024 - 5);
        let text = format!("{{\"pad\":\"{pad}\",\"events\":[{{\"type\":\"settingsSet\",\"t\":\"1\",\"payload\":{{\"cfSyncKey\":\"k\"}}}}]}}");
        assert!(mentions_key(&impala_crypto::gzip(text.as_bytes()), Encoding::Gzip).unwrap());
        assert!(!mentions_key(&impala_crypto::gzip(b"{\"events\":[]}"), Encoding::Gzip).unwrap());
    }
}
