//! Statistik-Kennzahlen (anki-stats.js `statsData`, telemetrie.js `retentionStats` und `thinkMedian`):
//! Bestand, Fällig, Reif, Serie, Trefferquote, Trend, Verlauf (30 Tage), Prognose (7 Tage),
//! Decks, Schwierigste Karten, Denkzeit-Median, Retention und Heatmap-Werte.

use std::collections::{HashMap, HashSet};

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use impala_srs::{LocalZone, MS_PER_DAY, Timestamp, civil_from_days, days_from_civil, local_midnight};

use crate::tree::deck_in_tree;
use crate::types::{Card, Review, State, Telemetry};

pub const MIN_N: usize = 10;
pub const REIF_TAGE: f64 = 21.0;
pub const WOCHEN: i64 = 30;

#[derive(Clone, Copy)]
pub struct StatsOptions<'a> {
    pub deck: Option<&'a str>,
    pub now: Timestamp,
    /// Ortszeit für Tagesgrenzen (Verlauf, Prognose, Serie).
    pub zone: &'a dyn LocalZone,
    pub think_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bestand {
    pub neu: usize,
    pub lernen: usize,
    pub wiederholen: usize,
    pub ausgesetzt: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckRow {
    pub name: String,
    pub n: usize,
    pub due: usize,
    pub reif: usize,
    pub rate: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesDay {
    pub date: String,
    pub n: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeakDay {
    pub date: String,
    pub n: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForecastDay {
    pub day_offset: usize,
    pub n: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HardCard {
    pub id: String,
    pub front: String,
    pub deck: String,
    pub lapses: i64,
    pub stability: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetentionBucket {
    pub n: usize,
    pub rate: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetentionStats {
    pub day1: RetentionBucket,
    pub day3: RetentionBucket,
    pub day7: RetentionBucket,
    pub day14: RetentionBucket,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeatmapCell {
    pub date: String,
    pub n: usize,
    pub level: u8,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsData {
    pub reviews_all: usize,
    pub last: usize,
    pub rate: Option<f64>,
    pub trend: Option<i32>,
    pub avg: f64,
    pub bestand: Bestand,
    pub n: usize,
    pub faellig: usize,
    pub reif: usize,
    pub gelernt: usize,
    pub decks: Vec<DeckRow>,
    pub series: Vec<SeriesDay>,
    pub peak: PeakDay,
    pub forecast: Vec<ForecastDay>,
    pub streak_current: usize,
    pub streak_longest: usize,
    pub hard: Vec<HardCard>,
    pub think_ms: i64,
    pub retention: RetentionStats,
    pub heatmap: Vec<HeatmapCell>,
    pub per_day: HashMap<String, usize>,
}

fn card_due(card: &Card) -> Option<Timestamp> {
    let due = card.srs()?.get("due")?;
    match due {
        Value::String(s) => Timestamp::parse_iso(s),
        Value::Number(n) => n.as_i64().map(Timestamp),
        _ => None,
    }
}

fn review_deck<'a>(r: &'a Review, cards_by_id: &HashMap<&str, &'a Card>) -> &'a str {
    if let Some(d) = r.deck.as_deref().filter(|d| !d.is_empty()) {
        d
    } else if let Some(card_id) = r.card_id.as_deref() {
        cards_by_id.get(card_id).map(|c| c.deck_name()).unwrap_or("Standard")
    } else {
        "Standard"
    }
}

fn hit_rate(reviews: &[&Review]) -> Option<f64> {
    let graded: Vec<_> = reviews
        .iter()
        .filter(|r| r.grade.unwrap_or(0.0) > 0.0 && !r.first.unwrap_or(false) && !r.learning.unwrap_or(false))
        .collect();
    if graded.len() >= MIN_N {
        let passed = graded.iter().filter(|r| r.grade.unwrap_or(0.0) > 1.0).count();
        Some(passed as f64 / graded.len() as f64)
    } else {
        None
    }
}

fn review_events(telemetry: &[Telemetry]) -> Vec<&Value> {
    let mut out = Vec::new();
    for e in telemetry {
        let Some(data) = e.extra.get("data") else { continue };
        let kind = e.kind.as_deref().unwrap_or("");
        if kind == "review" {
            let grade = data.get("grade").and_then(Value::as_f64).unwrap_or(0.0);
            if grade > 0.0 {
                out.push(data);
            }
        } else if kind == "reviewUndo" {
            let undo_id = data.get("reviewId").and_then(Value::as_str);
            let idx = if let Some(target_id) = undo_id {
                out.iter().position(|item| item.get("reviewId").and_then(Value::as_str) == Some(target_id))
            } else {
                out.len().checked_sub(1)
            };
            if let Some(i) = idx {
                out.remove(i);
            }
        }
    }
    out
}

pub fn compute_think_median(telemetry: &[Telemetry]) -> i64 {
    let rs = review_events(telemetry);
    let mut vals = Vec::new();
    for data in rs.iter().rev() {
        if vals.len() >= 300 {
            break;
        }
        if data.get("typed").and_then(Value::as_bool).unwrap_or(false) {
            continue;
        }
        if let Some(ms) =
            data.get("thinkMs").and_then(Value::as_f64).filter(|ms| ms.is_finite() && *ms > 400.0 && *ms < 120_000.0)
        {
            vals.push(ms);
        }
    }
    if vals.len() >= 12 {
        vals.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let m = vals.len() / 2;
        let med = if vals.len() % 2 == 1 { vals[m] } else { (vals[m - 1] + vals[m]) / 2.0 };
        med.round() as i64
    } else {
        0
    }
}

struct ReviewRow<'a> {
    review: &'a Review,
    gap_days: Option<f64>,
}

pub fn compute_retention(all_reviews: &[Review], filtered_review_ids: &HashSet<&str>) -> RetentionStats {
    let mut sorted: Vec<&Review> = all_reviews.iter().filter(|r| r.grade.unwrap_or(0.0) > 0.0).collect();
    sorted.sort_by(|a, b| a.t().cmp(b.t()));

    let mut previous: HashMap<&str, i64> = HashMap::new();
    let mut rows: Vec<ReviewRow> = Vec::with_capacity(sorted.len());

    for r in sorted {
        let card_id = r.card_id.as_deref().unwrap_or("");
        let prev_at = previous.get(card_id).copied();
        let at = Timestamp::parse_iso(r.t()).map(|t| t.millis()).unwrap_or(0);
        let stored_gap = r.interval_days;
        let gap_days = match stored_gap {
            Some(gap) if gap.is_finite() && gap >= 0.0 => Some(gap),
            _ => prev_at.map(|prev| ((at - prev) as f64 / MS_PER_DAY as f64).max(0.0)),
        };
        previous.insert(card_id, at);
        if r.id.as_deref().is_some_and(|id| filtered_review_ids.contains(id)) {
            rows.push(ReviewRow { review: r, gap_days });
        }
    }

    let bucket = |target_days: f64| -> RetentionBucket {
        let min = if target_days == 1.0 { 0.5 } else { target_days * 0.6 };
        let max = if target_days == 1.0 { 2.0 } else { target_days * 1.6 };
        let eligible: Vec<_> = rows
            .iter()
            .filter(|row| {
                !row.review.first.unwrap_or(false)
                    && !row.review.learning.unwrap_or(false)
                    && row.gap_days.is_some_and(|g| g >= min && g <= max)
            })
            .collect();
        let n = eligible.len();
        let rate = if n > 0 {
            let passed = eligible.iter().filter(|row| row.review.grade.unwrap_or(0.0) > 1.0).count();
            Some(passed as f64 / n as f64)
        } else {
            None
        };
        RetentionBucket { n, rate }
    };

    RetentionStats { day1: bucket(1.0), day3: bucket(3.0), day7: bucket(7.0), day14: bucket(14.0) }
}

fn parse_date_parts(k: &str) -> Option<(i64, i64, i64)> {
    let mut parts = k.split('-');
    let y = parts.next()?.parse().ok()?;
    let m = parts.next()?.parse().ok()?;
    let d = parts.next()?.parse().ok()?;
    if parts.next().is_none() { Some((y, m, d)) } else { None }
}

pub fn compute_stats(
    cards: &[Card],
    all_reviews: &[Review],
    telemetry: &[Telemetry],
    options: &StatsOptions,
) -> StatsData {
    let cards_by_id: HashMap<&str, &Card> = cards.iter().map(|c| (c.id(), c)).collect();

    let filtered_cards: Vec<&Card> =
        cards.iter().filter(|c| options.deck.is_none_or(|root| deck_in_tree(c.deck_name(), root))).collect();

    let filtered_reviews: Vec<&Review> = all_reviews
        .iter()
        .filter(|r| {
            options.deck.is_none_or(|root| {
                let d = review_deck(r, &cards_by_id);
                deck_in_tree(d, root)
            })
        })
        .collect();

    let filtered_review_ids: HashSet<&str> = filtered_reviews.iter().filter_map(|r| r.id.as_deref()).collect();

    let ago_days = |r: &Review| -> f64 {
        let t = Timestamp::parse_iso(r.t()).unwrap_or(options.now);
        (options.now.millis() - t.millis()) as f64 / MS_PER_DAY as f64
    };

    let last_reviews: Vec<&Review> = filtered_reviews
        .iter()
        .copied()
        .filter(|r| {
            let a = ago_days(r);
            a >= 0.0 && a < WOCHEN as f64
        })
        .collect();

    let before_reviews: Vec<&Review> = filtered_reviews
        .iter()
        .copied()
        .filter(|r| {
            let a = ago_days(r);
            a >= WOCHEN as f64 && a < (2 * WOCHEN) as f64
        })
        .collect();

    let rate = hit_rate(&last_reviews);
    let rate_before = hit_rate(&before_reviews);
    let trend = match (rate, rate_before) {
        (Some(r), Some(rb)) => Some(((r - rb) * 100.0).round() as i32),
        _ => None,
    };
    let avg = last_reviews.len() as f64 / WOCHEN as f64;

    let mut bestand = Bestand { neu: 0, lernen: 0, wiederholen: 0, ausgesetzt: 0 };
    let mut faellig = 0;
    let mut reif = 0;
    let mut gelernt = 0;

    struct DeckAccum {
        name: String,
        n: usize,
        due: usize,
        reif: usize,
    }
    let mut deck_map: IndexMap<String, DeckAccum> = IndexMap::new();

    for c in &filtered_cards {
        let name = c.deck_name().to_string();
        let entry = deck_map.entry(name.clone()).or_insert_with(|| DeckAccum { name, n: 0, due: 0, reif: 0 });
        entry.n += 1;
        if c.is_suspended() {
            bestand.ausgesetzt += 1;
            continue;
        }
        let state = c.srs_state().unwrap_or("new");
        if state == "new" {
            bestand.neu += 1;
        } else if state == "review" {
            bestand.wiederholen += 1;
            gelernt += 1;
        } else {
            bestand.lernen += 1;
        }

        let stability = c.srs().and_then(|s| s.get("stability")).and_then(Value::as_f64).unwrap_or(0.0);
        let ist_reif = state == "review" && stability >= REIF_TAGE;
        if ist_reif {
            reif += 1;
            entry.reif += 1;
        }
        if card_due(c).is_some_and(|due| due <= options.now) {
            faellig += 1;
            entry.due += 1;
        }
    }

    let mut decks: Vec<DeckRow> = deck_map
        .into_values()
        .map(|row| {
            let deck_last: Vec<&Review> =
                last_reviews.iter().copied().filter(|r| review_deck(r, &cards_by_id) == row.name).collect();
            let rate = hit_rate(&deck_last);
            DeckRow { name: row.name, n: row.n, due: row.due, reif: row.reif, rate }
        })
        .collect();
    decks.sort_by(|a, b| b.due.cmp(&a.due).then_with(|| a.name.cmp(&b.name)));

    let mut per_day: HashMap<String, usize> = HashMap::new();
    for r in &filtered_reviews {
        if let Some(t) = Timestamp::parse_iso(r.t()) {
            let k = t.day_key(options.zone);
            *per_day.entry(k).or_default() += 1;
        }
    }

    let end_day = options.now.local_days(options.zone);
    let mut series = Vec::with_capacity(WOCHEN as usize);
    for i in (0..WOCHEN).rev() {
        let day = end_day - i;
        let (y, m, d) = civil_from_days(day);
        let date = format!("{y:04}-{m:02}-{d:02}");
        let n = per_day.get(&date).copied().unwrap_or(0);
        series.push(SeriesDay { date, n });
    }
    let mut peak = PeakDay { date: String::new(), n: 0 };
    for s in &series {
        if s.n > peak.n {
            peak = PeakDay { date: s.date.clone(), n: s.n };
        }
    }

    let mut forecast = Vec::with_capacity(7);
    for i in 0..7 {
        let d0_ms = local_midnight(end_day + i, options.zone);
        let d1_ms = local_midnight(end_day + i + 1, options.zone);
        let from_ms = if i == 0 { 0 } else { d0_ms };
        let n = filtered_cards
            .iter()
            .filter(|c| {
                if c.is_suspended() {
                    return false;
                }
                if let Some(due) = card_due(c) {
                    let ms = due.millis();
                    ms >= from_ms && ms < d1_ms
                } else {
                    false
                }
            })
            .count();
        forecast.push(ForecastDay { day_offset: i as usize, n });
    }

    let mut keys: Vec<String> = per_day.keys().cloned().collect();
    keys.sort();
    let mut streak_longest = 0;
    let mut run = 0;
    let mut prev_day: Option<i64> = None;
    for k in &keys {
        if let Some((y, m, d)) = parse_date_parts(k) {
            let day = days_from_civil(y, m, d);
            run = if prev_day.is_some_and(|p| day - p == 1) { run + 1 } else { 1 };
            streak_longest = streak_longest.max(run);
            prev_day = Some(day);
        }
    }

    let mut check_day = end_day;
    let (y, m, d) = civil_from_days(check_day);
    let today_key = format!("{y:04}-{m:02}-{d:02}");
    if !per_day.contains_key(&today_key) {
        check_day -= 1;
    }
    let mut streak_current = 0;
    loop {
        let (y, m, d) = civil_from_days(check_day);
        let k = format!("{y:04}-{m:02}-{d:02}");
        if per_day.contains_key(&k) {
            streak_current += 1;
            check_day -= 1;
        } else {
            break;
        }
    }

    let mut hard_cards: Vec<HardCard> = filtered_cards
        .iter()
        .filter_map(|c| {
            let lapses = c.srs().and_then(|s| s.get("lapses")).and_then(Value::as_i64).unwrap_or(0);
            if lapses > 0 {
                let stability = c.srs().and_then(|s| s.get("stability")).and_then(Value::as_f64).unwrap_or(0.0);
                let front = c.extra.get("front").and_then(Value::as_str).unwrap_or("").to_string();
                Some(HardCard { id: c.id().to_string(), front, deck: c.deck_name().to_string(), lapses, stability })
            } else {
                None
            }
        })
        .collect();
    hard_cards.sort_by_key(|a| std::cmp::Reverse(a.lapses));
    hard_cards.truncate(5);

    let think_ms = options.think_ms.unwrap_or_else(|| compute_think_median(telemetry));

    let retention = compute_retention(all_reviews, &filtered_review_ids);

    let dow = (end_day + 3).rem_euclid(7);
    let start_day = end_day - 364 - dow;
    let mut heatmap = Vec::with_capacity((end_day - start_day + 1) as usize);
    for day in start_day..=end_day {
        let (y, m, d) = civil_from_days(day);
        let date = format!("{y:04}-{m:02}-{d:02}");
        let n = per_day.get(&date).copied().unwrap_or(0);
        let level = match n {
            0 => 0,
            1..=4 => 1,
            5..=14 => 2,
            15..=29 => 3,
            _ => 4,
        };
        heatmap.push(HeatmapCell { date, n, level });
    }

    StatsData {
        reviews_all: filtered_reviews.len(),
        last: last_reviews.len(),
        rate,
        trend,
        avg,
        bestand,
        n: filtered_cards.len(),
        faellig,
        reif,
        gelernt,
        decks,
        series,
        peak,
        forecast,
        streak_current,
        streak_longest,
        hard: hard_cards,
        think_ms,
        retention,
        heatmap,
        per_day,
    }
}

impl State {
    pub fn learning_stats(&self, options: &StatsOptions) -> StatsData {
        let active = self.active_cards();
        let cards: Vec<Card> = active.into_iter().cloned().collect();
        compute_stats(&cards, &self.reviews, &self.telemetry, options)
    }

    pub fn think_median(&self) -> i64 {
        compute_think_median(&self.telemetry)
    }

    pub fn retention_stats(&self, review_ids: Option<&[&str]>) -> RetentionStats {
        let set: HashSet<&str> = match review_ids {
            Some(ids) => ids.iter().copied().collect(),
            None => self.reviews.iter().filter_map(|r| r.id.as_deref()).collect(),
        };
        compute_retention(&self.reviews, &set)
    }
}
