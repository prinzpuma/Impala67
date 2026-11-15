//! Karten-Import und -Export (TXT, CSV/TSV, Anki-Text) wie in der PWA (`web/extras.js`)
//! und in der iPad-App (`ios/Impala67/Cards/CardText.swift`, `CardTransfer.swift`).
//! Reines Datenformat ohne UI-Abhängigkeiten.

use std::collections::HashSet;

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

use serde_json::Value;

pub const TXT_HEADER: &str = "# Impala67-Karteikarten v1";

fn deserialize_lenient_string<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let opt = Option::<Value>::deserialize(deserializer)?;
    match opt {
        Some(Value::String(s)) => Ok(s),
        Some(Value::Number(n)) => Ok(n.to_string()),
        Some(Value::Bool(b)) => Ok(b.to_string()),
        _ => Ok(String::new()),
    }
}

/// Eine Karte zum Importieren bzw. Exportieren (Vorderseite, Rückseite, Stapel).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlainCard {
    #[serde(default, deserialize_with = "deserialize_lenient_string")]
    pub front: String,
    #[serde(default, deserialize_with = "deserialize_lenient_string")]
    pub back: String,
    #[serde(default, deserialize_with = "deserialize_lenient_string")]
    pub deck: String,
}

/// Ergebnis einer gelesenen Datei: Karten, aufgetretene Probleme und erkanntes Format.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParsedCards {
    pub cards: Vec<PlainCard>,
    pub errors: Vec<String>,
    pub format: String,
}

/// Prüft, ob eine Zeile mit einem Impala67-Formatmarker beginnt.
fn is_text_marker(line: &str) -> bool {
    if line.starts_with('\\') {
        return true;
    }
    for marker in ["@stapel", "@frage", "@antwort"] {
        if line.len() >= marker.len() && line[..marker.len()].eq_ignore_ascii_case(marker) {
            let tail = &line[marker.len()..];
            match tail.chars().next() {
                None => return true,
                Some(c) if !c.is_alphanumeric() && c != '_' => return true,
                _ => {}
            }
        }
    }
    if let Some(tail) = line.strip_prefix("---")
        && tail.chars().all(|c| c.is_whitespace())
    {
        return true;
    }
    false
}

/// Eine zusätzliche führende `\` schützt Formatmarker; auch vorhandene `\` werden
/// verdoppelt, damit Export → Import den ursprünglichen Text exakt erhält.
pub fn text_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 16);
    let mut rest = s;
    while !rest.is_empty() {
        let line_len = rest.find(['\n', '\r']).unwrap_or(rest.len());
        let line = &rest[..line_len];
        if is_text_marker(line) {
            out.push('\\');
        }
        out.push_str(line);
        let remainder = &rest[line_len..];
        if let Some(stripped) = remainder.strip_prefix("\r\n") {
            out.push_str("\r\n");
            rest = stripped;
        } else if let Some(stripped) = remainder.strip_prefix('\n') {
            out.push('\n');
            rest = stripped;
        } else if let Some(stripped) = remainder.strip_prefix('\r') {
            out.push('\r');
            rest = stripped;
        } else {
            break;
        }
    }
    out
}

/// Entfernt eine führende Schutz-`\`, wenn dahinter ein Formatmarker folgt.
fn text_unescape_line(line: &str) -> &str {
    if let Some(tail) = line.strip_prefix('\\')
        && is_text_marker(tail)
    {
        return tail;
    }
    line
}

/// Impala-TXT-Format schreiben: Themengruppen mit `@stapel`, Fragen mit `@frage`,
/// Antworten mit `@antwort`, Karten getrennt mit `---`.
pub fn export_txt(cards: &[PlainCard]) -> String {
    let mut by_deck: IndexMap<&str, Vec<&PlainCard>> = IndexMap::new();
    for c in cards {
        let deck = if c.deck.is_empty() { "Standard" } else { c.deck.as_str() };
        by_deck.entry(deck).or_default().push(c);
    }
    let mut parts: Vec<String> = vec![TXT_HEADER.to_owned()];
    for (deck, deck_cards) in by_deck {
        parts.push(String::new());
        parts.push(format!("@stapel {deck}"));
        for c in deck_cards {
            parts.push("@frage".to_owned());
            parts.push(text_escape(&c.front));
            parts.push("@antwort".to_owned());
            parts.push(text_escape(&c.back));
            parts.push("---".to_owned());
        }
    }
    parts.join("\n")
}

