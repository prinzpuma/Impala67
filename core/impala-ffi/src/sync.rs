//! Cloudflare-Sync für native Apps. Der ganze Ablauf (`SyncClient` aus impala-sync) läuft auf einem
//! eigenen Thread je Konto; die Plattform ruft blockierend aus einem Hintergrund-Thread
//! (`sync`, `handle_server_message` …) und hält nur WebSocket, Timer und Anzeige.
//! Fremd-Events gehen wie in der PWA (`importAll` mit `STATE.importConflicts`) durch die
//! Konflikt-Prüfung des Kerns, werden gespeichert und sofort im Zustand angewandt.

use std::collections::{BTreeMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use impala_crypto::{OsRandom, StorageUsage, SyncCredentials, SyncKey, format_storage_usage};
use impala_model::LogEvent;
use impala_model::conflict::{self, Conflict, ImportContext, Merged};
use impala_net::{HttpClient, UreqClient, block_on};
use impala_storage::{Blob, ImportOptions, Storage, StorageExt, Write};
use impala_sync::api::{ServerMessage, WS_PING_INTERVAL_MS, WS_PING_MESSAGE, parse_server_message};
use impala_sync::{
    CompactReport, DEFAULT_WORKER_URL, Endpoint, LocalBlob, PassReport, StoreError, SyncClient, SyncError, SyncState,
    SyncStore, WsAction,
};
use serde_json::{Map, Value, json};

use crate::{ImpalaCore, Inner, Shared};

// ---------------------------------------------------------------------------
// Typen an der Grenze

/// Rückrufe der App. Werden vom Sync-Thread aufgerufen: schnell zurückkehren.
#[uniffi::export(with_foreign)]
pub trait SyncListener: Send + Sync {
    /// Fortschritt eines Durchgangs (`label`: Etappe, z. B. Abrufen/Senden/Dateien).
    fn on_progress(&self, label: String, current: u64, total: u64);
    /// Eine lokale Änderung wartet auf den Upload: Durchgang anstoßen (entprellt).
    fn on_sync_needed(&self);
}

#[derive(Debug, uniffi::Error)]
pub enum SyncFailure {
    /// Ungültiger Sync-Schlüssel.
    InvalidKey { message: String },
    /// Mit `stop()` abgebrochen.
    Stopped,
    /// `retryable`: nach `sync_retry_delay_ms` erneut versuchen; `quota`: Cloud-Speicher voll.
    Failed { message: String, status: Option<u16>, retryable: bool, quota: bool },
}

impl std::fmt::Display for SyncFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            SyncFailure::InvalidKey { message } | SyncFailure::Failed { message, .. } => f.write_str(message),
            SyncFailure::Stopped => f.write_str("Sync abgebrochen."),
        }
    }
}

impl std::error::Error for SyncFailure {}

impl From<SyncError> for SyncFailure {
    fn from(e: SyncError) -> Self {
        if e == SyncError::Stopped {
            return SyncFailure::Stopped;
        }
        SyncFailure::Failed {
            message: e.to_string(),
            status: e.status(),
            retryable: e.is_retryable(),
            quota: e.is_quota(),
        }
    }
}

