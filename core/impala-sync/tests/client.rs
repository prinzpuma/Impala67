//! Sync-Ablauf gegen einen nachgebauten Worker (Verhalten wie `server/worker.js`: Pfade, Header,
//! Felder, Statuscodes) und eine Ablage im Speicher: Geräte konvergieren, Bestätigungen,
//! Generationsschnitt, Reparatur nach 410, Dateien, Quota.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Mutex;

use impala_crypto::{SyncKey, decrypt_payload};
use impala_net::{HttpClient, Method, NetError, Request, Response, block_on};
use impala_sync::*;
use serde_json::{Map, Value, json};

// ---------------------------------------------------------------------------
// Worker

#[derive(Default)]
struct Worker {
    packets: Vec<Value>,
    blobs: BTreeMap<String, (String, Vec<u8>)>,
    generation: u64,
    total_bytes: u64,
    quota: u64,
    max_blob: usize,
    /// Fehlt dieses Paket in R2 → 410.
    missing: Option<u64>,
    /// Jeder Abruf → 410 (R2 dauerhaft kaputt).
    always_missing: bool,
    /// Ein fremdes Paket direkt vor dem nächsten Upload (konkurrierender Schreiber).
    inject: Option<Value>,
    requests: Vec<String>,
}

struct FakeWorker(Mutex<Worker>);

impl FakeWorker {
    fn new() -> Self {
        FakeWorker(Mutex::new(Worker {
            generation: 1,
            quota: 1_000_000_000,
            max_blob: 100_000_000,
            ..Worker::default()
        }))
    }
    fn with<T>(&self, f: impl FnOnce(&mut Worker) -> T) -> T {
        f(&mut self.0.lock().unwrap())
    }
}

fn reply(status: u16, body: Value) -> Response {
    Response {
        status,
        headers: vec![("Content-Type".into(), "application/json".into())],
        body: body.to_string().into_bytes(),
    }
}

fn query(url: &str, key: &str) -> Option<String> {
    url.split_once('?')?.1.split('&').find_map(|kv| kv.strip_prefix(&format!("{key}=")).map(str::to_owned))
}

impl Worker {
    fn save(&mut self, packets: &[Value]) -> Response {
        if let Some(p) = self.inject.take() {
            self.save(&[p]);
        }
        let from = self.packets.len() as u64;
        let known: HashSet<String> = self.packets.iter().map(|p| p["id"].as_str().unwrap().to_owned()).collect();
        let fresh: Vec<&Value> = packets.iter().filter(|p| !known.contains(p["id"].as_str().unwrap())).collect();
        let incoming: u64 = fresh.iter().map(|p| p["size"].as_u64().unwrap()).sum();
        if self.total_bytes + incoming > self.quota {
            return reply(
                413,
                json!({"error": "Quota überschritten.", "usage": self.total_bytes, "limit": self.quota}),
            );
        }
        for p in &fresh {
            assert!(p["iv"].as_str().unwrap().len() == 24 && !p["data"].as_str().unwrap().is_empty());
            let mut p = (*p).clone();
            p["seq"] = json!(self.packets.len() + 1);
            self.packets.push(p);
        }
        self.total_bytes += incoming;
        let to = self.packets.len() as u64;
        let saved = fresh.len();
        reply(
            200,
            json!({"ok": true, "savedCount": saved, "ack": {"fromSeq": from, "toSeq": to, "savedCount": saved},
            "usage": self.total_bytes, "limit": self.quota, "generation": self.generation}),
        )
    }

