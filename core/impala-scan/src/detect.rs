use crate::geom::{convex_hull, dist2d, is_convex, order_quad, quad_area};
use crate::types::{DETECT_MAX, DetectSizes, GrayImage, Point, Quad, REFINE_MAX, RgbaImage};

const REFINE_LINE_STEPS: usize = 24;
const REFINE_MIN_HITS: usize = 8;
const REFINE_MIN_GRAD: f64 = 8.0;
const REFINE_MAX_RESID: f64 = 2.0;
const REFINE_MAX_MOVE: f64 = 0.04;
const REFINE_AREA_MIN: f64 = 0.8;
const REFINE_AREA_MAX: f64 = 1.2;

const HOUGH_DEG: usize = 180;
const HOUGH_HALF: usize = 90;
const HOUGH_TOL: i32 = 6;
const HOUGH_PEAKS: usize = 24;
const HOUGH_MIN_FRAC: f64 = 0.12;

const PAR_DEG: f64 = 35.0;
const ADJ_DEG: f64 = 40.0;
const PAIR_KEEP: usize = 40;

const SIDE_SAMPLES: usize = 40;
const SIDE_TOL: i32 = 6;
const SIDE_CONTRAST_OFF: f64 = 6.0;
const EDGE_CANDIDATES: usize = 6;
const SIDE_SUP_MIN: f64 = 0.3;
const EDGE_MIN: f64 = 25.0;

#[inline]
pub fn detect_sizes(w: u32, h: u32) -> DetectSizes {
    let dw = DETECT_MAX.min(w);
    let kk = dw as f64 / w.max(1) as f64;
    let dh = ((h as f64 * kk).round() as u32).max(12);
    let kr = (REFINE_MAX as f64 / (w.max(h).max(1) as f64)).min(1.0);
    DetectSizes { dw, dh, gw: ((w as f64 * kr).round() as u32).max(2), gh: ((h as f64 * kr).round() as u32).max(2) }
}

pub fn full_quad_pixels(w: u32, h: u32) -> Quad {
    let max_x = w.saturating_sub(1) as f64;
    let max_y = h.saturating_sub(1) as f64;
    Quad([Point(0.0, 0.0), Point(max_x, 0.0), Point(max_x, max_y), Point(0.0, max_y)])
}

pub fn to_gray(pix: &RgbaImage) -> GrayImage {
    let n = pix.width as usize * pix.height as usize;
    let d = &pix.data;
    let mut g = vec![0.0f32; n];
    for i in 0..n {
        g[i] = d[i * 4] as f32 * 0.299 + d[i * 4 + 1] as f32 * 0.587 + d[i * 4 + 2] as f32 * 0.114;
    }
    GrayImage { width: pix.width, height: pix.height, data: g }
}

fn sample_gray(g: &[f32], w: usize, h: usize, x: f64, y: f64) -> f64 {
    let xc = x.clamp(0.0, (w - 1) as f64);
    let yc = y.clamp(0.0, (h - 1) as f64);
    let x0 = xc as usize;
    let y0 = yc as usize;
    let x1 = (x0 + 1).min(w - 1);
    let y1 = (y0 + 1).min(h - 1);
    let fx = xc - x0 as f64;
    let fy = yc - y0 as f64;

    let v00 = g[y0 * w + x0] as f64;
    let v10 = g[y0 * w + x1] as f64;
    let v01 = g[y1 * w + x0] as f64;
    let v11 = g[y1 * w + x1] as f64;

    (v00 * (1.0 - fx) + v10 * fx) * (1.0 - fy) + (v01 * (1.0 - fx) + v11 * fx) * fy
}

#[derive(Clone, Copy)]
struct Line {
    c: Point,
    u: Point,
}

fn fit_line(pts: &[Point]) -> Line {
    let mut mx = 0.0;
    let mut my = 0.0;
    for p in pts {
        mx += p.0;
        my += p.1;
    }
    mx /= pts.len() as f64;
    my /= pts.len() as f64;

    let mut sxx = 0.0;
    let mut syy = 0.0;
    let mut sxy = 0.0;
    for p in pts {
        let dx = p.0 - mx;
        let dy = p.1 - my;
        sxx += dx * dx;
        syy += dy * dy;
        sxy += dx * dy;
    }

    let th = 0.5 * (2.0 * sxy).atan2(sxx - syy);
    Line { c: Point(mx, my), u: Point(th.cos(), th.sin()) }
}

fn residual(line: Line, p: Point) -> f64 {
    ((p.0 - line.c.0) * (-line.u.1) + (p.1 - line.c.1) * line.u.0).abs()
}

fn fit_edge(pts: &[Point]) -> Option<Line> {
    if pts.len() < REFINE_MIN_HITS {
        return None;
    }
    let line = fit_line(pts);
    let inliers: Vec<Point> = pts.iter().copied().filter(|&p| residual(line, p) <= REFINE_MAX_RESID).collect();
    if inliers.len() < REFINE_MIN_HITS {
        return None;
    }
    if inliers.len() == pts.len() { Some(line) } else { Some(fit_line(&inliers)) }
}

