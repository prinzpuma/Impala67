//! Schulnoten, Tagesartikel-Auswahl und Chat-Sitzungsliste für PWA, iOS und Android.

use std::collections::{HashMap, HashSet};

use impala_sort::SortExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::types::{ChatSession, Grade, HomeArticle, State};

// ---- a) Schulnoten -------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GradeInfo {
    pub id: String,
    pub subject: String,
    pub grade: f64,
    pub weight: f64,
    pub date: String,
    pub comment: String,
    pub created: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SubjectGrades {
    pub subject: String,
    pub grades: Vec<GradeInfo>,
    pub average: Option<f64>,
}

/// Farb-Stufe einer Note (1..=5):
/// 1: <= 1.5, 2: <= 2.5, 3: <= 3.5, 4: <= 4.5, 5: > 4.5.
pub fn grade_tier(grade: f64) -> u8 {
    if grade <= 1.5 {
        1
    } else if grade <= 2.5 {
        2
    } else if grade <= 3.5 {
        3
    } else if grade <= 4.5 {
        4
    } else {
        5
    }
}

fn grade_from_record(id: &str, g: &Grade) -> Option<GradeInfo> {
    if g.deleted.unwrap_or(false) || g.truthy("deleted") {
        return None;
    }
    let val = g.grade.or_else(|| g.get("grade").and_then(|v| v.as_str()?.parse().ok()))?;
    if !val.is_finite() {
        return None;
    }
    let weight = g
        .weight
        .or_else(|| g.get("weight").and_then(|v| v.as_str()?.parse().ok()))
        .filter(|w| w.is_finite() && *w > 0.0)
        .unwrap_or(1.0);
    let subject = g.subject.as_deref().unwrap_or("").trim();
    let date = g.date.as_deref().unwrap_or("");
    let created = g.created.as_deref().unwrap_or("");
    Some(GradeInfo {
        id: g.id.as_deref().filter(|s| !s.is_empty()).unwrap_or(id).to_owned(),
        subject: if subject.is_empty() { "Allgemein".into() } else { subject.to_owned() },
        grade: val,
        weight,
        date: if !date.is_empty() { date.to_owned() } else { created.get(..10).unwrap_or("").to_owned() },
        comment: g.comment.clone().unwrap_or_default(),
        created: created.to_owned(),
    })
}

/// Alle gültigen, nicht gelöschten Noten, neueste zuerst (`date || created`).
pub fn all_grades(state: &State) -> Vec<GradeInfo> {
    let mut out: Vec<GradeInfo> = state.grades.iter().filter_map(|(id, g)| grade_from_record(id, g)).collect();
    out.sort_small_by(|a, b| {
        let da = if !a.date.is_empty() { a.date.as_str() } else { a.created.as_str() };
        let db = if !b.date.is_empty() { b.date.as_str() } else { b.created.as_str() };
        db.cmp(da)
    });
    out
}

/// Gewichteter Notenschnitt (`None` bei leerer Liste oder Gesamtgewicht <= 0).
pub fn weighted_average(list: &[GradeInfo]) -> Option<f64> {
    if list.is_empty() {
        return None;
    }
    let mut sum = 0.0;
    let mut weight = 0.0;
    for g in list {
        let w = if g.weight.is_finite() && g.weight > 0.0 { g.weight } else { 1.0 };
        if g.grade.is_finite() {
            sum += g.grade * w;
            weight += w;
        }
    }
    (weight > 0.0).then_some(sum / weight)
}

/// Noten nach Fächern gruppiert, alphabetisch nach Fachname (`de`).
pub fn grades_by_subject(state: &State) -> Vec<SubjectGrades> {
    let mut by_subj: HashMap<String, Vec<GradeInfo>> = HashMap::new();
    for g in all_grades(state) {
        by_subj.entry(g.subject.clone()).or_default().push(g);
    }
    let mut out: Vec<SubjectGrades> = by_subj
        .into_iter()
        .map(|(subject, grades)| {
            let average = weighted_average(&grades);
            SubjectGrades { subject, grades, average }
        })
        .collect();
    out.sort_small_by(|a, b| {
        a.subject.to_lowercase().cmp(&b.subject.to_lowercase()).then_with(|| a.subject.cmp(&b.subject))
    });
    out
}

fn fmt_de(n: f64, digits: usize) -> String {
    format!("{n:.digits$}").replace('.', ",")
}

