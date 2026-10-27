//! Markdown (`pg.content`) → Blöcke. Verhalten wie `parse()` in web/editor-markdown.js; die
//! dortigen Regexe sind hier von Hand nachgebaut (Kommentar je Regel = JS-Regex).

use crate::block::{Block, BlockKind, HeadingLevel, ListStyle};
use crate::js::{find_ci, is_word, is_ws, no_lt, prefix_word, strip_digits, strip_prefix_ci, trim, trim_start};
use crate::mime::mime_from_name;

pub(crate) const FENCE: &str = "```";

/// Parst Markdown in Blöcke. `uid` liefert neue Block-IDs, in derselben Reihenfolge wie im JS
/// (Kinder vor dem umschließenden Block).
pub fn parse(md: &str, uid: &mut dyn FnMut() -> String) -> Vec<Block> {
    let norm = md.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = norm.split('\n').collect();
    parse_lines(&lines, uid)
}

struct Color<'a> {
    text: Option<&'a str>,
    bg: Option<&'a str>,
}

fn parse_lines(lines: &[&str], uid: &mut dyn FnMut() -> String) -> Vec<Block> {
    let mut out = Vec::new();
    let mut pending: Option<Color> = None;
    let mut i = 0;
    let mut push = |kind: BlockKind, id: String, pending: &mut Option<Color>| {
        let mut b = Block::new(id, kind);
        if let Some(c) = pending.take() {
            b.text_color = c.text.map(str::to_owned);
            b.bg_color = c.bg.map(str::to_owned);
        }
        out.push(b);
    };

    while i < lines.len() {
        let line = lines[i];
        let trimmed = trim(line);
        if trimmed.is_empty() {
            i += 1;
            continue;
        }
        if let Some((text, bg)) = color_meta(trimmed) {
            pending = Some(Color { text, bg });
            i += 1;
            continue;
        }

        // Code-Zaun
        if let Some(rest) = line.strip_prefix(FENCE) {
            let language = match trim(rest) {
                "" => "text",
                l => l,
            };
            i += 1;
            let start = i;
            while i < lines.len() && !lines[i].starts_with(FENCE) {
                i += 1;
            }
            let text = lines[start..i].join("\n");
            i += 1;
            push(BlockKind::Code { language: language.to_owned(), text }, uid(), &mut pending);
            continue;
        }

        // Formel: /^(\$\$|\\\[)(.*)$/ auf der getrimmten Zeile
        if let Some((end_token, first)) = math_start(trimmed) {
            let mut buf = Vec::new();
            i += 1;
            if let Some(end) = first.find(end_token) {
                buf.push(&first[..end]);
            } else {
                buf.push(first);
                while i < lines.len() {
                    let l = lines[i];
                    i += 1;
                    if let Some(end) = l.find(end_token) {
                        buf.push(&l[..end]);
                        break;
                    }
                    buf.push(l);
                }
            }
            let text = trim(&buf.join("\n")).to_owned();
            push(BlockKind::Math { text }, uid(), &mut pending);
            continue;
        }

        // /^:::heft\s+(\S+)/
        if let Some(heft_id) = heft(line) {
            push(BlockKind::Heft { heft_id: heft_id.to_owned() }, uid(), &mut pending);
            i += 1;
            continue;
        }

        // /^:::file\s+(\S+)(?:\s+(.*))?$/
        if let Some((src, name)) = file(line) {
            push(BlockKind::File { src: src.to_owned(), name: name.to_owned() }, uid(), &mut pending);
            i += 1;
            continue;
        }

        // Spalten (rekursiv)
        if prefix_word(line, ":::columns", false).is_some() {
            let mut cols: Vec<Vec<Block>> = Vec::new();
            let mut depth = 1;
            let mut buf: Vec<&str> = Vec::new();
            i += 1;
            while i < lines.len() && depth > 0 {
                let l = lines[i];
                if prefix_word(l, ":::columns", false).is_some() {
                    depth += 1;
                }
                if prefix_word(l, ":::end", false).is_some() {
                    depth -= 1;
                    if depth == 0 {
                        i += 1;
                        break;
                    }
                }
                if depth == 1 && prefix_word(l, ":::split", false).is_some() {
                    cols.push(parse_lines(&buf, uid));
                    buf.clear();
                    i += 1;
                    continue;
                }
                buf.push(l);
                i += 1;
            }
            cols.push(parse_lines(&buf, uid));
            for c in cols.iter_mut() {
                if c.is_empty() {
                    c.push(empty_paragraph(uid));
                }
            }
            push(BlockKind::Columns { columns: cols }, uid(), &mut pending);
            continue;
        }

        // Aufklappbereich <details> (verschachtelt)
        if prefix_word(trimmed, "<details", true).is_some() {
            let open = has_word_ci(line, "open");
            let mut summary = summary_in(line).unwrap_or("");
            let mut depth = 1;
            let mut buf: Vec<&str> = Vec::new();
            i += 1;
            while i < lines.len() && depth > 0 {
                let l = lines[i];
                let t = trim(l);
                if prefix_word(t, "<details", true).is_some() {
                    depth += 1;
                }
                if strip_prefix_ci(t, "</details>", true).is_some() {
                    depth -= 1;
                    if depth == 0 {
                        i += 1;
                        break;
                    }
                }
                if depth == 1 {
                    // /^\s*<summary>([\s\S]*?)<\/summary>/i
                    if let Some(s) = strip_prefix_ci(trim_start(l), "<summary>", true).and(summary_in(trim_start(l))) {
                        summary = s;
                        i += 1;
                        continue;
                    }
                }
                buf.push(l);
                i += 1;
            }
            let mut children = parse_lines(&buf, uid);
            if children.is_empty() {
                children.push(empty_paragraph(uid));
            }
            let summary = summary.to_owned();
            push(BlockKind::Toggle { summary, open, children }, uid(), &mut pending);
            continue;
        }

        // Callout `> [!farbe] Titel` + folgende >-Zeilen
        if let Some((color, first)) = callout_head(line) {
            let mut buf: Vec<&str> = if first.is_empty() { Vec::new() } else { vec![first] };
            i += 1;
            while i < lines.len() && lines[i].starts_with('>') && callout_head(lines[i]).is_none() {
                buf.push(strip_quote(lines[i]));
                i += 1;
            }
            let mut children = parse_lines(&buf, uid);
            if children.is_empty() {
                children.push(empty_paragraph(uid));
            }
            push(BlockKind::Callout { color: color.to_ascii_lowercase(), children }, uid(), &mut pending);
            continue;
        }

        // Zitat
        if line.starts_with('>') {
            let mut buf = Vec::new();
            while i < lines.len() && lines[i].starts_with('>') && callout_head(lines[i]).is_none() {
                buf.push(strip_quote(lines[i]));
                i += 1;
            }
            push(BlockKind::Quote { text: buf.join("\n") }, uid(), &mut pending);
            continue;
        }

        // GFM-Tabelle
        if is_table_line(line) {
            let mut rows: Vec<Vec<String>> = Vec::new();
            while i < lines.len() && is_table_line(lines[i]) {
                let t = trim(lines[i]);
                let t = t.strip_prefix('|').unwrap_or(t);
                let raw = t.strip_suffix('|').unwrap_or(t);
                // /^[\s:|-]+$/ = Trennzeile
                let separator = !raw.is_empty() && raw.chars().all(|c| is_ws(c) || matches!(c, ':' | '|' | '-'));
                if !separator {
                    rows.push(split_cells(raw));
                }
                i += 1;
            }
            let width = rows.iter().map(Vec::len).max().unwrap_or(0).max(2);
            for r in rows.iter_mut() {
                r.resize(width, String::new());
            }
            if rows.is_empty() {
                rows = vec![vec![String::new(); 2]; 2];
            }
            push(BlockKind::Table { rows }, uid(), &mut pending);
            continue;
        }

        if is_divider(line) {
            push(BlockKind::Divider, uid(), &mut pending);
            i += 1;
            continue;
        }

        // Bild – Video/Audio/PDF als Medienblock (sonst kaputtes <img>)
        if let Some((alt, src)) = image(line) {
            let mime = mime_from_name(src).unwrap_or("");
            let kind = if mime.starts_with("video/") || mime.starts_with("audio/") || mime == "application/pdf" {
                BlockKind::File { src: src.to_owned(), name: alt.to_owned() }
            } else {
                BlockKind::Image { alt: alt.to_owned(), src: src.to_owned() }
            };
            push(kind, uid(), &mut pending);
            i += 1;
            continue;
        }

        // /^(#{1,3})\s+(.*)$/
        if let Some((level, text)) = heading(line) {
            push(BlockKind::Heading { level, text: text.to_owned() }, uid(), &mut pending);
            i += 1;
            continue;
        }

        // /^(\s*)([-*+]|\d+[.)])\s+(.*)$/ – Einrückung: 2 Leerzeichen oder 1 Tab je Ebene
        if let Some(item) = list_item(line) {
            let lead = indent_width(item.lead);
            let cont_indent = lead + 2;
            let mut cont = String::new();
            i += 1;
            // Folgezeilen (Shift+Enter) stehen 2 Leerzeichen tiefer
            while i < lines.len() {
                let l = lines[i];
                let body = l.trim_start_matches([' ', '\t']);
                let ws = indent_width(&l[..l.len() - body.len()]);
                if ws < cont_indent || starts_with_marker(body) || body.starts_with(FENCE) {
                    break;
                }
                cont.push('\n');
                cont.extend(std::iter::repeat_n(' ', ws - cont_indent));
                cont.push_str(body);
                i += 1;
            }
            let indent = u32::try_from(lead / 2).unwrap_or(u32::MAX);
            let todo = if item.bullet { todo_prefix(item.rest) } else { None };
            let (style, first) = match todo {
                Some((checked, rest)) => (ListStyle::Todo { checked }, rest),
                None if item.bullet => (ListStyle::Bullet, item.rest),
                None => (ListStyle::Number, item.rest),
            };
            let kind = BlockKind::List { style, indent, text: first.to_owned() + &cont };
            push(kind, uid(), &mut pending);
            continue;
        }

        // Absatz: Folgezeilen bis Leerzeile oder Blockanfang
        let start = i;
        i += 1;
        while i < lines.len() && !trim(lines[i]).is_empty() && !starts_block(lines[i]) {
            i += 1;
        }
        push(BlockKind::Paragraph { text: lines[start..i].join("\n") }, uid(), &mut pending);
    }
    out
}

