//! Schulnoten (`web/schulnoten.js`), Lernzeit-Sitzungen (`web/lernzeit.js`) und Tagesartikel der
//! Startseite (`web/home-article.js`) als typisierte Datensätze. Geschrieben wird mit denselben
//! Events und Payloads wie die PWA (`gradeAdd`/`gradeDelete`, `learningSessionUpsert`/`Delete`,
//! `homeArticleUpsert`).

use impala_model::js;
use impala_model::types::{Grade, HomeArticle, LearningSession};
use serde_json::{Value, json};

use crate::{CoreError, ImpalaCore, invalid};

// ---------------------------------------------------------------------------
// Schulnoten

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct GradeInfo {
    pub id: String,
    pub subject: String,
    /// 1,0 (beste) bis 6,0.
    pub grade: f64,
    /// Gewichtung, mindestens 0,25.
    pub weight: f64,
    /// Datum `JJJJ-MM-TT`.
    pub date: String,
    pub comment: String,
    pub created: String,
}

/// Noten eines Fachs mit gewichtetem Durchschnitt.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct SubjectGrades {
    pub subject: String,
    /// Gewichteter Durchschnitt auf zwei Stellen gerundet.
    pub average: Option<f64>,
    /// Neueste zuerst.
    pub grades: Vec<GradeInfo>,
}

fn grade_info(g: &Grade) -> GradeInfo {
    let text = |v: &Option<String>| v.clone().unwrap_or_default();
    GradeInfo {
        id: text(&g.id),
        subject: text(&g.subject),
        grade: g.grade.unwrap_or(0.0),
        weight: g.weight.unwrap_or(1.0),
        date: text(&g.date),
        comment: text(&g.comment),
        created: text(&g.created),
    }
}

/// Wie `average()` in der PWA: Gewicht 0 oder fehlend zählt als 1.
fn weighted_average(grades: &[GradeInfo]) -> Option<f64> {
    let (mut sum, mut total) = (0.0, 0.0);
    for g in grades {
        let w = if g.weight == 0.0 || !g.weight.is_finite() { 1.0 } else { g.weight };
        sum += g.grade * w;
        total += w;
    }
    (total != 0.0).then(|| (sum / total * 100.0).round() / 100.0)
}

/// Neueste zuerst: Datum, dann Anlagezeit.
fn newest(a: &GradeInfo, b: &GradeInfo) -> std::cmp::Ordering {
    js::cmp(&b.date, &a.date).then_with(|| js::cmp(&b.created, &a.created))
}

// ---------------------------------------------------------------------------
// Lernzeit

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct TimeSegment {
    pub started_at: String,
    pub ended_at: String,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct LearningSessionInfo {
    pub id: String,
    pub started_at: String,
    pub ended_at: String,
    pub duration_seconds: u64,
    /// Aktive Abschnitte (Pausen sind Lücken).
    pub segments: Vec<TimeSegment>,
    /// `notes`, `notebook`, `cards`, `ai` oder `other`.
    pub category: String,
    pub subject: Option<String>,
    pub subject_source: Option<String>,
    /// Seite, Stapel oder Chat, in dem gelernt wurde.
    pub source_id: Option<String>,
    pub updated: String,
}

/// Eingabe für `save_learning_session`; ohne `id` entsteht eine neue Sitzung.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct LearningSessionInput {
    pub id: Option<String>,
    pub started_at: String,
    pub ended_at: String,
    pub duration_seconds: u64,
    pub segments: Vec<TimeSegment>,
    pub category: String,
    pub subject: Option<String>,
    pub subject_source: Option<String>,
    pub source_id: Option<String>,
}

fn opt_text(v: Option<Value>) -> Option<String> {
    v.as_ref().and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_owned)
}

