//! Einträge des IndexedDB-Stores `vecs` und ihre Pflege (wie `performIndexPage`/`reindexStale`
//! in `web/rag.js`).
//!
//! Format (Schlüssel = Seiten-Id, Wert per Structured Clone):
//! `{ updated, model, providerId, chunks: [{ text, vec, norm }] }` – `vec` ist ein `Float32Array`
//! (ältere Einträge: Zahlen-Array), `norm` der vorberechnete Betrag. Der Wissensgraph legt im
//! selben Store unter `graph-card:<Karten-Id>` Einträge `{ kind: "knowledge-card", model,
//! provider, hash, vec }` ab. Kein Base64: Die JS-Seite reicht `Float32Array`s direkt herein
//! ([`f32_from_le_bytes`] für deren Bytes); als JSON gelesen gilt ein Zahlen-Array, aber auch
//! die Objektform `{"0":…, "1":…}`, die `JSON.stringify` aus einem `Float32Array` macht.

use serde::{Deserialize, Deserializer, Serialize};

use crate::chunk::chunk;
use crate::embed::{EmbedError, Embedder, EmbeddingIdentity, is_valid_vector};
use crate::vector::norm;

/// Schlüssel-Präfix der Karten-Vektoren des Wissensgraphen.
pub const GRAPH_CARD_PREFIX: &str = "graph-card:";
/// Chunks je Embedding-Aufruf (kleine Batches halten den Speicher auf iPads klein).
pub const EMBEDDING_BATCH_SIZE: usize = 4;

/// Ein Chunk mit Vektor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChunkVec {
    #[serde(default)]
    pub text: String,
    #[serde(default, deserialize_with = "opt_vec")]
    pub vec: Option<Vec<f32>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub norm: Option<f64>,
}

impl ChunkVec {
    /// Gespeicherter Betrag, sonst berechnet (wie `c.norm || norm(c.vec)`).
    pub fn norm_or_compute(&self) -> f32 {
        match (self.norm, &self.vec) {
            (Some(n), _) if n > 0.0 && n.is_finite() => n as f32,
            (_, Some(v)) => norm(v),
            _ => 1.0,
        }
    }
}

/// Vektor-Eintrag einer Seite.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct VecRecord {
    /// `updated` der Seite beim Indexieren.
    #[serde(default)]
    pub updated: Option<String>,
    /// Modellkennung nach `vectorModelKey` (fehlt bei sehr alten Einträgen).
    #[serde(default)]
    pub model: Option<String>,
    #[serde(rename = "providerId", default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub chunks: Vec<ChunkVec>,
}

impl VecRecord {
    /// Für die Suche nutzbar: gleiches Modell, gleiche Quelle (fehlende Quelle zählt als leer).
    pub fn usable_for(&self, id: &EmbeddingIdentity) -> bool {
        self.model.as_deref() == Some(id.model.as_str()) && self.provider_id.as_deref().unwrap_or("") == id.provider_id
    }

    /// Vektoren wiederverwendbar: Modell und Quelle exakt gleich.
    fn reusable_for(&self, id: &EmbeddingIdentity) -> bool {
        self.model.as_deref() == Some(id.model.as_str()) && self.provider_id.as_deref() == Some(id.provider_id.as_str())
    }
}

/// Karten-Vektor des Wissensgraphen (`graph.js`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CardVecRecord {
    pub kind: CardKind,
    #[serde(default)]
    pub model: Option<String>,
    /// Hier heißt die Quelle `provider` (nicht `providerId`).
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub hash: Option<String>,
    #[serde(default, deserialize_with = "opt_vec")]
    pub vec: Option<Vec<f32>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CardKind {
    #[serde(rename = "knowledge-card")]
    KnowledgeCard,
}

/// Beliebiger Eintrag des Stores `vecs`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum VecEntry {
    Card(CardVecRecord),
    Page(VecRecord),
}

/// `Float32Array`-Bytes (Little Endian) als Vektor; `None` bei unvollständiger Länge.
pub fn f32_from_le_bytes(bytes: &[u8]) -> Option<Vec<f32>> {
    if !bytes.len().is_multiple_of(4) {
        return None;
    }
    Some(bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect())
}

