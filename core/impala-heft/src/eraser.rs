//! Radierer wie in GoodNotes: **präzise** (Standard) schneidet nur die überfahrene Stelle aus dem
//! Strich, die Reste bleiben als eigene Striche stehen; **Strich** nimmt jeden berührten Strich ganz weg.
//!
//! Geprüft wird die ganze Bahn vom letzten bis zum aktuellen Punkt (eine „Kapsel“), damit schnelle
//! Züge keine Lücken lassen. Die Plattformen schreiben erst am Gestenende – eine Geste ist ein
//! Event und ein Rückgängig-Schritt, egal wie oft dabei geschnitten wurde.
//!
//! Formen (Linie, Rechteck …) gehen auch präzise ganz weg: Ihre Geometrie lässt sich nicht teilen.

use crate::doc::{Point, Stroke, Tool};
use crate::json::js_hypot;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EraseMode {
    /// Nur die überfahrene Stelle verschwindet (GoodNotes „Präziser Radierer“).
    Precise,
    /// Ein berührter Strich verschwindet ganz.
    Stroke,
}

impl EraseMode {
    /// `precise` (Standard) oder `stroke` – so speichern es die Werkzeug-Einstellungen aller Apps.
    pub fn parse(s: &str) -> Self {
        if s == "stroke" { EraseMode::Stroke } else { EraseMode::Precise }
    }
}

/// Ein Strich, den ein Schritt ersetzt hat: `pieces` leer = ganz weg.
#[derive(Debug, Clone, PartialEq)]
pub struct EraseChange {
    pub removed: Stroke,
    pub pieces: Vec<Stroke>,
}

/// Ein Radiervorgang (eine Geste).
#[derive(Debug, Clone, PartialEq)]
pub struct StrokeEraser {
    pub radius: f64,
    pub mode: EraseMode,
    last: Option<[f64; 2]>,
    /// Übersprungener Punkt (< 35 % Radius), der beim Beenden (`finish`) noch nachgeprüft wird.
    pending: Option<[f64; 2]>,
    /// Präfix der IDs neuer Teilstriche (je Geste frisch, damit Geräte nie dieselbe ID erzeugen).
    seed: String,
    next: u32,
}

/// Teilstücke kürzer als das zählen nicht (sonst blieben Krümel am Schnitt).
const MIN_PIECE: f64 = 0.75;

impl StrokeEraser {
    /// Strich-Radierer.
    pub fn new(radius: f64) -> Self {
        Self::with_mode(radius, EraseMode::Stroke, String::new())
    }

    /// `seed`: eindeutiges Präfix für die IDs der Teilstriche (z. B. eine frische UUID).
    pub fn with_mode(radius: f64, mode: EraseMode, seed: String) -> Self {
        StrokeEraser { radius, mode, last: None, pending: None, seed, next: 0 }
    }

    /// Radiert bis (x, y): ersetzt getroffene Striche in `strokes` an Ort und Stelle durch ihre Reste
    /// (präzise) bzw. entfernt sie (Strich). Leer, wenn nichts getroffen wurde oder der Schritt unter
    /// 35 % des Radius lag – der nächste Schritt (oder `finish`) prüft die Bahn ab demselben Punkt.
    pub fn erase_at(&mut self, strokes: &mut Vec<Stroke>, x: f64, y: f64) -> Vec<EraseChange> {
        let from = match self.last {
            Some([lx, ly]) if js_hypot(x - lx, y - ly) < self.radius * 0.35 => {
                self.pending = Some([x, y]);
                return Vec::new();
            }
            Some(l) => l,
            None => [x, y],
        };
        self.pending = None;
        self.last = Some([x, y]);
        self.apply_capsule(strokes, Capsule { a: from, b: [x, y] })
    }

