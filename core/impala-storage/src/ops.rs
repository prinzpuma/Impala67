//! Fachliche Speicher-Operationen auf jedem [`Storage`]: das, was die App von `DB.*` wirklich nutzt.

use std::collections::HashSet;

use serde_json::Value;

use crate::checkpoint::{self, HeftPart, Loaded};
use crate::event::{self, LogInfo, Object, Seq};
use crate::exchange::{self, COMPACT_FLOOR_KEY, ExportOptions, ImportOptions, ImportReport, PreparedImport};
use crate::storage::{Blob, CheckpointSlot, PartKind, Storage, Write};
use crate::{Error, compaction};

/// Erst nach so vielen neuen Events lohnt die nächste Kompaktierungs-Prüfung – und erst ab so
/// vielen wegfallenden Events wird kompaktiert.
pub const COMPACT_CHECK_STEP: u64 = 200;
pub const COMPACT_CHECKED_SEQ_KEY: &str = "impala67_compact_checked_seq";
/// Blob, der einen Seiten-Reset überlebt (Hintergrundbild).
pub const KEEP_ON_RESET: &str = "bgImage";
/// Event-Typen, die ein Seiten-Reset entfernt (Einstellungen überleben).
pub const PAGE_TYPES: [&str; 18] = [
    "pageCreate",
    "pageUpdate",
    "pageMove",
    "pageDelete",
    "pageTrash",
    "pageRestore",
    "pageArchive",
    "pageUnarchive",
    "heftOps",
    "heftSnap",
    "heftBlob",
    "heftUpdated",
    "gnFolderCreate",
    "gnFolderMove",
    "gnFolderDelete",
    "gnItemMove",
    "uiTreeSet",
    "uiTabsSet",
];

/// Ergebnis einer Kompaktierung.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Compacted {
    pub dropped: usize,
    /// Heft-Bilder, die mit ihren `heftBlob`-Events ganz aus dem Log gefallen sind: Der geladene
    /// Zustand soll sie vergessen (`Model::forget_heft_blobs`), sonst listet sie der Checkpoint weiter.
    pub dropped_blobs: Vec<String>,
}

/// Hash eines `heftBlob`-Events.
fn heft_blob_hash(ev: &Object) -> Option<&str> {
    (event::kind(ev) == "heftBlob").then(|| ev.get("payload")?.get("hash")?.as_str()).flatten()
}

pub trait StorageExt: Storage {
    /// Hängt Events an (alle oder keins). Jedes bekommt eine neue lokale `seq`.
    fn add_events(&mut self, events: Vec<Object>) -> Result<Vec<Seq>, Error> {
        events.iter().try_for_each(event::validate)?;
        self.apply(events.into_iter().map(Write::AddEvent).collect())
    }

    fn all_events(&self) -> Result<Vec<Object>, Error> {
        self.events_after(0, None, None)
    }

    /// Höchste lokale Nummer – Basis des Sync-Wasserstands.
    fn max_seq(&self) -> Result<Seq, Error> {
        Ok(self.log_info()?.max_seq)
    }

    fn put_blob(&mut self, key: &str, blob: Blob) -> Result<(), Error> {
        self.apply(vec![Write::PutBlob(key.into(), blob)]).map(drop)
    }

    fn delete_blob(&mut self, key: &str) -> Result<(), Error> {
        self.apply(vec![Write::DeleteBlob(key.into())]).map(drop)
    }

    fn put_vec(&mut self, key: &str, rec: Value) -> Result<(), Error> {
        self.apply(vec![Write::PutVec(key.into(), rec)]).map(drop)
    }

    fn delete_vec(&mut self, key: &str) -> Result<(), Error> {
        self.apply(vec![Write::DeleteVec(key.into())]).map(drop)
    }

