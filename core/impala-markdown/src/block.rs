//! Blöcke des Editors. JSON-Form wie die JS-Blockobjekte (`{ id, type, … }`), damit Undo-Stände
//! und Zwischenablage zwischen JS und Rust austauschbar sind. Gelesen wird nachsichtig wie im JS
//! (`b.text || ""`, fehlende Felder, Zahlen statt Text); fremde Zusatzfelder fallen weg.

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

/// Ein Block mit stabiler `id` und optionalen Farben (`<!--@c:…;bg:…-->` vor dem Block).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(from = "RawBlock", into = "RawBlock")]
pub struct Block {
    pub id: String,
    pub kind: BlockKind,
    pub text_color: Option<String>,
    pub bg_color: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum BlockKind {
    Paragraph {
        text: String,
    },
    Heading {
        level: HeadingLevel,
        text: String,
    },
    List {
        style: ListStyle,
        indent: u32,
        text: String,
    },
    Quote {
        text: String,
    },
    Divider,
    Image {
        alt: String,
        src: String,
    },
    /// Eingebettetes Heft (`:::heft <id>`)
    Heft {
        heft_id: String,
    },
    /// Datei/Medium (`:::file <src> <Name>`); `src` ist `file:<id>` oder eine URL.
    File {
        src: String,
        name: String,
    },
    Code {
        language: String,
        text: String,
    },
    Math {
        text: String,
    },
    Table {
        rows: Vec<Vec<String>>,
    },
    Callout {
        color: String,
        children: Vec<Block>,
    },
    Toggle {
        summary: String,
        open: bool,
        children: Vec<Block>,
    },
    Columns {
        columns: Vec<Vec<Block>>,
    },
    /// Unbekannter Typ aus fremden Daten: wird wie ein Absatz geschrieben (JS-`default`).
    Other {
        type_name: String,
        text: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HeadingLevel {
    H1,
    H2,
    H3,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ListStyle {
    Bullet,
    Number,
    Todo { checked: bool },
}

impl Block {
    pub fn new(id: String, kind: BlockKind) -> Self {
        Block { id, kind, text_color: None, bg_color: None }
    }

    /// Listenblöcke (JS `LISTY`): aufeinanderfolgende Listen stehen ohne Leerzeile.
    pub fn is_list(&self) -> bool {
        matches!(self.kind, BlockKind::List { .. })
    }

    /// JS-Typname (`"p"`, `"h2"`, `"todo"` …).
    pub fn type_name(&self) -> &str {
        match &self.kind {
            BlockKind::Paragraph { .. } => "p",
            BlockKind::Heading { level: HeadingLevel::H1, .. } => "h1",
            BlockKind::Heading { level: HeadingLevel::H2, .. } => "h2",
            BlockKind::Heading { level: HeadingLevel::H3, .. } => "h3",
            BlockKind::List { style: ListStyle::Bullet, .. } => "bullet",
            BlockKind::List { style: ListStyle::Number, .. } => "number",
            BlockKind::List { style: ListStyle::Todo { .. }, .. } => "todo",
            BlockKind::Quote { .. } => "quote",
            BlockKind::Divider => "divider",
            BlockKind::Image { .. } => "image",
            BlockKind::Heft { .. } => "heft",
            BlockKind::File { .. } => "file",
            BlockKind::Code { .. } => "code",
            BlockKind::Math { .. } => "math",
            BlockKind::Table { .. } => "table",
            BlockKind::Callout { .. } => "callout",
            BlockKind::Toggle { .. } => "toggle",
            BlockKind::Columns { .. } => "columns",
            BlockKind::Other { type_name, .. } => type_name,
        }
    }
}

// ---------- JSON-Form ----------

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawBlock {
    #[serde(default, deserialize_with = "js_string")]
    id: String,
    #[serde(rename = "type", default, deserialize_with = "js_string")]
    kind: String,
    #[serde(default, deserialize_with = "js_bool", skip_serializing_if = "Option::is_none")]
    checked: Option<bool>,
    #[serde(default, deserialize_with = "js_indent", skip_serializing_if = "Option::is_none")]
    indent: Option<u32>,
    #[serde(default, deserialize_with = "opt_js_string", skip_serializing_if = "Option::is_none")]
    language: Option<String>,
    #[serde(default, deserialize_with = "opt_js_string", skip_serializing_if = "Option::is_none")]
    alt: Option<String>,
    #[serde(default, deserialize_with = "opt_js_string", skip_serializing_if = "Option::is_none")]
    src: Option<String>,
    #[serde(default, deserialize_with = "opt_js_string", skip_serializing_if = "Option::is_none")]
    heft_id: Option<String>,
    #[serde(default, deserialize_with = "opt_js_string", skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(default, deserialize_with = "opt_js_string", skip_serializing_if = "Option::is_none")]
    color: Option<String>,
    #[serde(default, deserialize_with = "opt_js_string", skip_serializing_if = "Option::is_none")]
    summary: Option<String>,
    #[serde(default, deserialize_with = "js_bool", skip_serializing_if = "Option::is_none")]
    open: Option<bool>,
    #[serde(default, deserialize_with = "opt_js_string", skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(default, deserialize_with = "js_rows", skip_serializing_if = "Option::is_none")]
    rows: Option<Vec<Vec<String>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    children: Option<Vec<Block>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    columns: Option<Vec<Vec<Block>>>,
    #[serde(default, deserialize_with = "opt_js_string", skip_serializing_if = "Option::is_none")]
    text_color: Option<String>,
    #[serde(default, deserialize_with = "opt_js_string", skip_serializing_if = "Option::is_none")]
    bg_color: Option<String>,
}

impl From<RawBlock> for Block {
    fn from(r: RawBlock) -> Self {
        let text = r.text.unwrap_or_default();
        let list = |style| BlockKind::List { style, indent: r.indent.unwrap_or(0), text: text.clone() };
        let kind = match r.kind.as_str() {
            "p" => BlockKind::Paragraph { text },
            "h1" => BlockKind::Heading { level: HeadingLevel::H1, text },
            "h2" => BlockKind::Heading { level: HeadingLevel::H2, text },
            "h3" => BlockKind::Heading { level: HeadingLevel::H3, text },
            "bullet" => list(ListStyle::Bullet),
            "number" => list(ListStyle::Number),
            "todo" => list(ListStyle::Todo { checked: r.checked.unwrap_or(false) }),
            "quote" => BlockKind::Quote { text },
            "divider" => BlockKind::Divider,
            "image" => BlockKind::Image { alt: r.alt.unwrap_or_default(), src: r.src.unwrap_or_default() },
            "heft" => BlockKind::Heft { heft_id: r.heft_id.unwrap_or_default() },
            "file" => BlockKind::File { src: r.src.unwrap_or_default(), name: r.name.unwrap_or_default() },
            "code" => BlockKind::Code { language: r.language.unwrap_or_default(), text },
            "math" => BlockKind::Math { text },
            "table" => BlockKind::Table { rows: r.rows.unwrap_or_default() },
            "callout" => {
                BlockKind::Callout { color: r.color.unwrap_or_default(), children: r.children.unwrap_or_default() }
            }
            "toggle" => BlockKind::Toggle {
                summary: r.summary.unwrap_or_default(),
                open: r.open.unwrap_or(false),
                children: r.children.unwrap_or_default(),
            },
            "columns" => BlockKind::Columns { columns: r.columns.unwrap_or_default() },
            _ => BlockKind::Other { type_name: r.kind, text },
        };
        Block { id: r.id, kind, text_color: r.text_color, bg_color: r.bg_color }
    }
}

impl From<Block> for RawBlock {
    fn from(b: Block) -> Self {
        let mut r = RawBlock { kind: b.type_name().to_owned(), id: b.id, ..Default::default() };
        r.text_color = b.text_color;
        r.bg_color = b.bg_color;
        match b.kind {
            BlockKind::Paragraph { text }
            | BlockKind::Heading { text, .. }
            | BlockKind::Quote { text }
            | BlockKind::Math { text }
            | BlockKind::Other { text, .. } => r.text = Some(text),
            BlockKind::List { style, indent, text } => {
                if let ListStyle::Todo { checked } = style {
                    r.checked = Some(checked);
                }
                r.indent = Some(indent);
                r.text = Some(text);
            }
            BlockKind::Divider => {}
            BlockKind::Image { alt, src } => (r.alt, r.src) = (Some(alt), Some(src)),
            BlockKind::Heft { heft_id } => r.heft_id = Some(heft_id),
            BlockKind::File { src, name } => (r.src, r.name) = (Some(src), Some(name)),
            BlockKind::Code { language, text } => (r.language, r.text) = (Some(language), Some(text)),
            BlockKind::Table { rows } => r.rows = Some(rows),
            BlockKind::Callout { color, children } => (r.color, r.children) = (Some(color), Some(children)),
            BlockKind::Toggle { summary, open, children } => {
                (r.summary, r.open, r.children) = (Some(summary), Some(open), Some(children))
            }
            BlockKind::Columns { columns } => r.columns = Some(columns),
        }
        r
    }
}

// ---------- nachsichtiges Lesen wie im JS ----------

/// `String(x || "")`: falsche Werte → leer, Zahlen/Wahrheitswerte als Text.
fn value_to_js_string(v: Value) -> String {
    match v {
        Value::String(s) => s,
        Value::Bool(true) => "true".into(),
        Value::Number(n) => match n.as_f64() {
            Some(0.0) => String::new(),
            Some(f) if f.fract() == 0.0 && f.abs() < 1e21 => format!("{f:.0}"),
            _ => n.to_string(),
        },
        // Objekte/Listen kommen in Blöcken nicht vor; JS ergäbe "[object Object]" – hier leer.
        _ => String::new(),
    }
}

fn js_string<'de, D: Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    Ok(value_to_js_string(Value::deserialize(d)?))
}

fn opt_js_string<'de, D: Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::Null => None,
        v => Some(value_to_js_string(v)),
    })
}

fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

fn js_bool<'de, D: Deserializer<'de>>(d: D) -> Result<Option<bool>, D::Error> {
    Ok(Some(truthy(&Value::deserialize(d)?)))
}

/// `"  ".repeat(b.indent || 0)`: Bruchzahlen abgerundet. Abweichung: negative Werte ergeben 0
/// (JS wirft dort einen RangeError und bricht das Speichern ab).
fn js_indent<'de, D: Deserializer<'de>>(d: D) -> Result<Option<u32>, D::Error> {
    let v = Value::deserialize(d)?;
    Ok(Some(match v.as_f64() {
        Some(f) if f.is_finite() && f > 0.0 => f.floor().min(u32::MAX as f64) as u32,
        _ => 0,
    }))
}

fn js_rows<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Vec<Vec<String>>>, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::Array(rows) => Some(
            rows.into_iter()
                .map(|row| match row {
                    Value::Array(cells) => cells.into_iter().map(value_to_js_string).collect(),
                    _ => Vec::new(),
                })
                .collect(),
        ),
        _ => None,
    })
}
