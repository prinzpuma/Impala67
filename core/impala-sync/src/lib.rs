//! Sync-Protokoll v4 des Impala67-Kerns (gleiches Verhalten wie `web/sync-core.js`,
//! `web/sync-cloudflare.js`, `web/sync-transfer.js`, `web/sync-maintenance.js`,
//! `web/compact-events.js`).
//!
//! - [`compact`]: verlustfreie Kompaktierung des Event-Logs (Werte über [`JsLike`] oder JSON).
//! - [`wire`]: Wire-Events (ohne lokale Metadaten, Echo-Unterdrückung je Transport), Envelopes.
//! - [`packet`]: Chunking nach UTF-8-Bytes, Paket-IDs, Verschlüsselung, Upload-Körper.
//! - [`api`]: Anfragen an den Worker und Auswertung seiner Antworten.
//! - [`client`]: ein ganzer Sync-Durchgang über [`impala_net::HttpClient`] und [`SyncStore`].

pub mod api;
pub mod blobs;
pub mod client;
pub mod compact;
mod error;
pub mod event;
pub mod files;
mod js;
pub mod packet;
pub mod schedule;
pub mod wire;

pub use api::{DEFAULT_WORKER_URL, Endpoint, ServerMessage, acknowledged_upload_cursor};
pub use blobs::{BlobAliveChecker, blob_opaque_key, is_sync_blob_id};
pub use client::{
    BlobReport, CompactReport, LocalBlob, PassReport, Progress, PushReport, StoreError, SyncClient, SyncState,
    SyncStore, WsAction, is_uploadable,
};
pub use compact::compact;
pub use error::{SyncError, is_retryable_status};
pub use event::{Body, Event, Field, JsLike, Kind, Patch, Snapshot, Unsupported, Update, decode};
pub use js::{JsonValue, compact_values};
pub use packet::{
    ChunkLimits, OutgoingPacket, WireEvent, build_packets, chunk_cloud_events, open_packets, upload_bodies,
};
pub use schedule::{reconnect_delay_ms, retry_delay_ms, should_compact_cloud};
pub use wire::{
    CLOUD_SYNC_PROTOCOL, CLOUD_SYNC_PROTOCOL_HEADER, Transport, heft_baseline_event, heft_baseline_ops,
    prepare_cloud_events, prepare_incoming_cloud_events, prune_for_upload, should_upload_to,
};
