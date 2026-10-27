//! CTC-Dekodierung der Handschrift für die PWA. Das Wörterbuch geht einmal in den WASM-Speicher
//! (`InkDecoder`), jede Zeile übergibt nur ihre Logit-Matrix als `Float32Array` (ein Kopiervorgang).

use impala_ink::{DecodeOptions, Lexicon, LineDecoding, Mode, decode_line, mark_gap_spaces};
use wasm_bindgen::prelude::*;

/// Dekodierer mit optionalem Wörterbuch.
#[wasm_bindgen]
pub struct InkDecoder {
    lexicon: Option<Lexicon>,
}

#[wasm_bindgen]
impl InkDecoder {
    /// `lexicon`: Bytes von `handwriting-lexicon-de.txt` (UTF-8, ein Wort je Zeile), etwa aus
    /// `fetch(…).arrayBuffer()` – als Bytes spart es das Umkodieren eines 3-MB-Strings. Ohne Angabe kein Wörterbuch.
    #[wasm_bindgen(constructor)]
    pub fn new(lexicon: Option<Vec<u8>>) -> Result<InkDecoder, JsError> {
        let lexicon = lexicon
            .map(|bytes| String::from_utf8(bytes).map(|text| Lexicon::new(&text)))
            .transpose()
            .map_err(|_| JsError::new("Wörterbuch ist kein UTF-8"))?;
        Ok(InkDecoder { lexicon })
    }

    /// Wörter im Wörterbuch (0 ohne).
    #[wasm_bindgen(getter, js_name = lexiconSize)]
    pub fn lexicon_size(&self) -> usize {
        self.lexicon.as_ref().map_or(0, Lexicon::len)
    }

    /// Dekodiert eine Zeile (`steps × classes`, zeilenweise) wie `decodeWithConfidence`.
    /// `mode`: `"text"`, `"math"`, sonst automatisch; `threshold` ohne Angabe 0,8.
    /// `gaps` (Paare `[von, bis)` in Bildspalten) und `image_width` wie `markGapSpaces`; leer = nichts markieren.
    #[wasm_bindgen(js_name = decodeLine)]
    pub fn decode_line(
        &self,
        mut logits: Vec<f32>,
        classes: usize,
        mode: Option<String>,
        threshold: Option<f64>,
        gaps: &[u32],
        image_width: usize,
    ) -> Result<InkLine, JsError> {
        let err = |e: impala_ink::InkError| JsError::new(&e.to_string());
        if !gaps.is_empty() {
            let gaps: Vec<(usize, usize)> = gaps.chunks_exact(2).map(|p| (p[0] as usize, p[1] as usize)).collect();
            mark_gap_spaces(&mut logits, classes, &gaps, image_width).map_err(err)?;
        }
        let mode = match mode.as_deref() {
            Some("text") => Mode::Text,
            Some("math") => Mode::Math,
            _ => Mode::Auto,
        };
        let options = DecodeOptions { mode, threshold: threshold.unwrap_or(DecodeOptions::default().threshold) };
        decode_line(&logits, classes, &options, self.lexicon.as_ref()).map(InkLine).map_err(err)
    }
}

/// Ergebnis von [`InkDecoder::decode_line`]; Felder wie im JS-Ergebnis.
#[wasm_bindgen]
pub struct InkLine(LineDecoding);

#[wasm_bindgen]
impl InkLine {
    #[wasm_bindgen(getter)]
    pub fn text(&self) -> String {
        self.0.text.clone()
    }

    #[wasm_bindgen(getter, js_name = rawText)]
    pub fn raw_text(&self) -> String {
        self.0.raw_text.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn confidence(&self) -> f64 {
        self.0.confidence
    }

    /// `"empty"`, `"drawing"`, `"uncertain"` oder `"recognized"`.
    #[wasm_bindgen(getter)]
    pub fn status(&self) -> String {
        self.0.status.as_str().to_owned()
    }

    #[wasm_bindgen(getter, js_name = blankRatio)]
    pub fn blank_ratio(&self) -> f64 {
        self.0.blank_ratio
    }

    #[wasm_bindgen(getter, js_name = charConfidences)]
    pub fn char_confidences(&self) -> Vec<f32> {
        self.0.char_confidences.clone()
    }
}
