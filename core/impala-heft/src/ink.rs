//! Zeichengeometrie der Striche und des Papiers (`drawStroke`, `paintPaper` in `heft.js`)
//! als reine Daten – für native Renderer und den SVG-Export.
//!
//! Glättung: Die App speichert die Stiftpunkte roh (auf 0,1 gerundet, siehe
//! [`quantize_point`]) und glättet erst beim Zeichnen: quadratische Bézier-Stücke von
//! Mittelpunkt zu Mittelpunkt, jedes mit eigener Breite aus dem Druck der beiden Punkte.

use std::fmt::Write as _;

use crate::doc::{HeftPage, PAGE_H, PAGE_W, Paper, Point, Shape, Stroke, Tool};
use crate::json::{js_round, js_to_fixed};

/// Ein Zeichenbefehl. Koordinaten in Seiteneinheiten (1000 × 1414).
#[derive(Debug, Clone, PartialEq)]
pub enum InkPath {
    /// Einzelner Punkt: gefüllter Kreis.
    Dot { x: f64, y: f64, r: f64 },
    /// Glattes Freihand-Stück (quadratische Bézier-Kurve), runde Enden.
    Quad { from: [f64; 2], ctrl: [f64; 2], to: [f64; 2], width: f64 },
    /// Ein oder mehrere Linienzüge in einem Pfad (Textmarker, Linie, Dreieck, Pfeil), runde Ecken.
    Lines { parts: Vec<Vec<[f64; 2]>>, width: f64 },
    /// Ellipse als Umriss.
    Ellipse { cx: f64, cy: f64, rx: f64, ry: f64, width: f64 },
    /// Achsenparalleles Rechteck als Umriss.
    Rect { x: f64, y: f64, w: f64, h: f64, width: f64 },
}

/// Alle Befehle eines Strichs samt Farbe und Deckkraft.
#[derive(Debug, Clone, PartialEq)]
pub struct InkStroke {
    pub color: String,
    /// 1 bzw. 0,32 beim Textmarker.
    pub alpha: f64,
    pub paths: Vec<InkPath>,
}

/// Breite eines Freihand-Stücks aus Grunddicke und Druck (`segW`).
pub fn segment_width(size: f64, pressure: Option<f64>) -> f64 {
    // `p == null ? 0.5 : p`; `null` aus dem JSON liest sich hier als NaN.
    (size * (0.4 + pressure.filter(|p| !p.is_nan()).unwrap_or(0.5) * 1.2)).max(0.5)
}

/// Stiftposition wie die Eingabe sie speichert: x/y auf 0,1, Druck auf 0,01 gerundet,
/// fehlender Druck (Maus) zählt als 0,5. Eingaben sind Bildschirm-Pixel relativ zur Seite
/// und der aktuelle Maßstab.
pub fn quantize_point(dx: f64, dy: f64, scale: f64, pressure: Option<f64>) -> Point {
    let p = pressure.filter(|p| *p != 0.0 && !p.is_nan()).unwrap_or(0.5);
    Point::new(js_round(dx / scale * 10.0) / 10.0, js_round(dy / scale * 10.0) / 10.0, js_round(p * 100.0) / 100.0)
}

/// `p || 0.5` (Druck 0 zählt wie fehlend).
fn pressure_or_half(p: &Point) -> f64 {
    p.p.filter(|p| *p != 0.0 && !p.is_nan()).unwrap_or(0.5)
}

