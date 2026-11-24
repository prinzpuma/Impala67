//! Verhalten, das die Golden-Files nicht abdecken: bewusste Abweichungen vom JS, SVG-Export,
//! Hilfen für die Eingabe.

use impala_heft::diff::{Shadow, diff_document, diff_pages};
use impala_heft::doc::{HeftDoc, HeftPage, Image, Paper, Point, Shape, Stroke, TextBox, Tool};
use impala_heft::eraser::StrokeEraser;
use impala_heft::export::{EXPORT_W, export_file_name, page_canvas_size, pdf_image_box};
use impala_heft::ink::{SvgOptions, content_bottom, page_svg, quantize_point, segment_width};
use impala_heft::lasso::{lasso_resize_factor, lasso_resize_start_dist};
use impala_heft::ops::{HeftEvent, HeftOp, Hefte, Item, parse_ops};
use serde_json::{Value, json};

fn pen(id: &str, pts: &[[f64; 2]]) -> Stroke {
    Stroke {
        id: id.into(),
        tool: Some(Tool::Pen),
        color: Some("#000".into()),
        size: Some(3.0),
        pts: pts.iter().map(|p| Point::new(p[0], p[1], 0.5)).collect(),
        ..Default::default()
    }
}

#[test]
fn kreis_hat_grenzen_und_skaliert_den_radius() {
    // JS verliert beim Kreis die Grenzen (liest rx/ry) und skaliert den Radius nicht.
    let mut s = pen("k", &[[0.0, 0.0]]);
    s.tool = Some(Tool::Shape);
    s.shape = Some(Shape::Circle { cx: 100.0, cy: 100.0, r: 10.0 });
    let b = s.bounds().unwrap();
    assert_eq!((b.min_x, b.max_x), (-10.0, 120.0)); // Punkt bei 0 plus Rand 10
    let g = s.geometry();
    s.scale_from(&g, 100.0, 100.0, 2.0);
    assert_eq!(s.shape, Some(Shape::Circle { cx: 100.0, cy: 100.0, r: 20.0 }));
    assert!(s.hit_at(120.0, 100.0, 1.0));
}

#[test]
fn zahlen_wie_json_stringify() {
    let s = pen("a", &[[1.0, 2.5]]);
    assert_eq!(
        serde_json::to_string(&s).unwrap(),
        r##"{"id":"a","tool":"pen","color":"#000","size":3,"pts":[[1,2.5,0.5]]}"##
    );
    let p = Point { x: f64::NAN, y: 1.0, p: None, t: Some(5.0) };
    assert_eq!(serde_json::to_string(&p).unwrap(), "[null,1,null,5]");
}

#[test]
fn fremde_felder_bleiben_erhalten() {
    let v = json!({ "id": "s", "tool": "pen", "size": "dick", "pts": [[1, 2, 0.5]], "opacity": 0.4, "zukunft": { "a": [1] } });
    let s = Stroke::from_value(v.clone()).unwrap();
    assert_eq!(s.size, None);
    assert_eq!(serde_json::to_value(&s).unwrap(), v);
    // Ein später gesetztes Feld verdrängt den Fremdwert, statt doppelt geschrieben zu werden.
    let mut s = s;
    s.size = Some(2.0);
    assert_eq!(serde_json::to_value(&s).unwrap()["size"], json!(2));
}

#[test]
fn unbekannte_ops_bleiben_im_log() {
    let raw =
        json!([{ "t": "zz", "x": 1 }, null, { "t": "s+", "p": "a" }, { "t": "pg+", "at": 2, "page": { "id": "n" } }]);
    let ops = parse_ops(raw.clone());
    assert!(matches!(ops[0], HeftOp::Other(_)));
    assert!(matches!(ops[3], HeftOp::PageAdd { .. }));
    assert_eq!(serde_json::to_value(&ops).unwrap(), raw);
}

