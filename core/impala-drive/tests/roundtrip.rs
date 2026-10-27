//! Rust ↔ Rust gegen eine nachgebaute Drive-API: Backup auf Gerät A, Wiederherstellen auf
//! Gerät B (über `StorageStore<MemoryStorage>`), resumable Upload großer Dateien, Token-Erneuerung
//! bei 401, Verdichten, v1-Snapshot und kaputte Blob-Dateien.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use impala_crypto::{CounterRandom, base64_encode, gunzip, gzip};
use impala_drive::format::{BLOB_PREFIX, DELTA_PREFIX, SNAPSHOT_NAME};
use impala_drive::{Clock, DriveBackup, DriveError, DriveStore, StorageStore, TokenSource};
use impala_net::{HttpClient, Method, NetError, Request, Response, block_on};
use impala_storage::{Blob, MemoryStorage, Storage, Write};
use serde_json::{Value, json};

#[derive(Clone)]
struct File {
    id: String,
    name: String,
    modified: String,
    props: Value,
    bytes: Vec<u8>,
}

impl File {
    fn view(&self) -> Value {
        json!({"id": self.id, "name": self.name, "modifiedTime": self.modified, "size": self.bytes.len().to_string(), "appProperties": self.props})
    }
}

#[derive(Default)]
struct Drive {
    files: Vec<File>,
    /// (Datei-ID, Datei oder `None` = gelöscht)
    changes: Vec<(String, Option<File>)>,
    next: u32,
    tokens: Vec<String>,
    sessions: HashMap<String, (Option<String>, Value)>,
    log: Vec<String>,
    page_size: usize,
}

impl Drive {
    fn new() -> Self {
        Drive { tokens: vec!["tok".into()], page_size: 2, ..Default::default() }
    }

    fn stamp(&mut self) -> String {
        self.next += 1;
        format!("2026-10-27T10:{:02}:{:02}.000Z", self.next / 60, self.next % 60)
    }

    fn put(&mut self, id: Option<&str>, meta: &Value, bytes: Vec<u8>) -> Value {
        let modified = self.stamp();
        let file = match id.and_then(|id| self.files.iter_mut().find(|f| f.id == id)) {
            Some(f) => {
                f.name = meta["name"].as_str().unwrap().into();
                f.props = meta["appProperties"].clone();
                f.bytes = bytes;
                f.modified = modified;
                f.clone()
            }
            None => {
                let f = File {
                    id: format!("f{}", self.next),
                    name: meta["name"].as_str().unwrap().into(),
                    modified,
                    props: meta["appProperties"].clone(),
                    bytes,
                };
                self.files.push(f.clone());
                f
            }
        };
        self.changes.push((file.id.clone(), Some(file.clone())));
        json!({"id": file.id, "name": file.name, "modifiedTime": file.modified, "appProperties": file.props})
    }

    fn add(&mut self, name: &str, props: Value, bytes: Vec<u8>) {
        self.put(None, &json!({"name": name, "appProperties": props}), bytes);
    }

