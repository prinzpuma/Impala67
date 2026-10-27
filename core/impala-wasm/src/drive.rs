//! Google-Drive-Backup für die PWA: der ganze Durchgang in Rust (`impala-drive`), Ein-/Ausgabe
//! im Browser. JS reicht zwei Objekte herein: `http.send(request)` (fetch) und `io` (Token,
//! localStorage, IndexedDB, Warten, Uhr-Korrektur, siehe web/drive.js). Anmeldung, Timer,
//! Web Lock und Statusanzeige bleiben in JS.

use std::cell::RefCell;
use std::rc::Rc;

use impala_drive::{
    Clock, DriveBackup, DriveError, DriveOptions, DriveState, DriveStore, ImportOutcome, LocalBlob, StoreError,
    SyncReport, TokenSource,
};
use js_sys::{Function, Object, Promise, Uint8Array};
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

use crate::js::{JsHttp, bytes, call, call_sync, from_js, get, seq, set, to_js};

type Backup = DriveBackup<JsHttp, JsIo, JsIo, JsIo>;

/// Plattform-Objekt `io`; dient zugleich als Token-Quelle, Ablage und Uhr.
#[derive(Clone)]
pub struct JsIo(JsValue);

fn store_err(m: String) -> StoreError {
    StoreError(m)
}

fn list(v: &JsValue) -> Vec<Value> {
    match from_js(v) {
        Ok(Value::Array(items)) => items,
        _ => Vec::new(),
    }
}

impl TokenSource for JsIo {
    async fn access_token(&self) -> Option<String> {
        call(&self.0, "accessToken", &[]).await.ok().and_then(|v| v.as_string())
    }

    async fn expired(&self) {
        let _ = call(&self.0, "tokenExpired", &[]).await;
    }
}

impl Clock for JsIo {
    fn now_ms(&self) -> f64 {
        js_sys::Date::now()
    }

    async fn sleep_ms(&self, ms: u64) {
        let _ = call(&self.0, "sleep", &[(ms as f64).into()]).await;
    }

    fn set_offset_ms(&self, offset_ms: f64) {
        let _ = call_sync(&self.0, "setClockOffset", &[offset_ms.into()]);
    }
}

impl DriveStore for JsIo {
    // Zustand: dieselben localStorage-Einträge wie die frühere JS-Fassung (impala_drive::state).
    async fn load_state(&self) -> Result<DriveState, StoreError> {
        Ok(DriveState::from_kv(|k| call_sync(&self.0, "getItem", &[k.into()]).ok().and_then(|v| v.as_string())))
    }

    async fn save_state(&mut self, state: &DriveState) -> Result<(), StoreError> {
        for (k, v) in state.to_kv() {
            let v = v.map_or(JsValue::NULL, JsValue::from);
            call_sync(&self.0, "setItem", &[k.into(), v]).map_err(store_err)?;
        }
        Ok(())
    }

    async fn max_seq(&self) -> Result<u64, StoreError> {
        call(&self.0, "maxSeq", &[]).await.map(|v| seq(&v)).map_err(store_err)
    }

    async fn events_between(&self, after: u64, up_to: u64) -> Result<Vec<Value>, StoreError> {
        let v =
            call(&self.0, "eventsBetween", &[(after as f64).into(), (up_to as f64).into()]).await.map_err(store_err)?;
        Ok(list(&v))
    }

    async fn import(
        &mut self,
        payload: Value,
        unsynced_after_seq: u64,
        allow_secrets: bool,
    ) -> Result<ImportOutcome, StoreError> {
        let args = [to_js(&payload), (unsynced_after_seq as f64).into(), allow_secrets.into()];
        let v = call(&self.0, "importAll", &args).await.map_err(store_err)?;
        // Die neuen Events spielt JS selbst ein; sie müssen nicht noch einmal über die Grenze.
        Ok(ImportOutcome {
            added: seq(&get(&v, "added")) as usize,
            conflicts: list(&get(&v, "conflicts")),
            merged: list(&get(&v, "merged")),
            imported: Vec::new(),
        })
    }

    async fn export_snapshot(&self, redact_secrets: bool, _exported_at: &str) -> Result<String, StoreError> {
        let v = call(&self.0, "exportSnapshot", &[redact_secrets.into()]).await.map_err(store_err)?;
        v.as_string().ok_or_else(|| StoreError("Export lieferte keinen Text.".into()))
    }

