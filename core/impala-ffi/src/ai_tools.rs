//! Werkzeuge der KI gegen den Kern (Namen und Schemas wie `web/tools.js`, Definitionen in
//! `impala-ai/src/tool_defs.json`): `inspect` zum Nachsehen und `change` für atomare, rückgängig
//! machbare Änderungen an Seiten, Karten, Stapeln und Heften. Was nur die Plattform kann
//! (`calculate`, `send_to_notebooklm`, Heftseite als Bild, Rückfragen), geht über [`AiPlatform`].
//!
//! Rückgängig: `change` liefert einen Änderungs-Satz `{ pages, cards, decks, heftDocs }` mit je
//! `{ id, before, after }` im Format der PWA (`undoSet`); [`apply_undo`] spielt ihn zurück, wenn die
//! betroffenen Daten seitdem unverändert sind.

use std::cell::RefCell;
use std::collections::BTreeSet;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use impala_ai::{HeftPage, HeftPageContent, LocalTime, ToolExecutor, ToolOutput};
use impala_heft::diff::Shadow;
use impala_heft::ink::content_bottom;
use impala_heft::{HeftDoc, HeftOp, Item, PAGE_H, PAGE_W, Paper, TextBox, diff_document};
use impala_model::study::StudyOptions;
use impala_model::tree::deck_in_tree;
use impala_srs::{Srs, Timestamp};
use serde_json::{Map, Value, json};

use crate::ai::AiPlatform;
use crate::rag::SemanticSearch;
use crate::{CoreError, ImpalaCore, Inner, Shared, invalid, lock};

type Res = Result<Value, String>;

fn fail<T>(m: impl Into<String>) -> Result<T, String> {
    Err(m.into())
}

// ---------------------------------------------------------------------------
// kleine JS-Helfer

fn str_of(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string().trim_matches('"').to_owned(),
    }
}

/// `String(a[k] || "")`
fn arg(a: &Value, k: &str) -> String {
    a.get(k).filter(|v| truthy(v)).map(str_of).unwrap_or_default()
}

fn targ(a: &Value, k: &str) -> String {
    arg(a, k).trim().to_owned()
}

fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

