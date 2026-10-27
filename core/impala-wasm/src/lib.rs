//! WASM-Hülle des Kerns für die PWA. Gebaut mit `npm run build:core` nach `core/target/wasm/` nach `web/core/`.

mod ai;
mod drive;
mod heft;
mod ink;
mod js;
mod markdown;
mod search;
mod srs;
mod sync;

use impala_sync::{Field, JsLike, Kind};
use js_sys::{Array, Object};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    /// `Reflect.get` ohne try/catch-Hülle: `decode` liest Felder nur von Objekten und Arrays.
    #[wasm_bindgen(js_namespace = Reflect, js_name = get)]
    fn reflect_get(target: &JsValue, key: &JsValue) -> JsValue;
}

/// Kompaktiert das Event-Log und liefert die Indizes der behaltenen Events in Log-Reihenfolge.
/// Die Events bleiben in JS; der Kern fragt nur die Felder ab, die die Regeln lesen.
/// Wirft, wenn ein Event eine Form hat, die nur die JS-Implementierung abdeckt.
#[wasm_bindgen(js_name = compactOrder)]
pub fn compact_order(events: Array) -> Result<Vec<u32>, JsError> {
    let events = events
        .iter()
        .map(|ev| impala_sync::decode(&Js(ev)))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| JsError::new(&e.0))?;
    Ok(impala_sync::compact(&events).into_iter().map(|i| i as u32).collect())
}

struct Js(JsValue);

thread_local! {
    /// Feldnamen einmal als JS-Strings, statt sie bei jedem Zugriff neu zu übergeben.
    static KEYS: Vec<JsValue> = Field::ALL.iter().map(|f| JsValue::from_str(f.name())).collect();
}

impl JsLike for Js {
    fn kind(&self) -> Kind {
        let v = &self.0;
        if v.is_object() {
            if Array::is_array(v) { Kind::Array } else { Kind::Object }
        } else if v.is_string() {
            Kind::Str
        } else if v.is_undefined() || v.is_null() {
            Kind::Nullish
        } else if v.is_falsy() {
            Kind::Falsy
        } else {
            Kind::Other
        }
    }

    fn get(&self, field: Field) -> Self {
        Js(KEYS.with(|keys| reflect_get(&self.0, &keys[field as usize])))
    }

    fn as_str(&self) -> Option<String> {
        self.0.as_string()
    }

    fn as_f64(&self) -> Option<f64> {
        self.0.as_f64()
    }

    fn keys(&self) -> Vec<String> {
        Object::keys(self.0.unchecked_ref::<Object>()).iter().filter_map(|k| k.as_string()).collect()
    }

    fn items(&self) -> Vec<Self> {
        self.0.unchecked_ref::<Array>().iter().map(Js).collect()
    }
}
