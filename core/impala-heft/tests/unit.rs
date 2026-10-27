//! Verhalten, das die Golden-Files nicht abdecken: bewusste Abweichungen vom JS, SVG-Export,
//! Hilfen für die Eingabe.

use impala_heft::diff::{Shadow, diff_document};
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
    let base = vec![HeftOp::PageAdd { at: None, page: "p".into(), paper: None }];
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
    assert_eq!(gone.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["b"]);
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
    assert_eq!(h.docs["h"].byte_estimate(|r| h.blobs.get(r).map_or(0, |d| d.len())), 66);

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
