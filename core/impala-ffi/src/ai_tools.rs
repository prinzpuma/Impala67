//! KI-Werkzeuge der nativen Apps. `inspect` und `change` (samt Rückgängig) führt das Kern-Crate
//! `impala-tools` aus – dieselbe Implementierung wie in der PWA; hier nur die Anbindung an den
//! Kern ([`Host`] für [`Inner`]) und was nur die Plattform kann (`calculate`, Heftseite als Bild,
//! Rückfragen, Bedeutungssuche) über [`AiPlatform`].

use std::cell::RefCell;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use impala_ai::{HeftPage, HeftPageContent, LocalTime, ToolExecutor, ToolOutput};
use impala_model::Model;
use impala_model::search::NoteSearch;
use impala_tools::{Context, Host};
use serde_json::{Value, json};

use crate::ai::{AiPlatform, HttpHandle};
use crate::rag::SemanticSearch;
use crate::{CoreError, ImpalaCore, Inner, Shared, invalid, lock};

fn wall_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn truthy_at(v: &Value, k: &str) -> bool {
    v.get(k).is_some_and(|x| match x {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Value::String(s) => !s.is_empty(),
        _ => true,
    })
}

fn query_of(a: &Value) -> String {
    a.get("query").and_then(Value::as_str).unwrap_or_default().to_owned()
}

/// Jedes Werkzeug-Event wird wie jede andere Änderung sofort gespeichert und an den Sync gemeldet.
impl Host for Inner {
    fn model(&self) -> &Model {
        &self.model
    }
    fn model_search(&mut self) -> (&Model, &mut NoteSearch) {
        (&self.model, &mut self.search)
    }
    fn dispatch(&mut self, kind: &str, payload: Value) -> Result<(), String> {
        Inner::dispatch(self, kind, payload).map(drop).map_err(|e| e.to_string())
    }
    fn new_id(&mut self) -> String {
        new_id()
    }
}

/// Umgebung eines KI-Laufs: führt die Werkzeuge aus und stellt Rückfragen über die Plattform.
pub(crate) struct Env<'a> {
    pub core: &'a Shared,
    pub search: Option<&'a SemanticSearch>,
    pub platform: Option<&'a Arc<dyn AiPlatform>>,
    pub active_page: Option<String>,
    /// Angezeigte Heftseite (ab 0) des geöffneten Hefts.
    pub heft_index: u32,
    pub now: LocalTime,
    pub utc_offset: i32,
    /// Chat des Laufs (Rückfrage-Karten werden hier angelegt und beantwortet).
    pub transcript: &'a RefCell<Vec<Value>>,
    /// Neue Nachricht im Chat.
    pub notify: &'a dyn Fn(&Value),
    /// Netz für Werkzeuge mit Abruf (`wikipedia`); `None` = eigener Standard-Client.
    pub http: Option<HttpHandle>,
}

fn error_value(e: &str) -> Value {
    json!({ "error": e })
}

