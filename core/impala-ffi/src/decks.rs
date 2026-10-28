//! Stapel (Pfade mit `::`): anlegen, umbenennen, verschieben, sortieren, duplizieren, archivieren,
//! Papierkorb, Stapel-Optionen und Überblick – mit den Events und Payloads der PWA
//! (`web/app-click-anki.js`, `web/app-sidebar-events.js`, `web/extras.js`, `web/render-anki.js`).

use std::collections::BTreeSet;

use impala_model::State;
use impala_model::js;
use impala_model::study::StudyOptions;
use impala_model::tree::deck_in_tree;
use serde_json::{Map, Value, json};

use crate::cards::{DeckInfo, wall_now};
use crate::{CoreError, ImpalaCore, Inner, invalid};

/// Trennzeichen zwischen Eltern- und Unterstapel.
const SEP: &str = "::";
/// Name des Standard-Stapels (nicht umbenennbar, nicht löschbar).
const DEFAULT_DECK: &str = "Standard";

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum LeechAction {
    /// Karte nach zu vielen Fehlern aussetzen.
    Suspend,
    /// Nur markieren.
    Mark,
}

/// Stapel-Optionen mit Vererbung (`"Mathe::Analysis"` → `"Mathe"` → `"*"` → Standardwerte).
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct DeckConfig {
    pub new_per_day: u32,
    pub rev_per_day: u32,
    /// Fehler (Nochmal) bis zur Leech-Markierung.
    pub leech_threshold: u32,
    pub leech_action: LeechAction,
}

/// Eine Zeile der Stapel-Übersicht.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct DeckOverview {
    /// Voller Name; Unterstapel als `"Eltern::Kind"`.
    pub name: String,
    /// Manuelle Reihenfolge (`reorder_decks`), `None` = alphabetisch.
    pub order: Option<f64>,
    /// Aktive Karten im Stapel samt Unterstapeln.
    pub total: u64,
    /// Davon ausgesetzt.
    pub suspended: u64,
    /// Heute zu lernen (Tageslimits eingerechnet), Stapel samt Unterstapeln.
    pub new: u64,
    pub learn: u64,
    pub review: u64,
}

/// Name bereinigen: Teile trimmen, leere Teile ablehnen (`"A::"`, `"::B"`, `""`).
fn clean_name(raw: &str) -> Result<String, CoreError> {
    let parts: Vec<&str> = raw.split(SEP).map(js::trim).collect();
    if parts.iter().any(|p| p.is_empty()) {
        return Err(invalid(format!("Ungültiger Stapelname „{raw}“")));
    }
    Ok(parts.join(SEP))
}

/// Stapel gibt es, wenn er selbst oder ein Unterstapel angelegt ist oder Karten trägt (Eltern ohne
/// eigenen Eintrag zeigt die PWA auch).
fn known(state: &State, name: &str) -> bool {
    state.decks.keys().any(|k| deck_in_tree(k, name)) || state.cards.values().any(|c| deck_in_tree(c.deck_name(), name))
}

/// Alle sichtbaren Stapelnamen samt gedachten Eltern (`collectActiveDeckSet`).
fn active_names(state: &State) -> BTreeSet<String> {
    let mut set: BTreeSet<String> = BTreeSet::new();
    set.insert(DEFAULT_DECK.to_owned());
    for (name, d) in state.decks.iter() {
        if !d.is_trashed() && !state.is_deck_archived(name) {
            set.insert(name.clone());
        }
    }
    for c in state.active_cards() {
        set.insert(c.deck_name().to_owned());
    }
    let all: Vec<String> = set.iter().cloned().collect();
    for n in all {
        let mut path = js::parent_path(&n);
        while !path.is_empty() {
            set.insert(path.to_owned());
            path = js::parent_path(path);
        }
    }
    set
}

fn order_of(state: &State, name: &str) -> Option<f64> {
    state.decks.get(name).and_then(|d| d.order)
}

fn conf_number(v: &Value, default: u32) -> u32 {
    let n = js::to_number(Some(v));
    if n.is_finite() { n.clamp(0.0, f64::from(u32::MAX)) as u32 } else { default }
}

