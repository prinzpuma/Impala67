//! Semantische Suche (RAG) für native Apps. Der Index liegt im Kern: Seiten und Heft-Text werden in
//! Abschnitte zerlegt (`impala-search`), die Plattform liefert die Vektoren über [`TextEmbedder`]
//! (z. B. ONNX Runtime Mobile) oder eine Cloud-Quelle aus den Einstellungen. Gespeichert werden sie
//! wie in der PWA im Store `vecs` der Datenbank (`{ updated, model, providerId, chunks: [{ text, vec,
//! norm }] }`): Beim Start rechnet nichts neu, und `update` bettet nur geänderte Seiten ein; Abschnitte
//! mit unverändertem Text behalten ihren Vektor.
//!
//! Das Einbetten läuft ohne Sperre auf den Daten: die App ruft `update`/`search` aus einem
//! Hintergrund-Thread (blockierend).

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use impala_ai::{EmbedRoute, Provider, embed_provider, embed_remote, embed_route};
use impala_net::{HttpClient, UreqClient, block_on};
use impala_search::store::{EMBEDDING_BATCH_SIZE, GRAPH_CARD_PREFIX};
use impala_search::{
    EmbedError, Embedder, HeftPageText, IndexSource, PageMeta, QueryCache, ReindexPlan, VecEntry, VecRecord,
    VectorIndex, chunk, index_text, inline_file_ids, needs_reindex, vector_model_key,
};
use impala_storage::{Blob, Storage, Write};
use serde_json::{Value, json};

use crate::ai::{ai_providers, setting_text};
use crate::{ImpalaCore, Inner, Shared, lock};

/// Fehler der semantischen Suche.
#[derive(Debug, uniffi::Error)]
pub enum SearchFailure {
    /// Das Einbetten ist gescheitert (Modell, Netz, unvollständige Antwort).
    Embedding {
        reason: String,
    },
    Storage {
        reason: String,
    },
}

impl std::fmt::Display for SearchFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            SearchFailure::Embedding { reason: message } | SearchFailure::Storage { reason: message } => f.write_str(message),
        }
    }
}

impl std::error::Error for SearchFailure {}

fn storage_err(e: impl std::fmt::Display) -> SearchFailure {
    SearchFailure::Storage { reason: e.to_string() }
}

fn embed_err(e: impl std::fmt::Display) -> SearchFailure {
    SearchFailure::Embedding { reason: e.to_string() }
}

/// Fehler im Rückruf der Plattform.
#[derive(Debug, uniffi::Error)]
pub enum EmbedFailure {
    Failed { reason: String },
}

impl std::fmt::Display for EmbedFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        let EmbedFailure::Failed { reason: message } = self;
        f.write_str(message)
    }
}

impl std::error::Error for EmbedFailure {}

impl From<uniffi::UnexpectedUniFFICallbackError> for EmbedFailure {
    fn from(e: uniffi::UnexpectedUniFFICallbackError) -> Self {
        EmbedFailure::Failed { reason: e.reason }
    }
}

/// Texte zu Vektoren: von der Plattform geliefert (ONNX Runtime Mobile, Core ML …). Wird vom
/// Hintergrund-Thread der Suche aufgerufen; kleine Stapel (höchstens 4 Texte).
#[uniffi::export(with_foreign)]
pub trait TextEmbedder: Send + Sync {
    /// Kennung der Vektoren (Modell + Stand), z. B. `embedding_model_key("local:bekko-a8m")`. Nur
    /// Vektoren gleicher Kennung und Quelle sind vergleichbar; ändert sie sich, wird neu indexiert.
    fn model_key(&self) -> String;
    /// Quelle der Vektoren, z. B. `local`.
    fn provider_id(&self) -> String;
    /// Ein normierter Vektor je Text, in derselben Reihenfolge. Anfragen und Abschnitte ohne Präfix.
    fn embed(&self, texts: Vec<String>) -> Result<Vec<Vec<f32>>, EmbedFailure>;
}

