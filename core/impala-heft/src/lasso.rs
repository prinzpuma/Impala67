//! Lasso-Auswahl (`heft-lasso.js`, nur die Logik; Zeichnen bleibt in JS).

use crate::doc::{BBox, Stroke};
use crate::geometry::{Xy, point_in_polygon};

fn grow(b: &mut [f64; 4], x: f64, y: f64) {
    if x < b[0] {
        b[0] = x;
    }
    if x > b[2] {
        b[2] = x;
    }
    if y < b[1] {
        b[1] = y;
    }
    if y > b[3] {
        b[3] = y;
    }
}

const EMPTY: [f64; 4] = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];

fn finish(b: [f64; 4]) -> Option<BBox> {
    b[0].is_finite().then_some(BBox { min_x: b[0], min_y: b[1], max_x: b[2], max_y: b[3] })
}

/// Gemeinsame Grenzen der Striche ohne Rand (`lassoBounds`): Punkte und Formumriss.
pub fn lasso_bounds<'a>(strokes: impl IntoIterator<Item = &'a Stroke>) -> Option<BBox> {
    let mut b = EMPTY;
    for s in strokes {
        for p in &s.pts {
            grow(&mut b, p.x, p.y);
        }
        if s.shape.is_some() {
            let o = s.outline();
            for i in 0..o.len() {
                let [x, y] = o.at(i);
                grow(&mut b, x, y);
            }
        }
    }
    finish(b)
}

/// Grenzen eines Polygons (`polygonBounds`).
pub fn polygon_bounds<P: Xy>(poly: &[P]) -> Option<BBox> {
    let mut b = EMPTY;
    for p in poly {
        grow(&mut b, p.x(), p.y());
    }
    finish(b)
}

/// Liegt der Strich im Lasso (`strokeInPolygon`)? Kurze Striche (≤ 2 Umrisspunkte): ein
/// Punkt genügt. Längere: Schwerpunkt innen ODER mindestens 2 und ≥ 25 % von höchstens
/// 24 Abtastpunkten – so wird die Nachbarzeile bei Randkontakt nicht mitgenommen.
pub fn stroke_in_polygon<P: Xy>(stroke: &Stroke, poly: &[P], poly_box: &BBox) -> bool {
    match stroke.bounds() {
        Some(b) if b.intersects(poly_box) => {}
        _ => return false,
    }
    let outline = stroke.outline();
    let count = outline.len();
    if count == 0 {
        return false;
    }
    if count <= 2 {
        return (0..count).any(|i| {
            let [x, y] = outline.at(i);
            point_in_polygon(x, y, poly)
        });
    }
    let step = if count > 24 { count.div_ceil(24) } else { 1 };
    let (mut hits, mut sampled, mut sum_x, mut sum_y) = (0usize, 0usize, 0.0, 0.0);
    for i in (0..count).step_by(step) {
        let [x, y] = outline.at(i);
        sum_x += x;
        sum_y += y;
        sampled += 1;
        if point_in_polygon(x, y, poly) {
            hits += 1;
        }
    }
    if point_in_polygon(sum_x / sampled as f64, sum_y / sampled as f64, poly) {
        return true;
    }
    hits >= 2 && hits as f64 / sampled as f64 >= 0.25
}

/// Indizes der Striche, die das Lasso umschließt (`selectStrokesByLasso`). Unter 3
/// Lassopunkten: keine.
pub fn select_strokes_by_lasso<P: Xy>(strokes: &[Stroke], poly: &[P]) -> Vec<usize> {
    if strokes.is_empty() || poly.len() < 3 {
        return Vec::new();
    }
    let Some(poly_box) = polygon_bounds(poly) else { return Vec::new() };
    (0..strokes.len()).filter(|&i| stroke_in_polygon(&strokes[i], poly, &poly_box)).collect()
}

/// Was ein Fingertipp im Lasso-Modus bewirkt (`lassoTouchAction`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LassoTouch {
    /// Auswahl verschieben/skalieren.
    Interact,
    /// Tipp daneben: zurück zum Stift.
    Dismiss,
    /// Kein Finger oder kein Lasso: normale Behandlung.
    None,
}

pub fn lasso_touch_action(is_touch: bool, lasso_tool: bool, on_lasso: bool) -> LassoTouch {
    match (is_touch && lasso_tool, on_lasso) {
        (true, true) => LassoTouch::Interact,
        (true, false) => LassoTouch::Dismiss,
        _ => LassoTouch::None,
    }
}

pub const LASSO_HANDLE_OFFSET: f64 = 8.0;
pub const LASSO_HANDLE_RADIUS: f64 = 5.5;
pub const LASSO_HIT_RADIUS: f64 = 18.0;

/// Eckgriff des Auswahlrahmens.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Corner {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

