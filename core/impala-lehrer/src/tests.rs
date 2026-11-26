use serde_json::{Value, json};

use crate::*;

const T0: &str = "2026-01-01T00:00:00Z";
const T1: &str = "2026-01-02T00:00:00Z";

fn edit(tl: Option<Value>, e: Value) -> EditOut {
    apply_edit(tl, &e, T0).expect("Edit gültig")
}

fn node<'a>(tl: &'a Value, id: &str) -> &'a Value {
    tl["nodes"].as_array().unwrap().iter().find(|n| n["id"] == id).expect("Knoten da")
}

fn pos(v: &Value, id: &str) -> (u64, u64) {
    let n = v["nodes"].as_array().unwrap().iter().find(|n| n["id"] == id).unwrap();
    (n["col"].as_u64().unwrap(), n["lane"].as_u64().unwrap())
}

/// Zeitstrahl aus (Titel, Eltern)-Paaren; ids = Titel.
fn graph(spec: &[(&str, &[&str])]) -> Value {
    let nodes: Vec<Value> = spec.iter().map(|(t, p)| json!({ "id": t, "title": t, "parents": p })).collect();
    edit(None, json!({ "title": "G", "nodes": nodes })).timeline
}

#[test]
fn neuer_zeitstrahl_und_slug() {
    let out = edit(None, json!({ "title": "Elektronik für Äpfel" }));
    assert_eq!(out.timeline["id"], "zs-elektronik-fuer-aepfel");
    assert_eq!(out.timeline["created"], T0);
    assert_eq!(out.timeline["v"], 1);
    assert_eq!(slug("Größe & Maß"), "groesse-mass");
    assert!(slug(&"a ".repeat(100)).len() <= 48);
    assert!(apply_edit(None, &json!({}), T0).is_err());
}

#[test]
fn layout_wurzeln_verzweigung_zusammenfuehrung() {
    // Zwei Wurzeln, eine verzweigt, beide Zweige laufen in z zusammen.
    let tl = graph(&[("a", &[]), ("b", &[]), ("c", &["a"]), ("d", &["a"]), ("e", &["b"]), ("z", &["c", "e"])]);
    let v = view(&tl);
    assert_eq!(pos(&v, "a"), (0, 0));
    assert_eq!(pos(&v, "b"), (0, 1));
    assert_eq!(pos(&v, "c"), (1, 0));
    assert_eq!(pos(&v, "d"), (1, 1));
    assert_eq!(pos(&v, "e"), (1, 2));
    // z: Spalte 2 (längster Pfad), Spur des obersten Elternteils.
    assert_eq!(pos(&v, "z"), (2, 0));
    assert_eq!(v["cols"], 3);
    assert_eq!(v["lanes"], 3);
    assert_eq!(v["edges"].as_array().unwrap().len(), 5);
    // Höchstens ein Knoten je Feld.
    let mut seen = std::collections::HashSet::new();
    for n in v["nodes"].as_array().unwrap() {
        assert!(seen.insert((n["col"].as_u64(), n["lane"].as_u64())));
    }
}

#[test]
fn layout_laengster_pfad_und_determinismus() {
    let tl = graph(&[("a", &[]), ("b", &["a"]), ("c", &["b"]), ("z", &["a", "c"])]);
    let v = view(&tl);
    assert_eq!(pos(&v, "z").0, 3);
    assert_eq!(view(&tl), v);
    assert_eq!(view(&json!("kaputt"))["stats"]["total"], 0);
}

