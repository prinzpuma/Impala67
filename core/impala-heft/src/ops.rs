//! Heft-Operationen (`heftOps`) und ihr Anwenden – wie der Reducer in `state.js`
//! (`applyHeftOps`, `heftSnap`, `heftBlob`).
//!
//! Die Form der Operationen macht das Zusammenführen konfliktfrei: Hinzufügen ist
//! idempotent (gleiche ID = einmal), Entfernen ebenso (fehlt schon = nichts zu tun),
//! Ersetzen ist Last-Write-Wins über die Log-Reihenfolge.

use std::cell::{OnceCell, RefCell};
use std::collections::{BTreeMap, HashMap};

use serde::de::{Deserialize, Deserializer};
use serde::ser::{Serialize, SerializeMap, Serializer};
use serde_json::Value;

use crate::doc::{HeftDoc, HeftPage, Image, Paper, Stroke, TextBox, truthy};
use crate::json::{id_str, non_empty, str_list};

/// Art eines Seiten-Elements: Buchstabe in `s+`, `i=`, `x-` …
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ItemKind {
    Stroke,
    Image,
    Text,
}

impl ItemKind {
    fn letter(self) -> char {
        match self {
            ItemKind::Stroke => 's',
            ItemKind::Image => 'i',
            ItemKind::Text => 'x',
        }
    }
    fn from_letter(c: u8) -> Option<Self> {
        Some(match c {
            b's' => ItemKind::Stroke,
            b'i' => ItemKind::Image,
            b'x' => ItemKind::Text,
            _ => return None,
        })
    }
}

/// Ein Seiten-Element.
#[derive(Debug, Clone, PartialEq)]
pub enum Item {
    Stroke(Stroke),
    Image(Image),
    Text(TextBox),
}

impl Item {
    pub fn id(&self) -> &str {
        match self {
            Item::Stroke(s) => &s.id,
            Item::Image(i) => &i.id,
            Item::Text(t) => &t.id,
        }
    }
    pub fn kind(&self) -> ItemKind {
        match self {
            Item::Stroke(_) => ItemKind::Stroke,
            Item::Image(_) => ItemKind::Image,
            Item::Text(_) => ItemKind::Text,
        }
    }
    fn parse(kind: ItemKind, v: Value) -> Option<Self> {
        Some(match kind {
            ItemKind::Stroke => Item::Stroke(Stroke::from_value(v)?),
            ItemKind::Image => Item::Image(Image::from_value(v)?),
            ItemKind::Text => Item::Text(TextBox::from_value(v)?),
        })
    }
}

impl Serialize for Item {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Item::Stroke(x) => x.serialize(s),
            Item::Image(x) => x.serialize(s),
            Item::Text(x) => x.serialize(s),
        }
    }
}

/// Eine Heft-Operation. `page` ist die ID der Heftseite (`p` im JSON).
#[derive(Debug, Clone, PartialEq)]
pub enum HeftOp {
    /// `pg+`: neue leere Seite an Position `at` (fehlt: hinten).
    PageAdd { at: Option<f64>, page: String, paper: Option<Paper> },
    /// `pg-`
    PageRemove { page: String },
    /// `pgo`: neue Reihenfolge; unbekannte Seiten hängen hinten an.
    PageOrder { order: Vec<String> },
    /// `pgp`
    PagePaper { page: String, paper: Paper },
    /// `ocr`: Handschrift-Text der Seite.
    Ocr { page: String, text: String },
    /// `s+`/`i+`/`x+`: fügt hinzu, wenn die ID noch fehlt.
    Add { page: String, item: Item },
    /// `s=`/`i=`/`x=`: ersetzt den Inhalt (Position bleibt) oder hängt an.
    Set { page: String, item: Item },
    /// `s-`/`i-`/`x-`
    Remove { page: String, kind: ItemKind, ids: Vec<String> },
    /// Unbekannte oder unvollständige Operation: wird übersprungen, bleibt aber erhalten.
    Other(Value),
}

impl HeftOp {
    /// Liest eine Operation aus dem Log. Was der Reducer überspringen würde, wird [`HeftOp::Other`].
    pub fn from_value(v: Value) -> Self {
        Self::parse(&v).unwrap_or(HeftOp::Other(v))
    }

