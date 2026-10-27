//! Heft-Logik (`impala-heft`) für die PWA: Geometrie, Formerkennung, Radierer, Lasso,
//! Dokument-Diff und PDF-Hülle. Zeichnen und Eingabe bleiben in JS. Striche gehen als JSON
//! derselben Form wie `S.heftDocs` über die Grenze; gesten-lange Zustände (Radierer,
//! Verschieben/Skalieren, Diff-Schatten) bleiben als Objekt im Kern.

use impala_heft::geometry::StrokeGeometry;
use impala_heft::lasso::{LassoTouch, duplicate_strokes, hit_lasso_handle, is_lasso_body_hit, lasso_handles};
use impala_heft::{
    BBox, HeftDoc, HeftPage, Image, Paper, Point, Shadow, Stroke, StrokeEraser, compose_page_text, diff_document,
    export, fit_stroke_shape, hit_box, lasso_bounds, near_point, parse_ops, point_in_polygon, select_strokes_by_lasso,
};
use js_sys::{Float64Array, Function, Object};
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

use crate::js::{from_js, set, to_js};

fn value(v: &JsValue) -> Result<Value, JsError> {
    from_js(v).map_err(|e| JsError::new(&e))
}

fn stroke(v: &JsValue) -> Result<Stroke, JsError> {
    Stroke::from_value(value(v)?).ok_or_else(|| JsError::new("Strich unlesbar"))
}

fn strokes(v: &JsValue) -> Result<Vec<Stroke>, JsError> {
    Ok(match value(v)? {
        Value::Array(items) => items.into_iter().filter_map(Stroke::from_value).collect(),
        _ => Vec::new(),
    })
}

fn out(v: impl serde::Serialize) -> JsValue {
    to_js(&serde_json::to_value(v).unwrap_or(Value::Null))
}

/// Geometrie eines Strichs, wie JS sie zurückschreibt: `{ pts, shape, size, bbox }`.
fn geometry_of(s: &Stroke) -> Value {
    json!({ "pts": s.pts, "shape": s.shape, "size": s.size, "bbox": s.bbox })
}

/// Striche im Binärformat der Gesten (`packStrokes` in web/heft-geometry.js): je Strich `counts[i]`
/// Punkte `[x, y, p]` in `coords` (p NaN: ohne Druck), `sizes[i]` (NaN: fehlt), Grenzen in
/// `bboxes[4i..4i+4]` (NaN: keine), Formen als JSON `{ "Index": shape }`. JSON wäre bei vollen Seiten
/// (tausende Striche) pro Geste zu langsam.
fn unpack(coords: &[f64], counts: &[u32], sizes: &[f64], bboxes: &[f64], shapes: &str) -> Result<Vec<Stroke>, JsError> {
    let total: usize = counts.iter().map(|&c| c as usize).sum();
    if coords.len() != total * 3 || sizes.len() != counts.len() || bboxes.len() != counts.len() * 4 {
        return Err(JsError::new("Strich-Daten passen nicht zusammen"));
    }
    let mut shape_of: std::collections::HashMap<usize, Value> = match serde_json::from_str::<Value>(shapes) {
        Ok(Value::Object(m)) => m.into_iter().filter_map(|(k, v)| Some((k.parse().ok()?, v))).collect(),
        _ => Default::default(),
    };
    let mut at = 0;
    Ok(counts
        .iter()
        .enumerate()
        .map(|(i, &n)| {
            let pts = coords[at * 3..(at + n as usize) * 3]
                .chunks_exact(3)
                .map(|c| Point { x: c[0], y: c[1], p: (!c[2].is_nan()).then_some(c[2]), t: None })
                .collect();
            at += n as usize;
            let b = &bboxes[i * 4..i * 4 + 4];
            let bbox = (!b[0].is_nan()).then_some(BBox { min_x: b[0], min_y: b[1], max_x: b[2], max_y: b[3] });
            let shape = shape_of.remove(&i).and_then(|v| Stroke::from_value(json!({ "shape": v }))?.shape);
            Stroke { pts, size: (!sizes[i].is_nan()).then_some(sizes[i]), bbox, shape, ..Stroke::default() }
        })
        .collect())
}

