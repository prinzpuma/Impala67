use serde::{Deserialize, Serialize};

pub const SCAN_JPEG_QUALITY: f64 = 0.78;
pub const SCAN_OUT_MAX_EDGE: u32 = 1800;
pub const SCAN_SOURCE_MAX: u32 = 4096;
pub const OUT_MAX_PIXELS: u64 = 4_800_000;
pub const DETECT_MAX: u32 = 720;
pub const REFINE_MAX: u32 = 1600;

/// Ein 2D-Punkt als `[x, y]` serialisiert für JSON-Kompatibilität zum PWA-Scanner.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point(pub f64, pub f64);

impl Point {
    #[inline]
    pub fn x(&self) -> f64 {
        self.0
    }

    #[inline]
    pub fn y(&self) -> f64 {
        self.1
    }
}

impl From<[f64; 2]> for Point {
    fn from(arr: [f64; 2]) -> Self {
        Self(arr[0], arr[1])
    }
}

impl From<Point> for [f64; 2] {
    fn from(p: Point) -> Self {
        [p.0, p.1]
    }
}

/// Ein Viereck aus vier 2D-Punkten in der Reihenfolge oben-links, oben-rechts, unten-rechts, unten-links.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Quad(pub [Point; 4]);

impl Quad {
    pub fn new(p0: Point, p1: Point, p2: Point, p3: Point) -> Self {
        Self([p0, p1, p2, p3])
    }
}

/// Bild in RGBA-Format (4 Bytes je Pixel).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RgbaImage {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

impl RgbaImage {
    pub fn new(width: u32, height: u32, data: Vec<u8>) -> Result<Self, &'static str> {
        let expected = width as usize * height as usize * 4;
        if data.len() != expected {
            return Err("Ungültige Bilddatenlänge für RGBA");
        }
        Ok(Self { width, height, data })
    }

    pub fn zeroed(width: u32, height: u32) -> Self {
        let len = width as usize * height as usize * 4;
        Self { width, height, data: vec![0; len] }
    }
}

/// Graustufenbild (1 Gleitkommawert 0.0…255.0 je Pixel), wie für die Kantenverfeinerung genutzt.
#[derive(Debug, Clone, PartialEq)]
pub struct GrayImage {
    pub width: u32,
    pub height: u32,
    pub data: Vec<f32>,
}

impl GrayImage {
    pub fn new(width: u32, height: u32, data: Vec<f32>) -> Result<Self, &'static str> {
        let expected = width as usize * height as usize;
        if data.len() != expected {
            return Err("Ungültige Datenlänge für Graustufenbild");
        }
        Ok(Self { width, height, data })
    }
}

/// Scan-Modi zur Bildaufbereitung.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScanMode {
    Color,
    Bw,
    Gray,
    Photo,
}

/// Drehung im Uhrzeigersinn in 90°-Schritten.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Rotation {
    None = 0,
    Rotate90 = 1,
    Rotate180 = 2,
    Rotate270 = 3,
}

impl Rotation {
    pub fn from_steps(steps: i32) -> Self {
        match steps.rem_euclid(4) {
            1 => Self::Rotate90,
            2 => Self::Rotate180,
            3 => Self::Rotate270,
            _ => Self::None,
        }
    }
}

/// Helligkeits-, Kontrast- und Schärfe-Messwerte.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LumStats {
    pub mean: f64,
    pub contrast: f64,
    pub sharp: f64,
    pub dark_ratio: f64,
    pub bright_ratio: f64,
}

/// Qualitätsbewertung eines Scans.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanQuality {
    pub sharp: f64,
    pub contrast: f64,
    pub dark_ratio: f64,
    pub bright_ratio: f64,
    pub soft: bool,
    pub flat: bool,
    pub too_dark: bool,
    pub glare: bool,
}

/// Größen für die Dokumentenerkennung.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct DetectSizes {
    pub dw: u32,
    pub dh: u32,
    pub gw: u32,
    pub gh: u32,
}
