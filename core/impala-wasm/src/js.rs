//! Gemeinsame Brücke zu JS für Sync und Drive: Werte umwandeln, Methoden der Plattform-Objekte
//! aufrufen (Promises werden abgewartet) und `http.send` als [`HttpClient`].

use impala_net::{HttpClient, NetError, Request, Response};
use js_sys::{Array, Function, JSON, Object, Promise, Reflect, Uint8Array};
use serde_json::Value;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

pub(crate) fn to_js(v: &Value) -> JsValue {
    JSON::parse(&v.to_string()).unwrap_or(JsValue::NULL)
}

pub(crate) fn from_js(v: &JsValue) -> Result<Value, String> {
    if v.is_undefined() {
        return Ok(Value::Null);
    }
    let text = JSON::stringify(v).map_err(|e| js_message(&e))?;
    serde_json::from_str(&String::from(text)).map_err(|e| e.to_string())
}

pub(crate) fn js_message(e: &JsValue) -> String {
    e.dyn_ref::<js_sys::Error>()
        .map(|e| String::from(e.message()))
        .or_else(|| e.as_string())
        .unwrap_or_else(|| JSON::stringify(e).map(String::from).unwrap_or_else(|_| "Unbekannter Fehler".into()))
}

pub(crate) fn get(obj: &JsValue, key: &str) -> JsValue {
    Reflect::get(obj, &JsValue::from_str(key)).unwrap_or(JsValue::UNDEFINED)
}

pub(crate) fn set(obj: &Object, key: &str, value: impl Into<JsValue>) {
    let _ = Reflect::set(obj, &JsValue::from_str(key), &value.into());
}

/// Ruft `obj[name](...args)` auf; ein Promise wird abgewartet.
pub(crate) async fn call(obj: &JsValue, name: &str, args: &[JsValue]) -> Result<JsValue, String> {
    let ret = call_sync(obj, name, args)?;
    if ret.has_type::<Promise>() {
        JsFuture::from(Promise::from(ret)).await.map_err(|e| js_message(&e))
    } else {
        Ok(ret)
    }
}

pub(crate) fn call_sync(obj: &JsValue, name: &str, args: &[JsValue]) -> Result<JsValue, String> {
    let f: Function = get(obj, name).dyn_into().map_err(|_| format!("{name} fehlt"))?;
    f.apply(obj, &args.iter().collect::<Array>()).map_err(|e| js_message(&e))
}

pub(crate) fn bytes(v: &JsValue) -> Vec<u8> {
    if v.is_instance_of::<Uint8Array>() || v.is_instance_of::<js_sys::ArrayBuffer>() {
        Uint8Array::new(v).to_vec()
    } else {
        Vec::new()
    }
}

/// Zahl aus JS als Wasserstand (`Number(x) || 0`).
pub(crate) fn seq(v: &JsValue) -> u64 {
    v.as_f64().filter(|n| n.is_finite() && *n > 0.0).map_or(0, |n| n as u64)
}

/// Netz: `http.send({ method, url, headers, body })` → `{ status, headers, body }`.
pub struct JsHttp(pub(crate) JsValue);

impl HttpClient for JsHttp {
    async fn send(&self, req: &Request) -> Result<Response, NetError> {
        let r = Object::new();
        set(&r, "method", req.method.as_str());
        set(&r, "url", req.url.as_str());
        let headers: Array = req.headers.iter().map(|(k, v)| Array::of2(&k.into(), &v.into())).collect();
        set(&r, "headers", headers);
        if !req.body.is_empty() {
            set(&r, "body", Uint8Array::from(req.body.as_slice()));
        }
        let res = call(&self.0, "send", &[r.into()]).await.map_err(|m| {
            if m.contains("Zeitüberschreitung") || m.to_lowercase().contains("timeout") {
                NetError::Timeout
            } else if m.to_lowercase().contains("abort") {
                NetError::Aborted
            } else {
                NetError::Connect(m)
            }
        })?;
        let status = get(&res, "status").as_f64().unwrap_or(0.0) as u16;
        let headers = Array::from(&get(&res, "headers"))
            .iter()
            .filter_map(|pair| {
                let pair = Array::from(&pair);
                Some((pair.get(0).as_string()?, pair.get(1).as_string()?))
            })
            .collect();
        Ok(Response { status, headers, body: bytes(&get(&res, "body")) })
    }
}
