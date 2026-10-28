//! Der gespeicherte Zustand `S` (`INITIAL_PERSISTED_STATE` in `web/state.js`): genau die Teile,
//! die ein Checkpoint sichert. Flüchtiger UI-Zustand (Ansicht, Chat-Entwürfe …) gehört nicht hierher.

use impala_heft::{HeftDoc, Hefte};
use serde::de::{Deserialize, Deserializer};
use serde::ser::{Serialize, SerializeMap, Serializer};
use serde_json::{Value, json};

use crate::js::{self, Object};
use crate::jsmap::JsMap;
use crate::record::record;

/// Teile des gespeicherten Zustands in Checkpoint-Reihenfolge (`STATE_CHECKPOINT_KEYS`).
pub const STATE_KEYS: [&str; 17] = impala_storage::checkpoint::KEYS;

/// Wahrheitswert eines Flags: typisiert oder (fremder Typ) über die JS-Truthiness.
fn flag(typed: Option<bool>, extra: &Object, key: &str) -> bool {
    typed.unwrap_or_else(|| extra.get(key).is_some_and(js::truthy))
}

/// `x || null` für Text-IDs: leerer Text zählt als fehlend.
fn non_empty(s: &Option<String>) -> Option<&str> {
    s.as_deref().filter(|s| !s.is_empty())
}

record! {
    /// Eine Seite (Notiz oder Heft). Weitere Felder wie `tags`, `icon`, `props`, `favorite` in `extra`.
    pub struct Page {
        id: String = "id",
        title: String = "title",
        content: String = "content",
        parent_id: String = "parentId",
        workspace_id: String = "workspaceId",
        /// `"notion"` (Block-Editor) oder `"heft"`.
        kind: String = "kind",
        order: f64 = "order",
        gn_folder_id: String = "gnFolderId",
        gn_order: f64 = "gnOrder",
        trashed: bool = "trashed",
        trashed_at: String = "trashedAt",
        archived: bool = "archived",
        archived_at: String = "archivedAt",
        archived_root: bool = "archivedRoot",
        created: String = "created",
        updated: String = "updated",
    }
}

impl Page {
    pub fn id(&self) -> &str {
        self.id.as_deref().unwrap_or("")
    }
    pub fn title(&self) -> &str {
        self.title.as_deref().unwrap_or("")
    }
    pub fn content(&self) -> &str {
        self.content.as_deref().unwrap_or("")
    }
    /// Elternseite (`parentId || null`).
    pub fn parent(&self) -> Option<&str> {
        non_empty(&self.parent_id)
    }
    pub fn workspace(&self) -> &str {
        non_empty(&self.workspace_id).unwrap_or("default")
    }
    pub fn is_heft(&self) -> bool {
        self.kind.as_deref() == Some("heft")
    }
    pub fn is_trashed(&self) -> bool {
        flag(self.trashed, &self.extra, "trashed")
    }
    pub fn is_archived(&self) -> bool {
        flag(self.archived, &self.extra, "archived")
    }
    pub fn is_archived_root(&self) -> bool {
        flag(self.archived_root, &self.extra, "archivedRoot")
    }
    pub fn gn_folder(&self) -> Option<&str> {
        non_empty(&self.gn_folder_id)
    }
    pub fn updated(&self) -> &str {
        self.updated.as_deref().unwrap_or("")
    }
    /// `created || updated || ""`.
    pub fn created_at(&self) -> &str {
        non_empty(&self.created).or(non_empty(&self.updated)).unwrap_or("")
    }
}

record! {
    /// Eine Karteikarte. `front`, `back`, `pageId`, `type`, `cloze` und der FSRS-Stand `srs`
    /// (Form von `impala_srs::Srs`) liegen in `extra`.
    pub struct Card {
        id: String = "id",
        deck: String = "deck",
        suspended: bool = "suspended",
        leech: bool = "leech",
        archived: bool = "archived",
        archived_at: String = "archivedAt",
        trashed: bool = "trashed",
        trashed_at: String = "trashedAt",
        created: String = "created",
    }
}