    fn handle(&mut self, req: &Request) -> Response {
        let path = req.url.split_once("://").unwrap().1;
        let path = &path[path.find('/').unwrap()..];
        let route = path.split('?').next().unwrap();
        self.requests.push(format!("{} {route}", req.method.as_str()));
        let header = |k: &str| req.headers.iter().find(|(n, _)| n.eq_ignore_ascii_case(k)).map(|(_, v)| v.as_str());
        assert_eq!(header("X-Impala-Sync-Protocol"), Some("4"));
        assert!(header("Authorization").unwrap().starts_with("Bearer "));
        assert_eq!(query(&req.url, "user").as_deref(), header("X-User-Id"));
        match (req.method, route) {
            (Method::Get, "/api/sync") => {
                let since: u64 = query(&req.url, "since").unwrap().parse().unwrap();
                let limit: usize = query(&req.url, "limit").unwrap().parse().unwrap();
                let page: Vec<Value> = self.packets.iter().skip(since as usize).take(limit).cloned().collect();
                if let Some(m) =
                    self.missing.filter(|m| self.always_missing || (*m > since && *m <= since + page.len() as u64))
                {
                    return reply(
                        410,
                        json!({"error": format!("R2-Paket fehlt: {m}"), "code": "packet_missing", "generation": self.generation}),
                    );
                }
                let has_more = page.len() == limit;
                reply(
                    200,
                    json!({"events": page, "maxSeq": self.packets.len(), "hasMore": has_more,
                    "usage": self.total_bytes, "limit": self.quota, "generation": self.generation}),
                )
            }
            (Method::Post, "/api/events") => {
                assert_eq!(header("Content-Type"), Some("application/json"));
                let body: Value = serde_json::from_slice(&req.body).unwrap();
                self.save(body["events"].as_array().unwrap())
            }
            (Method::Get, "/api/blobs") => {
                // Seiten zu je 2 Schlüsseln, damit der Cursor mitläuft.
                let after = query(&req.url, "cursor").unwrap_or_default();
                let keys: Vec<&String> = self.blobs.keys().filter(|k| k.as_str() > after.as_str()).take(2).collect();
                let more = keys.len() == 2 && self.blobs.keys().any(|k| k > keys[1]);
                let cursor = if more { keys[1].clone() } else { String::new() };
                reply(200, json!({"keys": keys, "cursor": cursor}))
            }
            (Method::Post, "/api/reset") => {
                self.packets.clear();
                self.blobs.clear();
                self.total_bytes = 0;
                self.generation += 1;
                reply(200, json!({"ok": true, "generation": self.generation}))
            }
            (method, route) if route.starts_with("/api/blob/") => {
                let key = route["/api/blob/".len()..].to_owned();
                assert_eq!(key.len(), 64);
                match method {
                    Method::Put => {
                        if self.blobs.contains_key(&key) {
                            return Response { status: 204, headers: vec![], body: vec![] };
                        }
                        if req.body.len() > self.max_blob {
                            return reply(
                                413,
                                json!({"error": "Blob ist leer, zu groß oder hat keine gültige Längenangabe."}),
                            );
                        }
                        let size = req.body.len() as u64 + 12;
                        if self.total_bytes + size > self.quota {
                            return reply(413, json!({"error": "Quota überschritten."}));
                        }
                        self.total_bytes += size;
                        self.blobs.insert(key, (header("X-Impala-IV").unwrap().to_owned(), req.body.clone()));
                        Response {
                            status: 201,
                            headers: vec![("X-Impala-Usage".into(), self.total_bytes.to_string())],
                            body: vec![],
                        }
                    }
                    Method::Get => match self.blobs.get(&key) {
                        Some((iv, bytes)) => Response {
                            status: 200,
                            headers: vec![
                                ("X-Impala-IV".into(), iv.clone()),
                                ("X-Impala-Usage".into(), self.total_bytes.to_string()),
                            ],
                            body: bytes.clone(),
                        },
                        None => Response { status: 404, headers: vec![], body: vec![] },
                    },
                    _ => reply(404, json!({"error": "Endpunkt nicht gefunden."})),
                }
            }
            _ => reply(404, json!({"error": "Endpunkt nicht gefunden."})),
        }
    }
}

impl HttpClient for FakeWorker {
    async fn send(&self, req: &Request) -> Result<Response, NetError> {
        Ok(self.0.lock().unwrap().handle(req))
    }
}

// ---------------------------------------------------------------------------
// Ablage

#[derive(Default)]
struct Mem {
    state: SyncState,
    events: Vec<Value>,
    pages: Map<String, Value>,
    blobs: HashMap<String, LocalBlob>,
    /// Was `filter_for_upload` weglässt (Event-IDs).
    local_only: HashSet<String>,
}

impl Mem {
    fn add(&mut self, mut ev: Value) {
        let seq = self.events.len() as u64 + 1;
        ev["seq"] = json!(seq);
        self.events.push(ev);
    }
    fn ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.events.iter().map(|e| e["id"].as_str().unwrap_or("").to_owned()).collect();
        ids.sort();
        ids
    }
}

