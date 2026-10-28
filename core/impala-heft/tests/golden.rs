//! Vergleich mit dem letzten JS-Stand (eingefrorene Golden-Files aus `web/state.js` (Reducer),
//! `heft-document-core.js`, `heft-geometry.js`, `heft-lasso.js`, `heft.js` (Zeichnen),
//! `heft-export.js` und `heft-pages-core.js`; die PWA rechnet das seit dem Umbau in Rust).
//!
//! Dokumente und Operationen müssen exakt gleich sein; Geometrie mit kleiner Toleranz
//! (`sin`/`cos` können in der letzten Stelle von V8 abweichen).

use impala_heft::diff::{Shadow, diff_document};
use impala_heft::doc::{HeftDoc, HeftPage, Image, Paper, Point, Stroke, blob_id, compose_page_text};
use impala_heft::eraser::StrokeEraser;
use impala_heft::export::{PdfPage, build_pdf, export_file_name, page_canvas_size};
use impala_heft::geometry::{fit_stroke_shape, hit_box, near_point, point_in_polygon};
use impala_heft::ink::{InkPath, paper_pattern, stroke_paths};
use impala_heft::lasso::{
    LassoTouch, duplicate_strokes, hit_lasso_handle, is_lasso_body_hit, lasso_bounds, lasso_handles,
    lasso_touch_action, polygon_bounds, select_strokes_by_lasso,
};
use impala_heft::ops::{HeftEvent, Hefte, parse_ops};
use impala_heft::pages::{InsertPosition, can_delete_pages, insert_at, move_page};
use serde_json::{Value, json};

fn load(name: &str) -> Value {
    let path = format!("{}/tests/golden/{name}.json", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).expect("Golden-File fehlt")).expect("kein JSON")
}

fn to_value<T: serde::Serialize>(v: &T) -> Value {
    serde_json::to_value(v).unwrap()
}

/// Vergleich mit Toleranz für Zahlen; fehlender Schlüssel gilt wie `null`.
fn close(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => {
            let (x, y) = (x.as_f64().unwrap(), y.as_f64().unwrap());
            (x - y).abs() <= 1e-9 * x.abs().max(y.abs()).max(1.0)
        }
        (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(a, b)| close(a, b)),
        (Value::Object(x), Value::Object(y)) => {
            let keys: std::collections::BTreeSet<&String> = x.keys().chain(y.keys()).collect();
            keys.into_iter().all(|k| close(x.get(k).unwrap_or(&Value::Null), y.get(k).unwrap_or(&Value::Null)))
        }
        _ => a == b,
    }
}

#[track_caller]
fn assert_close(got: &Value, want: &Value, what: &str) {
    assert!(close(got, want), "{what}\n  Rust: {got}\n  JS:   {want}");
}

fn stroke(v: &Value) -> Stroke {
    Stroke::from_value(v.clone()).expect("Strich")
}

fn strokes(v: &Value) -> Vec<Stroke> {
    v.as_array().unwrap().iter().map(stroke).collect()
}

fn f(v: &Value) -> f64 {
    v.as_f64().unwrap()
}

fn xy_list(v: &Value) -> Vec<[f64; 2]> {
    v.as_array().unwrap().iter().map(|p| [f(&p[0]), f(&p[1])]).collect()
}

// ---------------------------------------------------------------------------

#[test]
fn reducer_wie_state_js() {
    let cases = load("reducer");
    let mut checked = 0;
    for case in cases.as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let page_id = case["pageId"].as_str().unwrap();
        let mut hefte = Hefte::default();
        for (i, ev) in case["events"].as_array().unwrap().iter().enumerate() {
            if let Some(ev) = HeftEvent::from_payload(ev["type"].as_str().unwrap(), ev["payload"].clone()) {
                hefte.apply(ev);
            }
            let want = &case["docs"][i];
            if want == "-" {
                continue;
            }
            let got = hefte.get(page_id).map_or(Value::Null, to_value);
            assert_eq!(got, *want, "{name}: Heft nach Event {i}");
            checked += 1;
        }
        assert_eq!(to_value(&hefte.blobs), case["blobs"], "{name}: Bilddaten");
    }
    assert!(checked > 40);
}

