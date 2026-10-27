//! Fehler des Sync-Ablaufs und ob ein erneuter Versuch sinnvoll ist (`isRetryableSyncError`).

use std::fmt;

use impala_crypto::CryptoError;
use impala_net::NetError;

#[derive(Debug, Clone, PartialEq)]
pub enum SyncError {
    /// Transport: keine Verbindung, Zeitüberschreitung, abgebrochen.
    Net(NetError),
    /// HTTP-Status ≥ 400 mit der Meldung des Servers (oder `"<Kontext> (Status N)"`).
    Http {
        status: u16,
        message: String,
    },
    /// Antwort nicht lesbar (kein JSON, abgeschnitten).
    BadResponse(String),
    /// Verstoß gegen das Protokoll (Sequenzlücke, unzulässige Metadaten, falsche Blob-ID).
    Protocol(String),
    Crypto(CryptoError),
    /// Fehler der lokalen Ablage.
    Store(String),
    /// Durchgang abgebrochen (Zugangsdaten geändert, `stop_flag`).
    Stopped,
}

impl SyncError {
    /// Wie `isRetryableSyncError`: ohne Status oder 408/425/429/5xx.
    // Abweichung von JS: Protokoll- und Krypto-Fehler hatten dort keinen Status und galten als
    // vorübergehend – ein falscher Schlüssel wurde so endlos mit Backoff wiederholt.
    pub fn is_retryable(&self) -> bool {
        match self {
            SyncError::Net(_) | SyncError::BadResponse(_) | SyncError::Store(_) => true,
            SyncError::Http { status, .. } => is_retryable_status(*status),
            SyncError::Protocol(_) | SyncError::Crypto(_) | SyncError::Stopped => false,
        }
    }

    /// Volle Quota: Der Server meldet sie wie zu große Dateien mit 413, nur die Meldung unterscheidet.
    pub fn is_quota(&self) -> bool {
        matches!(self, SyncError::Http { message, .. } if message.to_lowercase().contains("quota"))
    }

    pub fn status(&self) -> Option<u16> {
        match self {
            SyncError::Http { status, .. } => Some(*status),
            _ => None,
        }
    }
}

pub fn is_retryable_status(status: u16) -> bool {
    status == 0 || status == 408 || status == 425 || status == 429 || status >= 500
}

impl fmt::Display for SyncError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SyncError::Net(NetError::Timeout) => {
                f.write_str("Zeitüberschreitung beim Cloudflare-Sync: keine Datenübertragung.")
            }
            SyncError::Net(NetError::Aborted) => f.write_str("Cloudflare-Sync abgebrochen."),
            SyncError::Net(_) => f.write_str("Der Cloudflare-Sync-Server ist nicht erreichbar."),
            SyncError::Http { message, .. } => f.write_str(message),
            SyncError::BadResponse(m) | SyncError::Protocol(m) | SyncError::Store(m) => f.write_str(m),
            SyncError::Crypto(e) => e.fmt(f),
            SyncError::Stopped => f.write_str("Sync-Durchgang abgebrochen (Zugangsdaten geändert)."),
        }
    }
}

impl std::error::Error for SyncError {}

impl From<NetError> for SyncError {
    fn from(e: NetError) -> Self {
        SyncError::Net(e)
    }
}

impl From<CryptoError> for SyncError {
    fn from(e: CryptoError) -> Self {
        SyncError::Crypto(e)
    }
}
