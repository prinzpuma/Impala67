//! UniFFI-HÃ¼lle des Kerns fÃ¼r native Apps (Kotlin, Swift, C#). Anders als die WASM-HÃ¼lle hÃ¤lt sie
//! Speicher und Zustand selbst: [`ImpalaCore`] Ã¶ffnet eine SQLite-Datei, lÃ¤dt das Modell daraus,
//! vergibt Event-IDs und Zeitstempel und schreibt jede Ã„nderung, bevor sie angewandt wird.
//! Die Plattform zeichnet nur und ruft grobe Funktionen; Daten wandern als einfache DatensÃ¤tze.

mod ai;
mod ai_tools;
mod card_ops;
mod cards;
mod changes;
mod chats;
mod clock;
mod cloze;
mod conflicts;
mod decks;
mod drive;
mod heft;
mod heft_export;
mod heft_items;
mod heft_library;
mod heft_undo;
mod markdown;
mod pages;
mod rag;
mod study_records;
mod sync;

use std::fmt;
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex, MutexGuard};

use impala_model::search::NoteSearch;
use impala_model::{CheckpointSave, Model, Page};
use impala_storage::{ExportOptions, ImportOptions, SqliteStorage, Storage, StorageExt};
use serde_json::{Value, json};

use crate::changes::{ChangeListener, Changes};
use crate::clock::Clock;

uniffi::setup_scaffolding!();

#[derive(Debug, uniffi::Error)]
pub enum CoreError {
    /// Lesen/Schreiben der Datenbank ist fehlgeschlagen (auch: Schema einer neueren App-Version).
    Storage { reason: String },
    /// UngÃ¼ltige Eingabe der Plattform (kaputtes JSON, unbekannte Seite â€¦).
    Invalid { reason: String },
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            CoreError::Storage { reason: message } | CoreError::Invalid { reason: message } => f.write_str(message),
        }
    }
}

impl std::error::Error for CoreError {}

impl From<impala_storage::Error> for CoreError {
    fn from(e: impala_storage::Error) -> Self {
        CoreError::Storage { reason: e.to_string() }
    }
}

fn invalid(message: impl Into<String>) -> CoreError {
    CoreError::Invalid { reason: message.into() }
}

/// Wie der Start verlief (Diagnose).
#[derive(Debug, Clone, uniffi::Record)]
pub struct LoadInfo {
    pub event_count: u64,
    pub max_seq: u64,
    /// Nach dem Checkpoint (oder voll) abgespielte Events.
    pub replayed: u64,
    pub checkpoint_used: bool,
    /// Warum der Checkpoint nicht taugte (`missing`, `older-tail` â€¦).
    pub checkpoint_reject: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum PageKind {
    /// Getippte Notiz (Markdown).
    Note,
    /// Handschrift-Heft.
    Heft,
}

/// Seite ohne Inhalt: Listen, Seitenbaum, Brotkrumen.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct PageSummary {
    pub id: String,
    pub title: String,
    pub parent_id: Option<String>,
    pub workspace_id: String,
    pub kind: PageKind,
    /// Emoji vor dem Titel, leer ohne.
    pub icon: String,
    /// Angeheftet (Startseite, Seitenleiste).
    pub favorite: bool,
    /// Cover (Farbe/Verlauf/Muster wie in der PWA), leer ohne.
    pub cover: String,
    /// Schlagwörter der Seite.
    pub tags: Vec<String>,
    /// Blob-ID des PDFs bei PDF-Seiten (Bibliothek).
    pub pdf_id: Option<String>,
    pub created: String,
    pub updated: String,
}

