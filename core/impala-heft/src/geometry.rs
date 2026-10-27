//! Strich-Geometrie (`heft-geometry.js`): Grenzen, Umriss, Formerkennung, Verschieben und
//! Skalieren, Treffer-Tests.
//!
//! Gerechnet wird wie in JS in `f64` und in derselben Reihenfolge; `Math.hypot` ist
//! nachgebildet ([`js_hypot`]). Nur `sin`/`cos` (Ellipsen-Umriss) können in der letzten
//! Stelle von V8 abweichen.

use std::f64::consts::PI;

use crate::doc::{BBox, Image, Point, Shape, Stroke, TextBox};
use crate::json::js_hypot;

/// Etwas mit x/y-Koordinaten (Stiftpunkt oder `[x, y]`).
pub trait Xy {
    fn x(&self) -> f64;
    fn y(&self) -> f64;
}

impl Xy for Point {
    fn x(&self) -> f64 {
        self.x
    }
    fn y(&self) -> f64 {
        self.y
    }
}

impl Xy for [f64; 2] {
    fn x(&self) -> f64 {
        self[0]
    }
    fn y(&self) -> f64 {
        self[1]
    }
}

fn distance(a: &impl Xy, b: &impl Xy) -> f64 {
    js_hypot(a.x() - b.x(), a.y() - b.y())
}

fn xy(p: &impl Xy) -> [f64; 2] {
    [p.x(), p.y()]
}

/// Rahmen eines Bildes oder Textfelds für [`hit_box`].
pub trait Framed {
    /// `(x, y, w, h)`; fehlende Werte sind `NaN`, `h` fällt auf 60 zurück (`h || 60`).
    fn frame(&self) -> (f64, f64, f64, f64);
}

fn frame_of(x: Option<f64>, y: Option<f64>, w: Option<f64>, h: Option<f64>) -> (f64, f64, f64, f64) {
    let h = h.filter(|h| *h != 0.0 && !h.is_nan()).unwrap_or(60.0);
    (x.unwrap_or(f64::NAN), y.unwrap_or(f64::NAN), w.unwrap_or(f64::NAN), h)
}

impl Framed for Image {
    fn frame(&self) -> (f64, f64, f64, f64) {
        frame_of(self.x, self.y, self.w, self.h)
    }
}

impl Framed for TextBox {
    fn frame(&self) -> (f64, f64, f64, f64) {
        frame_of(self.x, self.y, self.w, self.h)
    }
}

/// Oberstes Element (letztes in der Liste) unter dem Punkt (`hitBox`).
pub fn hit_box<T: Framed>(items: &[T], x: f64, y: f64) -> Option<usize> {
    items.iter().rposition(|item| {
        let (ix, iy, w, h) = item.frame();
        x >= ix && x <= ix + w && y >= iy && y <= iy + h
    })
}

// ---------------------------------------------------------------------------
// Formerkennung

/// Douglas-Peucker wie `simplifyPath` (rekursiv, gleiche Teilungsregel).
fn simplify_path<P: Xy>(points: &[P], tolerance: f64) -> Vec<[f64; 2]> {
    if points.len() < 3 {
        return points.iter().map(xy).collect();
    }
    let (first, last) = (&points[0], &points[points.len() - 1]);
    let (mut farthest, mut max_distance) = (0usize, 0.0f64);
    let mut found = false;
    let base = distance(first, last).max(1.0);
    for (i, p) in points.iter().enumerate().take(points.len() - 1).skip(1) {
        let offset =
            ((last.y() - first.y()) * (p.x() - first.x()) - (last.x() - first.x()) * (p.y() - first.y())).abs() / base;
        if offset > max_distance {
            max_distance = offset;
            farthest = i;
            found = true;
        }
    }
    if !found || max_distance <= tolerance {
        return vec![xy(first), xy(last)];
    }
    let mut left = simplify_path(&points[..=farthest], tolerance);
    left.pop();
    left.extend(simplify_path(&points[farthest..], tolerance));
    left
}

