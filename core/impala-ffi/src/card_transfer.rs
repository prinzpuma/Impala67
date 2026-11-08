//! Karten-Import und -Export (TXT, CSV/TSV, Anki-Text) für native Apps (`ios/Impala67/Cards/`).
//! UniFFI-Brücke über `impala-model::card_transfer`.

use impala_model::{ParsedCards as CoreParsedCards, PlainCard as CorePlainCard, card_transfer};

use crate::ImpalaCore;

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct PlainCard {
    pub front: String,
    pub back: String,
    pub deck: String,
}

impl From<CorePlainCard> for PlainCard {
    fn from(c: CorePlainCard) -> Self {
        Self { front: c.front, back: c.back, deck: c.deck }
    }
}

impl From<PlainCard> for CorePlainCard {
    fn from(c: PlainCard) -> Self {
        Self { front: c.front, back: c.back, deck: c.deck }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ParsedCards {
    pub cards: Vec<PlainCard>,
    pub errors: Vec<String>,
    pub format: String,
}

impl From<CoreParsedCards> for ParsedCards {
    fn from(p: CoreParsedCards) -> Self {
        Self { cards: p.cards.into_iter().map(Into::into).collect(), errors: p.errors, format: p.format }
    }
}

/// Impala-TXT-Format schreiben (`impala67-karten.txt`).
#[uniffi::export]
pub fn card_export_txt(cards: Vec<PlainCard>) -> String {
    let plain: Vec<CorePlainCard> = cards.into_iter().map(Into::into).collect();
    card_transfer::export_txt(&plain)
}

/// CSV-Format schreiben (`impala67-karten.csv`).
#[uniffi::export]
pub fn card_export_csv(cards: Vec<PlainCard>) -> String {
    let plain: Vec<CorePlainCard> = cards.into_iter().map(Into::into).collect();
    card_transfer::export_csv(&plain)
}

/// Tabellarische Karten (CSV/TSV oder Anki-Text) einlesen.
#[uniffi::export]
pub fn card_parse_table_cards(text: String, default_deck: String) -> ParsedCards {
    card_transfer::parse_table_cards(&text, &default_deck).into()
}

/// Impala-TXT-Dateien einlesen.
#[uniffi::export]
pub fn card_parse_impala_txt(text: String, default_deck: String) -> ParsedCards {
    card_transfer::parse_impala_txt(&text, &default_deck).into()
}

/// Erkennt das Format automatisch (Impala-TXT vs. Tabelle/Anki) und parst Karten.
#[uniffi::export]
pub fn card_parse_card_text(text: String, default_deck: String) -> ParsedCards {
    card_transfer::parse_card_text(&text, &default_deck).into()
}

/// Eindeutiger Kartenschlüssel für Duplikate.
#[uniffi::export]
pub fn card_key(front: String, back: String, deck: String) -> String {
    card_transfer::card_key(&front, &back, &deck)
}

/// Zählt Duplikate innerhalb der Karten und gegenüber bestehenden Schlüsseln.
#[uniffi::export]
pub fn card_duplicate_count(cards: Vec<PlainCard>, seen_keys: Vec<String>) -> u64 {
    let plain: Vec<CorePlainCard> = cards.into_iter().map(Into::into).collect();
    card_transfer::duplicate_count(&plain, seen_keys.into_iter().collect()) as u64
}

/// HTML aus Anki-Feldern in Klartext umwandeln.
#[uniffi::export]
pub fn card_strip_html(html: String) -> String {
    card_transfer::strip_html(&html)
}

#[uniffi::export]
impl ImpalaCore {
    /// Aktive Karten für den Export (ohne Papierkorb und Archiv).
    pub fn active_plain_cards(&self) -> Vec<PlainCard> {
        self.lock().model.state().active_plain_cards().into_iter().map(Into::into).collect()
    }

    /// Bestehende Kartenschlüssel für Duplikaterkennung.
    pub fn existing_card_keys(&self) -> Vec<String> {
        self.lock().model.state().existing_card_keys().into_iter().collect()
    }

    /// Duplikate in den übergebenen Karten gegenüber der Datenbank zählen.
    pub fn duplicate_count(&self, cards: Vec<PlainCard>) -> u64 {
        let seen = self.lock().model.state().existing_card_keys();
        let plain: Vec<CorePlainCard> = cards.into_iter().map(Into::into).collect();
        card_transfer::duplicate_count(&plain, seen) as u64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn card_transfer_roundtrip() {
        let cards = vec![PlainCard { front: "Frage 1".into(), back: "Antwort 1".into(), deck: "Bio".into() }];
        let txt = card_export_txt(cards.clone());
        assert!(txt.contains("@stapel Bio"));
        assert!(txt.contains("Frage 1"));

        let parsed = card_parse_card_text(txt, "Standard".into());
        assert_eq!(parsed.cards, cards);
        assert_eq!(parsed.format, "Impala-TXT");

        let key = card_key("Frage 1".into(), "Antwort 1".into(), "Bio".into());
        let dup = card_duplicate_count(cards.clone(), vec![key]);
        assert_eq!(dup, 1);
    }
}
