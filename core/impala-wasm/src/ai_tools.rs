//! KI-Werkzeuge der PWA über `impala-tools` (dieselbe Ausführung wie in den nativen Apps).
//!
//! Die Werkzeuge laufen auf dem Zustand von [`ModelCore`]: jedes Event wird sofort angewendet
//! (spätere Operationen sehen frühere) und mit dem, was es berührt hat, zurückgegeben. Die PWA
//! speichert die Events danach und meldet sie an Oberfläche und Sync (`STATE.commitCoreEvents`).

use impala_model::search::NoteSearch;
use impala_model::{Model, touched};
use impala_tools::{Context, Host};
use js_sys::{Array, Function};
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

use crate::model::ModelCore;

/// Zustand des Tabs; `stamp()` liefert `[id, now]` (UUID und hybride Uhr der PWA).
struct PwaHost<'a> {
    m: &'a mut Model,
    search: &'a mut NoteSearch,
    stamp: &'a Function,
    events: Vec<Value>,
}

impl PwaHost<'_> {
    fn stamp(&self) -> Result<(String, String), String> {
        let v = self.stamp.call0(&JsValue::NULL).map_err(|e| format!("{e:?}"))?;
        let pair = Array::from(&v);
        match (pair.get(0).as_string(), pair.get(1).as_string()) {
            (Some(id), Some(now)) => Ok((id, now)),
            _ => Err("stamp() muss [id, now] liefern".into()),
        }
    }
}

impl Host for PwaHost<'_> {
    fn model(&self) -> &Model {
        self.m
    }
    fn model_search(&mut self) -> (&Model, &mut NoteSearch) {
        (self.m, self.search)
    }
    fn dispatch(&mut self, kind: &str, payload: Value) -> Result<(), String> {
        let (id, now) = self.stamp()?;
        let ev = Model::local_event(kind, payload, &id, &now);
        let object = Value::Object(ev.to_object());
        let probe = ev.clone();
        self.m.apply_local(ev);
        let touched = serde_json::to_value(touched(&probe, self.m.state())).unwrap_or(Value::Null);
        self.events.push(json!({ "ev": object, "touched": touched }));
        Ok(())
    }
    fn new_id(&mut self) -> String {
        self.stamp().map(|(id, _)| id).unwrap_or_default()
    }
}

/// `{ activePage, workspace, nowMs, utcOffset, currentCard, chats }`
fn context_of(v: &Value) -> Context {
    let now_ms = v["nowMs"].as_f64().unwrap_or(0.0) as i64;
    let mut ctx = Context::at(now_ms, v["utcOffset"].as_i64().unwrap_or(0) as i32);
    ctx.active_page = v["activePage"].as_str().map(str::to_owned);
    ctx.workspace = v["workspace"].as_str().map(str::to_owned);
    ctx.current_card = v["currentCard"].clone();
    ctx.chats = v["chats"].as_array().cloned();
    ctx
}

#[wasm_bindgen]
impl ModelCore {
    /// Werkzeug ausführen (`inspect`, `change` oder flach wie `read_pages`): JSON
    /// `{ result, undo, events: [{ ev, touched }] }`; `result: null` = kein Kern-Werkzeug.
    #[wasm_bindgen(js_name = aiTool)]
    pub fn ai_tool(&mut self, name: &str, args: &str, ctx: &str, stamp: &Function) -> String {
        let args: Value = serde_json::from_str(args).unwrap_or_else(|_| json!({}));
        let ctx = context_of(&serde_json::from_str(ctx).unwrap_or(Value::Null));
        let mut host = PwaHost { m: &mut self.m, search: &mut self.search, stamp, events: vec![] };
        let out = impala_tools::run_flat(&mut host, &ctx, name, &args)
            .or_else(|| impala_tools::run(&mut host, &ctx, name, &args));
        let (result, undo) = out.unwrap_or((Value::Null, None));
        json!({ "result": result, "undo": undo, "events": host.events }).to_string()
    }

    /// Änderungs-Satz einer KI-Aktion zurückspielen: `{ error?, events }`.
    #[wasm_bindgen(js_name = aiUndo)]
    pub fn ai_undo(&mut self, set: &str, stamp: &Function) -> String {
        let set: Value = serde_json::from_str(set).unwrap_or(Value::Null);
        let mut host = PwaHost { m: &mut self.m, search: &mut self.search, stamp, events: vec![] };
        let error = impala_tools::undo(&mut host, &set).err();
        json!({ "error": error, "events": host.events }).to_string()
    }
}
