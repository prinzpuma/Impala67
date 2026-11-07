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
  Kontextmenüs (Halten) statt ⋯-Popover, Sheets für Suche/Papierkorb, Hover-Effekt mit Trackpad.
  Im Heft ist Apples Werkzeugleiste (PencilKit) die einzige Werkzeug- und Farbwahl.
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
   ├─ App/                     Einstieg (AppModel: Kern, Sync, Drive), Checkpoint, Hintergrund-Sync
   ├─ Core/ImpalaStore.swift   Änderungs-Meldungen des Kerns → Revisionen für die Ansichten
   ├─ Core/Generated/          Swift-Bindings (erzeugt, nie von Hand ändern)
   ├─ Assets.xcassets/         Icons aus web/icons.svg (npm run ios:icons), AppIcon aus web/icon.svg (npm run ios:app-icon)
   ├─ Theme/                   Farben, Maße, Icon, Liquid Glass (impalaGlass)
   ├─ Shell/                   Seitenleiste, Seitenbaum (Ziehen: TreeDrop), Tab-Leiste, Suche, Papierkorb,
   │                           PageOps (Neu/Vorlage, Duplizieren, Verschieben, PDF-Import), ShellModel: Tabs
   ├─ Library/                 Bibliothek wie die PWA (Notion, GoodNotes, Archiv, Gemini Notebook), PDFKit-Ansicht
   ├─ Home/                    Startseite, Lernzeit (Auswertung + Erfassung), Tagesartikel, „Startseite anpassen“
   ├─ Graph/                   Wissensgraph (Canvas, Kraftmodell), Gemini Notebook
   ├─ Notes/                   Notiz-Editor mit Blöcken (NoteModel: Block-Operationen, Speichern), MarkdownView
   ├─ Cards/                   Karteikarten: Stapelbaum, Übersicht, Lernen (ReviewModel), Karten-Editor
   ├─ Sync/                    Cloudflare Live-Sync (SyncController), QR-Kopplung, Konflikte, Drive-Backup
   ├─ Chat/                    KI-Chat: ChatModel (Rückrufe des Rust-Assistenten), Panel, Chat-Liste, KI-Einstellungen
   ├─ Settings/                Einstellungen wie die PWA: Bereiche links (Übersicht, Darstellung, KI, Lernen,
  │                           Sync & Backup, App & Speicher), Inhalt rechts (NavigationSplitView)
   └─ Heft/                    PencilKit-Heft