fn gone() -> SyncFailure {
    SyncFailure::Failed { message: "Sync-Thread beendet.".into(), status: None, retryable: false, quota: false }
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct SyncReport {
    /// Abgerufene Fremd-Events.
    pub received: u64,
    /// Hochgeladene eigene Events.
    pub sent: u64,
    /// Der Server hat den Upload lückenlos bestätigt.
    pub confirmed: bool,
    pub files_uploaded: u64,
    pub files_downloaded: u64,
    /// Dateien über der Größengrenze (Namen), nicht hochgeladen.
    pub oversized_files: Vec<String>,
    /// Konflikte (Konfliktkopien angelegt) beim Übernehmen.
    pub conflicts: u64,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct SyncStatus {
    pub last_synced_seq: u64,
    pub last_uploaded_seq: u64,
    pub generation: u64,
    /// Belegter Cloud-Speicher in Prozent (0, solange unbekannt).
    pub usage_percent: f64,
    /// Lesbar, z. B. „12,3 MB von 1 GB“.
    pub usage_text: String,
}

#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum ServerAction {
    Nothing,
    /// Durchgang starten (`force_all`: nach einem Generationsschnitt alles neu senden).
    Sync {
        force_all: bool,
    },
    /// Server weist ab: Meldung zeigen, Verbindung schließen.
    Rejected {
        message: String,
    },
}

impl From<WsAction> for ServerAction {
    fn from(a: WsAction) -> Self {
        match a {
            WsAction::Nothing => ServerAction::Nothing,
            WsAction::Sync { force_all } => ServerAction::Sync { force_all },
            WsAction::Rejected(message) => ServerAction::Rejected { message },
        }
    }
}

fn report(pass: &PassReport, conflicts: usize) -> SyncReport {
    let blobs = pass.blobs.as_ref();
    SyncReport {
        received: pass.received as u64,
        sent: if pass.push.uploaded { pass.push.events as u64 } else { 0 },
        confirmed: pass.push.confirmed,
        files_uploaded: blobs.map_or(0, |b| b.uploaded as u64),
        files_downloaded: blobs.map_or(0, |b| b.downloaded as u64),
        oversized_files: blobs.map(|b| b.oversized.clone()).unwrap_or_default(),
        conflicts: conflicts as u64,
    }
}

fn status(state: &SyncState, usage: &StorageUsage) -> SyncStatus {
    SyncStatus {
        last_synced_seq: state.last_synced_seq,
        last_uploaded_seq: state.last_uploaded_seq,
        generation: state.generation,
        usage_percent: usage.percent,
        usage_text: usage.formatted.clone(),
    }
}

// ---------------------------------------------------------------------------
// Fremd-Events übernehmen (gemeinsam für alle Transporte)

/// `settings.syncSecrets !== false`.
pub(crate) fn allow_secrets(inner: &Inner) -> bool {
    inner.model.state().settings.get("syncSecrets") != Some(Value::Bool(false))
}

/// Ergebnis von [`Inner::import_remote`].
#[derive(Debug, Default)]
pub(crate) struct RemoteImport {
    /// Neu geschriebene Events (ohne `seq`).
    pub imported: Vec<Value>,
    pub conflicts: Vec<Conflict>,
    pub merged: Vec<Merged>,
}

impl Inner {
    /// Wie `DB.importAll` mit Konflikt-Prüfung, danach `applyRemoteEvents`. `payload` hat das
    /// `exportAll`-Format (`events`, optional `blobs`); `allow_secrets` aus der Einstellung
    /// `syncSecrets`. Gemeinsam für alle Transporte (Cloudflare, Drive).
    ///
    /// Abweichung von der PWA: Kollidiert ein verspätetes Fremd-Event mit neueren Events (z. B. eine
    /// ältere fremde Änderung derselben Seite nach einer neueren eigenen), überschrieb es dort den
    /// neueren Stand bis zum nächsten Start. Hier wird der Zustand dann gleich sortiert neu geladen.
    pub(crate) fn import_remote(
        &mut self,
        payload: &Value,
        unsynced_after_seq: u64,
        source: &str,
        allow_secrets: bool,
    ) -> Result<RemoteImport, crate::CoreError> {
        let opts = ImportOptions { remote: Some(source.to_owned()), deny_secrets: !allow_secrets };
        let Inner { storage, model, clock, .. } = self;
        let mut prepared = storage.prepare_import(payload, &opts)?;
        let has_blobs = payload.get("blobs").and_then(Value::as_object).is_some_and(|b| !b.is_empty());
        if prepared.fresh.is_empty() && !has_blobs {
            return Ok(RemoteImport::default());
        }
        // Uhr vor den abgeleiteten Events nachziehen (Merge/Konfliktkopien müssen später datiert sein).
        for t in prepared.fresh.iter().filter_map(|ev| ev.get("t").and_then(Value::as_str)) {
            clock.observe(t);
        }
        let local = storage.events_after(unsynced_after_seq, None, None)?;
        let fresh_ids: HashSet<String> =
            prepared.fresh.iter().filter_map(|ev| ev.get("id").and_then(impala_storage::event::id_key)).collect();
        let found = {
            let storage: &dyn Storage = &*storage;
            let known = |id: &str| {
                fresh_ids.contains(id) || storage.known_ids(&[id.to_owned()]).is_ok_and(|ids| !ids.is_empty())
            };
            let mut history = || storage.events_after(0, None, None).unwrap_or_default();
            let state = model.state();
            let page_info = |id: &str| state.page_info(id);
            let mut now = || clock.now();
            conflict::detect_import_conflicts(
                &mut prepared.fresh,
                ImportContext {
                    local: &local,
                    unsynced_after_seq,
                    known: &known,
                    history: &mut history,
                    page_info: &page_info,
                    now: &mut now,
                },
            )
        };
        let imported = storage.commit_import(prepared)?.imported;
        self.apply_remote(imported.iter().filter_map(LogEvent::from_object).collect());
        if !self.model.replay_ordered() {
            self.reload()?;
            self.note_everything(true);
        }
        // Die Events sind übernommen; scheitert nur das Vormerken, findet `conflicts()` die
        // Konfliktkopien trotzdem (als gerettete Alt-Kopien).
        let _ = self.remember_conflicts(found.conflicts.clone());
        Ok(RemoteImport {
            imported: imported.into_iter().map(Value::Object).collect(),
            conflicts: found.conflicts,
            merged: found.merged,
        })
    }
}

// ---------------------------------------------------------------------------
// Ablage über den gemeinsamen Kern

struct NativeStore {
    core: Shared,
    /// Präfix der Meta-Schlüssel (je Konto).
    prefix: String,
    /// Konflikte seit dem letzten Bericht.
    conflicts: usize,
}

fn store_err(e: impl std::fmt::Display) -> StoreError {
    StoreError(e.to_string())
}

impl NativeStore {
    fn key(&self, k: &str) -> String {
        format!("{}{k}", self.prefix)
    }
}

impl SyncStore for NativeStore {
    async fn load_state(&self) -> SyncState {
        let inner = crate::lock(&self.core);
        let get = |k: &str| inner.storage.meta(&self.key(k)).ok().flatten();
        let num = |k: &str| get(k).and_then(|v| v.parse().ok()).unwrap_or(0);
        SyncState {
            last_synced_seq: num("recv"),
            last_uploaded_seq: num("send"),
            generation: num("gen"),
            // Beschädigt: leer, die Blobs werden einmal neu geprüft.
            ignored_blobs: get("ignored")
                .and_then(|v| serde_json::from_str::<BTreeMap<String, String>>(&v).ok())
                .unwrap_or_default(),
        }
    }

    async fn save_state(&mut self, s: &SyncState) -> Result<(), StoreError> {
        let ignored = (!s.ignored_blobs.is_empty()).then(|| json!(s.ignored_blobs).to_string());
        let writes = vec![
            Write::SetMeta(self.key("recv"), Some(s.last_synced_seq.to_string())),
            Write::SetMeta(self.key("send"), Some(s.last_uploaded_seq.to_string())),
            Write::SetMeta(self.key("gen"), Some(s.generation.to_string())),
            Write::SetMeta(self.key("ignored"), ignored),
        ];
        crate::lock(&self.core).storage.apply(writes).map(drop).map_err(store_err)
    }

    async fn max_seq(&self) -> Result<u64, StoreError> {
        crate::lock(&self.core).storage.log_info().map(|i| i.max_seq).map_err(store_err)
    }

    async fn events_after(&self, after_seq: u64, up_to_seq: u64) -> Result<Vec<Value>, StoreError> {
        let up_to = (up_to_seq != u64::MAX).then_some(up_to_seq);
        let events = crate::lock(&self.core).storage.events_after(after_seq, up_to, None).map_err(store_err)?;
        Ok(events.into_iter().map(Value::Object).collect())
    }

    fn filter_for_upload(&self, events: Vec<Value>) -> Vec<Value> {
        if allow_secrets(&crate::lock(&self.core)) {
            return events;
        }
        events
            .into_iter()
            .filter_map(|ev| match ev {
                Value::Object(o) => impala_storage::event::redact_secrets(o).map(Value::Object),
                other => Some(other),
            })
            .collect()
    }

    async fn import_remote(&mut self, events: Vec<Value>, unsynced_after_seq: u64) -> Result<(), StoreError> {
        let payload = json!({ "app": "impala67", "events": events });
        let found = {
            let mut inner = crate::lock(&self.core);
            let allow = allow_secrets(&inner);
            inner.import_remote(&payload, unsynced_after_seq, "cloudflare", allow)
        };
        crate::changes::notify(&self.core);
        self.conflicts += found.map_err(store_err)?.conflicts.len();
        Ok(())
    }

    fn pages(&self) -> Map<String, Value> {
        match serde_json::to_value(&crate::lock(&self.core).model.state().pages) {
            Ok(Value::Object(m)) => m,
            _ => Map::new(),
        }
    }

    async fn blob_ids(&self) -> Result<Vec<String>, StoreError> {
        crate::lock(&self.core).storage.blob_keys().map_err(store_err)
    }

    async fn get_blob(&self, id: &str) -> Result<Option<LocalBlob>, StoreError> {
        let blob = crate::lock(&self.core).storage.blob(id).map_err(store_err)?;
        Ok(blob.map(|b| LocalBlob { meta: b.meta.unwrap_or_else(|| json!({})), data: b.bytes }))
    }

    async fn put_blob(&mut self, id: &str, blob: LocalBlob) -> Result<(), StoreError> {
        let write = Write::PutBlob(id.to_owned(), Blob { bytes: blob.data, meta: Some(blob.meta) });
        crate::lock(&self.core).storage.apply(vec![write]).map(drop).map_err(store_err)
    }
}

// ---------------------------------------------------------------------------
// Sync-Thread

type Reply<T> = Sender<Result<T, SyncError>>;

pub(crate) enum Cmd {
    Sync(bool, Reply<PassReport>),
    Compact(bool, Reply<CompactReport>),
    Reset(Reply<()>),
    /// WebSocket-Nachricht; ohne Antwortkanal nur den Zustand nachziehen.
    Message(String, Option<Reply<WsAction>>),
    /// Ein gerade gespeichertes lokales Event.
    Local(Value),
}

/// Was der Thread nach jedem Schritt veröffentlicht.
struct Published {
    busy: AtomicBool,
    status: Mutex<SyncStatus>,
    conflicts: Mutex<usize>,
}

fn run<H: HttpClient>(
    mut client: SyncClient<H, NativeStore>,
    rx: Receiver<Cmd>,
    out: Arc<Published>,
    listener: Option<Arc<dyn SyncListener>>,
) {
    let publish = |client: &mut SyncClient<H, NativeStore>| {
        *out.status.lock().unwrap_or_else(|e| e.into_inner()) = status(client.state(), client.usage());
        *out.conflicts.lock().unwrap_or_else(|e| e.into_inner()) = std::mem::take(&mut client.store_mut().conflicts);
    };
    // Ein Durchgang zur Zeit; `stop()` gilt nur für den laufenden.
    let stop = client.stop_flag();
    for cmd in rx {
        match cmd {
            Cmd::Sync(force_all, reply) => {
                stop.store(false, Ordering::Relaxed);
                let r = block_on(client.sync(force_all));
                publish(&mut client);
                out.busy.store(false, Ordering::Release);
                let _ = reply.send(r);
            }
            Cmd::Compact(bypass, reply) => {
                stop.store(false, Ordering::Relaxed);
                let r = block_on(client.compact_cloud(bypass));
                publish(&mut client);
                out.busy.store(false, Ordering::Release);
                let _ = reply.send(r);
            }
            Cmd::Reset(reply) => {
                stop.store(false, Ordering::Relaxed);
                let r = block_on(client.reset_cloud());
                publish(&mut client);
                out.busy.store(false, Ordering::Release);
                let _ = reply.send(r);
            }
            Cmd::Message(text, reply) => {
                let r = block_on(client.handle_server_message(&text));
                publish(&mut client);
                if let Some(reply) = reply {
                    let _ = reply.send(r);
                }
            }
            Cmd::Local(ev) => {
                if client.note_local_event(&ev)
                    && let Some(l) = &listener
                {
                    l.on_sync_needed();
                }
            }
        }
    }
}

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

/// Cloudflare-Sync eines Kontos. Neue Zugangsdaten = neues Objekt. Alle Methoden blockieren
/// bis zum Ergebnis: aus einem Hintergrund-Thread rufen.
#[derive(uniffi::Object)]
pub struct CloudSync {
    id: u64,
    core: Shared,
    tx: Sender<Cmd>,
    out: Arc<Published>,
    stop: Arc<AtomicBool>,
    client_id: String,
    ws_url: String,
    ws_auth: String,
}

impl CloudSync {
    pub(crate) fn start<H: HttpClient + Send + 'static>(
        core: &Arc<ImpalaCore>,
        http: H,
        creds: SyncCredentials,
        base_url: &str,
        listener: Option<Arc<dyn SyncListener>>,
    ) -> Arc<CloudSync> {
        let shared = core.shared();
        let client_id = crate::lock(&shared).device_id();
        let endpoint = Endpoint::new(base_url, &creds, &client_id);
        let store =
            NativeStore { core: shared.clone(), prefix: format!("cloudflare:{}:", creds.user_id), conflicts: 0 };
        let out = Arc::new(Published {
            busy: AtomicBool::new(false),
            status: Mutex::new(status(&block_on(store.load_state()), &format_storage_usage(0.0, None))),
            conflicts: Mutex::new(0),
        });
        let (tx, rx) = mpsc::channel();
        let (stop_tx, stop_rx) = mpsc::channel();
        // Der Client ist nicht `Send` (Fortschritts-Rückruf, Zufallsquelle): Er entsteht im Thread und bleibt dort.
        let (thread_out, base_url, thread_id) = (out.clone(), base_url.to_owned(), client_id.clone());
        thread::Builder::new()
            .name("impala-sync".into())
            .spawn(move || {
                let mut client = block_on(SyncClient::new(http, store, &base_url, &creds, &thread_id));
                if let Some(l) = listener.clone() {
                    client.on_progress(move |p| l.on_progress(p.label.to_owned(), p.current, p.total));
                }
                let _ = stop_tx.send(client.stop_flag());
                run(client, rx, thread_out, listener)
            })
            .expect("Sync-Thread");
        let stop = stop_rx.recv().unwrap_or_default();
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        crate::lock(&shared).sync_tx = Some((id, tx.clone()));
        Arc::new(CloudSync {
            id,
            core: shared,
            tx,
            out,
            stop,
            client_id,
            ws_url: endpoint.ws_url(),
            ws_auth: endpoint.ws_auth_message(),
        })
    }

    fn call<T>(&self, cmd: impl FnOnce(Reply<T>) -> Cmd) -> Result<T, SyncFailure> {
        let (reply, rx) = mpsc::channel();
        self.tx.send(cmd(reply)).map_err(|_| gone())?;
        Ok(rx.recv().map_err(|_| gone())??)
    }

    fn pass<T>(&self, cmd: impl FnOnce(Reply<T>) -> Cmd) -> Result<T, SyncFailure> {
        self.out.busy.store(true, Ordering::Release);
        let r = self.call(cmd);
        if r.is_err() {
            self.out.busy.store(false, Ordering::Release);
        }
        r
    }

    fn take_conflicts(&self) -> usize {
        std::mem::take(&mut *self.out.conflicts.lock().unwrap_or_else(|e| e.into_inner()))
    }
}