/// Kennung für gespeicherte Vektoren des Modells (`vectorModelKey` der PWA, z. B. `…#r2`).
#[uniffi::export]
pub fn embedding_model_key(model: String) -> String {
    vector_model_key(&model)
}

struct PlatformEmbedder {
    inner: Arc<dyn TextEmbedder>,
    model: String,
    provider: String,
}

impl Embedder for PlatformEmbedder {
    fn model_key(&self) -> &str {
        &self.model
    }
    fn provider_id(&self) -> &str {
        &self.provider
    }
    fn dim(&self) -> usize {
        0
    }
    fn embed(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>, EmbedError> {
        self.inner
            .embed(texts.iter().map(|t| (*t).to_owned()).collect())
            .map_err(|e| EmbedError::Inference(e.to_string()))
    }
}

/// Embeddings über `POST /embeddings` einer Cloud-Quelle (Einstellungen `embedModel`/`embedProviderId`).
struct CloudEmbedder<H> {
    http: H,
    provider: Provider,
    model: String,
    key: String,
    provider_id: String,
    dim: AtomicUsize,
}

impl<H: HttpClient> Embedder for CloudEmbedder<H> {
    fn model_key(&self) -> &str {
        &self.key
    }
    fn provider_id(&self) -> &str {
        &self.provider_id
    }
    fn dim(&self) -> usize {
        self.dim.load(Ordering::Relaxed)
    }
    fn embed(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>, EmbedError> {
        let texts: Vec<String> = texts.iter().map(|t| (*t).to_owned()).collect();
        let vectors = block_on(embed_remote(&self.http, &self.provider, &self.model, &texts))
            .map_err(|e| EmbedError::Inference(e.to_string()))?;
        if let Some(v) = vectors.first() {
            self.dim.store(v.len(), Ordering::Relaxed);
        }
        Ok(vectors)
    }
}

/// Trefferliste der semantischen Suche (Werte auf drei Stellen gerundet).
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct SemanticHit {
    pub page_id: String,
    pub title: String,
    pub snippet: String,
    /// Gesamtwertung 0…1 (Mischung aus Bedeutung und Wortübereinstimmung).
    pub score: f64,
    pub semantic_score: f64,
    pub lexical_score: f64,
    pub archived: bool,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct RelatedPage {
    pub page_id: String,
    pub score: f32,
}

/// Ergebnis von [`SemanticSearch::update`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct IndexReport {
    /// Neu geschriebene Seiten.
    pub indexed: u32,
    /// Davon wirklich neu eingebettete Abschnitte (der Rest kam aus dem Speicher).
    pub embedded_chunks: u32,
    /// Entfernte Einträge (gelöschte Seiten, Seiten ohne Text).
    pub removed: u32,
    /// Noch veraltete Seiten (bei begrenztem Lauf).
    pub remaining: u32,
}

struct Cache {
    /// Index aller Vektoren; `None` = nach Änderungen neu aufzubauen.
    index: Option<VectorIndex>,
    queries: QueryCache,
}

/// Semantischer Index und Suche über die Seiten von [`ImpalaCore`]. Alle Methoden blockieren
/// (Netz bzw. Modell): aus einem Hintergrund-Thread rufen.
#[derive(uniffi::Object)]
pub struct SemanticSearch {
    core: Shared,
    embedder: Box<dyn Embedder + Send + Sync>,
    cache: Mutex<Cache>,
    /// Ein Indexlauf zur Zeit.
    run: Mutex<()>,
}

enum Outcome {
    Indexed(u32),
    Removed,
    Unchanged,
}

fn pdf_text(inner: &Inner, file_id: &str) -> Option<String> {
    let blob = inner.storage.blob(&format!("pdftext:{file_id}")).ok()??;
    Some(String::from_utf8_lossy(&blob.bytes).into_owned())
}

/// Gesamttext einer Seite (Titel, Inhalt, PDF-Volltexte, Handschrift) und ihr Stand.
fn source_of(inner: &Inner, id: &str) -> Option<(String, String)> {
    let state = inner.model.state();
    let pg = state.pages.get(id).filter(|p| !p.is_trashed())?;
    let pdf_id = match pg.get("pdfId") {
        Some(Value::String(s)) if !s.is_empty() => Some(s),
        _ => None,
    };
    let inline: Vec<String> =
        inline_file_ids(pg.content(), pdf_id.as_deref()).iter().filter_map(|f| pdf_text(inner, f)).collect();
    let heft_pages: Vec<HeftPageText> = state
        .hefte
        .get(id)
        .map(|d| {
            d.pages
                .iter()
                .map(|p| HeftPageText {
                    texts: p.texts.iter().filter_map(|t| t.text.clone()).collect(),
                    ocr_text: Some(p.ocr_text.clone()).filter(|t| !t.is_empty()),
                })
                .collect()
        })
        .unwrap_or_default();
    let text = index_text(&IndexSource {
        title: pg.title().to_owned(),
        content: pg.content().to_owned(),
        pdf_text: pdf_id.and_then(|f| pdf_text(inner, &f)),
        inline_pdf_texts: inline,
        heft_pages,
        heft_meta_ocr: None,
    });
    Some((text, stamp_of(inner, id)))
}

/// Stand einer Seite für die Veraltet-Prüfung: bei Heften der Zeitpunkt des letzten Heft-Events.
fn stamp_of(inner: &Inner, id: &str) -> String {
    let Some(pg) = inner.model.state().pages.get(id) else { return String::new() };
    if pg.is_heft()
        && let Some(meta) = inner.model.heft_meta(id)
        && !meta.updated.is_empty()
    {
        return meta.updated;
    }
    pg.updated().to_owned()
}

fn record_of(v: &Value) -> Option<VecRecord> {
    match serde_json::from_value::<VecEntry>(v.clone()).ok()? {
        VecEntry::Page(r) => Some(r),
        VecEntry::Card(_) => None,
    }
}

/// Eintrag ohne Vektoren, nur zur Veraltet-Prüfung.
fn header_of(v: &Value) -> VecRecord {
    let text = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_owned);
    VecRecord { updated: text("updated"), model: text("model"), provider_id: text("providerId"), chunks: vec![] }
}

impl SemanticSearch {
    pub(crate) fn start(core: &ImpalaCore, embedder: Box<dyn Embedder + Send + Sync>) -> Arc<Self> {
        Arc::new(SemanticSearch {
            core: core.shared(),
            embedder,
            cache: Mutex::new(Cache { index: None, queries: QueryCache::default() }),
            run: Mutex::new(()),
        })
    }