#[test]
fn ops_sind_idempotent_und_vertauschbar() {
    // Zwei Geräte zeichnen gleichzeitig: Reihenfolge von Hinzufügen egal, Doppeltes zählt einmal.
    // (Ein erneutes Hinzufügen NACH dem Löschen holt den Strich zurück – wie in JS; der Sync
    // stellt jedes Event nur einmal zu.)
    let base = vec![HeftOp::PageAdd { at: None, page: "p".into(), paper: None, height: None }];
    let a = HeftOp::Add { page: "p".into(), item: Item::Stroke(pen("a", &[[1.0, 1.0]])) };
    let b = HeftOp::Add { page: "p".into(), item: Item::Stroke(pen("b", &[[2.0, 2.0]])) };
    let del = HeftOp::Remove { page: "p".into(), kind: impala_heft::ItemKind::Stroke, ids: vec!["a".into()] };
    let mut x = HeftDoc::default();
    x.apply_ops(base.clone());
    let mut y = x.clone();
    x.apply_ops([a.clone(), b.clone(), del.clone()]);
    y.apply_ops([b, a.clone(), a, del.clone(), del]);
    assert_eq!(x.pages[0].strokes.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["b"]);
    assert_eq!(x.pages, y.pages);
}

#[test]
fn leere_op_liste_zaehlt_nicht() {
    let mut d = HeftDoc::default();
    assert!(!d.apply_ops(Vec::new()));
    assert_eq!(d.rev, 0);
    assert!(HeftEvent::from_payload("heftOps", json!({ "pageId": "h", "ops": [] })).is_none());
}

#[test]
fn diff_ignoriert_hoehe_und_innere_punkte() {
    let mut doc = HeftDoc::default();
    let mut page = HeftPage::empty("p", Paper::Grid);
    page.strokes.push(pen("s", &[[0.0, 0.0], [5.0, 5.0], [10.0, 0.0]]));
    page.texts.push(TextBox {
        id: "t".into(),
        x: Some(1.0),
        y: Some(1.0),
        text: Some("a".into()),
        h: Some(40.0),
        ..Default::default()
    });
    doc.pages.push(page);
    let shadow = Shadow::of(&doc);
    let mut next = doc.clone();
    next.pages[0].strokes[0].pts[1].x = 7.0; // innerer Punkt: keine Änderung
    next.pages[0].strokes[0].tool = Some(Tool::Marker); // Werkzeug: keine Änderung (wie JS)
    next.pages[0].texts[0].h = Some(80.0);
    next.pages[0].texts[0].extra.insert("hidden".into(), json!(true));
    assert!(diff_document(Some(&shadow), &next).0.is_empty());
    next.pages[0].texts[0].text = Some("b".into());
    let (ops, _) = diff_document(Some(&shadow), &next);
    assert_eq!(serde_json::to_value(&ops).unwrap()[0]["t"], "x=");
}

#[test]
fn radierer_drosselt_kleine_schritte() {
    let mut list = vec![pen("a", &[[0.0, 0.0], [100.0, 0.0]]), pen("b", &[[0.0, 50.0], [100.0, 50.0]])];
    let mut e = StrokeEraser::new(30.0); // Drossel: 0,35 · 30 = 10,5
    assert!(e.erase_at(&mut list, 50.0, 90.0).is_empty()); // b ist 40 entfernt (> 30 + 1,5)
    assert!(e.erase_at(&mut list, 50.0, 81.0).is_empty()); // träfe b, aber nur 9 bewegt
    assert_eq!(list.len(), 2);
    let gone = e.erase_at(&mut list, 50.0, 79.0);
    assert_eq!(gone.iter().map(|c| c.removed.id.as_str()).collect::<Vec<_>>(), ["b"]);
    assert_eq!(list.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["a"]);
}

