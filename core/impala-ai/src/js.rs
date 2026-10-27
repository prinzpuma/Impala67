//! Kleine Helfer, die JS-Semantik dort nachbilden, wo sie sichtbar wird: Längen und
//! Schnitte in UTF-16-Einheiten (Prompt-Grenzen), `trim()`, Wahrheitswerte und
//! Zeichenketten-Umwandlung loser JSON-Werte aus Anbieter-Antworten.

use serde_json::Value;

/// Länge in UTF-16-Einheiten (`String.prototype.length`).
pub fn len16(s: &str) -> usize {
    s.chars().map(char::len_utf16).sum()
}

/// Byte-Index zur UTF-16-Position `pos` (abgerundet auf eine Zeichengrenze).
fn byte_at16(s: &str, pos: usize) -> usize {
    let mut units = 0;
    for (i, c) in s.char_indices() {
        if units + c.len_utf16() > pos {
            return i;
        }
        units += c.len_utf16();
    }
    s.len()
}

/// `s.slice(0, n)` in UTF-16-Einheiten. Abweichung: JS kann ein Ersatzzeichen-Paar
/// halbieren (einsames Surrogat); Rust schneidet vor dem ganzen Zeichen.
pub fn head16(s: &str, n: usize) -> &str {
    &s[..byte_at16(s, n)]
}

/// `s.slice(-n)` in UTF-16-Einheiten (gleiche Abweichung wie [`head16`]).
pub fn tail16(s: &str, n: usize) -> &str {
    let total = len16(s);
    if n >= total {
        return s;
    }
    let start = byte_at16(s, total - n);
    // Abgerundet läge der Schnitt mitten im Paar – dann das Zeichen weglassen.
    if len16(&s[start..]) > n { &s[start + s[start..].chars().next().map_or(0, char::len_utf8)..] } else { &s[start..] }
}

/// Leerraum im Sinn von JS (`\s`, `trim()`): Unicode-Leerzeichen plus BOM, ohne U+0085.
pub fn is_ws(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}'
    )
}

/// Zeichenklasse für Regex-Muster, die JS-`\s` entspricht.
pub const WS_CLASS: &str =
    r"[\t\n\x0B\x0C\r \u{A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}]";

pub fn trim(s: &str) -> &str {
    s.trim_matches(is_ws)
}

/// JS-Wahrheitswert eines JSON-Werts.
pub fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// `String(v)` für JSON-Werte (Objekte wie in JS als `[object Object]`).
pub fn string(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => number(n),
        Value::String(s) => s.clone(),
        Value::Array(a) => {
            a.iter().map(|x| if x.is_null() { String::new() } else { string(x) }).collect::<Vec<_>>().join(",")
        }
        Value::Object(_) => "[object Object]".into(),
    }
}

/// Zahl wie `String(n)` für die üblichen Fälle (ganze Zahlen ohne `.0`).
fn number(n: &serde_json::Number) -> String {
    match n.as_f64() {
        Some(f) if f.fract() == 0.0 && f.abs() < 1e21 => format!("{f:.0}"),
        _ => n.to_string(),
    }
}

/// Erster wahrer Wert aus `a || b || …` als Text, sonst "".
pub fn first_truthy<'a>(values: impl IntoIterator<Item = Option<&'a Value>>) -> String {
    values.into_iter().flatten().find(|v| truthy(v)).map(string).unwrap_or_default()
}

/// Text eines Felds, falls es ein nicht leerer String ist.
pub fn non_empty_str(v: Option<&Value>) -> Option<&str> {
    v.and_then(Value::as_str).filter(|s| !s.is_empty())
}

/// `encodeURIComponent`.
pub fn encode_uri_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// JSON-Objekt mit fester Schlüsselreihenfolge wie `JSON.stringify({…})` in JS.
/// (serde_json sortiert Schlüssel; die Reihenfolge landet aber wörtlich im Prompt.)
pub fn object(fields: &[(&str, Value)]) -> String {
    let body: Vec<String> = fields
        .iter()
        .map(|(k, v)| format!("{}:{}", Value::from(*k), serde_json::to_string(v).unwrap_or_default()))
        .collect();
    format!("{{{}}}", body.join(","))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf16_schnitte() {
        assert_eq!(len16("a😀b"), 4);
        assert_eq!(head16("a😀b", 2), "a");
        assert_eq!(head16("a😀b", 3), "a😀");
        assert_eq!(tail16("a😀b", 2), "b");
        assert_eq!(tail16("a😀b", 3), "😀b");
        assert_eq!(tail16("ab", 5), "ab");
    }

    #[test]
    fn trim_wie_js() {
        assert_eq!(trim("\u{FEFF} x \u{A0}"), "x");
        assert_eq!(trim("\u{85}x"), "\u{85}x");
    }

    #[test]
    fn werte_wie_js() {
        assert_eq!(string(&serde_json::json!(5.0)), "5");
        assert_eq!(string(&serde_json::json!({"a": 1})), "[object Object]");
        assert!(!truthy(&serde_json::json!(0)));
        assert_eq!(encode_uri_component("a b/ä"), "a%20b%2F%C3%A4");
        assert_eq!(object(&[("b", Value::from(1)), ("a", Value::from("x"))]), r#"{"b":1,"a":"x"}"#);
    }
}
