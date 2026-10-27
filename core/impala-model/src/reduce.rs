//! Reducer: wendet ein Event auf den Zustand an (`reduce`/`applyEvent` in `web/state.js`).
//!
//! Rein und deterministisch: Zeit und IDs kommen aus dem Event. Jedes Gerät spielt dasselbe Log
//! ab und muss denselben Zustand erhalten – deshalb folgt der Reducer dem JS auch dort, wo es
//! eigenwillig ist (siehe Kommentare „wie JS“). Ein Event, das nicht passt, ändert nichts.

use std::collections::HashSet;

use impala_heft::HeftEvent;
use serde_json::{Value, json};

use crate::event::{Event, LogEvent};
use crate::js::{self, Object};
use crate::record::spread;
use crate::tree::deck_in_tree;
use crate::types::{
    Card, ChatSession, Deck, GnFolder, Grade, HomeArticle, LearningSession, Page, Review, State, Telemetry, Workspace,
};

/// Laufzeit-Umstände, die das JS beim Anwenden liest (nur außerhalb des Starts).
#[derive(Debug, Clone, Copy, Default)]
pub struct Live<'a> {
    /// Gerade offener Chat (`S.currentChatId`): sein Tab bleibt, auch wenn die Sitzung noch fehlt.
    /// Wie JS gilt bei `None` der Tab `"chat:null"` als offen.
    pub current_chat_id: Option<&'a str>,
}

/// Nebenwirkungen eines Events außerhalb des gespeicherten Zustands.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Effects {
    /// `heftBlob`: Hash und Länge (UTF-16) der Bilddaten – auch, wenn der Hash schon bekannt war.
    pub blob: Option<(String, usize)>,
    /// Heft, das sich geändert hat (`heftOps`/`heftSnap`).
    pub heft_page: Option<String>,
    /// Endgültig gelöschte Seite: ihr Suchvektor muss weg.
    pub deleted_page: Option<String>,
}

/// FSRS-Anfangsstand einer neuen Karte (`SRS.newCard`).
pub fn new_srs(t: &str) -> Value {
    json!({ "state": "new", "stability": 0, "difficulty": 5, "due": t, "reps": 0, "lapses": 0, "step": 0, "last": null })
}

fn s(v: &str) -> Value {
    Value::from(v)
}

/// `String(x || "")` eines Datensatzfeldes.
fn text_of(v: Option<Value>) -> String {
    js::str_or_empty(v.as_ref())
}

/// `String(x).trim().slice(0, n)`, leer/„falsch“ → `null`.
fn clipped(v: Option<&Value>, n: usize) -> Value {
    match js::or(v) {
        Some(v) => s(js::head16(js::trim(&js::to_string(v)), n)),
        None => Value::Null,
    }
}

/// `{ ...provider, key }` – kein Objekt ergibt `{}` (Abweichung: JS zerlegt Texte in Zeichen).
fn with_key(provider: &Value, key: Value) -> Value {
    let mut o = spread(Some(provider));
    o.insert("key".into(), key);
    Value::Object(o)
}

/// Text mit sichtbarem Inhalt (`key.trim().length > 0`).
fn has_key(v: Option<&Value>) -> bool {
    v.and_then(Value::as_str).is_some_and(|k| !js::trim(k).is_empty())
}

/// `SETTINGS_SYNC.mergePatch`: Ein Patch ohne Schlüssel löscht keinen vorhandenen; `key: null`
/// leert ihn ausdrücklich. `None`: das JS wirft (Quelle `null`) und überspringt das Event.
pub fn merge_settings_patch(current: &crate::types::Settings, patch: &Object) -> Option<Object> {
    let mut next = patch.clone();
    let Some(Value::Array(incoming)) = next.get("aiProviders") else { return Some(next) };
    let old: Vec<Value> = match (&current.ai_providers, current.extra.get("aiProviders")) {
        (Some(list), _) => list.clone(),
        (None, Some(v)) if js::truthy(v) => return None, // `.map` auf Nicht-Liste
        _ => Vec::new(),
    };
    if old.iter().any(Value::is_null) || incoming.iter().any(Value::is_null) {
        return None;
    }
    // new Map(…): der letzte Eintrag je ID gewinnt.
    let old_by_id = |id: Option<&Value>| old.iter().rev().find(|p| p.get("id") == id);
    let merged: Vec<Value> = incoming
        .iter()
        .map(|provider| {
            if provider.get("key").is_some_and(Value::is_null) {
                return with_key(provider, s(""));
            }
            if has_key(provider.get("key")) {
                return provider.clone();
            }
            match old_by_id(provider.get("id")).and_then(|o| o.get("key")).filter(|k| has_key(Some(k))) {
                Some(k) => with_key(provider, k.clone()),
                None => provider.clone(),
            }
        })
        .collect();
    next.insert("aiProviders".into(), Value::Array(merged));
    Some(next)
}

