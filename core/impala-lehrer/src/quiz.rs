//! Quiz-Auswertung (`record_quiz`) und Bewertung durch die KI (`apply_check`).

use serde::Serialize;
use serde_json::Value;

use crate::layout::view_entry;
use crate::memory::{record_question_history, update_memory};
use crate::model::{Node, QResult, Question, QuizAttempt, Timeline, WsStatus};
use crate::text::{cloze_gaps, fmt_num, norm, parse_number};

/// Anteil richtiger Antworten, ab dem ein Quiz bestanden ist (4/5).
const PASS_NUM: usize = 4;
const PASS_DEN: usize = 5;

#[derive(Debug, Clone, Serialize)]
pub struct GradeItem {
    pub index: usize,
    #[serde(rename = "type")]
    pub kind: &'static str,
    /// `None`: wartet auf die KI.
    pub correct: Option<bool>,
    /// Lösung zum Anzeigen.
    pub expected: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Grade {
    pub results: Vec<GradeItem>,
    pub auto_correct: usize,
    pub auto_total: usize,
    pub pending_ai: Vec<usize>,
    /// Richtige / automatisch bewertete Fragen.
    pub score: f64,
    pub passed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct RecordOut {
    pub timeline: Value,
    pub grade: Grade,
}

#[derive(Debug, Clone, Serialize)]
pub struct CheckOut {
    pub timeline: Value,
    pub node: Value,
}

fn indices(v: &Value) -> Vec<usize> {
    let one = |x: &Value| -> Option<usize> {
        let n = match x {
            Value::Number(n) => n.as_f64()?,
            Value::String(s) => parse_number(s)?,
            _ => return None,
        };
        (n >= 0.0 && n.fract() == 0.0).then_some(n as usize)
    };
    let mut out: Vec<usize> = match v {
        Value::Array(a) => a.iter().filter_map(one).collect(),
        x => one(x).into_iter().collect(),
    };
    out.sort_unstable();
    out.dedup();
    out
}

fn number_of(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64().filter(|x| x.is_finite()),
        Value::String(s) => parse_number(s),
        _ => None,
    }
}

fn strings(v: &Value) -> Vec<String> {
    match v {
        Value::Array(a) => a
            .iter()
            .map(|x| match x {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.to_string(),
                _ => String::new(),
            })
            .collect(),
        Value::String(s) => vec![s.clone()],
        _ => Vec::new(),
    }
}

pub(crate) fn grade_question(index: usize, q: &Question, answer: &Value) -> GradeItem {
    grade_one(index, q, answer)
}

fn grade_one(index: usize, q: &Question, answer: &Value) -> GradeItem {
    let (correct, expected) = match q {
        Question::Choice { options, correct, .. } => {
            let mut want = correct.clone();
            want.sort_unstable();
            want.dedup();
            let shown: Vec<&str> = want.iter().filter_map(|&i| options.get(i).map(String::as_str)).collect();
            (Some(indices(answer) == want), shown.join(", "))
        }
        Question::Text { solution, .. } => (None, solution.clone()),
        Question::Number { answer: want, tol, tol_rel, unit, .. } => {
            let ok = number_of(answer).is_some_and(|a| {
                let diff = (a - want).abs();
                match (tol, tol_rel) {
                    (None, None) => diff <= 0.01 * want.abs() + f64::EPSILON * want.abs().max(1.0),
                    _ => tol.is_some_and(|t| diff <= t) || tol_rel.is_some_and(|r| diff <= r * want.abs()),
                }
            });
            let mut shown = fmt_num(*want);
            if !unit.trim().is_empty() {
                shown = format!("{shown} {}", unit.trim());
            }
            (Some(ok), shown)
        }
        Question::Cloze { text, .. } => {
            let gaps = cloze_gaps(text);
            let given = strings(answer);
            let ok = gaps.iter().enumerate().all(|(i, alts)| {
                given.get(i).is_some_and(|g| {
                    let g = norm(g);
                    alts.iter().any(|a| norm(a) == g)
                })
            });
            let shown: Vec<&str> = gaps.iter().map(|g| g.first().map_or("", String::as_str)).collect();
            (Some(ok), shown.join(", "))
        }
    };
    GradeItem { index, kind: q.kind(), correct, expected }
}

/// Bestanden: alle bewertet und mindestens 80 % richtig.
fn passes(results: &[Option<bool>]) -> bool {
    let total = results.len();
    total > 0
        && results.iter().all(Option::is_some)
        && results.iter().filter(|r| **r == Some(true)).count() * PASS_DEN >= total * PASS_NUM
}

/// Wertet die Antworten eines Quiz-Versuchs aus und speichert sie im Fortschritt des Knotens.
pub fn record_quiz(tl: &Value, node: &str, answers: &Value, now: &str) -> Result<RecordOut, String> {
    record_quiz_with_confidence(tl, node, answers, &Value::Null, now)
}

/// Wie [`record_quiz`], nimmt aber zusätzlich Konfidenz-Werte (`"sure"|"unsure"|"guess"`) je Frage entgegen
/// und aktualisiert das FSRS-Erinnerungsmodell sowie die Frage-Historie.
pub fn record_quiz_with_confidence(
    tl: &Value,
    node: &str,
    answers: &Value,
    confidences: &Value,
    now: &str,
) -> Result<RecordOut, String> {
    let mut tl = Timeline::parse(tl)?;
    let i = tl.find(node).ok_or_else(|| format!("Knoten „{node}“ nicht gefunden."))?;
    let Some(given) = answers.as_array() else {
        return Err("Antworten müssen eine Liste sein (eine Antwort je Frage).".into());
    };
    let confs = confidences.as_array();
    let n = &mut tl.nodes[i];
    if n.quiz.is_empty() {
        return Err(format!("Knoten „{}“ hat kein Quiz.", n.title));
    }
    let results: Vec<GradeItem> =
        n.quiz.iter().enumerate().map(|(k, q)| grade_one(k, q, given.get(k).unwrap_or(&Value::Null))).collect();
    let auto_total = results.iter().filter(|r| r.correct.is_some()).count();
    let auto_correct = results.iter().filter(|r| r.correct == Some(true)).count();
    let pending_ai: Vec<usize> = results.iter().filter(|r| r.correct.is_none()).map(|r| r.index).collect();
    let score = if auto_total == 0 { 0.0 } else { auto_correct as f64 / auto_total as f64 };
    // Bestanden erst, wenn nichts mehr auf die KI wartet.
    let passed = pending_ai.is_empty() && auto_total > 0 && auto_correct * PASS_DEN >= auto_total * PASS_NUM;
    n.progress.quiz = Some(QuizAttempt {
        answers: given.clone(),
        results: results.iter().map(|r| QResult { correct: r.correct, feedback: String::new() }).collect(),
        at: now.to_string(),
    });
    n.progress.quiz_passed = passed;

    // Frage-Historie & FSRS-MemoryState aktualisieren (für alle automatisch bewerteten Fragen).
    let mut mem_pairs: Vec<(bool, String)> = Vec::new();
    for r in &results {
        if let Some(ok) = r.correct {
            let c = confs.and_then(|a| a.get(r.index)).and_then(Value::as_str).unwrap_or("");
            record_question_history(&mut n.progress.seen_questions, r.index, ok, c, now);
            mem_pairs.push((ok, c.to_string()));
        }
    }
    if !mem_pairs.is_empty() && pending_ai.is_empty() {
        let refs: Vec<(bool, &str)> = mem_pairs.iter().map(|(ok, c)| (*ok, c.as_str())).collect();
        n.progress.memory = Some(update_memory(n.progress.memory.as_ref(), &refs, now));
    }

    tl.updated = now.to_string();
    let grade = Grade { results, auto_correct, auto_total, pending_ai, score, passed };
    Ok(RecordOut { timeline: tl.to_value(), grade })
}

#[derive(Debug, Clone, Serialize)]
pub struct PretestOut {
    pub timeline: Value,
    pub correct: Option<bool>,
    pub expected: String,
    pub explain: String,
}

/// Wertet die kurze Einstiegsfrage (Pre-Test) vor dem Lesen aus und markiert sie als erledigt.
pub fn record_pretest(tl: &Value, node: &str, answer: &Value, now: &str) -> Result<PretestOut, String> {
    let mut tl = Timeline::parse(tl)?;
    let i = tl.find(node).ok_or_else(|| format!("Knoten „{node}“ nicht gefunden."))?;
    let n = &mut tl.nodes[i];
    let Some(q) = n.pretest.clone() else {
        return Err(format!("Knoten „{}“ hat keine Einstiegsfrage.", n.title));
    };
    let g = grade_one(0, &q, answer);
    let explain = q.explain().to_string();
    n.progress.pretest_done = true;
    tl.updated = now.to_string();
    Ok(PretestOut { timeline: tl.to_value(), correct: g.correct, expected: g.expected, explain })
}

/// Übernimmt die Bewertung der KI (`check_lesson`): Quiz-Einzelnoten, Arbeitsblatt, `done`, Rückmeldung.
pub fn apply_check(tl: &Value, check: &Value, now: &str) -> Result<CheckOut, String> {
    let mut tl = Timeline::parse(tl)?;
    let key = check.get("node").and_then(Value::as_str).unwrap_or("").trim();
    if key.is_empty() {
        return Err("check_lesson: „node“ fehlt – nenne die id oder den Titel des Knotens.".into());
    }
    let i = tl.find(key).ok_or_else(|| format!("check_lesson: Knoten „{key}“ nicht gefunden."))?;
    let n: &mut Node = &mut tl.nodes[i];
    let feedback = check.get("feedback").and_then(Value::as_str).map(str::to_string);

    if let Some(list) = check.get("quiz") {
        let Some(list) = list.as_array() else { return Err("check_lesson: „quiz“ muss eine Liste sein.".into()) };
        let total = n.quiz.len();
        let Some(att) = n.progress.quiz.as_mut() else {
            return Err(format!(
                "check_lesson: Knoten „{}“ hat noch kein Quiz-Versuch – es gibt nichts zu bewerten.",
                n.title
            ));
        };
        att.results.resize(total, QResult::default());
        for item in list {
            let idx = item.get("index").and_then(Value::as_u64).map(|x| x as usize);
            let (Some(idx), Some(ok)) = (idx.filter(|&x| x < total), item.get("correct").and_then(Value::as_bool))
            else {
                return Err(format!(
                    "check_lesson: Quiz-Bewertung braucht „index“ (0 bis {}) und „correct“ (true/false).",
                    total.saturating_sub(1)
                ));
            };
            att.results[idx] = QResult {
                correct: Some(ok),
                feedback: item.get("feedback").and_then(Value::as_str).unwrap_or("").to_string(),
            };
        }
        let flags: Vec<Option<bool>> = att.results.iter().map(|r| r.correct).collect();
        n.progress.quiz_passed = passes(&flags);
    }
    if let Some(ws) = check.get("worksheet").filter(|v| !v.is_null()) {
        let status = ws
            .as_str()
            .and_then(WsStatus::parse)
            .ok_or("check_lesson: „worksheet“ muss passed, failed oder submitted sein.")?;
        if n.worksheet.is_none() {
            return Err(format!("check_lesson: Knoten „{}“ hat kein Arbeitsblatt.", n.title));
        }
        n.progress.worksheet.status = status;
        n.progress.worksheet.feedback = feedback.clone().unwrap_or_default();
        n.progress.worksheet.at = now.to_string();
    }
    if let Some(done) = check.get("done").and_then(Value::as_bool) {
        n.progress.done = done;
    }
    if let Some(f) = feedback {
        n.progress.feedback = f;
    }
    tl.updated = now.to_string();
    let node = view_entry(&tl, i);
    Ok(CheckOut { timeline: tl.to_value(), node })
}
