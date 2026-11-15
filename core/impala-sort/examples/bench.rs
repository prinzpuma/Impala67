//! Messung: `sort_small_by` gegen `slice::sort_by` (Median aus 5 Läufen).
//! `cargo run -p impala-sort --example bench --profile native`

use std::time::Instant;

use impala_sort::SortExt;

fn median(mut f: impl FnMut() -> f64) -> f64 {
    let mut xs: Vec<f64> = (0..5).map(|_| f()).collect();
    xs.sort_by(f64::total_cmp);
    xs[2]
}

fn time<T: Clone>(input: &[T], sort: impl Fn(&mut Vec<T>)) -> f64 {
    median(|| {
        let mut v = input.to_vec();
        let t = Instant::now();
        sort(&mut v);
        t.elapsed().as_secs_f64() * 1000.0
    })
}

fn main() {
    let mut x = 88172645463325252u64;
    let mut next = move || {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        x
    };
    const N: usize = 100_000;
    // Event-Log: Zeitstempel als Text, schon in Reihenfolge.
    let sorted: Vec<String> = (0..N).map(|i| format!("2026-01-01T00:00:00.{i:09}Z")).collect();
    // Fast sortiert: jedes 100. Event steht an der falschen Stelle (Fremd-Events).
    let mut nearly = sorted.clone();
    for i in (0..N).step_by(100) {
        nearly.swap(i, (next() % N as u64) as usize);
    }
    let random: Vec<(u64, u64)> = (0..N).map(|_| (next(), next())).collect();
    let small: Vec<Vec<(f64, u32)>> =
        (0..N / 10).map(|_| (0..10).map(|i| ((next() % 1000) as f64, i)).collect()).collect();

    let row = |name: &str, std: f64, small: f64| println!("{name:<44} std {std:>8.2} ms   small {small:>8.2} ms");
    row("100 000 Zeitstempel, sortiert", time(&sorted, |v| v.sort()), time(&sorted, |v| v.sort_small()));
    row("100 000 Zeitstempel, 1 % verstreut", time(&nearly, |v| v.sort()), time(&nearly, |v| v.sort_small()));
    row(
        "100 000 Zufallspaare",
        time(&random, |v| v.sort_by_key(|a| a.0)),
        time(&random, |v| v.sort_small_by_key(|a| a.0)),
    );
    row(
        "10 000 Listen mit 10 Einträgen",
        time(&small, |v| v.iter_mut().for_each(|l| l.sort_by(|a, b| b.0.total_cmp(&a.0)))),
        time(&small, |v| v.iter_mut().for_each(|l| l.sort_small_by(|a, b| b.0.total_cmp(&a.0)))),
    );
}
