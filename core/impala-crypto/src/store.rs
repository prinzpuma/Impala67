//! Ablage für Geheimnisse (Sync-Schlüssel, KI-API-Schlüssel).
//!
//! Plattformen setzen ihren Systemtresor ein (Keychain, Keystore, DPAPI, libsecret). Standard ist
//! ein [`Vault`]: alle Einträge als JSON, mit AES-256-GCM versiegelt. Der Schlüssel kommt aus
//! einem Passwort (PBKDF2-SHA256, 600 000 Runden nach OWASP 2023, zufälliges Salz) oder ist ein
//! Geräteschlüssel, den die Plattform sicher hält (z. B. TPM-/DPAPI-geschützt). Ohne eins von
//! beiden wäre Verschlüsselung nur Verschleierung – darum verlangt der Tresor immer einen
//! [`VaultKey`]. Format, KDF-Parameter und Salz gehen als AAD ein: Wer die Datei verändert
//! (etwa die Rundenzahl senkt), bricht die Authentifizierung.
//!
//! [`Vault`] ist rein (Bytes rein/raus, auch für WASM → IndexedDB); [`EncryptedFileStore`]
//! (Feature `file-store`) legt ihn als Datei ab.

use std::collections::{BTreeMap, HashMap};
use std::fmt;
use std::sync::Mutex;

use serde_json::{Map, Value, json};

use crate::encoding::{base64_decode, base64_encode};
use crate::{CipherKey, CryptoError, Random};

const FORMAT: &str = "impala67-vault";
const VERSION: u64 = 1;
const SALT_LEN: usize = 16;
pub const VAULT_PASSWORD_ITERATIONS: u32 = 600_000;

