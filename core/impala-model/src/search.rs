//! Volltextsuche über den Zustand (`searchNotes`): hält einen [`NoteIndex`] mit den Seiten
//! außerhalb des Papierkorbs aktuell. Nur geänderte Seiten werden neu indiziert; rückt eine Seite
//! an eine andere Stelle der Seitenreihenfolge (Papierkorb → zurück), wird neu aufgebaut, damit
//! gleich bewertete Treffer in derselben Reihenfolge wie im JS erscheinen.

use impala_search::{NoteDoc, NoteHit, NoteIndex};

use std::collections::HashSet;

use crate::model::Model;

/// Handschrift-Text eines Hefts (wie `heftMeta.ocrText`), ohne die übrigen Kennzahlen zu rechnen.
fn ocr_text(model: &Model, id: &str) -> String {
    model.state().hefte.get(id).map_or_else(String::new, |doc| {
        doc.pages.iter().map(|p| p.ocr_text.as_str()).filter(|t| !t.is_empty()).collect::<Vec<_>>().join("\n")
    })
}

#[derive(Default)]
pub struct NoteSearch {
    index: NoteIndex,
    /// Seiten-IDs im Index, in Indexreihenfolge.
    order: Vec<String>,
    /// [`Model::revision`] beim letzten Abgleich: gleich = nichts zu tun.
    synced: Option<u64>,
}

impl NoteSearch {
    pub fn new() -> Self {
        Self::default()
    }

    /// Index an den Zustand angleichen. Unveränderte Seiten (gleicher Stempel, Titel, OCR-Text)
    /// werden nicht kopiert – vorher lief vor JEDER Suche eine Kopie aller Seiteninhalte.
    pub fn refresh(&mut self, model: &Model) {
        if self.synced == Some(model.revision()) {
            return;
        }
        self.synced = Some(model.revision());
        let state = model.state();
        let live: Vec<(&String, &crate::types::Page)> = state.pages.iter().filter(|(_, p)| !p.is_trashed()).collect();
        let ids: Vec<&str> = live.iter().map(|(id, _)| id.as_str()).collect();
        let present: HashSet<&str> = ids.iter().copied().collect();
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
        let known: HashSet<&str> = self.order.iter().map(String::as_str).collect();
        let added: Vec<String> = ids.iter().filter(|id| !known.contains(*id)).map(|id| (*id).to_owned()).collect();
        self.order.extend(added);
        for (id, p) in live {
            let ocr = ocr_text(model, id);
            let (archived, in_archive) = (p.is_archived(), state.is_page_archived(id));
            if self.index.is_current(id, p.updated(), p.title(), &ocr) {
                self.index.set_flags(id, archived, in_archive);
                continue;
            }
            self.index.set_page(NoteDoc {
                id: id.clone(),
                title: p.title().to_owned(),
                content: p.content().to_owned(),
                ocr,
                updated: p.updated().to_owned(),
                archived,
                in_archive,
            });
        }
    }

    /// Rücklinks (`backlinksOf`) aus dem Index: der Inhalt jeder Seite liegt dort schon klein
    /// geschrieben. [`crate::types::State::backlinks_of`] schrieb bei jeder Abfrage alle Seiten neu klein.
    pub fn backlinks(&mut self, model: &Model, id: &str) -> Vec<String> {
        let Some(title) = model.state().pages.get(id).map(|p| p.title().to_owned()) else { return Vec::new() };
        if title.is_empty() || title == "Ohne Titel" {
            return Vec::new();
        }
        self.refresh(model);
        self.index.mentioning(&title, id).into_iter().map(str::to_owned).collect()
    }

    /// Suche (`searchNotes`); `include_archived`: auch archivierte Seiten.
    pub fn search(&mut self, model: &Model, query: &str, include_archived: bool) -> Vec<NoteHit> {
        self.refresh(model);
        self.index.search(query, include_archived)
    }
}
