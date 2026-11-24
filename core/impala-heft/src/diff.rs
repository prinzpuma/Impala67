//! Dokument-Diff (`heft-document-core.js`): Welche [`HeftOp`]s führen den zuletzt
//! veröffentlichten Stand in den aktuellen über?
//!
//! Verglichen wird über einen [`Shadow`]: je Element nur eine Signatur dessen, was als
//! Änderung zählt. Bei Strichen sind das Punktzahl, erster und letzter Punkt, Farbe, Dicke
//! und Form (Werkzeug und innere Punkte nicht – wie in JS); bei Bildern Rahmen, Bildquelle
//! und Scan-Text; bei Textfeldern alles außer der abgeleiteten Höhe `h` und `hidden`.

use std::collections::{HashMap, HashSet};

use crate::background::background_ops;
use crate::doc::{HeftDoc, HeftPage, Image, Paper, Point, Shape, Stroke, TextBox};
use crate::json::{js_len, same_num};
use crate::ops::{HeftOp, Item, ItemKind, insert_index, reorder};

/// Vergleichswert eines Elements.
#[derive(Debug, Clone)]
pub enum Signature {
    Stroke {
        len: usize,
        first: Option<(f64, f64)>,
        last: Option<(f64, f64)>,
        color: Option<String>,
        size: Option<f64>,
        shape: Option<Shape>,
    },
    Image {
        rect: [Option<f64>; 4],
        source: ImageSource,
        ocr: Option<String>,
    },
    /// JSON des Textfelds ohne `h` und `hidden`.
    Text(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum ImageSource {
    Ref(String),
    /// Altbild: nur die Länge der eingebetteten dataURL zählt.
    SrcLen(usize),
    /// Bild ohne Quelle: das ganze Objekt (wie JS, das dann den Text-Zweig nimmt).
    Json(String),
}

fn same_opt(a: Option<f64>, b: Option<f64>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => same_num(a, b),
        (None, None) => true,
        _ => false,
    }
}
fn same_xy(a: Option<(f64, f64)>, b: Option<(f64, f64)>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => same_num(a.0, b.0) && same_num(a.1, b.1),
        (None, None) => true,
        _ => false,
    }
}

impl PartialEq for Signature {
    fn eq(&self, o: &Self) -> bool {
        match (self, o) {
            (
                Signature::Stroke { len, first, last, color, size, shape },
                Signature::Stroke { len: l2, first: f2, last: la2, color: c2, size: s2, shape: sh2 },
            ) => {
                len == l2
                    && same_xy(*first, *f2)
                    && same_xy(*last, *la2)
                    && color == c2
                    && same_opt(*size, *s2)
                    && shape == sh2
            }
            (Signature::Image { rect, source, ocr }, Signature::Image { rect: r2, source: s2, ocr: o2 }) => {
                rect.iter().zip(r2).all(|(a, b)| same_opt(*a, *b)) && source == s2 && ocr == o2
            }
            (Signature::Text(a), Signature::Text(b)) => a == b,
            _ => false,
        }
    }
}

fn xy(p: &Point) -> (f64, f64) {
    (p.x, p.y)
}

impl Signature {
    pub fn of_stroke(s: &Stroke) -> Self {
        Signature::Stroke {
            len: s.pts.len(),
            first: s.pts.first().map(xy),
            last: s.pts.last().map(xy),
            color: s.color.clone(),
            size: s.size,
            shape: s.shape.clone(),
        }
    }
    pub fn of_image(i: &Image) -> Self {
        let source = match (i.r#ref.as_deref().filter(|r| !r.is_empty()), i.src.as_deref().filter(|s| !s.is_empty())) {
            (Some(r), _) => ImageSource::Ref(r.to_owned()),
            (None, Some(src)) => ImageSource::SrcLen(js_len(src)),
            _ => ImageSource::Json(serde_json::to_string(i).unwrap_or_default()),
        };
        Signature::Image { rect: [i.x, i.y, i.w, i.h], source, ocr: i.ocr.clone() }
    }
    pub fn of_text(t: &TextBox) -> Self {
        let mut t = t.clone();
        t.h = None;
        t.extra.remove("h");
        t.extra.remove("hidden");
        Signature::Text(serde_json::to_string(&t).unwrap_or_default())
    }
    fn of_item(item: &Item) -> Self {
        match item {
            Item::Stroke(s) => Self::of_stroke(s),
            Item::Image(i) => Self::of_image(i),
            Item::Text(t) => Self::of_text(t),
        }
    }
}

