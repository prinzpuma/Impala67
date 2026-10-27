//! Vergleich mit dem JS-Original (Golden-Files von core/tools/gen-golden-ink.mjs): Dekodierung realer
//! Modellausgaben, Wortkorrektur, Wörterbuch, Zeilentrennung, Rasterung und der ganze Seiten-Ablauf.

mod common;

use common::*;
use impala_ink::ctc::{self, clean_transcription, correct_word};
use impala_ink::page::{LineOutcome, StrokeStatus};
use impala_ink::preprocess::{self, Bbox};
use impala_ink::raster::{self, rasterize_line};
use impala_ink::vocab::{self, CLASSES};
use impala_ink::{DecodeOptions, LineCache, LineDecoding, LineReading, Mode, Status, decode_line, recognize_page};
use serde_json::Value;

fn options(name: &str) -> (DecodeOptions, bool) {
    let d = DecodeOptions::default();
    match name {
        "lexikon" | "luecken" => (d, true),
        "ohne-lexikon" => (d, false),
        "text" => (DecodeOptions { mode: Mode::Text, ..d }, true),
        "math" => (DecodeOptions { mode: Mode::Math, ..d }, false),
        "schwelle" => (DecodeOptions { threshold: 0.95, ..d }, true),
        _ => panic!("unbekannte Optionen {name}"),
    }
}

fn status(name: &str) -> Status {
    match name {
        "empty" => Status::Empty,
        "drawing" => Status::Drawing,
        "uncertain" => Status::Uncertain,
        "recognized" => Status::Recognized,
        _ => panic!("unbekannter Status {name}"),
    }
}

fn assert_decoding(rust: &LineDecoding, js: &Value, what: &str) {
    assert_eq!(rust.text, js["text"].as_str().unwrap(), "{what}: text");
    assert_eq!(rust.raw_text, js["rawText"].as_str().unwrap(), "{what}: rawText");
    assert_eq!(rust.status, status(js["status"].as_str().unwrap()), "{what}: status");
    assert_eq!(rust.confidence, js["confidence"].as_f64().unwrap(), "{what}: confidence");
    assert_eq!(rust.blank_ratio, js["blankRatio"].as_f64().unwrap(), "{what}: blankRatio");
    let confs: Vec<f32> =
        js["charConfidences"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap() as f32).collect();
    assert_eq!(rust.char_confidences, confs, "{what}: charConfidences");
}

#[test]
fn vokabular_wie_js() {
    let g = golden("decode.json");
    for (i, c) in g["vocab"].as_array().unwrap().iter().enumerate() {
        let js = c.as_str().unwrap();
        assert_eq!(vocab::char_of(i).map(String::from).unwrap_or_default(), js, "Klasse {i}");
    }
    assert_eq!(g["vocab"].as_array().unwrap().len(), CLASSES);
}

#[test]
fn dekodierung_realer_logits() {
    let g = golden("decode.json");
    let mut n = 0;
    for case in g["cases"].as_array().unwrap() {
        let steps = case["steps"].as_u64().unwrap() as usize;
        let base = logits(case["logits"].as_str().unwrap(), steps);
        for (name, js) in case["results"].as_object().unwrap() {
            let (opts, use_lex) = options(name);
            let mut l = base.clone();
            if name == "luecken" {
                let gaps: Vec<(usize, usize)> = case["gaps"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|g| (g[0].as_u64().unwrap() as usize, g[1].as_u64().unwrap() as usize))
                    .collect();
                ctc::mark_gap_spaces(&mut l, CLASSES, &gaps, case["width"].as_u64().unwrap() as usize).unwrap();
            }
            let rust = decode_line(&l, CLASSES, &opts, use_lex.then(lexicon)).unwrap();
            let what = format!("{:?} (Rauschen {}) / {name}", case["text"], case["noise"]);
            assert_decoding(&rust, js, &what);
            n += 1;
        }
    }
    assert!(n >= 200, "nur {n} Fälle");
}

/// Stark verrauschte Lesungen (viele Wörterbuch-Ersetzungen): Standard-Lesung mit Wörterbuch.
#[test]
fn verrauschte_lesungen() {
    let g = golden("decode.json");
    for case in g["stress"].as_array().unwrap() {
        let l = logits(case["logits"].as_str().unwrap(), case["steps"].as_u64().unwrap() as usize);
        let rust = decode_line(&l, CLASSES, &DecodeOptions::default(), Some(lexicon())).unwrap();
        let js = &case["out"];
        assert_eq!(rust.text, js["text"].as_str().unwrap(), "{:?}", case["text"]);
        assert_eq!(rust.status, status(js["status"].as_str().unwrap()));
        assert_eq!(rust.confidence, js["confidence"].as_f64().unwrap());
    }
}

