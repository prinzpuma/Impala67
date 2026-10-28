//! Umkehr-Operationen für Rückgängig/Wiederholen. Der Kern hält keinen Undo-Stapel (das ist
//! Sache der App); er liefert zu jeder Änderung die Operationen, die sie zurücknehmen. Wer diese
//! wieder anwendet, bekommt die Umkehr der Umkehr – das ist „Wiederholen“.
//!
//! Die Umkehr ist selbst ein gewöhnliches `heftOps`-Event (letzter Schreiber gewinnt), kein
//! Zurückdrehen des Logs: Auch auf einem zweiten Gerät sieht man das Rückgängig wie jede Änderung.

use impala_heft::{HeftDoc, HeftOp, HeftPage, Item, ItemKind};

/// Operationen, die `ops` auf `doc` zurücknehmen (in der Reihenfolge, in der sie anzuwenden sind).
///
/// Grenze: Entfernte Elemente kommen ans Ende ihrer Liste zurück – die Stapelreihenfolge
/// der Striche (z. B. Marker über Stift) kann sich dadurch ändern.
pub(crate) fn inverse(doc: &HeftDoc, ops: &[HeftOp]) -> Vec<HeftOp> {
    let mut scratch = doc.clone();
    let mut groups = Vec::with_capacity(ops.len());
    for op in ops {
        groups.push(inverse_one(&scratch, op));
        scratch.apply_op(op.clone());
    }
    groups.into_iter().rev().flatten().collect()
}

fn find(pg: &HeftPage, kind: ItemKind, id: &str) -> Option<Item> {
    match kind {
        ItemKind::Stroke => pg.strokes.iter().find(|x| x.id == id).cloned().map(Item::Stroke),
        ItemKind::Image => pg.images.iter().find(|x| x.id == id).cloned().map(Item::Image),
        ItemKind::Text => pg.texts.iter().find(|x| x.id == id).cloned().map(Item::Text),
    }
}

fn restore_page(at: usize, pg: &HeftPage) -> Vec<HeftOp> {
    let page = || pg.id.clone();
    let mut ops = vec![HeftOp::PageAdd { at: Some(at as f64), page: page(), paper: Some(pg.paper.clone()) }];
    if !pg.ocr_text.is_empty() {
        ops.push(HeftOp::Ocr { page: page(), text: pg.ocr_text.clone() });
    }
    ops.extend(pg.strokes.iter().map(|s| HeftOp::Add { page: page(), item: Item::Stroke(s.clone()) }));
    ops.extend(pg.images.iter().map(|s| HeftOp::Add { page: page(), item: Item::Image(s.clone()) }));
    ops.extend(pg.texts.iter().map(|s| HeftOp::Add { page: page(), item: Item::Text(s.clone()) }));
    ops
}

fn inverse_one(doc: &HeftDoc, op: &HeftOp) -> Vec<HeftOp> {
    match op {
        HeftOp::PageAdd { page, .. } if doc.page(page).is_none() => vec![HeftOp::PageRemove { page: page.clone() }],
        HeftOp::PageRemove { page } => match doc.pages.iter().position(|p| p.id == *page) {
            Some(i) => restore_page(i, &doc.pages[i]),
            None => Vec::new(),
        },
        HeftOp::PageOrder { .. } => {
            vec![HeftOp::PageOrder { order: doc.pages.iter().map(|p| p.id.clone()).collect() }]
        }
        HeftOp::PagePaper { page, .. } => doc
            .page(page)
            .map(|p| HeftOp::PagePaper { page: page.clone(), paper: p.paper.clone() })
            .into_iter()
            .collect(),
        HeftOp::Ocr { page, .. } => {
            doc.page(page).map(|p| HeftOp::Ocr { page: page.clone(), text: p.ocr_text.clone() }).into_iter().collect()
        }
        HeftOp::Add { page, item } if !item.id().is_empty() => match doc.page(page) {
            Some(pg) if find(pg, item.kind(), item.id()).is_none() => {
                vec![HeftOp::Remove { page: page.clone(), kind: item.kind(), ids: vec![item.id().to_owned()] }]
            }
            _ => Vec::new(),
        },
        HeftOp::Set { page, item } if !item.id().is_empty() => match doc.page(page) {
            Some(pg) => vec![match find(pg, item.kind(), item.id()) {
                Some(old) => HeftOp::Set { page: page.clone(), item: old },
                None => HeftOp::Remove { page: page.clone(), kind: item.kind(), ids: vec![item.id().to_owned()] },
            }],
            None => Vec::new(),
        },
        HeftOp::Remove { page, kind, ids } => {
            let Some(pg) = doc.page(page) else { return Vec::new() };
            // In Seitenreihenfolge, nicht in der der Anfrage.
            let items: Vec<(&String, Item)> = match kind {
                ItemKind::Stroke => pg.strokes.iter().map(|x| (&x.id, Item::Stroke(x.clone()))).collect(),
                ItemKind::Image => pg.images.iter().map(|x| (&x.id, Item::Image(x.clone()))).collect(),
                ItemKind::Text => pg.texts.iter().map(|x| (&x.id, Item::Text(x.clone()))).collect(),
            };
            items
                .into_iter()
                .filter(|(id, _)| ids.contains(*id))
                .map(|(_, item)| HeftOp::Add { page: page.clone(), item })
                .collect()
        }
        _ => Vec::new(),
    }
}
