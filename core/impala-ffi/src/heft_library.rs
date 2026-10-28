//! Heft-Regal: Ordner (`gnFolderCreate`, `gnFolderMove`, `gnFolderDelete`) und das Einsortieren
//! von Heften (`gnItemMove`), unabhängig vom Seitenbaum, genau wie `web/library.js`.
//! Ordner lassen sich in der PWA nicht umbenennen; ein passendes Event gibt es nicht.

use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::json;

use crate::{CoreError, ImpalaCore, PageSummary, invalid, summary};

/// Ein Ordner im Heft-Regal.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct HeftFolder {
    pub id: String,
    pub title: String,
    /// `None`: liegt im Stamm („Dokumente“).
    pub parent_id: Option<String>,
    /// Sortierschlüssel im Regal (aufsteigend).
    pub order: f64,
    pub created: String,
}

/// Sortierschlüssel wie `gnOrder` der PWA: eigener, sonst allgemeiner, sonst Erstellzeit.
fn order_key(gn: Option<f64>, order: Option<f64>, created: &str) -> f64 {
    gn.or(order).or_else(|| impala_srs::Timestamp::parse_iso(created).map(|t| t.millis() as f64)).unwrap_or(0.0)
}

/// „Hinten“ im Regal: die aktuelle Zeit in ms (wie `Date.now()` in der PWA).
fn end_order() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0.0, |d| d.as_millis() as f64)
}

fn folder_record(f: &impala_model::GnFolder) -> HeftFolder {
    let created = f.created.clone().unwrap_or_default();
    HeftFolder {
        id: f.id.clone().unwrap_or_default(),
        title: f.title.clone().unwrap_or_default(),
        parent_id: f.parent().map(str::to_owned),
        order: order_key(None, f.order, &created),
        created,
    }
}

#[uniffi::export]
impl ImpalaCore {
    /// Ordner direkt unter `parent_id` (`None`: im Stamm), nach Regal-Reihenfolge.
    pub fn heft_folders(&self, parent_id: Option<String>) -> Vec<HeftFolder> {
        let parent = parent_id.filter(|p| !p.is_empty());
        let inner = self.lock();
        let mut list: Vec<HeftFolder> = inner
            .model
            .state()
            .gn_folders
            .values()
            .filter(|f| f.parent() == parent.as_deref())
            .map(folder_record)
            .collect();
        list.sort_by(|a, b| a.order.total_cmp(&b.order).then_with(|| a.created.cmp(&b.created)));
        list
    }

    /// Ordnerkette bis zu `folder_id` (Stamm zuerst, der Ordner selbst zuletzt) für Brotkrumen.
    pub fn heft_folder_path(&self, folder_id: String) -> Vec<HeftFolder> {
        let inner = self.lock();
        let folders = &inner.model.state().gn_folders;
        let mut path = Vec::new();
        let mut cur = folders.get(&folder_id);
        while let Some(f) = cur {
            if path.iter().any(|p: &HeftFolder| Some(&p.id) == f.id.as_ref()) {
                break;
            }
            path.push(folder_record(f));
            cur = f.parent().and_then(|p| folders.get(p));
        }
        path.reverse();
        path
    }

    /// Hefte direkt in `folder_id` (`None`: im Stamm), nach Regal-Reihenfolge; ohne Papierkorb und Archiv.
    pub fn heft_in_folder(&self, folder_id: Option<String>) -> Vec<PageSummary> {
        let folder = folder_id.filter(|f| !f.is_empty());
        let inner = self.lock();
        let mut list: Vec<_> = inner
            .model
            .state()
            .active_pages()
            .into_iter()
            .filter(|p| p.is_heft() && p.gn_folder() == folder.as_deref())
            .map(|p| (order_key(p.gn_order, p.order, p.created_at()), p))
            .collect();
        list.sort_by(|a, b| a.0.total_cmp(&b.0).then_with(|| a.1.created_at().cmp(b.1.created_at())));
        list.into_iter().map(|(_, p)| summary(p)).collect()
    }

    /// Neuer Ordner (hinten) unter `parent_id`; liefert seine ID.
    pub fn heft_folder_create(&self, title: String, parent_id: Option<String>) -> Result<String, CoreError> {
        let title = title.trim().to_owned();
        if title.is_empty() {
            return Err(invalid("Ordnername fehlt"));
        }
        let parent = parent_id.filter(|p| !p.is_empty());
        let mut inner = self.lock();
        if let Some(p) = &parent
            && !inner.model.state().gn_folders.contains_key(p)
        {
            return Err(invalid(format!("Unbekannter Ordner {p}")));
        }
        let id = uuid::Uuid::new_v4().to_string();
        inner.dispatch(
            "gnFolderCreate",
            json!({ "id": id, "title": title, "parentId": parent, "order": end_order() }),
        )?;
        Ok(id)
    }