#[test]
fn svg_export() {
    let mut page = HeftPage::empty("p", Paper::Lined);
    page.strokes.push(pen("a", &[[10.0, 10.0], [20.0, 20.0], [30.0, 10.0]]));
    page.strokes.push(pen("dot", &[[40.0, 40.0]]));
    let mut marker = pen("m", &[[0.0, 0.0], [5.0, 5.0]]);
    marker.tool = Some(Tool::Marker);
    page.strokes.push(marker);
    page.texts.push(TextBox {
        id: "t".into(),
        x: Some(0.0),
        y: Some(0.0),
        text: Some("a<b\nc".into()),
        ..Default::default()
    });
    page.images.push(Image {
        id: "i".into(),
        r#ref: Some("H".into()),
        x: Some(1.0),
        y: Some(2.0),
        w: Some(3.0),
        h: Some(4.0),
        ..Default::default()
    });
    let href = |im: &Image| im.r#ref.as_ref().map(|r| format!("data:{r}"));
    let svg = page_svg(&page, &SvgOptions { paper_ink: "#6b8cae", image_href: &href });
    assert!(svg.starts_with("<svg") && svg.ends_with("</svg>"));
    assert_eq!(svg.matches("Q").count(), 2, "zwei geglättete Stücke");
    assert!(svg.contains(r#"<circle cx="40" cy="40""#));
    assert!(svg.contains(r#"opacity="0.32""#));
    assert!(svg.contains("a&lt;b</tspan>"));
    assert!(svg.contains(r#"href="data:H""#));
    assert!(svg.contains("M90 40V1374"), "Randlinie");
}

#[test]
fn eingabe_hilfen() {
    let p = quantize_point(123.456, 10.04, 2.0, None);
    assert_eq!((p.x, p.y, p.p), (61.7, 5.0, Some(0.5)));
    assert!((segment_width(3.0, Some(1.0)) - 4.8).abs() < 1e-12);
    assert_eq!(segment_width(0.1, Some(0.0)), 0.5);
    let bb = impala_heft::BBox { min_x: 100.0, min_y: 100.0, max_x: 200.0, max_y: 200.0 };
    let anchor = [100.0, 100.0];
    let start = [208.0, 208.0];
    let d = lasso_resize_start_dist(anchor, start);
    assert!((lasso_resize_factor(anchor, start, d, start, &bb) - 1.0).abs() < 1e-12);
    // Ziehen weit nach außen: höchstens bis an den Seitenrand (x: 900/100 = 9 → 6 ist kleiner).
    assert_eq!(lasso_resize_factor(anchor, start, d, [5000.0, 5000.0], &bb), 6.0);
    assert_eq!(lasso_resize_factor(anchor, start, d, [0.0, 0.0], &bb), 0.15);
}

#[test]
fn export_und_seiten() {
    assert_eq!(page_canvas_size(EXPORT_W), (2480, 3507, 2.48));
    let (w, h, x, y) = pdf_image_box(2480, 3507);
    assert!((w - 595.28).abs() < 0.01 && h <= 841.89 && x.abs() < 1e-9 && y > 0.0);
    assert_eq!(export_file_name(Some("😀".repeat(41).as_str())).chars().count(), 40);
    let mut page = HeftPage::empty("p", Paper::Blank);
    assert_eq!(content_bottom(&page), 40.0);
    page.texts.push(TextBox { id: "t".into(), x: Some(0.0), y: Some(100.0), ..Default::default() });
    assert_eq!(content_bottom(&page), 160.0);
}

#[test]
fn hefte_und_altbestaende() {
    let mut h = Hefte::default();
    let ev = HeftEvent::from_payload(
        "heftOps",
        json!({ "pageId": "h", "ops": [{ "t": "pg+", "page": { "id": "p" } }, { "t": "i+", "p": "p", "o": { "id": "i", "ref": "B", "x": 0, "y": 0, "w": 1, "h": 1 } }] }),
    );
    assert!(h.apply(ev.unwrap()));
    assert!(h.apply(HeftEvent::Blob { hash: "B".into(), data: "data:1".into() }));
    assert!(!h.apply(HeftEvent::Blob { hash: "B".into(), data: "data:2".into() }));
    assert_eq!(h.blobs["B"], "data:1");
    assert_eq!(h.referenced_blobs(), ["B"]);
    assert_eq!(h.get("h").unwrap().byte_estimate(|r| h.blobs.get(r).map_or(0, |d| d.len())), 66);

    let mut n = 0;
    let mut id = || {
        n += 1;
        format!("n{n}")
    };
    let (doc, blobs) = HeftDoc::from_legacy_ink(&json!({ "strokes": [{ "pts": [[1, 2, 0.5]] }] }), &mut id).unwrap();
    assert_eq!(doc.pages.len(), 1);
    assert_eq!((doc.pages[0].id.as_str(), doc.pages[0].strokes[0].id.as_str()), ("n1", "n2"));
    assert!(blobs.is_empty());
    assert!(HeftDoc::from_legacy_ink(&json!({ "strokes": [] }), &mut id).is_none());
    assert_eq!(HeftDoc::from_value(Value::Null), HeftDoc::default());
}

/// Alle Objekte (rekursiv) eines Golden-Files, die wie ein Heft oder eine Heftseite aussehen.
fn heft_like(v: &Value, out: &mut Vec<Value>) {
    match v {
        Value::Object(o) => {
            if o.contains_key("pages") || o.contains_key("strokes") {
                out.push(v.clone());
            }
            o.values().for_each(|x| heft_like(x, out));
        }
        Value::Array(a) => a.iter().for_each(|x| heft_like(x, out)),
        _ => {}
    }
}

#[test]
fn typisiert_wie_from_value() {
    // Schnelles Einlesen (Checkpoint-Teile) muss dasselbe ergeben wie der Weg über `Value`.
    let mut cases = vec![
        json!({ "v": 2, "rev": 3, "pages": [{ "id": "p", "paper": "dots", "ocrText": "x", "extra": 1,
            "strokes": [
                { "id": "a", "pts": [[1, 2, 0.5], [3.5, 4], [5, 6, null], [7, 8, 0.1, 99], "kaputt", [], [null, "y"]], "size": 2, "foo": [1] },
                { "id": 5, "tool": "marker", "pts": "keine Liste", "bbox": { "minX": 1, "minY": 2, "maxX": 3, "maxY": 4 } },
                { "pts": { "x": 1 } },
                "kein Strich", 7, null, [1, 2],
                { "id": "s", "shape": { "type": "line", "x1": 1, "y1": 2, "x2": 3, "y2": 4 }, "pts": [] }
            ],
            "images": [{ "id": "i", "ref": "r", "x": 1, "y": 2, "w": 3, "h": 4, "ocr": "" }, "x"],
            "texts": [{ "id": "t", "text": "Hallo", "x": 1, "y": 2 }] },
            null, "seite", { "strokes": "nein" }, { "id": "leer" }], "zusatz": { "a": 1 } }),
        json!({ "pages": "keine Liste" }),
        json!({}),
        json!(null),
        json!([1, 2]),
    ];
    for file in ["reducer.json", "diff.json", "render.json", "misc.json", "lasso.json"] {
        let text = std::fs::read_to_string(format!("{}/tests/golden/{file}", env!("CARGO_MANIFEST_DIR"))).unwrap();
        heft_like(&serde_json::from_str(&text).unwrap(), &mut cases);
    }
    assert!(cases.len() > 20);
    for case in cases {
        let text = case.to_string();
        // Debug-Text statt ==: NaN (Punkt mit `null`) ist sich selbst nicht gleich.
        let fast: HeftDoc = serde_json::from_str(&text).unwrap();
        assert_eq!(format!("{fast:?}"), format!("{:?}", HeftDoc::from_value(case.clone())), "{text}");
        let page: HeftPage = serde_json::from_str(&text).unwrap();
        assert_eq!(format!("{page:?}"), format!("{:?}", HeftPage::from_value(case.clone())), "{text}");
        // Gleiches JSON beim Zurückschreiben (Reihenfolge der Felder inklusive).
        assert_eq!(serde_json::to_string(&fast).unwrap(), serde_json::to_string(&HeftDoc::from_value(case)).unwrap());
    }
}

#[test]
fn seitenhintergrund_mit_update_hinweis_fuer_alte_apps() {
    use impala_heft::diff::diff_document;
    use impala_heft::doc::{HeftDoc, bg_note_id};
    use impala_heft::ops::HeftOp;
    use serde_json::json;

    let base = HeftDoc::from_value(json!({ "v": 2, "pages": [{ "id": "p1", "paper": "blank" }] }));
    let (_, shadow) = diff_document(None, &base);
    let next = HeftDoc::from_value(json!({ "v": 2, "pages": [{ "id": "p1", "paper": "blank",
        "bg": { "id": "b1", "ref": "bx-1", "x": 0, "y": 0, "w": 1000, "h": 1414, "ocr": "Aufgabe 1" } }] }));
    let (ops, shadow) = diff_document(Some(&shadow), &next);
    assert!(matches!(&ops[0], HeftOp::PageBackground { bg: Some(_), .. }));
    let ops_json = serde_json::to_value(&ops).unwrap();
    assert_eq!(ops_json[0]["t"], "pgb");
    assert_eq!(ops_json[1]["t"], "x+");
    assert_eq!(ops_json[1]["o"]["id"], bg_note_id("p1"));

    // Neue App: Hintergrund da, Hinweis ausgeblendet (kein Textfeld), Suche findet den PDF-Text.
    let mut doc = base.clone();
    doc.apply_ops(ops.iter().cloned());
    let pg = &doc.pages[0];
    assert_eq!(pg.background.as_ref().and_then(|b| b.r#ref.as_deref()), Some("bx-1"));
    assert!(pg.texts.is_empty() && pg.bg_note.is_some());
    assert_eq!(impala_heft::doc::compose_page_text("", pg), "Aufgabe 1");
    assert!(doc.pages[0].all_images().any(|i| i.id == "b1"));

    // Gespeichert und wieder gelesen; ältere Speicherstände tragen den Hinweis unter `texts`.
    let round = HeftDoc::from_value(serde_json::to_value(&doc).unwrap());
    assert_eq!(round, doc);
    // Gespeichert steht der Hinweis in `texts` (ältere Apps zeigen ihn), die Ansicht lässt ihn weg
    // und trägt ihn wieder eingelesen trotzdem.
    let stored = serde_json::to_value(&doc).unwrap();
    assert_eq!(stored["pages"][0]["texts"][0]["id"], bg_note_id("p1"));
    let view = serde_json::to_value(impala_heft::doc::DocView(&doc)).unwrap();
    assert_eq!(view["pages"][0]["texts"], json!([]));
    assert_eq!(HeftDoc::from_value(view), doc);
    // Ab leerem Heft (erstes Speichern) kommt der Hinweis ebenso mit.
    let (ops, _) = diff_document(None, &HeftDoc::from_value(serde_json::to_value(impala_heft::doc::DocView(&next)).unwrap()));
    assert!(serde_json::to_value(&ops).unwrap().as_array().unwrap().iter().any(|o| o["o"]["id"] == bg_note_id("p1")));

    // Ohne Änderung kein neuer Diff; Entfernen nimmt auch den Hinweis mit.
    assert!(diff_document(Some(&shadow), &next).0.is_empty());
    let mut cleared = next.clone();
    cleared.pages[0].background = None;
    let (ops, _) = diff_document(Some(&shadow), &cleared);
    doc.apply_ops(ops);
    assert!(doc.pages[0].background.is_none() && doc.pages[0].bg_note.is_none());
}

#[test]
fn altbestand_seitenfuellende_bilder_werden_hintergrund() {
    use impala_heft::background::adopt_background_ops;
    use impala_heft::doc::HeftDoc;
    use serde_json::json;

    let mut doc = HeftDoc::from_value(json!({ "v": 2, "pages": [
        { "id": "pdf", "paper": "blank", "images": [{ "id": "a", "ref": "bx-1", "x": 0, "y": 0, "w": 1000, "h": 1414, "ocr": "Blatt" }] },
        { "id": "scan", "paper": "blank", "images": [{ "id": "b", "ref": "bx-2", "x": 0, "y": 57, "w": 1000, "h": 1300, "scan": true }] },
        { "id": "foto", "paper": "blank", "images": [{ "id": "c", "ref": "bx-3", "x": 150, "y": 200, "w": 700, "h": 500 }] },
        { "id": "liniert", "paper": "lined", "images": [{ "id": "d", "ref": "bx-4", "x": 0, "y": 0, "w": 1000, "h": 1414 }] }
    ] }));
    let ops = adopt_background_ops(&doc);
    doc.apply_ops(ops);
    let bg = |i: usize| doc.pages[i].background.as_ref().map(|b| b.id.as_str());
    assert_eq!((bg(0), bg(1), bg(2), bg(3)), (Some("a"), Some("b"), None, None));
    assert!(doc.pages[0].images.is_empty() && doc.pages[0].bg_note.is_some());
    assert_eq!(doc.pages[1].background.as_ref().unwrap().extra.get("scan"), Some(&json!(true)));
    assert_eq!(impala_heft::doc::compose_page_text("", &doc.pages[0]), "Blatt");
    assert!(adopt_background_ops(&doc).is_empty());
}

#[test]
fn erkennung_liest_hintergrund_und_handschrift_zusammen() {
    use impala_heft::doc::HeftDoc;
    use impala_heft::ocr::{background_needs_text, content_key, record_ops};
    use serde_json::json;

    let mut doc = HeftDoc::from_value(json!({ "v": 2, "pages": [{ "id": "p", "paper": "blank",
        "bg": { "id": "b", "ref": "bx-1", "x": 0, "y": 0, "w": 1000, "h": 1414 } }] }));
    let pg = &doc.pages[0];
    assert!(background_needs_text(pg));
    let key = content_key(pg);
    let ops = record_ops(pg, "", Some("Aufgabe 1: Integral"), "apple", Some(&key));
    assert_eq!(ops.len(), 2);
    doc.apply_ops(ops);
    let pg = &doc.pages[0];
    assert!(!background_needs_text(pg));
    assert_eq!(pg.ocr_text, "Aufgabe 1: Integral");
    // Veralteter Stand: nichts speichern.
    assert!(record_ops(pg, "neu", None, "apple", Some("alt")).is_empty());
}

#[test]
fn seite_uebernimmt_format_des_hintergrunds() {
    use impala_heft::background::background_fit;
    use impala_heft::doc::HeftDoc;
    use serde_json::json;

    // A4 hoch, A4 quer, sehr lang (begrenzt, eingepasst).
    assert_eq!(background_fit(2480.0, 3508.0).0.round(), 1415.0);
    let (h, [x, y, w, ih]) = background_fit(3508.0, 2480.0);
    assert_eq!((h.round(), x, y, w), (707.0, 0.0, 0.0, 1000.0));
    assert!((ih - h).abs() < 1e-9);
    let (h, [x, _, w, _]) = background_fit(1000.0, 5000.0);
    assert_eq!(h, 2828.0);
    assert!(x > 0.0 && w < 1000.0);

    // Höhe reist mit `pg+`; ältere Seiten ohne `h` sind A4.
    let mut doc = HeftDoc::default();
    doc.apply_ops(impala_heft::parse_ops(json!([{ "t": "pg+", "page": { "id": "q", "paper": "blank", "h": 707 } }, { "t": "pg+", "page": { "id": "a" } }])));
    assert_eq!((doc.pages[0].page_height(), doc.pages[1].page_height()), (707.0, 1414.0));
    let (ops, _) = impala_heft::diff_document(None, &doc);
    assert_eq!(serde_json::to_value(&ops).unwrap()[0]["page"]["h"], json!(707));
    assert_eq!(HeftDoc::from_value(serde_json::to_value(&doc).unwrap()), doc);
}

#[test]
fn seiten_diff_gleicht_vollem_diff() {
    let mut doc = HeftDoc::default();
    for id in ["a", "b", "c"] {
        let mut page = HeftPage::empty(id, Paper::Lined);
        page.strokes.push(pen(&format!("{id}1"), &[[0.0, 0.0], [5.0, 5.0]]));
        doc.pages.push(page);
    }
    let shadow = Shadow::of(&doc);
    let mut next = doc.clone();
    next.pages[1].strokes.push(pen("b2", &[[1.0, 1.0], [9.0, 9.0]]));
    next.pages[1].strokes.remove(0);
    next.pages.insert(0, HeftPage::empty("neu", Paper::Grid));
    next.pages.remove(3);
    let order: Vec<String> = next.pages.iter().map(|p| p.id.clone()).collect();
    let changed = vec![next.pages[0].clone(), next.pages[2].clone()];
    let (full, full_shadow) = diff_document(Some(&shadow), &next);
    let (part, part_shadow) = diff_pages(&shadow, &order, &changed).expect("alle Seiten bekannt");
    assert_eq!(serde_json::to_value(&full).unwrap(), serde_json::to_value(&part).unwrap());
    assert_eq!(full_shadow, part_shadow);
    // Neue Seite nicht mitgeschickt: kein Teil-Diff möglich.
    assert!(diff_pages(&shadow, &order, &changed[1..]).is_none());
}
