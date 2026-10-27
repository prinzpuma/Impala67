//! Ablauf für eine Seite (wie `recognizePageStrokes` in `web/handwriting-worker.js`): Zeilen bilden, schon
//! gelesene Zeilen aus dem Zeilen-Cache nehmen, neue begradigen, rastern, (stückweise) durchs Modell, dekodieren.
//! Jeder Strich bekommt genau einen Status.

use std::collections::HashMap;

use crate::InkError;
use crate::ctc::{self, DecodeOptions, Mode, Status};
use crate::lexicon::Lexicon;
use crate::preprocess::{self, Stroke, Tool};
use crate::raster::{self, LineImage, WORD_GAP_PX};
use crate::vocab::CLASSES;

/// Ein Modell: Zeilenbild → Logits (`steps × CLASSES`, zeilenweise). Asynchron, weil die Plattform
/// rechnet (Browser: ONNX Runtime Web im Worker); native Modelle antworten sofort.
#[allow(async_fn_in_trait)]
pub trait LineModel {
    async fn run(&self, image: &LineImage) -> Result<Vec<f32>, InkError>;
    /// Vor jeder Zeile (1-basiert) einer Seite – Fortschritt bzw. Absturz-Spur der Plattform.
    fn line_started(&self, _line: usize, _lines: usize) {}
}

/// Erkennt die Striche einer Seite (oder Auswahl). Standard: [`ModelRecognizer`]; Plattformen
/// (iOS Vision, Android ML Kit) können eigene Erkenner einsetzen.
#[allow(async_fn_in_trait)]
pub trait InkRecognizer {
    /// `known`: schon gelesene Zeilen (Zeilenschlüssel → Ergebnis); nur neue oder geänderte Zeilen
    /// werden gelesen und kommen in [`PageRecognition::fresh`] zurück.
    async fn recognize_page(&self, strokes: &[Stroke], options: &DecodeOptions, known: &LineCache) -> PageRecognition;
}

/// Ergebnis einer Zeile, wie es im Zeilen-Cache liegt.
#[derive(Clone, Debug, PartialEq)]
pub struct LineReading {
    pub text: String,
    pub confidence: f64,
    pub status: Status,
}

/// Zeilenschlüssel ([`line_signature`]) → Ergebnis.
pub type LineCache = HashMap<String, LineReading>;

/// Was mit einer Zeile geschah.
#[derive(Clone, Debug, PartialEq)]
pub enum LineOutcome {
    /// Gelesen (oder aus dem Cache).
    Read(Status),
    /// Unter 5 Punkten: nicht gelesen.
    TooShort,
    /// Modellfehler (z. B. Speicher); die Zeile fehlt im Text.
    Error(String),
}