fn weight_label(w: f64) -> String {
    if (w - 1.0).abs() < 1e-9 {
        "1×".into()
    } else if (w.fract()).abs() < 1e-9 {
        format!("{}×", w as i64)
    } else {
        format!("{}×", fmt_de(w, 2).trim_end_matches('0').trim_end_matches(','))
    }
}

/// Markdown-Export der Notenübersicht (`today_label` z. B. `"07.11.2026"`).
pub fn export_grades_markdown(state: &State, today_label: &str) -> String {
    let list = all_grades(state);
    let overall = weighted_average(&list);
    let subjs = grades_by_subject(state);
    let mut lines = vec![
        "# Schulnoten-Übersicht".to_owned(),
        String::new(),
        format!(
            "**Gesamtschnitt:** {} ({} {}) · Stand: {}",
            overall.map_or_else(|| "–".into(), |v| fmt_de(v, 2)),
            list.len(),
            if list.len() == 1 { "Note" } else { "Noten" },
            today_label
        ),
        String::new(),
    ];
    for s in subjs {
        lines.push(format!("## {} (Ø {})", s.subject, s.average.map_or_else(|| "–".into(), |v| fmt_de(v, 2))));
        lines.push(String::new());
        lines.push("| Datum | Note | Gewichtung | Kommentar |".into());
        lines.push("| --- | --- | --- | --- |".into());
        for g in s.grades {
            let date = if g.date.is_empty() { "–" } else { g.date.as_str() };
            let comment = g.comment.replace('|', "\\|");
            lines.push(format!("| {} | {} | {} | {} |", date, fmt_de(g.grade, 1), weight_label(g.weight), comment));
        }
        lines.push(String::new());
    }
    lines.join("\n")
}

// ---- b) Tagesartikel-Auswahl ---------------------------------------------------------------

const KEEP_ARTICLES: usize = 30;
const RECENT_ARTICLES: usize = 7;
const ACTIVE_NOTES: usize = 4;
const ARCHIVED_NOTES: usize = 2;
const MIN_TEXT: usize = 40;
const OVERVIEW_SUBJECT: &str = "Übersicht & Organisation";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArticlePoolItem {
    pub id: String,
    pub content_len: usize,
    pub updated: String,
    pub archived: bool,
    pub subject: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArticleChoice {
    pub focus: Option<String>,
    pub note_ids: Vec<String>,
}

/// Gespeicherte Tagesartikel, neueste zuerst (höchstens 30).
pub fn sorted_home_articles(state: &State) -> Vec<&HomeArticle> {
    let mut list: Vec<&HomeArticle> = state.home_articles.values().collect();
    list.sort_small_by(|a, b| {
        let ca = a.created.as_deref().unwrap_or("");
        let cb = b.created.as_deref().unwrap_or("");
        cb.cmp(ca)
    });
    list.truncate(KEEP_ARTICLES);
    list
}

/// Eigenes Thema wählen: das am längsten nicht behandelte aus `topics_raw` (komma-/semikolon-/zeilengetrennt).
/// `history_first_topics`: jeweils das erste Thema (`topics[0]`) der bisherigen Artikel (neueste zuerst).
pub fn pick_article_topic(topics_raw: &str, history_first_topics: &[String]) -> Option<String> {
    let own: Vec<String> =
        topics_raw.split([',', ';', '\n']).map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned).collect();
    if own.is_empty() {
        return None;
    }
    let last_use = |t: &str| -> usize {
        let lower = t.to_lowercase();
        history_first_topics.iter().position(|h| h.to_lowercase() == lower).unwrap_or(usize::MAX)
    };
    let mut best = own[0].clone();
    let mut best_use = last_use(&best);
    for t in own.into_iter().skip(1) {
        let u = last_use(&t);
        if u > best_use {
            best = t;
            best_use = u;
        }
    }
    Some(best)
}

