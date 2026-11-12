//! Fächer der Seiten (`impala-fach`): erkanntes Fach, festlegen und Katalog – wie der Fach-Dialog der PWA.

use impala_fach::{PageFacts, Pages};
use impala_model::{Page, State};
use serde_json::{Value, json};

use crate::{CoreError, ImpalaCore, invalid};

/// Fach einer Seite für Menü und Dialog.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct PageSubject {
    /// Wirksames Fach (festgelegt, geerbt oder erkannt).
    pub name: String,
    /// Herkunft wie in der PWA (`manual`, `inherited`, `title`, `children`, `fallback` …).
    pub source: String,
    /// Festgelegter Wert der Seite selbst in Anzeigeform (`FACH.clean`); `None` = automatisch.
    pub chosen: Option<String>,
    /// Was die Erkennung ohne festgelegten Wert ergäbe („Automatisch (erkannt: …)“).
    pub automatic: String,
}

/// Wahrheitswerte wie `if (pageObj.subject)` als Text (`String(...)`).
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

/// Seiten des Datenmodells für die Erkennung.
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

/// Die echten Fächer der Auswahl (ohne „Übersicht“ und „Sonstiges“).
#[uniffi::export]
pub fn known_subjects() -> Vec<String> {
    impala_fach::known_subjects().into_iter().map(str::to_owned).collect()
}

/// „Übersicht“ (Sammelseite) für die Auswahl.
#[uniffi::export]
pub fn overview_subject() -> String {
    impala_fach::OVERVIEW_SUBJECT.to_owned()
}

/// „Sonstiges“ für die Auswahl.
#[uniffi::export]
pub fn default_subject() -> String {
    impala_fach::DEFAULT_SUBJECT.to_owned()
}

#[uniffi::export]
impl ImpalaCore {
    /// Fach einer Seite samt festgelegtem Wert und automatischer Erkennung; `None` = unbekannte Seite.
    pub fn page_subject(&self, id: String) -> Option<PageSubject> {
        let inner = self.lock();
        let state = inner.model.state();
        let page = state.pages.get(&id)?;
        let pages = ModelPages(state);
        let own = facts(page);
        let effective = impala_fach::page_subject(&pages, &own);
        let chosen = own.subject.as_deref().map(|s| impala_fach::clean(s).to_owned());
        let automatic = impala_fach::page_subject(&pages, &PageFacts { subject: None, ..own }).name.to_owned();
        Some(PageSubject {
            name: effective.name.to_owned(),
            source: effective.source.as_str().to_owned(),
            chosen,
            automatic,
        })
    }

    /// Fach festlegen (gilt auch für Unterseiten) oder mit `None` zurück auf automatisch.
    /// Gleicher Wert wie bisher: kein Event.
    pub fn set_page_subject(&self, id: String, subject: Option<String>) -> Result<(), CoreError> {
        let mut inner = self.lock();
        let Some(page) = inner.model.state().pages.get(&id) else {
            return Err(invalid(format!("Unbekannte Seite {id}")));
        };
        let subject = subject.filter(|s| !s.trim().is_empty());
        if truthy_text(page.extra.get("subject")) == subject {
            return Ok(());
        }
        inner.dispatch("pageUpdate", json!({ "id": id, "patch": { "subject": subject } }))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::ImpalaCore;

    #[test]
    fn fach_festlegen_vererben_und_zuruecksetzen() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let root = core.create_page("Ordner".into(), String::new(), None, None).unwrap();
        let child = core.create_page("Analysis".into(), String::new(), Some(root.clone()), None).unwrap();
        let auto = core.page_subject(child.clone()).unwrap();
        assert_eq!((auto.name.as_str(), auto.source.as_str(), auto.chosen), ("Mathematik", "title", None));

        core.set_page_subject(root.clone(), Some("Physik".into())).unwrap();
        let inherited = core.page_subject(child.clone()).unwrap();
        assert_eq!((inherited.name.as_str(), inherited.source.as_str()), ("Physik", "inherited"));
        assert_eq!(inherited.automatic, "Physik");
        let own = core.page_subject(root.clone()).unwrap();
        assert_eq!((own.chosen.as_deref(), own.source.as_str()), (Some("Physik"), "manual"));
        assert_eq!(own.automatic, "Sonstiges");

        core.set_page_subject(root.clone(), None).unwrap();
        assert_eq!(core.page_subject(child).unwrap().name, "Mathematik");
        assert_eq!(core.page_subject(root).unwrap().chosen, None);
    }
}