#[test]
fn zustaende_next_later_mastered() {
    let tl = edit(
        None,
        json!({ "title": "Z", "nodes": [
            { "title": "A", "quiz": [{"type":"choice","q":"?","options":["x","y"],"answer":0}] },
            { "title": "B", "parents": ["A"] },
            { "title": "C", "parents": ["B"] },
        ]}),
    )
    .timeline;
    let st = |v: &Value, i: usize| v["nodes"][i]["state"].as_str().unwrap().to_string();
    let v = view(&tl);
    assert_eq!((st(&v, 0).as_str(), st(&v, 1).as_str(), st(&v, 2).as_str()), ("next", "later", "later"));
    assert_eq!(v["stats"]["next"], 1);
    let rec = record_quiz(&tl, "A", &json!([[0]]), T1).unwrap();
    assert!(rec.grade.passed);
    let v = view(&rec.timeline);
    assert_eq!(st(&v, 0), "mastered");
    // B hat weder Quiz noch Arbeitsblatt: nur per done.
    assert_eq!(st(&v, 1), "next");
    let done = apply_check(&rec.timeline, &json!({ "node": "B", "done": true }), T1).unwrap();
    assert_eq!(done.node["state"], "mastered");
    assert_eq!(view(&done.timeline)["stats"]["mastered"], 2);
}

#[test]
fn upsert_per_titel_und_id_erhaelt_fortschritt() {
    let tl = edit(
        None,
        json!({ "title": "Z", "nodes": [
            { "title": "Volta", "summary": "alt", "quiz": [{"type":"choice","q":"?","options":["x","y"],"correct":[1]}], "worksheet": "Blatt 1" },
        ]}),
    )
    .timeline;
    let rec = record_quiz(&tl, "volta", &json!([1]), T1).unwrap();
    assert!(rec.grade.passed);
    // Titel (anderer Schreibweise) trifft; Fortschritt aus der Eingabe wird ignoriert, aber alter bleibt.
    let out = apply_edit(
        Some(rec.timeline.clone()),
        &json!({ "title": "Z", "nodes": [{ "title": " VOLTA ", "summary": "neu", "progress": { "done": true } }] }),
        T1,
    )
    .unwrap();
    assert_eq!(out.updated, vec!["volta"]);
    assert!(out.added.is_empty());
    let n = node(&out.timeline, "volta");
    assert_eq!(n["summary"], "neu");
    assert_eq!(n["progress"]["done"], false);
    assert_eq!(n["progress"]["quiz_passed"], true);
    assert_eq!(n["quiz"].as_array().unwrap().len(), 1);
    // Über id; gleiches Quiz ändert nichts, anderes Quiz setzt den Versuch zurück, Arbeitsblatt → open.
    let out = apply_edit(
        Some(out.timeline),
        &json!({ "title": "Z", "nodes": [{ "id": "volta", "quiz": [{"type":"text","q":"Warum?","solution":"Darum"}], "worksheet": "Blatt 2" }] }),
        T1,
    )
    .unwrap();
    let n = node(&out.timeline, "volta");
    assert_eq!(n["progress"]["quiz"], Value::Null);
    assert_eq!(n["progress"]["quiz_passed"], false);
    assert_eq!(n["progress"]["worksheet"]["status"], "open");
    assert_eq!(out.timeline["created"], T0);
    assert_eq!(out.timeline["updated"], T1);
}

#[test]
fn eltern_per_titel_ids_eindeutig_entfernen() {
    let out = edit(
        None,
        json!({ "title": "Z", "nodes": [
            { "title": "Strom" }, { "title": "Strom" }, { "title": "Spannung", "parents": ["strom"] },
            { "title": "Ohm", "parents": ["Strom", "spannung"] },
        ]}),
    );
    let tl = out.timeline;
    assert_eq!(tl["nodes"].as_array().unwrap().len(), 3);
    assert_eq!(node(&tl, "ohm")["parents"], json!(["strom", "spannung"]));
    // Entfernen: id oder Titel, Eltern der anderen werden bereinigt.
    let out =
        apply_edit(Some(tl), &json!({ "title": "Z", "remove_nodes": ["Spannung", "gibt-es-nicht"] }), T1).unwrap();
    assert_eq!(out.removed, vec!["spannung"]);
    assert_eq!(node(&out.timeline, "ohm")["parents"], json!(["strom"]));
    // Gleiche Titel bei neuen Knoten ohne Treffer: zweite id bekommt Suffix.
    let t = edit(None, json!({ "title": "Z", "nodes": [{ "id": "x", "title": "Gleich" }] })).timeline;
    let t = apply_edit(Some(t), &json!({ "title": "Z", "nodes": [{ "id": "y", "title": "Anders" }] }), T1)
        .unwrap()
        .timeline;
    assert_eq!(t["nodes"].as_array().unwrap().len(), 2);
}

