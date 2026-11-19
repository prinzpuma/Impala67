//! `change`: Operationen prüfen (Trockenlauf), auf Einzel-Werkzeuge abbilden und atomar ausführen.

use std::collections::BTreeSet;

use serde_json::{Value, json};

use crate::undo::Snapshot;
use crate::{Tools, str_of, truthy};

impl Tools<'_> {
    // ---- change

    /// Trockenlauf aller Seiten-Operationen gegen den aktuellen Stand (wie `dryRunCheck` in
    /// `web/tools.js`); Seiten aus früheren Operationen nur gedacht. `Some(Fehlertext)` bei Problemen.
    pub(crate) fn dry_check(&self, operations: &[Value]) -> Option<String> {
        struct Virt {
            id: String,
            is_new: bool,
            title: String,
            content: String,
            parent: Option<impala_model::Page>,
            props: Value,
            heft: bool,
            db: Option<Value>,
            workspace: String,
        }
        let default_ws = self.workspace_for(None);
        let state = self.host.model().state();
        let key = |t: &str| t.trim().to_lowercase();
        let mut virt: Vec<(String, Virt)> = vec![];
        let mut created: BTreeSet<(String, String)> = BTreeSet::new();
        let mut trashed: BTreeSet<String> = BTreeSet::new();
        let lookup = |virt: &mut Vec<(String, Virt)>, t: &str| -> Option<usize> {
            if let Some(i) = virt.iter().position(|(k, _)| *k == key(t)) {
                return Some(i);
            }
            let pg = state.find_page(t, true)?;
            let parent = pg.parent().and_then(|p| state.pages.get(p)).cloned();
            virt.push((
                key(t),
                Virt {
                    id: pg.id().to_owned(),
                    is_new: false,
                    title: pg.title().to_owned(),
                    content: pg.content().to_owned(),
                    parent,
                    props: pg.get("props").unwrap_or(Value::Null),
                    heft: pg.is_heft(),
                    db: pg.get("db"),
                    workspace: pg.workspace().to_owned(),
                },
            ));
            Some(virt.len() - 1)
        };
        // Ordner als (id, is_new, Seite, workspace) – auch gedachte aus früheren Operationen.
        let folder = |virt: &Vec<(String, Virt)>, t: &str| -> Option<(String, bool, impala_model::Page, String)> {
            if let Some((_, v)) = virt.iter().find(|(k, _)| *k == key(t)) {
                if !v.is_new
                    && let Some(pg) = state.pages.get(&v.id)
                {
                    return Some((v.id.clone(), false, pg.clone(), v.workspace.clone()));
                }
                let mut p = json!({ "title": v.title, "workspaceId": v.workspace });
                if let Some(db) = &v.db {
                    p["db"] = db.clone();
                }
                return serde_json::from_value(p).ok().map(|pg| (v.id.clone(), v.is_new, pg, v.workspace.clone()));
            }
            state.find_page(t, true).map(|pg| (pg.id().to_owned(), false, pg.clone(), pg.workspace().to_owned()))
        };
        for (i, op) in operations.iter().enumerate() {
            let name = op.get("op").map(str_of).unwrap_or_default();
            let fail = |m: String| {
                Some(format!(
                    "Operation {} ({name}) fehlgeschlagen: {}. Keine Änderungen ausgeführt.",
                    i + 1,
                    m.trim_end_matches('.')
                ))
            };
            let title = op.get("title").map(str_of).unwrap_or_default();
            let text = first(op, &["content", "text"]);
            if name == "page.create" {
                let parent_t = op.get("parent").filter(|v| truthy(v)).map(str_of);
                let parent_info = match &parent_t {
                    Some(t) => match folder(&virt, t) {
                        Some(info) => Some(info),
                        None => return fail(format!("Elternseite nicht gefunden: {t}")),
                    },
                    None => None,
                };
                let (parent_id, parent_is_new, parent, ws) = match parent_info {
                    Some((id, is_new, pg, ws)) => (Some(id), is_new, Some(pg), ws),
                    None => (None, false, None, default_ws.clone()),
                };
                let slot = (parent_id.unwrap_or_else(|| format!("root:{ws}")), key(&title));
                if !created.insert(slot) {
                    return fail(match &parent {
                        Some(p) => format!(
                            "Seite „{}“ existiert bereits in „{}“ — zum Bearbeiten edit_page nutzen.",
                            title.trim(),
                            if parent_is_new { p.title().to_owned() } else { state.page_label(p) }
                        ),
                        None => {
                            format!("Seite „{}“ existiert bereits — zum Bearbeiten edit_page nutzen.", title.trim())
                        }
                    });
                }
                if !parent_is_new
                    && let Some(dup) = self.duplicate_sibling_error(&title, parent.as_ref(), &ws, &trashed)
                {
                    return fail(dup);
                }
                let mut props = Value::Null;
                if let Some(update) = op.get("props").filter(|v| !v.is_null()) {
                    match self.merge_props(parent.as_ref(), &Value::Null, update, &title) {
                        Ok(p) => props = p,
                        Err(e) => return fail(e),
                    }
                }
                virt.push((
                    key(&title),
                    Virt {
                        id: format!("__new_{i}"),
                        is_new: true,
                        title: title.trim().to_owned(),
                        content: str_of(&text),
                        parent,
                        props,
                        heft: op.get("heft").is_some_and(truthy),
                        db: None,
                        workspace: ws,
                    },
                ));
                continue;
            }
            if !name.starts_with("page.") && name != "heft.append" {
                continue;
            }
            let Some(at) = lookup(&mut virt, &title) else { return fail(format!("Seite nicht gefunden: {title}")) };
            match name.as_str() {
                "page.patch" => {
                    let v = &mut virt[at].1;
                    if v.heft {
                        return fail(
                            "Heft-Inhalte können nicht gepatcht werden — write_to_heft fügt sichtbaren Text hinzu"
                                .into(),
                        );
                    }
                    let search = op.get("search").map(str_of).unwrap_or_default();
                    let replace = str_of(&first(op, &["replace", "content"]));
                    match impala_ai::edit::patch(&v.content, &search, &replace) {
                        Ok(c) => v.content = c,
                        Err(e) => return fail(e),
                    }
                }
                "page.replace" => {
                    let v = &mut virt[at].1;
                    if v.heft {
                        return fail("Heft-Inhalte können nicht ersetzt werden".into());
                    }
                    let new = str_of(&text);
                    if op.get("allow_deleting_content") != Some(&Value::Bool(true))
                        && let Some(g) = impala_ai::edit::replace_guard(&v.content, &new)
                    {
                        return fail(g);
                    }
                    v.content = new;
                }
                "page.append" => {
                    let v = &mut virt[at].1;
                    v.content = format!("{}\n\n{}", v.content, str_of(&text));
                }
                "page.props" => {
                    let v = &virt[at].1;
                    match self.merge_props(
                        v.parent.as_ref(),
                        &v.props,
                        op.get("props").unwrap_or(&Value::Null),
                        &v.title,
                    ) {
                        Ok(p) => virt[at].1.props = p,
                        Err(e) => return fail(e),
                    }
                }
                "page.move" => {
                    let to = str_of(&first(op, &["parent", "to"]));
                    if !to.is_empty() && folder(&virt, &to).is_none() {
                        return fail(format!("Elternseite nicht gefunden: {to}"));
                    }
                }
                "page.rename" => {
                    let to = op.get("to").map(str_of).unwrap_or_default();
                    virt[at].0 = key(&to);
                }
                "page.trash" => {
                    let v = &virt[at].1;
                    if !v.is_new {
                        trashed.insert(v.id.clone());
                    }
                }
                _ => {}
            }
        }
        None
    }

    pub(crate) fn change(&mut self, a: &Value) -> (Value, Option<Value>) {
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
        // Erst alles prüfen (Seiten, Suchtext, Löschschutz, Spalten), dann schreiben.
        if let Some(e) = self.dry_check(&operations) {
            return (json!({ "error": e }), None);
        }
        if a.get("dry_run") == Some(&Value::Bool(true)) {
            let results: Vec<Value> = operations
                .iter()
                .map(|o| {
                    let mut r = json!({ "op": o.get("op"), "ok": true });
                    if let Some(t) = o.get("title").filter(|t| truthy(t)) {
                        r["title"] = t.clone();
                    }
                    r
                })
                .collect();
            return (json!({ "ok": true, "dryRun": true, "operations": operations.len(), "results": results }), None);
        }
        let before = Snapshot::take(&operations, self);
        let mut results = vec![];
        for (i, op) in operations.iter().enumerate() {
            let Some((tool, args)) = op_to_tool(op) else { continue };
            let result = self.run(tool, &args).unwrap_or_else(|e| json!({ "error": e }));
            if let Some(e) = result.get("error").filter(|e| truthy(e)) {
                let name = op.get("op").map(str_of).unwrap_or_default();
                let set = before.undo_set(self.host.model());
                if let Err(undo_err) = crate::undo::apply(&mut *self.host, &set) {
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
        let changes = before.undo_set(self.host.model());
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
                "braucht title und content"
            }
        }
        "page.patch" => {
            if has_text(op, &["title"])
                && has_text(op, &["search"])
                && (has_field(op, "replace") || has_field(op, "content"))
            {
                return None;
            }
            "braucht title, search (exakter Text, der schon in der Seite steht) und replace (neuer Text)"
        }
        "page.rename" => {
            if has_text(op, &["title"]) && has_text(op, &["to"]) {
                return None;
            } else {
                "braucht title und to (neuer Name)"
            }
        }
        "page.move" | "page.trash" | "page.archive" | "page.unarchive" => {
            return (!has_text(op, &["title"])).then_some("title fehlt");
        }
        "page.props" => {
            if has_text(op, &["title"]) && op.get("props").is_some_and(Value::is_object) {
                return None;
            }
            "braucht title und props ({Spalte: Wert})"
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
                None if !has_text(op, &["front"]) => Some(
                    r#"cards fehlt – die Karten selbst gehören in den Aufruf: "cards": [{"front": "Frage", "back": "Antwort"}, …] (limit gibt es bei card.create nicht)"#,
                ),
                None if !has_field(op, "back") => Some("back fehlt"),
                Some(cards) if cards.is_empty() => {
                    Some(r#"cards ist leer – mindestens eine Karte {"front": …, "back": …} angeben"#)
                }
                Some(cards) if !cards.iter().all(|c| has_text(c, &["front"]) && has_field(c, "back")) => {
                    Some("jede Karte in cards braucht front und back")
                }
                _ if !has_text(op, &["deck"]) => Some("deck fehlt (Stapelname, z. B. der Name aus deck.create)"),
                _ => None,
            };
        }
        "card.update" => {
            if has_text(op, &["front", "query"])
                && ["new_front", "new_back", "back", "to"].iter().any(|k| has_field(op, k))
            {
                return None;
            } else {
                "braucht front (bisherige Vorderseite) und new_front, new_back oder to"
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
        "deck.create" => return (!has_text(op, &["deck", "title"])).then_some("braucht deck (Stapelname)"),
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
            json!({ "title": o["title"], "parent_title": o["parent"], "content": first(o, &["content", "text"]).as_str().unwrap_or(""), "props": o["props"], "heft": o["heft"] }),
        ),
        "page.append" => {
            ("append_to_page", json!({ "page_title": o["title"], "content": first(o, &["content", "text"]) }))
        }
        "page.replace" => (
            "replace_page_content",
            json!({ "page_title": o["title"], "content": first(o, &["content", "text"]), "allow_deleting_content": o["allow_deleting_content"] }),
        ),
        "page.props" => ("set_page_props", json!({ "page_title": o["title"], "props": o["props"] })),
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
