//! Heft (handschriftliches Notizbuch): Dokumentmodell, Operationen und Diff, Geometrie
//! (Formen, Treffer, Lasso, Radierer), Zeichengeometrie und Export.
//!
//! Austauschbar mit der JS-App: Das JSON der Hefte, `heftOps`, `heftSnap` und `heftBlob`
//! liest und schreibt dieses Crate in derselben Form (siehe `docs/ARCHITEKTUR.md`, Heft-Daten).

pub mod diff;
pub mod doc;
pub mod eraser;
pub mod export;
pub mod geometry;
pub mod ink;
mod json;
pub mod lasso;
pub mod ops;
pub mod pages;

pub use diff::{Shadow, diff_document};
pub use doc::{
    BBox, HeftDoc, HeftPage, Image, PAGE_H, PAGE_W, Paper, Point, Shape, Stroke, TextBox, Tool, blob_id,
    compose_page_text,
};
pub use eraser::StrokeEraser;
pub use geometry::{StrokeGeometry, fit_stroke_shape, hit_box, near_point, point_in_polygon};
pub use json::{js_hypot, js_round, js_to_fixed};
pub use lasso::{lasso_bounds, select_strokes_by_lasso};
pub use ops::{HeftEvent, HeftOp, Hefte, Item, ItemKind, parse_ops};