#[test]
fn dokumente_lesen_und_schreiben_verlustfrei() {
    let mut n = 0;
    let mut check = |v: &Value| {
        if v.is_object() {
            assert_eq!(to_value(&HeftDoc::from_value(v.clone())), *v);
            n += 1;
        }
    };
    for case in load("reducer").as_array().unwrap() {
        case["docs"].as_array().unwrap().iter().for_each(&mut check);
    }
    for case in load("diff").as_array().unwrap() {
        check(&case["prev"]);
        check(&case["next"]);
    }
    assert!(n > 80);
}

#[test]
fn diff_wie_heft_document_core() {
    for (i, case) in load("diff").as_array().unwrap().iter().enumerate() {
        let next = HeftDoc::from_value(case["next"].clone());
        let shadow = (!case["prev"].is_null()).then(|| {
            let mut s = Shadow::of(&HeftDoc::from_value(case["prev"].clone()));
            s.apply_ops(&parse_ops(case["log"].clone()));
            s
        });
        let (ops, new_shadow) = diff_document(shadow.as_ref(), &next);
        assert_eq!(to_value(&ops), case["ops"], "Fall {i}");
        assert_eq!(new_shadow, Shadow::of(&next), "Fall {i}: Schatten");
        // Ops wieder gelesen und geschrieben: unverändert.
        assert_eq!(to_value(&parse_ops(case["ops"].clone())), case["ops"], "Fall {i}: Ops verlustfrei");
    }
}

#[test]
fn diff_ops_fuehren_zum_neuen_stand() {
    // Die Ops eines Diffs gegen ein leeres Heft bauen das Heft genau nach.
    for case in load("diff").as_array().unwrap() {
        let next = HeftDoc::from_value(case["next"].clone());
        let (ops, _) = diff_document(None, &next);
        let mut doc = HeftDoc::default();
        doc.apply_ops(ops);
        let strip = |d: &HeftDoc| {
            let mut d = d.clone();
            d.rev = 0;
            // Doppelte IDs fallen beim Anwenden zusammen (erstes gewinnt) – wie im Reducer.
            for p in &mut d.pages {
                let mut seen = std::collections::HashSet::new();
                p.strokes.retain(|s| !s.id.is_empty() && seen.insert(s.id.clone()));
            }
            d
        };
        assert_eq!(strip(&doc), strip(&next));
    }
}

#[test]
fn basis_ops_wie_sync_core() {
    for case in load("misc")["baseline"].as_array().unwrap() {
        let ops = HeftDoc::from_value(case[0].clone()).baseline_ops();
        assert_eq!(to_value(&ops), case[1]);
    }
}