fn line_through(a: Point, b: Point) -> Line {
    let len = dist2d(a, b);
    let l = if len == 0.0 { 1.0 } else { len };
    Line { c: a, u: Point((b.0 - a.0) / l, (b.1 - a.1) / l) }
}

fn intersect_lines(l1: Line, l2: Line) -> Option<Point> {
    let den = l1.u.0 * l2.u.1 - l1.u.1 * l2.u.0;
    if den.abs() < 1e-6 {
        return None;
    }
    let dx = l2.c.0 - l1.c.0;
    let dy = l2.c.1 - l1.c.1;
    let t = (dx * l2.u.1 - dy * l2.u.0) / den;
    Some(Point(l1.c.0 + t * l1.u.0, l1.c.1 + t * l1.u.1))
}

fn edge_hits(g: &[f32], gw: usize, gh: usize, a: Point, b: Point, r: f64, cen: Point) -> Vec<Point> {
    let dx = b.0 - a.0;
    let dy = b.1 - a.1;
    let len = dx.hypot(dy);
    let mut hits = Vec::new();
    if len < 2.0 {
        return hits;
    }

    let mut nx = -dy / len;
    let mut ny = dx / len;
    if nx * (cen.0 - (a.0 + b.0) / 2.0) + ny * (cen.1 - (a.1 + b.1) / 2.0) < 0.0 {
        nx = -nx;
        ny = -ny;
    }

    let mut pts = Vec::with_capacity(REFINE_LINE_STEPS);
    let mut votes = 0.0;
    for k in 0..REFINE_LINE_STEPS {
        let t = 0.1 + 0.8 * k as f64 / (REFINE_LINE_STEPS - 1) as f64;
        let px = a.0 + dx * t;
        let py = a.1 + dy * t;
        pts.push(Point(px, py));
        let diff = sample_gray(g, gw, gh, px + nx * 2.0 * r, py + ny * 2.0 * r)
            - sample_gray(g, gw, gh, px - nx * 2.0 * r, py - ny * 2.0 * r);
        if diff > 0.0 {
            votes += 1.0;
        } else if diff < 0.0 {
            votes -= 1.0;
        }
    }

    let pol = if votes >= 0.0 { 1.0 } else { -1.0 };
    for p in pts {
        let mut grads = Vec::new();
        let mut best = 0.0;

        let mut s = -r;
        while s <= r {
            let qx = p.0 + nx * s;
            let qy = p.1 + ny * s;
            let grad =
                pol * (sample_gray(g, gw, gh, qx + nx, qy + ny) - sample_gray(g, gw, gh, qx - nx, qy - ny)) / 2.0;
            grads.push((s, grad));
            if grad > best {
                best = grad;
            }
            s += 0.5;
        }

        if best < REFINE_MIN_GRAD {
            continue;
        }

        let peaks: Vec<f64> = grads.iter().filter(|(_, g)| *g >= best - 1e-6).map(|(s, _)| *s).collect();
        if !peaks.is_empty() {
            let peak_s = (peaks[0] + peaks[peaks.len() - 1]) / 2.0;
            hits.push(Point(p.0 + nx * peak_s, p.1 + ny * peak_s));
        }
    }

    hits
}

pub fn refine_quad_pixels(gray: &GrayImage, quad: &Quad) -> Quad {
    let gw = gray.width as usize;
    let gh = gray.height as usize;
    let g = &gray.data;

    let diag = dist2d(quad.0[0], quad.0[2]).max(dist2d(quad.0[1], quad.0[3]));
    let r = 6.0f64.max(0.015 * (gw as f64).hypot(gh as f64));
    let cen = Point(
        (quad.0[0].0 + quad.0[1].0 + quad.0[2].0 + quad.0[3].0) / 4.0,
        (quad.0[0].1 + quad.0[1].1 + quad.0[2].1 + quad.0[3].1) / 4.0,
    );

    let mut lines = Vec::with_capacity(4);
    for e in 0..4 {
        let a = quad.0[e];
        let b = quad.0[(e + 1) % 4];
        let hits = edge_hits(g, gw, gh, a, b, r, cen);
        lines.push(fit_edge(&hits).unwrap_or_else(|| line_through(a, b)));
    }

    let mut out = [Point(0.0, 0.0); 4];
    for i in 0..4 {
        let inter = intersect_lines(lines[(i + 3) % 4], lines[i]);
        out[i] = match inter {
            Some(x) if dist2d(x, quad.0[i]) <= REFINE_MAX_MOVE * diag => x,
            _ => quad.0[i],
        };
    }

    let out_quad = Quad(out);
    if !is_convex(&out_quad) {
        return *quad;
    }

    let a0 = quad_area(quad);
    let a1 = quad_area(&out_quad);
    if a0 < 1.0 || a1 < a0 * REFINE_AREA_MIN || a1 > a0 * REFINE_AREA_MAX {
        return *quad;
    }

    out_quad
}

