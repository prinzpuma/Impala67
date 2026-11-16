//! Messung: Drive-Durchgang gegen eine Drive-Attrappe im Speicher (Median aus 5 Läufen).
//! `cargo run -p impala-drive --example bench --profile native -- delta|blobs`
//! - `delta`: 2 000 Events mit je 5 KB Inhalt als Änderungspaket hochladen.
//! - `blobs`: 24 Dateien mit je 2 MB erstmals sichern (ein Lauf; den Spitzen-Speicher des
//!   Prozesses von außen ablesen).

use std::cell::Cell;
use std::time::Instant;

use impala_drive::{Clock, DriveBackup, StorageStore, TokenSource};
use impala_net::{HttpClient, NetError, Request, Response, block_on};
use impala_storage::{Blob, MemoryStorage, Storage, Write};
use serde_json::json;

/// Beantwortet, was ein Durchgang fragt; Uploads werden gezählt und verworfen.
#[derive(Default)]
struct Net {
    uploads: Cell<u32>,
    bytes: Cell<u64>,
}

impl HttpClient for Net {
    async fn send(&self, req: &Request) -> Result<Response, NetError> {
        let url = req.url.as_str();
        let ok =
            |headers: Vec<(String, String)>, body: String| Response { status: 200, headers, body: body.into_bytes() };
        Ok(if url.contains("changes/startPageToken") {
            ok(vec![], r#"{"startPageToken":"1"}"#.into())
        } else if url.contains("/drive/v3/changes?") {
            ok(vec![], r#"{"changes":[],"newStartPageToken":"2"}"#.into())
        } else if url.contains("uploadType=resumable") {
            ok(vec![("Location".into(), "https://upload.invalid/session".into())], String::new())
        } else if url.contains("/upload/") || url.contains("upload.invalid") {
            self.uploads.set(self.uploads.get() + 1);
            self.bytes.set(self.bytes.get() + req.body.len() as u64);
            let id = self.uploads.get();
            ok(vec![], format!(r#"{{"id":"f{id}","name":"hochgeladen","modifiedTime":"2026-01-01T00:00:00.000Z"}}"#))
        } else {
            ok(vec![], r#"{"files":[]}"#.into())
        })
    }
}

struct Tokens;

impl TokenSource for Tokens {
    async fn access_token(&self) -> Option<String> {
        Some("tok".into())
    }
}

struct Now;

impl Clock for Now {
    fn now_ms(&self) -> f64 {
        1_793_109_900_000.0
    }
    async fn sleep_ms(&self, _ms: u64) {}
}

fn backup(storage: MemoryStorage) -> DriveBackup<Net, Tokens, StorageStore<MemoryStorage>, Now> {
    DriveBackup::new(Net::default(), Tokens, StorageStore::new(storage), Now)
}

fn ms(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1000.0
}

fn delta() {
    let para = "Ein Absatz mit etwas Text und Umlauten äöü für eine typische Seite. ";
    let content = para.repeat(5000 / para.len() + 1);
    let mut storage = MemoryStorage::new();
    let events = (0..2000).map(|i| {
        let ev = json!({
            "id": format!("ev-{i:05}"), "t": format!("2026-01-01T00:{:02}:{:02}.000Z", i / 60 % 60, i % 60),
            "type": "pageUpdate", "payload": { "id": format!("page-{}", i % 200), "patch": { "content": content } },
        });
        Write::AddEvent(ev.as_object().cloned().unwrap())
    });
    storage.apply(events.collect()).unwrap();
    let mut times: Vec<f64> = (0..5)
        .map(|_| {
            let mut b = backup(storage.clone());
            let t = Instant::now();
            assert_eq!(block_on(b.flush_upload()).unwrap(), 2000);
            ms(t)
        })
        .collect();
    times.sort_by(f64::total_cmp);
    println!("2 000 Events (10 MB) als Änderungspaket: {:.1} ms", times[2]);
}

fn blobs() {
    const FILES: usize = 24;
    const SIZE: usize = 2 << 20;
    let mut x = 88172645463325252u64;
    let mut storage = MemoryStorage::new();
    for i in 0..FILES {
        // Zufallsbytes: lassen sich wie Bilder und PDFs kaum packen.
        let bytes: Vec<u8> = (0..SIZE)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                x as u8
            })
            .collect();
        let meta = json!({ "name": format!("bild-{i}.png"), "type": "image/png", "size": SIZE });
        storage.apply(vec![Write::PutBlob(format!("img:bild-{i}"), Blob { bytes, meta: Some(meta) })]).unwrap();
    }
    let mut b = backup(storage);
    let t = Instant::now();
    let report = block_on(b.sync(&mut |_| {})).unwrap();
    assert_eq!(report.blobs_uploaded, FILES);
    println!("{FILES} Dateien zu je 2 MB erstmals sichern: {:.0} ms", ms(t));
}

fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("delta") => delta(),
        Some("blobs") => blobs(),
        _ => eprintln!("Aufruf: bench delta|blobs"),
    }
}
