//! Ein Drive-Backup-Durchgang (`syncRaw`, `flushUpload`, `storageInfo` aus `web/drive.js`
//! ohne Timer, Locks und UI): Ziehen (Snapshot + unbekannte Deltas in EINEM Import) → Blobs
//! abgleichen → eigenes Delta hochladen → ggf. verdichten → späte Deltas nachlesen.
//!
//! Netz über [`HttpClient`], Zugriffstoken über [`TokenSource`], lokale Daten über
//! [`DriveStore`], Zeit über [`Clock`]. Nie zwei Durchgänge parallel: `&mut self`; mehrere
//! Instanzen (Tabs, Prozesse) muss die Plattform gegeneinander sperren. Innerhalb eines Durchgangs
//! laufen Dateien gleichzeitig ([`join_all`]); Token und Uhren-Drift liegen dafür in `RefCell`s.

use std::cell::RefCell;
use std::collections::HashSet;

use impala_crypto::{OsRandom, Random, gzip, hex_encode};
use impala_net::{HttpClient, Request, Response, join_all};
use impala_storage::checkpoint::is_checkpoint_key;
use impala_storage::event::{redact_secrets, strip_local_flags};
use impala_storage::js::iso_from_ms;
use impala_sync::files::{RemoteFile, decode_json, newest_file, unseen_remote_files};
use impala_sync::{LocalBlob, Transport, prune_for_upload, should_upload_to};
use serde_json::{Map, Value};

use crate::DriveError;
use crate::api::{self, Change, Outcome, Upload};
use crate::clock::{Clock, ClockSkew, retry_delay_ms};
use crate::format::{
    BLOB_PREFIX, DriveFile, Encoding, FileKind, SNAPSHOT_NAME, SNAPSHOT_NAMES, blob_hash, blob_name, blob_payload,
    delta_name, delta_payload, delta_properties, import_payload, parse_blob_payload, payload_blobs, payload_events,
};
use crate::state::{DriveState, FileIndex, UploadHash};
use crate::store::DriveStore;

/// Ab so vielen Deltas wird zu einem Snapshot verdichtet.
pub const COMPACT_AFTER_DELTAS: usize = 50;
/// Wiederholungen bei 429/5xx.
const MAX_RETRIES: u32 = 3;
/// Gleichzeitige Downloads und Löschungen bzw. Uploads (wie früher in JS).
const PARALLEL_DOWNLOADS: usize = 6;
const PARALLEL_UPLOADS: usize = 3;

/// Liefert das OAuth-Zugriffstoken. Die Anmeldung selbst (Popup, Kontowahl) ist Plattformsache;
/// ein Hintergrund-Sync öffnet nie ein Fenster.
#[allow(async_fn_in_trait)]
pub trait TokenSource {
    /// Gültiges Token oder `None` (dann: [`DriveError::SessionExpired`]).
    async fn access_token(&self) -> Option<String>;
    /// Drive hat `rejected` mit 401 abgelehnt. Ein neues Token (z. B. per Refresh-Token) oder
    /// `None`. Die Web-Anmeldung kennt keinen Refresh-Token und bleibt beim Standard.
    async fn renew(&self, _rejected: &str) -> Option<String> {
        None
    }
    /// Abgelehnt und nicht erneuerbar: Token verwerfen, Anzeige „Pausiert“.
    async fn expired(&self) {}
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DriveOptions {
    /// Einstellung „Tokens synchronisieren“ (`syncSecrets !== false`). Aus: Geheimnisse werden
    /// vor dem Upload entfernt, und ein gesetzter Scrub-Auftrag räumt alte Kopien weg.
    pub allow_secrets: bool,
}

impl Default for DriveOptions {
    fn default() -> Self {
        DriveOptions { allow_secrets: true }
    }
}

/// Fortschritt eines Durchgangs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Start,
    Pull { snapshot: bool, deltas: usize },
    UploadBlobs(usize),
    Scrub,
    UploadDelta,
    Compact,
    LateDeltas(usize),
}