fn blur_map(src: &[f32], dw: usize, dh: usize, r: usize) -> Vec<f32> {
    let mut tmp = vec![0.0f32; src.len()];
    let mut out = vec![0.0f32; src.len()];

    let pass = |inp: &[f32], outp: &mut [f32], len: usize, stride: usize, lines: usize, line_stride: usize| {
        let r_i = r as isize;
        let len_i = len as isize;
        let div = (2 * r + 1) as f32;

        for l in 0..lines {
            let base = l * line_stride;
            let mut acc = 0.0f32;
            for i in -r_i..=r_i {
                let idx = i.clamp(0, len_i - 1) as usize;
                acc += inp[base + idx * stride];
            }
            for i in 0..len {
                outp[base + i * stride] = acc / div;
                let add_idx = (i as isize + r_i + 1).clamp(0, len_i - 1) as usize;
                let sub_idx = (i as isize - r_i).clamp(0, len_i - 1) as usize;
                acc += inp[base + add_idx * stride] - inp[base + sub_idx * stride];
            }
        }
    };

    pass(src, &mut tmp, dw, 1, dh, dw);
    pass(&tmp, &mut out, dh, dw, dw, 1);
    out
}

fn morph_pass(src: &[u8], dw: usize, dh: usize, pick: u8) -> Vec<u8> {
    let n = dw * dh;
    let mut mid = vec![0u8; n];
    let mut out = vec![0u8; n];

    for i in 0..n {
        let x = (i % dw) as isize;
        let mut v = src[i] == pick;
        let mut k = 1isize;
        while k <= 2 && !v {
            v = (x - k >= 0 && src[(i as isize - k) as usize] == pick)
                || (x + k < dw as isize && src[(i as isize + k) as usize] == pick);
            k += 1;
        }
        mid[i] = if v { pick } else { 1 - pick };
    }

    for i in 0..n {
        let y = (i / dw) as isize;
        let mut v = mid[i] == pick;
        let mut k = 1isize;
        while k <= 2 && !v {
            v = (y - k >= 0 && mid[(i as isize - k * dw as isize) as usize] == pick)
                || (y + k < dh as isize && mid[(i as isize + k * dw as isize) as usize] == pick);
            k += 1;
        }
        out[i] = if v { pick } else { 1 - pick };
    }

    out
}

struct Context {
    dw: usize,
    dh: usize,
    n: usize,
    kk: f64,
    l: Vec<f32>,
    sat: Vec<f32>,
    ca: Vec<f32>,
    cb: Vec<f32>,
    edge: Vec<f32>,
    s: Vec<f32>,
    gx: Vec<f32>,
    gy: Vec<f32>,
    mag: Vec<f32>,
    e: Vec<u8>,
    hi: f64,
    mean_l: f64,
    border_l: f64,
    border_a: f64,
    border_b: f64,
    edge_thr: f64,
}

fn build_context(analysis: &RgbaImage, orig_w: u32, _orig_h: u32) -> Context {
    let dw = analysis.width as usize;
    let dh = analysis.height as usize;
    let d = &analysis.data;
    let n = dw * dh;

    let mut l = vec![0.0f32; n];
    let mut sat = vec![0.0f32; n];
    let mut ca = vec![0.0f32; n];
    let mut cb = vec![0.0f32; n];
    let mut edge = vec![0.0f32; n];

    let mut sum_l = 0.0f64;
    let mut border_l = 0.0f64;
    let mut border_a = 0.0f64;
    let mut border_b = 0.0f64;
    let mut border_n = 0usize;

    for i in 0..n {
        let r = d[i * 4] as f32;
        let g = d[i * 4 + 1] as f32;
        let b = d[i * 4 + 2] as f32;
        let mx = r.max(g).max(b);
        let mn = r.min(g).min(b);

        l[i] = r * 0.299 + g * 0.587 + b * 0.114;
        sat[i] = if mx > 0.0 { (mx - mn) / mx } else { 0.0 };
        ca[i] = r - g;
        cb[i] = b - g;
        sum_l += l[i] as f64;

        let y = i / dw;
        let x = i % dw;
        if x < 3 || y < 3 || x >= dw - 3 || y >= dh - 3 {
            border_l += l[i] as f64;
            border_a += ca[i] as f64;
            border_b += cb[i] as f64;
            border_n += 1;
        }
    }

    let b_count = border_n.max(1) as f64;
    border_l /= b_count;
    border_a /= b_count;
    border_b /= b_count;

    let mut edge_sum = 0.0f64;
    for y in 1..dh - 1 {
        for x in 1..dw - 1 {
            let i = y * dw + x;
            let val = (l[i + 1] - l[i - 1]).abs() + (l[i + dw] - l[i - dw]).abs();
            edge[i] = val;
            edge_sum += val as f64;
        }
    }

    let s = blur_map(&blur_map(&l, dw, dh, 1), dw, dh, 1);
    let mut gx = vec![0.0f32; n];
    let mut gy = vec![0.0f32; n];
    let mut mag = vec![0.0f32; n];

    for y in 1..dh - 1 {
        for x in 1..dw - 1 {
            let i = y * dw + x;
            let gxx = s[i - dw + 1] + 2.0 * s[i + 1] + s[i + dw + 1] - s[i - dw - 1] - 2.0 * s[i - 1] - s[i + dw - 1];
            let gyy = s[i + dw - 1] + 2.0 * s[i + dw] + s[i + dw + 1] - s[i - dw - 1] - 2.0 * s[i - dw] - s[i - dw + 1];
            gx[i] = gxx;
            gy[i] = gyy;
            mag[i] = (gxx as f64).hypot(gyy as f64) as f32;
        }
    }

    let mut e = vec![0u8; n];
    for i in 0..n {
        e[i] = if mag[i] as f64 >= EDGE_MIN { 1 } else { 0 };
    }

    Context {
        dw,
        dh,
        n,
        kk: dw as f64 / orig_w.max(1) as f64,
        l,
        sat,
        ca,
        cb,
        edge,
        s,
        gx,
        gy,
        mag,
        e,
        hi: EDGE_MIN,
        mean_l: sum_l / n as f64,
        border_l,
        border_a,
        border_b,
        edge_thr: 18.0f64.max(edge_sum / n as f64 * 2.35),
    }
}

