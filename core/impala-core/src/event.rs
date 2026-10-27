//! Event-Log-Einträge, reduziert auf das, worüber die Kompaktierung entscheidet.
//!
//! Gelesen wird nur ein schmaler Ausschnitt (Typ, Zeit, seq, Ziel-ID, Patch-Schlüssel,
//! Heft-Referenzen). Seiteninhalte, Striche usw. bleiben, wo sie sind: Die Kompaktierung
//! liefert nur zurück, WELCHE Einträge überleben.
//!
//! Das Log ist lose typisiert (alte App-Versionen, fremde Geräte). Felder, die eine Regel
//! liest, werden darum JS-genau ausgewertet (falsy, `== null`, …). Sieht ein Feld anders aus,
//! als JS es sinnvoll verarbeiten kann, liefert [`decode`] [`Unsupported`] – der Aufrufer nimmt
//! dann die JS-Implementierung. So gibt der Kern entweder exakt dasselbe Ergebnis oder keins.

use std::fmt;

/// Ein Log-Eintrag: Zeitstempel, lokale Reihenfolge und das, was die Regeln lesen.
#[derive(Debug, Clone, PartialEq)]
pub struct Event {
    pub t: String,
    /// Lokale IndexedDB-Nummer; fehlt bei Wire-Events (dann 0 wie `seq || 0` in JS).
    pub seq: u64,
    pub body: Body,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Body {
    /// `None`: Event ohne Payload, löscht nichts.
    PageDelete(Option<String>),
    CardDelete(Option<String>),
    /// `None`: Event ohne Payload, wird nie verworfen.
    PageUpdate(Option<Update>),
    CardUpdate(Option<Update>),
    /// Schlüssel des Einstellungs-Patches (die Payload selbst).
    SettingsSet(Vec<String>),
    /// Gesamtsnapshot der offenen Tabs.
    UiTabsSet,
    /// `None`: Event ohne Schlüssel, wird verworfen.
    UiTreeSet(Option<String>),
    /// `None`: ohne ID nicht als Schnappschuss erkennbar.
    ChatUpsert(Option<Snapshot>),
    HomeArticleUpsert(Option<Snapshot>),
    /// Bild-Referenzen aus `heftOps` bzw. `heftSnap`.
    HeftRefs(Vec<String>),
    /// Inhalts-Hash eines Bildes; `None`: von nichts referenzierbar.
    HeftBlob(Option<String>),
    Other,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Update {
    pub id: String,
    /// `None`: kein Patch, das Event deckt nichts ab und wird nie verdeckt.
    pub patch: Option<Patch>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Patch {
    pub keys: Vec<String>,
    /// `typeof patch.content === "string"`: ein voller Inhalts-Stand (Seitenverlauf).
    pub has_content: bool,
}

/// Last-write-wins-Schnappschuss (Chat, Tagesartikel).
#[derive(Debug, Clone, PartialEq)]
pub struct Snapshot {
    pub id: String,
    /// `payload.updated`, leer wenn falsy (dann zählt `t`) – entscheidet, welcher gewinnt.
    pub updated: String,
    /// `payload.created || ""` – von den Tagesartikeln bleiben nur die neuesten.
    pub created: String,
}

// ---------------------------------------------------------------------------
// Lesezugriff auf JS-artige Werte

/// Grobe JS-Form eines Wertes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// `undefined` oder `null`
    Nullish,
    /// `false`, `0`, `NaN`
    Falsy,
    /// jeder String, auch `""`
    Str,
    Array,
    Object,
    /// `true`, andere Zahlen, Funktionen, …
    Other,
}

/// Die Felder, die die Kompaktierung liest.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Field {
    Type,
    T,
    Seq,
    Payload,
    Id,
    Patch,
    Content,
    Key,
    Updated,
    Created,
    Hash,
    Ops,
    O,
    Ref,
    Doc,
    Pages,
    Images,
}

impl Field {
    /// Alle Felder in Reihenfolge ihres Werts (`field as usize` indiziert hier hinein).
    pub const ALL: [Field; 17] = [
        Field::Type,
        Field::T,
        Field::Seq,
        Field::Payload,
        Field::Id,
        Field::Patch,
        Field::Content,
        Field::Key,
        Field::Updated,
        Field::Created,
        Field::Hash,
        Field::Ops,
        Field::O,
        Field::Ref,
        Field::Doc,
        Field::Pages,
        Field::Images,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Field::Type => "type",
            Field::T => "t",
            Field::Seq => "seq",
            Field::Payload => "payload",
            Field::Id => "id",
            Field::Patch => "patch",
            Field::Content => "content",
            Field::Key => "key",
            Field::Updated => "updated",
            Field::Created => "created",
            Field::Hash => "hash",
            Field::Ops => "ops",
            Field::O => "o",
            Field::Ref => "ref",
            Field::Doc => "doc",
            Field::Pages => "pages",
            Field::Images => "images",
        }
    }
}

