//! Markdown ↔ Editor-Blöcke und Text-Helfer (`impala-markdown`) für die PWA. Blöcke gehen als
//! JS-Objekte in derselben Form wie bisher hin und zurück (Undo-Stände, Zwischenablage).

use impala_markdown::Block;
use js_sys::Function;
use serde_json::Value;
use wasm_bindgen::prelude::*;

use crate::js::{from_js, to_js};

/// Liest Blöcke nachsichtig wie das JS: `null`/`undefined` und Nicht-Objekte gelten als leer.
fn blocks_from(v: &JsValue) -> Result<Vec<Block>, JsError> {
    let v = match from_js(v).map_err(|e| JsError::new(&e))? {
        Value::Array(items) => Value::Array(items.into_iter().filter(Value::is_object).collect()),
        _ => return Ok(Vec::new()),
    };
    serde_json::from_value(v).map_err(|e| JsError::new(&format!("Blöcke unlesbar: {e}")))
}

fn block_from(v: &JsValue) -> Result<Block, JsError> {
    let v = from_js(v).map_err(|e| JsError::new(&e))?;
    serde_json::from_value(v).map_err(|e| JsError::new(&format!("Block unlesbar: {e}")))
}

/// Markdown → Blöcke. `uid` liefert die Block-IDs (`U.uid`).
#[wasm_bindgen(js_name = mdParse)]
pub fn parse(md: &str, uid: &Function) -> JsValue {
    let mut next = || uid.call0(&JsValue::NULL).ok().and_then(|v| v.as_string()).unwrap_or_default();
    to_js(&serde_json::to_value(impala_markdown::parse(md, &mut next)).unwrap_or(Value::Null))
}

/// Blöcke → Markdown.
#[wasm_bindgen(js_name = mdSerialize)]
pub fn serialize(blocks: &JsValue) -> Result<String, JsError> {
    Ok(impala_markdown::serialize(&blocks_from(blocks)?))
}

/// Ein Block → Markdown (Zwischenablage).
#[wasm_bindgen(js_name = mdSerializeBlock)]
pub fn serialize_block(block: &JsValue) -> Result<String, JsError> {
    Ok(blocks_from(&js_sys::Array::of1(block).into())?
        .first()
        .map(impala_markdown::serialize_block)
        .unwrap_or_default())
}

/// MIME-Typ aus Dateiname oder URL (`""` wenn unbekannt).
#[wasm_bindgen(js_name = mdMimeFromName)]
pub fn mime_from_name(name: &str) -> String {
    impala_markdown::mime_from_name(name).unwrap_or_default().to_owned()
}

/// Klartext eines Blocks.
#[wasm_bindgen(js_name = mdPlainText)]
pub fn plain_text(block: &JsValue) -> Result<String, JsError> {
    Ok(blocks_from(&js_sys::Array::of1(block).into())?.first().map(impala_markdown::plain_text).unwrap_or_default())
}

/// Bis zu 7 Vorschauzeilen einer Seite.
#[wasm_bindgen(js_name = mdExcerpt)]
pub fn excerpt(title: &str, content: &str) -> Vec<String> {
    impala_markdown::excerpt(title, content)
}

/// Klartext einer Karte (Bilder/HTML raus, Formeln als „…“).
#[wasm_bindgen(js_name = mdCardText)]
pub fn card_text(md: &str) -> String {
    impala_markdown::card_text(md)
}

/// Erster Fließtext-Absatz, höchstens 180 Zeichen.
#[wasm_bindgen(js_name = mdTeaser)]
pub fn teaser(body: &str) -> String {
    impala_markdown::teaser(body)
}

/// Erste Zeile ohne Überschrift und Markdown-Zeichen, höchstens 80 Zeichen.
#[wasm_bindgen(js_name = mdFirstLine)]
pub fn first_line(content: &str) -> String {
    impala_markdown::first_line(content)
}

#[wasm_bindgen(js_name = mdShortcutType)]
pub fn shortcut_type(line: &str) -> JsValue {
    if let Some((st, rest)) = impala_markdown::shortcut_type(line) {
        let (t_str, checked_opt) = match st {
            impala_markdown::ShortcutType::H1 => ("h1", None),
            impala_markdown::ShortcutType::H2 => ("h2", None),
            impala_markdown::ShortcutType::H3 => ("h3", None),
            impala_markdown::ShortcutType::Bullet => ("bullet", None),
            impala_markdown::ShortcutType::Number => ("number", None),
            impala_markdown::ShortcutType::Todo { checked } => ("todo", Some(checked)),
            impala_markdown::ShortcutType::Quote => ("quote", None),
            impala_markdown::ShortcutType::Code => ("code", None),
        };
        let map = serde_json::json!({
            "type": t_str,
            "rest": rest,
            "checked": checked_opt
        });
        to_js(&map)
    } else {
        JsValue::NULL
    }
}

#[wasm_bindgen(js_name = mdConvertBlock)]
pub fn convert_block(block: &JsValue, target_type: &str) -> Result<JsValue, JsError> {
    let b = block_from(block)?;
    let res = impala_markdown::convert_block(&b, target_type);
    Ok(to_js(&serde_json::to_value(&res).unwrap()))
}

#[wasm_bindgen(js_name = mdContinuationBlock)]
pub fn continuation_block(block: &JsValue, new_id: &str) -> Result<JsValue, JsError> {
    let b = block_from(block)?;
    if let Some((b1, b2)) = impala_markdown::continuation_block(&b, new_id.to_string()) {
        let arr = serde_json::json!([b1, b2]);
        Ok(to_js(&arr))
    } else {
        Ok(JsValue::NULL)
    }
}

#[wasm_bindgen(js_name = mdIndentBlock)]
pub fn indent_block(block: &JsValue, delta: i32) -> Result<JsValue, JsError> {
    let b = block_from(block)?;
    let res = impala_markdown::indent_block(&b, delta);
    Ok(to_js(&serde_json::to_value(&res).unwrap()))
}

#[wasm_bindgen(js_name = mdListNumbers)]
pub fn list_numbers(blocks: &JsValue) -> Result<JsValue, JsError> {
    let bs = blocks_from(blocks)?;
    let nums = impala_markdown::list_numbers(&bs);
    let map: std::collections::HashMap<String, u32> = nums.into_iter().collect();
    Ok(to_js(&serde_json::to_value(&map).unwrap()))
}

#[wasm_bindgen(js_name = mdWrapMarkers)]
pub fn wrap_markers(text: &str, start_utf16: u32, end_utf16: u32, before: &str, after: &str) -> JsValue {
    let (new_text, caret) = impala_markdown::wrap_markers(text, start_utf16, end_utf16, before, after);
    let arr = js_sys::Array::new();
    arr.push(&JsValue::from_str(&new_text));
    arr.push(&JsValue::from_f64(caret as f64));
    arr.into()
}