/// Schützt CSV-Zellen mit Semikolon, Anführungszeichen, Zeilenumbruch oder Tabulator.
pub fn csv_escape(s: &str) -> String {
    if s.contains(['"', ';', '\n', '\t']) {
        let mut out = String::with_capacity(s.len() + 8);
        out.push('"');
        for ch in s.chars() {
            if ch == '"' {
                out.push_str("\"\"");
            } else {
                out.push(ch);
            }
        }
        out.push('"');
        out
    } else {
        s.to_owned()
    }
}

/// CSV mit Semikolon als Trenner schreiben (`front;back;deck\n`).
pub fn export_csv(cards: &[PlainCard]) -> String {
    let mut out = String::from("front;back;deck\n");
    for (i, c) in cards.iter().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        let deck = if c.deck.is_empty() { "Standard" } else { c.deck.as_str() };
        out.push_str(&csv_escape(&c.front));
        out.push(';');
        out.push_str(&csv_escape(&c.back));
        out.push(';');
        out.push_str(&csv_escape(deck));
    }
    out
}

/// Parst eine CSV/TSV-Datei mit automatischer Erkennung des Trennzeichens.
pub fn parse_csv(text: &str) -> Vec<Vec<String>> {
    let mut separator_name = None;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.len() > 11 && trimmed[..11].eq_ignore_ascii_case("#separator:") {
            separator_name = Some(trimmed[11..].trim().to_ascii_lowercase());
            break;
        }
    }

    let named_sep = separator_name.as_deref().and_then(|name| match name {
        "tab" => Some('\t'),
        "comma" => Some(','),
        "semicolon" => Some(';'),
        "colon" => Some(':'),
        "pipe" => Some('|'),
        "space" => Some(' '),
        s if s.chars().count() == 1 => s.chars().next(),
        _ => None,
    });

    let sep = if let Some(s) = named_sep {
        s
    } else {
        let content_line = text
            .lines()
            .find(|l| {
                let t = l.trim_start();
                !t.is_empty() && !t.starts_with('#')
            })
            .unwrap_or("");
        if content_line.contains('\t') {
            '\t'
        } else if content_line.contains(';') {
            ';'
        } else {
            ','
        }
    };

    let chars: Vec<char> = text.chars().collect();
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut cur = String::new();
    let mut in_q = false;
    let mut i = 0;

    while i < chars.len() {
        let ch = chars[i];
        if in_q {
            if ch == '"' {
                if i + 1 < chars.len() && chars[i + 1] == '"' {
                    cur.push('"');
                    i += 1;
                } else {
                    in_q = false;
                }
            } else {
                cur.push(ch);
            }
        } else if ch == '"' {
            in_q = true;
        } else if ch == sep {
            row.push(cur);
            cur = String::new();
        } else if ch == '\n' || ch == '\r' {
            if ch == '\r' && i + 1 < chars.len() && chars[i + 1] == '\n' {
                i += 1;
            }
            row.push(cur);
            cur = String::new();
            if row.iter().any(|x| !x.is_empty()) {
                rows.push(row);
            }
            row = Vec::new();
        } else {
            cur.push(ch);
        }
        i += 1;
    }
    row.push(cur);
    if row.iter().any(|x| !x.is_empty()) {
        rows.push(row);
    }
    rows
}

