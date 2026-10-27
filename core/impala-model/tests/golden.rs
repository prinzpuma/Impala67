//! Vergleich mit der PWA (web/state.js, event-order.js, db.js, conflict-ui.js). Golden-Files
//! erzeugt `core/tools/gen-golden-model.mjs`. Zustände werden über kanonisches JSON verglichen
//! (Schlüssel sortiert, Zahlen wie `JSON.stringify`) – strukturgleich, unabhängig von Reihenfolgen.

use std::collections::{HashMap, HashSet};

use impala_model::conflict::{self, Conflict, ImportContext, Row};
use impala_model::query::page_history;
use impala_model::search::NoteSearch;
use impala_model::study::StudyOptions;
use impala_model::{LogEvent, Merge3, Model, Page, State, merge3};
use impala_srs::Timestamp;
use impala_storage::checkpoint::{BLOB_PREFIX, CURRENT_KEY, HEFT_PREFIX, LEGACY_KEY};
use impala_storage::{CheckpointSlot, MemoryStorage, PartKind, Storage, Write};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};

type Object = Map<String, Value>;

const NOW: &str = "2030-01-01T00:00:00.000Z";

fn golden(name: &str) -> Value {
    let path = format!("{}/tests/golden/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn canon(v: &Value) -> String {
    match v {
        Value::Object(o) => {
            let mut keys: Vec<&String> = o.keys().collect();
            keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
            let parts: Vec<String> =
                keys.iter().map(|k| format!("{}:{}", serde_json::to_string(k).unwrap(), canon(&o[*k]))).collect();
            format!("{{{}}}", parts.join(","))
        }
        Value::Array(a) => format!("[{}]", a.iter().map(canon).collect::<Vec<_>>().join(",")),
        Value::Number(n) => match (n.as_i64(), n.as_u64()) {
            (Some(i), _) => i.to_string(),
            (_, Some(u)) => u.to_string(),
            _ => impala_storage::js::number(n.as_f64().unwrap()),
        },
        other => serde_json::to_string(other).unwrap(),
    }
}

fn digest_value(v: &Value) -> String {
    Sha256::digest(canon(v).as_bytes()).iter().take(8).map(|b| format!("{b:02x}")).collect()
}

fn state_value(s: &State) -> Value {
    serde_json::to_value(s).unwrap()
}

fn digest(s: &State) -> String {
    digest_value(&state_value(s))
}

/// Erste abweichende Stelle (für Fehlermeldungen).
fn diff(a: &Value, b: &Value, path: &str) -> Option<String> {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            for k in x.keys().chain(y.keys()) {
                let (va, vb) = (x.get(k).unwrap_or(&Value::Null), y.get(k).unwrap_or(&Value::Null));
                if x.contains_key(k) != y.contains_key(k) {
                    return Some(format!("{path}.{k}: {va} vs {vb} (fehlt auf einer Seite)"));
                }
                if let Some(d) = diff(va, vb, &format!("{path}.{k}")) {
                    return Some(d);
                }
            }
            None
        }
        (Value::Array(x), Value::Array(y)) if x.len() == y.len() => {
            x.iter().zip(y).enumerate().find_map(|(i, (p, q))| diff(p, q, &format!("{path}[{i}]")))
        }
        _ => (canon(a) != canon(b)).then(|| format!("{path}: {a} vs {b}")),
    }
}

fn assert_same(rust: &Value, js: &Value, what: &str) {
    if canon(rust) != canon(js) {
        panic!("{what}: {}", diff(rust, js, "").unwrap_or_default());
    }
}

fn events_of(v: &Value) -> Vec<LogEvent> {
    v.as_array().unwrap().iter().filter_map(|e| e.as_object().and_then(LogEvent::from_object)).collect()
}

fn objects(v: &Value) -> Vec<Object> {
    v.as_array().unwrap().iter().map(|e| e.as_object().unwrap().clone()).collect()
}

#[test]
fn zufallsfolgen_wie_js() {
    replay_cases(&golden("replay.json"));
}

/// Viele weitere Folgen aus `STRESS=<datei> node core/tools/gen-golden-model.mjs`.
#[test]
#[ignore]
fn belastung() {
    let path = std::env::var("STRESS").expect("STRESS=<datei> setzen");
    replay_cases(&serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap());
}

