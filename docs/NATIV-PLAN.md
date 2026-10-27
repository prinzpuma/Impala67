# Impala67 – Plan: Rust-Kern & native Apps

Stand: 27. Oktober 2026

## Ziel

Langfristig native Apps für iPadOS/iOS, Android, Windows und Linux, alleine pflegbar. Weg dorthin:
ein gemeinsamer **Rust-Kern** übernimmt so viel Logik wie möglich, die Plattformen liefern nur dünne Oberflächen
und ersetzen Kern-Funktionen schrittweise durch native, wo es sich lohnt. Die PWA bleibt erhalten und nutzt denselben Kern (WASM).

## Grundregeln

- **Neu schreiben, nicht übersetzen**: Jedes Modul wird beim Umzug in idiomatischem Rust neu entworfen
  (klare Typen statt loser Objekte, `enum`s statt String-Flags, `Result` statt Ausnahmen, reine Funktionen ohne versteckten Zustand).
  Was sich als unnötig erweist, entfällt. Maßstab ist das Verhalten, nicht die JS-Struktur.
- **Formate bleiben byte-kompatibel**: Sync-Pakete, Verschlüsselung, Blob-Layout und IndexedDB-Daten müssen alte Daten
  lesen und von älteren App-Versionen lesbar bleiben. Jedes Modul bekommt Vergleichstests gegen die JS-Implementierung (Golden-Files).
- **Rust only**: Ein umgestellter Bereich läuft nur noch in Rust; die JS-Fassung wird gelöscht, es gibt keinen
  JS-Rückfall (Entscheidung 27. Oktober 2026). Die App bleibt nach jedem Bereich auslieferbar; der Umbau läuft auf
  einem eigenen Branch und geht nach `main`, wenn der Bereich im Browser geprüft ist.
- **Kern ohne Ein-/Ausgabe** (Muster von Crux): Der Kern rechnet nur und fragt die Plattform über asynchrone Traits
  (`HttpClient`, `SyncStore`, `DriveStore`, `TokenSource`, `ToolExecutor` …). Im Browser stecken `fetch`,
  IndexedDB und JS-Promises dahinter, auf iOS URLSession, auf Android OkHttp, nativ SQLite/ureq mit `block_on`.
  Der Kern bringt keine eigene Async-Laufzeit mit.
- **Fähigkeiten mit Standard-Implementierung**: Austauschbares liegt hinter einem Trait mit Rust-Standard;
  jede Plattform darf eine native Implementierung einsetzen, muss aber nicht.

```
InkRecognizer  Standard: ONNX-Modell (ort)  | iOS: Vision · Android: ML Kit Digital Ink
Embedder       Standard: ONNX               | iOS: NLEmbedding/Core ML · Windows: Windows ML
LlmProvider    Standard: API (reqwest)      | iOS: Foundation Models · Android: Gemini Nano
SecureStore    Standard: verschl. Datei     | Keychain · Keystore · DPAPI · libsecret
Storage        Standard: SQLite (rusqlite)  | Web: IndexedDB-Adapter (Bestandsdaten!)
```

## Was in den Kern gehört

Datenmodell & Events · Sync v4 (Envelopes, Chunking, Reihenfolge, Kompaktierung) · E2EE (PBKDF2 → AES-GCM, Blob-Layout) ·
Markdown-Parsing · Suche/RAG (Chunking, Vektorsuche, Ranking) · Heft-Geometrie (Glättung, Hit-Test, Radierer, Lasso, Export) ·
Handschrift-Dekodierung (CTC-Beam-Search + Wörterbuch) · FSRS · Drive-/KI-API-Logik.

**Nicht** in den Kern: DOM/Rendering, Eingabe-Ereignisse, Plattform-UI.

## Technik

- `core/` als Cargo-Workspace im selben Repo (Monorepo, gemeinsame Tests und Formate).
- Web: `wasm-bindgen`, Ausgabe als natives ES-Modul (`--target web`) – kein Bundler in `web/`.
  Neue Dateien in `APP_FILES` im Service Worker eintragen.
