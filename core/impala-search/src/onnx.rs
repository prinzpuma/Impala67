//! Standard-[`Embedder`]: das lokale Modell des Embedding-Workers (Bekko a8m) in reinem Rust –
//! ONNX über `tract`, Tokenisierung über `tokenizers`. Gleiche Nachbearbeitung wie im Browser
//! (Mean-Pooling über die Maske, Kürzung auf `dim`, L2-Normalisierung), damit Vektoren mit den
//! gespeicherten aus der PWA vergleichbar bleiben.
//!
//! Modelldateien (nicht im Repo) liegen wie bei Hugging Face in einem Verzeichnis:
//! `tokenizer.json` und `onnx/model.onnx` (Download: `https://huggingface.co/<hf_id>`).

use std::path::Path;

use tokenizers::{PaddingParams, Tokenizer, TruncationParams};
use tract_onnx::prelude::*;

use crate::embed::{EmbedError, Embedder, LocalModel, finish_vector, mean_pool, vector_model_key};

type Plan = std::sync::Arc<TypedRunnableModel>;

/// Eingänge, die das Modell erwartet (in Modell-Reihenfolge).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Input {
    Ids,
    Mask,
    TokenTypes,
}

pub struct OnnxEmbedder {
    tokenizer: Tokenizer,
    plan: Plan,
    inputs: Vec<Input>,
    model_key: String,
    provider_id: String,
    dim: usize,
}

fn model_err(e: impl std::fmt::Display) -> EmbedError {
    EmbedError::Model(e.to_string())
}

fn infer_err(e: impl std::fmt::Display) -> EmbedError {
    EmbedError::Inference(e.to_string())
}

impl OnnxEmbedder {
    /// Lädt Tokenizer und Modell aus `dir` (siehe Modul-Doku).
    pub fn load(dir: &Path, def: &LocalModel) -> Result<Self, EmbedError> {
        let mut tokenizer = Tokenizer::from_file(dir.join("tokenizer.json")).map_err(model_err)?;
        tokenizer
            .with_truncation(Some(TruncationParams { max_length: def.context, ..Default::default() }))
            .map_err(model_err)?;
        tokenizer.with_padding(Some(PaddingParams::default())); // auf die längste Eingabe

        let mut model = tract_onnx::onnx().model_for_path(dir.join("onnx").join("model.onnx")).map_err(model_err)?;
        let mut inputs = Vec::new();
        for outlet in model.input_outlets().map_err(model_err)?.to_vec() {
            let name = model.node(outlet.node).name.as_str();
            inputs.push(match name {
                "input_ids" => Input::Ids,
                "attention_mask" => Input::Mask,
                "token_type_ids" => Input::TokenTypes,
                other => return Err(EmbedError::Model(format!("unbekannter Modell-Eingang {other}"))),
            });
        }
        let batch = model.symbols.sym("B");
        let seq = model.symbols.sym("S");
        for i in 0..inputs.len() {
            model.set_input_fact(i, i64::fact([batch.to_dim(), seq.to_dim()]).into()).map_err(model_err)?;
        }
        let plan = model.into_optimized().map_err(model_err)?.into_runnable().map_err(model_err)?;
        Ok(Self {
            tokenizer,
            plan,
            inputs,
            model_key: vector_model_key(def.id),
            provider_id: def.provider_id.to_owned(),
            dim: def.dim,
        })
    }
}

impl Embedder for OnnxEmbedder {
    fn model_key(&self) -> &str {
        &self.model_key
    }

    fn provider_id(&self) -> &str {
        &self.provider_id
    }

    fn dim(&self) -> usize {
        self.dim
    }

    fn embed(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>, EmbedError> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let enc = self.tokenizer.encode_batch(texts.to_vec(), true).map_err(infer_err)?;
        let (b, s) = (enc.len(), enc.iter().map(|e| e.get_ids().len()).max().unwrap_or(0));
        let column = |f: &dyn Fn(&tokenizers::Encoding) -> Vec<i64>| -> Vec<i64> { enc.iter().flat_map(f).collect() };
        let ids = column(&|e| e.get_ids().iter().map(|&x| i64::from(x)).collect());
        let mask = column(&|e| e.get_attention_mask().iter().map(|&x| i64::from(x)).collect());
        let tensor = |data: &[i64]| Tensor::from_shape(&[b, s], data).map_err(infer_err);
        let feed: TVec<TValue> = self
            .inputs
            .iter()
            .map(|i| {
                Ok(match i {
                    Input::Ids => tensor(&ids)?,
                    Input::Mask => tensor(&mask)?,
                    Input::TokenTypes => tensor(&vec![0; b * s])?,
                }
                .into())
            })
            .collect::<Result<_, EmbedError>>()?;
        let out = self.plan.run(feed).map_err(infer_err)?;
        // Erster Ausgang mit Form [B, S, H] (last_hidden_state).
        let hidden = out
            .iter()
            .find(|t| t.rank() == 3)
            .ok_or_else(|| EmbedError::Inference("kein Ausgang der Form [B, S, H]".into()))?;
        let view = hidden.to_plain_array_view::<f32>().map_err(infer_err)?;
        let width = view.shape()[2];
        let flat: Vec<f32> = view.iter().copied().collect();
        let vectors: Vec<Vec<f32>> = (0..b)
            .map(|i| {
                let rows = &flat[i * s * width..(i + 1) * s * width];
                finish_vector(&mean_pool(rows, width, &mask[i * s..(i + 1) * s]), self.dim)
            })
            .collect();
        if vectors.len() != texts.len() || vectors.iter().any(|v| v.len() != self.dim.min(width)) {
            return Err(EmbedError::Incomplete { expected: texts.len(), got: vectors.len() });
        }
        Ok(vectors)
    }
}
