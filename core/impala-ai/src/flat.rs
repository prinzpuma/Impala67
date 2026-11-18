//! Flache Werkzeuge (`tool_defs_flat.json`): ein Werkzeug je Aufgabe mit flachen Feldern.
//! Ausgeführt werden sie intern als `inspect`/`change` – so gelten Bestätigung, Rückgängig und
//! Prüfungen unverändert, und App-KI und MCP teilen dieselbe Ausführung.

use std::sync::LazyLock;

use serde_json::{Map, Value, json};

use crate::message::ToolDef;

pub fn flat_tools() -> &'static [ToolDef] {
    static DEFS: LazyLock<Vec<ToolDef>> = LazyLock::new(|| {
        let list: Value = serde_json::from_str(include_str!("tool_defs_flat.json")).unwrap_or(Value::Null);
        list.as_array().map(|a| a.iter().filter_map(ToolDef::from_json).collect()).unwrap_or_default()
    });
    &DEFS
}

/// Übersetzt einen flachen Aufruf in `("inspect" | "change", args)`. `None`: kein flaches
/// Werkzeug (unverändert ausführen). `Some(Err)`: Aufruf unvollständig, Text fürs Modell.
pub fn flat_call(name: &str, a: &Value) -> Option<Result<(&'static str, Value), String>> {
    let s = |k: &str| a.get(k).filter(|v| !v.is_null()).cloned();
    let pick = |keys: &[&str]| -> Map<String, Value> {
        keys.iter().filter_map(|k| s(k).map(|v| ((*k).to_owned(), v))).collect()
    };
    let inspect = |kind: &str, keys: &[&str]| {
        let mut m = pick(keys);
        m.insert("kind".into(), Value::from(kind));
        Ok(("inspect", Value::Object(m)))
    };
    let change = |ops: Vec<Value>| -> Result<(&'static str, Value), String> {
        if ops.is_empty() {
            return Err(format!("{name}: nichts zu tun – Pflichtfelder laut Beschreibung angeben."));
        }
        Ok(("change", json!({ "operations": ops })))
    };
    let op = |kind: &str, mut m: Map<String, Value>| {
        m.insert("op".into(), Value::from(kind));
        Value::Object(m)
    };
    Some(match name {
        "search" => inspect("search", &["query", "semantic"]),
        "read_pages" => {
            let Some(Value::Array(titles)) = s("titles") else {
                return Some(Err("read_pages: titles muss eine Liste exakter Titel sein.".into()));
            };
            if titles.is_empty() {
                return Some(Err("read_pages: titles darf nicht leer sein.".into()));
            }
            Ok(("inspect", json!({ "kind": "page", "titles": titles })))
        }
        "list_pages" if a.get("archived").and_then(Value::as_bool) == Some(true) => inspect("archived", &[]),
        "list_pages" => inspect("pages", &["query"]),
        "get_context" => inspect("context", &[]),
        "list_cards" if a.get("due").and_then(Value::as_bool) == Some(true) => inspect("due", &[]),
        "list_cards" => inspect("cards", &["deck", "query", "limit"]),
        "list_decks" => inspect("decks", &[]),
        "search_chats" => inspect("chats", &["query", "limit"]),
        "create_pages" => {
            let Some(Value::Array(pages)) = s("pages") else {
                return Some(Err("create_pages: pages muss eine Liste von Seiten-Objekten sein.".into()));
            };
            let ops = pages
                .into_iter()
                .filter_map(|p| p.as_object().cloned())
                .map(|p| {
                    let keep: Map<String, Value> = ["title", "content", "parent", "props"]
                        .iter()
                        .filter_map(|k| p.get(*k).filter(|v| !v.is_null()).map(|v| ((*k).to_owned(), v.clone())))
                        .collect();
                    op("page.create", keep)
                })
                .collect();
            change(ops)
        }
        "edit_page" => {
            let Some(title) = s("title") else { return Some(Err("edit_page: title fehlt.".into())) };
            let with = |extra: &[(&str, Value)]| {
                let mut m = Map::new();
                m.insert("title".into(), title.clone());
                for (k, v) in extra {
                    m.insert((*k).into(), v.clone());
                }
                m
            };
            let mut ops = vec![];
            for e in s("edits").and_then(|v| v.as_array().cloned()).unwrap_or_default() {
                let search = e.get("search").cloned().unwrap_or(Value::Null);
                let replace = e.get("replace").cloned().unwrap_or(Value::from(""));
                ops.push(op("page.patch", with(&[("search", search), ("replace", replace)])));
            }
            if let Some(text) = s("append") {
                ops.push(op("page.append", with(&[("content", text)])));
            }
            if let Some(content) = s("content") {
                let allow = s("allow_deleting_content").unwrap_or(Value::Bool(false));
                ops.push(op("page.replace", with(&[("content", content), ("allow_deleting_content", allow)])));
            }
            if let Some(props) = s("props") {
                ops.push(op("page.props", with(&[("props", props)])));
            }
            if let Some(parent) = s("move_to") {
                ops.push(op("page.move", with(&[("parent", parent)])));
            }
            // Umbenennen zuletzt: alle vorigen Schritte finden die Seite noch unter dem alten Titel.
            if let Some(to) = s("rename") {
                ops.push(op("page.rename", with(&[("to", to)])));
            }
            change(ops)
        }
        "organize_pages" => {
            let action = a.get("action").and_then(Value::as_str).unwrap_or("");
            if !matches!(action, "trash" | "archive" | "unarchive") {
                return Some(Err("organize_pages: action muss trash, archive oder unarchive sein.".into()));
            }
            let Some(Value::Array(titles)) = s("titles") else {
                return Some(Err("organize_pages: titles muss eine Liste von Titeln sein.".into()));
            };
            let kind = format!("page.{action}");
            change(titles.into_iter().map(|t| op(&kind, Map::from_iter([("title".into(), t)]))).collect())
        }
        "write_to_heft" => change(vec![op("heft.append", pick(&["title", "text", "page"]))]),
        "create_cards" => {
            let mut m = pick(&["deck", "cards"]);
            if let Some(p) = s("page") {
                m.insert("title".into(), p);
            }
            change(vec![op("card.create", m)])
        }
        "edit_cards" => {
            let mut m = pick(&["front", "fronts", "deck", "query", "new_front", "new_back", "to", "limit"]);
            let kind = match a.get("action").and_then(Value::as_str).unwrap_or("") {
                "update" => "card.update",
                "move" => "card.move",
                "trash" => "card.trash",
                "reset" => "card.reset",
                "suspend" | "unsuspend" => {
                    let on = a.get("action").and_then(Value::as_str) == Some("suspend");
                    m.insert("suspended".into(), Value::Bool(on));
                    "card.suspend"
                }
                _ => return Some(Err("edit_cards: action muss update, move, trash, suspend, unsuspend oder reset sein.".into())),
            };
            change(vec![op(kind, m)])
        }
        "edit_deck" => {
            let action = a.get("action").and_then(Value::as_str).unwrap_or("");
            if !matches!(action, "create" | "rename" | "move" | "trash") {
                return Some(Err("edit_deck: action muss create, rename, move oder trash sein.".into()));
            }
            change(vec![op(&format!("deck.{action}"), pick(&["deck", "to"]))])
        }
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn definitionen_laden() {
        let names: Vec<&str> = flat_tools().iter().map(|t| t.name.as_str()).collect();
        assert!(names.contains(&"edit_page") && names.contains(&"read_pages") && names.len() >= 15, "{names:?}");
    }

    #[test]
    fn lesen_wird_inspect() {
        let (t, a) = flat_call("read_pages", &json!({ "titles": ["A"] })).unwrap().unwrap();
        assert_eq!((t, a), ("inspect", json!({ "kind": "page", "titles": ["A"] })));
        assert!(flat_call("read_pages", &json!({ "titles": "A" })).unwrap().is_err());
        let (_, a) = flat_call("list_cards", &json!({ "due": true })).unwrap().unwrap();
        assert_eq!(a, json!({ "kind": "due" }));
        assert!(flat_call("inspect", &json!({})).is_none());
    }

    #[test]
    fn edit_page_in_reihenfolge() {
        let (t, a) = flat_call(
            "edit_page",
            &json!({ "title": "F", "rename": "G", "edits": [{ "search": "a", "replace": "b" }], "props": { "Nr": 1 } }),
        )
        .unwrap()
        .unwrap();
        assert_eq!(t, "change");
        let ops: Vec<&str> = a["operations"].as_array().unwrap().iter().map(|o| o["op"].as_str().unwrap()).collect();
        assert_eq!(ops, ["page.patch", "page.props", "page.rename"]);
        assert_eq!(a["operations"][0]["search"], "a");
        assert!(flat_call("edit_page", &json!({ "title": "F" })).unwrap().is_err());
    }

    #[test]
    fn karten_und_seiten() {
        let (_, a) = flat_call("create_cards", &json!({ "deck": "E::L", "cards": [{ "front": "f", "back": "b" }], "page": "P" }))
            .unwrap()
            .unwrap();
        assert_eq!(a["operations"][0], json!({ "op": "card.create", "deck": "E::L", "cards": [{ "front": "f", "back": "b" }], "title": "P" }));
        let (_, a) = flat_call("edit_cards", &json!({ "action": "unsuspend", "deck": "E" })).unwrap().unwrap();
        assert_eq!(a["operations"][0]["suspended"], false);
        let (_, a) = flat_call("create_pages", &json!({ "pages": [{ "title": "A", "parent": "V", "props": { "Nr": 4 } }, { "title": "B" }] }))
            .unwrap()
            .unwrap();
        assert_eq!(a["operations"].as_array().unwrap().len(), 2);
        assert_eq!(a["operations"][0]["props"]["Nr"], 4);
    }
}
