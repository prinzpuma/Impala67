//! Auswertung für Lernanalyse (Startseite) und Lernmuster (Statistik-Tab).
//!
//! Entspricht `web/lernanalyse.js`, `web/lernmuster.js` und `AnalysisData.kt` in Android.
//! Der Kern liefert getypte Rohdaten (Zahlen, Quoten, Buckets) und Standard-Texte.

use std::collections::{HashMap, HashSet};

use impala_sort::SortExt;
use impala_srs::{LocalZone, Timestamp, local_midnight};
use serde::{Deserialize, Serialize};

use crate::types::{Card, Review, State, Telemetry};

pub const MIN_SUBJECT_REVIEWS: usize = 15;
pub const MIN_SLOT_REVIEWS: usize = 20;

pub const DAY_SHORT: [&str; 7] = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
pub const DAY_LONG: [&str; 7] = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

/// Formatiert Minuten im Stil der App („45 Min“, „1 h“, „1 h 30“).
pub fn dur(minutes: f64) -> String {
    if !minutes.is_finite() || minutes <= 0.0 {
        return "0 Min".to_string();
    }
    let m0 = minutes.round() as i64;
    let h = m0 / 60;
    let m = m0 % 60;
    if h > 0 { if m > 0 { format!("{h} h {m}") } else { format!("{h} h") } } else { format!("{m} Min") }
}

// ── 1) Wochenziel & Tempo ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GoalAnalysis {
    pub goal_min: u32,
    pub days: Vec<f64>,
    pub done: f64,
    pub today: u8,
    pub pace: f64,
    pub need: f64,
    pub left: u8,
    pub text: String,
    pub tone: String,
    pub warn: bool,
    pub reach_day: Option<u8>,
}

pub fn compute_goal(goal_min: u32, days: &[f64], today: u8, pace: f64) -> GoalAnalysis {
    let days_vec = days.to_vec();
    let done: f64 = days.iter().sum();
    let today = today.min(6);
    let left = 7 - today;
    let pace = if pace.is_finite() && pace > 0.0 { pace } else { 0.0 };
    let need = if done >= goal_min as f64 || (goal_min as f64 - done).abs() < 1e-6 {
        0.0
    } else {
        (goal_min as f64 - done).max(0.0)
    };
    let mut warn = false;
    let mut reach_day = None;
    let text = if need == 0.0 {
        format!("Geschafft: {} von {}.", dur(done), dur(goal_min as f64))
    } else if pace > 0.0 && pace * (left as f64) >= need {
        let r = (today as usize + (need / pace).ceil() as usize - 1).min(6) as u8;
        reach_day = Some(r);
        let day_str = if r == today { "heute".to_string() } else { format!("am {}", DAY_LONG[r as usize]) };
        format!("Bei deinem Tempo schaffst du es {day_str}.")
    } else {
        warn = true;
        let per_day = need / (left as f64);
        format!("Es fehlen noch {}, also etwa {} pro Tag.", dur(need), dur(per_day))
    };
    GoalAnalysis {
        goal_min,
        days: days_vec,
        done,
        today,
        pace,
        need,
        left,
        text,
        tone: if warn { "warn".to_string() } else { "ok".to_string() },
        warn,
        reach_day,
    }
}

// ── 2) Fächer-Trend ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SubjectRow {
    pub subject: String,
    pub now: f64,
    pub before: f64,
    pub delta: i32,
    pub deck: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SubjectsAnalysis {
    pub rows: Vec<SubjectRow>,
    pub worst: Option<SubjectRow>,
    pub text: String,
    pub tone: String,
}

fn review_subject(r: &Review) -> &str {
    if let Some(s) = r.subject.as_deref().filter(|s| !s.trim().is_empty()) {
        s.trim()
    } else {
        r.deck.as_deref().unwrap_or("Standard").split("::").next().unwrap_or("Standard")
    }
}

fn review_root_deck(r: &Review) -> &str {
    r.deck.as_deref().unwrap_or("Standard").split("::").next().unwrap_or("Standard")
}

#[derive(Default)]
struct SubjectBucket<'a> {
    total: usize,
    pass: usize,
    decks: HashMap<&'a str, usize>,
}

fn finish_subjects(cur: HashMap<&str, SubjectBucket<'_>>, prev: HashMap<&str, SubjectBucket<'_>>) -> SubjectsAnalysis {
    let mut rows: Vec<SubjectRow> = Vec::new();
    for (subj, c) in &cur {
        let Some(p) = prev.get(subj) else {
            continue;
        };
        if c.total < MIN_SUBJECT_REVIEWS || p.total < MIN_SUBJECT_REVIEWS {
            continue;
        }
        let now_rate = c.pass as f64 / c.total as f64;
        let before_rate = p.pass as f64 / p.total as f64;
        let delta = (now_rate * 100.0).round() as i32 - (before_rate * 100.0).round() as i32;

        let deck = c
            .decks
            .iter()
            .max_by(|a, b| a.1.cmp(b.1).then_with(|| b.0.cmp(a.0)))
            .map(|(d, _)| (*d).to_owned())
            .unwrap_or_else(|| (*subj).to_owned());

        rows.push(SubjectRow { subject: (*subj).to_owned(), now: now_rate, before: before_rate, delta, deck });
    }

    rows.sort_small_by(|a, b| a.delta.cmp(&b.delta).then_with(|| a.subject.cmp(&b.subject)));
    let worst = rows.iter().find(|r| r.delta <= -8).cloned();
    let text = if rows.is_empty() {
        format!(
            "Noch zu wenig Daten: Pro Fach braucht es {} Wiederholungen in zwei Wochen hintereinander.",
            MIN_SUBJECT_REVIEWS
        )
    } else if let Some(w) = &worst {
        format!(
            "{} lässt nach: {} % richtig, vorher {} %.",
            w.subject,
            (w.now * 100.0).round() as i32,
            (w.before * 100.0).round() as i32
        )
    } else {
        "Kein Fach lässt nach. Alle halten ihr Niveau.".to_string()
    };
    let tone = if worst.is_some() { "warn".to_string() } else { "ok".to_string() };
    if rows.len() > 5 {
        rows.truncate(5);
    }

    SubjectsAnalysis { rows, worst, text, tone }
}