impl Phase {
    /// Beschriftung wie in der PWA.
    pub fn label(&self) -> String {
        match self {
            Phase::Start => "Synchronisiere…".into(),
            Phase::Pull { snapshot: true, .. } => "Remote-Stand übernehmen…".into(),
            Phase::Pull { deltas, .. } => format!("{deltas} Änderungspaket(e) laden…"),
            Phase::UploadBlobs(n) => format!("{n} Datei(en) hochladen…"),
            Phase::Scrub => "Token-Kopien aus Drive entfernen…".into(),
            Phase::UploadDelta => "Änderungen hochladen…".into(),
            Phase::Compact => "Sync-Stand optimieren…".into(),
            Phase::LateDeltas(n) => format!("{n} nachträgliche(s) Änderungspaket(e) einlesen…"),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct SyncReport {
    /// Neu übernommene Events.
    pub imported: usize,
    /// Hochgeladene eigene Events.
    pub uploaded: usize,
    pub conflicts: Vec<Value>,
    pub merged: Vec<Value>,
    /// Für den Live-Replay der Plattform.
    pub imported_events: Vec<Value>,
    pub blobs_downloaded: usize,
    pub blobs_uploaded: usize,
    /// Blob-Dateien ohne ID oder mit kaputtem Inhalt (übergangen).
    pub skipped_blob_files: usize,
    pub compacted: bool,
    pub scrubbed: bool,
    /// Versatz der Geräteuhr gegen Drive; die Plattform setzt [`DriveBackup::clock_offset_ms`].
    pub clock_skew_ms: f64,
    /// Gesetzt, wenn die Uhr so weit abweicht, dass der Nutzer gewarnt werden soll (Minuten).
    pub clock_warning_minutes: Option<u64>,
}

impl SyncReport {
    /// Abschluss-Beschriftung.
    pub fn label(&self) -> &'static str {
        if self.imported > 0 || self.uploaded > 0 { "Synchronisiert" } else { "Aktuell" }
    }
}

/// Speicheranzeige: Anteil des App-Ordners und Belegung des Google-Kontos (Bytes).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StorageInfo {
    pub app_bytes: f64,
    pub used_bytes: f64,
    pub limit_bytes: f64,
}

pub struct DriveBackup<H, T, S, C> {
    http: H,
    tokens: T,
    store: S,
    clock: C,
    rng: Box<dyn Random>,
    options: DriveOptions,
    skew: RefCell<ClockSkew>,
    token: RefCell<String>,
}

impl<H: HttpClient, T: TokenSource, S: DriveStore, C: Clock> DriveBackup<H, T, S, C> {
    pub fn new(http: H, tokens: T, store: S, clock: C) -> Self {
        DriveBackup {
            http,
            tokens,
            store,
            clock,
            rng: Box::new(OsRandom),
            options: DriveOptions::default(),
            skew: RefCell::default(),
            token: RefCell::default(),
        }
    }

    /// Zufall für Geräte-ID, Multipart-Grenze und Backoff-Jitter (Tests: fest).
    pub fn with_rng(mut self, rng: Box<dyn Random>) -> Self {
        self.rng = rng;
        self
    }

    pub fn with_options(mut self, options: DriveOptions) -> Self {
        self.options = options;
        self
    }

    pub fn set_options(&mut self, options: DriveOptions) {
        self.options = options;
    }

    pub fn store(&self) -> &S {
        &self.store
    }

    pub fn store_mut(&mut self) -> &mut S {
        &mut self.store
    }

    pub fn tokens(&self) -> &T {
        &self.tokens
    }

    /// Uhr-Korrektur für neue Event-Zeitstempel (`U.setClockOffset`): erst ab 15 s Versatz.
    pub fn clock_offset_ms(&self) -> f64 {
        self.skew.borrow().applied_offset_ms()
    }

    // ---- Durchgänge ----------------------------------------------------------------