/// Seite samt Markdown-Inhalt.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct PageDetail {
    pub summary: PageSummary,
    pub content: String,
    pub trashed: bool,
    pub archived: bool,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct WorkspaceInfo {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct SearchHit {
    pub page_id: String,
    pub title: String,
    pub snippet: String,
    pub score: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum CheckpointResult {
    Written,
    /// Nichts Neues seit dem letzten Checkpoint.
    Unchanged,
    /// Fremd-Events kamen auÃŸer Reihenfolge: erst der nÃ¤chste Start schreibt wieder.
    OutOfOrder,
    /// Im Log liegen noch nicht angewandte Events: spÃ¤ter erneut versuchen.
    Stale,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FileData {
    pub bytes: Vec<u8>,
    /// MIME-Typ, leer wenn unbekannt.
    pub mime: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ImportSummary {
    pub added: u64,
    pub malformed: u64,
    pub bad_blobs: u64,
}

fn summary(pg: &Page) -> PageSummary {
    PageSummary {
        id: pg.id().to_owned(),
        title: pg.title().to_owned(),
        parent_id: pg.parent().map(str::to_owned),
        workspace_id: pg.workspace().to_owned(),
        kind: if pg.is_heft() { PageKind::Heft } else { PageKind::Note },
        icon: pg.extra.get("icon").and_then(Value::as_str).unwrap_or("").to_owned(),
        favorite: pg.extra.get("favorite").is_some_and(|v| v.as_bool().unwrap_or(false)),
        cover: pg.extra.get("cover").and_then(Value::as_str).unwrap_or("").to_owned(),
        tags: pg.extra.get("tags").and_then(Value::as_array).map_or_else(Vec::new, |t| {
            t.iter().filter_map(Value::as_str).map(str::to_owned).collect()
        }),
        pdf_id: pg.extra.get("pdfId").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_owned),
        created: pg.created_at().to_owned(),
        updated: pg.updated().to_owned(),
    }
}

fn summaries(pages: Vec<&Page>) -> Vec<PageSummary> {
    pages.into_iter().map(summary).collect()
}

struct Inner {
    storage: SqliteStorage,
    model: Model,
    search: NoteSearch,
    clock: Clock,
    load: LoadInfo,
    /// Verbundener Sync (ID, Befehlskanal): erfÃ¤hrt jedes lokale Event.
    sync_tx: Option<(u64, Sender<sync::Cmd>)>,
    listener: Option<Arc<dyn ChangeListener>>,
    /// Noch nicht gemeldete Ã„nderungen ([`changes::notify`]).
    pending: Changes,
}

/// Zustand, den [`ImpalaCore`] und ein [`sync::CloudSync`] teilen.
type Shared = Arc<Mutex<Inner>>;

fn lock(shared: &Shared) -> MutexGuard<'_, Inner> {
    // Ein Panic in einem frÃ¼heren Aufruf lÃ¤sst den Zustand stehen; weiterarbeiten statt abstÃ¼rzen.
    shared.lock().unwrap_or_else(|e| e.into_inner())
}

/// Meta-SchlÃ¼ssel der GerÃ¤te-ID (Sync-Client-ID, unterdrÃ¼ckt das eigene Echo).
const DEVICE_ID_KEY: &str = "deviceId";

impl Inner {
    fn open(storage: SqliteStorage) -> Result<Inner, CoreError> {
        let load =
            LoadInfo { event_count: 0, max_seq: 0, replayed: 0, checkpoint_used: false, checkpoint_reject: None };
        let mut inner = Inner {
            storage,
            model: Model::new(),
            search: NoteSearch::new(),
            clock: Clock::default(),
            load,
            sync_tx: None,
            listener: None,
            pending: Changes::default(),
        };
        inner.reload()?;
        Ok(inner)
    }

    /// Dauerhafte GerÃ¤te-ID; beim ersten Aufruf angelegt.
    fn device_id(&mut self) -> String {
        if let Ok(Some(id)) = self.storage.meta(DEVICE_ID_KEY) {
            return id;
        }
        let id = uuid::Uuid::new_v4().to_string();
        // Scheitert das Speichern, gilt die ID nur bis zum nÃ¤chsten Start (Echo-UnterdrÃ¼ckung leidet kurz).
        let _ = self.storage.apply(vec![impala_storage::Write::SetMeta(DEVICE_ID_KEY.into(), Some(id.clone()))]);
        id
    }

    /// Zustand aus Checkpoint und Log (neu) laden.
    fn reload(&mut self) -> Result<(), CoreError> {
        let now = self.clock.now();
        let (model, report) = Model::load(&mut self.storage, &now)?;
        self.clock.observe(&report.max_time);
        self.model = model;
        self.search = NoteSearch::new();
        self.load = LoadInfo {
            event_count: report.count,
            max_seq: report.max_seq,
            replayed: report.replayed as u64,
            checkpoint_used: report.checkpoint_used,
            checkpoint_reject: report.reject_reason.map(str::to_owned),
        };
        self.note_everything(false);
        Ok(())
    }

    fn dispatch(&mut self, kind: &str, payload: Value) -> Result<String, CoreError> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = self.clock.now();
        let ev = self.model.dispatch(&mut self.storage, kind, payload, &id, &now)?;
        self.note(&ev, false);
        if let Some((_, tx)) = &self.sync_tx {
            let _ = tx.send(sync::Cmd::Local(Value::Object(ev.to_object())));
        }
        Ok(ev.id)
    }
}

/// Der Kern einer nativen App: eine Datenbank, ein Zustand. Alle Methoden sind threadsicher
/// (intern serialisiert); lange Aufrufe (Ã–ffnen, Import, Export) gehÃ¶ren in einen Hintergrund-Thread.
#[derive(uniffi::Object)]
pub struct ImpalaCore {
    inner: Shared,
}

/// Sperre auf den Zustand; meldet beim Freigeben gesammelte Ã„nderungen ([`changes::notify`]).
struct CoreGuard<'a> {
    guard: Option<MutexGuard<'a, Inner>>,
    shared: &'a Shared,
}

