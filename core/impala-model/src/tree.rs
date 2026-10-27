//! Baum-Regeln für Seiten und Stapel – eine Quelle für Reducer, Abfragen und Lernwarteschlange.

use std::collections::{HashMap, HashSet};

use serde_json::{Value, json};

use crate::js::{self, Object};
use crate::types::{Card, State};

/// Stapel-Standardoptionen (wie Anki).
pub const DECK_DEFAULTS: [(&str, i64); 3] = [("newPerDay", 20), ("revPerDay", 200), ("leechThreshold", 8)];

/// Gehört `deck` zum Stapel-Teilbaum `root` (`"A"` umfasst `"A::B"`)?
pub fn deck_in_tree(deck: &str, root: &str) -> bool {
    !root.is_empty() && deck.strip_prefix(root).is_some_and(|rest| rest.is_empty() || rest.starts_with("::"))
}

/// Optionen eines Stapels: Werte wie gespeichert (Zahlen, aber auch Fremdwerte).
#[derive(Debug, Clone, PartialEq)]
pub struct DeckConf(pub Object);

impl DeckConf {
    pub fn get(&self, key: &str) -> &Value {
        self.0.get(key).unwrap_or(&Value::Null)
    }
    pub fn new_per_day(&self) -> &Value {
        self.get("newPerDay")
    }
    pub fn rev_per_day(&self) -> &Value {
        self.get("revPerDay")
    }
    pub fn leech_threshold(&self) -> &Value {
        self.get("leechThreshold")
    }
    pub fn suspends_leeches(&self) -> bool {
        self.get("leechAction").as_str() == Some("suspend")
    }
}

impl State {
    /// Eine Regel für Seiten-Zugehörigkeit und Zyklus-Schutz (`pageInTree`): liegt `page`
    /// (oder eine ihrer Elternseiten) bei `root`? Kaputte Ketten über 10 000 Stufen gelten als ja.
    pub fn page_in_tree(&self, page: Option<&str>, root: &str) -> bool {
        let mut id = page.filter(|p| !p.is_empty()).map(str::to_owned);
        let mut hops = 0;
        while let Some(cur) = id {
            if cur == root {
                return true;
            }
            hops += 1;
            if hops > 10_000 {
                return true;
            }
            id = self.pages.get(&cur).and_then(|p| p.parent()).map(str::to_owned);
        }
        false
    }

    /// Eltern → Kinder über alle Seiten (auch Papierkorb/Archiv), in Seitenreihenfolge.
    pub(crate) fn children_index(&self) -> HashMap<&str, Vec<&str>> {
        let mut m: HashMap<&str, Vec<&str>> = HashMap::new();
        for (key, pg) in self.pages.iter() {
            let id = pg.id.as_deref().unwrap_or(key);
            m.entry(pg.parent().unwrap_or("")).or_default().push(id);
        }
        m
    }

    /// Seite samt aller Nachfahren (`collectSubtree`), Zyklen-sicher; die Wurzel ist immer dabei.
    pub fn page_subtree(&self, root: &str) -> Vec<String> {
        // Häufigster Fall ohne Unterseiten: ein Durchlauf ohne Index.
        if !self.pages.values().any(|p| p.parent() == Some(root)) {
            return vec![root.to_owned()];
        }
        let idx = self.children_index();
        let mut out = Vec::new();
        let mut seen = HashSet::new();
        let mut stack = vec![root];
        while let Some(cur) = stack.pop() {
            if !seen.insert(cur) {
                continue;
            }
            out.push(cur.to_owned());
            if let Some(kids) = idx.get(cur) {
                stack.extend(kids.iter().copied());
            }
        }
        out
    }

    /// Ist die Seite selbst oder eine Elternseite archiviert?
    pub fn is_page_archived(&self, id: &str) -> bool {
        let mut seen = HashSet::new();
        let mut cur = self.pages.get(id);
        while let Some(pg) = cur {
            if !seen.insert(pg.id()) {
                break;
            }
            if pg.is_archived() {
                return true;
            }
            cur = pg.parent().and_then(|p| self.pages.get(p));
        }
        false
    }

    /// Namen des Stapel-Teilbaums (`deckSubtree`).
    pub fn deck_subtree(&self, root: &str) -> Vec<String> {
        self.decks.keys().filter(|n| deck_in_tree(n, root)).cloned().collect()
    }

    /// Archivierung wird vererbt: ein archivierter Elternstapel blendet seinen Teilbaum aus.
    pub fn is_deck_archived(&self, name: &str) -> bool {
        let trimmed = js::trim(if name.is_empty() { "Standard" } else { name });
        let mut path = if trimmed.is_empty() { "Standard" } else { trimmed };
        while !path.is_empty() {
            if self.decks.get(path).is_some_and(|d| d.is_archived()) {
                return true;
            }
            path = js::parent_path(path);
        }
        false
    }

    pub fn is_card_archived(&self, card: &Card) -> bool {
        card.is_archived() || self.is_deck_archived(card.deck_name())
    }

    /// Karten-IDs eines Stapel-Teilbaums; ohne `include_trashed` nur aktive.
    pub fn cards_in_deck_tree(&self, root: &str, include_trashed: bool) -> Vec<String> {
        self.cards
            .iter()
            .filter(|(_, c)| include_trashed || !(c.is_trashed() || self.is_card_archived(c)))
            .filter(|(_, c)| deck_in_tree(c.deck_name(), root))
            .map(|(k, _)| k.clone())
            .collect()
    }

    /// Optionen eines Stapels mit Vererbung: `"Mathe::Analysis"` → `"Mathe"` → `"*"` → Standard.
    pub fn deck_conf(&self, deck: &str) -> DeckConf {
        let mut conf: Object = DECK_DEFAULTS.iter().map(|(k, v)| ((*k).to_owned(), json!(v))).collect();
        conf.insert("leechAction".into(), json!("suspend"));
        let all = self.settings.deck_conf.as_ref();
        let section = |k: &str| all.and_then(|a| a.get(k)).filter(|v| js::truthy(v));
        let mut merge = |v: Option<&Value>| {
            if let Some(Value::Object(o)) = v {
                for (k, v) in o {
                    conf.insert(k.clone(), v.clone());
                }
            }
        };
        merge(section("*"));
        let mut d = if deck.is_empty() { "Standard" } else { deck };
        while !d.is_empty() {
            if let Some(own) = section(d) {
                merge(Some(own));
                break;
            }
            d = js::parent_path(d);
        }
        DeckConf(conf)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stapel_baum() {
        assert!(deck_in_tree("A", "A"));
        assert!(deck_in_tree("A::B", "A"));
        assert!(!deck_in_tree("AB", "A"));
        assert!(!deck_in_tree("A:", "A"));
        assert!(!deck_in_tree("A", ""));
    }
}