/// Schwerpunkt-Fach und Notizen für den Tagesartikel wählen.
pub fn choose_article_notes(
    pool: &[ArticlePoolItem],
    recent_used_ids: &[String],
    recent_focuses: &[String],
    known_subjects: &[String],
) -> ArticleChoice {
    let used_set: HashSet<&str> = recent_used_ids.iter().map(String::as_str).collect();
    let last_focus: HashSet<&str> =
        recent_focuses.iter().take(2).map(String::as_str).filter(|s| !s.is_empty()).collect();
    let known_set: HashSet<&str> = known_subjects.iter().map(String::as_str).collect();

    #[derive(Clone)]
    struct Usable<'a> {
        item: &'a ArticlePoolItem,
        used: bool,
    }

    let usable: Vec<Usable<'_>> = pool
        .iter()
        .filter(|p| p.content_len >= MIN_TEXT && p.subject != OVERVIEW_SUBJECT)
        .map(|item| Usable { item, used: used_set.contains(item.id.as_str()) })
        .collect();

    let has_active = usable.iter().any(|n| !n.item.archived);
    let candidates: Vec<&Usable<'_>> =
        if has_active { usable.iter().filter(|n| !n.item.archived).collect() } else { usable.iter().collect() };

    #[derive(Default)]
    struct SubjGroup {
        fresh: usize,
        newest: String,
        order: usize,
    }

    let mut by_subject: HashMap<&str, SubjGroup> = HashMap::new();
    for (idx, n) in candidates.iter().enumerate() {
        let subj = n.item.subject.as_str();
        let g = by_subject.entry(subj).or_insert_with(|| SubjGroup { fresh: 0, newest: String::new(), order: idx });
        if !n.used {
            g.fresh += 1;
        }
        if n.item.updated > g.newest {
            g.newest = n.item.updated.clone();
        }
    }

    let mut subj_list: Vec<(&str, SubjGroup)> = by_subject.into_iter().collect();
    subj_list.sort_small_by(|(a, x), (b, y)| {
        let lf_a = u8::from(last_focus.contains(a));
        let lf_b = u8::from(last_focus.contains(b));
        let fr_a = if x.fresh > 0 { 0u8 } else { 1u8 };
        let fr_b = if y.fresh > 0 { 0u8 } else { 1u8 };
        let kn_a = u8::from(known_set.contains(a));
        let kn_b = u8::from(known_set.contains(b));
        lf_a.cmp(&lf_b)
            .then_with(|| fr_a.cmp(&fr_b))
            .then_with(|| kn_b.cmp(&kn_a))
            .then_with(|| y.newest.cmp(&x.newest))
            .then_with(|| x.order.cmp(&y.order))
    });

    let focus = subj_list.first().map(|(s, _)| (*s).to_owned());
    let Some(ref focus_name) = focus else {
        return ArticleChoice { focus: None, note_ids: Vec::new() };
    };

    let mut in_focus: Vec<&Usable<'_>> = usable.iter().filter(|n| n.item.subject == *focus_name).collect();
    in_focus.sort_small_by(|a, b| {
        u8::from(a.used).cmp(&u8::from(b.used)).then_with(|| b.item.updated.cmp(&a.item.updated))
    });

    let all_candidates = !has_active;
    let main: Vec<&str> = in_focus
        .iter()
        .filter(|n| !n.item.archived || all_candidates)
        .take(ACTIVE_NOTES)
        .map(|n| n.item.id.as_str())
        .collect();
    let main_set: HashSet<&str> = main.iter().copied().collect();
    let side: Vec<&str> = in_focus
        .iter()
        .filter(|n| n.item.archived && !main_set.contains(n.item.id.as_str()))
        .take(ARCHIVED_NOTES)
        .map(|n| n.item.id.as_str())
        .collect();

    let note_ids = main.into_iter().chain(side).map(str::to_owned).collect();
    ArticleChoice { focus, note_ids }
}

/// Themen- und Quellen-Historie aus dem gespeicherten `State` extrahieren (für `pick_article_topic` / `choose_article_notes`).
pub fn article_history_meta(state: &State) -> (Vec<String>, Vec<String>, Vec<String>) {
    let history = sorted_home_articles(state);
    let first_topics: Vec<String> = history
        .iter()
        .map(|a| {
            a.extra
                .get("topics")
                .and_then(Value::as_array)
                .and_then(|arr| arr.first())
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned()
        })
        .collect();
    let recent = &history[..history.len().min(RECENT_ARTICLES)];
    let used_ids: Vec<String> = recent
        .iter()
        .flat_map(|a| {
            a.extra
                .get("sources")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|s| s.get("id").and_then(Value::as_str).map(str::to_owned))
        })
        .collect();
    let recent_focuses: Vec<String> = recent
        .iter()
        .take(2)
        .filter_map(|a| a.extra.get("focus").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_owned))
        .collect();
    (first_topics, used_ids, recent_focuses)
}

