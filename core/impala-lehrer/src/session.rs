//! Tagesplan bis zur Klausur (`today_plan`) und gemischte Kurz-Auffrischung (`build_refresh_session` / `record_refresh`).

use serde::Serialize;
use serde_json::{Value, json};

use crate::layout::{State, is_mastered, parent_indices, states};
use crate::memory::{
    DUE_THRESHOLD, FRESH_THRESHOLD, days_elapsed, is_weak, memory_badge, parse_day, record_question_history,
    retrievability, update_memory,
};
use crate::model::{Node, Timeline};
use crate::quiz::grade_question;

#[derive(Debug, Clone, Serialize)]
pub struct RefreshItem {
    pub node_id: String,
    pub node_title: String,
    pub year: Option<f64>,
    pub strand: String,
    pub question_index: usize,
    pub question: Value,
    pub reason: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct RefreshSession {
    pub items: Vec<RefreshItem>,
    pub estimated_minutes: usize,
    pub node_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct RefreshResultItem {
    pub node_id: String,
    pub question_index: usize,
    pub correct: Option<bool>,
    pub expected: String,
    pub explain: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RefreshOut {
    pub timeline: Value,
    pub results: Vec<RefreshResultItem>,
    pub refreshed_nodes: Vec<String>,
    pub correct_count: usize,
    pub total_count: usize,
}

/// Berechnet den konkreten Tagesplan bis zur Klausur („Heute dran“).
pub fn today_plan(tl: &Timeline, now: &str) -> Value {
    let parents = parent_indices(tl);
    let st = states(tl, &parents);
    let mut due_ids = Vec::new();
    let mut fading_ids = Vec::new();
    let mut weak_nodes = Vec::new();
    let mut next_node: Option<&Node> = None;
    let mut remaining = 0usize;

    for (i, n) in tl.nodes.iter().enumerate() {
        let mastered = st[i] == State::Mastered;
        if !mastered {
            remaining += 1;
            if st[i] == State::Next && next_node.is_none() {
                next_node = Some(n);
            }
        }
        let badge = memory_badge(n, mastered, now);
        if badge == Some("weak") {
            weak_nodes.push(json!({
                "id": n.id,
                "title": n.title,
                "year": n.year,
                "misconceptions": n.progress.memory.as_ref().map_or(0, |m| m.misconceptions),
                "lapses": n.progress.memory.as_ref().map_or(0, |m| m.lapses),
            }));
        } else if badge == Some("due") {
            due_ids.push(n.id.clone());
        } else if badge == Some("fading") {
            fading_ids.push(n.id.clone());
        }
    }

    let refresh_nodes = weak_nodes.len() + due_ids.len() + fading_ids.len();
    let refresh_minutes = if refresh_nodes == 0 { 0 } else { (refresh_nodes.min(5) * 2).clamp(2, 8) };

    let days_to_exam = if !tl.exam.is_empty() && !now.trim().is_empty() {
        match (parse_day(now), parse_day(&tl.exam)) {
            (Some(a), Some(b)) => Some(b - a),
            _ => None,
        }
    } else {
        None
    };

    let new_per_day = match days_to_exam {
        Some(d) if d > 0 && remaining > 0 => ((remaining as f64 / d as f64).ceil() as usize).clamp(1, 4),
        _ if remaining > 0 => 1,
        _ => 0,
    };

    json!({
        "due_count": due_ids.len(),
        "fading_count": fading_ids.len(),
        "weak_count": weak_nodes.len(),
        "refresh_nodes": refresh_nodes,
        "refresh_minutes": refresh_minutes,
        "remaining_nodes": remaining,
        "days_to_exam": days_to_exam,
        "new_per_day": new_per_day,
        "next_node": next_node.map(|n| json!({ "id": n.id, "title": n.title, "year": n.year })),
        "weak_nodes": weak_nodes,
    })
}

/// Wählt aus einem Knoten-Quizpool bis zu `limit` Fragen aus:
/// bevorzugt noch nie gestellte, falsch beantwortete oder am längsten zurückliegende Fragen.
fn pick_questions(n: &Node, limit: usize, now: &str) -> Vec<usize> {
    if n.quiz.is_empty() || limit == 0 {
        return Vec::new();
    }
    let mut scored: Vec<(usize, u8, f64)> = (0..n.quiz.len())
        .map(|qi| {
            let hist = n.progress.seen_questions.iter().find(|h| h.index == qi);
            match hist {
                None => (qi, 0, 9999.0), // Noch nie gesehen → höchste Priorität
                Some(h) if !h.last_correct => (qi, 1, days_elapsed(&h.last_at, now)),
                Some(h) if h.last_confidence == "guess" => (qi, 2, days_elapsed(&h.last_at, now)),
                Some(h) => (qi, 3, days_elapsed(&h.last_at, now)),
            }
        })
        .collect();
    scored.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| b.2.total_cmp(&a.2)).then(a.0.cmp(&b.0)));
    scored.into_iter().take(limit).map(|x| x.0).collect()
}

/// Stellt eine gemischte Kurz-Auffrischung (Interleaving) über alle schwachen/verblassenden Knoten zusammen.
pub fn build_refresh_session(tl: &Value, now: &str, max_questions: usize) -> Result<RefreshSession, String> {
    let tl = Timeline::parse(tl)?;
    let max_q = max_questions.clamp(1, 15);

    // Kandidaten sammeln: erst Schwachstellen, dann fällige, dann verblassende Knoten.
    let mut candidates: Vec<(usize, u8, f64, &'static str)> = Vec::new();
    for (i, n) in tl.nodes.iter().enumerate() {
        if n.quiz.is_empty() {
            continue;
        }
        let mastered = is_mastered(n);
        if is_weak(n) {
            let r = n.progress.memory.as_ref().map_or(0.5, |m| retrievability(m, now));
            candidates.push((i, 0, r, "Schwachstelle"));
        } else if mastered {
            let r = n.progress.memory.as_ref().map_or(1.0, |m| retrievability(m, now));
            if r < DUE_THRESHOLD {
                candidates.push((i, 1, r, "Fällig"));
            } else if r < FRESH_THRESHOLD {
                candidates.push((i, 2, r, "Verblasst"));
            }
        }
    }
    candidates.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.2.total_cmp(&b.2)).then(a.0.cmp(&b.0)));

