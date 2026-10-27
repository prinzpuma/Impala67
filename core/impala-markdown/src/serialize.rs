//! Blöcke → Markdown, wie `serializeBlock`/`serialize` in web/editor-markdown.js.
//! Farben werden (wie im JS) nur bei Text-, Listen-, Zitat- und Callout-Blöcken geschrieben.

use crate::block::{Block, BlockKind, HeadingLevel, ListStyle};
use crate::parse::FENCE;

/// Ganze Seite: Listen bleiben zusammenhängend, sonst trennt eine Leerzeile.
pub fn serialize(blocks: &[Block]) -> String {
    let mut out = String::new();
    for (k, b) in blocks.iter().enumerate() {
        if k > 0 {
            out.push_str(if blocks[k - 1].is_list() && b.is_list() { "\n" } else { "\n\n" });
        }
        write_block(&mut out, b);
    }
    out
}

pub fn serialize_block(b: &Block) -> String {
    let mut out = String::new();
    write_block(&mut out, b);
    out
}

fn color_meta(out: &mut String, b: &Block) {
    let text = b.text_color.as_deref().unwrap_or("");
    let bg = b.bg_color.as_deref().unwrap_or("");
    if text.is_empty() && bg.is_empty() {
        return;
    }
    out.push_str("<!--@c:");
    out.push_str(text);
    if !bg.is_empty() {
        out.push_str(";bg:");
        out.push_str(bg);
    }
    out.push_str("-->\n");
}

/// Jede Zeile mit `prefix` versehen (`split("\n").map(…).join("\n")`).
fn prefixed(out: &mut String, text: &str, prefix: &str) {
    for (k, l) in text.split('\n').enumerate() {
        if k > 0 {
            out.push('\n');
        }
        out.push_str(prefix);
        out.push_str(l);
    }
}

fn or<'a>(s: &'a str, fallback: &'a str) -> &'a str {
    if s.is_empty() { fallback } else { s }
}

fn write_block(out: &mut String, b: &Block) {
    match &b.kind {
        BlockKind::Paragraph { text } | BlockKind::Other { text, .. } => {
            color_meta(out, b);
            out.push_str(text);
        }
        BlockKind::Heading { level, text } => {
            color_meta(out, b);
            out.push_str(match level {
                HeadingLevel::H1 => "# ",
                HeadingLevel::H2 => "## ",
                HeadingLevel::H3 => "### ",
            });
            out.push_str(text);
        }
        BlockKind::List { style, indent, text } => {
            color_meta(out, b);
            let ind = "  ".repeat(*indent as usize);
            out.push_str(&ind);
            out.push_str(match style {
                ListStyle::Bullet => "- ",
                ListStyle::Number => "1. ",
                ListStyle::Todo { checked: true } => "- [x] ",
                ListStyle::Todo { checked: false } => "- [ ] ",
            });
            // Zeilenumbrüche als eingerückte Folgezeilen (parse liest sie zurück)
            out.push_str(&text.replace('\n', &format!("\n{ind}  ")));
        }
        BlockKind::Quote { text } => {
            color_meta(out, b);
            prefixed(out, text, "> ");
        }
        BlockKind::Divider => out.push_str("---"),
        BlockKind::Image { alt, src } => {
            out.push_str("![");
            out.push_str(alt);
            out.push_str("](");
            out.push_str(src);
            out.push(')');
        }
        BlockKind::Heft { heft_id } => {
            out.push_str(":::heft ");
            out.push_str(heft_id);
        }
        BlockKind::File { src, name } => {
            out.push_str(":::file ");
            out.push_str(src);
            if !name.is_empty() {
                out.push(' ');
                out.push_str(name);
            }
        }
        BlockKind::Code { language, text } => {
            out.push_str(FENCE);
            out.push_str(or(language, "text"));
            out.push('\n');
            out.push_str(text);
            out.push('\n');
            out.push_str(FENCE);
        }
        BlockKind::Math { text } => {
            out.push_str("$$\n");
            out.push_str(text);
            out.push_str("\n$$");
        }
        BlockKind::Table { rows } => {
            for (ri, row) in rows.iter().enumerate() {
                if ri > 0 {
                    out.push('\n');
                }
                out.push_str("| ");
                for (ci, c) in row.iter().enumerate() {
                    if ci > 0 {
                        out.push_str(" | ");
                    }
                    out.push_str(&c.replace('|', "\\|").replace('\n', " "));
                }
                out.push_str(" |");
                if ri == 0 {
                    out.push_str("\n|");
                    out.push_str(&vec![" --- "; row.len()].join("|"));
                    out.push('|');
                }
            }
        }
        BlockKind::Callout { color, children } => {
            color_meta(out, b);
            out.push_str("> [!");
            out.push_str(or(color, "blue"));
            out.push_str("]\n");
            prefixed(out, &serialize(children), "> ");
        }
        BlockKind::Toggle { summary, open, children } => {
            out.push_str(if *open { "<details open>\n<summary>" } else { "<details>\n<summary>" });
            out.push_str(summary);
            out.push_str("</summary>\n\n");
            out.push_str(&serialize(children));
            out.push_str("\n</details>");
        }
        BlockKind::Columns { columns } => {
            out.push_str(":::columns\n");
            let cols: Vec<String> = columns.iter().map(|c| serialize(c)).collect();
            out.push_str(&cols.join("\n:::split\n"));
            out.push_str("\n:::end");
        }
    }
}
