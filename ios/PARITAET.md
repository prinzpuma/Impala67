# iPad-App ↔ PWA: Stand der Gleichheit

Fortschrittsliste für die native iPad-App (`ios/`). Ziel: **Verhalten wie die PWA**, Design darf
Apple-typisch abweichen. Gliederung und Punkte folgen `android/UI-INVENTAR.md` (Teile 1–5, ohne
Telefon-Teil 6).

**Legende**

| Zeichen | Bedeutung |
|---|---|
| ✅ | Im iOS-Code vorhanden und verhält sich laut Code wie die PWA |
| 🟡 | Teilweise oder abweichend |
| ❌ | Fehlt |
| ⚪ | Bewusst anders (z. B. Lineal im Heft, VisionKit-Scanner) |

**Wichtig:** Die Bewertung beruht auf dem Code (Stand 05.11.2026, Commit `52a82af`). Die Leistungs-
und Ablaufpunkte wurden am **07.11.2026** auf dem Gerät geprüft (App `2.2.124+25`, iPadOS 27.2);
Bericht: [`docs/IPAD-TESTBERICHT-2026-11-07.md`](../docs/IPAD-TESTBERICHT-2026-11-07.md). Ein `✅`
ohne Gerätevermerk ist weiterhin nur Code-Stand. Neue Lücken unten im Abschnitt ergänzen.

Fundstellen sind relativ zu `ios/Impala67/`.

---

## 0. Blocker: Hänger und Leistung (vor allen Funktionslücken)

Profiler vom 05.11.2026 (iPadOS 27.0.1, App 0.1.0+1), Hänger des Hauptthreads. Am 07.11.2026 auf
iPadOS 27.2 nachgemessen: Startseite, Seitenleiste, Heft-Laden, Suche, Graph, KI und Bibliothek ohne
Hänger; offen bleiben die unten markierten Punkte:

| Ansicht | Anzahl | Ø | Max |
|---|---|---|---|
| Startseite (`home`) | 20 | 5,1 s | 9,1 s |
| Heft | 25 | 1,6 s | 8,8 s |
| Karten | 7 | 3,9 s | 5,2 s |

Die PWA hat diese Hänger nicht. Ursachen laut Code (noch nicht mit Instruments bestätigt):

| # | Ursache | Fundstelle | Status |
|---|---|---|---|
| P1 | **Eine Sperre für den ganzen Kern.** Jeder Kern-Aufruf vom Hauptthread wartet, solange ein Hintergrund-Thread die Sperre hält. Sie halten u. a.: Sync-Import je Portion, danach `settle_remote` (bei Bedarf **komplettes Neuladen des Logs** und **Checkpoint des ganzen Zustands** nach jedem Durchgang mit Importen), App-Checkpoint, Handschrift-Hintergrundscan, Drive-Backup. Diese Zeit sieht die App als Hänger. | `core/impala-ffi/src/lib.rs:210` (`Shared = Arc<Mutex<Inner>>`), `core/impala-ffi/src/sync.rs:165-186`, `:330-340` | 🟡 Checkpoint in `settle_remote` entkoppelt (06.11.): Checkpoint läuft wie in PWA nur noch beim Wechsel in den Hintergrund (`scenePhase != .active`), nicht mehr mitten im aktiven Sync unter Sperre · 🟡 Gerät 07.11.: Sync unter Last ohne UI-Stall; 429 ms Kern-Sperre beim Karten-Sync und 789 ms Kaltstart bleiben |
| P2 | **Ansichten fragen den Kern bei jedem Neuzeichnen synchron ab.** Die Startseite hängt an `store.revision` (= *jede* Änderung, auch jeder Strich und jeder fremde Sync) und ruft dann `studyQueue`, `recentPages(40)`, `learningSessions`, `homeArticles(30)`, `conflictCount` und `cardTotals` auf dem Hauptthread auf. „Weißt du's noch?“ geht alle Karten auf dem Hauptthread durch. | `Home/HomeScreen.swift:27-41`, `:168` | ✅ Code (05.11.): `HomeData.load` und „Weißt du's noch?“ im Hintergrund, kein `store.revision` mehr · ✅ am Gerät bestätigt 07.11. (10 Wechsel ohne Hänger) |
| P3 | Karten: Stapelbaum und Übersicht rufen bei jeder Kartenänderung `deckOverview` und `studyQueue` auf, beide auf dem Hauptthread, also doppelt. | `Cards/DeckTree.swift:12-14`, `Cards/CardsScreen.swift:39-42` | 🟡 Code (05.11.): eine Abfrage im Hintergrund (`CardsModel.refresh`), geteilt mit Suche · 🟡 am Gerät 07.11.: 193 ms Hänger beim Einstieg in die Kartenübersicht |
| P4 | Seitenbaum, Tab-Leiste und der ganze Inhaltsbereich hängen an `pagesRevision`. Jede Seitenänderung (Tippen, Sync) baut den Baum per `TreeRows.read` neu und zeichnet den Inhalt neu. | `Shell/PageTree.swift:16-17`, `Shell/RootView.swift:85`, `Shell/TabBar.swift:12` | ✅ Tab-Metadaten in `ShellModel` gecacht (06.11.); Tab-Leiste, Seitenleiste und `RootView` lesen ohne FFI-Aufrufe im `body`; `TreeRows.read` filtert Kindknoten ohne redundante `childrenOf`-Aufrufe; `CardBrowser`, `StatsScreen`, `TrashSheet`, `ChatList` lesen im Hintergrund · ✅ am Gerät bestätigt 07.11. (10 Toggles, 5 Seitenwechsel) |
| P5 | Heft: Jeder Strich wird synchron auf dem Hauptthread gespeichert (`heftAddStroke`, `heftRemoveStrokes` …) und wartet damit auf die Sperre aus P1. Zu prüfen: Löst eine Heftänderung auch `pagesRevision` aus (dann P4 bei jedem Strich)? | `Heft/HeftCanvas.swift:258-451` | ✅ Code (05.11.): Hinzufügen, Löschen, Verschieben über eine Hintergrund-Warteschlange; Neuladen wartet auf offene Striche · ✅ am Gerät bestätigt 07.11. (3 Ladevorgänge < 100 ms) |
| P6 | Fremde Heftänderungen starten jedes Mal den Handschrift-Hintergrundscan. | `Core/ImpalaStore.swift:54` | 🟡 |

Vorschlag für die Reihenfolge:

1. **Messen**: Hänger im Profiler mit dem Namen des Kern-Aufrufs bzw. der Ansicht erfassen (heute
   leer: `name`/`source`), damit P1 bis P5 belegt sind.
