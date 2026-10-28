//! Hefte (Handschrift): Seiten lesen und mit dem Stift ändern. Jede Änderung ist ein `heftOps`-Event
//! mit den Operationen des Kerns (`s+`, `s-`, `pg+` …), wie die PWA sie schreibt; Striche haben
//! stabile IDs, damit zwei Geräte dieselben Striche als dieselben erkennen.
//!
//! Koordinaten sind Seitenkoordinaten (Breite [`PAGE_W`], Höhe [`PAGE_H`]). Punkte wandern als flache
//! Liste `[x, y, druck, x, y, druck, …]`, damit große Seiten schnell über die Grenze kommen.

use impala_heft::{HeftDoc, HeftOp, HeftPage, Item, ItemKind, PAGE_H, PAGE_W, Paper, Point, Stroke, Tool};
use serde_json::{Value, json};

use crate::{CoreError, ImpalaCore, Inner, invalid};

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct HeftStroke {
    pub id: String,
    /// `pen`, `marker` (halbtransparent, dreifache Breite) oder `shape` (erkannte Form).
    pub tool: String,
    /// CSS-Farbe, z. B. `#1f2937`.
    pub color: String,
    pub size: f64,
    /// `[x, y, druck, …]`; bei Formen der Umriss (Druck 1).
    pub points: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct HeftImage {
    pub id: String,
    /// Gespeichertes Bild (`ImpalaCore::file`), falls vorhanden.
    pub file_id: Option<String>,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct HeftText {
    pub id: String,
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub w: Option<f64>,
    pub h: Option<f64>,
    pub color: Option<String>,
    pub size: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct HeftPageData {
    pub id: String,
    /// `lined`, `grid`, `dots` oder `blank`.
    pub paper: String,
    pub width: f64,
    pub height: f64,
    pub strokes: Vec<HeftStroke>,
    pub images: Vec<HeftImage>,
    pub texts: Vec<HeftText>,
    /// Erkannter Handschrift-Text.
    pub ocr_text: String,
}

fn paper_name(p: &Paper) -> String {
    serde_json::to_value(p).ok().and_then(|v| v.as_str().map(str::to_owned)).unwrap_or_else(|| "lined".into())
}

fn stroke_data(s: &Stroke) -> HeftStroke {
    let points = match s.shape.as_ref().and_then(impala_heft::geometry::shape_outline) {
        Some(outline) => outline.iter().flat_map(|[x, y]| [*x as f32, *y as f32, 1.0]).collect(),
        None => s
            .pts
            .iter()
            .flat_map(|p| [p.x as f32, p.y as f32, p.p.filter(|p| !p.is_nan()).unwrap_or(0.5) as f32])
            .collect(),
    };
    HeftStroke {
        id: s.id.clone(),
        tool: s.tool.as_ref().map_or("pen", Tool::as_str).to_owned(),
        color: s.color.clone().unwrap_or_else(|| "#1f2937".into()),
        size: s.size.filter(|s| *s > 0.0).unwrap_or(3.0),
        points,
    }
}

fn page_data(pg: &HeftPage) -> HeftPageData {
    HeftPageData {
        id: pg.id.clone(),
        paper: paper_name(&pg.paper),
        width: PAGE_W,
        height: PAGE_H,
        strokes: pg.strokes.iter().map(stroke_data).collect(),
        images: pg
            .images
            .iter()
            .map(|i| HeftImage {
                id: i.id.clone(),
                file_id: i.r#ref.clone().filter(|r| !r.is_empty()),
                x: i.x.unwrap_or(0.0),
                y: i.y.unwrap_or(0.0),
                w: i.w.unwrap_or(0.0),
                h: i.h.unwrap_or(0.0),
            })
            .collect(),
        texts: pg
            .texts
            .iter()
            .map(|t| HeftText {
                id: t.id.clone(),
                text: t.text.clone().unwrap_or_default(),
                x: t.x.unwrap_or(0.0),
                y: t.y.unwrap_or(0.0),
                w: t.w,
                h: t.h,
                color: t.color.clone(),
                size: t.size,
            })
            .collect(),
        ocr_text: pg.ocr_text.clone(),
    }
}

impl Inner {
    fn heft(&self, page_id: &str) -> Result<&HeftDoc, CoreError> {
        self.model.state().hefte.get(page_id).ok_or_else(|| invalid(format!("Kein Heft {page_id}")))
    }

    fn heft_page(&self, page_id: &str, heft_page_id: &str) -> Result<&HeftPage, CoreError> {
        self.heft(page_id)?
            .pages
            .iter()
            .find(|p| p.id == heft_page_id)
            .ok_or_else(|| invalid(format!("Keine Heftseite {heft_page_id}")))
    }

    fn heft_ops(&mut self, page_id: &str, ops: Vec<HeftOp>) -> Result<(), CoreError> {
        let ops = serde_json::to_value(&ops).map_err(|e| invalid(e.to_string()))?;
        self.dispatch("heftOps", json!({ "pageId": page_id, "ops": ops }))?;
        Ok(())
    }
}

fn new_page_op(at: Option<u32>, paper: Option<String>) -> (String, HeftOp) {
    let id = uuid::Uuid::new_v4().to_string();
    let paper = Some(Paper::parse(Some(&Value::from(paper.unwrap_or_else(|| "lined".into())))));
    (id.clone(), HeftOp::PageAdd { at: at.map(f64::from), page: id, paper })
}

#[uniffi::export]
impl ImpalaCore {
    /// Neues Heft mit einer linierten Seite; liefert die Seiten-ID (wie eine Notiz im Seitenbaum).
    pub fn create_heft(
        &self,
        title: String,
        parent_id: Option<String>,
        workspace_id: Option<String>,
    ) -> Result<String, CoreError> {
        let id = self.create_page_of_kind(title, String::new(), parent_id, workspace_id, Some("heft"))?;
        let (_, op) = new_page_op(Some(0), None);
        self.lock().heft_ops(&id, vec![op])?;
        Ok(id)
    }

    /// IDs der Heftseiten in Reihenfolge (leer, wenn `page_id` kein Heft ist).
    pub fn heft_page_ids(&self, page_id: String) -> Vec<String> {
        let inner = self.lock();
        inner.heft(&page_id).map(|d| d.pages.iter().map(|p| p.id.clone()).collect()).unwrap_or_default()
    }

    /// Eine Heftseite zum Zeichnen.
    pub fn heft_page(&self, page_id: String, heft_page_id: String) -> Result<HeftPageData, CoreError> {
        Ok(page_data(self.lock().heft_page(&page_id, &heft_page_id)?))
    }

    /// Neue Seite an Position `at` (`None`: hinten); liefert ihre ID.
    pub fn heft_add_page(&self, page_id: String, at: Option<u32>, paper: Option<String>) -> Result<String, CoreError> {
        let mut inner = self.lock();
        inner.heft(&page_id)?;
        let (id, op) = new_page_op(at, paper);
        inner.heft_ops(&page_id, vec![op])?;
        Ok(id)
    }

    pub fn heft_remove_page(&self, page_id: String, heft_page_id: String) -> Result<(), CoreError> {
        let mut inner = self.lock();
        inner.heft_page(&page_id, &heft_page_id)?;
        inner.heft_ops(&page_id, vec![HeftOp::PageRemove { page: heft_page_id }])
    }

    /// Fertigen Strich speichern (`points`: `[x, y, druck, …]`); liefert seine ID.
    pub fn heft_add_stroke(
        &self,
        page_id: String,
        heft_page_id: String,
        tool: String,
        color: String,
        size: f64,
        points: Vec<f32>,
    ) -> Result<String, CoreError> {
        if points.len() < 3 || !points.len().is_multiple_of(3) {
            return Err(invalid("Punkte als [x, y, druck, …]"));
        }
        let mut inner = self.lock();
        inner.heft_page(&page_id, &heft_page_id)?;
        let mut stroke = Stroke {
            id: uuid::Uuid::new_v4().to_string(),
            tool: Some(Tool::parse(&tool)),
            color: Some(color),
            size: Some(size),
            pts: points
                .as_chunks::<3>()
                .0
                .iter()
                .map(|&[x, y, p]| Point::new(f64::from(x), f64::from(y), f64::from(p)))
                .collect(),
            ..Default::default()
        };
        stroke.refresh_bounds();
        let id = stroke.id.clone();
        inner.heft_ops(&page_id, vec![HeftOp::Add { page: heft_page_id, item: Item::Stroke(stroke) }])?;
        Ok(id)
    }

    /// Striche entfernen (Radierer, Rückgängig).
    pub fn heft_remove_strokes(
        &self,
        page_id: String,
        heft_page_id: String,
        ids: Vec<String>,
    ) -> Result<(), CoreError> {
        if ids.is_empty() {
            return Ok(());
        }
        let mut inner = self.lock();
        inner.heft_page(&page_id, &heft_page_id)?;
        inner.heft_ops(&page_id, vec![HeftOp::Remove { page: heft_page_id, kind: ItemKind::Stroke, ids }])
    }

    /// Striche unter dem Radierer (Kreis um `x`/`y`), oberster zuerst.
    pub fn heft_strokes_at(
        &self,
        page_id: String,
        heft_page_id: String,
        x: f64,
        y: f64,
        radius: f64,
    ) -> Result<Vec<String>, CoreError> {
        let inner = self.lock();
        let pg = inner.heft_page(&page_id, &heft_page_id)?;
        Ok(pg.strokes.iter().rev().filter(|s| s.hit_at(x, y, radius)).map(|s| s.id.clone()).collect())
    }
}

#[cfg(test)]
mod tests {
    use crate::{ImpalaCore, PageKind};

    #[test]
    fn heft_anlegen_zeichnen_radieren() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let heft = core.create_heft("Skizzen".into(), None, None).unwrap();
        assert_eq!(core.page(heft.clone()).unwrap().summary.kind, PageKind::Heft);
        let pages = core.heft_page_ids(heft.clone());
        assert_eq!(pages.len(), 1);

        let pts = vec![100.0, 100.0, 0.5, 150.0, 120.0, 0.6, 200.0, 140.0, 0.7];
        let s1 = core.heft_add_stroke(heft.clone(), pages[0].clone(), "pen".into(), "#000".into(), 3.0, pts).unwrap();
        let page = core.heft_page(heft.clone(), pages[0].clone()).unwrap();
        assert_eq!(page.strokes.len(), 1);
        assert_eq!(page.strokes[0].points.len(), 9);
        assert_eq!(page.paper, "lined");

        assert_eq!(
            core.heft_strokes_at(heft.clone(), pages[0].clone(), 150.0, 120.0, 5.0).unwrap(),
            std::slice::from_ref(&s1)
        );
        assert!(core.heft_strokes_at(heft.clone(), pages[0].clone(), 800.0, 800.0, 5.0).unwrap().is_empty());
        core.heft_remove_strokes(heft.clone(), pages[0].clone(), vec![s1]).unwrap();
        assert!(core.heft_page(heft.clone(), pages[0].clone()).unwrap().strokes.is_empty());

        let second = core.heft_add_page(heft.clone(), None, Some("grid".into())).unwrap();
        assert_eq!(core.heft_page_ids(heft.clone()), [pages[0].clone(), second.clone()]);
        assert_eq!(core.heft_page(heft.clone(), second.clone()).unwrap().paper, "grid");
        core.heft_remove_page(heft.clone(), second).unwrap();
        assert_eq!(core.heft_page_ids(heft.clone()).len(), 1);
        assert!(core.heft_add_stroke(heft, pages[0].clone(), "pen".into(), "#000".into(), 3.0, vec![1.0]).is_err());
    }
}
