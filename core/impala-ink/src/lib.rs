//! Handschrift → Text: Vorverarbeitung (Zeilen, Begradigen, Rastern), CTC-Dekodierung mit Wörterbuch,
//! Seiten-Ablauf mit Zeilen-Cache und der Trait [`InkRecognizer`].
//!
//! Neu geschrieben nach `web/handwriting-*.js`; gleiche Ergebnisse (Golden-Tests in `tests/`).
//! Ohne Feature `onnx` reine Logik (baut für `wasm32-unknown-unknown`): Die PWA kann das Modell weiter mit
//! ONNX Runtime Web ausführen und nur die Dekodierung ([`decode_line`]) aufrufen – ein Aufruf je Zeile mit der
//! ganzen Logit-Matrix.

pub mod ctc;
pub mod lexicon;
#[cfg(feature = "onnx")]
pub mod onnx;
pub mod page;
pub mod preprocess;
pub mod raster;
pub mod vocab;
mod words;

pub use ctc::{DecodeOptions, LineDecoding, Mode, Status, decode_line, levenshtein, mark_gap_spaces};
pub use lexicon::Lexicon;
pub use page::{InkRecognizer, LineCache, LineModel, LineReading, ModelRecognizer, PageRecognition, recognize_page};
pub use preprocess::{Point, Stroke, Tool};
pub use raster::LineImage;

/// Erhöhen, wenn sich die Lesung ändert (ohne neues Modell): Der Heft-Indexer erkennt dann alle Seiten neu
/// (`RECOGNIZER_REVISION` in `web/heft-indexer.js`, Index-Version `"{Modellversion}+r{Revision}"`).
pub const RECOGNIZER_REVISION: u32 = 7;

#[derive(Clone, Debug, PartialEq)]
pub enum InkError {
    /// Logits passen nicht zum Alphabet (`len` Werte, `classes` Klassen je Schritt).
    Shape { len: usize, classes: usize },
    /// Modell nicht ladbar oder Inferenz fehlgeschlagen.
    Model(String),
}

impl std::fmt::Display for InkError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            InkError::Shape { len, classes } => {
                write!(f, "Logits passen nicht: {len} Werte, {classes} Klassen (erwartet {})", vocab::CLASSES)
            }
            InkError::Model(msg) => write!(f, "Handschrift-Modell: {msg}"),
        }
    }
}

impl std::error::Error for InkError {}