impl Drop for CloudSync {
    fn drop(&mut self) {
        let mut inner = crate::lock(&self.core);
        if inner.sync_tx.as_ref().is_some_and(|(id, _)| *id == self.id) {
            inner.sync_tx = None;
        }
    }
}

#[uniffi::export]
impl CloudSync {
    /// Verbindet `core` mit einem Konto. Leitet den Schlüssel ab (PBKDF2, ~0,1–1 s): im Hintergrund
    /// rufen. `worker_url`: eigener Worker, sonst der Standard.
    #[uniffi::constructor]
    pub fn new(
        core: Arc<ImpalaCore>,
        sync_key: String,
        worker_url: Option<String>,
        listener: Option<Arc<dyn SyncListener>>,
    ) -> Result<Arc<Self>, SyncFailure> {
        let key = SyncKey::parse(&sync_key).map_err(|e| SyncFailure::InvalidKey { message: e.to_string() })?;
        let url = worker_url.filter(|u| !u.trim().is_empty()).unwrap_or_else(|| DEFAULT_WORKER_URL.to_owned());
        Ok(CloudSync::start(&core, UreqClient::default(), key.derive(), &url, listener))
    }

    /// Ein Durchgang: abrufen → Dateien → senden. Volle Quota verdichtet die Cloud einmal.
    pub fn sync(&self, force_all: bool) -> Result<SyncReport, SyncFailure> {
        let pass = self.pass(|r| Cmd::Sync(force_all, r))?;
        Ok(report(&pass, self.take_conflicts()))
    }

