//! Kleine Textmuster ohne Regex-Engine: Wortlisten mit JS-Wortgrenzen (`\b`, nur ASCII),
//! Literale und Präfixe. Die Muster des Moduls sind alle von dieser Art; die `regex`-Crate
//! kostete die PWA rund 200 KB WASM.

use crate::js;

/// Wortzeichen wie JS `\w` (nur ASCII).
fn is_word(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

/// Wortgrenze (`\b`) vor dem Byte `at`.
fn boundary(text: &str, at: usize) -> bool {
    let b = text.as_bytes();
    let before = at > 0 && is_word(b[at - 1]);
    let after = at < b.len() && is_word(b[at]);
    before != after
}

/// Wie `/\b(…)\b/.test(text)`: `at(rest, ends)` prüft an jeder Wortgrenze, ob ein Treffer
/// beginnt; `ends(n)` sagt, ob nach `n` Bytes wieder eine Wortgrenze steht.
pub fn word_match(text: &str, at: impl Fn(&str, &dyn Fn(usize) -> bool) -> bool) -> bool {
    (0..text.len()).filter(|&i| text.is_char_boundary(i) && boundary(text, i)).any(|i| {
        let ends = |n: usize| boundary(text, i + n);
        at(&text[i..], &ends)
    })
}

/// `\b(a|b|…)\b` für feste Wörter.
pub fn has_word(text: &str, words: &[&str]) -> bool {
    word_match(text, |rest, ends| words.iter().any(|w| rest.starts_with(w) && ends(w.len())))
}

/// Kommt `lit` irgendwo vor, sodass `ok(rest)` für den Text dahinter gilt?
pub fn has_followed(text: &str, lit: &str, ok: impl Fn(&str) -> bool) -> bool {
    text.match_indices(lit).any(|(i, _)| ok(&text[i + lit.len()..]))
}

/// Wortgrenze am Anfang von `rest`, wenn davor ein Wortzeichen stand (`…\b`).
pub fn at_word_end(rest: &str) -> bool {
    !rest.bytes().next().is_some_and(is_word)
}

/// Text beginnt (ohne Rücksicht auf ASCII-Groß/Kleinschreibung) mit `prefix`: Rest danach.
pub fn strip_prefix_ci<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    let head = text.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix).then(|| &text[prefix.len()..])
}

/// Führenden JS-Leerraum (`\s*`) überspringen.
pub fn skip_ws(text: &str) -> &str {
    text.trim_start_matches(js::is_ws)
}

/// Alle Vorkommen ersetzen; `at(rest)` liefert die Länge eines Treffers am Anfang von `rest`.
/// `None`, wenn nichts passte (dann bleibt der Text, wie er ist).
pub fn replace_all(text: &str, first: char, at: impl Fn(&str) -> Option<usize>, with: &str) -> Option<String> {
    let mut out = String::new();
    let mut done = 0;
    let mut from = 0;
    while let Some(rel) = text[from..].find(first) {
        let i = from + rel;
        match at(&text[i..]) {
            Some(n) => {
                out.push_str(&text[done..i]);
                out.push_str(with);
                done = i + n;
                from = done;
            }
            None => from = i + first.len_utf8(),
        }
    }
    (done > 0).then(|| {
        out.push_str(&text[done..]);
        out
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wortgrenzen_wie_js() {
        assert!(has_word("ask gemini now", &["gemini"]));
        assert!(!has_word("geminis", &["gemini"]));
        assert!(has_word("x-gemini_", &["gemini_"]));
        assert!(has_word("ügemini", &["gemini"]), "Nicht-ASCII ist kein Wortzeichen");
        assert!(!has_word("", &["a"]));
        assert!(has_followed("a/api/ai", "/api/ai", at_word_end));
        assert!(!has_followed("a/api/aix", "/api/ai", at_word_end));
    }

    #[test]
    fn ersetzen() {
        let br = |r: &str| {
            let r2 = skip_ws(strip_prefix_ci(r, "<br")?);
            let r2 = r2.strip_prefix('/').unwrap_or(r2);
            r2.starts_with('>').then(|| r.len() - r2.len() + 1)
        };
        assert_eq!(replace_all("a<BR />b<br>c<bx>", '<', br, "\n").as_deref(), Some("a\nb\nc<bx>"));
        assert_eq!(replace_all("abc", '<', br, "\n"), None);
    }
}