#[derive(Clone, Copy)]
struct HoughLine {
    t: usize,
    c: f64,
    s: f64,
    rho: f64,
    score: f64,
}

fn hough_lines(ctx: &Context) -> Vec<HoughLine> {
    let dw = ctx.dw;
    let dh = ctx.dh;
    let n = ctx.n;

    let d_diag = ((dw as f64).hypot(dh as f64)).ceil() as usize;
    let rw = 2 * d_diag + 1;
    let mut acc = vec![0.0f32; HOUGH_DEG * rw];

    let mut cos_t = [0.0f64; HOUGH_DEG];
    let mut sin_t = [0.0f64; HOUGH_DEG];
    for t in 0..HOUGH_DEG {
        let rad = t as f64 * std::f64::consts::PI / HOUGH_DEG as f64;
        cos_t[t] = rad.cos();
        sin_t[t] = rad.sin();
    }

    for i in 0..n {
        if ctx.e[i] == 0 {
            continue;
        }
        let x = (i % dw) as f64;
        let y = (i / dw) as f64;
        let wgt = (2.0f64).min(ctx.mag[i] as f64 / ctx.hi) as f32;

        let phi = ((ctx.gy[i] as f64).atan2(ctx.gx[i] as f64) * 180.0 / std::f64::consts::PI).round() as i32;
        for dt in -HOUGH_TOL..=HOUGH_TOL {
            let t = (((phi + dt) % HOUGH_DEG as i32 + HOUGH_DEG as i32) % HOUGH_DEG as i32) as usize;
            let rho_val = (x * cos_t[t] + y * sin_t[t]).round() as isize;
            let acc_idx = t * rw + (rho_val + d_diag as isize) as usize;
            acc[acc_idx] += wgt;
        }
    }

    let mut lines = Vec::new();
    let min_score = HOUGH_MIN_FRAC * (dw.min(dh) as f64);

    for _ in 0..HOUGH_PEAKS {
        let mut best = 0.0f32;
        let mut bi = None;
        for (i, &val) in acc.iter().enumerate() {
            if val > best {
                best = val;
                bi = Some(i);
            }
        }

        let bi_idx = match bi {
            Some(idx) if best as f64 >= min_score => idx,
            _ => break,
        };

        let t = bi_idx / rw;
        let r = bi_idx - t * rw;

        lines.push(HoughLine { t, c: cos_t[t], s: sin_t[t], rho: r as f64 - d_diag as f64, score: best as f64 });

        for dt in -5..=5 {
            let tt = t as isize + dt;
            if tt < 0 || tt >= HOUGH_DEG as isize {
                continue;
            }
            let row_base = tt as usize * rw;
            let r_start = r.saturating_sub(8);
            let r_end = (r + 8).min(rw - 1);
            for dr in r_start..=r_end {
                acc[row_base + dr] = 0.0;
            }
        }
    }

    lines
}

fn line_angle_deg(a: &HoughLine, b: &HoughLine) -> f64 {
    let d = (a.t as isize - b.t as isize).unsigned_abs() % HOUGH_DEG;
    (d as f64).min((HOUGH_DEG - d) as f64)
}

fn line_separation(a: &HoughLine, b: &HoughLine) -> f64 {
    let diff = (a.t as isize - b.t as isize).unsigned_abs();
    if diff <= HOUGH_HALF { (a.rho - b.rho).abs() } else { (a.rho + b.rho).abs() }
}

