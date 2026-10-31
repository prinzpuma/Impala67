//! Lasso-Geometrie für die Plattformen (heft-lasso.js / heft-input.js): Griffe, Treffer und
//! Skalierfaktor. Auswahl und Änderungen der Striche stehen in `heft_items.rs`.

use impala_heft::BBox;
use impala_heft::lasso::{self, LassoHandle, LassoTouch};

use crate::heft_items::HeftRect;

/// Eckgriff des Auswahlrahmens mit gegenüberliegendem Anker (Fixpunkt beim Skalieren).
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct HeftLassoHandle {
    /// `tl`, `tr`, `bl` oder `br`.
    pub corner: String,
    pub x: f64,
    pub y: f64,
    pub anchor_x: f64,
    pub anchor_y: f64,
}

impl From<LassoHandle> for HeftLassoHandle {
    fn from(h: LassoHandle) -> Self {
        HeftLassoHandle { corner: h.corner.name().into(), x: h.x, y: h.y, anchor_x: h.anchor[0], anchor_y: h.anchor[1] }
    }
}

fn bbox(r: &HeftRect) -> BBox {
    BBox { min_x: r.min_x, min_y: r.min_y, max_x: r.max_x, max_y: r.max_y }
}

/// Die vier Eckgriffe (tl, tr, bl, br) zum Zeichnen.
#[uniffi::export]
pub fn heft_lasso_handles(bounds: HeftRect) -> Vec<HeftLassoHandle> {
    lasso::lasso_handles(&bbox(&bounds)).into_iter().map(Into::into).collect()
}

/// Getroffener Eckgriff oder `None` (`hitLassoHandle`; Finger 22, Stift 18 Einheiten).
#[uniffi::export]
pub fn heft_hit_lasso_handle(x: f64, y: f64, bounds: HeftRect, hit_radius: f64) -> Option<HeftLassoHandle> {
    lasso::hit_lasso_handle(x, y, &bbox(&bounds), hit_radius).map(Into::into)
}

/// Liegt der Punkt im um `tolerance` erweiterten Auswahlrahmen (`isLassoBodyHit`)?
#[uniffi::export]
pub fn heft_is_lasso_body_hit(x: f64, y: f64, bounds: HeftRect, tolerance: f64) -> bool {
    lasso::is_lasso_body_hit(x, y, &bbox(&bounds), tolerance)
}

/// Was ein Fingertipp im Lasso-Modus bewirkt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum HeftLassoTouch {
    /// Auf der Auswahl: verschieben/skalieren, auch wenn nur der Stift zeichnet.
    Interact,
    /// Daneben: Auswahl und Lasso beenden, zurück zum Stift.
    Dismiss,
    /// Kein Finger oder kein Lasso: normale Behandlung.
    None,
}

/// Fingertipp im Lasso-Modus (`lassoTouchAction`).
#[uniffi::export]
pub fn heft_lasso_touch_action(is_touch: bool, lasso_tool: bool, on_lasso: bool) -> HeftLassoTouch {
    match lasso::lasso_touch_action(is_touch, lasso_tool, on_lasso) {
        LassoTouch::Interact => HeftLassoTouch::Interact,
        LassoTouch::Dismiss => HeftLassoTouch::Dismiss,
        LassoTouch::None => HeftLassoTouch::None,
    }
}

/// Startabstand beim Griff (`max(12, Abstand Anker–Start)`).
#[uniffi::export]
pub fn heft_lasso_resize_start_dist(anchor_x: f64, anchor_y: f64, start_x: f64, start_y: f64) -> f64 {
    lasso::lasso_resize_start_dist([anchor_x, anchor_y], [start_x, start_y])
}

/// Skalierfaktor beim Ziehen am Griff: 0,15…6 und so, dass die Auswahl auf der Seite bleibt.
#[uniffi::export]
#[allow(clippy::too_many_arguments)]
pub fn heft_lasso_resize_factor(
    anchor_x: f64,
    anchor_y: f64,
    start_x: f64,
    start_y: f64,
    start_dist: f64,
    x: f64,
    y: f64,
    bounds: HeftRect,
) -> f64 {
    lasso::lasso_resize_factor([anchor_x, anchor_y], [start_x, start_y], start_dist, [x, y], &bbox(&bounds))
}