fn to_config(conf: &impala_model::tree::DeckConf) -> DeckConfig {
    DeckConfig {
        new_per_day: conf_number(conf.new_per_day(), 20),
        rev_per_day: conf_number(conf.rev_per_day(), 200),
        leech_threshold: conf_number(conf.leech_threshold(), 8),
        leech_action: if conf.suspends_leeches() { LeechAction::Suspend } else { LeechAction::Mark },
    }
}

impl Inner {
    /// Stapel muss bekannt sein (angelegt oder von Karten benutzt).
    fn known_deck(&self, name: &str) -> Result<(), CoreError> {
        if known(self.model.state(), name) { Ok(()) } else { Err(invalid(format!("Unbekannter Stapel {name}"))) }
    }

    fn deck_event(&mut self, kind: &str, name: &str) -> Result<(), CoreError> {
        self.known_deck(name)?;
        self.dispatch(kind, json!({ "name": name }))?;
        Ok(())
    }

    /// `settingsSet { deckConf }` mit dem Abschnitt `key` (None = entfernen).
    fn write_deck_conf(&mut self, key: &str, section: Option<Value>) -> Result<(), CoreError> {
        let mut all: Map<String, Value> = self.model.state().settings.deck_conf.clone().unwrap_or_default();
        match section {
            Some(s) => all.insert(key.to_owned(), s),
            None => all.remove(key),
        };
        self.dispatch("settingsSet", json!({ "deckConf": all }))?;
        Ok(())
    }
}

#[uniffi::export]
impl ImpalaCore {
    /// Stapel anlegen (`"Eltern::Kind"` für Unterstapel); liefert den bereinigten Namen. Existiert er
    /// schon, bleibt er unverändert; lag er im Papierkorb, kommt er zurück.
    pub fn create_deck(&self, name: String) -> Result<String, CoreError> {
        let name = clean_name(&name)?;
        let mut inner = self.lock();
        let trashed = inner.model.state().decks.get(&name).is_some_and(|d| d.is_trashed());
        if trashed {
            inner.dispatch("deckRestore", json!({ "name": name }))?;
        } else if !known(inner.model.state(), &name) {
            inner.dispatch("deckCreate", json!({ "name": name }))?;
        }
        Ok(name)
    }

    /// Stapel samt Unterstapeln und Karten umbenennen. Der neue Name darf weder vergeben noch ein
    /// Teil des eigenen Baums sein (die PWA würde zwei Stapel stillschweigend verschmelzen).
    pub fn rename_deck(&self, from: String, to: String) -> Result<String, CoreError> {
        let to = clean_name(&to)?;
        let mut inner = self.lock();
        inner.known_deck(&from)?;
        if from == DEFAULT_DECK {
            return Err(invalid("Der Standard-Stapel lässt sich nicht umbenennen"));
        }
        if from == to {
            return Ok(to);
        }
        if deck_in_tree(&to, &from) || known(inner.model.state(), &to) {
            return Err(invalid(format!("Der Stapelname „{to}“ ist nicht verfügbar")));
        }
        inner.dispatch("deckRename", json!({ "from": from, "to": to }))?;
        Ok(to)
    }

    /// Stapel samt Unterstapeln unter `target` hängen (`None`: nach oben). Liefert den neuen Namen.
    pub fn move_deck(&self, name: String, target: Option<String>) -> Result<String, CoreError> {
        let target = target.map(|t| clean_name(&t)).transpose()?;
        let mut inner = self.lock();
        inner.known_deck(&name)?;
        if name == DEFAULT_DECK {
            return Err(invalid("Der Standard-Stapel lässt sich nicht verschieben"));
        }
        if target.as_deref().is_some_and(|t| deck_in_tree(t, &name)) {
            return Err(invalid("Ein Stapel lässt sich nicht in sich selbst verschieben"));
        }
        let leaf = name.rsplit(SEP).next().unwrap_or(&name);
        let new_name = target.as_deref().map_or_else(|| leaf.to_owned(), |t| format!("{t}{SEP}{leaf}"));
        if new_name != name && known(inner.model.state(), &new_name) {
            return Err(invalid(format!("Der Stapelname „{new_name}“ ist nicht verfügbar")));
        }
        inner.dispatch("deckMove", json!({ "from": name, "target": target }))?;
        Ok(new_name)
    }

