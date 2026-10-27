//! Nicht-DOM-Teile des Befehls-Menüs (Strg+K, `web/search.js`): Vorschau-Ausschnitt und
//! Markierungs-Bereiche. Das HTML (Escapen, `<mark>`) bleibt in der Oberfläche.

use crate::text::{is_js_space, js_trim, slice_utf16};

/// Länge der Ausschnitt-Vorschau je Seite.
pub const PREVIEW_LEN: usize = 110;

/// Leerraum zu einem Leerzeichen, getrimmt, gekürzt (`snippet.replace(/\s+/g, " ").trim().slice(0, 110)`).
pub fn preview(snippet: &str) -> String {
    let mut out = String::with_capacity(snippet.len());
    let mut space = false;
    for c in snippet.chars() {
        if is_js_space(c) {
            if !space {
                out.push(' ');
            }
            space = true;
        } else {
            out.push(c);
            space = false;
        }
    }
    slice_utf16(js_trim(&out), 0, PREVIEW_LEN).to_owned()
}

/// Zu markierende Byte-Bereiche in `text`: jede Fundstelle der Anfrage oder einer Wortform
/// (ohne Groß-/Kleinschreibung, von links, nicht überlappend; bei gleichem Anfang gewinnt der
/// erste Suchbegriff wie in der JS-Alternation `(q|t1|t2…)`).
pub fn highlight_ranges(text: &str, query: &str, terms: &[String]) -> Vec<(usize, usize)> {
    let needles: Vec<Vec<char>> = std::iter::once(query)
        .chain(terms.iter().map(String::as_str))
        .filter(|t| !t.is_empty())
        .map(|t| t.chars().flat_map(char::to_lowercase).collect())
        .collect();
    if needles.is_empty() {
        return Vec::new();
    }
    // Kleinschreibung je Zeichen mit Rückweg auf die Byte-Position im Original.
    let mut lc: Vec<char> = Vec::new();
    let mut origin: Vec<usize> = Vec::new();
    for (i, c) in text.char_indices() {
        for l in c.to_lowercase() {
            lc.push(l);
            origin.push(i);
        }
    }
    let byte_end = |at: usize| origin.get(at).copied().unwrap_or(text.len());
    let mut out: Vec<(usize, usize)> = Vec::new();
    let mut at = 0;
    while at < lc.len() {
        match needles.iter().find(|n| lc[at..].starts_with(n)) {
            Some(n) => {
                // Endet der Treffer in der Kleinform eines Zeichens („İ“ → „i̇“), zählt das Zeichen nicht mit.
                let (start, end) = (byte_end(at), byte_end(at + n.len()));
                if end > start {
                    out.push((start, end));
                }
                at += n.len();
            }
            None => at += 1,
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn previews() {
        assert_eq!(preview("  a\n\n b\t"), "a b");
        assert_eq!(preview(&"x".repeat(200)).len(), 110);
    }

    #[test]
    fn ranges() {
        let r = highlight_ranges("Foto und foto, Fotos", "foto", &["fotos".into()]);
        assert_eq!(r, vec![(0, 4), (9, 13), (15, 19)]);
        let r = highlight_ranges("Größe", "grö", &[]);
        assert_eq!(&"Größe"[r[0].0..r[0].1], "Grö");
        assert!(highlight_ranges("abc", "", &[]).is_empty());
    }
}
