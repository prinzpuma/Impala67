//! Ende-zu-Ende-Ablauftests für Hefte: Seiten, Zeichnen, Radieren, Lasso (inkl. Bilder/Texte/Drehen),
//! Rückgängig/Wiederholen, Hintergründe und Fehler-Abwehr.

use std::f64::consts::FRAC_PI_2;

use crate::heft::{HeftShape, HeftStroke, HeftText};
use crate::heft_erase::HeftEraseGesture;
use crate::heft_items::{HeftChange, HeftRect, heft_fit_shape};
use crate::heft_lasso::heft_lasso_resize_factor;
use crate::{CoreError, ImpalaCore};

fn stroke(id: &str, pts: Vec<f32>) -> HeftStroke {
    HeftStroke { id: id.into(), tool: "pen".into(), color: "#1f2937".into(), size: 3.0, points: pts, shape: None }
}

#[test]
fn heft_seiten_lebenszyklus_und_schutz_der_letzten_seite() {
    let core = ImpalaCore::open_in_memory().unwrap();
    let heft = core.create_heft("Mathe Heft".into(), None, None).unwrap();
    let p1 = core.heft_page_ids(heft.clone())[0].clone();

    // Letzte Seite darf nicht gelöscht werden.
    assert!(core.heft_remove_page(heft.clone(), p1.clone()).is_err());

    let p2 = core.heft_add_page(heft.clone(), None, Some("grid".into())).unwrap();
    let p3 = core.heft_add_page(heft.clone(), Some(1), Some("dots".into())).unwrap();
    assert_eq!(core.heft_page_ids(heft.clone()), [p1.clone(), p3.clone(), p2.clone()]);

    // Seite verschieben und rückgängig machen.
    let mv = core.heft_move_page(heft.clone(), p2.clone(), 0).unwrap();
    assert_eq!(core.heft_page_ids(heft.clone()), [p2.clone(), p1.clone(), p3.clone()]);
    let redo = core.heft_apply_ops(heft.clone(), mv.undo).unwrap();
    assert_eq!(core.heft_page_ids(heft.clone()), [p1.clone(), p3.clone(), p2.clone()]);
    core.heft_apply_ops(heft.clone(), redo.undo).unwrap();
    assert_eq!(core.heft_page_ids(heft.clone()), [p2.clone(), p1.clone(), p3.clone()]);

    // Auch ein Batch in `heft_apply` darf nicht ALLE Seiten eines Hefts entfernen!
    let drop_all = core.heft_apply(
        heft.clone(),
        vec![
            HeftChange::RemovePage { page: p1.clone() },
            HeftChange::RemovePage { page: p2.clone() },
            HeftChange::RemovePage { page: p3.clone() },
        ],
    );
    assert!(
        matches!(drop_all, Err(CoreError::Invalid { .. })),
        "Batch-RemovePage darf das Heft nicht leer zurücklassen: {drop_all:?}"
    );
    assert_eq!(core.heft_page_ids(heft.clone()).len(), 3);

    // Zwei von drei Seiten in einem Batch löschen ist erlaubt (eine bleibt).
    let drop_two = core
        .heft_apply(heft.clone(), vec![HeftChange::RemovePage { page: p2 }, HeftChange::RemovePage { page: p3 }])
        .unwrap();
    assert_eq!(core.heft_page_ids(heft.clone()), [p1]);

    // Rückgängig stellt beide gelöschten Seiten wieder her.
    core.heft_apply_ops(heft.clone(), drop_two.undo).unwrap();
    assert_eq!(core.heft_page_ids(heft).len(), 3);
}

