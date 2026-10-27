//! AES-GCM-Pakete und Blob-Layout (`encryptPayload`, `encryptBlobRecord` in `web/sync-crypto.js`).

use std::io::Read;

use aes_gcm::Nonce;
use aes_gcm::aead::Aead;
use flate2::Compression;
use flate2::bufread::GzDecoder;
use flate2::write::GzEncoder;
use serde_json::{Map, Value};

use crate::encoding::{base64_decode, base64_encode, hex_decode, hex_encode};
use crate::{CipherKey, CryptoError, Random, json};

/// Ab dieser JSON-Größe (Bytes) wird vor dem Verschlüsseln gzip versucht.
pub const GZIP_THRESHOLD: usize = 16 * 1024;
const GZ_PREFIX: &str = "gz:";
const IV_LEN: usize = 12;

/// Verschlüsseltes Event-Paket, wie es zum Worker geht (dort ergänzt um `id`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncryptedPacket {
    /// 12-Byte-IV als Hex (24 Zeichen).
    pub iv: String,
    /// Base64-Ciphertext, mit `gz:` davor, wenn der Klartext gzip ist.
    pub data: String,
    /// Ciphertext- plus IV-Bytes (so rechnet auch der Server die Quota).
    pub size: u64,
}

/// Verschlüsselter Blob: IV geht als Header `X-Impala-IV`, die Bytes als Körper.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncryptedBlob {
    pub iv: String,
    pub bytes: Vec<u8>,
}

impl EncryptedBlob {
    pub fn size(&self) -> u64 {
        (self.bytes.len() + IV_LEN) as u64
    }
}

/// Entschlüsselter Blob.
#[derive(Debug, Clone, PartialEq)]
pub struct BlobRecord {
    pub id: String,
    /// Metadaten (Name, Typ …); `{}` wenn keine.
    pub meta: Value,
    pub data: Vec<u8>,
}

/// gzip (Standardstufe). Andere Bytes als `CompressionStream`, aber gleiches Format (RFC 1952):
/// Beide Seiten lesen nur, niemand vergleicht komprimierte Bytes.
pub fn gzip(bytes: &[u8]) -> Vec<u8> {
    use std::io::Write;
    let mut enc = GzEncoder::new(Vec::with_capacity(bytes.len() / 3 + 64), Compression::default());
    // In einen Vec zu schreiben schlägt nie fehl.
    let _ = enc.write_all(bytes);
    enc.finish().unwrap_or_default()
}

/// Liest genau ein gzip-Mitglied; Daten dahinter sind ein Fehler (wie `DecompressionStream`).
pub fn gunzip(bytes: &[u8]) -> Result<Vec<u8>, CryptoError> {
    let mut dec = GzDecoder::new(bytes);
    let mut out = Vec::with_capacity(bytes.len() * 3);
    dec.read_to_end(&mut out).map_err(|e| CryptoError::Gzip(e.to_string()))?;
    if !dec.into_inner().is_empty() {
        return Err(CryptoError::Gzip("Daten nach dem Ende".into()));
    }
    Ok(out)
}

/// AES-256-GCM mit frischem 12-Byte-IV. Liefert (IV als Hex, Ciphertext samt Tag).
pub fn encrypt_bytes(key: &CipherKey, plain: &[u8], rng: &dyn Random) -> Result<(String, Vec<u8>), CryptoError> {
    let mut iv = [0u8; IV_LEN];
    rng.fill(&mut iv)?;
    let ct = key.cipher.encrypt(Nonce::from_slice(&iv), plain).map_err(|_| CryptoError::Decrypt)?;
    Ok((hex_encode(&iv), ct))
}

pub fn decrypt_bytes(key: &CipherKey, iv_hex: &str, ciphertext: &[u8]) -> Result<Vec<u8>, CryptoError> {
    // Der Server lässt nur 24 Hex-Zeichen zu; WebCrypto nähme auch andere Längen.
    let iv = hex_decode(iv_hex).filter(|iv| iv.len() == IV_LEN).ok_or(CryptoError::InvalidPacket("IV"))?;
    key.cipher.decrypt(Nonce::from_slice(&iv), ciphertext).map_err(|_| CryptoError::Decrypt)
}