    /// Voller Sync. Fehler lassen alle bis dahin gespeicherten Marken stehen; der nächste
    /// Durchgang setzt dort fort (alle Importe sind idempotent).
    pub async fn sync(&mut self, on_phase: &mut dyn FnMut(Phase)) -> Result<SyncReport, DriveError> {
        on_phase(Phase::Start);
        self.take_token().await?;
        let mut st = self.store.load_state().await?;
        self.ensure_device_id(&mut st).await?;
        let files = self.list_sync_files(&mut st).await?;
        let mut report = SyncReport::default();
        // [F4] Wasserstand klemmen: über maxSeq (Kompaktierung/Restore) würde er die
        // Konflikterkennung abschalten.
        let uploaded_seq = st.uploaded_seq.unwrap_or(0).min(self.store.max_seq().await?);

        self.pull(&mut st, &files, uploaded_seq, &mut report, on_phase).await?;
        self.sync_blobs(&mut st, &files, &mut report, on_phase).await?;

        let scrub = st.secret_scrub && !self.options.allow_secrets;
        if scrub {
            on_phase(Phase::Scrub);
            self.scrub(&mut st, &files).await?;
            report.scrubbed = true;
        }
        let local_max = self.store.max_seq().await?;
        if !scrub && local_max > uploaded_seq {
            on_phase(Phase::UploadDelta);
            report.uploaded = self.upload_delta(&mut st, uploaded_seq, local_max).await?;
        }
        let listed: Vec<&DriveFile> = files.iter().filter(|f| f.kind() == FileKind::Delta).collect();
        if !scrub && listed.len() >= COMPACT_AFTER_DELTAS {
            on_phase(Phase::Compact);
            self.compact(&mut st, &files, &listed).await?;
            report.compacted = true;
        }

        // Späte Deltas: was andere Geräte WÄHREND dieses Durchgangs hochgeladen haben.
        // [A2] Wasserstand vorher nachziehen, sonst gälten eigene Merge-Events als ungesynct.
        let unsynced = st.uploaded_seq.unwrap_or(uploaded_seq).min(self.store.max_seq().await?);
        let files_after = self.list_sync_files(&mut st).await?;
        let late = unseen_deltas(&files_after, &st);
        if !late.is_empty() {
            on_phase(Phase::LateDeltas(late.len()));
            let mut events = Vec::new();
            for payload in self.download_all(&late.iter().collect::<Vec<_>>()).await? {
                events.extend(payload_events(&payload));
            }
            if !events.is_empty() {
                self.import(events, Map::new(), unsynced, &mut report).await?;
            }
            late.iter().for_each(|f| st.add_known_delta(&f.id));
            self.store.save_state(&st).await?;
        }
        st.synced_seq = Some(self.store.max_seq().await?);
        st.last_ok = iso_from_ms(self.clock.now_ms());
        self.store.save_state(&st).await?;
        report.clock_skew_ms = self.skew.borrow().skew_ms();
        report.clock_warning_minutes = self.skew.borrow().warning_minutes();
        Ok(report)
    }

    /// Kurzweg beim Schließen: nur das eigene Delta hochladen (kein Ziehen, keine Blobs).
    /// Ohne gültiges Token passiert nichts. Liefert die Zahl hochgeladener Events.
    pub async fn flush_upload(&mut self) -> Result<usize, DriveError> {
        if self.take_token().await.is_err() {
            return Ok(0);
        }
        let mut st = self.store.load_state().await?;
        self.ensure_device_id(&mut st).await?;
        let local_max = self.store.max_seq().await?;
        let uploaded = st.uploaded_seq.unwrap_or(0).min(local_max);
        if local_max <= uploaded {
            return Ok(0);
        }
        self.upload_delta(&mut st, uploaded, local_max).await
    }

    /// Speicheranzeige; ohne gültiges Token `None` (nie Grund für eine Anmeldung).
    pub async fn storage_info(&mut self) -> Result<Option<StorageInfo>, DriveError> {
        if self.take_token().await.is_err() {
            return Ok(None);
        }
        let quota = api::parse_about(&self.call(api::about).await?)?;
        let (mut app_bytes, mut page) = (0.0, None::<String>);
        loop {
            let res = self.call(|t| api::list_sizes(t, page.as_deref())).await?;
            let (sum, next) = api::parse_size_page(&res)?;
            app_bytes += sum;
            match next {
                Some(n) => page = Some(n),
                None => break,
            }
        }
        Ok(Some(StorageInfo { app_bytes, used_bytes: quota.used_bytes, limit_bytes: quota.limit_bytes }))
    }

    /// E-Mail des Kontos (nur Anzeige): Netz- und andere Fehler ergeben `None`, nur 401 ist ein Fehler.
    pub async fn account_email(&mut self) -> Result<Option<String>, DriveError> {
        self.take_token().await?;
        let req = api::user_info(&self.token.borrow());
        match self.http.send(&req).await {
            Ok(res) if res.status == 401 => {
                self.tokens.expired().await;
                Err(DriveError::SessionExpired)
            }
            Ok(res) if res.is_success() => Ok(api::parse_user_email(&res)),
            _ => Ok(None),
        }
    }

    // ---- Schritte ------------------------------------------------------------------

