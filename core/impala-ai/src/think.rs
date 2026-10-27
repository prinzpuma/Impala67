//! Denkprozess-Erkennung für Modelle ohne getrenntes Reasoning (z. B. Gemma):
//! `<think>`-artige Blöcke heraustrennen, ohne Tags eine Heuristik für
//! „Selbstgespräch am Anfang“ (Vorbild: `web/think-heuristik.js`).

use std::sync::LazyLock;

use regex::Regex;

use crate::js;

/// Tags, deren Inhalt nur in die Denk-Box gehört. Gemma nutzt `<thought>`.
pub const THINK_TAGS: [&str; 4] = ["think", "thinking", "thought", "reasoning"];

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Split {
    pub content: String,
    pub reasoning: String,
}

/// Selbstgespräch redet über den Nutzer oder das eigene Vorgehen – alles andere ist Antwort.
/// `\b` wie in JS nur ASCII-Wortgrenzen.
static META: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)(?-u:\b)(the user|they (want|have|are|might|asked)|der nutzer|die nutzerin|i (should|need|must|will|have to|can|could|think|wonder)(?-u:\b)|i'?(ll|m going)(?-u:\b)|let me|let's|ich (sollte|muss|werde|denke|prüfe|schaue|könnte)|lass mich|wait(?-u:\b)|hmm(?-u:\b)|actually(?-u:\b)|perhaps(?-u:\b)|maybe(?-u:\b)|instead(?-u:\b)|my instructions|laut (meiner|den) anweisungen)(?-u:\b)",
    )
    .expect("gültiges Muster")
});
/// Füllwörter am Satzanfang sagen nichts über Denken vs. Antwort.
static NOISE: LazyLock<[Regex; 3]> = LazyLock::new(|| {
    let ws = js::WS_CLASS;
    [
        Regex::new(&format!(r"^[0-9]+[.)]{ws}*")).expect("gültiges Muster"),
        Regex::new(&format!(r"^[-*•]{ws}*")).expect("gültiges Muster"),
        Regex::new(&format!(r"(?i)^(okay|ok|gut|also|alright|so|nun|sure|well)(?:[,!.]|{ws})+"))
            .expect("gültiges Muster"),
    ]
});

fn strip_noise(s: &str) -> String {
    let mut t = js::trim(s).to_owned();
    for re in NOISE.iter() {
        t = re.replace(&t, "").into_owned();
    }
    t
}

fn is_meta(s: &str) -> bool {
    let t = strip_noise(s);
    t.is_empty() || META.is_match(&t)
}

fn is_answer(s: &str) -> bool {
    let t = strip_noise(s);
    js::len16(&t) >= 3 && !META.is_match(&t)
}

/// Satzteile wie `split(/(?<=[.!?])\s+|\n+|(?<=[.!?])(?=[A-ZÄÖÜ])/)` samt `filter(Boolean)`.
fn sentences(text: &str) -> Vec<&str> {
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let end_mark = |i: usize| i > 0 && matches!(chars[i - 1].1, '.' | '!' | '?');
    let byte = |i: usize| chars.get(i).map_or(text.len(), |c| c.0);
    let (mut parts, mut start, mut i) = (Vec::new(), 0usize, 0usize);
    while i < chars.len() {
        let c = chars[i].1;
        let mut end = None;
        if end_mark(i) && js::is_ws(c) {
            let mut j = i;
            while j < chars.len() && js::is_ws(chars[j].1) {
                j += 1;
            }
            end = Some(j);
        } else if c == '\n' {
            let mut j = i;
            while j < chars.len() && chars[j].1 == '\n' {
                j += 1;
            }
            end = Some(j);
        } else if end_mark(i) && (c.is_ascii_uppercase() || matches!(c, 'Ä' | 'Ö' | 'Ü')) && i != start {
            end = Some(i);
        }
        match end {
            Some(j) => {
                parts.push(&text[byte(start)..byte(i)]);
                start = j;
                i = if j > i { j } else { i + 1 };
            }
            None => i += 1,
        }
    }
    parts.push(&text[byte(start)..]);
    parts.into_iter().filter(|p| !p.is_empty()).collect()
}

