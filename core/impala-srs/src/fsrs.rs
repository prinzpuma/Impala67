//! FSRS-5-Formeln (Standardgewichte wie ts-fsrs/Anki) mit den Absicherungen aus web/srs.js.

/// FSRS-5-Standardgewichte w0…w18. w0…w3 = Start-Stabilität für Nochmal/Schwer/Gut/Einfach.
pub(crate) const W: [f64; 19] = [
    0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605,
    2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
];
const DECAY: f64 = -0.5;
/// R(t = S) = 90 %: Stabilität = Intervall bei 90 % Behaltensquote.
const FACTOR: f64 = 19.0 / 81.0;
const REQUEST_RETENTION: f64 = 0.9;
pub(crate) const MAX_INTERVAL_DAYS: i64 = 36_500;
pub(crate) const MIN_STABILITY: f64 = 0.1;

/// JS `Math.round`: halbe Werte Richtung +∞.
pub(crate) fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// `Number(x) || fallback`: 0 und NaN gelten als fehlend.
pub(crate) fn or(x: f64, fallback: f64) -> f64 {
    if x == 0.0 || x.is_nan() { fallback } else { x }
}

pub(crate) fn safe_stability(s: f64) -> f64 {
    MIN_STABILITY.max(or(s, MIN_STABILITY))
}

fn safe_difficulty(d: f64) -> f64 {
    or(d, 5.0).clamp(1.0, 10.0)
}

pub(crate) fn init_stability(g: u8) -> f64 {
    MIN_STABILITY.max(W[usize::from(g) - 1])
}

pub(crate) fn init_difficulty(g: u8) -> f64 {
    (W[4] - (W[5] * (f64::from(g) - 1.0)).exp() + 1.0).clamp(1.0, 10.0)
}

/// Abrufwahrscheinlichkeit nach `t` Tagen bei Stabilität `s` (Potenzkurve FSRS-4.5/5).
pub fn retrievability(t: f64, s: f64) -> f64 {
    let t = or(t, 0.0).max(0.0);
    (1.0 + FACTOR * (t / safe_stability(s))).powf(DECAY)
}

/// Intervall in Tagen, nach dem R auf die Ziel-Behaltensquote fällt (bei 90 %: = S).
pub(crate) fn next_interval(s: f64) -> i64 {
    let raw = (safe_stability(s) / FACTOR) * (REQUEST_RETENTION.powf(1.0 / DECAY) - 1.0);
    if !raw.is_finite() || raw <= 0.0 {
        return 1;
    }
    (js_round(raw) as i64).clamp(1, MAX_INTERVAL_DAYS)
}

/// D' = D + ΔD·(10−D)/9 mit ΔD = −w6·(G−3), dann Mittelwert-Rückkehr zu D0(Einfach).
pub(crate) fn next_difficulty(d: f64, g: u8) -> f64 {
    let d0 = safe_difficulty(d);
    let delta = -W[6] * (f64::from(g) - 3.0);
    let damped = d0 + delta * (10.0 - d0) / 9.0;
    (W[7] * init_difficulty(4) + (1.0 - W[7]) * damped).clamp(1.0, 10.0)
}

/// Stabilität nach erfolgreicher Wiederholung (Schwer/Gut/Einfach); sinkt nie.
pub(crate) fn recall_stability(d: f64, s: f64, r: f64, g: u8) -> f64 {
    let s = safe_stability(s);
    let d = safe_difficulty(d);
    let r = or(r, 0.0).clamp(0.0, 1.0);
    let hard = if g == 2 { W[15] } else { 1.0 };
    let easy = if g == 4 { W[16] } else { 1.0 };
    let next = s * (1.0 + W[8].exp() * (11.0 - d) * s.powf(-W[9]) * ((W[10] * (1.0 - r)).exp() - 1.0) * hard * easy);
    s.max(if next.is_finite() { next } else { s })
}

/// Stabilität nach Vergessen; nie größer als vorher.
pub(crate) fn forget_stability(d: f64, s: f64, r: f64) -> f64 {
    let s = safe_stability(s);
    let d = safe_difficulty(d);
    let r = or(r, 0.0).clamp(0.0, 1.0);
    let next = W[11] * d.powf(-W[12]) * ((s + 1.0).powf(W[13]) - 1.0) * (W[14] * (1.0 - r)).exp();
    MIN_STABILITY.max((if next.is_finite() { next } else { MIN_STABILITY }).min(s))
}

/// Kurzzeit-Stabilität während der Lernschritte.
pub(crate) fn short_term_stability(s: f64, g: u8) -> f64 {
    let s = safe_stability(s);
    let next = s * (W[17] * (f64::from(g) - 3.0 + W[18])).exp();
    MIN_STABILITY.max(if next.is_finite() { next } else { s })
}

/// Anki-Fuzz: Spielraum je Intervall-Band, `sample` gleichverteilt in [0, 1).
pub(crate) fn fuzz_days(days: i64, sample: f64) -> i64 {
    if days < 3 {
        return days; // JS: days < 2.5 bei ganzen Tagen
    }
    let d = days as f64;
    let mut delta = 1.0;
    for (lo, hi, f) in [(2.5, 7.0, 0.15), (7.0, 20.0, 0.1), (20.0, f64::INFINITY, 0.05)] {
        delta += f * (d.min(hi) - lo).max(0.0);
    }
    let min = 2.0_f64.max(js_round(d - delta));
    let max = min.max(js_round(d + delta));
    (min + (sample.clamp(0.0, 1.0) * (max - min + 1.0)).floor().min(max - min)) as i64
}