/// Tabellarische Karten (CSV/TSV oder Anki-Text mit `#`-Direktiven) einlesen.
pub fn parse_table_cards(text: &str, default_deck: &str) -> ParsedCards {
    let rows = parse_csv(text);
    let mut directives: Vec<&str> = Vec::new();
    for line in text.lines() {
        let t = line.trim();
        if t.starts_with('#') {
            directives.push(t);
        }
    }

    let deck_directive = directives.iter().find_map(|line| {
        if line.len() > 6 && line[..6].eq_ignore_ascii_case("#deck:") { Some(line[6..].trim()) } else { None }
    });

    let default_deck_trimmed = default_deck.trim();
    let fallback_deck = if !default_deck_trimmed.is_empty() { default_deck_trimmed } else { "Standard" };

    let effective_default_deck = deck_directive.unwrap_or(fallback_deck);

    let column_of = |name: &str| -> Option<usize> {
        let prefix = format!("#{name} column:");
        for d in &directives {
            if d.len() > prefix.len()
                && d[..prefix.len()].eq_ignore_ascii_case(&prefix)
                && let Ok(num) = d[prefix.len()..].trim().parse::<usize>()
                && num > 0
            {
                return Some(num - 1);
            }
        }
        None
    };

    let special: Vec<usize> = ["guid", "notetype", "deck", "tags"].into_iter().filter_map(column_of).collect();
    let deck_column = column_of("deck");

    let mut cards = Vec::new();
    let mut errors = Vec::new();

    for row in rows {
        if row.is_empty() || row[0].starts_with('#') {
            continue;
        }
        if row.len() >= 2 && row[0].trim().eq_ignore_ascii_case("front") && row[1].trim().eq_ignore_ascii_case("back") {
            continue;
        }

        let content_indices: Vec<usize> = (0..row.len()).filter(|i| !special.contains(i)).collect();
        let front = content_indices.first().and_then(|&i| row.get(i)).map_or("", |s| s.trim());
        let back = content_indices.get(1).and_then(|&i| row.get(i)).map_or("", |s| s.trim());

        let raw_deck = if let Some(col) = deck_column {
            row.get(col).map_or("", |s| s.as_str())
        } else if deck_directive.is_some() {
            effective_default_deck
        } else if let Some(d) = row.get(2) {
            let trimmed = d.trim();
            if trimmed.is_empty() { effective_default_deck } else { trimmed }
        } else {
            effective_default_deck
        };

        let trimmed_deck = raw_deck.trim();
        let deck = if trimmed_deck.is_empty() { "Standard" } else { trimmed_deck };

        if !front.is_empty() && !back.is_empty() {
            cards.push(PlainCard { front: front.to_owned(), back: back.to_owned(), deck: deck.to_owned() });
        } else if !front.is_empty() {
            let prefix: String = front.chars().take(60).collect();
            errors.push(format!("Eine Karte hat keine Antwort: {prefix}"));
        }
    }

    ParsedCards {
        cards,
        errors,
        format: if !directives.is_empty() { "Anki-Text".to_owned() } else { "CSV/TSV".to_owned() },
    }
}

/// Impala-TXT-Dateien einlesen.
pub fn parse_impala_txt(text: &str, default_deck: &str) -> ParsedCards {
    let clean = text.strip_prefix('\u{FEFF}').unwrap_or(text);
    let mut cards = Vec::new();
    let mut errors = Vec::new();
    let fallback = default_deck.trim();
    let mut deck = if fallback.is_empty() { "Standard".to_owned() } else { fallback.to_owned() };

    #[derive(PartialEq, Eq)]
    enum Mode {
        None,
        Front,
        Back,
    }

    struct Draft {
        front: String,
        back: String,
        deck: String,
        line: usize,
    }

    let mut mode = Mode::None;
    let mut value: Vec<String> = Vec::new();
    let mut draft: Option<Draft> = None;
    let mut line_no = 0;

    let save_value = |mode: &Mode, value: &mut Vec<String>, draft: &mut Option<Draft>| {
        if let Some(d) = draft {
            match mode {
                Mode::Front => {
                    d.front = value.join("\n").trim().to_owned();
                    value.clear();
                }
                Mode::Back => {
                    d.back = value.join("\n").trim().to_owned();
                    value.clear();
                }
                Mode::None => {}
            }
        }
    };

    let save_card = |mode: &mut Mode,
                     value: &mut Vec<String>,
                     draft: &mut Option<Draft>,
                     cards: &mut Vec<PlainCard>,
                     errors: &mut Vec<String>| {
        save_value(mode, value, draft);
        if let Some(d) = draft.take() {
            if d.front.is_empty() || d.back.is_empty() || d.deck.is_empty() {
                errors.push(format!("Zeile {}: Frage, Antwort oder gültiger Stapel fehlt.", d.line));
            } else {
                cards.push(PlainCard { front: d.front, back: d.back, deck: d.deck });
            }
            *mode = Mode::None;
            value.clear();
        }
    };

    fn split_lines_js(s: &str) -> Vec<&str> {
        let mut out = Vec::new();
        let mut start = 0;
        let bytes = s.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'\r' {
                out.push(&s[start..i]);
                if i + 1 < bytes.len() && bytes[i + 1] == b'\n' {
                    i += 1;
                }
                start = i + 1;
            } else if bytes[i] == b'\n' {
                out.push(&s[start..i]);
                start = i + 1;
            }
            i += 1;
        }
        out.push(&s[start..]);
        out
    }

    for raw in split_lines_js(clean) {
        line_no += 1;
        let line = raw.trim();

        if line.len() > 8 && line[..7].eq_ignore_ascii_case("@stapel") && line.as_bytes()[7].is_ascii_whitespace() {
            save_card(&mut mode, &mut value, &mut draft, &mut cards, &mut errors);
            let parts: Vec<&str> = line[7..].split("::").map(str::trim).collect();
            if parts.iter().any(|p| p.is_empty()) {
                deck.clear();
                errors.push(format!("Zeile {line_no}: Ungültiger Stapelpfad."));
            } else {
                deck = parts.join("::");
            }
            continue;
        }

        if line.len() >= 6 && line[..6].eq_ignore_ascii_case("@frage") && line[6..].trim().is_empty() {
            save_card(&mut mode, &mut value, &mut draft, &mut cards, &mut errors);
            draft = Some(Draft { front: String::new(), back: String::new(), deck: deck.clone(), line: line_no });
            mode = Mode::Front;
            continue;
        }

        if line.len() >= 8 && line[..8].eq_ignore_ascii_case("@antwort") && line[8..].trim().is_empty() {
            save_value(&mode, &mut value, &mut draft);
            if draft.is_none() {
                errors.push(format!("Zeile {line_no}: Antwort ohne Frage."));
            } else {
                mode = Mode::Back;
            }
            continue;
        }

        if line.starts_with("---") && line[3..].chars().all(|c| c.is_whitespace()) {
            save_card(&mut mode, &mut value, &mut draft, &mut cards, &mut errors);
            continue;
        }

        if draft.is_some() && mode != Mode::None {
            value.push(text_unescape_line(raw).to_owned());
        }
    }

    save_card(&mut mode, &mut value, &mut draft, &mut cards, &mut errors);

    ParsedCards { cards, errors, format: "Impala-TXT".to_owned() }
}

