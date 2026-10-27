//! Zeile (Striche) → Graustufenbild für das Bild-Modell, plus Lücken-Suche und Zerlegen breiter Zeilen.
//! Regeln wie `web/handwriting-rasterizer.js` und `handwriting/rasterize.py` (Training): Zeile auf 64 px Höhe
//! skaliert (6 px Rand), 2,5 px breite runde Striche, schwarz auf weiß, Werte 0..1, Breite Vielfaches von 4.
//!
//! Das JS zeichnet mit Canvas (Skia/CoreGraphics, je nach Browser). Hier rechnet reines Rust die Kantenglättung
//! selbst: Abdeckung je Pixel aus dem Abstand der Pixelmitte zum Strich (Kapseln um die Segmente), je Strich
//! vereinigt, Striche nacheinander in 8 Bit überblendet wie im Canvas. Abweichung zu Skia: siehe Golden-Test.

use crate::preprocess::Stroke;

pub const IMAGE_HEIGHT: usize = 64;
const PADDING: f64 = 6.0;
const STROKE_WIDTH: f64 = 2.5;
/// Flache Zeilen (Unterstrich, Bruchstrich) zählen als so hoch (Seiten-Einheiten) und liegen mittig –
/// sonst ergäbe ein 0,4 Einheiten hoher Strich ein 143.512 px breites Bild.
const MIN_INK_HEIGHT: f64 = 8.0;
/// Doppelte Trainingsbreite: Längere Zeilen werden kleiner gezeichnet statt endlos breit.
const MAX_WIDTH: f64 = 4096.0;

/// Graustufenbild `IMAGE_HEIGHT × width`, zeilenweise, 1 = weiß.
#[derive(Clone, Debug, PartialEq)]
pub struct LineImage {
    pub width: usize,
    pub data: Vec<f32>,
}

impl LineImage {
    /// Weißes Bild.
    pub fn blank(width: usize) -> Self {
        LineImage { width, data: vec![1.0; width * IMAGE_HEIGHT] }
    }

    /// Bild aus 8-Bit-Grauwerten (0 = schwarz).
    pub fn from_gray(width: usize, gray: &[u8]) -> Option<Self> {
        (gray.len() == width * IMAGE_HEIGHT)
            .then(|| LineImage { width, data: gray.iter().map(|&g| g as f32 / 255.0).collect() })
    }

    fn column_has_ink(&self, x: usize) -> bool {
        (0..IMAGE_HEIGHT).any(|y| self.data[y * self.width + x] < 0.8)
    }

    /// Spalten `[from, to)`; Breite auf ein Vielfaches von 4 aufgefüllt (weiß).
    pub fn slice(&self, from: usize, to: usize) -> LineImage {
        let to = to.min(self.width);
        let from = from.min(to);
        let mut out = LineImage::blank(((to - from).div_ceil(4) * 4).max(4));
        for y in 0..IMAGE_HEIGHT {
            out.data[y * out.width..y * out.width + (to - from)]
                .copy_from_slice(&self.data[y * self.width + from..y * self.width + to]);
        }
        out
    }
}

/// Rastert eine Zeile; `None` ohne Punkte.
pub fn rasterize_line(strokes: &[Stroke]) -> Option<LineImage> {
    let b = crate::preprocess::Bbox::of(strokes.iter().flat_map(|s| &s.points))?;
    let mut scale = (IMAGE_HEIGHT as f64 - 2.0 * PADDING) / b.h().max(MIN_INK_HEIGHT);
    scale = scale.min((MAX_WIDTH - 2.0 * PADDING) / b.w().max(1e-6));
    let ink_width = (b.w() * scale).floor() + 2.0 * PADDING;
    let width = (((ink_width / 4.0).ceil() * 4.0) as usize).max(4);
    let top = (IMAGE_HEIGHT as f64 - b.h() * scale) / 2.0; // = PADDING bei normaler Zeilenhöhe

    let mut gray = vec![255u8; width * IMAGE_HEIGHT];
    let mut canvas = Canvas { width, gray: &mut gray, dist: Vec::new() };
    for s in strokes {
        let pts: Vec<(f64, f64)> =
            s.points.iter().map(|&[x, y]| ((x - b.min_x) * scale + PADDING, (y - b.min_y) * scale + top)).collect();
        canvas.stroke(&pts);
    }
    LineImage::from_gray(width, &gray)
}

