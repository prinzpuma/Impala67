//! Bibliothek, Seitenbaum und Heft-Regal für PWA (`web/library.js`), iOS (`LibraryScreen.swift`,
//! `PageTree.swift`) und Android (`DeskTree.kt`).

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::query::sort_key_of;
use crate::types::{GnFolder, Page, State};

pub const COVER_PRESETS: [&str; 5] = ["sunset", "ocean", "forest", "grape", "mono"];
pub const FOLDER_TONES: [&str; 6] = ["sky", "mint", "lilac", "sand", "rose", "slate"];
const MAX_TREE_DEPTH: usize = 8;

/// Hash über UTF-16-Code-Units wie in JS (`h = (h * 31 + charCodeAt(i)) >>> 0`).
fn utf16_hash(s: &str) -> u32 {
    let mut h: u32 = 0;
    for c in s.encode_utf16() {
        h = h.wrapping_mul(31).wrapping_add(u32::from(c));
    }
    h
}

/// Fester Cover-Preset aus Titel und ID (`defaultCover` in `web/library.js`).
pub fn default_cover(title: &str, id: &str) -> &'static str {
    let mut combined = String::with_capacity(title.len() + id.len());
    combined.push_str(title);
    combined.push_str(id);
    let idx = (utf16_hash(&combined) as usize) % COVER_PRESETS.len();
    COVER_PRESETS[idx]
}

/// Aufgelöstes Cover einer Seite: vorhandener gültiger Preset, sonst `default_cover`.
pub fn resolved_cover(cover: &str, title: &str, id: &str) -> String {
    if COVER_PRESETS.contains(&cover) {
        cover.to_owned()
    } else {
        default_cover(title, id).to_owned()
    }
}

/// Farbton eines Ordners im GoodNotes-Regal (`folderTone` in `web/library.js`).
pub fn folder_tone(key: &str) -> &'static str {
    let idx = (utf16_hash(key) as usize) % FOLDER_TONES.len();
    FOLDER_TONES[idx]
}

/// Ist ein Baum-Schlüssel (`ws:<id>` oder Seiten-ID) eingeklappt? (`COLLAPSE.isCollapsed`)
pub fn is_tree_collapsed(state: &State, key: &str) -> bool {
    if key.starts_with("ws:") {
        state.tree_open.get(key) == Some(&false)
    } else {
        state.tree_open.get(key) != Some(&true)
    }
}

fn page_favorite(p: &Page) -> bool {
    p.extra.get("favorite").and_then(Value::as_bool).unwrap_or(false)
}

fn page_has_pdf(p: &Page) -> bool {
    p.extra.get("pdfId").and_then(Value::as_str).is_some_and(|s| !s.is_empty())
}

fn page_is_template(p: &Page) -> bool {
    p.extra.get("isTemplate").and_then(Value::as_bool).unwrap_or(false)
}

fn page_tags(p: &Page) -> Vec<&str> {
    p.extra
        .get("tags")
        .and_then(Value::as_array)
        .map_or_else(Vec::new, |arr| arr.iter().filter_map(Value::as_str).collect())
}

/// Passt eine Seite zur Suchanfrage (Titel oder Schlagwort enthält `query`)?
pub fn page_matches_query(p: &Page, query: &str) -> bool {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return true;
    }
    p.title().to_lowercase().contains(&q) || page_tags(p).iter().any(|t| t.to_lowercase().contains(&q))
}

fn own_match_notion(p: &Page, smart: Option<&str>, tag: Option<&str>, query: &str) -> bool {
    let smart_ok = match smart {
        None | Some("") | Some("all") => true,
        Some("fav") => page_favorite(p),
        Some("pdf") => page_has_pdf(p),
        Some("tpl") => page_is_template(p),
        Some("untagged") => page_tags(p).is_empty(),
        Some(_) => true,
    };
    if !smart_ok {
        return false;
    }
    if let Some(wanted_tag) = tag.filter(|t| !t.is_empty())
        && !page_tags(p).contains(&wanted_tag)
    {
        return false;
    }
    page_matches_query(p, query)
}