pub fn compute_subjects(reviews: &[Review], now_ms: i64) -> SubjectsAnalysis {
    let d14 = 14 * 86_400_000i64;
    let cur_start = now_ms - d14;
    let prev_start = now_ms - 2 * d14;
    let mut cur: HashMap<&str, SubjectBucket<'_>> = HashMap::new();
    let mut prev: HashMap<&str, SubjectBucket<'_>> = HashMap::new();

    for r in reviews {
        let grade = r.grade.unwrap_or(0.0);
        if grade <= 0.0 {
            continue;
        }
        let Some(ts) = Timestamp::parse_iso(r.t()) else {
            continue;
        };
        let t = ts.millis();
        if t < prev_start || t > now_ms {
            continue;
        }
        let subj = review_subject(r);
        let pass = usize::from(grade > 1.0);

        if t >= cur_start {
            let b = cur.entry(subj).or_default();
            b.total += 1;
            b.pass += pass;
            *b.decks.entry(review_root_deck(r)).or_default() += 1;
        } else {
            let b = prev.entry(subj).or_default();
            b.total += 1;
            b.pass += pass;
        }
    }

    finish_subjects(cur, prev)
}

// ── 3) Beste Lernzeit ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimeSlot {
    pub label: String,
    pub hint: String,
    pub n: u32,
    pub rate: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BestTimeAnalysis {
    pub slots: Vec<TimeSlot>,
    pub best: Option<TimeSlot>,
    pub text: String,
    pub tone: String,
}

fn finish_best_time(n: [u32; 4], ok: [u32; 4]) -> BestTimeAnalysis {
    let slot_meta =
        [("Morgens", "5–12 Uhr"), ("Mittags", "12–17 Uhr"), ("Abends", "17–22 Uhr"), ("Nachts", "22–5 Uhr")];

    let slots: Vec<TimeSlot> = slot_meta
        .iter()
        .enumerate()
        .map(|(i, def)| TimeSlot {
            label: def.0.to_string(),
            hint: def.1.to_string(),
            n: n[i],
            rate: if n[i] > 0 { Some(ok[i] as f64 / n[i] as f64) } else { None },
        })
        .collect();

    let mut valid: Vec<&TimeSlot> = slots.iter().filter(|s| s.n >= MIN_SLOT_REVIEWS as u32).collect();
    valid.sort_small_by(|a, b| {
        b.rate.unwrap_or(0.0).partial_cmp(&a.rate.unwrap_or(0.0)).unwrap_or(std::cmp::Ordering::Equal)
    });

    let (best, text) = if let [first, .., last] = valid.as_slice()
        && let (Some(r_first), Some(r_last)) = (first.rate, last.rate)
    {
        let first_pct = (r_first * 100.0).round() as i32;
        let last_pct = (r_last * 100.0).round() as i32;
        if first_pct - last_pct >= 5 {
            let text = format!(
                "{} bist du am stärksten: {} % richtig, {} nur {} %.",
                first.label,
                first_pct,
                last.label.to_lowercase(),
                last_pct
            );
            (Some((*first).clone()), text)
        } else {
            (None, "Die Tageszeit macht bei dir kaum einen Unterschied.".to_string())
        }
    } else {
        (None, format!("Noch zu wenig Daten: Es braucht je {} Wiederholungen zu zwei Tageszeiten.", MIN_SLOT_REVIEWS))
    };

    BestTimeAnalysis { slots, best, text, tone: "ok".to_string() }
}

pub fn compute_best_time(reviews: &[Review], now_ms: i64, zone: &dyn LocalZone) -> BestTimeAnalysis {
    let cut = now_ms - 56 * 86_400_000i64;
    let mut n = [0u32; 4];
    let mut ok = [0u32; 4];

    for r in reviews {
        let grade = r.grade.unwrap_or(0.0);
        if grade <= 0.0 {
            continue;
        }
        let Some(ts) = Timestamp::parse_iso(r.t()) else {
            continue;
        };
        if ts.millis() < cut {
            continue;
        }
        let hour = (ts.local_millis(zone).rem_euclid(86_400_000) / 3_600_000) as u8;
        let slot_idx = match hour {
            5..12 => 0,
            12..17 => 1,
            17..22 => 2,
            _ => 3,
        };
        n[slot_idx] += 1;
        if grade > 1.0 {
            ok[slot_idx] += 1;
        }
    }

    finish_best_time(n, ok)
}