fn num(a: &Value, k: &str) -> Option<f64> {
    match a.get(k)? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

/// Erste `n` UTF-16-Einheiten (wie `slice(0, n)` in JS).
fn head16(s: &str, n: usize) -> &str {
    let mut units = 0;
    for (i, c) in s.char_indices() {
        units += c.len_utf16();
        if units > n {
            return &s[..i];
        }
    }
    s
}

fn len16(s: &str) -> usize {
    s.encode_utf16().count()
}

fn lower(s: &str) -> String {
    s.to_lowercase()
}

fn wall_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

fn ser<T: serde::Serialize>(v: &T) -> Value {
    serde_json::to_value(v).unwrap_or(Value::Null)
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn newest_first(a: &impala_model::Page, b: &impala_model::Page) -> std::cmp::Ordering {
    b.updated().cmp(a.updated())
}

// ---------------------------------------------------------------------------
// Auswahl von Karten und Stapeln

struct Selection {
    ids: Vec<String>,
    total: usize,
    truncated: bool,
}

/// Werkzeug-Umgebung auf dem Kern. Jede Methode entspricht einem Zweig von `run` in `web/tools.js`.
struct Tools<'a> {
    inner: &'a mut Inner,
    active_page: Option<&'a str>,
    now: LocalTime,
    utc_offset: i32,
}

impl Tools<'_> {
    fn ev(&mut self, kind: &str, payload: Value) -> Result<(), String> {
        self.inner.dispatch(kind, payload).map(drop).map_err(|e| e.to_string())
    }

    fn page_id(&self, title: &str) -> Option<String> {
        self.inner.model.state().find_page(title, true).map(|p| p.id().to_owned())
    }

    fn page_by_title(&self, title: &str) -> Result<String, String> {
        self.page_id(title).ok_or_else(|| format!("Seite nicht gefunden: {title}"))
    }

    fn page_json(&self, id: &str) -> Value {
        self.inner.model.state().pages.get(id).map(ser).unwrap_or(Value::Null)
    }

    // ---- Karten

    fn card_text(&self, id: &str, key: &str) -> String {
        self.inner.model.state().cards.get(id).and_then(|c| c.get(key)).map(|v| str_of(&v)).unwrap_or_default()
    }

    fn card_deck(&self, id: &str) -> String {
        self.inner.model.state().cards.get(id).map(|c| c.deck_name().to_owned()).unwrap_or_default()
    }

    fn active_card_ids(&self) -> Vec<String> {
        self.inner.model.state().active_cards().iter().map(|c| c.id().to_owned()).collect()
    }

    fn find_card(&self, front: &str, deck: Option<&str>) -> Option<String> {
        let q = lower(front.trim());
        if q.is_empty() {
            return None;
        }
        let (mut starts, mut partial) = (None, None);
        for id in self.active_card_ids() {
            if deck.is_some_and(|d| !deck_in_tree(&self.card_deck(&id), d)) {
                continue;
            }
            let t = lower(&self.card_text(&id, "front"));
            if t == q {
                return Some(id);
            }
            if starts.is_none() && t.starts_with(&q) {
                starts = Some(id.clone());
            }
            if partial.is_none() && t.contains(&q) {
                partial = Some(id);
            }
        }
        starts.or(partial)
    }

    fn deck_matches(&self, name: &str) -> Vec<String> {
        let q = lower(name.trim());
        if q.is_empty() {
            return vec![];
        }
        let state = self.inner.model.state();
        let names: Vec<&String> =
            state.decks.iter().filter(|(n, d)| !d.is_trashed() && !state.is_deck_archived(n)).map(|(n, _)| n).collect();
        match names.iter().find(|n| lower(n) == q) {
            Some(exact) => vec![(*exact).clone()],
            None => names.into_iter().filter(|n| lower(n).contains(&q)).cloned().collect(),
        }
    }

    fn resolve_deck(&self, name: &str) -> Result<String, String> {
        let hits = self.deck_matches(name);
        match hits.len() {
            0 => fail(format!("Stapel nicht gefunden: {}", name.trim())),
            1 => Ok(hits[0].clone()),
            _ => fail(format!(
                "Mehrdeutiger Stapelname „{}“ — gemeint ist einer von: {}. Bitte mit ask_choice nachfragen und den vollständigen Namen verwenden.",
                name.trim(),
                hits.iter().take(5).cloned().collect::<Vec<_>>().join(" | ")
            )),
        }
    }

    /// Karten wählen: konkrete Fronten oder Filter aus Stapel und Suchtext (nie eine stille Teilauswahl).
    fn select_cards(&self, a: &Value, max: usize, allow_all: bool) -> Result<Selection, String> {
        let mut wanted: Vec<String> = a
            .get("fronts")
            .and_then(Value::as_array)
            .map(|f| f.iter().filter(|v| truthy(v)).map(str_of).collect())
            .unwrap_or_default();
        if truthy(a.get("front").unwrap_or(&Value::Null)) {
            wanted.push(arg(a, "front"));
        }
        let deck_arg = if truthy(a.get("deck").unwrap_or(&Value::Null)) { arg(a, "deck") } else { arg(a, "from_deck") };
        let deck = if deck_arg.is_empty() { None } else { Some(self.resolve_deck(&deck_arg)?) };
        let mut ids: Vec<String> = Vec::new();
        if !wanted.is_empty() {
            let mut missing = vec![];
            for f in &wanted {
                match self.find_card(f, deck.as_deref()) {
                    Some(id) => {
                        if !ids.contains(&id) {
                            ids.push(id);
                        }
                    }
                    None => missing.push(f.clone()),
                }
            }
            if !missing.is_empty() {
                return fail(format!("Karte(n) nicht gefunden: {}", missing.join(" | ")));
            }
        } else {
            let query = arg(a, "query");
            if deck.is_none() && query.is_empty() && !allow_all {
                return fail("Auswahl fehlt — bitte front/fronts, deck bzw. from_deck und/oder query angeben.");
            }
            let q = lower(query.trim());
            for id in self.active_card_ids() {
                if deck.as_deref().is_some_and(|d| !deck_in_tree(&self.card_deck(&id), d)) {
                    continue;
                }
                if !q.is_empty()
                    && !lower(&self.card_text(&id, "front")).contains(&q)
                    && !lower(&self.card_text(&id, "back")).contains(&q)
                {
                    continue;
                }
                ids.push(id);
            }
        }
        let limit = (num(a, "limit").filter(|n| *n != 0.0).unwrap_or(max as f64) as usize).clamp(1, max);
        let total = ids.len();
        ids.truncate(limit);
        Ok(Selection { truncated: total > ids.len(), ids, total })
    }

    /// Zielstapel anlegen bzw. aus dem Papierkorb holen (exakter Name).
    fn ensure_deck(&mut self, name: &str) -> Result<Option<String>, String> {
        let clean = name.trim().trim_matches(':').trim().to_owned();
        if clean.is_empty() {
            return Ok(None);
        }
        let exact = self
            .inner
            .model
            .state()
            .decks
            .iter()
            .find(|(n, _)| lower(n) == lower(&clean))
            .map(|(n, d)| (n.clone(), d.is_trashed()));
        if let Some((n, trashed)) = exact {
            if trashed {
                self.ev("deckRestore", json!({ "name": n }))?;
            }
            return Ok(Some(n));
        }
        self.ev("deckCreate", json!({ "name": clean }))?;
        Ok(Some(clean))
    }

    /// Zielnamen freimachen (Papierkorb-Stapel gleichen Namens zurückholen).
    fn free_deck_slot(&mut self, name: &str) -> Result<(), String> {
        let Some(trashed) = self.inner.model.state().decks.get(name).map(|d| d.is_trashed()) else { return Ok(()) };
        if !trashed {
            return fail(format!("Es gibt bereits einen Stapel „{name}“ — bitte anderen Namen wählen."));
        }
        self.ev("deckRestore", json!({ "name": name }))
    }

    fn cards_of_deck(&self, deck: &str) -> usize {
        self.active_card_ids().iter().filter(|id| deck_in_tree(&self.card_deck(id), deck)).count()
    }

    fn study_options(&self) -> StudyOptions<'static> {
        StudyOptions::with_offset(None, Timestamp::from_millis(wall_ms()), i64::from(self.utc_offset))
    }

    // ---- Lesen

    fn keyword_hits(&mut self, query: &str) -> Value {
        let Inner { search, model, .. } = &mut *self.inner;
        let all = search.search(model, query, true);
        let pages = &model.state().pages;
        let results: Vec<Value> = all
            .iter()
            .take(20)
            .map(|h| {
                let pg = pages.get(&h.id);
                let mut o = json!({ "title": pg.map(|p| p.title()).unwrap_or(""), "snippet": h.snippet });
                if pg.is_some_and(|p| p.is_archived()) {
                    o["archived"] = Value::Bool(true);
                }
                o
            })
            .collect();
        let mut out = json!({ "results": results, "totalMatches": all.len() });
        if all.len() > 20 {
            out["note"] = Value::from("Nur die 20 besten Treffer — bei Bedarf genauer suchen.");
        }
        out
    }

    fn get_context(&self) -> Value {
        let state = self.inner.model.state();
        let cur = self.active_page.and_then(|id| state.pages.get(id));
        let mut pages = state.active_pages();
        pages.sort_by(|a, b| newest_first(a, b));
        let recent: Vec<Value> =
            pages.iter().take(8).map(|p| json!({ "title": p.title(), "updated": head16(p.updated(), 10) })).collect();
        const DAYS: [&str; 7] = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
        const MONTHS: [&str; 12] = [
            "Januar",
            "Februar",
            "März",
            "April",
            "Mai",
            "Juni",
            "Juli",
            "August",
            "September",
            "Oktober",
            "November",
            "Dezember",
        ];
        let n = &self.now;
        let now = format!(
            "{}, {}. {} {}, {:02}:{:02} Uhr",
            DAYS[usize::from(n.weekday % 7)],
            n.day,
            MONTHS[usize::from(n.month.clamp(1, 12)) - 1],
            n.year,
            n.hour,
            n.minute
        );
        let counts = state.study_snapshot(&self.study_options()).counts;
        let current = cur.map(|p| {
            let body = p.content();
            let cut = len16(body) > 4000;
            json!({ "title": p.title(), "content": format!("{}{}", head16(body, 4000), if cut { "\n[… gekürzt — Rest per read_page]" } else { "" }) })
        });
        json!({
            "now": now,
            "currentPage": current,
            "currentCard": null,
            "recentPages": recent,
            "study": { "neu": counts.new, "review": counts.review, "learn": counts.learn },
            "pageCount": pages.len(),
        })
    }

    fn read_page(&self, title: &str) -> Res {
        let id = self.page_by_title(title)?;
        let state = self.inner.model.state();
        let Some(pg) = state.pages.get(&id) else { return fail(format!("Seite nicht gefunden: {title}")) };
        if pg.is_heft() {
            let meta = self.inner.model.heft_meta(&id);
            return Ok(json!({
                "title": pg.title(), "heft": true, "archived": pg.is_archived(),
                "pages": meta.as_ref().map_or(1, |m| m.pages),
                "content": head16(meta.as_ref().map_or("", |m| m.ocr_text.as_str()), 12000),
                "note": "Handschrift-Heft: content = erkannte Handschrift + getippte Text-Boxen. Sichtbar schreiben nur mit write_to_heft.",
            }));
        }
        Ok(json!({
            "title": pg.title(), "archived": pg.is_archived(), "content": head16(pg.content(), 12000),
            "hasPdf": pg.truthy("pdfId"),
        }))
    }

    fn list_pages(&self, query: &str) -> Value {
        let q = lower(query.trim());
        let state = self.inner.model.state();
        let mut all = state.active_pages();
        all.sort_by(|a, b| newest_first(a, b));
        if !q.is_empty() {
            all.retain(|p| lower(p.title()).contains(&q));
        }
        let pages: Vec<Value> = all
            .iter()
            .take(60)
            .map(|p| {
                let parent = p.parent().and_then(|id| state.pages.get(id)).map(|x| x.title().to_owned());
                json!({ "title": p.title(), "parent": parent, "hasPdf": p.truthy("pdfId") })
            })
            .collect();
        let mut out = json!({ "pages": pages, "total": all.len() });
        if all.len() > 60 {
            out["note"] = Value::from(
                "Nur die ersten 60 Treffer — für spezifischere Treffer query verfeinern oder search_notes nutzen.",
            );
        }
        out
    }

    fn list_flashcards(&self, a: &Value) -> Res {
        let limit = num(a, "limit").filter(|n| *n != 0.0).unwrap_or(30.0);
        let sel =
            self.select_cards(&json!({ "deck": a.get("deck"), "query": a.get("query"), "limit": limit }), 100, true)?;
        let state = self.inner.model.state();
        let cards: Vec<Value> = sel
            .ids
            .iter()
            .filter_map(|id| state.cards.get(id))
            .map(|c| {
                json!({
                    "front": c.get("front").map(|v| str_of(&v)).unwrap_or_default(),
                    "back": c.get("back").map(|v| str_of(&v)).unwrap_or_default(),
                    "deck": c.deck_name(), "state": c.srs_state().unwrap_or("new"), "due": c.srs_due(),
                    "suspended": c.is_suspended(),
                })
            })
            .collect();
        let mut out = json!({ "cards": cards, "totalMatches": sel.total });
        if sel.truncated {
            out["note"] = Value::from(format!(
                "Nur {} von {} Treffern — mit deck/query eingrenzen oder limit erhöhen (max. 100).",
                sel.ids.len(),
                sel.total
            ));
        }
        Ok(out)
    }

    fn list_decks(&self) -> Value {
        let state = self.inner.model.state();
        let mut names: Vec<&String> =
            state.decks.iter().filter(|(n, d)| !d.is_trashed() && !state.is_deck_archived(n)).map(|(n, _)| n).collect();
        names.sort_by_key(|n| lower(n));
        let with_today = names.len() <= 25;
        let cards = state.active_cards();
        let decks: Vec<Value> = names
            .iter()
            .map(|n| {
                let direct = cards.iter().filter(|c| c.deck_name() == n.as_str()).count();
                let tree: Vec<_> = cards.iter().filter(|c| deck_in_tree(c.deck_name(), n)).collect();
                let paused = tree.iter().filter(|c| c.is_suspended()).count();
                let mut o = json!({ "name": n, "cards": direct, "cardsInclSubdecks": tree.len(), "suspended": paused });
                o["today"] = if with_today {
                    let mut opts = self.study_options();
                    opts.deck = Some(n.as_str());
                    let c = state.study_snapshot(&opts).counts;
                    json!({ "neu": c.new, "lernen": c.learn, "wiederholen": c.review })
                } else {
                    Value::Null
                };
                o
            })
            .collect();
        let mut out = json!({ "decks": decks });
        if !with_today {
            out["note"] = Value::from(
                "Tages-Lernstand bei sehr vielen Stapeln ausgelassen — bei Bedarf get_context oder list_due_cards nutzen.",
            );
        }
        out
    }

    fn list_due_cards(&self) -> Value {
        let state = self.inner.model.state();
        let due = state.due_cards(&self.study_options());
        let list: Vec<Value> = due
            .iter()
            .take(20)
            .filter_map(|id| state.cards.get(id))
            .map(|c| json!({ "front": c.get("front").map(|v| str_of(&v)).unwrap_or_default(), "deck": c.deck_name(), "due": c.srs_due() }))
            .collect();
        json!({ "due": list, "totalDue": due.len() })
    }

    fn search_chat_history(&self, a: &Value) -> Res {
        let q = lower(targ(a, "query").as_str());
        if q.is_empty() {
            return fail("search_chat_history: query fehlt.");
        }
        let limit = (num(a, "limit").filter(|n| *n != 0.0).unwrap_or(15.0) as usize).clamp(1, 30);
        let mut sessions: Vec<&impala_model::ChatSession> =
            self.inner.model.state().chat_sessions.values().filter(|c| !c.is_deleted()).collect();
        sessions.sort_by_key(|c| std::cmp::Reverse(c.get("updated").map(|v| str_of(&v)).unwrap_or_default()));
        let (mut hits, mut total) = (vec![], 0);
        for s in sessions {
            let Some(Value::Array(messages)) = s.get("messages") else { continue };
            for m in &messages {
                let role = m.get("role").and_then(Value::as_str).unwrap_or("");
                if role != "user" && role != "assistant" {
                    continue;
                }
                let mut parts: Vec<String> = vec![];
                if let Some(c) = m.get("content").and_then(Value::as_str).filter(|c| !c.is_empty()) {
                    parts.push(c.to_owned());
                }
                for (key, label) in [("textFile", "Datei"), ("pdfFile", "PDF")] {
                    if let Some(f) = m.get(key).filter(|f| truthy(f)) {
                        parts.push(format!("[{label}: {}]\n{}", str_of(&f["name"]), str_of(&f["content"])));
                    }
                }
                if m.get("image").is_some_and(truthy) {
                    parts.push("[Bild-Anhang]".into());
                }
                let Some((text, at)) = parts.iter().find_map(|p| lower(p).find(&q).map(|i| (p, i))) else { continue };
                total += 1;
                if hits.len() >= limit {
                    continue;
                }
                // Ausschnitt um den Treffer (60 Zeichen Kontext); Kleinschreibung kann Längen ändern, daher über Zeichen.
                let chars: Vec<char> = text.chars().collect();
                let pos = lower(text)[..at].chars().count().min(chars.len());
                let (from, to) = (pos.saturating_sub(60), (pos + q.chars().count() + 60).min(chars.len()));
                let slice: String =
                    chars[from..to].iter().collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ");
                let snippet =
                    format!("{}{}{}", if from > 0 { "…" } else { "" }, slice, if to < chars.len() { "…" } else { "" });
                let updated = s.get("updated").map(|v| str_of(&v)).unwrap_or_default();
                hits.push(json!({
                    "chatId": s.get("id"), "chatTitle": s.get("title").filter(truthy).unwrap_or_else(|| Value::from("(ohne Titel)")),
                    "updated": head16(&updated, 16).replace('T', " "), "role": role, "snippet": snippet,
                }));
            }
        }
        Ok(json!({ "results": hits, "totalMatches": total }))
    }

    fn inspect(&mut self, a: &Value) -> Res {
        let limit = (num(a, "limit").filter(|n| *n != 0.0).unwrap_or(30.0) as usize).clamp(1, 100);
        match a.get("kind").and_then(Value::as_str).unwrap_or("") {
            "context" => Ok(self.get_context()),
            "pages" => Ok(self.list_pages(&arg(a, "query"))),
            "page" => {
                let raw = ["titles", "title", "page_title", "page"]
                    .iter()
                    .filter_map(|k| a.get(*k))
                    .find(|v| truthy(v))
                    .cloned()
                    .unwrap_or(Value::Null);
                let titles: Vec<String> = match raw {
                    Value::Array(l) => l.iter().filter(|v| truthy(v)).map(str_of).take(12).collect(),
                    Value::Null => vec![],
                    other => vec![str_of(&other)],
                };
                if titles.is_empty() {
                    return fail("inspect: titles fehlt für kind=page.");
                }
                let pages: Vec<Value> =
                    titles.iter().map(|t| self.read_page(t).unwrap_or_else(|e| json!({ "error": e }))).collect();
                Ok(json!({ "pages": pages }))
            }
            "decks" => Ok(self.list_decks()),
            "cards" => self.list_flashcards(&json!({ "deck": a.get("deck"), "query": a.get("query"), "limit": limit })),
            "due" => Ok(self.list_due_cards()),
            "search" => Ok(self.keyword_hits(&arg(a, "query"))),
            "chats" => self.search_chat_history(&json!({ "query": a.get("query"), "limit": limit })),
            "archived" => {
                let roots = self.inner.model.state().archived_page_roots();
                let list: Vec<Value> = roots
                    .iter()
                    .map(|p| {
                        let at = p.get("archivedAt").filter(truthy).unwrap_or_else(|| Value::from(p.updated()));
                        json!({ "title": p.title(), "kind": if p.is_heft() { "heft" } else { "page" }, "archivedAt": at })
                    })
                    .collect();
                Ok(json!({ "archived": list, "total": roots.len() }))
            }
            _ => fail("inspect: unbekanntes kind."),
        }
    }

    // ---- Ändern

    fn create_page(&mut self, a: &Value) -> Res {
        let title = targ(a, "title");
        if title.is_empty() {
            return fail("create_page: title fehlt.");
        }
        let parent_title = arg(a, "parent_title");
        let parent = if parent_title.is_empty() {
            None
        } else {
            Some(self.page_id(&parent_title).ok_or_else(|| format!("Elternseite nicht gefunden: {parent_title}"))?)
        };
        let id = new_id();
        let state = self.inner.model.state();
        let workspace = parent
            .as_deref()
            .or(self.active_page)
            .and_then(|p| state.pages.get(p))
            .map_or_else(|| "default".to_owned(), |p| p.workspace().to_owned());
        let parent_name = parent.as_deref().and_then(|p| state.pages.get(p)).map(|p| p.title().to_owned());
        self.ev("pageCreate", json!({ "id": id, "title": title, "parentId": parent, "content": arg(a, "content"), "workspaceId": workspace }))?;
        Ok(json!({ "ok": true, "id": id, "title": title, "parent": parent_name }))
    }

    fn page_patch(&mut self, id: &str, content: String) -> Result<(), String> {
        self.ev("pageUpdate", json!({ "id": id, "patch": { "content": content } }))
    }

    fn append_to_page(&mut self, a: &Value) -> Res {
        let id = self.page_by_title(&arg(a, "page_title"))?;
        let content = a.get("content").map(str_of).unwrap_or_default().trim().to_owned();
        if content.is_empty() {
            return fail("append_to_page: content fehlt.");
        }
        let pg = self.inner.model.state().pages.get(&id).cloned().unwrap_or_default();
        // Hefte zeigen nur Striche/Bilder/Textfelder: Markdown in `content` wäre unsichtbar.
        if pg.is_heft() {
            return self.write_to_heft(&json!({ "page_title": arg(a, "page_title"), "text": content }));
        }
        let joined = if pg.content().is_empty() { content } else { format!("{}\n\n{content}", pg.content()) };
        self.page_patch(&id, joined)?;
        Ok(json!({ "ok": true, "title": pg.title() }))
    }

    fn write_to_heft(&mut self, a: &Value) -> Res {
        let id = self.page_by_title(&arg(a, "page_title"))?;
        let pg = self.inner.model.state().pages.get(&id).cloned().unwrap_or_default();
        if !pg.is_heft() {
            return fail(format!("\"{}\" ist kein Handschrift-Heft — nutze append_to_page.", pg.title()));
        }
        let index = a
            .get("heft_page")
            .filter(|v| !v.is_null())
            .map(|_| (num(a, "heft_page").filter(|n| *n != 0.0).unwrap_or(1.0) as i64 - 1).max(0) as usize);
        let (page_index, added) =
            self.heft_add_text(&id, a.get("text").map(str_of).unwrap_or_default().trim(), index)?;
        Ok(json!({
            "ok": true, "title": pg.title(), "heftPage": page_index + 1, "addedPage": added,
            "note": format!("Sichtbar als Text-Box auf Heftseite {} eingefügt.", page_index + 1),
        }))
    }

    /// Text als Textfeld unter den Inhalt einer Heftseite (`addText`); neue Seite, wenn es nicht mehr passt.
    fn heft_add_text(&mut self, page_id: &str, body: &str, index: Option<usize>) -> Result<(usize, bool), String> {
        if body.is_empty() {
            return fail("Ins Heft schreiben fehlgeschlagen: Kein Text");
        }
        let doc = self.inner.model.state().hefte.get(page_id).cloned().unwrap_or_default();
        let mut ops: Vec<HeftOp> = vec![];
        let (mut pi, mut paper_page) = (0, doc.pages.last().cloned());
        if doc.pages.is_empty() {
            let id = new_id();
            ops.push(HeftOp::PageAdd { at: None, page: id.clone(), paper: Some(Paper::default()) });
            paper_page = Some(impala_heft::HeftPage::empty(id, Paper::default()));
        } else {
            pi = index.map_or(doc.pages.len() - 1, |i| i.min(doc.pages.len() - 1));
            paper_page = doc.pages.get(pi).cloned().or(paper_page);
        }
        let mut pg = paper_page.unwrap_or_default();
        let size = 30.0;
        let w = PAGE_W - 160.0;
        // Höhe grob aus der Zeilenzahl (der Umbruch mit der Geräteschrift ist abgeleitet und zählt nicht als Änderung).
        let per_line = (((w - 20.0) / (size * 0.5)).floor() as usize).max(8);
        let lines: usize = body.split('\n').map(|l| l.chars().count().div_ceil(per_line).max(1)).sum();
        let h = (lines as f64 * size * 1.4 + 20.0).round();
        let mut y = content_bottom(&pg) + 30.0;
        let mut added = doc.pages.is_empty();
        if index.is_none() && y > 80.0 && y + h.min(220.0) > PAGE_H - 50.0 && !doc.pages.is_empty() {
            let id = new_id();
            ops.push(HeftOp::PageAdd { at: None, page: id.clone(), paper: Some(pg.paper.clone()) });
            pg = impala_heft::HeftPage::empty(id, pg.paper.clone());
            pi = doc.pages.len();
            (y, added) = (60.0, true);
        } else if doc.pages.is_empty() {
            y = 70.0;
        }
        let text = TextBox {
            id: new_id(),
            x: Some(80.0),
            y: Some(y.min(PAGE_H - 80.0)),
            w: Some(w),
            h: Some(h),
            text: Some(body.to_owned()),
            color: Some("#1c1c1e".into()),
            size: Some(size),
            ..Default::default()
        };
        ops.push(HeftOp::Add { page: pg.id.clone(), item: Item::Text(text) });
        let ops = serde_json::to_value(&ops).map_err(|e| e.to_string())?;
        self.ev("heftOps", json!({ "pageId": page_id, "ops": ops }))?;
        Ok((pi, added))
    }

    fn replace_page_content(&mut self, a: &Value) -> Res {
        let id = self.page_by_title(&arg(a, "page_title"))?;
        let pg = self.inner.model.state().pages.get(&id).cloned().unwrap_or_default();
        if pg.is_heft() {
            return fail(
                "Heft-Inhalte (Striche/Bilder) können nicht ersetzt werden — write_to_heft fügt sichtbaren Text hinzu.",
            );
        }
        self.page_patch(&id, arg(a, "content"))?;
        Ok(json!({ "ok": true, "title": pg.title() }))
    }

    fn patch_page(&mut self, a: &Value) -> Res {
        let id = self.page_by_title(&arg(a, "page_title"))?;
        let pg = self.inner.model.state().pages.get(&id).cloned().unwrap_or_default();
        if pg.is_heft() {
            return fail(
                "Heft-Inhalte (Striche/Bilder) können nicht gepatcht werden — write_to_heft fügt sichtbaren Text hinzu.",
            );
        }
        let search = a.get("search").filter(|v| !v.is_null()).map(str_of).unwrap_or_default();
        if search.is_empty() {
            return fail("patch_page: search fehlt.");
        }
        let content = pg.content();
        let Some(first) = content.find(&search) else {
            return fail(format!("Suchtext wurde in der Seite nicht gefunden: {search}"));
        };
        if content[first + search.len()..].contains(&search) {
            return fail(format!(
                "Suchtext kommt mehrfach in der Seite vor ({search}). Bitte Suchtext eindeutiger angeben."
            ));
        }
        let replace = ["replace", "content"]
            .iter()
            .filter_map(|k| a.get(*k))
            .find(|v| !v.is_null())
            .map(str_of)
            .unwrap_or_default();
        let new = format!("{}{replace}{}", &content[..first], &content[first + search.len()..]);
        self.page_patch(&id, new)?;
        Ok(json!({ "ok": true, "title": pg.title() }))
    }

    fn rename_page(&mut self, a: &Value) -> Res {
        let id = self.page_by_title(&arg(a, "page_title"))?;
        let title = targ(a, "new_title");
        if title.is_empty() {
            return fail("rename_page: new_title fehlt.");
        }
        self.ev("pageUpdate", json!({ "id": id, "patch": { "title": title } }))?;
        Ok(json!({ "ok": true, "from": arg(a, "page_title"), "title": title }))
    }

    fn move_page(&mut self, a: &Value) -> Res {
        let id = self.page_by_title(&arg(a, "page_title"))?;
        let new_parent = arg(a, "new_parent_title");
        let parent = if new_parent.is_empty() {
            None
        } else {
            Some(self.page_id(&new_parent).ok_or_else(|| format!("Elternseite nicht gefunden: {new_parent}"))?)
        };
        let state = self.inner.model.state();
        let mut cur = parent.clone();
        while let Some(c) = cur {
            if c == id {
                return fail("Zyklus: Die Zielseite liegt innerhalb der zu verschiebenden Seite.");
            }
            cur = state.pages.get(&c).and_then(|p| p.parent().map(str::to_owned));
        }
        let title = state.pages.get(&id).map(|p| p.title().to_owned()).unwrap_or_default();
        let parent_title = parent.as_deref().and_then(|p| state.pages.get(p)).map(|p| p.title().to_owned());
        self.ev("pageMove", json!({ "id": id, "parentId": parent }))?;
        Ok(json!({ "ok": true, "title": title, "parent": parent_title }))
    }

    fn subpages(&self, id: &str) -> usize {
        self.inner.model.state().page_subtree(id).iter().filter(|p| p.as_str() != id).count()
    }

    fn trash_page(&mut self, a: &Value) -> Res {
        let id = self.page_by_title(&arg(a, "page_title"))?;
        let (title, sub) = (self.page_json(&id)["title"].clone(), self.subpages(&id));
        self.ev("pageTrash", json!({ "id": id }))?;
        Ok(json!({
            "ok": true, "title": title, "trashed": true, "subpages": sub,
            "note": "Im Papierkorb — wiederherstellbar. Endgültiges Löschen nur manuell im Papierkorb.",
        }))
    }

    fn archive_page(&mut self, a: &Value, archive: bool) -> Res {
        let wanted = arg(a, "page_title");
        let mut id = self.page_id(&wanted);
        if id.is_none() && !archive {
            let q = lower(wanted.trim());
            let state = self.inner.model.state();
            let all: Vec<_> = state.pages.values().filter(|p| !p.is_trashed() && p.is_archived()).collect();
            id = all
                .iter()
                .find(|p| lower(p.title()) == q)
                .or_else(|| all.iter().find(|p| lower(p.title()).contains(&q)))
                .map(|p| p.id().to_owned());
        }
        let Some(id) = id else {
            return fail(if archive {
                format!("Seite nicht gefunden: {wanted}")
            } else {
                format!("Archivierte Seite nicht gefunden: {wanted}")
            });
        };
        let pg = self.inner.model.state().pages.get(&id).cloned().unwrap_or_default();
        let (kind, sub) = (if pg.is_heft() { "heft" } else { "page" }, self.subpages(&id));
        self.ev(if archive { "pageArchive" } else { "pageUnarchive" }, json!({ "id": id }))?;
        Ok(if archive {
            json!({ "ok": true, "title": pg.title(), "archived": true, "kind": kind, "subpages": sub,
                "note": "Archiviert — in der Bibliothek (Archiv-Reiter) wiederherstellbar." })
        } else {
            json!({ "ok": true, "title": pg.title(), "archived": false, "kind": kind, "note": "Aus dem Archiv wiederhergestellt." })
        })
    }

    fn create_card(
        &mut self,
        front: &str,
        back: &str,
        page_id: Option<&str>,
        deck: Option<&str>,
    ) -> Result<(), String> {
        let deck = match deck.filter(|d| !d.is_empty()) {
            Some(d) => self.ensure_deck(d)?,
            None => None,
        };
        self.ev("cardCreate", json!({ "id": new_id(), "front": front, "back": back, "pageId": page_id, "deck": deck }))
    }

    /// Seite der Karte: genannter Titel, sonst die geöffnete.
    fn card_page(&self, a: &Value) -> Option<String> {
        let title = arg(a, "page_title");
        if title.is_empty() { self.active_page.map(str::to_owned) } else { self.page_id(&title) }
    }

    fn create_flashcard(&mut self, a: &Value) -> Res {
        if arg(a, "front").trim().is_empty() || arg(a, "back").trim().is_empty() {
            return fail("create_flashcard: front und back dürfen nicht leer sein.");
        }
        let page = self.card_page(a);
        let deck = arg(a, "deck");
        self.create_card(&arg(a, "front"), &arg(a, "back"), page.as_deref(), Some(&deck))?;
        Ok(json!({ "ok": true, "front": arg(a, "front"), "deck": if deck.is_empty() { "Standard" } else { &deck } }))
    }

    fn create_flashcards(&mut self, a: &Value) -> Res {
        let list: Vec<&Value> = a
            .get("cards")
            .and_then(Value::as_array)
            .map(|l| {
                l.iter()
                    .filter(|c| {
                        truthy(c.get("front").unwrap_or(&Value::Null)) && truthy(c.get("back").unwrap_or(&Value::Null))
                    })
                    .collect()
            })
            .unwrap_or_default();
        if list.is_empty() {
            return fail("create_flashcards: cards-Liste ist leer oder unvollständig (front + back nötig).");
        }
        let page = self.card_page(a);
        let deck = arg(a, "deck");
        for c in &list {
            self.create_card(&str_of(&c["front"]), &str_of(&c["back"]), page.as_deref(), Some(&deck))?;
        }
        Ok(json!({ "ok": true, "cards": list.len(), "deck": if deck.is_empty() { "Standard" } else { &deck } }))
    }

    fn delete_flashcards(&mut self, a: &Value) -> Res {
        let sel = self.select_cards(a, 200, false)?;
        if sel.ids.is_empty() {
            return fail("Keine passenden Karten gefunden.");
        }
        let left = sel.total - sel.ids.len();
        for id in &sel.ids {
            self.ev("cardTrash", json!({ "id": id }))?;
        }
        let decks: BTreeSet<String> = sel.ids.iter().map(|id| self.card_deck(id)).collect();
        let examples: Vec<String> = sel
            .ids
            .iter()
            .take(5)
            .map(|id| {
                head16(&self.card_text(id, "front").split_whitespace().collect::<Vec<_>>().join(" "), 60).to_owned()
            })
            .collect();
        let mut out = json!({ "ok": true, "trashed": sel.ids.len(), "decks": decks, "examples": examples });
        if left > 0 {
            out["notDeleted"] = left.into();
            out["hinweis"] = Value::from(format!(
                "Sicherheitsgrenze erreicht — {left} weitere Treffer wurden NICHT gelöscht. Für den Rest erneut aufrufen."
            ));
        }
        out["note"] = Value::from("Im Papierkorb — wiederherstellbar.");
        Ok(out)
    }

    fn move_flashcards(&mut self, a: &Value) -> Res {
        if targ(a, "to_deck").is_empty() {
            return fail("move_flashcards: to_deck fehlt.");
        }
        let sel = self.select_cards(a, 200, false)?;
        if sel.ids.is_empty() {
            return fail("Keine passenden Karten gefunden.");
        }
        let Some(deck) = self.ensure_deck(&arg(a, "to_deck"))? else {
            return fail("move_flashcards: to_deck ist leer.");
        };
        let mut moved = 0;
        for id in &sel.ids {
            if self.card_deck(id) == deck {
                continue;
            }
            self.ev("cardUpdate", json!({ "id": id, "patch": { "deck": deck } }))?;
            moved += 1;
        }
        let examples: Vec<String> =
            sel.ids.iter().take(5).map(|id| head16(&self.card_text(id, "front"), 60).to_owned()).collect();
        Ok(json!({
            "ok": true, "deck": deck, "moved": moved, "alreadyThere": sel.ids.len() - moved, "examples": examples,
            "note": "Lernfortschritt der Karten bleibt erhalten.",
        }))
    }

    fn update_flashcard(&mut self, a: &Value) -> Res {
        let deck = arg(a, "deck");
        let Some(id) = self.find_card(&arg(a, "front"), Some(&deck).filter(|d| !d.is_empty()).map(String::as_str))
        else {
            return fail(format!("Karte nicht gefunden: {}", arg(a, "front")));
        };
        let mut patch = Map::new();
        if !targ(a, "new_front").is_empty() {
            patch.insert("front".into(), arg(a, "new_front").into());
        }
        if !targ(a, "new_back").is_empty() {
            patch.insert("back".into(), arg(a, "new_back").into());
        }
        if !targ(a, "new_deck").is_empty() {
            patch.insert("deck".into(), self.ensure_deck(&arg(a, "new_deck"))?.into());
        }
        if patch.is_empty() {
            return fail("update_flashcard: nichts zu ändern — new_front, new_back oder new_deck angeben.");
        }
        let changed: Vec<String> = patch.keys().cloned().collect();
        let pick = |k: &str, old: String| patch.get(k).map(str_of).unwrap_or(old);
        let out = json!({
            "ok": true, "changed": changed,
            "front": pick("front", self.card_text(&id, "front")), "back": pick("back", self.card_text(&id, "back")),
            "deck": pick("deck", self.card_deck(&id)), "note": "Lernfortschritt bleibt erhalten.",
        });
        self.ev("cardUpdate", json!({ "id": id, "patch": patch }))?;
        Ok(out)
    }

    fn suspend_flashcards(&mut self, a: &Value) -> Res {
        let Some(flag) = a.get("suspended").and_then(Value::as_bool) else {
            return fail("suspend_flashcards: suspended (true/false) fehlt.");
        };
        let sel = self.select_cards(a, 200, false)?;
        if sel.ids.is_empty() {
            return fail("Keine passenden Karten gefunden.");
        }
        let mut changed = 0;
        for id in &sel.ids {
            if self.inner.model.state().cards.get(id).is_some_and(|c| c.is_suspended() == flag) {
                continue;
            }
            self.ev("cardUpdate", json!({ "id": id, "patch": { "suspended": flag } }))?;
            changed += 1;
        }
        Ok(json!({ "ok": true, "suspended": flag, "changed": changed, "unchanged": sel.ids.len() - changed }))
    }

    fn reset_card_progress(&mut self, a: &Value) -> Res {
        let sel = self.select_cards(a, 200, false)?;
        if sel.ids.is_empty() {
            return fail("Keine passenden Karten gefunden.");
        }
        let fresh = ser(&Srs::new(Timestamp::from_millis(wall_ms())));
        for id in &sel.ids {
            self.ev("cardUpdate", json!({ "id": id, "patch": { "srs": fresh, "leech": false, "suspended": false } }))?;
        }
        Ok(json!({
            "ok": true, "reset": sel.ids.len(),
            "note": "Die Karten stehen wieder als „neu“ in der Warteschlange. Das Wiederholungs-Protokoll (Statistik/Heatmap) bleibt erhalten.",
        }))
    }

    fn create_deck(&mut self, a: &Value) -> Res {
        let name = targ(a, "name");
        if name.is_empty() {
            return fail("create_deck: name fehlt.");
        }
        let existed = self.inner.model.state().decks.iter().any(|(n, d)| lower(n) == lower(&name) && !d.is_trashed());
        let deck = self.ensure_deck(&name)?;
        Ok(
            json!({ "ok": true, "deck": deck, "note": if existed { "Stapel gab es bereits — unverändert." } else { "Neu angelegt." } }),
        )
    }

    fn rename_deck(&mut self, a: &Value) -> Res {
        let from = self.resolve_deck(&arg(a, "deck"))?;
        let to = targ(a, "new_name").trim_matches(':').trim().to_owned();
        if to.is_empty() {
            return fail("rename_deck: new_name fehlt.");
        }
        if to == from {
            return Ok(json!({ "ok": true, "deck": from, "note": "Name unverändert." }));
        }
        if deck_in_tree(&to, &from) {
            return fail("Der neue Name liegt innerhalb des Stapels selbst — das ergäbe einen Zyklus.");
        }
        self.free_deck_slot(&to)?;
        let n = self.cards_of_deck(&from);
        self.ev("deckRename", json!({ "from": from, "to": to }))?;
        Ok(
            json!({ "ok": true, "from": from, "to": to, "cards": n, "note": "Unterstapel und Karten sind mitgewandert." }),
        )
    }

    fn move_deck(&mut self, a: &Value) -> Res {
        let from = self.resolve_deck(&arg(a, "deck"))?;
        let mut target = String::new();
        if !targ(a, "new_parent").is_empty() {
            target = self.resolve_deck(&arg(a, "new_parent")).map_err(|e| {
                let mut c = e.chars();
                format!("Ziel-{}{}", c.next().map(|f| f.to_lowercase().to_string()).unwrap_or_default(), c.as_str())
            })?;
            if deck_in_tree(&target, &from) {
                return fail("Ein Stapel kann nicht in sich selbst oder einen eigenen Unterstapel wandern.");
            }
        }
        let leaf = from.rsplit("::").next().unwrap_or(&from);
        let to = if target.is_empty() { leaf.to_owned() } else { format!("{target}::{leaf}") };
        if to == from {
            return Ok(json!({ "ok": true, "deck": from, "note": "Der Stapel liegt bereits dort." }));
        }
        self.free_deck_slot(&to).map_err(|e| format!("Am Zielort: {e}"))?;
        self.ev("deckMove", json!({ "from": from, "target": target }))?;
        Ok(json!({ "ok": true, "from": from, "to": to }))
    }

    fn delete_deck(&mut self, a: &Value) -> Res {
        let deck = self.resolve_deck(&arg(a, "deck"))?;
        let n = self.cards_of_deck(&deck);
        self.ev("deckTrash", json!({ "name": deck }))?;
        Ok(
            json!({ "ok": true, "deck": deck, "trashed": true, "cards": n, "note": "Im Papierkorb — wiederherstellbar." }),
        )
    }

    /// Ein einzelnes (internes) Werkzeug; die Namen entsprechen `run` in `web/tools.js`.
    fn run(&mut self, name: &str, a: &Value) -> Res {
        match name {
            "inspect" => self.inspect(a),
            "create_page" => self.create_page(a),
            "append_to_page" => self.append_to_page(a),
            "write_to_heft" => self.write_to_heft(a),
            "replace_page_content" => self.replace_page_content(a),
            "patch_page" => self.patch_page(a),
            "rename_page" => self.rename_page(a),
            "move_page" => self.move_page(a),
            "delete_page" => self.trash_page(a),
            "archive_page" => self.archive_page(a, true),
            "unarchive_page" => self.archive_page(a, false),
            "delete_flashcards" => self.delete_flashcards(a),
            "delete_deck" => self.delete_deck(a),
            "create_flashcard" => self.create_flashcard(a),
            "create_flashcards" => self.create_flashcards(a),
            "create_deck" => self.create_deck(a),
            "rename_deck" => self.rename_deck(a),
            "move_deck" => self.move_deck(a),
            "move_flashcards" => self.move_flashcards(a),
            "update_flashcard" => self.update_flashcard(a),
            "suspend_flashcards" => self.suspend_flashcards(a),
            "reset_card_progress" => self.reset_card_progress(a),
            other => fail(format!("Unbekanntes Tool: {other}")),
        }
    }

    // ---- change

    fn change(&mut self, a: &Value) -> (Value, Option<Value>) {
        let operations: Vec<Value> = a
            .get("operations")
            .and_then(Value::as_array)
            .map(|o| o.iter().map(normalize_op).collect())
            .unwrap_or_default();
        if operations.is_empty() {
            return (json!({ "error": "change: operations fehlt." }), None);
        }
        if operations.len() > 100 {
            return (json!({ "error": "change: maximal 100 Operationen pro Aktion." }), None);
        }
        let mut problems = vec![];
        for (i, op) in operations.iter().enumerate() {
            let name = op.get("op").map(str_of).unwrap_or_default();
            if op_to_tool(op).is_none() {
                problems.push(format!(
                    "Operation {}: unbekannte Operation „{}“",
                    i + 1,
                    if name.is_empty() { "(leer)" } else { &name }
                ));
            } else if let Some(v) = validate_op(op) {
                problems.push(format!("Operation {} ({name}): {v}", i + 1));
            }
        }
        if !problems.is_empty() {
            let msg = format!(
                "change: Validierungsfehler in {} Operation(en):\n{}\nKeine Änderungen ausgeführt.",
                problems.len(),
                problems.join("\n")
            );
            return (json!({ "error": msg }), None);
        }
        let before = Snapshot::take(&operations, self);
        let mut results = vec![];
        for (i, op) in operations.iter().enumerate() {
            let Some((tool, args)) = op_to_tool(op) else { continue };
            let result = self.run(tool, &args).unwrap_or_else(|e| json!({ "error": e }));
            if let Some(e) = result.get("error").filter(|e| truthy(e)) {
                let name = op.get("op").map(str_of).unwrap_or_default();
                let set = before.undo_set(self.inner);
                if let Err(undo_err) = apply_undo_in(self.inner, &set) {
                    return (
                        json!({ "error": format!("Operation {} ({name}) fehlgeschlagen: {}. Zurücknehmen scheiterte: {undo_err}", i + 1, str_of(e)) }),
                        None,
                    );
                }
                return (
                    json!({ "error": format!("Operation {} ({name}) fehlgeschlagen: {}. Alle vorherigen Änderungen wurden zurückgenommen.", i + 1, str_of(e)) }),
                    None,
                );
            }
            let mut entry = json!({ "op": op.get("op") });
            if let (Some(o), Value::Object(r)) = (entry.as_object_mut(), &result) {
                o.extend(r.clone());
            }
            results.push(entry);
        }
        let changes = before.undo_set(self.inner);
        let count: usize =
            ["pages", "cards", "decks", "heftDocs"].iter().map(|k| changes[*k].as_array().map_or(0, Vec::len)).sum();
        (json!({ "ok": true, "operations": results.len(), "changedObjects": count, "results": results }), Some(changes))
    }
}

