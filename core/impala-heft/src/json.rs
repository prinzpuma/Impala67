//! Nachsichtiges Lesen JS-geschriebener Werte und JS-genaue Zahlenhelfer.
//!
//! Das Heft stammt aus alten App-Versionen, fremden Geräten und Importen. Ein Feld mit
//! unerwartetem Typ darf nie das ganze Dokument unlesbar machen: Die Leser hier liefern
//! dann `None` (bzw. überspringen den Eintrag) – so wie JS das Feld als `undefined` sähe.

use serde::ser::SerializeMap;
use serde_json::{Map, Value};

/// Zahl oder nichts (`null`, Text, Objekt … zählen als fehlend).
pub(crate) fn num(v: &Value) -> Option<f64> {
    v.as_f64()
}

/// Text oder nichts. IDs dürfen in Altständen auch Zahlen sein (`5` → `"5"`).
pub(crate) fn id_str(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => n.as_f64().map(js_number_string),
        _ => None,
    }
}

pub(crate) fn string(v: &Value) -> Option<String> {
    v.as_str().map(str::to_owned)
}

/// JS-„truthy“ Text: fehlend und leer zählen gleich.
pub(crate) fn non_empty(v: Option<&Value>) -> Option<String> {
    v.and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_owned)
}

/// Liste von Texten; andere Einträge fallen weg, eine Nicht-Liste ist leer.
pub(crate) fn str_list(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_owned)).collect())
        .unwrap_or_default()
}

/// Die Felder eines JS-Objekts. Bekannte Felder werden herausgenommen, sobald sie sich
/// lesen lassen; was übrig bleibt (unbekannte Felder, bekannte mit fremdem Typ), kommt
/// unverändert wieder heraus. So geht beim Lesen und Schreiben nichts verloren.
pub(crate) struct Fields(pub Map<String, Value>);

impl Fields {
    pub fn of(v: Value) -> Option<Self> {
        match v {
            Value::Object(m) => Some(Fields(m)),
            _ => None,
        }
    }
    pub fn take<T>(&mut self, key: &str, read: impl FnOnce(&Value) -> Option<T>) -> Option<T> {
        let out = read(self.0.get(key)?);
        if out.is_some() {
            self.0.remove(key);
        }
        out
    }
    /// Wie [`take`](Self::take), liest aber den Wert selbst (spart die Kopie großer Listen).
    pub fn take_owned<T>(&mut self, key: &str, read: impl FnOnce(Value) -> Result<T, Value>) -> Option<T> {
        let v = self.0.remove(key)?;
        match read(v) {
            Ok(t) => Some(t),
            Err(v) => {
                self.0.insert(key.to_owned(), v);
                None
            }
        }
    }
}

/// Schreibt die übrigen Felder; Schlüssel, die schon als typisiertes Feld geschrieben
/// wurden, gewinnen (ein später gesetztes Feld verdrängt einen alten Fremdwert).
pub(crate) fn write_extra<M: SerializeMap>(
    m: &mut M,
    extra: &Map<String, Value>,
    written: &[&str],
) -> Result<(), M::Error> {
    for (k, v) in extra {
        if !written.contains(&k.as_str()) {
            m.serialize_entry(k, v)?;
        }
    }
    Ok(())
}

/// Zahl, geschrieben wie `JSON.stringify`: ganze Werte ohne `.0`, `NaN`/`±∞` als `null`.
/// serde_json schriebe `3.0` – gleichwertig beim Lesen, aber andere Bytes (Inhalts-Hashes).
#[derive(Debug, Clone, Copy)]
pub struct JsNum(pub f64);

impl serde::Serialize for JsNum {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let v = self.0;
        if !v.is_finite() {
            s.serialize_unit()
        } else if v.fract() == 0.0 && v.abs() < 9_007_199_254_740_992.0 {
            s.serialize_i64(v as i64)
        } else {
            s.serialize_f64(v)
        }
    }
}

/// Hilfe für handgeschriebene `Serialize`-Implementierungen: merkt sich die geschriebenen Schlüssel.
pub(crate) struct ObjWriter<M> {
    pub map: M,
    pub written: Vec<&'static str>,
}

impl<M: SerializeMap> ObjWriter<M> {
    pub fn new(map: M) -> Self {
        ObjWriter { map, written: Vec::new() }
    }
    pub fn field<T: serde::Serialize + ?Sized>(&mut self, key: &'static str, v: &T) -> Result<(), M::Error> {
        self.written.push(key);
        self.map.serialize_entry(key, v)
    }
    pub fn opt<T: serde::Serialize>(&mut self, key: &'static str, v: &Option<T>) -> Result<(), M::Error> {
        match v {
            Some(v) => self.field(key, v),
            None => Ok(()),
        }
    }
    /// IDs: leer heißt fehlend (JS prüft überall `!item.id`) und wird nicht geschrieben.
    pub fn id(&mut self, id: &str) -> Result<(), M::Error> {
        if id.is_empty() { Ok(()) } else { self.field("id", id) }
    }
    /// Liste schreiben – außer sie ist leer und unter dem Schlüssel liegt ein Fremdwert
    /// (dann bleibt der unverändert erhalten).
    pub fn list<T: serde::Serialize>(
        &mut self,
        key: &'static str,
        v: &[T],
        extra: &Map<String, Value>,
    ) -> Result<(), M::Error> {
        if v.is_empty() && extra.contains_key(key) { Ok(()) } else { self.field(key, v) }
    }
    pub fn opt_num(&mut self, key: &'static str, v: Option<f64>) -> Result<(), M::Error> {
        match v {
            Some(v) => self.field(key, &JsNum(v)),
            None => Ok(()),
        }
    }
    pub fn finish(mut self, extra: &Map<String, Value>) -> Result<M::Ok, M::Error> {
        write_extra(&mut self.map, extra, &self.written)?;
        self.map.end()
    }
}

