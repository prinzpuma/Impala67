//! CTC-Dekodierung einer Zeile: Softmax, Greedy-Lesung (Konfidenz je Zeichen), Prefix-Beam-Search mit
//! Wörterbuch-Bonus und Wortkorrektur. Verhalten wie `web/handwriting-ctc.js`.
//!
//! Eingabe ist immer eine ganze Logit-Matrix (`steps × CLASSES`, zeilenweise) – ein grober Aufruf je Zeile,
//! passend für WASM (ein `Float32Array`) und UniFFI.

use std::collections::HashMap;

use crate::InkError;
use crate::lexicon::Lexicon;
use crate::vocab::{self, BLANK, CLASSES, SPACE};
use crate::words::{is_known_word, words};

/// Wörter, deren unsicherstes Zeichen darüber liegt, gelten als sicher erkannt (nicht korrigieren).
const CORRECT_BELOW_CONFIDENCE: f32 = 0.7;
const BEAM_WIDTH: usize = 10;
/// Bonus (log-Wahrscheinlichkeit) je fertigem Wort aus dem kleinen Wörterbuch.
const WORD_BONUS: f64 = 1.5;
/// Seltenere Zeichen je Schritt gar nicht erst verfolgen.
const MIN_STEP_PROB: f64 = 1e-3;

/// Lesart einer Zeile.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Mode {
    /// Die ungesperrte Lesung entscheidet, ob die Zeile eine Formel ist.
    #[default]
    Auto,
    /// Fließtext: Mathezeichen gesperrt, Beam-Search mit Wörterbuch.
    Text,
    /// Formel: Mathezeichen erlaubt, Greedy-Lesung.
    Math,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DecodeOptions {
    pub mode: Mode,
    /// Ab dieser mittleren Zeichen-Konfidenz gilt eine Zeile als erkannt.
    pub threshold: f64,
}

impl Default for DecodeOptions {
    fn default() -> Self {
        Self { mode: Mode::Auto, threshold: 0.8 }
    }
}

/// Ergebnis einer Zeile.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    /// Kein Text.
    Empty,
    /// Kauderwelsch: wohl eine Zeichnung.
    Drawing,
    /// Text, aber unter der Konfidenz-Schwelle.
    Uncertain,
    Recognized,
}

