//! Event-Log-Einträge, wie sie im `events`-Store liegen: lose JSON-Objekte (alte App-Versionen,
//! fremde Geräte). Die Speicherschicht prüft nur, was sie selbst braucht (id, t, type, seq).

use serde_json::{Map, Value};

use crate::{Error, js};

/// Lokale, fortlaufende Nummer eines Events (IndexedDB-Schlüssel `seq`). Gilt nur auf diesem Gerät.
pub type Seq = u64;
/// Ein JSON-Objekt (Event, Checkpoint, Zustand).
pub type Object = Map<String, Value>;

/// Gerätelokale Marken, die nie ein Gerät verlassen (siehe `stripLocalFlags` in db.js).
pub const LOCAL_FLAGS: [&str; 4] = ["_remote", "_remoteSource", "_derived", "seq"];
/// Einstellungs-Felder, die bei `redactSecrets` aus `settingsSet` entfernt werden.
pub const SECRET_FIELDS: [&str; 2] = ["notionToken", "driveDesktopClientSecret"];

/// Kennzahlen des Logs: Grundlage für Checkpoint-Gültigkeit und Sync-Wasserstand.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LogInfo {
    pub count: u64,
    pub max_seq: Seq,
    /// `id` des Events mit der höchsten `seq` (`String(id)`, leer ohne Events).
    pub last_event_id: String,
}

/// Prüft die Pflichtfelder vor dem Speichern (`validateEvent` in db.js):
/// `id` und `t` wahr, `type` nicht-leerer String.
pub fn validate(ev: &Object) -> Result<(), Error> {
    let ok = ev.get("id").is_some_and(js::truthy)
        && ev.get("t").is_some_and(js::truthy)
        && ev.get("type").and_then(Value::as_str).is_some_and(|t| !t.is_empty());
    if ok { Ok(()) } else { Err(Error::InvalidEvent("Event benötigt id, t und type als String.".into())) }
}

/// Schlüssel für die Dublettenprüfung: wie ein JS-`Set` unterscheidet er `"5"` und `5`.
/// `None` für falsy IDs (die nie als bekannt gelten).
pub fn id_key(id: &Value) -> Option<String> {
    match id {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        v if js::truthy(v) => Some(format!("\0{v}")),
        _ => None,
    }
}

/// Event ohne gerätelokale Marken (`stripLocalFlags`).
pub fn strip_local_flags(mut ev: Object) -> Object {
    for flag in LOCAL_FLAGS {
        ev.shift_remove(flag);
    }
    ev
}

/// Entfernt Klartext-Geheimnisse aus `settingsSet` (`SETTINGS_SYNC.sanitizeEvent(ev, false)`).
/// `None`: Das Event bestand nur aus Geheimnissen und entfällt.
pub fn redact_secrets(mut ev: Object) -> Option<Object> {
    if ev.get("type").and_then(Value::as_str) != Some("settingsSet") {
        return Some(ev);
    }
    let Some(Value::Object(payload)) = ev.get_mut("payload") else { return Some(ev) };
    for key in SECRET_FIELDS {
        payload.shift_remove(key);
    }
    if let Some(Value::Array(providers)) = payload.get_mut("aiProviders") {
        // Abweichung von JS: Nicht-Objekte bleiben unverändert (JS warf bei `null` einen TypeError).
        for p in providers.iter_mut().filter_map(Value::as_object_mut) {
            p.shift_remove("key");
        }
    }
    if payload.is_empty() { None } else { Some(ev) }
}

/// Normalisiert ein eingehendes Event (Import/Sync) oder verwirft es (`None`).
/// Zahlen-Zeitstempel werden zu ISO-Strings (`new Date(t).toISOString()`).
///
/// Abweichung von JS: Ein leerer `type` gilt als unbrauchbar. In JS passierte er die
/// Normalisierung, ließ dann aber `addEvents` werfen – und damit den ganzen Import scheitern.
pub fn normalize_incoming(ev: &Value) -> Option<Object> {
    let obj = ev.as_object()?;
    let t = match obj.get("t") {
        Some(Value::Number(n)) => Value::String(js::iso_from_ms(n.as_f64()?)?),
        Some(Value::String(s)) if !s.is_empty() => Value::String(s.clone()),
        _ => return None,
    };
    if !obj.get("id").is_some_and(js::truthy) || !obj.get("type").and_then(Value::as_str).is_some_and(|s| !s.is_empty())
    {
        return None;
    }
    let mut out = obj.clone();
    out.insert("t".into(), t);
    Some(out)
}

/// `type` eines Events (leer, wenn keiner).
pub fn kind(ev: &Object) -> &str {
    ev.get("type").and_then(Value::as_str).unwrap_or("")
}

/// `t` eines Events (leer, wenn kein String).
pub fn time(ev: &Object) -> &str {
    ev.get("t").and_then(Value::as_str).unwrap_or("")
}

/// Lokale Nummer eines gelesenen Events.
pub fn seq(ev: &Object) -> Seq {
    js::seq_of(ev.get("seq"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn obj(v: Value) -> Object {
        v.as_object().cloned().unwrap()
    }

    #[test]
    fn validation_and_ids() {
        assert!(validate(&obj(json!({"id": "a", "t": "x", "type": "p"}))).is_ok());
        assert!(validate(&obj(json!({"id": 0, "t": "x", "type": "p"}))).is_err());
        assert!(validate(&obj(json!({"id": "a", "t": "x", "type": ""}))).is_err());
        assert_ne!(id_key(&json!("5")), id_key(&json!(5)));
        assert_eq!(id_key(&json!(false)), None);
    }

    #[test]
    fn secrets_are_removed() {
        let ev = obj(json!({"type": "settingsSet", "payload": {"notionToken": "x"}}));
        assert_eq!(redact_secrets(ev), None);
        let ev = obj(json!({"type": "settingsSet", "payload": {"aiProviders": [{"key": "k", "id": 1}, null]}}));
        assert_eq!(redact_secrets(ev).unwrap()["payload"], json!({"aiProviders": [{"id": 1}, null]}));
    }

    #[test]
    fn incoming_numbers_become_iso() {
        let ev = normalize_incoming(&json!({"id": "a", "t": 0, "type": "x", "seq": 4})).unwrap();
        assert_eq!(ev["t"], "1970-01-01T00:00:00.000Z");
        assert!(normalize_incoming(&json!({"id": "a", "t": 1e300, "type": "x"})).is_none());
        assert!(normalize_incoming(&json!([1])).is_none());
    }
}