    fn cloud<H: HttpClient + Send + Sync + 'static>(core: &ImpalaCore, http: H) -> Result<Arc<Self>, SearchFailure> {
        let shared = core.shared();
        let inner = lock(&shared);
        let (model, provider_id) = (setting_text(&inner, "embedModel"), setting_text(&inner, "embedProviderId"));
        let route = embed_route(&provider_id, &model).map_err(embed_err)?;
        if route == EmbedRoute::Local {
            return Err(embed_err("Lokales Modell: die Plattform muss einen TextEmbedder liefern."));
        }
        let providers = ai_providers(&inner);
        let active = setting_text(&inner, "aiProviderId");
        let provider = embed_provider(&providers, &provider_id, &active)
            .cloned()
            .ok_or_else(|| embed_err("Keine Quelle für Embeddings konfiguriert."))?;
        drop(inner);
        let embedder = CloudEmbedder {
            key: vector_model_key(&model),
            http,
            provider,
            model,
            provider_id,
            dim: AtomicUsize::new(0),
        };
        Ok(SemanticSearch::start(core, Box::new(embedder)))
    }

    /// Wie [`SemanticSearch::with_cloud_embeddings`] mit eigenem HTTP-Client (Tests).
    #[cfg(test)]
    pub(crate) fn with_http<H: HttpClient + Send + Sync + 'static>(
        core: &ImpalaCore,
        http: H,
    ) -> Result<Arc<Self>, SearchFailure> {
        Self::cloud(core, http)
    }

    fn mark_dirty(&self) {
        self.cache.lock().unwrap_or_else(|e| e.into_inner()).index = None;
    }

    /// Seite einlesen → einbetten (ohne Sperre) → speichern, wenn sie sich nicht inzwischen änderte.
    fn index_one(&self, id: &str) -> Result<Outcome, SearchFailure> {
        let ident = self.embedder.identity();
        let (source, previous) = {
            let inner = lock(&self.core);
            let previous = inner.storage.vec(id).map_err(storage_err)?;
            (source_of(&inner, id), previous)
        };
        let chunks = source.as_ref().map(|(text, _)| chunk(text)).unwrap_or_default();
        let Some((_, stamp)) = source.filter(|_| !chunks.is_empty()) else {
            if previous.is_none() {
                return Ok(Outcome::Unchanged);
            }
            lock(&self.core).storage.apply(vec![Write::DeleteVec(id.to_owned())]).map_err(storage_err)?;
            self.mark_dirty();
            return Ok(Outcome::Removed);
        };
        let previous = previous.as_ref().and_then(record_of);
        let mut plan = ReindexPlan::new(chunks, previous.as_ref(), &ident);
        let missing = plan.missing();
        for batch in missing.chunks(EMBEDDING_BATCH_SIZE) {
            let texts: Vec<&str> = batch.iter().map(|&i| plan.chunks[i].as_str()).collect();
            let vectors = self.embedder.embed(&texts).map_err(embed_err)?;
            plan.fill(batch, vectors).map_err(embed_err)?;
        }
        let record = plan.finish(&stamp, &ident).map_err(embed_err)?.ok_or_else(|| embed_err("Kein Text."))?;
        // Kompakte Zahlen (kürzeste f32-Schreibweise) statt der langen f64-Form von `to_value`.
        let value: Value =
            serde_json::from_str(&serde_json::to_string(&record).map_err(storage_err)?).map_err(storage_err)?;
        let mut inner = lock(&self.core);
        if stamp_of(&inner, id) != stamp {
            return Ok(Outcome::Unchanged); // inzwischen geändert: der nächste Lauf holt es nach
        }
        inner.storage.apply(vec![Write::PutVec(id.to_owned(), value)]).map_err(storage_err)?;
        drop(inner);
        self.mark_dirty();
        Ok(Outcome::Indexed(missing.len() as u32))
    }

    /// Veraltete Seiten und Einträge ohne Seite.
    fn plan(&self) -> Result<(Vec<String>, Vec<String>), SearchFailure> {
        let ident = self.embedder.identity();
        let inner = lock(&self.core);
        let stored: HashMap<String, Value> = inner.storage.vecs().map_err(storage_err)?.into_iter().collect();
        let state = inner.model.state();
        let mut stale = Vec::new();
        for pg in state.pages.values().filter(|p| !p.is_trashed()) {
            let rec = stored.get(pg.id()).map(header_of);
            if needs_reindex(&stamp_of(&inner, pg.id()), rec.as_ref(), &ident) {
                stale.push(pg.id().to_owned());
            }
        }
        let orphans = stored
            .keys()
            .filter(|k| {
                !k.starts_with(GRAPH_CARD_PREFIX) && !state.pages.get(k.as_str()).is_some_and(|p| !p.is_trashed())
            })
            .cloned()
            .collect();
        Ok((stale, orphans))
    }

    fn page_meta(&self) -> HashMap<String, PageMeta> {
        let inner = lock(&self.core);
        let state = inner.model.state();
        state
            .pages
            .iter()
            .map(|(id, p)| {
                let meta = PageMeta {
                    title: p.title().to_owned(),
                    trashed: p.is_trashed(),
                    archived: state.is_page_archived(id),
                };
                (id.clone(), meta)
            })
            .collect()
    }

    fn built_index<'a>(&self, cache: &'a mut Cache) -> Result<&'a VectorIndex, SearchFailure> {
        if cache.index.is_none() {
            let stored = lock(&self.core).storage.vecs().map_err(storage_err)?;
            let records: Vec<(String, VecRecord)> = stored
                .iter()
                .filter(|(k, _)| !k.starts_with(GRAPH_CARD_PREFIX))
                .filter_map(|(k, v)| Some((k.clone(), record_of(v)?)))
                .collect();
            let ident = self.embedder.identity();
            cache.index = Some(VectorIndex::build(records.iter().map(|(k, r)| (k.as_str(), r)), &ident));
        }
        cache.index.as_ref().ok_or_else(|| storage_err("Index fehlt."))
    }
}

