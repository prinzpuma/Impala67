//! Misst parse/serialize auf derselben Eingabe wie core/tools/bench-markdown.mjs (erst das
//! JS-Skript ausführen, es schreibt core/target/bench-markdown.md).

use std::time::Instant;

fn median(mut f: impl FnMut()) -> f64 {
    let mut ms: Vec<f64> = (0..11)
        .map(|_| {
            let t0 = Instant::now();
            f();
            t0.elapsed().as_secs_f64() * 1000.0
        })
        .collect();
    ms.sort_by(f64::total_cmp);
    ms[5]
}

fn main() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../target/bench-markdown.md");
    let Ok(md) = std::fs::read_to_string(path) else {
        eprintln!("{path} fehlt – erst: node core/tools/bench-markdown.mjs");
        return;
    };
    let mut n = 0u64;
    let mut uid = || {
        n += 1;
        format!("b{n}")
    };
    let blocks = impala_markdown::parse(&md, &mut uid);
    let p = median(|| {
        std::hint::black_box(impala_markdown::parse(&md, &mut uid));
    });
    let s = median(|| {
        std::hint::black_box(impala_markdown::serialize(&blocks));
    });
    println!(
        "Rust: {} Blöcke, {} KiB – parse {p:.2} ms, serialize {s:.2} ms (Median aus 11)",
        blocks.len(),
        md.len() / 1024
    );
}
