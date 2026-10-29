# Native Android-App – Leitfaden für die Portierung

Die Android-App ist eine **komplett native** Kotlin/Compose-App (kein WebView, kein Hybrid) über dem
Rust-Kern (`core/impala-ffi`, UniFFI). Sie soll **aussehen und sich verhalten wie die PWA** – mit
leichten Plattformanpassungen – aber deutlich kompakter sein, weil Compose, Material 3 Expressive und
Android-Bausteine das meiste schon mitbringen.

**Vorlage für jeden Bildschirm: die Startseite** (`app/src/main/java/org/impala67/app/home/`).

## 1. Regeln (für Menschen und Subagents)

1. **Aussehen und Verhalten übernehmen – nicht die Web-Struktur.** Vor dem Schreiben das Web-Modul,
   sein CSS und die laufende PWA ansehen (Dev-Server `impala67-node`, Port 8011; mobil 375 px und breit).
   Kein `render()`-Nachbau, keine Klick-Delegation über `data-*`, keine HTML-Strings, kein globales `S`.
2. **Native Bausteine statt Eigenbau.** Erst in Material 3 (1.5, Expressive), Navigation 3, androidx und
   ML Kit suchen (siehe Tabelle unten). Eigene Composables nur für das, was es dort nicht gibt.
3. **Keine Logik nachbauen, die im Rust-Kern liegt.** Daten lesen/schreiben nur über `ImpalaStore`
   (§ 4). Fehlt eine Funktion in der FFI-Hülle, die Hülle erweitern (dünner Wrapper um das vorhandene
   Rust-Crate), nicht in Kotlin nachprogrammieren. Logik, die es nur in JS gibt (z. B. `lernzeit.js`),
   darf nach Kotlin – mit Hinweis „Kandidat für den Rust-Kern“.
4. **Kleine Module nach Fachgebiet.** Ein Paket je Bereich (`home/`, `notes/`, `editor/`, `heft/`,
   `study/`, `ai/`, `settings/`, `sync/` …). Dateien möglichst < 300 Zeilen; je Bildschirm
   `XxxState.kt` (Daten + Texte), `XxxViewModel.kt` (Abfragen), `XxxScreen.kt` (Layout) und Teile.
5. **Muss bauen.** Nach jedem Schritt `assembleDebug` (§ 6). Keine Warnungen im eigenen Code.
6. **Abhängigkeiten nur über `gradle/libs.versions.toml`.** Neueste stabile Version; Vorabversion nur,
   wo sie nötige Funktionen bringt (wie Material 3 1.5.0-beta02). Keine Versions-Strings in Gradle-Dateien.
7. **Experimentelle APIs gezielt**: `@OptIn(ExperimentalMaterial3ExpressiveApi::class)` an der
   Funktion, nicht global.
8. **Texte deutsch direkt im Code**, Formulierungen wörtlich aus der PWA (die App ist nur deutsch).
9. **Icons** nur aus dem PWA-Sprite: `R.drawable.ic_i_<name>` (aus `web/icons.svg` erzeugt mit
   `npm run android:icons`). Keine `material-icons`-Bibliothek, keine Emojis als UI-Icons.
10. Nicht auf `main` pushen ohne Freigabe: ein Push geht sofort live (PWA), ein Release baut die APK.

## 2. Aufbau

```
org.impala67.app
├─ ImpalaApp.kt          Kern öffnen (Hintergrund), Geräte-Einstellungen
├─ MainActivity.kt       Single Activity, Edge-to-Edge, Splash bis der Kern geladen ist
├─ core/ImpalaStore.kt   query / write / dispatch + Touches (Änderungsgruppen)
├─ ui/theme/             Tokens.kt (CSS-Variablen), ImpalaTheme.kt (MaterialExpressiveTheme)
├─ ui/components/        PanelCard, TintButton, riseIn, pressScale …
├─ ui/shell/             AppShell (NavigationSuiteScaffold + NavDisplay), Routes, Platzhalter
├─ home/                 Startseite (Muster)
├─ study/LearningTime.kt Lernzeit-Auswertung (aus lernzeit.js)
└─ settings/DevicePrefs  Geräte-Einstellungen (DataStore; in der PWA: localStorage)
```

