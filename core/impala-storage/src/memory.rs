//! Speicher im Arbeitsspeicher: für Tests und als Vorlage für den IndexedDB-Adapter der PWA.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde_json::Value;

use crate::Error;
use crate::event::{LogInfo, Object, Seq};
use crate::storage::{Blob, CheckpointSlot, PartKind, Storage, Write};

#[derive(Debug, Clone, Default)]
pub struct MemoryStorage {
    /// Events samt `seq`-Feld, wie IndexedDB sie zurückgibt.
    events: BTreeMap<Seq, Object>,
    /// Letzte vergebene Nummer (Schlüsselgenerator, sinkt nie).
    last_seq: Seq,
    blobs: BTreeMap<String, Blob>,
    vecs: BTreeMap<String, Value>,
    checkpoints: HashMap<CheckpointSlot, Object>,
    parts: HashMap<PartKind, BTreeMap<String, String>>,
    meta: HashMap<String, String>,
}

impl MemoryStorage {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Hängt die lokale Nummer hinten an – IndexedDB fügt den keyPath ebenso als letztes Feld ein.
pub(crate) fn with_seq(mut ev: Object, seq: Seq) -> Object {
    ev.shift_remove("seq");
    ev.insert("seq".into(), Value::from(seq));
    ev
}

impl Storage for MemoryStorage {
    fn events_after(&self, after: Seq, up_to: Option<Seq>, limit: Option<usize>) -> Result<Vec<Object>, Error> {
        let upper = up_to.unwrap_or(Seq::MAX);
        if upper <= after {
            return Ok(Vec::new());
        }
        let iter = self.events.range(after + 1..=upper).map(|(_, ev)| ev.clone());
        Ok(match limit {
            Some(n) => iter.take(n).collect(),
            None => iter.collect(),
        })
    }

    fn event_at(&self, seq: Seq) -> Result<Option<Object>, Error> {
        Ok(self.events.get(&seq).cloned())
    }

    fn log_info(&self) -> Result<LogInfo, Error> {
        let last = self.events.iter().next_back();
        Ok(LogInfo {
            count: self.events.len() as u64,
            max_seq: last.map_or(0, |(s, _)| *s),
            last_event_id: last
                .and_then(|(_, ev)| ev.get("id"))
                .filter(|v| crate::js::truthy(v))
                .map(crate::js::to_string)
                .unwrap_or_default(),
        })
    }

    fn known_ids(&self, keys: &[String]) -> Result<HashSet<String>, Error> {
        let wanted: HashSet<&str> = keys.iter().map(String::as_str).collect();
        Ok(self
            .events
            .values()
            .filter_map(|ev| ev.get("id").and_then(crate::event::id_key))
            .filter(|k| wanted.contains(k.as_str()))
            .collect())
    }

    fn blob(&self, key: &str) -> Result<Option<Blob>, Error> {
        Ok(self.blobs.get(key).cloned())
    }

    fn blob_keys(&self) -> Result<Vec<String>, Error> {
        Ok(self.blobs.keys().cloned().collect())
    }

    fn vec(&self, key: &str) -> Result<Option<Value>, Error> {
        Ok(self.vecs.get(key).cloned())
    }

    fn vecs(&self) -> Result<Vec<(String, Value)>, Error> {
        Ok(self.vecs.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
    }

    fn checkpoint(&self, slot: CheckpointSlot) -> Result<Option<Object>, Error> {
        Ok(self.checkpoints.get(&slot).cloned())
    }

    fn part(&self, kind: PartKind, hash: &str) -> Result<Option<String>, Error> {
        Ok(self.parts.get(&kind).and_then(|p| p.get(hash)).cloned())
    }

    fn part_hashes(&self, kind: PartKind) -> Result<Vec<String>, Error> {
        Ok(self.parts.get(&kind).map(|p| p.keys().cloned().collect()).unwrap_or_default())
    }

    fn meta(&self, key: &str) -> Result<Option<String>, Error> {
        Ok(self.meta.get(key).cloned())
    }

    // Keine Operation kann scheitern – damit ist die Liste von selbst atomar.
    fn apply(&mut self, writes: Vec<Write>) -> Result<Vec<Seq>, Error> {
        let mut added = Vec::new();
        for w in writes {
            match w {
                Write::AddEvent(ev) => {
                    self.last_seq += 1;
                    self.events.insert(self.last_seq, with_seq(ev, self.last_seq));
                    added.push(self.last_seq);
                }
                Write::DeleteEvent(seq) => {
                    self.events.remove(&seq);
                }
                Write::PutBlob(k, b) => {
                    self.blobs.insert(k, b);
                }
                Write::DeleteBlob(k) => {
                    self.blobs.remove(&k);
                }
                Write::PutVec(k, v) => {
                    self.vecs.insert(k, v);
                }
                Write::DeleteVec(k) => {
                    self.vecs.remove(&k);
                }
                Write::ClearVecs => self.vecs.clear(),
                Write::PutCheckpoint(slot, cp) => {
                    self.checkpoints.insert(slot, cp);
                }
                Write::DeleteCheckpoint(slot) => {
                    self.checkpoints.remove(&slot);
                }
                Write::PutPart(kind, hash, data) => {
                    self.parts.entry(kind).or_default().insert(hash, data);
                }
                Write::DeletePart(kind, hash) => {
                    if let Some(p) = self.parts.get_mut(&kind) {
                        p.remove(&hash);
                    }
                }
                Write::ClearParts(kind) => {
                    self.parts.remove(&kind);
                }
                Write::SetMeta(k, Some(v)) => {
                    self.meta.insert(k, v);
                }
                Write::SetMeta(k, None) => {
                    self.meta.remove(&k);
                }
            }
        }
        Ok(added)
    }
}
