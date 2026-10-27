//! Großes Wörterbuch (`web/handwriting-lexicon-de.txt`, ein Wort je Zeile, klein, sortiert). Jedes Wort einer
//! Zeile wird ein zweites Mal gelesen, diesmal nur entlang echter Wörter (CTC-Suche durch das Wörterbuch,
//! deutsche Endungen erlaubt). Die Wörterbuch-Lesung ersetzt die freie, solange das Modell sie nicht viel
//! unwahrscheinlicher findet ("Veranfworturng" → "Verantwortung"). Verhalten wie `web/handwriting-lexicon.js`.
//!
//! Speicher: der sortierte Text plus Wortanfänge; ein Knoten des gedachten Präfixbaums ist der Bereich aller
//! Wörter mit gemeinsamem Anfang (Binärsuche je Byte, UTF-8-Byte-Reihenfolge = Zeichen-Reihenfolge).

use std::collections::HashMap;

use crate::vocab::{self, BLANK, CLASSES};

/// Vorsprung (log-Wahrscheinlichkeit) der Wörterbuch-Lesung (Okt. 2026 auf Heft-Mitschriften und ScaDS am besten).
const BONUS: f64 = 12.0;
const BEAM_WIDTH: usize = 16;
/// log(1e-4): seltenere Zeichen je Schritt gar nicht erst verfolgen.
const MIN_LOG_PROB: f64 = -9.210340371976182;
/// Fehlende Beugungsformen ("pflegerische"): an jedes Wort darf eine dieser Endungen. Jeder Anfang einer
/// Endung ist selbst eine Endung, darum genügt der Index als Zustand.
const ENDINGS: [&str; 7] = ["e", "en", "er", "es", "em", "n", "s"];

pub struct Lexicon {
    text: String,
    /// Anfang jedes Worts; letzter Eintrag = Textlänge + 1
    starts: Vec<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Node {
    /// Wörter `[lo, hi)` mit gemeinsamem Anfang der Länge `depth` (Bytes)
    Range { lo: u32, hi: u32, depth: u32 },
    /// Endung hinter einem fertigen Wort
    Ending(u8),
}

impl Lexicon {
    /// Liest die Wortliste. Unsortierte Listen werden sortiert (das JS setzt die Sortierung stillschweigend voraus),
    /// Leerzeilen und `\r` fallen weg.
    pub fn new(list: &str) -> Self {
        let mut words: Vec<&str> =
            list.split('\n').map(|w| w.strip_suffix('\r').unwrap_or(w)).filter(|w| !w.is_empty()).collect();
        if !words.is_sorted() {
            words.sort_unstable();
        }
        words.dedup();
        let mut text = String::with_capacity(list.len());
        let mut starts = Vec::with_capacity(words.len() + 1);
        for w in &words {
            starts.push(text.len() as u32);
            text.push_str(w);
            text.push('\n');
        }
        starts.push(text.len() as u32);
        Lexicon { text, starts }
    }

