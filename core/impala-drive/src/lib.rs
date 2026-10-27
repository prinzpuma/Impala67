//! Google-Drive-Backup des Impala67-Kerns (gleiches Verhalten wie `web/drive.js`,
//! `web/drive-sync-policy.js`, `web/drive-status.js`, `web/backup-status.js`).
//!
//! - [`format`]: Dateien im `appDataFolder` (Snapshot v1/v2, gzip-Deltas, Blob-Dateien,
//!   Namen, `appProperties`, Kodierung). Keine eigene Verschlüsselung, nur gzip.
//! - [`api`]: Drive-REST-API v3 – Anfragen bauen, Antworten auswerten (ohne Netz).
//! - [`state`]: gerätelokaler Zustand, austauschbar mit den `localStorage`-Einträgen der PWA.
//! - [`client`]: ein ganzer Durchgang ([`DriveBackup`]) über [`impala_net::HttpClient`],
//!   [`TokenSource`] und [`DriveStore`].
//! - [`policy`], [`status`]: Auto-Sync-Regeln und Anzeige-Zustand.
//!
//! Wiederherstellen ist kein eigener Weg: Auf einem leeren Gerät spielt der erste
//! [`DriveBackup::sync`] Snapshot (auch v1 samt Blobs) und alle Deltas ein.

pub mod api;
pub mod client;
pub mod clock;
mod error;
pub mod format;
pub mod policy;
pub mod state;
pub mod status;
pub mod store;

pub use client::{
    COMPACT_AFTER_DELTAS, DriveBackup, DriveOptions, Phase, StorageInfo, SyncReport, TokenSource, is_local_only,
};
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
pub use clock::SystemClock;
pub use clock::{Clock, ClockSkew};
pub use error::DriveError;
pub use format::{DriveFile, Encoding, FileKind};
pub use state::DriveState;
pub use store::{DriveStore, ImportOutcome, LocalBlob, StorageStore, StoreError};
