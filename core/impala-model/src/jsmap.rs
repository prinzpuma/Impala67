//! Schlüssel→Wert-Tabelle mit der Reihenfolge eines JS-Objekts: erst Array-Index-Schlüssel
//! (`"0"`, `"17"` …) aufsteigend, dann alle anderen in Einfügereihenfolge. Überschreiben behält
//! den Platz, Löschen und Neuanlegen rückt ans Ende. Davon hängen ab: welche Seite ein Titel
//! zuerst trifft, die Reihenfolge der Lernwarteschlange bei gleicher Fälligkeit, Stapel-Umbenennungen.

use std::fmt;

use indexmap::IndexMap;
use serde::de::{Deserialize, Deserializer, MapAccess, Visitor};
use serde::ser::{Serialize, SerializeMap, Serializer};

/// Array-Index im Sinne von ECMAScript: kanonische Ganzzahl unter 2³² − 1.
fn array_index(key: &str) -> Option<u32> {
    let b = key.as_bytes();
    if b.is_empty() || b.len() > 10 || (b.len() > 1 && b[0] == b'0') || !b.iter().all(u8::is_ascii_digit) {
        return None;
    }
    key.parse::<u64>().ok().filter(|n| *n < u64::from(u32::MAX)).map(|n| n as u32)
}

#[derive(Clone, PartialEq)]
pub struct JsMap<V> {
    map: IndexMap<String, V>,
    /// So viele Index-Schlüssel stehen (sortiert) am Anfang von `map`.
    ints: usize,
}

impl<V> Default for JsMap<V> {
    fn default() -> Self {
        JsMap { map: IndexMap::new(), ints: 0 }
    }
}

impl<V: fmt::Debug> fmt::Debug for JsMap<V> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_map().entries(self.map.iter()).finish()
    }
}

impl<V> JsMap<V> {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }

    pub fn get(&self, key: &str) -> Option<&V> {
        self.map.get(key)
    }

    pub fn get_mut(&mut self, key: &str) -> Option<&mut V> {
        self.map.get_mut(key)
    }

    pub fn contains_key(&self, key: &str) -> bool {
        self.map.contains_key(key)
    }

    /// `obj[key] = value`.
    pub fn insert(&mut self, key: String, value: V) {
        if let Some(slot) = self.map.get_mut(&key) {
            *slot = value;
            return;
        }
        match array_index(&key) {
            Some(n) => {
                let at = self.map.keys().take(self.ints).position(|k| array_index(k).is_some_and(|m| m > n));
                self.map.shift_insert(at.unwrap_or(self.ints), key, value);
                self.ints += 1;
            }
            None => {
                self.map.insert(key, value);
            }
        }
    }

    /// `delete obj[key]`.
    pub fn remove(&mut self, key: &str) -> Option<V> {
        let v = self.map.shift_remove(key)?;
        if array_index(key).is_some() {
            self.ints -= 1;
        }
        Some(v)
    }

    /// Eintrag holen oder anlegen (`obj[key] ||= f()`).
    pub fn get_or_insert_with(&mut self, key: &str, f: impl FnOnce() -> V) -> &mut V {
        if !self.map.contains_key(key) {
            self.insert(key.to_owned(), f());
        }
        // Gerade eingefügt oder schon vorhanden.
        match self.map.get_mut(key) {
            Some(v) => v,
            None => unreachable!("Schlüssel wurde eben eingefügt"),
        }
    }

    pub fn iter(&self) -> impl DoubleEndedIterator<Item = (&String, &V)> + ExactSizeIterator {
        self.map.iter()
    }

    pub fn iter_mut(&mut self) -> impl Iterator<Item = (&String, &mut V)> {
        self.map.iter_mut()
    }

    pub fn keys(&self) -> impl Iterator<Item = &String> {
        self.map.keys()
    }

    pub fn values(&self) -> impl DoubleEndedIterator<Item = &V> + ExactSizeIterator {
        self.map.values()
    }

    pub fn values_mut(&mut self) -> impl Iterator<Item = &mut V> {
        self.map.values_mut()
    }

    pub fn retain(&mut self, mut keep: impl FnMut(&String, &mut V) -> bool) {
        self.map.retain(|k, v| keep(k, v));
        self.ints = self.map.keys().take_while(|k| array_index(k).is_some()).count();
    }
}

impl<V> FromIterator<(String, V)> for JsMap<V> {
    fn from_iter<I: IntoIterator<Item = (String, V)>>(iter: I) -> Self {
        let mut m = JsMap::new();
        for (k, v) in iter {
            m.insert(k, v);
        }
        m
    }
}

impl<V: Serialize> Serialize for JsMap<V> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut m = s.serialize_map(Some(self.map.len()))?;
        for (k, v) in &self.map {
            m.serialize_entry(k, v)?;
        }
        m.end()
    }
}

/// Liest ein JSON-Objekt; Einträge, die sich nicht als `V` lesen lassen, fallen weg
/// (z. B. `null` statt einer Seite – das JS stürzte an solchen Einträgen ab).
impl<'de, V: Deserialize<'de>> Deserialize<'de> for JsMap<V> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V2<V>(std::marker::PhantomData<V>);
        impl<'de, V: Deserialize<'de>> Visitor<'de> for V2<V> {
            type Value = JsMap<V>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("ein Objekt")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<Self::Value, A::Error> {
                let mut m = JsMap::new();
                while let Some(k) = a.next_key::<String>()? {
                    let v: serde_json::Value = a.next_value()?;
                    if let Ok(v) = V::deserialize(v) {
                        m.insert(k, v);
                    }
                }
                Ok(m)
            }
            // Kein Objekt (Altdaten, `null`): leer.
            fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
                Ok(JsMap::new())
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(self, mut a: A) -> Result<Self::Value, A::Error> {
                while a.next_element::<serde::de::IgnoredAny>()?.is_some() {}
                Ok(JsMap::new())
            }
            fn visit_bool<E: serde::de::Error>(self, _: bool) -> Result<Self::Value, E> {
                Ok(JsMap::new())
            }
            fn visit_str<E: serde::de::Error>(self, _: &str) -> Result<Self::Value, E> {
                Ok(JsMap::new())
            }
            fn visit_i64<E: serde::de::Error>(self, _: i64) -> Result<Self::Value, E> {
                Ok(JsMap::new())
            }
            fn visit_u64<E: serde::de::Error>(self, _: u64) -> Result<Self::Value, E> {
                Ok(JsMap::new())
            }
            fn visit_f64<E: serde::de::Error>(self, _: f64) -> Result<Self::Value, E> {
                Ok(JsMap::new())
            }
        }
        d.deserialize_any(V2(std::marker::PhantomData))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reihenfolge_wie_js_objekt() {
        let mut m = JsMap::new();
        for k in ["b", "10", "a", "2", "02", "4294967295", "4294967294"] {
            m.insert(k.to_owned(), ());
        }
        let keys: Vec<&str> = m.keys().map(String::as_str).collect();
        assert_eq!(keys, ["2", "10", "4294967294", "b", "a", "02", "4294967295"]);
        m.remove("b");
        m.insert("b".into(), ());
        m.insert("a".into(), ());
        m.remove("10");
        m.insert("1".into(), ());
        let keys: Vec<&str> = m.keys().map(String::as_str).collect();
        assert_eq!(keys, ["1", "2", "4294967294", "a", "02", "4294967295", "b"]);
    }
}
