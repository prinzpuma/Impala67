//! Nicht-DOM-Teile des Befehls-Menüs (Strg+K, `web/search.js`): Vorschau-Ausschnitt,
//! Markierungs-Bereiche, Seitenpfad, Aktionsfilter und Chat-Suche.
//! Das HTML (Escapen, `<mark>`) sowie lokalisierte Anzeigetexte bleiben in der Oberfläche.

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

/// Zu markierende UTF-16-Code-Unit-Bereiche in `text` (für JS `String.prototype.slice`, Kotlin `substring` und Swift `NSRange`).
pub fn highlight_ranges_utf16(text: &str, query: &str, terms: &[String]) -> Vec<(u32, u32)> {
    let byte_ranges = highlight_ranges(text, query, terms);
    if byte_ranges.is_empty() {
        return Vec::new();
    }
    let mut byte_to_u16 = vec![0u32; text.len() + 1];
    let mut u16_pos = 0u32;
    for (i, c) in text.char_indices() {
        byte_to_u16[i] = u16_pos;
        u16_pos += c.len_utf16() as u32;
    }
    byte_to_u16[text.len()] = u16_pos;
    byte_ranges.into_iter().map(|(s, e)| (byte_to_u16[s], byte_to_u16[e])).collect()
}

/// Formatiert den Brotkrumen-Pfad einer Seite (`Workspace › Eltern › …` wie `pagePathLabel` in `web/search.js`).
pub fn format_page_path(workspace_name: Option<&str>, ancestor_titles: &[String]) -> String {
    let mut parts: Vec<&str> = Vec::with_capacity(ancestor_titles.len() + 1);
    if let Some(ws) = workspace_name.filter(|s| !s.is_empty()) {
        parts.push(ws);
    }
    for t in ancestor_titles {
        if !t.is_empty() {
            parts.push(t.as_str());
        }
    }
    parts.join(" › ")
}

/// Kennung einer Schnell-Aktion im Befehls-Menü.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PaletteActionId {
    NewPage,
    NewChat,
    ReviewCards,
    ManageCards,
    DailyNote,
    DailyCalendar,
    Notebook,
    ToggleTheme,
    OpenArchive,
    OpenTrash,
    OpenSyncSettings,
    OpenSettings,
}

impl PaletteActionId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NewPage => "new-page",
            Self::NewChat => "new-chat",
            Self::ReviewCards => "review-cards",
            Self::ManageCards => "manage-cards",
            Self::DailyNote => "daily-note",
            Self::DailyCalendar => "daily-calendar",
            Self::Notebook => "notebook",
            Self::ToggleTheme => "toggle-theme",
            Self::OpenArchive => "open-archive",
            Self::OpenTrash => "open-trash",
            Self::OpenSyncSettings => "open-sync-settings",
            Self::OpenSettings => "open-settings",
        }
    }
}

/// Filtert Schnell-Aktionen `(id, label)` nach Suchanfrage `query` (ohne Groß-/Kleinschreibung).
pub fn filter_actions<T: Clone>(actions: &[(T, String)], query: &str) -> Vec<T> {
    let ql = js_trim(query).to_lowercase();
    if ql.is_empty() {
        return actions.iter().map(|(id, _)| id.clone()).collect();
    }
    actions.iter().filter(|(_, label)| label.to_lowercase().contains(&ql)).map(|(id, _)| id.clone()).collect()
}

/// Ein Chat-Eintrag für die Suche im Befehls-Menü.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ChatSearchDoc {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub messages: Vec<String>,
}

/// Filtert und begrenzt Chats für das Befehls-Menü (`web/search.js: gather`).
/// `include_messages`: in `"command"`-Modus `true` (Limit 5 mit Query, 3 ohne), in `"newTab"`-Modus `false` (Limit 8 mit Query, 4 ohne).
pub fn search_chats(chats: &[ChatSearchDoc], query: &str, include_messages: bool, limit: usize) -> Vec<String> {
    let ql = js_trim(query).to_lowercase();
    if ql.is_empty() {
        return chats.iter().take(limit).map(|c| c.id.clone()).collect();
    }
    chats
        .iter()
        .filter(|c| {
            c.title.to_lowercase().contains(&ql)
                || (include_messages && c.messages.iter().any(|m| m.to_lowercase().contains(&ql)))
        })
        .take(limit)
        .map(|c| c.id.clone())
        .collect()
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

    #[test]
    fn ranges_utf16_handles_umlauts() {
        let r = highlight_ranges_utf16("Größe und größer", "größ", &[]);
        assert_eq!(r, vec![(0, 4), (10, 14)]);
    }

    #[test]
    fn page_path_formatting() {
        assert_eq!(
            format_page_path(Some("Uni"), &["Mathe".into(), "".into(), "Analysis".into()]),
            "Uni › Mathe › Analysis"
        );
        assert_eq!(format_page_path(None, &[]), "");
    }
}
