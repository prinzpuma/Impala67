//! Google-Drive-Backup für native Apps. Der ganze Ablauf (`DriveBackup` aus impala-drive) läuft
//! auf einem eigenen Thread je Objekt; die Plattform ruft blockierend aus einem Hintergrund-Thread
//! und besitzt nur Anmeldung (natives Google-SDK), Timer und Anzeige.
//! Fremd-Events gehen wie beim Cloudflare-Sync durch `Inner::import_remote` (Konflikt-Prüfung,
//! Quelle `"drive"`) und sind sofort im Zustand. Der Drive-Zustand liegt in den Meta-Einträgen
//! der Datenbank (Präfix `drive:`, sonst dieselben Schlüssel wie `localStorage` der PWA).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;

use impala_drive::policy::{self, ChangeStep, ChangeTimer, Gate, TimerStep};
use impala_drive::state::DriveState;
use impala_drive::status::{self, AuthState, BackupLevel, DriveAction, SyncUi, UiState};
use impala_drive::{
    Clock, DriveBackup, DriveError, DriveOptions, DriveStore, ImportOutcome, LocalBlob, Phase, StorageInfo, StoreError,
    SystemClock, TokenSource,
};
use impala_net::{HttpClient, NetError, Request, Response, UreqClient, block_on};
use impala_storage::{Blob, ExportOptions, Storage, StorageExt, Write};
use serde_json::Value;

use crate::sync::allow_secrets;
use crate::{CoreError, ImpalaCore, Inner, Shared};

/// Präfix der Drive-Einträge in den Meta-Einträgen der Datenbank.
const META_PREFIX: &str = "drive:";

// ---------------------------------------------------------------------------
// Typen an der Grenze

/// Anmeldung der App (natives Google-SDK). Wird vom Drive-Thread aufgerufen, blockierend:
/// ein Hintergrund-Sync öffnet nie ein Fenster, also nur zwischengespeicherte oder still
/// erneuerte Tokens liefern.
#[uniffi::export(with_foreign)]
pub trait DriveTokens: Send + Sync {
    /// Gültiges Zugriffstoken oder `None` (dann: `DriveFailure::SessionExpired`).
    fn access_token(&self) -> Option<String>;
    /// Drive hat `rejected` mit 401 abgelehnt: neues Token (still erneuert) oder `None`.
    fn renew_token(&self, rejected: String) -> Option<String>;
    /// Abgelehnt und nicht erneuerbar: Token verwerfen, Anzeige „Pausiert“.
    fn token_expired(&self);
}

/// Fortschritt eines Durchgangs. Wird vom Drive-Thread aufgerufen: schnell zurückkehren.
#[uniffi::export(with_foreign)]
pub trait DriveProgress: Send + Sync {
    /// Etappe als Text, z. B. „3 Änderungspaket(e) laden…“.
    fn on_progress(&self, label: String);
}

#[derive(Debug, uniffi::Error)]
pub enum DriveFailure {
    /// Kein gültiges Token und nicht erneuerbar: „Pausiert“ zeigen, beim nächsten bewussten
    /// Sync neu anmelden.
    SessionExpired,
    /// Mit `stop()` abgebrochen.
    Stopped,
    /// `offline`: keine Verbindung bzw. Zeitüberschreitung; `status`: HTTP-Status von Drive.
    Failed { message: String, status: Option<u16>, offline: bool },
}

impl std::fmt::Display for DriveFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            DriveFailure::SessionExpired => f.write_str(&DriveError::SessionExpired.to_string()),
            DriveFailure::Stopped => f.write_str("Drive-Sync abgebrochen."),
            DriveFailure::Failed { message, .. } => f.write_str(message),
        }
    }
}

impl std::error::Error for DriveFailure {}

impl From<DriveError> for DriveFailure {
    fn from(e: DriveError) -> Self {
        match e {
            DriveError::SessionExpired => DriveFailure::SessionExpired,
            DriveError::Net(NetError::Aborted) => DriveFailure::Stopped,
            DriveError::Net(_) => DriveFailure::Failed { message: e.to_string(), status: None, offline: true },
            other => DriveFailure::Failed { message: other.to_string(), status: other.status(), offline: false },
        }
    }
}

