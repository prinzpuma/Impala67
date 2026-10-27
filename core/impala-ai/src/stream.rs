//! Antworten auswerten: SSE-Datenstrom (`data: {…}` je Zeile) stückweise, auch wenn
//! Zeilen oder UTF-8-Zeichen über Paketgrenzen reichen, sowie Antworten am Stück.
//! Denkteile kommen je nach Anbieter als eigenes Feld (`reasoning`, `reasoning_content`,
//! `thought`, `thinking`), als markierte Inhaltsteile oder als `<think>`-Text.

use std::collections::BTreeMap;

use serde_json::Value;

use crate::error::AiError;
use crate::js;
use crate::message::{AssistantMessage, ToolCall};
use crate::think::split_think;

/// Zwischenstand für die Oberfläche (jeweils der ganze bisherige Text).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamUpdate<'a> {
    Content(&'a str),
    Reasoning(&'a str),
}

fn is_thought_part(part: &Value) -> bool {
    part.get("thought") == Some(&Value::Bool(true))
        || part.get("type").and_then(Value::as_str).is_some_and(|t| matches!(t, "thinking" | "thought" | "reasoning"))
}

fn part_text(part: &Value) -> String {
    match part {
        Value::String(s) => s.clone(),
        _ => js::first_truthy([part.get("text"), part.get("content")]),
    }
}

/// Denktext aus einem Nachrichten- oder Delta-Objekt.
fn reasoning_from(value: &Value) -> String {
    if !value.is_object() {
        return String::new();
    }
    for key in ["reasoning", "reasoning_content", "thought", "thinking"] {
        if let Some(s) = js::non_empty_str(value.get(key)) {
            return s.to_owned();
        }
    }
    match value.get("content") {
        Some(Value::Array(parts)) => parts.iter().filter(|p| is_thought_part(p)).map(part_text).collect(),
        _ => String::new(),
    }
}

/// Sichtbarer Text aus `content` (String oder Teile ohne Denkteile).
fn text_from(content: Option<&Value>) -> String {
    match content {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(parts)) => parts.iter().filter(|p| !is_thought_part(p)).map(part_text).collect(),
        Some(other) => js::string(other),
    }
}

/// Gemini-Denksignatur und `extra_content` übernehmen (nur wenn `enabled`).
fn copy_thought(source: &Value, signature: &mut Option<String>, extra: &mut Option<Value>, enabled: bool) {
    if !enabled {
        return;
    }
    let ex = source.get("extra_content");
    let sig = [
        source.get("thought_signature"),
        source.get("thoughtSignature"),
        ex.and_then(|e| e.pointer("/google/thought_signature")),
        ex.and_then(|e| e.pointer("/google/thoughtSignature")),
    ]
    .into_iter()
    .flatten()
    .find(|v| js::truthy(v));
    if let Some(s) = sig {
        *signature = Some(js::string(s));
    }
    if let Some(e) = ex.filter(|e| e.is_object()) {
        *extra = Some(e.clone());
    }
}

/// Zusammenhängende Fragmente eines Werkzeugnamens zusammensetzen (manche Anbieter
/// wiederholen den ganzen Namen, andere senden überlappende Stücke).
fn merge_fragment(current: &str, piece: &str) -> String {
    if piece.is_empty() || current == piece || current.ends_with(piece) || current.starts_with(piece) {
        return if current.is_empty() { piece.into() } else { current.into() };
    }
    if piece.starts_with(current) {
        return piece.into();
    }
    let ends: Vec<usize> = piece.char_indices().map(|(i, _)| i).skip(1).chain([piece.len()]).collect();
    for &n in ends.iter().rev() {
        if current.ends_with(&piece[..n]) {
            return format!("{current}{}", &piece[n..]);
        }
    }
    format!("{current}{piece}")
}

/// Fortlaufende Kennung für Werkzeugaufrufe ohne `id`.
fn fill_ids(calls: Vec<ToolCall>, next_id: &mut dyn FnMut(usize) -> String) -> Vec<ToolCall> {
    calls
        .into_iter()
        .filter(|c| !c.name.is_empty())
        .enumerate()
        .map(|(i, mut c)| {
            if c.id.is_empty() {
                c.id = next_id(i);
            }
            c
        })
        .collect()
}