    pub fn len(&self) -> usize {
        self.starts.len() - 1
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn root(&self) -> Node {
        Node::Range { lo: 0, hi: self.len() as u32, depth: 0 }
    }

    /// Byte `d` von Wort `i`, `None` hinter dem Wortende (kürzere Wörter sortieren vor ihre Verlängerungen)
    fn key(&self, i: u32, d: u32) -> Option<u8> {
        let (start, end) = (self.starts[i as usize], self.starts[i as usize + 1] - 1);
        (d < end - start).then(|| self.text.as_bytes()[(start + d) as usize])
    }

    /// Erstes Wort in `[lo, hi)`, dessen Byte `d` nicht kleiner als `key` ist
    fn lower_bound(&self, mut lo: u32, mut hi: u32, d: u32, key: Option<u8>) -> u32 {
        while lo < hi {
            let mid = (lo + hi) / 2;
            if self.key(mid, d) < key {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        lo
    }

    fn child_byte(&self, lo: u32, hi: u32, depth: u32, byte: u8) -> Option<(u32, u32)> {
        let lo = self.lower_bound(lo, hi, depth, Some(byte));
        if lo >= hi || self.key(lo, depth) != Some(byte) {
            return None;
        }
        let hi = match byte.checked_add(1) {
            Some(b) => self.lower_bound(lo, hi, depth, Some(b)),
            None => hi,
        };
        Some((lo, hi))
    }

    fn child(&self, node: Node, ch: char) -> Option<Node> {
        let Node::Range { mut lo, mut hi, mut depth } = node else { return None };
        let mut buf = [0u8; 4];
        for &b in ch.encode_utf8(&mut buf).as_bytes() {
            (lo, hi) = self.child_byte(lo, hi, depth, b)?;
            depth += 1;
        }
        Some(Node::Range { lo, hi, depth })
    }

    fn is_word(&self, node: Node) -> bool {
        match node {
            Node::Range { lo, hi, depth } => lo < hi && self.key(lo, depth).is_none(),
            Node::Ending(_) => true,
        }
    }

    /// Steht das (klein geschriebene) Wort im Wörterbuch?
    pub fn contains(&self, word: &str) -> bool {
        let mut node = self.root();
        for ch in word.chars() {
            match self.child(node, ch) {
                Some(n) => node = n,
                None => return false,
            }
        }
        self.is_word(node)
    }

    /// Nächster Knoten; hinter einem fertigen Wort ohne Fortsetzung beginnt eine Endung.
    fn next_node(&self, node: Node, ch: char) -> Option<Node> {
        let ending = |s: &str| ENDINGS.iter().position(|e| *e == s).map(|i| Node::Ending(i as u8));
        match node {
            Node::Ending(i) => ending(&format!("{}{ch}", ENDINGS[i as usize])),
            Node::Range { .. } => match self.child(node, ch) {
                Some(next) => Some(next),
                None if self.is_word(node) => ending(ch.encode_utf8(&mut [0; 4])),
                None => None,
            },
        }
    }

    /// Ersetzt die freie Lesung `raw` eines Wortabschnitts (`probs`: Softmax je Zeitschritt) durch die
    /// wahrscheinlichste Wörterbuch-Lesung. Bekannte Wörter, Abkürzungen (GPU, "M.") und Zahlen bleiben.
    pub(crate) fn correct<'a>(&self, raw: &str, probs: impl Iterator<Item = &'a [f32]>) -> String {
        let core = raw.trim_matches(|c: char| !c.is_alphabetic());
        if core.chars().count() < 2
            || raw.chars().any(|c| c.is_ascii_digit())
            || core.to_uppercase() == core
            || self.contains(&core.to_lowercase())
        {
            return raw.to_string();
        }
        // Wie im JS: log der f32-Wahrscheinlichkeiten, wieder als f32
        let log_probs: Vec<[f32; CLASSES]> =
            probs.map(|row| std::array::from_fn(|c| (row[c] as f64).ln() as f32)).collect();
        match self.search_word(&log_probs) {
            Some(best) if best.letters >= 2 && best.score + BONUS >= ctc_score(&log_probs, raw) => best.text,
            _ => raw.to_string(),
        }
    }

    /// CTC-Prefix-Beam-Search, die nur Wörterbuch-Wörter zulässt (Satzzeichen davor und danach erlaubt).
    /// Großbuchstabe nur am Wortanfang.
    fn search_word(&self, log_probs: &[[f32; CLASSES]]) -> Option<Found> {
        let kinds: [Option<Kind>; CLASSES] = std::array::from_fn(|c| vocab::char_of(c).and_then(Kind::of));
        let root = self.root();
        let mut beams = vec![WordBeam {
            text: String::new(),
            last: None,
            pb: 0.0,
            pnb: f64::NEG_INFINITY,
            phase: Phase::Before,
            node: root,
            letters: 0,
        }];
        for lp in log_probs {
            let mut next: Vec<WordBeam> = Vec::new();
            let mut index: HashMap<String, usize> = HashMap::new();
            let mut entry = |next: &mut Vec<WordBeam>, parent: &WordBeam, ext: Option<(usize, Phase, Node)>| {
                let text = match ext.and_then(|(c, ..)| vocab::char_of(c)) {
                    Some(ch) => format!("{}{ch}", parent.text),
                    None => parent.text.clone(),
                };
                if let Some(&i) = index.get(&text) {
                    return i;
                }
                let beam = match ext {
                    None => WordBeam { pb: f64::NEG_INFINITY, pnb: f64::NEG_INFINITY, ..parent.clone() },
                    Some((c, phase, node)) => WordBeam {
                        text: text.clone(),
                        last: Some(c),
                        pb: f64::NEG_INFINITY,
                        pnb: f64::NEG_INFINITY,
                        phase,
                        node,
                        letters: parent.letters + (phase == Phase::Inside) as u32,
                    },
                };
                next.push(beam);
                index.insert(text, next.len() - 1);
                next.len() - 1
            };
            let cands: Vec<(usize, Kind)> = (0..CLASSES)
                .filter(|&c| c != BLANK && lp[c] as f64 >= MIN_LOG_PROB)
                .filter_map(|c| kinds[c].map(|k| (c, k)))
                .collect();
            for b in &beams {
                let total = log_add(b.pb, b.pnb);
                let same = entry(&mut next, b, None);
                next[same].pb = log_add(next[same].pb, total + lp[BLANK] as f64);
                if let Some(last) = b.last {
                    next[same].pnb = log_add(next[same].pnb, b.pnb + lp[last] as f64);
                }
                for &(c, kind) in &cands {
                    let (phase, node) = match kind {
                        Kind::Punct => match b.phase {
                            Phase::Inside if !self.is_word(b.node) => continue,
                            Phase::Inside => (Phase::After, b.node),
                            phase => (phase, b.node),
                        },
                        Kind::Letter { upper, lower } => {
                            if b.phase == Phase::After || (b.phase == Phase::Inside && upper) {
                                continue;
                            }
                            let from = if b.phase == Phase::Before { root } else { b.node };
                            match self.next_node(from, lower) {
                                Some(node) => (Phase::Inside, node),
                                None => continue,
                            }
                        }
                    };
                    let ext = entry(&mut next, b, Some((c, phase, node)));
                    let base = if Some(c) == b.last { b.pb } else { total };
                    next[ext].pnb = log_add(next[ext].pnb, base + lp[c] as f64);
                }
            }
            let mut scored: Vec<(f64, WordBeam)> = next.into_iter().map(|b| (log_add(b.pb, b.pnb), b)).collect();
            scored.sort_by(|x, y| y.0.partial_cmp(&x.0).unwrap_or(std::cmp::Ordering::Equal));
            scored.truncate(BEAM_WIDTH);
            beams = scored.into_iter().map(|(_, b)| b).collect();
        }
        let mut best: Option<Found> = None;
        for b in beams {
            if b.phase == Phase::Before || (b.phase == Phase::Inside && !self.is_word(b.node)) {
                continue;
            }
            let score = log_add(b.pb, b.pnb);
            if best.as_ref().is_none_or(|f| score > f.score) {
                best = Some(Found { text: b.text, score, letters: b.letters });
            }
        }
        best
    }
}

struct Found {
    text: String,
    score: f64,
    letters: u32,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    /// Satzzeichen vor dem Wort
    Before,
    Inside,
    /// Satzzeichen danach
    After,
}

#[derive(Clone, Copy)]
enum Kind {
    Punct,
    Letter { upper: bool, lower: char },
}

impl Kind {
    fn of(ch: char) -> Option<Kind> {
        if vocab::is_word_punct(ch) {
            return Some(Kind::Punct);
        }
        if !ch.is_alphabetic() {
            return None;
        }
        let mut lower = ch.to_lowercase();
        let first = lower.next()?;
        Some(Kind::Letter { upper: first != ch || lower.next().is_some(), lower: first })
    }
}

#[derive(Clone)]
struct WordBeam {
    text: String,
    last: Option<usize>,
    pb: f64,
    pnb: f64,
    phase: Phase,
    node: Node,
    letters: u32,
}

fn log_add(a: f64, b: f64) -> f64 {
    if a == f64::NEG_INFINITY {
        return b;
    }
    if b == f64::NEG_INFINITY {
        return a;
    }
    a.max(b) + (-(a - b).abs()).exp().ln_1p()
}

/// log P(text | Zeitschritte) nach CTC (Summe über alle Ausrichtungen).
fn ctc_score(log_probs: &[[f32; CLASSES]], text: &str) -> f64 {
    let Some(labels) = text.chars().map(vocab::class_of).collect::<Option<Vec<usize>>>() else {
        return f64::NEG_INFINITY;
    };
    let Some(first) = log_probs.first() else { return f64::NEG_INFINITY };
    let s_len = 2 * labels.len() + 1;
    let ext: Vec<usize> = (0..s_len).map(|s| if s % 2 == 1 { labels[(s - 1) / 2] } else { BLANK }).collect();
    let mut alpha = vec![f64::NEG_INFINITY; s_len];
    alpha[0] = first[BLANK] as f64;
    if s_len > 1 {
        alpha[1] = first[ext[1]] as f64;
    }
    let mut next = vec![f64::NEG_INFINITY; s_len];
    for lp in &log_probs[1..] {
        for s in 0..s_len {
            let mut v = alpha[s];
            if s > 0 {
                v = log_add(v, alpha[s - 1]);
            }
            if s > 1 && ext[s] != BLANK && ext[s] != ext[s - 2] {
                v = log_add(v, alpha[s - 2]);
            }
            next[s] = v + lp[ext[s]] as f64;
        }
        std::mem::swap(&mut alpha, &mut next);
    }
    if s_len > 1 { log_add(alpha[s_len - 1], alpha[s_len - 2]) } else { alpha[0] }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suche_im_wortbaum() {
        let lex = Lexicon::new("haus\nhaus\nhausboot\nhäuser\nmaus\n");
        assert_eq!(lex.len(), 4);
        assert!(lex.contains("haus") && lex.contains("hausboot") && lex.contains("häuser"));
        assert!(!lex.contains("hau") && !lex.contains("hausb") && !lex.contains(""));
        // unsortiert: wird sortiert
        let lex = Lexicon::new("zebra\r\naffe\r\n");
        assert!(lex.contains("affe") && lex.contains("zebra"));
    }

    #[test]
    fn endungen() {
        let lex = Lexicon::new("haus\nhausboot\n");
        let haus = "haus".chars().try_fold(lex.root(), |n, c| lex.next_node(n, c)).unwrap();
        // "haus" hat eine Fortsetzung mit "b", Endungen nur ohne Fortsetzung
        assert!(lex.next_node(haus, 'e').is_some_and(|n| lex.is_word(n)));
        let en = lex.next_node(lex.next_node(haus, 'e').unwrap(), 'n').unwrap();
        assert!(lex.is_word(en) && lex.next_node(en, 's').is_none());
        assert!(lex.next_node(haus, 'x').is_none());
    }
}
