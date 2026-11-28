//! Lernwarteschlange (`computeStudySnapshot`/`dueCards` in `web/state.js`), Anki-ähnlich:
//! 1. Lernschritte, die jetzt fällig sind (zeitkritisch, ohne Limit),
//! 2. fällige Wiederholungen (Tageslimit je Stapel),
//! 3. neue Karten (Tageslimit; gesperrt, wenn das Wiederholungslimit voll ist).
//!
//! Ist sonst nichts da, werden Lernschritte bis 20 Minuten vorgezogen. Wiederholungen planen nach
//! Lerntagen (wie Anki): fällig ist, was vor dem Ende des heutigen Lerntags fällig wird – egal zu
//! welcher Uhrzeit gestern bewertet wurde. Ein Lerntag beginnt um [`DAY_CUTOFF_HOURS`] Uhr Ortszeit,
//! damit Lernen nach Mitternacht noch zum Vortag zählt. Tagesgrenzen und Einstellungen kommen vom
//! Aufrufer – der Kern kennt weder Zeitzone noch localStorage.

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};

use impala_sort::SortExt;
use impala_srs::Timestamp;
use serde_json::Value;

use crate::js;
use crate::tree::{DeckConf, deck_in_tree};
use crate::types::{Card, Review, State};

pub const LEARN_AHEAD_MS: i64 = 20 * 60_000;
/// Frisch bewertete Karten nicht vorzeitig per Learn-Ahead zeigen.
pub const OVERLEARN_LOCK_MS: i64 = 10 * 60_000;
/// Beginn des Lerntags (Stunde Ortszeit, wie Ankis „Nächster Tag beginnt um“).
pub const DAY_CUTOFF_HOURS: i64 = 4;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StudyOptions<'a> {
    /// Stapel-Teilbaum (`None`: alle).
    pub deck: Option<&'a str>,
    pub now: Timestamp,
    /// Beginn des heutigen bzw. morgigen Lerntags (Ortszeit, [`DAY_CUTOFF_HOURS`] Uhr).
    pub day_start: Timestamp,
    pub day_end: Timestamp,
    /// „Gemischt lernen“: Wiederholungen und neue Karten stapelübergreifend mischen.
    pub mix: bool,
    /// Overlearning-Sperre (Einstellung, Standard an).
    pub overlearn_lock: bool,
}

impl<'a> StudyOptions<'a> {
    /// Lerntag-Grenzen für einen festen UTC-Versatz in Minuten (z. B. +60 für MEZ).
    pub fn with_offset(deck: Option<&'a str>, now: Timestamp, offset_minutes: i64) -> Self {
        let day = impala_srs::MS_PER_DAY;
        let off = offset_minutes * 60_000 - DAY_CUTOFF_HOURS * 3_600_000;
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

fn due_ref(c: &Card) -> &Value {
    c.srs().and_then(|s| s.get("due")).unwrap_or(&Value::Null)
}

fn by_due(a: &&Card, b: &&Card) -> std::cmp::Ordering {
    let (x, y) = (due_ref(a), due_ref(b));
    if js::value_lt(x, y) {
        std::cmp::Ordering::Less
    } else if js::value_lt(y, x) {
        std::cmp::Ordering::Greater
    } else {
        std::cmp::Ordering::Equal
    }
}

type DeckUsage<'s> = HashMap<Cow<'s, str>, f64>;

struct ReviewUsage<'s> {
    used_new: DeckUsage<'s>,
    used_rev: DeckUsage<'s>,
    fresh: HashSet<&'s str>,
}

struct PreparedStudy<'s> {
    ahead_iso: Value,
    learn_due: Vec<&'s Card>,
    learn_waiting: Vec<&'s Card>,
    reviews_raw: Vec<&'s Card>,
    new_raw: Vec<&'s Card>,
}

