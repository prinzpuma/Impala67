//! Karten verwalten wie die Anki-Ansicht und der Papierkorb der PWA: archivieren, aussetzen,
//! wiederherstellen, endgültig löschen, Bewertung rückgängig machen. Jede Änderung ist ein Event
//! mit dem Payload der PWA (`web/app-click-anki.js`, `web/app-click-pages.js`, `web/extras.js`).

use impala_storage::{Storage, Write};
use serde_json::{Value, json};

use crate::cards::{CardInfo, info, wall_now};
use crate::{CoreError, ImpalaCore, Inner, invalid};

/// Meta-Schlüssel des Rückgängig-Stapels (überlebt einen Neustart der App).
const UNDO_KEY: &str = "reviewUndo";
/// So viele Bewertungen lassen sich zurücknehmen (wie in der PWA).
const UNDO_DEPTH: usize = 50;

/// Stand einer Karte vor einer Bewertung.
pub(crate) struct ReviewUndo {
    pub id: String,
    pub review_id: String,
    /// Lernstand vor der Bewertung, wie gespeichert.
    pub srs: Value,
    pub was_suspended: bool,
}

impl ReviewUndo {
    fn to_value(&self) -> Value {
        json!({ "id": self.id, "reviewId": self.review_id, "srs": self.srs, "wasSuspended": self.was_suspended })
    }

    fn from_value(v: &Value) -> Option<ReviewUndo> {
        Some(ReviewUndo {
            id: v.get("id")?.as_str()?.to_owned(),
            review_id: v.get("reviewId")?.as_str()?.to_owned(),
            srs: v.get("srs")?.clone(),
            was_suspended: v.get("wasSuspended").and_then(Value::as_bool).unwrap_or(false),
        })
    }
}

impl Inner {
    fn undo_stack(&self) -> Vec<ReviewUndo> {
        let raw = self.storage.meta(UNDO_KEY).ok().flatten();
        // Beschädigter Eintrag: leerer Stapel statt Fehler.
        match raw.and_then(|r| serde_json::from_str::<Value>(&r).ok()) {
            Some(Value::Array(list)) => list.iter().filter_map(ReviewUndo::from_value).collect(),
            _ => Vec::new(),
        }
    }

    fn save_undo_stack(&mut self, stack: &[ReviewUndo]) -> Result<(), CoreError> {
        let value =
            (!stack.is_empty()).then(|| Value::Array(stack.iter().map(ReviewUndo::to_value).collect()).to_string());
        self.storage.apply(vec![Write::SetMeta(UNDO_KEY.into(), value)])?;
        Ok(())
    }

    pub(crate) fn push_review_undo(&mut self, entry: ReviewUndo) -> Result<(), CoreError> {
        let mut stack = self.undo_stack();
        stack.push(entry);
        if stack.len() > UNDO_DEPTH {
            stack.remove(0);
        }
        self.save_undo_stack(&stack)
    }

    /// Karte muss existieren; Fehlermeldung wie bei den anderen Karten-Aufrufen.
    fn trashed_card(&self, id: &str) -> Result<(), CoreError> {
        if self.card(id)?.is_trashed() { Ok(()) } else { Err(invalid("Die Karte liegt nicht im Papierkorb")) }
    }
}

#[uniffi::export]
impl ImpalaCore {
    /// Karte archivieren (verschwindet aus Lernen und Liste, bleibt erhalten).
    pub fn archive_card(&self, id: String) -> Result<(), CoreError> {
        self.card_event("cardArchive", &id)
    }

    /// Archivierte Karte zurückholen.
    pub fn unarchive_card(&self, id: String) -> Result<(), CoreError> {
        self.card_event("cardUnarchive", &id)
    }

    /// Karte aus dem Papierkorb holen (ein gelöschter Stapel wird dabei wieder angelegt).
    pub fn restore_card(&self, id: String) -> Result<(), CoreError> {
        self.card_event("cardRestore", &id)
    }

    /// Karte endgültig löschen. Abweichung von der PWA: nur aus dem Papierkorb heraus; so löscht ein
    /// verirrter Aufruf keine lebende Karte.
    pub fn delete_card(&self, id: String) -> Result<(), CoreError> {
        let mut inner = self.lock();
        inner.trashed_card(&id)?;
        inner.dispatch("cardDelete", json!({ "id": id }))?;
        Ok(())
    }

    /// Karte aussetzen oder wieder freigeben (`suspended` per `cardUpdate`).
    pub fn set_card_suspended(&self, id: String, suspended: bool) -> Result<(), CoreError> {
        let mut inner = self.lock();
        inner.card(&id)?;
        inner.dispatch("cardUpdate", json!({ "id": id, "patch": { "suspended": suspended } }))?;
        Ok(())
    }

