//! Vergleich mit der PWA (web/db.js, web/state-checkpoint.js). Golden-Files erzeugt
//! `core/tools/gen-golden-storage.mjs`. Jeder Fall läuft gegen MemoryStorage und SqliteStorage.

use base64::Engine;
use impala_storage::checkpoint::{self, HeftPart, Reject};
use impala_storage::*;
use serde_json::Value;

fn golden(name: &str) -> Value {
    let path = format!("{}/tests/golden/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap()
}

fn obj(v: &Value) -> Object {
    v.as_object().cloned().unwrap_or_else(|| panic!("kein Objekt: {v}"))
}

fn info_of(v: &Value) -> LogInfo {
    LogInfo {
        count: v["count"].as_u64().unwrap(),
        max_seq: v["maxSeq"].as_u64().unwrap(),
        last_event_id: v["lastEventId"].as_str().unwrap().into(),
    }
}

fn storages() -> Vec<(&'static str, Box<dyn Storage>)> {
    vec![
        ("memory", Box::new(MemoryStorage::new()) as Box<dyn Storage>),
        #[cfg(feature = "sqlite")]
        ("sqlite", Box::new(SqliteStorage::open_in_memory().unwrap())),
    ]
}

fn rejected(r: Option<Reject>) -> &'static str {
    r.map_or("", Reject::as_str)
}

#[test]
fn scenario_matches_js_logs() {
    let scenario = golden("scenario.json");
    for (name, mut s) in storages() {
        let s = s.as_mut();
        for (i, step) in scenario["steps"].as_array().unwrap().iter().enumerate() {
            let at = format!("{name}, Schritt {i} ({})", step["op"]);
            match step["op"].as_str().unwrap() {
                "add" => {
                    s.add_events(vec![obj(&step["event"])]).unwrap();
                }
                "import" => {
                    let opts = ImportOptions {
                        remote: step["opts"]["remote"].as_str().map(str::to_owned),
                        deny_secrets: step["opts"]["denySecrets"] == true,
                    };
                    let prepared = s.prepare_import(&step["data"], &opts).unwrap();
                    let report = s.commit_import(prepared).unwrap();
                    assert_eq!(report.added as u64, step["expect"]["added"].as_u64().unwrap(), "{at}");
                    assert_eq!(report.malformed as u64, step["expect"]["malformed"].as_u64().unwrap(), "{at}");
                }
                "log" => {
                    let events: Vec<Value> = s.all_events().unwrap().into_iter().map(Value::Object).collect();
                    // Bytes statt Struktur: auch die Feldreihenfolge (seq zuletzt) muss stimmen.
                    assert_eq!(js::stringify(&Value::Array(events)), js::stringify(&step["events"]), "{at}");
                    assert_eq!(s.log_info().unwrap(), info_of(&step["info"]), "{at}");
                }
                "compactIfDue" => {
                    let r = s.compact_if_due("JETZT").unwrap();
                    assert_eq!(r.dropped as u64, step["expect"]["dropped"].as_u64().unwrap(), "{at}");
                    let floor = s.meta(exchange::COMPACT_FLOOR_KEY).unwrap();
                    assert_eq!(floor.as_deref(), step["expect"]["floor"].as_str(), "{at}");
                }
                "replaceHeftHistory" => {
                    let baselines = step["baselines"].as_array().unwrap().iter().map(obj).collect();
                    let n = s.replace_heft_history(baselines, step["upTo"].as_u64().unwrap()).unwrap();
                    assert_eq!(n as u64, step["expect"].as_u64().unwrap(), "{at}");
                }
                "putBlob" => {
                    let bytes =
                        base64::engine::general_purpose::STANDARD.decode(step["b64"].as_str().unwrap()).unwrap();
                    s.put_blob(step["key"].as_str().unwrap(), Blob { bytes, meta: step.get("meta").cloned() }).unwrap();
                }
                "putCheckpoint" => checkpoint::write(s, obj(&step["record"]), &[], &[]).unwrap(),
                "blobKeys" => {
                    let want: Vec<String> = serde_json::from_value(step["expect"].clone()).unwrap();
                    assert_eq!(s.blob_keys().unwrap(), want, "{at}");
                }
                "export" => {
                    let opts = ExportOptions {
                        include_blobs: step["opts"]["includeBlobs"] != false,
                        redact_secrets: step["opts"]["redactSecrets"] != false,
                        exported_at: String::new(),
                    };
                    assert_eq!(s.export_all(&opts).unwrap(), step["json"].as_str().unwrap(), "{at}");
                }
                "clearPages" => s.clear_pages().unwrap(),
                op => panic!("unbekannter Schritt {op}"),
            }
        }
    }
}

#[test]
fn pwa_export_roundtrips() {
    let g = golden("roundtrip.json");
    for (name, mut s) in storages() {
        let s = s.as_mut();
        let report = s.import_all(g["export"].as_str().unwrap(), &ImportOptions::default()).unwrap();
        assert!(report.added > 0);
        let again = s.export_all(&ExportOptions::default()).unwrap();
        assert_eq!(again, g["reexport"].as_str().unwrap(), "{name}: Re-Export wie JS");
        // Und zurück: der eigene Export ist wieder importierbar und ändert nichts mehr.
        let report = s.import_all(&again, &ImportOptions::default()).unwrap();
        assert_eq!(report.added, 0, "{name}");
    }
}

