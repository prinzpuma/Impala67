//! Erweiterte Ende-zu-Ende-Ablauftests für Cloudflare-Sync (zwei Geräte, Hefte, Blobs,
//! Generationswechsel/Kompaktierung, `refetch_all` mit verspäteten Events, Netzausfall & Neustart).

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use impala_crypto::{SyncCredentials, SyncKey};
use impala_net::{Method, NetError, Request, Response};
use serde_json::{Value, json};

use crate::sync::{CloudSync, SyncFailure, SyncListener};
use crate::{CheckpointResult, ImpalaCore};

/// Vollständiger Mock-Worker: Events, Blobs (GET/PUT/LIST), Reset (Generationswechsel) und Fehler-Injektion.
#[derive(Default)]
struct FullWorker {
    generation: u64,
    packets: Vec<Value>,
    /// Server-Schlüssel -> (IV-Header, verschlüsselte Bytes)
    blobs: HashMap<String, (String, Vec<u8>)>,
    /// Wenn > 0, schlägt der nächste POST `/api/events` mit 503 fehl und zählt herunter.
    fail_next_posts: usize,
}

#[derive(Clone)]
struct MockNet(Arc<Mutex<FullWorker>>);

impl Default for MockNet {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(FullWorker { generation: 1, ..Default::default() })))
    }
}

fn json_reply(status: u16, body: Value) -> Response {
    Response { status, headers: vec![], body: body.to_string().into_bytes() }
}

fn query_param(url: &str, key: &str) -> Option<String> {
    url.split_once('?')?.1.split('&').find_map(|kv| kv.strip_prefix(&format!("{key}=")).map(str::to_owned))
}

impl impala_net::HttpClient for MockNet {
    async fn send(&self, req: &Request) -> Result<Response, NetError> {
        let mut w = self.0.lock().unwrap();
        let path = req.url.split_once("://").unwrap().1;
        let route = path[path.find('/').unwrap()..].split('?').next().unwrap().to_owned();
        Ok(match (req.method, route.as_str()) {
            (Method::Get, "/api/sync") => {
                let since: usize = query_param(&req.url, "since").unwrap().parse().unwrap();
                let limit: usize = query_param(&req.url, "limit").unwrap().parse().unwrap();
                let page: Vec<Value> = w.packets.iter().skip(since).take(limit).cloned().collect();
                let more = since + page.len() < w.packets.len();
                json_reply(
                    200,
                    json!({
                        "events": page,
                        "maxSeq": w.packets.len(),
                        "hasMore": more,
                        "generation": w.generation
                    }),
                )
            }
            (Method::Post, "/api/events") => {
                if w.fail_next_posts > 0 {
                    w.fail_next_posts -= 1;
                    return Ok(json_reply(503, json!({ "error": "Temporär nicht erreichbar" })));
                }
                let body: Value = serde_json::from_slice(&req.body).unwrap();
                let from = w.packets.len();
                let known: HashSet<String> = w.packets.iter().map(|p| p["id"].to_string()).collect();
                for p in body["events"].as_array().unwrap() {
                    if !known.contains(&p["id"].to_string()) {
                        let mut p = p.clone();
                        p["seq"] = json!(w.packets.len() + 1);
                        w.packets.push(p);
                    }
                }
                let (to, saved) = (w.packets.len(), w.packets.len() - from);
                json_reply(
                    200,
                    json!({
                        "ok": true,
                        "savedCount": saved,
                        "ack": { "fromSeq": from, "toSeq": to, "savedCount": saved },
                        "generation": w.generation
                    }),
                )
            }
            (Method::Post, "/api/reset") => {
                w.generation += 1;
                w.packets.clear();
                w.blobs.clear();
                json_reply(200, json!({ "ok": true, "generation": w.generation }))
            }
            (Method::Get, "/api/blobs") => {
                let mut keys: Vec<String> = w.blobs.keys().cloned().collect();
                keys.sort();
                json_reply(200, json!({ "keys": keys, "cursor": "" }))
            }
            (Method::Put, r) if r.starts_with("/api/blob/") => {
                let key = r.trim_start_matches("/api/blob/").to_owned();
                let iv = req
                    .headers
                    .iter()
                    .find(|(k, _)| k.eq_ignore_ascii_case("X-Impala-IV"))
                    .map(|(_, v)| v.clone())
                    .unwrap_or_default();
                w.blobs.insert(key, (iv, req.body.clone()));
                json_reply(200, json!({ "ok": true }))
            }
            (Method::Get, r) if r.starts_with("/api/blob/") => {
                let key = r.trim_start_matches("/api/blob/");
                match w.blobs.get(key) {
                    Some((iv, bytes)) => {
                        Response { status: 200, headers: vec![("X-Impala-IV".into(), iv.clone())], body: bytes.clone() }
                    }
                    None => json_reply(404, json!({ "error": "Blob nicht gefunden" })),
                }
            }
            _ => json_reply(404, json!({ "error": "Endpunkt nicht gefunden" })),
        })
    }
}

