//! Karteikarten: Stapel, Lernwarteschlange (FSRS, `impala-srs`) und Bewerten wie in der PWA
//! (`rateAndReviewCard` in `web/app-dialogs.js`: ein `cardReview`-Event mit dem neuen Lernstand).

use std::time::{SystemTime, UNIX_EPOCH};

use impala_model::Card;
use impala_model::study::StudyOptions;
use impala_srs::{Fuzz, Rating, Srs, Timestamp};
use serde_json::{Value, json};

use crate::{CoreError, ImpalaCore, Inner, invalid};

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum CardStage {
    New,
    Learning,
    Review,
    Relearning,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct CardInfo {
    pub id: String,
    /// Vorder-/Rückseite als Markdown.
    pub front: String,
    pub back: String,
    pub deck: String,
    pub page_id: Option<String>,
    pub stage: CardStage,
    /// Fällig ab (ISO), leer bei Altkarten ohne Lernstand.
    pub due: String,
    pub suspended: bool,
    /// Zu oft vergessen (Leech-Markierung).
    pub leech: bool,
    /// Einzeln archiviert (nicht: über den Stapel).
    pub archived: bool,
    pub trashed: bool,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct DeckInfo {
    /// Voller Name; Unterstapel als `"Eltern::Kind"`.
    pub name: String,
    pub cards: u64,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct StudyQueue {
    /// Jetzt zu lernen, in Lernreihenfolge (die erste Karte zeigen).
    pub due_now: Vec<CardInfo>,
    pub learn: u64,
    pub review: u64,
    pub new: u64,
    /// Nächster Lernschritt heute (ISO), wenn gerade nichts fällig ist.
    pub next_learn_at: Option<String>,
    /// Für jetzt fertig, später heute kommen noch Lernschritte.
    pub finished_for_now: bool,
    /// Heute nichts mehr zu tun.
    pub done: bool,
}

fn text(c: &Card, key: &str) -> String {
    match c.get(key) {
        Some(Value::String(s)) => s,
        _ => String::new(),
    }
}

pub(crate) fn info(c: &Card) -> CardInfo {
    CardInfo {
        id: c.id().to_owned(),
        front: text(c, "front"),
        back: text(c, "back"),
        deck: c.deck_name().to_owned(),
        page_id: Some(text(c, "pageId")).filter(|p| !p.is_empty()),
        stage: match c.srs_state() {
            Some("learning") => CardStage::Learning,
            Some("review") => CardStage::Review,
            Some("relearning") => CardStage::Relearning,
            _ => CardStage::New,
        },
        due: c.srs_due().unwrap_or_default().to_owned(),
        suspended: c.is_suspended(),
        leech: c.truthy("leech"),
        archived: c.is_archived(),
        trashed: c.is_trashed(),
    }
}

pub(crate) fn wall_now() -> Timestamp {
    Timestamp::from_millis(SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64))
}

/// Lernstand einer Karte; fehlt `due` oder ist er unlesbar (Altdaten), gilt sie ab `now` als fällig.
pub(crate) fn srs_of(c: &Card, now: Timestamp) -> Result<Srs, CoreError> {
    let mut v = c.srs().cloned().unwrap_or(Value::Null);
    let Value::Object(o) = &mut v else { return Ok(Srs::new(now)) };
    if !o.get("due").and_then(Value::as_str).is_some_and(|d| Timestamp::parse_iso(d).is_some()) {
        o.insert("due".into(), Value::String(now.to_iso()));
    }
    serde_json::from_value(v).map_err(|e| invalid(format!("Lernstand unlesbar: {e}")))
}

/// Gleichverteilte Zufallszahl in [0, 1) für die Intervall-Streuung.
fn fuzz_sample() -> f64 {
    let bits = u64::from_le_bytes(uuid::Uuid::new_v4().as_bytes()[..8].try_into().unwrap_or_default());
    (bits >> 11) as f64 / (1u64 << 53) as f64
}

impl Inner {
    pub(crate) fn card(&self, id: &str) -> Result<&Card, CoreError> {
        self.model.state().cards.get(id).ok_or_else(|| invalid(format!("Unbekannte Karte {id}")))
    }

    /// Neuer Stapel-Name wird erst angelegt (wie der Karten-Editor der PWA).
    pub(crate) fn ensure_deck(&mut self, deck: &str) -> Result<(), CoreError> {
        let state = self.model.state();
        let known =
            deck == "Standard" || state.decks.contains_key(deck) || state.cards.values().any(|c| c.deck_name() == deck);
        if !known {
            self.dispatch("deckCreate", json!({ "name": deck }))?;
        }
        Ok(())
    }
}

#[uniffi::export]
impl ImpalaCore {
    /// Stapel außerhalb von Papierkorb und Archiv, mit Kartenzahl.
    pub fn decks(&self) -> Vec<DeckInfo> {
        let inner = self.lock();
        let state = inner.model.state();
        let mut names: Vec<String> = state
            .decks
            .values()
            .filter(|d| !d.is_trashed() && !d.is_archived())
            .filter_map(|d| d.name.clone())
            .collect();
        for c in state.active_cards() {
            if !names.iter().any(|n| n == c.deck_name()) {
                names.push(c.deck_name().to_owned());
            }
        }
        names
            .into_iter()
            .map(|name| {
                let cards = state.active_cards().iter().filter(|c| c.deck_name() == name).count() as u64;
                DeckInfo { name, cards }
            })
            .collect()
    }

    /// Karten eines Stapels (ohne Unterstapel), außerhalb von Papierkorb und Archiv.
    pub fn cards_in_deck(&self, deck: String) -> Vec<CardInfo> {
        let inner = self.lock();
        inner.model.state().active_cards().into_iter().filter(|c| c.deck_name() == deck).map(info).collect()
    }

    pub fn card(&self, id: String) -> Option<CardInfo> {
        self.lock().model.state().cards.get(&id).map(info)
    }

    /// Lernwarteschlange jetzt. `deck`: Stapel samt Unterstapeln (`None`: alle).
    /// `utc_offset_minutes`: aktueller Versatz der Ortszeit (MEZ +60, MESZ +120) für die Tagesgrenze.
    pub fn study_queue(&self, deck: Option<String>, utc_offset_minutes: i32, mix: bool) -> StudyQueue {
        let inner = self.lock();
        let state = inner.model.state();
        let mut opts = StudyOptions::with_offset(deck.as_deref(), wall_now(), i64::from(utc_offset_minutes));
        opts.mix = mix;
        let snap = state.study_snapshot(&opts);
        StudyQueue {
            due_now: snap.due_now.iter().filter_map(|id| state.cards.get(id)).map(info).collect(),
            learn: snap.counts.learn as u64,
            review: snap.counts.review as u64,
            new: snap.counts.new as u64,
            next_learn_at: snap.next_learn_at,
            finished_for_now: snap.finished_for_now,
            done: snap.done,
        }
    }

    /// Intervall-Texte der vier Antwort-Knöpfe (Nochmal, Schwer, Gut, Einfach), z. B. „10 Min“.
    pub fn review_preview(&self, card_id: String) -> Result<Vec<String>, CoreError> {
        let inner = self.lock();
        let now = wall_now();
        Ok(srs_of(inner.card(&card_id)?, now)?.preview(now).to_vec())
    }

    /// Karte bewerten (`grade` 1 = Nochmal … 4 = Einfach): neuer Lernstand als `cardReview`.
    pub fn review_card(&self, card_id: String, grade: u8) -> Result<(), CoreError> {
        if !(1..=4).contains(&grade) {
            return Err(invalid(format!("Bewertung {grade} ist nicht 1…4")));
        }
        let mut inner = self.lock();
        let now = wall_now();
        let card = inner.card(&card_id)?;
        let before = srs_of(card, now)?;
        // Stand vor der Bewertung für „Rückgängig“ (wie `undoStack` in `web/extras.js`).
        let review_id = uuid::Uuid::new_v4().to_string();
        let undo = crate::card_ops::ReviewUndo {
            id: card_id.clone(),
            review_id: review_id.clone(),
            srs: card
                .srs()
                .filter(|v| !v.is_null())
                .cloned()
                .map_or_else(|| serde_json::to_value(&before).map_err(|e| invalid(e.to_string())), Ok)?,
            was_suspended: card.is_suspended(),
        };
        let srs = before.rate(Rating::from_grade(f64::from(grade)), now, Fuzz::Sample(fuzz_sample()));
        let stage = info(card).stage;
        let previous = inner
            .model
            .state()
            .reviews
            .iter()
            .filter(|r| r.card_id.as_deref() == Some(card_id.as_str()) && r.grade.is_some_and(|g| g > 0.0))
            .max_by(|a, b| a.t().cmp(b.t()))
            .map(|r| r.t().to_owned());
        let interval_days = previous.as_deref().and_then(Timestamp::parse_iso).map(|t| (now.days_since(t)).max(0.0));
        let payload = json!({
            "id": card_id,
            "srs": serde_json::to_value(&srs).map_err(|e| invalid(e.to_string()))?,
            "grade": grade,
            "reviewId": review_id,
            "deck": card.deck_name(),
            "first": stage == CardStage::New,
            "learning": matches!(stage, CardStage::Learning | CardStage::Relearning),
            "dueAt": card.srs_due(),
            "previousReviewAt": previous,
            "intervalDays": interval_days,
        });
        inner.dispatch("cardReview", payload)?;
        inner.push_review_undo(undo)
    }

    /// Neue Karte; liefert ihre ID. Ohne `deck`: „Standard“.
    pub fn create_card(
        &self,
        front: String,
        back: String,
        deck: Option<String>,
        page_id: Option<String>,
    ) -> Result<String, CoreError> {
        let mut inner = self.lock();
        let deck = deck.filter(|d| !d.trim().is_empty());
        if let Some(d) = &deck {
            inner.ensure_deck(d)?;
        }
        let id = uuid::Uuid::new_v4().to_string();
        inner.dispatch(
            "cardCreate",
            json!({ "id": id, "front": front, "back": back, "deck": deck, "pageId": page_id }),
        )?;
        Ok(id)
    }

    /// Vorder-/Rückseite oder Stapel ändern (`None` = unverändert).
    pub fn update_card(
        &self,
        id: String,
        front: Option<String>,
        back: Option<String>,
        deck: Option<String>,
    ) -> Result<(), CoreError> {
        let mut inner = self.lock();
        inner.card(&id)?;
        let mut patch = serde_json::Map::new();
        for (k, v) in [("front", front), ("back", back)] {
            if let Some(v) = v {
                patch.insert(k.into(), Value::from(v));
            }
        }
        if let Some(d) = deck.filter(|d| !d.trim().is_empty()) {
            inner.ensure_deck(&d)?;
            patch.insert("deck".into(), Value::from(d));
        }
        if !patch.is_empty() {
            inner.dispatch("cardUpdate", json!({ "id": id, "patch": patch }))?;
        }
        Ok(())
    }

    /// Karte in den Papierkorb.
    pub fn trash_card(&self, id: String) -> Result<(), CoreError> {
        let mut inner = self.lock();
        inner.card(&id)?;
        inner.dispatch("cardTrash", json!({ "id": id }))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::ImpalaCore;

    use super::*;

    #[test]
    fn karten_anlegen_lernen_bewerten() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let a = core.create_card("Was ist 2+2?".into(), "4".into(), Some("Mathe::Grundlagen".into()), None).unwrap();
        let b = core.create_card("Hauptstadt?".into(), "Berlin".into(), None, None).unwrap();
        let decks = core.decks();
        assert!(decks.iter().any(|d| d.name == "Mathe::Grundlagen" && d.cards == 1), "{decks:?}");
        assert!(decks.iter().any(|d| d.name == "Standard" && d.cards == 1));

        // Neue Karten sind ab ihrem Event-Zeitpunkt fällig; die monotone Uhr kann 1–2 ms vorauslaufen.
        std::thread::sleep(std::time::Duration::from_millis(10));
        let q = core.study_queue(None, 60, false);
        assert_eq!(q.new, 2);
        assert_eq!(q.due_now.len(), 2);
        assert_eq!(core.study_queue(Some("Mathe".into()), 60, false).due_now[0].id, a);

        assert_eq!(core.review_preview(b.clone()).unwrap().len(), 4);
        core.review_card(b.clone(), 3).unwrap();
        let card = core.card(b.clone()).unwrap();
        assert_ne!(card.stage, CardStage::New);
        assert!(card.due > wall_now().to_iso());
        // Zweite Bewertung kennt die erste (Abstand in Tagen).
        core.review_card(b.clone(), 1).unwrap();
        let inner = core.lock();
        let reviews = &inner.model.state().reviews;
        assert_eq!(reviews.len(), 2);
        assert!(reviews[1].interval_days.is_some());
        drop(inner);
        assert!(matches!(core.review_card(b.clone(), 5), Err(CoreError::Invalid { .. })));

        core.update_card(a.clone(), None, Some("vier".into()), Some("Mathe".into())).unwrap();
        let card = core.card(a.clone()).unwrap();
        assert_eq!((card.back.as_str(), card.deck.as_str()), ("vier", "Mathe"));
        core.trash_card(a).unwrap();
        assert!(core.cards_in_deck("Mathe".into()).is_empty());
    }
}
