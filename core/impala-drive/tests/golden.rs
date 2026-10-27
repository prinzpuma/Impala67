//! Vergleich mit dem JS-Original:
//! - `flows.json` (eingefroren; letzte JS-Fassung von `web/drive.js`, seitdem läuft der Ablauf nur
//!   noch im Kern): ganze Abläufe gegen eine nachgebaute Drive-API. Rust muss dieselben Anfragen
//!   (Methode, URL, Header, Metadaten, Dateiinhalt nach gunzip) stellen, dasselbe einspielen und
//!   denselben `localStorage`-Zustand hinterlassen. Die aufgezeichneten Antworten werden abgespielt.
//! - `rules.json` (aus `core/tools/gen-golden-drive.mjs`): Intervalle, Status- und Backup-Anzeige,
//!   Aktionsknopf – Regeln, die in der PWA weiter in JS laufen.
//!
//! Bewusste Abweichungen (im Code kommentiert) sind hier als Ausnahmen markiert:
//! - Deltas ohne lokale Marken (`seq`, `_remote`, `_remoteSource`, `_derived`),
//! - Alt-Blob-Dateien ohne `blobId` werden über den Hash-Cache erkannt statt erneut geladen.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};

use impala_crypto::json::stringify;
use impala_crypto::{CryptoError, Random, base64_decode, base64_encode, gunzip};
use impala_drive::state::DriveState;
use impala_drive::store::{DriveStore, ImportOutcome, LocalBlob, StoreError};
use impala_drive::{Clock, DriveBackup, DriveError, DriveOptions, TokenSource, policy, status};
use impala_net::{HttpClient, NetError, Request, Response, block_on};
use impala_storage::event::{redact_secrets, strip_local_flags};
use serde_json::{Map, Value, json};

