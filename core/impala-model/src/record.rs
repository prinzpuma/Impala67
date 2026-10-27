//! Datensätze mit festen, typisierten Feldern und erhaltenen Zusatzfeldern.
//!
//! Die App hängt an Seiten, Karten … beliebige weitere Felder an (`favorite`, `subject`, `props` …)
//! und überschreibt per `Object.assign` auch bekannte. Darum: Felder, die der Kern auswertet,
//! sind typisiert (`Some` = vorhanden mit passendem Typ); alles andere – auch `null` und bekannte
//! Felder mit fremdem Typ – liegt unverändert in `extra`. So bleibt jeder Datensatz exakt erhalten.

use serde_json::Value;

use crate::js::{self, Object};

/// Typ eines festen Feldes.
pub trait Field: Sized {
    /// `Err(v)`: passt nicht, `v` geht unverändert nach `extra`.
    fn from_json(v: Value) -> Result<Self, Value>;
    fn to_json(&self) -> Value;
    /// Gleichheit mit einem JSON-Wert (`===` für Strings, Zahlen, Booleans).
    fn same(&self, v: &Value) -> bool;
    /// Schreibt das Feld ohne Kopie.
    fn write<M: serde::ser::SerializeMap>(&self, m: &mut M, key: &str) -> Result<(), M::Error>;
}

impl Field for Vec<Value> {
    fn from_json(v: Value) -> Result<Self, Value> {
        match v {
            Value::Array(a) => Ok(a),
            v => Err(v),
        }
    }
    fn to_json(&self) -> Value {
        Value::Array(self.clone())
    }
    fn same(&self, _: &Value) -> bool {
        false // Identität, nie gleich
    }
    fn write<M: serde::ser::SerializeMap>(&self, m: &mut M, key: &str) -> Result<(), M::Error> {
        m.serialize_entry(key, self)
    }
}

impl Field for Object {
    fn from_json(v: Value) -> Result<Self, Value> {
        match v {
            Value::Object(o) => Ok(o),
            v => Err(v),
        }
    }
    fn to_json(&self) -> Value {
        Value::Object(self.clone())
    }
    fn same(&self, _: &Value) -> bool {
        false
    }
    fn write<M: serde::ser::SerializeMap>(&self, m: &mut M, key: &str) -> Result<(), M::Error> {
        m.serialize_entry(key, self)
    }
}

