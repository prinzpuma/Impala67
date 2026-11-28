//! Abfragen über den Zustand, die die Oberfläche und die KI-Werkzeuge nutzen (`STATE.*` in
//! `web/state.js`). Papierkorb und Archiv sickern über [`State::active_pages`] nirgends durch.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use impala_sort::SortExt;
use serde_json::Value;

use crate::event::LogEvent;
use crate::js;
use crate::order;
use crate::tree::deck_in_tree;
use crate::types::{Card, Page, State};

/// Neueste zuerst nach einem Zeitfeld (stabil); Schlüssel einmalig berechnet statt O(N log N).
fn newest_first<T>(list: Vec<&T>, at: impl Fn(&T) -> String) -> Vec<&T> {
    let mut keyed: Vec<(String, &T)> = list.into_iter().map(|item| (at(item), item)).collect();
    keyed.sort_small_by(|a, b| js::cmp(&b.0, &a.0));
    keyed.into_iter().map(|(_, item)| item).collect()
}

/// Sidebar-Reihenfolge: explizites `order`, sonst Erstellzeit (`sortKeyOf`).
pub fn sort_key_of(pg: &Page) -> f64 {
    pg.order.unwrap_or_else(|| impala_srs::Timestamp::parse_iso(pg.created_at()).map_or(0.0, |t| t.millis() as f64))
}

fn sort_by_sidebar(list: &mut Vec<&Page>) {
    if list.len() <= 1 {
        return;
    }
    let mut keyed: Vec<(f64, &Page)> = list.iter().map(|&p| (sort_key_of(p), p)).collect();
    keyed.sort_small_by(|a, b| {
        let d = a.0 - b.0;
        if d != 0.0 && !d.is_nan() {
            return if d < 0.0 { Ordering::Less } else { Ordering::Greater };
        }
        js::cmp(a.1.created_at(), b.1.created_at())
    });
    list.clear();
    list.extend(keyed.into_iter().map(|(_, p)| p));
}

/// Eine Version im Seitenverlauf.
#[derive(Debug, Clone, PartialEq)]
pub struct PageVersion {
    pub t: String,
    pub title: Value,
    pub content: Value,
}

fn str_field(c: &Card, key: &str) -> String {
    js::str_or_empty(c.get(key).as_ref())
}

impl State {
    /// Alle Seiten außerhalb von Papierkorb und Archiv (auch nicht unter einer archivierten Seite).
    pub fn active_pages(&self) -> Vec<&Page> {
        self.pages.values().filter(|p| !p.is_trashed() && !self.is_page_archived(p.id())).collect()
    }

    /// Favoriten (`!!page.favorite`) unter den aktiven Seiten, Reihenfolge wie [`State::active_pages`].
    /// Die billige Favoriten-Prüfung zuerst: die Archiv-Prüfung läuft die Elternkette hoch.
    pub fn favorite_pages(&self) -> Vec<&Page> {
        self.pages
            .values()
            .filter(|p| p.truthy("favorite") && !p.is_trashed() && !self.is_page_archived(p.id()))
            .collect()
    }

    pub fn trashed_pages(&self) -> Vec<&Page> {
        newest_first(self.pages.values().filter(|p| p.is_trashed()).collect(), |p| {
            p.trashed_at.clone().unwrap_or_default()
        })
    }

    pub fn archived_pages(&self) -> Vec<&Page> {
        let list = self.pages.values().filter(|p| !p.is_trashed() && self.is_page_archived(p.id())).collect();
        newest_first(list, |p| p.archived_at.clone().unwrap_or_default())
    }

    /// Wurzeln archivierter Teilbäume.
    pub fn archived_page_roots(&self) -> Vec<&Page> {
        self.archived_pages()
            .into_iter()
            .filter(|p| {
                p.is_archived_root()
                    || p.parent().is_none_or(|parent| self.pages.get(parent).is_none_or(|q| !q.is_archived()))
            })
            .collect()
    }

    /// Direkte Unterseiten (inkl. Papierkorb/Archiv), Seitenreihenfolge.
    pub fn child_pages_of(&self, id: Option<&str>) -> Vec<&Page> {
        let id = id.unwrap_or("");
        self.pages.values().filter(|p| p.parent().unwrap_or("") == id).collect()
    }