```

## Seitenbaum

Wie `DeskTree.kt`/`TreeDrag.kt`: Reihenfolge, Zyklen und Arbeitsbereiche prüft der Kern (`movePage`,
`movePageToWorkspace`); die App wählt nur das Ziel.

- **Ziehen**: Halten öffnet das Menü, Halten und Ziehen hebt die Zeile an (System-Drag mit Karte als
  Vorschau). Oberes/unteres Viertel einer Zeile legt davor/danach ab (Akzentlinie), die Mitte hinein
  (getönte Fläche, der Ast klappt auf), ein Arbeitsbereich-Kopf oder „Keine Seiten“ an dessen Wurzel.
  Haptik beim Ablegen, Zeilen gleiten an ihren Platz. Das Ziehobjekt ist Text mit Präfix `impala-page:`,
  fremder Text verschiebt nichts.
- **Menü**: zusätzlich „Duplizieren“ (samt Unterseiten, „(Kopie)“ wie `duplicatePage`) und „Verschieben
  nach…“ (Sheet mit Arbeitsbereichen und Seiten, ohne eigenen Unterbaum, jetziger Ort abgehakt).
- **Neu** („+“ im Baum, in der Tab-Leiste und auf der Startseite): Notiz, Heft und darunter „Aus Vorlage“
  (als Vorlage markierte Seiten; Titel, Inhalt, Icon, Schlagwörter wie `data-tpluse`).

## Bibliothek

Wie web/library.js eine **Hauptansicht** (kein Fenster; `ShellModel.libraryOpen` wie `S.view = "library"`,
jedes Öffnen eines Tabs schließt sie). Oben Titel und Ansichten (`LibraryMode`): **Notion** (Seitenbaum je
Arbeitsbereich, Filter Alle/Favoriten/PDFs/Vorlagen mit Anzahl, Klappzustand wie die Seitenleiste),
**GoodNotes** (Heft-Regal mit Covern `COVER_PRESETS`, „Neu“ mit Name und Cover, ••• Heftoptionen: Cover,
Archivieren, Papierkorb), **Archiv** (Filter Alle/Seiten/Hefte, „Aus Archiv holen“), **Gemini Notebook**.
Darunter immer dieselbe Werkzeugzeile: links Filter, rechts Suche. Ordner des Heft-Regals (`gnFolders`)
fehlen noch in der UniFFI-Schnittstelle; die Hefte stehen deshalb flach.
Halten: Öffnen, Als Seite öffnen (PDF), Favorit, Archivieren, Papierkorb. Antippen öffnet das PDF **nativ mit PDFKit**
(zoomt aus der Zeile; fortlaufend, an die Breite angepasst, Seitenzahl „n / m“ in Liquid Glass, Teilen,
„Als Seite öffnen“). Fehlt die Datei noch (Sync), steht „PDF nicht gefunden“. „PDF hinzufügen“ nimmt
mehrere PDFs über den Dateiimporter: Datei in den Kern (`addFile`), Seite mit `pdfId` (`pageCreate`,
Zusammenfassungs-Platzhalter wie `PDFS.ingest` ohne KI); das letzte öffnet sich gleich.

## Performance-Profiler

`App/Profiler.swift` wie web/performance-profiler.js (Einstellungen → App & Speicher → Für Entwickler,
Schalter `impala67PerformanceProfiler`, standardmäßig aus): nur Auffälligkeiten – Hänger des Hauptthreads
über 100 ms (Wachhund-Thread, alle 250 ms), Fehler des Rust-Kerns, Sync- und KI-Fehler, Start über 1,5 s.
Gleiche Einträge (Art, Name, Meldungsanfang, Version) werden zusammengefasst, höchstens 180, gespeichert in
`impala67-performance.json` (Application Support). Kopieren und Teilen als JSON. Kern-Aufrufe laufen über
`attempt("name", { try core.…() })` statt `try?`, damit Fehler mit Aufrufstelle im Protokoll landen.

## MCP-Bridge (WLAN)

`App/DevBridge.swift` wie web/mcp-bridge.js: Mit der Adresse aus `node mcp/lan-setup.mjs`
(Einstellungen → App & Speicher → Für Entwickler, leer = aus) verbindet sich die App im Vordergrund mit dem
MCP-Server auf dem PC. Werkzeuge: Diagnose (Ansicht, Tabs, Speicher, Wärme, Profiler-Kontext),
Performance-Trace (dieser Profiler, ein/aus/leeren), Seiten, Suche, UI-Aktionen und `impala_screenshot`.
Kein `impala_eval` (kein JavaScript). Lokales Netzwerk und `ws://` erlaubt `project.yml`
(`NSLocalNetworkUsageDescription`, `NSAllowsLocalNetworking`).

## App-Icon

`npm run ios:app-icon` (`tools/ios-app-icon.mjs`) zeichnet `web/icon.svg` mit Chrome/Edge (puppeteer-core,
Pfad notfalls über `CHROME_BIN`) randlos als 1024×1024-PNG ohne Alphakanal in
`Assets.xcassets/AppIcon.appiconset`; die Ecken rundet iOS. `project.yml` setzt
`ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon`.

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
  den Kern (`addFile`); Dateien öffnen in Quick Look. Bilder lassen sich auch aus der Zwischenablage einfügen
  (nur Bild, kein Text) oder aus anderen Apps hineinziehen (hinter den aktiven Block bzw. ans Ende).
