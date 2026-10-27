//! Event-Reihenfolge (`web/event-order.js`): Wann darf ein verspätetes Fremd-Event hinter
//! neuere Events rutschen?
//!
//! Der Replay sortiert das Log nach Zeit. Ein Fremd-Event, das älter ist als schon angewandte
//! (anderes Gerät offline, gebündelter Upload), steht im Speicher hinter Events, vor die es
//! gehört. Das ist nur egal, wenn keines dieser neueren Events dieselbe Sache anfasst.
//! [`order_keys`] nennt die Sachen, die ein Event liest oder schreibt; `None` heißt „wirkt auf
//! vieles“ (Seitenbaum, Stapel, Einstellungen, unbekannte Arten) und verträgt keine andere Reihenfolge.

use std::cmp::Ordering;

use indexmap::IndexMap;
use serde_json::Value;

use crate::event::LogEvent;
use crate::js::{self, Object};

/// Schlüssel für „wirkt auf vieles“.
pub const ORDER_ALL: &str = "*";

/// Je Sache der späteste Event-Zeitpunkt (`orderTimes` im Checkpoint), in Einfügereihenfolge.
pub type OrderTimes = IndexMap<String, String>;

/// Die Sachen, die ein Event anfasst (`orderKeysOf`). `None`: wirkt auf vieles.
pub fn order_keys(kind: &str, payload: &Value) -> Option<Vec<String>> {
    let mut keys = Vec::new();
    visit_keys(kind, payload, &mut |k| keys.push(k.to_owned())).then_some(keys)
}

/// Ruft `f` für jede Sache auf, die das Event anfasst; `false`: wirkt auf vieles (keine Schlüssel).
/// Ohne Zwischenlisten – das läuft für jedes Event beim Start.
fn visit_keys(kind: &str, payload: &Value, f: &mut dyn FnMut(&str)) -> bool {
    let mut buf = String::new();
    let mut key = |prefix: &str, id: &Value, f: &mut dyn FnMut(&str)| {
        buf.clear();
        buf.push_str(prefix);
        match id {
            Value::String(s) => buf.push_str(s),
            other => buf.push_str(&js::to_string(other)),
        }
        f(&buf);
    };
    let field = |k: &str| js::or(payload.get(k));
    let mut one = |prefix: &str, k: &str, f: &mut dyn FnMut(&str)| match field(k) {
        Some(id) => {
            key(prefix, id, f);
            true
        }
        None => false,
    };
    match kind {
        "pageCreate" => match field("id") {
            Some(id) => {
                key("page:", id, f);
                key("life:", id, f);
                true
            }
            None => false,
        },
        "pageUpdate" => match field("id") {
            Some(id) => {
                key("page:", id, f);
                // Ob eine Seite existiert und im Papierkorb liegt, lesen andere Reducer (offene Tabs).
                if payload.get("patch").and_then(Value::as_object).is_some_and(|o| o.contains_key("trashed")) {
                    key("life:", id, f);
                }
                true
            }
            None => false,
        },
        "heftOps" | "heftSnap" => one("page:", "pageId", f),
        // Inhaltsadressiert: derselbe Hash trägt immer dieselben Bytes.
        "heftBlob" => true,
        "learningSessionUpsert" | "learningSessionDelete" => one("session:", "id", f),
        "chatUpsert" | "chatDelete" => one("chat:", "id", f),
        "homeArticleUpsert" => one("article:", "id", f),
        "teleEvent" => {
            f("telemetry");
            true
        }
        "uiTreeSet" => one("tree:", "key", f),
        "uiTabsSet" => {
            f("tabs");
            for id in payload.get("tabs").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
                match id.strip_prefix("chat:") {
                    Some(chat) => key("chat:", &Value::from(chat), f),
                    None => key("life:", &Value::from(id), f),
                }
            }
            true
        }
        "cardCreate" => match field("id") {
            Some(id) => {
                key("card:", id, f);
                key("deck:", &Value::from(js::str_or_empty(payload.get("deck"))), f);
                true
            }
            None => false,
        },
        "cardUpdate" => one("card:", "id", f),
        "cardReview" | "cardReviewUndo" => match field("id") {
            Some(id) => {
                key("card:", id, f);
                f("reviews");
                true
            }
            None => false,
        },
        _ => false,
    }
}