/// Neue Geometrie im Binärformat: `{ xy, counts, sizes, bboxes, shapes }` – `xy` je Punkt x, y
/// (`counts` Punkte je Strich, wie in der Eingabe), Grenzen wie bei [`unpack`], `shapes` `{ Index: shape }` oder `null`.
fn pack_geometry(strokes: &[Stroke]) -> JsValue {
    let xy: Vec<f64> = strokes.iter().flat_map(|s| s.pts.iter().flat_map(|p| [p.x, p.y])).collect();
    let sizes: Vec<f64> = strokes.iter().map(|s| s.size.unwrap_or(f64::NAN)).collect();
    let bboxes: Vec<f64> =
        strokes.iter().flat_map(|s| s.bbox.map_or([f64::NAN; 4], |b| [b.min_x, b.min_y, b.max_x, b.max_y])).collect();
    let shapes: serde_json::Map<String, Value> = strokes
        .iter()
        .enumerate()
        .filter_map(|(i, s)| Some((i.to_string(), serde_json::to_value(s.shape.as_ref()?).ok()?)))
        .collect();
    let counts: Vec<u32> = strokes.iter().map(|s| s.pts.len() as u32).collect();
    let o = Object::new();
    set(&o, "xy", Float64Array::from(xy.as_slice()));
    set(&o, "counts", js_sys::Uint32Array::from(counts.as_slice()));
    set(&o, "sizes", Float64Array::from(sizes.as_slice()));
    set(&o, "bboxes", Float64Array::from(bboxes.as_slice()));
    set(&o, "shapes", if shapes.is_empty() { JsValue::NULL } else { to_js(&Value::Object(shapes)) });
    o.into()
}

fn polygon(flat: &[f64]) -> Vec<[f64; 2]> {
    flat.chunks_exact(2).map(|p| [p[0], p[1]]).collect()
}

fn bbox_from(v: &JsValue) -> Result<Option<BBox>, JsError> {
    Ok(BBox::from_value(&value(v)?))
}

// ---------- Geometrie ----------

/// Oberstes Element unter dem Punkt (`hitBox`); `frames` flach `[x, y, w, h]` je Element
/// (`h` 0/NaN ⇒ 60). Index oder -1.
#[wasm_bindgen(js_name = heftHitBox)]
pub fn heft_hit_box(frames: &[f64], x: f64, y: f64) -> i32 {
    let some = |v: f64| (!v.is_nan()).then_some(v);
    let items: Vec<Image> = frames
        .chunks_exact(4)
        .map(|f| Image { x: some(f[0]), y: some(f[1]), w: some(f[2]), h: some(f[3]), ..Image::default() })
        .collect();
    hit_box(&items, x, y).map_or(-1, |i| i as i32)
}

#[wasm_bindgen(js_name = heftNearPoint)]
pub fn heft_near_point(px: f64, py: f64, x: f64, y: f64, radius: f64) -> bool {
    near_point(&[px, py], x, y, radius)
}

/// Punkt im Polygon (`poly` flach `[x, y, …]`).
#[wasm_bindgen(js_name = heftPointInPolygon)]
pub fn heft_point_in_polygon(x: f64, y: f64, poly: &[f64]) -> bool {
    point_in_polygon(x, y, &polygon(poly))
}

/// Formerkennung (Linie, Pfeil, Dreieck, Rechteck, Ellipse) aus Stiftpunkten; `null` ohne Form.
#[wasm_bindgen(js_name = heftFitShape)]
pub fn heft_fit_shape(points: &JsValue) -> Result<JsValue, JsError> {
    let s = Stroke::from_value(json!({ "pts": value(points)? })).unwrap_or_default();
    Ok(out(fit_stroke_shape(&s.pts)))
}