- **Callouts, Toggles und Spalten**: Kinder sind normale Blöcke – antippen, tippen, Enter teilt, Rücktaste
  verschmilzt, Blockmenü und Slash-Menü wirken in der jeweiligen Liste (`siblings`/`withSiblings` in
  `BlockOps.swift`). Enter im leeren letzten Absatz schreibt hinter dem Kasten weiter; eine Kind-Liste
  bleibt nie leer.
- **Rund um die Seite**: „N Rückverweise“ unter dem Titel (aufklappbar), Unterseiten am Ende.

## Startseite

Wie `homeViewHtml` (home-view.js) und `android/…/home/`:

- **Kopf**: Datum, „+ Neue Seite“ und Zahnrad „Startseite anpassen“ (Sheet: Begrüßungsname, Tagesartikel
  an/aus, Themen – in den Kern-Einstellungen `homeUserName`/`homeArticle`/`homeArticleTopics`, also
  synchronisiert –, dazu das Wochenziel).
- **Begrüßung** mit Namen, Satz zu den Karten (Kartenzahl als Link startet das Lernen) und dem Lernzeit-Satz
  wie `nudge` (Streak in Gefahr > Ziel in Reichweite > Ziel geschafft > heute gelernt).
- **Rechts** (schmal darunter): „Heute fällig“ und „Diese Woche gelernt“ (`WeekStat`): Summe „von 5 h“ bzw.
  „· Ziel geschafft“, Zielbalken, Tagesbalken Mo–So (heute Akzent, spätere Tage blass), Streak-Satz
  („3 Tage am Stück“ / „Heute lernen startet einen Streak“), „Ziel ändern“ schaltet 2/5/8/12 h. Balken wachsen
  beim Erscheinen gestaffelt mit Feder, Zahlen zählen (`numericText`). Wochenziel nur auf diesem Gerät
  (`weekGoalMinutes`, wie localStorage der PWA).
- **Lernzeit** (`LearningTime.swift`): Auswertung wie lernzeit.js (überlappende Abschnitte mehrerer Geräte
  zählen einmal, Streak ab 5 Minuten am Tag) über `learningSessions` des Kerns. Erfasst wird beim
  **Kartenlernen** (`.learningTime(...)` an `ReviewScreen`, Kategorie `cards`, Quelle Stapel): Abschnitte
  beim Öffnen/Verlassen und im Hintergrund, nach 60 s ohne Eingabe Pause mit Glas-Pille „Lernst du
  noch?“, nach 15 min Pause neue Sitzung; gespeichert über `saveLearningSession` (synchronisiert).
- **Tagesartikel** (`HomeArticle.swift`, wie home-article.js): ungelesen als aufklappbare Karte (Thema, Titel,
  Anriss `markdownTeaser`, Text über `MarkdownView`, Quellen-Pillen, „Gelesen“ → `markHomeArticleRead`),
  gelesen nur der Hinweis mit „Nochmal lesen“, Verlauf als Sheet. Fehlt der heutige Artikel, schreibt das
  iPad einmal je App-Start einen über den Rust-Assistenten (`AiAssistant.complete`, Anweisung wörtlich wie
  die PWA) und speichert ihn mit `saveHomeArticle`; „Kein Tagesartikel: … Erneut versuchen“ bei Fehlern.
  Die Notiz-Auswahl ist vereinfacht (ohne Fach-Erkennung `FACH`: Thema aus den Einstellungen, sonst alle
  Notizen; unbenutzte und neueste zuerst) – Kandidat für den Kern.

## Wissensgraph und Gemini Notebook

