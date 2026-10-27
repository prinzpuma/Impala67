//! Start-Checkpoint: Schnappschuss des gespeicherten Zustands mit Event-Nummer, damit beim Start
//! nur der Rest des Logs nachgespielt wird. Abgeleitet und jederzeit aus dem Log neu erzeugbar.
//!
//! Formate (gelesen werden alle, geschrieben wird nur das aktuelle):
//! - 1: alles in einem Objekt (`state` mit allen [`KEYS`], auch `heftBlobs`).
//! - 2: Heft-Bilder als eigene Teile ([`PartKind::HeftBlob`]), alle Hefte als ein JSON-Text `heftDocsJson`.
//! - 3: zusätzlich jedes Heft als eigener, per SHA-256 adressierter JSON-Text ([`PartKind::HeftDoc`]).

use std::collections::HashSet;

use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::event::{LogInfo, Object};
use crate::storage::{CheckpointSlot, PartKind, Storage, Write};
use crate::{Error, js};

pub const FORMAT: u64 = 3;
pub const HEFT_JSON_FORMAT: u64 = 2;
pub const LEGACY_FORMAT: u64 = 1;

/// Gespeicherte Teile des Zustands (`STATE_CHECKPOINT_KEYS`).
pub const KEYS: [&str; 17] = [
    "pages",
    "cards",
    "grades",
    "learningSessions",
    "chatSessions",
    "homeArticles",
    "settings",
    "decks",
    "workspaces",
    "gnFolders",
    "treeOpen",
    "tabs",
    "activeTabId",
    "reviews",
    "telemetry",
    "heftDocs",
    "heftBlobs",
];

/// Kernzustand ab Format 2: ohne `heftBlobs` (die liegen als Teile daneben).
pub fn core_keys() -> impl Iterator<Item = &'static str> {
    KEYS.into_iter().filter(|k| *k != "heftBlobs")
}

/// Reservierte Schlüssel im IndexedDB-Store `blobs` (für den Web-Adapter und den Import).
pub const LEGACY_KEY: &str = "__impala67_state_checkpoint_v1__";
pub const CURRENT_KEY: &str = "__impala67_state_checkpoint_v2__";
pub const BLOB_PREFIX: &str = "__impala67_state_checkpoint_v2_blob__:";
pub const HEFT_PREFIX: &str = "__impala67_state_checkpoint_v3_heft__:";

/// Gehört der Blob-Schlüssel zum Checkpoint (nie exportieren, nie importieren)?
pub fn is_checkpoint_key(key: &str) -> bool {
    key == LEGACY_KEY || key == CURRENT_KEY || key.starts_with(BLOB_PREFIX) || key.starts_with(HEFT_PREFIX)
}

/// Warum ein Checkpoint nicht taugt. Die Texte entsprechen denen im Performance-Trace der PWA.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reject {
    Missing,
    NoState,
    Keys,
    BlobSizes,
    Format,
    SeqAhead,
    Count,
    Boundary,
    TailSeq,
    OlderTail,
    HeftDocs,
}

impl Reject {
    pub fn as_str(self) -> &'static str {
        match self {
            Reject::Missing => "missing",
            Reject::NoState => "no-state",
            Reject::Keys => "keys",
            Reject::BlobSizes => "blob-sizes",
            Reject::Format => "format",
            Reject::SeqAhead => "seq-ahead",
            Reject::Count => "count",
            Reject::Boundary => "boundary",
            Reject::TailSeq => "tail-seq",
            Reject::OlderTail => "older-tail",
            Reject::HeftDocs => "heft-docs",
        }
    }
}

/// `Number(x) || 0`, nie negativ.
fn num(v: Option<&Value>) -> f64 {
    let n = match v {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        Some(Value::String(s)) if s.trim().is_empty() => 0.0,
        Some(Value::String(s)) => s.trim().parse().unwrap_or(0.0),
        Some(Value::Bool(b)) => f64::from(u8::from(*b)),
        _ => 0.0,
    };
    if n.is_nan() { 0.0 } else { n.max(0.0) }
}