    /// Cloud-Speicher verdichten (`bypass_cooldown`: auch kurz nach der letzten Verdichtung).
    pub fn compact_cloud(&self, bypass_cooldown: bool) -> Result<SyncReport, SyncFailure> {
        let r = self.pass(|r| Cmd::Compact(bypass_cooldown, r))?;
        Ok(report(&r.pass, self.take_conflicts()))
    }

    /// Löscht alle Pakete und Dateien auf dem Server (neue Generation); danach `sync(true)`.
    pub fn reset_cloud(&self) -> Result<(), SyncFailure> {
        self.pass(Cmd::Reset)
    }

    /// WebSocket-Nachricht auswerten. Läuft gerade ein Durchgang, kommt die Antwort sofort und
    /// der Zustand wird danach nachgezogen.
    pub fn handle_server_message(&self, text: String) -> Result<ServerAction, SyncFailure> {
        if !self.out.busy.load(Ordering::Acquire) {
            return Ok(self.call(|r| Cmd::Message(text, Some(r)))?.into());
        }
        let action = match parse_server_message(&text, &self.client_id)? {
            ServerMessage::Rejected(message) => ServerAction::Rejected { message },
            ServerMessage::Changed { from_self: true, .. } | ServerMessage::Other => ServerAction::Nothing,
            ServerMessage::Reset { .. } => ServerAction::Sync { force_all: true },
            _ => ServerAction::Sync { force_all: false },
        };
        if action != ServerAction::Nothing {
            self.tx.send(Cmd::Message(text, None)).map_err(|_| gone())?;
        }
        Ok(action)
    }

