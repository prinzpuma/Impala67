//! KI-Zeitstrahl-Modus („Lernwelt“): verzweigter Zeitstrahl aus Lektions-Knoten mit Quiz,
//! Arbeitsblatt und Fortschritt (Konzept: docs/KI-LEHRERMODUS-PLAN.md §6).
//!
//! Alles reine Funktionen auf JSON (`serde_json::Value`): Der Zeitstrahl wird gelesen,
//! geändert zurückgegeben und von der Oberfläche gespeichert. Der Kern hat keine Uhr;
//! Zeiten (`now`) kommen als Text von außen.

mod css;
mod edit;
mod layout;
mod memory;
mod model;
mod quiz;
mod session;
mod text;

#[cfg(test)]
mod tests;

pub use css::sanitize_css;
pub use edit::{EditOut, apply_edit};
pub use layout::{describe, list_entry, view, view_at};
pub use model::{Brief, MemoryState, Node, Question, Timeline};
pub use quiz::{CheckOut, Grade, PretestOut, RecordOut, apply_check, record_pretest, record_quiz, record_quiz_with_confidence};
pub use session::{RefreshItem, RefreshOut, RefreshSession, build_refresh_session, record_refresh, today_plan};
pub use text::slug;

/// Werkzeug-Definitionen (`edit_timeline`, `read_timeline`, `check_lesson`) als JSON-Array.
pub const TOOL_DEFS: &str = include_str!("tool_defs.json");
