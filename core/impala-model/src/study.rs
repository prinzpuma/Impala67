//! Lernwarteschlange (`computeStudySnapshot`/`dueCards` in `web/state.js`), Anki-ähnlich:
//! 1. Lernschritte, die jetzt fällig sind (zeitkritisch, ohne Limit),
//! 2. fällige Wiederholungen (Tageslimit je Stapel),
//! 3. neue Karten (Tageslimit; gesperrt, wenn das Wiederholungslimit voll ist).
//!
//! Ist sonst nichts da, werden Lernschritte bis 20 Minuten vorgezogen. Tagesgrenzen (lokale
//! Mitternacht) und Einstellungen kommen vom Aufrufer – der Kern kennt weder Zeitzone noch localStorage.

use std::collections::{HashMap, HashSet};

use impala_srs::Timestamp;
use serde_json::Value;

use crate::js;
use crate::tree::deck_in_tree;
use crate::types::{Card, State};

pub const LEARN_AHEAD_MS: i64 = 20 * 60_000;
/// Frisch bewertete Karten nicht vorzeitig per Learn-Ahead zeigen.
pub const OVERLEARN_LOCK_MS: i64 = 10 * 60_000;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StudyOptions<'a> {
    /// Stapel-Teilbaum (`None`: alle).
    pub deck: Option<&'a str>,
    pub now: Timestamp,
    /// Lokale Mitternacht heute bzw. morgen.
    pub day_start: Timestamp,
    pub day_end: Timestamp,
    /// „Gemischt lernen“: Wiederholungen und neue Karten stapelübergreifend mischen.
    pub mix: bool,
    /// Overlearning-Sperre (Einstellung, Standard an).
    pub overlearn_lock: bool,
}

impl<'a> StudyOptions<'a> {
    /// Tagesgrenzen für einen festen UTC-Versatz in Minuten (z. B. +60 für MEZ).
    pub fn with_offset(deck: Option<&'a str>, now: Timestamp, offset_minutes: i64) -> Self {
        let day = impala_srs::MS_PER_DAY;
        let off = offset_minutes * 60_000;
        let start = (now.millis() + off).div_euclid(day) * day - off;
        StudyOptions {
            deck,
            now,
            day_start: Timestamp(start),
            day_end: Timestamp(start + day),
            mix: false,
            overlearn_lock: true,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct StudyCounts {
    /// Alle offenen Lernschritte heute.
    pub learn: usize,
    pub learn_now: usize,
    pub learn_waiting: usize,
    pub review: usize,
    pub new: usize,
    pub total: usize,
}

/// Lernstand; Listen enthalten Karten-IDs in Lernreihenfolge.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct StudySnapshot {
    pub due_now: Vec<String>,
    pub learn_due: Vec<String>,
    pub learn_waiting: Vec<String>,
    pub learn_later_today: Vec<String>,
    pub reviews_due: Vec<String>,
    pub new_due: Vec<String>,
    pub counts: StudyCounts,
    /// Fälligkeit des nächsten Lernschritts heute (wie gespeichert).
    pub next_learn_at: Option<String>,
    /// Durch die Overlearning-Sperre zurückgehaltene Karten.
    pub locked_ahead: usize,
    /// Heute wirklich nichts mehr (auch keine späteren Lernschritte).
    pub done: bool,
    /// Anki „für jetzt fertig“ (später heute noch Lernschritte).
    pub finished_for_now: bool,
    pub available: bool,
}

/// `a <= b` mit JS-Vergleich.
fn le(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::String(x), Value::String(y)) => !js::lt(y, x),
        _ => js::to_number(Some(a)) <= js::to_number(Some(b)),
    }
}

fn due(c: &Card) -> Value {
    c.srs().and_then(|s| s.get("due")).cloned().unwrap_or(Value::Null)
}

fn by_due(a: &&Card, b: &&Card) -> std::cmp::Ordering {
    let (x, y) = (due(a), due(b));
    if js::value_lt(&x, &y) {
        std::cmp::Ordering::Less
    } else if js::value_lt(&y, &x) {
        std::cmp::Ordering::Greater
    } else {
        std::cmp::Ordering::Equal
    }
}

/// Stabile Misch-Reihenfolge je Tag (`((h << 5) - h + code) | 0` über UTF-16).
fn mix_key(id: &str, day: &str) -> i32 {
    let mut h: i32 = 0;
    for u in id.encode_utf16().chain(day.encode_utf16()) {
        h = (h << 5).wrapping_sub(h).wrapping_add(i32::from(u));
    }
    h
}