/// Signaturen in Einfügereihenfolge (wie eine JS-`Map`).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Signatures {
    keys: Vec<String>,
    map: HashMap<String, Signature>,
}

impl Signatures {
    pub fn get(&self, id: &str) -> Option<&Signature> {
        self.map.get(id)
    }
    pub fn len(&self) -> usize {
        self.keys.len()
    }
    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }
    /// IDs in Einfügereihenfolge.
    pub fn ids(&self) -> impl Iterator<Item = &str> {
        self.keys.iter().map(String::as_str)
    }
    fn set(&mut self, id: &str, sig: Signature) {
        if self.map.insert(id.to_owned(), sig).is_none() {
            self.keys.push(id.to_owned());
        }
    }
    fn remove_all(&mut self, ids: &[String]) {
        let gone: HashSet<&str> = ids.iter().map(String::as_str).filter(|id| self.map.contains_key(*id)).collect();
        if gone.is_empty() {
            return;
        }
        for id in &gone {
            self.map.remove(*id);
        }
        self.keys.retain(|k| !gone.contains(k.as_str()));
    }
}

/// Schatten einer Seite: Kopfdaten und Signaturen ihrer Elemente.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ShadowPage {
    pub id: String,
    pub paper: Paper,
    pub ocr_text: String,
    pub ocr_src: String,
    pub ocr_key: String,
    /// Signatur des Seitenhintergrunds (`bg`).
    pub background: Option<Signature>,
    pub strokes: Signatures,
    pub images: Signatures,
    pub texts: Signatures,
}

impl ShadowPage {
    fn items_mut(&mut self, kind: ItemKind) -> &mut Signatures {
        match kind {
            ItemKind::Stroke => &mut self.strokes,
            ItemKind::Image => &mut self.images,
            ItemKind::Text => &mut self.texts,
        }
    }
}

/// Der zuletzt veröffentlichte Stand eines Hefts in Signaturen (`documentShadow`).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Shadow {
    pub pages: Vec<ShadowPage>,
}

fn signatures<'a, T: 'a>(
    items: impl IntoIterator<Item = &'a T>,
    id: impl Fn(&T) -> &str,
    sig: impl Fn(&T) -> Signature,
) -> Signatures {
    let mut out = Signatures::default();
    for item in items {
        let id = id(item);
        if !id.is_empty() {
            out.set(id, sig(item));
        }
    }
    out
}

impl Shadow {
    pub fn of(doc: &HeftDoc) -> Self {
        Shadow {
            pages: doc
                .pages
                .iter()
                .map(|p| ShadowPage {
                    id: p.id.clone(),
                    paper: p.paper.clone(),
                    ocr_text: p.ocr_text.clone(),
                    ocr_src: p.ocr_src.clone(),
                    ocr_key: p.ocr_key.clone(),
                    background: p.background.as_ref().map(Signature::of_image),
                    strokes: signatures(&p.strokes, |s| &s.id, Signature::of_stroke),
                    images: signatures(&p.images, |s| &s.id, Signature::of_image),
                    texts: signatures(&p.texts, |s| &s.id, Signature::of_text),
                })
                .collect(),
        }
    }

    /// Schreibt Log-Operationen fort – mit denselben Regeln wie [`HeftDoc::apply_op`]
    /// (`applyOpsToShadow`). So zeigt der Schatten immer den Stand im Log, auch wenn das offene
    /// Dokument schon lokale, noch nicht gespeicherte Änderungen trägt.
    pub fn apply_ops<'a>(&mut self, ops: impl IntoIterator<Item = &'a HeftOp>) {
        for op in ops {
            let page = op.page().and_then(|id| self.pages.iter().position(|p| p.id == id));
            match op {
                HeftOp::PageAdd { at, page: id, paper, .. } => {
                    if !self.pages.iter().any(|p| &p.id == id) {
                        let i = insert_index(*at, self.pages.len());
                        let paper = paper.clone().unwrap_or_default();
                        self.pages.insert(i, ShadowPage { id: id.clone(), paper, ..Default::default() });
                    }
                }
                HeftOp::PageRemove { .. } => {
                    if let Some(i) = page {
                        self.pages.remove(i);
                    }
                }
                HeftOp::PageOrder { order } => reorder(&mut self.pages, order, |p| &p.id),
                HeftOp::PagePaper { paper, .. } => {
                    if let Some(i) = page {
                        self.pages[i].paper = paper.clone();
                    }
                }
                HeftOp::PageBackground { bg, .. } => {
                    if let Some(i) = page {
                        self.pages[i].background = bg.as_ref().map(Signature::of_image);
                    }
                }
                HeftOp::Ocr { text, src, key, .. } => {
                    if let Some(i) = page {
                        let p = &mut self.pages[i];
                        if crate::ocr::accepts(&p.ocr_src, &p.ocr_key, src, key) {
                            p.ocr_text = text.clone();
                            p.ocr_src = src.clone();
                            p.ocr_key = key.clone();
                        }
                    }
                }
                HeftOp::Add { item, .. } | HeftOp::Set { item, .. } => {
                    let Some(i) = page else { continue };
                    let items = self.pages[i].items_mut(item.kind());
                    if matches!(op, HeftOp::Set { .. }) || items.get(item.id()).is_none() {
                        items.set(item.id(), Signature::of_item(item));
                    }
                }
                HeftOp::Remove { kind, ids, .. } => {
                    if let Some(i) = page {
                        self.pages[i].items_mut(*kind).remove_all(ids);
                    }
                }
                HeftOp::Other(_) => {}
            }
        }
    }
}

