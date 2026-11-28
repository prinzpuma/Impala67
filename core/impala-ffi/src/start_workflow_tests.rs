//! Ende-zu-Ende-Ablauftests für Start, Checkpoint, Wiederherstellung und Speicherpflege.

use std::path::PathBuf;

use impala_storage::{CheckpointSlot, PartKind, SqliteStorage, Storage, Write};
use serde_json::json;

use crate::heft::HeftStroke;
use crate::heft_items::HeftChange;
use crate::{CheckpointResult, CoreError, ImpalaCore, PageKind};

struct TempDb {
    dir: PathBuf,
    path: String,
}

impl TempDb {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("impala-start-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("impala.db").to_string_lossy().into_owned();
        Self { dir, path }
    }
}

impl Drop for TempDb {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn kaltstart_checkpoint_tail_replay_und_neustart() {
    let db = TempDb::new("checkpoint-tail");
    let png = vec![0x89, b'P', b'N', b'G', 1, 2, 3, 4];

    let (note_id, heft_id, heft_page_id, img_id, file_id) = {
        let core = ImpalaCore::open(db.path.clone()).unwrap();
        let info = core.load_info();
        assert_eq!(info.event_count, 0);
        assert!(!info.checkpoint_used);

        let note = core.create_page("Physik".into(), "Kapitel 1: Mechanik".into(), None, None).unwrap();
        let heft = core.create_heft("Übungsblatt 1".into(), Some(note.clone()), None).unwrap();
        let hp = core.heft_page_ids(heft.clone())[0].clone();
        core.heft_add_stroke(
            heft.clone(),
            hp.clone(),
            "pen".into(),
            "#111".into(),
            2.5,
            vec![10.0, 20.0, 0.5, 80.0, 90.0, 0.7],
        )
        .unwrap();
        let img = core
            .heft_add_image(heft.clone(), hp.clone(), png.clone(), "image/png".into(), 50.0, 50.0, 200.0, 150.0)
            .unwrap();
        let file = core.add_file(vec![9, 8, 7], "application/pdf".into(), "blatt1.pdf".into()).unwrap();

        assert_eq!(core.save_checkpoint().unwrap(), CheckpointResult::Written);
        assert_eq!(core.save_checkpoint().unwrap(), CheckpointResult::Unchanged);
        assert!(core.storage_check().unwrap().ok);

        // Nach dem Checkpoint weitere Änderungen (Tail-Replay beim nächsten Start).
        core.update_page(note.clone(), Some("Physik I".into()), Some("Kapitel 1 + 2".into())).unwrap();
        core.heft_add_text(heft.clone(), hp.clone(), "Aufgabe 1a".into(), 100.0, 200.0, Some(300.0), None, Some(18.0))
            .unwrap();
        (note, heft, hp, img.ids[0].clone(), file)
    };

    // Neustart: nutzt den Checkpoint und spielt genau die 2 Tail-Events nach.
    let core = ImpalaCore::open(db.path.clone()).unwrap();
    let info = core.load_info();
    assert!(info.checkpoint_used, "Checkpoint sollte genutzt werden: {info:?}");
    assert_eq!(info.checkpoint_reject, None);
    assert_eq!(info.replayed, 2);

    let note = core.page(note_id.clone()).unwrap();
    assert_eq!(note.summary.title, "Physik I");
    assert_eq!(note.content, "Kapitel 1 + 2");
    assert_eq!(core.page(heft_id.clone()).unwrap().summary.kind, PageKind::Heft);

    let pg = core.heft_page(heft_id.clone(), heft_page_id.clone()).unwrap();
    assert_eq!(pg.strokes.len(), 1);
    assert_eq!(pg.images.len(), 1);
    assert_eq!(pg.texts.len(), 1);
    assert_eq!(pg.texts[0].text, "Aufgabe 1a");

