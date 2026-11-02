use crate::geom::dist2d;
use crate::types::{OUT_MAX_PIXELS, Point, Quad, RgbaImage, SCAN_OUT_MAX_EDGE};

/// Berechnet die Homographie (3×3-Projektionsmatrix mit h8 = 1.0)
/// vom Zielrechteck `[0, 0]..[W, H]` auf das Quellviereck `quad` über ein 8×8-Gleichungssystem mit Gauß-Elimination.
#[allow(clippy::needless_range_loop)]
pub fn homography(quad: &Quad, w: f64, h: f64) -> [f64; 8] {
    let dst = [Point(0.0, 0.0), Point(w, 0.0), Point(w, h), Point(0.0, h)];

    let mut a = [[0.0f64; 8]; 8];
    let mut b = [0.0f64; 8];

    for (i, dst_pt) in dst.iter().enumerate() {
        let x_dst = dst_pt.0;
        let y_dst = dst_pt.1;
        let x_src = quad.0[i].0;
        let y_src = quad.0[i].1;

        let r1 = i * 2;
        a[r1] = [x_dst, y_dst, 1.0, 0.0, 0.0, 0.0, -x_dst * x_src, -y_dst * x_src];
        b[r1] = x_src;

        let r2 = i * 2 + 1;
        a[r2] = [0.0, 0.0, 0.0, x_dst, y_dst, 1.0, -x_dst * y_src, -y_dst * y_src];
        b[r2] = y_src;
    }

    for c in 0..8 {
        let mut piv = c;
        for r in (c + 1)..8 {
            if a[r][c].abs() > a[piv][c].abs() {
                piv = r;
            }
        }
        a.swap(c, piv);
        b.swap(c, piv);

        let pv = if a[c][c].abs() < 1e-9 { 1e-9 } else { a[c][c] };
        for r in (c + 1)..8 {
            let f = a[r][c] / pv;
            for k2 in c..8 {
                a[r][k2] -= f * a[c][k2];
            }
            b[r] -= f * b[c];
        }
    }

    let mut hm = [0.0f64; 8];
    for r in (0..8).rev() {
        let mut s = b[r];
        for k2 in (r + 1)..8 {
            s -= a[r][k2] * hm[k2];
        }
        let denom = if a[r][r].abs() < 1e-9 { 1e-9 } else { a[r][r] };
        hm[r] = s / denom;
    }

    hm
}

/// Perspektivische Entzerrung eines Bildausschnitts mit bilinearem Sampling.
pub fn warp_pixels(src: &RgbaImage, quad: &Quad) -> RgbaImage {
    let iw = src.width;
    let ih = src.height;
    let sd = &src.data;

    let w0 = dist2d(quad.0[0], quad.0[1]).max(dist2d(quad.0[3], quad.0[2])).round();
    let h0 = dist2d(quad.0[0], quad.0[3]).max(dist2d(quad.0[1], quad.0[2])).round();

    let edge_scale = (SCAN_OUT_MAX_EDGE as f64 / w0.max(h0).max(1.0)).min(1.0);
    let pixel_scale = ((OUT_MAX_PIXELS as f64 / (w0 * h0).max(1.0)).sqrt()).min(1.0);
    let k = edge_scale.min(pixel_scale);

    let out_w = ((w0 * k).round() as u32).max(8);
    let out_h = ((h0 * k).round() as u32).max(8);

    let mut op = vec![0u8; out_w as usize * out_h as usize * 4];
    let hm = homography(quad, out_w as f64, out_h as f64);

    let max_sx = (iw as f64 - 2.001).max(0.0);
    let max_sy = (ih as f64 - 2.001).max(0.0);

    for y in 0..out_h {
        let y_f = y as f64;
        for x in 0..out_w {
            let x_f = x as f64;
            let den = hm[6] * x_f + hm[7] * y_f + 1.0;
            let mut sx = (hm[0] * x_f + hm[1] * y_f + hm[2]) / den;
            let mut sy = (hm[3] * x_f + hm[4] * y_f + hm[5]) / den;

            if sx < 0.0 {
                sx = 0.0;
            } else if sx > max_sx {
                sx = max_sx;
            }
            if sy < 0.0 {
                sy = 0.0;
            } else if sy > max_sy {
                sy = max_sy;
            }

            let x0 = sx as usize;
            let y0 = sy as usize;
            let fx = sx - x0 as f64;
            let fy = sy - y0 as f64;

            let i00 = (y0 * iw as usize + x0) * 4;
            let i10 = i00 + 4;
            let i01 = i00 + iw as usize * 4;
            let i11 = i01 + 4;

            let w00 = (1.0 - fx) * (1.0 - fy);
            let w10 = fx * (1.0 - fy);
            let w01 = (1.0 - fx) * fy;
            let w11 = fx * fy;

            let r = sd[i00] as f64 * w00 + sd[i10] as f64 * w10 + sd[i01] as f64 * w01 + sd[i11] as f64 * w11;
            let g = sd[i00 + 1] as f64 * w00
                + sd[i10 + 1] as f64 * w10
                + sd[i01 + 1] as f64 * w01
                + sd[i11 + 1] as f64 * w11;
            let b = sd[i00 + 2] as f64 * w00
                + sd[i10 + 2] as f64 * w10
                + sd[i01 + 2] as f64 * w01
                + sd[i11 + 2] as f64 * w11;

            let o = (y as usize * out_w as usize + x as usize) * 4;
            op[o] = r.round().clamp(0.0, 255.0) as u8;
            op[o + 1] = g.round().clamp(0.0, 255.0) as u8;
            op[o + 2] = b.round().clamp(0.0, 255.0) as u8;
            op[o + 3] = 255;
        }
    }

    RgbaImage { width: out_w, height: out_h, data: op }
}