    /// Geschwister-Stapel in die gegebene Reihenfolge bringen (`deckReorder` mit 1000, 2000 …, wie
    /// das Ziehen in der Seitenleiste der PWA).
    pub fn reorder_decks(&self, names: Vec<String>) -> Result<(), CoreError> {
        let mut inner = self.lock();
        for n in &names {
            inner.known_deck(n)?;
        }
        for (i, name) in names.iter().enumerate() {
            inner.dispatch("deckReorder", json!({ "name": name, "order": (i + 1) * 1000 }))?;
        }
        Ok(())
    }

    /// Stapel samt Unterstapeln und aktiven Karten kopieren (Lernstand der Kopie neu); liefert den
    /// Namen der Kopie (`"Name (Kopie)"`).
    pub fn duplicate_deck(&self, name: String) -> Result<String, CoreError> {
        let mut inner = self.lock();
        inner.known_deck(&name)?;
        let leaf = name.rsplit(SEP).next().unwrap_or(&name);
        let prefix = name.rfind(SEP).map_or("", |i| &name[..i + SEP.len()]);
        inner.dispatch("deckDuplicate", json!({ "name": name }))?;
        Ok(format!("{prefix}{leaf} (Kopie)"))
    }

    /// Stapel samt Unterstapeln archivieren (Karten bleiben, werden aber nicht gelernt).
    pub fn archive_deck(&self, name: String) -> Result<(), CoreError> {
        self.lock().deck_event("deckArchive", &name)
    }

    pub fn unarchive_deck(&self, name: String) -> Result<(), CoreError> {
        self.lock().deck_event("deckUnarchive", &name)
    }

    /// Stapel samt Unterstapeln und Karten in den Papierkorb. Den Standard-Stapel gibt es immer:
    /// `NotAllowed` wie die PWA wäre irreführend, darum eine klare Fehlermeldung.
    pub fn trash_deck(&self, name: String) -> Result<(), CoreError> {
        self.lock().deck_event("deckTrash", &name)
    }

    /// Stapel samt Unterstapeln und Karten aus dem Papierkorb holen.
    pub fn restore_deck(&self, name: String) -> Result<(), CoreError> {
        self.lock().deck_event("deckRestore", &name)
    }

    /// Stapel samt Unterstapeln und Karten endgültig löschen. Abweichung von der PWA: nur aus dem
    /// Papierkorb heraus (im Teilbaum liegt ein gelöschter Stapel).
    pub fn delete_deck(&self, name: String) -> Result<(), CoreError> {
        let mut inner = self.lock();
        let state = inner.model.state();
        if !state.decks.iter().any(|(k, d)| d.is_trashed() && deck_in_tree(k, &name)) {
            return Err(invalid("Der Stapel liegt nicht im Papierkorb"));
        }
        inner.dispatch("deckDelete", json!({ "name": name }))?;
        Ok(())
    }

    /// Wurzeln archivierter Stapel-Teilbäume, neueste zuerst; `cards` zählt den ganzen Teilbaum.
    pub fn archived_decks(&self) -> Vec<DeckInfo> {
        let inner = self.lock();
        let state = inner.model.state();
        state.archived_deck_roots().into_iter().map(|name| tree_info(state, name)).collect()
    }

    /// Wurzeln gelöschter Stapel-Teilbäume, neueste zuerst; `cards` zählt den ganzen Teilbaum.
    pub fn trashed_decks(&self) -> Vec<DeckInfo> {
        let inner = self.lock();
        let state = inner.model.state();
        state.trashed_deck_roots().into_iter().map(|name| tree_info(state, name)).collect()
    }

