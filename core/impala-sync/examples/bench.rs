//! Upload-Strecke nativ: Kompaktierung, Wire-Aufbereitung + Chunking, Paketbau (SHA-256-ID,
//! gzip, AES-GCM). Eingaben von `node core/tools/bench-sync.mjs` (core/target/bench/sync-input.json).
//!   cargo run -p impala-sync --example bench --profile native

use std::time::Instant;

use impala_crypto::{OsRandom, SyncKey};
use impala_sync::{ChunkLimits, WireEvent, build_packets, chunk_cloud_events, compact_values, prepare_cloud_events};
use serde_json::Value;

/// Median aus 7 Läufen; `setup` (Eingaben klonen) und das Freigeben des Ergebnisses laufen
/// außerhalb der Zeitmessung.
fn median_with<T, R>(mut setup: impl FnMut() -> T, mut f: impl FnMut(T) -> R) -> f64 {
    let mut ms: Vec<f64> = (0..7)
        .map(|_| {
            let input = setup();
            let t0 = Instant::now();
            let out = std::hint::black_box(f(input));
            let ms = t0.elapsed().as_secs_f64() * 1000.0;
            drop(out);
            ms
        })
        .collect();
    ms.sort_by(f64::total_cmp);
    ms[3]
}

fn median<R>(mut f: impl FnMut() -> R) -> f64 {
    median_with(|| (), |()| f())
}

fn main() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../target/bench/sync-input.json");
    let Ok(text) = std::fs::read_to_string(path) else {
        eprintln!("{path} fehlt – zuerst: node core/tools/bench-sync.mjs");
        std::process::exit(1);
    };
    let events: Vec<Value> = serde_json::from_str(&text).expect("JSON");
    let key = SyncKey::parse("impala-0123-4567-89ab-cdef-0011-2233-4455-6677").unwrap().derive().key;
    let limits = ChunkLimits::default();

    // Gemessen wird die Entscheidung (Indizes); die behaltenen Events wandern in der App, statt
    // kopiert zu werden – das Klonen hier läuft außerhalb der Messung.
    let compact = median(|| compact_values(&events).expect("kompaktierbar"));
    let kept: Vec<Value> = compact_values(&events).unwrap().iter().map(|&i| events[i].clone()).collect();
    let prepare = median_with(
        || kept.clone(),
        |kept| {
            let wire: Vec<WireEvent> = prepare_cloud_events(kept, true).into_iter().map(WireEvent::new).collect();
            let chunks = chunk_cloud_events(&wire, limits);
            (wire, chunks)
        },
    );
    let wire: Vec<WireEvent> = prepare_cloud_events(kept.clone(), true).into_iter().map(WireEvent::new).collect();
    let pack = median(|| build_packets(&wire, limits, &key, &OsRandom).unwrap());
    let packets = build_packets(&wire, limits, &key, &OsRandom).unwrap().len();
    println!("Rust nativ: {} Events, {} behalten, {packets} Pakete", events.len(), kept.len());
    println!(
        "  Kompaktierung {compact:.1} ms, Aufbereitung+Chunking {prepare:.1} ms, Paketbau {pack:.1} ms, gesamt {:.1} ms (Median aus 7)",
        compact + prepare + pack
    );
}