    /// Sichtbare Unterseiten in Sidebar-Reihenfolge (`childrenOf`). `workspace`: ausdrücklich
    /// gewählter Workspace; sonst der der Elternseite, sonst `current_workspace`.
    pub fn children_of(
        &self,
        id: Option<&str>,
        workspace: Option<&str>,
        current_workspace: Option<&str>,
    ) -> Vec<&Page> {
        let ws = self.child_workspace(id, workspace, current_workspace);
        let id = id.filter(|i| !i.is_empty());
        let mut kids: Vec<&Page> = self
            .pages
            .values()
            .filter(|p| p.parent().unwrap_or("") == id.unwrap_or(""))
            .filter(|p| !p.is_trashed() && !p.is_archived() && p.workspace() == ws)
            .collect();
        sort_by_sidebar(&mut kids);
        kids
    }

    /// Workspace, in dem [`State::children_of`] sucht: der angegebene, sonst der der Elternseite,
    /// sonst der aktuelle, sonst `default`.
    pub fn child_workspace<'a>(
        &'a self,
        id: Option<&str>,
        workspace: Option<&'a str>,
        current_workspace: Option<&'a str>,
    ) -> &'a str {
        let parent_ws = id.filter(|i| !i.is_empty()).and_then(|i| self.pages.get(i)).map(Page::workspace);
        workspace
            .filter(|w| !w.is_empty())
            .or(parent_ws)
            .or(current_workspace.filter(|w| !w.is_empty()))
            .unwrap_or("default")
    }

    /// Alle Kinderlisten von [`State::children_of`] in EINEM Durchlauf, Schlüssel
    /// (Eltern-ID, `""` = Wurzel; Workspace). Für Baumansichten: einzeln abgefragt kostet jeder
    /// Knoten einen Durchlauf über alle Seiten, der ganze Baum also quadratisch viel.
    pub fn sidebar_children(&self) -> HashMap<(&str, &str), Vec<&Page>> {
        let mut index: HashMap<(&str, &str), Vec<&Page>> = HashMap::new();
        for p in self.pages.values().filter(|p| !p.is_trashed() && !p.is_archived()) {
            index.entry((p.parent().unwrap_or(""), p.workspace())).or_default().push(p);
        }
        for kids in index.values_mut() {
            sort_by_sidebar(kids);
        }
        index
    }

    /// Elternkette für die Brotkrumen (ohne Papierkorb, Zyklen-sicher).
    pub fn ancestors_of(&self, id: &str) -> Vec<&Page> {
        let mut chain = Vec::new();
        let mut guard = HashSet::new();
        let mut cur = self.pages.get(id).and_then(|p| p.parent()).and_then(|p| self.pages.get(p));
        while let Some(pg) = cur {
            if pg.is_trashed() || !guard.insert(pg.id()) {
                break;
            }
            chain.push(pg);
            cur = pg.parent().and_then(|p| self.pages.get(p));
        }
        chain.reverse();
        chain
    }

    pub fn page_titles(&self) -> Vec<&str> {
        self.active_pages().into_iter().map(Page::title).collect()
    }

    /// Titel → erste nicht gelöschte Seite (Archiv inklusive): `[[Wiki-Links]]` auflösen.
    pub fn pages_by_title(&self) -> HashMap<&str, &Page> {
        let mut map = HashMap::new();
        for pg in self.pages.values().filter(|p| !p.is_trashed()) {
            let title = if pg.title().is_empty() { "Ohne Titel" } else { pg.title() };
            map.entry(title).or_insert(pg);
        }
        map
    }

    /// Seite per Titel: exakt vor Teilstring, aktive vor archivierten (`findPage`).
    pub fn find_page(&self, title: &str, include_archived: bool) -> Option<&Page> {
        if title.is_empty() {
            return None;
        }
        // Seiten-ID statt Titel (MCP-Werkzeuge liefern IDs mit): eindeutig, kein Raten.
        if let Some(pg) = self.pages.get(title).filter(|p| !p.is_trashed() && (include_archived || !p.is_archived())) {
            return Some(pg);
        }
        let q = impala_search::text::lower(title);
        // Pfad „Ordner/Seite“ (von oben nach unten), wenn keine Seite genau so heißt:
        // Titel wie „📖 Vorlesungen“ gibt es je Fach einmal, die KI nennt dann den Ordner mit.
        if title.contains('/')
            && !self.pages.values().any(|p| !p.is_trashed() && impala_search::text::lower(p.title()) == q)
            && let Some(pg) = self.find_by_path(title, include_archived)
        {
            return Some(pg);
        }
        let mut partial = None;
        for pg in self.active_pages() {
            let t = impala_search::text::lower(pg.title());
            if t == q {
                return Some(pg);
            }
            if partial.is_none() && t.contains(&q) {
                partial = Some(pg);
            }
        }
        if partial.is_some() || !include_archived {
            return partial;
        }
        for pg in self.pages.values().filter(|p| !p.is_trashed() && p.is_archived()) {
            let t = impala_search::text::lower(pg.title());
            if t == q {
                return Some(pg);
            }
            if partial.is_none() && t.contains(&q) {
                partial = Some(pg);
            }
        }
        partial
    }

    /// Titel der Vorfahren (nächster zuerst), klein geschrieben.
    fn ancestor_titles(&self, pg: &Page) -> Vec<String> {
        let mut out = vec![];
        let mut cur = pg.parent();
        while let Some(id) = cur {
            let Some(p) = self.pages.get(id) else { break };
            out.push(impala_search::text::lower(p.title()));
            cur = p.parent();
            if out.len() > 32 {
                break;
            }
        }
        out
    }

    /// Seite zu einem Pfad „Ordner/…/Seite“ (von oben nach unten): der letzte Teil ist der
    /// Seitentitel, die vorherigen Teile sind Vorfahren in dieser Reihenfolge; bei mehreren
    /// Treffern die am tiefsten liegende.
    fn find_by_path(&self, path: &str, include_archived: bool) -> Option<&Page> {
        let parts: Vec<String> =
            path.split('/').map(|s| impala_search::text::lower(s.trim())).filter(|s| !s.is_empty()).collect();
        let (target, parents) = parts.split_last()?;
        if parents.is_empty() {
            return None;
        }
        let mut best: Option<(&Page, usize)> = None;
        for p in self.pages.values().filter(|p| !p.is_trashed() && (include_archived || !p.is_archived())) {
            if impala_search::text::lower(p.title()) != *target {
                continue;
            }
            let anc = self.ancestor_titles(p);
            let mut pos = 0;
            let matches = parents.iter().rev().all(|need| {
                let Some(rel) = anc[pos..].iter().position(|a| a == need) else { return false };
                pos += rel + 1;
                true
            });
            if matches && best.is_none_or(|(_, d)| anc.len() > d) {
                best = Some((p, anc.len()));
            }
        }
        best.map(|(p, _)| p)
    }

    /// Anzeigename für die KI: der Titel, bei mehrfach vorhandenem Titel als Pfad
    /// („Kontinuumsmechanik/📖 Vorlesungen“), den [`State::find_page`] wieder auflöst.
    pub fn page_label(&self, pg: &Page) -> String {
        let t = impala_search::text::lower(pg.title());
        let twins = self.active_pages().iter().filter(|p| impala_search::text::lower(p.title()) == t).count();
        if twins < 2 {
            return pg.title().to_owned();
        }
        let mut names = vec![pg.title().to_owned()];
        let mut cur = pg.parent();
        while let Some(id) = cur {
            let Some(p) = self.pages.get(id) else { break };
            names.push(p.title().to_owned());
            cur = p.parent();
            if names.len() > 32 {
                break;
            }
        }
        names.reverse();
        names.join("/")
    }

    /// Aktive Karten: weder gelöscht noch selbst/über den Stapel archiviert.
    pub fn active_cards(&self) -> Vec<&Card> {
        self.cards.values().filter(|c| !c.is_trashed() && !self.is_card_archived(c)).collect()
    }

    /// Aktive Karten als PlainCard für Export oder Übertrag.
    pub fn active_plain_cards(&self) -> Vec<crate::card_transfer::PlainCard> {
        self.active_cards().into_iter().map(Card::to_plain).collect()
    }

    /// Bestehende Kartenschlüssel für Duplikaterkennung (ohne Papierkorb).
    pub fn existing_card_keys(&self) -> HashSet<String> {
        self.cards
            .values()
            .filter(|c| !c.is_trashed())
            .map(|c| crate::card_transfer::card_key(c.front(), c.back(), c.deck_name()))
            .collect()
    }

    pub fn archived_cards(&self) -> Vec<&Card> {
        newest_first(self.cards.values().filter(|c| !c.is_trashed() && c.is_archived()).collect(), |c| {
            str_field(c, "archivedAt")
        })
    }

    pub fn trashed_cards(&self) -> Vec<&Card> {
        newest_first(self.cards.values().filter(|c| c.is_trashed()).collect(), |c| str_field(c, "trashedAt"))
    }

    fn deck_roots(
        &self,
        flag: impl Fn(&crate::types::Deck) -> bool,
        at: impl Fn(&crate::types::Deck) -> String,
    ) -> Vec<String> {
        let names: Vec<&String> = self.decks.iter().filter(|(_, d)| flag(d)).map(|(n, _)| n).collect();
        let mut roots: Vec<&String> =
            names.iter().copied().filter(|n| !names.iter().any(|p| p != n && deck_in_tree(n, p))).collect();
        let stamp = |n: &String| self.decks.get(n).map(&at).unwrap_or_default();
        roots.sort_small_by(|a, b| js::cmp(&stamp(b), &stamp(a)));
        roots.into_iter().cloned().collect()
    }

    /// Wurzeln archivierter Stapel-Teilbäume (neueste zuerst).
    pub fn archived_deck_roots(&self) -> Vec<String> {
        self.deck_roots(|d| !d.is_trashed() && d.is_archived(), |d| d.archived_at.clone().unwrap_or_default())
    }

    /// Wurzeln gelöschter Stapel-Teilbäume (neueste zuerst).
    pub fn trashed_deck_roots(&self) -> Vec<String> {
        self.deck_roots(|d| d.is_trashed(), |d| d.trashed_at.clone().unwrap_or_default())
    }

    /// Einzeln archivierte Karten, deren Stapel nicht archiviert ist.
    pub fn orphan_archived_cards(&self) -> Vec<&Card> {
        self.archived_cards().into_iter().filter(|c| !self.is_deck_archived(c.deck_name())).collect()
    }

    /// Karten im Papierkorb, die nicht schon über einen gelöschten Stapel abgedeckt sind.
    pub fn orphan_trashed_cards(&self) -> Vec<&Card> {
        self.trashed_cards()
            .into_iter()
            .filter(|c| {
                let mut path = c.deck_name();
                while !path.is_empty() {
                    if self.decks.get(path).is_some_and(|d| d.is_trashed()) {
                        return false;
                    }
                    path = js::parent_path(path);
                }
                true
            })
            .collect()
    }
}