// ---------------------------------------------------------------------------
// change: Operationen prüfen und auf Werkzeuge abbilden (OP_TO_TOOL)

fn has_field(o: &Value, k: &str) -> bool {
    o.get(k).is_some_and(|v| !v.is_null())
}

fn has_text(o: &Value, keys: &[&str]) -> bool {
    keys.iter().any(|k| has_field(o, k) && !str_of(&o[*k]).trim().is_empty())
}

fn normalize_op(raw: &Value) -> Value {
    let mut op = if raw.is_object() { raw.clone() } else { json!({}) };
    if let Some(nested) = raw.get("card").filter(|c| c.is_object()) {
        if !has_field(&op, "op") && has_field(nested, "op") {
            op["op"] = nested["op"].clone();
        }
        for k in [
            "front",
            "back",
            "new_front",
            "new_back",
            "deck",
            "to",
            "new_deck",
            "fronts",
            "query",
            "suspended",
            "limit",
        ] {
            if !has_field(&op, k) && has_field(nested, k) {
                op[k] = nested[k].clone();
            }
        }
    }
    op
}

/// Fehlertext oder `None`.
fn validate_op(op: &Value) -> Option<&'static str> {
    let name = op.get("op").map(str_of).unwrap_or_default();
    let ok = match name.as_str() {
        "" => return Some("op fehlt"),
        "page.create" => return (!has_text(op, &["title"])).then_some("title fehlt"),
        "page.append" | "page.replace" => {
            if has_text(op, &["title"]) && (has_field(op, "content") || has_field(op, "text")) {
                return None;
            } else {
                "title oder content fehlt"
            }
        }
        "page.patch" => {
            if has_text(op, &["title", "search"])
                && has_text(op, &["search"])
                && (has_field(op, "replace") || has_field(op, "content"))
                && has_text(op, &["title"])
            {
                return None;
            }
            "title, search oder replace fehlt"
        }
        "page.rename" => {
            if has_text(op, &["title"]) && has_text(op, &["to"]) {
                return None;
            } else {
                "title oder neuer Name fehlt"
            }
        }
        "page.move" | "page.trash" | "page.archive" | "page.unarchive" => {
            return (!has_text(op, &["title"])).then_some("title fehlt");
        }
        "heft.append" => {
            if has_text(op, &["title"]) && has_text(op, &["text", "content"]) {
                return None;
            } else {
                "Hefttitel oder Text fehlt"
            }
        }
        "card.create" => {
            return match op.get("cards").and_then(Value::as_array) {
                Some(cards) => (cards.is_empty()
                    || !cards.iter().all(|c| has_text(c, &["front"]) && has_field(c, "back")))
                .then_some("Karten brauchen front und back"),
                None => (!(has_text(op, &["front"]) && has_field(op, "back"))).then_some("front oder back fehlt"),
            };
        }
        "card.update" => {
            if has_text(op, &["front", "query"])
                && ["new_front", "new_back", "back", "to"].iter().any(|k| has_field(op, k))
            {
                return None;
            } else {
                "Karte oder neue Werte fehlen"
            }
        }
        "card.move" => {
            if !has_text(op, &["to"]) {
                return Some("Zielstapel fehlt");
            }
            return (!has_text(op, &["front", "fronts", "deck", "query"])).then_some("Karten-Auswahl fehlt");
        }
        "card.trash" | "card.suspend" => {
            return (!has_text(op, &["front", "fronts", "deck", "query"])).then_some("Karten-Auswahl fehlt");
        }
        "card.reset" => return (!has_text(op, &["front"])).then_some("front fehlt"),
        "deck.create" => return (!has_text(op, &["deck", "title"])).then_some("Stapelname fehlt"),
        "deck.rename" => {
            if has_text(op, &["deck"]) && has_text(op, &["to"]) {
                return None;
            } else {
                "Stapel oder neuer Name fehlt"
            }
        }
        "deck.move" => {
            if has_text(op, &["deck"]) && has_field(op, "to") {
                return None;
            } else {
                "Stapel oder Ziel fehlt"
            }
        }
        "deck.trash" => return (!has_text(op, &["deck"])).then_some("Stapel fehlt"),
        _ => return None,
    };
    Some(ok)
}