    /// Radiert eine letzte kleine Restbewegung (< 35 % Radius) vor dem Abheben nach.
    pub fn finish(&mut self, strokes: &mut Vec<Stroke>) -> Vec<EraseChange> {
        let (Some(from), Some(to)) = (self.last, self.pending.take()) else { return Vec::new() };
        self.last = Some(to);
        self.apply_capsule(strokes, Capsule { a: from, b: to })
    }

    fn apply_capsule(&mut self, strokes: &mut Vec<Stroke>, cap: Capsule) -> Vec<EraseChange> {
        let r = self.radius;
        let mut changes = Vec::new();
        let mut i = 0;
        while i < strokes.len() {
            let s = &strokes[i];
            let w = s.size.filter(|s| *s != 0.0 && !s.is_nan()).unwrap_or(2.0);
            let half = if s.tool == Some(Tool::Marker) { w * 1.5 } else { w * 0.5 };
            let hit_r = r + half;
            if !cap.near_bounds(s, hit_r) || !cap.hits(s, hit_r) {
                i += 1;
                continue;
            }
            let pieces = if self.mode == EraseMode::Precise && s.shape.is_none() {
                cut(&s.pts, &cap, hit_r)
                    .into_iter()
                    .map(|pts| {
                        self.next += 1;
                        let mut piece = Stroke { id: format!("{}-{}", self.seed, self.next), pts, ..s.clone() };
                        piece.refresh_bounds();
                        piece
                    })
                    .collect()
            } else {
                Vec::new()
            };
            let n = pieces.len();
            let removed = strokes.splice(i..=i, pieces.iter().cloned()).next().expect("Strich i");
            changes.push(EraseChange { removed, pieces });
            i += n;
        }
        changes
    }
}

/// Indizes aller Striche, die ein Radierer mit `radius` bei (x, y) trifft.
pub fn strokes_hit_at(strokes: &[Stroke], x: f64, y: f64, radius: f64) -> Vec<usize> {
    (0..strokes.len()).filter(|&i| strokes[i].hit_at(x, y, radius)).collect()
}

/// Bahn des Radierers zwischen zwei Pointer-Events.
struct Capsule {
    a: [f64; 2],
    b: [f64; 2],
}

impl Capsule {
    fn dist(&self, p: [f64; 2]) -> f64 {
        seg_dist(p, self.a, self.b)
    }

    fn near_bounds(&self, s: &Stroke, r: f64) -> bool {
        let Some(bb) = s.bounds() else { return true };
        let (x0, x1) = (self.a[0].min(self.b[0]) - r, self.a[0].max(self.b[0]) + r);
        let (y0, y1) = (self.a[1].min(self.b[1]) - r, self.a[1].max(self.b[1]) + r);
        !(x1 < bb.min_x || x0 > bb.max_x || y1 < bb.min_y || y0 > bb.max_y)
    }

    fn hits(&self, s: &Stroke, r: f64) -> bool {
        let pts: Vec<[f64; 2]> = match s.outline() {
            crate::geometry::Outline::Points(p) => p.iter().map(|p| [p.x, p.y]).collect(),
            crate::geometry::Outline::Shape(p) => p,
        };
        match pts.as_slice() {
            [] => false,
            [p] => self.dist(*p) <= r,
            _ => pts.windows(2).any(|w| self.seg_min(w[0], w[1]) <= r),
        }
    }

    /// Kleinster Abstand der Strecke p→q zur Bahn.
    fn seg_min(&self, p: [f64; 2], q: [f64; 2]) -> f64 {
        let t = self.argmin(p, q);
        self.dist(lerp2(p, q, t))
    }

    /// `t` in [0, 1] mit kleinstem Abstand (der Abstand ist entlang der Strecke konvex).
    fn argmin(&self, p: [f64; 2], q: [f64; 2]) -> f64 {
        let f = |t: f64| self.dist(lerp2(p, q, t));
        let (mut lo, mut hi) = (0.0, 1.0);
        for _ in 0..40 {
            let (m1, m2) = (lo + (hi - lo) / 3.0, hi - (hi - lo) / 3.0);
            if f(m1) <= f(m2) { hi = m2 } else { lo = m1 }
        }
        (lo + hi) / 2.0
    }