- **Wissensgraph** (Fußleiste, Sheet, `Graph/`): Seiten als Punkte, Kanten aus dem Kern (`pageLinks`: Seite
  erwähnt den Titel einer anderen – Regel der Rückverweise – bzw. Eltern → Unterseite, gestrichelt). Layout
  in der App als Kraftmodell wie d3-force (Abstoßung, Federn, Zug zur Mitte, Abkühlung), das sichtbar
  aufblüht und sich danach einpasst. Gezeichnet mit `Canvas`; Pinch zoomt um die Finger, Ziehen verschiebt,
  Ziehen auf einem Punkt zieht den Punkt (Modell wärmt kurz an), Antippen öffnet die Seite, Trackpad-Zeigen
  hebt Seite und Nachbarn hervor. Punktgröße nach Verbindungen, Notizen Akzent, Hefte Grün, Beschriftung je
  nach Zoom. Glas-Pille unten mit „N Seiten · M Verbindungen“, Menü: Unterseiten verbinden, Seiten ohne
  Verbindung, Einpassen. Hinweis: Der „Wissensgraph“ der PWA (graph.js) ist ein Skill-Graph aus Karteikarten
  (Embeddings + KI); den gibt es auf dem iPad noch nicht.
- **Gemini Notebook** (Fußleiste und Tab `nlm:main`, wie `renderPane`): Erklärung, „Seiten als Quelle
  kopieren…“ (Auswahl mit Suche und Häkchen → ein Text `# Titel` + Inhalt, getrennt durch `---`, in die
  Zwischenablage, dann öffnet Gemini Notebook), „Gemini Notebook öffnen“ (extern). Die Download-Inbox der
  PWA (IndexedDB, nicht synchronisiert) gibt es nicht; Dateien kommen über „/Datei“ in eine Notiz.

## Karteikarten

Wie `android/…/study/` und `web/render-anki.js`. Planung, Intervalle und FSRS macht der Kern
(`studyQueue`, `reviewPreview`, `reviewCard`, `deckOverview`); die App merkt sich nur, welche Karte liegt
und ob sie umgedreht ist (`ReviewModel`, Karte bleibt bis zur Bewertung festgepinnt). Zustand des
Karten-Tabs `anki:main` (Übersicht/Lernen/Kartenliste), Dialoge und Editor liegen in `CardsModel`
(`ShellModel.cards`); Änderungen meldet der Kern über `ImpalaStore.cardsRevision`.

- **Seitenleiste** (Pille „Karten“): Stapelbaum mit Unterstapeln (einklappbar), Zählern für fällig
  (Akzent) und neu (Grün), „Übersicht“ und „+“ für neue Stapel. Antippen lernt den Stapel, Halten öffnet
  das Stapelmenü: Lernen, Feynman-Modus, Neue Karte, Karten ansehen, Unterstapel, Umbenennen, Optionen,
  Duplizieren, Archivieren, In Papierkorb (Standard-Stapel nicht umbenenn-/löschbar).
- **Übersicht**: Kopf wie die PWA mit „Statistik“, „Optionen“ und „＋ Neu“ (Neue Karte, Neuer Stapel,
  Import, Export). Satz „N Karten warten auf dich, etwa X Minuten“ (Zahl startet das Lernen), „Gemischt“
  und „Feynman-Modus“, Kacheln „Heute fällig“ und „Neue Karten“, Stapel-Liste mit Zählern, „Lernen“ und ⋯-Menü.
- **Stapel-Optionen** (`DeckOptionsSheet`, wie `openDeckConf`): neue Karten und Wiederholungen pro Tag,
  Leech-Schwelle und -Aktion; „*“ für alle Stapel, Unterstapel erben (`deckConfig`/`setDeckConfig`/
  `resetDeckConfig` im Kern).
- **Statistik** (`StatsScreen`, wie anki-stats.js/`StatsData.kt` aus `learningStatsJson`): Satz mit Trend,
  Trefferquote, Wiederholungen pro Tag, Serie, reife Karten, Swift-Charts für die letzten 30 Tage und die
  Prognose der nächsten 7 Tage, Lernbestand, Behalten nach Abstand, Stapel-Tabelle, schwierigste Karten.
- **Import/Export** (`CardIoSheet`, `CardText.swift` wie extras.js/`CardText.kt`): Impala-TXT (empfohlen),
  CSV/TSV und Anki-Text mit Prüfansicht (Format, Karten, Stapel, Duplikate, Probleme, Vorschau) und
  „KI-Anweisung kopieren“; Export als TXT oder CSV über das Teilen-Blatt. Anki-Pakete (.apkg) noch nicht.
