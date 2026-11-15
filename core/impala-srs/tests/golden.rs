//! Vergleich mit dem letzten JS-Stand (eingefrorene Golden-Files; die PWA rechnet seit dem Umbau nur noch in Rust).

use impala_srs::*;
use serde_json::Value;

fn load(name: &str) -> Value {
    let path = format!("{}/tests/golden/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-9 * a.abs().max(b.abs()).max(1.0)
}

/// Rust-Zustand gegen JS-Zustand: Zahlen mit Toleranz; Felder, die JS weglässt, müssen in Rust
/// den neutralen Wert haben (JS setzt z. B. `lapses` erst beim ersten Vergessen).
fn same_card(rust: &Value, js: &Value) -> Result<(), String> {
    let (r, j) = (rust.as_object().unwrap(), js.as_object().unwrap());
    for (k, rv) in r {
        let ok = match (rv, j.get(k)) {
            (Value::Number(a), Some(Value::Number(b))) => close(a.as_f64().unwrap(), b.as_f64().unwrap()),
            (v, Some(w)) => v == w,
            (v, None) => v == &Value::Null || v.as_f64() == Some(0.0),
        };
        if !ok {
            return Err(format!("{k}: Rust {rv} / JS {:?}", j.get(k)));
        }
    }
    match j.keys().find(|k| !r.contains_key(*k)) {
        Some(k) => Err(format!("{k} fehlt in Rust")),
        None => Ok(()),
    }
}

#[test]
fn bewertungsfolgen_wie_js() {
    let cases = load("sequences.json");
    let mut steps = 0;
    for (n, case) in cases.as_array().unwrap().iter().enumerate() {
        let mut card: Srs = serde_json::from_value(case["start"].clone()).unwrap();
        for (k, step) in case["steps"].as_array().unwrap().iter().enumerate() {
            let now = Timestamp::parse_iso(step["now"].as_str().unwrap()).unwrap();
            let rating = Rating::from_grade(step["grade"].as_f64().unwrap());
            let fuzz = match (step["fuzz"].as_bool().unwrap(), step["rand"].as_f64()) {
                (false, _) => Fuzz::Off,
                (true, r) => Fuzz::Sample(r.unwrap_or(0.0)),
            };
            card = card.rate(rating, now, fuzz);
            let ours = serde_json::to_value(&card).unwrap();
            if let Err(e) = same_card(&ours, &step["after"]) {
                panic!("Folge {n}, Schritt {k}: {e}\nRust {ours}\nJS   {}", step["after"]);
            }
            let preview: Vec<Value> = (1..=4).map(|g| step["preview"][g.to_string()].clone()).collect();
            assert_eq!(card.preview(now).map(Value::from).to_vec(), preview, "Folge {n}, Schritt {k}: Vorschau");
            // (frei weiterlaufend: Rust rechnet ab dem Startzustand alles selbst)
            steps += 1;
        }
    }
    assert!(steps > 1500, "{steps}");
}

#[test]
fn hilfsfunktionen_wie_js() {
    let f = load("functions.json");
    for r in f["retrievability"].as_array().unwrap() {
        let (t, s, want) = (r[0].as_f64().unwrap(), r[1].as_f64().unwrap(), r[2].as_f64().unwrap());
        assert!(close(retrievability(t, s), want), "R({t}, {s})");
    }
    for c in f["formats"].as_array().unwrap() {
        let card: Srs = serde_json::from_value(c["card"].clone()).unwrap();
        let now = Timestamp::parse_iso(c["now"].as_str().unwrap()).unwrap();
        let want: Vec<Value> = (1..=4).map(|g| c["preview"][g.to_string()].clone()).collect();
        assert_eq!(card.preview(now).map(Value::from).to_vec(), want);
    }
    for i in f["ivl"].as_array().unwrap() {
        assert_eq!(format_interval(i[0].as_f64().unwrap()), i[1].as_str().unwrap(), "{i}");
    }
}

#[test]
fn cloze_wie_js() {
    let g = load("cloze.json");
    for s in g["sentences"].as_array().unwrap() {
        let text = s["text"].as_str().unwrap();
        let want_indexes: Vec<u32> =
            s["indexes"].as_array().unwrap().iter().map(|v| v.as_u64().unwrap() as u32).collect();
        assert_eq!(cloze::indexes(text), want_indexes, "indexes für {text:?}");

        for (idx_str, want_front) in s["front"].as_object().unwrap() {
            let idx: u32 = idx_str.parse().unwrap();
            assert_eq!(cloze::front(text, idx), want_front.as_str().unwrap(), "front({idx}) für {text:?}");
        }

        for (idx_str, want_back) in s["back"].as_object().unwrap() {
            let idx: u32 = idx_str.parse().unwrap();
            assert_eq!(cloze::back(text, idx), want_back.as_str().unwrap(), "back({idx}) für {text:?}");
        }

        let want_recall = s["recall"].as_object();
        let actual_recall = cloze::cloze_recall(text);
        match (want_recall, actual_recall) {
            (None, None) => {}
            (Some(w), Some(a)) => {
                assert_eq!(a.question, w["question"].as_str().unwrap());
                let want_ans: Vec<&str> =
                    w["answers"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
                assert_eq!(a.answers, want_ans);
            }
            _ => panic!("recall mismatch für {text:?}"),
        }
    }

    for w in g["wraps"].as_array().unwrap() {
        let text = w["text"].as_str().unwrap();
        let a = w["a"].as_u64().unwrap() as u32;
        let b = w["b"].as_u64().unwrap() as u32;
        let exp = &w["expected"];
        let res = cloze::wrap_cloze(text, a, b);
        assert_eq!(res.text, exp["text"].as_str().unwrap());
        assert_eq!(res.cursor, exp["cursor"].as_u64().unwrap() as u32);
    }

    for h in g["highlights"].as_array().unwrap() {
        let input = h["input"].as_str().unwrap();
        let want = h["output"].as_str();
        assert_eq!(cloze::highlights_to_cloze(input).as_deref(), want);
    }

    for st in g["strips"].as_array().unwrap() {
        let input = st["input"].as_str().unwrap();
        let want = st["output"].as_str().unwrap();
        assert_eq!(cloze::strip_line_prefix(input), want);
    }
}
