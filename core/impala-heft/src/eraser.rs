//! Strich-Radierer (`eraseAt` in `heft-input.js`): Ein berührter Strich geht ganz weg.
//!
//! Das frühere Auftrennen an der Radierer-Fläche hat die App bewusst wieder entfernt (neue
//! Objekte, IDs und Sync-Ereignisse je Pointer-Event); es gibt darum keinen Teil-Radierer.

use crate::doc::Stroke;
use crate::json::js_hypot;

/// Ein Radiervorgang (eine Geste). Merkt sich die letzte geprüfte Position: Pointer-Events
/// kommen viel dichter, als der Radierer breit ist – Schritte unter 35 % des Radius prüfen
/// nicht erneut alle Striche.
#[derive(Debug, Clone, PartialEq)]
pub struct StrokeEraser {
    pub radius: f64,
    last: Option<[f64; 2]>,
}

impl StrokeEraser {
    pub fn new(radius: f64) -> Self {
        StrokeEraser { radius, last: None }
    }

    /// Radiert an (x, y): entfernt alle getroffenen Striche aus `strokes` (Reihenfolge der
    /// übrigen bleibt) und liefert sie zurück (für Rückgängig). Leer, wenn nichts getroffen
    /// oder der Schritt zu klein war.
    pub fn erase_at(&mut self, strokes: &mut Vec<Stroke>, x: f64, y: f64) -> Vec<Stroke> {
        let r = self.radius;
        if let Some([lx, ly]) = self.last
            && js_hypot(x - lx, y - ly) < r * 0.35
        {
            return Vec::new();
        }
        self.last = Some([x, y]);
        let hits: Vec<bool> = strokes.iter().map(|s| s.hit_at(x, y, r)).collect();
        if !hits.contains(&true) {
            return Vec::new();
        }
        let mut removed = Vec::new();
        for (s, hit) in std::mem::take(strokes).into_iter().zip(hits) {
            if hit { removed.push(s) } else { strokes.push(s) }
        }
        removed
    }
}

/// Indizes aller Striche, die ein Radierer mit `radius` bei (x, y) trifft.
pub fn strokes_hit_at(strokes: &[Stroke], x: f64, y: f64, radius: f64) -> Vec<usize> {
    (0..strokes.len()).filter(|&i| strokes[i].hit_at(x, y, radius)).collect()
}
