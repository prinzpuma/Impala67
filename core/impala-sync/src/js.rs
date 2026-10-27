//! JSON-Werte mit JS-Semantik lesen: Wahrheitswert, `Number(x)`, Kompaktierung über [`JsLike`].

use serde_json::Value;

use crate::event::{Field, JsLike, Kind};

/// `!!value` (fehlend = `undefined` = falsch).
pub fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0),
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(_) | Value::Object(_)) => true,
    }
}

/// `Number(value)`; fehlend = `undefined` = NaN.
pub fn number(value: Option<&Value>) -> f64 {
    match value {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(b)) => f64::from(u8::from(*b)),
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => string_to_number(s),
        Some(Value::Array(a)) => match a.as_slice() {
            [] => 0.0,
            [one] => string_to_number(&impala_crypto::json::js_string(Some(one))),
            _ => f64::NAN,
        },
        Some(Value::Object(_)) => f64::NAN,
    }
}

/// `Number(text)` für die Formen, die in Sync-Antworten vorkommen können.
fn string_to_number(s: &str) -> f64 {
    let t = s.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    if t.is_empty() {
        return 0.0;
    }
    match t {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    if t.bytes().all(|b| b.is_ascii_digit() || matches!(b, b'+' | b'-' | b'.' | b'e' | b'E')) {
        return t.parse().unwrap_or(f64::NAN);
    }
    let radix = |p: &str, r| t.strip_prefix(p).and_then(|d| u64::from_str_radix(d, r).ok()).map(|n| n as f64);
    radix("0x", 16)
        .or_else(|| radix("0X", 16))
        .or_else(|| radix("0o", 8))
        .or_else(|| radix("0b", 2))
        .unwrap_or(f64::NAN)
}

/// `Number(x) || fallback` als nichtnegative Ganzzahl (Cursor, Generationen).
pub fn count_or(value: Option<&Value>, fallback: u64) -> u64 {
    let n = number(value);
    if n.is_finite() && n > 0.0 { n as u64 } else { fallback }
}

/// `Number.isSafeInteger(Number(x))`.
pub fn safe_integer(value: Option<&Value>) -> Option<i64> {
    let n = number(value);
    (n.is_finite() && n.fract() == 0.0 && n.abs() <= 9_007_199_254_740_991.0).then_some(n as i64)
}

/// Ein JSON-Wert, wie die Kompaktierung ihn liest.
#[derive(Clone, Copy)]
pub struct JsonValue<'a>(pub Option<&'a Value>);

impl<'a> JsLike for JsonValue<'a> {
    fn kind(&self) -> Kind {
        match self.0 {
            None | Some(Value::Null) => Kind::Nullish,
            Some(Value::Bool(false)) => Kind::Falsy,
            Some(Value::Number(n)) if n.as_f64() == Some(0.0) => Kind::Falsy,
            Some(Value::String(_)) => Kind::Str,
            Some(Value::Array(_)) => Kind::Array,
            Some(Value::Object(_)) => Kind::Object,
            Some(_) => Kind::Other,
        }
    }
    fn get(&self, field: Field) -> Self {
        // Arrays haben keine benannten Felder (`[].id` ist undefined).
        // Kleine Objekte (Events, Payloads) linear durchsuchen: schneller als SipHash je Zugriff.
        JsonValue(self.0.and_then(|v| v.as_object()).and_then(|o| {
            let name = field.name();
            if o.len() <= 12 { o.iter().find(|(k, _)| k.as_str() == name).map(|(_, v)| v) } else { o.get(name) }
        }))
    }
    fn as_str(&self) -> Option<String> {
        self.0.and_then(Value::as_str).map(str::to_owned)
    }
    fn as_f64(&self) -> Option<f64> {
        self.0.and_then(Value::as_f64)
    }
    fn keys(&self) -> Vec<String> {
        self.0.and_then(Value::as_object).map(|o| o.keys().cloned().collect()).unwrap_or_default()
    }
    fn items(&self) -> Vec<Self> {
        self.0.and_then(Value::as_array).map(|a| a.iter().map(|v| JsonValue(Some(v))).collect()).unwrap_or_default()
    }
}

/// Kompaktiert JSON-Events (Indizes der behaltenen, in Log-Reihenfolge).
/// `Err`, wenn ein Event eine Form hat, die nur JS sinnvoll verarbeitet.
pub fn compact_values(events: &[Value]) -> Result<Vec<usize>, crate::Unsupported> {
    let decoded = events.iter().map(|ev| crate::decode(&JsonValue(Some(ev)))).collect::<Result<Vec<_>, _>>()?;
    Ok(crate::compact(&decoded))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn number_like_js() {
        let n = |v: Value| number(Some(&v));
        assert_eq!(n(json!(null)), 0.0);
        assert_eq!(n(json!(" 12 ")), 12.0);
        assert_eq!(n(json!("")), 0.0);
        assert_eq!(n(json!("0x1f")), 31.0);
        assert!(n(json!("abc")).is_nan());
        assert!(n(json!("inf")).is_nan());
        assert_eq!(n(json!([7])), 7.0);
        assert!(number(None).is_nan());
        assert_eq!(count_or(Some(&json!("x")), 1), 1);
        assert_eq!(safe_integer(Some(&json!(3.0))), Some(3));
        assert_eq!(safe_integer(Some(&json!(3.5))), None);
    }
}