/// Erkennt, ob Text Impala-TXT-Marker enthält (`@stapel`, `@frage`, `@antwort`).
fn has_card_marker(text: &str) -> bool {
    let mut rest = text;
    while !rest.is_empty() {
        for marker in ["@stapel", "@frage", "@antwort"] {
            if rest.len() >= marker.len() && rest[..marker.len()].eq_ignore_ascii_case(marker) {
                let tail = &rest[marker.len()..];
                match tail.chars().next() {
                    None => return true,
                    Some(c) if !c.is_alphanumeric() && c != '_' => return true,
                    _ => {}
                }
            }
        }
        if let Some(pos) = rest.find('\n') {
            rest = &rest[pos + 1..];
        } else {
            break;
        }
    }
    false
}

/// Erkennt das Dateiformat automatisch und parst die Karten.
pub fn parse_card_text(text: &str, default_deck: &str) -> ParsedCards {
    let clean = text.strip_prefix('\u{FEFF}').unwrap_or(text);
    if has_card_marker(clean) { parse_impala_txt(clean, default_deck) } else { parse_table_cards(clean, default_deck) }
}

/// Eindeutiger Duplikat-Schlüssel einer Karte (`[deck || "Standard", front, back].trim().join("\u001f")`).
pub fn card_key(front: &str, back: &str, deck: &str) -> String {
    let d = if deck.is_empty() { "Standard" } else { deck };
    format!("{}\u{001f}{}\u{001f}{}", d.trim(), front.trim(), back.trim())
}

/// Zählt Duplikate innerhalb der übergebenen Karten und gegenüber bestehenden Schlüsseln.
pub fn duplicate_count(cards: &[PlainCard], mut seen: HashSet<String>) -> usize {
    let mut count = 0;
    for c in cards {
        let key = card_key(&c.front, &c.back, &c.deck);
        if !seen.insert(key) {
            count += 1;
        }
    }
    count
}

fn match_br(s: &str) -> Option<&str> {
    if s.len() < 4 || !s[..3].eq_ignore_ascii_case("<br") {
        return None;
    }
    let mut tail = &s[3..];
    while let Some(c) = tail.chars().next() {
        if c.is_ascii_whitespace() {
            tail = &tail[c.len_utf8()..];
        } else {
            break;
        }
    }
    if let Some(stripped) = tail.strip_prefix('/') {
        tail = stripped;
    }
    while let Some(c) = tail.chars().next() {
        if c.is_ascii_whitespace() {
            tail = &tail[c.len_utf8()..];
        } else {
            break;
        }
    }
    tail.strip_prefix('>')
}

