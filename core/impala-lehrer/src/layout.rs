//! Layout und Zustände des Zeitstrahls (`view`), Überblick für die KI (`describe`), Listeneintrag.

use std::collections::HashSet;

use impala_sort::SortExt;
use serde_json::{Value, json};

use crate::model::{Node, Question, Timeline, WsStatus};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Mastered,
    Next,
    Later,
}

impl State {
    pub fn as_str(self) -> &'static str {
        match self {
            State::Mastered => "mastered",
            State::Next => "next",
            State::Later => "later",
        }
    }
}

/// Gemeistert: ausdrücklich erledigt, oder Quiz und Arbeitsblatt bestanden. Ein Knoten ganz ohne
/// Quiz und Arbeitsblatt wird nur durch `done` gemeistert.
pub fn is_mastered(n: &Node) -> bool {
    if n.progress.done {
        return true;
    }
    let has_work = !n.quiz.is_empty() || n.worksheet.is_some();
    let quiz_ok = n.quiz.is_empty() || n.progress.quiz_passed;
    let worksheet_ok = n.worksheet.is_none() || n.progress.worksheet.status == WsStatus::Passed;
    has_work && quiz_ok && worksheet_ok
}

/// Bekannte Eltern je Knoten als Positionen (ohne sich selbst, ohne Doppelte, ohne unbekannte).
pub fn parent_indices(tl: &Timeline) -> Vec<Vec<usize>> {
    tl.nodes
        .iter()
        .enumerate()
        .map(|(i, n)| {
            let mut ps: Vec<usize> = Vec::new();
            for id in &n.parents {
                if let Some(p) = tl.nodes.iter().position(|x| &x.id == id)
                    && p != i
                    && !ps.contains(&p)
                {
                    ps.push(p);
                }
            }
            ps
        })
        .collect()
}

pub fn states(tl: &Timeline, parents: &[Vec<usize>]) -> Vec<State> {
    let mastered: Vec<bool> = tl.nodes.iter().map(is_mastered).collect();
    (0..tl.nodes.len())
        .map(|i| {
            if mastered[i] {
                State::Mastered
            } else if parents[i].iter().all(|&p| mastered[p]) {
                State::Next
            } else {
                State::Later
            }
        })
        .collect()
}

pub struct Layout {
    pub cols: usize,
    pub lanes: usize,
    /// (Spalte, Spur) je Knoten.
    pub pos: Vec<(usize, usize)>,
}

/// Spalte = längster Pfad von einer Wurzel; Zyklen (die `apply_edit` verhindert) zählen als Wurzel.
fn col_of(i: usize, parents: &[Vec<usize>], memo: &mut [Option<usize>], visiting: &mut [bool]) -> usize {
    if let Some(c) = memo[i] {
        return c;
    }
    if visiting[i] {
        return 0;
    }
    visiting[i] = true;
    let c = parents[i].iter().map(|&p| col_of(p, parents, memo, visiting) + 1).max().unwrap_or(0);
    visiting[i] = false;
    memo[i] = Some(c);
    c
}

/// Deterministisches Layout: wenige Ursprungs-Spuren links, nach rechts verzweigend.
pub fn layout(tl: &Timeline, parents: &[Vec<usize>]) -> Layout {
    let n = tl.nodes.len();
    let mut memo = vec![None; n];
    let mut visiting = vec![false; n];
    let cols_of: Vec<usize> = (0..n).map(|i| col_of(i, parents, &mut memo, &mut visiting)).collect();
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_small_by_key(|&i| (cols_of[i], i));

    let mut lane = vec![0usize; n];
    let mut taken: HashSet<(usize, usize)> = HashSet::new();
    let mut max_lane: Option<usize> = None;
    for &i in &order {
        let col = cols_of[i];
        // Wurzeln: eine neue Spur unter allen bisherigen; Kinder: Spur des obersten Elternteils.
        let pref = if parents[i].is_empty() {
            max_lane.map_or(0, |m| m + 1)
        } else {
            parents[i].iter().map(|&p| lane[p]).min().unwrap_or(0)
        };
        // Nächste freie Spur in der Spalte, bei Gleichstand die untere.
        let mut d = 0;
        let chosen = loop {
            if !taken.contains(&(col, pref + d)) {
                break pref + d;
            }
            if d > 0 && pref >= d && !taken.contains(&(col, pref - d)) {
                break pref - d;
            }
            d += 1;
        };
        taken.insert((col, chosen));
        lane[i] = chosen;
        max_lane = Some(max_lane.map_or(chosen, |m| m.max(chosen)));
    }
    Layout {
        cols: cols_of.iter().max().map_or(0, |m| m + 1),
        lanes: max_lane.map_or(0, |m| m + 1),
        pos: (0..n).map(|i| (cols_of[i], lane[i])).collect(),
    }
}