#[test]
fn wortkorrektur_und_bereinigung() {
    let g = golden("decode.json");
    let mode = |v: &Value| if v.as_str() == Some("math") { Mode::Math } else { Mode::Text };
    for c in g["correct"].as_array().unwrap() {
        let word = c["word"].as_str().unwrap();
        assert_eq!(correct_word(word, mode(&c["mode"])), c["out"].as_str().unwrap(), "{word} / {}", c["mode"]);
    }
    for c in g["clean"].as_array().unwrap() {
        let confs: Option<Vec<f32>> =
            c["charConfidences"].as_array().map(|a| a.iter().map(|v| v.as_f64().unwrap() as f32).collect());
        let text = c["text"].as_str().unwrap();
        assert_eq!(
            clean_transcription(text, mode(&c["mode"]), confs.as_deref(), true),
            c["out"].as_str().unwrap(),
            "{text}"
        );
    }
    for c in g["levenshtein"].as_array().unwrap() {
        let (a, b) = (c["a"].as_str().unwrap(), c["b"].as_str().unwrap());
        assert_eq!(impala_ink::levenshtein(a, b), c["d"].as_u64().unwrap() as usize, "{a} / {b}");
    }
    let lex = lexicon();
    assert_eq!(lex.len(), g["lexicon"]["size"].as_u64().unwrap() as usize);
    for c in g["lexicon"]["has"].as_array().unwrap() {
        let word = c["word"].as_str().unwrap();
        assert_eq!(lex.contains(word), c["has"].as_bool().unwrap(), "{word}");
    }
}

fn bbox(v: &Value) -> Bbox {
    let f = |k: &str| v[k].as_f64().unwrap();
    Bbox { min_x: f("minX"), max_x: f("maxX"), min_y: f("minY"), max_y: f("maxY") }
}

fn indices(v: &Value) -> Vec<usize> {
    v.as_array().unwrap().iter().map(|i| i.as_u64().unwrap() as usize).collect()
}

#[test]
fn zeilen_begradigen_rastern() {
    let g = golden("pipeline.json");
    for page in g["preprocess"].as_array().unwrap() {
        let name = page["name"].as_str().unwrap();
        let strokes = strokes(&page["strokes"]);
        let lines = preprocess::segment_lines(&strokes);
        let js_lines = page["lines"].as_array().unwrap();
        assert_eq!(lines.len(), js_lines.len(), "{name}: Zeilen");
        for (k, (line, js)) in lines.iter().zip(js_lines).enumerate() {
            assert_eq!(line.strokes, indices(&js["strokes"]), "{name} Zeile {k}: Striche");
            assert_eq!(line.bbox, bbox(&js["bbox"]), "{name} Zeile {k}: Umrandung");

            let own: Vec<_> = line.strokes.iter().map(|&i| strokes[i].clone()).collect();
            let desk = preprocess::deskew_line(&own);
            let close = |a: [f64; 2], b: &Value| {
                (a[0] - b[0].as_f64().unwrap()).abs() < 1e-9 && (a[1] - b[1].as_f64().unwrap()).abs() < 1e-9
            };
            assert!(close(desk[0].points[0], &js["deskewed"]["first"]), "{name} Zeile {k}: begradigt");
            assert!(close(*desk.last().unwrap().points.last().unwrap(), &js["deskewed"]["last"]), "{name} Zeile {k}");
            let image = rasterize_line(&desk).unwrap();
            assert_eq!(image.width, js["imageWidth"].as_u64().unwrap() as usize, "{name} Zeile {k}: Bildbreite");
            let gaps: Vec<(usize, usize)> = js["gaps32"]
                .as_array()
                .unwrap()
                .iter()
                .map(|g| (g[0].as_u64().unwrap() as usize, g[1].as_u64().unwrap() as usize))
                .collect();
            let ours = raster::find_ink_gaps(&image, raster::WORD_GAP_PX);
            assert_eq!(ours.len(), gaps.len(), "{name} Zeile {k}: Wortlücken {ours:?} / {gaps:?}");
            for (a, b) in ours.iter().zip(&gaps) {
                // Kantenglättung weicht von Skia ab: Lückenränder höchstens 1 px verschoben
                assert!(a.0.abs_diff(b.0) <= 1 && a.1.abs_diff(b.1) <= 1, "{name} Zeile {k}: {ours:?} / {gaps:?}");
            }

            let mixed = indices(&js["order"]["input"]);
            let mixed_strokes: Vec<_> = mixed.iter().map(|&i| strokes[i].clone()).collect();
            assert_eq!(
                preprocess::order_line_strokes(&mixed_strokes),
                indices(&js["order"]["output"]),
                "{name} Zeile {k}"
            );
        }
    }
}