fn empty_paragraph(uid: &mut dyn FnMut() -> String) -> Block {
    Block::new(uid(), BlockKind::Paragraph { text: String::new() })
}

/// /^<!--@c:([a-z]+)?(?:;bg:([a-z]+))?-->$/
pub(crate) fn color_meta(t: &str) -> Option<(Option<&str>, Option<&str>)> {
    let mid = t.strip_prefix("<!--@c:")?.strip_suffix("-->")?;
    let rest = mid.trim_start_matches(|c: char| c.is_ascii_lowercase());
    let text = &mid[..mid.len() - rest.len()];
    let bg = match rest {
        "" => None,
        _ => {
            let bg = rest.strip_prefix(";bg:")?;
            if bg.is_empty() || !bg.chars().all(|c| c.is_ascii_lowercase()) {
                return None;
            }
            Some(bg)
        }
    };
    Some(((!text.is_empty()).then_some(text), bg))
}

fn math_start(t: &str) -> Option<(&'static str, &str)> {
    let (end, first) = if let Some(r) = t.strip_prefix("$$") { ("$$", r) } else { ("\\]", t.strip_prefix("\\[")?) };
    no_lt(first).then_some((end, first))
}

/// `\s+(\S+)` nach einem Präfix: (Wert, Rest dahinter)
fn ws_then_token(rest: &str) -> Option<(&str, &str)> {
    let after = trim_start(rest);
    if after.len() == rest.len() || after.is_empty() {
        return None;
    }
    let end = after.find(is_ws).unwrap_or(after.len());
    Some((&after[..end], &after[end..]))
}