/// Zeichenbefehle eines Strichs (`drawStroke`). Ohne Punkte: nichts – auch bei Formen.
pub fn stroke_paths(s: &Stroke) -> Option<InkStroke> {
    let pts = &s.pts;
    if pts.is_empty() {
        return None;
    }
    let color = s.color.clone().unwrap_or_default();
    let size = s.size.unwrap_or(f64::NAN);
    let mut alpha = 1.0;
    let mut paths = Vec::new();
    if let (Some(Tool::Shape), Some(shape)) = (&s.tool, &s.shape) {
        let width = s.size.filter(|v| *v != 0.0 && !v.is_nan()).unwrap_or(3.0);
        match *shape {
            Shape::Line { x1, y1, x2, y2 } => {
                paths.push(InkPath::Lines { parts: vec![vec![[x1, y1], [x2, y2]]], width })
            }
            Shape::Ellipse { cx, cy, rx, ry } => {
                paths.push(InkPath::Ellipse { cx, cy, rx: rx.abs(), ry: ry.abs(), width })
            }
            Shape::Triangle { x1, y1, x2, y2, x3, y3 } => {
                paths.push(InkPath::Lines { parts: vec![vec![[x1, y1], [x2, y2], [x3, y3], [x1, y1]]], width })
            }
            Shape::Arrow { x1, y1, x2, y2, h1x, h1y, h2x, h2y } => {
                let parts = vec![vec![[x1, y1], [x2, y2], [h1x, h1y]], vec![[x2, y2], [h2x, h2y]]];
                paths.push(InkPath::Lines { parts, width });
            }
            Shape::Rect { x1, y1, x2, y2 } => paths.push(InkPath::Rect {
                x: x1.min(x2),
                y: y1.min(y2),
                w: (x2 - x1).abs(),
                h: (y2 - y1).abs(),
                width,
            }),
            // Kreise und unbekannte Formen zeichnet die App nicht.
            Shape::Circle { .. } | Shape::Other(_) => {}
        }
    } else if s.tool == Some(Tool::Marker) {
        alpha = 0.32;
        paths.push(InkPath::Lines { parts: vec![pts.iter().map(|p| [p.x, p.y]).collect()], width: size * 3.0 });
    } else if pts.len() == 1 {
        paths.push(InkPath::Dot { x: pts[0].x, y: pts[0].y, r: segment_width(size, pts[0].p) / 2.0 });
    } else {
        let mut from = [pts[0].x, pts[0].y];
        for i in 1..pts.len() {
            let cur = &pts[i];
            let to = match pts.get(i + 1) {
                Some(next) => [(cur.x + next.x) / 2.0, (cur.y + next.y) / 2.0],
                None => [cur.x, cur.y],
            };
            let width = segment_width(size, Some((pressure_or_half(&pts[i - 1]) + pressure_or_half(cur)) / 2.0));
            paths.push(InkPath::Quad { from, ctrl: [cur.x, cur.y], to, width });
            from = to;
        }
    }
    Some(InkStroke { color, alpha, paths })
}

/// Papiermuster einer Seite (`paintPaper`) in Seiteneinheiten.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct PaperPattern {
    /// Linien `[x0, y0, x1, y1]`, Deckkraft 0,22, Breite 1.
    pub lines: Vec<[f64; 4]>,
    /// Punktmitten, Radius 1,2, Deckkraft 0,35.
    pub dots: Vec<[f64; 2]>,
    /// Randlinie beim linierten Papier (Deckkraft 0,4).
    pub margin: Option<[f64; 4]>,
}

/// Hintergrundfarbe jeder Seite.
pub const PAPER_COLOR: &str = "#fbfaf7";
/// Farbe des Musters, wenn keine Akzentfarbe gesetzt ist.
pub const DEFAULT_INK: &str = "#6b8cae";

pub fn paper_pattern(kind: &Paper, w: f64, h: f64) -> PaperPattern {
    let mut out = PaperPattern::default();
    match kind {
        Paper::Blank => {}
        Paper::Dots => {
            let mut y = 40.0;
            while y < h {
                let mut x = 40.0;
                while x < w {
                    out.dots.push([x, y]);
                    x += 28.0;
                }
                y += 28.0;
            }
        }
        // Liniert, kariert und unbekannte Vorlagen (wie JS: alles außer blank/dots zeichnet Linien).
        _ => {
            let lined = *kind == Paper::Lined;
            let (x0, x1) = if lined { (90.0, w - 50.0) } else { (0.0, w) };
            let mut y = if lined { 96.0 } else { 28.0 };
            let end = h - if lined { 40.0 } else { 0.0 };
            while y < end {
                out.lines.push([x0, y, x1, y]);
                y += 28.0;
            }
            if *kind == Paper::Grid {
                let mut x = 28.0;
                while x < w {
                    out.lines.push([x, 0.0, x, h]);
                    x += 28.0;
                }
            }
            if lined {
                out.margin = Some([90.0, 40.0, 90.0, h - 40.0]);
            }
        }
    }
    out
}

