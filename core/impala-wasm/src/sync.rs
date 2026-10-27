//! Cloudflare-Sync für die PWA: der ganze Ablauf in Rust, Ein-/Ausgabe im Browser.
//! JS reicht zwei Objekte herein: `http.send(request)` (fetch) und `store` (IndexedDB,
//! localStorage, App-Zustand). Timer, WebSocket und Statusanzeige bleiben in JS.

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use impala_crypto::{OsRandom, StorageUsage, SyncKey};
use impala_sync::api::{ServerMessage, WS_PING_INTERVAL_MS, WS_PING_MESSAGE, parse_server_message};
use impala_sync::{
    LocalBlob, PassReport, StoreError, SyncClient, SyncError, SyncState, SyncStore, WsAction, is_uploadable,
    reconnect_delay_ms, retry_delay_ms, should_compact_cloud,
};
use js_sys::{Array, Function, Object, Promise, Uint8Array};
use serde_json::{Map, Value, json};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

use crate::js::{JsHttp, bytes, call, call_sync, from_js, get, seq, set, to_js};

type Client = SyncClient<JsHttp, JsStore>;

// ---------------------------------------------------------------------------
// Ablage: Methoden des JS-Objekts `store` (siehe web/sync-cloudflare.js)

#[derive(Clone)]
pub struct JsStore(JsValue);

fn store_err(m: String) -> StoreError {
    StoreError(m)
}

fn count(v: &Value, key: &str) -> u64 {
    v.get(key).and_then(Value::as_f64).filter(|n| n.is_finite() && *n > 0.0).map_or(0, |n| n as u64)
}

impl SyncStore for JsStore {
    async fn load_state(&self) -> SyncState {
        let v = call(&self.0, "loadState", &[]).await.ok().and_then(|v| from_js(&v).ok()).unwrap_or(Value::Null);
        let ignored_blobs = v
            .get("ignoredBlobs")
            .and_then(Value::as_object)
            .map(|m| m.iter().filter_map(|(k, id)| Some((k.clone(), id.as_str()?.to_owned()))).collect())
            .unwrap_or_default();
        SyncState {
            last_synced_seq: count(&v, "lastSyncedSeq"),
            last_uploaded_seq: count(&v, "lastUploadedSeq"),
            generation: count(&v, "generation"),
            ignored_blobs,
        }
    }

    async fn save_state(&mut self, state: &SyncState) -> Result<(), StoreError> {
        call(&self.0, "saveState", &[to_js(&state_json(state))]).await.map(drop).map_err(store_err)
    }

    async fn max_seq(&self) -> Result<u64, StoreError> {
        call(&self.0, "maxSeq", &[]).await.map(|v| seq(&v)).map_err(store_err)
    }

    async fn events_after(&self, after_seq: u64, up_to_seq: u64) -> Result<Vec<Value>, StoreError> {
        // u64::MAX heißt „bis zum Ende“: als JS-Zahl Infinity.
        let up_to = if up_to_seq == u64::MAX { f64::INFINITY } else { up_to_seq as f64 };
        let v = call(&self.0, "eventsAfter", &[(after_seq as f64).into(), up_to.into()]).await.map_err(store_err)?;
        events(&v)
    }

    fn filter_for_upload(&self, events_in: Vec<Value>) -> Vec<Value> {
        // Ein Fehler in den App-Regeln darf keine Geheimnisse durchlassen: dann nichts hochladen.
        call_sync(&self.0, "filterForUpload", &[to_js(&Value::Array(events_in))])
            .ok()
            .and_then(|v| events(&v).ok())
            .unwrap_or_default()
    }

    async fn import_remote(&mut self, events: Vec<Value>, unsynced_after_seq: u64) -> Result<(), StoreError> {
        call(&self.0, "importRemote", &[to_js(&Value::Array(events)), (unsynced_after_seq as f64).into()])
            .await
            .map(drop)
            .map_err(store_err)
    }

    fn pages(&self) -> Map<String, Value> {
        call_sync(&self.0, "pages", &[])
            .ok()
            .and_then(|v| from_js(&v).ok())
            .and_then(|v| if let Value::Object(m) = v { Some(m) } else { None })
            .unwrap_or_default()
    }

    async fn blob_ids(&self) -> Result<Vec<String>, StoreError> {
        let v = call(&self.0, "blobIds", &[]).await.map_err(store_err)?;
        Ok(Array::from(&v).iter().filter_map(|id| id.as_string()).collect())
    }

