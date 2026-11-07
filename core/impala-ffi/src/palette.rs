//! Befehlspalette (Strg+K) und Einstellungssuche für native Apps (iOS, Android).
//! Nutzt die Logik aus `impala-search::palette` und `impala-search::settings`.

use impala_search::{
    ChatSearchDoc, SettingsIndex, SettingsItemDef, filter_actions, format_page_path, highlight_ranges_utf16,
    normalize_settings_text, preview, search_chats,
};
use serde_json::Value;

use crate::chats::ChatInfo;
use crate::{ImpalaCore, PageSummary, summary};

/// Ein UTF-16-Markierungsbereich (`start..end`) im Text.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct HighlightSpan {
    pub start: u32,
    pub end: u32,
}

/// Ein Seitentreffer der Befehlspalette samt gekürztem Vorschau-Ausschnitt, Brotkrumen-Pfad und Archiv-Flag.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct PalettePageHit {
    pub summary: PageSummary,
    pub archived: bool,
    pub snippet: String,
    pub path: String,
    pub terms: Vec<String>,
}

/// Eine Schnell-Aktion (Kennung + lokalisierter Anzeigetext der App) für den Filter.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct PaletteActionDef {
    pub id: String,
    pub label: String,
}

/// Ein Eintrag des Einstellungs-Suchindex (von der App übergeben oder aus dem Standard-Katalog).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct SettingsSearchEntry {
    pub id: String,
    pub section: String,
    pub section_label: String,
    pub group: String,
    pub label: String,
    pub description: String,
    pub keywords: String,
}

/// Treffer der Einstellungssuche.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct SettingsSearchHit {
    pub id: String,
    pub section: String,
    pub score: u32,
}

/// Kürzt einen Ausschnitt auf 110 Zeichen (`snippet.replace(/\s+/g, " ").trim().slice(0, 110)`).
#[uniffi::export]
pub fn search_preview(snippet: String) -> String {
    preview(&snippet)
}

/// Zu markierende UTF-16-Bereiche in `text` für `query` und optionale Wortformen `terms`.
#[uniffi::export]
pub fn search_highlight_ranges(text: String, query: String, terms: Vec<String>) -> Vec<HighlightSpan> {
    highlight_ranges_utf16(&text, &query, &terms).into_iter().map(|(start, end)| HighlightSpan { start, end }).collect()
}

/// Filtert Schnell-Aktionen nach `query` (ohne Groß-/Kleinschreibung); liefert die passenden IDs in Eingabereihenfolge.
#[uniffi::export]
pub fn search_filter_actions(actions: Vec<PaletteActionDef>, query: String) -> Vec<String> {
    let pairs: Vec<(String, String)> = actions.into_iter().map(|a| (a.id, a.label)).collect();
    filter_actions(&pairs, &query)
}

/// Durchsucht den Standard-Einstellungskatalog (`platform`: `"web"`, `"native"`, oder `None` für alle).
#[uniffi::export]
pub fn search_settings_catalog(query: String, limit: u32, platform: Option<String>) -> Vec<SettingsSearchHit> {
    let plat = platform.as_deref().filter(|s| !s.is_empty());
    SettingsIndex::default_catalog()
        .search(&query, limit as usize, plat)
        .into_iter()
        .map(|h| SettingsSearchHit { id: h.id, section: h.section, score: h.score })
        .collect()
}

/// Durchsucht übergebene Einstellungs-Einträge nach `query` wie `searchSettings` der PWA.
#[uniffi::export]
pub fn search_settings_items(entries: Vec<SettingsSearchEntry>, query: String, limit: u32) -> Vec<SettingsSearchHit> {
    let defs: Vec<SettingsItemDef> = entries
        .into_iter()
        .map(|e| {
            let title = normalize_settings_text(&e.label);
            let haystack = normalize_settings_text(&format!(
                "{} {} {} {} {}",
                e.label, e.description, e.group, e.keywords, e.section_label
            ));
            SettingsItemDef { id: e.id, section: e.section, platform: None, title, haystack }
        })
        .collect();
    SettingsIndex::from_items(defs)
        .search(&query, limit as usize, None)
        .into_iter()
        .map(|h| SettingsSearchHit { id: h.id, section: h.section, score: h.score })
        .collect()
}

fn text_of(v: Option<Value>) -> String {
    match v {
        Some(Value::String(s)) => s,
        _ => String::new(),
    }
}