/// Vektor aus Zahlen-Array oder Index-Objekt; `null`-Werte (JSON für NaN) werden NaN.
fn opt_vec<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Vec<f32>>, D::Error> {
    struct V;
    impl<'de> serde::de::Visitor<'de> for V {
        type Value = Option<Vec<f32>>;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("Zahlen-Array oder {\"0\": …}")
        }
        fn visit_none<E>(self) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_unit<E>(self) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_some<D: Deserializer<'de>>(self, d: D) -> Result<Self::Value, D::Error> {
            d.deserialize_any(self)
        }
        fn visit_seq<A: serde::de::SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
            let mut out = Vec::with_capacity(seq.size_hint().unwrap_or(0));
            while let Some(x) = seq.next_element::<Option<f64>>()? {
                out.push(x.map_or(f32::NAN, |x| x as f32));
            }
            Ok(Some(out))
        }
        fn visit_map<A: serde::de::MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
            let mut pairs = Vec::new();
            while let Some((k, x)) = map.next_entry::<String, Option<f64>>()? {
                let Ok(i) = k.parse::<usize>() else { continue };
                pairs.push((i, x.map_or(f32::NAN, |x| x as f32)));
            }
            pairs.sort_by_key(|p| p.0);
            // Lücken machen den Vektor ungültig statt ihn zu verschieben.
            if pairs.iter().enumerate().any(|(n, p)| p.0 != n) {
                return Ok(Some(vec![f32::NAN]));
            }
            Ok(Some(pairs.into_iter().map(|p| p.1).collect()))
        }
    }
    d.deserialize_option(V)
}

/// Muss die Seite (neu) indexiert werden? (`reindexStale`; vergleicht wie JS streng, auch
/// die Quelle – Alt-Einträge ohne `providerId` werden so einmal migriert.)
pub fn needs_reindex(page_updated: &str, record: Option<&VecRecord>, id: &EmbeddingIdentity) -> bool {
    match record {
        None => true,
        Some(r) => {
            r.updated.as_deref() != Some(page_updated)
                || r.model.as_deref() != Some(id.model.as_str())
                || r.provider_id.as_deref() != Some(id.provider_id.as_str())
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum IndexError {
    Embed(EmbedError),
    /// Embedding-Antwort unvollständig oder mit ungültigen Werten.
    Incomplete,
}

impl std::fmt::Display for IndexError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Embed(e) => e.fmt(f),
            Self::Incomplete => f.write_str("Embedding unvollständig"),
        }
    }
}

impl std::error::Error for IndexError {}

impl From<EmbedError> for IndexError {
    fn from(e: EmbedError) -> Self {
        Self::Embed(e)
    }
}

/// Neuindexierung einer Seite in Schritten: Chunks mit gleichem Text behalten ihren Vektor
/// aus dem alten Eintrag (gleicher Text + gleiches Modell = gleicher Vektor), nur die übrigen
/// werden eingebettet.
#[derive(Debug, Clone, PartialEq)]
pub struct ReindexPlan {
    pub chunks: Vec<String>,
    vecs: Vec<Option<Vec<f32>>>,
}

impl ReindexPlan {
    pub fn new(chunks: Vec<String>, previous: Option<&VecRecord>, id: &EmbeddingIdentity) -> Self {
        let mut reusable: std::collections::HashMap<&str, &Vec<f32>> = Default::default();
        if let Some(prev) = previous.filter(|p| p.reusable_for(id)) {
            for c in &prev.chunks {
                if let Some(v) = c.vec.as_ref().filter(|v| is_valid_vector(v)) {
                    reusable.insert(&c.text, v); // spätere gleiche Texte gewinnen (wie Map.set)
                }
            }
        }
        let vecs = chunks.iter().map(|t| reusable.get(t.as_str()).map(|v| (*v).clone())).collect();
        Self { chunks, vecs }
    }

    /// Indizes der Chunks, die noch einen Vektor brauchen.
    pub fn missing(&self) -> Vec<usize> {
        (0..self.vecs.len()).filter(|&i| self.vecs[i].is_none()).collect()
    }

    /// Vektoren für die Chunks `idx` eintragen (ganz oder gar nicht).
    pub fn fill(&mut self, idx: &[usize], vectors: Vec<Vec<f32>>) -> Result<(), IndexError> {
        if vectors.len() != idx.len()
            || idx.iter().any(|&i| i >= self.vecs.len())
            || !vectors.iter().all(|v| is_valid_vector(v))
        {
            return Err(IndexError::Incomplete);
        }
        for (&i, v) in idx.iter().zip(vectors) {
            self.vecs[i] = Some(v);
        }
        Ok(())
    }

