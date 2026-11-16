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

/// Ein Checkpoint zum Speichern: ein JSON-Objekt aus `head` und den Feldern in `raw`. Die großen
/// Felder (`state`, `orderTimes`) liegen in `raw` schon als JSON-Text vor – für sie entsteht nie
/// ein `Value`-Baum, der nur gebaut würde, um gleich wieder Text zu werden.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct CheckpointRecord {
    pub head: Object,
    /// (Feldname, JSON-Text des Werts). Namen sind schlichte ASCII-Bezeichner und fehlen in `head`.
    pub raw: Vec<(&'static str, String)>,
}

impl From<Object> for CheckpointRecord {
    fn from(head: Object) -> Self {
        CheckpointRecord { head, raw: Vec::new() }
    }
}

impl CheckpointRecord {
    /// Der gespeicherte JSON-Text.
    pub fn into_json(self) -> String {
        let head = Value::Object(self.head).to_string();
        if self.raw.is_empty() {
            return head;
        }
        let extra: usize = self.raw.iter().map(|(k, v)| k.len() + v.len() + 4).sum();
        let mut out = String::with_capacity(head.len() + extra);
        out.push_str(head.strip_suffix('}').unwrap_or(&head));
        let mut first = head == "{}";
        for (key, json) in &self.raw {
            if !first {
                out.push(',');
            }
            first = false;
            out.push('"');
            out.push_str(key);
            out.push_str("\":");
            out.push_str(json);
        }
        out.push('}');
        out
    }

    /// Als Objekt, wie ein Leser den gespeicherten Text sieht.
    pub fn to_object(&self) -> Result<Object, Error> {
        let mut cp = self.head.clone();
        for (key, json) in &self.raw {
            let value = serde_json::from_str(json).map_err(|e| Error::Json(e.to_string()))?;
            cp.insert((*key).to_owned(), value);
        }
        Ok(cp)
    }
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
    PutCheckpoint(CheckpointSlot, CheckpointRecord),
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
    /// Nur die eigenen Events ([`crate::event::is_own`]) mit `seq > after`, aufsteigend. Grundlage
    /// der Konflikt-Prüfung beim Import; übernommene Events liest sie nie.
    fn own_events_after(&self, after: Seq) -> Result<Vec<Object>, Error> {
        let mut out = self.events_after(after, None, None)?;
        out.retain(crate::event::is_own);
        Ok(out)
    }
    /// Das ganze Log zum einmaligen Abspielen beim Start (Voll-Replay). Ein Speicher, der die
    /// Events schon im Arbeitsspeicher hält (WASM: vorab aus IndexedDB gereicht), darf sie
    /// abgeben statt sie zu kopieren und liefert sie danach nicht mehr.
    fn take_all_events(&mut self) -> Result<Vec<Object>, Error> {
        self.events_after(0, None, None)
    }
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
    /// Wie [`Storage::vecs`], aber je Eintrag nur `updated`, `model` und `providerId` – ohne die
    /// Vektoren (Planung der Indexierung, läuft unter der Kern-Sperre).
    fn vec_headers(&self) -> Result<Vec<(String, Value)>, Error> {
        Ok(self
            .vecs()?
            .into_iter()
            .map(|(k, v)| {
                let pick = |f: &str| v.get(f).cloned().unwrap_or(Value::Null);
                (k, serde_json::json!({ "updated": pick("updated"), "model": pick("model"), "providerId": pick("providerId") }))
            })
            .collect())
    }

    fn checkpoint(&self, slot: CheckpointSlot) -> Result<Option<Object>, Error>;
    fn part(&self, kind: PartKind, hash: &str) -> Result<Option<String>, Error>;
    fn part_hashes(&self, kind: PartKind) -> Result<Vec<String>, Error>;

    fn meta(&self, key: &str) -> Result<Option<String>, Error>;

    /// Führt alle Schreiboperationen atomar aus. Liefert die neu vergebenen `seq` der
    /// `AddEvent`-Einträge in ihrer Reihenfolge. Nummern werden nie wiederverwendet,
    /// auch nicht nach dem Löschen des höchsten Events (wie der IndexedDB-Schlüsselgenerator).
    fn apply(&mut self, writes: Vec<Write>) -> Result<Vec<Seq>, Error>;
}
