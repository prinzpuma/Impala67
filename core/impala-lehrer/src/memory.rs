//! FSRS-inspiriertes Erinnerungsmodell für verblassende Meisterschaft und Konfidenz-Kalibrierung.
//! Reine Funktionen ohne Systemuhr – Zeitstempel (`now`) kommen immer als ISO-String von außen.

use crate::model::{MemoryState, Node, QuestionHistory};

/// Schwellwerte für die visuelle Frische eines gemeisterten Knotens.
pub const FRESH_THRESHOLD: f64 = 0.85;
pub const DUE_THRESHOLD: f64 = 0.65;

/// Parst `JJJJ-MM-TT` (Prefix eines ISO-Zeitstempels) als fortlaufende Tage seit Epoche.
pub fn parse_day(iso: &str) -> Option<i64> {
    let s = iso.trim();
    if s.len() < 10 {
        return None;
    }
    let y: i64 = s.get(0..4)?.parse().ok()?;
    let m: i64 = s.get(5..7)?.parse().ok()?;
    let d: i64 = s.get(8..10)?.parse().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    // Howard Hinnants Gregorian-to-days Algorithmus (exakt, keine externen Crates).
    let y = y - i64::from(m <= 2);
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = m + if m > 2 { -3 } else { 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146097 + doe - 719468)
}

/// Formatiert fortlaufende Tage wieder als `JJJJ-MM-TT`.
pub fn format_day(z: i64) -> String {
    let z = z + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let y = y + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Tage zwischen zwei ISO-Zeitstempeln (mindestens 0.0).
pub fn days_elapsed(from: &str, to: &str) -> f64 {
    match (parse_day(from), parse_day(to)) {
        (Some(a), Some(b)) => (b - a).max(0) as f64,
        _ => 0.0,
    }
}

/// Erinnerungsstärke R(t) in [0.0, 1.0] nach FSRS-Potenzgesetz: R(t) = (1 + t / (9 * S))^-1.
pub fn retrievability(mem: &MemoryState, now: &str) -> f64 {
    if mem.stability <= 0.0 || now.trim().is_empty() || mem.last_review.trim().is_empty() {
        return 1.0;
    }
    let dt = days_elapsed(&mem.last_review, now);
    if dt <= 0.0 {
        return 1.0;
    }
    (1.0 + dt / (9.0 * mem.stability)).powi(-1).clamp(0.0, 1.0)
}

/// Effektiver Erinnerungsstatus eines gemeisterten Knotens: `"fresh"`, `"fading"`, `"due"` oder `"weak"`.
pub fn memory_badge(n: &Node, mastered: bool, now: &str) -> Option<&'static str> {
    if is_weak(n) {
        return Some("weak");
    }
    if !mastered {
        return None;
    }
    let Some(mem) = &n.progress.memory else {
        return Some("fresh");
    };
    let r = retrievability(mem, now);
    if r < DUE_THRESHOLD {
        Some("due")
    } else if r < FRESH_THRESHOLD {
        Some("fading")
    } else {
        Some("fresh")
    }
}

/// Schwachstelle: wiederholte Fehlkonzepte („sicher + falsch“) oder ≥ 2 Lapses bei niedrigem Stand.
pub fn is_weak(n: &Node) -> bool {
    if let Some(mem) = &n.progress.memory
        && (mem.misconceptions > 0 || mem.lapses >= 2)
    {
        return true;
    }
    n.progress
        .seen_questions
        .iter()
        .any(|h| !h.last_correct && h.last_confidence == "sure")
}

/// Normalisiert Konfidenz-Text auf `"sure"`, `"unsure"`, `"guess"` oder `""`.
pub fn norm_confidence(s: &str) -> &'static str {
    match s.trim().to_lowercase().as_str() {
        "sure" | "sicher" => "sure",
        "unsure" | "unsicher" => "unsure",
        "guess" | "geraten" => "guess",
        _ => "",
    }
}