    /// Bricht den laufenden Durchgang an der nächsten Etappe ab (`SyncFailure::Stopped`).
    pub fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
    }

    pub fn status(&self) -> SyncStatus {
        self.out.status.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// WebSocket-Adresse (`wss://…/ws?…`).
    pub fn ws_url(&self) -> String {
        self.ws_url.clone()
    }

    /// Erste Nachricht nach dem Verbinden.
    pub fn ws_auth_message(&self) -> String {
        self.ws_auth.clone()
    }
}

/// Neuer Sync-Schlüssel (`impala-xxxx-…`).
#[uniffi::export]
pub fn generate_sync_key() -> Result<String, SyncFailure> {
    SyncKey::generate(&OsRandom)
        .map(|k| k.as_str().to_owned())
        .map_err(|e| SyncFailure::InvalidKey { message: e.to_string() })
}

/// Wartezeit vor dem n-ten Wiederholversuch nach einem `retryable`-Fehler.
#[uniffi::export]
pub fn sync_retry_delay_ms(attempt: u32) -> u64 {
    impala_sync::retry_delay_ms(attempt)
}

/// Wartezeit vor dem n-ten WebSocket-Neuaufbau (ab 1, mit Streuung).
#[uniffi::export]
pub fn sync_reconnect_delay_ms(attempt: u32) -> u64 {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.subsec_nanos());
    impala_sync::reconnect_delay_ms(attempt, 0.8 + f64::from(nanos % 400) / 1000.0)
}