    /// Ordner unter einen anderen verschieben (`parent_id: None`: in den Stamm). `order`: Sortierschlüssel
    /// (`None`: ans Ende). Ein Ordner lässt sich nicht in sich selbst oder einen Unterordner schieben.
    pub fn heft_folder_move(&self, id: String, parent_id: Option<String>, order: Option<f64>) -> Result<(), CoreError> {
        let parent = parent_id.filter(|p| !p.is_empty());
        let mut inner = self.lock();
        let folders = &inner.model.state().gn_folders;
        if !folders.contains_key(&id) {
            return Err(invalid(format!("Unbekannter Ordner {id}")));
        }
        let mut cur = parent.clone();
        let mut hops = 0;
        while let Some(c) = cur {
            if c == id || hops > 10_000 {
                return Err(invalid("Ein Ordner lässt sich nicht in sich selbst verschieben"));
            }
            let Some(f) = folders.get(&c) else { return Err(invalid(format!("Unbekannter Ordner {c}"))) };
            hops += 1;
            cur = f.parent().map(str::to_owned);
        }
        inner.dispatch(
            "gnFolderMove",
            json!({ "id": id, "parentId": parent, "order": order.unwrap_or_else(end_order) }),
        )?;
        Ok(())
    }

    /// Ordner löschen; seine Hefte und Unterordner rücken eine Ebene höher, nichts geht verloren.
    pub fn heft_folder_delete(&self, id: String) -> Result<(), CoreError> {
        let mut inner = self.lock();
        if !inner.model.state().gn_folders.contains_key(&id) {
            return Err(invalid(format!("Unbekannter Ordner {id}")));
        }
        inner.dispatch("gnFolderDelete", json!({ "id": id }))?;
        Ok(())
    }

    /// Heft in einen Ordner legen (`folder_id: None`: in den Stamm). `order`: Sortierschlüssel (`None`: ans Ende).
    pub fn heft_move_to_folder(
        &self,
        heft_id: String,
        folder_id: Option<String>,
        order: Option<f64>,
    ) -> Result<(), CoreError> {
        let folder = folder_id.filter(|f| !f.is_empty());
        let mut inner = self.lock();
        let state = inner.model.state();
        if !state.pages.get(&heft_id).is_some_and(|p| p.is_heft()) {
            return Err(invalid(format!("Kein Heft {heft_id}")));
        }
        if let Some(f) = &folder
            && !state.gn_folders.contains_key(f)
        {
            return Err(invalid(format!("Unbekannter Ordner {f}")));
        }
        inner.dispatch(
            "gnItemMove",
            json!({ "id": heft_id, "folderId": folder, "order": order.unwrap_or_else(end_order) }),
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::ImpalaCore;

    #[test]
    fn ordner_und_hefte_einsortieren() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let uni = core.heft_folder_create("  Uni ".into(), None).unwrap();
        let mathe = core.heft_folder_create("Mathe".into(), Some(uni.clone())).unwrap();
        assert!(core.heft_folder_create("  ".into(), None).is_err());
        assert!(core.heft_folder_create("X".into(), Some("nix".into())).is_err());
        assert_eq!(core.heft_folders(None)[0].title, "Uni");
        assert_eq!(core.heft_folders(Some(uni.clone()))[0].id, mathe);
        assert_eq!(
            core.heft_folder_path(mathe.clone()).iter().map(|f| f.title.as_str()).collect::<Vec<_>>(),
            ["Uni", "Mathe"]
        );

        let heft = core.create_heft("Analysis".into(), None, None).unwrap();
        assert_eq!(core.heft_in_folder(None)[0].id, heft);
        core.heft_move_to_folder(heft.clone(), Some(mathe.clone()), None).unwrap();
        assert!(core.heft_in_folder(None).is_empty());
        assert_eq!(core.heft_in_folder(Some(mathe.clone()))[0].id, heft);
        let note = core.create_page("Notiz".into(), String::new(), None, None).unwrap();
        assert!(core.heft_move_to_folder(note, None, None).is_err());
        assert!(core.heft_move_to_folder(heft.clone(), Some("nix".into()), None).is_err());

        // Kein Zyklus; Ordner in den Stamm.
        assert!(core.heft_folder_move(uni.clone(), Some(mathe.clone()), None).is_err());
        assert!(core.heft_folder_move(uni.clone(), Some(uni.clone()), None).is_err());
        core.heft_folder_move(mathe.clone(), None, Some(1.0)).unwrap();
        assert_eq!(
            core.heft_folders(None).iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
            [mathe.as_str(), uni.as_str()]
        );

        // Löschen reicht Hefte nach oben (hier: in den Stamm).
        core.heft_folder_delete(mathe.clone()).unwrap();
        assert_eq!(core.heft_in_folder(None)[0].id, heft);
        assert!(core.heft_folder_delete(mathe).is_err());
    }
}
