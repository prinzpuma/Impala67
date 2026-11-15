//! Lernzeit-Logik (web/lernzeit.js, web/home-view.js):
//! Intervall-Vereinigung (mergedSeconds), Tages-/Wochensummen, Serie (Streak),
//! Wochenziel samt Zyklus, Home-Hinweis als Enum, sowie Erfassungs-Zustandsmaschine
//! mit übergebener Zeit.

use std::collections::HashMap;

use impala_srs::{LocalZone, Timestamp, day_key_of};
use serde::{Deserialize, Serialize};

pub const MIN_STREAK_SECONDS: u64 = 300; // 5 Minuten
pub const SESSION_GAP_MS: i64 = 15 * 60 * 1000; // 15 Minuten
pub const GOAL_PRESETS: [u32; 4] = [120, 300, 480, 720];
pub const DEFAULT_GOAL_MINUTES: u32 = 300;
pub const MIN_GOAL_MINUTES: u32 = 30;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeSegment {
    pub started_at: String,
    pub ended_at: String,
}

fn de_segments<'de, D>(deserializer: D) -> Result<Vec<TimeSegment>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let opt = Option::<Vec<TimeSegment>>::deserialize(deserializer)?;
    Ok(opt.unwrap_or_default())
}

/// Abstrakte Sitzung zur Vereinigung überlappender Lernzeiten.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningSessionData {
    pub id: String,
    pub started_at: String,
    #[serde(default)]
    pub ended_at: Option<String>,
    #[serde(default)]
    pub duration_seconds: u64,
    #[serde(default, deserialize_with = "de_segments")]
    pub segments: Vec<TimeSegment>,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub subject_source: Option<String>,
    #[serde(default)]
    pub source_id: Option<String>,
}

/// Home-Hinweis (`nudge` in home-view.js / HomeState.kt / HomeCustomize.swift):
/// Streak in Gefahr > Ziel in Reichweite > Ziel geschafft > heutige Zeit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HomeNudge {
    None,
    /// Dein Streak von X Tagen wartet noch auf heute (nach 14 Uhr noch nichts gelernt).
    StreakAtRisk {
        #[serde(rename = "streakDays")]
        streak_days: u32,
    },
    /// Nur noch X Min bis zum Wochenziel (<= 60 Min verbleibend).
    GoalInReach {
        #[serde(rename = "minutesLeft")]
        minutes_left: f64,
    },
    /// Das Wochenziel hast du schon geschafft.
    GoalReached,
    /// Heute schon X Min gelernt.
    TodayProgress {
        minutes: u32,
    },
}

pub fn format_duration(minutes: f64) -> String {
    let m = minutes.round() as i64;
    let h = m / 60;
    let r = m % 60;
    if h > 0 { if r > 0 { format!("{h} h {r}") } else { format!("{h} h") } } else { format!("{m} Min") }
}

impl HomeNudge {
    pub fn message(&self) -> String {
        match self {
            Self::None => String::new(),
            Self::StreakAtRisk { streak_days } => {
                let unit = if *streak_days == 1 { "Tag" } else { "Tagen" };
                format!(" Dein Streak von {streak_days} {unit} wartet noch auf heute.")
            }
            Self::GoalInReach { minutes_left } => {
                format!(" Nur noch {} bis zum Wochenziel.", format_duration(*minutes_left))
            }
            Self::GoalReached => " Das Wochenziel hast du schon geschafft.".to_owned(),
            Self::TodayProgress { minutes } => {
                format!(" Heute schon {} gelernt.", format_duration(*minutes as f64))
            }
        }
    }
}

