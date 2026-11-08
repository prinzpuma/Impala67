//! Editor-Operationen für Markdown-Blöcke (Shortcuts, Umwandeln, Fortsetzen, Einzug, Nummerierung, Inline-Marker).

use crate::block::{Block, BlockKind, HeadingLevel, ListStyle};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShortcutType {
    H1,
    H2,
    H3,
    Bullet,
    Number,
    Todo { checked: bool },
    Quote,
    Code,
}

pub fn shortcut_type(line: &str) -> Option<(ShortcutType, String)> {
    if let Some(rest) = line.strip_prefix("# ") {
        Some((ShortcutType::H1, rest.to_string()))
    } else if let Some(rest) = line.strip_prefix("## ") {
        Some((ShortcutType::H2, rest.to_string()))
    } else if let Some(rest) = line.strip_prefix("### ") {
        Some((ShortcutType::H3, rest.to_string()))
    } else if line.starts_with("- ") || line.starts_with("* ") || line.starts_with("+ ") {
        Some((ShortcutType::Bullet, line[2..].to_string()))
    } else if line.starts_with("1. ") || line.starts_with("1) ") {
        Some((ShortcutType::Number, line[3..].to_string()))
    } else if let Some(rest) = line.strip_prefix("[] ") {
        Some((ShortcutType::Todo { checked: false }, rest.to_string()))
    } else if let Some(rest) = line.strip_prefix("[ ] ") {
        Some((ShortcutType::Todo { checked: false }, rest.to_string()))
    } else if line.starts_with("[x] ") || line.starts_with("[X] ") {
        Some((ShortcutType::Todo { checked: true }, line[4..].to_string()))
    } else if let Some(rest) = line.strip_prefix("> ") {
        Some((ShortcutType::Quote, rest.to_string()))
    } else {
        line.strip_prefix("```").map(|rest| (ShortcutType::Code, rest.trim().to_string()))
    }
}

pub fn convert_block(block: &Block, target_type: &str) -> Block {
    let text = match &block.kind {
        BlockKind::Paragraph { text } => text.clone(),
        BlockKind::Heading { text, .. } => text.clone(),
        BlockKind::List { text, .. } => text.clone(),
        BlockKind::Quote { text } => text.clone(),
        BlockKind::Code { text, .. } => text.clone(),
        BlockKind::Math { text } => text.clone(),
        BlockKind::Other { text, .. } => text.clone(),
        _ => "".to_string(),
    };
    let indent = match &block.kind {
        BlockKind::List { indent, .. } => *indent,
        _ => 0,
    };
    let language = match &block.kind {
        BlockKind::Code { language, .. } => language.clone(),
        _ => "".to_string(),
    };

    let kind = match target_type {
        "p" | "paragraph" | "text" => BlockKind::Paragraph { text },
        "h1" => BlockKind::Heading { level: HeadingLevel::H1, text },
        "h2" => BlockKind::Heading { level: HeadingLevel::H2, text },
        "h3" => BlockKind::Heading { level: HeadingLevel::H3, text },
        "bullet" => BlockKind::List { style: ListStyle::Bullet, indent, text },
        "number" => BlockKind::List { style: ListStyle::Number, indent, text },
        "todo" => BlockKind::List { style: ListStyle::Todo { checked: false }, indent, text },
        "quote" => BlockKind::Quote { text },
        "code" => BlockKind::Code { language, text },
        _ => block.kind.clone(),
    };

    Block { id: block.id.clone(), kind, text_color: block.text_color.clone(), bg_color: block.bg_color.clone() }
}

pub fn continuation_block(block: &Block, new_id: String) -> Option<(Block, Block)> {
    let next_kind = match &block.kind {
        BlockKind::List { style, indent, .. } => {
            let next_style = match style {
                ListStyle::Todo { .. } => ListStyle::Todo { checked: false },
                other => *other,
            };
            BlockKind::List { style: next_style, indent: *indent, text: String::new() }
        }
        BlockKind::Quote { .. } => BlockKind::Quote { text: String::new() },
        _ => BlockKind::Paragraph { text: String::new() },
    };
    Some((block.clone(), Block::new(new_id, next_kind)))
}

pub fn indent_block(block: &Block, delta: i32) -> Block {
    let (style, indent, text) = match &block.kind {
        BlockKind::List { style, indent, text } => (*style, *indent, text.clone()),
        _ => return block.clone(),
    };
    let new_indent = ((indent as i32) + delta).clamp(0, 6) as u32;
    Block {
        id: block.id.clone(),
        kind: BlockKind::List { style, indent: new_indent, text },
        text_color: block.text_color.clone(),
        bg_color: block.bg_color.clone(),
    }
}

