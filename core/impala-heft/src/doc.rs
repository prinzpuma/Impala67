//! Das Heft-Dokument: Seiten mit Strichen, Bildern und Textfeldern.
//!
//! Das JSON ist dasselbe wie in der JS-App (`S.heftDocs[pageId]`, `heftOps`, `heftSnap`).
//! Gelesen wird nachsichtig: Fehlende Felder bekommen die Vorgaben des Reducers, Felder mit
//! fremdem Typ und unbekannte Felder bleiben unverändert erhalten und werden mitgeschrieben.

use std::fmt;

use serde::de::value::{MapAccessDeserializer, SeqAccessDeserializer};
use serde::de::{Deserialize, Deserializer, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde::ser::{Serialize, SerializeMap, SerializeSeq, Serializer};
use serde_json::{Map, Value};

use crate::json::{Fields, JsNum, ObjWriter, id_str, js_len, js_trim, num, radix36, string};

/// Seitenmaße in Weltkoordinaten (`PAGE_W`/`PAGE_H` in `heft-document-core.js`).
pub const PAGE_W: f64 = 1000.0;
pub const PAGE_H: f64 = 1414.0;

/// Ein Stiftpunkt `[x, y, druck]`, in Altständen auch `[x, y]` oder `[x, y, druck, zeit]`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
    /// Druck 0…1; `None`: fehlt, `NaN`: `null` im JSON.
    pub p: Option<f64>,
    /// Zeitstempel (nur Altstände).
    pub t: Option<f64>,
}

impl Point {
    pub const fn new(x: f64, y: f64, p: f64) -> Self {
        Point { x, y, p: Some(p), t: None }
    }
    pub const fn xy(x: f64, y: f64) -> Self {
        Point { x, y, p: None, t: None }
    }
    /// Liest `[x, y, …]`; `null` (aus `NaN`) bleibt `NaN`. Keine Liste: kein Punkt.
    fn from_value(v: &Value) -> Option<Self> {
        let a = v.as_array()?;
        // Vorhanden, aber keine Zahl (`null`): NaN – so bleibt die Stelle beim Schreiben erhalten.
        let at = |i: usize| a.get(i).map(|v| v.as_f64().unwrap_or(f64::NAN));
        Some(Point { x: at(0).unwrap_or(f64::NAN), y: at(1).unwrap_or(f64::NAN), p: at(2), t: at(3) })
    }
}

impl Serialize for Point {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let n = if self.t.is_some() {
            4
        } else if self.p.is_some() {
            3
        } else {
            2
        };
        let mut seq = s.serialize_seq(Some(n))?;
        seq.serialize_element(&JsNum(self.x))?;
        seq.serialize_element(&JsNum(self.y))?;
        if n >= 3 {
            seq.serialize_element(&self.p.map(JsNum))?;
        }
        if let Some(t) = self.t {
            seq.serialize_element(&JsNum(t))?;
        }
        seq.end()
    }
}

/// Achsenparalleles Rechteck (`{ minX, minY, maxX, maxY }`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BBox {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

impl BBox {
    /// Liest `{ minX, minY, maxX, maxY }`; fehlt eine Zahl: `None`.
    pub fn from_value(v: &Value) -> Option<Self> {
        let f = |k: &str| v.get(k).and_then(Value::as_f64);
        Some(BBox { min_x: f("minX")?, min_y: f("minY")?, max_x: f("maxX")?, max_y: f("maxY")? })
    }
    /// Überschneiden sich zwei Rechtecke (Ränder zählen mit)?
    pub fn intersects(&self, o: &BBox) -> bool {
        self.min_x <= o.max_x && self.max_x >= o.min_x && self.min_y <= o.max_y && self.max_y >= o.min_y
    }
    pub fn translate(&mut self, dx: f64, dy: f64) {
        self.min_x += dx;
        self.max_x += dx;
        self.min_y += dy;
        self.max_y += dy;
    }
}

impl Serialize for BBox {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut m = s.serialize_map(Some(4))?;
        m.serialize_entry("minX", &JsNum(self.min_x))?;
        m.serialize_entry("minY", &JsNum(self.min_y))?;
        m.serialize_entry("maxX", &JsNum(self.max_x))?;
        m.serialize_entry("maxY", &JsNum(self.max_y))?;
        m.end()
    }
}

/// Werkzeug eines Strichs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Tool {
    Pen,
    /// Textmarker (halbtransparent, dreifache Breite).
    Marker,
    /// Erkannte Form (`shape` trägt die Geometrie).
    Shape,
    Other(String),
}

impl Tool {
    pub fn parse(s: &str) -> Self {
        match s {
            "pen" => Tool::Pen,
            "marker" => Tool::Marker,
            "shape" => Tool::Shape,
            other => Tool::Other(other.to_owned()),
        }
    }
    pub fn as_str(&self) -> &str {
        match self {
            Tool::Pen => "pen",
            Tool::Marker => "marker",
            Tool::Shape => "shape",
            Tool::Other(s) => s,
        }
    }
}