fn replay_cases(g: &Value) {
    for case in g["random"].as_array().unwrap() {
        let seed = &case["seed"];
        let events = events_of(&case["events"]);
        let steps = case["steps"].as_array().unwrap();
        let ordered: Vec<bool> = case["ordered"].as_str().unwrap().chars().map(|c| c == '1').collect();
        let mut live = Model::new();
        for (i, ev) in events.iter().enumerate() {
            live.apply_remote(vec![ev.clone()]);
            assert_eq!(digest(live.state()), steps[i].as_str().unwrap(), "Seed {seed}, Schritt {i}: {ev:?}");
            assert_eq!(live.replay_ordered(), ordered[i], "Seed {seed}, Schritt {i}: Reihenfolge-Regel");
        }
        let sorted = Model::from_events(events);
        if let Some(full) = case.get("sortedState") {
            assert_same(&state_value(sorted.state()), full, &format!("Seed {seed} sortiert"));
        }
        assert_eq!(digest(sorted.state()), case["sorted"].as_str().unwrap(), "Seed {seed} sortiert");
    }
}

#[test]
fn grenzfaelle_wie_js() {
    let g = golden("replay.json");
    let hand = &g["hand"];
    let steps = hand["steps"].as_array().unwrap();
    let mut m = Model::new();
    for (i, raw) in hand["events"].as_array().unwrap().iter().enumerate() {
        if let Some(ev) = raw.as_object().and_then(LogEvent::from_object) {
            m.apply_remote(vec![ev]);
        }
        if digest(m.state()) != steps[i].as_str().unwrap() {
            // Ab hier zeigt der volle Endzustand die Abweichung am deutlichsten.
            let mut rest = m.clone();
            for raw in &hand["events"].as_array().unwrap()[i + 1..] {
                if let Some(ev) = raw.as_object().and_then(LogEvent::from_object) {
                    rest.apply_remote(vec![ev]);
                }
            }
            assert_same(&state_value(rest.state()), &hand["final"], &format!("Grenzfall ab Schritt {i}: {raw}"));
            panic!("Grenzfall Schritt {i}: {raw}");
        }
    }
    assert_same(&state_value(m.state()), &hand["final"], "Grenzfälle Endzustand");
}

fn shift(t: &str, ms: i64) -> String {
    Timestamp::parse_iso(t).unwrap().add_millis(ms).to_iso()
}

#[test]
fn laden_wie_js() {
    let replay = golden("replay.json");
    let by_seed: HashMap<u64, &Value> =
        replay["random"].as_array().unwrap().iter().map(|c| (c["seed"].as_u64().unwrap(), &c["events"])).collect();
    for case in golden("load.json").as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let events = objects(by_seed[&case["seed"].as_u64().unwrap()]);
        let cut = case["cut"].as_u64().unwrap() as usize;
        let (first, second) = events.split_at(cut);
        let first_max = first.iter().map(|e| e["t"].as_str().unwrap()).max().unwrap_or("").to_owned();
        let second: Vec<Object> = second
            .iter()
            .enumerate()
            .map(|(i, e)| {
                let mut e = e.clone();
                let t = e["t"].as_str().unwrap().to_owned();
                if case["lateSecond"] == json!(true) {
                    e.insert("t".into(), json!(shift(&t, -5 * 86_400_000)));
                } else if case["onTime"] == json!(true) && t < first_max {
                    e.insert("t".into(), json!(shift(&first_max, i as i64 + 1)));
                }
                e
            })
            .collect();
        let mut s = MemoryStorage::new();
        s.apply(first.iter().cloned().map(Write::AddEvent).collect()).unwrap();
        let mut writes = Vec::new();
        for (key, rec) in case["checkpointRecords"].as_object().unwrap() {
            if key == CURRENT_KEY {
                writes.push(Write::PutCheckpoint(CheckpointSlot::Current, rec.as_object().unwrap().clone()));
            } else if key == LEGACY_KEY {
                writes.push(Write::PutCheckpoint(CheckpointSlot::Legacy, rec.as_object().unwrap().clone()));
            } else if let Some(h) = key.strip_prefix(BLOB_PREFIX) {
                writes.push(Write::PutPart(PartKind::HeftBlob, h.into(), rec.as_str().unwrap().into()));
            } else if let Some(h) = key.strip_prefix(HEFT_PREFIX) {
                writes.push(Write::PutPart(PartKind::HeftDoc, h.into(), rec.as_str().unwrap().into()));
            }
        }
        s.apply(writes).unwrap();
        s.apply(second.into_iter().map(Write::AddEvent).collect()).unwrap();
        let (mut m, report) = Model::load(&mut s, NOW).unwrap();
        let r = &case["report"];
        assert_eq!(report.max_seq, r["maxSeq"].as_u64().unwrap(), "{name}");
        assert_eq!(report.count, r["count"].as_u64().unwrap(), "{name}");
        assert_eq!(report.max_time, r["maxTime"].as_str().unwrap(), "{name}");
        assert_eq!(report.replayed as u64, r["replayed"].as_u64().unwrap(), "{name}");
        assert_eq!(report.checkpoint_used, r["checkpointUsed"].as_bool().unwrap(), "{name}");
        assert_eq!(report.reject_reason.unwrap_or(""), r["reason"].as_str().unwrap(), "{name}");
        if let Some(full) = case.get("stateFull") {
            assert_same(&state_value(m.state()), full, name);
        }
        assert_eq!(digest(m.state()), case["state"].as_str().unwrap(), "{name}");
        let live = objects(&case["live"]);
        if !live.is_empty() {
            s.apply(live.iter().cloned().map(Write::AddEvent).collect()).unwrap();
            m.apply_remote(live.iter().filter_map(LogEvent::from_object).collect());
            assert_eq!(digest(m.state()), case["afterLive"].as_str().unwrap(), "{name} live");
            let saved = m.save_checkpoint(&mut s).unwrap();
            assert_eq!(
                saved == impala_model::CheckpointSave::Written,
                case["liveSaved"].as_bool().unwrap(),
                "{name}: {saved:?}"
            );
        }
        // Der eigene Checkpoint lädt wieder zum selben Zustand.
        if m.save_checkpoint(&mut s).unwrap() != impala_model::CheckpointSave::OutOfOrder {
            m.hydrate_heft_blobs(&s, None).unwrap();
            let (mut again, rep) = Model::load(&mut s, NOW).unwrap();
            again.hydrate_heft_blobs(&s, None).unwrap();
            assert!(rep.checkpoint_used, "{name}: eigener Checkpoint unbrauchbar ({:?})", rep.reject_reason);
            assert_same(&state_value(again.state()), &state_value(m.state()), &format!("{name}: eigener Checkpoint"));
        }
    }
}