#[test]
fn heft_zeichnen_formen_und_radierer_ablauf() {
    let core = ImpalaCore::open_in_memory().unwrap();
    let heft = core.create_heft("Geometrie".into(), None, None).unwrap();
    let hp = core.heft_page_ids(heft.clone())[0].clone();

    // Lange horizontale Linie zeichnen und per präzisem Radierer in der Mitte teilen.
    let pts: Vec<f32> = (0..=20).flat_map(|i| [100.0 + i as f32 * 10.0, 200.0, 0.5]).collect();
    let s1 = stroke("line-1", pts.clone());
    core.heft_commit_strokes(heft.clone(), hp.clone(), vec![s1], vec![]).unwrap();

    // Form-Erkennung für eine gerade Linie prüfen und als Form speichern.
    let fitted = heft_fit_shape(pts).expect("Gerade Linie sollte als Form erkannt werden");
    let shape_edit = core.heft_add_shape(heft.clone(), hp.clone(), "#2563eb".into(), 2.0, fitted).unwrap();
    assert_eq!(shape_edit.ids.len(), 1);
    let shape_id = shape_edit.ids[0].clone();

    // Präzises Radieren auf der ersten Linie bei x=200 (Mitte).
    let before = core.heft_page(heft.clone(), hp.clone()).unwrap();
    assert_eq!(before.strokes.len(), 2);
    let gesture = HeftEraseGesture::new(before.strokes, 10.0, "precise".into()).unwrap();
    let hits = gesture.erase_at(200.0, 200.0);
    assert!(!hits.is_empty());
    let net = gesture.net();
    assert!(net.removed.contains(&"line-1".to_owned()));
    assert!(net.added.len() >= 2, "Linie sollte in mindestens 2 Stücke geteilt werden");

    // Netto-Ergebnis ins Heft schreiben.
    core.heft_commit_strokes(heft.clone(), hp.clone(), net.added.clone(), net.removed.clone()).unwrap();
    let after = core.heft_page(heft.clone(), hp.clone()).unwrap();
    assert!(!after.strokes.iter().any(|s| s.id == "line-1"));
    assert!(after.strokes.iter().any(|s| s.id == shape_id) || net.removed.contains(&shape_id));

    // Strich-Radierer entfernt ganzen Strich.
    let remaining_id = after.strokes[0].id.clone();
    let g2 = HeftEraseGesture::new(after.strokes, 15.0, "stroke".into()).unwrap();
    let x = core.heft_page(heft.clone(), hp.clone()).unwrap().strokes[0].points[0] as f64;
    let y = core.heft_page(heft.clone(), hp.clone()).unwrap().strokes[0].points[1] as f64;
    g2.erase_at(x, y);
    let net2 = g2.net();
    assert!(net2.removed.contains(&remaining_id));
    assert!(net2.added.is_empty());
}