#[uniffi::export]
pub fn ws_ping_message() -> String {
    WS_PING_MESSAGE.to_owned()
}

#[uniffi::export]
pub fn ws_ping_interval_ms() -> u64 {
    WS_PING_INTERVAL_MS
}

/// Speicheranzeige vor dem ersten Abruf.
#[uniffi::export]
pub fn format_sync_usage(bytes: f64) -> String {
    format_storage_usage(bytes, None).formatted
}

#[cfg(test)]
mod tests {
    use super::*;
    use impala_net::{Method, NetError, Request, Response};
    use std::sync::atomic::AtomicUsize;

    /// Nachgebauter Worker (Pfade und Felder wie `server/worker.js`, ohne Dateien und Quota).
    #[derive(Default)]
    struct Worker {
        packets: Vec<Value>,
    }

    #[derive(Clone, Default)]
    struct Net(Arc<Mutex<Worker>>);

    fn reply(status: u16, body: Value) -> Response {
        Response { status, headers: vec![], body: body.to_string().into_bytes() }
    }

    fn query(url: &str, key: &str) -> Option<String> {
        url.split_once('?')?.1.split('&').find_map(|kv| kv.strip_prefix(&format!("{key}=")).map(str::to_owned))
    }

    impl HttpClient for Net {
        async fn send(&self, req: &Request) -> Result<Response, NetError> {
            let mut w = self.0.lock().unwrap();
            let path = req.url.split_once("://").unwrap().1;
            let route = path[path.find('/').unwrap()..].split('?').next().unwrap().to_owned();
            Ok(match (req.method, route.as_str()) {
                (Method::Get, "/api/sync") => {
                    let since: usize = query(&req.url, "since").unwrap().parse().unwrap();
                    let limit: usize = query(&req.url, "limit").unwrap().parse().unwrap();
                    let page: Vec<Value> = w.packets.iter().skip(since).take(limit).cloned().collect();
                    let more = page.len() == limit;
                    reply(200, json!({"events": page, "maxSeq": w.packets.len(), "hasMore": more, "generation": 1}))
                }
                (Method::Post, "/api/events") => {
                    let body: Value = serde_json::from_slice(&req.body).unwrap();
                    let from = w.packets.len();
                    let known: HashSet<String> = w.packets.iter().map(|p| p["id"].to_string()).collect();
                    for p in body["events"].as_array().unwrap() {
                        if !known.contains(&p["id"].to_string()) {
                            let mut p = p.clone();
                            p["seq"] = json!(w.packets.len() + 1);
                            w.packets.push(p);
                        }
                    }
                    let (to, saved) = (w.packets.len(), w.packets.len() - from);
                    reply(
                        200,
                        json!({"ok": true, "savedCount": saved, "ack": {"fromSeq": from, "toSeq": to, "savedCount": saved},
                        "generation": 1}),
                    )
                }
                (Method::Get, "/api/blobs") => reply(200, json!({"keys": [], "cursor": ""})),
                _ => reply(404, json!({"error": "Endpunkt nicht gefunden."})),
            })
        }
    }