fn session_info(s: &LearningSession) -> LearningSessionInfo {
    let text = |v: &Option<String>| v.clone().unwrap_or_default();
    let segments = match s.get("segments") {
        Some(Value::Array(list)) => list
            .iter()
            .filter_map(|seg| {
                let part = |k: &str| seg.get(k).and_then(Value::as_str).map(str::to_owned);
                Some(TimeSegment { started_at: part("startedAt")?, ended_at: part("endedAt")? })
            })
            .collect(),
        _ => Vec::new(),
    };
    LearningSessionInfo {
        id: text(&s.id),
        started_at: text(&s.started_at),
        ended_at: text(&s.ended_at),
        duration_seconds: s.duration_seconds.unwrap_or(0.0).max(0.0) as u64,
        segments,
        category: opt_text(s.get("category")).unwrap_or_else(|| "other".to_owned()),
        subject: opt_text(s.get("subject")),
        subject_source: opt_text(s.get("subjectSource")),
        source_id: opt_text(s.get("sourceId")),
        updated: text(&s.updated),
    }
}

// ---------------------------------------------------------------------------
// Tagesartikel

/// Notiz, aus der ein Tagesartikel entstand.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ArticleSource {
    pub id: String,
    pub title: String,
    pub archived: bool,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct HomeArticleInfo {
    pub id: String,
    /// Tag `JJJJ-MM-TT`.
    pub day: String,
    pub created: String,
    pub updated: String,
    /// Gelesen am; gilt auf allen Geräten.
    pub read_at: Option<String>,
    pub title: String,
    /// Artikeltext als Markdown.
    pub body: String,
    pub topics: Vec<String>,
    pub focus: Option<String>,
    pub sources: Vec<ArticleSource>,
}

/// Eingabe für `save_home_article`; ohne `id` entsteht ein neuer Artikel.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct HomeArticleInput {
    pub id: Option<String>,
    pub day: String,
    pub title: String,
    pub body: String,
    pub topics: Vec<String>,
    pub focus: Option<String>,
    pub sources: Vec<ArticleSource>,
}

fn article_info(a: &HomeArticle) -> HomeArticleInfo {
    let text = |v: &Option<String>| v.clone().unwrap_or_default();
    let topics = match a.get("topics") {
        Some(Value::Array(list)) => list.iter().filter_map(|t| t.as_str().map(str::to_owned)).collect(),
        _ => Vec::new(),
    };
    let sources = match a.get("sources") {
        Some(Value::Array(list)) => list
            .iter()
            .filter_map(|s| {
                Some(ArticleSource {
                    id: s.get("id")?.as_str()?.to_owned(),
                    title: s.get("title").and_then(Value::as_str).unwrap_or_default().to_owned(),
                    archived: s.get("archived").is_some_and(js::truthy),
                })
            })
            .collect(),
        _ => Vec::new(),
    };
    HomeArticleInfo {
        id: text(&a.id),
        day: text(&a.day),
        created: text(&a.created),
        updated: text(&a.updated),
        read_at: a.read_at.clone().filter(|r| !r.is_empty()),
        title: text(&a.title),
        body: text(&a.body),
        topics,
        focus: opt_text(a.get("focus")),
        sources,
    }
}

/// Payload des Events (`archived` nur, wenn gesetzt – wie in der PWA).
fn article_payload(a: &HomeArticleInfo) -> Value {
    let sources: Vec<Value> = a
        .sources
        .iter()
        .map(|s| {
            if s.archived {
                json!({ "id": s.id, "title": s.title, "archived": true })
            } else {
                json!({ "id": s.id, "title": s.title })
            }
        })
        .collect();
    json!({
        "id": a.id, "day": a.day, "created": a.created, "updated": a.updated, "readAt": a.read_at,
        "topics": a.topics, "focus": a.focus, "title": a.title, "body": a.body, "sources": sources,
    })
}

#[uniffi::export]
impl ImpalaCore {
    /// Alle Noten (ohne gelöschte), neueste zuerst.
    pub fn grades(&self) -> Vec<GradeInfo> {
        let inner = self.lock();
        let mut list: Vec<GradeInfo> =
            inner.model.state().grades.values().filter(|g| !g.truthy("deleted")).map(grade_info).collect();
        list.sort_by(newest);
        list
    }

    /// Noten je Fach mit gewichtetem Durchschnitt, Fächer alphabetisch.
    pub fn grades_by_subject(&self) -> Vec<SubjectGrades> {
        let mut out: Vec<SubjectGrades> = Vec::new();
        for g in self.grades() {
            match out.iter_mut().find(|s| s.subject == g.subject) {
                Some(s) => s.grades.push(g),
                None => out.push(SubjectGrades { subject: g.subject.clone(), average: None, grades: vec![g] }),
            }
        }
        for s in &mut out {
            s.average = weighted_average(&s.grades);
        }
        out.sort_by_key(|s| s.subject.to_lowercase());
        out
    }

