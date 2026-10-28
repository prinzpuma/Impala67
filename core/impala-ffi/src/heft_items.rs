//! Hefte bearbeiten: Striche, Formen, Bilder, Textfelder und Seiten. Jede Methode schreibt EIN
//! `heftOps`-Event (eine Geste = ein Event) und liefert ein [`HeftEdit`] mit den neuen IDs und
//! der Umkehr, die die App auf ihren Undo-Stapel legt (siehe `heft_undo.rs`).
//!
//! Bilder sind keine `ImpalaCore::file`-Blobs: Die PWA legt den Inhalt als dataURL in einem
//! `heftBlob`-Event ab (`{ hash, data }`, `hash = blob_id(dataURL)`); das Bild-Element trägt nur
//! den Hash als `ref`. Hier genauso, damit beide Seiten dieselben Hefte sehen.

use std::collections::HashSet;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use impala_heft::lasso::duplicate_strokes;
use impala_heft::{
    BBox, HeftOp, Image, Item, ItemKind, Point, Shape, Stroke, TextBox, Tool, blob_id, fit_stroke_shape, lasso_bounds,
    select_strokes_by_lasso,
};
use serde_json::{Value, json};

use crate::heft::{HeftImage, HeftPageData, HeftShape, HeftStroke, HeftText, image_data, page_data, parse_paper};
use crate::heft_undo::inverse;
use crate::{CoreError, ImpalaCore, Inner, invalid};

/// Eine einzelne Änderung an einem Heft. Mehrere davon gehen als ein Event hinein
/// ([`ImpalaCore::heft_apply`]). `page` ist immer die Heftseite, nicht das Heft.
///
/// `Set*` ersetzt die bekannten Felder des Elements durch die des Datensatzes; unbekannte Felder
/// (z. B. `opacity` eines Strichs) bleiben erhalten.
#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum HeftChange {
    AddStroke {
        page: String,
        stroke: HeftStroke,
    },
    SetStroke {
        page: String,
        stroke: HeftStroke,
    },
    RemoveStrokes {
        page: String,
        ids: Vec<String>,
    },
    AddImage {
        page: String,
        image: HeftImage,
    },
    SetImage {
        page: String,
        image: HeftImage,
    },
    RemoveImages {
        page: String,
        ids: Vec<String>,
    },
    AddText {
        page: String,
        text: HeftText,
    },
    SetText {
        page: String,
        text: HeftText,
    },
    RemoveTexts {
        page: String,
        ids: Vec<String>,
    },
    /// Neue Seite `page` an Position `at` (`None`: hinten).
    AddPage {
        at: Option<u32>,
        page: String,
        paper: Option<String>,
    },
    RemovePage {
        page: String,
    },
    /// Neue Reihenfolge aller Seiten-IDs.
    SetPageOrder {
        order: Vec<String>,
    },
    /// `lined`, `grid`, `dots` oder `blank`.
    SetPaper {
        page: String,
        paper: String,
    },
    /// Erkannter Handschrift-Text der Seite (die Erkennung selbst macht die Plattform).
    SetPageText {
        page: String,
        text: String,
    },
}

/// Ergebnis einer Änderung.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct HeftEdit {
    /// IDs der neu angelegten Elemente bzw. Seiten (in Eingabereihenfolge).
    pub ids: Vec<String>,
    /// Umkehr als JSON-Operationen für [`ImpalaCore::heft_apply_ops`]; `[]`, wenn nichts zu tun war.
    /// Deren Ergebnis ist wiederum die Umkehr (Wiederholen).
    pub undo: String,
}

/// Rechteck in Seitenkoordinaten.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct HeftRect {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

impl From<BBox> for HeftRect {
    fn from(b: BBox) -> Self {
        HeftRect { min_x: b.min_x, min_y: b.min_y, max_x: b.max_x, max_y: b.max_y }
    }
}

/// Bilddaten eines Heft-Bilds.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct HeftImageData {
    pub bytes: Vec<u8>,
    pub mime: String,
}

fn finite(values: &[f64], what: &str) -> Result<(), CoreError> {
    if values.iter().all(|v| v.is_finite()) { Ok(()) } else { Err(invalid(format!("{what}: keine endliche Zahl"))) }
}

/// Anfangs- und Endpunkt einer Form (die PWA speichert diese beiden als `pts` des Strichs).
fn shape_ends(shape: &Shape) -> [[f64; 2]; 2] {
    let corners = shape.corner_points();
    if let (Some(a), Some(b)) = (corners.first(), corners.last()) {
        return [*a, *b];
    }
    match *shape {
        Shape::Ellipse { cx, cy, rx, ry } => [[cx - rx, cy - ry], [cx + rx, cy + ry]],
        Shape::Circle { cx, cy, r } => [[cx - r, cy - r], [cx + r, cy + r]],
        _ => [[0.0; 2]; 2],
    }
}