/// Merkt sich je Sache den spätesten Zeitpunkt (`noteEventOrder`).
pub fn note_event_order(times: &mut OrderTimes, ev: &LogEvent) {
    let mut note = |key: &str| match times.get_mut(key) {
        Some(cur) if js::lt(cur, &ev.t) => cur.clone_from(&ev.t),
        Some(_) => {}
        None if !ev.t.is_empty() => {
            times.insert(key.to_owned(), ev.t.clone());
        }
        None => {}
    };
    if !visit_keys(&ev.kind, &ev.payload, &mut note) {
        note(ORDER_ALL);
    }
}

/// Liefert das Event dasselbe Ergebnis, egal ob es vor oder nach den in `times` erfassten
/// Events läuft (`reorderSafe`)? Ohne Zeiten (alter Checkpoint) ist das nie beweisbar.
pub fn reorder_safe(ev: &LogEvent, times: Option<&OrderTimes>) -> bool {
    let Some(times) = times else { return false };
    let not_after = |key: &str| times.get(key).is_none_or(|t| !js::lt(&ev.t, t));
    let mut all = true;
    visit_keys(&ev.kind, &ev.payload, &mut |k| all &= not_after(k)) && all && not_after(ORDER_ALL)
}

/// [`reorder_safe`] für gespeicherte Events und die `orderTimes` eines Checkpoints
/// (Signatur für `impala_storage::checkpoint::load`).
pub fn reorder_safe_object(ev: &Object, times: Option<&Object>) -> bool {
    let Some(ev) = LogEvent::from_object(ev) else {
        // Ohne Typ: orderKeysOf liefert null → nie sicher.
        return false;
    };
    let times: Option<OrderTimes> = times.map(times_from_object);
    reorder_safe(&ev, times.as_ref())
}

pub fn times_from_object(o: &Object) -> OrderTimes {
    o.iter().map(|(k, v)| (k.clone(), js::str_or_empty(Some(v)))).collect()
}

pub fn times_to_object(t: &OrderTimes) -> Object {
    t.iter().map(|(k, v)| (k.clone(), Value::from(v.clone()))).collect()
}

/// Replay-Reihenfolge (`sortEvents`): nach Zeit, bei Gleichstand nach `seq`; stabil.
pub fn sort_events(events: &mut [LogEvent]) {
    // Meist ASCII-Zeitstempel: dann genügt der Byte-Vergleich (gleiche Ordnung wie UTF-16).
    if events.iter().all(|e| e.t.is_ascii()) {
        events.sort_by(|a, b| a.t.as_bytes().cmp(b.t.as_bytes()).then(a.seq.cmp(&b.seq)));
    } else {
        events.sort_by(compare_events);
    }
}

pub fn compare_events(a: &LogEvent, b: &LogEvent) -> Ordering {
    js::cmp(&a.t, &b.t).then(a.seq.cmp(&b.seq))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn verspaetetes_event_ohne_ueberschneidung() {
        let ev = |t: &str, kind: &str, p: Value| LogEvent::new("x", t, kind, p);
        let mut times = OrderTimes::new();
        note_event_order(&mut times, &ev("2026-01-02", "pageUpdate", json!({ "id": "a", "patch": {} })));
        assert!(reorder_safe(&ev("2026-01-01", "pageUpdate", json!({ "id": "b", "patch": {} })), Some(&times)));
        assert!(!reorder_safe(&ev("2026-01-01", "pageUpdate", json!({ "id": "a", "patch": {} })), Some(&times)));
        assert!(!reorder_safe(&ev("2026-01-01", "deckCreate", json!({ "name": "x" })), Some(&times)));
        assert!(!reorder_safe(&ev("2026-01-03", "pageUpdate", json!({ "id": "b" })), None));
        note_event_order(&mut times, &ev("2026-01-02", "settingsSet", json!({})));
        assert!(!reorder_safe(&ev("2026-01-01", "heftBlob", json!({ "hash": "h" })), Some(&times)));
        assert!(reorder_safe(&ev("2026-01-02", "heftBlob", json!({ "hash": "h" })), Some(&times)));
    }
}
