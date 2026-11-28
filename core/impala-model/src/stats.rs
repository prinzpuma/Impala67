//! Statistik-Kennzahlen (anki-stats.js `statsData`, telemetrie.js `retentionStats` und `thinkMedian`):
//! Bestand, Fällig, Reif, Serie, Trefferquote, Trend, Verlauf (30 Tage), Prognose (7 Tage),
//! Decks, Schwierigste Karten, Denkzeit-Median, Retention und Heatmap-Werte.

use std::collections::{HashMap, HashSet};

use impala_sort::SortExt;
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

fn rate_from_counts(graded: usize, passed: usize) -> Option<f64> {
    if graded >= MIN_N { Some(passed as f64 / graded as f64) } else { None }
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
        vals.sort_small_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
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
    sorted.sort_small_by(|a, b| a.t().cmp(b.t()));

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

    const RANGES: [(f64, f64); 4] = [(0.5, 2.0), (1.8, 4.8), (4.2, 11.2), (8.4, 22.4)];
    let mut counts = [(0usize, 0usize); 4];
    for row in &rows {
        if row.review.first.unwrap_or(false) || row.review.learning.unwrap_or(false) {
            continue;
        }
        let Some(g) = row.gap_days else { continue };
        let passed = usize::from(row.review.grade.unwrap_or(0.0) > 1.0);
        for (i, &(min, max)) in RANGES.iter().enumerate() {
            if g >= min && g <= max {
                counts[i].0 += 1;
                counts[i].1 += passed;
            }
        }
    }
    let to_bucket = |(n, passed): (usize, usize)| RetentionBucket {
        n,
        rate: if n > 0 { Some(passed as f64 / n as f64) } else { None },
    };

    RetentionStats {
        day1: to_bucket(counts[0]),
        day3: to_bucket(counts[1]),
        day7: to_bucket(counts[2]),
        day14: to_bucket(counts[3]),
    }
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
    let refs: Vec<&Card> = cards.iter().collect();
    compute_stats_refs(&refs, all_reviews, telemetry, options)
}

