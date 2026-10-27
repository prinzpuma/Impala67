//! Ein Sync-Durchgang mit dem Cloudflare-Worker (`web/sync-cloudflare.js` ohne Timer/UI):
//! Abrufen → Dateien abgleichen → Senden → ggf. bestätigender Abruf. Netz über
//! [`HttpClient`], lokale Daten über [`SyncStore`] – beides asynchron und von der Plattform
//! ausgeführt (Browser: `fetch`/IndexedDB), der Kern selbst macht keine Ein-/Ausgabe. Wann ein Durchgang läuft (Timer, WebSocket,
//! online/offline), entscheidet die Plattform; [`SyncClient::handle_server_message`] sagt ihr,
//! was eine WebSocket-Nachricht verlangt.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use impala_crypto::json::stringify;
use impala_crypto::{
    CipherKey, OsRandom, Random, StorageUsage, SyncCredentials, decrypt_blob, encrypt_blob, format_storage_usage,
};
use impala_net::HttpClient;
use serde_json::{Map, Value};

use crate::SyncError;
use crate::api::{self, Endpoint, MAX_BLOB_BYTES, PAGE_LIMIT, PullResponse, ServerMessage};
use crate::blobs::{BlobAliveChecker, blob_opaque_key, blob_refs_in_event, is_sync_blob_id};
use crate::js::{compact_values, count_or, truthy};
use crate::packet::{ChunkLimits, WireEvent, build_packets, open_packets, upload_bodies};
use crate::wire::{Transport, prepare_cloud_events, prune_for_upload, should_upload_to};

/// Dauerhafter Sync-Zustand je Konto (JS: `localStorage`, Schlüssel mit User-ID).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SyncState {
    /// Höchste vom Server übernommene Paket-`seq`.
    pub last_synced_seq: u64,
    /// Höchste lokale Event-`seq`, die hochgeladen (bzw. als nicht nötig erkannt) ist.
    pub last_uploaded_seq: u64,
    /// Generation des Servers; ein Wechsel setzt beide Cursor zurück.
    pub generation: u64,
    /// Verworfene (verwaiste) Server-Blobs: Server-Schlüssel → Blob-ID. Überdauert Neustarts,
    /// damit sie nicht bei jedem Start neu geladen und entschlüsselt werden.
    pub ignored_blobs: BTreeMap<String, String>,
}

