//! Verhalten, das beide Implementierungen gleich liefern müssen (ohne JS-Vorlage).

use impala_storage::*;
use serde_json::{Value, json};

fn obj(v: Value) -> Object {
    v.as_object().cloned().unwrap()
}

fn storages() -> Vec<(&'static str, Box<dyn Storage>)> {
    vec![
        ("memory", Box::new(MemoryStorage::new()) as Box<dyn Storage>),
        #[cfg(feature = "sqlite")]
        ("sqlite", Box::new(SqliteStorage::open_in_memory().unwrap())),
    ]
}

fn ev(id: &str, t: &str) -> Object {
    obj(json!({"id": id, "t": t, "type": "pageUpdate", "payload": {"id": "p", "patch": {"title": id}}}))
}

#[test]
fn ranges_limits_and_validation() {
    for (name, mut s) in storages() {
        let s = s.as_mut();
        let mut wire = ev("a", "1");
        wire.insert("seq".into(), json!(77));
        assert_eq!(s.add_events(vec![wire, ev("b", "2"), ev("c", "3")]).unwrap(), vec![1, 2, 3], "{name}");
        assert!(s.add_events(vec![ev("d", "4"), obj(json!({"id": "x", "t": "5", "type": ""}))]).is_err());
        assert_eq!(s.log_info().unwrap().count, 3, "{name}: alles oder nichts");
        let ids = |v: Vec<Object>| v.iter().map(|e| e["id"].as_str().unwrap().to_owned()).collect::<Vec<_>>();
        assert_eq!(ids(s.events_after(1, None, None).unwrap()), ["b", "c"]);
        assert_eq!(ids(s.events_after(0, Some(2), None).unwrap()), ["a", "b"]);
        assert_eq!(ids(s.events_after(0, None, Some(1)).unwrap()), ["a"]);
        assert!(s.events_after(2, Some(2), None).unwrap().is_empty());
        assert_eq!(s.event_at(2).unwrap().unwrap()["seq"], 2);
        assert_eq!(s.known_ids(&["a".into(), "zz".into()]).unwrap().len(), 1);
    }
}

#[test]
fn blobs_vecs_meta() {
    for (name, mut s) in storages() {
        let s = s.as_mut();
        s.put_blob("b", Blob { bytes: vec![0, 255], meta: None }).unwrap();
        s.put_blob("a", Blob { bytes: vec![], meta: Some(json!({"type": "image/png"})) }).unwrap();
        assert_eq!(s.blob_keys().unwrap(), ["a", "b"], "{name}");
        assert_eq!(s.blob("a").unwrap().unwrap().mime(), "image/png");
        assert_eq!(s.blob("b").unwrap().unwrap(), Blob { bytes: vec![0, 255], meta: None });
        s.delete_blob("b").unwrap();
        assert!(s.blob("b").unwrap().is_none());
        let rec = json!({"model": "m", "chunks": [{"text": "x", "vec": [0.5, -1.25], "norm": 1.3975}]});
        s.put_vec("p1", rec.clone()).unwrap();
        assert_eq!(s.vec("p1").unwrap(), Some(rec));
        assert_eq!(s.vecs().unwrap().len(), 1);
        s.delete_vec("p1").unwrap();
        assert!(s.vecs().unwrap().is_empty());
    }
}

#[test]
fn broken_blob_does_not_break_import() {
    for (name, mut s) in storages() {
        let s = s.as_mut();
        let file = json!({
            "app": "impala67",
            "events": [{"id": "a", "t": "1", "type": "pageCreate", "payload": {"id": "p"}}],
            "blobs": {
                "img:x": {"b64": "AQ I"},
                "kaputt": {"b64": "%%%"},
                "ohne": null,
                "__impala67_state_checkpoint_v2__": {"b64": "AA=="}
            }
        });
        let r = s.import_all(&file.to_string(), &ImportOptions::default()).unwrap();
        assert_eq!((r.added, r.bad_blobs), (1, 2), "{name}");
        assert_eq!(s.blob_keys().unwrap(), ["img:x"], "Checkpoint-Schlüssel werden nie importiert");
        assert_eq!(s.blob("img:x").unwrap().unwrap().bytes, [1, 2], "atob: Leerraum und fehlendes Padding");
        assert!(matches!(s.import_all(r#"{"app":"x"}"#, &ImportOptions::default()), Err(Error::NotAnExport)));
    }
}

#[test]
fn derived_events_join_the_import() {
    for (name, mut s) in storages() {
        let s = s.as_mut();
        let opts = ImportOptions { remote: Some("cloudflare".into()), deny_secrets: false };
        let data = json!({"app": "impala67", "events": [ev("r", "2")]});
        let mut p = s.prepare_import(&data, &opts).unwrap();
        let mut merge = ev("merge3-x", "3");
        merge.insert("_derived".into(), json!(true));
        p.fresh.push(merge);
        let r = s.commit_import(p).unwrap();
        assert_eq!(r.added, 2);
        let log = s.all_events().unwrap();
        assert_eq!(log[0]["_remoteSource"], "cloudflare", "{name}");
        assert!(log[1].get("_remote").is_none(), "{name}: abgeleitete Events sind nicht remote");
    }
}

#[test]
fn orphan_blobs() {
    let uuid = "0a1b2c3d-0000-4000-8000-00000000abcd";
    let old = "11111111-0000-4000-8000-000000000000";
    for (name, mut s) in storages() {
        let s = s.as_mut();
        for key in [format!("img:{uuid}"), format!("file:{old}"), "file:weg".into(), "heft:p".into(), "bgImage".into()]
        {
            s.put_blob(&key, Blob { bytes: vec![1], meta: None }).unwrap();
        }
        // file:<old> steht nur noch in einer älteren Seitenfassung im Log.
        let mut upd = ev("u", "1");
        upd["payload"]["patch"] = json!({"content": format!("[pdf](file:{old})")});
        s.add_events(vec![upd]).unwrap();
        let pages = obj(json!({"p": {"id": "p", "content": format!("![](img:{uuid})")}}));
        assert_eq!(blobs::orphans(s, &pages).unwrap(), ["file:weg"], "{name}");
    }
}

#[cfg(feature = "sqlite")]
#[test]
fn sqlite_survives_reopen() {
    let path = std::env::temp_dir().join(format!("impala-storage-reopen-{}.db", std::process::id()));
    let _ = std::fs::remove_file(&path);
    {
        let mut s = SqliteStorage::open(&path).unwrap();
        s.add_events(vec![ev("a", "1"), ev("b", "2")]).unwrap();
        s.put_blob("k", Blob { bytes: vec![7; 1000], meta: Some(json!({"name": "x"})) }).unwrap();
        let state = obj(json!({"pages": {}, "heftDocs": {"h": {"v": 2, "pages": []}}}));
        s.save_checkpoint(&state, "t", None, &[("hash".into(), "data:".into())], None).unwrap();
    }
    let s = SqliteStorage::open(&path).unwrap();
    assert_eq!(s.log_info().unwrap(), LogInfo { count: 2, max_seq: 2, last_event_id: "b".into() });
    assert_eq!(s.blob("k").unwrap().unwrap().bytes.len(), 1000);
    assert_eq!(s.part(PartKind::HeftBlob, "hash").unwrap().as_deref(), Some("data:"));
    assert_eq!(s.part_hashes(PartKind::HeftDoc).unwrap().len(), 1);
    drop(s);
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
    }
}
