//! Vergleich mit den JS-Originalen des Protokolls v4 (Golden-File `tests/golden/protocol.json`,
//! erzeugt von core/tools/gen-golden-sync.mjs aus web/sync-core.js, sync-crypto.js,
//! sync-transfer.js, sync-cloudflare.js und sync-maintenance.js).

use std::collections::HashSet;
use std::sync::OnceLock;

use impala_crypto::json::stringify;
use impala_crypto::{CipherKey, CounterRandom, base64_decode, decrypt_payload, hex_decode, sha256_hex};
use impala_sync::files::{Encoding, RemoteFile, bounded_known_ids, decode_json, newest_file, unseen_remote_files};
use impala_sync::wire::envelope_json;
use impala_sync::*;
use serde_json::{Value, json};

fn golden() -> &'static Value {
    static G: OnceLock<Value> = OnceLock::new();
    G.get_or_init(|| {
        let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/protocol.json")).unwrap();
        serde_json::from_str(&text).unwrap()
    })
}

fn arr(v: &Value) -> &Vec<Value> {
    v.as_array().unwrap()
}

fn texts(events: &[Value]) -> Vec<String> {
    events.iter().map(stringify).collect()
}

fn key() -> CipherKey {
    let raw: [u8; 32] = hex_decode(golden()["rawKey"].as_str().unwrap()).unwrap().try_into().unwrap();
    CipherKey::from_bytes(raw)
}

#[test]
fn prepares_wire_events_like_js() {
    let g = &golden()["prepare"];
    let input = arr(&g["input"]).clone();
    let strs = |v: &Value| arr(v).iter().map(|s| s.as_str().unwrap().to_owned()).collect::<Vec<_>>();
    assert_eq!(texts(&prepare_cloud_events(input.clone(), false)), strs(&g["wire"]));
    assert_eq!(texts(&prepare_cloud_events(input.clone(), true)), strs(&g["wireWithRemote"]));
    let pruned: Vec<Value> =
        prune_for_upload(input.clone()).iter().map(|e| e.get("id").cloned().unwrap_or(Value::Null)).collect();
    assert_eq!(&pruned, arr(&g["pruned"]));
    for (ev, echo) in input.iter().zip(arr(&g["echo"])) {
        let ours = json!([should_upload_to(ev, Transport::Cloudflare), should_upload_to(ev, Transport::Drive)]);
        assert_eq!(&ours, echo, "{ev}");
    }
}

#[test]
fn checks_incoming_envelopes_like_js() {
    for case in arr(&golden()["incoming"]) {
        let ours = prepare_incoming_cloud_events(arr(&case["envelopes"]).clone());
        match (ours, case.get("out")) {
            (Ok(events), Some(out)) => {
                assert_eq!(texts(&events), arr(out).iter().map(|s| s.as_str().unwrap()).collect::<Vec<_>>())
            }
            (Err(e), None) => assert_eq!(e.to_string(), case["error"].as_str().unwrap(), "{case}"),
            (ours, _) => panic!("{case}: Rust {ours:?}"),
        }
    }
}

#[test]
fn chunks_like_js() {
    let g = &golden()["chunks"];
    let events: Vec<WireEvent> = arr(&g["events"]).iter().cloned().map(WireEvent::new).collect();
    for case in arr(&g["cases"]) {
        let opts = &case["opts"];
        let limits = ChunkLimits {
            max_events: opts.get("maxEvents").map_or(250, |v| v.as_u64().unwrap() as usize),
            max_json_bytes: opts.get("maxJsonBytes").map_or(1_000_000, |v| v.as_u64().unwrap() as usize),
        };
        let sizes: Vec<Value> = chunk_cloud_events(&events, limits).iter().map(|r| json!(r.len())).collect();
        assert_eq!(&sizes, arr(&case["sizes"]), "{opts}");
    }
}