- **Feynman-Modus** (`Feynman.swift`, wie experimente.js `checkFeynman`): unter der Frage ein Erklär-Feld
  (tippen oder diktieren, ⌘↩), „Prüfen & aufdecken“ lässt die KI gegen die Rückseite prüfen (gleicher
  Prompt wie die PWA) und zeigt die Rubrik samt Notenvorschlag über den Bewertungen; „Ohne Erklärung
  aufdecken“ statt „Antwort zeigen“.
- **Lernen**: Fortschrittsbalken, Stapel/Stufe, Karte dreht sich bei „Antwort zeigen“ über die Y-Achse
  (Feder, Wechsel genau auf der Kante; „Bewegung reduzieren“: Überblenden). Vorder- und Rückseite zeigt
  `MarkdownView` mit den Blöcken des Notiz-Editors (Formeln, Code, Tabellen, Bilder, Lückentext-Fett).
  Bewertungen Nochmal/Schwer/Gut/Einfach mit Intervallen als getönte Liquid-Glass-Knöpfe; „Antwort
  zeigen“ verwandelt sich in „Gut“ (`glassEffectID`). Nächste Karte schiebt herein, Haptik beim Umdrehen
  und Bewerten. Tastatur: ␣ Antwort/Gut, 1–4, ⌘Z rückgängig. Bearbeiten, Aussetzen, Ende-Ansichten
  „Gratulation!“/„Geschafft!“ (mit „Erneut prüfen“).
- **Karten**: Editor-Sheet (Stapel wählen oder neu, Vorder-/Rückseite mit Vorschau, „［…］ Lücke
  einfügen“ an der Markierung, „Als Lückentext speichern“ → `createClozeCards`, Löschen in den
  Papierkorb). „Karten ansehen“: Liste mit Suche, Wischen/Halten zum Aussetzen und Löschen.
- **Startseite**: Satz zu den Karten wie `homeViewHtml` und Kachel „Heute fällig“ (fällig / alles gelernt
  / keine Karten), im breiten Fenster rechts neben „Weitermachen“.

## KI-Chat

Wie `android/…/ai/`: Agent-Schleife, Werkzeuge, Rückfragen, Rückgängig und Speichern der Chats macht der
Kern (`AiAssistant.runAsync`, `undoAiChange`, `chats`/`chat`/`saveChat`). `ChatModel` sammelt nur die
Rückrufe (`AiListener`: Entwurf und Gedankengang je Durchlauf der Haupt-Queue zusammengefasst, Werkzeug,
neue Einträge) und setzt `AiPlatform` um: Rückfragen blockieren den Lauf-Thread bis zur Antwort im Chat,
`view_heft_page` bekommt die Heftseite als JPEG (`HeftThumbnail`, Seite aus `HeftLastPage`).

- **KI-Panel rechts** („KI-Coach“, 340 pt): Status-Chip „KI online/offline“, Verlauf, Neuer Chat, In
  eigenem Tab öffnen, Einklappen. Eingeklappt: Sparkles-Knopf unten rechts in Liquid Glass (⌘J), Panel
  federt von rechts herein; Zustand gemerkt (nur dieses Gerät). Die offene Notiz bzw. das Heft geht als
  Kontext mit (Chip, ✕ schaltet ab; „Anfang mitgesendet (x von y Zeichen)“).
