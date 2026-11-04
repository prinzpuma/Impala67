# Native iPad-App

Für **iPadOS 27** gebaut (Mindestversion 27.0, keine Rückfallebenen für ältere Systeme). Komplett native SwiftUI-App (kein WebView) über dem Rust-Kern (`core/impala-ffi`, UniFFI) – das
iOS-Gegenstück zur Android-App. Es gelten dieselben Regeln wie in `android/PORTING.md` §1: Aussehen und
Verhalten der PWA übernehmen, native Bausteine statt Eigenbau, keine Logik nachbauen, die im Kern liegt.
Die Oberfläche folgt dem Tablet-Layout der PWA (Vorlage: `android/…/ui/desk/`, die es schon nachbaut);
`android/UI-INVENTAR.md` dient als Liste der Bildschirme.

## Oberfläche: PWA + Apple-Feinschliff

- **Wie die PWA**: Farben (`Theme/Tokens.swift`), Abstände, Schriftgrößen und Icons (`web/icons.svg` →
  `Assets.xcassets`, `npm run ios:icons`). Seitenleiste mit Pillen Home · Chat · Karten · Suche,
  Favoriten, Arbeitsbereichen und Fußleiste; Tab-Leiste mit ☰, Chips und „+“; Startseite, Notiz mit
  Brotkrumen und großem Titel. Texte wörtlich aus der PWA.
- **Geräteübergreifend wie in der PWA**: offene Tabs (`uiTabs`) und Aufklapp-Zustand des Baums
  (`treeOpen`) liegen im Kern und synchronisieren mit.
- **Apple-Feinschliff**: Liquid Glass nur für schwebende Bedienelemente (`impalaGlass`, z. B. die
  Blätter-Leiste im Heft), Seitenleiste über `NavigationSplitView`,
  Kontextmenüs (Halten) statt ⋯-Popover, Sheets für Suche/Papierkorb, Hover-Effekt mit Trackpad,
  PencilKit-Werkzeugpicker im Heft.
- **Animationen (Apple-Federn statt CSS-Kurven)**: aktive Pille, Baumzeile und Tab-Markierung gleiten
  (`matchedGeometryEffect`), Pillen-Label mit Blur-Übergang, Baum klappt weich auf, Tabs federn
  herein/heraus, Tabwechsel blendet über, Sheets zoomen aus ihrem Knopf (`navigationTransition(.zoom)`),
  Heftseiten schieben in Blätterrichtung, Seitenzahl zählt (`numericText`), Startseite erscheint
  gestaffelt (`riseIn` wie `hv-in`), Haptik bei Auswahl. „Bewegung reduzieren“ wird beachtet.

## Aufbau

```
ios/
├─ project.yml                 XcodeGen (das .xcodeproj wird erzeugt, nicht committet)
├─ Bindings/                   C-Header + module.modulemap des Kerns (erzeugt)
├─ Frameworks/libimpala_ffi.a  Kern fürs Gerät (erzeugt, nur macOS/CI, nicht committet)
└─ Impala67/
   ├─ App/                     Einstieg, Kern öffnen, Checkpoint im Hintergrund
   ├─ Core/ImpalaStore.swift   Änderungs-Meldungen des Kerns → Revisionen für die Ansichten
   ├─ Core/Generated/          Swift-Bindings (erzeugt, nie von Hand ändern)
   ├─ Assets.xcassets/         Icons aus web/icons.svg (erzeugt: npm run ios:icons)
   ├─ Theme/                   Farben, Maße, Icon, Liquid Glass (impalaGlass)
   ├─ Shell/                   Seitenleiste, Seitenbaum, Tab-Leiste, Suche, Papierkorb (ShellModel: Tabs)
   ├─ Home/                    Startseite (erster Teil)
   ├─ Notes/                   Notiz (vorerst Markdown als Text)
   ├─ Sync/SyncController.swift Cloudflare Live-Sync: WebSocket, Ping, Neuaufbau (Ablauf im Kern)
   ├─ Settings/                Einstellungen (bisher: Cloudflare Live-Sync)
   └─ Heft/                    PencilKit-Heft
```

## Heft und Sync

PencilKit zeichnet nur. Gespeichert wird ausschließlich das Strichformat des Kerns (`HeftStroke`:
`pen`/`marker`, CSS-Farbe, Breite, `[x, y, druck, …]`), damit PWA, Android und iPad dieselben Hefte
zeigen und der Sync unverändert bleibt. `HeftCanvas` vergleicht nach jeder Änderung die Zeichnung mit
dem letzten Stand (Schlüssel: `PKStroke.randomSeed`, für Kern-Striche aus der ID abgeleitet) und ruft
`heftAddStroke`, `heftRemoveStrokes` bzw. `heftMoveStrokes` (Lasso). Papier (liniert, kariert, Punkte,
leer) wie `drawPaper` in heft.js als Vektor-Ebene hinter den Strichen (`HeftPaper.swift`). Breiten wie die PWA (`segW` in
`web/heft.js`), Marker halbtransparent mit dreifacher Breite. Fremde Änderungen bauen die Seite neu auf.

## Sync

Wie `CloudSyncController.kt`: Abrufen, Verschlüsseln, Konflikte und Dateien macht der Kern (`CloudSync`,
HTTP über ureq/rustls im Rust-Code). Die App hält nur den WebSocket (`URLSessionWebSocketTask`), Ping,
Neuaufbau mit wachsender Pause und Wiederholversuche, verbindet im Vordergrund und schließt den
Socket im Hintergrund. Schlüssel und URL stehen wie in der PWA in den Kern-Einstellungen
(`cfUrl`, `cfSyncKey`); gekoppelt ist das Gerät, wenn der Schlüssel zusätzlich in `UserDefaults` liegt.

## Bauen ohne Mac

```bash
npm run build:ios-core   # nach Änderungen in core/impala-ffi: Swift-Bindings neu erzeugen und committen
```

Unter Windows/Linux entstehen nur die Bindings. Die App baut der Workflow `iPad-App bauen`
(`.github/workflows/ios-build.yml`) auf einem macOS-Runner, bei jedem Push mit Änderungen in `ios/`
oder `core/impala-ffi/`, oder von Hand über „Run workflow“. Ergebnis ist das Artefakt `Impala67-ipa`
mit einer unsignierten `Impala67.ipa`.

Installieren mit kostenloser Apple-ID über **Sideloadly** (PC) oder **AltStore/SideStore**. Die
Signatur gilt 7 Tage und muss dann erneuert werden.

## Offen

- Noch nicht auf einem Gerät gebaut oder getestet (erster CI-Lauf steht aus).
- Sync: QR-Kopplung, automatisches Koppeln bei neuem Schlüssel aus den Einstellungen, Konflikt-Ansicht,
  Hintergrund-Sync (BGTaskScheduler). Drive, Karten, KI, weitere Einstellungen.
- Notiz-Editor mit Blöcken (`markdownToBlocks`) statt Rohtext.
- Heft: Papierwahl für neue Seiten, Seitenübersicht, Bilder und Textfelder, Formerkennung,
  Handschrift → Text, Farben der PWA-Palette im Werkzeugpicker.
- App-Icon; Startseite: Lernzeit, Karten, Tagesartikel.
- Chat, Karteikarten, Bibliothek, Wissensgraph, Gemini Notebook (Pillen/Fußleiste zeigen Platzhalter).
- Seitenbaum: Ziehen zum Verschieben, Duplizieren, Verschieben nach…, Vorlagenwahl bei „Neu“.
