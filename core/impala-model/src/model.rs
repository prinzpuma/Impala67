//! Laufzeit-Modell: Zustand plus alles, was ihn mit Log und Checkpoint verbindet
//! (`load`, `dispatch`, `applyRemoteEvents`, `persistCheckpoint`, Heft-Bilder in `web/state.js`).
//!
//! Regel für Checkpoints: Ein Checkpoint entspricht immer dem nach Zeit sortierten Replay seiner
//! Events. Wendet die Laufzeit ein verspätetes Fremd-Event an, das mit neueren Events kollidiert,
//! wird kein Checkpoint mehr gespeichert, bis der nächste Start das Log wieder sortiert einspielt.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use impala_heft::HeftDoc;
use impala_storage::checkpoint::HeftPart;
use impala_storage::checkpoint::{self, HeftJson, LoadedRaw, Reject};
use impala_storage::{Error, PartKind, Storage, StorageExt};
use serde_json::Value;

use crate::event::LogEvent;
use crate::js::{self, Object};
use crate::order::{self, OrderTimes};
use crate::reduce::{Effects, Live};
use crate::types::{CoreOnly, Page, State};

/// Events je Lesezugriff, wenn [`Model::save_checkpoint`] die neuen IDs prüft.
const CHECKPOINT_SCAN: usize = 2000;

/// Ergebnis von [`Model::load`] (für Diagnose und Uhr).
#[derive(Debug, Clone, PartialEq)]
pub struct LoadReport {
    pub max_seq: u64,
    /// Spätester Event-Zeitpunkt: die eigene Uhr darauf nachziehen.
    pub max_time: String,
    pub count: u64,
    pub replayed: usize,
    pub checkpoint_used: bool,
    /// Warum der Checkpoint nicht taugte (`missing`, `older-tail`, `read-error` …).
    pub reject_reason: Option<&'static str>,
}

/// Ergebnis von [`Model::save_checkpoint`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckpointSave {
    Written,
    /// Nichts Neues seit dem letzten Checkpoint.
    Unchanged,
    /// Der Speicher weicht vom sortierten Replay ab: alten Checkpoint behalten.
    OutOfOrder,
    /// Im Log liegen Events, die dieses Modell noch nicht angewandt hat: später erneut versuchen.
    Stale,
}

/// Ergebnis von [`Model::dispatch`]: ID und bereits serialisierte Log-Form (für den Sync).
#[derive(Debug, Clone, PartialEq)]
pub struct Dispatched {
    pub id: String,
    /// Das Event als Log-Objekt, wie es der Speicher bekommen hat (mit `seq`).
    pub object: Object,
}