    /// Stapel-Übersicht wie der Stapelbaum der PWA: „Standard“ zuerst, dann manuelle Reihenfolge,
    /// dann alphabetisch; Eltern ohne eigenen Eintrag sind ergänzt. `utc_offset_minutes` wie bei
    /// `study_queue`.
    pub fn deck_overview(&self, utc_offset_minutes: i32, mix: bool) -> Vec<DeckOverview> {
        let inner = self.lock();
        let state = inner.model.state();
        let now = wall_now();
        let mut names: Vec<String> = active_names(state).into_iter().collect();
        names.sort_by(|a, b| {
            let (oa, ob) = (order_of(state, a), order_of(state, b));
            (b == DEFAULT_DECK)
                .cmp(&(a == DEFAULT_DECK))
                .then_with(|| match (oa, ob) {
                    (Some(x), Some(y)) => x.total_cmp(&y),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (None, None) => std::cmp::Ordering::Equal,
                })
                .then_with(|| a.to_lowercase().cmp(&b.to_lowercase()))
        });
        let active = state.active_cards();
        names
            .into_iter()
            .map(|name| {
                let mut opts = StudyOptions::with_offset(Some(&name), now, i64::from(utc_offset_minutes));
                opts.mix = mix;
                let counts = state.study_snapshot(&opts).counts;
                let in_tree = || active.iter().filter(|c| deck_in_tree(c.deck_name(), &name));
                DeckOverview {
                    order: order_of(state, &name),
                    total: in_tree().count() as u64,
                    suspended: in_tree().filter(|c| c.is_suspended()).count() as u64,
                    new: counts.new as u64,
                    learn: counts.learn as u64,
                    review: counts.review as u64,
                    name,
                }
            })
            .collect()
    }

    /// Stapel-Optionen mit Vererbung. `deck`: `None` = die Standardwerte aller Stapel (`"*"`).
    pub fn deck_config(&self, deck: Option<String>) -> DeckConfig {
        let inner = self.lock();
        to_config(&inner.model.state().deck_conf(deck.as_deref().unwrap_or("")))
    }

    /// Optionen für einen Stapel (samt Unterstapeln, die nichts Eigenes haben) oder – mit `None` –
    /// für alle speichern (`settingsSet { deckConf }`). Schwelle mindestens 1.
    pub fn set_deck_config(&self, deck: Option<String>, conf: DeckConfig) -> Result<(), CoreError> {
        let key = deck.map(|d| clean_name(&d)).transpose()?.unwrap_or_else(|| "*".to_owned());
        let section = json!({
            "newPerDay": conf.new_per_day,
            "revPerDay": conf.rev_per_day,
            "leechThreshold": conf.leech_threshold.max(1),
            "leechAction": match conf.leech_action { LeechAction::Suspend => "suspend", LeechAction::Mark => "mark" },
        });
        self.lock().write_deck_conf(&key, Some(section))
    }

    /// Eigene Optionen eines Stapels entfernen: er erbt wieder von Eltern und `"*"`.
    pub fn reset_deck_config(&self, deck: Option<String>) -> Result<(), CoreError> {
        let key = deck.map(|d| clean_name(&d)).transpose()?.unwrap_or_else(|| "*".to_owned());
        self.lock().write_deck_conf(&key, None)
    }
}

