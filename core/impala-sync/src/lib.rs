//! Impala67-Kern: reine, plattformneutrale Logik für PWA (WASM) und spätere native Apps.
//! Ohne Abhängigkeiten; Plattformen reichen ihre Werte über [`JsLike`] herein.

pub mod compact;
pub mod event;

pub use compact::compact;
pub use event::{Body, Event, Field, JsLike, Kind, Patch, Snapshot, Unsupported, Update, decode};
