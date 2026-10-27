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

1. **Spike** (Wegwerf-Branch): `core/` anlegen, ein reines Modul in Rust, als WASM aus der PWA aufrufen.
   Klärt: Build ohne Bundler, Service-Worker-Cache, Capacitor, CI (`deploy-pwa.yml`), Paketgröße.
2. **Reine Logik in den Kern, PWA nutzt sie**: Sync-Krypto & -Formate → Event-Reihenfolge/Kompaktierung →
   RAG-Ranking → CTC-Dekodierung → FSRS → Markdown.
3. **Speicherschicht** (SQLite im Kern; Web behält IndexedDB über Adapter, Migration ohne Datenverlust).
4. **iPad nativ** (SwiftUI + PencilKit) – größter Gewinn durch Stift-Latenz.
5. **Android nativ** (Compose + Jetpack Ink) – ersetzt die Capacitor-Hülle.
6. **Windows/Linux** – bis dahin PWA mit WASM-Kern; native Apps nur, wenn sie spürbar mehr bringen.

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
