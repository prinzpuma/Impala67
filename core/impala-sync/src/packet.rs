//! Event-Pakete: Wire-Events → Chunks (UTF-8-Bytes und Anzahl) → Envelope-JSON → gzip → AES-GCM,
//! und zurück. Jedes Event wird genau einmal serialisiert: Der Text zählt für die Chunk-Grenze
//! und wird direkt zum Envelope zusammengesetzt (gleiche Bytes wie `JSON.stringify`).

use std::ops::Range;

use impala_crypto::json::{js_string, stringify};
use impala_crypto::{CipherKey, Random, decrypt_payload, encrypt_payload, sha256_hex};
use serde_json::Value;

use crate::SyncError;
use crate::wire::{envelope_json, prepare_incoming_cloud_events};

/// Ein Wire-Event samt seinem `JSON.stringify`-Text.
#[derive(Debug, Clone, PartialEq)]
pub struct WireEvent {
    pub value: Value,
    pub json: String,
}

impl WireEvent {
    pub fn new(value: Value) -> WireEvent {
        let json = stringify(&value);
        WireEvent { value, json }
    }
}

/// Grenzen je Paket (`chunkCloudEvents`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChunkLimits {
    pub max_events: usize,
    /// Summe aus UTF-8-Länge je Event-JSON plus 1 (Komma).
    pub max_json_bytes: usize,
}

impl Default for ChunkLimits {
    fn default() -> Self {
        ChunkLimits { max_events: 250, max_json_bytes: 1_000_000 }
    }
}

/// Teilt Events in Pakete; ein einzelnes zu großes Event bildet ein eigenes Paket.
pub fn chunk_cloud_events(events: &[WireEvent], limits: ChunkLimits) -> Vec<Range<usize>> {
    let (max_events, max_bytes) = (limits.max_events.max(1), limits.max_json_bytes.max(1));
    let mut out = Vec::new();
    let (mut start, mut bytes) = (0, 0);
    for (i, ev) in events.iter().enumerate() {
        let n = ev.json.len() + 1;
        if i > start && (i - start >= max_events || bytes + n > max_bytes) {
            out.push(start..i);
            (start, bytes) = (i, 0);
        }
        bytes += n;
    }
    if start < events.len() {
        out.push(start..events.len());
    }
    out
}

/// Paket-ID: `p-` + SHA-256 der Event-IDs (eine je Zeile). Gleiche Events → gleiche ID, der
/// Server verwirft Doppelte.
pub fn packet_id(events: &[WireEvent]) -> String {
    let ids: Vec<String> = events.iter().map(|ev| js_string(ev.value.get("id"))).collect();
    format!("p-{}", sha256_hex(&ids.join("\n")))
}

/// Verschlüsseltes Paket für `POST /api/events`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutgoingPacket {
    pub id: String,
    pub iv: String,
    pub data: String,
    pub size: u64,
}

impl OutgoingPacket {
    /// `JSON.stringify({ id, ...encrypted })`.
    pub fn to_json(&self) -> String {
        let mut out = String::with_capacity(self.data.len() + self.id.len() + 64);
        out.push_str("{\"id\":");
        impala_crypto::json::write_string(&mut out, &self.id);
        out.push_str(",\"iv\":");
        impala_crypto::json::write_string(&mut out, &self.iv);
        out.push_str(",\"data\":");
        impala_crypto::json::write_string(&mut out, &self.data);
        out.push_str(&format!(",\"size\":{}}}", self.size));
        out
    }
}

/// Baut die verschlüsselten Pakete eines Uploads (Reihenfolge = Event-Reihenfolge).
pub fn build_packets(
    events: &[WireEvent],
    limits: ChunkLimits,
    key: &CipherKey,
    rng: &dyn Random,
) -> Result<Vec<OutgoingPacket>, SyncError> {
    chunk_cloud_events(events, limits)
        .into_iter()
        .map(|range| {
            let chunk = &events[range];
            let envelope = envelope_json(chunk.iter().map(|ev| ev.json.as_str()))?;
            let enc = encrypt_payload(key, &envelope, rng)?;
            Ok(OutgoingPacket { id: packet_id(chunk), iv: enc.iv, data: enc.data, size: enc.size })
        })
        .collect()
}

/// Höchstens so viele Pakete je Anfrage (Server: `MAX_PACKETS`).
pub const MAX_HTTP_PACKETS: usize = 20;
/// Höchstens so viele UTF-8-Bytes Paket-JSON je Anfrage (Server erlaubt mehr).
pub const MAX_HTTP_BYTES: usize = 6_000_000;