/// Grenzen samt Rand (`strokeBounds`), `null` ohne Punkte und Form.
#[wasm_bindgen(js_name = heftStrokeBounds)]
pub fn heft_stroke_bounds(s: &JsValue) -> Result<JsValue, JsError> {
    let mut s = stroke(s)?;
    s.bbox = None;
    Ok(out(s.refresh_bounds()))
}

/// Umriss (Punkte bzw. abgetastete Form) zum Zeichnen der Auswahl.
#[wasm_bindgen(js_name = heftStrokeOutline)]
pub fn heft_stroke_outline(s: &JsValue) -> Result<JsValue, JsError> {
    Ok(out(stroke(s)?.outline().to_vec()))
}

/// Verschobene Geometrie `{ pts, shape, size, bbox }` (`translateStroke`).
#[wasm_bindgen(js_name = heftTranslate)]
pub fn heft_translate(s: &JsValue, dx: f64, dy: f64) -> Result<JsValue, JsError> {
    let mut s = stroke(s)?;
    s.translate(dx, dy);
    Ok(to_js(&geometry_of(&s)))
}

/// Geometrie `{ pts, shape, size }` setzen und Grenzen neu rechnen (`applyStrokeGeometry`).
#[wasm_bindgen(js_name = heftApplyGeometry)]
pub fn heft_apply_geometry(geometry: &JsValue) -> Result<JsValue, JsError> {
    let mut s = Stroke::from_value(value(geometry)?).unwrap_or_default();
    s.bbox = None;
    s.refresh_bounds();
    Ok(to_js(&geometry_of(&s)))
}

/// Verschieben/Skalieren einer Auswahl während einer Geste: Die Ausgangsgeometrie bleibt im
/// Kern; jede Bewegung rechnet absolut von ihr aus und liefert die Geometrien aller Striche.
#[wasm_bindgen]
pub struct HeftTransform {
    items: Vec<(Stroke, StrokeGeometry)>,
}

#[wasm_bindgen]
impl HeftTransform {
    /// Auswahl im Binärformat ([`unpack`]).
    #[wasm_bindgen(constructor)]
    pub fn new(
        coords: &[f64],
        counts: &[u32],
        sizes: &[f64],
        bboxes: &[f64],
        shapes: &str,
    ) -> Result<HeftTransform, JsError> {
        let items = unpack(coords, counts, sizes, bboxes, shapes)?
            .into_iter()
            .map(|s| {
                let g = s.geometry();
                (s, g)
            })
            .collect();
        Ok(HeftTransform { items })
    }

    /// Geometrie aller Striche ([`pack_geometry`]) nach Verschieben um (dx, dy) (`moveStrokeFrom`).
    #[wasm_bindgen(js_name = moveBy)]
    pub fn move_by(&mut self, dx: f64, dy: f64) -> JsValue {
        self.items.iter_mut().for_each(|(s, g)| s.move_from(g, dx, dy));
        self.packed()
    }

    fn packed(&self) -> JsValue {
        pack_geometry(&self.items.iter().map(|(s, _)| s.clone()).collect::<Vec<_>>())
    }

    /// Nach Skalieren um den Anker (`scaleStrokeFrom`); die Dicke wächst mit.
    #[wasm_bindgen(js_name = scaleBy)]
    pub fn scale_by(&mut self, ax: f64, ay: f64, factor: f64) -> JsValue {
        self.items.iter_mut().for_each(|(s, g)| s.scale_from(g, ax, ay, factor));
        self.packed()
    }
}

/// Strich-Radierer einer Geste: kennt die Striche der Seite; jeder Aufruf entfernt die
/// getroffenen und liefert ihre Indizes in der aktuellen (schon verkürzten) Liste.
#[wasm_bindgen]
pub struct HeftEraser {
    strokes: Vec<Stroke>,
    /// Laufende Nummer je Strich in der Eingabe, damit JS die Objekte findet.
    index: Vec<u32>,
    eraser: StrokeEraser,
}