impl Serialize for Tool {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(self.as_str())
    }
}

/// Erkannte bzw. gezeichnete Form. `Other` hält Formen, die diese Version nicht kennt,
/// unverändert fest (gezeichnet und getroffen wird dann über die Punkte).
#[derive(Debug, Clone, PartialEq)]
pub enum Shape {
    Line {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
    },
    Rect {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
    },
    Triangle {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
        x3: f64,
        y3: f64,
    },
    /// Pfeil: Schaft (x1,y1)→(x2,y2), Spitzen-Enden h1 und h2.
    Arrow {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
        h1x: f64,
        h1y: f64,
        h2x: f64,
        h2y: f64,
    },
    Ellipse {
        cx: f64,
        cy: f64,
        rx: f64,
        ry: f64,
    },
    /// Nur in Altständen; kennt nur einen Radius.
    Circle {
        cx: f64,
        cy: f64,
        r: f64,
    },
    Other(Map<String, Value>),
}

const LINE: &[&str] = &["x1", "y1", "x2", "y2"];
const TRIANGLE: &[&str] = &["x1", "y1", "x2", "y2", "x3", "y3"];
const ARROW: &[&str] = &["x1", "y1", "x2", "y2", "h1x", "h1y", "h2x", "h2y"];
const ELLIPSE: &[&str] = &["cx", "cy", "rx", "ry"];
const CIRCLE: &[&str] = &["cx", "cy", "r"];

impl Shape {
    fn keys(kind: &str) -> Option<&'static [&'static str]> {
        Some(match kind {
            "line" | "rect" => LINE,
            "triangle" => TRIANGLE,
            "arrow" => ARROW,
            "ellipse" => ELLIPSE,
            "circle" => CIRCLE,
            _ => return None,
        })
    }

    fn from_value(v: &Value) -> Option<Self> {
        let m = v.as_object()?;
        Some(Self::known(m).unwrap_or_else(|| Shape::Other(m.clone())))
    }

    /// Bekannte Form nur, wenn genau ihre Felder als Zahlen vorliegen – sonst ginge beim
    /// Zurückschreiben etwas verloren.
    fn known(m: &Map<String, Value>) -> Option<Self> {
        let kind = m.get("type")?.as_str()?;
        let keys = Self::keys(kind)?;
        if m.len() != keys.len() + 1 {
            return None;
        }
        let v: Vec<f64> = keys.iter().map(|k| m.get(*k).and_then(Value::as_f64)).collect::<Option<_>>()?;
        Some(match kind {
            "line" => Shape::Line { x1: v[0], y1: v[1], x2: v[2], y2: v[3] },
            "rect" => Shape::Rect { x1: v[0], y1: v[1], x2: v[2], y2: v[3] },
            "triangle" => Shape::Triangle { x1: v[0], y1: v[1], x2: v[2], y2: v[3], x3: v[4], y3: v[5] },
            "arrow" => {
                Shape::Arrow { x1: v[0], y1: v[1], x2: v[2], y2: v[3], h1x: v[4], h1y: v[5], h2x: v[6], h2y: v[7] }
            }
            "ellipse" => Shape::Ellipse { cx: v[0], cy: v[1], rx: v[2], ry: v[3] },
            _ => Shape::Circle { cx: v[0], cy: v[1], r: v[2] },
        })
    }

    /// `type` der Form.
    pub fn kind(&self) -> &str {
        match self {
            Shape::Line { .. } => "line",
            Shape::Rect { .. } => "rect",
            Shape::Triangle { .. } => "triangle",
            Shape::Arrow { .. } => "arrow",
            Shape::Ellipse { .. } => "ellipse",
            Shape::Circle { .. } => "circle",
            Shape::Other(m) => m.get("type").and_then(Value::as_str).unwrap_or(""),
        }
    }

    /// Eckpunkte der Polygon-Formen (Linie, Rechteck, Dreieck, Pfeil) in Feldreihenfolge.
    pub fn corner_points_mut(&mut self) -> Vec<(&mut f64, &mut f64)> {
        match self {
            Shape::Line { x1, y1, x2, y2 } | Shape::Rect { x1, y1, x2, y2 } => vec![(x1, y1), (x2, y2)],
            Shape::Triangle { x1, y1, x2, y2, x3, y3 } => vec![(x1, y1), (x2, y2), (x3, y3)],
            Shape::Arrow { x1, y1, x2, y2, h1x, h1y, h2x, h2y } => vec![(x1, y1), (x2, y2), (h1x, h1y), (h2x, h2y)],
            _ => Vec::new(),
        }
    }

    pub fn corner_points(&self) -> Vec<[f64; 2]> {
        match *self {
            Shape::Line { x1, y1, x2, y2 } | Shape::Rect { x1, y1, x2, y2 } => vec![[x1, y1], [x2, y2]],
            Shape::Triangle { x1, y1, x2, y2, x3, y3 } => vec![[x1, y1], [x2, y2], [x3, y3]],
            Shape::Arrow { x1, y1, x2, y2, h1x, h1y, h2x, h2y } => vec![[x1, y1], [x2, y2], [h1x, h1y], [h2x, h2y]],
            _ => Vec::new(),
        }
    }

    fn values(&self) -> Vec<f64> {
        match *self {
            Shape::Ellipse { cx, cy, rx, ry } => vec![cx, cy, rx, ry],
            Shape::Circle { cx, cy, r } => vec![cx, cy, r],
            _ => self.corner_points().into_iter().flatten().collect(),
        }
    }
}