fn hough_intersect(a: &HoughLine, b: &HoughLine) -> Option<Point> {
    let det = a.c * b.s - a.s * b.c;
    if det.abs() < 1e-6 {
        return None;
    }
    Some(Point((a.rho * b.s - a.s * b.rho) / det, (a.c * b.rho - a.rho * b.c) / det))
}

fn line_pairs(lines: &[HoughLine], dw: usize, dh: usize) -> Vec<(HoughLine, HoughLine, f64)> {
    let min_sep = 0.08 * (dw.min(dh) as f64);
    let mut pairs = Vec::new();

    for i in 0..lines.len() {
        for j in (i + 1)..lines.len() {
            let a = lines[i];
            let b = lines[j];
            if line_angle_deg(&a, &b) > PAR_DEG || line_separation(&a, &b) < min_sep {
                continue;
            }
            pairs.push((a, b, a.score + b.score));
        }
    }

    pairs.sort_by(|p, q| q.2.partial_cmp(&p.2).unwrap_or(std::cmp::Ordering::Equal));
    pairs.truncate(PAIR_KEEP);
    pairs
}

fn line_quads(ctx: &Context, lines: &[HoughLine]) -> Vec<Quad> {
    let dw = ctx.dw;
    let dh = ctx.dh;
    let pairs = line_pairs(lines, dw, dh);
    let tol = 0.03 * (dw as f64).hypot(dh as f64);

    let cross = |p: &(HoughLine, HoughLine, f64), q: &(HoughLine, HoughLine, f64)| -> bool {
        [p.0, p.1].iter().all(|a| [q.0, q.1].iter().all(|b| line_angle_deg(a, b) >= ADJ_DEG))
    };

    let mut out = Vec::new();
    for i in 0..pairs.len() {
        for j in (i + 1)..pairs.len() {
            if !cross(&pairs[i], &pairs[j]) {
                continue;
            }
            let a0 = pairs[i].0;
            let a1 = pairs[i].1;
            let b0 = pairs[j].0;
            let b1 = pairs[j].1;

            let c = [
                hough_intersect(&a0, &b0),
                hough_intersect(&a1, &b0),
                hough_intersect(&a1, &b1),
                hough_intersect(&a0, &b1),
            ];

            let invalid = c.iter().any(|pt| match pt {
                None => true,
                Some(p) => p.0 < -tol || p.1 < -tol || p.0 > (dw - 1) as f64 + tol || p.1 > (dh - 1) as f64 + tol,
            });
            if invalid {
                continue;
            }

            let quad = Quad([
                Point(c[0].unwrap().0.clamp(0.0, (dw - 1) as f64), c[0].unwrap().1.clamp(0.0, (dh - 1) as f64)),
                Point(c[1].unwrap().0.clamp(0.0, (dw - 1) as f64), c[1].unwrap().1.clamp(0.0, (dh - 1) as f64)),
                Point(c[2].unwrap().0.clamp(0.0, (dw - 1) as f64), c[2].unwrap().1.clamp(0.0, (dh - 1) as f64)),
                Point(c[3].unwrap().0.clamp(0.0, (dw - 1) as f64), c[3].unwrap().1.clamp(0.0, (dh - 1) as f64)),
            ]);

            if is_convex(&quad) {
                out.push(quad);
            }
        }
    }

    out
}

fn quad_from_boundary(boundary: Vec<Point>) -> Option<Quad> {
    let hull = convex_hull(boundary);
    if hull.len() < 4 {
        return None;
    }

    let mut tl = hull[0];
    let mut tr = hull[0];
    let mut br = hull[0];
    let mut bl = hull[0];

    for &p in &hull {
        if p.0 + p.1 < tl.0 + tl.1 {
            tl = p;
        }
        if p.0 + p.1 > br.0 + br.1 {
            br = p;
        }
        if p.0 - p.1 > tr.0 - tr.1 {
            tr = p;
        }
        if p.0 - p.1 < bl.0 - bl.1 {
            bl = p;
        }
    }

    let mut quad = Quad([tl, tr, br, bl]);
    let mut improved = true;
    let mut guard = 0;

    while improved && guard < 10 {
        guard += 1;
        improved = false;
        for ci in 0..4 {
            let mut best_a = quad_area(&quad);
            let mut best_p = quad.0[ci];
            for &p in &hull {
                let mut q2 = quad;
                q2.0[ci] = p;
                let a2 = quad_area(&q2);
                if a2 > best_a + 0.5 && is_convex(&q2) {
                    best_a = a2;
                    best_p = p;
                }
            }
            if best_p != quad.0[ci] {
                quad.0[ci] = best_p;
                improved = true;
            }
        }
    }

    Some(order_quad(quad.0))
}

