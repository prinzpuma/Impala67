//! Sync-Schlüssel und daraus abgeleitete Zugangsdaten (`generateSyncKey`, `deriveSyncCredentials`).

use std::fmt;

use aes_gcm::aead::KeyInit;
use aes_gcm::{Aes256Gcm, Key};

use crate::encoding::{hex_encode, sha256, sha256_hex};
use crate::{CryptoError, Random};

/// PBKDF2-Runden der Sync-Schlüsselableitung (Format, nicht ändern).
pub const SYNC_KEY_ITERATIONS: u32 = 100_000;

/// Geprüfter Sync-Schlüssel `impala-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx` (128 Bit).
/// Die Schreibweise bleibt erhalten: Sie geht unverändert in die Ableitung ein.
#[derive(Clone, PartialEq, Eq)]
pub struct SyncKey(String);

impl SyncKey {
    /// Prüft wie `SYNC_KEY_RE` (Groß-/Kleinschreibung egal, Leerraum außen entfernt).
    pub fn parse(text: &str) -> Result<SyncKey, CryptoError> {
        // JS `trim()` entfernt zusätzlich U+FEFF.
        let clean = text.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
        let valid = clean.len() == 46
            && clean.is_ascii()
            && clean[..7].eq_ignore_ascii_case("impala-")
            && clean[7..].split('-').count() == 8
            && clean[7..].split('-').all(|g| g.len() == 4 && g.bytes().all(|b| b.is_ascii_hexdigit()));
        if valid { Ok(SyncKey(clean.to_owned())) } else { Err(CryptoError::InvalidSyncKey) }
    }

    /// Neuer Schlüssel aus 16 Zufallsbytes.
    pub fn generate(rng: &dyn Random) -> Result<SyncKey, CryptoError> {
        let mut bytes = [0u8; 16];
        rng.fill(&mut bytes)?;
        let hex = hex_encode(&bytes);
        let groups: Vec<&str> = (0..8).map(|i| &hex[i * 4..i * 4 + 4]).collect();
        Ok(SyncKey(format!("impala-{}", groups.join("-"))))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// User-ID, Auth-Token und AES-Schlüssel. Teuer (100 000 PBKDF2-Runden): einmal je Schlüssel.
    pub fn derive(&self) -> SyncCredentials {
        let key = &self.0;
        let salt = sha256(format!("impala67_e2ee_salt:{key}").as_bytes());
        let mut raw = [0u8; 32];
        pbkdf2::pbkdf2_hmac::<sha2::Sha256>(key.as_bytes(), &salt, SYNC_KEY_ITERATIONS, &mut raw);
        SyncCredentials {
            user_id: sha256_hex(&format!("impala67_user_partition:{key}")),
            auth_token: sha256_hex(&format!("impala67_auth_token:{key}")),
            key: CipherKey::from_bytes(raw),
        }
    }
}

impl fmt::Debug for SyncKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SyncKey(…)")
    }
}

/// Zugangsdaten zum Cloudflare-Worker plus E2EE-Schlüssel.
#[derive(Clone)]
pub struct SyncCredentials {
    /// Partition auf dem Server (64 Hex-Zeichen).
    pub user_id: String,
    /// Bearer-Token (64 Hex-Zeichen); der Server speichert nur seinen Hash.
    pub auth_token: String,
    pub key: CipherKey,
}

impl fmt::Debug for SyncCredentials {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SyncCredentials").field("user_id", &self.user_id).finish_non_exhaustive()
    }
}

/// AES-256-GCM-Schlüssel (Schlüsselplan einmal berechnet).
#[derive(Clone)]
pub struct CipherKey {
    pub(crate) cipher: Aes256Gcm,
    raw: [u8; 32],
}

impl CipherKey {
    pub fn from_bytes(raw: [u8; 32]) -> CipherKey {
        CipherKey { cipher: Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&raw)), raw }
    }

    /// Rohschlüssel – nur für Plattform-Tresore (WebCrypto hält ihn nicht exportierbar).
    pub fn to_bytes(&self) -> [u8; 32] {
        self.raw
    }
}

impl fmt::Debug for CipherKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("CipherKey(…)")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::CounterRandom;

    #[test]
    fn validates_like_js() {
        let ok = "impala-0123-4567-89ab-cdef-0123-4567-89AB-CDEF";
        assert_eq!(SyncKey::parse(&format!("  {ok}\n")).unwrap().as_str(), ok);
        assert!(SyncKey::parse("IMPALA-0123-4567-89ab-cdef-0123-4567-89ab-cdef").is_ok());
        for bad in ["", "impala-0123", "impala-0123-4567-89ab-cdef-0123-4567-89ab-cdeg", &format!("{ok}-0000")] {
            assert_eq!(SyncKey::parse(bad), Err(CryptoError::InvalidSyncKey), "{bad}");
        }
        assert!(SyncKey::parse("impalä-0123-4567-89ab-cdef-0123-4567-89ab-cde").is_err());
    }

    #[test]
    fn generates_grouped_hex() {
        let key = SyncKey::generate(&CounterRandom::new(7)).unwrap();
        assert_eq!(key.as_str(), "impala-0708-090a-0b0c-0d0e-0f10-1112-1314-1516");
        assert!(SyncKey::parse(key.as_str()).is_ok());
    }
}
