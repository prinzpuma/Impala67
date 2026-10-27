//! Reine Text-Auswertung von Markdown, die im JS über mehrere Ansichten verstreut ist:
//! Klartext eines Blocks (editor.js `plainTextOf`), Vorschauzeilen (home-view.js `excerpt`),
//! Karten-Klartext (home-view.js `cardText`), Artikel-Anriss (home-article.js `teaser`),
//! erste Zeile (library.js), Wiki-Links (editor-inline.js), Seitenlinks (editor-menus.js) und
//! die Backlink-Regel (state.js `backlinksOf`).

use crate::block::{Block, BlockKind};
use crate::js::{collapse_ws, head16, is_ws, len16, strip_digits, trim, trim_start};

/// Klartext eines Blocks (z. B. Vorderseite einer Karte aus einem Block).
pub fn plain_text(b: &Block) -> String {
    let join = |blocks: &[Block]| blocks.iter().map(plain_text).collect::<Vec<_>>().join("\n");
    match &b.kind {
        BlockKind::Paragraph { text }
        | BlockKind::Heading { text, .. }
        | BlockKind::List { text, .. }
        | BlockKind::Quote { text }
        | BlockKind::Code { text, .. }
        | BlockKind::Math { text } => text.clone(),
        BlockKind::Callout { children, .. } => join(children),
        BlockKind::Toggle { summary, children, .. } => format!("{summary}\n{}", join(children)),
        BlockKind::Table { rows } => rows.iter().map(|r| r.join(" ")).collect::<Vec<_>>().join("\n"),
        BlockKind::Columns { columns } => columns.iter().map(|c| join(c)).collect::<Vec<_>>().join("\n"),
        BlockKind::Image { alt, .. } => alt.clone(),
        BlockKind::File { name, .. } => name.clone(),
        BlockKind::Divider | BlockKind::Heft { .. } | BlockKind::Other { .. } => String::new(),
    }
}

/// Bis zu 7 Vorschauzeilen einer Seite ohne Markdown-Zeichen; eine erste Zeile, die nur den
/// Titel wiederholt, entfällt.
pub fn excerpt(title: &str, content: &str) -> Vec<String> {
    let mut lines: Vec<String> = content.split('\n').map(excerpt_line).filter(|l| !l.is_empty()).collect();
    let t = letters(title);
    if !lines.is_empty() && !t.is_empty() && letters(&lines[0]).contains(&t) {
        lines.remove(0);
    }
    lines.truncate(7);
    lines
}

/// `/[^\p{L}\p{N}]+/gu` entfernt, klein. Kleine Abweichung: Rust-`is_alphabetic` zählt auch
/// kombinierende Vokalzeichen (Other_Alphabetic) mit, `\p{L}` nicht.
fn letters(s: &str) -> String {
    s.to_lowercase().chars().filter(|c| c.is_alphabetic() || c.is_numeric()).collect()
}

fn excerpt_line(l: &str) -> String {
    let l = replace_tags(l, "");
    // /^\s*>\s*\[![a-z]+\]/i → ">"
    let l = match callout_prefix(&l) {
        Some(rest) => format!(">{rest}"),
        None => l,
    };
    // /^\s*(#{1,6}|[-*+]|\d+\.|>|- \[[ x]\])\s*/i → "" (die Todo-Variante greift nie, weil
    // `[-*+]` vorher passt – „- [ ] x“ zeigt „[ ] x“; so auch hier)
    let body = trim_start(&l);
    let after = if body.starts_with('#') {
        let hashes = body.len() - body.trim_start_matches('#').len();
        Some(&body[hashes.min(6)..])
    } else if let Some(r) = body.strip_prefix(['-', '*', '+', '>']) {
        Some(r)
    } else {
        strip_digits(body).and_then(|r| r.strip_prefix('.'))
    };
    let l = match after {
        Some(r) => trim_start(r),
        None => &l,
    };
    // /[*_`~]|!?\[([^\]]*)\]\([^)]*\)/g → "$1"
    let mut out = String::with_capacity(l.len());
    let mut k = 0;
    while let Some(c) = l[k..].chars().next() {
        if matches!(c, '*' | '_' | '`' | '~') {
            k += 1;
            continue;
        }
        let start = if c == '!' { k + 1 } else { k };
        if let Some((label, end)) = link_at(l, start) {
            out.push_str(label);
            k = end;
            continue;
        }
        out.push(c);
        k += c.len_utf8();
    }
    trim(&out).to_owned()
}