fn heft(line: &str) -> Option<&str> {
    ws_then_token(line.strip_prefix(":::heft")?).map(|(id, _)| id)
}

fn file(line: &str) -> Option<(&str, &str)> {
    let (src, rest) = ws_then_token(line.strip_prefix(":::file")?)?;
    // (?:\s+(.*))?$ – Name ohne Zeilenende-Zeichen
    let name = trim_start(rest);
    no_lt(name).then_some((src, name))
}

/// /^>\s*\[!([a-z]+)\]\s*(.*)$/i → (Farbe, Titel).
/// Abweichung (JS-Fehler): JS verlangt für den Callout `(.*)$`, schließt die Zeile aber schon
/// ohne `$` vom Zitat aus. Enthält der Titel U+2028/U+2029, nimmt keine Regel die Zeile – die
/// Zitat-Schleife läuft ohne Fortschritt endlos (Editor hängt). Hier gilt eine Regel für beides:
/// solche Zeilen sind Callouts.
fn callout_head(line: &str) -> Option<(&str, &str)> {
    let rest = trim_start(line.strip_prefix('>')?).strip_prefix("[!")?;
    let after = rest.trim_start_matches(|c: char| c.is_ascii_alphabetic());
    let color = &rest[..rest.len() - after.len()];
    if color.is_empty() {
        return None;
    }
    Some((color, trim_start(after.strip_prefix(']')?)))
}