/// Ein Seiten-Element im Diff.
trait DiffItem {
    const KIND: ItemKind;
    fn id(&self) -> &str;
    fn signature(&self) -> Signature;
    fn item(&self) -> Item;
}

impl DiffItem for Stroke {
    const KIND: ItemKind = ItemKind::Stroke;
    fn id(&self) -> &str {
        &self.id
    }
    fn signature(&self) -> Signature {
        Signature::of_stroke(self)
    }
    fn item(&self) -> Item {
        Item::Stroke(self.clone())
    }
}

impl DiffItem for Image {
    const KIND: ItemKind = ItemKind::Image;
    fn id(&self) -> &str {
        &self.id
    }
    fn signature(&self) -> Signature {
        Signature::of_image(self)
    }
    fn item(&self) -> Item {
        Item::Image(self.clone())
    }
}

impl DiffItem for TextBox {
    const KIND: ItemKind = ItemKind::Text;
    fn id(&self) -> &str {
        &self.id
    }
    fn signature(&self) -> Signature {
        Signature::of_text(self)
    }
    fn item(&self) -> Item {
        Item::Text(self.clone())
    }
}

/// Vergleicht die Elemente einer Art und liefert die neuen Signaturen (`diffItems`).
fn diff_items<T: DiffItem>(
    ops: &mut Vec<HeftOp>,
    page: &str,
    previous: Option<&Signatures>,
    items: &[T],
) -> Signatures {
    let mut current = Signatures::default();
    let mut kept: HashSet<&str> = HashSet::new();
    for item in items {
        let item_id = item.id();
        if item_id.is_empty() {
            continue;
        }
        let s = item.signature();
        match previous.and_then(|p| p.get(item_id)) {
            None => ops.push(HeftOp::Add { page: page.to_owned(), item: item.item() }),
            Some(old) => {
                kept.insert(item_id);
                if *old != s {
                    ops.push(HeftOp::Set { page: page.to_owned(), item: item.item() });
                }
            }
        }
        current.set(item_id, s);
    }
    if let Some(prev) = previous {
        let removed: Vec<String> = prev.ids().filter(|id| !kept.contains(id)).map(str::to_owned).collect();
        if !removed.is_empty() {
            ops.push(HeftOp::Remove { page: page.to_owned(), kind: T::KIND, ids: removed });
        }
    }
    current
}

/// Operationen, die `previous` (fehlt: leeres Heft) in `next` überführen, und der Schatten
/// von `next` für den nächsten Vergleich (`diffDocument`).
///
/// Reihenfolge wie in JS: entfernte Seiten, neue Seiten, Reihenfolge (nur wenn neu oder
/// geändert), dann je Seite Papier, Text, Striche, Bilder, Textfelder.
pub fn diff_document(previous: Option<&Shadow>, next: &HeftDoc) -> (Vec<HeftOp>, Shadow) {
    let old_pages: &[ShadowPage] = previous.map_or(&[], |p| &p.pages);
    let entries: Vec<(&str, Option<&HeftPage>)> = next.pages.iter().map(|p| (p.id.as_str(), Some(p))).collect();
    diff_ordered(old_pages, &entries).expect("jede Seite liegt vor")
}

