//! Nachrichten im OpenAI-kompatiblen Chat-Format, wie sie an die Anbieter gehen.

use serde_json::{Map, Value, json};

use crate::js;
use crate::provider::Family;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    System,
    User,
    Assistant,
    Tool,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::System => "system",
            Role::User => "user",
            Role::Assistant => "assistant",
            Role::Tool => "tool",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Part {
    Text(String),
    /// Bild als URL (meist `data:`-URL).
    Image(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Content {
    Text(String),
    Parts(Vec<Part>),
}

impl Content {
    fn has_content(&self) -> bool {
        match self {
            Content::Text(t) => !js::trim(t).is_empty(),
            Content::Parts(p) => !p.is_empty(),
        }
    }

    fn into_parts(self) -> Vec<Part> {
        match self {
            Content::Text(t) if t.is_empty() => vec![],
            Content::Text(t) => vec![Part::Text(t)],
            Content::Parts(p) => p,
        }
    }

    pub fn has_image(&self) -> bool {
        matches!(self, Content::Parts(p) if p.iter().any(|x| matches!(x, Part::Image(_))))
    }

    /// Zwei Inhalte derselben Rolle zusammenführen (lokale Chat-Templates verlangen Wechsel).
    fn merge(self, next: Content) -> Content {
        match (self, next) {
            (Content::Text(a), Content::Text(b)) => Content::Text(if a.is_empty() { b } else { format!("{a}\n\n{b}") }),
            (a, b) => {
                let mut parts = a.into_parts();
                parts.extend(b.into_parts());
                Content::Parts(parts)
            }
        }
    }

    fn to_json(&self) -> Value {
        match self {
            Content::Text(t) => Value::from(t.as_str()),
            Content::Parts(parts) => parts
                .iter()
                .map(|p| match p {
                    Part::Text(t) => json!({ "type": "text", "text": t }),
                    Part::Image(url) => json!({ "type": "image_url", "image_url": { "url": url } }),
                })
                .collect(),
        }
    }
}

/// Werkzeugaufruf des Modells. `arguments` bleibt Text (oft abgeschnitten/ungültig).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
    /// Gemini: Denk-Signatur, muss beim nächsten Schritt zurück.
    pub thought_signature: Option<String>,
    pub extra_content: Option<Value>,
}

impl ToolCall {
    fn to_json(&self) -> Value {
        let mut out = json!({
            "id": self.id,
            "type": "function",
            "function": { "name": self.name, "arguments": self.arguments },
        });
        put_thought(&mut out, &self.thought_signature, &self.extra_content);
        out
    }
}

fn put_thought(out: &mut Value, signature: &Option<String>, extra: &Option<Value>) {
    if let Some(map) = out.as_object_mut() {
        if let Some(s) = signature {
            map.insert("thought_signature".into(), Value::from(s.as_str()));
        }
        if let Some(e) = extra {
            map.insert("extra_content".into(), e.clone());
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Message {
    pub role: Role,
    /// `None` wird als `null` gesendet (Assistent, der nur Werkzeuge aufruft).
    pub content: Option<Content>,
    pub tool_calls: Vec<ToolCall>,
    pub tool_call_id: Option<String>,
    /// Nur DeepSeek erwartet den Denktext beim nächsten Werkzeugschritt zurück.
    pub reasoning_content: Option<String>,
    pub thought_signature: Option<String>,
    pub extra_content: Option<Value>,
}

impl Message {
    pub fn new(role: Role, content: Content) -> Self {
        Message {
            role,
            content: Some(content),
            tool_calls: vec![],
            tool_call_id: None,
            reasoning_content: None,
            thought_signature: None,
            extra_content: None,
        }
    }

    pub fn text(role: Role, text: impl Into<String>) -> Self {
        Self::new(role, Content::Text(text.into()))
    }

    pub fn system(text: impl Into<String>) -> Self {
        Self::text(Role::System, text)
    }

    pub fn user(text: impl Into<String>) -> Self {
        Self::text(Role::User, text)
    }

    pub fn tool_result(call_id: &str, content: String) -> Self {
        Message { tool_call_id: Some(call_id.into()), ..Self::text(Role::Tool, content) }
    }

    /// Text und Bild in einer Nutzer-Nachricht.
    pub fn user_image(text: impl Into<String>, url: impl Into<String>) -> Self {
        Self::new(Role::User, Content::Parts(vec![Part::Text(text.into()), Part::Image(url.into())]))
    }

    pub fn to_json(&self) -> Value {
        let mut map = Map::new();
        map.insert("role".into(), Value::from(self.role.as_str()));
        map.insert("content".into(), self.content.as_ref().map_or(Value::Null, Content::to_json));
        if !self.tool_calls.is_empty() {
            map.insert("tool_calls".into(), self.tool_calls.iter().map(ToolCall::to_json).collect());
        }
        if let Some(id) = &self.tool_call_id {
            map.insert("tool_call_id".into(), Value::from(id.as_str()));
        }
        if let Some(r) = &self.reasoning_content {
            map.insert("reasoning_content".into(), Value::from(r.as_str()));
        }
        let mut out = Value::Object(map);
        put_thought(&mut out, &self.thought_signature, &self.extra_content);
        out
    }

    fn has_content(&self) -> bool {
        self.content.as_ref().is_some_and(Content::has_content)
    }
}

/// Antwort des Modells nach dem Auswerten (gestreamt oder am Stück).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct AssistantMessage {
    pub content: String,
    pub reasoning: Option<String>,
    pub tool_calls: Vec<ToolCall>,
    pub thought_signature: Option<String>,
    pub extra_content: Option<Value>,
    /// Unbearbeiteter Text vor dem Heraustrennen von Denkblöcken (Diagnose).
    pub raw_content: String,
}

impl AssistantMessage {
    /// Als Verlaufs-Nachricht für den nächsten Schritt.
    pub fn to_message(&self, family: Family) -> Message {
        let content = if self.content.is_empty() {
            if self.tool_calls.is_empty() { Some(Content::Text(String::new())) } else { None }
        } else {
            Some(Content::Text(self.content.clone()))
        };
        // Groq, OpenAI, Cloudflare und Google lehnen reasoning_content mit HTTP 400 ab.
        let reasoning_content = if family == Family::Deepseek && !self.tool_calls.is_empty() {
            self.reasoning.clone().filter(|r| !r.is_empty())
        } else {
            None
        };
        Message {
            role: Role::Assistant,
            content,
            tool_calls: self.tool_calls.clone(),
            tool_call_id: None,
            reasoning_content,
            // Denk-Metadaten auf Nachrichtenebene nur für Gemini zurückgeben.
            thought_signature: if family == Family::Google { self.thought_signature.clone() } else { None },
            extra_content: if family == Family::Google { self.extra_content.clone() } else { None },
        }
    }
}

/// Werkzeug-Definition (OpenAI-Function-Calling).
#[derive(Debug, Clone, PartialEq)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    /// JSON-Schema der Argumente.
    pub parameters: Value,
}

const DROP_SCHEMA_KEYS: [&str; 6] = ["minItems", "maxItems", "additionalProperties", "default", "$schema", "examples"];

fn sanitize_schema(value: &Value) -> Value {
    match value {
        Value::Array(a) => a.iter().map(sanitize_schema).collect(),
        Value::Object(o) => o
            .iter()
            .filter(|(k, _)| !DROP_SCHEMA_KEYS.contains(&k.as_str()))
            .map(|(k, v)| (k.clone(), sanitize_schema(v)))
            .collect(),
        other => other.clone(),
    }
}

impl ToolDef {
    /// Aus `{type:"function", function:{name, description, parameters}}`.
    pub fn from_json(v: &Value) -> Option<Self> {
        let f = v.get("function")?;
        Some(ToolDef {
            name: f.get("name")?.as_str()?.to_owned(),
            description: f.get("description").and_then(Value::as_str).unwrap_or_default().to_owned(),
            parameters: f.get("parameters").cloned().unwrap_or(Value::Null),
        })
    }

    /// Für die Anfrage; Gemini lehnt einige Schema-Schlüssel ab.
    pub fn to_json(&self, family: Family) -> Value {
        let parameters =
            if family == Family::Google { sanitize_schema(&self.parameters) } else { self.parameters.clone() };
        json!({ "type": "function", "function": { "name": self.name, "description": self.description, "parameters": parameters } })
    }
}

/// Leere Nachrichten entfernen, gleiche Rollen zusammenführen (LM Studio & lokale Templates).
pub fn normalize_for_api(messages: &[Message]) -> Vec<Message> {
    if messages.is_empty() {
        return vec![];
    }
    let mut out: Vec<Message> = Vec::with_capacity(messages.len());
    for m in messages {
        if !m.has_content() && m.tool_calls.is_empty() && m.role != Role::Tool {
            continue;
        }
        if let Some(prev) = out.last_mut() {
            let same_plain = prev.role == m.role && matches!(m.role, Role::User | Role::System);
            let both_assistant = prev.role == Role::Assistant
                && m.role == Role::Assistant
                && prev.tool_calls.is_empty()
                && m.tool_calls.is_empty();
            if same_plain || both_assistant {
                let a = prev.content.take().unwrap_or(Content::Text(String::new()));
                prev.content = Some(a.merge(m.content.clone().unwrap_or(Content::Text(String::new()))));
                continue;
            }
        }
        out.push(m.clone());
    }
    if out.is_empty() {
        let first = messages.first();
        let text = match first.and_then(|m| m.content.as_ref()) {
            Some(Content::Text(t)) => t.clone(),
            _ => "Hallo".into(),
        };
        out.push(Message::text(first.map_or(Role::User, |m| m.role), text));
    }
    out
}

pub(crate) const TOOL_DROPPED: &str =
    r#"{"gekuerzt":true,"hinweis":"Älteres Ergebnis aus Platzgründen entfernt — bei Bedarf erneut abrufen."}"#;
const IMAGE_DROPPED: &str = "[Bild aus Platzgründen entfernt — bei Bedarf mit view_heft_page erneut anfordern]";
const MAX_IMAGES: usize = 2;
const TOOL_TOTAL: usize = 24000;

/// Verlauf eines Laufs vor jedem Schritt kürzen: ältere Werkzeug-Ergebnisse über dem Budget
/// und Bilder (nach Werkzeug-Schritten hat das Modell sie bereits gesehen) ersetzen.
pub fn prune_run_history(messages: &mut [Message]) {
    let (mut images, mut tool_chars) = (0, 0);
    let has_tool_turns = messages.iter().any(|m| m.role == Role::Tool);
    // Abweichung von JS (ai.js pruneRunHistory): Dort fiel nach dem ersten Werkzeugschritt
    // JEDES Bild weg – auch die gerade per view_heft_page angeforderte Heftseite, die das
    // Modell so nie zu sehen bekam. Hier fallen nur Bilder vor der letzten Modellantwort weg.
    let mut seen_by_model = false;
    for m in messages.iter_mut().rev() {
        if m.role == Role::Assistant {
            seen_by_model = true;
        }
        if m.role == Role::Tool
            && let Some(Content::Text(t)) = &mut m.content
        {
            let len = js::len16(t);
            if tool_chars + len > TOOL_TOTAL && len > js::len16(TOOL_DROPPED) {
                *t = TOOL_DROPPED.into();
            }
            tool_chars += js::len16(t);
            continue;
        }
        let Some(Content::Parts(parts)) = &mut m.content else { continue };
        if !parts.iter().any(|p| matches!(p, Part::Image(_))) {
            continue;
        }
        let drop = (has_tool_turns && seen_by_model) || {
            images += 1;
            images > MAX_IMAGES
        };
        if drop {
            parts.retain(|p| !matches!(p, Part::Image(_)));
            parts.push(Part::Text(IMAGE_DROPPED.into()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zusammenfuehren() {
        let msgs = [
            Message::system("a"),
            Message::system("b"),
            Message::user(" "),
            Message::user("c"),
            Message::user_image("d", "u"),
        ];
        let out = normalize_for_api(&msgs);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].content, Some(Content::Text("a\n\nb".into())));
        assert_eq!(
            out[1].content,
            Some(Content::Parts(vec![Part::Text("c".into()), Part::Text("d".into()), Part::Image("u".into())]))
        );
        assert_eq!(normalize_for_api(&[Message::user("")])[0].content, Some(Content::Text(String::new())));
    }

    #[test]
    fn bilder_kuerzen() {
        let mut msgs = vec![
            Message::user_image("alt", "u1"),
            Message::text(Role::Assistant, "a"),
            Message::tool_result("c", "x".repeat(30000)),
            Message::user_image("neu", "u2"),
        ];
        prune_run_history(&mut msgs);
        assert!(!msgs[0].content.as_ref().unwrap().has_image(), "gesehenes Bild fällt weg");
        assert!(msgs[3].content.as_ref().unwrap().has_image(), "neues Bild bleibt");
        assert_eq!(msgs[2].content, Some(Content::Text(TOOL_DROPPED.into())));
    }
}