// ---- c) Chat-Sitzungen ---------------------------------------------------------------------

/// Sortierschlüssel einer Chat-Sitzung (`updated || created || ""`).
fn chat_sort_ts(c: &Value) -> &str {
    c.get("updated")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .or_else(|| c.get("created").and_then(Value::as_str))
        .unwrap_or("")
}

/// Sortiert eine Liste von Chat-Sitzungen absteigend nach `updated || created`.
pub fn sort_chat_values(mut list: Vec<Value>) -> Vec<Value> {
    list.sort_small_by(|a, b| chat_sort_ts(b).cmp(chat_sort_ts(a)));
    list
}

/// Normalisiert eine rohe Chat-Sitzung (`now` als Rückfall für `created`/`updated`) und erhält alle Zusatzfelder.
pub fn normalize_chat_value(raw: &Value, now: &str) -> Option<Value> {
    let obj = raw.as_object()?;
    let id = match obj.get("id") {
        Some(Value::String(s)) if !s.is_empty() => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => return None,
    };
    let title = obj.get("title").and_then(Value::as_str).unwrap_or("").to_owned();
    let raw_created = obj.get("created").and_then(Value::as_str).filter(|s| !s.is_empty());
    let raw_updated = obj.get("updated").and_then(Value::as_str).filter(|s| !s.is_empty());
    let created = raw_created.or(raw_updated).unwrap_or(now).to_owned();
    let updated = raw_updated.or(raw_created).unwrap_or(now).to_owned();
    let messages: Vec<Value> = obj.get("messages").and_then(Value::as_array).cloned().unwrap_or_default();

    let mut out = obj.clone();
    out.insert("id".into(), Value::String(id));
    out.insert("title".into(), Value::String(title));
    out.insert("messages".into(), Value::Array(messages));
    out.insert("created".into(), Value::String(created));
    out.insert("updated".into(), Value::String(updated));
    Some(Value::Object(out))
}

/// Führt lokale Chat-Sitzungen (`localStorage`) und synchronisierte Sitzungen (`State.chat_sessions`)
/// zusammen: Tombstones schlagen ältere Cache-Einträge, neuere `updated`-Stempel gewinnen, Ergebnis absteigend sortiert.
pub fn merged_chat_sessions(state: &State, local_raw: &[Value], now: &str) -> Vec<Value> {
    let mut by_id: HashMap<String, Value> = HashMap::new();

    for item in local_raw {
        if let Some(s) = normalize_chat_value(item, now) {
            let id = s["id"].as_str().unwrap_or("").to_owned();
            by_id.insert(id, s);
        }
    }

    for entry in state.chat_sessions.values() {
        let Some(raw_id) = entry.id.as_deref().filter(|s| !s.is_empty()) else {
            continue;
        };
        let id = raw_id.to_owned();
        if entry.is_deleted() {
            let del_at = entry.deleted_at.as_deref().unwrap_or("");
            let remove = match by_id.get(&id) {
                None => true,
                Some(cached) => {
                    let c_up = cached["updated"].as_str().unwrap_or("");
                    del_at >= c_up
                }
            };
            if remove {
                by_id.remove(&id);
            }
            continue;
        }
        let val = Value::Object(entry.to_object());
        if let Some(s) = normalize_chat_value(&val, now) {
            let replace = match by_id.get(&id) {
                None => true,
                Some(old) => {
                    let s_up = s["updated"].as_str().unwrap_or("");
                    let o_up = old["updated"].as_str().unwrap_or("");
                    s_up >= o_up
                }
            };
            if replace {
                by_id.insert(id, s);
            }
        }
    }

    sort_chat_values(by_id.into_values().collect())
}

/// Nicht gelöschte Chat-Sitzungen des Zustands, absteigend nach `updated || created` sortiert.
pub fn sorted_state_chats(state: &State) -> Vec<&ChatSession> {
    let mut out: Vec<&ChatSession> = state.chat_sessions.values().filter(|c| !c.is_deleted()).collect();
    out.sort_small_by(|a, b| {
        let ta = a.updated.as_deref().filter(|s| !s.is_empty()).or(a.created.as_deref()).unwrap_or("");
        let tb = b.updated.as_deref().filter(|s| !s.is_empty()).or(b.created.as_deref()).unwrap_or("");
        tb.cmp(ta)
    });
    out
}