/// Tiefste belegte Stelle einer Seite (mindestens 40): dort setzt „Text anhängen“ an
/// (`contentBottom`).
pub fn content_bottom(page: &HeftPage) -> f64 {
    let mut y: f64 = 40.0;
    for s in &page.strokes {
        for p in &s.pts {
            if p.y > y {
                y = p.y;
            }
        }
    }
    for im in &page.images {
        let b = im.y.unwrap_or(f64::NAN) + im.h.unwrap_or(f64::NAN);
        if b > y {
            y = b;
        }
    }
    for t in &page.texts {
        let b = t.y.unwrap_or(f64::NAN) + t.h.filter(|h| *h != 0.0 && !h.is_nan()).unwrap_or(60.0);
        if b > y {
            y = b;
        }
    }
    y
}

// ---------------------------------------------------------------------------
// SVG-Export (Ergänzung: die App exportiert heute nur PDF/PNG über Canvas)

/// Einstellungen für [`page_svg`].
pub struct SvgOptions<'a> {
    /// Farbe des Papiermusters (in der App die Akzentfarbe).
    pub paper_ink: &'a str,
    /// Bildquelle (dataURL/URL) für ein Bild; `None` lässt das Bild weg.
    pub image_href: &'a dyn Fn(&crate::doc::Image) -> Option<String>,
}

fn n(v: f64) -> String {
    let s = js_to_fixed(v, 2);
    let s = if s.contains('.') { s.trim_end_matches('0').trim_end_matches('.') } else { &s };
    if s == "-0" { "0".to_owned() } else { s.to_owned() }
}

fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            c => out.push(c),
        }
    }
    out
}

