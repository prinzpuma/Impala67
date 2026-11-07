//! Lokaler Speicher sauber halten (wie `DB.compactLocalIfDue` und `DB.storageCheck` der PWA):
//! Event-Log kompaktieren – samt Heft-Bildern, die kein Heft mehr zeigt – und auf Nachfrage
//! prüfen, ob etwas doppelt oder verwaist liegt.

use std::collections::HashSet;

use impala_srs::Timestamp;
use impala_storage::{BlobKeep, Compacted, StorageExt};

use crate::{CoreError, ImpalaCore, Inner, Shared};

/// Schonfrist: neuere Bilder und Heft-Events zählen immer (Rückgängig, Heft-Versionen, Geräte,
/// deren Änderungen noch nicht angekommen sind).
const HEFT_BLOB_GRACE_MS: i64 = 7 * 24 * 60 * 60 * 1000;

/// Ergebnis von [`ImpalaCore::storage_check`]; im Normalfall alles 0.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct StorageCheckInfo {
    /// Heft-Bilder, die der Checkpoint als Kopie statt als Verweis hält, obwohl sie im Log liegen.
    pub checkpoint_copies: u64,
    pub checkpoint_copies_bytes: u64,
    /// Verweise auf ein Event, das es nicht mehr gibt.
    pub dead_pointers: u64,
    /// Bilder ohne Heftseite, älter als die Schonfrist (fallen bei der nächsten Kompaktierung).
    pub orphan_images: u64,
    pub orphan_images_bytes: u64,
    pub ok: bool,
}

impl Inner {
    /// Bilder, die ein Heft gerade zeigt, plus Schonfrist – nur, wenn der Zustand sortiert geladen
    /// ist. Sonst `None`: Dann behält die Kompaktierung jedes je referenzierte Bild (alte Regel).
    fn heft_blob_keep(&mut self) -> Option<(HashSet<String>, String)> {
        if !self.model.replay_ordered() {
            return None;
        }
        let live = self.model.state().hefte.referenced_blobs().into_iter().map(str::to_owned).collect();
        let now = Timestamp::parse_iso(&self.clock.now()).map_or(0, Timestamp::millis);
        Some((live, Timestamp::from_millis(now - HEFT_BLOB_GRACE_MS).to_iso()))
    }

    /// Kompaktiert den Log (`force`: sofort, sonst nur wenn fällig). Weggefallene Bilder vergisst
    /// der Zustand; danach gleich ein neuer Checkpoint, sonst spielt der nächste Start alles neu ab.
    pub(crate) fn compact_local(&mut self, force: bool) -> Result<usize, CoreError> {
        let now = self.clock.now();
        let keep = self.heft_blob_keep();
        let blobs = keep.as_ref().map(|(live, since)| BlobKeep { live, since });
        let Compacted { dropped, dropped_blobs } = if force {
            self.storage.compact(1, &now, blobs.as_ref())?
        } else {
            self.storage.compact_if_due(&now, blobs.as_ref())?
        };
        if dropped > 0 {
            self.model.forget_heft_blobs(&dropped_blobs);
            self.model.save_checkpoint(&mut self.storage)?;
        }
        // Gelöschte Events und ersetzte Checkpoints geben ihren Platz erst hier frei.
        self.storage.reclaim()?;
        Ok(dropped)
    }
}

/// Nach einem Sync-Durchgang (Cloudflare, Drive): kompaktieren, wenn fällig. Fehler sind harmlos
/// (Kompaktierung ist optional) und werden nur übersprungen.
pub(crate) fn compact_if_due(shared: &Shared) {
    let _ = crate::lock(shared).compact_local(false);
}

#[uniffi::export]
impl ImpalaCore {
    /// Event-Log jetzt verdichten (Speicher-Einstellungen); liefert die Zahl entfernter Events.
    pub fn compact_local(&self) -> Result<u64, CoreError> {
        Ok(self.lock().compact_local(true)? as u64)
    }

    /// Kontrolle gegen doppelten oder verwaisten Speicher (Speicheranzeige). Liest alle Bild-Events
    /// einmal: nur auf Nachfrage aufrufen, nie beim Start.
    pub fn storage_check(&self) -> Result<StorageCheckInfo, CoreError> {
        let mut inner = self.lock();
        let keep = inner.heft_blob_keep();
        let blobs = keep.as_ref().map(|(live, since)| BlobKeep { live, since });
        let c = inner.storage.storage_check(blobs.as_ref())?;
        Ok(StorageCheckInfo {
            checkpoint_copies: c.checkpoint_copies,
            checkpoint_copies_bytes: c.checkpoint_copies_bytes,
            dead_pointers: c.dead_pointers,
            orphan_images: c.orphan_images,
            orphan_images_bytes: c.orphan_images_bytes,
            ok: c.ok(),
        })
    }
}

#[cfg(test)]
mod tests {
    use impala_storage::Storage;
    use serde_json::json;

    use super::*;

    #[test]
    fn verwaiste_heft_bilder_fallen_nach_der_schonfrist() {
        let core = ImpalaCore::open_in_memory().unwrap();
        {
            let mut inner = core.lock();
            let old = |id: &str, kind: &str, payload: serde_json::Value| {
                json!({ "id": id, "t": "2020-01-01T00:00:00.000Z", "type": kind, "payload": payload })
                    .as_object()
                    .cloned()
                    .unwrap()
            };
            let ops = |id: &str, ops: serde_json::Value| old(id, "heftOps", json!({ "pageId": "h", "ops": ops }));
            inner
                .storage
                .add_events(vec![
                    old("p", "pageCreate", json!({ "id": "h", "title": "H", "kind": "heft" })),
                    old("a", "heftBlob", json!({ "hash": "A", "data": "data:A" })),
                    old("b", "heftBlob", json!({ "hash": "B", "data": "data:B" })),
                    ops("o1", json!([{ "t": "pg+", "page": { "id": "p" } },
                                     { "t": "i+", "p": "p", "o": { "id": "ia", "ref": "A", "x": 0, "y": 0, "w": 1, "h": 1 } },
                                     { "t": "i+", "p": "p", "o": { "id": "ib", "ref": "B", "x": 0, "y": 0, "w": 1, "h": 1 } }])),
                    ops("o2", json!([{ "t": "i-", "p": "p", "ids": ["ia"] }])),
                ])
                .unwrap();
            inner.reload().unwrap();
            assert!(inner.model.has_heft_blob("A"));
        }
        assert_eq!(core.storage_check().unwrap().orphan_images, 1);
        assert!(core.compact_local().unwrap() >= 1);
        let inner = core.lock();
        assert!(!inner.model.has_heft_blob("A"), "vergessen");
        assert!(inner.model.has_heft_blob("B"), "sichtbar, bleibt");
        assert_eq!(inner.storage.part(impala_storage::PartKind::HeftBlob, "A").unwrap(), None);
        assert_eq!(inner.storage.part(impala_storage::PartKind::HeftBlob, "B").unwrap().as_deref(), Some("data:B"));
        drop(inner);
        assert!(core.storage_check().unwrap().ok);
    }
}