/// Fächer-Trend und beste Lernzeit in einem Durchlauf (einmaliges ISO-Parsen je Review).
fn compute_subjects_and_best_time(
    reviews: &[Review],
    now_ms: i64,
    zone: &dyn LocalZone,
) -> (SubjectsAnalysis, BestTimeAnalysis) {
    let d14 = 14 * 86_400_000i64;
    let cur_start = now_ms - d14;
    let prev_start = now_ms - 2 * d14;
    let time_cut = now_ms - 56 * 86_400_000i64;

    let mut cur: HashMap<&str, SubjectBucket<'_>> = HashMap::new();
    let mut prev: HashMap<&str, SubjectBucket<'_>> = HashMap::new();
    let mut n = [0u32; 4];
    let mut ok = [0u32; 4];

    for r in reviews {
        let grade = r.grade.unwrap_or(0.0);
        if grade <= 0.0 {
            continue;
        }
        let Some(ts) = Timestamp::parse_iso(r.t()) else {
            continue;
        };
        let t = ts.millis();
        if t < time_cut {
            continue;
        }
        let passed = grade > 1.0;
        let hour = (ts.local_millis(zone).rem_euclid(86_400_000) / 3_600_000) as u8;
        let slot_idx = match hour {
            5..12 => 0,
            12..17 => 1,
            17..22 => 2,
            _ => 3,
        };
        n[slot_idx] += 1;
        if passed {
            ok[slot_idx] += 1;
        }

        if t >= prev_start && t <= now_ms {
            let subj = review_subject(r);
            let pass = usize::from(passed);
            if t >= cur_start {
                let b = cur.entry(subj).or_default();
                b.total += 1;
                b.pass += pass;
                *b.decks.entry(review_root_deck(r)).or_default() += 1;
            } else {
                let b = prev.entry(subj).or_default();
                b.total += 1;
                b.pass += pass;
            }
        }
    }

    (finish_subjects(cur, prev), finish_best_time(n, ok))
}

// ── 4) Fälligkeiten der nächsten 7 Tage ──────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ForecastAnalysis {
    pub counts: Vec<u32>,
    pub labels: Vec<String>,
    pub peak: Option<usize>,
    pub text: String,
    pub tone: String,
}

pub fn compute_forecast(active_cards: &[&Card], now_ms: i64, zone: &dyn LocalZone, today: u8) -> ForecastAnalysis {
    let local_days = Timestamp(now_ms).local_days(zone);

    // Tagesgrenzen (00:00 Uhr lokaler Zeit der nächsten 7 Tage in UTC)
    let ends: [i64; 7] = std::array::from_fn(|i| local_midnight(local_days + (i as i64) + 1, zone));

    let mut counts = [0u32; 7];
    for c in active_cards {
        if c.is_suspended() || c.srs_state() == Some("new") {
            continue;
        }
        let Some(due_str) = c.srs_due() else {
            continue;
        };
        let Some(due_ts) = Timestamp::parse_iso(due_str) else {
            continue;
        };
        let due_ms = due_ts.millis();
        if let Some(i) = ends.iter().position(|&end| due_ms < end) {
            counts[i] += 1;
        }
    }

    let avg = counts.iter().sum::<u32>() as f64 / 7.0;
    let mut peak = None;
    for i in 1..7 {
        if counts[i] >= 30 && (counts[i] as f64) >= 1.8 * avg.max(1.0) && peak.is_none_or(|p| counts[i] > counts[p]) {
            peak = Some(i);
        }
    }

    let labels: Vec<String> = (0..7)
        .map(|i| if i == 0 { "Heute".to_string() } else { DAY_SHORT[((today as usize) + i) % 7].to_string() })
        .collect();

    let total: u32 = counts.iter().sum();
    let text = if total == 0 {
        "In den nächsten 7 Tagen wird nichts fällig.".to_string()
    } else if let Some(p) = peak {
        let name = if p == 1 { "Morgen".to_string() } else { format!("Am {}", DAY_LONG[((today as usize) + p) % 7]) };
        format!("{name} werden {} Karten fällig. Heute ein paar vorzuziehen entzerrt das.", counts[p])
    } else {
        format!("Ruhige Woche: im Schnitt {} Karten pro Tag.", avg.round() as i32)
    };

    let tone = if peak.is_some() { "warn".to_string() } else { "ok".to_string() };

    ForecastAnalysis { counts: counts.to_vec(), labels, peak, text, tone }
}

// ── Gesamt-Lernanalyse ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HomeAnalysis {
    pub goal: GoalAnalysis,
    pub subjects: SubjectsAnalysis,
    pub time: BestTimeAnalysis,
    pub forecast: ForecastAnalysis,
    pub headline: String,
    pub action: Option<String>,
    pub action_deck: Option<String>,
}

impl State {
    pub fn has_learned(&self) -> bool {
        self.reviews.iter().any(|r| r.grade.unwrap_or(0.0) > 0.0)
            || self
                .learning_sessions
                .values()
                .any(|s| !s.deleted.unwrap_or(false) && s.duration_seconds.unwrap_or(0.0) > 0.0)
    }