impl Status {
    /// Name wie im JS (`status`).
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Empty => "empty",
            Status::Drawing => "drawing",
            Status::Uncertain => "uncertain",
            Status::Recognized => "recognized",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct LineDecoding {
    pub text: String,
    /// Greedy-Lesung ohne Bereinigung.
    pub raw_text: String,
    /// Mittel der Zeichen-Konfidenzen, auf 3 Stellen gerundet.
    pub confidence: f64,
    pub status: Status,
    /// Anteil der Blank-Schritte, auf 3 Stellen gerundet.
    pub blank_ratio: f64,
    /// Höchste Wahrscheinlichkeit je Zeichen der Greedy-Lesung.
    pub char_confidences: Vec<f32>,
}

/// Prüft die Form einer Logit-Matrix und liefert die Zahl der Zeitschritte.
pub fn steps_of(logits: &[f32], classes: usize) -> Result<usize, InkError> {
    if classes != CLASSES || !logits.len().is_multiple_of(classes) {
        return Err(InkError::Shape { len: logits.len(), classes });
    }
    Ok(logits.len() / classes)
}

/// Dekodiert die Logits einer Zeile (`steps × classes`, zeilenweise).
pub fn decode_line(
    logits: &[f32],
    classes: usize,
    options: &DecodeOptions,
    lexicon: Option<&Lexicon>,
) -> Result<LineDecoding, InkError> {
    let steps = steps_of(logits, classes)?;
    Ok(match options.mode {
        _ if steps == 0 => LineDecoding {
            text: String::new(),
            raw_text: String::new(),
            confidence: 0.0,
            status: Status::Empty,
            blank_ratio: 1.0,
            char_confidences: Vec::new(),
        },
        Mode::Auto => {
            let math = decode_mode(logits, steps, Mode::Math, options.threshold, lexicon);
            if is_formula(&math.raw_text) {
                math
            } else {
                decode_mode(logits, steps, Mode::Text, options.threshold, lexicon)
            }
        }
        mode => decode_mode(logits, steps, mode, options.threshold, lexicon),
    })
}

/// Formel statt Fließtext: ein "=" oder ein Mathezeichen, auf das noch etwas folgt (x^2, ∫2x).
fn is_formula(raw: &str) -> bool {
    let chars: Vec<char> = raw.chars().collect();
    raw.contains('=')
        || chars.windows(2).any(|w| {
            matches!(w[0], '^' | '_' | '{' | '}' | '<' | '>' | '~' | '√' | '∫' | '∑' | 'π' | 'λ' | 'α' | 'β')
                && !w[1].is_whitespace()
        })
}

fn decode_mode(logits: &[f32], steps: usize, mode: Mode, threshold: f64, lexicon: Option<&Lexicon>) -> LineDecoding {
    let text_mode = mode == Mode::Text;
    let probs = Probs::softmax(logits, steps, text_mode);

    // Greedy: Läufe gleicher Klassen zusammenfassen, Blanks trennen
    let mut blanks = 0usize;
    let mut raw_text = String::new();
    let mut char_confidences = Vec::new();
    let mut run: Option<(usize, f32)> = None;
    for t in 0..steps {
        let (best, p) = argmax(probs.row(t));
        if best == BLANK {
            blanks += 1;
            if let Some((c, conf)) = run.take() {
                raw_text.extend(vocab::char_of(c));
                char_confidences.push(conf);
            }
        } else {
            match &mut run {
                Some((c, conf)) if *c == best => *conf = conf.max(p),
                _ => {
                    if let Some((c, conf)) = run.replace((best, p)) {
                        raw_text.extend(vocab::char_of(c));
                        char_confidences.push(conf);
                    }
                }
            }
        }
    }
    if let Some((c, conf)) = run {
        raw_text.extend(vocab::char_of(c));
        char_confidences.push(conf);
    }

    let text = if text_mode {
        decode_text(&probs, lexicon)
    } else {
        clean_transcription(&raw_text, mode, Some(&char_confidences), true)
    };

    let confidence = if char_confidences.is_empty() {
        0.0
    } else {
        char_confidences.iter().map(|&c| c as f64).sum::<f64>() / char_confidences.len() as f64
    };
    let len = text.chars().count();
    let status = if len == 0 {
        Status::Empty
    } else if confidence < 0.45 || (len <= 2 && confidence < 0.60) {
        // Seit der Median-Normalisierung liefert auch saubere Schrift ~97 % Blank-Schritte:
        // blank_ratio taugt nicht als Zeichnungs-Merkmal.
        Status::Drawing
    } else if confidence < threshold {
        Status::Uncertain
    } else {
        Status::Recognized
    };
    LineDecoding {
        text,
        raw_text,
        confidence: round3(confidence),
        status,
        blank_ratio: round3(blanks as f64 / steps.max(1) as f64),
        char_confidences,
    }
}

fn round3(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}

/// Softmax je Zeitschritt (f32 wie `Float32Array` im JS).
pub(crate) struct Probs {
    data: Vec<f32>,
    steps: usize,
}

impl Probs {
    fn softmax(logits: &[f32], steps: usize, mask_math: bool) -> Self {
        let mut data = Vec::with_capacity(steps * CLASSES);
        let mut exp = [0f64; CLASSES];
        for row in logits.chunks_exact(CLASSES) {
            let masked = |c: usize| mask_math && vocab::char_of(c).is_some_and(vocab::is_math_char);
            let max = (0..CLASSES).filter(|&c| !masked(c)).map(|c| row[c]).fold(f32::NEG_INFINITY, f32::max) as f64;
            let mut sum = 0.0;
            for c in 0..CLASSES {
                // Wie im JS: exp in f64, als f32 gespeichert, Summe über die ungerundeten Werte
                let e = if masked(c) { 0.0 } else { (row[c] as f64 - max).exp() };
                exp[c] = e as f32 as f64;
                sum += e;
            }
            let inv = if sum > 0.0 { 1.0 / sum } else { 1.0 };
            data.extend(exp.iter().map(|&e| (e * inv) as f32));
        }
        Probs { data, steps }
    }

    pub(crate) fn row(&self, t: usize) -> &[f32] {
        &self.data[t * CLASSES..(t + 1) * CLASSES]
    }