impl Serialize for Shape {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        if let Shape::Other(m) = self {
            return m.serialize(s);
        }
        let kind = self.kind();
        let keys = Shape::keys(kind).unwrap_or(&[]);
        let mut m = s.serialize_map(Some(keys.len() + 1))?;
        m.serialize_entry("type", kind)?;
        for (k, v) in keys.iter().zip(self.values()) {
            m.serialize_entry(k, &JsNum(v))?;
        }
        m.end()
    }
}

/// Ein Strich (`{ id, tool, color, size, pts, shape?, bbox? }`).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Stroke {
    pub id: String,
    pub tool: Option<Tool>,
    pub color: Option<String>,
    pub size: Option<f64>,
    pub pts: Vec<Point>,
    pub shape: Option<Shape>,
    /// Zwischengespeicherte Grenzen samt Rand (`strokeBounds`); wird mitgespeichert.
    pub bbox: Option<BBox>,
    /// Unbekannte Felder (z. B. `opacity`) und bekannte mit fremdem Typ.
    pub extra: Map<String, Value>,
}

fn points_of(v: Value) -> Result<Vec<Point>, Value> {
    match v {
        Value::Array(a) => Ok(a.iter().filter_map(Point::from_value).collect()),
        other => Err(other),
    }
}

impl Stroke {
    pub fn from_value(v: Value) -> Option<Self> {
        let mut f = Fields::of(v)?;
        Some(Stroke {
            id: f.take("id", id_str).unwrap_or_default(),
            tool: f.take("tool", |v| v.as_str().map(Tool::parse)),
            color: f.take("color", string),
            size: f.take("size", num),
            pts: f.take_owned("pts", points_of).unwrap_or_default(),
            shape: f.take("shape", Shape::from_value),
            bbox: f.take("bbox", BBox::from_value),
            extra: f.0,
        })
    }
}

impl Serialize for Stroke {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut w = ObjWriter::new(s.serialize_map(None)?);
        w.id(&self.id)?;
        w.opt("tool", &self.tool)?;
        w.opt("color", &self.color)?;
        w.opt_num("size", self.size)?;
        w.list("pts", &self.pts, &self.extra)?;
        w.opt("shape", &self.shape)?;
        w.opt("bbox", &self.bbox)?;
        w.finish(&self.extra)
    }
}

/// Ein Bild (`{ id, ref, x, y, w, h, ocr? }`); Altstände tragen statt `ref` die Daten in `src`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Image {
    pub id: String,
    /// Inhalts-Hash in `heftBlobs` ([`blob_id`]).
    pub r#ref: Option<String>,
    /// Alt: Bild als dataURL direkt im Objekt.
    pub src: Option<String>,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub w: Option<f64>,
    pub h: Option<f64>,
    /// Erkannter Scan-Text.
    pub ocr: Option<String>,
    pub extra: Map<String, Value>,
}

impl Image {
    pub fn from_value(v: Value) -> Option<Self> {
        let mut f = Fields::of(v)?;
        Some(Image {
            id: f.take("id", id_str).unwrap_or_default(),
            r#ref: f.take("ref", string),
            src: f.take("src", string),
            x: f.take("x", num),
            y: f.take("y", num),
            w: f.take("w", num),
            h: f.take("h", num),
            ocr: f.take("ocr", string),
            extra: f.0,
        })
    }
}

impl Serialize for Image {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut w = ObjWriter::new(s.serialize_map(None)?);
        w.id(&self.id)?;
        w.opt("ref", &self.r#ref)?;
        w.opt("src", &self.src)?;
        w.opt_num("x", self.x)?;
        w.opt_num("y", self.y)?;
        w.opt_num("w", self.w)?;
        w.opt_num("h", self.h)?;
        w.opt("ocr", &self.ocr)?;
        w.finish(&self.extra)
    }
}

/// Ein Textfeld (`{ id, x, y, w, h?, text, color?, size? }`). `h` ist abgeleitet (Umbruch
/// mit der Geräteschrift) und zählt nicht als Änderung.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct TextBox {
    pub id: String,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub w: Option<f64>,
    pub h: Option<f64>,
    pub text: Option<String>,
    pub color: Option<String>,
    pub size: Option<f64>,
    pub extra: Map<String, Value>,
}