- **Chat**: Begrüßung mit Vorschlägen, Nutzerblasen mit Stift (Text zurück ins Feld, Verlauf ab dort weg;
  gesperrt bei nicht zurückgenommenen Änderungen), Antworten als Markdown über `MarkdownView` (Blöcke des
  Notiz-Editors, auch der gestreamte Entwurf), „Kopieren“ und „Anpassen“ (Länger/Gleich/Kürzer über
  `refine`), Gedankengang ein-/ausklappbar, Werkzeug-Chips mit Texten wie `TOOL_LABELS`, Änderungs-Karten
  mit „↺ Rückgängig“, Rückfrage-Karten, Fehler mit Weg zu den Einstellungen. Eingabeleiste in Liquid
  Glass: 📎 (Foto, Datei oder PDF, „Heftseite anhängen“ im offenen Heft), Diktat (🎤, `Dictation.swift`:
  Speech auf dem Gerät, Text landet im Feld), Modellmenü (Modelle je Quelle, Gedankengang), Senden ↔ Stopp
  morphen (`glassEffectID`), Enter sendet, Shift+Enter bricht um, ⌘↩ / ⌘. . Anhänge (`ChatAttach.swift`)
  gehen wie in der PWA als `image` (JPEG-Data-URL, 1600 px), `textFile` bzw. `pdfFile` (PDF-Text über
  PDFKit, höchstens 120 000 Zeichen) an den Kern; die eigene Blase zeigt Bild bzw. Dateiname.
- **Seitenleiste** (Pille „Chat“): „Neuer Chat“, gespeicherte Chats mit gleitender Markierung; Halten: In
  eigenem Tab öffnen, Umbenennen, Löschen. Tab `chat:<id>` zeigt den Chat breit (Titel im Tab).
- **Einstellungen → KI**: aktives Modell (Liste aller Quellen, Suche, manuelle Modell-ID), Quellen (Name,
  Server-URL, API-Key, „Verbindung testen“, Voreinstellungen Impala AI/LM Studio/Gemini/OpenAI),
  Verhalten (Tools mitsenden, Gedankengang, eigene Anweisungen). **API-Schlüssel nur im Schlüsselbund**
  (`AiKeychain`, `…ThisDeviceOnly`); in die Kern-Einstellungen gehen Quellen ohne `key` (der Kern behält
  dann einen von anderen Geräten synchronisierten). Der Assistent und `aiListModelsWith` bekommen die
  Quellen samt Schlüssel als JSON; „Impala AI“ nutzt den Sync-Schlüssel.

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
- **Neue Seite** („+“-Panel bzw. Übersicht): davor, danach oder am Ende, Papier per Vorschau
  (`heftAddPage(at:paper:)`); Hochziehen am Ende nimmt das Papier der letzten Seite.
- **Werkzeuge** nur über Apples Werkzeugleiste (`PKToolPicker`: Stift, Marker, Radierer, Lasso, Lineal,
  Farben, Rückgängig, „Mit Finger zeichnen“); Standard wie die PWA: Stift `#1c1c1e`, Marker `#f5b800`,
  Dicke 3. Keine eigene Farbleiste daneben. Oben links „n / m“ (Seitenübersicht; geblättert wird durch
  Scrollen), rechts „+“. Neue Textfelder nehmen die Farbe des aktuellen Stifts.
- **Papier sichtbar**: Der Canvas ist durchsichtig (`isOpaque = false`), sonst übermalt PencilKit das
  Papier mit seiner Hintergrundfarbe (schwarzes Heft im Dunkelmodus).
- **Bilder und Textfelder** (`HeftObjects.swift`): Bilder unter, Textfelder über den
  Strichen wie `renderPageTo`; Bilder über `heftImageData`, per ImageIO verkleinert und zwischengespeichert,
  Text wie `drawTextBox` (gerundete Schrift 500, Zeilenhöhe 1,4, Innenabstand 10).
- **Direkt auswählen** (`HeftSelectLayer`, wie heft-input.js): Zeichnet der Finger nicht, wählt ein
  Fingertipp ein Bild/Textfeld (seitenfüllende Scans nur per Halten); Halten mit dem Finger wählt immer und
  verschiebt gleich weiter. Der Stift zeichnet immer, ein neuer Strich hebt die Auswahl auf. Auf der
  Auswahl: Ziehen verschiebt, Griff skaliert (Bilder mit Seitenverhältnis, Textfelder in der Breite),
  Antippen eines Textfelds bearbeitet es; Leiste mit Löschen/Fertig (`heftSetImageFrame`, `heftSetText`,
  `heftRemoveImages`/`heftRemoveTexts`).
