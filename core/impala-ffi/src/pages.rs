//! Seiten über das Anlegen/Ändern hinaus: Verschieben, Archiv, Papierkorb, endgültig löschen,
//! Rückverweise, Verlauf, Workspaces und Einstellungen – mit denselben Events wie die PWA.

use impala_model::query::{page_history, sort_key_of};
use impala_model::{LogEvent, Page};
use impala_storage::Storage;
use serde_json::{Value, json};

use crate::{CoreError, ImpalaCore, Inner, PageSummary, invalid, summaries, summary};

/// Abstand neuer Sortierschlüssel am Rand der Geschwister (wie die Seitenleiste der PWA).
const ORDER_STEP: f64 = 60_000.0;

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct PageVersion {
    /// Zeitpunkt der Version (ISO).
    pub time: String,
    pub title: String,
    pub content: String,
}

fn text_of(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

impl Inner {
    fn page_ref(&self, id: &str) -> Result<&Page, CoreError> {
        self.model.state().pages.get(id).ok_or_else(|| invalid(format!("Unbekannte Seite {id}")))
    }

    /// `workspaceId` des ganzen Teilbaums nachziehen (`movePageSubtreeToWorkspace`).
    fn move_subtree_to_workspace(&mut self, id: &str, workspace: &str) -> Result<(), CoreError> {
        for sub in self.model.state().page_subtree(id) {
            let differs = self.model.state().pages.get(&sub).is_some_and(|p| p.workspace() != workspace);
            if differs {
                self.dispatch("pageUpdate", json!({ "id": sub, "patch": { "workspaceId": workspace } }))?;
            }
        }
        Ok(())
    }
}

#[uniffi::export]
impl ImpalaCore {
    /// Seite unter `parent_id` (`None`: Wurzel) an Position `index` der sichtbaren Geschwister
    /// (`None`: ans Ende ohne eigene Reihenfolge, wie „hineinziehen“ in der PWA). Der Teilbaum
    /// wechselt in den Workspace des Ziels; ohne Ziel bleibt er in seinem.
    pub fn move_page(&self, id: String, parent_id: Option<String>, index: Option<u32>) -> Result<(), CoreError> {
        let mut inner = self.lock();
        let moved_ws = inner.page_ref(&id)?.workspace().to_owned();
        let parent = parent_id.filter(|p| !p.is_empty());
        let workspace = match &parent {
            Some(p) => {
                let ws = inner.page_ref(p)?.workspace().to_owned();
                if inner.model.state().page_in_tree(Some(p), &id) {
                    return Err(invalid("Seite kann nicht in ihren eigenen Teilbaum."));
                }
                ws
            }
            None => moved_ws,
        };
        let mut payload = json!({ "id": id, "parentId": parent });
        if let Some(index) = index {
            let state = inner.model.state();
            let sibs: Vec<&Page> = state
                .children_of(parent.as_deref(), Some(&workspace), None)
                .into_iter()
                .filter(|p| p.id() != id)
                .collect();
            let pos = (index as usize).min(sibs.len());
            let prev = pos.checked_sub(1).and_then(|i| sibs.get(i)).map(|p| sort_key_of(p));
            let next = sibs.get(pos).map(|p| sort_key_of(p));
            let order = match (prev, next) {
                (Some(a), Some(b)) => (a + b) / 2.0,
                (Some(a), None) => a + ORDER_STEP,
                (None, Some(b)) => b - ORDER_STEP,
                (None, None) => std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_or(0.0, |d| d.as_millis() as f64),
            };
            payload["order"] = Value::from(order);
        }
        inner.dispatch("pageMove", payload)?;
        inner.move_subtree_to_workspace(&id, &workspace)
    }

    /// Seite samt Unterseiten in einen anderen Workspace (als Wurzel).
    pub fn move_page_to_workspace(&self, id: String, workspace_id: String) -> Result<(), CoreError> {
        let mut inner = self.lock();
        inner.page_ref(&id)?;
        if inner.page_ref(&id)?.parent().is_some() {
            inner.dispatch("pageMove", json!({ "id": id, "parentId": Value::Null }))?;
        }
        inner.move_subtree_to_workspace(&id, &workspace_id)
    }

    /// Aus dem Papierkorb zurückholen.
    pub fn restore_page(&self, id: String) -> Result<(), CoreError> {
        let mut inner = self.lock();
        inner.page_ref(&id)?;
        inner.dispatch("pageRestore", json!({ "id": id }))?;
        Ok(())
    }

    /// Endgültig löschen (nur aus dem Papierkorb anbieten).
    pub fn delete_page_forever(&self, id: String) -> Result<(), CoreError> {
        let mut inner = self.lock();
        inner.page_ref(&id)?;
        inner.dispatch("pageDelete", json!({ "id": id }))?;
        Ok(())
    }

    /// Papierkorb leeren.
    pub fn empty_page_trash(&self) -> Result<u32, CoreError> {
        let mut inner = self.lock();
        let ids: Vec<String> = inner.model.state().trashed_pages().iter().map(|p| p.id().to_owned()).collect();
        for id in &ids {
            inner.dispatch("pageDelete", json!({ "id": id }))?;
        }
        Ok(ids.len() as u32)
    }

    /// Seite samt Unterseiten ins Archiv.
    pub fn archive_page(&self, id: String) -> Result<(), CoreError> {
        let mut inner = self.lock();
        inner.page_ref(&id)?;
        inner.dispatch("pageArchive", json!({ "id": id }))?;
        Ok(())
    }

    pub fn unarchive_page(&self, id: String) -> Result<(), CoreError> {
        let mut inner = self.lock();
        inner.page_ref(&id)?;
        inner.dispatch("pageUnarchive", json!({ "id": id }))?;
        Ok(())
    }

    /// Wurzeln archivierter Teilbäume, zuletzt archivierte zuerst.
    pub fn archived_pages(&self) -> Vec<PageSummary> {
        summaries(self.lock().model.state().archived_page_roots())
    }

    /// Alle Seiten-IDs des Teilbaums (die Seite selbst zuerst).
    pub fn page_subtree(&self, id: String) -> Vec<String> {
        self.lock().model.state().page_subtree(&id)
    }

    /// Seiten, die per `[[Titel]]` auf diese verweisen.
    pub fn backlinks(&self, id: String) -> Vec<PageSummary> {
        summaries(self.lock().model.state().backlinks_of(&id))
    }

    /// `[[Wiki-Link]]` auflösen: exakter Titel vor Teilstring, aktive vor archivierten.
    pub fn find_page_by_title(&self, title: String) -> Option<PageSummary> {
        self.lock().model.state().find_page(&title, true).map(summary)
    }

    /// Alle Versionen (Titel/Inhalt) aus dem Log, älteste zuerst. Liest das ganze Log: im Hintergrund rufen.
    pub fn page_history(&self, id: String) -> Result<Vec<PageVersion>, CoreError> {
        let events = self.lock().storage.events_after(0, None, None)?;
        let events: Vec<LogEvent> = events.iter().filter_map(LogEvent::from_object).collect();
        Ok(page_history(events, &id)
            .into_iter()
            .map(|v| PageVersion { time: v.t, title: text_of(&v.title), content: text_of(&v.content) })
            .collect())
    }

    /// Neuer Workspace; liefert seine ID.
    pub fn create_workspace(&self, name: String) -> Result<String, CoreError> {
        let id = uuid::Uuid::new_v4().to_string();
        self.lock().dispatch("workspaceCreate", json!({ "id": id, "name": name }))?;
        Ok(id)
    }

    /// Alle Einstellungen als JSON-Objekt (dieselben Schlüssel wie in der PWA, z. B. `aiProviders`,
    /// `deckConf`, `driveAutoSyncMinutes`). Geheimnisse (`cfSyncKey`, KI-Schlüssel) sind enthalten.
    pub fn settings_json(&self) -> String {
        serde_json::to_string(&self.lock().model.state().settings).unwrap_or_else(|_| "{}".into())
    }

    /// Einstellungen ändern: `patch_json` ist ein Objekt mit den neuen Werten (`settingsSet`).
    pub fn update_settings(&self, patch_json: String) -> Result<(), CoreError> {
        let patch: Value = serde_json::from_str(&patch_json).map_err(|e| invalid(format!("Einstellungen: {e}")))?;
        if !patch.is_object() {
            return Err(invalid("Einstellungen: Objekt erwartet"));
        }
        self.lock().dispatch("settingsSet", patch)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::ImpalaCore;

    #[test]
    fn verschieben_und_reihenfolge() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let a = core.create_page("A".into(), "".into(), None, None).unwrap();
        let b = core.create_page("B".into(), "".into(), None, None).unwrap();
        let c = core.create_page("C".into(), "".into(), None, None).unwrap();
        let titles = |core: &ImpalaCore| core.children_of(None, None).into_iter().map(|p| p.title).collect::<Vec<_>>();
        assert_eq!(titles(&core), ["A", "B", "C"]);
        core.move_page(c.clone(), None, Some(0)).unwrap();
        assert_eq!(titles(&core), ["C", "A", "B"]);
        core.move_page(c.clone(), None, Some(1)).unwrap();
        assert_eq!(titles(&core), ["A", "C", "B"]);
        core.move_page(b.clone(), Some(a.clone()), None).unwrap();
        assert_eq!(core.children_of(Some(a.clone()), None)[0].id, b);
        assert!(core.move_page(a.clone(), Some(b.clone()), None).is_err());

        let ws = core.create_workspace("Uni".into()).unwrap();
        core.move_page_to_workspace(a.clone(), ws.clone()).unwrap();
        assert_eq!(core.page(b).unwrap().summary.workspace_id, ws);
        assert!(core.workspaces().iter().any(|w| w.id == ws && w.name == "Uni"));
    }

    #[test]
    fn archiv_papierkorb_verlauf() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let a = core.create_page("Ziel".into(), "x".into(), None, None).unwrap();
        let b = core.create_page("Quelle".into(), "siehe [[Ziel]]".into(), None, None).unwrap();
        assert_eq!(core.backlinks(a.clone())[0].id, b);
        assert_eq!(core.find_page_by_title("zie".into()).unwrap().id, a);

        core.archive_page(a.clone()).unwrap();
        assert_eq!(core.archived_pages()[0].id, a);
        assert!(core.page(a.clone()).unwrap().archived);
        core.unarchive_page(a.clone()).unwrap();
        assert!(core.archived_pages().is_empty());

        core.update_page(a.clone(), Some("Ziel 2".into()), None).unwrap();
        let hist = core.page_history(a.clone()).unwrap();
        assert_eq!(hist.iter().map(|v| v.title.as_str()).collect::<Vec<_>>(), ["Ziel", "Ziel 2"]);

        core.trash_page(b.clone()).unwrap();
        core.restore_page(b.clone()).unwrap();
        assert!(!core.page(b.clone()).unwrap().trashed);
        core.trash_page(b.clone()).unwrap();
        assert_eq!(core.empty_page_trash().unwrap(), 1);
        assert!(core.page(b).is_none());
    }

    #[test]
    fn einstellungen() {
        let core = ImpalaCore::open_in_memory().unwrap();
        core.update_settings(r#"{"driveAutoSyncMinutes": 15}"#.into()).unwrap();
        let s: serde_json::Value = serde_json::from_str(&core.settings_json()).unwrap();
        assert_eq!(s["driveAutoSyncMinutes"], 15);
        assert!(core.update_settings("[1]".into()).is_err());
    }
}
