//! Lernzeit-Logik (`web/lernzeit.js`, `web/home-view.js`) für die PWA als WASM.

use impala_model::learning_time::{self, LearningSessionData};
use serde_json::Value;
use wasm_bindgen::prelude::*;

use crate::js::{browser_zone, from_js, to_js};

/// Intervall-Vereinigung: Vereinigt überlappende Zeitabschnitte (Wanduhrzeit).
#[wasm_bindgen(js_name = lzMergedSeconds)]
pub fn lz_merged_seconds(sessions: &JsValue) -> Result<f64, JsError> {
    let val = from_js(sessions).map_err(|e| JsError::new(&e))?;
    let list: Vec<LearningSessionData> = serde_json::from_value(val).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(learning_time::merged_seconds(&list) as f64)
}

/// Gruppiert Sitzungen nach Kalendertag (lokal nach Beginn der Sitzung).
#[wasm_bindgen(js_name = lzTotalsByDay)]
pub fn lz_totals_by_day(sessions: &JsValue, live: &JsValue) -> Result<JsValue, JsError> {
    let val = from_js(sessions).map_err(|e| JsError::new(&e))?;
    let list: Vec<LearningSessionData> = serde_json::from_value(val).map_err(|e| JsError::new(&e.to_string()))?;
    let live_data: Option<LearningSessionData> = if live.is_null() || live.is_undefined() {
        None
    } else {
        let lv = from_js(live).map_err(|e| JsError::new(&e))?;
        serde_json::from_value(lv).ok()
    };
    let totals = learning_time::totals_by_day(&list, live_data.as_ref(), &browser_zone());
    Ok(to_js(&serde_json::to_value(totals).unwrap_or(Value::Null)))
}

/// Die 7 Tage der Woche (Mo–So) als Sekunden-Array.
#[wasm_bindgen(js_name = lzWeekData)]
pub fn lz_week_data(totals: &JsValue, now_ms: f64, week_offset: i32) -> Result<JsValue, JsError> {
    let val = from_js(totals).map_err(|e| JsError::new(&e))?;
    let map: std::collections::HashMap<String, u64> = serde_json::from_value(val).unwrap_or_default();
    let week = learning_time::week_data(&map, now_ms as i64, week_offset, &browser_zone());
    Ok(to_js(&serde_json::to_value(week).unwrap_or(Value::Null)))
}

/// Aufeinanderfolgende Tage mit mindestens 5 Minuten Lernzeit.
#[wasm_bindgen(js_name = lzStreakDays)]
pub fn lz_streak_days(totals: &JsValue, now_ms: f64) -> Result<u32, JsError> {
    let val = from_js(totals).map_err(|e| JsError::new(&e))?;
    let map: std::collections::HashMap<String, u64> = serde_json::from_value(val).unwrap_or_default();
    Ok(learning_time::streak_days(&map, now_ms as i64, &browser_zone()))
}

/// Wochenziel normalisieren (mindestens 30 min, Standard 300).
#[wasm_bindgen(js_name = lzNormalizeWeekGoal)]
pub fn lz_normalize_week_goal(stored: u32) -> u32 {
    learning_time::normalize_week_goal(stored)
}

/// Schaltet durch die Vorgaben 120, 300, 480, 720 min.
#[wasm_bindgen(js_name = lzCycleWeekGoal)]
pub fn lz_cycle_week_goal(current: u32) -> u32 {
    learning_time::cycle_week_goal(current)
}

/// Home-Hinweis als Enum-Objekt `{ kind: "...", ... }`.
#[wasm_bindgen(js_name = lzHomeNudge)]
pub fn lz_home_nudge(streak: u32, today_seconds: f64, week_seconds: f64, goal_min: u32, current_hour: u32) -> JsValue {
    let nudge = learning_time::home_nudge(streak, today_seconds as u64, week_seconds as u64, goal_min, current_hour);
    to_js(&serde_json::to_value(nudge).unwrap_or(Value::Null))
}