    /// Grenze zwischen `inside` (bei `tin`) und außerhalb (bei `tout`).
    fn edge(&self, p: [f64; 2], q: [f64; 2], mut tin: f64, mut tout: f64, r: f64) -> f64 {
        for _ in 0..30 {
            let m = (tin + tout) / 2.0;
            if self.dist(lerp2(p, q, m)) <= r { tin = m } else { tout = m }
        }
        tout
    }
}

/// Teilt einen Linienzug an der Bahn: liefert die Stücke außerhalb (Schnittpunkte genau auf dem Rand).
fn cut(pts: &[Point], cap: &Capsule, r: f64) -> Vec<Vec<Point>> {
    let xy = |p: &Point| [p.x, p.y];
    let inside: Vec<bool> = pts.iter().map(|p| cap.dist(xy(p)) <= r).collect();
    let mut out = Vec::new();
    let mut cur: Option<Vec<Point>> = (!inside.first().copied().unwrap_or(true)).then(|| vec![pts[0]]);
    for i in 0..pts.len().saturating_sub(1) {
        let (p, q) = (&pts[i], &pts[i + 1]);
        let (a, b) = (xy(p), xy(q));
        match (inside[i], inside[i + 1]) {
            (true, true) => {}
            (false, true) => {
                let t = cap.edge(a, b, 1.0, 0.0, r);
                let piece = cur.get_or_insert_with(Vec::new);
                piece.push(lerp_point(p, q, t));
                out.extend(cur.take());
            }
            (true, false) => {
                let t = cap.edge(a, b, 0.0, 1.0, r);
                cur = Some(vec![lerp_point(p, q, t), *q]);
            }
            (false, false) => {
                let tm = cap.argmin(a, b);
                if cap.dist(lerp2(a, b, tm)) <= r {
                    let piece = cur.get_or_insert_with(Vec::new);
                    piece.push(lerp_point(p, q, cap.edge(a, b, tm, 0.0, r)));
                    out.extend(cur.take());
                    cur = Some(vec![lerp_point(p, q, cap.edge(a, b, tm, 1.0, r)), *q]);
                } else {
                    cur.get_or_insert_with(Vec::new).push(*q);
                }
            }
        }
    }
    out.extend(cur);
    out.retain(|piece| piece.len() >= 2 && length(piece) >= MIN_PIECE);
    out
}

fn length(pts: &[Point]) -> f64 {
    pts.windows(2).map(|w| js_hypot(w[1].x - w[0].x, w[1].y - w[0].y)).sum()
}