#[test]
fn import_konflikte_wie_js() {
    for case in golden("import.json").as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let local = objects(&case["local"]);
        let after = case["unsyncedAfterSeq"].as_u64().unwrap();
        let ids: HashSet<String> = local.iter().map(|e| e["id"].as_str().unwrap().to_owned()).collect();
        let mut seen = ids.clone();
        let mut fresh: Vec<Object> = objects(&case["remote"])
            .into_iter()
            .filter(|e| seen.insert(e["id"].as_str().unwrap().to_owned()))
            .collect();
        let fresh_ids: Vec<&str> = fresh.iter().map(|e| e["id"].as_str().unwrap()).collect();
        let js_fresh: Vec<&str> = case["fresh"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
        assert_eq!(fresh_ids, js_fresh, "{name}");
        let model = Model::from_events(local.iter().filter_map(LogEvent::from_object).collect());
        let delta: Vec<Object> = local.iter().filter(|e| e["seq"].as_u64().unwrap() > after).cloned().collect();
        let mut times = case["derived"].as_array().unwrap().iter().map(|e| e["t"].as_str().unwrap().to_owned());
        let full = local.clone();
        let mut history = || full.clone();
        let mut now = || times.next().unwrap_or_default();
        let known = |id: &str| ids.contains(id);
        let page_info = |id: &str| model.state().page_info(id);
        let before = fresh.len();
        let res = conflict::detect_import_conflicts(
            &mut fresh,
            ImportContext {
                local: if case["partialLocal"] == json!(true) { &delta } else { &local },
                unsynced_after_seq: after,
                known: &known,
                history: &mut history,
                page_info: &page_info,
                now: &mut now,
            },
        );
        let derived: Vec<Value> = fresh[before..].iter().cloned().map(Value::Object).collect();
        assert_same(&Value::Array(derived), &case["derived"], &format!("{name}: abgeleitete Events"));
        let conflicts: Vec<Value> = res.conflicts.iter().map(|c| serde_json::to_value(c).unwrap()).collect();
        assert_same(&Value::Array(conflicts), &case["conflicts"], &format!("{name}: Konflikte"));
        assert_same(&serde_json::to_value(&res.merged).unwrap(), &case["merged"], &format!("{name}: zusammengeführt"));
    }
}

#[test]
fn merge3_wie_js() {
    for case in golden("merge.json").as_array().unwrap() {
        let s = |i: usize| case[i].as_str().unwrap();
        let expect = &case[3];
        match merge3(s(0), s(1), s(2)) {
            Merge3::Merged { text, changed } => {
                assert_eq!(expect["ok"], json!(true), "{case}");
                assert_eq!(text, expect["text"].as_str().unwrap(), "{case}");
                assert_eq!(changed, expect["changed"].as_bool().unwrap(), "{case}");
            }
            Merge3::Conflict => assert_eq!(expect["ok"], json!(false), "{case}"),
        }
    }
}

