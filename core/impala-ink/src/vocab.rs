//! Alphabet des Modells (Ausgabeklassen). Gleiche Reihenfolge wie `web/handwriting-vocab.js` und
//! `handwriting/vocabulary.py`; Index 0 ist das CTC-Blank.

/// Zeichen je Ausgabeklasse; `None` = Blank.
const CHARS: [Option<char>; 101] = {
    const S: &str =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZäöüÄÖÜß0123456789 .,!?-+:/*=()@#%'^_<>{}~√∫∑πλαβ";
    let bytes = S.as_bytes();
    let mut out = [None; 101];
    let (mut i, mut k) = (0, 1);
    // UTF-8 von Hand dekodieren (const fn kennt keine Iteratoren)
    while i < bytes.len() {
        let b = bytes[i] as u32;
        let (code, len) = if b < 0x80 {
            (b, 1)
        } else if b < 0xE0 {
            (((b & 0x1F) << 6) | (bytes[i + 1] as u32 & 0x3F), 2)
        } else {
            (((b & 0x0F) << 12) | ((bytes[i + 1] as u32 & 0x3F) << 6) | (bytes[i + 2] as u32 & 0x3F), 3)
        };
        out[k] = char::from_u32(code);
        k += 1;
        i += len;
    }
    assert!(k == 101);
    out
};

/// Anzahl der Ausgabeklassen des Modells (inkl. Blank).
pub const CLASSES: usize = CHARS.len();
pub const BLANK: usize = 0;
/// Klasse des Leerzeichens.
pub const SPACE: usize = 70;

/// Zeichen einer Klasse (`None` für Blank oder unbekannte Indizes).
pub fn char_of(class: usize) -> Option<char> {
    CHARS.get(class).copied().flatten()
}

/// Klasse eines Zeichens.
pub fn class_of(ch: char) -> Option<usize> {
    CHARS.iter().position(|&c| c == Some(ch))
}

/// Mathe-Sonderzeichen: im Textmodus gesperrt, außerhalb von Formeln entfernt.
pub fn is_math_char(ch: char) -> bool {
    matches!(ch, '^' | '_' | '<' | '>' | '{' | '}' | '~' | '√' | '∫' | '∑' | 'π' | 'λ' | 'α' | 'β' | '\\')
}

/// Satzzeichen, die das Wörterbuch vor und hinter einem Wort zulässt.
pub(crate) fn is_word_punct(ch: char) -> bool {
    matches!(ch, '.' | ',' | ':' | '!' | '?' | '-' | '(' | ')' | '\'')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feste_indizes() {
        assert_eq!(char_of(BLANK), None);
        assert_eq!(char_of(1), Some('a'));
        assert_eq!(char_of(SPACE), Some(' '));
        assert_eq!(char_of(100), Some('β'));
        assert_eq!(char_of(101), None);
        assert_eq!(class_of('ß'), Some(59));
    }
}
