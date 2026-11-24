//! Radierer einer Geste für die nativen Apps (`impala_heft::eraser`, wie `HeftEraser` der PWA): Die App
//! gibt die Striche der Seite, wie sie sie gerade zeigt; jeder Schritt meldet, welche Striche wegfallen und
//! welche Reste an ihre Stelle treten. Geschrieben wird erst am Ende (`net` → `heft_commit_strokes`).

use std::collections::HashSet;
use std::sync::Mutex;

use impala_heft::{EraseMode, Stroke, StrokeEraser};

use crate::CoreError;
use crate::heft::{HeftStroke, stroke_data};
use crate::heft_items::build_stroke;

/// Ein getroffener Strich und seine Reste (leer: ganz weg).
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct HeftEraseChange {
    pub id: String,
    pub pieces: Vec<HeftStroke>,
}

/// Ergebnis der ganzen Geste gegenüber dem Anfang: zu löschende Original-IDs und neue Reste.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct HeftEraseResult {
    pub removed: Vec<String>,
    pub added: Vec<HeftStroke>,
}

struct State {
    strokes: Vec<Stroke>,
    eraser: StrokeEraser,
}

#[derive(uniffi::Object)]
pub struct HeftEraseGesture {
    state: Mutex<State>,
    start: HashSet<String>,
}

#[uniffi::export]
impl HeftEraseGesture {
    /// `strokes`: die Striche der Seite (Seitenkoordinaten), `radius` in Seiteneinheiten,
    /// `mode` `precise` (Standard) oder `stroke`.
    #[uniffi::constructor]
    pub fn new(strokes: Vec<HeftStroke>, radius: f64, mode: String) -> Result<Self, CoreError> {
        let strokes = strokes.iter().map(|s| build_stroke(None, s)).collect::<Result<Vec<_>, _>>()?;
        let start = strokes.iter().map(|s| s.id.clone()).collect();
        let eraser = StrokeEraser::with_mode(radius, EraseMode::parse(&mode), uuid::Uuid::new_v4().to_string());
        Ok(HeftEraseGesture { state: Mutex::new(State { strokes, eraser }), start })
    }

    /// Radiert bis (x, y).
    pub fn erase_at(&self, x: f64, y: f64) -> Vec<HeftEraseChange> {
        let mut st = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let State { strokes, eraser } = &mut *st;
        eraser
            .erase_at(strokes, x, y)
            .into_iter()
            .map(|c| HeftEraseChange { id: c.removed.id, pieces: c.pieces.iter().map(stroke_data).collect() })
            .collect()
    }

    /// Netto-Änderung seit Gestenbeginn (Zwischenstücke, die selbst wieder wegradiert wurden, fehlen).
    pub fn net(&self) -> HeftEraseResult {
        let st = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let now: HashSet<&str> = st.strokes.iter().map(|s| s.id.as_str()).collect();
        let mut removed: Vec<String> = self.start.iter().filter(|id| !now.contains(id.as_str())).cloned().collect();
        removed.sort();
        let added = st.strokes.iter().filter(|s| !self.start.contains(&s.id)).map(stroke_data).collect();
        HeftEraseResult { removed, added }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn praezise_geste_netto() {
        let line = HeftStroke {
            id: "a".into(),
            tool: "marker".into(),
            color: "#ff0".into(),
            size: 2.0,
            points: (0..=10).flat_map(|i| [i as f32 * 10.0, 0.0, 0.5]).collect(),
            shape: None,
        };
        let g = HeftEraseGesture::new(vec![line], 5.0, "precise".into()).unwrap();
        let ch = g.erase_at(50.0, 0.0);
        assert_eq!(ch.len(), 1);
        assert_eq!(ch[0].pieces.len(), 2);
        assert!(ch[0].pieces.iter().all(|p| p.tool == "marker" && p.color == "#ff0"));
        g.erase_at(90.0, 0.0); // die Bahn 50 → 90 kürzt das rechte Stück auf 96…100
        let net = g.net();
        assert_eq!(net.removed, ["a"]);
        assert_eq!(net.added.len(), 2);
        assert!((net.added[1].points[0] - 96.0).abs() < 1e-3);
        assert!(net.added.iter().all(|p| p.id != "a"));
    }
}
