# Native iPad-App

Komplett native SwiftUI-App (kein WebView) über dem Rust-Kern (`core/impala-ffi`, UniFFI) – das
iOS-Gegenstück zur Android-App. Es gelten dieselben Regeln wie in `android/PORTING.md` §1: Aussehen und
Verhalten der PWA übernehmen, native Bausteine statt Eigenbau, keine Logik nachbauen, die im Kern liegt.
Die Oberfläche folgt dem Tablet-Layout der PWA (links Seitenleiste, rechts die Seite);
`android/UI-INVENTAR.md` dient als Liste der Bildschirme.

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
   ├─ Theme/                   Farben der PWA (wie Tokens.kt)
   ├─ Shell/                   NavigationSplitView, Seitenleiste mit Seitenbaum
   ├─ Notes/                   Notiz (vorerst Markdown als Text)
   └─ Heft/                    PencilKit-Heft
```

## Heft und Sync

PencilKit zeichnet nur. Gespeichert wird ausschließlich das Strichformat des Kerns (`HeftStroke`:
`pen`/`marker`, CSS-Farbe, Breite, `[x, y, druck, …]`), damit PWA, Android und iPad dieselben Hefte
zeigen und der Sync unverändert bleibt. `HeftCanvas` vergleicht nach jeder Änderung die Zeichnung mit
dem letzten Stand (Schlüssel: `PKStroke.randomSeed`, für Kern-Striche aus der ID abgeleitet) und ruft
`heftAddStroke`, `heftRemoveStrokes` bzw. `heftMoveStrokes` (Lasso). Breiten wie die PWA (`segW` in
`web/heft.js`), Marker halbtransparent mit dreifacher Breite. Fremde Änderungen bauen die Seite neu auf.

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
- Sync (Cloudflare, `SyncCore` + URLSession-WebSocket), Drive, Suche, Karten, KI, Einstellungen.
- Notiz-Editor mit Blöcken (`markdownToBlocks`) statt Rohtext.
- Heft: Papiermuster (liniert/kariert), Seitenübersicht, Bilder und Textfelder, Formerkennung,
  Handschrift → Text, Farben der PWA-Palette im Werkzeugpicker.
- App-Icon, Startseite.
