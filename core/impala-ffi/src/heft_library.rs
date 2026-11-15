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

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct LibraryTreeRowInfo {
    pub page: PageSummary,
    pub depth: u32,
    pub has_kids: bool,
    pub collapsed: bool,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct LibrarySectionInfo {
    pub workspace: crate::WorkspaceInfo,
    pub rows: Vec<LibraryTreeRowInfo>,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct NotionLibraryView {
    pub all_count: u32,
    pub fav_count: u32,
    pub pdf_count: u32,
    pub tpl_count: u32,
    pub sections: Vec<LibrarySectionInfo>,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct HeftFolderCount {
    pub folder: HeftFolder,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct HeftShelfCard {
    pub page: PageSummary,
    pub pages_count: u32,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct HeftShelfData {
    pub folders: Vec<HeftFolderCount>,
    pub shown: Vec<HeftShelfCard>,
    pub all_count: u32,
    pub fav_count: u32,
    pub crumbs: Vec<HeftFolder>,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ArchiveLibraryView {
    pub all_count: u32,
    pub page_count: u32,
    pub heft_count: u32,
    pub shown: Vec<PageSummary>,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct SidebarRowInfo {
    pub row_id: String,
    pub kind: String,
    pub title: String,
    pub collapse_key: Option<String>,
    pub workspace_id: Option<String>,
    pub page: Option<PageSummary>,
    pub depth: u32,
    pub has_kids: bool,
    pub collapsed: bool,
    pub section: String,
}

#[uniffi::export]
pub fn resolved_heft_cover(cover: String, title: String, id: String) -> String {
    impala_model::library::resolved_cover(&cover, &title, &id)
}

#[uniffi::export]
impl ImpalaCore {
    /// Notion-Seitenbaum für die Bibliothek samt Filter-Zählern.
    pub fn library_notion_view(&self, smart: String, query: String) -> NotionLibraryView {
        let inner = self.lock();
        let state = inner.model.state();
        let res = impala_model::library::notion_tree(state, Some(&smart), None, &query);
        let sections = res
            .sections
            .into_iter()
            .map(|sec| {
                let rows = sec
                    .rows
                    .into_iter()
                    .filter_map(|r| {
                        let pg = state.pages.get(&r.id)?;
                        Some(LibraryTreeRowInfo {
                            page: summary(pg),
                            depth: r.depth as u32,
                            has_kids: r.has_kids,
                            collapsed: r.collapsed,
                        })
                    })
                    .collect();
                LibrarySectionInfo {
                    workspace: crate::WorkspaceInfo { id: sec.workspace_id, name: sec.workspace_name },
                    rows,
                }
            })
            .collect();
        NotionLibraryView {
            all_count: res.all as u32,
            fav_count: res.fav as u32,
            pdf_count: res.pdf as u32,
            tpl_count: res.tpl as u32,
            sections,
        }
    }

    /// GoodNotes-Regal für die Bibliothek (Ordner, Hefte mit Seitenzahl, Zähler, Brotkrumen).
    pub fn library_heft_shelf(&self, folder_id: Option<String>, filter: String, query: String) -> HeftShelfData {
        let inner = self.lock();
        let state = inner.model.state();
        let view = impala_model::library::gn_shelf(state, folder_id.as_deref(), &filter, &query);
        let mut folders = Vec::new();
        let mut shown = Vec::new();
        for item in view.items {
            if item.kind == "folder" {
                if let Some(f) = state.gn_folders.get(&item.id) {
                    folders.push(HeftFolderCount { folder: folder_record(f), count: item.direct_count as u32 });
                }
            } else if let Some(pg) = state.pages.get(&item.id) {
                let pages_count = state.hefte.get(&item.id).map_or(1, |d| d.pages.len().max(1)) as u32;
                shown.push(HeftShelfCard { page: summary(pg), pages_count });
            }
        }
        let crumbs = view.ancestors.into_iter().filter_map(|id| state.gn_folders.get(&id).map(folder_record)).collect();
        HeftShelfData { folders, shown, all_count: view.all_count as u32, fav_count: view.fav_count as u32, crumbs }
    }

    /// Archiv-Liste für die Bibliothek samt Filter-Zählern.
    pub fn library_archive_view(&self, filter: String, query: String) -> ArchiveLibraryView {
        let inner = self.lock();
        let state = inner.model.state();
        let all = state.archived_pages();
        let all_count = all.len() as u32;
        let heft_count = all.iter().filter(|p| p.is_heft()).count() as u32;
        let page_count = all_count - heft_count;
        let shown = all
            .into_iter()
            .filter(|p| {
                let kind_ok = match filter.as_str() {
                    "heft" | "hefte" => p.is_heft(),
                    "page" | "pages" => !p.is_heft(),
                    _ => true,
                };
                kind_ok && impala_model::library::page_matches_query(p, &query)
            })
            .map(summary)
            .collect();
        ArchiveLibraryView { all_count, page_count, heft_count, shown }
    }

    /// Sichtbare Zeilen der Seitenleiste (Favoriten + Arbeitsbereiche + ausgeklappte Seiten).
    pub fn sidebar_tree_rows(&self) -> Vec<SidebarRowInfo> {
        let inner = self.lock();
        let state = inner.model.state();
        impala_model::library::sidebar_tree_rows(state)
            .into_iter()
            .map(|r| SidebarRowInfo {
                row_id: r.row_id,
                kind: r.kind,
                title: r.title,
                collapse_key: r.collapse_key,
                workspace_id: r.workspace_id,
                page: r.page_id.as_deref().and_then(|id| state.pages.get(id)).map(summary),
                depth: r.depth as u32,
                has_kids: r.has_kids,
                collapsed: r.collapsed,
                section: r.section,
            })
            .collect()
    }
}
