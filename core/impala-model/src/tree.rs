//! Baum-Regeln für Seiten und Stapel – eine Quelle für Reducer, Abfragen und Lernwarteschlange.

use std::collections::{BTreeSet, HashMap, HashSet};

use serde_json::{Value, json};

use crate::js::{self, Object};
use crate::types::{Card, State};

/// Stapel-Standardoptionen (wie Anki).
pub const DECK_DEFAULTS: [(&str, i64); 3] = [("newPerDay", 20), ("revPerDay", 200), ("leechThreshold", 8)];

/// Gehört `deck` zum Stapel-Teilbaum `root` (`"A"` umfasst `"A::B"`)?
pub fn deck_in_tree(deck: &str, root: &str) -> bool {
    !root.is_empty() && deck.strip_prefix(root).is_some_and(|rest| rest.is_empty() || rest.starts_with("::"))
}

/// Letzter Namensteil eines Stapels („Mathe::Analysis“ → „Analysis“).
pub fn deck_label(name: &str) -> &str {
    name.rsplit("::").next().unwrap_or(name)
}

/// Elternteil eines Stapels („Mathe::Analysis“ → Some("Mathe"), „Mathe“ → None).
pub fn deck_parent(name: &str) -> Option<&str> {
    let p = js::parent_path(name);
    if p.is_empty() { None } else { Some(p) }
}

/// Eine Zeile im Stapelbaum mit Kennzahlen.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckTreeEntry {
    pub name: String,
    pub label: String,
    pub parent: Option<String>,
    pub depth: i32,
    pub has_kids: bool,
    pub collapsed: bool,
    pub total: u64,
    pub suspended: u64,
    pub new: u64,
    pub learn: u64,
    pub learn_now: u64,
    pub review: u64,
    pub due: u64,
    pub due_now: u64,
    pub open: bool,
    pub order: Option<f64>,
}