    fn parse(v: &Value) -> Option<Self> {
        let t = v.get("t")?.as_str()?;
        let page = || non_empty(v.get("p"));
        Some(match t {
            "pg+" => {
                let pg = v.get("page")?;
                let id = pg.get("id").filter(|i| truthy(i)).and_then(id_str)?;
                let paper = pg.get("paper").filter(|p| truthy(p)).map(|p| Paper::parse(Some(p)));
                HeftOp::PageAdd { at: v.get("at").and_then(Value::as_f64), page: id, paper }
            }
            "pg-" => HeftOp::PageRemove { page: page()? },
            "pgo" => HeftOp::PageOrder { order: str_list(v.get("order")) },
            "pgp" => HeftOp::PagePaper { page: page()?, paper: Paper::parse(v.get("paper")) },
            "ocr" => {
                HeftOp::Ocr { page: page()?, text: v.get("text").and_then(Value::as_str).unwrap_or("").to_owned() }
            }
            _ => {
                let b = t.as_bytes();
                if b.len() != 2 {
                    return None;
                }
                let kind = ItemKind::from_letter(b[0])?;
                let page = page()?;
                match b[1] {
                    b'-' => HeftOp::Remove { page, kind, ids: str_list(v.get("ids")) },
                    b'+' | b'=' => {
                        let o = v.get("o").filter(|o| o.get("id").is_some_and(truthy))?;
                        let item = Item::parse(kind, o.clone())?;
                        if b[1] == b'+' { HeftOp::Add { page, item } } else { HeftOp::Set { page, item } }
                    }
                    _ => return None,
                }
            }
        })
    }

    /// Seiten-ID, auf die sich die Operation bezieht (nicht bei `pg+`/`pgo`).
    pub fn page(&self) -> Option<&str> {
        match self {
            HeftOp::PageRemove { page }
            | HeftOp::PagePaper { page, .. }
            | HeftOp::Ocr { page, .. }
            | HeftOp::Add { page, .. }
            | HeftOp::Set { page, .. }
            | HeftOp::Remove { page, .. } => Some(page),
            _ => None,
        }
    }
}

impl Serialize for HeftOp {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let code = |kind: &ItemKind, c: char| format!("{}{c}", kind.letter());
        if let HeftOp::Other(v) = self {
            return v.serialize(s);
        }
        let mut m = s.serialize_map(None)?;
        match self {
            HeftOp::Other(_) => {}
            HeftOp::PageAdd { at, page, paper } => {
                m.serialize_entry("t", "pg+")?;
                if let Some(at) = at {
                    m.serialize_entry("at", &crate::json::JsNum(*at))?;
                }
                m.serialize_entry("page", &PageRef(page, paper.as_ref()))?;
            }
            HeftOp::PageRemove { page } => {
                m.serialize_entry("t", "pg-")?;
                m.serialize_entry("p", page)?;
            }
            HeftOp::PageOrder { order } => {
                m.serialize_entry("t", "pgo")?;
                m.serialize_entry("order", order)?;
            }
            HeftOp::PagePaper { page, paper } => {
                m.serialize_entry("t", "pgp")?;
                m.serialize_entry("p", page)?;
                m.serialize_entry("paper", paper)?;
            }
            HeftOp::Ocr { page, text } => {
                m.serialize_entry("t", "ocr")?;
                m.serialize_entry("p", page)?;
                m.serialize_entry("text", text)?;
            }
            HeftOp::Add { page, item } | HeftOp::Set { page, item } => {
                let c = if matches!(self, HeftOp::Add { .. }) { '+' } else { '=' };
                m.serialize_entry("t", &code(&item.kind(), c))?;
                m.serialize_entry("p", page)?;
                m.serialize_entry("o", item)?;
            }
            HeftOp::Remove { page, kind, ids } => {
                m.serialize_entry("t", &code(kind, '-'))?;
                m.serialize_entry("p", page)?;
                m.serialize_entry("ids", ids)?;
            }
        }
        m.end()
    }
}

/// `{ id, paper? }` in `pg+`.
struct PageRef<'a>(&'a String, Option<&'a Paper>);

impl Serialize for PageRef<'_> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut m = s.serialize_map(None)?;
        m.serialize_entry("id", self.0)?;
        if let Some(p) = self.1 {
            m.serialize_entry("paper", p)?;
        }
        m.end()
    }
}

impl<'de> Deserialize<'de> for HeftOp {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Value::deserialize(d).map(HeftOp::from_value)
    }
}

/// Liest eine Op-Liste; Nicht-Listen sind leer.
pub fn parse_ops(v: Value) -> Vec<HeftOp> {
    match v {
        Value::Array(a) => a.into_iter().map(HeftOp::from_value).collect(),
        _ => Vec::new(),
    }
}

