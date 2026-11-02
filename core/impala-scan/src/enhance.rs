use crate::types::{RgbaImage, ScanMode};

const NB: usize = 1024;
const NMAX: f32 = 1.25;

#[inline]
fn clamp255(v: f32) -> u8 {
    v.round().clamp(0.0, 255.0) as u8
}

#[inline]
fn qn(v: f32) -> u16 {
    let q = (v / NMAX * (NB as f32 - 1.0)) as i32;
    if q < 0 {
        0
    } else if q >= NB as i32 {
        (NB - 1) as u16
    } else {
        q as u16
    }
}

struct PaperMap {
    r: Vec<f32>,
    g: Vec<f32>,
    b: Vec<f32>,
    bw: usize,
    bh: usize,
    block_size: usize,
}

fn paper_map(pix: &RgbaImage) -> PaperMap {
    let w = pix.width as usize;
    let h = pix.height as usize;
    let d = &pix.data;

    let block_size = 8.max(((w.min(h) as f32 / 40.0).round()) as usize);
    let bw = 2.max(w.div_ceil(block_size));
    let bh = 2.max(h.div_ceil(block_size));

    let mut mr = vec![0.0f32; bw * bh];
    let mut mg = vec![0.0f32; bw * bh];
    let mut mb = vec![0.0f32; bw * bh];

    let mut hist = [0u32; 256];

    for by in 0..bh {
        let y0 = by * block_size;
        let y1 = (y0 + block_size).min(h);
        for bx in 0..bw {
            let x0 = bx * block_size;
            let x1 = (x0 + block_size).min(w);

            hist.fill(0);
            let mut n = 0u32;

            let mut y = y0;
            while y < y1 {
                let mut x = x0;
                while x < x1 {
                    let i = (y * w + x) * 4;
                    let lum = ((d[i] as u32 * 77 + d[i + 1] as u32 * 150 + d[i + 2] as u32 * 29) >> 8) as usize;
                    hist[lum] += 1;
                    n += 1;
                    x += 2;
                }
                y += 2;
            }

            let mut acc = 0u32;
            let mut thr = 255usize;
            let target_n = (n as f32 * 0.3) as u32;
            for v in (0..=255).rev() {
                acc += hist[v];
                if acc >= target_n {
                    thr = v;
                    break;
                }
            }

            let mut r_sum = 0.0f32;
            let mut g_sum = 0.0f32;
            let mut b_sum = 0.0f32;
            let mut c = 0u32;

            let mut y2 = y0;
            while y2 < y1 {
                let mut x2 = x0;
                while x2 < x1 {
                    let i = (y2 * w + x2) * 4;
                    let lum = ((d[i] as u32 * 77 + d[i + 1] as u32 * 150 + d[i + 2] as u32 * 29) >> 8) as usize;
                    if lum >= thr {
                        r_sum += d[i] as f32;
                        g_sum += d[i + 1] as f32;
                        b_sum += d[i + 2] as f32;
                        c += 1;
                    }
                    x2 += 2;
                }
                y2 += 2;
            }

            let o = by * bw + bx;
            let count = c.max(1) as f32;
            mr[o] = r_sum / count;
            mg[o] = g_sum / count;
            mb[o] = b_sum / count;
        }
    }

    let pass = |src: &[f32], use_max: bool| -> Vec<f32> {
        let mut dst = vec![0.0f32; bw * bh];
        for y in 0..bh {
            for x in 0..bw {
                let mut acc = 0.0f32;
                let mut cnt = 0.0f32;
                for dy in -1..=1 {
                    let yy = (y as isize + dy).clamp(0, bh as isize - 1) as usize;
                    for dx in -1..=1 {
                        let xx = (x as isize + dx).clamp(0, bw as isize - 1) as usize;
                        let v = src[yy * bw + xx];
                        if use_max {
                            if v > acc {
                                acc = v;
                            }
                        } else {
                            acc += v;
                            cnt += 1.0;
                        }
                    }
                }
                dst[y * bw + x] = if use_max { acc } else { acc / cnt };
            }
        }
        dst
    };

    let smooth = |m: &[f32]| -> Vec<f32> {
        let p1 = pass(m, true);
        let p2 = pass(&p1, false);
        pass(&p2, false)
    };

    PaperMap { r: smooth(&mr), g: smooth(&mg), b: smooth(&mb), bw, bh, block_size }
}