impl State {
    /// Wendet ein Event an wie beim Start (Replay). Siehe [`State::apply_live`].
    pub fn apply(&mut self, ev: &LogEvent) -> Effects {
        self.apply_event(ev, Event::parse(&ev.kind, &ev.payload), None)
    }

    /// Wie [`State::apply`], verbraucht das Event aber (Heft-Striche ohne Kopie).
    pub fn apply_owned(&mut self, mut ev: LogEvent, live: Option<Live>) -> Effects {
        if matches!(ev.kind.as_str(), "heftOps" | "heftSnap" | "heftBlob") {
            let payload = match std::mem::take(&mut ev.payload) {
                p @ Value::Object(_) => p,
                _ => Value::Object(Object::new()),
            };
            let h = HeftEvent::from_payload(&ev.kind, payload);
            return self.apply_event(&ev, Event::Heft(h), live);
        }
        self.apply_event(&ev, Event::parse(&ev.kind, &ev.payload), live)
    }

    /// Wendet ein Event zur Laufzeit an (eigene oder eingetroffene Änderung).
    pub fn apply_live(&mut self, ev: &LogEvent, live: Live) -> Effects {
        self.apply_event(ev, Event::parse(&ev.kind, &ev.payload), Some(live))
    }

    /// Wendet ein schon gedeutetes Event an.
    pub fn apply_event(&mut self, ev: &LogEvent, event: Event, live: Option<Live>) -> Effects {
        let t = ev.t.as_str();
        let mut fx = Effects::default();
        if let Event::Heft(Some(h)) = event {
            match &h {
                HeftEvent::Ops { page_id, .. } | HeftEvent::Snap { page_id, .. } => {
                    if let Some(pg) = self.pages.get_mut(page_id) {
                        pg.set("updated", s(t));
                    }
                    fx.heft_page = Some(page_id.clone());
                }
                HeftEvent::Blob { hash, data } => fx.blob = Some((hash.clone(), js::len16(data))),
            }
            self.hefte.apply(h);
            return fx;
        }
        match &event {
            Event::PageCreate(p) => {
                let mut pg = Page::default();
                pg.set("id", s(&p.id));
                pg.set("title", p.title.clone().unwrap_or_else(|| s("Ohne Titel")));
                pg.set("parentId", p.parent_id.clone().unwrap_or(Value::Null));
                pg.set("content", p.content.clone().unwrap_or_else(|| s("")));
                pg.set("pdfId", p.pdf_id.clone().unwrap_or(Value::Null));
                pg.set("tags", p.tags.clone().unwrap_or_else(|| json!([])));
                pg.set("workspaceId", p.workspace_id.clone().unwrap_or_else(|| s("default")));
                for (k, v) in [
                    ("icon", &p.icon),
                    ("cover", &p.cover),
                    ("coverImg", &p.cover_img),
                    ("daily", &p.daily),
                    ("dailyRoot", &p.daily_root),
                    ("db", &p.db),
                    ("props", &p.props),
                    ("notionId", &p.notion_id),
                ] {
                    pg.set(k, v.clone().unwrap_or(Value::Null));
                }
                pg.set("kind", s(if p.heft { "heft" } else { "notion" }));
                pg.set("order", p.order.map_or(Value::Null, js::num));
                pg.set("gnFolderId", p.gn_folder_id.clone().unwrap_or(Value::Null));
                pg.set("gnOrder", p.gn_order.map_or(Value::Null, js::num));
                // `p.created || ev.t || new Date()` – ohne Zeit bleibt es leer (deterministisch).
                pg.set("created", p.created.clone().unwrap_or_else(|| s(t)));
                pg.set("updated", s(t));
                self.pages.insert(p.id.clone(), pg);
            }
            Event::PageUpdate { id: Some(id), patch } => {
                if let Some(pg) = self.pages.get_mut(id) {
                    pg.assign(patch);
                    pg.set("updated", s(t));
                }
            }
            Event::PageMove { id: Some(id), parent_id, order } => {
                if self.pages.contains_key(id) {
                    let target = parent_id.as_ref().map(js::to_string);
                    if !self.page_in_tree(target.as_deref(), id)
                        && let Some(pg) = self.pages.get_mut(id)
                    {
                        pg.set("parentId", parent_id.clone().unwrap_or(Value::Null));
                        if let Some(o) = order {
                            pg.set("order", js::num(*o));
                        }
                    }
                }
            }
            Event::PageDelete { id } => {
                let key = id.clone().unwrap_or_else(|| "undefined".into());
                if let Some(id) = id {
                    self.close_page_tabs(&HashSet::from([id.clone()]));
                    fx.deleted_page = Some(id.clone());
                }
                for pg in self.pages.values_mut() {
                    // `pg.parentId === p.id`; ohne ID trifft das Seiten ohne parentId (wie JS).
                    let hit = match id {
                        Some(id) => pg.parent_id.as_deref() == Some(id),
                        None => !pg.has("parentId"),
                    };
                    if hit {
                        pg.set("parentId", Value::Null);
                    }
                }
                self.hefte.docs.remove(&key);
                self.pages.remove(&key);
            }
            Event::PageTrash { id: Some(id) } => {
                let ids = self.page_subtree(id);
                for id in &ids {
                    if let Some(pg) = self.pages.get_mut(id) {
                        pg.set("trashed", Value::Bool(true));
                        pg.set("trashedAt", s(t));
                    }
                }
                self.close_page_tabs(&ids.into_iter().collect());
            }
            Event::PageRestore { id: Some(id) } => {
                for id in self.page_subtree(id) {
                    if let Some(pg) = self.pages.get_mut(&id) {
                        pg.set("trashed", Value::Bool(false));
                        pg.remove("trashedAt");
                    }
                }
            }
            Event::PageArchive { id: Some(root) } => {
                let ids = self.page_subtree(root);
                for id in &ids {
                    if let Some(pg) = self.pages.get_mut(id)
                        && !pg.is_trashed()
                    {
                        pg.set("archived", Value::Bool(true));
                        pg.set("archivedAt", s(t));
                        if id == root {
                            pg.set("archivedRoot", Value::Bool(true));
                        }
                    }
                }
                self.close_page_tabs(&ids.into_iter().collect());
            }
            Event::PageUnarchive { id: Some(root) } => {
                for id in self.page_subtree(root) {
                    if let Some(pg) = self.pages.get_mut(&id) {
                        pg.set("archived", Value::Bool(false));
                        pg.remove("archivedAt");
                        pg.remove("archivedRoot");
                    }
                }
                let parent = self.pages.get(root).and_then(|p| p.parent()).map(str::to_owned);
                if let Some(parent) = parent
                    && self.pages.get(&parent).is_some_and(|p| p.is_archived() || p.is_trashed())
                    && let Some(pg) = self.pages.get_mut(root)
                {
                    pg.set("parentId", Value::Null);
                }
            }
            Event::LearningSessionUpsert(p) => {
                let current = self.learning_sessions.get(&p.id);
                let updated = p.updated.clone().unwrap_or_else(|| s(t));
                if current.is_some_and(|c| js::lt(&js::to_string(&updated), &text_of(c.get("updated")))) {
                    return fx;
                }
                let segments: Vec<Value> = p
                    .segments
                    .iter()
                    .copied()
                    .flatten()
                    .filter_map(|seg| {
                        let part = |k: &str| js::str_or_empty(seg.as_object().and_then(|o| o.get(k)));
                        let (a, b) = (part("startedAt"), part("endedAt"));
                        (!a.is_empty() && !b.is_empty()).then(|| json!({ "startedAt": a, "endedAt": b }))
                    })
                    .collect();
                let keep = |k: &str| current.and_then(|c| js::or(c.get(k).as_ref()).cloned()).unwrap_or(Value::Null);
                let subject = match &p.subject {
                    Some(v) => clipped(v.as_ref(), 80),
                    None => keep("subject"),
                };
                let subject_source = match &p.subject_source {
                    Some(v) => clipped(v.as_ref(), 24),
                    None => keep("subjectSource"),
                };
                let mut ls = LearningSession::default();
                ls.set("id", s(&p.id));
                ls.set("startedAt", p.started_at.clone().unwrap_or_else(|| s(t)));
                ls.set("endedAt", p.ended_at.clone().unwrap_or_else(|| s(t)));
                ls.set("durationSeconds", js::num(js::round(p.duration_seconds).max(0.0)));
                ls.set("segments", Value::Array(segments));
                ls.set("category", p.category.clone().unwrap_or_else(|| s("other")));
                ls.set("subject", subject);
                ls.set("subjectSource", subject_source);
                ls.set("sourceId", p.source_id.clone().unwrap_or(Value::Null));
                ls.set("updated", updated);
                ls.set("deleted", Value::Bool(false));
                self.learning_sessions.insert(p.id.clone(), ls);
            }
            Event::LearningSessionDelete { id, updated } => {
                let updated = updated.clone().unwrap_or_else(|| s(t));
                let mut ls = match self.learning_sessions.get(id) {
                    Some(c) => c.clone(),
                    None => LearningSession { id: Some(id.clone()), ..Default::default() },
                };
                if js::lt(&js::to_string(&updated), &text_of(ls.get("updated"))) {
                    return fx;
                }
                ls.set("deleted", Value::Bool(true));
                ls.set("updated", updated);
                self.learning_sessions.insert(id.clone(), ls);
            }
            Event::TeleEvent { id, kind, data } => {
                let mut tel = Telemetry::default();
                tel.set("id", id.clone().unwrap_or_else(|| s(&ev.id)));
                tel.set("t", s(t));
                tel.set("kind", s(&js::to_string(kind)));
                tel.set("data", data.clone().unwrap_or_else(|| json!({})));
                self.telemetry.push(tel);
            }
            Event::GradeAdd(p) => {
                let mut g = Grade::default();
                g.set("id", s(&p.id));
                g.set("subject", s(js::trim(&js::to_string(&p.subject))));
                g.set("grade", js::num(p.grade.clamp(1.0, 6.0)));
                let w = js::to_number(p.weight.as_ref());
                g.set("weight", js::num(if w.is_nan() || w == 0.0 { 1.0f64 } else { w }.max(0.25)));
                g.set("date", p.date.clone().unwrap_or_else(|| s(js::head16(t, 10))));
                g.set("comment", p.comment.clone().unwrap_or_else(|| s("")));
                g.set("created", s(t));
                self.grades.insert(p.id.clone(), g);
            }
            Event::GradeDelete { id: Some(id) } => {
                if let Some(g) = self.grades.get_mut(id) {
                    g.set("deleted", Value::Bool(true));
                }
            }
            Event::CardCreate(p) => {
                let mut c = Card::default();
                c.set("id", s(&p.id));
                if let Some(v) = &p.front {
                    c.set("front", v.clone());
                }
                if let Some(v) = &p.back {
                    c.set("back", v.clone());
                }
                c.set("pageId", p.page_id.clone().unwrap_or(Value::Null));
                c.set("deck", p.deck.clone().unwrap_or_else(|| s("Standard")));
                c.set("suspended", Value::Bool(false));
                c.set("type", p.card_type.clone().unwrap_or_else(|| s("basic")));
                c.set("cloze", p.cloze.clone().unwrap_or(Value::Null));
                c.set("srs", p.srs.clone().unwrap_or_else(|| new_srs(t)));
                c.set("created", s(t));
                self.cards.insert(p.id.clone(), c);
                if let Some(deck) = &p.deck {
                    let name = js::to_string(deck);
                    match self.decks.get_mut(&name) {
                        None => {
                            let mut d = Deck::new(&name, t);
                            d.set("name", deck.clone());
                            self.decks.insert(name, d);
                        }
                        // Lag der Stapel im Papierkorb, landete die Karte sonst unsichtbar darin.
                        Some(d) if d.is_trashed() => {
                            d.set("trashed", Value::Bool(false));
                            d.remove("trashedAt");
                        }
                        Some(_) => {}
                    }
                }
            }
            Event::CardReview(p) => self.card_review(ev, p),
            Event::CardReviewUndo { id: Some(id), srs: Some(srs), unsuspend, review_id } => {
                let Some(deck) = self.cards.get(id).map(|c| text_of(c.get("deck"))) else { return fx };
                let conf = self.deck_conf(&deck);
                let Some(c) = self.cards.get_mut(id) else { return fx };
                c.set("srs", srs.clone());
                let lapses = js::or(srs.get("lapses")).cloned().unwrap_or(json!(0));
                if js::value_lt(&lapses, conf.leech_threshold()) {
                    c.set("leech", Value::Bool(false));
                }
                if *unsuspend {
                    c.set("suspended", Value::Bool(false));
                }
                let hit = self.reviews.iter().rposition(|r| match review_id {
                    Some(rid) => r.field_is("id", rid),
                    None => r.card_id.as_deref() == Some(id),
                });
                if let Some(i) = hit {
                    self.reviews.remove(i);
                }
            }
            Event::CardUpdate { id: Some(id), patch } => {
                if let Some(c) = self.cards.get_mut(id) {
                    c.assign(patch);
                }
            }
            Event::CardArchive { id: Some(id) } => {
                if let Some(c) = self.cards.get_mut(id)
                    && !c.is_trashed()
                {
                    c.set("archived", Value::Bool(true));
                    c.set("archivedAt", s(t));
                }
            }
            Event::CardUnarchive { id: Some(id) } => {
                if let Some(c) = self.cards.get_mut(id) {
                    c.set("archived", Value::Bool(false));
                    c.remove("archivedAt");
                }
            }
            Event::CardTrash { id: Some(id) } => {
                if let Some(c) = self.cards.get_mut(id) {
                    c.set("trashed", Value::Bool(true));
                    c.set("trashedAt", s(t));
                }
            }
            Event::CardRestore { id: Some(id) } => {
                let Some(c) = self.cards.get_mut(id) else { return fx };
                c.set("trashed", Value::Bool(false));
                c.remove("trashedAt");
                let d = text_of(c.get("deck"));
                let d = if d.is_empty() { "Standard".to_owned() } else { d };
                match self.decks.get_mut(&d) {
                    None => self.decks.insert(d.clone(), Deck::new(&d, t)),
                    Some(deck) if deck.is_trashed() => {
                        deck.set("trashed", Value::Bool(false));
                        deck.remove("trashedAt");
                    }
                    Some(_) => {}
                }
            }
            Event::CardDelete { id } => {
                self.cards.remove(id.as_deref().unwrap_or("undefined"));
            }
            Event::DeckCreate { name: Some(name) } => self.decks.insert(name.clone(), Deck::new(name, t)),
            Event::DeckRename { from: Some(from), to } => self.rename_deck_tree(from, to),
            Event::DeckReorder { name: Some(name), order: Some(order) } => {
                self.decks.get_or_insert_with(name, || Deck::new(name, t)).set("order", js::num(*order));
            }
            Event::DeckArchive { name: Some(name) } => {
                let d = self.decks.get_or_insert_with(name, || Deck::new(name, t));
                if !d.is_trashed() {
                    d.set("archived", Value::Bool(true));
                    d.set("archivedAt", s(t));
                }
            }
            Event::DeckUnarchive { name: Some(name) } => {
                if let Some(d) = self.decks.get_mut(name) {
                    d.set("archived", Value::Bool(false));
                    d.remove("archivedAt");
                }
            }
            Event::DeckTrash { name: Some(name) } => {
                for id in self.cards_in_deck_tree(name, true) {
                    if let Some(c) = self.cards.get_mut(&id) {
                        c.set("trashed", Value::Bool(true));
                        c.set("trashedAt", s(t));
                    }
                }
                for n in self.deck_subtree(name) {
                    let d = self.decks.get_or_insert_with(&n, || Deck::new(&n, t));
                    d.set("trashed", Value::Bool(true));
                    d.set("trashedAt", s(t));
                }
            }
            Event::DeckRestore { name: Some(name) } => {
                for n in self.deck_subtree(name) {
                    if let Some(d) = self.decks.get_mut(&n) {
                        d.set("trashed", Value::Bool(false));
                        d.remove("trashedAt");
                    }
                }
                for id in self.cards_in_deck_tree(name, true) {
                    if let Some(c) = self.cards.get_mut(&id) {
                        c.set("trashed", Value::Bool(false));
                        c.remove("trashedAt");
                    }
                }
            }
            Event::DeckDelete { name: Some(name) } => {
                for id in self.cards_in_deck_tree(name, true) {
                    self.cards.remove(&id);
                }
                for n in self.deck_subtree(name) {
                    self.decks.remove(&n);
                }
            }
            Event::DeckMove { from: Some(from), target } => {
                let target = target.as_deref().unwrap_or("");
                // Kein Stapel in sich selbst oder einen eigenen Unterstapel.
                if deck_in_tree(target, from) {
                    return fx;
                }
                let leaf = from.rsplit("::").next().unwrap_or(from);
                let to = if target.is_empty() { leaf.to_owned() } else { format!("{target}::{leaf}") };
                if &to != from {
                    self.rename_deck_tree(from, &to);
                }
            }
            Event::DeckDuplicate { name: Some(from) } => self.duplicate_deck(ev, from),
            Event::WorkspaceCreate { id: Some(id), name } => {
                let mut w = Workspace::default();
                w.set("id", s(id));
                w.set("name", name.clone().unwrap_or_else(|| s("Workspace")));
                w.set("created", s(t));
                self.workspaces.insert(id.clone(), w);
            }
            Event::GnFolderCreate { id: Some(id), title, parent_id, order } => {
                let mut f = GnFolder::default();
                f.set("id", s(id));
                f.set("title", title.clone().unwrap_or_else(|| s("Neuer Ordner")));
                f.set("parentId", parent_id.clone().unwrap_or(Value::Null));
                let fallback = impala_srs::Timestamp::parse_iso(t).map_or(0.0, |ts| ts.millis() as f64);
                f.set("order", js::num(order.unwrap_or(fallback)));
                f.set("created", s(t));
                f.set("updated", s(t));
                self.gn_folders.insert(id.clone(), f);
            }
            Event::GnFolderMove { id: Some(id), parent_id, order } => {
                if !self.gn_folders.contains_key(id) {
                    return fx;
                }
                let mut cur = parent_id.clone();
                let mut hops = 0;
                while let Some(c) = cur {
                    hops += 1;
                    if &c == id || hops > 10_000 {
                        return fx;
                    }
                    cur = self.gn_folders.get(&c).and_then(|f| f.parent()).map(str::to_owned);
                }
                if let Some(f) = self.gn_folders.get_mut(id) {
                    f.set("parentId", parent_id.clone().map_or(Value::Null, Value::from));
                    if let Some(o) = order {
                        f.set("order", js::num(*o));
                    }
                    f.set("updated", s(t));
                }
            }
            Event::GnItemMove { id: Some(id), folder_id, order } => {
                if folder_id.as_ref().is_some_and(|f| !self.gn_folders.contains_key(f)) {
                    return fx;
                }
                if let Some(pg) = self.pages.get_mut(id)
                    && pg.is_heft()
                {
                    pg.set("gnFolderId", folder_id.clone().map_or(Value::Null, Value::from));
                    if let Some(o) = order {
                        pg.set("gnOrder", js::num(*o));
                    }
                    pg.set("updated", s(t));
                }
            }
            Event::GnFolderDelete { id: Some(id) } => {
                let Some(folder) = self.gn_folders.get(id) else { return fx };
                // Hefte und Unterordner rücken eine Ebene höher; nichts geht verloren.
                let fid = folder.id.clone().unwrap_or_else(|| "undefined".into());
                let parent = folder.parent().map_or(Value::Null, Value::from);
                for f in self.gn_folders.values_mut() {
                    if f.parent_id.as_deref() == Some(&fid) {
                        f.set("parentId", parent.clone());
                    }
                }
                for pg in self.pages.values_mut() {
                    if pg.gn_folder_id.as_deref() == Some(&fid) {
                        pg.set("gnFolderId", parent.clone());
                    }
                }
                self.gn_folders.remove(&fid);
            }
            Event::ChatUpsert(p) => {
                let updated = p.updated.clone().unwrap_or_else(|| s(t));
                // Last-write-wins je Chat: ein älterer Import überschreibt weder Neueres noch ein Löschen.
                if let Some(c) = self.chat_sessions.get(&p.id) {
                    let stamp = text_of(js::or(c.get("deletedAt").as_ref()).cloned().or_else(|| c.get("updated")));
                    if js::lt(&js::to_string(&updated), &stamp) {
                        return fx;
                    }
                }
                let mut c = ChatSession::default();
                c.set("id", s(&p.id));
                c.set("title", p.title.clone().unwrap_or_else(|| s("")));
                c.set("messages", Value::Array(p.messages.to_vec()));
                c.set("created", p.created.clone().unwrap_or_else(|| s(t)));
                c.set("updated", updated);
                c.set("deleted", Value::Bool(false));
                self.chat_sessions.insert(p.id.clone(), c);
            }
            Event::ChatDelete { id, deleted_at } => {
                let deleted_at = deleted_at.clone().unwrap_or_else(|| s(t));
                let mut c = match self.chat_sessions.get(id) {
                    Some(c) => c.clone(),
                    None => ChatSession { id: Some(id.clone()), ..Default::default() },
                };
                let stamp = text_of(js::or(c.get("updated").as_ref()).cloned().or_else(|| c.get("deletedAt")));
                if js::lt(&js::to_string(&deleted_at), &stamp) {
                    return fx;
                }
                c.set("deleted", Value::Bool(true));
                c.set("deletedAt", deleted_at);
                self.chat_sessions.insert(id.clone(), c);
            }
            Event::HomeArticleUpsert(p) => {
                let updated = p.updated.clone().or_else(|| p.created.clone()).unwrap_or_else(|| s(t));
                if let Some(c) = self.home_articles.get(&p.id)
                    && js::lt(&js::to_string(&updated), &text_of(c.get("updated")))
                {
                    return fx;
                }
                let mut a = HomeArticle::default();
                a.set("id", s(&p.id));
                a.set("day", s(&js::str_or_empty(p.day.as_ref())));
                a.set("created", p.created.clone().unwrap_or_else(|| s(t)));
                a.set("updated", updated);
                a.set("readAt", p.read_at.clone().unwrap_or(Value::Null));
                let topics = p.topics.iter().copied().flatten().map(|x| s(&js::to_string(x))).collect();
                a.set("topics", Value::Array(topics));
                a.set("focus", p.focus.clone().unwrap_or(Value::Null));
                a.set("title", s(&js::str_or_empty(p.title.as_ref())));
                a.set("body", s(&js::to_string(&p.body)));
                let sources = p
                    .sources
                    .iter()
                    .copied()
                    .flatten()
                    .filter(|src| js::truthy(src) && js::or(src.get("id")).is_some())
                    .cloned()
                    .collect();
                a.set("sources", Value::Array(sources));
                self.home_articles.insert(p.id.clone(), a);
            }
            Event::UiTreeSet { key: Some(key), open } => {
                let k = js::to_string(key);
                if *open {
                    self.tree_open.insert(k, true);
                } else if k.starts_with("ws:") {
                    self.tree_open.insert(k, false);
                } else {
                    self.tree_open.remove(&k);
                }
            }
            Event::UiTabsSet { tabs, active_tab_id } => {
                let mut seen = HashSet::new();
                let chat_tab = live.map(|l| format!("chat:{}", l.current_chat_id.unwrap_or("null")));
                let mut list: Vec<String> = tabs
                    .iter()
                    .filter_map(Value::as_str)
                    .filter(|id| seen.insert(*id))
                    .filter(|id| match id.strip_prefix("chat:") {
                        Some(chat) => {
                            self.chat_sessions.get(chat).is_some_and(|c| !c.is_deleted())
                                || chat_tab.as_deref() == Some(*id)
                        }
                        None => {
                            self.pages.get(id).is_some_and(|p| !p.is_trashed())
                                || *id == "nlm:main"
                                || *id == "anki:main"
                        }
                    })
                    .map(str::to_owned)
                    .collect();
                if list.len() > 12 {
                    list.drain(..list.len() - 12);
                }
                let wanted = active_tab_id.as_ref().and_then(Value::as_str);
                self.active_tab_id = match wanted {
                    Some(a) if list.iter().any(|x| x == a) => Some(a.to_owned()),
                    _ => list.last().cloned(),
                };
                self.tabs = list;
            }
            Event::SettingsSet(patch) => {
                if let Some(next) = merge_settings_patch(&self.settings, patch) {
                    self.settings.assign(&next);
                }
            }
            _ => {}
        }
        fx
    }