fn format_of(cp: &Object) -> Option<u64> {
    cp.get("format").and_then(Value::as_f64).filter(|f| f.fract() == 0.0 && *f >= 0.0).map(|f| f as u64)
}

fn plain_object(v: Option<&Value>) -> Option<&Object> {
    v.and_then(Value::as_object)
}

/// `stateCheckpointRejectReason`: `None` = nutzbar. `reorder_safe(event, orderTimes)` entscheidet,
/// ob ein verspätetes älteres Event einfach angehängt werden darf (Regeln in `event-order.js`).
pub fn reject_reason(
    cp: Option<&Object>,
    current: &LogInfo,
    boundary: Option<&Object>,
    tail: &[Object],
    reorder_safe: impl Fn(&Object, Option<&Object>) -> bool,
) -> Option<Reject> {
    let Some(cp) = cp else { return Some(Reject::Missing) };
    let Some(state) = cp.get("state").filter(|s| js::truthy(s)) else { return Some(Reject::NoState) };
    let own = |key: &str| state.as_object().is_some_and(|s| s.contains_key(key));
    match format_of(cp) {
        Some(f @ (FORMAT | HEFT_JSON_FORMAT)) => {
            let docs_stored = if f == FORMAT {
                plain_object(cp.get("heftDocHashes")).is_some()
            } else {
                cp.get("heftDocsJson").is_some_and(Value::is_string)
            };
            if !core_keys().all(|k| own(k) || (k == "heftDocs" && docs_stored)) {
                return Some(Reject::Keys);
            }
            if plain_object(cp.get("heftBlobSizes")).is_none() {
                return Some(Reject::BlobSizes);
            }
        }
        Some(LEGACY_FORMAT) => {
            if !KEYS.iter().all(|k| own(k)) {
                return Some(Reject::Keys);
            }
        }
        _ => return Some(Reject::Format),
    }
    let max_seq = num(cp.get("maxSeq"));
    let event_count = num(cp.get("eventCount"));
    if max_seq > current.max_seq as f64 {
        return Some(Reject::SeqAhead);
    }
    if event_count + tail.len() as f64 != current.count as f64 {
        return Some(Reject::Count);
    }
    let text = |v: Option<&Value>| v.filter(|v| js::truthy(v)).map(js::to_string).unwrap_or_default();
    if max_seq > 0.0
        && boundary.is_none_or(|b| num(b.get("seq")) != max_seq || text(b.get("id")) != text(cp.get("lastEventId")))
    {
        return Some(Reject::Boundary);
    }
    if tail.iter().any(|ev| num(ev.get("seq")) <= max_seq) {
        return Some(Reject::TailSeq);
    }
    if let Some(max_time) = cp.get("maxTime").filter(|t| js::truthy(t)) {
        let max_time = js::to_string(max_time);
        let times = plain_object(cp.get("orderTimes"));
        let older = |ev: &Object| js::cmp(&text(ev.get("t")), &max_time).is_lt();
        if tail.iter().any(|ev| older(ev) && !reorder_safe(ev, times)) {
            return Some(Reject::OlderTail);
        }
    }
    None
}

/// Liest den Checkpoint: aktueller Platz, sonst Alt-Format.
pub fn read<S: Storage + ?Sized>(storage: &S) -> Result<Option<Object>, Error> {
    match storage.checkpoint(CheckpointSlot::Current)? {
        Some(cp) => Ok(Some(cp)),
        None => storage.checkpoint(CheckpointSlot::Legacy),
    }
}

