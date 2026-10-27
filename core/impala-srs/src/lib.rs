//! FSRS-Wiederholungsplanung der Karteikarten (Verhalten wie web/srs.js): FSRS-5 mit
//! Standardgewichten, Anki-Lernschritte (1 Min/10 Min, Neu-Lernen 10 Min) und Anki-Fuzz.
//!
//! Der Kartenzustand [`Srs`] hat dieselbe JSON-Form wie `card.srs` im JS (Events `cardReview`,
//! IndexedDB); unbekannte Zusatzfelder alter Karten bleiben erhalten.

mod fsrs;
mod time;

pub use fsrs::retrievability;
use fsrs::{
    MAX_INTERVAL_DAYS, MIN_STABILITY, forget_stability, fuzz_days, init_difficulty, init_stability, js_round,
    next_difficulty, next_interval, or, recall_stability, short_term_stability,
};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};
pub use time::{MS_PER_DAY, MS_PER_MINUTE, Timestamp};

/// Bewertung einer Wiederholung (JS `grade` 1…4).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(into = "u8", try_from = "u8")]
pub enum Rating {
    Again = 1,
    Hard = 2,
    Good = 3,
    Easy = 4,
}

impl Rating {
    pub const ALL: [Rating; 4] = [Rating::Again, Rating::Hard, Rating::Good, Rating::Easy];

    /// Nachsichtig wie JS: gerundet und auf 1…4 begrenzt, NaN → Nochmal.
    pub fn from_grade(grade: f64) -> Rating {
        match js_round(or(grade, 0.0)) {
            g if g >= 4.0 => Rating::Easy,
            g if g >= 3.0 => Rating::Good,
            g if g >= 2.0 => Rating::Hard,
            _ => Rating::Again,
        }
    }

    pub fn grade(self) -> u8 {
        self as u8
    }
}

impl From<Rating> for u8 {
    fn from(r: Rating) -> u8 {
        r.grade()
    }
}

impl TryFrom<u8> for Rating {
    type Error = String;
    fn try_from(g: u8) -> Result<Self, String> {
        match g {
            1..=4 => Ok(Rating::from_grade(f64::from(g))),
            _ => Err(format!("Bewertung {g} außerhalb 1…4")),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CardState {
    New,
    Learning,
    Review,
    Relearning,
}

impl<'de> Deserialize<'de> for CardState {
    /// Abweichung: unbekannte Zustände (Altdaten) werden zu `review` – genau so behandelt sie
    /// das JS beim Bewerten, schreibt den fremden Wert aber unverändert zurück.
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(match Value::deserialize(d)?.as_str() {
            Some("new") => CardState::New,
            Some("learning") => CardState::Learning,
            Some("relearning") => CardState::Relearning,
            _ => CardState::Review,
        })
    }
}

/// Fuzz der Tages-Intervalle (wie Anki), damit gemeinsam gelernte Karten nicht am selben Tag
/// fällig werden. Die Zufallszahl kommt vom Aufrufer – der Kern bleibt deterministisch.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Fuzz {
    Off,
    /// Gleichverteilte Zufallszahl in [0, 1).
    Sample(f64),
}

/// Lernstand einer Karte (`card.srs`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Srs {
    #[serde(default = "default_state")]
    pub state: CardState,
    /// Tage, nach denen die Abrufwahrscheinlichkeit auf 90 % fällt (0 bei neuen Karten).
    #[serde(default, deserialize_with = "number")]
    pub stability: f64,
    /// 1 (leicht) … 10 (schwer)
    #[serde(default, deserialize_with = "number")]
    pub difficulty: f64,
    pub due: Timestamp,
    #[serde(default, deserialize_with = "count")]
    pub reps: u32,
    #[serde(default, deserialize_with = "count")]
    pub lapses: u32,
    /// Index des aktuellen Lernschritts
    #[serde(default, deserialize_with = "count")]
    pub step: u32,
    /// Letzte Bewertung; fehlt bei neuen und manchen Altkarten (unlesbar ⇒ fehlt).
    #[serde(default, deserialize_with = "lenient_time")]
    pub last: Option<Timestamp>,
    /// Fremde Felder alter Versionen (z. B. `ease`, `interval`) – bleiben unverändert.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

const LEARN_STEPS: [f64; 2] = [1.0, 10.0]; // Minuten (wie Anki)
const RELEARN_STEPS: [f64; 1] = [10.0];

impl Srs {
    /// Neue Karte, sofort fällig ab `t`.
    pub fn new(t: Timestamp) -> Srs {
        Srs {
            state: CardState::New,
            stability: 0.0,
            difficulty: 5.0,
            due: t,
            reps: 0,
            lapses: 0,
            step: 0,
            last: None,
            extra: Map::new(),
        }
    }

