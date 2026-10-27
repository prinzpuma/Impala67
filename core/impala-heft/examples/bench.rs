//! Laufzeit der Heft-Geometrie nativ, auf denselben Eingaben wie `core/tools/bench-heft.mjs`
//! (gleicher Zufallsgenerator, gleiche Reihenfolge). Median aus 7 Läufen.
//!   cargo run -p impala-heft --example bench --profile native

use std::time::Instant;

use impala_heft::diff::{Shadow, diff_document};
use impala_heft::doc::{HeftDoc, HeftPage, Paper, Point, Stroke, Tool};
use impala_heft::eraser::StrokeEraser;
use impala_heft::geometry::fit_stroke_shape;
use impala_heft::js_round;
use impala_heft::lasso::select_strokes_by_lasso;

struct Mulberry32(u32);

impl Mulberry32 {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let s = self.0;
        let mut t = (s ^ (s >> 15)).wrapping_mul(1 | s);
        t = (t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t))) ^ t;
        (t ^ (t >> 14)) as f64 / 4_294_967_296.0
    }
    fn rf(&mut self, a: f64, b: f64) -> f64 {
        a + self.next() * (b - a)
    }
}

fn q1(v: f64) -> f64 {
    js_round(v * 10.0) / 10.0
}
fn q2(v: f64) -> f64 {
    js_round(v * 100.0) / 100.0
}

fn median<T>(mut f: impl FnMut() -> T) -> (f64, T) {
    f();
    let mut ms = Vec::new();
    let mut out = None;
    for _ in 0..7 {
        let t0 = Instant::now();
        out = Some(f());
        ms.push(t0.elapsed().as_secs_f64() * 1000.0);
    }
    ms.sort_by(f64::total_cmp);
    (ms[3], out.unwrap())
}

fn report(name: &str, (ms, check): (f64, usize)) {
    println!("{name:<34} {ms:>9.2} ms   (Prüfsumme {check})");
}

fn main() {
    let mut r = Mulberry32(42);
    let mut strokes = Vec::with_capacity(5000);
    for i in 0..5000 {
        let n = 10 + (r.next() * 40.0) as usize;
        let (mut x, mut y, mut dx, mut dy) = (r.rf(20.0, 980.0), r.rf(20.0, 1390.0), r.rf(-3.0, 3.0), r.rf(-3.0, 3.0));
        let mut pts = Vec::with_capacity(n);
        for _ in 0..n {
            let (px, py) = (q1(x), q1(y));
            pts.push(Point::new(px, py, q2(r.rf(0.2, 1.0))));
            dx += r.rf(-1.0, 1.0);
            dy += r.rf(-1.0, 1.0);
            x += dx;
            y += dy;
        }
        let mut s = Stroke {
            id: format!("s{i}"),
            tool: Some(Tool::Pen),
            color: Some("#000".into()),
            size: Some(3.0),
            pts,
            ..Default::default()
        };
        s.refresh_bounds();
        strokes.push(s);
    }
    let queries: Vec<[f64; 2]> = (0..2000).map(|_| [q1(r.rf(0.0, 1000.0)), q1(r.rf(0.0, 1414.0))]).collect();
    let polys: Vec<Vec<[f64; 2]>> = (0..200)
        .map(|_| {
            let (cx, cy, rad) = (r.rf(100.0, 900.0), r.rf(100.0, 1300.0), r.rf(50.0, 300.0));
            (0..24)
                .map(|k| {
                    let a = k as f64 / 24.0 * std::f64::consts::PI * 2.0;
                    let rr = rad * r.rf(0.7, 1.2);
                    [q1(cx + a.cos() * rr), q1(cy + a.sin() * rr)]
                })
                .collect()
        })
        .collect();
    let mut path = Vec::new();
    let (mut x, mut y) = (r.rf(100.0, 900.0), r.rf(100.0, 1300.0));
    for _ in 0..300 {
        x += r.rf(-8.0, 8.0);
        y += r.rf(-8.0, 8.0);
        path.push([q1(x), q1(y)]);
    }

    report(
        "Treffer-Test 2000 × 5000 Striche",
        median(|| queries.iter().map(|q| strokes.iter().filter(|s| s.hit_at(q[0], q[1], 16.0)).count()).sum()),
    );
    report(
        "Lasso 200 Polygone × 5000",
        median(|| polys.iter().map(|p| select_strokes_by_lasso(&strokes, p).len()).sum()),
    );
    report(
        "Radierer 300 Schritte",
        median(|| {
            let mut list = strokes.clone();
            let mut e = StrokeEraser::new(16.0);
            path.iter().map(|p| e.erase_at(&mut list, p[0], p[1]).len()).sum()
        }),
    );
    let mut page = HeftPage::empty("p", Paper::Lined);
    page.strokes = strokes.clone();
    let doc = HeftDoc { pages: vec![page], ..Default::default() };
    let shadow = Shadow::of(&doc);
    let mut next = doc.clone();
    next.pages[0].strokes.push(Stroke { id: "neu".into(), pts: vec![Point::new(1.0, 1.0, 0.5)], ..Default::default() });
    report("Diff nach 1 Strich (5000 Striche)", median(|| diff_document(Some(&shadow), &next).0.len()));
    report(
        "Formerkennung 5000 Striche",
        median(|| strokes.iter().filter(|s| fit_stroke_shape(&s.pts).is_some()).count()),
    );
}
