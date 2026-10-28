# Impala67 – Backlog & Offene Punkte

Stand: v2.2.85 (21. Oktober 2026)

---

## 1. Zuletzt umgesetzt (Erledigt)

- [x] **Prüf- und Aufräumrunde (21. Oktober 2026)** – Befunde aus Code-Review und Live-Messung:
  - Start: Checkpoint wird bei verspäteten Fremd-Events weiterverwendet (`web/event-order.js`); vorher ~9 s Voll-Replay statt ~1,4 s. Checkpoints speichern nur noch sortierte Stände; Kompaktierung behält die höchste seq (kein Komplett-Neu-Upload).
  - Sicherheit: MCP-Bridge nur über Loopback, Sync-Schlüssel nicht mehr in Diagnosen, Kopplungslink nur mit Rückfrage, `javascript:`-Links im Editor nicht klickbar.
  - Daten: Seitentitel landet nicht mehr auf der falschen Seite, verdeckte Bestätigungen lösen nichts aus (`U.closeOverlay`), keine doppelten Events bei gleichzeitigem Cloudflare-/Drive-Import, Drive zeigt Importe sofort, Cloud-Reset ohne doppelten Upload.
  - Heft: Undo/Ziehen/Text-Editor nach dem Speichern, Textfelder verschwinden nicht mehr, Handballen und Zwei-Finger-Zoom zeichnen nicht mehr, Speicher für Kacheln/Scanner/PDF wird freigegeben, flache Linien legen die Handschrift-Erkennung nicht mehr lahm, Suche folgt Radieren/Rückgängig.
  - Lernen & KI: FSRS-Formel wie Referenz, Wissensgraph zeigt echten Lernstand, ⏹ stoppt KI-Läufe jederzeit, Stream-Fehler werden gemeldet, KI-Zwischenstände gehen nicht mehr in den Sync.
  - Aufräumen: ~400 Zeilen totes Lernzeit-Widget + CSS, tote Bibliotheks-Handler und Exporte, doppelte Helfer (Escape, gzip, Fokus, leere Heftseite), Import-Zyklus aufgelöst.

- [x] **Capacitor Android-Integration & Native Schicht (`web/platform-native.js`)**:
  - Basis-Setup (`capacitor.config.json`, `android/`), automatischer APK-Build via GitHub Actions (`.github/workflows/android-build.yml`) und permanente Edge-to-Edge-Statusleiste.
  - Hardware-Back-Button, Haptik, lokale SRS-Erinnerungen, Dateisystem-Backup (`Documents/Impala67/`), ML Kit Document Scanner, Offline-Spracheingabe und „Senden an Impala67" (Share-Intent).
- [x] **Lokale Handschrifterkennung (Bild-Modell v2)**:
  - Plattformunabhängige ONNX-Erkennung im Worker (`handwriting/` → `web/handwriting-model.onnx`, ResNet18 + BiLSTM + CTC) ersetzt ML Kit OCR.
  - Beam-Search mit deutschem Wörterbuch (`core/impala-ink/src/ctc.rs`), Mathe-Formeln (MathWriting) und eigener Abschreib-Modus (`web/abschreiben.js`).
  - Benchmark-Stand (Lauf 3, siehe `handwriting/README.md`): **0,0 % TEST-CER** auf eigenen Benchmark-Wörtern, **5,3 % CER** auf Abschreib-Zeilen.
  - Zentrale, akkuschonende Hintergrund-Indexierung über `HEFT_INDEXER.schedulePage` (`web/heft-indexer.js`) und reduzierte Stiftlatenz (`desynchronized: true`).
- [x] **UI-Designsystem & Icon-Sprache**:
  - Typografie- (`--text-*`) und Spacing-Skala (`--space-*`) in `web/css/variables.css` konsolidiert.
  - Zentrales SVG-Icon-Sprite (`web/icons.svg` + `web/icons.js`) ersetzt UI-Emojis und verstreute Inline-SVGs in über 40 Dateien.
  - Ruhige, aus `--accent` abgeleitete Flächen-Tokens (`--b-tint*`, `--b-card`, `--b-float`) und Feder-Animationen (`web/design.css`, `web/motion.js`) als Standard übernommen; `web/beta-ui.css` als leerer Experimentier-Slot zurückgesetzt.