2. **P2 bis P4**: Kern-Abfragen aus `body` in Ansichtsmodelle verschieben, die nur auf ihre eigene
   Revision hören, im Hintergrund lesen (`Task.detached`) und das Ergebnis auf dem Hauptthread
   setzen. Die Startseite hört nicht mehr auf `store.revision`.
3. **P1** (Kern): Sperre nicht über Neuladen und Checkpoint halten (Zustand kopieren bzw.
   Checkpoint seltener oder entkoppelt schreiben, wie die PWA mit `checkpoint-scheduler.js`).
4. **P5**: Striche ohne Warten auf den Hauptthread speichern (Warteschlange im Hintergrund).

### Optimierungen der PWA, die der iPad-App fehlen

Abgleich vom 05.11.2026. Links, was die PWA macht (Fundstelle in `web/`), rechts, was die iPad-App heute tut.
Sortiert nach Nutzen.

| # | PWA | iPad-App heute | Übernehmen | Status |
|---|---|---|---|---|
| O1 | **Heft-Striche gebündelt**: 350 ms nach der letzten Änderung *ein* `heftOps`-Ereignis, sofort beim Verlassen (`heft.js:334-379`) | Ein Kern-Ereignis **je Strich** (Log, Sync, Änderungsmeldung, Neuzeichnen je Strich) | Striche 350 ms sammeln, dann ein `heftApplyOps` (gibt es im Kern schon) | ✅ Code 05.11. · am Gerät ungeprüft (`heftCommitStrokes`, IDs aus der App) |
| O2 | **Sync wartet beim Schreiben**: 3,5 s Ruhe, solange im Heft geschrieben wird (`sync-cloudflare.js:198, 243`) | 1,5 s nach jeder Änderung, auch mitten im Schreiben | Sync-Pause während des Schreibens | ✅ am Gerät bestätigt 07.11. (Sync unter Last ohne Stall) |
| O3 | **Speichern einer Notiz zeichnet nichts neu** (`render.js:113-146`: `pageUpdate` nur mit Inhalt aus dem Editor → kein Render) | Jedes Speichern (600 ms nach der letzten Taste) zählt `pagesRevision` hoch → ~10 Ansichten laufen neu und holen die **ganze Seite samt Inhalt** nur für Titel/Icon (Tab-Leiste, Seitenleiste, Brotkrumen, Seitenkopf, Rückverweise, Unterseiten, Seitenbaum) | Eigener Zähler nur für Titel/Icon/Ort/Favorit/Archiv; reine Inhaltsänderungen zählen ihn nicht hoch | ✅ Code 05.11. · am Gerät ungeprüft (`Changes.pagesMeta` → `pageMetaRevision`) |
| O4 | **Seitenleiste mit Render-Schlüssel**: baut nur neu, wenn sich Seiten/Arbeitsbereiche wirklich ändern (`render.js:456-473`) | `TreeRows.read` je Speichern: alle Seiten plus ein `childrenOf` **je Zeile** | Mit O3 erledigt; dazu Kinder in einem Kern-Aufruf statt einem je Zeile | ✅ am Gerät bestätigt 07.11.: Seitenleiste baut ohne Hänger; `childrenOf` je Zeile bleibt (unkritisch) |
| O5 | **Handschrift-Erkennung selten**: geschriebene Seite erst nach 15 s Ruhe; Hintergrund-Scan eine Seite je 5 s, **pausiert beim Schreiben** und im Hintergrund (`heft-indexer.js:31-63, 263-363`) | 3,5 s nach dem Strich; Hintergrund-Scan liest je Seite die Auftragsliste **aller Hefte** neu, 2,5 s Pause, keine Pause beim Schreiben | 15 s, Auftragsliste einmal je Durchlauf, Pause beim Schreiben | ✅ Code 05.11. · am Gerät ungeprüft |
| O6 | **Abfragen gemerkt** nach Seiten-/Karten-Revision (`state.js:99-108`), Lernschlange je Stapel bis 2 s gecacht (`state.js:537-577`) | Lernansicht liest die Lernschlange über alle Karten synchron bei jeder Kartenänderung, auch durch Sync (`Cards/ReviewModel.swift:60-79`) | Im Hintergrund, nur für den offenen Stapel | 🟡 am Gerät 07.11.: Kartenübersicht 193 ms, Kern-Sperre 429 ms beim Sync; Bewerten selbst noch synchron |
| O7 | **Suche entprellt** (`search.js:321-325`), Chatliste einmal je Sitzung (`search.js:25-91`) | Befehlspalette: Volltextsuche **und alle Chats mit allen Nachrichten** bei jedem Tastendruck auf dem Hauptthread (`Shell/ShellSheets.swift:60-66`) | Entprellen, im Hintergrund, Chats nur nach Titel | ✅ am Gerät bestätigt 07.11. (4 Suchen ohne Hänger) |
| O8 | **Graph im Worker** (`graph.js:193`, `graph-worker.js`) | Kraft-Layout O(n²) **alle 16 ms auf dem Hauptthread**, bis zu 5000 Seiten (`Graph/GraphModel.swift:113-130`) | Layout im Hintergrund rechnen | ✅ am Gerät bestätigt 07.11. (10 s Simulation ohne Stall; Gitter, Reichweite 200) |
| O9 | **KI-Antwort gedrosselt**: Neuzeichnen höchstens alle 80 ms (`ai.js:378`) | Je Token: Seite zweimal laden, Bild-Anhänge (Base64) neu dekodieren, Anhang-JSON parsen (`Chat/ChatView.swift:128-133`, `Chat/ChatParts.swift:62-75`) | 80 ms drosseln, Anhänge einmal dekodieren | ✅ am Gerät bestätigt 07.11. (Streaming hängerfrei) |
| O10 | „Weißt du's noch?“: einmal je Tag | Bei jeder Kartenänderung alle Stapel und alle Karten (jetzt im Hintergrund) | Einmal je Tag, neu nur, wenn sich die Karte ändert | ✅ am Gerät bestätigt 07.11. |
| O11 | Einstellungen lesen nur bei Bedarf | KI-Bereich der Einstellungen scannt bei **jeder** Änderung alle Hefte (`Settings/SettingsAi.swift:305-310`); Übersicht zählt Konflikte bei jeder Änderung | An eigene Zähler hängen, im Hintergrund | 🟡 am Gerät 07.11.: 258 ms beim Öffnen/Wechsel zu „Darstellung“ · ✅ Code (07.11., `bf594f7`): Darstellung liest im Hintergrund, nachmessen |
| O12 | Bibliothek | `recentPages(alle)` plus Kern-Aufruf je Zeile/Heftkarte im `body` (`Library/LibraryScreen.swift:231-307, 445-514`) | Wie Seitenbaum im Hintergrund lesen | ✅ am Gerät bestätigt 07.11. (Tab-Wechsel ohne Hänger) |