/// Stabile Umsortierung nach `order` (erster Treffer zählt, Unbekannte hinten).
pub(crate) fn reorder<T>(items: &mut Vec<T>, order: &[String], id: impl Fn(&T) -> &str) {
    let mut pos: HashMap<&str, usize> = HashMap::with_capacity(order.len());
    for (i, o) in order.iter().enumerate() {
        pos.entry(o.as_str()).or_insert(i);
    }
    let mut keyed: Vec<(usize, T)> =
        items.drain(..).map(|t| (pos.get(id(&t)).copied().unwrap_or(usize::MAX), t)).collect();
    keyed.sort_by_key(|(rank, _)| *rank);
    items.extend(keyed.into_iter().map(|(_, t)| t));
}

/// Einfügeposition wie `Math.max(0, Math.min(at ?? len, len))` samt `splice`-Abrundung.
pub(crate) fn insert_index(at: Option<f64>, len: usize) -> usize {
    let at = at.unwrap_or(len as f64);
    if at.is_nan() { 0 } else { at.clamp(0.0, len as f64) as usize }
}

fn replace_or_push<T>(list: &mut Vec<T>, item: T, id: impl Fn(&T) -> &str) {
    let key = id(&item).to_owned();
    match list.iter_mut().find(|x| id(x) == key) {
        Some(slot) => *slot = item,
        None => list.push(item),
    }
}

impl HeftPage {
    fn add(&mut self, item: Item) {
        match item {
            Item::Stroke(s) if !self.strokes.iter().any(|x| x.id == s.id) => self.strokes.push(s),
            Item::Image(i) if !self.images.iter().any(|x| x.id == i.id) => self.images.push(i),
            Item::Text(t) if !self.texts.iter().any(|x| x.id == t.id) => self.texts.push(t),
            _ => {}
        }
    }
    fn set(&mut self, item: Item) {
        match item {
            Item::Stroke(s) => replace_or_push(&mut self.strokes, s, |x| &x.id),
            Item::Image(i) => replace_or_push(&mut self.images, i, |x| &x.id),
            Item::Text(t) => replace_or_push(&mut self.texts, t, |x| &x.id),
        }
    }
    fn remove(&mut self, kind: ItemKind, ids: &[String]) {
        let gone: std::collections::HashSet<&str> = ids.iter().map(String::as_str).collect();
        match kind {
            ItemKind::Stroke => self.strokes.retain(|x| !gone.contains(x.id.as_str())),
            ItemKind::Image => self.images.retain(|x| !gone.contains(x.id.as_str())),
            ItemKind::Text => self.texts.retain(|x| !gone.contains(x.id.as_str())),
        }
    }
}

impl HeftDoc {
    /// Wendet eine Operation an (ohne `rev` zu zählen).
    pub fn apply_op(&mut self, op: HeftOp) {
        match op {
            HeftOp::PageAdd { at, page, paper } => {
                // Zwei Geräte hängen gleichzeitig eine Seite an: beide bleiben erhalten.
                if self.page(&page).is_none() {
                    let i = insert_index(at, self.pages.len());
                    self.pages.insert(i, HeftPage::empty(page, paper.unwrap_or_default()));
                }
            }
            HeftOp::PageRemove { page } => {
                if let Some(i) = self.pages.iter().position(|p| p.id == page) {
                    self.pages.remove(i);
                }
            }
            HeftOp::PageOrder { order } => reorder(&mut self.pages, &order, |p| &p.id),
            HeftOp::PagePaper { page, paper } => {
                if let Some(pg) = self.page_mut(&page) {
                    pg.paper = paper;
                }
            }
            HeftOp::Ocr { page, text } => {
                if let Some(pg) = self.page_mut(&page) {
                    pg.ocr_text = text;
                }
            }
            HeftOp::Add { page, item } if !item.id().is_empty() => {
                if let Some(pg) = self.page_mut(&page) {
                    pg.add(item);
                }
            }
            HeftOp::Set { page, item } if !item.id().is_empty() => {
                if let Some(pg) = self.page_mut(&page) {
                    pg.set(item);
                }
            }
            HeftOp::Remove { page, kind, ids } => {
                if let Some(pg) = self.page_mut(&page) {
                    pg.remove(kind, &ids);
                }
            }
            _ => {}
        }
    }

    /// Wendet ein `heftOps`-Event an wie der Reducer: alle Operationen in Reihenfolge, danach
    /// `rev + 1`. Eine leere Liste ändert nichts (auch `rev` nicht) und liefert `false`.
    pub fn apply_ops(&mut self, ops: impl IntoIterator<Item = HeftOp>) -> bool {
        let mut any = false;
        for op in ops {
            any = true;
            self.apply_op(op);
        }
        if any {
            self.rev += 1;
        }
        any
    }