    async fn get_blob(&self, id: &str) -> Result<Option<LocalBlob>, StoreError> {
        let v = call(&self.0, "getBlob", &[id.into()]).await.map_err(store_err)?;
        if v.is_null() || v.is_undefined() {
            return Ok(None);
        }
        let meta = from_js(&get(&v, "meta")).map_err(store_err)?;
        Ok(Some(LocalBlob { meta, data: bytes(&get(&v, "data")) }))
    }

    async fn put_blob(&mut self, id: &str, blob: LocalBlob) -> Result<(), StoreError> {
        let data = Uint8Array::from(blob.data.as_slice());
        call(&self.0, "putBlob", &[id.into(), to_js(&blob.meta), data.into()]).await.map(drop).map_err(store_err)
    }
}

fn events(v: &JsValue) -> Result<Vec<Value>, StoreError> {
    match from_js(v).map_err(store_err)? {
        Value::Array(list) => Ok(list),
        Value::Null => Ok(Vec::new()),
        _ => Err(StoreError("Ablage lieferte keine Event-Liste.".into())),
    }
}

fn state_json(s: &SyncState) -> Value {
    json!({
        "lastSyncedSeq": s.last_synced_seq,
        "lastUploadedSeq": s.last_uploaded_seq,
        "generation": s.generation,
        "ignoredBlobs": s.ignored_blobs,
    })
}

fn usage_json(u: &StorageUsage) -> Value {
    json!({
        "bytes": u.bytes, "limit": u.limit, "mbUsed": u.mb_used, "mbLimit": u.mb_limit,
        "percent": u.percent, "formatted": u.formatted,
    })
}

fn pass_json(r: &PassReport) -> Value {
    json!({
        "received": r.received,
        "blobs": r.blobs.as_ref().map(|b| json!({
            "uploaded": b.uploaded, "downloaded": b.downloaded, "ignored": b.ignored, "oversized": b.oversized,
        })),
        "uploaded": r.push.uploaded,
        "confirmed": r.push.confirmed,
        "events": r.push.events,
        "packets": r.push.packets,
        "compactionSkipped": r.push.compaction_skipped,
    })
}

/// JS-`Error` mit `status`, `retryable`, `quota` und `code: "stopped"` für die Steuerung in JS.
fn sync_err(e: SyncError) -> JsValue {
    let err = js_sys::Error::new(&e.to_string());
    let obj: &Object = err.unchecked_ref();
    if let Some(status) = e.status() {
        set(obj, "status", status);
    }
    set(obj, "retryable", e.is_retryable());
    set(obj, "quota", e.is_quota());
    if e == SyncError::Stopped {
        set(obj, "code", "stopped");
    }
    err.into()
}

// ---------------------------------------------------------------------------

/// Was während eines Durchgangs ankommt und danach am Client nachgeholt wird.
enum Deferred {
    Message(String),
    Local(Value),
}

/// Ein Konto: neue Zugangsdaten = neues `SyncCore`. Ein Durchgang zur Zeit (JS reiht ein).
#[wasm_bindgen]
pub struct SyncCore {
    client: Rc<RefCell<Option<Client>>>,
    deferred: Rc<RefCell<Vec<Deferred>>>,
    store: JsStore,
    stop: Arc<AtomicBool>,
    client_id: String,
    ws_url: String,
    ws_auth: String,
}

/// Nimmt den Client für einen Durchgang heraus.
fn take(cell: &Rc<RefCell<Option<Client>>>) -> Result<Client, JsValue> {
    cell.borrow_mut().take().ok_or_else(|| js_sys::Error::new("Sync läuft bereits.").into())
}

/// Gibt ihn zurück und holt nach, was währenddessen ankam.
async fn give_back(cell: &Rc<RefCell<Option<Client>>>, deferred: &Rc<RefCell<Vec<Deferred>>>, mut client: Client) {
    loop {
        let pending: Vec<Deferred> = deferred.borrow_mut().drain(..).collect();
        if pending.is_empty() {
            break;
        }
        for d in pending {
            match d {
                // Den Durchgang dafür hat JS schon angestoßen; hier zählt nur der Zustand.
                Deferred::Message(text) => drop(client.handle_server_message(&text).await),
                Deferred::Local(ev) => drop(client.note_local_event(&ev)),
            }
        }
    }
    *cell.borrow_mut() = Some(client);
}