    /// Neuer Zustand nach einer Bewertung zum Zeitpunkt `now`. `reps` zählt jede Bewertung,
    /// `lapses` jedes Vergessen einer Wiederholungskarte.
    pub fn rate(&self, rating: Rating, now: Timestamp, fuzz: Fuzz) -> Srs {
        let g = rating.grade();
        let mut s = self.clone();
        // Neue Stabilität mit der Schwierigkeit VOR dieser Bewertung (wie ts-fsrs/py-fsrs)
        let prev_difficulty = or(self.difficulty, 5.0);
        let elapsed_days = self.last.map_or(0.0, |l| now.days_since(l));
        s.reps = s.reps.saturating_add(1);
        s.last = Some(now);

        if self.state == CardState::New {
            s.state = CardState::Learning;
            s.step = 0;
            s.stability = init_stability(g);
            s.difficulty = init_difficulty(g);
        } else {
            s.difficulty = next_difficulty(prev_difficulty, g);
        }

        match s.state {
            CardState::Learning | CardState::Relearning => {
                let steps: &[f64] = if s.state == CardState::Relearning { &RELEARN_STEPS } else { &LEARN_STEPS };
                if self.state != CardState::New {
                    s.stability = short_term_stability(or(s.stability, init_stability(g)), g);
                }
                // Anki-Lernschritte: Nochmal → Schritt 0; Schwer → bei Schritt 0 Mittel aus
                // den ersten zwei Schritten (nur ein Schritt: 1,5×), sonst Schritt wiederholen;
                // Gut → nächster Schritt bzw. graduieren; Einfach → sofort graduieren.
                match rating {
                    Rating::Again => {
                        s.step = 0;
                        s.due = after_minutes(now, steps[0]);
                    }
                    Rating::Hard => {
                        let i = (s.step as usize).min(steps.len() - 1);
                        let mins = match (steps.len(), i) {
                            (1, _) => steps[0] * 1.5,
                            (_, 0) => (steps[0] + steps[1]) / 2.0,
                            _ => steps[i],
                        };
                        s.due = after_minutes(now, mins);
                    }
                    Rating::Good => {
                        s.step = s.step.saturating_add(1);
                        match steps.get(s.step as usize) {
                            Some(&m) => s.due = after_minutes(now, m),
                            None => s.graduate(now, fuzz),
                        }
                    }
                    Rating::Easy => s.graduate(now, fuzz),
                }
            }
            CardState::Review | CardState::New if rating == Rating::Again => {
                let r = retrievability(elapsed_days, s.stability);
                s.lapses = s.lapses.saturating_add(1);
                s.state = CardState::Relearning;
                s.step = 0;
                s.stability = forget_stability(prev_difficulty, s.stability, r);
                s.due = after_minutes(now, RELEARN_STEPS[0]);
            }
            CardState::Review | CardState::New => {
                let s0 = MIN_STABILITY.max(or(s.stability, init_stability(g)));
                let r = retrievability(elapsed_days, s0);
                s.stability = recall_stability(prev_difficulty, s0, r, g);
                s.due = after_days(now, next_interval(s.stability), fuzz);
            }
        }
        s
    }

    fn graduate(&mut self, now: Timestamp, fuzz: Fuzz) {
        self.state = CardState::Review;
        self.step = 0;
        self.due = after_days(now, next_interval(self.stability), fuzz);
    }

    /// Intervall-Vorschau für die vier Antwort-Knöpfe (ohne Fuzz), z. B. `["1 Min", "6 Min", "10 Min", "16 Tage"]`.
    pub fn preview(&self, now: Timestamp) -> [String; 4] {
        Rating::ALL.map(|r| format_interval((self.rate(r, now, Fuzz::Off).due.millis() - now.millis()) as f64))
    }