/// `^\s*>\s*\[![a-z]+\]` (ohne Groß-/Kleinschreibung) → Rest dahinter
fn callout_prefix(l: &str) -> Option<&str> {
    let rest = trim_start(trim_start(l).strip_prefix('>')?).strip_prefix("[!")?;
    let after = rest.trim_start_matches(|c: char| c.is_ascii_alphabetic());
    if after.len() == rest.len() {
        return None;
    }
    after.strip_prefix(']')
}

/// `\[([^\]]*)\]\([^)]*\)` ab Byte `k` → (Beschriftung, Ende)
fn link_at(s: &str, k: usize) -> Option<(&str, usize)> {
    let rest = s.get(k..)?.strip_prefix('[')?;
    let close = rest.find(']')?;
    let target = rest[close + 1..].strip_prefix('(')?;
    let end = target.find(')')?;
    let consumed = s.len() - target.len() + end + 1;
    Some((&rest[..close], consumed))
}

/// `.replace(/<[^>]+>/g, with)`
fn replace_tags(s: &str, with: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut k = 0;
    while let Some(c) = s[k..].chars().next() {
        if c == '<'
            && !s[k + 1..].starts_with('>')
            && let Some(end) = s[k + 1..].find('>')
        {
            out.push_str(with);
            k += end + 2;
            continue;
        }
        out.push(c);
        k += c.len_utf8();
    }
    out
}

/// Klartext einer Karte (Startseite „Weißt du's noch?“): Bilder und HTML raus, Formeln als „…“.
pub fn card_text(md: &str) -> String {
    let no_images = replace_images(md);
    let no_tags = replace_tags(&no_images, " ");
    // /\$\$?[^$]*\$\$?/g → "…"
    let mut out = String::with_capacity(no_tags.len());
    let s = no_tags.as_str();
    let mut k = 0;
    while let Some(c) = s[k..].chars().next() {
        if c == '$'
            && let Some(end) = dollar_math_end(s, k)
        {
            out.push('…');
            k = end;
            continue;
        }
        out.push(c);
        k += c.len_utf8();
    }
    out.retain(|c| !matches!(c, '*' | '_' | '`' | '#' | '>' | '~'));
    trim(&collapse_ws(&out)).to_owned()
}

/// `!\[[^\]]*\]\([^)]*\)` entfernen
fn replace_images(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut k = 0;
    while let Some(c) = s[k..].chars().next() {
        if c == '!'
            && let Some((_, end)) = link_at(s, k + 1)
        {
            k = end;
            continue;
        }
        out.push(c);
        k += c.len_utf8();
    }
    out
}

/// Ende eines Treffers von `\$\$?[^$]*\$\$?` bei Byte `k` (dort steht `$`).
fn dollar_math_end(s: &str, k: usize) -> Option<usize> {
    let close = |from: usize| s[from..].find('$').map(|r| from + r);
    let tail = |r: usize| if s[r + 1..].starts_with('$') { r + 2 } else { r + 1 };
    // `\$\$?` gierig: erst mit zweitem $, sonst mit einem (dann darf das zweite $ schließen)
    if s[k + 1..].starts_with('$')
        && let Some(r) = close(k + 2)
    {
        return Some(tail(r));
    }
    close(k + 1).map(tail)
}

