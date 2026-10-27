//! Vergleich mit dem JS-Original: Die Golden-Files enthalten Event-Listen und die Indizes,
//! die `compactEvents` aus `web/compact-events.js` behält (erzeugt von core/tools/gen-golden.mjs).

use impala_core::{Event, Field, JsLike, Kind, Unsupported, compact, decode};
use serde_json::Value;

/// JSON als JS-Wert gelesen.
struct Json<'a>(&'a Value);

impl<'a> JsLike for Json<'a> {
    fn kind(&self) -> Kind {
        match self.0 {
            Value::Null => Kind::Nullish,
            Value::Bool(false) => Kind::Falsy,
            Value::Number(n) if n.as_f64() == Some(0.0) => Kind::Falsy,
            Value::String(_) => Kind::Str,
            Value::Array(_) => Kind::Array,
            Value::Object(_) => Kind::Object,
            _ => Kind::Other,
        }
    }
    fn get(&self, field: Field) -> Self {
        Json(self.0.get(field.name()).unwrap_or(&Value::Null))
    }
    fn as_str(&self) -> Option<String> {
        self.0.as_str().map(str::to_owned)
    }
    fn as_f64(&self) -> Option<f64> {
        self.0.as_f64()
    }
    fn keys(&self) -> Vec<String> {
        self.0.as_object().map(|o| o.keys().cloned().collect()).unwrap_or_default()
    }
    fn items(&self) -> Vec<Self> {
        self.0.as_array().map(|a| a.iter().map(Json).collect()).unwrap_or_default()
    }
}

fn parse(json: &str) -> Result<Vec<Event>, Unsupported> {
    let value: Value = serde_json::from_str(json).unwrap();
    value.as_array().unwrap().iter().map(|ev| decode(&Json(ev))).collect()
}

#[test]
fn matches_js_compaction() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden");
    let mut files: Vec<_> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().path()).collect();
    files.sort();
    assert!(files.len() >= 5, "Golden-Files fehlen in {dir}");
    for file in files {
        let golden: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        let events = parse(&golden["events"].to_string()).unwrap_or_else(|e| panic!("{}: {e}", file.display()));
        let kept: Vec<usize> =
            golden["kept"].as_array().unwrap().iter().map(|i| i.as_u64().unwrap() as usize).collect();
        assert_eq!(compact(&events), kept, "{}", file.display());
    }
}

#[test]
fn shapes_only_js_handles_are_rejected() {
    for json in [
        r#"[{"type":"pageUpdate","payload":{"id":"a"}}]"#,
        r#"[{"t":5,"type":"pageUpdate"}]"#,
        r#"[{"t":"x","seq":1.5}]"#,
        r#"[{"t":"x","type":"pageUpdate","payload":{"patch":{}}}]"#,
        r#"[{"t":"x","type":"pageUpdate","payload":{"id":"a","patch":"text"}}]"#,
        r#"[{"t":"x","type":"uiTreeSet","payload":{"key":3}}]"#,
        r#"[{"t":"x","type":"heftOps","payload":{"ops":{"0":{}}}}]"#,
        r#"[{"t":"x","type":"heftSnap","payload":{"doc":{"pages":[null]}}}]"#,
        r#"[{"t":"x","type":"heftBlob","payload":{"hash":7}}]"#,
        r#"[{"t":"x","type":"chatUpsert","payload":{"id":"c","updated":12}}]"#,
        r#"[{"t":"x","type":"settingsSet","payload":[1]}]"#,
    ] {
        assert!(parse(json).is_err(), "sollte abgelehnt werden: {json}");
    }
}

#[test]
fn unrelated_events_may_have_any_shape() {
    let events =
        parse(r#"[{"t":"a","type":"teleEvent","payload":{"id":5,"key":{},"ops":3}},{"t":"b","type":7,"payload":"x"}]"#)
            .unwrap();
    assert_eq!(compact(&events), vec![0, 1]);
}

#[test]
fn compares_strings_like_javascript() {
    // UTF-16-Ordnung: U+1F600 (Surrogat 0xD83D) liegt in JS vor U+FF5E – in UTF-8 umgekehrt.
    let events = parse(r#"[{"t":"😀","seq":1,"type":"settingsSet","payload":{"a":1}},{"t":"～","seq":2,"type":"settingsSet","payload":{"a":2}}]"#).unwrap();
    assert_eq!(compact(&events), vec![1]);
}
