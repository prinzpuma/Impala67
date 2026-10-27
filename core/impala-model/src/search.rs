//! Volltextsuche über den Zustand (`searchNotes`): hält einen [`NoteIndex`] mit den Seiten
//! außerhalb des Papierkorbs aktuell. Nur geänderte Seiten werden neu indiziert; rückt eine Seite
//! an eine andere Stelle der Seitenreihenfolge (Papierkorb → zurück), wird neu aufgebaut, damit
//! gleich bewertete Treffer in derselben Reihenfolge wie im JS erscheinen.

use impala_search::{NoteDoc, NoteHit, NoteIndex};

use crate::model::Model;

#[derive(Default)]
pub struct NoteSearch {
    index: NoteIndex,
    /// Seiten-IDs im Index, in Indexreihenfolge.
    order: Vec<String>,
}

impl NoteSearch {
    pub fn new() -> Self {
        Self::default()
    }

    /// Index an den Zustand angleichen.
    pub fn refresh(&mut self, model: &Model) {
        let state = model.state();
        let docs: Vec<NoteDoc> = state
            .pages
            .iter()
            .filter(|(_, p)| !p.is_trashed())
            .map(|(id, p)| NoteDoc {
                id: id.clone(),
                title: p.title().to_owned(),
                content: p.content().to_owned(),
                ocr: model.heft_meta(id).map(|m| m.ocr_text).unwrap_or_default(),
                updated: p.updated().to_owned(),
                archived: p.is_archived(),
                in_archive: state.is_page_archived(id),
            })
            .collect();
        let ids: Vec<&str> = docs.iter().map(|d| d.id.as_str()).collect();
        let present: std::collections::HashSet<&str> = ids.iter().copied().collect();
        let kept: Vec<&str> = self.order.iter().map(String::as_str).filter(|id| present.contains(id)).collect();
        // Bleibende Seiten müssen vorn in gleicher Reihenfolge stehen, neue nur hinten dazukommen.
        if ids.len() < kept.len() || ids[..kept.len()] != kept[..] {
            self.index = NoteIndex::new();
            self.order.clear();
        } else {
            for id in self.order.iter().filter(|id| !present.contains(id.as_str())) {
                self.index.remove_page(id);
            }
            self.order.retain(|id| present.contains(id.as_str()));
        }
        for doc in docs {
            if !self.order.contains(&doc.id) {
                self.order.push(doc.id.clone());
            }
            self.index.set_page(doc);
        }
    }

    /// Suche (`searchNotes`); `include_archived`: auch archivierte Seiten.
    pub fn search(&mut self, model: &Model, query: &str, include_archived: bool) -> Vec<NoteHit> {
        self.refresh(model);
        self.index.search(query, include_archived)
    }
}
