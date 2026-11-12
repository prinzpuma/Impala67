//! Textregeln wie in `web/fach.js`: Bereinigen, Wortgrenzen-Treffer und Sammelseiten-Titel.
//!
//! Ohne die Unicode-Tabellen der `regex`-Bibliothek (WASM-Größe, siehe `impala-ai`): Wortgrenze ist
//! hier „kein Buchstabe und keine Ziffer“ nach `char::is_alphanumeric`. Abweichung von `\p{L}\p{N}`
//! der PWA nur bei seltenen kombinierenden Zeichen (`Other_Alphabetic`), die als Buchstabe zählen.

/// Länge, auf die Titel, Tags und Stapelnamen gekürzt werden (UTF-16-Einheiten wie `slice`).
const MAX_LEN: usize = 80;

/// `\s` in JavaScript (Leerraum und Zeilenenden).
pub(crate) fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}'
    )
}

pub(crate) fn is_word(c: char) -> bool {
    c.is_alphanumeric()
}

/// Erste `n` UTF-16-Einheiten (wie `String.prototype.slice(0, n)`); ein halbiertes Zeichen fällt weg.
pub(crate) fn utf16_prefix(s: &str, n: usize) -> &str {
    let mut units = 0;
    for (i, c) in s.char_indices() {
        units += c.len_utf16();
        if units > n {
            return &s[..i];
        }
    }
    s
}

/// `sanitize`: Steuerzeichen und Leerraum zu einem Leerzeichen, getrimmt, auf 80 Einheiten gekürzt.
pub fn sanitize(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut space = false;
    for c in value.chars() {
        if c <= '\u{1F}' || is_js_space(c) {
            space = true;
        } else {
            if space && !out.is_empty() {
                out.push(' ');
            }
            space = false;
            out.push(c);
        }
    }
    utf16_prefix(&out, MAX_LEN).to_owned()
}

/// Gleich ohne Groß-/Kleinschreibung (Kleinbuchstabe je Zeichen, wie das `i`-Flag mit `u`).
fn same(a: char, b: char) -> bool {
    a == b || fold(a) == fold(b)
}

fn fold(c: char) -> char {
    let mut lower = c.to_lowercase();
    match (lower.next(), lower.next()) {
        (Some(l), None) => l,
        _ => c,
    }
}

/// Beginnt `text[at..]` mit `term` (ohne Groß-/Kleinschreibung)? Liefert das Ende.
fn starts_with_at(text: &[char], at: usize, term: &[char]) -> Option<usize> {
    let end = at + term.len();
    (end <= text.len() && text[at..end].iter().zip(term).all(|(&a, &b)| same(a, b))).then_some(end)
}

/// Begriffe eines Fachs, längste zuerst (wie `buildBoundaryRegex`).
pub(crate) struct Terms(Vec<Vec<char>>);

impl Terms {
    pub(crate) fn new<'a>(terms: impl IntoIterator<Item = &'a String>) -> Option<Terms> {
        let mut list: Vec<&String> = terms.into_iter().collect();
        if list.is_empty() {
            return None;
        }
        // Stabil absteigend nach UTF-16-Länge wie `sort((a, b) => b.length - a.length)`.
        list.sort_by_key(|t| std::cmp::Reverse(t.encode_utf16().count()));
        Some(Terms(list.into_iter().map(|t| t.chars().collect()).collect()))
    }

    /// Anzahl der Treffer wie `text.match(regex).length` für
    /// `(?:^|[^\p{L}\p{N}])(?:t1|t2…)(?=$|[^\p{L}\p{N}])` mit `giu`.
    pub(crate) fn count(&self, text: &[char]) -> usize {
        let mut count = 0;
        let mut i = 0;
        while i < text.len() {
            let hit = (i == 0).then(|| self.at(text, 0)).flatten().or_else(|| {
                // Das Trennzeichen gehört zum Treffer und steht hinter dem vorigen.
                (!is_word(text[i])).then(|| self.at(text, i + 1)).flatten()
            });
            match hit {
                Some(end) => {
                    count += 1;
                    i = end;
                }
                None => i += 1,
            }
        }
        count
    }

    /// Erster Begriff ab `at`, hinter dem eine Wortgrenze steht (wie das Zurückgehen der Alternative).
    fn at(&self, text: &[char], at: usize) -> Option<usize> {
        self.0.iter().filter_map(|t| starts_with_at(text, at, t)).find(|&end| end == text.len() || !is_word(text[end]))
    }
}