impl TextBox {
    pub fn from_value(v: Value) -> Option<Self> {
        let mut f = Fields::of(v)?;
        Some(TextBox {
            id: f.take("id", id_str).unwrap_or_default(),
            x: f.take("x", num),
            y: f.take("y", num),
            w: f.take("w", num),
            h: f.take("h", num),
            text: f.take("text", string),
            color: f.take("color", string),
            size: f.take("size", num),
            extra: f.0,
        })
    }
}

impl Serialize for TextBox {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut w = ObjWriter::new(s.serialize_map(None)?);
        w.id(&self.id)?;
        w.opt_num("x", self.x)?;
        w.opt_num("y", self.y)?;
        w.opt_num("w", self.w)?;
        w.opt_num("h", self.h)?;
        w.opt("text", &self.text)?;
        w.opt("color", &self.color)?;
        w.opt_num("size", self.size)?;
        w.finish(&self.extra)
    }
}

/// Papiervorlage einer Seite.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum Paper {
    #[default]
    Lined,
    Grid,
    Dots,
    Blank,
    Other(String),
}

impl Paper {
    /// `paper || "lined"`.
    pub fn parse(v: Option<&Value>) -> Self {
        match v.and_then(Value::as_str) {
            None | Some("") | Some("lined") => Paper::Lined,
            Some("grid") => Paper::Grid,
            Some("dots") => Paper::Dots,
            Some("blank") => Paper::Blank,
            Some(other) => Paper::Other(other.to_owned()),
        }
    }
    pub fn as_str(&self) -> &str {
        match self {
            Paper::Lined => "lined",
            Paper::Grid => "grid",
            Paper::Dots => "dots",
            Paper::Blank => "blank",
            Paper::Other(s) => s,
        }
    }
}

impl Serialize for Paper {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(self.as_str())
    }
}

/// Eine Heftseite.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct HeftPage {
    pub id: String,
    pub paper: Paper,
    pub strokes: Vec<Stroke>,
    pub images: Vec<Image>,
    pub texts: Vec<TextBox>,
    /// Handschrift-Erkennung dieser Seite (für die Suche).
    pub ocr_text: String,
    pub extra: Map<String, Value>,
}

fn list_of<T>(read: fn(Value) -> Option<T>) -> impl Fn(Value) -> Result<Vec<T>, Value> {
    move |v| match v {
        Value::Array(a) => Ok(a.into_iter().filter_map(read).collect()),
        other => Err(other),
    }
}

impl HeftPage {
    /// Leere Seite (`emptyHeftPage`).
    pub fn empty(id: impl Into<String>, paper: Paper) -> Self {
        HeftPage { id: id.into(), paper, ..Default::default() }
    }

    /// Liest eine Seite wie der Reducer bei `heftSnap`: fehlende Listen sind leer, Einträge,
    /// die keine Objekte sind, fallen weg. Kein Objekt: leere Seite ohne ID.
    pub fn from_value(v: Value) -> Self {
        let Some(mut f) = Fields::of(v) else { return HeftPage::default() };
        let paper = Paper::parse(f.0.get("paper"));
        if f.0.get("paper").is_some_and(|p| p.as_str().is_some_and(|s| !s.is_empty())) {
            f.0.remove("paper");
        }
        HeftPage {
            id: f.take("id", id_str).unwrap_or_default(),
            paper,
            strokes: f.take_owned("strokes", list_of(Stroke::from_value)).unwrap_or_default(),
            images: f.take_owned("images", list_of(Image::from_value)).unwrap_or_default(),
            texts: f.take_owned("texts", list_of(TextBox::from_value)).unwrap_or_default(),
            ocr_text: f.take("ocrText", string).unwrap_or_default(),
            extra: f.0,
        }
    }

    pub fn stroke(&self, id: &str) -> Option<&Stroke> {
        self.strokes.iter().find(|s| s.id == id)
    }
}

impl Serialize for HeftPage {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut w = ObjWriter::new(s.serialize_map(None)?);
        w.id(&self.id)?;
        w.field("paper", &self.paper)?;
        w.list("strokes", &self.strokes, &self.extra)?;
        w.list("images", &self.images, &self.extra)?;
        w.list("texts", &self.texts, &self.extra)?;
        w.field("ocrText", &self.ocr_text)?;
        w.finish(&self.extra)
    }
}

/// Ein Heft (`{ v: 2, rev, pages }`).
#[derive(Debug, Clone, PartialEq)]
pub struct HeftDoc {
    pub v: f64,
    /// Zähler, den jedes angewandte Heft-Event erhöht.
    pub rev: u64,
    pub pages: Vec<HeftPage>,
    pub extra: Map<String, Value>,
}

impl Default for HeftDoc {
    fn default() -> Self {
        HeftDoc { v: 2.0, rev: 0, pages: Vec::new(), extra: Map::new() }
    }
}

impl HeftDoc {
    /// Liest ein gespeichertes Dokument (Checkpoint, `S.heftDocs`). Kein Objekt: leeres Heft.
    pub fn from_value(v: Value) -> Self {
        let Some(mut f) = Fields::of(v) else { return HeftDoc::default() };
        HeftDoc {
            v: f.take("v", num).unwrap_or(2.0),
            rev: f.take("rev", |v| v.as_f64().filter(|r| *r >= 0.0).map(|r| r as u64)).unwrap_or(0),
            pages: f.take_owned("pages", list_of(|v| Some(HeftPage::from_value(v)))).unwrap_or_default(),
            extra: f.0,
        }
    }

