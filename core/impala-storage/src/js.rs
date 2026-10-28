//! Kleine JS-Gleichteile, wo gespeicherte Bytes davon abhängen: `JSON.stringify`,
//! `Number#toString`, `Date#toISOString`, String-Vergleich und Truthiness.

use std::cmp::Ordering;
use std::io;

use serde_json::Value;

/// `JSON.stringify(value)` – Bytes wie JS (Zahlenformat!), damit Inhalts-Hashes
/// (Checkpoint-Hefte) auf beiden Seiten gleich sind. Schlüsselreihenfolge = Einfügereihenfolge.
pub fn stringify(value: &Value) -> String {
    stringify_with(value)
}

/// Wie [`stringify`] für jeden serialisierbaren Wert (z. B. ein Heft ohne Umweg über `Value`).
pub fn stringify_with<T: serde::Serialize + ?Sized>(value: &T) -> String {
    let mut out = Vec::with_capacity(128);
    let mut ser = serde_json::Serializer::with_formatter(&mut out, JsFormatter);
    // Schreiben in einen Vec scheitert nicht; die Werte hier sind immer serialisierbar.
    if value.serialize(&mut ser).is_err() {
        return String::from("null");
    }
    String::from_utf8(out).unwrap_or_default()
}

struct JsFormatter;

impl serde_json::ser::Formatter for JsFormatter {
    fn write_f64<W: ?Sized + io::Write>(&mut self, w: &mut W, value: f64) -> io::Result<()> {
        // Häufigster Fall (Stiftpunkte): ganze Zahl bzw. kurze Dezimalzahl ohne Exponent – die
        // kürzeste Darstellung von ryu ist dann schon die von JS, ohne Umweg über `number()`.
        if value.is_finite() && value != 0.0 && value.abs() < 1e15 && value.abs() >= 1e-6 {
            if value.fract() == 0.0 {
                return w.write_all(itoa(value as i64).as_bytes());
            }
            let mut buf = ryu::Buffer::new();
            let raw = buf.format_finite(value);
            if !raw.contains('e') {
                return w.write_all(raw.as_bytes());
            }
        }
        w.write_all(number(value).as_bytes())
    }
    fn write_f32<W: ?Sized + io::Write>(&mut self, w: &mut W, value: f32) -> io::Result<()> {
        w.write_all(number(f64::from(value)).as_bytes())
    }
}

fn itoa(n: i64) -> String {
    n.to_string()
}

/// `String(x)` für Zahlen (ECMAScript Number::toString, kürzeste Darstellung).
pub fn number(x: f64) -> String {
    if x.is_nan() {
        return "NaN".into();
    }
    if x == 0.0 {
        return "0".into(); // auch -0
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    // Kürzeste Ziffernfolge von ryu, dann nach ECMAScript-Regeln anordnen.
    let mut buf = ryu::Buffer::new();
    let raw = buf.format_finite(x.abs());
    let (mantissa, exp) = match raw.split_once('e') {
        Some((m, e)) => (m, e.parse::<i32>().unwrap_or(0)),
        None => (raw, 0),
    };
    let (int, frac) = mantissa.split_once('.').unwrap_or((mantissa, ""));
    let frac = frac.trim_end_matches('0');
    let all = format!("{int}{frac}");
    let lead = all.len() - all.trim_start_matches('0').len();
    let digits = all.trim_start_matches('0').trim_end_matches('0');
    // Wert = 0.digits × 10^n
    let n = int.len() as i32 - lead as i32 + exp;
    let k = digits.len() as i32;
    let mut s = String::new();
    if x < 0.0 {
        s.push('-');
    }
    if k <= n && n <= 21 {
        s.push_str(digits);
        s.extend(std::iter::repeat_n('0', (n - k) as usize));
    } else if 0 < n && n <= 21 {
        s.push_str(&digits[..n as usize]);
        s.push('.');
        s.push_str(&digits[n as usize..]);
    } else if -6 < n && n <= 0 {
        s.push_str("0.");
        s.extend(std::iter::repeat_n('0', (-n) as usize));
        s.push_str(digits);
    } else {
        let e = n - 1;
        s.push_str(&digits[..1]);
        if k > 1 {
            s.push('.');
            s.push_str(&digits[1..]);
        }
        s.push('e');
        s.push(if e < 0 { '-' } else { '+' });
        s.push_str(&e.abs().to_string());
    }
    s
}

/// `new Date(ms).toISOString()`; `None` für ungültige Zeitpunkte (JS: `Invalid Date`).
pub fn iso_from_ms(ms: f64) -> Option<String> {
    if !ms.is_finite() || ms.abs() > 8.64e15 {
        return None;
    }
    let ms = ms.trunc() as i64; // TimeClip
    let days = ms.div_euclid(86_400_000);
    let rest = ms.rem_euclid(86_400_000);
    let (y, m, d) = civil_from_days(days);
    let (hh, mm, ss, mss) = (rest / 3_600_000, rest / 60_000 % 60, rest / 1000 % 60, rest % 1000);
    let year = if (0..=9999).contains(&y) {
        format!("{y:04}")
    } else {
        format!("{}{:06}", if y < 0 { '-' } else { '+' }, y.abs())
    };
    Some(format!("{year}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}.{mss:03}Z"))
}

/// Tage seit 1970-01-01 → (Jahr, Monat, Tag), proleptisch gregorianisch (H. Hinnant).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

/// `a < b` auf JS-Strings (UTF-16-Codeeinheiten).
pub fn cmp(a: &str, b: &str) -> Ordering {
    if a.is_ascii() && b.is_ascii() {
        return a.cmp(b);
    }
    a.encode_utf16().cmp(b.encode_utf16())
}

/// JS-Truthiness eines JSON-Werts.
pub fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// `String(x)` für JSON-Werte (nur für IDs relevant).
pub fn to_string(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.as_f64().map(number).unwrap_or_default(),
        Value::String(s) => s.clone(),
        Value::Array(a) => {
            a.iter().map(|x| if x.is_null() { String::new() } else { to_string(x) }).collect::<Vec<_>>().join(",")
        }
        Value::Object(_) => "[object Object]".into(),
    }
}