#[test]
fn builds_and_reads_packets_like_js() {
    let g = &golden()["packets"];
    let key = key();
    let wire: Vec<WireEvent> = arr(&g["wire"]).iter().cloned().map(WireEvent::new).collect();
    let limits = ChunkLimits {
        max_events: g["limits"]["maxEvents"].as_u64().unwrap() as usize,
        max_json_bytes: g["limits"]["maxJsonBytes"].as_u64().unwrap() as usize,
    };
    let ours = build_packets(&wire, limits, &key, &CounterRandom::new(0)).unwrap();
    let js = arr(&g["packets"]);
    assert_eq!(ours.len(), js.len());
    let mut gzipped = 0;
    for ((p, j), range) in ours.iter().zip(js).zip(chunk_cloud_events(&wire, limits)) {
        assert_eq!(p.id, j["id"].as_str().unwrap());
        assert_eq!(p.iv, j["iv"].as_str().unwrap());
        let envelope = envelope_json(wire[range].iter().map(|e| e.json.as_str())).unwrap();
        // JS-Paket entschlüsselt zu genau unserem Envelope-Text.
        assert_eq!(
            decrypt_payload(&key, j["iv"].as_str().unwrap(), j["data"].as_str().unwrap()).unwrap(),
            envelope.as_bytes()
        );
        if j["data"].as_str().unwrap().starts_with("gz:") {
            gzipped += 1;
            assert!(p.data.starts_with("gz:")); // gzip-Bytes selbst unterscheiden sich (anderer Kompressor)
        } else {
            assert_eq!((p.data.as_str(), p.size), (j["data"].as_str().unwrap(), j["size"].as_u64().unwrap()));
        }
    }
    assert!(gzipped >= 1 && gzipped < ours.len());

    // Upload-Körper aus den JS-Paketen: gleiche Bytes.
    let js_packets: Vec<OutgoingPacket> = js
        .iter()
        .map(|j| OutgoingPacket {
            id: j["id"].as_str().unwrap().into(),
            iv: j["iv"].as_str().unwrap().into(),
            data: j["data"].as_str().unwrap().into(),
            size: j["size"].as_u64().unwrap(),
        })
        .collect();
    let bodies = upload_bodies(&js_packets);
    let expected = arr(&g["bodies"]);
    assert_eq!(bodies.len(), expected.len());
    for (b, e) in bodies.iter().zip(expected) {
        assert_eq!(
            (b.len() as u64, sha256_hex(b)),
            (e["bytes"].as_u64().unwrap(), e["sha256"].as_str().unwrap().into())
        );
    }

    // Abruf: JS-Pakete als Server-Seite ab seq 1 lesen.
    let server: Vec<Value> = js
        .iter()
        .enumerate()
        .map(|(i, j)| json!({"seq": i + 1, "id": j["id"], "iv": j["iv"], "data": j["data"], "size": j["size"], "created_at": "x"}))
        .collect();
    let (events, last) = open_packets(&key, &server, 0).unwrap();
    assert_eq!(last, js.len() as u64);
    let expected: Vec<Value> = wire
        .iter()
        .map(|w| {
            let mut v = w.value.clone();
            v.as_object_mut().unwrap().insert("_remote".into(), json!(true));
            v.as_object_mut().unwrap().insert("_remoteSource".into(), json!("cloudflare"));
            v
        })
        .collect();
    assert_eq!(texts(&events), texts(&expected));
    let gap = open_packets(&key, &server[1..], 0).unwrap_err();
    assert_eq!(gap.to_string(), "Server-Sequenzlücke: erwartet 1, erhalten 2.");
    let wrong = open_packets(&CipherKey::from_bytes([0; 32]), &server, 0).unwrap_err();
    assert!(!wrong.is_retryable());
}

#[test]
fn heft_baseline_like_js() {
    for case in arr(&golden()["heft"]) {
        let ops = heft_baseline_ops(&case["doc"]).unwrap();
        assert_eq!(stringify(&Value::Array(ops)), case["ops"].as_str().unwrap());
        let ev = heft_baseline_event(case["pageId"].as_str().unwrap(), &case["doc"], "T").unwrap();
        assert_eq!(ev.as_ref().map(|e| e["id"].clone()).unwrap_or(Value::Null), case["id"]);
    }
    assert!(heft_baseline_ops(&json!({"pages": [null]})).is_err()); // wirft auch in JS
}