fn match_div_pair(s: &str) -> Option<&str> {
    if s.len() < 6 || !s[..6].eq_ignore_ascii_case("</div>") {
        return None;
    }
    let mut tail = &s[6..];
    while let Some(c) = tail.chars().next() {
        if c.is_ascii_whitespace() {
            tail = &tail[c.len_utf8()..];
        } else {
            break;
        }
    }
    if tail.len() >= 5 && tail[..5].eq_ignore_ascii_case("<div>") { Some(&tail[5..]) } else { None }
}

fn find_closing_tag(s: &str, tag: &str) -> Option<usize> {
    let lower = s.to_ascii_lowercase();
    let needle = format!("</{tag}");
    if let Some(pos) = lower.find(&needle) {
        let after = &lower[pos + needle.len()..];
        if let Some(gt) = after.find('>') {
            return Some(pos + needle.len() + gt + 1);
        }
    }
    None
}

fn decode_html_entity(ent: &str) -> Option<String> {
    match ent {
        "amp" => Some("&".to_string()),
        "lt" => Some("<".to_string()),
        "gt" => Some(">".to_string()),
        "quot" => Some("\"".to_string()),
        "apos" => Some("'".to_string()),
        "nbsp" => Some("\u{00a0}".to_string()),
        "auml" => Some("ä".to_string()),
        "Auml" => Some("Ä".to_string()),
        "ouml" => Some("ö".to_string()),
        "Ouml" => Some("Ö".to_string()),
        "uuml" => Some("ü".to_string()),
        "Uuml" => Some("Ü".to_string()),
        "szlig" => Some("ß".to_string()),
        "euro" => Some("€".to_string()),
        "copy" => Some("©".to_string()),
        "trade" => Some("™".to_string()),
        "reg" => Some("®".to_string()),
        "ndash" => Some("–".to_string()),
        "mdash" => Some("—".to_string()),
        "hellip" => Some("…".to_string()),
        "lsquo" => Some("‘".to_string()),
        "rsquo" => Some("’".to_string()),
        "ldquo" => Some("“".to_string()),
        "rdquo" => Some("”".to_string()),
        "deg" => Some("°".to_string()),
        "plusmn" => Some("±".to_string()),
        "times" => Some("×".to_string()),
        "divide" => Some("÷".to_string()),
        s if s.starts_with('#') => {
            let num = if let Some(hex) = s.strip_prefix("#x").or_else(|| s.strip_prefix("#X")) {
                u32::from_str_radix(hex, 16).ok()
            } else if let Some(dec) = s.strip_prefix('#') {
                dec.parse::<u32>().ok()
            } else {
                None
            };
            num.and_then(char::from_u32).map(|c| c.to_string())
        }
        _ => None,
    }
}