fn mask_quads(ctx: &Context) -> Vec<Quad> {
    let dw = ctx.dw;
    let dh = ctx.dh;
    let n = ctx.n;

    let blur_r = 5.max((dw as f64 / 70.0).round() as usize);
    let blur = blur_map(&ctx.l, dw, dh, blur_r);

    let mut light_mask = vec![0u8; n];
    let mut color_mask = vec![0u8; n];
    let thr_paper = 58.0f64.max(ctx.mean_l * 0.55);

    for i in 0..n {
        let li = ctx.l[i] as f64;
        let sati = ctx.sat[i] as f64;
        let color_delta =
            ((li - ctx.border_l) * 0.75).hypot(ctx.ca[i] as f64 - ctx.border_a).hypot(ctx.cb[i] as f64 - ctx.border_b);

        light_mask[i] = if li >= thr_paper && sati < 0.48 && li >= blur[i] as f64 * 0.78 { 1 } else { 0 };
        color_mask[i] =
            if li > 32.0 && color_delta > 13.0 && (sati < 0.72 || li > ctx.border_l + 12.0) { 1 } else { 0 };
    }

    let mut edge_barrier = vec![0u8; n];
    for (i, item) in edge_barrier.iter_mut().enumerate() {
        *item = if ctx.edge[i] as f64 >= ctx.edge_thr { 1 } else { 0 };
    }
    let barrier = morph_pass(&edge_barrier, dw, dh, 1);

    let mut outside = vec![0u8; n];
    let mut flood = Vec::with_capacity(dw * 2 + dh * 2);

    #[inline]
    fn seed(outside: &mut [u8], barrier: &[u8], flood: &mut Vec<usize>, i: usize) {
        if outside[i] == 0 && barrier[i] == 0 {
            outside[i] = 1;
            flood.push(i);
        }
    }

    for x in 0..dw {
        seed(&mut outside, &barrier, &mut flood, x);
        seed(&mut outside, &barrier, &mut flood, (dh - 1) * dw + x);
    }
    for y in 1..dh - 1 {
        seed(&mut outside, &barrier, &mut flood, y * dw);
        seed(&mut outside, &barrier, &mut flood, y * dw + dw - 1);
    }

    while let Some(p) = flood.pop() {
        let x = p % dw;
        let y = p / dw;
        if x > 0 {
            seed(&mut outside, &barrier, &mut flood, p - 1);
        }
        if x < dw - 1 {
            seed(&mut outside, &barrier, &mut flood, p + 1);
        }
        if y > 0 {
            seed(&mut outside, &barrier, &mut flood, p - dw);
        }
        if y < dh - 1 {
            seed(&mut outside, &barrier, &mut flood, p + dw);
        }
    }

    let mut enclosed_mask = vec![0u8; n];
    for i in 0..n {
        enclosed_mask[i] = if outside[i] != 0 || barrier[i] != 0 { 0 } else { 1 };
    }

    let clean_mask = |m: &[u8]| -> Vec<u8> {
        let closed = morph_pass(&morph_pass(m, dw, dh, 1), dw, dh, 0);
        morph_pass(&morph_pass(&closed, dw, dh, 0), dw, dh, 1)
    };

    let mut masks = vec![clean_mask(&light_mask), clean_mask(&color_mask), clean_mask(&enclosed_mask)];

    let mut combined_mask = vec![0u8; n];
    for i in 0..n {
        combined_mask[i] = if (light_mask[i] != 0 && (color_mask[i] != 0 || enclosed_mask[i] != 0))
            || (color_mask[i] != 0 && enclosed_mask[i] != 0)
        {
            1
        } else {
            0
        };
    }
    masks.push(clean_mask(&combined_mask));

    let mut stack = vec![0usize; n];
    let mut cands = Vec::new();

    for (mi, mask) in masks.iter().enumerate() {
        let mut seen = vec![0u8; n];
        for s0 in 0..n {
            if mask[s0] == 0 || seen[s0] != 0 {
                continue;
            }
            let mut top = 0usize;
            let mut area = 0usize;
            let mut touches = 0usize;
            let mut edge_sum = 0.0f64;
            let mut min_x = dw;
            let mut max_x = 0;
            let mut min_y = dh;
            let mut max_y = 0;
            let mut boundary = Vec::new();

            stack[top] = s0;
            top += 1;
            seen[s0] = 1;

            while top > 0 {
                top -= 1;
                let p = stack[top];
                let py = p / dw;
                let pxx = p % dw;
                area += 1;

                if pxx < min_x {
                    min_x = pxx;
                }
                if pxx > max_x {
                    max_x = pxx;
                }
                if py < min_y {
                    min_y = py;
                }
                if py > max_y {
                    max_y = py;
                }

                let mut bnd = pxx == 0 || py == 0 || pxx >= dw - 1 || py >= dh - 1;
                if bnd {
                    touches += 1;
                }

                if pxx > 0 {
                    let j = p - 1;
                    if mask[j] != 0 {
                        if seen[j] == 0 {
                            seen[j] = 1;
                            stack[top] = j;
                            top += 1;
                        }
                    } else {
                        bnd = true;
                    }
                }
                if pxx < dw - 1 {
                    let j = p + 1;
                    if mask[j] != 0 {
                        if seen[j] == 0 {
                            seen[j] = 1;
                            stack[top] = j;
                            top += 1;
                        }
                    } else {
                        bnd = true;
                    }
                }
                if py > 0 {
                    let j = p - dw;
                    if mask[j] != 0 {
                        if seen[j] == 0 {
                            seen[j] = 1;
                            stack[top] = j;
                            top += 1;
                        }
                    } else {
                        bnd = true;
                    }
                }
                if py < dh - 1 {
                    let j = p + dw;
                    if mask[j] != 0 {
                        if seen[j] == 0 {
                            seen[j] = 1;
                            stack[top] = j;
                            top += 1;
                        }
                    } else {
                        bnd = true;
                    }
                }

                if bnd {
                    boundary.push(Point(pxx as f64, py as f64));
                    edge_sum += ctx.edge[p] as f64;
                }
            }

            let nf = n as f64;
            if (area as f64) < nf * 0.075 || (area as f64) > nf * 0.965 || boundary.len() < 20 {
                continue;
            }

            let bw = (max_x - min_x).max(1) as f64;
            let bh = (max_y - min_y).max(1) as f64;
            let fill = ((area as f64) / (bw * bh)).min(1.0);
            let aspect = bw / bh;
            if aspect < 0.24 || aspect > 4.2 {
                continue;
            }

            let cx2 = (min_x + max_x) as f64 / 2.0;
            let cy2 = (min_y + max_y) as f64 / 2.0;
            let center_penalty = (cx2 - dw as f64 / 2.0).hypot(cy2 - dh as f64 / 2.0) / (dw as f64).hypot(dh as f64);
            let edge_bonus = (1.8f64).min(edge_sum / (boundary.len() as f64 * ctx.edge_thr).max(1.0));
            let touch_penalty = 1.0 - (0.72f64).min((touches as f64) / (boundary.len() as f64).max(1.0) * 2.5);

            let bonus = if mi >= 2 { 1.08 } else { 1.0 };
            let sc = (area as f64)
                * (0.45 + fill)
                * (0.8 + edge_bonus)
                * touch_penalty
                * (1.0 - center_penalty * 0.35)
                * bonus;
            cands.push((sc, boundary));
        }
    }

    cands.sort_by(|p, q| q.0.partial_cmp(&p.0).unwrap_or(std::cmp::Ordering::Equal));
    cands.truncate(EDGE_CANDIDATES);
    cands.into_iter().filter_map(|(_, bnd)| quad_from_boundary(bnd)).collect()
}