#[wasm_bindgen]
impl HeftEraser {
    /// Striche der Seite im Binärformat ([`unpack`]).
    #[wasm_bindgen(constructor)]
    pub fn new(
        coords: &[f64],
        counts: &[u32],
        sizes: &[f64],
        bboxes: &[f64],
        shapes: &str,
        radius: f64,
    ) -> Result<HeftEraser, JsError> {
        let mut strokes = unpack(coords, counts, sizes, bboxes, shapes)?;
        // Ids für den Abgleich nach dem Radieren (die Eingabe kennt nur die Reihenfolge).
        strokes.iter_mut().enumerate().for_each(|(i, s)| s.id = i.to_string());
        let index = (0..strokes.len() as u32).collect();
        Ok(HeftEraser { strokes, index, eraser: StrokeEraser::new(radius) })
    }

    /// Radiert an (x, y): Indizes (in die Eingabe von `new`) der entfernten Striche.
    #[wasm_bindgen(js_name = eraseAt)]
    pub fn erase_at(&mut self, x: f64, y: f64) -> Vec<u32> {
        let before: Vec<String> = self.strokes.iter().map(|s| s.id.clone()).collect();
        let removed = self.eraser.erase_at(&mut self.strokes, x, y);
        if removed.is_empty() {
            return Vec::new();
        }
        // Reihenfolge der übrigen bleibt: Treffer sind die Lücken zwischen alter und neuer Liste.
        let (mut kept, mut gone, mut k) = (Vec::new(), Vec::new(), 0);
        for (i, id) in before.iter().enumerate() {
            if k < self.strokes.len() && self.strokes[k].id == *id {
                kept.push(self.index[i]);
                k += 1;
            } else {
                gone.push(self.index[i]);
            }
        }
        self.index = kept;
        gone
    }
}

// ---------- Lasso ----------

/// Gemeinsame Grenzen der Striche (Binärformat, [`unpack`]; ohne Rand), `null` ohne Punkte.
#[wasm_bindgen(js_name = heftLassoBounds)]
pub fn heft_lasso_bounds(
    coords: &[f64],
    counts: &[u32],
    sizes: &[f64],
    bboxes: &[f64],
    shapes: &str,
) -> Result<JsValue, JsError> {
    Ok(out(lasso_bounds(&unpack(coords, counts, sizes, bboxes, shapes)?)))
}

/// Indizes der vom Lasso (`poly` flach) umschlossenen Striche (Binärformat, [`unpack`]).
#[wasm_bindgen(js_name = heftSelectByLasso)]
pub fn heft_select_by_lasso(
    coords: &[f64],
    counts: &[u32],
    sizes: &[f64],
    bboxes: &[f64],
    shapes: &str,
    poly: &[f64],
) -> Result<Vec<u32>, JsError> {
    let all = unpack(coords, counts, sizes, bboxes, shapes)?;
    Ok(select_strokes_by_lasso(&all, &polygon(poly)).into_iter().map(|i| i as u32).collect())
}

/// Was ein Fingertipp im Lasso-Modus bewirkt: `"interact"`, `"dismiss"` oder `"none"`.
#[wasm_bindgen(js_name = heftLassoTouchAction)]
pub fn heft_lasso_touch_action(is_touch: bool, lasso_tool: bool, on_lasso: bool) -> String {
    match impala_heft::lasso::lasso_touch_action(is_touch, lasso_tool, on_lasso) {
        LassoTouch::Interact => "interact",
        LassoTouch::Dismiss => "dismiss",
        LassoTouch::None => "none",
    }
    .into()
}

fn handle_json(h: &impala_heft::lasso::LassoHandle) -> Value {
    json!({ "x": h.x, "y": h.y, "anchor": h.anchor, "name": h.corner.name() })
}