/// HTML aus Anki-Feldern in Klartext umwandeln (wie `stripHtml` in `web/extras.js`).
pub fn strip_html(s: &str) -> String {
    // 1. <br\s*/?> und </div>\s*<div> durch \n ersetzen
    let mut step1 = String::with_capacity(s.len());
    let mut rest = s;
    while !rest.is_empty() {
        if let Some(pos) = rest.find('<') {
            step1.push_str(&rest[..pos]);
            let tail = &rest[pos..];
            if let Some(after) = match_br(tail) {
                step1.push('\n');
                rest = after;
            } else if let Some(after) = match_div_pair(tail) {
                step1.push('\n');
                rest = after;
            } else {
                step1.push('<');
                rest = &tail[1..];
            }
        } else {
            step1.push_str(rest);
            break;
        }
    }

    // 2. HTML-Tags entfernen (<script> / <style> samt Inhalt überspringen) und Entitäten auflösen
    let mut out = String::with_capacity(step1.len());
    let bytes = step1.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] == b'<' {
            let tail = &step1[i + 1..];
            let first_char = tail.chars().next();
            let is_tag = match first_char {
                Some(c) if c.is_ascii_alphabetic() => true,
                Some('/') => tail.chars().nth(1).is_some_and(|c| c.is_ascii_alphabetic()),
                Some('!') | Some('?') => true,
                _ => false,
            };

            if is_tag {
                let tag_name_len = tail
                    .char_indices()
                    .take_while(|(_, c)| c.is_ascii_alphanumeric())
                    .last()
                    .map_or(0, |(idx, c)| idx + c.len_utf8());
                let tag_name = &tail[..tag_name_len];

                if tag_name.eq_ignore_ascii_case("style")
                    && let Some(close_idx) = find_closing_tag(&step1[i..], "style")
                {
                    i += close_idx;
                    continue;
                } else if tag_name.eq_ignore_ascii_case("script")
                    && let Some(close_idx) = find_closing_tag(&step1[i..], "script")
                {
                    i += close_idx;
                    continue;
                }

                i += 1;
                let mut in_quote = None;
                while i < bytes.len() {
                    let b = bytes[i];
                    if let Some(q) = in_quote {
                        if b == q {
                            in_quote = None;
                        }
                    } else if b == b'"' || b == b'\'' {
                        in_quote = Some(b);
                    } else if b == b'>' {
                        i += 1;
                        break;
                    }
                    i += 1;
                }
                continue;
            } else {
                out.push('<');
                i += 1;
                continue;
            }
        } else if bytes[i] == b'&' {
            let tail = &step1[i + 1..];
            let mut semi_pos = None;
            for (offset, ch) in tail.char_indices() {
                if ch == ';' {
                    semi_pos = Some(offset);
                    break;
                }
                if !ch.is_alphanumeric() && ch != '#' || offset > 10 {
                    break;
                }
            }

            if let Some(pos) = semi_pos {
                let ent = &tail[..pos];
                if let Some(decoded) = decode_html_entity(ent) {
                    out.push_str(&decoded);
                    i += 1 + pos + 1;
                    continue;
                }
            }

            out.push('&');
            i += 1;
        } else {
            let ch = step1[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
        }
    }

    out.trim().to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plain_card_lenient_deserialization() {
        let json = serde_json::json!([
            { "front": "Q1", "back": "A1", "deck": null },
            { "front": null, "back": 42, "deck": "Mathe" },
            { "front": "Q3", "back": "A3" }
        ]);
        let cards: Vec<PlainCard> = serde_json::from_value(json).unwrap();
        assert_eq!(cards.len(), 3);
        assert_eq!(cards[0].deck, "");
        assert_eq!(cards[1].front, "");
        assert_eq!(cards[1].back, "42");
        assert_eq!(cards[2].deck, "");
    }

    #[test]
    fn test_parse_table_cards_fallback_deck() {
        let text = "front;back;\nZelle;Mitochondrium;\n";
        let parsed = parse_table_cards(text, "Biologie");
        assert_eq!(parsed.cards.len(), 1);
        assert_eq!(parsed.cards[0].deck, "Biologie");

        let text2 = "front;back;deck\nZelle;Mitochondrium;\n";
        let parsed2 = parse_table_cards(text2, "Standard");
        assert_eq!(parsed2.cards.len(), 1);
        assert_eq!(parsed2.cards[0].deck, "Standard");
    }

    #[test]
    fn test_strip_html_math_inequalities() {
        assert_eq!(strip_html("a < b and c > d"), "a < b and c > d");
        assert_eq!(strip_html("5 < 10"), "5 < 10");
        assert_eq!(strip_html("x <= y & y >= z"), "x <= y & y >= z");
    }

    #[test]
    fn test_strip_html_style_and_script() {
        assert_eq!(strip_html("<style>body { color: red; }</style>Wichtiger Text"), "Wichtiger Text");
        assert_eq!(strip_html("<script>alert('bad');</script>Normaler Text"), "Normaler Text");
    }

    #[test]
    fn test_strip_html_german_entities() {
        assert_eq!(
            strip_html("&auml;pfel, &ouml;l, &uuml;ber, &szlig;, 100 &euro; &ndash; fertig"),
            "äpfel, öl, über, ß, 100 € – fertig"
        );
    }

    #[test]
    fn test_roundtrip_export_import() {
        let cards = vec![
            PlainCard {
                front: "Frage 1\nmit Zeilenumbruch".into(),
                back: "Antwort 1\n---\nmit Trenner".into(),
                deck: "Biologie::Zellbiologie".into(),
            },
            PlainCard {
                front: "@frage mit Formatmarker".into(),
                back: "\\@antwort mit Backslash".into(),
                deck: "Informatik".into(),
            },
        ];
        let txt = export_txt(&cards);
        let parsed = parse_impala_txt(&txt, "Standard");
        assert_eq!(parsed.errors, Vec::<String>::new());
        assert_eq!(parsed.cards, cards);

        let csv = export_csv(&cards);
        let parsed_csv = parse_table_cards(&csv, "Standard");
        assert_eq!(parsed_csv.errors, Vec::<String>::new());
        assert_eq!(parsed_csv.cards, cards);
    }
}