/// Aktualisiert die Frage-Historie eines Knotens für eine beantwortete Frage.
pub fn record_question_history(
    list: &mut Vec<QuestionHistory>,
    index: usize,
    correct: bool,
    confidence: &str,
    now: &str,
) {
    let conf = norm_confidence(confidence).to_string();
    if let Some(h) = list.iter_mut().find(|x| x.index == index) {
        h.attempts += 1;
        if correct {
            h.correct_count += 1;
        }
        h.last_correct = correct;
        h.last_confidence = conf;
        h.last_at = now.to_string();
    } else {
        list.push(QuestionHistory {
            index,
            attempts: 1,
            correct_count: u32::from(correct),
            last_correct: correct,
            last_confidence: conf,
            last_at: now.to_string(),
        });
    }
}

/// Aktualisiert den FSRS-Erinnerungszustand nach einem Quiz oder einer Auffrischung.
/// `results`: Liste aus `(richtig, konfidenz)`.
pub fn update_memory(prev: Option<&MemoryState>, results: &[(bool, &str)], now: &str) -> MemoryState {
    let total = results.len().max(1) as f64;
    let right = results.iter().filter(|(ok, _)| *ok).count() as f64;
    let ratio = right / total;
    let sure_wrong = results.iter().filter(|(ok, c)| !ok && norm_confidence(c) == "sure").count() as u32;
    let guess_right = results.iter().filter(|(ok, c)| *ok && norm_confidence(c) == "guess").count() as f64;
    let sure_right = results.iter().filter(|(ok, c)| *ok && norm_confidence(c) == "sure").count() as f64;

    let mut m = prev.cloned().unwrap_or(MemoryState {
        stability: 0.0,
        difficulty: 5.0,
        last_review: String::new(),
        next_review: String::new(),
        reps: 0,
        lapses: 0,
        misconceptions: 0,
    });

    // Effektive Bewertung (1 = Vergessen, 2 = Schwer/Geraten, 3 = Gut, 4 = Leicht/Sicher).
    let grade: u8 = if ratio < 0.75 {
        1
    } else if guess_right / total >= 0.34 {
        2
    } else if ratio >= 0.99 && sure_right / total >= 0.6 {
        4
    } else {
        3
    };

    if grade == 1 {
        m.lapses += 1;
        m.misconceptions = m.misconceptions.saturating_add(sure_wrong);
        m.difficulty = (m.difficulty + 1.1).clamp(1.0, 10.0);
        m.stability = if m.stability > 0.0 { (m.stability * 0.35).max(1.0) } else { 1.0 };
    } else {
        m.reps += 1;
        if sure_wrong > 0 {
            m.misconceptions = m.misconceptions.saturating_add(sure_wrong);
        } else if m.misconceptions > 0 && grade >= 3 {
            // Sicherer erfolgreicher Abruf baut Fehlkonzept-Markierung wieder ab.
            m.misconceptions = m.misconceptions.saturating_sub(1);
        }
        let mult = match grade {
            2 => 1.35, // Geraten → kurzes Intervall
            4 => 2.6,  // Sicher & alles richtig → großer Sprung
            _ => 2.0,  // Gut
        };
        let diff_factor = (11.0 - m.difficulty) / 6.0;
        m.stability = if m.stability <= 0.0 {
            match grade {
                2 => 1.5,
                4 => 5.0,
                _ => 3.0,
            }
        } else {
            (m.stability * mult * diff_factor.clamp(0.7, 1.4)).clamp(1.0, 180.0)
        };
        m.difficulty = match grade {
            2 => (m.difficulty + 0.3).clamp(1.0, 10.0),
            4 => (m.difficulty - 0.5).clamp(1.0, 10.0),
            _ => (m.difficulty - 0.1).clamp(1.0, 10.0),
        };
    }

    m.last_review = now.to_string();
    // Nächste Auffrischung, wenn R ≈ 0.80 erreicht ist (t ≈ 2.25 * S Tage).
    let interval_days = (m.stability * 2.25).round().clamp(1.0, 180.0) as i64;
    if let Some(today) = parse_day(now) {
        m.next_review = format_day(today + interval_days);
    }
    m
}
