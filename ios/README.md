# Native iPad-App

SwiftUI-App für **iPadOS 27** (Mindestversion 27.0, kein WebView) über dem Rust-Kern (`core/impala-ffi`, UniFFI).
Es gelten die Regeln aus `android/PORTING.md` §1: Aussehen und Verhalten der PWA übernehmen, native Bausteine
statt Eigenbau, keine Logik nachbauen, die im Kern liegt. Lücken zur PWA: `docs/PARITAET.md`.
Funktionsbeschreibungen früherer Stände: Git-Historie dieser Datei.

## Oberfläche: PWA + Apple-Feinschliff

- **Wie die PWA**: Farben (`Theme/Tokens.swift`), Abstände, Schriftgrößen, Icons (`web/icons.svg` →
  `Assets.xcassets`, `npm run ios:icons`), Texte wörtlich. Tablet-Layout der PWA (Seitenleiste, Tab-Leiste, KI-Panel).
- **Geräteübergreifend**: offene Tabs (`uiTabs`) und Aufklapp-Zustand (`treeOpen`) liegen im Kern und synchronisieren.
- **Apple-Feinschliff**: Liquid Glass nur für schwebende Bedienelemente (`impalaGlass`), `NavigationSplitView`,
  Kontextmenüs (Halten) statt ⋯-Popover, Sheets, Trackpad-Hover. Im Heft eine eigene Werkzeug-Pille
  (`HeftToolPill`) statt Apples Werkzeugleiste.
- **Animationen**: Apple-Federn statt CSS-Kurven (`matchedGeometryEffect`, `navigationTransition(.zoom)`,
  `numericText`, `glassEffectID`); „Bewegung reduzieren“ wird beachtet.

## Aufbau

```
ios/
├─ project.yml                 XcodeGen (das .xcodeproj wird erzeugt, nicht committet)
├─ Bindings/                   C-Header + module.modulemap des Kerns (erzeugt)
├─ Frameworks/libimpala_ffi.a  Kern fürs Gerät (erzeugt, nur macOS/CI, nicht committet)
└─ Impala67/
   ├─ App/        Einstieg (AppModel: Kern, Sync, Drive), Checkpoint, Hintergrund-Sync, Profiler, DevBridge
   ├─ Core/       ImpalaStore (Änderungs-Meldungen → Revisionen), Generated/ (Swift-Bindings, nie von Hand ändern)
   ├─ Theme/      Farben, Maße, Icon, Liquid Glass
   ├─ Shell/      Seitenleiste, Seitenbaum, Tab-Leiste, Suche, Papierkorb, PageOps
   ├─ Library/    Bibliothek (Notion, GoodNotes-Regal, Archiv), PDFKit-Ansicht
   ├─ Home/       Startseite, Lernzeit, Tagesartikel
   ├─ Graph/      Wissensgraph
   ├─ Notes/      Notiz-Editor (NoteModel, BlockOps, InlineMarkdown, RichView), MarkdownView
   ├─ Cards/      Karteikarten: Stapelbaum, Übersicht, Lernen, Editor, Statistik, Import/Export
   ├─ Chat/       KI-Chat (ChatModel = Rückrufe des Rust-Assistenten), Panel, Liste
   ├─ Sync/       Cloudflare-Sync, QR-Kopplung, Konflikte, Drive-Backup
   ├─ Settings/   Einstellungen wie die PWA (Bereiche links, Inhalt rechts)
   └─ Heft/       PencilKit-Heft
```

## Wichtige Regeln im Code

- **Daten nur über `ImpalaStore`**; Ansichten hören auf ihre eigene Revision (`pagesRevision`, `cardsRevision` …) und
  lesen den Kern im Hintergrund, nie bei jedem Neuzeichnen auf dem Hauptthread (siehe Leistung in `docs/PARITAET.md`).
- **Kern-Aufrufe** über `attempt("name", { try core.…() })` statt `try?`, damit Fehler im Profiler landen.
- **Notiz-Editor**: Der Kern zerlegt und schreibt Blöcke (`markdownToBlocks`/`blocksToMarkdown` → `updatePage`, 600 ms
  nach dem Tippen); die App kennt nur Bedien-Operationen. Eingabefeld ist `UITextView` (meldet Rücktaste am Anfang,
  Auswahl, Tastenkürzel). KaTeX/Mermaid/SVG über eine WebView mit denselben CDN-Versionen und Prüfsummen wie die PWA.