impl SyncStore for Mem {
    async fn load_state(&self) -> SyncState {
        self.state.clone()
    }
    async fn save_state(&mut self, state: &SyncState) -> Result<(), StoreError> {
        self.state = state.clone();
        Ok(())
    }
    async fn max_seq(&self) -> Result<u64, StoreError> {
        Ok(self.events.len() as u64)
    }
    async fn events_after(&self, after: u64, up_to: u64) -> Result<Vec<Value>, StoreError> {
        Ok(self.events.iter().filter(|e| (after + 1..=up_to).contains(&e["seq"].as_u64().unwrap())).cloned().collect())
    }
    fn filter_for_upload(&self, events: Vec<Value>) -> Vec<Value> {
        events.into_iter().filter(|e| !self.local_only.contains(e["id"].as_str().unwrap_or(""))).collect()
    }
    async fn import_remote(&mut self, events: Vec<Value>, _unsynced_after: u64) -> Result<(), StoreError> {
        let known: HashSet<String> = self.ids().into_iter().collect();
        for ev in events {
            assert_eq!((ev["_remote"].clone(), ev["_remoteSource"].clone()), (json!(true), json!("cloudflare")));
            assert!(ev.get("seq").is_none());
            if !known.contains(ev["id"].as_str().unwrap_or("")) {
                self.add(ev);
            }
        }
        Ok(())
    }
    fn pages(&self) -> Map<String, Value> {
        self.pages.clone()
    }
    async fn blob_ids(&self) -> Result<Vec<String>, StoreError> {
        let mut ids: Vec<String> = self.blobs.keys().cloned().collect();
        ids.sort();
        Ok(ids)
    }
    async fn get_blob(&self, id: &str) -> Result<Option<LocalBlob>, StoreError> {
        Ok(self.blobs.get(id).cloned())
    }
    async fn put_blob(&mut self, id: &str, blob: LocalBlob) -> Result<(), StoreError> {
        self.blobs.insert(id.to_owned(), blob);
        Ok(())
    }
}

fn creds() -> &'static impala_crypto::SyncCredentials {
    static C: std::sync::OnceLock<impala_crypto::SyncCredentials> = std::sync::OnceLock::new();
    C.get_or_init(|| SyncKey::parse("impala-0123-4567-89ab-cdef-0011-2233-4455-6677").unwrap().derive())
}

fn device<'w>(worker: &'w FakeWorker, name: &str) -> SyncClient<&'w FakeWorker, Mem> {
    block_on(SyncClient::new(worker, Mem::default(), "https://worker.test/", creds(), name))
}

fn ev(id: &str, t: &str, ty: &str, payload: Value) -> Value {
    json!({ "id": id, "t": t, "type": ty, "payload": payload })
}

/// Alle Events auf dem Server (entschlüsselt, ohne Markierungen).
fn server_events(worker: &FakeWorker) -> Vec<Value> {
    let packets = worker.with(|w| w.packets.clone());
    packets
        .iter()
        .flat_map(|p| {
            let plain = decrypt_payload(&creds().key, p["iv"].as_str().unwrap(), p["data"].as_str().unwrap()).unwrap();
            let env: Value = serde_json::from_slice(&plain).unwrap();
            env["events"].as_array().unwrap().clone()
        })
        .collect()
}

// ---------------------------------------------------------------------------