    // Round-Robin über die Kandidaten (echtes Interleaving statt Block-Abfrage!).
    let per_node = if candidates.len() <= 2 { 3 } else { 2 };
    let mut queues: Vec<(usize, &'static str, Vec<usize>)> = candidates
        .into_iter()
        .map(|(i, _, _, reason)| (i, reason, pick_questions(&tl.nodes[i], per_node, now)))
        .filter(|(_, _, qs)| !qs.is_empty())
        .collect();

    let mut items = Vec::new();
    let mut round = 0usize;
    while items.len() < max_q {
        let mut added_any = false;
        for (i, reason, qs) in &mut queues {
            if let Some(&qi) = qs.get(round) {
                let n = &tl.nodes[*i];
                items.push(RefreshItem {
                    node_id: n.id.clone(),
                    node_title: n.title.clone(),
                    year: n.year,
                    strand: n.strand.clone(),
                    question_index: qi,
                    question: serde_json::to_value(&n.quiz[qi]).unwrap_or(Value::Null),
                    reason,
                });
                added_any = true;
                if items.len() >= max_q {
                    break;
                }
            }
        }
        if !added_any {
            break;
        }
        round += 1;
    }

    let mut distinct = std::collections::HashSet::new();
    for it in &items {
        distinct.insert(it.node_id.clone());
    }
    let estimated_minutes = if items.is_empty() { 0 } else { (items.len().div_ceil(2)).clamp(1, 8) };
    Ok(RefreshSession { items, estimated_minutes, node_count: distinct.len() })
}

/// Wertet eine gemischte Auffrischungs-Sitzung aus und aktualisiert die MemoryStates aller beteiligten Knoten.
/// `submissions`: Liste von `{ node_id, question_index, answer, confidence }`.
pub fn record_refresh(tl: &Value, submissions: &Value, now: &str) -> Result<RefreshOut, String> {
    let mut tl = Timeline::parse(tl)?;
    let Some(arr) = submissions.as_array() else {
        return Err("Auffrischungs-Antworten müssen eine Liste sein.".into());
    };
    let mut results = Vec::new();
    let mut by_node: std::collections::BTreeMap<usize, Vec<(bool, String)>> = std::collections::BTreeMap::new();
    let mut correct_count = 0usize;

    for item in arr {
        let node_id = item.get("node_id").and_then(Value::as_str).unwrap_or("");
        let qi = item.get("question_index").and_then(Value::as_u64).unwrap_or(usize::MAX as u64) as usize;
        let answer = item.get("answer").unwrap_or(&Value::Null);
        let conf = item.get("confidence").and_then(Value::as_str).unwrap_or("");
        let Some(ni) = tl.find(node_id) else { continue };
        let Some(q) = tl.nodes[ni].quiz.get(qi).cloned() else { continue };
        let g = grade_question(qi, &q, answer);
        let explain = match &q {
            crate::model::Question::Choice { explain, .. }
            | crate::model::Question::Text { explain, .. }
            | crate::model::Question::Number { explain, .. }
            | crate::model::Question::Cloze { explain, .. } => explain.clone(),
        };
        if let Some(ok) = g.correct {
            if ok {
                correct_count += 1;
            }
            record_question_history(&mut tl.nodes[ni].progress.seen_questions, qi, ok, conf, now);
            by_node.entry(ni).or_default().push((ok, conf.to_string()));
        }
        results.push(RefreshResultItem {
            node_id: tl.nodes[ni].id.clone(),
            question_index: qi,
            correct: g.correct,
            expected: g.expected,
            explain,
        });
    }

    let mut refreshed_nodes = Vec::new();
    for (ni, pairs) in by_node {
        let refs: Vec<(bool, &str)> = pairs.iter().map(|(ok, c)| (*ok, c.as_str())).collect();
        let updated = update_memory(tl.nodes[ni].progress.memory.as_ref(), &refs, now);
        tl.nodes[ni].progress.memory = Some(updated);
        refreshed_nodes.push(tl.nodes[ni].id.clone());
    }
    tl.updated = now.to_string();
    let total_count = results.len();
    Ok(RefreshOut { timeline: tl.to_value(), results, refreshed_nodes, correct_count, total_count })
}
