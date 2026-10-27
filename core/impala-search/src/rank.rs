//! RAG-Suche: Hybrid aus Vektor- und Textsignal (wie `rankRag` in `web/rag-ranking.js`)
//! und verwandte Seiten (wie `related` in `web/rag.js`).
//!
//! Score je Chunk: `max(sem + (1 − sem) · 0,45 · lex, exakt)` mit `sem` = Kosinus (≥ 0),
//! `lex` = BM25 (k1 = 1,2, b = 0,75, Titel-Bonus, Phrasen-Bonus) geteilt durch das Maximum,
//! `exakt` = 0,8 bei gleichem Titel, 0,7 bei wörtlichem Treffer. Höchstens zwei Chunks je Seite.
//!
//! Anders als JS wird der [`VectorIndex`] einmal aus den Einträgen gebaut (flache Matrix,
//! vorberechnete Beträge und Wortzählungen) statt bei jeder Anfrage alle Chunk-Texte neu zu
//! zerlegen. Titel und Papierkorb/Archiv kommen weiter je Anfrage herein ([`PageMeta`]).

use std::collections::HashMap;

use crate::embed::{EmbedError, Embedder, EmbeddingIdentity};
use crate::store::VecRecord;
use crate::text::{FxMap, lower, slice_utf16, utf16_len};
use crate::vector::{dot, mean_direction, norm};

const STOP_WORDS: &[&str] = &[
    "aber", "alle", "auch", "aus", "bei", "das", "dem", "den", "der", "des", "die", "ein", "eine", "einer", "eines",
    "für", "hat", "ich", "ist", "mit", "nach", "oder", "sich", "sind", "und", "von", "was", "wie", "wird", "zu", "the",
    "and", "for", "from", "that", "this", "with",
];
/// Mindest-Ähnlichkeit verwandter Seiten.
pub const RELATED_MIN: f32 = 0.5;
/// Länge des Ausschnitts je Treffer (UTF-16-Einheiten).
pub const SNIPPET_LEN: usize = 400;
pub const MAX_PER_PAGE: usize = 2;

/// Wörter wie `termsOf`: `[\p{L}\p{N}_-]{2,}` ohne Stoppwörter; erwartet Kleinschrift.
fn terms_of(lc: &str) -> impl Iterator<Item = &str> {
    lc.split(|c: char| !(crate::text::is_word_char(c) || c == '_' || c == '-'))
        .filter(|t| t.chars().nth(1).is_some() && !STOP_WORDS.contains(t))
}

/// Seitenangaben zur Anfragezeit (aus dem aktuellen Zustand, nicht aus dem Index).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct PageMeta {
    pub title: String,
    pub trashed: bool,
    pub archived: bool,
}

struct Chunk {
    page: u32,
    text: String,
    text_lc: String,
    /// (Wort-Id, Anzahl), nach Id sortiert.
    counts: Vec<(u32, u32)>,
    len: u32,
}

/// Vorbereiteter Suchindex aller nutzbaren Chunks einer Embedding-Herkunft.
pub struct VectorIndex {
    dim: usize,
    /// Zeilenweise `chunks.len() × dim`.
    matrix: Vec<f32>,
    norms: Vec<f32>,
    chunks: Vec<Chunk>,
    pages: Vec<String>,
    page_of: HashMap<String, u32>,
    /// Normierter Mittelwert der Chunk-Vektoren je Seite.
    page_vecs: Vec<Option<Vec<f32>>>,
    vocab: FxMap<String, u32>,
}