// ---- Notion-Seitenbaum in der Bibliothek ---------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTreeRow {
    pub id: String,
    pub depth: usize,
    pub has_kids: bool,
    pub collapsed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryWorkspaceSection {
    pub workspace_id: String,
    pub workspace_name: String,
    pub rows: Vec<LibraryTreeRow>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotionTreeResult {
    pub all: usize,
    pub fav: usize,
    pub pdf: usize,
    pub tpl: usize,
    pub sections: Vec<LibraryWorkspaceSection>,
}

/// Berechnet den gefilterten Notion-Seitenbaum der Bibliothek samt Filter-Zählern.
pub fn notion_tree(state: &State, smart: Option<&str>, tag: Option<&str>, query: &str) -> NotionTreeResult {
    let active = state.active_pages();
    let all = active.len();
    let fav = active.iter().filter(|p| page_favorite(p)).count();
    let pdf = active.iter().filter(|p| page_has_pdf(p)).count();
    let tpl = active.iter().filter(|p| page_is_template(p)).count();

    // Arbeitsbereiche in der Reihenfolge ihres Auftretens in active_pages + registrierte Workspaces
    let mut ws_ids: Vec<String> = Vec::new();
    let mut seen_ws: HashSet<String> = HashSet::new();
    for p in &active {
        let ws = p.workspace().to_owned();
        if seen_ws.insert(ws.clone()) {
            ws_ids.push(ws);
        }
    }
    for ws in state.workspaces.keys() {
        if seen_ws.insert(ws.clone()) {
            ws_ids.push(ws.clone());
        }
    }

    let mut visible_memo: HashMap<String, bool> = HashMap::new();
    #[allow(clippy::too_many_arguments)]
    fn is_visible(
        state: &State,
        p: &Page,
        ws_id: &str,
        smart: Option<&str>,
        tag: Option<&str>,
        query: &str,
        memo: &mut HashMap<String, bool>,
        visiting: &mut HashSet<String>,
    ) -> bool {
        let id = p.id().to_owned();
        if let Some(&v) = memo.get(&id) {
            return v;
        }
        if !visiting.insert(id.clone()) {
            return false;
        }
        let own = own_match_notion(p, smart, tag, query);
        let kids_vis = state
            .children_of(Some(&id), Some(ws_id), None)
            .into_iter()
            .any(|k| is_visible(state, k, ws_id, smart, tag, query, memo, visiting));
        visiting.remove(&id);
        let v = own || kids_vis;
        memo.insert(id, v);
        v
    }

    #[allow(clippy::too_many_arguments)]
    fn build_branch(
        state: &State,
        list: Vec<&Page>,
        ws_id: &str,
        depth: usize,
        smart: Option<&str>,
        tag: Option<&str>,
        query: &str,
        memo: &mut HashMap<String, bool>,
        visiting: &mut HashSet<String>,
        rows: &mut Vec<LibraryTreeRow>,
    ) {
        for p in list {
            if !is_visible(state, p, ws_id, smart, tag, query, memo, visiting) {
                continue;
            }
            let kids: Vec<&Page> = if depth < MAX_TREE_DEPTH {
                state
                    .children_of(Some(p.id()), Some(ws_id), None)
                    .into_iter()
                    .filter(|k| is_visible(state, k, ws_id, smart, tag, query, memo, visiting))
                    .collect()
            } else {
                Vec::new()
            };
            let has_kids = !kids.is_empty();
            let collapsed = has_kids && is_tree_collapsed(state, p.id());
            rows.push(LibraryTreeRow {
                id: p.id().to_owned(),
                depth,
                has_kids,
                collapsed,
            });
            if !collapsed {
                build_branch(state, kids, ws_id, depth + 1, smart, tag, query, memo, visiting, rows);
            }
        }
    }

    let mut sections = Vec::new();
    let mut visiting = HashSet::new();
    for ws_id in ws_ids {
        let roots = state.children_of(None, Some(&ws_id), None);
        let mut rows = Vec::new();
        build_branch(state, roots, &ws_id, 0, smart, tag, query, &mut visible_memo, &mut visiting, &mut rows);
        if !rows.is_empty() {
            let ws_name = state
                .workspaces
                .get(&ws_id)
                .and_then(|w| w.name.clone())
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| "Privat".into());
            sections.push(LibraryWorkspaceSection {
                workspace_id: ws_id,
                workspace_name: ws_name,
                rows,
            });
        }
    }

    NotionTreeResult { all, fav, pdf, tpl, sections }
}

// ---- Archiv-Seitenbaum in der Bibliothek ---------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveTreeResult {
    pub all: usize,
    pub hefte: usize,
    pub pages: usize,
    pub sections: Vec<LibraryWorkspaceSection>,
}