pub fn list_numbers(blocks: &[Block]) -> Vec<(String, u32)> {
    let mut out = Vec::new();
    let mut counters = [0u32; 8];
    let mut prev_listy = false;

    fn walk(blocks: &[Block], counters: &mut [u32; 8], prev_listy: &mut bool, out: &mut Vec<(String, u32)>) {
        for b in blocks {
            match &b.kind {
                BlockKind::List { style, indent, .. } => {
                    let depth = (*indent as usize).min(7);
                    let is_number = matches!(style, ListStyle::Number);
                    if is_number {
                        if !*prev_listy {
                            counters.fill(0);
                        }
                        counters[depth] += 1;
                        counters[(depth + 1)..8].fill(0);
                        out.push((b.id.clone(), counters[depth]));
                        *prev_listy = true;
                    } else {
                        counters[depth..8].fill(0);
                        *prev_listy = true;
                    }
                }
                _ => {
                    *prev_listy = false;
                    counters.fill(0);
                }
            }
            match &b.kind {
                BlockKind::Callout { children, .. } | BlockKind::Toggle { children, .. } => {
                    walk(children, counters, prev_listy, out);
                    *prev_listy = false;
                    counters.fill(0);
                }
                BlockKind::Columns { columns } => {
                    for col in columns {
                        *prev_listy = false;
                        counters.fill(0);
                        walk(col, counters, prev_listy, out);
                    }
                    *prev_listy = false;
                    counters.fill(0);
                }
                _ => {}
            }
        }
    }

    walk(blocks, &mut counters, &mut prev_listy, &mut out);
    out
}

pub fn wrap_markers(text: &str, start_utf16: u32, end_utf16: u32, before: &str, after: &str) -> (String, u32) {
    let utf16_chars: Vec<u16> = text.encode_utf16().collect();
    let s = (start_utf16 as usize).min(utf16_chars.len());
    let e = (end_utf16 as usize).min(utf16_chars.len()).max(s);

    let pre_u16 = &utf16_chars[..s];
    let mid_u16 = &utf16_chars[s..e];
    let post_u16 = &utf16_chars[e..];

    let pre = String::from_utf16_lossy(pre_u16);
    let mid = String::from_utf16_lossy(mid_u16);
    let post = String::from_utf16_lossy(post_u16);

    let before_u16: Vec<u16> = before.encode_utf16().collect();
    let after_u16: Vec<u16> = after.encode_utf16().collect();

    let mid_is_wrapped = mid.starts_with(before)
        && mid.ends_with(after)
        && mid.chars().count() >= before.chars().count() + after.chars().count()
        && (before != "*"
            || (mid.starts_with("***") && mid.ends_with("***"))
            || (!mid.starts_with("**") && !mid.ends_with("**")));

    let (new_text, new_caret_u16) = if mid.is_empty() {
        let new_s = format!("{}{}{}{}", pre, before, after, post);
        let caret = s + before_u16.len();
        (new_s, caret)
    } else if mid_is_wrapped {
        let inner = &mid[before.len()..mid.len() - after.len()];
        let inner_u16: Vec<u16> = inner.encode_utf16().collect();
        let new_s = format!("{}{}{}", pre, inner, post);
        let caret = s + inner_u16.len();
        (new_s, caret)
    } else if pre.ends_with(before) && post.starts_with(after) {
        let new_pre = &pre[..pre.len() - before.len()];
        let new_post = &post[after.len()..];
        let new_s = format!("{}{}{}", new_pre, mid, new_post);
        let pre_u16_new: Vec<u16> = new_pre.encode_utf16().collect();
        let caret = pre_u16_new.len() + mid_u16.len();
        (new_s, caret)
    } else {
        let new_s = format!("{}{}{}{}{}", pre, before, mid, after, post);
        let caret = s + before_u16.len() + mid_u16.len() + after_u16.len();
        (new_s, caret)
    };

    (new_text, new_caret_u16 as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shortcut_type() {
        assert_eq!(shortcut_type("# Title"), Some((ShortcutType::H1, "Title".to_string())));
        assert_eq!(shortcut_type("- item"), Some((ShortcutType::Bullet, "item".to_string())));
        assert_eq!(shortcut_type("1. first"), Some((ShortcutType::Number, "first".to_string())));
        assert_eq!(shortcut_type("[ ] task"), Some((ShortcutType::Todo { checked: false }, "task".to_string())));
        assert_eq!(shortcut_type("> quote"), Some((ShortcutType::Quote, "quote".to_string())));
        assert_eq!(shortcut_type("```rust"), Some((ShortcutType::Code, "rust".to_string())));
        assert_eq!(shortcut_type("normal"), None);
    }

    #[test]
    fn test_convert_block() {
        let b = Block::new("123".to_string(), BlockKind::Paragraph { text: "Hello".to_string() });
        let conv = convert_block(&b, "h1");
        assert_eq!(conv.id, "123");
        assert!(matches!(conv.kind, BlockKind::Heading { level: HeadingLevel::H1, ref text } if text == "Hello"));
    }

    #[test]
    fn test_indent_block() {
        let b = Block::new(
            "123".to_string(),
            BlockKind::List { style: ListStyle::Bullet, indent: 1, text: "A".to_string() },
        );
        let indented = indent_block(&b, 2);
        assert!(matches!(indented.kind, BlockKind::List { indent: 3, .. }));
        let clamped = indent_block(&b, 10);
        assert!(matches!(clamped.kind, BlockKind::List { indent: 6, .. }));
    }

    #[test]
    fn test_list_numbers() {
        let blocks = vec![
            Block::new("1".to_string(), BlockKind::List { style: ListStyle::Number, indent: 0, text: "A".to_string() }),
            Block::new("2".to_string(), BlockKind::List { style: ListStyle::Number, indent: 0, text: "B".to_string() }),
        ];
        let nums = list_numbers(&blocks);
        assert_eq!(nums, vec![("1".to_string(), 1), ("2".to_string(), 2)]);
    }

    #[test]
    fn test_wrap_markers() {
        let (text, caret) = wrap_markers("Hello world", 0, 5, "**", "**");
        assert_eq!(text, "**Hello** world");
        assert_eq!(caret, 9);
    }
}
