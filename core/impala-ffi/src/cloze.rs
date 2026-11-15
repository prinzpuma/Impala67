//! Lückentext-Karten (Cloze) wie in der PWA (`web/extras.js`): `{{c1::Antwort::Hinweis}}`; je
//! Lücken-Nummer eine eigene Karte. Aus `==Markierungen==` einer Seite werden Lücken.

use impala_srs::cloze;
use serde_json::json;

use crate::{CoreError, ImpalaCore, Inner};

/// Ergebnis von [`wrap_cloze`]: geänderter Text und Schreibmarkenposition (UTF-16-Offset).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ClozeWrap {
    pub text: String,
    pub cursor: u32,
}

/// Frage (mit „＿＿＿“ maskiert) und Roh-Antworten für die Tageskarten-Vorschau (Recall).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ClozeRecall {
    pub question: String,
    pub answers: Vec<String>,
}

/// Markierten Text in `{{cN::…}}` setzen (N = nächste freie Nummer); ohne Markierung eine
/// leere Lücke an der Schreibmarke. Positionen als UTF-16-Code-Units (Swift / Kotlin).
#[uniffi::export]
pub fn wrap_cloze(text: String, selection_start: u32, selection_end: u32) -> ClozeWrap {
    let res = cloze::wrap_cloze(&text, selection_start, selection_end);
    ClozeWrap { text: res.text, cursor: res.cursor }
}

/// Maskiert alle Lücken mit `＿＿＿` und liefert die Antworten der Reihe nach.
/// Liefert `None`, wenn der Text keine Cloze-Lücke enthält.
#[uniffi::export]
pub fn cloze_recall(front: String) -> Option<ClozeRecall> {
    cloze::cloze_recall(&front).map(|r| ClozeRecall { question: r.question, answers: r.answers })
}

impl Inner {
    fn create_cloze(&mut self, text: &str, deck: Option<&str>, page_id: Option<&str>) -> Result<u32, CoreError> {
        let idxs = cloze::indexes(text);
        if let Some(d) = deck {
            self.ensure_deck(d)?;
        }
        for &i in &idxs {
            let id = uuid::Uuid::new_v4().to_string();
            self.dispatch(
                "cardCreate",
                json!({
                    "id": id,
                    "front": cloze::front(text, i),
                    "back": cloze::back(text, i),
                    "pageId": page_id,
                    "deck": deck,
                    "type": "cloze",
                    "cloze": { "src": text, "index": i },
                }),
            )?;
        }
        Ok(idxs.len() as u32)
    }

    fn has_cloze_card(&self, src: &str) -> bool {
        self.model.state().cards.values().any(|c| {
            c.get("cloze").and_then(|z| z.get("src").and_then(|s| s.as_str().map(|s| s == src))).unwrap_or(false)
        })
    }
}

#[uniffi::export]
impl ImpalaCore {
    /// Lückentext-Karten aus `text` (`{{c1::…}}`); liefert die Zahl der Karten (0: keine Lücke).
    pub fn create_cloze_cards(
        &self,
        text: String,
        deck: Option<String>,
        page_id: Option<String>,
    ) -> Result<u32, CoreError> {
        let deck = deck.filter(|d| !d.trim().is_empty());
        self.lock().create_cloze(&text, deck.as_deref(), page_id.as_deref())
    }

    /// Karten aus den `==Markierungen==` und Lücken einer Seite; Zeilen mit schon vorhandenen
    /// Karten werden übersprungen. Liefert die Zahl neuer Karten.
    pub fn cards_from_highlights(&self, page_id: String, deck: Option<String>) -> Result<u32, CoreError> {
        let deck = deck.filter(|d| !d.trim().is_empty());
        let mut inner = self.lock();
        let content = inner.model.state().pages.get(&page_id).map(|p| p.content().to_owned()).unwrap_or_default();
        let sources = cloze::cloze_sources_from_content(&content);
        let mut n = 0;
        for src in sources {
            if !inner.has_cloze_card(&src) {
                n += inner.create_cloze(&src, deck.as_deref(), Some(&page_id))?;
            }
        }
        Ok(n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn karten_aus_markierungen() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let p = core.create_page("Geo".into(), "- ==Paris== ist schön\nnichts\n".into(), None, None).unwrap();
        assert_eq!(core.cards_from_highlights(p.clone(), Some("Erdkunde".into())).unwrap(), 1);
        assert_eq!(core.cards_from_highlights(p, None).unwrap(), 0);
        let cards = core.cards_in_deck("Erdkunde".into());
        assert_eq!(cards[0].front, "**[…]** ist schön");
        assert_eq!(core.create_cloze_cards("{{c1::a}} {{c2::b}}".into(), None, None).unwrap(), 2);
    }

    #[test]
    fn ffi_wrap_und_recall() {
        let w = wrap_cloze("Paris ist die Hauptstadt".into(), 0, 5);
        assert_eq!(w.text, "{{c1::Paris}} ist die Hauptstadt");
        assert_eq!(w.cursor, 13);

        let r = cloze_recall("{{c1::Paris}} ist die Hauptstadt von {{c2::Frankreich}}.".into()).unwrap();
        assert_eq!(r.question, "＿＿＿ ist die Hauptstadt von ＿＿＿.");
        assert_eq!(r.answers, ["Paris", "Frankreich"]);
        assert!(cloze_recall("Keine Lücke".into()).is_none());
    }
}