#[uniffi::export]
impl SemanticSearch {
    /// Index mit Vektoren von der Plattform.
    #[uniffi::constructor]
    pub fn new(core: Arc<ImpalaCore>, embedder: Arc<dyn TextEmbedder>) -> Arc<Self> {
        let (model, provider) = (embedder.model_key(), embedder.provider_id());
        SemanticSearch::start(&core, Box::new(PlatformEmbedder { inner: embedder, model, provider }))
    }

    /// Index mit Vektoren einer Cloud-Quelle laut Einstellungen (`embedModel`, `embedProviderId`,
    /// `aiProviders` mit Schlüssel). Für lokale Modelle (`local:…`) stattdessen [`SemanticSearch::new`].
    #[uniffi::constructor]
    pub fn with_cloud_embeddings(core: Arc<ImpalaCore>) -> Result<Arc<Self>, SearchFailure> {
        SemanticSearch::cloud(&core, UreqClient::default())
    }

    /// Wie viele Seiten sind neu oder geändert (und damit für `update` offen)?
    pub fn pending_pages(&self) -> Result<u32, SearchFailure> {
        let (stale, orphans) = self.plan()?;
        Ok((stale.len() + orphans.len()) as u32)
    }

    /// Index nachführen: geänderte und neue Seiten einbetten, Einträge gelöschter Seiten entfernen.
    /// `max_pages` > 0 begrenzt den Lauf (Rest: `remaining`); 0 = alles. Ein Lauf zur Zeit.
    pub fn update(&self, max_pages: u32) -> Result<IndexReport, SearchFailure> {
        let _run = self.run.lock().unwrap_or_else(|e| e.into_inner());
        let (stale, orphans) = self.plan()?;
        let mut report = IndexReport { indexed: 0, embedded_chunks: 0, removed: 0, remaining: 0 };
        if !orphans.is_empty() {
            let writes = orphans.iter().map(|k| Write::DeleteVec(k.clone())).collect();
            lock(&self.core).storage.apply(writes).map_err(storage_err)?;
            report.removed += orphans.len() as u32;
            self.mark_dirty();
        }
        let limit = if max_pages == 0 { stale.len() } else { max_pages as usize };
        for id in stale.iter().take(limit) {
            match self.index_one(id)? {
                Outcome::Indexed(n) => {
                    report.indexed += 1;
                    report.embedded_chunks += n;
                }
                Outcome::Removed => report.removed += 1,
                Outcome::Unchanged => {}
            }
        }
        report.remaining = stale.len().saturating_sub(limit) as u32;
        Ok(report)
    }

