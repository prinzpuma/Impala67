//! Suche/RAG: Chunking, Vektorsuche, Ranking, Unscharf-Suche, Embedder.
//!
//! Neu geschrieben nach dem Verhalten von `web/rag.js`, `web/rag-ranking.js`, `web/embedding.js`,
//! `web/embedding-worker.js`, `web/search-fuzzy.js` und `searchNotes` (`web/state.js`).
//! Ohne Feature `onnx` reine Logik (baut für `wasm32-unknown-unknown`).

pub mod chunk;
pub mod embed;
pub mod fuzzy;
pub mod notes;
#[cfg(feature = "onnx")]
pub mod onnx;
pub mod palette;
pub mod rank;
pub mod store;
pub mod text;
pub mod vector;

pub use chunk::{HeftPageText, IndexSource, chunk, index_text, inline_file_ids};
pub use embed::{
    EmbedError, Embedder, EmbeddingIdentity, LOCAL_EMBED_MODEL_ID, LOCAL_EMBEDDING_MODELS, LocalModel, is_valid_vector,
    vector_model_key,
};
pub use fuzzy::{FuzzyHit, FuzzyIndex, fold, typo_distance};
pub use notes::{NoteDoc, NoteHit, NoteIndex};
pub use rank::{PageMeta, QueryCache, RagHit, RelatedHit, VectorIndex, rank_rag, related, search};
pub use store::{ChunkVec, IndexError, ReindexPlan, VecEntry, VecRecord, index_page, needs_reindex};
pub use vector::{Scored, VectorError, cosine, dot, norm, top_k};
