//! Lückentext-Karten (Cloze) wie in der PWA (`web/extras.js`): `{{c1::Antwort::Hinweis}}`; je
//! Lücken-Nummer eine eigene Karte. Aus `==Markierungen==` einer Seite werden Lücken.

use serde_json::json;

use crate::{CoreError, ImpalaCore, Inner};

/// Eine Lücke `{{cN::Antwort(::Hinweis)?}}` mit Byte-Bereich im Text.
struct Gap<'a> {
    start: usize,
    end: usize,
    n: u32,
    answer: &'a str,
    hint: Option<&'a str>,
}

/// Wie `/\{\{c(\d+)::([\s\S]*?)(?:::([^{}]*?))?\}\}/g`.
fn gaps(text: &str) -> Vec<Gap<'_>> {
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(rel) = text[from..].find("{{c") {
        let start = from + rel;
        if let Some(gap) = gap_at(text, start) {
            from = gap.end;
            out.push(gap);
        } else {
            from = start + 1;
        }
    }
    out
}

fn gap_at(text: &str, start: usize) -> Option<Gap<'_>> {
    let rest = &text[start + 3..];
    let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
    let n: u32 = rest[..digits].parse().ok()?;
    let body_start = start + 3 + digits;
    if !text[body_start..].starts_with("::") {
        return None;
    }
    let body_start = body_start + 2;
    // Kürzeste Antwort, nach der `::Hinweis}}` oder `}}` folgt.
    for (k, _) in text[body_start..].char_indices() {
        let at = body_start + k;
        let tail = &text[at..];
        if let Some(h) = tail.strip_prefix("::") {
            let len = h.find(['{', '}']).unwrap_or(h.len());
            if h[len..].starts_with("}}") {
                let hint = &h[..len];
                return Some(Gap { start, end: at + 2 + len + 2, n, answer: &text[body_start..at], hint: Some(hint) });
            }
        }
        if tail.starts_with("}}") {
            return Some(Gap { start, end: at + 2, n, answer: &text[body_start..at], hint: None });
        }
    }
    None
}

fn replace_gaps(text: &str, f: impl Fn(&Gap) -> String) -> String {
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    for g in gaps(text) {
        out.push_str(&text[last..g.start]);
        out.push_str(&f(&g));
        last = g.end;
    }
    out.push_str(&text[last..]);
    out
}

/// Lücken-Nummern, aufsteigend und ohne Doppelte.
fn indexes(text: &str) -> Vec<u32> {
    let mut v: Vec<u32> = gaps(text).iter().map(|g| g.n).collect();
    v.sort_unstable();
    v.dedup();
    v
}

fn front(text: &str, idx: u32) -> String {
    replace_gaps(text, |g| {
        if g.n != idx {
            return g.answer.to_owned();
        }
        match g.hint.filter(|h| !h.is_empty()) {
            Some(h) => format!("**[…{h}…]**"),
            None => "**[…]**".to_owned(),
        }
    })
}

fn back(text: &str, idx: u32) -> String {
    replace_gaps(text, |g| if g.n == idx { format!("**=={}==**", g.answer) } else { g.answer.to_owned() })
}

/// `==Markierung==` → `{{cN::Markierung}}`; `None`, wenn die Zeile keine hat.
fn highlights_to_cloze(line: &str) -> Option<String> {
    let mut out = String::new();
    let mut rest = line;
    let mut i = 0;
    while let Some(a) = rest.find("==") {
        let after = &rest[a + 2..];
        let len = after.find(['=', '\n']).unwrap_or(after.len());
        if len > 0 && after[len..].starts_with("==") {
            i += 1;
            out.push_str(&rest[..a]);
            out.push_str(&format!("{{{{c{i}::{}}}}}", &after[..len]));
            rest = &after[len + 2..];
        } else {
            out.push_str(&rest[..a + 1]);
            rest = &rest[a + 1..];
        }
    }
    out.push_str(rest);
    (i > 0).then_some(out)
}

/// Zeilenanfang ohne Listen-/Zitat-/Überschriftzeichen und Checkbox (`^[\s>#*-]*(\[[ x]\]\s*)?`).
fn strip_line_prefix(line: &str) -> &str {
    let s = line.trim_start_matches(|c: char| c.is_whitespace() || matches!(c, '>' | '#' | '*' | '-'));
    let s = s.strip_prefix("[ ]").or_else(|| s.strip_prefix("[x]")).map_or(s, str::trim_start);
    s.trim()
}

impl Inner {
    fn create_cloze(&mut self, text: &str, deck: Option<&str>, page_id: Option<&str>) -> Result<u32, CoreError> {
        let idxs = indexes(text);
        if let Some(d) = deck {
            self.ensure_deck(d)?;
        }
        for &i in &idxs {
            let id = uuid::Uuid::new_v4().to_string();
            self.dispatch(
                "cardCreate",
                json!({
                    "id": id, "front": front(text, i), "back": back(text, i), "pageId": page_id, "deck": deck,
                    "type": "cloze", "cloze": { "src": text, "index": i },
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
        let mut n = 0;
        for line in content.split('\n') {
            let plain = strip_line_prefix(line);
            if plain.is_empty() {
                continue;
            }
            let src = if gaps(plain).is_empty() {
                match highlights_to_cloze(plain) {
                    Some(src) => src,
                    None => continue,
                }
            } else {
                plain.to_owned()
            };
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
    fn luecken_wie_die_pwa() {
        let t = "{{c1::Paris::Stadt}} ist die Hauptstadt von {{c2::Frankreich}}.";
        assert_eq!(indexes(t), [1, 2]);
        assert_eq!(front(t, 1), "**[…Stadt…]** ist die Hauptstadt von Frankreich.");
        assert_eq!(back(t, 2), "Paris ist die Hauptstadt von **==Frankreich==**.");
        assert_eq!(highlights_to_cloze("a ==b== c ==d=="), Some("a {{c1::b}} c {{c2::d}}".into()));
        assert_eq!(highlights_to_cloze("a == b"), None);
        assert_eq!(strip_line_prefix("  - [x] Text "), "Text");
    }

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
}
