//! Events einer Drive-Datei portionsweise lesen, ohne die ganze Datei als JSON-Baum zu halten.
//! Ein großer Snapshot (≈100 MB gzip, ≈500 MB JSON) brauchte als `serde_json::Value` mehrere
//! GB und sprengte auf Android den Speicher. Hier liegen nur die gepackten Bytes und eine Portion
//! Events im Speicher; entpackt wird nebenher.
//!
//! Erwartet das `exportAll`-Format `{…, "events": [{…}, …], "blobs": {…}}`. Andere Schlüssel
//! werden überlesen, `blobs` (nur v1-Snapshots) kommt mit der letzten Portion.

use std::io::{BufRead, BufReader, Read};

use flate2::read::GzDecoder;
use serde::Deserialize;
use serde::de::IgnoredAny;
use serde_json::{Map, Value};

use crate::DriveError;
use crate::format::Encoding;

/// Ungefähre JSON-Menge je Portion (als `Value` etwa das Fünffache).
pub const BATCH_BYTES: u64 = 24 << 20;

pub struct Batch {
    pub events: Vec<Value>,
    /// Gelesene Bytes JSON.
    pub bytes: u64,
    /// Nur in der letzten Portion gefüllt.
    pub blobs: Map<String, Value>,
    pub last: bool,
}

/// Zählt die entpackten Bytes (für die Portionsgröße).
struct Counting<R> {
    inner: R,
    n: u64,
}

impl<R: Read> Read for Counting<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.n += n as u64;
        Ok(n)
    }
}

enum Pos {
    Start,
    /// Im Objekt der obersten Ebene, vor dem nächsten Schlüssel.
    Keys,
    /// Im `events`-Array.
    Events,
    Done,
}

pub struct EventReader<'a> {
    r: BufReader<Counting<Box<dyn Read + 'a>>>,
    pos: Pos,
    blobs: Map<String, Value>,
}

fn bad(e: impl std::fmt::Display) -> DriveError {
    DriveError::BadResponse(format!("Datei ist kein gültiges JSON: {e}"))
}

