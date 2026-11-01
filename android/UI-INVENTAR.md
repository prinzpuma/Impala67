# UI-Inventar: PWA → native Android-App

Vollständige Liste aller sichtbaren UI-Elemente der PWA (`web/`), jeweils mit Stand in der
Kotlin/Compose-App (`android/app/src/main/java/org/impala67/app/`). Grundlage für den schrittweisen
Nachbau. Regeln für die Umsetzung: `android/PORTING.md`.

Stand: 2026-11-01 (aus dem Code erhoben, nicht im Emulator geprüft). Zeilenangaben können veralten.

**Legende:** `[x]` = erledigt (✅ wie PWA) · `[ ]` = offen · ✅ vorhanden wie PWA · 🟡 teilweise/abweichend · ⬜ fehlt ·
➕ nur Android · ➖ entfällt nativ. Beim Abarbeiten Zeile auf `[x]` und ✅ setzen.

## Arbeitsreihenfolge (Vorschlag)

1. **Heft – sichtbare Fehler** (§ Heft, Abschnitt 0): Bilder/Scans/Textfelder zeichnen; Optionsleiste
   direkt unter die Kapsel (oben mittig); Farbpunkte und Farbfelder wie PWA; Marker nutzt Stiftfarbe;
   Werkzeugzustand speichern; Zoom 0,4–6; Einklappen und Schreib-Rückzug der Kapsel.
2. **Heft – fehlende Funktionen:** Doppeltipp-Zoom, Zwei-/Drei-Finger-Tipp, Formerkennung, Laser,
   Bild-/Text-Werkzeug, „Seite hinzufügen“ mit Position, Lesemodus (Telefon), Verlauf, Import, Export.
3. **Seitenmenü (⋯) auf dem Telefon** und fehlende Einträge im Desk-Menü (Duplizieren, Vorlage, Fach,
   Karten aus Markierungen, Archiv-Banner, Breadcrumb, Rückverweise).
4. **Editor:** Slash-Menü vollständig, Link-Menü `[[`, Blockmenü (Farbe, Duplizieren, Lernkarte),
   Bild-Upload, `img:`-Bilder anzeigen, Toggle-Zustand speichern, Link-Schema prüfen, KaTeX, Mermaid,
   Datenbankansicht.
5. **Shell:** Vor-Navigation, Chat-/Karten-Tabs, Drag & Drop im Baum, Breitengriff, Langdruck-Menüs,
   Dock bei Tastatur/Lernmodus ausblenden.
6. **KI:** Anhänge, Modellwahl/Denkaufwand, Diktat, Kopieren/Anpassen/Bearbeiten je Nachricht, Seitenkontext-Chip.
7. **Lernen:** Statistik-Tab, Archiv, Import/Export, Feynman/Experimente, Lernanalyse, Lernzeit-Erfassung,
   Fächer, Schulnoten.
8. **Einstellungen:** Übersicht-Kacheln, KI-Quellen, Backup Export/Import, Gefahrenzone, Speicher,
   Suche, Updates, Diagnose.
9. **Neue Module:** Wissensgraph, Gemini Notebook, PDF-Ansicht, Bibliothek-Ordner, Daily Notes.

## Inhalt

1. Shell & Navigation (Desktop/Tablet)
2. Seiten & Markdown-Editor
3. Heft (Handschrift/Zeichnen)
4. KI-Chat und Karteikarten/Lernen
5. Einstellungen, Sync, Backup, Werkzeuge
6. Smartphone-Oberfläche


---

# 1. Shell & Navigation (Desktop/Tablet)


Kotlin-Basispfad: `android/app/src/main/java/org/impala67/app/` (Kurzform unten: `ui/desk/X.kt` usw.)

### 0. Umfang, Grenzen und Kernbefunde

**Kernbefunde**
1. **Gemini Notebook und Wissensgraph sind in Kotlin nur Stubs.** `ShellNav.action()` (ui/shell/ShellNav.kt) kennt die IDs `notebooklm`, `graph`, `notebook` und `daily` nicht. Sie landen im Zweig „Folgt mit einem der nächsten Module.“. Es gibt kein Graph- und kein NotebookLM-Paket.
2. **Der Vor-Knopf fehlt** in der Tab-Leiste (DeskTabBar.kt:46 als TODO vermerkt). Chat-, Gemini- und Karten-Tabs fehlen ebenfalls.
3. **Nicht umgesetzt sind:** Drag & Drop (Seiten und Stapel), Breitengriff der Seitenleiste, Rechtsklick/Langdruck auf Zeilen, „Tabs in Seitenleiste“, Mehrfachauswahl im Chat-Verlauf, Umbenennen von Chats, Stapel-⋯-Menü.
4. **Seitenkopf-⋯ hat Lücken:** Duplizieren, Vorlage und Vorlesungsübersicht, Fach, PDF-Aktionen, „Karten aus Markierungen“, Rückverweise und Breadcrumb fehlen. Rückgängig und Wiederholen sind Stubs.
5. **Umbruchpunkte weichen ab:** PWA-Tablet 701–1024 px mit 220 px Seitenleiste; Kotlin Desk ab 840 dp bzw. quer ab 600 dp mit 236 dp.

**Abdeckung**
- Vollständig gelesen: `web/index.html`, `web/app-sidebar-events.js`, `web/popovers.js` (100–193), `web/shortcuts.js`, `web/app-dialogs.js` (Funktionen und Labels), `web/nav-history.js`, `web/collapse.js`, `web/app-ui.js`, `web/css/layout.css`, `web/css/components.css`, `web/home-view.js` (82–158), Kotlin `ui/desk/*`, `ui/shell/*`, `home/*` (Auszüge), `notes/TrashScreen.kt`, `ArchiveScreen.kt`, `TemplatePicker.kt`, `PageDialogs.kt`, `NoteRows.kt`, `search/SearchModel.kt`.
- Gezielt gelesen in `web/render.js` (Zeilen 148–157, 159–166, 240–298, 314–317, 411–600, 606–628, 651–692, 759–800, 857–893, 984–1082, 1136–1169, 1466–1519, 1705–1790, plus Funktionsindex). Nicht gelesen: Daily-Ansicht (1113–1135), Breadcrumb (801–830), `render-anki.js` (Stapelmenü).
- Nur per Label-Grep erfasst (kein vollständiges Lesen): `library.js`, `pdfs.js`, `graph.js`, `notebooklm.js`, `search.js`, `home-article.js`, `updater.js`, `perf-hint.js`, `tabs.js` (nur Struktur).
- `web/beta-ui.css` hat nur 6 Zeilen und ist ein Platzhalter. `home.css` wurde nicht visuell geprüft.
- Kotlin: Editor und `ai/ChatView.kt` nur im Composer-Bereich, Einstellungen nicht geprüft.

### 1. Gerüst und Layout

- [ ] **Boot-Splash** – Vollbild-Spinner mit Phasentext (`#bootSplashMsg`). Nach 12 s Hinweis „Der Start dauert ungewöhnlich lange …“ mit Knopf „Neu laden“ (web/index.html:136) — Kotlin: ⬜ kein Pendant in ui/shell (Android-Startbildschirm nicht geprüft)
- [ ] **Startfehler-Anzeige** – Unerwartete Fehler werden im Splash angezeigt (web/index.html, Skript `recordAppError`) — Kotlin: ⬜ kein Pendant
- [ ] **Statusband** – fester Streifen oben, nur iOS Standalone (web/index.html:159; css/layout.css:6–8) — Kotlin: ⬜ entfällt (iOS-spezifisch)
- [x] **Dreispalten-Raster Desktop** – Seitenleiste 236 px | Mitte (Tab-Leiste + Inhalt) | KI-Panel 320 px (css/layout.css, `#app`) — Kotlin: ✅ DeskShell.kt (SidebarWidth 236, AiPanelWidth 320)
- [ ] **Tablet-Raster 701–1024 px** – Seitenleiste fix 220 px, KI-Panel als Overlay rechts (css/layout.css, Medienabfrage 701–1024) — Kotlin: 🟡 DeskShell.kt (keine 220-px-Variante, Panel nicht als Overlay, Schwelle abweichend)
- [ ] **Schmales Layout ≤ 980 px** – eine Spalte, Body scrollt (css/layout.css, Medienabfrage ≤980) — Kotlin: 🟡 AppShell.kt (Telefon-Shell ab unter 840 dp bzw. unter 600 dp quer, andere Schwelle)
- [x] **Overlay/Modal-Hintergrund** – abgedunkelt, Außenklick schließt (web/index.html:270; css/components.css Overlay-Block; popovers.js:113–121) — Kotlin: ✅ native Compose-Dialoge (PageDialogs.kt, NoteParts.kt)
- [ ] **Modal als Sheet ≤ 600 px** – Dialog unten am Rand, bis 88 vh (css/components.css, letzte Medienabfrage) — Kotlin: ⬜ (nur Compose-Standarddialog)
- [ ] **Transiente Ebenen zurücksetzen** – `pageshow` schließt Overlay, Palette und Menüs (web/index.html, Funktion `resetTransientUiLayers`) — Kotlin: n/a (Zustand über Compose-Lebenszyklus)

### 2. Sidebar: Kopfpillen

- [x] **Home-Pille** `#btnHome` – Titel „Home“, aktiv im Dateien-Modus, Label nur bei aktiv (web/index.html:163; web/render.js:150–158) — Kotlin: ✅ DeskSidebar.kt (`Pill`, Label nur aktiv)
- [x] **Chat-Pille** `#btnChatTab` – Titel „Chats“, schaltet Sidebar in den Chat-Verlauf (web/index.html:167; web/render.js:150–158) — Kotlin: ✅ DeskSidebar.kt (Modus `Chats` mit ai/ChatList.kt)
- [x] **Karten-Pille** `#btnAnki` – Titel „Karteikarten“, Label „Karten“, Stapelbaum (web/index.html:172; web/app-click-buttons.js:251) — Kotlin: ✅ DeskSidebar.kt (Modus `Cards` mit DeskDecks.kt)
- [ ] **Daily-Pille** `#btnDaily` – standardmäßig versteckt, Titel „Daily Notes“ (web/index.html:176; web/app-click-buttons.js:259–265) — Kotlin: ⬜ (keine Pille; Daily nur als Suchaktion, dort Stub)
- [x] **Suchen-Pille** `#btnSearchToggle` – Titel „Suchen“, öffnet Befehlspalette (web/index.html:179; web/app-click-buttons.js:86–88) — Kotlin: ✅ DeskSidebar.kt (`nav.action("search")`)

### 3. Sidebar: Seitenbaum (Favoriten, Arbeitsbereiche, Zeilen)

- [x] **Abschnitt „★ Favoriten“** – alle Favoriten oberhalb der Arbeitsbereiche (web/render.js:497–499) — Kotlin: ✅ DeskTree.kt (`items()`, Kopf „★ Favoriten“)
- [x] **Arbeitsbereich-Kopf** – Einklapp-Pfeil (Schlüssel `ws:<id>`), Name, „+“ mit Titel „Neue Seite in {Name}“ (web/render.js:314–317) — Kotlin: ✅ DeskTreeRow.kt (`DeskTreeHead`)
- [x] **Leerer Arbeitsbereich** – Text „Keine Seiten“ (web/render.js:~508, Klasse `empty small`) — Kotlin: ✅ DeskSidebar.kt (`DeskTreeItem.Empty`)
- [x] **Seitenzeile** – Icon bzw. Emoji, Titel, Einrückung 16 px je Ebene, aktive Seite getönt (web/render.js:545–566) — Kotlin: ✅ DeskTreeRow.kt (`DeskTreePageRow`)
- [x] **Maximale Tiefe 8** – tiefere Ebenen werden nicht gezeichnet (web/render.js:541–543) — Kotlin: ✅ DeskTree.kt (`MAX_DEPTH`)
- [x] **Auf-/Zuklapp-Pfeil der Seite** – nur bei Unterseiten, Titel „Ein-/Ausklappen“ (web/render.js:552) — Kotlin: ✅ DeskTreeRow.kt (`Chevron`, Labels „Einklappen“/„Ausklappen“)
- [x] **⋯-Knopf der Zeile** – Titel „Weitere Optionen“, öffnet Seiten-Kontextmenü (web/render.js:556) — Kotlin: ✅ DeskTreeRow.kt (`PageMenu`)
- [x] **+-Knopf der Zeile** – Titel „Unterseite anlegen“ (web/render.js:557) — Kotlin: ✅ DeskTreeRow.kt
- [ ] **Inline-Umbenennen** – Eingabefeld in der Zeile; Enter bestätigt, Esc bricht ab, Fokusverlust bestätigt (web/render.js:553–555; web/app-sidebar-events.js:284–300) — Kotlin: 🟡 DeskTreeRow.kt öffnet `RenameDialog` (NoteRows.kt) statt Feld in der Zeile
- [ ] **Startzustand Aufklappen** – Workspaces offen, Seiten standardmäßig zu (web/collapse.js:5–13) — Kotlin: 🟡 DeskSidebar.kt (`collapsed` startet leer, also alle Seiten offen)
- [x] **Zeile öffnen** – Klick öffnet Seite, bereits offene Seite wird nicht erneut geöffnet (web/app-click-pages.js; web/tabs.js `openPage`) — Kotlin: ✅ DeskSidebar.kt (`open` ignoriert aktuelle Seite)
- [ ] **Drag & Drop Seiten** – Pointer-Ziehen (kein HTML5-DnD), Touch erst nach 380 ms Halten, Schwelle 6 px, Ghost-Vorschau. Zonen: oberes/unteres Viertel = davor/danach, Mitte = Unterseite, freie Fläche = Wurzel. Wechsel des Arbeitsbereichs beim Verschieben (web/app-sidebar-events.js:188–265) — Kotlin: ⬜ kein `pointerInput`/`draggable` in ui/desk
- [ ] **Drag & Drop Stapel** – HTML5-Ziehen; oberes/unteres Viertel = Reihenfolge, Mitte = Verschieben (web/app-sidebar-events.js:129–180) — Kotlin: ⬜ DeskDecks.kt
- [ ] **Rechtsklick/Langdruck öffnet ⋯-Menü** – Langdruck 550 ms, Toleranz 10 px (web/popovers.js:149–190) — Kotlin: ⬜ (nur ⋯-Knopf, kein `combinedClickable` in DeskTreeRow.kt)

### 4. Seiten-Kontextmenü (⋯ in der Sidebar)

Quelle: web/render.js:569–583 (`pageMenuHtml`, `moveTrashItems`, `dupTplItems`).

- [x] **In neuem Tab öffnen** (`pageopennew`) — Kotlin: ✅ DeskTreeRow.kt (`openNewTab`)
- [x] **Umbenennen** (`pagerename`) — Kotlin: ✅ DeskTreeRow.kt (`RenameDialog`)
- [x] **Duplizieren** (`pageduplicate`, Titel „(Kopie)“; web/app-dialogs.js:129–143) — Kotlin: ✅ DeskTreeRow.kt (`duplicatePage`)
- [x] **Als Vorlage / Vorlage entfernen** (`pagetemplate`, Umschalter) — Kotlin: ✅ DeskTreeRow.kt
- [ ] **Als Vorlesungsübersicht / Übersicht aufheben** (`pagedb`, nur Notizen, nicht Hefte; web/render.js:571) — Kotlin: ⬜ kein Eintrag
- [x] **Zu Favoriten / Favorit entfernen** (`pagefav`) — Kotlin: ✅ DeskTreeRow.kt
- [ ] **Fach: {Name}…** (`pagesubject`; web/render.js:572; Dialog web/app-dialogs.js:103–128) — Kotlin: ⬜ kein Fach-Dialog
- [x] **Verschieben nach…** (`pagemove`; web/app-dialogs.js:77–101) — Kotlin: ✅ DeskTreeRow.kt (`MovePageDialog`; Ziel-Auswahl nicht im Detail geprüft)
- [ ] **Aus Archiv holen** (`pageunarchive`, nur archivierte Seiten; web/render.js:574) — Kotlin: 🟡 DeskTreeRow.kt zeigt nur „Archivieren“; Entarchivieren geht nur im Archiv-Screen (notes/ArchiveScreen.kt)
- [x] **Archivieren** (`pagearchive`) — Kotlin: ✅ DeskTreeRow.kt
- [x] **Löschen** (`pagetrash`, Gefahrenfarbe; web/render.js:575) — Kotlin: ✅ DeskTreeRow.kt (Tab wird geschlossen; ohne Rückfrage, PWA-Rückfrage nicht geprüft)

### 5. Sidebar: Stapelbaum (Modus „Karten“)

Rendering in web/render.js:50–51 (delegiert an `render-anki.js`, dort nicht gelesen).

- [x] **Kopf „Stapel“** — Kotlin: ✅ DeskDecks.kt
- [x] **Stapelzeile** – Name, eingerückt, Pfeil für Unterstapel — Kotlin: ✅ DeskDecks.kt (`DeckTreeRow`, `DeckChevron` mit Labels „Unterstapel anzeigen/ausblenden“)
- [x] **Zähler fällig / neu** (Badges `deck-badge`; fällig in Akzent, neu in Erfolgsfarbe) — Kotlin: ✅ DeskDecks.kt (`CountBadge`)
- [x] **Leerer Stapelbaum** – „Noch keine Stapel“ — Kotlin: ✅ DeskDecks.kt
- [x] **Stapelzeile öffnen** – startet Lernansicht des Stapels — Kotlin: ✅ DeskDecks.kt (`ReviewRoute`)
- [ ] **Stapel-⋯-Menü** – Einträge laut web/popovers.js: `deckmenu`, `deckdel`, `deckrename`, `deckduplicate`, `deckarchive`; Details in render-anki.js nicht gelesen — Kotlin: ⬜ DeskDecks.kt (kein Menü, kein Umbenennen, Löschen, Duplizieren, Archivieren)
- [ ] **Stapel-Drag & Drop** — siehe Abschnitt 3 — Kotlin: ⬜

### 6. Sidebar: Chat-Verlauf (Modus „Chat“)

Quelle: web/render.js:514–539 (`chatListHtml`); Kotlin: ai/ChatList.kt.

- [x] **„+ Neuer Chat“** (`data-newchat`) — Kotlin: ✅ ai/ChatList.kt:59
- [x] **Chat-Zeile** – Titel, Datum (`U.fmtDate`), aktiver Chat markiert — Kotlin: ✅ ai/ChatList.kt (Datum, `formatDate`; Markierung aktiver Chat nicht geprüft)
- [ ] **Chat umbenennen** (`data-chatrename`, Stift-Knopf je Zeile) — Kotlin: ⬜ ChatList.kt (kein Umbenennen gefunden)
- [x] **Chat löschen** (`data-chatdel`, Papierkorb-Knopf je Zeile) — Kotlin: ✅ ai/ChatList.kt (⋯ → „Löschen“ mit Rückfrage)
- [ ] **Mehrfachauswahl-Kästchen** (`data-chatsel`, erscheint im Auswahlmodus) — Kotlin: ⬜
- [ ] **Auswahlleiste** – „N ausgewählt“, „Alle“ (`chatselall`), „✕“ Auswahl aufheben (`chatselnone`), Löschen der Auswahl (`chatdelsel`) — Kotlin: ⬜
- [x] **Leerzustand** – „Noch keine gespeicherten Chats.“ — Kotlin: ✅ ai/ChatList.kt:64

### 7. Sidebar: Offene Tabs (Variante „Tabs in Seitenleiste“)

Quelle: web/render.js:411–455 (`sidebarTabsHtml`, nur bei `body.tabs-in-sidebar`).

- [ ] **Kopf „Offene Tabs“** mit „＋“ (`data-tabnew`, Titel „Neuen Tab öffnen“) — Kotlin: ⬜
- [ ] **Tab-Zeile** – Icon (✦ für Chat, Buch für Gemini, Karten-Icon, Seiten-Icon), Titel, aktiv getönt, Klick wechselt — Kotlin: ⬜
- [ ] **✕ Tab schließen** je Zeile (`data-tabclose`, Titel „Tab schließen“) — Kotlin: ⬜
- [ ] **Variante als Ganzes** — Kotlin: ⬜ (Tabs immer oben, DeskTabBar.kt)

### 8. Sidebar: Fußnavigation, Breite, Einklappen

Quelle: web/index.html:184–208 (`.side-foot`).

- [ ] **Gemini Notebook** (`#btnNotebookLM`, Titel „Gemini Notebook (ehemals NotebookLM)“) — Kotlin: 🟡 DeskSidebar.kt (`FootButton`) ruft `nav.action("notebooklm")`, `ShellNav.action()` kennt die ID nicht → Stub-Toast
- [ ] **Wissensgraph** (`#btnGraph`, Titel „Wissensgraph — Seiten & Verknüpfungen mit FSRS-Färbung“) — Kotlin: ⬜ DeskSidebar.kt ruft `action("graph")`, Stub; kein Graph-Modul vorhanden
- [x] **Bibliothek** (`#btnLibrary`, Titel „Bibliothek“) — Kotlin: ✅ DeskSidebar.kt (`action("library")`)
- [x] **Papierkorb** (`#btnTrash`) — Kotlin: ✅ DeskSidebar.kt (`action("trash")`)
- [x] **Einstellungen** (`#btnSettings`) — Kotlin: ✅ DeskSidebar.kt (`action("settings")`)
- [ ] **Breitengriff** (`#sidebarResizer`, Rollenangabe Trennlinie, Titel „Ziehen zum Verbreitern · Doppelklick = Standardbreite“; web/index.html:209; web/app-sidebar-events.js:306–335) — Kotlin: ⬜ DeskShell.kt (feste `SidebarWidth`). Hinweis: Bereich 180–560 px im JS, Startskript klemmt auf 200–420 px (inkonsistent)
- [ ] **Doppelklick auf Griff** – Standardbreite (web/app-sidebar-events.js:327–333) — Kotlin: ⬜
- [ ] **Seitenleiste ein-/ausklappen** (☰, `#btnSidebarToggle`, Titel „Linke Spalte ein-/ausklappen“; web/render.js:606; web/app-click-buttons.js:288–300; Zustand in `localStorage` `impala67.sidebarCollapsed`) — Kotlin: 🟡 DeskTabBar.kt (`SidebarToggle`); Zustand nur `rememberSaveable`, nicht dauerhaft
- [ ] **☰ im Telefon-Modus** – öffnet Navigator-Sheet (`mnav-open`; web/app-click-buttons.js:291–294) — Kotlin: n/a (Telefon nutzt `NavigationSuiteScaffold`, AppShell.kt)

### 9. Tab-Leiste (`#tabbar`)

Quelle: web/render.js:591–628 (`renderTabs`).

- [x] **☰ Sidebar-Umschalter** — Kotlin: ✅ DeskTabBar.kt (`SidebarToggle`)
- [x] **Zurück** (`#btnNavBack`, Titel „Zurück“, deaktiviert ohne Verlauf; web/render.js:607; web/app-click-buttons.js:82–83) — Kotlin: ✅ DeskTabBar.kt (`SmallButton`, deaktiviert bei `canGoBack=false`)
- [ ] **Vor** (`#btnNavForward`, Titel „Vor“; web/render.js:608; web/app-click-buttons.js:84–85) — Kotlin: ⬜ (TODO in DeskTabBar.kt:46; ShellNav ohne Vorwärtsverlauf)
- [x] **Seiten-Tab-Chip** – Icon, Titel, aktiv getönt, Klick wechselt, Breite bis 170 px (web/render.js:618–622) — Kotlin: ✅ DeskTabBar.kt (`TabChip`, 96–170 dp)
- [x] **Tab schließen ✕** (`tabchip-x`, Titel „Schließen“; web/render.js:622) — Kotlin: ✅ DeskTabBar.kt (Titel „Tab schließen“, Nachbar wird aktiv, `ShellNav.closeTab`)
- [ ] **Chat-Tab „✦ Titel“** (`chat:`-Tabs; web/render.js:614) — Kotlin: ⬜
- [ ] **Gemini-Notebook-Tab** (`nlm:main`; web/render.js:615) — Kotlin: ⬜
- [ ] **Karteikarten-Tab** (`anki:main`; web/render.js:616) — Kotlin: ⬜
- [ ] **„+“ Neuer Tab** (`#btnTabNew`, Titel „Neuen Tab öffnen“; web/render.js:625) — Kotlin: 🟡 DeskTabBar.kt öffnet direkt den Seiten-Anlegedialog. PWA öffnet ein Menü mit „Neuen Chat starten“ und „Neue Seite“ (web/search.js, `newTabActions`)
- [x] **Horizontales Scrollen** bei vielen Tabs — Kotlin: ✅ DeskTabBar.kt (`horizontalScroll`)
- [x] **Titel-Fallback „Ohne Titel“** — Kotlin: ✅ DeskTabBar.kt (`pageTitle`)

### 10. Seitenkopf: Teilen, Stern, ⋯, Rückverweise

Quelle: web/render.js:759–800 (`topbarActionsHtml`, `shareMenuHtml`, `moreMenuHtml`, `backlinksChipHtml`). Kotlin: ui/desk/DeskPageActions.kt (`PageActions`).

- [ ] **Teilen** (`data-sharemenu`, Titel „Exportieren & Teilen“; web/render.js:760) — Kotlin: 🟡 DeskPageActions.kt (`ShareButton`) öffnet direkt das Android-Teilen (Text und Titel) statt eines Dreier-Menüs
- [ ] **↳ Als PDF exportieren / drucken** (`exportpdf`; web/render.js:767) — Kotlin: ✅ für Notizen (`printPage`); ⬜ für Hefte („folgt“-Stub)
- [x] **↳ Als Markdown (.md) speichern** (`exportmd`) — Kotlin: ✅ (`CreateDocument`)
- [x] **↳ Internen Link kopieren** (`copylink`) — Kotlin: ✅ (Zwischenablage plus Snackbar)
- [x] **Stern „Zu Favoriten“** (`data-pagefav`; Titel „Zu Favoriten hinzufügen“ / „Aus Favoriten entfernen“; web/render.js:762) — Kotlin: ✅ DeskPageActions.kt (`SmallButton`, aktiv getönt)
- [x] **⋯ Weitere Optionen** (`data-morepagemenu`; web/render.js:763, 771–792) — Kotlin: ✅ DeskPageActions.kt (`DropdownMenu`)
  - [x] **Rückgängig** (Hinweis Strg+Z; `data-editundo`; web/render.js:773) — Kotlin: ✅ HeftViewModel.kt (höchstens 100 Schritte, je Sitzung)
  - [x] **Wiederholen** (Hinweis Strg+Y; `data-editredo`) — Kotlin: ✅ HeftViewModel.kt (höchstens 100 Schritte)
  - [x] **Zu Favoriten / Favorit entfernen** — Kotlin: ✅
  - [ ] **Als PDF exportieren / drucken** — Kotlin: ✅ (Notiz), ⬜ (Heft)
  - [x] **Als Markdown (.md) speichern** — Kotlin: ✅
  - [x] **Internen Link kopieren** — Kotlin: ✅
  - [x] **Verlauf** (`btnHistory`) — Kotlin: ✅ DeskPageActions.kt → `HistoryDialog`
  - [x] **PDF im neuen Tab öffnen** (`btnOpenPdfTab`, nur mit PDF; web/render.js:784) — Kotlin: ✅ DeskPageActions.kt (öffnet die PDF-App des Geräts)
  - [x] **PDF herunterladen** (`btnDownloadPdf`, nur mit PDF; web/render.js:785) — Kotlin: ✅ DeskPageActions.kt (Speichern-Dialog)
  - [x] **Icon ändern** (`data-iconpick`) — Kotlin: ✅ `IconDialog`
  - [x] **Cover ändern** (`data-coverpick`) — Kotlin: ✅ `CoverDialog` (eigenes Bild nicht geprüft)
  - [x] **Karten aus Markierungen (n)** (`cardsfromhl`; zählt `==…==` und `{{c1::…}}`; web/render.js:786) — Kotlin: ✅ DeskPageActions.kt (Kern `cardsFromHighlights`)
  - [ ] **Duplizieren / Als Vorlage / Als Vorlesungsübersicht** (`dupTplItems`) — Kotlin: 🟡 Duplizieren ✅, Vorlage ✅ (DeskPageActions.kt); Vorlesungsübersicht fehlt (kommt mit der Datenbankansicht)
  - [ ] **Fach…** — Kotlin: ⬜
  - [x] **Verschieben nach…** — Kotlin: ✅ `MovePageDialog`
  - [x] **Archivieren** — Kotlin: ✅ (Tab wird geschlossen)
  - [x] **Löschen** (Gefahrenfarbe) — Kotlin: ✅ (Tab wird geschlossen)
- [ ] **Rückverweise-Chip** („N Rückverweise“ mit Klappliste; web/render.js:794–800) — Kotlin: ⬜
- [ ] **Breadcrumb** (web/render.js:801; Detail nicht gelesen) — Kotlin: ⬜ (in ui/desk nicht vorhanden)
- [ ] **Archiv-Banner** („Diese Seite ist archiviert.“ bzw. „Dieses Heft ist archiviert.“ mit „Wiederherstellen“; web/render.js:672, 692) — Kotlin: ⬜ (in PageActions.kt nicht vorhanden)
- [ ] **Seitenkopf-Zurück/Vor** (`btnPageNavBack`/`btnPageNavForward`; web/render.js:689–690) — Kotlin: 🟡 Zurück in der Tab-Leiste; Vor ⬜

### 11. KI-Panel (rechte Spalte) und KI-Schnellzugriff

Quelle: web/index.html:217–256; web/render.js:159–166, 183, 1466–1519, 1705–1733.

- [ ] **KI-Status-Chip** (`#aiStatusChip`, Titel „KI-Status“; Labels „KI online“ / „KI offline“ / „KI …“; web/render.js:159–166) — Kotlin: 🟡 DeskAiPanel.kt zeigt nur einen statischen grauen Punkt
- [x] **Titel „KI-Coach“** — Kotlin: ✅ DeskAiPanel.kt
- [ ] **Verlauf-Knopf** (`#btnChatHist`, Titel „Alte Chats öffnen (Verlauf)“; Dropdown web/render.js:1499–1519) — Kotlin: ⬜ (Liste nur in der Seitenleiste)
- [x] **Neuer Chat** (`#btnChatNew`, Titel „Neuen Chat starten“) — Kotlin: ✅ DeskAiPanel.kt (`HeadButton`, deaktiviert während Antwort)
- [ ] **Chat in eigenem Tab öffnen** (`#btnChatExpand`, Titel „Chat in eigenem Tab öffnen“) — Kotlin: ⬜
- [x] **KI einklappen** (`#btnTogglePanel`, ✕, Titel „KI einklappen“) — Kotlin: ✅ DeskAiPanel.kt
- [ ] **Seitenkontext-Chip** (`#sideContextChip`; „Seitenkontext · wird mitgesendet“ bzw. „Anfang mitgesendet (x von y Zeichen)“; ✕ `data-removecontext`; web/render.js:1466–1488) — Kotlin: ⬜
- [ ] **Anhang-Chips** (PDF, Bild, Textdatei; ✕ `btnRemovePdf`, `btnRemoveImage`, `btnRemoveTextFile`; web/render.js:1705–1733) — Kotlin: ⬜
- [x] **Eingabefeld** (`#chatInput`, Platzhalter „Frag deinen KI-Coach…“; web/index.html:238) — Kotlin: ✅ ai/ChatView.kt:113
- [ ] **Enter sendet, Shift+Enter Zeile** (web/app.js:728–732) — Kotlin: ⬜ (nicht verifiziert)
- [ ] **+ Anhängen** (`#btnAttach`, Titel „PDF oder Bild anhängen“; web/index.html:242) — Kotlin: ⬜ (kein Anhangsmenü in ai/)
- [ ] **Anhang-Menü** (`#attachMenu`): „Fotos und Dateien hinzufügen“ (`attachFile`), „Aktuelle Heft-Seite als Bild anhängen“ (`attachHeft`, nur bei offenem Heft; web/index.html:263–266), „Seiten oder Personen erwähnen…“ (`attachMention`, PWA-Stub) — Kotlin: ⬜
- [ ] **Modell-Knopf** (`#btnModelMenu`, Titel „Modell wählen“; Menü mit ★-Favoriten, web/render.js:240–298) — Kotlin: ⬜
- [ ] **Spracheingabe** (`#btnVoice`, Titel „Spracheingabe starten (Alt+Leertaste)“; web/index.html:247) — Kotlin: ⬜
- [x] **Senden** (`#chatSubmit`, Titel „Senden“, deaktiviert bei leerem Feld; web/index.html:248) — Kotlin: ✅ ai/ChatView.kt:121
- [x] **Antwort abbrechen** (Stopp-Knopf während Antwort) — Kotlin: ✅ ai/ChatView.kt:119 (PWA-Gegenstück nicht im Shell-Markup)
- [x] **Vorschlags-Karten im leeren Chat** („Erklär's mir“, „Karteikarten“, „Zusammenfassen“, „Quiz mich“) — Kotlin: ✅ ai/ChatView.kt:168–171 (PWA-Stelle nicht geprüft)
- [x] **KI-Schnellzugriff (FAB)** (`#btnAiFab`, „KI öffnen“; web/index.html:256) — Kotlin: ✅ DeskShell.kt (unten rechts, ausgeblendet bei offenem Panel oder Heft-Vollbild)

### 12. Home (Startseite)

Quelle: web/home-view.js:82–158; web/home-article.js:209–240; web/render.js:1001–1035. Kotlin: home/*.kt.

- [ ] **Datum im Kopf** (`hv-date`) — Kotlin: 🟡 HomeScreen.kt (nicht verifiziert)
- [ ] **Begrüßung** (Guten Morgen / Tag / Abend / Nacht, plus Name aus Einstellungen; web/render.js:1005–1006) — Kotlin: 🟡 HomeState.kt:69–71 (Morgen 5–10, Tag 11–17, sonst Abend; kein „Gute Nacht“)
- [ ] **+ Neue Seite** (`hv-btn`, `data-homeaction="newpage"`) — Kotlin: 🟡 Beschriftung im Kopf per Grep nicht gefunden (HomeScreen.kt)
- [x] **Startseite anpassen** (Zahnrad, `hv-ghost`, Titel und aria „Startseite anpassen“; web/home-view.js:107) — Kotlin: ✅ HomeScreen.kt:114
- [x] **Sync-Konflikt-Hinweis** („Ein Sync-Konflikt wartet …“ bzw. „N Sync-Konflikte warten …“ mit „Lösen“; web/home-view.js:111) — Kotlin: ✅ HomeScreen.kt:122–132 (`ConflictAlert`)
- [ ] **Backup-Hinweis „stale“** („Änderungen seit … noch nicht gesichert“ mit „Jetzt sichern“ und „Später“; web/home-view.js:116) — Kotlin: ⬜
- [ ] **Backup-Hinweis „nur lokal“** („Deine Notizen liegen bisher nur auf diesem Gerät“ mit „Sync einrichten“ und „Später“; web/home-view.js:117) — Kotlin: ⬜
- [x] **Begrüßungssatz mit Link** („N Karten warten, etwa X Min“, Streak-Hinweis, Wochenziel-Hinweis; web/home-view.js:99–104) — Kotlin: ✅ HomeScreen.kt `Lead` (HomeState.kt:104–110)
- [x] **Weitermachen-Karte** (`hv-continue`, Vorschau, „Weitermachen“, Titel, Meta, Zeit; web/home-view.js:120) — Kotlin: ✅ home/HomeCards.kt `ContinueCard`
- [x] **Leere Weitermachen-Karte** („Noch keine Seiten“ / „Erste Seite anlegen“; web/home-view.js:122) — Kotlin: ✅ HomeCards.kt
- [x] **Angeheftet (Pins, bis 6)** (`hv-pins`, aria „Angeheftet“; web/home-view.js:124–126) — Kotlin: ✅ HomeCards.kt `Pins`
- [x] **„Weißt du's noch?“ (Recall)** (Frage, „Antwort zeigen“; web/home-view.js:67) — Kotlin: ✅ HomeCards.kt `RecallCard`
- [x] **Kachel „Heute fällig“** (`hv-cards`, Zustände due / done / leer, „Lernen starten“ bzw. „Morgen geht's weiter“; web/home-view.js:139–143) — Kotlin: ✅ HomeStats.kt
- [ ] **Kachel „Diese Woche gelernt“** (Summe, Zielbalken mit `progressbar`, Tagesbalken, Streak; web/home-view.js:145–151) — Kotlin: 🟡 HomeStats.kt (Balken ✅, Tooltips der Tagesbalken ⬜)
- [x] **„Ziel ändern“** (`data-lz-goal`, Titel „Wochenziel umschalten“; web/home-view.js:149) — Kotlin: ✅ HomeStats.kt (`cycleGoal`)
- [ ] **Tagesartikel-Karte** („Tagesartikel“, Quellen-Pins, „Verlauf (n)“, „Nochmal lesen“, „Gelesen“, „Erneut versuchen“; web/home-article.js:202–221) — Kotlin: 🟡 HomeArticle.kt (Verlauf, Nochmal lesen, Gelesen vorhanden; „Erneut versuchen“ per Grep nicht gefunden)
- [ ] **Tagesartikel-Verlauf-Dialog** (Titel „Tagesartikel“, „Schließen“; web/home-article.js:225–238) — Kotlin: 🟡 HomeArticle.kt (nicht vollständig gelesen)
- [ ] **Lernanalyse-Ausklapper** (`homeFold("insights")`; web/render.js:984–1000) — Kotlin: ⬜ (per Grep nicht gefunden)
- [ ] **Ausklapp-Abschnitte mit Speicherung** (`details`, Zustand in `HOME_FOLD_KEY`; web/render.js:984–986) — Kotlin: ⬜
- [ ] **Leerzustand Home** („Leg deine erste Seite an. Sobald du lernst, füllt sich diese Seite.“; web/home-view.js:103) — Kotlin: 🟡 per Grep nicht gefunden

### 13. Papierkorb und Archiv

Quelle: web/render.js:1037–1081 (`renderTrash`, `trashRow`).

- [ ] **Titel „Papierkorb“ mit Hinweis** („Seiten, Stapel und Karten — wiederherstellbar, bis du sie endgültig löschst.“) — Kotlin: 🟡 notes/TrashScreen.kt (Hinweis nur für Seiten)
- [x] **„Papierkorb leeren“** (`trashclear`, Gefahrenfarbe, nur bei Inhalt) — Kotlin: ✅ TrashScreen.kt (mit Bestätigung)
- [ ] **Filter-Chips Alle / Seiten / Stapel / Karten** (`trashfilter`, mit Zählern; web/render.js:1052–1057) — Kotlin: ⬜ (nur Seiten)
- [x] **Seiten-Zeile** (Icon, Titel, „gelöscht {Datum}“) — Kotlin: ✅ TrashScreen.kt `TrashRow`
- [x] **Wiederherstellen** (`pagerestore`) — Kotlin: ✅ TrashScreen.kt
- [x] **Endgültig löschen** (`pagepurge`, Gefahrenfarbe) — Kotlin: ✅ TrashScreen.kt (mit Bestätigung)
- [ ] **Stapel-Zeilen** (Name, Kartenzahl, `deckrestore`/`deckpurge`) — Kotlin: ⬜
- [ ] **Karten-Zeilen** (Vorderseite gekürzt auf 60 Zeichen, `cardrestore`/`cardpurge`) — Kotlin: ⬜
- [x] **Leerzustand** („Der Papierkorb ist leer.“) — Kotlin: ✅ TrashScreen.kt
- [x] **Archiv-Ansicht** (PWA: Bibliothek-Modus Archiv, library.js, nicht vollständig gelesen) — Kotlin: ✅ notes/ArchiveScreen.kt (Filter Alle / Hefte / Seiten, Zeile „Heft/Seite · archiviert {Datum}“, „Wiederherstellen“, Papierkorb-Icon, Leerzustand „Das Archiv ist leer.“)

### 14. Dialoge und Auswahlfenster

- [x] **Neu anlegen** (Auswahl; web/render.js:1136–1150; `newPageFlow` web/app-dialogs.js:145) — Buttons „Notion-Seite“, „GoodNotes-Heft“, „Oder aus einer Vorlage:“ mit Vorlagenliste, „Abbrechen“ — Kotlin: ✅ notes/TemplatePicker.kt `NewPageDialog`
- [ ] **Name-Eingabe** (Prompt-Dialog; web/app-dialogs.js:54–76; Enter bestätigt; „Abbrechen“/„OK“) — Kotlin: 🟡 kein generischer Prompt; `RenameDialog` (NoteRows.kt:153–172) mit „Speichern“/„Abbrechen“
- [ ] **Verschieben nach…** (web/app-dialogs.js:77–101; Liste Arbeitsbereiche plus eingerückter Seitenbaum; „Abbrechen“) — Kotlin: 🟡 PageDialogs.kt `MovePageDialog` (Arbeitsbereiche-Ebene nicht verifiziert)
- [ ] **Fach-Dialog** („Fach für „{Seite}““, Liste mit ✓ bei aktivem Fach; „Abbrechen“; web/app-dialogs.js:103–128) — Kotlin: ⬜
- [x] **Verlauf** (web/render.js:1152–1169; Versionsliste, Vorschau, Wiederherstellen erzeugt neues Ereignis) — Kotlin: ✅ PageDialogs.kt `HistoryDialog` („aktuell“, „Keine Versionen“, „Diese Version wiederherstellen“, „Schließen“)
- [x] **Icon wählen** (web/render.js:1739–1748) — Kotlin: ✅ PageDialogs.kt `IconDialog` („Entfernen“, „Schließen“)
- [x] **Cover wählen** (web/render.js:1749–1759) — Kotlin: ✅ PageDialogs.kt `CoverDialog` („Entfernen“, „Schließen“); „Eigenes Bild wählen“ nicht geprüft
- [ ] **Sync-Konflikt-Auflösung** (web/render.js:857–893; Sammelaktion „Empfehlung übernehmen“, web/conflict-ui.js) — Kotlin: 🟡 `ConflictsRoute` existiert (ui/shell/Routes.kt), Dialog nicht geprüft
- [x] **Bestätigung** (Papierkorb leeren, Endgültig löschen) — Kotlin: ✅ notes/NoteParts.kt `ConfirmDialog`
- [ ] **Tagesnotiz anlegen** (`openDailyNote`; web/app-dialogs.js:171–188) — Kotlin: ⬜
- [x] **Schließen-Kreuz im Overlay** (`#btnCloseOverlay`, Titel „Schließen (Escape)“) — Kotlin: ✅ (Compose-Dialog)

### 15. Popover- und Menü-Mechanik

Quelle: web/popovers.js.

- [x] **Menü schließt bei Klick außerhalb** (web/popovers.js:124–132, `closeOutside`) — Kotlin: ✅ DropdownMenu (`onDismissRequest`)
- [x] **Overlay schließt bei Klick auf den Hintergrund** (web/popovers.js:113–121; Schließweg `o._close`) — Kotlin: ✅ Compose-Dialog
- [ ] **Escape schließt Menü/Overlay** (web/shortcuts.js:59–76) — Kotlin: 🟡 nur Zurück-Geste, kein Tastatur-Escape in ui/desk
- [x] **Positionierung am Auslöser** (web/popovers.js; `POPOVERS.position`, Ausrichtung rechts-unten, Abstand 2 px) — Kotlin: ✅ DropdownMenu (nativ)
- [ ] **Öffnen per Rechtsklick/Langdruck** — siehe Abschnitt 3 — Kotlin: ⬜

### 16. Toasts und Hinweise

Quelle: web/util.js:346 ff. (`U.toast`); web/css/components.css (Toast-Block).

- [ ] **Toast mit Erfolg/Fehler-Farbe** (Klassen `success` / `error`) — Kotlin: 🟡 ShellNav.kt `toast()` nutzt Snackbar ohne Farbunterschied
- [ ] **Toast mit Aktionen** (`toast-actions`) — Kotlin: ⬜
- [x] **Platzierung unten zentriert** — Kotlin: ✅ DeskShell.kt (`SnackbarHost`, BottomCenter)
- [ ] **Stub-Hinweise** („Folgt mit einem der nächsten Module.“ bzw. „… folgt mit einem der nächsten Module.“) — Kotlin: 🟡 vorhanden, aber mehrere Menüpunkte landen darin (siehe Abschnitte 8, 10, 18)

### 17. Tastaturkürzel

Quelle: web/shortcuts.js, web/app.js:728–732, web/app-sidebar-events.js:284–300, web/search.js:341–348.

- [ ] **Strg/Cmd+K** öffnet und schließt die Befehlspalette (web/shortcuts.js, Keydown-Handler) — Kotlin: ⬜ kein Hardware-Kürzel in ui/desk (Suche per Icon ✅)
- [ ] **Alt+Leertaste** startet/stoppt Spracheingabe im Seitenchat (web/shortcuts.js) — Kotlin: ⬜
- [ ] **Escape-Kaskade** (Sprache stoppen → Palette → Menüs → Overlay → Seitenmenü; web/shortcuts.js:59–76) — Kotlin: 🟡 nur Zurück-Geste
- [ ] **Enter sendet, Shift+Enter Zeile** im Chat (web/app.js:728–732) — Kotlin: ⬜ (nicht verifiziert)
- [ ] **Strg+Z / Strg+Y** (nur als Hinweistext im Menü; web/render.js:773–775) — Kotlin: ⬜ (Stubs)
- [ ] **Mittelklick-Auto-Scroll** (web/shortcuts.js:14–45) — Kotlin: ⬜ (Desktop-Maus; auf Android n/a)
- [ ] **Anki-Lernen: Leertaste/Enter = Antwort, 1–4 = bewerten** (web/shortcuts.js, Anki-Zweig) — Kotlin: ⬜ im Shell-Scope; Lernansicht nicht geprüft
- [ ] **Inline-Umbenennen: Enter/Esc/Fokusverlust** (web/app-sidebar-events.js:284–300) — Kotlin: 🟡 Dialog statt Feld
- [ ] **Palette: ↑ ↓ Enter Escape** (web/search.js:341–348) — Kotlin: ⬜ (Touch-Suchscreen, keine Tastaturnavigation)

### 18. Befehlspalette (Strg+K)

Quelle: web/search.js (Eingabe 56–78, Aktionen ca. 104–130, Gruppen 193–208, Zeilen 252–266, Tab-Menü 137–150). Kotlin: search/SearchScreen.kt, search/SearchModel.kt.

- [x] **Eingabe** („Suchen oder Befehl eingeben…“; web/search.js:56, 73) — Kotlin: ✅ SearchScreen.kt (Platzhaltertext nicht geprüft)
- [x] **Schließen** (`palette-close-btn`, „Schließen“; web/search.js:57) — Kotlin: ✅ SearchScreen.kt:80 (Pfeil „Schließen“)
- [x] **Eingabe löschen** — Kotlin: ✅ SearchScreen.kt `ClearButton` („Eingabe löschen“)
- [x] **Gruppe „Seiten“ / „Zuletzt bearbeitet“** (web/search.js:193, 206) — Kotlin: ✅ SearchScreen.kt `SectionHead`
- [ ] **Gruppe „Chats“** (web/search.js:194, 207) — Kotlin: 🟡 nicht verifiziert
- [x] **Gruppe „Aktionen“** (web/search.js:208) — Kotlin: ✅ SearchScreen.kt
- [x] **Seiten-Zeile** (Icon, Titel, Auszug, Präfix „Archiv · “; web/search.js:258) — Kotlin: ✅ SearchScreen.kt `PageRowItem` (Präfix „Archiv · “)
- [ ] **Chat-Zeile** (Kind-Label „Chat“; web/search.js:263) — Kotlin: 🟡 nicht verifiziert
- [x] **Aktions-Zeile** (Kind-Label „Aktion“; web/search.js:269) — Kotlin: ✅ SearchScreen.kt `ActionRowItem`
- [ ] **„In neuem Tab öffnen…“** (Tab-Menü; web/search.js:78) — Kotlin: ⬜
- [x] **Leerzustand / keine Treffer** — Kotlin: ✅ SearchScreen.kt `EmptyHint`
- [x] **Aktion „Neue Seite“** (web/search.js ca. 111) — Kotlin: ✅ SearchModel.kt:38 (`newpage`)
- [x] **Aktion „Karten wiederholen“** („— n fällig“; web/search.js ca. 112) — Kotlin: ✅ SearchModel.kt:39 (`cards`)
- [x] **Aktion „Karten verwalten“** (web/search.js ca. 115) — Kotlin: ✅ SearchModel.kt:40 (`cards-manage`)
- [ ] **Aktion „Daily Note von heute öffnen“** (web/search.js ca. 116) — Kotlin: ⬜ (SearchModel.kt:41, ID `daily` nicht verdrahtet → Stub)
- [ ] **Aktion „Daily-Notes-Kalender öffnen“** (web/search.js ca. 117) — Kotlin: ⬜ (SearchModel.kt:42, ID `daily-calendar` → Stub)
- [ ] **Aktion „Gemini Notebook öffnen“** (web/search.js ca. 118) — Kotlin: ⬜ (SearchModel.kt:43, ID `notebook` → Stub)
- [ ] **Aktion „Dunkles Design“ / „Helles Design“** (Umschalter; web/search.js ca. 119) — Kotlin: ⬜ (fehlt in SearchModel.kt)
- [x] **Aktion „Archiv in Bibliothek öffnen“** (web/search.js ca. 122) — Kotlin: ✅ SearchModel.kt:44 (`archive`)
- [x] **Aktion „Papierkorb öffnen“** (web/search.js ca. 127) — Kotlin: ✅ SearchModel.kt:45 (`trash`)
- [x] **Aktion „Drive-Sync in Einstellungen öffnen“** (web/search.js ca. 128) — Kotlin: ✅ SearchModel.kt:46 (`sync`)
- [x] **Aktion „Einstellungen öffnen“** (web/search.js ca. 129) — Kotlin: ✅ SearchModel.kt:47 (`settings`)
- [ ] **Aktion „Neuen Chat starten“** (nur Tab-Menü; web/search.js:137–141) — Kotlin: ⬜

### 19. Einstiege: Bibliothek, PDF, Wissensgraph, Gemini Notebook

Diese Module sind im Shell-Kontext nur als Einstieg relevant. Details wurden per Label-Grep erfasst.

**Bibliothek (web/library.js)**
- [x] **Titel „Bibliothek“** (web/library.js:212) — Kotlin: ✅ library/LibraryScreen.kt (Titel und Untertitel „PDFs & Dokumente“)
- [x] **„PDF hinzufügen“** — Kotlin: ✅ LibraryScreen.kt:143
- [ ] **Filter „Dokumente“ und Ordner-Chips mit „+ Neu“** (web/library.js:402–405) — Kotlin: ⬜ (keine Ordner)
- [ ] **Dialog „Neuer Ordner“** (Name, „Erstellen“, „Abbrechen“; web/library.js:138–141) — Kotlin: ⬜
- [ ] **Ordner-Optionen ••• „Ordner löschen“** (web/library.js:101, 128–131) — Kotlin: ⬜
- [ ] **Dialog „Neues Heft“** (Heftname, „Cover auswählen“, „Heft erstellen“, „Abbrechen“; web/library.js:151–157) — Kotlin: ⬜
- [ ] **Heft-Optionen ••• ** („Eigenes Bild wählen“, „Cover entfernen“, „Aus Archiv holen“, „Archivieren“, „In Papierkorb“; web/library.js:75, 181–195) — Kotlin: 🟡 LibraryScreen.kt nur Long-Press-Menü „Als Seite öffnen“ (LibraryScreen.kt:158–174)
- [ ] **Favorit-Stern** (web/library.js:70) — Kotlin: ⬜
- [ ] **Öffnen/Abspielen** (web/library.js:444) — Kotlin: 🟡 Öffnen per Android-Intent (LibraryScreen.kt:81–94)
- [x] **Leerer Filter** („Keine Seiten für diesen Filter“) — Kotlin: ✅ LibraryScreen.kt:108
- [ ] **Baum mit Auf-/Zuklappen** (web/library.js:239–248) — Kotlin: ⬜

**PDF-Ansicht (web/pdfs.js)**
- [ ] **Verkleinern / 100 % / Vergrößern / An Breite anpassen / Vollbild / In neuem Tab öffnen / PDF herunterladen** (web/pdfs.js:196–231) — Kotlin: ⬜ keine eingebettete Ansicht; 🟡 Öffnen extern (LibraryScreen.kt:94 „Keine App zum Öffnen von PDFs gefunden.“)
- [ ] **Höhen-Griff** („Unten ziehen um Höhe anzupassen (Doppelklick = Standardhöhe)“; web/pdfs.js:231) — Kotlin: ⬜
- [ ] **Fehler „PDF nicht gefunden“ / „PDF-Daten nicht gefunden“** (web/pdfs.js:137, 145) — Kotlin: 🟡 LibraryScreen.kt:82, 89 (andere Formulierung)

**Wissensgraph (web/graph.js)**
- [ ] **Titel „Wissensgraph“** und Modus-Umschalter „Erkunden / Lernen / Bearbeiten“ (web/graph.js:554–555) — Kotlin: ⬜ (kein Modul)
- [ ] **Suche „Unterthemen suchen“** und Knopf „Analyse aktualisieren“ (web/graph.js:556) — Kotlin: ⬜
- [ ] **Leerzustand „Baue deine Themenlandkarte“ mit „Jetzt analysieren“** (web/graph.js:431) — Kotlin: ⬜
- [ ] **Detailpanel** (Voraussetzungen, Verwandte Unterthemen, „Zugehörige Karten lernen“, „Änderungen speichern“, „Unterthemen verbinden“, „Als Voraussetzung verbinden“, „Verbindung als Synthese-Frage“, „Als Karte speichern“; web/graph.js:410–420, 526) — Kotlin: ⬜
- [ ] **Fehler „Erneut versuchen“** (web/graph.js:356) — Kotlin: ⬜
- [ ] **Hinweis „Skill gespeichert“** (web/graph.js:483) — Kotlin: ⬜

**Gemini Notebook (web/notebooklm.js)**
- [ ] **Hub „Gemini Notebook“ mit Inbox** (web/notebooklm.js:535–542) — Kotlin: ⬜ (Modul fehlt; Sidebar-Knopf ist Stub)
- [ ] **Seiten-Auswahl** („Alle“, „Keine“, „Nur aktuelle Seite“, Suche „Seiten durchsuchen…“, „Abbrechen“; web/notebooklm.js:425–430) — Kotlin: ⬜
- [ ] **Inbox-Aktionen „Öffnen“ / „Einordnen“ / „Speichern“ / „Löschen“ / „Später“** (web/notebooklm.js:348, 521–524, 566) — Kotlin: ⬜
- [ ] **Hinweise** („Quelle hinzufügen → Kopierter Text“, „Dateien in die Inbox übernommen“, „Unterseite angelegt.“; web/notebooklm.js:220–276) — Kotlin: ⬜

### 20. Hinweise der App selbst

- [ ] **Performance-Hinweis** (Knöpfe „Nein danke“ / „Einschalten“; Toast „Performance-Modus ist an …“; web/perf-hint.js:61, 73) — Kotlin: ⬜ (kein Pendant in ui/shell)
- [ ] **Update-Hinweis** (Toast „Update auf v{Version} installiert.“; web/updater.js:356) — Kotlin: ⬜ (PWA-Updater; Android über Play, n/a)

### 21. Darstellungsvarianten

Quelle: Startskript in web/index.html (Klassen am `body`), web/css/layout.css, web/settings.js:1112 (Schlüssel `impala67Density` u. a.).

- [x] **Dichte „kompakt“ (Standard)** (`body.density-compact`; css/layout.css) — Kotlin: ✅ DeskShell.kt (Maße 236 dp, Zeilen 36 dp)
- [x] **Dichte „komfortabel“** (App-Rand und Abstand 6 px `--app-gap`, Spalten als Karten mit Radius 16, Seitenleiste 260 px; css/layout.css `#app`) — Kotlin: ✅ DeskShell.kt (`Appearance.compact`)
- [x] **Schrift S / M (Standard) / L** (`body.font-s`, `body.font-l`) — Kotlin: ✅ ImpalaTheme.kt (`fontScale` 15/16 · 1 · 18/16)
- [ ] **Bewegung reduziert** (`body.perf-mode`, Schlüssel `impala67Motion`) — Kotlin: ⬜
- [x] **Tabs oben (Standard)** (Tab-Leiste, `#tabbar`) — Kotlin: ✅ DeskTabBar.kt
- [ ] **Tabs in Seitenleiste** (`body.tabs-in-sidebar`) — Kotlin: ⬜ (siehe Abschnitt 7)
- [ ] **Seitenleiste eingeklappt** (`body.sidebar-collapsed`, gespeichert in `localStorage`) — Kotlin: 🟡 DeskShell.kt (`rememberSaveable`, nicht dauerhaft)
- [x] **KI-Panel eingeklappt (Standard)** (`body.panel-collapsed`) — Kotlin: ✅ DeskShell.kt (`aiPanelOpen` startet `false`)
- [ ] **Hell / Dunkel / System** (Startskript, `impala67FollowSystemTheme`; web/settings.js:57) — Kotlin: 🟡 `Impala.colors` (`isDark`), kein Umschalter in der Desk-Shell gefunden
- [ ] **Beta-Oberfläche** (`body.beta-ui`, `impala67BetaUi`; web/beta-ui.css ist ein 6-Zeilen-Platzhalter) — Kotlin: n/a
- [ ] **Heft-Vollbild** (`body.heft-open`; css/layout.css) — Kotlin: 🟡 `ShellNav.immersive` blendet nur den KI-Knopf aus; Seitenleiste und Tab-Leiste bleiben (wie PWA)
- [ ] **Touch-Varianten** (Medienabfrage `pointer: coarse`; css/layout.css) — Kotlin: 🟡 Kotlin ist touch-only, keine Maus-Varianten
- [x] **Zeilenknöpfe immer sichtbar auf Touch** (`.row-add`) — Kotlin: ✅ DeskTreeRow.kt `RowButton` (immer sichtbar)

### 22. Querschnitt: leere Zustände, Badges, Drag & Drop, Resizer

**Leere Zustände**
- [x] **„Keine Seiten“** (Arbeitsbereich) — Kotlin: ✅ DeskSidebar.kt
- [x] **„Noch keine Stapel“** — Kotlin: ✅ DeskDecks.kt
- [x] **„Noch keine gespeicherten Chats.“** — Kotlin: ✅ ai/ChatList.kt
- [x] **„Der Papierkorb ist leer.“** — Kotlin: ✅ TrashScreen.kt
- [x] **„Das Archiv ist leer.“** — Kotlin: ✅ ArchiveScreen.kt
- [x] **„Keine Treffer“ / Suchhinweis** — Kotlin: ✅ SearchScreen.kt `EmptyHint`
- [x] **„Keine Seiten für diesen Filter“** (Bibliothek) — Kotlin: ✅ LibraryScreen.kt:108
- [ ] **Home-Leerzustand** („Leg deine erste Seite an …“) — Kotlin: 🟡 per Grep nicht gefunden

**Badges**
- [x] **Kartenzähler fällig / neu** (`deck-badge`) — Kotlin: ✅ DeskDecks.kt `CountBadge`
- [x] **Fälligkeits-Badge am Lernen-Eintrag** (AppShell, Badge mit Anzahl) — Kotlin: ✅ AppShell.kt (nur Telefon-Leiste, nicht Desk)
- [ ] **Rückverweis-Zähler** („N Rückverweise“) — Kotlin: ⬜
- [x] **„Archiv · “-Präfix in Suchzeilen** — Kotlin: ✅ SearchScreen.kt

**Drag & Drop und Resizer**
- [ ] **Seiten-Verschieben (Pointer)** — siehe Abschnitt 3 — Kotlin: ⬜
- [ ] **Stapel-Verschieben (HTML5)** — siehe Abschnitt 5 — Kotlin: ⬜
- [ ] **Seitenleisten-Breite (Griff)** — siehe Abschnitt 8 — Kotlin: ⬜
- [ ] **Tab-Reihenfolge verschieben** (web/tabs.js; nicht gelesen) — Kotlin: ⬜

**Zustände (Shell)**
- [ ] **Geöffnete Tabs werden gespeichert und wiederhergestellt** (web/tabs.js:285 `restoreSession`) — Kotlin: 🟡 `ShellNav.tabs` ist nur flüchtiger Zustand im Speicher (Wiederherstellung über den Back-Stack, nicht über Tab-Liste)
- [ ] **Sidebar-Modus und Aufklappzustand bleiben erhalten** (Synchronisierung über Ereignisprotokoll, web/collapse.js) — Kotlin: 🟡 `rememberSaveable`, nur Sitzung

Summary-Hinweise zur Priorisierung: Die größten Lücken für Desktop/Tablet sind Gemini Notebook und Wissensgraph (Stubs), die Vor-Navigation, die Chat-, Gemini- und Karten-Tabs, die Seitenkopf-Menüeinträge, Drag & Drop sowie der Breitengriff der Seitenleiste.


---

# 2. Seiten & Markdown-Editor


Legende: ✅ vorhanden wie PWA · 🟡 teilweise/abweichend · ⬜ fehlt
Kotlin-Pfade relativ zu `android/app/src/main/java/org/impala67/app/` (editor/, notes/, ui/desk/DeskPageActions.kt). Zeilen beziehen sich auf die PWA-Dateien unter `web/`.

### Vorab-Befund

- Der Kotlin-Editor ist read-first. Tippen geht nur im aktiven Textblock, komplexe Blöcke werden per Rohtext-Editor bearbeitet. Blockgriff, Drag, Blockmenü, Blockauswahl, Tastaturkürzel und Inline-Formatierung fehlen größtenteils.
- Die Datenbankansicht fehlt komplett. Das Kotlin-Seitenmodell hat kein `db`-Feld und kein `coverImg` (`android/app/src/main/java/uniffi/impala_ffi/impala_ffi.kt:13571-13625`).
- Auffällig: `editor/ComplexBlocks.kt:112` lädt Bilder nur bei `file:`-IDs. Die PWA legt Bilder als `img:`-IDs ab (`web/editor.js:924`). PWA-Bilder erscheinen in Kotlin daher vermutlich nur als Platzhalter.
- Auffällig: Der Toggle-Zustand wird in Kotlin nur lokal gehalten (`rememberSaveable`) und nicht ins Dokument geschrieben (`editor/ComplexBlocks.kt:177-195`). In der PWA wird `open` gespeichert (`web/editor.js:1523-1527`).
- Auffällig: Externe Links werden in Kotlin ohne Schema-Prüfung geöffnet (`editor/ReadContext.kt:36-50`). Die PWA erlaubt nur https, mailto, tel, # und relative Pfade (`web/editor-inline.js:31`).
- Die PWA hat keine schwebende Inline-Formatierungsleiste (per grep nicht gefunden). Die Formatierung läuft nur über Tastenkürzel und Markdown-Kürzel. Die Kotlin-`EditorToolbar.kt` ist eine Blockleiste, die es in der PWA nicht gibt.

---

### 1. Seitenkopf (Chrome, Icon, Cover, Titel, Breite, Schrift)

- [ ] **Seitenchrome-Zeile** – Container mit Zurück/Vor, Seitenleisten-Toggle, Breadcrumb und Aktionen (web/render.js:645-651) — Kotlin: 🟡 editor/EditorScreen.kt (Breadcrumb und Aktionen nur im Tablet-Modus über `chromeActions`; Zurück/Vor liegt in der Shell, nicht in editor/ geprüft)
- [ ] **Seitenleisten-Toggle ☰** (web/render.js:646) — Kotlin: ⬜ kein Gegenstück in editor/ (Shell-Navigation, nicht geprüft)
- [ ] **Zurück ‹ / Vor ›** mit deaktivierten Zuständen (web/render.js:647-649) — Kotlin: 🟡 ui/shell (Zurück ja, Vor nicht gefunden)
- [x] **Breadcrumb** mit Workspace, Ahnen, „…“ bei mehr als zwei Ebenen, aktuellem Titel (web/render.js:801-821) — Kotlin: ✅ editor/PageHeader.kt:45-72 (Workspace, „…“ und Ahnen vorhanden)
- [x] **Ahnen-Krümel klickbar** (web/render.js:806-814, data-page) — Kotlin: ✅ editor/PageHeader.kt:58-63 (Crumb mit onOpenPage)
- [ ] **Workspace-Krümel klickbar** (web/render.js:815, data-crumbws) — Kotlin: 🟡 editor/PageHeader.kt (als Text, keine Aktion gefunden)
- [ ] **Archiv-Banner** „Diese Seite ist archiviert.“ mit Wiederherstellen (web/render.js:692) — Kotlin: ⬜ kein Banner in editor/ (Archiv nur in notes/ArchiveScreen.kt)
- [ ] **Icon-Knopf** öffnet Icon-Picker per Klick auf das Icon (web/render.js:698, title „Icon ändern“) — Kotlin: 🟡 editor/PageHeader.kt zeigt Icon, Klick ohne Wirkung; Auswahl nur über ⋯ → Icon ändern (ui/desk/DeskPageActions.kt)
- [x] **Icon-Anzeige** (Emoji vor dem Titel, Größe 40) (web/render.js:698) — Kotlin: ✅ editor/PageHeader.kt:91-92
- [x] **Icon-Picker** mit 24 Emojis, „Entfernen“, „Schließen“ (web/render.js:1739-1748, Auswahl 📝 📘 … 🚀) — Kotlin: ✅ notes/PageDialogs.kt:141-166 (IconDialog, 24 Emojis identisch in PageIcons, Entfernen, Schließen)
- [ ] **+ Cover-Knopf** (web/render.js:699, nur ohne Cover) — Kotlin: ⬜ kein Cover in der Seitenansicht
- [ ] **Cover-Anzeige** (Banner, Höhe 200, Abrundung; Bild oder Preset-Klasse) (web/render.js:694-696, web/css/editor.css:269) — Kotlin: ⬜ editor/PageHeader.kt rendert kein Cover (PageSummary.cover vorhanden, nicht angezeigt)
- [ ] **Cover ändern / Entfernen** auf dem Banner (web/render.js:695, data-coverpick, data-coverremove, web/app.js:472-476) — Kotlin: 🟡 nur über ⋯ → Cover ändern (ui/desk/DeskPageActions.kt:139), Entfernen im Dialog
- [ ] **Cover-Auswahl**: 5 Presets aus COVER_PRESETS (sunset, ocean, forest, grape, mono) plus aurora, karo, linien, punkte, Entfernen, Schließen (web/render.js:1749-1758, web/library.js:21) — Kotlin: 🟡 notes/PageDialogs.kt:173-212 (9 Namen vorhanden, Darstellung vereinfacht, kein Cover sichtbar)
- [ ] **Eigenes Cover-Bild hochladen** („Eigenes Bild wählen“, Blob cover:, web/app-click-buttons.js:226-236) — Kotlin: ⬜ notes/PageDialogs.kt:169 (TODO(desk): fehlt, FFI bietet keine Blob-Ablage)
- [x] **Titel-Textarea**, auto-wachsend, Platzhalter „Unbenannt“ (web/render.js:704, 722-739) — Kotlin: ✅ editor/PageHeader.kt:88-117 (BasicTextField, Platzhalter „Unbenannt“)
- [x] **Titel-Speichern** bei Änderung, nur bei nicht-leerem getrimmtem Wert (web/app.js:684-690) — Kotlin: ✅ editor/EditorViewModel.kt:98 (onTitle, Autosave)
- [ ] **Enter im Titel** (PWA: kein Enter-Handler gefunden, Zeilenumbruch in Textarea) — Kotlin: 🟡 editor/PageHeader.kt:95 (Enter springt in den Text, Zeilenumbruch entfernt)
- [x] **Rückverweise-Chip** „N Rückverweise“ mit Aufklappen, max. 20 Einträge (web/render.js:794-800) — Kotlin: ✅ editor/PageHeader.kt:120-135
- [x] **Breite (Lesebreite)**: Die PWA hat keine seitenbezogene Breiten-Option; fix max. 760 px (web/css/editor.css:5) — Kotlin: ✅ editor/EditorScreen.kt:79 (widthIn 760)
- [x] **Schriftgröße**: Die PWA hat nur eine globale Einstellung S/M/L (web/settings-renderer.js:106, web/settings.js:99-101), keine seitenbezogene Schrift — Kotlin: ✅ settings/SettingsAppearance.kt:48 (global)

### 2. Seitenaktionen (Topbar „Teilen“, Favorit, ⋯-Menü)

#### 2a Teilen-Knopf und Teilen-Menü
- [x] **Teilen-Knopf** mit Label (web/render.js:761, data-sharemenu) — Kotlin: ✅ ui/desk/DeskPageActions.kt (ShareButton)
- [ ] **Teilen-Menü: Als PDF exportieren / drucken** (web/render.js:766-770, data-exportpdf) — Kotlin: 🟡 DeskPageActions.kt (Knopf „Teilen“ startet direkt Android-Teilen mit Klartext, kein Menü; PDF nur im ⋯-Menü)
- [x] **Teilen-Menü: Als Markdown (.md) speichern** (web/render.js:768, extras.js:622-627) — Kotlin: ✅ DeskPageActions.kt exportMarkdown → notes/PageOps.kt:57 (Medienverweise bleiben IDs, wie in der PWA)
- [x] **Teilen-Menü: Internen Link kopieren** (web/render.js:769, extras.js:645-650, Format `#id`) — Kotlin: ✅ DeskPageActions.kt copyLink, notes/PageOps.kt:60
- [ ] **Teilen (Android)** — Kotlin: 🟡 DeskPageActions.kt share() schickt Titel und Klartext ohne Markdown-Umsetzung; die PWA hat kein Android-Teilen als Teil des Teilen-Knopfs

#### 2b Favorit-Stern
- [x] **Favorit-Stern** mit aktiv-Zustand (web/render.js:762, title wechselt) — Kotlin: ✅ DeskPageActions.kt (SmallButton star, active)

#### 2c ⋯-Menü (web/render.js:771-792)
- [x] **Rückgängig (Strg+Z)** (web/render.js:773, data-editundo, web/app.js:554) — Kotlin: ✅ DeskPageActions.kt → EditorViewModel.undo (mit Hinweis „Strg+Z“)
- [x] **Wiederholen (Strg+Y)** (web/render.js:774, data-editredo) — Kotlin: ✅ DeskPageActions.kt → EditorViewModel.redo
- [x] **Zu Favoriten / Favorit entfernen** (web/render.js:776) — Kotlin: ✅ DeskPageActions.kt (toggleFavorite)
- [ ] **Als PDF exportieren / drucken** (web/render.js:777, extras.js:569-600) — Kotlin: 🟡 DeskPageActions.kt exportPdf → notes/PageOps.kt:81-89 (nur Absätze als Klartext, ohne Markdown, Formeln, Bilder; Heft-Export „folgt“)
- [x] **Als Markdown (.md) speichern** (web/render.js:778) — Kotlin: ✅ DeskPageActions.kt
- [x] **Internen Link kopieren** (web/render.js:779) — Kotlin: ✅ DeskPageActions.kt
- [x] **Verlauf** (web/render.js:781, btnHistory, web/render.js:1152-1168 Vorschau und „Diese Version wiederherstellen“) — Kotlin: ✅ notes/PageDialogs.kt:86-137 (HistoryDialog, Restore, „Keine Versionen“ fehlt im Text, aber leer ist abgedeckt)
- [x] **PDF im neuen Tab öffnen** (web/render.js:784, btnOpenPdfTab, nur bei pdfId) — Kotlin: ✅ DeskPageActions.kt `openPdf` (PDF-App des Geräts)
- [x] **PDF herunterladen** (web/render.js:785, btnDownloadPdf, nur bei pdfId) — Kotlin: ✅ DeskPageActions.kt `downloadPdf`
- [x] **Icon ändern** (web/render.js:786) — Kotlin: ✅ DeskPageActions.kt → IconDialog
- [ ] **Cover ändern** (web/render.js:787) — Kotlin: 🟡 DeskPageActions.kt → CoverDialog (ohne eigenes Bild)
- [x] **Karten aus Markierungen (n)** (web/render.js:788, data-cardsfromhl, nur bei ==…== oder {{c1::…}}, web/extras.js:678) — Kotlin: ✅ DeskPageActions.kt `cardsFromHighlights`
- [x] **Duplizieren** (web/render.js:570 dupTplItems, data-pageduplicate) — Kotlin: ✅ DeskPageActions.kt und DeskTreeRow.kt
- [x] **Als Vorlage / Vorlage entfernen** (web/render.js:570, data-pagetemplate, web/app-click-pages.js:29-37) — Kotlin: ✅ DeskPageActions.kt und DeskTreeRow.kt
- [ ] **Als Vorlesungsübersicht / Übersicht aufheben** (web/render.js:571, data-pagedb, nur keine Heft-Seiten, web/app-click-pages.js:39-46) — Kotlin: ⬜ (kein db-Feld im Seitenmodell)
- [ ] **Fach: <Name>…** (web/render.js:572, data-pagesubject, web/app-click-pages.js:121-127) — Kotlin: ⬜ (kein Fach-Feld im Seitenmodell)
- [x] **Verschieben nach…** (web/render.js:573, data-pagemove, web/app-dialogs.js) — Kotlin: ✅ DeskPageActions.kt openMove → notes/PageDialogs.kt:48-80 (MovePageDialog)
- [x] **Archivieren** (web/render.js:574, data-pagearchive, web/app-click-pages.js:203-214) — Kotlin: ✅ DeskPageActions.kt (archivePage, Tab schließen)
- [x] **Aus Archiv holen** (web/render.js:574, data-pageunarchive) — Kotlin: ✅ notes/ArchiveScreen.kt (Wiederherstellen, nicht im Seitenmenü)
- [x] **Löschen** (web/render.js:575, data-pagetrash, web/app-click-pages.js:229-240, direkt in Papierkorb ohne Rückfrage) — Kotlin: ✅ DeskPageActions.kt (trashPage, Tab schließen, danger)

#### 2d Seitenleisten-Menü der Seite (web/render.js:576-584 pageMenuHtml)
- [x] **In neuem Tab öffnen** (web/render.js:577, data-pageopennew) — Kotlin: ✅ ui/desk/DeskTreeRow.kt:115
- [x] **Umbenennen** (web/render.js:577, data-pagerename) — Kotlin: ✅ DeskTreeRow.kt:116
- [ ] **Duplizieren / Als Vorlage / Vorlesungsübersicht / Fach / Verschieben / Archivieren / Löschen** (wie oben) — Kotlin: 🟡 DeskTreeRow.kt:117-121 hat Duplizieren, Vorlage, Verschieben, Archivieren, Löschen; Vorlesungsübersicht und Fach ⬜
- [x] **Favorit / Favorit entfernen** (web/render.js:578) — Kotlin: ✅ DeskTreeRow.kt:119 (favorite)

### 3. Neu anlegen und Vorlagen

- [x] **Dialog „Neu anlegen“** mit Notion-Seite, GoodNotes-Heft, Beschreibungen (web/render.js:1136-1150, data-tplblank/-tplheft) — Kotlin: ✅ notes/TemplatePicker.kt:27-70 (Telefon Bottom-Sheet, Tablet Dialog)
- [x] **Vorlagen-Liste „Oder aus einer Vorlage“** mit Icon und Titel (web/render.js:1145, data-tpluse, nur isTemplate) — Kotlin: ✅ notes/TemplatePicker.kt:74-76
- [x] **Vorlagen-Symbol** (web/render.js:1145, pageIcon „template“) — Kotlin: ✅ notes/TemplatePicker.kt:85-90

### 4. Unterseiten, Verwandt, Backlinks

- [ ] **Unterseiten-Liste am Seitenende** (Icon, Titel, data-page, Heft-Einbettung ausgeblendet, nicht bei DB-Seiten; web/editor.js:566-589, Klasse child-pages) — Kotlin: ⬜ editor/EditorScreen.kt (keine Unterseitenliste; Navigation über Desk-Baum und Liste notes/NoteRows.kt:84)
- [x] **Unterseite anlegen** (Notiz-Liste, Optionen-Menü) (notes/NoteRows.kt:126) — Kotlin: ✅ notes/NoteRows.kt (nur Notizliste, nicht im Editor)
- [ ] **„Verwandt“-Leiste** mit bis zu 3 ähnlichen Seiten aus Embeddings, Chips mit Icon, ×-Knopf zum Ausblenden (web/related-pages.js:15-38, render.js:712) — Kotlin: ⬜ kein Gegenstück in editor/ (nur Einstellungsschalter settings/SettingsAppearance.kt:76 ✅)
- [ ] **Verwandt ausblenden (×)** setzt relatedPages=false (web/related-pages.js:35-38) — Kotlin: ⬜
- [ ] **Verwandt-Leiste leer = versteckt** (web/related-pages.js:22-27) — Kotlin: ⬜
- [x] **Rückverweise** (siehe Abschnitt 1) — Kotlin: ✅ editor/PageHeader.kt:120-135

### 5. Editor-Grundlagen (Modell, Speichern, Verlauf)

- [x] **Blockmodell aus Markdown** (WASM-Kern mdParse, web/editor-markdown.js:11, web/core/impala_core.js:3364; Syntax in core/impala-markdown/src/parse.rs) — Kotlin: ✅ über uniffi markdownToBlocks/blocksToMarkdown (editor/EditorViewModel.kt, editor/MarkdownView.kt:29)
- [x] **Autosave** (PWA 450 ms, web/editor.js:376; Kotlin 600 ms, editor/EditorViewModel.kt:296) — Kotlin: ✅ (Verhalten gleich, Wert abweichend)
- [x] **Verlauf koaleszieren** (PWA 700 ms, web/editor.js:306; Kotlin 900 ms, EditorViewModel.kt:297) — Kotlin: ✅ (Wert abweichend)
- [ ] **Verlauf-Limit** (PWA 200 Schritte, web/editor.js:87; Kotlin 100, EditorViewModel.kt:298) — Kotlin: 🟡 (kleineres Limit)
- [ ] **Undo/Redo** app-weit mit Strg+Z/Y auch außerhalb des Editors (web/editor.js:1864-1871) — Kotlin: 🟡 nur über EditorToolbar.kt:46-47 (Schaltflächen, kein Tastenkürzel)
- [x] **Sync-Änderung von außen übernehmen** (web/editor.js:1913-1918, externallyChanged) — Kotlin: ✅ editor/EditorViewModel.kt:79 (applyRemote)
- [x] **Seitenwechsel schreibt offene Änderungen vorher** (web/editor.js:1910-1917) — Kotlin: ✅ (ON_STOP flush, editor/EditorScreen.kt:52; onCleared)
- [ ] **PDF-Duplikat-Blöcke ausblenden** (web/editor.js:591-604, isPdfDuplicateBlock) — Kotlin: ⬜
- [ ] **PDF-Viewer oben auf PDF-Seiten** (web/render.js:707, 752-757, pdfViewer) — Kotlin: ⬜ (PDF-Seiten nur extern geöffnet)

### 6. Blockgriff, Plus, Drag, Blockmenü, Blockauswahl

- [ ] **Gutter links** mit Plus und Griff, nur bei Hover/Fokus sichtbar (web/editor.js:556-557, web/css/editor.css:7-8, 279-286) — Kotlin: ⬜ kein Gutter in editor/BlockView.kt
- [ ] **Plus-Knopf „Block darunter einfügen“**: neuer Absatz mit „/“ und Slash-Menü offen (web/editor.js:1508-1518) — Kotlin: ⬜ (nur Leerbereich unter dem letzten Block: editor/EditorScreen.kt tail, EditorViewModel.kt:194 focusEnd)
- [ ] **⋮⋮-Griff Klick** öffnet das Blockmenü (web/editor.js:1520-1521, editor-menus.js:272) — Kotlin: ⬜ (Blockmenü fehlt)
- [ ] **⋮⋮-Griff ziehen** (nur Top-Level-Blöcke, drop-above/-below-Markierung, web/editor.js:1647-1690, css 221-222) — Kotlin: ⬜ (kein Drag in editor/)
- [ ] **Blöcke per Maus über Blockgrenzen markieren** (Blockauswahl, web/editor.js:1624-1643) — Kotlin: ⬜
- [x] **Blockauswahl-Rahmen** (web/css/editor.css:217-218, `.blk.selected`) — Kotlin: ✅ editor/BlockView.kt:84-86 (selected-Rahmen, nur für Nicht-Text-Blöcke im Select-Modus, EditorViewModel.kt:182-188)
- [ ] **Blöcke mit Dateien per Drop einfügen** (web/editor.js:1684-1694) — Kotlin: ⬜
- [ ] **Blockmenü Umwandeln in** (11 Typen: Text, Überschrift 1-3, To-do, Aufzählung, Nummerierte Liste, Toggle, Zitat, Callout, Code; web/editor-menus.js:266-271, 273-276) — Kotlin: 🟡 EditorToolbar.kt:49-57 (9 Typen: T, H1-3, •, 1., ☑, ”, </>; Toggle und Callout fehlen)
- [ ] **Farbe Text (8 Farben) + Hintergrund (8) + Farbe entfernen ✕** (web/editor-menus.js:276-285, COLORS in 16, data-bcolor, web/editor.js:1780-1790) — Kotlin: 🟡 Darstellung ✅ (editor/BlockView.kt:55, 85 rendert textColor/bgColor), Auswahl ⬜ (kein Menü)
- [ ] **Duplizieren (Strg+D)** (web/editor-menus.js:288, web/editor.js:1792-1797) — Kotlin: ⬜
- [ ] **Als Markdown kopieren** (web/editor-menus.js:289, web/editor.js:1799-1811) — Kotlin: ⬜
- [ ] **Lernkarte erstellen** (nur Textblöcke, web/editor-menus.js:290, web/editor.js:1813-1821, cardCreate) — Kotlin: ⬜
- [ ] **Löschen (Entf)** (web/editor-menus.js:291-292, web/editor.js:1823-1830) — Kotlin: 🟡 EditorToolbar.kt:59 („Block löschen“, nur für den aktiven Block, Nachbar wird aktiviert)

### 7. Slash-Menü („/“, 22 Einträge)

Öffnen und Bedienung:
- [x] **Öffnen mit „/“** am Zeilenanfang oder nach Leerzeichen, Filter nach Teilwort (web/editor.js:1014-1024, web/editor-menus.js:125-146) — Kotlin: ✅ editor/BlockEditors.kt:70-75 und editor/MarkdownShortcuts.kt:19 (SLASH_TRIGGER)
- [x] **Filter nach Label oder Schlüssel** (web/editor-menus.js:127) — Kotlin: ✅ editor/SlashMenu.kt:55-58 (slashItems)
- [x] **Menü stiehlt den Fokus nicht** (web/editor-menus.js:112-146 ohne Fokus) — Kotlin: ✅ editor/SlashMenu.kt:63-65 (focusable=false)
- [ ] **Tastaturnavigation ↑ ↓ Enter Tab Esc** (web/editor.js:1168-1181) — Kotlin: ⬜ (TODO: editor/SlashMenu.kt:63)
- [x] **Auswahl per Tipp/Klick, Befehl ausführen, „/befehl“ entfernen** (web/editor-menus.js:147-226) — Kotlin: ✅ editor/SlashMenu.kt:74-80, editor/EditorBlockCommands.kt:12-22

Einträge (web/editor-menus.js:99-122, Reihenfolge wie PWA):
- [x] **Text** (¶, Einfacher Absatz) — Kotlin: ✅ SlashMenu.kt SlashCmd.Paragraph
- [x] **Überschrift 1** (H1, „# “) — Kotlin: ✅ SlashMenu.kt H1
- [x] **Überschrift 2** (H2, „## “) — Kotlin: ✅ SlashMenu.kt H2
- [x] **Überschrift 3** (H3, „### “) — Kotlin: ✅ SlashMenu.kt H3
- [x] **To-do-Liste** (Checkbox-Icon, „[] “) — Kotlin: ✅ SlashMenu.kt Todo
- [x] **Aufzählung** („•“, „- “) — Kotlin: ✅ SlashMenu.kt Bullet
- [x] **Nummerierte Liste** („1.“, „1. “) — Kotlin: ✅ SlashMenu.kt Number
- [ ] **Toggle-Liste** (▸, „> aufklappbar“) — Kotlin: ⬜ (TODO: SlashMenu.kt:35)
- [x] **Zitat** (”, „> “) — Kotlin: ✅ SlashMenu.kt Quote
- [ ] **Callout** (Glühbirne, Kasten blau) — Kotlin: ⬜ (TODO: SlashMenu.kt:35)
- [x] **Code** (</>, Codeblock mit Syntax; Standardsprache javascript, web/editor.js:116) — Kotlin: ✅ SlashMenu.kt Code (Sprache nicht wählbar, siehe Abschnitt 12)
- [ ] **Gleichung** (√, KaTeX-Formel, öffnet Popover) — Kotlin: ⬜ (TODO: SlashMenu.kt:35)
- [ ] **Diagramm** (Graph-Icon, Mermaid) — Kotlin: ⬜ (TODO: SlashMenu.kt:35)
- [ ] **SVG-Grafik** (Zeichenstift-Icon, SVG-Code) — Kotlin: ⬜ (TODO: SlashMenu.kt:35)
- [ ] **Tabelle** (▦, einfache Tabelle 2×2) — Kotlin: ⬜ (TODO: SlashMenu.kt:35)
- [ ] **2 Spalten** (Spalten-Icon, nebeneinander) — Kotlin: ⬜ (TODO: SlashMenu.kt:35)
- [x] **Trennlinie** („—“, „---“) — Kotlin: ✅ SlashMenu.kt Divider, EditorBlockCommands.kt:24-29
- [ ] **Bild** (Hochladen, accept image/*) — Kotlin: ⬜ (TODO: SlashMenu.kt:35)
- [ ] **PDF** (PDF einbetten, accept application/pdf) — Kotlin: ⬜ (TODO: SlashMenu.kt:35)
- [ ] **Datei / Medien** (Video, Audio, Sonstige, accept leer) — Kotlin: ⬜ (TODO: SlashMenu.kt:35)
- [ ] **Heft** (Notebook-Icon, legt Heft-Seite an und bettet ein; web/editor-menus.js:172-185) — Kotlin: ⬜ (TODO: SlashMenu.kt:35)
- [ ] **Seite verlinken** (Link-Icon, „[[“, öffnet Link-Menü) — Kotlin: ⬜ (TODO: SlashMenu.kt:35)

### 8. Seiten-Link-Menü („[[“)

- [ ] **Öffnen bei „[[“** mit Debounce 80 ms beim Weitertippen (web/editor.js:1027-1044) — Kotlin: ⬜
- [ ] **Max. 8 Treffer, ohne aktuelle Seite, Titelfilter** (web/editor-menus.js:227-244) — Kotlin: ⬜
- [ ] **„Keine Seite gefunden“** (web/editor-menus.js:240) — Kotlin: ⬜
- [ ] **Auswahl: Link „[Titel](#id)“ einfügen, Titel ohne eckige Klammern** (web/editor-menus.js:245-264) — Kotlin: ⬜
- [x] **Anzeige [[Titel]] als Link, nur bei exakt aktivem Titel** (web/editor-inline.js:34-40) — Kotlin: ✅ editor/InlineMarkdown.kt:50-51 (wiki:), editor/ReadContext.kt:43 (findPageByTitle)
- [x] **Klick auf interne Seite (#id)** (web/editor.js:1582-1590) — Kotlin: ✅ editor/ReadContext.kt:44
- [ ] **Externe Links öffnen (https, mailto, tel; sonst Text)** (web/editor.js:1572-1576, web/editor-inline.js:31) — Kotlin: 🟡 editor/ReadContext.kt:45 (öffnet jedes Ziel ohne Schema-Prüfung)

### 9. Inline-Formatierung (Leiste, Tasten, Farben, Formeln)

- [ ] **Schwebende Formatierungsleiste** (PWA: nicht vorhanden) — Kotlin: 🟡 nur Blockleiste EditorToolbar.kt (keine Inline-Schaltflächen)
- [ ] **Fett Strg+B** (Wrap `**`, web/editor.js:1228) — Kotlin: ⬜
- [ ] **Kursiv Strg+I** (Wrap `*`, web/editor.js:1229) — Kotlin: ⬜
- [ ] **Unterstrichen Strg+U** (Wrap `<u>`, web/editor.js:1230) — Kotlin: ⬜
- [ ] **Code Strg+E** (Wrap Backtick, web/editor.js:1231) — Kotlin: ⬜
- [ ] **Durchgestrichen Strg+Shift+S** (Wrap `~~`, web/editor.js:1232) — Kotlin: ⬜
- [ ] **Farbe wiederholen Strg+Shift+H** (letzte Farbe, Standard bg:yellow, web/editor.js:1233, 1132-1135) — Kotlin: ⬜
- [ ] **Link Strg+K** (Prompt „Link-Adresse:“, web/editor.js:1234-1237) — Kotlin: ⬜
- [ ] **Auswahl umschließen, Marker erkennen und entfernen** (web/editor.js:1109-1131 wrapSelection) — Kotlin: ⬜
- [x] **Darstellung fett, kursiv, fett-kursiv, durchgestrichen, unterstrichen, Code** (web/editor-inline.js:34-74) — Kotlin: ✅ editor/InlineMarkdown.kt:47-86
- [x] **Markierung ==…==** (Gelb, web/editor-inline.js:61) — Kotlin: ✅ editor/InlineMarkdown.kt:61 (gelbe Hintergrundfarbe)
- [x] **Textfarbe {red}…{/} und Hintergrund {bg-red}…{/}** (8 Farben, web/editor-inline.js:58, web/css/editor.css:65-81) — Kotlin: ✅ editor/InlineMarkdown.kt:53-61 (inlineColor)
- [ ] **Markdown-Zeichen beim Tippen ausgeblendet, sobald Muster vollständig** (web/editor.js:1087-1105) — Kotlin: 🟡 editor/BlockEditors.kt:61 (Marker bleiben beim Bearbeiten sichtbar)
- [ ] **Inline-Formel $…$ und \(…\) als klickbarer Chip mit Popover** (web/editor-inline.js:139-175, 33; Chip-Klick editor.js:1563-1576) — Kotlin: 🟡 editor/InlineMarkdown.kt:89-97 (monospace, kein KaTeX, kein Popover)

### 10. Markdown-Kürzel (Live-Trigger und Syntax)

- [x] **„# “ → Überschrift 1** (web/editor.js:1006-1011) — Kotlin: ✅ editor/MarkdownShortcuts.kt:8
- [x] **„## “ → Überschrift 2** — Kotlin: ✅ MarkdownShortcuts.kt:9
- [x] **„### “ → Überschrift 3** — Kotlin: ✅ MarkdownShortcuts.kt:10
- [x] **„- “, „* “, „+ “ → Aufzählung** (web/editor.js:1008) — Kotlin: ✅ MarkdownShortcuts.kt:11
- [x] **„1. “, „1) “ → Nummerierte Liste** (web/editor.js:1009) — Kotlin: ✅ MarkdownShortcuts.kt:12
- [x] **„[] “ oder „[ ] “ → To-do** (web/editor.js:1010-1011) — Kotlin: ✅ MarkdownShortcuts.kt:13
- [x] **„> “ → Zitat** (web/editor.js:1012) — Kotlin: ✅ MarkdownShortcuts.kt:14
- [x] **Kürzel nur am Absatzanfang, direkt nach Leerzeichen** (web/editor.js:1040-1046) — Kotlin: ✅ editor/BlockEditors.kt:70-72 (nur Paragraph)
- [ ] **„---“ → Trennlinie** (web/editor.js:1070-1076) — Kotlin: 🟡 nur über Slash-Befehl, kein Live-Trigger (EditorBlockCommands.kt:24)
- [ ] **„```sprache“ → Codeblock** (web/editor.js:1078-1081) — Kotlin: ⬜
- [ ] **„$$“ → Gleichungsblock mit Popover** (web/editor.js:1083-1088) — Kotlin: ⬜
- [x] **„/“ → Slash-Menü** (siehe Abschnitt 7) — Kotlin: ✅
- [ ] **„[[“ → Link-Menü** (siehe Abschnitt 8) — Kotlin: ⬜
- [x] **Syntax Callout „> [!farbe] Titel“, <details><summary>, :::columns/:::split/:::end, :::file, :::heft, $$/\[ …\], GFM-Tabelle, Farbmarkierung <!--@c:…-->** (core/impala-markdown/src/parse.rs:31-140, 164-230) — Kotlin: ✅ über den gemeinsamen Rust-Kern (markdownToBlocks), Darstellung je Block in Abschnitt 12

### 11. Tastaturkürzel

Editor-Text (web/editor-keys.js, web/editor.js):
- [x] **Enter: neuer Block; Liste setzt fort; leere Liste ausrücken oder zu Text** (web/editor-keys.js:27-47) — Kotlin: ✅ editor/EditorViewModel.kt:217-232 (split, emptyBreak) — nur hardware-unabhängig, Enter auf Bildschirmtastatur
- [ ] **Shift+Enter: weicher Umbruch im Block** (web/editor-keys.js:25) — Kotlin: ⬜ (jeder Zeilenumbruch teilt den Block, BlockEditors.kt:83-87)
- [ ] **Tab / Shift+Tab: Listen einrücken/ausrücken** (web/editor-keys.js:60-70) — Kotlin: 🟡 editor/BlockEditors.kt:106 (nur Hardware-Tab, nur Listen)
- [ ] **Backspace am Anfang: Liste zu Text, Überschrift zu Text, mit Vorgänger verschmelzen** (web/editor-keys.js:75-157) — Kotlin: 🟡 editor/EditorViewModel.kt:235-255 (vereinfacht, kein Verschmelzen mit Strukturblock)
- [ ] **Entf am Ende: nächsten Block anhängen** (web/editor-keys.js:159-180) — Kotlin: ⬜
- [ ] **↑ ↓ an Blockgrenzen in Nachbarblock wechseln** (web/editor-keys.js:182-200) — Kotlin: ⬜
- [ ] **Strg+Z / Strg+Y (Strg+Shift+Z)** (web/editor.js:1187-1188) — Kotlin: ⬜ (nur Toolbar, siehe Abschnitt 5)
- [ ] **Strg+A zweistufig: Feld, dann alle Blöcke** (web/editor.js:1212-1226) — Kotlin: ⬜
- [ ] **Strg+D: Block duplizieren** (web/editor.js:1245-1250) — Kotlin: ⬜
- [ ] **Strg+Shift+0–8: Blocktyp (0 Text, 1–3 Überschriften, 4 To-do, 5 Aufzählung, 6 Nummer, 7 Toggle, 8 Code)** (web/editor.js:1252-1264) — Kotlin: ⬜
- [ ] **Strg+Shift+↑/↓: Block verschieben** (web/editor.js:1266-1275) — Kotlin: ⬜
- [ ] **Esc: Textfokus zur Blockauswahl** (web/editor.js:1202-1210) — Kotlin: 🟡 editor/EditorScreen.kt:52 (Zurück beendet nur die Bearbeitung)
- [ ] **Blockauswahl: Esc, Backspace/Entf löscht, Enter zum Nachbarn, Strg+C/X/D, ↑↓ mit Shift erweitern** (web/editor.js:1377-1445) — Kotlin: ⬜
- [ ] **Tabelle: Tab/Shift+Tab zu Nachbarzelle, letzte Zelle erzeugt Zeile, Enter zur Zelle darunter, Backspace in leerer Zelle, ↑↓** (web/editor-keys.js:235-290) — Kotlin: ⬜
- [ ] **Code: Tab fügt zwei Leerzeichen ein, Backspace in leerem Block macht Absatz, ↓/↑ verlässt Block** (web/editor-keys.js:291-320) — Kotlin: ⬜
- [ ] **Toggle-Titel: Enter öffnet und legt Kind an, Backspace leer entpackt, ↑↓** (web/editor.js:1284-1340) — Kotlin: ⬜
- [ ] **Gleichungs-Popover: Enter fertig, Shift+Enter neue Zeile, Esc abbrechen** (web/editor.js:1845-1847, web/editor-menus.js:297-325) — Kotlin: ⬜
- [ ] **Slash-/Link-Menü: ↑↓ Enter Tab Esc** (web/editor.js:1168-1181) — Kotlin: ⬜ (siehe Abschnitt 7 und 8)
- [ ] **Global: Strg+K Befehls-Menü** (web/shortcuts.js:84) — Kotlin: ⬜ (nicht im Editor geprüft)

### 12. Blocktypen (Darstellung und Bedienung)

#### 12a Text, Überschriften, Listen, Zitat, Trennlinie
- [ ] **Absatz** (web/editor.js:547, Platzhalter „Schreib etwas, oder drücke „/“ für Befehle …“) — Kotlin: ✅ editor/BlockView.kt:113-128 (Text editierbar nach Tipp); 🟡 Platzhalter fehlt (BlockView.kt:71-75 liefert für Absätze keinen Text)
- [x] **Überschrift 1–3** (web/editor.js:454-455, Platzhalter „Überschrift N“, Größen web/css/editor.css:111-113) — Kotlin: ✅ editor/BlockView.kt:53-70 (Größen 30/24/20 sp, Platzhalter 71-75)
- [x] **Aufzählung** (•, Einrückung 26 px je Ebene, web/editor.js:457-460) — Kotlin: ✅ editor/BlockView.kt:130-150 (ListRow, Einzug 24 dp)
- [x] **Nummerierte Liste** (Zähler über alle Ebenen, web/editor.js:461-465, numberBlocks 673-707) — Kotlin: ✅ editor/BlockOps.kt:91 (listNumbers), BlockView.kt:146
- [x] **To-do-Liste** (Checkbox, durchgestrichen bei erledigt, web/editor.js:466-470, Klick 1502-1507) — Kotlin: ✅ editor/BlockView.kt:133-139 (toggleTodo, EditorViewModel.kt:209)
- [x] **Zitat** (linker Balken, web/editor.js:471, web/css/editor.css:118, 264) — Kotlin: ✅ editor/BlockView.kt:89-96
- [x] **Trennlinie** (web/editor.js:474, web/css/editor.css:49) — Kotlin: ✅ editor/BlockView.kt:101
- [ ] **Blockfarben (Text/Hintergrund)** (web/editor.js:416-418, colorStyle) — Kotlin: ✅ Darstellung (BlockView.kt:55, 85); 🟡 Bedienung fehlt

#### 12b Tabellen
- [x] **Tabelle, Kopfzeile fett** (web/editor.js:513-526, web/css/editor.css:155-161) — Kotlin: ✅ editor/ComplexBlocks.kt:142-160 (Kopf halbfett, horizontal scrollbar)
- [ ] **Zellen direkt editierbar mit Inline-Markdown** (web/editor.js:518-520, editable mit data-bcell) — Kotlin: ⬜ (nur Rohtext über Stift, ComplexBlocks.kt:64-94)
- [ ] **+ Spalte rechts / + Zeile unten** (web/editor.js:523-524, css 162-170) — Kotlin: ⬜
- [ ] **Tabellen-Tastatur** (Abschnitt 11) — Kotlin: ⬜
- [x] **Zeilen auf gleiche Breite auffüllen (GFM, mindestens 2 Spalten)** (core/impala-markdown/src/parse.rs:262-281) — Kotlin: ✅ (über Kern)

#### 12c Callouts
- [x] **Callout mit Farbpunkt und Hintergrund** (8 Farben blue, gray, red, orange, yellow, green, purple, pink; web/editor.js:527-531, css 173-194) — Kotlin: ✅ editor/ComplexBlocks.kt:162-175 (Farbpunkt und Tönung)
- [ ] **Farbpunkt Klick wechselt Farbe im Zyklus blau, grün, gelb, rot, grau, lila** (web/editor.js:1544-1551; pink nicht im Zyklus) — Kotlin: ⬜
- [ ] **Callout-Inhalt verschachtelt und bearbeitbar** (web/editor.js:527-531 children) — Kotlin: 🟡 nur Anzeige; Bearbeitung über Stift (ComplexBlocks.kt:33-44)
- [ ] **Callout über Slash oder Blockmenü anlegen** (web/editor-menus.js:103, 266-270) — Kotlin: ⬜

#### 12d Toggle-Liste
- [ ] **Aufklapp-Pfeil ▸/▾ schaltet und speichert** (web/editor.js:532-540, 1523-1527 `b.open` gespeichert) — Kotlin: 🟡 editor/ComplexBlocks.kt:177-195 (öffnet, aber nur lokal, nicht gespeichert)
- [ ] **Titel (Summary) editierbar** (web/editor.js:536, Platzhalter „Toggle“) — Kotlin: 🟡 (nur Anzeige, ComplexBlocks.kt:188)
- [x] **Kindblöcke eingerückt** (web/editor.js:538-539, css 200) — Kotlin: ✅ ComplexBlocks.kt:191-193
- [ ] **Toggle über Slash/Blockmenü** (web/editor-menus.js:101, 266) — Kotlin: ⬜

#### 12e Spalten
- [x] **2 Spalten nebeneinander** (web/editor.js:541-546, css 202-206) — Kotlin: ✅ editor/ComplexBlocks.kt:82-85 (Row mit weight)
- [ ] **Auf schmalen Bildschirmen untereinander (≤ 640 px)** (web/css/editor.css:204-206) — Kotlin: 🟡 (feste Zeile, kein Umbruch)
- [ ] **Spalten über Slash „2 Spalten“** (web/editor-menus.js:113) — Kotlin: ⬜
- [ ] **Spaltenbearbeitung** — Kotlin: 🟡 nur über Stift/Rohtext

#### 12f Code-Blöcke
- [x] **Codeblock mit Monospace und Hintergrund** (web/editor.js:477-487, css 120-125) — Kotlin: ✅ editor/BlockView.kt:154-170 (CodeBlock), Eingabe via BlockEditors.kt:53-60 (isCode)
- [ ] **Sprache als Knopf oben links, Klick öffnet Prompt „Sprache:“** (web/editor.js:483, 1553-1560, css 123) — Kotlin: 🟡 Sprache wird angezeigt (BlockView.kt:158), nicht änderbar
- [ ] **Syntax-Highlight (highlight.js)** (web/editor.js:421-432, Neuaufbau bei Fokusverlust 1494, 821-828) — Kotlin: ⬜ (Monospace ohne Färbung)
- [ ] **Tab fügt zwei Leerzeichen ein** (web/editor-keys.js:291-296) — Kotlin: ⬜
- [ ] **Leeren Codeblock per Rücktaste in Absatz wandeln** (web/editor-keys.js:296-304) — Kotlin: 🟡 (EditorViewModel.kt:245 Typwechsel)
- [x] **Zeilenumbruch mit Enter im Code** (web/editor.js:1278-1281) — Kotlin: ✅ (BlockEditors.kt:83 splittet nicht bei Code)
- [x] **Horizontal scrollen bei langen Zeilen** (web/css/editor.css:121, 122) — Kotlin: ✅ BlockView.kt:166 (horizontalScroll, softWrap=false)
- [ ] **Code-Zaun ```sprache Live-Trigger** — siehe Abschnitt 10 — Kotlin: ⬜

#### 12g Diagramme (Mermaid und SVG)
- [ ] **Mermaid-Codeblock wird als Diagramm angezeigt** (web/diagram.js:37-71, 26 Zeilen Logik) — Kotlin: ⬜ (Code wird als Text angezeigt)
- [ ] **SVG-Codeblock wird als Grafik angezeigt, mit DOMPurify bereinigt (kein Skript, kein foreignObject, kein style)** (web/diagram.js:19-35, 51) — Kotlin: ⬜
- [ ] **Klick auf Diagramm öffnet Code mit Live-Vorschau (350 ms)** (web/editor.js:1561-1562, 809-819, css 128-137) — Kotlin: ⬜
- [ ] **Fehlermeldung „Diagramm-Fehler: …“ / „Kein gültiges SVG …“ / „Leeres Diagramm“** (web/diagram.js:48-69) — Kotlin: ⬜
- [ ] **Mermaid nachladen, Hinweis bei fehlender Verbindung** (web/diagram.js:55-57, U.ensureMermaid) — Kotlin: ⬜
- [ ] **Slash „Diagramm“ und „SVG-Grafik“** (web/editor-menus.js:107-108) — Kotlin: ⬜

#### 12h Gleichungen (Formeln)
- [ ] **Block-Gleichung als KaTeX-Formel** (web/editor.js:488-495, 709-746 hydrateKatex) — Kotlin: 🟡 editor/ComplexBlocks.kt:70-72 (Monospace-Text, kein KaTeX)
- [ ] **Leere Gleichung: „Neue Gleichung — klicken zum Bearbeiten“** (web/editor.js:493) — Kotlin: ⬜
- [ ] **Klick öffnet Popover mit Textfeld (Platzhalter „E = mc^2“), Fußzeile „Esc = abbrechen“ und Knopf „Fertig ↵“** (web/editor-menus.js:297-318, css 145-149) — Kotlin: ⬜ (Stift öffnet Rohtext-Editor, editor/ComplexBlocks.kt:92; kein Popover)
- [ ] **Popover-Bestätigung per Enter, Abbruch per Esc, Shift+Enter Zeile** (web/editor.js:1845-1847, editor-menus.js:326-340) — Kotlin: ⬜
- [ ] **Inline-Formel als Chip** (siehe Abschnitt 9) — Kotlin: 🟡
- [ ] **Slash „Gleichung“** (web/editor-menus.js:106) — Kotlin: ⬜

#### 12i Bilder
- [ ] **Bildblock mit Bildunterschrift (alt-Text)** (web/editor.js:496-501, css 151-153) — Kotlin: 🟡 editor/ComplexBlocks.kt:110-131 (Bild, alt nur als Platzhalter beim Laden, keine Bildunterschrift)
- [ ] **Bilder aus lokaler Ablage (img:-ID)** (web/editor.js:716-727 über DB.blobUrl; Upload web/editor.js:924 `img:`) — Kotlin: 🟡 ComplexBlocks.kt:112 liest nur `file:`-IDs (PWA-Bilder vermutlich Platzhalter)
- [ ] **Platzhalter „Bild fehlt“ bei fehlendem Blob** (web/editor.js:725-726) — Kotlin: 🟡 (Platzhalter „Bild“ gleich, ComplexBlocks.kt:126-128)
- [ ] **Bild hochladen über Slash „Bild“ (Dateiauswahl image/*)** (web/editor.js:903-916, editor-menus.js:147-170) — Kotlin: ⬜
- [ ] **Bild per Drop oder Einfügen aus der Zwischenablage** (web/editor.js:1684-1694, 1698-1706) — Kotlin: ⬜
- [x] **Bildmaße: 100 % Breite, max. 100 %** (web/css/editor.css:151-152) — Kotlin: ✅ ComplexBlocks.kt:122-124

#### 12j Dateien, Medien, PDF
- [x] **Dateiblock als Zeile mit Büroklammer und Name** (web/editor.js:502-508, 752-760) — Kotlin: ✅ editor/ComplexBlocks.kt:75 (LinkCard)
- [ ] **Klick auf Dateiblock öffnet oder lädt** (web/editor.js:1573-1586, 759 „Herunterladen“) — Kotlin: 🟡 ComplexBlocks.kt:75 (Klick ohne Aktion)
- [ ] **Download-Knopf „Herunterladen“ bei unbekanntem Format** (web/editor.js:759, data-fdl) — Kotlin: ⬜
- [ ] **Video inline mit Steuerung, Höhe max. 480 px** (web/editor.js:753, css 154-155 in 210-216) — Kotlin: ⬜
- [ ] **Audio-Player** (web/editor.js:754-755) — Kotlin: ⬜
- [ ] **PDF inline mit PDF-Viewer und Titel** (web/editor.js:757-758, 789-796, PDFS.mountViewer) — Kotlin: ⬜ (PDF nur extern, library/LibraryScreen.kt:86-93)
- [x] **Bild als Medienblock bei Video/Audio/PDF-Verweisen aus Markdown** (core/impala-markdown/src/parse.rs:192-197) — Kotlin: ✅ (über Kern, Darstellung nicht vorhanden → siehe oben)
- [ ] **Fehlerzustände „Datei fehlt: …“ / „Datei konnte nicht geladen werden“** (web/editor.js:777-786) — Kotlin: ⬜
- [ ] **Datei hochladen über Slash „PDF“ (accept application/pdf) und „Datei / Medien“ (accept leer)** (web/editor-menus.js:147-170) — Kotlin: ⬜
- [ ] **PDF-Text beim Upload extrahieren und als pdftext: ablegen** (web/editor.js:926-933) — Kotlin: ⬜
- [ ] **Datei-MIME aus Dateiname** (web/editor-markdown.js:14) — Kotlin: ⬜

#### 12k Heft-Einbettung
- [ ] **Heft-Vorschau als große klickbare Karte mit Vorschaubild** (web/editor.js:509-512, HEFT.hydrateEmbeds, css 212-215) — Kotlin: 🟡 editor/ComplexBlocks.kt:74 (Karte „Heft“ ohne Vorschau, öffnet die Seite)
- [ ] **Heft-Einbettung über Slash „Heft“ (legt Heft-Seite an)** (web/editor-menus.js:172-185) — Kotlin: ⬜

### 13. Leere Zustände und Platzhalter

- [x] **Platzhalter Überschrift „Überschrift 1–3“** (web/editor.js:454-455, css 92-93) — Kotlin: ✅ editor/BlockView.kt:71-75
- [x] **Platzhalter Liste „Liste“ und To-do „To-do“** (web/editor.js:457-470) — Kotlin: ✅ BlockView.kt:73
- [x] **Platzhalter Zitat „Zitat“** (web/editor.js:472) — Kotlin: ✅ BlockView.kt:74
- [ ] **Platzhalter Absatz „Schreib etwas, oder drücke „/“ für Befehle …“** (web/editor.js:547) — Kotlin: 🟡 (kein Platzhalter für Absätze)
- [ ] **Platzhalter Toggle „Toggle“** (web/editor.js:536) — Kotlin: ⬜
- [ ] **Leere Gleichung „Neue Gleichung — klicken zum Bearbeiten“** (web/editor.js:493) — Kotlin: ⬜
- [ ] **Leeres Diagramm / Fehler-Hinweise** (web/diagram.js:48-69) — Kotlin: ⬜
- [x] **Klick unter dem letzten Block legt Absatz an oder fokussiert ihn** (web/editor.js:1600-1613) — Kotlin: ✅ editor/EditorScreen.kt tail, EditorViewModel.kt:194-205
- [x] **Titel-Platzhalter „Unbenannt“** (web/render.js:704, 1645) — Kotlin: ✅ editor/PageHeader.kt:110
- [ ] **Seite nicht gefunden** (PWA: Startseite statt Fehler, web/render.js:637-641) — Kotlin: 🟡 editor/EditorScreen.kt:77 („Seite nicht gefunden.“)
- [ ] **Keine Seite gefunden (Link-Menü)** (web/editor-menus.js:240) — Kotlin: ⬜
- [x] **Keine Versionen (Verlauf)** (web/render.js:1160) — Kotlin: ✅ notes/PageDialogs.kt:100
- [ ] **Archiv-Banner** (web/render.js:692) — Kotlin: ⬜
- [ ] **Datenbank: „0 Einträge“, „Neue Zeile“, „–“ für leere Werte** (web/db-view.js:85-88, 45-58) — Kotlin: ⬜
- [ ] **Verwandt leer = verborgen** (web/related-pages.js:22-27) — Kotlin: ⬜

### 14. Datenbankansicht (Vorlesungsübersicht)

Gesamtes Modul fehlt in Kotlin (kein db-Feld im Seitenmodell, `android/app/src/main/java/uniffi/impala_ffi/impala_ffi.kt:13571-13625`).

- [ ] **Umschalter „Als Vorlesungsübersicht“ / „Übersicht aufheben“** (web/render.js:571, web/app-click-pages.js:39-46) — Kotlin: ⬜
- [ ] **Standard-Schema LECTURE_SCHEMA: Thema, Nr, Datum, Schwierigkeit, Status, Klausurrelevanz, Themen, Folien** (web/db-view.js:66-71) — Kotlin: ⬜
- [ ] **Zähler „N Einträge“** (web/db-view.js:85) — Kotlin: ⬜
- [ ] **Liste der Unterseiten als Karten (db-item)** (web/db-view.js:72-88, css 296-299) — Kotlin: ⬜
- [ ] **Laufnummer #Nr vor dem Titel (erste Zahlenspalte)** (web/db-view.js:73-80, 81) — Kotlin: ⬜
- [ ] **Öffnen-Knopf mit Icon und Titel (title „Öffnen“)** (web/db-view.js:81, css 301-305) — Kotlin: ⬜
- [ ] **Eigenschaften-Raster mit Feldern (Beschriftung und Wert)** (web/db-view.js:45-57, css 306-320) — Kotlin: ⬜
- [ ] **Feldtyp Text, Rich-Text, URL, E-Mail (volle Breite)** (web/db-view.js:33) — Kotlin: ⬜
- [ ] **Feldtyp Mehrfachauswahl (ganze Zeile, graue Pills)** (web/db-view.js:29-31) — Kotlin: ⬜
- [ ] **Feldtyp Zahl (Dezimal-Tastatur)** (web/db-view.js:50) — Kotlin: ⬜
- [ ] **Feldtyp Datum (Datumsfeld nur bei ISO-Wert, Anzeige „de-DE“)** (web/db-view.js:34, 50) — Kotlin: ⬜
- [ ] **Feldtypen Auswahl und Status (Pills, Farbton aus Wert oder Hash, Vorschläge per datalist)** (web/db-view.js:14-31, 59-64) — Kotlin: ⬜
- [ ] **Schreibgeschützte Typen (Formel, Rollup, Erstellt, Bearbeitet, Personen, Relation, Dateien, Button, Eindeutige ID, Verifikation)** (web/db-view.js:9) — Kotlin: ⬜
- [ ] **Zellenänderung speichert als pageUpdate** (web/db-view.js:1-3 Kommentar, web/app.js change-Listener) — Kotlin: ⬜
- [ ] **+ Neue Zeile** (web/db-view.js:88, data-dbnewrow) — Kotlin: ⬜

### 15. PDF aus Zwischenablage und Teilen (pdfpaste.js)

- [ ] **PDF per Strg+V in die Seite einfügen → Zielwahl (Notiz oder Heft)** (web/pdfpaste.js:18-33) — Kotlin: ⬜
- [x] **Web-Teilen-Ziel für PDF (Share-Target, Cache-Payload)** (web/pdfpaste.js:37-58) — Kotlin: ✅ share/Incoming.kt (PDF/Bilder → neues Heft, Text → neue Seite)
- [ ] **PDF-Import über Bibliothek** (web/pdfpaste.js:12-16 ingest) — Kotlin: 🟡 library/LibraryImport.kt:13 (Import ohne Zielwahl)

### 16. Export und Medien (export-media.js, extras.js)

- [x] **Markdown-Export „# Titel“ + Inhalt** (web/extras.js:622-627) — Kotlin: ✅ notes/PageOps.kt:57 markdownText
- [x] **Dateiname aus Titel (Sonderzeichen ersetzt, max. 80)** (web/export-media.js:19-21) — Kotlin: ✅ notes/PageOps.kt:53-54 markdownFileName
- [ ] **Medienauflösung im Export (img:/file: → Datei oder data-URL)** (web/export-media.js:23-66) — Kotlin: ⬜
- [ ] **PDF/Druck mit Markdown-Rendering, KaTeX, eingebetteten Bildern** (web/extras.js:576-600, export-media.js:58-65) — Kotlin: 🟡 notes/PageOps.kt:81-89 (nur Absätze, ohne Formatierung, Formeln, Bilder)
- [ ] **Markdown-ZIP mit Medien (Bibliothek-Export)** (web/library.js:297-330) — Kotlin: ⬜ (nicht gefunden)

### 17. Globale Einstellung zur Seite

- [x] **Verwandte Seiten ein/aus (Darstellung)** (web/settings-renderer.js, Schlüssel relatedPages) — Kotlin: ✅ settings/SettingsAppearance.kt:76 (Schalter; die Leiste selbst fehlt)
- [x] **Schriftgröße S/M/L** (web/settings-renderer.js:106) — Kotlin: ✅ settings/SettingsAppearance.kt:48

---

### Zusammenfassung (grob)

- Seitenkopf: die meisten Elemente sind da, bei Icon-Klick, Cover-Anzeige, Cover-Upload und Archiv-Banner gibt es Lücken.
- Seitenaktionen: ⋯-Menü im Topbar ist weitgehend vorhanden, Rückgängig/Wiederholen sind Platzhalter. Das Teilen-Menü der PWA fehlt (direkt Android-Teilen). Duplizieren, Vorlage, Vorlesungsübersicht, Fach, Karten aus Markierungen fehlen im Topbar-Menü.
- Editor: Lesen von Text, Listen, Überschriften, Zitat, Trennlinie, Callout, Toggle, Spalten und Tabelle ist da. Blockgriff, Drag, Blockmenü, Blockauswahl, Inline-Leiste/Tastenkürzel, Slash-Menü (12 von 22 fehlen), Link-Menü, Diagramme, KaTeX, Datei-/Video-/PDF-Anzeige, Bild-Upload, Datenbankansicht und Verwandt-Leiste fehlen weitgehend.
- Kritische Befunde: Bildanzeige nur für `file:`-IDs (PWA nutzt `img:`), Toggle-Zustand nicht persistiert, externe Links ohne Schema-Prüfung, Export als PDF ohne Markdown und Medien.


---

# 3. Heft (Handschrift/Zeichnen)


**Gelesen:** heft.js (komplett), heft-toolbar-ui.js, heft-tools.js, heft-input.js, heft-viewport.js, heft-lasso.js, heft-pages-ui.js, heft-pages-core.js, heft-import.js, heft-export.js, heft-label.js, heft-scanner-ui.js, heft-index-progress.js, handschrift.js (Eckdaten), abschreiben.js, css/heft.css (Selektoren + Overrides), heft-indexer.js/heft-storage.js (nur Eckdaten), heft-scan.js/-pixels.js (Konstanten). Kotlin: alle Dateien unter heft/ inkl. scan/ und ink/, dazu ShellParts.kt, DeskPageActions.kt, AiChatViewModel.kt, SettingsAiSync.kt, SettingsApp.kt, ComplexBlocks.kt, SlashMenu.kt, ShellNav.kt, mobile-view.js, mobile.js, render.js (Heft-Zweig).

**Einschränkungen:** Kotlin wurde nicht gebaut oder im Emulator gestartet; der Status stammt aus dem Code. Die ML-Kit-Scanneroberfläche liegt außerhalb des Impala-Codes, daher nur der Funktionsumfang aus HeftScan.kt. heft-indexer.js und heft-storage.js wurden nicht vollständig gelesen.

Legende: ✅ vorhanden wie PWA · 🟡 teilweise oder abweichend · ⬜ fehlt. Kotlin-Dateien liegen in heft/, außer scan/ und ink/ (als Unterordner angegeben).

### 0. Hauptbefunde (zuerst beheben)

- ~~**Bilder und Textfelder werden nicht gezeichnet.**~~ ✅ behoben (HeftMedia.kt). HeftPageView.kt, PageSketch (HeftThumbnail.kt) und HeftPagesGrid.kt zeichnen nur Papier und Striche. HeftPageData enthält aber images und texts (uniffi/impala_ffi/impala_ffi.kt, HeftPageData). Scans aus HeftScan.kt sind deshalb auf dem Gerät unsichtbar, ebenso PDF-Seiten.
- ~~**Optionsleiste liegt falsch (Telefon).**~~ ✅ behoben: Kapsel oben mittig, Optionsleiste direkt darunter (HeftToolbar.kt). Unten (nicht Desk) steht die Optionsleiste über der Kapsel (HeftScreen.kt:215-220), auf schmalen Geräten links neben der vertikalen Kapsel (HeftScreen.kt:204-208). Die PWA hängt die Optionsleiste direkt unter die Kapsel, oben mittig (css/heft.css:487 top 58px; heft-toolbar-ui.js:133).
- ~~**Farbpunkte weichen ab.**~~ ✅ entspricht der aktuellen PWA (Ring in Menüfarbe, Farbfelder mit Textfarbe-Ring). Stift-Punkt in Kotlin mit Ring (HeftToolbar.kt PenDot, Durchmesser +5 dp). PWA: Punkt unten rechts in Stiftdicke ohne Ring (css/heft.css:477-484). Farbfelder 28 dp mit Textfarbe-Ring (HeftToolbar.kt:110-120); PWA 22/24/26 px mit Akzent-Ring (css/heft.css:502-508, 659, 276).
- ~~**Marker.**~~ ✅ behoben. PWA: Marker nutzt Farbe und Dicke des aktuellen Stifts (heft-input.js:237, heft.js:1486-1493). Kotlin: eigene Werte, Standardfarbe Gelb (HeftState.kt:47-48, HeftViewModel.kt:81-92).
- ~~**Werkzeugeinstellungen gehen verloren.**~~ ✅ behoben (DevicePrefs `heftTools`). PWA speichert Werkzeug, Stiftfavoriten, Radiergröße und Nur-Stift in localStorage (heft-tools.js:4, 17-39). Kotlin hält sie nur im ViewModel (HeftViewModel.kt:51).
- ~~**Zoombereich.**~~ ✅ jetzt 0,4–6. Vorher Kotlin 0,5–4 (HeftZoom.kt:32-33), PWA 0,4–6 (heft-viewport.js:23).
- **Kopfzeile.** Die Kotlin-Kopfzeile (HeftTopBar.kt) gibt es in der PWA-Desktopansicht nicht. Die PWA zeigt dort nur den Fokusmodus (render.js, Zweig `pg.kind === "heft"`, ca. Z. 667-677).
- **Fehlende Gesten:** ~~Doppeltipp-Zoom, Zwei- und Drei-Finger-Tipp für Undo/Redo~~ ✅; Lesemodus auf dem Handy ✅; offen: Mausrad mit Strg-Zoom.
- **Fehlende Werkzeuge:** ~~Formerkennung (Halten), Laser, Radierer-Halten~~ ✅; Bild- und Textwerkzeuge ✅.
- **Fehlende Export- und Importfunktionen**, Verlauf (Snapshots, TODO in HeftPagesSheet.kt:52-53). Schreib-Rückzug ✅.

### 1. Werkzeugkapsel (Haupt-Pille)

- [x] **Stift-Favorit 1, 2, 3** – Erster Tipp wählt, zweiter Tipp auf aktiven öffnet Optionen; Punkt zeigt Stiftdicke (web/heft-toolbar-ui.js:62-72; web/heft.js:1464-1470) — Kotlin: ✅ HeftToolbar.kt (Punkt unten rechts in Stiftdicke; Favoriten gespeichert)
- [x] **Marker** – nutzt Farbe und Dicke des aktuellen Stifts (web/heft-toolbar-ui.js:70-71; web/heft.js:1475-1478) — Kotlin: ✅ HeftState.kt (`color`/`size` gemeinsam)
- [x] **Radierer** – Tipp wählt, zweiter Tipp öffnet Größen (web/heft-toolbar-ui.js:168-169; web/heft.js:1472-1474) — Kotlin: ✅ HeftToolbar.kt:69-70
- [x] **Radierer halten** – 380 ms gedrückt halten wechselt temporär zum Radierer und zurück (web/heft.js:1565-1578) — Kotlin: ✅ HeftToolbar.kt `ToolButton(onHold)`, HeftViewModel.kt `holdEraser`
- [x] **Lasso** – Striche auswählen (web/heft-toolbar-ui.js:171-172; web/heft.js:1481) — Kotlin: ✅ HeftToolbar.kt:72
- [x] **Laser** – roter Zeigestift, nicht gespeichert, verblasst nach 900 ms, nur Nicht-Telefon (web/heft-toolbar-ui.js:173-174; web/heft-input.js:166-170, 414-417; css/heft.css:289) — Kotlin: ✅ HeftInput.kt (rot, 7 breit, nicht gespeichert, verschwindet nach 900 ms; nur Tablet)
- [ ] **Bilder-Menü** – Knopf öffnet Popover, Zustand „aktiv“ bei Bild-Popover oder Auswahl-Werkzeug (web/heft-toolbar-ui.js:176-177; web/heft.js:1419) — Kotlin: ⬜ (kein Knopf in HeftToolbar.kt)
- [x] **Rückgängig** – Knopf deaktiviert ohne Stapel (web/heft-toolbar-ui.js:179; web/heft.js:1496) — Kotlin: ✅ HeftToolbar.kt:74 (Stapel ohne Obergrenze, PWA: 100, web/heft.js:152; HeftViewModel.kt:277-282)
- [x] **Wiederholen** – analog (web/heft-toolbar-ui.js:180; web/heft.js:1497) — Kotlin: ✅ HeftToolbar.kt:75
- [x] **Einklappen (▾/Chevron)** – Leiste schrumpft auf eine Farbpunkt-Kapsel mit „Werkzeugleiste ausklappen“ (web/heft-toolbar-ui.js:115-125, 181-182; web/heft.js:1498-1499; css/heft.css:423-428) — Kotlin: ✅ HeftToolbar.kt `MiniCapsule` (Werkzeug-Icon, Farbpunkt, Chevron; Zustand gespeichert)
- [x] **Schreib-Rückzug** – Kapsel wird beim Schreiben auf 30 % Deckkraft gesetzt, nach 700 ms zurück (web/heft.js:126-145; css/heft.css:423) — Kotlin: ✅ HeftScreen.kt `HeftChrome` (alle Leisten auf 30 %, 700 ms Nachlauf)
- [x] **Position der Kapsel** – Oben mittig (Pille fest, css/heft.css:283) — Kotlin: ✅ HeftScreen.kt (oben mittig auf allen Geräten, Optionsleiste direkt darunter)
- [x] **Telefon-Sonderfall** – Undo/Redo stehen auf dem Telefon in der linken Eckgruppe, nicht in der Kapsel (web/heft-toolbar-ui.js:161-162, 178-180) — Kotlin: ✅ Telefon ohne Laser; Rückgängig/Wiederholen in der Kopfzeile (HeftTopBar.kt), Seiten und „+“ unten in den Ecken

### 2. Optionsleiste (Tray) je Werkzeug

- [x] **Stiftdicke F / M / B** – Punkte 1,6 / 3 / 5,5; Punktgröße dynamisch (web/heft-tools.js:7; web/heft-toolbar-ui.js:74-77, 135) — Kotlin: ✅ HeftToolbar.kt (Punkte in der aktuellen Farbe, aktiv mit Akzent-Tönung)
- [x] **Farben ×6** – #1c1c1e, #2f6fed, #e0483e, #1f9d55, #f5b800, #8b7cc8 (web/heft-tools.js:6; web/heft-toolbar-ui.js:137-138) — Kotlin: ✅ HeftToolbar.kt `Swatch` (aktiv mit Akzent-Ring)
- [x] **Farbe wählen wirkt auf Stift** – Stift übernimmt Farbe, Favorit wird gespeichert (web/heft.js:1486-1490) — Kotlin: ✅ HeftViewModel.kt:81-83
- [x] **Farbe bei Radierer/Lasso** – PWA schaltet dann auf Stift mit offenen Optionen um (web/heft.js:1488) — Kotlin: ✅ HeftViewModel.kt `setColor` (wechselt zum Stift mit offenen Optionen)
- [x] **Trenner** – senkrechte Striche zwischen Gruppen (web/heft-toolbar-ui.js:136, 139, 141) — Kotlin: ✅ HeftToolbar.kt:172-176
- [x] **Nur-Stift / Finger-Umschalter** – Stift-Symbol „Nur Stift zeichnet“ oder Hand-Symbol „Finger dürfen zeichnen“; Standard: nur Stift (web/heft-toolbar-ui.js:140-142; web/heft.js:1500; web/heft-tools.js:22) — Kotlin: ✅ HeftToolbar.kt:122-125 (Standard true, HeftState.kt:51; Umschalten HeftViewModel.kt:94)
- [x] **Radierer-Größen Klein 10 / Mittel 16 / Groß 30** – als Balken (web/heft-toolbar-ui.js:144-151; web/heft.js:1495) — Kotlin: ✅ HeftToolbar.kt:94-99 (Werte gleich; Balkenhöhe in dp statt px)
- [ ] **Tray-Griff ⠿ „Optionen verschieben“** – Leiste frei ziehen, andocken am linken/rechten Rand (48 px), vertikal (web/heft-toolbar-ui.js:50-59, 134, 147; web/heft.js:800-837; css/heft.css:293-305) — Kotlin: ⬜ (Position fest, HeftScreen.kt:204-220)
- [x] **Optionsleiste öffnen/schließen** – Werkzeug-Tipp mit zweitem Tipp (web/heft.js:1464-1478) — Kotlin: ✅ HeftViewModel.kt:71-77
- [x] **Keine Optionsleiste für Lasso, Laser, Bilder** – PWA zeigt keine (web/heft-toolbar-ui.js:96-98) — Kotlin: ✅ HeftScreen.kt:171, HeftViewModel.kt:74

### 3. Undo / Redo (Gesten und Tastatur)

- [ ] **Rückgängig** – Stapel bis 100 Schritte; Eintrag pro Strich, Radieren, Verschieben, Skalieren, Seite, Lasso (web/heft.js:151-158, 711-773) — Kotlin: 🟡 HeftViewModel.kt:259, 277-282 (ohne Obergrenze; Stapel pro Sitzung)
- [ ] **Wiederholen** – analog (web/heft.js:773) — Kotlin: 🟡 HeftViewModel.kt:261 (ohne Obergrenze)
- [x] **Zwei-Finger-Doppeltipp = Rückgängig** – zwei Tipps innerhalb 500 ms (web/heft-viewport.js:607-613; web/heft.js:679) — Kotlin: ✅ HeftZoom.kt `heftGestures`
- [x] **Drei-Finger-Tipp = Wiederholen** (web/heft-viewport.js:615) — Kotlin: ✅ HeftZoom.kt `heftGestures`

### 4. Eck-Knöpfe

- [ ] **Seitenleiste ein-/ausklappen (☰)** – nur sichtbar bei „Tabs in der Seitenleiste“ (web/heft-toolbar-ui.js:155; web/heft.js:1400-1408; css/heft.css:68) — Kotlin: ⬜ im Heft (HeftScreen.kt hat keinen Knopf; Shell-Navigation liegt woanders)
- [ ] **Zurück (‹)** – Navigation im Heft; nur bei Tabs in der Seitenleiste sichtbar (web/heft-toolbar-ui.js:156; web/heft.js:1409) — Kotlin: ⬜ im Heft (HeftScreen.kt; Telefon-Kopfzeile HeftTopBar.kt:58-62 hat „Zurück“)
- [ ] **Vor (›)** – analog (web/heft-toolbar-ui.js:157; web/heft.js:1410) — Kotlin: ⬜
- [x] **Seiten (links)** – öffnet Seitenübersicht; aktiv bei offenem Popover (web/heft-toolbar-ui.js:158-160; web/heft.js:1417) — Kotlin: ✅ HeftCorners.kt:50-54 (Desk); Telefon ✅ HeftTopBar.kt:87-86 (Übersicht-Symbol)
- [ ] **Seitenzähler „n/m“ neben dem Seiten-Knopf** – im Code gerendert, aber per CSS ausgeblendet (web/heft.js:1064-1067; css/heft.css:522) — Kotlin: 🟡 HeftTopBar.kt:55 (Telefon zeigt „Seite x von y“ im Kopf; PWA zeigt die Zahl nur unter jeder Seite)
- [x] **KI-Chat (rechts, Funken-Symbol)** – öffnet KI-Panel (web/heft-toolbar-ui.js:187; web/heft.js:1507-1512; css/heft.css:311) — Kotlin: ✅ HeftCorners.kt (Tablet), HeftTopBar.kt (Telefon)
- [x] **Seite hinzufügen (＋, rechts)** – öffnet Seiten-Menü (web/heft-toolbar-ui.js:188-189; web/heft.js:1418) — Kotlin: ✅ HeftCorners.kt:67-109 (Desk); Telefon ✅ HeftTopBar.kt:63-83

### 5. „Seite hinzufügen“-Menü (plusPop)

- [x] **Position Davor / Danach / Am Ende** – Segment-Auswahl; Standard „Danach“ (web/heft-toolbar-ui.js:194, 200; web/heft.js:1451-1455, 162, 1690; heft.js:1217-1220) — Kotlin: ✅ HeftCorners.kt `HeftAddMenu` (Segmentwahl, Standard „Danach“, gilt für die Sitzung)
- [x] **Vorlage Liniert / Kariert / Punkte / Blanko** – Tipp legt Seite mit Papier an (web/heft-toolbar-ui.js:196-201; web/heft.js:1456; web/heft-tools.js:8) — Kotlin: ✅ HeftCorners.kt:115-171 (Mini-Vorschau), HeftTopBar.kt:73-75 (Menü)
- [x] **Papier dieser Seite** – Chips zum Umstellen (web/heft-toolbar-ui.js:202-204; web/heft.js:1501-1506) — Kotlin: ✅ HeftCorners.kt:89-97, HeftTopBar.kt:95-98
- [x] **Bild als Seite** – Bilddatei als eigene Seite mit 40 Rand, Papier der aktuellen Seite, am Ende (web/heft-toolbar-ui.js:206; web/heft.js:1458; web/heft-import.js:79-99, 137-156) — Kotlin: ✅ HeftCorners.kt `HeftAddMenu`, scan/HeftScan.kt `insertImagePage`
- [x] **PDF oder Bild importieren** – öffnet Import-Dialog (web/heft-toolbar-ui.js:207; web/heft.js:1459) — Kotlin: ✅ HeftTransfer.kt `HeftImportDialog` (Ort: beliebiges Heft oder „Als neue Notiz-Seite(n)“, Position)
- [x] **Dokument scannen** – öffnet Scanner (web/heft-toolbar-ui.js:208; web/heft.js:1460) — Kotlin: ✅ HeftCorners.kt:99-102, HeftTopBar.kt:77-81 (ML Kit, siehe Abschnitt 15)

### 6. Bilder-Popover („Bilder“)

- [x] **Bilder & Texte auswählen & bearbeiten** – Auswahl-Werkzeug mit Verschieben, Skalieren, Löschen (web/heft-toolbar-ui.js:213; web/heft.js:1481-1482) — Kotlin: ✅ HeftCorners.kt `HeftImageMenu`, HeftObjects.kt `ObjGesture`
- [x] **Text schreiben** – Textfeld am Seitenende, Doppeltipp zum Bearbeiten (web/heft-toolbar-ui.js:215; web/heft.js:1461; web/heft.js:984-1052) — Kotlin: ✅ HeftViewModel.kt `startText`, HeftObjects.kt `HeftTextEditor`
- [x] **Bild hinzufügen** – Galerie, Bild mit max. 70 % der Seite (web/heft-toolbar-ui.js:216; web/heft.js:1462; web/heft-import.js:101-135) — Kotlin: ✅ HeftImagePick.kt (Photo Picker, längste Kante 1400), HeftViewModel.kt `addImage`
- [x] **Bild aufnehmen** – Kamera (web/heft-toolbar-ui.js:217; web/heft.js:1463) — Kotlin: ✅ HeftImagePick.kt (`TakePicture`, fragt Kamera-Berechtigung; im Emulator nicht geprüft)
- [x] **Hinweistext zu Auswahl und Textfeld** (web/heft-toolbar-ui.js:218) — Kotlin: ✅ HeftCorners.kt `HeftImageMenu`

### 7. Seitenübersicht (Popover „Seiten“)

- [x] **Kopf „Seiten“ mit Untertitel** – „n Seiten“ bzw. „n ausgewählt“ (web/heft-pages-ui.js:12-16, 22) — Kotlin: ✅ HeftPagesSheet.kt:85-90
- [x] **✕ Schließen** (web/heft-pages-ui.js:16; web/heft.js:1423) — Kotlin: ✅ HeftPagesSheet.kt:92-97
- [x] **Umschalter Raster / Verlauf** (web/heft-pages-ui.js:17-19; web/heft.js:1426-1427) — Kotlin: ✅ HeftPagesSheet.kt
- [x] **Rasterminiaturen mit Seitennummer** (web/heft-pages-ui.js:25-37) — Kotlin: ✅ HeftPagesGrid.kt:170-268
- [x] **Aktive Seite mit Akzent-Rahmen** (web/heft-pages-ui.js:31; css/heft.css:124) — Kotlin: ✅ HeftPagesGrid.kt:130, 215-232
- [x] **Tipp auf Seite springt dorthin** (web/heft.js:1444-1450) — Kotlin: ✅ HeftPagesSheet.kt:106 (Sprung über Fokus-Mechanik HeftScreen.kt:84-87)
- [x] **Griff ⠿ ziehen zum Verschieben** – Zielmarkierung gestrichelt (web/heft-pages-ui.js:35; web/heft.js:972-981; css/heft.css:126, 129) — Kotlin: ✅ HeftPagesGrid.kt:139-160, 204-214
- [x] **Am Rand automatisch scrollen beim Ziehen** (web/heft.js:966) — Kotlin: ✅ HeftPagesGrid.kt:102-112
- [x] **„+ Neue Seite“-Kachel am Ende** – Papier der letzten Seite (web/heft-pages-ui.js:44; web/heft.js:1457, 1626-1633) — Kotlin: ✅ HeftPagesGrid.kt:271-286 (Papier via HeftViewModel.kt:163-165)
- [x] **Auswählen** – startet Auswahlmodus (web/heft-pages-ui.js:45; web/heft.js:1420) — Kotlin: ✅ HeftPagesSheet.kt:133
- [x] **Alle / Keine** – Umschalter im Auswahlmodus (web/heft-pages-ui.js:23, 38; web/heft.js:1421) — Kotlin: ✅ HeftPagesSheet.kt:80-83
- [ ] **Mehrere Seiten durch Wischen auswählen** – Ziehen über Miniaturen schaltet ab dem Startpunkt um (web/heft.js:953-969) — Kotlin: ⬜ (nur Tippen, HeftPagesSheet.kt:106)
- [x] **Fertig** – beendet Auswahlmodus (web/heft-pages-ui.js:40; web/heft.js:1422) — Kotlin: ✅ HeftPagesSheet.kt:120
- [x] **Löschen (n)** – mit Bestätigung, Sicherung im Verlauf vorher, Hinweis „über Verlauf wiederherstellbar“ (web/heft-pages-ui.js:41; web/heft.js:1251-1267, 1424) — Kotlin: ✅ HeftPagesSheet.kt, HeftViewModel.kt `removePages` (sichert vorher)
- [x] **Exportieren (n)** – öffnet Export-Dialog für die Auswahl (web/heft-pages-ui.js:42; web/heft.js:1425, 1379-1395) — Kotlin: ✅ HeftTransfer.kt `HeftExportDialog` (PDF oder PNG, 300 dpi, Teilen-Menü)
- [x] **Importieren (Fußleiste)** (web/heft-pages-ui.js:46) — Kotlin: ✅ HeftPagesSheet.kt
- [x] **Verlauf (Stände)** – Liste der letzten 24 h mit Miniaturen, Hinweis „höchstens alle 10 Min.“ und max. 20 Stände (web/heft-pages-ui.js:50-60; web/heft.js:409-422; web/heft-storage.js:138) — Kotlin: ✅ HeftHistory.kt, HeftHistoryGrid.kt (Kern `heft_snapshot`; Miniaturen ohne Bilder)
- [x] **Stand wiederherstellen** – Tipp auf Miniatur, Bestätigung, aktueller Stand wird vorher gesichert (web/heft.js:1428-1441, 391-408) — Kotlin: ✅ HeftViewModel.kt `restore` (Kern `heft_restore`, zusätzlich rückgängig machbar)
- [x] **Hinweistext „Letzte 24 h · antippen zum Wiederherstellen“** (web/heft-pages-ui.js:59) — Kotlin: ✅
- [ ] **Seite einzeln löschen über Seitenübersicht** – im PWA-Code vorhanden (hedelpage, web/heft.js:1442), aber kein Element rendert es (toter Code) — Kotlin: 🟡 (Löschen über Kopfzeile und Eck-Menü, HeftTopBar.kt:100-106, HeftCorners.kt:103-106)
- [x] **Seitenübersicht als Popover** – Desk: mittig mit Abdunkelung (web/heft.js:870-877, css/heft.css:101-112) — Kotlin: ✅ HeftPagesSheet.kt:138-144 (560 dp); Telefon: Bottom Sheet ✅ (HeftPagesSheet.kt:145-154)

### 8. Lasso

- [x] **Freihand-Lasso** – Auswahlpfad gestrichelt blau, Auswahl mit Schwerpunkt oder ≥ 25 % der Punkte im Umriss (web/heft-lasso.js:91-94, 141-154; web/heft-input.js:129-165) — Kotlin: ✅ HeftLasso.kt:64-149
- [x] **Auswahlrahmen mit 4 Eckgriffen** (web/heft-lasso.js:114-136) — Kotlin: ✅ HeftLasso.kt:152-167
- [x] **Im Rahmen ziehen = verschieben** (web/heft-input.js:154-157, 279-291) — Kotlin: ✅ HeftLasso.kt:91-96, 106-118
- [x] **Eckgriff ziehen = proportional skalieren** (Faktor 0,15–6, Grenzen am Seitenrand; web/heft-input.js:133-153, 292-326) — Kotlin: ✅ HeftLasso.kt:81-90, 110-115 (Grenzen im Kern; Faktorbereich nicht geprüft)
- [x] **Tipp außerhalb beendet Lasso, Stift mit offenen Optionen** (web/heft-input.js:116-122) — Kotlin: ✅ HeftViewModel.kt:186-189
- [x] **Finger auf Auswahl greift, Finger daneben beendet** (web/heft-lasso.js:97; web/heft-input.js:115) — Kotlin: ✅ HeftInput.kt:77-84
- [x] **Aktionsleiste „In Text“** – Handschrifterkennung, Text in Zwischenablage, Meldung (web/heft-lasso.js:173, 209-240; web/heft.js:1411) — Kotlin: ✅ HeftLassoBar.kt:41-54 (ML Kit statt ONNX, Modell wird nachgeladen; HandwritingRecognizer.kt)
- [x] **Aktionsleiste „Duplizieren“** – Kopie 28 Einheiten versetzt, Auswahl wandert auf Kopie (web/heft-lasso.js:174, 183-193; web/heft.js:1413) — Kotlin: ✅ HeftLassoBar.kt:55, HeftViewModel.kt:227-231
- [x] **Aktionsleiste „Löschen“** (web/heft-lasso.js:175, 198-207; web/heft.js:1414) — Kotlin: ✅ HeftLassoBar.kt:56, HeftViewModel.kt:233-237
- [ ] **Aktionsleiste „KI-Trainingsbeispiel“** – Eingabefeld für Text, Speichern als Trainingsbeispiel (web/heft-lasso.js:176, 245-259; web/heft.js:1412) — Kotlin: ⬜ bewusst entfallen (HeftLassoBar.kt:33)
- [x] **Aktionsleiste ✕ „Auswahl aufheben“** (web/heft-lasso.js:177; web/heft.js:1415) — Kotlin: ✅ HeftLassoBar.kt:57-64
- [x] **Position der Aktionsleiste über der Kapsel** (css/heft.css:437; bottom 74 px) — Kotlin: ✅ HeftScreen.kt:221-225 (96 dp unten, sonst 74 dp)
- [x] **Auswahl wird beim Werkzeugwechsel aufgehoben** (web/heft.js:1096; web/heft.js:1484) — Kotlin: ✅ HeftViewModel.kt:71-77
- [ ] **Entf/Rücktaste löscht Auswahl** (web/heft.js:1531-1535) — Kotlin: ⬜ (keine Tastatursteuerung im Heft-Ordner)

### 9. Eingabe-Werkzeuge auf der Seite

- [x] **Stift schreiben** – Strichbreite mit Druck, Glättung (web/heft-input.js:81-240; web/heft.js:488-509) — Kotlin: ✅ HeftInput.kt:32-158, HeftInk.kt:28-37 (Druckbreite Faktor 1,1 statt PWA-Formel 0,4–1,6, nicht identisch)
- [x] **Marker** – halbtransparent (Deckkraft 32 %), dreifache Breite (web/heft.js:502-506) — Kotlin: ✅ HeftInk.kt:18-19, 31-32
- [x] **Radierer löscht ganze Striche** – Ring in Radiergröße (web/heft-input.js:61-80; css/heft.css:456) — Kotlin: ✅ HeftErase.kt:15-43, HeftPageView.kt:100
- [x] **Stift-Radierer am Stift-Ende** – Kotlin erkennt TOOL_TYPE_ERASER (HeftInput.kt:76, 92) — Kotlin: ✅ (Zusatz gegenüber PWA)
- [x] **Formerkennung** – Halten für 550 ms nach dem Strich wandelt in Linie, Ellipse, Dreieck, Pfeil oder Rechteck um (web/heft-input.js:243-263; web/heft.js:494-501; web/heft-geometry.js:24) — Kotlin: ✅ HeftInput.kt `trySnap` (Halten 550 ms → `heftFitShape` im Kern; Linie folgt dem Stift weiter; Vorschau HeftPaint.kt)
- [x] **Laser** – siehe Abschnitt 1 (web/heft-input.js:166-170) — Kotlin: ✅ HeftInput.kt
- [x] **Bild oder Text greifen, verschieben, Ecke skalieren, Löschen über Eckknopf** – Rahmen blau gestrichelt, roter Knopf zum Löschen (web/heft-input.js:171-215, 336-352; web/heft.js:581-598) — Kotlin: ✅ HeftObjects.kt `ObjGesture`, `drawObjSelection`
- [x] **Textfeld** – wird auf der Seite gezeichnet, Wortumbruch, Schriftgröße 30 (web/heft.js:525-551, 542-551, 1045) — Kotlin: ✅ HeftMedia.kt `drawHeftTexts`
- [x] **Textfeld bearbeiten (Doppeltipp oder Doppeltipp auf leere Stelle)** – Enter speichert, Umschalt+Enter Zeilenumbruch, Esc verwirft (web/heft.js:984-1052; web/heft-input.js:223-229) — Kotlin: ✅ HeftObjects.kt `HeftTextEditor` (Seite schrumpft bei offener Tastatur nicht)

### 10. Gesten und Eingabe (Touch, Stift, Maus)

- [x] **Finger zeichnen** – wenn „Finger dürfen zeichnen“ aktiv (web/heft-input.js:33-35, 67, 123) — Kotlin: ✅ HeftInput.kt:64-67
- [x] **Finger scrollt und zoomt bei „Nur Stift“** – Blättern vertikal (web/heft-viewport.js:504-506, 535-574) — Kotlin: ✅ HeftScreen.kt:178-201 (LazyColumn), HeftInput.kt:64-67
- [x] **Zwei-Finger-Pinch zoomt und verschiebt in einem Schritt** (web/heft-viewport.js:539-564) — Kotlin: ✅ HeftZoom.kt `heftGestures` (0,4–6)
- [x] **Zoom-Bereich 0,4–6** (web/heft-viewport.js:23) — Kotlin: ✅ HeftZoom.kt
- [x] **Doppeltipp mit einem Finger zoomt auf ca. 2,2× bzw. zurück auf Fit** (web/heft-viewport.js:616-623; animateZoom 477-482) — Kotlin: ✅ HeftScreen.kt `zoomTo` (animiert; nur wenn der Finger nicht zeichnet)
- [x] **Ausschwingen nach dem Loslassen (Schwung)** (web/heft-viewport.js:576-590) — Kotlin: ✅ (nativer Scroll von LazyColumn)
- [ ] **Mausrad blättert, Strg+Mausrad zoomt** (web/heft-viewport.js:636-642) — Kotlin: ⬜
- [x] **Stift-Vorrang: Finger wird 400 ms nach Stiftende ignoriert (Handballen)** (web/heft-input.js:20, 33-35; web/heft-viewport.js:522, 540, 602) — Kotlin: ✅ HeftInput.kt:23, 47-48
- [ ] **Handballen-Rücknahme: Verschieben der letzten 350 ms wird zurückgesetzt** (web/heft-viewport.js:496-499, 530-533; web/heft.js:87) — Kotlin: ⬜
- [ ] **Zweiter Finger während Strich bricht Strich ab** (Pinch, web/heft-input.js:95-104) — Kotlin: ⬜ nicht sicher geprüft (Pinch-Zoom wird über heftPinch behandelt, Strich-Abbruch nicht gefunden)
- [x] **Maus zeichnet** (web/heft-input.js:81) — Kotlin: ✅ HeftInput.kt:64-67 (MOUSE akzeptiert)
- [x] **Lesemodus auf dem Handy** – Blättern und Zoomen ohne Striche, bis Stift-Taste oder leeres Heft (web/heft.js:110-113, 1837; web/mobile.js:59-68) — Kotlin: ✅ HeftViewModel.kt `openForReading`/`setReading`, HeftInput.kt `reading`
- [ ] **Stift-Taste (Bearbeiten/Fertig) in der Handy-Kopfzeile** (web/mobile-view.js:26; web/mobile.js:286-290, 376-383) — Kotlin: ⬜
- [x] **„Seite wird beim Zoomen zentriert“** (web/heft-viewport.js:78-88) — Kotlin: ✅ (fixer Mittelpunkt im Pinch, HeftScreen.kt:147-169)
- [ ] **Hochziehen am Ende fügt neue Seite hinzu** – Geist-Knopf „＋ Neue Seite“ erscheint, Loslassen ab 70 px (web/heft.js:1626-1656; css/heft.css:452-454) — Kotlin: 🟡 HeftScreen.kt `AddPageGhost` (Knopf „Neue Seite“ steht immer am Ende; Hochziehen fehlt)

### 11. Darstellung (Papier, Linien, Farben, Format, Ausrichtung, Scroll, Zoom, Breite)

- [x] **Papier „Liniert“** – Linien alle 28 Einheiten ab Y 96, Randlinie bei x 90, Breite bis x 950, Papier #fbfaf7 (web/heft-tools.js:8; web/heft.js:463-487) — Kotlin: ✅ HeftPaint.kt:23-58 (Papierfarbe PaperColor HeftPaint.kt:14)
- [x] **Papier „Kariert“** – Linien und Spalten im 28er-Raster (web/heft.js:480-482) — Kotlin: ✅ HeftPaint.kt:49-51
- [x] **Papier „Punkte“** – Punkte alle 28 Einheiten ab 40, Deckkraft 35 % (web/heft.js:473-476) — Kotlin: ✅ HeftPaint.kt:30-39
- [x] **Papier „Blanko“** – nur Papierfarbe (web/heft.js:466) — Kotlin: ✅ HeftPaint.kt:25
- [x] **Linienfarbe = Akzentfarbe der App** (web/heft.js:468-469; web/settings.js:44-48) — Kotlin: ✅ HeftPaint.kt (Parameter ink = Impala.colors.accent in HeftPageView.kt:49)
- [x] **Papier je Seite wählbar** (Abschnitt 5 und 3) — Kotlin: ✅
- [x] **Seitenformat 1000 × 1414 (A4-Verhältnis), fest** (web/heft-document-core.js:8) — Kotlin: ✅ HeftState.kt:7-11
- [x] **Ausrichtung** – nur Hochformat, keine Auswahl (web/heft-viewport.js:28-30, 455-460) — Kotlin: ✅ (ebenfalls nur Hochformat, HeftState.kt:7-11)
- [x] **Scroll-Layout: Seiten untereinander, Lücke 24 px mit „Seite N“** (web/heft.js:793-797; css/heft.css:99) — Kotlin: ✅ HeftScreen.kt:58-61, 178-201
- [ ] **Abstand oben und unten (PAD_X 18, Oben 36/46, Unten 56)** (web/heft-viewport.js:25-26, 456-457) — Kotlin: 🟡 HeftScreen.kt:57-58, 124-134 (oben 48 dp am Desk, 12 dp sonst; PAD_X 16 dp)
- [x] **Passbreite / Seitengröße angepasst an Höhe** (fitScale = min(verfügbare Breite, verfügbare Höhe, 1)) (web/heft-viewport.js:449-476) — Kotlin: ✅ HeftScreen.kt:131-136 (Breite aus Höhe, Obergrenze nicht geprüft)
- [x] **Zoom-Anzeige oder Zoomknöpfe** – PWA hat keine (nur Gesten) — Kotlin: ✅ (ebenfalls keine)
- [x] **Kein Seitenwechsel-Zoom-Schalter / Vollbild** – PWA hat keinen Vollbild-Schalter im Heft — Kotlin: ✅ (ebenfalls nicht vorhanden)
- [x] **Darstellungs-Einstellungen (App)** – Design, Akzent, Dichte, Bewegung gelten app-weit (web/settings-schema.js:7, 31; web/settings.js:44-48) — Kotlin: ✅ MainActivity.kt → ImpalaTheme.kt (Design, Akzent, Dichte, Schrift, Performance-Modus als Snap-MotionScheme, Haptik)
- [ ] **Experiment „Beta-Design“** – ohne Wirkung (web/settings-schema.js:62) — Kotlin: ⬜ (nicht vorhanden; ohne Wirkung in PWA)
- [ ] **Zuletzt angesehene Seite merken** – Öffnen springt dorthin, Startseite zeigt sie (web/heft.js:83-93, 1690) — Kotlin: 🟡 HeftThumbnail.kt:6-11, HeftScreen.kt:77 (nur Sitzung, nicht gespeichert)

### 12. Seitenaktionen und Verlauf

- [x] **Seite löschen mit Bestätigung** (nur wenn Inhalt; web/heft.js:1241-1250) — Kotlin: ✅ HeftTopBar.kt:100-110, HeftCorners.kt:103-111 (Bestätigung immer, nicht nur bei Inhalt)
- [x] **Letzte Seite lässt sich nicht löschen** (web/heft.js:1242; web/heft-pages-core.js:77) — Kotlin: ✅ HeftTopBar.kt:103, HeftPagesSheet.kt:71 (Sperre in der UI)
- [x] **Seite verschieben** (web/heft-pages-core.js:66-73; web/heft.js:942-949) — Kotlin: ✅ HeftPagesGrid.kt, HeftViewModel.kt:170-173
- [ ] **Automatische Sicherung (Verlauf)** – höchstens alle 10 Min., 24 h, 20 Stände (web/heft-storage.js:138; web/heft.js:1258) — Kotlin: ⬜
- [ ] **Stand aus Verlauf wiederherstellen** (Abschnitt 7) — Kotlin: ⬜
- [x] **Seite einfügen nach der aktuellen Seite (Standard)** (web/heft.js:1217-1220) — Kotlin: ✅ HeftCorners.kt:76-98 (Standard)

### 13. Import

- [x] **Import-Dialog „In Impala67 importieren“** – Liste der Dateien mit Typ und Größe (web/heft-import.js:254-287) — Kotlin: ✅ HeftTransfer.kt `HeftImportDialog`
- [x] **Ziel: Notiz oder Heft** (Notiz nur für reine PDFs) (web/heft-import.js:270-281) — Kotlin: ✅ HeftTransfer.kt (Auswahl „Ort“; Notiz über library/LibraryImport.kt `importPdfPage`)
- [x] **Einfügen: Nach / Vor der aktuellen Seite, Am Anfang, Am Ende** (web/heft-import.js:281; web/heft-pages-core.js:75) — Kotlin: ✅ HeftTransfer.kt `ImportPos` (anderes Heft: ab der letzten Seite)
- [x] **Importieren-Knopf mit Fortschritt** (web/heft-import.js:302-332) — Kotlin: ✅ HeftTransfer.kt
- [x] **Abbrechen und ✕** (web/heft-import.js:297-300) — Kotlin: ✅ HeftTransfer.kt (Abbrechen; ✕ entfällt im Dialog)
- [x] **Dateiauswahl (Bild oder PDF, mehrere)** (web/heft-import.js:13-21, 337-346) — Kotlin: ✅ HeftTransfer.kt `rememberHeftFilePick`
- [ ] **PDF-Seiten als Heftseiten, Text übernommen** (web/heft-import.js:158-207) — Kotlin: 🟡 heft/scan/HeftScanImage.kt `importPages` (Seiten als Bild, der PDF-Text wird nicht übernommen)
- [x] **Bilddateien als Heftseiten** (web/heft-import.js:239-242) — Kotlin: ✅ heft/scan/HeftScanImage.kt `importPages`
- [x] **Meldung „Import abgeschlossen“** (web/heft-import.js:326) — Kotlin: ✅ HeftTransfer.kt (Snackbar)

### 14. Export

- [ ] **Export-Auswahl aus der Seitenübersicht** (web/heft-pages-ui.js:42; web/heft.js:1425) — Kotlin: ⬜
- [ ] **Dialog „Heft exportieren“ mit Zusammenfassung (Seiten, Titel)** (web/heft-export.js:109-125) — Kotlin: ⬜
- [ ] **Dateiname (Sonderzeichen ersetzt, max. 80 Zeichen)** (web/heft-export.js:10, 122, 129) — Kotlin: ⬜
- [ ] **Format PDF (alle Seiten in einer Datei, A4, 300 dpi-Breite 2480)** (web/heft-export.js:8, 23-29, 35-50) — Kotlin: ⬜ (DeskPageActions.kt:97 „PDF-Export für Hefte“ später)
- [ ] **Format Einzelbilder (PNG je Seite, „name-seite-N.png“)** (web/heft-export.js:52-67) — Kotlin: ⬜
- [ ] **Export-Knopf mit Statusanzeige** (web/heft-export.js:127-151) — Kotlin: ⬜
- [ ] **Teilen-Blatt oder Download** (web/heft-export.js:95-107) — Kotlin: ⬜
- [ ] **Abschlussmeldung „Export gespeichert“ bzw. „geteilt“** (web/heft-export.js:141-142) — Kotlin: ⬜
- [ ] **Export „Alle Handschrift“ (JSON aller Striche)** (web/heft-export.js:80-93; web/settings-renderer.js:280) — Kotlin: ⬜ (SettingsApp.kt:48, SettingsAiSync.kt:40 nur Platzhalter)
- [ ] **Teilen-Menü im Heft-Kopf** – die PWA zeigt im Heft kein Teilen-Menü (Abschnitt 19) — Kotlin: ⬜ (DeskPageActions.kt:97 als Hinweis „später“)

### 15. Scanner (Dokument scannen)

- [x] **Start über Google-Scanner (Android)**, Seitenlimit 25 (web/heft-scanner-ui.js:54-79) — Kotlin: ✅ HeftScan.kt:12-25, 33-61 (ML Kit GMS, Galerie erlaubt, JPEG, Vollmodus)
- [ ] **Interner Kamera-Scanner als Fallback** (web/heft-scanner-ui.js:81-140) — Kotlin: ⬜ (nur ML Kit)
- [ ] **Titelzeile „Dateien scannen“ und ✕** (web/heft-scanner-ui.js:86) — Kotlin: 🟡 (ML Kit-Oberfläche)
- [ ] **Kameravorschau mit Erkennungsrahmen** (grün = bereit) (web/heft-scanner-ui.js:87-88; css/heft.css:213-216) — Kotlin: ⬜ (ML Kit-Oberfläche)
- [ ] **Qualitätshinweise** (Blatt vollständig, Mehr Licht nötig, Spiegelung, Kontrast zu gering, Kamera ruhiger halten, Blattrand sichtbar halten, stabil erkannt) (web/heft-scanner-ui.js:246-276) — Kotlin: ⬜
- [ ] **Blitz-Anzeige und Vibration beim Auslösen** (web/heft-scanner-ui.js:90, 324-328) — Kotlin: ⬜
- [ ] **Filter Farbe / S/W / Graustufen / Foto** (web/heft-scanner-ui.js:93; web/heft-scan.js:19) — Kotlin: 🟡 (ML Kit bietet eigene Filter, nicht nachgebaut)
- [ ] **Auto-Scan (an/aus, Auslösen nach 5 stabilen Frames, Pause 1,8 s)** (web/heft-scanner-ui.js:96, 229-311, 382-389) — Kotlin: ⬜
- [ ] **Taschenlampe „Licht“** (nur wenn Gerät hat) (web/heft-scanner-ui.js:97, 177-189) — Kotlin: ⬜
- [ ] **Auslöser (Foto volle Auflösung)** (web/heft-scanner-ui.js:99, 391-431) — Kotlin: 🟡 (ML Kit-Auslöser)
- [ ] **Fotos auswählen, wenn keine Kamera** (web/heft-scanner-ui.js:135-136, 555-571) — Kotlin: 🟡 (ML Kit: Galerieimport erlaubt, HeftScan.kt:20)
- [ ] **Seitenleiste mit Miniaturen, Nummer, Qualitätsnotiz** (web/heft-scanner-ui.js:523-554) — Kotlin: ⬜ (ML Kit-Oberfläche)
- [ ] **Scan einzeln löschen (×)** (web/heft-scanner-ui.js:535, 505-513) — Kotlin: 🟡 (ML Kit-Oberfläche)
- [ ] **Nachbearbeitung „Scan N bearbeiten“** (web/heft-scanner-ui.js:639-676) — Kotlin: ⬜ (ML Kit-Oberfläche)
- [ ] **Vorher / Nachher** (web/heft-scanner-ui.js:653, 617-629) — Kotlin: ⬜
- [ ] **Ecken anpassen (Viereck ziehen)** (web/heft-scanner-ui.js:654, 735-780) — Kotlin: 🟡 (ML Kit-Zuschnitt)
- [ ] **Drehen (90°-Schritte)** (web/heft-scanner-ui.js:655, 367-375) — Kotlin: 🟡 (ML Kit-Oberfläche)
- [ ] **Filter in der Nachbearbeitung** (web/heft-scanner-ui.js:650-651) — Kotlin: 🟡 (ML Kit)
- [ ] **Scan in der Nachbearbeitung löschen** (web/heft-scanner-ui.js:656, 376-379) — Kotlin: 🟡 (ML Kit)
- [ ] **Fertig** (web/heft-scanner-ui.js:657, 781-790) — Kotlin: 🟡 (ML Kit)
- [ ] **Als PDF speichern (scan-DATUM.pdf)** (web/heft-scanner-ui.js:101, 818-831) — Kotlin: ⬜
- [x] **In Heft einfügen (Blanko-Seiten, seitenfüllend, ab aktueller Position)** (web/heft-scanner-ui.js:102, 832-839; web/heft.js:1341-1348) — Kotlin: ✅ HeftScan.kt:66-75 (insertScannedPages), HeftScreen.kt:98-99
- [x] **Bildgröße 1800 px, JPEG 78 %** (web/heft-scan-pixels.js:12-13) — Kotlin: ✅ scan/HeftScanImage.kt:4-5
- [ ] **Escape schließt Nachbearbeitung, dann Scanner** (web/heft.js:1526-1528; web/heft-scanner-ui.js:842-846) — Kotlin: ⬜
- [x] **Scanner schließt beim Verlassen des Hefts** (web/heft.js:1728) — Kotlin: ✅ (ML Kit-Dialog endet mit Activity)
- [ ] **Erkennung der Blattkanten (Auto-Zuschnitt, Schwelle 96 %)** (web/heft-scanner-ui.js:476-485) — Kotlin: 🟡 (ML Kit)

### 16. Handschrift: Erkennung, Indexierung, Training, Einstellungen

- [ ] **Automatische Handschrift-Indexierung nach Strichen (Suche)** – PWA: Hintergrund-Warteschlange (web/heft-indexer.js:250-350), nicht nur 3,5 s; Kotlin: pro Seite 3,5 s verzögert (ink/HeftIndexer.kt:21-37, 47-55) — Kotlin: 🟡 ink/HeftIndexer.kt (anderer Ablauf; Kommentar „wie in der PWA“ stimmt so nicht)
- [ ] **Seiten mit Scan-Text werden übersprungen** (ink/HeftIndexer.kt:11-16, 42) — Kotlin: 🟡 (PWA-Verhalten nicht geprüft)
- [x] **Erkennung als Text (Lasso „In Text“)** (Abschnitt 8) — Kotlin: ✅ ink/HandwritingRecognizer.kt (ML Kit Deutsch)
- [ ] **Erkennungsmodell: lokales ONNX, ca. 10 MB** (web/settings-renderer.js:263-283; web/handschrift.js) — Kotlin: 🟡 ink/HandwritingRecognizer.kt (ML Kit Digital Ink, Modell-Download bei Bedarf; Einstellungen nur Platzhalter, settings/SettingsAiSync.kt:40)
- [ ] **Fortschritt „x % der Handschrift analysiert“ in den Einstellungen** (web/heft-index-progress.js:14-20; web/settings-renderer.js:272; web/settings.js:1253-1255) — Kotlin: ⬜
- [ ] **Anzahl gesammelter Trainingsbeispiele** (web/settings-renderer.js:268-269) — Kotlin: ⬜
- [ ] **Trainingsbeispiel aus Lasso speichern** (Abschnitt 8) — Kotlin: ⬜ bewusst entfallen
- [ ] **Trainingsbeispiele exportieren (JSON, teilen)** (web/handschrift.js:182-194; web/settings-renderer.js:279) — Kotlin: ⬜
- [ ] **Alle Handschrift exportieren** (web/settings-renderer.js:280; web/heft-export.js:80-93) — Kotlin: ⬜ (SettingsApp.kt:48 Platzhalter)
- [ ] **Trainingsbeispiele leeren** (web/app-click-buttons.js:210; web/settings-renderer.js:279) — Kotlin: ⬜
- [ ] **Button „Abschreiben“ in den Einstellungen** (web/settings-renderer.js:276; web/app-click-buttons.js:201-202) — Kotlin: ⬜

### 17. Abschreiben (Schreibübung)

- [ ] **Vollbild-Overlay „Abschreiben“** mit Kopf (Titel, Info „Zeile x/y · Text n/m · k gespeichert“) und ✕ (web/abschreiben.js:60-84, 126-141, 182-185) — Kotlin: ⬜
- [ ] **Vorgabetext mit markierter Zeile (scrollt mit)** (web/abschreiben.js:74, 134-138) — Kotlin: ⬜
- [ ] **Große Vorgabe-Zeile** (web/abschreiben.js:75, 137) — Kotlin: ⬜
- [ ] **Schreibfeld (nur Stift), mit Grund- und Mittellinie** (web/abschreiben.js:76, 94-116, 161-180) — Kotlin: ⬜
- [ ] **Senden (Trainingsbeispiele teilen)** (web/abschreiben.js:78, 191-195) — Kotlin: ⬜
- [ ] **Anderer Text** (web/abschreiben.js:79, 151-154) — Kotlin: ⬜
- [ ] **Überspringen** (web/abschreiben.js:80, 198) — Kotlin: ⬜
- [ ] **↶ Strich (letzten Strich entfernen)** (web/abschreiben.js:81, 197) — Kotlin: ⬜
- [ ] **Löschen (alle Striche der Zeile)** (web/abschreiben.js:82, 196) — Kotlin: ⬜
- [ ] **Weiter ✓ (speichert Striche und Soll-Text, jeder vierte Text ist Messzeile)** (web/abschreiben.js:83, 200-212) — Kotlin: ⬜
- [ ] **Zeilenumbruch nach 34 Zeichen** (web/abschreiben.js:13, 29-42) — Kotlin: ⬜
- [ ] **Position wird gemerkt** (web/abschreiben.js:12, 44-54) — Kotlin: ⬜

### 18. Labeling und KI-Anhang

- [ ] **Heftseite als Bild mit 100-px-Raster (für KI-Beschriftung)** (web/heft-label.js:36-92; web/mcp-bridge.js:627) — Kotlin: ⬜ (Entwickler-Werkzeug, nur über Web-Bridge)
- [ ] **Zeilen beschriften und Trainingsbeispiele anlegen** (web/heft-label.js:111-186; web/mcp-bridge.js:630) — Kotlin: ⬜
- [ ] **„Aktuelle Heft-Seite als Bild anhängen“ im KI-Schnellmenü** (web/index.html:265; web/app-click-buttons.js:95-103; web/heft.js:1819-1826) — Kotlin: ⬜ (ai/AiChatViewModel.kt:82 liefert null)
- [ ] **Hinweis im KI-Chat „Heft · Seite N wird als Bild mitgesendet“** (web/render.js:1470-1481) — Kotlin: ⬜

### 19. Kopfzeilen und Menüs im Heft

- [ ] **Desktop/Tablet-PWA: kein Heft-Kopf** – nur Tab-Leiste, Heft im Fokusmodus; Teilen, ★ und ⋯ gibt es nur für Notizen (web/render.js, Zweig `pg.kind === "heft"` ca. Z. 667-677; web/render.js:758-765) — Kotlin: 🟡 HeftTopBar.kt (Kopfzeile nur auf dem Telefon, Abweichung von der PWA)
- [ ] **Telefon-PWA: Kopfzeile mit Titel, Suchen, KI-Assistent, Bearbeiten/Fertig und ⋯ Seitenoptionen** (web/mobile-view.js:18-40; web/mobile.js:375-416) — Kotlin: 🟡 HeftTopBar.kt (Titel ✅, Zurück ✅; Suchen ⬜, KI ⬜, Bearbeiten/Fertig ⬜)
- [x] **Titel des Hefts in der Kopfzeile** — Kotlin: ✅ HeftTopBar.kt:52-56
- [x] **Anzeige „Seite x von y“** (Kopfzeile Telefon) — Kotlin: ✅ HeftTopBar.kt:55, HeftScreen.kt:117 (PWA zeigt keinen solchen Text im Kopf)
- [ ] **⋯ Seitenoptionen → Rückgängig / Wiederholen** (web/heft-toolbar-ui.js:161-162; web/render.js:770-788 Menü) — Kotlin: 🟡 (Rückgängig/Wiederholen nur in der Kapsel)
- [ ] **⋯ → Favorit / Zu Favoriten** (web/render.js:770-788) — Kotlin: ⬜
- [ ] **⋯ → Als PDF exportieren / drucken, Als Markdown speichern** (web/render.js:766-768, 770-788) — Kotlin: ⬜ (DeskPageActions.kt:97)
- [ ] **⋯ → Internen Link kopieren** — Kotlin: ⬜
- [ ] **⋯ → Verlauf** (web/render.js:785) — Kotlin: ⬜
- [ ] **⋯ → Icon ändern, Cover ändern** (web/render.js:786-787) — Kotlin: ⬜
- [ ] **⋯ → Karten aus Markierungen** — Kotlin: ⬜ (nicht heftspezifisch)
- [ ] **⋯ → Duplizieren / Verschieben / Papierkorb** (web/render.js:788) — Kotlin: 🟡 (Papierkorb für Hefte im Regal, nicht im Heft geprüft)
- [ ] **Teilen-Knopf (Export und Teilen-Menü)** – im Heft nicht vorhanden — Kotlin: ⬜ (DeskPageActions.kt:87-98: „PDF-Export für Hefte“ später; Teilen nur Text)
- [x] **Seitenleiste und Tabs bleiben im Heft** (web/styles.css:99, 350-353) — Kotlin: ✅ (laut Kommentar DeskShell.kt:50; Sichtprüfung nicht erfolgt)
- [x] **KI-Knopf im Heft oben rechts (Ecke) statt unten rechts** (web/styles.css:350-353; web/render.js:639) — Kotlin: ✅ Tablet: Ecke; Telefon: Kopfzeile

### 20. Tastatur (Desktop/Tablet mit Tastatur)

- [ ] **Strg/⌘+Z = Rückgängig, Strg+Y bzw. Umschalt+Strg+Z = Wiederholen** (web/heft.js:1521-1525) — Kotlin: ⬜
- [ ] **Esc schließt Popover oder Scanner** (web/heft.js:1526-1530) — Kotlin: ⬜
- [ ] **Entf/Rücktaste löscht Auswahl, Bild oder Textfeld** (web/heft.js:1531-1550) — Kotlin: ⬜
- [ ] **Enter/Esc im Textfeld** (web/heft.js:1010-1014) — Kotlin: ⬜

### 21. Einstiege außerhalb des Editors (nur Überblick)

- [ ] **Neues Heft: Cover wählen und anlegen** (web/library.js:116, 146-170) — Kotlin: 🟡 ShellNav.kt:98-103 (Heft anlegen ✅; Cover-Auswahl nicht geprüft)
- [ ] **Heftoptionen: Cover, Archivieren, Papierkorb** (web/library.js:172-200, 629-646) — Kotlin: 🟡 NoteRows.kt (Archivieren und Papierkorb generisch; Cover nicht geprüft)
- [x] **Heft-Vorschau auf der Startseite (zuletzt angesehene Seite)** (web/heft.js:1766-1789) — Kotlin: ✅ HeftThumbnail.kt:14-27
- [ ] **Heft als Block in einer Notiz (Vorschau mit Bild und Seitenzahl)** (web/editor.js:509-511; web/heft.js:1790-1806; web/css/heft.css:270-272) — Kotlin: 🟡 editor/ComplexBlocks.kt:74 (nur Link-Karte ohne Vorschau)
- [ ] **Heft im Slash-Menü einfügen** (web/editor-menus.js:120, 172-190) — Kotlin: ⬜ (editor/SlashMenu.kt:36)
- [x] **Neues Heft aus der Vorlagenauswahl** (web/render.js; Kotlin notes/TemplatePicker.kt:69) — Kotlin: ✅ TemplatePicker.kt:69

### 22. Verhalten ohne eigenes Element

- [ ] **Speichern** – PWA: 350 ms Verzögerung, Speichern bei Verlassen (web/heft.js:335-380) — Kotlin: 🟡 HeftViewModel.kt:102-112 (jeder Strich sofort als Ereignis; kein Pufferwert)
- [x] **Meldungen (Toasts)** — Kotlin: ✅ HeftScreen.kt:83, 122 (Snackbar)
- [x] **Ladeanzeige „Heft laden…“** (web/heft.js:1681) — Kotlin: ✅ HeftScreen.kt (`LoadingIndicator`)
- [x] **Gleichzeitige Änderungen von zwei Geräten** (web/heft.js:62-78) — Kotlin: ✅ (gleicher Kern, HeftViewModel.kt:132-136 Schreiben über Kern)
- [x] **Speicherbegrenzung der Miniaturen (60 Einträge) und Scan-Bitmaps (48)** (web/heft.js:97, 1180) — Kotlin: ✅ (durch Compose-Caches, nicht gezielt begrenzt, HeftThumbnail.kt)

---

**Priorität für die Angleichung (Vorschlag):** 1. Bilder und Texte zeichnen (HeftPageView.kt, HeftThumbnail.kt); 2. Optionsleiste unter die Kapsel setzen, Farbpunkte und Farbfelder an die PWA anpassen (HeftToolbar.kt, HeftScreen.kt); 3. Werkzeugzustand speichern (HeftState.kt, HeftViewModel.kt); 4. Marker mit Stiftfarbe teilen; 5. Zoom-Grenzen und Gesten (Doppeltipp, Zwei-/Drei-Finger-Tipp); 6. Schreib-Rückzug und Einklappen; 7. Formerkennung, Laser, Bild-/Text-Werkzeug; 8. Import, Export, Verlauf, Abschreiben.


---

# 4. KI-Chat und Karteikarten/Lernen


**Basis:** `web/` relativ zu `/home/jv232/Documents/Codex/2026-08-22/ka/Impala67/`. Kotlin-Dateien relativ zu `android/app/src/main/java/org/impala67/app/`. Dateien über 300 Zeilen (render.js, fach.js, ai.js, chat-fullscreen.js) wurden nur in Blöcken von höchstens 200 Zeilen gelesen bzw. per grep erschlossen. Die Status-Angaben beruhen auf statischem Lesen des Codes, nicht auf einem Lauf der App.

**Legende:** ✅ vorhanden wie PWA · 🟡 teilweise oder abweichend (Grund in Klammern) · ⬜ fehlt.

**Gesamtbild:** Kotlin hat den Chat-Kern (Verlauf, Senden/Stopp, Werkzeug-Chips, Rückfragen, Rückgängig), die Stapel-Liste, Kartenbearbeitung, Kartenbrowser und die Lernansicht mit Bewertung. Es fehlen praktisch alle Anhänge, die Modellwahl, Sprache, Statistik, Lernanalyse, Fächer, Schulnoten, Karten-Import/Export, Archiv-Wiederherstellung und die Experiment-Modi (Feynman, Hinweise, Quiz).

---

### 1. KI-Panel (Seitenpanel)

- [x] **Panel-Kopf "KI-Coach"** – Titel mit Statuspunkt neben den Knöpfen (index.html:218-222) — Kotlin: ✅ ui/desk/DeskAiPanel.kt (Titel und Trennlinie vorhanden; Punkt statt Status-Pille)
- [ ] **Status-Chip** – Zeigt "KI online" / "KI offline" / "KI …" mit Punkt; Klick prüft erneut bzw. öffnet die KI-Einstellungen bei offline (index.html:220; render.js:159-197; app-click-chat.js:182-186) — Kotlin: ⬜ – (kein Gegenstück; nur der Link "KI-Einstellungen öffnen" im Fehlerfeld, ai/ChatParts.kt)
- [ ] **Verlauf-Knopf (Uhr)** – Öffnet Dropdown mit allen gespeicherten Chats, Klick auf Eintrag führt den Chat im Panel weiter (index.html:224; app-click-buttons.js:60-62; render.js:1499-1518, Hinweis "Noch keine gespeicherten Chats.") — Kotlin: 🟡 ai/ChatList.kt (Verlauf steht als Seitenleisten-Liste statt als Dropdown)
- [x] **Neu (＋)** – Speichert den Chat, leert das Panel, Toast "Neuer Chat gestartet" (index.html:225; app-click-buttons.js:64-69) — Kotlin: ✅ ui/desk/DeskAiPanel.kt (HeadButton "Neuen Chat starten", deaktiviert während eines Laufs)
- [ ] **Erweitern (in eigenem Tab öffnen)** – Schiebt den Seitenchat als `chat:`-Tab in den Hauptbereich und klappt das Panel ein (index.html:226; app-click-buttons.js:71-83) — Kotlin: ⬜ – (kein Chat-Tab auf dem Desktop; ui/shell/Destinations.kt zeigt Chat nur als Vollbild auf dem Handy)
- [x] **Schließen (✕)** – Klappt das Panel ein (index.html:227; app-click-buttons.js:132-135) — Kotlin: ✅ ui/desk/DeskAiPanel.kt (HeadButton "KI einklappen")
- [x] **FAB "KI öffnen"** – Unten rechts, nur wenn das Panel zu ist; öffnet das Seitenpanel (index.html:256-258; app-click-buttons.js:35-40) — Kotlin: ✅ ui/desk/DeskShell.kt (FloatingActionButton, nur bei geschlossenem Panel und nicht im Vollbild)
- [x] **Automatisches Öffnen bei neuem Chat** – Panel klappt bei Start oder Öffnen eines Chats auf (ai.js:396; chat-fullscreen.js:142-178) — Kotlin: ✅ ui/desk/DeskShell.kt (LaunchedEffect über openRequests)
- [x] **Chat-Verlauf im Panel (Log)** – Nachrichten, Live-Antwort, Fehler; scrollt automatisch ans Ende (index.html:230; render.js:1372-1448) — Kotlin: ✅ ai/ChatView.kt (LazyColumn mit Auto-Scroll)

### 2. Composer

- [x] **Eingabefeld** – Platzhalter "Frag deinen KI-Coach…", mehrzeilig; Enter sendet, Shift+Enter nicht (index.html:238; app.js:728-732) — Kotlin: ✅ ai/ChatView.kt:Composer (Platzhalter gleich; Enter-Senden nicht geprüft)
- [x] **Senden (↑)** – Deaktiviert bei leerem Feld (index.html:248; chat-fullscreen.js:68-79) — Kotlin: ✅ ai/ChatView.kt:Composer (Knopf "Senden", deaktiviert bei Leerzeichen)
- [x] **Stopp (⏹) während Lauf** – Ersetzt Senden; bricht Lauf ab, Teilantwort bleibt (chat-fullscreen.js:68-79, 163-168; ai.js:467-476) — Kotlin: ✅ ai/ChatView.kt:Composer ("Antwort abbrechen") — 🟡 Teilantwort wird nicht behalten (ai/AiChatViewModel.kt:finishRun leert den Entwurf; Fehlerbox "Abgebrochen.")
- [ ] **"+"-Knopf (Anhang-Menü öffnen)** – Öffnet Menü mit den drei Einträgen unten (index.html:242; app-click-buttons.js:91-96; chat-fullscreen.js:433-438) — Kotlin: ⬜ – (kein Anhang-Knopf in ai/ChatView.kt)
- [ ] **Menü: "Fotos und Dateien hinzufügen"** – Öffnet Dateiauswahl für PDF und Bild (index.html:264, Eingabe index.html:271; app-click-buttons.js:115-118; chat-fullscreen.js:440-463) — Kotlin: ⬜ – (AiChatViewModel.send setzt image/textFile/pdfFile immer auf null)
- [ ] **Menü: "Aktuelle Heft-Seite als Bild anhängen"** – Nur sichtbar bei geöffnetem Heft; hängt Heftseite als Bild an (index.html:265; app-click-buttons.js:95, 98-113) — Kotlin: ⬜ – (Platform-Callback heftPageImage liefert null in AiChatViewModel.kt)
- [ ] **Menü: "Seiten oder Personen erwähnen…"** – @-Erwähnung. In der PWA selbst nur Platzhalter: Toast "folgen als Nächstes" (index.html:266; app-click-buttons.js:119-122) — Kotlin: ⬜ – (in PWA ebenfalls nicht umgesetzt, nicht als Vorlage nachbauen)
- [ ] **Anhang-Chip Bild** – Vorschaubild, "wird mitgesendet", ✕ (render.js:1705-1731, Zeile 1713; chat-fullscreen.js:405-421) — Kotlin: ⬜ – (kein Anhang-Chip)
- [ ] **Anhang-Chip Textdatei** – Name, Zeichenzahl, "wird als Datei angehängt", ✕ (render.js:1714) — Kotlin: ⬜ – (kein Anhang)
- [ ] **Anhang-Chip PDF** – Name, Seitenzahl, "wird als PDF-Kontext angehängt", ✕ (render.js:1715; chat-fullscreen.js:440-452 extrahiert Text lokal) — Kotlin: ⬜ – (kein Anhang)
- [ ] **Nur ein Anhang pro Nachricht** – Neuer Anhang ersetzt alten (chat-fullscreen.js:416-421) — Kotlin: ⬜ – (kein Anhang)
- [ ] **Bild aus Zwischenablage einfügen** – Wird Anhang (chat-fullscreen.js:465-486) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Langer Text einfügen** – Über 600 Zeichen oder über 15 Zeilen wird Anhang "geklebter-text.txt" (chat-fullscreen.js:480-485; Herunterladen-Knopf am Chip, chat-fullscreen.js:222-225) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Seitenkontext-Chip** – Zeigt aktuelle Seite mit Hinweis "Seitenkontext · wird mitgesendet" bzw. "Anfang mitgesendet (x von y Zeichen)" oder Heft-Hinweis; ✕ entfernt Kontext für diese Seite (index.html:235; render.js:1466-1494; app.js:351) — Kotlin: 🟡 ai/AiChatViewModel.kt (sendPageContext wird gesetzt, aber kein Chip und keine Abwahl)
- [ ] **Modell-Knopf** – Tooltip "Modell: <Name>"; Icon; öffnet Modellmenü (index.html:243-245; render.js:208-218; chat-fullscreen.js:284-308) — Kotlin: ⬜ – (AiOptions model/providerId sind null; Modellwahl in ui/… settings/SettingsAiSync.kt nur Platzhalter "KI-Quellen")
- [x] **Sprache (Mikrofon)** – Spracheingabe, de-DE; Ergebnis wird direkt gesendet; Zustand zeigt Stopp-Icon (index.html:247; voice.js:27-33, 44-132, 47-61) — Kotlin: ✅ ai/Dictation.kt, ChatView.kt
- [ ] **Alt+Leertaste** – Startet/stoppt Spracheingabe im Seitenpanel (shortcuts.js:77-82; voice.js:44) — Kotlin: ⬜ – (kein Tastatur-Handler)
- [ ] **Sprachausgabe der Antwort** – In PWA bewusst aus (voice.js:16, 154-165 vorhanden, nicht aktiv) — Kotlin: – (nichts nachzubauen)
- [ ] **Vollbild-Spracheingabe-Knopf** – Wird vor dem Senden-Knopf im Vollbild eingefügt (app-dialogs.js:46-53; voice.js:28) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Quellen (RAG)** – In PWA keine sichtbaren Quellen: Notiz-Treffer laufen unsichtbar in den Kontext (ai.js:316-326, Auto-RAG 4 Treffer) — Kotlin: ⬜ – (AiRunRequest useRag=false; kein Gegenstück, daher nicht anzuzeigen)

### 3. Nachrichten (Verlauf)

- [x] **Nutzer-Blase** – Text, optional Bild, Datei-Chip, PDF-Chip mit Seitenzahl (render.js:1170-1178) — Kotlin: ✅ ai/ChatParts.kt:UserBubble (ohne Anhänge)
- [ ] **Bearbeiten-Stift an Nutzernachricht** – Lädt Text zurück ins Eingabefeld, schneidet spätere Nachrichten ab; gesperrt, solange spätere Seitenänderungen nicht rückgängig sind (render.js:1172; chat-fullscreen.js:227-253; Hinweistext 233) — Kotlin: ⬜ – (UserBubble ohne Bearbeiten)
- [ ] **Antwort als Markdown** – Überschriften, Listen, Code, Formeln (KaTeX), Highlighting (render.js:1631-1639; render.js:1249-1302 Streaming in stabilen Abschnitten) — Kotlin: 🟡 ai/ChatParts.kt:MarkdownView + editor/MarkdownView.kt (Blöcke, Listen, Tabellen, Code vorhanden; keine Formel-Darstellung gefunden)
- [ ] **Kopieren-Knopf** – "Kopieren" kopiert Antworttext in die Zwischenablage, Toast (render.js:1637; app.js:394-399) — Kotlin: ⬜ – (keine Aktion in ai/ChatParts.kt)
- [ ] **Anpassen (✦)** – Öffnet Menü: Länger / Gleich / Kürzer; ersetzt die Antwort in place, alte verschwindet während der Neuerstellung (render.js:1638, 1633-1635; chat-fullscreen.js:102-139, 270-280; REFINE_PROMPTS 96-100; ai.js:260-265) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Code-Kopierknopf** – Kopiert Codeblock, Icon wechselt auf Haken, Toast "Code kopiert." (app.js:374-385; util.js:684) — Kotlin: ⬜ – (in editor/MarkdownView.kt nicht gefunden)
- [ ] **Gedankengang (fertige Antwort)** – Ausklappbar; Label mit Wortzahl "(N Wörter)" (render.js:1611-1623, 1632; chat-fullscreen.js:181-196) — Kotlin: 🟡 ai/ChatParts.kt:ThinkBox (ausklappbar, ohne Wortzahl)
- [ ] **Gedankengang live** – Zeigt die letzten 2 Zeilen; ausklappbar zum vollen Text; Label "Gedankengang…" (render.js:1626-1629, 1212-1233; btnThinkLive) — Kotlin: 🟡 ai/ChatParts.kt:LiveBlock (Gedankengang komplett, keine Zwei-Zeilen-Vorschau)
- [x] **Werkzeug-Chip** – "Hat … verwendet"-Karte mit Klartext für alle Werkzeuge, Detail und Fehler-Markierung (render.js:1184-1200; Labels 1184-1199) — Kotlin: ✅ ai/ChatParts.kt:ToolChip (Label-Tabelle identisch)
- [x] **Änderungskarte (nur Rückgängig)** – "Atomar gespeichert" / "Rückgängig gemacht" und ↺ (render.js:1642-1644) — Kotlin: ✅ ai/ChatParts.kt:EditCard (Rückgängig über ai/AiChatViewModel.kt:undo)
- [ ] **Änderungskarte mit Seitenangaben** – Titel, Hat erstellt/Hat geändert, Seitensymbol, "Änderungen anzeigen" und ↺ (render.js:1641-1652; chat-fullscreen.js:198-220) — Kotlin: 🟡 ai/ChatParts.kt:EditCard (kein "Änderungen anzeigen", keine Seitenangabe)
- [ ] **Änderungsvorschau (Seiten-Diff)** – Overlay: Neu/Geändert-Badge, Rückgängig, "Seite öffnen", Legende +/−/unverändert, Diff-Blöcke (render.js:1655-1703; 1688-1694) — Kotlin: ⬜ – (kein Gegenstück)
- [x] **Rückfrage-Karte (ask_choice)** – Frage mit Optionsknöpfen; nach Antwort nur gewählte Option mit Haken (render.js:1451-1458; chat-fullscreen.js:255-268; ai.js:393-413; Ja-/Nein-Status 420) — Kotlin: ✅ ai/ChatParts.kt:QuestionCard + ai/AiChatViewModel.kt:answer
- [x] **Statuszeile "…denkt nach…" bzw. Werkzeugname** – Während Lauf ohne Entwurf (render.js:1231; ai.js:158, 411) — Kotlin: ✅ ai/ChatParts.kt:LiveBlock (Werkzeugname mit "…")
- [ ] **Fehler-Nachricht** – "**Fehler:**" plus Meldung; bei Bildanhang Hinweis zum Vision-Modell (chat-fullscreen.js:169-173) — Kotlin: ✅ ai/ChatParts.kt:ErrorBox (Meldung und Link "KI-Einstellungen öffnen"); ⬜ Vision-Hinweis (keine Bilder)
- [ ] **Abbruch-Anzeige "(Abgebrochen.)"** – Als Nachricht mit Teilantwort (chat-fullscreen.js:166-168) — Kotlin: 🟡 ai/ChatParts.kt:ErrorBox (Text "Abgebrochen.", keine Teilantwort)
- [x] **Streaming-Antwortentwurf** – Wächst während der Antwort (render.js:1278-1302) — Kotlin: ✅ ai/ChatParts.kt:LiveBlock (Entwurf als Markdown)

### 4. Chat-Start-Seite (leerer Chat)

- [x] **Begrüßung nach Tageszeit** – "Gute Nacht / Guten Morgen / Guten Tag / Guten Abend." (chat-start.js:14-16, 18-24) — Kotlin: ✅ ai/ChatView.kt:EmptyChat (gleiche Zeitfenster)
- [ ] **Leucht-Kugel (Orb)** – Animierte Kugel mit ✦, langsam drehend, atmend; Bewegung aus bei reduzierter Bewegung (chat-start.js:20; chat-start.css:25-33) — Kotlin: ⬜ – (kein Orb in ai/ChatView.kt)
- [x] **Titel und Untertitel** – "Was möchtest du heute verstehen?" und Erklärtext (chat-start.js:21-22) — Kotlin: ✅ ai/ChatView.kt:EmptyChat (Texte identisch)
- [ ] **Vorschlagskarten (4)** – "Erklär's mir", "Karteikarten", "Zusammenfassen", "Quiz mich"; setzen nur den Prompt-Anfang ins Feld, senden nicht (chat-start.js:7-12, 26-32; app.js:368-372) — Kotlin: ✅ ai/ChatView.kt:Suggest (gleiche Texte und Anfänge; 🟡 als vertikale Liste statt 4-Spalten-Raster, chat-start.css:36-44)
- [ ] **Leerzustand-Layout** – Begrüßung und Vorschläge zentriert, Eingabe darüber; Vorschläge verschwinden bei erster Nachricht (chat-start.css:5-12; render.js:1602-1606) — Kotlin: 🟡 ai/ChatView.kt:EmptyChat (Eingabe unten statt Mitte; Verschwinden bei erster Nachricht vorhanden)

### 5. Vollbild-Chat (Chat-Tab)

- [ ] **Kopf "✦ Titel"** – Titel mit Status-Chip (render.js:1579-1581, 613) — Kotlin: 🟡 ui/shell/Destinations.kt:70 (Phone-Chat ohne Titelzeile und ohne Status-Chip)
- [x] **Vollbild-Verlauf** – Gleiche Nachrichtenarten wie Panel (render.js:1597-1608) — Kotlin: ✅ ai/ChatView.kt
- [ ] **Vollbild-Composer** – "+", Modell-Knopf, Sprache, Senden (render.js:1584-1590; app-dialogs.js:46-53) — Kotlin: 🟡 ai/ChatView.kt (nur Eingabe und Senden; "+", Modell, Sprache fehlen)
- [x] **Vollbild-Vorschläge im Leerzustand** – (render.js:1591) — Kotlin: ✅ ai/ChatView.kt:EmptyChat
- [ ] **Seitenkontext-Chip im Vollbild** – (render.js:1720) — Kotlin: ⬜ – (siehe Seitenkontext oben)
- [x] **Chat im Vollbild aus Liste öffnen** – Chat-Tab-Auswahl in der Seitenleiste (app-click-buttons.js:50-53; render.js:514-539) — Kotlin: ✅ ui/desk/DeskSidebar.kt (SidebarMode.Chats) + ai/ChatList.kt

### 6. Chatliste (Seitenleiste)

- [x] **Zeile "+ Neuer Chat"** – Gesperrt während Lauf (render.js:528; app.js:518) — Kotlin: ✅ ai/ChatList.kt (deaktiviert während Lauf)
- [ ] **Chatzeile mit Titel und Datum** – Titel aus erster Nachricht, max. 60 Zeichen (render.js:531-533; chats.js:204-207) — Kotlin: ✅ ai/ChatList.kt:ChatRow (Titel, Datum); 🟡 Titelbildung nicht im Kotlin-Code geprüft
- [x] **Leerzustand "Noch keine gespeicherten Chats."** (render.js:1507 bzw. Liste) — Kotlin: ✅ ai/ChatList.kt
- [x] **Aktiver Chat hervorgehoben** (render.js:531) — Kotlin: ✅ ai/ChatList.kt (active)
- [ ] **Umbenennen (Stift)** – Dialog "Chat umbenennen" mit altem Titel, speichert (render.js:535; app.js:356-366) — Kotlin: ⬜ – (ChatList nur Löschen)
- [x] **Löschen (Papierkorb)** – Bestätigungsdialog "… wirklich löschen? Das kann nicht rückgängig gemacht werden." (render.js:536; chat-fullscreen.js:347-359) — Kotlin: ✅ ai/ChatList.kt (Menü "Chat-Optionen" → "Löschen", gleicher Bestätigungstext)
- [ ] **Kästchen je Zeile (Mehrfachauswahl)** – Erst sichtbar, sobald eine Auswahl aktiv ist (render.js:532; chat-fullscreen.js:328-334) — Kotlin: ⬜ – (keine Mehrfachauswahl)
- [ ] **Auswahlleiste** – "N ausgewählt", Alle, Auswahl aufheben, Papierkorb für ausgewählte (render.js:519-528; chat-fullscreen.js:336-376) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Alle Chats löschen (Gefahrenzone)** – Bestätigung mit Hinweis auf Geräte-Sync (chat-fullscreen.js:378-396; app-click-buttons.js:244) — Kotlin: ⬜ – (settings/SettingsApp.kt:60 nur Platzhalter "Folgt mit dem KI-Modul")
- [x] **Schutz laufender Chat** – Löschen eines Chats mit laufender Antwort wird abgelehnt (chat-fullscreen.js:326, 364; Toast) — Kotlin: ✅ ai/AiChatViewModel.kt:delete (Guard)
- [ ] **Verlaufs-Speicherung mit Sync** – Lokaler Cache plus Ereignislog (chats.js:1-211) — Kotlin: – (Store-Ebene, nicht als UI-Element zu prüfen)

### 7. Modellwahl und Denkaufwand (Modellmenü)

- [ ] **Menüwurzel "Modell ›" und "Denkaufwand ›"** – Zwei Unterseiten; Untertitel zeigt aktuelles Modell bzw. Thinking-Stufe (render.js:250-254; app-click-chat.js:44-52) — Kotlin: ⬜ – (kein Modellmenü)
- [ ] **Unterseite Modell: "★ Favoriten"** – Favoriten quellenübergreifend zuerst (render.js:273-274) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Unterseite Modell: Gruppen je Quelle** – Überschrift je Provider, Liste der Live-Modelle (render.js:275-278) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Unterseite Modell: "Gespeichert & Vorschläge"** – Fallback, wenn keine Live-Liste (render.js:281-292) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Modellzeile mit ✓ und Stern** – Auswahl setzt Quelle::Modell; Stern pinnt als Favorit (render.js:265-270; 228-238; app-click-chat.js:76-91) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Hinweis "Modelle werden aktualisiert…"** und Leerhinweis "Gerade ist kein Modell erreichbar…" (render.js:293-294) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Denkaufwand-Unterseite** – Optionen "Automatisch" und "Reduziert" (Name je nach Modell), ✓ bei Auswahl; Hinweistext; Ladehinweis "API-Fähigkeiten werden geprüft…"; "Nicht steuerbar" bei fehlender Stufe (render.js:255-262, 249, 257-258; app-click-chat.js:68-73) — Kotlin: ⬜ – (thinkingEnabled ist in AiChatViewModel.assistantFor null)
- [ ] **Eigenes Modell eingeben** – Quelle wählen (Chips), Textfeld, "Übernehmen" (app-click-chat.js:133-155, Handler vorhanden) — ⚠ In PWA-Markup nicht gefunden: toter Pfad (app-click-chat.js:133-155) — Kotlin: ⬜ – (nicht nachbauen, PWA hat dafür kein Markup)
- [ ] **Thinking neu prüfen** – Handler vorhanden, Markup nicht gefunden (app-click-chat.js:53-62) — Kotlin: ⬜ – (toter Pfad in PWA)
- [ ] **Modellbezogene Prüfung der Denkstufen** – Automatisch im Hintergrund (ai.js:196-203; chat-fullscreen.js:306-307) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Modelllisten-Cache** – 30 s (ai.js:21, 171-179) — Kotlin: – (Kern-Logik)

### 8. Karteikarten: Deck-Baum (Seitenleiste)

- [x] **Stapelbaum mit Einklappen (▸)** – Unterstapel per "::", eingerückt (render-anki.js:97-139; 116-118) — Kotlin: ✅ ui/desk/DeskDecks.kt (DeskTreeRow + DeskChevron, Einrückung)
- [x] **Badge "N fällig"** – Wiederholungen plus fällige Lernschritte mit Tageslimit (render-anki.js:113-126) — Kotlin: ✅ ui/desk/DeskDecks.kt:CountBadge (Zählerlogik nicht im Detail geprüft)
- [x] **Badge "N neu"** – Neue Karten im Tageslimit (render-anki.js:127) — Kotlin: ✅ ui/desk/DeskDecks.kt:CountBadge
- [x] **Aktiver Stapel markiert** (render-anki.js:121) — Kotlin: ✅ ui/desk/DeskDecks.kt (active)
- [ ] **Kopfzeile "Stapel" mit "+" (Neuer Stapel)** (render-anki.js:135-136) — Kotlin: 🟡 ui/desk/DeskDecks.kt (kein "+" in der Seitenleiste; Anlegen nur über study/StudyScreen.kt)
- [ ] **Leerhinweis "Noch keine Stapel — mit + einen anlegen"** (render-anki.js:137) — Kotlin: 🟡 study/StudyScreen.kt:118 (anderer Wortlaut)
- [ ] **Stapel per Drag & Drop umordnen** – Zeile ist draggable; Reihenfolge wird als order gespeichert (render-anki.js:121; app-sidebar-events.js, deckReorder) — Kotlin: ⬜ – (kein Gegenstück)
- [x] **Doppelklick/Klick öffnet Stapel** (render-anki.js:121; app-click-anki.js:124-130 "data-deckopen") — Kotlin: ✅ ui/desk/DeskDecks.kt (onOpen)

### 9. Karteikarten: Deck-Menüs (jeder Eintrag)

Baum-⋯-Menü (render-anki.js:142-150; app-click-anki.js:19-70):
- [x] **Umbenennen** – Inline-Eingabe am Desktop, Dialog auf Touch (render-anki.js:145; app-click-anki.js:33-45) — Kotlin: ✅ study/DeckRow.kt:DeckMenu (nicht für "Standard"); study/DeckDialogs.kt (Name-Dialog)
- [x] **Duplizieren** (render-anki.js:146) — Kotlin: ✅ study/DeckRow.kt (Eintrag "Duplizieren")
- [ ] **Archivieren** (render-anki.js:147) — Kotlin: ✅ study/DeckRow.kt (Eintrag "Archivieren") – 🟡 Wiederherstellen fehlt (siehe Archiv)
- [x] **In Papierkorb** – Bestätigung "Stapel löschen" mit Kartenzahl (render-anki.js:148; app-click-anki.js:55-66) — Kotlin: ✅ study/DeckRow.kt (nicht für "Standard"); study/DeckDialogs.kt:DeckTrashDialog

Übersichts-Zeilenaktionen (render-anki.js:228-240):
- [ ] **Stapel durchsuchen (Lupe)** – öffnet Browser gefiltert (render-anki.js:229; app-click-anki.js:…ankideckfilter) — Kotlin: 🟡 study/DeckRow.kt (als Menüeintrag "Karten ansehen", kein Icon)
- [x] **Unterstapel anlegen (+)** – Dialog "Name des Unterstapels von …" (render-anki.js:230; app-click-anki.js) — Kotlin: ✅ study/DeckRow.kt (Eintrag "Unterstapel anlegen"); study/StudyScreen.kt:148 (Dialog)
- [x] **Archivieren (Icon)** (render-anki.js:231) — Kotlin: ✅ study/DeckRow.kt (im Menü)
- [x] **Papierkorb (Icon)** (render-anki.js:234) — Kotlin: ✅ study/DeckRow.kt (im Menü)
- [x] **Lernen** – Startet Stapel; deaktiviert wenn nichts fällig (render-anki.js:235) — Kotlin: ✅ study/DeckRow.kt (TintButton "Lernen", nur in Breitansicht und wenn fällig)
- [ ] **Feynman (je Stapel)** – Lernt im Feynman-Modus (render-anki.js:237) — Kotlin: ⬜ – (study/DeckRow.kt ohne Feynman; Beta-Platzhalter in settings/SettingsLearning.kt:50)
- [x] **⋯ Menü** (render-anki.js:238) — Kotlin: ✅ study/DeckRow.kt:DeckMenu
- [x] **Menü-Eintrag "Optionen" (Stapel-Optionen)** – Nicht in der PWA-Baum-Menü, aber in der Übersicht über data-deckconf (render-anki.js:160, 517) — Kotlin: ✅ study/DeckRow.kt (Eintrag "Optionen"; Android-Zusatz)
- [x] **Menü-Eintrag "Karten ansehen"** – Android-Zusatz; in PWA über Lupe (siehe oben) — Kotlin: ✅ study/DeckRow.kt
- [x] **Stapelzeile Zusatz "N ausgesetzt"** (render-anki.js:222) — Kotlin: ✅ study/DeckRow.kt:Text (Anzahl ausgesetzt)
- [x] **Zähler "N fällig" / "N offen"** – plus "N lernen · N neu" und "✓ fertig für heute" (render-anki.js:223-227) — Kotlin: ✅ study/DeckRow.kt:Counts (gleiche Zustände, Text "fertig für heute")

### 10. Karteikarten: Übersicht / Stapel-Tab

- [x] **Kopf "Karteikarten" bzw. Stapelname** (render-anki.js:158) — Kotlin: ✅ study/StudyScreen.kt (Kopf "Lernen" bzw. Abschnitte)
- [ ] **Tabs Stapel / Browser / Statistik / Archiv** (render-anki.js:159) — Kotlin: 🟡 study/StudyScreen.kt (Stapel vorhanden, Browser über "Karten ansehen"/"+ Neue Karte", Statistik und Archiv fehlen)
- [x] **Knopf "Optionen"** – Stapel-Optionen für aktuellen oder alle Stapel (render-anki.js:160; extras.js:674) — Kotlin: ✅ study/DeckDialogs.kt:DeckConfigDialog (Einstieg über Stapel-Menü)
- [ ] **Vollbild-Knopf (⛶)** – Blendet Seitenleiste und Tab-Leiste aus (render-anki.js:161, 406; app-click-anki.js:101; app-dialogs.js:152-155) — Kotlin: ⬜ – (kein Anki-Vollbild)
- [ ] **Menü "＋ Neu ▾"** (render-anki.js:162-167) — Kotlin: 🟡 study/StudyScreen.kt (nur "+ Neuer Stapel"; Neue Karte über study/CardBrowserScreen.kt:90)
  - [x] **Eintrag "Neue Karte"** – Frage & Antwort erstellen (render-anki.js:163) — Kotlin: ✅ study/CardBrowserScreen.kt ("+ Neue Karte")
  - [x] **Eintrag "Neuer Stapel"** – "Unterstapel per Eltern::Kind" (render-anki.js:164) — Kotlin: ✅ study/StudyScreen.kt:DeckDialog.New
  - [ ] **Eintrag "Import"** – TXT, CSV oder Anki-Paket (render-anki.js:165) — Kotlin: ⬜ – (kein Karten-Import)
  - [ ] **Eintrag "Export"** – TXT, CSV oder Anki-Paket (render-anki.js:166) — Kotlin: ⬜ – (kein Karten-Export)
- [x] **Lead-Satz** – "N Karten warten auf dich, etwa X Minuten." bzw. "Für heute ist alles gelernt." bzw. Leerhinweis; Karten-Zahl ist Startknopf (render-anki.js:254-257) — Kotlin: ✅ study/StudyScreen.kt:Lead (gleiche Sätze, Startknopf)
- [ ] **Modus "Feynman-Modus" (alle Stapel)** – Nur wenn Lernen möglich (render-anki.js:259-261) — Kotlin: ⬜ – (kein Feynman)
- [x] **Modus "Gemischt"** – Interleaved, fällige Karten aller Stapel gemischt (render-anki.js:262) — Kotlin: ✅ study/StudyScreen.kt:Gemischt-Knopf (ReviewScreen mix)
- [x] **Kennzahl "Heute fällig"** – Zahl plus "etwa X Min · Lernen starten" (Knopf), "✓ Alles gelernt", "Keine Karten" (render-anki.js:265-269) — Kotlin: ✅ study/StudyScreen.kt:Stats (alle drei Zustände)
- [x] **Kennzahl "Neue Karten"** – "im heutigen Tageslimit" (render-anki.js:271) — Kotlin: ✅ study/StudyScreen.kt:Stats
- [x] **Abschnitt "Deine Stapel"** (render-anki.js:272) — Kotlin: ✅ study/StudyScreen.kt ("Deine Stapel")
- [x] **Stapelliste** – Zeilen mit Einrückung, Kartenzahl und Ausgesetzte (render-anki.js:209-242) — Kotlin: ✅ study/DeckRow.kt + study/DeckTree.kt (flattenDecks)
- [ ] **Leerzustand Stapelliste** "Noch keine Stapel — über „＋ Neu“ einen anlegen" (render-anki.js:273) — Kotlin: 🟡 study/StudyScreen.kt:118 (anderer Wortlaut, Hinweis "+ Neuer Stapel")

### 11. Karte anlegen / bearbeiten (Editor)

- [x] **Titel "Neue Karte" / "Karte bearbeiten"** (render-anki.js:563) — Kotlin: ✅ study/CardEditorSheet.kt:94
- [x] **Stapel-Auswahl (Select)** – alle Stapel, "Standard" zuerst, Vorauswahl aktueller Stapel (render-anki.js:534-556, 524-531) — Kotlin: ✅ study/CardEditorSheet.kt (ExposedDropdownMenu)
- [x] **Eintrag "+ Neuer Stapel…"** – Blendet Namensfeld ein (render-anki.js:567, 569; Feld 569) — Kotlin: ✅ study/CardEditorSheet.kt:103, 107
- [x] **Vorderseite** (Textarea, Platzhalter "Frage…") (render-anki.js:571-572) — Kotlin: ✅ study/CardEditorSheet.kt:109 (Platzhalter gleich)
- [x] **Rückseite** (Platzhalter "Antwort…") (render-anki.js:573-574) — Kotlin: ✅ study/CardEditorSheet.kt:110
- [x] **Abschnitt "Cloze / Lückentext"** – Hinweistext (render-anki.js:575-576) — Kotlin: ✅ study/CardEditorSheet.kt:111-113
- [x] **Knopf "［…］ Lücke einfügen"** – Markierten Text als Lücke einwickeln (render-anki.js:578; extras.js:602-610) — Kotlin: ✅ study/CardEditorSheet.kt:116 (wrapCloze)
- [x] **Knopf "Als Cloze speichern"** – Eine Karte je Lücke; Fehler, wenn keine Lücke (render-anki.js:579; extras.js:611-621) — Kotlin: ✅ study/CardEditorSheet.kt:117-122 (Beschriftung "Als Lückentext speichern")
- [ ] **Speichern** – PWA: Pflicht ist die Vorderseite (app-click-anki.js, cardeditorsave) — Kotlin: 🟡 study/CardEditorSheet.kt:127 (Pflicht ist Vorder- ODER Rückseite)
- [x] **Abbrechen / ✕** (render-anki.js:583) — Kotlin: ✅ study/CardEditorSheet.kt:135
- [x] **Karte löschen im Editor** – In PWA nicht vorhanden (dort über Browser/Lernansicht) — Kotlin: ✅ study/CardEditorSheet.kt:138 (Android-Zusatz)
- [ ] **Cloze aus Seiten-Markierungen** – Erzeugt Karten aus markiertem Seitentext (extras.js:134-176) — Kotlin: ⬜ – (kein Gegenstück)

### 12. Lernansicht (Karten lernen)

- [ ] **Meta-Leiste** – Stapelname, Leech-Pille, Statuspille, Tooltip mit Wiederholungen, Fehlern, Intervall (render-anki.js:445-452) — Kotlin: ✅ study/ReviewParts.kt:CardMeta (Stapel, Leech, Status); 🟡 Tooltip mit Wdh./Fehler/Intervall fehlt
- [x] **Knopf "← Stapel" (Lernen beenden)** (render-anki.js:448) — Kotlin: ✅ study/ReviewParts.kt:ReviewHeader ("Stapel")
- [x] **Frage-Fläche** – Label "Frage", Markdown (render-anki.js:456-457) — Kotlin: ✅ study/ReviewParts.kt:CardFace
- [ ] **Knopf "Antwort zeigen"** – Oder Leertaste (render-anki.js:502-503; shortcuts.js:91-96) — Kotlin: ✅ study/ReviewParts.kt:RevealButton; ⬜ Leertaste (kein Tastatur-Handler)
- [x] **Trennlinie "Antwort"** (render-anki.js:460) — Kotlin: ✅ study/ReviewParts.kt:AnswerDivider
- [x] **Antwort-Fläche** (render-anki.js:461) — Kotlin: ✅ study/ReviewParts.kt:CardFace (Rückseite)
- [x] **Zählerzeile "neu · lernen · wdh."** (render-anki.js:393-398, 463) — Kotlin: ✅ study/ReviewParts.kt:QueueCounts
- [x] **Bewertungsknöpfe Nochmal / Schwer / Gut / Einfach** mit Intervall-Vorschau und Tastenhinweis (render-anki.js:464-469; srs.js:12-15) — Kotlin: ✅ study/ReviewParts.kt:GradeButtons (Vorschau-Liste; Tastenhinweise fehlen)
- [ ] **Tastenhinweise der Bewertung (1–4, ␣)** (render-anki.js:467-468) — Kotlin: ⬜ – (kein Tastatur)
- [x] **Knopf "Bearbeiten"** (render-anki.js:514) — Kotlin: ✅ study/ReviewParts.kt:StudyFooter ("Bearbeiten")
- [x] **Knopf "Aussetzen"** (render-anki.js:516) — Kotlin: ✅ study/ReviewParts.kt:StudyFooter; study/ReviewViewModel.kt:suspend
- [x] **Knopf "Optionen"** (render-anki.js:517) — Kotlin: ✅ study/ReviewParts.kt:StudyFooter → study/DeckDialogs.kt:DeckConfigDialog
- [x] **Rückgängig (letzte Bewertung)** – Android-Zusatz über Kopf-Icon; PWA-Entsprechung im Stapel-Optionsdialog (extras.js:475 btnDeckConfUndo) — Kotlin: ✅ study/ReviewParts.kt:ReviewHeader (Undo-Icon) + study/ReviewViewModel.kt:undo
- [x] **Fortschrittsbalken** – Android-Zusatz; PWA hat nur Zähler (ReviewScreen.kt) — Kotlin: ✅ study/ReviewScreen.kt (Extra)
- [ ] **Modus-Kopf "· gemischt" / "· Feynman"** (render-anki.js:403) — Kotlin: 🟡 study/ReviewParts.kt:ReviewHeader (gemischt ja, Feynman fehlt)
- [ ] **Feynman-Lernmodus (Erklärfeld, Diktieren, "Prüfen & aufdecken", "Ohne Erklärung aufdecken")** (render-anki.js:491-503; experimente.js:383-403) — Kotlin: ⬜ – (kein Feynman; Beta-Platzhalter settings/SettingsLearning.kt:50)
- [ ] **Selbsteinschätzung-Chips "Sicher / Unsicher / Geraten"** – Nur wenn Einstellung an (render-anki.js:477-483; telemetrie.js:155-158) — Kotlin: ⬜ – (Schalter in settings/SettingsLearning.kt:31-34 vorhanden, Chips in study/ReviewParts.kt fehlen)
- [ ] **Tastatur-Kürzel: ␣/Enter = Antwort zeigen bzw. Gut; 1–4 = bewerten** (shortcuts.js:91-106; app-dialogs.js:228-256) — Kotlin: ⬜ – (kein Tastatur-Handler in study/)
- [x] **Leech-Pille** (render-anki.js:450) — Kotlin: ✅ study/ReviewParts.kt:Pill("Leech")
- [x] **Haptik bei Bewertung** – Android-Zusatz (ReviewScreen.kt:…haptics) — Kotlin: ✅ study/ReviewScreen.kt
- [x] **Zustand "Gratulation!" (fertig für heute)** mit Knopf "Zurück zu den Stapeln" (render-anki.js:409-413) — Kotlin: ✅ study/ReviewParts.kt:ReviewDone ("Zur Stapelübersicht")
- [ ] **Zustand "Geschafft!" (Wartezustand)** mit Hinweis auf Lernkarten später heute, "Kurzzeitgedächtnis-Falle" und "Erneut prüfen" (render-anki.js:418-429) — Kotlin: 🟡 study/ReviewParts.kt:ReviewDone (Zeit der nächsten Karte, "Erneut prüfen"; Hinweis "Kurzzeitgedächtnis-Falle" fehlt)
- [x] **Zustand "Keine Karten fällig"** (render-anki.js:432-437) — Kotlin: ✅ study/ReviewParts.kt:ReviewDone
- [x] **Review-Overlay (Desktop-Dialog Lernen)** – Dialog mit Vorder/Rückseite, Bewerten, Bearbeiten, Aussetzen, Beenden (render.js:1760-1787; app.js:402-403) — Kotlin: ✅ study/ReviewScreen.kt (als Vollbild; kein Dialog)
- [x] **Startknopf "Gemischt" in Stapel-Übersicht** (siehe Abschnitt 10) — Kotlin: ✅ (siehe oben)

### 13. Kartenbrowser

- [x] **Suchfeld "Karten durchsuchen…"** – Filtert Vorder- und Rückseite (render-anki.js:309; 282) — Kotlin: ✅ study/CardBrowserScreen.kt (Platzhalter gleich)
- [x] **Stapel-Chips "Alle" und je Stapel** (render-anki.js:306-307) — Kotlin: ✅ study/CardBrowserScreen.kt:98-99
- [ ] **Sortierbare Spalten** – Vorderseite, Stapel, Status, Fällig, Intervall, Wdh., Fehler, Auf-/Absteigend (render-anki.js:311-320, 296-302) — Kotlin: ⬜ – (feste Sortierung nach Stapel und Fälligkeit, study/CardBrowserScreen.kt:79)
- [ ] **Gruppenzeile "Stapel: X"** – Bei Gesamtansicht vor jeder Stapelgruppe (render-anki.js:322-323) — Kotlin: ⬜ – (nur Stapelname in jeder Zeile)
- [x] **Vorderseite gekürzt auf 90 Zeichen, Klick öffnet Editor** (render-anki.js:325) — Kotlin: ✅ study/CardBrowserScreen.kt:CardRow (Klick öffnet Editor)
- [x] **Stapel-Spalte** (render-anki.js:326) — Kotlin: ✅ study/CardBrowserScreen.kt:meta
- [x] **Status-Spalte (Neu, Lernen, Neu lernen, Wiederholen, Ausgesetzt)** (render-anki.js:308, 327) — Kotlin: ✅ study/CardBrowserScreen.kt:meta
- [x] **Fällig-Spalte** (render-anki.js:328) — Kotlin: ✅ study/CardBrowserScreen.kt:meta (due)
- [ ] **Intervall-Spalte (in Tagen)** (render-anki.js:329) — Kotlin: ⬜ – (nicht in der Zeile)
- [ ] **Wdh.- und Fehler-Spalte** (render-anki.js:330-331) — Kotlin: ⬜ – (nicht in der Zeile; Leech-Hinweis ja)
- [x] **Zeilenaktion Bearbeiten (Stift)** (render-anki.js:333) — Kotlin: ✅ study/CardBrowserScreen.kt:CardRow-Menü "Bearbeiten"
- [x] **Zeilenaktion Aussetzen / Fortsetzen** (render-anki.js:334) — Kotlin: ✅ study/CardBrowserScreen.kt:CardRow-Menü
- [ ] **Zeilenaktion Archivieren** (render-anki.js:335) — Kotlin: ⬜ – (kein Karten-Archiv)
- [x] **Zeilenaktion Löschen (Papierkorb)** (render-anki.js:336) — Kotlin: ✅ study/CardBrowserScreen.kt:CardRow-Menü "In Papierkorb"
- [x] **Anzeigelimit 200 mit "N weitere Karten anzeigen" (+500)** (render-anki.js:304, 339; app-click-anki.js:ankimore) — Kotlin: ✅ study/CardBrowserScreen.kt:PAGE, "Mehr anzeigen (N weitere)"
- [x] **Leerzustände "Noch keine Karten — …" und "Keine Karten für diese Suche"** (render-anki.js:340) — Kotlin: ✅ study/CardBrowserScreen.kt:105 (Formulierung "Keine Karte gefunden")
- [x] **Knopf "+ Neue Karte"** (siehe Abschnitt 10) — Kotlin: ✅ study/CardBrowserScreen.kt:90
- [ ] **Stapelfilter-Knopf in Übersicht** (siehe Abschnitt 9) — Kotlin: 🟡 (siehe oben)

### 14. Karten-Import und -Export (Neu-Menü, Stapel-Tab)

- [ ] **Export-Dialog** – Auswahl Textdatei, CSV, Anki-Paket (.apkg) (extras.js:539-546; exportTxt 177; exportCsv 195; exportApkg 338) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Import-Dialog** – "Datei wählen…", "KI-Anweisung kopieren", ausklappbares "TXT-Format anzeigen" (extras.js:551-555) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Import-Vorschau** – Anzahl erkannter Karten, Checkbox "Duplikate ebenfalls importieren", Abbrechen/Importieren (extras.js:495-520; importCards 297-308) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Import-Formate** – TXT (parseImpalaTxt 251), CSV (parseCsv 201), Tabellen (parseTableCards 226), .apkg (importApkgFile 427) — Kotlin: ⬜ – (kein Gegenstück)

### 15. Archiv (Anki-Tab)

- [ ] **Abschnitt "Archiv"** mit Hinweistext "Archivierte Karten bleiben erhalten …" (render-anki.js:345-358, 355) — Kotlin: ⬜ – (kein Archiv-Screen für Karteikarten)
- [ ] **Archivierte Stapel mit "Wiederherstellen"** (render-anki.js:346-350) — Kotlin: ⬜ – (Archivieren ja, Wiederherstellen fehlt)
- [ ] **Einzelne archivierte Karten mit "Wiederherstellen"** (render-anki.js:352-354) — Kotlin: ⬜ – (kein Karten-Archiv)
- [ ] **Leerzustände "Keine archivierten Stapel" / "Keine einzeln archivierten Karten"** (render-anki.js:356-357) — Kotlin: ⬜ – (kein Gegenstück)

### 16. Statistik (Anki-Tab "Statistik") – jedes Diagramm und Kennzahl

Kennzahlen (anki-stats.js:127-136):
- [ ] **Trefferquote (30 Tage)** mit Trend-Hinweis, "ab 10 Abfragen" (anki-stats.js:132; 38-41, 128-131) — Kotlin: ⬜ – (kein Statistik-Screen; "Statistik" nur als Lernanalyse-Eintrag in more/MoreScreen.kt:60)
- [ ] **Wiederholungen (30 Tage)** mit Ø pro Tag (anki-stats.js:133) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Reife Karten** – Intervall ab 21 Tagen, "von N gelernten" (anki-stats.js:134, 78) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Denkzeit (Median pro Karte)** (anki-stats.js:135) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Lead-Satz zur Lage** (anki-stats.js:119-125; Leerzustand 120-121) — Kotlin: ⬜ – (kein Gegenstück)

Diagramme:
- [ ] **Lernbestand (gestapelter Balken)** – Neu / Lernen / Wiederholen / Ausgesetzt mit Legende und Anzahl (anki-stats.js:138-145) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Wiederholungen der letzten 30 Tage (Balkendiagramm)** mit Spitzenwert-Hinweis (anki-stats.js:147-152) — Kotlin: ⬜ – (Lernzeit-Balken ja, Wiederholungen nein; study/LearningTime.kt liefert nur Zeit)
- [ ] **Prognose nächste 7 Tage (Balken)** – "Heute" enthält Überfälliges (anki-stats.js:154-158, 95-102) — Kotlin: ⬜ – (nur "Heute fällig" in study/StudyScreen.kt:Stats)
- [ ] **Stapel-Tabelle** – Karten, Fällig, Reif (%), Trefferquote mit Meter; nur ab zwei Stapeln (anki-stats.js:160-169, 82-84) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Schwierigste Karten (Top 5 nach Vergessen)** mit Knopf Bearbeiten (anki-stats.js:171-181, 104-107) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Behalten nach Wiederholungsabstand (1 / 3 / 7 / 14 Tage)** als Tabelle (anki-stats.js:183-189) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Aktivitäts-Heatmap (53 Wochen, 5 Stufen)** mit Serie aktuell/längste (anki-stats.js:191-205; Stufen 200; Serie 203) — Kotlin: ⬜ – (Serie nur für Lernzeit in home/HomeState.kt; keine Heatmap)
- [ ] **Leerzustand "Noch keine Wiederholungen…"** (anki-stats.js:120) — Kotlin: ⬜ – (kein Gegenstück)

### 17. Lernanalyse im Statistik-Tab (lernmuster.js)

- [ ] **Abschnitt "Lern-Analyse" mit Hinweis "Beobachtungen … keine Regeln"** (lernmuster.js:200-205) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Sitzungsverlauf × Erfolg** – Tabelle nach Kartenabschnitten (1–10, 11–25, 26–40, 41+) mit Reviews und Trefferquote; mit/ohne Lerntimer (lernmuster.js:25-47; min 12 bzw. 15 Reviews) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Erfolgsquote nach Tageszeit (24 Balken)** – ab 60 Reviews, Stunden mit mind. 8 Reviews (lernmuster.js:50-66) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Problemzonen (viel Lesezeit)** – Top 5 Seiten ab 5 Minuten; Lesezeit, App-Wechsel, PDF-Kennzeichen; Knopf "＋ Karte" (lernmuster.js:90-107) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Knopf "＋ Karte" (KI-Karte aus Problemzone)** – Erzeugt eine Karte im Stapel "Problemzonen", Fallback-Text wenn KI fehlschlägt (lernmuster.js:108-123) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Experimente × Bewertung** – Tabelle Feynman / Hinweise / Variation / Quiz gegen "ohne Experimente" (lernmuster.js:180-197; ab 15 Reviews je Experiment) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Toast "Ehrlich bewerten hilft dem Planer."** (lernmuster.js:146-150) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Toast Pausenhinweis "5 Minuten Pause …"** (lernmuster.js:154-166) — Kotlin: ⬜ – (kein Gegenstück)

### 18. Lernanalyse auf der Startseite (lernanalyse.js)

- [ ] **Zugeklappte Kernaussage mit Aktionsknopf und Toggle "Lernanalyse"** (lernanalyse.js:192-199, 212-214; render.js:1017 homeAnalysisHtml) — Kotlin: ⬜ – (home/HomeScreen.kt:68 "folgt mit dem Lern-Modul")
- [ ] **Frage 1 "Schaffe ich das Wochenziel?"** – Text (Geschafft / bei Tempo am Tag X / es fehlen X pro Tag), Liniendiagramm mit Ziellinie und Prognose (lernanalyse.js:27-69, 216) — Kotlin: 🟡 home/HomeStats.kt:WeekStat (Fortschrittsbalken und Tagesbalken, keine Prognose, keine Ziellinie)
- [ ] **Frage 2 "Welche Fächer lassen nach?"** – Fächer mit Trefferquote-Meter, Vorher-Marke und Änderung, je Zeile Knopf "lernen" (lernanalyse.js:72-112, 217; Schwelle −8 Punkte, min 15 Wiederholungen) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Frage 3 "Wann lerne ich am besten?"** – Vier Tageszeiten (Morgens 5–12, Mittags 12–17, Abends 17–22, Nachts 22–5), Balken mit Beste-Markierung, dünn bei zu wenig Daten (lernanalyse.js:115-146, 218) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Frage 4 "Was kommt auf mich zu?"** – Sieben Tagesspalten mit Anzahl fälliger Karten, Spitzentag hervorgehoben (lernanalyse.js:149-175, 219) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Leerzustand Lernanalyse** – Analyse erscheint erst bei Lerndaten; Hinweistexte bei zu wenig Daten (lernanalyse.js:207-209, 81-84, 132-135, 163-165) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Knopf "Lernanalyse" im Menü "Mehr"** – Listet Eintrag "Lernanalyse · Zeiten & Statistiken" (Android-Gegenstück) — Kotlin: 🟡 more/MoreScreen.kt:60 (Eintrag da, Aktion ist Platzhalter-Toast in ui/shell/ShellNav.kt:action)

### 19. Lernzeit (lernzeit.js und Startseiten-Widget)

- [x] **Widget "Diese Woche gelernt"** – Zeit gegen Wochenziel, Fortschrittsbalken, Tagesbalken Mo–So, Streak-Zeile, Knopf "Ziel ändern" (home-view.js:144-149; render.js:1013-1021) — Kotlin: ✅ home/HomeStats.kt:WeekStat (Balken, Fortschritt, Streak, "Ziel ändern")
- [x] **Wochenziel-Stufen** – 2 h, 5 h, 8 h, 12 h; Toast "Wochenziel: X h" (lernzeit.js:361-369; Presets 363) — Kotlin: ✅ home/HomeViewModel.kt (cycleGoal) + home/HomeScreen.kt:171; settings/SettingsLearning.kt:WeekGoalRow
- [ ] **Satz "Heute schon X gelernt" / "Nur noch X bis zum Wochenziel" / "Ziel geschafft"** (home-view.js:87-92) — Kotlin: 🟡 home/HomeState.kt:110-112 (Sätze ähnlich, ohne Streak-Warnung nach 14 Uhr)
- [ ] **Satz zur Projektion "Bei deinem Tempo schaffst du es …"** (lernanalyse.js:41-46) — Kotlin: ⬜ – (kein Gegenstück)
- [x] **Streak "N Tage am Stück"** – Tage mit mind. 5 Minuten; heutiger leerer Tag bricht nicht (lernzeit.js:349-360) — Kotlin: ✅ study/LearningTime.kt:streakDays + home/HomeStats.kt:WeekStat
- [ ] **Lernzeit-Erfassung (Sitzungen, Segmente, Kategorie Chat/Karten/Heft/Notiz, Fach)** – Aktiv nur bei Chat, Kartenlernen, Heft- und Notizseiten; Sitzung endet nach 15 Minuten Pause (lernzeit.js:61-130; categoryNow 61-72; persistCurrent 97-114 schreibt learningSessionUpsert) — Kotlin: ⬜ – (study/LearningTime.kt liest nur; keine Schreibaufrufe gefunden)
- [x] **Doppelzählung-Schutz (Intervall-Vereinigung)** – Überlappende Segmente zählen einmal (lernzeit.js:265-288) — Kotlin: ✅ study/LearningTime.kt:mergedSeconds
- [ ] **Lerntimer (Pomodoro)** – Dauer 5 bis 240 Minuten, Standard 25; Ende zeigt "Lernblock geschafft" mit "5 Min weiter" / "Pause machen" (lernzeit.js:177-195, 197-211, 181) — Kotlin: ⬜ – (kein Timer; in PWA gibt es außerdem keinen sichtbaren Startknopf, nur den Abschluss-Dialog)
- [ ] **Pausen-Erinnerung nach 40 Minuten** – Dialog "Zeit für eine kurze Pause?" mit "5 Min Pause" / "Weiterlernen" (lernzeit.js:165-175, 250-253; 401-426) — Kotlin: 🟡 settings/SettingsLearning.kt (Schalter "Pausen-Erinnerung" ohne Logik; DevicePrefs.breakReminder)
- [ ] **Tierchen "Lernst du noch?"** – Nach 60 Sekunden ohne Eingabe in Chat, Kartenlernen oder Heft; Klick oder Hover setzt fort (lernzeit.js:152-163, 143-150; lernzeit-context.js) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Lernzeit pausiert bei verstecktem Tab und Einstellungen** (lernzeit.js:391-399, 57-59) — Kotlin: ⬜ – (keine Erfassung)
- [ ] **Leerzustand Wochenziel** – "Sobald du ein paar Tage gelernt hast, steht hier …" (lernanalyse.js:198) — Kotlin: ⬜ – (kein Gegenstück)

### 20. Fächer (fach.js)

- [ ] **Liste der 20 bekannten Fächer** (Mathematik, Deutsch, Englisch, Physik, Chemie, Biologie, Geschichte, Geografie, Informatik, Wirtschaft, Kunst, Musik, Religion/Ethik, Französisch, Spanisch, Latein, Sport, Elektrotechnik, Maschinenbau, Politik) (fach.js:9-30) — Kotlin: ⬜ – (kein Fach-Modul)
- [ ] **Sonderkategorien "Sonstiges" und "Übersicht"** (fach.js:35-36, 36; Zuordnung) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Fach-Zuordnung je Seite** – Reihenfolge: manuell, vom Elternteil geerbt, Titel, Sammelseite, Kinder-Abstimmung, Inhalt/Embedding, Workspace, sonst Sonstiges (fach.js:623-667) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Fach-Zuordnung je Stapel** – über Stapelwurzel (fach.js:679-694) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Fach-Kontext je Karte/Bewertung** (fach.js:696-708; review-Payload subject in app-dialogs.js:200-230) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Fach-Eintrag im Seitenmenü "Fach: X…"** (render.js:572; app-click-pages.js:121-125 öffnet Fach-Dialog) — Kotlin: ⬜ – (kein Fach-Eintrag gefunden)

### 21. Schulnoten (schulnoten.js)

- [ ] **Abschnitt "Schulnoten" mit Kopf** (schulnoten.js:83-86) — Kotlin: ⬜ – (kein Schulnoten-Modul; Suche nach "Noten" ohne Treffer)
- [ ] **Gesamtschnitt im Kopf** (schulnoten.js:82, 85) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Knopf "↓ Markdown" (Export schulnoten.md)** (schulnoten.js:59-69, 86, 135-139) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Eingabeformular: Fach** (schulnoten.js:88) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Eingabeformular: Note 1–6, Schritt 0,1** (schulnoten.js:89; Prüfung 42-43) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Eingabeformular: Gewichtung 0,25–20, Standard 1** (schulnoten.js:90; 49) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Eingabeformular: Datum, Standard heute** (schulnoten.js:91; 50) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Eingabeformular: Kommentar (optional)** (schulnoten.js:92) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Knopf "＋ Eintragen"** und Toast "Note eingetragen." (schulnoten.js:93, 120) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Fachkarte mit Name und farbigem Ø (2 Nachkommastellen)** (schulnoten.js:98-100) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Notentabelle je Fach: Note (farbig), Gewichtung, Datum, Kommentar** (schulnoten.js:101-103) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Löschen je Note (Papierkorb-Icon, Toast "Note gelöscht.")** (schulnoten.js:104, 128-133) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Notenfarben (5 Stufen von Grün bis Rot)** (schulnoten.js:71-77) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Leerhinweis "Trag die erste Note ein — der gewichtete Schnitt erscheint sofort."** (schulnoten.js:96) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Synchronisation über gradeAdd / gradeDelete** (schulnoten.js:40-57) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Öffnen des Noten-Tabs** (schulnoten.js:163-169; render.js:651 Ansicht "noten") — Kotlin: ⬜ – (kein Gegenstück)

### 22. Leere und Ausnahmezustände (zusammengefasst)

- [x] **Chat leer (Begrüßung und Vorschläge)** — Kotlin: ✅ ai/ChatView.kt:EmptyChat
- [x] **Keine gespeicherten Chats** — Kotlin: ✅ ai/ChatList.kt
- [ ] **Keine Stapel** — Kotlin: 🟡 study/StudyScreen.kt:118 (anderer Wortlaut)
- [ ] **Keine fälligen Karten / Gratulation / Geschafft** — Kotlin: ✅ study/ReviewParts.kt:ReviewDone (Wartezustand mit Kurzzeit-Hinweis 🟡)
- [x] **Browser leer / keine Treffer** — Kotlin: ✅ study/CardBrowserScreen.kt:105
- [ ] **Statistik leer** — Kotlin: ⬜ – (kein Statistik-Screen)
- [ ] **Archiv leer** — Kotlin: ⬜ – (kein Karten-Archiv)
- [ ] **Lernanalyse "zu wenig Daten"** — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Wochenziel "Sobald du …"** — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Schulnoten leer** — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Fehler-Zustand Karteikarten-Ansicht (Neuladen-Hinweis)** (render-anki.js:176-187) — Kotlin: 🟡 study/ReviewScreen.kt (eigener Fehlerdialog "Das hat nicht geklappt", kein Neuladen-Hinweis)

### 23. Zusätzlich gefunden (außerhalb des Auftrags, aber in Lernansicht und Chat)

- [ ] **Experiment "Hinweis" (3 Stufen)** – Knopf an der Karte, zählt Hinweise, Hinweis-Honesty-Text (experimente.js:186-216, 188, 304) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Experiment "Als Quiz" (Distraktor-Quiz)** – Modal mit Optionen (experimente.js:189, 313-324) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Experiment "Variation"** – Knopf "Original zeigen" (experimente.js:252) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Experiment "Feynman starten"** – Knopf "Erst erklären" an normalen Karten (experimente.js:186) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Fehler-Detektor** – Einstellbereich mit Start-Knopf und Auflösung (experimente.js:113, 524-541) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Pre-Testing bei PDFs** (experimente.js:563-580) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **"Und warum?"-Dialog** (experimente.js:481-493) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Strg/⌘+Enter prüft Feynman-Erklärung** (experimente.js:383-386) — Kotlin: ⬜ – (kein Gegenstück)
- [ ] **Tastatur: Escape schließt Overlay / Sprachaufnahme / Befehlsmenü** (shortcuts.js:59-75) — Kotlin: 🟡 (Zurück-Geste; keine Tastatur-Kürzel)
- [ ] **Tastatur: Strg/⌘+K öffnet Befehlsmenü** (shortcuts.js:84-89) — Kotlin: ⬜ – (Suche in ui/shell/… vorhanden, Kürzel nicht)
- [ ] **Controller/Gamepad-Lernen** (Beta-Platzhalter) — Kotlin: ⬜ – (settings/SettingsLearning.kt:55-56 Platzhalter)

### 24. Stub- und Totpfade in der PWA (nicht als Vorlage nachbauen)

- [ ] **@-Erwähnung** – nur Toast (app-click-buttons.js:119-122) — Kotlin: – (nicht umsetzen)
- [ ] **Sprachausgabe** – im Code aus (voice.js:16) — Kotlin: – (nicht umsetzen)
- [ ] **Eigenes-Modell-Eingabe und Thinking-Probe** – Handler ohne Markup (app-click-chat.js:53-62, 133-155) — Kotlin: – (nicht umsetzen)
- [ ] **Alle Chats löschen in Einstellungen** – In PWA umgesetzt, in Kotlin nur Platzhalter (settings/SettingsApp.kt:60)

### 25. Kotlin-Zusatzfunktionen ohne PWA-Gegenstück (zur Information)

- [x] **Rückgängig-Icon in der Lernansicht** — Kotlin: ✅ study/ReviewParts.kt (PWA nur in Optionen-Dialog)
- [x] **Fortschrittsbalken in der Lernansicht** — Kotlin: ✅ study/ReviewScreen.kt
- [x] **Haptik bei Bewertung** — Kotlin: ✅ study/ReviewScreen.kt
- [x] **Stapel-Optionen "Zurücksetzen"** — Kotlin: ✅ study/DeckDialogs.kt:123
- [x] **Karte löschen im Editor** — Kotlin: ✅ study/CardEditorSheet.kt:138
- [x] **Stapel "Karten ansehen" im Menü** — Kotlin: ✅ study/DeckRow.kt

### Hinweise für die Umsetzung in Kotlin

- Die größten fehlenden Blöcke sind: Anhänge (Foto, PDF, Textdatei, Heft-Seite, Seitenkontext-Chip), Modellwahl (Menü, Denkaufwand), Sprache (Diktat), Statistik-Tab mit allen Diagrammen, Lernanalyse (Startseite und Statistik), Lernzeit-Erfassung und Timer, Fächer-Modul, Schulnoten, Karten-Import/-Export, Archiv-Wiederherstellung, Feynman- und Experiment-Modi.
- Kotlin-Dateien, die bereits Anknüpfungspunkte bieten: ai/AiChatViewModel.kt (Anhänge und Modelloptionen sind im Anfragetyp bereits vorgesehen, werden aber mit null belegt), ai/ChatParts.kt (Nachrichtenarten), study/ReviewParts.kt (Bewertung und Zähler), study/CardEditorSheet.kt (Cloze-Funktionen vorhanden), home/HomeStats.kt (Wochenziel-Balken).
- Alle Pfade oben sind absolut ableitbar: PWA-Dateien unter `/home/jv232/Documents/Codex/2026-08-22/ka/Impala67/web/`, Kotlin-Dateien unter `/home/jv232/Documents/Codex/2026-08-22/ka/Impala67/android/app/src/main/java/org/impala67/app/`.


---

# 5. Einstellungen, Sync, Backup, Werkzeuge


**Basis:** Web-Pfade relativ zu `/home/jv232/Documents/Codex/2026-08-22/ka/Impala67/`. Android-Dateien liegen in `android/app/src/main/java/org/impala67/app/` (Unterordner `settings/`, `sync/`, `more/` sowie `study/`, `notes/`, `ui/desk/`, `editor/`, `ai/`, `home/`).

**Lesehinweis:** `settings.js` (1259 Z.) und `settings-renderer.js` (517 Z.) wurden in Bereichen gelesen (Renderer komplett in drei Ausschnitten, `settings.js` gezielt über Handler). `telemetrie.js` (420 Z.) in drei Ausschnitten. `experimente.js`, `extras.js`, `tools.js`, `performance-profiler.js`, `updater.js`, `drive.js`, `sync-cloudflare.js` über Grep plus Ausschnitte. Die Kleindateien wurden komplett gelesen. Das Controller-Modul (`controller:settings-html`) liegt nicht im Auftrag und ist nur als Verweis erfasst.

Legende: ✅ vorhanden wie PWA · 🟡 teilweise oder abweichend · ⬜ fehlt. "Std" = Standardwert laut Code.

---

### 1. Shell, Navigation, Suche

- [x] **Bereichsnavigation (6 Bereiche)** – Übersicht, Darstellung, KI, Lernen, Sync & Backup, App & Speicher (web/settings-schema.js:5-12) — Kotlin: ✅ settings/SettingsScreen.kt (SettingsSections, gleiche Labels/Beschreibungen)
- [x] **Alias-Auflösung alter Bereichs-IDs** – z. B. drive/backup→sync, update/storage→app, devices/controller→learning (web/settings-schema.js:15-20, 73-77) — Kotlin: ✅ settings/SettingsState.kt (Zuordnung vorhanden)
- [x] **Desktop-Layout Seitenleiste + Detailbereich** – nav + main (web/settings-renderer.js:447-469) — Kotlin: ✅ ui/shell/Destinations.kt (ListDetail-Szene) + settings/SettingsScreen.kt
- [x] **Mobiler Hub mit Bereichsliste und Zurück-Knopf** – (web/settings-renderer.js:83-91, 449-466) — Kotlin: ✅ settings/SettingsScreen.kt (Telefon: Liste allein)
- [ ] **Suchfeld „Einstellungen suchen…“ mit ⌘K und Trefferliste (max. 8)** – (web/settings-renderer.js:456-458, 467-476; web/settings.js:1081-1100) — Kotlin: ⬜ keine Suche gefunden
- [ ] **Suchindex (40 Einträge, plattformabhängig native/web, Gewichtung)** – (web/settings-schema.js:27-68, 79-90) — Kotlin: ⬜ kein Index/keine Suche
- [ ] **Speichern-Leiste „Nicht gespeicherte Änderungen“ (Verwerfen/Speichern)** – (web/settings-ui.js:66-67; web/settings.js:921-961) — Kotlin: 🟡 settings/SettingsAiSync.kt (nur „Eigene Anweisungen“ hat Speichern-Knopf; keine Sammel-Leiste)
- [ ] **Dialog „Änderungen verwerfen?“ beim Schließen mit ungespeicherten Änderungen** – (web/settings.js:154-172) — Kotlin: ⬜ nicht gefunden
- [ ] **Schließen per Esc und Schließen-Knopf** – (web/settings.js:1081-1100; web/settings-renderer.js:453, 468) — Kotlin: 🟡 settings/SettingsScreen.kt (Schließen über Systemnavigation, kein Esc-Pfad eigens geprüft)
- [ ] **Letzter Bereich wird gemerkt** – localStorage `impala67SettingsLastSection` (web/settings-schema.js:3; web/settings.js:208-213) — Kotlin: ⬜ nicht gefunden

### 2. Übersicht (Status-Kacheln)

- [ ] **Kachel „KI“** – Modellname oder „Noch kein Modell gewählt“, Statuspunkt, Link Konfigurieren/Einrichten → Bereich KI (web/settings-renderer.js:70) — Kotlin: ⬜ settings/SettingsApp.kt (OverviewSettings: Platzhalter „Folgt mit dem KI-Modul“)
- [ ] **Kachel „Sync“** – Cloudflare hat Vorrang vor Drive; Texte „Cloudflare Live-Sync aktiv“, „Google Drive · <Mail>“, „Noch nicht eingerichtet“; Link Verwalten/Einrichten (web/settings-renderer.js:52-60, 71) — Kotlin: ⬜ settings/SettingsApp.kt (Platzhalter „Folgt mit dem Sync-Modul“)
- [ ] **Kachel „Backup“** – letztes lokales Backup oder „Noch kein lokales Backup“, Button „Backup erstellen“/„Backup erneut erstellen“ (web/settings-renderer.js:72; web/settings-action-state.js:22-25) — Kotlin: ⬜ settings/SettingsApp.kt (Platzhalter)
- [ ] **Kachel „Speicher“** – Text „Wird berechnet …“, Fortschrittsbalken, Link Verwalten → App & Speicher (web/settings-renderer.js:73) — Kotlin: ⬜ settings/SettingsApp.kt (Platzhalter)
- [ ] **Kachel „App-Version“** – „v<x> · Offline-App“ mit Update-Knopf (web/settings-renderer.js:74) — Kotlin: 🟡 settings/SettingsApp.kt (Version ✅, Update-Knopf fehlt)
- [ ] **Statuspunkt je Kachel (ok/idle/warn)** – (web/settings-renderer.js:28, 44, 48) — Kotlin: ⬜ (nur bei Sync-Kachel-Ersatz relevant; Platzhalter)

### 3. Darstellung (Bereich „appearance“)

- [x] **Erscheinungsbild** – Segment: System | Hell | Dunkel; Std: System (web/settings.js:61-62 `impala67FollowSystemTheme` ≠ "0"; Fallback-Modus dunkel web/settings.js:69); Beschreibung „Folgt automatisch deinem Gerät“ / „Manuell festgelegt“ (web/settings-renderer.js:95-101; web/settings.js:1122-1132) — Kotlin: ✅ settings/SettingsAppearance.kt (ThemeMode SYSTEM/LIGHT/DARK)
- [x] **Akzentfarbe** – 4 Kreisbuttons: Blau (Std), Violett, Grün, Orange; Hell/Dunkel-Farbwerte in ACCENT_THEMES (web/settings.js:47-52, 88; web/settings-renderer.js:96-102) — Kotlin: ✅ settings/SettingsAppearance.kt (AccentRow, AccentSwatch)
- [x] **Darstellungsdichte** – Kompakt (Std) | Komfortabel (web/settings.js:86; web/settings-renderer.js:103-105) — Kotlin: ✅ settings/SettingsAppearance.kt
- [x] **Schriftgröße** – Klein | Normal (Std) | Groß; „Gilt appweit“ (web/settings.js:99; web/settings-renderer.js:106-108) — Kotlin: ✅ settings/SettingsAppearance.kt
- [x] **Performance-Modus („Bewegung reduzieren“)** – Schalter, Std aus; ohne Animationen, Milchglas und Handschrift-Erkennung (web/settings-renderer.js:109; web/settings.js:87, 96) — Kotlin: ✅ settings/SettingsAppearance.kt (Titel „Performance-Modus“)
- [x] **Haptisches Feedback** – Schalter, Std an; nur nativ (web/settings-renderer.js:110; web/settings.js:188) — Kotlin: ✅ settings/SettingsAppearance.kt
- [ ] **Tab-Anordnung** – Oben (Std) | Seitenleiste (web/settings-renderer.js:111-113; web/settings.js:97) — Kotlin: 🟡 entfällt bewusst (Android: Navigationsleiste oder Seitenleiste je Gerät, Kommentar in settings/SettingsAppearance.kt)
- [x] **Begrüßungsname** – Textfeld, Std leer, Platzhalter „Optional“; speichert bei Änderung („Name gespeichert.“) (web/settings-renderer.js:114; web/settings.js:1063-1066) — Kotlin: ✅ settings/SettingsAppearance.kt (SettingsTextField, saveUserName)
- [x] **Tagesartikel (Schalter)** – Std an; KI-Zusammenfassung auf der Startseite (web/settings-renderer.js:115; web/settings.js:1077) — Kotlin: ✅ settings/SettingsAppearance.kt
- [x] **Verwandte Seiten (Schalter)** – Std an; bis zu 3 ähnliche Seiten unter jeder Notiz, braucht Embedding (web/settings-renderer.js:116; web/settings.js:1078) — Kotlin: ✅ settings/SettingsAppearance.kt
- [x] **Themen für den Tagesartikel (Textfeld)** – Std leer, Platzhalter „Automatisch“; kommagetrennt; leer = aktive Fächer (web/settings-renderer.js:117; web/settings.js:1068-1074, 1079) — Kotlin: ✅ settings/SettingsAppearance.kt
- [ ] **Vorschlags-Chips „+ <Fach>“ unter den Themen (max. 8)** – (web/settings-renderer.js:124-128; web/settings.js:1068-1074) — Kotlin: ⬜ (TODO im Code vermerkt)

### 4. KI (Bereich „ai“)

- [ ] **Aktives Modell (Anzeige + „Neu laden“)** – Std: kein Modell; Button „Neu laden“ (web/settings-renderer.js:131-137; web/settings.js:735-766) — Kotlin: ⬜ settings/SettingsAiSync.kt (Platzhalter „Folgt mit dem KI-Modul“)
- [ ] **Modell-Suche (Filter, Zähler „N von M“/„N Modelle“)** – web/settings-renderer.js:137, 166-169 — Kotlin: ⬜
- [ ] **Modellliste mit Favoriten (★/☆), Gruppen je Quelle, „Gespeichert“, Offline-Vorschläge** – (web/settings-renderer.js:154-213; `data-modelset`, `data-modelfav`) — Kotlin: ⬜
- [ ] **Manuelle Modell-ID (Disclosure) mit Quellen-Auswahl und „Übernehmen“** – (web/settings-renderer.js:138; web/settings.js:767-780) — Kotlin: ⬜
- [ ] **KI-Quellen: pro Quelle Name, Server-URL, API-Key (Passwortfeld, nur lokal), „Verbindung testen“, „Entfernen“** – (web/settings-renderer.js:141-149; web/settings.js:782-804) — Kotlin: ⬜
- [ ] **„Quelle hinzufügen“** – Std: neue Quelle „Neue Quelle“ (web/settings-renderer.js:150; web/settings.js:632-643) — Kotlin: ⬜
- [ ] **Schnellvorlagen: Impala AI, LM Studio, Gemini, OpenAI** – URLs laut web/extras.js:657-661 (Impala AI: Cloudflare-Worker; LM Studio: localhost:1234/v1; Gemini: generativelanguage…/openai; OpenAI: api.openai.com/v1) — Kotlin: ⬜
- [ ] **Semantische Suche (Bekko a8m) – Status und Aktion** – Zustände: Download erforderlich / Download fortsetzen / Im Cache, nicht aktiviert / Bereit; Std Größe ca. 165 MB; Buttons „Herunterladen (ca. 165 MB)“, „Für Suche aktivieren“, „Modell löschen“ (web/settings-renderer.js:215-245, 247-260; web/settings.js:842-919) — Kotlin: ⬜ settings/SettingsAiSync.kt (Platzhalter)
- [ ] **Fortschrittsbalken für Modell-Download** – (web/settings-renderer.js:257) — Kotlin: ⬜
- [ ] **Handschrifterkennung (Digital Ink) – Status, Trainingsbeispiel-Zähler, Quellenangaben** – 100 % lokal, ca. 10 MB ONNX; Indexfortschritt live (web/settings-renderer.js:264-273; web/settings.js:1254-1259) — Kotlin: ⬜ (Platzhalter „Folgt mit dem Heft-Modul“)
- [ ] **Button „Abschreiben“ (Öffnet Abschreib-Werkzeug)** – (web/settings-renderer.js:276) — Kotlin: ⬜
- [ ] **Button „Alle Handschrift exportieren“** – (web/settings-renderer.js:277; web/settings.js:1164-1175) — Kotlin: ⬜
- [ ] **Buttons „Exportieren“ und „Leeren“ für Trainingsbeispiele (nur wenn vorhanden) mit Bestätigung** – (web/settings-renderer.js:278-280; web/settings.js:1152-1181) — Kotlin: ⬜
- [x] **Tools mitsenden (Schalter)** – Std an; der KI die App-Werkzeuge anbieten (web/settings-renderer.js:288; web/settings.js:956) — Kotlin: ✅ settings/SettingsAiSync.kt (vm.setAlwaysSendTools)
- [x] **Eigene Anweisungen (mehrzeilig, 5 Zeilen)** – Std leer, Platzhalter „Optional“, Hilfstext „Tonfall, Fach und dauerhafte Vorlieben“ (web/settings-renderer.js:289; web/settings.js:955) — Kotlin: ✅ settings/SettingsAiSync.kt (CustomInstructionsField, Speichern erscheint bei Änderung)
- [ ] **KI-Status-Banner oben im Bereich** – (web/settings-renderer.js:291 `aiStatusSettings`; web/settings.js:34 checkAI) — Kotlin: ⬜

### 5. Lernen (Bereich „learning“, Lernverhalten)

- [x] **Overlearning-Sperre (Schalter)** – Std an; verhindert sofortiges Wiederholen frisch bewerteter Karten (web/settings-renderer.js:300; localStorage impala67Overlearn) — Kotlin: ✅ settings/SettingsLearning.kt (prefs.overlearn)
- [x] **Selbsteinschätzung abfragen (Schalter)** – Std aus; Beschreibung wechselt zwischen „Du bewertest deine Sicherheit bewusst“ und „Die App schätzt Sicherheit aus der Antwortzeit“ (web/settings-renderer.js:301; impala67Confidence) — Kotlin: ✅ settings/SettingsLearning.kt
- [x] **Lernanalyse aufzeichnen (Schalter)** – Std an; Lernzeiten und Bewertungen nur lokal/eigene Geräte (web/settings-renderer.js:302; web/telemetrie.js:71 `impala67Telemetry`) — Kotlin: ✅ settings/SettingsLearning.kt
- [x] **Pausen-Erinnerung (Schalter)** – Std an; nach 40 Minuten Lernen (web/settings-renderer.js:303; web/settings.js:115-124, Schlüssel `impala67BreakReminder`) — Kotlin: ✅ settings/SettingsLearning.kt (prefs.breakReminder)
- [ ] **Wochenziel (Stunden-Button, zyklisch)** – nur Android; in der PWA auf der Startseite (lernzeit.js, nicht in dieser Seite) — Kotlin: 🟡 settings/SettingsLearning.kt (Abweichung: in PWA-Einstellungen nicht vorhanden, Kommentar „Bestand, bitte prüfen“)
- [ ] **Beta-Lernfunktionen (Bereich mit Hinweis „standardmäßig aus“)** – Inhalt = Experimente-Schalter (siehe Abschnitt 6) (web/settings-renderer.js:304, 307-308) — Kotlin: ⬜ settings/SettingsLearning.kt (Platzhalter)
- [ ] **Mit Controller lernen (Aufklappbereich)** – Gamepad, Tastenhinweise, Vibration, Tastenbelegung (web/settings-renderer.js:305, 309) — Kotlin: ⬜ (Platzhalter; Controller-Modul nicht Teil dieses Inventars)

### 6. Experimente (Beta-Lernfunktionen, web/experimente.js)

Alle sieben Schalter Std **aus** (web/experimente.js:111 `on()` = !!Flag). Änderung sofort gespeichert (settingsSet, Toast „Experiment aktiviert/deaktiviert“), Katalog web/experimente.js:36-42.

- [ ] **Elaborative Interrogation (Schalter, data-expflag=elaboration)** – nach ca. jeder 4. gut beantworteten Karte fragt die KI „Und warum?“ (web/experimente.js:36-42, 111) — Kotlin: ⬜
- [ ] **Fragen-Variation (Schalter, variation)** – jede 3. Wiederholung mit umformulierter Vorderseite, lokaler Cache (web/experimente.js:36-42) — Kotlin: ⬜
- [ ] **Gestufte Hinweise (Schalter, scaffolding)** – Kategorie → Struktur → Eselsbrücke nach dem ersten Abrufversuch (web/experimente.js:36-42) — Kotlin: ⬜
- [ ] **Distraktor-Quiz (Schalter, mc)** – Multiple Choice mit plausiblen Falschantworten, Auflösung sofort (web/experimente.js:36-42) — Kotlin: ⬜
- [ ] **Fehler-Detektor (Schalter, fehler) + Knopf „Fehler-Detektor jetzt starten“** – Knopf nur aktiv, wenn Schalter an (web/experimente.js:113, 36-42, Aufruf data-expfehler) — Kotlin: ⬜
- [ ] **Pre-Testing bei PDFs (Schalter, pretest)** – Vorab-Fragen nach PDF-Import, „Musterantworten zeigen“ (web/experimente.js:36-42, 563-580) — Kotlin: ⬜
- [ ] **Wissenslücken-Detektor (Schalter, wissensluecken)** – Chat-Werkzeug „Prüfe meine Notiz zu X auf Lücken“ (web/experimente.js:36-42, 587 ff.) — Kotlin: ⬜
- [ ] **Feynman-Modus** – kein Schalter mehr, regulärer Lernmodus; Start über „Erst erklären“ je Karte und Stapel (web/experimente.js:28-34; web/render-anki.js) — Kotlin: 🟡 study/CardEditorSheet.kt bzw. study/ReviewParts.kt (nicht als eigener Schalter; Erklärfunktion nicht einzeln geprüft)
- [ ] **Kartenbuttons der Experimente (Erst erklären, Hinweis, Als Quiz, KI-Vorschlag-Badge, Diktieren, „Von der KI prüfen lassen“, „Original zeigen“, Prüfen/Überspringen, Auflösung zeigen)** – (web/experimente.js:186-189, 210, 252, 324, 402-403, 492-493, 534, 572-576) — Kotlin: ⬜ (nicht gefunden)
- [ ] **Experimente-Modal (Titel + Schließen-Knopf)** – (web/experimente.js:88-98) — Kotlin: ⬜

### 7. Sync: Cloudflare Live-Sync (Bereich „sync“)

- [ ] **Statuskarte (Punkt, Titel, Beschreibung)** – Titel aus sync-cloudflare.js: „Nicht eingerichtet“ (Std), „Getrennt“, „Verbindung wird aufgebaut…“, „Live verbunden“, „Synchronisiert“, „Synchronisiere…“, „Verbindung unterbrochen“ (Wiederholung in N s), „Nicht autorisiert“, „Einrichtungsfehler“, „Sync-Fehler“, „Migration fehlgeschlagen“ (web/sync-cloudflare.js:66-67, 149-150, 170-172, 190, 227, 297, 303, 351, 365, 374, 432; web/settings-renderer.js:329-330, 342) — Kotlin: 🟡 settings/SettingsCloudflare.kt (StatusBlock ✅; Zustände CONNECTING/CONNECTED/SYNCING/ERROR/DISCONNECTED, Texte „Verbinde …“, „Verbunden“, „Synchronisiert“, „Fehler“, „Abgewiesen“, „Getrennt“, Wiederholungs-Hinweis nicht gefunden)
- [ ] **Hauptknopf (Verbinden / Verbinden & Synchronisieren / Cloudflare synchronisieren / Cloudflare erneut verbinden / „…synchronisiert…“ deaktiviert)** – (web/settings-action-state.js:13-20; web/settings-renderer.js:343; web/settings.js:367-386) — Kotlin: 🟡 settings/SettingsCloudflare.kt (nur „Verbinden“ bzw. „Jetzt synchronisieren“; Zwischenzustände und „erneut verbinden“ fehlen)
- [x] **Trennen (nur bei verbunden/verbindet)** – trennt, löscht Schlüssel lokal (web/settings-renderer.js:344; web/settings.js:388-394; web/sync-cloudflare.js:369-374) — Kotlin: ✅ settings/SettingsCloudflare.kt (cloud.disconnect; Schlüssel-Löschung nicht geprüft)
- [x] **Fortschrittsbalken mit Label und Prozent (nur während Sync)** – (web/settings-renderer.js:331-341; web/sync-cloudflare.js:84-87) — Kotlin: ✅ settings/SettingsCloudflare.kt (ProgressBlock)
- [x] **Feld „Cloudflare Worker URL“** – Std leer; Platzhalter https://impala67-sync.<account>.workers.dev (web/settings-renderer.js:347) — Kotlin: ✅ settings/SettingsCloudflare.kt
- [x] **Feld „Sync-Schlüssel (E2EE)“** – Passwortfeld; Std leer; Platzhalter impala-xxxx-xxxx-xxxx-xxxx (web/settings-renderer.js:348) — Kotlin: ✅ settings/SettingsCloudflare.kt (PasswordVisualTransformation)
- [ ] **Knopf „QR-Code scannen“** – öffnet Kamera-Scanner (web/settings-renderer.js:350; web/settings.js:444-466) — Kotlin: 🟡 settings/SettingsCloudflare.kt (Google-Codescanner statt eigenem Kamera-Dialog mit Fotoimport)
- [x] **Knopf „Gerät koppeln (QR-Code)“ (nur wenn URL und Schlüssel gesetzt)** – (web/settings-renderer.js:351; web/settings.js:396-442) — Kotlin: ✅ settings/SettingsCloudflare.kt (CfPairingDialog, nur bei URL+Schlüssel)
- [ ] **Dialog „Gerät automatisch koppeln“ mit QR-Code, Kopplungs-Link kopieren, Schließen** – Link = aktuelle App-URL + `#cf-pair=<Base64 JSON>` (web/settings.js:396-442; web/qrcode.js:467) — Kotlin: 🟡 settings/CloudflarePairing.kt (QR und Kopieren ✅; Basis-URL fest auf den Github-Pages-Pfad statt aktueller Origin)
- [x] **Knopf „Schlüssel generieren“ (nur ohne Schlüssel)** – erzeugt Schlüssel, Feld kurz im Klartext (5 s), Toast „Neuer Sync-Schlüssel generiert…“ (web/settings-renderer.js:352; web/settings.js:487-502) — Kotlin: ✅ settings/SettingsCloudflare.kt (cloud.newKey, Toast)
- [x] **Knopf „Schlüssel kopieren“ (nur mit Schlüssel)** – Zwischenablage, Toast (web/settings-renderer.js:353; web/settings.js:504-517) — Kotlin: ✅ settings/SettingsCloudflare.kt
- [x] **Zeile „Cloud-Speicher (1000 MB Limit)“ mit Anzeige „0.0 MB / 1000 MB (0 %)“** – Std-Anzeige; Wert aus Statusnutzung (web/settings-renderer.js:355; web/sync-cloudflare.js:74) — Kotlin: ✅ settings/SettingsCloudflare.kt (ui.usage)
- [x] **Zeile „Cloud-Daten löschen“ mit Knopf „Cloud-Stand leeren“ (nur wenn konfiguriert) + Bestätigung** – Bestätigung „Möchtest du wirklich alle synchronisierten Daten…“, Knopf „Cloud leeren“ (web/settings-renderer.js:356; web/settings.js:519-533; web/sync-cloudflare.js:391) — Kotlin: ✅ settings/SettingsCloudflare.kt (Dialog gleicher Text)
- [x] **Hinweis-Fußzeile „100 % Ende-zu-Ende verschlüsselt (AES-GCM 256-Bit)…“** – (web/settings-renderer.js:372) — Kotlin: ✅ settings/SettingsCloudflare.kt
- [x] **Kopplungs-Scan-Ergebnis: Fehlermeldungen (ungültige Daten, Verbindung fehlgeschlagen, erfolgreich)** – (web/settings.js:444-466) — Kotlin: ✅ settings/SettingsCloudflare.kt
- [ ] **Offline- und Serverfehler-Meldungen** („Das Gerät ist offline…“, „Der Cloudflare-Sync-Server ist nicht erreichbar.“, „Cloudflare-Sync ist nicht eingerichtet.“) – (web/sync-cloudflare.js:148-150, 205-206) — Kotlin: 🟡 settings/SettingsCloudflare.kt (Fehlertexte aus dem Kern; Offline-Text nicht gesondert geprüft)
- [ ] **Toast bei Dateien über 100 MB (wird nicht synchronisiert)** – (web/sync-cloudflare.js:157) — Kotlin: ⬜ nicht gefunden

### 8. Sync: Google Drive

- [ ] **Statuskarte Google Drive** – Titel „Verbunden“ / „Pausiert“ / „Nicht verbunden“ / „Einrichtung erforderlich“ (ohne Client-ID); Beschreibungen „Verbunden als …“, „Google meldet dich nach einer Stunde ab – ein Tipp sichert weiter“, „Google öffnet erst nach deinem Klick ein Anmeldefenster“, „Hinterlege unter Erweitert eine Google Client-ID“ (web/settings-renderer.js:313-325; web/drive-status.js:21-43) — Kotlin: 🟡 settings/SettingsDrive.kt (Verbunden/Pausiert/Nicht verbunden ✅; „Einrichtung erforderlich“ entfällt nativ)
- [ ] **Hauptknopf je Zustand** – „Drive einrichten“ (öffnet Erweitert), „Jetzt sichern“ (Anmeldung abgelaufen), „Drive synchronisieren“, „Mit Google anmelden & synchronisieren“ (web/settings-action-state.js:6-11; web/settings.js:597-608) — Kotlin: 🟡 settings/SettingsDrive.kt (Knopfe „Neu anmelden“, „Mit Google verbinden“, „Jetzt synchronisieren“)
- [x] **Knopf „Abmelden“ (bei verbunden/pausiert)** – löscht Token und E-Mail lokal, Zustand „Nicht verbunden“ (web/settings-renderer.js:324; web/settings.js:549-553; web/drive.js:208-216) — Kotlin: ✅ settings/SettingsDrive.kt (drive.logout)
- [ ] **Google-Anmelde-Fenster (Popup) mit Fehlermeldungen** – „Google-Anmeldung geschlossen.“, „Google-Anmeldefenster wurde blockiert.“, „Keine Google Client-ID hinterlegt…“, „Offline – die Google-Anmeldung benötigt…“ (web/drive.js:127-153, 174) — Kotlin: 🟡 sync/DriveController.kt (Consent-Ablauf über Google Identity; Fehlertexte abweichend, z. B. „Anmeldung abgebrochen.“)
- [x] **Fortschritt beim Sync (Label, geladene MB, Balken)** – (web/drive.js:273-279, 289 ff.; web/settings-renderer.js:322-323 für Speicherinfo) — Kotlin: ✅ settings/SettingsDrive.kt (LinearProgressIndicator, „%.1f MB geladen“)
- [x] **Zeile „Zuletzt gesichert <Datum>“** – (web/settings-renderer.js:318, 320; web/settings-renderer.js:45) — Kotlin: ✅ settings/SettingsDrive.kt (formatSaved)
- [x] **Speicherinfo „Impala67 belegt X in Drive · Google-Speicher: Y von Z“** – Abfrage höchstens alle 5 Minuten (web/settings-renderer.js:479-497; web/drive.js:437-439) — Kotlin: ✅ settings/SettingsDrive.kt („Speicher: … im App-Ordner“, nur verbunden)
- [x] **Uhr-Warnung (Gerät weicht ab)** – Toast „Die Geräteuhr weicht ~N Min …“ (web/drive.js:275) — Kotlin: ✅ sync/DriveController.kt („Geräteuhr weicht … Minuten ab“)
- [ ] **Drive-Sync-Meldungen (Toasts)** – „Sync fertig — N Änderungen, M Konflikt(e).“, „N Änderungen von einem anderen Gerät übernommen.“, „Sync abgeschlossen — alles aktuell.“, „Sync fehlgeschlagen: …“ (web/settings.js:555-592) — Kotlin: 🟡 sync/DriveController.kt (Ergebnisanzeige als Text, Toast-Varianten nicht geprüft)
- [ ] **Statusetiketten Drive-Sync** – „Offline · wartet“, „Speichert…“, „Pausiert – zum Weitersichern neu anmelden“, „Offline“, „Sync fehlgeschlagen“ (web/drive.js:321, 334, 365, 385; web/drive-status.js:29-34) — Kotlin: 🟡 sync/DriveController.kt („Offline · wartet“, „Pausiert – …“ ✅; „Speichert…“ nicht gefunden)

### 9. Automatische Synchronisierung (Bereich „drive-automation“)

- [x] **Sync-Intervall (Auswahl)** – Optionen: 5 Min., 15 Min., 30 Min. (Std), 1 Stunde, 3 Stunden, „Täglich (Backup-Modus)“ (web/drive-sync-policy.js:3-10; web/settings-renderer.js:362; web/settings.js:319-323) — Kotlin: ✅ settings/SettingsDrive.kt (driveSyncIntervalOptions, Std 30; Optionsliste nicht einzeln gegengeprüft)
- [x] **Nach jeder Änderung synchronisieren (Schalter)** – Std aus; Bündelung ca. 3 s, verschoben während Eingabe bis max. 60 s (web/settings-renderer.js:363; web/drive.js:344-349, 386-420; web/drive-sync-policy.js:25-26) — Kotlin: ✅ settings/SettingsDrive.kt (prefs/vm.setDriveSyncAfterChange; Bündelungszeit nicht geprüft)
- [ ] **Tokens über Drive synchronisieren (Schalter)** – Std an; KI-Schlüssel auf eigene Geräte übertragen; beim Ausschalten Bereinigung alter Drive-Kopien (web/settings-renderer.js:364; web/settings.js:302-317; web/settings-sync.js:1-36) — Kotlin: ⬜ settings/SettingsDrive.kt (bewusst ausgelassen, TODO im Code)
- [x] **Automatik-Hinweis „Tipp: Bei aktivem Cloudflare-Sync reicht das tägliche Backup-Intervall“** – (web/settings-renderer.js:374) — Kotlin: ✅ settings/SettingsDrive.kt
- [ ] **Automatisches Sichern bei Sichtbarkeitswechsel und Schließen (pagehide)** – (web/drive.js:419-426) — Kotlin: 🟡 ImpalaApp.kt / sync/DriveController.kt (onForeground/onBackground vorhanden; Schließen-Flush nicht geprüft)

### 10. Backup & Wiederherstellung (Bereich „backup“)

- [ ] **Vollständiges Backup – Export (Knopf „Backup erstellen“ / „Backup erneut erstellen“ / „Backup wird erstellt…“)** – JSON `impala67-export-JJJJ-MM-TT.json` (Event-Log und Dateien), Zeitstempel in impala67LastBackup; Busy-Zustand (web/settings-renderer.js:362-368; web/settings.js:1037-1060; web/settings-action-state.js:22-25; web/app-click-buttons.js:285-287) — Kotlin: ⬜ settings/SettingsAiSync.kt (Platzhalter „Vollständiges Backup“, TODO)
- [ ] **Zeile „Zuletzt <Datum> · …“ (Beschreibung des Backups)** – (web/settings-renderer.js:366-367) — Kotlin: ⬜
- [ ] **Vollständiges Backup – Import (Knopf „Importieren“, Dateiauswahl)** – Zusammenführung konfliktfrei, Toast „N Änderungen importiert — die App lädt neu.“, Fehlertoast (web/settings-renderer.js:368; web/settings.js:1138-1150; web/app-click-buttons.js:308) — Kotlin: ⬜ (TODO: Storage Access Framework fehlt)
- [ ] **Backup-Status-Ampel (Übersicht: letztes Backup, Warnung bei lokal oder veraltet)** – (web/backup-status.js:15-22, 82-100; web/settings-renderer.js:44, 48) — Kotlin: ⬜ (kein Pendant gefunden)

### 11. Weitere Exporte (Bereich „data-export“)

- [ ] **Lerndaten exportieren (Knopf „Exportieren“)** – JSON `impala67-lerndaten-JJJJ-MM-TT.json` mit Telemetrie, Bewertungen, Lernsitzungen, Kartenauszug; Toast „Lerndaten exportiert.“ (web/settings-renderer.js:369; web/telemetrie.js ca. Z. 400-418; web/app-click-buttons.js) — Kotlin: ⬜ (Platzhalter/TODO: „Weitere Exporte“ fehlt)
- [ ] **Workspace als Markdown (ZIP) – ein Knopf je Workspace** – (web/settings-renderer.js:369; web/app.js:509-510 `LIBRARY.exportWorkspaceZip`) — Kotlin: ⬜ (TODO im Code)
- [x] **Einzelseite als Markdown exportieren** – Teilen-/⋯-Menü (web/extras.js:636-644 `data-exportmd`) — Kotlin: ✅ ui/desk/DeskPageActions.kt (exportMarkdown, CreateDocument text/markdown)
- [ ] **Einzelseite als PDF (Druckansicht mit „Drucken / PDF“ und „Schließen“)** – (web/extras.js:590, 677) — Kotlin: 🟡 notes/PageOps.kt + ui/desk/DeskPageActions.kt (Seiten ✅; Hefte „folgen“, Zeile 97)

### 12. Erweitert (Bereich „sync-advanced“)

- [ ] **Google Client-ID (Feld, Platzhalter „OAuth-Webclient-ID“, in Speichern übernommen)** – Std leer; Hinweis „OAuth-Webclient für Google Drive“ (web/settings-renderer.js:370, 377; web/settings.js:935 driveClientId) — Kotlin: 🟡 entfällt nativ (Client-ID im Projekt; TODO im Code)
- [ ] **Aufklappbereich „Erweitert“** – (web/settings-renderer.js:377) — Kotlin: 🟡 entfällt nativ

### 13. Sync-Konfliktansicht (web/conflict-ui.js)

- [x] **Dialogtitel „Synchronisation braucht eine Entscheidung“ mit Warnsymbol** – (web/conflict-ui.js:170-182) — Kotlin: ✅ sync/ConflictText.kt (Text) + sync/ConflictsScreen.kt
- [x] **Liste „Offene Konflikte“ (Titel, Art, Zeit je Eintrag, aktiver Eintrag markiert)** – (web/conflict-ui.js:146-151) — Kotlin: ✅ sync/ConflictsScreen.kt
- [x] **Zähler „Konflikt i von n“ (Kopfzeile) und „i / n“ (kompakt)** – (web/conflict-ui.js:176, 166) — Kotlin: ✅ sync/ConflictsScreen.kt (Z. 200, 256)
- [x] **Navigation vorheriger/nächster Konflikt (‹ ›)** – (web/conflict-ui.js:165-167) — Kotlin: ✅ sync/ConflictsScreen.kt (Z. 198-202)
- [x] **Sammelknopf „Alle N Konflikte mit Empfehlung lösen“ (ab 2 Empfehlungen)** – (web/conflict-ui.js:162, 169) — Kotlin: ✅ sync/ConflictsScreen.kt (Bestätigung „Alle N Konflikte lösen?“, Z. 135-151)
- [x] **Art „Beide geändert“ / „Gelöscht vs. geändert“** – (web/conflict-ui.js:18, 47) — Kotlin: ✅ sync/ConflictText.kt
- [x] **Alt-Konflikte („Alte Kopie“, „Original fehlt“, „N Zeile(n) neu“, „Nichts Neues“)** – (web/conflict-ui.js:34-38, 46) — Kotlin: ✅ sync/ConflictText.kt
- [x] **Erklärtexte je Art** – (web/conflict-ui.js:19-22, 39-44) — Kotlin: ✅ sync/ConflictText.kt
- [x] **Aufklappbereich „Mehr dazu“ (Grund)** – (web/conflict-ui.js:179) — Kotlin: ✅ sync/ConflictsScreen.kt (Z. 260)
- [x] **Zeilenvergleich-Tabelle (zwei Spalten, Kopf mit Gerät/Zeit)** – Zeilen mit − / + markiert, Legende „− nur auf diesem Gerät / + nur auf Drive / anderem Gerät“ bzw. „− nur in der aktuellen Seite / + nur in der Kopie“ (web/conflict-ui.js:89-106, 123-124, 139-141) — Kotlin: ✅ sync/ConflictCompare.kt
- [x] **Sprungknopf „Nächste Änderung (N)“** – (web/conflict-ui.js:124, 141) — Kotlin: ✅ sync/ConflictCompare.kt (Z. 154)
- [x] **Eingeklappte unveränderte Strecke „··· N unveränderte Zeilen ···“** – (web/conflict-ui.js:100) — Kotlin: ✅ sync/ConflictCompare.kt (Z. 174)
- [x] **Große Seiten (> 400 abweichende Zeilen): zwei Volltext-Spalten** – (web/conflict-ui.js:136-137) — Kotlin: ✅ sync/ConflictCompare.kt (Hinweistext Z. 112)
- [x] **Vergleich „Inhalt der Kopie ansehen/ausblenden“ (eingeklappt, wenn sicher)** – (web/conflict-ui.js:118; Android-Text „ausblenden“) — Kotlin: ✅ sync/ConflictCompare.kt (Z. 97)
- [x] **Entscheidung bei „Beide geändert“: „Dieses Gerät behalten“ (Empfohlen · neuer), „Anderen Stand behalten“ (Empfohlen · neuer), „Beide behalten“** – (web/conflict-ui.js:62-73) — Kotlin: ✅ sync/ConflictText.kt (Z. 88-97)
- [x] **Entscheidung bei „Gelöscht vs. geändert“: „Seite behalten (wiederherstellen)“, „Gelöscht lassen“ (Empfohlen · Löschen gewinnt)** – (web/conflict-ui.js:53-56) — Kotlin: ✅ sync/ConflictText.kt (Z. 103-105)
- [x] **Entscheidung bei Alt-Kopien: „Kopie verwerfen“ (Empfohlen · nichts geht verloren), „Als eigene Seite behalten“** – (web/conflict-ui.js:57-60) — Kotlin: ✅ sync/ConflictText.kt (Z. 112-115)
- [ ] **Zusatzentscheidung „Kopie übernehmen“** – nur nativ (web/conflict-ui.js: nicht vorhanden) — Kotlin: 🟡 sync/ConflictText.kt (Z. 117; Abweichung zur PWA)
- [x] **Schließen-Knopf (×, Esc)** – (web/conflict-ui.js:171) — Kotlin: ✅ sync/ConflictsScreen.kt (Z. 164, 206)
- [x] **Leerzustand „Keine offenen Konflikte.“** – (web/conflict-ui.js: Liste leer) — Kotlin: ✅ sync/ConflictsScreen.kt (Z. 163)
- [ ] **Fehlermeldung „Die Entscheidung konnte nicht angewendet werden…“** – (web/conflict-ui.js: Aktionsfehler; Android-Text ConflictText.kt:34-35) — Kotlin: 🟡 (Android-Text vorhanden, PWA-Pendant nicht eindeutig)
- [x] **Einstieg aus Startseite („N Sync-Konflikte warten auf deine Entscheidung“)** – (web/home-*.js, nicht in diesem Inventar) — Kotlin: ✅ home/HomeScreen.kt (Z. 129) + ui/shell/Routes.kt (Titel „Sync-Konflikte“)

### 14. App & Speicher (Bereich „app“)

- [ ] **Lokaler Speicher – „Verwendeter Speicher“ mit Balken und Angabe „X MB von Y GB“** – navigator.storage.estimate, „< 1 MB“ möglich (web/settings-renderer.js:400, 499-517; web/settings-renderer.js:37-40 Übersicht) — Kotlin: ⬜ settings/SettingsApp.kt (Platzhalter „Anzeige folgt mit dem Speicher-Modul“)
- [ ] **Speicherbericht / PDF auslagern (storage-tools)** – keine sichtbare PWA-Oberfläche; nur über den MCP-Bridge-Pfad `impala_storage_report` / `impala_storage_cleanup` (web/storage-tools.js:5-62; web/mcp-bridge.js:582-620) — Kotlin: ⬜ keine Entsprechung (nur Entscheidung nötig, ob UI gewünscht)
- [ ] **App-Version „Installiert v<x>“ (live-Feld) und „Verfügbar: —/v<neu>“** – (web/settings-renderer.js:401; web/settings.js:659-704 updateLocalVer/updateRemoteVer) — Kotlin: 🟡 settings/SettingsApp.kt (Installiert ✅; „Verfügbar“ fehlt)
- [x] **Hinweistext „Updates werden nur auf Wunsch geprüft“** – (web/settings-renderer.js:402) — Kotlin: ✅ settings/SettingsApp.kt
- [ ] **Knopf „Nach Updates suchen“ (Zustand „Prüfe…“ deaktiviert)** – (web/settings-action-state.js:27-33; web/settings.js:659-704) — Kotlin: ⬜ (TODO Release-Modul)
- [ ] **Knopf „Update vX installieren“ / „Update wird geladen…“ / „App neu laden“** – (web/settings-action-state.js:27-33; web/settings.js:706-725; web/updater.js:228-296 installAppUpdate) — Kotlin: ⬜ (APK-Update nicht implementiert)
- [ ] **Status-Text unter dem Update-Feld (live)** – „Update vX verfügbar (du: vY). Tippe „Update laden“.“, „Aktuell: vX“, „Check fehlgeschlagen: …“, „Lokal neuer als Server-Stand.“ (web/settings.js:659-704) — Kotlin: ⬜
- [ ] **Update-Banner (Toast unten) „Update vX verfügbar“ mit „Aktualisieren“ / „Lade…“ / „Wiederholen“ und Schließen** – (web/updater.js:304-335, 347-371) — Kotlin: ⬜
- [ ] **Meldung „Update auf vX installiert.“ nach Neustart / „Update vX wurde nicht übernommen“** – (web/updater.js:351-367) — Kotlin: ⬜
- [ ] **Hintergrund-Prüfung auf neue Version (Watcher)** – (web/updater.js:347-371; Quelle version.json bzw. service-worker.js: web/updater.js:197-223) — Kotlin: ⬜
- [ ] **Gerät: Dokumenten-Scanner (Auswahl Google-Scanner / Impala-Scanner, nur nativ)** – Std: Google (web/settings-renderer.js:403-410) — Kotlin: 🟡 (Google-Scanner vorhanden, Auswahl nicht; Abschnitt „Gerät“ als Platzhalter in settings/SettingsApp.kt)
- [x] **Experimente: Beta-Design (Schalter)** – Std an (impala67BetaUi ≠ "0"), „aktuell ohne Wirkung“ (web/settings-renderer.js:411; web/settings.js:102) — Kotlin: ✅ settings/SettingsApp.kt (prefs.betaUi)
- [ ] **Gefahrenzone: „Lokale Seiten löschen“ (Knopf „Seiten löschen“)** – Bestätigung „…Einstellungen, API-Keys, Chats und Karteikarten bleiben erhalten“; danach Neuladen (web/settings-renderer.js:418; web/settings.js:970-987) — Kotlin: ⬜ (Platzhalter „Folgt mit dem Datenmodul“)
- [ ] **Gefahrenzone: „Alle Chats löschen“ (Knopf „Chats löschen“, aus wenn keine Chats)** – Bestätigung „…kann nicht rückgängig gemacht werden“, Sync-Hinweis (web/settings-renderer.js:419; web/app-click-buttons.js:243-245; web/chat-fullscreen.js:378-392) — Kotlin: ⬜ (Platzhalter „Folgt mit dem KI-Modul“)
- [ ] **Gefahrenzone: „Alle Karteikarten löschen“ (Knopf „Karten löschen“, aus wenn keine Karten/Stapel)** – Bestätigung mit Anzahl, Stapel und Lernfortschritt, Sync-Hinweis; Toast (web/settings-renderer.js:415-420; web/settings.js:989-1035; web/app-click-buttons.js:246-248) — Kotlin: ⬜ (Platzhalter „Folgt mit dem Lern-Modul“)
- [ ] **Für Entwickler (Aufklappbereich)** – (web/settings-renderer.js:436) — Kotlin: ⬜ (Platzhalter)
- [ ] **MCP-Live-Bridge (Schalter, nur Browser; ws://127.0.0.1:8765; auf lokalem Dev-Server immer an)** – (web/settings-renderer.js:429; web/mcp-bridge-flag.js; web/mcp-bridge.js) — Kotlin: 🟡 bewusst entfallen (PORTING § 8, Kommentar in settings/SettingsApp.kt)

### 15. Diagnose und Performance-Profiler (web/performance-profiler.js, web/performance-profiler-settings.js)

- [ ] **Performance-Profiler (Schalter), Std aus** – Speicherschlüssel `impala67PerformanceProfiler`="1"; Umschalten setzt Modus „Auffälligkeiten“ (web/performance-profiler-settings.js:31-40; web/performance-profiler.js:3, 698-702; web/settings-renderer.js:427) — Kotlin: ⬜ settings/SettingsApp.kt (Platzhalter „Folgt (Android-Profiler und Logcat)“)
- [ ] **Modi „Auffälligkeiten“ (Std) / „Alle Messpunkte“ (Entwicklermodus per MCP)** – Schlüssel `impala67PerformanceProfilerMode` (web/performance-profiler.js:4-6, 54-66) — Kotlin: ⬜
- [ ] **Zähler-Zeile „N Auffälligkeiten / N Messpunkte“** – (web/settings-renderer.js:421-426) — Kotlin: ⬜
- [ ] **Knopf „Diagnose kopieren“ (Zwischenablage, nur mit Einträgen)** – Toast „Performance-Diagnose kopiert.“ oder Fallback-Hinweis (web/settings-renderer.js:428; web/performance-profiler-settings.js:9-29) — Kotlin: ⬜
- [ ] **Knopf „JSON exportieren“** – `impala67-performance-JJJJ-MM-TT.json` (web/performance-profiler-settings.js:21-25) — Kotlin: ⬜
- [ ] **Knopf „Protokoll löschen“** – Toast, Neu-Öffnung (web/performance-profiler-settings.js:14-19) — Kotlin: ⬜
- [ ] **Auffälligkeits-Schwellen (Ereignistyp-Regeln)** – Hänger ab 100 ms (main-thread-stall), Start ab 1500 ms (boot-ready), Fehler immer, Cloudflare/Drive/DB ab 1200 ms, Heft/Editor/UI/Suche/Anki ab 120 ms, Rest max(4×minMs, 200 ms); Intervall 250 ms, Schwelle 120 ms (web/performance-profiler.js:11-12, 151-185; LAG_* Z. 11-12) — Kotlin: ⬜
- [ ] **Diagnose-Bericht (JSON, formatVersion 2, Geräte-/Speicherwerte, Einträge je Version)** – (web/performance-profiler.js:725-750) — Kotlin: ⬜
- [ ] **Profiler-Start-Meldung / Absturzerkennung „noteUncleanExit“** – (web/performance-profiler.js:600-620, 672-681) — Kotlin: ⬜

### 16. Status-Anzeigen (ohne eigenen Bereich)

- [ ] **Backup-Status-Logik (sicher / ausstehend / veraltet ab 24 h / nur lokal)** – Schwelle 24 h, Erinnerung zurückstellen 3 Tage (veraltet) bzw. 14 Tage (nur lokal) (web/backup-status.js:9-11, 15-22, 82-100) — Kotlin: ⬜
- [ ] **Startseiten-Hinweis „Backup-Hinweis“ (nur bei Handlungsbedarf, „Später“)** – (web/backup-status.js:86-87) — Kotlin: ⬜ (nicht gefunden)
- [ ] **Drive-Status (gemeinsame Aussage Anmeldung/Netz/Sync)** – Labels „Anmeldung läuft…“, „Nicht verbunden“, „Offline“, „Pausiert“, „Verbunden“, „Verbunden als <Mail>“ (web/drive-status.js:21-43) — Kotlin: 🟡 sync/DriveController.kt (Einzelzustände ✅; gemeinsame Zustandsaussage nicht identisch)
- [ ] **Cloudflare-Statuspunkt (Zustände connected/syncing/connecting/error/disconnected)** – (web/settings-renderer.js:330) — Kotlin: 🟡 settings/SettingsCloudflare.kt (Punkte vorhanden, Zustandsmenge leicht abweichend)
- [ ] **App-Icon-Badge: Anzahl fälliger Karten (neu + lernen + wiederholen), gebündelt alle 2 s** – nur installierte PWA mit Badging-API (web/app-badge.js:1-42) — Kotlin: ⬜ (nicht geprüft/nicht gefunden)
- [ ] **Lernanalyse-Insights auf der Startseite (sechs Hinweise, z. B. beste Tageszeit, Denkzeit, Kalibrierung, Ermüdung, Fokus, schwierigster Stapel)** – (web/telemetrie.js ca. Z. 292-375, `homeInsightsHtml`) — Kotlin: ⬜ (nicht gefunden; Lernanalyse-Ansicht more/MoreScreen.kt „Lernanalyse“ separat)
- [ ] **Lernanalyse: Denkzeit-/Fokus-Erfassung (intern, ohne UI)** – (web/telemetrie.js:71-117) — Kotlin: 🟡 (Speicher-Schalter ✅, Erfassung nicht geprüft)

### 17. QR-Dialoge

- [ ] **QR-Scanner (Kamera-Dialog „QR-Code scannen“, Zielrahmen, Status „Suche QR-Code…“)** – Scan alle 180 ms, native BarcodeDetector, Fallback jsQR von CDN (web/qr-scanner.js:63-233) — Kotlin: 🟡 settings/SettingsCloudflare.kt + settings/CloudflarePairing.kt (`scanQrCode`, Google-Codescanner statt eigener Ansicht)
- [ ] **Scanner: Foto- oder Screenshot-Import „QR-Code aus Foto/Screenshot lesen“** – (web/qr-scanner.js:92-94, 235-274; Fehler „Kein QR-Code im Bild gefunden.“, „Fehler beim Lesen des Bildes.“) — Kotlin: ⬜
- [ ] **Scanner: Statusmeldungen („Unbekannter QR-Code. Bitte Impala67-Code scannen.“, „Kamera nicht verfügbar. Bitte Foto wählen.“, „Analysiere Bild…“)** – (web/qr-scanner.js:162, 231, 240) — Kotlin: 🟡 (Fehlertexte als Toast; Foto-Pfad fehlt)
- [x] **Scanner: Abbrechen-Knopf und Klick auf Hintergrund** – (web/qr-scanner.js:92-96, 123-133) — Kotlin: ✅ (Abbruch durch Google-Scanner, kein eigener Knopf)
- [x] **Kopplungsdaten lesen (Link mit #cf-pair=, JSON oder Base64)** – (web/qr-scanner.js:8-37) — Kotlin: ✅ settings/CloudflarePairing.kt (parseCfPairing)
- [x] **QR-Code erzeugen (Pairing-Dialog, 220 px, Fehlerkorrektur)** – (web/qrcode.js:229 createQrMatrix, 467 generateQrSvg; Aufruf web/settings.js:396-442 mit Größe 220) — Kotlin: ✅ settings/CloudflarePairing.kt (QRCodeWriter, 640 px, 220 dp)

### 18. Werkzeuge und Extras (web/extras.js, web/tools.js, web/storage-tools.js)

- [x] **Stapel-Optionen-Dialog (je Stapel bzw. Standard „*“ für alle; Titel „Stapel-Optionen — …“)** – (web/extras.js:462-476) — Kotlin: ✅ study/DeckDialogs.kt (Titel identisch)
- [x] **Neue Karten pro Tag (Zahl, min. 0)** – (web/extras.js:468, 484) — Kotlin: ✅ study/DeckDialogs.kt
- [x] **Wiederholungen pro Tag (Zahl, min. 0)** – (web/extras.js:469, 485) — Kotlin: ✅ study/DeckDialogs.kt
- [x] **Leech-Schwelle (Zahl, min. 1)** – (web/extras.js:470) — Kotlin: ✅ study/DeckDialogs.kt
- [x] **Leech-Aktion: „Karte aussetzen“ (Std laut Auswahl) / „Nur markieren“** – (web/extras.js:471-473) — Kotlin: ✅ study/DeckDialogs.kt (Segmentbuttons)
- [x] **Hinweis „Unterstapel erben die Einstellungen ihres Eltern-Stapels“** – (web/extras.js:474) — Kotlin: ✅ study/DeckDialogs.kt
- [ ] **Stapel-Optionen: Rückgängig-Knopf (letzte Bewertung)** – (web/extras.js:475) — Kotlin: 🟡 study/DeckDialogs.kt (stattdessen „Zurücksetzen“; Rückgängig im Lernkopf vorhanden, siehe unten)
- [x] **Stapel-Optionen: Speichern/Abbrechen** – (web/extras.js:475-476) — Kotlin: ✅ study/DeckDialogs.kt
- [x] **Rückgängig der letzten Bewertung (Lernmodus, Doppeltipp-Sperre 1,5 s)** – (web/extras.js:632-672 `data-ankiundo`, Sperre `.grades button`) — Kotlin: ✅ study/ReviewParts.kt (Kopf „Rückgängig“); Sperre nicht geprüft
- [ ] **Karten exportieren: Dialog mit Textdatei, CSV, Anki-Paket (.apkg)** – .apkg lädt sql.js nach (web/extras.js:539-560, 332-383) — Kotlin: ⬜
- [ ] **Karten importieren: Datei wählen (TXT, CSV/TSV, Anki-Text, .apkg)** – (web/extras.js:201-331, 495-508, 539-560) — Kotlin: ⬜
- [ ] **Importvorschau (Anzahl Karten, Stapel, Duplikate, Probleme)** – (web/extras.js:495-508) — Kotlin: ⬜
- [ ] **Checkbox „Duplikate ebenfalls importieren“ (Std aus)** – (web/extras.js:506) — Kotlin: ⬜
- [ ] **Knopf „Importieren“ (deaktiviert ohne Karten)** – (web/extras.js:507) — Kotlin: ⬜
- [ ] **Knopf „KI-Anweisung kopieren“ (Textformat-Prompt)** – (web/extras.js:553, 160-175) — Kotlin: ⬜
- [ ] **Aufklappbereich „TXT-Format anzeigen“** – (web/extras.js:554) — Kotlin: ⬜
- [ ] **Lückentext (Cloze): Text markieren, „Lücke einfügen“, „Als Lückentext speichern“** – (web/extras.js:602-621, 109-123; Attribute data-clozewrap / data-clozesave) — Kotlin: 🟡 study/CardEditorSheet.kt (Lückentext ✅; Markierungs-Umwandlung nicht geprüft)
- [ ] **Karten aus ==Markierungen== erzeugen (data-cardsfromhl)** – (web/extras.js:650, Aufruf cardsFromHighlights) — Kotlin: ⬜ (nicht gefunden)
- [x] **Interner Link kopieren (#<seiten-id>) mit Hinweis** – (web/extras.js:645-651) — Kotlin: ✅ notes/PageOps.kt (Interner Link wie PWA)
- [x] **Backlinks-Umschalter („N Rückverweise“)** – (web/extras.js:638) — Kotlin: ✅ editor/PageHeader.kt (Backlinks, Z. 115-125)
- [ ] **Multi-Tab-Warnung (Banner „Die App ist in einem weiteren Tab geöffnet…“, OK)** – (web/extras.js:57-66) — Kotlin: 🟡 n. z. (native Einzelinstanz, nicht gleichwertig geprüft)
- [ ] **KI-Werkzeuge: Liste der Funktionen (ca. 45 Aktionen, u. a. inspect, list_pages, read_page, create_page, append_to_page, replace_page_content, patch_page, rename_page, move_page, delete_page, archive_page, unarchive_page, write_to_heft, create_flashcard(s), update_flashcard, list_flashcards, list_due_cards, delete_flashcards, move_flashcards, suspend_flashcards, reset_card_progress, create_deck, rename_deck, move_deck, delete_deck, list_decks, search, search_notes, semantic_search, search_chat_history, get_context, ask_choice, calculate, send_to_notebooklm, sowie Batch-Operationen page.*/card.*/deck.*/heft.append)** – (web/tools.js ca. Z. 17-340 Definitionen; Dispatch `run(name)` ca. Z. 335 ff.) — Kotlin: 🟡 ai/AiChatViewModel.kt / ai/ChatParts.kt (Werkzeug-Chips mit Labels ✅; Ausführung im KI-Modul/Kern, nicht vollständig geprüft)
- [x] **Werkzeug-Chips „Hat … verwendet“ mit Namensliste (TOOL_LABELS)** – (web/render.js:1183-1200) — Kotlin: ✅ ai/ChatParts.kt (Z. 76, 179-193)
- [x] **Werkzeuge-Umschalter „Tools mitsenden“ (siehe Abschnitt 4)** – (web/settings-renderer.js:288) — Kotlin: ✅ settings/SettingsAiSync.kt
- [ ] **Werkzeug „request_tools“ (Werkzeuge freigeschaltet)** – (web/render.js:1198) — Kotlin: 🟡 ai/ChatParts.kt (Label vorhanden; Ablauf nicht geprüft)
- [ ] **Speicherbericht-Werkzeug (intern: Top-15-PDFs, Auslagern, Generation-Reset)** – (web/storage-tools.js:5-62) — Kotlin: ⬜ (siehe Abschnitt 14)
- [ ] **Telemetrie-Export der Lerndaten (Knopf in Einstellungen)** – (siehe Abschnitt 11) — Kotlin: ⬜

---

### Zusammenfassung

- **Vollständig vorhanden (✅):** Darstellung (außer Tab-Anordnung), Lernverhalten (Overlearning, Selbsteinschätzung, Lernanalyse, Pausen), Cloudflare-Kopplung (QR-Anzeige, Parsen, Schlüssel erzeugen/kopieren, Trennen, Speicher, Cloud-Stand leeren), Drive-Anmeldung/Sync/Abmelden/Auto-Sync-Intervall, Konfliktansicht fast vollständig, Stapel-Optionen, Markdown- und PDF-Seitenexport, Tools-mitsenden, Beta-Design.
- **Fehlend (⬜):** Bereich KI (Modelle, Quellen, lokale KI, Handschrift), alle sieben Experimente, Backup-Export/-Import, Lerndaten- und Workspace-Export, Speicheranzeige, Update-Prüfung und -Banner, Gefahrenzone (Seiten/Chats/Karten löschen), Performance-Profiler inklusive Diagnose-Knöpfen, Anki-Import/Export, Karten aus Markierungen, Suche in den Einstellungen, Backup-Status-Ampel, App-Icon-Badge.
- **Abweichend (🟡):** Cloudflare-Kopplungslink nutzt feste Basis-URL, Drive-/Cloudflare-Statustexte und Schaltflächenbeschriftungen weichen ab, Scanner-Auswahl nur Google, „Kopie übernehmen“ nur nativ, Wochenziel nur nativ.
- **Nicht inventarisiert (außerhalb des Auftrags):** Controller-Modul (`controller:settings-html`, Lernen-Bereich) und Storage-Tools ohne UI (nur MCP).

**Nicht vollständig geprüft:** `settings.js` (nur Handler-Abschnitte), `tools.js` (nur Dispatch und Definitionsnamen), `updater.js` und `performance-profiler.js` (Schwellen und Hauptfunktionen, nicht jede Zeile), `telemetrie.js` (Export und Insights ca.-Zeilenangaben). Android-Zeilenangaben sind nur bei kurzen Stellen genannt; die übrigen Verweise zeigen auf die Datei.


---

# 6. Smartphone-Oberfläche


Repo: `/home/jv232/Documents/Codex/2026-08-22/ka/Impala67/`. Pfade im Format `web/datei.js:Zeile` sind relativ dazu. Kotlin-Pfade stehen relativ zu `android/app/src/main/java/org/impala67/app/`.

**Prüfumfang:** web/mobile.js, mobile-view.js, mobile-sheet.js, mobile-notes.js, platform.js, platform-native.js, motion.js, mobile.css, mobile-content.css, plus die `@media`-Regeln für schmale Bildschirme und `pointer: coarse` in web/css/*.css, heft.css, editor.css, home.css und chat-start.css. Große Dateien wurden abschnittsweise gelesen. Android: ui/shell/, notes/, home/, more/, editor/EditorToolbar.kt sowie die Nachbarn EditorScreen, PageHeader, SlashMenu und ein Stichprobenblick auf study/, search/, library/ und heft/. Für Bereiche außerhalb der Prüfordner ist der Stand aus `android/PORTING.md` §8 übernommen und so gekennzeichnet.

**Phone-Definition (platform.js:8):** `(max-width: 700px), (pointer: coarse) and (max-height: 500px)`. Dann `body.mobile-ui`. Das iPad/Desktop-Layout bleibt davon getrennt. Android-Gegenstück: Telefon hochkant unter 840 dp, quer ab 600 dp schaltet auf das Desk-Layout (AppShell.kt, `DESK_MIN_WIDTH_DP`/`DESK_LANDSCAPE_MIN_WIDTH_DP`). Das ist eine bewusste Abweichung laut PORTING §5.

**Legende:** ✅ vorhanden wie PWA · 🟡 teilweise oder abweichend (Grund in Klammern) · ⬜ fehlt · ➕ nur Android (kein PWA-Vorbild) · ➖ entfällt nativ

---

### 1. Kopfzeile (#mBar)

- [x] **Kopfzeile-Container** – 52 px + Safe-Area oben, 3-spaltiges Grid, halbtransparent mit Blur (web/mobile-view.js:17-29; web/mobile.css:65-84) — Kotlin: ✅ ui/shell/AppShell.kt (Material-TopAppBar, Safe-Area über Edge-to-Edge)
- [x] **Zurück-Pfeil (#mBack)** – nur sichtbar in Unterebenen: Seite offen, Notizen-Unterebene, Bibliothek/Archiv/Papierkorb/Einstellungen usw. Ausgeblendet auf Start, Lernen-Ansicht, Mehr (web/mobile-view.js:18; web/mobile.js:408-413; web/mobile.css:145-146) — Kotlin: ✅ ui/shell/AppShell.kt (navigationIcon bei `backStack.size > 1` und nicht Hauptbereich)
- [ ] **Titel (#mTitle)** – zeigt je Ansicht: „Notizen“ bzw. Ebenentitel, „Mehr“, „Lernen“, Seitentitel, „Bibliothek“/„Archiv“, auf Start leer, weil der große Gruß der Startseite den Titel bildet (web/mobile-view.js:20; web/mobile.js:396-406; web/mobile.css:86-102) — Kotlin: 🟡 ui/shell/AppShell.kt (zeigt auf Start „Start“, nicht leer; Ebenentitel der Notizen stehen in der Crumb, nicht in der Leiste)
- [ ] **Untertitel „N fällig“ (#mSub)** – nur im Lernen-Tab, wenn Karten fällig sind (web/mobile-view.js:21; web/mobile.js:430-437; web/mobile.css:104-118) — Kotlin: ⬜ ui/shell/AppShell.kt (Lernen-Badge vorhanden, Untertitel fehlt)
- [x] **Suchen-Knopf** – öffnet die Vollbild-Suche (Befehls-Palette) über `#btnSearchToggle` (web/mobile-view.js:24; web/mobile.js:277-279) — Kotlin: ✅ ui/shell/AppShell.kt (öffnet SearchRoute; Suche in search/ geprüft per PORTING §8 ✅)
- [x] **KI-Knopf** – öffnet den KI-Assistenten als Vollbild (web/mobile-view.js:25; web/mobile.js:281-285) — Kotlin: ✅ ui/shell/AppShell.kt (öffnet AiRoute; Chat-Inhalt laut PORTING §8 teilweise)
- [x] **Bearbeiten/Fertig-Umschalter (#mEditToggle)** – nur bei Heften; schaltet zwischen Lesen (Stift-Symbol „Bearbeiten“) und Schreiben („Fertig“) um. Leere Hefte sind sofort beschreibbar (web/mobile-view.js:26; web/mobile.js:286-291, 378-393; web/mobile.css:140-142) — Kotlin: ✅ heft/HeftTopBar.kt (im Lesemodus ohne Rückgängig/Wiederholen, Werkzeugleiste und „+“)
- [ ] **Seitenoptionen-Knopf (#mPageMenu, ⋯)** – öffnet bei Seiten ein Bottom-Sheet mit dem Seiten-Menü (web/mobile-view.js:27; web/mobile.js:292-296, 414-415) — Kotlin: ⬜ editor/EditorScreen.kt (auf dem Telefon ist `chromeActions` null, die Seitenaktionen gibt es nur im Desk-Layout ui/desk/DeskPageActions.kt)
- [x] **Icon-Set** – Icons aus dem Sprite über `MOBILE_VIEW.icon()` mit festem Namens-Mapping (web/mobile-view.js:9-14) — Kotlin: ✅ R.drawable.ic_i_* (ShellParts/AppShell)

### 2. Untere Dock-Leiste (#mTabs), jeder Eintrag

- [x] **Start** – Icon + Beschriftung „Start“; schließt alle Ebenen und öffnet die Startseite (web/mobile-view.js:31; web/mobile.js:236-238) — Kotlin: ✅ ui/shell/AppShell.kt (NavigationSuiteItem, `TopLevel.Home`; ui/shell/Routes.kt:27)
- [ ] **Notizen** – öffnet die Notizen-Ebene. Ist sie schon offen, springt ein Tipp zur Wurzel zurück (web/mobile-view.js:32; web/mobile.js:240-251) — Kotlin: 🟡 ui/shell/AppShell.kt (startet die Ebene neu über `go()`, der Drill-Zustand bleibt in notes/NotesViewModel.kt erhalten)
- [ ] **„+“ (runder Akzent-Knopf in der Mitte)** – siehe Abschnitt 3 (web/mobile-view.js:33; web/mobile.js:264-276; web/mobile.css:218-237) — Kotlin: 🟡 ui/shell/AppShell.kt + ui/shell/ShellParts.kt (Eintrag vorhanden, aber ohne Unterseiten-Kontext, siehe 3)
- [ ] **Lernen** – öffnet den Karteikarten-Bereich (Stapel); Badge mit Anzahl fälliger Karten, ab 100 als „99+“ (web/mobile-view.js:34; web/mobile.js:252-255, 438-443; web/mobile.css:239-261) — Kotlin: 🟡 ui/shell/AppShell.kt (Badge mit Zähler vorhanden, aber ohne „99+“-Kappung und ohne Untertitel)
- [ ] **Mehr** – öffnet die Mehr-Ebene; Tipp darauf schließt sie wieder (web/mobile-view.js:35; web/mobile.js:256-263) — Kotlin: 🟡 ui/shell/Routes.kt (Mehr ist Hauptbereich; Zurück führt zur Startseite, nicht zum Vorzustand wie in der PWA)
- [x] **Dock-Layout** – 5 gleich breite Spalten, 64 px, Pille hinter dem aktiven Eintrag, Druck-Feedback scale .94 (web/mobile.css:151-216) — Kotlin: ✅ ui/shell/AppShell.kt (NavigationSuiteScaffold, Material-Indikator)
- [ ] **Dock ausblenden bei Tastatur** – `m-typing`, wenn die sichtbare Höhe um mehr als 140 px kleiner ist; Leiste rutscht unten raus (web/mobile.js:467-471; web/mobile.css:169-173) — Kotlin: ⬜ ui/shell/AppShell.kt (im geprüften Code kein Ausblenden der Leiste bei geöffneter Tastatur gefunden)
- [ ] **Dock ausblenden im Lernmodus** – `m-study`, Leiste verschwindet, Bewertungsleiste klebt unten (web/mobile.js:315; web/mobile.css:169-173; web/mobile-content.css:299-302) — Kotlin: 🟡 ui/shell/AppShell.kt (Leiste bleibt im Lernmodus sichtbar; nur Heft schaltet die Shell in den Vollbildmodus `nav.immersive`)

### 3. „+“-Eintrag (Neu anlegen)

Die PWA hat kein Optionen-Sheet am „+“. Der Knopf öffnet direkt die Auswahl „Neu anlegen“ (render.js:1136-1151). Sie ist ein Dialog, auf dem Telefon als Bottom-Sheet dargestellt.

- [ ] **Verhalten je Kontext** – Standard: Auswahl „Neu anlegen“ (web/mobile.js:270-273). In der Notizen-Unterebene: Unterseite dieser Ebene anlegen (web/mobile.js:269-270). Im Lernen-Tab ohne Lernmodus: neue Karte (`[data-ankinewcard]`, web/mobile.js:266-268) — Kotlin: 🟡 ui/shell/AppShell.kt (immer `askNewPage()` ohne Eltern-Seite; in der Unterebene entsteht die Seite deshalb auf der Wurzel. Neue Karte auf dem Lernen-Tab fehlt)
- [x] **Option „Notion-Seite“** – legt eine leere Seite an (web/render.js:1141 `data-tplblank`) — Kotlin: ✅ notes/TemplatePicker.kt (NewPageChoices, `onPick(false)`)
- [x] **Option „GoodNotes-Heft“** – legt ein Heft an (web/render.js:1142 `data-tplheft`) — Kotlin: ✅ notes/TemplatePicker.kt (`onPick(true)`)
- [x] **Vorlagen-Liste** – „Oder aus einer Vorlage:“, eine Schaltfläche je Vorlage, übernimmt Titel, Inhalt, Icon und Schlagwörter (web/render.js:1143-1146; web/app.js:440 für `newpage`) — Kotlin: ✅ notes/TemplatePicker.kt; ui/shell/ShellNav.kt (`pickTemplate`) übernimmt Titel, Inhalt, Icon und Tags
- [x] **Abbrechen** – schließt die Auswahl (render.js:1148 `#btnCloseOverlay`) — Kotlin: ✅ notes/TemplatePicker.kt (ModalBottomSheet onDismiss)
- [x] **Darstellung „Neu anlegen“** – Bottom-Sheet, Mitte der Liste bei Breite unter 600 px (components.css:63-65; mobile-content.css:628-691) — Kotlin: ✅ notes/TemplatePicker.kt (ModalBottomSheet auf dem Telefon)

### 4. Mehr-Ebene (#mMore; PWA „Drawer“ der Mehr-Ebene)

- [ ] **Synchronisations-Karte** – grüner Punkt mit Puls-Ring, Titel „Synchronisation“, Hinweis „Ende-zu-Ende verschlüsselt · Cloudflare & Google Drive“; öffnet die Einstellungen im Bereich Sync (web/mobile-view.js:47-51; web/mobile.js:194-197; web/mobile.css:609-658) — Kotlin: ✅ more/MoreScreen.kt (SyncCard → `action("sync")`). Der Puls-Ring fehlt: ⬜ (kein Animations-Ring gefunden)
- [x] **Abschnitt „Bereiche“** – Überschrift (web/mobile-view.js:52; web/mobile.css:297-305) — Kotlin: ✅ more/MoreScreen.kt (SectionLabel)
- [x] **Bibliothek** – PDFs und Dokumente; öffnet `#btnLibrary` (web/mobile-view.js:54; web/mobile.js:183-190) — Kotlin: ✅ more/MoreScreen.kt → `LibraryRoute` (PORTING §8: PDF-Liste, Öffnen, Import ✅; Tabs/Filter offen)
- [ ] **Wissensgraph** – öffnet `#btnGraph` (web/mobile-view.js:55) — Kotlin: ⬜ ui/shell/ShellNav.kt (Aktion „graph“ fällt in den Platzhalter „Folgt mit einem der nächsten Module.“; kein graph/-Paket)
- [ ] **Gemini Notebook** – öffnet `#btnNotebookLM` (web/mobile-view.js:56) — Kotlin: ⬜ ui/shell/ShellNav.kt (Platzhalter-Toast)
- [ ] **Lernanalyse** – öffnet `#btnLernzeit` (web/mobile-view.js:57) — Kotlin: ⬜ ui/shell/ShellNav.kt (Platzhalter-Toast; PORTING §8: study/LearningTime.kt nur die Auswertung)
- [x] **Abschnitt „Ablage“** – Überschrift (web/mobile-view.js:59) — Kotlin: ✅ more/MoreScreen.kt
- [x] **Archiv** – Archiv-Ansicht der Bibliothek (`S.libMode = "archive"`, web/mobile.js:199-204) — Kotlin: ✅ notes/ArchiveScreen.kt (Filter Alle/Hefte/Seiten, Wiederherstellen, In Papierkorb)
- [x] **Papierkorb** – öffnet `#btnTrash` (web/mobile-view.js:62) — Kotlin: ✅ notes/TrashScreen.kt (Wiederherstellen, Endgültig löschen mit Bestätigung, Papierkorb leeren)
- [x] **Abschnitt „App“** – Überschrift (web/mobile-view.js:64) — Kotlin: ✅ more/MoreScreen.kt
- [x] **Einstellungen** – öffnet `#btnSettings` (web/mobile-view.js:66; Untertitel „Design, KI, Konto“) — Kotlin: ✅ more/MoreScreen.kt → SettingsRoute (PORTING §7: Sync/KI/Speicher-Abschnitte offen)
- [x] **Zeilen-Darstellung** – Icon-Kachel in Farbe (blau, lila, grün, orange, grau, rot), Titel, Untertitel, Pfeil rechts, Trennlinie ab dem Text (web/mobile-view.js:41-43; web/mobile.css:313-400) — Kotlin: ✅ more/MoreScreen.kt (MoreRow, Tint)
- [ ] **Mehr schließen** – Tipp auf „Mehr“, Zurück-Geste oder Ebene wechseln (web/mobile.js:256-263, 149-160) — Kotlin: 🟡 ui/shell/AppShell.kt (Zurück führt zu Start, nicht zum Vorzustand)

### 5. Notizen-Ebene (#mNotes; „mnav“)

#### 5a. Suche und Aufbau
- [x] **Suchfeld** – Platzhalter „Notizen durchsuchen“, 16 px gegen den iOS-Zoom, sticky oben, Lupen-Symbol, filtert live (web/mobile-notes.js:131-146; web/mobile.css:430-462, 519-525) — Kotlin: ✅ notes/NotesScreen.kt (OutlinedTextField, `ImeAction.Search`)
- [x] **Suchtreffer** – Titel-Teilstring, Arbeitsbereich aktiv, nach Änderungsdatum absteigend, höchstens 50 (web/mobile-notes.js:63-75) — Kotlin: ✅ notes/NotesModel.kt (`hits`, max 50, nur Titel)
- [x] **Leere Trefferliste** – „Keine Treffer“ + „Für „…“ wurde nichts gefunden.“ (web/mobile-notes.js:68-73) — Kotlin: ✅ notes/NotesScreen.kt (EmptyState)
- [x] **Leere Notizen-Liste** – „Noch keine Notizen“ + Knopf „Erste Notiz anlegen“ (web/mobile-notes.js:79-84; `data-homeaction="newpage"`) — Kotlin: ✅ notes/NotesScreen.kt
- [x] **Abschnitt „Favoriten“** – höchstens 20, nach Änderungsdatum (web/mobile-notes.js:85; Abschnittsüberschrift :89) — Kotlin: ✅ notes/NotesModel.kt (`favorites`, take 20)
- [x] **Abschnitt „Zuletzt bearbeitet“** – höchstens 5 (web/mobile-notes.js:86, :90) — Kotlin: ✅ notes/NotesModel.kt (`recent`, take 5)
- [x] **Abschnitt „Alle Notizen“** – Wurzelseiten in Kern-Reihenfolge (web/mobile-notes.js:87, :91) — Kotlin: ✅ notes/NotesScreen.kt (Kind-Seiten der Wurzel)
- [x] **Ebenen-Kopf (Crumb)** – Titel der Elternseite, Knopf „＋ Unterseite“ (web/mobile-notes.js:95-100; web/mobile.css:527-545) — Kotlin: ✅ notes/NotesScreen.kt (Crumb mit Zurück-Pfeil, Titel, „＋ Unterseite“)
- [x] **Leere Unterseiten** – „Noch keine Unterseiten“ (web/mobile-notes.js:104) — Kotlin: ✅ notes/NotesScreen.kt
- [ ] **Arbeitsbereich-Wechsel** – PWA: keiner in der Notizen-Ansicht, sie nutzt `S.currentWorkspaceId` (web/mobile-notes.js:10) — Kotlin: ➕ notes/NotesScreen.kt (Filter-Chips, sobald mehr als ein Arbeitsbereich existiert)

#### 5b. Sortierung und Filter
- [x] **Sortierung** – in der PWA fest: Favoriten und Zuletzt nach Änderungsdatum absteigend, Wurzel in Kern-Reihenfolge; keine Auswahl (web/mobile-notes.js:29-30, 85-91) — Kotlin: ✅ (gleich fest) notes/NotesModel.kt
- [x] **Filter** – in der PWA nur Textsuche; in Notizen gibt es keinen Typ-Filter. Der Archiv-Filter (Alle/Hefte/Seiten) gehört zur Bibliothek/Archiv (web/mobile-content.css:800-805) — Kotlin: ✅ Archiv: notes/ArchiveScreen.kt (FilterChip-Reihe)

#### 5c. Zeilen-Aktionen
- [x] **Zeile (Notiz)** – Antippen öffnet die Seite, Icon (Emoji oder Standard), Titel (sonst „Ohne Titel“), Datum klein darunter (web/mobile-notes.js:33-52; web/mobile.css:547-551, 570-581) — Kotlin: ✅ notes/NoteRows.kt (NoteRowItem, PageGlyph)
- [x] **Unterseiten-Knopf mit Zähler** – Pille mit Anzahl und Pfeil, nur wenn Unterseiten existieren; öffnet die nächste Ebene (web/mobile-notes.js:39-41; web/mobile.css:582-601) — Kotlin: ✅ notes/NoteRows.kt (DrillButton)
- [x] **Optionen-Knopf (⋯)** – 40 px Ziel, öffnet das Notiz-Menü (web/mobile-notes.js:49; web/mobile.js:163-181) — Kotlin: ✅ notes/NoteRows.kt (IconButton, Optionen)
- [ ] **Notiz-Menü: „Öffnen“** – im Sheet als erster Eintrag (web/mobile.js:170) — Kotlin: 🟡 notes/NoteRows.kt (Antippen der Zeile öffnet; eigener Eintrag fehlt)
- [x] **Notiz-Menü: „Unterseite anlegen“** (web/mobile.js:171) — Kotlin: ✅ notes/NoteRows.kt
- [ ] **Notiz-Menü: „Umbenennen“** – PWA: Eingabedialog (app-click-pages.js:172-186) — Kotlin: 🟡 notes/NotesScreen.kt → notes/NoteRows.kt RenameDialog (AlertDialog in der Mitte, nicht Bottom-Sheet)
- [x] **Notiz-Menü: „Favorit hinzufügen/entfernen“** (web/mobile.js:173) — Kotlin: ✅ notes/NoteRows.kt
- [ ] **Notiz-Menü: „Duplizieren“** (web/mobile.js:174) — Kotlin: ⬜ notes/NoteRows.kt (fehlt im Menü)
- [ ] **Notiz-Menü: „Verschieben…“** (web/mobile.js:175) — Kotlin: ⬜ notes/NoteRows.kt (fehlt im Menü; `MovePageDialog` existiert nur für den Desk, ui/desk/DeskPageActions.kt)
- [x] **Notiz-Menü: „Archivieren“** (web/mobile.js:176) — Kotlin: ✅ notes/NoteRows.kt
- [x] **Notiz-Menü: „In den Papierkorb“** – rot, nach Trennlinie (web/mobile.js:177-178; web/mobile-view.js; web/mobile.css:769) — Kotlin: ✅ notes/NoteRows.kt (rote Tönung, ohne Bestätigung; PWA ebenfalls ohne)
- [ ] **Menüdarstellung** – PWA: Bottom-Sheet mit Titel der Notiz (web/mobile.js:180). Android: DropdownMenu am Knopf — Kotlin: 🟡 notes/NoteRows.kt (Dropdown statt Bottom-Sheet)

#### 5d. Wischgesten und Long-Press in der Notizenliste
- [x] **Wischen an Notizzeilen** – in der PWA keine Wischaktionen auf Zeilen (web/mobile-notes.js insgesamt) — Kotlin: ✅ (gleich: keine) notes/NoteRows.kt
- [x] **Long-Press auf Notizzeilen** – in der PWA nicht vorhanden: die globale Logik greift nur auf `.row, .tree-row, .home-list-row, .lib-card, .deck-row` mit `data-pagemenu`/`data-deckmenu` (web/popovers.js:131-185); `.m-row.m-note` erfüllt das nicht. Das Menü hängt am ⋯-Knopf — Kotlin: ✅ (gleich: kein Long-Press; ⋯-Knopf)

### 6. Bottom-Sheet-Komponente (#mSheet, #mSheetScrim)

- [x] **Scrim (Abdunkelung)** – halbtransparent, Tipp schließt, Einblenden in 260 ms (web/mobile-sheet.js:50-52, 72; web/mobile.css:663-676) — Kotlin: ✅ ModalBottomSheet (Material-Scrim, Tipp schließt)
- [x] **Griff** – 36×5 px, oben mittig (web/mobile-sheet.js:61; web/mobile.css:699-706) — Kotlin: ✅ ModalBottomSheet (DragHandle)
- [ ] **Kopf mit Titel und Schließen-X** – Titel 17 px, X-Knopf 44 px (web/mobile-sheet.js:62-65; web/mobile.css:707-723) — Kotlin: 🟡 ModalBottomSheet (Titel nur in den Dialogen, kein Standard-X in TemplatePicker.kt)
- [x] **Schließen per Escape** – web/mobile-sheet.js:85-87; web/mobile.js:475-480 — Kotlin: ✅ ModalBottomSheet (Zurück-Geste)
- [x] **Schließen per Wischgeste am Griff/Kopf nach unten** – Schwelle 90 px oder Geschwindigkeit über 0.5 px/ms; wird mit der Bewegung mitgezogen (web/mobile-sheet.js:5-7, 113-161) — Kotlin: ✅ ModalBottomSheet (Standard-Drag-to-dismiss)
- [x] **Schließen per Wischgeste im Inhalt** – nur wenn der Inhalt ganz oben steht (`scrollTop = 0`) und nach unten gezogen wird (web/mobile-sheet.js:163-187) — Kotlin: ✅ ModalBottomSheet (Standard)
- [x] **Auto-Schließen nach Aktion im Inhalt** – Klick auf einen Knopf im Inhalt schließt nach 0 ms; Ausnahme `data-mkeep` (web/mobile-sheet.js:95-109) — Kotlin: ✅ (Menüeinträge schließen selbst, notes/NoteRows.kt `closeThen`)
- [ ] **Inhalt wird ersetzt, wenn schon offen** – ohne den alten onClose-Callback (web/mobile-sheet.js:195-199) — Kotlin: ➖ (kein Sheet-Stapel nötig)
- [x] **Fokus-Rückgabe** – Fokus geht beim Schließen auf das vorige Element (web/mobile-sheet.js:202-203, 252-260) — Kotlin: ✅ (Compose-Standard)
- [x] **Sheet-Höhe** – höchstens 85 dvh, obere Ecken mit Radius xl, Schatten Stufe 3 (web/mobile.css:678-694) — Kotlin: ✅ ModalBottomSheet (Standard-Maximalhöhe)
- [ ] **Menü-Eintrag im Sheet** – 52 px, 16 px Schrift, Gefahr-Farbe, Trennlinie mit 16 px Rand (web/mobile.css:749-775) — Kotlin: 🟡 notes/NoteRows.kt (DropdownMenuItem, kein Bottom-Sheet-Menü)
- [ ] **Desktop-Menü im Sheet** – `.menu-hint` (Tastenkürzel) ausgeblendet (web/mobile.css:776) — Kotlin: ➖
- [ ] **Dialoge als Bottom-Sheet** – `#overlay` und `.modal` werden auf dem Telefon zu Bottom-Sheets: volle Breite, Griff, X oben rechts (44 px), Eingaben 16 px, Aktionen untereinander mit 48 px (web/components.css:63-65; web/mobile-content.css:631-691) — Kotlin: 🟡 notes/PageDialogs.kt (Verschieben, Verlauf, Icon, Cover als AlertDialog in der Mitte), notes/NoteParts.kt (ConfirmDialog als AlertDialog). ✅ Bottom-Sheet: notes/TemplatePicker.kt, home/HomeArticle.kt
- [x] **Escape-/Zurück-Verhalten der Dialoge** – `closeModals()` (web/mobile.js:52-57) — Kotlin: ✅ (Compose-Standard)

### 7. Seiten- und Notiz-Optionen (Sheet-Inhalt)

Dies ist das Seiten-Menü aus render.js:771-791. Es öffnet über ⋯ in der Kopfzeile (`pagemenu`). Das Notiz-Menü steht in Abschnitt 5c.

- [ ] **Rückgängig** – `data-editundo` (render.js:774) — Kotlin: ⬜ (Telefon: kein Seiten-Menü; Undo nur in editor/EditorToolbar.kt)
- [ ] **Wiederholen** – `data-editredo` (render.js:775) — Kotlin: ⬜ (wie oben; EditorToolbar.kt hat Wiederholen)
- [ ] **Favorit / Zu Favoriten** (render.js:777) — Kotlin: ⬜ (Telefon); ✅ ui/desk/DeskPageActions.kt
- [ ] **Als PDF exportieren / drucken** (render.js:778) — Kotlin: ⬜ (Telefon); ✅ DeskPageActions.kt (`exportPdf`)
- [ ] **Als Markdown (.md) speichern** (render.js:779) — Kotlin: ⬜ (Telefon); ✅ DeskPageActions.kt (`exportMarkdown`)
- [ ] **Internen Link kopieren** (render.js:780) — Kotlin: ⬜ (Telefon); ✅ DeskPageActions.kt (`copyLink`)
- [ ] **Verlauf** – `#btnHistory` (render.js:782) — Kotlin: ⬜ (Telefon); ✅ notes/PageDialogs.kt HistoryDialog (nur Desk)
- [ ] **PDF im neuen Tab öffnen / PDF herunterladen** – nur bei PDF-Seiten (render.js:783-786) — Kotlin: ⬜ (PDF-Bezug in PageSummary fehlt laut PORTING §7)
- [ ] **Icon ändern** (render.js:787) — Kotlin: ⬜ (Telefon); ✅ notes/PageDialogs.kt IconDialog (nur Desk)
- [ ] **Cover ändern** (render.js:788) — Kotlin: ⬜ (Telefon); ✅ notes/PageDialogs.kt CoverDialog (nur Desk)
- [ ] **Karten aus Markierungen (n)** – nur wenn Markierungen existieren (render.js:789) — Kotlin: ⬜
- [ ] **Duplizieren / Als Vorlage / Vorlage entfernen / Vorlesungsübersicht** (render.js:570-571) — Kotlin: ⬜ (Telefon)
- [ ] **Fach: … / Verschieben nach… / Archivieren bzw. Aus Archiv holen / Löschen (rot)** (render.js:572-575) — Kotlin: ⬜ (Telefon); Verschieben ✅ (notes/PageDialogs.kt MovePageDialog, Desk); Löschen als Papierkorb: ✅ im Desk

### 8. Editor (Seitenansicht auf dem Telefon)

- [ ] **Seitenkopf / Pfad (.page-chrome)** – auf dem Telefon ausgeblendet (web/mobile-content.css:13-15) — Kotlin: 🟡 editor/EditorScreen.kt (Breadcrumbs werden auf dem Telefon angezeigt, `chromeActions == null`)
- [x] **Seitentitel (#pageTitle)** – groß, eng, ohne Rahmen (web/mobile-content.css:43-58) — Kotlin: ✅ editor/PageHeader.kt (PageTitleBlock)
- [x] **Seiten-Icon** – Emoji vor dem Titel (web/render.js; Icon-Auswahl im Sheet, Abschnitt 7) — Kotlin: ✅ editor/PageHeader.kt (Icon)
- [ ] **Cover-Streifen** – 140 px hoch, abgerundet, „Cover hinzufügen“ (web/mobile-content.css:72-74) — Kotlin: ⬜ (Cover nur im Desk-Dialog)
- [x] **Rückverweise-Chip** – „N Rückverweise“ (web/render.js:794-799) — Kotlin: ✅ editor/PageHeader.kt (Backlinks)
- [x] **Blockgriff (⋮⋮) und Plus-Knopf** – auf dem Telefon ausgeblendet (web/mobile-content.css:21-22; web/editor.css:279-283; web/editor.js:557) — Kotlin: ✅ (bewusst ohne Griff, Tippen und Ziehen im Text)
- [ ] **Blockmenü (⋮⋮ → Umwandeln, Farbe, Duplizieren, Als Markdown kopieren, Lernkarte, Löschen)** – über den Griff; auf dem Telefon mangels Griff nicht erreichbar (web/editor-menus.js:272-295; web/editor.js:1521) — Kotlin: 🟡 editor/EditorToolbar.kt (nur Umwandeln-Schalter und Löschen; Farbe, Duplizieren, Markdown-Kopie, Lernkarte fehlen ⬜)
- [ ] **Umwandeln in (Blocktyp-Liste)** – Text, H1–H3, Liste, To-do, nummeriert, Zitat, Code, Callout, Toggle (editor-menus.js:272-276) — Kotlin: 🟡 editor/EditorToolbar.kt (T, H1, H2, H3, Aufzählung, Nummer, To-do, Zitat, Code; Callout und Toggle fehlen)
- [ ] **Farbe** – Textfarben und Hintergrundfarben je Farbe, plus Entfernen (editor-menus.js:280-285) — Kotlin: ⬜
- [ ] **Slash-Menü („/“)** – 22 Einträge in der PWA (editor-menus.js:100-124), am Eingabefeld, nimmt den Fokus nicht, Position über dem sichtbaren Ausschnitt (editor-menus.js:58-86) — Kotlin: 🟡 editor/SlashMenu.kt (9 Einträge: Text, H1–H3, To-do, Aufzählung, Nummer, Zitat, Code, Trennlinie; fokusloses DropdownMenu)
- [ ] **Slash: Umschaltliste / Callout / Gleichung (KaTeX) / Diagramm (Mermaid) / SVG / Tabelle / 2 Spalten / Bild / PDF / Datei-Medien / Heft / Seite verlinken** – editor-menus.js:100-124 — Kotlin: ⬜ (fehlen in SlashCmd, editor/SlashMenu.kt:38-52)
- [ ] **Link-Menü („[[“ )** – Seite verlinken (editor-menus.js:227-244; editor.js:1037) — Kotlin: ⬜ (in den geprüften Dateien nicht gefunden)
- [ ] **Gleichungs-Popover** – Textfeld, auf dem Telefon Cursor ans Ende (editor-menus.js:297-326) — Kotlin: ⬜
- [x] **Markdown-Kürzel** (`# `, `- `, `1. `, `[] `, `> `) – im Text (editor-menus.js; editor-markdown.js) — Kotlin: ✅ editor/MarkdownShortcuts.kt (laut PORTING §8 ✅)
- [ ] **Tabellen** – horizontal scrollbar, Mindestbreite, Zeilenkontrollen 26 px (web/mobile-content.css:83-91; web/editor.css:167-171) — Kotlin: ⬜ (Tabellen-Block in der Shell nicht im Prüfumfang; in PORTING §8 nicht gelistet)
- [ ] **Bilder im Rand** (web/mobile-content.css:76-82) — Kotlin: ⬜ (Bildblock laut PORTING nicht gelistet)
- [ ] **Zwei-Spalten-Blöcke** – untereinander unter 720 px (web/editor.css:64-66, Media 720) — Kotlin: ⬜
- [ ] **Blockmenü-Größe** – höchstens 60 dvh, Ziele 44 px, Breite mindestens 260 px (web/mobile-content.css:93-105) — Kotlin: ➖
- [ ] **Editor-Toolbar über der Tastatur** – in der PWA gibt es keine Tastatur-Leiste. Das CSS-Kommentar „schwebende Auswahl-Toolbar“ (web/css/editor.css:64) hat keine Umsetzung gefunden — Kotlin: ➕ editor/EditorToolbar.kt (HorizontalFloatingToolbar unten, `AnimatedVisibility` bei aktivem Block, `imePadding`, editor/EditorScreen.kt:75-114)
- [ ] **Rückgängig/Wiederholen in der Leiste** – ➕ editor/EditorToolbar.kt (ToolIcon)
- [ ] **Block löschen in der Leiste** – ➕ editor/EditorToolbar.kt
- [ ] **Zurück beendet den Blockmodus** – `BackHandler` setzt den aktiven Block zurück (editor/EditorScreen.kt:59) — PWA: Escape/Zurück über den Stapel (web/mobile.js:475-480)

### 9. Heft auf dem Telefon (Mobile-Schicht in den Stylesheets)

- [x] **Lesemodus beim Öffnen** – Finger blättern und zoomen, keine Striche; Stift-Taste schaltet ins Schreiben (web/mobile.js:59-69; web/mobile.css:141-142) — Kotlin: ✅ heft/HeftScreen.kt (nur Telefon)
- [ ] **Eckknöpfe oben** – 44 px, unter der Kopfzeile (web/css/heft.css:634-645; web/mobile-content.css:113-124) — Kotlin: 🟡 heft/HeftTopBar.kt (eigene Leiste; Eckknöpfe nicht geprüft)
- [x] **Werkzeugleiste unten am Daumen** – schwebend, Ziele 44 px, horizontal wischbar (web/mobile-content.css:126-164; web/css/heft.css:647-665) — Kotlin: ✅ heft/HeftToolbar.kt (Expressive Floating Toolbar, PORTING §8)
- [x] **Werkzeug-Auswahl** – Farbtupfer 24 px, Stiftgrößen 34 px (web/css/heft.css:657-660) — Kotlin: ✅ heft/HeftToolbar.kt (PORTING §8)
- [x] **Seitenübersicht** – 2 Spalten, Vollbild (web/css/heft.css:663-664) — Kotlin: ✅ heft/HeftPagesSheet.kt, heft/HeftPagesGrid.kt (PORTING §8)
- [ ] **Übertrag-Dialog** – Vollbreite, Fußzeile 2 Spalten (web/css/heft.css:183-195) — Kotlin: ⬜ (nicht im Prüfumfang)
- [ ] **Scan-Leisten** – Safe-Area unten (web/css/heft.css:209-264) — Kotlin: 🟡 heft/scan/HeftScan.kt (Scannen ✅, OCR offen laut PORTING §8)

### 10. KI-Assistent (Vollbild, #panel)

- [x] **Vollbild-Panel** – fixes Vollbild, Kopfzeile 52 px + Safe-Area, Hintergrund panel-solid (web/mobile-content.css:424-442) — Kotlin: ✅ ai/ChatView.kt (AiRoute, PORTING §8 „Chat im KI-Panel ✅“)
- [x] **Kopf: Titel und Schließen** – Titel 17 px, Schließen-Knopf 44 px (web/mobile-content.css:443-473; `#btnTogglePanel`) — Kotlin: ✅ ai/ChatView.kt (laut PORTING)
- [ ] **Leerzustand** – „Frag mich etwas / Zu deinen Notizen, Karten oder Plänen.“ (web/mobile-content.css:483-497) — Kotlin: nicht geprüft (ai/ außerhalb Prüfordner)
- [ ] **Nachrichten** – Schrift 16 px, Zeilenhöhe 1.6 (web/mobile-content.css:498) — Kotlin: nicht geprüft
- [x] **Eingabefeld** – 44 px hoch, max 40 dvh, Schrift 16 px, Radius lg (web/mobile-content.css:500-524) — Kotlin: ✅ (laut PORTING)
- [x] **Sendeknopf** – 40 px Kreis, Akzent (web/mobile-content.css:537-548) — Kotlin: ✅ (laut PORTING)
- [ ] **Anhänge** – Knopf-Menü, Ziele 44 px (web/mobile-content.css:858; attach-menu) — Kotlin: ⬜ (PORTING §8: Anhänge offen)
- [ ] **Modellwahl** – Menü, max 60 dvh (web/mobile-content.css:549, 872-874) — Kotlin: ⬜ (PORTING §8: Modellwahl offen)
- [ ] **Umformulieren-Menü (refine)** – web/mobile-content.css:859 — Kotlin: nicht geprüft
- [ ] **Chat-Tabs und Umbenennen** – PORTING §8: ⬜

### 11. Suche (Befehls-Palette, Vollbild)

- [x] **Vollbild-Palette** – Hintergrund panel-solid, Safe-Area oben (web/mobile-content.css:554-563) — Kotlin: ✅ search/SearchScreen.kt (SearchRoute)
- [x] **Eingabefeld** – 44 px, 16 px Schrift (web/mobile-content.css:576-593, `#paletteInput`) — Kotlin: ✅ search/SearchScreen.kt (laut PORTING §8 Suche ✅)
- [x] **Schließen-Knopf** – 44 px (web/mobile-content.css:594-600) — Kotlin: ✅ search/SearchScreen.kt (onClose)
- [ ] **Ergebnisliste und Abschnittsköpfe** – Großbuchstaben (web/mobile-content.css:601-625) — Kotlin: nicht geprüft
- [ ] **Eintrag** – 52 px, Radius lg, Druck-Hintergrund (web/mobile-content.css:616-625) — Kotlin: nicht geprüft
- [ ] **Fußzeile** – ausgeblendet (web/mobile-content.css:626) — Kotlin: ➖

### 12. Lernen (Karteikarten auf dem Telefon)

- [x] **Stapel-Zeile** – Grid mit Icon, Name, Zähler, Pfeil; Gruppen mit Radius an Anfang und Ende; Trennlinie ab Zeilenbeginn (web/mobile-content.css:225-241) — Kotlin: ✅ study/DeckRow.kt (laut Stichprobe), study/StudyScreen.kt (außerhalb Prüfordner)
- [x] **Zeilen-Menü (⋯, 44 px)** – deck-more-btn (web/mobile-content.css:254-267) — Kotlin: ✅ study/DeckRow.kt („Weitere Optionen“, „Optionen“)
- [x] **Zeilen-Menü-Einträge** – Lernen, Karten ansehen, Unterstapel anlegen/anzeigen/ausblenden, Umbenennen, Duplizieren, Archivieren, In Papierkorb (Stichprobe study/DeckRow.kt) — Kotlin: ✅ study/DeckRow.kt (Stichprobe)
- [x] **Stapel „Lernen“-Knopf** – Akzent, 44 px (web/mobile-content.css:275-282) — Kotlin: ✅ study/ (laut Labels „Lernen“)
- [ ] **Stapel „Feynman“-Knopf** – web/render-anki.js (deck-feyn, data-ankifeyn) — Kotlin: ⬜ (Feynman-Modus nur als Einstellung in settings/SettingsLearning.kt, kein Stapel-Knopf)
- [ ] **Modi-Kacheln** – 2 Spalten, 44 px (web/mobile-content.css:189-198) — Kotlin: nicht geprüft
- [x] **Kennzahlen** – 2 Spalten; Heute fällig (76 px), Diese Woche gelernt, Wochenziel (web/mobile-content.css:199-211) — Kotlin: ✅ home/HomeStats.kt, study/StudyScreen.kt (Labels „Heute fällig“, „Neue Karten“)
- [ ] **Abschnittsüberschriften** – Großbuchstaben (web/mobile-content.css:213-222) — Kotlin: nicht geprüft
- [x] **Lernmodus-Karte** – Vollbild, Frage und Rückseite mit Radius lg, Trennlinie „Rückseite“ (web/mobile-content.css:289-323; web/mobile-content.css:325-347) — Kotlin: ✅ study/ReviewScreen.kt (Frage/Rückseite laut Labels)
- [x] **Antwort-Knopf „Antwort zeigen“** – breit, 52 px, Akzent (web/mobile-content.css:349-366) — Kotlin: ✅ study/ReviewParts.kt („Antwort zeigen“)
- [x] **Bewertung „Nochmal“** – rot, 60 px, mit Intervall (web/render-anki.js; web/mobile-content.css:368-409, data-ankigrade=1) — Kotlin: ✅ study/ReviewParts.kt („Nochmal“)
- [x] **Bewertung „Schwer“** – orange (data-ankigrade=2) — Kotlin: ✅ study/ReviewParts.kt
- [x] **Bewertung „Gut“** – grün (data-ankigrade=3) — Kotlin: ✅ study/ReviewParts.kt
- [x] **Bewertung „Einfach“** – blau (data-ankigrade=4) — Kotlin: ✅ study/ReviewParts.kt
- [ ] **Bewertungsleiste klebt unten** – über der Safe-Area, mit Milchglas (web/mobile-content.css:377-389) — Kotlin: 🟡 study/ReviewScreen.kt (Bewertung vorhanden; die Dock-Leiste bleibt sichtbar)
- [ ] **Lernmodus-Fußzeile** – Optionen, 40 px (web/mobile-content.css:411-422) — Kotlin: 🟡 (Stichprobe; Optionen laut Labels „Optionen“, Position nicht geprüft)
- [x] **Letzte Bewertung rückgängig** – Label „Letzte Bewertung rückgängig“ in ReviewParts.kt — Kotlin: ✅ study/ReviewParts.kt
- [x] **Karten durchsuchen (Kartenbrowser)** – web/render-anki.js:309 (anki-toolbar) — Kotlin: ✅ study/CardBrowserScreen.kt (BackHandler)
- [x] **Haptik bei Bewertung** – web/app-click-anki.js:122 — Kotlin: ✅ study/ReviewScreen.kt (LocalHapticFeedback)

### 13. Bibliothek, Archiv, Papierkorb, Graph (auf dem Telefon)

- [x] **Bibliotheks-Container** – volle Breite, Ränder 16 px (web/mobile-content.css:800-805) — Kotlin: ✅ library/LibraryScreen.kt (PORTING §8: PDF-Liste, Öffnen, Import ✅)
- [ ] **Kopfbereich mit Umbruch** – Titel 20 px, Schalter umbrechen (web/mobile-content.css:806-816) — Kotlin: 🟡 library/LibraryScreen.kt (PORTING: Tabs/Filter offen)
- [ ] **Tab-Reihe** – Umbruch, 40 px (web/mobile-content.css:817-824) — Kotlin: ⬜ (PORTING: Tabs/Filter offen)
- [x] **Listenzeilen ≥ 52 px** (web/mobile-content.css:825-834) — Kotlin: ✅ library/LibraryScreen.kt (laut Stichprobe)
- [ ] **Karten-Ansicht ohne Hover-Effekt** – `.lib-card:hover { transform: none }` (web/mobile-content.css:833) — Kotlin: ➖
- [x] **Archiv-Ansicht** – Filter Alle/Hefte/Seiten; Wiederherstellen; Leerzustand (notes/ArchiveScreen.kt) — Kotlin: ✅ notes/ArchiveScreen.kt
- [x] **Papierkorb** – Wiederherstellen; endgültig löschen mit Bestätigung; leeren mit Bestätigung (notes/TrashScreen.kt) — Kotlin: ✅ notes/TrashScreen.kt
- [ ] **Wissensgraph-Kopf / Modi / Suche / Bühne / Inspektor** – web/mobile-content.css:836-851 — Kotlin: ⬜ (kein graph/-Paket; PORTING §8 ⬜)
- [ ] **Mehrfach-Tab-Hinweis** – web/extras.js; volle Breite über der Dock-Leiste (web/mobile-content.css:930-941) — Kotlin: ➖ (kein Tab-Konzept auf dem Telefon)

### 14. Start (Startseite auf dem Telefon)

Die Startseite ist dieselbe wie am PC. Auf dem Telefon kommen nur andere Ränder dazu (web/mobile-content.css:943-946). Die Elemente stehen in web/home-view.js und web/home-article.js.

- [ ] **Begrüßung und Einstellungs-Knopf „Startseite anpassen“** – web/home-view.js:107 — Kotlin: 🟡 home/HomeScreen.kt (Text vorhanden; laut PORTING §7 ist die Funktion offen)
- [x] **Konflikt-Hinweis** – „Ein Sync-Konflikt wartet“ / „N Sync-Konflikte warten“ (web/home-view.js:111) — Kotlin: ✅ home/HomeScreen.kt (ConflictAlert)
- [ ] **Sicherungs-Hinweis** – „Änderungen seit … sind noch nicht gesichert“ mit „Jetzt sichern“ bzw. „Deine Notizen liegen bisher nur auf diesem Gerät.“ mit „Sync einrichten“ (web/home-view.js:116-117) — Kotlin: ⬜ (Texte in home/ nicht gefunden; PORTING §7 „Backup-Hinweis“ offen)
- [x] **Weitermachen (Karte)** – letzte Seite mit Vorschau (web/home-view.js:121-122) — Kotlin: ✅ home/HomeCards.kt (ContinueCard)
- [x] **Angeheftet** – bis zu 6 Favoriten als Pillen (web/home-view.js:125) — Kotlin: ✅ home/HomeCards.kt (Pins)
- [x] **Karten-Kennzahl „Heute fällig“** – Zustände: fällig, alles gelernt, keine Karten (web/home-view.js:139-142) — Kotlin: ✅ home/HomeStats.kt
- [x] **Diese Woche gelernt + Wochenziel-Balken + „Ziel ändern“** (web/home-view.js:144-149) — Kotlin: ✅ home/HomeStats.kt („Ziel ändern“, „Diese Woche gelernt“)
- [x] **„Weißt du's noch?“ (Wiederholungskarte)** – web/home-view.js:63-77 — Kotlin: ✅ home/HomeCards.kt
- [ ] **Tagesartikel (Titel, Vorschau, Gelesen-Knopf, Verlauf)** – web/home-article.js:198-221 — Kotlin: 🟡 home/HomeArticle.kt (Verlauf in Bottom-Sheet ✅, Markdown wird als Klartext gezeigt laut PORTING §7)
- [x] **Startseiten-Raster** – Abstand 16 px seitlich, 32 px unten (web/mobile-content.css:944-946) — Kotlin: ✅ home/HomeScreen.kt (HomeWidth Narrow)

### 15. Zurück-Verhalten

PWA-Reihenfolge in `goBack()` (web/mobile.js:149-160): erst Sheet, dann Dialog/Palette, dann KI-Panel, dann Mehr, dann Notizen-Ebene, dann Verlauf des Navigators (TABS.canGoBack). Der Stapel der Ebenen (`LAYERS`, web/mobile.js:86-115) ist: Notizen → Mehr → KI → Dialog → Sheet → Lernmodus. Diese Ebenen liegen als History-Einträge vor (`syncHistory`, web/mobile.js:120-134).

- [x] **Hardware-/System-Zurück** – schließt die oberste Ebene (web/mobile.js:138-146; TABS.setLayerHandler) — Kotlin: ✅ ui/shell/AppShell.kt (NavDisplay `onBack`, Predictive Back)
- [x] **Zurück-Pfeil in der Kopfzeile** – `goBack()` (web/mobile.js:233-234) — Kotlin: ✅ ui/shell/AppShell.kt
- [x] **Wischgeste vom linken Rand** – Start innerhalb 24 px, dx über 80 px, |dy| unter 50 px, unter 500 ms; im Lernmodus aus (web/mobile.js:303-322) — Kotlin: ✅ (System-Geste, Predictive Back)
- [ ] **Escape-Taste** – `goBack()`, wenn kein Sheet offen (web/mobile.js:475-480) — Kotlin: ➖ (kein Hardware-Tastatur-Pfad auf dem Telefon)
- [x] **Notizen-Unterebene zurück** – eine Ebene nach oben statt schließen (web/mobile.js:79-82, 155-156; web/mobile-notes.js:183-187) — Kotlin: ✅ notes/NotesScreen.kt (BackHandler → `vm.goUp()`)
- [ ] **Mehr zurück** – schließt die Mehr-Ebene (zurück zum Vorzustand) — Kotlin: 🟡 (Mehr ist Hauptbereich; Zurück führt zur Startseite, ui/shell/ShellNav.kt `go()`)
- [x] **Editor: Block-Modus beenden** – Kotlin: ✅ editor/EditorScreen.kt (BackHandler)
- [x] **Lernmodus beenden** – PWA: Ebene „study“ schließt über den Tab „Stapel“ (web/mobile.js:111-114) — Kotlin: ✅ study/ReviewScreen.kt (BackHandler → onExit)

### 16. Long-Press-Menüs

- [ ] **Langer Druck auf Zeilen mit Menü (550 ms, höchstens 10 px Bewegung)** – auf `.row, .tree-row, .home-list-row, .lib-card, .deck-row` mit `[data-pagemenu]`/`[data-deckmenu]` (web/popovers.js:131-185; Vibration 10 ms) — Kotlin: ⬜ study/DeckRow.kt und Bibliotheks-Karten (kein `combinedClickable`/`onLongClick` gefunden; nur der ⋯-Knopf)
- [x] **Langer Druck auf Notizzeilen (Telefon)** – nicht vorhanden in der PWA (`.m-row.m-note` erfüllt die Auswahl nicht). Das Menü hängt am ⋯-Knopf — Kotlin: ✅ (gleich)
- [ ] **Kontextmenü bei Touch unterdrücken** – web/popovers.js:149-158 — Kotlin: ➖
- [ ] **Langer Druck auf Blöcke** – web/editor.js; Blockmenü ist nicht erreichbar (siehe 8) — Kotlin: ⬜

### 17. Übergänge und Bewegung

- [ ] **Ebene öffnen (`m-layer-in`)** – Einblenden mit 8 px Versatz nach oben, 220 ms (web/mobile.css:284-292) — Kotlin: 🟡 NavDisplay (Standard-Übergang, kein eigener Versatz)
- [x] **Sheet-Einfahrt** – Feder, `translateY(100%)` → 0 (web/mobile.css:686-698; web/mobile-sheet.js:209-214) — Kotlin: ✅ ModalBottomSheet
- [x] **Scrim-Einblenden** – 260 ms (web/mobile.css:663-676) — Kotlin: ✅ ModalBottomSheet
- [ ] **Dock wegschieben** – `translateY(110%)` bei Tastatur und Lernmodus (web/mobile.css:169-173) — Kotlin: ⬜ (siehe 2)
- [ ] **Gleitende Markierung der Schalter (`slideSwitch`)** – 480 ms, Feder (web/motion.js:48-70; SWITCHES: `.lib-tabs`, `.mode-btns`, `#tree`, `#sidebar .topbar`, `.tabstrip`) — Kotlin: ✅ NavigationSuiteScaffold (Indikator der Leiste animiert); Bibliothekstabs ⬜ (PORTING offen)
- [ ] **Morph von der Quelle zur Zielfläche** – Geist-Element, 520 ms, Quelle `.deck-row, .hv-continue, .hv-pin, .hv-stat, .anki-stat, .hv-recall, .la-block, .lib-card, .notion-tree-row` (web/motion.js:7, 73-89, 111-123) — Kotlin: ⬜ (kein gemeinsamer Übergang gefunden)
- [ ] **Hochzählen der Kennzahlen** – 700 ms, Ease-out-Kubik (web/motion.js:96-109) — Kotlin: ⬜ (kein `animate…AsState` für Zähler gefunden)
- [ ] **Einfahren der Ansicht (`bm-enter`)** – Auftritt mit Verzögerung (web/motion.js:111-129; web/design.css:33-36) — Kotlin: 🟡 ui/components/Motion.kt (`riseIn`, nur auf Start und Lernen)
- [ ] **Druck-Feedback** – `scale(.94)` für Icon-Knöpfe, `.98` für Zeilen, `.96` für Bewertung, `.94` für Dock (web/mobile.css:143, 216, 506-514; web/mobile-content.css:404) — Kotlin: 🟡 ui/components/Motion.kt (`pressScale` definiert, im geprüften Code nicht eingesetzt; Material-Ripple)
- [ ] **Puls-Ring am Sync-Punkt** – per `transform`/`opacity`, 2.4 s unendlich (web/mobile.css:644-658) — Kotlin: ⬜ (more/MoreScreen.kt, kein Puls)
- [x] **Startseite: Auftritt der Blöcke (`hv-in`)** – 6 px, nach Reihenfolge (web/home.css:18, 24) — Kotlin: ✅ ui/components/Motion.kt (`riseIn`, home/HomeScreen.kt)
- [x] **Toasts** – Positionen über der Dock-Leiste, Lernmodus 150 px (web/mobile-content.css:879-890) — Kotlin: ✅ ui/shell/AppShell.kt (SnackbarHost über der Leiste)

### 18. Safe-Area, Tastatur und Viewport

- [x] **Safe-Area oben/unten** – `env(safe-area-inset-*)` in Kopf, Dock, Sheet, Eingabefeld, Bewertung (web/mobile.css:13-14, 76, 162, 727; web/mobile-content.css:449-455, 506, 721; web/css/layout.css:6-7) — Kotlin: ✅ MainActivity.kt (`enableEdgeToEdge`), Material-Insets; DeskShell.kt (`safeDrawing`)
- [x] **Safe-Area seitlich** – layout.css:7 (#app) — Kotlin: ✅ ui/desk/DeskShell.kt (`safeDrawing`), Telefon über Material
- [ ] **Status-Leiste iOS-Standalone** – `#statusBand`, Höhe `max(6px, safe-area-top)` (web/css/layout.css:6) — Kotlin: ➖
- [x] **Tastatur: sichtbarer Ausschnitt** – `visualViewport`-Höhe, Schwelle 140 px (web/mobile.js:467-473) — Kotlin: ✅ editor/EditorScreen.kt (`imePadding`); CardEditorSheet.kt (`imePadding`, `navigationBarsPadding`)
- [ ] **Tastatur: Ansicht wieder zurücksetzen** – web/app.js:757-791 (Verschiebung von Fenster und #main nach dem Schließen) — Kotlin: ➖ (Compose-Standard)
- [x] **Menü über der Tastatur** – `positionMenu` nutzt `visualViewport` (web/editor-menus.js:58-86; web/popovers.js:8-40, safeTop 56 px, safeBottom 74 px auf dem Telefon) — Kotlin: ✅ DropdownMenu (Compose-Positionierung)
- [x] **Eingabefelder 16 px gegen den iOS-Zoom** (web/mobile-content.css:895-900; web/mobile.css:430-456) — Kotlin: ✅ (Compose, kein Zoom)
- [x] **Schaltflächen mindestens 40 px** (web/mobile-content.css:901-906) — Kotlin: ✅ (Compose-Standard 48 dp)
- [x] **Scroll-Container** – Inhalt scrollt zwischen Kopf und Dock; Rubber-Band aus (web/mobile.css:45-60; `overscroll-behavior: none`) — Kotlin: ✅ (Compose-Standard)
- [ ] **Tippmarkierung aus** – `-webkit-tap-highlight-color: transparent` (web/mobile.css:21) — Kotlin: ➖

### 19. Darstellungsvarianten

- [x] **Hell/Dunkel (Design-Schalter)** – `body.light`, Hellmodus-Schatten und Milchglas-Töne (web/mobile.css:781-796; web/mobile-content.css:907-916) — Kotlin: ✅ settings/SettingsAppearance.kt (System/Hell/Dunkel), ui/theme/ImpalaTheme.kt
- [ ] **Performance-Modus** – `body.perf-mode`: keine Milchglas-Leisten, keine Animationen, Motion aus (web/mobile.css:23-24; web/motion.js:15-17) — Kotlin: 🟡 settings/SettingsAppearance.kt + settings/DevicePrefs.kt (`reduceMotion` gespeichert, im Code nicht ausgewertet; ui/components/Motion.kt liest den Schalter nicht)
- [ ] **Reduzierte Bewegung (System)** – `prefers-reduced-motion` (web/mobile.css:801-808; web/mobile-content.css:919-928; web/home.css:24, 232) — Kotlin: ⬜ (keine Auswertung des Systemschalters gefunden)
- [ ] **Schriftgröße** – Telefon nutzt Variablen; Android-Schalter (settings/DevicePrefs.kt:41 `fontScale`; settings/SettingsAppearance.kt) — Kotlin: 🟡 (Schalter vorhanden, Wirkung nicht geprüft)
- [ ] **Akzentfarbe** – SettingsAppearance.kt (Blau, Grün, Orange, Violett) — Kotlin: 🟡 (Schalter laut Labels; Wirkung nicht geprüft)
- [ ] **Touch-Erkennung** – `is-touch`, `is-phone`, `is-ios`, `is-standalone`, `is-native` an `body` (web/platform.js:16-30) — Kotlin: ➖ (nativ über Formfaktor)
- [x] **Touch-Ziele 44 px** – `pointer: coarse` (web/css/base.css:20; web/css/editor.css:167, 279; web/css/heft.css:274, 521; web/css/home.css:118) — Kotlin: ✅ (Compose-Standard 48 dp)
- [ ] **Kompakte Dichte (density-compact)** – nur Desktop (web/css/layout.css:25-27) — Kotlin: ➖ (Desk-Layout hat das eigene Dichte-Setting, settings/SettingsAppearance.kt „Darstellungsdichte“: 🟡)
- [x] **Breakpoints der Stylesheets** – 600 px (components.css:63; editor.css:40, 290, 329), 640 px (editor.css:204; library.js:553), 720 px (editor.css:61; heft.css:73, 315, 429, 489), 480 px (heft.css:18, 446), 760/420 px (chat-start.css:46, 49), 980 px (layout.css:37), 701–1024 px (layout.css:49-64) — Kotlin: ✅ (Telefon/Tablet über `DESK_MIN_WIDTH_DP` = 840 und Querformat ab 600 dp in AppShell.kt)

### 20. Native Brücke (web/platform-native.js)

- [ ] **Haptik: Auswahl** – `selectionChanged` oder 10 ms Vibration (web/platform-native.js:33-43) — Kotlin: 🟡 study/ReviewScreen.kt (LocalHapticFeedback nur an einer Stelle)
- [ ] **Haptik: leicht** – `impact LIGHT` oder 15 ms (web/platform-native.js:45-55; web/app-click-anki.js:122; web/app.js:651) — Kotlin: 🟡 study/ReviewScreen.kt (nur Lernen)
- [ ] **Haptik: mittel** – `impact MEDIUM` oder 25 ms (web/platform-native.js:57-67) — Kotlin: 🟡 (siehe oben)
- [ ] **Haptik: Fehler** – `notification ERROR` oder [30,40,30] ms (web/platform-native.js:69-79) — Kotlin: ⬜
- [ ] **Haptik-Schalter** – `impala67NativeHaptics` in localStorage; Einstellung „Haptisches Feedback“ (web/settings-schema.js:34; web/settings-renderer.js:110) — Kotlin: ➖ (Android-Einstellung settings/SettingsAppearance.kt laut Labels: 🟡 Wirkung nicht geprüft)
- [ ] **Lokale Benachrichtigung „Karteikarten fällig“** – täglich 18:00 (Standard), ersetzt die vorige, Text „Impala67 – Karteikarten fällig“ + Anzahl (web/platform-native.js:83-143) — Kotlin: ⬜ (keine Benachrichtigungs-Logik im Android-Code gefunden; AndroidManifest.xml nur mit Berechtigung)
- [ ] **Benachrichtigungs-Aktion** – Listener `localNotificationActionPerformed` (web/platform-native.js:145-165) — Kotlin: ⬜
- [x] **Zurück-Taste (App-Lifecycle)** – `backButton` (web/platform-native.js:191-210) — Kotlin: ✅ (NavDisplay/BackHandler)
- [x] **Dokument-Scanner** – ML Kit, Installationshinweis, 25 Seiten (web/platform-native.js:237-305) — Kotlin: ✅ heft/scan/HeftScan.kt (laut PORTING: Scannen ✅, OCR offen)
- [x] **Diktat („Sprechen…“)** – Berechtigung, Teilergebnisse (web/platform-native.js:306-383, Sprache de-DE Zeile 328) — Kotlin: ✅ ai/Dictation.kt
- [ ] **Teilen einer Datei (Export)** – Filesystem plus Share-Dialog, Dateiname bereinigt, „Teilen auf diesem Gerät nicht verfügbar“ (web/platform-native.js:170-189) — Kotlin: 🟡 ui/desk/DeskPageActions.kt (Teilen nur im Desk; Telefon ⬜)
- [ ] **Empfangen per Teilen (Share-Intent)** – SendIntent-Abfrage mit 3,5 s Timeout (web/platform-native.js:385-416) — Kotlin: ⬜ (Manifest-Eintrag vorhanden; PORTING §7: die Activity wertet Intents noch nicht aus)

### Nebenbefunde (kein Teil des Inventars, zur Prüfung)

- `web/qr-scanner.js:156` ruft `PLATFORM_NATIVE.haptics.impact("medium")` auf. In `web/platform-native.js` gibt es keine Methode `impact`; der Aufruf würde synchron mit TypeError abbrechen (`.catch` fängt das nicht). Vermutlich ein Fehler.
- `web/css/editor.css:64` nennt eine „schwebende Auswahl-Toolbar“, die im Code nicht umgesetzt ist.
- Das Blockmenü ist auf dem Telefon mangels sichtbarem Griff nicht erreichbar (web/mobile-content.css:21-22). Die PWA hat deshalb auf dem Telefon keinen Weg zu Duplizieren, Farbe, Markdown-Kopie und Lernkarte.
- Die Notizenliste der PWA hat keinen Arbeitsbereich-Wechsel. Der Desktop-Seitenbaum zeigt ihn nur im Desk-Layout.

### Kurzbilanz der größten Lücken (Telefon)

1. Seitenmenü (⋯) fehlt auf dem Telefon komplett (Verlauf, Export, Icon, Cover, Duplizieren, Verschieben, Archivieren, Löschen). Die Desk-Variante existiert.
2. Slash-Menü: 13 von 22 Einträgen fehlen; kein Link-Menü, keine Gleichung.
3. ~~Lesemodus für Hefte fehlt.~~ ✅
4. Mehr: Wissensgraph, Gemini Notebook und Lernanalyse sind nur Platzhalter.
5. Notiz-Menü: Duplizieren und Verschieben fehlen; Menü ist Dropdown statt Bottom-Sheet.
6. Keine Benachrichtigung „Karteikarten fällig“, keine Diktat-Funktion, kein Share-Intent.
7. Dock wird bei Tastatur und Lernmodus nicht ausgeblendet.
8. Mehrere Bewegungsfunktionen fehlen (Morph, Zähler-Animation, Puls-Ring, gleitende Markierung der Tabs); Performance- und System-Reduce-Motion werden nicht ausgewertet.
9. Startseite: Sicherungs-Hinweis und „Sync einrichten“ fehlen.

Nicht abschließend geprüft: ai/, search/, library/, study/ (außer Stichprobe) und heft/ außerhalb der genannten Dateien. Dort gilt der Stand aus PORTING §8.
