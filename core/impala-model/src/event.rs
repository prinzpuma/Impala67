//! Events des Logs: die Hülle ([`LogEvent`], wie in IndexedDB/Sync) und ihre fachliche
//! Bedeutung ([`Event`], ein Typ je Event-Art).
//!
//! Gelesen wird so nachsichtig wie der JS-Reducer: fehlende Felder sind `None`, `x || y`
//! zählt wie in JS. Werte, die der Reducer unverändert übernimmt (Icons, Tags, Nachrichten …),
//! bleiben rohes JSON. Unbekannte Event-Arten werden zu [`Event::Unknown`]: Sie ändern nichts
//! und bleiben im Log, sodass eine neuere App-Version sie später auswerten kann.

use impala_heft::HeftEvent;
use serde_json::Value;

use crate::js::{self, Object};

/// Ein Event, wie es im Log steht.
#[derive(Debug, Clone, PartialEq)]
pub struct LogEvent {
    pub id: String,
    /// Zeitstempel (ISO, hybride logische Uhr).
    pub t: String,
    /// Lokale Folgenummer (0 = ohne, z. B. Wire-Events).
    pub seq: u64,
    /// Event-Art (`type`).
    pub kind: String,
    pub payload: Value,
}

impl LogEvent {
    pub fn new(id: impl Into<String>, t: impl Into<String>, kind: impl Into<String>, payload: Value) -> Self {
        LogEvent { id: id.into(), t: t.into(), seq: 0, kind: kind.into(), payload }
    }

    /// Liest ein gespeichertes Event. `None`, wenn `type` kein Text ist (der Reducer überspringt es).
    pub fn from_object(ev: &Object) -> Option<Self> {
        let kind = ev.get("type")?.as_str()?.to_owned();
        let text = |k: &str| js::or(ev.get(k)).map(js::to_string).unwrap_or_default();
        Some(LogEvent {
            id: text("id"),
            t: text("t"),
            seq: impala_storage::js::seq_of(ev.get("seq")),
            kind,
            payload: ev.get("payload").cloned().unwrap_or(Value::Null),
        })
    }

    /// Wie [`from_object`](Self::from_object), übernimmt aber den Besitz und spart das Klonen der Payload.
    pub fn from_object_owned(mut ev: Object) -> Option<Self> {
        let kind = match ev.remove("type")? {
            Value::String(s) => s,
            _ => return None,
        };
        let mut text = |k: &str| ev.remove(k).filter(|v| js::truthy(v)).map(|v| js::to_string(&v)).unwrap_or_default();
        Some(LogEvent {
            id: text("id"),
            t: text("t"),
            seq: impala_storage::js::seq_of(ev.get("seq")),
            kind,
            payload: ev.remove("payload").unwrap_or(Value::Null),
        })
    }

    /// Als Log-Objekt (`{ id, t, type, payload }`, mit `seq`, wenn bekannt).
    pub fn to_object(&self) -> Object {
        let mut o = Object::new();
        o.insert("id".into(), Value::from(self.id.clone()));
        o.insert("t".into(), Value::from(self.t.clone()));
        o.insert("type".into(), Value::from(self.kind.clone()));
        o.insert("payload".into(), self.payload.clone());
        if self.seq > 0 {
            o.insert("seq".into(), Value::from(self.seq));
        }
        o
    }

    /// Payload als Objekt (`ev.payload || {}`; kein Objekt: leer).
    pub fn fields(&self) -> &Object {
        self.payload.as_object().unwrap_or(empty())
    }
}

fn empty() -> &'static Object {
    static EMPTY: std::sync::OnceLock<Object> = std::sync::OnceLock::new();
    EMPTY.get_or_init(Object::new)
}

/// Zugriff auf Payload-Felder mit JS-Semantik.
#[derive(Clone, Copy)]
struct P<'a>(&'a Object);

