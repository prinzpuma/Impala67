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
   ├─ Notes/                   Notiz-Editor mit Blöcken (NoteModel: Block-Operationen, Speichern)
   ├─ Sync/SyncController.swift Cloudflare Live-Sync: WebSocket, Ping, Neuaufbau (Ablauf im Kern)
   ├─ Settings/                Einstellungen (bisher: Cloudflare Live-Sync)
   └─ Heft/                    PencilKit-Heft
```

## Notiz-Editor

Wie `android/…/editor/`: Der Kern zerlegt den Seiteninhalt in Blöcke (`markdownToBlocks`) und schreibt
sie zurück (`blocksToMarkdown` → `updatePage`, 600 ms nach dem Tippen bzw. beim Verlassen). Die App
kennt nur die Bedien-Operationen (`NoteModel`, `NoteCommands.swift`):

- **Tippen**: Enter teilt den Block (Listen und Zitate setzen sich fort, Enter in leerer Zeile beendet
  die Liste), Shift+Enter bricht weich um, Rücktaste am Anfang rückt aus, macht zum Absatz oder
  verschmilzt, Kürzel wie `# `, `- `, `1. `, `[] `, `> ` wandeln einen Absatz um. Eingabefeld ist eine
  `UITextView` (`BlockTextView`), weil nur sie Rücktaste am Anfang, Auswahl und Tastenkürzel meldet.
- **Inline-Markdown** (`InlineMarkdown.swift`, wie editor-inline.js): fett, kursiv, unterstrichen,
  durchgestrichen, `==Markierung==`, Farben `{red}…{/}`/`{bg-red}…{/}`, Code, Links, `[[Wiki-Links]]`
  und Formeln. Anzeige ohne Marker mit antippbaren Links (Seitenlinks öffnen den Tab), beim Tippen live
  formatiert mit abgeblendeten Markern.