#[test]
fn heft_lasso_gemischt_verschieben_skalieren_drehen_duplizieren_und_undo_kette() {
    let core = ImpalaCore::open_in_memory().unwrap();
    let heft = core.create_heft("Lasso".into(), None, None).unwrap();
    let hp = core.heft_page_ids(heft.clone())[0].clone();

    // Strich, Bild und Textfeld im Bereich (100..300, 100..300) anlegen.
    let s_id = core
        .heft_add_stroke(
            heft.clone(),
            hp.clone(),
            "pen".into(),
            "#000".into(),
            3.0,
            vec![120.0, 120.0, 0.5, 180.0, 180.0, 0.5],
        )
        .unwrap();
    let img_edit = core
        .heft_add_image(heft.clone(), hp.clone(), vec![1, 2, 3, 4], "image/png".into(), 200.0, 120.0, 80.0, 60.0)
        .unwrap();
    let img_id = img_edit.ids[0].clone();
    let txt_edit = core
        .heft_add_text(
            heft.clone(),
            hp.clone(),
            "Formel".into(),
            140.0,
            220.0,
            Some(120.0),
            Some("#000".into()),
            Some(16.0),
        )
        .unwrap();
    let txt_id = txt_edit.ids[0].clone();

    let snapshot_before = core.heft_page(heft.clone(), hp.clone()).unwrap();

    // Lasso-Auswahl umschließt alle drei Elemente.
    let poly = vec![80.0, 80.0, 320.0, 80.0, 320.0, 320.0, 80.0, 320.0];
    let sel = core.heft_select_lasso(heft.clone(), hp.clone(), poly).unwrap();
    assert_eq!(sel.stroke_ids, std::slice::from_ref(&s_id));
    assert_eq!(sel.image_ids, std::slice::from_ref(&img_id));
    assert_eq!(sel.text_ids, std::slice::from_ref(&txt_id));
    let bounds = sel.bounds.expect("Auswahlrahmen erwartet");

    // 1) Verschieben
    let e_move = core
        .heft_move_lasso(
            heft.clone(),
            hp.clone(),
            sel.stroke_ids.clone(),
            sel.image_ids.clone(),
            sel.text_ids.clone(),
            50.0,
            30.0,
        )
        .unwrap();

    // 2) Skalieren
    let e_scale = core
        .heft_scale_lasso(
            heft.clone(),
            hp.clone(),
            sel.stroke_ids.clone(),
            sel.image_ids.clone(),
            sel.text_ids.clone(),
            bounds.min_x + 50.0,
            bounds.min_y + 30.0,
            1.5,
        )
        .unwrap();

    // 3) Drehen um 90 Grad
    let cx = (bounds.min_x + bounds.max_x) / 2.0 + 50.0;
    let cy = (bounds.min_y + bounds.max_y) / 2.0 + 30.0;
    let e_rot = core
        .heft_rotate_lasso(
            heft.clone(),
            hp.clone(),
            sel.stroke_ids.clone(),
            sel.image_ids.clone(),
            sel.text_ids.clone(),
            cx,
            cy,
            FRAC_PI_2,
        )
        .unwrap();

    let snapshot_transformed = core.heft_page(heft.clone(), hp.clone()).unwrap();
    assert_ne!(snapshot_transformed.strokes, snapshot_before.strokes);
    assert_ne!(snapshot_transformed.images, snapshot_before.images);
    assert_ne!(snapshot_transformed.texts, snapshot_before.texts);

    // Alle 3 Schritte rückgängig machen -> exakter Ausgangszustand!
    let r_rot = core.heft_apply_ops(heft.clone(), e_rot.undo).unwrap();
    let r_scale = core.heft_apply_ops(heft.clone(), e_scale.undo).unwrap();
    let r_move = core.heft_apply_ops(heft.clone(), e_move.undo).unwrap();
    let after_undo = core.heft_page(heft.clone(), hp.clone()).unwrap();
    assert_eq!(after_undo.strokes, snapshot_before.strokes);
    assert_eq!(after_undo.images, snapshot_before.images);
    assert_eq!(after_undo.texts, snapshot_before.texts);

    // Alle 3 Schritte wiederholen -> exakter transformierter Zustand!
    core.heft_apply_ops(heft.clone(), r_move.undo).unwrap();
    core.heft_apply_ops(heft.clone(), r_scale.undo).unwrap();
    core.heft_apply_ops(heft.clone(), r_rot.undo).unwrap();
    let after_redo = core.heft_page(heft.clone(), hp.clone()).unwrap();
    assert_eq!(after_redo.strokes, snapshot_transformed.strokes);
    assert_eq!(after_redo.images, snapshot_transformed.images);
    assert_eq!(after_redo.texts, snapshot_transformed.texts);

    // Duplizieren & Löschen
    let dup = core.heft_duplicate_lasso(heft.clone(), hp.clone(), sel.stroke_ids, sel.image_ids, sel.text_ids).unwrap();
    assert_eq!(dup.stroke_ids.len(), 1);
    assert_eq!(dup.image_ids.len(), 1);
    assert_eq!(dup.text_ids.len(), 1);
    let after_dup = core.heft_page(heft.clone(), hp.clone()).unwrap();
    assert_eq!(after_dup.strokes.len(), 2);
    assert_eq!(after_dup.images.len(), 2);
    assert_eq!(after_dup.texts.len(), 2);

    let del = core.heft_delete_lasso(heft.clone(), hp.clone(), dup.stroke_ids, dup.image_ids, dup.text_ids).unwrap();
    let after_del = core.heft_page(heft.clone(), hp.clone()).unwrap();
    assert_eq!(after_del.strokes.len(), 1);
    assert_eq!(after_del.images.len(), 1);
    assert_eq!(after_del.texts.len(), 1);
    core.heft_apply_ops(heft.clone(), del.undo).unwrap();
    assert_eq!(core.heft_page(heft, hp).unwrap().strokes.len(), 2);
}