impl From<&crate::types::LearningSession> for LearningSessionData {
    fn from(s: &crate::types::LearningSession) -> Self {
        let text = |v: &Option<String>| v.clone().unwrap_or_default();
        let segments = match s.get("segments") {
            Some(serde_json::Value::Array(list)) => list
                .iter()
                .filter_map(|seg| {
                    let part = |k: &str| seg.get(k).and_then(serde_json::Value::as_str).map(str::to_owned);
                    Some(TimeSegment { started_at: part("startedAt")?, ended_at: part("endedAt")? })
                })
                .collect(),
            _ => Vec::new(),
        };
        LearningSessionData {
            id: text(&s.id),
            started_at: text(&s.started_at),
            ended_at: s.ended_at.clone().filter(|e| !e.is_empty()),
            duration_seconds: s.duration_seconds.unwrap_or(0.0).max(0.0) as u64,
            segments,
            category: s.get("category").as_ref().and_then(serde_json::Value::as_str).unwrap_or("other").to_owned(),
            subject: s.subject.clone().filter(|sub| !sub.is_empty()),
            subject_source: s.subject_source.clone().filter(|src| !src.is_empty()),
            source_id: s.source_id.clone().filter(|src| !src.is_empty()),
        }
    }
}

/// Wochentag für Ortszeit (Montag = 0 .. Sonntag = 6).
pub fn weekday_index(utc_ms: i64, zone: &dyn LocalZone) -> u32 {
    (Timestamp(utc_ms).local_days(zone) + 3).rem_euclid(7) as u32
}

// ---------------------------------------------------------------------------
// Intervall-Vereinigung und Auswertung
// ---------------------------------------------------------------------------

pub fn parse_ms(iso: &str) -> Option<i64> {
    Timestamp::parse_iso(iso).map(|t| t.millis())
}

/// Vereinigt überlappende Zeitintervalle zweier oder mehrerer Sitzungen (Wanduhrzeit).
pub fn merged_seconds(sessions: &[LearningSessionData]) -> u64 {
    let mut intervals: Vec<(i64, i64)> = Vec::new();

    for s in sessions {
        if !s.segments.is_empty() {
            for seg in &s.segments {
                match (parse_ms(&seg.started_at), parse_ms(&seg.ended_at)) {
                    (Some(start), Some(end)) if end >= start => intervals.push((start, end)),
                    _ => {}
                }
            }
        } else if let Some(start) = parse_ms(&s.started_at) {
            let end = s.ended_at.as_deref().and_then(parse_ms).unwrap_or(start + s.duration_seconds as i64 * 1000);
            let end = end.max(start);
            intervals.push((start, end));
        }
    }

    intervals.sort_by_key(|&(start, _)| start);

    let mut total_ms: i64 = 0;
    let mut cur: Option<(i64, i64)> = None;

    for (start, end) in intervals {
        match cur {
            None => cur = Some((start, end)),
            Some((c_start, c_end)) => {
                if start > c_end {
                    total_ms += c_end - c_start;
                    cur = Some((start, end));
                } else if end > c_end {
                    cur = Some((c_start, end));
                }
            }
        }
    }

    if let Some((c_start, c_end)) = cur {
        total_ms += c_end - c_start;
    }

    (total_ms as f64 / 1000.0).round() as u64
}

/// Gruppiert Sitzungen nach Kalendertag (lokal nach Beginn der Sitzung) und
/// liefert die Sekunden je Tag.
pub fn totals_by_day(
    sessions: &[LearningSessionData],
    live: Option<&LearningSessionData>,
    zone: &dyn LocalZone,
) -> HashMap<String, u64> {
    let mut all_sessions: Vec<LearningSessionData> = Vec::with_capacity(sessions.len() + 1);

    if let Some(l) = live {
        for s in sessions {
            if s.id != l.id {
                all_sessions.push(s.clone());
            }
        }
        all_sessions.push(l.clone());
    } else {
        all_sessions.extend_from_slice(sessions);
    }

    let mut groups: HashMap<String, Vec<LearningSessionData>> = HashMap::new();

    for s in all_sessions {
        if let Some(start_ms) = parse_ms(&s.started_at) {
            let key = Timestamp(start_ms).day_key(zone);
            groups.entry(key).or_default().push(s);
        }
    }

    groups.into_iter().map(|(key, list)| (key, merged_seconds(&list))).collect()
}