**Navigation:** Ziele sind `@Serializable`-`NavKey`s in `ui/shell/Routes.kt`. Ein neuer Bildschirm =
Route + `entry<…>` in `AppShell`. Listen bekommen `ListDetailSceneStrategy.listPane()`, Details
`detailPane()` – auf breiten Bildschirmen stehen sie dann nebeneinander. Zurück und die vorausschauende
Geste macht `NavDisplay`. Dialoge/Sheets: `ModalBottomSheet`, `AlertDialog`; Menüs: `DropdownMenu`.

## 3. Aussehen: CSS → Kotlin

| CSS (web/css/variables.css, styles.css `body.light`) | Kotlin |
|---|---|
| `--panel-solid`, `--text`, `--text2`, `--accent`, `--edge(-soft)`, `--surface*`, `--warn` … | `Impala.colors.panel`, `.text`, `.text2`, `.accent`, `.edge`, `.edgeSoft`, `.surface…`, `.warn` |
| `--b-tint`, `--b-tint-2`, `--b-tint-3`, `--accent-border`, `--b-hover-bg` | `.tint`, `.tint2`, `.tint3`, `.accentBorder`, `.hoverBg` |
| `--space-1 … --space-8` | `Space.s1 … Space.s8` |
| `--radius-xs … --radius-xl`, `--radius-pill` | `Radius.xs … Radius.xl`, `CircleShape` |
| `--text-3xs … --text-xl` | `TextSize.xs3 … TextSize.xl` |
| Karte (`--b-card`: Fläche + 1-px-Ring) | `PanelCard` |
| `.hv-btn` / `.hv-pin` (Pille, Akzent-Tönung) | `TintButton(strong = true/false)` |
| `--b-display` (Überschriften, eng gesetzt) | `MaterialTheme.typography.headline*/displaySmall` |
| Auftritt `hv-in`, Drücken `scale(.97/.99)` | `Modifier.riseIn(i)`, `Modifier.pressScale(…)` |
| Federn `--ease-spring` | `MaterialTheme.motionScheme.*Spec()` (Expressive) |
| Container-Queries (`max-width: 520px`, `min-width: 760px`) | `BoxWithConstraints` → `HomeWidth` |
| `pointer: coarse` (44-px-Ziele) | immer 44 dp |

Hell/Dunkel folgt dem System (`ImpalaTheme(dark = …)`); die PWA-Einstellung `impala67Theme` kommt mit
den Einstellungen. Material-Rollen (`colorScheme`) sind aus denselben Tokens abgeleitet, damit
Standard-Komponenten von selbst passen.

## 4. Daten

- `store.query(Touches.pages) { core -> … }` liefert einen `StateFlow`, der bei passenden Änderungen
  (eigene wie gesyncte, `ChangeListener` des Kerns) im Hintergrund neu liest.
- Schreiben: typisierte Kern-Funktionen über `store.write { it.createPage(…) }`, sonst
  `store.dispatch("eventTyp", mapOf(…))` – genau die Events wie `STATE.dispatch` in der PWA.
- Neue FFI-Funktion: in `core/impala-ffi/src/*.rs` ergänzen → `cargo test -p impala-ffi` →
  `npm run build:android-core` (baut die `.so` und erzeugt `uniffi/impala_ffi/impala_ffi.kt` neu;
  die Bindings nie von Hand ändern). Fehlerfelder heißen `reason` (nicht `message`), Varianten nicht wie
  Kotlin-Typen (`List`, `Map` …) – sonst erzeugt uniffi 0.29 ungültiges Kotlin.

## 5. Plattformanpassungen (bewusst anders als die PWA)

- **Telefon hochkant** (< 840 dp): Top-App-Bar mit Titel, Suche und KI; Navigationsleiste unten (wie das Mobil-Dock
  der PWA), „+“ als mittlerer Leisteneintrag (Sheet).