/// Antwort am Stück (`application/json`).
pub fn parse_completion(
    body: &[u8],
    google: bool,
    next_id: &mut dyn FnMut(usize) -> String,
) -> Result<AssistantMessage, AiError> {
    let data: Value = serde_json::from_slice(body).map_err(|e| AiError::Other(format!("Ungültige KI-Antwort: {e}")))?;
    let choice = data.pointer("/choices/0");
    let message = choice.and_then(|c| c.get("message")).cloned().unwrap_or(Value::Null);
    let raw = text_from(message.get("content"));
    let mut api_reasoning = reasoning_from(&message);
    for src in [choice, Some(&data)].into_iter().flatten() {
        if api_reasoning.is_empty() {
            api_reasoning = reasoning_from(src);
        }
    }
    let split = split_think(&raw, !api_reasoning.is_empty());
    let calls = message.get("tool_calls").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
    let calls = calls
        .iter()
        .map(|c| {
            // Am Stück bleiben Felder des Aufrufs wie geliefert erhalten (JS klont ihn).
            let mut call = ToolCall {
                id: js::first_truthy([c.get("id")]),
                name: js::first_truthy([c.pointer("/function/name")]),
                arguments: js::first_truthy([c.pointer("/function/arguments")]),
                thought_signature: c.get("thought_signature").filter(|v| !v.is_null()).map(js::string),
                extra_content: c.get("extra_content").filter(|v| !v.is_null()).cloned(),
            };
            copy_thought(c, &mut call.thought_signature, &mut call.extra_content, google);
            call
        })
        .collect();
    let mut reasoning = api_reasoning;
    if !split.reasoning.is_empty() {
        reasoning = if reasoning.is_empty() { split.reasoning } else { format!("{reasoning}\n{}", split.reasoning) };
    }
    let mut out = AssistantMessage {
        content: split.content,
        reasoning: (!reasoning.is_empty()).then_some(reasoning),
        tool_calls: fill_ids(calls, next_id),
        raw_content: raw,
        ..Default::default()
    };
    // Nachrichtenebene: Signatur wie geliefert bzw. aus extra_content (nur Gemini zählt später).
    copy_thought(&message, &mut out.thought_signature, &mut out.extra_content, true);
    Ok(out)
}

#[derive(Debug, Default)]
struct Slot {
    id: String,
    name: String,
    arguments: String,
    thought_signature: Option<String>,
    extra_content: Option<Value>,
}

/// SSE-Parser für `/chat/completions` mit `stream: true`.
#[derive(Debug, Default)]
pub struct StreamParser {
    google: bool,
    pending: Vec<u8>,
    line: String,
    raw: String,
    api_reasoning: String,
    leaked: String,
    content: String,
    reasoning: String,
    plain: bool,
    produced: bool,
    slots: BTreeMap<usize, Slot>,
    thought_signature: Option<String>,
    extra_content: Option<Value>,
}

impl StreamParser {
    /// `google`: Gemini-Denk-Metadaten übernehmen.
    pub fn new(google: bool) -> Self {
        StreamParser { google, ..Default::default() }
    }

    /// Hat der Strom schon Inhalt, Denktext oder Werkzeugaufrufe geliefert?
    /// Dann darf ein späterer Fehler nicht wiederholt werden (doppelte Ausgabe).
    pub fn produced(&self) -> bool {
        self.produced
    }

