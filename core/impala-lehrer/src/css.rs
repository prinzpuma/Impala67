//! Bereinigung des KI-gelieferten Themes (CSS). Das Scoping übernimmt die App per CSS-Nesting.

const MAX_CSS: usize = 20_000;

/// Entfernt, was Skripte nachladen oder Daten abfließen lassen könnte: `@import`, `url(` (außer
/// `url(data:image/`, wird zu `none`), `expression(`, `javascript:`, `behavior:`, `-moz-binding`,
/// jedes `<` (also auch `</style`) und Rückwärtsstriche (CSS-Escapes könnten `url(` tarnen).
/// Wiederholt bis nichts mehr greift, damit zusammengesetzte Muster nicht durchrutschen.
pub fn sanitize_css(css: &str) -> String {
    let mut s: String = css.chars().take(MAX_CSS).collect();
    for _ in 0..16 {
        let before = s.clone();
        s = s.replace(['<', '\\'], "");
        s = strip_imports(&s);
        s = strip_urls(&s);
        for pat in ["expression(", "javascript:", "behavior:", "-moz-binding"] {
            s = remove_ci(&s, pat);
        }
        if s == before {
            return s;
        }
    }
    // Nicht stabil geworden: lieber nichts speichern als etwas Halbgares.
    String::new()
}

/// Entfernt `pat` (ASCII, ohne Groß-/Kleinschreibung). Kleinschreiben ändert keine Byte-Längen.
fn remove_ci(s: &str, pat: &str) -> String {
    let low = s.to_ascii_lowercase();
    let mut out = String::with_capacity(s.len());
    let mut at = 0;
    while let Some(p) = low[at..].find(pat) {
        out.push_str(&s[at..at + p]);
        at += p + pat.len();
    }
    out.push_str(&s[at..]);
    out
}

/// Entfernt `@import …;` (ohne Semikolon: bis zum Ende).
fn strip_imports(s: &str) -> String {
    let low = s.to_ascii_lowercase();
    let mut out = String::with_capacity(s.len());
    let mut at = 0;
    while let Some(p) = low[at..].find("@import") {
        let p = at + p;
        out.push_str(&s[at..p]);
        at = low[p..].find(';').map_or(s.len(), |e| p + e + 1);
    }
    out.push_str(&s[at..]);
    out
}

/// `url(…)` → `none`, außer es folgt (nach Leerraum/Anführungszeichen) `data:image/`.
fn strip_urls(s: &str) -> String {
    let low = s.to_ascii_lowercase();
    let mut out = String::with_capacity(s.len());
    let mut at = 0;
    while let Some(p) = low[at..].find("url(") {
        let p = at + p;
        out.push_str(&s[at..p]);
        let inner = low[p + 4..].trim_start_matches(|c: char| c.is_whitespace() || c == '"' || c == '\'');
        if inner.starts_with("data:image/") {
            out.push_str(&s[p..p + 4]);
            at = p + 4;
        } else {
            out.push_str("none");
            at = low[p..].find(')').map_or(s.len(), |e| p + e + 1);
        }
    }
    out.push_str(&s[at..]);
    out
}
