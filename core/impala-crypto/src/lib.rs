//! Ende-zu-Ende-Verschlüsselung des Cloudflare-Syncs (gleiches Format wie `web/sync-crypto.js`).
//!
//! - [`SyncKey`] → [`SyncCredentials`]: User-ID, Auth-Token und AES-256-GCM-Schlüssel (PBKDF2).
//! - Event-Pakete: JSON-Text → (gzip ab 16 KB, Präfix `gz:`) → AES-GCM → Base64 ([`encrypt_payload`]).
//! - Blobs: `u32 BE Headerlänge | JSON {id, meta} | Rohbytes` → AES-GCM ([`encrypt_blob`]).
//! - [`SecureStore`]: Ablage für Geheimnisse (Sync-Schlüssel, KI-Schlüssel); Plattformen setzen
//!   Keychain/Keystore/DPAPI/libsecret ein, Standard ist ein verschlüsselter Tresor.
//!
//! Zufall (IVs, Schlüssel, Salze) kommt immer über [`Random`], damit Tests deterministisch sind.
//! Drive nutzt keine eigene Verschlüsselung (nur gzip, siehe [`gzip`]).

mod encoding;
pub mod json;
mod key;
mod packet;
mod random;
mod store;
mod usage;

use std::fmt;

pub use encoding::{base64_decode, base64_encode, hex_decode, hex_encode, sha256, sha256_hex};
pub use key::{CipherKey, SyncCredentials, SyncKey};
pub use packet::{
    BlobRecord, EncryptedBlob, EncryptedPacket, GZIP_THRESHOLD, decrypt_blob, decrypt_bytes, decrypt_payload,
    encrypt_blob, encrypt_bytes, encrypt_payload, gunzip, gzip,
};
pub use random::{CounterRandom, OsRandom, Random};
#[cfg(feature = "file-store")]
pub use store::EncryptedFileStore;
pub use store::{MemoryStore, SecureStore, StoreError, Vault, VaultKey};
pub use usage::{MAX_USER_STORAGE_BYTES, StorageUsage, format_storage_usage};

/// Fehler der Krypto-Schicht. Fremde Eingaben (Netz, alte Daten) führen nie zu einer Panik.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CryptoError {
    /// Sync-Schlüssel hat nicht die Form `impala-xxxx-…` (8 Gruppen à 4 Hex-Zeichen).
    InvalidSyncKey,
    /// Paket ohne IV/Daten, kaputtes Base64 oder Hex, falsche IV-Länge.
    InvalidPacket(&'static str),
    /// Authentifizierung fehlgeschlagen: falscher Schlüssel oder veränderte Daten.
    Decrypt,
    /// gzip-Daten unlesbar.
    Gzip(String),
    /// Blob-Datensatz zu kurz, Header kaputt oder ohne ID.
    InvalidBlob(&'static str),
    /// Zufallsquelle nicht verfügbar.
    Random(String),
}

impl fmt::Display for CryptoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CryptoError::InvalidSyncKey => {
                f.write_str("Ungültiger Sync-Schlüssel. Bitte einen neuen 128-Bit-Schlüssel erzeugen.")
            }
            CryptoError::InvalidPacket(what) => write!(f, "Ungültiges Verschlüsselungspaket ({what})."),
            CryptoError::Decrypt => {
                f.write_str("Entschlüsselung fehlgeschlagen (falscher Schlüssel oder beschädigte Daten).")
            }
            CryptoError::Gzip(m) => write!(f, "gzip-Daten unlesbar: {m}"),
            CryptoError::InvalidBlob(what) => write!(f, "Ungültiger Blob-Datensatz ({what})."),
            CryptoError::Random(m) => write!(f, "Zufallsquelle nicht verfügbar: {m}"),
        }
    }
}

impl std::error::Error for CryptoError {}
