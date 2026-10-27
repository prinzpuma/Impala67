//! Fehler des Drive-Backups.

use std::fmt;

use impala_net::NetError;
use impala_sync::{StoreError, SyncError};

#[derive(Debug, Clone, PartialEq)]
pub enum DriveError {
    /// Transport: keine Verbindung, Zeitüberschreitung, abgebrochen.
    Net(NetError),
    /// Kein gültiges Token oder Drive hat es abgelehnt (401) und es ließ sich nicht erneuern.
    /// Die Plattform zeigt „Pausiert“; der nächste bewusste Sync-Klick meldet neu an.
    SessionExpired,
    /// HTTP-Status ≥ 400 (nach den Wiederholungen bei 429/5xx) samt Anfang der Antwort.
    Http { status: u16, body: String },
    /// Antwort oder Datei nicht lesbar (kein JSON, kaputtes gzip, Pflichtfeld fehlt).
    BadResponse(String),
    /// Fehler der lokalen Ablage.
    Store(String),
}

impl DriveError {
    pub fn status(&self) -> Option<u16> {
        match self {
            DriveError::Http { status, .. } => Some(*status),
            _ => None,
        }
    }

    /// Changes-Token abgelaufen oder ungültig: Drive meldet 404 oder 410.
    pub(crate) fn is_stale_token(&self) -> bool {
        matches!(self.status(), Some(404 | 410))
    }
}

impl fmt::Display for DriveError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DriveError::Net(e) => write!(f, "Google Drive nicht erreichbar: {e}"),
            DriveError::SessionExpired => f.write_str("Google-Sitzung abgelaufen – bitte erneut synchronisieren."),
            DriveError::Http { status, body } => write!(f, "Drive-Fehler {status}: {body}"),
            DriveError::BadResponse(m) | DriveError::Store(m) => f.write_str(m),
        }
    }
}

impl std::error::Error for DriveError {}

impl From<NetError> for DriveError {
    fn from(e: NetError) -> Self {
        DriveError::Net(e)
    }
}

impl From<StoreError> for DriveError {
    fn from(e: StoreError) -> Self {
        DriveError::Store(e.0)
    }
}

impl From<SyncError> for DriveError {
    fn from(e: SyncError) -> Self {
        DriveError::BadResponse(e.to_string())
    }
}
