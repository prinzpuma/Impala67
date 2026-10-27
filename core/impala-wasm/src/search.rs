//! Vektorsuche und RAG-Ranking für die PWA. Die Daten gehen einmal in den WASM-Speicher
//! (`VectorIndex`, `RagIndex`), jede Anfrage übergibt nur den Abfragevektor.

use std::collections::HashMap;

use impala_search::store::ChunkVec;
use impala_search::vector::{best_k, cosine_scores, norm, rows};
use impala_search::{EmbeddingIdentity, PageMeta, VecRecord};
use serde_json::json;
use wasm_bindgen::prelude::*;

/// Flache Vektor-Matrix (`n × dim`) samt vorberechneten Zeilenbeträgen.
#[wasm_bindgen]
pub struct VectorIndex {
    dim: usize,
    matrix: Vec<f32>,
    norms: Vec<f32>,
}

#[wasm_bindgen]
impl VectorIndex {
    /// Übernimmt die Matrix (ein Kopiervorgang aus dem `Float32Array`).
    #[wasm_bindgen(constructor)]
    pub fn new(matrix: Vec<f32>, dim: usize) -> Result<VectorIndex, JsError> {
        rows(&matrix, dim).map_err(|e| JsError::new(&e.to_string()))?;
        let norms = matrix.chunks_exact(dim).map(norm).collect();
        Ok(VectorIndex { dim, matrix, norms })
    }

    #[wasm_bindgen(getter)]
    pub fn length(&self) -> usize {
        self.norms.len()
    }

    /// Die `k` ähnlichsten Zeilen, absteigend (bei Gleichstand kleinere Zeile zuerst).
    #[wasm_bindgen(js_name = topK)]
    pub fn top_k(&self, query: &[f32], k: usize) -> Result<TopK, JsError> {
        let scores = cosine_scores(&self.matrix, self.dim, query, Some(&self.norms))
            .map_err(|e| JsError::new(&e.to_string()))?;
        let hits = best_k(&scores, k);
        Ok(TopK { indices: hits.iter().map(|h| h.index).collect(), scores: hits.iter().map(|h| h.score).collect() })
    }
}

/// Ergebnis von [`VectorIndex::top_k`].
#[wasm_bindgen]
pub struct TopK {
    indices: Vec<u32>,
    scores: Vec<f32>,
}

#[wasm_bindgen]
impl TopK {
    #[wasm_bindgen(getter)]
    pub fn indices(&self) -> Vec<u32> {
        self.indices.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn scores(&self) -> Vec<f32> {
        self.scores.clone()
    }
}

/// Hybrid-Suchindex (`rankRag`): Chunk-Vektoren, -Texte und Seitenangaben bleiben im Kern.
#[wasm_bindgen]
pub struct RagIndex {
    index: impala_search::VectorIndex,
    page_ids: Vec<String>,
    pages: HashMap<String, PageMeta>,
}

/// Teilt einen mit `\0` verbundenen String; leer ergibt keine Teile.
fn split0(s: &str) -> Vec<&str> {
    if s.is_empty() { Vec::new() } else { s.split('\0').collect() }
}

#[wasm_bindgen]
impl RagIndex {
    /// `page_ids` und `texts` mit `\0` verbunden; `chunk_counts[i]` Chunks gehören zur Seite i,
    /// ihre Vektoren stehen in dieser Reihenfolge zeilenweise in `matrix`.
    #[wasm_bindgen(constructor)]
    pub fn new(
        page_ids: &str,
        chunk_counts: &[u32],
        texts: &str,
        matrix: &[f32],
        dim: usize,
    ) -> Result<RagIndex, JsError> {
        let page_ids: Vec<String> = split0(page_ids).into_iter().map(str::to_owned).collect();
        let texts = split0(texts);
        let n = rows(matrix, dim).map_err(|e| JsError::new(&e.to_string()))?;
        let total: usize = chunk_counts.iter().map(|&c| c as usize).sum();
        if page_ids.len() != chunk_counts.len() || texts.len() != n || total != n {
            return Err(JsError::new("Seiten, Chunk-Zahlen, Texte und Matrix passen nicht zusammen"));
        }
        let id = EmbeddingIdentity { model: "m".into(), provider_id: String::new() };
        let mut rows = matrix.chunks_exact(dim).zip(texts);
        let records: Vec<VecRecord> = chunk_counts
            .iter()
            .map(|&c| VecRecord {
                updated: None,
                model: Some(id.model.clone()),
                provider_id: None,
                chunks: rows
                    .by_ref()
                    .take(c as usize)
                    .map(|(v, t)| ChunkVec { text: t.to_owned(), vec: Some(v.to_vec()), norm: None })
                    .collect(),
            })
            .collect();
        let index = impala_search::VectorIndex::build(page_ids.iter().map(String::as_str).zip(&records), &id);
        Ok(RagIndex { index, page_ids, pages: HashMap::new() })
    }

    /// Titel (mit `\0` verbunden) und Flags (Bit 0 Papierkorb, Bit 1 Archiv) je Seite in
    /// Bau-Reihenfolge. Nur nach Änderungen an Seiten nötig, nicht je Anfrage.
    #[wasm_bindgen(js_name = setPages)]
    pub fn set_pages(&mut self, titles: &str, flags: &[u8]) -> Result<(), JsError> {
        let titles = split0(titles);
        if titles.len() != self.page_ids.len() || flags.len() != self.page_ids.len() {
            return Err(JsError::new("Seitenangaben passen nicht zum Index"));
        }
        self.pages = self
            .page_ids
            .iter()
            .zip(titles.into_iter().zip(flags))
            .map(|(id, (t, &f))| {
                (id.clone(), PageMeta { title: t.to_owned(), trashed: f & 1 != 0, archived: f & 2 != 0 })
            })
            .collect();
        Ok(())
    }

