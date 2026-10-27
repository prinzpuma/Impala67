//! Embeddings: Modell-Liste und -Kennungen (wie `web/embedding.js`), die Fähigkeit
//! [`Embedder`] und die reine Nachbearbeitung des lokalen Modells (wie `web/embedding-worker.js`:
//! Mean-Pooling über die Maske, Matryoshka-Kürzung, L2-Normalisierung).
//!
//! Präfixe wie „query:“/„passage:“ gibt es bewusst nicht: Die App bettet Anfragen und Chunks
//! ohne Präfix ein, gespeicherte Vektoren bleiben nur so vergleichbar.

use crate::vector::normalized;

/// Beschreibung eines lokalen Embedding-Modells.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocalModel {
    /// Kennung in den Einstellungen (`embedModel`).
    pub id: &'static str,
    /// Hugging-Face-Repository der Modelldateien.
    pub hf_id: &'static str,
    pub name: &'static str,
    /// Länge der gespeicherten Vektoren (Matryoshka-Kürzung).
    pub dim: usize,
    pub size_mb: u32,
    /// Höchstzahl Token je Text.
    pub context: usize,
    pub provider_id: &'static str,
    pub provider_name: &'static str,
    pub recommended: bool,
}

pub const LOCAL_EMBED_MODEL_ID: &str = "local:bekko-a8m";

/// Einziges angebotenes lokales Modell (Bekko a8m).
pub const LOCAL_EMBEDDING_MODELS: &[LocalModel] = &[LocalModel {
    id: LOCAL_EMBED_MODEL_ID,
    hf_id: "hotchpotch/bekko-embedding-v1-a8m",
    name: "Bekko a8m (Lokal im Browser, 256d)",
    dim: 256,
    size_mb: 165,
    context: 8192,
    provider_id: "local",
    provider_name: "Lokal (Offline)",
    recommended: true,
}];

/// Stand der lokal erzeugten Vektoren; erhöht, wenn dasselbe Modell andere Vektoren liefert.
pub const LOCAL_EMBED_REVISION: u32 = 2;

/// Modell zur Kennung, sonst das Standardmodell (wie `resolveLocalModel`).
pub fn local_model(id: &str) -> &'static LocalModel {
    LOCAL_EMBEDDING_MODELS.iter().find(|m| m.id == id).unwrap_or(&LOCAL_EMBEDDING_MODELS[0])
}

/// Kennung, unter der Vektoren gespeichert und verglichen werden (`vectorModelKey`).
pub fn vector_model_key(model: &str) -> String {
    if model == LOCAL_EMBED_MODEL_ID { format!("{model}#r{LOCAL_EMBED_REVISION}") } else { model.to_owned() }
}

/// Nur vollständige, endliche Vektoren dürfen in den Index (`isValidVector`).
pub fn is_valid_vector(v: &[f32]) -> bool {
    !v.is_empty() && v.iter().all(|x| x.is_finite())
}

/// Woher Vektoren stammen: nur Vektoren gleicher Herkunft sind vergleichbar.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Default)]
pub struct EmbeddingIdentity {
    /// Modellkennung nach [`vector_model_key`].
    pub model: String,
    /// Quelle (`embedProviderId`), z. B. `local` oder die Id eines Remote-Anbieters.
    pub provider_id: String,
}

impl EmbeddingIdentity {
    /// Aus den Einstellungen `embedModel` und `embedProviderId`.
    pub fn from_settings(embed_model: &str, provider_id: &str) -> Self {
        Self { model: vector_model_key(embed_model), provider_id: provider_id.to_owned() }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EmbedError {
    /// Modelldateien fehlen oder sind unlesbar.
    Model(String),
    /// Tokenisierung oder Inferenz gescheitert.
    Inference(String),
    /// Antwort passt nicht zur Anfrage (Anzahl, Dimension, NaN).
    Incomplete { expected: usize, got: usize },
}

impl std::fmt::Display for EmbedError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Model(e) => write!(f, "Embedding-Modell nicht ladbar: {e}"),
            Self::Inference(e) => write!(f, "Embedding fehlgeschlagen: {e}"),
            Self::Incomplete { expected, got } => write!(f, "Embedding unvollständig ({got}/{expected})"),
        }
    }
}

impl std::error::Error for EmbedError {}

/// Texte → Vektoren. Standard: [`crate::onnx::OnnxEmbedder`] (Feature `onnx`); Plattformen
/// können eigene liefern (Core ML, Windows ML, Remote-API).
pub trait Embedder {
    /// Modellkennung nach [`vector_model_key`].
    fn model_key(&self) -> &str;
    /// Quelle der Vektoren (`local` für das eingebaute Modell).
    fn provider_id(&self) -> &str;
    /// Länge der gelieferten Vektoren.
    fn dim(&self) -> usize;
    /// Ein Vektor je Text, in derselben Reihenfolge.
    fn embed(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>, EmbedError>;

    fn identity(&self) -> EmbeddingIdentity {
        EmbeddingIdentity { model: self.model_key().to_owned(), provider_id: self.provider_id().to_owned() }
    }
}

/// Mittelwert der Token-Zustände über die Maske. `hidden` ist `[seq, width]` zeilenweise.
pub fn mean_pool(hidden: &[f32], width: usize, mask: &[i64]) -> Vec<f32> {
    let mut sum = vec![0f32; width];
    let mut count = 0f32;
    for (row, &m) in hidden.chunks_exact(width.max(1)).zip(mask) {
        if m == 0 {
            continue;
        }
        sum.iter_mut().zip(row).for_each(|(s, x)| *s += x);
        count += 1.0;
    }
    // Transformers.js teilt durch max(Summe der Maske, 1e-9)
    let count = count.max(1e-9);
    sum.iter_mut().for_each(|s| *s /= count);
    sum
}

/// Matryoshka-Kürzung auf `dim` (0 = ungekürzt) und L2-Normalisierung (`normalizeVec`).
pub fn finish_vector(pooled: &[f32], dim: usize) -> Vec<f32> {
    let cut = if dim > 0 && dim < pooled.len() { &pooled[..dim] } else { pooled };
    normalized(cut)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys() {
        assert_eq!(vector_model_key("local:bekko-a8m"), "local:bekko-a8m#r2");
        assert_eq!(vector_model_key("text-embedding-3-small"), "text-embedding-3-small");
        assert_eq!(local_model("x").dim, 256);
        assert!(is_valid_vector(&[0.0]) && !is_valid_vector(&[]) && !is_valid_vector(&[f32::NAN]));
    }

    #[test]
    fn pooling() {
        let hidden = [1.0, 2.0, 3.0, 4.0, 100.0, 100.0];
        assert_eq!(mean_pool(&hidden, 2, &[1, 1, 0]), vec![2.0, 3.0]);
        assert_eq!(mean_pool(&hidden, 2, &[0, 0, 0]), vec![0.0, 0.0]);
        let v = finish_vector(&[3.0, 4.0, 12.0], 2);
        assert!((v[0] - 0.6).abs() < 1e-6 && (v[1] - 0.8).abs() < 1e-6);
        assert_eq!(finish_vector(&[0.0, 0.0], 0), vec![0.0, 0.0]);
    }
}