/// Abgeleitete Heft-Kennzahlen (`S.heftMeta`): Badges, Bibliothek, Suche.
#[derive(Debug, Clone, PartialEq)]
pub struct HeftMeta {
    pub rev: u64,
    pub pages: usize,
    /// Handschrift-Text aller Seiten, mit Zeilenumbruch verbunden.
    pub ocr_text: String,
    /// Zeitpunkt des letzten Heft-Events (nach dem Start: `updated` der Seite).
    pub updated: String,
    /// Grobe Größenschätzung (nur Anzeige).
    pub bytes: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CheckpointInfo {
    format: u64,
    max_seq: u64,
    event_count: u64,
    last_event_id: String,
}

/// Zustand samt Log-Anbindung.
#[derive(Debug, Clone)]
pub struct Model {
    state: State,
    order: OrderTimes,
    /// `false`, wenn der Start von einem Checkpoint ohne `orderTimes` kam.
    order_complete: bool,
    loaded_time: String,
    replay_ordered: bool,
    /// Größe (UTF-16) aller bekannten Heft-Bilder, geladen oder nur im Checkpoint.
    blob_sizes: BTreeMap<String, usize>,
    /// Bilder, die noch nicht als Checkpoint-Teil liegen.
    dirty_blobs: BTreeSet<String>,
    payload_loaded: bool,
    heft_updated: HashMap<String, String>,
    checkpoint_info: Option<CheckpointInfo>,
    base_seq: u64,
    loaded_seq: u64,
    applied_after_load: HashSet<String>,
    /// Gerade offener Chat (UI); hält dessen Tab, auch bevor die Sitzung gespeichert ist.
    pub current_chat_id: Option<String>,
    /// Stand des Zustands, siehe [`Model::revision`].
    revision: u64,
}

/// Quelle für [`Model::revision`]: über alle Modelle eindeutig, damit ein neu geladenes Modell
/// nie den Stand eines alten wiederholt.
static REVISIONS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
fn next_revision() -> u64 {
    REVISIONS.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

impl Default for Model {
    fn default() -> Self {
        Model {
            state: State::default(),
            order: OrderTimes::new(),
            order_complete: true,
            loaded_time: String::new(),
            replay_ordered: true,
            blob_sizes: BTreeMap::new(),
            dirty_blobs: BTreeSet::new(),
            payload_loaded: true,
            heft_updated: HashMap::new(),
            checkpoint_info: None,
            base_seq: 0,
            loaded_seq: 0,
            applied_after_load: HashSet::new(),
            current_chat_id: None,
            revision: next_revision(),
        }
    }
}

/// `heftBlobSizesOf`: Größen der im Zustand liegenden Bilder.
fn blob_sizes_of(state: &State) -> BTreeMap<String, usize> {
    state.hefte.blobs.iter().map(|(h, d)| (h.clone(), js::len16(d))).collect()
}

impl State {
    /// Gespeicherten Zustand übernehmen (`restorePersistedState`) samt Altlast-Reparaturen:
    /// alter Name der Cloudflare-Quelle, Seiten ohne `created` (`now` als letzter Ausweg).
    pub fn restore(saved: Object, now: &str) -> State {
        let mut s = State::from_object(saved);
        for pr in s.settings.ai_providers.iter_mut().flatten() {
            if let Some(o) = pr.as_object_mut()
                && o.get("id").and_then(Value::as_str) == Some("cloudflare")
                && o.get("name").is_none_or(|n| !js::truthy(n) || n.as_str() == Some("Cloudflare (Groq)"))
            {
                o.insert("name".into(), Value::from("Impala AI"));
            }
        }
        for pg in s.pages.values_mut() {
            if !pg.truthy("created") {
                let created = js::or(pg.get("updated").as_ref()).cloned().unwrap_or_else(|| Value::from(now));
                pg.set("created", created);
            }
        }
        s
    }
}

impl Model {
    /// Leeres Modell (frische Installation).
    pub fn new() -> Self {
        Self::default()
    }

    /// Voll-Replay eines Logs (ohne Speicher), z. B. für Tests und Werkzeuge.
    pub fn from_events(mut events: Vec<LogEvent>) -> Self {
        let mut m = Model::default();
        if events.len() > 1 {
            order::sort_events(&mut events);
        }
        m.loaded_time = events.last().map(|e| e.t.clone()).unwrap_or_default();
        for ev in events {
            m.reduce(ev, true);
        }
        m
    }

    pub fn state(&self) -> &State {
        &self.state
    }

    /// Zustand direkt ändern – nur für Werkzeuge/Tests; die App ändert ihn über Events.
    pub fn state_mut(&mut self) -> &mut State {
        self.revision = next_revision();
        &mut self.state
    }

    pub fn loaded_seq(&self) -> u64 {
        self.loaded_seq
    }

    /// Spätester angewandter Event-Zeitpunkt.
    pub fn loaded_time(&self) -> &str {
        &self.loaded_time
    }

    /// `true`, solange der Speicher dem sortierten Replay entspricht (Checkpoint erlaubt).
    pub fn replay_ordered(&self) -> bool {
        self.replay_ordered
    }

    pub fn order_times(&self) -> Option<&OrderTimes> {
        self.order_complete.then_some(&self.order)
    }

    /// Ein Event anwenden (`reduce`). `loading`: Teil des Start-Replays.
    /// Ändert sich mit jedem angewandten Event (und jedem schreibenden Zugriff auf den Zustand):
    /// abgeleitete Daten wie der Suchindex sind bei gleichem Wert noch aktuell.
    pub fn revision(&self) -> u64 {
        self.revision
    }

    fn reduce(&mut self, ev: LogEvent, loading: bool) -> Effects {
        self.revision = next_revision();
        if !loading
            && js::lt(&ev.t, &self.loaded_time)
            && !(self.order_complete && order::reorder_safe(&ev, Some(&self.order)))
        {
            self.replay_ordered = false;
        }
        order::note_event_order(&mut self.order, &ev);
        if js::lt(&self.loaded_time, &ev.t) {
            self.loaded_time.clone_from(&ev.t);
        }
        let t = matches!(ev.kind.as_str(), "heftOps" | "heftSnap").then(|| ev.t.clone());
        let live = (!loading).then_some(Live { current_chat_id: self.current_chat_id.as_deref() });
        let fx = self.state.apply_owned(ev, live);
        if let Some((hash, len)) = &fx.blob {
            if let Some(cur) = self.blob_sizes.get_mut(hash) {
                *cur = *len;
            } else {
                self.blob_sizes.insert(hash.clone(), *len);
            }
            if !self.dirty_blobs.contains(hash) {
                self.dirty_blobs.insert(hash.clone());
            }
        }
        if let (Some(page), Some(t)) = (&fx.heft_page, t) {
            if let Some(cur) = self.heft_updated.get_mut(page) {
                *cur = t;
            } else {
                self.heft_updated.insert(page.clone(), t);
            }
        }
        if let Some(page) = &fx.deleted_page {
            self.heft_updated.remove(page);
        }
        fx
    }

    /// Start: Checkpoint + Rest des Logs, sonst Voll-Replay. `now` füllt nur Altdaten ohne Datum.
    pub fn load<S: Storage + ?Sized>(storage: &mut S, now: &str) -> Result<(Model, LoadReport), Error> {
        let mut m = Model::default();
        let mut info = storage.log_info()?;
        let (loaded, had_checkpoint) = match checkpoint::load_raw(storage, order::reorder_safe_object) {
            Ok(LoadedRaw::Rejected(r)) => (Err(r.as_str()), r != Reject::Missing),
            // Hefte bleiben Text, bis sie gebraucht werden; ein kaputtes verwirft den Checkpoint.
            Ok(LoadedRaw::Usable { checkpoint, state, hefte, tail }) => match read_hefte(hefte) {
                Some(docs) => (Ok((checkpoint, state, docs, tail)), true),
                None => (Err(Reject::HeftDocs.as_str()), true),
            },
            Err(_) => (Err("read-error"), false),
        };
        let (replayed, reject) = match loaded {
            Ok((mut cp, saved, docs, tail)) => {
                let format = cp.get("format").and_then(Value::as_u64).unwrap_or(0);
                let partitioned = format == checkpoint::FORMAT || format == checkpoint::HEFT_JSON_FORMAT;
                let max_seq = impala_storage::js::seq_of(cp.get("maxSeq"));
                let event_count = impala_storage::js::seq_of(cp.get("eventCount"));
                let reconciled = cp.get("reconciledArchive").is_some_and(js::truthy);
                m.state = State::restore(saved, now);
                match docs {
                    Some(StoredHefte::Text(parts)) => {
                        for (page, hash, json) in parts {
                            m.state.hefte.insert_stored(page, json, hash);
                        }
                    }
                    Some(StoredHefte::Docs(docs)) => {
                        for (page, doc) in docs {
                            m.state.hefte.insert(page, doc);
                        }
                    }
                    None => {}
                }
                m.blob_sizes = if partitioned {
                    match cp.remove("heftBlobSizes") {
                        Some(Value::Object(o)) => {
                            o.into_iter().map(|(h, n)| (h, n.as_f64().map_or(0, |n| n.max(0.0) as usize))).collect()
                        }
                        _ => BTreeMap::new(),
                    }
                } else {
                    blob_sizes_of(&m.state)
                };
                m.payload_loaded = !partitioned || m.blob_sizes.is_empty();
                if !partitioned {
                    m.dirty_blobs = m.blob_sizes.keys().cloned().collect();
                }
                let mut tail: Vec<LogEvent> = tail.into_iter().filter_map(LogEvent::from_object_owned).collect();
                if tail.len() > 1 {
                    order::sort_events(&mut tail);
                }
                let saved_times = cp.remove("orderTimes").and_then(take_order_times);
                m.order_complete = saved_times.is_some();
                m.order = saved_times.unwrap_or_default();
                m.loaded_time = take_str_or_empty(cp.remove("maxTime"));
                let replayed = tail.len();
                for ev in tail {
                    m.reduce(ev, true);
                }
                m.checkpoint_info = Some(CheckpointInfo {
                    format,
                    max_seq,
                    event_count,
                    last_event_id: take_str_or_empty(cp.remove("lastEventId")),
                });
                // Checkpoints von vor dem Archiv-Abgleich: Archiv-Events einmalig nachspielen.
                // (Den Artikel-Abgleich des JS braucht es nicht: ein Checkpoint ohne `homeArticles`
                // scheitert schon an der Schlüsselprüfung und wird voll abgespielt.)
                if !reconciled {
                    let mut all: Vec<LogEvent> = storage
                        .all_events()?
                        .into_iter()
                        .filter(|e| {
                            matches!(e.get("type").and_then(Value::as_str), Some("pageArchive" | "pageUnarchive"))
                        })
                        .filter_map(LogEvent::from_object_owned)
                        .collect();
                    if all.len() > 1 {
                        order::sort_events(&mut all);
                    }
                    for ev in all {
                        m.reduce(ev, true);
                    }
                }
                (replayed, None)
            }
            other => {
                let reason = other.err().or(Some("missing"));
                let raw = storage.take_all_events()?;
                let raw_len = raw.len() as u64;
                let mut events: Vec<LogEvent> = raw.into_iter().filter_map(LogEvent::from_object_owned).collect();
                if events.len() > 1 {
                    order::sort_events(&mut events);
                }
                info = log_info_of(&events, raw_len);
                m.loaded_time = events.last().map(|e| e.t.clone()).unwrap_or_default();
                let replayed = events.len();
                for ev in events {
                    m.reduce(ev, true);
                }
                m.payload_loaded = true;
                if had_checkpoint {
                    // Nur den Kernzustand verwerfen: Heft-Bilder sind inhaltsadressiert und bleiben gültig.
                    let _ = storage.clear_checkpoint(true);
                }
                // Kein Checkpoint hier: Vor `base_seq` (unten) zählte jedes Event als „nach dem Laden
                // unbekannt“, der Versuch endete immer als `Stale` – nach einem erneuten Lesen des
                // ganzen Logs. Den Checkpoint schreibt die App (PWA-Planer, native beim Wechsel in
                // den Hintergrund).
                (replayed, reason)
            }
        };
        m.loaded_seq = info.max_seq;
        m.base_seq = info.max_seq;
        let report = LoadReport {
            max_seq: info.max_seq,
            max_time: m.loaded_time.clone(),
            count: info.count,
            replayed,
            checkpoint_used: reject.is_none(),
            reject_reason: reject,
        };
        Ok((m, report))
    }

    /// Bereits gespeicherte Fremd-Events anwenden (`applyRemoteEvents`): in Zeitreihenfolge.
    /// Liefert die IDs in Anwendungsreihenfolge.
    pub fn apply_remote(&mut self, mut events: Vec<LogEvent>) -> Vec<String> {
        if events.len() > 1 {
            order::sort_events(&mut events);
        }
        let mut ids = Vec::with_capacity(events.len());
        for ev in events {
            ids.push(ev.id.clone());
            self.apply_remote_one(ev);
        }
        ids
    }

    /// Ein bereits gespeichertes Fremd-Event anwenden; der Aufrufer hält die Zeitreihenfolge ein.
    pub fn apply_remote_one(&mut self, ev: LogEvent) -> Effects {
        if !ev.id.is_empty() {
            self.applied_after_load.insert(ev.id.clone());
        }
        self.reduce(ev, false)
    }

    /// Eine eigene Änderung als Event (`dispatch` vor dem Speichern): `id` und `now` kommen vom
    /// Aufrufer (UUID, hybride Uhr). Neue Seiten bekommen `created`, wenn es fehlt.
    pub fn local_event(kind: &str, mut payload: Value, id: &str, now: &str) -> LogEvent {
        if kind == "pageCreate"
            && let Some(o) = payload.as_object_mut()
            && !o.get("created").is_some_and(js::truthy)
        {
            o.insert("created".into(), Value::from(now));
        }
        LogEvent::new(id, now, kind, payload)
    }

    /// Eine eigene, schon gespeicherte Änderung anwenden.
    pub fn apply_local(&mut self, ev: LogEvent) -> Effects {
        self.applied_after_load.insert(ev.id.clone());
        self.reduce(ev, false)
    }

    /// Eine eigene Änderung (`dispatch`): erst persistieren, dann anwenden.
    pub fn dispatch<S: Storage + ?Sized>(
        &mut self,
        storage: &mut S,
        kind: &str,
        payload: Value,
        id: &str,
        now: &str,
    ) -> Result<Dispatched, Error> {
        let mut ev = Self::local_event(kind, payload, id, now);
        // Die Log-Form wird einmal gebaut: für den Speicher und (ohne erneutes Serialisieren) den Sync.
        let mut object = ev.to_object();
        let seqs = storage.add_events(vec![object.clone()])?;
        ev.seq = seqs.first().copied().unwrap_or(0);
        if ev.seq > 0 {
            object.insert("seq".into(), Value::from(ev.seq));
        }
        self.applied_after_load.insert(ev.id.clone());
        self.reduce(ev, false);
        Ok(Dispatched { id: id.to_owned(), object })
    }

    /// Folgenummer, bis zu der der letzte Checkpoint (oder der Start) reicht.
    pub fn base_seq(&self) -> u64 {
        self.base_seq
    }

    /// Der Speicher hat einen nach [`Model::save_checkpoint`] gemeldeten Checkpoint doch nicht
    /// geschrieben (zweistufige Plattformen wie IndexedDB): Bilder bleiben ungesichert, der
    /// nächste Versuch schreibt neu.
    pub fn checkpoint_not_written(&mut self, dirty_blobs: &[String]) {
        self.checkpoint_info = None;
        self.dirty_blobs.extend(dirty_blobs.iter().cloned());
    }

    /// Heft mit noch nicht gespeicherten Operationen (Vorschau, ändert nichts).
    pub fn heft_preview(&self, page_id: &str, ops: Value) -> Option<impala_heft::HeftDoc> {
        let mut doc = self.state.hefte.get(page_id)?.clone();
        doc.apply_ops(impala_heft::parse_ops(ops));
        Some(doc)
    }

    /// Checkpoint speichern (`persistCheckpoint`).
    pub fn save_checkpoint<S: Storage + ?Sized>(&mut self, storage: &mut S) -> Result<CheckpointSave, Error> {
        if !self.replay_ordered {
            return Ok(CheckpointSave::OutOfOrder);
        }
        let current = storage.log_info()?;
        // Nur die IDs, portionsweise gelesen: Nach einem großen Import liegt fast das ganze Log hier.
        let mut after = self.base_seq;
        while after < current.max_seq {
            let page = storage.events_after(after, Some(current.max_seq), Some(CHECKPOINT_SCAN))?;
            let Some(last) = page.last() else { break };
            let next_after = impala_storage::js::seq_of(last.get("seq"));
            if next_after <= after {
                break;
            }
            after = next_after;
            for ev in &page {
                let Some(v) = ev.get("id").filter(|v| js::truthy(v)) else { continue };
                let known = match v {
                    Value::String(id) => self.applied_after_load.contains(id),
                    other => self.applied_after_load.contains(&js::to_string(other)),
                };
                if !known {
                    return Ok(CheckpointSave::Stale);
                }
            }
        }
        if self.checkpoint_info.as_ref().is_some_and(|ci| {
            ci.format == checkpoint::FORMAT
                && ci.max_seq == current.max_seq
                && ci.event_count == current.count
                && ci.last_event_id == current.last_event_id
        }) {
            return Ok(CheckpointSave::Unchanged);
        }
        let mut sizes: Object = self.blob_sizes.iter().map(|(h, n)| (h.clone(), Value::from(*n))).collect();
        for (h, d) in &self.state.hefte.blobs {
            if !sizes.get(h).and_then(Value::as_u64).is_some_and(|n| n > 0) {
                sizes.insert(h.clone(), Value::from(js::len16(d)));
            }
        }
        let dirty: Vec<(String, String)> = self
            .dirty_blobs
            .iter()
            .filter_map(|h| self.state.hefte.blobs.get(h).map(|d| (h.clone(), d.clone())))
            .collect();
        // Direkt als Text: Ein `Value`-Baum des ganzen Zustands (mehrere MB) kostete mehr als das
        // Schreiben selbst und wurde gleich danach doch nur zu Text.
        let state = serde_json::to_string(&CoreOnly(&self.state))
            .map_err(|_| Error::Json("Zustand nicht serialisierbar".into()))?;
        // Unveränderte Hefte, die schon gespeichert liegen, behalten ihren Teil (kein Neuschreiben,
        // kein Lesen); nur geänderte werden serialisiert.
        let hefte: Vec<HeftPart> = if self.state.hefte.ids().next().is_none() {
            Vec::new()
        } else {
            let existing: HashSet<String> =
                if self.state.hefte.ids().any(|id| self.state.hefte.stored_hash(id).is_some()) {
                    storage.part_hashes(PartKind::HeftDoc)?.into_iter().collect()
                } else {
                    HashSet::new()
                };
            self.state
                .hefte
                .ids()
                .map(|id| match self.state.hefte.stored_hash(id) {
                    Some(h) if existing.contains(h) => {
                        HeftPart { page_id: id.clone(), hash: h.to_owned(), json: String::new() }
                    }
                    _ => checkpoint::heft_part(id, self.state.hefte.get(id).expect("Heft vorhanden")),
                })
                .collect()
        };
        let times = self.order_complete.then(|| order::times_to_json(&self.order));
        let written = storage.save_checkpoint_json(state, &self.loaded_time, sizes, &dirty, times, &hefte)?;
        for part in hefte {
            self.state.hefte.set_stored_hash(&part.page_id, part.hash);
        }
        for (h, _) in &dirty {
            self.dirty_blobs.remove(h);
        }
        self.checkpoint_info = Some(CheckpointInfo {
            format: checkpoint::FORMAT,
            max_seq: written.max_seq,
            event_count: written.count,
            last_event_id: written.last_event_id,
        });
        self.base_seq = written.max_seq;
        self.loaded_seq = written.max_seq;
        if after >= current.max_seq && written.max_seq <= current.max_seq {
            if self.applied_after_load.capacity() > 256 {
                self.applied_after_load = HashSet::new();
            } else {
                self.applied_after_load.clear();
            }
        }
        Ok(CheckpointSave::Written)
    }

    /// Ist das Bild bekannt (geladen oder im Checkpoint)?
    pub fn has_heft_blob(&self, hash: &str) -> bool {
        self.state.hefte.blobs.contains_key(hash) || self.blob_sizes.contains_key(hash)
    }

    /// Bilder anderer Hefte aus dem Speicher nehmen; nur, was sicher im Checkpoint liegt.
    pub fn release_heft_blobs(&mut self, keep: &[String]) -> usize {
        let keep: HashSet<&str> = keep.iter().map(String::as_str).collect();
        let before = self.state.hefte.blobs.len();
        let (sizes, dirty) = (&self.blob_sizes, &self.dirty_blobs);
        self.state.hefte.blobs.retain(|h, _| keep.contains(h.as_str()) || dirty.contains(h) || !sizes.contains_key(h));
        let released = before - self.state.hefte.blobs.len();
        if released > 0 {
            self.payload_loaded = false;
        }
        released
    }

    /// Bilder vergessen, deren `heftBlob`-Events die Kompaktierung verworfen hat (kein Heft zeigt sie).
    /// Der nächste Checkpoint listet sie dann nicht mehr, und ihre Teile werden aufgeräumt.
    pub fn forget_heft_blobs(&mut self, gone: &[String]) -> usize {
        let mut n = 0;
        for h in gone {
            let known = self.blob_sizes.remove(h).is_some();
            let loaded = self.state.hefte.blobs.remove(h).is_some();
            self.dirty_blobs.remove(h);
            n += usize::from(known || loaded);
        }
        n
    }

    /// Welche Bilder [`Model::hydrate_heft_blobs`] aus dem Speicher holen müsste (bekannt, nicht geladen).
    pub fn blobs_to_hydrate(&self, targets: Option<&[String]>) -> Vec<String> {
        if self.blob_sizes.is_empty() || (self.payload_loaded && targets.is_none()) {
            return Vec::new();
        }
        match targets {
            Some(t) => {
                let mut seen = HashSet::new();
                t.iter()
                    .filter(|h| {
                        self.blob_sizes.contains_key(*h)
                            && !self.state.hefte.blobs.contains_key(*h)
                            && seen.insert(h.as_str())
                    })
                    .cloned()
                    .collect()
            }
            None => self.blob_sizes.keys().filter(|h| !self.state.hefte.blobs.contains_key(*h)).cloned().collect(),
        }
    }

    /// Bilder aus dem Checkpoint nachladen (`hydrateHeftBlobs`): bestimmte oder alle. Fehlt ein
    /// Teil, wird das Log nach dem `heftBlob` durchsucht; ohne Treffer gilt das Bild als unbekannt.
    pub fn hydrate_heft_blobs<S: Storage + ?Sized>(
        &mut self,
        storage: &S,
        targets: Option<&[String]>,
    ) -> Result<bool, Error> {
        if self.blob_sizes.is_empty() {
            self.payload_loaded = true;
            return Ok(true);
        }
        if self.payload_loaded && targets.is_none() {
            return Ok(true);
        }
        let needed = self.blobs_to_hydrate(targets);
        let all_loaded = |m: &Model| m.blob_sizes.keys().all(|h| m.state.hefte.blobs.contains_key(h));
        if needed.is_empty() {
            if targets.is_none() || all_loaded(self) {
                self.payload_loaded = true;
            }
            return Ok(true);
        }
        let mut missing = BTreeSet::new();
        for h in needed {
            // Lesefehler wie im JS: das Bild gilt als fehlend und wird im Log gesucht.
            if let Ok(Some(data)) = storage.part(PartKind::HeftBlob, &h) {
                self.state.hefte.blobs.entry(h).or_insert(data);
            } else {
                missing.insert(h);
            }
        }
        if !missing.is_empty() {
            for ev in storage.all_events()? {
                if missing.is_empty() {
                    break;
                }
                if ev.get("type").and_then(Value::as_str) != Some("heftBlob") {
                    continue;
                }
                let p = ev.get("payload");
                let hash = p.and_then(|p| p.get("hash")).and_then(Value::as_str);
                let data = p.and_then(|p| p.get("data")).and_then(Value::as_str);
                if let (Some(h), Some(d)) = (hash, data)
                    && missing.remove(h)
                {
                    if !self.dirty_blobs.contains(h) {
                        self.dirty_blobs.insert(h.to_owned());
                    }
                    self.state.hefte.blobs.entry(h.to_owned()).or_insert_with(|| d.to_owned());
                }
            }
            for h in missing {
                self.blob_sizes.remove(&h);
            }
        }
        if targets.is_none() || all_loaded(self) {
            self.payload_loaded = true;
        }
        Ok(true)
    }

    /// Effektiver Änderungszeitpunkt einer Seite: bei Heften das Maximum aus Seiten-`updated` und `heft_updated`.
    pub fn page_updated<'a>(&'a self, page: &'a Page) -> &'a str {
        let p = page.updated();
        match self.heft_updated.get(page.id()) {
            Some(h) if h.as_str() > p => h.as_str(),
            _ => p,
        }
    }

    /// Kennzahlen eines Hefts (`S.heftMeta[pageId]`).
    pub fn heft_meta(&self, page_id: &str) -> Option<HeftMeta> {
        let doc = self.state.hefte.get(page_id)?;
        let ocr_text =
            doc.pages.iter().map(|p| p.ocr_text.as_str()).filter(|t| !t.is_empty()).collect::<Vec<_>>().join("\n");
        let updated = self
            .heft_updated
            .get(page_id)
            .cloned()
            .or_else(|| self.state.pages.get(page_id).and_then(|p| p.updated.clone()))
            .unwrap_or_default();
        let mut bytes = 0;
        for pg in &doc.pages {
            bytes += pg.strokes.iter().map(|s| 40 + s.pts.len() * 14).sum::<usize>();
            for im in pg.all_images() {
                bytes += 60
                    + match (&im.r#ref, &im.src) {
                        (Some(r), _) if !r.is_empty() => self
                            .state
                            .hefte
                            .blobs
                            .get(r)
                            .map(|d| js::len16(d))
                            .filter(|n| *n > 0)
                            .or_else(|| self.blob_sizes.get(r).copied())
                            .unwrap_or(0),
                        (_, Some(src)) => js::len16(src),
                        _ => 0,
                    };
            }
            bytes += pg.texts.iter().map(|t| 60 + t.text.as_deref().map_or(0, js::len16)).sum::<usize>();
        }
        Some(HeftMeta { rev: doc.rev, pages: doc.pages.len(), ocr_text, updated, bytes })
    }
}

/// Hefte aus einem Checkpoint: als geprüfter, noch ungelesener Text (Format 3) oder gelesen (Format 2).
enum StoredHefte {
    Text(Vec<(String, String, String)>),
    Docs(Vec<(String, HeftDoc)>),
}

/// Hefte eines Checkpoints prüfen (`None`: eins ist kaputt). Ohne Text (Format 1) bleiben die Hefte
/// im Zustand: `Some(None)`.
#[allow(clippy::option_option)]
fn read_hefte(hefte: Option<HeftJson>) -> Option<Option<StoredHefte>> {
    Some(match hefte {
        None => None,
        Some(HeftJson::Parts(parts)) => {
            // Nur prüfen, ob es gültiges JSON ist (ohne etwas anzulegen); gelesen wird beim ersten Zugriff.
            for (_, _, json) in &parts {
                serde_json::from_str::<serde::de::IgnoredAny>(json).ok()?;
            }
            Some(StoredHefte::Text(parts))
        }
        Some(HeftJson::All(json)) => match serde_json::from_str::<Value>(&json).ok()? {
            Value::Object(o) => {
                Some(StoredHefte::Docs(o.into_iter().map(|(k, d)| (k, HeftDoc::from_value(d))).collect()))
            }
            // Kein Objekt: wie bisher keine Hefte (`State::from_object` übergeht es).
            _ => Some(StoredHefte::Docs(Vec::new())),
        },
    })
}

/// `String(x || "")`, übernimmt vorhandenen Text ohne Kopie.
fn take_str_or_empty(v: Option<Value>) -> String {
    match v {
        Some(Value::String(s)) => s,
        Some(other) if js::truthy(&other) => js::to_string(&other),
        _ => String::new(),
    }
}

/// Übernimmt `orderTimes` aus einem Checkpoint ohne Schlüssel- oder Zeitstempel-Kopien.
fn take_order_times(v: Value) -> Option<OrderTimes> {
    let Value::Object(o) = v else { return None };
    Some(o.into_iter().map(|(k, v)| (k, take_str_or_empty(Some(v)))).collect())
}

/// `eventLogInfoOf` über das sortierte Log: Event mit der höchsten `seq` (bei Gleichstand das letzte).
fn log_info_of(events: &[LogEvent], count: u64) -> impala_storage::LogInfo {
    let mut max_seq = 0;
    let mut last = String::new();
    for ev in events {
        if ev.seq >= max_seq {
            max_seq = ev.seq;
            last.clone_from(&ev.id);
        }
    }
    impala_storage::LogInfo { count, max_seq, last_event_id: last }
}