impl<'a> P<'a> {
    fn get(self, k: &str) -> Option<&'a Value> {
        self.0.get(k)
    }
    /// Rohwert, wenn vorhanden (auch `null`).
    fn raw(self, k: &str) -> Option<Value> {
        self.0.get(k).cloned()
    }
    /// Rohwert, wenn „wahr“ (`p.x || …`).
    fn or(self, k: &str) -> Option<Value> {
        js::or(self.0.get(k)).cloned()
    }
    /// Schlüssel (`p.id`), wenn „wahr“; Zahlen werden zu Text wie bei `obj[p.id]`.
    fn key(self, k: &str) -> Option<String> {
        js::or(self.0.get(k)).map(js::to_string)
    }
    /// Text, nur wenn wirklich Text und nicht leer.
    fn text(self, k: &str) -> Option<String> {
        self.0.get(k).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_owned)
    }
    /// `typeof p.x === "number"`.
    fn number(self, k: &str) -> Option<f64> {
        self.0.get(k).and_then(Value::as_f64)
    }
    fn truthy(self, k: &str) -> bool {
        self.0.get(k).is_some_and(js::truthy)
    }
    fn object(self, k: &str) -> &'a Object {
        self.0.get(k).and_then(Value::as_object).unwrap_or(empty())
    }
    fn array(self, k: &str) -> Option<&'a [Value]> {
        self.0.get(k).and_then(Value::as_array).map(Vec::as_slice)
    }
}