impl<'a> EventReader<'a> {
    pub fn new(bytes: &'a [u8], encoding: Encoding) -> Self {
        let inner: Box<dyn Read + 'a> = match encoding {
            Encoding::Gzip => Box::new(GzDecoder::new(bytes)),
            Encoding::Identity => Box::new(bytes),
        };
        EventReader { r: BufReader::new(Counting { inner, n: 0 }), pos: Pos::Start, blobs: Map::new() }
    }

    /// Nächste Portion (höchstens ≈`limit` Bytes JSON, mindestens ein Event).
    pub fn next_batch(&mut self, limit: u64) -> Result<Batch, DriveError> {
        let start = self.offset();
        let mut events = Vec::new();
        loop {
            match self.pos {
                Pos::Start => {
                    self.expect(b'{')?;
                    self.pos = Pos::Keys;
                }
                Pos::Keys => match self.peek()? {
                    Some(b'}') => self.pos = Pos::Done,
                    Some(b',') => self.r.consume(1),
                    Some(_) => {
                        let key: String = self.value()?;
                        self.expect(b':')?;
                        match key.as_str() {
                            "events" if self.peek()? == Some(b'[') => {
                                self.r.consume(1);
                                self.pos = Pos::Events;
                            }
                            "blobs" => {
                                if let Value::Object(b) = self.value()? {
                                    self.blobs = b;
                                }
                            }
                            _ => self.skip_value()?,
                        }
                    }
                    None => return Err(bad("unerwartetes Ende")),
                },
                Pos::Events => match self.peek()? {
                    Some(b']') => {
                        self.r.consume(1);
                        self.pos = Pos::Keys;
                    }
                    Some(b',') => self.r.consume(1),
                    Some(_) => {
                        events.push(self.value()?);
                        if self.offset() - start >= limit {
                            return Ok(Batch { events, bytes: self.offset() - start, blobs: Map::new(), last: false });
                        }
                    }
                    None => return Err(bad("unerwartetes Ende")),
                },
                Pos::Done => {
                    let bytes = self.offset() - start;
                    return Ok(Batch { events, bytes, blobs: std::mem::take(&mut self.blobs), last: true });
                }
            }
        }
    }

    /// Bisher gelesene Bytes JSON (ohne den Puffer-Vorrat).
    fn offset(&self) -> u64 {
        self.r.get_ref().n - self.r.buffer().len() as u64
    }

    /// Nächstes Zeichen nach Leerraum, ohne es zu verbrauchen.
    fn peek(&mut self) -> Result<Option<u8>, DriveError> {
        loop {
            let buf = self.r.fill_buf().map_err(bad)?;
            match buf.first() {
                None => return Ok(None),
                Some(b' ' | b'\n' | b'\r' | b'\t') => self.r.consume(1),
                Some(&c) => return Ok(Some(c)),
            }
        }
    }

    fn expect(&mut self, c: u8) -> Result<(), DriveError> {
        match self.peek()? {
            Some(x) if x == c => {
                self.r.consume(1);
                Ok(())
            }
            _ => Err(bad(format!("„{}“ erwartet", c as char))),
        }
    }

    /// Ein Objekt, Array oder String: serde_json liest dabei kein Zeichen über das Ende hinaus.
    fn value<T: for<'de> Deserialize<'de>>(&mut self) -> Result<T, DriveError> {
        T::deserialize(&mut serde_json::Deserializer::from_reader(&mut self.r)).map_err(bad)
    }

    /// Zahlen und `true`/`false`/`null` von Hand: serde_json läse dort ein Zeichen zu weit.
    fn skip_value(&mut self) -> Result<(), DriveError> {
        match self.peek()? {
            Some(b'{' | b'[' | b'"') => self.value::<IgnoredAny>().map(drop),
            Some(_) => loop {
                match self.r.fill_buf().map_err(bad)?.first() {
                    Some(b',' | b'}' | b' ' | b'\n' | b'\r' | b'\t') | None => return Ok(()),
                    Some(_) => self.r.consume(1),
                }
            },
            None => Err(bad("unerwartetes Ende")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn all(text: &str, limit: u64) -> (Vec<Vec<Value>>, Map<String, Value>) {
        let gz = impala_crypto::gzip(text.as_bytes());
        let mut r = EventReader::new(&gz, Encoding::Gzip);
        let mut batches = Vec::new();
        loop {
            let b = r.next_batch(limit).unwrap();
            batches.push(b.events);
            if b.last {
                return (batches, b.blobs);
            }
        }
    }

    #[test]
    fn reads_events_in_batches() {
        let doc = json!({ "app": "impala67", "version": 2, "ok": true, "events": [{ "id": 1 }, { "id": 2 }, { "id": 3 }], "blobs": { "b": { "x": [1, 2] } }, "n": null });
        let (batches, blobs) = all(&serde_json::to_string_pretty(&doc).unwrap(), 1);
        let ids: Vec<Vec<i64>> =
            batches.iter().map(|b| b.iter().map(|e| e["id"].as_i64().unwrap()).collect()).collect();
        assert_eq!(ids, [vec![1], vec![2], vec![3], vec![]]);
        assert_eq!(Value::Object(blobs), json!({ "b": { "x": [1, 2] } }));
        let (batches, _) = all(&doc.to_string(), BATCH_BYTES);
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].len(), 3);
    }

    #[test]
    fn tolerates_missing_events_and_rejects_garbage() {
        assert!(all(r#"{"version":2,"events":null}"#, 1).0.iter().all(Vec::is_empty));
        let mut r = EventReader::new(b"{\"events\":[{\"id\":1}", Encoding::Identity);
        assert!(r.next_batch(BATCH_BYTES).is_err());
    }
}