    fn handle(&mut self, req: &Request) -> (u16, Vec<(String, String)>, Vec<u8>) {
        let ok = |v: Value| (200, vec![], v.to_string().into_bytes());
        let auth = req.headers.iter().find(|(k, _)| k == "Authorization").map(|(_, v)| v.trim_start_matches("Bearer "));
        if !auth.is_some_and(|t| self.tokens.iter().any(|x| x == t)) {
            return (401, vec![], b"{}".to_vec());
        }
        let (path, query) = req.url.split_once('?').unwrap_or((&req.url, ""));
        let path = path.trim_start_matches("https://www.googleapis.com");
        let q: HashMap<&str, &str> = query.split('&').filter_map(|p| p.split_once('=')).collect();
        self.log.push(format!(
            "{} {path}{}",
            req.method.as_str(),
            q.get("uploadType").map(|t| format!(" {t}")).unwrap_or_default()
        ));
        let page = |q: &HashMap<&str, &str>| q.get("pageToken").and_then(|t| t.parse::<usize>().ok()).unwrap_or(0);
        match (req.method, path) {
            (Method::Get, "/drive/v3/changes/startPageToken") => {
                ok(json!({"startPageToken": self.changes.len().to_string()}))
            }
            (Method::Get, "/drive/v3/changes") => {
                let at = page(&q);
                let end = (at + self.page_size).min(self.changes.len());
                let list: Vec<Value> = self.changes[at..end]
                    .iter()
                    .map(|(id, f)| match f {
                        Some(f) => json!({"fileId": id, "removed": false, "file": f.view()}),
                        None => json!({"fileId": id, "removed": true}),
                    })
                    .collect();
                if end < self.changes.len() {
                    ok(json!({"changes": list, "nextPageToken": end.to_string()}))
                } else {
                    ok(json!({"changes": list, "newStartPageToken": end.to_string()}))
                }
            }
            (Method::Get, "/drive/v3/about") => ok(json!({"storageQuota": {"usage": "100", "limit": "1000"}})),
            (Method::Get, "/drive/v3/files") => {
                let at = page(&q);
                let end = (at + self.page_size).min(self.files.len());
                let list: Vec<Value> = self.files[at..end].iter().map(File::view).collect();
                if end < self.files.len() {
                    ok(json!({"files": list, "nextPageToken": end.to_string()}))
                } else {
                    ok(json!({"files": list}))
                }
            }
            (Method::Get, p) if p.starts_with("/drive/v3/files/") => {
                let id = &p["/drive/v3/files/".len()..];
                match self.files.iter().find(|f| f.id == id) {
                    Some(f) => (200, vec![], f.bytes.clone()),
                    None => (404, vec![], b"{}".to_vec()),
                }
            }
            (Method::Delete, p) => {
                let id = p["/drive/v3/files/".len()..].to_owned();
                self.files.retain(|f| f.id != id);
                self.changes.push((id, None));
                (204, vec![], vec![])
            }
            (Method::Post | Method::Patch, p) if p.starts_with("/upload/drive/v3/files") => {
                let id = p.strip_prefix("/upload/drive/v3/files/").map(str::to_owned);
                if q.get("uploadType") == Some(&"resumable") {
                    let url = format!("https://upload.example/session/{}", self.sessions.len());
                    self.sessions.insert(url.clone(), (id, serde_json::from_slice(&req.body).unwrap()));
                    return (200, vec![("Location".into(), url)], vec![]);
                }
                let ct = &req.headers.iter().find(|(k, _)| k == "Content-Type").unwrap().1;
                let boundary = ct.split("boundary=").nth(1).unwrap();
                let sep = format!("\r\n--{boundary}\r\nContent-Type: application/octet-stream\r\n\r\n");
                let head = format!("--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n").len();
                let mid = find(&req.body, sep.as_bytes()).unwrap();
                let meta: Value = serde_json::from_slice(&req.body[head..mid]).unwrap();
                let tail = format!("\r\n--{boundary}--").len();
                let bytes = req.body[mid + sep.len()..req.body.len() - tail].to_vec();
                ok(self.put(id.as_deref(), &meta, bytes))
            }
            (Method::Put, _) => {
                let (id, meta) = self.sessions.remove(&req.url).unwrap();
                ok(self.put(id.as_deref(), &meta, req.body.clone()))
            }
            _ => (400, vec![], b"{}".to_vec()),
        }
    }
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

#[derive(Clone)]
struct Net(Arc<Mutex<Drive>>);

impl HttpClient for Net {
    async fn send(&self, req: &Request) -> Result<Response, NetError> {
        let (status, mut headers, body) = self.0.lock().unwrap().handle(req);
        headers.push(("Date".into(), "Tue, 27 Oct 2026 14:05:00 GMT".into()));
        Ok(Response { status, headers, body })
    }
}

struct Tokens {
    token: &'static str,
    renewed: Option<&'static str>,
    calls: Mutex<Vec<&'static str>>,
}

impl Tokens {
    fn ok() -> Tokens {
        Tokens { token: "tok", renewed: None, calls: Mutex::default() }
    }
}

impl TokenSource for Tokens {
    async fn access_token(&self) -> Option<String> {
        Some(self.token.into())
    }
    async fn renew(&self, _rejected: &str) -> Option<String> {
        self.calls.lock().unwrap().push("renew");
        self.renewed.map(str::to_owned)
    }
    async fn expired(&self) {
        self.calls.lock().unwrap().push("expired");
    }
}

struct Now;

impl Clock for Now {
    fn now_ms(&self) -> f64 {
        1_793_109_900_000.0
    }
    async fn sleep_ms(&self, _ms: u64) {}
}

type Device = DriveBackup<Net, Tokens, StorageStore<MemoryStorage>, Now>;

fn device(drive: &Arc<Mutex<Drive>>, seed: u8) -> Device {
    DriveBackup::new(Net(drive.clone()), Tokens::ok(), StorageStore::new(MemoryStorage::new()), Now)
        .with_rng(Box::new(CounterRandom::new(seed)))
}

fn add_event(dev: &mut Device, id: &str, kind: &str, payload: Value) {
    let ev = json!({"id": id, "t": format!("2026-10-27T09:00:{:02}.000Z", id.len()), "type": kind, "payload": payload});
    dev.store_mut().storage.apply(vec![Write::AddEvent(ev.as_object().unwrap().clone())]).unwrap();
}

fn ids(dev: &Device) -> Vec<String> {
    let evs = dev.store().storage.events_after(0, None, None).unwrap();
    evs.iter().map(|e| e["id"].as_str().unwrap().to_owned()).collect()
}

fn sync(dev: &mut Device) -> impala_drive::SyncReport {
    block_on(dev.sync(&mut |_| {})).unwrap()
}

#[test]
fn backup_and_restore_between_devices() {
    let drive = Arc::new(Mutex::new(Drive::new()));
    let mut a = device(&drive, 1);
    add_event(
        &mut a,
        "a1",
        "pageCreate",
        json!({"id": "p", "title": "Hallo", "content": "![](img:11111111-1111-4111-8111-111111111111)"}),
    );
    add_event(&mut a, "a2", "uiTabsSet", json!({"tabs": ["p"]}));
    let img = Blob { bytes: vec![1, 2, 3], meta: Some(json!({"name": "a.png", "type": "image/png"})) };
    a.store_mut()
        .storage
        .apply(vec![Write::PutBlob("img:11111111-1111-4111-8111-111111111111".into(), img.clone())])
        .unwrap();
    let r = sync(&mut a);
    assert_eq!((r.uploaded, r.blobs_uploaded, r.label()), (1, 1, "Synchronisiert"));
    // Gerät-ID im Format von crypto.randomUUID.
    let device_id = block_on(a.store().load_state()).unwrap().device_id;
    assert_eq!((device_id.len(), &device_id[14..15]), (36, "4"));
    {
        let d = drive.lock().unwrap();
        let delta = d.files.iter().find(|f| f.name.starts_with(DELTA_PREFIX)).unwrap();
        assert_eq!(delta.name, format!("{DELTA_PREFIX}{device_id}-1-2.json.gz"));
        let content: Value = serde_json::from_slice(&gunzip(&delta.bytes).unwrap()).unwrap();
        assert_eq!(content["events"].as_array().unwrap().len(), 1, "UI-Zustand bleibt auf dem Gerät");
        assert!(content["events"][0].get("seq").is_none(), "keine lokalen Marken");
        assert!(d.files.iter().any(
            |f| f.name.starts_with(BLOB_PREFIX) && f.props["blobId"] == "img:11111111-1111-4111-8111-111111111111"
        ));
    }
    // Nichts Neues: keine Anfragen außer dem Abgleich.
    let before = drive.lock().unwrap().log.len();
    let r = sync(&mut a);
    assert_eq!((r.imported, r.uploaded, r.label()), (0, 0, "Aktuell"));
    assert!(drive.lock().unwrap().log[before..].iter().all(|l| l.starts_with("GET /drive/v3/changes")));

    // Gerät B: leer → stellt alles wieder her.
    let mut b = device(&drive, 100);
    let r = sync(&mut b);
    assert_eq!((r.imported, r.blobs_downloaded, r.uploaded), (1, 1, 0));
    assert_eq!(ids(&b), ["a1"]);
    let restored = b.store().storage.blob("img:11111111-1111-4111-8111-111111111111").unwrap().unwrap();
    assert_eq!(restored, img);
    let ev = &b.store().storage.events_after(0, None, None).unwrap()[0];
    assert_eq!((ev["_remote"].clone(), ev["_remoteSource"].clone()), (json!(true), json!("drive")));

    // B ändert, A übernimmt; A lädt sein eigenes Delta nie erneut.
    add_event(&mut b, "b1", "pageUpdate", json!({"id": "p", "patch": {"content": "neu"}}));
    assert_eq!(sync(&mut b).uploaded, 1, "Drive-Echo geht nicht zurück, nur die eigene Änderung");
    let before = drive.lock().unwrap().log.len();
    let r = sync(&mut a);
    assert_eq!((r.imported, r.uploaded), (1, 0));
    let downloads = drive.lock().unwrap().log[before..].iter().filter(|l| l.contains("/files/f")).count();
    assert_eq!(downloads, 1);
    assert_eq!(ids(&a), ["a1", "a2", "b1"]);
}

#[test]
fn large_files_upload_resumable() {
    let drive = Arc::new(Mutex::new(Drive::new()));
    let mut a = device(&drive, 1);
    // Pseudozufall, damit gzip ihn nicht unter 5 MB drückt.
    let mut x = 0x1234_5678u32;
    let bytes: Vec<u8> = (0..6_000_000)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            x as u8
        })
        .collect();
    let blob = Blob { bytes: bytes.clone(), meta: Some(json!({"name": "gross.pdf"})) };
    a.store_mut()
        .storage
        .apply(vec![Write::PutBlob("file:22222222-2222-4222-8222-222222222222".into(), blob)])
        .unwrap();
    sync(&mut a);
    let log = drive.lock().unwrap().log.clone();
    assert!(log.iter().any(|l| l == "POST /upload/drive/v3/files resumable"), "{log:?}");
    let mut b = device(&drive, 50);
    assert_eq!(sync(&mut b).blobs_downloaded, 1);
    assert_eq!(b.store().storage.blob("file:22222222-2222-4222-8222-222222222222").unwrap().unwrap().bytes, bytes);
}

