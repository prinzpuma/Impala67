//! Volltextsuche über Seiten (wie `searchNotes` in `web/state.js`): exakte Teilstring-Treffer
//! (Titel +10, je Fundstelle +1), aufgefüllt mit Tippfehler-Treffern aus dem [`FuzzyIndex`],
//! archivierte Seiten immer unter den aktiven, höchstens [`MAX_HITS`] Treffer mit Ausschnitt.

use std::collections::HashMap;

use crate::fuzzy::FuzzyIndex;
use crate::text::{js_trim, lower, slice_utf16, utf16_len, utf16_pos};

pub const MAX_HITS: usize = 8;
/// Ausschnitt: so viele Zeichen vor und nach der Fundstelle.
pub const SNIPPET_BEFORE: usize = 80;
pub const SNIPPET_AFTER: usize = 160;

/// Suchbarer Stand einer (nicht gelöschten) Seite.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct NoteDoc {
    pub id: String,
    pub title: String,
    pub content: String,
    /// Handschrift-Index des Hefts (`heftMeta.ocrText`).
    pub ocr: String,
    /// Versionsstempel (`updated`): gleicher Stempel und gleicher OCR-Text = unverändert.
    pub updated: String,
    /// Eigenes Archiv-Flag (sortiert Treffer nach unten).
    pub archived: bool,
    /// Archiviert oder unter einer archivierten Seite (fällt ohne `include_archived` weg).
    pub in_archive: bool,
}

struct Entry {
    doc: NoteDoc,
    raw: String,
    hay: String,
    title_lc: String,
}

/// Treffer; `terms` sind bei Tippfehler-Treffern die getroffenen Wortformen (zum Markieren).
#[derive(Debug, Clone, PartialEq)]
pub struct NoteHit {
    pub id: String,
    pub score: u32,
    pub terms: Option<Vec<String>>,
    pub snippet: String,
}

/// Suchindex aller Seiten in Seitenreihenfolge (wie `Object.values(S.pages)`).
#[derive(Default)]
pub struct NoteIndex {
    entries: Vec<Option<Entry>>,
    slot_of: HashMap<String, usize>,
    fuzzy: FuzzyIndex,
}

impl NoteIndex {
    pub fn new() -> Self {
        Self::default()
    }

    /// Seite aufnehmen oder aktualisieren (Position bleibt, wie bei einem JS-Objekt).
    pub fn set_page(&mut self, doc: NoteDoc) {
        let slot = self.slot_of.get(&doc.id).copied();
        if let Some(Some(e)) = slot.map(|s| &mut self.entries[s])
            && e.doc.updated == doc.updated
            && e.doc.ocr == doc.ocr
            && e.doc.title == doc.title
        {
            e.doc.archived = doc.archived;
            e.doc.in_archive = doc.in_archive;
            return;
        }
        let raw = if doc.ocr.is_empty() {
            format!("{}\n{}", doc.title, doc.content)
        } else {
            format!("{}\n{}\n{}", doc.title, doc.content, doc.ocr)
        };
        self.fuzzy.set_page(&doc.id, &raw);
        let entry = Entry { hay: lower(&raw), title_lc: lower(&doc.title), raw, doc };
        match slot {
            Some(s) => self.entries[s] = Some(entry),
            None => {
                self.slot_of.insert(entry.doc.id.clone(), self.entries.len());
                self.entries.push(Some(entry));
            }
        }
    }

    /// Seite entfernen (gelöscht oder im Papierkorb).
    pub fn remove_page(&mut self, id: &str) {
        if let Some(s) = self.slot_of.remove(id) {
            self.entries[s] = None;
            self.fuzzy.set_page(id, "");
        }
    }

