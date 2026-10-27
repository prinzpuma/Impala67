//! Messung: 100 000 Events anhängen/lesen. Gegenstück: `core/tools/bench-storage.mjs`.
//! `cargo run -p impala-storage --example bench --profile native`

use std::time::Instant;

use impala_storage::*;
use serde_json::{Value, json};

const N: usize = 100_000;
const SINGLE: usize = 1_000;
const RUNS: usize = 5;

fn event(i: usize) -> Object {
    let v = json!({
        "id": format!("ev-{i:08}"),
        "t": format!("2026-01-01T00:{:02}:{:02}.{:03}Z", i / 60_000 % 60, i / 1000 % 60, i % 1000),
        "type": "pageUpdate",
        "payload": {"id": format!("page-{}", i % 500), "patch": {"content": format!("Absatz {i} – etwas Text für eine typische Seite.")}},
    });
    v.as_object().cloned().unwrap()
}

fn median(mut xs: Vec<f64>) -> f64 {
    xs.sort_by(f64::total_cmp);
    xs[xs.len() / 2]
}

fn ms(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1000.0
}

fn run(name: &str, make: &dyn Fn() -> Box<dyn Storage>) {
    let events: Vec<Object> = (0..N).map(event).collect();
    let file =
        json!({"app": "impala67", "events": events.iter().cloned().map(Value::Object).collect::<Vec<_>>()}).to_string();
    let (mut bulk, mut import, mut single, mut read, mut tail, mut info) =
        (vec![], vec![], vec![], vec![], vec![], vec![]);
    for _ in 0..RUNS {
        let mut s = make();
        let batch = events.clone();
        let t = Instant::now();
        s.add_events(batch).unwrap();
        bulk.push(ms(t));

        let t = Instant::now();
        assert_eq!(s.all_events().unwrap().len(), N);
        read.push(ms(t));

        let t = Instant::now();
        assert_eq!(s.events_after(N as u64 - 1000, None, None).unwrap().len(), 1000);
        tail.push(ms(t));

        let t = Instant::now();
        assert_eq!(s.log_info().unwrap().count, N as u64);
        info.push(ms(t));

        let t = Instant::now();
        for i in 0..SINGLE {
            s.add_events(vec![event(N + i)]).unwrap();
        }
        single.push(ms(t));

        let mut fresh = make();
        let t = Instant::now();
        assert_eq!(fresh.import_all(&file, &ImportOptions::default()).unwrap().added, N);
        import.push(ms(t));
    }
    println!("{name}:");
    println!("  {N} Events in einer Transaktion anhängen: {:>8.1} ms", median(bulk));
    println!("  {N} Events per import_all (Dubletten-Prüfung): {:>8.1} ms", median(import));
    println!("  {SINGLE} Events einzeln (je eine Transaktion):  {:>8.1} ms", median(single));
    println!("  alle {N} Events lesen:                    {:>8.1} ms", median(read));
    println!("  letzte 1000 Events lesen (Rest nach Checkpoint): {:>8.2} ms", median(tail));
    println!("  log_info (count + letztes Event):          {:>8.2} ms", median(info));
}

fn main() {
    run("MemoryStorage", &|| Box::new(MemoryStorage::new()));
    #[cfg(feature = "sqlite")]
    {
        let dir = std::env::temp_dir().join(format!("impala-storage-bench-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let counter = std::cell::Cell::new(0);
        run("SqliteStorage (Datei, WAL)", &|| {
            counter.set(counter.get() + 1);
            Box::new(SqliteStorage::open(dir.join(format!("{}.db", counter.get()))).unwrap())
        });
        let _ = std::fs::remove_dir_all(&dir);
    }
}