    fn card_review(&mut self, ev: &LogEvent, p: &crate::event::CardReview) {
        let t = ev.t.as_str();
        let (Some(id), Some(srs)) = (&p.id, &p.srs) else { return };
        let Some(c) = self.cards.get(id) else { return };
        let state = || c.srs().and_then(|s| s.get("state")).and_then(Value::as_str);
        // Fehlt der alte Stand und wird er gebraucht, wirft das JS: Event übersprungen.
        let needs_old = p.first.is_none() || p.learning.is_none();
        if needs_old && c.srs().is_none_or(Value::is_null) {
            return;
        }
        let was_new = p.first.unwrap_or_else(|| state() == Some("new"));
        let was_learning = p.learning.unwrap_or_else(|| matches!(state(), Some("learning" | "relearning")));
        let deck_raw = js::or(c.get("deck").as_ref()).cloned();
        let conf = self.deck_conf(&deck_raw.as_ref().map(js::to_string).unwrap_or_default());
        let Some(c) = self.cards.get_mut(id) else { return };
        c.set("srs", srs.clone());
        let lapses = js::or(srs.get("lapses")).cloned().unwrap_or(json!(0));
        if p.grade.as_ref().and_then(Value::as_f64) == Some(1.0) && js::value_ge(&lapses, conf.leech_threshold()) {
            c.set("leech", Value::Bool(true));
            if conf.suspends_leeches() {
                c.set("suspended", Value::Bool(true));
            }
        }
        // Stapel und Art werden beim Ereignis eingefroren (spätere Umzüge ändern keine Statistik).
        let mut r = Review::default();
        r.set("id", p.review_id.clone().unwrap_or_else(|| s(&ev.id)));
        r.set("cardId", s(id));
        r.set("deck", p.deck.clone().or(deck_raw).unwrap_or_else(|| s("Standard")));
        r.set("t", s(t));
        r.set("grade", p.grade.clone().unwrap_or(json!(0)));
        r.set("first", Value::Bool(was_new));
        r.set("learning", Value::Bool(was_learning));
        r.set("subject", clipped(p.subject.as_ref(), 80));
        r.set("subjectSource", clipped(p.subject_source.as_ref(), 24));
        r.set("dueAt", p.due_at.clone().unwrap_or(Value::Null));
        r.set("previousReviewAt", p.previous_review_at.clone().unwrap_or(Value::Null));
        r.set("intervalDays", p.interval_days.map_or(Value::Null, js::num));
        self.reviews.push(r);
    }