/// Verschlüsselt einen fertigen JSON-Text (`JSON.stringify(value)` → [`json::stringify`]).
pub fn encrypt_payload(key: &CipherKey, json_text: &str, rng: &dyn Random) -> Result<EncryptedPacket, CryptoError> {
    let raw = json_text.as_bytes();
    let packed = (raw.len() >= GZIP_THRESHOLD).then(|| gzip(raw)).filter(|p| p.len() < raw.len());
    let (prefix, plain) = match &packed {
        Some(p) => (GZ_PREFIX, p.as_slice()),
        None => ("", raw),
    };
    let (iv, ct) = encrypt_bytes(key, plain, rng)?;
    let size = (ct.len() + IV_LEN) as u64;
    Ok(EncryptedPacket { iv, data: format!("{prefix}{}", base64_encode(&ct)), size })
}

/// Entschlüsselt ein Paket und liefert den JSON-Klartext (Bytes, noch nicht geparst).
pub fn decrypt_payload(key: &CipherKey, iv: &str, data: &str) -> Result<Vec<u8>, CryptoError> {
    if iv.is_empty() || data.is_empty() {
        return Err(CryptoError::InvalidPacket("IV oder Daten fehlen"));
    }
    let (gz, b64) = match data.strip_prefix(GZ_PREFIX) {
        Some(rest) => (true, rest),
        None => (false, data),
    };
    let ct = base64_decode(b64).ok_or(CryptoError::InvalidPacket("Base64"))?;
    let plain = decrypt_bytes(key, iv, &ct)?;
    if gz { gunzip(&plain) } else { Ok(plain) }
}

/// Wie `record?.meta || {}`.
fn meta_or_empty(meta: Option<&Value>) -> Value {
    match meta {
        None | Some(Value::Null | Value::Bool(false)) => Value::Object(Map::new()),
        Some(Value::String(s)) if s.is_empty() => Value::Object(Map::new()),
        Some(Value::Number(n)) if n.as_f64() == Some(0.0) => Value::Object(Map::new()),
        Some(v) => v.clone(),
    }
}

/// Blob-Layout vor AES-GCM: `u32 BE Headerlänge | JSON({id, meta}) | Rohbytes`.
pub fn encrypt_blob(
    key: &CipherKey,
    id: &str,
    meta: Option<&Value>,
    data: &[u8],
    rng: &dyn Random,
) -> Result<EncryptedBlob, CryptoError> {
    let mut header = String::from("{\"id\":");
    json::write_string(&mut header, id);
    header.push_str(",\"meta\":");
    json::write_value(&mut header, &meta_or_empty(meta));
    header.push('}');
    let header_len = u32::try_from(header.len()).map_err(|_| CryptoError::InvalidBlob("Header zu groß"))?;
    let mut packed = Vec::with_capacity(4 + header.len() + data.len());
    packed.extend_from_slice(&header_len.to_be_bytes());
    packed.extend_from_slice(header.as_bytes());
    packed.extend_from_slice(data);
    let (iv, bytes) = encrypt_bytes(key, &packed, rng)?;
    Ok(EncryptedBlob { iv, bytes })
}

