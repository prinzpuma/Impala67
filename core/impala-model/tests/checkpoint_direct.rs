//! Tests für das direkte Deserialisieren von Checkpoints (`checkpoint::load_typed`):
//! - Gleiches Ergebnis wie der alte `serde_json::Value`-Pfad (`load_raw` + `State::restore`)
//!   inkl. kaputter Altdaten, fremder Feldtypen und aller Reject-Gründe.
//! - Rundlauf über `SqliteStorage` (Android/iPad) und `MemoryStorage`.
//! - Einfache Zeitmessung, die den Fortschritt gegenüber dem `Value`-Pfad belegt.

use std::time::Instant;

use impala_model::{Model, State};
use impala_storage::checkpoint::{self, LoadedRaw, LoadedTyped, Reject};
use impala_storage::{CheckpointRecord, CheckpointSlot, MemoryStorage, Object, Storage, StorageExt, Write};
use serde_json::{Value, json};

fn make_event(id: &str, t: &str, kind: &str, payload: Value) -> Object {
    let Value::Object(o) = json!({ "id": id, "t": t, "type": kind, "payload": payload }) else { unreachable!() };
    o
}

fn load_both(storage: &impl Storage, now: &str) -> (Result<State, Reject>, Result<State, Reject>) {
    let old = match checkpoint::load_raw(storage, |_, _| true).unwrap() {
        LoadedRaw::Usable { state, .. } => Ok(State::restore(state, now)),
        LoadedRaw::Rejected(r) => Err(r),
    };
    let new = match checkpoint::load_typed::<State, _>(storage, |_, _| true).unwrap() {
        LoadedTyped::Usable { mut state, .. } => {
            state.repair(now);
            Ok(state)
        }
        LoadedTyped::Rejected(r) => Err(r),
    };
    (old, new)
}

#[test]
fn direct_matches_value_path_with_edge_cases() {
    let mut storage = MemoryStorage::new();
    storage
        .add_events(vec![make_event("e1", "2026-11-28T10:00:00Z", "pageCreate", json!({ "id": "p1", "title": "A" }))])
        .unwrap();

    // Vollständiger Checkpoint mit Sonderfällen: fremde Feldtypen, kaputte null-Einträge,
    // alter Cloudflare-Name, Seite ohne `created`, zusätzliche unbekannte Felder.
    let state_json = json!({
        "pages": {
            "p1": {
                "id": "p1",
                "title": "Biologie",
                "content": "# Zellen\nMitochondrien",
                "order": 1,
                "trashed": false,
                "favorite": true,
                "updated": "2026-11-20T08:00:00Z"
            },
            "p_weird": {
                "id": "p_weird",
                "title": 123,
                "order": "nicht-nummer",
                "trashed": null,
                "customTag": [1, 2, 3]
            },
            "p_corrupt": null,
            "p_corrupt_num": 42
        },
        "cards": {
            "c1": {
                "id": "c1",
                "deck": "Bio::Zellen",
                "suspended": false,
                "front": "Was macht ATP?",
                "back": "Energieträger",
                "srs": { "state": "review", "due": "2026-12-01T00:00:00Z", "stability": 4.2 }
            },
            "c_corrupt": "kein-objekt"
        },
        "grades": {
            "g1": { "id": "g1", "subject": "Mathe", "grade": 1.3, "weight": 2, "date": "2026-11-01" }
        },
        "learningSessions": {
            "ls1": { "id": "ls1", "startedAt": "2026-11-28T09:00:00Z", "durationSeconds": 1800, "subject": "Bio" }
        },
        "chatSessions": {
            "ch1": { "id": "ch1", "title": "Hilfe", "deleted": false, "messages": [{ "role": "user", "text": "Hi" }] }
        },
        "homeArticles": {
            "ha1": { "id": "ha1", "day": "2026-11-28", "title": "Überblick", "body": "Text" }
        },
        "settings": {
            "aiProviders": [
                { "id": "cloudflare", "name": "Cloudflare (Groq)", "base": "https://example.invalid", "key": "" }
            ],
            "deckConf": { "Standard": { "newPerDay": 20 } },
            "syncSecrets": false,
            "customSetting": "bleibt"
        },
        "decks": {
            "Standard": { "name": "Standard", "created": "" },
            "Bio": { "name": "Bio", "order": 2, "archived": false }
        },
        "workspaces": {
            "default": { "id": "default", "name": "Privat", "created": "" }
        },
        "gnFolders": {
            "f1": { "id": "f1", "title": "Semester 1", "order": 0 }
        },
        "treeOpen": {
            "p1": true,
            "ws:default": false,
            "kaputt": "ja"
        },
        "tabs": ["p1", 99, null, "anki:main"],
        "activeTabId": "p1",
        "reviews": [
            { "id": "r1", "cardId": "c1", "deck": "Bio", "t": "2026-11-28T09:30:00Z", "grade": 3, "first": true },
            null,
            "kaputt"
        ],
        "telemetry": [
            { "id": "t1", "t": "2026-11-28T09:31:00Z", "kind": "study", "data": { "ms": 420 } },
            123
        ],
        "unknownTopKey": { "ignored": true }
    });

    let Value::Object(head) = json!({
        "format": checkpoint::FORMAT,
        "maxSeq": 1,
        "eventCount": 1,
        "lastEventId": "e1",
        "maxTime": "2026-11-28T10:00:00Z",
        "heftDocHashes": {},
        "heftBlobSizes": {},
        "reconciledArchive": true
    }) else {
        unreachable!()
    };
    let rec = CheckpointRecord { head, raw: vec![("state", state_json.to_string())] };
    storage.apply(vec![Write::PutCheckpoint(CheckpointSlot::Current, rec)]).unwrap();

    let (old, new) = load_both(&storage, "2026-11-28T12:00:00Z");
    let old_state = old.expect("alter Pfad muss laden");
    let new_state = new.expect("direkter Pfad muss laden");
    assert_eq!(new_state, old_state);

    // Reparaturen und Sonderfälle explizit prüfen:
    assert_eq!(new_state.pages.len(), 2);
    assert_eq!(new_state.pages.get("p1").unwrap().created.as_deref(), Some("2026-11-20T08:00:00Z"));
    assert_eq!(new_state.pages.get("p_weird").unwrap().created.as_deref(), Some("2026-11-28T12:00:00Z"));
    assert_eq!(new_state.pages.get("p_weird").unwrap().extra.get("title"), Some(&json!(123)));
    assert_eq!(new_state.pages.get("p_weird").unwrap().extra.get("order"), Some(&json!("nicht-nummer")));
    assert_eq!(new_state.pages.get("p_weird").unwrap().extra.get("trashed"), Some(&Value::Null));
    assert_eq!(new_state.cards.len(), 1);
    assert_eq!(new_state.tree_open.len(), 2);
    assert_eq!(new_state.tabs, vec!["p1", "anki:main"]);
    assert_eq!(new_state.reviews.len(), 1);
    assert_eq!(new_state.telemetry.len(), 1);
    let cf_name = new_state.settings.ai_providers.as_ref().unwrap()[0].get("name").and_then(Value::as_str);
    assert_eq!(cf_name, Some("Impala AI"));
}