/// Was mit einem Strich geschah.
#[derive(Clone, Debug, PartialEq)]
pub enum StrokeStatus {
    Line(LineOutcome),
    /// Ohne Punkte.
    Empty,
    /// Form, Radierer, Laser.
    NotInk,
    /// Zu hoch oder breit für Schrift (Skizze, Rahmen, Unterstreichung). Im JS bleiben solche Striche
    /// „nicht zugeordnet“ und die Strich-Bilanz geht nicht auf.
    Sketch,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LineReport {
    /// Striche der Zeile (Indizes in die Eingabe) in Lesereihenfolge.
    pub strokes: Vec<usize>,
    pub key: String,
    pub image_width: usize,
    pub cached: bool,
    pub outcome: LineOutcome,
    pub confidence: f64,
    pub text: String,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct PageRecognition {
    /// Text der Zeilen mit Text, durch `\n` getrennt.
    pub text: String,
    pub lines: Vec<String>,
    /// Neu gelesene Zeilen für den Zeilen-Cache.
    pub fresh: LineCache,
    pub report: Vec<LineReport>,
    /// Status je Eingabe-Strich.
    pub strokes: Vec<StrokeStatus>,
}

/// Strich-Bilanz.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Accounting {
    pub recognized: usize,
    pub uncertain: usize,
    pub skipped: usize,
}

impl PageRecognition {
    pub fn accounting(&self) -> Accounting {
        let mut a = Accounting::default();
        for s in &self.strokes {
            match s {
                StrokeStatus::Line(LineOutcome::Read(Status::Recognized)) => a.recognized += 1,
                StrokeStatus::Line(LineOutcome::Read(Status::Uncertain)) => a.uncertain += 1,
                _ => a.skipped += 1,
            }
        }
        a
    }
}

/// Standard-Erkenner: Zeilenbild-Modell plus (optional) großes Wörterbuch.
pub struct ModelRecognizer<M> {
    pub model: M,
    pub lexicon: Option<Lexicon>,
}

impl<M: LineModel> InkRecognizer for ModelRecognizer<M> {
    async fn recognize_page(&self, strokes: &[Stroke], options: &DecodeOptions, known: &LineCache) -> PageRecognition {
        recognize_page(strokes, options, known, &self.model, self.lexicon.as_ref()).await
    }
}

/// Erkennt die Striche einer Seite mit `model`.
pub async fn recognize_page(
    strokes: &[Stroke],
    options: &DecodeOptions,
    known: &LineCache,
    model: &impl LineModel,
    lexicon: Option<&Lexicon>,
) -> PageRecognition {
    let mut status: Vec<StrokeStatus> = strokes
        .iter()
        .map(|s| match () {
            _ if s.points.is_empty() => StrokeStatus::Empty,
            _ if s.tool != Tool::Ink => StrokeStatus::NotInk,
            _ => StrokeStatus::Sketch, // bis eine Zeile ihn aufnimmt
        })
        .collect();
    let mut page = PageRecognition::default();

    let lines = preprocess::segment_lines(strokes);
    let total = lines.len();
    for (n, line) in lines.into_iter().enumerate() {
        model.line_started(n + 1, total);
        let line_strokes: Vec<Stroke> = line.strokes.iter().map(|&i| strokes[i].clone()).collect();
        let points: usize = line_strokes.iter().map(|s| s.points.len()).sum();
        let key = if points >= 5 { line_signature(&line_strokes, options) } else { String::new() };
        let cached = known.get(&key).filter(|_| !key.is_empty());

        let (reading, outcome, image_width) = if let Some(r) = cached {
            (r.clone(), LineOutcome::Read(r.status), 0)
        } else if points < 5 {
            (LineReading { text: String::new(), confidence: 0.0, status: Status::Empty }, LineOutcome::TooShort, 0)
        } else {
            match raster::rasterize_line(&preprocess::deskew_line(&line_strokes)) {
                None => (
                    LineReading { text: String::new(), confidence: 0.0, status: Status::Empty },
                    LineOutcome::TooShort,
                    0,
                ),
                Some(image) => match recognize_wide_line(&image, options, model, lexicon).await {
                    Ok(r) => {
                        page.fresh.insert(key.clone(), r.clone());
                        let status = r.status;
                        (r, LineOutcome::Read(status), image.width)
                    }
                    Err(e) => (
                        LineReading { text: String::new(), confidence: 0.0, status: Status::Empty },
                        LineOutcome::Error(e.to_string()),
                        image.width,
                    ),
                },
            }
        };
        for &i in &line.strokes {
            status[i] = StrokeStatus::Line(outcome.clone());
        }
        // Unsichere Zeilen (meist kurze Formeln wie "y=5") liefern trotzdem Text: für die Suche ist eine fast
        // richtige Lesung besser als keine. Nur Zeichnungen fallen weg.
        if matches!(outcome, LineOutcome::Read(Status::Recognized | Status::Uncertain))
            && !reading.text.trim().is_empty()
        {
            page.lines.push(reading.text.clone());
        }
        page.report.push(LineReport {
            strokes: line.strokes,
            key,
            image_width,
            cached: cached.is_some(),
            outcome,
            confidence: reading.confidence,
            text: reading.text,
        });
    }
    page.text = page.lines.join("\n");
    page.strokes = status;
    page
}

/// Liest ein Zeilenbild: Modell, Leerzeichen an breiten Lücken erzwingen, dekodieren.
pub async fn recognize_line_image(
    image: &LineImage,
    options: &DecodeOptions,
    model: &impl LineModel,
    lexicon: Option<&Lexicon>,
) -> Result<ctc::LineDecoding, InkError> {
    let mut logits = model.run(image).await?;
    ctc::mark_gap_spaces(&mut logits, CLASSES, &raster::find_ink_gaps(image, WORD_GAP_PX), image.width)?;
    ctc::decode_line(&logits, CLASSES, options, lexicon)
}

/// Wie [`recognize_line_image`], breite Zeilen aber in Stücken ([`raster::chunk_cuts`]). Stücke, die das Modell
/// für eine Zeichnung hält, fallen weg; die Konfidenz ist nach Stückbreite gewichtet.
pub async fn recognize_wide_line(
    image: &LineImage,
    options: &DecodeOptions,
    model: &impl LineModel,
    lexicon: Option<&Lexicon>,
) -> Result<LineReading, InkError> {
    let cuts = raster::chunk_cuts(image);
    if cuts.is_empty() {
        let d = recognize_line_image(image, options, model, lexicon).await?;
        return Ok(LineReading { text: d.text, confidence: d.confidence, status: d.status });
    }
    let (mut text, mut text_width, mut weighted) = (String::new(), 0usize, 0.0);
    let (mut all_recognized, mut saw_drawing, mut from) = (true, false, 0);
    for i in 0..=cuts.len() {
        let to = cuts.get(i).map_or(image.width, |c| c.at);
        let rec = recognize_line_image(&image.slice(from, to), options, model, lexicon).await?;
        let part = rec.text.trim();
        if rec.status == Status::Drawing {
            saw_drawing = true;
        } else if !part.is_empty() {
            if !text.is_empty() && cuts[i - 1].space {
                text.push(' ');
            }
            text.push_str(part);
            weighted += rec.confidence * (to - from) as f64;
            text_width += to - from;
            all_recognized &= rec.status == Status::Recognized;
        }
        from = to;
    }
    Ok(if text.is_empty() {
        LineReading { text, confidence: 0.0, status: if saw_drawing { Status::Drawing } else { Status::Empty } }
    } else {
        let status = if all_recognized { Status::Recognized } else { Status::Uncertain };
        LineReading { text, confidence: weighted / text_width as f64, status }
    })
}

/// Kurzer Schlüssel einer Zeile aus ihren Strichen (Id, Punktzahl, erster/letzter Punkt): ändert sich, sobald
/// ein Strich dazukommt, wegfällt oder verschoben wird. Gleicher Wert wie `lineSignature` im JS (cyrb53).
pub fn line_signature(strokes: &[Stroke], options: &DecodeOptions) -> String {
    let mut parts: Vec<String> = strokes
        .iter()
        .map(|s| {
            let point = |p: Option<&[f64; 2]>| {
                p.map_or("undefined,undefined".to_string(), |p| format!("{},{}", js_num(p[0]), js_num(p[1])))
            };
            format!("{}:{}:{}:{}", s.id, s.points.len(), point(s.points.first()), point(s.points.last()))
        })
        .collect();
    parts.sort();
    cyrb53(&format!("{}|{}", options_json(options), parts.join("|")))
}

/// `JSON.stringify(options)` des Aufrufers; die App übergibt immer `{}`.
fn options_json(o: &DecodeOptions) -> String {
    let mut fields = Vec::new();
    match o.mode {
        Mode::Auto => {}
        Mode::Text => fields.push("\"mode\":\"text\"".to_string()),
        Mode::Math => fields.push("\"mode\":\"math\"".to_string()),
    }
    if o.threshold != DecodeOptions::default().threshold {
        fields.push(format!("\"threshold\":{}", js_num(o.threshold)));
    }
    format!("{{{}}}", fields.join(","))
}

/// Zahl wie `String(x)` im JS für übliche Koordinaten (ohne Exponent-Schreibweise sehr großer/kleiner Werte).
fn js_num(x: f64) -> String {
    if x == 0.0 { "0".to_string() } else { format!("{x}") }
}

fn cyrb53(s: &str) -> String {
    let (mut h1, mut h2) = (0xdeadbeef_u32, 0x41c6ce57_u32);
    for ch in s.encode_utf16() {
        h1 = (h1 ^ ch as u32).wrapping_mul(2654435761);
        h2 = (h2 ^ ch as u32).wrapping_mul(1597334677);
    }
    h1 = (h1 ^ (h1 >> 16)).wrapping_mul(2246822507) ^ (h2 ^ (h2 >> 13)).wrapping_mul(3266489909);
    h2 = (h2 ^ (h2 >> 16)).wrapping_mul(2246822507) ^ (h1 ^ (h1 >> 13)).wrapping_mul(3266489909);
    let mut n = ((h2 & 2097151) as u64) << 32 | h1 as u64;
    let digits = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = Vec::new();
    loop {
        out.push(digits[(n % 36) as usize]);
        n /= 36;
        if n == 0 {
            break;
        }
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zahlen_wie_js() {
        assert_eq!(js_num(12.0), "12");
        assert_eq!(js_num(-0.0), "0");
        assert_eq!(js_num(0.1 + 0.2), "0.30000000000000004");
        assert_eq!(options_json(&DecodeOptions::default()), "{}");
    }

    struct Blank;
    impl LineModel for Blank {
        async fn run(&self, image: &LineImage) -> Result<Vec<f32>, InkError> {
            let mut out = vec![0.0; image.width / 4 * CLASSES];
            out.chunks_exact_mut(CLASSES).for_each(|r| r[0] = 10.0);
            Ok(out)
        }
    }

    #[test]
    fn jeder_strich_hat_einen_status() {
        let s = |pts: &[[f64; 2]], tool| Stroke { id: String::new(), tool, points: pts.to_vec() };
        let strokes = vec![
            s(&[[0.0, 0.0], [5.0, 10.0], [10.0, 0.0], [15.0, 10.0], [20.0, 0.0]], Tool::Ink),
            s(&[], Tool::Ink),
            s(&[[0.0, 0.0], [1.0, 1.0]], Tool::Shape),
            s(&[[0.0, 100.0], [1.0, 101.0]], Tool::Ink),
        ];
        let page =
            impala_net::block_on(recognize_page(&strokes, &DecodeOptions::default(), &LineCache::new(), &Blank, None));
        assert_eq!(page.strokes[0], StrokeStatus::Line(LineOutcome::Read(Status::Empty)));
        assert_eq!(page.strokes[1], StrokeStatus::Empty);
        assert_eq!(page.strokes[2], StrokeStatus::NotInk);
        assert_eq!(page.strokes[3], StrokeStatus::Line(LineOutcome::TooShort));
        assert_eq!(page.accounting(), Accounting { recognized: 0, uncertain: 0, skipped: 4 });
        assert_eq!(page.fresh.len(), 1);
        // zweiter Durchlauf: Zeile aus dem Cache
        let again =
            impala_net::block_on(recognize_page(&strokes, &DecodeOptions::default(), &page.fresh, &Blank, None));
        assert!(again.report[0].cached && again.fresh.is_empty());
    }
}