    pub fn page(&self, id: &str) -> Option<&HeftPage> {
        self.pages.iter().find(|p| p.id == id)
    }
    pub fn page_mut(&mut self, id: &str) -> Option<&mut HeftPage> {
        self.pages.iter_mut().find(|p| p.id == id)
    }

    /// Durchsuchbarer Text des ganzen Hefts: die `ocrText` aller Seiten, mit `\n` verbunden
    /// (`heftMeta.ocrText` im Reducer).
    pub fn ocr_text(&self) -> String {
        let parts: Vec<&str> = self.pages.iter().map(|p| p.ocr_text.as_str()).filter(|t| !t.is_empty()).collect();
        parts.join("\n")
    }

    /// Grobe Größe in Byte für Anzeigen (`heftBytes`). `blob_len` liefert die Länge eines
    /// referenzierten Bildes (0, wenn unbekannt).
    pub fn byte_estimate(&self, blob_len: impl Fn(&str) -> usize) -> usize {
        let mut n = 0;
        for pg in &self.pages {
            n += pg.strokes.iter().map(|s| 40 + s.pts.len() * 14).sum::<usize>();
            for im in &pg.images {
                n += 60
                    + match (im.r#ref.as_deref().filter(|r| !r.is_empty()), &im.src) {
                        (Some(r), _) => blob_len(r),
                        (None, Some(src)) => js_len(src),
                        _ => 0,
                    };
            }
            n += pg.texts.iter().map(|t| 60 + t.text.as_deref().map_or(0, js_len)).sum::<usize>();
        }
        n
    }

    /// Altbestand (Blob je Heft, `{ pages }`, oder lose Striche aus dem alten localStorage-Ink)
    /// in ein v2-Dokument überführen (`normalizeDoc`): fehlende IDs bekommen `new_id()`,
    /// Bilder mit eingebetteter dataURL werden zu Referenzen. Liefert zusätzlich die Bilddaten,
    /// die als `heftBlob` (Hash → dataURL) geschrieben werden müssen. Ohne Seiten: `None`.
    pub fn normalize_legacy(v: &Value, new_id: &mut dyn FnMut() -> String) -> Option<(HeftDoc, Vec<(String, String)>)> {
        let mut blobs = Vec::new();
        let with_id = |o: &Value, new_id: &mut dyn FnMut() -> String| -> Value {
            let mut o = match o {
                Value::Object(m) => m.clone(),
                _ => Map::new(),
            };
            if !o.get("id").is_some_and(truthy) {
                o.insert("id".into(), Value::String(new_id()));
            }
            Value::Object(o)
        };
        let list = |pg: &Value, key: &str| pg.get(key).and_then(Value::as_array).cloned().unwrap_or_default();
        let mut pages = Vec::new();
        for pg in v.get("pages").and_then(Value::as_array).into_iter().flatten() {
            let id = pg.get("id").filter(|v| truthy(v)).and_then(id_str).unwrap_or_else(&mut *new_id);
            let mut page = HeftPage::empty(id, Paper::parse(pg.get("paper")));
            page.strokes = list(pg, "strokes").iter().filter_map(|s| Stroke::from_value(with_id(s, new_id))).collect();
            for im in list(pg, "images") {
                let Some(mut im) = Image::from_value(with_id(&im, new_id)) else { continue };
                if im.r#ref.as_deref().is_none_or(str::is_empty)
                    && let Some(src) = im.src.take_if(|s| !s.is_empty())
                {
                    let hash = blob_id(&src);
                    blobs.push((hash.clone(), src));
                    im.r#ref = Some(hash);
                }
                page.images.push(im);
            }
            page.texts = list(pg, "texts").iter().filter_map(|t| TextBox::from_value(with_id(t, new_id))).collect();
            page.ocr_text = non_empty_str(pg.get("ocrText"));
            pages.push(page);
        }
        if pages.is_empty() {
            return None;
        }
        Some((HeftDoc { pages, ..Default::default() }, blobs))
    }

    /// Lose Striche des alten localStorage-Inks (`{ strokes }`) als Heft mit einer Seite.
    pub fn from_legacy_ink(v: &Value, new_id: &mut dyn FnMut() -> String) -> Option<(HeftDoc, Vec<(String, String)>)> {
        let strokes = v.get("strokes").and_then(Value::as_array).filter(|a| !a.is_empty())?;
        let doc = serde_json::json!({ "pages": [{ "paper": "lined", "strokes": strokes }] });
        Self::normalize_legacy(&doc, new_id)
    }
}

fn non_empty_str(v: Option<&Value>) -> String {
    v.and_then(Value::as_str).unwrap_or_default().to_owned()
}

/// JS-Wahrheitswert eines JSON-Werts.
pub(crate) fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