    pub(crate) fn rows(&self, from: usize, to: usize) -> impl ExactSizeIterator<Item = &[f32]> {
        self.data[from * CLASSES..to * CLASSES].chunks_exact(CLASSES)
    }
}

/// Erster Index mit dem größten Wert.
fn argmax(row: &[f32]) -> (usize, f32) {
    let mut best = (0, row[0]);
    for (c, &v) in row.iter().enumerate().skip(1) {
        if v > best.1 {
            best = (c, v);
        }
    }
    best
}

/// Beam-Search; mit großem Wörterbuch wird zusätzlich jedes Wort (Abschnitt zwischen Leerzeichen-Schritten)
/// entlang echter Wörter gelesen.
fn decode_text(probs: &Probs, lexicon: Option<&Lexicon>) -> String {
    let clean =
        |from: usize, to: usize| clean_transcription(&beam_search(probs.rows(from, to)), Mode::Text, None, false);
    let Some(lexicon) = lexicon else { return clean(0, probs.steps) };
    let mut words = Vec::new();
    let mut start = 0;
    for t in 0..=probs.steps {
        if t < probs.steps && argmax(probs.row(t)).0 != SPACE {
            continue;
        }
        if t > start {
            let raw = clean(start, t);
            if !raw.is_empty() {
                words.push(lexicon.correct(&raw, probs.rows(start, t)));
            }
        }
        start = t + 1;
    }
    words.join(" ")
}

fn log_add(a: f64, b: f64) -> f64 {
    if a == f64::NEG_INFINITY {
        return b;
    }
    if b == f64::NEG_INFINITY {
        return a;
    }
    let m = a.max(b);
    m + ((a - m).exp() + (b - m).exp()).ln()
}

#[derive(Clone)]
struct Beam {
    text: String,
    last: Option<usize>,
    pb: f64,
    pnb: f64,
    /// Fertige bekannte Wörter vor `word_start`
    known: u32,
    /// Byte-Anfang des laufenden Worts
    word_start: usize,
}

/// CTC-Prefix-Beam-Search: verfolgt mehrere Lesarten und bevorzugt die, deren Wörter im Wörterbuch stehen
/// ("läuft" statt "läutt").
fn beam_search<'a>(rows: impl Iterator<Item = &'a [f32]>) -> String {
    let score = |b: &Beam| {
        let open = is_known_word(&b.text[b.word_start..]) as u32;
        log_add(b.pb, b.pnb) + WORD_BONUS * (b.known + open) as f64
    };
    let mut beams =
        vec![Beam { text: String::new(), last: None, pb: 0.0, pnb: f64::NEG_INFINITY, known: 0, word_start: 0 }];
    for probs in rows {
        // Reihenfolge des Einfügens zählt bei Gleichstand (wie die Map im JS)
        let mut next: Vec<Beam> = Vec::new();
        let mut index: HashMap<String, usize> = HashMap::new();
        let mut entry = |next: &mut Vec<Beam>, parent: &Beam, c: Option<usize>| -> usize {
            let text = match c.and_then(vocab::char_of) {
                Some(ch) => {
                    let mut t = String::with_capacity(parent.text.len() + ch.len_utf8());
                    t.push_str(&parent.text);
                    t.push(ch);
                    t
                }
                None => parent.text.clone(),
            };
            if let Some(&i) = index.get(&text) {
                return i;
            }
            let beam = match c {
                None => Beam { pb: f64::NEG_INFINITY, pnb: f64::NEG_INFINITY, ..parent.clone() },
                Some(c) => {
                    let space = vocab::char_of(c).is_some_and(char::is_whitespace);
                    let finished = space && is_known_word(&parent.text[parent.word_start..]);
                    Beam {
                        word_start: if space { text.len() } else { parent.word_start },
                        text: text.clone(),
                        last: Some(c),
                        pb: f64::NEG_INFINITY,
                        pnb: f64::NEG_INFINITY,
                        known: parent.known + finished as u32,
                    }
                }
            };
            next.push(beam);
            index.insert(text, next.len() - 1);
            next.len() - 1
        };
        let cands: Vec<usize> = (0..CLASSES).filter(|&c| c != BLANK && probs[c] as f64 >= MIN_STEP_PROB).collect();
        let lp_blank = (probs[BLANK] as f64).max(1e-12).ln();
        for b in &beams {
            let total = log_add(b.pb, b.pnb);
            let same = entry(&mut next, b, None);
            next[same].pb = log_add(next[same].pb, total + lp_blank);
            for &c in &cands {
                let lp = (probs[c] as f64).ln();
                if Some(c) == b.last {
                    // Wiederholung ohne Blank bleibt ein Zeichen, mit Blank dazwischen wird es doppelt
                    next[same].pnb = log_add(next[same].pnb, b.pnb + lp);
                    let ext = entry(&mut next, b, Some(c));
                    next[ext].pnb = log_add(next[ext].pnb, b.pb + lp);
                } else {
                    let ext = entry(&mut next, b, Some(c));
                    next[ext].pnb = log_add(next[ext].pnb, total + lp);
                }
            }
        }
        let mut scored: Vec<(f64, Beam)> = next.into_iter().map(|b| (score(&b), b)).collect();
        scored.sort_by(|x, y| y.0.partial_cmp(&x.0).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(BEAM_WIDTH);
        beams = scored.into_iter().map(|(_, b)| b).collect();
    }
    // Erster mit der höchsten Wertung (Liste ist absteigend sortiert)
    let mut best: Option<(f64, &Beam)> = None;
    for b in &beams {
        let s = score(b);
        if best.is_none_or(|(bs, _)| s > bs) {
            best = Some((s, b));
        }
    }
    best.map(|(_, b)| b.text.clone()).unwrap_or_default()
}

/// Leere Spaltenbereiche `[von, bis)` des Zeilenbilds sind Wortgrenzen, auch wo das Modell kein Leerzeichen
/// liest (in Formel-Zeilen lässt es sie fast immer weg). Erzwingt in der Mitte jeder Lücke ohne Leerzeichen eins.
pub fn mark_gap_spaces(
    logits: &mut [f32],
    classes: usize,
    gaps: &[(usize, usize)],
    image_width: usize,
) -> Result<(), InkError> {
    let steps = steps_of(logits, classes)?;
    if steps == 0 || image_width == 0 {
        return Ok(());
    }
    let per_column = steps as f64 / image_width as f64;
    let step = |x: f64| ((x * per_column).floor() as usize).min(steps - 1);
    let row = |t: usize| t * CLASSES..(t + 1) * CLASSES;
    for &(from, to) in gaps {
        let has_space = (step(from as f64)..=step(to as f64 - 1.0)).any(|t| argmax(&logits[row(t)]).0 == SPACE);
        if has_space {
            continue;
        }
        let r = &mut logits[row(step((from + to) as f64 / 2.0))];
        r[SPACE] = argmax(r).1 + 2.0;
    }
    Ok(())
}

/// Bereinigt eine Lesung: Mathezeichen außerhalb von Formeln entfernen, Leerraum vereinheitlichen und
/// (`correct`) unsichere Wörter über das kleine Wörterbuch korrigieren. `confidences` (1:1 zu den Zeichen):
/// ein Wort wird nur korrigiert, wenn das Modell bei mindestens einem seiner Zeichen unsicher war.
pub fn clean_transcription(text: &str, mode: Mode, confidences: Option<&[f32]>, correct: bool) -> String {
    let chars: Vec<char> = text.chars().collect();
    let confs = confidences.filter(|c| c.len() == chars.len());
    let mut out: Vec<String> = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_whitespace() {
            i += 1;
            continue;
        }
        let start = i;
        while i < chars.len() && !chars[i].is_whitespace() {
            i += 1;
        }
        let mut word: String = chars[start..i].iter().collect();
        if mode != Mode::Math {
            // Schutz gegen angehängte oder fehldekodierte Mathezeichen ("Handbreit√")
            word.retain(|c| !vocab::is_math_char(c));
            if word.is_empty() {
                continue;
            }
        }
        let min_conf = confs.map_or(0.0, |c| c[start..i].iter().copied().fold(f32::INFINITY, f32::min));
        out.push(if correct && min_conf < CORRECT_BELOW_CONFIDENCE { correct_word(&word, mode) } else { word });
    }
    out.join(" ")
}