impl VectorIndex {
    /// Baut den Index aus `(Seiten-Id, Eintrag)` in Store-Reihenfolge. Übernommen werden
    /// Einträge passender Herkunft und Chunks mit gültigem Vektor der ersten gefundenen Dimension.
    ///
    /// Abweichung vom JS: Chunks mit NaN-Werten oder abweichender Dimension fallen schon hier
    /// weg (JS prüfte die Dimension je Anfrage und rechnete NaN-Scores mit).
    pub fn build<'a>(records: impl IntoIterator<Item = (&'a str, &'a VecRecord)>, id: &EmbeddingIdentity) -> Self {
        let mut ix = VectorIndex {
            dim: 0,
            matrix: Vec::new(),
            norms: Vec::new(),
            chunks: Vec::new(),
            pages: Vec::new(),
            page_of: HashMap::new(),
            page_vecs: Vec::new(),
            vocab: FxMap::default(),
        };
        for (page_id, rec) in records {
            if !rec.usable_for(id) || ix.page_of.contains_key(page_id) {
                continue;
            }
            let page = ix.pages.len() as u32;
            let first = ix.chunks.len();
            for c in &rec.chunks {
                let Some(v) = c.vec.as_deref().filter(|v| crate::embed::is_valid_vector(v)) else { continue };
                if ix.dim == 0 {
                    ix.dim = v.len();
                }
                if v.len() != ix.dim {
                    continue;
                }
                ix.matrix.extend_from_slice(v);
                ix.norms.push(c.norm_or_compute());
                let text_lc = lower(&c.text);
                let (counts, len) = count_terms(&text_lc, &mut ix.vocab);
                ix.chunks.push(Chunk { page, text: c.text.clone(), text_lc, counts, len });
            }
            let dim = ix.dim;
            let rows = (first..ix.chunks.len()).map(|i| &ix.matrix[i * dim..(i + 1) * dim]);
            ix.page_vecs.push(mean_direction(rows, dim));
            ix.page_of.insert(page_id.to_owned(), page);
            ix.pages.push(page_id.to_owned());
        }
        ix
    }

    pub fn dim(&self) -> usize {
        self.dim
    }

    pub fn len(&self) -> usize {
        self.chunks.len()
    }

    pub fn is_empty(&self) -> bool {
        self.chunks.is_empty()
    }

    /// Flache Vektor-Matrix (`len() × dim()`), z. B. für [`crate::vector::top_k`].
    pub fn matrix(&self) -> &[f32] {
        &self.matrix
    }
}

fn count_terms(lc: &str, vocab: &mut FxMap<String, u32>) -> (Vec<(u32, u32)>, u32) {
    let mut counts: Vec<(u32, u32)> = Vec::new();
    let mut len = 0;
    for t in terms_of(lc) {
        let id = match vocab.get(t) {
            Some(&id) => id,
            None => {
                let id = vocab.len() as u32;
                vocab.insert(t.to_owned(), id);
                id
            }
        };
        counts.push((id, 1));
        len += 1;
    }
    counts.sort_unstable_by_key(|c| c.0);
    counts.dedup_by(|b, a| {
        let same = a.0 == b.0;
        if same {
            a.1 += b.1;
        }
        same
    });
    (counts, len)
}

/// Treffer der RAG-Suche (Werte auf drei Stellen gerundet wie JS).
#[derive(Debug, Clone, PartialEq)]
pub struct RagHit {
    pub page_id: String,
    pub title: String,
    pub snippet: String,
    pub score: f64,
    pub semantic_score: f64,
    pub lexical_score: f64,
    pub archived: bool,
}

/// `Math.round(x * 1000) / 1000`.
fn round3(x: f64) -> f64 {
    (x * 1000.0 + 0.5).floor() / 1000.0
}