fn ids<'a>(list: impl IntoIterator<Item = &'a Page>) -> Value {
    json!(list.into_iter().map(|p| p.id()).collect::<Vec<_>>())
}

#[test]
fn abfragen_und_lernen_wie_js() {
    let replay = golden("replay.json");
    let by_seed: HashMap<u64, &Value> =
        replay["random"].as_array().unwrap().iter().map(|c| (c["seed"].as_u64().unwrap(), &c["events"])).collect();
    for q in golden("queries.json").as_array().unwrap() {
        let seed = q["seed"].as_u64().unwrap();
        let model = Model::from_events(events_of(by_seed[&seed]));
        let st = model.state();
        let at = |what: &str| format!("Seed {seed}: {what}");
        assert_same(&ids(st.active_pages()), &q["activePages"], &at("activePages"));
        assert_same(&ids(st.trashed_pages()), &q["trashedPages"], &at("trashedPages"));
        assert_same(&ids(st.archived_pages()), &q["archivedPages"], &at("archivedPages"));
        assert_same(&ids(st.archived_page_roots()), &q["archivedPageRoots"], &at("archivedPageRoots"));
        let card_ids = |l: Vec<&impala_model::Card>| json!(l.iter().map(|c| c.id()).collect::<Vec<_>>());
        assert_same(&card_ids(st.active_cards()), &q["activeCards"], &at("activeCards"));
        assert_same(&json!(st.archived_deck_roots()), &q["archivedDeckRoots"], &at("archivedDeckRoots"));
        assert_same(&json!(st.trashed_deck_roots()), &q["trashedDeckRoots"], &at("trashedDeckRoots"));
        assert_same(&card_ids(st.orphan_archived_cards()), &q["orphanArchivedCards"], &at("orphanArchivedCards"));
        assert_same(&card_ids(st.orphan_trashed_cards()), &q["orphanTrashedCards"], &at("orphanTrashedCards"));
        assert_same(&json!(st.page_titles()), &q["pageTitles"], &at("pageTitles"));
        let by_title: Object = st.pages_by_title().into_iter().map(|(t, p)| (t.to_owned(), json!(p.id()))).collect();
        assert_same(&Value::Object(by_title), &q["pagesByTitle"], &at("pagesByTitle"));
        for c in q["children"].as_array().unwrap() {
            let kids = st.children_of(c["id"].as_str(), c["ws"].as_str(), None);
            assert_same(&ids(kids), &c["kids"], &at(&format!("childrenOf {c}")));
        }
        for c in q["childPages"].as_array().unwrap() {
            assert_same(&ids(st.child_pages_of(c["id"].as_str())), &c["kids"], &at("childPagesOf"));
        }
        for c in q["subtree"].as_array().unwrap() {
            let mut sub = st.page_subtree(c["id"].as_str().unwrap());
            sub.sort();
            assert_same(&json!(sub), &c["ids"], &at("pageSubtreeIds"));
        }
        for (i, id) in st.pages.keys().enumerate() {
            assert_eq!(json!(st.is_page_archived(id)), q["archived"][i], "{}", at("isPageArchived"));
        }
        for f in q["find"].as_array().unwrap() {
            let t = f[0].as_str().unwrap();
            assert_eq!(json!(st.find_page(t, true).map(|p| p.id())), f[1], "{}", at(&format!("findPage {t}")));
            assert_eq!(json!(st.find_page(t, false).map(|p| p.id())), f[2], "{}", at(&format!("findPage {t}")));
        }
        for b in q["backlinks"].as_array().unwrap() {
            assert_same(&ids(st.backlinks_of(b["id"].as_str().unwrap())), &b["ids"], &at(&format!("backlinksOf {b}")));
        }
        for a in q["ancestors"].as_array().unwrap() {
            assert_same(&ids(st.ancestors_of(a["id"].as_str().unwrap())), &a["ids"], &at("ancestorsOf"));
        }
        let mut search = NoteSearch::new();
        for s in q["search"].as_array().unwrap() {
            let hits: Vec<Value> = search
                .search(&model, s["q"].as_str().unwrap(), false)
                .into_iter()
                .map(|h| json!([h.id, h.score, h.snippet]))
                .collect();
            assert_same(&Value::Array(hits), &s["hits"], &at(&format!("searchNotes {}", s["q"])));
        }
        for (i, d) in ["Mathe::Analysis::Folgen", "Physik", "", "Mathe"].iter().enumerate() {
            assert_same(&Value::Object(st.deck_conf(d).0), &q["deckConf"][i], &at(&format!("deckConfOf {d}")));
        }
        for s in q["study"].as_array().unwrap() {
            let ts = |k: &str| Timestamp::parse_iso(s[k].as_str().unwrap()).unwrap();
            let opts = StudyOptions {
                deck: s["deck"].as_str(),
                now: ts("now"),
                day_start: ts("dayStart"),
                day_end: ts("dayEnd"),
                mix: s["mix"].as_bool().unwrap(),
                overlearn_lock: s["lock"].as_bool().unwrap(),
            };
            let snap = st.study_snapshot(&opts);
            let what = at(&format!("studySnapshot {} {}", s["deck"], s["now"]));
            assert_same(&json!(snap.due_now), &s["dueNow"], &what);
            assert_same(&json!(snap.learn_due), &s["learnDue"], &what);
            assert_same(&json!(snap.learn_waiting), &s["learnWaiting"], &what);
            assert_same(&json!(snap.learn_later_today), &s["learnLaterToday"], &what);
            assert_same(&json!(snap.reviews_due), &s["reviewsDue"], &what);
            assert_same(&json!(snap.new_due), &s["newDue"], &what);
            let c = &snap.counts;
            let counts = json!({ "learn": c.learn, "learnNow": c.learn_now, "learnWaiting": c.learn_waiting, "review": c.review, "neu": c.new, "total": c.total });
            assert_same(&counts, &s["counts"], &what);
            let next = snap.next_learn_at.as_deref().and_then(Timestamp::parse_iso).map(|t| t.to_iso());
            assert_eq!(json!(next), s["nextLearnAt"], "{what}");
            assert_eq!(json!(snap.locked_ahead), s["lockedAhead"], "{what}");
            assert_eq!(
                (json!(snap.done), json!(snap.finished_for_now), json!(snap.available)),
                (s["done"].clone(), s["finishedForNow"].clone(), s["available"].clone()),
                "{what}"
            );
        }
    }
}

