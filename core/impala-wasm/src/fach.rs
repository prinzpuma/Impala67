//! WASM-Anbindung für `impala-fach`: Fach-Erkennung für Seiten, Stapel und Karten in der PWA.

use impala_fach::{PageFacts, Pages};
use impala_model::State;
use impala_model::types::Page;
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

use crate::js::to_js;
use crate::model::ModelCore;

fn subject_js(s: impala_fach::Subject) -> JsValue {
    to_js(&json!({ "name": s.name, "source": s.source.as_str() }))
}

fn truthy_text(v: Option<&Value>) -> Option<String> {
    match v? {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Number(n) if n.as_f64() != Some(0.0) => Some(n.to_string()),
        Value::Bool(true) => Some("true".into()),
        _ => None,
    }
}

fn js_text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => "null".into(),
        Value::Array(_) | Value::Object(_) => "[object Object]".into(),
        other => other.to_string(),
    }
}

fn facts(p: &Page) -> PageFacts {
    PageFacts {
        id: p.id().to_owned(),
        title: p.title().to_owned(),
        content: p.content().to_owned(),
        subject: truthy_text(p.extra.get("subject")),
        tags: p
            .extra
            .get("tags")
            .and_then(Value::as_array)
            .map(|a| a.iter().map(js_text).collect())
            .unwrap_or_default(),
        parent: p.parent().map(str::to_owned),
        workspace: p.workspace().to_owned(),
        trashed: p.is_trashed(),
    }
}

struct ModelPages<'a>(&'a State);

impl Pages for ModelPages<'_> {
    fn page(&self, id: &str) -> Option<PageFacts> {
        self.0.pages.get(id).map(facts)
    }
    fn children(&self, id: &str) -> Vec<PageFacts> {
        self.0.child_pages_of(Some(id)).into_iter().map(facts).collect()
    }
    fn workspace_name(&self, id: &str) -> Option<String> {
        self.0.workspaces.get(id).and_then(|w| w.name.clone())
    }
}

#[wasm_bindgen(js_name = fachKnownSubjects)]
pub fn fach_known_subjects() -> JsValue {
    to_js(&json!(impala_fach::known_subjects()))
}

#[wasm_bindgen(js_name = fachClean)]
pub fn fach_clean(value: &str) -> String {
    impala_fach::clean(value).to_owned()
}

#[wasm_bindgen(js_name = fachResolveSubject)]
pub fn fach_resolve_subject(value: &str) -> Option<String> {
    impala_fach::resolve_subject(value).map(str::to_owned)
}

#[wasm_bindgen(js_name = fachDeckSubject)]
pub fn fach_deck_subject(deck: &str) -> JsValue {
    subject_js(impala_fach::deck_subject(deck))
}

#[wasm_bindgen]
impl ModelCore {
    #[wasm_bindgen(js_name = pageSubject)]
    pub fn page_subject_js(&self, id: &str, ignore_manual: bool) -> JsValue {
        let state = self.m.state();
        let Some(page) = state.pages.get(id) else {
            return subject_js(impala_fach::Subject {
                name: impala_fach::DEFAULT_SUBJECT,
                source: impala_fach::Source::Fallback,
            });
        };
        let pages = ModelPages(state);
        let mut own = facts(page);
        if ignore_manual {
            own.subject = None;
        }
        subject_js(impala_fach::page_subject(&pages, &own))
    }

    #[wasm_bindgen(js_name = cardSubject)]
    pub fn card_subject_js(&self, deck: &str, page_id: Option<String>) -> JsValue {
        let state = self.m.state();
        let pages = ModelPages(state);
        subject_js(impala_fach::card_subject(&pages, deck, page_id.as_deref()))
    }
}
