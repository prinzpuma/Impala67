//! Der `Storage`-Trait: wenige, grobe Grundoperationen über die Stores der App.
//!
//! | Store        | Inhalt                                               | IndexedDB (PWA)                  |
//! |--------------|------------------------------------------------------|----------------------------------|
//! | Events       | Event-Log (Quelle der Wahrheit), Schlüssel `seq`     | `events` (keyPath `seq`, autoInc)|
//! | Blobs        | Bilder, PDFs, Heft-Versionen (`heftver:*`)           | `blobs` → `{ buf, meta }`        |
//! | Vecs         | Embeddings der KI-Suche (lokal neu berechenbar)      | `vecs`                           |
//! | Checkpoint   | Start-Schnappschuss + Heft-Teile (abgeleitet)        | reservierte Schlüssel in `blobs` |
//! | Meta         | gerätelokale Marken (Kompaktierungs-Untergrenze …)   | `localStorage`                   |
//!
//! Alles Fachliche (Import, Kompaktierung, Checkpoints) baut in [`crate::StorageExt`] auf diesen
//! Grundoperationen auf. Ein Web-Adapter über IndexedDB muss deshalb nur sie umsetzen.

use std::collections::HashSet;

use serde_json::Value;

use crate::Error;
use crate::event::{LogInfo, Object, Seq};

/// Ein gespeicherter Blob: Bytes plus die Metadaten, die der Aufrufer mitgab
/// (`{ name?, size?, type? }`; `type` ist der MIME-Typ). Alt-Datensätze haben keine.
#[derive(Debug, Clone, PartialEq)]
pub struct Blob {
    pub bytes: Vec<u8>,
    pub meta: Option<Value>,
}

impl Blob {
    /// MIME-Typ aus `meta.type` (leer, wenn unbekannt).
    pub fn mime(&self) -> &str {
        self.meta.as_ref().and_then(|m| m.get("type")).and_then(Value::as_str).unwrap_or("")
    }
}

/// Wo ein Checkpoint liegt: aktuell (`__impala67_state_checkpoint_v2__`) oder Alt-Format 1 (`…_v1__`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CheckpointSlot {
    Current,
    Legacy,
}

/// Inhaltsadressierte Checkpoint-Teile (Schlüssel = Hash, Wert = Text).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PartKind {
    /// Heft-Bild als dataURL (`__impala67_state_checkpoint_v2_blob__:<hash>`).
    HeftBlob,
    /// Ein Heft als JSON-Text (`__impala67_state_checkpoint_v3_heft__:<sha256>`).
    HeftDoc,
}

/// Eine Schreiboperation. [`Storage::apply`] führt eine Liste davon atomar aus.
#[derive(Debug, Clone, PartialEq)]
pub enum Write {
    /// Hängt ein Event an; es bekommt immer eine neue lokale `seq` (ein mitgebrachtes `seq` zählt nicht).
    AddEvent(Object),
    DeleteEvent(Seq),
    PutBlob(String, Blob),
    DeleteBlob(String),
    PutVec(String, Value),
    DeleteVec(String),
    ClearVecs,
    PutCheckpoint(CheckpointSlot, Object),
    DeleteCheckpoint(CheckpointSlot),
    PutPart(PartKind, String, String),
    DeletePart(PartKind, String),
    ClearParts(PartKind),
    /// `None` löscht den Eintrag.
    SetMeta(String, Option<String>),
}

/// Grundoperationen eines Speichers. Lesende Aufrufe sehen einen konsistenten Stand;
/// [`apply`](Storage::apply) ist alles-oder-nichts. `&mut self` serialisiert Schreiber im Prozess.
pub trait Storage {
    /// Events mit `after < seq <= up_to` in `seq`-Reihenfolge, höchstens `limit` Stück.
    /// Jedes Objekt trägt seine lokale Nummer im Feld `seq` (wie IndexedDB).
    fn events_after(&self, after: Seq, up_to: Option<Seq>, limit: Option<usize>) -> Result<Vec<Object>, Error>;
    fn event_at(&self, seq: Seq) -> Result<Option<Object>, Error>;
    fn log_info(&self) -> Result<LogInfo, Error>;
    /// Welche der Schlüssel ([`crate::event::id_key`]) schon als Event-`id` vorkommen.
    fn known_ids(&self, keys: &[String]) -> Result<HashSet<String>, Error> {
        let wanted: HashSet<&str> = keys.iter().map(String::as_str).collect();
        let mut found = HashSet::new();
        for ev in self.events_after(0, None, None)? {
            if let Some(k) = ev.get("id").and_then(crate::event::id_key)
                && wanted.contains(k.as_str())
            {
                found.insert(k);
            }
        }
        Ok(found)
    }

    fn blob(&self, key: &str) -> Result<Option<Blob>, Error>;
    /// Alle Blob-Schlüssel, aufsteigend sortiert. Checkpoint-Einträge zählen nicht dazu.
    fn blob_keys(&self) -> Result<Vec<String>, Error>;

    fn vec(&self, key: &str) -> Result<Option<Value>, Error>;
    fn vecs(&self) -> Result<Vec<(String, Value)>, Error>;

    fn checkpoint(&self, slot: CheckpointSlot) -> Result<Option<Object>, Error>;
    fn part(&self, kind: PartKind, hash: &str) -> Result<Option<String>, Error>;
    fn part_hashes(&self, kind: PartKind) -> Result<Vec<String>, Error>;

    fn meta(&self, key: &str) -> Result<Option<String>, Error>;

    /// Führt alle Schreiboperationen atomar aus. Liefert die neu vergebenen `seq` der
    /// `AddEvent`-Einträge in ihrer Reihenfolge. Nummern werden nie wiederverwendet,
    /// auch nicht nach dem Löschen des höchsten Events (wie der IndexedDB-Schlüsselgenerator).
    fn apply(&mut self, writes: Vec<Write>) -> Result<Vec<Seq>, Error>;
}