/// Korrigiert ein Wort mit höchstens einem Fehler zu einem eindeutig nächsten Wort des kleinen Wörterbuchs.
/// Kurze Wörter, Abkürzungen in Großbuchstaben, Zahlen und Formelteile bleiben.
pub fn correct_word(raw: &str, mode: Mode) -> String {
    let unchanged = || raw.to_string();
    if raw.chars().count() < 4 {
        return unchanged();
    }
    // Wie /^[\d\W]+$/: kein ASCII-Buchstabe und kein "_"
    if !raw.chars().any(|c| c.is_ascii_alphabetic() || c == '_') {
        return unchanged();
    }
    let formula: &[char] = if mode == Mode::Math {
        &['=', '+', '-', '*', '/', '^', '_', '{', '}', '(', ')', '\\']
    } else {
        &['=', '+', '-', '*', '/']
    };
    if raw.contains(formula) {
        return unchanged();
    }

    // Satzzeichen am Rand abtrennen
    let is_ln = |c: char| c.is_alphanumeric();
    let Some(first) = raw.find(is_ln) else { return unchanged() };
    let last = raw.rfind(is_ln).map_or(raw.len(), |i| i + raw[i..].chars().next().map_or(0, char::len_utf8));
    let (prefix, core, suffix) = (&raw[..first], &raw[first..last], &raw[last..]);
    let core_len = core.chars().count();
    if core_len < 4 || core.to_uppercase() == core {
        return unchanged();
    }
    let lower = core.to_lowercase();
    let words = words();
    if words.contains(&lower) {
        return unchanged();
    }
    // Höchstens 1 Fehler: bei 2 kippen echte Wörter außerhalb der Liste (teilen -> zeilen)
    let lower_chars: Vec<char> = lower.chars().collect();
    let mut best: Option<&str> = None;
    let mut best_dist = usize::MAX;
    let mut tie = false;
    for (word, chars) in words.iter() {
        if chars.len().abs_diff(lower_chars.len()) > 1 {
            continue;
        }
        let dist = levenshtein_chars(&lower_chars, chars);
        if dist <= 1 {
            if dist < best_dist {
                best_dist = dist;
                best = Some(word);
                tie = false;
            } else if dist == best_dist {
                tie = true;
            }
        }
    }
    // Nur bei eindeutigem Treffer; Großschreibung des Originals beibehalten
    match best {
        Some(word) if !tie => {
            let capital = core.chars().next().is_some_and(|c| c.to_uppercase().eq(std::iter::once(c)));
            let corrected = if capital {
                let mut cs = word.chars();
                cs.next().map(|c| c.to_uppercase().chain(cs).collect()).unwrap_or_default()
            } else {
                word.to_string()
            };
            format!("{prefix}{corrected}{suffix}")
        }
        _ => unchanged(),
    }
}