/// Gespeicherter Zustand eines Checkpoints, Hefte wieder als Objekte (`checkpointSavedState`).
/// Format 3 liest jedes Heft aus seinem Teil; fehlt eins oder ist es kaputt: [`Reject::HeftDocs`].
pub fn saved_state<S: Storage + ?Sized>(storage: &S, cp: &Object) -> Result<Result<Object, Reject>, Error> {
    let Some(Value::Object(state)) = cp.get("state") else { return Ok(Err(Reject::NoState)) };
    let mut state = state.clone();
    if format_of(cp) == Some(FORMAT) {
        let mut docs = Object::new();
        for (page, hash) in plain_object(cp.get("heftDocHashes")).into_iter().flatten() {
            let json = match hash.as_str() {
                Some(h) => storage.part(PartKind::HeftDoc, h)?,
                None => None,
            };
            match json.and_then(|j| serde_json::from_str(&j).ok()) {
                Some(doc) => docs.insert(page.clone(), doc),
                None => return Ok(Err(Reject::HeftDocs)),
            };
        }
        state.insert("heftDocs".into(), Value::Object(docs));
    } else if let Some(Value::String(json)) = cp.get("heftDocsJson") {
        match serde_json::from_str(json) {
            Ok(docs) => state.insert("heftDocs".into(), docs),
            Err(_) => return Ok(Err(Reject::HeftDocs)),
        };
    }
    Ok(Ok(state))
}

/// Größen der Heft-Bilder (`heftBlobSizesOf`): bekannte plus die im Zustand geladenen (Länge in UTF-16).
pub fn heft_blob_sizes(state: &Object, known: Option<&Object>) -> Object {
    let mut sizes = known.cloned().unwrap_or_default();
    for (hash, v) in plain_object(state.get("heftBlobs")).into_iter().flatten() {
        if let Some(s) = v.as_str() {
            sizes.insert(hash.clone(), Value::from(s.encode_utf16().count()));
        }
    }
    sizes
}

/// Ein Heft als JSON-Text samt Inhalts-Hash: unveränderte Hefte behalten ihren Schlüssel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeftPart {
    pub page_id: String,
    pub hash: String,
    pub json: String,
}

/// `serializeHeftDocs` + `hashHeftDocs`: Bytes wie `JSON.stringify`, Hash = SHA-256 (hex) davon.
pub fn heft_parts(heft_docs: &Object) -> Vec<HeftPart> {
    heft_docs
        .iter()
        .map(|(page_id, doc)| {
            let json = js::stringify(doc);
            HeftPart { page_id: page_id.clone(), hash: sha256_hex(&json), json }
        })
        .collect()
}