#[test]
fn geometrie_wie_heft_geometry() {
    let g = load("geometry");
    for (i, c) in g["strokes"].as_array().unwrap().iter().enumerate() {
        let s = stroke(&c["stroke"]);
        assert_close(&to_value(&s.bounds()), &c["bounds"], &format!("Strich {i}: Grenzen"));
        let outline: Vec<[f64; 2]> = s.outline().to_vec();
        assert_close(&to_value(&outline), &c["outline"], &format!("Strich {i}: Umriss"));
        for q in c["queries"].as_array().unwrap() {
            assert_eq!(s.hit_at(f(&q[0]), f(&q[1]), f(&q[2])), q[3].as_bool().unwrap(), "Strich {i}: Treffer {q}");
        }
        let mut moved = s.clone();
        moved.translate(12.5, -7.0);
        assert_close(&to_value(&moved), &c["moved"], &format!("Strich {i}: verschoben"));
        let mut scaled = s.clone();
        let sc = &c["scale"];
        scaled.scale_from(&s.geometry(), f(&sc[0]), f(&sc[1]), f(&sc[2]));
        assert_close(&to_value(&scaled), &c["scaled"], &format!("Strich {i}: skaliert"));
        let mut back = scaled.clone();
        back.apply_geometry(&s.geometry());
        assert_close(&to_value(&back), &c["back"], &format!("Strich {i}: zurückgesetzt"));
        let mut moved_from = s.clone();
        moved_from.move_from(&s.geometry(), -3.0, 4.0);
        assert_close(&to_value(&moved_from), &c["movedFrom"], &format!("Strich {i}: von Ausgang verschoben"));
    }
    let mut kinds = std::collections::BTreeMap::<String, usize>::new();
    for (i, c) in g["shapes"].as_array().unwrap().iter().enumerate() {
        let pts: Vec<Point> =
            c["pts"].as_array().unwrap().iter().map(|p| Point::new(f(&p[0]), f(&p[1]), f(&p[2]))).collect();
        let got = fit_stroke_shape(&pts);
        assert_close(&to_value(&got), &c["shape"], &format!("Geste {i} ({})", c["kind"]));
        *kinds.entry(got.map_or("keine".into(), |s| s.kind().to_owned())).or_default() += 1;
    }
    // Jede Form kommt in den Gesten tatsächlich vor.
    for k in ["line", "rect", "ellipse", "triangle", "arrow", "keine"] {
        assert!(kinds.get(k).copied().unwrap_or(0) > 0, "Form {k} nie erkannt: {kinds:?}");
    }
    for c in g["polygons"].as_array().unwrap() {
        let poly = xy_list(&c["poly"]);
        for q in c["points"].as_array().unwrap() {
            assert_eq!(point_in_polygon(f(&q[0]), f(&q[1]), &poly), q[2].as_bool().unwrap(), "Polygon {q}");
        }
        for q in c["near"].as_array().unwrap() {
            assert_eq!(near_point(&poly[0], f(&q[0]), f(&q[1]), 50.0), q[2].as_bool().unwrap());
        }
    }
    let items: Vec<Image> =
        g["hitBox"]["items"].as_array().unwrap().iter().map(|v| Image::from_value(v.clone()).unwrap()).collect();
    for q in g["hitBox"]["queries"].as_array().unwrap() {
        let want = q[2].as_i64().unwrap();
        assert_eq!(hit_box(&items, f(&q[0]), f(&q[1])).map_or(-1, |i| i as i64), want, "hitBox {q}");
    }
}

