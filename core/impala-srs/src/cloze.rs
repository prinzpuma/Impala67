//! Lückentext-Karten (Cloze): `{{c1::Antwort::Hinweis}}`. Pro Lücken-Nummer entsteht
//! eine eigene Karte (Geschwisterkarten). Aus `==Markierungen==` werden Lücken.

use impala_sort::SortExt;
use serde::{Deserialize, Serialize};

/// Eine Lücke `{{cN::Antwort(::Hinweis)?}}` mit Byte-Bereich im Text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Gap<'a> {
    pub start: usize,
    pub end: usize,
    pub n: u32,
    pub answer: &'a str,
    pub hint: Option<&'a str>,
}

/// Ergebnis von [`wrap_cloze`]: geänderter Text und Schreibmarkenposition (UTF-16-Offset).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClozeWrap {
    pub text: String,
    pub cursor: u32,
}

/// Frage (mit „＿＿＿“ maskiert) und Roh-Antworten für die Tageskarten-Vorschau (Recall).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClozeRecall {
    pub question: String,
    pub answers: Vec<String>,
}

/// Findet alle Lücken `{{c(\d+)::…}}` im Text.
pub fn gaps(text: &str) -> Vec<Gap<'_>> {
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

/// Prüft, ob der Text mindestens eine gültige Cloze-Lücke enthält.
pub fn has_cloze(text: &str) -> bool {
    let mut from = 0;
    while let Some(rel) = text[from..].find("{{c") {
        let start = from + rel;
        if gap_at(text, start).is_some() {
            return true;
        }
        from = start + 1;
    }
    false
}

