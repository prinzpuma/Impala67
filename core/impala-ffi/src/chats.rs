//! KI-Chats für native Apps: auflisten, lesen, speichern, löschen. Gespeichert wird wie in der PWA
//! (`chatUpsert`/`chatDelete`), die Sitzungen liegen in `state().chat_sessions`.
//!
//! Nachrichten haben bekannte Felder (typisiert) und freie Teile (Anhänge, Rückgängig-Sätze, Flags der
//! Oberfläche …): Letztere gehen unverändert als JSON-Text in `extra_json` durch und kommen beim
//! Speichern unverändert zurück, damit PWA und native App dieselben Chats lesen und schreiben.

use serde_json::{Map, Value, json};

use crate::{CoreError, ImpalaCore, Inner, invalid};

/// Eine Nachricht eines Chats. `role`: `user`, `assistant`, `thought` (Denktext), `tool` (Chip),
/// `edit` (Änderungs-Karte mit Rückgängig), `question` (Rückfrage).
#[derive(Debug, Clone, PartialEq, Default, uniffi::Record)]
pub struct ChatMessage {
    pub mid: Option<String>,
    pub role: String,
    pub content: Option<String>,
    /// Modell, das antwortete (`assistant`).
    pub model: Option<String>,
    /// Denktext (`thought`).
    pub reasoning: Option<String>,
    /// Werkzeugname (`tool`).
    pub name: Option<String>,
    pub detail: Option<String>,
    pub error: Option<bool>,
    /// Kurztext der Änderungs-Karte (`edit`).
    pub summary: Option<String>,
    /// Änderung wurde zurückgenommen (`edit`).
    pub undone: Option<bool>,
    pub question: Option<String>,
    pub options: Option<Vec<String>>,
    pub answered: Option<bool>,
    pub answer: Option<String>,
    /// Bild-Anhang als Data-URL (`user`).
    pub image: Option<String>,
    /// Alle übrigen Felder als JSON-Objekt (`textFile`, `pdfFile`, `undo` …); `{}` wenn keine.
    pub extra_json: String,
}

/// Chat ohne Nachrichten (Liste).
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ChatInfo {
    pub id: String,
    pub title: String,
    pub created: String,
    pub updated: String,
    pub message_count: u32,
}

/// Ganzer Chat.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct ChatData {
    pub id: String,
    pub title: String,
    pub created: String,
    pub updated: String,
    pub messages: Vec<ChatMessage>,
}

fn take_str(m: &mut Map<String, Value>, key: &str) -> Option<String> {
    if !m.get(key)?.is_string() {
        return None;
    }
    match m.remove(key)? {
        Value::String(s) => Some(s),
        _ => None,
    }
}

fn take_bool(m: &mut Map<String, Value>, key: &str) -> Option<bool> {
    let b = m.get(key)?.as_bool()?;
    m.remove(key);
    Some(b)
}

fn take_options(m: &mut Map<String, Value>, key: &str) -> Option<Vec<String>> {
    let list: Option<Vec<String>> = m.get(key)?.as_array()?.iter().map(|v| v.as_str().map(str::to_owned)).collect();
    if list.is_some() {
        m.remove(key);
    }
    list
}

/// Nachricht (JSON der PWA) in Felder zerlegen; was nicht passt, bleibt in `extra_json`.
pub(crate) fn message_of(v: &Value) -> ChatMessage {
    let Value::Object(obj) = v else {
        // Kein Objekt (kaputte Altdaten): unverändert durchreichen.
        return ChatMessage { extra_json: v.to_string(), ..Default::default() };
    };
    let mut m = obj.clone();
    let out = ChatMessage {
        mid: take_str(&mut m, "mid"),
        role: take_str(&mut m, "role").unwrap_or_default(),
        content: take_str(&mut m, "content"),
        model: take_str(&mut m, "model"),
        reasoning: take_str(&mut m, "reasoning"),
        name: take_str(&mut m, "name"),
        detail: take_str(&mut m, "detail"),
        error: take_bool(&mut m, "error"),
        summary: take_str(&mut m, "summary"),
        undone: take_bool(&mut m, "undone"),
        question: take_str(&mut m, "question"),
        options: take_options(&mut m, "options"),
        answered: take_bool(&mut m, "answered"),
        answer: take_str(&mut m, "answer"),
        image: take_str(&mut m, "image"),
        extra_json: String::new(),
    };
    ChatMessage { extra_json: Value::Object(m).to_string(), ..out }
}