/// Strich aus dem Datensatz der Plattform; `existing` liefert die unbekannten Felder (`Set`).
pub(crate) fn build_stroke(existing: Option<&Stroke>, s: &HeftStroke) -> Result<Stroke, CoreError> {
    if s.id.is_empty() {
        return Err(invalid("Strich ohne ID"));
    }
    if !s.points.len().is_multiple_of(3) || s.points.iter().any(|v| !v.is_finite()) {
        return Err(invalid("Punkte als [x, y, druck, …]"));
    }
    let mut stroke = existing.cloned().unwrap_or_default();
    stroke.id.clone_from(&s.id);
    stroke.color = Some(s.color.clone());
    stroke.size = Some(if s.size.is_finite() && s.size > 0.0 { s.size } else { 3.0 });
    let pts: Vec<Point> = s
        .points
        .as_chunks::<3>()
        .0
        .iter()
        .map(|&[x, y, p]| Point::new(f64::from(x), f64::from(y), f64::from(p)))
        .collect();
    match &s.shape {
        Some(shape) => {
            let shape = shape.to_core();
            let ends = shape_ends(&shape);
            finite(&ends.concat(), "Form")?;
            stroke.pts = match (pts.first(), pts.last()) {
                (Some(a), Some(b)) if pts.len() >= 2 => vec![*a, *b],
                _ => ends.iter().map(|[x, y]| Point::new(*x, *y, 1.0)).collect(),
            };
            stroke.shape = Some(shape);
            stroke.tool = Some(Tool::Shape);
        }
        // Eine Form, die diese Version nicht kennt, bleibt unangetastet (Farbe/Dicke ändern sich trotzdem).
        None if matches!(stroke.shape, Some(Shape::Other(_))) => {}
        None => {
            if pts.is_empty() {
                return Err(invalid("Strich ohne Punkte"));
            }
            if s.tool == "shape" {
                return Err(invalid("Werkzeug shape braucht eine Form"));
            }
            stroke.pts = pts;
            stroke.shape = None;
            stroke.tool = Some(Tool::parse(&s.tool));
        }
    }
    stroke.bbox = None;
    stroke.refresh_bounds();
    Ok(stroke)
}

fn build_image(existing: Option<&Image>, im: &HeftImage) -> Result<Image, CoreError> {
    if im.id.is_empty() {
        return Err(invalid("Bild ohne ID"));
    }
    finite(&[im.x, im.y, im.w, im.h], "Bildrahmen")?;
    let mut image = existing.cloned().unwrap_or_default();
    image.id.clone_from(&im.id);
    if let Some(blob) = im.blob_id.as_ref().filter(|b| !b.is_empty()) {
        image.r#ref = Some(blob.clone());
        image.src = None;
    }
    if image.r#ref.as_deref().is_none_or(str::is_empty) && image.src.is_none() {
        return Err(invalid("Bild ohne Bilddaten"));
    }
    (image.x, image.y, image.w, image.h) = (Some(im.x), Some(im.y), Some(im.w), Some(im.h));
    image.ocr.clone_from(&im.ocr);
    Ok(image)
}

