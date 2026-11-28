//! Datensätze mit festen, typisierten Feldern und erhaltenen Zusatzfeldern.
//!
//! Die App hängt an Seiten, Karten … beliebige weitere Felder an (`favorite`, `subject`, `props` …)
//! und überschreibt per `Object.assign` auch bekannte. Darum: Felder, die der Kern auswertet,
//! sind typisiert (`Some` = vorhanden mit passendem Typ); alles andere – auch `null` und bekannte
//! Felder mit fremdem Typ – liegt unverändert in `extra`. So bleibt jeder Datensatz exakt erhalten.

use std::borrow::Cow;
use std::fmt;
use std::marker::PhantomData;

use serde::de::{Deserialize, DeserializeSeed, Deserializer, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde_json::Value;

use crate::js::{self, Object};

/// Geliehener JSON-Schlüssel: bei normalen ASCII-Feldnamen ohne Escape keine Heap-Allokation.
pub(crate) struct BorrowKey<'de>(pub Cow<'de, str>);

impl<'de> Deserialize<'de> for BorrowKey<'de> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = BorrowKey<'de>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("JSON-Schlüssel")
            }
            fn visit_borrowed_str<E: serde::de::Error>(self, v: &'de str) -> Result<Self::Value, E> {
                Ok(BorrowKey(Cow::Borrowed(v)))
            }
            fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
                Ok(BorrowKey(Cow::Owned(v.to_owned())))
            }
            fn visit_string<E: serde::de::Error>(self, v: String) -> Result<Self::Value, E> {
                Ok(BorrowKey(Cow::Owned(v)))
            }
        }
        d.deserialize_str(V)
    }
}

/// Fehlertolerantes direktes Deserialisieren: ungültige Einträge (z. B. `null` statt Objekt)
/// werden übersprungen (`None`), ohne gültige Einträge erst als `serde_json::Value` anzulegen.
pub(crate) trait TryDeserialize<'de>: Sized {
    fn try_deserialize<D: Deserializer<'de>>(d: D) -> Result<Option<Self>, D::Error>;
}

impl<'de> TryDeserialize<'de> for bool {
    fn try_deserialize<D: Deserializer<'de>>(d: D) -> Result<Option<Self>, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Option<bool>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("bool")
            }
            fn visit_bool<E: serde::de::Error>(self, v: bool) -> Result<Self::Value, E> {
                Ok(Some(v))
            }
            fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
                Ok(None)
            }
            fn visit_i64<E: serde::de::Error>(self, _: i64) -> Result<Self::Value, E> {
                Ok(None)
            }
            fn visit_u64<E: serde::de::Error>(self, _: u64) -> Result<Self::Value, E> {
                Ok(None)
            }
            fn visit_f64<E: serde::de::Error>(self, _: f64) -> Result<Self::Value, E> {
                Ok(None)
            }
            fn visit_str<E: serde::de::Error>(self, _: &str) -> Result<Self::Value, E> {
                Ok(None)
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut a: A) -> Result<Self::Value, A::Error> {
                while a.next_element::<IgnoredAny>()?.is_some() {}
                Ok(None)
            }
            fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<Self::Value, A::Error> {
                while a.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
                Ok(None)
            }
        }
        d.deserialize_any(V)
    }
}

/// Wrapper, um [`Field::from_de`] direkt über `MapAccess::next_value_seed` aufzurufen.
pub(crate) struct FieldSeed<T>(pub PhantomData<T>);

impl<'de, T: Field> DeserializeSeed<'de> for FieldSeed<T> {
    type Value = Result<T, Value>;
    fn deserialize<D: Deserializer<'de>>(self, d: D) -> Result<Self::Value, D::Error> {
        T::from_de(d)
    }
}

fn seq_to_value<'de, A: SeqAccess<'de>>(mut a: A) -> Result<Value, A::Error> {
    let mut out = Vec::new();
    while let Some(v) = a.next_element::<Value>()? {
        out.push(v);
    }
    Ok(Value::Array(out))
}

fn map_to_value<'de, A: MapAccess<'de>>(mut a: A) -> Result<Value, A::Error> {
    let mut out = Object::new();
    while let Some((k, v)) = a.next_entry::<String, Value>()? {
        out.insert(k, v);
    }
    Ok(Value::Object(out))
}