#[test]
fn two_devices_converge_without_echo() {
    let worker = FakeWorker::new();
    let mut a = device(&worker, "A");
    let mut b = device(&worker, "B");
    a.store_mut().add(ev("a1", "2026-01-01T00:00:01Z", "pageCreate", json!({"id": "p1", "title": "Eins"})));
    a.store_mut().add(ev("a2", "2026-01-01T00:00:02Z", "uiTabsSet", json!({"tabs": ["p1"]})));
    a.store_mut().local_only.insert("a3".into());
    a.store_mut().add(ev("a3", "2026-01-01T00:00:03Z", "pageCreate", json!({"id": "privat"})));

    let r = block_on(a.sync(false)).unwrap();
    assert!(r.push.uploaded && r.push.confirmed, "lückenlose Bestätigung erspart den zweiten Abruf");
    assert_eq!(r.push.events, 1, "UI-Zustand und lokale Seiten bleiben lokal");
    let requests = worker.with(|w| w.requests.clone());
    let post = requests.iter().position(|r| r == "POST /api/events").unwrap();
    assert!(!requests[post..].contains(&"GET /api/sync".to_owned()));
    assert_eq!(a.state().last_synced_seq, 1);
    assert_eq!(a.state().last_uploaded_seq, 3);
    let on_server = server_events(&worker);
    assert_eq!(
        on_server,
        vec![
            json!({"id": "a1", "t": "2026-01-01T00:00:01Z", "type": "pageCreate", "payload": {"id": "p1", "title": "Eins"}})
        ]
    );

    let r = block_on(b.sync(false)).unwrap();
    assert_eq!((r.received, r.push.uploaded), (1, false));
    assert_eq!(b.store().ids(), ["a1"]);
    // Fremdevent geht nicht zurück (Echo), der Cursor steht trotzdem oben.
    assert_eq!(b.state().last_uploaded_seq, 1);

    b.store_mut().add(ev("b1", "2026-01-01T00:00:04Z", "pageUpdate", json!({"id": "p1", "patch": {"title": "Zwei"}})));
    block_on(b.sync(false)).unwrap();
    let r = block_on(a.sync(false)).unwrap();
    assert_eq!(r.received, 1);
    assert_eq!(a.store().ids(), ["a1", "a2", "a3", "b1"]);
    // Erneuter Durchgang: nichts zu tun.
    let r = block_on(a.sync(false)).unwrap();
    assert_eq!((r.received, r.push.uploaded), (0, false));
    assert_eq!(server_events(&worker).len(), 2);
}

#[test]
fn concurrent_upload_needs_confirming_pull() {
    let worker = FakeWorker::new();
    let mut a = device(&worker, "A");
    let mut b = device(&worker, "B");
    b.store_mut().add(ev("b1", "t1", "pageCreate", json!({"id": "x"})));
    block_on(b.sync(false)).unwrap();
    let foreign = worker.with(|w| w.packets[0].clone());
    worker.with(|w| w.reset_packets_for_inject(foreign));

    a.store_mut().add(ev("a1", "t2", "pageCreate", json!({"id": "y"})));
    let r = block_on(a.run_pass(false)).unwrap();
    assert!(r.push.uploaded && !r.push.confirmed);
    // Der bestätigende Abruf holt das fremde Paket und überspringt das eigene Echo.
    assert_eq!(a.store().ids(), ["a1", "b1"]);
    assert_eq!(a.state().last_synced_seq, 2);
}

impl Worker {
    /// Leert den Server und hält `packet` für den nächsten Upload eines anderen Geräts bereit.
    fn reset_packets_for_inject(&mut self, packet: Value) {
        self.packets.clear();
        self.total_bytes = 0;
        let mut p = packet;
        p.as_object_mut().unwrap().remove("seq");
        self.inject = Some(p);
    }
}

#[test]
fn full_upload_is_compacted_and_bounded() {
    let worker = FakeWorker::new();
    let mut a = device(&worker, "A").with_chunk_limits(ChunkLimits { max_events: 3, max_json_bytes: 1_000_000 });
    for i in 0..10 {
        a.store_mut().add(ev(
            &format!("s{i}"),
            &format!("2026-01-01T00:00:{i:02}Z"),
            "settingsSet",
            json!({"theme": i}),
        ));
    }
    for i in 0..7 {
        a.store_mut().add(ev(&format!("e{i}"), "2026-01-02T00:00:00Z", "pageCreate", json!({"id": format!("p{i}")})));
    }
    let r = block_on(a.sync(false)).unwrap();
    assert_eq!((r.push.events, r.push.packets), (8, 3), "nur die letzte Einstellung, Pakete zu je 3");
    assert_eq!(server_events(&worker)[0]["id"], "s9");
}