/// Anfragekörper `{"events":[…]}` für `POST /api/events`, gebündelt nach Anzahl und Bytes.
pub fn upload_bodies(packets: &[OutgoingPacket]) -> Vec<String> {
    upload_bodies_with(packets, MAX_HTTP_PACKETS, MAX_HTTP_BYTES)
}

pub(crate) fn upload_bodies_with(packets: &[OutgoingPacket], max_packets: usize, max_bytes: usize) -> Vec<String> {
    let mut bodies = Vec::new();
    let mut i = 0;
    while i < packets.len() {
        let mut parts: Vec<String> = Vec::new();
        let mut bytes = 0;
        while i < packets.len() && parts.len() < max_packets {
            let json = packets[i].to_json();
            let n = json.len() + 1;
            if !parts.is_empty() && bytes + n > max_bytes {
                break;
            }
            parts.push(json);
            bytes += n;
            i += 1;
        }
        bodies.push(format!("{{\"events\":[{}]}}", parts.join(",")));
    }
    bodies
}

/// Entschlüsselt die Pakete einer `GET /api/sync`-Seite. Sie müssen lückenlos bei `since + 1`
/// beginnen. Liefert die Events (als Cloudflare-Fremdevents markiert) und die letzte `seq`.
pub fn open_packets(key: &CipherKey, packets: &[Value], since: u64) -> Result<(Vec<Value>, u64), SyncError> {
    let mut events = Vec::new();
    let mut expected = since + 1;
    for packet in packets {
        let seq = packet.get("seq");
        if seq.and_then(Value::as_f64) != Some(expected as f64) {
            let got = seq.map_or_else(|| "undefined".to_owned(), |s| js_string(Some(s)));
            return Err(SyncError::Protocol(format!("Server-Sequenzlücke: erwartet {expected}, erhalten {got}.")));
        }
        let text = |k: &str| packet.get(k).and_then(Value::as_str).unwrap_or_default();
        let plain = decrypt_payload(key, text("iv"), text("data"))?;
        let envelope: Value = serde_json::from_slice(&plain)
            .map_err(|e| SyncError::Protocol(format!("Cloud-Paket ist kein gültiges JSON: {e}")))?;
        events.extend(prepare_incoming_cloud_events(vec![envelope])?);
        expected += 1;
    }
    Ok((events, expected - 1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ev(n: usize) -> WireEvent {
        WireEvent::new(json!({ "id": format!("e{n}"), "s": "ä".repeat(n) }))
    }

    #[test]
    fn chunks_by_count_and_utf8_bytes() {
        let events: Vec<WireEvent> = (0..7).map(ev).collect();
        let sizes = |l| chunk_cloud_events(&events, l).into_iter().map(|r| r.len()).collect::<Vec<_>>();
        assert_eq!(sizes(ChunkLimits { max_events: 3, max_json_bytes: 10_000 }), [3, 3, 1]);
        // e5: {"id":"e5","s":"äääää"} = 18 + 2·5 Bytes, + 1 → 29 (Zeichen wären 24)
        assert_eq!(events[5].json.len() + 1, 29);
        assert_eq!(sizes(ChunkLimits { max_events: 99, max_json_bytes: 30 }), [1, 1, 1, 1, 1, 1, 1]);
        assert_eq!(sizes(ChunkLimits { max_events: 99, max_json_bytes: 41 }), [2, 1, 1, 1, 1, 1]);
        assert!(chunk_cloud_events(&[], ChunkLimits::default()).is_empty());
    }

    #[test]
    fn batches_bodies() {
        let p = |i: usize| OutgoingPacket { id: format!("p-{i}"), iv: "00".repeat(12), data: "QQ==".into(), size: 13 };
        let packets: Vec<_> = (0..45).map(p).collect();
        let bodies = upload_bodies(&packets);
        assert_eq!(bodies.len(), 3);
        assert!(
            bodies[0]
                .starts_with(r#"{"events":[{"id":"p-0","iv":"000000000000000000000000","data":"QQ==","size":13},"#)
        );
        let one = p(0).to_json().len() + 1;
        assert_eq!(upload_bodies_with(&packets[..5], 20, one * 2).len(), 3);
        assert_eq!(upload_bodies_with(&packets[..1], 20, 1).len(), 1);
    }
}