/// Eine Heftseite als eigenständiges SVG (Papier, Bilder, Striche, Textfelder), in derselben
/// Zeichenreihenfolge wie die App. Textfelder werden nur an `\n` umbrochen – der Umbruch nach
/// Breite braucht die Schriftmetrik des Geräts und fehlt hier.
pub fn page_svg(page: &HeftPage, opts: &SvgOptions) -> String {
    let (w, h) = (PAGE_W, PAGE_H);
    let mut o = String::new();
    let _ = write!(
        o,
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {} {}" width="{}" height="{}">"#,
        n(w),
        n(h),
        n(w),
        n(h)
    );
    let _ = write!(o, r#"<rect width="{}" height="{}" fill="{PAPER_COLOR}"/>"#, n(w), n(h));
    let pat = paper_pattern(&page.paper, w, h);
    let ink = esc(opts.paper_ink);
    if !pat.lines.is_empty() {
        let _ = write!(o, r#"<path stroke="{ink}" stroke-opacity="0.22" stroke-width="1" fill="none" d=""#);
        for l in &pat.lines {
            if l[1] == l[3] {
                let _ = write!(o, "M{} {}H{}", n(l[0]), n(l[1]), n(l[2]));
            } else {
                let _ = write!(o, "M{} {}V{}", n(l[0]), n(l[1]), n(l[3]));
            }
        }
        o.push_str(r#""/>"#);
    }
    if let Some(m) = pat.margin {
        let _ = write!(
            o,
            r#"<path stroke="{ink}" stroke-opacity="0.4" stroke-width="1" d="M{} {}V{}"/>"#,
            n(m[0]),
            n(m[1]),
            n(m[3])
        );
    }
    if !pat.dots.is_empty() {
        let _ = write!(o, r#"<g fill="{ink}" fill-opacity="0.35">"#);
        for d in &pat.dots {
            let _ = write!(o, r#"<circle cx="{}" cy="{}" r="1.2"/>"#, n(d[0]), n(d[1]));
        }
        o.push_str("</g>");
    }
    for im in &page.images {
        let (Some(x), Some(y), Some(iw), Some(ih)) = (im.x, im.y, im.w, im.h) else { continue };
        if let Some(href) = (opts.image_href)(im) {
            let _ = write!(
                o,
                r#"<image x="{}" y="{}" width="{}" height="{}" preserveAspectRatio="none" href="{}"/>"#,
                n(x),
                n(y),
                n(iw),
                n(ih),
                esc(&href)
            );
        }
    }
    for s in &page.strokes {
        let Some(ink) = stroke_paths(s) else { continue };
        let _ =
            write!(o, r#"<g stroke="{}" fill="none" stroke-linecap="round" stroke-linejoin="round""#, esc(&ink.color));
        if ink.alpha != 1.0 {
            let _ = write!(o, r#" opacity="{}""#, n(ink.alpha));
        }
        o.push('>');
        for p in &ink.paths {
            match p {
                InkPath::Dot { x, y, r } => {
                    let _ = write!(
                        o,
                        r#"<circle cx="{}" cy="{}" r="{}" fill="{}" stroke="none"/>"#,
                        n(*x),
                        n(*y),
                        n(*r),
                        esc(&ink.color)
                    );
                }
                InkPath::Quad { from, ctrl, to, width } => {
                    let _ = write!(
                        o,
                        r#"<path stroke-width="{}" d="M{} {}Q{} {} {} {}"/>"#,
                        n(*width),
                        n(from[0]),
                        n(from[1]),
                        n(ctrl[0]),
                        n(ctrl[1]),
                        n(to[0]),
                        n(to[1])
                    );
                }
                InkPath::Lines { parts, width } => {
                    let _ = write!(o, r#"<path stroke-width="{}" d=""#, n(*width));
                    for part in parts {
                        for (i, p) in part.iter().enumerate() {
                            let _ = write!(o, "{}{} {}", if i == 0 { 'M' } else { 'L' }, n(p[0]), n(p[1]));
                        }
                    }
                    o.push_str(r#""/>"#);
                }
                InkPath::Ellipse { cx, cy, rx, ry, width } => {
                    let _ = write!(
                        o,
                        r#"<ellipse stroke-width="{}" cx="{}" cy="{}" rx="{}" ry="{}"/>"#,
                        n(*width),
                        n(*cx),
                        n(*cy),
                        n(*rx),
                        n(*ry)
                    );
                }
                InkPath::Rect { x, y, w, h, width } => {
                    let _ = write!(
                        o,
                        r#"<rect stroke-width="{}" x="{}" y="{}" width="{}" height="{}"/>"#,
                        n(*width),
                        n(*x),
                        n(*y),
                        n(*w),
                        n(*h)
                    );
                }
            }
        }
        o.push_str("</g>");
    }
    for t in &page.texts {
        let (Some(x), Some(y)) = (t.x, t.y) else { continue };
        let size = t.size.filter(|v| *v != 0.0 && !v.is_nan()).unwrap_or(30.0);
        let color = t.color.as_deref().filter(|c| !c.is_empty()).unwrap_or("#1c1c1e");
        let _ = write!(
            o,
            r#"<text font-family="ui-rounded, 'Segoe Print', sans-serif" font-weight="500" font-size="{}" fill="{}" dominant-baseline="hanging">"#,
            n(size),
            esc(color)
        );
        for (i, line) in t.text.as_deref().unwrap_or("").split('\n').enumerate() {
            let _ = write!(
                o,
                r#"<tspan x="{}" y="{}">{}</tspan>"#,
                n(x + 10.0),
                n(y + 10.0 + i as f64 * size * 1.4),
                esc(line)
            );
        }
        o.push_str("</text>");
    }
    o.push_str("</svg>");
    o
}
