//! Markdown-Blöcke des Editors für native Apps (Kotlin, Swift): Die Typen spiegeln
//! `impala_markdown::Block` ohne Serde. Parsen und Schreiben laufen im Kern, damit die Plattform
//! Seiteninhalte als Blöcke anzeigen und bearbeiten kann, ohne Markdown selbst zu kennen.

use impala_markdown::{Block, BlockKind, HeadingLevel, ListStyle};

/// Ein Block mit stabiler `id` und optionalen Farben.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct MdBlock {
    pub id: String,
    pub kind: MdBlockKind,
    pub text_color: Option<String>,
    pub bg_color: Option<String>,
}

/// Blocktyp samt Inhalt; Kind-Blöcke (Callout, Toggle, Spalten) sind verschachtelt.
#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum MdBlockKind {
    Paragraph {
        text: String,
    },
    Heading {
        level: MdHeadingLevel,
        text: String,
    },
    ListItem {
        style: MdListStyle,
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
    /// Eingebettetes Heft (`:::heft <id>`).
    Heft {
        heft_id: String,
    },
    /// Datei/Medium; `src` ist `file:<id>` oder eine URL.
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
        children: Vec<MdBlock>,
    },
    Toggle {
        summary: String,
        open: bool,
        children: Vec<MdBlock>,
    },
    Columns {
        columns: Vec<Vec<MdBlock>>,
    },
    /// Unbekannter Typ aus fremden Daten: wird wie ein Absatz geschrieben.
    Other {
        type_name: String,
        text: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum MdHeadingLevel {
    H1,
    H2,
    H3,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum MdListStyle {
    Bullet,
    Number,
    Todo { checked: bool },
}

impl From<HeadingLevel> for MdHeadingLevel {
    fn from(l: HeadingLevel) -> Self {
        match l {
            HeadingLevel::H1 => MdHeadingLevel::H1,
            HeadingLevel::H2 => MdHeadingLevel::H2,
            HeadingLevel::H3 => MdHeadingLevel::H3,
        }
    }
}

impl From<MdHeadingLevel> for HeadingLevel {
    fn from(l: MdHeadingLevel) -> Self {
        match l {
            MdHeadingLevel::H1 => HeadingLevel::H1,
            MdHeadingLevel::H2 => HeadingLevel::H2,
            MdHeadingLevel::H3 => HeadingLevel::H3,
        }
    }
}

impl From<ListStyle> for MdListStyle {
    fn from(s: ListStyle) -> Self {
        match s {
            ListStyle::Bullet => MdListStyle::Bullet,
            ListStyle::Number => MdListStyle::Number,
            ListStyle::Todo { checked } => MdListStyle::Todo { checked },
        }
    }
}

impl From<MdListStyle> for ListStyle {
    fn from(s: MdListStyle) -> Self {
        match s {
            MdListStyle::Bullet => ListStyle::Bullet,
            MdListStyle::Number => ListStyle::Number,
            MdListStyle::Todo { checked } => ListStyle::Todo { checked },
        }
    }
}

fn md_blocks(blocks: Vec<Block>) -> Vec<MdBlock> {
    blocks.into_iter().map(MdBlock::from).collect()
}

fn blocks_from_md(blocks: Vec<MdBlock>) -> Vec<Block> {
    blocks.into_iter().map(Block::from).collect()
}

impl From<Block> for MdBlock {
    fn from(b: Block) -> Self {
        let kind = match b.kind {
            BlockKind::Paragraph { text } => MdBlockKind::Paragraph { text },
            BlockKind::Heading { level, text } => MdBlockKind::Heading { level: level.into(), text },
            BlockKind::List { style, indent, text } => MdBlockKind::ListItem { style: style.into(), indent, text },
            BlockKind::Quote { text } => MdBlockKind::Quote { text },
            BlockKind::Divider => MdBlockKind::Divider,
            BlockKind::Image { alt, src } => MdBlockKind::Image { alt, src },
            BlockKind::Heft { heft_id } => MdBlockKind::Heft { heft_id },
            BlockKind::File { src, name } => MdBlockKind::File { src, name },
            BlockKind::Code { language, text } => MdBlockKind::Code { language, text },
            BlockKind::Math { text } => MdBlockKind::Math { text },
            BlockKind::Table { rows } => MdBlockKind::Table { rows },
            BlockKind::Callout { color, children } => MdBlockKind::Callout { color, children: md_blocks(children) },
            BlockKind::Toggle { summary, open, children } => {
                MdBlockKind::Toggle { summary, open, children: md_blocks(children) }
            }
            BlockKind::Columns { columns } => {
                MdBlockKind::Columns { columns: columns.into_iter().map(md_blocks).collect() }
            }
            BlockKind::Other { type_name, text } => MdBlockKind::Other { type_name, text },
        };
        MdBlock { id: b.id, kind, text_color: b.text_color, bg_color: b.bg_color }
    }
}

impl From<MdBlock> for Block {
    fn from(b: MdBlock) -> Self {
        let kind = match b.kind {
            MdBlockKind::Paragraph { text } => BlockKind::Paragraph { text },
            MdBlockKind::Heading { level, text } => BlockKind::Heading { level: level.into(), text },
            MdBlockKind::ListItem { style, indent, text } => BlockKind::List { style: style.into(), indent, text },
            MdBlockKind::Quote { text } => BlockKind::Quote { text },
            MdBlockKind::Divider => BlockKind::Divider,
            MdBlockKind::Image { alt, src } => BlockKind::Image { alt, src },
            MdBlockKind::Heft { heft_id } => BlockKind::Heft { heft_id },
            MdBlockKind::File { src, name } => BlockKind::File { src, name },
            MdBlockKind::Code { language, text } => BlockKind::Code { language, text },
            MdBlockKind::Math { text } => BlockKind::Math { text },
            MdBlockKind::Table { rows } => BlockKind::Table { rows },
            MdBlockKind::Callout { color, children } => {
                BlockKind::Callout { color, children: blocks_from_md(children) }
            }
            MdBlockKind::Toggle { summary, open, children } => {
                BlockKind::Toggle { summary, open, children: blocks_from_md(children) }
            }
            MdBlockKind::Columns { columns } => {
                BlockKind::Columns { columns: columns.into_iter().map(blocks_from_md).collect() }
            }
            MdBlockKind::Other { type_name, text } => BlockKind::Other { type_name, text },
        };
        Block { id: b.id, kind, text_color: b.text_color, bg_color: b.bg_color }
    }
}

/// Markdown in Blöcke. Neue Block-IDs sind UUIDv4.
#[uniffi::export]
pub fn markdown_to_blocks(markdown: String) -> Vec<MdBlock> {
    let mut new_id = || uuid::Uuid::new_v4().to_string();
    md_blocks(impala_markdown::parse(&markdown, &mut new_id))
}

/// Blöcke zurück in Markdown (Block-IDs gehen dabei verloren).
#[uniffi::export]
pub fn blocks_to_markdown(blocks: Vec<MdBlock>) -> String {
    impala_markdown::serialize(&blocks_from_md(blocks))
}

/// Klartext des Markdowns: die Klartexte der Blöcke, zeilenweise getrennt.
#[uniffi::export]
pub fn markdown_plain_text(markdown: String) -> String {
    let mut new_id = || uuid::Uuid::new_v4().to_string();
    impala_markdown::parse(&markdown, &mut new_id)
        .iter()
        .map(impala_markdown::plain_text)
        .collect::<Vec<_>>()
        .join("\n")
}

/// Bis zu 7 Vorschauzeilen einer Seite (Startseite „Weitermachen“).
#[uniffi::export]
pub fn markdown_excerpt(title: String, content: String) -> Vec<String> {
    impala_markdown::excerpt(&title, &content)
}

/// Klartext einer Karte (Bilder/HTML raus, Formeln als „…“).
#[uniffi::export]
pub fn markdown_card_text(markdown: String) -> String {
    impala_markdown::card_text(&markdown)
}

/// Erster Fließtext-Absatz, höchstens 180 Zeichen (Tagesartikel).
#[uniffi::export]
pub fn markdown_teaser(body: String) -> String {
    impala_markdown::teaser(&body)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum MdShortcutType {
    H1,
    H2,
    H3,
    Bullet,
    Number,
    Todo { checked: bool },
    Quote,
    Code,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct MdShortcutResult {
    pub shortcut_type: MdShortcutType,
    pub rest: String,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct MdWrapResult {
    pub text: String,
    pub caret: u32,
}

#[uniffi::export]
pub fn md_shortcut_type(line: String) -> Option<MdShortcutResult> {
    impala_markdown::shortcut_type(&line).map(|(st, rest)| {
        let shortcut_type = match st {
            impala_markdown::ShortcutType::H1 => MdShortcutType::H1,
            impala_markdown::ShortcutType::H2 => MdShortcutType::H2,
            impala_markdown::ShortcutType::H3 => MdShortcutType::H3,
            impala_markdown::ShortcutType::Bullet => MdShortcutType::Bullet,
            impala_markdown::ShortcutType::Number => MdShortcutType::Number,
            impala_markdown::ShortcutType::Todo { checked } => MdShortcutType::Todo { checked },
            impala_markdown::ShortcutType::Quote => MdShortcutType::Quote,
            impala_markdown::ShortcutType::Code => MdShortcutType::Code,
        };
        MdShortcutResult { shortcut_type, rest }
    })
}

#[uniffi::export]
pub fn md_convert_block(block: MdBlock, target_type: String) -> MdBlock {
    let b: Block = block.into();
    let res = impala_markdown::convert_block(&b, &target_type);
    res.into()
}

#[uniffi::export]
pub fn md_continuation_block(block: MdBlock, new_id: String) -> Option<Vec<MdBlock>> {
    let b: Block = block.into();
    impala_markdown::continuation_block(&b, new_id).map(|(b1, b2)| vec![b1.into(), b2.into()])
}

#[uniffi::export]
pub fn md_indent_block(block: MdBlock, delta: i32) -> MdBlock {
    let b: Block = block.into();
    let res = impala_markdown::indent_block(&b, delta);
    res.into()
}

#[uniffi::export]
pub fn md_list_numbers(blocks: Vec<MdBlock>) -> std::collections::HashMap<String, u32> {
    let bs = blocks_from_md(blocks);
    impala_markdown::list_numbers(&bs).into_iter().collect()
}

#[uniffi::export]
pub fn md_wrap_markers(text: String, start_utf16: u32, end_utf16: u32, before: String, after: String) -> MdWrapResult {
    let (text, caret) = impala_markdown::wrap_markers(&text, start_utf16, end_utf16, &before, &after);
    MdWrapResult { text, caret }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MD: &str = "# Titel\n\
\n\
Ein Absatz\n\
\n\
- eins\n\
- zwei\n\
\n\
- [x] erledigt\n\
- [ ] offen\n\
\n\
```rust\n\
fn main() {}\n\
```\n\
\n\
| a | b |\n\
| --- | --- |\n\
| 1 | 2 |\n\
\n\
> [!blue] Hinweis\n\
> Inhalt im Kasten\n\
\n\
<details>\n\
<summary>Mehr</summary>\n\
\n\
Versteckt\n\
\n\
</details>\n";

    #[test]
    fn rundreise_entspricht_normalize() {
        let blocks = markdown_to_blocks(MD.to_owned());
        assert_eq!(blocks_to_markdown(blocks), impala_markdown::normalize(MD));
    }

    #[test]
    fn todo_kommt_als_abgehakt_an() {
        let blocks = markdown_to_blocks("- [x] erledigt\n- [ ] offen".to_owned());
        assert!(matches!(
            &blocks[0].kind,
            MdBlockKind::ListItem { style: MdListStyle::Todo { checked: true }, text, .. } if text == "erledigt"
        ));
        assert!(matches!(&blocks[1].kind, MdBlockKind::ListItem { style: MdListStyle::Todo { checked: false }, .. }));
    }

    #[test]
    fn kind_bloecke_sind_verschachtelt() {
        let blocks = markdown_to_blocks(MD.to_owned());
        let callout = blocks.iter().find_map(|b| match &b.kind {
            MdBlockKind::Callout { children, .. } => Some(children),
            _ => None,
        });
        assert!(callout.is_some_and(|c| !c.is_empty()));
        let toggle = blocks.iter().find_map(|b| match &b.kind {
            MdBlockKind::Toggle { children, .. } => Some(children),
            _ => None,
        });
        assert!(toggle.is_some_and(|c| !c.is_empty()));
    }

    #[test]
    fn ids_sind_eindeutig_und_farben_bleiben() {
        let blocks = markdown_to_blocks("- a\n- b".to_owned());
        assert_eq!(blocks.len(), 2);
        assert_ne!(blocks[0].id, blocks[1].id);
        assert!(blocks.iter().all(|b| b.text_color.is_none() && b.bg_color.is_none()));
    }

    #[test]
    fn plain_text_ohne_markup() {
        assert_eq!(markdown_plain_text("# Titel\n\nText".to_owned()), "Titel\nText");
    }
}