    /// [G4] Snapshot + alle unbekannten Deltas in EINEM Import: Ein zweiter Import sähe die eben
    /// übernommenen Events als eigene ungesyncte Änderungen und meldete Geister-Konflikte.
    async fn pull(
        &mut self,
        st: &mut DriveState,
        files: &[DriveFile],
        uploaded_seq: u64,
        report: &mut SyncReport,
        on_phase: &mut dyn FnMut(Phase),
    ) -> Result<(), DriveError> {
        let remote: Vec<RemoteFile> = files.iter().map(DriveFile::remote).collect();
        let snapshot = newest_file(&remote, &SNAPSHOT_NAMES)
            .and_then(|r| remote.iter().position(|x| std::ptr::eq(x, r)))
            .map(|i| &files[i]);
        let stamp = snapshot.map(DriveFile::stamp);
        let need_snapshot = snapshot.is_some() && st.snapshot_stamp != stamp;
        let deltas = unseen_deltas(files, st);
        if need_snapshot || !deltas.is_empty() {
            on_phase(Phase::Pull { snapshot: need_snapshot, deltas: deltas.len() });
        }
        let wanted: Vec<&DriveFile> = snapshot.filter(|_| need_snapshot).into_iter().chain(&deltas).collect();
        let mut payloads = self.download_all(&wanted).await?.into_iter();
        let snap = if need_snapshot { payloads.next() } else { None };
        let mut events = snap.as_ref().map(payload_events).unwrap_or_default();
        for payload in payloads {
            events.extend(payload_events(&payload));
        }
        // v1-Snapshots tragen ihre Blobs im selben Dokument.
        let blobs = snap.as_ref().map(payload_blobs).unwrap_or_default();
        if !events.is_empty() || !blobs.is_empty() {
            self.import(events, blobs, uploaded_seq, report).await?;
        }
        // „Gelesen“ erst nach erfolgreichem Import: sonst würde ein Paket still übersprungen.
        if need_snapshot {
            st.snapshot_stamp = stamp;
        }
        deltas.iter().for_each(|f| st.add_known_delta(&f.id));
        self.store.save_state(st).await?;
        Ok(())
    }

