//! Welche Teile des Zustands ein angewandtes Event berührt. Oberflächen halten Lese-Ansichten
//! (Seitenliste, Karten …) und holen nach einem Event nur das Berührte neu.

use serde::Serialize;
use serde_json::Value;

use crate::event::LogEvent;
use crate::types::State;

/// Betroffene Einträge einer Sammlung.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum Ids {
    #[default]
    None,
    Some(Vec<String>),
    All,
}

impl Ids {
    fn one(id: Option<&str>) -> Self {
        match id {
            Some(id) if !id.is_empty() => Ids::Some(vec![id.to_owned()]),
            // Ohne ID wirkt ein Event höchstens auf Altlasten („undefined“): alles neu lesen.
            _ => Ids::All,
        }
    }
    fn is_none(&self) -> bool {
        *self == Ids::None
    }
}

impl Serialize for Ids {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Ids::None => s.serialize_bool(false),
            Ids::All => s.serialize_bool(true),
            Ids::Some(ids) => ids.serialize(s),
        }
    }
}

/// Berührte Teile; als JSON `{ pages: [ids] | true, decks: true, … }` (nur gesetzte Felder).
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Touched {
    #[serde(skip_serializing_if = "Ids::is_none")]
    pub pages: Ids,
    #[serde(skip_serializing_if = "Ids::is_none")]
    pub cards: Ids,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub decks: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub grades: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub learning_sessions: bool,
    #[serde(skip_serializing_if = "Ids::is_none")]
    pub chat_sessions: Ids,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub home_articles: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub settings: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub workspaces: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub gn_folders: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub tree_open: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub tabs: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub reviews: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub telemetry: bool,
    /// Geändertes Heft (Seiten-ID).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heft: Option<String>,
    /// Neues Heft-Bild (Hash).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blob: Option<String>,
    /// Seiten, deren Tabs und offene Ansicht schließen (die gespeicherten Tabs schließt der Reducer selbst) (Papierkorb, Archiv, endgültig gelöscht).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub closed_pages: Vec<String>,
}

fn text<'a>(p: &'a Value, key: &str) -> Option<&'a str> {
    p.get(key).and_then(Value::as_str)
}

/// Was `ev` berührt hat; `state` ist der Zustand NACH dem Anwenden.
pub fn touched(ev: &LogEvent, state: &State) -> Touched {
    let p = &ev.payload;
    let id = text(p, "id");
    let mut t = Touched::default();
    match ev.kind.as_str() {
        "pageCreate" | "pageUpdate" | "pageMove" | "gnItemMove" => t.pages = Ids::one(id),
        "pageDelete" => {
            t.pages = Ids::All;
            t.heft = id.map(str::to_owned);
            t.closed_pages = id.map(|i| vec![i.to_owned()]).unwrap_or_default();
        }
        "pageTrash" | "pageArchive" => {
            t.pages = Ids::All;
            t.closed_pages = id.map(|i| state.page_subtree(i)).unwrap_or_default();
        }
        "pageRestore" | "pageUnarchive" => t.pages = Ids::All,
        "learningSessionUpsert" | "learningSessionDelete" => t.learning_sessions = true,
        "teleEvent" => t.telemetry = true,
        "gradeAdd" | "gradeDelete" => t.grades = true,
        "cardCreate" | "cardRestore" => {
            t.cards = Ids::one(id);
            t.decks = true;
        }
        "cardReview" | "cardReviewUndo" => {
            t.cards = Ids::one(id);
            t.reviews = true;
        }
        "cardUpdate" | "cardArchive" | "cardUnarchive" | "cardTrash" | "cardDelete" => t.cards = Ids::one(id),
        k if k.starts_with("deck") => {
            t.decks = true;
            t.cards = Ids::All;
        }
        "workspaceCreate" => t.workspaces = true,
        "gnFolderCreate" | "gnFolderMove" => t.gn_folders = true,
        "gnFolderDelete" => {
            t.gn_folders = true;
            t.pages = Ids::All;
        }
        "heftOps" | "heftSnap" => {
            let page = text(p, "pageId");
            t.pages = Ids::one(page);
            t.heft = page.map(str::to_owned);
        }
        "heftBlob" => t.blob = text(p, "hash").map(str::to_owned),
        "chatUpsert" | "chatDelete" => t.chat_sessions = Ids::one(id),
        "homeArticleUpsert" => t.home_articles = true,
        "uiTreeSet" => t.tree_open = true,
        "uiTabsSet" => t.tabs = true,
        "settingsSet" => t.settings = true,
        _ => {}
    }
    t
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn beruehrte_teile() {
        let s = State::default();
        let t = touched(&LogEvent::new("e", "t", "pageUpdate", json!({ "id": "a", "patch": {} })), &s);
        assert_eq!(serde_json::to_value(&t).unwrap(), json!({ "pages": ["a"] }));
        let t = touched(&LogEvent::new("e", "t", "deckRename", json!({ "from": "a", "to": "b" })), &s);
        assert_eq!(serde_json::to_value(&t).unwrap(), json!({ "cards": true, "decks": true }));
        let t = touched(&LogEvent::new("e", "t", "pageTrash", json!({ "id": "x" })), &s);
        assert_eq!(t.closed_pages, vec!["x".to_owned()]);
    }
}