/// `pageCreate`: Felder, die die Seite unverändert übernimmt, bleiben roh.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct PageCreate {
    pub id: String,
    pub title: Option<Value>,
    pub parent_id: Option<Value>,
    pub content: Option<Value>,
    pub pdf_id: Option<Value>,
    pub tags: Option<Value>,
    pub workspace_id: Option<Value>,
    pub icon: Option<Value>,
    pub cover: Option<Value>,
    pub cover_img: Option<Value>,
    pub daily: Option<Value>,
    pub daily_root: Option<Value>,
    pub db: Option<Value>,
    pub props: Option<Value>,
    pub notion_id: Option<Value>,
    pub heft: bool,
    pub order: Option<f64>,
    pub gn_folder_id: Option<Value>,
    pub gn_order: Option<f64>,
    pub created: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct LearningSessionUpsert<'a> {
    pub id: String,
    pub duration_seconds: f64,
    pub started_at: Option<Value>,
    pub ended_at: Option<Value>,
    pub segments: Option<&'a [Value]>,
    pub category: Option<Value>,
    /// `Some(None)`: ausdrücklich ohne Fach (`null`), `None`: Feld fehlt (altes Fach bleibt).
    pub subject: Option<Option<Value>>,
    pub subject_source: Option<Option<Value>>,
    pub source_id: Option<Value>,
    pub updated: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct GradeAdd {
    pub id: String,
    pub subject: Value,
    pub grade: f64,
    pub weight: Option<Value>,
    pub date: Option<Value>,
    pub comment: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct CardCreate {
    pub id: String,
    pub front: Option<Value>,
    pub back: Option<Value>,
    pub page_id: Option<Value>,
    pub deck: Option<Value>,
    pub card_type: Option<Value>,
    pub cloze: Option<Value>,
    pub srs: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct CardReview {
    pub id: Option<String>,
    pub srs: Option<Value>,
    /// `p.first != null`.
    pub first: Option<bool>,
    pub learning: Option<bool>,
    pub grade: Option<Value>,
    pub review_id: Option<Value>,
    pub deck: Option<Value>,
    pub subject: Option<Value>,
    pub subject_source: Option<Value>,
    pub due_at: Option<Value>,
    pub previous_review_at: Option<Value>,
    pub interval_days: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct ChatUpsert<'a> {
    pub id: String,
    pub messages: &'a [Value],
    pub title: Option<Value>,
    pub created: Option<Value>,
    pub updated: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct HomeArticleUpsert<'a> {
    pub id: String,
    pub body: Value,
    pub day: Option<Value>,
    pub created: Option<Value>,
    pub updated: Option<Value>,
    pub read_at: Option<Value>,
    pub topics: Option<&'a [Value]>,
    pub focus: Option<Value>,
    pub title: Option<Value>,
    pub sources: Option<&'a [Value]>,
}

/// Fachliche Bedeutung eines Events. `None`-Felder fehlen oder sind „falsch“ – der Reducer
/// überspringt das Event dann wie das JS.
#[derive(Debug, Clone, PartialEq)]
pub enum Event<'a> {
    PageCreate(Box<PageCreate>),
    PageUpdate {
        id: Option<String>,
        patch: &'a Object,
    },
    PageMove {
        id: Option<String>,
        parent_id: Option<Value>,
        order: Option<f64>,
    },
    PageDelete {
        id: Option<String>,
    },
    PageTrash {
        id: Option<String>,
    },
    PageRestore {
        id: Option<String>,
    },
    PageArchive {
        id: Option<String>,
    },
    PageUnarchive {
        id: Option<String>,
    },
    LearningSessionUpsert(Box<LearningSessionUpsert<'a>>),
    LearningSessionDelete {
        id: String,
        updated: Option<Value>,
    },
    TeleEvent {
        id: Option<Value>,
        kind: Value,
        data: Option<Value>,
    },
    GradeAdd(Box<GradeAdd>),
    GradeDelete {
        id: Option<String>,
    },
    CardCreate(Box<CardCreate>),
    CardReview(Box<CardReview>),
    CardReviewUndo {
        id: Option<String>,
        srs: Option<Value>,
        unsuspend: bool,
        review_id: Option<Value>,
    },
    CardUpdate {
        id: Option<String>,
        patch: &'a Object,
    },
    CardArchive {
        id: Option<String>,
    },
    CardUnarchive {
        id: Option<String>,
    },
    CardTrash {
        id: Option<String>,
    },
    CardRestore {
        id: Option<String>,
    },
    CardDelete {
        id: Option<String>,
    },
    DeckCreate {
        name: Option<String>,
    },
    /// `to`: wie JS `to + …` (fehlend: `"undefined"`).
    DeckRename {
        from: Option<String>,
        to: String,
    },
    DeckReorder {
        name: Option<String>,
        order: Option<f64>,
    },
    DeckArchive {
        name: Option<String>,
    },
    DeckUnarchive {
        name: Option<String>,
    },
    DeckTrash {
        name: Option<String>,
    },
    DeckRestore {
        name: Option<String>,
    },
    DeckDelete {
        name: Option<String>,
    },
    DeckMove {
        from: Option<String>,
        target: Option<String>,
    },
    DeckDuplicate {
        name: Option<String>,
    },
    WorkspaceCreate {
        id: Option<String>,
        name: Option<Value>,
    },
    GnFolderCreate {
        id: Option<String>,
        title: Option<Value>,
        parent_id: Option<Value>,
        order: Option<f64>,
    },
    GnFolderMove {
        id: Option<String>,
        parent_id: Option<String>,
        order: Option<f64>,
    },
    GnItemMove {
        id: Option<String>,
        folder_id: Option<String>,
        order: Option<f64>,
    },
    GnFolderDelete {
        id: Option<String>,
    },
    /// `heftOps`/`heftSnap`/`heftBlob`; `None`: Event, das der Reducer überspringt.
    Heft(Option<HeftEvent>),
    ChatUpsert(Box<ChatUpsert<'a>>),
    ChatDelete {
        id: String,
        deleted_at: Option<Value>,
    },
    HomeArticleUpsert(Box<HomeArticleUpsert<'a>>),
    UiTreeSet {
        key: Option<Value>,
        open: bool,
    },
    UiTabsSet {
        tabs: &'a [Value],
        active_tab_id: Option<Value>,
    },
    SettingsSet(&'a Object),
    /// Bekannte Art, die der Reducer überspringt (Pflichtfeld fehlt).
    Invalid,
    /// Unbekannte, künftige oder abgelöste Art (z. B. `heftUpdated` aus v7): ändert nichts.
    Unknown,
}

/// Alle Event-Arten, die der Reducer kennt.
pub const KINDS: [&str; 46] = [
    "pageCreate",
    "pageUpdate",
    "pageMove",
    "pageDelete",
    "pageTrash",
    "pageRestore",
    "pageArchive",
    "pageUnarchive",
    "learningSessionUpsert",
    "learningSessionDelete",
    "teleEvent",
    "gradeAdd",
    "gradeDelete",
    "cardCreate",
    "cardReview",
    "cardReviewUndo",
    "cardUpdate",
    "cardArchive",
    "cardUnarchive",
    "cardTrash",
    "cardRestore",
    "cardDelete",
    "deckCreate",
    "deckRename",
    "deckReorder",
    "deckArchive",
    "deckUnarchive",
    "deckTrash",
    "deckRestore",
    "deckDelete",
    "deckMove",
    "deckDuplicate",
    "workspaceCreate",
    "gnFolderCreate",
    "gnFolderMove",
    "gnItemMove",
    "gnFolderDelete",
    "heftOps",
    "heftSnap",
    "heftBlob",
    "chatUpsert",
    "chatDelete",
    "homeArticleUpsert",
    "uiTreeSet",
    "uiTabsSet",
    "settingsSet",
];

impl<'a> Event<'a> {
    /// Deutet ein Event. `payload` darf beliebig sein (kein Objekt zählt als `{}`).
    pub fn parse(kind: &str, payload: &'a Value) -> Event<'a> {
        let p = P(payload.as_object().unwrap_or(empty()));
        let id = || p.key("id");
        let name = || p.text("name");
        match kind {
            "pageCreate" => match p.key("id") {
                Some(id) => Event::PageCreate(Box::new(PageCreate {
                    id,
                    title: p.or("title"),
                    parent_id: p.or("parentId"),
                    content: p.or("content"),
                    pdf_id: p.or("pdfId"),
                    tags: p.or("tags"),
                    workspace_id: p.or("workspaceId"),
                    icon: p.or("icon"),
                    cover: p.or("cover"),
                    cover_img: p.or("coverImg"),
                    daily: p.or("daily"),
                    daily_root: p.or("dailyRoot"),
                    db: p.or("db"),
                    props: p.or("props"),
                    notion_id: p.or("notionId"),
                    heft: p.get("kind").and_then(Value::as_str) == Some("heft"),
                    order: p.number("order"),
                    gn_folder_id: p.or("gnFolderId"),
                    gn_order: p.number("gnOrder"),
                    created: p.or("created"),
                })),
                None => Event::Invalid,
            },
            "pageUpdate" => Event::PageUpdate { id: id(), patch: p.object("patch") },
            "pageMove" => Event::PageMove { id: id(), parent_id: p.or("parentId"), order: p.number("order") },
            "pageDelete" => Event::PageDelete { id: id() },
            "pageTrash" => Event::PageTrash { id: id() },
            "pageRestore" => Event::PageRestore { id: id() },
            "pageArchive" => Event::PageArchive { id: id() },
            "pageUnarchive" => Event::PageUnarchive { id: id() },
            "learningSessionUpsert" => {
                let duration = js::finite_number(p.get("durationSeconds"));
                match (id(), duration) {
                    (Some(id), Some(duration_seconds)) => {
                        let opt = |k: &str| p.get(k).map(|v| js::or(Some(v)).cloned());
                        Event::LearningSessionUpsert(Box::new(LearningSessionUpsert {
                            id,
                            duration_seconds,
                            started_at: p.or("startedAt"),
                            ended_at: p.or("endedAt"),
                            segments: p.array("segments"),
                            category: p.or("category"),
                            subject: opt("subject"),
                            subject_source: opt("subjectSource"),
                            source_id: p.or("sourceId"),
                            updated: p.or("updated"),
                        }))
                    }
                    _ => Event::Invalid,
                }
            }
            "learningSessionDelete" => match id() {
                Some(id) => Event::LearningSessionDelete { id, updated: p.or("updated") },
                None => Event::Invalid,
            },
            "teleEvent" => match p.or("kind") {
                Some(kind) => Event::TeleEvent { id: p.or("id"), kind, data: p.or("data") },
                None => Event::Invalid,
            },
            "gradeAdd" => {
                let grade = js::finite_number(p.get("grade"));
                match (id(), p.or("subject"), grade) {
                    (Some(id), Some(subject), Some(grade)) => Event::GradeAdd(Box::new(GradeAdd {
                        id,
                        subject,
                        grade,
                        weight: p.raw("weight"),
                        date: p.or("date"),
                        comment: p.or("comment"),
                    })),
                    _ => Event::Invalid,
                }
            }
            "gradeDelete" => Event::GradeDelete { id: id() },
            "cardCreate" => match id() {
                Some(id) => Event::CardCreate(Box::new(CardCreate {
                    id,
                    front: p.raw("front"),
                    back: p.raw("back"),
                    page_id: p.or("pageId"),
                    deck: p.or("deck"),
                    card_type: p.or("type"),
                    cloze: p.or("cloze"),
                    srs: p.or("srs"),
                })),
                None => Event::Invalid,
            },
            "cardReview" => Event::CardReview(Box::new(CardReview {
                id: id(),
                srs: p.or("srs"),
                first: p.get("first").filter(|v| !v.is_null()).map(js::truthy),
                learning: p.get("learning").filter(|v| !v.is_null()).map(js::truthy),
                grade: p.or("grade"),
                review_id: p.or("reviewId"),
                deck: p.or("deck"),
                subject: p.or("subject"),
                subject_source: p.or("subjectSource"),
                due_at: p.or("dueAt"),
                previous_review_at: p.or("previousReviewAt"),
                interval_days: p.get("intervalDays").filter(|v| !v.is_null()).and_then(|v| js::finite_number(Some(v))),
            })),
            "cardReviewUndo" => Event::CardReviewUndo {
                id: id(),
                srs: p.or("srs"),
                unsuspend: p.truthy("unsuspend"),
                review_id: p.or("reviewId"),
            },
            "cardUpdate" => Event::CardUpdate { id: id(), patch: p.object("patch") },
            "cardArchive" => Event::CardArchive { id: id() },
            "cardUnarchive" => Event::CardUnarchive { id: id() },
            "cardTrash" => Event::CardTrash { id: id() },
            "cardRestore" => Event::CardRestore { id: id() },
            "cardDelete" => Event::CardDelete { id: id() },
            "deckCreate" => Event::DeckCreate { name: name() },
            "deckRename" => Event::DeckRename {
                from: p.text("from"),
                to: p.get("to").map_or_else(|| "undefined".to_owned(), js::to_string),
            },
            "deckReorder" => Event::DeckReorder { name: name(), order: p.number("order") },
            "deckArchive" => Event::DeckArchive { name: name() },
            "deckUnarchive" => Event::DeckUnarchive { name: name() },
            "deckTrash" => Event::DeckTrash { name: name() },
            "deckRestore" => Event::DeckRestore { name: name() },
            "deckDelete" => Event::DeckDelete { name: name() },
            "deckMove" => Event::DeckMove { from: p.text("from"), target: p.or("target").map(|v| js::to_string(&v)) },
            "deckDuplicate" => Event::DeckDuplicate { name: name() },
            "workspaceCreate" => Event::WorkspaceCreate { id: id(), name: p.or("name") },
            "gnFolderCreate" => Event::GnFolderCreate {
                id: id(),
                title: p.or("title"),
                parent_id: p.or("parentId"),
                order: p.number("order"),
            },
            "gnFolderMove" => Event::GnFolderMove { id: id(), parent_id: p.key("parentId"), order: p.number("order") },
            "gnItemMove" => Event::GnItemMove { id: id(), folder_id: p.key("folderId"), order: p.number("order") },
            "gnFolderDelete" => Event::GnFolderDelete { id: id() },
            "heftOps" | "heftSnap" | "heftBlob" => {
                let payload = if payload.is_object() { payload.clone() } else { Value::Object(Object::new()) };
                Event::Heft(HeftEvent::from_payload(kind, payload))
            }
            "chatUpsert" => match (id(), p.array("messages")) {
                (Some(id), Some(messages)) => Event::ChatUpsert(Box::new(ChatUpsert {
                    id,
                    messages,
                    title: p.or("title"),
                    created: p.or("created"),
                    updated: p.or("updated"),
                })),
                _ => Event::Invalid,
            },
            "chatDelete" => match id() {
                Some(id) => Event::ChatDelete { id, deleted_at: p.or("deletedAt") },
                None => Event::Invalid,
            },
            "homeArticleUpsert" => match (id(), p.or("body")) {
                (Some(id), Some(body)) => Event::HomeArticleUpsert(Box::new(HomeArticleUpsert {
                    id,
                    body,
                    day: p.or("day"),
                    created: p.or("created"),
                    updated: p.or("updated"),
                    read_at: p.or("readAt"),
                    topics: p.array("topics"),
                    focus: p.or("focus"),
                    title: p.or("title"),
                    sources: p.array("sources"),
                })),
                _ => Event::Invalid,
            },
            "uiTreeSet" => Event::UiTreeSet { key: p.or("key"), open: p.truthy("open") },
            "uiTabsSet" => {
                Event::UiTabsSet { tabs: p.array("tabs").unwrap_or_default(), active_tab_id: p.raw("activeTabId") }
            }
            "settingsSet" => Event::SettingsSet(p.0),
            _ => Event::Unknown,
        }
    }
}