fn first(op: &Value, keys: &[&str]) -> Value {
    keys.iter().filter_map(|k| op.get(*k)).find(|v| !v.is_null()).cloned().unwrap_or(Value::Null)
}

fn or_truthy(op: &Value, keys: &[&str]) -> Value {
    keys.iter().filter_map(|k| op.get(*k)).find(|v| truthy(v)).cloned().unwrap_or(Value::Null)
}

fn fronts_of(op: &Value) -> Value {
    if truthy(op.get("fronts").unwrap_or(&Value::Null)) {
        op["fronts"].clone()
    } else if truthy(op.get("front").unwrap_or(&Value::Null)) {
        json!([op["front"]])
    } else {
        Value::Null
    }
}

fn op_to_tool(op: &Value) -> Option<(&'static str, Value)> {
    let name = op.get("op")?.as_str()?;
    let o = op;
    Some(match name {
        "page.create" => (
            "create_page",
            json!({ "title": o["title"], "parent_title": o["parent"], "content": first(o, &["content", "text"]).as_str().unwrap_or("") }),
        ),
        "page.append" => {
            ("append_to_page", json!({ "page_title": o["title"], "content": first(o, &["content", "text"]) }))
        }
        "page.replace" => {
            ("replace_page_content", json!({ "page_title": o["title"], "content": first(o, &["content", "text"]) }))
        }
        "page.patch" => (
            "patch_page",
            json!({ "page_title": o["title"], "search": o["search"], "replace": first(o, &["replace", "content"]) }),
        ),
        "page.rename" => ("rename_page", json!({ "page_title": o["title"], "new_title": o["to"] })),
        "page.move" => {
            ("move_page", json!({ "page_title": o["title"], "new_parent_title": first(o, &["parent", "to"]) }))
        }
        "page.trash" => ("delete_page", json!({ "page_title": o["title"] })),
        "page.archive" => ("archive_page", json!({ "page_title": o["title"] })),
        "page.unarchive" => ("unarchive_page", json!({ "page_title": o["title"] })),
        "heft.append" => (
            "write_to_heft",
            json!({ "page_title": o["title"], "text": first(o, &["text", "content"]), "heft_page": o["page"] }),
        ),
        "card.create" => {
            if o.get("cards").is_some_and(truthy) {
                ("create_flashcards", json!({ "cards": o["cards"], "deck": o["deck"], "page_title": o["title"] }))
            } else {
                (
                    "create_flashcard",
                    json!({ "front": o["front"], "back": o["back"], "deck": o["deck"], "page_title": o["title"] }),
                )
            }
        }
        "card.update" => (
            "update_flashcard",
            json!({ "front": or_truthy(o, &["front", "query"]), "deck": o["deck"], "new_front": o["new_front"], "new_back": first(o, &["new_back", "back"]), "new_deck": o["to"] }),
        ),
        "card.move" => (
            "move_flashcards",
            json!({ "fronts": fronts_of(o), "from_deck": o["deck"], "query": o["query"], "to_deck": o["to"], "limit": o["limit"] }),
        ),
        "card.trash" => (
            "delete_flashcards",
            json!({ "fronts": fronts_of(o), "deck": o["deck"], "query": o["query"], "limit": o["limit"] }),
        ),
        "card.suspend" => (
            "suspend_flashcards",
            json!({ "fronts": fronts_of(o), "deck": o["deck"], "query": o["query"], "suspended": o["suspended"], "limit": o["limit"] }),
        ),
        "card.reset" => ("reset_card_progress", json!({ "front": o["front"], "deck": o["deck"] })),
        "deck.create" => ("create_deck", json!({ "name": or_truthy(o, &["deck", "title"]) })),
        "deck.rename" => ("rename_deck", json!({ "deck": o["deck"], "new_name": o["to"] })),
        "deck.move" => ("move_deck", json!({ "deck": o["deck"], "new_parent": o["to"] })),
        "deck.trash" => ("delete_deck", json!({ "deck": o["deck"] })),
        _ => return None,
    })
}