#[derive(Default)]
struct NoopListener(AtomicUsize);

impl SyncListener for NoopListener {
    fn on_progress(&self, _: String, _: u64, _: u64) {
        self.0.fetch_add(1, Ordering::Relaxed);
    }
    fn on_sync_needed(&self) {}
}

fn test_creds() -> SyncCredentials {
    static CREDS: std::sync::OnceLock<SyncCredentials> = std::sync::OnceLock::new();
    CREDS.get_or_init(|| SyncKey::parse("impala-0123-4567-89ab-cdef-0011-2233-4455-6677").unwrap().derive()).clone()
}

fn spawn_device(net: &MockNet) -> (Arc<ImpalaCore>, Arc<CloudSync>) {
    let core = ImpalaCore::open_in_memory().unwrap();
    let sync = CloudSync::start(
        &core,
        net.clone(),
        test_creds(),
        "https://worker.test/",
        Some(Arc::new(NoopListener::default())),
    );
    (core, sync)
}

#[test]
fn sync_heft_striche_bilder_und_datei_blobs_zwischen_zwei_geraeten() {
    let net = MockNet::default();
    let (a, sa) = spawn_device(&net);
    let (b, sb) = spawn_device(&net);

    // A legt ein Heft + Bild + Datei-Notiz an.
    let heft = a.create_heft("Vorlesung".into(), None, None).unwrap();
    let hp = a.heft_page_ids(heft.clone())[0].clone();
    let s_a = a
        .heft_add_stroke(
            heft.clone(),
            hp.clone(),
            "pen".into(),
            "#000".into(),
            3.0,
            vec![10.0, 10.0, 0.5, 90.0, 90.0, 0.5],
        )
        .unwrap();
    let png = vec![0x89, b'P', b'N', b'G', 10, 20, 30];
    let img_edit =
        a.heft_add_image(heft.clone(), hp.clone(), png.clone(), "image/png".into(), 50.0, 50.0, 100.0, 80.0).unwrap();
    let img_id = img_edit.ids[0].clone();

    let file_id = a.add_file(vec![42, 43, 44], "image/png".into(), "bild.png".into()).unwrap();
    let note = a.create_page("Mit Bild".into(), format!("![b]({file_id})"), None, None).unwrap();

    // A -> Server -> B
    let ra = sa.sync(false).unwrap();
    assert!(ra.sent > 0 && ra.files_uploaded == 1);
    let rb = sb.sync(false).unwrap();
    assert!(rb.received > 0 && rb.files_downloaded == 1);

    assert_eq!(b.file(file_id).unwrap().unwrap().bytes, vec![42, 43, 44]);
    assert_eq!(b.heft_image_data(heft.clone(), hp.clone(), img_id).unwrap().unwrap().bytes, png);

    // Gleichzeitige Striche auf derselben Heftseite von A und B: mergen konfliktfrei!
    let s_a2 = a
        .heft_add_stroke(
            heft.clone(),
            hp.clone(),
            "pen".into(),
            "#f00".into(),
            2.0,
            vec![200.0, 10.0, 0.5, 250.0, 50.0, 0.5],
        )
        .unwrap();
    let s_b = b
        .heft_add_stroke(
            heft.clone(),
            hp.clone(),
            "marker".into(),
            "#0f0".into(),
            4.0,
            vec![300.0, 10.0, 0.5, 350.0, 50.0, 0.5],
        )
        .unwrap();

    sa.sync(false).unwrap();
    let rb2 = sb.sync(false).unwrap();
    assert_eq!(rb2.conflicts, 0);
    sa.sync(false).unwrap();

    let strokes_a: HashSet<String> =
        a.heft_page(heft.clone(), hp.clone()).unwrap().strokes.into_iter().map(|s| s.id).collect();
    let strokes_b: HashSet<String> = b.heft_page(heft, hp).unwrap().strokes.into_iter().map(|s| s.id).collect();
    assert_eq!(strokes_a, HashSet::from([s_a, s_a2, s_b]));
    assert_eq!(strokes_a, strokes_b);
    assert!(b.page(note).is_some());
}