fn side_hit(ctx: &Context, px: f64, py: f64, nx: f64, ny: f64) -> bool {
    let dw = ctx.dw;
    let dh = ctx.dh;
    let dir_cos = (25.0f64 * std::f64::consts::PI / 180.0).cos();

    for s in -SIDE_TOL..=SIDE_TOL {
        let x = (px + nx * s as f64).round() as isize;
        let y = (py + ny * s as f64).round() as isize;
        if x < 1 || y < 1 || x >= (dw - 1) as isize || y >= (dh - 1) as isize {
            continue;
        }
        let i = y as usize * dw + x as usize;
        if ctx.e[i] != 0 {
            let dot = (ctx.gx[i] as f64 * nx + ctx.gy[i] as f64 * ny).abs();
            if dot >= ctx.mag[i] as f64 * dir_cos {
                return true;
            }
        }
    }
    false
}

struct QuadScore {
    sc: f64,
    sup: f64,
}

fn score_quad(q: &Quad, ctx: &Context) -> Option<QuadScore> {
    let dw = ctx.dw;
    let dh = ctx.dh;
    let min_side = 0.08 * (dw.min(dh) as f64);
    let sqrt1_2 = std::f64::consts::FRAC_1_SQRT_2;

    for i in 0..4 {
        let p = q.0[i];
        let a = q.0[(i + 3) % 4];
        let b = q.0[(i + 1) % 4];
        let ux = a.0 - p.0;
        let uy = a.1 - p.1;
        let vx = b.0 - p.0;
        let vy = b.1 - p.1;
        let lu = ux.hypot(uy);
        let lv = vx.hypot(vy);
        if lu < min_side || lv < min_side {
            return None;
        }
        let cos_a = (ux * vx + uy * vy) / (lu * lv);
        if cos_a > sqrt1_2 || cos_a < -sqrt1_2 {
            return None;
        }
    }

    let cx = (q.0[0].0 + q.0[1].0 + q.0[2].0 + q.0[3].0) / 4.0;
    let cy = (q.0[0].1 + q.0[1].1 + q.0[2].1 + q.0[3].1) / 4.0;

    let mut sup_min = 1.0f64;
    let mut sup_sum = 0.0f64;
    let mut con_sum = 0.0f64;
    let mut bright = 0usize;

    for e in 0..4 {
        let a = q.0[e];
        let b = q.0[(e + 1) % 4];
        let dx = b.0 - a.0;
        let dy = b.1 - a.1;
        let len = dx.hypot(dy);
        let mut nx = -dy / len;
        let mut ny = dx / len;
        if nx * (cx - (a.0 + b.0) / 2.0) + ny * (cy - (a.1 + b.1) / 2.0) < 0.0 {
            nx = -nx;
            ny = -ny;
        }

        let mut hits = 0usize;
        let mut diff = 0.0f64;
        for k in 0..SIDE_SAMPLES {
            let t = (k as f64 + 0.5) / SIDE_SAMPLES as f64;
            let px = a.0 + dx * t;
            let py = a.1 + dy * t;
            if side_hit(ctx, px, py, nx, ny) {
                hits += 1;
            }
            let o = SIDE_CONTRAST_OFF;
            diff += sample_gray(&ctx.s, dw, dh, px + nx * o, py + ny * o)
                - sample_gray(&ctx.s, dw, dh, px - nx * o, py - ny * o);
        }

        let sup = hits as f64 / SIDE_SAMPLES as f64;
        let dm = diff / SIDE_SAMPLES as f64;
        sup_min = sup_min.min(sup);
        sup_sum += sup;
        con_sum += dm.abs();
        if dm > 0.0 {
            bright += 1;
        }
    }

    let sup = (sup_min + sup_sum / 4.0) / 2.0;
    let cf = (1.0f64).min(con_sum / 4.0 / 30.0);
    let frac = quad_area(q) / (dw as f64 * dh as f64);
    let area_f = frac.sqrt() * (if frac > 0.92 { 0.5 } else { 1.0 });
    let sc = sup * sup * (0.4 + 0.6 * cf) * (0.85 + 0.15 * bright as f64 / 4.0) * area_f;

    Some(QuadScore { sc, sup })
}