/// Ein Wert, wie JS ihn sieht: JSON in Tests, `JsValue` in der PWA, später Plattform-Objekte.
/// Gefragt wird gezielt – große Werte (Seiteninhalt, Striche) werden nie kopiert.
pub trait JsLike: Sized {
    fn kind(&self) -> Kind;
    /// `obj[field]` eines Objekts oder Arrays; fehlend = `undefined`.
    fn get(&self, field: Field) -> Self;
    /// `Some` genau dann, wenn der Wert ein String ist.
    fn as_str(&self) -> Option<String>;
    /// `Some` genau dann, wenn der Wert eine Zahl ist.
    fn as_f64(&self) -> Option<f64>;
    /// `Object.keys` eines Objekts.
    fn keys(&self) -> Vec<String>;
    /// Elemente eines Arrays.
    fn items(&self) -> Vec<Self>;
}

/// Nicht kompaktierbarer Eintrag: Die JS-Implementierung entscheidet.
#[derive(Debug, Clone, PartialEq)]
pub struct Unsupported(pub String);

impl fmt::Display for Unsupported {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str(&self.0)
    }
}

type Result<T> = std::result::Result<T, Unsupported>;

fn unsupported<T>(what: &str) -> Result<T> {
    Err(Unsupported(format!("{what} hat eine unerwartete Form")))
}

/// `x ? x : None` für Felder, die Strings sein müssen, wenn sie wahr sind.
fn truthy_str<V: JsLike>(v: &V, what: &str) -> Result<Option<String>> {
    match v.as_str() {
        Some(s) => Ok(Some(s).filter(|s| !s.is_empty())),
        None => match v.kind() {
            Kind::Nullish | Kind::Falsy => Ok(None),
            _ => unsupported(what),
        },
    }
}

/// `x || []` vor einer `for…of`-Schleife.
fn list<V: JsLike>(v: &V, what: &str) -> Result<Vec<V>> {
    match v.kind() {
        Kind::Array => Ok(v.items()),
        Kind::Nullish | Kind::Falsy => Ok(Vec::new()),
        _ => unsupported(what),
    }
}

/// `x && x.ref`: nur ein nicht-leerer String kann einen Bild-Hash treffen.
fn push_ref<V: JsLike>(holder: &V, refs: &mut Vec<String>) -> Result<()> {
    if holder.kind() == Kind::Object {
        refs.extend(truthy_str(&holder.get(Field::Ref), "ref")?);
    }
    Ok(())
}

/// Ziel-ID von Seiten-/Karten-Events: muss ein String sein (JS nähme sonst `String(id)`).
fn target_id<V: JsLike>(payload: &V, kind: &str) -> Result<String> {
    match payload.get(Field::Id).as_str() {
        Some(id) => Ok(id),
        None => unsupported(&format!("{kind}: payload.id")),
    }
}

/// Liest einen Log-Eintrag.
pub fn decode<V: JsLike>(ev: &V) -> Result<Event> {
    if ev.kind() != Kind::Object {
        return unsupported("Event");
    }
    // Ohne Zeitstempel ist die Sortierung in JS nicht wohldefiniert.
    let t = ev.get(Field::T).as_str().ok_or_else(|| Unsupported("Event ohne Zeitstempel t".into()))?;
    let seq = ev.get(Field::Seq);
    let seq = match seq.as_f64() {
        Some(s) if s >= 0.0 && s.fract() == 0.0 && s <= 9_007_199_254_740_991.0 => s as u64,
        None if seq.kind() == Kind::Nullish => 0,
        _ => return unsupported("seq"),
    };
    let kind = ev.get(Field::Type).as_str().unwrap_or_default();
    let body = decode_body(&kind, || ev.get(Field::Payload))?;
    Ok(Event { t, seq, body })
}