    /// Einmalige v4-Migration: Heft-Events (`heftOps`/`heftSnap`) bis `up_to` atomar durch
    /// vollständige Baselines ersetzen. Neuere Events bleiben (Schutz gegen Rennen); `up_to = 0`
    /// löscht nichts.
    fn replace_heft_history(&mut self, baselines: Vec<Object>, up_to: Seq) -> Result<usize, Error> {
        baselines.iter().try_for_each(event::validate)?;
        let mut writes = Vec::new();
        if up_to > 0 {
            for ev in self.events_after(0, Some(up_to), None)? {
                if matches!(event::kind(&ev), "heftOps" | "heftSnap") {
                    writes.push(Write::DeleteEvent(event::seq(&ev)));
                }
            }
        }
        let n = baselines.len();
        writes.extend(baselines.into_iter().map(Write::AddEvent));
        self.apply(writes)?;
        Ok(n)
    }

    /// Kompaktiert den Log, wenn mindestens `min_drop` Events wegfallen. Welche bleiben,
    /// entscheidet `impala_sync::compact_with`; mit `blobs` (aktueller Heft-Zustand bekannt) fallen
    /// auch Bilder weg, die kein Heft mehr zeigt. Das Event mit der höchsten `seq` bleibt immer
    /// (Wasserstand für Upload-Cursor und Checkpoint). Setzt die Kompaktierungs-Untergrenze.
    fn compact(&mut self, min_drop: usize, now: &str, blobs: Option<&impala_sync::BlobKeep>) -> Result<Compacted, Error> {
        let events = self.all_events()?;
        let Some(keep) = compaction::keep_indices(&events, blobs) else { return Ok(Compacted::default()) };
        if events.len() - keep.len() < min_drop {
            return Ok(Compacted::default());
        }
        let floor = keep.first().map(|&i| event::time(&events[i]).to_owned()).filter(|t| !t.is_empty());
        let mut kept: HashSet<Seq> = keep.iter().map(|&i| event::seq(&events[i])).collect();
        kept.insert(events.iter().map(event::seq).max().unwrap_or(0));
        let (stay, gone): (Vec<&Object>, Vec<&Object>) = events.iter().partition(|ev| kept.contains(&event::seq(ev)));
        if gone.is_empty() {
            return Ok(Compacted::default());
        }
        let still: HashSet<&str> = stay.iter().filter_map(|ev| heft_blob_hash(ev)).collect();
        let mut dropped_blobs: Vec<String> =
            gone.iter().filter_map(|ev| heft_blob_hash(ev)).filter(|h| !still.contains(h)).map(str::to_owned).collect();
        dropped_blobs.sort();
        dropped_blobs.dedup();
        // Ohne Heft-Zustand bleibt der Checkpoint-Teil (der Speicher macht daraus eine Kopie);
        // mit ihm ist sicher, dass kein Heft das Bild zeigt, und der Teil fällt gleich mit.
        let mut writes: Vec<Write> = match blobs {
            Some(_) => dropped_blobs.iter().map(|h| Write::DeletePart(PartKind::HeftBlob, h.clone())).collect(),
            None => Vec::new(),
        };
        writes.extend(gone.iter().map(|ev| Write::DeleteEvent(event::seq(ev))));
        let dropped = gone.len();
        writes.push(Write::SetMeta(COMPACT_FLOOR_KEY.into(), Some(floor.unwrap_or_else(|| now.to_owned()))));
        self.apply(writes)?;
        Ok(Compacted { dropped, dropped_blobs })
    }

    /// Kamen seit der letzten Prüfung genug neue Events für eine Kompaktierung? Billig (zwei Lesungen).
    fn compact_due(&self) -> Result<bool, Error> {
        let top = self.max_seq()?;
        let checked = self.meta(COMPACT_CHECKED_SEQ_KEY)?.and_then(|s| s.parse::<Seq>().ok()).unwrap_or(0).min(top);
        Ok(top - checked >= COMPACT_CHECK_STEP)
    }

    /// Kompaktiert nur, wenn seit der letzten Prüfung genug neue Events kamen (`compactLocalIfDue`).
    fn compact_if_due(&mut self, now: &str, blobs: Option<&impala_sync::BlobKeep>) -> Result<Compacted, Error> {
        if !self.compact_due()? {
            return Ok(Compacted::default());
        }
        let top = self.max_seq()?;
        let result = self.compact(COMPACT_CHECK_STEP as usize, now, blobs)?;
        self.apply(vec![Write::SetMeta(COMPACT_CHECKED_SEQ_KEY.into(), Some(top.to_string()))])?;
        Ok(result)
    }