// ---------------------------------------------------------------------------
// Änderungs-Satz und Rückgängig

/// Stand vor einer KI-Aktion (Seiten, Karten, Stapel und die beschriebenen Hefte).
struct Snapshot {
    pages: impala_model::JsMap<impala_model::Page>,
    cards: impala_model::JsMap<impala_model::Card>,
    decks: impala_model::JsMap<impala_model::Deck>,
    hefte: Vec<(String, Option<HeftDoc>)>,
}

fn changed<T: PartialEq + serde::Serialize>(
    before: &impala_model::JsMap<T>,
    after: &impala_model::JsMap<T>,
) -> Vec<Value> {
    let mut ids: Vec<&String> = before.keys().chain(after.keys()).collect();
    ids.sort();
    ids.dedup();
    ids.into_iter()
        .filter(|id| before.get(id) != after.get(id))
        .map(|id| json!({ "id": id, "before": before.get(id).map(ser), "after": after.get(id).map(ser) }))
        .collect()
}

/// Heft-Vergleich ohne `rev` (der Zähler unterscheidet sich zwischen Geräten).
fn heft_json(doc: Option<&HeftDoc>) -> Value {
    doc.map_or(Value::Null, |d| json!({ "pages": ser(&d.pages) }))
}

impl Snapshot {
    fn take(operations: &[Value], tools: &Tools<'_>) -> Snapshot {
        let state = tools.inner.model.state();
        let mut hefte: Vec<(String, Option<HeftDoc>)> = vec![];
        for op in operations.iter().filter(|o| o.get("op").and_then(Value::as_str) == Some("heft.append")) {
            if let Some(id) = tools.page_id(&str_of(&op["title"]))
                && !hefte.iter().any(|(h, _)| *h == id)
            {
                hefte.push((id.clone(), state.hefte.get(&id).cloned()));
            }
        }
        Snapshot { pages: state.pages.clone(), cards: state.cards.clone(), decks: state.decks.clone(), hefte }
    }

