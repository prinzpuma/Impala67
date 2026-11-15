//! UniFFI-Export für Lernanalyse und Lernmuster (Android / iOS).

use std::collections::HashSet;

use impala_model::analysis::{
    GoalAnalysis, HomeAnalysis as CoreHomeAnalysis, PatternData as CorePatternData, compute_goal as core_compute_goal,
};

use crate::ImpalaCore;

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct Goal {
    pub goal_min: i32,
    pub days: Vec<f64>,
    pub done: f64,
    pub today: i32,
    pub pace: f64,
    pub need: f64,
    pub left: i32,
    pub text: String,
    pub warn: bool,
    pub reach_day: Option<i32>,
}

impl From<GoalAnalysis> for Goal {
    fn from(g: GoalAnalysis) -> Self {
        Goal {
            goal_min: g.goal_min as i32,
            days: g.days,
            done: g.done,
            today: g.today as i32,
            pace: g.pace,
            need: g.need,
            left: g.left as i32,
            text: g.text,
            warn: g.warn,
            reach_day: g.reach_day.map(|d| d as i32),
        }
    }
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct SubjectRow {
    pub subject: String,
    pub now: f64,
    pub before: f64,
    pub delta: i32,
    pub deck: String,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct Subjects {
    pub rows: Vec<SubjectRow>,
    pub worst: Option<SubjectRow>,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct Slot {
    pub label: String,
    pub hint: String,
    pub n: i32,
    pub rate: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct BestTime {
    pub slots: Vec<Slot>,
    pub best: Option<Slot>,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct DueWeek {
    pub counts: Vec<i32>,
    pub labels: Vec<String>,
    pub peak: i32,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct HomeAnalysis {
    pub goal: Goal,
    pub subjects: Subjects,
    pub time: BestTime,
    pub forecast: DueWeek,
    pub headline: String,
    pub action: Option<String>,
    pub action_deck: Option<String>,
}

impl From<CoreHomeAnalysis> for HomeAnalysis {
    fn from(a: CoreHomeAnalysis) -> Self {
        HomeAnalysis {
            goal: a.goal.into(),
            subjects: Subjects {
                rows: a
                    .subjects
                    .rows
                    .into_iter()
                    .map(|r| SubjectRow {
                        subject: r.subject,
                        now: r.now,
                        before: r.before,
                        delta: r.delta,
                        deck: r.deck,
                    })
                    .collect(),
                worst: a.subjects.worst.map(|r| SubjectRow {
                    subject: r.subject,
                    now: r.now,
                    before: r.before,
                    delta: r.delta,
                    deck: r.deck,
                }),
                text: a.subjects.text,
            },
            time: BestTime {
                slots: a
                    .time
                    .slots
                    .into_iter()
                    .map(|s| Slot { label: s.label, hint: s.hint, n: s.n as i32, rate: s.rate })
                    .collect(),
                best: a.time.best.map(|s| Slot { label: s.label, hint: s.hint, n: s.n as i32, rate: s.rate }),
                text: a.time.text,
            },
            forecast: DueWeek {
                counts: a.forecast.counts.into_iter().map(|c| c as i32).collect(),
                labels: a.forecast.labels,
                peak: a.forecast.peak.map_or(-1, |p| p as i32),
                text: a.forecast.text,
            },
            headline: a.headline,
            action: a.action,
            action_deck: a.action_deck,
        }
    }
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct RateRow {
    pub label: String,
    pub n: i32,
    pub rate: f64,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct HourRate {
    pub hour: i32,
    pub n: i32,
    pub rate: f64,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ExpRow {
    pub label: String,
    pub n: i32,
    pub average: f64,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ProblemPage {
    pub page_id: String,
    pub minutes: i32,
    pub lost: i32,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct PatternData {
    pub position: Vec<RateRow>,
    pub timer: Vec<RateRow>,
    pub hours: Option<Vec<HourRate>>,
    pub experiments: Vec<ExpRow>,
    pub problems: Vec<ProblemPage>,
    pub empty: bool,
}

impl From<CorePatternData> for PatternData {
    fn from(p: CorePatternData) -> Self {
        PatternData {
            position: p.position.into_iter().map(|r| RateRow { label: r.label, n: r.n as i32, rate: r.rate }).collect(),
            timer: p.timer.into_iter().map(|r| RateRow { label: r.label, n: r.n as i32, rate: r.rate }).collect(),
            hours: p.hours.map(|hrs| {
                hrs.into_iter().map(|h| HourRate { hour: h.hour as i32, n: h.n as i32, rate: h.rate }).collect()
            }),
            experiments: p
                .experiments
                .into_iter()
                .map(|e| ExpRow { label: e.label, n: e.n as i32, average: e.average })
                .collect(),
            problems: p
                .problems
                .into_iter()
                .map(|pr| ProblemPage { page_id: pr.page_id, minutes: pr.minutes as i32, lost: pr.lost as i32 })
                .collect(),
            empty: p.empty,
        }
    }
}

#[uniffi::export]
pub fn compute_goal(goal_min: i32, days: Vec<f64>, today: i32, pace: f64) -> Goal {
    core_compute_goal(goal_min.max(0) as u32, &days, today.clamp(0, 6) as u8, pace).into()
}

#[uniffi::export]
impl ImpalaCore {
    /// Lernanalyse der Startseite: `null`, falls es noch gar keine Lerndaten gibt.
    pub fn home_analysis(
        &self,
        now_ms: i64,
        tz_offset_minutes: i32,
        goal_min: i32,
        days: Vec<f64>,
        pace: f64,
    ) -> Option<HomeAnalysis> {
        let inner = self.lock();
        inner
            .model
            .state()
            .home_analysis(now_ms, tz_offset_minutes, goal_min.max(0) as u32, &days, pace)
            .map(Into::into)
    }

    /// Lernmuster des Statistik-Tabs (Position, Timer, Tageszeit, Experimente, Problemzonen).
    pub fn pattern_data(&self, live_pages: Option<Vec<String>>) -> PatternData {
        let inner = self.lock();
        let set = live_pages.map(|pages| pages.into_iter().collect::<HashSet<String>>());
        inner.model.state().pattern_data(set.as_ref()).into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn home_analysis_und_pattern_data_in_memory() {
        let core = ImpalaCore::open_in_memory().unwrap();
        // Noch keine Lerndaten -> None
        let a = core.home_analysis(1_700_000_000_000, 60, 60, vec![0.0; 7], 0.0);
        assert_eq!(a, None);

        let p = core.pattern_data(None);
        assert!(p.empty);
    }
}