/// Die vier Eckgriffe `{ tl, tr, bl, br }` eines Auswahlrahmens.
#[wasm_bindgen(js_name = heftLassoHandles)]
pub fn heft_lasso_handles(bounds: &JsValue) -> Result<JsValue, JsError> {
    let Some(b) = bbox_from(bounds)? else { return Ok(JsValue::NULL) };
    let map: serde_json::Map<String, Value> =
        lasso_handles(&b).iter().map(|h| (h.corner.name().to_owned(), handle_json(h))).collect();
    Ok(to_js(&Value::Object(map)))
}

/// Getroffener Eckgriff oder `null`.
#[wasm_bindgen(js_name = heftHitLassoHandle)]
pub fn heft_hit_lasso_handle(x: f64, y: f64, bounds: &JsValue, hit_radius: f64) -> Result<JsValue, JsError> {
    let Some(b) = bbox_from(bounds)? else { return Ok(JsValue::NULL) };
    Ok(hit_lasso_handle(x, y, &b, hit_radius).map_or(JsValue::NULL, |h| to_js(&handle_json(&h))))
}

/// Liegt der Punkt im (um `tolerance` erweiterten) Auswahlrahmen?
#[wasm_bindgen(js_name = heftIsLassoBodyHit)]
pub fn heft_is_lasso_body_hit(x: f64, y: f64, bounds: &JsValue, tolerance: f64) -> Result<bool, JsError> {
    Ok(bbox_from(bounds)?.is_some_and(|b| is_lasso_body_hit(x, y, &b, tolerance)))
}

/// Kopien der Striche, 28 Einheiten versetzt; `uid` liefert die neuen IDs.
#[wasm_bindgen(js_name = heftDuplicateStrokes)]
pub fn heft_duplicate_strokes(selection: &JsValue, uid: &Function) -> Result<JsValue, JsError> {
    let mut next = || uid.call0(&JsValue::NULL).ok().and_then(|v| v.as_string()).unwrap_or_default();
    Ok(out(duplicate_strokes(&strokes(selection)?, &mut next)))
}

// ---------- Dokument ----------

/// Leere Heftseite.
#[wasm_bindgen(js_name = heftEmptyPage)]
pub fn heft_empty_page(id: &str, paper: Option<String>) -> JsValue {
    let paper = Paper::parse(paper.map(Value::String).as_ref());
    out(HeftPage::empty(id, paper))
}

/// Durchsuchbarer Seitentext: Stricherkennung, danach der Text aller Scan-Bilder.
#[wasm_bindgen(js_name = heftComposePageText)]
pub fn heft_compose_page_text(stroke_text: &str, page: &JsValue) -> Result<String, JsError> {
    Ok(compose_page_text(stroke_text, &HeftPage::from_value(value(page)?)))
}

/// ID eines Bild-Blobs aus seinen Daten (Teil des gespeicherten Formats).
#[wasm_bindgen(js_name = heftBlobId)]
pub fn heft_blob_id(data: &str) -> String {
    impala_heft::blob_id(data)
}

/// Zuletzt veröffentlichter Stand eines Hefts (je Element nur eine Signatur).
#[wasm_bindgen]
pub struct HeftShadow(Shadow);

#[wasm_bindgen]
impl HeftShadow {
    /// Schatten eines Dokuments.
    pub fn of(doc: &JsValue) -> Result<HeftShadow, JsError> {
        Ok(HeftShadow(Shadow::of(&HeftDoc::from_value(value(doc)?))))
    }

    /// Log-Operationen fortschreiben (gleiche Regeln wie der Reducer).
    #[wasm_bindgen(js_name = applyOps)]
    pub fn apply_ops(&mut self, ops: &JsValue) -> Result<(), JsError> {
        self.0.apply_ops(&parse_ops(value(ops)?));
        Ok(())
    }
}