    async fn blob_ids(&self) -> Result<Vec<String>, StoreError> {
        let v = call(&self.0, "blobIds", &[]).await.map_err(store_err)?;
        Ok(js_sys::Array::from(&v).iter().filter_map(|id| id.as_string()).collect())
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

/// JS-`Error` mit `status` (HTTP) und `code: "session-expired"` (Anzeige „Pausiert“).
fn drive_err(e: DriveError) -> JsValue {
    let err = js_sys::Error::new(&e.to_string());
    let obj: &Object = err.unchecked_ref();
    if let Some(status) = e.status() {
        set(obj, "status", status);
    }
    if e == DriveError::SessionExpired {
        set(obj, "code", "session-expired");
    }
    err.into()
}

fn report_json(r: &SyncReport) -> Value {
    json!({
        "imported": r.imported,
        "uploaded": r.uploaded,
        "conflicts": r.conflicts.len(),
        "conflictDetails": r.conflicts,
        "merged": r.merged.len(),
        "mergedDetails": r.merged,
        "blobsDownloaded": r.blobs_downloaded,
        "blobsUploaded": r.blobs_uploaded,
        "compacted": r.compacted,
        "label": r.label(),
        "clockWarningMinutes": r.clock_warning_minutes,
    })
}

/// Ein Gerät, ein Kern. Ein Durchgang zur Zeit (JS reiht alle Aufrufe ein).
#[wasm_bindgen]
pub struct DriveCore {
    backup: Rc<RefCell<Option<Backup>>>,
}

/// Nimmt den Kern für einen Durchgang heraus.
fn take(cell: &Rc<RefCell<Option<Backup>>>) -> Result<Backup, JsValue> {
    cell.borrow_mut().take().ok_or_else(|| js_sys::Error::new("Drive-Sync läuft bereits.").into())
}

/// Führt `run` mit dem herausgenommenen Kern aus und gibt ihn danach zurück.
fn with_backup<F, Fut>(cell: &Rc<RefCell<Option<Backup>>>, run: F) -> Promise
where
    F: FnOnce(Backup) -> Fut + 'static,
    Fut: std::future::Future<Output = (Backup, Result<JsValue, JsValue>)> + 'static,
{
    let cell = cell.clone();
    future_to_promise(async move {
        let backup = take(&cell)?;
        let (backup, result) = run(backup).await;
        *cell.borrow_mut() = Some(backup);
        result
    })
}

#[wasm_bindgen]
impl DriveCore {
    #[wasm_bindgen(constructor)]
    pub fn new(http: JsValue, io: JsValue) -> DriveCore {
        let io = JsIo(io);
        let backup = DriveBackup::new(JsHttp(http), io.clone(), io.clone(), io);
        DriveCore { backup: Rc::new(RefCell::new(Some(backup))) }
    }

    /// Voller Durchgang. `on_status(label)` meldet die Etappen (darf `undefined` sein).
    /// Ergebnis: `{ imported, uploaded, conflicts, conflictDetails, merged, mergedDetails, label, … }`.
    pub fn sync(&self, allow_secrets: bool, on_status: JsValue) -> Promise {
        with_backup(&self.backup, move |mut b| async move {
            b.set_options(DriveOptions { allow_secrets });
            let f = on_status.dyn_into::<Function>().ok();
            let mut on_phase = |p: impala_drive::Phase| {
                if let Some(f) = &f {
                    let _ = f.call1(&JsValue::NULL, &p.label().into());
                }
            };
            let result = b.sync(&mut on_phase).await.map(|r| to_js(&report_json(&r))).map_err(drive_err);
            (b, result)
        })
    }

    /// Kurzweg beim Schließen: nur das eigene Änderungspaket hochladen. Liefert die Zahl der Events.
    #[wasm_bindgen(js_name = flushUpload)]
    pub fn flush_upload(&self, allow_secrets: bool) -> Promise {
        with_backup(&self.backup, move |mut b| async move {
            b.set_options(DriveOptions { allow_secrets });
            let result = b.flush_upload().await.map(|n| JsValue::from(n as f64)).map_err(drive_err);
            (b, result)
        })
    }

    /// `{ appBytes, usedBytes, limitBytes }` oder `null` ohne gültiges Token.
    #[wasm_bindgen(js_name = storageInfo)]
    pub fn storage_info(&self) -> Promise {
        with_backup(&self.backup, |mut b| async move {
            let result = b
                .storage_info()
                .await
                .map(|info| match info {
                    Some(i) => to_js(&json!({
                        "appBytes": i.app_bytes, "usedBytes": i.used_bytes, "limitBytes": i.limit_bytes,
                    })),
                    None => JsValue::NULL,
                })
                .map_err(drive_err);
            (b, result)
        })
    }

    /// E-Mail des Kontos (nur Anzeige) oder `null`; wirft nur bei abgelehntem Token.
    #[wasm_bindgen(js_name = accountEmail)]
    pub fn account_email(&self) -> Promise {
        with_backup(&self.backup, |mut b| async move {
            let result = b.account_email().await.map(|e| e.map_or(JsValue::NULL, JsValue::from)).map_err(drive_err);
            (b, result)
        })
    }
}