/// Umkehrung von [`message_of`]. Gesetzte Felder überschreiben gleichnamige in `extra_json`.
pub(crate) fn message_json(msg: &ChatMessage) -> Value {
    let extra = serde_json::from_str::<Value>(&msg.extra_json).ok();
    let mut m = match extra {
        Some(Value::Object(o)) => o,
        Some(other) if msg.role.is_empty() && msg.mid.is_none() && msg.content.is_none() => return other,
        _ => Map::new(),
    };
    let mut put = |key: &str, v: Option<Value>| {
        if let Some(v) = v {
            m.insert(key.to_owned(), v);
        }
    };
    put("mid", msg.mid.clone().map(Value::from));
    put("role", Some(Value::from(msg.role.clone())));
    put("content", msg.content.clone().map(Value::from));
    put("model", msg.model.clone().map(Value::from));
    put("reasoning", msg.reasoning.clone().map(Value::from));
    put("name", msg.name.clone().map(Value::from));
    put("detail", msg.detail.clone().map(Value::from));
    put("error", msg.error.map(Value::from));
    put("summary", msg.summary.clone().map(Value::from));
    put("undone", msg.undone.map(Value::from));
    put("question", msg.question.clone().map(Value::from));
    put("options", msg.options.clone().map(|o| json!(o)));
    put("answered", msg.answered.map(Value::from));
    put("answer", msg.answer.clone().map(Value::from));
    put("image", msg.image.clone().map(Value::from));
    Value::Object(m)
}

fn text_of(v: Option<Value>) -> String {
    match v {
        Some(Value::String(s)) => s,
        _ => String::new(),
    }
}

/// Titel wie `CHATS.persist`: die ersten 60 Zeichen der ersten Nutzernachricht.
pub(crate) fn derived_title(messages: &[Value]) -> String {
    let first = messages.iter().find(|m| m.get("role").and_then(Value::as_str) == Some("user"));
    let text: String =
        first.and_then(|m| m.get("content")).and_then(Value::as_str).unwrap_or("").chars().take(60).collect();
    if text.is_empty() { "Neuer Chat".to_owned() } else { text }
}

impl Inner {
    /// Gespeicherter, nicht gelöschter Chat als Rohwerte: (Titel, erstellt, geändert, Nachrichten).
    pub(crate) fn chat_raw(&self, id: &str) -> Option<(String, String, String, Vec<Value>)> {
        let c = self.model.state().chat_sessions.get(id)?;
        if c.is_deleted() {
            return None;
        }
        let messages = match c.get("messages") {
            Some(Value::Array(a)) => a,
            _ => Vec::new(),
        };
        Some((text_of(c.get("title")), text_of(c.get("created")), text_of(c.get("updated")), messages))
    }

    /// Chat speichern (`chatUpsert`); `updated` wird neu gesetzt. Ohne Titel gilt der abgeleitete.
    pub(crate) fn save_chat_raw(
        &mut self,
        id: &str,
        title: &str,
        created: &str,
        messages: Vec<Value>,
    ) -> Result<(), CoreError> {
        let now = self.clock.now();
        let title = if title.is_empty() { derived_title(&messages) } else { title.to_owned() };
        let created = if created.is_empty() { now.clone() } else { created.to_owned() };
        let payload = json!({ "id": id, "title": title, "created": created, "updated": now, "messages": messages });
        self.dispatch("chatUpsert", payload)?;
        Ok(())
    }
}

#[uniffi::export]
impl ImpalaCore {
    /// Alle Chats (ohne gelöschte), zuletzt geänderte zuerst.
    pub fn chats(&self) -> Vec<ChatInfo> {
        let inner = self.lock();
        let mut list: Vec<ChatInfo> = inner
            .model
            .state()
            .chat_sessions
            .values()
            .filter(|c| !c.is_deleted())
            .map(|c| ChatInfo {
                id: text_of(c.get("id")),
                title: text_of(c.get("title")),
                created: text_of(c.get("created")),
                updated: text_of(c.get("updated")),
                message_count: match c.get("messages") {
                    Some(Value::Array(a)) => a.len() as u32,
                    _ => 0,
                },
            })
            .collect();
        list.sort_by(|a, b| b.updated.cmp(&a.updated));
        list
    }

