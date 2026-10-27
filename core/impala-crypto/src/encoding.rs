//! Base64, Hex und SHA-256 wie in `web/sync-crypto.js`.

use base64::Engine;
use base64::alphabet::STANDARD;
use base64::engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig};
use sha2::{Digest, Sha256};

const ENCODER: GeneralPurpose = base64::engine::general_purpose::STANDARD;
/// Nachsichtig wie `atob`: Padding optional, überzählige Bits im letzten Zeichen erlaubt.
const DECODER: GeneralPurpose = GeneralPurpose::new(
    &STANDARD,
    GeneralPurposeConfig::new()
        .with_decode_padding_mode(DecodePaddingMode::Indifferent)
        .with_decode_allow_trailing_bits(true),
);

/// Standard-Base64 mit Padding (`btoa`).
pub fn base64_encode(bytes: &[u8]) -> String {
    ENCODER.encode(bytes)
}

/// Base64 wie `atob`: ASCII-Leerraum wird ignoriert. `None` bei ungültigen Zeichen.
pub fn base64_decode(text: &str) -> Option<Vec<u8>> {
    if text.bytes().any(|b| matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'\x0c')) {
        let clean: String = text.chars().filter(|c| !matches!(c, ' ' | '\t' | '\n' | '\r' | '\x0c')).collect();
        return DECODER.decode(clean).ok();
    }
    DECODER.decode(text).ok()
}

/// Kleinbuchstaben-Hex.
pub fn hex_encode(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(DIGITS[usize::from(b >> 4)] as char);
        out.push(DIGITS[usize::from(b & 15)] as char);
    }
    out
}

/// Hex (beliebige Groß-/Kleinschreibung, Leerraum außen egal). `None` bei leerem Text,
/// ungerader Länge oder fremden Zeichen.
// Abweichung von JS: `hexToBytes` machte aus ungültigen Paaren still 0-Bytes (`parseInt` → NaN).
pub fn hex_decode(text: &str) -> Option<Vec<u8>> {
    let hex = text.trim().as_bytes();
    if hex.is_empty() || !hex.len().is_multiple_of(2) {
        return None;
    }
    let nibble = |c: u8| (c as char).to_digit(16).map(|d| d as u8);
    hex.chunks(2).map(|pair| Some(nibble(pair[0])? << 4 | nibble(pair[1])?)).collect()
}

pub fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

/// SHA-256 eines Textes (UTF-8) als Hex – `sha256Hex` in JS.
pub fn sha256_hex(text: &str) -> String {
    hex_encode(&sha256(text.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_like_atob() {
        assert_eq!(base64_encode(b"Impala"), "SW1wYWxh");
        assert_eq!(base64_decode("SW1w YWxh\n").unwrap(), b"Impala");
        assert_eq!(base64_decode("SW0").unwrap(), b"Im");
        assert_eq!(base64_decode("SW0=").unwrap(), b"Im");
        assert!(base64_decode("SW*=").is_none());
        assert!(base64_decode("S").is_none());
        assert_eq!(base64_decode("").unwrap(), b"");
    }

    #[test]
    fn hex_roundtrip() {
        assert_eq!(hex_encode(&[0, 15, 255]), "000fff");
        assert_eq!(hex_decode(" 000FfF ").unwrap(), [0, 15, 255]);
        assert!(hex_decode("abc").is_none());
        assert!(hex_decode("zz").is_none());
        assert!(hex_decode("").is_none());
    }
}