fn sha256_hex(s: &str) -> String {
    Sha256::digest(s.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// Neuer Checkpoint im aktuellen Format (`makeStateCheckpoint`). `state` ist der ganze
/// gespeicherte Zustand; `heftBlobs` und `heftDocs` gehen nicht in den Kern.
pub fn make(
    state: &Object,
    info: &LogInfo,
    max_time: &str,
    known_blob_sizes: Option<&Object>,
    hefte: &[HeftPart],
    order_times: Option<&Object>,
) -> Object {
    let core: Object = core_keys()
        .filter(|k| *k != "heftDocs")
        .map(|k| (k.to_owned(), state.get(k).cloned().unwrap_or(Value::Null)))
        .collect();
    let hashes: Object = hefte.iter().map(|h| (h.page_id.clone(), Value::from(h.hash.clone()))).collect();
    let mut cp = Object::new();
    cp.insert("format".into(), Value::from(FORMAT));
    cp.insert("maxSeq".into(), Value::from(info.max_seq));
    cp.insert("eventCount".into(), Value::from(info.count));
    cp.insert("lastEventId".into(), Value::from(info.last_event_id.clone()));
    cp.insert("maxTime".into(), Value::from(max_time));
    cp.insert("heftBlobSizes".into(), Value::Object(heft_blob_sizes(state, known_blob_sizes)));
    cp.insert("reconciledArchive".into(), Value::Bool(true));
    cp.insert("state".into(), Value::Object(core));
    cp.insert("heftDocHashes".into(), Value::Object(hashes));
    if let Some(times) = order_times {
        cp.insert("orderTimes".into(), Value::Object(times.clone()));
    }
    cp
}

/// Schlüssel eines Objekts (`Object.keys`, auch für Arrays).
fn keys_of(v: Option<&Value>) -> Option<HashSet<String>> {
    match v? {
        Value::Object(o) => Some(o.keys().cloned().collect()),
        Value::Array(a) => Some((0..a.len()).map(|i| i.to_string()).collect()),
        _ => None,
    }
}

/// Schreibvorgang für `putStateCheckpoint`: neue Teile nur, wenn ihr Hash fehlt (Inhalt ist
/// unveränderlich), Teile, die der Checkpoint nicht mehr kennt, fliegen in derselben Transaktion.
pub fn write<S: Storage + ?Sized>(
    storage: &mut S,
    cp: Object,
    heft_blobs: &[(String, String)],
    hefte: &[HeftPart],
) -> Result<(), Error> {
    let known_blobs = keys_of(cp.get("heftBlobSizes"));
    let known_hefte: Option<HashSet<String>> = match cp.get("heftDocHashes") {
        Some(Value::Object(o)) => Some(o.values().filter_map(Value::as_str).map(str::to_owned).collect()),
        Some(Value::Array(a)) => Some(a.iter().filter_map(Value::as_str).map(str::to_owned).collect()),
        _ => None,
    };
    let mut writes = Vec::new();
    let mut partition = |kind: PartKind, entries: Vec<(&str, &str)>, known: Option<&HashSet<String>>| {
        let existing: HashSet<String> = storage.part_hashes(kind)?.into_iter().collect();
        for (hash, data) in entries {
            if !hash.is_empty() && !existing.contains(hash) {
                writes.push(Write::PutPart(kind, hash.to_owned(), data.to_owned()));
            }
        }
        if let Some(known) = known {
            writes.extend(existing.into_iter().filter(|h| !known.contains(h)).map(|h| Write::DeletePart(kind, h)));
        }
        Ok::<_, Error>(())
    };
    partition(
        PartKind::HeftBlob,
        heft_blobs.iter().map(|(h, d)| (h.as_str(), d.as_str())).collect(),
        known_blobs.as_ref(),
    )?;
    if let Some(known) = &known_hefte {
        partition(PartKind::HeftDoc, hefte.iter().map(|h| (h.hash.as_str(), h.json.as_str())).collect(), Some(known))?;
    }
    writes.push(Write::PutCheckpoint(CheckpointSlot::Current, cp));
    writes.push(Write::DeleteCheckpoint(CheckpointSlot::Legacy));
    storage.apply(writes).map(drop)
}

/// `clearStateCheckpoint`: Checkpoint verwerfen, Teile auf Wunsch behalten (Voll-Replay beim Start).
pub fn clear<S: Storage + ?Sized>(storage: &mut S, keep_heft_blobs: bool) -> Result<(), Error> {
    let mut writes =
        vec![Write::DeleteCheckpoint(CheckpointSlot::Current), Write::DeleteCheckpoint(CheckpointSlot::Legacy)];
    if !keep_heft_blobs {
        writes.extend([Write::ClearParts(PartKind::HeftBlob), Write::ClearParts(PartKind::HeftDoc)]);
    }
    storage.apply(writes).map(drop)
}

/// Ergebnis von [`load`].
#[derive(Debug, Clone, PartialEq)]
pub enum Loaded {
    /// Nutzbar: Zustand (Hefte als Objekte) und der nachzuspielende Rest in `seq`-Reihenfolge.
    Usable {
        checkpoint: Object,
        state: Object,
        tail: Vec<Object>,
    },
    Rejected(Reject),
}

/// Start: Checkpoint lesen, prüfen und den Rest des Logs holen – ein grober Aufruf.
pub fn load<S: Storage + ?Sized>(
    storage: &S,
    reorder_safe: impl Fn(&Object, Option<&Object>) -> bool,
) -> Result<Loaded, Error> {
    let info = storage.log_info()?;
    let Some(cp) = read(storage)? else { return Ok(Loaded::Rejected(Reject::Missing)) };
    let max_seq = num(cp.get("maxSeq")) as u64;
    let boundary = if max_seq > 0 { storage.event_at(max_seq)? } else { None };
    let tail = storage.events_after(max_seq, Some(info.max_seq), None)?;
    if let Some(reason) = reject_reason(Some(&cp), &info, boundary.as_ref(), &tail, reorder_safe) {
        return Ok(Loaded::Rejected(reason));
    }
    Ok(match saved_state(storage, &cp)? {
        Ok(state) => Loaded::Usable { checkpoint: cp, state, tail },
        Err(reason) => Loaded::Rejected(reason),
    })
}