impl Env<'_> {
    fn ctx(&self) -> Context {
        Context {
            active_page: self.active_page.clone(),
            workspace: None,
            now: self.now,
            now_ms: wall_ms(),
            utc_offset: self.utc_offset,
            current_card: Value::Null,
            chats: None,
        }
    }

    fn semantic(&self, query: &str) -> Value {
        match self.search {
            None => {
                let args = json!({ "kind": "search", "query": query });
                let mut out = json!({ "info": "Kein Embedding-Modell konfiguriert — Stichwortsuche verwendet." });
                if let Some((Value::Object(k), _)) =
                    impala_tools::run(&mut *lock(self.core), &self.ctx(), "inspect", &args)
                    && let Some(o) = out.as_object_mut()
                {
                    o.extend(k);
                }
                out
            }
            Some(search) => match search.search(query.to_owned(), 6) {
                Ok(hits) => {
                    let list: Vec<Value> = hits
                        .iter()
                        .map(|h| json!({
                            "pageId": h.page_id, "title": h.title, "snippet": h.snippet, "score": h.score,
                            "semanticScore": h.semantic_score, "lexicalScore": h.lexical_score, "archived": h.archived,
                        }))
                        .collect();
                    json!({ "results": list })
                }
                Err(e) => error_value(&e.to_string()),
            },
        }
    }

    fn exec(&mut self, name: &str, a: &Value) -> (Value, Option<Value>) {
        match name {
            "inspect" if a.get("kind").and_then(Value::as_str) == Some("search") && truthy_at(a, "semantic") => {
                (self.semantic(&query_of(a)), None)
            }
            "inspect" | "change" => {
                let ctx = self.ctx();
                impala_tools::run(&mut *lock(self.core), &ctx, name, a).unwrap_or((Value::Null, None))
            }
            other => {
                let text = self.platform.and_then(|p| p.run_tool(other.to_owned(), a.to_string()));
                match text {
                    Some(t) => (serde_json::from_str(&t).unwrap_or_else(|_| json!({ "result": t })), None),
                    None => (error_value(&format!("Werkzeug nicht verfügbar: {other}")), None),
                }
            }
        }
    }

    fn heft_page_of(&self, title: Option<&str>, page: Option<f64>) -> Result<(u32, HeftPageContent), (u32, String)> {
        let (id, index) = {
            let inner = lock(self.core);
            let state = inner.model.state();
            let id = match title {
                Some(t) => {
                    let pg = state
                        .find_page(t, true)
                        .ok_or_else(|| (0, format!("Keine Seite mit Titel „{t}“ gefunden.")))?;
                    if !pg.is_heft() {
                        return Err((0, format!("„{}“ ist kein Handschrift-Heft.", pg.title())));
                    }
                    pg.id().to_owned()
                }
                None => self
                    .active_page
                    .clone()
                    .filter(|p| state.pages.get(p).is_some_and(|x| x.is_heft()))
                    .ok_or_else(|| (0, "Es ist gerade kein Heft geöffnet — bitte page_title angeben.".to_owned()))?,
            };
            let index = match page.filter(|p| *p != 0.0) {
                Some(p) => (p.floor() as i64 - 1).max(0) as u32,
                None if self.active_page.as_deref() == Some(id.as_str()) => self.heft_index,
                None => 0,
            };
            (id, index)
        };
        let page_no = index + 1;
        let (texts, ocr_text) = {
            let inner = lock(self.core);
            let pg = inner
                .model
                .state()
                .hefte
                .get(&id)
                .and_then(|d| d.pages.get(index as usize))
                .ok_or_else(|| (page_no, format!("Heftseite {page_no} gibt es nicht.")))?;
            (pg.texts.iter().filter_map(|t| t.text.clone()).filter(|t| !t.is_empty()).collect(), pg.ocr_text.clone())
        };
        let image = self.platform.and_then(|p| p.heft_page_image(id, index));
        let image_url =
            image.ok_or_else(|| (page_no, "Die Heftseite konnte nicht als Bild geladen werden.".to_owned()))?;
        Ok((page_no, HeftPageContent { texts, ocr_text, image_url }))
    }
}

impl ToolExecutor for Env<'_> {
    async fn run(&mut self, name: &str, args: &Value) -> Result<ToolOutput, String> {
        if name == "wikipedia" {
            let value = match &self.http {
                Some(h) => impala_ai::wiki::run(h, args).await,
                None => impala_ai::wiki::run(&impala_net::UreqClient::default(), args).await,
            };
            return Ok(ToolOutput { json: value.to_string(), undo: None });
        }
        let (value, undo) = self.exec(name, args);
        Ok(ToolOutput { json: value.to_string(), undo })
    }

    async fn ask(&mut self, question: &str, options: &[String]) -> Option<String> {
        let mid = new_id();
        let card =
            json!({ "mid": mid, "role": "question", "question": question, "options": options, "answered": false });
        self.transcript.borrow_mut().push(card.clone());
        (self.notify)(&card);
        // Ohne Plattform gibt es niemanden zum Fragen: Bestätigungen gelten dann als abgelehnt.
        let answer = match self.platform {
            Some(p) => p.ask(question.to_owned(), options.to_vec()),
            None => options.last().cloned(),
        };
        if let Some(c) = self.transcript.borrow_mut().iter_mut().find(|m| m["mid"] == mid.as_str()) {
            c["answered"] = Value::Bool(true);
            c["answer"] = Value::from(answer.clone().unwrap_or_else(|| "Abgebrochen".into()));
        }
        answer
    }

    async fn heft_page(&mut self, title: Option<&str>, page: Option<f64>) -> HeftPage {
        match self.heft_page_of(title, page) {
            Ok((page_no, content)) => HeftPage { page_no, result: Ok(content) },
            Err((page_no, e)) => HeftPage { page_no, result: Err(e) },
        }
    }
}