/// Die 7 Tage der Woche (Montag bis Sonntag) als Sekunden-Array.
pub fn week_data(totals: &HashMap<String, u64>, now_ms: i64, week_offset: i32, zone: &dyn LocalZone) -> [u64; 7] {
    let today_days = Timestamp(now_ms).local_days(zone);
    let weekday = (today_days + 3).rem_euclid(7); // Mo=0..So=6
    let monday = today_days - weekday + i64::from(week_offset) * 7;

    let mut result = [0u64; 7];
    for (i, item) in result.iter_mut().enumerate() {
        *item = totals.get(&day_key_of(monday + i as i64)).copied().unwrap_or(0);
    }
    result
}

/// Aufeinanderfolgende Tage mit mindestens 5 Minuten Lernzeit.
/// Ein noch leerer heutiger Tag bricht die Serie nicht ab.
pub fn streak_days(totals: &HashMap<String, u64>, now_ms: i64, zone: &dyn LocalZone) -> u32 {
    let today_days = Timestamp(now_ms).local_days(zone);
    let mut streak: u32 = 0;

    for i in 0..365i64 {
        let sec = totals.get(&day_key_of(today_days - i)).copied().unwrap_or(0);

        if sec >= MIN_STREAK_SECONDS {
            streak += 1;
        } else if i == 0 {
            continue;
        } else {
            break;
        }
    }

    streak
}

/// Wochenziel normalisieren (mindestens 30 min, Standard 300).
pub fn normalize_week_goal(stored: u32) -> u32 {
    if stored >= MIN_GOAL_MINUTES { stored } else { DEFAULT_GOAL_MINUTES }
}

/// Schaltet durch die Vorgaben 120, 300, 480, 720 min.
pub fn cycle_week_goal(current: u32) -> u32 {
    let current = normalize_week_goal(current);
    match GOAL_PRESETS.iter().position(|&g| g == current) {
        Some(idx) => GOAL_PRESETS[(idx + 1) % GOAL_PRESETS.len()],
        None => GOAL_PRESETS[0],
    }
}

/// Home-Hinweis als Enum.
pub fn home_nudge(streak: u32, today_seconds: u64, week_seconds: u64, goal_min: u32, current_hour: u32) -> HomeNudge {
    let today_min = (today_seconds as f64 / 60.0).round() as u32;
    let week_min = week_seconds as f64 / 60.0;
    let left = goal_min as f64 - week_min;

    if streak > 0 && today_min == 0 && current_hour >= 14 {
        HomeNudge::StreakAtRisk { streak_days: streak }
    } else if left > 0.0 && left <= 60.0 {
        HomeNudge::GoalInReach { minutes_left: left }
    } else if left <= 0.0 && week_min > 0.0 {
        HomeNudge::GoalReached
    } else if today_min > 0 {
        HomeNudge::TodayProgress { minutes: today_min }
    } else {
        HomeNudge::None
    }
}

// ---------------------------------------------------------------------------
// Erfassungs-Zustandsmaschine (Tracker)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPersist {
    pub id: String,
    pub started_at: String,
    pub ended_at: String,
    pub duration_seconds: u64,
    pub segments: Vec<TimeSegment>,
    pub category: String,
    pub source_id: Option<String>,
    pub subject: Option<String>,
    pub subject_source: Option<String>,
    pub updated: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ActiveSession {
    pub id: String,
    pub started_at: String,
    pub active_started_at: Option<String>,
    pub active_started_ms: i64,
    pub paused_at_ms: i64,
    pub segments: Vec<TimeSegment>,
    pub category: String,
    pub source_id: Option<String>,
    pub subject: Option<String>,
    pub subject_source: Option<String>,
}

