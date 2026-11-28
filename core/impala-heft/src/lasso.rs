//! Lasso-Auswahl (`heft-lasso.js`, nur die Logik; Zeichnen bleibt in JS).

use crate::doc::{BBox, Image, Stroke, TextBox};
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

// ---------- Drehen + Bilder & Textfelder (Parität PWA / Android / iPad) ----------

/// Abstand des Drehgriffs über dem oberen Rand des Auswahlrahmens.
pub const LASSO_ROTATE_OFFSET: f64 = 26.0;

/// Position `[x, y]` des Drehgriffs mittig über dem Auswahlrahmen.
pub fn lasso_rotate_handle(b: &BBox) -> [f64; 2] {
    [(b.min_x + b.max_x) / 2.0, b.min_y - LASSO_HANDLE_OFFSET - LASSO_ROTATE_OFFSET]
}

/// Trifft `(x, y)` den Drehgriff?
pub fn hit_lasso_rotate_handle(x: f64, y: f64, b: &BBox, hit_radius: f64) -> bool {
    let [hx, hy] = lasso_rotate_handle(b);
    let (dx, dy) = (x - hx, y - hy);
    dx * dx + dy * dy <= hit_radius * hit_radius
}

/// Rechteck (Bild oder Textfeld) im Lasso-Polygon: Mittelpunkt innen ODER mindestens 2 Ecken innen.
pub fn rect_in_polygon<P: Xy>(x: f64, y: f64, w: f64, h: f64, poly: &[P], poly_box: &BBox) -> bool {
    let rbox = BBox { min_x: x, min_y: y, max_x: x + w, max_y: y + h };
    if !rbox.intersects(poly_box) {
        return false;
    }
    if point_in_polygon(x + w / 2.0, y + h / 2.0, poly) {
        return true;
    }
    let corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    corners.into_iter().filter(|[cx, cy]| point_in_polygon(*cx, *cy, poly)).count() >= 2
}

/// Rechteck eines Bildes `(x, y, w, h)` mit Fallback auf 0.
pub fn image_rect(img: &Image) -> [f64; 4] {
    [img.x.unwrap_or(0.0), img.y.unwrap_or(0.0), img.w.unwrap_or(0.0).max(1.0), img.h.unwrap_or(0.0).max(1.0)]
}

/// Rechteck eines Textfeldes `(x, y, w, h)`; fehlendes `h` (abgeleitete Höhe) gilt als 36.
pub fn text_rect(tb: &TextBox) -> [f64; 4] {
    [tb.x.unwrap_or(0.0), tb.y.unwrap_or(0.0), tb.w.unwrap_or(200.0).max(1.0), tb.h.filter(|v| *v > 0.0).unwrap_or(36.0)]
}

/// Indizes der Bilder, die das Lasso umschließt.
pub fn select_images_by_lasso<P: Xy>(images: &[Image], poly: &[P]) -> Vec<usize> {
    if images.is_empty() || poly.len() < 3 {
        return Vec::new();
    }
    let Some(poly_box) = polygon_bounds(poly) else { return Vec::new() };
    (0..images.len())
        .filter(|&i| {
            let [x, y, w, h] = image_rect(&images[i]);
            rect_in_polygon(x, y, w, h, poly, &poly_box)
        })
        .collect()
}

/// Indizes der Textfelder, die das Lasso umschließt.
pub fn select_texts_by_lasso<P: Xy>(texts: &[TextBox], poly: &[P]) -> Vec<usize> {
    if texts.is_empty() || poly.len() < 3 {
        return Vec::new();
    }
    let Some(poly_box) = polygon_bounds(poly) else { return Vec::new() };
    (0..texts.len())
        .filter(|&i| {
            let [x, y, w, h] = text_rect(&texts[i]);
            rect_in_polygon(x, y, w, h, poly, &poly_box)
        })
        .collect()
}

