//! KI-Zeitstrahl-Modus (`impala-lehrer`) für die PWA: Werte gehen als JSON über die Grenze,
//! Fehler als `JsError` mit deutschem Text.

use js_sys::JSON;
use serde_json::Value;
use wasm_bindgen::prelude::*;

use crate::js::{from_js, js_message, to_js};

fn value(v: &JsValue) -> Result<Value, JsError> {
    from_js(v).map_err(|e| JsError::new(&e))
}

fn out(v: impl serde::Serialize) -> JsValue {
    to_js(&serde_json::to_value(v).unwrap_or(Value::Null))
}

fn err(e: String) -> JsError {
    JsError::new(&e)
}

/// `edit_timeline`: `tl` = `null` legt einen neuen Zeitstrahl an. Liefert
/// `{ timeline, added, updated, removed }`.
#[wasm_bindgen(js_name = lehrerApplyEdit)]
pub fn lehrer_apply_edit(tl: &JsValue, edit: &JsValue, now: &str) -> Result<JsValue, JsError> {
    let tl = value(tl)?;
    let tl = if tl.is_null() { None } else { Some(tl) };
    impala_lehrer::apply_edit(tl, &value(edit)?, now).map(out).map_err(err)
}

/// Anzeigedaten: `{ cols, lanes, nodes, edges, stats, today }` (mit Frische zum Zeitpunkt `now`).
#[wasm_bindgen(js_name = lehrerView)]
pub fn lehrer_view(tl: &JsValue) -> Result<JsValue, JsError> {
    Ok(to_js(&impala_lehrer::view(&value(tl)?)))
}

#[wasm_bindgen(js_name = lehrerViewAt)]
pub fn lehrer_view_at(tl: &JsValue, now: &str) -> Result<JsValue, JsError> {
    Ok(to_js(&impala_lehrer::view_at(&value(tl)?, now)))
}

/// Wertet einen Quiz-Versuch aus: `{ timeline, grade }`.
#[wasm_bindgen(js_name = lehrerRecordQuiz)]
pub fn lehrer_record_quiz(tl: &JsValue, node: &str, answers: &JsValue, now: &str) -> Result<JsValue, JsError> {
    impala_lehrer::record_quiz(&value(tl)?, node, &value(answers)?, now).map(out).map_err(err)
}

/// Wertet einen Quiz-Versuch inkl. Konfidenz-Liste (`"sure"|"unsure"|"guess"`) aus.
#[wasm_bindgen(js_name = lehrerRecordQuizFull)]
pub fn lehrer_record_quiz_full(
    tl: &JsValue,
    node: &str,
    answers: &JsValue,
    confidences: &JsValue,
    now: &str,
) -> Result<JsValue, JsError> {
    impala_lehrer::record_quiz_with_confidence(&value(tl)?, node, &value(answers)?, &value(confidences)?, now)
        .map(out)
        .map_err(err)
}

/// Wertet die kurze Einstiegsfrage (Pre-Test) vor dem Lesen aus.
#[wasm_bindgen(js_name = lehrerRecordPretest)]
pub fn lehrer_record_pretest(tl: &JsValue, node: &str, answer: &JsValue, now: &str) -> Result<JsValue, JsError> {
    impala_lehrer::record_pretest(&value(tl)?, node, &value(answer)?, now).map(out).map_err(err)
}

/// Stellt eine gemischte Kurz-Auffrischung (Interleaving) für verblassende/schwache Knoten zusammen.
#[wasm_bindgen(js_name = lehrerBuildRefresh)]
pub fn lehrer_build_refresh(tl: &JsValue, now: &str, max_questions: u32) -> Result<JsValue, JsError> {
    impala_lehrer::build_refresh_session(&value(tl)?, now, max_questions as usize).map(out).map_err(err)
}

/// Wertet eine gemischte Auffrischung aus und aktualisiert die FSRS-Werte der beteiligten Knoten.
#[wasm_bindgen(js_name = lehrerRecordRefresh)]
pub fn lehrer_record_refresh(tl: &JsValue, submissions: &JsValue, now: &str) -> Result<JsValue, JsError> {
    impala_lehrer::record_refresh(&value(tl)?, &value(submissions)?, now).map(out).map_err(err)
}

/// Übernimmt die Bewertung der KI (`check_lesson`): `{ timeline, node }`.
#[wasm_bindgen(js_name = lehrerApplyCheck)]
pub fn lehrer_apply_check(tl: &JsValue, check: &JsValue, now: &str) -> Result<JsValue, JsError> {
    impala_lehrer::apply_check(&value(tl)?, &value(check)?, now).map(out).map_err(err)
}

/// Ausgabe für `read_timeline`: Überblick oder ein ganzer Knoten.
#[wasm_bindgen(js_name = lehrerDescribe)]
pub fn lehrer_describe(tl: &JsValue, node: Option<String>) -> Result<JsValue, JsError> {
    impala_lehrer::describe(&value(tl)?, node.as_deref()).map(|v| to_js(&v)).map_err(err)
}

/// `{ id, title, subject, updated, total, mastered }` für Listen.
#[wasm_bindgen(js_name = lehrerListEntry)]
pub fn lehrer_list_entry(tl: &JsValue) -> Result<JsValue, JsError> {
    Ok(to_js(&impala_lehrer::list_entry(&value(tl)?)))
}

/// Werkzeug-Definitionen der KI-Werkzeuge des Zeitstrahls (JSON-Array).
#[wasm_bindgen(js_name = lehrerToolDefs)]
pub fn lehrer_tool_defs() -> Result<JsValue, JsError> {
    JSON::parse(impala_lehrer::TOOL_DEFS).map_err(|e| JsError::new(&js_message(&e)))
}