fn build_text(existing: Option<&TextBox>, t: &HeftText) -> Result<TextBox, CoreError> {
    if t.id.is_empty() {
        return Err(invalid("Textfeld ohne ID"));
    }
    finite(&[t.x, t.y], "Textposition")?;
    let mut text = existing.cloned().unwrap_or_default();
    text.id.clone_from(&t.id);
    (text.x, text.y, text.w, text.h) = (Some(t.x), Some(t.y), t.w, t.h);
    text.text = Some(t.text.clone());
    text.color.clone_from(&t.color);
    text.size = t.size;
    Ok(text)
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn remove_op(page: String, kind: ItemKind, ids: Vec<String>) -> Option<HeftOp> {
    (!ids.is_empty()).then_some(HeftOp::Remove { page, kind, ids })
}

/// dataURL → (MIME, Bytes). Nur Base64 und Prozent-Kodierung, wie `readAsDataURL` sie schreibt.
fn split_data_url(url: &str) -> Option<(String, Vec<u8>)> {
    let (head, body) = url.strip_prefix("data:")?.split_once(',')?;
    let mut parts = head.split(';');
    let mime = parts.next().filter(|m| !m.is_empty()).unwrap_or("application/octet-stream").to_owned();
    let bytes = if parts.any(|p| p.eq_ignore_ascii_case("base64")) {
        STANDARD.decode(body.trim()).ok()?
    } else {
        let raw = body.as_bytes();
        let mut out = Vec::with_capacity(raw.len());
        let mut i = 0;
        while i < raw.len() {
            let hex = |b: u8| (b as char).to_digit(16);
            match (raw[i], raw.get(i + 1).and_then(|b| hex(*b)), raw.get(i + 2).and_then(|b| hex(*b))) {
                (b'%', Some(h), Some(l)) => {
                    out.push((h * 16 + l) as u8);
                    i += 3;
                }
                (b, ..) => {
                    out.push(b);
                    i += 1;
                }
            }
        }
        out
    };
    Some((mime, bytes))
}

impl Inner {
    fn change_op(&self, page_id: &str, change: HeftChange) -> Result<Option<HeftOp>, CoreError> {
        let item = |page: String, item: Item| Some(HeftOp::Add { page, item });
        Ok(match change {
            HeftChange::AddStroke { page, stroke } => {
                self.heft_page(page_id, &page)?;
                item(page, Item::Stroke(build_stroke(None, &stroke)?))
            }
            HeftChange::SetStroke { page, stroke } => {
                let old = self.heft_page(page_id, &page)?.stroke(&stroke.id);
                let new = build_stroke(old, &stroke)?;
                Some(HeftOp::Set { page, item: Item::Stroke(new) })
            }
            HeftChange::RemoveStrokes { page, ids } => {
                self.heft_page(page_id, &page)?;
                remove_op(page, ItemKind::Stroke, ids)
            }
            HeftChange::AddImage { page, image } => {
                self.heft_page(page_id, &page)?;
                item(page, Item::Image(build_image(None, &image)?))
            }
            HeftChange::SetImage { page, image } => {
                let old = self.heft_page(page_id, &page)?.images.iter().find(|i| i.id == image.id);
                let new = build_image(old, &image)?;
                Some(HeftOp::Set { page, item: Item::Image(new) })
            }
            HeftChange::RemoveImages { page, ids } => {
                self.heft_page(page_id, &page)?;
                remove_op(page, ItemKind::Image, ids)
            }
            HeftChange::AddText { page, text } => {
                self.heft_page(page_id, &page)?;
                item(page, Item::Text(build_text(None, &text)?))
            }
            HeftChange::SetText { page, text } => {
                let old = self.heft_page(page_id, &page)?.texts.iter().find(|t| t.id == text.id);
                let new = build_text(old, &text)?;
                Some(HeftOp::Set { page, item: Item::Text(new) })
            }
            HeftChange::RemoveTexts { page, ids } => {
                self.heft_page(page_id, &page)?;
                remove_op(page, ItemKind::Text, ids)
            }
            HeftChange::AddPage { at, page, paper } => {
                if page.is_empty() {
                    return Err(invalid("Seite ohne ID"));
                }
                let paper = Some(parse_paper(paper.as_deref().unwrap_or("lined"))?);
                Some(HeftOp::PageAdd { at: at.map(f64::from), page, paper })
            }
            HeftChange::RemovePage { page } => {
                let doc = self.heft(page_id)?;
                self.heft_page(page_id, &page)?;
                if !impala_heft::pages::can_delete_pages(doc.pages.len(), 1) {
                    return Err(invalid("Die letzte Seite eines Hefts lässt sich nicht löschen"));
                }
                Some(HeftOp::PageRemove { page })
            }
            HeftChange::SetPageOrder { order } => {
                let doc = self.heft(page_id)?;
                let known: HashSet<&str> = doc.pages.iter().map(|p| p.id.as_str()).collect();
                let given: HashSet<&str> = order.iter().map(String::as_str).collect();
                if known != given || order.len() != known.len() {
                    return Err(invalid("Die Reihenfolge muss genau die Seiten des Hefts enthalten"));
                }
                Some(HeftOp::PageOrder { order })
            }
            HeftChange::SetPaper { page, paper } => {
                self.heft_page(page_id, &page)?;
                Some(HeftOp::PagePaper { page, paper: parse_paper(&paper)? })
            }
            HeftChange::SetPageText { page, text } => {
                self.heft_page(page_id, &page)?;
                Some(HeftOp::Ocr { page, text })
            }
        })
    }

    fn change_ops(&self, page_id: &str, changes: Vec<HeftChange>) -> Result<Vec<HeftOp>, CoreError> {
        let mut ops = Vec::with_capacity(changes.len());
        for change in changes {
            ops.extend(self.change_op(page_id, change)?);
        }
        Ok(ops)
    }

    /// Ein Event schreiben und die Umkehr dazu berechnen (vor dem Schreiben, aus dem alten Stand).
    pub(crate) fn heft_edit(
        &mut self,
        page_id: &str,
        ops: Vec<HeftOp>,
        ids: Vec<String>,
    ) -> Result<HeftEdit, CoreError> {
        let doc = self.heft(page_id)?;
        if ops.is_empty() {
            return Ok(HeftEdit { ids, undo: "[]".into() });
        }
        let undo = serde_json::to_string(&inverse(doc, &ops)).map_err(|e| invalid(e.to_string()))?;
        self.heft_ops(page_id, ops)?;
        Ok(HeftEdit { ids, undo })
    }

    /// `Set` für die gewählten Striche, Rest der Seite unberührt.
    fn stroke_edit(
        &mut self,
        page_id: &str,
        heft_page_id: &str,
        ids: &[String],
        change: impl Fn(&mut Stroke),
    ) -> Result<HeftEdit, CoreError> {
        let want: HashSet<&str> = ids.iter().map(String::as_str).collect();
        let ops = self
            .heft_page(page_id, heft_page_id)?
            .strokes
            .iter()
            .filter(|s| want.contains(s.id.as_str()))
            .map(|s| {
                let mut copy = s.clone();
                change(&mut copy);
                HeftOp::Set { page: heft_page_id.to_owned(), item: Item::Stroke(copy) }
            })
            .collect();
        self.heft_edit(page_id, ops, Vec::new())
    }

    fn added_ids(changes: &[HeftChange]) -> Vec<String> {
        changes
            .iter()
            .filter_map(|c| match c {
                HeftChange::AddStroke { stroke, .. } => Some(stroke.id.clone()),
                HeftChange::AddImage { image, .. } => Some(image.id.clone()),
                HeftChange::AddText { text, .. } => Some(text.id.clone()),
                HeftChange::AddPage { page, .. } => Some(page.clone()),
                _ => None,
            })
            .collect()
    }
}

/// Erkennt in gehaltenen Stiftpunkten (`[x, y, druck, …]`) eine Form (Linie, Rechteck, Dreieck,
/// Pfeil, Ellipse). `None`: zu kurz oder keine Form. Ändert nichts; zum Speichern
/// `HeftChange::AddStroke` mit der Form oder [`ImpalaCore::heft_add_shape`].
#[uniffi::export]
pub fn heft_fit_shape(points: Vec<f32>) -> Option<HeftShape> {
    if !points.len().is_multiple_of(3) {
        return None;
    }
    let pts: Vec<Point> = points
        .as_chunks::<3>()
        .0
        .iter()
        .map(|&[x, y, p]| Point::new(f64::from(x), f64::from(y), f64::from(p)))
        .collect();
    fit_stroke_shape(&pts).as_ref().and_then(HeftShape::from_core)
}

/// Umriss einer Form als `[x, y, …]` zum Zeichnen der Vorschau.
#[uniffi::export]
pub fn heft_shape_outline(shape: HeftShape) -> Vec<f32> {
    impala_heft::geometry::shape_outline(&shape.to_core())
        .unwrap_or_default()
        .iter()
        .flat_map(|[x, y]| [*x as f32, *y as f32])
        .collect()
}

/// Neue ID für Striche, Bilder, Textfelder und Seiten (vorab, damit die App ihre Umkehr kennt).
#[uniffi::export]
pub fn heft_new_id() -> String {
    new_id()
}

#[uniffi::export]
impl ImpalaCore {
    /// Mehrere Änderungen als EIN Event (eine Geste). Liefert neue IDs und die Umkehr.
    pub fn heft_apply(&self, page_id: String, changes: Vec<HeftChange>) -> Result<HeftEdit, CoreError> {
        let mut inner = self.lock();
        let ids = Inner::added_ids(&changes);
        let ops = inner.change_ops(&page_id, changes)?;
        inner.heft_edit(&page_id, ops, ids)
    }

    /// Operationen im Wire-Format (`HeftEdit::undo`) anwenden: Rückgängig bzw. Wiederholen.
    /// Das Ergebnis enthält wieder die Umkehr.
    pub fn heft_apply_ops(&self, page_id: String, ops_json: String) -> Result<HeftEdit, CoreError> {
        let value: Value = serde_json::from_str(&ops_json).map_err(|e| invalid(format!("Operationen: {e}")))?;
        let ops = impala_heft::parse_ops(value);
        if ops.iter().any(|op| matches!(op, HeftOp::Other(_))) {
            return Err(invalid("Unbekannte Heft-Operation"));
        }
        self.lock().heft_edit(&page_id, ops, Vec::new())
    }

    /// Arbeitskopie einer Seite mit noch nicht gespeicherten Änderungen (Gestenvorschau; schreibt nichts).
    pub fn heft_preview(
        &self,
        page_id: String,
        heft_page_id: String,
        changes: Vec<HeftChange>,
    ) -> Result<HeftPageData, CoreError> {
        let inner = self.lock();
        let ops = inner.change_ops(&page_id, changes)?;
        let ops = serde_json::to_value(&ops).map_err(|e| invalid(e.to_string()))?;
        let doc = inner.model.heft_preview(&page_id, ops).ok_or_else(|| invalid(format!("Kein Heft {page_id}")))?;
        let page = doc.page(&heft_page_id).ok_or_else(|| invalid(format!("Keine Heftseite {heft_page_id}")))?;
        Ok(page_data(page))
    }

    // ---------- Striche und Formen ----------

    /// Striche ersetzen (`s=`), z. B. nach Umfärben oder Verschieben in der App.
    pub fn heft_set_strokes(
        &self,
        page_id: String,
        heft_page_id: String,
        strokes: Vec<HeftStroke>,
    ) -> Result<HeftEdit, CoreError> {
        let changes = strokes.into_iter().map(|stroke| HeftChange::SetStroke { page: heft_page_id.clone(), stroke });
        self.heft_apply(page_id, changes.collect())
    }

    /// Form als Strich speichern (Werkzeug `shape`, Punkte aus der Form abgeleitet).
    pub fn heft_add_shape(
        &self,
        page_id: String,
        heft_page_id: String,
        color: String,
        size: f64,
        shape: HeftShape,
    ) -> Result<HeftEdit, CoreError> {
        let stroke =
            HeftStroke { id: new_id(), tool: "shape".into(), color, size, points: Vec::new(), shape: Some(shape) };
        self.heft_apply(page_id, vec![HeftChange::AddStroke { page: heft_page_id, stroke }])
    }

    /// Striche um `dx`/`dy` verschieben (Lasso).
    pub fn heft_move_strokes(
        &self,
        page_id: String,
        heft_page_id: String,
        ids: Vec<String>,
        dx: f64,
        dy: f64,
    ) -> Result<HeftEdit, CoreError> {
        finite(&[dx, dy], "Verschiebung")?;
        self.lock().stroke_edit(&page_id, &heft_page_id, &ids, |s| s.translate(dx, dy))
    }

    /// Striche um den Anker (`ax`, `ay`) skalieren; die Dicke wächst mit (Lasso-Eckgriff).
    pub fn heft_scale_strokes(
        &self,
        page_id: String,
        heft_page_id: String,
        ids: Vec<String>,
        ax: f64,
        ay: f64,
        factor: f64,
    ) -> Result<HeftEdit, CoreError> {
        finite(&[ax, ay, factor], "Skalierung")?;
        if factor <= 0.0 {
            return Err(invalid("Skalierfaktor muss positiv sein"));
        }
        self.lock().stroke_edit(&page_id, &heft_page_id, &ids, |s| {
            let start = s.geometry();
            s.scale_from(&start, ax, ay, factor);
        })
    }

    /// Farbe und/oder Dicke der Striche ändern (`None`: unverändert).
    pub fn heft_style_strokes(
        &self,
        page_id: String,
        heft_page_id: String,
        ids: Vec<String>,
        color: Option<String>,
        size: Option<f64>,
    ) -> Result<HeftEdit, CoreError> {
        if size.is_some_and(|s| !s.is_finite() || s <= 0.0) {
            return Err(invalid("Dicke muss positiv sein"));
        }
        self.lock().stroke_edit(&page_id, &heft_page_id, &ids, |s| {
            if let Some(c) = &color {
                s.color = Some(c.clone());
            }
            if let Some(size) = size {
                s.size = Some(size);
                s.refresh_bounds();
            }
        })
    }

    /// Kopien der Striche, um 28 Einheiten versetzt; `ids` der Antwort sind die neuen Striche.
    pub fn heft_duplicate_strokes(
        &self,
        page_id: String,
        heft_page_id: String,
        ids: Vec<String>,
    ) -> Result<HeftEdit, CoreError> {
        let mut inner = self.lock();
        let want: HashSet<&str> = ids.iter().map(String::as_str).collect();
        let pg = inner.heft_page(&page_id, &heft_page_id)?;
        let copies = duplicate_strokes(pg.strokes.iter().filter(|s| want.contains(s.id.as_str())), &mut new_id);
        let new_ids = copies.iter().map(|s| s.id.clone()).collect();
        let ops =
            copies.into_iter().map(|s| HeftOp::Add { page: heft_page_id.clone(), item: Item::Stroke(s) }).collect();
        inner.heft_edit(&page_id, ops, new_ids)
    }

    /// Striche, die das Lasso (`polygon`: `[x, y, …]`) umschließt.
    pub fn heft_select_by_lasso(
        &self,
        page_id: String,
        heft_page_id: String,
        polygon: Vec<f32>,
    ) -> Result<Vec<String>, CoreError> {
        let poly: Vec<[f64; 2]> =
            polygon.as_chunks::<2>().0.iter().map(|&[x, y]| [f64::from(x), f64::from(y)]).collect();
        let inner = self.lock();
        let pg = inner.heft_page(&page_id, &heft_page_id)?;
        Ok(select_strokes_by_lasso(&pg.strokes, &poly).into_iter().map(|i| pg.strokes[i].id.clone()).collect())
    }

    /// Gemeinsame Grenzen der Striche (für den Auswahlrahmen); `None` ohne Treffer.
    pub fn heft_strokes_bounds(
        &self,
        page_id: String,
        heft_page_id: String,
        ids: Vec<String>,
    ) -> Result<Option<HeftRect>, CoreError> {
        let want: HashSet<&str> = ids.iter().map(String::as_str).collect();
        let inner = self.lock();
        let pg = inner.heft_page(&page_id, &heft_page_id)?;
        Ok(lasso_bounds(pg.strokes.iter().filter(|s| want.contains(s.id.as_str()))).map(HeftRect::from))
    }

    // ---------- Bilder ----------

    /// Bild einfügen (`bytes` in einem Format, das die Plattform anzeigen kann, `mime` z. B. `image/jpeg`).
    /// Die Daten werden als `heftBlob` gespeichert, falls der Kern sie noch nicht kennt; liefert die Bild-ID.
    #[allow(clippy::too_many_arguments)]
    pub fn heft_add_image(
        &self,
        page_id: String,
        heft_page_id: String,
        bytes: Vec<u8>,
        mime: String,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    ) -> Result<HeftEdit, CoreError> {
        if bytes.is_empty() || !mime.starts_with("image/") || mime.contains([';', ',']) {
            return Err(invalid("Bild: Bytes und ein MIME-Typ wie image/png nötig"));
        }
        let data = format!("data:{mime};base64,{}", STANDARD.encode(&bytes));
        let hash = blob_id(&data);
        let mut inner = self.lock();
        inner.heft_page(&page_id, &heft_page_id)?;
        let image = HeftImage { id: new_id(), blob_id: Some(hash.clone()), x, y, w, h, ocr: None };
        let ops =
            inner.change_ops(&page_id, vec![HeftChange::AddImage { page: heft_page_id, image: image.clone() }])?;
        // Erst das Bild, dann das Element: Fremdgeräte sehen es so nie ohne Daten. Ein im Checkpoint
        // schon bekanntes Bild braucht kein zweites (mehrere MB großes) Event.
        if !inner.model.has_heft_blob(&hash) {
            inner.dispatch("heftBlob", json!({ "hash": hash, "data": data }))?;
        }
        inner.heft_edit(&page_id, ops, vec![image.id])
    }

    /// Bytes und MIME-Typ eines Bilds (lädt es bei Bedarf aus Checkpoint bzw. Log nach; Altbilder mit
    /// `src` ebenso). `None`, solange die Daten fehlen (Fremdgerät hat sie noch nicht geschickt).
    pub fn heft_image_data(
        &self,
        page_id: String,
        heft_page_id: String,
        image_id: String,
    ) -> Result<Option<HeftImageData>, CoreError> {
        let mut guard = self.lock();
        let inner = &mut *guard;
        let image = inner
            .heft_page(&page_id, &heft_page_id)?
            .images
            .iter()
            .find(|i| i.id == image_id)
            .cloned()
            .ok_or_else(|| invalid(format!("Kein Bild {image_id}")))?;
        let data = match image.r#ref.filter(|r| !r.is_empty()) {
            Some(hash) => {
                if !inner.model.state().hefte.blobs.contains_key(&hash) {
                    inner.model.hydrate_heft_blobs(&inner.storage, Some(std::slice::from_ref(&hash)))?;
                }
                inner.model.state().hefte.blobs.get(&hash).cloned()
            }
            None => image.src,
        };
        Ok(data.and_then(|d| split_data_url(&d)).map(|(mime, bytes)| HeftImageData { bytes, mime }))
    }

    /// Rahmen eines Bilds ändern (Verschieben, Skalieren).
    #[allow(clippy::too_many_arguments)]
    pub fn heft_set_image_frame(
        &self,
        page_id: String,
        heft_page_id: String,
        image_id: String,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    ) -> Result<HeftEdit, CoreError> {
        let mut inner = self.lock();
        let mut image = inner.image_record(&page_id, &heft_page_id, &image_id)?;
        (image.x, image.y, image.w, image.h) = (x, y, w, h);
        let ops = inner.change_ops(&page_id, vec![HeftChange::SetImage { page: heft_page_id, image }])?;
        inner.heft_edit(&page_id, ops, Vec::new())
    }

    /// Erkannten Text eines Scans speichern (leer: löschen).
    pub fn heft_set_image_text(
        &self,
        page_id: String,
        heft_page_id: String,
        image_id: String,
        text: String,
    ) -> Result<HeftEdit, CoreError> {
        let mut inner = self.lock();
        let mut image = inner.image_record(&page_id, &heft_page_id, &image_id)?;
        image.ocr = Some(text).filter(|t| !t.is_empty());
        let ops = inner.change_ops(&page_id, vec![HeftChange::SetImage { page: heft_page_id, image }])?;
        inner.heft_edit(&page_id, ops, Vec::new())
    }

    pub fn heft_remove_images(
        &self,
        page_id: String,
        heft_page_id: String,
        ids: Vec<String>,
    ) -> Result<HeftEdit, CoreError> {
        self.heft_apply(page_id, vec![HeftChange::RemoveImages { page: heft_page_id, ids }])
    }

    // ---------- Textfelder ----------

    /// Neues Textfeld; die ID steht in `HeftEdit::ids`. `w` begrenzt die Zeilenbreite (`None`: frei).
    #[allow(clippy::too_many_arguments)]
    pub fn heft_add_text(
        &self,
        page_id: String,
        heft_page_id: String,
        text: String,
        x: f64,
        y: f64,
        w: Option<f64>,
        color: Option<String>,
        size: Option<f64>,
    ) -> Result<HeftEdit, CoreError> {
        let text = HeftText { id: new_id(), text, x, y, w, h: None, color, size };
        self.heft_apply(page_id, vec![HeftChange::AddText { page: heft_page_id, text }])
    }

    /// Textfeld ersetzen (Text, Position, Breite, Farbe, Schriftgröße).
    pub fn heft_set_text(&self, page_id: String, heft_page_id: String, text: HeftText) -> Result<HeftEdit, CoreError> {
        self.heft_apply(page_id, vec![HeftChange::SetText { page: heft_page_id, text }])
    }

    pub fn heft_remove_texts(
        &self,
        page_id: String,
        heft_page_id: String,
        ids: Vec<String>,
    ) -> Result<HeftEdit, CoreError> {
        self.heft_apply(page_id, vec![HeftChange::RemoveTexts { page: heft_page_id, ids }])
    }

    // ---------- Seiten ----------

    /// Seite `heft_page_id` an Position `to` schieben.
    pub fn heft_move_page(&self, page_id: String, heft_page_id: String, to: u32) -> Result<HeftEdit, CoreError> {
        let mut inner = self.lock();
        let mut order: Vec<String> = inner.heft(&page_id)?.pages.iter().map(|p| p.id.clone()).collect();
        let from = order
            .iter()
            .position(|p| *p == heft_page_id)
            .ok_or_else(|| invalid(format!("Keine Heftseite {heft_page_id}")))?;
        if from == to as usize {
            return inner.heft_edit(&page_id, Vec::new(), Vec::new());
        }
        if !impala_heft::pages::move_page(&mut order, from, to as usize) {
            return Err(invalid("Zielposition außerhalb des Hefts"));
        }
        let ops = inner.change_ops(&page_id, vec![HeftChange::SetPageOrder { order }])?;
        inner.heft_edit(&page_id, ops, Vec::new())
    }

    /// Papier wechseln: `lined`, `grid`, `dots` oder `blank`.
    pub fn heft_set_paper(&self, page_id: String, heft_page_id: String, paper: String) -> Result<HeftEdit, CoreError> {
        self.heft_apply(page_id, vec![HeftChange::SetPaper { page: heft_page_id, paper }])
    }

    /// Erkannten Handschrift-Text der Seite speichern (macht die Seite durchsuchbar).
    pub fn heft_set_page_text(
        &self,
        page_id: String,
        heft_page_id: String,
        text: String,
    ) -> Result<HeftEdit, CoreError> {
        self.heft_apply(page_id, vec![HeftChange::SetPageText { page: heft_page_id, text }])
    }
}

