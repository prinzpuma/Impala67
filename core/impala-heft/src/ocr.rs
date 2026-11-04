//! Rangfolge der Handschrift-Erkennung über alle Geräte.
//!
//! Jede Plattform erkennt Heftseiten mit ihrer eigenen Erkennung: die PWA (ONNX), Android (ML Kit)
//! und das iPad (Apple Vision, die beste). Der Seitentext trägt darum seine Quelle (`ocrSrc`) und den
//! Fingerabdruck der Seite, aus der er erkannt wurde (`ocrKey`). Daraus folgt eine Regel für alle:
//!
//! - Passt der Text noch zur Seite (gleicher Fingerabdruck), ersetzt ihn nur eine gleich gute oder
//!   bessere Quelle. Eine schwächere Erkennung überschreibt so nie eine bessere.
//! - Gehört der neue Text zu einem anderen Stand der Seite, gilt er immer (der Inhalt hat sich
//!   geändert). Die besseren Geräte werten ihn danach im Leerlauf wieder auf.
//!
//! Die Regel steht hier und in [`crate::diff::Shadow`] und hängt nur von der Reihenfolge im Log ab:
//! Alle Geräte kommen so zum selben Ergebnis.

use crate::doc::{HeftPage, compose_page_text};
use crate::json::radix36;
use crate::ops::HeftOp;

/// Bekannte Quellen, schwächste zuerst. Fehlende oder unbekannte Quelle (ältere Texte): Rang 0.
pub const SOURCES: [&str; 3] = ["pwa", "android", "apple"];

/// Rang einer Quelle: 0 (unbekannt) bis 3 (Apple).
pub fn rank(src: &str) -> u8 {
    SOURCES.iter().position(|s| *s == src).map_or(0, |i| i as u8 + 1)
}

/// Darf ein Text (`new_src`, `new_key`) den vorhandenen (`cur_src`, `cur_key`) ersetzen?
pub fn accepts(cur_src: &str, cur_key: &str, new_src: &str, new_key: &str) -> bool {
    new_key != cur_key || rank(new_src) >= rank(cur_src)
}

/// Fingerabdruck dessen, woraus der Seitentext entsteht: Striche (ID, Punktzahl, Lage) und der
/// Text der Scan-Bilder. Ändert sich einer davon, ist der Seitentext veraltet.
pub fn content_key(page: &HeftPage) -> String {
    let mut h = Fnv::default();
    for s in &page.strokes {
        h.feed(s.id.as_bytes());
        h.feed(&(s.pts.len() as u64).to_le_bytes());
        if let Some(p) = s.pts.first() {
            h.feed(&(p.x.round() as i64).to_le_bytes());
            h.feed(&(p.y.round() as i64).to_le_bytes());
        }
        h.feed(b"|");
    }
    h.feed(b"#");
    for o in page.images.iter().filter_map(|im| im.ocr.as_deref()) {
        h.feed(o.as_bytes());
        h.feed(b"|");
    }
    format!("{}-{}", radix36(page.strokes.len() as u64), radix36(u64::from(h.0)))
}

/// Soll Quelle `src` diese Seite (neu) erkennen? Ja, wenn der Text nicht mehr zur Seite passt oder
/// von einer schwächeren Erkennung stammt. Seiten ohne Striche brauchen keine Erkennung, nur ihr Text
/// muss dem der Scan-Bilder entsprechen.
pub fn needs_ocr(page: &HeftPage, src: &str) -> bool {
    if page.strokes.is_empty() {
        return page.ocr_text != compose_page_text("", page);
    }
    page.ocr_key != content_key(page) || rank(src) > rank(&page.ocr_src)
}

/// Operation, die das Ergebnis einer Erkennung speichert, oder `None`, wenn es nichts zu tun gibt.
///
/// - `stroke_text`: erkannter Text der Striche; der Text der Scan-Bilder kommt dazu.
/// - `expected_key`: Fingerabdruck der Seite beim Start der Erkennung. Hat sich die Seite seitdem
///   geändert, ist das Ergebnis schon veraltet und wird verworfen.
/// - Ein leeres Ergebnis ersetzt keinen vorhandenen Text, solange die Seite Striche hat (die
///   Erkennung findet bei Skizzen oft nichts, ein alter Text ist dann besser als keiner).
pub fn ocr_op(page: &HeftPage, stroke_text: &str, src: &str, expected_key: Option<&str>) -> Option<HeftOp> {
    let key = content_key(page);
    if expected_key.is_some_and(|k| k != key) {
        return None;
    }
    let text = compose_page_text(stroke_text, page);
    if text.is_empty() && !page.strokes.is_empty() && !page.ocr_text.is_empty() {
        return None;
    }
    if !accepts(&page.ocr_src, &page.ocr_key, src, &key) {
        return None;
    }
    if text == page.ocr_text && src == page.ocr_src && key == page.ocr_key {
        return None;
    }
    Some(HeftOp::Ocr { page: page.id.clone(), text, src: src.to_owned(), key })
}