#[uniffi::export]
impl ImpalaCore {
    /// Brotkrumen-Pfad einer Seite (`Workspace › Eltern › …`).
    pub fn page_path_label(&self, page_id: String) -> String {
        let inner = self.lock();
        let state = inner.model.state();
        let Some(pg) = state.pages.get(&page_id) else { return String::new() };
        let ws_name = state
            .workspaces
            .get(pg.workspace())
            .or_else(|| state.workspaces.get("default"))
            .and_then(|w| w.name.as_deref());
        let ancestors: Vec<String> = state.ancestors_of(&page_id).into_iter().map(|p| p.title().to_owned()).collect();
        format_page_path(ws_name, &ancestors)
    }

    /// Seitentreffer für die Befehlspalette: ohne `query` die `recent_limit` zuletzt bearbeiteten Seiten,
    /// mit `query` die Volltext-Treffer (inkl. Archiv) samt gekürztem Vorschau-Ausschnitt und Brotkrumen-Pfad.
    pub fn palette_pages(&self, query: String, recent_limit: u32) -> Vec<PalettePageHit> {
        let ql = query.trim();
        if ql.is_empty() {
            let inner = self.lock();
            let state = inner.model.state();
            let mut pages = state.active_pages();
            pages.sort_by(|a, b| b.updated().cmp(a.updated()));
            pages.truncate(recent_limit as usize);
            return pages
                .into_iter()
                .map(|pg| {
                    let ws_name = state
                        .workspaces
                        .get(pg.workspace())
                        .or_else(|| state.workspaces.get("default"))
                        .and_then(|w| w.name.as_deref());
                    let ancestors: Vec<String> =
                        state.ancestors_of(pg.id()).into_iter().map(|p| p.title().to_owned()).collect();
                    PalettePageHit {
                        summary: summary(pg),
                        archived: false,
                        snippet: String::new(),
                        path: format_page_path(ws_name, &ancestors),
                        terms: Vec::new(),
                    }
                })
                .collect();
        }
        let mut guard = self.lock();
        let inner = &mut *guard;
        let hits = inner.search.search(&inner.model, ql, true);
        let state = inner.model.state();
        hits.into_iter()
            .filter_map(|h| {
                let pg = state.pages.get(&h.id)?;
                let ws_name = state
                    .workspaces
                    .get(pg.workspace())
                    .or_else(|| state.workspaces.get("default"))
                    .and_then(|w| w.name.as_deref());
                let ancestors: Vec<String> =
                    state.ancestors_of(&h.id).into_iter().map(|p| p.title().to_owned()).collect();
                Some(PalettePageHit {
                    summary: summary(pg),
                    archived: state.is_page_archived(&h.id),
                    snippet: preview(&h.snippet),
                    path: format_page_path(ws_name, &ancestors),
                    terms: h.terms.unwrap_or_default(),
                })
            })
            .collect()
    }

    /// Durchsucht Chats für die Befehlspalette (sortiert nach `updated` absteigend):
    /// ohne `query` die ersten `limit` Chats, mit `query` Treffer in Titel oder Nachrichteninhalt.
    pub fn palette_chats(&self, query: String, include_messages: bool, limit: u32) -> Vec<ChatInfo> {
        let inner = self.lock();
        let mut raw_chats: Vec<(&impala_model::ChatSession, ChatInfo)> = inner
            .model
            .state()
            .chat_sessions
            .values()
            .filter(|c| !c.is_deleted())
            .map(|c| {
                let info = ChatInfo {
                    id: text_of(c.get("id")),
                    title: text_of(c.get("title")),
                    created: text_of(c.get("created")),
                    updated: text_of(c.get("updated")),
                    message_count: match c.get("messages") {
                        Some(Value::Array(a)) => a.len() as u32,
                        _ => 0,
                    },
                };
                (c, info)
            })
            .collect();
        raw_chats.sort_by(|a, b| b.1.updated.cmp(&a.1.updated));

        let ql = query.trim();
        if ql.is_empty() {
            return raw_chats.into_iter().take(limit as usize).map(|(_, info)| info).collect();
        }

        let docs: Vec<ChatSearchDoc> = raw_chats
            .iter()
            .map(|(c, info)| {
                let messages = match c.get("messages") {
                    Some(Value::Array(arr)) => {
                        arr.iter().filter_map(|m| m.get("content").and_then(Value::as_str).map(str::to_owned)).collect()
                    }
                    _ => Vec::new(),
                };
                ChatSearchDoc { id: info.id.clone(), title: info.title.clone(), messages }
            })
            .collect();

        let matched_ids = search_chats(&docs, ql, include_messages, limit as usize);
        matched_ids
            .into_iter()
            .filter_map(|id| raw_chats.iter().find(|(_, info)| info.id == id).map(|(_, info)| info.clone()))
            .collect()
    }
}