#[test]
fn reject_reasons_match_value_path() {
    let cases: Vec<(&str, Value, Reject)> = vec![
        ("state fehlt", json!({ "format": 3, "maxSeq": 1, "eventCount": 1, "lastEventId": "e1" }), Reject::NoState),
        ("state null", json!({ "format": 3, "maxSeq": 1, "eventCount": 1, "lastEventId": "e1", "state": null }), Reject::NoState),
        ("state false", json!({ "format": 3, "maxSeq": 1, "eventCount": 1, "lastEventId": "e1", "state": false }), Reject::NoState),
        ("state 0", json!({ "format": 3, "maxSeq": 1, "eventCount": 1, "lastEventId": "e1", "state": 0 }), Reject::NoState),
        ("state leerer String", json!({ "format": 3, "maxSeq": 1, "eventCount": 1, "lastEventId": "e1", "state": "" }), Reject::NoState),
        (
            "state truthy aber kein Objekt",
            json!({ "format": 3, "maxSeq": 1, "eventCount": 1, "lastEventId": "e1", "heftDocHashes": {}, "heftBlobSizes": {}, "state": 1 }),
            Reject::Keys,
        ),
        (
            "fehlende Schlüssel",
            json!({ "format": 3, "maxSeq": 1, "eventCount": 1, "lastEventId": "e1", "heftDocHashes": {}, "heftBlobSizes": {}, "state": { "pages": {} } }),
            Reject::Keys,
        ),
        (
            "unbekanntes Format",
            json!({ "format": 99, "maxSeq": 1, "eventCount": 1, "lastEventId": "e1", "state": {} }),
            Reject::Format,
        ),
    ];

    for (name, cp_val, expected) in cases {
        let mut storage = MemoryStorage::new();
        storage
            .add_events(vec![make_event("e1", "2026-11-28T10:00:00Z", "pageCreate", json!({ "id": "p1" }))])
            .unwrap();
        let Value::Object(head) = cp_val else { unreachable!() };
        storage.apply(vec![Write::PutCheckpoint(CheckpointSlot::Current, CheckpointRecord::from(head))]).unwrap();

        let (old, new) = load_both(&storage, "2026-11-28T12:00:00Z");
        assert_eq!(old.unwrap_err(), expected, "alter Pfad ({name})");
        assert_eq!(new.unwrap_err(), expected, "direkter Pfad ({name})");
    }
}

#[test]
fn checkpoint_roundtrip_direct() {
    let mut storage = MemoryStorage::new();
    let events = vec![
        make_event("e1", "2026-11-28T10:00:00Z", "pageCreate", json!({ "id": "p1", "title": "Notiz 1", "content": "Hallo Welt" })),
        make_event("e2", "2026-11-28T10:00:01Z", "cardCreate", json!({ "id": "c1", "deck": "Standard", "front": "F", "back": "A" })),
        make_event("e3", "2026-11-28T10:00:02Z", "reviewAdd", json!({ "id": "r1", "cardId": "c1", "deck": "Standard", "t": "2026-11-28T10:00:02Z", "grade": 3 })),
    ];
    storage.add_events(events).unwrap();

    let (mut m1, r1) = Model::load(&mut storage, "2026-11-28T10:00:03Z").unwrap();
    assert!(!r1.checkpoint_used);
    m1.save_checkpoint(&mut storage).unwrap();

    let (m2, r2) = Model::load(&mut storage, "2026-11-28T10:00:04Z").unwrap();
    assert!(r2.checkpoint_used);
    assert_eq!(m2.state(), m1.state());
}