impl std::ops::Deref for CoreGuard<'_> {
    type Target = Inner;
    fn deref(&self) -> &Inner {
        self.guard.as_ref().expect("Sperre")
    }
}

impl std::ops::DerefMut for CoreGuard<'_> {
    fn deref_mut(&mut self) -> &mut Inner {
        self.guard.as_mut().expect("Sperre")
    }
}

impl Drop for CoreGuard<'_> {
    fn drop(&mut self) {
        let pending = self.guard.take().is_some_and(|g| !g.pending.is_empty());
        if pending {
            changes::notify(self.shared);
        }
    }
}

impl ImpalaCore {
    fn new(inner: Inner) -> Arc<Self> {
        Arc::new(ImpalaCore { inner: Arc::new(Mutex::new(inner)) })
    }

    fn lock(&self) -> CoreGuard<'_> {
        CoreGuard { guard: Some(lock(&self.inner)), shared: &self.inner }
    }

    fn shared(&self) -> Shared {
        self.inner.clone()
    }

    /// `pageCreate`; `kind`: `Some("heft")` fÃ¼r ein Heft. Ohne `workspace_id` gilt der der
    /// Elternseite, sonst `default`.
    fn create_page_of_kind(
        &self,
        title: String,
        content: String,
        parent_id: Option<String>,
        workspace_id: Option<String>,
        kind: Option<&str>,
    ) -> Result<String, CoreError> {
        let mut inner = self.lock();
        let parent = parent_id.filter(|p| !p.is_empty());
        if let Some(p) = &parent
            && !inner.model.state().pages.contains_key(p)
        {
            return Err(invalid(format!("Unbekannte Elternseite {p}")));
        }
        let workspace = workspace_id
            .filter(|w| !w.is_empty())
            .or_else(|| {
                parent.as_ref().and_then(|p| inner.model.state().pages.get(p)).map(|p| p.workspace().to_owned())
            })
            .unwrap_or_else(|| "default".to_owned());
        let id = uuid::Uuid::new_v4().to_string();
        let mut payload =
            json!({ "id": id, "title": title, "content": content, "parentId": parent, "workspaceId": workspace });
        if let Some(kind) = kind {
            payload["kind"] = Value::from(kind);
        }
        inner.dispatch("pageCreate", payload)?;
        Ok(id)
    }
}

#[uniffi::export]
impl ImpalaCore {
    /// Ã–ffnet (oder legt an) die Datenbank unter `db_path` und lÃ¤dt den Zustand.
    #[uniffi::constructor]
    pub fn open(db_path: String) -> Result<Arc<Self>, CoreError> {
        Ok(ImpalaCore::new(Inner::open(SqliteStorage::open(&db_path)?)?))
    }

