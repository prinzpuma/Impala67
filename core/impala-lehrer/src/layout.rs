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
    /// Je Spalte: Jahre von/bis und häufigste Epoche (für die Zeitachse).
    pub columns: Vec<Value>,
    /// Stränge als Spurbänder `{name, lane, lanes}` (leer, wenn kein Knoten einen Strang hat).
    pub strands: Vec<Value>,
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

/// Zeitachse: Spalten folgen den Jahren (gleiches Jahr = gleiche Spalte), Vorgänger bleiben links.
/// Knoten ohne Jahr erben das späteste Jahr ihrer Vorgänger.
fn year_cols(tl: &Timeline, parents: &[Vec<usize>], depth: &[usize]) -> Vec<usize> {
    let n = tl.nodes.len();
    let mut done = vec![false; n];
    let mut col = vec![0usize; n];
    let mut ey: Vec<Option<f64>> = vec![None; n];
    let key = |y: Option<f64>| y.unwrap_or(f64::NEG_INFINITY);
    for _ in 0..n {
        // Bereit: alle Vorgänger platziert (bei Zyklen notfalls der flachste Rest).
        let ready = (0..n).filter(|&i| !done[i]).filter(|&i| parents[i].iter().all(|&p| done[p]));
        let pick = ready
            .map(|i| {
                let y = tl.nodes[i].year.or_else(|| parents[i].iter().filter_map(|&p| ey[p]).reduce(f64::max));
                (i, y)
            })
            .min_by(|a, b| key(a.1).total_cmp(&key(b.1)).then(depth[a.0].cmp(&depth[b.0])).then(a.0.cmp(&b.0)));
        let (i, y) = match pick {
            Some(x) => x,
            None => match (0..n).filter(|&i| !done[i]).min_by_key(|&i| depth[i]) {
                Some(i) => (i, tl.nodes[i].year),
                None => break,
            },
        };
        let after_parents = parents[i].iter().filter(|&&p| done[p]).map(|&p| col[p] + 1).max().unwrap_or(0);
        let after_earlier = match y {
            Some(y) => (0..n).filter(|&j| done[j] && ey[j].is_some_and(|e| e < y)).map(|j| col[j] + 1).max().unwrap_or(0),
            None => 0,
        };
        col[i] = after_parents.max(after_earlier);
        ey[i] = y;
        done[i] = true;
    }
    col
}