fn archived_children_of<'a>(state: &'a State, parent_id: &str) -> Vec<&'a Page> {
    let mut kids: Vec<&'a Page> = state
        .child_pages_of(Some(parent_id))
        .into_iter()
        .filter(|c| c.is_archived() && !c.is_trashed())
        .collect();
    kids.sort_by(|a, b| sort_key_of(a).total_cmp(&sort_key_of(b)));
    kids
}

fn own_match_archive(p: &Page, type_filter: &str, query: &str) -> bool {
    let kind_ok = match type_filter {
        "hefte" | "heft" => p.is_heft(),
        "pages" | "page" => !p.is_heft(),
        _ => true,
    };
    kind_ok && page_matches_query(p, query)
}

/// Berechnet den Archiv-Seitenbaum der Bibliothek samt Filter-Zählern.
pub fn archive_tree(state: &State, type_filter: &str, query: &str) -> ArchiveTreeResult {
    let roots = state.archived_page_roots();
    let all = roots.len();
    let hefte = roots.iter().filter(|p| p.is_heft()).count();
    let pages = all - hefte;

    let mut ws_ids: Vec<String> = Vec::new();
    let mut seen_ws: HashSet<String> = HashSet::new();
    for p in &roots {
        let ws = p.workspace().to_owned();
        if seen_ws.insert(ws.clone()) {
            ws_ids.push(ws);
        }
    }

    let mut visible_memo: HashMap<String, bool> = HashMap::new();
    fn is_vis_arch(
        state: &State,
        p: &Page,
        type_filter: &str,
        query: &str,
        memo: &mut HashMap<String, bool>,
        visiting: &mut HashSet<String>,
    ) -> bool {
        let id = p.id().to_owned();
        if let Some(&v) = memo.get(&id) {
            return v;
        }
        if !visiting.insert(id.clone()) {
            return false;
        }
        let own = own_match_archive(p, type_filter, query);
        let kids_vis = archived_children_of(state, &id)
            .into_iter()
            .any(|k| is_vis_arch(state, k, type_filter, query, memo, visiting));
        visiting.remove(&id);
        let v = own || kids_vis;
        memo.insert(id, v);
        v
    }

    #[allow(clippy::too_many_arguments)]
    fn build_arch_branch(
        state: &State,
        list: Vec<&Page>,
        depth: usize,
        type_filter: &str,
        query: &str,
        memo: &mut HashMap<String, bool>,
        visiting: &mut HashSet<String>,
        rows: &mut Vec<LibraryTreeRow>,
    ) {
        for p in list {
            if !is_vis_arch(state, p, type_filter, query, memo, visiting) {
                continue;
            }
            let kids: Vec<&Page> = if depth < MAX_TREE_DEPTH {
                archived_children_of(state, p.id())
                    .into_iter()
                    .filter(|k| is_vis_arch(state, k, type_filter, query, memo, visiting))
                    .collect()
            } else {
                Vec::new()
            };
            let has_kids = !kids.is_empty();
            let collapsed = has_kids && is_tree_collapsed(state, p.id());
            rows.push(LibraryTreeRow {
                id: p.id().to_owned(),
                depth,
                has_kids,
                collapsed,
            });
            if !collapsed {
                build_arch_branch(state, kids, depth + 1, type_filter, query, memo, visiting, rows);
            }
        }
    }

    let mut sections = Vec::new();
    let mut visiting = HashSet::new();
    for ws_id in ws_ids {
        let ws_roots: Vec<&Page> = roots.iter().copied().filter(|p| p.workspace() == ws_id).collect();
        let mut rows = Vec::new();
        build_arch_branch(state, ws_roots, 0, type_filter, query, &mut visible_memo, &mut visiting, &mut rows);
        if !rows.is_empty() {
            let ws_name = state
                .workspaces
                .get(&ws_id)
                .and_then(|w| w.name.clone())
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| "Privat".into());
            sections.push(LibraryWorkspaceSection {
                workspace_id: ws_id,
                workspace_name: ws_name,
                rows,
            });
        }
    }

    ArchiveTreeResult { all, hefte, pages, sections }
}

// ---- GoodNotes Heft-Regal ------------------------------------------------------------------

/// Sortierschlüssel im GoodNotes-Regal (`gnOrder` in `web/library.js`).
pub fn gn_order_of_folder(f: &GnFolder) -> f64 {
    f.order
        .or_else(|| impala_srs::Timestamp::parse_iso(f.created.as_deref().unwrap_or("")).map(|t| t.millis() as f64))
        .unwrap_or(0.0)
}