fn finish_quad(quad: Quad, ctx: &Context, w: u32, h: u32, refine: Option<&GrayImage>) -> Option<Quad> {
    let mut q0 = order_quad(quad.0);
    for p in &mut q0.0 {
        p.0 /= ctx.kk;
        p.1 /= ctx.kk;
    }

    let mut q = q0;
    if let Some(ref_img) = refine {
        let sx = ref_img.width as f64 / w.max(1) as f64;
        let sy = ref_img.height as f64 / h.max(1) as f64;

        let mut scaled_pts = q0.0;
        for p in &mut scaled_pts {
            p.0 *= sx;
            p.1 *= sy;
        }

        let res = refine_quad_pixels(ref_img, &Quad(scaled_pts));
        let mut unscaled_pts = res.0;
        for p in &mut unscaled_pts {
            p.0 /= sx;
            p.1 /= sy;
        }
        q = Quad(unscaled_pts);
    }

    let ccx = (q.0[0].0 + q.0[1].0 + q.0[2].0 + q.0[3].0) / 4.0;
    let ccy = (q.0[0].1 + q.0[1].1 + q.0[2].1 + q.0[3].1) / 4.0;

    let max_x = w.saturating_sub(1) as f64;
    let max_y = h.saturating_sub(1) as f64;

    for p in &mut q.0 {
        p.0 = (ccx + (p.0 - ccx) * 0.99).clamp(0.0, max_x);
        p.1 = (ccy + (p.1 - ccy) * 0.99).clamp(0.0, max_y);
    }

    let area_q = quad_area(&q);
    let total_area = w as f64 * h as f64;
    if area_q < total_area * 0.1 || area_q > total_area * 0.985 || !is_convex(&q) {
        return None;
    }

    let min_dim = (w.min(h) as f64) * 0.12;
    for i in 0..4 {
        if dist2d(q.0[i], q.0[(i + 1) % 4]) < min_dim {
            return None;
        }
    }

    Some(q)
}

/// Dokumenterkennung: Sucht automatisch das Blatt Papier im Analysebild.
/// Liefert das gefundene Viereck in Originalkoordinaten. Bei unsicherer Erkennung
/// wird zuverlässig das Vollbild zurückgegeben.
pub fn detect_quad_pixels(analysis: &RgbaImage, orig_w: u32, orig_h: u32, refine: Option<&GrayImage>) -> Quad {
    let full = full_quad_pixels(orig_w, orig_h);
    if orig_w == 0 || orig_h == 0 {
        return full;
    }

    let ctx = build_context(analysis, orig_w, orig_h);
    let mut candidates = line_quads(&ctx, &hough_lines(&ctx));
    candidates.extend(mask_quads(&ctx));

    let mut best: Option<(Quad, QuadScore)> = None;
    for quad in candidates {
        if let Some(s) = score_quad(&quad, &ctx) {
            if let Some((_, ref prev_best)) = best {
                if s.sc > prev_best.sc {
                    best = Some((quad, s));
                }
            } else {
                best = Some((quad, s));
            }
        }
    }

    let (best_quad, best_score) = match best {
        Some(b) => b,
        None => return full,
    };

    if best_score.sup < SIDE_SUP_MIN {
        return full;
    }

    finish_quad(best_quad, &ctx, orig_w, orig_h, refine).unwrap_or(full)
}
