//! Lokale Ablage, wie das Drive-Backup sie braucht, und eine fertige Umsetzung über
//! [`impala_storage::Storage`] ([`StorageStore`]).

use impala_storage::exchange::{self, ExportOptions, ImportOptions};
use impala_storage::{Blob, Storage, Write};
pub use impala_sync::{LocalBlob, StoreError};
use serde_json::Value;

use crate::state::DriveState;

/// Ergebnis eines Imports. Konflikt-/Merge-Details sind App-Sache (`db.js`: merge3,
/// Konfliktkopien) und laufen nur durch.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ImportOutcome {
    pub added: usize,
    pub conflicts: Vec<Value>,
    pub merged: Vec<Value>,
    /// Die neu geschriebenen Events (für den Live-Replay der Plattform).
    pub imported: Vec<Value>,
}

#[allow(async_fn_in_trait)]
pub trait DriveStore {
    async fn load_state(&self) -> Result<DriveState, StoreError>;
    async fn save_state(&mut self, state: &DriveState) -> Result<(), StoreError>;
    /// Höchste lokale Event-`seq`.
    async fn max_seq(&self) -> Result<u64, StoreError>;
    /// Lokale Events mit `after < seq <= up_to` in `seq`-Reihenfolge, samt lokaler Marken
    /// (`seq`, `_remote`, `_remoteSource`, `_derived`) – der Ablauf filtert selbst.
    async fn events_between(&self, after: u64, up_to: u64) -> Result<Vec<Value>, StoreError>;
    /// Fremde Events und (v1-Snapshot) Blobs übernehmen: `payload` hat das `exportAll`-Format.
    /// Neue Events werden `_remote` mit `_remoteSource: "drive"` markiert; lokale Änderungen nach
    /// `unsynced_after_seq` gelten als ungesynct (Konflikterkennung). Ohne `allow_secrets`
    /// verlieren eingehende Einstellungen ihre Geheimnisse.
    async fn import(
        &mut self,
        payload: Value,
        unsynced_after_seq: u64,
        allow_secrets: bool,
    ) -> Result<ImportOutcome, StoreError>;
    /// `exportAll` ohne Blobs als JSON-Text (Drive-Snapshot).
    async fn export_snapshot(&self, redact_secrets: bool, exported_at: &str) -> Result<String, StoreError>;
    /// Alle Blob-Schlüssel (ohne Checkpoint-Einträge).
    async fn blob_ids(&self) -> Result<Vec<String>, StoreError>;
    async fn get_blob(&self, id: &str) -> Result<Option<LocalBlob>, StoreError>;
    async fn put_blob(&mut self, id: &str, blob: LocalBlob) -> Result<(), StoreError>;
}

/// [`DriveStore`] über einen [`Storage`]: Zustand in den Meta-Einträgen (dieselben Schlüssel wie
/// `localStorage` der PWA), Import/Export im `exportAll`-Format von impala-storage.
///
/// Ohne Konflikterkennung: `unsynced_after_seq` bleibt ungenutzt, bis merge3/Konfliktkopien
/// (heute `db.js`) im Kern liegen. Doppelte Events fallen trotzdem weg (per `id`).
#[derive(Debug, Default)]
pub struct StorageStore<S> {
    pub storage: S,
}

impl<S> StorageStore<S> {
    pub fn new(storage: S) -> Self {
        StorageStore { storage }
    }
}

fn err(e: impala_storage::Error) -> StoreError {
    StoreError(e.to_string())
}

impl<S: Storage> DriveStore for StorageStore<S> {
    async fn load_state(&self) -> Result<DriveState, StoreError> {
        let mut failed = None;
        let state = DriveState::from_kv(|k| match self.storage.meta(k) {
            Ok(v) => v,
            Err(e) => {
                failed.get_or_insert(e);
                None
            }
        });
        failed.map_or(Ok(state), |e| Err(err(e)))
    }

    async fn save_state(&mut self, state: &DriveState) -> Result<(), StoreError> {
        let writes = state.to_kv().into_iter().map(|(k, v)| Write::SetMeta(k.to_owned(), v)).collect();
        self.storage.apply(writes).map(drop).map_err(err)
    }

    async fn max_seq(&self) -> Result<u64, StoreError> {
        self.storage.log_info().map(|i| i.max_seq).map_err(err)
    }

    async fn events_between(&self, after: u64, up_to: u64) -> Result<Vec<Value>, StoreError> {
        let events = self.storage.events_after(after, Some(up_to), None).map_err(err)?;
        Ok(events.into_iter().map(Value::Object).collect())
    }

    async fn import(
        &mut self,
        payload: Value,
        _unsynced_after_seq: u64,
        allow_secrets: bool,
    ) -> Result<ImportOutcome, StoreError> {
        let opts = ImportOptions { remote: Some("drive".into()), deny_secrets: !allow_secrets };
        let prepared = exchange::prepare(&self.storage, &payload, &opts).map_err(err)?;
        let report = exchange::commit(&mut self.storage, prepared).map_err(err)?;
        Ok(ImportOutcome {
            added: report.added,
            imported: report.imported.into_iter().map(Value::Object).collect(),
            ..Default::default()
        })
    }

    async fn export_snapshot(&self, redact_secrets: bool, exported_at: &str) -> Result<String, StoreError> {
        let opts = ExportOptions { include_blobs: false, redact_secrets, exported_at: exported_at.to_owned() };
        exchange::export_all(&self.storage, &opts).map_err(err)
    }

    async fn blob_ids(&self) -> Result<Vec<String>, StoreError> {
        self.storage.blob_keys().map_err(err)
    }

    async fn get_blob(&self, id: &str) -> Result<Option<LocalBlob>, StoreError> {
        let blob = self.storage.blob(id).map_err(err)?;
        Ok(blob.map(|b| LocalBlob { meta: b.meta.unwrap_or(Value::Null), data: b.bytes }))
    }

    async fn put_blob(&mut self, id: &str, blob: LocalBlob) -> Result<(), StoreError> {
        let write = Write::PutBlob(id.to_owned(), Blob { bytes: blob.data, meta: Some(blob.meta) });
        self.storage.apply(vec![write]).map(drop).map_err(err)
    }
}
