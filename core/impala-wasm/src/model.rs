//! Datenmodell (`impala-model`) für die PWA: Der Kern hält den ganzen Zustand, JS liest ihn über
//! gezielte Abfragen (Seitenliste, eine Seite, ein Heft …). Ein-/Ausgabe bleibt in JS: IndexedDB ist
//! asynchron, der Kern synchron. Darum liest JS vorab, was ein Ablauf braucht (Start, Checkpoint,
//! Heft-Bilder), der Kern rechnet damit und meldet die Schreibvorgänge zurück.
//!
//! Werte gehen als JSON-Text über die Grenze (ein Kopiervorgang je Richtung).

use std::collections::HashMap;

use impala_model::conflict::{self, Conflict, ConflictKind, ImportContext, PageInfo, Resolution, ResolveError, Row};
use impala_model::query::{page_history, sort_key_of};
use impala_model::search::NoteSearch;
use impala_model::study::StudyOptions;
use impala_model::tree::deck_in_tree;
use impala_model::types::Page;
use impala_model::{CheckpointSave, LogEvent, Merge3, Model, merge3, migrate, touched};
use impala_srs::Timestamp;
use impala_storage::{Blob, CheckpointSlot, Error, LogInfo, Object, PartKind, Storage, Write};
use js_sys::Function;
use serde::Serialize;
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

use crate::js::to_js;

/// Fehlertext, wenn ein Ablauf das ganze Log braucht, JS es aber noch nicht geliefert hat.
const NEED_ALL: &str = "need-all-events";

fn parse<T: serde::de::DeserializeOwned>(json: &str) -> Result<T, JsError> {
    serde_json::from_str(json).map_err(|e| JsError::new(&format!("JSON: {e}")))
}

fn text(v: &impl Serialize) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "null".into())
}

fn seq_of(v: Option<&Value>) -> u64 {
    impala_storage::js::seq_of(v)
}

fn log_info(v: Option<&Value>) -> LogInfo {
    let v = v.cloned().unwrap_or(Value::Null);
    LogInfo {
        count: seq_of(v.get("count")),
        max_seq: seq_of(v.get("maxSeq")),
        last_event_id: v.get("lastEventId").and_then(Value::as_str).unwrap_or("").to_owned(),
    }
}

fn objects(v: Value) -> Vec<Object> {
    match v {
        Value::Array(a) => {
            a.into_iter().filter_map(|e| if let Value::Object(o) = e { Some(o) } else { None }).collect()
        }
        _ => Vec::new(),
    }
}

fn strings(v: Value) -> Vec<String> {
    match v {
        Value::Array(a) => a.into_iter().filter_map(|e| e.as_str().map(str::to_owned)).collect(),
        _ => Vec::new(),
    }
}

/// Speicher aus vorab gelesenen Teilen. Was fehlt, ist ein Fehler ([`NEED_ALL`] für das Log);
/// Schreibvorgänge werden nur gesammelt.
#[derive(Default)]
struct Prefetched {
    info: LogInfo,
    /// Wird beim ersten Lesen herausgegeben (der Start liest ihn genau einmal).
    checkpoint: std::cell::RefCell<Option<Object>>,
    boundary: Option<Object>,
    /// Events nach `tail_after` (in `seq`-Reihenfolge).
    tail_after: u64,
    tail: Vec<Object>,
    /// Das ganze Log, falls geliefert.
    all: Option<Vec<Object>>,
    parts: HashMap<(PartKind, String), String>,
    part_hashes: HashMap<PartKind, Vec<String>>,
    writes: Vec<Write>,
}

impl Storage for Prefetched {
    fn events_after(&self, after: u64, up_to: Option<u64>, limit: Option<usize>) -> Result<Vec<Object>, Error> {
        let source = match &self.all {
            Some(all) => all,
            None if after == self.tail_after => &self.tail,
            None => return Err(Error::Backend(NEED_ALL.into())),
        };
        let in_range = |e: &&Object| {
            let s = seq_of(e.get("seq"));
            s > after && up_to.is_none_or(|u| s <= u)
        };
        Ok(source.iter().filter(in_range).take(limit.unwrap_or(usize::MAX)).cloned().collect())
    }

    fn event_at(&self, seq: u64) -> Result<Option<Object>, Error> {
        if let Some(all) = &self.all {
            return Ok(all.iter().find(|e| seq_of(e.get("seq")) == seq).cloned());
        }
        Ok(self.boundary.clone().filter(|b| seq_of(b.get("seq")) == seq))
    }

    fn log_info(&self) -> Result<LogInfo, Error> {
        Ok(self.info.clone())
    }

    fn blob(&self, _key: &str) -> Result<Option<Blob>, Error> {
        Ok(None)
    }

    fn blob_keys(&self) -> Result<Vec<String>, Error> {
        Ok(Vec::new())
    }

    fn vec(&self, _key: &str) -> Result<Option<Value>, Error> {
        Ok(None)
    }

    fn vecs(&self) -> Result<Vec<(String, Value)>, Error> {
        Ok(Vec::new())
    }

    fn checkpoint(&self, slot: CheckpointSlot) -> Result<Option<Object>, Error> {
        Ok(if slot == CheckpointSlot::Current { self.checkpoint.borrow_mut().take() } else { None })
    }