#[uniffi::export]
impl ImpalaCore {
    /// Eine KI-Änderung (Karte `edit` im Chat) zurücknehmen und die Karte als `undone` markieren.
    /// Scheitert mit `Invalid`, wenn die betroffenen Daten seitdem erneut geändert wurden.
    pub fn undo_ai_change(&self, chat_id: String, message_id: String) -> Result<(), CoreError> {
        let mut inner = self.lock();
        let (title, created, _, mut messages) =
            inner.chat_raw(&chat_id).ok_or_else(|| invalid(format!("Unbekannter Chat {chat_id}")))?;
        let msg = messages
            .iter_mut()
            .find(|m| m["mid"] == message_id.as_str() && m["role"] == "edit")
            .ok_or_else(|| invalid(format!("Keine Änderungs-Karte {message_id}")))?;
        if truthy_at(msg, "undone") {
            return Ok(());
        }
        let undo =
            msg.get("undo").filter(|u| u.is_object()).cloned().ok_or_else(|| invalid("Keine Rückgängig-Daten."))?;
        impala_tools::undo(&mut *inner, &undo).map_err(invalid)?;
        // Die Karte neu aus dem Chat holen (das Zurückspielen hat den Chat nicht verändert).
        if let Some(m) = messages.iter_mut().find(|m| m["mid"] == message_id.as_str()) {
            m["undone"] = Value::Bool(true);
        }
        inner.save_chat_raw(&chat_id, &title, &created, messages)
    }

    /// Inhalts-Werkzeug der MCP-Bridge (iPad, `DevBridge.swift`): dieselben flachen Werkzeuge wie
    /// die App-KI (`impala_ai::flat`, z. B. `read_pages`, `edit_page`), Name ohne `impala_`-Präfix,
    /// Argumente und Ergebnis als JSON. Ohne Rückfrage und ohne Änderungs-Karte im Chat;
    /// `dry_run: true` prüft Schreibwünsche nur. Unbekannter Name → `{ "error" }`.
    pub fn run_mcp_tool(&self, name: String, args_json: String, utc_offset_minutes: i32) -> String {
        let args: Value = serde_json::from_str(&args_json).unwrap_or_else(|_| json!({}));
        let transcript = RefCell::new(vec![]);
        let notify = |_: &Value| {};
        let env = Env {
            core: &self.inner,
            search: None,
            platform: None,
            active_page: None,
            heft_index: 0,
            now: crate::ai::local_time(wall_ms(), utc_offset_minutes),
            utc_offset: utc_offset_minutes,
            transcript: &transcript,
            notify: &notify,
            http: None,
        };
        if name == "wikipedia" {
            return impala_net::block_on(impala_ai::wiki::run(&impala_net::UreqClient::default(), &args)).to_string();
        }
        if name == "search" && truthy_at(&args, "semantic") {
            return env.semantic(&query_of(&args)).to_string();
        }
        let ctx = env.ctx();
        match impala_tools::run_flat(&mut *lock(&self.inner), &ctx, &name, &args) {
            Some((out, _)) => out.to_string(),
            None => json!({ "error": format!("Unbekanntes Werkzeug: impala_{name}") }).to_string(),
        }
    }

