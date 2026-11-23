//! Lesende Werkzeuge (`inspect`) und die Auswahl von Karten und Stapeln.

use impala_model::study::StudyOptions;
use impala_model::tree::deck_in_tree;
use impala_sort::SortExt;
use impala_srs::Timestamp;
use serde_json::{Map, Value, json};

use crate::{
    Res, Tools, arg, fail, full_page_path, head16, is_descendant_of, len16, lower, newest_first, num, str_of, targ,
    truthy,
};

// ---------------------------------------------------------------------------
// Auswahl von Karten und Stapeln

pub(crate) struct Selection {
    pub ids: Vec<String>,
    pub total: usize,
    pub truncated: bool,
}

impl Tools<'_> {
    // ---- Karten

    pub(crate) fn card_text(&self, id: &str, key: &str) -> String {
        self.host.model().state().cards.get(id).and_then(|c| c.get(key)).map(|v| str_of(&v)).unwrap_or_default()
    }

    pub(crate) fn card_deck(&self, id: &str) -> String {
        self.host.model().state().cards.get(id).map(|c| c.deck_name().to_owned()).unwrap_or_default()
    }

    pub(crate) fn active_card_ids(&self) -> Vec<String> {
        self.host.model().state().active_cards().iter().map(|c| c.id().to_owned()).collect()
    }

    pub(crate) fn find_card(&self, front: &str, deck: Option<&str>) -> Option<String> {
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

    pub(crate) fn deck_matches(&self, name: &str) -> Vec<String> {
        let q = lower(name.trim());
        if q.is_empty() {
            return vec![];
        }
        let state = self.host.model().state();
        let names: Vec<&String> =
            state.decks.iter().filter(|(n, d)| !d.is_trashed() && !state.is_deck_archived(n)).map(|(n, _)| n).collect();
        match names.iter().find(|n| lower(n) == q) {
            Some(exact) => vec![(*exact).clone()],
            None => names.into_iter().filter(|n| lower(n).contains(&q)).cloned().collect(),
        }
    }

    pub(crate) fn resolve_deck(&self, name: &str) -> Result<String, String> {
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
    pub(crate) fn select_cards(&self, a: &Value, max: usize, allow_all: bool) -> Result<Selection, String> {
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
    pub(crate) fn ensure_deck(&mut self, name: &str) -> Result<Option<String>, String> {
        let clean = name.trim().trim_matches(':').trim().to_owned();
        if clean.is_empty() {
            return Ok(None);
        }
        let exact = self
            .host
            .model()
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
    pub(crate) fn free_deck_slot(&mut self, name: &str) -> Result<(), String> {
        let Some(trashed) = self.host.model().state().decks.get(name).map(|d| d.is_trashed()) else { return Ok(()) };
        if !trashed {
            return fail(format!("Es gibt bereits einen Stapel „{name}“ — bitte anderen Namen wählen."));
        }
        self.ev("deckRestore", json!({ "name": name }))
    }

    pub(crate) fn cards_of_deck(&self, deck: &str) -> usize {
        self.active_card_ids().iter().filter(|id| deck_in_tree(&self.card_deck(id), deck)).count()
    }

    pub(crate) fn study_options(&self) -> StudyOptions<'static> {
        StudyOptions::with_offset(None, Timestamp::from_millis(self.ctx.now_ms), i64::from(self.ctx.utc_offset))
    }

    // ---- Lesen

    pub(crate) fn keyword_hits(&mut self, query: &str) -> Value {
        let (model, search) = self.host.model_search();
        let all = search.search(model, query, true);
        let pages = &model.state().pages;
        let results: Vec<Value> = all
            .iter()
            .take(20)
            .map(|h| {
                let pg = pages.get(&h.id);
                let mut o = json!({ "title": pg.map(|p| model.state().page_label(p)).unwrap_or_default() });
                if let Some(parent) = pg.and_then(|p| p.parent()).and_then(|id| pages.get(id)) {
                    o["parent"] = Value::from(model.state().page_label(parent));
                }
                o["snippet"] = Value::from(h.snippet.clone());
                if pg.is_some_and(|p| p.is_heft()) {
                    o["heft"] = Value::Bool(true);
                }
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

    pub(crate) fn get_context(&self) -> Value {
        let state = self.host.model().state();
        let cur = self.ctx.active_page.as_deref().and_then(|id| state.pages.get(id));
        let mut pages = state.active_pages();
        pages.sort_small_by(|a, b| newest_first(a, b));
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
        let n = &self.ctx.now;
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
            json!({ "title": p.title(), "content": format!("{}{}", head16(body, 4000), if cut { "\n[… gekürzt — Rest per read_pages]" } else { "" }) })
        });
        json!({
            "now": now,
            "currentPage": current,
            "currentCard": self.ctx.current_card,
            "recentPages": recent,
            "study": { "neu": counts.new, "review": counts.review, "learn": counts.learn },
            "pageCount": pages.len(),
        })
    }

    /// Zusammenhang einer gelesenen Seite (wie `pageInfo` in `web/tools.js`): Ordner, Unterseiten;
    /// als Verzeichnis-Eintrag Spalten + eigene Werte, als Verzeichnis Spalten + Einträge.
    pub(crate) fn page_info(&self, pg: &impala_model::Page, out: &mut Map<String, Value>) {
        // Spaltenwerte ohne die Titelspalte: Sie steht schon als title da (spart Token je Eintrag).
        let own_props = |p: &impala_model::Page| {
            let mut props = p.get("props").and_then(|v| v.as_object().cloned()).unwrap_or_default();
            props.retain(|_, v| v.as_str() != Some(p.title()));
            Value::Object(props)
        };
        let state = self.host.model().state();
        let parent = pg.parent().and_then(|id| state.pages.get(id));
        if let Some(p) = parent {
            out.insert("parent".into(), Value::from(state.page_label(p)));
            if let Some(schema) = p.get("db").and_then(|d| d.get("schema").cloned()) {
                let columns = impala_ai::edit::columns(&schema);
                out.insert("verzeichnis".into(), json!({ "title": state.page_label(p), "columns": columns }));
                out.insert("props".into(), own_props(pg));
            }
        }
        let kids = state.children_of(Some(pg.id()), Some(pg.workspace()), None);
        if let Some(schema) = pg.get("db").and_then(|d| d.get("schema").cloned()) {
            out.insert("columns".into(), json!(impala_ai::edit::columns(&schema)));
            let entries: Vec<Value> =
                kids.iter().take(40).map(|r| json!({ "title": state.page_label(r), "props": own_props(r) })).collect();
            out.insert("entries".into(), Value::Array(entries));
            if kids.len() > 40 {
                out.insert("entriesTotal".into(), Value::from(kids.len()));
            }
        } else if !kids.is_empty() {
            out.insert("children".into(), json!(kids.iter().take(30).map(|r| state.page_label(r)).collect::<Vec<_>>()));
            if kids.len() > 30 {
                out.insert("childrenTotal".into(), Value::from(kids.len()));
            }
        }
    }

    pub(crate) fn read_page(&self, title: &str, max: usize, offset: Option<usize>, find: Option<&str>) -> Res {
        let id =
            self.page_by_title(title).map_err(|e| format!("{e}. Titel mit search oder list_pages nachschlagen."))?;
        let state = self.host.model().state();
        let Some(pg) = state.pages.get(&id) else { return fail(format!("Seite nicht gefunden: {title}")) };
        // Lange Inhalte: Ausschnitt ab offset bzw. Textstelle find, mit Hinweis aufs Weiterlesen.
        let clip = |s: &str| impala_ai::edit::read_window(s, max, offset, find);
        let mut out = Map::new();
        out.insert("title".into(), Value::from(state.page_label(pg)));
        if pg.is_heft() {
            let meta = self.host.model().heft_meta(&id);
            let has_bg = state.hefte.get(&id).is_some_and(|d| d.pages.iter().any(|hp| hp.background.is_some()));
            out.insert("id".into(), Value::from(pg.id()));
            out.insert("heft".into(), Value::Bool(true));
            out.insert("archived".into(), Value::Bool(pg.is_archived()));
            if has_bg {
                out.insert("hasPdf".into(), Value::Bool(true));
            }
            self.page_info(pg, &mut out);
            out.insert("pages".into(), json!(meta.as_ref().map_or(1, |m| m.pages)));
            out.insert("content".into(), Value::from(clip(meta.as_ref().map_or("", |m| m.ocr_text.as_str()))));
            out.insert("note".into(), Value::from("Handschrift-Heft: content = erkannte Handschrift + getippte Text-Boxen. Sichtbar schreiben nur mit write_to_heft."));
            return Ok(Value::Object(out));
        }
        if pg.is_archived() {
            out.insert("archived".into(), Value::Bool(true));
        }
        self.page_info(pg, &mut out);
        out.insert("content".into(), Value::from(clip(pg.content())));
        if pg.truthy("pdfId") {
            out.insert("hasPdf".into(), Value::Bool(true));
        }
        Ok(Value::Object(out))
    }

    pub(crate) fn list_pages(&self, query: &str, parent: &str) -> Res {
        let state = self.host.model().state();
        let mut all = state.active_pages();
        all.sort_small_by(|a, b| newest_first(a, b));
        let parent_trim = parent.trim();
        if !parent_trim.is_empty() {
            let root_id = self.page_id(parent_trim).ok_or_else(|| format!("Ordner nicht gefunden: {parent_trim}"))?;
            all.retain(|p| is_descendant_of(state, p, &root_id));
        }
        let q = lower(query.trim());
        if !q.is_empty() {
            let (mut direct, mut by_path) = (vec![], vec![]);
            for p in all {
                if lower(p.title()).contains(&q) {
                    direct.push(p);
                } else if lower(&full_page_path(state, p)).contains(&q) {
                    by_path.push(p);
                }
            }
            direct.extend(by_path);
            all = direct;
        }
        let pages: Vec<Value> = all
            .iter()
            .take(60)
            .map(|p| {
                let parent = p.parent().and_then(|id| state.pages.get(id)).map(|x| state.page_label(x));
                let heft_doc = p.is_heft().then(|| state.hefte.get(p.id())).flatten();
                let has_bg = heft_doc.is_some_and(|d| d.pages.iter().any(|hp| hp.background.is_some()));
                let mut o = json!({
                    "id": p.id(),
                    "title": state.page_label(p),
                    "parent": parent,
                    "hasPdf": p.truthy("pdfId") || has_bg,
                });
                if p.is_heft() {
                    o["heft"] = Value::Bool(true);
                    o["pageCount"] = Value::from(heft_doc.map_or(1, |d| d.pages.len()));
                }
                if p.truthy("db") {
                    o["verzeichnis"] = Value::Bool(true);
                }
                o
            })
            .collect();
        let mut out = json!({ "pages": pages, "total": all.len() });
        if all.len() > 60 {
            out["note"] = Value::from("Nur die ersten 60 Treffer — mit parent/query eingrenzen oder search nutzen.");
        }
        Ok(out)
    }

    pub(crate) fn list_flashcards(&self, a: &Value) -> Res {
        let limit = num(a, "limit").filter(|n| *n != 0.0).unwrap_or(30.0);
        let sel =
            self.select_cards(&json!({ "deck": a.get("deck"), "query": a.get("query"), "limit": limit }), 100, true)?;
        let state = self.host.model().state();
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

    pub(crate) fn list_decks(&self) -> Value {
        let state = self.host.model().state();
        let mut names: Vec<&String> =
            state.decks.iter().filter(|(n, d)| !d.is_trashed() && !state.is_deck_archived(n)).map(|(n, _)| n).collect();
        names.sort_small_by_key(|n| lower(n));
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

    pub(crate) fn list_due_cards(&self) -> Value {
        let state = self.host.model().state();
        let due = state.due_cards(&self.study_options());
        let list: Vec<Value> = due
            .iter()
            .take(20)
            .filter_map(|id| state.cards.get(id))
            .map(|c| json!({ "front": c.get("front").map(|v| str_of(&v)).unwrap_or_default(), "deck": c.deck_name(), "due": c.srs_due() }))
            .collect();
        json!({ "due": list, "totalDue": due.len() })
    }

    pub(crate) fn search_chat_history(&self, a: &Value) -> Res {
        let q = lower(targ(a, "query").as_str());
        if q.is_empty() {
            return fail("search_chat_history: query fehlt.");
        }
        let limit = (num(a, "limit").filter(|n| *n != 0.0).unwrap_or(15.0) as usize).clamp(1, 30);
        let mut sessions: Vec<Value> = match &self.ctx.chats {
            Some(list) => list.clone(),
            None => {
                self.host.model().state().chat_sessions.values().filter(|c| !c.is_deleted()).map(crate::ser).collect()
            }
        };
        sessions.sort_small_by_key(|c| std::cmp::Reverse(c.get("updated").map(str_of).unwrap_or_default()));
        let (mut hits, mut total) = (vec![], 0);
        for s in sessions {
            let Some(Value::Array(messages)) = s.get("messages") else { continue };
            for m in messages {
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
                let updated = s.get("updated").map(str_of).unwrap_or_default();
                hits.push(json!({
                    "chatId": s.get("id"), "chatTitle": s.get("title").filter(|t| truthy(t)).cloned().unwrap_or_else(|| Value::from("(ohne Titel)")),
                    "updated": head16(&updated, 16).replace('T', " "), "role": role, "snippet": snippet,
                }));
            }
        }
        Ok(json!({ "results": hits, "totalMatches": total }))
    }

    pub(crate) fn inspect(&mut self, a: &Value) -> Res {
        let limit = (num(a, "limit").filter(|n| *n != 0.0).unwrap_or(30.0) as usize).clamp(1, 100);
        match a.get("kind").and_then(Value::as_str).unwrap_or("") {
            "context" => Ok(self.get_context()),
            "pages" => self.list_pages(&arg(a, "query"), &arg(a, "parent")),
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
                // Mehrere Seiten teilen sich das Ergebnis-Limit der Agent-Schleife (12 000 Zeichen).
                let max = (11000 / titles.len()).max(3000);
                let offset = num(a, "offset").filter(|o| *o > 0.0).map(|o| o as usize);
                let find = a.get("find").and_then(Value::as_str).filter(|f| !f.trim().is_empty());
                let pages: Vec<Value> = titles
                    .iter()
                    .map(|t| self.read_page(t, max, offset, find).unwrap_or_else(|e| json!({ "error": e })))
                    .collect();
                Ok(json!({ "pages": pages }))
            }
            "decks" => Ok(self.list_decks()),
            "cards" => self.list_flashcards(&json!({ "deck": a.get("deck"), "query": a.get("query"), "limit": limit })),
            "due" => Ok(self.list_due_cards()),
            "search" => Ok(self.keyword_hits(&arg(a, "query"))),
            "chats" => self.search_chat_history(&json!({ "query": a.get("query"), "limit": limit })),
            "archived" => {
                let roots = self.host.model().state().archived_page_roots();
                let list: Vec<Value> = roots
                    .iter()
                    .map(|p| {
                        let at = p.get("archivedAt").filter(truthy).unwrap_or_else(|| Value::from(p.updated()));
                        json!({ "title": p.title(), "kind": if p.is_heft() { "heft" } else { "page" }, "archivedAt": at })
                    })
                    .collect();
                Ok(json!({ "archived": list, "total": roots.len() }))
            }
            // Mit den erlaubten Werten: Kleine Modelle korrigieren sich dann im nächsten Schritt selbst.
            other => fail(format!(
                "inspect: unbekanntes kind „{other}“. Erlaubt: context, pages, page, decks, cards, due, search (Bedeutungssuche: search mit semantic=true), chats, archived."
            )),
        }
    }
}