/// Fertig formulierter deutscher Satz für die Begrüßung auf der Startseite.
#[wasm_bindgen(js_name = lzHomeNudgeText)]
pub fn lz_home_nudge_text(
    streak: u32,
    today_seconds: f64,
    week_seconds: f64,
    goal_min: u32,
    current_hour: u32,
) -> String {
    let nudge = learning_time::home_nudge(streak, today_seconds as u64, week_seconds as u64, goal_min, current_hour);
    nudge.message()
}

/// Erfassungs-Zustandsmaschine (Tracker) für die PWA.
#[wasm_bindgen]
pub struct LzSessionTracker(learning_time::SessionTracker);

#[wasm_bindgen]
impl LzSessionTracker {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self(learning_time::SessionTracker::new())
    }

    #[wasm_bindgen(getter, js_name = isActive)]
    pub fn is_active(&self) -> bool {
        self.0.is_active()
    }

    #[wasm_bindgen(getter, js_name = hasCurrent)]
    pub fn has_current(&self) -> bool {
        self.0.current.is_some()
    }

    #[wasm_bindgen(getter, js_name = currentId)]
    pub fn current_id(&self) -> Option<String> {
        self.0.current.as_ref().map(|s| s.id.clone())
    }

    #[wasm_bindgen(getter, js_name = pausedAtMs)]
    pub fn paused_at_ms(&self) -> f64 {
        self.0.current.as_ref().map_or(0.0, |s| s.paused_at_ms as f64)
    }

    #[wasm_bindgen(js_name = openSegment)]
    #[allow(clippy::too_many_arguments)]
    pub fn open_segment(
        &mut self,
        now_ms: f64,
        now_iso: &str,
        category: &str,
        source_id: Option<String>,
        subject: Option<String>,
        subject_source: Option<String>,
        uid_fn: &js_sys::Function,
    ) -> JsValue {
        let gen_id = || uid_fn.call0(&JsValue::NULL).ok().and_then(|v| v.as_string()).unwrap_or_default();
        let res = self.0.open_segment(
            now_ms as i64,
            now_iso,
            category,
            source_id.as_deref(),
            subject.as_deref(),
            subject_source.as_deref(),
            gen_id,
        );
        match res {
            Some(p) => to_js(&serde_json::to_value(p).unwrap_or(Value::Null)),
            None => JsValue::NULL,
        }
    }

    #[wasm_bindgen(js_name = pauseSegment)]
    pub fn pause_segment(&mut self, now_ms: f64, now_iso: &str) -> JsValue {
        match self.0.pause_segment(now_ms as i64, now_iso) {
            Some(p) => to_js(&serde_json::to_value(p).unwrap_or(Value::Null)),
            None => JsValue::NULL,
        }
    }

    #[wasm_bindgen(js_name = finishSession)]
    pub fn finish_session(&mut self, now_ms: f64, now_iso: &str) -> JsValue {
        match self.0.finish_session(now_ms as i64, now_iso) {
            Some(p) => to_js(&serde_json::to_value(p).unwrap_or(Value::Null)),
            None => JsValue::NULL,
        }
    }

    #[wasm_bindgen(js_name = maybeSplitSegment)]
    #[allow(clippy::too_many_arguments)]
    pub fn maybe_split_segment(
        &mut self,
        now_ms: f64,
        now_iso: &str,
        category: &str,
        source_id: Option<String>,
        subject: Option<String>,
        subject_source: Option<String>,
        uid_fn: &js_sys::Function,
    ) -> JsValue {
        let gen_id = || uid_fn.call0(&JsValue::NULL).ok().and_then(|v| v.as_string()).unwrap_or_default();
        let res = self.0.maybe_split_segment(
            now_ms as i64,
            now_iso,
            category,
            source_id.as_deref(),
            subject.as_deref(),
            subject_source.as_deref(),
            gen_id,
        );
        match res {
            Some(p) => to_js(&serde_json::to_value(p).unwrap_or(Value::Null)),
            None => JsValue::NULL,
        }
    }

    #[wasm_bindgen(js_name = currentAsSession)]
    pub fn current_as_session(&self, now_iso: &str) -> JsValue {
        match self.0.current_as_session(now_iso) {
            Some(s) => to_js(&serde_json::to_value(s).unwrap_or(Value::Null)),
            None => JsValue::NULL,
        }
    }
}