    fn undo_set(&self, inner: &Inner) -> Value {
        let state = inner.model.state();
        let heft: Vec<Value> = self
            .hefte
            .iter()
            .filter_map(|(id, before)| {
                let after = state.hefte.get(id);
                let (b, a) = (heft_json(before.as_ref()), heft_json(after));
                (b != a).then(|| json!({ "id": id, "before": before.as_ref().map(ser), "after": after.map(ser) }))
            })
            .collect();
        json!({
            "pages": changed(&self.pages, &state.pages), "cards": changed(&self.cards, &state.cards),
            "decks": changed(&self.decks, &state.decks), "heftDocs": heft,
        })
    }
}

fn now_of(inner: &Inner, key: &str, id: &str) -> Value {
    let state = inner.model.state();
    match key {
        "pages" => state.pages.get(id).map(ser),
        "cards" => state.cards.get(id).map(ser),
        "decks" => state.decks.get(id).map(ser),
        _ => None,
    }
    .unwrap_or(Value::Null)
}

fn without(v: &Value, keys: &[&str]) -> Value {
    let mut v = v.clone();
    if let Value::Object(o) = &mut v {
        for k in keys {
            o.shift_remove(*k);
        }
    }
    v
}

fn list<'a>(set: &'a Value, key: &str) -> &'a [Value] {
    set.get(key).and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default()
}

/// Vergleichsform eines Hefts: nur die Seiten (`rev` und `v` unterscheiden sich zwischen Geräten).
fn heft_value(v: &Value) -> Value {
    if v.is_null() { Value::Null } else { json!({ "pages": v.get("pages") }) }
}

fn ev(inner: &mut Inner, kind: &str, payload: Value) -> Result<(), String> {
    inner.dispatch(kind, payload).map(drop).map_err(|e| e.to_string())
}

fn truthy_at(v: &Value, k: &str) -> bool {
    v.get(k).is_some_and(truthy)
}

