//! Messung nativ: CTC-Dekodierung (Beam-Search + Wörterbuch) auf den realen Logits der Golden-Files und
//! Modell-Inferenz mit tract. Gegenstück fürs JS: core/tools/bench-ink.mjs (gleiche Eingaben).
//!   cargo run -p impala-ink --example bench --profile native

#[path = "../tests/common/mod.rs"]
mod common;

use std::time::Instant;

use common::*;
use impala_ink::onnx::OnnxModel;
use impala_ink::raster::{WORD_GAP_PX, find_ink_gaps};
use impala_ink::vocab::CLASSES;
use impala_ink::{DecodeOptions, Lexicon, LineModel, decode_line, mark_gap_spaces};

/// Median in ms über `runs` Läufe
fn median(runs: usize, mut f: impl FnMut()) -> f64 {
    f();
    let mut ms: Vec<f64> = (0..runs)
        .map(|_| {
            let t = Instant::now();
            f();
            t.elapsed().as_secs_f64() * 1000.0
        })
        .collect();
    ms.sort_by(f64::total_cmp);
    ms[runs / 2]
}

fn main() {
    let g = golden("pipeline.json");
    let mut lines = Vec::new();
    for page in g["pipeline"].as_array().unwrap() {
        lines.extend(inferences(&page["runs"][0]["inferences"]));
    }
    let steps: usize = lines.iter().map(|l| l.logits.len() / CLASSES).sum();
    let text = std::fs::read_to_string(root().join("../../web/handwriting-lexicon-de.txt")).unwrap();
    let load = median(5, || drop(Lexicon::new(&text)));
    let lexicon = Lexicon::new(&text);
    println!("Wörterbuch laden ({} Wörter): {load:.1} ms", lexicon.len());

    let prepared: Vec<Vec<f32>> = lines
        .iter()
        .map(|l| {
            let mut logits = l.logits.clone();
            mark_gap_spaces(&mut logits, CLASSES, &find_ink_gaps(&l.image, WORD_GAP_PX), l.width).unwrap();
            logits
        })
        .collect();
    let opts = DecodeOptions::default();
    for (name, lex) in [("mit Wörterbuch", Some(&lexicon)), ("ohne Wörterbuch", None)] {
        let ms = median(15, || {
            for l in &prepared {
                std::hint::black_box(decode_line(l, CLASSES, &opts, lex).unwrap());
            }
        });
        println!("Dekodieren {name}: {} Zeilen, {steps} Schritte: {ms:.2} ms (Median aus 15)", prepared.len());
    }

    let bytes = model_bytes();
    let t = Instant::now();
    let model = OnnxModel::from_bytes(&bytes).unwrap();
    println!("tract: Modell laden + optimieren {:.0} ms", t.elapsed().as_secs_f64() * 1000.0);
    for width in [312, 612, 1032] {
        let Some(line) = lines.iter().find(|l| l.width == width) else { continue };
        let ms = median(5, || drop(impala_net::block_on(model.run(&line.image)).unwrap()));
        println!("tract: Inferenz Breite {width} px: {ms:.1} ms (Median aus 5)");
    }
}