#[test]
fn seitenverlauf() {
    let replay = golden("replay.json");
    let events = events_of(&replay["random"][0]["events"]);
    let history = page_history(events, "p1");
    assert!(!history.is_empty());
    assert!(history.windows(2).all(|w| w[0].t <= w[1].t));
}

#[test]
fn konflikt_dialog_wie_js() {
    let g = golden("conflict-ui.json");
    for t in g["titles"].as_array().unwrap() {
        assert_eq!(conflict::conflict_title(t[0].as_str().unwrap()), t[1].as_str().unwrap(), "{t}");
    }
    let pages: Vec<Page> = objects(&g["pages"]).into_iter().map(Page::from_object).collect();
    let refs: Vec<&Page> = pages.iter().collect();
    for l in g["legacy"].as_array().unwrap() {
        let copy = pages.iter().find(|p| p.id() == l["id"].as_str().unwrap()).unwrap();
        let info = conflict::legacy_copy_info(copy, &refs);
        let got = json!({ "title": info.title, "nested": info.nested, "original": info.original, "extraLines": info.extra_lines });
        assert_same(&got, &l["info"], &format!("legacyCopyInfo {}", l["id"]));
    }
    for a in g["actions"].as_array().unwrap() {
        let c = Conflict::from_object(a["c"].as_object().unwrap().clone());
        let got: Vec<Value> = c.choices().iter().map(|ch| json!([ch.resolution.as_str(), ch.recommended])).collect();
        assert_same(&Value::Array(got), &a["actions"], &format!("conflictActions {}", a["c"]));
        assert_eq!(json!(c.recommended().map(|r| r.as_str())), a["recommended"], "{}", a["c"]);
    }
    for d in g["diffs"].as_array().unwrap() {
        let res = conflict::conflict_diff(d["a"].as_str().unwrap(), d["b"].as_str().unwrap());
        assert_same(&serde_json::to_value(&res).unwrap(), &d["diff"], "conflictDiff");
        let rows: Option<Vec<Value>> = res.map(|r| {
            conflict::align_diff_rows(&r)
                .into_iter()
                .map(|row| match row {
                    Row::Line { left, right, changed: true, start } => {
                        json!({ "left": left, "right": right, "changed": true, "start": start })
                    }
                    Row::Line { left, right, .. } => json!({ "left": left, "right": right, "changed": false }),
                    Row::Gap(n) => json!({ "gap": n }),
                })
                .collect()
        });
        assert_same(&json!(rows), &d["rows"], "alignDiffRows");
    }
}