    /// Benennt einen Stapel samt Unterstapeln um und zieht die Karten mit (auch gelöschte).
    /// Schritt für Schritt wie JS – auch wenn ein neuer Name einen alten trifft.
    fn rename_deck_tree(&mut self, from: &str, to: &str) {
        for n in self.deck_subtree(from) {
            let nn = format!("{to}{}", &n[from.len()..]);
            let mut d = self.decks.get(&n).cloned().unwrap_or_default();
            d.set("name", s(&nn));
            self.decks.insert(nn, d);
            self.decks.remove(&n);
        }
        for id in self.cards_in_deck_tree(from, true) {
            if let Some(c) = self.cards.get_mut(&id) {
                let deck = c.deck_name().to_owned();
                c.set("deck", s(&format!("{to}{}", &deck[from.len()..])));
            }
        }
    }

    fn duplicate_deck(&mut self, ev: &LogEvent, from: &str) {
        let t = ev.t.as_str();
        let leaf = from.rsplit("::").next().unwrap_or(from);
        let prefix = from.rfind("::").map_or("", |i| &from[..i + 2]);
        let to = format!("{prefix}{leaf} (Kopie)");
        for n in self.deck_subtree(from) {
            if self.decks.get(&n).is_some_and(|d| d.is_trashed()) || self.is_deck_archived(&n) {
                continue;
            }
            let nn = format!("{to}{}", &n[from.len()..]);
            self.decks.insert(nn.clone(), Deck::new(&nn, t));
        }
        for cid in self.cards_in_deck_tree(from, false) {
            let Some(c) = self.cards.get(&cid) else { continue };
            // Gleiche ID auf jedem Gerät: Zufalls-IDs ergäben beim Replay mehrere Kopien.
            let id = format!("{}:copy:{}", ev.id, c.id.as_deref().unwrap_or("undefined"));
            let mut copy = c.clone();
            copy.set("id", s(&id));
            copy.set("deck", s(&format!("{to}{}", &c.deck_name()[from.len()..])));
            copy.set("srs", new_srs(t));
            copy.set("created", s(t));
            copy.set("trashed", Value::Bool(false));
            copy.remove("trashedAt");
            self.cards.insert(id, copy);
        }
    }

