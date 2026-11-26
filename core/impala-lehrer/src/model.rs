//! Datenmodell des Zeitstrahls. Lesen ist tolerant (fehlende Felder → Standardwert, unbekannte
//! Felder und kaputte Listeneinträge werden übergangen), Schreiben immer im Format v1.

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

use crate::text::parse_number;

pub const MAX_NODES: usize = 400;
pub const MAX_BODY: usize = 40_000;
pub const MAX_SVG: usize = 200 * 1024;

/// Text, auch wenn jemand eine Zahl oder `null` geschickt hat.
fn text<'de, D: Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::String(s) => s,
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    })
}

/// Liste, bei der unlesbare Einträge wegfallen statt alles zu verwerfen.
fn lenient_vec<'de, D: Deserializer<'de>, T: serde::de::DeserializeOwned>(d: D) -> Result<Vec<T>, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::Array(items) => items.into_iter().filter_map(|v| serde_json::from_value(v).ok()).collect(),
        _ => Vec::new(),
    })
}

fn lenient_quiz<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<Question>, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::Array(items) => items.iter().filter_map(|v| Question::from_value(v).ok()).collect(),
        _ => Vec::new(),
    })
}

fn opt_question<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Question>, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::Null => None,
        v => Question::from_value(&v).ok(),
    })
}

fn opt_text<'de, D: Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::String(s) if !s.trim().is_empty() => Some(s),
        _ => None,
    })
}

/// Jahreszahl aus Zahl oder Text („1827“, „-350“); alles andere = keins.
fn opt_year<'de, D: Deserializer<'de>>(d: D) -> Result<Option<f64>, D::Error> {
    Ok(year_of(&Value::deserialize(d)?))
}

pub fn year_of(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => parse_number(s),
        _ => None,
    }
    .filter(|y| y.is_finite() && y.abs() < 1e7)
}

impl Timeline {
    pub fn is_path(&self) -> bool {
        self.kind == "path"
    }
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Theme {
    #[serde(deserialize_with = "text")]
    pub css: String,
    #[serde(deserialize_with = "text")]
    pub accent: String,
}

/// Lernprofil & Material-Bindung des Zeitstrahls (gesetzt im Grill-Me-Interview oder per MCP).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Brief {
    /// IDs der verknüpften Skript-/Notiz-Seiten aus der Bibliothek.
    #[serde(deserialize_with = "lenient_vec")]
    pub material_pages: Vec<String>,
    /// Konkretes Lern- oder Klausurziel.
    #[serde(deserialize_with = "text")]
    pub goal: String,
    /// Vorwissen / Einstiegsniveau.
    #[serde(deserialize_with = "text")]
    pub level: String,
    /// Gewünschter Erklär- und Lernstil.
    #[serde(deserialize_with = "text")]
    pub style: String,
    /// Darf Wikipedia für Historie und Bilder genutzt werden?
    #[serde(default = "default_true")]
    pub wiki: bool,
    /// Freie Absprachen / Notizen aus Interview oder MCP-Agent.
    #[serde(deserialize_with = "text")]
    pub notes: String,
}