pub fn replace_gaps(text: &str, f: impl Fn(&Gap) -> String) -> String {
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
pub fn indexes(text: &str) -> Vec<u32> {
    let mut v: Vec<u32> = gaps(text).iter().map(|g| g.n).collect();
    v.sort_small();
    v.dedup();
    v
}

/// Nächste freie Lücken-Nummer (größte vorhandene + 1, oder 1).
pub fn next_cloze_index(text: &str) -> u32 {
    indexes(text).last().copied().unwrap_or(0) + 1
}

/// Vorderseite für Karte `idx`: Lücke `idx` wird durch `**[…Hinweis…]**` bzw. `**[…]**`
/// ersetzt, andere Lücken zeigen ihre unmaskierte Antwort.
pub fn front(text: &str, idx: u32) -> String {
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

/// Rückseite für Karte `idx`: Lücke `idx` wird durch `**==Antwort==**` hervorgehoben,
/// andere Lücken zeigen ihre unmaskierte Antwort.
pub fn back(text: &str, idx: u32) -> String {
    replace_gaps(text, |g| if g.n == idx { format!("**=={}==**", g.answer) } else { g.answer.to_owned() })
}

/// Markierten Text in `{{cN::…}}` setzen (N = nächste freie Nummer); ohne Markierung eine
/// leere Lücke an der Schreibmarke. Positionen als UTF-16-Code-Units (JS / Kotlin / Swift).
pub fn wrap_cloze(text: &str, u16_start: u32, u16_end: u32) -> ClozeWrap {
    let u16_len = text.encode_utf16().count() as u32;
    let s = u16_start.min(u16_end).min(u16_len);
    let e = u16_start.max(u16_end).min(u16_len);

    let (b_start, u16_start_snapped) = utf16_to_byte_offset(text, s as usize);
    let (b_end, _u16_end_snapped) = utf16_to_byte_offset(text, e as usize);

    let picked = &text[b_start..b_end];
    let next = next_cloze_index(text);
    let open = format!("{{{{c{next}::");
    let close = "}}";

    let mut out = String::with_capacity(text.len() + open.len() + close.len());
    out.push_str(&text[..b_start]);
    out.push_str(&open);
    out.push_str(picked);
    out.push_str(close);
    out.push_str(&text[b_end..]);

    let open_u16 = open.encode_utf16().count() as u32;
    let cursor = if picked.is_empty() {
        u16_start_snapped + open_u16
    } else {
        u16_start_snapped + open_u16 + picked.encode_utf16().count() as u32 + close.encode_utf16().count() as u32
    };

    ClozeWrap { text: out, cursor }
}

/// Maskiert alle Lücken mit `＿＿＿` und liefert die Antworten der Reihe nach.
/// Liefert `None`, wenn der Text keine Cloze-Lücke enthält.
pub fn cloze_recall(front: &str) -> Option<ClozeRecall> {
    let g = gaps(front);
    if g.is_empty() {
        return None;
    }
    let question = replace_gaps(front, |_| "＿＿＿".to_owned());
    let answers = g.into_iter().map(|gap| gap.answer.to_owned()).collect();
    Some(ClozeRecall { question, answers })
}

/// Wandelt `==Markierung==` in `{{cN::Markierung}}` um; `None`, wenn die Zeile keine hat.
pub fn highlights_to_cloze(line: &str) -> Option<String> {
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

/// Entfernt führende Listen-/Zitat-/Überschriftzeichen und Checkboxen (`^[\s>#*-]*(\[[ x]\]\s*)?`).
pub fn strip_line_prefix(line: &str) -> &str {
    let s = line.trim_start_matches(|c: char| c.is_whitespace() || matches!(c, '>' | '#' | '*' | '-'));
    let s = s.strip_prefix("[ ]").or_else(|| s.strip_prefix("[x]")).map_or(s, str::trim_start);
    s.trim()
}

/// Findet alle Zeilen eines Seiteninhalts, die als Lückentext taugen (entweder schon explizite
/// Cloze-Lücken oder durch `==Markierungen==`).
pub fn cloze_sources_from_content(content: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in content.split('\n') {
        let plain = strip_line_prefix(line);
        if plain.is_empty() {
            continue;
        }
        if has_cloze(plain) {
            out.push(plain.to_owned());
        } else if let Some(src) = highlights_to_cloze(plain) {
            out.push(src);
        }
    }
    out
}

fn utf16_to_byte_offset(s: &str, u16_offset: usize) -> (usize, u32) {
    let mut u16_cur = 0;
    for (b_pos, ch) in s.char_indices() {
        if u16_cur >= u16_offset {
            return (b_pos, u16_cur as u32);
        }
        u16_cur += ch.len_utf16();
    }
    (s.len(), u16_cur as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn luecken_grundfunktionen() {
        let t = "{{c1::Paris::Stadt}} ist die Hauptstadt von {{c2::Frankreich}}.";
        assert_eq!(indexes(t), [1, 2]);
        assert_eq!(front(t, 1), "**[…Stadt…]** ist die Hauptstadt von Frankreich.");
        assert_eq!(back(t, 2), "Paris ist die Hauptstadt von **==Frankreich==**.");
        assert_eq!(highlights_to_cloze("a ==b== c ==d=="), Some("a {{c1::b}} c {{c2::d}}".into()));
        assert_eq!(highlights_to_cloze("a == b"), None);
        assert_eq!(strip_line_prefix("  - [x] Text "), "Text");
        assert_eq!(next_cloze_index(t), 3);
    }

    #[test]
    fn wrap_cloze_beispiele() {
        let w1 = wrap_cloze("Paris ist die Hauptstadt", 0, 5);
        assert_eq!(w1.text, "{{c1::Paris}} ist die Hauptstadt");
        assert_eq!(w1.cursor, 13); // "{{c1::Paris}}" hat 13 Zeichen

        let w2 = wrap_cloze("Paris ist die Hauptstadt", 0, 0);
        assert_eq!(w2.text, "{{c1::}}Paris ist die Hauptstadt");
        assert_eq!(w2.cursor, 6); // "{{c1::" hat 6 Zeichen
    }

    #[test]
    fn wrap_cloze_surrogat_und_emoji() {
        // '😀' (U+1F603) = 2 UTF-16 code units (index 1 und 2).
        let t = "A😀B";
        // Cursor im Surrogat-Paar (Index 2): wird sauber hinter das Emoji gelegt (Offset 3).
        let w = wrap_cloze(t, 2, 2);
        assert_eq!(w.text, "A😀{{c1::}}B");
        // "A😀" = 3 UTF-16-Units, "{{c1::" = 6 UTF-16-Units -> Cursor muss bei 9 liegen!
        assert_eq!(w.cursor, 9);

        // Emoji markiert (Index 1 bis 3):
        let w_sel = wrap_cloze(t, 1, 3);
        assert_eq!(w_sel.text, "A{{c1::😀}}B");
        // "A" (1) + "{{c1::" (6) + "😀" (2) + "}}" (2) = 11
        assert_eq!(w_sel.cursor, 11);
    }

    #[test]
    fn cloze_recall_beispiel() {
        let r = cloze_recall("{{c1::Paris::Stadt}} ist die Hauptstadt von {{c2::Frankreich}}.").unwrap();
        assert_eq!(r.question, "＿＿＿ ist die Hauptstadt von ＿＿＿.");
        assert_eq!(r.answers, ["Paris", "Frankreich"]);
        assert!(cloze_recall("Keine Lücke").is_none());
    }
}