    /// Eine Seite sofort neu indexieren (z. B. nach `store_pdf_text`). `true`, wenn geschrieben.
    pub fn index_page(&self, page_id: String) -> Result<bool, SearchFailure> {
        let _run = self.run.lock().unwrap_or_else(|e| e.into_inner());
        Ok(matches!(self.index_one(&page_id)?, Outcome::Indexed(_)))
    }

    /// Volltext einer PDF (Datei-ID `file:…`) speichern; er fließt beim nächsten Indexieren der Seite ein.
    pub fn store_pdf_text(&self, file_id: String, text: String) -> Result<(), SearchFailure> {
        let blob = Blob { bytes: text.into_bytes(), meta: Some(json!({ "type": "text/plain" })) };
        lock(&self.core)
            .storage
            .apply(vec![Write::PutBlob(format!("pdftext:{file_id}"), blob)])
            .map(drop)
            .map_err(storage_err)
    }

    /// Semantische Suche wie `RAG.search` der PWA (Bedeutung + Wörter, höchstens zwei Abschnitte je Seite).
    pub fn search(&self, query: String, k: u32) -> Result<Vec<SemanticHit>, SearchFailure> {
        if query.trim().is_empty() {
            return Ok(Vec::new());
        }
        let pages = self.page_meta();
        let mut guard = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        let cache = &mut *guard;
        self.built_index(cache)?;
        let index = cache.index.as_ref().ok_or_else(|| storage_err("Index fehlt."))?;
        let hits = impala_search::search(&*self.embedder, &mut cache.queries, index, &pages, &query, k as usize)
            .map_err(embed_err)?;
        Ok(hits
            .into_iter()
            .map(|h| SemanticHit {
                page_id: h.page_id,
                title: h.title,
                snippet: h.snippet,
                score: h.score,
                semantic_score: h.semantic_score,
                lexical_score: h.lexical_score,
                archived: h.archived,
            })
            .collect())
    }