    /// Note eintragen; liefert ihre ID. `grade` 1…6, `weight` mindestens 0,25 (Standard 1), `date`
    /// als `JJJJ-MM-TT` (ohne: heute nach der Kernuhr, UTC).
    pub fn add_grade(
        &self,
        subject: String,
        grade: f64,
        weight: Option<f64>,
        date: Option<String>,
        comment: Option<String>,
    ) -> Result<String, CoreError> {
        let subject = subject.trim().to_owned();
        if subject.is_empty() || !grade.is_finite() || !(1.0..=6.0).contains(&grade) {
            return Err(invalid("Bitte Fach und eine Note von 1 bis 6 angeben"));
        }
        let weight = weight.filter(|w| w.is_finite() && *w != 0.0).unwrap_or(1.0).max(0.25);
        let id = uuid::Uuid::new_v4().to_string();
        let mut payload = json!({
            "id": id, "subject": subject, "grade": grade, "weight": weight,
            "comment": comment.unwrap_or_default().trim(),
        });
        if let Some(d) = date.filter(|d| !d.trim().is_empty()) {
            payload["date"] = Value::from(d.trim());
        }
        self.lock().dispatch("gradeAdd", payload)?;
        Ok(id)
    }

    /// Note löschen (bleibt im Log als gelöscht markiert).
    pub fn delete_grade(&self, id: String) -> Result<(), CoreError> {
        let mut inner = self.lock();
        if !inner.model.state().grades.contains_key(&id) {
            return Err(invalid(format!("Unbekannte Note {id}")));
        }
        inner.dispatch("gradeDelete", json!({ "id": id }))?;
        Ok(())
    }

    /// Lernsitzungen (ohne gelöschte), neueste zuerst.
    pub fn learning_sessions(&self) -> Vec<LearningSessionInfo> {
        let inner = self.lock();
        let mut list: Vec<LearningSessionInfo> =
            inner.model.state().learning_sessions.values().filter(|s| !s.truthy("deleted")).map(session_info).collect();
        list.sort_by(|a, b| js::cmp(&b.started_at, &a.started_at));
        list
    }

    pub fn learning_session(&self, id: String) -> Option<LearningSessionInfo> {
        let inner = self.lock();
        inner.model.state().learning_sessions.get(&id).filter(|s| !s.truthy("deleted")).map(session_info)
    }

    /// Lernsitzung anlegen oder (mit bekannter `id`) ersetzen; liefert die ID. Abschnitte ohne Anfang
    /// oder Ende fallen weg. Eine gelöschte Sitzung bleibt gelöscht, wenn die Löschung neuer ist.
    pub fn save_learning_session(&self, input: LearningSessionInput) -> Result<String, CoreError> {
        if input.started_at.is_empty() || input.ended_at.is_empty() {
            return Err(invalid("Beginn und Ende der Lernsitzung fehlen"));
        }
        let id = input.id.filter(|i| !i.is_empty()).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let segments: Vec<Value> =
            input.segments.iter().map(|s| json!({ "startedAt": s.started_at, "endedAt": s.ended_at })).collect();
        let mut payload = json!({
            "id": id, "startedAt": input.started_at, "endedAt": input.ended_at,
            "durationSeconds": input.duration_seconds, "segments": segments,
            "category": if input.category.is_empty() { "other" } else { input.category.as_str() },
        });
        // Fehlende Felder bleiben weg: der Kern behält dann den alten Wert.
        for (key, value) in
            [("subject", input.subject), ("subjectSource", input.subject_source), ("sourceId", input.source_id)]
        {
            if let Some(v) = value {
                payload[key] = Value::from(v);
            }
        }
        self.lock().dispatch("learningSessionUpsert", payload)?;
        Ok(id)
    }