impl Serialize for HeftDoc {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut w = ObjWriter::new(s.serialize_map(None)?);
        w.field("v", &JsNum(self.v))?;
        w.field("rev", &self.rev)?;
        w.list("pages", &self.pages, &self.extra)?;
        w.finish(&self.extra)
    }
}

macro_rules! deserialize_via_value {
    ($($t:ty => $read:expr),* $(,)?) => {$(
        impl<'de> Deserialize<'de> for $t {
            fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
                let v = Value::deserialize(d)?;
                let read: fn(Value) -> Option<$t> = $read;
                read(v).ok_or_else(|| serde::de::Error::custom(concat!(stringify!($t), ": kein Objekt")))
            }
        }
    )*};
}

deserialize_via_value! {
    Image => Image::from_value,
    TextBox => TextBox::from_value,
}

// ---- Schnelles Einlesen ohne Zwischenwert ----------------------------------------------------
// Ein Heft mit Tausenden Strichen besteht fast nur aus Punkten. Über `Value` kostete jeder Punkt
// eine Liste und je Zahl einen Wert. Hier werden Dokument, Seiten und Striche direkt gelesen; die
// Punkte und Strich-Listen typisiert, alle übrigen Felder weiter als `Value` – mit genau denselben
// Regeln wie `from_value` (Test `typisiert_wie_from_value`).

/// Eine Zahl im Punkt; alles andere (auch `null`) wird `NaN`, wie `as_f64().unwrap_or(NaN)`.
struct Coord(f64);

impl<'de> Deserialize<'de> for Coord {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Coord;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("Koordinate")
            }
            fn visit_f64<E>(self, v: f64) -> Result<Coord, E> {
                Ok(Coord(v))
            }
            fn visit_i64<E>(self, v: i64) -> Result<Coord, E> {
                Ok(Coord(v as f64))
            }
            fn visit_u64<E>(self, v: u64) -> Result<Coord, E> {
                Ok(Coord(v as f64))
            }
            fn visit_bool<E>(self, _: bool) -> Result<Coord, E> {
                Ok(Coord(f64::NAN))
            }
            fn visit_str<E>(self, _: &str) -> Result<Coord, E> {
                Ok(Coord(f64::NAN))
            }
            fn visit_unit<E>(self) -> Result<Coord, E> {
                Ok(Coord(f64::NAN))
            }
            fn visit_none<E>(self) -> Result<Coord, E> {
                Ok(Coord(f64::NAN))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut a: A) -> Result<Coord, A::Error> {
                while a.next_element::<IgnoredAny>()?.is_some() {}
                Ok(Coord(f64::NAN))
            }
            fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<Coord, A::Error> {
                while a.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
                Ok(Coord(f64::NAN))
            }
        }
        d.deserialize_any(V)
    }
}

/// Ein Element der Punktliste: Liste → Punkt, sonst übersprungen (`filter_map(Point::from_value)`).
struct MaybePoint(Option<Point>);

impl<'de> Deserialize<'de> for MaybePoint {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = MaybePoint;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("Punkt")
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut a: A) -> Result<MaybePoint, A::Error> {
                let mut at = [None; 4];
                let mut i = 0;
                while let Some(Coord(c)) = a.next_element::<Coord>()? {
                    if i < 4 {
                        at[i] = Some(c);
                    }
                    i += 1;
                }
                Ok(MaybePoint(Some(Point {
                    x: at[0].unwrap_or(f64::NAN),
                    y: at[1].unwrap_or(f64::NAN),
                    p: at[2],
                    t: at[3],
                })))
            }
            fn visit_f64<E>(self, _: f64) -> Result<MaybePoint, E> {
                Ok(MaybePoint(None))
            }
            fn visit_i64<E>(self, _: i64) -> Result<MaybePoint, E> {
                Ok(MaybePoint(None))
            }
            fn visit_u64<E>(self, _: u64) -> Result<MaybePoint, E> {
                Ok(MaybePoint(None))
            }
            fn visit_bool<E>(self, _: bool) -> Result<MaybePoint, E> {
                Ok(MaybePoint(None))
            }
            fn visit_str<E>(self, _: &str) -> Result<MaybePoint, E> {
                Ok(MaybePoint(None))
            }
            fn visit_unit<E>(self) -> Result<MaybePoint, E> {
                Ok(MaybePoint(None))
            }
            fn visit_none<E>(self) -> Result<MaybePoint, E> {
                Ok(MaybePoint(None))
            }
            fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<MaybePoint, A::Error> {
                while a.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
                Ok(MaybePoint(None))
            }
        }
        d.deserialize_any(V)
    }
}

/// Eine Liste typisierter Einträge – oder, wenn es keine Liste ist, der Wert selbst (bleibt dann
/// wie bei `take_owned` als Fremdfeld erhalten).
enum ListOr<T> {
    List(Vec<T>),
    Other(Value),
}

/// Liest Listenelemente `E`; `keep` entscheidet, was davon übernommen wird.
struct ListVisitor<E, T>(fn(E) -> Option<T>);

