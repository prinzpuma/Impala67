# Native Android-App – Leitfaden für die Portierung

Die Android-App ist eine **komplett native** Kotlin/Compose-App (kein WebView, kein Hybrid) über dem
Rust-Kern (`core/impala-ffi`, UniFFI). Sie soll **aussehen und sich verhalten wie die PWA** – mit
leichten Plattformanpassungen – aber deutlich kompakter sein, weil Compose, Material 3 Expressive und
Android-Bausteine das meiste schon mitbringen.

**Vorlage für jeden Bildschirm: die Startseite** (`app/src/main/java/org/impala67/app/home/`).
Lücken zur PWA: `docs/PARITAET.md`. Frühere Status-Tabellen: Git-Historie dieser Datei.

## 1. Regeln (für Menschen und Subagents)

1. **Aussehen und Verhalten übernehmen – nicht die Web-Struktur.** Vor dem Schreiben das Web-Modul,
   sein CSS und die laufende PWA ansehen (Dev-Server `impala67-node`, Port 8011, breit). Die PWA hat keine eigene Handy-Oberfläche mehr;
   für die Telefon-Ansicht ist die Android-App selbst maßgeblich (die alte PWA-Handy-UI `web/mobile*.js` steht nur noch in der Git-Historie).
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
├─ ImpalaApp.kt, MainActivity.kt   Kern öffnen, Single Activity, Edge-to-Edge, Splash
├─ core/ImpalaStore.kt             query / write / dispatch + Touches (Änderungsgruppen)
├─ ui/theme, ui/components         Tokens (CSS-Variablen), Theme, PanelCard, TintButton, riseIn …
├─ ui/shell                        Telefon-Shell (NavigationSuiteScaffold + NavDisplay), Routes, ShellNav
├─ ui/desk                         Tablet-Layout wie die PWA (Seitenleiste, Tabs, KI-Panel)
├─ home, notes, editor, heft, library, study, ai, graph, notebook, daily, search, settings, sync, share, more, diag
└─ settings/DevicePrefs            Geräte-Einstellungen (DataStore; in der PWA: localStorage)
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

- **Telefon hochkant** (< 840 dp): Top-App-Bar mit Titel, Suche und KI; Navigationsleiste unten (wie das frühere Mobil-Dock
  der PWA), „+“ als mittlerer Leisteneintrag (Sheet).
- **Tablet** (≥ 840 dp, Telefon quer ab 600 dp; `ui/desk/`): Layout der PWA am Desktop/iPad – links Seitenleiste (Pillen Home ·
  Chat · Karten · Suche, Seitenbaum mit Favoriten und Arbeitsbereichen, unten Wissensgraph,
  Bibliothek, Papierkorb, Einstellungen), in der Mitte Tab-Leiste + Inhalt, rechts das
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

## 7. Native Bausteine (Auswahl)

| PWA | Android |
|---|---|
| Heft-Zeichnen (`heft*.js`) | `androidx.ink` + Heft-FFI (`heftPage`, `heftApply` …) |
| Handschrift (`handschrift.js`, `heft-indexer.js`) | ML Kit Digital Ink |
| Scanner (`heft-scan*.js`) | ML Kit Document Scanner oder eigener Scanner (Kern `scan_*`) |
| QR (`qr-scanner.js`) | Google-Codescanner |
| Sync-WebSocket, Hintergrund | OkHttp-WebSocket, WorkManager (`sync/BackgroundWork.kt`) |
| Drive-Anmeldung | Google Identity (`drive.appdata`) |
| Diktat (`voice.js`) | `SpeechRecognizer` |
| Update (`updater.js`) | APK-Update über GitHub Releases (`settings/AppUpdater.kt`) |
| Teilen an die App | `share/Incoming.kt` |
| Profiler, MCP-Bridge | ➖ (Logcat/Android-Profiler; keine Live-Bridge) |

## 8. Release und Versionen

- Release-APK mit R8 und JNI-Kompression (≈ 21 MB). ML Kit braucht Keep-Regeln (`app/proguard-rules.pro`), sonst stürzen Hefte im Release ab –
  nach neuen Bibliotheken immer die Release-Variante prüfen.
- Abhängigkeiten nur in `gradle/libs.versions.toml`; SDK-Stufen in `app/build.gradle.kts` (`compileSdk` 37, `minSdk` 26).