/// Ergebnis von [`heft_diff`]: Operationen und der Schatten des neuen Stands.
#[wasm_bindgen]
pub struct HeftDiff {
    ops: Value,
    shadow: Option<HeftShadow>,
}

#[wasm_bindgen]
impl HeftDiff {
    #[wasm_bindgen(getter)]
    pub fn ops(&self) -> JsValue {
        to_js(&self.ops)
    }

    /// Den neuen Schatten übernehmen (nur einmal).
    #[wasm_bindgen(js_name = takeShadow)]
    pub fn take_shadow(&mut self) -> Option<HeftShadow> {
        self.shadow.take()
    }
}

fn diff_from(previous: Option<&Shadow>, doc: &JsValue) -> Result<HeftDiff, JsError> {
    let (ops, shadow) = diff_document(previous, &HeftDoc::from_value(value(doc)?));
    Ok(HeftDiff { ops: serde_json::to_value(ops).unwrap_or(Value::Null), shadow: Some(HeftShadow(shadow)) })
}

#[wasm_bindgen]
impl HeftShadow {
    /// Operationen, die diesen Stand in `doc` überführen.
    pub fn diff(&self, doc: &JsValue) -> Result<HeftDiff, JsError> {
        diff_from(Some(&self.0), doc)
    }
}

/// Operationen, die ein leeres Heft in `doc` überführen.
#[wasm_bindgen(js_name = heftDiffFromEmpty)]
pub fn heft_diff_from_empty(doc: &JsValue) -> Result<HeftDiff, JsError> {
    diff_from(None, doc)
}

// ---------- Export und Seiten ----------

/// Dateiname für Exporte aus dem Seitentitel.
#[wasm_bindgen(js_name = heftExportName)]
pub fn heft_export_name(title: Option<String>) -> String {
    export::export_file_name(title.as_deref())
}

/// PDF aus JPEG-Seitenbildern (A4, zentriert). `jpegs` hintereinander, `lengths`/`widths`/`heights` je Seite.
#[wasm_bindgen(js_name = heftBuildPdf)]
pub fn heft_build_pdf(jpegs: &[u8], lengths: &[u32], widths: &[u32], heights: &[u32]) -> Result<Vec<u8>, JsError> {
    if lengths.len() != widths.len() || lengths.len() != heights.len() {
        return Err(JsError::new("Seitenangaben passen nicht zusammen"));
    }
    let mut at = 0usize;
    let mut pages = Vec::with_capacity(lengths.len());
    for i in 0..lengths.len() {
        let end = at + lengths[i] as usize;
        let jpeg = jpegs.get(at..end).ok_or_else(|| JsError::new("Seitenbilder zu kurz"))?;
        pages.push(export::PdfPage { jpeg, width: widths[i], height: heights[i] });
        at = end;
    }
    Ok(export::build_pdf(&pages))
}

/// Neue Seitenreihenfolge nach Verschieben von `from` nach `to` (Indizes), `undefined` wenn ungültig.
#[wasm_bindgen(js_name = heftMovePage)]
pub fn heft_move_page(len: usize, from: usize, to: usize) -> Option<Vec<u32>> {
    let mut order: Vec<u32> = (0..len as u32).collect();
    impala_heft::pages::move_page(&mut order, from, to).then_some(order)
}

/// Einfügeposition (`start`, `before`, `after`, sonst Ende).
#[wasm_bindgen(js_name = heftInsertAt)]
pub fn heft_insert_at(position: &str, current: usize, len: usize) -> usize {
    use impala_heft::pages::InsertPosition;
    let p = match position {
        "start" => InsertPosition::Start,
        "before" => InsertPosition::Before,
        "after" => InsertPosition::After,
        _ => InsertPosition::End,
    };
    impala_heft::pages::insert_at(p, current, len)
}

#[wasm_bindgen(js_name = heftCanDeletePages)]
pub fn heft_can_delete_pages(total: usize, selected: usize) -> bool {
    impala_heft::pages::can_delete_pages(total, selected)
}