impl Corner {
    /// `tl`, `tr`, `bl`, `br` wie in JS.
    pub fn name(self) -> &'static str {
        match self {
            Corner::TopLeft => "tl",
            Corner::TopRight => "tr",
            Corner::BottomLeft => "bl",
            Corner::BottomRight => "br",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LassoHandle {
    pub corner: Corner,
    pub x: f64,
    pub y: f64,
    /// Gegenüberliegende Ecke: Fixpunkt beim proportionalen Skalieren.
    pub anchor: [f64; 2],
}

/// Die vier Eckgriffe, in der Reihenfolge tl, tr, bl, br (`getLassoHandles`).
pub fn lasso_handles(b: &BBox) -> [LassoHandle; 4] {
    let off = LASSO_HANDLE_OFFSET;
    let h = |corner, x, y, anchor| LassoHandle { corner, x, y, anchor };
    [
        h(Corner::TopLeft, b.min_x - off, b.min_y - off, [b.max_x, b.max_y]),
        h(Corner::TopRight, b.max_x + off, b.min_y - off, [b.min_x, b.max_y]),
        h(Corner::BottomLeft, b.min_x - off, b.max_y + off, [b.max_x, b.min_y]),
        h(Corner::BottomRight, b.max_x + off, b.max_y + off, [b.min_x, b.min_y]),
    ]
}

/// Getroffener Eckgriff; geprüft in der Reihenfolge br, tr, bl, tl (`hitLassoHandle`).
pub fn hit_lasso_handle(x: f64, y: f64, b: &BBox, hit_radius: f64) -> Option<LassoHandle> {
    let [tl, tr, bl, br] = lasso_handles(b);
    let r2 = hit_radius * hit_radius;
    [br, tr, bl, tl].into_iter().find(|h| {
        let (dx, dy) = (x - h.x, y - h.y);
        dx * dx + dy * dy <= r2
    })
}

/// Liegt der Punkt im (um `tolerance` erweiterten) Auswahlrahmen (`isLassoBodyHit`)?
pub fn is_lasso_body_hit(x: f64, y: f64, b: &BBox, tolerance: f64) -> bool {
    x >= b.min_x - tolerance && x <= b.max_x + tolerance && y >= b.min_y - tolerance && y <= b.max_y + tolerance
}

/// Kopien der Striche, 28 Einheiten versetzt (`duplicateLassoStrokes` + `cloneStroke`).
/// Übernommen werden Werkzeug, Farbe, Dicke, Punkte, Form und `opacity`; `new_id` liefert
/// die neuen IDs.
pub fn duplicate_strokes<'a>(
    strokes: impl IntoIterator<Item = &'a Stroke>,
    new_id: &mut dyn FnMut() -> String,
) -> Vec<Stroke> {
    strokes
        .into_iter()
        .map(|s| {
            let mut c = Stroke {
                id: new_id(),
                tool: s.tool.clone(),
                color: s.color.clone(),
                size: s.size,
                pts: s.pts.clone(),
                shape: s.shape.clone(),
                ..Default::default()
            };
            if let Some(op) = s.extra.get("opacity").filter(|v| !v.is_null()) {
                c.extra.insert("opacity".into(), op.clone());
            }
            c.refresh_bounds();
            c.translate(28.0, 28.0);
            c
        })
        .collect()
}

/// Skalierfaktor beim Ziehen an einem Eckgriff (Lasso-Resize in `heft-input.js`): Projektion
/// der Zeigerbewegung auf die Diagonale, begrenzt auf 0,15…6 und so, dass die Auswahl auf
/// der Seite bleibt (mindestens 1, wenn sie schon über den Rand ragt).
pub fn lasso_resize_factor(anchor: [f64; 2], start: [f64; 2], start_dist: f64, pointer: [f64; 2], bb: &BBox) -> f64 {
    use crate::doc::{PAGE_H, PAGE_W};
    let (vx, vy) = ((start[0] - anchor[0]) / start_dist, (start[1] - anchor[1]) / start_dist);
    let current = (pointer[0] - anchor[0]) * vx + (pointer[1] - anchor[1]) * vy;
    let mut max_factor = f64::INFINITY;
    if bb.min_x < anchor[0] {
        max_factor = max_factor.min(anchor[0] / (anchor[0] - bb.min_x));
    }
    if bb.max_x > anchor[0] {
        max_factor = max_factor.min((PAGE_W - anchor[0]) / (bb.max_x - anchor[0]));
    }
    if bb.min_y < anchor[1] {
        max_factor = max_factor.min(anchor[1] / (anchor[1] - bb.min_y));
    }
    if bb.max_y > anchor[1] {
        max_factor = max_factor.min((PAGE_H - anchor[1]) / (bb.max_y - anchor[1]));
    }
    let max_factor = max_factor.max(1.0);
    (current / start_dist).min(max_factor).clamp(0.15, 6.0)
}

/// Abstand für den Griff-Start (`Math.max(12, hypot(p - anchor))`).
pub fn lasso_resize_start_dist(anchor: [f64; 2], start: [f64; 2]) -> f64 {
    crate::json::js_hypot(start[0] - anchor[0], start[1] - anchor[1]).max(12.0)
}