impl Default for Brief {
    fn default() -> Self {
        Brief {
            material_pages: Vec::new(),
            goal: String::new(),
            level: String::new(),
            style: String::new(),
            wiki: true,
            notes: String::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Timeline {
    pub v: u32,
    #[serde(deserialize_with = "text")]
    pub id: String,
    #[serde(deserialize_with = "text")]
    pub title: String,
    #[serde(deserialize_with = "text")]
    pub subject: String,
    #[serde(deserialize_with = "text")]
    pub description: String,
    pub theme: Theme,
    pub brief: Brief,
    /// `history` (Zeitachse mit Jahren, Standard) oder `path` (Lernpfad ohne Jahre).
    #[serde(deserialize_with = "text")]
    pub kind: String,
    /// Klausurdatum `JJJJ-MM-TT` (leer = keins): Ziel am rechten Ende.
    #[serde(deserialize_with = "text")]
    pub exam: String,
    #[serde(deserialize_with = "text")]
    pub created: String,
    #[serde(deserialize_with = "text")]
    pub updated: String,
    #[serde(deserialize_with = "lenient_vec")]
    pub nodes: Vec<Node>,
}

impl Default for Timeline {
    fn default() -> Self {
        Timeline {
            v: 1,
            id: String::new(),
            title: String::new(),
            subject: String::new(),
            description: String::new(),
            theme: Theme::default(),
            brief: Brief::default(),
            kind: String::new(),
            exam: String::new(),
            created: String::new(),
            updated: String::new(),
            nodes: Vec::new(),
        }
    }
}

impl Timeline {
    /// Liest einen Zeitstrahl aus JSON.
    pub fn parse(v: &Value) -> Result<Timeline, String> {
        if !v.is_object() {
            return Err("Zeitstrahl unlesbar: kein Objekt.".into());
        }
        serde_json::from_value(v.clone()).map_err(|e| format!("Zeitstrahl unlesbar: {e}"))
    }

    pub fn to_value(&self) -> Value {
        serde_json::to_value(self).unwrap_or(Value::Null)
    }

    /// Knoten per id, sonst per Titel (ohne Groß-/Kleinschreibung, getrimmt).
    pub fn find(&self, key: &str) -> Option<usize> {
        find_in(&self.nodes, key)
    }

    /// Ein Knoten, der (indirekt) sein eigener Vorgänger ist, falls es einen gibt.
    pub fn find_cycle(&self) -> Option<usize> {
        // 0 = unbesucht, 1 = auf dem aktuellen Weg, 2 = fertig.
        fn visit(tl: &Timeline, i: usize, state: &mut [u8]) -> Option<usize> {
            state[i] = 1;
            for p in &tl.nodes[i].parents {
                let Some(pi) = tl.nodes.iter().position(|n| &n.id == p) else { continue };
                if state[pi] == 1 {
                    return Some(pi);
                }
                if state[pi] == 0
                    && let Some(c) = visit(tl, pi, state)
                {
                    return Some(c);
                }
            }
            state[i] = 2;
            None
        }
        let mut state = vec![0u8; self.nodes.len()];
        (0..self.nodes.len()).find_map(|i| if state[i] == 0 { visit(self, i, &mut state) } else { None })
    }
}

/// Position per id, sonst per Titel.
pub fn find_in(nodes: &[Node], key: &str) -> Option<usize> {
    let key = key.trim();
    nodes.iter().position(|n| n.id == key).or_else(|| find_title(nodes, key))
}

pub fn find_title(nodes: &[Node], title: &str) -> Option<usize> {
    let t = title.trim().to_lowercase();
    if t.is_empty() {
        return None;
    }
    nodes.iter().position(|n| n.title.trim().to_lowercase() == t)
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Node {
    #[serde(deserialize_with = "text")]
    pub id: String,
    #[serde(deserialize_with = "text")]
    pub title: String,
    #[serde(deserialize_with = "text")]
    pub era: String,
    /// Jahr für die Zeitachse (negativ = v. Chr.), nur bei `history`.
    #[serde(deserialize_with = "opt_year", skip_serializing_if = "Option::is_none")]
    pub year: Option<f64>,
    /// Strang (Themenbahn), z. B. „Magnetismus“: Knoten eines Strangs liegen übereinander gruppiert.
    #[serde(deserialize_with = "text")]
    pub strand: String,
    #[serde(deserialize_with = "text")]
    pub summary: String,
    #[serde(deserialize_with = "text")]
    pub body: String,
    #[serde(deserialize_with = "lenient_vec")]
    pub images: Vec<Image>,
    #[serde(deserialize_with = "opt_text", skip_serializing_if = "Option::is_none")]
    pub svg: Option<String>,
    #[serde(deserialize_with = "lenient_vec")]
    pub sources: Vec<Source>,
    /// Optionale kurze Einstiegsfrage vor dem Lesen (Pre-Testing-Effekt).
    #[serde(default, deserialize_with = "opt_question", skip_serializing_if = "Option::is_none")]
    pub pretest: Option<Question>,
    #[serde(deserialize_with = "lenient_quiz")]
    pub quiz: Vec<Question>,
    #[serde(deserialize_with = "opt_text", skip_serializing_if = "Option::is_none")]
    pub worksheet: Option<String>,
    #[serde(deserialize_with = "opt_text", skip_serializing_if = "Option::is_none")]
    pub deck: Option<String>,
    #[serde(deserialize_with = "lenient_vec")]
    pub parents: Vec<String>,
    pub progress: Progress,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Image {
    #[serde(deserialize_with = "text")]
    pub src: String,
    #[serde(deserialize_with = "text")]
    pub caption: String,
    #[serde(deserialize_with = "text")]
    pub credit: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Source {
    /// `page`, `wiki` oder `url`.
    #[serde(deserialize_with = "text")]
    pub kind: String,
    #[serde(rename = "ref", deserialize_with = "text")]
    pub reference: String,
    #[serde(deserialize_with = "text")]
    pub title: String,
}

/// Quizfrage. Als JSON mit Tag `type` (`choice`, `text`, `number`, `cloze`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Question {
    Choice {
        #[serde(default)]
        q: String,
        #[serde(default)]
        options: Vec<String>,
        #[serde(default)]
        correct: Vec<usize>,
        #[serde(default)]
        explain: String,
    },
    /// Freitext: wird von der KI bewertet.
    Text {
        #[serde(default)]
        q: String,
        #[serde(default)]
        solution: String,
        #[serde(default)]
        explain: String,
    },
    Number {
        #[serde(default)]
        q: String,
        answer: f64,
        /// Absolute Toleranz.
        #[serde(default)]
        tol: Option<f64>,
        /// Relative Toleranz (0.01 = 1 %).
        #[serde(default)]
        tol_rel: Option<f64>,
        #[serde(default)]
        unit: String,
        #[serde(default)]
        explain: String,
    },
    /// Lückentext: Lücken `{{Antwort|Alternative}}`.
    Cloze {
        #[serde(default)]
        text: String,
        #[serde(default)]
        explain: String,
    },
}

impl Question {
    /// Liest eine Frage und gleicht Eingabevarianten an: `answer: idx` bei `choice`, Zahlen als Text.
    pub fn from_value(v: &Value) -> Result<Question, String> {
        let Some(obj) = v.as_object() else { return Err("Frage muss ein Objekt sein.".into()) };
        let mut obj = obj.clone();
        let kind = obj.get("type").and_then(Value::as_str).unwrap_or("").trim().to_lowercase();
        if !matches!(kind.as_str(), "choice" | "text" | "number" | "cloze") {
            return Err(format!("Fragetyp „{kind}“ unbekannt (erlaubt: choice, text, number, cloze)."));
        }
        obj.insert("type".into(), Value::String(kind.clone()));
        let idx = |x: &Value| -> Option<Value> {
            let n = match x {
                Value::Number(n) => n.as_f64()?,
                Value::String(s) => parse_number(s)?,
                _ => return None,
            };
            (n >= 0.0 && n.fract() == 0.0).then(|| Value::from(n as u64))
        };
        if kind == "choice" {
            let given = obj.remove("correct").or_else(|| obj.remove("answer"));
            let list: Vec<Value> = match given {
                Some(Value::Array(a)) => a.iter().filter_map(idx).collect(),
                Some(x) => idx(&x).into_iter().collect(),
                None => Vec::new(),
            };
            obj.insert("correct".into(), Value::Array(list));
        }
        if kind == "number" {
            for key in ["answer", "tol", "tol_rel"] {
                if let Some(Value::String(s)) = obj.get(key).cloned() {
                    match parse_number(&s) {
                        Some(n) => obj.insert(key.into(), Value::from(n)),
                        None => obj.remove(key),
                    };
                }
            }
            if !obj.contains_key("answer") {
                return Err("Zahlfrage braucht eine Zahl in „answer“.".into());
            }
        }
        for key in ["q", "explain", "solution", "unit", "text"] {
            if let Some(x) = obj.get(key)
                && !x.is_string()
            {
                obj.insert(key.into(), Value::String(x.as_str().map(str::to_string).unwrap_or_default()));
            }
        }
        serde_json::from_value(Value::Object(obj)).map_err(|e| format!("Frage unlesbar: {e}"))
    }

    /// Prüft eine neu gelieferte Frage auf Vollständigkeit (nur beim Anlegen, nicht beim Lesen).
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Question::Choice { q, options, correct, .. } => {
                if q.trim().is_empty() {
                    return Err("„q“ (Fragetext) fehlt.".into());
                }
                if options.len() < 2 {
                    return Err("Auswahlfrage braucht mindestens 2 „options“.".into());
                }
                if correct.is_empty() || correct.iter().any(|&i| i >= options.len()) {
                    return Err("„correct“ muss gültige Positionen in „options“ nennen (Zählung ab 0).".into());
                }
            }
            Question::Text { q, .. } | Question::Number { q, .. } => {
                if q.trim().is_empty() {
                    return Err("„q“ (Fragetext) fehlt.".into());
                }
            }
            Question::Cloze { text, .. } => {
                if crate::text::cloze_gaps(text).is_empty() {
                    return Err("Lückentext braucht mindestens eine Lücke in {{doppelten Klammern}}.".into());
                }
            }
        }
        Ok(())
    }

    pub fn kind(&self) -> &'static str {
        match self {
            Question::Choice { .. } => "choice",
            Question::Text { .. } => "text",
            Question::Number { .. } => "number",
            Question::Cloze { .. } => "cloze",
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Progress {
    pub quiz: Option<QuizAttempt>,
    pub quiz_passed: bool,
    pub pretest_done: bool,
    pub worksheet: WorksheetProgress,
    pub done: bool,
    #[serde(deserialize_with = "text")]
    pub feedback: String,
    /// FSRS-inspiriertes Erinnerungsmodell für verblassende Meisterschaft.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory: Option<MemoryState>,
    /// Verlauf je Frage im Pool (für Interleaving & Schwachstellen-Radar).
    #[serde(deserialize_with = "lenient_vec", skip_serializing_if = "Vec::is_empty")]
    pub seen_questions: Vec<QuestionHistory>,
}

/// FSRS-inspiriertes Erinnerungsmodell direkt am Knoten.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct MemoryState {
    /// Stabilität in Tagen (Zeit bis Erinnerungsstärke R auf 90 % sinkt).
    pub stability: f64,
    /// Schwierigkeit 1.0 (leicht) bis 10.0 (schwer).
    pub difficulty: f64,
    #[serde(deserialize_with = "text")]
    pub last_review: String,
    #[serde(deserialize_with = "text")]
    pub next_review: String,
    pub reps: u32,
    pub lapses: u32,
    /// Anzahl „sicher, aber falsch“-Ereignisse (Fehlkonzepte für das Schwachstellen-Radar).
    pub misconceptions: u32,
}

/// Verlauf einer einzelnen Frage im Quiz-Pool eines Knotens.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct QuestionHistory {
    pub index: usize,
    pub attempts: u32,
    pub correct_count: u32,
    pub last_correct: bool,
    /// `"sure"`, `"unsure"`, `"guess"` oder leer.
    #[serde(deserialize_with = "text")]
    pub last_confidence: String,
    #[serde(deserialize_with = "text")]
    pub last_at: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct QuizAttempt {
    pub answers: Vec<Value>,
    #[serde(deserialize_with = "lenient_vec")]
    pub results: Vec<QResult>,
    #[serde(deserialize_with = "text")]
    pub at: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct QResult {
    /// `None`: noch nicht bewertet (Freitext wartet auf die KI).
    pub correct: Option<bool>,
    #[serde(deserialize_with = "text")]
    pub feedback: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct WorksheetProgress {
    pub status: WsStatus,
    #[serde(deserialize_with = "text")]
    pub feedback: String,
    #[serde(deserialize_with = "text")]
    pub at: String,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WsStatus {
    Submitted,
    Passed,
    Failed,
    #[default]
    #[serde(other)]
    Open,
}

impl WsStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            WsStatus::Open => "open",
            WsStatus::Submitted => "submitted",
            WsStatus::Passed => "passed",
            WsStatus::Failed => "failed",
        }
    }

    pub fn parse(s: &str) -> Option<WsStatus> {
        Some(match s.trim().to_lowercase().as_str() {
            "open" => WsStatus::Open,
            "submitted" => WsStatus::Submitted,
            "passed" => WsStatus::Passed,
            "failed" => WsStatus::Failed,
            _ => return None,
        })
    }
}