    /// Unveränderliche Blobs (PDFs, Bilder): fehlende holen, eigene ohne Drive-Kopie hochladen.
    /// Gleiche Inhalte liegen nur einmal in Drive (Dateiname = Hash des Inhalts).
    async fn sync_blobs(
        &mut self,
        st: &mut DriveState,
        files: &[DriveFile],
        report: &mut SyncReport,
        on_phase: &mut dyn FnMut(Phase),
    ) -> Result<(), DriveError> {
        let mut remote_blobs: Vec<&DriveFile> =
            files.iter().filter(|f| matches!(f.kind(), FileKind::Blob { .. })).collect();
        remote_blobs.sort_by(|a, b| b.modified_time.cmp(&a.modified_time));
        let mut remote_hashes: HashSet<String> = remote_blobs.iter().filter_map(|f| blob_file_hash(f)).collect();
        let mut local_order = self.store.blob_ids().await?;
        let mut local: HashSet<String> = local_order.iter().cloned().collect();
        // Abweichung von JS: Alt-Dateien ohne `appProperties.blobId` lud JS bei JEDEM Sync erneut
        // herunter, nur um festzustellen, dass der Blob schon da ist. Der Hash-Cache kennt aber
        // den Dateinamen-Hash jedes lokalen Blobs – damit entfällt der Download.
        let cached_hashes: HashSet<String> =
            st.upload_hashes.iter().filter(|(id, _)| local.contains(*id)).map(|(_, h)| h.hash.clone()).collect();
        let wanted = |id: &str, local: &HashSet<String>| !is_local_only(id) && !local.contains(id);
        let missing: Vec<&DriveFile> = remote_blobs
            .into_iter()
            .filter(|file| match file.app_property("blobId") {
                Some(id) => wanted(id, &local),
                None => !blob_file_hash(file).is_some_and(|h| cached_hashes.contains(&h)),
            })
            .collect();
        // Häppchenweise: Blobs können groß sein, im Speicher liegen höchstens PARALLEL_DOWNLOADS.
        for chunk in missing.chunks(PARALLEL_DOWNLOADS) {
            for payload in self.download_all(chunk).await? {
                let Some(blob) = parse_blob_payload(&payload) else {
                    report.skipped_blob_files += 1;
                    continue;
                };
                // Erneut prüfen: zwei Dateien (Alt-Dateien ohne `blobId`) können denselben Blob tragen.
                if !wanted(&blob.id, &local) {
                    continue;
                }
                self.store.put_blob(&blob.id, LocalBlob { meta: blob.meta, data: blob.data }).await?;
                local.insert(blob.id.clone());
                local_order.push(blob.id);
                report.blobs_downloaded += 1;
            }
        }

        let mut uploads = Vec::new();
        for id in &local_order {
            if is_local_only(id) {
                continue; // [H4] Heft-Verlauf und Start-Checkpoint bleiben auf dem Gerät
            }
            let cached = st.upload_hashes.get(id).cloned();
            if cached.as_ref().is_some_and(|c| remote_hashes.contains(&c.hash)) {
                continue;
            }
            let Some(rec) = self.store.get_blob(id).await? else { continue };
            let content_hash = rec.meta.get("hash").and_then(Value::as_str).unwrap_or("").to_owned();
            let size = rec.data.len() as u64;
            let (raw, hash) = match cached {
                Some(c) if c.content_hash == content_hash && c.size == size => (None, c.hash),
                _ => {
                    let raw = blob_payload(id, &rec.meta, &rec.data);
                    let hash = blob_hash(&raw);
                    st.upload_hashes.insert(id.clone(), UploadHash { content_hash, size, hash: hash.clone() });
                    (Some(raw), hash)
                }
            };
            if !remote_hashes.insert(hash.clone()) {
                continue;
            }
            let raw = raw.unwrap_or_else(|| blob_payload(id, &rec.meta, &rec.data));
            uploads.push((id.clone(), raw, hash));
        }
        if !uploads.is_empty() {
            on_phase(Phase::UploadBlobs(uploads.len()));
        }
        for chunk in uploads.chunks(PARALLEL_UPLOADS) {
            let files: Vec<(String, Vec<u8>)> =
                chunk.iter().map(|(_, raw, hash)| (blob_name(hash), gzip(raw.as_bytes()))).collect();
            let ups: Vec<Upload<'_>> = chunk
                .iter()
                .zip(&files)
                .map(|((id, _, hash), (name, bytes))| Upload {
                    name,
                    file_id: None,
                    encoding: Encoding::Gzip,
                    properties: vec![("hash", hash.clone()), ("blobId", id.clone())],
                    bytes,
                })
                .collect();
            let results = join_all(ups.iter().map(|up| self.send_upload(up))).await;
            // Erst alle Erfolge in den Index, dann den ersten Fehler melden.
            let mut first_err = None;
            for res in results {
                match res {
                    Ok(file) => {
                        index_put(st, file);
                        report.blobs_uploaded += 1;
                    }
                    Err(e) => {
                        first_err.get_or_insert(e);
                    }
                }
            }
            if let Some(e) = first_err {
                return Err(e);
            }
        }
        self.store.save_state(st).await.map_err(DriveError::from)
    }

    /// Token-Kopien aus Drive entfernen: Snapshot ohne Geheimnisse ersetzt alles Bisherige.
    async fn scrub(&mut self, st: &mut DriveState, files: &[DriveFile]) -> Result<(), DriveError> {
        let text = self.store.export_snapshot(true, &self.now_iso()).await?;
        let created =
            self.upload_snapshot(st, files, &text, vec![("protocol", "2".into()), ("redacted", "1".into())]).await?;
        let old: Vec<&DriveFile> =
            files.iter().filter(|f| matches!(f.kind(), FileKind::Delta | FileKind::V1Snapshot)).collect();
        // Abweichung von JS: JS vergaß ALLE gelesenen Delta-IDs; hier nur die gelöschten –
        // ein Delta, dessen Löschen scheiterte, wird so nicht erneut geladen.
        self.delete_all(st, &old).await;
        st.uploaded_seq = Some(self.store.max_seq().await?);
        st.snapshot_stamp = Some(created.stamp());
        st.secret_scrub = false;
        self.store.save_state(st).await.map_err(DriveError::from)
    }

    /// Viele Deltas zu einem Snapshot verdichten. Gelöscht wird nur die zu Beginn gelistete (schon
    /// eingespielte) Menge – Deltas, die parallel hinzukamen, bleiben.
    async fn compact(
        &mut self,
        st: &mut DriveState,
        files: &[DriveFile],
        listed: &[&DriveFile],
    ) -> Result<(), DriveError> {
        let text = self.store.export_snapshot(!self.options.allow_secrets, &self.now_iso()).await?;
        let created = self.upload_snapshot(st, files, &text, vec![("protocol", "2".into())]).await?;
        self.delete_all(st, listed).await;
        // [A7] Den eigenen Snapshot nicht wieder herunterladen.
        st.snapshot_stamp = Some(created.stamp());
        self.store.save_state(st).await.map_err(DriveError::from)
    }