    /// Seiten-Reset: Seiten-/Heft-Events, Vektoren, Blobs (außer Hintergrundbild) und den
    /// Checkpoint entsorgen – Einstellungen überleben. Ein lokaler Neuanfang, kein Sync-Reset.
    fn clear_pages(&mut self) -> Result<(), Error> {
        // In IndexedDB liegt der Checkpoint im selben Store und fällt dort mit weg. Teile zuerst:
        // Verweise auf gelöschte Bild-Events müssten sonst erst zu Kopien werden.
        let mut writes = vec![
            Write::DeleteCheckpoint(CheckpointSlot::Current),
            Write::DeleteCheckpoint(CheckpointSlot::Legacy),
            Write::ClearParts(PartKind::HeftBlob),
            Write::ClearParts(PartKind::HeftDoc),
        ];
        writes.extend(
            self.all_events()?
                .iter()
                .filter(|ev| PAGE_TYPES.contains(&event::kind(ev)))
                .map(|ev| Write::DeleteEvent(event::seq(ev))),
        );
        writes.push(Write::ClearVecs);
        writes.extend(self.blob_keys()?.into_iter().filter(|k| k != KEEP_ON_RESET).map(Write::DeleteBlob));
        self.apply(writes).map(drop)
    }

    fn export_all(&self, opts: &ExportOptions) -> Result<String, Error> {
        exchange::export_all(self, opts)
    }

    fn prepare_import(&self, data: &Value, opts: &ImportOptions) -> Result<PreparedImport, Error> {
        exchange::prepare(self, data, opts)
    }

    fn commit_import(&mut self, prepared: PreparedImport) -> Result<ImportReport, Error> {
        exchange::commit(self, prepared)
    }

    fn import_all(&mut self, json: &str, opts: &ImportOptions) -> Result<ImportReport, Error> {
        exchange::import_all(self, json, opts)
    }

    fn load_checkpoint(&self, reorder_safe: impl Fn(&Object, Option<&Object>) -> bool) -> Result<Loaded, Error> {
        checkpoint::load(self, reorder_safe)
    }

    /// Speichert einen Checkpoint (`state` = ganzer gespeicherter Zustand inkl. `heftDocs`).
    /// `dirty_blobs`: Heft-Bilder, die noch nicht als Teil liegen. Liefert die Kennzahlen,
    /// mit denen der Checkpoint geschrieben wurde.
    fn save_checkpoint(
        &mut self,
        state: &Object,
        max_time: &str,
        known_blob_sizes: Option<&Object>,
        dirty_blobs: &[(String, String)],
        order_times: Option<&Object>,
    ) -> Result<LogInfo, Error> {
        let empty = Object::new();
        let docs = state.get("heftDocs").and_then(Value::as_object).unwrap_or(&empty);
        let hefte: Vec<HeftPart> = checkpoint::heft_parts(docs);
        self.save_checkpoint_parts(state, max_time, known_blob_sizes, dirty_blobs, order_times, &hefte)
    }

    /// Wie [`save_checkpoint`](Self::save_checkpoint), die Hefte aber schon als Teile (`state` ohne
    /// `heftDocs`). Teile mit leerem Text liegen bereits im Speicher.
    fn save_checkpoint_parts(
        &mut self,
        state: &Object,
        max_time: &str,
        known_blob_sizes: Option<&Object>,
        dirty_blobs: &[(String, String)],
        order_times: Option<&Object>,
        hefte: &[HeftPart],
    ) -> Result<LogInfo, Error> {
        let info = self.log_info()?;
        let cp = checkpoint::make(state, &info, max_time, known_blob_sizes, hefte, order_times);
        checkpoint::write(self, cp, dirty_blobs, hefte)?;
        Ok(info)
    }

    fn clear_checkpoint(&mut self, keep_heft_blobs: bool) -> Result<(), Error> {
        checkpoint::clear(self, keep_heft_blobs)
    }
}

impl<S: Storage + ?Sized> StorageExt for S {}