- [x] **Erste Entschlackung & Modularisierung**:
  - Architektur, Datenflüsse und Baustellen (B1–B6) in `docs/ARCHITEKTUR.md` dokumentiert.
  - Tote Funktionen (~30 Exporte) und doppelte Helfer (`mapLimit`, `sha256Hex`, `gzipBytes`, `norm`/`dot`, `LOCAL_EMBED_MODEL_ID`) bereinigt.
  - Event-Kompaktierung in Hintergrund-Worker ausgelagert (`web/compact-events.js`, `web/compact-worker.js`).
  - Module aus Monolithen geschnitten: `web/editor-menus.js` (aus `editor.js`), `web/heft-lasso.js`, `web/heft-scanner-ui.js`, `web/heft-pages-beta.js`, `web/heft-toolbar-beta.js` (aus `heft.js`), `web/conflict-ui.js` (aus `render.js`).

---

## 2. Jetzt am nötigsten (Priorisierte nächste Schritte)

### Priorität 1: Monolithen, CSS-Schichten & Modul-Grenzen aufräumen (KISS & DRY)
- [x] **Beta-Namensreste & Heft-CSS-Überlagerung bereinigt**:
  - `web/heft-pages-beta.js` und `web/heft-toolbar-beta.js` in `web/heft-pages-ui.js` und `web/heft-toolbar-ui.js` überführt; die gesamte Toolbar-, Tray- und Popover-HTML-Erzeugung aus `web/heft.js` dorthin ausgelagert.
  - `web/css/heft-ui.css` vollständig mit `web/css/heft.css` zusammengeführt und als separate Datei entfernt.
- [x] **Doppelte Zuständigkeiten auflösen (`docs/ARCHITEKTUR.md` B3)**:
  - Embedding-Worker-Verwaltung und lokaler Modellkatalog aus `web/ai.js` vollständig nach `web/embedding.js` verlagert.
  - Doppelte HTML-Erzeugung zwischen `web/settings.js` und `web/settings-renderer.js` (Modell-Liste, lokaler Embedding-Status) im Renderer zusammengeführt.
- [x] **Weitere Monolithen-Schnitte umgesetzt**:
  - `web/heft-import.js` (Datei-/Bild-/PDF-Import) und `web/heft-storage.js` (Blob-Referenzen, Altbestand-Migration, Verlauf-Snapshots) aus `web/heft.js` ausgelagert.
  - `web/app-sidebar-events.js` (Sidebar-Drag-&-Drop, Inline-Umbenennen, Breitenanpassung) und `web/app-dialogs.js` (Dialoge, Seiten-Flows, Anki-/Lernmodus-Helfer) aus `web/app.js` ausgelagert.
  - `web/editor-inline.js` (Inline-Markdown, KaTeX-Hydrierung, Caret-Berechnung) aus `web/editor.js` ausgelagert.
- [x] **Große Dateien weiter geschnitten**:
  - `web/heft.js` (~1.670 Zeilen): Stift-Eingabe (`onDown`/`onMove`/`onUp`, Radierer, Lasso-Griffe, Formerkennung) in `web/heft-input.js`; gemeinsamer Zustand über Getter/Setter.
  - `web/app.js` (~850 Zeilen): Zentraler Klick-Handler in `web/app-click-chat.js`, `app-click-anki.js`, `app-click-pages.js`, `app-click-buttons.js` aufgeteilt; Helfer in `web/app-ui.js`, Touch/Handy-Erkennung in `web/platform.js` (statt `window.PLATFORM`).
  - `web/editor.js` (~1.900 Zeilen): Text-/Tabellen-/Code-Tasten in `web/editor-keys.js`.