impl<'de, E: Deserialize<'de>, T> Visitor<'de> for ListVisitor<E, T> {
    type Value = ListOr<T>;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("Liste")
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut a: A) -> Result<ListOr<T>, A::Error> {
        let mut out = Vec::with_capacity(a.size_hint().unwrap_or(0));
        while let Some(e) = a.next_element::<E>()? {
            if let Some(t) = (self.0)(e) {
                out.push(t);
            }
        }
        Ok(ListOr::List(out))
    }
    fn visit_map<A: MapAccess<'de>>(self, a: A) -> Result<ListOr<T>, A::Error> {
        Ok(ListOr::Other(Value::deserialize(MapAccessDeserializer::new(a))?))
    }
    fn visit_f64<Er>(self, v: f64) -> Result<ListOr<T>, Er> {
        Ok(ListOr::Other(Value::from(v)))
    }
    fn visit_i64<Er>(self, v: i64) -> Result<ListOr<T>, Er> {
        Ok(ListOr::Other(Value::from(v)))
    }
    fn visit_u64<Er>(self, v: u64) -> Result<ListOr<T>, Er> {
        Ok(ListOr::Other(Value::from(v)))
    }
    fn visit_bool<Er>(self, v: bool) -> Result<ListOr<T>, Er> {
        Ok(ListOr::Other(Value::Bool(v)))
    }
    fn visit_str<Er>(self, v: &str) -> Result<ListOr<T>, Er> {
        Ok(ListOr::Other(Value::from(v)))
    }
    fn visit_string<Er>(self, v: String) -> Result<ListOr<T>, Er> {
        Ok(ListOr::Other(Value::String(v)))
    }
    fn visit_unit<Er>(self) -> Result<ListOr<T>, Er> {
        Ok(ListOr::Other(Value::Null))
    }
    fn visit_none<Er>(self) -> Result<ListOr<T>, Er> {
        Ok(ListOr::Other(Value::Null))
    }
}

/// `next_value` einer Liste mit Elementtyp `E`.
struct ListSeed<E, T>(fn(E) -> Option<T>);

impl<'de, E: Deserialize<'de>, T> serde::de::DeserializeSeed<'de> for ListSeed<E, T> {
    type Value = ListOr<T>;
    fn deserialize<D: Deserializer<'de>>(self, d: D) -> Result<ListOr<T>, D::Error> {
        d.deserialize_any(ListVisitor(self.0))
    }
}

/// Ein Objekt oder etwas anderes (dann als `Value`, um es wie `from_value` zu behandeln).
enum ObjOr<T> {
    Obj(T),
    Other(Value),
}

macro_rules! other_kinds {
    ($t:ty) => {
        fn visit_seq<A: SeqAccess<'de>>(self, a: A) -> Result<ObjOr<$t>, A::Error> {
            Ok(ObjOr::Other(Value::deserialize(SeqAccessDeserializer::new(a))?))
        }
        fn visit_f64<E>(self, v: f64) -> Result<ObjOr<$t>, E> {
            Ok(ObjOr::Other(Value::from(v)))
        }
        fn visit_i64<E>(self, v: i64) -> Result<ObjOr<$t>, E> {
            Ok(ObjOr::Other(Value::from(v)))
        }
        fn visit_u64<E>(self, v: u64) -> Result<ObjOr<$t>, E> {
            Ok(ObjOr::Other(Value::from(v)))
        }
        fn visit_bool<E>(self, v: bool) -> Result<ObjOr<$t>, E> {
            Ok(ObjOr::Other(Value::Bool(v)))
        }
        fn visit_str<E>(self, v: &str) -> Result<ObjOr<$t>, E> {
            Ok(ObjOr::Other(Value::from(v)))
        }
        fn visit_string<E>(self, v: String) -> Result<ObjOr<$t>, E> {
            Ok(ObjOr::Other(Value::String(v)))
        }
        fn visit_unit<E>(self) -> Result<ObjOr<$t>, E> {
            Ok(ObjOr::Other(Value::Null))
        }
        fn visit_none<E>(self) -> Result<ObjOr<$t>, E> {
            Ok(ObjOr::Other(Value::Null))
        }
    };
}

/// Übrige Felder eines Objekts und sein typisiert gelesenes Listenfeld (falls es eine Liste war).
type WithList<T> = (Map<String, Value>, Option<Vec<T>>);

/// Liest ein Objekt Feld für Feld; das Listenfeld `list` typisiert über `seed`, alle anderen als
/// `Value`. Ist das Listenfeld keine Liste, bleibt es als gewöhnliches Feld im Objekt.
fn read_with_list<'de, A, E, T>(mut a: A, list: &str, keep: fn(E) -> Option<T>) -> Result<WithList<T>, A::Error>
where
    A: MapAccess<'de>,
    E: Deserialize<'de>,
{
    let mut m = Map::new();
    let mut items = None;
    while let Some(k) = a.next_key::<String>()? {
        if k == list {
            match a.next_value_seed(ListSeed::<E, T>(keep))? {
                // Platzhalter an derselben Stelle: `from_value` entfernt ihn wie die echte Liste, die
                // übrigen Felder landen dadurch in derselben Reihenfolge.
                ListOr::List(l) => {
                    items = Some(l);
                    m.insert(k, Value::Array(Vec::new()));
                }
                ListOr::Other(v) => {
                    m.insert(k, v);
                }
            }
        } else {
            let v: Value = a.next_value()?;
            m.insert(k, v);
        }
    }
    Ok((m, items))
}