/// Wörter, an denen eine Sammelseite zu erkennen ist (`OVERVIEW_TITLE`).
const OVERVIEW_WORDS: [&str; 12] = [
    "semester",
    "wintersemester",
    "sommersemester",
    "übersicht",
    "uebersicht",
    "overview",
    "dashboard",
    "stundenplan",
    "studienplan",
    "klausurplan",
    "lernplan",
    "inhaltsverzeichnis",
];

/// `OVERVIEW_TITLE.test(...)`: vorn nur Zeichen ohne Buchstabe/Ziffer, dann ein Wort, dahinter
/// Ende oder kein Buchstabe („Semester3“ zählt).
pub(crate) fn overview_word(title: &[char]) -> bool {
    let start = title.iter().position(|&c| is_word(c)).unwrap_or(title.len());
    OVERVIEW_WORDS.iter().any(|w| {
        let w: Vec<char> = w.chars().collect();
        starts_with_at(title, start, &w).is_some_and(|end| end == title.len() || !title[end].is_alphabetic())
    })
}

/// `/^(?:fach|fachbereich|subject)\s*:\s*(.+)$/i` auf einem bereinigten Tag: der Teil hinter dem Doppelpunkt.
pub(crate) fn tag_value(tag: &str) -> Option<String> {
    let chars: Vec<char> = tag.chars().collect();
    ["fach", "fachbereich", "subject"].iter().find_map(|p| {
        let p: Vec<char> = p.chars().collect();
        let mut i = starts_with_at(&chars, 0, &p)?;
        while i < chars.len() && is_js_space(chars[i]) {
            i += 1;
        }
        if chars.get(i) != Some(&':') {
            return None;
        }
        let after = i + 1;
        let mut j = after;
        while j < chars.len() && is_js_space(chars[j]) {
            j += 1;
        }
        // `\s*` gibt notfalls ein Leerzeichen an `(.+)` zurück.
        let from = if j == chars.len() && j > after { j - 1 } else { j };
        (from < chars.len()).then(|| chars[from..].iter().collect())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn terms(list: &[&str]) -> Terms {
        let owned: Vec<String> = list.iter().map(|s| s.to_string()).collect();
        Terms::new(&owned).unwrap()
    }

    fn chars(s: &str) -> Vec<char> {
        s.chars().collect()
    }

    #[test]
    fn treffer_nur_an_wortgrenzen() {
        let t = terms(&["info", "informatik"]);
        assert_eq!(t.count(&chars("Informatik und info")), 2);
        assert_eq!(t.count(&chars("infos")), 0);
        assert_eq!(t.count(&chars("mathe,mathe mathe")), 0);
        let m = terms(&["mathe"]);
        assert_eq!(m.count(&chars("mathe,mathe mathe")), 3);
        assert_eq!(m.count(&chars("Mathematik")), 0);
    }

    #[test]
    fn bereinigen_wie_js() {
        assert_eq!(sanitize("  a\u{0}\u{1}b \t c  "), "a b c");
        assert_eq!(sanitize(&"x".repeat(100)).len(), 80);
    }

    #[test]
    fn sammelseiten_und_tags() {
        assert!(overview_word(&chars("— Semester 3")));
        assert!(overview_word(&chars("Semester3")));
        assert!(!overview_word(&chars("Semesterplanung")));
        assert_eq!(tag_value("Fach: Mathe").as_deref(), Some("Mathe"));
        assert_eq!(tag_value("fachbereich :Physik").as_deref(), Some("Physik"));
        assert_eq!(tag_value("fach"), None);
    }
}