#[test]
fn foreign_generation_cut_rebuilds() {
    let worker = FakeWorker::new();
    let mut a = device(&worker, "A");
    let mut b = device(&worker, "B");
    a.store_mut().add(ev("a1", "t1", "pageCreate", json!({"id": "x"})));
    block_on(a.sync(false)).unwrap();
    block_on(b.sync(false)).unwrap();
    b.store_mut().add(ev("b1", "t2", "pageCreate", json!({"id": "y"})));
    block_on(b.compact_cloud(false)).unwrap();
    assert_eq!(worker.with(|w| w.generation), 2);
    assert_eq!(server_events(&worker).len(), 2, "B lädt den ganzen Stand neu hoch, samt Fremdevent a1");

    // Die WebSocket-Nachricht an A: neue Generation → Cursor zurück, voller Durchgang.
    let action = block_on(a.handle_server_message(r#"{"type":"reset","generation":2}"#)).unwrap();
    assert_eq!(action, WsAction::Sync { force_all: true });
    assert_eq!((a.state().generation, a.state().last_synced_seq), (2, 0));
    block_on(a.sync(true)).unwrap();
    assert_eq!(a.store().ids(), ["a1", "b1"]);
    assert_eq!(server_events(&worker).len(), 2, "gleiche Pakete werden nicht doppelt gespeichert");
}

#[test]
fn generation_change_seen_while_pulling() {
    let worker = FakeWorker::new();
    let mut a = device(&worker, "A");
    a.store_mut().add(ev("a1", "t1", "pageCreate", json!({"id": "x"})));
    block_on(a.sync(false)).unwrap();
    worker.with(|w| {
        w.packets.clear();
        w.generation = 7;
    });
    block_on(a.sync(false)).unwrap();
    assert_eq!(a.state().generation, 7);
    assert_eq!(server_events(&worker).len(), 1, "nach dem fremden Schnitt neu hochgeladen");
}

#[test]
fn missing_packet_repairs_once() {
    let worker = FakeWorker::new();
    let mut a = device(&worker, "A");
    let mut b = device(&worker, "B");
    a.store_mut().add(ev("a1", "t1", "pageCreate", json!({"id": "x"})));
    block_on(a.sync(false)).unwrap();
    worker.with(|w| w.missing = Some(1));
    b.store_mut().add(ev("b1", "t2", "pageCreate", json!({"id": "y"})));
    block_on(b.sync(false)).unwrap();
    assert!(worker.with(|w| w.requests.contains(&"POST /api/reset".to_owned())));
    worker.with(|w| w.missing = None);
    assert_eq!(server_events(&worker).len(), 1, "B baut die Cloud aus seinem Stand neu auf");
    // Bleibt das Paket nach der Reparatur weg, gibt es keine zweite.
    worker.with(|w| (w.missing, w.always_missing) = (Some(1), true));
    let mut c = device(&worker, "C");
    let err = block_on(c.sync(false)).unwrap_err();
    assert_eq!(err.status(), Some(410));
    assert_eq!(worker.with(|w| w.requests.iter().filter(|r| r.as_str() == "POST /api/reset").count()), 2);
}

#[test]
fn blobs_up_down_ignored_and_oversized() {
    const U: &str = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    let worker = FakeWorker::new();
    let mut a = device(&worker, "A");
    let mut b = device(&worker, "B");
    let page = json!({ "content": format!("![](img:{U}) file:alt.pdf file:riesig.bin") });
    a.store_mut().pages.insert("p1".into(), page.clone());
    for (id, size) in [
        (format!("img:{U}"), 10),
        ("file:alt.pdf".to_owned(), 5),
        ("file:riesig.bin".to_owned(), 300),
        ("bgImage".to_owned(), 1),
    ] {
        let blob = LocalBlob { meta: json!({"name": id.trim_start_matches("file:")}), data: vec![7; size] };
        a.store_mut().blobs.insert(id, blob);
    }
    worker.with(|w| w.max_blob = 200);
    let r = block_on(a.sync(false)).unwrap();
    let blobs = r.blobs.unwrap();
    assert_eq!((blobs.uploaded, blobs.oversized.as_slice()), (2, &["riesig.bin".to_owned()][..]));
    assert_eq!(worker.with(|w| w.blobs.len()), 2);

    // B kennt nur das Bild: die PDF ist dort verwaist und wird ignoriert – auch beim nächsten Mal.
    b.store_mut().pages.insert("p1".into(), json!({ "content": format!("img:{U}") }));
    let blobs = block_on(b.sync(false)).unwrap().blobs.unwrap();
    assert_eq!((blobs.downloaded, blobs.ignored), (1, 1));
    assert_eq!(b.store().blobs[&format!("img:{U}")].data, vec![7; 10]);
    assert_eq!(b.state().ignored_blobs.values().collect::<Vec<_>>(), ["file:alt.pdf"]);
    block_on(b.handle_server_message(r#"{"type":"changed","maxSeq":0,"blob":true}"#)).unwrap();
    let blobs = block_on(b.sync(false)).unwrap().blobs.unwrap();
    assert_eq!((blobs.downloaded, blobs.ignored), (0, 0));
    // Verweist eine Seite später darauf, kommt sie doch.
    b.store_mut().pages.insert("p2".into(), json!({ "content": "file:alt.pdf" }));
    assert!(b.note_local_event(&ev("x", "t", "pageUpdate", json!({"id": "p2", "patch": {"content": "file:alt.pdf"}}))));
    let blobs = block_on(b.sync(false)).unwrap().blobs.unwrap();
    assert_eq!(blobs.downloaded, 1);
    assert!(b.state().ignored_blobs.is_empty());
}

#[test]
fn full_quota_triggers_one_cloud_compaction() {
    let worker = FakeWorker::new();
    let mut a = device(&worker, "A");
    // Viele einzelne Deltas füllen die Cloud mit überholten Ständen.
    for i in 0..6 {
        a.store_mut().add(ev(&format!("s{i}"), &format!("t{i}"), "settingsSet", json!({"note": "x".repeat(300)})));
        block_on(a.sync(false)).unwrap();
    }
    let used = worker.with(|w| w.total_bytes);
    worker.with(|w| w.quota = used + 100);
    a.store_mut().add(ev("s6", "t6", "settingsSet", json!({"note": "y".repeat(300)})));
    let r = block_on(a.sync(false)).unwrap();
    assert!(r.push.uploaded);
    assert!(worker.with(|w| w.generation) == 2 && worker.with(|w| w.total_bytes) < used);
    assert_eq!(server_events(&worker).iter().map(|e| e["id"].clone()).collect::<Vec<_>>(), [json!("s6")]);

    // Reicht auch die Kompaktierung nicht, bleibt der Quota-Fehler.
    worker.with(|w| w.quota = 10);
    a.store_mut().add(ev("s7", "t7", "pageCreate", json!({"id": "p"})));
    let err = block_on(a.sync(false)).unwrap_err();
    assert!(err.is_quota() && !err.is_retryable());
}

#[test]
fn websocket_messages_and_stop() {
    let worker = FakeWorker::new();
    let mut a = device(&worker, "A");
    assert_eq!(
        block_on(a.handle_server_message(r#"{"type":"changed","maxSeq":3,"senderClientId":"A"}"#)).unwrap(),
        WsAction::Nothing
    );
    assert_eq!(
        block_on(a.handle_server_message(r#"{"type":"changed","maxSeq":3}"#)).unwrap(),
        WsAction::Sync { force_all: false }
    );
    assert_eq!(
        block_on(a.handle_server_message(r#"{"type":"authenticated","protocol":4,"generation":5}"#)).unwrap(),
        WsAction::Sync { force_all: false }
    );
    assert_eq!(a.state().generation, 5);
    assert_eq!(block_on(a.handle_server_message(r#"{"type":"reset","generation":5}"#)).unwrap(), WsAction::Nothing);
    assert_eq!(block_on(a.handle_server_message(r#"{"type":"pong","t":1}"#)).unwrap(), WsAction::Nothing);
    assert_eq!(
        block_on(a.handle_server_message(r#"{"type":"unauthorized","error":"Ungültiger Autorisierungs-Token"}"#))
            .unwrap(),
        WsAction::Rejected("Ungültiger Autorisierungs-Token".into())
    );
    assert!(block_on(a.handle_server_message("kein json")).is_err());
    assert!(!a.note_local_event(&ev("u", "t", "uiTabsSet", json!({}))));
    a.stop_flag().store(true, std::sync::atomic::Ordering::Relaxed);
    assert_eq!(block_on(a.sync(false)).unwrap_err(), SyncError::Stopped);
    assert!(worker.with(|w| w.requests.is_empty()));
}
