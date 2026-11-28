//! Ende-zu-Ende-Leistungsmessung realistischer Abläufe (Start, Heft, Sync/Import) auf SQLite.
//!   cargo run -p impala-ffi --example bench_workflows --profile native

use std::time::Instant;

use impala_crypto::{CipherKey, CounterRandom};
use impala_ffi::ImpalaCore;
use impala_storage::{CheckpointSlot, SqliteStorage, Storage, Write};
use impala_sync::{ChunkLimits, WireEvent, build_packets, open_packets};
use serde_json::{Value, json};

fn median(runs: usize, mut f: impl FnMut()) -> f64 {
    f(); // Aufwärmen
    let mut xs = Vec::with_capacity(runs);
    for _ in 0..runs {
        let t = Instant::now();
        f();
        xs.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    xs.sort_by(f64::total_cmp);
    xs[xs.len() / 2]
}

fn make_stroke_json(id: &str, idx: usize) -> Value {
    let base_x = (idx % 20) as f64 * 45.0 + 20.0;
    let base_y = (idx / 20) as f64 * 25.0 + 20.0;
    let pts: Vec<Value> =
        (0..25).map(|k| json!([base_x + k as f64 * 1.5, base_y + (k % 5) as f64 * 1.2, 0.5])).collect();
    json!({
        "id": id,
        "tool": "pen",
        "color": "#1f2937",
        "size": 3.0,
        "pts": pts
    })
}

fn main() {
    let dir = std::env::temp_dir().join(format!("impala-bench-wf-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("impala.db").to_string_lossy().into_owned();

    // Realistische Datenbasis: 200 Notizen + großes Heft (15 Seiten × 1 000 Striche = 15 000 Striche).
    let (heft_id, page0_id, lasso_300, del_50) = {
        let core = ImpalaCore::open(db_path.clone()).unwrap();
        for i in 0..200 {
            core.create_page(
                format!("Vorlesung {i:03}"),
                format!("# Kapitel {i}\n\nDies ist eine realistische Studiennotiz mit Formeln und Text. ").repeat(8),
                None,
                None,
            )
            .unwrap();
        }
        let heft = core.create_heft("Analysis III".into(), None, None).unwrap();
        let mut page_ids = core.heft_page_ids(heft.clone());
        for _ in 1..15 {
            page_ids.push(core.heft_add_page(heft.clone(), None, Some("grid".into())).unwrap());
        }
        for (pi, pid) in page_ids.iter().enumerate() {
            // Je Seite 1 000 Striche in 4 Events à 250 Striche.
            for chunk in 0..4 {
                let ops: Vec<Value> = (0..250)
                    .map(|j| {
                        let idx = chunk * 250 + j;
                        let sid = format!("p{pi}-s{idx:04}");
                        json!({ "t": "s+", "p": pid, "o": make_stroke_json(&sid, idx) })
                    })
                    .collect();
                core.dispatch("heftOps".into(), json!({ "pageId": heft, "ops": ops }).to_string()).unwrap();
            }
        }
        let lasso_300: Vec<String> = (0..300).map(|i| format!("p0-s{i:04}")).collect();
        let del_50: Vec<String> = (500..550).map(|i| format!("p0-s{i:04}")).collect();
        (heft, page_ids[0].clone(), lasso_300, del_50)
    };

    println!("=== Heft-Abläufe (15 Seiten × 1 000 = 15 000 Striche) ===");
    {
        let core = ImpalaCore::open(db_path.clone()).unwrap();

        let ms_read = median(7, || {
            let pg = core.heft_page(heft_id.clone(), page0_id.clone()).unwrap();
            assert_eq!(pg.strokes.len(), 1000);
        });
        println!("  heft_page lesen (1 000 Striche):            {:>8.2} ms", ms_read);

        let ms_move = median(5, || {
            let edit = core
                .heft_move_lasso(heft_id.clone(), page0_id.clone(), lasso_300.clone(), vec![], vec![], 10.0, 5.0)
                .unwrap();
            assert!(!edit.undo.is_empty());
        });
        println!("  Lasso verschieben (300 Striche):            {:>8.2} ms", ms_move);

        let ms_rotate = median(5, || {
            let edit = core
                .heft_rotate_lasso(
                    heft_id.clone(),
                    page0_id.clone(),
                    lasso_300.clone(),
                    vec![],
                    vec![],
                    500.0,
                    500.0,
                    0.25,
                )
                .unwrap();
            assert!(!edit.undo.is_empty());
        });
        println!("  Lasso drehen (300 Striche):                 {:>8.2} ms", ms_rotate);

        let move_edit = core
            .heft_move_lasso(heft_id.clone(), page0_id.clone(), lasso_300.clone(), vec![], vec![], 10.0, 5.0)
            .unwrap();
        let mut undo_json = move_edit.undo;
        let ms_undo = median(5, || {
            let next = core.heft_apply_ops(heft_id.clone(), undo_json.clone()).unwrap();
            undo_json = next.undo;
        });
        println!("  Undo/Redo (300 Striche):                    {:>8.2} ms", ms_undo);

        let ms_del_undo = median(5, || {
            let edit =
                core.heft_delete_lasso(heft_id.clone(), page0_id.clone(), del_50.clone(), vec![], vec![]).unwrap();
            core.heft_apply_ops(heft_id.clone(), edit.undo).unwrap();
        });
        println!("  Lasso löschen + Undo (50 Striche):          {:>8.2} ms", ms_del_undo);

        let ms_cp_save = median(3, || {
            // Kleines Event, damit save_checkpoint wirklich schreibt.
            let _ = core.create_page("Temp".into(), "x".into(), None, None).unwrap();
            let _ = core.save_checkpoint().unwrap();
        });
        println!("  Checkpoint speichern (nach 1 Notiz-Event):  {:>8.2} ms", ms_cp_save);
    }

    println!("\n=== Start-Abläufe (SQLite auf Disk) ===");
    {
        // Warmstart direkt vom Checkpoint (0 Tail-Events)
        let ms_warm = median(5, || {
            let core = ImpalaCore::open(db_path.clone()).unwrap();
            assert!(core.load_info().checkpoint_used);
        });
        println!("  Warmstart vom Checkpoint (0 Tail-Events):   {:>8.2} ms", ms_warm);

        // 50 Tail-Events nach dem Checkpoint
        {
            let core = ImpalaCore::open(db_path.clone()).unwrap();
            for i in 0..50 {
                core.create_page(format!("Tail {i}"), "Kurzer Text".into(), None, None).unwrap();
            }
        }
        let ms_tail = median(5, || {
            let core = ImpalaCore::open(db_path.clone()).unwrap();
            assert!(core.load_info().checkpoint_used);
            assert_eq!(core.load_info().replayed, 50);
        });
        println!("  Warmstart + 50 Tail-Events:                 {:>8.2} ms", ms_tail);

        // Kaltstart ohne Checkpoint (Voll-Replay)
        {
            let mut st = SqliteStorage::open(&db_path).unwrap();
            st.apply(vec![Write::DeleteCheckpoint(CheckpointSlot::Current)]).unwrap();
        }
        let ms_cold = median(3, || {
            let core = ImpalaCore::open(db_path.clone()).unwrap();
            assert!(!core.load_info().checkpoint_used);
        });
        println!("  Kaltstart ohne Checkpoint (Voll-Replay):    {:>8.2} ms", ms_cold);
    }

    println!("\n=== Sync-Abläufe (Pakete bauen, öffnen & Import) ===");
    {
        let core = ImpalaCore::open(db_path.clone()).unwrap();
        let export = core.export_json(false).unwrap();
        let val: Value = serde_json::from_str(&export).unwrap();
        let events: Vec<Value> = val["events"].as_array().cloned().unwrap_or_default();
        let key = CipherKey::from_bytes([7; 32]);
        let rng = CounterRandom::new(0);

        let mut built_packets = Vec::new();
        let ms_build = median(3, || {
            let wire: Vec<WireEvent> = events.iter().cloned().map(WireEvent::new).collect();
            built_packets = build_packets(&wire, ChunkLimits::default(), &key, &rng).unwrap();
        });
        let wire_packets: Vec<Value> = built_packets
            .iter()
            .enumerate()
            .map(|(i, p)| json!({ "seq": i + 1, "id": p.id, "iv": p.iv, "data": p.data }))
            .collect();
        let ms_open = median(3, || {
            let (ev, _) = open_packets(&key, &wire_packets, 0).unwrap();
            assert!(!ev.is_empty());
        });
        let ms_import = median(3, || {
            let fresh = ImpalaCore::open_in_memory().unwrap();
            let r = fresh.import_json(export.clone()).unwrap();
            assert!(r.added > 0);
        });
        println!("  Sync-Pakete packen & verschlüsseln ({} Ev): {:>8.2} ms", events.len(), ms_build);
        println!("  Sync-Pakete entschlüsseln & öffnen ({} Pkt): {:>7.2} ms", wire_packets.len(), ms_open);
        println!("  Voll-Import in leere DB ({} Events):        {:>8.2} ms", events.len(), ms_import);
    }

    let _ = std::fs::remove_dir_all(&dir);
}