- **„+“-Panel** (wie `plusPopHtml` + `imgPopHtml`): „Text“ (`heftAddText` in der Mitte des Ausschnitts),
  „Bild“ (Fotos), „Foto aufnehmen“ (Kamera) – eingefügte Bilder sind danach gewählt. Handschrift in Text
  umwandeln macht die KI über das Seitenbild (kein Lasso „In Text“ mehr).
- **Seiten aus Dateien** (im „+“-Panel): „PDF oder Bilder importieren“ (je Bild bzw. PDF-Seite eine Seite;
  PDFKit rendert randlos mit 1800 px, eingebetteter Text wird Texterkennung der Seite) und „Dokument
  scannen“ (VisionKit-Dokumentenkamera, mehrere Seiten, entzerrt); neue Seiten landen hinter der aktuellen
  (`HeftImport.swift`).
- **Teilen** (in der Seitenübersicht wie PWA/GoodNotes): „Exportieren …“ (PDF oder PNG, aktuelle bzw. alle
  Seiten; jede Seite mit 2480 px, PDF-Gerüst aus dem Kern `heftBuildPdf`), „Internen Link kopieren“;
  „Auswählen“ → „Teilen (n)“ exportiert genau die gewählten Seiten.
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

- **QR-Kopplung** (`CloudflarePairing.swift`): gleiches Format wie PWA/Android
  (`https://prinzpuma.github.io/Impala67/#cf-pair=<Base64(JSON {url, key})>`; gelesen werden auch rohes
  JSON und reines Base64). „QR-Code scannen“ öffnet den VisionKit-Scanner (`DataScannerViewController`,
  Kamera-Hinweis in `project.yml`) und verbindet sofort; „Gerät koppeln (QR-Code)“ zeigt den Code
  (CoreImage) und „Kopplungs-Link kopieren“.
- **Automatisch koppeln** wie `autoConnect` in Android: Kommt ein neuer Schlüssel in die Einstellungen
  (z. B. über Drive) und ist das iPad nicht gekoppelt, verbindet es sofort. Ein schon bekannter Schlüssel
  (`cfSeenKey`, nach „Trennen“ oder beim ersten Start) verbindet nicht von selbst.
- **Konflikte** (`ConflictsSheet`, Texte aus conflict-ui.js wie `ConflictText.kt`): Liste, Empfehlung,
  Zeilenvergleich (`conflictDiffRows`) und Entscheidungen kommen aus dem Kern (`conflicts`,
  `resolveConflict`, `resolveConflictsRecommended`). Breit: Liste links mit gleitender Markierung, schmal:
  ‹ n / m › unten; „Nächste Änderung“, „Alle N Konflikte mit Empfehlung lösen“, Haptik beim Lösen. Auf der
  Startseite die gelbe Pille „N Sync-Konflikte warten auf deine Entscheidung. Lösen“ (zoomt ins Sheet),
  dazu ein Eintrag in den Einstellungen.
- **Hintergrund** wie `BackgroundSyncWorker`: `BGAppRefreshTask` `org.impala67.app.sync` (SwiftUI
  `.backgroundTask`, `UIBackgroundModes: fetch` und `BGTaskSchedulerPermittedIdentifiers` über `info:` in
  `project.yml`), frühestens stündlich, ein Durchgang ohne WebSocket (`backgroundPass`, höchstens 25 s),
  danach Checkpoint. Wann iOS ihn wirklich startet, entscheidet das System.

## Google-Drive-Backup

Wie `DriveController.kt`/web/drive.js: Ablauf, Formate und Konflikte im Kern (`DriveSync`). Die App
meldet sich mit OAuth 2.0 + PKCE über `ASWebAuthenticationSession` an (Bereich `drive.appdata`),
tauscht den Code selbst gegen Tokens und erneuert das Zugriffstoken still (`DriveTokens`). Das
Refresh-Token liegt nur im Schlüsselbund (`…AfterFirstUnlockThisDeviceOnly`), das Zugriffstoken nur im
Speicher; „Abmelden“ zieht den Zugriff bei Google zurück. Anderes Konto → `resetState`. Im Vordergrund
Sync beim Start und im Intervall (`driveAutoSyncMinutes`, Auswahl aus `driveSyncIntervalOptions`), beim
Wechsel in den Hintergrund wird das eigene Änderungspaket noch hochgeladen (`flushUpload`).