- **Heft**: PencilKit zeichnet nur; gespeichert wird ausschließlich das Strichformat des Kerns (`pen`/`marker`,
  CSS-Farbe, Breite, `[x, y, druck, …]`). `HeftCanvas` vergleicht die Zeichnung mit dem letzten Stand
  (`PKStroke.randomSeed`) und ruft `heftAddStroke`/`heftRemoveStrokes`/`heftMoveStrokes`. Papier als Vektor-Ebene
  darunter (`HeftPaper.swift`), Breiten wie `segW` in `web/heft.js`. Formen über `heftFitShape`/`heftAddShape`.
- **KI-Schlüssel nur im Schlüsselbund** (`AiKeychain`, `…ThisDeviceOnly`); in die Kern-Einstellungen gehen Quellen
  ohne `key`. „Impala AI“ nutzt den Sync-Schlüssel.

## Sync und Backup

- **Cloudflare**: Ablauf, Verschlüsselung, Konflikte und Dateien im Kern (`CloudSync`, ureq/rustls). Die App hält nur
  den WebSocket (`URLSessionWebSocketTask`, Ping, Neuaufbau), im Vordergrund offen, im Hintergrund zu. Schlüssel und URL
  in den Kern-Einstellungen (`cfUrl`, `cfSyncKey`); gekoppelt, wenn der Schlüssel zusätzlich in `UserDefaults` liegt.
- **QR-Kopplung**: Format wie PWA/Android (`https://prinzpuma.github.io/Impala67/#cf-pair=<Base64(JSON {url, key})>`).
  Kommt ein neuer Schlüssel über die Einstellungen (z. B. Drive), koppelt das iPad sofort; bekannte (`cfSeenKey`) nicht.
- **Hintergrund**: `BGAppRefreshTask` `org.impala67.app.sync`, frühestens stündlich, ein Durchgang ohne WebSocket (≤ 25 s).
- **Google Drive**: OAuth 2.0 + PKCE über `ASWebAuthenticationSession` (Bereich `drive.appdata`); Refresh-Token nur im
  Schlüsselbund, Zugriffstoken nur im Speicher. Beim Wechsel in den Hintergrund `flushUpload`.
  **Einrichtung (einmalig)**: Im selben Google-Cloud-Projekt wie die PWA einen OAuth-Client vom Typ **iOS** mit
  Bundle-ID `org.impala67.app` anlegen und die Client-ID in `ios/project.yml` bei `GOOGLE_IOS_CLIENT_ID` eintragen.
  Solange der Platzhalter `DEINE_IOS_CLIENT_ID…` dort steht, ist „Mit Google verbinden“ gesperrt.

## Entwickler-Werkzeuge

- **Performance-Profiler** (`App/Profiler.swift`, Einstellungen → App & Speicher → Für Entwickler): Hänger > 100 ms,
  Kern-, Sync- und KI-Fehler, Start > 1,5 s; höchstens 180 Einträge in `impala67-performance.json`.
- **MCP-Bridge (WLAN)** (`App/DevBridge.swift`): Adresse aus `node mcp/lan-setup.mjs` eintragen; Werkzeuge Diagnose,
  Trace, Seiten, Suche, UI-Aktionen, `impala_screenshot`, `impala_ui_tree`, `impala_tap`, `impala_type`. Kein `impala_eval`.
  Ablauf: `docs/IPAD-TESTAUFTRAG.md`.
- **App-Icon**: `npm run ios:app-icon` rendert `web/icon.svg` (Chrome/Edge über puppeteer-core, notfalls `CHROME_BIN`)
  als 1024×1024-PNG nach `Assets.xcassets/AppIcon.appiconset`.

## Bauen ohne Mac

```bash
npm run build:ios-core   # nach Änderungen in core/impala-ffi: Swift-Bindings neu erzeugen und committen
```

Unter Windows/Linux entstehen nur die Bindings. Die App baut `.github/workflows/ios-build.yml` auf einem macOS-Runner
(bei Änderungen in `ios/` oder `core/impala-ffi/`, oder über „Run workflow“) als Artefakt `Impala67-ipa`
(unsignierte `Impala67.ipa`). Installieren mit kostenloser Apple-ID über Sideloadly, AltStore oder SideStore
(Signatur gilt 7 Tage).