#[test]
fn fehler_unbekannter_elternknoten_zyklus_grenzen() {
    let e = apply_edit(None, &json!({ "title": "Z", "nodes": [{ "title": "Ohm", "parents": ["Volta"] }] }), T0)
        .unwrap_err();
    assert_eq!(e, "edit_timeline: Elternknoten „Volta“ unbekannt – zuerst anlegen oder id prüfen.");
    let tl = graph(&[("a", &[]), ("b", &["a"]), ("c", &["b"])]);
    let e = apply_edit(Some(tl.clone()), &json!({ "title": "G", "nodes": [{ "id": "a", "parents": ["c"] }] }), T1)
        .unwrap_err();
    assert!(e.contains("Zyklus"), "{e}");
    let e = apply_edit(Some(tl.clone()), &json!({ "title": "G", "nodes": [{ "id": "a", "parents": ["a"] }] }), T1)
        .unwrap_err();
    assert!(e.contains("eigener Elternknoten"), "{e}");
    let e = apply_edit(
        Some(tl.clone()),
        &json!({ "title": "G", "nodes": [{ "title": "Neu", "body": "x".repeat(40_001) }] }),
        T1,
    )
    .unwrap_err();
    assert!(e.contains("zu lang"), "{e}");
    let e = apply_edit(Some(tl), &json!({ "title": "G", "nodes": [{ "body": "kein Titel" }] }), T1).unwrap_err();
    assert!(e.contains("title"), "{e}");
    let many: Vec<Value> = (0..401).map(|i| json!({ "title": format!("K{i}") })).collect();
    assert!(apply_edit(None, &json!({ "title": "Z", "nodes": many }), T0).unwrap_err().contains("Zu viele"));
    let e = apply_edit(None, &json!({ "title": "Z", "nodes": [{ "title": "K", "svg": "<script>" }] }), T0).unwrap_err();
    assert!(e.contains("svg"), "{e}");
}

#[test]
fn bilder_und_quellen_gefiltert() {
    let tl = edit(
        None,
        json!({ "title": "Z", "nodes": [{ "title": "K",
            "images": [{"src":"http://x/a.png"}, {"src":"https://x/a.png","caption":"c","credit":"d"}, {"src":"data:image/png;base64,AA=="}, {"src":"javascript:1"}],
            "svg": " <svg viewBox='0 0 1 1'></svg> ",
            "sources": [{"kind":"wiki","ref":"Volta","title":"Alessandro Volta"},{"kind":"komisch","ref":"x"},{"ref":""}] }] }),
    )
    .timeline;
    let n = node(&tl, "k");
    assert_eq!(n["images"].as_array().unwrap().len(), 2);
    assert_eq!(n["svg"], "<svg viewBox='0 0 1 1'></svg>");
    assert_eq!(n["sources"][1]["kind"], "url");
    assert_eq!(n["sources"].as_array().unwrap().len(), 2);
}

fn quiz_tl() -> Value {
    edit(
        None,
        json!({ "title": "Q", "nodes": [{ "title": "Ohm", "quiz": [
            {"type":"choice","q":"Welche?","options":["a","b","c"],"correct":[0,2]},
            {"type":"text","q":"Erkläre","solution":"weil"},
            {"type":"number","q":"U bei 1 A, 1,5 Ω","answer":1.5,"unit":"V"},
            {"type":"cloze","text":"Ohm: U = {{R}} · I, Einheit {{Volt|V}}"},
        ]}]}),
    )
    .timeline
}

