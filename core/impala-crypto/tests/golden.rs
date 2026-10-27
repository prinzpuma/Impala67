//! Vergleich mit der letzten JS-Fassung von `web/sync-crypto.js` (eingefrorenes Golden-File; die
//! JS-Verschlüsselung wurde durch den Rust-Kern ersetzt).
//! Rust muss lesen, was JS verschlüsselt hat, und mit gleichem IV dieselben Bytes erzeugen.

use std::sync::OnceLock;

use impala_crypto::*;
use serde_json::{Value, json};

fn golden() -> &'static Value {
    static G: OnceLock<Value> = OnceLock::new();
    G.get_or_init(|| {
        let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/crypto.json")).unwrap();
        serde_json::from_str(&text).unwrap()
    })
}

fn s(v: &Value) -> &str {
    v.as_str().unwrap()
}

/// Schlüssel des ersten Golden-Sync-Schlüssels (PBKDF2 nur einmal, im Debug-Build teuer).
fn creds() -> &'static SyncCredentials {
    static C: OnceLock<SyncCredentials> = OnceLock::new();
    C.get_or_init(|| SyncKey::parse(s(&golden()["keys"][0]["syncKey"])).unwrap().derive())
}

#[test]
fn encodings_match_js() {
    for case in golden()["encoding"].as_array().unwrap() {
        let bytes: Vec<u8> = case["bytes"].as_array().unwrap().iter().map(|b| b.as_u64().unwrap() as u8).collect();
        assert_eq!(base64_encode(&bytes), s(&case["base64"]));
        assert_eq!(hex_encode(&bytes), s(&case["hex"]));
        assert_eq!(base64_decode(s(&case["base64"])).unwrap(), bytes);
    }
    for case in golden()["sha256"].as_array().unwrap() {
        assert_eq!(sha256_hex(s(&case["text"])), s(&case["hex"]));
    }
}

#[test]
fn derives_same_credentials() {
    for (i, case) in golden()["keys"].as_array().unwrap().iter().enumerate() {
        let c = if i == 0 { creds().clone() } else { SyncKey::parse(s(&case["syncKey"])).unwrap().derive() };
        assert_eq!(c.user_id, s(&case["userId"]));
        assert_eq!(c.auth_token, s(&case["authToken"]));
        assert_eq!(hex_encode(&c.key.to_bytes()), s(&case["rawKey"]));
    }
    for bad in golden()["invalidKeys"].as_array().unwrap() {
        assert_eq!(SyncKey::parse(s(bad)), Err(CryptoError::InvalidSyncKey), "{bad}");
    }
    let g = &golden()["generatedKey"];
    let key = SyncKey::generate(&CounterRandom::new(g["counterStart"].as_u64().unwrap() as u8)).unwrap();
    assert_eq!(key.as_str(), s(&g["key"]));
}

#[test]
fn packets_match_js() {
    let key = &creds().key;
    for p in golden()["packets"].as_array().unwrap() {
        let (text, iv, data) = (s(&p["json"]), s(&p["iv"]), s(&p["data"]));
        // Rust liest JS …
        assert_eq!(decrypt_payload(key, iv, data).unwrap(), text.as_bytes());
        // … serialisiert wie JSON.stringify …
        assert_eq!(json::stringify(&serde_json::from_str(text).unwrap()), text);
        // … und verschlüsselt mit gleichem IV dieselben Bytes.
        let rng = || CounterRandom::new(p["counterStart"].as_u64().unwrap() as u8);
        let ours = encrypt_payload(key, text, &rng()).unwrap();
        assert_eq!(ours.iv, iv);
        match data.strip_prefix("gz:") {
            None => assert_eq!((ours.data.as_str(), ours.size), (data, p["size"].as_u64().unwrap())),
            Some(b64) => {
                // gzip-Bytes unterscheiden sich (anderer Kompressor); dieselbe Entscheidung und
                // derselbe Ciphertext über JS' gzip-Bytes genügen.
                assert!(ours.data.starts_with("gz:"));
                let js_gz = decrypt_bytes(key, iv, &base64_decode(b64).unwrap()).unwrap();
                let (_, ct) = encrypt_bytes(key, &js_gz, &rng()).unwrap();
                assert_eq!(base64_encode(&ct), b64);
            }
        }
    }
}