#[test]
fn unauthorized_renews_once_then_expires() {
    let drive = Arc::new(Mutex::new(Drive::new()));
    drive.lock().unwrap().tokens = vec!["frisch".into()];
    let tokens = Tokens { token: "alt", renewed: Some("frisch"), calls: Mutex::default() };
    let mut a = DriveBackup::new(Net(drive.clone()), tokens, StorageStore::new(MemoryStorage::new()), Now);
    block_on(a.sync(&mut |_| {})).unwrap();
    assert_eq!(*a.tokens().calls.lock().unwrap(), ["renew"]);

    let tokens = Tokens { token: "alt", renewed: None, calls: Mutex::default() };
    let mut b = DriveBackup::new(Net(drive.clone()), tokens, StorageStore::new(MemoryStorage::new()), Now);
    assert_eq!(block_on(b.sync(&mut |_| {})), Err(DriveError::SessionExpired));
    assert_eq!(*b.tokens().calls.lock().unwrap(), ["renew", "expired"]);
    // Ohne Token: Flush und Speicheranzeige tun nichts.
    struct NoToken;
    impl TokenSource for NoToken {
        async fn access_token(&self) -> Option<String> {
            None
        }
    }
    let mut c = DriveBackup::new(Net(drive.clone()), NoToken, StorageStore::new(MemoryStorage::new()), Now);
    assert_eq!((block_on(c.flush_upload()), block_on(c.storage_info())), (Ok(0), Ok(None)));
    assert_eq!(
        block_on(c.sync(&mut |_| {})).unwrap_err().to_string(),
        "Google-Sitzung abgelaufen – bitte erneut synchronisieren."
    );
}

