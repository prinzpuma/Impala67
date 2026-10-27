//! Messung nativ: Vektorsuche (20 000 × 384, Top-k), RAG-Hybrid-Ranking und Unscharf-Suche
//! über 2 000 Seiten (feste Zufallseingaben).
//! `cargo run -p impala-search --example bench --profile native`

use std::collections::HashMap;
use std::time::Instant;

use impala_search::{
    EmbeddingIdentity, FuzzyIndex, PageMeta, VecRecord, VectorIndex, rank_rag, store::ChunkVec, top_k,
};

/// mulberry32 wie im JS.
struct Rng(u32);
impl Rng {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let mut t = (self.0 ^ (self.0 >> 15)).wrapping_mul(1 | self.0);
        t = (t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t))) ^ t;
        f64::from(t ^ (t >> 14)) / 4_294_967_296.0
    }
    fn pick(&mut self, n: usize) -> usize {
        (self.next() * n as f64) as usize
    }
}

const SYL: [&str; 20] = [
    "ka", "lo", "mi", "ne", "ru", "sa", "te", "vo", "zu", "ber", "chen", "dor", "fel", "gru", "hal", "ion", "kraft",
    "licht", "mat", "phy",
];

fn word(r: &mut Rng) -> String {
    let n = 2 + r.pick(3);
    (0..n).map(|_| SYL[r.pick(SYL.len())]).collect()
}

fn text(r: &mut Rng, n: usize) -> String {
    (0..n).map(|_| word(r)).collect::<Vec<_>>().join(" ")
}

fn median(mut f: impl FnMut(), runs: usize) -> f64 {
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
    let (n, dim, k) = (20_000usize, 384usize, 10usize);
    let mut r = Rng(42);
    let matrix: Vec<f32> = (0..n * dim).map(|_| (r.next() - 0.5) as f32).collect();
    let query: Vec<f32> = (0..dim).map(|_| (r.next() - 0.5) as f32).collect();
    let mut best = Vec::new();
    let ms = median(|| best = top_k(&matrix, dim, &query, k).unwrap(), 9);
    println!("Vektorsuche {n} × {dim}, Top-{k}: {ms:.2} ms (bester Zeilenindex {})", best[0].index);

    // RAG-Ranking: 2 000 Seiten × 10 Chunks, Chunk-Texte mit 40 Wörtern.
    let id = EmbeddingIdentity { model: "m".into(), provider_id: "local".into() };
    let mut pages = HashMap::new();
    let mut records = Vec::new();
    for p in 0..n / 10 {
        let chunks = (0..10)
            .map(|c| ChunkVec {
                text: text(&mut r, 40),
                vec: Some(matrix[(p * 10 + c) * dim..(p * 10 + c + 1) * dim].to_vec()),
                norm: None,
            })
            .collect();
        let pid = format!("p{p}");
        pages.insert(pid.clone(), PageMeta { title: text(&mut r, 2), trashed: false, archived: false });
        records.push((
            pid,
            VecRecord { updated: None, model: Some("m".into()), provider_id: Some("local".into()), chunks },
        ));
    }
    let q = word(&mut r) + " " + &word(&mut r);
    let mut index = None;
    let build = median(|| index = Some(VectorIndex::build(records.iter().map(|(k, v)| (k.as_str(), v)), &id)), 3);
    let index = index.unwrap();
    let mut hits = Vec::new();
    let rank = median(|| hits = rank_rag(&index, &pages, &q, &query, 6), 9);
    println!(
        "RAG-Ranking {} Chunks: Index {build:.1} ms einmalig, Anfrage {rank:.2} ms (Treffer {})",
        index.len(),
        hits[0].page_id
    );

    // Unscharf-Suche: 2 000 Seiten mit je 150 Wörtern.
    let mut r = Rng(7);
    let docs: Vec<(String, String)> = (0..2000).map(|i| (format!("s{i}"), text(&mut r, 150))).collect();
    let queries: Vec<String> = (0..10)
        .map(|_| {
            let mut w = word(&mut r);
            w.insert(w.len() / 2, 'x'); // Tippfehler
            w
        })
        .collect();
    let mut ix = FuzzyIndex::new();
    let build = median(
        || {
            ix = FuzzyIndex::new();
            for (id, t) in &docs {
                ix.set_page(id, t);
            }
        },
        3,
    );
    let mut found = 0;
    let search = median(
        || {
            found = 0;
            for q in &queries {
                found += ix.search(q, |_| true).len();
            }
        },
        5,
    ) / queries.len() as f64;
    println!("Unscharf-Suche 2000 Seiten: Aufbau {build:.1} ms, Anfrage {search:.2} ms ({found} Treffer gesamt)");
}