    pub fn home_analysis(
        &self,
        now_ms: i64,
        zone: &dyn LocalZone,
        goal_min: u32,
        days: &[f64],
        pace: f64,
    ) -> Option<HomeAnalysis> {
        if !self.has_learned() {
            return None;
        }

        let today = ((Timestamp(now_ms).local_days(zone) + 3).rem_euclid(7)) as u8;

        let goal = compute_goal(goal_min, days, today, pace);
        let (subjects, time) = compute_subjects_and_best_time(&self.reviews, now_ms, zone);
        let forecast = compute_forecast(&self.active_cards(), now_ms, zone, today);

        let (headline, action, action_deck) = if let Some(worst) = &subjects.worst {
            (subjects.text.clone(), Some(format!("{} lernen", worst.subject)), Some(worst.deck.clone()))
        } else if forecast.peak.is_some() {
            (forecast.text.clone(), Some("Jetzt lernen".to_string()), None)
        } else if goal.warn && goal.today >= 2 {
            (format!("Wochenziel: {}", goal.text), Some("Jetzt lernen".to_string()), None)
        } else if goal.need == 0.0 || goal.reach_day.is_some() {
            (format!("Wochenziel: {}", goal.text), None, None)
        } else if time.best.is_some() {
            (time.text.clone(), None, None)
        } else {
            ("Sobald du ein paar Tage gelernt hast, steht hier, was gut läuft und wo es hakt.".to_string(), None, None)
        };

        Some(HomeAnalysis { goal, subjects, time, forecast, headline, action, action_deck })
    }
}

