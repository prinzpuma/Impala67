# Impala67 – Rust-Kern & native Apps

Stand: 15.11.2026. Ablauf und Messwerte der Umstellung (Okt./Nov. 2026) stehen in der Git-Historie dieser Datei.

## Ziel und Stand

Ein gemeinsamer **Rust-Kern** (`core/`) enthält alle Logik; die Versionen liefern nur Oberflächen.

| Version | Anbindung | Stand |
|---|---|---|
| PWA | WASM (`core/impala-wasm` → `web/core/`, ≈ 2,4 MB) | vollständig auf Rust, kein JS-Rückfall |
| Android | UniFFI (`core/impala-ffi`, Kotlin) | Compose-App, ersetzt Capacitor; Lücken: `docs/PARITAET.md` |
| iPad | UniFFI (`core/impala-ffi`, Swift) | SwiftUI/PencilKit, läuft am Gerät (iPadOS 27); Lücken: `docs/PARITAET.md` |
| Windows/Linux | PWA | native Apps nur, wenn sie spürbar mehr bringen |

## Grundregeln

- **Neu schreiben, nicht übersetzen**: idiomatisches Rust (Typen, `enum`s, `Result`, reine Funktionen). Maßstab ist
  das Verhalten, nicht die JS-Struktur.
- **Formate byte-kompatibel**: Sync-Pakete, Verschlüsselung, Blob-Layout und IndexedDB-Daten lesen alte Daten und
  bleiben für ältere Versionen lesbar. Golden-Tests gegen das JS-Original (`core/tools/gen-golden-*.mjs`).
- **Rust only**: Umgestellte Bereiche laufen nur noch in Rust, die JS-Fassung wird gelöscht.
- **Kern ohne Ein-/Ausgabe** (Muster Crux): Der Kern rechnet und fragt die Plattform über asynchrone Traits
  (`HttpClient`, `SyncStore`, `DriveStore`, `TokenSource`, `ToolExecutor` …). Keine eigene Async-Laufzeit;
  nativ `impala_net::block_on`, parallele Anfragen über `impala_net::join_all`.
- **Fähigkeiten mit Standard**: Austauschbares hinter einem Trait mit Rust-Standard, Plattformen dürfen native
  Implementierungen einsetzen:

```
InkRecognizer  ONNX (ort)        | iOS: Vision · Android: ML Kit Digital Ink
Embedder       ONNX              | iOS: NLEmbedding
LlmProvider    API (reqwest)     | später: Apple Foundation Models, Gemini Nano
SecureStore    verschl. Datei    | Keychain · Android Keystore
Storage        SQLite            | Web: IndexedDB (Bestandsdaten!)
```

**Nicht** in den Kern: DOM/Rendering, Eingabe-Ereignisse, Plattform-UI.

## Aufbau `core/`

Ein Crate je Fachgebiet, Fassade `impala-core`, Regeln: `core/AGENT-REGELN.md`.

| Crate | Inhalt |
|---|---|
| `impala-model` | Zustand, Reducer, Laden/Reihenfolge, Checkpoints, merge3, Konflikte, Lernwarteschlange (`ModelCore`) |
| `impala-sync` | Protokoll v4: Wire-Format, Chunking, Pakete, `SyncClient`, Kompaktierung (Skill `cloudflare-sync-v4`) |
| `impala-crypto` | PBKDF2, AES-GCM-Pakete, Blob-Layout, `SecureStore` |
| `impala-storage` | `Storage`-Trait, SQLite, Export/Import, Checkpoints |
| `impala-drive` | Drive-Formate, API v3, Backup-Ablauf, Status-Regeln (`DriveCore`) |
| `impala-heft` | Dokument, `heftOps`, Diff, Geometrie, Lasso, Radierer, PDF/SVG |
| `impala-ink` | Handschrift-Vorverarbeitung, CTC-Beam-Search + Wörterbuch |
| `impala-scan` | Dokument-Scanner (Erkennung, Entzerrung) |
| `impala-search` | Chunking, Vektorsuche, RAG-Ranking, Unscharf-Suche |
| `impala-markdown` | Markdown ↔ Blöcke, Text-Helfer |
| `impala-srs` | FSRS-5 |
| `impala-fach` | Fach-Erkennung (nutzt bisher nur die iPad-App) |
| `impala-ai` | Anbieter, Stream-Parser, Agent-Schleife |
| `impala-net` | `HttpClient`-Trait, ureq-Standard, `block_on`, `join_all` |

**Hüllen**
- `impala-wasm`: dünn; JS reicht `fetch`, IndexedDB und localStorage herein und hält Timer/WebSocket. Die PWA liest
  über schreibgeschützte Ansichten (`web/state-views.js`), Hefte nur einzeln (`heftDoc`/`heftPage`).
- `impala-ffi`: hält Speicher (SQLite), Zustand, Suchindex und Uhr selbst; die App reicht nur den Datenbankpfad
  herein. Rückruf `ChangeListener` meldet Änderungen, `CloudSync`/`DriveSync` laufen auf eigenen Threads.
  Handschrift-Erkennung bleibt plattformnativ (nur der Text wird gespeichert).

**Bauen**
- WASM: `npm run build:core` (braucht `wasm32-unknown-unknown` und `wasm-bindgen-cli 0.2.129`). Die Ausgabe wird
  committet, damit der Deploy keine Rust-Toolchain braucht; `core/wasm-build.json` hält Hashes fest,
  `npm run check:core` (Teil von `verify`) schlägt bei vergessenem Neubau fehl.
- Android: `npm run build:android-core`. iPad: `npm run build:ios-core` (XCFramework nur auf dem macOS-Runner).

## Lehren zur WASM-Grenze

- WASM lohnt sich, wenn wenige grobe Aufrufe viel Rechenarbeit auslösen und Daten als Bytes oder typisierte Arrays
  wandern (RAG-Index, CTC, Heft-Gesten über `packStrokes`). Viele kleine Aufrufe kosten mehr, als sie sparen.
- Kein `serde-wasm-bindgen` für große Objekt-Bäume (zu langsam, zu groß); gezielter Zugriff über Traits.
- WebCrypto und `CompressionStream` sind im Browser schon schnell; WASM bringt dort Einheitlichkeit, kein Tempo.
- tract (reines Rust-ONNX) ist ~8× langsamer als ONNX Runtime → nativ Plattform-Erkenner oder `ort`.

## iPad-App

- **Heft: PencilKit zeichnet, der Kern speichert.** Eine durchsichtige `PKCanvasView` nimmt neue Striche auf; ein
  fertiger Strich geht als `[x, y, druck, …]` über `heft_apply` in den Kern. Angezeigt wird, was der Kern liefert
  (auch nach Sync). Radierer, Lasso, Formen und Rückgängig sind eigene Werkzeuge über den Kern, nicht die
  PencilKit-Werkzeuge. Papier und Bilder liegen als Ebene darunter.
- **Oberfläche**: `NavigationSplitView`, Liquid Glass; Apple Pencil Pro (Squeeze, Barrel Roll, Hover).
- **KI**: API-Anbieter über den Kern; Apple Foundation Models später als `LlmProvider`.
- **Ohne Mac**: Swift unter Windows schreiben; `ios-build.yml` baut auf dem macOS-Runner eine unsignierte `.ipa`,
  Installation per SideStore (7 Tage gültig, Auto-Refresh). Sync beim Öffnen und per `BGAppRefreshTask`.