#[test]
fn heft_weist_nan_und_infinity_bei_lasso_und_text_ab() {
    let core = ImpalaCore::open_in_memory().unwrap();
    let heft = core.create_heft("Validierung".into(), None, None).unwrap();
    let hp = core.heft_page_ids(heft.clone())[0].clone();
    let s_id = core
        .heft_add_stroke(
            heft.clone(),
            hp.clone(),
            "pen".into(),
            "#000".into(),
            3.0,
            vec![10.0, 10.0, 0.5, 50.0, 50.0, 0.5],
        )
        .unwrap();

    // NaN/Infinity bei Lasso-Verschiebung, Skalierung und Drehung müssen abgewiesen werden!
    assert!(
        core.heft_move_lasso(heft.clone(), hp.clone(), vec![s_id.clone()], vec![], vec![], f64::NAN, 0.0).is_err(),
        "NaN dx in heft_move_lasso muss abgelehnt werden"
    );
    assert!(
        core.heft_move_lasso(heft.clone(), hp.clone(), vec![s_id.clone()], vec![], vec![], 0.0, f64::INFINITY).is_err(),
        "Inf dy in heft_move_lasso muss abgelehnt werden"
    );
    assert!(
        core.heft_scale_lasso(heft.clone(), hp.clone(), vec![s_id.clone()], vec![], vec![], f64::NAN, 0.0, 1.5)
            .is_err(),
        "NaN ax in heft_scale_lasso muss abgelehnt werden"
    );
    assert!(
        core.heft_rotate_lasso(heft.clone(), hp.clone(), vec![s_id.clone()], vec![], vec![], 0.0, f64::INFINITY, 0.5)
            .is_err(),
        "Inf cy in heft_rotate_lasso muss abgelehnt werden"
    );

    // NaN/Infinity in Textfeld-Breite/Höhe/Größe müssen abgewiesen werden!
    assert!(
        core.heft_add_text(heft.clone(), hp.clone(), "Hi".into(), 10.0, 10.0, Some(f64::NAN), None, None).is_err(),
        "NaN Breite im Textfeld muss abgelehnt werden"
    );
    assert!(
        core.heft_add_text(heft.clone(), hp.clone(), "Hi".into(), 10.0, 10.0, None, None, Some(f64::INFINITY)).is_err(),
        "Inf Schriftgröße im Textfeld muss abgelehnt werden"
    );
    assert!(
        core.heft_set_text(
            heft.clone(),
            hp.clone(),
            HeftText {
                id: "t1".into(),
                text: "x".into(),
                x: 10.0,
                y: 10.0,
                w: None,
                h: Some(f64::NAN),
                color: None,
                size: None,
            }
        )
        .is_err(),
        "NaN Höhe im Textfeld muss abgelehnt werden"
    );

    // `heft_lasso_resize_factor` darf bei `start_dist <= 0` kein NaN liefern.
    let bounds = HeftRect { min_x: 10.0, min_y: 10.0, max_x: 100.0, max_y: 100.0 };
    let f = heft_lasso_resize_factor(10.0, 10.0, 10.0, 10.0, 0.0, 50.0, 50.0, bounds);
    assert!(f.is_finite() && f > 0.0, "heft_lasso_resize_factor lieferte ungültigen Wert: {f}");

    // Vorheriger Strich ist komplett unversehrt.
    let pg = core.heft_page(heft, hp).unwrap();
    assert_eq!(pg.strokes.len(), 1);
    assert!(pg.strokes[0].points.iter().all(|v| v.is_finite()));
}

#[test]
fn heft_hintergrundseite_und_shape_roundtrip() {
    let core = ImpalaCore::open_in_memory().unwrap();
    let heft = core.create_heft("Arbeitsblatt".into(), None, None).unwrap();
    let jpeg = vec![0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3];
    let bg_page = core
        .heft_add_background_page(
            heft.clone(),
            None,
            jpeg.clone(),
            "image/jpeg".into(),
            1000.0,
            1414.0,
            Some("Aufgabe 1: Berechne x".into()),
        )
        .unwrap();

    let pg = core.heft_page(heft.clone(), bg_page.clone()).unwrap();
    assert_eq!(pg.paper, "blank");
    assert_eq!(pg.images.len(), 1);
    assert!(pg.images[0].background);
    assert_eq!(pg.ocr_text, "Aufgabe 1: Berechne x");
    let data = core.heft_image_data(heft.clone(), bg_page.clone(), pg.images[0].id.clone()).unwrap().unwrap();
    assert_eq!(data.bytes, jpeg);
    assert_eq!(data.mime, "image/jpeg");

    // Rechteck-Form speichern und wieder lesen.
    let rect = HeftShape::Rect { x1: 50.0, y1: 60.0, x2: 250.0, y2: 160.0 };
    core.heft_add_shape(heft.clone(), bg_page.clone(), "#dc2626".into(), 4.0, rect.clone()).unwrap();
    let pg2 = core.heft_page(heft, bg_page).unwrap();
    assert_eq!(pg2.strokes.len(), 1);
    assert_eq!(pg2.strokes[0].shape, Some(rect));
    assert!(!pg2.strokes[0].points.is_empty());
}