    /// Nur im Speicher (Tests, Vorschau).
    #[uniffi::constructor]
    pub fn open_in_memory() -> Result<Arc<Self>, CoreError> {
        Ok(ImpalaCore::new(Inner::open(SqliteStorage::open_in_memory()?)?))
    }

    pub fn load_info(&self) -> LoadInfo {
        self.lock().load.clone()
    }

    /// Versatz der GerÃ¤teuhr gegen einen Server in ms (positiv = GerÃ¤t geht vor).
    pub fn set_clock_offset(&self, ms: i64) {
        self.lock().clock.set_offset(ms);
    }

    /// Beliebiges Event (`kind` wie im Log, `payload_json` als JSON-Text). Liefert die Event-ID.
    pub fn dispatch(&self, kind: String, payload_json: String) -> Result<String, CoreError> {
        let payload = if payload_json.trim().is_empty() {
            Value::Null
        } else {
            serde_json::from_str(&payload_json).map_err(|e| invalid(format!("Payload: {e}")))?
        };
        self.lock().dispatch(&kind, payload)
    }

    /// Neue Notiz; liefert ihre ID. Ohne `workspace_id` gilt der der Elternseite, sonst `default`.
    pub fn create_page(
        &self,
        title: String,
        content: String,
        parent_id: Option<String>,
        workspace_id: Option<String>,
    ) -> Result<String, CoreError> {
        self.create_page_of_kind(title, content, parent_id, workspace_id, None)
    }

    /// Titel und/oder Inhalt einer Seite Ã¤ndern (`None` = unverÃ¤ndert).
    pub fn update_page(&self, id: String, title: Option<String>, content: Option<String>) -> Result<(), CoreError> {
        let mut inner = self.lock();
        if !inner.model.state().pages.contains_key(&id) {
            return Err(invalid(format!("Unbekannte Seite {id}")));
        }
        let mut patch = serde_json::Map::new();
        if let Some(t) = title {
            patch.insert("title".into(), Value::from(t));
        }
        if let Some(c) = content {
            patch.insert("content".into(), Value::from(c));
        }
        if patch.is_empty() {
            return Ok(());
        }
        inner.dispatch("pageUpdate", json!({ "id": id, "patch": patch }))?;
        Ok(())
    }

    /// Seite in den Papierkorb.
    pub fn trash_page(&self, id: String) -> Result<(), CoreError> {
        self.lock().dispatch("pageTrash", json!({ "id": id }))?;
        Ok(())
    }

    pub fn page(&self, id: String) -> Option<PageDetail> {
        let inner = self.lock();
        let state = inner.model.state();
        let pg = state.pages.get(&id)?;
        Some(PageDetail {
            summary: summary(pg),
            content: pg.content().to_owned(),
            trashed: pg.is_trashed(),
            archived: state.is_page_archived(&id),
        })
    }

    /// Sichtbare Unterseiten in Seitenleisten-Reihenfolge; ohne `parent_id` die Wurzeln von `workspace_id`.
    pub fn children_of(&self, parent_id: Option<String>, workspace_id: Option<String>) -> Vec<PageSummary> {
        let inner = self.lock();
        summaries(inner.model.state().children_of(parent_id.as_deref(), workspace_id.as_deref(), None))
    }

    /// Elternkette (Wurzel zuerst) fÃ¼r Brotkrumen.
    pub fn ancestors_of(&self, id: String) -> Vec<PageSummary> {
        summaries(self.lock().model.state().ancestors_of(&id))
    }

    /// Alle Seiten auÃŸerhalb von Papierkorb und Archiv, zuletzt geÃ¤nderte zuerst.
    pub fn recent_pages(&self, limit: u32) -> Vec<PageSummary> {
        let inner = self.lock();
        let mut pages = inner.model.state().active_pages();
        pages.sort_by(|a, b| b.updated().cmp(a.updated()));
        pages.truncate(limit as usize);
        summaries(pages)
    }

    pub fn trashed_pages(&self) -> Vec<PageSummary> {
        summaries(self.lock().model.state().trashed_pages())
    }