#[test]
fn quiz_alle_typen() {
    let tl = quiz_tl();
    let r = record_quiz(&tl, "ohm", &json!([[2, 0], "Mein Text", "1,5 V", [" r ", "v"]]), T1).unwrap();
    let g = &r.grade;
    assert_eq!(g.results.iter().map(|x| x.correct).collect::<Vec<_>>(), vec![Some(true), None, Some(true), Some(true)]);
    assert_eq!((g.auto_correct, g.auto_total), (3, 3));
    assert_eq!(g.pending_ai, vec![1]);
    assert_eq!(g.score, 1.0);
    assert!(!g.passed, "Freitext offen");
    assert_eq!(g.results[2].expected, "1,5 V");
    assert_eq!(g.results[0].expected, "a, c");
    let n = node(&r.timeline, "ohm");
    assert_eq!(n["progress"]["quiz"]["answers"][1], "Mein Text");
    assert_eq!(n["progress"]["quiz"]["at"], T1);
    // describe zeigt die offene Antwort.
    let d = describe(&r.timeline, Some("Ohm")).unwrap();
    assert_eq!(d["pending_ai"][0]["answer"], "Mein Text");
    assert_eq!(d["state"], "next");
    // Falsche Antworten, Zahl als Zahl, einzelne Zahl bei choice.
    let r = record_quiz(&tl, "ohm", &json!([1, "x", 1.51, ["falsch", "v"]]), T1).unwrap();
    assert_eq!(r.grade.results[0].correct, Some(false));
    assert_eq!(r.grade.results[2].correct, Some(true), "1 % Toleranz");
    assert_eq!(r.grade.results[3].correct, Some(false));
    // Fehlende Antworten zählen als falsch.
    let r = record_quiz(&tl, "ohm", &json!([]), T1).unwrap();
    assert_eq!(r.grade.auto_correct, 0);
    assert!(record_quiz(&tl, "ohm", &json!("x"), T1).is_err());
    assert!(record_quiz(&tl, "nix", &json!([]), T1).is_err());
}

#[test]
fn zahlen_und_toleranzen() {
    let q = |extra: Value| {
        let mut base = json!({"type":"number","q":"?","answer":100.0});
        base.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        edit(None, json!({ "title": "N", "nodes": [{ "title": "K", "quiz": [base] }] })).timeline
    };
    let ok =
        |tl: &Value, a: Value| record_quiz(tl, "k", &json!([a]), T1).unwrap().grade.results[0].correct == Some(true);
    let t = q(json!({}));
    assert!(ok(&t, json!("100,9 mA")) && !ok(&t, json!("102")) && ok(&t, json!(99.5)));
    assert!(ok(&t, json!("1.0e2")) && !ok(&t, json!("−100,0")));
    let t = q(json!({ "tol": 5.0 }));
    assert!(ok(&t, json!("104.9")) && !ok(&t, json!("106")));
    let t = q(json!({ "tol_rel": 0.1 }));
    assert!(ok(&t, json!("90")) && !ok(&t, json!("89")));
    // answer als Text bei der Eingabe.
    let t = q(json!({ "answer": "1.000,5" }));
    assert!(ok(&t, json!("1000,5")));
    assert!(!ok(&t, json!("viel")));
}

#[test]
fn quiz_bestanden_ab_80_prozent() {
    let qs: Vec<Value> = (0..5).map(|i| json!({"type":"number","q":format!("{i}"),"answer":1})).collect();
    let tl = edit(None, json!({ "title": "N", "nodes": [{ "title": "K", "quiz": qs }] })).timeline;
    assert!(record_quiz(&tl, "k", &json!([1, 1, 1, 1, 0]), T1).unwrap().grade.passed);
    assert!(!record_quiz(&tl, "k", &json!([1, 1, 1, 0, 0]), T1).unwrap().grade.passed);
}