/// Spuren einer Gruppe (Strang): Wurzeln je eine neue Spur, Kinder auf der Spur ihres obersten
/// Elternteils derselben Gruppe; bei belegter Stelle die nächste freie.
fn lanes_in(members: &[usize], cols: &[usize], parents: &[Vec<usize>], group: &[usize], lane: &mut [usize]) -> usize {
    let mut taken: HashSet<(usize, usize)> = HashSet::new();
    let mut max_lane: Option<usize> = None;
    for &i in members {
        let col = cols[i];
        let same: Vec<usize> = parents[i].iter().copied().filter(|&p| group[p] == group[i]).collect();
        let pref = if same.is_empty() {
            if parents[i].is_empty() { max_lane.map_or(0, |m| m + 1) } else { 0 }
        } else {
            same.iter().map(|&p| lane[p]).min().unwrap_or(0)
        };
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
    max_lane.map_or(0, |m| m + 1)
}

/// Deterministisches Layout: Spalten nach Jahr (Zeitachse) bzw. Pfadlänge (Lernpfad),
/// Spuren nach Strang gruppiert, darin wenige Ursprünge oben und nach unten verzweigend.
pub fn layout(tl: &Timeline, parents: &[Vec<usize>]) -> Layout {
    let n = tl.nodes.len();
    let mut memo = vec![None; n];
    let mut visiting = vec![false; n];
    let depth: Vec<usize> = (0..n).map(|i| col_of(i, parents, &mut memo, &mut visiting)).collect();
    let by_year = !tl.is_path() && tl.nodes.iter().any(|x| x.year.is_some());
    let cols_of = if by_year { year_cols(tl, parents, &depth) } else { depth };
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_small_by_key(|&i| (cols_of[i], i));

    // Stränge in der Reihenfolge ihres ersten Auftretens; Knoten ohne Strang kommen ans Ende.
    let mut names: Vec<String> = Vec::new();
    for &i in &order {
        let s = tl.nodes[i].strand.trim();
        if !s.is_empty() && !names.iter().any(|x| x.eq_ignore_ascii_case(s)) {
            names.push(s.to_string());
        }
    }
    let has_strands = !names.is_empty();
    let group: Vec<usize> = (0..n)
        .map(|i| {
            let s = tl.nodes[i].strand.trim();
            names.iter().position(|x| x.eq_ignore_ascii_case(s)).unwrap_or(names.len())
        })
        .collect();
    if has_strands && group.contains(&names.len()) {
        names.push(String::new());
    }
    let groups = names.len().max(1);
    let mut lane = vec![0usize; n];
    let mut offset = 0usize;
    let mut strands = Vec::new();
    for g in 0..groups {
        let members: Vec<usize> = order.iter().copied().filter(|&i| group[i] == g || !has_strands).collect();
        let count = lanes_in(&members, &cols_of, parents, &group, &mut lane);
        for &i in &members {
            lane[i] += offset;
        }
        if let Some(name) = names.get(g).filter(|_| count > 0) {
            strands.push(json!({ "name": name, "lane": offset, "lanes": count }));
        }
        offset += count;
    }

    let cols = cols_of.iter().max().map_or(0, |m| m + 1);
    let columns = (0..cols)
        .map(|c| {
            let inside: Vec<&Node> = (0..n).filter(|&i| cols_of[i] == c).map(|i| &tl.nodes[i]).collect();
            let years: Vec<f64> = inside.iter().filter_map(|x| x.year).collect();
            let mut eras: Vec<(&str, usize)> = Vec::new();
            for x in &inside {
                let e = x.era.trim();
                if e.is_empty() {
                    continue;
                }
                match eras.iter_mut().find(|(k, _)| *k == e) {
                    Some(hit) => hit.1 += 1,
                    None => eras.push((e, 1)),
                }
            }
            let era = eras.iter().fold(None::<(&str, usize)>, |best, &(k, c)| match best {
                Some((_, bc)) if bc >= c => best,
                _ => Some((k, c)),
            });
            json!({
                "from": years.iter().copied().reduce(f64::min),
                "to": years.iter().copied().reduce(f64::max),
                "era": era.map(|e| e.0).unwrap_or(""),
            })
        })
        .collect();
    Layout { cols, lanes: offset, pos: (0..n).map(|i| (cols_of[i], lane[i])).collect(), columns, strands }
}

/// Gerüst-Knoten: noch ohne Inhalt (Story, Quiz, Arbeitsblatt, Bilder) – die KI arbeitet ihn später aus.
pub fn is_draft(n: &Node) -> bool {
    n.body.trim().is_empty() && n.quiz.is_empty() && n.worksheet.is_none() && n.images.is_empty() && n.svg.is_none()
}

fn entry(n: &Node, state: State, (col, lane): (usize, usize)) -> Value {
    let answered = n.progress.quiz.as_ref().map_or(0, |q| q.results.len());
    json!({
        "id": n.id,
        "title": n.title,
        "era": n.era,
        "year": n.year,
        "strand": n.strand,
        "summary": n.summary,
        "draft": is_draft(n),
        "col": col,
        "lane": lane,
        "state": state.as_str(),
        "quiz": { "total": n.quiz.len(), "answered": answered, "passed": n.progress.quiz_passed },
        "worksheet": n.worksheet.as_ref().map(|_| n.progress.worksheet.status.as_str()),
    })
}

fn counts(tl: &Timeline, states: &[State]) -> Value {
    let mastered = states.iter().filter(|s| **s == State::Mastered).count();
    let next = states.iter().filter(|s| **s == State::Next).count();
    let drafts = tl.nodes.iter().filter(|n| is_draft(n)).count();
    json!({ "total": states.len(), "mastered": mastered, "next": next, "drafts": drafts })
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
    json!({
        "cols": lay.cols,
        "lanes": lay.lanes,
        "kind": if tl.is_path() { "path" } else { "history" },
        "exam": tl.exam,
        "columns": lay.columns,
        "strands": lay.strands,
        "nodes": nodes,
        "edges": edges,
        "stats": counts(tl, &st),
    })
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
            json!({ "cols": 0, "lanes": 0, "kind": "history", "exam": "", "columns": [], "strands": [], "nodes": [], "edges": [], "stats": { "total": 0, "mastered": 0, "next": 0, "drafts": 0 } })
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
                    "year": n.year,
                    "strand": n.strand,
                    "draft": is_draft(n),
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
            "kind": if tl.is_path() { "path" } else { "history" },
            "exam": tl.exam,
            "stats": counts(&tl, &st),
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
    let drafts = t.nodes.iter().filter(|n| is_draft(n)).count();
    json!({
        "id": t.id,
        "title": t.title,
        "subject": t.subject,
        "description": t.description,
        "kind": if t.is_path() { "path" } else { "history" },
        "exam": t.exam,
        "accent": t.theme.accent,
        "updated": t.updated,
        "total": t.nodes.len(),
        "mastered": mastered,
        "drafts": drafts,
    })
}