### Startseite lässt sich nicht öffnen

| Punkt | Status | Notiz |
|---|---|---|
| Home-Pille öffnet die Startseite (PWA: Doppelklick auf `#btnHome`, `web/app.js:260`) | ⚠️ | Bewusst abweichend seit 06.11.: am iPad öffnet schon ein Tipp die Startseite (Doppeltipp kam oft nicht an); Wischen über Home · Chat · Karten wählt die Pille (`Shell/Sidebar.swift` `NavPills`) · am Gerät ungeprüft |
| Klick auf den Arbeitsbereich in den Brotkrumen öffnet die Startseite (`data-crumbws`, `web/app.js:486`) | ✅ | `Notes/NoteEditor.swift:580`, einfacher Tipp wie in der PWA; nur in Notizen, nicht im Heft |
| Befehlspalette/Tastatur: Startseite | ❌ | In der PWA ebenfalls nur über Pille und Brotkrumen erreichbar; kein Ersatzweg für Hefte |

---

## Überblick

Stand der Code-Prüfung je Bereich (Zählung der Zeilen unten, ⚪ nicht mitgezählt):

| Bereich | ✅ | 🟡 | ❌ | Anteil ✅ |
|---|---|---|---|---|
| 1. Shell & Navigation | 81 | 20 | 6 | 76 % |
| 2. Seiten & Editor | 37 | 9 | 4 | 74 % |
| 3. Heft | 25 | 7 | 3 | 71 % |
| 4. KI-Chat & Karten/Lernen | 26 | 10 | 8 | 59 % |
| 5. Einstellungen, Sync, Backup | 15 | 7 | 5 | 56 % |

Manche Zeilen fassen mehrere Punkte zusammen; die Zahlen zeigen also die Richtung, kein exaktes Maß.

Größte Lücken neben der Leistung: Seiten-Cover,
Fächerliste in den Einstellungen (Fach-Zuordnung ist erledigt), Schulnoten, Lernanalyse, Daily-Notizen,
Mehrfachauswahl (Blöcke, Chats), Stapel/Tabs per Ziehen ordnen.

---

## 1. Shell & Navigation

### 1.1 Gerüst
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Boot-Splash mit Phasentext und 12-s-Hinweis „Neu laden“ | 🟡 | `App/Impala67App.swift:24` nur Spinner |
| Startfehler wird angezeigt | ✅ | `App/Impala67App.swift:21-22` |
| Drei Spalten: Seitenleiste / Mitte / KI-Panel | ✅ | `Shell/RootView.swift:18-32` |
| Tablet-Breite: KI-Panel als Overlay | 🟡 | Panel fest in der Spalte (`RootView.swift:28`) |
| Schmales Layout: eine Spalte | 🟡 | Nur Systemverhalten der Split-View |
| Dialoge als Sheet, Hintergrund schließt | ✅ | `Shell/ShellSheets.swift:30` |

### 1.2 Seitenleiste: Kopfpillen
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Home-Pille, Label nur aktiv | ✅ | `Shell/Sidebar.swift:22` |
| Chat-Pille → Chat-Verlauf | ✅ | `Sidebar.swift:24-26` |
| Karten-Pille → Stapelbaum | ✅ | `Sidebar.swift:28` |
| Suchen-Pille → Befehlspalette | ✅ | `Sidebar.swift:30-33` |

### 1.3 Seitenbaum
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| „★ Favoriten“ oben | ✅ | `Shell/PageTree.swift:290` |
| Arbeitsbereich-Kopf: Einklappen, „Neue Seite in …“ | ✅ | `PageTree.swift:22-25` |
| Einrückung je Ebene, aktive Zeile getönt | ✅ | `PageTree.swift:220, 283` |
| ⋯-Knopf in der Zeile | ✅ | ⋯-Knopf in der aktiven Zeile (`PageTree.swift:223`) und Kontextmenü (`PageTree.swift:249`) · am Gerät ungeprüft |
| Umbenennen direkt in der Zeile | 🟡 | Alert mit Textfeld (`PageTree.swift:73-79`) |
| Ziehen: davor/danach/hinein, Kopf = Wurzel | ✅ | `Shell/TreeDrop.swift:76-79` |

### 1.4 Seiten-Kontextmenü
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| In neuem Tab öffnen | ✅ | `PageTree.swift:90` |
| Duplizieren, Als Vorlage, Favorit | ✅ | `PageTree.swift:92-101` in PWA-Reihenfolge · am Gerät ungeprüft |
| Vorlesungsübersicht | ✅ | `PageTree.swift` |
| Fach… | ✅ | Kern `impala-fach` (Golden-Tests gegen `fach.js`), `Notes/SubjectSheet.swift` · am Gerät ungeprüft |
| Verschieben nach… | ✅ | `PageTree.swift:102`, `Shell/TreeDrop.swift:147-185` · am Gerät ungeprüft |
| Aus Archiv holen | 🟡 | Nur in der Bibliothek |
| Archivieren / Löschen | ✅ | `PageTree.swift:103-110` · am Gerät ungeprüft |

### 1.5 Stapelbaum
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Kopf „Stapel“ mit Neuer Stapel | ✅ | `Cards/DeckTree.swift:19-30` |
| Unterstapel eingerückt, einklappbar | ✅ | `DeckTree.swift:127` |
| Zähler fällig/neu | ✅ | `DeckTree.swift:135-136` |
| Antippen lernt, Menü (Feynman, Umbenennen, Papierkorb …) | ✅ | `DeckTree.swift:67, 184-202` |
| Stapel per Ziehen ordnen | ❌ | fehlt |

### 1.6 Chat-Verlauf
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| „+ Neuer Chat“ | ✅ | `Chat/ChatList.swift:21-27` |
| Zeile mit Datum, aktiver Chat markiert | ✅ | `ChatList.swift:79, 88-91` |
| Umbenennen, Löschen mit Rückfrage | ✅ | `ChatList.swift:54-64, 98-108` |
| Mehrfachauswahl | ❌ | fehlt |
| Leerzustand | ✅ | `ChatList.swift:37` |

