//! Speicherschicht: [`Storage`]-Trait über die Stores der App (Events, Blobs, Vektoren,
//! Checkpoint, Meta), SQLite als Standard ([`SqliteStorage`], Feature `sqlite`) und
//! [`MemoryStorage`] für Tests und als Vorlage für den IndexedDB-Adapter der PWA.
//!
//! Gespeicherte Werte bleiben mit der PWA austauschbar: Events als JSON-Objekte, Blobs als
//! Bytes + Metadaten, Checkpoints in den Formaten 1–3, Export/Import im `exportAll`-Format.

pub mod blobs;
pub mod checkpoint;
pub mod compaction;
pub mod event;
pub mod exchange;
pub mod js;
mod memory;
mod ops;
pub mod scheduler;
#[cfg(feature = "sqlite")]
mod sqlite;
mod storage;

use std::fmt;

pub use event::{LogInfo, Object, Seq};
pub use exchange::{ExportOptions, ImportOptions, ImportReport, PreparedImport};
pub use memory::MemoryStorage;
pub use ops::{Compacted, StorageExt};
#[cfg(feature = "sqlite")]
pub use sqlite::SqliteStorage;
pub use storage::{Blob, CheckpointSlot, PartKind, Storage, Write};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    /// Event ohne gültige id/t/type.
    InvalidEvent(String),
    /// Datei ist kein Impala67-Export.
    NotAnExport,
    /// Kaputter JSON-Text (Import, gespeicherte Werte).
    Json(String),
    /// Datenbank wurde von einer neueren App-Version angelegt – nichts anfassen.
    NewerSchema { found: u32, supported: u32 },
    /// Fehler des Speichers selbst (SQLite, IndexedDB …).
    Backend(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Error::InvalidEvent(m) => write!(f, "{m}"),
            Error::NotAnExport => f.write_str("Keine Impala67-Exportdatei."),
            Error::Json(m) => write!(f, "JSON: {m}"),
            Error::NewerSchema { found, supported } => {
                write!(f, "Datenbank-Schema {found} ist neuer als unterstützt ({supported}).")
            }
            Error::Backend(m) => write!(f, "Speicher: {m}"),
        }
    }
}

impl std::error::Error for Error {}