    /// Nächstes Stück Bytes. Unvollständige UTF-8-Zeichen und Zeilen warten auf das nächste.
    pub fn feed(&mut self, chunk: &[u8], on_update: &mut dyn FnMut(StreamUpdate<'_>)) -> Result<(), AiError> {
        self.pending.extend_from_slice(chunk);
        let mut text = String::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(s) => {
                    text.push_str(s);
                    self.pending.clear();
                    break;
                }
                Err(e) => {
                    let valid = e.valid_up_to();
                    text.push_str(std::str::from_utf8(&self.pending[..valid]).unwrap_or_default());
                    match e.error_len() {
                        // Zeichen reicht ins nächste Stück.
                        None => {
                            self.pending.drain(..valid);
                            break;
                        }
                        // Kaputte Bytes wie TextDecoder als U+FFFD.
                        Some(n) => {
                            text.push('\u{FFFD}');
                            self.pending.drain(..valid + n);
                        }
                    }
                }
            }
        }
        self.push_text(&text, on_update)
    }

    fn push_text(&mut self, text: &str, on_update: &mut dyn FnMut(StreamUpdate<'_>)) -> Result<(), AiError> {
        self.line.push_str(text);
        while let Some(nl) = self.line.find('\n') {
            let mut line: String = self.line.drain(..=nl).collect();
            line.pop();
            self.handle_line(&line, on_update)?;
        }
        Ok(())
    }

    /// Strom zu Ende: letzte Zeile ohne Umbruch auswerten und Nachricht abschließen.
    pub fn finish(
        mut self,
        on_update: &mut dyn FnMut(StreamUpdate<'_>),
        next_id: &mut dyn FnMut(usize) -> String,
    ) -> Result<AssistantMessage, AiError> {
        if !self.pending.is_empty() {
            let text = String::from_utf8_lossy(&std::mem::take(&mut self.pending)).into_owned();
            self.push_text(&text, on_update)?;
        }
        let line = std::mem::take(&mut self.line);
        self.handle_line(&line, on_update)?;
        let calls = self
            .slots
            .into_values()
            .map(|s| ToolCall {
                id: s.id,
                name: s.name,
                arguments: s.arguments,
                thought_signature: s.thought_signature,
                extra_content: s.extra_content,
            })
            .collect();
        let tool_calls = fill_ids(calls, next_id);
        let mut content = self.content;
        if content.is_empty() && !self.leaked.is_empty() && self.api_reasoning.is_empty() && tool_calls.is_empty() {
            content = self.leaked;
        }
        Ok(AssistantMessage {
            content,
            reasoning: (!self.reasoning.is_empty()).then_some(self.reasoning),
            tool_calls,
            thought_signature: self.thought_signature,
            extra_content: self.extra_content,
            raw_content: self.raw,
        })
    }

    fn handle_line(&mut self, line: &str, on_update: &mut dyn FnMut(StreamUpdate<'_>)) -> Result<(), AiError> {
        let text = js::trim(line);
        let Some(payload) = text.strip_prefix("data:").map(js::trim) else { return Ok(()) };
        if payload.is_empty() || payload == "[DONE]" {
            return Ok(());
        }
        let Ok(parsed) = serde_json::from_str::<Value>(payload) else { return Ok(()) };
        // Anbieter melden Fehler mitten im Strom als data: {"error": …}.
        if let Some(err) = parsed.get("error").filter(|e| js::truthy(e)) {
            let code = err.get("code").map(js::string).and_then(|c| js::trim(&c).parse::<f64>().ok());
            let status = code.filter(|c| *c >= 1.0 && *c <= 999.0 && c.fract() == 0.0).map_or(502, |c| c as u16);
            return Err(AiError::http(status, payload, 0));
        }
        let Some(delta) = parsed.pointer("/choices/0/delta").filter(|d| js::truthy(d)) else { return Ok(()) };
        copy_thought(delta, &mut self.thought_signature, &mut self.extra_content, self.google);
        let mut produced = false;
        let piece = reasoning_from(delta);
        if !piece.is_empty() {
            produced = true;
            self.api_reasoning.push_str(&piece);
            self.reasoning = self.api_reasoning.clone();
            on_update(StreamUpdate::Reasoning(&self.reasoning));
        }
        let piece = text_from(delta.get("content"));
        if !piece.is_empty() {
            produced = true;
            self.add_text(&piece, on_update);
            on_update(StreamUpdate::Content(&self.content));
        }
        if let Some(calls) = delta.get("tool_calls").and_then(Value::as_array) {
            for incoming in calls {
                produced |= self.add_call(incoming);
            }
        }
        self.produced |= produced;
        Ok(())
    }

    fn add_text(&mut self, piece: &str, on_update: &mut dyn FnMut(StreamUpdate<'_>)) {
        self.raw.push_str(piece);
        if self.plain && piece.contains('<') {
            self.plain = false;
        }
        if self.plain {
            // Schnellweg für lange Antworten ohne Denkanteil: nicht bei jedem Stück neu zerlegen.
            self.content = self.raw.clone();
            return;
        }
        let split = split_think(&self.raw, !self.api_reasoning.is_empty());
        if js::len16(&split.reasoning) >= js::len16(&self.leaked) {
            self.leaked = split.reasoning;
        }
        self.reasoning = match (self.api_reasoning.is_empty(), self.leaked.is_empty()) {
            (_, true) => self.api_reasoning.clone(),
            (true, false) => self.leaked.clone(),
            (false, false) => format!("{}\n{}", self.api_reasoning, self.leaked),
        };
        if !self.reasoning.is_empty() {
            on_update(StreamUpdate::Reasoning(&self.reasoning));
        }
        self.plain = self.leaked.is_empty()
            && split.content == self.raw
            && js::len16(&self.raw) > 400
            && !self.raw.contains('<');
        self.content = split.content;
    }

    fn add_call(&mut self, incoming: &Value) -> bool {
        let id = js::non_empty_str(incoming.get("id"));
        let name = js::first_truthy([incoming.pointer("/function/name")]);
        let args = incoming.pointer("/function/arguments").filter(|a| js::truthy(a)).map(js::string);
        let produced = id.is_some() || !name.is_empty() || args.is_some();
        let len = self.slots.last_key_value().map_or(0, |(k, _)| k + 1);
        let index = match incoming.get("index").filter(|v| !v.is_null()) {
            Some(v) => v.as_f64().filter(|f| *f >= 0.0 && f.fract() == 0.0).map(|f| f as usize),
            None => match id {
                Some(id) => self.slots.iter().find(|(_, s)| s.id == id).map(|(k, _)| *k),
                None => len.checked_sub(1),
            },
        };
        let slot = self.slots.entry(index.unwrap_or(len)).or_default();
        copy_thought(incoming, &mut slot.thought_signature, &mut slot.extra_content, self.google);
        if let Some(id) = id {
            slot.id = id.to_owned();
        }
        slot.name = merge_fragment(&slot.name, &name);
        if let Some(a) = args {
            slot.arguments.push_str(&a);
        }
        produced
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(chunks: &[&[u8]]) -> AssistantMessage {
        let mut p = StreamParser::new(false);
        for c in chunks {
            p.feed(c, &mut |_| {}).unwrap();
        }
        p.finish(&mut |_| {}, &mut |i| format!("call_{i}")).unwrap()
    }

    #[test]
    fn zeichen_ueber_paketgrenzen() {
        let all = "data: {\"choices\":[{\"delta\":{\"content\":\"Grüße\"}}]}\n\ndata: [DONE]".as_bytes();
        let at = all.iter().position(|&b| b == 0xC3).unwrap() + 1;
        let msg = run(&[&all[..at], &all[at..]]);
        assert_eq!(msg.content, "Grüße");
    }

    #[test]
    fn werkzeugaufruf_in_stuecken() {
        let a = br#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"x","function":{"name":"insp","arguments":"{\"ki"}}]}}]}"#;
        let b = br#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"inspect","arguments":"nd\":1}"}}]}}]}"#;
        let msg = run(&[a, b"\n", b]);
        assert_eq!(msg.tool_calls.len(), 1);
        assert_eq!(msg.tool_calls[0].name, "inspect");
        assert_eq!(msg.tool_calls[0].arguments, "{\"kind\":1}");
        assert_eq!(merge_fragment("insp", "spect"), "inspect");
    }

    #[test]
    fn fehler_im_strom() {
        let mut p = StreamParser::new(false);
        let err = p.feed(b"data: {\"error\":{\"code\":429,\"message\":\"zu viel\"}}\n", &mut |_| {}).unwrap_err();
        assert_eq!(err.status(), Some(429));
    }
}
