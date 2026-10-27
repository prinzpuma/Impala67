//! Chunking für Embeddings (wie `chunk` und der Textaufbau in `performIndexPage`, `web/rag.js`).
//!
//! Absätze (getrennt durch Leerzeilen) werden zu Chunks bis [`CHUNK_SIZE`] Zeichen gesammelt;
//! Überschriften (`#` bis `###`) beginnen einen neuen Chunk, und jeder neue Chunk beginnt mit
//! den letzten [`CHUNK_OVERLAP`] Zeichen des vorigen. Längen zählen in UTF-16-Einheiten wie JS,
//! damit dieselben Chunk-Texte entstehen – sie sind der Schlüssel, unter dem gespeicherte
//! Vektoren wiederverwendet werden.

use crate::text::{is_js_space, js_trim, slice_utf16, tail_utf16, utf16_len};

pub const CHUNK_SIZE: usize = 800;
pub const CHUNK_OVERLAP: usize = 120;
/// Höchstens so viele Chunks je Seite (großzügig, damit PDF-Volltext hineinpasst).
pub const MAX_CHUNKS: usize = 80;
/// Zeichen PDF-Volltext der Seiten-PDF (`pdfId`) bzw. je eingebetteter PDF.
pub const PDF_TEXT_LIMIT: usize = 60_000;
pub const INLINE_PDF_TEXT_LIMIT: usize = 40_000;

/// Chunks mit den Standardgrößen der App.
pub fn chunk(text: &str) -> Vec<String> {
    chunk_with(text, CHUNK_SIZE, CHUNK_OVERLAP)
}

pub fn chunk_with(text: &str, size: usize, overlap: usize) -> Vec<String> {
    let mut parts = Vec::new();
    let mut cur = String::new();
    let mut cur_len = 0; // UTF-16-Länge von cur
    let push = |parts: &mut Vec<String>, cur: &str| {
        if !js_trim(cur).is_empty() {
            parts.push(cur.to_owned());
        }
    };
    for p in paragraphs(text) {
        let p_len = utf16_len(p);
        if !cur.is_empty() && (is_heading(p) || cur_len + 2 + p_len > size) {
            push(&mut parts, &cur);
            let mut next = String::new();
            if overlap > 0 {
                next.push_str(tail_utf16(&cur, overlap));
                next.push_str("\n\n");
            }
            next.push_str(p);
            cur_len = utf16_len(&next);
            cur = next;
        } else {
            if !cur.is_empty() {
                cur.push_str("\n\n");
                cur_len += 2;
            }
            cur.push_str(p);
            cur_len += p_len;
        }
    }
    push(&mut parts, &cur);
    parts.truncate(MAX_CHUNKS);
    parts
}

/// Wie `split(/\n\n+/)`.
fn paragraphs(text: &str) -> impl Iterator<Item = &str> {
    let mut rest = Some(text);
    std::iter::from_fn(move || {
        let s = rest?;
        let Some(at) = s.find("\n\n") else {
            rest = None;
            return Some(s);
        };
        let end = s[at..].find(|c| c != '\n').map_or(s.len(), |i| at + i);
        rest = Some(&s[end..]);
        Some(&s[..at])
    })
}

/// Wie `/^#{1,3}\s/`.
fn is_heading(p: &str) -> bool {
    let hashes = p.bytes().take_while(|&b| b == b'#').count();
    (1..=3).contains(&hashes) && p[hashes..].chars().next().is_some_and(is_js_space)
}

/// Handschrift-Inhalt einer Heft-Seite: getippte Textfelder und erkannte Handschrift.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct HeftPageText {
    pub texts: Vec<String>,
    pub ocr_text: Option<String>,
}

/// Alles, was zu einer Seite indexiert wird. PDF-Texte löst der Aufrufer vorher auf
/// (Blob `pdftext:<id>`, sonst einmalig aus der PDF extrahiert).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct IndexSource {
    pub title: String,
    pub content: String,
    /// Volltext der Seiten-PDF (`pdfId`).
    pub pdf_text: Option<String>,
    /// Volltexte der im Inhalt eingebetteten PDFs, in der Reihenfolge von [`inline_file_ids`].
    pub inline_pdf_texts: Vec<String>,
    /// Seiten des geladenen Heft-Dokuments (leer: kein Dokument geladen).
    pub heft_pages: Vec<HeftPageText>,
    /// Handschrift-Index aus den Heft-Metadaten; zählt nur ohne geladenes Dokument.
    pub heft_meta_ocr: Option<String>,
}

