//! Umkehr-Operationen für Rückgängig/Wiederholen. Der Kern hält keinen Undo-Stapel (das ist
//! Sache der App); er liefert zu jeder Änderung die Operationen, die sie zurücknehmen. Wer diese
//! wieder anwendet, bekommt die Umkehr der Umkehr – das ist „Wiederholen“.
//!
//! Die Umkehr ist selbst ein gewöhnliches `heftOps`-Event (letzter Schreiber gewinnt), kein
//! Zurückdrehen des Logs: Auch auf einem zweiten Gerät sieht man das Rückgängig wie jede Änderung.

use std::collections::{HashMap, HashSet};

use impala_heft::{HeftDoc, HeftOp, HeftPage, Item, ItemKind};

/// Operationen, die `ops` auf `doc` zurücknehmen (in der Reihenfolge, in der sie anzuwenden sind).
///
/// Grenze: Entfernte Elemente kommen ans Ende ihrer Liste zurück – die Stapelreihenfolge
/// der Striche (z. B. Marker über Stift) kann sich dadurch ändern.
pub(crate) fn inverse(doc: &HeftDoc, ops: &[HeftOp]) -> Vec<HeftOp> {
    // Eine Operation (der Normalfall: ein Strich) braucht keine Arbeitskopie des ganzen Hefts.
    if let [op] = ops {
        return inverse_one(doc, op);
    }
    // Schneller Pfad: Alle Operationen betreffen nur Elemente derselben Seite (Lasso verschieben,
    // skalieren, drehen, umfärben, duplizieren, löschen, Undo/Redo) ohne doppelte Ziele.
    // Kein Klon des ganzen Hefts und O(N + K) statt O(TotalDoc + K·N).
    if let Some(inv) = inverse_single_page_disjoint(doc, ops) {
        return inv;
    }
    // Einzelne Seite mit überlappenden Operationen: nur diese Seite klonen, nicht alle Seiten.
    if let Some(page_id) = single_page_item_ops(ops) {
        let Some(pg) = doc.page(page_id) else { return Vec::new() };
        let mut scratch = HeftDoc { pages: vec![pg.clone()], ..Default::default() };
        let mut groups = Vec::with_capacity(ops.len());
        for op in ops {
            groups.push(inverse_one(&scratch, op));
            scratch.apply_op(op.clone());
        }
        return groups.into_iter().rev().flatten().collect();
    }
    let mut scratch = doc.clone();
    let mut groups = Vec::with_capacity(ops.len());
    for op in ops {
        groups.push(inverse_one(&scratch, op));
        scratch.apply_op(op.clone());
    }
    groups.into_iter().rev().flatten().collect()
}

/// Liefert die Seiten-ID, wenn alle Operationen nur Inhalte einer einzigen Seite ändern
/// (keine Seiten-Struktur-Ops `pg+`/`pg-`/`pgo`).
fn single_page_item_ops(ops: &[HeftOp]) -> Option<&str> {
    let mut page: Option<&str> = None;
    for op in ops {
        match op {
            HeftOp::Add { page: p, .. }
            | HeftOp::Set { page: p, .. }
            | HeftOp::Remove { page: p, .. }
            | HeftOp::PagePaper { page: p, .. }
            | HeftOp::PageBackground { page: p, .. }
            | HeftOp::Ocr { page: p, .. } => match page {
                None => page = Some(p.as_str()),
                Some(cur) if cur == p.as_str() => {}
                Some(_) => return None,
            },
            _ => return None,
        }
    }
    page
}

/// Schneller Pfad ohne Klon von `HeftDoc` oder `HeftPage` für disjunkte `Add`/`Set`/`Remove`-Batches
/// auf einer Seite. Gibt `None` zurück, wenn dasselbe Element mehrfach angefasst wird.
fn inverse_single_page_disjoint(doc: &HeftDoc, ops: &[HeftOp]) -> Option<Vec<HeftOp>> {
    let mut page_id: Option<&str> = None;
    let mut seen: HashSet<(ItemKind, &str)> = HashSet::with_capacity(ops.len());
    let (mut need_s, mut need_i, mut need_t) = (false, false, false);
    for op in ops {
        match op {
            HeftOp::Add { page, item } | HeftOp::Set { page, item } => {
                if item.id().is_empty() {
                    continue;
                }
                match page_id {
                    None => page_id = Some(page.as_str()),
                    Some(cur) if cur == page.as_str() => {}
                    Some(_) => return None,
                }
                if !seen.insert((item.kind(), item.id())) {
                    return None;
                }
                match item.kind() {
                    ItemKind::Stroke => need_s = true,
                    ItemKind::Image => need_i = true,
                    ItemKind::Text => need_t = true,
                }
            }
            HeftOp::Remove { page, kind, ids } => {
                match page_id {
                    None => page_id = Some(page.as_str()),
                    Some(cur) if cur == page.as_str() => {}
                    Some(_) => return None,
                }
                for id in ids {
                    if !seen.insert((*kind, id.as_str())) {
                        return None;
                    }
                }
            }
            _ => return None,
        }
    }
    let page_id = page_id?;
    let Some(pg) = doc.page(page_id) else {
        return Some(Vec::new());
    };
    let s_idx: HashMap<&str, usize> =
        if need_s { pg.strokes.iter().enumerate().map(|(i, s)| (s.id.as_str(), i)).collect() } else { HashMap::new() };
    let i_idx: HashMap<&str, usize> =
        if need_i { pg.images.iter().enumerate().map(|(i, s)| (s.id.as_str(), i)).collect() } else { HashMap::new() };
    let t_idx: HashMap<&str, usize> =
        if need_t { pg.texts.iter().enumerate().map(|(i, s)| (s.id.as_str(), i)).collect() } else { HashMap::new() };

    let lookup = |kind: ItemKind, id: &str| -> Option<Item> {
        match kind {
            ItemKind::Stroke => s_idx.get(id).map(|&i| Item::Stroke(pg.strokes[i].clone())),
            ItemKind::Image => i_idx.get(id).map(|&i| Item::Image(pg.images[i].clone())),
            ItemKind::Text => t_idx.get(id).map(|&i| Item::Text(pg.texts[i].clone())),
        }
    };

    let mut out = Vec::with_capacity(ops.len());
    for op in ops.iter().rev() {
        match op {
            HeftOp::Add { page, item } if !item.id().is_empty() => {
                let exists = match item.kind() {
                    ItemKind::Stroke => s_idx.contains_key(item.id()),
                    ItemKind::Image => i_idx.contains_key(item.id()),
                    ItemKind::Text => t_idx.contains_key(item.id()),
                };
                if !exists {
                    out.push(HeftOp::Remove { page: page.clone(), kind: item.kind(), ids: vec![item.id().to_owned()] });
                }
            }
            HeftOp::Set { page, item } if !item.id().is_empty() => match lookup(item.kind(), item.id()) {
                Some(old) => out.push(HeftOp::Set { page: page.clone(), item: old }),
                None => {
                    out.push(HeftOp::Remove { page: page.clone(), kind: item.kind(), ids: vec![item.id().to_owned()] })
                }
            },
            HeftOp::Remove { page, kind, ids } => {
                append_removed(&mut out, pg, page, *kind, ids);
            }
            _ => {}
        }
    }
    Some(out)
}