/// Levenshtein-Distanz je Zeichen.
pub fn levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    levenshtein_chars(&a, &b)
}

fn levenshtein_chars(a: &[char], b: &[char]) -> usize {
    if a == b {
        return 0;
    }
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for i in 1..=a.len() {
        let mut prev = i;
        for j in 1..=b.len() {
            let val = if a[i - 1] == b[j - 1] { row[j - 1] } else { row[j - 1].min(prev).min(row[j]) + 1 };
            row[j - 1] = prev;
            prev = val;
        }
        row[b.len()] = prev;
    }
    row[b.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levenshtein_grundfaelle() {
        assert_eq!(levenshtein("", "abc"), 3);
        assert_eq!(levenshtein("kitten", "sitting"), 3);
        assert_eq!(levenshtein("über", "uber"), 1);
    }

    #[test]
    fn korrektur() {
        assert_eq!(correct_word("Wichtgi", Mode::Text), "Wichtgi"); // 2 Fehler
        assert_eq!(correct_word("Wichtig.", Mode::Text), "Wichtig.");
        assert_eq!(correct_word("(Notiy,", Mode::Text), "(Notiz,");
        assert_eq!(correct_word("GPUS", Mode::Text), "GPUS");
        assert_eq!(correct_word("x+yz", Mode::Text), "x+yz");
    }

    #[test]
    fn falsche_form() {
        assert!(decode_line(&[0.0; 100], 100, &DecodeOptions::default(), None).is_err());
        assert!(decode_line(&[0.0; 150], CLASSES, &DecodeOptions::default(), None).is_err());
        let empty = decode_line(&[], CLASSES, &DecodeOptions::default(), None).unwrap();
        assert_eq!(empty.status, Status::Empty);
    }
}