    pub fn workspaces(&self) -> Vec<WorkspaceInfo> {
        let inner = self.lock();
        inner
            .model
            .state()
            .workspaces
            .iter()
            .map(|(id, w)| WorkspaceInfo { id: id.clone(), name: w.name.clone().unwrap_or_default() })
            .collect()
    }

    /// Volltextsuche Ã¼ber Titel, Inhalt und Handschrift-Text.
    pub fn search(&self, query: String, include_archived: bool) -> Vec<SearchHit> {
        let mut guard = self.lock();
        let inner = &mut *guard;
        let hits = inner.search.search(&inner.model, &query, include_archived);
        let pages = &inner.model.state().pages;
        hits.into_iter()
            .map(|h| SearchHit {
                title: pages.get(&h.id).map(|p| p.title().to_owned()).unwrap_or_default(),
                page_id: h.id,
                snippet: h.snippet,
                score: h.score,
            })
            .collect()
    }

    /// Start-Schnappschuss schreiben (beim Wechsel in den Hintergrund oder nach vielen Ã„nderungen).
    pub fn save_checkpoint(&self) -> Result<CheckpointResult, CoreError> {
        let mut guard = self.lock();
        let inner = &mut *guard;
        Ok(match inner.model.save_checkpoint(&mut inner.storage)? {
            CheckpointSave::Written => CheckpointResult::Written,
            CheckpointSave::Unchanged => CheckpointResult::Unchanged,
            CheckpointSave::OutOfOrder => CheckpointResult::OutOfOrder,
            CheckpointSave::Stale => CheckpointResult::Stale,
        })
    }

    /// Bild oder Datei speichern; liefert die ID fÃ¼r den Seiteninhalt (`img:â€¦` fÃ¼r Bilder, sonst
    /// `file:â€¦`, wie im Editor der PWA). Der Sync Ã¼bertrÃ¤gt sie mit der nÃ¤chsten SeitenÃ¤nderung.
    pub fn add_file(&self, bytes: Vec<u8>, mime: String, name: String) -> Result<String, CoreError> {
        let prefix = if mime.starts_with("image/") { "img:" } else { "file:" };
        let id = format!("{prefix}{}", uuid::Uuid::new_v4());
        let meta = json!({ "name": name, "size": bytes.len(), "type": mime });
        let blob = impala_storage::Blob { bytes, meta: Some(meta) };
        self.lock().storage.apply(vec![impala_storage::Write::PutBlob(id.clone(), blob)])?;
        Ok(id)
    }

    /// Gespeichertes Bild bzw. Datei (`img:â€¦`, `file:â€¦`); `None`, solange es noch nicht geladen ist.
    pub fn file(&self, id: String) -> Result<Option<FileData>, CoreError> {
        let blob = self.lock().storage.blob(&id)?;
        Ok(blob.map(|b| {
            let mime = b.mime().to_owned();
            let name = b.meta.as_ref().and_then(|m| m.get("name")).and_then(Value::as_str).unwrap_or("").to_owned();
            FileData { bytes: b.bytes, mime, name }
        }))
    }

    /// Export im Format der PWA (`exportAll`), Geheimnisse entfernt.
    pub fn export_json(&self, include_blobs: bool) -> Result<String, CoreError> {
        let mut inner = self.lock();
        let opts = ExportOptions { include_blobs, redact_secrets: true, exported_at: inner.clock.now() };
        Ok(inner.storage.export_all(&opts)?)
    }