fn lerp2(a: [f64; 2], b: [f64; 2], t: f64) -> [f64; 2] {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

fn lerp_point(a: &Point, b: &Point, t: f64) -> Point {
    let p = match (a.p, b.p) {
        (Some(pa), Some(pb)) if !pa.is_nan() && !pb.is_nan() => Some(pa + (pb - pa) * t),
        (pa, _) => pa,
    };
    Point { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p, t: None }
}

fn seg_dist(p: [f64; 2], a: [f64; 2], b: [f64; 2]) -> f64 {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let len2 = dx * dx + dy * dy;
    let t = if len2 > 0.0 { (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2).clamp(0.0, 1.0) } else { 0.0 };
    js_hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(id: &str, y: f64) -> Stroke {
        Stroke {
            id: id.into(),
            size: Some(2.0),
            pts: (0..=10).map(|i| Point::new(f64::from(i) * 10.0, y, 0.5)).collect(),
            ..Default::default()
        }
    }

    #[test]
    fn praezise_schneidet_mitte_heraus() {
        let mut list = vec![line("a", 0.0)];
        let mut e = StrokeEraser::with_mode(5.0, EraseMode::Precise, "g".into());
        let ch = e.erase_at(&mut list, 50.0, 0.0);
        assert_eq!(ch.len(), 1);
        assert_eq!(list.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["g-1", "g-2"]);
        // Schnitt genau auf dem Rand: Radius 5 + halbe Strichbreite 1.
        let left = list[0].pts.last().unwrap();
        let right = list[1].pts.first().unwrap();
        assert!((left.x - 44.0).abs() < 1e-6 && (right.x - 56.0).abs() < 1e-6, "{left:?} {right:?}");
        assert_eq!(list[0].pts.first().unwrap().x, 0.0);
        assert_eq!(list[1].pts.last().unwrap().x, 100.0);
    }

    #[test]
    fn schnelle_bahn_laesst_keine_luecke() {
        let mut list = vec![line("a", 0.0), line("b", 50.0)];
        let mut e = StrokeEraser::with_mode(3.0, EraseMode::Stroke, String::new());
        assert!(e.erase_at(&mut list, 50.0, -40.0).is_empty());
        // Ein Sprung quer über beide Linien trifft beide, obwohl kein Punkt nah dran lag.
        let gone: Vec<String> = e.erase_at(&mut list, 50.0, 90.0).into_iter().map(|c| c.removed.id).collect();
        assert_eq!(gone, ["a", "b"]);
        assert!(list.is_empty());
    }

    #[test]
    fn duenne_strecke_quer_geschnitten() {
        // Zwei weit auseinanderliegende Punkte: beide außerhalb, die Strecke dazwischen innen.
        let mut list =
            vec![Stroke { id: "a".into(), pts: vec![Point::new(0.0, 0.0, 0.5), Point::new(100.0, 0.0, 0.5)], ..Default::default() }];
        let mut e = StrokeEraser::with_mode(4.0, EraseMode::Precise, "g".into());
        e.erase_at(&mut list, 30.0, 0.0);
        assert_eq!(list.len(), 2);
        assert!(list[0].pts.last().unwrap().x < 26.0 && list[1].pts[0].x > 34.0);
    }

    #[test]
    fn rand_und_kruemel() {
        let mut list = vec![line("a", 0.0)];
        let mut e = StrokeEraser::with_mode(5.0, EraseMode::Precise, "g".into());
        e.erase_at(&mut list, 0.0, 0.0); // Anfang weg, Rest bleibt
        assert_eq!(list.len(), 1);
        assert!((list[0].pts[0].x - 6.0).abs() < 1e-6);
        let mut e = StrokeEraser::with_mode(80.0, EraseMode::Precise, "h".into());
        e.erase_at(&mut list, 50.0, 0.0); // alles abgedeckt
        assert!(list.is_empty());
    }

    #[test]
    fn restbewegung_und_marker_breite() {
        // Kleiner Schritt (< 35 % Radius) wird erst bei finish() nachradiert.
        let mut list = vec![line("a", 0.0)];
        let mut e = StrokeEraser::with_mode(20.0, EraseMode::Stroke, "g".into());
        assert!(e.erase_at(&mut list, 50.0, -25.0).is_empty()); // Abstand 25 > 20 + 1
        assert!(e.erase_at(&mut list, 50.0, -20.0).is_empty()); // Schritt 5 < 7 (0.35 * 20)
        assert_eq!(e.finish(&mut list).len(), 1);
        assert!(list.is_empty());

        // Marker hat dreifache Breite: size 4 → halbe Breite 6.
        let mut m = line("m", 0.0);
        m.tool = Some(Tool::Marker);
        m.size = Some(4.0);
        let mut list = vec![m];
        let mut e = StrokeEraser::with_mode(5.0, EraseMode::Stroke, "g".into());
        assert_eq!(e.erase_at(&mut list, 50.0, 10.5).len(), 1); // Abstand 10.5 <= 5 + 6
    }
}