    pub fn search(&self, query: &str, include_archived: bool) -> Vec<NoteHit> {
        let q = lower(query);
        if q.is_empty() {
            return Vec::new();
        }
        let pool: Vec<&Entry> =
            self.entries.iter().flatten().filter(|e| include_archived || !e.doc.in_archive).collect();
        let by_rank = |a: &(&Entry, u32, usize, Option<Vec<String>>), b: &(&Entry, u32, usize, Option<Vec<String>>)| {
            a.0.doc.archived.cmp(&b.0.doc.archived).then(b.1.cmp(&a.1))
        };
        let mut exact: Vec<(&Entry, u32, usize, Option<Vec<String>>)> = pool
            .iter()
            .filter_map(|e| {
                let first = e.hay.find(&q)?;
                let mut score = if e.title_lc.contains(&q) { 10 } else { 0 };
                score += e.hay.matches(q.as_str()).count() as u32;
                Some((*e, score, first, None))
            })
            .collect();
        exact.sort_by(by_rank);
        exact.truncate(MAX_HITS);
        if exact.len() < MAX_HITS && utf16_len(js_trim(&q)) >= 3 {
            let skip: Vec<&str> = exact.iter().map(|h| h.0.doc.id.as_str()).collect();
            let allowed: HashMap<&str, &Entry> =
                pool.iter().filter(|e| !skip.contains(&e.doc.id.as_str())).map(|e| (e.doc.id.as_str(), *e)).collect();
            let mut fuzzy: Vec<_> = self
                .fuzzy
                .search(&q, |id| allowed.contains_key(id))
                .into_iter()
                .map(|h| {
                    let e = allowed[h.id.as_str()];
                    let title_hit = h.forms.iter().any(|f| e.title_lc.contains(f.as_str()));
                    let first = h.forms.iter().filter_map(|f| e.hay.find(f.as_str())).min().unwrap_or(0);
                    (e, h.score + if title_hit { 10 } else { 0 }, first, Some(h.forms))
                })
                .collect();
            fuzzy.sort_by(by_rank);
            fuzzy.truncate(MAX_HITS - exact.len());
            exact.extend(fuzzy);
        }
        exact
            .into_iter()
            .map(|(e, score, at, terms)| NoteHit {
                id: e.doc.id.clone(),
                score,
                terms,
                snippet: snippet(&e.raw, raw_pos(&e.raw, utf16_pos(&e.hay, at))).to_owned(),
            })
            .collect()
    }
}

/// UTF-16-Position im Originaltext zur Position `hay_pos` im kleingeschriebenen Text.
///
/// Abweichung vom JS: JS schneidet den Originaltext an der Position aus dem kleingeschriebenen
/// Text aus; ändert die Kleinschreibung die Länge (z. B. „İ“), verrutschte der Ausschnitt.
fn raw_pos(raw: &str, hay_pos: usize) -> usize {
    let (mut lc, mut orig) = (0, 0);
    for c in raw.chars() {
        if lc >= hay_pos {
            break;
        }
        lc += c.to_lowercase().map(char::len_utf16).sum::<usize>();
        orig += c.len_utf16();
    }
    orig
}

fn snippet(raw: &str, at: usize) -> &str {
    slice_utf16(raw, at.saturating_sub(SNIPPET_BEFORE), at + SNIPPET_AFTER)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(id: &str, title: &str, content: &str) -> NoteDoc {
        NoteDoc {
            id: id.into(),
            title: title.into(),
            content: content.into(),
            updated: "1".into(),
            ..Default::default()
        }
    }

    #[test]
    fn exact_then_fuzzy() {
        let mut ix = NoteIndex::new();
        ix.set_page(doc("a", "Photosynthese", "Licht und Wasser"));
        ix.set_page(doc("b", "Biologie", "Fotosynthese: Licht, Licht"));
        ix.set_page(NoteDoc { archived: true, in_archive: true, ..doc("c", "Licht", "") });
        let hits = ix.search("Licht", false);
        assert_eq!(hits.iter().map(|h| (h.id.as_str(), h.score)).collect::<Vec<_>>(), vec![("b", 2), ("a", 1)]);
        let hits = ix.search("licht", true);
        assert_eq!(hits.last().map(|h| (h.id.as_str(), h.score)), Some(("c", 11)));
        let hits = ix.search("fotosynthese", false);
        assert_eq!(hits[0].id, "b");
        assert_eq!(hits[1].id, "a");
        assert_eq!(hits[1].terms.as_deref(), Some(&["photosynthese".to_string(), "fotosynthese".to_string()][..]));
        ix.remove_page("b");
        assert_eq!(ix.search("fotosynthese", false).len(), 1);
    }

    #[test]
    fn snippet_uses_original_positions() {
        assert_eq!(raw_pos("İx", 2), 1);
        assert_eq!(snippet("abc", 1), "abc");
    }
}