#[test]
fn apply_check_bewertet_und_meistert() {
    let tl = edit(
        None,
        json!({ "title": "Q", "nodes": [{ "title": "Ohm", "worksheet": "Blatt", "quiz": [
            {"type":"text","q":"Erkläre","solution":"weil"},
            {"type":"choice","q":"?","options":["a","b"],"correct":[0]},
        ]}]}),
    )
    .timeline;
    // Ohne Versuch: Fehler.
    let e = apply_check(&tl, &json!({ "node": "ohm", "quiz": [{ "index": 0, "correct": true }] }), T1).unwrap_err();
    assert!(e.contains("Quiz-Versuch"), "{e}");
    let rec = record_quiz(&tl, "ohm", &json!(["Text", 0]), T1).unwrap();
    assert!(!rec.grade.passed);
    let out = apply_check(
        &rec.timeline,
        &json!({ "node": "Ohm", "quiz": [{ "index": 0, "correct": true, "feedback": "gut" }], "worksheet": "passed", "feedback": "Prima" }),
        T1,
    )
    .unwrap();
    let n = node(&out.timeline, "ohm");
    assert_eq!(n["progress"]["quiz_passed"], true);
    assert_eq!(n["progress"]["quiz"]["results"][0]["feedback"], "gut");
    assert_eq!(n["progress"]["worksheet"]["status"], "passed");
    assert_eq!(n["progress"]["worksheet"]["feedback"], "Prima");
    assert_eq!(n["progress"]["feedback"], "Prima");
    assert_eq!(out.node["state"], "mastered");
    assert_eq!(out.node["worksheet"], "passed");
    // Arbeitsblatt durchgefallen → nicht mehr gemeistert.
    let out = apply_check(&out.timeline, &json!({ "node": "ohm", "worksheet": "failed" }), T1).unwrap();
    assert_eq!(out.node["state"], "next");
    assert!(apply_check(&out.timeline, &json!({ "node": "ohm", "worksheet": "gut" }), T1).is_err());
    assert!(
        apply_check(&out.timeline, &json!({ "node": "ohm", "quiz": [{ "index": 9, "correct": true }] }), T1).is_err()
    );
    assert!(apply_check(&out.timeline, &json!({ "node": "nix" }), T1).is_err());
}

#[test]
fn describe_und_list_entry() {
    let tl = graph(&[("a", &[]), ("b", &["a"])]);
    let d = describe(&tl, None).unwrap();
    assert_eq!(d["nodes"].as_array().unwrap().len(), 2);
    assert_eq!(d["nodes"][1]["parents"], json!(["a"]));
    assert!(d["nodes"][0].get("body").is_none());
    assert!(describe(&tl, Some("nix")).is_err());
    let l = list_entry(&tl);
    assert_eq!((l["total"].as_u64(), l["mastered"].as_u64()), (Some(2), Some(0)));
    assert_eq!(l["id"], "zs-g");
}

#[test]
fn cloze_tolerant_gegenueber_leerraum() {
    let tl = edit(None, json!({ "title": "C", "nodes": [{ "title": "K", "quiz": [{"type":"cloze","text":"{{Gelber  Apfel}} und {{x|y}}"}] }] })).timeline;
    let ok = |a: Value| record_quiz(&tl, "k", &json!([a]), T1).unwrap().grade.results[0].correct == Some(true);
    assert!(ok(json!(["  gelber   APFEL ", "Y"])));
    assert!(!ok(json!(["gelber apfel"])));
    assert!(!ok(json!(["gelber apfel", "z"])));
}

#[test]
fn sanitize_css_entfernt_gefaehrliches() {
    let css = "@import url(https://evil/x.css);\n.a{background:url(https://evil/p.png);color:red}\n.b{width:expression(alert(1));background:URL( 'data:image/png;base64,AA' )}\n.c{background:javascript:x;behavior:url(x);-moz-binding:y}</style><script>";
    let out = sanitize_css(css);
    for bad in ["@import", "evil", "expression(", "javascript:", "behavior:", "-moz-binding", "<", "</style"] {
        assert!(!out.to_lowercase().contains(bad), "{bad} in {out}");
    }
    assert!(out.contains("background:none"));
    assert!(out.contains("data:image/png"));
    assert!(out.contains("color:red"));
    // Zusammengesetzte Muster und Escapes.
    assert!(!sanitize_css("javajavascript:script:x").contains("javascript:"));
    assert!(!sanitize_css("u\\72l(https://evil)").contains("url("));
    assert_eq!(sanitize_css(&"a".repeat(30_000)).len(), 20_000);
    // Über apply_edit gespeichert.
    let tl =
        edit(None, json!({ "title": "S", "theme_css": ".x{background:url(http://e)}", "accent": "#ff0000" })).timeline;
    assert_eq!(tl["theme"]["css"], ".x{background:none}");
    assert_eq!(tl["theme"]["accent"], "#ff0000");
}