#[test]
fn compaction_keeps_everything_restorable() {
    let drive = Arc::new(Mutex::new(Drive::new()));
    drive.lock().unwrap().page_size = 20;
    for i in 0..55 {
        let ev =
            json!({"id": format!("x{i}"), "t": "2026-10-27T08:00:00.000Z", "type": "cardCreate", "payload": {"id": i}});
        let body = json!({"app": "impala67", "version": 2, "exportedAt": "", "events": [ev], "blobs": {}}).to_string();
        drive.lock().unwrap().add(
            &format!("{DELTA_PREFIX}dev-X-{i}-{i}.json.gz"),
            json!({"encoding": "gzip"}),
            gzip(body.as_bytes()),
        );
    }
    let mut a = device(&drive, 1);
    add_event(&mut a, "a1", "pageCreate", json!({"id": "p"}));
    let r = sync(&mut a);
    assert!(r.compacted);
    assert_eq!((r.imported, r.uploaded), (55, 1));
    {
        let d = drive.lock().unwrap();
        assert_eq!(
            d.files.iter().filter(|f| f.name.starts_with(DELTA_PREFIX)).count(),
            1,
            "nur das eigene, neue Delta bleibt"
        );
        assert!(d.files.iter().any(|f| f.name == SNAPSHOT_NAME));
    }
    // A lädt den eigenen Snapshot nicht wieder herunter.
    assert_eq!(sync(&mut a).imported, 0);
    let mut c = device(&drive, 9);
    let r = sync(&mut c);
    assert_eq!(r.imported, 56);
    assert_eq!(ids(&c).len(), 56);
}

