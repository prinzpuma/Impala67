//! Text-Helfer mit JS-Semantik: Längen und Ausschnitte zählen wie `String.length`/`slice`
//! in UTF-16-Einheiten, Leerraum wie `\s`/`trim()`, Wortzeichen wie `\p{L}`/`\p{N}`.
//! Nur so passen Chunk-Grenzen, Schwellen („ab 3 Zeichen“) und Ausschnitte zum JS-Original.

use unicode_properties::{GeneralCategoryGroup, UnicodeGeneralCategory};

/// Länge wie `String.length` (UTF-16-Einheiten).
pub fn utf16_len(s: &str) -> usize {
    s.chars().map(char::len_utf16).sum()
}

/// Leerraum wie JS `\s` bzw. `trim()` (anders als Rust: mit U+FEFF, ohne U+0085).
pub fn is_js_space(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2028}' | '\u{2029}')
        || matches!(c, '\u{2000}'..='\u{200a}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

pub fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_space)
}

/// `\p{L}` oder `\p{N}`.
pub fn is_word_char(c: char) -> bool {
    if c.is_ascii() {
        return c.is_ascii_alphanumeric();
    }
    matches!(c.general_category_group(), GeneralCategoryGroup::Letter | GeneralCategoryGroup::Number)
}

/// Byte-Position zur UTF-16-Position `at`; liegt `at` mitten in einem Ersatzpaar, gilt
/// `round_up` (true: hinter dem Zeichen, false: davor). Über das Ende hinaus: `s.len()`.
fn byte_at(s: &str, at: usize, round_up: bool) -> usize {
    let mut units = 0;
    for (i, c) in s.char_indices() {
        if units >= at {
            return i;
        }
        units += c.len_utf16();
        if units > at {
            return if round_up { i + c.len_utf8() } else { i };
        }
    }
    s.len()
}

/// Ausschnitt wie `s.slice(start, end)` in UTF-16-Einheiten. Abweichung: Ein halbes
/// Ersatzpaar am Rand (JS liefert dort ein einzelnes Surrogat) fällt weg.
pub fn slice_utf16(s: &str, start: usize, end: usize) -> &str {
    if start >= end {
        return "";
    }
    let a = byte_at(s, start, true);
    let b = byte_at(s, end, false);
    if a >= b { "" } else { &s[a..b] }
}

/// Die letzten `n` UTF-16-Einheiten wie `s.slice(-n)` (ganzes `s`, wenn kürzer).
pub fn tail_utf16(s: &str, n: usize) -> &str {
    let len = utf16_len(s);
    slice_utf16(s, len.saturating_sub(n), len)
}

/// Schneller, nicht kryptographischer Hasher (FxHash) für die internen Wort-Tabellen.
#[derive(Default, Clone, Copy)]
pub struct Fx(u64);

impl std::hash::Hasher for Fx {
    fn write(&mut self, bytes: &[u8]) {
        let mut chunks = bytes.chunks_exact(8);
        for c in &mut chunks {
            self.write_u64(u64::from_le_bytes([c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]]));
        }
        let rest = chunks.remainder();
        if !rest.is_empty() {
            let mut w = [0u8; 8];
            w[..rest.len()].copy_from_slice(rest);
            self.write_u64(u64::from_le_bytes(w));
        }
    }
    fn write_u8(&mut self, b: u8) {
        self.write_u64(b.into());
    }
    fn write_u32(&mut self, n: u32) {
        self.write_u64(n.into());
    }
    fn write_u64(&mut self, word: u64) {
        self.0 = (self.0.rotate_left(5) ^ word).wrapping_mul(0x517c_c1b7_2722_0a95);
    }
    fn write_usize(&mut self, n: usize) {
        self.write_u64(n as u64);
    }
    fn finish(&self) -> u64 {
        self.0
    }
}

pub type FxMap<K, V> = std::collections::HashMap<K, V, std::hash::BuildHasherDefault<Fx>>;
pub type FxSet<K> = std::collections::HashSet<K, std::hash::BuildHasherDefault<Fx>>;

/// UTF-16-Position (wie `indexOf`) zur Byte-Position `byte` in `s`.
pub fn utf16_pos(s: &str, byte: usize) -> usize {
    utf16_len(&s[..byte.min(s.len())])
}

/// Kleinschreibung wie `toLowerCase()`/`toLocaleLowerCase("de-DE")`.
pub fn lower(s: &str) -> String {
    s.to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf16_slices() {
        let s = "a😀b";
        assert_eq!(utf16_len(s), 4);
        assert_eq!(slice_utf16(s, 0, 2), "a"); // halbes Paar am Ende fällt weg
        assert_eq!(slice_utf16(s, 2, 4), "b"); // halbes Paar am Anfang fällt weg
        assert_eq!(slice_utf16(s, 1, 3), "😀");
        assert_eq!(tail_utf16("abc", 10), "abc");
        assert_eq!(tail_utf16("abc", 2), "bc");
        assert_eq!(utf16_pos(s, s.find('b').unwrap()), 3);
    }

    #[test]
    fn js_spaces() {
        assert_eq!(js_trim("\u{feff} x \u{3000}"), "x");
        assert_eq!(js_trim("\u{85}x"), "\u{85}x");
        assert!(is_word_char('ß') && is_word_char('٣') && !is_word_char('_'));
    }
}