- Native Anbindung: **UniFFI** (Swift, Kotlin; C# über `uniffi-bindgen-cs`). Linux-UI direkt in Rust (`gtk-rs`, GTK4/libadwaita).
- Architekturvorbild: Crux (Kern = reine Logik, Shells zeichnen nur).

## Reihenfolge

1. ✅ **Spike**: `core/` angelegt, Event-Kompaktierung in Rust (Ergebnis siehe unten). Weil WASM hier langsamer
   als JS ist, bleibt die PWA bei JS; die Worker-Anbindung des Spikes wurde nicht übernommen.
2. ✅ **Ganze Nicht-UI-Logik als Rust-Kern** (27. Oktober 2026, Stand siehe unten). Die PWA ist noch nicht
   umgestellt; als WASM vorbereitet ist nur, was gemessen schneller ist (Suche/RAG, CTC-Dekodierung).
   Nächster Schritt: UniFFI-Schnittstelle (`impala-core`) und RAG-Index im PWA-Worker hinter Rückfall auf JS.
3. ✅ **Speicherschicht** im Kern (`impala-storage`, SQLite). Web behält IndexedDB (`web/db.js`).
3a. ✅ **Kern ohne eigene Ein-/Ausgabe** (27. Oktober 2026): `HttpClient` und alle Plattform-Traits in Sync, Drive
   und KI sind asynchron; Warten (Backoff) liefert die Plattform. Native Werkzeuge und Tests nutzen `impala_net::block_on`.
3b. ✅ **PWA-Sync läuft in Rust** (27. Oktober 2026): `SyncCore` (`core/impala-wasm/src/sync.rs`) führt den ganzen
   Cloudflare-Ablauf aus; `web/sync-cloudflare.js` reicht nur fetch, IndexedDB, localStorage und App-Zustand herein und
   hält Timer, WebSocket, Status. JS-Verschlüsselung, Paketbau, Chunking und Cursor-Logik sind gelöscht.
   Geprüft: `cargo test`, `test/sync.test.mjs` (Rust-Client gegen den echten Worker-Code) und die Browser-E2E-Suite
   (`npm run test:e2e`, 15/16 – die rote Prüfung meldet nur nicht erreichbare CDNs im Container).
   Offen: WASM-Größe (582 KB, 267 KB gzip, lädt erst beim Einrichten des Syncs),
   PBKDF2 (100 000 Runden) läuft beim Verbinden einmal im Hauptthread.
3c. ✅ **PWA-Drive-Backup läuft in Rust** (27. Oktober 2026): `DriveCore` (`core/impala-wasm/src/drive.rs`) führt den
   ganzen Durchgang aus (Dateiindex über die Changes-API, Snapshot + Änderungspakete, Dateien, Verdichten, Token-Bereinigung,
   Uhren-Drift, Wiederholungen bei 429/5xx); `web/drive.js` behält Anmeldung (Google-Popup), Timer, Web Lock und Status und
   reicht fetch, localStorage (dieselben Schlüssel wie bisher) und IndexedDB herein. JS-Paketbau, Dateiliste, gzip und
   Hash-Cache sind gelöscht. Alte Backups (v1-Snapshot, gzip-Deltas) und lokale Drive-Zustände werden weiter gelesen.
   In JS bleiben die synchronen Anzeige- und Timer-Regeln (`drive-status.js`, `drive-sync-policy.js`, `backup-status.js`),
   weil sie vor dem Laden des Kerns gebraucht werden; ihre Golden-Files (`rules.json`) erzeugt weiter
   `core/tools/gen-golden-drive.mjs`, `flows.json` ist eingefroren.
   Geprüft: `cargo test`, `DriveCore` in Node gegen eine nachgebaute Drive-API, `web/drive.js` in Chromium (zwei Geräte,
   v1-Altbestand, Bilder, Reload, abgelaufene Sitzung). Offen: WASM +90 KB
   (686 KB, 310 KB gzip), Test mit echtem Google-Konto (Login, resumable Upload ab 5 MB).
3d. ✅ **Dateien wieder parallel** (27. Oktober 2026): `impala_net::join_all` wartet ohne Laufzeit auf mehrere
   Anfragen (im Browser laufen die `fetch`-Aufrufe gleichzeitig, mit `block_on` nacheinander). Sync überträgt Dateien zu
   dritt, Drive lädt Snapshot/Deltas/Dateien zu sechst, lädt Dateien zu dritt hoch und löscht zu sechst – wie die
   frühere JS-Fassung. Große Dateien gehen häppchenweise, im Speicher liegen höchstens so viele wie gleichzeitig laufen.
3e. **Nächste Bereiche Rust only**: Suche/RAG im Worker, Handschrift-Dekodierung,
   lokale Kompaktierung (`compact-events.js`), KI-Anbieter (`impala-ai`), dann Datenmodell/Start (`impala-model`).
4. **iPad nativ** (SwiftUI + PencilKit) – größter Gewinn durch Stift-Latenz.
5. **Android nativ** (Compose + Jetpack Ink) – ersetzt die Capacitor-Hülle.
6. **Windows/Linux** – bis dahin PWA mit WASM-Kern; native Apps nur, wenn sie spürbar mehr bringen.

## Spike-Ergebnis (27. Oktober 2026)

**Aufbau**
- `core/impala-core`: reine Logik ohne Abhängigkeiten. Plattformen reichen ihre Werte über das Trait `JsLike` herein
  (JSON in Tests, `JsValue` in der PWA, später Swift/Kotlin-Objekte); der Kern fragt nur die Felder ab, die er braucht.
- `core/impala-wasm`: dünne `wasm-bindgen`-Hülle → `web/core/impala_core.js` + `impala_core_bg.wasm` (`--target web`, natives ES-Modul).
- `web/compact-core.js` lädt den Kern; `web/compact-worker.js` rechnet damit. Rückfall auf `compactEvents` (JS), wenn das
  Modul nicht lädt oder ein Event eine Form hat, die nur die JS-Regeln abdecken (der Kern lehnt dann ab, statt zu raten).
- Tests: `cargo test` in `core/` vergleicht mit Golden-Files aus dem JS-Original (`core/tools/gen-golden.mjs`, Grenzfälle +
  Zufalls-Logs); `node core/tools/bench.mjs` prüft zusätzlich 300 Zufalls-Logs Rust gegen JS und misst die Laufzeit.

**WASM-Ausgabe wird committet** (nicht in `deploy-pwa.yml` gebaut): Ein Push auf `main` geht sofort live – der Deploy soll
keine Rust-Toolchain brauchen, die Capacitor-Hülle kopiert `web/` unverändert, und der Dev-Server läuft ohne Rust.
Gegen vergessene Neubauten hält `core/wasm-build.json` Hashes von Quellen und Ausgabe fest; `npm run check:core`
(Teil von `verify`, also auch im Deploy) schlägt fehl, wenn sie nicht passen. Lokal bauen: `npm run build:core`
(braucht `rustup target add wasm32-unknown-unknown` und `cargo install wasm-bindgen-cli --version 0.2.129 --locked`).

**Messwerte** (Node 22 bzw. Chromium, realistisches Log mit 3 KB Inhalt je Seiten-Patch)
- Größe: `.wasm` 50,5 KB (21 KB gzip), Glue-JS 11 KB. Erster Entwurf mit `serde-wasm-bindgen`: 112 KB.
- Laufzeit reine Kompaktierung: 10 000 Events JS 6 ms / WASM 14 ms; 100 000 Events JS 52 ms / WASM 155–170 ms.
  Rust nativ ohne Grenze: 29 ms für 100 000 Events.
- Die Zeit steckt in der JS↔WASM-Grenze (mehrere Aufrufe je Event, Strings kopieren), nicht in der Logik.
  Erster Entwurf mit generischem serde-Decoder: 580 ms.
- Im Worker zählt das kaum: Ein Lauf über 20 000 Events dauert in Chromium ~1,4 s – fast alles IndexedDB
  (`getAll`, Löschen), mit WASM wie mit JS gleich lang.
- Chromium: WASM lädt im Worker (`application/wasm`), Ergebnis identisch, Rückfall bei blockierter `.wasm` greift.
  Android-WebView ist dieselbe Engine; auf einem echten Gerät noch nicht geprüft. Der Glue fällt bei falschem
  MIME-Typ selbst auf `WebAssembly.instantiate` zurück; WebViews ohne Reference-Types/Bulk-Memory nehmen JS.

**Lehren für Schritt 2**
- Tempo gewinnt WASM in der PWA nur, wenn wenige grobe Aufrufe viel Rechenarbeit auslösen und Daten als Bytes oder
  typisierte Arrays wandern (CTC-Logits, Embedding-Vektoren). Für Logik über viele kleine JS-Objekte ist V8 schon schnell.
- Die Kompaktierung wird erst schneller, wenn die Events gar nicht mehr über die Grenze müssen (Speicherschicht im Kern, Schritt 3).
- Kein `serde-wasm-bindgen` für große Objekt-Bäume: zu langsam und zu groß. Gezielter Zugriff über ein Trait hält den Kern
  zudem plattformneutral – dasselbe Muster passt für UniFFI.

## Stand Rust-Kern (27. Oktober 2026)

Workspace `core/`: ein Crate je Fachgebiet, Fassade `impala-core`, WASM-Hülle `impala-wasm`. Regeln für Arbeiten
daran: `core/AGENT-REGELN.md`. Jedes Crate hat Golden-Tests aus dem JS-Original (`core/tools/gen-golden-*.mjs`).
Gesamt: 242 Tests grün, `cargo clippy -D warnings` sauber, alles außer ONNX/SQLite/HTTP baut für wasm32.

| Crate | Inhalt | Rust nativ vs. JS |
|---|---|---|
| `impala-crypto` | PBKDF2, AES-GCM-Pakete, Blob-Layout byte-gleich; `SecureStore` (verschl. Tresor) | Einheitlichkeit, kein Tempo (WebCrypto) |
| `impala-sync` | Protokoll v4: Wire-Format, Chunking, Pakete, Worker-API, `SyncClient`, Kompaktierung | Paketbau ~2,5×, Kompaktierung ≈ gleich |
| `impala-storage` | `Storage`-Trait, SQLite + Speicher, exportAll/importAll, Checkpoints 1–3 | Lesen ~2× (gegen fake-indexeddb) |
| `impala-model` | Zustand, Reducer (46 Typen), Laden/Reihenfolge, merge3, Konflikte, Lernwarteschlange | Replay 100 000 Events 2,5–3× |
| `impala-heft` | Dokument, heftOps, Diff, Geometrie, Lasso, Radierer, PDF (byte-gleich), SVG neu | 2–6× |
| `impala-ink` | Vorverarbeitung, Rasterung, CTC-Beam-Search + Wörterbuch, `InkRecognizer` | Dekodieren ~4× |
| `impala-search` | Chunking, Vektorsuche, RAG-Ranking, Unscharf-Suche, `Embedder` (ONNX optional) | Vektor 5×, RAG-Anfrage 20× (Index) |
| `impala-markdown` | Markdown ↔ Blöcke, Text-Helfer | parse 2×, serialize 8× |
| `impala-srs` | FSRS-5 | – |
| `impala-ai` | Anbieter, Anfragen, Stream-Parser, Agent-Schleife, `LlmProvider`, `ToolExecutor` | netzgebunden |
| `impala-drive` | Drive-Formate, API v3, Backup-Ablauf, Status-Regeln | netzgebunden |
| `impala-net` | `HttpClient`-Trait, ureq-Standard | – |

**WASM in der PWA** (Node, gleiche Ergebnisse geprüft, `node core/tools/bench-wasm.mjs`):

| Messung | JS | WASM | Entscheidung |
|---|---|---|---|
| RAG-Anfrage 20 000 Chunks | 463 ms | 48 ms (+0,6 s einmaliger Indexbau) | Binding vorbereitet; lohnt sich |
| Vektorsuche 20 000 × 384, Top-10 | 15–35 ms | 10 ms | Binding vorbereitet |
| CTC-Dekodierung 10 Zeilen + Wörterbuch | 24–29 ms | 20–22 ms | Binding vorbereitet, allein keine Umstellung |
| Heft-Treffer-Test/Lasso/Radierer | 1,5–2,3× langsamer | – | verworfen: < 1 ms je Ereignis, doppelter Zustand |
| Markdown parse/serialize | 11 / 6 ms | 15–31 / 12–18 ms | verworfen: JSON über die Grenze |
| Kompaktierung 100 000 Events | 52 ms | 155–170 ms | verworfen (Spike) |

`.wasm` mit Kompaktierung, Suche und Dekodierung: 277 KB (117 KB gzip). `opt-level 3` wäre 15–25 % schneller, aber ~30 % größer.

**Grenzen**: tract (reines Rust-ONNX) ist ~8× langsamer als ONNX Runtime → für native Apps Plattform-Erkenner
(Vision, ML Kit) oder `ort`. Das Bekko-Embedding-Modell war im Container nicht ladbar, Ende-zu-Ende ungeprüft.
Rust-Code ist meist 1,5–2× länger als das JS (Typen, Doku, JS-genaue Zahlen-/Text-Semantik).

## iOS ohne Mac

- Swift unter Windows schreiben (VS Code + Swift-Erweiterung); kein Simulator, keine SwiftUI-Vorschau.
- Build über GitHub Actions (macOS-Runner, `xcodebuild`) → unsignierte `.ipa` als Artefakt.
- Installation mit kostenloser Apple-ID über **AltStore**, **SideStore** oder **Sideloadly**
  (7 Tage gültig, max. 3 Apps, kein iCloud/Push).
- Später sinnvoll: gebrauchter Mac mini (M1) für schnelle Iterationen.

## Nutzen für die PWA

- **Ja**: rechenintensive Teile (Replay/Kompaktierung beim Start, Vektorsuche, CTC-Beam-Search, Heft-Geometrie)
  im Worker; eine einzige, getestete Sync-Implementierung für alle Geräte; strengere Typen fangen Fehler früher.
- **Nein / Vorsicht**: WebCrypto und `CompressionStream` sind schon nativ schnell – Krypto in WASM bringt dort
  Einheitlichkeit, keine Geschwindigkeit. WASM vergrößert den Download (Größe im Blick behalten);
  viele kleine Aufrufe über die JS↔WASM-Grenze kosten Zeit; DOM-nahe Logik bleibt in JS.