pub trait SecureStore: Send + Sync {
    fn get(&self, name: &str) -> Result<Option<String>, StoreError>;
    fn set(&self, name: &str, value: &str) -> Result<(), StoreError>;
    fn delete(&self, name: &str) -> Result<(), StoreError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoreError {
    Io(String),
    /// Datei ist kein lesbarer Tresor.
    Corrupt(&'static str),
    /// Falsches Passwort bzw. falscher Geräteschlüssel (oder Datei manipuliert).
    WrongKey,
    Crypto(CryptoError),
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StoreError::Io(m) => write!(f, "Tresor nicht lesbar/schreibbar: {m}"),
            StoreError::Corrupt(what) => write!(f, "Tresor beschädigt ({what})."),
            StoreError::WrongKey => f.write_str("Falsches Passwort oder Tresor verändert."),
            StoreError::Crypto(e) => e.fmt(f),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<CryptoError> for StoreError {
    fn from(e: CryptoError) -> Self {
        StoreError::Crypto(e)
    }
}

/// Woher der Tresorschlüssel kommt.
#[derive(Clone)]
pub enum VaultKey {
    Password { password: String, iterations: u32 },
    Device([u8; 32]),
}

impl VaultKey {
    pub fn password(password: impl Into<String>) -> VaultKey {
        VaultKey::Password { password: password.into(), iterations: VAULT_PASSWORD_ITERATIONS }
    }
}

impl fmt::Debug for VaultKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            VaultKey::Password { iterations, .. } => write!(f, "VaultKey::Password(…, {iterations})"),
            VaultKey::Device(_) => f.write_str("VaultKey::Device(…)"),
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
enum Kdf {
    Device,
    Pbkdf2 { salt: Vec<u8>, iterations: u32 },
}

impl Kdf {
    fn aad(&self) -> String {
        match self {
            Kdf::Device => format!("{FORMAT}:{VERSION}:device"),
            Kdf::Pbkdf2 { salt, iterations } => {
                format!("{FORMAT}:{VERSION}:pbkdf2-sha256:{iterations}:{}", base64_encode(salt))
            }
        }
    }

    fn derive(&self, key: &VaultKey) -> Result<CipherKey, StoreError> {
        match (self, key) {
            (Kdf::Device, VaultKey::Device(raw)) => Ok(CipherKey::from_bytes(*raw)),
            (Kdf::Pbkdf2 { salt, iterations }, VaultKey::Password { password, .. }) => {
                let mut raw = [0u8; 32];
                pbkdf2::pbkdf2_hmac::<sha2::Sha256>(password.as_bytes(), salt, *iterations, &mut raw);
                Ok(CipherKey::from_bytes(raw))
            }
            _ => Err(StoreError::WrongKey),
        }
    }
}

/// Entschlüsselter Tresor im Speicher.
pub struct Vault {
    entries: BTreeMap<String, String>,
    kdf: Kdf,
    cipher: CipherKey,
}

impl Vault {
    /// Leerer Tresor (Passwort: neues Zufallssalz).
    pub fn create(key: &VaultKey, rng: &dyn Random) -> Result<Vault, StoreError> {
        let kdf = match key {
            VaultKey::Device(_) => Kdf::Device,
            VaultKey::Password { iterations, .. } => {
                let mut salt = vec![0u8; SALT_LEN];
                rng.fill(&mut salt)?;
                Kdf::Pbkdf2 { salt, iterations: (*iterations).max(1) }
            }
        };
        let cipher = kdf.derive(key)?;
        Ok(Vault { entries: BTreeMap::new(), kdf, cipher })
    }

    pub fn open(sealed: &[u8], key: &VaultKey) -> Result<Vault, StoreError> {
        let file: Value = serde_json::from_slice(sealed).map_err(|_| StoreError::Corrupt("kein JSON"))?;
        if file["format"] != FORMAT || file["v"] != VERSION {
            return Err(StoreError::Corrupt("unbekanntes Format"));
        }
        let kdf = match file["kdf"].as_str() {
            Some("device") => Kdf::Device,
            Some("pbkdf2-sha256") => Kdf::Pbkdf2 {
                salt: file["salt"].as_str().and_then(base64_decode).ok_or(StoreError::Corrupt("Salz"))?,
                iterations: file["iterations"]
                    .as_u64()
                    .and_then(|n| u32::try_from(n).ok())
                    .filter(|n| *n > 0)
                    .ok_or(StoreError::Corrupt("Runden"))?,
            },
            _ => return Err(StoreError::Corrupt("KDF")),
        };
        let iv = file["iv"].as_str().ok_or(StoreError::Corrupt("IV"))?;
        let data = file["data"].as_str().and_then(base64_decode).ok_or(StoreError::Corrupt("Daten"))?;
        let cipher = kdf.derive(key)?;
        let plain = decrypt_with_aad(&cipher, iv, &data, kdf.aad().as_bytes())?;
        let entries: BTreeMap<String, String> =
            serde_json::from_slice(&plain).map_err(|_| StoreError::Corrupt("Einträge"))?;
        Ok(Vault { entries, kdf, cipher })
    }

    /// Versiegelt mit frischem IV (gleiches Salz, damit kein erneutes PBKDF2 nötig ist).
    pub fn seal(&self, rng: &dyn Random) -> Result<Vec<u8>, StoreError> {
        let plain = serde_json::to_vec(&self.entries).map_err(|_| StoreError::Corrupt("Einträge"))?;
        let (iv, ct) = encrypt_with_aad(&self.cipher, &plain, self.kdf.aad().as_bytes(), rng)?;
        let mut file = Map::new();
        file.insert("format".into(), json!(FORMAT));
        file.insert("v".into(), json!(VERSION));
        match &self.kdf {
            Kdf::Device => {
                file.insert("kdf".into(), json!("device"));
            }
            Kdf::Pbkdf2 { salt, iterations } => {
                file.insert("kdf".into(), json!("pbkdf2-sha256"));
                file.insert("iterations".into(), json!(iterations));
                file.insert("salt".into(), json!(base64_encode(salt)));
            }
        }
        file.insert("iv".into(), json!(iv));
        file.insert("data".into(), json!(base64_encode(&ct)));
        serde_json::to_vec_pretty(&Value::Object(file)).map_err(|_| StoreError::Corrupt("Datei"))
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.entries.get(name).map(String::as_str)
    }

    pub fn set(&mut self, name: &str, value: &str) {
        self.entries.insert(name.to_owned(), value.to_owned());
    }

    pub fn remove(&mut self, name: &str) -> bool {
        self.entries.remove(name).is_some()
    }

    pub fn names(&self) -> impl Iterator<Item = &str> {
        self.entries.keys().map(String::as_str)
    }
}

fn encrypt_with_aad(
    key: &CipherKey,
    plain: &[u8],
    aad: &[u8],
    rng: &dyn Random,
) -> Result<(String, Vec<u8>), CryptoError> {
    use aes_gcm::aead::{Aead, Payload};
    let mut iv = [0u8; 12];
    rng.fill(&mut iv)?;
    let ct = key
        .cipher
        .encrypt(aes_gcm::Nonce::from_slice(&iv), Payload { msg: plain, aad })
        .map_err(|_| CryptoError::Decrypt)?;
    Ok((crate::hex_encode(&iv), ct))
}

fn decrypt_with_aad(key: &CipherKey, iv_hex: &str, ct: &[u8], aad: &[u8]) -> Result<Vec<u8>, StoreError> {
    use aes_gcm::aead::{Aead, Payload};
    let iv = crate::hex_decode(iv_hex).filter(|iv| iv.len() == 12).ok_or(StoreError::Corrupt("IV"))?;
    key.cipher.decrypt(aes_gcm::Nonce::from_slice(&iv), Payload { msg: ct, aad }).map_err(|_| StoreError::WrongKey)
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Flüchtige Ablage (Tests, Plattformen ohne Tresor für die Dauer einer Sitzung).
#[derive(Default)]
pub struct MemoryStore(Mutex<HashMap<String, String>>);

impl SecureStore for MemoryStore {
    fn get(&self, name: &str) -> Result<Option<String>, StoreError> {
        Ok(lock(&self.0).get(name).cloned())
    }
    fn set(&self, name: &str, value: &str) -> Result<(), StoreError> {
        lock(&self.0).insert(name.to_owned(), value.to_owned());
        Ok(())
    }
    fn delete(&self, name: &str) -> Result<(), StoreError> {
        lock(&self.0).remove(name);
        Ok(())
    }
}

#[cfg(feature = "file-store")]
pub use file::EncryptedFileStore;

#[cfg(feature = "file-store")]
mod file {
    use std::fs;
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;

    use super::{SecureStore, StoreError, Vault, VaultKey, lock};
    use crate::{OsRandom, Random};

    /// [`Vault`] als Datei. Jede Änderung schreibt die ganze Datei neu (temporär + umbenennen,
    /// damit ein Absturz nie einen halben Tresor hinterlässt); unter Unix nur für den Besitzer lesbar.
    pub struct EncryptedFileStore {
        path: PathBuf,
        vault: Mutex<Vault>,
        rng: Box<dyn Random>,
    }

    impl EncryptedFileStore {
        /// Öffnet die Datei oder legt beim ersten Schreiben eine neue an.
        pub fn open(path: impl Into<PathBuf>, key: &VaultKey) -> Result<Self, StoreError> {
            Self::open_with_rng(path, key, Box::new(OsRandom))
        }

        pub fn open_with_rng(
            path: impl Into<PathBuf>,
            key: &VaultKey,
            rng: Box<dyn Random>,
        ) -> Result<Self, StoreError> {
            let path = path.into();
            let vault = match fs::read(&path) {
                Ok(bytes) => Vault::open(&bytes, key)?,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vault::create(key, rng.as_ref())?,
                Err(e) => return Err(StoreError::Io(e.to_string())),
            };
            Ok(EncryptedFileStore { path, vault: Mutex::new(vault), rng })
        }

        fn update(&self, change: impl FnOnce(&mut Vault) -> bool) -> Result<(), StoreError> {
            let mut vault = lock(&self.vault);
            if change(&mut vault) {
                write_atomic(&self.path, &vault.seal(self.rng.as_ref())?)?;
            }
            Ok(())
        }
    }

    fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), StoreError> {
        let io = |e: std::io::Error| StoreError::Io(e.to_string());
        let mut tmp = path.as_os_str().to_owned();
        tmp.push(".tmp");
        let tmp = PathBuf::from(tmp);
        let mut options = fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        let mut file = options.open(&tmp).map_err(io)?;
        file.write_all(bytes).map_err(io)?;
        file.sync_all().map_err(io)?;
        drop(file);
        fs::rename(&tmp, path).map_err(io)
    }

    impl SecureStore for EncryptedFileStore {
        fn get(&self, name: &str) -> Result<Option<String>, StoreError> {
            Ok(lock(&self.vault).get(name).map(str::to_owned))
        }
        fn set(&self, name: &str, value: &str) -> Result<(), StoreError> {
            self.update(|v| {
                let changed = v.get(name) != Some(value);
                v.set(name, value);
                changed
            })
        }
        fn delete(&self, name: &str) -> Result<(), StoreError> {
            self.update(|v| v.remove(name))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::CounterRandom;

    fn pw() -> VaultKey {
        VaultKey::Password { password: "geheim".into(), iterations: 10 }
    }

    #[test]
    fn vault_roundtrip_and_wrong_key() {
        let rng = CounterRandom::new(0);
        let mut v = Vault::create(&pw(), &rng).unwrap();
        v.set("sync-key", "impala-…");
        v.set("ai:groq", "gsk_1");
        let sealed = v.seal(&rng).unwrap();
        let text = String::from_utf8(sealed.clone()).unwrap();
        assert!(!text.contains("gsk_1") && text.contains("pbkdf2-sha256"));
        let opened = Vault::open(&sealed, &pw()).unwrap();
        assert_eq!(opened.get("ai:groq"), Some("gsk_1"));
        assert_eq!(opened.names().collect::<Vec<_>>(), ["ai:groq", "sync-key"]);
        let wrong = VaultKey::Password { password: "falsch".into(), iterations: 10 };
        assert_eq!(Vault::open(&sealed, &wrong).err(), Some(StoreError::WrongKey));
        assert_eq!(Vault::open(&sealed, &VaultKey::Device([0; 32])).err(), Some(StoreError::WrongKey));
        // Weniger Runden in die Datei schreiben bricht die Authentifizierung.
        let downgraded = text.replace("\"iterations\": 10", "\"iterations\": 1");
        assert_eq!(Vault::open(downgraded.as_bytes(), &pw()).err(), Some(StoreError::WrongKey));
        assert!(matches!(Vault::open(b"{}", &pw()), Err(StoreError::Corrupt(_))));
    }

    #[test]
    fn device_key_vault() {
        let rng = CounterRandom::new(5);
        let key = VaultKey::Device([3; 32]);
        let mut v = Vault::create(&key, &rng).unwrap();
        v.set("a", "b");
        let opened = Vault::open(&v.seal(&rng).unwrap(), &key).unwrap();
        assert_eq!(opened.get("a"), Some("b"));
    }

    #[test]
    fn memory_store() {
        let s = MemoryStore::default();
        s.set("k", "v").unwrap();
        assert_eq!(s.get("k").unwrap().as_deref(), Some("v"));
        s.delete("k").unwrap();
        assert_eq!(s.get("k").unwrap(), None);
    }

    #[cfg(feature = "file-store")]
    #[test]
    fn file_store_persists() {
        let dir = std::env::temp_dir().join(format!("impala-crypto-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("vault.json");
        let _ = std::fs::remove_file(&path);
        {
            let s = EncryptedFileStore::open_with_rng(&path, &pw(), Box::new(CounterRandom::new(1))).unwrap();
            assert_eq!(s.get("x").unwrap(), None);
            s.set("x", "1").unwrap();
            s.set("y", "2").unwrap();
            s.delete("y").unwrap();
        }
        let s = EncryptedFileStore::open(&path, &pw()).unwrap();
        assert_eq!((s.get("x").unwrap().as_deref(), s.get("y").unwrap()), (Some("1"), None));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        assert!(EncryptedFileStore::open(&path, &VaultKey::Device([0; 32])).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