impl<'de> Deserialize<'de> for ObjOr<Stroke> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = ObjOr<Stroke>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("Strich")
            }
            fn visit_map<A: MapAccess<'de>>(self, a: A) -> Result<ObjOr<Stroke>, A::Error> {
                let (m, pts) = read_with_list::<A, MaybePoint, Point>(a, "pts", |p| p.0)?;
                let mut s = Stroke::from_value(Value::Object(m)).unwrap_or_default();
                if let Some(pts) = pts {
                    s.pts = pts;
                }
                Ok(ObjOr::Obj(s))
            }
            other_kinds!(Stroke);
        }
        d.deserialize_any(V)
    }
}

impl<'de> Deserialize<'de> for ObjOr<HeftPage> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = ObjOr<HeftPage>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("Heftseite")
            }
            fn visit_map<A: MapAccess<'de>>(self, a: A) -> Result<ObjOr<HeftPage>, A::Error> {
                let (m, strokes) = read_with_list::<A, ObjOr<Stroke>, Stroke>(a, "strokes", |s| match s {
                    ObjOr::Obj(s) => Some(s),
                    ObjOr::Other(_) => None,
                })?;
                let mut p = HeftPage::from_value(Value::Object(m));
                if let Some(strokes) = strokes {
                    p.strokes = strokes;
                }
                Ok(ObjOr::Obj(p))
            }
            other_kinds!(HeftPage);
        }
        d.deserialize_any(V)
    }
}

impl<'de> Deserialize<'de> for ObjOr<HeftDoc> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = ObjOr<HeftDoc>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("Heft")
            }
            fn visit_map<A: MapAccess<'de>>(self, a: A) -> Result<ObjOr<HeftDoc>, A::Error> {
                let (m, pages) = read_with_list::<A, ObjOr<HeftPage>, HeftPage>(a, "pages", |p| {
                    Some(match p {
                        ObjOr::Obj(p) => p,
                        ObjOr::Other(v) => HeftPage::from_value(v),
                    })
                })?;
                let mut doc = HeftDoc::from_value(Value::Object(m));
                if let Some(pages) = pages {
                    doc.pages = pages;
                }
                Ok(ObjOr::Obj(doc))
            }
            other_kinds!(HeftDoc);
        }
        d.deserialize_any(V)
    }
}

impl<'de> Deserialize<'de> for Stroke {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        match ObjOr::<Stroke>::deserialize(d)? {
            ObjOr::Obj(s) => Ok(s),
            ObjOr::Other(_) => Err(serde::de::Error::custom("Stroke: kein Objekt")),
        }
    }
}

impl<'de> Deserialize<'de> for HeftPage {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(match ObjOr::<HeftPage>::deserialize(d)? {
            ObjOr::Obj(p) => p,
            ObjOr::Other(v) => HeftPage::from_value(v),
        })
    }
}

impl<'de> Deserialize<'de> for HeftDoc {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(match ObjOr::<HeftDoc>::deserialize(d)? {
            ObjOr::Obj(doc) => doc,
            ObjOr::Other(v) => HeftDoc::from_value(v),
        })
    }
}

/// Durchsuchbarer Seitentext (`composePageText`): erst die Handschrift-Erkennung, danach
/// der Text aller Scan-Bilder in Reihenfolge, mit Zeilenumbruch verbunden.
pub fn compose_page_text(stroke_text: &str, page: &HeftPage) -> String {
    let mut parts = vec![js_trim(stroke_text)];
    parts.extend(page.images.iter().filter_map(|im| im.ocr.as_deref()).filter(|o| !o.is_empty()).map(js_trim));
    let parts: Vec<&str> = parts.into_iter().filter(|p| !p.is_empty()).collect();
    js_trim(&parts.join("\n")).to_owned()
}

/// Inhalts-ID eines Bildes (`blobId`, FNV-1a und djb2 über die UTF-16-Einheiten).
/// Teil des gespeicherten Formats: darf sich nie ändern.
pub fn blob_id(data: &str) -> String {
    let (mut fnv, mut djb) = (0x811c_9dc5u32, 5381u32);
    let mut len = 0u64;
    for code in data.encode_utf16() {
        fnv = (fnv ^ code as u32).wrapping_mul(0x0100_0193);
        djb = djb.wrapping_mul(33) ^ code as u32;
        len += 1;
    }
    format!("b{}-{}{}", radix36(len), radix36(fnv as u64), radix36(djb as u64))
}
