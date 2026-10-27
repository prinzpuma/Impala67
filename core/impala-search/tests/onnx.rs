//! ONNX-Embedder (Feature `onnx`): Pipeline mit einem winzigen Test-Modell
//! (`tests/fixtures/tiny-model`, erzeugt von `make.py`) und Ende-zu-Ende mit dem echten Modell.
#![cfg(feature = "onnx")]

use std::path::{Path, PathBuf};

use impala_search::embed::{Embedder, LOCAL_EMBEDDING_MODELS, LocalModel};
use impala_search::onnx::OnnxEmbedder;
use impala_search::{cosine, index_page};

const TINY: LocalModel = LocalModel { id: "tiny", dim: 3, context: 8, ..LOCAL_EMBEDDING_MODELS[0] };

fn tiny() -> OnnxEmbedder {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/tiny-model");
    OnnxEmbedder::load(&dir, &TINY).expect("Test-Modell lädt")
}

fn unit(v: [f32; 3]) -> Vec<f32> {
    let n = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    v.iter().map(|x| x / n).collect()
}

fn close(a: &[f32], b: &[f32]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-5)
}

#[test]
fn tiny_model_pools_truncates_and_normalizes() {
    let e = tiny();
    assert_eq!((e.model_key(), e.provider_id(), e.dim()), ("tiny", "local", 3));
    // Zweiter Text wird aufgefüllt: die Maske hält [PAD] aus dem Mittelwert.
    let v = e.embed(&["Licht Wasser", "licht", "unbekannt"]).unwrap();
    assert!(close(&v[0], &unit([0.9, 0.1, 0.0])), "{:?}", v[0]);
    assert!(close(&v[1], &unit([1.0, 0.0, 0.0])), "{:?}", v[1]);
    assert!(close(&v[2], &unit([0.1, 0.1, 0.1])), "{:?}", v[2]);
    // Kürzen über den Kontext hinaus: nur die ersten 8 Token zählen.
    let long = e.embed(&["licht licht licht licht licht licht licht licht auto auto"]).unwrap();
    assert!(close(&long[0], &unit([1.0, 0.0, 0.0])));
    assert!(e.embed(&[]).unwrap().is_empty());
}

#[test]
fn tiny_model_indexes_a_page() {
    let e = tiny();
    let rec = index_page(&e, "Licht Wasser\n\nAuto Motor", "t1", None).unwrap().unwrap();
    assert_eq!(rec.model.as_deref(), Some("tiny"));
    assert_eq!(rec.chunks.len(), 1);
    assert!(rec.chunks[0].norm.is_some_and(|n| (n - 1.0).abs() < 1e-5));
}

/// Ende-zu-Ende mit dem echten Modell. Im Container nicht herunterladbar, daher `#[ignore]`.
///
/// Ausführen:
/// 1. Modell holen: `git lfs install && git clone https://huggingface.co/hotchpotch/bekko-embedding-v1-a8m <dir>`
///    (benötigt werden `tokenizer.json` und `onnx/model.onnx`).
/// 2. Optional Referenz-Vektoren aus der PWA (MCP-Bridge `impala_eval` oder Konsole):
///    `JSON.stringify({ texts, vectors: await EMBEDDINGS.embedLocal(texts) })` mit den Texten unten
///    als `<dir>/impala-reference.json` speichern.
/// 3. `IMPALA_EMBED_MODEL_DIR=<dir> cargo test -p impala-search --features onnx --release -- --ignored`
#[test]
#[ignore = "braucht das echte Modell in IMPALA_EMBED_MODEL_DIR"]
fn bekko_end_to_end() {
    let dir = PathBuf::from(std::env::var("IMPALA_EMBED_MODEL_DIR").expect("IMPALA_EMBED_MODEL_DIR setzen"));
    let e = OnnxEmbedder::load(&dir, &LOCAL_EMBEDDING_MODELS[0]).expect("Modell lädt");
    let texts = [
        "Die Photosynthese wandelt Lichtenergie in chemische Energie um.",
        "Pflanzen nutzen Sonnenlicht, um Zucker herzustellen.",
        "Der Motor des Autos braucht einen Ölwechsel.",
    ];
    let v = e.embed(&texts).unwrap();
    assert_eq!(e.model_key(), "local:bekko-a8m#r2");
    for x in &v {
        assert_eq!(x.len(), 256);
        assert!((x.iter().map(|a| a * a).sum::<f32>() - 1.0).abs() < 1e-4);
    }
    assert!(cosine(&v[0], &v[1]) > cosine(&v[0], &v[2]), "ähnliche Sätze liegen näher");
    let reference = dir.join("impala-reference.json");
    if let Ok(json) = std::fs::read_to_string(&reference) {
        let r: serde_json::Value = serde_json::from_str(&json).unwrap();
        let texts: Vec<&str> = r["texts"].as_array().unwrap().iter().map(|t| t.as_str().unwrap()).collect();
        let got = e.embed(&texts).unwrap();
        for (g, want) in got.iter().zip(r["vectors"].as_array().unwrap()) {
            let want: Vec<f32> = want.as_array().unwrap().iter().map(|x| x.as_f64().unwrap() as f32).collect();
            let sim = cosine(g, &want);
            assert!(sim > 0.999, "Abweichung zur PWA: Kosinus {sim}");
        }
    }
}