fn enhance_photo(pix: &mut RgbaImage) {
    let px = &mut pix.data;
    let mut hist = [0u32; 256];
    let total = px.len() / 4;

    for i in (0..px.len()).step_by(4) {
        let lum = ((px[i] as u32 * 77 + px[i + 1] as u32 * 150 + px[i + 2] as u32 * 29) >> 8) as usize;
        hist[lum] += 1;
    }

    let limit = (total as f32 * 0.02) as u32;

    let mut lo = 0usize;
    let mut acc = 0u32;
    for (i, &count) in hist.iter().enumerate() {
        acc += count;
        if acc >= limit {
            lo = i;
            break;
        }
    }

    let mut hi = 255usize;
    acc = 0;
    for i in (0..=255).rev() {
        acc += hist[i];
        if acc >= limit {
            hi = i;
            break;
        }
    }

    let span = (hi as f32 - lo as f32).max(1.0);
    let mut lut = [0u8; 256];
    for (v, item) in lut.iter_mut().enumerate() {
        *item = clamp255((v as f32 - lo as f32) * 255.0 / span);
    }

    for i in (0..px.len()).step_by(4) {
        px[i] = lut[px[i] as usize];
        px[i + 1] = lut[px[i + 1] as usize];
        px[i + 2] = lut[px[i + 2] as usize];
    }
}

fn median3(src: &[u16], w: usize, h: usize) -> Vec<u16> {
    let mut out = vec![0u16; src.len()];
    let mut v = [0u16; 9];

    for y in 0..h {
        let ym = if y > 0 { y - 1 } else { y };
        let yp = if y < h - 1 { y + 1 } else { y };

        for x in 0..w {
            let xm = if x > 0 { x - 1 } else { x };
            let xp = if x < w - 1 { x + 1 } else { x };

            v[0] = src[ym * w + xm];
            v[1] = src[ym * w + x];
            v[2] = src[ym * w + xp];
            v[3] = src[y * w + xm];
            v[4] = src[y * w + x];
            v[5] = src[y * w + xp];
            v[6] = src[yp * w + xm];
            v[7] = src[yp * w + x];
            v[8] = src[yp * w + xp];

            for i in 0..=4 {
                let mut m = i;
                for j in (i + 1)..9 {
                    if v[j] < v[m] {
                        m = j;
                    }
                }
                v.swap(i, m);
            }
            out[y * w + x] = v[4];
        }
    }

    out
}