impl Card {
    pub fn id(&self) -> &str {
        self.id.as_deref().unwrap_or("")
    }
    /// `deck || "Standard"`.
    pub fn deck_name(&self) -> &str {
        non_empty(&self.deck).unwrap_or("Standard")
    }
    pub fn is_trashed(&self) -> bool {
        flag(self.trashed, &self.extra, "trashed")
    }
    pub fn is_archived(&self) -> bool {
        flag(self.archived, &self.extra, "archived")
    }
    pub fn is_suspended(&self) -> bool {
        flag(self.suspended, &self.extra, "suspended")
    }
    /// FSRS-Stand, wie gespeichert.
    pub fn srs(&self) -> Option<&Value> {
        self.extra.get("srs")
    }
    /// `srs.state`, falls Text.
    pub fn srs_state(&self) -> Option<&str> {
        self.srs()?.get("state")?.as_str()
    }
    /// `srs.due`, falls Text.
    pub fn srs_due(&self) -> Option<&str> {
        self.srs()?.get("due")?.as_str()
    }
    /// FSRS-Stand als Typ (für die Planung mit `impala_srs`).
    pub fn srs_typed(&self) -> Option<impala_srs::Srs> {
        serde_json::from_value(self.srs()?.clone()).ok()
    }
}

record! {
    /// Ein Stapel; Unterstapel per `"Eltern::Kind"`.
    pub struct Deck {
        name: String = "name",
        created: String = "created",
        order: f64 = "order",
        archived: bool = "archived",
        archived_at: String = "archivedAt",
        trashed: bool = "trashed",
        trashed_at: String = "trashedAt",
    }
}

impl Deck {
    pub fn new(name: &str, created: &str) -> Self {
        Deck { name: Some(name.to_owned()), created: Some(created.to_owned()), ..Default::default() }
    }
    pub fn is_trashed(&self) -> bool {
        flag(self.trashed, &self.extra, "trashed")
    }
    pub fn is_archived(&self) -> bool {
        flag(self.archived, &self.extra, "archived")
    }
}

record! {
    pub struct Workspace {
        id: String = "id",
        name: String = "name",
        created: String = "created",
    }
}

record! {
    /// Ordner im GoodNotes-Regal (nur Hefte, unabhängig vom Seitenbaum).
    pub struct GnFolder {
        id: String = "id",
        title: String = "title",
        parent_id: String = "parentId",
        order: f64 = "order",
        created: String = "created",
        updated: String = "updated",
    }
}

impl GnFolder {
    pub fn parent(&self) -> Option<&str> {
        non_empty(&self.parent_id)
    }
}

record! {
    /// Schulnote.
    pub struct Grade {
        id: String = "id",
        subject: String = "subject",
        grade: f64 = "grade",
        weight: f64 = "weight",
        date: String = "date",
        comment: String = "comment",
        created: String = "created",
        deleted: bool = "deleted",
    }
}

record! {
    /// Lerneinheit (Lernzeit); `segments` in `extra`.
    pub struct LearningSession {
        id: String = "id",
        started_at: String = "startedAt",
        ended_at: String = "endedAt",
        duration_seconds: f64 = "durationSeconds",
        subject: String = "subject",
        subject_source: String = "subjectSource",
        source_id: String = "sourceId",
        updated: String = "updated",
        deleted: bool = "deleted",
    }
}

record! {
    /// Gespeicherte Chat-Sitzung; `messages` in `extra`.
    pub struct ChatSession {
        id: String = "id",
        title: String = "title",
        created: String = "created",
        updated: String = "updated",
        deleted: bool = "deleted",
        deleted_at: String = "deletedAt",
    }
}

impl ChatSession {
    pub fn is_deleted(&self) -> bool {
        flag(self.deleted, &self.extra, "deleted")
    }
}

record! {
    /// Tagesartikel der Startseite; `topics`, `focus`, `sources` in `extra`.
    pub struct HomeArticle {
        id: String = "id",
        day: String = "day",
        created: String = "created",
        updated: String = "updated",
        read_at: String = "readAt",
        title: String = "title",
        body: String = "body",
    }
}

record! {
    /// Eintrag im Wiederholungs-Protokoll (Tageslimits, Statistik).
    pub struct Review {
        id: String = "id",
        card_id: String = "cardId",
        deck: String = "deck",
        t: String = "t",
        grade: f64 = "grade",
        first: bool = "first",
        learning: bool = "learning",
        subject: String = "subject",
        subject_source: String = "subjectSource",
        due_at: String = "dueAt",
        previous_review_at: String = "previousReviewAt",
        interval_days: f64 = "intervalDays",
    }
}

impl Review {
    pub fn t(&self) -> &str {
        self.t.as_deref().unwrap_or("")
    }
}

record! {
    /// Lern-Telemetrie (`kind` + freie `data` in `extra`).
    pub struct Telemetry {
        id: String = "id",
        t: String = "t",
        kind: String = "kind",
    }
}

