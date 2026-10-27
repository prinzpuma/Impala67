//! Gemeinsames für die Golden-Tests und die Messung: Golden-Files lesen (erzeugt von
//! core/tools/gen-golden-ink.mjs), Binärdaten entpacken, aufgezeichnete Modellausgaben abspielen.
#![allow(dead_code)]

use std::cell::RefCell;
use std::collections::VecDeque;
use std::io::Read;
use std::path::PathBuf;
use std::sync::OnceLock;

use impala_ink::raster::IMAGE_HEIGHT;
use impala_ink::vocab::CLASSES;
use impala_ink::{InkError, Lexicon, LineImage, LineModel, Stroke, Tool};
use serde_json::Value;

pub fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

pub fn golden(name: &str) -> Value {
    let text = std::fs::read_to_string(root().join("tests/golden").join(name)).expect("Golden-File fehlt");
    serde_json::from_str(&text).expect("Golden-File ist kein JSON")
}

pub fn lexicon() -> &'static Lexicon {
    static LEX: OnceLock<Lexicon> = OnceLock::new();
    LEX.get_or_init(|| {
        let text =
            std::fs::read_to_string(root().join("../../web/handwriting-lexicon-de.txt")).expect("Wörterbuch fehlt");
        Lexicon::new(&text)
    })
}

pub fn model_bytes() -> Vec<u8> {
    std::fs::read(root().join("../../web/handwriting-model.onnx")).expect("Modell fehlt")
}

/// base64(deflateRaw(bytes)) → bytes
pub fn unpack(b64: &str) -> Vec<u8> {
    let table = |c: u8| match c {
        b'A'..=b'Z' => c - b'A',
        b'a'..=b'z' => c - b'a' + 26,
        b'0'..=b'9' => c - b'0' + 52,
        b'+' => 62,
        _ => 63,
    };
    let clean: Vec<u8> = b64.bytes().filter(|&c| c != b'=').collect();
    let mut raw = Vec::with_capacity(clean.len() * 3 / 4);
    for chunk in clean.chunks(4) {
        let v = chunk.iter().enumerate().fold(0u32, |acc, (i, &c)| acc | (table(c) as u32) << (18 - 6 * i));
        raw.extend_from_slice(&v.to_be_bytes()[1..chunk.len()]);
    }
    let mut out = Vec::new();
    flate2::read::DeflateDecoder::new(&raw[..]).read_to_end(&mut out).expect("deflate");
    out
}

/// Kompakte Logits (je Schritt Minimum + 8 größte Werte, Vielfache von 1/256) → steps × CLASSES
pub fn logits(b64: &str, steps: usize) -> Vec<f32> {
    let bytes = unpack(b64);
    let i16_at = |o: usize| i16::from_le_bytes([bytes[o], bytes[o + 1]]) as f32 / 256.0;
    let mut out = vec![0f32; steps * CLASSES];
    for t in 0..steps {
        let o = t * 26;
        out[t * CLASSES..(t + 1) * CLASSES].fill(i16_at(o));
        for k in 0..8 {
            let p = o + 2 + k * 3;
            out[t * CLASSES + bytes[p] as usize] = i16_at(p + 1);
        }
    }
    out
}

pub fn f32s(b64: &str) -> Vec<f32> {
    unpack(b64).chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect()
}

pub fn image(width: usize, b64: &str) -> LineImage {
    LineImage::from_gray(width, &unpack(b64)).expect("Bildgröße")
}

pub fn strokes(v: &Value) -> Vec<Stroke> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|s| Stroke {
            id: s["id"].as_str().unwrap_or("").to_string(),
            tool: Tool::from_name(s["tool"].as_str().unwrap_or("")),
            points: s["pts"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| [p[0].as_f64().unwrap(), p[1].as_f64().unwrap()])
                .collect(),
        })
        .collect()
}

/// Aufgezeichnete Inferenz des JS-Laufs
pub struct Recorded {
    pub width: usize,
    pub image: LineImage,
    pub logits: Vec<f32>,
}

pub fn inferences(v: &Value) -> Vec<Recorded> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|i| {
            let width = i["width"].as_u64().unwrap() as usize;
            Recorded {
                width,
                image: image(width, i["image"].as_str().unwrap()),
                logits: logits(i["logits"].as_str().unwrap(), i["steps"].as_u64().unwrap() as usize),
            }
        })
        .collect()
}

/// Spielt die Modellausgaben des JS-Laufs in derselben Reihenfolge ab und merkt sich die Bilder,
/// die Rust dem Modell gegeben hätte.
pub struct Replay {
    queue: RefCell<VecDeque<Recorded>>,
    pub seen: RefCell<Vec<(LineImage, LineImage)>>,
}

impl Replay {
    pub fn new(recorded: Vec<Recorded>) -> Self {
        Replay { queue: RefCell::new(recorded.into()), seen: RefCell::new(Vec::new()) }
    }

    pub fn remaining(&self) -> usize {
        self.queue.borrow().len()
    }
}

impl LineModel for Replay {
    async fn run(&self, image: &LineImage) -> Result<Vec<f32>, InkError> {
        let rec = self.queue.borrow_mut().pop_front().ok_or(InkError::Model("keine Aufzeichnung mehr".into()))?;
        assert_eq!(rec.width, image.width, "Bildbreite weicht vom JS ab");
        self.seen.borrow_mut().push((rec.image, image.clone()));
        Ok(rec.logits)
    }
}

/// Abweichung zweier Bilder gleicher Größe: (mittlere, größte, Anteil Pixel mit > 0,1)
pub fn image_diff(a: &LineImage, b: &LineImage) -> (f64, f64, f64) {
    assert_eq!(a.data.len(), b.data.len());
    assert_eq!(a.data.len(), a.width * IMAGE_HEIGHT);
    let diffs: Vec<f64> = a.data.iter().zip(&b.data).map(|(x, y)| (x - y).abs() as f64).collect();
    let n = diffs.len() as f64;
    (
        diffs.iter().sum::<f64>() / n,
        diffs.iter().copied().fold(0.0, f64::max),
        diffs.iter().filter(|&&d| d > 0.1).count() as f64 / n,
    )
}