    /// Lernstand zurücksetzen: Karte ist wieder neu, nicht ausgesetzt, ohne Leech-Markierung
    /// (wie das Werkzeug `reset_flashcards` der PWA).
    pub fn reset_card(&self, id: String) -> Result<(), CoreError> {
        let mut inner = self.lock();
        inner.card(&id)?;
        let srs = serde_json::to_value(impala_srs::Srs::new(wall_now())).map_err(|e| invalid(e.to_string()))?;
        inner
            .dispatch("cardUpdate", json!({ "id": id, "patch": { "srs": srs, "leech": false, "suspended": false } }))?;
        Ok(())
    }

    /// Karten eines Stapels samt Unterstapeln. Ohne `include_trashed` nur aktive
    /// (weder gelöscht noch archiviert).
    pub fn cards_in_deck_tree(&self, deck: String, include_trashed: bool) -> Vec<CardInfo> {
        let inner = self.lock();
        let state = inner.model.state();
        state.cards_in_deck_tree(&deck, include_trashed).iter().filter_map(|id| state.cards.get(id)).map(info).collect()
    }

    /// Einzeln oder über ihren Stapel archivierte Karten, neueste zuerst.
    pub fn archived_cards(&self) -> Vec<CardInfo> {
        let inner = self.lock();
        let state = inner.model.state();
        let mut list: Vec<&impala_model::Card> = state.archived_cards();
        let via_deck =
            state.cards.values().filter(|c| !c.is_trashed() && !c.is_archived() && state.is_card_archived(c));
        list.extend(via_deck);
        list.into_iter().map(info).collect()
    }

    /// Einzeln archivierte Karten, deren Stapel nicht archiviert ist (die Liste „Archiv“ der PWA
    /// neben den archivierten Stapeln).
    pub fn orphan_archived_cards(&self) -> Vec<CardInfo> {
        self.lock().model.state().orphan_archived_cards().into_iter().map(info).collect()
    }

    /// Alle Karten im Papierkorb, neueste zuerst.
    pub fn trashed_cards(&self) -> Vec<CardInfo> {
        self.lock().model.state().trashed_cards().into_iter().map(info).collect()
    }

    /// Karten im Papierkorb, die nicht schon mit einem gelöschten Stapel dort liegen.
    pub fn orphan_trashed_cards(&self) -> Vec<CardInfo> {
        self.lock().model.state().orphan_trashed_cards().into_iter().map(info).collect()
    }

    /// Papierkorb der Karten leeren: gelöschte Stapel samt Karten und einzelne gelöschte Karten
    /// endgültig entfernen (die Seiten im Papierkorb bleiben, siehe `trashed_pages`). Liefert die
    /// Zahl der entfernten Stapel-Wurzeln und Einzelkarten.
    pub fn empty_card_trash(&self) -> Result<u64, CoreError> {
        let mut inner = self.lock();
        let state = inner.model.state();
        let decks = state.trashed_deck_roots();
        let cards: Vec<String> = state.orphan_trashed_cards().iter().map(|c| c.id().to_owned()).collect();
        // Reihenfolge wie die PWA: erst Stapel, dann verwaiste Karten.
        for name in &decks {
            inner.dispatch("deckDelete", json!({ "name": name }))?;
        }
        for id in &cards {
            inner.dispatch("cardDelete", json!({ "id": id }))?;
        }
        Ok((decks.len() + cards.len()) as u64)
    }

    /// Gibt es eine Bewertung zum Zurücknehmen?
    pub fn can_undo_review(&self) -> bool {
        let inner = self.lock();
        inner.undo_stack().iter().any(|u| inner.model.state().cards.contains_key(&u.id))
    }

    /// Letzte Bewertung zurücknehmen (`cardReviewUndo`: alter Lernstand, Eintrag aus dem Protokoll,
    /// Aussetzen durch Leech wieder aufgehoben). Liefert die Karten-ID, `None` ohne Bewertung.
    pub fn undo_review(&self) -> Result<Option<String>, CoreError> {
        let mut inner = self.lock();
        let mut stack = inner.undo_stack();
        // Gelöschte Karten lassen sich nicht zurücksetzen: überspringen.
        let found = loop {
            match stack.pop() {
                Some(u) if inner.model.state().cards.contains_key(&u.id) => break Some(u),
                Some(_) => {}
                None => break None,
            }
        };
        if let Some(u) = &found {
            inner.dispatch(
                "cardReviewUndo",
                json!({ "id": u.id, "reviewId": u.review_id, "srs": u.srs, "unsuspend": !u.was_suspended }),
            )?;
        }
        inner.save_undo_stack(&stack)?;
        Ok(found.map(|u| u.id))
    }
}