struct Canvas<'a> {
    width: usize,
    gray: &'a mut [u8],
    /// Kleinster Abstand je Pixel im Rechteck des aktuellen Strichs (wiederverwendet)
    dist: Vec<f64>,
}

impl Canvas<'_> {
    /// Ein Strich (runde Enden und Ecken) bzw. ein Punkt als Kreis; schwarz über das Bild geblendet.
    fn stroke(&mut self, pts: &[(f64, f64)]) {
        let Some(&first) = pts.first() else { return };
        let r = STROKE_WIDTH / 2.0;
        let reach = r + 1.0;
        let (mut x0, mut x1, mut y0, mut y1) = (first.0, first.0, first.1, first.1);
        for &(x, y) in pts {
            x0 = x0.min(x);
            x1 = x1.max(x);
            y0 = y0.min(y);
            y1 = y1.max(y);
        }
        let clamp = |v: f64, hi: usize| v.max(0.0).min(hi as f64) as usize;
        let (px0, px1) = (clamp((x0 - reach).floor(), self.width), clamp((x1 + reach).ceil(), self.width));
        let (py0, py1) = (clamp((y0 - reach).floor(), IMAGE_HEIGHT), clamp((y1 + reach).ceil(), IMAGE_HEIGHT));
        if px0 >= px1 || py0 >= py1 {
            return;
        }
        let bw = px1 - px0;
        self.dist.clear();
        self.dist.resize(bw * (py1 - py0), f64::INFINITY);

        let segments = pts.windows(2).map(|w| (w[0], w[1])).chain((pts.len() == 1).then_some((first, first)));
        for (a, b) in segments {
            let sx0 = clamp((a.0.min(b.0) - reach).floor(), self.width).max(px0);
            let sx1 = clamp((a.0.max(b.0) + reach).ceil(), self.width).min(px1);
            let sy0 = clamp((a.1.min(b.1) - reach).floor(), IMAGE_HEIGHT).max(py0);
            let sy1 = clamp((a.1.max(b.1) + reach).ceil(), IMAGE_HEIGHT).min(py1);
            let (dx, dy) = (b.0 - a.0, b.1 - a.1);
            let len2 = dx * dx + dy * dy;
            for py in sy0..sy1 {
                let cy = py as f64 + 0.5;
                for px in sx0..sx1 {
                    let cx = px as f64 + 0.5;
                    let t = if len2 > 0.0 { (((cx - a.0) * dx + (cy - a.1) * dy) / len2).clamp(0.0, 1.0) } else { 0.0 };
                    let (ex, ey) = (cx - a.0 - t * dx, cy - a.1 - t * dy);
                    let d = &mut self.dist[(py - py0) * bw + px - px0];
                    *d = d.min(ex * ex + ey * ey);
                }
            }
        }
        for py in py0..py1 {
            for px in px0..px1 {
                let d = self.dist[(py - py0) * bw + px - px0].sqrt();
                // Abdeckung eines Pixels durch eine Kante im Abstand d (linear über eine Pixelbreite)
                let coverage = (r + 0.5 - d).clamp(0.0, 1.0);
                let alpha = (coverage * 255.0).round() as u32;
                if alpha > 0 {
                    let g = &mut self.gray[py * self.width + px];
                    *g = div255(*g as u32 * (255 - alpha)) as u8;
                }
            }
        }
    }
}

/// x / 255 gerundet (wie Skia für 8-Bit-Überblendung).
fn div255(x: u32) -> u32 {
    let x = x + 128;
    (x + (x >> 8)) >> 8
}

/// Leere Spaltenbereiche `[von, bis)` zwischen Tinte, mindestens `min_width` px breit (Wortlücken).
pub fn find_ink_gaps(image: &LineImage, min_width: usize) -> Vec<(usize, usize)> {
    let mut gaps = Vec::new();
    let mut last_ink: Option<usize> = None;
    for x in 0..image.width {
        if !image.column_has_ink(x) {
            continue;
        }
        if let Some(last) = last_ink
            && x - last > min_width
        {
            gaps.push((last + 1, x));
        }
        last_ink = Some(x);
    }
    gaps
}