/// Überführt eine flache Liste von Stapelknoten in eine hierarchische Tiefenreihenfolge.
/// Eingeklappte Knoten (`collapsed`) blenden ihre Unteräste aus.
pub fn flatten_tree_entries(entries: Vec<DeckTreeEntry>, collapsed: &HashSet<String>) -> Vec<DeckTreeEntry> {
    let all_names: HashSet<&str> = entries.iter().map(|d| d.name.as_str()).collect();
    let is_root = |d: &DeckTreeEntry| match d.parent.as_deref() {
        None => true,
        Some(p) => !all_names.contains(p),
    };

    let kids = |parent: Option<&str>| -> Vec<usize> {
        entries
            .iter()
            .enumerate()
            .filter(|(_, d)| match parent {
                None => is_root(d),
                Some(p) => d.parent.as_deref() == Some(p),
            })
            .map(|(i, _)| i)
            .collect()
    };

    let mut out = Vec::new();
    fn walk(
        parent: Option<&str>,
        depth: i32,
        entries: &[DeckTreeEntry],
        kids: &impl Fn(Option<&str>) -> Vec<usize>,
        collapsed: &HashSet<String>,
        out: &mut Vec<DeckTreeEntry>,
    ) {
        for idx in kids(parent) {
            let mut entry = entries[idx].clone();
            let child_indices = kids(Some(&entry.name));
            let has_kids = !child_indices.is_empty();
            let is_collapsed = has_kids && collapsed.contains(&entry.name);
            entry.depth = depth;
            entry.has_kids = has_kids;
            entry.collapsed = is_collapsed;
            out.push(entry);
            if !is_collapsed {
                walk(Some(&entries[idx].name), depth + 1, entries, kids, collapsed, out);
            }
        }
    }
    walk(None, 0, &entries, &kids, collapsed, &mut out);
    out
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

    /// Alle sichtbaren Stapelnamen samt gedachten Eltern (`collectActiveDeckSet`), sortiert
    /// („Standard“ zuerst, dann `order`, dann alphabetisch).
    pub fn active_deck_names(&self, extra_name: Option<&str>) -> Vec<String> {
        let mut set = BTreeSet::new();
        for (name, d) in self.decks.iter() {
            let n = js::trim(name);
            if !n.is_empty() && !d.is_trashed() && !self.is_deck_archived(n) {
                set.insert(n.to_owned());
            }
        }
        for c in self.active_cards() {
            let n = js::trim(c.deck_name());
            if !n.is_empty() {
                set.insert(n.to_owned());
            }
        }
        if let Some(extra) = extra_name {
            let n = js::trim(extra);
            if !n.is_empty() {
                set.insert(n.to_owned());
            }
        }
        let all: Vec<String> = set.iter().cloned().collect();
        for n in all {
            let mut path = js::parent_path(&n);
            while !path.is_empty() {
                set.insert(path.to_owned());
                path = js::parent_path(path);
            }
        }
        let mut names: Vec<String> = set.into_iter().collect();
        names.sort_by(|a, b| {
            let (oa, ob) = (self.decks.get(a).and_then(|d| d.order), self.decks.get(b).and_then(|d| d.order));
            (b == "Standard")
                .cmp(&(a == "Standard"))
                .then_with(|| match (oa, ob) {
                    (Some(x), Some(y)) => x.total_cmp(&y),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (None, None) => std::cmp::Ordering::Equal,
                })
                .then_with(|| a.to_lowercase().cmp(&b.to_lowercase()))
                .then_with(|| a.cmp(b))
        });
        names
    }

    /// Berechnet den vollständigen Stapelbaum mit Kennzahlen je Knoten und klappt Äste ein.
    pub fn deck_tree(
        &self,
        collapsed: &HashSet<String>,
        study_opts_fn: impl Fn(&str) -> crate::study::StudyOptions<'_>,
    ) -> Vec<DeckTreeEntry> {
        let names = self.active_deck_names(None);
        let active = self.active_cards();

        let entries: Vec<DeckTreeEntry> = names
            .iter()
            .map(|name| {
                let opts = study_opts_fn(name);
                let snap = self.study_snapshot(&opts);
                let counts = snap.counts;
                let mut total = 0u64;
                let mut suspended = 0u64;
                for c in &active {
                    if deck_in_tree(c.deck_name(), name) {
                        total += 1;
                        if c.is_suspended() {
                            suspended += 1;
                        }
                    }
                }
                let new_cnt = counts.new as u64;
                let learn_cnt = counts.learn as u64;
                let learn_now_cnt = counts.learn_now as u64;
                let review_cnt = counts.review as u64;
                let due = review_cnt + learn_cnt;
                let due_now = review_cnt + learn_now_cnt;
                let open = !snap.done;
                let label = deck_label(name).to_owned();
                let parent = deck_parent(name).map(str::to_owned);
                let order = self.decks.get(name).and_then(|d| d.order);
                DeckTreeEntry {
                    name: name.clone(),
                    label,
                    parent,
                    depth: 0,
                    has_kids: false,
                    collapsed: false,
                    total,
                    suspended,
                    new: new_cnt,
                    learn: learn_cnt,
                    learn_now: learn_now_cnt,
                    review: review_cnt,
                    due,
                    due_now,
                    open,
                    order,
                }
            })
            .collect();

        flatten_tree_entries(entries, collapsed)
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

        assert_eq!(deck_label("Mathe::Analysis"), "Analysis");
        assert_eq!(deck_label("Standard"), "Standard");
        assert_eq!(deck_label("A::B::C"), "C");
        assert_eq!(deck_label(""), "");

        assert_eq!(deck_parent("Mathe::Analysis"), Some("Mathe"));
        assert_eq!(deck_parent("A::B::C"), Some("A::B"));
        assert_eq!(deck_parent("Mathe"), None);
        assert_eq!(deck_parent(""), None);
    }

    #[test]
    fn flatten_tree() {
        let make = |name: &str, order: Option<f64>| DeckTreeEntry {
            name: name.to_owned(),
            label: deck_label(name).to_owned(),
            parent: deck_parent(name).map(str::to_owned),
            depth: 0,
            has_kids: false,
            collapsed: false,
            total: 1,
            suspended: 0,
            new: 1,
            learn: 0,
            learn_now: 0,
            review: 0,
            due: 0,
            due_now: 0,
            open: true,
            order,
        };

        let entries = vec![
            make("Standard", None),
            make("Mathe", Some(100.0)),
            make("Mathe::Analysis", None),
            make("Mathe::Analysis::Integral", None),
            make("Mathe::LinAlg", None),
            make("Bio", None),
        ];

        let mut collapsed = HashSet::new();
        let flat = flatten_tree_entries(entries.clone(), &collapsed);
        assert_eq!(flat.len(), 6);
        assert_eq!(flat[0].name, "Standard");
        assert_eq!(flat[0].depth, 0);
        assert!(!flat[0].has_kids);

        assert_eq!(flat[1].name, "Mathe");
        assert_eq!(flat[1].depth, 0);
        assert!(flat[1].has_kids);

        assert_eq!(flat[2].name, "Mathe::Analysis");
        assert_eq!(flat[2].depth, 1);
        assert!(flat[2].has_kids);

        assert_eq!(flat[3].name, "Mathe::Analysis::Integral");
        assert_eq!(flat[3].depth, 2);
        assert!(!flat[3].has_kids);

        assert_eq!(flat[4].name, "Mathe::LinAlg");
        assert_eq!(flat[4].depth, 1);
        assert!(!flat[4].has_kids);

        assert_eq!(flat[5].name, "Bio");
        assert_eq!(flat[5].depth, 0);

        // Mit eingeklapptem Mathe::Analysis
        collapsed.insert("Mathe::Analysis".into());
        let flat2 = flatten_tree_entries(entries.clone(), &collapsed);
        assert_eq!(flat2.len(), 5);
        assert_eq!(flat2[2].name, "Mathe::Analysis");
        assert!(flat2[2].collapsed);
        assert_eq!(flat2[3].name, "Mathe::LinAlg");

        // Mit eingeklapptem Mathe
        collapsed.clear();
        collapsed.insert("Mathe".into());
        let flat3 = flatten_tree_entries(entries, &collapsed);
        assert_eq!(flat3.len(), 3);
        assert_eq!(flat3[0].name, "Standard");
        assert_eq!(flat3[1].name, "Mathe");
        assert!(flat3[1].collapsed);
        assert_eq!(flat3[2].name, "Bio");

        // Verwaister Unterstapel ohne vorhandenen Elternknoten bleibt sichtbar (Ebene 0)
        let orphan_entries = vec![make("Waisenkind::Kind", None)];
        let flat_orphan = flatten_tree_entries(orphan_entries, &HashSet::new());
        assert_eq!(flat_orphan.len(), 1);
        assert_eq!(flat_orphan[0].name, "Waisenkind::Kind");
        assert_eq!(flat_orphan[0].depth, 0);
    }
}