fn compute_stats_refs(
    cards: &[&Card],
    all_reviews: &[Review],
    telemetry: &[Telemetry],
    options: &StatsOptions,
) -> StatsData {
    let cards_by_id: HashMap<&str, &Card> = cards.iter().map(|&c| (c.id(), c)).collect();

    let filtered_cards: Vec<&Card> =
        cards.iter().copied().filter(|c| options.deck.is_none_or(|root| deck_in_tree(c.deck_name(), root))).collect();

    let now_ms = options.now.millis();
    let wochen_f = WOCHEN as f64;
    let two_wochen_f = (2 * WOCHEN) as f64;

    let mut reviews_all = 0usize;
    let mut last_count = 0usize;
    let mut last_graded = 0usize;
    let mut last_passed = 0usize;
    let mut before_graded = 0usize;
    let mut before_passed = 0usize;
    let mut deck_last_rate: HashMap<&str, (usize, usize)> = HashMap::new();
    let mut per_day: HashMap<String, usize> = HashMap::new();
    let mut filtered_review_ids: HashSet<&str> = HashSet::with_capacity(all_reviews.len());

    for r in all_reviews {
        let deck_opt = options.deck.map(|root| (root, review_deck(r, &cards_by_id)));
        if let Some((root, d)) = deck_opt
            && !deck_in_tree(d, root)
        {
            continue;
        }
        reviews_all += 1;
        if let Some(id) = r.id.as_deref() {
            filtered_review_ids.insert(id);
        }
        let parsed_t = Timestamp::parse_iso(r.t());
        if let Some(t) = parsed_t {
            let k = t.day_key(options.zone);
            *per_day.entry(k).or_default() += 1;
        }
        let t_ms = parsed_t.unwrap_or(options.now).millis();
        let ago = (now_ms - t_ms) as f64 / MS_PER_DAY as f64;
        let graded = r.grade.unwrap_or(0.0) > 0.0 && !r.first.unwrap_or(false) && !r.learning.unwrap_or(false);
        let passed = graded && r.grade.unwrap_or(0.0) > 1.0;

        if ago >= 0.0 && ago < wochen_f {
            last_count += 1;
            if graded {
                last_graded += 1;
                if passed {
                    last_passed += 1;
                }
                let d = deck_opt.map(|(_, d)| d).unwrap_or_else(|| review_deck(r, &cards_by_id));
                let entry = deck_last_rate.entry(d).or_default();
                entry.0 += 1;
                if passed {
                    entry.1 += 1;
                }
            }
        } else if ago >= wochen_f && ago < two_wochen_f && graded {
            before_graded += 1;
            if passed {
                before_passed += 1;
            }
        }
    }

    let rate = rate_from_counts(last_graded, last_passed);
    let rate_before = rate_from_counts(before_graded, before_passed);
    let trend = match (rate, rate_before) {
        (Some(r), Some(rb)) => Some(((r - rb) * 100.0).round() as i32),
        _ => None,
    };
    let avg = last_count as f64 / wochen_f;

    let end_day = options.now.local_days(options.zone);
    let mut forecast_bounds = [(0i64, 0i64); 7];
    for (i, slot) in forecast_bounds.iter_mut().enumerate() {
        let d0 = local_midnight(end_day + i as i64, options.zone);
        let d1 = local_midnight(end_day + i as i64 + 1, options.zone);
        *slot = (if i == 0 { 0 } else { d0 }, d1);
    }
    let mut forecast_counts = [0usize; 7];

    let mut bestand = Bestand { neu: 0, lernen: 0, wiederholen: 0, ausgesetzt: 0 };
    let mut faellig = 0;
    let mut reif = 0;
    let mut gelernt = 0;

    struct DeckAccum {
        n: usize,
        due: usize,
        reif: usize,
    }
    let mut deck_map: IndexMap<&str, DeckAccum> = IndexMap::new();
    let mut hard_candidates: Vec<(i64, usize)> = Vec::new();

    for (idx, &c) in filtered_cards.iter().enumerate() {
        let lapses = c.srs().and_then(|s| s.get("lapses")).and_then(Value::as_i64).unwrap_or(0);
        if lapses > 0 {
            hard_candidates.push((lapses, idx));
        }

        let entry = deck_map.entry(c.deck_name()).or_insert(DeckAccum { n: 0, due: 0, reif: 0 });
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
        if state == "review" && stability >= REIF_TAGE {
            reif += 1;
            entry.reif += 1;
        }
        if let Some(due) = card_due(c) {
            if due <= options.now {
                faellig += 1;
                entry.due += 1;
            }
            let ms = due.millis();
            for (i, &(from_ms, to_ms)) in forecast_bounds.iter().enumerate() {
                if ms >= from_ms && ms < to_ms {
                    forecast_counts[i] += 1;
                    break;
                }
            }
        }
    }

    let mut decks: Vec<DeckRow> = deck_map
        .into_iter()
        .map(|(name, row)| {
            let rate = deck_last_rate.get(name).and_then(|&(g, p)| rate_from_counts(g, p));
            DeckRow { name: name.to_owned(), n: row.n, due: row.due, reif: row.reif, rate }
        })
        .collect();
    decks.sort_small_by(|a, b| b.due.cmp(&a.due).then_with(|| a.name.cmp(&b.name)));

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

    let forecast: Vec<ForecastDay> =
        forecast_counts.into_iter().enumerate().map(|(day_offset, n)| ForecastDay { day_offset, n }).collect();

    let mut keys: Vec<&str> = per_day.keys().map(String::as_str).collect();
    keys.sort_small();
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

    hard_candidates.sort_small_by_key(|&(lapses, _)| std::cmp::Reverse(lapses));
    hard_candidates.truncate(5);
    let hard_cards: Vec<HardCard> = hard_candidates
        .into_iter()
        .map(|(lapses, idx)| {
            let c = filtered_cards[idx];
            let stability = c.srs().and_then(|s| s.get("stability")).and_then(Value::as_f64).unwrap_or(0.0);
            let front = c.extra.get("front").and_then(Value::as_str).unwrap_or("").to_string();
            HardCard { id: c.id().to_string(), front, deck: c.deck_name().to_string(), lapses, stability }
        })
        .collect();

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
        reviews_all,
        last: last_count,
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
        compute_stats_refs(&active, &self.reviews, &self.telemetry, options)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Deck;
    use serde_json::json;
    use std::time::Instant;

    #[test]
    fn learning_stats_leistung_und_konsistenz() {
        let mut st = State::default();
        let mut deck_names = Vec::new();
        for f in 0..8 {
            let root = format!("Fach{f}");
            deck_names.push(root.clone());
            st.decks.insert(root.clone(), Deck::new(&root, "2026-01-01T00:00:00Z"));
            for s in 0..9 {
                let sub = format!("{root}::Kap{s}");
                deck_names.push(sub.clone());
                st.decks.insert(sub.clone(), Deck::new(&sub, "2026-01-01T00:00:00Z"));
            }
        }
        let now = Timestamp::parse_iso("2026-11-04T12:00:00Z").unwrap();
        let states = ["review", "new", "learning", "relearning"];
        for i in 0..4000usize {
            let id = format!("c{i}");
            let deck = &deck_names[i % deck_names.len()];
            let due_ms = now.millis() + ((i as i64 % 14) - 4) * MS_PER_DAY;
            let mut c = Card {
                id: Some(id.clone()),
                deck: Some(deck.clone()),
                suspended: (i % 19 == 0).then_some(true),
                ..Default::default()
            };
            c.extra.insert("front".into(), json!(format!("Frage Nummer {i}")));
            c.extra.insert(
                "srs".into(),
                json!({
                    "state": states[i % states.len()],
                    "due": Timestamp(due_ms).to_iso(),
                    "stability": (i % 40) as f64,
                    "lapses": (i % 9) as i64
                }),
            );
            st.cards.insert(id, c);
        }
        for i in 0..5000usize {
            let deck = &deck_names[i % deck_names.len()];
            let t_ms = now.millis() - ((i as i64 % 90) * MS_PER_DAY) - 3_600_000;
            st.reviews.push(Review {
                id: Some(format!("r{i}")),
                card_id: Some(format!("c{}", i % 4000)),
                deck: Some(deck.clone()),
                t: Some(Timestamp(t_ms).to_iso()),
                grade: Some(((i % 4) + 1) as f64),
                first: (i % 7 == 0).then_some(true),
                learning: (i % 11 == 0).then_some(true),
                interval_days: Some([1.0, 3.0, 7.0, 14.0][i % 4]),
                ..Default::default()
            });
        }
        let zone = 60i64;
        let opts = StatsOptions { deck: None, now, zone: &zone, think_ms: None };
        let res = st.learning_stats(&opts);
        assert_eq!(res.n, 4000);
        assert_eq!(res.reviews_all, 5000);
        assert_eq!(res.decks.len(), deck_names.len());
        assert_eq!(res.hard.len(), 5);
        assert_eq!(res.forecast.len(), 7);

        let t0 = Instant::now();
        let mut checksum = 0usize;
        for _ in 0..10 {
            let s = st.learning_stats(&opts);
            checksum += s.faellig + s.reif + s.last + s.forecast.iter().map(|f| f.n).sum::<usize>();
        }
        let elapsed_ms = t0.elapsed().as_secs_f64() * 1000.0;
        assert!(checksum > 0);
        eprintln!(
            "learning_stats (80 decks, 4000 cards, 5000 reviews): 10 runs = {elapsed_ms:.2} ms ({:.2} ms/run)",
            elapsed_ms / 10.0
        );
    }
}