/// Breiteste Zeilenbilder im Training. Breitere Zeilen werden an Lücken in Stücke höchstens dieser Breite
/// geteilt und einzeln gelesen (Speicher der Faltungsschichten wächst linear mit der Breite).
pub const MAX_TRAINING_WIDTH: usize = 2048;
/// Schnittstellen: Lücken ab dieser Breite.
const CHUNK_GAP_PX: usize = 8;
/// Mindestabstand eines Schnitts vom Stückanfang (= Bildrand).
const PADDING_COLUMNS: usize = 6;
/// Leere Spalten ab dieser Breite sind sicher eine Wortlücke (ScaDS: ab 32 px ohne Nachteil, 16 px trennte Buchstaben).
pub const WORD_GAP_PX: usize = 32;

/// Schnitt durch eine zu breite Zeile.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Cut {
    /// Spalte, an der das nächste Stück beginnt.
    pub at: usize,
    /// Lücke breit genug für eine Wortgrenze (Leerzeichen zwischen den Stück-Texten).
    pub space: bool,
}

/// Schnitte für Zeilen breiter als [`MAX_TRAINING_WIDTH`]: in jedem Fenster die breiteste Lücke der hinteren
/// Hälfte (sonst irgendeine), ohne Lücke hart an der Fenstergrenze.
pub fn chunk_cuts(image: &LineImage) -> Vec<Cut> {
    let gaps = find_ink_gaps(image, CHUNK_GAP_PX);
    let mut cuts = Vec::new();
    let mut start = 0;
    while image.width - start > MAX_TRAINING_WIDTH {
        let limit = start + MAX_TRAINING_WIDTH;
        // (Mitte, Breite) der besten Lücke im Fenster bzw. in seiner hinteren Hälfte
        let mut best: Option<(usize, usize)> = None;
        let mut best_late: Option<(usize, usize)> = None;
        for &(from, to) in &gaps {
            let mid = (from + to) / 2;
            if mid <= start + PADDING_COLUMNS || mid > limit {
                continue;
            }
            let w = to - from;
            if best.is_none_or(|(_, bw)| w > bw) {
                best = Some((mid, w));
            }
            if mid > start + MAX_TRAINING_WIDTH / 2 && best_late.is_none_or(|(_, bw)| w > bw) {
                best_late = Some((mid, w));
            }
        }
        let cut = match best_late.or(best) {
            Some((mid, w)) => Cut { at: mid, space: w >= WORD_GAP_PX },
            None => Cut { at: limit, space: false },
        };
        cuts.push(cut);
        start = cut.at;
    }
    cuts
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preprocess::Stroke;

    fn stroke(points: &[[f64; 2]]) -> Stroke {
        Stroke { points: points.to_vec(), ..Default::default() }
    }

    #[test]
    fn masse_und_luecken() {
        let img =
            rasterize_line(&[stroke(&[[0.0, 0.0], [0.0, 52.0]]), stroke(&[[100.0, 0.0], [100.0, 52.0]])]).unwrap();
        // Höhe 52 → Maßstab 1, Breite 100 + 12 → 112
        assert_eq!(img.width, 112);
        assert_eq!(img.data.len(), 112 * IMAGE_HEIGHT);
        assert!(img.data[32 * 112 + 6] < 0.1 && img.data[32 * 112 + 50] == 1.0);
        assert_eq!(find_ink_gaps(&img, 32), vec![(8, 104)]);
        assert!(rasterize_line(&[stroke(&[])]).is_none());
        // Punkt als Kreis
        let dot = rasterize_line(&[stroke(&[[5.0, 5.0]])]).unwrap();
        assert_eq!(dot.width, 12);
        assert!(dot.data.iter().any(|&v| v < 0.5));
    }

    #[test]
    fn schnitte() {
        let mut img = LineImage::blank(5000);
        for x in (0..5000).filter(|x| x % 300 < 250) {
            img.data[10 * 5000 + x] = 0.0;
        }
        let cuts = chunk_cuts(&img);
        assert!(cuts.iter().all(|c| c.space));
        assert!(cuts.windows(2).all(|w| w[1].at - w[0].at <= MAX_TRAINING_WIDTH));
        assert!(5000 - cuts.last().unwrap().at <= MAX_TRAINING_WIDTH);
        assert_eq!(img.slice(10, 13).width, 4);
    }
}