#[test]
fn sync_generationswechsel_mit_mehr_paketen_als_altem_cursor_panict_nicht() {
    // Regressionstest für Integer-Underflow in `SyncClient::pull` (`since - progress_start`),
    // wenn ein anderes Gerät die Cloud verdichtet/zurücksetzt und danach mehr Pakete liegen
    // als der alte `last_synced_seq` dieses Geräts.
    let net = MockNet::default();
    let (a, sa) = spawn_device(&net);
    let (b, sb) = spawn_device(&net);

    // 1) A lädt 1 Paket hoch, B holt es -> B hat `last_synced_seq == 1`, `generation == 1`.
    a.create_page("Start".into(), "A".into(), None, None).unwrap();
    sa.sync(false).unwrap();
    sb.sync(false).unwrap();
    assert_eq!(sb.status().last_synced_seq, 1);
    assert_eq!(sb.status().generation, 1);

    // 2) A verdichtet/setzt die Cloud zurück (generation -> 2) und lädt 3 getrennte Sync-Pakete hoch
    //    (max_seq = 3 > B's altem progress_start = 1).
    sa.compact_cloud(true).unwrap();
    a.create_page("Neu 1".into(), "Text 1".into(), None, None).unwrap();
    sa.sync(false).unwrap();
    a.create_page("Neu 2".into(), "Text 2".into(), None, None).unwrap();
    sa.sync(false).unwrap();
    a.create_page("Neu 3".into(), "Text 3".into(), None, None).unwrap();
    sa.sync(false).unwrap();

    // 3) B synchronisiert: muss Generationswechsel 1 -> 2 sauber übernehmen ohne Underflow-Panic!
    let rb = sb.sync(false).unwrap();
    assert!(rb.received > 0);
    assert_eq!(sb.status().generation, 2);
    assert_eq!(b.children_of(None, None).len(), 4);
}

#[test]
fn sync_netzausfall_und_wiederholung_bleibt_idempotent() {
    let net = MockNet::default();
    let (a, sa) = spawn_device(&net);
    let (b, sb) = spawn_device(&net);

    let p = a.create_page("Offline-Test".into(), "Inhalt".into(), None, None).unwrap();
    net.0.lock().unwrap().fail_next_posts = 1;

    // Erster Upload schlägt mit 503 (retryable) fehl.
    let err = sa.sync(false).unwrap_err();
    assert!(matches!(err, SyncFailure::Failed { status: Some(503), retryable: true, .. }));

    // Wiederholung gelingt und B erhält die Seite genau einmal.
    let ok = sa.sync(false).unwrap();
    assert!(ok.sent > 0 && ok.confirmed);
    sb.sync(false).unwrap();
    assert_eq!(b.children_of(None, None).len(), 1);
    assert_eq!(b.page(p).unwrap().content, "Inhalt");
}

#[test]
fn sync_falscher_schluessel_schlaegt_sauber_fehl() {
    let net = MockNet::default();
    let (a, sa) = spawn_device(&net);
    a.create_page("Geheim".into(), "Vertraulich".into(), None, None).unwrap();
    sa.sync(false).unwrap();

    let other_creds = SyncKey::parse("impala-ffff-eeee-dddd-cccc-bbbb-aaaa-9999-8888").unwrap().derive();
    let b = ImpalaCore::open_in_memory().unwrap();
    let sb = CloudSync::start(&b, net.clone(), other_creds, "https://worker.test/", None);
    let res = sb.sync(false);
    assert!(matches!(res, Err(SyncFailure::Failed { .. })));
    assert!(b.children_of(None, None).is_empty());
}

#[test]
fn refetch_all_setzt_zustand_vor_rueckkehr_sortiert_zurueck() {
    let net = MockNet::default();
    let (a, sa) = spawn_device(&net);
    let (b, sb) = spawn_device(&net);

    let p = a.create_page("Seite".into(), "Alt".into(), None, None).unwrap();
    sa.sync(false).unwrap();
    sb.sync(false).unwrap();

    // A schreibt ein älteres Event (Uhr zurückgestellt), B schreibt ein neueres Event lokal.
    a.set_clock_offset(60_000); // A liegt 60s zurück (offset = Gerät geht vor)
    a.update_page(p.clone(), Some("Alt von A".into()), None).unwrap();
    sa.sync(false).unwrap();

    thread::sleep(std::time::Duration::from_millis(5));
    b.update_page(p.clone(), Some("Neu von B".into()), None).unwrap();

    // B holt per `refetch_all` alles noch einmal ab: Wenn `refetch_all` zurückkehrt,
    // muss `settle_remote` bereits gelaufen sein (kein OutOfOrder beim sofortigen Checkpoint!).
    let report = sb.refetch_all().unwrap();
    assert!(report.fetched > 0);
    assert_eq!(b.page(p).unwrap().summary.title, "Neu von B");
    assert_ne!(
        b.save_checkpoint().unwrap(),
        CheckpointResult::OutOfOrder,
        "Nach refetch_all darf der Zustand nicht unsortiert (OutOfOrder) sein"
    );
}