/// Hybrid-Suche. `qv` ist der Anfrage-Vektor derselben Herkunft wie der Index.
pub fn rank_rag(
    index: &VectorIndex,
    pages: &HashMap<String, PageMeta>,
    query: &str,
    qv: &[f32],
    k: usize,
) -> Vec<RagHit> {
    if qv.len() != index.dim || index.dim == 0 {
        return Vec::new();
    }
    let page_meta: Vec<Option<&PageMeta>> =
        index.pages.iter().map(|id| pages.get(id).filter(|pg| !pg.trashed)).collect();
    let title_lc: Vec<String> = page_meta.iter().map(|m| m.map(|m| lower(&m.title)).unwrap_or_default()).collect();
    let docs: Vec<usize> =
        (0..index.chunks.len()).filter(|&i| page_meta[index.chunks[i].page as usize].is_some()).collect();
    let qn = f64::from(norm(qv));
    let exact = lower(query);
    let exact = crate::text::js_trim(&exact);
    let exact_len = utf16_len(exact);
    // `searchable` = Titel + "\n" + Chunk-Text (klein)
    let searchable_has = |ci: usize, needle: &str| {
        let c = &index.chunks[ci];
        let title = &title_lc[c.page as usize];
        c.text_lc.contains(needle)
            || title.contains(needle)
            || (needle.contains('\n') && format!("{title}\n{}", c.text_lc).contains(needle))
    };

    let lexical = lexical_scores(index, &docs, &title_lc, exact, exact_len, &searchable_has);
    let max_lex = lexical.iter().copied().fold(0f64, f64::max);

    let mut hits: Vec<(f64, f64, f64, usize)> = docs
        .iter()
        .enumerate()
        .map(|(d, &ci)| {
            let c = &index.chunks[ci];
            let row = &index.matrix[ci * index.dim..(ci + 1) * index.dim];
            let semantic_raw = f64::from(dot(qv, row)) / (qn * f64::from(index.norms[ci]));
            let semantic = semantic_raw.max(0.0);
            let lex = if max_lex > 0.0 { lexical[d] / max_lex } else { 0.0 };
            let exact_match = !exact.is_empty()
                && if exact_len >= 4 {
                    searchable_has(ci, exact)
                } else {
                    // Kurze Anfragen zählen nur als ganzes Wort.
                    index.vocab.get(exact).is_some_and(|id| c.counts.binary_search_by_key(id, |p| p.0).is_ok())
                        || terms_of(&title_lc[c.page as usize]).any(|t| t == exact)
                };
            let title = &title_lc[c.page as usize];
            let floor = if !exact.is_empty() && crate::text::js_trim(title) == exact {
                0.8
            } else if exact_match {
                0.7
            } else {
                0.0
            };
            let score = (semantic + (1.0 - semantic) * 0.45 * lex).max(floor);
            (score, semantic_raw, lex, ci)
        })
        .collect();
    hits.sort_by(|a, b| b.0.total_cmp(&a.0));

    let mut per_page: HashMap<u32, usize> = HashMap::new();
    let mut out = Vec::new();
    for (score, semantic, lex, ci) in hits {
        let c = &index.chunks[ci];
        let n = per_page.entry(c.page).or_default();
        if *n >= MAX_PER_PAGE {
            continue;
        }
        *n += 1;
        let meta = page_meta[c.page as usize].expect("nur Chunks vorhandener Seiten");
        out.push(RagHit {
            page_id: index.pages[c.page as usize].clone(),
            title: meta.title.clone(),
            snippet: slice_utf16(&c.text, 0, SNIPPET_LEN).to_owned(),
            score: round3(score),
            semantic_score: round3(semantic),
            lexical_score: round3(lex),
            archived: meta.archived,
        });
        if out.len() >= k {
            break;
        }
    }
    out
}

/// BM25 über die Chunks `docs`; Titelwörter zählen zum Chunk (wie `searchable` in JS).
fn lexical_scores(
    index: &VectorIndex,
    docs: &[usize],
    title_lc: &[String],
    query: &str,
    query_len: usize,
    searchable_has: &dyn Fn(usize, &str) -> bool,
) -> Vec<f64> {
    let mut terms: Vec<&str> = Vec::new();
    for t in terms_of(query) {
        if !terms.contains(&t) {
            terms.push(t);
        }
    }
    let mut scores = vec![0f64; docs.len()];
    if terms.is_empty() || docs.is_empty() {
        return scores;
    }
    // Titel je Seite einmal zerlegen.
    let mut title_terms: HashMap<u32, (Vec<u32>, u32)> = HashMap::new();
    let tf_of = |title_terms: &mut HashMap<u32, (Vec<u32>, u32)>, ci: usize| -> (Vec<u32>, u32) {
        let c = &index.chunks[ci];
        let (tcounts, tlen) = title_terms
            .entry(c.page)
            .or_insert_with(|| {
                let words: Vec<&str> = terms_of(&title_lc[c.page as usize]).collect();
                (terms.iter().map(|q| words.iter().filter(|w| *w == q).count() as u32).collect(), words.len() as u32)
            })
            .clone();
        let tf = terms
            .iter()
            .zip(&tcounts)
            .map(|(q, tc)| {
                let in_text = index
                    .vocab
                    .get(*q)
                    .and_then(|id| c.counts.binary_search_by_key(id, |p| p.0).ok())
                    .map_or(0, |at| c.counts[at].1);
                in_text + tc
            })
            .collect();
        (tf, c.len + tlen)
    };
    let per_doc: Vec<(Vec<u32>, u32)> = docs.iter().map(|&ci| tf_of(&mut title_terms, ci)).collect();
    let n = docs.len() as f64;
    let total: f64 = per_doc.iter().map(|d| f64::from(d.1)).sum();
    let avg = if total / n > 0.0 { total / n } else { 1.0 };
    let idf: Vec<f64> = (0..terms.len())
        .map(|t| {
            let df = per_doc.iter().filter(|d| d.0[t] > 0).count() as f64;
            (1.0 + (n - df + 0.5) / (df + 0.5)).ln()
        })
        .collect();
    for (d, &ci) in docs.iter().enumerate() {
        let (tf, len) = &per_doc[d];
        let title = &title_lc[index.chunks[ci].page as usize];
        let mut score = 0.0;
        for (t, term) in terms.iter().enumerate() {
            let f = f64::from(tf[t]);
            if f == 0.0 {
                continue;
            }
            let den = f + 1.2 * (0.25 + 0.75 * f64::from(*len) / avg);
            score += idf[t] * f * 2.2 / den;
            if title.contains(term) {
                score += idf[t] * 0.8;
            }
        }
        if query_len >= 3 && searchable_has(ci, query) {
            score += 2.0;
        }
        scores[d] = score;
    }
    scores
}

