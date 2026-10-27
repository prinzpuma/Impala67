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
- **Schrittweise (Strangler)**: Immer nur ein JS-Modul ersetzen; die App bleibt nach jedem Schritt auslieferbar.
  Kein langlebiger Umbau-Branch – kurze Branches pro Schritt, oft nach `main` mergen.
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

1. ✅ **Spike**: `core/` angelegt, Event-Kompaktierung in Rust, läuft als WASM im Kompaktierungs-Worker
   (Ergebnis siehe unten).
2. **Reine Logik in den Kern, PWA nutzt sie** – zuerst, was rechenintensiv ist und über Bytes/typisierte
   Arrays mit JS spricht: CTC-Dekodierung → RAG-Ranking/Vektorsuche → FSRS → Sync-Formate & -Krypto
   (Einheitlichkeit für native Apps, kein Tempo-Gewinn in der PWA) → Event-Reihenfolge → Markdown.
3. **Speicherschicht** (SQLite im Kern; Web behält IndexedDB über Adapter, Migration ohne Datenverlust).
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