/// Gesamttext einer Seite für das Chunking.
///
/// Abweichung vom JS: Fehlt Titel oder Inhalt, steht dort nichts statt „undefined“.
pub fn index_text(src: &IndexSource) -> String {
    let mut text = format!("{}\n\n{}", src.title, src.content);
    if let Some(pdf) = &src.pdf_text {
        text.push_str("\n\n");
        text.push_str(slice_utf16(pdf, 0, PDF_TEXT_LIMIT));
    }
    for pdf in &src.inline_pdf_texts {
        text.push_str("\n\n");
        text.push_str(slice_utf16(pdf, 0, INLINE_PDF_TEXT_LIMIT));
    }
    if !src.heft_pages.is_empty() {
        let blocks: Vec<String> = src
            .heft_pages
            .iter()
            .enumerate()
            .filter_map(|(i, page)| {
                let parts: Vec<&str> =
                    page.texts.iter().chain(&page.ocr_text).map(|t| js_trim(t)).filter(|t| !t.is_empty()).collect();
                (!parts.is_empty()).then(|| format!("### Seite {}\n{}", i + 1, parts.join("\n")))
            })
            .collect();
        if !blocks.is_empty() {
            text.push_str("\n\n## Handschrift-Notizen\n");
            text.push_str(&blocks.join("\n\n"));
        }
    } else if let Some(ocr) = src.heft_meta_ocr.as_deref().map(js_trim).filter(|t| !t.is_empty()) {
        text.push_str("\n\n## Handschrift-Notizen\n");
        text.push_str(ocr);
    }
    text
}

/// Blob-Ids der im Inhalt eingebetteten Dateien (`:::file <id>`), ohne die Seiten-PDF.
/// Der Aufrufer prüft, ob es PDFs sind ([`is_pdf`]), und reicht deren Texte herein.
///
/// Abweichung vom JS: Jede Datei zählt einmal (JS hängte den Text bei mehrfacher
/// Einbettung mehrfach an).
pub fn inline_file_ids(content: &str, pdf_id: Option<&str>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut rest = content;
    while let Some(at) = rest.find(":::file") {
        rest = &rest[at + ":::file".len()..];
        let after_space = rest.trim_start_matches(is_js_space);
        if after_space.len() == rest.len() {
            continue; // `\s+` verlangt mindestens ein Leerzeichen
        }
        let id_len = after_space.find(is_js_space).unwrap_or(after_space.len());
        let id = &after_space[..id_len];
        rest = &after_space[id_len..];
        if id.is_empty() || Some(id) == pdf_id || out.iter().any(|x| x == id) {
            continue;
        }
        out.push(id.to_owned());
    }
    out
}

/// PDF nach Blob-Metadaten (Typ oder Dateiendung).
pub fn is_pdf(mime: Option<&str>, name: Option<&str>) -> bool {
    mime == Some("application/pdf") || name.is_some_and(|n| n.to_lowercase().ends_with(".pdf"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_paragraphs_like_js() {
        assert_eq!(paragraphs("a\n\n\nb\nc\n\n").collect::<Vec<_>>(), vec!["a", "b\nc", ""]);
        assert_eq!(paragraphs("").collect::<Vec<_>>(), vec![""]);
    }

    #[test]
    fn headings_start_chunks_with_overlap() {
        let parts = chunk_with("Intro text\n\n# Kapitel\n\nmehr", 800, 4);
        assert_eq!(parts, vec!["Intro text", "text\n\n# Kapitel\n\nmehr"]);
        assert!(is_heading("### x") && !is_heading("#### x") && !is_heading("#x") && is_heading("#\u{feff}"));
        assert_eq!(chunk_with("a\n\nb", 3, 0), vec!["a", "b"]);
        assert!(chunk("  \n\n \n").is_empty());
    }

    #[test]
    fn inline_files() {
        let c = ":::file a1 x\n:::file  b2\n:::filec3 :::file a1 :::file p";
        assert_eq!(inline_file_ids(c, Some("p")), vec!["a1", "b2"]);
        assert!(is_pdf(None, Some("X.PDF")) && !is_pdf(Some("image/png"), Some("a.png")));
    }
}