/// Lokaler Blob.
#[derive(Debug, Clone, PartialEq)]
pub struct LocalBlob {
    pub meta: Value,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoreError(pub String);

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<StoreError> for SyncError {
    fn from(e: StoreError) -> Self {
        SyncError::Store(e.0)
    }
}

/// Lokale Ablage, wie der Sync sie braucht (Web: IndexedDB, nativ: SQLite). Lese- und
/// Schreibzugriffe sind asynchron; die App-Regeln (`filter_for_upload`, `pages`) rechnen nur.
#[allow(async_fn_in_trait)]
pub trait SyncStore {
    async fn load_state(&self) -> SyncState;
    async fn save_state(&mut self, state: &SyncState) -> Result<(), StoreError>;
    /// Höchste lokale Event-`seq` (Wasserstand für den Upload-Cursor).
    async fn max_seq(&self) -> Result<u64, StoreError>;
    /// Lokale Events mit `after_seq < seq <= up_to_seq`, nach `seq` geordnet, samt `seq`.
    async fn events_after(&self, after_seq: u64, up_to_seq: u64) -> Result<Vec<Value>, StoreError>;
    /// App-Regeln vor dem Upload: Geheimnisse entfernen, lokale Seiten auslassen
    /// (`SETTINGS_SYNC.sanitizeEvents`, `DB.filterEventsForSync`). Darf Events weglassen.
    fn filter_for_upload(&self, events: Vec<Value>) -> Vec<Value> {
        events
    }
    /// Fremdevents übernehmen (Merge mit unbestätigten lokalen Änderungen nach `unsynced_after_seq`).
    /// Jedes Event bekommt einen neuen lokalen Schlüssel; `_remote`/`_remoteSource` sind gesetzt.
    async fn import_remote(&mut self, events: Vec<Value>, unsynced_after_seq: u64) -> Result<(), StoreError>;
    /// Seiten (ID → Seite) für die Prüfung, welche Blobs noch verwendet werden.
    fn pages(&self) -> Map<String, Value>;
    async fn blob_ids(&self) -> Result<Vec<String>, StoreError>;
    async fn get_blob(&self, id: &str) -> Result<Option<LocalBlob>, StoreError>;
    async fn put_blob(&mut self, id: &str, blob: LocalBlob) -> Result<(), StoreError>;
}

/// Fortschritt für die Anzeige.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Progress {
    pub label: &'static str,
    pub current: u64,
    pub total: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PushReport {
    pub uploaded: bool,
    /// Server-Bestätigung schloss lückenlos an; sonst folgt ein bestätigender Abruf.
    pub confirmed: bool,
    pub events: usize,
    pub packets: usize,
    /// Kompaktierung beim vollen Upload übersprungen (Event-Form nur in JS bekannt) – dann
    /// ging das ganze Log hoch.
    pub compaction_skipped: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BlobReport {
    pub uploaded: usize,
    pub downloaded: usize,
    /// Verwaiste Server-Blobs, die nicht übernommen wurden.
    pub ignored: usize,
    /// Dateien über dem Server-Limit (Name bzw. ID): bleiben lokal, die Plattform meldet sie.
    pub oversized: Vec<String>,
}

impl BlobReport {
    pub fn changed(&self) -> bool {
        self.uploaded > 0 || self.downloaded > 0
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PassReport {
    pub received: usize,
    pub blobs: Option<BlobReport>,
    pub push: PushReport,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CompactReport {
    pub before: f64,
    pub after: f64,
    pub reclaimed: f64,
    pub pass: PassReport,
}

/// Was die Plattform nach einer WebSocket-Nachricht tun soll.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WsAction {
    Nothing,
    /// Durchgang anstoßen; `force_all` nach einem fremden Generationsschnitt.
    Sync {
        force_all: bool,
    },
    /// Abgewiesen: Fehler anzeigen, Verbindung schließen.
    Rejected(String),
}

/// Sync-Client für ein Konto. Neue Zugangsdaten = neuer Client.
pub struct SyncClient<H, S> {
    http: H,
    store: S,
    endpoint: Endpoint,
    key: CipherKey,
    rng: Box<dyn Random>,
    limits: ChunkLimits,
    state: SyncState,
    usage: StorageUsage,
    blobs_dirty: bool,
    /// Gerade hochgeladene Event-IDs (als JSON-Text): Ihr Echo im bestätigenden Abruf wird
    /// nicht erneut importiert.
    pending_uploaded: HashSet<String>,
    /// IDs aller in dieser Generation abgerufenen Events: Sie liegen schon auf dem Server.
    received_ids: HashSet<String>,
    /// Abgeglichene Blob-IDs; nur Verweise außerhalb machen einen neuen Abgleich nötig.
    synced_blob_ids: HashSet<String>,
    pending_blob_refs: HashSet<String>,
    oversized: HashSet<String>,
    opaque_keys: HashMap<String, String>,
    stop: Arc<AtomicBool>,
    progress: Option<Box<dyn FnMut(Progress)>>,
}

impl<H: HttpClient, S: SyncStore> SyncClient<H, S> {
    pub async fn new(http: H, store: S, base_url: &str, creds: &SyncCredentials, client_id: &str) -> Self {
        let state = store.load_state().await;
        SyncClient {
            http,
            endpoint: Endpoint::new(base_url, creds, client_id),
            key: creds.key.clone(),
            store,
            rng: Box::new(OsRandom),
            limits: ChunkLimits::default(),
            state,
            usage: format_storage_usage(0.0, None),
            blobs_dirty: true,
            pending_uploaded: HashSet::new(),
            received_ids: HashSet::new(),
            synced_blob_ids: HashSet::new(),
            pending_blob_refs: HashSet::new(),
            oversized: HashSet::new(),
            opaque_keys: HashMap::new(),
            stop: Arc::new(AtomicBool::new(false)),
            progress: None,
        }
    }

    /// Andere Zufallsquelle (Tests).
    pub fn with_rng(mut self, rng: Box<dyn Random>) -> Self {
        self.rng = rng;
        self
    }

    pub fn with_chunk_limits(mut self, limits: ChunkLimits) -> Self {
        self.limits = limits;
        self
    }

    pub fn on_progress(&mut self, f: impl FnMut(Progress) + 'static) {
        self.progress = Some(Box::new(f));
    }

    /// Gesetzt: Der laufende Durchgang endet an der nächsten Etappe mit [`SyncError::Stopped`].
    pub fn stop_flag(&self) -> Arc<AtomicBool> {
        self.stop.clone()
    }

    pub fn state(&self) -> &SyncState {
        &self.state
    }

    pub fn usage(&self) -> &StorageUsage {
        &self.usage
    }

    pub fn endpoint(&self) -> &Endpoint {
        &self.endpoint
    }

    pub fn store(&self) -> &S {
        &self.store
    }

    pub fn store_mut(&mut self) -> &mut S {
        &mut self.store
    }

    fn check_stop(&self) -> Result<(), SyncError> {
        if self.stop.load(Ordering::Relaxed) { Err(SyncError::Stopped) } else { Ok(()) }
    }

    fn report(&mut self, label: &'static str, current: u64, total: u64) {
        if let Some(f) = self.progress.as_mut() {
            f(Progress { label, current: current.min(total), total });
        }
    }

    async fn save(&mut self) -> Result<(), SyncError> {
        Ok(self.store.save_state(&self.state).await?)
    }

    async fn clear_cursors(&mut self, generation: u64) -> Result<(), SyncError> {
        self.pending_uploaded.clear();
        self.received_ids.clear();
        self.state.last_synced_seq = 0;
        self.state.last_uploaded_seq = 0;
        self.state.generation = generation;
        self.save().await
    }

    fn forget_blob_inventory(&mut self) {
        self.opaque_keys.clear();
        self.state.ignored_blobs.clear();
        self.synced_blob_ids.clear();
        self.pending_blob_refs.clear();
        self.blobs_dirty = true;
    }

    fn opaque_key(&mut self, id: &str) -> String {
        self.opaque_keys.entry(id.to_owned()).or_insert_with(|| blob_opaque_key(id)).clone()
    }

    fn wire_events(&self, events: Vec<Value>, include_remote: bool) -> Vec<Value> {
        wire_events(&self.store, events, include_remote)
    }

    /// Ginge dieses lokale Event zu Cloudflare? Reine UI-Events brauchen keinen Durchgang.
    pub fn is_uploadable(&self, ev: &Value) -> bool {
        is_uploadable(&self.store, ev)
    }

    /// Nach jedem lokalen Event: `true`, wenn ein Durchgang nötig ist. Bringt das Event einen
    /// noch nicht abgeglichenen Datei-Verweis mit, gleicht der nächste Durchgang Dateien ab.
    pub fn note_local_event(&mut self, ev: &Value) -> bool {
        if !self.is_uploadable(ev) {
            return false;
        }
        for id in blob_refs_in_event(ev) {
            if !self.synced_blob_ids.contains(&id) {
                self.pending_blob_refs.insert(id);
                self.blobs_dirty = true;
            }
        }
        true
    }

    /// Wertet eine WebSocket-Nachricht aus (Generationswechsel übernimmt der Client selbst).
    pub async fn handle_server_message(&mut self, text: &str) -> Result<WsAction, SyncError> {
        Ok(match api::parse_server_message(text, self.endpoint.client_id())? {
            ServerMessage::Authenticated { generation } => {
                if let Some(g) = generation.filter(|g| *g != self.state.generation) {
                    self.clear_cursors(g).await?;
                }
                WsAction::Sync { force_all: false }
            }
            ServerMessage::Changed { from_self: true, .. } => WsAction::Nothing,
            ServerMessage::Changed { max_seq, blob, .. } => {
                // Nichts Neues an Paketen → es waren Dateien.
                if blob || max_seq <= self.state.last_synced_seq as f64 {
                    self.blobs_dirty = true;
                }
                WsAction::Sync { force_all: false }
            }
            ServerMessage::Reset { generation } if generation != self.state.generation => {
                self.clear_cursors(generation).await?;
                WsAction::Sync { force_all: true }
            }
            ServerMessage::Reset { .. } | ServerMessage::Other => WsAction::Nothing,
            ServerMessage::Rejected(message) => WsAction::Rejected(message),
        })
    }

    /// Ein Durchgang wie `requestSync`; volle Quota löst einmal eine Cloud-Kompaktierung aus.
    pub async fn sync(&mut self, force_all: bool) -> Result<PassReport, SyncError> {
        match self.run_pass(force_all).await {
            Err(e) if e.is_quota() => self.compact_cloud(true).await.map(|r| r.pass).map_err(|_| e),
            other => other,
        }
    }

    /// Abrufen → (bei Bedarf) Dateien → Senden → bestätigender Abruf, falls die Bestätigung
    /// nicht lückenlos war.
    pub async fn run_pass(&mut self, force_all: bool) -> Result<PassReport, SyncError> {
        let received = self.pull().await?;
        self.check_stop()?;
        let mut blobs = None;
        if self.blobs_dirty || received > 0 {
            // Vorher zurücksetzen: Ein währenddessen eingefügtes Bild setzt es erneut.
            self.blobs_dirty = false;
            match self.sync_blobs().await {
                Ok(r) => blobs = Some(r),
                Err(e) => {
                    self.blobs_dirty = true;
                    return Err(e);
                }
            }
        }
        self.check_stop()?;
        let push = self.push(force_all).await?;
        if push.uploaded && !push.confirmed {
            self.pull().await?;
        }
        if push.uploaded {
            self.pending_uploaded.clear();
        }
        Ok(PassReport { received, blobs, push })
    }

    /// Holt alle neuen Pakete. Liefert die Zahl übernommener Events.
    pub async fn pull(&mut self) -> Result<usize, SyncError> {
        let (mut received, progress_start) = (0, self.state.last_synced_seq);
        // Höchstens EINE automatische Reparatur je Abruf: Meldet der Server danach weiter 410,
        // würde die Cloud sonst endlos geleert.
        let mut repaired = false;
        loop {
            self.check_stop()?;
            let since = self.state.last_synced_seq;
            let res = self.http.send(&self.endpoint.pull(since, PAGE_LIMIT)).await?;
            let page = match api::parse_pull(&res)? {
                PullResponse::Page(page) => page,
                PullResponse::PacketMissing { .. } if repaired => {
                    return Err(api::response_error(&res, "Abruf vom Cloudflare-Server fehlgeschlagen"));
                }
                PullResponse::PacketMissing { generation } => {
                    // Ein anderes Gerät baut die Cloud gerade neu auf: dessen Generation übernehmen.
                    if let Some(g) = generation.filter(|g| *g != self.state.generation) {
                        self.clear_cursors(g).await?;
                        continue;
                    }
                    self.reset_cloud().await?;
                    repaired = true;
                    continue;
                }
            };
            if page.generation != self.state.generation || page.max_seq < since as f64 {
                self.clear_cursors(page.generation).await?;
                continue;
            }
            let max_seq = page.max_seq.max(since as f64) as u64;
            if max_seq > progress_start {
                self.report("Empfange Notizen…", since - progress_start, max_seq - progress_start);
            }
            if page.packets.is_empty() {
                if let Some(usage) = page.usage {
                    self.usage = usage;
                }
                return Ok(received);
            }
            let (events, last_seq) = open_packets(&self.key, &page.packets, since)?;
            received += events.len();
            self.received_ids.extend(events.iter().filter_map(id_key));
            self.import_remote(events).await?;
            self.state.last_synced_seq = last_seq;
            self.save().await?;
            if max_seq > progress_start {
                self.report("Empfange Notizen…", last_seq - progress_start, max_seq - progress_start);
            }
            if let Some(usage) = page.usage {
                self.usage = usage;
            }
            if !page.has_more {
                return Ok(received);
            }
        }
    }

    /// Übernimmt Fremdevents. Ein Server-Echo eigener, gerade hochgeladener Events wird
    /// übersprungen; bestätigte lokale Events setzen den Upload-Cursor vor – nur lückenlos ab
    /// dem bisherigen Stand, beim ersten unbestätigten hochladepflichtigen Event ist Schluss.
    async fn import_remote(&mut self, events: Vec<Value>) -> Result<(), SyncError> {
        let candidates: Vec<Value> =
            events.into_iter().filter(|ev| id_key(ev).is_none_or(|k| !self.pending_uploaded.remove(&k))).collect();
        if candidates.is_empty() {
            return Ok(());
        }
        let unconfirmed = self.store.events_after(self.state.last_uploaded_seq, u64::MAX).await?;
        let server_ids: HashSet<String> = candidates.iter().filter_map(id_key).collect();
        let mut confirmed = self.state.last_uploaded_seq;
        for ev in &unconfirmed {
            let seq = count_or(ev.get("seq"), 0);
            if seq <= confirmed {
                continue;
            }
            if !self.is_uploadable(ev) || id_key(ev).is_some_and(|k| server_ids.contains(&k)) {
                confirmed = seq;
            } else {
                break;
            }
        }
        if confirmed > self.state.last_uploaded_seq {
            self.state.last_uploaded_seq = confirmed;
            self.save().await?;
        }
        Ok(self.store.import_remote(candidates, self.state.last_uploaded_seq).await?)
    }

    /// Lädt lokale Änderungen hoch. Nach einem Generationsschnitt (Cursor 0) oder mit
    /// `force_all` geht das ganze, kompaktierte Log hoch, in begrenzten Paketen.
    pub async fn push(&mut self, force_all: bool) -> Result<PushReport, SyncError> {
        let max_seq = self.store.max_seq().await?;
        let mut uploaded = self.state.last_uploaded_seq;
        if force_all || uploaded > max_seq {
            uploaded = 0;
        }
        let mut report = PushReport { confirmed: true, ..PushReport::default() };
        let local = if max_seq <= uploaded { Vec::new() } else { self.store.events_after(uploaded, max_seq).await? };
        let full = uploaded == 0;
        let source = if full {
            let compacted = match compact_values(&local) {
                Ok(keep) => pick(local, &keep),
                Err(e) => {
                    report.compaction_skipped = Some(e.0);
                    local
                }
            };
            // Abweichung von JS: Dort ging beim vollen Upload auch alles gerade Abgerufene erneut
            // hoch (anders gebündelt, also nicht vom Server dedupliziert) – der erste Sync eines
            // neuen Geräts verdoppelte so die Cloud. Was in dieser Generation abgerufen wurde,
            // liegt schon dort.
            compacted.into_iter().filter(|ev| id_key(ev).is_none_or(|k| !self.received_ids.contains(&k))).collect()
        } else {
            local.into_iter().filter(|ev| should_upload_to(ev, Transport::Cloudflare)).collect()
        };
        let wire: Vec<WireEvent> = self.wire_events(source, full).into_iter().map(WireEvent::new).collect();
        if wire.is_empty() {
            self.state.last_uploaded_seq = max_seq;
            self.save().await?;
            return Ok(report);
        }

        self.report("Bereite Notizen vor…", 0, 1);
        let packets = build_packets(&wire, self.limits, &self.key, self.rng.as_ref())?;
        let bodies = upload_bodies(&packets);
        let total: u64 = bodies.iter().map(|b| b.len() as u64).sum();
        let mut done = 0;
        self.report("Übertrage Notizen…", 0, total);
        for body in bodies {
            self.check_stop()?;
            let len = body.len() as u64;
            let res = self.http.send(&self.endpoint.post_events(body)).await?;
            let ack = api::parse_upload(&res, self.state.generation, self.state.last_synced_seq)?;
            match ack.acknowledged_seq {
                None => report.confirmed = false,
                Some(seq) if report.confirmed => {
                    self.state.last_synced_seq = seq;
                    self.save().await?;
                }
                Some(_) => {}
            }
            if let Some(usage) = ack.usage {
                self.usage = usage;
            }
            done += len;
            self.report("Übertrage Notizen…", done, total);
        }
        self.pending_uploaded.extend(wire.iter().filter_map(|ev| id_key(&ev.value)));
        self.state.last_uploaded_seq = max_seq;
        self.save().await?;
        report.uploaded = true;
        report.events = wire.len();
        report.packets = packets.len();
        Ok(report)
    }

    async fn list_remote_blobs(&self) -> Result<Vec<String>, SyncError> {
        let mut keys = Vec::new();
        let mut cursor = String::new();
        loop {
            let res = self.http.send(&self.endpoint.list_blobs(&cursor)).await?;
            let (page, next) = api::parse_blob_list(&res)?;
            keys.extend(page);
            if next.is_empty() {
                return Ok(keys);
            }
            cursor = next;
        }
    }

    /// Gleicht Dateien ab: lebende lokale hoch, fehlende herunter, verwaiste ignorieren.
    pub async fn sync_blobs(&mut self) -> Result<BlobReport, SyncError> {
        let checked_refs: Vec<String> = self.pending_blob_refs.drain().collect();
        let pages = self.store.pages();
        let alive = BlobAliveChecker::new(&pages);
        let local_ids: Vec<String> =
            self.store.blob_ids().await?.into_iter().filter(|id| is_sync_blob_id(id) && alive.is_alive(id)).collect();
        let local: Vec<(String, String)> = local_ids.iter().map(|id| (self.opaque_key(id), id.clone())).collect();
        let local_keys: HashSet<&str> = local.iter().map(|(k, _)| k.as_str()).collect();
        let remote = self.list_remote_blobs().await?;
        let remote_set: HashSet<&str> = remote.iter().map(String::as_str).collect();
        let mut report = BlobReport::default();

        let upload: Vec<&(String, String)> =
            local.iter().filter(|(k, _)| !remote_set.contains(k.as_str()) && !self.oversized.contains(k)).collect();
        for (i, (key, id)) in upload.iter().enumerate() {
            self.report("Übertrage Dateien…", i as u64, upload.len() as u64);
            let Some(blob) = self.store.get_blob(id).await? else { continue };
            let name =
                blob.meta.get("name").filter(|n| truthy(Some(n))).and_then(Value::as_str).unwrap_or(id).to_owned();
            let enc = encrypt_blob(&self.key, id, Some(&blob.meta), &blob.data, self.rng.as_ref())?;
            if enc.bytes.len() > MAX_BLOB_BYTES {
                self.oversized.insert(key.clone());
                report.oversized.push(name);
                continue;
            }
            let res = self.http.send(&self.endpoint.put_blob(key, &enc.iv, enc.bytes)).await?;
            if !res.is_success() {
                let err = api::response_error(&res, &format!("Blob {id} konnte nicht hochgeladen werden"));
                // 413 ohne „Quota“: Datei zu groß für den Server – bleibt lokal, blockiert nichts.
                if err.status() != Some(413) || err.is_quota() {
                    return Err(err);
                }
                self.oversized.insert(key.clone());
                report.oversized.push(name);
                continue;
            }
            if let Some(usage) = api::usage_header(&res) {
                self.usage = usage;
            }
            report.uploaded += 1;
        }

        let ignored_before = self.state.ignored_blobs.len();
        self.state.ignored_blobs.retain(|k, _| remote_set.contains(k.as_str()));
        // Verworfene erst wieder laden, wenn inzwischen eine Seite auf sie verweist.
        let mut revived = Vec::new();
        for (key, id) in &self.state.ignored_blobs {
            if is_sync_blob_id(id) && alive.is_alive(id) {
                revived.push(key.clone());
            }
        }
        for key in &revived {
            self.state.ignored_blobs.remove(key);
        }
        let download: Vec<&String> = remote
            .iter()
            .filter(|k| !local_keys.contains(k.as_str()) && !self.state.ignored_blobs.contains_key(*k))
            .collect();
        let mut downloaded_ids = Vec::new();
        for (i, key) in download.iter().enumerate() {
            self.report("Empfange Dateien…", i as u64, download.len() as u64);
            let res = self.http.send(&self.endpoint.get_blob(key)).await?;
            if !res.is_success() {
                return Err(api::response_error(&res, "Blob konnte nicht geladen werden"));
            }
            let iv = res.header("X-Impala-IV").unwrap_or_default();
            let record = decrypt_blob(&self.key, iv, &res.body)?;
            if self.opaque_key(&record.id) != **key {
                return Err(SyncError::Protocol(
                    "Blob-ID stimmt nach Entschlüsselung nicht mit dem Server-Schlüssel überein.".into(),
                ));
            }
            if !is_sync_blob_id(&record.id) || !alive.is_alive(&record.id) {
                self.state.ignored_blobs.insert((*key).clone(), record.id);
                report.ignored += 1;
                continue;
            }
            self.store.put_blob(&record.id, LocalBlob { meta: record.meta, data: record.data }).await?;
            downloaded_ids.push(record.id);
            report.downloaded += 1;
        }
        if !download.is_empty() || self.state.ignored_blobs.len() != ignored_before {
            self.save().await?;
        }
        self.synced_blob_ids.extend(local_ids.into_iter().chain(downloaded_ids).chain(checked_refs));
        Ok(report)
    }

    /// Generationsschnitt (`purgeCloudData`): löscht alle Pakete und Blobs auf dem Server; der
    /// nächste Durchgang lädt den kompaktierten lokalen Stand und alle lebenden Blobs neu hoch.
    pub async fn reset_cloud(&mut self) -> Result<(), SyncError> {
        let res = self.http.send(&self.endpoint.reset()).await?;
        let generation = api::parse_reset(&res)?;
        self.forget_blob_inventory();
        self.clear_cursors(generation.unwrap_or(self.state.generation + 1)).await
    }

    /// Cloud-Kompaktierung (`compactCloudData`): erst vollständig abgleichen – danach ist der
    /// lokale Stand die sichere Quelle –, dann Generationsschnitt und Neuaufbau.
    /// Ob es Zeit dafür ist, sagt [`crate::should_compact_cloud`].
    pub async fn compact_cloud(&mut self, bypass_cooldown: bool) -> Result<CompactReport, SyncError> {
        if let Err(e) = self.run_pass(false).await
            && !bypass_cooldown
            && e.status() != Some(413)
        {
            return Err(e);
        }
        let before = self.usage.bytes;
        self.reset_cloud().await?;
        let pass = self.run_pass(false).await?;
        let after = self.usage.bytes;
        Ok(CompactReport { before, after, reclaimed: (before - after).max(0.0), pass })
    }
}

/// Ablage-Filter, UI-Zustand weg, ohne lokale Metadaten (und ohne Cloudflare-Echo,
/// außer beim Neuaufbau).
fn wire_events(store: &impl SyncStore, events: Vec<Value>, include_remote: bool) -> Vec<Value> {
    prepare_cloud_events(prune_for_upload(store.filter_for_upload(events)), include_remote)
}

/// [`SyncClient::is_uploadable`] ohne Client – für Plattformen, die während eines laufenden
/// Durchgangs fragen.
pub fn is_uploadable(store: &impl SyncStore, ev: &Value) -> bool {
    ev.is_object() && !wire_events(store, vec![ev.clone()], false).is_empty()
}

/// Event-ID als Mengenschlüssel; der JSON-Text hält `5` und `"5"` auseinander wie JS-`Set`.
fn id_key(ev: &Value) -> Option<String> {
    ev.get("id").filter(|id| truthy(Some(id))).map(stringify)
}

/// Behält die Einträge an `keep` (aufsteigend oder beliebig, ohne Doppelte) in dieser Reihenfolge.
fn pick(events: Vec<Value>, keep: &[usize]) -> Vec<Value> {
    let mut slots: Vec<Option<Value>> = events.into_iter().map(Some).collect();
    keep.iter().filter_map(|&i| slots.get_mut(i).and_then(Option::take)).collect()
}