/// Änderungs-Satz zurückspielen (wie `undo` in `web/tools.js`); scheitert, wenn die Daten seitdem
/// erneut geändert wurden. Heft-Dokumente werden per Diff auf den alten Stand gebracht.
pub(crate) fn apply_undo_in(inner: &mut Inner, set: &Value) -> Result<(), String> {
    for key in ["pages", "cards", "decks", "heftDocs"] {
        for x in list(set, key) {
            let id = str_of(&x["id"]);
            let after = x.get("after").cloned().unwrap_or(Value::Null);
            let (now, after) = if key == "heftDocs" {
                (heft_json(inner.model.state().hefte.get(&id)), heft_value(&after))
            } else {
                (now_of(inner, key, &id), after)
            };
            // Abweichung von der PWA: Der Änderungszeitpunkt einer Seite zählt nicht. Jedes Zurücknehmen setzt
            // ihn neu, wodurch die Aktion davor sonst nie mehr rückgängig zu machen wäre (nur ein Zeitstempel).
            let (now, after) = if key == "pages" {
                (without(&now, &["updated"]), without(&after, &["updated"]))
            } else {
                (now, after)
            };
            if now != after {
                return fail(
                    "Die betroffenen Daten wurden nach der KI-Aktion erneut geändert. Mache zuerst spätere Änderungen rückgängig.",
                );
            }
        }
    }
    let before_of = |x: &Value| x.get("before").filter(|b| !b.is_null()).cloned();
    // Alte Stapel zuerst, damit Karten nie auf fehlende Ziele zeigen.
    for x in list(set, "decks") {
        let id = str_of(&x["id"]);
        if before_of(x).is_some() && !inner.model.state().decks.contains_key(&id) {
            ev(inner, "deckCreate", json!({ "name": id }))?;
        }
    }
    for x in list(set, "pages") {
        let (id, Some(before)) = (str_of(&x["id"]), before_of(x)) else { continue };
        if !inner.model.state().pages.contains_key(&id) {
            ev(inner, "pageCreate", before.clone())?;
        }
        ev(inner, "pageUpdate", json!({ "id": id, "patch": without(&before, &["id", "created", "updated"]) }))?;
        // Nur bei echtem Papierkorb-Wechsel: pageRestore holt den ganzen Unterbaum zurück.
        let after = x.get("after").cloned().unwrap_or(Value::Null);
        if truthy_at(&before, "trashed") != truthy_at(&after, "trashed") {
            ev(inner, if truthy_at(&before, "trashed") { "pageTrash" } else { "pageRestore" }, json!({ "id": id }))?;
        }
        if before.get("archived") != after.get("archived") {
            ev(
                inner,
                if truthy_at(&before, "archived") { "pageArchive" } else { "pageUnarchive" },
                json!({ "id": id }),
            )?;
        }
    }
    for x in list(set, "cards") {
        let (id, Some(before)) = (str_of(&x["id"]), before_of(x)) else { continue };
        if !inner.model.state().cards.contains_key(&id) {
            ev(inner, "cardCreate", before.clone())?;
        }
        ev(
            inner,
            "cardUpdate",
            json!({ "id": id, "patch": without(&before, &["id", "created", "trashed", "trashedAt"]) }),
        )?;
        // cardRestore holt auch einen gelöschten Stapel zurück — daher nur bei echtem Wechsel.
        let now_trashed = inner.model.state().cards.get(&id).is_some_and(|c| c.is_trashed());
        if truthy_at(&before, "trashed") != now_trashed {
            ev(inner, if truthy_at(&before, "trashed") { "cardTrash" } else { "cardRestore" }, json!({ "id": id }))?;
        }
    }
    for x in list(set, "cards") {
        let id = str_of(&x["id"]);
        if before_of(x).is_none() && inner.model.state().cards.contains_key(&id) {
            ev(inner, "cardDelete", json!({ "id": id }))?;
        }
    }
    for x in list(set, "pages") {
        let id = str_of(&x["id"]);
        if before_of(x).is_none() && inner.model.state().pages.contains_key(&id) {
            ev(inner, "pageDelete", json!({ "id": id }))?;
        }
    }
    for x in list(set, "decks") {
        let id = str_of(&x["id"]);
        if before_of(x).is_none() && inner.model.state().decks.contains_key(&id) {
            ev(inner, "deckDelete", json!({ "name": id }))?;
        }
    }
    for x in list(set, "decks") {
        let (id, Some(before)) = (str_of(&x["id"]), before_of(x)) else { continue };
        if let Some(order) = before.get("order").filter(|o| o.is_number()) {
            ev(inner, "deckReorder", json!({ "name": id, "order": order }))?;
        }
        ev(inner, if truthy_at(&before, "trashed") { "deckTrash" } else { "deckRestore" }, json!({ "name": id }))?;
    }
    for x in list(set, "heftDocs") {
        let id = str_of(&x["id"]);
        let pages = x.get("before").and_then(|b| b.get("pages")).cloned().unwrap_or(json!([]));
        let target = HeftDoc::from_value(json!({ "v": 2, "rev": 0, "pages": pages }));
        let current = inner.model.state().hefte.get(&id).cloned().unwrap_or_default();
        let (ops, _) = diff_document(Some(&Shadow::of(&current)), &target);
        if !ops.is_empty() {
            let ops = serde_json::to_value(&ops).map_err(|e| e.to_string())?;
            ev(inner, "heftOps", json!({ "pageId": id, "ops": ops }))?;
        }
    }
    Ok(())
}

/// Umgebung eines KI-Laufs: führt die Werkzeuge aus und stellt Rückfragen über die Plattform.
pub(crate) struct Env<'a> {
    pub core: &'a Shared,
    pub search: Option<&'a SemanticSearch>,
    pub platform: Option<&'a Arc<dyn AiPlatform>>,
    pub active_page: Option<String>,
    /// Angezeigte Heftseite (ab 0) des geöffneten Hefts.
    pub heft_index: u32,
    pub now: LocalTime,
    pub utc_offset: i32,
    /// Chat des Laufs (Rückfrage-Karten werden hier angelegt und beantwortet).
    pub transcript: &'a RefCell<Vec<Value>>,
    /// Neue Nachricht im Chat.
    pub notify: &'a dyn Fn(&Value),
}

fn error_value(e: &str) -> Value {
    json!({ "error": e })
}

impl Env<'_> {
    fn semantic(&self, query: &str) -> Value {
        match self.search {
            None => {
                let mut inner = lock(self.core);
                let mut t = Tools {
                    inner: &mut inner,
                    active_page: self.active_page.as_deref(),
                    now: self.now,
                    utc_offset: self.utc_offset,
                };
                let mut out = json!({ "info": "Kein Embedding-Modell konfiguriert — Stichwortsuche verwendet." });
                if let (Some(o), Value::Object(k)) = (out.as_object_mut(), t.keyword_hits(query)) {
                    o.extend(k);
                }
                out
            }
            Some(search) => match search.search(query.to_owned(), 6) {
                Ok(hits) => {
                    let list: Vec<Value> = hits
                        .iter()
                        .map(|h| json!({
                            "pageId": h.page_id, "title": h.title, "snippet": h.snippet, "score": h.score,
                            "semanticScore": h.semantic_score, "lexicalScore": h.lexical_score, "archived": h.archived,
                        }))
                        .collect();
                    json!({ "results": list })
                }
                Err(e) => error_value(&e.to_string()),
            },
        }
    }

    fn exec(&mut self, name: &str, a: &Value) -> (Value, Option<Value>) {
        match name {
            "inspect" if a.get("kind").and_then(Value::as_str) == Some("search") && truthy_at(a, "semantic") => {
                (self.semantic(&arg(a, "query")), None)
            }
            "inspect" | "change" => {
                let mut inner = lock(self.core);
                let mut t = Tools {
                    inner: &mut inner,
                    active_page: self.active_page.as_deref(),
                    now: self.now,
                    utc_offset: self.utc_offset,
                };
                if name == "change" { t.change(a) } else { (t.inspect(a).unwrap_or_else(|e| error_value(&e)), None) }
            }
            other => {
                let text = self.platform.and_then(|p| p.run_tool(other.to_owned(), a.to_string()));
                match text {
                    Some(t) => (serde_json::from_str(&t).unwrap_or_else(|_| json!({ "result": t })), None),
                    None => (error_value(&format!("Werkzeug nicht verfügbar: {other}")), None),
                }
            }
        }
    }

    fn heft_page_of(&self, title: Option<&str>, page: Option<f64>) -> Result<(u32, HeftPageContent), (u32, String)> {
        let (id, index) = {
            let inner = lock(self.core);
            let state = inner.model.state();
            let id = match title {
                Some(t) => {
                    let pg = state
                        .find_page(t, true)
                        .ok_or_else(|| (0, format!("Keine Seite mit Titel „{t}“ gefunden.")))?;
                    if !pg.is_heft() {
                        return Err((0, format!("„{}“ ist kein Handschrift-Heft.", pg.title())));
                    }
                    pg.id().to_owned()
                }
                None => self
                    .active_page
                    .clone()
                    .filter(|p| state.pages.get(p).is_some_and(|x| x.is_heft()))
                    .ok_or_else(|| (0, "Es ist gerade kein Heft geöffnet — bitte page_title angeben.".to_owned()))?,
            };
            let index = match page.filter(|p| *p != 0.0) {
                Some(p) => (p.floor() as i64 - 1).max(0) as u32,
                None if self.active_page.as_deref() == Some(id.as_str()) => self.heft_index,
                None => 0,
            };
            (id, index)
        };
        let page_no = index + 1;
        let (texts, ocr_text) = {
            let inner = lock(self.core);
            let pg = inner
                .model
                .state()
                .hefte
                .get(&id)
                .and_then(|d| d.pages.get(index as usize))
                .ok_or_else(|| (page_no, format!("Heftseite {page_no} gibt es nicht.")))?;
            (pg.texts.iter().filter_map(|t| t.text.clone()).filter(|t| !t.is_empty()).collect(), pg.ocr_text.clone())
        };
        let image = self.platform.and_then(|p| p.heft_page_image(id, index));
        let image_url =
            image.ok_or_else(|| (page_no, "Die Heftseite konnte nicht als Bild geladen werden.".to_owned()))?;
        Ok((page_no, HeftPageContent { texts, ocr_text, image_url }))
    }
}