fn action_json(a: WsAction) -> Value {
    match a {
        WsAction::Nothing => json!({ "action": "none" }),
        WsAction::Sync { force_all } => json!({ "action": "sync", "forceAll": force_all }),
        WsAction::Rejected(message) => json!({ "action": "rejected", "message": message }),
    }
}

#[wasm_bindgen]
impl SyncCore {
    /// Leitet den Schlüssel ab (PBKDF2), lädt den Sync-Zustand und liefert den Client.
    /// `on_progress(label, current, total)` darf `undefined` sein.
    pub async fn open(
        base_url: String,
        sync_key: String,
        client_id: String,
        http: JsValue,
        store: JsValue,
        on_progress: JsValue,
    ) -> Result<SyncCore, JsError> {
        let key = SyncKey::parse(&sync_key).map_err(|e| JsError::new(&e.to_string()))?;
        let creds = key.derive();
        let store = JsStore(store);
        let mut client = SyncClient::new(JsHttp(http), store.clone(), &base_url, &creds, &client_id).await;
        if let Ok(f) = on_progress.dyn_into::<Function>() {
            client.on_progress(move |p| {
                let _ = f.call3(&JsValue::NULL, &p.label.into(), &(p.current as f64).into(), &(p.total as f64).into());
            });
        }
        let endpoint = client.endpoint();
        let (ws_url, ws_auth) = (endpoint.ws_url(), endpoint.ws_auth_message());
        Ok(SyncCore {
            stop: client.stop_flag(),
            client: Rc::new(RefCell::new(Some(client))),
            deferred: Rc::new(RefCell::new(Vec::new())),
            store,
            client_id,
            ws_url,
            ws_auth,
        })
    }

    /// Ein Durchgang (Abrufen → Dateien → Senden); volle Quota verdichtet die Cloud einmal.
    pub fn sync(&self, force_all: bool) -> Promise {
        let (cell, deferred) = (self.client.clone(), self.deferred.clone());
        future_to_promise(async move {
            let mut client = take(&cell)?;
            let result = client.sync(force_all).await;
            give_back(&cell, &deferred, client).await;
            result.map(|r| to_js(&pass_json(&r))).map_err(sync_err)
        })
    }

    /// Cloud-Kompaktierung: abgleichen, Generationsschnitt, Neuaufbau.
    #[wasm_bindgen(js_name = compactCloud)]
    pub fn compact_cloud(&self, bypass_cooldown: bool) -> Promise {
        let (cell, deferred) = (self.client.clone(), self.deferred.clone());
        future_to_promise(async move {
            let mut client = take(&cell)?;
            let result = client.compact_cloud(bypass_cooldown).await;
            give_back(&cell, &deferred, client).await;
            result
                .map(|r| {
                    to_js(&json!({ "before": r.before, "after": r.after, "reclaimed": r.reclaimed,
                        "pass": pass_json(&r.pass) }))
                })
                .map_err(sync_err)
        })
    }

    /// Löscht alle Pakete und Dateien auf dem Server (Generationsschnitt).
    #[wasm_bindgen(js_name = resetCloud)]
    pub fn reset_cloud(&self) -> Promise {
        let (cell, deferred) = (self.client.clone(), self.deferred.clone());
        future_to_promise(async move {
            let mut client = take(&cell)?;
            let result = client.reset_cloud().await;
            give_back(&cell, &deferred, client).await;
            result.map(|()| JsValue::TRUE).map_err(sync_err)
        })
    }

    /// WebSocket-Nachricht → `{ action: "none" | "sync" | "rejected", forceAll?, message? }`.
    /// Während eines Durchgangs wird der Zustand danach nachgezogen.
    #[wasm_bindgen(js_name = handleServerMessage)]
    pub fn handle_server_message(&self, text: String) -> Promise {
        let (cell, deferred, client_id) = (self.client.clone(), self.deferred.clone(), self.client_id.clone());
        future_to_promise(async move {
            let taken = cell.borrow_mut().take();
            let Some(mut client) = taken else {
                let action = match parse_server_message(&text, &client_id).map_err(sync_err)? {
                    ServerMessage::Rejected(message) => WsAction::Rejected(message),
                    ServerMessage::Changed { from_self: true, .. } | ServerMessage::Other => WsAction::Nothing,
                    ServerMessage::Reset { .. } => {
                        deferred.borrow_mut().push(Deferred::Message(text));
                        WsAction::Sync { force_all: true }
                    }
                    _ => {
                        deferred.borrow_mut().push(Deferred::Message(text));
                        WsAction::Sync { force_all: false }
                    }
                };
                return Ok(to_js(&action_json(action)));
            };
            let result = client.handle_server_message(&text).await;
            give_back(&cell, &deferred, client).await;
            result.map(|a| to_js(&action_json(a))).map_err(sync_err)
        })
    }

