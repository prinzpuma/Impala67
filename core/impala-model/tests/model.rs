//! Laufzeit-Abläufe ohne JS-Gegenstück im Golden: dispatch, Checkpoint-Rundlauf, Heft-Bilder,
//! Konflikt-Auflösung, alte Zugangsdaten.

use std::collections::HashSet;

use impala_model::conflict::{Conflict, Resolution, ResolveError, legacy_conflict_items};
use impala_model::{CheckpointSave, LogEvent, Model};
use impala_storage::{MemoryStorage, StorageExt};
use serde_json::{Value, json};

fn t(i: u32) -> String {
    format!("2026-05-01T10:{:02}:00.000Z", i)
}

#[test]
fn dispatch_checkpoint_und_heftbilder() {
    let mut s = MemoryStorage::new();
    let (mut m, report) = Model::load(&mut s, &t(0)).unwrap();
    assert_eq!(report.reject_reason, Some("missing"));
    let ev =
        m.dispatch(&mut s, "pageCreate", json!({ "id": "h", "title": "Heft", "kind": "heft" }), "e1", &t(1)).unwrap();
    assert_eq!(ev.payload["created"], json!(t(1)));
    m.dispatch(&mut s, "heftBlob", json!({ "hash": "B", "data": "data:abc" }), "e2", &t(2)).unwrap();
    m.dispatch(
        &mut s,
        "heftOps",
        json!({ "pageId": "h", "ops": [{ "t": "pg+", "page": { "id": "q" } }, { "t": "i+", "p": "q", "o": { "id": "i", "ref": "B" } }, { "t": "ocr", "p": "q", "text": "Hallo" }] }),
        "e3",
        &t(3),
    )
    .unwrap();
    let meta = m.heft_meta("h").unwrap();
    assert_eq!((meta.rev, meta.pages, meta.ocr_text.as_str(), meta.updated.as_str()), (1, 1, "Hallo", t(3).as_str()));
    assert_eq!(meta.bytes, 60 + 8);
    assert_eq!(m.save_checkpoint(&mut s).unwrap(), CheckpointSave::Written);
    assert_eq!(m.save_checkpoint(&mut s).unwrap(), CheckpointSave::Unchanged);
    // Fremdes Event im Log, das das Modell nicht kennt: Checkpoint wäre veraltet.
    s.add_events(vec![LogEvent::new("x", t(4), "teleEvent", json!({ "kind": "k" })).to_object()]).unwrap();
    assert_eq!(m.save_checkpoint(&mut s).unwrap(), CheckpointSave::Stale);

    let (mut again, report) = Model::load(&mut s, &t(9)).unwrap();
    assert!(report.checkpoint_used);
    assert_eq!(report.replayed, 1);
    assert!(again.has_heft_blob("B"));
    assert!(again.state().hefte.blobs.is_empty(), "Bilder bleiben im Checkpoint, bis ein Heft sie braucht");
    assert!(again.hydrate_heft_blobs(&s, Some(&["B".to_owned()])).unwrap());
    assert_eq!(again.state().hefte.blobs["B"], "data:abc");
    assert_eq!(again.release_heft_blobs(&[]), 1);
    assert_eq!(again.heft_meta("h").unwrap().bytes, 68, "Größe aus dem Checkpoint");
    assert_eq!(again.state().page("h").unwrap().updated(), t(3));
}

#[test]
fn hefte_bleiben_text_bis_gebraucht() {
    let mut s = MemoryStorage::new();
    let (mut m, _) = Model::load(&mut s, &t(0)).unwrap();
    for (i, id) in ["a", "b"].iter().enumerate() {
        m.dispatch(
            &mut s,
            "heftOps",
            json!({ "pageId": id, "ops": [{ "t": "pg+", "page": { "id": "p" } }, { "t": "s+", "p": "p", "o": { "id": "s", "pts": [[1.5, 2, 0.5]] } }] }),
            &format!("e{i}"),
            &t(i as u32 + 1),
        )
        .unwrap();
    }
    assert_eq!(m.save_checkpoint(&mut s).unwrap(), CheckpointSave::Written);
    let before = m.state().hefte.get("a").unwrap().clone();

    let (mut again, report) = Model::load(&mut s, &t(9)).unwrap();
    assert!(report.checkpoint_used);
    assert!(!again.state().hefte.is_loaded("a"), "Heft erst beim ersten Zugriff lesen");
    assert_eq!(again.state().hefte.get("a").unwrap(), &before);
    assert!(again.state().hefte.is_loaded("a") && !again.state().hefte.is_loaded("b"));
    // Unverändert: der nächste Checkpoint liest und schreibt kein Heft neu.
    again.dispatch(&mut s, "teleEvent", json!({ "kind": "k" }), "e8", &t(10)).unwrap();
    assert_eq!(again.save_checkpoint(&mut s).unwrap(), CheckpointSave::Written);
    assert!(!again.state().hefte.is_loaded("b"));
    // Geändert: neu geschrieben, und ein Start danach sieht die Änderung.
    again
        .dispatch(
            &mut s,
            "heftOps",
            json!({ "pageId": "b", "ops": [{ "t": "s-", "p": "p", "ids": ["s"] }] }),
            "e9",
            &t(11),
        )
        .unwrap();
    assert_eq!(again.save_checkpoint(&mut s).unwrap(), CheckpointSave::Written);
    let (third, _) = Model::load(&mut s, &t(12)).unwrap();
    assert!(third.state().hefte.get("b").unwrap().pages[0].strokes.is_empty());
    assert_eq!(third.state().hefte.get("a").unwrap(), &before);
}