pub fn gn_order_of_page(p: &Page) -> f64 {
    p.gn_order
        .or(p.order)
        .or_else(|| impala_srs::Timestamp::parse_iso(p.created_at()).map(|t| t.millis() as f64))
        .unwrap_or(0.0)
}

/// Anzahl direkter Unterordner + direkter aktiver Hefte in einem GoodNotes-Ordner.
pub fn gn_folder_direct_count(state: &State, folder_id: &str) -> usize {
    let sub_folders = state.gn_folders.values().filter(|f| f.parent() == Some(folder_id)).count();
    let hefte = state
        .active_pages()
        .into_iter()
        .filter(|p| p.is_heft() && p.gn_folder() == Some(folder_id))
        .count();
    sub_folders + hefte
}

/// Brotkrumen-Kette eines GoodNotes-Ordners (Wurzel zuerst).
pub fn gn_ancestors<'a>(state: &'a State, folder_id: Option<&str>) -> Vec<&'a GnFolder> {
    let Some(mut cur_id) = folder_id.filter(|s| !s.is_empty()) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    while let Some(f) = state.gn_folders.get(cur_id) {
        let id = f.id.as_deref().unwrap_or(cur_id);
        if !seen.insert(id.to_owned()) {
            break;
        }
        out.push(f);
        match f.parent() {
            Some(pid) => cur_id = pid,
            None => break,
        }
    }
    out.reverse();
    out
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GnShelfEntry {
    /// `"folder"` oder `"heft"`.
    pub kind: String,
    pub id: String,
    pub order: f64,
    pub direct_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GnShelfView {
    pub folder_id: Option<String>,
    pub ancestors: Vec<String>,
    pub items: Vec<GnShelfEntry>,
    pub all_count: usize,
    pub fav_count: usize,
}

/// Berechnet die Einträge des GoodNotes-Regals (`renderHefteShelf` in `web/library.js`).
pub fn gn_shelf(state: &State, folder_id: Option<&str>, filter: &str, query: &str) -> GnShelfView {
    let valid_folder = folder_id
        .filter(|id| !id.is_empty() && state.gn_folders.contains_key(id))
        .map(str::to_owned);
    let q = query.trim().to_lowercase();
    let active = state.active_pages();

    let raw_hefte: Vec<&Page> = if !q.is_empty() {
        active.iter().copied().filter(|p| p.is_heft()).collect()
    } else {
        active
            .iter()
            .copied()
            .filter(|p| p.is_heft() && p.gn_folder() == valid_folder.as_deref())
            .collect()
    };
    let all_count = raw_hefte.len();
    let fav_count = raw_hefte.iter().filter(|p| page_favorite(p)).count();

    let mut combined: Vec<(f64, String, GnShelfEntry)> = Vec::new();

    if !q.is_empty() {
        for f in state.gn_folders.values() {
            let title = f.title.as_deref().unwrap_or("");
            if title.to_lowercase().contains(&q) {
                let id = f.id.clone().unwrap_or_default();
                let order = gn_order_of_folder(f);
                let direct_count = gn_folder_direct_count(state, &id);
                combined.push((
                    order,
                    String::new(),
                    GnShelfEntry { kind: "folder".into(), id, order, direct_count },
                ));
            }
        }
        for p in raw_hefte {
            if (filter == "all" || filter.is_empty() || page_favorite(p)) && page_matches_query(p, &q) {
                let order = gn_order_of_page(p);
                combined.push((
                    order,
                    String::new(),
                    GnShelfEntry { kind: "heft".into(), id: p.id().to_owned(), order, direct_count: 0 },
                ));
            }
        }
        combined.sort_by(|a, b| a.0.total_cmp(&b.0));
    } else {
        for f in state.gn_folders.values() {
            if f.parent() == valid_folder.as_deref() {
                let id = f.id.clone().unwrap_or_default();
                let order = gn_order_of_folder(f);
                let direct_count = gn_folder_direct_count(state, &id);
                let created = f.created.clone().unwrap_or_default();
                combined.push((
                    order,
                    created,
                    GnShelfEntry { kind: "folder".into(), id, order, direct_count },
                ));
            }
        }
        for p in raw_hefte {
            if filter == "all" || filter.is_empty() || page_favorite(p) {
                let order = gn_order_of_page(p);
                let created = p.created.clone().unwrap_or_default();
                combined.push((
                    order,
                    created,
                    GnShelfEntry { kind: "heft".into(), id: p.id().to_owned(), order, direct_count: 0 },
                ));
            }
        }
        combined.sort_by(|a, b| a.0.total_cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    }

    let ancestors = gn_ancestors(state, valid_folder.as_deref())
        .into_iter()
        .filter_map(|f| f.id.clone())
        .collect();

    GnShelfView {
        folder_id: valid_folder,
        ancestors,
        items: combined.into_iter().map(|(_, _, e)| e).collect(),
        all_count,
        fav_count,
    }
}

// ---- Seitenleisten-Baum (iOS PageTree.swift / Android DeskTree.kt) -------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidebarTreeRowData {
    pub row_id: String,
    /// `"head"`, `"page"` oder `"empty"`.
    pub kind: String,
    pub title: String,
    pub collapse_key: Option<String>,
    pub workspace_id: Option<String>,
    pub page_id: Option<String>,
    pub depth: usize,
    pub has_kids: bool,
    pub collapsed: bool,
    /// `"fav"` oder `"tree"` bei `"page"`.
    pub section: String,
}

/// Sichtbare Zeilen der Seitenleiste (Favoriten + Arbeitsbereiche + ausgeklappte Seiten bis Tiefe 8).
pub fn sidebar_tree_rows(state: &State) -> Vec<SidebarTreeRowData> {
    let mut rows = Vec::new();
    let mut active = state.active_pages();
    active.sort_by(|a, b| b.updated().cmp(a.updated()));
    let favorites: Vec<&Page> = active.iter().copied().filter(|p| page_favorite(p)).collect();
    let parent_ids: HashSet<&str> = active.iter().filter_map(|p| p.parent()).collect();

    if !favorites.is_empty() {
        rows.push(SidebarTreeRowData {
            row_id: "head:fav".into(),
            kind: "head".into(),
            title: "★ Favoriten".into(),
            collapse_key: None,
            workspace_id: None,
            page_id: None,
            depth: 0,
            has_kids: false,
            collapsed: false,
            section: String::new(),
        });
        for p in favorites {
            rows.push(SidebarTreeRowData {
                row_id: format!("fav:{}", p.id()),
                kind: "page".into(),
                title: p.title().to_owned(),
                collapse_key: None,
                workspace_id: Some(p.workspace().to_owned()),
                page_id: Some(p.id().to_owned()),
                depth: 0,
                has_kids: false,
                collapsed: is_tree_collapsed(state, p.id()),
                section: "fav".into(),
            });
        }
    }

    fn branch(
        state: &State,
        parent: Option<&str>,
        ws: Option<&str>,
        depth: usize,
        parent_ids: &HashSet<&str>,
        rows: &mut Vec<SidebarTreeRowData>,
    ) {
        for p in state.children_of(parent, ws, None) {
            let kids = depth < MAX_TREE_DEPTH && parent_ids.contains(p.id());
            let collapsed = is_tree_collapsed(state, p.id());
            rows.push(SidebarTreeRowData {
                row_id: format!("tree:{}", p.id()),
                kind: "page".into(),
                title: p.title().to_owned(),
                collapse_key: Some(p.id().to_owned()),
                workspace_id: Some(p.workspace().to_owned()),
                page_id: Some(p.id().to_owned()),
                depth,
                has_kids: kids,
                collapsed,
                section: "tree".into(),
            });
            if kids && !collapsed {
                branch(state, Some(p.id()), None, depth + 1, parent_ids, rows);
            }
        }
    }

    for (ws_id, ws) in state.workspaces.iter() {
        let key = format!("ws:{ws_id}");
        let ws_collapsed = is_tree_collapsed(state, &key);
        let ws_name = ws.name.clone().unwrap_or_default();
        rows.push(SidebarTreeRowData {
            row_id: format!("head:{key}"),
            kind: "head".into(),
            title: ws_name,
            collapse_key: Some(key.clone()),
            workspace_id: Some(ws_id.clone()),
            page_id: None,
            depth: 0,
            has_kids: false,
            collapsed: ws_collapsed,
            section: String::new(),
        });
        if ws_collapsed {
            continue;
        }
        let before = rows.len();
        branch(state, None, Some(ws_id), 0, &parent_ids, &mut rows);
        if rows.len() == before {
            rows.push(SidebarTreeRowData {
                row_id: format!("empty:{ws_id}"),
                kind: "empty".into(),
                title: String::new(),
                collapse_key: None,
                workspace_id: Some(ws_id.clone()),
                page_id: None,
                depth: 0,
                has_kids: false,
                collapsed: false,
                section: String::new(),
            });
        }
    }

    rows
}