pub fn decrypt_blob(key: &CipherKey, iv: &str, ciphertext: &[u8]) -> Result<BlobRecord, CryptoError> {
    let mut packed = decrypt_bytes(key, iv, ciphertext)?;
    let len_bytes: [u8; 4] =
        packed.get(..4).and_then(|b| b.try_into().ok()).ok_or(CryptoError::InvalidBlob("zu kurz"))?;
    let header_len = u32::from_be_bytes(len_bytes) as usize;
    if header_len < 2 || header_len > packed.len() - 4 {
        return Err(CryptoError::InvalidBlob("Header-Länge"));
    }
    let header: Value =
        serde_json::from_slice(&packed[4..4 + header_len]).map_err(|_| CryptoError::InvalidBlob("Header"))?;
    // Abweichung von JS: Eine ID, die kein Text ist, lehnt Rust ab (JS übernahm sie roh).
    let id = match header.get("id") {
        Some(Value::String(id)) if !id.is_empty() => id.clone(),
        _ => return Err(CryptoError::InvalidBlob("Blob-ID fehlt")),
    };
    let meta = meta_or_empty(header.get("meta"));
    let data = packed.split_off(4 + header_len);
    Ok(BlobRecord { id, meta, data })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::CounterRandom;

    fn key() -> CipherKey {
        CipherKey::from_bytes([9; 32])
    }

    #[test]
    fn payload_roundtrip_small_and_gzip() {
        let rng = CounterRandom::new(0);
        let small = r#"{"v":4,"events":[]}"#;
        let p = encrypt_payload(&key(), small, &rng).unwrap();
        assert_eq!(p.iv, "000102030405060708090a0b");
        assert!(!p.data.starts_with("gz:"));
        assert_eq!(p.size as usize, small.len() + 16 + 12);
        assert_eq!(decrypt_payload(&key(), &p.iv, &p.data).unwrap(), small.as_bytes());

        let big = format!("{{\"x\":\"{}\"}}", "a".repeat(GZIP_THRESHOLD));
        let p = encrypt_payload(&key(), &big, &rng).unwrap();
        assert!(p.data.starts_with("gz:"));
        assert_eq!(decrypt_payload(&key(), &p.iv, &p.data).unwrap(), big.as_bytes());
    }

    #[test]
    fn rejects_bad_packets() {
        let rng = CounterRandom::new(0);
        let p = encrypt_payload(&key(), "{}", &rng).unwrap();
        assert_eq!(decrypt_payload(&CipherKey::from_bytes([1; 32]), &p.iv, &p.data), Err(CryptoError::Decrypt));
        assert!(decrypt_payload(&key(), "", &p.data).is_err());
        assert!(decrypt_payload(&key(), "00", &p.data).is_err());
        assert!(decrypt_payload(&key(), &p.iv, "gz:%%").is_err());
        let mut tampered = base64_decode(&p.data).unwrap();
        tampered[0] ^= 1;
        assert_eq!(decrypt_payload(&key(), &p.iv, &base64_encode(&tampered)), Err(CryptoError::Decrypt));
    }

    #[test]
    fn blob_roundtrip_and_layout_checks() {
        let rng = CounterRandom::new(0);
        let meta: Value = serde_json::from_str(r#"{"name":"a.png","size":3}"#).unwrap();
        let b = encrypt_blob(&key(), "img:1", Some(&meta), &[1, 2, 3], &rng).unwrap();
        let r = decrypt_blob(&key(), &b.iv, &b.bytes).unwrap();
        assert_eq!((r.id.as_str(), &r.meta, r.data.as_slice()), ("img:1", &meta, &[1u8, 2, 3][..]));
        let b = encrypt_blob(&key(), "x", Some(&Value::Null), &[], &rng).unwrap();
        assert_eq!(decrypt_blob(&key(), &b.iv, &b.bytes).unwrap().meta, serde_json::json!({}));

        for plain in [vec![0u8, 0], vec![0, 0, 0, 9, b'{'], [0, 0, 0, 2].iter().chain(b"{}").copied().collect()] {
            let (iv, ct) = encrypt_bytes(&key(), &plain, &rng).unwrap();
            assert!(matches!(decrypt_blob(&key(), &iv, &ct), Err(CryptoError::InvalidBlob(_))));
        }
    }

    #[test]
    fn gunzip_rejects_trailing_data() {
        let mut gz = gzip(b"hallo");
        assert_eq!(gunzip(&gz).unwrap(), b"hallo");
        gz.push(0);
        assert!(gunzip(&gz).is_err());
        assert!(gunzip(b"kein gzip").is_err());
    }
}