fn entry(n: &Node, state: State, (col, lane): (usize, usize)) -> Value {
    let answered = n.progress.quiz.as_ref().map_or(0, |q| q.results.len());
    json!({
        "id": n.id,
        "title": n.title,
        "era": n.era,
        "summary": n.summary,
        "col": col,
        "lane": lane,
        "state": state.as_str(),
        "quiz": { "total": n.quiz.len(), "answered": answered, "passed": n.progress.quiz_passed },
        "worksheet": n.worksheet.as_ref().map(|_| n.progress.worksheet.status.as_str()),
    })
}

fn counts(states: &[State]) -> Value {
    let mastered = states.iter().filter(|s| **s == State::Mastered).count();
    let next = states.iter().filter(|s| **s == State::Next).count();
    json!({ "total": states.len(), "mastered": mastered, "next": next })
}

/// Anzeigedaten: Spalten/Spuren, Knoten mit Zustand, Kanten und Zähler.
pub fn view_of(tl: &Timeline) -> Value {
    let parents = parent_indices(tl);
    let st = states(tl, &parents);
    let lay = layout(tl, &parents);
    let nodes: Vec<Value> = (0..tl.nodes.len()).map(|i| entry(&tl.nodes[i], st[i], lay.pos[i])).collect();
    let edges: Vec<Value> = (0..tl.nodes.len())
        .flat_map(|i| parents[i].iter().map(move |&p| (p, i)))
        .map(|(p, i)| json!({ "from": tl.nodes[p].id, "to": tl.nodes[i].id }))
        .collect();
    json!({ "cols": lay.cols, "lanes": lay.lanes, "nodes": nodes, "edges": edges, "stats": counts(&st) })
}

/// Wie [`view_of`], aber nur der Eintrag eines Knotens (nach Position).
pub fn view_entry(tl: &Timeline, idx: usize) -> Value {
    let parents = parent_indices(tl);
    let st = states(tl, &parents);
    let lay = layout(tl, &parents);
    entry(&tl.nodes[idx], st[idx], lay.pos[idx])
}

/// `view`: bei unlesbarem Zeitstrahl eine leere Ansicht statt eines Fehlers.
pub fn view(tl: &Value) -> Value {
    match Timeline::parse(tl) {
        Ok(t) => view_of(&t),
        Err(_) => {
            json!({ "cols": 0, "lanes": 0, "nodes": [], "edges": [], "stats": { "total": 0, "mastered": 0, "next": 0 } })
        }
    }
}

/// Ausgabe für das KI-Lesewerkzeug `read_timeline`: Überblick, oder ein ganzer Knoten.
pub fn describe(tl: &Value, node: Option<&str>) -> Result<Value, String> {
    let tl = Timeline::parse(tl)?;
    let parents = parent_indices(&tl);
    let st = states(&tl, &parents);
    let Some(key) = node else {
        let nodes: Vec<Value> = tl
            .nodes
            .iter()
            .enumerate()
            .map(|(i, n)| {
                json!({
                    "id": n.id,
                    "title": n.title,
                    "era": n.era,
                    "parents": n.parents,
                    "state": st[i].as_str(),
                    "worksheet": n.worksheet,
                    "worksheet_status": n.worksheet.as_ref().map(|_| n.progress.worksheet.status.as_str()),
                    "quiz_questions": n.quiz.len(),
                })
            })
            .collect();
        return Ok(json!({
            "id": tl.id,
            "title": tl.title,
            "subject": tl.subject,
            "description": tl.description,
            "stats": counts(&st),
            "nodes": nodes,
        }));
    };
    let i = tl.find(key).ok_or_else(|| {
        format!("read_timeline: Knoten „{key}“ nicht gefunden – ohne „node“ aufrufen, um alle Knoten zu sehen.")
    })?;
    let n = &tl.nodes[i];
    let mut out = serde_json::to_value(n).map_err(|e| e.to_string())?;
    // Offene Freitext-Antworten, damit die KI sie bewerten kann (check_lesson).
    let mut pending = Vec::new();
    if let Some(att) = &n.progress.quiz {
        for (qi, q) in n.quiz.iter().enumerate() {
            let open = att.results.get(qi).is_none_or(|r| r.correct.is_none());
            if let (Question::Text { q: text, solution, .. }, true) = (q, open) {
                pending.push(json!({
                    "index": qi,
                    "q": text,
                    "solution": solution,
                    "answer": att.answers.get(qi).cloned().unwrap_or(Value::Null),
                }));
            }
        }
    }
    if let Some(o) = out.as_object_mut() {
        o.insert("state".into(), json!(st[i].as_str()));
        o.insert("pending_ai".into(), Value::Array(pending));
    }
    Ok(out)
}

/// Eintrag für Listen: `{id,title,subject,updated,total,mastered}`.
pub fn list_entry(tl: &Value) -> Value {
    let t = Timeline::parse(tl).unwrap_or_default();
    let mastered = t.nodes.iter().filter(|n| is_mastered(n)).count();
    json!({ "id": t.id, "title": t.title, "subject": t.subject, "updated": t.updated, "total": t.nodes.len(), "mastered": mastered })
}
