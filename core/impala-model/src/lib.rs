//! Datenmodell der App: Event-Typen, Reducer (Event → Zustand), Laden aus Checkpoint und Log,
//! Event-Reihenfolge, 3-Wege-Merge und Sync-Konflikte, Abfragen und Lernwarteschlange.
//!
//! Maßstab ist `web/state.js` (mit `event-order.js`, `db.js` merge3/Import-Konflikte,
//! `conflict-ui.js`): Derselbe Log ergibt in Rust denselben gespeicherten Zustand wie in JS
//! (Golden-Tests in `tests/`), Checkpoints sind in beide Richtungen austauschbar.

pub mod changes;
pub mod conflict;
pub mod event;
pub mod js;
pub mod jsmap;
pub mod merge;
pub mod migrate;
pub mod model;
pub mod order;
pub mod query;
mod record;
pub mod reduce;
pub mod search;
pub mod study;
pub mod tree;
pub mod types;

pub use changes::{Ids, Touched, touched};
pub use event::{Event, LogEvent};
pub use jsmap::JsMap;
pub use merge::{Merge3, merge3};
pub use model::{CheckpointSave, HeftMeta, LoadReport, Model};
pub use order::{OrderTimes, order_keys, reorder_safe};
pub use reduce::{Effects, Live};
pub use types::{
    Card, ChatSession, Deck, GnFolder, Grade, HomeArticle, LearningSession, Page, Review, Settings, State, Telemetry,
    Workspace,
};