    /// Lernsitzung löschen (bleibt im Log als gelöscht markiert).
    pub fn delete_learning_session(&self, id: String) -> Result<(), CoreError> {
        let mut inner = self.lock();
        if !inner.model.state().learning_sessions.contains_key(&id) {
            return Err(invalid(format!("Unbekannte Lernsitzung {id}")));
        }
        inner.dispatch("learningSessionDelete", json!({ "id": id }))?;
        Ok(())
    }

    /// Gesamte Lernzeit in Sekunden aller Sitzungen (ohne gelöschte).
    pub fn learning_seconds_total(&self) -> u64 {
        self.learning_sessions().iter().map(|s| s.duration_seconds).sum()
    }

    /// Tagesartikel der Startseite, neueste zuerst (`limit` 0 = alle; die PWA zeigt 30).
    pub fn home_articles(&self, limit: u32) -> Vec<HomeArticleInfo> {
        let inner = self.lock();
        let mut list: Vec<HomeArticleInfo> = inner.model.state().home_articles.values().map(article_info).collect();
        list.sort_by(|a, b| js::cmp(&b.created, &a.created));
        if limit > 0 {
            list.truncate(limit as usize);
        }
        list
    }

    pub fn home_article(&self, id: String) -> Option<HomeArticleInfo> {
        self.lock().model.state().home_articles.get(&id).map(article_info)
    }

    /// Tagesartikel anlegen oder (mit bekannter `id`) ändern; liefert die ID. Anlagezeit und
    /// „gelesen“ eines bestehenden Artikels bleiben erhalten.
    pub fn save_home_article(&self, input: HomeArticleInput) -> Result<String, CoreError> {
        if input.body.trim().is_empty() {
            return Err(invalid("Der Artikel hat keinen Text"));
        }
        let mut inner = self.lock();
        let now = inner.clock.now();
        let id = input.id.filter(|i| !i.is_empty()).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let old = inner.model.state().home_articles.get(&id).map(article_info);
        let article = HomeArticleInfo {
            created: old.as_ref().map_or_else(|| now.clone(), |o| o.created.clone()),
            read_at: old.and_then(|o| o.read_at),
            id: id.clone(),
            updated: now,
            day: input.day,
            title: input.title,
            body: input.body,
            topics: input.topics,
            focus: input.focus,
            sources: input.sources,
        };
        inner.dispatch("homeArticleUpsert", article_payload(&article))?;
        Ok(id)
    }

    /// Artikel als gelesen markieren (gilt auf allen Geräten, wie die PWA: ganzer Artikel mit
    /// `readAt` und `updated`).
    pub fn mark_home_article_read(&self, id: String) -> Result<(), CoreError> {
        let mut inner = self.lock();
        let Some(mut article) = inner.model.state().home_articles.get(&id).map(article_info) else {
            return Err(invalid(format!("Unbekannter Artikel {id}")));
        };
        if article.read_at.is_some() {
            return Ok(());
        }
        let now = inner.clock.now();
        article.read_at = Some(now.clone());
        article.updated = now;
        inner.dispatch("homeArticleUpsert", article_payload(&article))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noten() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let a = core
            .add_grade(" Mathe ".into(), 2.0, Some(2.0), Some("2026-05-01".into()), Some(" Klausur ".into()))
            .unwrap();
        core.add_grade("Mathe".into(), 3.0, None, Some("2026-06-01".into()), None).unwrap();
        core.add_grade("Bio".into(), 1.0, Some(0.0), None, None).unwrap();
        assert!(core.add_grade("".into(), 2.0, None, None, None).is_err());
        assert!(core.add_grade("Mathe".into(), 7.0, None, None, None).is_err());
        assert!(core.add_grade("Mathe".into(), f64::NAN, None, None, None).is_err());

        let by = core.grades_by_subject();
        assert_eq!(by.iter().map(|s| s.subject.as_str()).collect::<Vec<_>>(), ["Bio", "Mathe"]);
        let mathe = &by[1];
        assert_eq!(mathe.average, Some(2.33)); // (2*2 + 3*1) / 3
        assert_eq!(mathe.grades[0].date, "2026-06-01");
        assert_eq!((mathe.grades[1].weight, mathe.grades[1].comment.as_str()), (2.0, "Klausur"));
        assert_eq!(by[0].grades[0].weight, 1.0);
        assert_eq!(by[0].grades[0].date.len(), 10);

        core.delete_grade(a).unwrap();
        assert_eq!(core.grades().len(), 2);
        assert!(core.delete_grade("x".into()).is_err());
        assert_eq!(core.grades_by_subject()[1].average, Some(3.0));
    }