/// Seitenverlauf aus dem Log (`pageHistory`): jede Titel-/Inhaltsänderung eine Version.
pub fn page_history(mut events: Vec<LogEvent>, id: &str) -> Vec<PageVersion> {
    order::sort_events(&mut events);
    let mut out: Vec<PageVersion> = Vec::new();
    let mut cur: Option<(Value, Value)> = None;
    for ev in &events {
        let p = ev.fields();
        if p.get("id").and_then(Value::as_str) != Some(id) {
            continue;
        }
        match ev.kind.as_str() {
            "pageCreate" => {
                let title = js::or_str(p.get("title"), "Ohne Titel");
                let content = js::or_str(p.get("content"), "");
                out.push(PageVersion { t: ev.t.clone(), title: title.clone(), content: content.clone() });
                cur = Some((title, content));
            }
            "pageUpdate" => {
                let (Some((title, content)), Some(patch)) = (&cur, p.get("patch").and_then(Value::as_object)) else {
                    continue;
                };
                if !patch.contains_key("title") && !patch.contains_key("content") {
                    continue;
                }
                let pick = |k: &str, old: &Value| patch.get(k).cloned().unwrap_or_else(|| old.clone());
                let next = (pick("title", title), pick("content", content));
                out.push(PageVersion { t: ev.t.clone(), title: next.0.clone(), content: next.1.clone() });
                cur = Some(next);
            }
            _ => {}
        }
    }
    out
}