    /// Operationen, die ein leeres Heft in dieses überführen (`heftBaselineOps`, Sync-Basis).
    pub fn baseline_ops(&self) -> Vec<HeftOp> {
        let mut ops: Vec<HeftOp> = self
            .pages
            .iter()
            .enumerate()
            .map(|(at, p)| HeftOp::PageAdd { at: Some(at as f64), page: p.id.clone(), paper: Some(p.paper.clone()) })
            .collect();
        if !self.pages.is_empty() {
            ops.push(HeftOp::PageOrder { order: self.pages.iter().map(|p| p.id.clone()).collect() });
        }
        for p in &self.pages {
            let page = || p.id.clone();
            if !p.ocr_text.is_empty() {
                ops.push(HeftOp::Ocr { page: page(), text: p.ocr_text.clone() });
            }
            ops.extend(p.strokes.iter().map(|s| HeftOp::Add { page: page(), item: Item::Stroke(s.clone()) }));
            ops.extend(p.images.iter().map(|s| HeftOp::Add { page: page(), item: Item::Image(s.clone()) }));
            ops.extend(p.texts.iter().map(|s| HeftOp::Add { page: page(), item: Item::Text(s.clone()) }));
        }
        ops
    }
}

/// Ein Heft-Event des Logs, so weit der Reducer es auswertet.
#[derive(Debug, Clone, PartialEq)]
pub enum HeftEvent {
    /// `heftOps { pageId, ops }`
    Ops { page_id: String, ops: Vec<HeftOp> },
    /// `heftSnap { pageId, doc }`: ersetzt das ganze Heft (Verdichtung).
    Snap { page_id: String, doc: HeftDoc },
    /// `heftBlob { hash, data }`: unveränderliche Bilddaten.
    Blob { hash: String, data: String },
}

impl HeftEvent {
    /// Liest die Payload eines Heft-Events. `None`: anderer Typ oder ein Event, das der
    /// Reducer überspringt (fehlende `pageId`, leere Ops, Snapshot ohne Seitenliste …).
    pub fn from_payload(kind: &str, payload: Value) -> Option<Self> {
        match kind {
            "heftOps" => {
                let page_id = non_empty(payload.get("pageId"))?;
                let ops = payload.get("ops").and_then(Value::as_array).filter(|a| !a.is_empty())?;
                Some(HeftEvent::Ops { page_id, ops: ops.iter().cloned().map(HeftOp::from_value).collect() })
            }
            "heftSnap" => {
                let page_id = non_empty(payload.get("pageId"))?;
                let pages = payload.get("doc").filter(|d| truthy(d))?.get("pages")?.as_array()?;
                let mut out = Vec::with_capacity(pages.len());
                for pg in pages {
                    // JS liest `pg.id` – bei `null` wirft das, und der Reducer überspringt das Event.
                    if pg.is_null() {
                        return None;
                    }
                    let mut page = HeftPage::from_value(pg.clone());
                    page.extra.clear(); // der Reducer übernimmt nur die bekannten Felder
                    out.push(page);
                }
                Some(HeftEvent::Snap { page_id, doc: HeftDoc { pages: out, ..Default::default() } })
            }
            "heftBlob" => {
                let hash = non_empty(payload.get("hash"))?;
                let data = non_empty(payload.get("data"))?;
                Some(HeftEvent::Blob { hash, data })
            }
            _ => None,
        }
    }
}

/// Ein Heft im Speicher: gelesen oder – nach dem Start aus einem Checkpoint – noch als gespeicherter
/// JSON-Text, der erst beim ersten Zugriff gelesen wird. Ein großes Heft kostet so beim Start
/// fast nichts, und solange es unverändert bleibt, schreibt der nächste Checkpoint es nicht neu.
#[derive(Debug, Clone, Default)]
struct Slot {
    doc: OnceCell<HeftDoc>,
    /// Gespeicherter Text, bis er gelesen wird (danach freigegeben).
    json: RefCell<Option<String>>,
    /// Inhalts-Hash des gespeicherten Stands, solange das Heft seitdem unverändert ist.
    hash: Option<String>,
}

impl Slot {
    fn doc(&self) -> &HeftDoc {
        self.doc.get_or_init(|| {
            // Der Text wurde beim Start geprüft; lesbares JSON ergibt immer ein Heft.
            let json = self.json.borrow_mut().take();
            json.and_then(|j| serde_json::from_str(&j).ok()).unwrap_or_default()
        })
    }

    fn doc_mut(&mut self) -> &mut HeftDoc {
        self.doc();
        self.hash = None;
        self.doc.get_mut().expect("gerade gelesen")
    }
}

