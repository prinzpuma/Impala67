//! Vergleich mit `web/fach.js` (erzeugt von `core/tools/gen-golden-fach.mjs`).

use std::collections::HashMap;

use impala_fach::{
    PageFacts, Pages, Subject, card_subject, clean, deck_subject, known_subjects, page_subject, resolve_subject,
};
use serde_json::Value;

fn golden() -> Value {
    serde_json::from_str(include_str!("golden/fach.json")).unwrap()
}

/// `String(x)` für einfache Werte.
fn js_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => "null".into(),
        other => other.to_string(),
    }
}

fn facts(v: &Value) -> PageFacts {
    let text = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_owned();
    PageFacts {
        id: text("id"),
        title: text("title"),
        content: text("content"),
        subject: v.get("subject").filter(|s| !s.is_null()).map(js_string),
        tags: v.get("tags").and_then(Value::as_array).map(|a| a.iter().map(js_string).collect()).unwrap_or_default(),
        parent: v.get("parentId").and_then(Value::as_str).map(str::to_owned),
        workspace: text("workspaceId"),
        trashed: v.get("trashed").and_then(Value::as_bool).unwrap_or(false),
    }
}

struct Model {
    pages: Vec<PageFacts>,
    workspaces: HashMap<String, String>,
}

impl Pages for Model {
    fn page(&self, id: &str) -> Option<PageFacts> {
        self.pages.iter().find(|p| p.id == id).cloned()
    }
    fn children(&self, id: &str) -> Vec<PageFacts> {
        self.pages.iter().filter(|p| p.parent.as_deref().unwrap_or("") == id).cloned().collect()
    }
    fn workspace_name(&self, id: &str) -> Option<String> {
        self.workspaces.get(id).cloned()
    }
}

fn model(g: &Value) -> Model {
    Model {
        pages: g["pages"].as_array().unwrap().iter().map(facts).collect(),
        workspaces: g["workspaces"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, w)| (k.clone(), w["name"].as_str().unwrap().to_owned()))
            .collect(),
    }
}

fn same(got: Subject, want: &Value, what: &str) {
    assert_eq!(
        (got.name, got.source.as_str()),
        (want["name"].as_str().unwrap(), want["source"].as_str().unwrap()),
        "{what}"
    );
}

#[test]
fn katalog_wie_pwa() {
    let g = golden();
    let want: Vec<&str> = g["known"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
    assert_eq!(known_subjects(), want);
}

#[test]
fn texte_wie_pwa() {
    let g = golden();
    for case in g["resolve"].as_array().unwrap() {
        let text = case[0].as_str().unwrap();
        assert_eq!(resolve_subject(text), case[1].as_str(), "resolveSubject({text:?})");
    }
    for case in g["clean"].as_array().unwrap() {
        assert_eq!(clean(case[0].as_str().unwrap()), case[1].as_str().unwrap(), "clean({})", case[0]);
    }
}

#[test]
fn stapel_wie_pwa() {
    let g = golden();
    for case in g["decks"].as_array().unwrap() {
        same(deck_subject(case[0].as_str().unwrap()), &case[1], &format!("deck {}", case[0]));
    }
}

#[test]
fn seiten_wie_pwa() {
    let g = golden();
    let m = model(&g);
    for p in &m.pages {
        same(page_subject(&m, p), &g["results"][&p.id], &format!("Seite {}", p.id));
    }
}

#[test]
fn karten_wie_pwa() {
    let g = golden();
    let m = model(&g);
    for case in g["cards"].as_array().unwrap() {
        let deck = case[0]["deck"].as_str().unwrap();
        let page = case[0].get("pageId").and_then(Value::as_str);
        same(card_subject(&m, deck, page), &case[1], &format!("Karte {}", case[0]));
    }
}
