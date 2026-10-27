//! Striche einer Seite → Textzeilen: Filtern, Zeilentrennung, Reihenfolge in der Zeile, Begradigen.
//! Verhalten wie `web/handwriting-preprocessor.js`.

/// Punkt in Seiten-Einheiten.
pub type Point = [f64; 2];

/// Werkzeug eines Strichs. Nur Schreibstriche gehen in die Erkennung.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Tool {
    /// Stift, Bleistift, Marker … (alles, was schreibt)
    #[default]
    Ink,
    Shape,
    Eraser,
    Laser,
}

impl Tool {
    /// Werkzeug aus dem Feld `tool` eines Heft-Strichs.
    pub fn from_name(name: &str) -> Tool {
        match name {
            "shape" => Tool::Shape,
            "eraser" => Tool::Eraser,
            "laser" => Tool::Laser,
            _ => Tool::Ink,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Stroke {
    /// Strich-Id aus dem Heft (geht in den Zeilenschlüssel ein), leer wenn unbekannt.
    pub id: String,
    pub tool: Tool,
    pub points: Vec<Point>,
}

impl Stroke {
    /// Geht der Strich in die Erkennung (Schreibwerkzeug, mindestens ein Punkt)?
    pub fn is_ink(&self) -> bool {
        self.tool == Tool::Ink && !self.points.is_empty()
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bbox {
    pub min_x: f64,
    pub max_x: f64,
    pub min_y: f64,
    pub max_y: f64,
}

impl Bbox {
    /// Umrandung von Punkten, `None` ohne Punkte.
    pub fn of<'a>(points: impl IntoIterator<Item = &'a Point>) -> Option<Bbox> {
        let mut it = points.into_iter();
        let &[x, y] = it.next()?;
        let mut b = Bbox { min_x: x, max_x: x, min_y: y, max_y: y };
        for &[x, y] in it {
            b.min_x = b.min_x.min(x);
            b.max_x = b.max_x.max(x);
            b.min_y = b.min_y.min(y);
            b.max_y = b.max_y.max(y);
        }
        Some(b)
    }

    pub fn w(&self) -> f64 {
        self.max_x - self.min_x
    }

    pub fn h(&self) -> f64 {
        self.max_y - self.min_y
    }

    pub fn cy(&self) -> f64 {
        (self.min_y + self.max_y) / 2.0
    }

    fn extend(&mut self, o: &Bbox) {
        self.min_x = self.min_x.min(o.min_x);
        self.max_x = self.max_x.max(o.max_x);
        self.min_y = self.min_y.min(o.min_y);
        self.max_y = self.max_y.max(o.max_y);
    }
}

/// Eine Textzeile: Indizes der Striche (in die Eingabe) in Lesereihenfolge.
#[derive(Clone, Debug, PartialEq)]
pub struct Line {
    pub strokes: Vec<usize>,
    pub bbox: Bbox,
}

struct Item {
    idx: usize,
    bbox: Bbox,
}

/// Gruppiert die Schreibstriche einer Seite zu Textzeilen (von oben nach unten, in der Zeile von links nach
/// rechts). Die Zeilenhöhe hängt fest an der typischen Strichhöhe, damit Pfeile/Klammern Zeilen nicht aufblähen.
/// Sehr hohe oder breite Striche (Skizzen, Rahmen, Unterstreichungen) gehören zu keiner Zeile.
pub fn segment_lines(strokes: &[Stroke]) -> Vec<Line> {
    let mut items: Vec<Item> = strokes
        .iter()
        .enumerate()
        .filter(|(_, s)| s.is_ink())
        .filter_map(|(idx, s)| Some(Item { idx, bbox: Bbox::of(&s.points)? }))
        .collect();
    if items.is_empty() {
        return Vec::new();
    }
    // Typische Strichhöhe ohne winzige Striche (i-Punkte, Querstriche)
    let ref_h = stroke_height_median(items.iter().map(|it| &strokes[it.idx]), 8.0, 0.5).max(8.0);
    // Ab 3× lagen echte Buchstaben (ein durchgezogenes "f") noch darüber, daher 4×
    if items.len() >= 5 {
        items.retain(|it| it.bbox.h() <= ref_h * 4.0 && it.bbox.w() <= ref_h * 12.0);
    }

    struct Row {
        bbox: Bbox,
        cy: f64,
        cy_sum: f64,
        cy_count: u32,
        items: Vec<usize>,
    }
    let mut rows: Vec<Row> = Vec::new();
    // Abstand zum festen Kernband der Zeile (Zeilenmitte ± halbe typische Strichhöhe)
    let gap_to_core = |b: &Bbox, r: &Row| (r.cy - ref_h / 2.0 - b.max_y).max(b.min_y - (r.cy + ref_h / 2.0)).max(0.0);
    // Unter den Zeilen mit nahem Kernband die mit dem nächsten Zentrum (bzw. kleinsten Abstand)
    let nearest = |rows: &[Row], b: &Bbox, max_gap: f64, by_gap: bool| {
        let mut best = None;
        let mut best_d = f64::INFINITY;
        for (i, r) in rows.iter().enumerate() {
            let gap = gap_to_core(b, r);
            if gap > max_gap {
                continue;
            }
            let d = if by_gap { gap } else { (b.cy() - r.cy).abs() };
            if d < best_d {
                best_d = d;
                best = Some(i);
            }
        }
        best
    };
    let new_row = |rows: &mut Vec<Row>, k: usize, b: &Bbox| {
        rows.push(Row { bbox: *b, cy: b.cy(), cy_sum: 0.0, cy_count: 0, items: vec![k] });
        rows.len() - 1
    };

    let is_small = |b: &Bbox| b.h() < ref_h * 0.4 && b.w() < ref_h;
    // 1) Buchstabengroße Striche bilden die Zeilen
    let mut main: Vec<usize> = (0..items.len()).filter(|&k| !is_small(&items[k].bbox)).collect();
    main.sort_by(|&a, &b| items[a].bbox.cy().total_cmp(&items[b].bbox.cy()));
    for k in main {
        let b = &items[k].bbox;
        let r = match nearest(&rows, b, ref_h * 0.75, false) {
            Some(r) => {
                rows[r].items.push(k);
                rows[r].bbox.extend(b);
                r
            }
            None => new_row(&mut rows, k, b),
        };
        let row = &mut rows[r];
        row.cy_sum += b.cy();
        row.cy_count += 1;
        row.cy = row.cy_sum / row.cy_count as f64;
    }
    // 2) Kleine Striche (i-Punkte, Umlaut-Punkte, Querstriche, Satzzeichen) an die nächste Zeile hängen
    for k in (0..items.len()).filter(|&k| is_small(&items[k].bbox)) {
        let b = &items[k].bbox;
        match nearest(&rows, b, ref_h * 1.5, true) {
            Some(r) => {
                rows[r].items.push(k);
                rows[r].bbox.extend(b);
            }
            None => {
                new_row(&mut rows, k, b);
            }
        }
    }

    rows.sort_by(|a, b| a.bbox.min_y.total_cmp(&b.bbox.min_y));
    rows.into_iter()
        .map(|r| {
            let line_items: Vec<&Item> = r.items.iter().map(|&k| &items[k]).collect();
            Line { strokes: sort_line_items(&line_items), bbox: r.bbox }
        })
        .collect()
}

/// Ordnet Striche in einer Zeile: Überlappende oder nahe Striche (Stamm + Querstrich von t/f/A, i-Punkte)
/// bilden ein Zeichen-Cluster in Zeichenreihenfolge, die Cluster stehen von links nach rechts.
fn sort_line_items(items: &[&Item]) -> Vec<usize> {
    if items.len() <= 1 {
        return items.iter().map(|it| it.idx).collect();
    }
    let mut sorted = items.to_vec();
    sorted.sort_by(|a, b| a.bbox.min_x.total_cmp(&b.bbox.min_x));
    struct Cluster {
        bbox: Bbox,
        idx: Vec<usize>,
    }
    let mut clusters: Vec<Cluster> = Vec::new();
    for it in sorted {
        let b = &it.bbox;
        let hit = clusters.iter_mut().find(|cl| {
            let overlap = cl.bbox.max_x.min(b.max_x) - cl.bbox.min_x.max(b.min_x);
            overlap > 0.0 || b.min_x <= cl.bbox.max_x + (cl.bbox.h() * 0.25).max(8.0)
        });
        match hit {
            Some(cl) => {
                cl.idx.push(it.idx);
                cl.bbox.extend(b);
            }
            None => clusters.push(Cluster { bbox: *b, idx: vec![it.idx] }),
        }
    }
    clusters.sort_by(|a, b| a.bbox.min_x.total_cmp(&b.bbox.min_x));
    clusters
        .into_iter()
        .flat_map(|mut cl| {
            cl.idx.sort_unstable();
            cl.idx
        })
        .collect()
}

/// Reihenfolge der Striche einer (schon waagerechten) Zeile wie bei [`segment_lines`]; Indizes in `strokes`.
pub fn order_line_strokes(strokes: &[Stroke]) -> Vec<usize> {
    let items: Vec<Item> =
        strokes.iter().enumerate().filter_map(|(idx, s)| Some(Item { idx, bbox: Bbox::of(&s.points)? })).collect();
    sort_line_items(&items.iter().collect::<Vec<_>>())
}

/// Begradigt eine schräg geschriebene Zeile (Drehung um den Schwerpunkt), bevor sie gerastert wird.
pub fn deskew_line(strokes: &[Stroke]) -> Vec<Stroke> {
    let angle = estimate_orientation(strokes);
    // Weniger als ~1 Grad Schieflage ignorieren
    if angle.abs() < 0.015 {
        return strokes.to_vec();
    }
    let Some((cx, cy)) = centroid(strokes) else { return strokes.to_vec() };
    let (sin, cos) = (-angle).sin_cos();
    strokes
        .iter()
        .map(|s| Stroke {
            points: s
                .points
                .iter()
                .map(|&[x, y]| {
                    let (dx, dy) = (x - cx, y - cy);
                    [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos]
                })
                .collect(),
            ..s.clone()
        })
        .collect()
}

fn centroid(strokes: &[Stroke]) -> Option<(f64, f64)> {
    let (mut n, mut sx, mut sy) = (0usize, 0.0, 0.0);
    for &[x, y] in strokes.iter().flat_map(|s| &s.points) {
        sx += x;
        sy += y;
        n += 1;
    }
    (n > 0).then(|| (sx / n as f64, sy / n as f64))
}

/// Neigung einer Zeile (Radiant) aus der Hauptträgheitsachse; 0 für Einzelzeichen und Steiles.
fn estimate_orientation(strokes: &[Stroke]) -> f64 {
    let points = || strokes.iter().flat_map(|s| &s.points);
    if points().count() < 6 {
        return 0.0;
    }
    let Some(b) = Bbox::of(points()) else { return 0.0 };
    // Nur echte waagerechte Zeilen drehen, keine einzelnen Zeichen
    if b.w() < b.h() * 1.5 {
        return 0.0;
    }
    let Some((cx, cy)) = centroid(strokes) else { return 0.0 };
    let (mut sxx, mut syy, mut sxy) = (0.0, 0.0, 0.0);
    for &[x, y] in points() {
        let (dx, dy) = (x - cx, y - cy);
        sxx += dx * dx;
        syy += dy * dy;
        sxy += dx * dy;
    }
    let angle = 0.5 * (2.0 * sxy).atan2(sxx - syy);
    if angle.abs() > std::f64::consts::FRAC_PI_4 { 0.0 } else { angle }
}

fn median(mut values: Vec<f64>) -> f64 {
    values.sort_by(f64::total_cmp);
    let mid = values.len() / 2;
    if values.len() % 2 == 1 { values[mid] } else { (values[mid - 1] + values[mid]) / 2.0 }
}

/// Median der Strichhöhen (Striche mit mindestens 2 Punkten und Höhe > 0) als robuste Schrifthöhe.
/// `min_ratio > 0` lässt zusätzlich winzige Striche unter `min_ratio ×` grobem Median weg.
fn stroke_height_median<'a>(strokes: impl Iterator<Item = &'a Stroke>, fallback: f64, min_ratio: f64) -> f64 {
    let mut heights: Vec<f64> = strokes
        .filter(|s| s.points.len() >= 2)
        .filter_map(|s| Bbox::of(&s.points))
        .map(|b| b.h())
        .filter(|&h| h > 0.0)
        .collect();
    if heights.is_empty() {
        return fallback;
    }
    if min_ratio > 0.0 {
        let rough = median(heights.clone());
        heights.retain(|&h| h >= rough * min_ratio);
    }
    median(heights)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stroke(points: &[Point]) -> Stroke {
        Stroke { points: points.to_vec(), ..Default::default() }
    }

    #[test]
    fn zwei_zeilen_und_werkzeuge() {
        let strokes = vec![
            stroke(&[[0.0, 100.0], [10.0, 120.0]]),
            stroke(&[[0.0, 0.0], [10.0, 20.0]]),
            Stroke { tool: Tool::Eraser, ..stroke(&[[0.0, 0.0], [5.0, 5.0]]) },
            stroke(&[]),
            stroke(&[[30.0, 2.0], [40.0, 18.0]]),
        ];
        let lines = segment_lines(&strokes);
        assert_eq!(lines.iter().map(|l| l.strokes.clone()).collect::<Vec<_>>(), vec![vec![1, 4], vec![0]]);
    }

    #[test]
    fn gerade_zeile_bleibt() {
        let s = vec![stroke(&[[0.0, 0.0], [10.0, 0.0], [20.0, 0.0], [30.0, 0.0], [40.0, 1.0], [50.0, 0.0]])];
        assert_eq!(deskew_line(&s), s);
    }
}
