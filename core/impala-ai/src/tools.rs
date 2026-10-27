//! Werkzeuge der KI als Daten: Definitionen (aus `web/tools.js`), Freischalt-Werkzeug,
//! Prüfung von Rückfragen und Bestätigungen sowie die Kurzbeschreibung für die Chips.

use std::sync::LazyLock;

use serde_json::{Value, json};

use crate::js;
use crate::message::ToolDef;

/// Werkzeuge der App (OpenAI-Function-Calling). Ausgeführt werden sie über [`crate::ToolExecutor`].
pub fn builtin_tools() -> &'static [ToolDef] {
    static DEFS: LazyLock<Vec<ToolDef>> = LazyLock::new(|| {
        let list: Value = serde_json::from_str(include_str!("tool_defs.json")).unwrap_or(Value::Null);
        list.as_array().map(|a| a.iter().filter_map(ToolDef::from_json).collect()).unwrap_or_default()
    });
    &DEFS
}

pub const REQUEST_TOOLS: &str = "request_tools";

/// Einziges Werkzeug, wenn „Tools mitsenden“ aus ist: schaltet die volle Liste frei.
pub fn request_tools_def() -> ToolDef {
    ToolDef {
        name: REQUEST_TOOLS.into(),
        description: "Schaltet die vollständige Werkzeugliste frei (Notizen lesen/erstellen/ändern, Suche, Karteikarten, NotebookLM …). Rufe dieses Werkzeug auf, sobald die Anfrage Zugriff auf Notizen, Karten, Hefte oder Aktionen im Workspace erfordern könnte.".into(),
        parameters: json!({ "type": "object", "properties": {}, "required": [] }),
    }
}

/// Bereinigte Rückfrage für `ask_choice`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Choice {
    pub question: String,
    pub options: Vec<String>,
}

/// Leere/doppelte Optionen raus, höchstens 5, mindestens 2, Frage Pflicht.
pub fn normalize_ask_choice(args: &Value) -> Result<Choice, String> {
    let question =
        js::trim(&args.get("question").filter(|v| js::truthy(v)).map(js::string).unwrap_or_default()).to_owned();
    let mut options: Vec<String> = Vec::new();
    for o in args.get("options").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default() {
        let s = js::trim(&if o.is_null() { String::new() } else { js::string(o) }).to_owned();
        if s.is_empty() || options.iter().any(|x| x.to_lowercase() == s.to_lowercase()) {
            continue;
        }
        options.push(s);
        if options.len() >= 5 {
            break;
        }
    }
    if question.is_empty() {
        return Err("ask_choice: Frage fehlt.".into());
    }
    if options.len() < 2 {
        return Err("ask_choice: mindestens 2 kurze Optionen nötig (max. 5).".into());
    }
    Ok(Choice { question, options })
}

/// Rückfrage vor löschenden/zurücksetzenden Operationen in `change`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Confirmation {
    pub question: String,
    /// Chip-Text nach der Ausführung.
    pub detail: String,
    pub operations: usize,
}

pub const CONFIRM_OPTIONS: [&str; 2] = ["Ja, ausführen", "Abbrechen"];

fn operations(args: &Value) -> &[Value] {
    args.get("operations").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default()
}

/// `None`: ohne Rückfrage ausführen.
pub fn change_confirmation(args: &Value) -> Option<Confirmation> {
    let ops = operations(args);
    let risky: Vec<&Value> = ops
        .iter()
        .filter(|op| {
            let kind = js::first_truthy([op.get("op")]);
            kind.ends_with(".trash") || kind.ends_with(".reset")
        })
        .collect();
    if risky.is_empty() {
        return None;
    }
    let labels: Vec<String> = risky
        .iter()
        .take(4)
        .map(|op| js::first_truthy([op.get("title"), op.get("deck"), op.get("front"), op.get("op")]))
        .filter(|s| !s.is_empty())
        .collect();
    Some(Confirmation {
        question: format!(
            "{} löschende/zurücksetzende Operation(en) ausführen{}? Die gesamte KI-Aktion bleibt rückgängig machbar.",
            risky.len(),
            if labels.is_empty() { String::new() } else { format!(": {}", labels.join(" · ")) }
        ),
        detail: format!("{} Änderungen", ops.len()),
        operations: ops.len(),
    })
}

/// Ergebnis, wenn der Nutzer die Bestätigung ablehnt.
pub fn cancelled_result(operations: usize) -> String {
    js::object(&[
        ("cancelled", Value::Bool(true)),
        ("operations", Value::from(operations)),
        ("note", Value::from("Aktion abgebrochen — nichts geändert.")),
    ])
}

/// Kurzbeschreibung eines Werkzeugaufrufs für den Chip im Chat.
pub fn tool_detail(name: &str, args: &Value, embed_model: &str) -> String {
    let get = |k: &str| args.get(k);
    match name {
        "change" => return format!("{} Operation(en)", operations(args).len()),
        "inspect" => {
            let kind = get("kind").map(js::string).unwrap_or_else(|| "undefined".into());
            let query = js::first_truthy([get("query")]);
            return if query.is_empty() { kind } else { format!("{kind} · {query}") };
        }
        _ => {}
    }
    let fronts = get("fronts").and_then(Value::as_array).filter(|f| !f.is_empty()).map(|f| {
        let head: Vec<String> =
            f.iter().take(2).map(|x| if x.is_null() { String::new() } else { js::string(x) }).collect();
        let more = if f.len() > 2 { format!(" +{}", f.len() - 2) } else { String::new() };
        Value::from(head.join(" · ") + &more)
    });
    let to_deck = get("to_deck").filter(|v| js::truthy(v)).map(|v| Value::from(format!("→ {}", js::string(v))));
    let mut detail = js::first_truthy([
        get("page_title"),
        get("title"),
        get("query"),
        get("front"),
        fronts.as_ref(),
        to_deck.as_ref(),
        get("new_name"),
        get("deck"),
        get("from_deck"),
        get("name"),
    ]);
    if name == "semantic_search" {
        if !detail.is_empty() {
            detail.push_str(" · ");
        }
        detail.push_str("Embedding: ");
        detail.push_str(if embed_model.is_empty() { "—" } else { embed_model });
    }
    detail
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rueckfrage() {
        let c = normalize_ask_choice(&json!({ "question": " Welche? ", "options": ["A", "a", " ", "B"] })).unwrap();
        assert_eq!(c.options, vec!["A", "B"]);
        assert!(normalize_ask_choice(&json!({ "question": "x", "options": ["A"] })).is_err());
    }

    #[test]
    fn bestaetigung() {
        let args = json!({ "operations": [{ "op": "page.trash", "title": "Alt" }, { "op": "page.create" }] });
        let c = change_confirmation(&args).unwrap();
        assert!(c.question.starts_with("1 löschende/zurücksetzende Operation(en) ausführen: Alt?"));
        assert_eq!(c.detail, "2 Änderungen");
        assert!(change_confirmation(&json!({ "operations": [{ "op": "page.create" }] })).is_none());
    }

    #[test]
    fn chips() {
        assert_eq!(tool_detail("inspect", &json!({ "kind": "pages", "query": "x" }), ""), "pages · x");
        assert_eq!(tool_detail("x", &json!({ "fronts": ["a", "b", "c"] }), ""), "a · b +1");
        assert_eq!(tool_detail("semantic_search", &json!({}), ""), "Embedding: —");
    }
}