/// Gemeinsame Grenzen aus Strichen, Bildern und Textfeldern.
pub fn lasso_selection_bounds<'a>(
    strokes: impl IntoIterator<Item = &'a Stroke>,
    images: impl IntoIterator<Item = &'a Image>,
    texts: impl IntoIterator<Item = &'a TextBox>,
) -> Option<BBox> {
    let mut b = EMPTY;
    if let Some(sb) = lasso_bounds(strokes) {
        grow(&mut b, sb.min_x, sb.min_y);
        grow(&mut b, sb.max_x, sb.max_y);
    }
    for img in images {
        let [x, y, w, h] = image_rect(img);
        grow(&mut b, x, y);
        grow(&mut b, x + w, y + h);
    }
    for tb in texts {
        let [x, y, w, h] = text_rect(tb);
        grow(&mut b, x, y);
        grow(&mut b, x + w, y + h);
    }
    finish(b)
}

/// Transformation einer Lasso-Auswahl.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum LassoTransformOp {
    Move { dx: f64, dy: f64 },
    Scale { ax: f64, ay: f64, factor: f64 },
    Rotate { cx: f64, cy: f64, angle: f64 },
}

/// Verschiebt, skaliert oder dreht ein Rechteck `(x, y, w, h)`. Beim Drehen kreist der
/// Mittelpunkt um `(cx, cy)`, das Rechteck bleibt aufrecht (Format bleibt kompatibel).
pub fn transform_rect([x, y, w, h]: [f64; 4], op: LassoTransformOp, min_w: f64, min_h: f64) -> [f64; 4] {
    match op {
        LassoTransformOp::Move { dx, dy } => [x + dx, y + dy, w, h],
        LassoTransformOp::Scale { ax, ay, factor } => {
            [ax + (x - ax) * factor, ay + (y - ay) * factor, (w * factor).max(min_w), (h * factor).max(min_h)]
        }
        LassoTransformOp::Rotate { cx, cy, angle } => {
            let (sin, cos) = angle.sin_cos();
            let (mx, my) = (x + w / 2.0 - cx, y + h / 2.0 - cy);
            let (nx, ny) = (cx + mx * cos - my * sin, cy + mx * sin + my * cos);
            [nx - w / 2.0, ny - h / 2.0, w, h]
        }
    }
}

pub fn transform_image(img: &mut Image, op: LassoTransformOp) {
    let [nx, ny, nw, nh] = transform_rect(image_rect(img), op, 24.0, 24.0);
    img.x = Some(nx);
    img.y = Some(ny);
    img.w = Some(nw);
    img.h = Some(nh);
}

pub fn transform_text(tb: &mut TextBox, op: LassoTransformOp) {
    let [nx, ny, nw, nh] = transform_rect(text_rect(tb), op, 60.0, 20.0);
    tb.x = Some(nx);
    tb.y = Some(ny);
    tb.w = Some(nw);
    if tb.h.is_some() {
        tb.h = Some(nh);
    }
    if let LassoTransformOp::Scale { factor, .. } = op
        && let Some(sz) = tb.size
    {
        tb.size = Some((sz * factor).clamp(10.0, 96.0));
    }
}

/// Kopien von Bildern, 28 Einheiten versetzt.
pub fn duplicate_images<'a>(
    images: impl IntoIterator<Item = &'a Image>,
    new_id: &mut dyn FnMut() -> String,
) -> Vec<Image> {
    images
        .into_iter()
        .map(|img| {
            let mut c = img.clone();
            c.id = new_id();
            c.x = Some(c.x.unwrap_or(0.0) + 28.0);
            c.y = Some(c.y.unwrap_or(0.0) + 28.0);
            c
        })
        .collect()
}

/// Kopien von Textfeldern, 28 Einheiten versetzt.
pub fn duplicate_texts<'a>(
    texts: impl IntoIterator<Item = &'a TextBox>,
    new_id: &mut dyn FnMut() -> String,
) -> Vec<TextBox> {
    texts
        .into_iter()
        .map(|tb| {
            let mut c = tb.clone();
            c.id = new_id();
            c.x = Some(c.x.unwrap_or(0.0) + 28.0);
            c.y = Some(c.y.unwrap_or(0.0) + 28.0);
            c
        })
        .collect()
}