#[test]
fn tolerantes_lesen() {
    let kaputt = json!({ "title": "T", "nodes": [{ "id": "a", "title": "A", "quiz": [{"type":"unsinn"}, {"type":"choice","q":"?","options":["x","y"],"answer":1}], "parents": [1, "zz"], "extra": 1 }, 5] });
    let v = view(&kaputt);
    assert_eq!(v["stats"]["total"], 1);
    assert_eq!(v["nodes"][0]["quiz"]["total"], 1);
    assert_eq!(v["nodes"][0]["state"], "next");
}

#[test]
fn zeitachse_jahre_straenge_und_klausur() {
    let tl = edit(
        None,
        json!({ "title": "Z", "exam": "2027-02-14", "nodes": [
            { "id": "galvani", "title": "Galvani", "year": 1780, "strand": "Strom" },
            { "id": "coulomb", "title": "Coulomb", "year": "1785", "strand": "Statik" },
            { "id": "volta", "title": "Volta", "year": 1800, "strand": "Strom", "parents": ["galvani"] },
            { "id": "ohm", "title": "Ohm", "year": 1827, "strand": "Strom", "parents": ["volta"] },
            { "id": "rest", "title": "Ohne Jahr", "parents": ["ohm"] }
        ] }),
    )
    .timeline;
    let v = view(&tl);
    // Jahre ordnen die Spalten: 1780 < 1785 < 1800 < 1827, ohne Jahr hinter dem Vorgänger.
    assert_eq!(pos(&v, "galvani").0, 0);
    assert_eq!(pos(&v, "coulomb").0, 1);
    assert_eq!(pos(&v, "volta").0, 2);
    assert_eq!(pos(&v, "ohm").0, 3);
    assert_eq!(pos(&v, "rest").0, 4);
    // Spuren nach Strang: Strom zuerst (früher), dann Statik.
    assert_eq!(pos(&v, "coulomb").1, 1);
    // Rückwärts datiert: Hinweis, kein Fehler.
    let back = edit(Some(tl.clone()), json!({ "title": "Z", "nodes": [{ "id": "ohm", "year": 1790 }] }));
    assert_eq!(back.warnings.len(), 1);
    assert!(back.warnings[0].contains("Volta"));
    assert_eq!(v["exam"], "2027-02-14");
    assert_eq!(v["stats"]["drafts"], 5);
    // Lernpfad: Jahre egal, Spalte = Pfadlänge.
    let p = edit(Some(tl), json!({ "title": "Z", "kind": "path" })).timeline;
    let v = view(&p);
    assert_eq!(v["kind"], "path");
    assert_eq!(pos(&v, "coulomb").0, 0);
    // Ungültige Eingaben werden erklärt; leeres Jahr löscht.
    assert!(apply_edit(Some(p.clone()), &json!({ "title": "Z", "exam": "14.2.2027" }), T0).is_err());
    assert!(apply_edit(Some(p.clone()), &json!({ "title": "Z", "kind": "bunt" }), T0).is_err());
    let cleared = edit(Some(p), json!({ "title": "Z", "nodes": [{ "id": "ohm", "year": null }] })).timeline;
    assert!(node(&cleared, "ohm").get("year").is_none());
}