#[test]
fn v1_snapshot_and_broken_blob_files() {
    let drive = Arc::new(Mutex::new(Drive::new()));
    let v1 = json!({
        "app": "notion", "version": 1, "exportedAt": "2025-01-01T00:00:00.000Z",
        "events": [{"id": "v1", "t": "2025-01-01T00:00:00.000Z", "type": "pageCreate", "payload": {"id": "q"}}],
        "blobs": {
            "img:55555555-5555-4555-8555-555555555555": {"meta": {"name": "e.png"}, "b64": base64_encode(&[1, 1, 2])},
            "__impala67_state_checkpoint_v2__": {"b64": "AA=="}
        }
    });
    drive.lock().unwrap().add("notion-sync.json", Value::Null, v1.to_string().into_bytes());
    let broken = json!({"id": "img:66666666-6666-4666-8666-666666666666", "b64": "§§"}).to_string();
    drive.lock().unwrap().add(
        &format!("{BLOB_PREFIX}kaputt.json.gz"),
        json!({"encoding": "gzip"}),
        gzip(broken.as_bytes()),
    );
    let mut a = device(&drive, 3);
    let r = sync(&mut a);
    assert_eq!((r.imported, r.skipped_blob_files), (1, 1));
    let storage = &a.store().storage;
    assert_eq!(storage.blob("img:55555555-5555-4555-8555-555555555555").unwrap().unwrap().bytes, [1, 1, 2]);
    assert_eq!(storage.blob_keys().unwrap(), ["img:55555555-5555-4555-8555-555555555555"]);
}

#[test]
fn storage_state_lives_in_meta_like_local_storage() {
    let drive = Arc::new(Mutex::new(Drive::new()));
    let mut a = device(&drive, 1);
    add_event(&mut a, "a1", "pageCreate", json!({"id": "p"}));
    sync(&mut a);
    let storage = &a.store().storage;
    assert_eq!(storage.meta("impala67_drive_uploaded_seq").unwrap().as_deref(), Some("1"));
    assert!(storage.meta("impala67_drive_file_index").unwrap().unwrap().starts_with("{\"token\":"));
    assert!(storage.meta("impala67_drive_last_ok").unwrap().is_some());
    let info = block_on(a.storage_info()).unwrap().unwrap();
    assert!(info.app_bytes > 0.0);
    assert_eq!((info.used_bytes, info.limit_bytes), (100.0, 1000.0));
}
