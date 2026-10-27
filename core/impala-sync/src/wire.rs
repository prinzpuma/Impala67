//! Wire-Format von Protokoll v4 (`web/sync-core.js`): lokale Metadaten entfernen,
//! Echo-Unterdrückung je Transport, eingehende Envelopes prüfen, Heft-Ausgangsstand.

use serde_json::{Map, Value, json};

use crate::SyncError;
use crate::js::truthy;

pub const CLOUD_SYNC_PROTOCOL: u64 = 4;
pub const CLOUD_SYNC_PROTOCOL_HEADER: &str = "X-Impala-Sync-Protocol";
/// Nur lokal gültig, nie auf dem Draht: IndexedDB-Schlüssel und Replay-Markierungen.
pub const LOCAL_EVENT_METADATA_KEYS: [&str; 4] = ["seq", "_remote", "_remoteSource", "_derived"];

/// Woher ein entferntes Event kam (`_remoteSource`). Jeder Transport unterdrückt nur sein
/// eigenes Echo, damit Drive ein unabhängiges Backup bleibt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transport {
    Cloudflare,
    Drive,
}

impl Transport {
    pub fn as_str(self) -> &'static str {
        match self {
            Transport::Cloudflare => "cloudflare",
            Transport::Drive => "drive",
        }
    }
}

/// `shouldUploadToSync`: Nur das eigene Echo eines Transports geht nicht zurück.
pub fn should_upload_to(event: &Value, target: Transport) -> bool {
    event.get("_remoteSource").and_then(Value::as_str) != Some(target.as_str())
}

/// `pruneEventsForUpload`: UI-Zustand (Tabs, Baum) bleibt auf dem Gerät.
pub fn prune_for_upload(events: Vec<Value>) -> Vec<Value> {
    events
        .into_iter()
        .filter(|ev| !matches!(ev.get("type").and_then(Value::as_str), Some("uiTabsSet" | "uiTreeSet")))
        .collect()
}

/// `prepareCloudEvents`: ohne Cloudflare-Echo (außer `include_remote`, beim Neuaufbau nach einem
/// Generationsschnitt) und ohne lokale Metadaten. Feldreihenfolge bleibt.
// Abweichung von JS: Einträge, die keine Objekte sind, entfallen (JS machte aus `null` ein `{}`
// und aus einem Text ein Objekt seiner Zeichen).
pub fn prepare_cloud_events(events: Vec<Value>, include_remote: bool) -> Vec<Value> {
    events
        .into_iter()
        .filter(|ev| include_remote || should_upload_to(ev, Transport::Cloudflare))
        .filter_map(|ev| match ev {
            Value::Object(mut map) => {
                // `retain` lässt die Reihenfolge der übrigen Felder unverändert.
                map.retain(|k, _| !LOCAL_EVENT_METADATA_KEYS.contains(&k.as_str()));
                Some(Value::Object(map))
            }
            _ => None,
        })
        .collect()
}

/// `prepareIncomingCloudEvents`: Envelopes (`{v: 4, events: [...]}` oder alt `{v: 4, event}`)
/// prüfen und die Events als Cloudflare-Fremdevents markieren.
pub fn prepare_incoming_cloud_events(envelopes: Vec<Value>) -> Result<Vec<Value>, SyncError> {
    let mut out = Vec::new();
    for envelope in envelopes {
        let Value::Object(mut envelope) = envelope else { return Err(protocol_required()) };
        if envelope.get("v").and_then(Value::as_f64) != Some(CLOUD_SYNC_PROTOCOL as f64) {
            return Err(protocol_required());
        }
        let events = match envelope.remove("events") {
            Some(Value::Array(events)) => events,
            _ => match envelope.remove("event") {
                Some(ev) if truthy(Some(&ev)) => vec![ev],
                _ => Vec::new(),
            },
        };
        if events.is_empty() {
            return Err(SyncError::Protocol("Cloud-Event-Paket ist leer.".into()));
        }
        for ev in events {
            let Value::Object(mut ev) = ev else {
                return Err(SyncError::Protocol("Cloud-Event ist ungültig.".into()));
            };
            if LOCAL_EVENT_METADATA_KEYS.iter().any(|k| ev.contains_key(*k)) {
                return Err(SyncError::Protocol("Cloud-Event enthält unzulässige lokale Metadaten.".into()));
            }
            ev.insert("_remote".into(), Value::Bool(true));
            ev.insert("_remoteSource".into(), json!(Transport::Cloudflare.as_str()));
            out.push(Value::Object(ev));
        }
    }
    Ok(out)
}

fn protocol_required() -> SyncError {
    SyncError::Protocol(format!("Sync-Protokoll v{CLOUD_SYNC_PROTOCOL} erforderlich."))
}

/// `JSON.stringify(cloudEventsEnvelope(events))` aus schon serialisierten Events.
pub fn envelope_json<'a>(event_jsons: impl IntoIterator<Item = &'a str>) -> Result<String, SyncError> {
    let mut out = format!("{{\"v\":{CLOUD_SYNC_PROTOCOL},\"events\":[");
    let mut empty = true;
    for (i, ev) in event_jsons.into_iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(ev);
        empty = false;
    }
    if empty {
        return Err(SyncError::Protocol("Cloud-Event-Paket ist leer.".into()));
    }
    out.push_str("]}");
    Ok(out)
}