impl ToolExecutor for Env<'_> {
    async fn run(&mut self, name: &str, args: &Value) -> Result<ToolOutput, String> {
        let (value, undo) = self.exec(name, args);
        Ok(ToolOutput { json: value.to_string(), undo })
    }

    async fn ask(&mut self, question: &str, options: &[String]) -> Option<String> {
        let mid = new_id();
        let card =
            json!({ "mid": mid, "role": "question", "question": question, "options": options, "answered": false });
        self.transcript.borrow_mut().push(card.clone());
        (self.notify)(&card);
        // Ohne Plattform gibt es niemanden zum Fragen: Bestätigungen gelten dann als abgelehnt.
        let answer = match self.platform {
            Some(p) => p.ask(question.to_owned(), options.to_vec()),
            None => options.last().cloned(),
        };
        if let Some(c) = self.transcript.borrow_mut().iter_mut().find(|m| m["mid"] == mid.as_str()) {
            c["answered"] = Value::Bool(true);
            c["answer"] = Value::from(answer.clone().unwrap_or_else(|| "Abgebrochen".into()));
        }
        answer
    }

    async fn heft_page(&mut self, title: Option<&str>, page: Option<f64>) -> HeftPage {
        match self.heft_page_of(title, page) {
            Ok((page_no, content)) => HeftPage { page_no, result: Ok(content) },
            Err((page_no, e)) => HeftPage { page_no, result: Err(e) },
        }
    }
}

#[uniffi::export]
impl ImpalaCore {
    /// Eine KI-Änderung (Karte `edit` im Chat) zurücknehmen und die Karte als `undone` markieren.
    /// Scheitert mit `Invalid`, wenn die betroffenen Daten seitdem erneut geändert wurden.
    pub fn undo_ai_change(&self, chat_id: String, message_id: String) -> Result<(), CoreError> {
        let mut inner = self.lock();
        let (title, created, _, mut messages) =
            inner.chat_raw(&chat_id).ok_or_else(|| invalid(format!("Unbekannter Chat {chat_id}")))?;
        let msg = messages
            .iter_mut()
            .find(|m| m["mid"] == message_id.as_str() && m["role"] == "edit")
            .ok_or_else(|| invalid(format!("Keine Änderungs-Karte {message_id}")))?;
        if truthy_at(msg, "undone") {
            return Ok(());
        }
        let undo =
            msg.get("undo").filter(|u| u.is_object()).cloned().ok_or_else(|| invalid("Keine Rückgängig-Daten."))?;
        apply_undo_in(&mut inner, &undo).map_err(invalid)?;
        // Die Karte neu aus dem Chat holen (apply_undo_in hat den Chat nicht verändert).
        if let Some(m) = messages.iter_mut().find(|m| m["mid"] == message_id.as_str()) {
            m["undone"] = Value::Bool(true);
        }
        inner.save_chat_raw(&chat_id, &title, &created, messages)
    }

    /// Änderungs-Satz (`undo` einer Änderungs-Karte, JSON) direkt zurückspielen.
    pub fn undo_ai_changes(&self, undo_json: String) -> Result<(), CoreError> {
        let set: Value = serde_json::from_str(&undo_json).map_err(|e| invalid(format!("Rückgängig-Daten: {e}")))?;
        apply_undo_in(&mut self.lock(), &set).map_err(invalid)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn env<'a>(core: &'a Shared, transcript: &'a RefCell<Vec<Value>>, notify: &'a dyn Fn(&Value)) -> Env<'a> {
        let now = LocalTime { year: 2026, month: 10, day: 28, weekday: 3, hour: 14, minute: 5 };
        Env {
            core,
            search: None,
            platform: None,
            active_page: None,
            heft_index: 0,
            now,
            utc_offset: 60,
            transcript,
            notify,
        }
    }

    fn run(e: &mut Env<'_>, name: &str, args: Value) -> (Value, Option<Value>) {
        e.exec(name, &args)
    }

    #[test]
    fn change_legt_an_und_macht_rueckgaengig() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let existing = core.create_page("Mathe".into(), "Zeile A\nZeile B".into(), None, None).unwrap();
        let (transcript, notify) = (RefCell::new(vec![]), |_: &Value| {});
        let mut e = env(&core.inner, &transcript, &notify);

        let ops = json!({ "operations": [
            { "op": "page.create", "title": "Neu", "content": "Hallo", "parent": "Mathe" },
            { "op": "page.patch", "title": "Mathe", "search": "Zeile B", "replace": "Zeile C" },
            { "op": "card.create", "front": "Was ist 1+1?", "back": "2", "deck": "Rechnen" },
        ]});
        let (res, undo) = run(&mut e, "change", ops);
        assert_eq!(res["ok"], true, "{res}");
        assert_eq!(res["operations"], 3);
        let undo = undo.unwrap();
        assert!(undo["pages"].as_array().unwrap().len() == 2 && undo["cards"].as_array().unwrap().len() == 1);
        assert_eq!(core.page(existing.clone()).unwrap().content, "Zeile A\nZeile C");
        let neu = core.children_of(Some(existing.clone()), None);
        assert_eq!(neu[0].title, "Neu");
        assert_eq!(core.cards_in_deck("Rechnen".into()).len(), 1);

        core.undo_ai_changes(undo.to_string()).unwrap();
        assert_eq!(core.page(existing.clone()).unwrap().content, "Zeile A\nZeile B");
        assert!(core.children_of(Some(existing), None).is_empty());
        assert!(core.cards_in_deck("Rechnen".into()).is_empty());
    }

    #[test]
    fn fehlerhafte_operation_nimmt_alles_zurueck() {
        let core = ImpalaCore::open_in_memory().unwrap();
        core.create_page("Seite".into(), "Text".into(), None, None).unwrap();
        let (transcript, notify) = (RefCell::new(vec![]), |_: &Value| {});
        let mut e = env(&core.inner, &transcript, &notify);
        let (res, undo) = run(
            &mut e,
            "change",
            json!({ "operations": [
                { "op": "page.create", "title": "Eins" },
                { "op": "page.patch", "title": "Seite", "search": "gibtsnicht", "replace": "x" },
            ]}),
        );
        assert!(undo.is_none());
        assert!(res["error"].as_str().unwrap().contains("Alle vorherigen Änderungen wurden zurückgenommen"), "{res}");
        assert_eq!(core.children_of(None, None).len(), 1);
        // Validierung vor der Ausführung.
        let (res, _) = run(&mut e, "change", json!({ "operations": [{ "op": "page.create" }] }));
        assert!(res["error"].as_str().unwrap().contains("title fehlt"));
    }

    #[test]
    fn undo_scheitert_nach_spaeterer_aenderung_und_heft_wird_ergaenzt() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let heft = core.create_heft("Skizzen".into(), None, None).unwrap();
        let (transcript, notify) = (RefCell::new(vec![]), |_: &Value| {});
        let mut e = env(&core.inner, &transcript, &notify);
        let (res, undo) = run(
            &mut e,
            "change",
            json!({ "operations": [{ "op": "heft.append", "title": "Skizzen", "text": "Notiz im Heft" }] }),
        );
        assert_eq!(res["ok"], true, "{res}");
        let page_id = core.heft_page_ids(heft.clone())[0].clone();
        assert_eq!(core.heft_page(heft.clone(), page_id.clone()).unwrap().texts[0].text, "Notiz im Heft");
        let undo = undo.unwrap();
        assert_eq!(undo["heftDocs"].as_array().unwrap().len(), 1);

        // Spätere Änderung am Heft → Rückgängig verweigert, bis sie zurückgenommen ist.
        let (_, second) = run(
            &mut e,
            "change",
            json!({ "operations": [{ "op": "heft.append", "title": "Skizzen", "text": "Zweite Notiz" }] }),
        );
        assert!(core.undo_ai_changes(undo.to_string()).is_err());
        core.undo_ai_changes(second.unwrap().to_string()).unwrap();
        core.undo_ai_changes(undo.to_string()).unwrap();
        assert!(core.heft_page(heft, page_id).unwrap().texts.is_empty());
    }

    #[test]
    fn lesen_und_karten_werkzeuge() {
        let core = ImpalaCore::open_in_memory().unwrap();
        core.create_page("Analysis".into(), "Integrale und Ableitungen".into(), None, None).unwrap();
        core.create_card("Was ist ein Integral?".into(), "Fläche".into(), Some("Mathe".into()), None).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(10));
        let (transcript, notify) = (RefCell::new(vec![]), |_: &Value| {});
        let mut e = env(&core.inner, &transcript, &notify);

        let (r, _) = run(&mut e, "inspect", json!({ "kind": "page", "titles": ["analysis"] }));
        assert_eq!(r["pages"][0]["content"], "Integrale und Ableitungen");
        let (r, _) = run(&mut e, "inspect", json!({ "kind": "search", "query": "ableitungen" }));
        assert_eq!(r["results"][0]["title"], "Analysis");
        let (r, _) = run(&mut e, "inspect", json!({ "kind": "decks" }));
        let mathe = r["decks"].as_array().unwrap().iter().find(|d| d["name"] == "Mathe").expect("Stapel Mathe");
        assert_eq!(mathe["cards"], 1);
        let (r, _) = run(&mut e, "inspect", json!({ "kind": "cards", "query": "integral" }));
        assert_eq!(r["totalMatches"], 1);
        let (r, _) = run(&mut e, "inspect", json!({ "kind": "context" }));
        assert!(r["now"].as_str().unwrap().starts_with("Mittwoch, 28. Oktober 2026, 14:05"), "{r}");
        let (r, _) = run(&mut e, "inspect", json!({ "kind": "semantic-quatsch" }));
        assert!(r["error"].is_string());
        // Mehrdeutig/unbekannt → Fehlertexte für das Modell.
        let (r, _) = run(&mut e, "change", json!({ "operations": [{ "op": "deck.trash", "deck": "gibts-nicht" }] }));
        assert!(r["error"].as_str().unwrap().contains("Stapel nicht gefunden"), "{r}");
        let (r, _) = run(&mut e, "calculate", json!({ "expression": "1+1" }));
        assert!(r["error"].as_str().unwrap().contains("nicht verfügbar"));
    }
}