/// FNV-1a (32 Bit) über Bytes.
struct Fnv(u32);

impl Default for Fnv {
    fn default() -> Self {
        Fnv(0x811c_9dc5)
    }
}

impl Fnv {
    fn feed(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.0 = (self.0 ^ u32::from(b)).wrapping_mul(0x0100_0193);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::{Point, Stroke};

    fn page(strokes: usize) -> HeftPage {
        let mut p = HeftPage::empty("p", Default::default());
        for i in 0..strokes {
            p.strokes.push(Stroke {
                id: format!("s{i}"),
                pts: vec![Point::new(i as f64, 1.0, 0.5), Point::new(2.0, 2.0, 0.5)],
                ..Default::default()
            });
        }
        p
    }

    fn apply(p: &mut HeftPage, op: HeftOp) {
        let mut doc = crate::HeftDoc { pages: vec![p.clone()], ..Default::default() };
        doc.apply_op(op);
        *p = doc.pages.remove(0);
    }

    #[test]
    fn ranks() {
        assert!(rank("apple") > rank("android") && rank("android") > rank("pwa") && rank("pwa") > rank(""));
        assert_eq!(rank("unbekannt"), 0);
    }

    #[test]
    fn better_source_wins_worse_does_not_overwrite() {
        let mut p = page(2);
        let op = ocr_op(&p, "pwa text", "pwa", None).unwrap();
        apply(&mut p, op);
        assert!(needs_ocr(&p, "apple") && needs_ocr(&p, "android") && !needs_ocr(&p, "pwa"));
        let op = ocr_op(&p, "apple text", "apple", None).unwrap();
        apply(&mut p, op);
        assert_eq!((p.ocr_text.as_str(), p.ocr_src.as_str()), ("apple text", "apple"));
        assert!(!needs_ocr(&p, "apple") && !needs_ocr(&p, "android") && !needs_ocr(&p, "pwa"));
        // Eine schwächere Erkennung derselben Seite kommt nicht durch – auch nicht über das Log.
        assert!(ocr_op(&p, "android text", "android", None).is_none());
        let late = HeftOp::Ocr { page: "p".into(), text: "alt".into(), src: "pwa".into(), key: p.ocr_key.clone() };
        apply(&mut p, late);
        assert_eq!(p.ocr_text, "apple text");
    }

    #[test]
    fn changed_page_is_stale_for_everyone() {
        let mut p = page(1);
        let op = ocr_op(&p, "apple", "apple", None).unwrap();
        apply(&mut p, op);
        p.strokes.extend(page(3).strokes.into_iter().skip(1));
        assert!(needs_ocr(&p, "pwa"));
        let op = ocr_op(&p, "neu", "pwa", None).unwrap();
        apply(&mut p, op);
        assert_eq!(p.ocr_text, "neu");
        assert!(needs_ocr(&p, "apple") && !needs_ocr(&p, "pwa"));
    }

    #[test]
    fn stale_result_and_empty_result_are_dropped() {
        let mut p = page(1);
        let key = content_key(&p);
        let op = ocr_op(&p, "text", "pwa", Some(&key)).unwrap();
        apply(&mut p, op);
        p.strokes.extend(page(2).strokes.into_iter().skip(1));
        assert!(ocr_op(&p, "x", "apple", Some(&key)).is_none(), "Seite hat sich während der Erkennung geändert");
        assert!(ocr_op(&p, "", "apple", None).is_none(), "leeres Ergebnis ersetzt keinen Text");
        // Ohne Striche wird der Text geleert.
        let mut empty = page(0);
        empty.ocr_text = "alt".into();
        assert!(needs_ocr(&empty, "pwa"));
        let op = ocr_op(&empty, "", "pwa", None).unwrap();
        apply(&mut empty, op);
        assert_eq!(empty.ocr_text, "");
        assert!(!needs_ocr(&empty, "apple"));
    }

    #[test]
    fn sketch_without_text_is_marked_done() {
        let mut p = page(1);
        let op = ocr_op(&p, "", "android", None).unwrap();
        apply(&mut p, op);
        assert!(!needs_ocr(&p, "android") && needs_ocr(&p, "apple"));
    }
}
