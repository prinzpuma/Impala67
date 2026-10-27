//! Handschrift für die PWA: der ganze Seitenablauf (`impala-ink`: Zeilen bilden, Zeilen-Cache,
//! begradigen, rastern, breite Zeilen stückeln, dekodieren, Strich-Bilanz) in Rust. Nur die
//! Inferenz liefert JS (ONNX Runtime Web im Handschrift-Worker) über `model.run`.

use std::rc::Rc;

use impala_ink::page::{LineOutcome, StrokeStatus};
use impala_ink::preprocess::{self, Stroke, Tool};
use impala_ink::raster::MAX_TRAINING_WIDTH;
use impala_ink::{
    DecodeOptions, InkError, Lexicon, LineCache, LineImage, LineModel, LineReading, Mode, Status, recognize_page,
};
use js_sys::{Float32Array, Promise};
use serde_json::{Map, Value, json};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::{JsFuture, future_to_promise};

use crate::js::{call_sync, js_message, to_js};

/// Striche aus JSON (`[{ id, tool, pts: [[x, y, …], …] }]`); kaputte Punkte fallen weg.
fn strokes_from(json: &str) -> Result<Vec<Stroke>, JsError> {
    let v: Value = serde_json::from_str(json).map_err(|e| JsError::new(&format!("Striche unlesbar: {e}")))?;
    Ok(v.as_array()
        .map(|items| {
            items
                .iter()
                .map(|s| Stroke {
                    id: match &s["id"] {
                        Value::String(id) => id.clone(),
                        Value::Number(n) => n.to_string(),
                        _ => String::new(),
                    },
                    tool: Tool::from_name(s["tool"].as_str().unwrap_or("")),
                    points: s["pts"]
                        .as_array()
                        .map(|pts| {
                            pts.iter().filter_map(|p| Some([p.get(0)?.as_f64()?, p.get(1)?.as_f64()?])).collect()
                        })
                        .unwrap_or_default(),
                })
                .collect()
        })
        .unwrap_or_default())
}

fn status_from(name: &str) -> Status {
    match name {
        "recognized" => Status::Recognized,
        "uncertain" => Status::Uncertain,
        "drawing" => Status::Drawing,
        _ => Status::Empty,
    }
}

fn options_from(json: &str) -> DecodeOptions {
    let v: Value = serde_json::from_str(json).unwrap_or(Value::Null);
    let mode = match v["mode"].as_str() {
        Some("text") => Mode::Text,
        Some("math") => Mode::Math,
        _ => Mode::Auto,
    };
    DecodeOptions { mode, threshold: v["threshold"].as_f64().unwrap_or(DecodeOptions::default().threshold) }
}

/// Modell der Plattform: `model.run(data, width)` → Promise<Float32Array> (Logits `steps × Klassen`),
/// `model.lineStarted(line, lines)` vor jeder Zeile.
struct JsModel(JsValue);

impl LineModel for JsModel {
    async fn run(&self, image: &LineImage) -> Result<Vec<f32>, InkError> {
        let data = Float32Array::from(image.data.as_slice());
        let ret = call_sync(&self.0, "run", &[data.into(), (image.width as f64).into()]).map_err(InkError::Model)?;
        let out = JsFuture::from(Promise::resolve(&ret)).await.map_err(|e| InkError::Model(js_message(&e)))?;
        Ok(Float32Array::new(&out).to_vec())
    }

    fn line_started(&self, line: usize, lines: usize) {
        let _ = call_sync(&self.0, "lineStarted", &[(line as f64).into(), (lines as f64).into()]);
    }
}

/// Erkenner mit (optionalem) großem Wörterbuch.
#[wasm_bindgen]
pub struct InkEngine {
    lexicon: Rc<Option<Lexicon>>,
}

#[wasm_bindgen]
impl InkEngine {
    /// `lexicon`: Bytes von `handwriting-lexicon-de.txt` (UTF-8, ein Wort je Zeile). Ohne Angabe kein Wörterbuch.
    #[wasm_bindgen(constructor)]
    pub fn new(lexicon: Option<Vec<u8>>) -> Result<InkEngine, JsError> {
        let lexicon = lexicon
            .map(|bytes| String::from_utf8(bytes).map(|text| Lexicon::new(&text)))
            .transpose()
            .map_err(|_| JsError::new("Wörterbuch ist kein UTF-8"))?;
        Ok(InkEngine { lexicon: Rc::new(lexicon) })
    }

