//! Vergleich mit dem JS-Original. Die Golden-Files erzeugt `core/tools/gen-golden-search.mjs` aus
//! `web/search-fuzzy.js`, `web/state.js` (`searchNotes`), `web/rag.js` und `web/rag-ranking.js`.
//! Floats mit Toleranz (JS rechnet in `f64`, Rust die Skalarprodukte in `f32`).

use std::collections::HashMap;

use impala_search::chunk::is_pdf;
use impala_search::store::ReindexPlan;
use impala_search::{
    EmbeddingIdentity, FuzzyIndex, HeftPageText, IndexSource, NoteDoc, NoteIndex, PageMeta, VecEntry, VecRecord,
    VectorIndex, chunk, fold, index_text, inline_file_ids, is_valid_vector, rank_rag, related, typo_distance,
    vector_model_key,
};
use serde_json::Value;

fn golden(name: &str) -> Value {
    let path = format!("{}/tests/golden/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn s(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_owned()
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array().map(|a| a.iter().map(s).collect()).unwrap_or_default()
}

fn u16s(v: &Value) -> Vec<u16> {
    v.as_str().unwrap().encode_utf16().collect()
}

#[test]
fn fold_and_distance() {
    let g = golden("fold.json");
    for c in g["fold"].as_array().unwrap() {
        assert_eq!(fold(c["input"].as_str().unwrap()), s(&c["output"]), "fold({})", c["input"]);
    }
    for c in g["distance"].as_array().unwrap() {
        let (a, b) = (u16s(&c["a"]), u16s(&c["b"]));
        let max = c["max"].as_u64().unwrap() as usize;
        let got = typo_distance(&a, &b, max, c["b_len"].as_u64().unwrap() as usize);
        assert_eq!(got as u64, c["output"].as_u64().unwrap(), "{c}");
    }
}

#[test]
fn fuzzy_index() {
    let mut ix = FuzzyIndex::new();
    let mut searches = 0;
    for op in golden("fuzzy.json").as_array().unwrap() {
        if op["op"] == "set" {
            ix.set_page(op["id"].as_str().unwrap(), op["text"].as_str().unwrap());
            continue;
        }
        let allow: Option<Vec<String>> = op["allow"].as_array().map(|a| a.iter().map(s).collect());
        let hits =
            ix.search(op["query"].as_str().unwrap(), |id| allow.as_ref().is_none_or(|a| a.iter().any(|x| x == id)));
        let want: Vec<(String, u64, Vec<String>)> = op["result"]
            .as_array()
            .unwrap()
            .iter()
            .map(|h| (s(&h["id"]), h["score"].as_u64().unwrap(), strings(&h["forms"])))
            .collect();
        let got: Vec<(String, u64, Vec<String>)> =
            hits.into_iter().map(|h| (h.id, u64::from(h.score), h.forms)).collect();
        assert_eq!(got, want, "Suche {}", op["query"]);
        searches += 1;
    }
    assert!(searches >= 10);
}

#[test]
fn search_notes() {
    let g = golden("notes.json");
    let mut ix = NoteIndex::new();
    for d in g["docs"].as_array().unwrap() {
        ix.set_page(NoteDoc {
            id: s(&d["id"]),
            title: s(&d["title"]),
            content: s(&d["content"]),
            ocr: s(&d["ocr"]),
            updated: s(&d["updated"]),
            archived: d["archived"].as_bool().unwrap(),
            in_archive: d["in_archive"].as_bool().unwrap(),
        });
    }
    let mut compared = 0;
    for c in g["cases"].as_array().unwrap() {
        let hits = ix.search(c["query"].as_str().unwrap(), c["include_archived"].as_bool().unwrap());
        let want = c["hits"].as_array().unwrap();
        assert_eq!(hits.len(), want.len(), "Anzahl für {}", c["query"]);
        for (h, w) in hits.iter().zip(want) {
            assert_eq!((h.id.as_str(), u64::from(h.score)), (w["id"].as_str().unwrap(), w["score"].as_u64().unwrap()));
            assert_eq!(h.terms, w["terms"].as_array().map(|_| strings(&w["terms"])), "{}", c["query"]);
            // Abweichung (bewusst): Seiten mit „İ“ – JS schnitt den Ausschnitt an der Position
            // im kleingeschriebenen Text aus und verrutschte; Rust schneidet an der echten Stelle.
            let raw = ix_raw(&g, &h.id);
            if raw.to_lowercase().encode_utf16().count() == raw.encode_utf16().count() {
                assert_eq!(h.snippet, s(&w["snippet"]), "Ausschnitt {} für {}", h.id, c["query"]);
                compared += 1;
            }
        }
    }
    assert!(compared > 100);
}

/// Originaltext einer Seite wie `rawTextOf`.
fn ix_raw(g: &Value, id: &str) -> String {
    let d = g["docs"].as_array().unwrap().iter().find(|d| d["id"] == id).unwrap();
    let ocr = s(&d["ocr"]);
    let base = format!("{}\n{}", s(&d["title"]), s(&d["content"]));
    if ocr.is_empty() { base } else { format!("{base}\n{ocr}") }
}

fn heft_pages(doc: &Value) -> Vec<HeftPageText> {
    doc["pages"]
        .as_array()
        .map(|pages| {
            pages
                .iter()
                .map(|p| HeftPageText {
                    // Nicht-Text-Werte zählen wie in JS als String (`String(t.text)`).
                    texts: p["texts"]
                        .as_array()
                        .map(|t| {
                            t.iter()
                                .filter_map(|t| match &t["text"] {
                                    Value::String(x) => Some(x.clone()),
                                    Value::Number(n) => Some(n.to_string()),
                                    _ => None,
                                })
                                .collect()
                        })
                        .unwrap_or_default(),
                    ocr_text: p["ocrText"].as_str().map(str::to_owned),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn source(g: &Value, id: &str, page: &Value) -> IndexSource {
    let texts = &g["pdf_texts"];
    let content = s(&page["content"]);
    let pdf_id = page["pdfId"].as_str();
    let inline_pdf_texts = inline_file_ids(&content, pdf_id)
        .into_iter()
        .filter_map(|f| {
            let meta = &g["blob_meta"][&f];
            let text = texts[&f].as_str()?;
            // Ohne Metadaten: der Text-Blob existiert, die PDF wurde schon extrahiert.
            (meta.is_null() || is_pdf(meta["type"].as_str(), meta["name"].as_str())).then(|| text.to_owned())
        })
        .collect();
    IndexSource {
        title: s(&page["title"]),
        content,
        pdf_text: pdf_id.and_then(|p| texts[p].as_str()).map(str::to_owned),
        inline_pdf_texts,
        heft_pages: heft_pages(&g["heft_docs"][id]),
        heft_meta_ocr: g["heft_meta"][id]["ocrText"].as_str().map(str::to_owned),
    }
}

#[test]
fn chunking_like_rag_js() {
    let g = golden("chunks.json");
    let pages = g["round1"]["pages"].as_object().unwrap();
    let mut total = 0;
    for (id, page) in pages {
        let text = index_text(&source(&g, id, page));
        let got = chunk(&text);
        let want = strings(&page["chunks"]);
        if page["js_dupe"] == true {
            // Abweichung (bewusst): doppelt eingebettete Datei zählt einmal.
            assert_ne!(got, want);
            assert_eq!(text.matches("Eingebettet zwei").count(), 1);
            continue;
        }
        assert_eq!(got, want, "Chunks von {id}");
        total += got.len();
    }
    assert_eq!(total as u64, g["round1"]["embedded"].as_u64().unwrap() - 1, "alle Chunks eingebettet (ohne {})", "c11");
}

#[test]
fn reindex_reuses_vectors_like_rag_js() {
    let g = golden("chunks.json");
    let id = EmbeddingIdentity::from_settings("local:bekko-a8m", "local");
    let mut missing_total = 0;
    for (page_id, r) in g["round2"].as_object().unwrap() {
        let mut page = g["round1"]["pages"][page_id].clone();
        page["content"] = r["content"].clone();
        let chunks = chunk(&index_text(&source(&g, page_id, &page)));
        assert_eq!(chunks, strings(&r["chunks"]), "Chunks von {page_id}");
        let prev: VecRecord = serde_json::from_value(r["previous"].clone()).unwrap();
        let plan = ReindexPlan::new(chunks, Some(&prev), &id);
        let want: Vec<usize> = r["embedded"].as_array().unwrap().iter().map(|i| i.as_u64().unwrap() as usize).collect();
        assert_eq!(plan.missing(), want, "neu einzubetten in {page_id}");
        missing_total += want.len();
    }
    assert_eq!(missing_total as u64, g["round2_embedded_total"].as_u64().unwrap());
    for pair in g["model_keys"].as_array().unwrap() {
        assert_eq!(vector_model_key(pair[0].as_str().unwrap()), s(&pair[1]));
    }
    for pair in g["valid"].as_array().unwrap() {
        let v: Vec<f32> = pair[0]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_f64().map_or_else(|| x.as_str().unwrap().parse::<f32>().unwrap(), |x| x as f32))
            .collect();
        assert_eq!(is_valid_vector(&v), pair[1].as_bool().unwrap(), "{pair}");
    }
}

/// Golden, Seiten-Einträge, Seitenangaben, Herkunft.
type RankFixture = (Value, Vec<(String, VecRecord)>, HashMap<String, PageMeta>, EmbeddingIdentity);

fn rank_fixture() -> RankFixture {
    let g = golden("rank.json");
    let records: Vec<(String, VecRecord)> = g["records"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|pair| match serde_json::from_value::<VecEntry>(pair[1].clone()).unwrap() {
            VecEntry::Page(r) => Some((s(&pair[0]), r)),
            VecEntry::Card(_) => None,
        })
        .collect();
    let pages = g["pages"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(id, p)| {
            let meta = PageMeta {
                title: s(&p["title"]),
                trashed: p["trashed"].as_bool().unwrap(),
                archived: p["archived"].as_bool().unwrap(),
            };
            (id.clone(), meta)
        })
        .collect();
    let id = EmbeddingIdentity { model: s(&g["model"]), provider_id: s(&g["provider_id"]) };
    (g, records, pages, id)
}

fn close(a: f64, b: f64, tol: f64) -> bool {
    (a - b).abs() <= tol
}

#[test]
fn rank_rag_like_js() {
    let (g, records, pages, id) = rank_fixture();
    assert_eq!(records.len() + 1, g["records"].as_array().unwrap().len(), "Karten-Eintrag erkannt");
    let index = VectorIndex::build(records.iter().map(|(k, r)| (k.as_str(), r)), &id);
    let mut compared = 0;
    for c in g["cases"].as_array().unwrap() {
        let qv: Vec<f32> = c["qv"].as_array().unwrap().iter().map(|x| x.as_f64().unwrap() as f32).collect();
        let k = c["k"].as_u64().unwrap() as usize;
        let hits = rank_rag(&index, &pages, c["query"].as_str().unwrap(), &qv, k);
        let want = c["hits"].as_array().unwrap();
        assert_eq!(hits.len(), want.len(), "Anzahl für {}", c["query"]);
        for (h, w) in hits.iter().zip(want) {
            let ctx = format!("{} / {}", c["query"], w["pageId"]);
            assert_eq!(h.page_id, s(&w["pageId"]), "{ctx}");
            assert_eq!(h.title, s(&w["title"]), "{ctx}");
            assert_eq!(h.snippet, s(&w["snippet"]), "{ctx}");
            assert_eq!(h.archived, w["archived"].as_bool().unwrap(), "{ctx}");
            // Gerundet auf 3 Stellen: Toleranz eine Rundungsstufe.
            assert!(close(h.score, w["score"].as_f64().unwrap(), 1.01e-3), "{ctx}: {} vs {}", h.score, w["score"]);
            assert!(close(h.semantic_score, w["semanticScore"].as_f64().unwrap(), 1.01e-3), "{ctx}");
            assert!(close(h.lexical_score, w["lexicalScore"].as_f64().unwrap(), 1.01e-3), "{ctx}");
            compared += 1;
        }
    }
    assert!(compared > 100);
}

#[test]
fn related_like_js() {
    let (g, records, pages, id) = rank_fixture();
    let index = VectorIndex::build(records.iter().map(|(k, r)| (k.as_str(), r)), &id);
    for c in g["related"].as_array().unwrap() {
        let page_id = c["page_id"].as_str().unwrap();
        let hits = related(&index, &pages, page_id, c["k"].as_u64().unwrap() as usize);
        let want = c["hits"].as_array().unwrap();
        let got: Vec<&str> = hits.iter().map(|h| h.page_id.as_str()).collect();
        let want_ids: Vec<&str> = want.iter().map(|w| w["id"].as_str().unwrap()).collect();
        assert_eq!(got, want_ids, "verwandt mit {page_id}");
        for (h, w) in hits.iter().zip(want) {
            assert!(close(f64::from(h.score), w["score"].as_f64().unwrap(), 1e-5), "{page_id}");
        }
    }
}
