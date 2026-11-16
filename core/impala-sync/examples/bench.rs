//! Messungen am Sync-Kern (Median aus 5 Läufen).
//! `cargo run -p impala-sync --example bench --profile native -- alive|push`

use std::time::Instant;

use impala_crypto::{CipherKey, CounterRandom};
use impala_sync::{BlobAliveChecker, ChunkLimits, PageTexts, WireEvent, build_packets, upload_bodies};
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

/// Upload vorbereiten: 4 000 Events zu je ≈ 5 KB serialisieren, bündeln, verschlüsseln und zu
/// Anfragekörpern zusammensetzen (Zeit; den Spitzen-Speicher des Prozesses von außen ablesen).
fn push() {
    const WORDS: [&str; 16] = [
        "Notiz",
        "Vorlesung",
        "Übung",
        "Beweis",
        "Skizze",
        "Formel",
        "Wert",
        "und",
        "der",
        "die",
        "ein",
        "mit",
        "für",
        "Aufgabe",
        "Lösung",
        "Kapitel",
    ];
    let mut x = 88172645463325252u64;
    let mut word = move || {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        // Mit Ziffern: Text, der sich etwa wie echte Notizen packen lässt.
        format!("{}{} ", WORDS[(x % 16) as usize], x % 97)
    };
    let events: Vec<Value> = (0..4000)
        .map(|i| {
            let content: String = (0..550).map(|_| word()).collect();
            json!({
                "id": format!("ev-{i:05}"), "t": format!("2026-01-01T00:{:02}:{:02}.000Z", i / 60 % 60, i % 60),
                "type": "pageUpdate", "payload": { "id": format!("page-{}", i % 200), "patch": { "content": content } },
            })
        })
        .collect();
    let key = CipherKey::from_bytes([7; 32]);
    let rng = CounterRandom::new(0);
    let t = Instant::now();
    let wire: Vec<WireEvent> = events.into_iter().map(WireEvent::new).collect();
    let json_bytes: usize = wire.iter().map(|ev| ev.json.len()).sum();
    let t_wire = t.elapsed().as_secs_f64() * 1000.0;
    let packets = build_packets(&wire, ChunkLimits::default(), &key, &rng).unwrap();
    let t_packets = t.elapsed().as_secs_f64() * 1000.0 - t_wire;
    let bodies = upload_bodies(&packets);
    let ms = t.elapsed().as_secs_f64() * 1000.0;
    println!(
        "  serialisieren {t_wire:.0} ms, packen + verschlüsseln {t_packets:.0} ms, Anfragen {:.1} ms",
        ms - t_wire - t_packets
    );
    let body_bytes: usize = bodies.iter().map(String::len).sum();
    println!(
        "Upload vorbereiten, 4 000 Events ({:.1} MB JSON → {} Pakete, {:.1} MB Anfragen): {ms:.0} ms",
        json_bytes as f64 / 1e6,
        packets.len(),
        body_bytes as f64 / 1e6
    );
}

fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("alive") => alive(),
        Some("push") => push(),
        _ => eprintln!("Aufruf: bench alive|push"),
    }
}