#[test]
fn checkpoint_writes_match_js() {
    let g = golden("checkpoint.json");
    for (name, mut s) in storages() {
        let s = s.as_mut();
        for (i, w) in g["writes"].as_array().unwrap().iter().enumerate() {
            let at = format!("{name}, Write {i}");
            let state = obj(&w["state"]);
            let hefte: Vec<HeftPart> = checkpoint::heft_parts(&obj(&state["heftDocs"]));
            for h in &hefte {
                assert_eq!(
                    w["expect"]["heftDocHashes"][&h.page_id],
                    h.hash.as_str(),
                    "{at}: SHA-256 von JSON.stringify"
                );
            }
            let cp = checkpoint::make(
                &state,
                &info_of(&w["info"]),
                w["maxTime"].as_str().unwrap(),
                w["known"].as_object(),
                &hefte,
                w["orderTimes"].as_object(),
            );
            assert_eq!(js::stringify(&Value::Object(cp.clone())), js::stringify(&w["expect"]["checkpoint"]), "{at}");
            let dirty: Vec<(String, String)> =
                obj(&w["dirty"]).into_iter().map(|(k, v)| (k, v.as_str().unwrap().to_owned())).collect();
            checkpoint::write(s, cp, &dirty, &hefte).unwrap();
            let mut parts = Object::new();
            for (kind, prefix) in
                [(PartKind::HeftBlob, checkpoint::BLOB_PREFIX), (PartKind::HeftDoc, checkpoint::HEFT_PREFIX)]
            {
                for hash in s.part_hashes(kind).unwrap() {
                    parts.insert(format!("{prefix}{hash}"), Value::from(s.part(kind, &hash).unwrap().unwrap()));
                }
            }
            assert_eq!(Value::Object(parts), w["expect"]["parts"], "{at}: Teile wie IndexedDB");
            assert!(s.checkpoint(CheckpointSlot::Legacy).unwrap().is_none());
        }
        // Format 3 lesen: Hefte kommen aus ihren Teilen zurück.
        let cp = checkpoint::read(s).unwrap().unwrap();
        let saved = checkpoint::saved_state(s, &cp).unwrap().unwrap();
        assert_eq!(js::stringify(&Value::Object(saved)), js::stringify(&g["savedCurrent"]), "{name}");
    }
}

#[test]
fn checkpoint_checks_match_js() {
    let g = golden("checkpoint.json");
    let empty = MemoryStorage::new();
    for case in g["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let cp = case["checkpoint"].as_object();
        let tail: Vec<Object> = case["tail"].as_array().unwrap().iter().map(obj).collect();
        let safe: Vec<bool> = serde_json::from_value(case["reorderSafe"].clone()).unwrap();
        let boundary = case["boundary"].as_object();
        let reason = checkpoint::reject_reason(cp, &info_of(&case["info"]), boundary, &tail, |ev, _| {
            safe[tail.iter().position(|t| std::ptr::eq(t, ev)).unwrap()]
        });
        assert_eq!(rejected(reason), case["expect"].as_str().unwrap(), "{name}");
        if let (Some(cp), Value::Object(want)) = (cp, &case["saved"]) {
            let saved = checkpoint::saved_state(&empty, cp).unwrap().unwrap();
            assert_eq!(js::stringify(&Value::Object(saved)), js::stringify(&Value::Object(want.clone())), "{name}");
        }
    }
}

#[test]
fn legacy_checkpoint_loads() {
    let g = golden("checkpoint.json");
    let case = g["cases"].as_array().unwrap().iter().find(|c| c["name"] == "legacy-ok").unwrap();
    for (name, mut s) in storages() {
        let s = s.as_mut();
        for i in 1..=3 {
            let ev =
                serde_json::json!({"id": format!("e{i}"), "t": format!("2026-01-01T00:00:0{i}.000Z"), "type": "x"});
            s.add_events(vec![obj(&ev)]).unwrap();
        }
        s.apply(vec![Write::PutCheckpoint(CheckpointSlot::Legacy, obj(&case["checkpoint"]))]).unwrap();
        match s.load_checkpoint(|_, _| true).unwrap() {
            checkpoint::Loaded::Usable { state, tail, .. } => {
                assert_eq!(Value::Object(state), case["saved"], "{name}");
                assert_eq!(tail.len(), 1);
            }
            other => panic!("{name}: {other:?}"),
        }
        // Neuer Checkpoint ersetzt das Alt-Format.
        let state = obj(&case["checkpoint"]["state"]);
        s.save_checkpoint(&state, "", None, &[], None).unwrap();
        assert!(s.checkpoint(CheckpointSlot::Legacy).unwrap().is_none());
        assert!(matches!(s.load_checkpoint(|_, _| true).unwrap(), checkpoint::Loaded::Usable { .. }));
    }
}

#[test]
fn js_numbers_and_dates() {
    let g = golden("js-values.json");
    for n in g["numbers"].as_array().unwrap() {
        let x = f64::from_bits(u64::from_str_radix(n["bits"].as_str().unwrap(), 16).unwrap());
        assert_eq!(js::stringify(&serde_json::json!(x)), n["js"].as_str().unwrap(), "{x:e}");
    }
    for d in g["dates"].as_array().unwrap() {
        assert_eq!(js::iso_from_ms(d["ms"].as_f64().unwrap()).as_deref(), d["iso"].as_str(), "{}", d["ms"]);
    }
}