    /// Änderungs-Satz (`undo` einer Änderungs-Karte, JSON) direkt zurückspielen.
    pub fn undo_ai_changes(&self, undo_json: String) -> Result<(), CoreError> {
        let set: Value = serde_json::from_str(&undo_json).map_err(|e| invalid(format!("Rückgängig-Daten: {e}")))?;
        impala_tools::undo(&mut *self.lock(), &set).map_err(invalid)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn env<'a>(core: &'a Shared, transcript: &'a RefCell<Vec<Value>>, notify: &'a dyn Fn(&Value)) -> Env<'a> {
        let now = LocalTime { year: 2026, month: 10, day: 28, weekday: 3, hour: 14, minute: 5 };
        Env {
            core,
            search: None,
            platform: None,
            active_page: None,
            heft_index: 0,
            now,
            utc_offset: 60,
            transcript,
            notify,
            http: None,
        }
    }

    fn run(e: &mut Env<'_>, name: &str, args: Value) -> (Value, Option<Value>) {
        e.exec(name, &args)
    }

    #[test]
    fn change_legt_an_und_macht_rueckgaengig() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let existing = core.create_page("Mathe".into(), "Zeile A\nZeile B".into(), None, None).unwrap();
        let (transcript, notify) = (RefCell::new(vec![]), |_: &Value| {});
        let mut e = env(&core.inner, &transcript, &notify);

        let ops = json!({ "operations": [
            { "op": "page.create", "title": "Neu", "content": "Hallo", "parent": "Mathe" },
            { "op": "page.patch", "title": "Mathe", "search": "Zeile B", "replace": "Zeile C" },
            { "op": "card.create", "front": "Was ist 1+1?", "back": "2", "deck": "Rechnen" },
        ]});
        let (res, undo) = run(&mut e, "change", ops);
        assert_eq!(res["ok"], true, "{res}");
        assert_eq!(res["operations"], 3);
        let undo = undo.unwrap();
        assert!(undo["pages"].as_array().unwrap().len() == 2 && undo["cards"].as_array().unwrap().len() == 1);
        assert_eq!(core.page(existing.clone()).unwrap().content, "Zeile A\nZeile C");
        let neu = core.children_of(Some(existing.clone()), None);
        assert_eq!(neu[0].title, "Neu");
        assert_eq!(core.cards_in_deck("Rechnen".into()).len(), 1);

        core.undo_ai_changes(undo.to_string()).unwrap();
        assert_eq!(core.page(existing.clone()).unwrap().content, "Zeile A\nZeile B");
        assert!(core.children_of(Some(existing), None).is_empty());
        assert!(core.cards_in_deck("Rechnen".into()).is_empty());
    }

    #[test]
    fn fehlerhafte_operation_nimmt_alles_zurueck() {
        let core = ImpalaCore::open_in_memory().unwrap();
        core.create_page("Seite".into(), "Text".into(), None, None).unwrap();
        let (transcript, notify) = (RefCell::new(vec![]), |_: &Value| {});
        let mut e = env(&core.inner, &transcript, &notify);
        let (res, undo) = run(
            &mut e,
            "change",
            json!({ "operations": [
                { "op": "page.create", "title": "Eins" },
                { "op": "page.patch", "title": "Seite", "search": "gibtsnicht", "replace": "x" },
            ]}),
        );
        assert!(undo.is_none());
        // Die Vorprüfung lehnt ab, bevor irgendetwas geschrieben wird.
        let msg = res["error"].as_str().unwrap();
        assert!(msg.contains("Operation 2 (page.patch)") && msg.contains("Keine Änderungen ausgeführt"), "{res}");
        assert_eq!(core.children_of(None, None).len(), 1);
        // Trockenlauf: geprüft, nichts geschrieben.
        let (res, undo) =
            run(&mut e, "change", json!({ "dry_run": true, "operations": [{ "op": "page.create", "title": "Zwei" }] }));
        assert_eq!((res["dryRun"].clone(), undo), (Value::Bool(true), None));
        assert_eq!(core.children_of(None, None).len(), 1);
        // Validierung vor der Ausführung.
        let (res, _) = run(&mut e, "change", json!({ "operations": [{ "op": "page.create" }] }));
        assert!(res["error"].as_str().unwrap().contains("title fehlt"));
    }

    #[test]
    fn undo_scheitert_nach_spaeterer_aenderung_und_heft_wird_ergaenzt() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let heft = core.create_heft("Skizzen".into(), None, None).unwrap();
        let (transcript, notify) = (RefCell::new(vec![]), |_: &Value| {});
        let mut e = env(&core.inner, &transcript, &notify);
        let (res, undo) = run(
            &mut e,
            "change",
            json!({ "operations": [{ "op": "heft.append", "title": "Skizzen", "text": "Notiz im Heft" }] }),
        );
        assert_eq!(res["ok"], true, "{res}");
        let page_id = core.heft_page_ids(heft.clone())[0].clone();
        assert_eq!(core.heft_page(heft.clone(), page_id.clone()).unwrap().texts[0].text, "Notiz im Heft");
        let undo = undo.unwrap();
        assert_eq!(undo["heftDocs"].as_array().unwrap().len(), 1);

        // Spätere Änderung am Heft → Rückgängig verweigert, bis sie zurückgenommen ist.
        let (_, second) = run(
            &mut e,
            "change",
            json!({ "operations": [{ "op": "heft.append", "title": "Skizzen", "text": "Zweite Notiz" }] }),
        );
        assert!(core.undo_ai_changes(undo.to_string()).is_err());
        core.undo_ai_changes(second.unwrap().to_string()).unwrap();
        core.undo_ai_changes(undo.to_string()).unwrap();
        assert!(core.heft_page(heft, page_id).unwrap().texts.is_empty());
    }

    #[test]
    fn lesen_und_karten_werkzeuge() {
        let core = ImpalaCore::open_in_memory().unwrap();
        core.create_page("Analysis".into(), "Integrale und Ableitungen".into(), None, None).unwrap();
        core.create_card("Was ist ein Integral?".into(), "Fläche".into(), Some("Mathe".into()), None).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(10));
        let (transcript, notify) = (RefCell::new(vec![]), |_: &Value| {});
        let mut e = env(&core.inner, &transcript, &notify);

        let (r, _) = run(&mut e, "inspect", json!({ "kind": "page", "titles": ["analysis"] }));
        assert_eq!(r["pages"][0]["content"], "Integrale und Ableitungen");
        let (r, _) = run(&mut e, "inspect", json!({ "kind": "search", "query": "ableitungen" }));
        assert_eq!(r["results"][0]["title"], "Analysis");
        let (r, _) = run(&mut e, "inspect", json!({ "kind": "decks" }));
        let mathe = r["decks"].as_array().unwrap().iter().find(|d| d["name"] == "Mathe").expect("Stapel Mathe");
        assert_eq!(mathe["cards"], 1);
        let (r, _) = run(&mut e, "inspect", json!({ "kind": "cards", "query": "integral" }));
        assert_eq!(r["totalMatches"], 1);
        let (r, _) = run(&mut e, "inspect", json!({ "kind": "context" }));
        assert!(r["now"].as_str().unwrap().starts_with("Mittwoch, 28. Oktober 2026, 14:05"), "{r}");
        let (r, _) = run(&mut e, "inspect", json!({ "kind": "semantic-quatsch" }));
        assert!(r["error"].is_string());
        // Mehrdeutig/unbekannt → Fehlertexte für das Modell.
        let (r, _) = run(&mut e, "change", json!({ "operations": [{ "op": "deck.trash", "deck": "gibts-nicht" }] }));
        assert!(r["error"].as_str().unwrap().contains("Stapel nicht gefunden"), "{r}");
        let (r, _) = run(&mut e, "calculate", json!({ "expression": "1+1" }));
        assert!(r["error"].as_str().unwrap().contains("nicht verfügbar"));
    }

    #[test]
    fn deck_und_card_change_bleiben_ohne_pages_klon_rueckgaengig() {
        let core = ImpalaCore::open_in_memory().unwrap();
        core.create_card("Frage 1".into(), "Antwort 1".into(), Some("Alt".into()), None).unwrap();
        let (transcript, notify) = (RefCell::new(vec![]), |_: &Value| {});
        let mut e = env(&core.inner, &transcript, &notify);

        let (res, undo) =
            run(&mut e, "change", json!({ "operations": [{ "op": "deck.rename", "deck": "Alt", "to": "Neu" }] }));
        assert_eq!(res["ok"], true, "{res}");
        let undo = undo.unwrap();
        assert_eq!(undo["pages"], json!([]));
        assert_eq!(undo["cards"].as_array().unwrap().len(), 1);
        assert_eq!(core.cards_in_deck("Neu".into()).len(), 1);

        core.undo_ai_changes(undo.to_string()).unwrap();
        assert_eq!(core.cards_in_deck("Alt".into()).len(), 1);
        assert!(core.cards_in_deck("Neu".into()).is_empty());
    }

    #[test]
    fn list_pages_ordner_pfad_und_duplikat_schutz() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let km = core.create_page("Kontinuumsmechanik".into(), String::new(), None, None).unwrap();
        let vl = core.create_page("Vorlesungen".into(), String::new(), Some(km.clone()), None).unwrap();
        core.create_page("4 · Lager".into(), String::new(), Some(vl), None).unwrap();
        let mathe = core.create_page("Mathe".into(), String::new(), None, None).unwrap();
        core.create_page("Vorlesungen".into(), String::new(), Some(mathe), None).unwrap();
        let (transcript, notify) = (RefCell::new(vec![]), |_: &Value| {});
        let mut e = env(&core.inner, &transcript, &notify);

        // Ordnerfilter liefert nur Nachkommen von Kontinuumsmechanik (inkl. Unterordner).
        let (r, _) = run(&mut e, "inspect", json!({ "kind": "pages", "parent": "Kontinuumsmechanik" }));
        let titles: Vec<&str> = r["pages"].as_array().unwrap().iter().map(|p| p["title"].as_str().unwrap()).collect();
        assert_eq!(titles.len(), 2, "{titles:?}");
        assert!(titles.contains(&"4 · Lager") && titles.contains(&"Kontinuumsmechanik/Vorlesungen"));

        // Pfad-Query findet Nachkommen auch ohne parent.
        let (r, _) = run(&mut e, "inspect", json!({ "kind": "pages", "query": "Kontinuumsmechanik/Vorlesungen/4" }));
        assert_eq!(r["pages"].as_array().unwrap().len(), 1);

        // Unbekannter Ordner liefert klaren Fehler.
        let (r, _) = run(&mut e, "inspect", json!({ "kind": "pages", "parent": "GibtsNicht" }));
        assert!(r["error"].as_str().unwrap().contains("Ordner nicht gefunden"));

        // Duplikat im selben Ordner wird abgelehnt, im anderen Ordner erlaubt.
        let (r, _) = run(
            &mut e,
            "change",
            json!({ "operations": [{ "op": "page.create", "title": "Vorlesungen", "parent": "Kontinuumsmechanik" }] }),
        );
        assert!(r["error"].as_str().unwrap().contains("existiert bereits"));
        let (r, _) = run(
            &mut e,
            "change",
            json!({ "operations": [{ "op": "page.create", "title": "4 · Lager", "parent": "Mathe" }] }),
        );
        assert_eq!(r["ok"], true, "{r}");

        // Nach Löschen (page.trash) darf im selben Batch neu angelegt werden.
        let (r, _) = run(
            &mut e,
            "change",
            json!({ "operations": [
                { "op": "page.trash", "title": "Mathe/4 · Lager" },
                { "op": "page.create", "title": "4 · Lager", "parent": "Mathe" },
            ]}),
        );
        assert_eq!(r["ok"], true, "{r}");
    }
}
