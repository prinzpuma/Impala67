//! Karten-Import und -Export (TXT, CSV/TSV, Anki-Text) für die PWA (`web/extras.js`).

use std::collections::HashSet;

use impala_model::PlainCard;
use serde_json::Value;
use wasm_bindgen::prelude::*;

use crate::js::{from_js, to_js};

fn cards_from(v: &JsValue) -> Result<Vec<PlainCard>, JsError> {
    let val = from_js(v).map_err(|e| JsError::new(&e))?;
    serde_json::from_value(val).map_err(|e| JsError::new(&format!("Karten unlesbar: {e}")))
}

fn keys_from(v: &JsValue) -> HashSet<String> {
    if v.is_null() || v.is_undefined() {
        return HashSet::new();
    }
    if let Ok(val) = from_js(v) {
        match val {
            Value::Array(arr) => arr
                .into_iter()
                .filter_map(|item| match item {
                    Value::String(s) => Some(s),
                    Value::Object(o) => {
                        if o.get("trashed").and_then(Value::as_bool).unwrap_or(false) {
                            None
                        } else {
                            let f = o.get("front").and_then(Value::as_str).unwrap_or("");
                            let b = o.get("back").and_then(Value::as_str).unwrap_or("");
                            let d = o.get("deck").and_then(Value::as_str).unwrap_or("Standard");
                            Some(impala_model::card_key(f, b, d))
                        }
                    }
                    _ => None,
                })
                .collect(),
            Value::Object(map) => map
                .values()
                .filter_map(|item| match item {
                    Value::Object(o) => {
                        if o.get("trashed").and_then(Value::as_bool).unwrap_or(false) {
                            None
                        } else {
                            let f = o.get("front").and_then(Value::as_str).unwrap_or("");
                            let b = o.get("back").and_then(Value::as_str).unwrap_or("");
                            let d = o.get("deck").and_then(Value::as_str).unwrap_or("Standard");
                            Some(impala_model::card_key(f, b, d))
                        }
                    }
                    Value::String(s) => Some(s.clone()),
                    _ => None,
                })
                .collect(),
            _ => HashSet::new(),
        }
    } else {
        HashSet::new()
    }
}

/// Impala-TXT-Format schreiben (`impala67-karten.txt`).
#[wasm_bindgen(js_name = cardExportTxt)]
pub fn export_txt(cards: &JsValue) -> Result<String, JsError> {
    let plain = cards_from(cards)?;
    Ok(impala_model::export_txt(&plain))
}

/// CSV-Format schreiben (`impala67-karten.csv`).
#[wasm_bindgen(js_name = cardExportCsv)]
pub fn export_csv(cards: &JsValue) -> Result<String, JsError> {
    let plain = cards_from(cards)?;
    Ok(impala_model::export_csv(&plain))
}

/// CSV/TSV-Datei mit Trennzeichen-Erkennung in Zeilen zerlegen.
#[wasm_bindgen(js_name = cardParseCsv)]
pub fn parse_csv(text: &str) -> JsValue {
    let rows = impala_model::parse_csv(text);
    to_js(&serde_json::to_value(rows).unwrap_or(Value::Null))
}

/// Tabellarische Karten (CSV/TSV oder Anki-Text) einlesen.
#[wasm_bindgen(js_name = cardParseTableCards)]
pub fn parse_table_cards(text: &str, default_deck: &str) -> JsValue {
    let parsed = impala_model::parse_table_cards(text, default_deck);
    to_js(&serde_json::to_value(parsed).unwrap_or(Value::Null))
}

/// Impala-TXT-Dateien einlesen.
#[wasm_bindgen(js_name = cardParseImpalaTxt)]
pub fn parse_impala_txt(text: &str, default_deck: &str) -> JsValue {
    let parsed = impala_model::parse_impala_txt(text, default_deck);
    to_js(&serde_json::to_value(parsed).unwrap_or(Value::Null))
}

/// Erkennt das Format automatisch (Impala-TXT vs. Tabelle/Anki) und parst Karten.
#[wasm_bindgen(js_name = cardParseCardText)]
pub fn parse_card_text(text: &str, default_deck: &str) -> JsValue {
    let parsed = impala_model::parse_card_text(text, default_deck);
    to_js(&serde_json::to_value(parsed).unwrap_or(Value::Null))
}

/// Eindeutiger Kartenschlüssel für Duplikate.
#[wasm_bindgen(js_name = cardKey)]
pub fn card_key(front: &str, back: &str, deck: &str) -> String {
    impala_model::card_key(front, back, deck)
}

/// Zählt Duplikate innerhalb der Karten und gegenüber bestehenden Schlüsseln/Karten.
#[wasm_bindgen(js_name = cardDuplicateCount)]
pub fn duplicate_count(cards: &JsValue, existing: &JsValue) -> Result<usize, JsError> {
    let plain = cards_from(cards)?;
    let seen = keys_from(existing);
    Ok(impala_model::duplicate_count(&plain, seen))
}

/// HTML aus Anki-Feldern in Klartext/Markdown umwandeln.
#[wasm_bindgen(js_name = cardStripHtml)]
pub fn strip_html(html: &str) -> String {
    impala_model::strip_html(html)
}
