//! Seitenhintergrund (`bg`): PDF-Seite, Scan oder importiertes Bild fest unter einer Heftseite.

use crate::doc::{HeftDoc, Image, MAX_PAGE_H, MIN_PAGE_H, PAGE_H, PAGE_W, Paper, bg_note, bg_note_id};
use crate::ops::{HeftOp, Item, ItemKind};

/// Operationen, die den Hintergrund einer Seite setzen oder (`None`) entfernen. Ältere Apps kennen
/// `pgb` nicht: Mit dem ersten Hintergrund bekommen sie ein Textfeld mit der Bitte um ein Update,
/// das mit dem letzten wieder verschwindet. `had`: Die Seite hat bisher einen Hintergrund.
pub fn background_ops(page: &str, had: bool, bg: Option<Image>) -> Vec<HeftOp> {
    let set = bg.is_some();
    let mut ops = vec![HeftOp::PageBackground { page: page.to_owned(), bg }];
    if set && !had {
        ops.push(HeftOp::Add { page: page.to_owned(), item: Item::Text(bg_note(page)) });
    } else if !set && had {
        ops.push(HeftOp::Remove { page: page.to_owned(), kind: ItemKind::Text, ids: vec![bg_note_id(page)] });
    }
    ops
}

/// Seite für ein Hintergrundbild von `w`×`h` Pixeln (PDF-Seite, Scan, Arbeitsblatt): Die Seite
/// übernimmt sein Format (Breite [`PAGE_W`], Höhe danach, begrenzt auf [`MIN_PAGE_H`]…[`MAX_PAGE_H`]),
/// das Bild füllt sie eingepasst und zentriert. Liefert `(Seitenhöhe, [x, y, w, h])`.
pub fn background_fit(w: f64, h: f64) -> (f64, [f64; 4]) {
    if !(w > 0.0 && h > 0.0 && w.is_finite() && h.is_finite()) {
        return (PAGE_H, [0.0, 0.0, PAGE_W, PAGE_H]);
    }
    let page_h = (PAGE_W * h / w).clamp(MIN_PAGE_H, MAX_PAGE_H);
    let k = (PAGE_W / w).min(page_h / h);
    let (iw, ih) = (w * k, h * k);
    (page_h, [(PAGE_W - iw) / 2.0, (page_h - ih) / 2.0, iw, ih])
}

/// Füllt das Bild die Seite (eingepasst, zentriert: an zwei gegenüberliegenden Rändern)?
fn fills_page(im: &Image) -> bool {
    let (Some(x), Some(y), Some(w), Some(h)) = (im.x, im.y, im.w, im.h) else { return false };
    let near = |a: f64, b: f64| (a - b).abs() <= 1.0;
    (near(x, 0.0) && near(x + w, PAGE_W)) || (near(y, 0.0) && near(y + h, PAGE_H))
}

/// Übernimmt Altbestand: Bis zum Seitenhintergrund lagen PDF-Seiten und Scans als seitenfüllendes
/// unterstes Bild auf leerem Papier. Solche Bilder werden (mit ID, Daten und erkanntem Text) zum
/// Hintergrund. Leer, wenn nichts zu tun ist; mehrfach oder auf zwei Geräten zugleich harmlos.
pub fn adopt_background_ops(doc: &HeftDoc) -> Vec<HeftOp> {
    let mut ops = Vec::new();
    for pg in &doc.pages {
        if pg.background.is_some() || pg.paper != Paper::Blank {
            continue;
        }
        let Some(im) = pg.images.first().filter(|im| im.has_source() && fills_page(im)) else { continue };
        ops.push(HeftOp::Remove { page: pg.id.clone(), kind: ItemKind::Image, ids: vec![im.id.clone()] });
        ops.extend(background_ops(&pg.id, false, Some(im.clone())));
    }
    ops
}