/// Wie [`diff_document`], aber nur die Seiten in `changed` werden verglichen; alle übrigen
/// Seiten aus `order` gelten als unverändert (ihr Schatten bleibt). So kostet ein Strich auf
/// einem dicken Heft eine Seite statt des ganzen Dokuments (`HeftShadow.diffPages`).
/// `None`, wenn eine Seite aus `order` weder im Schatten noch in `changed` steht.
pub fn diff_pages(previous: &Shadow, order: &[String], changed: &[HeftPage]) -> Option<(Vec<HeftOp>, Shadow)> {
    let by_id: HashMap<&str, &HeftPage> = changed.iter().map(|p| (p.id.as_str(), p)).collect();
    let entries: Vec<(&str, Option<&HeftPage>)> = order.iter().map(|id| (id.as_str(), by_id.get(id.as_str()).copied())).collect();
    diff_ordered(&previous.pages, &entries)
}

/// entries: Seiten-IDs in neuer Reihenfolge, je mit der Seite oder `None` (= unverändert).
fn diff_ordered(old_pages: &[ShadowPage], entries: &[(&str, Option<&HeftPage>)]) -> Option<(Vec<HeftOp>, Shadow)> {
    let mut ops = Vec::new();
    let old_by_id: HashMap<&str, &ShadowPage> = old_pages.iter().map(|p| (p.id.as_str(), p)).collect();
    if entries.iter().any(|(id, page)| page.is_none() && !old_by_id.contains_key(id)) {
        return None;
    }
    let next_ids: HashSet<&str> = entries.iter().map(|(id, _)| *id).collect();

    for p in old_pages {
        if !next_ids.contains(p.id.as_str()) {
            ops.push(HeftOp::PageRemove { page: p.id.clone() });
        }
    }
    let mut added = false;
    for (i, (id, page)) in entries.iter().enumerate() {
        if let (false, Some(p)) = (old_by_id.contains_key(id), page) {
            ops.push(HeftOp::PageAdd { at: Some(i as f64), page: p.id.clone(), paper: Some(p.paper.clone()), height: p.height });
            added = true;
        }
    }
    // Die Reihenfolge wird nur übertragen, wenn sie sich tatsächlich geändert hat.
    let kept_before = old_pages.iter().filter(|p| next_ids.contains(p.id.as_str())).map(|p| p.id.as_str());
    let kept_after = entries.iter().map(|(id, _)| *id).filter(|id| old_by_id.contains_key(id));
    if added || !kept_before.eq(kept_after) {
        ops.push(HeftOp::PageOrder { order: entries.iter().map(|(id, _)| (*id).to_owned()).collect() });
    }

    let shadow = entries
        .iter()
        .map(|(id, page)| {
            let old = old_by_id.get(id).copied();
            match page {
                Some(page) => diff_page(&mut ops, old, page),
                None => old.expect("oben geprüft").clone(),
            }
        })
        .collect();
    Some((ops, Shadow { pages: shadow }))
}

fn diff_page(ops: &mut Vec<HeftOp>, old: Option<&ShadowPage>, page: &HeftPage) -> ShadowPage {
    if let Some(old) = old
        && old.paper != page.paper
    {
        ops.push(HeftOp::PagePaper { page: page.id.clone(), paper: page.paper.clone() });
    }
    if old.map_or(("", "", ""), |o| (o.ocr_text.as_str(), o.ocr_src.as_str(), o.ocr_key.as_str()))
        != (page.ocr_text.as_str(), page.ocr_src.as_str(), page.ocr_key.as_str())
    {
        ops.push(HeftOp::Ocr {
            page: page.id.clone(),
            text: page.ocr_text.clone(),
            src: page.ocr_src.clone(),
            key: page.ocr_key.clone(),
        });
    }
    let background = page.background.as_ref().map(Signature::of_image);
    if old.and_then(|o| o.background.as_ref()) != background.as_ref() {
        let had = old.is_some_and(|o| o.background.is_some());
        ops.extend(background_ops(&page.id, had, page.background.clone()));
    }
    let id = &page.id;
    ShadowPage {
        id: id.clone(),
        paper: page.paper.clone(),
        ocr_text: page.ocr_text.clone(),
        ocr_src: page.ocr_src.clone(),
        ocr_key: page.ocr_key.clone(),
        background,
        strokes: diff_items(ops, id, old.map(|o| &o.strokes), &page.strokes),
        images: diff_items(ops, id, old.map(|o| &o.images), &page.images),
        texts: diff_items(ops, id, old.map(|o| &o.texts), &page.texts),
    }
}