    /// Wörter im Wörterbuch (0 ohne).
    #[wasm_bindgen(getter, js_name = lexiconSize)]
    pub fn lexicon_size(&self) -> usize {
        self.lexicon.as_ref().as_ref().map_or(0, Lexicon::len)
    }

    /// Erkennt die Striche einer Seite (JSON). `known`: `{ Zeilenschlüssel: { text, confidence, status } }`
    /// schon gelesener Zeilen; nur neue gehen durchs Modell. Ergebnis wie bisher:
    /// `{ text, lines, lineCache, accounting: { total, recognized, uncertain, skipped, unassigned, balanced, groups } }`.
    #[wasm_bindgen(js_name = recognizePage)]
    pub fn recognize_page(
        &self,
        strokes: &str,
        options: &str,
        known: &str,
        model: JsValue,
    ) -> Result<Promise, JsError> {
        let strokes = strokes_from(strokes)?;
        let options = options_from(options);
        let known: LineCache = match serde_json::from_str::<Value>(known) {
            Ok(Value::Object(m)) => m
                .into_iter()
                .map(|(k, r)| {
                    let reading = LineReading {
                        text: r["text"].as_str().unwrap_or("").to_owned(),
                        confidence: r["confidence"].as_f64().unwrap_or(0.0),
                        status: status_from(r["status"].as_str().unwrap_or("")),
                    };
                    (k, reading)
                })
                .collect(),
            _ => LineCache::new(),
        };
        let lexicon = Rc::clone(&self.lexicon);
        Ok(future_to_promise(async move {
            let page = recognize_page(&strokes, &options, &known, &JsModel(model), lexicon.as_ref().as_ref()).await;
            let acc = page.accounting();
            let groups: Vec<Value> = page
                .report
                .iter()
                .map(|l| {
                    let (status, error) = match &l.outcome {
                        LineOutcome::Read(s) => (s.as_str(), None),
                        LineOutcome::TooShort => ("skipped_too_short", None),
                        LineOutcome::Error(e) => ("error", Some(e.clone())),
                    };
                    json!({
                        "strokesCount": l.strokes.len(), "imageWidth": l.image_width, "cached": l.cached,
                        "status": status, "confidence": l.confidence, "text": l.text,
                        "tooLong": l.image_width > MAX_TRAINING_WIDTH, "error": error,
                    })
                })
                .collect();
            let sketches = page.strokes.iter().filter(|s| **s == StrokeStatus::Sketch).count();
            let line_cache: Map<String, Value> = page
                .fresh
                .iter()
                .map(|(k, r)| {
                    (k.clone(), json!({ "text": r.text, "confidence": r.confidence, "status": r.status.as_str() }))
                })
                .collect();
            Ok(to_js(&json!({
                "text": page.text,
                "lines": page.lines,
                "lineCache": line_cache,
                "accounting": {
                    "total": strokes.len(), "recognized": acc.recognized, "uncertain": acc.uncertain,
                    "skipped": acc.skipped, "sketches": sketches, "unassigned": 0,
                    "balanced": acc.recognized + acc.uncertain + acc.skipped == strokes.len(), "groups": groups,
                },
            })))
        }))
    }
}

/// Textzeilen einer Seite: je Zeile die Indizes ihrer Striche (JSON) in Lesereihenfolge.
#[wasm_bindgen(js_name = inkSegmentLines)]
pub fn ink_segment_lines(strokes: &str) -> Result<JsValue, JsError> {
    let lines: Vec<Vec<usize>> =
        preprocess::segment_lines(&strokes_from(strokes)?).into_iter().map(|l| l.strokes).collect();
    Ok(to_js(&json!(lines)))
}

/// Lesereihenfolge der Striche einer (waagerechten) Zeile als Indizes.
#[wasm_bindgen(js_name = inkOrderLineStrokes)]
pub fn ink_order_line_strokes(strokes: &str) -> Result<Vec<u32>, JsError> {
    Ok(preprocess::order_line_strokes(&strokes_from(strokes)?).into_iter().map(|i| i as u32).collect())
}

/// Editierabstand zweier Texte (Zeichenfehler der Erkennung).
#[wasm_bindgen(js_name = inkLevenshtein)]
pub fn ink_levenshtein(a: &str, b: &str) -> usize {
    impala_ink::levenshtein(a, b)
}