/// Alle Hefte und ihre Bilddaten (`S.heftDocs`, `S.heftBlobs`).
#[derive(Debug, Clone, Default)]
pub struct Hefte {
    docs: BTreeMap<String, Slot>,
    /// Hash → dataURL; der erste Eintrag eines Hashes gewinnt (gleicher Hash = gleicher Inhalt).
    pub blobs: BTreeMap<String, String>,
}

impl PartialEq for Hefte {
    fn eq(&self, o: &Self) -> bool {
        self.blobs == o.blobs && self.docs.len() == o.docs.len() && self.iter().eq(o.iter())
    }
}

impl Hefte {
    /// Ein Heft (liest es beim ersten Zugriff).
    pub fn get(&self, page_id: &str) -> Option<&HeftDoc> {
        self.docs.get(page_id).map(Slot::doc)
    }

    /// Ein Heft zum Ändern; es gilt danach nicht mehr als gespeichert.
    pub fn get_mut(&mut self, page_id: &str) -> Option<&mut HeftDoc> {
        self.docs.get_mut(page_id).map(Slot::doc_mut)
    }

    pub fn insert(&mut self, page_id: String, doc: HeftDoc) {
        self.docs.insert(page_id, Slot { doc: OnceCell::from(doc), ..Slot::default() });
    }

    /// Ein gespeichertes Heft (JSON-Text samt Inhalts-Hash) übernehmen, ohne es schon zu lesen.
    /// Der Aufrufer prüft vorher, dass der Text gültiges JSON ist.
    pub fn insert_stored(&mut self, page_id: String, json: String, hash: String) {
        self.docs.insert(page_id, Slot { doc: OnceCell::new(), json: RefCell::new(Some(json)), hash: Some(hash) });
    }

    pub fn remove(&mut self, page_id: &str) -> bool {
        self.docs.remove(page_id).is_some()
    }

    pub fn contains(&self, page_id: &str) -> bool {
        self.docs.contains_key(page_id)
    }

    pub fn len(&self) -> usize {
        self.docs.len()
    }

    pub fn is_empty(&self) -> bool {
        self.docs.is_empty()
    }

    /// Seiten-IDs aller Hefte (ohne sie zu lesen).
    pub fn ids(&self) -> impl Iterator<Item = &String> {
        self.docs.keys()
    }

    /// Alle Hefte (liest jedes beim ersten Zugriff).
    pub fn iter(&self) -> impl Iterator<Item = (&String, &HeftDoc)> {
        self.docs.iter().map(|(k, s)| (k, s.doc()))
    }

    /// Inhalts-Hash des gespeicherten Stands, solange das Heft unverändert ist.
    pub fn stored_hash(&self, page_id: &str) -> Option<&str> {
        self.docs.get(page_id)?.hash.as_deref()
    }

    /// Nach dem Speichern: Das Heft liegt unter `hash` vor (bis zur nächsten Änderung).
    pub fn set_stored_hash(&mut self, page_id: &str, hash: String) {
        if let Some(slot) = self.docs.get_mut(page_id) {
            slot.hash = Some(hash);
        }
    }

    /// Ist das Heft schon gelesen?
    pub fn is_loaded(&self, page_id: &str) -> bool {
        self.docs.get(page_id).is_some_and(|s| s.doc.get().is_some())
    }

    /// Wendet ein Event an. `true`, wenn sich ein Heft geändert hat bzw. Bilddaten neu sind.
    pub fn apply(&mut self, ev: HeftEvent) -> bool {
        match ev {
            HeftEvent::Ops { page_id, ops } => self.docs.entry(page_id).or_default().doc_mut().apply_ops(ops),
            HeftEvent::Snap { page_id, mut doc } => {
                doc.rev = 1; // rev 0, danach zählt das Event wie jedes andere
                self.insert(page_id, doc);
                true
            }
            HeftEvent::Blob { hash, data } => {
                if self.blobs.contains_key(&hash) {
                    return false;
                }
                self.blobs.insert(hash, data);
                true
            }
        }
    }

    /// Bildreferenzen aller Hefte (für Aufräumen und Sync).
    pub fn referenced_blobs(&self) -> Vec<&str> {
        let mut out: Vec<&str> = self
            .iter()
            .flat_map(|(_, d)| d.pages.iter())
            .flat_map(|p| p.images.iter())
            .filter_map(|i| i.r#ref.as_deref())
            .filter(|r| !r.is_empty())
            .collect();
        out.sort_unstable();
        out.dedup();
        out
    }
}
