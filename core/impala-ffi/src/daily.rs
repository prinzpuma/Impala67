//! Daily Notes (web/app-dialogs.js `openDailyNote`, render.js `renderDaily`): je Tag eine Seite mit
//! `daily: "JJJJ-MM-TT"` unter einem Sammelordner mit `dailyRoot: true`.

use serde_json::{Value, json};

use crate::{CoreError, ImpalaCore};

/// Eine vorhandene Tagesseite.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct DailyNote {
    /// Tag als `JJJJ-MM-TT`.
    pub key: String,
    pub page_id: String,
    /// Erste nicht leere Zeile des Inhalts (höchstens 70 Zeichen, wie der Kalender der PWA).
    pub snippet: String,
}

fn str_extra(v: Option<&Value>) -> Option<&str> {
    v.and_then(Value::as_str).filter(|s| !s.is_empty())
}

#[uniffi::export]
impl ImpalaCore {
    /// Aktive Tagesseiten, deren Tag mit `prefix` beginnt (z. B. `"2026-11"` für einen Monat).
    pub fn daily_notes(&self, prefix: String) -> Vec<DailyNote> {
        let inner = self.lock();
        let mut out: Vec<DailyNote> = inner
            .model
            .state()
            .active_pages()
            .into_iter()
            .filter_map(|p| {
                let key = str_extra(p.extra.get("daily"))?;
                key.starts_with(&prefix).then(|| DailyNote {
                    key: key.to_owned(),
                    page_id: p.id().to_owned(),
                    snippet: p
                        .content()
                        .lines()
                        .map(str::trim)
                        .find(|l| !l.is_empty())
                        .unwrap_or("")
                        .chars()
                        .take(70)
                        .collect(),
                })
            })
            .collect();
        out.sort_by(|a, b| a.key.cmp(&b.key));
        out
    }

    /// Tagesseite zu `key` öffnen: vorhandene ID oder neu anlegen (samt Ordner „Daily Notes“).
    /// `title` ist der lesbare Tag (die Plattform formatiert ihn, z. B. „Dienstag, 03. November 2026“).
    pub fn open_daily_note(&self, key: String, title: String) -> Result<String, CoreError> {
        let mut inner = self.lock();
        let state = inner.model.state();
        let active = state.active_pages();
        if let Some(p) = active.iter().find(|p| str_extra(p.extra.get("daily")) == Some(key.as_str())) {
            return Ok(p.id().to_owned());
        }
        let root = active
            .iter()
            .find(|p| p.extra.get("dailyRoot").and_then(Value::as_bool).unwrap_or(false))
            .map(|p| (p.id().to_owned(), p.workspace().to_owned()));
        let (root_id, workspace) = match root {
            Some(r) => r,
            None => {
                let rid = uuid::Uuid::new_v4().to_string();
                inner.dispatch(
                    "pageCreate",
                    json!({ "id": rid, "title": "Daily Notes", "icon": null, "workspaceId": "default", "dailyRoot": true }),
                )?;
                (rid, "default".to_owned())
            }
        };
        let id = uuid::Uuid::new_v4().to_string();
        inner.dispatch(
            "pageCreate",
            json!({ "id": id, "title": title, "parentId": root_id, "workspaceId": workspace, "icon": null, "daily": key, "content": "" }),
        )?;
        Ok(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legt_ordner_und_tag_einmal_an() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let a = core.open_daily_note("2026-11-03".into(), "Dienstag".into()).unwrap();
        let b = core.open_daily_note("2026-11-03".into(), "Dienstag".into()).unwrap();
        assert_eq!(a, b);
        core.open_daily_note("2026-11-04".into(), "Mittwoch".into()).unwrap();
        let notes = core.daily_notes("2026-11".into());
        assert_eq!(notes.iter().map(|n| n.key.as_str()).collect::<Vec<_>>(), ["2026-11-03", "2026-11-04"]);
        assert!(core.daily_notes("2026-12".into()).is_empty());
        let roots: Vec<_> = core.children_of(None, Some("default".into()));
        assert_eq!(roots.iter().filter(|p| p.title == "Daily Notes").count(), 1);
    }
}