    // Heft-Bilddaten werden nach Neustart sauber aus Checkpoint/Log hydriert.
    let img_data = core.heft_image_data(heft_id, heft_page_id, img_id).unwrap().unwrap();
    assert_eq!(img_data.bytes, png);
    assert_eq!(img_data.mime, "image/png");
    assert_eq!(core.file(file_id).unwrap().unwrap().bytes, vec![9, 8, 7]);
}

#[test]
fn beschaedigter_checkpoint_wird_verworfen_und_voll_wiederhergestellt() {
    let db = TempDb::new("corrupt-cp");
    let (note_id, heft_id, heft_page_id) = {
        let core = ImpalaCore::open(db.path.clone()).unwrap();
        let note = core.create_page("Wichtig".into(), "Darf nicht verloren gehen".into(), None, None).unwrap();
        let heft = core.create_heft("Skizze".into(), None, None).unwrap();
        let hp = core.heft_page_ids(heft.clone())[0].clone();
        core.heft_add_stroke(
            heft.clone(),
            hp.clone(),
            "pen".into(),
            "#000".into(),
            3.0,
            vec![10.0, 10.0, 0.5, 50.0, 50.0, 0.5],
        )
        .unwrap();
        assert_eq!(core.save_checkpoint().unwrap(), CheckpointResult::Written);
        (note, heft, hp)
    };

    // Fall 1: Heft-Teil im Checkpoint fehlt -> Reject::HeftDocs -> Voll-Replay rettet alles.
    {
        let mut storage = SqliteStorage::open(&db.path).unwrap();
        let hashes = storage.part_hashes(PartKind::HeftDoc).unwrap();
        assert!(!hashes.is_empty(), "Checkpoint sollte Heft-Teile enthalten");
        let deletes: Vec<Write> = hashes.into_iter().map(|h| Write::DeletePart(PartKind::HeftDoc, h)).collect();
        storage.apply(deletes).unwrap();
    }
    {
        let core = ImpalaCore::open(db.path.clone()).unwrap();
        let info = core.load_info();
        assert!(!info.checkpoint_used);
        assert_eq!(info.checkpoint_reject.as_deref(), Some("heft-docs"));
        assert_eq!(core.page(note_id.clone()).unwrap().content, "Darf nicht verloren gehen");
        assert_eq!(core.heft_page(heft_id.clone(), heft_page_id.clone()).unwrap().strokes.len(), 1);
        // Danach lässt sich wieder ein gültiger Checkpoint schreiben.
        assert_eq!(core.save_checkpoint().unwrap(), CheckpointResult::Written);
    }

    // Fall 2: Checkpoint-Kopf enthält kaputte Metadaten (`maxSeq` zu hoch) -> Reject::SeqAhead -> Voll-Replay.
    {
        let mut storage = SqliteStorage::open(&db.path).unwrap();
        let mut cp = storage.checkpoint(CheckpointSlot::Current).unwrap().unwrap();
        cp.insert("maxSeq".into(), json!(999_999));
        storage.apply(vec![Write::PutCheckpoint(CheckpointSlot::Current, cp.into())]).unwrap();
    }
    {
        let core = ImpalaCore::open(db.path.clone()).unwrap();
        let info = core.load_info();
        assert!(!info.checkpoint_used);
        assert_eq!(info.checkpoint_reject.as_deref(), Some("seq-ahead"));
        assert_eq!(core.page(note_id).unwrap().content, "Darf nicht verloren gehen");
        assert_eq!(core.heft_page(heft_id, heft_page_id).unwrap().strokes.len(), 1);
    }
}

#[test]
fn export_import_und_kompaktierung_ueberleben_neustart() {
    let db_a = TempDb::new("export-a");
    let db_b = TempDb::new("export-b");
    let png = vec![0x89, b'P', b'N', b'G', 7, 7, 7];

    let (note_id, heft_id, hp_id, img_id, export) = {
        let a = ImpalaCore::open(db_a.path.clone()).unwrap();
        let note = a.create_page("Export-Notiz".into(), "Erster Stand".into(), None, None).unwrap();
        a.update_page(note.clone(), None, Some("Zweiter Stand".into())).unwrap();
        a.update_page(note.clone(), None, Some("Endstand".into())).unwrap();
        let heft = a.create_heft("Export-Heft".into(), None, None).unwrap();
        let hp = a.heft_page_ids(heft.clone())[0].clone();
        let s = HeftStroke {
            id: "s1".into(),
            tool: "pen".into(),
            color: "#1f2937".into(),
            size: 3.0,
            points: vec![20.0, 20.0, 0.5, 120.0, 80.0, 0.6],
            shape: None,
        };
        a.heft_apply(heft.clone(), vec![HeftChange::AddStroke { page: hp.clone(), stroke: s }]).unwrap();
        let img = a
            .heft_add_image(heft.clone(), hp.clone(), png.clone(), "image/png".into(), 10.0, 10.0, 100.0, 100.0)
            .unwrap();
        let json = a.export_json(true).unwrap();
        (note, heft, hp, img.ids[0].clone(), json)
    };

    {
        let b = ImpalaCore::open(db_b.path.clone()).unwrap();
        let summary = b.import_json(export.clone()).unwrap();
        assert!(summary.added > 0);
        assert_eq!(summary.malformed, 0);
        assert_eq!(summary.bad_blobs, 0);
        // Zweiter Import desselben Exports ist vollständig idempotent.
        assert_eq!(b.import_json(export).unwrap().added, 0);

        // Kompaktierung + Checkpoint + Neustart.
        let _ = b.compact_local().unwrap();
        let _ = b.save_checkpoint().unwrap();
        assert!(b.storage_check().unwrap().ok);
    }

    let b = ImpalaCore::open(db_b.path.clone()).unwrap();
    assert_eq!(b.page(note_id).unwrap().content, "Endstand");
    let pg = b.heft_page(heft_id.clone(), hp_id.clone()).unwrap();
    assert_eq!(pg.strokes.len(), 1);
    assert_eq!(pg.images.len(), 1);
    assert_eq!(b.heft_image_data(heft_id, hp_id, img_id).unwrap().unwrap().bytes, png);
}

#[test]
fn clear_pages_behaelt_einstellungen_und_laesst_neustart_zu() {
    let db = TempDb::new("clear-pages");
    {
        let core = ImpalaCore::open(db.path.clone()).unwrap();
        core.create_page("Weg".into(), "Text".into(), None, None).unwrap();
        core.create_heft("Auch weg".into(), None, None).unwrap();
        core.save_checkpoint().unwrap();
        core.clear_pages().unwrap();
        assert!(core.children_of(None, None).is_empty());
        assert_eq!(core.save_checkpoint().unwrap(), CheckpointResult::Written);
    }
    let core = ImpalaCore::open(db.path.clone()).unwrap();
    assert!(core.children_of(None, None).is_empty());
    assert!(core.load_info().checkpoint_used);
}

#[test]
fn ungueltiger_datenbankpfad_liefert_fehler_ohne_panic() {
    let res = ImpalaCore::open("/nonexistent-dir-impala67/does/not/exist/db.sqlite".into());
    assert!(matches!(res, Err(CoreError::Storage { .. })));
}