impl ImpalaCore {
    /// Ein Karten-Event mit `{ id }`; die Karte muss existieren.
    fn card_event(&self, kind: &str, id: &str) -> Result<(), CoreError> {
        let mut inner = self.lock();
        inner.card(id)?;
        inner.dispatch(kind, json!({ "id": id }))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn core_with_cards() -> (std::sync::Arc<ImpalaCore>, String, String) {
        let core = ImpalaCore::open_in_memory().unwrap();
        let a = core.create_card("A?".into(), "a".into(), Some("Bio::Zelle".into()), None).unwrap();
        let b = core.create_card("B?".into(), "b".into(), None, None).unwrap();
        (core, a, b)
    }

    #[test]
    fn archivieren_aussetzen_papierkorb() {
        let (core, a, b) = core_with_cards();
        core.archive_card(a.clone()).unwrap();
        assert!(core.cards_in_deck("Bio::Zelle".into()).is_empty());
        assert_eq!(core.orphan_archived_cards()[0].id, a);
        assert!(core.archived_cards()[0].archived);
        core.unarchive_card(a.clone()).unwrap();
        assert_eq!(core.cards_in_deck_tree("Bio".into(), false).len(), 1);

        core.set_card_suspended(b.clone(), true).unwrap();
        assert!(core.card(b.clone()).unwrap().suspended);
        core.reset_card(b.clone()).unwrap();
        assert!(!core.card(b.clone()).unwrap().suspended);

        // Endgültig löschen nur aus dem Papierkorb.
        assert!(matches!(core.delete_card(a.clone()), Err(CoreError::Invalid { .. })));
        core.trash_card(a.clone()).unwrap();
        assert_eq!(core.trashed_cards().len(), 1);
        assert_eq!(core.orphan_trashed_cards().len(), 1);
        assert_eq!(core.cards_in_deck_tree("Bio".into(), true).len(), 1);
        core.restore_card(a.clone()).unwrap();
        assert!(core.trashed_cards().is_empty());
        core.trash_card(a.clone()).unwrap();
        core.delete_card(a.clone()).unwrap();
        assert!(core.card(a).is_none());
        assert!(core.archive_card("gibt-es-nicht".into()).is_err());
    }

    #[test]
    fn bewertung_rueckgaengig() {
        let (core, _a, b) = core_with_cards();
        assert!(!core.can_undo_review());
        let before = core.card(b.clone()).unwrap();
        core.review_card(b.clone(), 3).unwrap();
        assert!(core.can_undo_review());
        assert_ne!(core.card(b.clone()).unwrap().stage, before.stage);
        assert_eq!(core.undo_review().unwrap().as_deref(), Some(b.as_str()));
        let after = core.card(b.clone()).unwrap();
        assert_eq!((after.stage, after.due), (before.stage, before.due));
        assert!(core.lock().model.state().reviews.is_empty());
        assert!(!core.can_undo_review());
        assert_eq!(core.undo_review().unwrap(), None);
    }

    #[test]
    fn rueckgaengig_ueberlebt_neustart_und_geloeschte_karten() {
        let dir = std::env::temp_dir().join(format!("impala-undo-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("db.sqlite").to_string_lossy().into_owned();
        let (card, other) = {
            let core = ImpalaCore::open(path.clone()).unwrap();
            let a = core.create_card("A".into(), "a".into(), None, None).unwrap();
            let b = core.create_card("B".into(), "b".into(), None, None).unwrap();
            core.review_card(a.clone(), 3).unwrap();
            core.review_card(b.clone(), 3).unwrap();
            (a, b)
        };
        let core = ImpalaCore::open(path).unwrap();
        core.trash_card(other.clone()).unwrap();
        core.dispatch("cardDelete".into(), json!({ "id": other }).to_string()).unwrap();
        // Die gelöschte Karte wird übersprungen, die davor bewertete zurückgenommen.
        assert_eq!(core.undo_review().unwrap(), Some(card));
        drop(core);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn papierkorb_leeren() {
        let (core, a, b) = core_with_cards();
        core.trash_card(b.clone()).unwrap();
        core.trash_deck("Bio".into()).unwrap();
        assert_eq!(core.orphan_trashed_cards().len(), 1);
        assert_eq!(core.empty_card_trash().unwrap(), 2);
        assert!(core.card(a).is_none() && core.card(b).is_none());
        assert!(core.trashed_cards().is_empty());
    }
}