/// Stapel samt Kartenzahl des ganzen Teilbaums (auch Papierkorb/Archiv).
fn tree_info(state: &State, name: String) -> DeckInfo {
    let cards = state.cards_in_deck_tree(&name, true).len() as u64;
    DeckInfo { name, cards }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(core: &ImpalaCore) -> Vec<String> {
        core.deck_overview(60, false).into_iter().map(|d| d.name).collect()
    }

    #[test]
    fn anlegen_umbenennen_verschieben() {
        let core = ImpalaCore::open_in_memory().unwrap();
        assert_eq!(core.create_deck("  Mathe :: Analysis ".into()).unwrap(), "Mathe::Analysis");
        assert!(core.create_deck("Mathe::".into()).is_err());
        assert!(core.create_deck("   ".into()).is_err());
        core.create_card("f".into(), "b".into(), Some("Mathe::Analysis".into()), None).unwrap();
        assert_eq!(names(&core), ["Standard", "Mathe", "Mathe::Analysis"]);
        // Doppeltes Anlegen ändert nichts (deckCreate würde die Reihenfolge verwerfen).
        core.reorder_decks(vec!["Mathe::Analysis".into()]).unwrap();
        core.create_deck("Mathe::Analysis".into()).unwrap();
        assert_eq!(
            core.deck_overview(60, false).iter().find(|d| d.name == "Mathe::Analysis").unwrap().order,
            Some(1000.0)
        );

        assert_eq!(core.rename_deck("Mathe".into(), "Math".into()).unwrap(), "Math");
        assert_eq!(core.cards_in_deck_tree("Math".into(), false).len(), 1);
        assert_eq!(core.cards_in_deck("Math::Analysis".into()).len(), 1);
        assert!(core.rename_deck("Math".into(), "Math::Neu".into()).is_err());
        assert!(core.rename_deck("Standard".into(), "X".into()).is_err());
        assert!(core.rename_deck("Nope".into(), "X".into()).is_err());

        core.create_deck("Uni".into()).unwrap();
        assert_eq!(core.move_deck("Math".into(), Some("Uni".into())).unwrap(), "Uni::Math");
        assert!(names(&core).contains(&"Uni::Math::Analysis".to_owned()));
        assert!(core.move_deck("Uni".into(), Some("Uni::Math".into())).is_err());
        assert_eq!(core.move_deck("Uni::Math".into(), None).unwrap(), "Math");
    }

    #[test]
    fn duplizieren_archivieren_papierkorb() {
        let core = ImpalaCore::open_in_memory().unwrap();
        core.create_card("f".into(), "b".into(), Some("A::B".into()), None).unwrap();
        assert_eq!(core.duplicate_deck("A".into()).unwrap(), "A (Kopie)");
        assert_eq!(core.cards_in_deck_tree("A (Kopie)".into(), false).len(), 1);
        assert_eq!(core.duplicate_deck("A::B".into()).unwrap(), "A::B (Kopie)");

        core.archive_deck("A".into()).unwrap();
        assert_eq!(core.archived_decks().len(), 1);
        assert_eq!(core.archived_decks()[0].cards, 2);
        assert!(!names(&core).contains(&"A".to_owned()));
        core.unarchive_deck("A".into()).unwrap();
        assert!(core.archived_decks().is_empty());

        assert!(core.delete_deck("A (Kopie)".into()).is_err());
        core.trash_deck("A (Kopie)".into()).unwrap();
        assert_eq!(core.trashed_decks()[0].name, "A (Kopie)::B");
        core.restore_deck("A (Kopie)".into()).unwrap();
        assert!(core.trashed_decks().is_empty());
        core.trash_deck("A (Kopie)".into()).unwrap();
        core.delete_deck("A (Kopie)".into()).unwrap();
        assert!(core.cards_in_deck_tree("A (Kopie)".into(), true).is_empty());
        // Der Name ist danach wieder frei.
        assert_eq!(core.create_deck("A (Kopie)".into()).unwrap(), "A (Kopie)");
    }

    #[test]
    fn ueberblick_und_optionen() {
        let core = ImpalaCore::open_in_memory().unwrap();
        for i in 0..3 {
            core.create_card(format!("f{i}"), "b".into(), Some("Bio::Zelle".into()), None).unwrap();
        }
        // Neue Karten sind erst ab ihrem Event-Zeitpunkt fällig.
        std::thread::sleep(std::time::Duration::from_millis(10));
        let bio = core.deck_overview(60, false).into_iter().find(|d| d.name == "Bio").unwrap();
        assert_eq!((bio.total, bio.new), (3, 3));
        core.set_card_suspended(core.cards_in_deck("Bio::Zelle".into())[0].id.clone(), true).unwrap();
        let bio = core.deck_overview(60, false).into_iter().find(|d| d.name == "Bio").unwrap();
        assert_eq!((bio.total, bio.suspended, bio.new), (3, 1, 2));

        let base = core.deck_config(None);
        assert_eq!((base.new_per_day, base.rev_per_day, base.leech_threshold), (20, 200, 8));
        assert_eq!(base.leech_action, LeechAction::Suspend);
        let own = DeckConfig { new_per_day: 1, rev_per_day: 5, leech_threshold: 0, leech_action: LeechAction::Mark };
        core.set_deck_config(Some("Bio".into()), own).unwrap();
        // Unterstapel erben, Schwelle mindestens 1; das Tageslimit gilt.
        let inherited = core.deck_config(Some("Bio::Zelle".into()));
        assert_eq!(
            (inherited.new_per_day, inherited.leech_threshold, inherited.leech_action),
            (1, 1, LeechAction::Mark)
        );
        assert_eq!(core.study_queue(Some("Bio".into()), 60, false).new, 1);
        core.reset_deck_config(Some("Bio".into())).unwrap();
        assert_eq!(core.deck_config(Some("Bio::Zelle".into())).new_per_day, 20);
        core.set_deck_config(None, DeckConfig { new_per_day: 7, ..base }).unwrap();
        assert_eq!(core.deck_config(Some("Bio".into())).new_per_day, 7);
    }
}
