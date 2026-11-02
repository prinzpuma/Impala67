//! Dokument-Scanner für native Apps: dünne Hülle um `impala-scan` (Blattkanten finden, Qualität prüfen,
//! perspektivisch entzerren, Filter, Drehen) – dieselbe Logik wie der Scanner der PWA.

use impala_scan::{
    GrayImage, Point, Quad, RgbaImage, Rotation, ScanMode, apply_scan_mode_pixels, detect_quad_pixels, detect_sizes, downscale_pixels,
    full_quad_pixels, rotate_pixels, scan_quality_pixels, to_gray, warp_pixels,
};

/// Bild (RGBA, 4 Bytes je Pixel) an der Grenze.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ScanImage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// Qualität eines Kamerabilds: unscharf, zu flau, zu dunkel, Spiegelung.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ScanCheck {
    pub soft: bool,
    pub flat: bool,
    pub too_dark: bool,
    pub glare: bool,
    pub sharp: f64,
    pub contrast: f64,
}

/// Gefundenes Blatt: Ecken (oben-links, oben-rechts, unten-rechts, unten-links) als `[x0, y0, … x3, y3]`
/// in Bildpixeln; `full` = keine sichere Kante, das ganze Bild.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ScanDetection {
    pub corners: Vec<f64>,
    pub full: bool,
    pub check: ScanCheck,
}

#[derive(Debug, Clone, PartialEq, uniffi::Error)]
pub enum ScanFailure {
    Invalid { reason: String },
}

impl std::fmt::Display for ScanFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            ScanFailure::Invalid { reason } => f.write_str(reason),
        }
    }
}

impl std::error::Error for ScanFailure {}

fn image(img: ScanImage) -> Result<RgbaImage, ScanFailure> {
    RgbaImage::new(img.width, img.height, img.rgba).map_err(|e| ScanFailure::Invalid { reason: e.to_owned() })
}

fn quad_of(c: &[f64]) -> Result<Quad, ScanFailure> {
    if c.len() != 8 {
        return Err(ScanFailure::Invalid { reason: "Vier Ecken erwartet".into() });
    }
    Ok(Quad([Point(c[0], c[1]), Point(c[2], c[3]), Point(c[4], c[5]), Point(c[6], c[7])]))
}

fn corners(q: &Quad) -> Vec<f64> {
    q.0.iter().flat_map(|p| [p.0, p.1]).collect()
}

/// Blattkanten und Qualität eines Bilds (Kamerabild oder Foto). Rechnet intern auf verkleinerten Kopien.
#[uniffi::export]
pub fn scan_detect(img: ScanImage) -> Result<ScanDetection, ScanFailure> {
    let pix = image(img)?;
    let sizes = detect_sizes(pix.width, pix.height);
    let analysis = downscale_pixels(&pix, sizes.dw, sizes.dh);
    let refine: GrayImage = to_gray(&downscale_pixels(&pix, sizes.gw, sizes.gh));
    let quad = detect_quad_pixels(&analysis, pix.width, pix.height, Some(&refine));
    let q = scan_quality_pixels(&analysis);
    Ok(ScanDetection {
        corners: corners(&quad),
        full: quad == full_quad_pixels(pix.width, pix.height),
        check: ScanCheck { soft: q.soft, flat: q.flat, too_dark: q.too_dark, glare: q.glare, sharp: q.sharp, contrast: q.contrast },
    })
}

/// Fertiger Scan: entlang `corners` entzerren, Filter (`color`, `bw`, `gray`, `photo`) und Drehung
/// (`rotation` in 90°-Schritten im Uhrzeigersinn) anwenden.
#[uniffi::export]
pub fn scan_process(img: ScanImage, corners: Vec<f64>, mode: String, rotation: i32) -> Result<ScanImage, ScanFailure> {
    let pix = image(img)?;
    let mut out = warp_pixels(&pix, &quad_of(&corners)?);
    let m = match mode.as_str() {
        "bw" => ScanMode::Bw,
        "gray" => ScanMode::Gray,
        "photo" => ScanMode::Photo,
        _ => ScanMode::Color,
    };
    apply_scan_mode_pixels(&mut out, m);
    let out = rotate_pixels(&out, Rotation::from_steps(rotation));
    Ok(ScanImage { width: out.width, height: out.height, rgba: out.data })
}