/// Verwandte Seite mit Ähnlichkeit der Seitenvektoren.
#[derive(Debug, Clone, PartialEq)]
pub struct RelatedHit {
    pub page_id: String,
    pub score: f32,
}

/// Inhaltlich ähnliche Seiten (ohne Papierkorb/Archiv, ab [`RELATED_MIN`]), absteigend.
pub fn related(index: &VectorIndex, pages: &HashMap<String, PageMeta>, page_id: &str, k: usize) -> Vec<RelatedHit> {
    let Some(base) = index.page_of.get(page_id).and_then(|&p| index.page_vecs[p as usize].as_deref()) else {
        return Vec::new();
    };
    let mut hits: Vec<RelatedHit> = index
        .pages
        .iter()
        .zip(&index.page_vecs)
        .filter(|(id, _)| id.as_str() != page_id && pages.get(*id).is_some_and(|pg| !pg.trashed && !pg.archived))
        .filter_map(|(id, v)| {
            let score = dot(v.as_deref()?, base);
            (score >= RELATED_MIN).then(|| RelatedHit { page_id: id.clone(), score })
        })
        .collect();
    hits.sort_by(|a, b| b.score.total_cmp(&a.score));
    hits.truncate(k);
    hits
}

/// Anfrage-Vektoren der letzten [`QueryCache::CAPACITY`] Fragen (Auto-RAG fragt oft gleich).
/// Schlüssel: getrimmte, kleine Frage plus Herkunft; der älteste Eintrag fällt zuerst.
#[derive(Debug, Default)]
pub struct QueryCache {
    entries: Vec<(String, Vec<f32>)>,
}

impl QueryCache {
    pub const CAPACITY: usize = 20;

    /// Vektor aus dem Cache oder frisch eingebettet.
    pub fn vector(&mut self, embedder: &dyn Embedder, query: &str) -> Result<Vec<f32>, EmbedError> {
        let id = embedder.identity();
        let key = format!("{}::{}::{}", lower(query.trim()), id.provider_id, id.model);
        if let Some((_, v)) = self.entries.iter().find(|(k, _)| *k == key) {
            return Ok(v.clone());
        }
        let v = embedder.embed(&[query])?.into_iter().next().ok_or(EmbedError::Incomplete { expected: 1, got: 0 })?;
        self.entries.push((key, v.clone()));
        if self.entries.len() > Self::CAPACITY {
            self.entries.remove(0);
        }
        Ok(v)
    }
}

/// Abfrage-Ablauf wie `RAG.search`: Anfrage einbetten (gecacht) und ranken.
pub fn search(
    embedder: &dyn Embedder,
    cache: &mut QueryCache,
    index: &VectorIndex,
    pages: &HashMap<String, PageMeta>,
    query: &str,
    k: usize,
) -> Result<Vec<RagHit>, EmbedError> {
    let qv = cache.vector(embedder, query)?;
    Ok(rank_rag(index, pages, query, &qv, k))
}