fn arrow_from_vertices(v: &[[f64; 2]], tolerance: f64) -> Option<Shape> {
    let n = v.len();
    for tip_i in 1..n.saturating_sub(3) {
        let (tip, start) = (v[tip_i], v[0]);
        let shaft = distance(&start, &tip);
        if shaft < 30.0 {
            continue;
        }
        for ret_i in tip_i + 2..n - 1 {
            if distance(&tip, &v[ret_i]) > tolerance {
                continue;
            }
            let (head_a, head_b) = (v[tip_i + 1], v[ret_i + 1]);
            let (arm_a, arm_b) = (distance(&tip, &head_a), distance(&tip, &head_b));
            if arm_a < 8.0 || arm_b < 8.0 || arm_a > shaft * 0.6 || arm_b > shaft * 0.6 {
                continue;
            }
            let (back_x, back_y) = (start[0] - tip[0], start[1] - tip[1]);
            let dot_a = (head_a[0] - tip[0]) * back_x + (head_a[1] - tip[1]) * back_y;
            let dot_b = (head_b[0] - tip[0]) * back_x + (head_b[1] - tip[1]) * back_y;
            if dot_a <= arm_a * shaft * 0.3 || dot_b <= arm_b * shaft * 0.3 {
                continue;
            }
            return Some(Shape::Arrow {
                x1: start[0],
                y1: start[1],
                x2: tip[0],
                y2: tip[1],
                h1x: head_a[0],
                h1y: head_a[1],
                h2x: head_b[0],
                h2y: head_b[1],
            });
        }
    }
    None
}