- **Menüs**: „/“ öffnet das Slash-Menü (alle Einträge der PWA), „[[“ bzw. „Seite verlinken“ das
  Link-Menü; beide schweben über der Block-Leiste, ↑/↓ und Enter/Tab wählen.
- **Block-Leiste** (Liquid Glass): Verlauf, Fett/Kursiv/Unterstrichen/Durchgestrichen/Code/Markieren/Link,
  Blocktyp mit gleitender Markierung, Einzug, Löschen, Fertig; in Split View kompakt mit Menüs.
- **Hardware-Tastatur**: Tab/Shift+Tab rückt ein/aus (im Code zwei Leerzeichen), ↑/↓ wechseln den
  Block, Entf am Ende verschmilzt mit dem nächsten, ⌘B/I/U/E, ⌘⇧S/H, ⌘K, ⌘Z/⌘⇧Z, ⌘D,
  ⌘⇧↑/↓ verschiebt, Esc schließt Menü bzw. Bearbeitung.
- **Blockmenü** (Halten bzw. Griff „⋮⋮“ links vom aktiven Block): Umwandeln in, Farbe (Text/Hintergrund),
  Duplizieren, Als Markdown kopieren/bearbeiten, Nach oben/unten, Lernkarte erstellen, Löschen. Am Griff
  ziehen verschiebt den Block.
- **Besondere Blöcke**: Formeln, Inline-Formeln, Mermaid und SVG zeichnet eine WebView mit KaTeX bzw.
  Mermaid vom CDN (gleiche Versionen und Prüfsummen wie die PWA, beim ersten Mal Internet nötig;
  `RichView.swift`), beim Bearbeiten mit Live-Vorschau. Tabellen werden direkt in Zellen bearbeitet
  (`TableEditor`, „+ Zeile“/„+ Spalte“). Bilder (Fotos), PDFs und Dateien kommen über das Slash-Menü in
  den Kern (`addFile`); Dateien öffnen in Quick Look. Callouts, Toggles und Spalten zeigen ihre Kinder;
  ändern über „Als Markdown bearbeiten“.
- **Rund um die Seite**: „N Rückverweise“ unter dem Titel (aufklappbar), Unterseiten am Ende.

## Heft und Sync

PencilKit zeichnet nur. Gespeichert wird ausschließlich das Strichformat des Kerns (`HeftStroke`:
`pen`/`marker`, CSS-Farbe, Breite, `[x, y, druck, …]`), damit PWA, Android und iPad dieselben Hefte
zeigen und der Sync unverändert bleibt. `HeftCanvas` vergleicht nach jeder Änderung die Zeichnung mit
dem letzten Stand (Schlüssel: `PKStroke.randomSeed`, für Kern-Striche aus der ID abgeleitet) und ruft
`heftAddStroke`, `heftRemoveStrokes` bzw. `heftMoveStrokes` (Lasso). Papier (liniert, kariert, Punkte,
leer) wie `drawPaper` in heft.js als Vektor-Ebene hinter den Strichen (`HeftPaper.swift`). Breiten wie die PWA (`segW` in
`web/heft.js`), Marker halbtransparent mit dreifacher Breite. Fremde Änderungen bauen die Seite neu auf.

- **Seitenübersicht** (`HeftPagesSheet`, Tippen auf „n / m“, zoomt aus dem Knopf): Raster mit
  Vorschaubildern (`HeftThumbnail`: Papier, Bilder, Striche, Textfelder aus dem Kernformat), aktive Seite
  umrandet. Antippen springt, Ziehen sortiert um (`heftMovePage`, Ziel gestrichelt), Halten: Papier der
  Seite (`heftSetPaper`) und Löschen; „Auswählen“ löscht mehrere (`heftRemovePage`, eine Seite bleibt).
- **Neue Seite** („+“ in der Leiste bzw. in der Übersicht): Tippen nimmt das Papier der letzten Seite,
  Halten bietet Liniert/Kariert/Punkte/Blanko (`heftAddPage(paper:)`).
- **Farben** der PWA-Palette (heft-tools.js `COLORS`) als schwebende Glas-Leiste mit gleitendem Ring;
  die Wahl landet über `PKToolPicker.selectedTool` im Werkzeugpicker, Farbwechsel im Picker kommen zurück.
  Standard wie die PWA: Stift `#1c1c1e`, Marker `#f5b800`, Dicke 3. In schmalen Fenstern nur der Picker.
- **Bilder und Textfelder** (`HeftObjects.swift`, nur Anzeige): Bilder unter, Textfelder über den
  Strichen wie `renderPageTo`; Bilder über `heftImageData`, per ImageIO verkleinert und zwischengespeichert,
  Text wie `drawTextBox` (gerundete Schrift 500, Zeilenhöhe 1,4, Innenabstand 10).
- **Formerkennung**: Wird der Stift am Strichende ~0,45 s gehalten (`HoldWatcher`), erkennt der Kern
  eine Form (`heftFitShape`: Linie, Rechteck, Dreieck, Pfeil, Ellipse); der Strich wird dann durch die
  Form ersetzt (`heftAddShape`, gespeichert wie in PWA/Android als `shape` ohne Punkte). Formen anderer
  Geräte zeichnet die App über `heftShapeOutline`. Anders als in der PWA rastet die Form erst beim
  Loslassen ein (PencilKit meldet den Strich erst am Ende).

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
- Notiz-Editor: Kinder von Callouts, Toggles und Spalten direkt bearbeiten (bisher als Markdown),
  Datenbank-Ansicht, „Verwandt“-Leiste, Mehrfachauswahl von Blöcken, Einfügen von Bildern aus der
  Zwischenablage bzw. per Drag & Drop von außen.
- Heft: Bilder und Textfelder bearbeiten (anlegen, verschieben, löschen), Import von PDFs/Fotos,
  Export, Verlauf, Handschrift → Text, Formvorschau während des Haltens, Dicken der PWA (`SIZES`).
- App-Icon; Startseite: Lernzeit, Karten, Tagesartikel.
- Chat, Karteikarten, Bibliothek, Wissensgraph, Gemini Notebook (Pillen/Fußleiste zeigen Platzhalter).
- Seitenbaum: Ziehen zum Verschieben, Duplizieren, Verschieben nach…, Vorlagenwahl bei „Neu“.
