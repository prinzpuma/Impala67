//! Arbeitsblatt-Vorlagen: validiert das Baustein-JSON, bricht auf DIN-A4-Seiten
//! (`1000 × 1414`) um und erzeugt je Seite ein eigenständiges SVG sowie den zugehörigen
//! Klartext (`ocr_text`) für Suche und KI.

use std::fmt::Write as _;

use serde_json::{Value, json};

use crate::doc::{PAGE_H, PAGE_W};

const PAPER_BG: &str = "#fcfbf8";
const INK_DARK: &str = "#18181b";
const INK_MUTED: &str = "#52525b";
const BORDER_COLOR: &str = "#d4d4d8";
const SOFT_BG: &str = "#f4f4f0";
const FONT_SANS: &str = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONT_MONO: &str = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const MARGIN_X: f64 = 64.0;
const CONTENT_W: f64 = PAGE_W - 2.0 * MARGIN_X;
const FOOTER_Y: f64 = PAGE_H - 42.0;
const MAX_Y: f64 = FOOTER_Y - 24.0;
const BLOCK_GAP: f64 = 24.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Palette {
    pub primary: &'static str,
    pub soft: &'static str,
    pub badge_text: &'static str,
}

impl Palette {
    pub fn from_name(name: &str) -> Self {
        match name.trim().to_ascii_lowercase().as_str() {
            "teal" | "green" | "gruen" => Palette { primary: "#0d9488", soft: "#f0fdfa", badge_text: "#115e59" },
            "amber" | "orange" | "yellow" => Palette { primary: "#d97706", soft: "#fffbeb", badge_text: "#92400e" },
            "purple" | "violet" | "lila" => Palette { primary: "#7c3aed", soft: "#f5f3ff", badge_text: "#5b21b6" },
            "rose" | "red" | "rot" => Palette { primary: "#e11d48", soft: "#fff1f2", badge_text: "#9f1239" },
            _ => Palette { primary: "#2563eb", soft: "#eff6ff", badge_text: "#1e40af" },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WritePaper {
    Grid,
    Lined,
    Dots,
    Blank,
}

impl WritePaper {
    fn parse(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "lined" | "liniert" => Self::Lined,
            "dots" | "punkte" => Self::Dots,
            "blank" | "blanko" | "leer" => Self::Blank,
            _ => Self::Grid,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BoxHeight {
    Sm,
    Md,
    Lg,
}

impl BoxHeight {
    fn parse(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "sm" | "s" | "klein" => Self::Sm,
            "lg" | "l" | "gross" | "groß" => Self::Lg,
            _ => Self::Md,
        }
    }

    fn px(self) -> f64 {
        match self {
            Self::Sm => 116.0,
            Self::Md => 204.0,
            Self::Lg => 312.0,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Pair {
    pub left: String,
    pub right: String,
}

#[derive(Debug, Clone)]
pub struct CodeLine {
    pub code: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct MatrixCell {
    pub value: String,
    pub given: bool,
}

#[derive(Debug, Clone)]
pub struct MatrixRow {
    pub label: String,
    pub cells: Vec<MatrixCell>,
}

#[derive(Debug, Clone)]
pub struct ColItem {
    pub name: String,
    pub body: String,
}

#[derive(Debug, Clone)]
pub struct CheckItem {
    pub q: String,
    pub a: Option<String>,
}

#[derive(Debug, Clone)]
pub enum Block {
    Merksatz {
        label: String,
        text: String,
    },
    Rechenbox {
        nr: usize,
        title: String,
        prompt: String,
        points: u32,
        paper: WritePaper,
        height: BoxHeight,
        hint: Option<String>,
        solution: Option<String>,
    },
    Lueckentext {
        nr: usize,
        title: String,
        parts: Vec<ClozePart>,
        blanks: Vec<String>,
        wordbank: Vec<String>,
        points: u32,
    },
    Zuordnung {
        nr: usize,
        title: String,
        pairs: Vec<Pair>,
        shuffled_right: Vec<(char, String)>,
        answers: Vec<(String, char)>,
        points: u32,
    },
    Fehlersuche {
        nr: usize,
        title: String,
        intro: Option<String>,
        lines: Vec<CodeLine>,
        points: u32,
    },
    Matrix {
        nr: usize,
        title: String,
        headers: Vec<String>,
        rows: Vec<MatrixRow>,
        points: u32,
    },
    TwoCol {
        left_title: String,
        left: Vec<ColItem>,
        right_title: String,
        right: Vec<ColItem>,
    },
    Kurzcheck {
        nr: usize,
        title: String,
        items: Vec<CheckItem>,
        points: u32,
    },
}

#[derive(Debug, Clone)]
pub enum ClozePart {
    Text(String),
    Blank(usize),
}

#[derive(Debug, Clone)]
pub struct WorksheetSpec {
    pub title: String,
    pub subject: String,
    pub badge: String,
    pub duration: String,
    pub palette: Palette,
    pub include_solutions: bool,
    pub total_points: u32,
    pub blocks: Vec<Block>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorksheetPage {
    pub svg: String,
    pub ocr_text: String,
    pub is_solution: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorksheetOutput {
    pub title: String,
    pub subject: String,
    pub total_points: u32,
    pub pages: Vec<WorksheetPage>,
}

impl WorksheetOutput {
    pub fn to_json(&self) -> Value {
        let pages: Vec<Value> = self
            .pages
            .iter()
            .map(|p| json!({ "svg": p.svg, "ocrText": p.ocr_text, "isSolution": p.is_solution }))
            .collect();
        json!({
            "title": self.title,
            "subject": self.subject,
            "totalPoints": self.total_points,
            "pages": pages,
        })
    }
}

// ---------------------------------------------------------------------------
// Parsing & Normalisierung

fn str_field(v: &Value, keys: &[&str]) -> String {
    for k in keys {
        if let Some(s) = v.get(*k).and_then(Value::as_str) {
            let t = s.trim();
            if !t.is_empty() {
                return t.to_owned();
            }
        }
    }
    String::new()
}

fn opt_field(v: &Value, keys: &[&str]) -> Option<String> {
    let s = str_field(v, keys);
    (!s.is_empty()).then_some(s)
}

fn points_of(v: &Value, fallback: u32) -> u32 {
    v.get("points")
        .or_else(|| v.get("punkte"))
        .and_then(|p| p.as_u64().or_else(|| p.as_f64().map(|f| f.round().max(0.0) as u64)))
        .map(|p| p.min(100) as u32)
        .unwrap_or(fallback)
}

fn fnv1a(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for &b in bytes {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

fn deterministic_shuffle<T: Clone>(items: &[T], seed_str: &str) -> Vec<T> {
    let mut out = items.to_vec();
    let n = out.len();
    if n <= 1 {
        return out;
    }
    let mut state = fnv1a(seed_str.as_bytes());
    for i in (1..n).rev() {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let j = ((state >> 33) as usize) % (i + 1);
        out.swap(i, j);
    }
    // Falls zwei Elemente existieren und zufällig die Originalreihenfolge bleibt, einmal rotieren.
    if n == 2 && items.len() == 2 && state & 1 == 0 {
        out.swap(0, 1);
    }
    out
}

fn parse_cloze(raw: &str) -> (Vec<ClozePart>, Vec<String>) {
    let mut parts = Vec::new();
    let mut blanks = Vec::new();
    let mut rest = raw;
    while let Some(start) = rest.find("{{") {
        if start > 0 {
            parts.push(ClozePart::Text(rest[..start].to_owned()));
        }
        let after = &rest[start + 2..];
        if let Some(end) = after.find("}}") {
            let word = after[..end].trim();
            if !word.is_empty() {
                blanks.push(word.to_owned());
                parts.push(ClozePart::Blank(blanks.len()));
            }
            rest = &after[end + 2..];
        } else {
            parts.push(ClozePart::Text(rest[start..].to_owned()));
            rest = "";
            break;
        }
    }
    if !rest.is_empty() {
        parts.push(ClozePart::Text(rest.to_owned()));
    }
    (parts, blanks)
}

pub fn parse_worksheet(input: &Value) -> Result<WorksheetSpec, String> {
    let title = str_field(input, &["title", "titel"]);
    if title.is_empty() {
        return Err("create_worksheet: title fehlt.".into());
    }
    let raw_blocks = input
        .get("blocks")
        .or_else(|| input.get("bausteine"))
        .and_then(Value::as_array)
        .ok_or_else(|| "create_worksheet: blocks muss eine nicht-leere Liste sein.".to_owned())?;
    if raw_blocks.is_empty() {
        return Err("create_worksheet: blocks darf nicht leer sein.".into());
    }

    let subject = opt_field(input, &["subject", "fach"]).unwrap_or_else(|| "Lernblatt".into());
    let badge = opt_field(input, &["badge"]).unwrap_or_else(|| "Arbeitsblatt".into());
    let duration = opt_field(input, &["duration", "dauer"]).unwrap_or_else(|| "20 Min".into());
    let palette = Palette::from_name(&str_field(input, &["accent", "color", "farbe"]));
    let include_solutions = input.get("include_solutions").and_then(Value::as_bool).unwrap_or(false);

    let mut blocks = Vec::new();
    let mut task_nr = 0usize;
    let mut total_points = 0u32;

    for (idx, b) in raw_blocks.iter().enumerate() {
        let kind = str_field(b, &["type", "kind", "typ"]).to_ascii_lowercase();
        match kind.as_str() {
            "merksatz" | "info" | "info_box" | "hinweis" => {
                let text = str_field(b, &["text", "content", "body", "inhalt"]);
                if text.is_empty() {
                    return Err(format!("create_worksheet: Baustein {} (merksatz) braucht text.", idx + 1));
                }
                let label = opt_field(b, &["label", "title", "titel"]).unwrap_or_else(|| "Merksatz".into());
                blocks.push(Block::Merksatz { label, text });
            }
            "rechenbox" | "calc" | "aufgabe" | "open" => {
                let prompt = str_field(b, &["prompt", "text", "question", "aufgabe"]);
                if prompt.is_empty() {
                    return Err(format!("create_worksheet: Baustein {} (rechenbox) braucht prompt.", idx + 1));
                }
                task_nr += 1;
                let points = points_of(b, 4);
                total_points += points;
                blocks.push(Block::Rechenbox {
                    nr: task_nr,
                    title: opt_field(b, &["title", "titel"]).unwrap_or_else(|| format!("Aufgabe {task_nr}")),
                    prompt,
                    points,
                    paper: WritePaper::parse(&str_field(b, &["paper", "papier"])),
                    height: BoxHeight::parse(&str_field(b, &["height", "size", "hoehe"])),
                    hint: opt_field(b, &["hint", "tipp", "hinweis"]),
                    solution: opt_field(b, &["solution", "loesung", "answer"]),
                });
            }
            "lueckentext" | "cloze" => {
                let text = str_field(b, &["text", "content", "prompt"]);
                if text.is_empty() {
                    return Err(format!(
                        "create_worksheet: Baustein {} (lueckentext) braucht text mit {{{{Lücken}}}}.",
                        idx + 1
                    ));
                }
                let (parts, blanks) = parse_cloze(&text);
                if blanks.is_empty() {
                    return Err(format!(
                        "create_worksheet: Baustein {} (lueckentext) enthält keine {{{{Lücke}}}}.",
                        idx + 1
                    ));
                }
                task_nr += 1;
                let show_bank = b.get("wordbank").and_then(Value::as_bool).unwrap_or(true);
                let wordbank = if show_bank {
                    deterministic_shuffle(&blanks, &format!("{title}:cloze:{idx}"))
                } else {
                    Vec::new()
                };
                let points = points_of(b, blanks.len() as u32);
                total_points += points;
                blocks.push(Block::Lueckentext {
                    nr: task_nr,
                    title: opt_field(b, &["title", "titel"]).unwrap_or_else(|| "Lückentext".into()),
                    parts,
                    blanks,
                    wordbank,
                    points,
                });
            }
            "zuordnung" | "matching" => {
                let raw_pairs = b
                    .get("pairs")
                    .or_else(|| b.get("paare"))
                    .and_then(Value::as_array)
                    .ok_or_else(|| format!("create_worksheet: Baustein {} (zuordnung) braucht pairs.", idx + 1))?;
                let mut pairs = Vec::new();
                for p in raw_pairs {
                    let left = str_field(p, &["left", "links", "term"]);
                    let right = str_field(p, &["right", "rechts", "desc", "definition"]);
                    if !left.is_empty() && !right.is_empty() {
                        pairs.push(Pair { left, right });
                    }
                }
                if pairs.is_empty() {
                    return Err(format!(
                        "create_worksheet: Baustein {} (zuordnung) hat keine gültigen Paare.",
                        idx + 1
                    ));
                }
                task_nr += 1;
                let right_texts: Vec<String> = pairs.iter().map(|p| p.right.clone()).collect();
                let shuffled_texts = deterministic_shuffle(&right_texts, &format!("{title}:match:{idx}"));
                let mut shuffled_right = Vec::with_capacity(shuffled_texts.len());
                for (i, r) in shuffled_texts.into_iter().enumerate() {
                    let letter = char::from(b'A' + (i as u8 % 26));
                    shuffled_right.push((letter, r));
                }
                let mut answers = Vec::with_capacity(pairs.len());
                for p in &pairs {
                    let letter =
                        shuffled_right.iter().find(|(_, text)| text == &p.right).map(|(ch, _)| *ch).unwrap_or('?');
                    answers.push((p.left.clone(), letter));
                }
                let points = points_of(b, pairs.len() as u32);
                total_points += points;
                blocks.push(Block::Zuordnung {
                    nr: task_nr,
                    title: opt_field(b, &["title", "titel"]).unwrap_or_else(|| "Zuordnung".into()),
                    pairs,
                    shuffled_right,
                    answers,
                    points,
                });
            }
            "fehlersuche" | "find_error" | "error" => {
                let raw_lines =
                    b.get("lines").or_else(|| b.get("zeilen")).and_then(Value::as_array).ok_or_else(|| {
                        format!("create_worksheet: Baustein {} (fehlersuche) braucht lines.", idx + 1)
                    })?;
                let mut lines = Vec::new();
                for l in raw_lines {
                    if let Some(s) = l.as_str() {
                        lines.push(CodeLine { code: s.to_owned(), error: None });
                    } else {
                        let code =
                            l.get("code").or_else(|| l.get("text")).and_then(Value::as_str).unwrap_or("").to_owned();
                        let error = opt_field(l, &["error", "err", "fehler"]);
                        lines.push(CodeLine { code, error });
                    }
                }
                if lines.is_empty() {
                    return Err(format!(
                        "create_worksheet: Baustein {} (fehlersuche) darf keine leeren lines haben.",
                        idx + 1
                    ));
                }
                task_nr += 1;
                let err_count = lines.iter().filter(|l| l.error.is_some()).count().max(1) as u32;
                let points = points_of(b, err_count * 2);
                total_points += points;
                blocks.push(Block::Fehlersuche {
                    nr: task_nr,
                    title: opt_field(b, &["title", "titel"]).unwrap_or_else(|| "Fehler-Suche".into()),
                    intro: opt_field(b, &["intro", "prompt", "text"]),
                    lines,
                    points,
                });
            }
            "matrix" | "table" | "tabelle" => {
                let headers: Vec<String> = b
                    .get("headers")
                    .and_then(Value::as_array)
                    .map(|a| a.iter().filter_map(Value::as_str).map(|s| s.trim().to_owned()).collect())
                    .unwrap_or_default();
                let raw_rows = b
                    .get("rows")
                    .or_else(|| b.get("zeilen"))
                    .and_then(Value::as_array)
                    .ok_or_else(|| format!("create_worksheet: Baustein {} (matrix) braucht rows.", idx + 1))?;
                let mut rows = Vec::new();
                let mut blanks_count = 0u32;
                for r in raw_rows {
                    let label = str_field(r, &["label", "title", "name"]);
                    let raw_cells = r.get("cells").and_then(Value::as_array).cloned().unwrap_or_default();
                    let mut cells = Vec::new();
                    for c in raw_cells {
                        if let Some(s) = c.as_str() {
                            blanks_count += 1;
                            cells.push(MatrixCell { value: s.to_owned(), given: false });
                        } else {
                            let val = str_field(&c, &["value", "val", "text"]);
                            let given = c.get("given").and_then(Value::as_bool).unwrap_or(false);
                            if !given {
                                blanks_count += 1;
                            }
                            cells.push(MatrixCell { value: val, given });
                        }
                    }
                    rows.push(MatrixRow { label, cells });
                }
                if rows.is_empty() {
                    return Err(format!(
                        "create_worksheet: Baustein {} (matrix) braucht mindestens eine Zeile.",
                        idx + 1
                    ));
                }
                task_nr += 1;
                let points = points_of(b, blanks_count.max(2));
                total_points += points;
                blocks.push(Block::Matrix {
                    nr: task_nr,
                    title: opt_field(b, &["title", "titel"]).unwrap_or_else(|| "Vergleichs-Matrix".into()),
                    headers,
                    rows,
                    points,
                });
            }
            "two_col" | "spalten" | "kompakt" => {
                let parse_col = |key: &str| -> Vec<ColItem> {
                    b.get(key)
                        .and_then(Value::as_array)
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|it| {
                                    let name = str_field(it, &["name", "title", "label"]);
                                    let body = str_field(it, &["body", "text", "value"]);
                                    if name.is_empty() && body.is_empty() { None } else { Some(ColItem { name, body }) }
                                })
                                .collect()
                        })
                        .unwrap_or_default()
                };
                let left = parse_col("left");
                let right = parse_col("right");
                if left.is_empty() && right.is_empty() {
                    return Err(format!(
                        "create_worksheet: Baustein {} (two_col) braucht left/right Einträge.",
                        idx + 1
                    ));
                }
                blocks.push(Block::TwoCol {
                    left_title: opt_field(b, &["left_title"]).unwrap_or_else(|| "Kernwissen".into()),
                    left,
                    right_title: opt_field(b, &["right_title"]).unwrap_or_else(|| "Typische Fallen".into()),
                    right,
                });
            }
            "kurzcheck" | "check" | "quiz" => {
                let raw_items = b
                    .get("items")
                    .or_else(|| b.get("fragen"))
                    .and_then(Value::as_array)
                    .ok_or_else(|| format!("create_worksheet: Baustein {} (kurzcheck) braucht items.", idx + 1))?;
                let mut items = Vec::new();
                for it in raw_items {
                    if let Some(s) = it.as_str() {
                        if !s.trim().is_empty() {
                            items.push(CheckItem { q: s.trim().to_owned(), a: None });
                        }
                    } else {
                        let q = str_field(it, &["q", "question", "frage", "text"]);
                        if !q.is_empty() {
                            items.push(CheckItem { q, a: opt_field(it, &["a", "answer", "antwort", "solution"]) });
                        }
                    }
                }
                if items.is_empty() {
                    return Err(format!(
                        "create_worksheet: Baustein {} (kurzcheck) hat keine gültigen items.",
                        idx + 1
                    ));
                }
                task_nr += 1;
                let points = points_of(b, items.len() as u32);
                total_points += points;
                blocks.push(Block::Kurzcheck {
                    nr: task_nr,
                    title: opt_field(b, &["title", "titel"]).unwrap_or_else(|| "Schnell-Check (Wahr / Falsch)".into()),
                    items,
                    points,
                });
            }
            other => {
                return Err(format!(
                    "create_worksheet: unbekannter Baustein-Typ „{other}“ (erlaubt: merksatz, rechenbox, lueckentext, zuordnung, fehlersuche, matrix, two_col, kurzcheck)."
                ));
            }
        }
    }

    Ok(WorksheetSpec { title, subject, badge, duration, palette, include_solutions, total_points, blocks })
}

// ---------------------------------------------------------------------------
// LaTeX-Bereinigung & Textumbruch

fn replace_frac(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(pos) = rest.find("\\frac{") {
        out.push_str(&rest[..pos]);
        let after = &rest[pos + 6..];
        if let Some((num, r1)) = take_braced(after) {
            let r1_trim = r1.trim_start();
            if let Some(after_open) = r1_trim.strip_prefix('{')
                && let Some((den, r2)) = take_braced(after_open)
            {
                let n_clean = replace_frac(&num);
                let d_clean = replace_frac(&den);
                let n_wrap = if n_clean.contains(' ') || n_clean.contains('+') || n_clean.contains('-') {
                    format!("({n_clean})")
                } else {
                    n_clean
                };
                let d_wrap = if d_clean.contains(' ') || d_clean.contains('+') || d_clean.contains('-') {
                    format!("({d_clean})")
                } else {
                    d_clean
                };
                let _ = write!(out, "{n_wrap}/{d_wrap}");
                rest = r2;
                continue;
            }
        }
        out.push_str("\\frac{");
        rest = after;
    }
    out.push_str(rest);
    out
}

fn take_braced(s: &str) -> Option<(String, &str)> {
    let mut depth = 1usize;
    for (idx, ch) in s.char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some((s[..idx].to_owned(), &s[idx + 1..]));
                }
            }
            _ => {}
        }
    }
    None
}

pub fn format_math_text(raw: &str) -> String {
    let mut s = raw.replace("$$", "").replace('$', "");
    s = replace_frac(&s);
    const REPLACEMENTS: [(&str, &str); 41] = [
        ("\\Rightarrow", "⇒"),
        ("\\rightarrow", "→"),
        ("\\leftrightarrow", "↔"),
        ("\\Leftarrow", "⇐"),
        ("\\implies", "⇒"),
        ("\\iff", "⇔"),
        ("\\approx", "≈"),
        ("\\equiv", "≡"),
        ("\\cdot", "·"),
        ("\\times", "×"),
        ("\\leq", "≤"),
        ("\\geq", "≥"),
        ("\\neq", "≠"),
        ("\\le", "≤"),
        ("\\ge", "≥"),
        ("\\pm", "±"),
        ("\\mp", "∓"),
        ("\\infty", "∞"),
        ("\\partial", "∂"),
        ("\\nabla", "∇"),
        ("\\forall", "∀"),
        ("\\exists", "∃"),
        ("\\in", "∈"),
        ("\\notin", "∉"),
        ("\\subset", "⊂"),
        ("\\cup", "∪"),
        ("\\cap", "∩"),
        ("\\to", "→"),
        ("\\int", "∫"),
        ("\\sum", "∑"),
        ("\\prod", "∏"),
        ("\\sqrt", "√"),
        ("\\alpha", "α"),
        ("\\beta", "β"),
        ("\\gamma", "γ"),
        ("\\delta", "δ"),
        ("\\Delta", "Δ"),
        ("\\epsilon", "ε"),
        ("\\lambda", "λ"),
        ("\\Sigma", "Σ"),
        ("\\omega", "ω"),
    ];
    for (k, v) in REPLACEMENTS {
        if s.contains(k) {
            s = s.replace(k, v);
        }
    }
    for (k, v) in [
        ("\\Omega", "Ω"),
        ("\\mu", "μ"),
        ("\\pi", "π"),
        ("\\phi", "φ"),
        ("\\Phi", "Φ"),
        ("\\psi", "ψ"),
        ("\\Psi", "Ψ"),
        ("\\tau", "τ"),
        ("\\sigma", "σ"),
        ("\\rho", "ρ"),
        ("\\theta", "θ"),
        ("\\eta", "η"),
        ("\\,", " "),
        ("\\;", " "),
        ("\\quad", "  "),
        ("\\left", ""),
        ("\\right", ""),
    ] {
        if s.contains(k) {
            s = s.replace(k, v);
        }
    }
    for cmd in ["\\text{", "\\mathrm{", "\\mathbf{"] {
        while let Some(pos) = s.find(cmd) {
            let after = &s[pos + cmd.len()..];
            if let Some((inner, rest)) = take_braced(after) {
                s = format!("{}{}{}", &s[..pos], inner, rest);
            } else {
                break;
            }
        }
    }
    s
}

fn char_width_factor(ch: char, mono: bool) -> f64 {
    if mono {
        return 0.60;
    }
    match ch {
        'i' | 'l' | 'I' | '!' | '.' | ',' | ':' | ';' | '|' | '\'' | ' ' => 0.28,
        'f' | 'j' | 'r' | 't' | '(' | ')' | '[' | ']' | '-' => 0.36,
        'm' | 'w' | 'M' | 'W' | 'Ω' | 'Σ' => 0.80,
        'A'..='Z' | 'Ä' | 'Ö' | 'Ü' => 0.66,
        _ => 0.53,
    }
}

fn est_width(text: &str, font_size: f64, mono: bool) -> f64 {
    let mut w = 0.0;
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if (ch == '^' || ch == '_') && chars.peek().is_some() {
            if chars.peek() == Some(&'{') {
                chars.next();
                let mut depth = 1usize;
                for c in chars.by_ref() {
                    if c == '{' {
                        depth += 1;
                    } else if c == '}' {
                        depth -= 1;
                        if depth == 0 {
                            break;
                        }
                    } else {
                        w += char_width_factor(c, mono) * font_size * 0.74;
                    }
                }
            } else if let Some(c) = chars.next() {
                w += char_width_factor(c, mono) * font_size * 0.74;
            }
            continue;
        }
        w += char_width_factor(ch, mono) * font_size;
    }
    w
}

fn wrap_lines(raw: &str, max_w: f64, font_size: f64, mono: bool) -> Vec<String> {
    let clean = format_math_text(raw);
    let mut lines = Vec::new();
    for para in clean.split('\n') {
        let trimmed = para.trim();
        if trimmed.is_empty() {
            lines.push(String::new());
            continue;
        }
        let mut cur = String::new();
        for word in trimmed.split_whitespace() {
            let probe = if cur.is_empty() { word.to_owned() } else { format!("{cur} {word}") };
            if !cur.is_empty() && est_width(&probe, font_size, mono) > max_w {
                lines.push(cur);
                cur = word.to_owned();
            } else {
                cur = probe;
            }
        }
        if !cur.is_empty() {
            lines.push(cur);
        }
    }
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

fn esc_xml(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            c => out.push(c),
        }
    }
    out
}

#[derive(Debug)]
enum ScriptSpan {
    Normal(String),
    Sup(String),
    Sub(String),
}

fn tokenize_scripts(text: &str) -> Vec<ScriptSpan> {
    let mut spans = Vec::new();
    let mut buf = String::new();
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if (ch == '^' || ch == '_') && chars.peek().is_some_and(|c| !c.is_whitespace()) {
            if !buf.is_empty() {
                spans.push(ScriptSpan::Normal(std::mem::take(&mut buf)));
            }
            let content = if chars.peek() == Some(&'{') {
                chars.next();
                let mut inner = String::new();
                let mut depth = 1usize;
                for c in chars.by_ref() {
                    if c == '{' {
                        depth += 1;
                        inner.push(c);
                    } else if c == '}' {
                        depth -= 1;
                        if depth == 0 {
                            break;
                        }
                        inner.push(c);
                    } else {
                        inner.push(c);
                    }
                }
                inner
            } else {
                chars.next().map(|c| c.to_string()).unwrap_or_default()
            };
            if !content.is_empty() {
                spans.push(if ch == '^' { ScriptSpan::Sup(content) } else { ScriptSpan::Sub(content) });
            }
        } else {
            buf.push(ch);
        }
    }
    if !buf.is_empty() {
        spans.push(ScriptSpan::Normal(buf));
    }
    spans
}

struct TextStyle<'a> {
    size: f64,
    fill: &'a str,
    weight: u16,
    mono: bool,
    italic: bool,
}

fn render_rich_text(svg: &mut String, x: f64, y: f64, st: TextStyle<'_>, text: &str) {
    let TextStyle { size, fill, weight, mono, italic } = st;
    let font = if mono { FONT_MONO } else { FONT_SANS };
    let style_attr = if italic { r##" font-style="italic""## } else { "" };
    let _ = write!(
        svg,
        r##"<text x="{x:.1}" y="{y:.1}" font-family="{font}" font-size="{size:.1}" font-weight="{weight}" fill="{fill}"{style_attr}>"##
    );
    let spans = tokenize_scripts(text);
    let mut shift = 0.0_f64;
    for sp in spans {
        match sp {
            ScriptSpan::Normal(s) => {
                if shift.abs() > 0.01 {
                    let _ = write!(svg, r##"<tspan dy="{:.1}">{}</tspan>"##, -shift, esc_xml(&s));
                    shift = 0.0;
                } else {
                    svg.push_str(&esc_xml(&s));
                }
            }
            ScriptSpan::Sup(s) => {
                let target = -size * 0.34;
                let dy = target - shift;
                let _ = write!(svg, r##"<tspan dy="{dy:.1}" font-size="{:.1}">{}</tspan>"##, size * 0.74, esc_xml(&s));
                shift = target;
            }
            ScriptSpan::Sub(s) => {
                let target = size * 0.24;
                let dy = target - shift;
                let _ = write!(svg, r##"<tspan dy="{dy:.1}" font-size="{:.1}">{}</tspan>"##, size * 0.74, esc_xml(&s));
                shift = target;
            }
        }
    }
    svg.push_str("</text>");
}

// ---------------------------------------------------------------------------
// Messung & SVG-Rendering je Baustein

const BODY_FONT: f64 = 16.5;
const BODY_LH: f64 = 24.0;
const INDENT_X: f64 = MARGIN_X + 36.0;
const INDENT_W: f64 = CONTENT_W - 36.0;

fn measure_cloze_lines(parts: &[ClozePart], max_w: f64) -> Vec<Vec<ClozeToken>> {
    let mut tokens = Vec::new();
    for p in parts {
        match p {
            ClozePart::Text(t) => {
                let clean = format_math_text(t);
                for word in clean.split_whitespace() {
                    tokens.push(ClozeToken::Word(word.to_owned()));
                }
            }
            ClozePart::Blank(nr) => tokens.push(ClozeToken::Blank(*nr)),
        }
    }
    let mut lines: Vec<Vec<ClozeToken>> = Vec::new();
    let mut cur: Vec<ClozeToken> = Vec::new();
    let mut cur_w = 0.0;
    for tok in tokens {
        let tw = match &tok {
            ClozeToken::Word(w) => est_width(w, 16.0, false) + 5.0,
            ClozeToken::Blank(_) => 104.0,
        };
        if !cur.is_empty() && cur_w + tw > max_w {
            lines.push(cur);
            cur = vec![tok];
            cur_w = tw;
        } else {
            cur_w += tw;
            cur.push(tok);
        }
    }
    if !cur.is_empty() {
        lines.push(cur);
    }
    if lines.is_empty() {
        lines.push(Vec::new());
    }
    lines
}

#[derive(Debug, Clone)]
enum ClozeToken {
    Word(String),
    Blank(usize),
}

fn measure_wordbank_rows(words: &[String], max_w: f64) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut cur = Vec::new();
    let mut cur_w = 0.0;
    for w in words {
        let clean = format_math_text(w);
        let pill_w = est_width(&clean, 13.5, false) + 22.0;
        if !cur.is_empty() && cur_w + pill_w > max_w {
            rows.push(cur);
            cur = vec![clean];
            cur_w = pill_w + 8.0;
        } else {
            cur_w += pill_w + 8.0;
            cur.push(clean);
        }
    }
    if !cur.is_empty() {
        rows.push(cur);
    }
    rows
}

fn measure_block(b: &Block) -> f64 {
    match b {
        Block::Merksatz { text, .. } => {
            let lines = wrap_lines(text, CONTENT_W - 44.0, 15.5, false);
            44.0 + (lines.len() as f64) * 22.0 + 16.0
        }
        Block::Rechenbox { prompt, height, hint, .. } => {
            let prompt_lines = wrap_lines(prompt, INDENT_W, BODY_FONT, false);
            let hint_h =
                hint.as_ref().map_or(0.0, |h| 10.0 + (wrap_lines(h, INDENT_W, 13.5, false).len() as f64) * 19.0);
            34.0 + (prompt_lines.len() as f64) * BODY_LH + 10.0 + height.px() + hint_h
        }
        Block::Lueckentext { parts, wordbank, .. } => {
            let bank_h = if wordbank.is_empty() {
                0.0
            } else {
                let rows = measure_wordbank_rows(wordbank, INDENT_W - 84.0);
                (rows.len() as f64) * 30.0 + 10.0
            };
            let lines = measure_cloze_lines(parts, INDENT_W - 36.0);
            34.0 + bank_h + 24.0 + (lines.len() as f64) * 34.0 + 16.0
        }
        Block::Zuordnung { pairs, shuffled_right, .. } => {
            let left_h = (pairs.len() as f64) * 44.0;
            let right_col_w = (INDENT_W - 22.0) * 0.52 - 36.0;
            let right_h: f64 = shuffled_right
                .iter()
                .map(|(_, t)| 18.0 + (wrap_lines(t, right_col_w, 14.0, false).len() as f64) * 19.0 + 8.0)
                .sum();
            34.0 + left_h.max(right_h)
        }
        Block::Fehlersuche { intro, lines, .. } => {
            let intro_h =
                intro.as_ref().map_or(0.0, |i| (wrap_lines(i, INDENT_W, 15.5, false).len() as f64) * 22.0 + 10.0);
            34.0 + intro_h + (lines.len() as f64) * 27.0 + 12.0
        }
        Block::Matrix { rows, headers, .. } => {
            let col_count = headers.len().max(rows.first().map_or(2, |r| r.cells.len() + 1)).max(2);
            let cell_w = (INDENT_W - 20.0) / (col_count as f64) - 18.0;
            let mut body_h = 0.0;
            for r in rows {
                let mut max_lines = wrap_lines(&r.label, cell_w, 14.5, false).len();
                for c in &r.cells {
                    if c.given {
                        max_lines = max_lines.max(wrap_lines(&c.value, cell_w, 14.5, false).len());
                    }
                }
                body_h += (max_lines.max(1) as f64) * 21.0 + 22.0;
            }
            34.0 + 38.0 + body_h + 6.0
        }
        Block::TwoCol { left, right, .. } => {
            let col_w = (CONTENT_W - 20.0) / 2.0 - 32.0;
            let measure_col = |items: &[ColItem]| -> f64 {
                let mut h = 42.0;
                for it in items {
                    if !it.name.is_empty() {
                        h += (wrap_lines(&it.name, col_w, 15.0, false).len() as f64) * 20.0;
                    }
                    if !it.body.is_empty() {
                        h += (wrap_lines(&it.body, col_w, 13.5, true).len() as f64) * 19.0;
                    }
                    h += 12.0;
                }
                h + 8.0
            };
            measure_col(left).max(measure_col(right))
        }
        Block::Kurzcheck { items, .. } => {
            let text_w = INDENT_W - 140.0;
            let mut h = 34.0;
            for it in items {
                let l = wrap_lines(&it.q, text_w, 15.0, false).len();
                h += (l as f64) * 21.0 + 20.0;
            }
            h + 4.0
        }
    }
}

fn render_task_header(svg: &mut String, y: f64, nr: usize, title: &str, points: u32, pal: Palette) {
    let _ =
        write!(svg, r##"<rect x="{MARGIN_X:.1}" y="{:.1}" width="24" height="24" rx="5" fill="{}"/>"##, y, pal.primary);
    let _ = write!(
        svg,
        r##"<text x="{:.1}" y="{:.1}" text-anchor="middle" font-family="{FONT_SANS}" font-size="13.5" font-weight="700" fill="#ffffff">{nr}</text>"##,
        MARGIN_X + 12.0,
        y + 17.0
    );
    render_rich_text(
        svg,
        INDENT_X,
        y + 17.5,
        TextStyle { size: 18.0, fill: INK_DARK, weight: 700, mono: false, italic: false },
        &format_math_text(title),
    );
    if points > 0 {
        let pkt = format!("{points} Pkt");
        let _ = write!(
            svg,
            r##"<text x="{:.1}" y="{:.1}" text-anchor="end" font-family="{FONT_SANS}" font-size="13.5" font-weight="600" fill="{INK_MUTED}">{pkt}</text>"##,
            PAGE_W - MARGIN_X,
            y + 17.0
        );
    }
}

fn render_block_svg(svg: &mut String, y: f64, b: &Block, pal: Palette, uid_prefix: &str) {
    match b {
        Block::Merksatz { label, text } => {
            let h = measure_block(b);
            let _ = write!(
                svg,
                r##"<rect x="{MARGIN_X:.1}" y="{y:.1}" width="{CONTENT_W:.1}" height="{h:.1}" rx="8" fill="{SOFT_BG}"/>"##
            );
            let _ = write!(
                svg,
                r##"<rect x="{MARGIN_X:.1}" y="{y:.1}" width="5" height="{h:.1}" rx="2.5" fill="{}"/>"##,
                pal.primary
            );
            render_rich_text(
                svg,
                MARGIN_X + 22.0,
                y + 24.0,
                TextStyle { size: 12.0, fill: pal.primary, weight: 700, mono: false, italic: false },
                &label.to_uppercase(),
            );
            let mut ty = y + 48.0;
            for line in wrap_lines(text, CONTENT_W - 44.0, 15.5, false) {
                render_rich_text(
                    svg,
                    MARGIN_X + 22.0,
                    ty,
                    TextStyle { size: 15.5, fill: INK_DARK, weight: 400, mono: false, italic: false },
                    &line,
                );
                ty += 22.0;
            }
        }
        Block::Rechenbox { nr, title, prompt, points, paper, height, hint, .. } => {
            render_task_header(svg, y, *nr, title, *points, pal);
            let mut cy = y + 46.0;
            for line in wrap_lines(prompt, INDENT_W, BODY_FONT, false) {
                render_rich_text(
                    svg,
                    INDENT_X,
                    cy,
                    TextStyle { size: BODY_FONT, fill: INK_DARK, weight: 400, mono: false, italic: false },
                    &line,
                );
                cy += BODY_LH;
            }
            let box_y = cy - 10.0;
            let box_h = height.px();
            let fill_attr = match paper {
                WritePaper::Grid => format!("url(#{uid_prefix}-grid)"),
                WritePaper::Lined => format!("url(#{uid_prefix}-lined)"),
                WritePaper::Dots => format!("url(#{uid_prefix}-dots)"),
                WritePaper::Blank => "#ffffff".to_owned(),
            };
            let _ = write!(
                svg,
                r##"<rect x="{INDENT_X:.1}" y="{box_y:.1}" width="{INDENT_W:.1}" height="{box_h:.1}" rx="8" fill="{fill_attr}" stroke="{BORDER_COLOR}" stroke-width="1.2"/>"##
            );
            if let Some(h) = hint {
                let mut hy = box_y + box_h + 20.0;
                for (i, line) in wrap_lines(&format!("Hinweis: {h}"), INDENT_W, 13.5, false).into_iter().enumerate() {
                    let _ = i;
                    render_rich_text(
                        svg,
                        INDENT_X,
                        hy,
                        TextStyle { size: 13.5, fill: INK_MUTED, weight: 400, mono: false, italic: true },
                        &line,
                    );
                    hy += 19.0;
                }
            }
        }
        Block::Lueckentext { nr, title, parts, wordbank, points, .. } => {
            render_task_header(svg, y, *nr, title, *points, pal);
            let mut cy = y + 36.0;
            if !wordbank.is_empty() {
                render_rich_text(
                    svg,
                    INDENT_X,
                    cy + 16.0,
                    TextStyle { size: 13.0, fill: INK_MUTED, weight: 600, mono: false, italic: false },
                    "Wortbank:",
                );
                let rows = measure_wordbank_rows(wordbank, INDENT_W - 84.0);
                for row in rows {
                    let mut wx = INDENT_X + 76.0;
                    for word in row {
                        let pw = est_width(&word, 13.5, false) + 20.0;
                        let _ = write!(
                            svg,
                            r##"<rect x="{wx:.1}" y="{cy:.1}" width="{pw:.1}" height="24" rx="5" fill="{SOFT_BG}" stroke="{BORDER_COLOR}" stroke-width="1"/>"##
                        );
                        render_rich_text(
                            svg,
                            wx + 10.0,
                            cy + 16.5,
                            TextStyle { size: 13.5, fill: INK_DARK, weight: 500, mono: false, italic: false },
                            &word,
                        );
                        wx += pw + 8.0;
                    }
                    cy += 30.0;
                }
                cy += 8.0;
            }
            let lines = measure_cloze_lines(parts, INDENT_W - 36.0);
            let box_h = 20.0 + (lines.len() as f64) * 34.0 + 12.0;
            let _ = write!(
                svg,
                r##"<rect x="{INDENT_X:.1}" y="{cy:.1}" width="{INDENT_W:.1}" height="{box_h:.1}" rx="8" fill="#ffffff" stroke="{BORDER_COLOR}" stroke-width="1.2"/>"##
            );
            let mut ly = cy + 32.0;
            for line in lines {
                let mut lx = INDENT_X + 18.0;
                for tok in line {
                    match tok {
                        ClozeToken::Word(w) => {
                            render_rich_text(
                                svg,
                                lx,
                                ly,
                                TextStyle { size: 16.0, fill: INK_DARK, weight: 400, mono: false, italic: false },
                                &w,
                            );
                            lx += est_width(&w, 16.0, false) + 5.5;
                        }
                        ClozeToken::Blank(bnr) => {
                            let _ = write!(
                                svg,
                                r##"<text x="{:.1}" y="{:.1}" font-family="{FONT_SANS}" font-size="11" font-weight="700" fill="{INK_MUTED}">({bnr})</text>"##,
                                lx + 2.0,
                                ly - 2.0
                            );
                            let _ = write!(
                                svg,
                                r##"<line x1="{:.1}" y1="{:.1}" x2="{:.1}" y2="{:.1}" stroke="{INK_DARK}" stroke-width="1.4"/>"##,
                                lx + 20.0,
                                ly + 2.0,
                                lx + 98.0,
                                ly + 2.0
                            );
                            lx += 104.0;
                        }
                    }
                }
                ly += 34.0;
            }
        }
        Block::Zuordnung { nr, title, pairs, shuffled_right, points, .. } => {
            render_task_header(svg, y, *nr, title, *points, pal);
            let col_gap = 22.0;
            let left_w = (INDENT_W - col_gap) * 0.46;
            let right_x = INDENT_X + left_w + col_gap;
            let right_w = INDENT_W - left_w - col_gap;

            let mut ly = y + 36.0;
            for p in pairs {
                let _ = write!(
                    svg,
                    r##"<rect x="{INDENT_X:.1}" y="{ly:.1}" width="{left_w:.1}" height="36" rx="6" fill="{SOFT_BG}" stroke="{BORDER_COLOR}" stroke-width="1"/>"##
                );
                let label = format_math_text(&p.left);
                render_rich_text(
                    svg,
                    INDENT_X + 12.0,
                    ly + 23.0,
                    TextStyle { size: 14.5, fill: INK_DARK, weight: 600, mono: false, italic: false },
                    &label,
                );
                let bx = INDENT_X + left_w - 38.0;
                let _ = write!(
                    svg,
                    r##"<rect x="{bx:.1}" y="{:.1}" width="28" height="24" rx="4" fill="#ffffff" stroke="{BORDER_COLOR}" stroke-width="1.2"/>"##,
                    ly + 6.0
                );
                ly += 44.0;
            }

            let mut ry = y + 36.0;
            for (letter, text) in shuffled_right {
                let wrapped = wrap_lines(text, right_w - 44.0, 14.0, false);
                let rh = 16.0 + (wrapped.len() as f64) * 19.0;
                let _ = write!(
                    svg,
                    r##"<rect x="{right_x:.1}" y="{ry:.1}" width="{right_w:.1}" height="{rh:.1}" rx="6" fill="#ffffff" stroke="{BORDER_COLOR}" stroke-width="1"/>"##
                );
                let _ = write!(
                    svg,
                    r##"<text x="{:.1}" y="{:.1}" font-family="{FONT_SANS}" font-size="13.5" font-weight="700" fill="{}">{letter}</text>"##,
                    right_x + 12.0,
                    ry + 22.0,
                    pal.primary
                );
                let mut ty = ry + 22.0;
                for wl in wrapped {
                    render_rich_text(
                        svg,
                        right_x + 32.0,
                        ty,
                        TextStyle { size: 14.0, fill: INK_DARK, weight: 400, mono: false, italic: false },
                        &wl,
                    );
                    ty += 19.0;
                }
                ry += rh + 8.0;
            }
        }
        Block::Fehlersuche { nr, title, intro, lines, points } => {
            render_task_header(svg, y, *nr, title, *points, pal);
            let mut cy = y + 40.0;
            if let Some(intro_text) = intro {
                for line in wrap_lines(intro_text, INDENT_W, 15.5, false) {
                    render_rich_text(
                        svg,
                        INDENT_X,
                        cy + 4.0,
                        TextStyle { size: 15.5, fill: INK_DARK, weight: 400, mono: false, italic: false },
                        &line,
                    );
                    cy += 22.0;
                }
                cy += 6.0;
            }
            let box_h = (lines.len() as f64) * 27.0;
            let _ = write!(
                svg,
                r##"<rect x="{INDENT_X:.1}" y="{cy:.1}" width="{INDENT_W:.1}" height="{box_h:.1}" rx="8" fill="#ffffff" stroke="{BORDER_COLOR}" stroke-width="1.2"/>"##
            );
            for (i, l) in lines.iter().enumerate() {
                let row_y = cy + (i as f64) * 27.0;
                if i > 0 {
                    let _ = write!(
                        svg,
                        r##"<line x1="{INDENT_X:.1}" y1="{row_y:.1}" x2="{:.1}" y2="{row_y:.1}" stroke="#e4e4e7" stroke-width="1"/>"##,
                        INDENT_X + INDENT_W
                    );
                }
                let _ = write!(
                    svg,
                    r##"<text x="{:.1}" y="{:.1}" text-anchor="end" font-family="{FONT_MONO}" font-size="13" fill="{INK_MUTED}">{}</text>"##,
                    INDENT_X + 34.0,
                    row_y + 18.5,
                    i + 1
                );
                let _ = write!(
                    svg,
                    r##"<line x1="{:.1}" y1="{row_y:.1}" x2="{:.1}" y2="{:.1}" stroke="#e4e4e7" stroke-width="1"/>"##,
                    INDENT_X + 44.0,
                    INDENT_X + 44.0,
                    row_y + 27.0
                );
                render_rich_text(
                    svg,
                    INDENT_X + 56.0,
                    row_y + 18.5,
                    TextStyle { size: 13.5, fill: INK_DARK, weight: 400, mono: true, italic: false },
                    &l.code,
                );
                let _ = write!(
                    svg,
                    r##"<circle cx="{:.1}" cy="{:.1}" r="5.5" fill="none" stroke="#a1a1aa" stroke-width="1.2"/>"##,
                    INDENT_X + INDENT_W - 18.0,
                    row_y + 13.5
                );
            }
        }
        Block::Matrix { nr, title, headers, rows, points } => {
            render_task_header(svg, y, *nr, title, *points, pal);
            let ty = y + 36.0;
            let col_count = headers.len().max(rows.first().map_or(2, |r| r.cells.len() + 1)).max(2);
            let col_w = INDENT_W / (col_count as f64);
            let total_h = measure_block(b) - 40.0;
            let _ = write!(
                svg,
                r##"<rect x="{INDENT_X:.1}" y="{ty:.1}" width="{INDENT_W:.1}" height="38" rx="6" fill="{SOFT_BG}"/>"##
            );
            let _ = write!(
                svg,
                r##"<rect x="{INDENT_X:.1}" y="{ty:.1}" width="{INDENT_W:.1}" height="{total_h:.1}" rx="8" fill="none" stroke="{BORDER_COLOR}" stroke-width="1.2"/>"##
            );
            for (ci, h) in headers.iter().take(col_count).enumerate() {
                let cx = INDENT_X + (ci as f64) * col_w;
                render_rich_text(
                    svg,
                    cx + 12.0,
                    ty + 24.0,
                    TextStyle { size: 14.5, fill: INK_DARK, weight: 700, mono: false, italic: false },
                    &format_math_text(h),
                );
            }
            for ci in 1..col_count {
                let lx = INDENT_X + (ci as f64) * col_w;
                let _ = write!(
                    svg,
                    r##"<line x1="{lx:.1}" y1="{ty:.1}" x2="{lx:.1}" y2="{:.1}" stroke="{BORDER_COLOR}" stroke-width="1"/>"##,
                    ty + total_h
                );
            }
            let mut ry = ty + 38.0;
            for r in rows {
                let _ = write!(
                    svg,
                    r##"<line x1="{INDENT_X:.1}" y1="{ry:.1}" x2="{:.1}" y2="{ry:.1}" stroke="{BORDER_COLOR}" stroke-width="1"/>"##,
                    INDENT_X + INDENT_W
                );
                let label_lines = wrap_lines(&r.label, col_w - 22.0, 14.5, false);
                let mut max_lines = label_lines.len();
                let mut cell_wrapped = Vec::new();
                for c in &r.cells {
                    if c.given {
                        let w = wrap_lines(&c.value, col_w - 22.0, 14.5, false);
                        max_lines = max_lines.max(w.len());
                        cell_wrapped.push(Some(w));
                    } else {
                        cell_wrapped.push(None);
                    }
                }
                let rh = (max_lines.max(1) as f64) * 21.0 + 22.0;
                for (li, line) in label_lines.into_iter().enumerate() {
                    render_rich_text(
                        svg,
                        INDENT_X + 12.0,
                        ry + 24.0 + (li as f64) * 21.0,
                        TextStyle { size: 14.5, fill: INK_DARK, weight: 600, mono: false, italic: false },
                        &line,
                    );
                }
                for (ci, maybe_lines) in cell_wrapped.into_iter().enumerate() {
                    let cx = INDENT_X + ((ci + 1) as f64) * col_w;
                    if let Some(wlines) = maybe_lines {
                        let _ = write!(
                            svg,
                            r##"<rect x="{:.1}" y="{:.1}" width="{:.1}" height="{:.1}" fill="{SOFT_BG}" fill-opacity="0.7"/>"##,
                            cx + 1.0,
                            ry + 1.0,
                            col_w - 2.0,
                            rh - 2.0
                        );
                        for (li, line) in wlines.into_iter().enumerate() {
                            render_rich_text(
                                svg,
                                cx + 12.0,
                                ry + 24.0 + (li as f64) * 21.0,
                                TextStyle { size: 14.5, fill: INK_DARK, weight: 400, mono: false, italic: false },
                                &line,
                            );
                        }
                    } else {
                        let line_y = ry + rh - 14.0;
                        let _ = write!(
                            svg,
                            r##"<line x1="{:.1}" y1="{line_y:.1}" x2="{:.1}" y2="{line_y:.1}" stroke="#a1a1aa" stroke-width="1" stroke-dasharray="3 4"/>"##,
                            cx + 12.0,
                            cx + col_w - 12.0
                        );
                    }
                }
                ry += rh;
            }
        }
        Block::TwoCol { left_title, left, right_title, right } => {
            let h = measure_block(b);
            let col_w = (CONTENT_W - 20.0) / 2.0;
            let draw_col = |svg: &mut String, x: f64, title: &str, items: &[ColItem], bg: &str| {
                let _ = write!(
                    svg,
                    r##"<rect x="{x:.1}" y="{y:.1}" width="{col_w:.1}" height="{h:.1}" rx="8" fill="{bg}" stroke="{BORDER_COLOR}" stroke-width="1.2"/>"##
                );
                render_rich_text(
                    svg,
                    x + 16.0,
                    y + 26.0,
                    TextStyle { size: 12.0, fill: pal.primary, weight: 700, mono: false, italic: false },
                    &title.to_uppercase(),
                );
                let mut iy = y + 48.0;
                for it in items {
                    if !it.name.is_empty() {
                        for line in wrap_lines(&it.name, col_w - 32.0, 15.0, false) {
                            render_rich_text(
                                svg,
                                x + 16.0,
                                iy,
                                TextStyle { size: 15.0, fill: INK_DARK, weight: 700, mono: false, italic: false },
                                &line,
                            );
                            iy += 20.0;
                        }
                    }
                    if !it.body.is_empty() {
                        for line in wrap_lines(&it.body, col_w - 32.0, 13.5, true) {
                            render_rich_text(
                                svg,
                                x + 16.0,
                                iy,
                                TextStyle { size: 13.5, fill: INK_MUTED, weight: 400, mono: true, italic: false },
                                &line,
                            );
                            iy += 19.0;
                        }
                    }
                    iy += 12.0;
                }
            };
            draw_col(svg, MARGIN_X, left_title, left, SOFT_BG);
            draw_col(svg, MARGIN_X + col_w + 20.0, right_title, right, "#ffffff");
        }
        Block::Kurzcheck { nr, title, items, points } => {
            render_task_header(svg, y, *nr, title, *points, pal);
            let cy = y + 36.0;
            let box_h = measure_block(b) - 38.0;
            let _ = write!(
                svg,
                r##"<rect x="{INDENT_X:.1}" y="{cy:.1}" width="{INDENT_W:.1}" height="{box_h:.1}" rx="8" fill="#ffffff" stroke="{BORDER_COLOR}" stroke-width="1.2"/>"##
            );
            let text_w = INDENT_W - 140.0;
            let mut iy = cy;
            for (idx, it) in items.iter().enumerate() {
                if idx > 0 {
                    let _ = write!(
                        svg,
                        r##"<line x1="{INDENT_X:.1}" y1="{iy:.1}" x2="{:.1}" y2="{iy:.1}" stroke="#e4e4e7" stroke-width="1"/>"##,
                        INDENT_X + INDENT_W
                    );
                }
                let lines = wrap_lines(&it.q, text_w, 15.0, false);
                let row_h = (lines.len() as f64) * 21.0 + 20.0;
                for (li, line) in lines.into_iter().enumerate() {
                    render_rich_text(
                        svg,
                        INDENT_X + 16.0,
                        iy + 24.0 + (li as f64) * 21.0,
                        TextStyle { size: 15.0, fill: INK_DARK, weight: 400, mono: false, italic: false },
                        &line,
                    );
                }
                let rx = INDENT_X + INDENT_W - 108.0;
                let mid_y = iy + row_h / 2.0 - 7.0;
                let _ = write!(
                    svg,
                    r##"<rect x="{rx:.1}" y="{mid_y:.1}" width="15" height="15" rx="3" fill="none" stroke="#71717a" stroke-width="1.3"/><text x="{:.1}" y="{:.1}" font-family="{FONT_SANS}" font-size="13" font-weight="600" fill="{INK_MUTED}">W</text>"##,
                    rx + 21.0,
                    mid_y + 12.0
                );
                let _ = write!(
                    svg,
                    r##"<rect x="{:.1}" y="{mid_y:.1}" width="15" height="15" rx="3" fill="none" stroke="#71717a" stroke-width="1.3"/><text x="{:.1}" y="{:.1}" font-family="{FONT_SANS}" font-size="13" font-weight="600" fill="{INK_MUTED}">F</text>"##,
                    rx + 50.0,
                    rx + 71.0,
                    mid_y + 12.0
                );
                iy += row_h;
            }
        }
    }
}

fn push_block_ocr(ocr: &mut String, b: &Block) {
    match b {
        Block::Merksatz { label, text } => {
            let _ = writeln!(ocr, "{label}: {}", format_math_text(text));
        }
        Block::Rechenbox { nr, title, prompt, hint, .. } => {
            let _ = writeln!(ocr, "Aufgabe {nr}: {title}\n{}", format_math_text(prompt));
            if let Some(h) = hint {
                let _ = writeln!(ocr, "Hinweis: {}", format_math_text(h));
            }
        }
        Block::Lueckentext { nr, title, parts, wordbank, .. } => {
            let _ = writeln!(ocr, "Aufgabe {nr}: {title}");
            if !wordbank.is_empty() {
                let _ = writeln!(ocr, "Wortbank: {}", wordbank.join(", "));
            }
            for p in parts {
                match p {
                    ClozePart::Text(t) => ocr.push_str(&format_math_text(t)),
                    ClozePart::Blank(n) => {
                        let _ = write!(ocr, " ({n}) ____ ");
                    }
                }
            }
            ocr.push('\n');
        }
        Block::Zuordnung { nr, title, pairs, shuffled_right, .. } => {
            let _ = writeln!(ocr, "Aufgabe {nr}: {title}");
            for p in pairs {
                let _ = writeln!(ocr, "- {}", format_math_text(&p.left));
            }
            for (l, r) in shuffled_right {
                let _ = writeln!(ocr, "{l}: {}", format_math_text(r));
            }
        }
        Block::Fehlersuche { nr, title, intro, lines, .. } => {
            let _ = writeln!(ocr, "Aufgabe {nr}: {title}");
            if let Some(i) = intro {
                let _ = writeln!(ocr, "{}", format_math_text(i));
            }
            for (i, l) in lines.iter().enumerate() {
                let _ = writeln!(ocr, "{}: {}", i + 1, l.code);
            }
        }
        Block::Matrix { nr, title, headers, rows, .. } => {
            let _ = writeln!(ocr, "Aufgabe {nr}: {title}");
            if !headers.is_empty() {
                let _ = writeln!(ocr, "{}", headers.join(" | "));
            }
            for r in rows {
                let _ = writeln!(ocr, "{}", r.label);
            }
        }
        Block::TwoCol { left_title, left, right_title, right } => {
            let _ = writeln!(ocr, "{left_title}:");
            for it in left {
                let _ = writeln!(ocr, "{} — {}", format_math_text(&it.name), format_math_text(&it.body));
            }
            let _ = writeln!(ocr, "{right_title}:");
            for it in right {
                let _ = writeln!(ocr, "{} — {}", format_math_text(&it.name), format_math_text(&it.body));
            }
        }
        Block::Kurzcheck { nr, title, items, .. } => {
            let _ = writeln!(ocr, "Aufgabe {nr}: {title}");
            for it in items {
                let _ = writeln!(ocr, "- {}", format_math_text(&it.q));
            }
        }
    }
}

fn solution_entries(blocks: &[Block]) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for b in blocks {
        match b {
            Block::Rechenbox { nr, title, solution: Some(sol), .. } => {
                out.push((format!("Aufgabe {nr} · {title}"), format_math_text(sol)));
            }
            Block::Lueckentext { nr, title, blanks, .. } => {
                let line = blanks
                    .iter()
                    .enumerate()
                    .map(|(i, w)| format!("({}) {}", i + 1, format_math_text(w)))
                    .collect::<Vec<_>>()
                    .join("  ·  ");
                out.push((format!("Aufgabe {nr} · {title}"), line));
            }
            Block::Zuordnung { nr, title, answers, .. } => {
                let line = answers
                    .iter()
                    .map(|(l, ch)| format!("{} → {ch}", format_math_text(l)))
                    .collect::<Vec<_>>()
                    .join("  ·  ");
                out.push((format!("Aufgabe {nr} · {title}"), line));
            }
            Block::Fehlersuche { nr, title, lines, .. } => {
                let errs: Vec<String> = lines
                    .iter()
                    .enumerate()
                    .filter_map(|(i, l)| l.error.as_ref().map(|e| format!("Zeile {}: {}", i + 1, format_math_text(e))))
                    .collect();
                if !errs.is_empty() {
                    out.push((format!("Aufgabe {nr} · {title}"), errs.join("\n")));
                }
            }
            Block::Matrix { nr, title, rows, .. } => {
                let lines: Vec<String> = rows
                    .iter()
                    .filter_map(|r| {
                        let missing: Vec<String> = r
                            .cells
                            .iter()
                            .filter(|c| !c.given && !c.value.is_empty())
                            .map(|c| format_math_text(&c.value))
                            .collect();
                        (!missing.is_empty())
                            .then(|| format!("{}: {}", format_math_text(&r.label), missing.join(" | ")))
                    })
                    .collect();
                if !lines.is_empty() {
                    out.push((format!("Aufgabe {nr} · {title}"), lines.join("\n")));
                }
            }
            Block::Kurzcheck { nr, title, items, .. } => {
                let ans: Vec<String> = items
                    .iter()
                    .enumerate()
                    .filter_map(|(i, it)| it.a.as_ref().map(|a| format!("{}. {}", i + 1, format_math_text(a))))
                    .collect();
                if !ans.is_empty() {
                    out.push((format!("Aufgabe {nr} · {title}"), ans.join("\n")));
                }
            }
            _ => {}
        }
    }
    out
}

fn svg_open(uid_prefix: &str) -> String {
    let mut svg = String::with_capacity(4096);
    let _ = write!(
        svg,
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {PAGE_W:.0} {PAGE_H:.0}" width="{PAGE_W:.0}" height="{PAGE_H:.0}">"##
    );
    let _ = write!(
        svg,
        r##"<defs>
<pattern id="{uid_prefix}-grid" width="22" height="22" patternUnits="userSpaceOnUse"><rect width="22" height="22" fill="#ffffff"/><path d="M 22 0 L 0 0 0 22" fill="none" stroke="#cbd5e1" stroke-width="0.9"/></pattern>
<pattern id="{uid_prefix}-lined" width="100" height="30" patternUnits="userSpaceOnUse"><rect width="100" height="30" fill="#ffffff"/><line x1="0" y1="29" x2="100" y2="29" stroke="#cbd5e1" stroke-width="1"/></pattern>
<pattern id="{uid_prefix}-dots" width="20" height="20" patternUnits="userSpaceOnUse"><rect width="20" height="20" fill="#ffffff"/><circle cx="10" cy="10" r="1.2" fill="#94a3b8"/></pattern>
</defs>
<rect width="{PAGE_W:.0}" height="{PAGE_H:.0}" fill="{PAPER_BG}"/>"##
    );
    svg
}

fn render_first_header(svg: &mut String, spec: &WorksheetSpec) -> f64 {
    let pal = spec.palette;
    let subject_up = format_math_text(&spec.subject).to_uppercase();
    render_rich_text(
        svg,
        MARGIN_X,
        74.0,
        TextStyle { size: 12.5, fill: pal.primary, weight: 700, mono: false, italic: false },
        &subject_up,
    );
    let subj_w = est_width(&subject_up, 12.5, false);
    let badge_x = MARGIN_X + subj_w + 18.0;
    let badge_w = est_width(&spec.badge, 12.0, false) + 20.0;
    let _ = write!(
        svg,
        r##"<rect x="{badge_x:.1}" y="57" width="{badge_w:.1}" height="22" rx="5" fill="{SOFT_BG}" stroke="{BORDER_COLOR}" stroke-width="1"/>"##
    );
    render_rich_text(
        svg,
        badge_x + 10.0,
        72.5,
        TextStyle { size: 12.0, fill: INK_DARK, weight: 600, mono: false, italic: false },
        &spec.badge,
    );

    let title_lines = wrap_lines(&spec.title, CONTENT_W - 180.0, 26.0, false);
    let mut ty = 108.0;
    for line in &title_lines {
        render_rich_text(
            svg,
            MARGIN_X,
            ty,
            TextStyle { size: 26.0, fill: INK_DARK, weight: 700, mono: false, italic: false },
            line,
        );
        ty += 32.0;
    }

    let right_x = PAGE_W - MARGIN_X;
    let dur = format!("Richtzeit: {}", spec.duration);
    render_rich_text(
        svg,
        right_x - est_width(&dur, 12.5, false),
        72.0,
        TextStyle { size: 12.5, fill: INK_MUTED, weight: 500, mono: false, italic: false },
        &dur,
    );
    if spec.total_points > 0 {
        let score_label = format!("____ / {} Pkt", spec.total_points);
        let box_w = est_width(&score_label, 14.0, false) + 24.0;
        let bx = right_x - box_w;
        let _ = write!(
            svg,
            r##"<rect x="{bx:.1}" y="82" width="{box_w:.1}" height="32" rx="6" fill="{SOFT_BG}" stroke="{BORDER_COLOR}" stroke-width="1"/>"##
        );
        render_rich_text(
            svg,
            bx + 12.0,
            103.0,
            TextStyle { size: 14.0, fill: INK_DARK, weight: 600, mono: false, italic: false },
            &score_label,
        );
    }

    let rule_y = ty.max(126.0) + 6.0;
    let _ = write!(
        svg,
        r##"<line x1="{MARGIN_X:.1}" y1="{rule_y:.1}" x2="{right_x:.1}" y2="{rule_y:.1}" stroke="{}" stroke-width="2.5"/>"##,
        pal.primary
    );
    rule_y + 24.0
}

fn render_continuation_header(svg: &mut String, spec: &WorksheetSpec, label: &str) -> f64 {
    let pal = spec.palette;
    render_rich_text(
        svg,
        MARGIN_X,
        66.0,
        TextStyle { size: 13.0, fill: INK_MUTED, weight: 600, mono: false, italic: false },
        &format!("{} · {label}", spec.title),
    );
    let _ = write!(
        svg,
        r##"<line x1="{MARGIN_X:.1}" y1="78" x2="{:.1}" y2="78" stroke="{}" stroke-width="1.5"/>"##,
        PAGE_W - MARGIN_X,
        pal.primary
    );
    104.0
}

fn close_svg_with_footer(svg: &mut String, spec: &WorksheetSpec, page_no: usize, total_pages: usize) {
    let _ = write!(
        svg,
        r##"<line x1="{MARGIN_X:.1}" y1="{:.1}" x2="{:.1}" y2="{:.1}" stroke="#e4e4e7" stroke-width="1"/>"##,
        FOOTER_Y - 18.0,
        PAGE_W - MARGIN_X,
        FOOTER_Y - 18.0
    );
    let left = format!("Impala67 · {}", spec.subject);
    let right = format!("Seite {page_no} / {total_pages}");
    render_rich_text(
        svg,
        MARGIN_X,
        FOOTER_Y,
        TextStyle { size: 12.0, fill: INK_MUTED, weight: 400, mono: false, italic: false },
        &left,
    );
    render_rich_text(
        svg,
        PAGE_W - MARGIN_X - est_width(&right, 12.0, false),
        FOOTER_Y,
        TextStyle { size: 12.0, fill: INK_MUTED, weight: 400, mono: false, italic: false },
        &right,
    );
    svg.push_str("</svg>");
}

pub fn render_worksheet(input: &Value) -> Result<WorksheetOutput, String> {
    let spec = parse_worksheet(input)?;

    // 1) Aufgabenblöcke auf Seiten verteilen.
    struct PageDraft {
        svg: String,
        ocr: String,
        is_solution: bool,
    }
    let mut drafts: Vec<PageDraft> = Vec::new();
    let mut cur_svg = svg_open("p1");
    let mut cur_ocr = format!("{}\n{}\n", spec.subject, spec.title);
    let mut y = render_first_header(&mut cur_svg, &spec);
    let mut first_on_page = true;

    for block in &spec.blocks {
        let bh = measure_block(block);
        if !first_on_page && y + bh > MAX_Y {
            drafts.push(PageDraft { svg: cur_svg, ocr: cur_ocr, is_solution: false });
            let p_idx = drafts.len() + 1;
            cur_svg = svg_open(&format!("p{p_idx}"));
            cur_ocr = format!("{} (Seite {p_idx})\n", spec.title);
            y = render_continuation_header(&mut cur_svg, &spec, "Fortsetzung");
        }
        render_block_svg(&mut cur_svg, y, block, spec.palette, &format!("p{}", drafts.len() + 1));
        push_block_ocr(&mut cur_ocr, block);
        y += bh + BLOCK_GAP;
        first_on_page = false;
    }
    drafts.push(PageDraft { svg: cur_svg, ocr: cur_ocr, is_solution: false });

    // 2) Optionale Lösungsseite(n) hinten anhängen.
    if spec.include_solutions {
        let sols = solution_entries(&spec.blocks);
        if !sols.is_empty() {
            let p_idx = drafts.len() + 1;
            let mut sol_svg = svg_open(&format!("p{p_idx}"));
            let mut sol_ocr = format!("Lösungsblatt · {}\n", spec.title);
            let mut sy = render_continuation_header(&mut sol_svg, &spec, "Lösungsblatt");
            let mut first_sol = true;

            for (head, body) in sols {
                let lines = wrap_lines(&body, CONTENT_W - 36.0, 14.5, false);
                let card_h = 36.0 + (lines.len() as f64) * 21.0 + 14.0;
                if !first_sol && sy + card_h > MAX_Y {
                    drafts.push(PageDraft { svg: sol_svg, ocr: sol_ocr, is_solution: true });
                    let np = drafts.len() + 1;
                    sol_svg = svg_open(&format!("p{np}"));
                    sol_ocr = format!("Lösungsblatt · {} (Forts.)\n", spec.title);
                    sy = render_continuation_header(&mut sol_svg, &spec, "Lösungsblatt");
                }
                let _ = write!(
                    sol_svg,
                    r##"<rect x="{MARGIN_X:.1}" y="{sy:.1}" width="{CONTENT_W:.1}" height="{card_h:.1}" rx="8" fill="{SOFT_BG}" stroke="{BORDER_COLOR}" stroke-width="1"/>"##
                );
                render_rich_text(
                    &mut sol_svg,
                    MARGIN_X + 18.0,
                    sy + 24.0,
                    TextStyle { size: 15.0, fill: spec.palette.primary, weight: 700, mono: false, italic: false },
                    &head,
                );
                let mut ly = sy + 46.0;
                for line in lines {
                    render_rich_text(
                        &mut sol_svg,
                        MARGIN_X + 18.0,
                        ly,
                        TextStyle { size: 14.5, fill: INK_DARK, weight: 400, mono: false, italic: false },
                        &line,
                    );
                    ly += 21.0;
                }
                let _ = writeln!(sol_ocr, "{head}: {body}");
                sy += card_h + 14.0;
                first_sol = false;
            }
            drafts.push(PageDraft { svg: sol_svg, ocr: sol_ocr, is_solution: true });
        }
    }

    let total_pages = drafts.len();
    let pages = drafts
        .into_iter()
        .enumerate()
        .map(|(i, mut d)| {
            close_svg_with_footer(&mut d.svg, &spec, i + 1, total_pages);
            WorksheetPage { svg: d.svg, ocr_text: d.ocr.trim().to_owned(), is_solution: d.is_solution }
        })
        .collect();

    Ok(WorksheetOutput { title: spec.title, subject: spec.subject, total_points: spec.total_points, pages })
}

// ---------------------------------------------------------------------------
// Tests

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parst_lueckentext_und_mathe() {
        let out = render_worksheet(&json!({
            "title": "DGL & Bänder",
            "subject": "Mathe",
            "include_solutions": true,
            "blocks": [
                { "type": "merksatz", "text": "Es gilt $\\frac{dy}{g(y)} = f(x)\\,dx$ mit $\\alpha \\le \\beta$." },
                { "type": "lueckentext", "text": "Das {{Valenzband}} liegt unter der {{Bandlücke}}." },
                { "type": "rechenbox", "prompt": "Löse $y' = 2x$", "solution": "$y = x^2 + C$" }
            ]
        }))
        .unwrap();

        assert_eq!(out.pages.len(), 2);
        assert!(!out.pages[0].is_solution);
        assert!(out.pages[1].is_solution);
        assert!(out.pages[0].svg.contains("<svg "));
        assert!(out.pages[0].svg.contains("dy/g(y)"));
        assert!(out.pages[0].svg.contains("α ≤ β"));
        assert!(out.pages[0].svg.contains("Wortbank:"));
        assert!(out.pages[1].ocr_text.contains("Valenzband"));
        assert!(out.pages[1].ocr_text.contains("x^2 + C"));
    }

    #[test]
    fn bricht_viele_bloecke_auf_mehrere_seiten_um() {
        let blocks: Vec<Value> = (1..=6)
            .map(|i| json!({ "type": "rechenbox", "title": format!("Aufgabe {i}"), "prompt": "Rechne.", "height": "lg" }))
            .collect();
        let out = render_worksheet(&json!({ "title": "Lang", "blocks": blocks })).unwrap();
        assert!(out.pages.len() >= 2, "erwartet Seitenumbruch, bekam {} Seite(n)", out.pages.len());
        assert!(out.pages[0].svg.contains(&format!("Seite 1 / {}", out.pages.len())));
    }

    #[test]
    fn lehnt_ungueltige_eingaben_ab() {
        assert!(render_worksheet(&json!({ "title": "", "blocks": [] })).is_err());
        assert!(render_worksheet(&json!({ "title": "X", "blocks": [{ "type": "unbekannt" }] })).is_err());
        assert!(
            render_worksheet(&json!({ "title": "X", "blocks": [{ "type": "lueckentext", "text": "Ohne Lücke" }] }))
                .is_err()
        );
    }
}