fn find(pg: &HeftPage, kind: ItemKind, id: &str) -> Option<Item> {
    match kind {
        ItemKind::Stroke => pg.strokes.iter().find(|x| x.id == id).cloned().map(Item::Stroke),
        ItemKind::Image => pg.images.iter().find(|x| x.id == id).cloned().map(Item::Image),
        ItemKind::Text => pg.texts.iter().find(|x| x.id == id).cloned().map(Item::Text),
    }
}

/// Fügt `Add`-Umkehroperationen für entfernte Elemente in Seitenreihenfolge an – klont nur Treffer.
fn append_removed(out: &mut Vec<HeftOp>, pg: &HeftPage, page: &str, kind: ItemKind, ids: &[String]) {
    if ids.is_empty() {
        return;
    }
    let want: HashSet<&str> = ids.iter().map(String::as_str).collect();
    match kind {
        ItemKind::Stroke => {
            for s in pg.strokes.iter().filter(|x| want.contains(x.id.as_str())) {
                out.push(HeftOp::Add { page: page.to_owned(), item: Item::Stroke(s.clone()) });
            }
        }
        ItemKind::Image => {
            for i in pg.images.iter().filter(|x| want.contains(x.id.as_str())) {
                out.push(HeftOp::Add { page: page.to_owned(), item: Item::Image(i.clone()) });
            }
        }
        ItemKind::Text => {
            for t in pg.texts.iter().filter(|x| want.contains(x.id.as_str())) {
                out.push(HeftOp::Add { page: page.to_owned(), item: Item::Text(t.clone()) });
            }
        }
    }
}

fn restore_page(at: usize, pg: &HeftPage) -> Vec<HeftOp> {
    let page = || pg.id.clone();
    let mut ops =
        vec![HeftOp::PageAdd { at: Some(at as f64), page: page(), paper: Some(pg.paper.clone()), height: pg.height }];
    if !pg.ocr_text.is_empty() || !pg.ocr_key.is_empty() {
        ops.push(HeftOp::Ocr {
            page: page(),
            text: pg.ocr_text.clone(),
            src: pg.ocr_src.clone(),
            key: pg.ocr_key.clone(),
        });
    }
    ops.extend(pg.strokes.iter().map(|s| HeftOp::Add { page: page(), item: Item::Stroke(s.clone()) }));
    ops.extend(pg.images.iter().map(|s| HeftOp::Add { page: page(), item: Item::Image(s.clone()) }));
    ops.extend(pg.texts.iter().map(|s| HeftOp::Add { page: page(), item: Item::Text(s.clone()) }));
    if pg.background.is_some() {
        ops.push(HeftOp::PageBackground { page: page(), bg: pg.background.clone() });
    }
    ops.extend(pg.bg_note.iter().map(|n| HeftOp::Add { page: page(), item: Item::Text(n.clone()) }));
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
        HeftOp::PageBackground { page, .. } => doc
            .page(page)
            .map(|p| HeftOp::PageBackground { page: page.clone(), bg: p.background.clone() })
            .into_iter()
            .collect(),
        HeftOp::Ocr { page, .. } => doc
            .page(page)
            .map(|p| HeftOp::Ocr {
                page: page.clone(),
                text: p.ocr_text.clone(),
                src: p.ocr_src.clone(),
                key: p.ocr_key.clone(),
            })
            .into_iter()
            .collect(),
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
            let mut out = Vec::with_capacity(ids.len());
            append_removed(&mut out, pg, page, *kind, ids);
            out
        }
        _ => Vec::new(),
    }
}
