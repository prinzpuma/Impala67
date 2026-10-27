//! Standard-Modell: `web/handwriting-model.onnx` über tract (reines Rust).
//! Eingabe `input` `[1, 1, 64, Breite]` (0..1, 1 = weiß), Ausgabe `output` `[Breite / 4, 1, 101]`.

use std::sync::Arc;

use tract_onnx::prelude::*;

use crate::InkError;
use crate::page::LineModel;
use crate::raster::{IMAGE_HEIGHT, LineImage};
use crate::vocab::CLASSES;

pub struct OnnxModel {
    plan: Arc<TypedRunnableModel>,
}

impl OnnxModel {
    /// Lädt und optimiert das Modell (Breite bleibt symbolisch, ein Plan für alle Zeilenbreiten).
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, InkError> {
        Self::load(bytes).map_err(model_error)
    }

    fn load(mut bytes: &[u8]) -> TractResult<Self> {
        let mut model = tract_onnx::onnx().model_for_read(&mut bytes)?;
        let width = model.symbols.sym("W");
        let shape = [TDim::from(1), TDim::from(1), TDim::from(IMAGE_HEIGHT as i64), TDim::from(width)];
        model.set_input_fact(0, f32::fact(shape).into())?;
        Ok(OnnxModel { plan: model.into_optimized()?.into_runnable()? })
    }

    fn infer(&self, image: &LineImage) -> TractResult<Vec<f32>> {
        let input = tract_ndarray::Array4::from_shape_vec((1, 1, IMAGE_HEIGHT, image.width), image.data.clone())?;
        let out = self.plan.run(tvec!(input.into_tvalue()))?;
        let view = out[0].to_plain_array_view::<f32>()?;
        // [steps, 1, classes] oder [1, steps, classes] → steps × classes
        let shape = view.shape();
        if shape.len() != 3 || shape[shape.len() - 1] != CLASSES || shape[0].min(shape[1]) != 1 {
            return Err(TractError::msg(format!("unerwartete Ausgabeform {shape:?}")));
        }
        Ok(view.iter().copied().collect())
    }
}

impl LineModel for OnnxModel {
    fn run(&self, image: &LineImage) -> Result<Vec<f32>, InkError> {
        if image.data.len() != image.width * IMAGE_HEIGHT || image.width == 0 {
            return Err(InkError::Model(format!(
                "Bildgröße passt nicht: {} Werte, Breite {}",
                image.data.len(),
                image.width
            )));
        }
        self.infer(image).map_err(model_error)
    }
}

fn model_error(e: TractError) -> InkError {
    InkError::Model(format!("{e:#}"))
}
