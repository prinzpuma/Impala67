//! UniFFI-Hülle des Kerns für native Apps (Kotlin, Swift, C#). Anders als die WASM-Hülle hält sie
//! Speicher und Zustand selbst: [`ImpalaCore`] öffnet eine SQLite-Datei, lädt das Modell daraus,
//! vergibt Event-IDs und Zeitstempel und schreibt jede Änderung, bevor sie angewandt wird.
//! Die Plattform zeichnet nur und ruft grobe Funktionen; Daten wandern als einfache Datensätze.

mod clock;

use std::fmt;
use std::sync::{Arc, Mutex, MutexGuard};

use impala_model::search::NoteSearch;
use impala_model::{CheckpointSave, Model, Page};
use impala_storage::{ExportOptions, ImportOptions, SqliteStorage, StorageExt};
use serde_json::{Value, json};

use crate::clock::Clock;

uniffi::setup_scaffolding!();

#[derive(Debug, uniffi::Error)]
pub enum CoreError {
    /// Lesen/Schreiben der Datenbank ist fehlgeschlagen (auch: Schema einer neueren App-Version).
    Storage { message: String },
    /// Ungültige Eingabe der Plattform (kaputtes JSON, unbekannte Seite …).
    Invalid { message: String },
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            CoreError::Storage { message } | CoreError::Invalid { message } => f.write_str(message),
        }
    }
}

impl std::error::Error for CoreError {}

impl From<impala_storage::Error> for CoreError {
    fn from(e: impala_storage::Error) -> Self {
        CoreError::Storage { message: e.to_string() }
    }
}

fn invalid(message: impl Into<String>) -> CoreError {
    CoreError::Invalid { message: message.into() }
}

/// Wie der Start verlief (Diagnose).
#[derive(Debug, Clone, uniffi::Record)]
pub struct LoadInfo {
    pub event_count: u64,
    pub max_seq: u64,
    /// Nach dem Checkpoint (oder voll) abgespielte Events.
    pub replayed: u64,
    pub checkpoint_used: bool,
    /// Warum der Checkpoint nicht taugte (`missing`, `older-tail` …).
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
    /// Fremd-Events kamen außer Reihenfolge: erst der nächste Start schreibt wieder.
    OutOfOrder,
    /// Im Log liegen noch nicht angewandte Events: später erneut versuchen.
    Stale,
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
}

impl Inner {
    fn open(storage: SqliteStorage) -> Result<Inner, CoreError> {
        let load =
            LoadInfo { event_count: 0, max_seq: 0, replayed: 0, checkpoint_used: false, checkpoint_reject: None };
        let mut inner =
            Inner { storage, model: Model::new(), search: NoteSearch::new(), clock: Clock::default(), load };
        inner.reload()?;
        Ok(inner)
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
        Ok(())
    }

    fn dispatch(&mut self, kind: &str, payload: Value) -> Result<String, CoreError> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = self.clock.now();
        let ev = self.model.dispatch(&mut self.storage, kind, payload, &id, &now)?;
        Ok(ev.id)
    }
}

/// Der Kern einer nativen App: eine Datenbank, ein Zustand. Alle Methoden sind threadsicher
/// (intern serialisiert); lange Aufrufe (Öffnen, Import, Export) gehören in einen Hintergrund-Thread.
#[derive(uniffi::Object)]
pub struct ImpalaCore {
    inner: Mutex<Inner>,
}

impl ImpalaCore {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        // Ein Panic in einem früheren Aufruf lässt den Zustand stehen; weiterarbeiten statt abstürzen.
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[uniffi::export]
impl ImpalaCore {
    /// Öffnet (oder legt an) die Datenbank unter `db_path` und lädt den Zustand.
    #[uniffi::constructor]
    pub fn open(db_path: String) -> Result<Arc<Self>, CoreError> {
        let storage = SqliteStorage::open(&db_path)?;
        Ok(Arc::new(ImpalaCore { inner: Mutex::new(Inner::open(storage)?) }))
    }

    /// Nur im Speicher (Tests, Vorschau).
    #[uniffi::constructor]
    pub fn open_in_memory() -> Result<Arc<Self>, CoreError> {
        let storage = SqliteStorage::open_in_memory()?;
        Ok(Arc::new(ImpalaCore { inner: Mutex::new(Inner::open(storage)?) }))
    }

    pub fn load_info(&self) -> LoadInfo {
        self.lock().load.clone()
    }

    /// Versatz der Geräteuhr gegen einen Server in ms (positiv = Gerät geht vor).
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
        let payload =
            json!({ "id": id, "title": title, "content": content, "parentId": parent, "workspaceId": workspace });
        inner.dispatch("pageCreate", payload)?;
        Ok(id)
    }

    /// Titel und/oder Inhalt einer Seite ändern (`None` = unverändert).
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

    /// Elternkette (Wurzel zuerst) für Brotkrumen.
    pub fn ancestors_of(&self, id: String) -> Vec<PageSummary> {
        summaries(self.lock().model.state().ancestors_of(&id))
    }

    /// Alle Seiten außerhalb von Papierkorb und Archiv, zuletzt geänderte zuerst.
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

    /// Volltextsuche über Titel, Inhalt und Handschrift-Text.
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

    /// Start-Schnappschuss schreiben (beim Wechsel in den Hintergrund oder nach vielen Änderungen).
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

    /// Export im Format der PWA (`exportAll`), Geheimnisse entfernt.
    pub fn export_json(&self, include_blobs: bool) -> Result<String, CoreError> {
        let mut inner = self.lock();
        let opts = ExportOptions { include_blobs, redact_secrets: true, exported_at: inner.clock.now() };
        Ok(inner.storage.export_all(&opts)?)
    }

    /// Export der PWA (oder eines anderen Geräts) einspielen; danach ist der Zustand neu geladen.
    pub fn import_json(&self, json: String) -> Result<ImportSummary, CoreError> {
        let mut inner = self.lock();
        let report = inner.storage.import_all(&json, &ImportOptions::default())?;
        for ev in &report.imported {
            if let Some(t) = ev.get("t").and_then(Value::as_str) {
                inner.clock.observe(t);
            }
        }
        // Neu laden statt einzeln anwenden: Importierte Events können älter sein als vorhandene.
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