impl State {
    /// Lernstand jetzt (`computeStudySnapshot`).
    pub fn study_snapshot<'s>(&'s self, o: &StudyOptions) -> StudySnapshot {
        let t_iso = Value::from(o.now.to_iso());
        let eod_iso = Value::from(o.day_end.to_iso());
        let ahead_iso = Value::from(o.now.add_millis(LEARN_AHEAD_MS).to_iso());
        let state = |c: &Card| c.srs_state().map(str::to_owned);
        let all: Vec<&'s Card> = self
            .cards
            .values()
            .filter(|c| {
                !c.is_trashed()
                    && !self.is_card_archived(c)
                    && !c.is_suspended()
                    && c.srs().is_some_and(js::truthy)
                    && o.deck.is_none_or(|d| deck_in_tree(c.deck_name(), d))
            })
            .collect();
        let sorted = |mut v: Vec<&'s Card>| {
            v.sort_by(by_due);
            v
        };
        let learn_all: Vec<&Card> =
            all.iter().copied().filter(|c| matches!(state(c).as_deref(), Some("learning" | "relearning"))).collect();
        let learn_due = sorted(learn_all.iter().copied().filter(|c| le(&due(c), &t_iso)).collect());
        let learn_waiting = sorted(
            learn_all
                .iter()
                .copied()
                .filter(|c| js::value_lt(&t_iso, &due(c)) && js::value_lt(&due(c), &eod_iso))
                .collect(),
        );
        let learn_ahead: Vec<&Card> = learn_waiting.iter().copied().filter(|c| le(&due(c), &ahead_iso)).collect();
        let learn_later: Vec<&Card> =
            learn_waiting.iter().copied().filter(|c| js::value_lt(&ahead_iso, &due(c))).collect();
        let due_in = |s: &str| {
            sorted(all.iter().copied().filter(|c| state(c).as_deref() == Some(s) && le(&due(c), &t_iso)).collect())
        };
        let (reviews_raw, new_raw) = (due_in("review"), due_in("new"));

        // Tagesverbrauch aus dem Protokoll (Lernschritte zählen nicht). Nicht chronologisch:
        // Sync hängt ältere Einträge hinten an, darum ganz durchlaufen.
        let cut = o.day_start.to_iso();
        let (mut used_new, mut used_rev): (HashMap<String, f64>, HashMap<String, f64>) = Default::default();
        for r in &self.reviews {
            if js::lt(r.t(), &cut) || r.truthy("learning") {
                continue;
            }
            let d = js::or(r.get("deck").as_ref())
                .map(js::to_string)
                .or_else(|| {
                    let card = r.card_id.as_deref().and_then(|id| self.cards.get(id));
                    card.and_then(|c| js::or(c.get("deck").as_ref()).map(js::to_string))
                })
                .unwrap_or_else(|| "Standard".into());
            let m = if r.truthy("first") { &mut used_new } else { &mut used_rev };
            *m.entry(d).or_default() += 1.0;
        }
        let mut conf_cache = HashMap::new();
        let mut take = |list: &[&'s Card], new: bool, conf_cache: &mut HashMap<String, crate::tree::DeckConf>| {
            let mut out = Vec::new();
            for c in list {
                let d = c.deck_name().to_owned();
                let conf = conf_cache.entry(d.clone()).or_insert_with(|| self.deck_conf(&d)).clone();
                let rev = Value::from(used_rev.get(&d).copied().unwrap_or(0.0));
                if js::value_ge(&rev, conf.rev_per_day()) {
                    continue;
                }
                if new {
                    let n = Value::from(used_new.get(&d).copied().unwrap_or(0.0));
                    if js::value_ge(&n, conf.new_per_day()) {
                        continue;
                    }
                    *used_new.entry(d).or_default() += 1.0;
                } else {
                    *used_rev.entry(d).or_default() += 1.0;
                }
                out.push(*c);
            }
            out
        };
        let limited_rev = take(&reviews_raw, false, &mut conf_cache);
        let limited_new = take(&new_raw, true, &mut conf_cache);

        let lock_cut = o.now.add_millis(-OVERLEARN_LOCK_MS).to_iso();
        let fresh: HashSet<String> =
            self.reviews.iter().filter(|r| js::lt(&lock_cut, r.t())).filter_map(|r| r.card_id.clone()).collect();
        let ahead_free: Vec<&Card> = if o.overlearn_lock {
            learn_ahead.iter().copied().filter(|c| !fresh.contains(c.id())).collect()
        } else {
            learn_ahead.clone()
        };
        let locked_ahead = learn_ahead.len() - ahead_free.len();

        let mut rev_new: Vec<&Card> = limited_rev.iter().chain(limited_new.iter()).copied().collect();
        if o.mix {
            let day = &o.now.to_iso()[..10];
            rev_new.sort_by_key(|c| mix_key(c.id(), day));
        }
        let mut due_now: Vec<&Card> = learn_due.iter().chain(rev_new.iter()).copied().collect();
        if due_now.is_empty() && !ahead_free.is_empty() {
            due_now = ahead_free;
        }
        let next_learn_at = learn_waiting.first().and_then(|c| c.srs_due()).map(str::to_owned);
        let available = !due_now.is_empty();
        let ids = |v: &[&Card]| v.iter().map(|c| c.id().to_owned()).collect::<Vec<_>>();
        StudySnapshot {
            counts: StudyCounts {
                learn: learn_due.len() + learn_waiting.len(),
                learn_now: learn_due.len(),
                learn_waiting: learn_waiting.len(),
                review: limited_rev.len(),
                new: limited_new.len(),
                total: due_now.len() + if available { 0 } else { learn_waiting.len() },
            },
            due_now: ids(&due_now),
            learn_due: ids(&learn_due),
            learn_waiting: ids(&learn_waiting),
            learn_later_today: ids(&learn_later),
            reviews_due: ids(&limited_rev),
            new_due: ids(&limited_new),
            next_learn_at,
            locked_ahead,
            done: !available && learn_waiting.is_empty(),
            finished_for_now: !available,
            available,
        }
    }

    /// Jetzt fällige Karten in Lernreihenfolge (`dueCards`).
    pub fn due_cards(&self, o: &StudyOptions) -> Vec<String> {
        self.study_snapshot(o).due_now
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mischschluessel_wie_js() {
        // ("a" + "2026-01-01") in JS: 1425283447 (per Hand nachgerechnet über (h<<5)-h+c | 0)
        let mut h: i64 = 0;
        for u in "a2026-01-01".encode_utf16() {
            h = (((h << 5) - h + i64::from(u)) as i32).into();
        }
        assert_eq!(mix_key("a", "2026-01-01") as i64, h);
    }
}