- **Tablet** (≥ 840 dp, Telefon quer ab 600 dp; `ui/desk/`): Layout der PWA am Desktop/iPad – links Seitenleiste (Pillen Home ·
  Chat · Karten · Suche, Seitenbaum mit Favoriten und Arbeitsbereichen, unten Gemini Notebook,
  Wissensgraph, Bibliothek, Papierkorb, Einstellungen), in der Mitte Tab-Leiste + Inhalt, rechts das
  einklappbare KI-Panel (Sparkles-Knopf unten rechts). Keine Navigationsschiene, keine Top-App-Bar.
  Offene Punkte stehen als `TODO(desk)` im Code.
- Hover-Zustände entfallen (Touch); Ripple + Formwechsel beim Drücken.
- Meldungen (`U.toast`) als Snackbar.

## 6. Bauen und prüfen

Toolchain (Windows, ohne Admin installiert): JDK 21 unter `%LOCALAPPDATA%\Programs\Temurin`,
Android SDK unter `%LOCALAPPDATA%\Android\Sdk` (Plattform 37, Build-Tools 37.0.0, NDK 30, Emulator),
`JAVA_HOME`/`ANDROID_HOME` als Benutzervariablen.

```bash
npm run build:android-core          # nach Änderungen in core/impala-ffi
cd android && ./gradlew assembleDebug
```

Emulator: AVDs `impala_phone` (Pixel 9) und `impala_tablet` (Pixel Tablet), API 37.
`emulator -avd impala_phone`, dann `adb install -r app/build/outputs/apk/debug/app-debug.apk`;
Dunkel: `adb shell cmd uimode night yes`. Screenshots mit `adb shell screencap` + `adb pull` und
neben die PWA (gleiche Breite) legen.

## 7. Offene Punkte vor einem Release

- **Datenübernahme aus der alten Capacitor-App:** Deren Daten liegen in der IndexedDB des WebViews.
  Ohne Übernahme (z. B. Export → `ImpalaCore.importJson`, oder Sync/Drive vor dem Update) gingen rein
  lokale Daten verloren. **Kein Release, bevor das gelöst ist.**
- Ein Release baut aus diesem Stand eine APK, die erst die Startseite kann – Release erst nach den
  Kernbildschirmen.
- App-Shortcuts (`res/xml/shortcuts.xml`: neue Notiz/Heft/Lernen) und „Teilen mit Impala67“ sind im
  Manifest, die Activity wertet die Intents noch nicht aus.
- Rundschrift `--b-display` (SF Pro Rounded/Nunito) gibt es auf Android nicht; derzeit Systemschrift.
- Startseite: Heft-Vorschaubild (mit Heft-Modul), PDF-Seiten (`pdfId` fehlt in `PageSummary`), Lernanalyse
  (lernanalyse.js), Backup-Hinweis (backup-status.js, mit Sync), Tagesartikel schreiben (KI) und als
  Markdown zeigen (derzeit Klartext), „Startseite anpassen“, Vorlagenwahl bei „Neue Seite“
  (derzeit leere Notiz).

## 8. Web-Modul → native Ersetzung

Status: ✅ fertig · 🟡 teilweise · ⬜ offen · ➖ entfällt nativ