**Einrichtung (einmalig, Google Cloud Console)**: Im **selben Projekt** wie die Web-Client-ID der PWA
unter „APIs & Dienste → Anmeldedaten“ einen OAuth-Client vom Typ **iOS** mit Bundle-ID
`org.impala67.app` anlegen (Drive-API und Bereich `…/auth/drive.appdata` sind dort schon freigegeben).
Die Client-ID (`….apps.googleusercontent.com`, kein Geheimnis) in `ios/project.yml` bei
`GOOGLE_IOS_CLIENT_ID` eintragen. Solange dort der Platzhalter `DEINE_IOS_CLIENT_ID…` steht, ist
„Mit Google verbinden“ gesperrt und die Einstellungen sagen, was fehlt. Ein eigenes URL-Schema ist nicht
nötig (`ASWebAuthenticationSession` fängt `com.googleusercontent.apps.<id>:/oauth2redirect` selbst ab).

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
- Sync/Drive: Drive braucht noch die iOS-Client-ID (siehe oben). „Nach jeder Änderung synchronisieren“
  (`DriveAutoSync` im Kern), Hinweis „nicht gesichert“ auf der Startseite (`driveBackupView`), Drive im
  Hintergrund-Durchgang, Kopplungs-Link (`#cf-pair=`) als Universal Link öffnen, Verdichten, weitere
  Einstellungen.
- KI-Chat: Karteikarten-Kontext (`AiAnki`), ★-Favoriten im Modellmenü, Mehrfachauswahl in der
  Chat-Liste, `calculate`. Später: semantische Suche/RAG (lokales Embedding-Modell, `SemanticSearch`).
- Notiz-Editor: Datenbank-Ansicht, Mehrfachauswahl von Blöcken, Kopfzeile „Teilen ★ ⋯“ der PWA
  (Markdown/PDF-Export der Notiz). Später: „Verwandt“-Leiste (braucht den semantischen Index).
- Heft: Verlauf, Rückgängig für Bild-/Textfeld-Änderungen (PencilKit kennt nur Striche), Formvorschau
  während des Haltens, Dicken der PWA (`SIZES`), PNG-Export einzelner Seiten.
- Startseite: „Weißt du's noch?“, Lernanalyse (lernanalyse.js), Backup-Hinweis; Lernzeit auch in Notizen,
  Heft und Chat erfassen (bisher nur beim Kartenlernen), Pausen-Erinnerung nach 40 min.
- Karteikarten: Stapel ziehen zum Sortieren/Verschieben, Lern-Telemetrie (`teleEvent`), Archiv/Papierkorb
  für Karten, Anki-Pakete (.apkg), Heatmap und Lernanalyse der Statistik.
- Bibliothek: Ordner im Heft-Regal (braucht `gnFolders` in `core/impala-ffi`), eigene Cover-Bilder, PDF-KI-Zusammenfassung.
- Wissensgraph: Skill-Graph der PWA aus Karteikarten (`knowledgeGraph` in den Einstellungen, synchronisiert)
  anzeigen. Gemini Notebook: Download-Import/Inbox.
- Seitenbaum: Stapel (Karteikarten) ziehen, Mehrfachauswahl; Duplizieren ist App-Logik wie in Android
  (Kandidat für den Kern).
- App-Icon: dunkle/getönte Varianten (iOS 18+). Die Körnung in `web/icon.svg` färbt den ganzen
  Filterbereich grau (gedrehtes Rechteck hinter dem Heft) – das ist auch in der PWA so; bei Bedarf im SVG
  korrigieren und `npm run ios:app-icon` neu laufen lassen.