/// Wendet den gewählten Scan-Modus (Farbe, S/W, Graustufen, Foto) auf ein Bild an.
pub fn apply_scan_mode_pixels(pix: &mut RgbaImage, mode: ScanMode) {
    if mode == ScanMode::Photo {
        enhance_photo(pix);
        return;
    }

    let w = pix.width as usize;
    let h = pix.height as usize;
    let n = w * h;
    let bg = paper_map(pix);
    let denoise = w.min(h) >= 1000;

    let b_size = bg.block_size as f32;
    let mut col_i = vec![0usize; w];
    let mut col_f = vec![0.0f32; w];
    let max_col = (bg.bw as f32 - 1.001).max(0.0);

    for x in 0..w {
        let mut f = (x as f32 + 0.5) / b_size - 0.5;
        if f < 0.0 {
            f = 0.0;
        } else if f > max_col {
            f = max_col;
        }
        col_i[x] = f as usize;
        col_f[x] = f - f.floor();
    }

    let max_row = (bg.bh as f32 - 1.001).max(0.0);
    let paper_at = |map: &[f32], y: usize, x: usize| -> f32 {
        let mut fy = (y as f32 + 0.5) / b_size - 0.5;
        if fy < 0.0 {
            fy = 0.0;
        } else if fy > max_row {
            fy = max_row;
        }
        let y0 = fy as usize;
        let dy = fy - y0 as f32;
        let dx = col_f[x];
        let o = y0 * bg.bw + col_i[x];

        let val = map[o] * (1.0 - dx) * (1.0 - dy)
            + map[o + 1] * dx * (1.0 - dy)
            + map[o + bg.bw] * (1.0 - dx) * dy
            + map[o + bg.bw + 1] * dx * dy;
        val.max(24.0)
    };

    let mut qr = vec![0u16; n];
    let mut qg = vec![0u16; n];
    let mut qb = vec![0u16; n];
    let mut ql = vec![0u16; n];
    let mut hist = [0u32; NB];

    let px = &pix.data;
    for y in 0..h {
        for x in 0..w {
            let k = y * w + x;
            let i = k * 4;

            let pr = paper_at(&bg.r, y, x);
            let pg = paper_at(&bg.g, y, x);
            let pb = paper_at(&bg.b, y, x);

            let r = px[i] as f32 / pr;
            let g = px[i + 1] as f32 / pg;
            let b = px[i + 2] as f32 / pb;

            qr[k] = qn(r);
            qg[k] = qn(g);
            qb[k] = qn(b);

            let l = qn(r * 0.299 + g * 0.587 + b * 0.114);
            ql[k] = l;
            hist[l as usize] += 1;
        }
    }

    let pct = |p: f32| -> usize {
        let mut acc = 0u32;
        let limit = (n as f32 * p) as u32;
        for (v, &count) in hist.iter().enumerate() {
            acc += count;
            if acc >= limit {
                return v;
            }
        }
        NB - 1
    };

    let paper = pct(0.5) as f32;
    let ink = (pct(0.01) as f32).min(paper * 0.6);

    let white = paper * 0.92;
    let black = ink * 0.85;
    let span = (white - black).max(1.0);

    let mut tone = [0.0f32; NB];
    for (v, item) in tone.iter_mut().enumerate() {
        let t = (v as f32 - black) / span;
        *item = if t <= 0.0 {
            0.0
        } else if t >= 1.0 {
            1.0
        } else {
            t.powf(1.5)
        };
    }

    let px_mut = &mut pix.data;

    if mode == ScanMode::Color {
        let mut lut = [0u8; NB];
        for v in 0..NB {
            lut[v] = clamp255(tone[v] * 255.0);
        }

        let mr = if denoise { median3(&qr, w, h) } else { qr };
        let mg = if denoise { median3(&qg, w, h) } else { qg };
        let mb = if denoise { median3(&qb, w, h) } else { qb };

        for k in 0..n {
            let i = k * 4;
            px_mut[i] = lut[mr[k] as usize];
            px_mut[i + 1] = lut[mg[k] as usize];
            px_mut[i + 2] = lut[mb[k] as usize];
        }
        return;
    }

    let mut lut = [0u8; NB];

    if mode == ScanMode::Bw {
        let mut th = [0.0f64; 256];
        for v in 0..NB {
            let idx = (tone[v] * 255.0).round().clamp(0.0, 255.0) as usize;
            th[idx] += hist[v] as f64;
        }

        let mut sum = 0.0f64;
        let mut tot = 0.0f64;
        for (v, &val) in th.iter().enumerate() {
            sum += v as f64 * val;
            tot += val;
        }

        let mut s_b = 0.0f64;
        let mut w_b = 0.0f64;
        let mut best = 0.0f64;
        let mut thresh = 180.0f64;

        for (v, &val) in th.iter().enumerate() {
            w_b += val;
            if w_b == 0.0 {
                continue;
            }
            let w_f = tot - w_b;
            if w_f == 0.0 {
                break;
            }
            s_b += v as f64 * val;
            let m_b = s_b / w_b;
            let m_f = (sum - s_b) / w_f;
            let between = w_b * w_f * (m_b - m_f) * (m_b - m_f);
            if between > best {
                best = between;
                thresh = v as f64;
            }
        }

        thresh = (thresh + 12.0).clamp(120.0, 215.0);

        for v in 0..NB {
            let t = (tone[v] * 255.0 - (thresh - 18.0) as f32) / 36.0;
            let s = if t <= 0.0 {
                0.0
            } else if t >= 1.0 {
                1.0
            } else {
                t * t * (3.0 - 2.0 * t)
            };
            lut[v] = clamp255(s * 255.0);
        }
    } else {
        // Gray
        for v in 0..NB {
            lut[v] = clamp255(tone[v] * 255.0);
        }
    }

    let ml = if denoise { median3(&ql, w, h) } else { ql };

    for k in 0..n {
        let i = k * 4;
        let val = lut[ml[k] as usize];
        px_mut[i] = val;
        px_mut[i + 1] = val;
        px_mut[i + 2] = val;
    }
}