/// `Number(x) || 0` für Folgenummern (nur nicht-negative Ganzzahlen sind gültige Schlüssel).
pub fn seq_of(v: Option<&Value>) -> u64 {
    match v {
        Some(Value::Number(n)) => {
            n.as_u64().or_else(|| n.as_f64().filter(|f| *f >= 0.0).map(|f| f as u64)).unwrap_or(0)
        }
        Some(Value::String(s)) => s.trim().parse::<f64>().ok().filter(|f| *f >= 0.0).map(|f| f as u64).unwrap_or(0),
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schnellweg_wie_number() {
        // Schreibweg für Stiftpunkte & Co. muss exakt `number()` entsprechen.
        let mut x = 0.123_456_789_f64;
        let mut samples = vec![1e-6, 9.99e-7, 1e15 - 0.5, 1e15, 123.0, -45.25, 0.1 + 0.2, 1.0 / 3.0, 5e-5, 0.000123];
        for _ in 0..20_000 {
            x = (x * 1_103.515_245 + 12.345).fract();
            samples.push((x - 0.5) * 10f64.powi((x * 30.0) as i32 - 10));
            samples.push((x * 2000.0 * 10.0).round() / 10.0);
        }
        for v in samples {
            assert_eq!(stringify_with(&v), number(v), "{v:e}");
        }
    }

    #[test]
    fn numbers_like_js() {
        for (x, js) in [
            (1.0, "1"),
            (-1.5, "-1.5"),
            (0.1 + 0.2, "0.30000000000000004"),
            (1e21, "1e+21"),
            (1e20, "100000000000000000000"),
            (1e-7, "1e-7"),
            (1.5e-7, "1.5e-7"),
            (0.000001, "0.000001"),
            (123456.789, "123456.789"),
            (-0.0, "0"),
            (5e-324, "5e-324"),
            (1.7976931348623157e308, "1.7976931348623157e+308"),
        ] {
            assert_eq!(number(x), js, "{x}");
        }
    }

    #[test]
    fn iso_like_js() {
        assert_eq!(iso_from_ms(0.0).as_deref(), Some("1970-01-01T00:00:00.000Z"));
        assert_eq!(iso_from_ms(-1.0).as_deref(), Some("1969-12-31T23:59:59.999Z"));
        assert_eq!(iso_from_ms(1.7e12 + 0.9).as_deref(), Some("2023-11-14T22:13:20.000Z"));
        assert_eq!(iso_from_ms(8.64e15).as_deref(), Some("+275760-09-13T00:00:00.000Z"));
        assert_eq!(iso_from_ms(8.64e15 + 1.0), None);
    }
}
