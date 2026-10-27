//! `JSON.stringify` byte-genau: Wo Bytes zählen (Paket-IDs, Chunk-Grenzen, Ciphertext), muss der
//! Kern denselben Text erzeugen wie JS. `serde_json` weicht bei Zahlen ab (`1e21` statt `1e+21`,
//! `1e-6` statt `0.000001`, `1.0` statt `1`); Schlüsselreihenfolge bleibt dank `preserve_order`
//! die eingelesene (JS-Ausgaben haben ganzzahlige Schlüssel schon vorn).

use serde_json::Value;

/// `JSON.stringify(value)`.
pub fn stringify(value: &Value) -> String {
    let mut out = String::new();
    write_value(&mut out, value);
    out
}

pub fn write_value(out: &mut String, value: &Value) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => write_number(out, n),
        Value::String(s) => write_string(out, s),
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_value(out, item);
            }
            out.push(']');
        }
        Value::Object(map) => {
            out.push('{');
            for (i, (key, item)) in map.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_string(out, key);
                out.push(':');
                write_value(out, item);
            }
            out.push('}');
        }
    }
}

fn write_number(out: &mut String, n: &serde_json::Number) {
    // Ganzzahlen im sicheren Bereich direkt; alles andere wie JS über f64.
    if let Some(i) = n.as_i64().filter(|i| i.unsigned_abs() <= 1 << 53) {
        out.push_str(&i.to_string());
    } else if let Some(f) = n.as_f64() {
        out.push_str(&number_to_string(f));
    } else {
        out.push_str("null");
    }
}

/// JSON-String-Literal wie `QuoteJSONString`.
pub fn write_string(out: &mut String, s: &str) {
    out.push('"');
    let mut start = 0;
    for (i, b) in s.bytes().enumerate() {
        let esc = match b {
            b'"' => "\\\"",
            b'\\' => "\\\\",
            b'\x08' => "\\b",
            b'\x0c' => "\\f",
            b'\n' => "\\n",
            b'\r' => "\\r",
            b'\t' => "\\t",
            0..=0x1f => "",
            _ => continue,
        };
        out.push_str(&s[start..i]);
        if esc.is_empty() {
            out.push_str(&format!("\\u{b:04x}"));
        } else {
            out.push_str(esc);
        }
        start = i + 1;
    }
    out.push_str(&s[start..]);
    out.push('"');
}

/// `Number.prototype.toString()` (kürzeste Ziffernfolge, JS-Regeln für Exponentenschreibweise).
/// Nicht endliche Werte gibt `JSON.stringify` als `null` aus.
pub fn number_to_string(x: f64) -> String {
    if !x.is_finite() {
        return "null".into();
    }
    if x == 0.0 {
        return "0".into(); // auch -0
    }
    // `{:e}` liefert die kürzeste Ziffernfolge, die den Wert eindeutig trifft (wie JS).
    let sci = format!("{:e}", x.abs());
    let (mantissa, exp) = sci.split_once('e').unwrap_or((&sci, "0"));
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    let k = digits.len() as i32;
    let n = exp.parse::<i32>().unwrap_or(0) + 1;
    let mut out = String::new();
    if x < 0.0 {
        out.push('-');
    }
    if k <= n && n <= 21 {
        out.push_str(&digits);
        out.extend(std::iter::repeat_n('0', (n - k) as usize));
    } else if 0 < n && n <= 21 {
        out.push_str(&digits[..n as usize]);
        out.push('.');
        out.push_str(&digits[n as usize..]);
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        out.extend(std::iter::repeat_n('0', (-n) as usize));
        out.push_str(&digits);
    } else {
        out.push_str(&digits[..1]);
        if k > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        out.push('e');
        out.push(if n > 0 { '+' } else { '-' });
        out.push_str(&(n - 1).abs().to_string());
    }
    out
}

/// `String(value)` für Werte aus JSON, z. B. Event-IDs in der Paket-ID (`[…].join("\n")`
/// macht aus `null`/fehlend den leeren Text).
pub fn js_string(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => {
            let mut s = String::new();
            write_number(&mut s, n);
            s
        }
        Some(Value::Array(items)) => items.iter().map(|v| js_string(Some(v))).collect::<Vec<_>>().join(","),
        Some(Value::Object(_)) => "[object Object]".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_like_js() {
        for (x, js) in [
            (1.0, "1"),
            (-2.5, "-2.5"),
            (0.1, "0.1"),
            (1e21, "1e+21"),
            (1e20, "100000000000000000000"),
            (123456789012345680000.0, "123456789012345680000"),
            (0.000001, "0.000001"),
            (1e-7, "1e-7"),
            (1.5e-7, "1.5e-7"),
            (-0.0, "0"),
            (5e-324, "5e-324"),
            (1.7976931348623157e308, "1.7976931348623157e+308"),
            (0.1 + 0.2, "0.30000000000000004"),
        ] {
            assert_eq!(number_to_string(x), js, "{x}");
        }
        let v: Value = serde_json::from_str(r#"[1e3, 12345678901234567890, -0, 1.0, 9007199254740993]"#).unwrap();
        assert_eq!(stringify(&v), "[1000,12345678901234567000,0,1,9007199254740992]");
    }

    #[test]
    fn strings_like_js() {
        let v = Value::String("a\"\\\u{8}\u{c}\n\r\t\u{1}\u{1f}\u{7f}ä\u{2028}😀".into());
        assert_eq!(stringify(&v), "\"a\\\"\\\\\\b\\f\\n\\r\\t\\u0001\\u001f\u{7f}ä\u{2028}😀\"");
    }

    #[test]
    fn keeps_key_order() {
        let v: Value = serde_json::from_str(r#"{"b":1,"a":{"z":null,"y":[true,false]}}"#).unwrap();
        assert_eq!(stringify(&v), r#"{"b":1,"a":{"z":null,"y":[true,false]}}"#);
    }

    #[test]
    fn string_conversion_like_js() {
        let v: Value = serde_json::from_str(r#"[null, 3, "x", [1, null, "a"], {"a": 1}, true]"#).unwrap();
        let out: Vec<String> = v.as_array().unwrap().iter().map(|v| js_string(Some(v))).collect();
        assert_eq!(out, ["", "3", "x", "1,,a", "[object Object]", "true"]);
        assert_eq!(js_string(None), "");
    }
}