// ---------------------------------------------------------------------------
// JS-genaue Zahlen

/// `Math.round`: halbe Werte immer Richtung +∞ (Rust `round` rundet weg von 0).
pub fn js_round(x: f64) -> f64 {
    let f = x.floor();
    if x - f >= 0.5 { f + 1.0 } else { f }
}

/// `Math.hypot(a, b)` wie V8 (Skalierung mit dem Maximum, Kahan-Summe). `f64::hypot`
/// weicht in der letzten Stelle ab – das verschöbe Formerkennungs-Schwellen.
pub fn js_hypot(a: f64, b: f64) -> f64 {
    let (a, b) = (a.abs(), b.abs());
    if a.is_infinite() || b.is_infinite() {
        return f64::INFINITY;
    }
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    let max = a.max(b);
    if max == 0.0 {
        return 0.0;
    }
    let (mut sum, mut comp) = (0.0f64, 0.0f64);
    for v in [a, b] {
        let n = v / max;
        let summand = n * n - comp;
        let pre = sum + summand;
        comp = (pre - sum) - summand;
        sum = pre;
    }
    sum.sqrt() * max
}

/// `Number.prototype.toFixed(digits)` (halbe Werte weg von 0, wie die Spezifikation).
/// Rusts `{:.2}` rundet exakte Hälften zur geraden Ziffer und weicht damit ab.
pub fn js_to_fixed(x: f64, digits: usize) -> String {
    if !x.is_finite() {
        return js_number_string(x);
    }
    if x.abs() >= 1e21 {
        return js_number_string(x);
    }
    let neg = x < 0.0;
    // Exakte Dezimalentwicklung (genug Stellen, damit nur ein echter Gleichstand bei 5 endet).
    let s = format!("{:.*}", digits + 60, x.abs());
    let (int, frac) = s.split_once('.').unwrap_or((&s, ""));
    let mut digits_vec: Vec<u8> = int.bytes().chain(frac.bytes().take(digits)).map(|b| b - b'0').collect();
    let round_up = frac.as_bytes().get(digits).is_some_and(|&b| b >= b'5');
    if round_up {
        let mut i = digits_vec.len();
        loop {
            if i == 0 {
                digits_vec.insert(0, 1);
                break;
            }
            i -= 1;
            if digits_vec[i] == 9 {
                digits_vec[i] = 0;
            } else {
                digits_vec[i] += 1;
                break;
            }
        }
    }
    let int_len = digits_vec.len() - digits;
    let mut out = String::new();
    if neg {
        out.push('-');
    }
    for (i, d) in digits_vec.iter().enumerate() {
        if i == int_len {
            out.push('.');
        }
        out.push((b'0' + d) as char);
    }
    out
}

/// `String(number)` für die Fälle, die im Heft vorkommen (ganze Zahlen, kurze Dezimalen).
/// Rusts kürzeste Darstellung stimmt mit JS überein, nur Exponenten und `-0` sehen anders aus.
pub fn js_number_string(x: f64) -> String {
    if x.is_nan() {
        return "NaN".into();
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    if x == 0.0 {
        return "0".into();
    }
    if x.fract() == 0.0 && x.abs() < 1e21 {
        return format!("{x:.0}");
    }
    format!("{x}")
}

/// `Number.prototype.toString(36)` für vorzeichenlose 32-Bit-Werte.
pub(crate) fn radix36(mut v: u64) -> String {
    if v == 0 {
        return "0".into();
    }
    let mut out = Vec::new();
    while v > 0 {
        let d = (v % 36) as u8;
        out.push(if d < 10 { b'0' + d } else { b'a' + d - 10 });
        v /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

/// Länge in UTF-16-Einheiten (`string.length` in JS).
pub fn js_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// Gleichheit wie beim Vergleich der JS-Signaturtexte: `NaN` gleich `NaN`, `-0` gleich `0`.
pub(crate) fn same_num(a: f64, b: f64) -> bool {
    a == b || (a.is_nan() && b.is_nan())
}

/// Leerraum wie `String.prototype.trim` (dort zählt U+FEFF dazu, U+0085 nicht).
pub(crate) fn js_is_space(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}')
        || matches!(c, '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

pub(crate) fn js_trim(s: &str) -> &str {
    s.trim_matches(js_is_space)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rundet_wie_js() {
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_to_fixed(0.125, 2), "0.13");
        assert_eq!(js_to_fixed(1.005, 2), "1.00");
        assert_eq!(js_to_fixed(-0.001, 2), "-0.00");
        assert_eq!(js_to_fixed(-0.0, 2), "0.00");
        assert_eq!(js_to_fixed(595.28, 2), "595.28");
        assert_eq!(js_to_fixed(9.995, 2), "9.99");
        assert_eq!(js_to_fixed(99.5, 0), "100");
        assert_eq!(radix36(35), "z");
        assert_eq!(radix36(36), "10");
        assert_eq!(js_number_string(3.0), "3");
        assert_eq!(js_number_string(0.1), "0.1");
    }
}
