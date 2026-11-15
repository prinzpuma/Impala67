//! WASM-Bindings für Lernanalyse und Lernmuster.

use impala_model::analysis::compute_goal as core_compute_goal;
use wasm_bindgen::prelude::*;

use crate::js::to_js;
use crate::model::ModelCore;

#[wasm_bindgen]
impl ModelCore {
    /// Berechnet die Lernanalyse der Startseite:
    /// Liefert `{ goal, subjects, time, forecast, headline, action, actionDeck }`
    /// oder `null`, falls es noch gar keine Lerndaten gibt.
    #[wasm_bindgen(js_name = homeAnalysis)]
    pub fn home_analysis(&self, now_ms: f64, goal_min: u32, days_json: &str, pace: f64) -> Result<JsValue, JsError> {
        let days: Vec<f64> =
            serde_json::from_str(days_json).map_err(|e| JsError::new(&format!("days_json ungültig: {e}")))?;
        let now_i64 = if now_ms.is_finite() { now_ms as i64 } else { js_sys::Date::now() as i64 };

        let result = self.m.state().home_analysis(now_i64, &crate::js::browser_zone(), goal_min, &days, pace);
        match result {
            Some(analysis) => {
                let v = serde_json::to_value(&analysis).map_err(|e| JsError::new(&format!("Serialisierung: {e}")))?;
                Ok(to_js(&v))
            }
            None => Ok(JsValue::NULL),
        }
    }

    /// Berechnet die Wochenziel-Prognose für gegebene Tage und Tempo.
    #[wasm_bindgen(js_name = computeGoal)]
    pub fn compute_goal(&self, goal_min: u32, days_json: &str, today: u8, pace: f64) -> Result<JsValue, JsError> {
        let days: Vec<f64> =
            serde_json::from_str(days_json).map_err(|e| JsError::new(&format!("days_json ungültig: {e}")))?;
        let result = core_compute_goal(goal_min, &days, today, pace);
        let v = serde_json::to_value(&result).map_err(|e| JsError::new(&format!("Serialisierung: {e}")))?;
        Ok(to_js(&v))
    }

    /// Berechnet die Lernmuster für den Statistik-Tab:
    /// `{ position, timer, hours, experiments, problems, empty }`.
    #[wasm_bindgen(js_name = patternData)]
    pub fn pattern_data(&self) -> Result<JsValue, JsError> {
        let result = self.m.state().pattern_data(None);
        let v = serde_json::to_value(&result).map_err(|e| JsError::new(&format!("Serialisierung: {e}")))?;
        Ok(to_js(&v))
    }
}

/// Freie Funktion zur Wochenziel-Berechnung ohne Modellinstanz.
#[wasm_bindgen(js_name = computeGoalStandalone)]
pub fn compute_goal_standalone(goal_min: u32, days_json: &str, today: u8, pace: f64) -> Result<JsValue, JsError> {
    let days: Vec<f64> =
        serde_json::from_str(days_json).map_err(|e| JsError::new(&format!("days_json ungültig: {e}")))?;
    let result = core_compute_goal(goal_min, &days, today, pace);
    let v = serde_json::to_value(&result).map_err(|e| JsError::new(&format!("Serialisierung: {e}")))?;
    Ok(to_js(&v))
}