#[test]
fn brief_patch_und_describe() {
    let tl = edit(
        None,
        json!({
            "title": "E-Technik",
            "brief": { "material_pages": ["p1", "p2", "p1"], "goal": "Klausur 1.3", "level": "Grundlagen", "wiki": false }
        }),
    )
    .timeline;
    // Partial-Patch: nur style und notes ändern, Rest bleibt erhalten.
    let tl = edit(Some(tl), json!({ "title": "E-Technik", "brief": { "style": "visuell", "notes": "Viel Rechnen" } })).timeline;
    let d = describe(&tl, None).unwrap();
    assert_eq!(d["brief"]["material_pages"], json!(["p1", "p2"]));
    assert_eq!(d["brief"]["goal"], "Klausur 1.3");
    assert_eq!(d["brief"]["level"], "Grundlagen");
    assert_eq!(d["brief"]["style"], "visuell");
    assert_eq!(d["brief"]["wiki"], false);
    assert_eq!(d["brief"]["notes"], "Viel Rechnen");
}

#[test]
fn fsrs_verblassen_konfidenz_pretest_und_auffrischung() {
    let tl = edit(
        None,
        json!({
            "title": "E-Technik",
            "exam": "2026-06-20",
            "nodes": [
                {
                    "id": "ohm",
                    "title": "Ohm",
                    "year": 1827,
                    "pretest": { "type": "number", "q": "U bei 2A, 5 Ohm?", "answer": 10, "unit": "V" },
                    "quiz": [
                        { "type": "number", "q": "Q1", "answer": 10 },
                        { "type": "number", "q": "Q2", "answer": 20 }
                    ]
                },
                {
                    "id": "kirchhoff",
                    "title": "Kirchhoff",
                    "year": 1845,
                    "parents": ["ohm"],
                    "quiz": [
                        { "type": "number", "q": "K1", "answer": 5 },
                        { "type": "number", "q": "K2", "answer": 0 }
                    ]
                }
            ]
        }),
    )
    .timeline;

    // 1. Pre-Test auswerten
    let pt = record_pretest(&tl, "ohm", &json!(10), "2026-06-01T10:00:00Z").unwrap();
    assert_eq!(pt.correct, Some(true));
    let tl = pt.timeline;

    // 2. Ohm sicher bestehen → frisch am Tag 1, verblasst nach 20 Tagen
    let r = record_quiz_with_confidence(&tl, "ohm", &json!([10, 20]), &json!(["sure", "sure"]), "2026-06-01T10:05:00Z").unwrap();
    assert!(r.grade.passed);
    let tl = r.timeline;
    let v_now = view_at(&tl, "2026-06-01T12:00:00Z");
    assert_eq!(v_now["nodes"][0]["memory_state"], "fresh");
    let v_later = view_at(&tl, "2026-06-25T12:00:00Z");
    assert!(matches!(v_later["nodes"][0]["memory_state"].as_str(), Some("fading" | "due")));

    // 3. Kirchhoff „sicher, aber falsch“ → sofort Schwachstelle (weak)
    let r2 = record_quiz_with_confidence(&tl, "kirchhoff", &json!([99, 0]), &json!(["sure", "sure"]), "2026-06-02T10:00:00Z").unwrap();
    let tl = r2.timeline;
    let v_weak = view_at(&tl, "2026-06-25T12:00:00Z");
    assert_eq!(v_weak["nodes"][1]["weak"], true);
    assert_eq!(v_weak["today"]["weak_count"], 1);

    // 4. Gemischte Kurz-Auffrischung zieht Fragen aus beiden Knoten (Interleaving)
    let sess = build_refresh_session(&tl, "2026-06-25T12:00:00Z", 6).unwrap();
    assert!(sess.node_count >= 2);
    let subs: Vec<Value> = sess
        .items
        .iter()
        .map(|it| {
            let ans = match (it.node_id.as_str(), it.question_index) {
                ("ohm", 0) => 10,
                ("ohm", 1) => 20,
                ("kirchhoff", 0) => 5,
                _ => 0,
            };
            json!({ "node_id": it.node_id, "question_index": it.question_index, "answer": ans, "confidence": "sure" })
        })
        .collect();
    let out = record_refresh(&tl, &Value::Array(subs), "2026-06-25T12:05:00Z").unwrap();
    assert_eq!(out.correct_count, out.total_count);
    let v_after = view_at(&out.timeline, "2026-06-25T12:06:00Z");
    assert_eq!(v_after["nodes"][0]["memory_state"], "fresh");
}