fn golden(name: &str) -> Value {
    let path = format!("{}/tests/golden/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn s(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}

/// `"exportedAt":"…"` → `"exportedAt":""` (Zeitstempel hängen an der Anzahl der `U.now()`-Aufrufe).
fn no_exported_at(text: &str) -> String {
    const KEY: &str = "\"exportedAt\":\"";
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find(KEY) {
        out.push_str(&rest[..i + KEY.len()]);
        let after = &rest[i + KEY.len()..];
        let end = after.find('"').unwrap_or(after.len());
        rest = &after[end..];
    }
    out.push_str(rest);
    out
}

fn normalize_header(name: &str, value: &str) -> (String, String) {
    match value.find("boundary=") {
        Some(i) => (name.to_owned(), format!("{}B", &value[..i + "boundary=".len()])),
        None => (name.to_owned(), value.to_owned()),
    }
}

// ---- Abspielen der aufgezeichneten Drive-Antworten ------------------------------------

struct Exchange {
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Value,
    response: Response,
}

#[derive(Default)]
struct Replay {
    pending: Mutex<Vec<Exchange>>,
    errors: Mutex<Vec<String>>,
}

/// Inhalt eines Multipart-Uploads: Metadaten-Text und Datei (nach gunzip) als Text.
fn split_multipart(req: &Request) -> Option<(String, String)> {
    let ct = req.headers.iter().find(|(k, _)| k == "Content-Type")?.1.clone();
    let boundary = ct.split("boundary=").nth(1)?;
    let body = String::from_utf8_lossy(&req.body).into_owned();
    let head = format!("--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n");
    let sep = format!("\r\n--{boundary}\r\nContent-Type: application/octet-stream\r\n\r\n");
    let bytes = &req.body;
    let start = head.len();
    let mid = body.find(&sep)?;
    let tail = format!("\r\n--{boundary}--");
    let meta = String::from_utf8(bytes[start..mid].to_vec()).ok()?;
    let content = &bytes[mid + sep.len()..bytes.len() - tail.len()];
    let m: Value = serde_json::from_str(&meta).ok()?;
    let content = if m["appProperties"]["encoding"] == "gzip" { gunzip(content).ok()? } else { content.to_vec() };
    Some((meta, no_exported_at(&String::from_utf8(content).ok()?)))
}

/// JS-Dateiinhalt mit der Delta-Ausnahme: lokale Marken fallen weg.
fn expected_content(js: &str) -> String {
    let Ok(mut v) = serde_json::from_str::<Value>(js) else { return js.to_owned() };
    if v.get("version") == Some(&json!(2))
        && let Some(events) = v.get_mut("events").and_then(Value::as_array_mut)
    {
        for ev in events.iter_mut() {
            if let Value::Object(o) = ev {
                *ev = Value::Object(strip_local_flags(std::mem::take(o)));
            }
        }
        return stringify(&v);
    }
    js.to_owned()
}

impl Replay {
    fn new(exchanges: &[Value], skip: &[&str]) -> Replay {
        let pending = exchanges
            .iter()
            .filter(|x| !skip.contains(&s(&x["request"]["url"])))
            .map(|x| {
                let req = &x["request"];
                let res = &x["response"];
                let body = match (res.get("text"), res.get("b64")) {
                    (_, Some(b)) => base64_decode(s(b)).unwrap(),
                    (Some(Value::String(t)), _) => t.as_bytes().to_vec(),
                    _ => Vec::new(),
                };
                Exchange {
                    method: s(&req["method"]).to_owned(),
                    url: s(&req["url"]).to_owned(),
                    headers: req["headers"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|h| normalize_header(s(&h[0]), s(&h[1])))
                        .collect(),
                    body: req["body"].clone(),
                    response: Response {
                        status: res["status"].as_u64().unwrap() as u16,
                        headers: res["headers"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .map(|h| (s(&h[0]).to_owned(), s(&h[1]).to_owned()))
                            .collect(),
                        body,
                    },
                }
            })
            .collect();
        Replay { pending: Mutex::new(pending), errors: Mutex::default() }
    }

    fn matches(ex: &Exchange, req: &Request) -> Result<(), String> {
        if ex.method != req.method.as_str() || ex.url != req.url {
            return Err(format!("{} {}", req.method.as_str(), req.url));
        }
        let headers: Vec<(String, String)> = req.headers.iter().map(|(k, v)| normalize_header(k, v)).collect();
        if headers != ex.headers {
            return Err(format!("Header {headers:?} statt {:?}", ex.headers));
        }
        match ex.body.get("multipart") {
            None if ex.body.is_null() && req.body.is_empty() => Ok(()),
            None => Err("Körper unerwartet".into()),
            Some(mp) => {
                let (meta, content) = split_multipart(req).ok_or("Multipart unlesbar")?;
                if meta != s(&mp["meta"]) {
                    return Err(format!("Metadaten {meta} statt {}", mp["meta"]));
                }
                let want = expected_content(s(&mp["content"]));
                if content != want { Err(format!("Inhalt\n{content}\nstatt\n{want}")) } else { Ok(()) }
            }
        }
    }

    fn finish(&self) -> Vec<String> {
        let mut errors = self.errors.lock().unwrap().clone();
        for ex in self.pending.lock().unwrap().iter() {
            errors.push(format!("nicht gestellt: {} {}", ex.method, ex.url));
        }
        errors
    }
}

struct Net(Arc<Replay>);

impl HttpClient for Net {
    async fn send(&self, req: &Request) -> Result<Response, NetError> {
        let mut pending = self.0.pending.lock().unwrap();
        // Parallele Uploads (mapLimit) dürfen in JS die Reihenfolge tauschen: kleines Fenster.
        let window = pending.len().min(4);
        let mut why = Vec::new();
        for i in 0..window {
            match Replay::matches(&pending[i], req) {
                Ok(()) => return Ok(pending.remove(i).response),
                Err(e) => why.push(e),
            }
        }
        self.0.errors.lock().unwrap().push(format!(
            "unerwartet {} {}: {}",
            req.method.as_str(),
            req.url,
            why.join(" | ")
        ));
        Err(NetError::Other("unerwartete Anfrage".into()))
    }
}

// ---- Nachbau der DB-Attrappe des Generators -------------------------------------------

#[derive(Default)]
struct MockStore {
    state: DriveState,
    events: Vec<Map<String, Value>>,
    last_seq: u64,
    blobs: BTreeMap<String, LocalBlob>,
    imports: Vec<Value>,
    puts: Vec<Value>,
}

impl DriveStore for MockStore {
    async fn load_state(&self) -> Result<DriveState, StoreError> {
        Ok(self.state.clone())
    }
    async fn save_state(&mut self, state: &DriveState) -> Result<(), StoreError> {
        self.state = state.clone();
        Ok(())
    }
    async fn max_seq(&self) -> Result<u64, StoreError> {
        Ok(self.last_seq)
    }
    async fn events_between(&self, after: u64, up_to: u64) -> Result<Vec<Value>, StoreError> {
        let seq = |e: &Map<String, Value>| e["seq"].as_u64().unwrap();
        Ok(self.events.iter().filter(|e| seq(e) > after && seq(e) <= up_to).cloned().map(Value::Object).collect())
    }
    async fn import(&mut self, mut payload: Value, unsynced: u64, _allow: bool) -> Result<ImportOutcome, StoreError> {
        payload["exportedAt"] = json!("");
        self.imports.push(json!({ "unsyncedAfterSeq": unsynced, "data": payload }));
        let mut out = ImportOutcome::default();
        for ev in payload["events"].as_array().unwrap() {
            let Some(o) = ev.as_object() else { continue };
            if self.events.iter().any(|e| e.get("id") == o.get("id")) {
                continue;
            }
            let mut c = o.clone();
            c.shift_remove("seq");
            c.insert("_remote".into(), json!(true));
            c.insert("_remoteSource".into(), json!("drive"));
            self.last_seq += 1;
            c.insert("seq".into(), json!(self.last_seq));
            out.imported.push(Value::Object(c.clone()));
            self.events.push(c);
            out.added += 1;
        }
        for (k, v) in payload["blobs"].as_object().unwrap() {
            if impala_storage::checkpoint::is_checkpoint_key(k) || self.blobs.contains_key(k) {
                continue;
            }
            let data = base64_decode(s(&v["b64"])).unwrap();
            self.blobs.insert(k.clone(), LocalBlob { meta: v.get("meta").cloned().unwrap_or(Value::Null), data });
        }
        Ok(out)
    }
    async fn export_snapshot(&self, redact: bool, _at: &str) -> Result<String, StoreError> {
        let events: Vec<Value> = self
            .events
            .iter()
            .map(|e| strip_local_flags(e.clone()))
            .filter_map(|e| if redact { redact_secrets(e) } else { Some(e) })
            .map(Value::Object)
            .collect();
        Ok(stringify(&json!({"app": "impala67", "version": 1, "exportedAt": "", "events": events, "blobs": {}})))
    }
    async fn blob_ids(&self) -> Result<Vec<String>, StoreError> {
        Ok(self.blobs.keys().cloned().collect())
    }
    async fn get_blob(&self, id: &str) -> Result<Option<LocalBlob>, StoreError> {
        Ok(self.blobs.get(id).cloned())
    }
    async fn put_blob(&mut self, id: &str, blob: LocalBlob) -> Result<(), StoreError> {
        self.puts.push(json!({"id": id, "b64": base64_encode(&blob.data), "meta": blob.meta}));
        self.blobs.insert(id.to_owned(), blob);
        Ok(())
    }
}

struct Tokens {
    token: Option<String>,
    expired: Mutex<bool>,
}

impl TokenSource for Tokens {
    async fn access_token(&self) -> Option<String> {
        self.token.clone()
    }
    async fn expired(&self) {
        *self.expired.lock().unwrap() = true;
    }
}

struct FixedClock {
    now: f64,
    sleeps: Arc<Mutex<Vec<u64>>>,
}

impl Clock for FixedClock {
    fn now_ms(&self) -> f64 {
        self.now
    }
    async fn sleep_ms(&self, ms: u64) {
        self.sleeps.lock().unwrap().push(ms);
    }
}

/// Jitter 0,5 wie `Math.random = () => 0.5` im Generator.
struct Half;

impl Random for Half {
    fn fill(&self, buf: &mut [u8]) -> Result<(), CryptoError> {
        buf.fill(0x80);
        Ok(())
    }
}

/// `localStorage` der Drive-Schlüssel, vergleichbar gemacht (JSON geparst, leere Listen weg,
/// Anmelde-Schlüssel gehören der Plattform).
fn comparable_ls(entries: impl IntoIterator<Item = (String, String)>) -> BTreeMap<String, Value> {
    entries
        .into_iter()
        .filter(|(k, _)| !k.ends_with("_token") && !k.ends_with("_token_expiry"))
        .filter(|(_, v)| v != "[]" && v != "{}")
        .map(|(k, v)| {
            let parsed = if k.ends_with("file_index") || k.ends_with("known_deltas") || k.ends_with("upload_hashes") {
                serde_json::from_str(&v).unwrap()
            } else {
                Value::String(v)
            };
            (k, parsed)
        })
        .collect()
}

fn ls_of(v: &Value) -> HashMap<String, String> {
    v.as_object().unwrap().iter().map(|(k, v)| (k.clone(), s(v).to_owned())).collect()
}

#[test]
fn flows_match_js() {
    let g = golden("flows.json");
    let now = g["fixedNow"].as_f64().unwrap();
    let mut failures = Vec::new();
    for case in g["cases"].as_array().unwrap() {
        let name = s(&case["name"]);
        // Ausnahme: Alt-Blob-Datei ohne blobId, deren Hash der Cache schon kennt.
        let skip: &[&str] =
            if name == "folge-sync" { &["https://www.googleapis.com/drive/v3/files/f007?alt=media"] } else { &[] };
        let replay = Arc::new(Replay::new(case["exchanges"].as_array().unwrap(), skip));
        let before = &case["before"];
        let ls = ls_of(&before["ls"]);
        let mut store = MockStore { state: DriveState::from_kv(|k| ls.get(k).cloned()), ..Default::default() };
        for ev in before["events"].as_array().unwrap() {
            store.last_seq = store.last_seq.max(ev["seq"].as_u64().unwrap());
            store.events.push(ev.as_object().unwrap().clone());
        }
        for (k, v) in before["blobs"].as_object().unwrap() {
            let meta = v.get("meta").cloned().unwrap_or(Value::Null);
            store.blobs.insert(k.clone(), LocalBlob { meta, data: base64_decode(s(&v["b64"])).unwrap() });
        }
        let token_ok =
            ls.get("impala67_drive_token_expiry").and_then(|e| e.parse::<f64>().ok()).is_some_and(|e| now < e);
        let tokens =
            Tokens { token: ls.get("impala67_drive_token").filter(|_| token_ok).cloned(), expired: Mutex::new(false) };
        let sleeps = Arc::new(Mutex::new(Vec::new()));
        let mut backup =
            DriveBackup::new(Net(replay.clone()), tokens, store, FixedClock { now, sleeps: sleeps.clone() })
                .with_rng(Box::new(Half))
                .with_options(DriveOptions { allow_secrets: case["allowSecrets"].as_bool().unwrap() });

        let mut check = |what: &str, ok: bool, detail: String| {
            if !ok {
                failures.push(format!("[{name}] {what}: {detail}"));
            }
        };
        let (result, error): (Value, Option<String>) = match s(&case["op"]) {
            "sync" => {
                let mut statuses = Vec::new();
                match block_on(backup.sync(&mut |p| statuses.push(p.label()))) {
                    Ok(r) => {
                        statuses.push(r.label().to_owned());
                        let v = json!({"imported": r.imported, "uploaded": r.uploaded, "conflicts": r.conflicts.len(),
                            "merged": r.merged.len(), "statuses": statuses});
                        (v, None)
                    }
                    Err(e) => (Value::Null, Some(e.to_string())),
                }
            }
            "flush" => match block_on(backup.flush_upload()) {
                Ok(_) => (Value::Null, None),
                Err(e) => (Value::Null, Some(e.to_string())),
            },
            "storage" => match block_on(backup.storage_info()) {
                Ok(Some(i)) => {
                    (json!({"appBytes": i.app_bytes, "usedBytes": i.used_bytes, "limitBytes": i.limit_bytes}), None)
                }
                Ok(None) => (Value::Null, None),
                Err(e) => (Value::Null, Some(e.to_string())),
            },
            op => panic!("unbekannte Operation {op}"),
        };
        let want_error = case["error"].as_str().map(str::to_owned);
        check("Fehler", error == want_error, format!("{error:?} statt {want_error:?}"));
        let num_eq = |a: &Value, b: &Value| a == b || a.as_f64().zip(b.as_f64()).is_some_and(|(x, y)| x == y);
        let same_result = match (&result, &case["result"]) {
            (Value::Object(a), Value::Object(b)) => a.len() == b.len() && a.iter().all(|(k, v)| num_eq(v, &b[k])),
            (a, b) => a == b,
        };
        check("Ergebnis", same_result, format!("{result} statt {}", case["result"]));
        for e in replay.finish() {
            check("Anfrage", false, e);
        }
        let store = backup.store();
        check(
            "Importe",
            Value::Array(store.imports.clone()) == case["imports"],
            format!("{:?}\nstatt\n{}", store.imports, case["imports"]),
        );
        let mut puts = store.puts.clone();
        puts.sort_by(|a, b| s(&a["id"]).cmp(s(&b["id"])));
        check("Blobs", Value::Array(puts.clone()) == case["puts"], format!("{puts:?} statt {}", case["puts"]));
        let rust_ls = comparable_ls(store.state.to_kv().into_iter().filter_map(|(k, v)| Some((k.to_owned(), v?))));
        let js_ls = comparable_ls(ls_of(&case["after"]["ls"]));
        check("Zustand", rust_ls == js_ls, format!("\n{rust_ls:?}\nstatt\n{js_ls:?}"));
        let want_sleeps: Vec<u64> = case["sleeps"].as_array().unwrap().iter().map(|x| x.as_u64().unwrap()).collect();
        let got_sleeps = sleeps.lock().unwrap().clone();
        check("Wartezeiten", got_sleeps == want_sleeps, format!("{got_sleeps:?}"));
        let offset = case["after"]["clockOffsetMs"].as_f64().unwrap();
        // Ohne eine einzige Antwort (Flush mit Fehlern) bleibt der Versatz des Moduls in JS stehen.
        if !case["exchanges"].as_array().unwrap().is_empty() {
            check(
                "Uhr-Versatz",
                backup.clock_offset_ms() == offset,
                format!("{} statt {offset}", backup.clock_offset_ms()),
            );
        }
        let renewal = s(&case["after"]["status"]) == "renewal-required";
        let expired = *backup.tokens().expired.lock().unwrap();
        check("Sitzung", expired == renewal, format!("abgelaufen = {renewal} erwartet"));
    }
    assert!(failures.is_empty(), "{} Abweichung(en):\n{}", failures.len(), failures.join("\n\n"));
}

#[test]
fn rules_match_js() {
    let g = golden("rules.json");
    for c in g["intervals"].as_array().unwrap() {
        let input = Some(&c["input"]).filter(|v| !v.is_null());
        assert_eq!(policy::sync_minutes(input), c["minutes"].as_u64().unwrap() as u32, "{c}");
        assert_eq!(policy::sync_interval_ms(input), c["ms"].as_u64().unwrap(), "{c}");
    }
    for c in g["afterChange"].as_array().unwrap() {
        assert_eq!(policy::sync_after_change(Some(&c["input"])), c["result"].as_bool().unwrap(), "{c}");
    }
    for c in g["authState"].as_array().unwrap() {
        let r = status::auth_state(c["tokenValid"].as_bool().unwrap(), c["sessionKnown"].as_bool().unwrap());
        assert_eq!(r.as_str(), s(&c["result"]));
    }
    let auth = |x: &str| match x {
        "disconnected" => status::AuthState::Disconnected,
        "connecting" => status::AuthState::Connecting,
        "connected" => status::AuthState::Connected,
        _ => status::AuthState::RenewalRequired,
    };
    let ui = |x: &str| match x {
        "idle" => status::UiState::Idle,
        "syncing" => status::UiState::Syncing,
        "waiting" => status::UiState::Waiting,
        "ok" => status::UiState::Ok,
        _ => status::UiState::Error,
    };
    for c in g["statusView"].as_array().unwrap() {
        let i = &c["input"];
        let sync = status::SyncUi {
            state: ui(s(&i["syncState"])),
            label: s(&i["label"]).into(),
            detail: s(&i["detail"]).into(),
        };
        let v = status::status_view(auth(s(&i["authState"])), &sync, i["online"].as_bool().unwrap(), s(&i["email"]));
        let r = &c["result"];
        assert_eq!(
            (v.state.as_str(), v.label.as_str(), v.detail.as_str()),
            (s(&r["state"]), s(&r["label"]), s(&r["detail"])),
            "{c}"
        );
    }
    for c in g["backupView"].as_array().unwrap() {
        let (level, since) = status::backup_view(
            c["hasChannel"].as_bool().unwrap(),
            c["unsafeSince"].as_str(),
            c["now"].as_f64().unwrap(),
        );
        assert_eq!(level.as_str(), s(&c["result"]["level"]), "{c}");
        assert_eq!(since.as_deref(), c["result"]["since"].as_str(), "{c}");
    }
    for c in g["actionState"].as_array().unwrap() {
        let (action, label) = status::action_state(
            c["hasClient"].as_bool().unwrap(),
            c["connected"].as_bool().unwrap(),
            c["needsLogin"].as_bool().unwrap(),
        );
        assert_eq!(label, s(&c["result"]["label"]), "{c}");
        assert_eq!(action == status::DriveAction::Setup, s(&c["result"]["action"]) == "setup");
    }
}

#[test]
fn session_errors_display_like_js() {
    assert_eq!(DriveError::SessionExpired.to_string(), "Google-Sitzung abgelaufen – bitte erneut synchronisieren.");
}