#[test]
fn direct_checkpoint_load_is_faster_than_value_path() {
    // Realistischer größerer Datensatz: 300 Seiten, 1500 Karten, 3000 Reviews.
    let mut events = Vec::with_capacity(4800);
    for i in 0..300 {
        events.push(make_event(
            &format!("ep{i}"),
            &format!("2026-11-01T00:{:02}:{:02}Z", i / 60, i % 60),
            "pageCreate",
            json!({
                "id": format!("p{i}"),
                "title": format!("Vorlesung {i}"),
                "content": format!("# Kapitel {i}\nZusammenfassung mit Formeln und Beispielen für Thema {i}."),
                "order": i,
                "tags": ["uni", "sse"]
            }),
        ));
    }
    for i in 0..1500 {
        events.push(make_event(
            &format!("ec{i}"),
            &format!("2026-11-02T{:02}:{:02}:{:02}Z", i / 3600, (i / 60) % 60, i % 60),
            "cardCreate",
            json!({
                "id": format!("c{i}"),
                "deck": format!("Fach{}", i % 8),
                "front": format!("Frage {i}: Was gilt für Satz {i}?"),
                "back": format!("Antwort {i}: Definition und Beweisidee."),
                "srs": { "state": "review", "due": "2026-12-01T00:00:00Z", "stability": 5.5, "difficulty": 4.2 }
            }),
        ));
    }
    for i in 0..3000 {
        events.push(make_event(
            &format!("er{i}"),
            &format!("2026-11-03T{:02}:{:02}:{:02}Z", i / 3600, (i / 60) % 60, i % 60),
            "reviewAdd",
            json!({
                "id": format!("r{i}"),
                "cardId": format!("c{}", i % 1500),
                "deck": format!("Fach{}", i % 8),
                "t": format!("2026-11-03T{:02}:{:02}:{:02}Z", i / 3600, (i / 60) % 60, i % 60),
                "grade": (i % 4) + 1,
                "first": i < 1500,
                "intervalDays": 3.5
            }),
        ));
    }

    let mut storage = MemoryStorage::new();
    storage.add_events(events).unwrap();
    let (mut model, _) = Model::load(&mut storage, "2026-11-28T12:00:00Z").unwrap();
    model.save_checkpoint(&mut storage).unwrap();

    let cp_bytes = storage.checkpoint_json(CheckpointSlot::Current).unwrap().unwrap().len();

    // Warmup + 5 Läufe je Pfad, Median vergleichen.
    let mut old_ms = Vec::new();
    let mut new_ms = Vec::new();
    let mut old_state = None;
    let mut new_state = None;
    for run in 0..6 {
        let t0 = Instant::now();
        let LoadedRaw::Usable { state, .. } = checkpoint::load_raw(&storage, |_, _| true).unwrap() else {
            panic!("alter Pfad fehlgeschlagen")
        };
        let s_old = State::restore(state, "2026-11-28T12:00:00Z");
        let dt_old = t0.elapsed().as_secs_f64() * 1000.0;

        let t1 = Instant::now();
        let LoadedTyped::Usable { state: mut s_new, .. } =
            checkpoint::load_typed::<State, _>(&storage, |_, _| true).unwrap()
        else {
            panic!("direkter Pfad fehlgeschlagen")
        };
        s_new.repair("2026-11-28T12:00:00Z");
        let dt_new = t1.elapsed().as_secs_f64() * 1000.0;

        if run == 0 {
            assert_eq!(s_new, s_old, "Direkter Pfad muss exakt denselben Zustand liefern");
            old_state = Some(s_old);
            new_state = Some(s_new);
        } else {
            old_ms.push(dt_old);
            new_ms.push(dt_new);
        }
    }
    assert_eq!(old_state, new_state);
    old_ms.sort_by(f64::total_cmp);
    new_ms.sort_by(f64::total_cmp);
    let med_old = old_ms[old_ms.len() / 2];
    let med_new = new_ms[new_ms.len() / 2];
    let speedup = med_old / med_new;
    eprintln!(
        "Checkpoint-Laden ({:.2} MB JSON, 300 Seiten / 1500 Karten / 3000 Reviews): alt (Value) = {:.2} ms, neu (direkt) = {:.2} ms ({:.2}x schneller)",
        cp_bytes as f64 / 1e6,
        med_old,
        med_new,
        speedup
    );
    assert!(
        med_new < med_old,
        "Direkter Pfad ({med_new:.2} ms) sollte schneller sein als der Value-Pfad ({med_old:.2} ms)"
    );
}
