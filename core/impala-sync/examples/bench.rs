//! Messungen am Sync-Kern (Median aus 5 Läufen).
//! `cargo run -p impala-sync --example bench --profile native`

use std::time::Instant;

use impala_sync::{BlobAliveChecker, PageTexts};
use serde_json::{Map, Value, json};

fn median(mut f: impl FnMut()) -> f64 {
    let mut ms: Vec<f64> = (0..5)
        .map(|_| {
            let t = Instant::now();
            f();
            t.elapsed().as_secs_f64() * 1000.0
        })
        .collect();
    ms.sort_by(f64::total_cmp);
    ms[2]
}

const UUID: &str = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

/// 2 000 Seiten mit je ≈ 5 KB Inhalt und einem Bildverweis.
fn pages() -> Map<String, Value> {
    let para = "Ein Absatz mit etwas Text, Umlauten äöü und einer Liste - eins - zwei. ";
    let content = format!("![](img:{UUID})\n{}", para.repeat(5000 / para.len() + 1));
    (0..2000)
        .map(|i| {
            let id = format!("page-{i}");
            (id.clone(), json!({ "id": id, "title": format!("Seite {i}"), "content": content, "kind": "notion" }))
        })
        .collect()
}

/// Blob-Prüfung: Seiten als JSON einlesen (früherer Weg der Ablagen) gegen fertige Seitentexte.
fn alive() {
    let pages = pages();
    let json = Value::Object(pages.clone()).to_string();
    let ids: Vec<String> = pages.keys().cloned().collect();
    let mut joined = PageTexts::default();
    pages
        .values()
        .filter_map(Value::as_object)
        .flat_map(Map::values)
        .filter_map(Value::as_str)
        .for_each(|s| joined.add_text(s));
    let text = joined.into_text();
    let key = format!("img:{UUID}");

    let from_json = median(|| {
        let pages: Map<String, Value> = serde_json::from_str(&json).unwrap();
        assert!(BlobAliveChecker::new(PageTexts::from_pages(&pages)).is_alive(&key));
    });
    let from_text = median(|| {
        let texts = PageTexts::from_joined(ids.iter().cloned(), text.clone());
        assert!(BlobAliveChecker::new(texts).is_alive(&key));
    });
    println!("Blob-Prüfung, 2 000 Seiten ({:.1} MB):", json.len() as f64 / 1e6);
    println!("  Seiten als JSON einlesen + prüfen: {from_json:>7.1} ms");
    println!("  fertige Seitentexte + prüfen:      {from_text:>7.1} ms");
}

fn main() {
    alive();
}
