//! Kleine Helfer, die JS-Semantik exakt nachbilden (Regex-`\s`, `trim()`, `.`, `\b`, UTF-16-Längen).
//! Der Parser ist von Hand geschrieben; damit er sich wie die JS-Regexe verhält, gelten hier
//! deren Zeichenklassen statt der Rust-Standarddefinitionen (`char::is_whitespace` kennt z. B.
//! U+0085, aber nicht U+FEFF – JS genau umgekehrt).

/// JS-Leerraum (`\s` bzw. `String.prototype.trim`): WhiteSpace + LineTerminator.
pub(crate) fn is_ws(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}'
    )
}

/// Zeilenende im Sinne von JS-`.` (ohne `s`-Flag): `.` passt auf alles außer diesen Zeichen.
pub(crate) fn is_lt(c: char) -> bool {
    matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// `(.*)$` passt nur, wenn der Rest kein Zeilenende enthält.
pub(crate) fn no_lt(s: &str) -> bool {
    !s.chars().any(is_lt)
}

pub(crate) fn trim(s: &str) -> &str {
    s.trim_matches(is_ws)
}

pub(crate) fn trim_start(s: &str) -> &str {
    s.trim_start_matches(is_ws)
}

/// Wortzeichen für `\b` (ohne `u`-Flag: nur ASCII).
pub(crate) fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// `^prefix\b`: Präfix (optional ohne Groß-/Kleinschreibung, nur ASCII wie JS ohne `u`) und
/// danach Wortgrenze. Liefert den Rest.
pub(crate) fn prefix_word<'a>(s: &'a str, prefix: &str, ci: bool) -> Option<&'a str> {
    let rest = strip_prefix_ci(s, prefix, ci)?;
    // prefix endet mit einem Wortzeichen ⇒ \b verlangt danach ein Nicht-Wortzeichen oder Ende
    match rest.chars().next() {
        Some(c) if is_word(c) => None,
        _ => Some(rest),
    }
}

pub(crate) fn strip_prefix_ci<'a>(s: &'a str, prefix: &str, ci: bool) -> Option<&'a str> {
    if !ci {
        return s.strip_prefix(prefix);
    }
    let head = s.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix).then(|| &s[prefix.len()..])
}

/// Erstes Vorkommen von `needle` (ASCII, ohne Groß-/Kleinschreibung) ab Byte `from`.
pub(crate) fn find_ci(s: &str, needle: &str, from: usize) -> Option<usize> {
    let hay = s.as_bytes();
    let n = needle.as_bytes();
    if n.is_empty() || hay.len() < n.len() {
        return None;
    }
    (from..=hay.len() - n.len()).find(|&i| hay[i..i + n.len()].eq_ignore_ascii_case(n))
}

/// Führende ASCII-Ziffern (`\d+`), liefert den Rest, wenn mindestens eine da war.
pub(crate) fn strip_digits(s: &str) -> Option<&str> {
    let rest = s.trim_start_matches(|c: char| c.is_ascii_digit());
    (rest.len() < s.len()).then_some(rest)
}

/// Länge in UTF-16-Einheiten (JS `.length`).
pub(crate) fn len16(s: &str) -> usize {
    s.chars().map(char::len_utf16).sum()
}

/// JS `.slice(0, n)` in UTF-16-Einheiten. Abweichung: ein Ersatzzeichenpaar, das genau an der
/// Grenze zerschnitten würde, fällt ganz weg (Rust-Strings können keine halben Paare halten).
pub(crate) fn head16(s: &str, n: usize) -> &str {
    let mut units = 0;
    for (i, c) in s.char_indices() {
        units += c.len_utf16();
        if units > n {
            return &s[..i];
        }
    }
    s
}

/// `.replace(/\s+/g, " ")`
pub(crate) fn collapse_ws(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_ws = false;
    for c in s.chars() {
        if is_ws(c) {
            if !in_ws {
                out.push(' ');
            }
            in_ws = true;
        } else {
            out.push(c);
            in_ws = false;
        }
    }
    out
}
