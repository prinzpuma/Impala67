//! Messung: 100 000 Events aller Typen abspielen (Start ohne Checkpoint), Zustand als JSON,
//! 10 000 Fremd-Events live, Checkpoint speichern und laden. Gegenstück: `core/tools/bench-model.mjs`,
//! das auch die Eingabe `core/target/bench/model-events.json` schreibt (erst das ausführen).
//! `cargo run -p impala-model --example bench --profile native`

use std::time::Instant;

use impala_model::{LogEvent, Model};
use impala_storage::{MemoryStorage, Object, StorageExt};
use serde_json::Value;

const RUNS: usize = 5;

fn median(mut xs: Vec<f64>) -> f64 {
    xs.sort_by(f64::total_cmp);
    xs[xs.len() / 2]
}

fn ms(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1000.0
}

fn objects(v: &Value) -> Vec<Object> {
    v.as_array().into_iter().flatten().filter_map(|e| e.as_object().cloned()).collect()
}

fn main() {
    let path = format!("{}/../target/bench/model-events.json", env!("CARGO_MANIFEST_DIR"));
    let Ok(text) = std::fs::read_to_string(&path) else {
        eprintln!("{path} fehlt – zuerst `node core/tools/bench-model.mjs` ausführen.");
        std::process::exit(1);
    };
    let input: Value = serde_json::from_str(&text).unwrap();
    let (events, live) = (objects(&input["events"]), objects(&input["live"]));
    let n = events.len();
    let (mut parse, mut replay, mut json, mut apply, mut save, mut load) =
        (vec![], vec![], vec![], vec![], vec![], vec![]);
    for run in 0..RUNS {
        let t = Instant::now();
        let parsed: Vec<LogEvent> = events.iter().filter_map(LogEvent::from_object).collect();
        parse.push(ms(t));

        let t = Instant::now();
        let mut m = Model::from_events(parsed);
        replay.push(ms(t));

        let t = Instant::now();
        let text = serde_json::to_string(m.state()).unwrap();
        json.push(ms(t));

        let live_events: Vec<LogEvent> = live.iter().filter_map(LogEvent::from_object).collect();
        let t = Instant::now();
        for ev in live_events {
            m.apply_remote(vec![ev]);
        }
        apply.push(ms(t));

        // Checkpoint: Log + Zustand in den Speicher, dann Start vom Checkpoint.
        let mut s = MemoryStorage::new();
        s.add_events(events.clone()).unwrap();
        let (mut fresh, _) = Model::load(&mut s, "").unwrap();
        let t = Instant::now();
        fresh.save_checkpoint(&mut s).unwrap();
        save.push(ms(t));
        let t = Instant::now();
        let (_, report) = Model::load(&mut s, "").unwrap();
        load.push(ms(t));
        assert!(report.checkpoint_used);
        if run == 0 {
            let st = m.state();
            println!(
                "Zustand: {} Seiten, {} Karten, {} Reviews, JSON {:.1} MB",
                st.pages.len(),
                st.cards.len(),
                st.reviews.len(),
                text.len() as f64 / 1e6
            );
        }
    }
    println!("Rust nativ (Median aus {RUNS}):");
    println!("  {n} Events aus JSON-Objekten lesen:   {:>8.1} ms", median(parse));
    println!("  {n} Events sortieren + abspielen:     {:>8.1} ms", median(replay));
    println!("  Zustand als JSON (Checkpoint):          {:>8.1} ms", median(json));
    println!("  {} Fremd-Events einzeln live:        {:>8.1} ms", live.len(), median(apply));
    println!("  Checkpoint speichern (MemoryStorage):   {:>8.1} ms", median(save));
    println!("  Start vom Checkpoint (ohne Rest):       {:>8.1} ms", median(load));
}