/// Typ eines festen Feldes.
pub trait Field: Sized {
    /// `Err(v)`: passt nicht, `v` geht unverändert nach `extra`.
    fn from_json(v: Value) -> Result<Self, Value>;
    /// Direkt aus dem JSON-Strom ohne `Value`-Umweg im Regelfall.
    fn from_de<'de, D: Deserializer<'de>>(d: D) -> Result<Result<Self, Value>, D::Error> {
        Ok(Self::from_json(Value::deserialize(d)?))
    }
    fn to_json(&self) -> Value;
    /// Gleichheit mit einem JSON-Wert (`===` für Strings, Zahlen, Booleans).
    fn same(&self, v: &Value) -> bool;
    /// Schreibt das Feld ohne Kopie.
    fn write<M: serde::ser::SerializeMap>(&self, m: &mut M, key: &str) -> Result<(), M::Error>;
    /// Der Text eines Textfeldes (ohne Kopie).
    fn as_text(&self) -> Option<&str> {
        None
    }
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
    fn from_de<'de, D: Deserializer<'de>>(d: D) -> Result<Result<Self, Value>, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Result<String, Value>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("String oder JSON-Wert")
            }
            fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
                Ok(Ok(v.to_owned()))
            }
            fn visit_string<E: serde::de::Error>(self, v: String) -> Result<Self::Value, E> {
                Ok(Ok(v))
            }
            fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
                Ok(Err(Value::Null))
            }
            fn visit_bool<E: serde::de::Error>(self, v: bool) -> Result<Self::Value, E> {
                Ok(Err(Value::Bool(v)))
            }
            fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<Self::Value, E> {
                Ok(Err(Value::from(v)))
            }
            fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<Self::Value, E> {
                Ok(Err(Value::from(v)))
            }
            fn visit_f64<E: serde::de::Error>(self, v: f64) -> Result<Self::Value, E> {
                Ok(Err(js::num(v)))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, a: A) -> Result<Self::Value, A::Error> {
                seq_to_value(a).map(Err)
            }
            fn visit_map<A: MapAccess<'de>>(self, a: A) -> Result<Self::Value, A::Error> {
                map_to_value(a).map(Err)
            }
        }
        d.deserialize_any(V)
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
    fn as_text(&self) -> Option<&str> {
        Some(self)
    }
}

