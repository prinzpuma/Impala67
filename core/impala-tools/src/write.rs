//! Schreibende Einzel-Werkzeuge (Ziele der `change`-Operationen).

use std::collections::BTreeSet;

use impala_heft::ink::content_bottom;
use impala_heft::{HeftOp, Item, PAGE_W, Paper, TextBox};
use impala_model::tree::deck_in_tree;
use impala_srs::{Srs, Timestamp};
use serde_json::{Map, Value, json};

use crate::{Res, Tools, arg, fail, head16, lower, no_ids, num, ser, str_of, targ, truthy};

impl Tools<'_> {
    // ---- Ändern

    pub(crate) fn duplicate_sibling_error(
        &self,
        title: &str,
        parent: Option<&impala_model::Page>,
        workspace: &str,
        trashed: &BTreeSet<String>,
    ) -> Option<String> {
        let clean = title.trim();
        let norm = lower(clean);
        let parent_id = parent.map(|p| p.id());
        let state = self.host.model().state();
        let exists = state.active_pages().into_iter().any(|p| {
            !trashed.contains(p.id())
                && p.parent() == parent_id
                && (parent_id.is_some() || p.workspace() == workspace)
                && lower(p.title().trim()) == norm
        });
        if !exists {
            return None;
        }
        Some(match parent {
            Some(p) => format!(
                "Seite „{clean}“ existiert bereits in „{}“ — zum Bearbeiten edit_page nutzen.",
                state.page_label(p)
            ),
            None => format!("Seite „{clean}“ existiert bereits — zum Bearbeiten edit_page nutzen."),
        })
    }

    pub(crate) fn create_page(&mut self, a: &Value) -> Res {
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
        let id = self.host.new_id();
        let workspace = self.workspace_for(parent.as_deref());
        let state = self.host.model().state();
        let parent_page = parent.as_deref().and_then(|p| state.pages.get(p));
        if let Some(err) = self.duplicate_sibling_error(&title, parent_page, &workspace, &no_ids()) {
            return fail(err);
        }
        let parent_name = parent_page.map(|p| p.title().to_owned());
        let props = match a.get("props").filter(|v| !v.is_null()) {
            Some(update) => Some(self.merge_props(parent_page, &Value::Null, update, &title)?),
            None => None,
        };
        let heft = a.get("heft").and_then(Value::as_bool) == Some(true);
        let mut create = json!({ "id": id, "title": title, "parentId": parent, "content": if heft { String::new() } else { arg(a, "content") }, "workspaceId": workspace });
        if heft {
            create["kind"] = Value::from("heft");
        }
        self.ev("pageCreate", create)?;
        if let Some(props) = props.filter(|p| !p.is_null()) {
            self.ev("pageUpdate", json!({ "id": id, "patch": { "props": props } }))?;
        }
        let mut out = json!({ "ok": true, "id": id, "title": title, "parent": parent_name });
        if heft {
            out["heft"] = Value::Bool(true);
        }
        Ok(out)
    }

    /// Spaltenwerte gegen das Schema des Verzeichnisses (Kern: `impala_ai::edit::merge_props`).
    pub(crate) fn merge_props(
        &self,
        parent: Option<&impala_model::Page>,
        current: &Value,
        update: &Value,
        title: &str,
    ) -> Res {
        let schema = parent.and_then(|p| p.get("db")).and_then(|d| d.get("schema").cloned()).unwrap_or(Value::Null);
        impala_ai::edit::merge_props(&schema, current, update, title, parent.map_or("", |p| p.title()))
    }

    pub(crate) fn set_page_props(&mut self, a: &Value) -> Res {
        let id = self.page_by_title(&arg(a, "page_title"))?;
        let state = self.host.model().state();
        let pg = state.pages.get(&id).cloned().unwrap_or_default();
        let parent = pg.parent().and_then(|p| state.pages.get(p));
        let current = pg.get("props").unwrap_or(Value::Null);
        let props = self.merge_props(parent, &current, a.get("props").unwrap_or(&Value::Null), pg.title())?;
        self.ev("pageUpdate", json!({ "id": id, "patch": { "props": props } }))?;
        Ok(json!({ "ok": true, "title": pg.title(), "props": props }))
    }

    pub(crate) fn page_patch(&mut self, id: &str, content: String) -> Result<(), String> {
        self.ev("pageUpdate", json!({ "id": id, "patch": { "content": content } }))
    }

    pub(crate) fn append_to_page(&mut self, a: &Value) -> Res {
        let id = self.page_by_title(&arg(a, "page_title"))?;
        let content = a.get("content").map(str_of).unwrap_or_default().trim().to_owned();
        if content.is_empty() {
            return fail("append_to_page: content fehlt.");
        }
        let pg = self.host.model().state().pages.get(&id).cloned().unwrap_or_default();
        // Hefte zeigen nur Striche/Bilder/Textfelder: Markdown in `content` wäre unsichtbar.
        if pg.is_heft() {
            return self.write_to_heft(&json!({ "page_title": arg(a, "page_title"), "text": content }));
        }
        let joined = if pg.content().is_empty() { content } else { format!("{}\n\n{content}", pg.content()) };
        self.page_patch(&id, joined)?;
        Ok(json!({ "ok": true, "title": pg.title() }))
    }

    pub(crate) fn write_to_heft(&mut self, a: &Value) -> Res {
        let id = self.page_by_title(&arg(a, "page_title"))?;
        let pg = self.host.model().state().pages.get(&id).cloned().unwrap_or_default();
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
    pub(crate) fn heft_add_text(
        &mut self,
        page_id: &str,
        body: &str,
        index: Option<usize>,
    ) -> Result<(usize, bool), String> {
        if body.is_empty() {
            return fail("Ins Heft schreiben fehlgeschlagen: Kein Text");
        }
        let doc = self.host.model().state().hefte.get(page_id).cloned().unwrap_or_default();
        let mut ops: Vec<HeftOp> = vec![];
        let (mut pi, mut paper_page) = (0, doc.pages.last().cloned());
        if doc.pages.is_empty() {
            let id = self.host.new_id();
            ops.push(HeftOp::PageAdd { at: None, page: id.clone(), paper: Some(Paper::default()), height: None });
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
        if index.is_none() && y > 80.0 && y + h.min(220.0) > pg.page_height() - 50.0 && !doc.pages.is_empty() {
            let id = self.host.new_id();
            ops.push(HeftOp::PageAdd { at: None, page: id.clone(), paper: Some(pg.paper.clone()), height: None });
            pg = impala_heft::HeftPage::empty(id, pg.paper.clone());
            pi = doc.pages.len();
            (y, added) = (60.0, true);
        } else if doc.pages.is_empty() {
            y = 70.0;
        }
        let text = TextBox {
            id: self.host.new_id(),
            x: Some(80.0),
            y: Some(y.min(pg.page_height() - 80.0)),
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

    pub(crate) fn replace_page_content(&mut self, a: &Value) -> Res {
        let id = self.page_by_title(&arg(a, "page_title"))?;
        let pg = self.host.model().state().pages.get(&id).cloned().unwrap_or_default();
        if pg.is_heft() {
            return fail(
                "Heft-Inhalte (Striche/Bilder) können nicht ersetzt werden — write_to_heft fügt sichtbaren Text hinzu.",
            );
        }
        let content = arg(a, "content");
        if a.get("allow_deleting_content") != Some(&Value::Bool(true))
            && let Some(guard) = impala_ai::edit::replace_guard(pg.content(), &content)
        {
            return fail(guard);
        }
        self.page_patch(&id, content)?;
        Ok(json!({ "ok": true, "title": pg.title() }))
    }

    pub(crate) fn patch_page(&mut self, a: &Value) -> Res {
        let id = self.page_by_title(&arg(a, "page_title"))?;
        let pg = self.host.model().state().pages.get(&id).cloned().unwrap_or_default();
        if pg.is_heft() {
            return fail(
                "Heft-Inhalte (Striche/Bilder) können nicht gepatcht werden — write_to_heft fügt sichtbaren Text hinzu.",
            );
        }
        let search = a.get("search").filter(|v| !v.is_null()).map(str_of).unwrap_or_default();
        let replace = ["replace", "content"]
            .iter()
            .filter_map(|k| a.get(*k))
            .find(|v| !v.is_null())
            .map(str_of)
            .unwrap_or_default();
        // Wörtlich, sonst leerraum-tolerant; Fehler nennt die ähnlichste Zeile.
        let new = impala_ai::edit::patch(pg.content(), &search, &replace)?;
        self.page_patch(&id, new)?;
        Ok(json!({ "ok": true, "title": pg.title() }))
    }

    pub(crate) fn rename_page(&mut self, a: &Value) -> Res {
        let id = self.page_by_title(&arg(a, "page_title"))?;
        let title = targ(a, "new_title");
        if title.is_empty() {
            return fail("rename_page: new_title fehlt.");
        }
        self.ev("pageUpdate", json!({ "id": id, "patch": { "title": title } }))?;
        Ok(json!({ "ok": true, "from": arg(a, "page_title"), "title": title }))
    }

    pub(crate) fn move_page(&mut self, a: &Value) -> Res {
        let id = self.page_by_title(&arg(a, "page_title"))?;
        let new_parent = arg(a, "new_parent_title");
        let parent = if new_parent.is_empty() {
            None
        } else {
            Some(self.page_id(&new_parent).ok_or_else(|| format!("Elternseite nicht gefunden: {new_parent}"))?)
        };
        let state = self.host.model().state();
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

    pub(crate) fn subpages(&self, id: &str) -> usize {
        self.host.model().state().page_subtree(id).iter().filter(|p| p.as_str() != id).count()
    }

    pub(crate) fn trash_page(&mut self, a: &Value) -> Res {
        let id = self.page_by_title(&arg(a, "page_title"))?;
        let (title, sub) = (self.page_json(&id)["title"].clone(), self.subpages(&id));
        self.ev("pageTrash", json!({ "id": id }))?;
        Ok(json!({
            "ok": true, "title": title, "trashed": true, "subpages": sub,
            "note": "Im Papierkorb — wiederherstellbar. Endgültiges Löschen nur manuell im Papierkorb.",
        }))
    }

    pub(crate) fn archive_page(&mut self, a: &Value, archive: bool) -> Res {
        let wanted = arg(a, "page_title");
        let mut id = self.page_id(&wanted);
        if id.is_none() && !archive {
            let q = lower(wanted.trim());
            let state = self.host.model().state();
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
        let pg = self.host.model().state().pages.get(&id).cloned().unwrap_or_default();
        let (kind, sub) = (if pg.is_heft() { "heft" } else { "page" }, self.subpages(&id));
        self.ev(if archive { "pageArchive" } else { "pageUnarchive" }, json!({ "id": id }))?;
        Ok(if archive {
            json!({ "ok": true, "title": pg.title(), "archived": true, "kind": kind, "subpages": sub,
                "note": "Archiviert — in der Bibliothek (Archiv-Reiter) wiederherstellbar." })
        } else {
            json!({ "ok": true, "title": pg.title(), "archived": false, "kind": kind, "note": "Aus dem Archiv wiederhergestellt." })
        })
    }

    pub(crate) fn create_card(
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
        let id = self.host.new_id();
        self.ev("cardCreate", json!({ "id": id, "front": front, "back": back, "pageId": page_id, "deck": deck }))
    }

    /// Seite der Karte: genannter Titel, sonst die geöffnete.
    pub(crate) fn card_page(&self, a: &Value) -> Option<String> {
        let title = arg(a, "page_title");
        if title.is_empty() { self.ctx.active_page.as_deref().map(str::to_owned) } else { self.page_id(&title) }
    }

    pub(crate) fn create_flashcard(&mut self, a: &Value) -> Res {
        if arg(a, "front").trim().is_empty() || arg(a, "back").trim().is_empty() {
            return fail("create_flashcard: front und back dürfen nicht leer sein.");
        }
        let page = self.card_page(a);
        let deck = arg(a, "deck");
        self.create_card(&arg(a, "front"), &arg(a, "back"), page.as_deref(), Some(&deck))?;
        Ok(json!({ "ok": true, "front": arg(a, "front"), "deck": if deck.is_empty() { "Standard" } else { &deck } }))
    }

    pub(crate) fn create_flashcards(&mut self, a: &Value) -> Res {
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

    pub(crate) fn delete_flashcards(&mut self, a: &Value) -> Res {
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

    pub(crate) fn move_flashcards(&mut self, a: &Value) -> Res {
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

    pub(crate) fn update_flashcard(&mut self, a: &Value) -> Res {
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

    pub(crate) fn suspend_flashcards(&mut self, a: &Value) -> Res {
        let Some(flag) = a.get("suspended").and_then(Value::as_bool) else {
            return fail("suspend_flashcards: suspended (true/false) fehlt.");
        };
        let sel = self.select_cards(a, 200, false)?;
        if sel.ids.is_empty() {
            return fail("Keine passenden Karten gefunden.");
        }
        let mut changed = 0;
        for id in &sel.ids {
            if self.host.model().state().cards.get(id).is_some_and(|c| c.is_suspended() == flag) {
                continue;
            }
            self.ev("cardUpdate", json!({ "id": id, "patch": { "suspended": flag } }))?;
            changed += 1;
        }
        Ok(json!({ "ok": true, "suspended": flag, "changed": changed, "unchanged": sel.ids.len() - changed }))
    }

    pub(crate) fn reset_card_progress(&mut self, a: &Value) -> Res {
        let sel = self.select_cards(a, 200, false)?;
        if sel.ids.is_empty() {
            return fail("Keine passenden Karten gefunden.");
        }
        let fresh = ser(&Srs::new(Timestamp::from_millis(self.ctx.now_ms)));
        for id in &sel.ids {
            self.ev("cardUpdate", json!({ "id": id, "patch": { "srs": fresh, "leech": false, "suspended": false } }))?;
        }
        Ok(json!({
            "ok": true, "reset": sel.ids.len(),
            "note": "Die Karten stehen wieder als „neu“ in der Warteschlange. Das Wiederholungs-Protokoll (Statistik/Heatmap) bleibt erhalten.",
        }))
    }

    pub(crate) fn create_deck(&mut self, a: &Value) -> Res {
        let name = targ(a, "name");
        if name.is_empty() {
            return fail("create_deck: name fehlt.");
        }
        let existed = self.host.model().state().decks.iter().any(|(n, d)| lower(n) == lower(&name) && !d.is_trashed());
        let deck = self.ensure_deck(&name)?;
        Ok(
            json!({ "ok": true, "deck": deck, "note": if existed { "Stapel gab es bereits — unverändert." } else { "Neu angelegt." } }),
        )
    }

    pub(crate) fn rename_deck(&mut self, a: &Value) -> Res {
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

    pub(crate) fn move_deck(&mut self, a: &Value) -> Res {
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

    pub(crate) fn delete_deck(&mut self, a: &Value) -> Res {
        let deck = self.resolve_deck(&arg(a, "deck"))?;
        let n = self.cards_of_deck(&deck);
        self.ev("deckTrash", json!({ "name": deck }))?;
        Ok(
            json!({ "ok": true, "deck": deck, "trashed": true, "cards": n, "note": "Im Papierkorb — wiederherstellbar." }),
        )
    }

    /// Ein einzelnes (internes) Werkzeug; die Namen entsprechen `run` in `web/tools.js`.
    pub(crate) fn run(&mut self, name: &str, a: &Value) -> Res {
        match name {
            "inspect" => self.inspect(a),
            "create_page" => self.create_page(a),
            "append_to_page" => self.append_to_page(a),
            "write_to_heft" => self.write_to_heft(a),
            "replace_page_content" => self.replace_page_content(a),
            "patch_page" => self.patch_page(a),
            "set_page_props" => self.set_page_props(a),
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
}
