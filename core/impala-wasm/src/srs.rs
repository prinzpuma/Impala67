//! Karteikarten-Planung (FSRS, `impala-srs`) für die PWA. Der Lernstand `card.srs` geht als
//! JS-Objekt hin und zurück; unbekannte Felder alter Karten bleiben erhalten.

use impala_srs::{Fuzz, Rating, Srs, Timestamp};
use serde_json::Value;
use wasm_bindgen::prelude::*;

use crate::js::{from_js, to_js};

fn now_or(ms: f64) -> Timestamp {
    Timestamp::from_millis(if ms.is_finite() { ms as i64 } else { js_sys::Date::now() as i64 })
}

/// Liest `card.srs`. Fehlt `due` oder ist es unlesbar (Altdaten), gilt die Karte ab `now` als
/// fällig – das JS überschrieb `due` beim Bewerten ohnehin.
fn read(card: &JsValue, now: Timestamp) -> Result<Srs, JsError> {
    let mut v = from_js(card).map_err(|e| JsError::new(&e))?;
    let Value::Object(o) = &mut v else { return Ok(Srs::new(now)) };
    if !o.get("due").and_then(Value::as_str).is_some_and(|d| Timestamp::parse_iso(d).is_some()) {
        o.insert("due".into(), Value::String(now.to_iso()));
    }
    serde_json::from_value(v).map_err(|e| JsError::new(&format!("Lernstand unlesbar: {e}")))
}

fn write(s: &Srs) -> JsValue {
    to_js(&serde_json::to_value(s).unwrap_or(Value::Null))
}

/// Neue Karte, fällig ab `t` (ISO-Zeitpunkt des Events; unlesbar ⇒ jetzt).
#[wasm_bindgen(js_name = srsNewCard)]
pub fn new_card(t: &str) -> JsValue {
    write(&Srs::new(Timestamp::parse_iso(t).unwrap_or_else(|| now_or(f64::NAN))))
}

/// Lernstand nach einer Bewertung (`grade` 1…4). `fuzz`: Zufallszahl in [0, 1) oder ohne Fuzz.
#[wasm_bindgen(js_name = srsRate)]
pub fn rate(card: &JsValue, grade: f64, now_ms: f64, fuzz: Option<f64>) -> Result<JsValue, JsError> {
    let now = now_or(now_ms);
    let fuzz = fuzz.map_or(Fuzz::Off, Fuzz::Sample);
    Ok(write(&read(card, now)?.rate(Rating::from_grade(grade), now, fuzz)))
}

/// Intervall-Texte der vier Antwort-Knöpfe (Nochmal, Schwer, Gut, Einfach).
#[wasm_bindgen(js_name = srsPreview)]
pub fn preview(card: &JsValue, now_ms: f64) -> Result<Vec<String>, JsError> {
    let now = now_or(now_ms);
    Ok(read(card, now)?.preview(now).to_vec())
}

/// Abrufwahrscheinlichkeit jetzt; `undefined` bei neuen oder unlesbaren Karten.
#[wasm_bindgen(js_name = srsRetrievability)]
pub fn retrievability(card: &JsValue, now_ms: f64) -> Option<f64> {
    let now = now_or(now_ms);
    read(card, now).ok()?.retrievability_at(now)
}

/// Gefundene Lücken-Nummern aufsteigend ohne Doppelte.
#[wasm_bindgen(js_name = clozeIndexes)]
pub fn cloze_indexes(text: &str) -> Vec<u32> {
    impala_srs::cloze::indexes(text)
}

/// Vorderseite einer Karte: Lücke `idx` wird verdeckt, andere bleiben unmaskiert.
#[wasm_bindgen(js_name = clozeFront)]
pub fn cloze_front(text: &str, idx: u32) -> String {
    impala_srs::cloze::front(text, idx)
}

/// Rückseite einer Karte: Lücke `idx` wird markiert, andere bleiben unmaskiert.
#[wasm_bindgen(js_name = clozeBack)]
pub fn cloze_back(text: &str, idx: u32) -> String {
    impala_srs::cloze::back(text, idx)
}

/// Markierten Text in `{{cN::…}}` setzen; liefert `{ text, cursor }`.
#[wasm_bindgen(js_name = clozeWrap)]
pub fn cloze_wrap(text: &str, u16_start: u32, u16_end: u32) -> JsValue {
    let wrap = impala_srs::cloze::wrap_cloze(text, u16_start, u16_end);
    to_js(&serde_json::to_value(&wrap).unwrap_or(Value::Null))
}

/// Maskiert alle Lücken mit `＿＿＿` und liefert `{ question, answers }` oder `null`.
#[wasm_bindgen(js_name = clozeRecall)]
pub fn cloze_recall(front: &str) -> JsValue {
    match impala_srs::cloze::cloze_recall(front) {
        Some(recall) => to_js(&serde_json::to_value(&recall).unwrap_or(Value::Null)),
        None => JsValue::NULL,
    }
}

/// Wandelt `==Markierung==` in `{{cN::Markierung}}` um; `null`, wenn keine Markierung da ist.
#[wasm_bindgen(js_name = clozeHighlightsToCloze)]
pub fn highlights_to_cloze(line: &str) -> Option<String> {
    impala_srs::cloze::highlights_to_cloze(line)
}

/// Entfernt Zeilenpräfixe (`-`, `*`, `#`, `> `, Checkboxen).
#[wasm_bindgen(js_name = clozeStripLinePrefix)]
pub fn strip_line_prefix(line: &str) -> String {
    impala_srs::cloze::strip_line_prefix(line).to_string()
}

/// Findet alle Zeilen eines Seiteninhalts, die als Lückentext taugen.
#[wasm_bindgen(js_name = clozeSourcesFromContent)]
pub fn cloze_sources_from_content(content: &str) -> Vec<String> {
    impala_srs::cloze::cloze_sources_from_content(content)
}