/// Feld eines Objekts; `[].x`, `"".x` usw. sind `undefined`. `null.x` wirft in JS.
fn field<'a>(v: &'a Value, key: &str, what: &str) -> Result<Option<&'a Value>, SyncError> {
    match v {
        Value::Object(o) => Ok(o.get(key)),
        Value::Null => Err(SyncError::Protocol(format!("{what} ist null"))),
        _ => Ok(None),
    }
}

/// `x || []` vor `for…of`.
fn list<'a>(v: Option<&'a Value>, what: &str) -> Result<&'a [Value], SyncError> {
    match v {
        Some(Value::Array(items)) => Ok(items),
        v if !truthy(v) => Ok(&[]),
        _ => Err(SyncError::Protocol(format!("{what} ist keine Liste"))),
    }
}

/// Objekt aus Feldern; `undefined` (fehlend) lässt `JSON.stringify` weg.
fn obj(fields: Vec<(&str, Option<Value>)>) -> Value {
    Value::Object(fields.into_iter().filter_map(|(k, v)| Some((k.to_owned(), v?))).collect::<Map<_, _>>())
}

/// `heftBaselineOps`: ein Heft-Dokument als Ops-Folge (lokale v4-Migration).
pub fn heft_baseline_ops(doc: &Value) -> Result<Vec<Value>, SyncError> {
    let pages = match doc.get("pages") {
        Some(Value::Array(pages)) => pages.as_slice(),
        _ => &[],
    };
    let mut ops = Vec::new();
    let mut ids = Vec::with_capacity(pages.len());
    for (at, page) in pages.iter().enumerate() {
        let id = field(page, "id", "Heft-Seite")?.cloned();
        let paper = field(page, "paper", "Heft-Seite")?.filter(|p| truthy(Some(p))).cloned();
        let page = obj(vec![("id", id.clone()), ("paper", Some(paper.unwrap_or_else(|| json!("lined"))))]);
        ops.push(json!({ "t": "pg+", "at": at, "page": page }));
        ids.push(id.unwrap_or(Value::Null)); // in Arrays wird undefined zu null
    }
    if !pages.is_empty() {
        ops.push(json!({ "t": "pgo", "order": ids }));
    }
    for page in pages {
        let id = field(page, "id", "Heft-Seite")?.cloned();
        if let Some(text) = field(page, "ocrText", "Heft-Seite")?.filter(|t| truthy(Some(t))) {
            ops.push(obj(vec![("t", Some(json!("ocr"))), ("p", id.clone()), ("text", Some(text.clone()))]));
        }
        for (key, op) in [("strokes", "s+"), ("images", "i+"), ("texts", "x+")] {
            for o in list(field(page, key, "Heft-Seite")?, key)? {
                ops.push(obj(vec![("t", Some(json!(op))), ("p", id.clone()), ("o", Some(o.clone()))]));
            }
        }
    }
    Ok(ops)
}

/// Ausgangs-Event eines Hefts für die lokale v4-Migration (`migrateLocalV4`); `None` ohne Seiten.
/// `t`: letzte Änderung des Hefts, sonst Zeit des geladenen Stands.
pub fn heft_baseline_event(page_id: &str, doc: &Value, t: &str) -> Result<Option<Value>, SyncError> {
    let ops = heft_baseline_ops(doc)?;
    if ops.is_empty() {
        return Ok(None);
    }
    let pages = doc.get("pages").filter(|p| truthy(Some(p))).cloned().unwrap_or_else(|| json!([]));
    let hash = impala_crypto::sha256_hex(&impala_crypto::json::stringify(&pages));
    Ok(Some(json!({
        "id": format!("v4-heft-{page_id}-{}", &hash[..24]),
        "t": t,
        "type": "heftOps",
        "payload": { "pageId": page_id, "ops": ops },
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_metadata_and_own_echo() {
        let events = vec![
            json!({"id": "a", "seq": 1, "t": "x", "_derived": true}),
            json!({"id": "b", "_remote": true, "_remoteSource": "cloudflare"}),
            json!({"id": "c", "_remote": true, "_remoteSource": "drive"}),
            json!(null),
        ];
        let out = prepare_cloud_events(events.clone(), false);
        assert_eq!(out, vec![json!({"id": "a", "t": "x"}), json!({"id": "c"})]);
        assert_eq!(prepare_cloud_events(events, true).len(), 3);
    }

    #[test]
    fn incoming_rules() {
        let ok = prepare_incoming_cloud_events(vec![json!({"v": 4, "event": {"id": "x"}})]).unwrap();
        assert_eq!(ok, vec![json!({"id": "x", "_remote": true, "_remoteSource": "cloudflare"})]);
        for bad in [json!({"v": 3, "events": [{}]}), json!({"v": 4, "events": []}), json!({"v": 4, "events": [[]]})] {
            assert!(prepare_incoming_cloud_events(vec![bad]).is_err());
        }
        assert!(prepare_incoming_cloud_events(vec![json!({"v": 4, "events": [{"seq": 1}]})]).is_err());
    }

    #[test]
    fn envelope_text() {
        assert_eq!(envelope_json(["{\"a\":1}", "{}"]).unwrap(), r#"{"v":4,"events":[{"a":1},{}]}"#);
        assert!(envelope_json([]).is_err());
    }
}