### 1.7 Offene Tabs in der Seitenleiste
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Kopf „Offene Tabs“ mit „+“ | ✅ | „+“ mit Neuer Chat, Notiz, Heft, Vorlage, Suche (`Sidebar.swift:235-251`) |
| Zeile mit Symbol, aktiv, ✕ | ✅ | `Sidebar.swift:172-216` |
| Umschaltbar (Tabs oben / Seitenleiste) | ✅ | Exakt baugleich wie PWA (`SettingsSheet.swift`, `RootView.swift`, `NoteEditor.swift`, `HeftScreen.swift`) |

### 1.8 Fußleiste, Breite, Einklappen
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Gemini Notebook | ✅ | `Sidebar.swift:49` |
| Wissensgraph | 🟡 | Nur Erkunden, keine Modi (`Graph/GraphView.swift:49-54`) |
| Bibliothek, Papierkorb, Einstellungen | ✅ | `Sidebar.swift:51-53` |
| Breite ziehen, Doppelklick = Standard | 🟡 | Systemteiler |
| ☰ einklappen, Zustand gemerkt | 🟡 | Zustand nicht gespeichert (`ShellModel.swift:39-43`) |

### 1.9 Tab-Leiste
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| ☰, Zurück/Vor mit Verlauf | ✅ | Exakt wie PWA/Android: Home als feste Basis, Kontext-Menü mit Verlaufssprung, Überspringen gelöschter Seiten, ⌘[/⌘]/Escape (`ShellModel.swift`, `TabBar.swift`, `RootView.swift`) |
| Chip mit Titel, ✕, Nachbar wird aktiv | ✅ | `TabBar.swift:128-148` |
| Chat-, Karten-, Gemini-Tab | ✅ | `TabBar.swift:98-106` |
| „+“ mit Neuer Chat | ✅ | „+“ mit Neuer Chat, Notiz, Heft, Vorlage, Suche (`TabBar.swift:70-88`) |

### 1.10 Seitenkopf
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Teilen mit Exportmenü | ✅ | Teilen-Menü mit PDF, Markdown und Link (`Notes/NoteEditor.swift:513-535`) wie `shareMenuHtml` der PWA · am Gerät ungeprüft |
| Stern Favorit | ✅ | `NoteEditor.swift:398-411` |
| ⋯: PDF, Markdown, Link, Karten aus Markierungen, Duplizieren, Archiv, Papierkorb | ✅ | `NoteEditor.swift:414-456` |
| ⋯: Vorlage, Verschieben, Rückgängig/Wiederholen, Icon | ✅ | `Notes/NoteEditor.swift:551-645` im ⋯-Menü wie in PWA `moreMenuHtml` · am Gerät ungeprüft |
| ⋯: Vorlesungsübersicht | ✅ | `NoteEditor.swift` |
| ⋯: Verlauf | ✅ | `Notes/PageHistorySheet.swift` (Kern `pageHistory`), Wiederherstellen mit Rückgängig · am Gerät ungeprüft |
| ⋯: Fach | ✅ | Kern `impala-fach` (Golden-Tests gegen `fach.js`), `Notes/SubjectSheet.swift` · am Gerät ungeprüft |
| Rückverweise und Brotkrumen | ✅ | `NoteEditor.swift:73, 366-374` |

### 1.11 KI-Panel
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Status-Chip, Verlauf, Neuer Chat, im Tab öffnen, einklappen | ✅ | `Chat/AiPanel.swift:21-107` |
| Seitenkontext-Chip, Anhänge | ✅ | `Chat/ChatView.swift:237-318` |
| Modellmenü, Vorschläge, Enter sendet, Diktat | ✅ | `ChatView.swift:67-177, 322-349` |

### 1.12 Startseite
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Startseite öffnen | ✅ | siehe Abschnitt 0 · am Gerät ungeprüft |
| Datum, Begrüßung mit Name | ✅ | `Home/HomeScreen.swift:47, 97, 230` |
| „+ Neue Seite“, „Startseite anpassen“ | ✅ | `HomeScreen.swift:56, 69` |
| Konflikt- und Backup-Hinweis | ✅ | `HomeScreen.swift:72-95` |
| Weitermachen, Angeheftet, „Weißt du's noch?“ | ✅ | `Home/HomeCards.swift` |
| Heute fällig, Diese Woche gelernt, Ziel ändern | ✅ | `HomeScreen.swift:210-222`, `Home/HomeWeek.swift` |
| Tagesartikel mit Verlauf, „Erneut versuchen“ | ✅ | `Home/HomeArticle.swift` |
| Lernanalyse-Ausklapper | ❌ | fehlt |
| Leerzustand | ✅ | `HomeScreen.swift:190` |

### 1.13 Papierkorb und Archiv
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Papierkorb mit Seiten, Stapeln und Karten | ✅ | `Shell/ShellSheets.swift` `TrashSheet`; Karten gelöschter Stapel nur beim Stapel (wie `orphanTrashedCards`) |
| Filter Alle/Seiten/Stapel/Karten | ✅ | Segment-Filter in TrashSheet (ShellSheets.swift) |
| Wiederherstellen, endgültig löschen | ✅ | Wischen in `TrashSheet`; Seiten ohne Rückfrage, Stapel/Karten mit Rückfrage wie die PWA |
| Papierkorb leeren mit Rückfrage | ✅ | `ShellSheets.swift:169-176` |
| Archiv mit Filter, „Aus Archiv holen“ | ✅ | `Library/LibraryScreen.swift:770-800` |

### 1.14 Dialoge
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Neu: Notiz, Heft, Vorlage | 🟡 | Menü statt Dialog |
| Namenseingabe | 🟡 | Alert |
| Verschieben nach… | ✅ | `PageTree.swift:102`, `Shell/TreeDrop.swift:147-185` · am Gerät ungeprüft |
| Fach-Dialog | ✅ | zeigt zusätzlich, woher das Fach kommt; Kern `impala-fach` (Golden-Tests gegen `fach.js`), `Notes/SubjectSheet.swift` · am Gerät ungeprüft |
| Verlauf-Dialog mit Wiederherstellen | ✅ | `Notes/PageHistorySheet.swift` · am Gerät ungeprüft |
| Icon- und Cover-Wahl für Seiten | ✅ | Icon und Cover (9 Muster wie die PWA oder eigenes Bild) im Editor (`Notes/NoteCover.swift`) · am Gerät ungeprüft |

### 1.15 Menüs
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Schließt bei Tipp daneben, am Auslöser | ✅ | native Menüs |
| Halten öffnet Zeilenmenü | ✅ | `PageTree.swift:233` |
| Escape schließt Menü/Overlay/Palette | 🟡 | nur Sheet-Schließen |