| Web-Modul | Native Ersetzung | Kotlin-Datei | Status |
|---|---|---|---|
| `index.html`, `main.js`, `boot.js`, `app.js`, `app-ui.js` | Single Activity, Compose, Splash | `MainActivity.kt`, `ImpalaApp.kt` | ✅ |
| `css/variables.css`, `design.css`, `css/base.css`, `styles.css` (Tokens) | `MaterialExpressiveTheme`, `MotionScheme.expressive()` | `ui/theme/*` | ✅ |
| `icons.js`, `icons.svg` | Vector Drawables (erzeugt) | `res/drawable/ic_i_*.xml`, `tools/android-icons.mjs` | ✅ |
| `motion.js` | Expressive-MotionScheme, `AnimatedVisibility` | `ui/components/Motion.kt` | 🟡 |
| `state.js`, `state-views.js`, `db.js`, `db-view.js`, `event-bus.js`, `rust-core.js` | `ImpalaCore` (FFI) + `StateFlow` | `core/ImpalaStore.kt` | ✅ |
| `checkpoint-scheduler.js`, `compact-*.js` | `saveCheckpoint()` in `onStop` | `MainActivity.kt` | 🟡 |
| `home-view.js`, `home.css` | Compose | `home/*` | ✅ (Lücken § 7) |
| `home-article.js` | Anzeige/Gelesen/Verlauf; Schreiben über Rust-KI | `home/HomeArticle.kt` | 🟡 |
| `lernzeit.js`, `lernzeit-context.js` | Auswertung in Kotlin; Erfassung offen | `study/LearningTime.kt` | 🟡 |
| `lernanalyse.js`, `lernmuster.js`, `anki-stats.js` | Compose-Diagramme (Canvas) | `study/` | ⬜ |
| `mobile*.js`, `mobile*.css`, `layout.css`, `tabs.js`, `nav-history.js`, `app-sidebar-events.js`, `collapse.js` | `NavigationSuiteScaffold`, Navigation 3, List-Detail | `ui/shell/*` (Ziele: `Destinations.kt`) | ✅ |
| `popovers.js`, `app-dialogs.js`, `mobile-sheet.js` | `DropdownMenu`, `AlertDialog`, `ModalBottomSheet` | je Bereich | ✅ |
| `app-click-*.js`, `controller.js`, `shortcuts.js` | Callbacks/ViewModels; Tastatur über `onKeyEvent` | je Bereich | ➖ |
| `render.js` (Seitenbaum, Seiten), `mobile-notes.js`, Papierkorb/Archiv | `LazyColumn`, `DropdownMenu`, List-Detail | `notes/`, `more/` | 🟡 (Vorlagen, eigenes Cover-Bild offen) |
| `editor*.js`, `css/editor.css` | Blöcke aus `markdownToBlocks` (FFI), `BasicTextField`, Expressive Floating Toolbar | `editor/` | 🟡 (Slash-Menü, Markdown-Kürzel wie „- “, Icon/Cover, Formeln offen) |
| `editor-markdown.js`, Markdown-Anzeige | `markdown.rs` im FFI (`markdownToBlocks`/`blocksToMarkdown`) + Compose-Renderer | `editor/MarkdownView.kt` | ✅ |
| `heft.js`, `heft-viewport.js`, `heft-pages-*.js`, `heft-storage.js`, `heft-document-core.js`, `css/heft.css` | `androidx.ink` (Rendering) + Heft-FFI (`heftPage`, `heftApply` …) | `heft/` | 🟡 (Seitenübersicht, Bilder/Text offen) |
| `heft-input.js`, `heft-lasso.js`, `heft-geometry.js`, `heft-tools.js` | `androidx.ink` (InProgressStrokes, Geometrie) | `heft/` | 🟡 (Stift/Marker/Radierer ✅, Lasso offen) |
| `heft-toolbar-ui.js` | Expressive Floating Toolbar + Button-Gruppen | `heft/HeftToolbar.kt` | ✅ |
| `heft-scan*.js`, `heft-scanner-ui.js`, `scan-ocr.js` | ML Kit Document Scanner | `heft/scan/` | 🟡 (Scannen ✅; OCR offen) |
| `handschrift.js`, `handwriting-worker.js`, `heft-label.js`, `heft-indexer.js` | ML Kit Digital Ink (bzw. Kern-Index) | `heft/ink/` | 🟡 (Seitentext für die Suche ✅; Zeilen-Segmentierung über `impala-ink`, Lasso → Text offen) |
| `heft-import.js`, `heft-export.js`, `export-media.js` | Storage Access Framework, `heft_export` (FFI) | `heft/` | ⬜ |
| `render-anki.js`, `srs.js`, `app-click-anki.js` | Karten-FFI (`studyQueue`, `reviewCard`, Decks) | `study/` | 🟡 (Import/Export, Karten-Papierkorb offen) |
| `abschreiben*.js`, `experimente.js`, `schulnoten.js`, `fach.js` | Compose; Noten über FFI (`grades`) | `study/` | ⬜ |
| `ai.js`, `chats.js`, `chat-*.js`, `tools.js`, `types.js` | Rust-KI (`ai.rs`, `ai_tools.rs`, `chats.rs`) | `ai/` | 🟡 (Chat im KI-Panel + Chat-Liste ✅; Anhänge, Modellwahl, RAG, Chat-Tabs, Umbenennen offen) |
| `rag*.js`, `embedding*.js`, `vector-math.js`, `related-pages.js` | Rust (`rag.rs`) | `ai/` | ⬜ |
| `voice.js` | `SpeechRecognizer` | `ai/` | ⬜ |
| `search.js` | `ImpalaCore.search` + `SearchBar` | `search/` | ✅ (Chats folgen mit KI) |
| `sync-*.js`, `conflict-ui.js`, `backup-status.js` | Rust-Sync (`sync.rs`, `conflicts.rs`), OkHttp-WebSocket | `sync/CloudSyncController.kt` | 🟡 (Sync + Konflikte ✅, nur im Vordergrund; QR-Kopplung, Backup-Hinweis offen) |
| `drive*.js` | Rust-Drive (`drive.rs`) + Play-Services-Autorisierung (`drive.appdata`) | `sync/DriveController.kt` | 🟡 (Anmeldung, Sync, Intervall ✅; „nach jeder Änderung“ offen; braucht Android-OAuth-Client im Projekt der PWA-Client-ID) |
| `settings*.js` | Compose-Listen, `settingsJson`/`updateSettings` + `DevicePrefs` | `settings/` | 🟡 (Sync/KI/Speicher-Abschnitte offen) |
| `library.js`, `notebooklm.js`, `extras.js` | Compose-Listen | `library/` | 🟡 (PDF-Liste, Öffnen, Import ✅; Tabs/Filter, NotebookLM offen) |
| `pdfs.js`, `pdfpaste.js` | externer PDF-Betrachter (FileProvider) | `library/` | 🟡 (Textauszug für die Suche, KI-Zusammenfassung offen) |
| `graph.js`, `graph-worker.js`, `diagram.js` | Compose `Canvas` | `graph/` | ⬜ |
| `qrcode.js`, `qr-scanner.js` | ML Kit Barcode (+ CameraX) | `sync/` | ⬜ |
| `telemetrie.js`, `perf-hint.js`, `performance-profiler*.js` | Android-Profiler / Logcat | – | ➖ |
| `service-worker.js`, `updater.js`, `version.json`, `optional-modules.js`, `platform*.js` | APK-Update über Release | – | ➖ |
| `mcp-bridge*.js` | (vorerst keine Live-Bridge für die native App) | – | ➖ |
| `util.js`, `html-escape.js`, `cooperative.js`, `storage-tools.js`, `app-badge.js` | Kotlin-Standard / je Bereich | – | ➖ |

## 9. Versionen (Stand 2026-10-28)

Gradle 9.8.2 · AGP 9.5.0 (eingebautes Kotlin) · Kotlin + Compose-Compiler 2.4.21 · Coroutines 1.11.0 ·
Compose-BOM 2026.09.00 · Material 3 + Navigation Suite 1.5.0-beta02 · Adaptive 1.3.0 · Navigation 3 1.2.0 ·
Lifecycle 2.11.0 · Activity 1.13.0 · Core 1.19.1 · Splashscreen 1.2.0 · DataStore 1.3.0 · JNA 5.19.1 ·
`compileSdk`/`targetSdk` 37 (Android 17), `minSdk` 26. Vorgemerkt: Ink 1.0.0, CameraX 1.6.2,
pdf-viewer 1.0.0-beta01, ML Kit Document Scanner 16.0.0 / Digital Ink 19.0.0 / Barcode 17.3.0, WorkManager 2.12.0.