    fn input(id: Option<String>, secs: u64) -> LearningSessionInput {
        LearningSessionInput {
            id,
            started_at: "2026-05-01T10:00:00.000Z".into(),
            ended_at: "2026-05-01T10:30:00.000Z".into(),
            duration_seconds: secs,
            segments: vec![
                TimeSegment {
                    started_at: "2026-05-01T10:00:00.000Z".into(),
                    ended_at: "2026-05-01T10:20:00.000Z".into(),
                },
                TimeSegment { started_at: String::new(), ended_at: "x".into() },
            ],
            category: "cards".into(),
            subject: Some("Mathe".into()),
            subject_source: Some("deck".into()),
            source_id: Some("Mathe".into()),
        }
    }

    #[test]
    fn lernsitzungen() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let id = core.save_learning_session(input(None, 1500)).unwrap();
        let s = core.learning_session(id.clone()).unwrap();
        assert_eq!((s.duration_seconds, s.category.as_str(), s.subject.as_deref()), (1500, "cards", Some("Mathe")));
        assert_eq!(s.segments.len(), 1); // leerer Abschnitt fällt weg
        assert!(!s.updated.is_empty());

        // Aktualisieren behält Felder, die fehlen.
        let mut again = input(Some(id.clone()), 1700);
        again.subject = None;
        core.save_learning_session(again).unwrap();
        let s = core.learning_session(id.clone()).unwrap();
        assert_eq!((s.duration_seconds, s.subject.as_deref()), (1700, Some("Mathe")));
        assert_eq!(core.learning_seconds_total(), 1700);

        let mut bad = input(None, 1);
        bad.ended_at.clear();
        assert!(core.save_learning_session(bad).is_err());

        core.delete_learning_session(id.clone()).unwrap();
        assert!(core.learning_sessions().is_empty() && core.learning_session(id).is_none());
        assert!(core.delete_learning_session("x".into()).is_err());
    }

    #[test]
    fn tagesartikel() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let mk = |day: &str| HomeArticleInput {
            id: None,
            day: day.into(),
            title: format!("Artikel {day}"),
            body: "## Text\n\nInhalt".into(),
            topics: vec!["Mathe".into()],
            focus: Some("Analysis".into()),
            sources: vec![
                ArticleSource { id: "p1".into(), title: "Notiz".into(), archived: false },
                ArticleSource { id: "p2".into(), title: "Alt".into(), archived: true },
            ],
        };
        let a = core.save_home_article(mk("2026-05-01")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let b = core.save_home_article(mk("2026-05-02")).unwrap();
        let list = core.home_articles(0);
        assert_eq!((list[0].id.as_str(), list[1].id.as_str()), (b.as_str(), a.as_str()));
        assert_eq!(core.home_articles(1).len(), 1);
        let first = core.home_article(a.clone()).unwrap();
        assert_eq!(
            (first.topics.as_slice(), first.focus.as_deref()),
            (["Mathe".to_owned()].as_slice(), Some("Analysis"))
        );
        assert!(first.sources[1].archived && !first.sources[0].archived);
        assert_eq!(first.read_at, None);

        core.mark_home_article_read(a.clone()).unwrap();
        let read = core.home_article(a.clone()).unwrap();
        assert!(read.read_at.is_some());
        assert_eq!(read.created, first.created);
        assert!(read.updated > first.updated);
        // Bearbeiten behält Anlagezeit und Gelesen-Stempel.
        let mut edit = mk("2026-05-01");
        edit.id = Some(a.clone());
        edit.title = "Neu".into();
        core.save_home_article(edit).unwrap();
        let edited = core.home_article(a).unwrap();
        assert_eq!((edited.title.as_str(), edited.created.as_str()), ("Neu", first.created.as_str()));
        assert_eq!(edited.read_at, read.read_at);
        assert!(core.mark_home_article_read("x".into()).is_err());
        let mut empty = mk("2026-05-03");
        empty.body = "  ".into();
        assert!(core.save_home_article(empty).is_err());
    }
}