#[test]
fn verspaetetes_fremdes_event_sperrt_checkpoint() {
    let mut s = MemoryStorage::new();
    let (mut m, _) = Model::load(&mut s, &t(0)).unwrap();
    m.dispatch(&mut s, "pageCreate", json!({ "id": "a" }), "e1", &t(5)).unwrap();
    m.dispatch(&mut s, "pageUpdate", json!({ "id": "a", "patch": { "content": "neu" } }), "e2", &t(6)).unwrap();
    // Älter, aber andere Seite: darf hinten angehängt werden.
    let safe = LogEvent::new("r1", t(4), "pageUpdate", json!({ "id": "b", "patch": {} }));
    s.add_events(vec![safe.to_object()]).unwrap();
    m.apply_remote(vec![safe]);
    assert!(m.replay_ordered());
    // Älter und dieselbe Seite: der Speicher weicht vom sortierten Replay ab.
    let late = LogEvent::new("r2", t(4), "pageUpdate", json!({ "id": "a", "patch": { "content": "alt" } }));
    s.add_events(vec![late.to_object()]).unwrap();
    m.apply_remote(vec![late]);
    assert!(!m.replay_ordered());
    assert_eq!(m.state().page("a").unwrap().content(), "alt");
    assert_eq!(m.save_checkpoint(&mut s).unwrap(), CheckpointSave::OutOfOrder);
    // Der nächste Start sortiert richtig ein.
    let (fresh, _) = Model::load(&mut s, &t(9)).unwrap();
    assert_eq!(fresh.state().page("a").unwrap().content(), "neu");
}

#[test]
fn konflikt_aufloesen() {
    let mut m = Model::new();
    for (i, (kind, p)) in [
        ("pageCreate", json!({ "id": "p", "title": "Plan", "content": "gewonnen" })),
        ("pageCreate", json!({ "id": "conflictpg-x", "title": "⚠ Konflikt: Plan — Stand 2026-05-01 09:00", "content": "verloren" })),
    ]
    .into_iter()
    .enumerate()
    {
        m.apply_remote(vec![LogEvent::new(format!("e{i}"), t(i as u32), kind, p)]);
    }
    let both = Conflict::from_object(
        json!({ "pageId": "p", "winner": "remote", "conflictPageId": "conflictpg-x", "loserContent": "verloren", "title": "Plan" })
            .as_object()
            .unwrap()
            .clone(),
    );
    let st = m.state();
    assert_eq!(both.recommended(), Some(Resolution::KeepWinner));
    assert_eq!(
        both.resolve(st, Resolution::UseLoser).unwrap(),
        vec![
            ("pageUpdate".to_owned(), json!({ "id": "p", "patch": { "content": "verloren" } })),
            ("pageTrash".to_owned(), json!({ "id": "conflictpg-x" })),
        ]
    );
    assert_eq!(
        both.resolve(st, Resolution::KeepBoth).unwrap(),
        vec![("pageUpdate".to_owned(), json!({ "id": "conflictpg-x", "patch": { "title": "Plan (Kopie)" } }))]
    );
    let gone = Conflict::from_object(
        json!({ "conflictType": "delete-change", "conflictPageId": "fehlt" }).as_object().unwrap().clone(),
    );
    assert_eq!(gone.resolve(st, Resolution::UseLoser), Err(ResolveError::CopyMissing));
    assert_eq!(gone.resolve(st, Resolution::KeepWinner).unwrap(), vec![]);
    // Gespeichert ohne Texte (Platz knapp): aus dem Zustand ergänzen.
    let slim = Conflict::from_object(
        json!({ "pageId": "p", "conflictPageId": "conflictpg-x", "winner": "remote" }).as_object().unwrap().clone(),
    );
    let full = slim.with_texts_from(st);
    assert_eq!(full.get("localContent"), Some(json!("verloren")));
    assert_eq!(full.get("remoteContent"), Some(json!("gewonnen")));
    let legacy = legacy_conflict_items(st, &HashSet::new());
    assert_eq!(legacy.len(), 1);
    assert_eq!(legacy[0].get("pageId"), Some(json!("p")));
    assert!(legacy_conflict_items(st, &HashSet::from(["conflictpg-x".to_owned()])).is_empty());
}

#[test]
fn alte_zugangsdaten_werden_einstellungen() {
    let mut s = MemoryStorage::new();
    let (mut m, _) = Model::load(&mut s, &t(0)).unwrap();
    let legacy = impala_model::migrate::parse_legacy_secrets(Some(r#"{"providerKeys":{"google":"g-key"}}"#), None);
    let patch = impala_model::migrate::legacy_secrets_patch(&m.state().settings, &legacy).unwrap();
    m.dispatch(&mut s, "settingsSet", Value::Object(patch), "e1", &t(1)).unwrap();
    let providers = m.state().settings.ai_providers.clone().unwrap();
    assert_eq!(providers[1]["key"], json!("g-key"));
    // Ein späterer Patch ohne Schlüssel löscht ihn nicht.
    m.dispatch(
        &mut s,
        "settingsSet",
        json!({ "aiProviders": providers.iter().map(|p| json!({ "id": p["id"] })).collect::<Vec<_>>() }),
        "e2",
        &t(2),
    )
    .unwrap();
    assert_eq!(m.state().settings.ai_providers.as_ref().unwrap()[1]["key"], json!("g-key"));
    assert!(s.all_events().unwrap().len() == 2);
}