impl Inner {
    /// Bild der Seite als Datensatz (zum Ändern einzelner Felder).
    fn image_record(&self, page_id: &str, heft_page_id: &str, image_id: &str) -> Result<HeftImage, CoreError> {
        let pg = self.heft_page(page_id, heft_page_id)?;
        pg.images
            .iter()
            .find(|i| i.id == image_id)
            .map(image_data)
            .ok_or_else(|| invalid(format!("Kein Bild {image_id}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::heft::HeftStroke;

    fn setup() -> (std::sync::Arc<ImpalaCore>, String, String) {
        let core = ImpalaCore::open_in_memory().unwrap();
        let heft = core.create_heft("Test".into(), None, None).unwrap();
        let page = core.heft_page_ids(heft.clone())[0].clone();
        (core, heft, page)
    }

    fn rev(core: &ImpalaCore, heft: &str) -> u64 {
        core.lock().heft(heft).unwrap().rev
    }

    fn stroke(id: &str, x: f32) -> HeftStroke {
        HeftStroke {
            id: id.into(),
            tool: "pen".into(),
            color: "#000".into(),
            size: 3.0,
            points: vec![x, 100.0, 0.5, x + 50.0, 120.0, 0.6, x + 100.0, 100.0, 0.5],
            shape: None,
        }
    }

    fn strokes(core: &ImpalaCore, heft: &str, page: &str) -> Vec<HeftStroke> {
        core.heft_page(heft.into(), page.into()).unwrap().strokes
    }

    #[test]
    fn gesten_sind_ein_event_mit_umkehr() {
        let (core, heft, page) = setup();
        let before = rev(&core, &heft);
        let add = |s: HeftStroke| HeftChange::AddStroke { page: page.clone(), stroke: s };
        let edit = core.heft_apply(heft.clone(), vec![add(stroke("a", 100.0)), add(stroke("b", 400.0))]).unwrap();
        assert_eq!(edit.ids, ["a", "b"]);
        assert_eq!(rev(&core, &heft), before + 1);

        // Verschieben und Umfärben, danach alles zurück und wieder vor.
        core.heft_move_strokes(heft.clone(), page.clone(), vec!["a".into()], 10.0, 20.0).unwrap();
        let moved = strokes(&core, &heft, &page);
        assert_eq!((moved[0].points[0], moved[0].points[1]), (110.0, 120.0));
        let styled = core
            .heft_style_strokes(
                heft.clone(),
                page.clone(),
                vec!["a".into(), "b".into()],
                Some("#f00".into()),
                Some(5.0),
            )
            .unwrap();
        assert!(strokes(&core, &heft, &page).iter().all(|s| s.color == "#f00" && s.size == 5.0));
        let redo = core.heft_apply_ops(heft.clone(), styled.undo).unwrap();
        assert!(strokes(&core, &heft, &page).iter().all(|s| s.color == "#000" && s.size == 3.0));
        core.heft_apply_ops(heft.clone(), redo.undo).unwrap();
        assert!(strokes(&core, &heft, &page).iter().all(|s| s.color == "#f00"));

        let removed = core.heft_remove_strokes(heft.clone(), page.clone(), vec!["a".into()]);
        assert!(removed.is_ok());
        assert_eq!(strokes(&core, &heft, &page).len(), 1);
        let gone = core
            .heft_apply(heft.clone(), vec![HeftChange::RemoveStrokes { page: page.clone(), ids: vec!["b".into()] }])
            .unwrap();
        assert!(strokes(&core, &heft, &page).is_empty());
        core.heft_apply_ops(heft.clone(), gone.undo).unwrap();
        assert_eq!(strokes(&core, &heft, &page)[0].id, "b");
        assert!(core.heft_apply_ops(heft, r#"[{"t":"zz"}]"#.into()).is_err());
    }

    #[test]
    fn skalieren_duplizieren_lasso() {
        let (core, heft, page) = setup();
        core.heft_set_strokes(heft.clone(), page.clone(), vec![stroke("a", 100.0)]).unwrap();
        let (h, p) = (heft.clone(), page.clone());
        let scaled = core.heft_scale_strokes(h, p, vec!["a".into()], 100.0, 100.0, 2.0).unwrap();
        let s = &strokes(&core, &heft, &page)[0];
        assert_eq!((s.points[3], s.size), (200.0, 6.0));
        core.heft_apply_ops(heft.clone(), scaled.undo).unwrap();
        assert_eq!(strokes(&core, &heft, &page)[0].points[3], 150.0);
        assert!(core.heft_scale_strokes(heft.clone(), page.clone(), vec![], 0.0, 0.0, -1.0).is_err());

        let dup = core.heft_duplicate_strokes(heft.clone(), page.clone(), vec!["a".into()]).unwrap();
        assert_eq!(dup.ids.len(), 1);
        let all = strokes(&core, &heft, &page);
        assert_eq!((all[1].points[0], all[1].points[1]), (128.0, 128.0));

        let around = vec![50.0, 50.0, 400.0, 50.0, 400.0, 300.0, 50.0, 300.0];
        let hit = core.heft_select_by_lasso(heft.clone(), page.clone(), around).unwrap();
        assert_eq!(hit.len(), 2);
        let far = vec![600.0, 600.0, 700.0, 600.0, 700.0, 700.0];
        assert!(core.heft_select_by_lasso(heft.clone(), page.clone(), far).unwrap().is_empty());
        let b = core.heft_strokes_bounds(heft, page, hit).unwrap().unwrap();
        assert!(b.min_x <= 100.0 && b.max_x >= 228.0);
    }

    #[test]
    fn formen_erkennen_und_speichern() {
        let (core, heft, page) = setup();
        // Geschlossenes Rechteck aus vielen Punkten.
        let mut pts = Vec::new();
        let corners = [(100.0f32, 100.0f32), (300.0, 100.0), (300.0, 250.0), (100.0, 250.0), (100.0, 100.0)];
        for w in corners.windows(2) {
            for i in 0..40 {
                let r = i as f32 / 40.0;
                pts.extend([w[0].0 + (w[1].0 - w[0].0) * r, w[0].1 + (w[1].1 - w[0].1) * r, 0.5]);
            }
        }
        pts.extend([100.0, 100.0, 0.5]);
        let shape = heft_fit_shape(pts).expect("Form erkannt");
        assert!(matches!(shape, HeftShape::Rect { .. }), "{shape:?}");
        assert!(heft_fit_shape(vec![1.0, 1.0, 0.5]).is_none());

        let edit = core.heft_add_shape(heft.clone(), page.clone(), "#00f".into(), 4.0, shape.clone()).unwrap();
        let s = &strokes(&core, &heft, &page)[0];
        assert_eq!((s.id.as_str(), s.tool.as_str()), (edit.ids[0].as_str(), "shape"));
        assert_eq!(s.shape, Some(shape.clone()));
        assert!(s.points.len() > 30 && heft_shape_outline(shape).len() == s.points.len() / 3 * 2);

        // Form verschieben: bleibt Form, Treffer folgen.
        core.heft_move_strokes(heft.clone(), page.clone(), vec![edit.ids[0].clone()], 50.0, 0.0).unwrap();
        assert!(matches!(strokes(&core, &heft, &page)[0].shape, Some(HeftShape::Rect { x1, .. }) if x1 == 150.0));
        assert_eq!(core.heft_strokes_at(heft.clone(), page.clone(), 350.0, 175.0, 3.0).unwrap().len(), 1);
        // Werkzeug shape ohne Form ist ungültig.
        let bad = HeftStroke { tool: "shape".into(), ..stroke("x", 0.0) };
        assert!(core.heft_set_strokes(heft, page, vec![bad]).is_err());
    }

    fn png(n: u8) -> Vec<u8> {
        vec![0x89, b'P', b'N', b'G', n, 1, 2, 3]
    }

    #[test]
    fn bilder_als_heftblob() {
        let (core, heft, page) = setup();
        let add = |bytes: Vec<u8>| {
            core.heft_add_image(heft.clone(), page.clone(), bytes, "image/png".into(), 10.0, 20.0, 300.0, 200.0)
        };
        let first = add(png(1)).unwrap();
        let second = add(png(1)).unwrap();
        // Gleicher Inhalt = gleicher Hash = ein Blob.
        assert_eq!(core.lock().model.state().hefte.blobs.len(), 1);
        let images = core.heft_page(heft.clone(), page.clone()).unwrap().images;
        assert_eq!(images.len(), 2);
        assert_eq!(images[0].blob_id, images[1].blob_id);
        assert!(images[0].blob_id.as_deref().is_some_and(|b| b.starts_with('b')));

        let data = core.heft_image_data(heft.clone(), page.clone(), first.ids[0].clone()).unwrap().unwrap();
        assert_eq!((data.bytes, data.mime.as_str()), (png(1), "image/png"));

        let frame =
            core.heft_set_image_frame(heft.clone(), page.clone(), second.ids[0].clone(), 5.0, 6.0, 7.0, 8.0).unwrap();
        let moved = &core.heft_page(heft.clone(), page.clone()).unwrap().images[1];
        assert_eq!((moved.x, moved.w, moved.blob_id.clone()), (5.0, 7.0, images[1].blob_id.clone()));
        core.heft_apply_ops(heft.clone(), frame.undo).unwrap();
        assert_eq!(core.heft_page(heft.clone(), page.clone()).unwrap().images[1].x, 10.0);

        core.heft_set_image_text(heft.clone(), page.clone(), first.ids[0].clone(), "Skript".into()).unwrap();
        assert_eq!(core.heft_page(heft.clone(), page.clone()).unwrap().images[0].ocr.as_deref(), Some("Skript"));
        let removed = core.heft_remove_images(heft.clone(), page.clone(), first.ids.clone()).unwrap();
        assert_eq!(core.heft_page(heft.clone(), page.clone()).unwrap().images.len(), 1);
        core.heft_apply_ops(heft.clone(), removed.undo).unwrap();
        assert_eq!(core.heft_page(heft.clone(), page.clone()).unwrap().images.len(), 2);

        assert!(
            core.heft_add_image(heft.clone(), page.clone(), vec![], "image/png".into(), 0.0, 0.0, 1.0, 1.0).is_err()
        );
        assert!(core.heft_add_image(heft, page, png(2), "text/html".into(), 0.0, 0.0, 1.0, 1.0).is_err());
    }

    #[test]
    fn bilddaten_ueberleben_checkpoint_und_neustart() {
        let path = std::env::temp_dir().join(format!("impala-ffi-heft-{}.db", uuid::Uuid::new_v4()));
        let db = path.to_string_lossy().into_owned();
        let (heft, page, image) = {
            let core = ImpalaCore::open(db.clone()).unwrap();
            let heft = core.create_heft("Scan".into(), None, None).unwrap();
            let page = core.heft_page_ids(heft.clone())[0].clone();
            let edit = core
                .heft_add_image(heft.clone(), page.clone(), png(7), "image/png".into(), 0.0, 0.0, 10.0, 10.0)
                .unwrap();
            core.save_checkpoint().unwrap();
            (heft, page, edit.ids[0].clone())
        };
        let core = ImpalaCore::open(db).unwrap();
        let data = core.heft_image_data(heft.clone(), page.clone(), image).unwrap().unwrap();
        assert_eq!(data.bytes, png(7));
        assert!(core.heft_page_svg(heft, page, "#888".into()).unwrap().contains("<image"));
        drop(core);
        for ext in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{ext}", path.display()));
        }
    }

    #[test]
    fn textfelder() {
        let (core, heft, page) = setup();
        let added = core
            .heft_add_text(
                heft.clone(),
                page.clone(),
                "Hallo".into(),
                50.0,
                60.0,
                Some(300.0),
                Some("#123".into()),
                Some(32.0),
            )
            .unwrap();
        let id = added.ids[0].clone();
        let mut t = core.heft_page(heft.clone(), page.clone()).unwrap().texts[0].clone();
        assert_eq!((t.text.as_str(), t.w, t.size), ("Hallo", Some(300.0), Some(32.0)));
        t.text = "Welt".into();
        t.x = 70.0;
        t.color = None;
        let set = core.heft_set_text(heft.clone(), page.clone(), t).unwrap();
        let now = &core.heft_page(heft.clone(), page.clone()).unwrap().texts[0];
        assert_eq!((now.text.as_str(), now.x, now.color.clone()), ("Welt", 70.0, None));
        core.heft_apply_ops(heft.clone(), set.undo).unwrap();
        assert_eq!(core.heft_page(heft.clone(), page.clone()).unwrap().texts[0].text, "Hallo");
        core.heft_remove_texts(heft.clone(), page.clone(), vec![id]).unwrap();
        assert!(core.heft_page(heft, page).unwrap().texts.is_empty());
    }

    #[test]
    fn seiten_papier_text_reihenfolge() {
        let (core, heft, first) = setup();
        let second = core.heft_add_page(heft.clone(), None, None).unwrap();
        core.heft_move_page(heft.clone(), second.clone(), 0).unwrap();
        assert_eq!(core.heft_page_ids(heft.clone()), [second.clone(), first.clone()]);
        assert!(core.heft_move_page(heft.clone(), second.clone(), 9).is_err());
        let order = core.heft_apply(heft.clone(), vec![HeftChange::SetPageOrder { order: vec![first.clone()] }]);
        assert!(order.is_err());

        core.heft_set_paper(heft.clone(), first.clone(), "dots".into()).unwrap();
        assert_eq!(core.heft_page(heft.clone(), first.clone()).unwrap().paper, "dots");
        assert!(core.heft_set_paper(heft.clone(), first.clone(), "x".into()).is_err());
        core.heft_set_page_text(heft.clone(), first.clone(), "Integral".into()).unwrap();
        assert_eq!(core.search("integral".into(), false).len(), 1);

        // Seite samt Inhalt löschen und wiederherstellen.
        core.heft_set_strokes(heft.clone(), first.clone(), vec![stroke("a", 100.0)]).unwrap();
        let gone = core.heft_apply(heft.clone(), vec![HeftChange::RemovePage { page: first.clone() }]).unwrap();
        assert_eq!(core.heft_page_ids(heft.clone()), std::slice::from_ref(&second));
        assert!(core.heft_apply(heft.clone(), vec![HeftChange::RemovePage { page: second.clone() }]).is_err());
        core.heft_apply_ops(heft.clone(), gone.undo).unwrap();
        assert_eq!(core.heft_page_ids(heft.clone()), [second, first.clone()]);
        let back = core.heft_page(heft.clone(), first.clone()).unwrap();
        assert_eq!((back.paper.as_str(), back.strokes.len(), back.ocr_text.as_str()), ("dots", 1, "Integral"));
    }

    #[test]
    fn vorschau_schreibt_nichts() {
        let (core, heft, page) = setup();
        let before = rev(&core, &heft);
        let change = HeftChange::AddStroke { page: page.clone(), stroke: stroke("v", 100.0) };
        let preview = core.heft_preview(heft.clone(), page.clone(), vec![change]).unwrap();
        assert_eq!(preview.strokes.len(), 1);
        assert_eq!(rev(&core, &heft), before);
        assert!(strokes(&core, &heft, &page).is_empty());
    }
}