    /// Inhaltlich ähnliche Seiten (ohne Papierkorb/Archiv, ab Ähnlichkeit 0,5).
    pub fn related_pages(&self, page_id: String, k: u32) -> Result<Vec<RelatedPage>, SearchFailure> {
        let pages = self.page_meta();
        let mut guard = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        let index = self.built_index(&mut guard)?;
        Ok(impala_search::related(index, &pages, &page_id, k as usize)
            .into_iter()
            .map(|h| RelatedPage { page_id: h.page_id, score: h.score })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicUsize;

    use super::*;

    /// Wortsack-Embedder: eine Dimension je Schlüsselwort.
    pub(crate) struct Bag {
        pub words: Vec<&'static str>,
        pub calls: AtomicUsize,
    }

    impl Bag {
        pub fn new() -> Arc<Bag> {
            Arc::new(Bag { words: vec!["katze", "integral", "hund", "wetter"], calls: AtomicUsize::new(0) })
        }
    }

    impl TextEmbedder for Bag {
        fn model_key(&self) -> String {
            "test-bag".into()
        }
        fn provider_id(&self) -> String {
            "test".into()
        }
        fn embed(&self, texts: Vec<String>) -> Result<Vec<Vec<f32>>, EmbedFailure> {
            self.calls.fetch_add(texts.len(), Ordering::Relaxed);
            Ok(texts
                .iter()
                .map(|t| {
                    let lower = t.to_lowercase();
                    let mut v: Vec<f32> = self.words.iter().map(|w| lower.matches(w).count() as f32).collect();
                    v.push(0.01);
                    v
                })
                .collect())
        }
    }

    #[test]
    fn index_nachfuehren_und_suchen() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let katze = core
            .create_page("Haustiere".into(), "Die Katze schläft. Eine Katze jagt Mäuse.".into(), None, None)
            .unwrap();
        let mathe = core
            .create_page("Analysis".into(), "Das Integral einer Funktion ist die Fläche.".into(), None, None)
            .unwrap();
        let bag = Bag::new();
        let search = SemanticSearch::new(core.clone(), bag.clone());

        assert_eq!(search.pending_pages().unwrap(), 2);
        let r = search.update(0).unwrap();
        assert_eq!((r.indexed, r.remaining), (2, 0));
        assert_eq!(search.pending_pages().unwrap(), 0);

        let hits = search.search("Wie groß ist das Integral?".into(), 3).unwrap();
        assert_eq!(hits[0].page_id, mathe);
        let hits = search.search("katze".into(), 3).unwrap();
        assert_eq!(hits[0].page_id, katze);

        // Nur geänderte Seiten werden neu eingebettet; unveränderte Abschnitte behalten den Vektor.
        let calls = bag.calls.load(Ordering::Relaxed);
        core.update_page(
            katze.clone(),
            None,
            Some("Die Katze schläft. Eine Katze jagt Mäuse.\n\nDer Hund bellt.".into()),
        )
        .unwrap();
        assert_eq!(search.pending_pages().unwrap(), 1);
        let r = search.update(0).unwrap();
        assert_eq!(r.indexed, 1);
        assert!(bag.calls.load(Ordering::Relaxed) > calls);
        assert_eq!(search.search("hund".into(), 3).unwrap()[0].page_id, katze);

        // Gelöschte Seiten fallen aus dem Index; ein Neustart (neues Objekt) rechnet nichts neu.
        core.trash_page(mathe).unwrap();
        let r = search.update(0).unwrap();
        assert_eq!(r.removed, 1);
        assert!(search.search("integral".into(), 3).unwrap().iter().all(|h| h.title != "Analysis"));
        let again = SemanticSearch::new(core, bag.clone());
        let calls = bag.calls.load(Ordering::Relaxed);
        assert_eq!(again.update(0).unwrap().indexed, 0);
        assert_eq!(bag.calls.load(Ordering::Relaxed), calls);
        assert_eq!(again.search("katze".into(), 3).unwrap()[0].title, "Haustiere");
    }

    /// Falscher Embedding-Server (`POST /embeddings`) mit denselben Wortsack-Vektoren.
    struct Cloud;

    impl HttpClient for Cloud {
        async fn send(&self, req: &impala_net::Request) -> Result<impala_net::Response, impala_net::NetError> {
            assert!(req.url.ends_with("/embeddings"), "{}", req.url);
            let body: Value = serde_json::from_slice(&req.body).unwrap();
            assert_eq!(body["model"], "text-embedding-test");
            let bag = Bag::new();
            let texts: Vec<String> =
                body["input"].as_array().unwrap().iter().map(|t| t.as_str().unwrap().to_owned()).collect();
            let data: Vec<Value> = bag
                .embed(texts)
                .unwrap()
                .into_iter()
                .enumerate()
                .map(|(i, v)| json!({ "index": i, "embedding": v }))
                .collect();
            Ok(impala_net::Response {
                status: 200,
                headers: vec![],
                body: json!({ "data": data }).to_string().into_bytes(),
            })
        }
    }

    #[test]
    fn cloud_embeddings_aus_den_einstellungen() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let settings = json!({
            "embedModel": "text-embedding-test", "embedProviderId": "cloud",
            "aiProviders": [{ "id": "cloud", "name": "Cloud", "base": "https://emb.test/v1", "key": "k" }],
        });
        // Ohne Modell: klare Fehlermeldung.
        assert!(matches!(SemanticSearch::with_http(&core, Cloud), Err(SearchFailure::Embedding { .. })));
        core.dispatch("settingsSet".into(), settings.to_string()).unwrap();
        let hund = core.create_page("Tiere".into(), "Der Hund bellt laut.".into(), None, None).unwrap();
        core.create_page("Wetter".into(), "Heute regnet es, das Wetter ist schlecht.".into(), None, None).unwrap();
        let search = SemanticSearch::with_http(&core, Cloud).unwrap();
        assert_eq!(search.update(0).unwrap().indexed, 2);
        assert_eq!(search.search("hund".into(), 1).unwrap()[0].page_id, hund);
    }

    #[test]
    fn heft_text_wird_indexiert() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let heft = core.create_heft("Skizzen".into(), None, None).unwrap();
        let bag = Bag::new();
        let search = SemanticSearch::new(core, bag);
        let r = search.update(0).unwrap();
        // Nur der Titel („Skizzen“) – trotzdem ein Eintrag.
        assert_eq!(r.indexed, 1);
        assert_eq!(search.search("skizzen".into(), 1).unwrap()[0].page_id, heft);
    }
}