    /// Inhaltlich ähnliche Seiten (ohne Papierkorb/Archiv) als JSON-Array `[{ id, score }]`.
    /// Braucht vorher [`RagIndex::set_pages`].
    pub fn related(&self, page_id: &str, k: usize) -> String {
        let hits = impala_search::related(&self.index, &self.pages, page_id, k);
        let hits: Vec<_> = hits.iter().map(|h| json!({ "id": h.page_id, "score": h.score })).collect();
        serde_json::Value::Array(hits).to_string()
    }

    /// Treffer wie `rankRag` als JSON-Array (`pageId`, `title`, `snippet`, `score`, …).
    pub fn rank(&self, query: &str, qv: &[f32], k: usize) -> String {
        let hits = impala_search::rank_rag(&self.index, &self.pages, query, qv, k);
        let hits: Vec<_> = hits
            .iter()
            .map(|h| {
                json!({
                    "pageId": h.page_id, "title": h.title, "snippet": h.snippet, "score": h.score,
                    "semanticScore": h.semantic_score, "lexicalScore": h.lexical_score, "archived": h.archived,
                })
            })
            .collect();
        serde_json::Value::Array(hits).to_string()
    }
}

/// Abschnitte für die Einbettung (Überschriften beginnen neue, Nachbarn überlappen leicht).
#[wasm_bindgen(js_name = ragChunk)]
pub fn rag_chunk(text: &str) -> Vec<String> {
    impala_search::chunk(text)
}

/// Gesamttext einer Seite für [`rag_chunk`]: Titel, Inhalt, PDF-Volltexte und Handschrift.
/// `heft_pages`: JSON `[{ texts: [..], ocrText }]` (leer: kein Heft-Dokument geladen).
#[wasm_bindgen(js_name = ragIndexText)]
pub fn rag_index_text(
    title: &str,
    content: &str,
    pdf_text: Option<String>,
    inline_pdf_texts: Vec<String>,
    heft_pages: &str,
    heft_meta_ocr: Option<String>,
) -> String {
    let heft_pages = match serde_json::from_str::<serde_json::Value>(heft_pages) {
        Ok(serde_json::Value::Array(pages)) => pages
            .iter()
            .map(|p| impala_search::HeftPageText {
                texts: p["texts"]
                    .as_array()
                    .map(|t| t.iter().filter_map(|x| x["text"].as_str().map(str::to_owned)).collect())
                    .unwrap_or_default(),
                ocr_text: p["ocrText"].as_str().map(str::to_owned),
            })
            .collect(),
        _ => Vec::new(),
    };
    impala_search::index_text(&impala_search::IndexSource {
        title: title.to_owned(),
        content: content.to_owned(),
        pdf_text,
        inline_pdf_texts,
        heft_pages,
        heft_meta_ocr,
    })
}

/// Blob-Ids der im Inhalt eingebetteten Dateien (`:::file <id>`), ohne die Seiten-PDF.
#[wasm_bindgen(js_name = ragInlineFileIds)]
pub fn rag_inline_file_ids(content: &str, pdf_id: Option<String>) -> Vec<String> {
    impala_search::inline_file_ids(content, pdf_id.as_deref())
}

/// Ist die Datei eine PDF (MIME-Typ oder Endung)?
#[wasm_bindgen(js_name = ragIsPdf)]
pub fn rag_is_pdf(mime: Option<String>, name: Option<String>) -> bool {
    impala_search::chunk::is_pdf(mime.as_deref(), name.as_deref())
}

/// Volltextsuche über Seiten (`STATE.searchNotes`): exakte Treffer, aufgefüllt mit
/// Tippfehler-Treffern. Seiten werden nur bei Änderung neu übergeben.
#[wasm_bindgen]
#[derive(Default)]
pub struct NoteIndex(impala_search::NoteIndex);

#[wasm_bindgen]
impl NoteIndex {
    #[wasm_bindgen(constructor)]
    pub fn new() -> NoteIndex {
        NoteIndex::default()
    }

    /// Seite aufnehmen oder ersetzen. `in_archive`: archiviert oder unter einer archivierten Seite.
    #[wasm_bindgen(js_name = setPage)]
    #[allow(clippy::too_many_arguments)]
    pub fn set_page(
        &mut self,
        id: String,
        title: String,
        content: String,
        ocr: String,
        updated: String,
        archived: bool,
        in_archive: bool,
    ) {
        self.0.set_page(impala_search::NoteDoc { id, title, content, ocr, updated, archived, in_archive });
    }

    /// Nur Archiv-Angaben ändern; `false`, wenn die Seite unbekannt ist.
    #[wasm_bindgen(js_name = setFlags)]
    pub fn set_flags(&mut self, id: &str, archived: bool, in_archive: bool) -> bool {
        self.0.set_flags(id, archived, in_archive)
    }

    #[wasm_bindgen(js_name = removePage)]
    pub fn remove_page(&mut self, id: &str) {
        self.0.remove_page(id);
    }

    /// Höchstens 8 Treffer als JSON-Array `[{ id, score, terms, snippet }]`.
    pub fn search(&self, query: &str, include_archived: bool) -> String {
        let hits: Vec<_> = self
            .0
            .search(query, include_archived)
            .into_iter()
            .map(|h| json!({ "id": h.id, "score": h.score, "terms": h.terms, "snippet": h.snippet }))
            .collect();
        serde_json::Value::Array(hits).to_string()
    }
}