- [ ] **Große Dateien optional weiter schneiden**:
  - `web/editor.js`: Blockauswahl-Tasten (`handleSelectionKeys`) und Host-Verkabelung (`wire`) — teilen sich viel Auswahl-Zustand, nur mit Getter/Setter-Schnittstelle sinnvoll.
  - `web/app.js`: Eingabe-/Change-Handler in `wireEvents()`.
- [x] **Restliche CSS-Überlagerungen abgebaut**:
  - Abgeleitete Design-Tokens (`--b-*`) nach `web/css/variables.css` überführt und die Komponenten-Regeln aus `web/design.css` direkt in `web/home.css`, `web/styles.css`, `web/css/editor.css` und `web/css/heft.css` integriert (`web/design.css` enthält nur noch Querschnitts-Kartenbasis und `motion.js`-Übergänge).
- [x] **Abhängigkeits-Knäuel & `window`-Brücke aufgelöst (`docs/ARCHITEKTUR.md` B1/B2)**:
  - Alle zirkulären Modul-Importe (0 verbleibende Zyklen in `web/*.js`) über `web/event-bus.js` (`BUS.on`/`emit`/`provide`/`call`) und direkte Submodul-Importe (`web/app-dialogs.js`, `web/state.js`) entkoppelt; veraltete Einzelfunktions-Aliase auf `window` in `web/main.js` entfernt.

- [ ] **Bewusst offen gelassen (gemessen unkritisch)**:
  - Heft: Speichern vergleicht das ganze Heft (`diffDocument`); bei den größten Heften (~2.700 Striche) ~1 ms. Erst bei deutlich größeren Heften auf „nur geänderte Seiten“ umstellen.
  - KI-Werkzeug `change` kopiert vor jeder Änderung alle Seiten/Karten für das Undo (`tools.js` `managedSnapshot`).
  - RAG: `related()` liest alle Vektoren im Hauptthread (aktuell ~200 Einträge).
  - Laufzeit-Reihenfolge: Ein verspätetes, kollidierendes Fremd-Event wird bis zum nächsten Start in Ankunftsreihenfolge angezeigt (korrekt sortiert erst nach dem Neustart).

### Priorität 2: Heft-KI & Handschrift im Alltag nutzbar machen
- [ ] **KI-Funktionen direkt fürs Heft**:
  - Auf Basis des erkannten Heft-Textes (`ocrText` aus `heft-indexer.js`) und der Seitenbilder direkte Aktionen anbieten wie „Lernzettel aus diesem Heft erstellen" oder „Karteikarten aus Heft-Seite generieren".
- [ ] **Handschrifterkennung gezielt weiter schärfen**:
  - Erkennungsqualität auf echten Notizseiten (`handwriting/evaluate_notes_benchmark.py`) bei längeren Sätzen, Skizzen-Abgrenzung und Mathe-Ausdrücken weiter verbessern.