### 1.16 Toasts
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Toast unten, kurz sichtbar | 🟡 | Nur im Editor (`Notes/NoteModel.swift:33-42`) |
| Erfolgs-/Fehlerfarbe | ✅ | Randfarbe nach `ToastStyle` wie `.toast.success/.error` (`NoteEditor.swift`) |
| Toast mit Aktion (z. B. Rückgängig) | ❌ | fehlt |

### 1.17 Tastaturkürzel
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| ⌘K Befehlspalette | ✅ | `Shell/RootView.swift:164-169` |
| ⌥Leertaste Diktat | ✅ | `Shell/RootView.swift` `ShellShortcuts`: öffnet das KI-Panel und schaltet dort das Diktat (wie `VOICE.toggle("side")`) |
| Escape-Kaskade | 🟡 | nur Sheet |
| Chat: Enter / ⇧Enter | ✅ | `Chat/ChatView.swift:146-151` |
| Editor ⌘Z / ⇧⌘Z | ✅ | `Notes/BlockTextView.swift:158-159` |
| Lernen: Leertaste, 1–4 | ✅ | `Cards/ReviewScreen.swift:111-116, 337-342` |
| Palette mit ↑ ↓ Enter | 🟡 | keine eigene Steuerung |

### 1.18 Befehlspalette
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Eingabe, Seiten mit Auszug, Chats | ✅ | `ShellSheets.swift:60-113` |
| Aktionen: Neue Seite, Karten, Hell/Dunkel, Archiv, Papierkorb, Sync, Einstellungen, Gemini | ✅ | `ShellSheets.swift:122-141` |
| Präfix „Archiv · “ | 🟡 | fehlt |
| „In neuem Tab öffnen“ | ✅ | Kontextmenü an Suchtreffern (`ShellSheets.swift`); PWA: Palette des „+“-Tabs |
| Daily-Notiz heute / Daily-Kalender | ⚪ | nicht geplant (Nutzer, 12.11.) |

### 1.19 Bibliothek, PDF, Graph, Gemini Notebook
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Bibliothek: Ansichten, Filter, PDF hinzufügen | ✅ | `Library/LibraryScreen.swift` (Papier-Panel, Reiter, Baum als Karten) |
| Heft-Regal: Holzbretter, Cover je Heft, Mappen, Deko | ✅ | `Library/HeftShelf.swift`, `Library/ShelfStyle.swift` |
| Eigenes Cover-Bild (Heft) | ✅ | `setCoverImage`, Heftoptionen und „Neues Heft“ |
| Ordner (Heft-Regal) | 🟡 | Anlegen, Öffnen, Löschen, Verschieben über Heftoptionen; kein Ziehen |
| PDF-Ansicht: Zoom, Teilen | ✅ | `Library/PdfScreen.swift` |
| Wissensgraph: Modi, Suche, Analyse | 🟡 | nur Erkunden |
| Gemini Notebook mit Inbox | 🟡 | keine Inbox (`Graph/NotebookView.swift`) |

### 1.20–1.22 Hinweise, Darstellung, Querschnitt
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Performance-Hinweis „Einschalten“ | ❌ | nur Schalter in Einstellungen |
| Update-Hinweis | ⚪ | App Store statt Updater |
| Dichte, Schriftgröße, Bewegung, Tab-Lage, Hell/Dunkel | ✅ | `Theme/Tokens.swift`, `SettingsSheet.swift` |
| Seitenleiste eingeklappt gemerkt | 🟡 | KI-Panel ja, Seitenleiste nein |
| Leerzustände Seiten/Stapel/Chats | ✅ | |
| Wortlaut „Der Papierkorb ist leer.“ / „Das Archiv ist leer.“ | 🟡 | Papierkorb stimmt (`Shell/ShellSheets.swift:318`); Bibliothek: „Archiv ist leer“ (`Library/LibraryScreen.swift:685`) |
| Tab-Reihenfolge per Ziehen | ❌ | fehlt |
| Tabs und Aufklappzustand geräteübergreifend | ✅ | `Shell/ShellModel.swift:187-189` |

---

## 2. Seiten & Markdown-Editor

### 2.1 Seitenkopf und Aktionen
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Brotkrumen (Arbeitsbereich, Ahnen, Titel) | ✅ | `Notes/NoteEditor.swift:565-640` |
| Archiv-Banner mit Wiederherstellen | ✅ | `NoteEditor.swift:301-325` |
| Icon-Auswahl | ✅ | `Notes/NoteEditor.swift:357-465` `NoteEmoji` (Klick öffnet Picker), `IconPickerSheet` mit 24 Emojis, Entfernen, Schließen über `patchPage` / `pageUpdate`-Event; auch im ⋯-Menü · am Gerät ungeprüft |
| Cover (Vorlagen, eigenes Bild) | ✅ | `Notes/NoteCover.swift`: Muster wie `.cover-*` der PWA, eigenes Bild, Icon ragt ins Cover · am Gerät ungeprüft |
| Platzhalter „Unbenannt“ | ✅ | `Notes/NoteEditor.swift:68` `TextField("Unbenannt", ...)`, `PageStyle.swift:9` · am Gerät ungeprüft |
| Teilen-Menü (PDF, MD, Link) | ✅ | `Notes/NoteEditor.swift:513-535` Menu mit PDF, Markdown und Link wie `shareMenuHtml` der PWA · am Gerät ungeprüft |
| Als Vorlage im ⋯ | ✅ | `NoteEditor.swift` (`PageChrome`) & Seitenbaum |
| Verschieben im ⋯ | ✅ | `NoteEditor.swift` (`TreeMoveSheet`) & Seitenbaum |
| Verlauf (Seitenversionen) | ✅ | `Notes/PageHistorySheet.swift` · am Gerät ungeprüft |

### 2.2 Grundlagen
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Markdown ↔ Blöcke über den Kern | ✅ | `Notes/NoteModel.swift:5` |
| Automatisch speichern | ✅ | 450 ms statt 600 ms (`Notes/NoteModel.swift:121`) wie in der PWA · am Gerät ungeprüft |
| Rückgängig-Schritte beim Tippen | ✅ | `NoteModel.swift:140` |
| Speichern beim Verlassen | ✅ | `NoteEditor.swift:26-31` |
| PDF-Ansicht im Editor | ❌ | fehlt |