    /// Fertiger Eintrag; `None`, wenn es nichts zu indexieren gibt (Eintrag löschen).
    pub fn finish(self, updated: &str, id: &EmbeddingIdentity) -> Result<Option<VecRecord>, IndexError> {
        if self.chunks.is_empty() {
            return Ok(None);
        }
        let chunks = self
            .chunks
            .into_iter()
            .zip(self.vecs)
            .map(|(text, vec)| {
                let vec = vec.ok_or(IndexError::Incomplete)?;
                Ok(ChunkVec { text, norm: Some(f64::from(norm(&vec))), vec: Some(vec) })
            })
            .collect::<Result<_, IndexError>>()?;
        Ok(Some(VecRecord {
            updated: Some(updated.to_owned()),
            model: Some(id.model.clone()),
            provider_id: Some(id.provider_id.clone()),
            chunks,
        }))
    }
}

/// Ganze Seite indexieren: Chunking, Wiederverwendung, Einbetten in Batches.
/// `Ok(None)`: nichts zu indexieren, der alte Eintrag ist zu löschen.
pub fn index_page(
    embedder: &dyn Embedder,
    text: &str,
    updated: &str,
    previous: Option<&VecRecord>,
) -> Result<Option<VecRecord>, IndexError> {
    let id = embedder.identity();
    let mut plan = ReindexPlan::new(chunk(text), previous, &id);
    for batch in plan.missing().chunks(EMBEDDING_BATCH_SIZE) {
        let texts: Vec<&str> = batch.iter().map(|&i| plan.chunks[i].as_str()).collect();
        let vectors = embedder.embed(&texts)?;
        plan.fill(batch, vectors)?;
    }
    plan.finish(updated, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id() -> EmbeddingIdentity {
        EmbeddingIdentity::from_settings("local:bekko-a8m", "local")
    }

    #[test]
    fn reads_js_shapes() {
        let page: VecEntry = serde_json::from_str(
            r#"{"updated":"t","model":"m","chunks":[{"text":"a","vec":{"1":2,"0":1},"norm":2.2},{"text":"b","vec":[1,null]},{"text":"c"}]}"#,
        )
        .unwrap();
        let VecEntry::Page(p) = page else { panic!("Seite erwartet") };
        assert_eq!(p.chunks[0].vec, Some(vec![1.0, 2.0]));
        assert!(p.chunks[1].vec.as_ref().unwrap()[1].is_nan());
        assert_eq!(p.chunks[2].vec, None);
        assert_eq!(p.provider_id, None);
        let card: VecEntry =
            serde_json::from_str(r#"{"kind":"knowledge-card","model":"m","provider":"local","hash":"x1","vec":[0.5]}"#)
                .unwrap();
        assert!(matches!(card, VecEntry::Card(CardVecRecord { vec: Some(_), .. })));
        assert_eq!(f32_from_le_bytes(&1.5f32.to_le_bytes()), Some(vec![1.5]));
        assert_eq!(f32_from_le_bytes(&[0, 0, 0]), None);
    }

    #[test]
    fn stale_detection() {
        let mut r = VecRecord {
            updated: Some("t1".into()),
            model: Some("local:bekko-a8m#r2".into()),
            provider_id: Some("local".into()),
            chunks: vec![],
        };
        assert!(!needs_reindex("t1", Some(&r), &id()));
        assert!(needs_reindex("t2", Some(&r), &id()));
        assert!(needs_reindex("t1", None, &id()));
        r.provider_id = None;
        assert!(needs_reindex("t1", Some(&r), &id()));
        assert!(r.usable_for(&EmbeddingIdentity { model: "local:bekko-a8m#r2".into(), provider_id: "".into() }));
    }

    #[test]
    fn plan_reuses_and_validates() {
        let prev = VecRecord {
            updated: None,
            model: Some(id().model),
            provider_id: Some("local".into()),
            chunks: vec![ChunkVec { text: "a".into(), vec: Some(vec![1.0]), norm: None }],
        };
        let mut plan = ReindexPlan::new(vec!["a".into(), "b".into()], Some(&prev), &id());
        assert_eq!(plan.missing(), vec![1]);
        assert_eq!(plan.fill(&[1], vec![vec![f32::NAN]]), Err(IndexError::Incomplete));
        assert_eq!(plan.clone().finish("t", &id()), Err(IndexError::Incomplete));
        plan.fill(&[1], vec![vec![3.0, 4.0]]).unwrap();
        let rec = plan.finish("t", &id()).unwrap().unwrap();
        assert_eq!(rec.chunks[1].norm, Some(5.0));
        assert_eq!(ReindexPlan::new(vec![], None, &id()).finish("t", &id()), Ok(None));
    }
}
