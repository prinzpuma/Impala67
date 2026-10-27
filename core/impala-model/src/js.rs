//! JS-Gleichteile, von denen der gespeicherte Zustand abhängt: Truthiness (`a || b`),
//! `String(x)`, `Number(x)`, `Math.round`, Vergleiche wie `<` und Objektschlüssel.
//! Der Zustand entsteht auf jedem Gerät aus demselben Log – Rust und JS müssen ihn gleich bilden.

use std::cmp::Ordering;

use serde_json::Value;

pub use impala_storage::js::{number, to_string, truthy};

/// JSON-Objekt in Einfügereihenfolge.
pub type Object = serde_json::Map<String, Value>;

/// String-Vergleich wie JS (UTF-16-Codeeinheiten).
pub fn cmp(a: &str, b: &str) -> Ordering {
    impala_storage::js::cmp(a, b)
}

/// `a < b` auf Strings.
pub fn lt(a: &str, b: &str) -> bool {
    cmp(a, b).is_lt()
}

/// `a || b`: der Wert selbst, wenn er „wahr“ ist.
pub fn or(v: Option<&Value>) -> Option<&Value> {
    v.filter(|v| truthy(v))
}

/// `a || null` als gespeicherter Wert.
pub fn or_null(v: Option<&Value>) -> Value {
    or(v).cloned().unwrap_or(Value::Null)
}

/// `a || "text"` als gespeicherter Wert.
pub fn or_str(v: Option<&Value>, default: &str) -> Value {
    or(v).cloned().unwrap_or_else(|| Value::from(default))
}

/// `String(x)`; `undefined` wird zu `"undefined"` (wie bei `S.pages[undefined]`).
pub fn key_of(v: Option<&Value>) -> String {
    v.map_or_else(|| "undefined".to_owned(), to_string)
}

/// `String(x || "")`.
pub fn str_or_empty(v: Option<&Value>) -> String {
    or(v).map(to_string).unwrap_or_default()
}

/// Zahl als JSON-Wert wie `JSON.stringify`: Ganzzahlen ohne `.0`, NaN/Unendlich als `null`.
pub fn num(x: f64) -> Value {
    if !x.is_finite() {
        return Value::Null;
    }
    if x.fract() == 0.0 && x.abs() < 9_007_199_254_740_992.0 {
        return Value::from(x as i64);
    }
    serde_json::Number::from_f64(x).map_or(Value::Null, Value::Number)
}

/// `Number(x)`; `None` (= `undefined`) ergibt NaN.
pub fn to_number(v: Option<&Value>) -> f64 {
    match v {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(b)) => f64::from(u8::from(*b)),
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => string_to_number(s),
        Some(v @ Value::Array(_)) => string_to_number(&to_string(v)),
        Some(Value::Object(_)) => f64::NAN,
    }
}

/// StringToNumber (ECMAScript): Leerraum außen, leer = 0, Dezimal-, Hex-, Oktal-, Binärliterale.
pub fn string_to_number(s: &str) -> f64 {
    let s = trim(s);
    if s.is_empty() {
        return 0.0;
    }
    let radix = |p: &str, r: u32| {
        s.get(2..).filter(|_| s[..2].eq_ignore_ascii_case(p)).map(|d| {
            if d.is_empty() || !d.chars().all(|c| c.is_digit(r)) {
                f64::NAN
            } else {
                d.chars().fold(0.0, |acc, c| acc * f64::from(r) + f64::from(c.to_digit(r).unwrap_or(0)))
            }
        })
    };
    if s.len() > 2 {
        for (p, r) in [("0x", 16), ("0o", 8), ("0b", 2)] {
            if let Some(n) = radix(p, r) {
                return n;
            }
        }
    }
    match s.trim_start_matches(['+', '-']) {
        "Infinity" if s.len() - "Infinity".len() <= 1 => {
            return if s.starts_with('-') { f64::NEG_INFINITY } else { f64::INFINITY };
        }
        _ => {}
    }
    // Rust kennt zusätzlich „inf“/„nan“ – nur echte Dezimalliterale zulassen.
    if !s.bytes().all(|b| b.is_ascii_digit() || matches!(b, b'.' | b'e' | b'E' | b'+' | b'-')) {
        return f64::NAN;
    }
    s.parse().unwrap_or(f64::NAN)
}

/// `Number.isFinite(Number(x))`.
pub fn finite_number(v: Option<&Value>) -> Option<f64> {
    Some(to_number(v)).filter(|n| n.is_finite())
}

/// `Math.round` (Hälften Richtung +∞).
pub fn round(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let f = x.floor();
    if x - f >= 0.5 { f + 1.0 } else { f }
}

/// `trim()` mit JS-Leerraum.
pub fn trim(s: &str) -> &str {
    impala_search::text::js_trim(s)
}

/// `s.slice(0, n)` in UTF-16-Einheiten.
pub fn head16(s: &str, n: usize) -> &str {
    impala_search::text::slice_utf16(s, 0, n)
}

/// `s.length`.
pub fn len16(s: &str) -> usize {
    impala_search::text::utf16_len(s)
}

/// `a < b` für beliebige Werte (abstrakter Vergleich: zwei Strings textuell, sonst als Zahl).
pub fn value_lt(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::String(x), Value::String(y)) => lt(x, y),
        _ => to_number(Some(a)) < to_number(Some(b)),
    }
}

/// `a >= b` für beliebige Werte (NaN: falsch).
pub fn value_ge(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::String(x), Value::String(y)) => !lt(x, y),
        _ => to_number(Some(a)) >= to_number(Some(b)),
    }
}

/// `x.lastIndexOf("::")`-Elternpfad eines Stapels (`"A::B"` → `"A"`, `"A"` → `""`).
pub fn parent_path(path: &str) -> &str {
    path.rfind("::").map_or("", |i| &path[..i])
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn zahlen_wie_js() {
        for (v, n) in [
            (json!(" 12 "), 12.0),
            (json!(""), 0.0),
            (json!("0x1F"), 31.0),
            (json!("1e3"), 1000.0),
            (json!(".5"), 0.5),
            (json!("-Infinity"), f64::NEG_INFINITY),
            (json!(null), 0.0),
            (json!(true), 1.0),
            (json!([]), 0.0),
            (json!([7]), 7.0),
        ] {
            assert_eq!(to_number(Some(&v)), n, "{v}");
        }
        for v in [json!("inf"), json!("nan"), json!("1,5"), json!({}), json!([1, 2]), json!("0x")] {
            assert!(to_number(Some(&v)).is_nan(), "{v}");
        }
        assert!(to_number(None).is_nan());
        assert_eq!(round(2.5), 3.0);
        assert_eq!(round(-2.5), -2.0);
        assert_eq!(round(0.49999999999999994), 0.0);
        assert_eq!(num(3.0), json!(3));
        assert_eq!(num(f64::NAN), json!(null));
    }
}
