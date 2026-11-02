//! Rohdaten für Statistik und Lernanalyse (anki-stats.js, lernmuster.js, lernanalyse.js): Karten mit
//! Lernstand, alle Bewertungen und die Lern-Telemetrie. Die Auswertung selbst läuft (wie in der PWA)
//! in der Oberfläche.

use serde_json::{Value, json};

use crate::ImpalaCore;

#[uniffi::export]
impl ImpalaCore {
    /// `{ cards: [{ id, front, deck, pageId, state, stability, lapses, due, suspended }], reviews: [...],
    /// telemetry: [...] }` als JSON; Bewertungen und Telemetrie wie in `S.reviews` / `S.telemetry`.
    pub fn learning_stats_json(&self) -> String {
        let inner = self.lock();
        let state = inner.model.state();
        let cards: Vec<Value> = state
            .active_cards()
            .into_iter()
            .map(|c| {
                let srs = c.srs().cloned().unwrap_or(Value::Null);
                json!({
                    "id": c.id(),
                    "front": c.get("front").unwrap_or(Value::Null),
                    "deck": c.deck_name(),
                    "pageId": c.get("pageId").unwrap_or(Value::Null),
                    "state": srs.get("state").cloned().unwrap_or(Value::from("new")),
                    "stability": srs.get("stability").cloned().unwrap_or(Value::from(0)),
                    "lapses": srs.get("lapses").cloned().unwrap_or(Value::from(0)),
                    "due": srs.get("due").cloned().unwrap_or(Value::Null),
                    "suspended": c.is_suspended(),
                })
            })
            .collect();
        json!({
            "cards": cards,
            "reviews": serde_json::to_value(&state.reviews).unwrap_or(Value::Null),
            "telemetry": serde_json::to_value(&state.telemetry).unwrap_or(Value::Null),
        })
        .to_string()
    }
}