fn gone() -> DriveFailure {
    DriveFailure::Failed { message: "Drive-Thread beendet.".into(), status: None, offline: false }
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct DriveReport {
    /// Neu übernommene Events.
    pub imported: u64,
    /// Hochgeladene eigene Events.
    pub uploaded: u64,
    /// Konflikte (Konfliktkopien angelegt) beim Übernehmen.
    pub conflicts: u64,
    /// Automatisch zusammengeführte Seiten.
    pub merged: u64,
    pub files_downloaded: u64,
    pub files_uploaded: u64,
    /// Sync-Stand in Drive wurde zu einem Snapshot verdichtet.
    pub compacted: bool,
    /// Geräteuhr weicht so weit von Drive ab, dass gewarnt werden soll (Minuten).
    pub clock_warning_minutes: Option<u64>,
    /// „Synchronisiert“ oder „Aktuell“.
    pub label: String,
}

fn report(r: &impala_drive::SyncReport) -> DriveReport {
    DriveReport {
        imported: r.imported as u64,
        uploaded: r.uploaded as u64,
        conflicts: r.conflicts.len() as u64,
        merged: r.merged.len() as u64,
        files_downloaded: r.blobs_downloaded as u64,
        files_uploaded: r.blobs_uploaded as u64,
        compacted: r.compacted,
        clock_warning_minutes: r.clock_warning_minutes,
        label: r.label().to_owned(),
    }
}

/// Speicheranzeige (Bytes): Anteil des App-Ordners und Belegung des Google-Kontos.
#[derive(Debug, Clone, Copy, PartialEq, uniffi::Record)]
pub struct DriveStorage {
    pub app_bytes: f64,
    pub used_bytes: f64,
    pub limit_bytes: f64,
}

impl From<StorageInfo> for DriveStorage {
    fn from(i: StorageInfo) -> Self {
        DriveStorage { app_bytes: i.app_bytes, used_bytes: i.used_bytes, limit_bytes: i.limit_bytes }
    }
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct DriveStatus {
    /// ISO-Zeit des letzten erfolgreichen Syncs.
    pub last_ok: Option<String>,
    /// Höchste lokale `seq`, die in Drive liegt.
    pub uploaded_seq: u64,
    pub synced_seq: u64,
    /// Ein Durchgang läuft gerade.
    pub running: bool,
    /// Letzte Etappe des laufenden Durchgangs (sonst leer).
    pub progress: String,
}

// ---------------------------------------------------------------------------
// Ablage über den gemeinsamen Kern

/// [`DriveStore`] über den gemeinsamen Zustand. Anders als `StorageStore` mit eigenem Präfix für
/// den Drive-Zustand und mit der Konflikt-Prüfung des Kerns beim Import.
struct NativeDriveStore {
    core: Shared,
}

fn store_err(e: impl std::fmt::Display) -> StoreError {
    StoreError(e.to_string())
}

fn meta_key(k: &str) -> String {
    format!("{META_PREFIX}{k}")
}

fn read_state(inner: &Inner) -> Result<DriveState, StoreError> {
    let mut failed = None;
    let state = DriveState::from_kv(|k| match inner.storage.meta(&meta_key(k)) {
        Ok(v) => v,
        Err(e) => {
            failed.get_or_insert(e);
            None
        }
    });
    failed.map_or(Ok(state), |e| Err(store_err(e)))
}

fn write_state(inner: &mut Inner, state: &DriveState) -> Result<(), StoreError> {
    let writes = state.to_kv().into_iter().map(|(k, v)| Write::SetMeta(meta_key(k), v)).collect();
    inner.storage.apply(writes).map(drop).map_err(store_err)
}

impl DriveStore for NativeDriveStore {
    async fn load_state(&self) -> Result<DriveState, StoreError> {
        read_state(&crate::lock(&self.core))
    }

    async fn save_state(&mut self, state: &DriveState) -> Result<(), StoreError> {
        write_state(&mut crate::lock(&self.core), state)
    }

    async fn max_seq(&self) -> Result<u64, StoreError> {
        crate::lock(&self.core).storage.log_info().map(|i| i.max_seq).map_err(store_err)
    }

    async fn events_between(&self, after: u64, up_to: u64) -> Result<Vec<Value>, StoreError> {
        let events = crate::lock(&self.core).storage.events_after(after, Some(up_to), None).map_err(store_err)?;
        Ok(events.into_iter().map(Value::Object).collect())
    }

    async fn import(
        &mut self,
        payload: Value,
        unsynced_after_seq: u64,
        allow_secrets: bool,
    ) -> Result<ImportOutcome, StoreError> {
        let found = crate::lock(&self.core)
            .import_remote(&payload, unsynced_after_seq, "drive", allow_secrets)
            .map_err(store_err)?;
        Ok(ImportOutcome {
            added: found.imported.len(),
            conflicts: found.conflicts.iter().map(|c| Value::Object(c.to_object())).collect(),
            merged: found.merged.iter().filter_map(|m| serde_json::to_value(m).ok()).collect(),
            imported: found.imported,
        })
    }

    async fn export_snapshot(&self, redact_secrets: bool, exported_at: &str) -> Result<String, StoreError> {
        let opts = ExportOptions { include_blobs: false, redact_secrets, exported_at: exported_at.to_owned() };
        crate::lock(&self.core).storage.export_all(&opts).map_err(store_err)
    }

    async fn blob_ids(&self) -> Result<Vec<String>, StoreError> {
        crate::lock(&self.core).storage.blob_keys().map_err(store_err)
    }

    async fn get_blob(&self, id: &str) -> Result<Option<LocalBlob>, StoreError> {
        let blob = crate::lock(&self.core).storage.blob(id).map_err(store_err)?;
        Ok(blob.map(|b| LocalBlob { meta: b.meta.unwrap_or(Value::Null), data: b.bytes }))
    }

    async fn put_blob(&mut self, id: &str, blob: LocalBlob) -> Result<(), StoreError> {
        let write = Write::PutBlob(id.to_owned(), Blob { bytes: blob.data, meta: Some(blob.meta) });
        crate::lock(&self.core).storage.apply(vec![write]).map(drop).map_err(store_err)
    }
}

// ---------------------------------------------------------------------------
// Uhr, Token, Abbruch

/// Systemzeit; die Uhr-Korrektur gegen Drive (`Date`-Header) geht an die Uhr des Kerns, damit
/// neue Events (auch Konfliktkopien beim Import) schon während des Durchgangs richtig datiert sind.
struct NativeClock {
    core: Shared,
}

impl Clock for NativeClock {
    fn now_ms(&self) -> f64 {
        SystemClock.now_ms()
    }

    async fn sleep_ms(&self, ms: u64) {
        SystemClock.sleep_ms(ms).await;
    }

    fn set_offset_ms(&self, offset_ms: f64) {
        crate::lock(&self.core).clock.set_offset(offset_ms.round() as i64);
    }
}

struct Tokens(Arc<dyn DriveTokens>);

impl TokenSource for Tokens {
    async fn access_token(&self) -> Option<String> {
        self.0.access_token()
    }

    async fn renew(&self, rejected: &str) -> Option<String> {
        self.0.renew_token(rejected.to_owned())
    }

    async fn expired(&self) {
        self.0.token_expired();
    }
}

/// Bricht den Durchgang vor jeder weiteren Anfrage ab (`NetError::Aborted`). Alle Marken sind
/// bis dahin gespeichert, der nächste Durchgang setzt dort fort.
struct Stoppable<H> {
    http: H,
    stop: Arc<AtomicBool>,
}

impl<H: HttpClient> HttpClient for Stoppable<H> {
    async fn send(&self, req: &Request) -> Result<Response, NetError> {
        if self.stop.load(Ordering::Relaxed) {
            return Err(NetError::Aborted);
        }
        self.http.send(req).await
    }
}

// ---------------------------------------------------------------------------
// Drive-Thread

type Reply<T> = Sender<Result<T, DriveError>>;

enum Cmd {
    Sync(Option<Arc<dyn DriveProgress>>, Reply<impala_drive::SyncReport>),
    Flush(Reply<usize>),
    Storage(Reply<Option<StorageInfo>>),
    Email(Reply<Option<String>>),
}

/// Was der Thread veröffentlicht.
struct Published {
    running: AtomicBool,
    progress: Mutex<String>,
}

type Backup<H> = DriveBackup<Stoppable<H>, Tokens, NativeDriveStore, NativeClock>;

fn run<H: HttpClient>(
    mut backup: Backup<H>,
    rx: Receiver<Cmd>,
    shared: Shared,
    stop: Arc<AtomicBool>,
    out: Arc<Published>,
) {
    let set_progress = |label: &str| *out.progress.lock().unwrap_or_else(|e| e.into_inner()) = label.to_owned();
    for cmd in rx {
        // Ein Durchgang zur Zeit; `stop()` gilt nur für den laufenden.
        stop.store(false, Ordering::Relaxed);
        backup.set_options(DriveOptions { allow_secrets: allow_secrets(&crate::lock(&shared)) });
        match cmd {
            Cmd::Sync(listener, reply) => {
                let mut on_phase = |p: Phase| {
                    let label = p.label();
                    set_progress(&label);
                    if let Some(l) = &listener {
                        l.on_progress(label);
                    }
                };
                let r = block_on(backup.sync(&mut on_phase));
                set_progress("");
                out.running.store(false, Ordering::Release);
                let _ = reply.send(r);
            }
            Cmd::Flush(reply) => {
                let r = block_on(backup.flush_upload());
                out.running.store(false, Ordering::Release);
                let _ = reply.send(r);
            }
            Cmd::Storage(reply) => {
                let r = block_on(backup.storage_info());
                out.running.store(false, Ordering::Release);
                let _ = reply.send(r);
            }
            Cmd::Email(reply) => {
                let r = block_on(backup.account_email());
                out.running.store(false, Ordering::Release);
                let _ = reply.send(r);
            }
        }
    }
}

/// Google-Drive-Backup dieser Datenbank. Alle Methoden blockieren bis zum Ergebnis (mehrere
/// Aufrufe laufen nacheinander): aus einem Hintergrund-Thread rufen.
#[derive(uniffi::Object)]
pub struct DriveSync {
    core: Shared,
    tx: Sender<Cmd>,
    out: Arc<Published>,
    stop: Arc<AtomicBool>,
}

impl DriveSync {
    pub(crate) fn start<H: HttpClient + Send + 'static>(
        core: &Arc<ImpalaCore>,
        http: H,
        tokens: Arc<dyn DriveTokens>,
    ) -> Arc<DriveSync> {
        let shared = core.shared();
        let stop = Arc::new(AtomicBool::new(false));
        let out = Arc::new(Published { running: AtomicBool::new(false), progress: Mutex::new(String::new()) });
        let (tx, rx) = mpsc::channel();
        let (thread_shared, thread_stop, thread_out) = (shared.clone(), stop.clone(), out.clone());
        // `DriveBackup` ist nicht `Send` (RefCell): Es entsteht im Thread und bleibt dort.
        thread::Builder::new()
            .name("impala-drive".into())
            .spawn(move || {
                let backup = DriveBackup::new(
                    Stoppable { http, stop: thread_stop.clone() },
                    Tokens(tokens),
                    NativeDriveStore { core: thread_shared.clone() },
                    NativeClock { core: thread_shared.clone() },
                );
                run(backup, rx, thread_shared, thread_stop, thread_out)
            })
            .expect("Drive-Thread");
        Arc::new(DriveSync { core: shared, tx, out, stop })
    }

    /// Schickt einen Auftrag und wartet auf die Antwort.
    fn pass<T>(&self, cmd: impl FnOnce(Reply<T>) -> Cmd) -> Result<T, DriveFailure> {
        self.out.running.store(true, Ordering::Release);
        let (reply, rx) = mpsc::channel();
        let sent = self.tx.send(cmd(reply)).map_err(|_| gone());
        let r = sent.and_then(|()| rx.recv().map_err(|_| gone())?.map_err(DriveFailure::from));
        if r.is_err() {
            self.out.running.store(false, Ordering::Release);
        }
        r
    }
}

#[uniffi::export]
impl DriveSync {
    /// Verbindet `core` mit Google Drive. `tokens` liefert die Anmeldung der App.
    #[uniffi::constructor]
    pub fn new(core: Arc<ImpalaCore>, tokens: Arc<dyn DriveTokens>) -> Arc<Self> {
        DriveSync::start(&core, UreqClient::default(), tokens)
    }

    /// Voller Durchgang: Remote-Stand übernehmen → Dateien → eigene Änderungen hochladen →
    /// ggf. verdichten. Auf einem leeren Gerät ist das zugleich die Wiederherstellung.
    pub fn sync(&self, progress: Option<Arc<dyn DriveProgress>>) -> Result<DriveReport, DriveFailure> {
        Ok(report(&self.pass(|r| Cmd::Sync(progress, r))?))
    }

    /// Kurzweg beim Schließen/Hintergrund: nur das eigene Änderungspaket hochladen (kein Ziehen,
    /// keine Dateien). Ohne gültiges Token passiert nichts. Liefert die Zahl hochgeladener Events.
    pub fn flush_upload(&self) -> Result<u64, DriveFailure> {
        Ok(self.pass(Cmd::Flush)? as u64)
    }

    /// Speicheranzeige; ohne gültiges Token `None` (nie Grund für eine Anmeldung).
    pub fn storage_info(&self) -> Result<Option<DriveStorage>, DriveFailure> {
        Ok(self.pass(Cmd::Storage)?.map(DriveStorage::from))
    }

    /// E-Mail des Kontos (nur Anzeige) oder `None`; nur ein abgelehntes Token ist ein Fehler.
    pub fn account_email(&self) -> Result<Option<String>, DriveFailure> {
        self.pass(Cmd::Email)
    }

    /// Bricht den laufenden Durchgang vor der nächsten Anfrage ab (`DriveFailure::Stopped`).
    pub fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
    }

    pub fn status(&self) -> DriveStatus {
        let state = read_state(&crate::lock(&self.core)).unwrap_or_default();
        DriveStatus {
            last_ok: state.last_ok,
            uploaded_seq: state.uploaded_seq.unwrap_or(0),
            synced_seq: state.synced_seq.unwrap_or(0),
            running: self.out.running.load(Ordering::Acquire),
            progress: self.out.progress.lock().unwrap_or_else(|e| e.into_inner()).clone(),
        }
    }

    /// Vergisst den lokalen Drive-Stand (Dateiindex, Wasserstände, Geräte-ID). Beim Wechsel des
    /// Google-Kontos aufrufen, sonst gälte alles als schon hochgeladen. Die Daten bleiben.
    pub fn reset_state(&self) -> Result<(), CoreError> {
        write_state(&mut crate::lock(&self.core), &DriveState::default())
            .map_err(|e| CoreError::Storage { message: e.0 })
    }
}

