//! Datenbank-Seiten (web/db-view.js): `db.schema` der Elternseite beschreibt die Spalten, jede
//! Unterseite trägt ihre Werte in `props`. Geschrieben wird wie in der PWA über `pageUpdate`.

use std::collections::HashMap;

use serde_json::{Map, Value, json};

use crate::{CoreError, ImpalaCore, invalid};

/// Eine Spalte; `kind` ist der Notion-Typ (`title`, `text`, `number`, `date`, `select`, `status`,
/// `multi_select`, `url` …).
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct DbColumn {
    pub name: String,
    pub kind: String,
}

/// Werte wie `String(props[name])` in der PWA: Text bleibt, Zahlen und Wahrheitswerte als Text.
fn text_of(v: &Value) -> Option<String> {
    match v {
        Value::Null => None,
        Value::String(s) => Some(s.clone()),
        other => Some(other.to_string()),
    }
}

#[uniffi::export]
impl ImpalaCore {
    /// Spalten der Datenbank-Seite `id`; `None`, wenn die Seite keine Datenbank ist.
    pub fn page_db(&self, id: String) -> Option<Vec<DbColumn>> {
        let inner = self.lock();
        let schema = inner.model.state().pages.get(&id)?.extra.get("db")?.get("schema")?.as_array()?.clone();
        Some(
            schema
                .iter()
                .filter_map(|c| {
                    let name = c.get("name")?.as_str()?.to_owned();
                    let kind = c.get("type").and_then(Value::as_str).unwrap_or("text").to_owned();
                    Some(DbColumn { name, kind })
                })
                .collect(),
        )
    }

    /// Eigenschaften (`props`) einer Seite als Text.
    pub fn page_props(&self, id: String) -> HashMap<String, String> {
        let inner = self.lock();
        let Some(props) = inner.model.state().pages.get(&id).and_then(|p| p.extra.get("props")) else {
            return HashMap::new();
        };
        props
            .as_object()
            .map_or_else(HashMap::new, |o| o.iter().filter_map(|(k, v)| Some((k.clone(), text_of(v)?))).collect())
    }

    /// „Als Vorlesungsübersicht“ (`Some(spalten)`) bzw. „Übersicht aufheben“ (`None`).
    pub fn set_page_db(&self, id: String, schema: Option<Vec<DbColumn>>) -> Result<(), CoreError> {
        let mut inner = self.lock();
        if !inner.model.state().pages.contains_key(&id) {
            return Err(invalid(format!("Unbekannte Seite {id}")));
        }
        let db = schema.map(|cols| {
            json!({ "schema": cols.into_iter().map(|c| json!({ "name": c.name, "type": c.kind })).collect::<Vec<_>>() })
        });
        inner.dispatch("pageUpdate", json!({ "id": id, "patch": { "db": db } }))?;
        Ok(())
    }

    /// Einen Zellwert setzen; die übrigen Eigenschaften bleiben (app.js, `.db-cell`).
    pub fn set_page_prop(&self, id: String, name: String, value: String) -> Result<(), CoreError> {
        let mut inner = self.lock();
        let page = inner.model.state().pages.get(&id).ok_or_else(|| invalid(format!("Unbekannte Seite {id}")))?;
        let mut props: Map<String, Value> =
            page.extra.get("props").and_then(Value::as_object).cloned().unwrap_or_default();
        if props.get(&name).and_then(text_of).as_deref() == Some(value.as_str()) {
            return Ok(());
        }
        props.insert(name, Value::from(value));
        inner.dispatch("pageUpdate", json!({ "id": id, "patch": { "props": props } }))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_und_werte() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let parent = core.create_page("VL".into(), String::new(), None, None).unwrap();
        assert_eq!(core.page_db(parent.clone()), None);
        let cols = vec![
            DbColumn { name: "Nr".into(), kind: "number".into() },
            DbColumn { name: "Status".into(), kind: "select".into() },
        ];
        core.set_page_db(parent.clone(), Some(cols.clone())).unwrap();
        assert_eq!(core.page_db(parent.clone()), Some(cols));
        let row = core.create_page("Neue Zeile".into(), String::new(), Some(parent.clone()), None).unwrap();
        core.set_page_prop(row.clone(), "Nr".into(), "3".into()).unwrap();
        core.set_page_prop(row.clone(), "Status".into(), "offen".into()).unwrap();
        let props = core.page_props(row);
        assert_eq!(props.get("Nr").map(String::as_str), Some("3"));
        assert_eq!(props.get("Status").map(String::as_str), Some("offen"));
        core.set_page_db(parent.clone(), None).unwrap();
        assert_eq!(core.page_db(parent), None);
    }
}