impl Field for f64 {
    fn from_json(v: Value) -> Result<Self, Value> {
        match v.as_f64() {
            Some(n) => Ok(n),
            None => Err(v),
        }
    }
    fn from_de<'de, D: Deserializer<'de>>(d: D) -> Result<Result<Self, Value>, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Result<f64, Value>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("Zahl oder JSON-Wert")
            }
            fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<Self::Value, E> {
                Ok(Ok(v as f64))
            }
            fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<Self::Value, E> {
                Ok(Ok(v as f64))
            }
            fn visit_f64<E: serde::de::Error>(self, v: f64) -> Result<Self::Value, E> {
                Ok(Ok(v))
            }
            fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
                Ok(Err(Value::Null))
            }
            fn visit_bool<E: serde::de::Error>(self, v: bool) -> Result<Self::Value, E> {
                Ok(Err(Value::Bool(v)))
            }
            fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
                Ok(Err(Value::String(v.to_owned())))
            }
            fn visit_string<E: serde::de::Error>(self, v: String) -> Result<Self::Value, E> {
                Ok(Err(Value::String(v)))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, a: A) -> Result<Self::Value, A::Error> {
                seq_to_value(a).map(Err)
            }
            fn visit_map<A: MapAccess<'de>>(self, a: A) -> Result<Self::Value, A::Error> {
                map_to_value(a).map(Err)
            }
        }
        d.deserialize_any(V)
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
    fn from_de<'de, D: Deserializer<'de>>(d: D) -> Result<Result<Self, Value>, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Result<bool, Value>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("Bool oder JSON-Wert")
            }
            fn visit_bool<E: serde::de::Error>(self, v: bool) -> Result<Self::Value, E> {
                Ok(Ok(v))
            }
            fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
                Ok(Err(Value::Null))
            }
            fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<Self::Value, E> {
                Ok(Err(Value::from(v)))
            }
            fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<Self::Value, E> {
                Ok(Err(Value::from(v)))
            }
            fn visit_f64<E: serde::de::Error>(self, v: f64) -> Result<Self::Value, E> {
                Ok(Err(js::num(v)))
            }
            fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
                Ok(Err(Value::String(v.to_owned())))
            }
            fn visit_string<E: serde::de::Error>(self, v: String) -> Result<Self::Value, E> {
                Ok(Err(Value::String(v)))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, a: A) -> Result<Self::Value, A::Error> {
                seq_to_value(a).map(Err)
            }
            fn visit_map<A: MapAccess<'de>>(self, a: A) -> Result<Self::Value, A::Error> {
                map_to_value(a).map(Err)
            }
        }
        d.deserialize_any(V)
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

            /// Alle nicht leeren Textfelder der obersten Ebene, ohne Kopie
            /// (`Object.values(obj)`, nur Strings).
            pub fn for_each_text(&self, mut f: impl FnMut(&str)) {
                $(if let Some(t) = self.$field.as_ref().and_then($crate::record::Field::as_text).filter(|t| !t.is_empty()) {
                    f(t);
                })*
                for t in self.extra.values().filter_map(serde_json::Value::as_str).filter(|t| !t.is_empty()) {
                    f(t);
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

        impl $name {
            fn from_map<'de, A: serde::de::MapAccess<'de>>(mut a: A) -> Result<Self, A::Error> {
                let mut r = Self::default();
                while let Some($crate::record::BorrowKey(k)) = a.next_key::<$crate::record::BorrowKey<'de>>()? {
                    match k.as_ref() {
                        $($key => match a.next_value_seed($crate::record::FieldSeed::<$ty>(std::marker::PhantomData))? {
                            Ok(v) => {
                                r.$field = Some(v);
                                if !r.extra.is_empty() {
                                    r.extra.shift_remove($key);
                                }
                            }
                            Err(v) => {
                                r.$field = None;
                                r.extra.insert(k.into_owned(), v);
                            }
                        },)*
                        _ => {
                            r.extra.insert(k.into_owned(), a.next_value()?);
                        }
                    }
                }
                Ok(r)
            }
        }

        impl<'de> serde::Deserialize<'de> for $name {
            fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
                struct V;
                impl<'de> serde::de::Visitor<'de> for V {
                    type Value = $name;
                    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                        f.write_str(concat!(stringify!($name), ": kein Objekt"))
                    }
                    fn visit_map<A: serde::de::MapAccess<'de>>(self, a: A) -> Result<Self::Value, A::Error> {
                        $name::from_map(a)
                    }
                }
                d.deserialize_map(V)
            }
        }

        impl<'de> $crate::record::TryDeserialize<'de> for $name {
            fn try_deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Option<Self>, D::Error> {
                struct V;
                impl<'de> serde::de::Visitor<'de> for V {
                    type Value = Option<$name>;
                    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                        f.write_str(concat!(stringify!($name), " oder fremder Wert"))
                    }
                    fn visit_map<A: serde::de::MapAccess<'de>>(self, a: A) -> Result<Self::Value, A::Error> {
                        $name::from_map(a).map(Some)
                    }
                    fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
                        Ok(None)
                    }
                    fn visit_bool<E: serde::de::Error>(self, _: bool) -> Result<Self::Value, E> {
                        Ok(None)
                    }
                    fn visit_i64<E: serde::de::Error>(self, _: i64) -> Result<Self::Value, E> {
                        Ok(None)
                    }
                    fn visit_u64<E: serde::de::Error>(self, _: u64) -> Result<Self::Value, E> {
                        Ok(None)
                    }
                    fn visit_f64<E: serde::de::Error>(self, _: f64) -> Result<Self::Value, E> {
                        Ok(None)
                    }
                    fn visit_str<E: serde::de::Error>(self, _: &str) -> Result<Self::Value, E> {
                        Ok(None)
                    }
                    fn visit_seq<A: serde::de::SeqAccess<'de>>(self, mut a: A) -> Result<Self::Value, A::Error> {
                        while a.next_element::<serde::de::IgnoredAny>()?.is_some() {}
                        Ok(None)
                    }
                }
                d.deserialize_any(V)
            }
        }
    };
}

pub(crate) use record;

/// Objekt-Spread `{ ...obj }` eines JSON-Werts (kein Objekt: leer).
pub fn spread(v: Option<&Value>) -> Object {
    v.and_then(Value::as_object).cloned().unwrap_or_default()
}