fn decode_body<V: JsLike>(kind: &str, payload: impl FnOnce() -> V) -> Result<Body> {
    if kind == "uiTabsSet" {
        return Ok(Body::UiTabsSet); // nur der Typ zählt
    }
    let relevant = matches!(
        kind,
        "pageDelete"
            | "cardDelete"
            | "pageUpdate"
            | "cardUpdate"
            | "settingsSet"
            | "uiTreeSet"
            | "chatUpsert"
            | "homeArticleUpsert"
            | "heftOps"
            | "heftSnap"
            | "heftBlob"
    );
    if !relevant {
        return Ok(Body::Other);
    }
    // `ev.payload || {}`; ein Array oder eine Zahl als Payload kennt nur JS.
    let payload = payload();
    let p = match payload.kind() {
        Kind::Object => Some(&payload),
        Kind::Nullish | Kind::Falsy => None,
        _ => return unsupported(&format!("{kind}: payload")),
    };
    let payload_str = |field: Field| match p {
        Some(p) => truthy_str(&p.get(field), &format!("{kind}: payload.{}", field.name())),
        None => Ok(None),
    };
    Ok(match kind {
        "pageDelete" => Body::PageDelete(p.map(|p| target_id(p, kind)).transpose()?),
        "cardDelete" => Body::CardDelete(p.map(|p| target_id(p, kind)).transpose()?),
        "pageUpdate" | "cardUpdate" => {
            let update = match p {
                None => None,
                Some(p) => {
                    let id = target_id(p, kind)?;
                    let patch = p.get(Field::Patch);
                    let patch = match patch.kind() {
                        Kind::Object => Some(Patch {
                            keys: patch.keys(),
                            has_content: patch.get(Field::Content).kind() == Kind::Str,
                        }),
                        Kind::Nullish | Kind::Falsy => None,
                        _ => return unsupported(&format!("{kind}: payload.patch")),
                    };
                    Some(Update { id, patch })
                }
            };
            if kind == "pageUpdate" { Body::PageUpdate(update) } else { Body::CardUpdate(update) }
        }
        "settingsSet" => Body::SettingsSet(p.map(JsLike::keys).unwrap_or_default()),
        "uiTreeSet" => Body::UiTreeSet(match p.map(|p| p.get(Field::Key)) {
            None => None,
            Some(key) => match key.as_str() {
                Some(key) => Some(key),
                None if key.kind() == Kind::Nullish => None,
                // Zahlen/Booleans wären eigene Schlüssel neben gleichlautenden Strings.
                None => return unsupported("uiTreeSet: payload.key"),
            },
        }),
        "chatUpsert" | "homeArticleUpsert" => {
            let snapshot = match payload_str(Field::Id)? {
                None => None,
                Some(id) => Some(Snapshot {
                    id,
                    updated: payload_str(Field::Updated)?.unwrap_or_default(),
                    created: payload_str(Field::Created)?.unwrap_or_default(),
                }),
            };
            if kind == "chatUpsert" { Body::ChatUpsert(snapshot) } else { Body::HomeArticleUpsert(snapshot) }
        }
        "heftOps" => {
            let mut refs = Vec::new();
            if let Some(p) = p {
                for op in list(&p.get(Field::Ops), "heftOps: payload.ops")? {
                    if op.kind() == Kind::Object {
                        push_ref(&op.get(Field::O), &mut refs)?;
                    }
                }
            }
            Body::HeftRefs(refs)
        }
        "heftSnap" => {
            let mut refs = Vec::new();
            if let Some(doc) = p.map(|p| p.get(Field::Doc)).filter(|d| d.kind() == Kind::Object) {
                for page in list(&doc.get(Field::Pages), "heftSnap: doc.pages")? {
                    let images = match page.kind() {
                        Kind::Object | Kind::Array => list(&page.get(Field::Images), "heftSnap: images")?,
                        // `null.images` wirft in JS.
                        Kind::Nullish => return unsupported("heftSnap: doc.pages[]"),
                        _ => Vec::new(),
                    };
                    for image in images {
                        push_ref(&image, &mut refs)?;
                    }
                }
            }
            Body::HeftRefs(refs)
        }
        "heftBlob" => Body::HeftBlob(payload_str(Field::Hash)?),
        _ => unreachable!("oben als relevant geprüft"),
    })
}
