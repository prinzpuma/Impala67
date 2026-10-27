# Regeln für Arbeiten am Rust-Kern (`core/`)

Gilt für alle, die ein Crate unter `core/` schreiben (auch Subagents). Projektweite Regeln: `AGENTS.md`, `CLAUDE.md`, Plan: `docs/NATIV-PLAN.md`.

## Ziel
Die Nicht-UI-Logik der App (heute JS in `web/`) wird als Rust-Kern neu geschrieben, damit native Apps (Swift/Kotlin über UniFFI, Windows, Linux) und später die PWA (WASM) ihn nutzen. DOM, Eingabe-Ereignisse und Rendering bleiben in JS.

## Grundsätze
- **Neu schreiben, nicht übersetzen**: idiomatisches Rust, klare Typen statt loser Objekte, `enum`s statt String-Flags, `Result` statt Ausnahmen, reine Funktionen ohne versteckten Zustand. Unnötiges weglassen. Maßstab ist das **Verhalten**, nicht die JS-Struktur.
- **Vorher lesen**: das JS-Original vollständig samt **aller Aufrufer** (`grep` über `web/`, `server/`, `test/`), damit klar ist, welches Verhalten zählt und was ungenutzt ist.
- **Byte-/Verhaltenskompatibilität**: Sync-Formate, Verschlüsselung, Blob-Layout, gespeicherte Daten (IndexedDB-Inhalte, Checkpoints, Drive-Dateien) müssen mit der JS-Version austauschbar bleiben – Rust liest, was JS schreibt, und umgekehrt.
- **Golden-Tests**: Jedes Crate bekommt `cargo test`-Vergleichstests gegen Golden-Files, die aus der **JS-Implementierung** erzeugt werden. Generator als `node`-Skript `core/tools/gen-golden-<crate>.mjs` (ohne `impala-`, z. B. `gen-golden-crypto.mjs`), Ausgabe nach `core/impala-<crate>/tests/golden/`. Generator importiert die echten Module aus `web/` (Browser-APIs bei Bedarf in Node nachbilden, `jsdom` ist installiert). Golden-Files klein halten (je Crate zusammen möglichst < 1 MB), deterministisch (feste Seeds, feste IVs/Schlüssel nur im Test).
- **Gefundene JS-Fehler**: Rust darf es besser machen, wenn kein gespeichertes/übertragenes Format betroffen ist. Jede bewusste Abweichung vom JS-Verhalten im Code kommentieren, im Golden-Test als Ausnahme kennzeichnen und im Bericht nennen. `web/` wird beim Neuschreiben eines Crates **nicht** geändert.
- **Umgestellte Bereiche (Rust only)**: Läuft ein Bereich in der PWA über den Kern, ist die JS-Fassung gelöscht. Seine Golden-Files bleiben als eingefrorener Stand der letzten JS-Fassung (alte Daten müssen lesbar bleiben); der Generator dafür entfällt. Kein JS-Rückfall.
- **Ein-/Ausgabe**: Der Kern macht keine selbst. Plattformzugriffe (Netz, Speicher, Token, Warten, Werkzeuge) sind asynchrone Trait-Methoden (`#[allow(async_fn_in_trait)]`, ohne `Send`-Schranke); Tests rufen über `impala_net::block_on`.
- **Fähigkeiten als Traits** mit Rust-Standard-Implementierung, wo verlangt (z. B. `InkRecognizer`, `Embedder`, `LlmProvider`, `SecureStore`, `Storage`). Netzwerk immer über `impala_net::HttpClient` (Request bauen + Response auswerten als reine Funktionen, testbar ohne Netz).
- **Abhängigkeiten** sparsam und verbreitet (serde, serde_json, RustCrypto, flate2, rusqlite …). Schwere Abhängigkeiten (ONNX-Laufzeit, SQLite, HTTP-Client) hinter ein Cargo-Feature legen, wenn das Crate auch ohne sinnvoll ist (WASM-Tauglichkeit!). Reine Logik muss für `wasm32-unknown-unknown` bauen: `cargo build -p <crate> --target wasm32-unknown-unknown --no-default-features` (soweit das Crate dafür gedacht ist).
- **Kein `unsafe`** (Workspace-Lint). Keine Panics bei fremden Eingaben (Netz, Dateien, alte Daten) – `Result`/`Option`.
- Kommentare und Doku auf **Deutsch**, knapp, im Stil von `core/impala-sync/src/`. `rustfmt` (Konfiguration `core/rustfmt.toml`).
- Öffentliche API klein und klar halten (spätere UniFFI-Grenze: grobe Aufrufe, einfache Typen, wenig Hin und Her).

## Ablauf im Repo
- Nur in deinem eigenen Crate `core/impala-<name>/` und deinen Skripten `core/tools/*-<name>*.mjs` arbeiten. **Nicht** ändern: `web/`, `test/`, `core/Cargo.toml` (Workspace), andere Crates (Ausnahme: ausdrücklich erlaubt). Abhängigkeiten nur in der eigenen `Cargo.toml`.
- **Nicht committen, nicht pushen** – das macht der Orchestrator. Parallel arbeiten andere Agenten in anderen Crates; `cargo` sperrt das gemeinsame `core/target` kurz, das ist normal.
- Prüfen: `cd core && cargo test -p impala-<name>` und `cargo clippy -p impala-<name> --all-targets -- -D warnings` müssen grün sein, `cargo fmt -p impala-<name>`.
- Keine neuen `test/*.test.mjs`.
- **Messungen** (bei rechenintensiven Teilen): `core/impala-<name>/examples/bench.rs`, ausgeführt mit `cargo run -p impala-<name> --example bench --profile native`, und ein passendes `core/tools/bench-<name>.mjs` für die JS-Version auf denselben Eingaben (Median mehrerer Läufe). Zahlen in den Bericht.

## Bericht (Antwort an den Orchestrator)
Kurz und belegt, auf Deutsch:
1. Öffentliche API (Typen/Funktionen/Traits, 5–15 Zeilen).
2. **Was besser ist als JS**: gefundene Fehler/Randfälle im JS (Datei:Zeile, Auswirkung, ob in Rust behoben), entfernter/vereinfachter Code (JS-Zeilen vorher, Rust-Zeilen nachher ohne Tests – `wc -l`), stärkere Typ-Garantien, Messwerte nativ vs. JS.
3. Testabdeckung: Anzahl Tests, Golden-Fälle, was abgedeckt ist.
4. Ehrlich: wo Rust nicht besser ist, was fehlt, offene Punkte.