/// Sieht der Anfang nach Selbstgespräch aus, bleibt alles Denken, bis ein klarer
/// Antwortbeginn erkannt wird (fail closed, auch während des Streamings).
pub fn strip_leaked_reasoning(text: &str) -> Split {
    if text.is_empty() {
        return Split::default();
    }
    // Manche Backends liefern Umbrüche als `<br>`; nur dann für die Erkennung normalisieren.
    static BR: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(&format!(r"(?i)<br{}*/?>", js::WS_CLASS)).expect("gültiges Muster"));
    static NBSP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)&nbsp;").expect("gültiges Muster"));
    let analysis = if BR.is_match(text) || NBSP.is_match(text) {
        NBSP.replace_all(&BR.replace_all(text, "\n"), " ").into_owned()
    } else {
        text.to_owned()
    };
    let parts = sentences(&analysis);
    if parts.is_empty() || !is_meta(parts[0]) {
        return Split { content: text.to_owned(), reasoning: String::new() };
    }
    let Some(answer_start) = (1..parts.len()).find(|&i| is_answer(parts[i])) else {
        return Split { content: String::new(), reasoning: js::trim(&analysis).to_owned() };
    };
    // Schnittstelle im Originaltext suchen, damit die Formatierung der Antwort bleibt.
    let mut cut = 0;
    for part in &parts[..answer_start] {
        if let Some(at) = analysis[cut..].find(part) {
            cut += at + part.len();
        }
    }
    if let Some(at) = analysis[cut..].find(parts[answer_start]) {
        cut += at;
    }
    Split { content: js::trim(&analysis[cut..]).to_owned(), reasoning: js::trim(&analysis[..cut]).to_owned() }
}

/// Erster öffnender Tag ab `from`: (Position, Tag).
fn open_tag(raw: &str, from: usize) -> Option<(usize, &'static str)> {
    let mut at = from;
    while let Some(rel) = raw[at..].find('<') {
        let pos = at + rel;
        if let Some(tag) =
            THINK_TAGS.iter().find(|t| raw[pos + 1..].starts_with(*t) && raw[pos + 1 + t.len()..].starts_with('>'))
        {
            return Some((pos, tag));
        }
        at = pos + 1;
    }
    None
}

/// Tags heraustrennen; ohne Tags optional die Heuristik anwenden.
/// Offener (noch streamender) Denk-Block: Rest komplett als Denkprozess.
pub fn split_think(raw: &str, skip_heuristic: bool) -> Split {
    let (mut content, mut reasoning) = (String::new(), String::new());
    let (mut last, mut search) = (0, 0);
    // Wie `/<(tags)>([\s\S]*?)<\/\1>/g`: ohne passenden Schluss-Tag weiter beim nächsten Zeichen.
    while let Some((pos, tag)) = open_tag(raw, search) {
        let inner = pos + tag.len() + 2;
        let close = format!("</{tag}>");
        match raw[inner..].find(&close) {
            Some(rel) => {
                reasoning.push_str(&raw[inner..inner + rel]);
                content.push_str(&raw[last..pos]);
                last = inner + rel + close.len();
                search = last;
            }
            None => search = pos + 1,
        }
    }
    content.push_str(&raw[last..]);
    if let Some((pos, tag)) = open_tag(&content, 0) {
        reasoning.push_str(&content[pos + tag.len() + 2..]);
        content.truncate(pos);
    }
    if reasoning.is_empty() && !skip_heuristic {
        let leaked = strip_leaked_reasoning(&content);
        content = leaked.content;
        reasoning = leaked.reasoning;
    }
    Split { content: js::trim(&content).to_owned(), reasoning: js::trim(&reasoning).to_owned() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tags_und_offener_block() {
        assert_eq!(
            split_think("<think>a</think>Antwort", false),
            Split { content: "Antwort".into(), reasoning: "a".into() }
        );
        assert_eq!(
            split_think("Hallo <thought>noch", true),
            Split { content: "Hallo".into(), reasoning: "noch".into() }
        );
        assert_eq!(split_think("<think>x</thought>", true).reasoning, "x</thought>");
    }

    #[test]
    fn heuristik() {
        let s = split_think("The user wants a list. Here it is:\n- eins", false);
        assert_eq!(s.reasoning, "The user wants a list.");
        assert_eq!(s.content, "Here it is:\n- eins");
        assert_eq!(sentences("a.B c"), vec!["a.", "B c"]);
        assert_eq!(sentences("Ende. \n\nNeu"), vec!["Ende.", "Neu"]);
    }
}