/// .replace(/^>\s?/, "")
fn strip_quote(line: &str) -> &str {
    let rest = line.strip_prefix('>').unwrap_or(line);
    match rest.chars().next() {
        Some(c) if is_ws(c) => &rest[c.len_utf8()..],
        _ => rest,
    }
}

/// /^\s*\|.*\|\s*$/
fn is_table_line(line: &str) -> bool {
    let t = trim(line);
    t.len() >= 2 && t.starts_with('|') && t.ends_with('|') && no_lt(&t[1..t.len() - 1])
}

/// raw.split(/(?<!\\)\|/) und je Zelle `\|` → `|`, trim
fn split_cells(raw: &str) -> Vec<String> {
    let mut cells = Vec::new();
    let mut start = 0;
    let mut prev = '\0';
    for (k, c) in raw.char_indices() {
        if c == '|' && prev != '\\' {
            cells.push(&raw[start..k]);
            start = k + 1;
        }
        prev = c;
    }
    cells.push(&raw[start..]);
    cells.into_iter().map(|c| trim(&c.replace("\\|", "|")).to_owned()).collect()
}

/// /^\s*---+\s*$/
pub(crate) fn is_divider(line: &str) -> bool {
    let t = trim(line);
    t.len() >= 3 && t.bytes().all(|b| b == b'-')
}

/// /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/ → (alt, src)
pub(crate) fn image(line: &str) -> Option<(&str, &str)> {
    let rest = line.strip_prefix("![")?;
    let close = rest.find(']')?;
    let alt = &rest[..close];
    let rest = rest[close + 1..].strip_prefix('(')?;
    let end = rest.find(|c: char| c == ')' || is_ws(c)).unwrap_or(rest.len());
    let src = &rest[..end];
    let tail = rest[end..].strip_prefix(')')?;
    (!src.is_empty() && trim_start(tail).is_empty()).then_some((alt, src))
}