### Langfristig: Rust-Kern & native Apps
- [ ] **Plan in `docs/NATIV-PLAN.md`**: Gemeinsamer Rust-Kern (auch als WASM in der PWA), danach iPad, Android, Windows/Linux nativ.
  - [x] Schritt 1: Spike `core/` – Event-Kompaktierung in Rust; als WASM langsamer als JS, deshalb rechnet die PWA weiter in JS. Ergebnis und Messwerte im Plan.
  - [x] Schritt 2: Ganze Nicht-UI-Logik als Rust-Kern (12 Crates, Golden-Tests gegen JS, Stand im Plan).
  - [x] Kern ohne eigene Ein-/Ausgabe: `HttpClient`, Sync-, Drive- und KI-Traits asynchron.
  - [x] PWA-Sync nur noch über den Rust-Kern (`SyncCore`, WASM), JS-Sync-Logik gelöscht.
  - [x] Drive-Backup Rust only (`DriveCore` in `core/impala-wasm/src/drive.rs`, `web/drive.js` nur noch Anmeldung, Timer, Ein-/Ausgabe).
  - [x] Drive und Sync: Dateien wieder parallel (Drive 6 herunter/3 hoch, Sync 3), über `impala_net::join_all`.
  - [ ] Drive: Login/Upload großer Dateien (resumable, `Location`-Header) mit echtem Google-Konto prüfen.
  - [x] Rust only in der PWA: FSRS, Markdown, Suche/RAG, Handschrift, Heft-Logik, KI, Kompaktierung.
  - [x] Datenmodell nur noch in Rust (`ModelCore`, NATIV-PLAN 3f); JS-Reducer, Checkpoint-, Reihenfolge- und Konfliktlogik gelöscht.
  - [ ] Heft-Editor: Speichern serialisiert die ganze Arbeitskopie für den Diff (≈ 50 ms bei 2000 Strichen, wie vorher) – nur geänderte Seiten übergeben.
  - [ ] Start vom Checkpoint ≈ 15–30 % langsamer als die JS-Fassung (Text-Übergabe an WASM, `opt-level = "z"`); Kern-Zustand als Binärformat oder Teile je Sammlung prüfen.
  - [ ] Sync: WASM-Größe senken.
  - [ ] UniFFI-Schnittstelle für `impala-core` (Swift/Kotlin), grobe Aufrufe.
  - [x] PWA: RAG-Index als WASM im Worker.
  - [ ] WASM-Größe (2,29 MB mit Datenmodell): `opt-level` (gemessen: `3` → 4,4 MB, Start ≈ 25 % schneller), `regex` in impala-ai ersetzen.
  - [ ] Rust-Kern: Bekko-Embedding mit tract Ende-zu-Ende prüfen; `ort`-Feature oder Plattform-Erkenner statt tract.
- [ ] **JS-Fehler, beim Rust-Kern gefunden** (Details in den Commits auf `claude/rust-kern`):
  - [x] Erst-Sync eines neuen Geräts lädt alles Abgerufene erneut hoch und verdoppelt die Cloud-Belegung; Fehler ohne Status werden endlos wiederholt (beides mit dem Rust-Sync behoben).
  - [ ] Markdown-Parser hängt endlos bei Callout-Titel mit U+2028/U+2029 (`editor-markdown.js:185`); Farben an Code/Tabelle/Bild gehen beim Speichern verloren.
  - [ ] KI: `view_heft_page` liefert dem Modell nie das Bild (`ai.js` pruneRunHistory); Prompt nennt nicht angebotene Werkzeuge.
  - [x] Drive: 60-s-Aufschub greift nie (in `drive.js` behoben), Alt-Blob-Dateien werden bei jedem Sync neu geladen, kaputtes Base64 blockiert jeden Sync (beides mit dem Rust-Kern behoben).
  - [x] Handschrift: Skizzen-Striche zählen in der Strich-Bilanz (Rust-Ablauf).
  - [x] Start-Absturz bei Patch, der kein Objekt ist (früher `event-order.js:16`); Heft: Kreis-Bounds NaN, `s-` ohne Liste bricht Event ab (mit dem Rust-Datenmodell behoben).
  - [ ] FSRS: Obergrenze der Stabilität nach Vergessen fehlt; Anzeige „60 Min“/„1 Jahre“.
  - [ ] Kompaktierung: Kommentar-Regel 4 (Telemetrie verfällt nach 90 Tagen, `TELE_KEEP_DAYS`) ist in `web/compact-events.js` nicht umgesetzt – umsetzen (JS + Rust + Golden-Files) oder Kommentar streichen.

### Priorität 3: Android & Plattform-Ergänzungen
- [ ] **Google Drive Login in Android-APK verifizieren**:
  - OAuth2-Ablauf in der nativen Capacitor-Umgebung testen und absichern (Webclient-ID vs. Android OAuth-Redirect / Chrome Custom Tabs).
- [ ] **Android Home-Screen Widget (optional)**:
  - Startbildschirm-Widget für einen schnellen Blick auf heute fällige Karteikarten.