    /// Abrufwahrscheinlichkeit jetzt (Wissenslandkarte, graph.js); `None` bei neuen Karten.
    /// Ohne `last` (Altkarten) aus der Fälligkeit zurückgerechnet.
    pub fn retrievability_at(&self, now: Timestamp) -> Option<f64> {
        if self.state == CardState::New {
            return None;
        }
        let stability = MIN_STABILITY.max(or(self.stability, 0.5));
        let elapsed = match self.last {
            Some(l) => now.days_since(l),
            None => stability - self.due.days_since(now),
        };
        Some(retrievability(elapsed.max(0.0), stability))
    }
}

fn after_minutes(now: Timestamp, minutes: f64) -> Timestamp {
    let m = 0.0167_f64.max(or(minutes, 1.0));
    now.add_millis((m * MS_PER_MINUTE as f64) as i64)
}

fn after_days(now: Timestamp, days: i64, fuzz: Fuzz) -> Timestamp {
    let mut d = days.max(1);
    if let Fuzz::Sample(x) = fuzz {
        d = fuzz_days(d, x);
    }
    now.add_millis(d.clamp(1, MAX_INTERVAL_DAYS) * MS_PER_DAY)
}

/// Intervall als kurzer Text wie in Anki („10 Min“, „3 Std“, „1 Tag“, „16 Tage“, „2 Mon.“,
/// „1.2 Jahre“) – Texte exakt wie im JS.
pub fn format_interval(ms: f64) -> String {
    let min = ms / 60e3;
    if min < 60.0 {
        return format!("{} Min", 1.0_f64.max(js_round(min)));
    }
    let hours = min / 60.0;
    if hours < 23.5 {
        return format!("{} Std", js_round(hours));
    }
    let days = min / 1440.0;
    if days < 1.5 {
        "1 Tag".into()
    } else if days < 31.0 {
        format!("{} Tage", js_round(days))
    } else if days < 365.0 {
        format!("{} Mon.", js_round(days / 30.0))
    } else {
        format!("{} Jahre", js_round(days / 36.5) / 10.0)
    }
}

// ---------- nachsichtiges Lesen alter Karten ----------

fn default_state() -> CardState {
    CardState::New
}

/// Zahl oder 0 (fehlend, null, Text) – das JS ersetzt solche Werte über `|| Standard`.
fn number<'de, D: Deserializer<'de>>(d: D) -> Result<f64, D::Error> {
    Ok(Value::deserialize(d)?.as_f64().unwrap_or(0.0))
}

fn count<'de, D: Deserializer<'de>>(d: D) -> Result<u32, D::Error> {
    Ok(match Value::deserialize(d)?.as_f64() {
        Some(f) if f.is_finite() && f > 0.0 => f.min(f64::from(u32::MAX)) as u32,
        _ => 0,
    })
}

fn lenient_time<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Timestamp>, D::Error> {
    Ok(Value::deserialize(d)?.as_str().and_then(Timestamp::parse_iso))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(s: &str) -> Timestamp {
        Timestamp::parse_iso(s).unwrap()
    }

    #[test]
    fn neue_karte_einfach_ergibt_16_tage() {
        let now = t("2026-01-01T00:00:00.000Z");
        let c = Srs::new(now).rate(Rating::Easy, now, Fuzz::Off);
        assert_eq!(c.state, CardState::Review);
        assert_eq!(c.due, now.add_millis(16 * MS_PER_DAY));
        assert_eq!(Srs::new(now).preview(now), ["1 Min", "6 Min", "10 Min", "16 Tage"].map(String::from));
    }

    #[test]
    fn unbekannter_zustand_gilt_als_review_und_zusatzfelder_bleiben() {
        let c: Srs = serde_json::from_str(r#"{"state":"alt","due":"2026-01-01T00:00:00.000Z","ease":2500}"#).unwrap();
        assert_eq!(c.state, CardState::Review);
        let json = serde_json::to_value(c.rate(Rating::Good, t("2026-01-02T00:00:00.000Z"), Fuzz::Off)).unwrap();
        assert_eq!(json["ease"], 2500);
        assert_eq!(json["state"], "review");
        assert!(serde_json::from_str::<Srs>(r#"{"state":"new","due":"gestern"}"#).is_err());
    }

    #[test]
    fn bewertung_nachsichtig() {
        assert_eq!(Rating::from_grade(0.0), Rating::Again);
        assert_eq!(Rating::from_grade(2.5), Rating::Good);
        assert_eq!(Rating::from_grade(9.0), Rating::Easy);
        assert_eq!(Rating::from_grade(f64::NAN), Rating::Again);
        assert!(serde_json::from_str::<Rating>("5").is_err());
    }
}