    #[derive(Default)]
    struct Counter {
        needed: AtomicUsize,
    }

    impl SyncListener for Counter {
        fn on_progress(&self, _: String, _: u64, _: u64) {}
        fn on_sync_needed(&self) {
            self.needed.fetch_add(1, Ordering::Relaxed);
        }
    }

    fn device(net: &Net) -> (Arc<ImpalaCore>, Arc<CloudSync>, Arc<Counter>) {
        static CREDS: std::sync::OnceLock<SyncCredentials> = std::sync::OnceLock::new();
        let creds = CREDS
            .get_or_init(|| SyncKey::parse("impala-0123-4567-89ab-cdef-0011-2233-4455-6677").unwrap().derive())
            .clone();
        let core = ImpalaCore::open_in_memory().unwrap();
        let counter = Arc::new(Counter::default());
        let sync = CloudSync::start(&core, net.clone(), creds, "https://worker.test/", Some(counter.clone()));
        (core, sync, counter)
    }

    fn titles(core: &ImpalaCore) -> Vec<String> {
        let mut t: Vec<String> = core.children_of(None, None).into_iter().map(|p| p.title).collect();
        t.sort();
        t
    }

    #[test]
    fn zwei_geraete_gleichen_sich_ab() {
        let net = Net::default();
        let (a, sa, ca) = device(&net);
        let (b, sb, _) = device(&net);
        let pa = a.create_page("Von A".into(), "Inhalt A".into(), None, None).unwrap();
        b.create_page("Von B".into(), "Inhalt B".into(), None, None).unwrap();

        let ra = sa.sync(false).unwrap();
        assert!(ra.sent > 0 && ra.confirmed);
        let rb = sb.sync(false).unwrap();
        assert!(rb.received > 0 && rb.sent > 0);
        sa.sync(false).unwrap();
        assert_eq!(titles(&a), ["Von A", "Von B"]);
        assert_eq!(titles(&b), titles(&a));
        assert_eq!(b.page(pa.clone()).unwrap().content, "Inhalt A");
        // Lokale Änderungen melden „Sync nötig“ (der Thread arbeitet asynchron).
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while ca.needed.load(Ordering::Relaxed) == 0 && std::time::Instant::now() < deadline {
            thread::sleep(std::time::Duration::from_millis(5));
        }
        assert!(ca.needed.load(Ordering::Relaxed) > 0);
        assert!(sb.status().last_synced_seq > 0);

        // Gleichzeitige Änderung derselben Seite: Inhalte werden zusammengeführt oder als Konflikt gemeldet,
        // beide Geräte landen beim selben Stand.
        a.update_page(pa.clone(), Some("Titel A".into()), Some("Zeile 1\nA".into())).unwrap();
        // Gleiche Millisekunde auf zwei Geräten entschiede der Replay per lokaler `seq` (je Gerät anders).
        thread::sleep(std::time::Duration::from_millis(5));
        b.update_page(pa.clone(), Some("Titel B".into()), Some("Zeile 1\nB".into())).unwrap();
        sa.sync(false).unwrap();
        let rb = sb.sync(false).unwrap();
        sa.sync(false).unwrap();
        sb.sync(false).unwrap();
        assert_eq!(titles(&a), titles(&b));
        assert_eq!(a.page(pa.clone()).unwrap().content, b.page(pa.clone()).unwrap().content);
        assert!(rb.conflicts > 0 || titles(&a).len() > 2, "Konflikt nicht erkannt: {:?}", titles(&a));
    }

    #[test]
    fn ungueltiger_schluessel() {
        let core = ImpalaCore::open_in_memory().unwrap();
        assert!(matches!(CloudSync::new(core, "falsch".into(), None, None), Err(SyncFailure::InvalidKey { .. })));
        assert!(generate_sync_key().unwrap().starts_with("impala-"));
    }
}