record! {
    /// Einstellungen. Ausgewertet werden nur die KI-Quellen (Schlüssel zusammenführen), die
    /// Stapel-Optionen und alte Zugangsdaten; alles andere bleibt unverändert in `extra`.
    pub struct Settings {
        ai_providers: Vec<Value> = "aiProviders",
        deck_conf: Object = "deckConf",
        notion_token: String = "notionToken",
        cors_proxy: String = "corsProxy",
        sync_secrets: bool = "syncSecrets",
    }
}

/// Standard-Einstellungen einer Neuinstallation.
pub fn default_settings() -> Settings {
    let v = json!({
        "aiProviders": [
            { "id": "cloudflare", "name": "Impala AI", "base": "https://impala67-sync.joshuagayer1.workers.dev", "key": "" },
            { "id": "google", "name": "Google Gemini", "base": "https://generativelanguage.googleapis.com/v1beta/openai", "key": "" },
            { "id": "openai", "name": "OpenAI", "base": "https://api.openai.com/v1", "key": "" },
            { "id": "local", "name": "Lokal (LM Studio)", "base": "http://localhost:1234/v1", "key": "" },
        ],
        "aiProviderId": "local",
        "aiModel": "",
        "thinkingEnabled": true,
        "thinkingLevel": "auto",
        "embedModel": "",
        "embedProviderId": "",
        "driveClientId": "100283147644-1ra4er2dc5r85k3mefd521hbm1ek3qpf.apps.googleusercontent.com",
        "driveAutoSyncMinutes": 30,
        "driveSyncAfterChange": false,
        "customInstructions": "",
        "syncSecrets": false,
        "notionToken": "",
        "deckConf": {},
    });
    match v {
        Value::Object(o) => Settings::from_object(o),
        _ => Settings::default(),
    }
}

/// Der gespeicherte Zustand.
#[derive(Debug, Clone, PartialEq)]
pub struct State {
    pub pages: JsMap<Page>,
    pub cards: JsMap<Card>,
    pub grades: JsMap<Grade>,
    pub learning_sessions: JsMap<LearningSession>,
    pub chat_sessions: JsMap<ChatSession>,
    pub home_articles: JsMap<HomeArticle>,
    pub settings: Settings,
    pub decks: JsMap<Deck>,
    pub workspaces: JsMap<Workspace>,
    pub gn_folders: JsMap<GnFolder>,
    /// Auf-/Zugeklappte Äste der Seitenleiste (`true`; Workspaces auch `false`).
    pub tree_open: JsMap<bool>,
    /// Synchronisierte Tabs (Seiten-IDs, `chat:<id>`, `nlm:main`, `anki:main`).
    pub tabs: Vec<String>,
    pub active_tab_id: Option<String>,
    pub reviews: Vec<Review>,
    pub telemetry: Vec<Telemetry>,
    /// `heftDocs` und `heftBlobs`.
    pub hefte: Hefte,
}

impl Default for State {
    /// `INITIAL_PERSISTED_STATE`.
    fn default() -> Self {
        let mut decks = JsMap::new();
        decks.insert("Standard".into(), Deck::new("Standard", ""));
        let mut workspaces = JsMap::new();
        workspaces.insert(
            "default".into(),
            Workspace {
                id: Some("default".into()),
                name: Some("Privat".into()),
                created: Some(String::new()),
                ..Default::default()
            },
        );
        State {
            pages: JsMap::new(),
            cards: JsMap::new(),
            grades: JsMap::new(),
            learning_sessions: JsMap::new(),
            chat_sessions: JsMap::new(),
            home_articles: JsMap::new(),
            settings: default_settings(),
            decks,
            workspaces,
            gn_folders: JsMap::new(),
            tree_open: JsMap::new(),
            tabs: Vec::new(),
            active_tab_id: None,
            reviews: Vec::new(),
            telemetry: Vec::new(),
            hefte: Hefte::default(),
        }
    }
}

/// Liste lesen; Einträge, die sich nicht lesen lassen, fallen weg.
fn list_of<T: for<'de> Deserialize<'de>>(v: Value) -> Vec<T> {
    match v {
        Value::Array(a) => a.into_iter().filter_map(|x| T::deserialize(x).ok()).collect(),
        _ => Vec::new(),
    }
}

fn map_of<T: for<'de> Deserialize<'de>>(v: Value) -> JsMap<T> {
    JsMap::deserialize(v).unwrap_or_default()
}

