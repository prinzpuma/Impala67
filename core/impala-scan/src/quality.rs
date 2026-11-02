use crate::types::{LumStats, RgbaImage, Rotation, ScanQuality};

/// Verkleinert ein Bild per Blockmittelwert (ohne externe Bibliotheken).
pub fn downscale_pixels(pix: &RgbaImage, w: u32, h: u32) -> RgbaImage {
    let s = &pix.data;
    let sw = pix.width as usize;
    let sh = pix.height as usize;
    let out_w = w as usize;
    let out_h = h as usize;

    let mut out = vec![0u8; out_w * out_h * 4];

    for y in 0..out_h {
        let y0 = (y * sh) / out_h;
        let y1 = sh.min((y0 + 1).max(((y + 1) * sh) / out_h));

        for x in 0..out_w {
            let x0 = (x * sw) / out_w;
            let x1 = sw.min((x0 + 1).max(((x + 1) * sw) / out_w));

            let mut r = 0u64;
            let mut g = 0u64;
            let mut b = 0u64;
            let mut n = 0u64;

            for yy in y0..y1 {
                for xx in x0..x1 {
                    let i = (yy * sw + xx) * 4;
                    r += s[i] as u64;
                    g += s[i + 1] as u64;
                    b += s[i + 2] as u64;
                    n += 1;
                }
            }

            let o = (y * out_w + x) * 4;
            let div = (n.max(1)) as f64;
            out[o] = ((r as f64 / div).round()).clamp(0.0, 255.0) as u8;
            out[o + 1] = ((g as f64 / div).round()).clamp(0.0, 255.0) as u8;
            out[o + 2] = ((b as f64 / div).round()).clamp(0.0, 255.0) as u8;
            out[o + 3] = 255;
        }
    }

    RgbaImage { width: w, height: h, data: out }
}

/// Dreht ein Bild um 90°-Schritte im Uhrzeigersinn.
pub fn rotate_pixels(pix: &RgbaImage, rotation: Rotation) -> RgbaImage {
    if rotation == Rotation::None {
        return pix.clone();
    }

    let w = pix.width as usize;
    let h = pix.height as usize;
    let r = rotation as usize;
    let swap = r % 2 == 1;

    let out_w = if swap { h } else { w };
    let out_h = if swap { w } else { h };

    let mut out = vec![0u8; out_w * out_h * 4];
    let s = &pix.data;

    for sy in 0..h {
        for sx in 0..w {
            let (dx, dy) = match r {
                1 => (h - 1 - sy, sx),
                2 => (w - 1 - sx, h - 1 - sy),
                _ => (sy, w - 1 - sx),
            };

            let si = (sy * w + sx) * 4;
            let di = (dy * out_w + dx) * 4;

            out[di] = s[si];
            out[di + 1] = s[si + 1];
            out[di + 2] = s[si + 2];
            out[di + 3] = s[si + 3];
        }
    }

    RgbaImage { width: out_w as u32, height: out_h as u32, data: out }
}

/// Ermittelt Helligkeit, Kontrast und Schärfe (über Laplace-Filter) eines Bildes.
pub fn lum_stats_pixels(pix: &RgbaImage, step: usize) -> LumStats {
    let w = pix.width as usize;
    let h = pix.height as usize;
    let px = &pix.data;
    let total = w * h;

    let mut lum = vec![0u8; total];
    let mut sum = 0.0f64;
    let mut sum2 = 0.0f64;
    let mut dark = 0usize;
    let mut bright = 0usize;

    for i in 0..total {
        let r = px[i * 4] as u32;
        let g = px[i * 4 + 1] as u32;
        let b = px[i * 4 + 2] as u32;
        let v = ((r * 77 + g * 150 + b * 29) >> 8) as u8;
        lum[i] = v;

        let vf = v as f64;
        sum += vf;
        sum2 += vf * vf;

        if v < 28 {
            dark += 1;
        } else if v > 245 {
            bright += 1;
        }
    }

    let mut lap = 0.0f64;
    let mut taps = 0usize;
    let step_val = step.max(1);

    if w >= 3 && h >= 3 {
        let mut y = 1;
        while y < h - 1 {
            let mut x = 1;
            while x < w - 1 {
                let i = y * w + x;
                let center = lum[i] as i32;
                let left = lum[i - 1] as i32;
                let right = lum[i + 1] as i32;
                let top = lum[i - w] as i32;
                let bottom = lum[i + w] as i32;

                let diff = (4 * center - left - right - top - bottom).abs();
                lap += diff as f64;
                taps += 1;

                x += step_val;
            }
            y += step_val;
        }
    }

    let total_f = total as f64;
    let mean = sum / total_f;
    let variance = (sum2 / total_f - mean * mean).max(0.0);
    let contrast = variance.sqrt();
    let sharp = lap / (taps.max(1) as f64);
    let dark_ratio = dark as f64 / total_f;
    let bright_ratio = bright as f64 / total_f;

    LumStats { mean, contrast, sharp, dark_ratio, bright_ratio }
}

/// Prüft die Qualität des fertigen Scans (unscharf, flau, zu dunkel, überbelichtet).
pub fn scan_quality_pixels(pix: &RgbaImage) -> ScanQuality {
    let max_side = 360.0f64;
    let k = (max_side / (pix.width.max(pix.height) as f64)).min(1.0);
    let sw = ((pix.width as f64 * k).round() as u32).max(2);
    let sh = ((pix.height as f64 * k).round() as u32).max(2);

    let small = downscale_pixels(pix, sw, sh);
    let stats = lum_stats_pixels(&small, 1);

    ScanQuality {
        sharp: stats.sharp,
        contrast: stats.contrast,
        dark_ratio: stats.dark_ratio,
        bright_ratio: stats.bright_ratio,
        soft: stats.sharp < 5.5,
        flat: stats.contrast < 13.0,
        too_dark: stats.dark_ratio > 0.18,
        glare: stats.bright_ratio > 0.92 && stats.contrast < 18.0,
    }
}