fn heading(line: &str) -> Option<(HeadingLevel, &str)> {
    let rest = line.trim_start_matches('#');
    let level = match line.len() - rest.len() {
        1 => HeadingLevel::H1,
        2 => HeadingLevel::H2,
        3 => HeadingLevel::H3,
        _ => return None,
    };
    let text = trim_start(rest);
    (text.len() < rest.len() && no_lt(text)).then_some((level, text))
}

struct ListItem<'a> {
    lead: &'a str,
    bullet: bool,
    rest: &'a str,
}

/// `[-*+]` bzw. `\d+[.)]` am Anfang: (Aufzählungszeichen?, Rest)
fn marker(s: &str) -> Option<(bool, &str)> {
    if let Some(r) = s.strip_prefix(['-', '*', '+']) {
        return Some((true, r));
    }
    let r = strip_digits(s)?;
    Some((false, r.strip_prefix(['.', ')'])?))
}

fn list_item(line: &str) -> Option<ListItem<'_>> {
    let body = trim_start(line);
    let (bullet, after) = marker(body)?;
    let rest = trim_start(after);
    (rest.len() < after.len() && no_lt(rest)).then(|| ListItem { lead: &line[..line.len() - body.len()], bullet, rest })
}

/// /^([-*+]|\d+[.)])\s/
fn starts_with_marker(s: &str) -> bool {
    marker(s).is_some_and(|(_, r)| r.starts_with(is_ws))
}

/// Breite der Einrückung, Tab = 2 Leerzeichen (alle JS-Leerzeichen sind 1 UTF-16-Einheit).
fn indent_width(lead: &str) -> usize {
    lead.chars().map(|c| if c == '\t' { 2 } else { 1 }).sum()
}

/// /^\[( |x|X)\]\s?(.*)$/
fn todo_prefix(text: &str) -> Option<(bool, &str)> {
    let rest = text.strip_prefix('[')?;
    let checked = match rest.chars().next()? {
        ' ' => false,
        'x' | 'X' => true,
        _ => return None,
    };
    let rest = rest[1..].strip_prefix(']')?;
    let rest = match rest.chars().next() {
        Some(c) if is_ws(c) => &rest[c.len_utf8()..],
        _ => rest,
    };
    Some((checked, rest))
}

/// /\bopen\b/i irgendwo in der Zeile
fn has_word_ci(line: &str, word: &str) -> bool {
    let mut from = 0;
    while let Some(k) = find_ci(line, word, from) {
        let before = line[..k].chars().next_back().is_none_or(|c| !is_word(c));
        let after = line[k + word.len()..].chars().next().is_none_or(|c| !is_word(c));
        if before && after {
            return true;
        }
        from = k + 1;
    }
    false
}

/// /<summary>([\s\S]*?)<\/summary>/i
fn summary_in(line: &str) -> Option<&str> {
    let start = find_ci(line, "<summary>", 0)? + "<summary>".len();
    let end = find_ci(line, "</summary>", start)?;
    Some(&line[start..end])
}

/// Beginnt mit dieser Zeile ein neuer Block (Absatzende)? Wie die JS-Regex im Absatz-Zweig:
/// /^(#{1,3}\s|>|\s*([-*+]|\d+[.)])\s|\s*\||\s*---+\s*$|:::|<details\b|<\/details\b|\$\$|\\\[)/
/// plus Code-Zaun, Farbmarke und Bild.
fn starts_block(line: &str) -> bool {
    let hashes = line.len() - line.trim_start_matches('#').len();
    let body = trim_start(line);
    ((1..=3).contains(&hashes) && line[hashes..].starts_with(is_ws))
        || line.starts_with('>')
        || starts_with_marker(body)
        || body.starts_with('|')
        || is_divider(line)
        || line.starts_with(":::")
        || prefix_word(line, "<details", false).is_some()
        || prefix_word(line, "</details", false).is_some()
        || line.starts_with("$$")
        || line.starts_with("\\[")
        || line.starts_with(FENCE)
        || color_meta(trim(line)).is_some()
        || image(line).is_some()
}