    /// Export der PWA (oder eines anderen GerÃ¤ts) einspielen; danach ist der Zustand neu geladen.
    pub fn import_json(&self, json: String) -> Result<ImportSummary, CoreError> {
        let mut inner = self.lock();
        let report = inner.storage.import_all(&json, &ImportOptions::default())?;
        for ev in &report.imported {
            if let Some(t) = ev.get("t").and_then(Value::as_str) {
                inner.clock.observe(t);
            }
        }
        // Neu laden statt einzeln anwenden: Importierte Events kÃ¶nnen Ã¤lter sein als vorhandene.
        inner.reload()?;
        Ok(ImportSummary {
            added: report.added as u64,
            malformed: report.malformed as u64,
            bad_blobs: report.bad_blobs as u64,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seiten_anlegen_aendern_suchen() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let root = core.create_page("Mathe".into(), "Analysis".into(), None, None).unwrap();
        let child = core.create_page("Integrale".into(), "Riemann-Summe".into(), Some(root.clone()), None).unwrap();
        core.update_page(child.clone(), None, Some("Riemann-Summe und Stammfunktion".into())).unwrap();

        let roots = core.children_of(None, None);
        assert_eq!(roots.iter().map(|p| p.title.as_str()).collect::<Vec<_>>(), ["Mathe"]);
        let kids = core.children_of(Some(root.clone()), None);
        assert_eq!(kids[0].id, child);
        assert_eq!(core.ancestors_of(child.clone())[0].id, root);
        let detail = core.page(child.clone()).unwrap();
        assert_eq!(detail.content, "Riemann-Summe und Stammfunktion");
        assert_eq!(detail.summary.kind, PageKind::Note);
        assert_eq!(core.search("stammfunktion".into(), false)[0].page_id, child);

        core.trash_page(child.clone()).unwrap();
        assert!(core.children_of(Some(root), None).is_empty());
        assert_eq!(core.trashed_pages()[0].id, child);
    }

    #[test]
    fn bilder_und_dateien() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let img = core.add_file(vec![1, 2, 3], "image/png".into(), "a.png".into()).unwrap();
        let pdf = core.add_file(vec![4], "application/pdf".into(), "b.pdf".into()).unwrap();
        assert!(img.starts_with("img:") && pdf.starts_with("file:"));
        let f = core.file(img).unwrap().unwrap();
        assert_eq!((f.bytes, f.mime.as_str(), f.name.as_str()), (vec![1, 2, 3], "image/png", "a.png"));
        assert!(core.file("img:fehlt".into()).unwrap().is_none());
    }

    #[test]
    fn unbekannte_seiten_und_kaputtes_json() {
        let core = ImpalaCore::open_in_memory().unwrap();
        assert!(matches!(core.update_page("x".into(), Some("t".into()), None), Err(CoreError::Invalid { .. })));
        assert!(matches!(
            core.create_page("t".into(), "".into(), Some("x".into()), None),
            Err(CoreError::Invalid { .. })
        ));
        assert!(matches!(core.dispatch("pageCreate".into(), "{".into()), Err(CoreError::Invalid { .. })));
        assert!(core.page("x".into()).is_none());
    }

    #[test]
    fn datei_neu_oeffnen_und_checkpoint() {
        let dir = std::env::temp_dir().join(format!("impala-ffi-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("impala.db").to_string_lossy().into_owned();
        let id = {
            let core = ImpalaCore::open(path.clone()).unwrap();
            let id = core.create_page("Notiz".into(), "Text".into(), None, None).unwrap();
            assert_eq!(core.save_checkpoint().unwrap(), CheckpointResult::Written);
            assert_eq!(core.save_checkpoint().unwrap(), CheckpointResult::Unchanged);
            core.update_page(id.clone(), Some("Notiz 2".into()), None).unwrap();
            id
        };
        let core = ImpalaCore::open(path).unwrap();
        let info = core.load_info();
        assert!(info.checkpoint_used);
        assert_eq!(info.replayed, 1);
        assert_eq!(core.page(id).unwrap().summary.title, "Notiz 2");
        drop(core);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn export_und_import_zwischen_geraeten() {
        let a = ImpalaCore::open_in_memory().unwrap();
        let id = a.create_page("Von A".into(), "Inhalt".into(), None, None).unwrap();
        let json = a.export_json(true).unwrap();

        let b = ImpalaCore::open_in_memory().unwrap();
        let first = b.import_json(json.clone()).unwrap();
        assert_eq!(first.added, 1);
        assert_eq!(b.page(id.clone()).unwrap().content, "Inhalt");
        assert_eq!(b.import_json(json).unwrap().added, 0);
        // Neue Zeitstempel liegen nach den importierten.
        b.update_page(id.clone(), Some("Auf B".into()), None).unwrap();
        assert_eq!(b.page(id).unwrap().summary.title, "Auf B");
    }
}
