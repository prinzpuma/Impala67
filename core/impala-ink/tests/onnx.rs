//! tract gegen ONNX Runtime: gleiche Logits (kleine Toleranz) auf einem echten Zeilenbild, dazu der ganze
//! Ablauf mit Rust-Rasterung und tract gegen den Text des JS-Laufs (Skia + ONNX Runtime).
#![cfg(feature = "onnx")]

mod common;

use common::*;
use impala_ink::onnx::OnnxModel;
use impala_ink::vocab::CLASSES;
use impala_ink::{DecodeOptions, InkRecognizer, LineCache, LineModel, ModelRecognizer, decode_line};
use impala_net::block_on;

fn model() -> OnnxModel {
    OnnxModel::from_bytes(&model_bytes()).expect("Modell lädt")
}

#[test]
fn tract_wie_onnx_runtime() {
    let g = golden("tract.json");
    let width = g["width"].as_u64().unwrap() as usize;
    let img = image(width, g["image"].as_str().unwrap());
    let reference = f32s(g["logits"].as_str().unwrap());
    let ours = block_on(model().run(&img)).unwrap();
    assert_eq!(ours.len(), reference.len());
    assert_eq!(ours.len(), g["steps"].as_u64().unwrap() as usize * CLASSES);
    let max = ours.iter().zip(&reference).map(|(a, b)| (a - b).abs()).fold(0f32, f32::max);
    println!("tract gegen ONNX Runtime: größte Abweichung {max:e} über {} Logits", ours.len());
    assert!(max < 1e-3, "Logits weichen ab: {max}");
    let opts = DecodeOptions::default();
    let a = decode_line(&ours, CLASSES, &opts, Some(lexicon())).unwrap();
    let b = decode_line(&reference, CLASSES, &opts, Some(lexicon())).unwrap();
    assert_eq!(a.text, b.text);
}

/// Im Debug-Build dauert tract minutenlang: läuft mit `cargo test -p impala-ink --release`.
#[test]
#[cfg_attr(debug_assertions, ignore = "nur mit --release (tract ohne Optimierung zu langsam)")]
fn ganze_seiten_nativ() {
    let g = golden("pipeline.json");
    let recognizer = ModelRecognizer {
        model: model(),
        lexicon: Some(impala_ink::Lexicon::new(
            &std::fs::read_to_string(root().join("../../web/handwriting-lexicon-de.txt")).unwrap(),
        )),
    };
    let (mut same, mut total) = (0, 0);
    for (page, pre) in g["pipeline"].as_array().unwrap().iter().zip(g["preprocess"].as_array().unwrap()) {
        let strokes = strokes(&pre["strokes"]);
        let js = page["runs"][0]["result"]["text"].as_str().unwrap();
        let rust = block_on(recognizer.recognize_page(&strokes, &DecodeOptions::default(), &LineCache::new()));
        for (a, b) in rust.text.lines().zip(js.lines()) {
            total += 1;
            if a == b {
                same += 1;
            } else {
                println!("abweichend: Rust {a:?} / JS {b:?}");
            }
        }
        assert_eq!(rust.text.lines().count(), js.lines().count());
    }
    println!("Rust (eigene Rasterung + tract) gleich wie JS (Skia + ONNX Runtime): {same} von {total} Zeilen");
    assert!(same * 10 >= total * 8, "nur {same} von {total} Zeilen gleich");
}