#[test]
fn lasso_wie_heft_lasso() {
    let l = load("lasso");
    for (i, c) in l["lasso"].as_array().unwrap().iter().enumerate() {
        let list = strokes(&c["strokes"]);
        let poly = xy_list(&c["poly"]);
        let sel: Vec<&str> = select_strokes_by_lasso(&list, &poly).into_iter().map(|k| list[k].id.as_str()).collect();
        let want: Vec<&str> = c["selected"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
        assert_eq!(sel, want, "Lasso {i}");
        let chosen: Vec<&Stroke> = list.iter().filter(|s| want.contains(&s.id.as_str())).collect();
        let bounds = lasso_bounds(chosen.iter().copied());
        assert_close(&to_value(&bounds), &c["bounds"], &format!("Lasso {i}: Grenzen"));
        assert_close(&to_value(&polygon_bounds(&poly)), &c["polyBounds"], &format!("Lasso {i}: Polygon"));
        if let Some(b) = bounds {
            assert_eq!(lasso_handles(&b).map(|h| h.corner.name()), ["tl", "tr", "bl", "br"]);
            for p in c["probes"].as_array().unwrap() {
                let (x, y) = (f(&p[0]), f(&p[1]));
                let h = hit_lasso_handle(x, y, &b, f(&p[2])).map(|h| h.corner.name());
                assert_eq!(h, p[3].as_str(), "Lasso {i}: Griff {p}");
                assert_eq!(is_lasso_body_hit(x, y, &b, 12.0), p[4].as_bool().unwrap(), "Lasso {i}: Rahmen {p}");
            }
        }
        if !c["duplicates"].is_null() {
            let mut n = c["dupIdsFrom"].as_u64().unwrap();
            let mut new_id = || {
                let id = format!("uid{n}");
                n += 1;
                id
            };
            let dup = duplicate_strokes(chosen.iter().take(3).copied(), &mut new_id);
            assert_close(&to_value(&dup), &c["duplicates"], &format!("Lasso {i}: Duplikat"));
        }
    }
    for t in l["touch"].as_array().unwrap() {
        let got = lasso_touch_action(t[0] == "touch", t[1] == "lasso", t[2].as_bool().unwrap());
        let name = match got {
            LassoTouch::Interact => "interact",
            LassoTouch::Dismiss => "dismiss",
            LassoTouch::None => "none",
        };
        assert_eq!(name, t[3], "{t}");
    }
}

#[test]
fn radierer_wie_heft_input() {
    let mut total = 0;
    for (i, c) in load("lasso")["eraser"].as_array().unwrap().iter().enumerate() {
        let mut list = strokes(&c["strokes"]);
        let mut eraser = StrokeEraser::new(f(&c["radius"]));
        for (k, p) in c["path"].as_array().unwrap().iter().enumerate() {
            let removed: Vec<String> =
                eraser.erase_at(&mut list, f(&p[0]), f(&p[1])).into_iter().map(|s| s.id).collect();
            assert_eq!(to_value(&removed), c["removed"][k], "Radierer {i}, Schritt {k}");
            total += removed.len();
        }
    }
    assert!(total > 10, "Radierer trifft kaum");
}

/// Zeichenbefehle im Format des aufzeichnenden Canvas des Generators.
fn canvas_log(paths: &[InkPath], alpha: f64) -> Vec<Value> {
    paths
        .iter()
        .map(|p| match p {
            InkPath::Dot { x, y, r } => json!({ "op": "fill", "alpha": alpha, "path": [["A", x, y, r]] }),
            InkPath::Quad { from, ctrl, to, width } => {
                json!({ "op": "stroke", "lw": width, "alpha": alpha, "path": [["M", from[0], from[1]], ["Q", ctrl[0], ctrl[1], to[0], to[1]]] })
            }
            InkPath::Lines { parts, width } => {
                let path: Vec<Value> =
                    parts.iter().flat_map(|part| part.iter().enumerate().map(|(i, p)| json!([if i == 0 { "M" } else { "L" }, p[0], p[1]]))).collect();
                json!({ "op": "stroke", "lw": width, "alpha": alpha, "path": path })
            }
            InkPath::Ellipse { cx, cy, rx, ry, width } => json!({ "op": "stroke", "lw": width, "alpha": alpha, "path": [["E", cx, cy, rx, ry]] }),
            InkPath::Rect { x, y, w, h, width } => json!({ "op": "rect", "lw": width, "alpha": alpha, "rect": [x, y, w, h] }),
        })
        .collect()
}

#[test]
fn zeichnen_wie_heft_js() {
    let r = load("render");
    for c in r["strokes"].as_array().unwrap() {
        let s = stroke(&c["stroke"]);
        let log = stroke_paths(&s).map_or(Vec::new(), |ink| canvas_log(&ink.paths, ink.alpha));
        assert_close(&Value::Array(log), &c["log"], &format!("Strich {}", s.id));
    }
    for c in r["paper"].as_array().unwrap() {
        let kind = Paper::parse(Some(&c["kind"]));
        let pat = paper_pattern(&kind, 1000.0, 1414.0);
        let mut log = Vec::new();
        if !pat.dots.is_empty() {
            let path: Vec<Value> =
                pat.dots.iter().flat_map(|d| [json!(["M", d[0] + 1.2, d[1]]), json!(["A", d[0], d[1], 1.2])]).collect();
            log.push(json!({ "op": "fill", "alpha": 0.35, "path": path }));
        }
        if !pat.lines.is_empty() {
            let path: Vec<Value> =
                pat.lines.iter().flat_map(|l| [json!(["M", l[0], l[1]]), json!(["L", l[2], l[3]])]).collect();
            log.push(json!({ "op": "stroke", "lw": 1, "alpha": 0.22, "path": path }));
        }
        if let Some(m) = pat.margin {
            log.push(json!({ "op": "stroke", "lw": 1, "alpha": 0.4, "path": [["M", m[0], m[1]], ["L", m[2], m[3]]] }));
        }
        assert_close(&Value::Array(log), &c["log"], &format!("Papier {}", c["kind"]));
    }
}

fn base64(s: &str) -> Vec<u8> {
    let val = |c: u8| match c {
        b'A'..=b'Z' => c - b'A',
        b'a'..=b'z' => c - b'a' + 26,
        b'0'..=b'9' => c - b'0' + 52,
        b'+' => 62,
        _ => 63,
    };
    let bytes: Vec<u8> = s.bytes().filter(|&c| c != b'=').map(val).collect();
    bytes
        .chunks(4)
        .flat_map(|ch| {
            let n = ch.iter().enumerate().fold(0u32, |n, (i, &v)| n | (v as u32) << (18 - 6 * i));
            let out = [(n >> 16) as u8, (n >> 8) as u8, n as u8];
            out.into_iter().take(ch.len() - 1)
        })
        .collect()
}

#[test]
fn kleinteile_wie_js() {
    let m = load("misc");
    for c in m["blobIds"].as_array().unwrap() {
        assert_eq!(blob_id(c[0].as_str().unwrap()), c[1], "blobId");
    }
    for c in m["pageTexts"].as_array().unwrap() {
        let page = HeftPage::from_value(c[1].clone());
        assert_eq!(compose_page_text(c[0].as_str().unwrap(), &page), c[2], "composePageText {c}");
    }
    for c in m["names"].as_array().unwrap() {
        assert_eq!(export_file_name(c[0].as_str()), c[1], "exportName {c}");
    }
    let jpegs: Vec<Vec<u8>> =
        m["pdf"]["shots"].as_array().unwrap().iter().map(|s| base64(s["jpeg"].as_str().unwrap())).collect();
    let shots: Vec<PdfPage> = m["pdf"]["shots"]
        .as_array()
        .unwrap()
        .iter()
        .zip(&jpegs)
        .map(|(s, j)| PdfPage {
            jpeg: j,
            width: s["w"].as_u64().unwrap() as u32,
            height: s["h"].as_u64().unwrap() as u32,
        })
        .collect();
    assert_eq!(build_pdf(&shots), base64(m["pdf"]["bytes"].as_str().unwrap()), "buildPdf");
    for c in m["pagesCore"]["move"].as_array().unwrap() {
        let mut list: Vec<i64> = c[0].as_array().unwrap().iter().map(|v| v.as_i64().unwrap()).collect();
        let ok = move_page(&mut list, c[1].as_u64().unwrap() as usize, c[2].as_u64().unwrap() as usize);
        assert_eq!(ok, c[3].as_bool().unwrap());
        assert_eq!(to_value(&list), c[4]);
    }
    for c in m["pagesCore"]["insert"].as_array().unwrap() {
        let pos = match c[0].as_str().unwrap() {
            "start" => InsertPosition::Start,
            "before" => InsertPosition::Before,
            "after" => InsertPosition::After,
            _ => InsertPosition::End,
        };
        assert_eq!(
            insert_at(pos, c[1].as_u64().unwrap() as usize, c[2].as_u64().unwrap() as usize) as u64,
            c[3].as_u64().unwrap(),
            "{c}"
        );
    }
    for c in m["pagesCore"]["canDelete"].as_array().unwrap() {
        assert_eq!(
            can_delete_pages(c[0].as_u64().unwrap() as usize, c[1].as_u64().unwrap() as usize),
            c[2].as_bool().unwrap()
        );
    }
    for c in m["legacy"].as_array().unwrap() {
        let mut n = c["idsFrom"].as_u64().unwrap();
        let mut new_id = || {
            n += 1;
            format!("uid{n}")
        };
        let got = HeftDoc::normalize_legacy(&c["input"], &mut new_id);
        let doc = got.as_ref().map_or(Value::Null, |(d, _)| to_value(d));
        assert_eq!(doc, c["output"], "normalizeDoc");
        let blobs: serde_json::Map<String, Value> =
            got.map(|(_, b)| b.into_iter().map(|(k, v)| (k, Value::String(v))).collect()).unwrap_or_default();
        assert_eq!(Value::Object(blobs), c["blobs"]);
    }
    for c in m["sizes"].as_array().unwrap() {
        assert_eq!(page_canvas_size(c[0].as_u64().unwrap() as u32).1 as u64, c[1].as_u64().unwrap());
    }
}