### 2.3 Blockgriff, Blockmenü, Auswahl
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| „+“ fügt Absatz mit „/“ ein | ✅ | `NoteEditor.swift:191-207` |
| Griff: Menü, Ziehen verschiebt | ✅ | `NoteEditor.swift:211-238` |
| Mehrere Blöcke auswählen | ✅ | Blockmenü „Auswählen (mehrere)“, dann Antippen; Leiste mit Kopieren, Ausschneiden, Duplizieren, Löschen (`Notes/NoteCommands.swift` „Mehrere Blöcke“) · am Gerät ungeprüft |
| Umwandeln (11 Typen), Duplizieren, Kopieren, Lernkarte | ✅ | `Notes/BlockViews.swift:127-144` |
| Farbe (Text/Hintergrund) | 🟡 | Textfarbe ungeprüft |
| Dateien per Ziehen/Einfügen | ✅ | `NoteEditor.swift:90-95` |

### 2.4 Slash-, Link-Menü, Formatierung
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| „/“-Menü mit 22 Einträgen, Filter, Pfeiltasten | ✅ | `Notes/NoteCommands.swift:26-28, 251-259` |
| „[[“-Link-Menü | ✅ | `NoteCommands.swift:235, 289` |
| Links klicken, nur sichere Protokolle | ✅ | `Notes/InlineMarkdown.swift:45` |
| ⌘B/I/U/E, ⇧⌘S, ⌘K | ✅ | `Notes/BlockTextView.swift:151-157` |
| ⇧⌘H „Farbe wiederholen“ | 🟡 | ist Markieren |
| Markdown-Zeichen ausblenden | 🟡 | nur abgeblendet |
| Inline-Formel mit Popover | 🟡 | kein Popover |
| Schwebende Formatierungsleiste | ⚪ | iPad-Zusatz |

### 2.5 Markdown-Kürzel und Tastatur
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| #, ##, ###, Listen, To-do, Zitat live | ✅ | `Notes/BlockOps.swift:276-287` |
| „---“, „```“, „$$“ live | ✅ | `Notes/NoteModel.swift` `edit` (wie `web/editor.js:1064-1085`) |
| Enter, ⇧Enter, Tab/⇧Tab, Entf, ↑ ↓ | ✅ | `BlockTextView.swift:144-150` |
| ⌘D, ⇧⌘↑/↓, Esc | ✅ | `BlockTextView.swift:160-162` |
| ⌘A zweistufig, ⇧⌘0–8 | 🟡 | ⌘A zweistufig da (Text, dann alle Blöcke); ⇧⌘0–8 fehlt |
| Tabellen-Tastatur | ✅ | `Notes/TableEditor.swift` |

### 2.6 Blocktypen
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Text, Überschriften, Listen, Zitat, Trennlinie | ✅ | `BlockViews.swift:54-70` |
| Tabelle | ✅ | `TableEditor.swift` |
| Callout | ✅ | `BlockViews.swift:357-366` |
| Callout-Farbe wechseln | ✅ | Tipp auf den Punkt schaltet reihum wie die PWA (`NoteModel.cycleCalloutColor`) |
| Toggle | ✅ | `BlockViews.swift:429` |
| Spalten, Umbruch bei schmaler Breite | 🟡 | feste Zeile |
| Code: Sprache, Kopieren | ✅ | `BlockViews.swift:244-285` |
| Code: Syntax-Hervorhebung | ❌ | fehlt |
| Mermaid/SVG | ✅ | `Notes/RichView.swift:156-173` |
| Formelblock mit Vorschau | 🟡 | kein Popover |
| Bild mit Unterschrift | 🟡 | Alt-Text nur Platzhalter |
| Datei-Zeile (QuickLook) | ✅ | `BlockViews.swift:355` |
| Video/Audio, PDF-Ansicht im Block | ❌ | nur Datei-Zeile |
| PDF-Text beim Hochladen übernehmen | ❌ | fehlt |
| Heft-Block mit Vorschau | 🟡 | ohne Vorschau |
| Unterseiten, Verwandte Seiten | ✅ | `Notes/NoteFooter.swift`; Vektoren von Apples Satzmodell statt Bekko (`Notes/SemanticIndex.swift`, nur lokal, Index im Hintergrund) · am Gerät ungeprüft |
| Datenbankansicht (Vorlesungsübersicht) | ✅ | `DatabaseView.swift`: Karten in Liquid Glass, Auswahl-Menü, Kalender |

---

## 3. Heft

Eigene Werkzeug-Pille wie `heft-pill` der PWA (Liquid Glass), keine Apple-Werkzeugleiste.

### 3.1 Werkzeuge
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| 3 Stift-Favoriten, Marker, Radierer, Lasso, Farben, Dicke, Nur-Stift | ✅ | `Heft/HeftToolbar.swift` |
| Leiste einklappen | ✅ | `HeftToolbar.swift` (`collapsed`) |
| Lineal | ⚪ | nur iPad (PencilKit) |
| Laser | ✅ | rote, verblassende Spur, nie gespeichert (`Heft/HeftLasso.swift` `HeftLaserLayer`) · am Gerät ungeprüft |
| Rückgängig/Wiederholen | ✅ | `HeftToolbar.swift`, `HeftCanvas.swift` (`undo`/`redo`) |
| Bilder-Menü (Auswahl, Text, Bild, Kamera, Handschrift) | ✅ | `Heft/HeftScreen.swift:160-177` |

### 3.2 Seiten hinzufügen und blättern
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Seitenzähler ‹ n / m › | ✅ | `HeftScreen.swift:263-275` |
| KI-Knopf im Heft | ⚪ | nicht geplant: KI-Knopf oben rechts reicht (Nutzer, 12.11.) |
| „+“ Seite, Papier wählen/umstellen | ✅ | `HeftScreen.swift:189-199, 512-535` |
| Position Davor/Danach/Am Ende | ✅ | Plus-Menü (`Heft/HeftScreen.swift` `addPage(at:)`) |
| Bild/PDF importieren, Scannen | ✅ | `HeftScreen.swift:537-540` |

### 3.3 Bilder, Text, Lasso
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Bilder/Texte auswählen, verschieben, skalieren | ✅ | `Heft/HeftObjectEdit.swift:24-110` |
| Text direkt auf der Seite schreiben | 🟡 | Sheet statt direkt |
| Lasso wie GoodNotes: Umkreisen, Rahmen mit Griffen, Verschieben, Skalieren, Farbe, Duplizieren, Kopieren/Ausschneiden/Einfügen, Löschen (mit Rückgängig) | 🟡 | eigenes Lasso statt `PKLassoTool` (`Heft/HeftLasso.swift`); nur Striche, Bilder/Textfelder noch nicht · am Gerät ungeprüft |
| Entf löscht Auswahl | 🟡 | nur über Leiste |

### 3.4 Seitenübersicht
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Raster, Springen, Ziehen sortiert | ✅ | `Heft/HeftPagesSheet.swift:111-162` |
| Auswählen, Löschen mit Bestätigung | ✅ | `HeftPagesSheet.swift:55-92` |
| Auto-Scroll beim Ziehen | ❌ | fehlt |
| Export/Import aus der Auswahl | ❌ | nur Löschen |
| Verlauf (Stände, Wiederherstellen) | ✅ | Reiter „Verlauf“ der Seitenübersicht (`Heft/HeftHistory.swift`), sichert vorher den jetzigen Stand · am Gerät ungeprüft |

### 3.5 Gesten
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Druck, Glättung, Radierer ganze Striche | ✅ | `Heft/HeftInk.swift`, `HeftCanvas.swift:91` |
| Formerkennung nach Halten | 🟡 | 450 statt 550 ms |
| Finger scrollt, Stift zeichnet | ✅ | `HeftCanvas.swift:29` |
| Pinch-Zoom | ✅ | 0,4–6 × Passbreite wie PWA (`Heft/HeftCanvas.swift:583-587`) |
| Doppeltipp zoomt 2,2× | ✅ | `Heft/HeftCanvas.swift` `handleDoubleTap` (Finger; Faktoren relativ zur Passbreite wie `heft-viewport.js`) |
| Trackpad-Scrollen blättert, ⌘+Scrollen zoomt | ❌ | fehlt |
| Am Ende hochziehen = neue Seite | ✅ | `onPullAdd` (`Heft/HeftScreen.swift`) |

### 3.6 Darstellung und Aktionen
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Papierarten | ✅ | `Heft/HeftPaper.swift` |
| Seiten untereinander scrollen | ✅ | durchgehende Fläche (`Heft/HeftCanvas.swift:5-10`), ‹ › springen nur |
| Seite löschen/verschieben | ✅ | `HeftPagesSheet.swift`, `HeftScreen.swift:300` |
| ⋯-Menü (Favorit, Icon, Duplizieren) | 🟡 | nur Export und Link; Verlauf als Reiter „Verlauf“ der Seitenübersicht (siehe 3.4) |
| Automatische Sicherung (Verlauf) | ✅ | höchstens alle 10 Min., 20 Stände / 24 h, nur lokal (`Heft/HeftHistory.swift`) · am Gerät ungeprüft |

### 3.7 Import, Export, Scanner, Handschrift
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Import-Dialog mit Ziel und Position | 🟡 | direkter Dateiwähler |
| PDF/Bilder als Heftseiten | ✅ | `Heft/HeftImport.swift` |
| Export PDF/PNG mit Optionen | ✅ | `Heft/HeftExport.swift:298-433` |
| Export „Alle Handschrift“ (JSON) | ⚪ | nicht geplant (Nutzer, 12.11.) |
| Scanner | ⚪ | VisionKit |
| Hintergrund-Erkennung für Suche/KI | 🟡 | Apple Vision statt ONNX |
| Fortschritt „x % analysiert“ | ⚪ | nicht geplant (Nutzer, 12.11.) |
| Abschreiben (Schreibübung) | ⚪ | nicht geplant (Nutzer, 12.11.) |
| Zwei Geräte gleichzeitig | ✅ | `HeftScreen.swift:92` |

---

## 4. KI-Chat und Karteikarten

### 4.1 Composer und Nachrichten
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Enter sendet, Stopp, Teilantwort bleibt | ✅ | `Chat/ChatView.swift:146-185` |
| Anhänge (Foto/Datei/Heftseite), Seitenkontext | ✅ | `ChatView.swift:162-318` |
| Langer Text → Anhang „geklebter-text.txt“ | ✅ | `Chat/ChatView.swift` `typed` (nur Einfügen über die Tastatur, nicht Bearbeiten/Diktat) |
| Bearbeiten, Kopieren, Länger/Kürzer | ✅ | `Chat/ChatParts.swift:88-97` |
| Markdown mit Formeln | 🟡 | Formeln unbelegt |
| Gedankengang (live mit Vorschau) | 🟡 | Vorschau fehlt |
| Werkzeug-Chips, Änderungskarte mit Rückgängig | ✅ | `ChatParts.swift:198-333` |
| „Änderungen anzeigen“ / Seiten-Diff | ❌ | fehlt |
| Rückfrage mit Optionsknöpfen | ✅ | `ChatParts.swift:233-240` |

### 4.2 Chat-Start, Vollbild, Liste
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Begrüßung, vier Vorschläge | ✅ | `ChatView.swift:66-109` |
| Leucht-Kugel im leeren Chat | ❌ | fehlt |
| Vollbild-Kopf „✦ Titel“ mit Status | 🟡 | fehlt |
| „Neuer Chat“ gesperrt während Lauf | ✅ | `Chat/ChatList.swift:27-35` |
| Mehrfachauswahl | ❌ | fehlt |

### 4.3 Modellwahl
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Menü Modell / Denkaufwand | 🟡 | ein Menü (`ChatView.swift:322-350`) |
| Favoriten ★ | ❌ | fehlt |
| Gruppen je Quelle | ✅ | Untermenü je Quelle (`Chat/ChatView.swift:376-389`) |
| Denkaufwand Automatisch/Reduziert | ❌ | nur Ein/Aus |

### 4.4 Karten: Übersicht, Editor, Lernen
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Kopf: Statistik, Optionen, ＋ Neu (Karte, Stapel, Import, Export) | ✅ | `Cards/CardsScreen.swift:52-77` |
| Tabs Stapel/Browser/Statistik/Archiv | 🟡 | über Kopf/Menü statt Tabs |
| Gemischt, Feynman | ✅ | `CardsScreen.swift:107-108` |
| Karten-Editor mit Stapelwahl, Lücken | ✅ | `Cards/CardEditorSheet.swift` |
| Speichern verlangt Vorderseite | 🟡 | auch nur Rückseite erlaubt |
| Lückentext aus Seiten-Markierungen | ✅ | ⋯-Menü „Karten aus Markierungen“ (`Notes/NoteEditor.swift:638`) |
| Lernen: Antwort zeigen, 1–4, Zähler, Bearbeiten, Aussetzen, Rückgängig | ✅ | `Cards/ReviewScreen.swift` |
| Optionen im Lernen | ✅ | `ReviewScreen.swift` (Fußleiste) |
| Selbsteinschätzung Sicher/Unsicher/Geraten | ✅ | `ReviewScreen.swift`: Chips vor dem Aufdecken, decken wie in der PWA nicht selbst auf |
| Feynman: erklären, Diktat, prüfen | ✅ | `Cards/Feynman.swift` |

### 4.5 Browser, Import/Export, Archiv
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Suche, Bearbeiten, Aussetzen, Löschen | ✅ | `CardsScreen.swift:337-363` |
| Sortierbare Spalten, Intervall/Fehler | ✅ | Sortiermenü (Fällig, Vorderseite, Intervall, Fehler, Status; gemerkt), Intervall/Fehler je Zeile (`Cards/CardsScreen.swift` `BrowserSort`) · am Gerät ungeprüft |
| Zeilenaktion Archivieren | ✅ | `CardsScreen.swift:355` |
| Export TXT/CSV | 🟡 | kein Anki-Paket |
| Import mit Vorschau und Duplikaten | ✅ | `Cards/CardTransfer.swift:155-193` |
| Archiv: Stapel/Karten wiederherstellen | ✅ | `Cards/CardArchiveScreen.swift` |

### 4.6 Statistik und Lernanalyse
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Kennzahlen, 30 Tage, Prognose, Behalten, schwierigste Karten | ✅ | `Cards/StatsScreen.swift:214-309` |
| Aktivitäts-Heatmap | ✅ | 53 Wochen × 7 Tage wie `heatmapHtml` (`Cards/StatsScreen.swift` `ActivityHeatmap`) · am Gerät ungeprüft |
| Lern-Analyse im Statistik-Tab (Sitzungen, Tageszeit, Problemzonen, Experimente) | ❌ | fehlt |
| Lernanalyse auf der Startseite | ❌ | fehlt |
| Wochenziel-Prognose | 🟡 | Balken ohne Prognose |

### 4.7 Lernzeit, Fächer, Schulnoten
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Wochenwidget, Ziele, Serie | ✅ | `Home/HomeWeek.swift`, `Home/LearningTime.swift` |
| Erfassung, „Lernst du noch?“ | ✅ | `LearningTime.swift:131, 256-265` |
| Pausen-Erinnerung nach 40 min | 🟡 | nur Schalter (standardmäßig aus wie überall), keine Logik |
| Fächer (Liste, Zuordnung, Menüeintrag) | 🟡 | Zuordnung und Menüeintrag vorhanden: Fach-Dialog über „Fach…“ im Seitenbaum und im ⋯-Menü der Notiz (`Notes/SubjectSheet.swift`, Erkennung im Kern `impala-fach`); Fächerliste in den Einstellungen fehlt |
| Schulnoten | ❌ | fehlt (Kern-API vorhanden) |

---

## 5. Einstellungen, Sync, Backup

### 5.1 Aufbau und Übersicht
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Sechs Bereiche, Suche, letzter Bereich gemerkt | ✅ | `Settings/SettingsSheet.swift:12-112` |
| Speichern-Leiste, Verwerfen-Dialog | ❌ | fehlt |
| Status-Kacheln | ✅ | `SettingsSheet.swift:220-285` |
| Update-Knopf | ⚪ | App Store |

### 5.2 Darstellung, KI, Lernen
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Darstellung komplett (bis auf „+ Fach“-Chips) | ✅ | `SettingsSheet.swift:355-494` |
| „+ Fach“-Chips | ❌ | fehlt |
| KI: Modell, Suche, manuelle ID, Quellen, Schnellvorlagen | ✅ | `Settings/SettingsAi.swift` |
| KI: Modell-Favoriten, Gruppen, Status-Banner | 🟡 | Gruppen und Statuszeile da (`Settings/SettingsAi.swift:26-50`), Favoriten fehlen |
| Semantische Suche | 🟡 | Status „Verwandte Seiten“ in `SettingsAi.swift`; Suche nach Bedeutung im Suchfeld fehlt noch |
| Handschrift: Export, Abschreiben | ⚪ | nicht geplant (Nutzer, 12.11.) |
| Lernen und Experimente (bis auf Pre-Testing, Wissenslücken) | ✅ | `Settings/SettingsLearning.swift` |
| Experimente Pre-Testing, Wissenslücken-Detektor | ❌ | fehlt |

### 5.3 Cloudflare-Sync
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Statuskarte, Hauptknopf je Zustand | 🟡 | „unterbrochen“ fehlt, nur „Verbinden“ |
| Trennen, URL, Schlüssel erzeugen/kopieren | ✅ | `SettingsSheet.swift:810-871` |
| QR per Kamera, Kopplungs-QR | ✅ | `Sync/CloudflarePairing.swift` |
| QR aus Foto/Screenshot | ❌ | fehlt |
| Cloud-Speicher, „Cloud leeren“ | ✅ | `SettingsSheet.swift:944-966` |

### 5.4 Google Drive und Backup
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Status, Anmelden/Abmelden, Fortschritt, Uhr-Warnung | ✅ | `Settings/SettingsDrive.swift`, `Sync/DriveController.swift` |
| Fehlertexte, Ergebnis-Toasts | 🟡 | Wortlaut/Toasts abweichend |
| Intervall, nach jeder Änderung, Tokens | ✅ | `SettingsDrive.swift:101-134` |
| Sichern beim Schließen | 🟡 | nur Wechsel in den Hintergrund belegt |
| Backup erstellen/importieren | ✅ | `Settings/SettingsData.swift` |
| Backup-Ampel | 🟡 | nur Zeitstempel |
| Workspace-Export | 🟡 | .md statt ZIP |

### 5.5 Konflikte, App & Speicher, Profiler
| Punkt | Status | Fundstelle / Notiz |
|---|---|---|
| Konfliktansicht: Zähler, Navigation, alle lösen, Vergleich | ✅ | `Sync/ConflictsSheet.swift`, `Sync/ConflictCompare.swift` |
| Speicheranzeige, Gefahrenzone, Beta-Design | ✅ | `SettingsSheet.swift:584-621`, `SettingsData.swift:201-269` |
| Profiler: Schalter, Kopieren, Export, Löschen | ✅ | `SettingsSheet.swift:653-695` |
| Profiler-Modus „Alle Messpunkte“ | ❌ | fehlt; Hänger ohne Namen/Quelle (siehe Abschnitt 0) |
| Stapel-Optionen (Limits, Leech, Erben) | ✅ | `Cards/CardTransfer.swift:20-45` |