// ---------------------------------------------------------------------------
// Datensicherheit (Hinweis „nicht gesichert“)

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum DriveBackupLevel {
    /// Nichts Ungesichertes.
    Safe,
    /// Frisch, wird gleich mitgenommen.
    Pending,
    /// Sync eingerichtet, hängt aber hinterher.
    Stale,
    /// Gar kein Sync: Daten nur auf diesem Gerät.
    Local,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct DriveBackupView {
    pub level: DriveBackupLevel,
    /// Zeitstempel des ältesten ungesicherten eigenen Events.
    pub unsafe_since: Option<String>,
    /// Hinweis auf der Startseite zeigen.
    pub needs_hint: bool,
    /// So lange blendet „Später“ den Hinweis aus.
    pub snooze_ms: f64,
}

/// Wie viele Events auf einmal nach dem ältesten ungesicherten gesucht werden.
const UNSAFE_SCAN_BATCH: usize = 500;

/// Zustand der Datensicherheit aus Drive-Wasserstand und (falls aktiv) Cloudflare-Wasserstand.
/// `cloudflare_uploaded_seq`: `Some(letzte hochgeladene seq)` bei aktivem Cloudflare-Sync, sonst `None`.
#[uniffi::export]
pub fn drive_backup_view(core: Arc<ImpalaCore>, cloudflare_uploaded_seq: Option<u64>, now_ms: f64) -> DriveBackupView {
    let inner = core.lock();
    let drive = read_state(&inner).unwrap_or_default().uploaded_seq.unwrap_or(0);
    let protected =
        status::protected_seq(cloudflare_uploaded_seq.is_some(), cloudflare_uploaded_seq.unwrap_or(0), drive);
    // In Etappen, bis das erste eigene Event über dem Wasserstand gefunden ist.
    let mut since = None;
    let mut after = protected;
    while since.is_none() {
        let Ok(batch) = inner.storage.events_after(after, None, Some(UNSAFE_SCAN_BATCH)) else { break };
        let Some(last) = batch.last().and_then(|e| e.get("seq").and_then(Value::as_u64)) else { break };
        let batch: Vec<Value> = batch.into_iter().map(Value::Object).collect();
        since = status::first_unsafe_at(&batch, protected);
        after = last;
    }
    let (level, unsafe_since) = status::backup_view(cloudflare_uploaded_seq.is_some(), since.as_deref(), now_ms);
    let level = match level {
        BackupLevel::Safe => DriveBackupLevel::Safe,
        BackupLevel::Pending => DriveBackupLevel::Pending,
        BackupLevel::Stale => DriveBackupLevel::Stale,
        BackupLevel::Local => DriveBackupLevel::Local,
    };
    let (needs_hint, snooze_ms) = match level {
        DriveBackupLevel::Stale => (true, BackupLevel::Stale.snooze_ms()),
        DriveBackupLevel::Local => (true, BackupLevel::Local.snooze_ms()),
        DriveBackupLevel::Safe => (false, BackupLevel::Safe.snooze_ms()),
        DriveBackupLevel::Pending => (false, BackupLevel::Pending.snooze_ms()),
    };
    DriveBackupView { level, unsafe_since, needs_hint, snooze_ms }
}

// ---------------------------------------------------------------------------
// Timer-Regeln (die App besitzt Timer und Ereignisse)

fn setting(json: Option<String>) -> Option<Value> {
    // Ein Wert, der kein JSON ist, gilt als Text (wie ein String-Wert der Einstellung).
    json.map(|s| serde_json::from_str(&s).unwrap_or(Value::String(s)))
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct DriveIntervalOption {
    pub minutes: u32,
    pub label: String,
}

/// Wählbare Auto-Sync-Intervalle (Einstellung `driveAutoSyncMinutes`).
#[uniffi::export]
pub fn drive_sync_interval_options() -> Vec<DriveIntervalOption> {
    policy::SYNC_INTERVAL_OPTIONS
        .iter()
        .map(|(minutes, label)| DriveIntervalOption { minutes: *minutes, label: (*label).to_owned() })
        .collect()
}

/// Intervall des Auto-Sync-Timers in ms aus dem Einstellungswert (JSON-Text; fehlt oder ungültig: Standard).
#[uniffi::export]
pub fn drive_sync_interval_ms(setting_json: Option<String>) -> u64 {
    policy::sync_interval_ms(setting(setting_json).as_ref())
}

/// Einstellung „Nach jeder Änderung syncen“ (`driveSyncAfterChange`): nur ausdrücklich `true`.
#[uniffi::export]
pub fn drive_sync_after_change(setting_json: Option<String>) -> bool {
    policy::sync_after_change(setting(setting_json).as_ref())
}

/// Fokus allein ist keine Eingabe: nur ein Tastendruck in dieser Zeit zählt als Tippen.
#[uniffi::export]
pub fn drive_typing_idle_ms() -> f64 {
    policy::TYPING_IDLE_MS
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum DriveAutoReason {
    Start,
    Change,
    Interval,
    Foreground,
    /// App geht in den Hintergrund: sofort, auch mitten in einer Eingabe.
    Background,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum DriveGate {
    /// Nicht angemeldet oder schon ein Sync unterwegs: nichts tun.
    Skip,
    /// Offline: Status „Offline · wartet“.
    Offline,
    /// Nutzer tippt/zeichnet: über `DriveChangeTimer` später erneut.
    Defer,
    Run,
}

/// Entscheidung vor einem automatischen Sync. `Background` erzwingt (kein Aufschieben mitten
/// in der Eingabe), ebenso `force` (Ende des Aufschiebens, siehe [`DriveTimerStep::Sync`]).
#[uniffi::export]
pub fn drive_auto_sync_gate(
    reason: DriveAutoReason,
    force: bool,
    connected: bool,
    online: bool,
    editing: bool,
    in_flight: bool,
) -> DriveGate {
    let force = force || reason == DriveAutoReason::Background;
    match policy::auto_sync_gate(connected, online, editing, force, in_flight) {
        Gate::Skip => DriveGate::Skip,
        Gate::Offline => DriveGate::Offline,
        Gate::Defer => DriveGate::Defer,
        Gate::Run => DriveGate::Run,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum DriveChangeStep {
    /// Sync nach Änderung ist aus: Timer abbrechen.
    Cancel,
    /// Event zählt nicht (UI-Zustand).
    Ignore,
    /// Timer in `delay_ms` (neu) stellen; Status „Speichert…“.
    Schedule { delay_ms: u64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum DriveTimerStep {
    /// Noch in Eingabe: in `delay_ms` wieder fragen.
    Wait { delay_ms: u64 },
    /// Jetzt syncen; `force`: trotz laufender Eingabe (Aufschieben ausgeschöpft).
    Sync { force: bool },
}

/// Bündelt Änderungen zu einem Sync (Entprellen, höchstens eine Minute aufschieben).
#[derive(uniffi::Object)]
pub struct DriveChangeTimer {
    timer: Mutex<ChangeTimer>,
}

#[uniffi::export]
impl DriveChangeTimer {
    #[uniffi::constructor]
    pub fn new() -> Arc<Self> {
        Arc::new(DriveChangeTimer { timer: Mutex::new(ChangeTimer::default()) })
    }

    /// Nach jedem lokalen Event (`event_type` wie im Log, z. B. `pageUpdate`).
    pub fn on_change(&self, now_ms: f64, after_change_enabled: bool, event_type: String) -> DriveChangeStep {
        match self.timer.lock().unwrap_or_else(|e| e.into_inner()).on_change(now_ms, after_change_enabled, &event_type)
        {
            ChangeStep::Cancel => DriveChangeStep::Cancel,
            ChangeStep::Ignore => DriveChangeStep::Ignore,
            ChangeStep::Schedule(delay_ms) => DriveChangeStep::Schedule { delay_ms },
        }
    }

    /// Der Timer ist abgelaufen.
    pub fn on_timer(&self, now_ms: f64, editing: bool) -> DriveTimerStep {
        match self.timer.lock().unwrap_or_else(|e| e.into_inner()).on_timer(now_ms, editing) {
            TimerStep::Wait(delay_ms) => DriveTimerStep::Wait { delay_ms },
            TimerStep::Sync { force } => DriveTimerStep::Sync { force },
        }
    }
}

// ---------------------------------------------------------------------------
// Anzeige-Regeln

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum DriveAuth {
    Disconnected,
    Connecting,
    Connected,
    /// Sitzung bekannt, Token abgelaufen: „Pausiert“.
    RenewalRequired,
}

impl From<DriveAuth> for AuthState {
    fn from(a: DriveAuth) -> Self {
        match a {
            DriveAuth::Disconnected => AuthState::Disconnected,
            DriveAuth::Connecting => AuthState::Connecting,
            DriveAuth::Connected => AuthState::Connected,
            DriveAuth::RenewalRequired => AuthState::RenewalRequired,
        }
    }
}

impl From<AuthState> for DriveAuth {
    fn from(a: AuthState) -> Self {
        match a {
            AuthState::Disconnected => DriveAuth::Disconnected,
            AuthState::Connecting => DriveAuth::Connecting,
            AuthState::Connected => DriveAuth::Connected,
            AuthState::RenewalRequired => DriveAuth::RenewalRequired,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum DriveUiState {
    Idle,
    Syncing,
    Waiting,
    Ok,
    Error,
}

impl From<DriveUiState> for UiState {
    fn from(s: DriveUiState) -> Self {
        match s {
            DriveUiState::Idle => UiState::Idle,
            DriveUiState::Syncing => UiState::Syncing,
            DriveUiState::Waiting => UiState::Waiting,
            DriveUiState::Ok => UiState::Ok,
            DriveUiState::Error => UiState::Error,
        }
    }
}

impl From<UiState> for DriveUiState {
    fn from(s: UiState) -> Self {
        match s {
            UiState::Idle => DriveUiState::Idle,
            UiState::Syncing => DriveUiState::Syncing,
            UiState::Waiting => DriveUiState::Waiting,
            UiState::Ok => DriveUiState::Ok,
            UiState::Error => DriveUiState::Error,
        }
    }
}

/// Eine Aussage für die Anzeige.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct DriveStatusView {
    pub state: DriveUiState,
    pub label: String,
    pub detail: String,
}

impl From<status::StatusView> for DriveStatusView {
    fn from(v: status::StatusView) -> Self {
        DriveStatusView { state: v.state.into(), label: v.label, detail: v.detail }
    }
}

/// Anmeldezustand aus „Token gültig“ und „Sitzung bekannt“.
#[uniffi::export]
pub fn drive_auth_state(token_valid: bool, session_known: bool) -> DriveAuth {
    status::auth_state(token_valid, session_known).into()
}

/// Ablaufzeit eines frischen Tokens (ms seit 1970): eine Minute Puffer, ohne Angabe eine Stunde.
#[uniffi::export]
pub fn drive_token_expiry_ms(now_ms: f64, expires_in_s: Option<f64>) -> f64 {
    status::token_expiry_ms(now_ms, expires_in_s)
}

/// Anzeige nach einem Sync: Anmeldung, Netz, letzter Sync-Zustand (`sync_state`/`sync_label`/
/// `sync_detail`, leer = `Idle`) und E-Mail (leer, solange unbekannt).
#[uniffi::export]
pub fn drive_status_view(
    auth: DriveAuth,
    sync_state: DriveUiState,
    sync_label: String,
    sync_detail: String,
    online: bool,
    email: String,
) -> DriveStatusView {
    let sync = SyncUi::new(sync_state.into(), &sync_label, &sync_detail);
    status::status_view(auth.into(), &sync, online, &email).into()
}

/// Anzeige-Zustand nach einem erfolgreichen Sync (`DriveReport.label`).
#[uniffi::export]
pub fn drive_synced_ui(label: String) -> DriveStatusView {
    let ui = SyncUi::new(UiState::Ok, &label, "");
    DriveStatusView { state: ui.state.into(), label: ui.label, detail: ui.detail }
}

/// Anzeige-Zustand nach einem gescheiterten Sync (`message` aus `DriveFailure`). `None` bei
/// abgelaufener Anmeldung: Das zeigt `drive_status_view` als „Pausiert“, kein Fehler.
#[uniffi::export]
pub fn drive_failed_ui(message: String, session_expired: bool, online: bool) -> Option<DriveStatusView> {
    let error = if session_expired { DriveError::SessionExpired } else { DriveError::BadResponse(message) };
    SyncUi::failed(&error, online).map(|ui| DriveStatusView {
        state: ui.state.into(),
        label: ui.label,
        detail: ui.detail,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum DriveButton {
    /// Client-ID fehlt: erst einrichten.
    Setup,
    Sync,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct DriveActionView {
    pub action: DriveButton,
    pub label: String,
}

/// Hauptknopf der Drive-Einstellungen.
#[uniffi::export]
pub fn drive_action_state(has_client: bool, connected: bool, needs_login: bool) -> DriveActionView {
    let (action, label) = status::action_state(has_client, connected, needs_login);
    let action = match action {
        DriveAction::Setup => DriveButton::Setup,
        DriveAction::Sync => DriveButton::Sync,
    };
    DriveActionView { action, label: label.to_owned() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use impala_crypto::{base64_encode, gunzip};
    use impala_drive::format::{BLOB_PREFIX, DELTA_PREFIX};
    use impala_net::Method;
    use serde_json::json;
    use std::collections::HashMap;

    // --- Nachgebaute Drive-API (wie impala-drive/tests/roundtrip.rs) ---

    #[derive(Clone)]
    struct File {
        id: String,
        name: String,
        modified: String,
        props: Value,
        bytes: Vec<u8>,
    }

    impl File {
        fn view(&self) -> Value {
            json!({"id": self.id, "name": self.name, "modifiedTime": self.modified,
                "size": self.bytes.len().to_string(), "appProperties": self.props})
        }
    }

    #[derive(Default)]
    struct Drive {
        files: Vec<File>,
        changes: Vec<(String, Option<File>)>,
        next: u32,
        tokens: Vec<String>,
        page_size: usize,
        /// `Date`-Header der Antworten (fehlt: keine Uhr-Korrektur).
        date: Option<String>,
    }

    impl Drive {
        fn new() -> Self {
            Drive { tokens: vec!["tok".into()], page_size: 2, ..Default::default() }
        }

        fn put(&mut self, id: Option<&str>, meta: &Value, bytes: Vec<u8>) -> Value {
            self.next += 1;
            let modified = format!("2026-10-27T10:{:02}:{:02}.000Z", self.next / 60, self.next % 60);
            let file = match id.and_then(|id| self.files.iter_mut().find(|f| f.id == id)) {
                Some(f) => {
                    f.name = meta["name"].as_str().unwrap().into();
                    f.props = meta["appProperties"].clone();
                    f.bytes = bytes;
                    f.modified = modified;
                    f.clone()
                }
                None => {
                    let f = File {
                        id: format!("f{}", self.next),
                        name: meta["name"].as_str().unwrap().into(),
                        modified,
                        props: meta["appProperties"].clone(),
                        bytes,
                    };
                    self.files.push(f.clone());
                    f
                }
            };
            self.changes.push((file.id.clone(), Some(file.clone())));
            json!({"id": file.id, "name": file.name, "modifiedTime": file.modified, "appProperties": file.props})
        }

        fn handle(&mut self, req: &Request) -> (u16, Vec<u8>) {
            let ok = |v: Value| (200, v.to_string().into_bytes());
            let auth =
                req.headers.iter().find(|(k, _)| k == "Authorization").map(|(_, v)| v.trim_start_matches("Bearer "));
            if !auth.is_some_and(|t| self.tokens.iter().any(|x| x == t)) {
                return (401, b"{}".to_vec());
            }
            let (path, query) = req.url.split_once('?').unwrap_or((&req.url, ""));
            let path = path.trim_start_matches("https://www.googleapis.com");
            let q: HashMap<&str, &str> = query.split('&').filter_map(|p| p.split_once('=')).collect();
            let page = |q: &HashMap<&str, &str>| q.get("pageToken").and_then(|t| t.parse::<usize>().ok()).unwrap_or(0);
            match (req.method, path) {
                (Method::Get, "/drive/v3/changes/startPageToken") => {
                    ok(json!({"startPageToken": self.changes.len().to_string()}))
                }
                (Method::Get, "/drive/v3/changes") => {
                    let at = page(&q);
                    let end = (at + self.page_size).min(self.changes.len());
                    let list: Vec<Value> = self.changes[at..end]
                        .iter()
                        .map(|(id, f)| match f {
                            Some(f) => json!({"fileId": id, "removed": false, "file": f.view()}),
                            None => json!({"fileId": id, "removed": true}),
                        })
                        .collect();
                    if end < self.changes.len() {
                        ok(json!({"changes": list, "nextPageToken": end.to_string()}))
                    } else {
                        ok(json!({"changes": list, "newStartPageToken": end.to_string()}))
                    }
                }
                (Method::Get, "/drive/v3/about") => ok(json!({"storageQuota": {"usage": "100", "limit": "1000"}})),
                (Method::Get, "/oauth2/v2/userinfo") => ok(json!({"email": "nutzer@example.org"})),
                (Method::Get, "/drive/v3/files") => {
                    let at = page(&q);
                    let end = (at + self.page_size).min(self.files.len());
                    let list: Vec<Value> = self.files[at..end].iter().map(File::view).collect();
                    if end < self.files.len() {
                        ok(json!({"files": list, "nextPageToken": end.to_string()}))
                    } else {
                        ok(json!({"files": list}))
                    }
                }
                (Method::Get, p) if p.starts_with("/drive/v3/files/") => {
                    let id = &p["/drive/v3/files/".len()..];
                    match self.files.iter().find(|f| f.id == id) {
                        Some(f) => (200, f.bytes.clone()),
                        None => (404, b"{}".to_vec()),
                    }
                }
                (Method::Delete, p) => {
                    let id = p["/drive/v3/files/".len()..].to_owned();
                    self.files.retain(|f| f.id != id);
                    self.changes.push((id, None));
                    (204, vec![])
                }
                (Method::Post | Method::Patch, p) if p.starts_with("/upload/drive/v3/files") => {
                    let id = p.strip_prefix("/upload/drive/v3/files/").map(str::to_owned);
                    let ct = &req.headers.iter().find(|(k, _)| k == "Content-Type").unwrap().1;
                    let boundary = ct.split("boundary=").nth(1).unwrap();
                    let sep = format!("\r\n--{boundary}\r\nContent-Type: application/octet-stream\r\n\r\n");
                    let head = format!("--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n").len();
                    let mid = find(&req.body, sep.as_bytes()).unwrap();
                    let meta: Value = serde_json::from_slice(&req.body[head..mid]).unwrap();
                    let tail = format!("\r\n--{boundary}--").len();
                    let bytes = req.body[mid + sep.len()..req.body.len() - tail].to_vec();
                    ok(self.put(id.as_deref(), &meta, bytes))
                }
                _ => (400, b"{}".to_vec()),
            }
        }
    }

    fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
        hay.windows(needle.len()).position(|w| w == needle)
    }

    #[derive(Clone)]
    struct Net(Arc<Mutex<Drive>>);

    impl HttpClient for Net {
        async fn send(&self, req: &Request) -> Result<Response, NetError> {
            let mut d = self.0.lock().unwrap();
            let (status, body) = d.handle(req);
            let headers = d.date.iter().map(|v| ("Date".to_owned(), v.clone())).collect();
            Ok(Response { status, headers, body })
        }
    }

    // --- Anmeldung der App ---

    struct Tok {
        token: &'static str,
        renewed: Option<&'static str>,
        calls: Mutex<Vec<&'static str>>,
    }

    impl Tok {
        fn ok() -> Arc<Tok> {
            Arc::new(Tok { token: "tok", renewed: None, calls: Mutex::default() })
        }
    }

    impl DriveTokens for Tok {
        fn access_token(&self) -> Option<String> {
            (!self.token.is_empty()).then(|| self.token.to_owned())
        }
        fn renew_token(&self, _rejected: String) -> Option<String> {
            self.calls.lock().unwrap().push("renew");
            self.renewed.map(str::to_owned)
        }
        fn token_expired(&self) {
            self.calls.lock().unwrap().push("expired");
        }
    }

    fn device_with(net: &Net, tokens: Arc<Tok>) -> (Arc<ImpalaCore>, Arc<DriveSync>) {
        let core = ImpalaCore::open_in_memory().unwrap();
        let sync = DriveSync::start(&core, net.clone(), tokens);
        (core, sync)
    }

    fn device(net: &Net) -> (Arc<ImpalaCore>, Arc<DriveSync>) {
        device_with(net, Tok::ok())
    }

    fn net() -> Net {
        Net(Arc::new(Mutex::new(Drive::new())))
    }

    fn titles(core: &ImpalaCore) -> Vec<String> {
        let mut t: Vec<String> = core.children_of(None, None).into_iter().map(|p| p.title).collect();
        t.sort();
        t
    }

    // --- Tests ---

    #[test]
    fn zwei_geraete_ueber_dasselbe_drive() {
        let net = net();
        let (a, da) = device(&net);
        let (b, db) = device(&net);
        let pa = a.create_page("Von A".into(), "Inhalt A".into(), None, None).unwrap();
        b.create_page("Von B".into(), "Inhalt B".into(), None, None).unwrap();

        let ra = da.sync(None).unwrap();
        assert_eq!((ra.uploaded, ra.imported, ra.label.as_str()), (1, 0, "Synchronisiert"));
        let rb = db.sync(None).unwrap();
        assert_eq!((rb.imported, rb.uploaded), (1, 1));
        da.sync(None).unwrap();
        assert_eq!(titles(&a), ["Von A", "Von B"]);
        assert_eq!(titles(&b), titles(&a));
        assert_eq!(b.page(pa.clone()).unwrap().content, "Inhalt A");

        // Nichts Neues: „Aktuell“. Das eigene Delta kommt nicht zurück.
        let again = da.sync(None).unwrap();
        assert_eq!((again.imported, again.uploaded, again.label.as_str()), (0, 0, "Aktuell"));

        // Importierte Events sind als Drive-Fremdevents markiert und gehen nicht wieder hinaus.
        let remote = b.export_json(false).unwrap();
        assert!(remote.contains("Inhalt A"));
        let status = da.status();
        assert!(status.last_ok.is_some() && status.uploaded_seq > 0 && !status.running);
        // Zustand liegt in den Meta-Einträgen mit Präfix, nicht unter den PWA-Schlüsseln.
        let inner = a.lock();
        assert!(inner.storage.meta("drive:impala67_drive_last_ok").unwrap().is_some());
        assert!(inner.storage.meta("impala67_drive_last_ok").unwrap().is_none());
    }

    #[test]
    fn konflikt_beim_gleichzeitigen_aendern() {
        let net = net();
        let (a, da) = device(&net);
        let (b, db) = device(&net);
        let p = a.create_page("Seite".into(), "Basis".into(), None, None).unwrap();
        da.sync(None).unwrap();
        db.sync(None).unwrap();

        a.update_page(p.clone(), Some("Titel A".into()), Some("Zeile 1\nA".into())).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        b.update_page(p.clone(), Some("Titel B".into()), Some("Zeile 1\nB".into())).unwrap();
        da.sync(None).unwrap();
        let rb = db.sync(None).unwrap();
        da.sync(None).unwrap();
        db.sync(None).unwrap();

        assert!(rb.conflicts + rb.merged > 0, "Konflikt nicht erkannt: {rb:?}");
        assert_eq!(titles(&a), titles(&b));
        assert_eq!(a.page(p.clone()).unwrap().content, b.page(p).unwrap().content);
    }

    #[test]
    fn bild_datei_wandert_mit() {
        let net = net();
        let (a, da) = device(&net);
        let (b, db) = device(&net);
        let bytes = vec![137, 80, 78, 71, 1, 2, 3, 4];
        let id = a.add_file(bytes.clone(), "image/png".into(), "bild.png".into()).unwrap();
        a.create_page("Mit Bild".into(), format!("![]({id})"), None, None).unwrap();
        let ra = da.sync(None).unwrap();
        assert_eq!((ra.uploaded, ra.files_uploaded), (1, 1));
        {
            let d = net.0.lock().unwrap();
            assert!(d.files.iter().any(|f| f.name.starts_with(BLOB_PREFIX)));
            assert!(d.files.iter().any(|f| f.name.starts_with(DELTA_PREFIX)));
        }
        let rb = db.sync(None).unwrap();
        assert_eq!((rb.imported, rb.files_downloaded), (1, 1));
        let file = b.file(id).unwrap().expect("Datei fehlt");
        assert_eq!((file.bytes, file.mime.as_str(), file.name.as_str()), (bytes, "image/png", "bild.png"));
    }

    #[test]
    fn v1_snapshot_mit_dateien() {
        let net = net();
        let v1 = json!({
            "app": "notion", "version": 1, "exportedAt": "2025-01-01T00:00:00.000Z",
            "events": [{"id": "v1", "t": "2025-01-01T00:00:00.000Z", "type": "pageCreate",
                "payload": {"id": "q", "title": "Alt", "content": ""}}],
            "blobs": {"img:55555555-5555-4555-8555-555555555555":
                {"meta": {"name": "e.png", "type": "image/png"}, "b64": base64_encode(&[1, 1, 2])}}
        });
        net.0.lock().unwrap().put(
            None,
            &json!({"name": "notion-sync.json", "appProperties": Value::Null}),
            v1.to_string().into_bytes(),
        );
        let (a, da) = device(&net);
        let r = da.sync(None).unwrap();
        assert_eq!(r.imported, 1);
        assert_eq!(titles(&a), ["Alt"]);
        assert_eq!(a.file("img:55555555-5555-4555-8555-555555555555".into()).unwrap().unwrap().bytes, [1, 1, 2]);
    }

    #[test]
    fn kurz_upload_speicher_und_konto() {
        let net = net();
        let (a, da) = device(&net);
        let (b, db) = device(&net);
        assert_eq!(da.flush_upload().unwrap(), 0);
        a.create_page("Schnell".into(), "x".into(), None, None).unwrap();
        assert_eq!(da.flush_upload().unwrap(), 1);
        {
            let d = net.0.lock().unwrap();
            let delta = d.files.iter().find(|f| f.name.starts_with(DELTA_PREFIX)).unwrap();
            let content: Value = serde_json::from_slice(&gunzip(&delta.bytes).unwrap()).unwrap();
            assert_eq!(content["events"].as_array().unwrap().len(), 1);
        }
        assert_eq!(da.flush_upload().unwrap(), 0, "nichts Neues");
        db.sync(None).unwrap();
        assert_eq!(titles(&b), ["Schnell"]);

        let info = da.storage_info().unwrap().unwrap();
        assert!(info.app_bytes > 0.0);
        assert_eq!((info.used_bytes, info.limit_bytes), (100.0, 1000.0));
        assert_eq!(da.account_email().unwrap().as_deref(), Some("nutzer@example.org"));
    }

    #[test]
    fn token_erneuern_oder_pausieren() {
        let net = net();
        // Abgelehntes Token, Erneuerung liefert ein gültiges.
        let renewing = Arc::new(Tok { token: "alt", renewed: Some("tok"), calls: Mutex::default() });
        let (a, da) = device_with(&net, renewing.clone());
        a.create_page("X".into(), String::new(), None, None).unwrap();
        assert_eq!(da.sync(None).unwrap().uploaded, 1);
        assert_eq!(*renewing.calls.lock().unwrap(), ["renew"]);

        // Nicht erneuerbar: Sitzung abgelaufen, Token wird verworfen.
        let dead = Arc::new(Tok { token: "alt", renewed: None, calls: Mutex::default() });
        let (_, dd) = device_with(&net, dead.clone());
        assert!(matches!(dd.sync(None), Err(DriveFailure::SessionExpired)));
        assert_eq!(*dead.calls.lock().unwrap(), ["renew", "expired"]);

        // Gar kein Token: Sitzung abgelaufen, Kurz-Upload und Speicherinfo bleiben still.
        let none = Arc::new(Tok { token: "", renewed: None, calls: Mutex::default() });
        let (n, dn) = device_with(&net, none);
        assert!(matches!(dn.sync(None), Err(DriveFailure::SessionExpired)));
        n.create_page("Y".into(), String::new(), None, None).unwrap();
        assert_eq!(dn.flush_upload().unwrap(), 0);
        assert_eq!(dn.storage_info().unwrap(), None);
    }

    struct StopAtStart(Mutex<Option<Arc<DriveSync>>>, Mutex<Vec<String>>);

    impl DriveProgress for StopAtStart {
        fn on_progress(&self, label: String) {
            self.1.lock().unwrap().push(label);
            if let Some(d) = &*self.0.lock().unwrap() {
                d.stop();
            }
        }
    }

    #[test]
    fn abbrechen_und_fortschritt() {
        let net = net();
        let (a, da) = device(&net);
        a.create_page("X".into(), String::new(), None, None).unwrap();
        let listener = Arc::new(StopAtStart(Mutex::new(Some(da.clone())), Mutex::default()));
        assert!(matches!(da.sync(Some(listener.clone())), Err(DriveFailure::Stopped)));
        assert_eq!(listener.1.lock().unwrap()[0], "Synchronisiere…");
        assert!(net.0.lock().unwrap().files.is_empty(), "nach dem Abbruch nichts hochgeladen");
        assert!(!da.status().running);
        // Der nächste Durchgang läuft normal weiter und meldet die Etappen.
        *listener.0.lock().unwrap() = None;
        listener.1.lock().unwrap().clear();
        assert_eq!(da.sync(Some(listener.clone())).unwrap().uploaded, 1);
        assert!(listener.1.lock().unwrap().iter().any(|l| l.contains("Änderungen hochladen")));
    }

    #[test]
    fn uhr_korrektur_geht_an_den_kern() {
        let net = net();
        // Drive-Uhr 4 Jahre voraus: Warnung, und neue Events werden danach so datiert.
        net.0.lock().unwrap().date = Some("Tue, 01 Jan 2030 12:00:00 GMT".into());
        let (a, da) = device(&net);
        a.create_page("Davor".into(), String::new(), None, None).unwrap();
        let r = da.sync(None).unwrap();
        assert!(r.clock_warning_minutes.is_some_and(|m| m > 1_000_000), "{:?}", r.clock_warning_minutes);
        let id = a.create_page("Danach".into(), String::new(), None, None).unwrap();
        assert!(a.page(id).unwrap().summary.updated.starts_with("2030-"));
    }

    #[test]
    fn zustand_zuruecksetzen_und_sicherheitsanzeige() {
        let net = net();
        let (a, da) = device(&net);
        let view = |cf: Option<u64>| drive_backup_view(a.clone(), cf, 0.0);
        assert_eq!(view(None).level, DriveBackupLevel::Safe);
        a.create_page("X".into(), String::new(), None, None).unwrap();
        let since = view(None);
        assert!(since.unsafe_since.is_some() && since.level != DriveBackupLevel::Safe);
        // Weit nach dem Ereignis: kein Sync eingerichtet = nur lokal; mit Cloudflare = hängt hinterher.
        let late = |cf| drive_backup_view(a.clone(), cf, 4_000_000_000_000.0);
        assert_eq!((late(None).level, late(None).needs_hint), (DriveBackupLevel::Local, true));
        assert_eq!(late(Some(0)).level, DriveBackupLevel::Stale);

        da.sync(None).unwrap();
        assert_eq!(late(None).level, DriveBackupLevel::Safe);
        assert!(da.status().uploaded_seq > 0);
        da.reset_state().unwrap();
        let s = da.status();
        assert_eq!((s.uploaded_seq, s.last_ok), (0, None));
        assert_eq!(late(None).level, DriveBackupLevel::Local);
        // Danach übernimmt der nächste Durchgang alles neu (idempotent, nichts doppelt).
        da.sync(None).unwrap();
        assert_eq!(titles(&a), ["X"]);
    }

    #[test]
    fn regeln_fuer_timer_und_anzeige() {
        assert_eq!(drive_sync_interval_ms(None), 30 * 60_000);
        assert_eq!(drive_sync_interval_ms(Some("5".into())), 5 * 60_000);
        assert_eq!(drive_sync_interval_ms(Some("\"60\"".into())), 60 * 60_000);
        assert_eq!(drive_sync_interval_ms(Some("7".into())), 30 * 60_000);
        assert_eq!(drive_sync_interval_options().len(), 6);
        assert!(drive_sync_after_change(Some("true".into())) && !drive_sync_after_change(Some("\"true\"".into())));

        let t = DriveChangeTimer::new();
        assert_eq!(t.on_change(0.0, true, "uiTabsSet".into()), DriveChangeStep::Ignore);
        assert_eq!(t.on_change(0.0, true, "pageUpdate".into()), DriveChangeStep::Schedule { delay_ms: 3000 });
        assert_eq!(t.on_timer(3000.0, true), DriveTimerStep::Wait { delay_ms: 8000 });
        assert_eq!(t.on_timer(61_000.0, true), DriveTimerStep::Sync { force: true });
        assert_eq!(t.on_change(0.0, false, "x".into()), DriveChangeStep::Cancel);

        use DriveAutoReason::{Background, Change};
        assert_eq!(drive_auto_sync_gate(Change, false, true, true, true, false), DriveGate::Defer);
        assert_eq!(drive_auto_sync_gate(Background, false, true, true, true, false), DriveGate::Run);
        assert_eq!(drive_auto_sync_gate(Change, true, true, false, false, false), DriveGate::Offline);
        assert_eq!(drive_auto_sync_gate(Change, false, true, true, false, true), DriveGate::Skip);

        assert_eq!(drive_auth_state(false, true), DriveAuth::RenewalRequired);
        let v = drive_status_view(
            DriveAuth::Connected,
            DriveUiState::Idle,
            String::new(),
            String::new(),
            true,
            "a@b.c".into(),
        );
        assert_eq!((v.label.as_str(), v.detail.as_str()), ("Verbunden", "Verbunden als a@b.c"));
        let v = drive_status_view(
            DriveAuth::RenewalRequired,
            DriveUiState::Ok,
            "Aktuell".into(),
            String::new(),
            true,
            String::new(),
        );
        assert_eq!(v.label, "Pausiert");
        assert_eq!(drive_synced_ui("Aktuell".into()).state, DriveUiState::Ok);
        assert_eq!(drive_failed_ui("x".into(), true, true), None);
        assert_eq!(drive_failed_ui("kaputt".into(), false, false).unwrap().state, DriveUiState::Waiting);
        assert_eq!(drive_failed_ui("kaputt".into(), false, true).unwrap().state, DriveUiState::Error);
        assert_eq!(drive_action_state(true, false, true).label, "Jetzt sichern");
        assert_eq!(drive_action_state(false, false, false).action, DriveButton::Setup);
        assert_eq!(drive_token_expiry_ms(0.0, None), 3_540_000.0);
    }
}