#[test]
fn blobs_match_js() {
    let key = &creds().key;
    for b in golden()["blobs"].as_array().unwrap() {
        let ct = base64_decode(s(&b["bytes"])).unwrap();
        let record = decrypt_blob(key, s(&b["iv"]), &ct).unwrap();
        assert_eq!(record.id, s(&b["id"]));
        assert_eq!(record.meta, b["meta"]);
        assert_eq!(base64_encode(&record.data), s(&b["data"]));
        let rng = CounterRandom::new(b["counterStart"].as_u64().unwrap() as u8);
        let ours = encrypt_blob(key, &record.id, Some(&record.meta), &record.data, &rng).unwrap();
        assert_eq!((ours.iv.as_str(), &ours.bytes, ours.size()), (s(&b["iv"]), &ct, b["size"].as_u64().unwrap()));
    }
}

#[test]
fn reads_js_gzip() {
    for g in golden()["gzip"].as_array().unwrap() {
        assert_eq!(gunzip(&base64_decode(s(&g["gz"])).unwrap()).unwrap(), s(&g["text"]).as_bytes());
    }
}

#[test]
fn storage_usage_matches_js() {
    for case in golden()["usage"].as_array().unwrap() {
        let num = |v: &Value| v.as_f64().unwrap_or(f64::NAN);
        let (bytes, limit) = (num(&case["input"][0]), case["input"][1].as_f64());
        let u = format_storage_usage(bytes, limit);
        let out = &case["out"];
        let ours = json!({
            "bytes": u.bytes, "limit": u.limit, "mbUsed": u.mb_used, "mbLimit": u.mb_limit,
            "percent": u.percent, "formatted": u.formatted,
        });
        for field in ["bytes", "limit", "mbUsed", "mbLimit", "percent"] {
            assert_eq!(ours[field].as_f64(), out[field].as_f64(), "{field} bei {case}");
        }
        assert_eq!(ours["formatted"], out["formatted"], "{case}");
    }
}

/// Rust-Ausgaben, die die letzte JS-Fassung lesen konnte (Gegenprobe damals mit `gen-golden-crypto.mjs --check`).
#[test]
fn rust_output_for_js() {
    let key = &creds().key;
    let texts = [
        r#"{"v":4,"events":[{"id":"r1","s":"äöü 😀"}]}"#.to_owned(),
        format!(r#"{{"v":4,"events":[{{"id":"r2","s":"{}"}}]}}"#, "abc".repeat(10_000)),
    ];
    let packets: Vec<Value> = texts
        .iter()
        .map(|t| {
            let p = encrypt_payload(key, t, &OsRandom).unwrap();
            json!({ "json": t, "iv": p.iv, "data": p.data, "size": p.size })
        })
        .collect();
    assert!(packets[1]["data"].as_str().unwrap().starts_with("gz:"));
    let meta = json!({ "name": "r.bin", "size": 3 });
    let blob = encrypt_blob(key, "file:rust", Some(&meta), &[7, 8, 9], &OsRandom).unwrap();
    let gz_text = "Rust-gzip ".repeat(3000);
    let out = json!({
        "syncKey": golden()["keys"][0]["syncKey"],
        "packets": packets,
        "blobs": [{ "id": "file:rust", "meta": meta, "data": base64_encode(&[7, 8, 9]), "iv": blob.iv, "bytes": base64_encode(&blob.bytes) }],
        "gzip": [{ "text": gz_text, "gz": base64_encode(&gzip(gz_text.as_bytes())) }],
    });
    let path = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("crypto-from-rust.json");
    std::fs::write(path, serde_json::to_string(&out).unwrap()).unwrap();
}