fn finalize_counts(
    learn_due_cnt: usize,
    learn_waiting_cnt: usize,
    limited_rev_cnt: usize,
    limited_new_cnt: usize,
    ahead_free_cnt: usize,
) -> (StudyCounts, bool, bool) {
    let base_due = learn_due_cnt + limited_rev_cnt + limited_new_cnt;
    let due_now_cnt = if base_due > 0 { base_due } else { ahead_free_cnt };
    let available = due_now_cnt > 0;
    let counts = StudyCounts {
        learn: learn_due_cnt + learn_waiting_cnt,
        learn_now: learn_due_cnt,
        learn_waiting: learn_waiting_cnt,
        review: limited_rev_cnt,
        new: limited_new_cnt,
        total: due_now_cnt + if available { 0 } else { learn_waiting_cnt },
    };
    let done = !available && learn_waiting_cnt == 0;
    (counts, available, done)
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
    fn review_deck<'a>(&'a self, r: &'a Review) -> Cow<'a, str> {
        fn field<'x>(typed: Option<&'x str>, extra: &'x crate::js::Object) -> Option<Cow<'x, str>> {
            if let Some(s) = typed {
                return (!s.is_empty()).then_some(Cow::Borrowed(s));
            }
            extra.get("deck").filter(|v| js::truthy(v)).map(|v| Cow::Owned(js::to_string(v)))
        }
        field(r.deck.as_deref(), &r.extra)
            .or_else(|| {
                let card = r.card_id.as_deref().and_then(|id| self.cards.get(id))?;
                field(card.deck.as_deref(), &card.extra)
            })
            .unwrap_or(Cow::Borrowed("Standard"))
    }

    fn prepare_study<'s>(&'s self, now: Timestamp, day_end: Timestamp, deck: Option<&str>) -> PreparedStudy<'s> {
        let t_iso = Value::from(now.to_iso());
        let eod_iso = Value::from(day_end.to_iso());
        let ahead_iso = Value::from(now.add_millis(LEARN_AHEAD_MS).to_iso());
        let (mut learn_due, mut learn_waiting, mut reviews_raw, mut new_raw) =
            (Vec::new(), Vec::new(), Vec::new(), Vec::new());
        for c in self.cards.values() {
            if c.is_trashed()
                || self.is_card_archived(c)
                || c.is_suspended()
                || !c.srs().is_some_and(js::truthy)
                || !deck.is_none_or(|d| deck_in_tree(c.deck_name(), d))
            {
                continue;
            }
            let d = due_ref(c);
            match c.srs_state() {
                Some("learning" | "relearning") => {
                    if le(d, &t_iso) {
                        learn_due.push(c);
                    } else if js::value_lt(&t_iso, d) && js::value_lt(d, &eod_iso) {
                        learn_waiting.push(c);
                    }
                }
                // Wiederholungen nach Lerntag (alles bis Tagesende), neue Karten ab ihrem Zeitpunkt.
                Some("review") if js::value_lt(d, &eod_iso) => reviews_raw.push(c),
                Some("new") if le(d, &t_iso) => new_raw.push(c),
                _ => {}
            }
        }
        learn_due.sort_small_by(by_due);
        learn_waiting.sort_small_by(by_due);
        reviews_raw.sort_small_by(by_due);
        new_raw.sort_small_by(by_due);
        PreparedStudy { ahead_iso, learn_due, learn_waiting, reviews_raw, new_raw }
    }

    /// Tagesverbrauch (Lernschritte zählen nicht) und frisch bewertete Karten für die
    /// Overlearning-Sperre in einem Durchlauf über das Review-Protokoll.
    fn collect_review_usage<'s>(
        &'s self,
        day_start: Timestamp,
        now: Timestamp,
        collect_fresh: bool,
    ) -> ReviewUsage<'s> {
        let cut = day_start.to_iso();
        let lock_cut = collect_fresh.then(|| now.add_millis(-OVERLEARN_LOCK_MS).to_iso());
        let (mut used_new, mut used_rev): (DeckUsage<'s>, DeckUsage<'s>) = Default::default();
        let mut fresh = HashSet::new();
        // Nicht chronologisch: Sync hängt ältere Einträge hinten an, darum ganz durchlaufen.
        for r in &self.reviews {
            let t = r.t();
            if !js::lt(t, &cut) && !r.truthy("learning") {
                let d = self.review_deck(r);
                let m = if r.truthy("first") { &mut used_new } else { &mut used_rev };
                *m.entry(d).or_default() += 1.0;
            }
            if let Some(lock_cut) = &lock_cut
                && js::lt(lock_cut, t)
                && let Some(cid) = r.card_id.as_deref()
            {
                fresh.insert(cid);
            }
        }
        ReviewUsage { used_new, used_rev, fresh }
    }

    fn take_limited<'s>(
        &'s self,
        list: impl Iterator<Item = &'s Card>,
        new: bool,
        used_new: &mut DeckUsage<'s>,
        used_rev: &mut DeckUsage<'s>,
        conf_cache: &mut HashMap<&'s str, DeckConf>,
        mut on_take: impl FnMut(&'s Card),
    ) {
        for c in list {
            let d = c.deck_name();
            let conf = conf_cache.entry(d).or_insert_with(|| self.deck_conf(d));
            let rev = Value::from(used_rev.get(d).copied().unwrap_or(0.0));
            if js::value_ge(&rev, conf.rev_per_day()) {
                continue;
            }
            if new {
                let n = Value::from(used_new.get(d).copied().unwrap_or(0.0));
                if js::value_ge(&n, conf.new_per_day()) {
                    continue;
                }
                *used_new.entry(Cow::Borrowed(d)).or_default() += 1.0;
            } else {
                *used_rev.entry(Cow::Borrowed(d)).or_default() += 1.0;
            }
            on_take(c);
        }
    }

    /// Lernstand jetzt (`computeStudySnapshot`).
    pub fn study_snapshot<'s>(&'s self, o: &StudyOptions) -> StudySnapshot {
        let prep = self.prepare_study(o.now, o.day_end, o.deck);
        let learn_ahead: Vec<&Card> =
            prep.learn_waiting.iter().copied().filter(|c| le(due_ref(c), &prep.ahead_iso)).collect();
        let learn_later: Vec<&Card> =
            prep.learn_waiting.iter().copied().filter(|c| js::value_lt(&prep.ahead_iso, due_ref(c))).collect();

        let ReviewUsage { mut used_new, mut used_rev, fresh } =
            self.collect_review_usage(o.day_start, o.now, o.overlearn_lock);
        let mut conf_cache: HashMap<&'s str, DeckConf> = HashMap::new();
        let mut limited_rev = Vec::new();
        self.take_limited(
            prep.reviews_raw.iter().copied(),
            false,
            &mut used_new,
            &mut used_rev,
            &mut conf_cache,
            |c| limited_rev.push(c),
        );
        let mut limited_new = Vec::new();
        self.take_limited(prep.new_raw.iter().copied(), true, &mut used_new, &mut used_rev, &mut conf_cache, |c| {
            limited_new.push(c);
        });

        let ahead_free: Vec<&Card> = if o.overlearn_lock {
            learn_ahead.iter().copied().filter(|c| !fresh.contains(c.id())).collect()
        } else {
            learn_ahead.clone()
        };
        let locked_ahead = learn_ahead.len() - ahead_free.len();
        let ahead_free_len = ahead_free.len();

        let mut rev_new: Vec<&Card> = limited_rev.iter().chain(limited_new.iter()).copied().collect();
        if o.mix {
            let day = &o.now.to_iso()[..10];
            rev_new.sort_small_by_key(|c| mix_key(c.id(), day));
        }
        let mut due_now: Vec<&Card> = prep.learn_due.iter().chain(rev_new.iter()).copied().collect();
        if due_now.is_empty() && !ahead_free.is_empty() {
            due_now = ahead_free;
        }
        let next_learn_at = prep.learn_waiting.first().and_then(|c| c.srs_due()).map(str::to_owned);
        let (counts, available, done) = finalize_counts(
            prep.learn_due.len(),
            prep.learn_waiting.len(),
            limited_rev.len(),
            limited_new.len(),
            ahead_free_len,
        );
        let ids = |v: &[&Card]| v.iter().map(|c| c.id().to_owned()).collect::<Vec<_>>();
        StudySnapshot {
            counts,
            due_now: ids(&due_now),
            learn_due: ids(&prep.learn_due),
            learn_waiting: ids(&prep.learn_waiting),
            learn_later_today: ids(&learn_later),
            reviews_due: ids(&limited_rev),
            new_due: ids(&limited_new),
            next_learn_at,
            locked_ahead,
            done,
            finished_for_now: !available,
            available,
        }
    }

    /// Zähler und `done` für viele Stapel auf einmal (für [`State::deck_tree`]): wertet Karten,
    /// Reviews und Tageslimits genau einmal in O(C + D·Tiefe) aus und summiert je Teilbaum auf.
    pub(crate) fn deck_tree_counts<'a>(
        &'a self,
        decks: &[String],
        study_opts_fn: impl Fn(&str) -> StudyOptions<'_>,
    ) -> Vec<(StudyCounts, bool)> {
        let all_opts: Vec<StudyOptions<'_>> = decks.iter().map(|d| study_opts_fn(d)).collect();
        let Some(first) = all_opts.first() else { return Vec::new() };
        let same_window = all_opts.iter().all(|o| {
            (o.now, o.day_start, o.day_end, o.overlearn_lock)
                == (first.now, first.day_start, first.day_end, first.overlearn_lock)
        });
        if !same_window {
            return all_opts
                .iter()
                .map(|o| {
                    let s = self.study_snapshot(o);
                    (s.counts, s.done)
                })
                .collect();
        }

        #[derive(Default, Clone, Copy)]
        struct Bucket {
            learn_due: usize,
            learn_waiting: usize,
            ahead_free: usize,
            raw_rev: usize,
            raw_new: usize,
            limited_rev: usize,
            limited_new: usize,
        }
        impl Bucket {
            fn add_counts(&mut self, other: Bucket) {
                self.learn_due += other.learn_due;
                self.learn_waiting += other.learn_waiting;
                self.ahead_free += other.ahead_free;
                self.limited_rev += other.limited_rev;
                self.limited_new += other.limited_new;
            }
        }

        let t_iso = Value::from(first.now.to_iso());
        let eod_iso = Value::from(first.day_end.to_iso());
        let ahead_iso = Value::from(first.now.add_millis(LEARN_AHEAD_MS).to_iso());
        let ReviewUsage { used_new, used_rev, fresh } =
            self.collect_review_usage(first.day_start, first.now, first.overlearn_lock);

        let mut per_deck: HashMap<&'a str, Bucket> = HashMap::new();
        for c in self.cards.values() {
            if c.is_trashed()
                || self.is_card_archived(c)
                || c.is_suspended()
                || !c.srs().is_some_and(js::truthy)
            {
                continue;
            }
            let d = due_ref(c);
            let deck = c.deck_name();
            match c.srs_state() {
                Some("learning" | "relearning") => {
                    if le(d, &t_iso) {
                        per_deck.entry(deck).or_default().learn_due += 1;
                    } else if js::value_lt(&t_iso, d) && js::value_lt(d, &eod_iso) {
                        let b = per_deck.entry(deck).or_default();
                        b.learn_waiting += 1;
                        if le(d, &ahead_iso) && (!first.overlearn_lock || !fresh.contains(c.id())) {
                            b.ahead_free += 1;
                        }
                    }
                }
                Some("review") if js::value_lt(d, &eod_iso) => per_deck.entry(deck).or_default().raw_rev += 1,
                Some("new") if le(d, &t_iso) => per_deck.entry(deck).or_default().raw_new += 1,
                _ => {}
            }
        }

        // Tageslimits gelten je eigenem Stapel der Karte und sind unabhängig vom abgefragten Elternstapel.
        let mut total_all = Bucket::default();
        let mut subtree: HashMap<&'a str, Bucket> = HashMap::with_capacity(per_deck.len() * 2);
        for (deck, mut b) in per_deck {
            if b.raw_rev > 0 || b.raw_new > 0 {
                let conf = self.deck_conf(deck);
                let rev_limit = conf.rev_per_day();
                let mut u_rev = used_rev.get(deck).copied().unwrap_or(0.0);
                for _ in 0..b.raw_rev {
                    if js::value_ge(&Value::from(u_rev), rev_limit) {
                        break;
                    }
                    u_rev += 1.0;
                    b.limited_rev += 1;
                }
                if b.raw_new > 0 && !js::value_ge(&Value::from(u_rev), rev_limit) {
                    let new_limit = conf.new_per_day();
                    let mut u_new = used_new.get(deck).copied().unwrap_or(0.0);
                    for _ in 0..b.raw_new {
                        if js::value_ge(&Value::from(u_new), new_limit) {
                            break;
                        }
                        u_new += 1.0;
                        b.limited_new += 1;
                    }
                }
            }
            total_all.add_counts(b);
            let mut cur = (!deck.is_empty()).then_some(deck);
            while let Some(anc) = cur {
                subtree.entry(anc).or_default().add_counts(b);
                cur = crate::tree::deck_parent(anc);
            }
        }

        all_opts
            .into_iter()
            .map(|o| {
                let b = match o.deck {
                    None => total_all,
                    Some(d) => subtree.get(d).copied().unwrap_or_default(),
                };
                let (counts, _, done) =
                    finalize_counts(b.learn_due, b.learn_waiting, b.limited_rev, b.limited_new, b.ahead_free);
                (counts, done)
            })
            .collect()
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

    #[test]
    fn lerntag_beginnt_um_vier() {
        let t = |s| Timestamp::parse_iso(s).unwrap();
        // MEZ (+60): 02:30 Ortszeit zählt noch zum Vortag
        let o = StudyOptions::with_offset(None, t("2026-11-04T01:30:00Z"), 60);
        assert_eq!((o.day_start, o.day_end), (t("2026-11-03T03:00:00Z"), t("2026-11-04T03:00:00Z")));
        let o = StudyOptions::with_offset(None, t("2026-11-04T09:00:00Z"), 60);
        assert_eq!((o.day_start, o.day_end), (t("2026-11-04T03:00:00Z"), t("2026-11-05T03:00:00Z")));
    }

    #[test]
    fn deck_tree_counts_identisch_zu_study_snapshot() {
        use crate::types::{Deck, Review};
        use serde_json::json;

        let mut st = State::default();
        for name in ["Mathe", "Mathe::Analysis", "Mathe::LinAlg", "Bio"] {
            st.decks.insert(name.into(), Deck::new(name, "2026-01-01T00:00:00Z"));
        }
        let mut archived = Deck::new("Alt", "2026-01-01T00:00:00Z");
        archived.archived = Some(true);
        st.decks.insert("Alt".into(), archived);
        st.settings.deck_conf = Some(
            json!({
                "*": { "newPerDay": 2, "revPerDay": 3 },
                "Mathe": { "newPerDay": 1, "revPerDay": 2 },
                "Mathe::LinAlg": { "newPerDay": 3, "revPerDay": 1 }
            })
            .as_object()
            .unwrap()
            .clone(),
        );

        let add_card = |st: &mut State, id: &str, deck: &str, state: &str, due: &str, flags: (bool, bool, bool)| {
            let mut c = Card {
                id: Some(id.into()),
                deck: Some(deck.into()),
                trashed: flags.0.then_some(true),
                suspended: flags.1.then_some(true),
                archived: flags.2.then_some(true),
                ..Default::default()
            };
            c.extra.insert("srs".into(), json!({ "state": state, "due": due }));
            st.cards.insert(id.into(), c);
        };

        let now = Timestamp::parse_iso("2026-11-04T12:00:00Z").unwrap();
        // Fällige Lernkarten, Learn-Ahead (mit/ohne Overlearn-Lock), spätere heute, morgen
        add_card(&mut st, "l_due", "Mathe::Analysis", "learning", "2026-11-04T11:55:00Z", (false, false, false));
        add_card(
            &mut st,
            "l_ahead_locked",
            "Mathe::LinAlg",
            "relearning",
            "2026-11-04T12:05:00Z",
            (false, false, false),
        );
        add_card(&mut st, "l_ahead_free", "Bio", "learning", "2026-11-04T12:15:00Z", (false, false, false));
        add_card(&mut st, "l_later", "Standard", "learning", "2026-11-04T18:00:00Z", (false, false, false));
        // Wiederholungen + neue Karten über Limits hinaus
        for i in 0..4 {
            add_card(
                &mut st,
                &format!("r_ma_{i}"),
                "Mathe::Analysis",
                "review",
                &format!("2026-11-04T0{i}:00:00Z"),
                (false, false, false),
            );
            add_card(
                &mut st,
                &format!("n_ma_{i}"),
                "Mathe::Analysis",
                "new",
                "2026-11-01T00:00:00Z",
                (false, false, false),
            );
        }
        add_card(&mut st, "r_la", "Mathe::LinAlg", "review", "2026-11-04T10:00:00Z", (false, false, false));
        add_card(&mut st, "n_la", "Mathe::LinAlg", "new", "2026-11-04T10:00:00Z", (false, false, false));
        add_card(&mut st, "r_future", "Bio", "review", "2026-11-06T00:00:00Z", (false, false, false));
        add_card(&mut st, "ignored_trashed", "Bio", "new", "2026-11-01T00:00:00Z", (true, false, false));
        add_card(&mut st, "ignored_susp", "Bio", "new", "2026-11-01T00:00:00Z", (false, true, false));
        add_card(&mut st, "ignored_arch", "Alt", "new", "2026-11-01T00:00:00Z", (false, false, false));

        // Reviews heute: ein frisches Lern-Review (Overlearn-Lock), ein Review in Mathe::LinAlg (füllt revPerDay=1)
        st.reviews = vec![
            Review {
                id: Some("rv1".into()),
                card_id: Some("l_ahead_locked".into()),
                deck: Some("Mathe::LinAlg".into()),
                t: Some("2026-11-04T11:58:00Z".into()),
                learning: Some(true),
                ..Default::default()
            },
            Review {
                id: Some("rv2".into()),
                card_id: Some("r_la".into()),
                deck: Some("Mathe::LinAlg".into()),
                t: Some("2026-11-04T09:00:00Z".into()),
                first: Some(false),
                learning: Some(false),
                ..Default::default()
            },
            // Alt-Review vor Tagesbeginn zählt nicht zum Tageslimit
            Review {
                id: Some("rv_old".into()),
                card_id: Some("r_ma_0".into()),
                deck: Some("Mathe::Analysis".into()),
                t: Some("2026-11-03T09:00:00Z".into()),
                first: Some(false),
                learning: Some(false),
                ..Default::default()
            },
        ];

        fn make_opts(name: &str, now: Timestamp, overlearn_lock: bool, mix: bool) -> StudyOptions<'_> {
            let mut o = StudyOptions::with_offset(Some(name), now, 60);
            o.overlearn_lock = overlearn_lock;
            o.mix = mix;
            o
        }

        let names = st.active_deck_names(None);
        for overlearn_lock in [true, false] {
            for mix in [false, true] {
                let fast = st.deck_tree_counts(&names, |name| make_opts(name, now, overlearn_lock, mix));
                assert_eq!(fast.len(), names.len());
                for (name, (counts, done)) in names.iter().zip(&fast) {
                    let snap = st.study_snapshot(&make_opts(name, now, overlearn_lock, mix));
                    assert_eq!((*counts, *done), (snap.counts, snap.done), "deck={name}");
                }
                let tree = st.deck_tree(&HashSet::new(), |name| make_opts(name, now, overlearn_lock, mix));
                for entry in tree {
                    let snap = st.study_snapshot(&make_opts(&entry.name, now, overlearn_lock, mix));
                    assert_eq!(entry.new, snap.counts.new as u64);
                    assert_eq!(entry.learn, snap.counts.learn as u64);
                    assert_eq!(entry.learn_now, snap.counts.learn_now as u64);
                    assert_eq!(entry.review, snap.counts.review as u64);
                    assert_eq!(entry.open, !snap.done);
                }
            }
        }

        // Fallback bei abweichenden Optionen je Stapel
        let fallback = st.deck_tree_counts(&names, |name| make_opts(name, now, name == "Mathe::LinAlg", false));
        for (name, (counts, done)) in names.iter().zip(&fallback) {
            let snap = st.study_snapshot(&make_opts(name, now, name == "Mathe::LinAlg", false));
            assert_eq!((*counts, *done), (snap.counts, snap.done));
        }
    }
}