pub fn segments_duration_seconds(segments: &[TimeSegment]) -> u64 {
    let mut total_ms: i64 = 0;
    for s in segments {
        if let (Some(start), Some(end)) = (parse_ms(&s.started_at), parse_ms(&s.ended_at)) {
            let diff = end - start;
            if diff > 0 {
                total_ms += diff;
            }
        }
    }
    (total_ms as f64 / 1000.0).round() as u64
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct SessionTracker {
    pub current: Option<ActiveSession>,
}

impl SessionTracker {
    pub fn new() -> Self {
        Self { current: None }
    }

    pub fn is_active(&self) -> bool {
        self.current.as_ref().is_some_and(|s| s.active_started_ms != 0)
    }

    fn same_context(&self, category: &str, source_id: Option<&str>, subject: Option<&str>) -> bool {
        self.current.as_ref().is_some_and(|s| {
            s.category == category && s.source_id.as_deref() == source_id && s.subject.as_deref() == subject
        })
    }

    fn make_persist(s: &ActiveSession, updated: &str) -> Option<SessionPersist> {
        let dur = segments_duration_seconds(&s.segments);
        if dur < 1 || s.segments.is_empty() {
            return None;
        }
        let ended_at = s.segments.last()?.ended_at.clone();
        Some(SessionPersist {
            id: s.id.clone(),
            started_at: s.started_at.clone(),
            ended_at,
            duration_seconds: dur,
            segments: s.segments.clone(),
            category: s.category.clone(),
            source_id: s.source_id.clone(),
            subject: s.subject.clone(),
            subject_source: s.subject_source.clone(),
            updated: updated.to_owned(),
        })
    }

    /// Öffnet oder setzt einen Abschnitt fort (`openSegment`).
    #[allow(clippy::too_many_arguments)]
    pub fn open_segment(
        &mut self,
        now_ms: i64,
        now_iso: &str,
        category: &str,
        source_id: Option<&str>,
        subject: Option<&str>,
        subject_source: Option<&str>,
        new_id_fn: impl FnOnce() -> String,
    ) -> Option<SessionPersist> {
        if self.same_context(category, source_id, subject) {
            let s = self.current.as_mut().unwrap();
            if s.active_started_ms != 0 {
                return None;
            }
            if now_ms - s.paused_at_ms <= SESSION_GAP_MS {
                s.active_started_ms = now_ms;
                s.active_started_at = Some(now_iso.to_owned());
                s.paused_at_ms = 0;
                return None;
            }
        }

        let to_persist = self.finish_session(now_ms, now_iso);

        self.current = Some(ActiveSession {
            id: new_id_fn(),
            started_at: now_iso.to_owned(),
            active_started_at: Some(now_iso.to_owned()),
            active_started_ms: now_ms,
            paused_at_ms: 0,
            segments: Vec::new(),
            category: category.to_owned(),
            source_id: source_id.map(str::to_owned),
            subject: subject.map(str::to_owned),
            subject_source: subject_source.map(str::to_owned),
        });

        to_persist
    }

    /// Pausiert den aktuellen Abschnitt (`pauseSegment`).
    pub fn pause_segment(&mut self, now_ms: i64, now_iso: &str) -> Option<SessionPersist> {
        let s = self.current.as_mut()?;
        if s.active_started_ms == 0 {
            return None;
        }
        let started_at = s.active_started_at.take()?;
        s.segments.push(TimeSegment { started_at, ended_at: now_iso.to_owned() });
        s.active_started_ms = 0;
        s.paused_at_ms = now_ms;
        Self::make_persist(s, now_iso)
    }

    /// Schließt die aktuelle Sitzung komplett ab (`finishSession`).
    pub fn finish_session(&mut self, now_ms: i64, now_iso: &str) -> Option<SessionPersist> {
        let to_persist = self.pause_segment(now_ms, now_iso);
        self.current = None;
        to_persist
    }

    /// Teilt den Abschnitt bei Kontextwechsel (`maybeSplitSegment`).
    #[allow(clippy::too_many_arguments)]
    pub fn maybe_split_segment(
        &mut self,
        now_ms: i64,
        now_iso: &str,
        category: &str,
        source_id: Option<&str>,
        subject: Option<&str>,
        subject_source: Option<&str>,
        new_id_fn: impl FnOnce() -> String,
    ) -> Option<SessionPersist> {
        if self.current.is_none() || self.same_context(category, source_id, subject) {
            return None;
        }
        self.open_segment(now_ms, now_iso, category, source_id, subject, subject_source, new_id_fn)
    }

    /// Laufendes Segment als Pseudoelement für Live-Berechnungen (`currentAsSession`).
    pub fn current_as_session(&self, now_iso: &str) -> Option<LearningSessionData> {
        let s = self.current.as_ref()?;
        let mut segments = s.segments.clone();
        if let Some(active_start) = &s.active_started_at {
            segments.push(TimeSegment { started_at: active_start.clone(), ended_at: now_iso.to_owned() });
        }
        if segments.is_empty() {
            return None;
        }
        let duration_seconds = segments_duration_seconds(&segments);
        let ended_at = segments.last()?.ended_at.clone();
        Some(LearningSessionData {
            id: s.id.clone(),
            started_at: s.started_at.clone(),
            ended_at: Some(ended_at),
            duration_seconds,
            segments,
            category: s.category.clone(),
            subject: s.subject.clone(),
            subject_source: s.subject_source.clone(),
            source_id: s.source_id.clone(),
        })
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn golden_tests_lernzeit() {
        let path = format!("{}/tests/golden/lernzeit.json", env!("CARGO_MANIFEST_DIR"));
        let content = std::fs::read_to_string(path).expect("lernzeit.json vorhanden");
        let v: serde_json::Value = serde_json::from_str(&content).expect("lernzeit.json parses");

        // 1. Merged
        for c in v["merged"].as_array().unwrap() {
            let name = c["name"].as_str().unwrap();
            let sessions: Vec<LearningSessionData> = serde_json::from_value(c["sessions"].clone()).unwrap();
            let expected = c["expectedSeconds"].as_u64().unwrap();
            assert_eq!(merged_seconds(&sessions), expected, "mergedSeconds Fall: {name}");
        }

        // 2. Streaks
        for c in v["streaks"].as_array().unwrap() {
            let name = c["name"].as_str().unwrap();
            let totals: HashMap<String, u64> = serde_json::from_value(c["totals"].clone()).unwrap();
            let ref_date = c["referenceDate"].as_str().unwrap();
            let ref_ms = Timestamp::parse_iso(&format!("{ref_date}T12:00:00.000Z")).unwrap().millis();
            let expected = c["expectedStreak"].as_u64().unwrap() as u32;
            assert_eq!(streak_days(&totals, ref_ms, &0i64), expected, "streakDays Fall: {name}");
        }

        // 3. Weeks
        for c in v["weeks"].as_array().unwrap() {
            let name = c["name"].as_str().unwrap();
            let ref_date = c["refDate"].as_str().unwrap();
            let ref_ms = Timestamp::parse_iso(&format!("{ref_date}T12:00:00.000Z")).unwrap().millis();
            let offset = c["offset"].as_i64().unwrap() as i32;
            let days = c["days"].as_array().unwrap();
            let mut sample: HashMap<String, u64> = HashMap::new();
            for d in days {
                sample.insert(d["date"].as_str().unwrap().to_owned(), d["seconds"].as_u64().unwrap());
            }
            let res = week_data(&sample, ref_ms, offset, &0i64);
            for (i, d) in days.iter().enumerate() {
                assert_eq!(res[i], d["seconds"].as_u64().unwrap(), "weekData Fall: {name} Tag {i}");
            }
        }

        // 4. Cycle
        for c in v["cycle"].as_array().unwrap() {
            let input = c["input"].as_u64().unwrap() as u32;
            let expected = c["next"].as_u64().unwrap() as u32;
            assert_eq!(cycle_week_goal(input), expected, "cycleGoal Fall: {input}");
        }

        // 5. Nudges
        for c in v["nudges"].as_array().unwrap() {
            let streak = c["streak"].as_u64().unwrap() as u32;
            let today_sec = c["todaySeconds"].as_u64().unwrap();
            let week_min = c["weekMin"].as_f64().unwrap();
            let goal_min = c["goalMin"].as_u64().unwrap() as u32;
            let hour = c["hour"].as_u64().unwrap() as u32;
            let expected_kind = c["result"]["kind"].as_str().unwrap();

            let nudge = home_nudge(streak, today_sec, (week_min * 60.0).round() as u64, goal_min, hour);
            match expected_kind {
                "streakAtRisk" => {
                    let expected_days = c["result"]["streakDays"].as_u64().unwrap() as u32;
                    assert_eq!(nudge, HomeNudge::StreakAtRisk { streak_days: expected_days });
                }
                "goalInReach" => {
                    let expected_left = c["result"]["minutesLeft"].as_f64().unwrap();
                    assert_eq!(nudge, HomeNudge::GoalInReach { minutes_left: expected_left });
                }
                "goalReached" => assert_eq!(nudge, HomeNudge::GoalReached),
                "todayProgress" => {
                    let expected_m = c["result"]["minutes"].as_u64().unwrap() as u32;
                    assert_eq!(nudge, HomeNudge::TodayProgress { minutes: expected_m });
                }
                "none" => assert_eq!(nudge, HomeNudge::None),
                other => panic!("Unbekannte Nudge-Art: {other}"),
            }
        }
    }

    #[test]
    fn tracker_zustandsmaschine() {
        let mut tracker = SessionTracker::new();
        assert!(!tracker.is_active());

        // 1. Neuer Abschnitt
        let t1_ms = 1_700_000_000_000i64;
        let t1_iso = "2023-11-14T22:13:20.000Z";
        let res =
            tracker.open_segment(t1_ms, t1_iso, "cards", Some("deck1"), Some("Mathe"), Some("anki"), || "s1".into());
        assert_eq!(res, None);
        assert!(tracker.is_active());

        // 2. Erneuter Aufruf gleicher Kontext -> no-op
        let res2 = tracker.open_segment(
            t1_ms + 10_000,
            "2023-11-14T22:13:30.000Z",
            "cards",
            Some("deck1"),
            Some("Mathe"),
            Some("anki"),
            || "s2".into(),
        );
        assert_eq!(res2, None);
        assert_eq!(tracker.current.as_ref().unwrap().id, "s1");

        // 3. Pausieren nach 30 Sekunden
        let t2_ms = t1_ms + 30_000;
        let t2_iso = "2023-11-14T22:13:50.000Z";
        let p = tracker.pause_segment(t2_ms, t2_iso).expect("Persistiert nach Pause");
        assert_eq!(p.id, "s1");
        assert_eq!(p.duration_seconds, 30);
        assert_eq!(p.segments.len(), 1);
        assert!(!tracker.is_active());

        // 4. Fortsetzen innerhalb 15 Min
        let t3_ms = t2_ms + 60_000;
        let t3_iso = "2023-11-14T22:14:50.000Z";
        let res3 =
            tracker.open_segment(t3_ms, t3_iso, "cards", Some("deck1"), Some("Mathe"), Some("anki"), || "s3".into());
        assert_eq!(res3, None);
        assert!(tracker.is_active());
        assert_eq!(tracker.current.as_ref().unwrap().id, "s1");

        // 5. Weiterer Abschnitt und finish
        let t4_ms = t3_ms + 30_000;
        let t4_iso = "2023-11-14T22:15:20.000Z";
        let p2 = tracker.finish_session(t4_ms, t4_iso).expect("Persistiert bei finish");
        assert_eq!(p2.id, "s1");
        assert_eq!(p2.duration_seconds, 60);
        assert_eq!(p2.segments.len(), 2);
        assert!(!tracker.is_active());
        assert!(tracker.current.is_none());
    }

    #[test]
    fn nudge_nachrichten() {
        assert_eq!(HomeNudge::None.message(), "");
        assert_eq!(
            HomeNudge::StreakAtRisk { streak_days: 1 }.message(),
            " Dein Streak von 1 Tag wartet noch auf heute."
        );
        assert_eq!(
            HomeNudge::StreakAtRisk { streak_days: 5 }.message(),
            " Dein Streak von 5 Tagen wartet noch auf heute."
        );
        assert_eq!(HomeNudge::GoalInReach { minutes_left: 30.0 }.message(), " Nur noch 30 Min bis zum Wochenziel.");
        assert_eq!(HomeNudge::GoalInReach { minutes_left: 60.0 }.message(), " Nur noch 1 h bis zum Wochenziel.");
        assert_eq!(HomeNudge::GoalReached.message(), " Das Wochenziel hast du schon geschafft.");
        assert_eq!(HomeNudge::TodayProgress { minutes: 25 }.message(), " Heute schon 25 Min gelernt.");
        assert_eq!(HomeNudge::TodayProgress { minutes: 90 }.message(), " Heute schon 1 h 30 gelernt.");
    }

    #[test]
    fn weekday_und_totals() {
        // 1970-01-01 war Donnerstag (Index 3: Mo=0, Di=1, Mi=2, Do=3, Fr=4, Sa=5, So=6)
        assert_eq!(weekday_index(0, &0i64), 3);
        // 1970-01-05 war Montag (Index 0)
        assert_eq!(weekday_index(4 * 86_400 * 1000, &0i64), 0);
        // 1970-01-04 war Sonntag (Index 6)
        assert_eq!(weekday_index(3 * 86_400 * 1000, &0i64), 6);

        // Zeitzonen-Versatz: 1970-01-01 23:30 UTC ist mit +60min (UTC+1) der 1970-01-02 (Freitag, Index 4)
        let utc_2330 = (23 * 3600 + 30 * 60) * 1000;
        assert_eq!(weekday_index(utc_2330, &0i64), 3);
        assert_eq!(weekday_index(utc_2330, &60i64), 4);

        // normalize_week_goal
        assert_eq!(normalize_week_goal(0), 300);
        assert_eq!(normalize_week_goal(29), 300);
        assert_eq!(normalize_week_goal(30), 30);
        assert_eq!(normalize_week_goal(480), 480);

        // totals_by_day mit live-Sitzung ersetzt gespeicherte Fassung derselben Sitzungs-ID
        let s1 = LearningSessionData {
            id: "s1".into(),
            started_at: "2026-11-07T10:00:00.000Z".into(),
            ended_at: Some("2026-11-07T10:10:00.000Z".into()),
            duration_seconds: 600,
            segments: vec![TimeSegment {
                started_at: "2026-11-07T10:00:00.000Z".into(),
                ended_at: "2026-11-07T10:10:00.000Z".into(),
            }],
            category: "cards".into(),
            subject: None,
            subject_source: None,
            source_id: None,
        };
        let live = LearningSessionData {
            id: "s1".into(),
            started_at: "2026-11-07T10:00:00.000Z".into(),
            ended_at: Some("2026-11-07T10:20:00.000Z".into()),
            duration_seconds: 1200,
            segments: vec![TimeSegment {
                started_at: "2026-11-07T10:00:00.000Z".into(),
                ended_at: "2026-11-07T10:20:00.000Z".into(),
            }],
            category: "cards".into(),
            subject: None,
            subject_source: None,
            source_id: None,
        };
        let totals = totals_by_day(std::slice::from_ref(&s1), Some(&live), &0i64);
        assert_eq!(totals.get("2026-11-07"), Some(&1200));

        // Sommerzeit: 22:30 UTC im Juli ist 00:30 MESZ am Folgetag, auch wenn jetzt Winterzeit ist.
        let summer = (
            Timestamp::parse_iso("2026-03-29T01:00:00Z").unwrap().millis(),
            Timestamp::parse_iso("2026-10-25T01:00:00Z").unwrap().millis(),
        );
        let berlin = impala_srs::CachedZone::new(|ms| if ms >= summer.0 && ms < summer.1 { 120 } else { 60 });
        let night = LearningSessionData {
            id: "s2".into(),
            started_at: "2026-07-10T22:30:00.000Z".into(),
            ended_at: Some("2026-07-10T22:40:00.000Z".into()),
            duration_seconds: 600,
            segments: vec![],
            ..s1
        };
        let totals = totals_by_day(&[night], None, &berlin);
        assert_eq!(totals.get("2026-07-11"), Some(&600));
    }
}