/// Erkennt in einem gehaltenen Strich eine Form (`fitStrokeShape`): Pfeil, Dreieck,
/// Rechteck, Ellipse oder Linie. `None`: zu kurz oder keine Form.
pub fn fit_stroke_shape(points: &[Point]) -> Option<Shape> {
    if points.len() < 3 {
        return None;
    }
    let path_length: f64 = points.windows(2).map(|w| distance(&w[1], &w[0])).sum();
    if path_length < 30.0 {
        return None;
    }
    let tolerance = (path_length * 0.04).max(6.0);
    let vertices = simplify_path(points, tolerance);
    if let Some(arrow) = arrow_from_vertices(&vertices, tolerance * 1.5) {
        return Some(arrow);
    }
    let (a, b) = (&points[0], &points[points.len() - 1]);
    let closed = points.len() > 10 && distance(a, b) < (path_length * 0.2).max(18.0);
    if closed {
        let mut polygon = simplify_path(&points[..points.len() - 1], tolerance);
        if polygon.len() > 2 && distance(&polygon[0], &polygon[polygon.len() - 1]) <= tolerance * 2.5 {
            polygon.pop();
        }
        if polygon.len() == 3 {
            let [p0, p1, p2] = [polygon[0], polygon[1], polygon[2]];
            return Some(Shape::Triangle { x1: p0[0], y1: p0[1], x2: p1[0], y2: p1[1], x3: p2[0], y3: p2[1] });
        }
        let (mut min_x, mut min_y, mut max_x, mut max_y) =
            (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
        for p in points {
            min_x = min_x.min(p.x);
            min_y = min_y.min(p.y);
            max_x = max_x.max(p.x);
            max_y = max_y.max(p.y);
        }
        let (cx, cy, rx, ry) =
            ((min_x + max_x) / 2.0, (min_y + max_y) / 2.0, (max_x - min_x) / 2.0, (max_y - min_y) / 2.0);
        if rx < 10.0 || ry < 10.0 {
            return None;
        }
        let (mut err_rect, mut err_ellipse) = (0.0f64, 0.0f64);
        for p in points {
            let dx = (p.x - min_x).abs().min((p.x - max_x).abs());
            let dy = (p.y - min_y).abs().min((p.y - max_y).abs());
            err_rect += dx.min(dy);
            let (nx, ny) = ((p.x - cx) / rx, (p.y - cy) / ry);
            err_ellipse += (js_hypot(nx, ny) - 1.0).abs() * rx.max(ry);
        }
        return Some(if err_rect < err_ellipse * 0.85 {
            Shape::Rect { x1: min_x, y1: min_y, x2: max_x, y2: max_y }
        } else {
            Shape::Ellipse { cx, cy, rx, ry }
        });
    }
    let (width, height) = (b.x - a.x, b.y - a.y);
    let length = js_hypot(width, height);
    let max_dev =
        points.iter().map(|p| (height * (p.x - a.x) - width * (p.y - a.y)).abs() / length.max(1.0)).fold(0.0, f64::max);
    (max_dev < (length * 0.1).max(10.0)).then_some(Shape::Line { x1: a.x, y1: a.y, x2: b.x, y2: b.y })
}

// ---------------------------------------------------------------------------
// Umriss und Grenzen

/// Umriss eines Strichs: die Stiftpunkte oder die abgetastete Form.
#[derive(Debug, Clone, PartialEq)]
pub enum Outline<'a> {
    Points(&'a [Point]),
    Shape(Vec<[f64; 2]>),
}

impl Outline<'_> {
    pub fn len(&self) -> usize {
        match self {
            Outline::Points(p) => p.len(),
            Outline::Shape(p) => p.len(),
        }
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
    #[inline]
    pub fn at(&self, i: usize) -> [f64; 2] {
        match self {
            Outline::Points(p) => [p[i].x, p[i].y],
            Outline::Shape(p) => p[i],
        }
    }
    pub fn to_vec(&self) -> Vec<[f64; 2]> {
        (0..self.len()).map(|i| self.at(i)).collect()
    }
}

/// Abgetastete Form (`strokeOutline`). `None` für Formen ohne Umriss (unbekannt).
pub fn shape_outline(shape: &Shape) -> Option<Vec<[f64; 2]>> {
    Some(match *shape {
        Shape::Line { x1, y1, x2, y2 } => {
            (0..=16).map(|i| [x1 + (x2 - x1) * i as f64 / 16.0, y1 + (y2 - y1) * i as f64 / 16.0]).collect()
        }
        Shape::Rect { x1, y1, x2, y2 } => {
            let c = [[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]];
            let mut pts = Vec::with_capacity(33);
            for side in 0..4 {
                for i in 0..8 {
                    let r = i as f64 / 8.0;
                    pts.push([
                        c[side][0] + (c[side + 1][0] - c[side][0]) * r,
                        c[side][1] + (c[side + 1][1] - c[side][1]) * r,
                    ]);
                }
            }
            pts.push([x1, y1]);
            pts
        }
        Shape::Triangle { x1, y1, x2, y2, x3, y3 } => vec![[x1, y1], [x2, y2], [x3, y3], [x1, y1]],
        Shape::Arrow { x1, y1, x2, y2, h1x, h1y, h2x, h2y } => {
            vec![[x1, y1], [x2, y2], [h1x, h1y], [x2, y2], [h2x, h2y]]
        }
        Shape::Ellipse { cx, cy, rx, ry } => ellipse_points(cx, cy, rx, ry),
        Shape::Circle { cx, cy, r } => ellipse_points(cx, cy, r, r),
        Shape::Other(_) => return None,
    })
}

fn ellipse_points(cx: f64, cy: f64, rx: f64, ry: f64) -> Vec<[f64; 2]> {
    (0..=24)
        .map(|i| {
            let angle = i as f64 / 24.0 * PI * 2.0;
            [cx + angle.cos() * rx, cy + angle.sin() * ry]
        })
        .collect()
}

impl Stroke {
    /// Umriss für Treffer und Lasso (`strokeOutline`).
    pub fn outline(&self) -> Outline<'_> {
        match self.shape.as_ref().and_then(shape_outline) {
            Some(pts) => Outline::Shape(pts),
            None => Outline::Points(&self.pts),
        }
    }

    /// Grenzen samt Rand `(size || 3) * 2 + 4` – die gespeicherte `bbox`, sonst berechnet
    /// (`strokeBounds`). `None` ohne Punkte und Form.
    pub fn bounds(&self) -> Option<BBox> {
        self.bbox.or_else(|| self.compute_bounds())
    }

    /// Berechnet die Grenzen neu und speichert sie in `bbox` (nach jeder Geometrie-Änderung).
    pub fn refresh_bounds(&mut self) -> Option<BBox> {
        self.bbox = self.compute_bounds();
        self.bbox
    }

    fn compute_bounds(&self) -> Option<BBox> {
        let (mut min_x, mut min_y, mut max_x, mut max_y) =
            (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
        for p in &self.pts {
            if p.x < min_x {
                min_x = p.x;
            }
            if p.x > max_x {
                max_x = p.x;
            }
            if p.y < min_y {
                min_y = p.y;
            }
            if p.y > max_y {
                max_y = p.y;
            }
        }
        let mut grow = |x: f64, y: f64| {
            min_x = min_x.min(x);
            max_x = max_x.max(x);
            min_y = min_y.min(y);
            max_y = max_y.max(y);
        };
        match self.shape {
            Some(Shape::Ellipse { cx, cy, rx, ry }) => {
                grow(cx - rx, cy - ry);
                grow(cx + rx, cy + ry);
            }
            // Abweichung: JS liest hier `rx`/`ry`, die ein Kreis nicht hat, und verliert die
            // Grenzen ganz (NaN). Rust nimmt den Radius.
            Some(Shape::Circle { cx, cy, r }) => {
                grow(cx - r, cy - r);
                grow(cx + r, cy + r);
            }
            Some(ref s) => s.corner_points().into_iter().for_each(|[x, y]| grow(x, y)),
            None => {}
        }
        if !min_x.is_finite() {
            return None;
        }
        let margin = self.size.filter(|s| *s != 0.0 && !s.is_nan()).unwrap_or(3.0) * 2.0 + 4.0;
        Some(BBox { min_x: min_x - margin, min_y: min_y - margin, max_x: max_x + margin, max_y: max_y + margin })
    }

    /// Verschiebt Punkte, Form und gespeicherte Grenzen (`translateStroke`).
    pub fn translate(&mut self, dx: f64, dy: f64) {
        for p in &mut self.pts {
            p.x += dx;
            p.y += dy;
        }
        match &mut self.shape {
            Some(Shape::Ellipse { cx, cy, .. } | Shape::Circle { cx, cy, .. }) => {
                *cx += dx;
                *cy += dy;
            }
            Some(s) => {
                for (x, y) in s.corner_points_mut() {
                    *x += dx;
                    *y += dy;
                }
            }
            None => {}
        }
        if let Some(b) = &mut self.bbox {
            b.translate(dx, dy);
        }
    }

    /// Ausgangsgeometrie für Verschieben/Skalieren/Rückgängig (`strokeGeometry`).
    pub fn geometry(&self) -> StrokeGeometry {
        StrokeGeometry {
            pts: self.pts.clone(),
            shape: self.shape.clone(),
            size: self.size.filter(|s| *s != 0.0 && !s.is_nan()).unwrap_or(3.0),
        }
    }

    /// Setzt die Geometrie zurück (`applyStrokeGeometry`) und berechnet die Grenzen neu.
    pub fn apply_geometry(&mut self, g: &StrokeGeometry) {
        self.pts = g.pts.clone();
        self.shape = g.shape.clone();
        self.size = Some(g.size);
        self.refresh_bounds();
    }

    /// Verschiebt absolut von der Ausgangsgeometrie aus (`moveStrokeFrom`): Setzt ein Sync den
    /// Strich mitten in der Geste zurück, geht keine Teilbewegung verloren.
    pub fn move_from(&mut self, g: &StrokeGeometry, dx: f64, dy: f64) {
        self.apply_geometry(g);
        self.translate(dx, dy);
    }

    /// Skaliert um einen Anker, von der Ausgangsgeometrie aus (`scaleStrokeFrom`).
    /// Die Dicke wächst mit, mindestens 0,5.
    pub fn scale_from(&mut self, g: &StrokeGeometry, ax: f64, ay: f64, factor: f64) {
        let sx = |x: f64| ax + (x - ax) * factor;
        let sy = |y: f64| ay + (y - ay) * factor;
        self.pts = g.pts.iter().map(|p| Point { x: sx(p.x), y: sy(p.y), ..*p }).collect();
        let mut shape = g.shape.clone();
        match &mut shape {
            Some(Shape::Ellipse { cx, cy, rx, ry }) => {
                *cx = sx(*cx);
                *cy = sy(*cy);
                *rx *= factor;
                *ry *= factor;
            }
            // Abweichung: JS skaliert beim Kreis nur den Mittelpunkt (und schreibt `rx: NaN` dazu).
            Some(Shape::Circle { cx, cy, r }) => {
                *cx = sx(*cx);
                *cy = sy(*cy);
                *r *= factor;
            }
            Some(s) => {
                for (x, y) in s.corner_points_mut() {
                    *x = sx(*x);
                    *y = sy(*y);
                }
            }
            None => {}
        }
        self.shape = shape;
        self.size = Some((g.size * factor).max(0.5));
        self.refresh_bounds();
    }

    /// Trifft ein Kreis mit `radius` um (x, y) den Strich (`strokeHitAt`)? Die halbe
    /// Strichdicke zählt zum Radius.
    pub fn hit_at(&self, x: f64, y: f64, radius: f64) -> bool {
        let hit_r = radius + self.size.filter(|s| *s != 0.0 && !s.is_nan()).unwrap_or(2.0) / 2.0;
        if let Some(b) = self.bounds()
            && (x + hit_r < b.min_x || x - hit_r > b.max_x || y + hit_r < b.min_y || y - hit_r > b.max_y)
        {
            return false;
        }
        let r2 = hit_r * hit_r;
        match self.outline() {
            Outline::Points(p) => polyline_hit(p.iter().map(|p| [p.x, p.y]), x, y, r2),
            Outline::Shape(p) => polyline_hit(p.iter().copied(), x, y, r2),
        }
    }
}

/// Ausgangsgeometrie eines Strichs während einer Geste.
#[derive(Debug, Clone, PartialEq)]
pub struct StrokeGeometry {
    pub pts: Vec<Point>,
    pub shape: Option<Shape>,
    /// `size || 3`
    pub size: f64,
}

/// Liegt der Punkt höchstens `radius` von (x, y) entfernt (`nearPoint`)?
pub fn near_point(p: &impl Xy, x: f64, y: f64, radius: f64) -> bool {
    let (dx, dy) = (p.x() - x, p.y() - y);
    dx * dx + dy * dy <= radius * radius
}

/// Gerade-Ungerade-Regel (`pointInPolygon`); waagerechte Kanten teilen durch 0,0001.
pub fn point_in_polygon<P: Xy>(x: f64, y: f64, polygon: &[P]) -> bool {
    let mut hit = false;
    let n = polygon.len();
    if n == 0 {
        return false;
    }
    let mut prev = n - 1;
    for i in 0..n {
        let (a, b) = (&polygon[i], &polygon[prev]);
        if (a.y() > y) != (b.y() > y) {
            let dy = b.y() - a.y();
            let dy = if dy == 0.0 || dy.is_nan() { 0.0001 } else { dy };
            if x < (b.x() - a.x()) * (y - a.y()) / dy + a.x() {
                hit = !hit;
            }
        }
        prev = i;
    }
    hit
}

/// Liegt ein Linienzug (bzw. Einzelpunkt) höchstens `sqrt(r2)` von (x, y) entfernt?
fn polyline_hit(mut pts: impl Iterator<Item = [f64; 2]>, x: f64, y: f64, r2: f64) -> bool {
    let Some(mut a) = pts.next() else { return false };
    let mut single = true;
    for b in pts {
        single = false;
        if segment_distance_squared(x, y, a[0], a[1], b[0], b[1]) <= r2 {
            return true;
        }
        a = b;
    }
    single && {
        let (dx, dy) = (a[0] - x, a[1] - y);
        dx * dx + dy * dy <= r2
    }
}

fn segment_distance_squared(px: f64, py: f64, ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    let (dx, dy) = (bx - ax, by - ay);
    let len2 = dx * dx + dy * dy;
    let len2 = if len2 == 0.0 || len2.is_nan() { 1.0 } else { len2 };
    let ratio = (((px - ax) * dx + (py - ay) * dy) / len2).clamp(0.0, 1.0);
    let (cx, cy) = (ax + ratio * dx, ay + ratio * dy);
    (px - cx) * (px - cx) + (py - cy) * (py - cy)
}