/// Erster Fließtext-Absatz (ohne Überschriften, Listen, Formeln), höchstens 180 Zeichen.
pub fn teaser(body: &str) -> String {
    let para = paragraphs(body)
        .into_iter()
        .map(trim)
        .find(|p| {
            let listy = |r: Option<&str>| r.is_some_and(|r| r.starts_with(is_ws));
            !p.is_empty()
                && !(p.starts_with('#')
                    || listy(p.strip_prefix(['-', '*', '+']))
                    || listy(strip_digits(p).and_then(|r| r.strip_prefix('.')))
                    || p.starts_with("$$"))
        })
        .unwrap_or("");
    // /\$[^$]*\$/g → "…"
    let mut t = String::with_capacity(para.len());
    let mut k = 0;
    while let Some(c) = para[k..].chars().next() {
        if c == '$'
            && let Some(r) = para[k + 1..].find('$')
        {
            t.push('…');
            k += r + 2;
            continue;
        }
        t.push(c);
        k += c.len_utf8();
    }
    t.retain(|c| !matches!(c, '*' | '_' | '`' | '>' | '#' | '~'));
    let t = trim(&collapse_ws(&t)).to_owned();
    if len16(&t) > 180 { format!("{}…", head16(&t, 179)) } else { t }
}

/// `split(/\n\s*\n/)`: Trenner reicht vom ersten bis zum letzten `\n` eines Leerraum-Laufs.
fn paragraphs(s: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0;
    let mut k = 0;
    while let Some(c) = s[k..].chars().next() {
        if c == '\n' {
            let run_end = s[k + 1..].find(|c: char| !is_ws(c)).map_or(s.len(), |r| k + 1 + r);
            if let Some(last) = s[k + 1..run_end].rfind('\n') {
                parts.push(&s[start..k]);
                start = k + 1 + last + 1;
                k = start;
                continue;
            }
        }
        k += c.len_utf8();
    }
    parts.push(&s[start..]);
    parts
}

/// Erste Zeile, die weder leer noch Überschrift ist, ohne `#>*\`[]`, höchstens 80 Zeichen
/// (Bibliothek).
pub fn first_line(content: &str) -> String {
    let line = content
        .split('\n')
        .find(|l| {
            let t = trim(l);
            !t.is_empty() && !t.starts_with('#')
        })
        .unwrap_or("");
    let cleaned: String = line.chars().filter(|c| !matches!(c, '#' | '>' | '*' | '`' | '[' | ']')).collect();
    head16(&cleaned, 80).to_owned()
}

/// Ausgeschriebene Wiki-Links `[[Titel]]` (ohne `]` und Zeilenumbruch im Titel).
pub fn wiki_links(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut k = 0;
    while let Some(c) = text[k..].chars().next() {
        if let Some(rest) = text[k..].strip_prefix("[[") {
            let len = rest.find([']', '\n']).unwrap_or(rest.len());
            if len > 0 && rest[len..].starts_with("]]") {
                out.push(&rest[..len]);
                k += 2 + len + 2;
                continue;
            }
        }
        k += c.len_utf8();
    }
    out
}

/// Markdown-Link auf eine Seite, wie ihn das Link-Menü einfügt: `[Titel](#ID)`.
pub fn page_link(title: &str, page_id: &str) -> String {
    let label: String =
        if title.is_empty() { "Ohne Titel" } else { title }.chars().filter(|c| !matches!(c, '[' | ']')).collect();
    format!("[{label}](#{page_id})")
}

/// Backlink-Regel: erwähnt `content` den Titel der Zielseite (ohne Groß-/Kleinschreibung)?
/// Seiten ohne Titel bzw. „Ohne Titel“ haben keine Backlinks. Welche Seiten durchsucht werden
/// (aktive, nicht die Zielseite selbst), entscheidet der Aufrufer.
pub fn links_to(content: &str, target_title: &str) -> bool {
    !target_title.is_empty()
        && target_title != "Ohne Titel"
        && content.to_lowercase().contains(&target_title.to_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zeilenende_im_label_bleibt_text() {
        assert_eq!(wiki_links("[[a\n]] [[b]]"), vec!["b"]);
    }
}