impl Field for String {
    fn from_json(v: Value) -> Result<Self, Value> {
        match v {
            Value::String(s) => Ok(s),
            v => Err(v),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(self.clone())
    }
    fn same(&self, v: &Value) -> bool {
        v.as_str() == Some(self)
    }
    fn write<M: serde::ser::SerializeMap>(&self, m: &mut M, key: &str) -> Result<(), M::Error> {
        m.serialize_entry(key, self.as_str())
    }
}

impl Field for f64 {
    fn from_json(v: Value) -> Result<Self, Value> {
        match v.as_f64() {
            Some(n) => Ok(n),
            None => Err(v),
        }
    }
    fn to_json(&self) -> Value {
        js::num(*self)
    }
    fn same(&self, v: &Value) -> bool {
        v.as_f64() == Some(*self)
    }
    fn write<M: serde::ser::SerializeMap>(&self, m: &mut M, key: &str) -> Result<(), M::Error> {
        m.serialize_entry(key, &js::num(*self))
    }
}

impl Field for bool {
    fn from_json(v: Value) -> Result<Self, Value> {
        match v {
            Value::Bool(b) => Ok(b),
            v => Err(v),
        }
    }
    fn to_json(&self) -> Value {
        Value::Bool(*self)
    }
    fn same(&self, v: &Value) -> bool {
        v.as_bool() == Some(*self)
    }
    fn write<M: serde::ser::SerializeMap>(&self, m: &mut M, key: &str) -> Result<(), M::Error> {
        m.serialize_entry(key, self)
    }
}

/// Erzeugt einen Datensatz: `Feld: Typ = "jsonSchlüssel"`.
macro_rules! record {
    ($(#[$m:meta])* pub struct $name:ident { $($(#[$fm:meta])* $field:ident : $ty:ty = $key:literal),* $(,)? }) => {
        $(#[$m])*
        #[derive(Debug, Clone, Default, PartialEq)]
        pub struct $name {
            $($(#[$fm])* pub $field: Option<$ty>,)*
            /// Weitere Felder (auch `null` und bekannte Felder mit fremdem Typ), unverändert.
            pub extra: $crate::js::Object,
        }

        #[allow(dead_code)]
        impl $name {
            /// `obj[key] = value`.
            pub fn set(&mut self, key: &str, value: serde_json::Value) {
                match key {
                    $($key => match <$ty as $crate::record::Field>::from_json(value) {
                        Ok(v) => {
                            self.$field = Some(v);
                            if !self.extra.is_empty() {
                                self.extra.shift_remove(key);
                            }
                        }
                        Err(v) => {
                            self.$field = None;
                            self.extra.insert(key.to_owned(), v);
                        }
                    },)*
                    _ => {
                        self.extra.insert(key.to_owned(), value);
                    }
                }
            }

            /// `delete obj[key]`.
            pub fn remove(&mut self, key: &str) {
                match key {
                    $($key => self.$field = None,)*
                    _ => {}
                }
                self.extra.shift_remove(key);
            }

            /// `key in obj`.
            pub fn has(&self, key: &str) -> bool {
                match key {
                    $($key if self.$field.is_some() => true,)*
                    _ => self.extra.contains_key(key),
                }
            }

            /// Roher Wert eines Feldes (wie `obj[key]`).
            pub fn get(&self, key: &str) -> Option<serde_json::Value> {
                match key {
                    $($key if self.$field.is_some() => self.$field.as_ref().map($crate::record::Field::to_json),)*
                    _ => self.extra.get(key).cloned(),
                }
            }

            /// `obj[key] === v` (Objekte/Listen: Wertgleichheit statt Identität).
            pub fn field_is(&self, key: &str, v: &serde_json::Value) -> bool {
                match key {
                    $($key if self.$field.is_some() => self.$field.as_ref().is_some_and(|f| $crate::record::Field::same(f, v)),)*
                    _ => self.extra.get(key) == Some(v),
                }
            }

            /// Ist das Feld „wahr“ (`!!obj[key]`)?
            pub fn truthy(&self, key: &str) -> bool {
                match key {
                    $($key if self.$field.is_some() => self.$field.as_ref().is_some_and(|f| $crate::js::truthy(&$crate::record::Field::to_json(f))),)*
                    _ => self.extra.get(key).is_some_and($crate::js::truthy),
                }
            }

            /// `Object.assign(obj, patch)`.
            pub fn assign(&mut self, patch: &$crate::js::Object) {
                for (k, v) in patch {
                    self.set(k, v.clone());
                }
            }

            pub fn from_object(obj: $crate::js::Object) -> Self {
                let mut r = Self::default();
                for (k, v) in obj {
                    r.set(&k, v);
                }
                r
            }

            pub fn to_object(&self) -> $crate::js::Object {
                let mut o = $crate::js::Object::new();
                $(if let Some(v) = &self.$field {
                    o.insert($key.to_owned(), $crate::record::Field::to_json(v));
                })*
                for (k, v) in &self.extra {
                    o.insert(k.clone(), v.clone());
                }
                o
            }
        }

        impl serde::Serialize for $name {
            fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                use serde::ser::SerializeMap;
                let mut m = s.serialize_map(None)?;
                $(if let Some(v) = &self.$field {
                    $crate::record::Field::write(v, &mut m, $key)?;
                })*
                for (k, v) in &self.extra {
                    m.serialize_entry(k, v)?;
                }
                m.end()
            }
        }

        impl<'de> serde::Deserialize<'de> for $name {
            fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
                match serde_json::Value::deserialize(d)? {
                    serde_json::Value::Object(o) => Ok(Self::from_object(o)),
                    _ => Err(serde::de::Error::custom(concat!(stringify!($name), ": kein Objekt"))),
                }
            }
        }
    };
}

pub(crate) use record;

/// Objekt-Spread `{ ...obj }` eines JSON-Werts (kein Objekt: leer).
pub fn spread(v: Option<&Value>) -> Object {
    v.and_then(Value::as_object).cloned().unwrap_or_default()
}
