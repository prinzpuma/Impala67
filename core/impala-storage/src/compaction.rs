//! Brücke zu `impala_sync::compact`: Welche Events bleiben, entscheidet allein der Sync-Kern.
//! Hier wird nur der gespeicherte JSON-Log dafür lesbar gemacht.

use impala_sync::{Field, JsLike, Kind};
use serde_json::Value;

use crate::event::Object;

/// JSON-Wert mit JS-Semantik für [`impala_sync::decode`]; `Root` ist ein Event-Objekt (ohne Kopie).
#[derive(Clone, Copy)]
enum Json<'a> {
    Root(&'a Object),
    Val(&'a Value),
}

static NULL: Value = Value::Null;

impl<'a> JsLike for Json<'a> {
    fn kind(&self) -> Kind {
        match self {
            Json::Root(_) => Kind::Object,
            Json::Val(v) => match v {
                Value::Null => Kind::Nullish,
                Value::Bool(false) => Kind::Falsy,
                Value::Number(n) if n.as_f64() == Some(0.0) => Kind::Falsy,
                Value::String(_) => Kind::Str,
                Value::Array(_) => Kind::Array,
                Value::Object(_) => Kind::Object,
                _ => Kind::Other,
            },
        }
    }
    fn get(&self, field: Field) -> Self {
        let found = match self {
            Json::Root(o) => o.get(field.name()),
            Json::Val(v) => v.get(field.name()),
        };
        Json::Val(found.unwrap_or(&NULL))
    }
    fn as_str(&self) -> Option<String> {
        match self {
            Json::Val(v) => v.as_str().map(str::to_owned),
            Json::Root(_) => None,
        }
    }
    fn as_f64(&self) -> Option<f64> {
        match self {
            Json::Val(v) => v.as_f64(),
            Json::Root(_) => None,
        }
    }
    fn keys(&self) -> Vec<String> {
        match self {
            Json::Root(o) => o.keys().cloned().collect(),
            Json::Val(v) => v.as_object().map(|o| o.keys().cloned().collect()).unwrap_or_default(),
        }
    }
    fn items(&self) -> Vec<Self> {
        match self {
            Json::Val(v) => v.as_array().map(|a| a.iter().map(Json::Val).collect()).unwrap_or_default(),
            Json::Root(_) => Vec::new(),
        }
    }
}

/// Indizes der behaltenen Events in Log-Reihenfolge (nach `t`, dann `seq`).
/// `None`: Ein Event hat eine Form, über die der Sync-Kern nicht sicher entscheiden kann –
/// dann wird nicht kompaktiert (Kompaktierung ist optional, Weglassen nie nötig).
pub fn keep_indices(events: &[Object]) -> Option<Vec<usize>> {
    let decoded: Result<Vec<_>, _> = events.iter().map(|ev| impala_sync::decode(&Json::Root(ev))).collect();
    decoded.ok().map(|evs| impala_sync::compact(&evs))
}
