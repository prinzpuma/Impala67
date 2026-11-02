//! Geräteübergreifender Oberflächen-Zustand der Seitenleiste wie in der PWA: offene Tabs
//! (`uiTabsSet`, web/tabs.js) und der Aufklapp-Zustand des Seitenbaums (`uiTreeSet`, web/collapse.js).

use std::collections::HashMap;

use serde_json::json;

use crate::{CoreError, ImpalaCore};

/// Offene Tabs: Seiten-IDs, `chat:<id>`, `nlm:main`, `anki:main`; dazu der aktive Tab.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct UiTabs {
    pub tabs: Vec<String>,
    pub active_tab_id: Option<String>,
}

#[uniffi::export]
impl ImpalaCore {
    /// Zuletzt gespeicherte Tabs (auch von anderen Geräten).
    pub fn ui_tabs(&self) -> UiTabs {
        let inner = self.lock();
        let s = inner.model.state();
        UiTabs { tabs: s.tabs.clone(), active_tab_id: s.active_tab_id.clone() }
    }

    /// Tabs speichern (wie `saveSessionNow` in web/tabs.js; höchstens die letzten 12).
    pub fn set_ui_tabs(&self, tabs: Vec<String>, active_tab_id: Option<String>) -> Result<(), CoreError> {
        let mut inner = self.lock();
        let s = inner.model.state();
        if s.tabs == tabs && s.active_tab_id == active_tab_id {
            return Ok(());
        }
        let keep = tabs.len().saturating_sub(12);
        inner.dispatch("uiTabsSet", json!({ "tabs": &tabs[keep..], "activeTabId": active_tab_id }))?;
        Ok(())
    }

    /// Aufklapp-Zustand des Baums: offene Seiten (`true`) und ausdrücklich zugeklappte
    /// Arbeitsbereiche (`ws:<id>` → `false`). Seiten sind sonst zu, Arbeitsbereiche offen.
    pub fn tree_open(&self) -> HashMap<String, bool> {
        self.lock().model.state().tree_open.iter().map(|(k, v)| (k.clone(), *v)).collect()
    }

    /// Einen Eintrag auf- oder zuklappen (`COLLAPSE.toggle` in der PWA).
    pub fn set_tree_open(&self, key: String, open: bool) -> Result<(), CoreError> {
        self.lock().dispatch("uiTreeSet", json!({ "key": key, "open": open }))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tabs_und_baum_bleiben_erhalten() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let id = core.create_page("A".into(), "".into(), None, None).unwrap();
        core.set_ui_tabs(vec![id.clone(), "anki:main".into()], Some(id.clone())).unwrap();
        let t = core.ui_tabs();
        assert_eq!(t.tabs, [id.clone(), "anki:main".into()]);
        assert_eq!(t.active_tab_id.as_deref(), Some(id.as_str()));
        core.set_tree_open(id.clone(), true).unwrap();
        core.set_tree_open("ws:default".into(), false).unwrap();
        let open = core.tree_open();
        assert_eq!(open.get(&id), Some(&true));
        assert_eq!(open.get("ws:default"), Some(&false));
        core.set_tree_open(id.clone(), false).unwrap();
        assert!(!core.tree_open().contains_key(&id));
    }
}
