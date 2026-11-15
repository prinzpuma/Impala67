//! Rohdaten und Kennzahlen für Statistik und Lernanalyse (anki-stats.js, lernmuster.js, lernanalyse.js):
//! Karten mit Lernstand, alle Bewertungen, Lern-Telemetrie und berechnete Kennzahlen.

use impala_model::stats::{
    Bestand, DeckRow, ForecastDay, HardCard, HeatmapCell, PeakDay, RetentionBucket, RetentionStats, SeriesDay,
    StatsData as ModelStats, StatsOptions,
};
use impala_srs::Timestamp;
use serde_json::{Value, json};

use crate::ImpalaCore;

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct BestandRecord {
    pub neu: u32,
    pub lernen: u32,
    pub wiederholen: u32,
    pub ausgesetzt: u32,
}

impl From<Bestand> for BestandRecord {
    fn from(b: Bestand) -> Self {
        BestandRecord {
            neu: b.neu as u32,
            lernen: b.lernen as u32,
            wiederholen: b.wiederholen as u32,
            ausgesetzt: b.ausgesetzt as u32,
        }
    }
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct DeckRowRecord {
    pub name: String,
    pub n: u32,
    pub due: u32,
    pub reif: u32,
    pub rate: Option<f64>,
}

impl From<DeckRow> for DeckRowRecord {
    fn from(d: DeckRow) -> Self {
        DeckRowRecord { name: d.name, n: d.n as u32, due: d.due as u32, reif: d.reif as u32, rate: d.rate }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct SeriesDayRecord {
    pub date: String,
    pub n: u32,
}

impl From<SeriesDay> for SeriesDayRecord {
    fn from(s: SeriesDay) -> Self {
        SeriesDayRecord { date: s.date, n: s.n as u32 }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct PeakDayRecord {
    pub date: String,
    pub n: u32,
}

impl From<PeakDay> for PeakDayRecord {
    fn from(p: PeakDay) -> Self {
        PeakDayRecord { date: p.date, n: p.n as u32 }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ForecastDayRecord {
    pub day_offset: u32,
    pub n: u32,
}

impl From<ForecastDay> for ForecastDayRecord {
    fn from(f: ForecastDay) -> Self {
        ForecastDayRecord { day_offset: f.day_offset as u32, n: f.n as u32 }
    }
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct HardCardRecord {
    pub id: String,
    pub front: String,
    pub deck: String,
    pub lapses: i64,
    pub stability: f64,
}

impl From<HardCard> for HardCardRecord {
    fn from(h: HardCard) -> Self {
        HardCardRecord { id: h.id, front: h.front, deck: h.deck, lapses: h.lapses, stability: h.stability }
    }
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct RetentionBucketRecord {
    pub n: u32,
    pub rate: Option<f64>,
}

impl From<RetentionBucket> for RetentionBucketRecord {
    fn from(b: RetentionBucket) -> Self {
        RetentionBucketRecord { n: b.n as u32, rate: b.rate }
    }
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct RetentionRecord {
    pub day1: RetentionBucketRecord,
    pub day3: RetentionBucketRecord,
    pub day7: RetentionBucketRecord,
    pub day14: RetentionBucketRecord,
}

impl From<RetentionStats> for RetentionRecord {
    fn from(r: RetentionStats) -> Self {
        RetentionRecord { day1: r.day1.into(), day3: r.day3.into(), day7: r.day7.into(), day14: r.day14.into() }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct HeatmapCellRecord {
    pub date: String,
    pub n: u32,
    pub level: u32,
}

impl From<HeatmapCell> for HeatmapCellRecord {
    fn from(c: HeatmapCell) -> Self {
        HeatmapCellRecord { date: c.date, n: c.n as u32, level: c.level as u32 }
    }
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct LearningStats {
    pub reviews_all: u32,
    pub last: u32,
    pub rate: Option<f64>,
    pub trend: Option<i32>,
    pub avg: f64,
    pub bestand: BestandRecord,
    pub n: u32,
    pub faellig: u32,
    pub reif: u32,
    pub gelernt: u32,
    pub decks: Vec<DeckRowRecord>,
    pub series: Vec<SeriesDayRecord>,
    pub peak: PeakDayRecord,
    pub forecast: Vec<ForecastDayRecord>,
    pub streak_current: u32,
    pub streak_longest: u32,
    pub hard: Vec<HardCardRecord>,
    pub think_ms: i64,
    pub retention: RetentionRecord,
    pub heatmap: Vec<HeatmapCellRecord>,
}

impl From<ModelStats> for LearningStats {
    fn from(s: ModelStats) -> Self {
        LearningStats {
            reviews_all: s.reviews_all as u32,
            last: s.last as u32,
            rate: s.rate,
            trend: s.trend,
            avg: s.avg,
            bestand: s.bestand.into(),
            n: s.n as u32,
            faellig: s.faellig as u32,
            reif: s.reif as u32,
            gelernt: s.gelernt as u32,
            decks: s.decks.into_iter().map(DeckRowRecord::from).collect(),
            series: s.series.into_iter().map(SeriesDayRecord::from).collect(),
            peak: s.peak.into(),
            forecast: s.forecast.into_iter().map(ForecastDayRecord::from).collect(),
            streak_current: s.streak_current as u32,
            streak_longest: s.streak_longest as u32,
            hard: s.hard.into_iter().map(HardCardRecord::from).collect(),
            think_ms: s.think_ms,
            retention: s.retention.into(),
            heatmap: s.heatmap.into_iter().map(HeatmapCellRecord::from).collect(),
        }
    }
}

#[uniffi::export]
impl ImpalaCore {
    /// Berechnete Statistik-Kennzahlen (`StatsData` / `anki-stats.js`).
    pub fn learning_stats(
        &self,
        deck: Option<String>,
        now_ms: Option<i64>,
        utc_offset_minutes: Option<i32>,
    ) -> LearningStats {
        let mut inner = self.lock();
        let now = now_ms
            .map(Timestamp::from_millis)
            .unwrap_or_else(|| Timestamp::parse_iso(&inner.clock.now()).unwrap_or(Timestamp(0)));
        let options = StatsOptions {
            deck: deck.as_deref().filter(|d| !d.is_empty()),
            now,
            tz_offset_minutes: utc_offset_minutes.unwrap_or(0) as i64,
            think_ms: None,
        };
        let stats = inner.model.state().learning_stats(&options);
        LearningStats::from(stats)
    }

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stats_berechnung_und_json() {
        let core = ImpalaCore::open_in_memory().unwrap();
        // Leere Statistik
        let empty = core.learning_stats(None, None, Some(60));
        assert_eq!(empty.n, 0);
        assert_eq!(empty.reviews_all, 0);
        assert_eq!(empty.bestand.neu, 0);
        assert_eq!(empty.series.len(), 30);
        assert_eq!(empty.forecast.len(), 7);
        assert!(empty.heatmap.len() >= 365 && empty.heatmap.len() <= 371);
        assert_eq!(empty.heatmap.last().unwrap().date, empty.series.last().unwrap().date);

        // Karte anlegen
        let card_id = core.create_card("Vorderseite".into(), "Rückseite".into(), Some("Mathe".into()), None).unwrap();
        let stats = core.learning_stats(None, None, Some(60));
        assert_eq!(stats.n, 1);
        assert_eq!(stats.bestand.neu, 1);
        assert_eq!(stats.decks.len(), 1);
        assert_eq!(stats.decks[0].name, "Mathe");

        // Deck-Filter
        let bio_stats = core.learning_stats(Some("Bio".into()), None, Some(60));
        assert_eq!(bio_stats.n, 0);

        // Karte bewerten
        core.review_card(card_id, 3).unwrap();
        let after_review = core.learning_stats(None, None, Some(60));
        assert_eq!(after_review.reviews_all, 1);
        assert_eq!(after_review.bestand.neu, 0);
        assert_eq!(after_review.bestand.lernen, 1);

        // JSON-Export testen
        let json_str = core.learning_stats_json();
        let v: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        assert_eq!(v["cards"].as_array().unwrap().len(), 1);
        assert_eq!(v["reviews"].as_array().unwrap().len(), 1);
    }
}