    /// Schließt Tabs entfernter Seiten (`closePageTabs`; die offene Ansicht regelt die Oberfläche).
    fn close_page_tabs(&mut self, gone: &HashSet<String>) {
        if gone.is_empty() {
            return;
        }
        self.tabs.retain(|id| !gone.contains(id));
        if self.active_tab_id.as_ref().is_some_and(|a| gone.contains(a)) {
            self.active_tab_id = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(kind: &str, t: &str, payload: Value) -> LogEvent {
        LogEvent::new(format!("e-{t}"), t, kind, payload)
    }

    #[test]
    fn seite_anlegen_aendern_papierkorb() {
        let mut st = State::default();
        st.apply(&ev("pageCreate", "2026-01-01T00:00:00.000Z", json!({ "id": "a", "title": "A", "fav": 1 })));
        st.apply(&ev("pageCreate", "2026-01-01T00:00:01.000Z", json!({ "id": "b", "parentId": "a" })));
        st.apply(&ev(
            "pageUpdate",
            "2026-01-01T00:00:02.000Z",
            json!({ "id": "a", "patch": { "title": 5, "x": [1] } }),
        ));
        let a = st.page("a").unwrap();
        assert_eq!(a.get("title"), Some(json!(5)));
        assert_eq!(a.title(), "");
        assert_eq!(a.updated(), "2026-01-01T00:00:02.000Z");
        st.apply(&ev("pageTrash", "2026-01-01T00:00:03.000Z", json!({ "id": "a" })));
        assert!(st.page("b").unwrap().is_trashed());
        // Zyklus-Schutz
        st.apply(&ev("pageMove", "2026-01-01T00:00:04.000Z", json!({ "id": "a", "parentId": "b" })));
        assert_eq!(st.page("a").unwrap().parent(), None);
    }

    #[test]
    fn unbekanntes_event_aendert_nichts() {
        let mut st = State::default();
        let before = st.clone();
        st.apply(&ev("zukunftEvent", "2026-01-01T00:00:00.000Z", json!({ "id": "x" })));
        st.apply(&ev("pageCreate", "2026-01-01T00:00:00.000Z", json!(null)));
        st.apply(&ev("settingsSet", "2026-01-01T00:00:00.000Z", json!({ "aiProviders": [null] })));
        assert_eq!(st, before);
    }
}