// ── 5) Lernmuster (Statistik-Tab) ───────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RateRow {
    pub label: String,
    pub n: u32,
    pub rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HourRate {
    pub hour: u8,
    pub n: u32,
    pub rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExpRow {
    pub label: String,
    pub n: u32,
    pub average: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProblemPage {
    pub page_id: String,
    pub minutes: u32,
    pub lost: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PatternData {
    pub position: Vec<RateRow>,
    pub timer: Vec<RateRow>,
    pub hours: Option<Vec<HourRate>>,
    pub experiments: Vec<ExpRow>,
    pub problems: Vec<ProblemPage>,
    pub empty: bool,
}

struct ValidReview<'a> {
    grade: u8,
    pos: u32,
    hour: Option<u8>,
    timer: Option<bool>,
    /// Bitmaske für feynman/scaffolding/variation/mc.
    exp_mask: u8,
    exp_empty: bool,
    review_id: Option<&'a str>,
}

fn extract_review_events(telemetry: &[Telemetry]) -> Vec<ValidReview<'_>> {
    let mut out: Vec<ValidReview<'_>> = Vec::new();
    for e in telemetry {
        let kind = e.kind.as_deref().unwrap_or("");
        let Some(serde_json::Value::Object(data)) = e.extra.get("data") else {
            continue;
        };

        if kind == "review" {
            let grade = data.get("grade").and_then(serde_json::Value::as_f64).unwrap_or(0.0) as u8;
            if grade > 0 {
                let pos = data.get("pos").and_then(serde_json::Value::as_f64).unwrap_or(-1.0) as i64;
                let hour = data.get("hour").and_then(serde_json::Value::as_f64).unwrap_or(-1.0) as i64;
                let timer = data.get("timer").and_then(serde_json::Value::as_bool);
                let mut exp_mask = 0u8;
                let mut exp_empty = true;
                if let Some(arr) = data.get("exp").and_then(serde_json::Value::as_array) {
                    for s in arr.iter().filter_map(serde_json::Value::as_str) {
                        exp_empty = false;
                        match s {
                            "feynman" => exp_mask |= 1,
                            "scaffolding" => exp_mask |= 2,
                            "variation" => exp_mask |= 4,
                            "mc" => exp_mask |= 8,
                            _ => {}
                        }
                    }
                }
                let review_id = data.get("reviewId").and_then(serde_json::Value::as_str);

                out.push(ValidReview {
                    grade,
                    pos: if pos >= 0 { pos as u32 } else { 0 },
                    hour: if (0..24).contains(&hour) { Some(hour as u8) } else { None },
                    timer,
                    exp_mask,
                    exp_empty,
                    review_id,
                });
            }
        } else if kind == "reviewUndo" {
            let rid = data.get("reviewId").and_then(serde_json::Value::as_str).unwrap_or("");
            if !rid.is_empty() {
                if let Some(idx) = out.iter().position(|item| item.review_id == Some(rid)) {
                    out.remove(idx);
                }
            } else if !out.is_empty() {
                out.pop();
            }
        }
    }
    out
}

pub fn compute_patterns(telemetry: &[Telemetry], live_pages: &HashSet<String>) -> PatternData {
    let rs = extract_review_events(telemetry);

    // Ein Durchlauf über alle gültigen Reviews statt 35 Einzelfilterungen + Vec-Allokationen.
    let mut pos_n = [0u32; 4];
    let mut pos_ok = [0u32; 4];
    let mut timer_on = (0u32, 0u32);
    let mut timer_off = (0u32, 0u32);
    let mut hour_n = [0u32; 24];
    let mut hour_ok = [0u32; 24];
    let mut exp_n = [0u32; 4];
    let mut exp_valid = [0u32; 4];
    let mut exp_sum = [0u32; 4];
    let mut base_n = 0u32;
    let mut base_valid = 0u32;
    let mut base_sum = 0u32;

    for e in &rs {
        let ok = u32::from(e.grade > 1);
        let p_idx = match e.pos {
            0..10 => 0,
            10..25 => 1,
            25..40 => 2,
            _ => 3,
        };
        pos_n[p_idx] += 1;
        pos_ok[p_idx] += ok;

        match e.timer {
            Some(true) => {
                timer_on.0 += 1;
                timer_on.1 += ok;
            }
            Some(false) => {
                timer_off.0 += 1;
                timer_off.1 += ok;
            }
            None => {}
        }

        if let Some(h) = e.hour {
            let hi = h as usize;
            hour_n[hi] += 1;
            hour_ok[hi] += ok;
        }

        let valid_grade = (1..=4).contains(&e.grade);
        if e.exp_empty {
            base_n += 1;
            if valid_grade {
                base_valid += 1;
                base_sum += u32::from(e.grade);
            }
        }
        if e.exp_mask != 0 {
            for i in 0..4 {
                if (e.exp_mask & (1 << i)) != 0 {
                    exp_n[i] += 1;
                    if valid_grade {
                        exp_valid[i] += 1;
                        exp_sum[i] += u32::from(e.grade);
                    }
                }
            }
        }
    }

    let rate_of = |n: u32, ok: u32| if n == 0 { 0.0 } else { ok as f64 / n as f64 };

    // 1) Position & Timer
    let pos_labels = ["Karte 1–10", "Karte 11–25", "Karte 26–40", "Karte 41+"];
    let mut position = Vec::with_capacity(4);
    for (i, label) in pos_labels.iter().enumerate() {
        if pos_n[i] >= 12 {
            position.push(RateRow { label: (*label).to_string(), n: pos_n[i], rate: rate_of(pos_n[i], pos_ok[i]) });
        }
    }

    let timer = if timer_on.0 >= 15 && timer_off.0 >= 15 {
        vec![
            RateRow { label: "mit Lerntimer".to_string(), n: timer_on.0, rate: rate_of(timer_on.0, timer_on.1) },
            RateRow { label: "ohne Timer".to_string(), n: timer_off.0, rate: rate_of(timer_off.0, timer_off.1) },
        ]
    } else {
        Vec::new()
    };

    // 2) Chronobiologie (0..23)
    let hours = if rs.len() < 60 {
        None
    } else if hour_n.iter().filter(|&&n| n >= 8).count() >= 3 {
        Some(
            (0..24)
                .map(|h| HourRate { hour: h as u8, n: hour_n[h], rate: rate_of(hour_n[h], hour_ok[h]) })
                .collect(),
        )
    } else {
        None
    };

    // 3) Experimente
    let exp_labels = ["Feynman", "Hinweise", "Variation", "Quiz"];
    let avg_of = |valid: u32, sum: u32| if valid == 0 { 0.0 } else { sum as f64 / valid as f64 };
    let mut exp_rows: Vec<ExpRow> = Vec::with_capacity(5);
    for (i, label) in exp_labels.iter().enumerate() {
        if exp_n[i] >= 15 {
            exp_rows.push(ExpRow { label: (*label).to_string(), n: exp_n[i], average: avg_of(exp_valid[i], exp_sum[i]) });
        }
    }
    let experiments = if exp_rows.is_empty() || base_n < 30 {
        Vec::new()
    } else {
        exp_rows.push(ExpRow { label: "ohne Experimente".to_string(), n: base_n, average: avg_of(base_valid, base_sum) });
        exp_rows
    };

    // 4) Problemzonen (dwell)
    let mut dwell: HashMap<&str, (u64, u64)> = HashMap::new();
    for e in telemetry {
        if e.kind.as_deref() != Some("dwell") {
            continue;
        }
        let Some(serde_json::Value::Object(data)) = e.extra.get("data") else {
            continue;
        };
        let pid = data.get("pageId").and_then(serde_json::Value::as_str).unwrap_or("");
        if pid.is_empty() {
            continue;
        }
        let ms = data.get("ms").and_then(serde_json::Value::as_f64).unwrap_or(0.0) as u64;
        let lost = data.get("lost").and_then(serde_json::Value::as_f64).unwrap_or(0.0) as u64;
        let entry = dwell.entry(pid).or_default();
        entry.0 += ms;
        entry.1 += lost;
    }

    let mut problem_candidates: Vec<(&str, (u64, u64))> =
        dwell.into_iter().filter(|(id, v)| live_pages.contains(*id) && v.0 >= 5 * 60_000).collect();
    problem_candidates.sort_small_by(|a, b| {
        let score_b = b.1.0 + b.1.1 * 60_000;
        let score_a = a.1.0 + a.1.1 * 60_000;
        score_b.cmp(&score_a).then_with(|| a.0.cmp(b.0))
    });
    let problems: Vec<ProblemPage> = problem_candidates
        .into_iter()
        .take(5)
        .map(|(id, v)| ProblemPage { page_id: id.to_owned(), minutes: (v.0 / 60_000) as u32, lost: v.1 as u32 })
        .collect();

    let empty =
        position.len() < 2 && timer.is_empty() && hours.is_none() && experiments.is_empty() && problems.is_empty();

    PatternData { position, timer, hours, experiments, problems, empty }
}

impl State {
    pub fn pattern_data(&self, live_pages: Option<&HashSet<String>>) -> PatternData {
        let default_live: HashSet<String>;
        let set = match live_pages {
            Some(s) => s,
            None => {
                default_live = self.pages.values().filter(|p| !p.is_trashed()).map(|p| p.id().to_string()).collect();
                &default_live
            }
        };
        compute_patterns(&self.telemetry, set)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dur_format() {
        assert_eq!(dur(0.0), "0 Min");
        assert_eq!(dur(45.0), "45 Min");
        assert_eq!(dur(60.0), "1 h");
        assert_eq!(dur(90.0), "1 h 30");
        assert_eq!(dur(120.0), "2 h");
    }

    #[test]
    fn test_compute_goal() {
        // Geschafft
        let g1 = compute_goal(60, &[10.0, 20.0, 30.0, 0.0, 0.0, 0.0, 0.0], 2, 20.0);
        assert_eq!(g1.need, 0.0);
        assert!(!g1.warn);
        assert_eq!(g1.reach_day, None);
        assert_eq!(g1.text, "Geschafft: 1 h von 1 h.");

        // Auf Kurs
        let g2 = compute_goal(100, &[10.0, 10.0, 0.0, 0.0, 0.0, 0.0, 0.0], 1, 20.0);
        assert_eq!(g2.done, 20.0);
        assert_eq!(g2.need, 80.0);
        assert!(!g2.warn);
        assert_eq!(g2.reach_day, Some(4)); // Freitag
        assert_eq!(g2.text, "Bei deinem Tempo schaffst du es am Freitag.");

        // Im Rückstand
        let g3 = compute_goal(200, &[10.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], 3, 10.0);
        assert_eq!(g3.done, 10.0);
        assert_eq!(g3.need, 190.0);
        assert!(g3.warn);
        assert_eq!(g3.reach_day, None);
        assert_eq!(g3.tone, "warn");
    }

    #[test]
    fn test_compute_subjects() {
        let now_ms = 1_700_000_000_000i64;
        let day_ms = 86_400_000i64;

        // Keine Reviews
        let res1 = compute_subjects(&[], now_ms);
        assert!(res1.rows.is_empty());
        assert_eq!(res1.worst, None);
        assert_eq!(res1.tone, "ok");
        assert!(res1.text.contains("Noch zu wenig Daten"));

        // 15 Reviews in cur (cur_t = now_ms - 2*day_ms) und 15 in prev (prev_t = now_ms - 16*day_ms)
        let mut reviews = Vec::new();
        let cur_iso = Timestamp(now_ms - 2 * day_ms).to_iso();
        let prev_iso = Timestamp(now_ms - 16 * day_ms).to_iso();

        // Mathe: cur 10/15 (67%), prev 14/15 (93%) -> delta = -26 (nachlassen!)
        for i in 0..15 {
            reviews.push(Review {
                t: Some(cur_iso.clone()),
                subject: Some("Mathe".to_string()),
                deck: Some("Mathe::Analysis".to_string()),
                grade: Some(if i < 10 { 3.0 } else { 1.0 }),
                ..Default::default()
            });
        }
        for i in 0..15 {
            reviews.push(Review {
                t: Some(prev_iso.clone()),
                subject: Some("Mathe".to_string()),
                deck: Some("Mathe::Analysis".to_string()),
                grade: Some(if i < 14 { 3.0 } else { 1.0 }),
                ..Default::default()
            });
        }

        let res2 = compute_subjects(&reviews, now_ms);
        assert_eq!(res2.rows.len(), 1);
        let worst = res2.worst.as_ref().expect("worst expected");
        assert_eq!(worst.subject, "Mathe");
        assert_eq!(worst.deck, "Mathe");
        assert!(worst.delta <= -8);
        assert_eq!(res2.tone, "warn");
        assert!(res2.text.contains("Mathe lässt nach"));
    }

    #[test]
    fn test_compute_best_time() {
        let now_ms = 1_700_000_000_000i64;
        let tz_offset_minutes = 60i64; // UTC+1
        let tz_offset_ms = 60 * 60_000i64;

        // Zu wenig Reviews
        let res1 = compute_best_time(&[], now_ms, &tz_offset_minutes);
        assert!(res1.best.is_none());
        assert!(res1.text.contains("Noch zu wenig Daten"));

        // 20 Reviews um 08:00 lokaler Zeit (Morgens, 100% richtig)
        // 20 Reviews um 19:00 lokaler Zeit (Abends, 50% richtig)
        let local_ms = now_ms + tz_offset_ms;
        let local_days = local_ms.div_euclid(86_400_000);
        let morning_t = local_days * 86_400_000 + 8 * 3_600_000 - tz_offset_ms;
        let evening_t = local_days * 86_400_000 + 19 * 3_600_000 - tz_offset_ms;

        let mut reviews = Vec::new();
        for _ in 0..20 {
            reviews.push(Review { t: Some(Timestamp(morning_t).to_iso()), grade: Some(3.0), ..Default::default() });
        }
        for i in 0..20 {
            reviews.push(Review {
                t: Some(Timestamp(evening_t).to_iso()),
                grade: Some(if i < 10 { 3.0 } else { 1.0 }),
                ..Default::default()
            });
        }

        let res2 = compute_best_time(&reviews, now_ms, &tz_offset_minutes);
        let best = res2.best.expect("best time slot expected");
        assert_eq!(best.label, "Morgens");
        assert_eq!(best.n, 20);
        assert_eq!(best.rate, Some(1.0));
        assert!(res2.text.contains("Morgens bist du am stärksten"));
    }

    #[test]
    fn test_compute_forecast() {
        let now_ms = 1_700_000_000_000i64;
        let tz_offset_minutes = 60;
        let tz_offset_ms = 60 * 60_000i64;
        let local_ms = now_ms + tz_offset_ms;
        let local_days = local_ms.div_euclid(86_400_000);
        let today = ((local_days + 3).rem_euclid(7)) as u8;

        // Keine fälligen Karten
        let res1 = compute_forecast(&[], now_ms, &tz_offset_minutes, today);
        assert_eq!(res1.peak, None);
        assert_eq!(res1.counts, vec![0; 7]);
        assert_eq!(res1.text, "In den nächsten 7 Tagen wird nichts fällig.");

        // 35 Karten fällig morgen (Tag 1)
        let tomorrow_due_ms = (local_days + 1) * 86_400_000 + 10 * 3_600_000 - tz_offset_ms;
        let tomorrow_due_iso = Timestamp(tomorrow_due_ms).to_iso();

        let mut cards = Vec::new();
        for i in 0..35 {
            let mut c =
                Card { id: Some(format!("card_{i}")), deck: Some("Standard".to_string()), ..Default::default() };
            c.set(
                "srs",
                serde_json::json!({
                    "state": "review",
                    "due": tomorrow_due_iso
                }),
            );
            cards.push(c);
        }
        let refs: Vec<&Card> = cards.iter().collect();
        let res2 = compute_forecast(&refs, now_ms, &tz_offset_minutes, today);
        assert_eq!(res2.counts[1], 35);
        assert_eq!(res2.peak, Some(1));
        assert!(res2.text.contains("Morgen werden 35 Karten fällig"));
        assert_eq!(res2.tone, "warn");
    }

    #[test]
    fn test_compute_patterns() {
        let mut telemetry = Vec::new();

        // 15 Reviews Pos 5 mit Timer und feynman
        for i in 0..15 {
            let mut t = Telemetry { kind: Some("review".to_string()), ..Default::default() };
            t.set(
                "data",
                serde_json::json!({
                    "grade": 3,
                    "pos": 5,
                    "hour": 10,
                    "timer": true,
                    "exp": ["feynman"],
                    "reviewId": format!("r_{i}")
                }),
            );
            telemetry.push(t);
        }

        // 15 Reviews Pos 15 ohne Timer
        for i in 0..15 {
            let mut t = Telemetry { kind: Some("review".to_string()), ..Default::default() };
            t.set(
                "data",
                serde_json::json!({
                    "grade": 3,
                    "pos": 15,
                    "hour": 10,
                    "timer": false,
                    "exp": [],
                    "reviewId": format!("r_off_{i}")
                }),
            );
            telemetry.push(t);
        }

        // Undo eines Reviews
        let mut undo = Telemetry { kind: Some("reviewUndo".to_string()), ..Default::default() };
        undo.set("data", serde_json::json!({ "reviewId": "r_0" }));
        telemetry.push(undo);

        // Dwell Telemetrie für Seite p1 (10 Minuten gelesen, 2 lost)
        let mut dwell = Telemetry { kind: Some("dwell".to_string()), ..Default::default() };
        dwell.set(
            "data",
            serde_json::json!({
                "pageId": "p1",
                "ms": 600_000,
                "lost": 2
            }),
        );
        telemetry.push(dwell);

        let mut live_pages = HashSet::new();
        live_pages.insert("p1".to_string());

        let res = compute_patterns(&telemetry, &live_pages);
        assert!(!res.empty);
        assert!(!res.position.is_empty());
        assert_eq!(res.problems.len(), 1);
        assert_eq!(res.problems[0].page_id, "p1");
        assert_eq!(res.problems[0].minutes, 10);
        assert_eq!(res.problems[0].lost, 2);
    }

    #[test]
    fn test_dur_edge_cases() {
        assert_eq!(dur(-1.0), "0 Min");
        assert_eq!(dur(f64::NAN), "0 Min");
        assert_eq!(dur(f64::INFINITY), "0 Min");
        assert_eq!(dur(f64::NEG_INFINITY), "0 Min");
        assert_eq!(dur(0.0), "0 Min");
    }

    #[test]
    fn test_compute_goal_edge_cases() {
        // today >= 7 (darf nicht panicken oder durch 0 teilen)
        let g_sunday = compute_goal(60, &[60.0], 7, 10.0);
        assert_eq!(g_sunday.today, 6);
        assert_eq!(g_sunday.left, 1);
        assert_eq!(g_sunday.need, 0.0);

        let g_out_of_bounds = compute_goal(100, &[10.0], 10, -5.0);
        assert_eq!(g_out_of_bounds.today, 6);
        assert_eq!(g_out_of_bounds.left, 1);
        assert_eq!(g_out_of_bounds.pace, 0.0);
        assert!(g_out_of_bounds.warn);

        // Fast erreicht (Floating Point Rundungsungenauigkeit: 59.99999999999999 bei 60 Min Ziel)
        let g_almost = compute_goal(60, &[19.99999999999999, 40.0], 2, 20.0);
        assert_eq!(g_almost.need, 0.0);
        assert!(!g_almost.warn);
        assert!(g_almost.text.starts_with("Geschafft:"));
    }

    #[test]
    fn test_patterns_missing_hour_does_not_inflate_midnight() {
        let mut telemetry = Vec::new();
        // 60 Reviews ohne Stunde
        for i in 0..60 {
            let mut t = Telemetry { kind: Some("review".to_string()), ..Default::default() };
            t.set(
                "data",
                serde_json::json!({
                    "grade": 3,
                    "pos": i,
                    "timer": true,
                    "reviewId": format!("r_{i}")
                }),
            );
            telemetry.push(t);
        }

        let res = compute_patterns(&telemetry, &HashSet::new());
        // Keine Stunde vorhanden -> keine Chronobiologie
        assert_eq!(res.hours, None);
    }

    #[test]
    fn analysis_und_patterns_leistung() {
        use std::time::Instant;

        let now_ms = Timestamp::parse_iso("2026-11-04T12:00:00Z").unwrap().millis();
        let mut st = State::default();
        let subjects = ["Mathe", "Physik", "Informatik", "Biologie", "Chemie", "Geschichte"];
        for i in 0..4000usize {
            let id = format!("c{i}");
            let subj = subjects[i % subjects.len()];
            let due_ms = now_ms + ((i as i64 % 10) - 2) * 86_400_000;
            let mut c = Card { id: Some(id.clone()), deck: Some(format!("{subj}::Kap{}", i % 5)), ..Default::default() };
            c.extra.insert(
                "srs".into(),
                serde_json::json!({ "state": if i % 5 == 0 { "new" } else { "review" }, "due": Timestamp(due_ms).to_iso() }),
            );
            st.cards.insert(id, c);
        }
        for i in 0..5000usize {
            let subj = subjects[i % subjects.len()];
            let t_ms = now_ms - ((i as i64 % 50) * 86_400_000) - ((i as i64 % 24) * 3_600_000);
            st.reviews.push(Review {
                id: Some(format!("r{i}")),
                card_id: Some(format!("c{}", i % 4000)),
                deck: Some(format!("{subj}::Kap{}", i % 5)),
                subject: Some(subj.to_string()),
                t: Some(Timestamp(t_ms).to_iso()),
                grade: Some(((i % 4) + 1) as f64),
                ..Default::default()
            });
        }

        let mut telemetry = Vec::with_capacity(4000);
        let exps = ["feynman", "scaffolding", "variation", "mc"];
        let mut live_pages = HashSet::new();
        for p in 0..20 {
            live_pages.insert(format!("p{p}"));
        }
        for i in 0..3500usize {
            let mut t = Telemetry { kind: Some("review".to_string()), ..Default::default() };
            let exp_val = if i % 3 == 0 {
                serde_json::json!([exps[i % exps.len()]])
            } else {
                serde_json::json!([])
            };
            t.set(
                "data",
                serde_json::json!({
                    "grade": (i % 4) + 1,
                    "pos": i % 60,
                    "hour": i % 24,
                    "timer": i % 2 == 0,
                    "exp": exp_val,
                    "reviewId": format!("rev_{i}")
                }),
            );
            telemetry.push(t);
        }
        for i in 0..500usize {
            let mut t = Telemetry { kind: Some("dwell".to_string()), ..Default::default() };
            t.set("data", serde_json::json!({ "pageId": format!("p{}", i % 20), "ms": 45_000, "lost": i % 3 }));
            telemetry.push(t);
        }

        let zone = 60i64;
        let days = [30.0, 25.0, 40.0, 15.0, 0.0, 0.0, 0.0];

        // Basis-Korrektheit prüfen
        let ha = st.home_analysis(now_ms, &zone, 180, &days, 25.0).unwrap();
        assert_eq!(ha.subjects, compute_subjects(&st.reviews, now_ms));
        assert_eq!(ha.time, compute_best_time(&st.reviews, now_ms, &zone));
        let pat = compute_patterns(&telemetry, &live_pages);
        assert!(!pat.empty);
        assert!(pat.hours.is_some());
        assert!(!pat.experiments.is_empty());
        assert_eq!(pat.problems.len(), 5);

        let t0 = Instant::now();
        let mut acc = 0usize;
        for _ in 0..20 {
            let h = st.home_analysis(now_ms, &zone, 180, &days, 25.0).unwrap();
            acc += h.subjects.rows.len() + h.forecast.counts.iter().sum::<u32>() as usize;
        }
        let ha_ms = t0.elapsed().as_secs_f64() * 1000.0;

        let t1 = Instant::now();
        for _ in 0..20 {
            let p = compute_patterns(&telemetry, &live_pages);
            acc += p.position.len() + p.experiments.len() + p.problems.len();
        }
        let pat_ms = t1.elapsed().as_secs_f64() * 1000.0;

        assert!(acc > 0);
        eprintln!(
            "home_analysis (4000 cards, 5000 reviews): 20 runs = {ha_ms:.2} ms ({:.2} ms/run)",
            ha_ms / 20.0
        );
        eprintln!(
            "compute_patterns (4000 telemetry events): 20 runs = {pat_ms:.2} ms ({:.2} ms/run)",
            pat_ms / 20.0
        );
    }
}
