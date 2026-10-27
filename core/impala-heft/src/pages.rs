//! Seitenverwaltung (`heft-pages-core.js`).

/// Wohin eine neue Seite kommt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InsertPosition {
    Start,
    Before,
    After,
    End,
}

/// Einfügeindex relativ zur aktuellen Seite (`insertAt`).
pub fn insert_at(position: InsertPosition, current: usize, len: usize) -> usize {
    match position {
        InsertPosition::Start => 0,
        InsertPosition::Before => current.min(len),
        InsertPosition::After => (current + 1).min(len),
        InsertPosition::End => len,
    }
}

/// Verschiebt ein Element von `from` nach `to` (`movePage`). `false`: ungültig oder gleich.
pub fn move_page<T>(pages: &mut Vec<T>, from: usize, to: usize) -> bool {
    if from == to || from >= pages.len() || to >= pages.len() {
        return false;
    }
    let page = pages.remove(from);
    pages.insert(to, page);
    true
}

/// Mindestens eine Seite muss übrig bleiben (`canDeletePages`).
pub fn can_delete_pages(total: usize, selected: usize) -> bool {
    selected > 0 && total.saturating_sub(selected) >= 1
}