    fn part(&self, kind: PartKind, hash: &str) -> Result<Option<String>, Error> {
        Ok(self.parts.get(&(kind, hash.to_owned())).cloned())
    }

    fn part_hashes(&self, kind: PartKind) -> Result<Vec<String>, Error> {
        Ok(self.part_hashes.get(&kind).cloned().unwrap_or_default())
    }

    fn meta(&self, _key: &str) -> Result<Option<String>, Error> {
        Ok(None)
    }

    fn apply(&mut self, writes: Vec<Write>) -> Result<Vec<u64>, Error> {
        self.writes.extend(writes);
        Ok(Vec::new())
    }
}

/// Seiten ohne `content`: den holt JS einzeln, wenn es ihn liest.
fn record_without(mut o: Object, lazy: &str) -> Value {
    o.remove(lazy);
    Value::Object(o)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HeftMetaJs {
    rev: u64,
    pages: usize,
    ocr_text: String,
    updated: String,
    bytes: usize,
}

/// Der Zustand der App samt Log-Anbindung (eine Instanz je Tab).
#[wasm_bindgen]
pub struct ModelCore {
    m: Model,
    search: NoteSearch,
    load: Option<Prefetched>,
}

impl Default for ModelCore {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl ModelCore {
    #[wasm_bindgen(constructor)]
    pub fn new() -> ModelCore {
        ModelCore { m: Model::new(), search: NoteSearch::new(), load: None }
    }

    // ---- Start ---------------------------------------------------------------------------

    /// Start vorbereiten: `{ info, checkpoint, boundary }` (wie aus IndexedDB gelesen).
    #[wasm_bindgen(js_name = loadBegin)]
    pub fn load_begin(&mut self, meta: &str) -> Result<(), JsError> {
        let mut meta: Value = parse(meta)?;
        let checkpoint = match meta.get_mut("checkpoint").map(Value::take) {
            Some(Value::Object(cp)) => Some(cp),
            _ => None,
        };
        // Ohne Checkpoint gibt es keinen Rest: der Start braucht das ganze Log.
        let tail_after = checkpoint.as_ref().map_or(u64::MAX, |c| seq_of(c.get("maxSeq")));
        self.load = Some(Prefetched {
            info: log_info(meta.get("info")),
            boundary: meta.get("boundary").and_then(Value::as_object).cloned(),
            checkpoint: std::cell::RefCell::new(checkpoint),
            tail_after,
            ..Prefetched::default()
        });
        Ok(())
    }

    /// Events nachreichen (JSON-Liste, `seq`-Reihenfolge): `full` = Teil des ganzen Logs, sonst Rest nach dem Checkpoint.
    #[wasm_bindgen(js_name = loadEvents)]
    pub fn load_events(&mut self, json: &str, full: bool) -> Result<(), JsError> {
        let events = objects(parse(json)?);
        let load = self.load.as_mut().ok_or_else(|| JsError::new("loadBegin fehlt"))?;
        if full {
            load.all.get_or_insert_with(Vec::new).extend(events);
        } else {
            load.tail.extend(events);
        }
        Ok(())
    }

    /// Ein Heft des Checkpoints (JSON-Text unter seinem Hash).
    #[wasm_bindgen(js_name = loadHeftDoc)]
    pub fn load_heft_doc(&mut self, hash: String, json: String) -> Result<(), JsError> {
        let load = self.load.as_mut().ok_or_else(|| JsError::new("loadBegin fehlt"))?;
        load.parts.insert((PartKind::HeftDoc, hash), json);
        Ok(())
    }

    /// Start ausführen. `{ needAll: true }`: das ganze Log nachreichen (`loadEvents(…, true)`) und
    /// erneut aufrufen. Sonst der Bericht samt `clearCheckpoint` (Checkpoint verwerfen, Bilder behalten).
    #[wasm_bindgen(js_name = loadFinish)]
    pub fn load_finish(&mut self, now: &str) -> Result<String, JsError> {
        let mut load = self.load.take().ok_or_else(|| JsError::new("loadBegin fehlt"))?;
        match Model::load(&mut load, now) {
            Ok((model, report)) => {
                self.m = model;
                self.search = NoteSearch::new();
                let clear = load.writes.iter().any(|w| matches!(w, Write::DeleteCheckpoint(_)));
                Ok(json!({
                    "maxSeq": report.max_seq,
                    "maxTime": report.max_time,
                    "count": report.count,
                    "replayed": report.replayed,
                    "checkpointUsed": report.checkpoint_used,
                    "rejectReason": report.reject_reason,
                    "clearCheckpoint": clear,
                })
                .to_string())
            }
            Err(Error::Backend(m)) if m == NEED_ALL && load.all.is_none() => {
                load.writes.clear();
                self.load = Some(load);
                Ok(json!({ "needAll": true }).to_string())
            }
            Err(e) => Err(JsError::new(&e.to_string())),
        }
    }

    // ---- Events ---------------------------------------------------------------------------

    /// Eine eigene Änderung als Log-Event (vor dem Speichern).
    #[wasm_bindgen(js_name = localEvent)]
    pub fn local_event(kind: &str, payload: &str, id: &str, now: &str) -> Result<String, JsError> {
        let payload: Value = if payload.is_empty() { Value::Null } else { parse(payload)? };
        Ok(Value::Object(Model::local_event(kind, payload, id, now).to_object()).to_string())
    }

    /// Eigene, gespeicherte Änderung anwenden. Liefert, was sie berührt hat.
    #[wasm_bindgen(js_name = applyLocal)]
    pub fn apply_local(&mut self, event: &str) -> Result<String, JsError> {
        let ev: Object = parse(event)?;
        let Some(ev) = LogEvent::from_object(&ev) else { return Ok("{}".into()) };
        let probe = ev.clone();
        self.m.apply_local(ev);
        Ok(text(&touched(&probe, self.m.state())))
    }

    /// Bereits gespeicherte Fremd-Events in Zeitreihenfolge anwenden. Liefert je angewandtem
    /// Event `{ i, touched }` (Index in der Eingabe), in Anwendungsreihenfolge.
    #[wasm_bindgen(js_name = applyRemote)]
    pub fn apply_remote(&mut self, events: &str) -> Result<String, JsError> {
        let mut list: Vec<(usize, LogEvent)> = objects(parse(events)?)
            .iter()
            .enumerate()
            .filter_map(|(i, o)| LogEvent::from_object(o).map(|e| (i, e)))
            .collect();
        list.sort_by(|a, b| impala_model::order::compare_events(&a.1, &b.1));
        let mut out = Vec::with_capacity(list.len());
        for (i, ev) in list {
            let probe = ev.clone();
            self.m.apply_remote_one(ev);
            out.push(json!({ "i": i, "touched": touched(&probe, self.m.state()) }));
        }
        Ok(Value::Array(out).to_string())
    }

    /// Gerade offener Chat: sein Tab bleibt, auch bevor die Sitzung gespeichert ist.
    #[wasm_bindgen(js_name = setCurrentChatId)]
    pub fn set_current_chat_id(&mut self, id: Option<String>) {
        self.m.current_chat_id = id;
    }

    /// `false`, sobald ein verspätetes Fremd-Event mit neueren Events kollidiert ist: Der laufende
    /// Zustand weicht dann vom sortierten Log ab, bis JS neu lädt.
    #[wasm_bindgen(js_name = replayOrdered)]
    pub fn replay_ordered(&self) -> bool {
        self.m.replay_ordered()
    }

    #[wasm_bindgen(js_name = loadedTime)]
    pub fn loaded_time(&self) -> String {
        self.m.loaded_time().to_owned()
    }

    #[wasm_bindgen(js_name = loadedSeq)]
    pub fn loaded_seq(&self) -> f64 {
        self.m.loaded_seq() as f64
    }

    #[wasm_bindgen(js_name = baseSeq)]
    pub fn base_seq(&self) -> f64 {
        self.m.base_seq() as f64
    }

    // ---- Checkpoint -----------------------------------------------------------------------

    /// Checkpoint berechnen: `{ info, after, blobHashes, heftHashes }` – `after` sind die Events
    /// nach `baseSeq()` bis `info.maxSeq`, die Hashes die schon gespeicherten Teile. Liefert
    /// `{ status, checkpoint?, blobs?, hefte? }`; bei `written` schreibt JS alles in einer Transaktion
    /// und meldet einen Fehlschlag mit `checkpointNotWritten(Object.keys(blobs))`.
    #[wasm_bindgen(js_name = checkpointSave)]
    pub fn checkpoint_save(&mut self, meta: &str) -> Result<String, JsError> {
        let meta: Value = parse(meta)?;
        let mut store = Prefetched {
            info: log_info(meta.get("info")),
            tail_after: self.m.base_seq(),
            tail: objects(meta.get("after").cloned().unwrap_or(Value::Null)),
            ..Prefetched::default()
        };
        store.part_hashes.insert(PartKind::HeftBlob, strings(meta.get("blobHashes").cloned().unwrap_or_default()));
        store.part_hashes.insert(PartKind::HeftDoc, strings(meta.get("heftHashes").cloned().unwrap_or_default()));
        let status = self.m.save_checkpoint(&mut store).map_err(|e| JsError::new(&e.to_string()))?;
        let name = match status {
            CheckpointSave::Written => "written",
            CheckpointSave::Unchanged => "unchanged",
            CheckpointSave::OutOfOrder => "out-of-order",
            CheckpointSave::Stale => "stale",
        };
        let mut out = json!({ "status": name });
        if status == CheckpointSave::Written {
            let (mut blobs, mut hefte) = (Object::new(), Object::new());
            for w in store.writes {
                match w {
                    Write::PutCheckpoint(_, cp) => {
                        out["checkpoint"] = Value::Object(cp);
                    }
                    Write::PutPart(PartKind::HeftBlob, h, d) => {
                        blobs.insert(h, Value::from(d));
                    }
                    Write::PutPart(PartKind::HeftDoc, h, d) => {
                        hefte.insert(h, Value::from(d));
                    }
                    _ => {}
                }
            }
            out["blobs"] = Value::Object(blobs);
            out["hefte"] = Value::Object(hefte);
        }
        Ok(out.to_string())
    }

    #[wasm_bindgen(js_name = checkpointNotWritten)]
    pub fn checkpoint_not_written(&mut self, dirty: &str) -> Result<(), JsError> {
        self.m.checkpoint_not_written(&strings(parse(dirty)?));
        Ok(())
    }

    // ---- Heft-Bilder ------------------------------------------------------------------------

    #[wasm_bindgen(js_name = hasHeftBlob)]
    pub fn has_heft_blob(&self, hash: &str) -> bool {
        self.m.has_heft_blob(hash)
    }

    /// Bilddaten (dataURL), falls geladen.
    #[wasm_bindgen(js_name = heftBlob)]
    pub fn heft_blob(&self, hash: &str) -> Option<String> {
        self.m.state().hefte.blobs.get(hash).cloned()
    }

    #[wasm_bindgen(js_name = isHeftBlobLoaded)]
    pub fn is_heft_blob_loaded(&self, hash: &str) -> bool {
        self.m.state().hefte.blobs.contains_key(hash)
    }

    #[wasm_bindgen(js_name = releaseHeftBlobs)]
    pub fn release_heft_blobs(&mut self, keep: &str) -> Result<u32, JsError> {
        Ok(self.m.release_heft_blobs(&strings(parse(keep)?)) as u32)
    }

    /// Welche Bilder JS aus dem Checkpoint lesen soll (`targets`: JSON-Liste oder `null` = alle).
    #[wasm_bindgen(js_name = blobsToHydrate)]
    pub fn blobs_to_hydrate(&self, targets: &str) -> Result<String, JsError> {
        let targets: Option<Vec<String>> = parse(targets)?;
        Ok(text(&self.m.blobs_to_hydrate(targets.as_deref())))
    }

    /// Gelesene Bilder übernehmen: `found` aus dem Checkpoint, `recovered` aus dem Log (beide `{ hash: data }`).
    #[wasm_bindgen(js_name = hydrateHeftBlobs)]
    pub fn hydrate_heft_blobs(&mut self, targets: &str, found: &str, recovered: &str) -> Result<(), JsError> {
        let targets: Option<Vec<String>> = parse(targets)?;
        let found: HashMap<String, String> = parse(found)?;
        let recovered: HashMap<String, String> = parse(recovered)?;
        let store = Prefetched {
            parts: found.into_iter().map(|(h, d)| ((PartKind::HeftBlob, h), d)).collect(),
            all: Some(
                recovered
                    .into_iter()
                    .enumerate()
                    .map(|(i, (hash, data))| {
                        let mut o = Object::new();
                        o.insert("id".into(), Value::from(format!("blob-{i}")));
                        o.insert("seq".into(), Value::from(i + 1));
                        o.insert("type".into(), Value::from("heftBlob"));
                        o.insert("payload".into(), json!({ "hash": hash, "data": data }));
                        o
                    })
                    .collect(),
            ),
            ..Prefetched::default()
        };
        self.m.hydrate_heft_blobs(&store, targets.as_deref()).map_err(|e| JsError::new(&e.to_string()))?;
        Ok(())
    }

    // ---- Lese-Ansichten -------------------------------------------------------------------------

    /// Einträge einer Sammlung als `{ id: Eintrag }` (`ids`: JSON-Liste oder `null` = alle).
    /// Seiten ohne `content`.
    pub fn records(&self, kind: &str, ids: &str) -> Result<String, JsError> {
        let ids: Option<Vec<String>> = parse(ids)?;
        let s = self.m.state();
        fn pick<T>(
            map: &impala_model::JsMap<T>,
            ids: &Option<Vec<String>>,
            f: impl Fn(&T) -> Value,
        ) -> serde_json::Map<String, Value> {
            match ids {
                Some(ids) => ids.iter().filter_map(|id| map.get(id).map(|v| (id.clone(), f(v)))).collect(),
                None => map.iter().map(|(k, v)| (k.clone(), f(v))).collect(),
            }
        }
        let out = match kind {
            "pages" => pick(&s.pages, &ids, |p| record_without(p.to_object(), "content")),
            "cards" => pick(&s.cards, &ids, |c| Value::Object(c.to_object())),
            "grades" => pick(&s.grades, &ids, |c| Value::Object(c.to_object())),
            "learningSessions" => pick(&s.learning_sessions, &ids, |c| Value::Object(c.to_object())),
            "chatSessions" => pick(&s.chat_sessions, &ids, |c| Value::Object(c.to_object())),
            "homeArticles" => pick(&s.home_articles, &ids, |c| Value::Object(c.to_object())),
            "decks" => pick(&s.decks, &ids, |c| Value::Object(c.to_object())),
            "workspaces" => pick(&s.workspaces, &ids, |c| Value::Object(c.to_object())),
            "gnFolders" => pick(&s.gn_folders, &ids, |c| Value::Object(c.to_object())),
            "treeOpen" => pick(&s.tree_open, &ids, |b| Value::Bool(*b)),
            _ => return Err(JsError::new("unbekannte Sammlung")),
        };
        Ok(Value::Object(out).to_string())
    }

    /// Ein Feld eines Eintrags, das [`ModelCore::records`] auslässt (`content`).
    #[wasm_bindgen(js_name = recordField)]
    pub fn record_field(&self, kind: &str, id: &str, key: &str) -> JsValue {
        let s = self.m.state();
        let v = match kind {
            "pages" => s.pages.get(id).and_then(|p| p.get(key)),
            _ => None,
        };
        match v {
            Some(Value::String(t)) => JsValue::from_str(&t),
            Some(v) => to_js(&v),
            None => JsValue::UNDEFINED,
        }
    }

    pub fn settings(&self) -> String {
        text(&self.m.state().settings)
    }

    pub fn reviews(&self) -> String {
        text(&self.m.state().reviews)
    }

    pub fn telemetry(&self) -> String {
        text(&self.m.state().telemetry)
    }

    /// `{ tabs, activeTabId }` wie gespeichert.
    pub fn tabs(&self) -> String {
        let s = self.m.state();
        json!({ "tabs": s.tabs, "activeTabId": s.active_tab_id }).to_string()
    }

    // ---- Hefte ------------------------------------------------------------------------------

    /// Seiten-IDs aller Hefte mit Inhalt.
    #[wasm_bindgen(js_name = heftIds)]
    pub fn heft_ids(&self) -> String {
        text(&self.m.state().hefte.ids().collect::<Vec<_>>())
    }

    /// Ein ganzes Heft (`{ v, rev, pages }`).
    #[wasm_bindgen(js_name = heftDoc)]
    pub fn heft_doc(&self, page_id: &str) -> Option<String> {
        self.m.state().hefte.get(page_id).map(text)
    }

    /// Eine Heftseite nach Position.
    #[wasm_bindgen(js_name = heftPage)]
    pub fn heft_page(&self, page_id: &str, index: usize) -> Option<String> {
        self.m.state().hefte.get(page_id)?.pages.get(index).map(text)
    }

    /// Schatten des gespeicherten Hefts (Diff-Basis des Editors), direkt aus dem Kern.
    #[wasm_bindgen(js_name = heftShadow)]
    pub fn heft_shadow(&self, page_id: &str) -> Option<crate::heft::HeftShadow> {
        let doc = self.m.state().hefte.get(page_id)?;
        Some(crate::heft::HeftShadow(impala_heft::Shadow::of(doc)))
    }

    /// Eine Heftseite nach ihrer ID.
    #[wasm_bindgen(js_name = heftPageById)]
    pub fn heft_page_by_id(&self, page_id: &str, key: &str) -> Option<String> {
        self.m.state().hefte.get(page_id)?.page(key).map(text)
    }

    /// IDs der Heftseiten in Reihenfolge (`null` ohne Heft).
    #[wasm_bindgen(js_name = heftPageIds)]
    pub fn heft_page_ids(&self, page_id: &str) -> Option<String> {
        let doc = self.m.state().hefte.get(page_id)?;
        Some(text(&doc.pages.iter().map(|p| p.id.as_str()).collect::<Vec<_>>()))
    }

    /// Kennzahlen (`{ rev, pages, ocrText, updated, bytes }`).
    #[wasm_bindgen(js_name = heftMeta)]
    pub fn heft_meta(&self, page_id: &str) -> Option<String> {
        let m = self.m.heft_meta(page_id)?;
        Some(text(&HeftMetaJs { rev: m.rev, pages: m.pages, ocr_text: m.ocr_text, updated: m.updated, bytes: m.bytes }))
    }

    /// Bildreferenzen eines Hefts.
    #[wasm_bindgen(js_name = heftImageRefs)]
    pub fn heft_image_refs(&self, page_id: &str) -> String {
        let refs: Vec<&str> = self
            .m
            .state()
            .hefte
            .get(page_id)
            .into_iter()
            .flat_map(|d| d.pages.iter())
            .flat_map(|p| p.images.iter())
            .filter_map(|i| i.r#ref.as_deref())
            .filter(|r| !r.is_empty())
            .collect();
        text(&refs)
    }

    /// Übersicht aller Hefte für den Handschrift-Index, ohne Punkte:
    /// `[{ pageId, pages: [{ id, strokes, ocrText, images: [{ id, ref, scan, ocr, x, y, w, h }] }] }]`
    /// (`strokes`: Anzahl; `ocr`: nur vorhanden, wenn das Bild schon erkannt ist).
    #[wasm_bindgen(js_name = heftIndexSummary)]
    pub fn heft_index_summary(&self) -> String {
        let out: Vec<Value> = self
            .m
            .state()
            .hefte
            .iter()
            .map(|(id, doc)| {
                let pages: Vec<Value> = doc
                    .pages
                    .iter()
                    .map(|p| {
                        let images: Vec<Value> = p
                            .images
                            .iter()
                            .map(|im| {
                                let mut o = match serde_json::to_value(im) {
                                    Ok(Value::Object(o)) => o,
                                    _ => Object::new(),
                                };
                                o.remove("src");
                                if o.contains_key("ocr") {
                                    o.insert("ocr".into(), Value::Bool(true));
                                }
                                Value::Object(o)
                            })
                            .collect();
                        json!({ "id": p.id, "strokes": p.strokes.len(), "ocrText": p.ocr_text, "images": images })
                    })
                    .collect();
                json!({ "pageId": id, "pages": pages })
            })
            .collect();
        Value::Array(out).to_string()
    }

    /// Heft mit noch nicht gespeicherten Operationen (ändert nichts).
    #[wasm_bindgen(js_name = heftPreview)]
    pub fn heft_preview(&self, page_id: &str, ops: &str) -> Result<Option<String>, JsError> {
        Ok(self.m.heft_preview(page_id, parse(ops)?).map(|d| text(&d)))
    }

    // ---- Abfragen (Ergebnis: IDs) -----------------------------------------------------------------

    #[wasm_bindgen(js_name = activePages)]
    pub fn active_pages(&self) -> String {
        ids_of(self.m.state().active_pages())
    }

    #[wasm_bindgen(js_name = trashedPages)]
    pub fn trashed_pages(&self) -> String {
        ids_of(self.m.state().trashed_pages())
    }

    #[wasm_bindgen(js_name = archivedPages)]
    pub fn archived_pages(&self) -> String {
        ids_of(self.m.state().archived_pages())
    }

    #[wasm_bindgen(js_name = archivedPageRoots)]
    pub fn archived_page_roots(&self) -> String {
        ids_of(self.m.state().archived_page_roots())
    }

    #[wasm_bindgen(js_name = childPagesOf)]
    pub fn child_pages_of(&self, id: Option<String>) -> String {
        ids_of(self.m.state().child_pages_of(id.as_deref()))
    }

    #[wasm_bindgen(js_name = childrenOf)]
    pub fn children_of(&self, id: Option<String>, workspace: Option<String>, current: Option<String>) -> String {
        ids_of(self.m.state().children_of(id.as_deref(), workspace.as_deref(), current.as_deref()))
    }

    #[wasm_bindgen(js_name = ancestorsOf)]
    pub fn ancestors_of(&self, id: &str) -> String {
        ids_of(self.m.state().ancestors_of(id))
    }

    #[wasm_bindgen(js_name = pageSubtree)]
    pub fn page_subtree(&self, id: &str) -> String {
        text(&self.m.state().page_subtree(id))
    }

    #[wasm_bindgen(js_name = pageInTree)]
    pub fn page_in_tree(&self, page: Option<String>, root: &str) -> bool {
        self.m.state().page_in_tree(page.as_deref(), root)
    }

    #[wasm_bindgen(js_name = isPageArchived)]
    pub fn is_page_archived(&self, id: &str) -> bool {
        self.m.state().is_page_archived(id)
    }

    /// `[[titel, id], …]` – erste nicht gelöschte Seite je Titel.
    #[wasm_bindgen(js_name = pagesByTitle)]
    pub fn pages_by_title(&self) -> String {
        let pairs: Vec<(&str, &str)> = self.m.state().pages_by_title().into_iter().map(|(t, p)| (t, p.id())).collect();
        text(&pairs)
    }

    #[wasm_bindgen(js_name = findPage)]
    pub fn find_page(&self, title: &str, include_archived: bool) -> Option<String> {
        self.m.state().find_page(title, include_archived).map(|p| p.id().to_owned())
    }

    #[wasm_bindgen(js_name = backlinksOf)]
    pub fn backlinks_of(&self, id: &str) -> String {
        ids_of(self.m.state().backlinks_of(id))
    }

    #[wasm_bindgen(js_name = sortKeyOf)]
    pub fn sort_key(&self, id: &str) -> f64 {
        self.m.state().pages.get(id).map_or(0.0, sort_key_of)
    }

    #[wasm_bindgen(js_name = activeCards)]
    pub fn active_cards(&self) -> String {
        card_ids(self.m.state().active_cards())
    }

    #[wasm_bindgen(js_name = archivedCards)]
    pub fn archived_cards(&self) -> String {
        card_ids(self.m.state().archived_cards())
    }

    #[wasm_bindgen(js_name = trashedCards)]
    pub fn trashed_cards(&self) -> String {
        card_ids(self.m.state().trashed_cards())
    }

    #[wasm_bindgen(js_name = orphanArchivedCards)]
    pub fn orphan_archived_cards(&self) -> String {
        card_ids(self.m.state().orphan_archived_cards())
    }

    #[wasm_bindgen(js_name = orphanTrashedCards)]
    pub fn orphan_trashed_cards(&self) -> String {
        card_ids(self.m.state().orphan_trashed_cards())
    }

    #[wasm_bindgen(js_name = archivedDeckRoots)]
    pub fn archived_deck_roots(&self) -> String {
        text(&self.m.state().archived_deck_roots())
    }

    #[wasm_bindgen(js_name = trashedDeckRoots)]
    pub fn trashed_deck_roots(&self) -> String {
        text(&self.m.state().trashed_deck_roots())
    }

    #[wasm_bindgen(js_name = isDeckArchived)]
    pub fn is_deck_archived(&self, name: &str) -> bool {
        self.m.state().is_deck_archived(name)
    }

    #[wasm_bindgen(js_name = isCardArchived)]
    pub fn is_card_archived(&self, id: &str) -> bool {
        let s = self.m.state();
        s.cards.get(id).is_some_and(|c| s.is_card_archived(c))
    }

    #[wasm_bindgen(js_name = cardsInDeckTree)]
    pub fn cards_in_deck_tree(&self, root: &str, include_trashed: bool) -> String {
        text(&self.m.state().cards_in_deck_tree(root, include_trashed))
    }

    #[wasm_bindgen(js_name = deckConf)]
    pub fn deck_conf(&self, deck: &str) -> String {
        text(&self.m.state().deck_conf(deck).0)
    }

    /// Lernwarteschlange; Zeiten in ms seit 1970 (lokale Tagesgrenzen rechnet JS).
    #[wasm_bindgen(js_name = studySnapshot)]
    pub fn study_snapshot(
        &self,
        deck: Option<String>,
        now: f64,
        day_start: f64,
        day_end: f64,
        mix: bool,
        overlearn_lock: bool,
    ) -> String {
        let o = StudyOptions {
            deck: deck.as_deref().filter(|d| !d.is_empty()),
            now: Timestamp(now as i64),
            day_start: Timestamp(day_start as i64),
            day_end: Timestamp(day_end as i64),
            mix,
            overlearn_lock,
        };
        let s = self.m.state().study_snapshot(&o);
        json!({
            "dueNow": s.due_now,
            "learnDue": s.learn_due,
            "learnWaiting": s.learn_waiting,
            "learnLaterToday": s.learn_later_today,
            "reviewsDue": s.reviews_due,
            "newDue": s.new_due,
            "counts": {
                "learn": s.counts.learn,
                "learnNow": s.counts.learn_now,
                "learnWaiting": s.counts.learn_waiting,
                "review": s.counts.review,
                "neu": s.counts.new,
                "total": s.counts.total,
            },
            "nextLearnAt": s.next_learn_at,
            "lockedAhead": s.locked_ahead,
            "done": s.done,
            "finishedForNow": s.finished_for_now,
            "available": s.available,
        })
        .to_string()
    }

    /// Seitensuche: `[{ id, score, terms, snippet }]`.
    #[wasm_bindgen(js_name = searchNotes)]
    pub fn search_notes(&mut self, query: &str, include_archived: bool) -> String {
        let hits = self.search.search(&self.m, query, include_archived);
        let out: Vec<Value> = hits
            .into_iter()
            .map(|h| json!({ "id": h.id, "score": h.score, "terms": h.terms, "snippet": h.snippet }))
            .collect();
        Value::Array(out).to_string()
    }

    // ---- Migration --------------------------------------------------------------------------

    /// Patch für alte, lokal gespeicherte Zugangsdaten (`impala67.secrets`/`notion.secrets`), sonst `undefined`.
    #[wasm_bindgen(js_name = legacySecretsPatch)]
    pub fn legacy_secrets_patch(&self, current: Option<String>, older: Option<String>) -> Option<String> {
        let legacy = migrate::parse_legacy_secrets(current.as_deref(), older.as_deref());
        migrate::legacy_secrets_patch(&self.m.state().settings, &legacy).map(|p| Value::Object(p).to_string())
    }

    /// Gerettete Alt-Kopien früherer Konflikte (`resolved`: schon quittierte Kopien, JSON-Liste).
    #[wasm_bindgen(js_name = conflictLegacyItems)]
    pub fn conflict_legacy_items(&self, resolved: &str) -> Result<String, JsError> {
        let resolved: std::collections::HashSet<String> = strings(parse(resolved)?).into_iter().collect();
        let items: Vec<Value> = conflict::legacy_conflict_items(self.m.state(), &resolved)
            .into_iter()
            .map(|c| Value::Object(c.to_object()))
            .collect();
        Ok(Value::Array(items).to_string())
    }

    /// Fehlende Texte eines gespeicherten Konflikts aus dem Zustand ergänzen.
    #[wasm_bindgen(js_name = conflictWithTexts)]
    pub fn conflict_with_texts(&self, conflict: &str) -> Result<String, JsError> {
        let c = Conflict::from_object(parse(conflict)?);
        Ok(Value::Object(c.with_texts_from(self.m.state()).to_object()).to_string())
    }

    /// Events einer Entscheidung: `{ events: [[type, payload], …] }` oder `{ error }`
    /// (`copy-missing`, `loser-missing`; dann ist nichts zu tun).
    #[wasm_bindgen(js_name = conflictResolve)]
    pub fn conflict_resolve(&self, conflict: &str, action: &str) -> Result<String, JsError> {
        let c = Conflict::from_object(parse(conflict)?);
        let how = Resolution::parse(action).ok_or_else(|| JsError::new("unbekannte Entscheidung"))?;
        Ok(match c.resolve(self.m.state(), how) {
            Ok(events) => json!({ "events": events }),
            Err(ResolveError::CopyMissing) => json!({ "error": "copy-missing" }),
            Err(ResolveError::LoserMissing) => json!({ "error": "loser-missing" }),
        }
        .to_string())
    }

    /// Konflikt-Prüfung eines Imports. `fresh`: neue Fremd-Events; `local`: lokale Events nach
    /// `unsyncedAfterSeq` (mehr braucht die Prüfung nicht); `history`: das ganze Log oder `null`.
    /// `{ needHistory: true }`: mit dem ganzen Log erneut aufrufen. Sonst `{ added, conflicts, merged }`
    /// (`added`: abgeleitete Events, die an `fresh` angehängt werden).
    #[wasm_bindgen(js_name = importConflicts)]
    #[allow(clippy::too_many_arguments)]
    pub fn import_conflicts(
        &self,
        fresh: &str,
        local: &str,
        unsynced_after_seq: f64,
        history: Option<String>,
        known: &Function,
        now: &Function,
    ) -> Result<String, JsError> {
        let mut fresh = objects(parse(fresh)?);
        let before = fresh.len();
        let local = objects(parse(local)?);
        let mut history: Option<Vec<Object>> = match history {
            Some(h) => Some(objects(parse(&h)?)),
            None => None,
        };
        let mut missing = false;
        let mut get_history = || match history.take() {
            Some(h) => h,
            None => {
                missing = true;
                Vec::new()
            }
        };
        let known_fn = |id: &str| known.call1(&JsValue::NULL, &JsValue::from_str(id)).is_ok_and(|v| v.is_truthy());
        let state = self.m.state();
        let page_info = |id: &str| -> Option<PageInfo> { state.page_info(id) };
        let mut now_fn = || now.call0(&JsValue::NULL).ok().and_then(|v| v.as_string()).unwrap_or_default();
        let res = conflict::detect_import_conflicts(
            &mut fresh,
            ImportContext {
                local: &local,
                unsynced_after_seq: unsynced_after_seq.max(0.0) as u64,
                known: &known_fn,
                history: &mut get_history,
                page_info: &page_info,
                now: &mut now_fn,
            },
        );
        if missing {
            return Ok(json!({ "needHistory": true }).to_string());
        }
        let added: Vec<Value> = fresh.into_iter().skip(before).map(Value::Object).collect();
        let conflicts: Vec<Value> = res.conflicts.iter().map(|c| Value::Object(c.to_object())).collect();
        Ok(json!({ "added": added, "conflicts": conflicts, "merged": res.merged }).to_string())
    }
}

fn ids_of(pages: Vec<&Page>) -> String {
    text(&pages.into_iter().map(Page::id).collect::<Vec<_>>())
}

fn card_ids(cards: Vec<&impala_model::Card>) -> String {
    text(&cards.into_iter().map(impala_model::Card::id).collect::<Vec<_>>())
}

/// Liegt der Stapel `deck` im Teilbaum `root` (`"Eltern::Kind"`)?
#[wasm_bindgen(js_name = deckInTree)]
pub fn deck_in_tree_js(deck: &str, root: &str) -> bool {
    deck_in_tree(deck, root)
}

/// Seitenverlauf aus dem Log (`[{ t, title, content }]`).
#[wasm_bindgen(js_name = pageHistory)]
pub fn page_history_js(events: &str, id: &str) -> Result<String, JsError> {
    let events: Vec<LogEvent> = objects(parse(events)?).iter().filter_map(LogEvent::from_object).collect();
    let out: Vec<Value> = page_history(events, id)
        .into_iter()
        .map(|v| json!({ "t": v.t, "title": v.title, "content": v.content }))
        .collect();
    Ok(Value::Array(out).to_string())
}

/// Drei-Wege-Abgleich eines Textes: `{ ok: true, text }` oder `{ ok: false }`.
#[wasm_bindgen(js_name = merge3)]
pub fn merge3_js(base: &str, mine: &str, theirs: &str) -> String {
    match merge3(base, mine, theirs) {
        Merge3::Merged { text, .. } => json!({ "ok": true, "text": text }).to_string(),
        _ => json!({ "ok": false }).to_string(),
    }
}

/// Art, Titel, Zeit, Entscheidungen und Schlüssel eines Konflikts für den Dialog.
#[wasm_bindgen(js_name = conflictInfo)]
pub fn conflict_info(conflict: &str) -> Result<String, JsError> {
    let c = Conflict::from_object(parse(conflict)?);
    let kind = match c.kind() {
        ConflictKind::Both => "both",
        ConflictKind::Delete => "delete",
        ConflictKind::Legacy => "legacy",
    };
    let choices: Vec<Value> = c
        .choices()
        .iter()
        .map(|ch| json!({ "action": ch.resolution.as_str(), "recommended": ch.recommended }))
        .collect();
    Ok(json!({
        "kind": kind,
        "title": c.display_title(),
        "time": c.time(),
        "choices": choices,
        "recommended": c.recommended().map(Resolution::as_str),
        "key": c.key(),
    })
    .to_string())
}

/// Titel ohne Konflikt-Präfixe und Zeitstempel.
#[wasm_bindgen(js_name = conflictTitle)]
pub fn conflict_title_js(title: &str) -> String {
    conflict::conflict_title(title)
}

/// Zweispaltiger Vergleich zweier Fassungen: `[{ left, right, changed, start } | { gap }]`, `null`
/// bei zu großer abweichender Mitte.
#[wasm_bindgen(js_name = conflictDiffRows)]
pub fn conflict_diff_rows(left: &str, right: &str) -> String {
    let Some(diff) = conflict::conflict_diff(left, right) else { return "null".into() };
    let rows: Vec<Value> = conflict::align_diff_rows(&diff)
        .into_iter()
        .map(|r| match r {
            Row::Line { left, right, changed, start } => {
                json!({ "left": left, "right": right, "changed": changed, "start": start })
            }
            Row::Gap(n) => json!({ "gap": n }),
        })
        .collect();
    Value::Array(rows).to_string()
}