    async fn upload_snapshot(
        &mut self,
        st: &mut DriveState,
        files: &[DriveFile],
        text: &str,
        properties: Vec<(&'static str, String)>,
    ) -> Result<DriveFile, DriveError> {
        let old = files.iter().find(|f| f.name == SNAPSHOT_NAME).map(|f| f.id.clone());
        let bytes = gzip(text.as_bytes());
        let up = Upload {
            name: SNAPSHOT_NAME,
            file_id: old.as_deref(),
            encoding: Encoding::Gzip,
            properties,
            bytes: &bytes,
        };
        self.upload(st, &up).await
    }

    /// Eigene Events `from < seq <= to` als ein Paket. Rückt den Wasserstand auch dann vor, wenn
    /// nichts übrig blieb (nur Drive-Echos oder UI-Zustand).
    async fn upload_delta(&mut self, st: &mut DriveState, from: u64, to: u64) -> Result<usize, DriveError> {
        let allow = self.options.allow_secrets;
        let events: Vec<Value> = self
            .store
            .events_between(from, to)
            .await?
            .into_iter()
            .filter(|ev| should_upload_to(ev, Transport::Drive))
            .filter_map(|ev| match ev {
                Value::Object(o) if allow => Some(o),
                Value::Object(o) => redact_secrets(o),
                _ => None,
            })
            .map(Value::Object)
            .collect();
        // Abweichung von JS: JS lud die gerätelokalen Marken (`seq`, `_remote`, `_remoteSource`,
        // `_derived`) mit hoch. Empfänger ersetzen sie ohnehin; hier fallen sie wie bei Cloudflare weg.
        let events: Vec<Value> = prune_for_upload(events)
            .into_iter()
            .filter_map(|ev| ev.as_object().cloned())
            .map(strip_local_flags)
            .map(Value::Object)
            .collect();
        let count = events.len();
        if count > 0 {
            let text = delta_payload(events, &self.now_iso());
            let bytes = gzip(text.as_bytes());
            let name = delta_name(&st.device_id, from + 1, to);
            let up = Upload {
                name: &name,
                file_id: None,
                encoding: Encoding::Gzip,
                properties: delta_properties(&st.device_id, from + 1, to),
                bytes: &bytes,
            };
            let created = self.upload(st, &up).await?;
            st.add_known_delta(&created.id); // [F5] sonst lädt der nächste Sync das eigene Paket
        }
        st.uploaded_seq = Some(to);
        self.store.save_state(st).await?;
        Ok(count)
    }

    async fn import(
        &mut self,
        events: Vec<Value>,
        blobs: Map<String, Value>,
        unsynced_after_seq: u64,
        report: &mut SyncReport,
    ) -> Result<(), DriveError> {
        let payload = import_payload(events, blobs, &self.now_iso());
        let out = self.store.import(payload, unsynced_after_seq, self.options.allow_secrets).await?;
        report.imported += out.added;
        report.conflicts.extend(out.conflicts);
        report.merged.extend(out.merged);
        report.imported_events.extend(out.imported);
        Ok(())
    }

    // ---- Dateiliste ------------------------------------------------------------------

    /// Dateien des App-Ordners: über den lokalen Index + Changes-API, beim ersten Mal (oder
    /// abgelaufenem Token) einmal voll gelistet.
    async fn list_sync_files(&mut self, st: &mut DriveState) -> Result<Vec<DriveFile>, DriveError> {
        if let Some(mut idx) = st.index.clone() {
            match self.apply_changes(&mut idx).await {
                Ok(()) => {
                    let files = idx.files.clone();
                    st.index = Some(idx);
                    self.store.save_state(st).await?;
                    return Ok(files);
                }
                Err(e) if e.is_stale_token() => {
                    st.index = None;
                    self.store.save_state(st).await?;
                }
                Err(e) => return Err(e),
            }
        }
        // Token VOR dem Listing: Änderungen in der Lücke kommen höchstens doppelt (harmlos).
        let token = api::parse_start_page_token(&self.call(api::start_page_token).await?)?;
        let mut files = Vec::new();
        let mut page: Option<String> = None;
        loop {
            let res = self.call(|t| api::list_files(t, page.as_deref())).await?;
            let p = api::parse_file_page(&res)?;
            files.extend(p.files);
            match p.next_page_token {
                Some(n) => page = Some(n),
                None => break,
            }
        }
        let mut idx = FileIndex { token, files: Vec::new() };
        files.iter().cloned().for_each(|f| idx.put(f));
        st.index = Some(idx);
        self.store.save_state(st).await?;
        Ok(files)
    }

    async fn apply_changes(&mut self, idx: &mut FileIndex) -> Result<(), DriveError> {
        let mut page = idx.token.clone();
        loop {
            let res = self.call(|t| api::list_changes(t, &page)).await?;
            let p = api::parse_change_page(&res)?;
            for ch in p.changes {
                match ch {
                    Change::Removed(id) => idx.remove(&id),
                    Change::Upsert(f) => idx.put(f),
                }
            }
            if let Some(next) = p.new_start_page_token {
                idx.token = next;
                return Ok(());
            }
            page = p.next_page_token.ok_or_else(|| {
                DriveError::BadResponse("changes.list lieferte weder nextPageToken noch newStartPageToken.".into())
            })?;
        }
    }

    // ---- Dateien ---------------------------------------------------------------------

    async fn download(&self, file: &DriveFile) -> Result<Value, DriveError> {
        let res = self.call(|t| api::download(t, &file.id)).await?;
        Ok(decode_json(&res.body, file.encoding())?)
    }

    /// Lädt `files` mit höchstens [`PARALLEL_DOWNLOADS`] gleichzeitigen Anfragen; Ergebnisse in
    /// Eingabereihenfolge.
    async fn download_all(&self, files: &[&DriveFile]) -> Result<Vec<Value>, DriveError> {
        let mut out = Vec::with_capacity(files.len());
        for chunk in files.chunks(PARALLEL_DOWNLOADS) {
            for payload in join_all(chunk.iter().map(|f| self.download(f))).await {
                out.push(payload?);
            }
        }
        Ok(out)
    }

    /// Hochladen und den Index sofort aktuell halten.
    async fn upload(&mut self, st: &mut DriveState, up: &Upload<'_>) -> Result<DriveFile, DriveError> {
        let file = self.send_upload(up).await?;
        index_put(st, file.clone());
        Ok(file)
    }

    /// Großes per resumable Upload, sonst multipart.
    // Abweichung von JS: JS lud alles multipart hoch, auch Snapshots und PDFs über 5 MB.
    async fn send_upload(&self, up: &Upload<'_>) -> Result<DriveFile, DriveError> {
        let res = if up.is_large() {
            let session = api::parse_session_url(&self.call(|t| up.resumable_start(t)).await?)?;
            self.call(|t| up.resumable_put(t, &session)).await?
        } else {
            let boundary = self.boundary();
            self.call(|t| up.multipart(t, &boundary)).await?
        };
        api::parse_uploaded(&res)
    }

    /// Löscht `files` ([`PARALLEL_DOWNLOADS`] gleichzeitig). [A9] Nur tatsächlich Gelöschtes
    /// verschwindet aus Index und gelesenen Deltas; der Rest wird beim nächsten Mal erneut versucht.
    async fn delete_all(&self, st: &mut DriveState, files: &[&DriveFile]) {
        for chunk in files.chunks(PARALLEL_DOWNLOADS) {
            let results = join_all(chunk.iter().map(|f| self.call(|t| api::delete(t, &f.id)))).await;
            for (f, res) in chunk.iter().zip(results) {
                if res.is_ok() {
                    if let Some(idx) = st.index.as_mut() {
                        idx.remove(&f.id);
                    }
                    st.known_deltas.retain(|k| *k != f.id);
                }
            }
        }
    }

    // ---- Anfragen ----------------------------------------------------------------------

    async fn take_token(&mut self) -> Result<(), DriveError> {
        let token = self.tokens.access_token().await.filter(|t| !t.is_empty()).ok_or(DriveError::SessionExpired)?;
        *self.token.get_mut() = token;
        Ok(())
    }

    /// Eine Anfrage mit Token. 401: einmal erneuern lassen, sonst Sitzung abgelaufen.
    /// 429/5xx: bis zu dreimal mit exponentiellem Backoff und Jitter. Jede Antwort mit
    /// `Date`-Header verbessert die Uhren-Drift-Schätzung. Läuft auch gleichzeitig mit anderen
    /// Anfragen desselben Durchgangs (kein `RefCell`-Borrow über ein `await`).
    async fn call(&self, build: impl Fn(&str) -> Request) -> Result<Response, DriveError> {
        let (mut attempt, mut renewed) = (0, false);
        loop {
            let sent = self.token.borrow().clone();
            let req = build(&sent);
            let t0 = self.clock.now_ms();
            let res = self.http.send(&req).await?;
            let t1 = self.clock.now_ms();
            if let Some(server) = res.header("date").and_then(api::http_date_ms) {
                let offset = {
                    let mut skew = self.skew.borrow_mut();
                    skew.observe(t0, t1, server);
                    skew.applied_offset_ms()
                };
                self.clock.set_offset_ms(offset);
            }
            match api::outcome(&res) {
                Outcome::Ok => return Ok(res),
                Outcome::Unauthorized => {
                    if !renewed {
                        renewed = true;
                        // Eine gleichzeitige Anfrage hat das Token schon erneuert: damit wiederholen.
                        if *self.token.borrow() != sent {
                            continue;
                        }
                        if let Some(token) = self.tokens.renew(&sent).await.filter(|t| !t.is_empty()) {
                            *self.token.borrow_mut() = token;
                            continue;
                        }
                    }
                    self.tokens.expired().await;
                    return Err(DriveError::SessionExpired);
                }
                Outcome::Retry if attempt < MAX_RETRIES => {
                    self.clock.sleep_ms(retry_delay_ms(attempt, self.jitter())).await;
                    attempt += 1;
                }
                Outcome::Retry | Outcome::Failed => return Err(api::http_error(&res)),
            }
        }
    }

    fn jitter(&self) -> f64 {
        let mut b = [0u8; 1];
        self.rng.fill(&mut b).map_or(0.0, |()| f64::from(b[0]) / 256.0)
    }

    fn random_hex(&self, n: usize) -> String {
        let mut b = vec![0u8; n];
        let _ = self.rng.fill(&mut b);
        hex_encode(&b)
    }

    fn boundary(&self) -> String {
        format!("impala67{}{}", self.clock.now_ms() as u64, self.random_hex(8))
    }

    /// Zeitstempel für `exportedAt` (mit Uhr-Korrektur wie `U.now()`).
    fn now_iso(&self) -> String {
        iso_from_ms(self.clock.now_ms() - self.skew.borrow().applied_offset_ms()).unwrap_or_default()
    }

    async fn ensure_device_id(&mut self, st: &mut DriveState) -> Result<(), DriveError> {
        if st.device_id.is_empty() {
            let h = self.random_hex(16);
            // UUID v4 wie `crypto.randomUUID()`.
            let variant = ['8', '9', 'a', 'b'][usize::from(h.as_bytes()[16] % 4)];
            st.device_id =
                format!("{}-{}-4{}-{}{}-{}", &h[0..8], &h[8..12], &h[13..16], variant, &h[17..20], &h[20..32]);
            self.store.save_state(st).await?;
        }
        Ok(())
    }
}

fn index_put(st: &mut DriveState, file: DriveFile) {
    if let Some(idx) = st.index.as_mut() {
        idx.put(file);
    }
}

/// Heft-Verlauf und Start-Checkpoint sind gerätelokal und gehen nie nach Drive.
pub fn is_local_only(blob_id: &str) -> bool {
    blob_id.starts_with("heftver:") || is_checkpoint_key(blob_id)
}

fn blob_file_hash(f: &DriveFile) -> Option<String> {
    match f.kind() {
        FileKind::Blob { hash } => Some(hash.to_owned()),
        _ => None,
    }
    .filter(|_| f.name.starts_with(BLOB_PREFIX))
}

/// Delta-Dateien, die noch nicht eingespielt sind (Reihenfolge der Liste).
fn unseen_deltas(files: &[DriveFile], st: &DriveState) -> Vec<DriveFile> {
    let deltas: Vec<&DriveFile> = files.iter().filter(|f| f.kind() == FileKind::Delta).collect();
    let remote: Vec<RemoteFile> = deltas.iter().map(|f| f.remote()).collect();
    let known: HashSet<String> = st.known_deltas.iter().cloned().collect();
    let unseen: HashSet<&str> = unseen_remote_files(&remote, &known).into_iter().map(|r| r.id.as_str()).collect();
    deltas.into_iter().filter(|f| unseen.contains(f.id.as_str())).cloned().collect()
}