    /// Nach jedem lokalen Event: `true`, wenn ein Durchgang nötig ist.
    #[wasm_bindgen(js_name = noteLocalEvent)]
    pub fn note_local_event(&self, ev: JsValue) -> bool {
        let Ok(ev) = from_js(&ev) else { return false };
        if let Some(client) = self.client.borrow_mut().as_mut() {
            return client.note_local_event(&ev);
        }
        let uploadable = is_uploadable(&self.store, &ev);
        if uploadable {
            self.deferred.borrow_mut().push(Deferred::Local(ev));
        }
        uploadable
    }

    /// Der laufende Durchgang endet an der nächsten Etappe (Fehler mit `code: "stopped"`).
    pub fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
    }

    /// `{ lastSyncedSeq, lastUploadedSeq, generation, usage }` – während eines Durchgangs `null`.
    pub fn state(&self) -> JsValue {
        match self.client.borrow().as_ref() {
            Some(c) => {
                let mut v = state_json(c.state());
                v["usage"] = usage_json(c.usage());
                to_js(&v)
            }
            None => JsValue::NULL,
        }
    }

    #[wasm_bindgen(getter, js_name = wsUrl)]
    pub fn ws_url(&self) -> String {
        self.ws_url.clone()
    }

    #[wasm_bindgen(getter, js_name = wsAuthMessage)]
    pub fn ws_auth_message(&self) -> String {
        self.ws_auth.clone()
    }
}

/// Neuer Sync-Schlüssel (`impala-xxxx-…`).
#[wasm_bindgen(js_name = generateSyncKey)]
pub fn generate_sync_key() -> Result<String, JsError> {
    SyncKey::generate(&OsRandom).map(|k| k.as_str().to_owned()).map_err(|e| JsError::new(&e.to_string()))
}

/// `{ userId, authToken }` ohne PBKDF2 (KI-Anmeldung am Worker); wirft bei ungültigem Schlüssel.
#[wasm_bindgen(js_name = syncAuth)]
pub fn sync_auth(sync_key: &str) -> Result<JsValue, JsError> {
    let key = SyncKey::parse(sync_key).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(to_js(&json!({ "userId": key.user_id(), "authToken": key.auth_token() })))
}

/// Speicheranzeige wie der Client sie meldet (für den Zustand vor dem ersten Abruf).
#[wasm_bindgen(js_name = formatStorageUsage)]
pub fn format_storage_usage(bytes: f64, limit: Option<f64>) -> JsValue {
    to_js(&usage_json(&impala_crypto::format_storage_usage(bytes, limit)))
}

/// Ist es Zeit für eine Cloud-Kompaktierung?
#[wasm_bindgen(js_name = shouldCompactCloud)]
pub fn should_compact(
    connected: bool,
    usage_percent: Option<f64>,
    last_compacted_at_ms: f64,
    now_ms: f64,
    bypass_cooldown: bool,
) -> bool {
    should_compact_cloud(connected, usage_percent, last_compacted_at_ms as u64, now_ms as u64, bypass_cooldown)
}

/// Wartezeit vor dem n-ten HTTP-Wiederholversuch.
#[wasm_bindgen(js_name = syncRetryDelayMs)]
pub fn sync_retry_delay_ms(attempt: u32) -> f64 {
    retry_delay_ms(attempt) as f64
}

/// Wartezeit vor dem n-ten WebSocket-Neuaufbau (Versuch ab 1, Zufall aus JS).
#[wasm_bindgen(js_name = reconnectDelayMs)]
pub fn sync_reconnect_delay_ms(attempt: u32) -> f64 {
    reconnect_delay_ms(attempt, 0.8 + js_sys::Math::random() * 0.4) as f64
}

#[wasm_bindgen(js_name = wsPingMessage)]
pub fn ws_ping_message() -> String {
    WS_PING_MESSAGE.to_owned()
}

#[wasm_bindgen(js_name = wsPingIntervalMs)]
pub fn ws_ping_interval_ms() -> f64 {
    WS_PING_INTERVAL_MS as f64
}