fn reading(v: &Value) -> LineReading {
    LineReading {
        text: v["text"].as_str().unwrap().to_string(),
        confidence: v["confidence"].as_f64().unwrap(),
        status: status(v["status"].as_str().unwrap()),
    }
}

/// Ganzer Ablauf mit den aufgezeichneten Modellausgaben des JS-Laufs: gleiche Zeilen, gleiche Bildbreiten,
/// gleicher Text und Zeilen-Cache. Nebenbei: wie nah die Rust-Rasterung an Skia liegt.
#[test]
fn seiten_ablauf() {
    let g = golden("pipeline.json");
    let pages = g["preprocess"].as_array().unwrap();
    let (mut sum_mean, mut worst_max, mut sum_frac, mut images) = (0.0, 0.0f64, 0.0, 0);
    for (page, js_page) in g["pipeline"].as_array().unwrap().iter().zip(pages) {
        let name = page["name"].as_str().unwrap();
        let mut strokes = strokes(&js_page["strokes"]);
        for run in page["runs"].as_array().unwrap() {
            if let Some(i) = run["moved"].as_u64() {
                strokes[i as usize].points.iter_mut().for_each(|p| p[0] += 0.5);
            }
            let known: LineCache =
                run["known"].as_object().unwrap().iter().map(|(k, v)| (k.clone(), reading(v))).collect();
            let model = Replay::new(inferences(&run["inferences"]));
            let rust = recognize_page(&strokes, &DecodeOptions::default(), &known, &model, Some(lexicon()));
            let js = &run["result"];
            assert_eq!(model.remaining(), 0, "{name}: weniger Inferenzen als im JS");
            assert_eq!(rust.text, js["text"].as_str().unwrap(), "{name}: Text");
            let fresh: LineCache =
                js["lineCache"].as_object().unwrap().iter().map(|(k, v)| (k.clone(), reading(v))).collect();
            assert_eq!(rust.fresh.len(), fresh.len(), "{name}: Zeilen-Cache");
            for (key, js_reading) in &fresh {
                let r = rust.fresh.get(key).unwrap_or_else(|| panic!("{name}: Zeilenschlüssel {key} fehlt"));
                assert_eq!(r.text, js_reading.text);
                assert_eq!(r.status, js_reading.status);
                assert!((r.confidence - js_reading.confidence).abs() < 1e-12, "{name}: Konfidenz");
            }
            let acc = &js["accounting"];
            let a = rust.accounting();
            assert_eq!(a.recognized, acc["recognized"].as_u64().unwrap() as usize, "{name}");
            assert_eq!(a.uncertain, acc["uncertain"].as_u64().unwrap() as usize, "{name}");
            // Bewusste Abweichung: Skizzen-Striche sind im JS "nicht zugeordnet", hier übersprungen
            let js_unassigned = acc["unassigned"].as_u64().unwrap() as usize;
            assert_eq!(a.skipped, acc["skipped"].as_u64().unwrap() as usize + js_unassigned, "{name}");
            assert_eq!(rust.strokes.iter().filter(|s| **s == StrokeStatus::Sketch).count(), js_unassigned, "{name}");
            for (line, group) in rust.report.iter().zip(acc["groups"].as_array().unwrap()) {
                assert_eq!(line.cached, group["cached"].as_bool().unwrap(), "{name}");
                assert_eq!(line.image_width, group["imageWidth"].as_u64().unwrap() as usize, "{name}");
                assert_eq!(line.strokes.len(), group["strokesCount"].as_u64().unwrap() as usize, "{name}");
                let js_status = group["status"].as_str().unwrap();
                match &line.outcome {
                    LineOutcome::Read(s) => assert_eq!(s.as_str(), js_status, "{name}"),
                    LineOutcome::TooShort => assert_eq!(js_status, "skipped_too_short", "{name}"),
                    LineOutcome::Error(e) => panic!("{name}: {e}"),
                }
            }
            for (js_image, rust_image) in model.seen.borrow().iter() {
                let (mean, max, frac) = image_diff(js_image, rust_image);
                sum_mean += mean;
                sum_frac += frac;
                worst_max = worst_max.max(max);
                images += 1;
            }
        }
    }
    let (mean, frac) = (sum_mean / images as f64, sum_frac / images as f64);
    println!(
        "Rasterung gegen Skia: {images} Bilder, mittlere Abweichung {mean:.4}, größte {worst_max:.3}, Pixel > 0,1: {:.2} %",
        frac * 100.0
    );
    assert!(mean < 0.01 && frac < 0.02, "Rasterung weicht zu stark ab: {mean} / {frac}");
}