impl State {
    /// Liest einen gespeicherten Zustand (Checkpoint-Inhalt). Fehlende Teile bekommen den
    /// Anfangswert (`restorePersistedState`); kaputte Einträge fallen weg statt den Start zu blockieren.
    pub fn from_object(mut saved: Object) -> State {
        let mut s = State::default();
        let mut take = |k: &str| saved.remove(k);
        if let Some(v) = take("pages") {
            s.pages = map_of(v);
        }
        if let Some(v) = take("cards") {
            s.cards = map_of(v);
        }
        if let Some(v) = take("grades") {
            s.grades = map_of(v);
        }
        if let Some(v) = take("learningSessions") {
            s.learning_sessions = map_of(v);
        }
        if let Some(v) = take("chatSessions") {
            s.chat_sessions = map_of(v);
        }
        if let Some(v) = take("homeArticles") {
            s.home_articles = map_of(v);
        }
        if let Some(v) = take("settings") {
            s.settings = match v {
                Value::Object(o) => Settings::from_object(o),
                _ => Settings::default(),
            };
        }
        if let Some(v) = take("decks") {
            s.decks = map_of(v);
        }
        if let Some(v) = take("workspaces") {
            s.workspaces = map_of(v);
        }
        if let Some(v) = take("gnFolders") {
            s.gn_folders = map_of(v);
        }
        if let Some(v) = take("treeOpen") {
            s.tree_open = map_of(v);
        }
        if let Some(v) = take("tabs") {
            s.tabs = match v {
                Value::Array(a) => a.into_iter().filter_map(|x| x.as_str().map(str::to_owned)).collect(),
                _ => Vec::new(),
            };
        }
        if let Some(v) = take("activeTabId") {
            s.active_tab_id = v.as_str().map(str::to_owned);
        }
        if let Some(v) = take("reviews") {
            s.reviews = list_of(v);
        }
        if let Some(v) = take("telemetry") {
            s.telemetry = list_of(v);
        }
        if let Some(Value::Object(docs)) = take("heftDocs") {
            for (k, d) in docs {
                s.hefte.insert(k, HeftDoc::from_value(d));
            }
        }
        if let Some(Value::Object(blobs)) = take("heftBlobs") {
            s.hefte.blobs = blobs.into_iter().filter_map(|(k, d)| d.as_str().map(|d| (k, d.to_owned()))).collect();
        }
        s
    }

    /// Der Zustand als JSON-Objekt (wie `checkpointStateOf(S)`).
    pub fn to_object(&self) -> Object {
        match serde_json::to_value(self) {
            Ok(Value::Object(o)) => o,
            _ => Object::new(),
        }
    }

    pub fn page(&self, id: &str) -> Option<&Page> {
        self.pages.get(id)
    }
}

/// Serialisiert ohne Hefte und ohne `heftBlobs` (Checkpoint-Kern ab Format 3: Hefte und Bilder
/// liegen als eigene Teile).
pub struct CoreOnly<'a>(pub &'a State);

/// Alle Hefte als `{ Seiten-ID: Heft }`.
struct HefteMap<'a>(&'a Hefte);

impl Serialize for HefteMap<'_> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_map(self.0.iter())
    }
}

impl State {
    fn write<S: Serializer>(&self, s: S, hefte: bool) -> Result<S::Ok, S::Error> {
        let mut m = s.serialize_map(Some(17))?;
        m.serialize_entry("pages", &self.pages)?;
        m.serialize_entry("cards", &self.cards)?;
        m.serialize_entry("grades", &self.grades)?;
        m.serialize_entry("learningSessions", &self.learning_sessions)?;
        m.serialize_entry("chatSessions", &self.chat_sessions)?;
        m.serialize_entry("homeArticles", &self.home_articles)?;
        m.serialize_entry("settings", &self.settings)?;
        m.serialize_entry("decks", &self.decks)?;
        m.serialize_entry("workspaces", &self.workspaces)?;
        m.serialize_entry("gnFolders", &self.gn_folders)?;
        m.serialize_entry("treeOpen", &self.tree_open)?;
        m.serialize_entry("tabs", &self.tabs)?;
        m.serialize_entry("activeTabId", &self.active_tab_id)?;
        m.serialize_entry("reviews", &self.reviews)?;
        m.serialize_entry("telemetry", &self.telemetry)?;
        if hefte {
            m.serialize_entry("heftDocs", &HefteMap(&self.hefte))?;
            m.serialize_entry("heftBlobs", &self.hefte.blobs)?;
        }
        m.end()
    }
}

impl Serialize for State {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        self.write(s, true)
    }
}

impl Serialize for CoreOnly<'_> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        self.0.write(s, false)
    }
}

impl<'de> Deserialize<'de> for State {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        match Value::deserialize(d)? {
            Value::Object(o) => Ok(State::from_object(o)),
            _ => Err(serde::de::Error::custom("Zustand: kein Objekt")),
        }
    }
}