#[test]
fn blob_rules_like_js() {
    let g = &golden()["blobs"];
    let pages = g["pages"].as_object().unwrap();
    let alive = BlobAliveChecker::new(pages);
    for case in arr(&g["cases"]) {
        let key = case["key"].as_str().unwrap();
        assert_eq!(alive.is_alive(key), case["alive"].as_bool().unwrap(), "alive {key:?}");
        assert_eq!(is_sync_blob_id(key), case["syncId"].as_bool().unwrap(), "syncId {key:?}");
    }
}

#[test]
fn file_helpers_like_js() {
    let g = &golden()["files"];
    let files: Vec<RemoteFile> = arr(&g["files"])
        .iter()
        .map(|f| RemoteFile {
            id: f["id"].as_str().unwrap().into(),
            name: f["name"].as_str().unwrap().into(),
            modified_time: f["modifiedTime"].as_str().unwrap_or_default().into(),
        })
        .collect();
    let known: HashSet<String> = ["1".into(), "4".into()].into();
    let unseen: Vec<Value> = unseen_remote_files(&files, &known).iter().map(|f| json!(f.id)).collect();
    assert_eq!(&unseen, arr(&g["unseen"]));
    for case in arr(&g["newest"]) {
        let names: Vec<&str> = arr(&case["names"]).iter().map(|n| n.as_str().unwrap()).collect();
        assert_eq!(newest_file(&files, &names).map(|f| json!(f.id)).unwrap_or(Value::Null), case["id"], "{names:?}");
    }
    for case in arr(&g["known"]) {
        let ids: Vec<String> = arr(&case["ids"]).iter().map(|i| i.as_str().unwrap().into()).collect();
        let out: Vec<Value> =
            bounded_known_ids(&ids, case["max"].as_u64().unwrap() as usize).into_iter().map(Value::from).collect();
        assert_eq!(&out, arr(&case["out"]));
    }
    let ids: Vec<String> = (0..2100).map(|i| format!("k{}", i % 2050)).collect();
    let out = bounded_known_ids(&ids, 0);
    let d = &g["knownDefault"];
    assert_eq!(
        (json!(out.len()), json!(out[0]), json!(out[out.len() - 1])),
        (d["count"].clone(), d["first"].clone(), d["last"].clone())
    );
}

#[test]
fn reads_js_encoded_json() {
    let g = &golden()["encodedJson"];
    let bytes = base64_decode(g["b64"].as_str().unwrap()).unwrap();
    assert_eq!(decode_json(&bytes, Encoding::parse(g["encoding"].as_str().unwrap())).unwrap(), g["value"]);
}

#[test]
fn worker_answers_like_js() {
    for case in arr(&golden()["ack"]) {
        let ours = acknowledged_upload_cursor(
            &case["data"],
            case["generation"].as_u64().unwrap(),
            case["seq"].as_u64().unwrap(),
        );
        assert_eq!(ours.map(Value::from).unwrap_or(Value::Null), case["out"], "{case}");
    }
    for case in arr(&golden()["compactCloud"]) {
        let ours = should_compact_cloud(
            case["connected"].as_bool().unwrap(),
            case["percent"].as_f64(),
            case["last"].as_u64().unwrap(),
            case["now"].as_u64().unwrap(),
            case["bypass"].as_bool().unwrap(),
        );
        assert_eq!(ours, case["out"].as_bool().unwrap(), "{case}");
    }
    let r = &golden()["retry"];
    for (i, d) in arr(&r["delays"]).iter().enumerate() {
        assert_eq!(retry_delay_ms(i as u32), d.as_u64().unwrap());
    }
    for pair in arr(&r["retryable"]) {
        assert_eq!(is_retryable_status(pair[0].as_u64().unwrap() as u16), pair[1].as_bool().unwrap(), "{pair}");
    }
}