    /// Ein Chat mit allen Nachrichten.
    pub fn chat(&self, id: String) -> Option<ChatData> {
        let (title, created, updated, messages) = self.lock().chat_raw(&id)?;
        Some(ChatData { id, title, created, updated, messages: messages.iter().map(message_of).collect() })
    }

    /// Chat anlegen oder ersetzen; liefert die ID (leere `id` = neuer Chat). `updated` setzt der Kern
    /// auf jetzt; unveränderte Chats werden nicht erneut geschrieben.
    pub fn save_chat(&self, chat: ChatData) -> Result<String, CoreError> {
        let id = if chat.id.trim().is_empty() { uuid::Uuid::new_v4().to_string() } else { chat.id.clone() };
        if chat.messages.is_empty() {
            return Err(invalid("Ein Chat braucht mindestens eine Nachricht."));
        }
        let messages: Vec<Value> = chat.messages.iter().map(message_json).collect();
        let mut inner = self.lock();
        let old = inner.chat_raw(&id);
        if let Some((title, _, _, old_messages)) = &old
            && *old_messages == messages
            && (chat.title.is_empty() || *title == chat.title)
        {
            return Ok(id);
        }
        let created = old.map(|o| o.1).filter(|c| !c.is_empty()).unwrap_or(chat.created);
        inner.save_chat_raw(&id, &chat.title, &created, messages)?;
        Ok(id)
    }

    /// Chat löschen (Grabstein, der auch auf anderen Geräten gilt).
    pub fn delete_chat(&self, id: String) -> Result<(), CoreError> {
        let mut inner = self.lock();
        let now = inner.clock.now();
        inner.dispatch("chatDelete", json!({ "id": id, "deletedAt": now }))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use impala_storage::Storage;

    use super::*;

    #[test]
    fn nachrichten_gehen_verlustfrei_durch() {
        let raw = json!({
            "mid": "m1", "role": "edit", "summary": "1 KI-Änderung(en)", "undone": false,
            "undo": { "pages": [{ "id": "p", "before": null, "after": { "title": "x" } }] },
            "reasoning": null, "reasoningExpanded": false, "content": 5, "zukunft": [1, 2]
        });
        let msg = message_of(&raw);
        assert_eq!(
            (msg.role.as_str(), msg.summary.as_deref(), msg.undone),
            ("edit", Some("1 KI-Änderung(en)"), Some(false))
        );
        // Fremder Typ (content = 5) und null bleiben in extra_json.
        assert!(msg.content.is_none() && msg.extra_json.contains("\"content\":5"));
        assert_eq!(message_json(&msg), raw);
        let weird = json!(["kaputt"]);
        assert_eq!(message_json(&message_of(&weird)), weird);
    }

    #[test]
    fn chats_speichern_lesen_loeschen() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let user = ChatMessage {
            mid: Some("a".into()),
            role: "user".into(),
            content: Some("Hallo Welt".into()),
            ..Default::default()
        };
        let chat = ChatData {
            id: String::new(),
            title: String::new(),
            created: String::new(),
            updated: String::new(),
            messages: vec![user],
        };
        assert!(core.save_chat(ChatData { messages: vec![], ..chat.clone() }).is_err());
        let id = core.save_chat(chat).unwrap();
        let mut saved = core.chat(id.clone()).unwrap();
        assert_eq!((saved.title.as_str(), saved.messages.len()), ("Hallo Welt", 1));
        assert_eq!(core.chats()[0].message_count, 1);

        // Unverändert: kein neues Event.
        let seq = || core.lock().storage.log_info().unwrap().max_seq;
        let before = seq();
        core.save_chat(saved.clone()).unwrap();
        assert_eq!(seq(), before);
        saved.messages.push(ChatMessage { role: "assistant".into(), content: Some("Hi".into()), ..Default::default() });
        core.save_chat(saved).unwrap();
        assert_eq!(core.chat(id.clone()).unwrap().messages.len(), 2);
        assert!(seq() > before);

        core.delete_chat(id.clone()).unwrap();
        assert!(core.chat(id).is_none() && core.chats().is_empty());
    }
}
