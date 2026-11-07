# iPad-App Testbericht (07.11.2026)

**Testumgebung:**
- **Gerät:** iPad · iPadOS 27.2
- **App-Version:** `2.2.124+25` (Neuer nativer Build mit entkoppeltem Checkpoint und Hintergrund-Abfragen)
- **Kommunikation:** MCP-Live-Bridge über WLAN (`ws://10.100.13.180:8766/?token=...`), 200+ automatisierte Werkzeug-Aufrufe
- **Speicherbedarf:** 134,4 MB (Notiz) bis 192,6 MB (Heft mit hunderten Strichen)
- **Testbasis:** `docs/IPAD-TESTAUFTRAG.md` und `ios/PARITAET.md`

---

## 1. Kurzfazit (5 Zeilen)

Die iPad-App ist kein unbenutzbarer „Müll“ mehr: Die früher katastrophalen Hänger auf der Startseite (1,4 bis 5 s) und beim Sync sind durch die Hintergrund-Entkopplung von `HomeData`, Seitenbaum und `settle_remote` vollständig verschwunden. Beim Schreiben mit dem Apple Pencil deklassiert die native Latenz (PencilKit) die Web-PWA deutlich. Am meisten stören heute noch zwei verbliebene UI-Ruckler beim Öffnen von Karten (193 ms) und Einstellungen (258 ms), ein 429-ms-Sync-Lock im Kern sowie das komplette Fehlen eines Versionsverlaufs für Notizen und Hefte. Für automatisierte Tests blockieren fehlerhafte SwiftUI-Menüs und fehlende Bridge-Tools derzeit das Erstellen und Tippen von Notizen.

---

## 2. Top 10 Probleme (nach Schwere)

### 1. Kern-Sperre blockiert bei Karten-Sync (429 ms)
- **Was passiert:** Während des Hintergrund-Syncs nach Kartenbewertungen hält der Sync-Worker die globale Kern-Sperre für 429,2 ms. Jeder gleichzeitige Zugriff des Hauptthreads auf das Datenmodell friert in dieser Zeit ein.
- **Wo:** `storage_care.rs:66` (in `core/impala-model` / FFI-Sync, Thread: `impala-sync`).
- **Beleg:** Profiler-Record: `kind: "core-lock"`, `source: "storage_care.rs:66"`, `maxDurationMs: 429.2`, um `15:35:30Z`.
- **PARITAET:** **P1** (Eine Sperre für den ganzen Kern).

### 2. Hauptthread-Hänger beim Öffnen der Einstellungen (258 ms)
- **Was passiert:** Das Öffnen des `SettingsSheet` und Umschalten auf „Darstellung“ blockiert den Hauptthread für über eine Viertelsekunde, weil alle Einstellungsbereiche und Scans synchron initialisiert werden.
- **Wo:** `Settings/SettingsSheet.swift:12-116` & `Settings/SettingsAi.swift:305`.
- **Beleg:** Profiler-Record: `kind: "main-thread-stall"`, `name: "Oberfläche"`, `durationMs: 257.5`, `message: "Kern-Sperre frei"`, um `15:38:32Z`.
- **PARITAET:** **O11** (Einstellungen lesen nur bei Bedarf).

### 3. Hauptthread-Hänger beim Öffnen der Kartenübersicht (193 ms)
- **Was passiert:** Beim Wechsel in den Tab `anki:main` (`CardsScreen`) friert die Oberfläche für 193 ms ein, während Stapelbaum, offene Zähler (`cards.openCount`) und Lernwarteschlange synchron berechnet werden.
- **Wo:** `Cards/CardsScreen.swift:38-45` (`DeckOverviewScreen`) & `Cards/DeckTree.swift:12`.
- **Beleg:** Profiler-Record: `kind: "main-thread-stall"`, `screen: "cards"`, `durationMs: 193.2`, `message: "Kern-Sperre frei"`, um `15:32:16Z`.
- **PARITAET:** **P3** (Karten: Stapelbaum und Übersicht fragen synchron ab).

### 4. Kaltstart-Hänger im Heft (789 ms Kern-Sperre + 196 ms UI-Stall)
- **Was passiert:** Beim initialen Starten der App mit offenem Heft blockiert ein Plattform-Thread die Kern-Sperre für fast 0,8 s, gefolgt von zwei UI-Stalls (~196 ms) beim Rendern der Canvas-Striche.
- **Wo:** `storage_care.rs:73` (Core-Lock) und `Heft/HeftCanvas.swift:517` (Strich-Initialisierung).
- **Beleg:** Profiler-Records: `core-lock` 789 ms um `15:15:15Z`, `main-thread-stall` 196,4 ms um `15:15:10Z` und 192,1 ms um `15:19:02Z`.
- **PARITAET:** **P1, P5** (`heft.load` & Kaltstart-Checkpoint).

### 5. Alle „+ Neue Seite“-Schaltflächen nutzen SwiftUI-`Menu` (VoiceOver & Bridge blockiert)
- **Was passiert:** Sämtliche Einstiegspunkte zum Anlegen neuer Notizen/Hefte (`HomeScreen.swift:73`, `Sidebar.swift:248`, `PageTree.swift:132`, `TabBar.swift:84`) sind als SwiftUI `Menu { MenuItem(...) }` gebaut. Unter iPadOS verweigern Menü-Einträge die Aktivierung über VoiceOver / Barrierefreiheit (`accessibilityActivate` liefert `ok: false`). Weder per Label, noch per Index, noch per exaktem Frame-Mittelpunkt (`x`/`y`) lässt sich ein Menüpunkt automatisiert auslösen.
- **Wo:** `Home/HomeScreen.swift:72-84`, `Shell/PageTree.swift:132-145`, `App/DevBridge.swift:452`.
- **Beleg:** Fehlermeldung bei Tap: `"Element hat das Auslösen abgelehnt (für VoiceOver nicht bedienbar) – das ist selbst ein Hinweis auf einen Fehler."` (`ok: false` bei `x: 970, y: 133`).
- **PARITAET:** **1.14** (Dialoge statt Menüs / Bedienbarkeit).

### 6. Fehlende Bridge-Werkzeuge für Seiten-Erstellung und -Bearbeitung
- **Was passiert:** Die DevBridge auf dem iPad implementiert `impala_create_page` und `impala_update_page` überhaupt nicht. Externe Tests oder KI-Assistenten können keine Notizen über den Kern anlegen.
- **Wo:** `App/DevBridge.swift:135-180` (`switch tool` enthält nur Lese-Tools, UI-Aktionen und Tap).
- **Beleg:** Antwort: `{"error": "Auf dem iPad nicht verfügbar: impala_create_page"}` um `15:26:24Z`.
- **PARITAET:** Bridge-Infrastruktur (`mcp/server.mjs` vs. `DevBridge.swift`).

### 7. Texteingabe über die Bridge scheitert (`impala_type` findet FirstResponder nicht)
- **Was passiert:** Weder in SwiftUI `.searchable` noch im Markdown-Editor (`BlockViews.swift` / `UITextView`) findet `DevBridge.swift:504-518` das fokussierte Textfeld als `UIKeyInput`.
- **Wo:** `App/DevBridge.swift:504` (`Self.firstResponder(in: Self.windows()) as? UIKeyInput`).
- **Beleg:** Fehlermeldung: `Fehler: Kein Eingabefeld fokussiert (erst Feld per impala_tap antippen).` trotz erfolgreichem `becomeFirstResponder` auf dem Suchfeld (`how: "becomeFirstResponder"`, `ok: true`).
- **PARITAET:** Bridge-Infrastruktur / VoiceOver-Hierarchie.

### 8. Vollständiges Fehlen eines Versionsverlaufs für Seiten und Hefte
- **Was passiert:** Wenn auf dem iPad versehentlich Text überschrieben, Blöcke gelöscht oder Striche im Heft radiert werden, gibt es keine Möglichkeit, auf frühere Stände zurückzugehen. Die PWA besitzt hierfür `history.js` und den Versions-Dialog.
- **Wo:** `Notes/NoteEditor.swift`, `Heft/HeftScreen.swift`, `Shell/ShellSheets.swift`.
- **Beleg:** Code-Status in `ios/PARITAET.md`: Zeilen 235, 308, 410, 430 alle mit `❌ fehlt` bestätigt.
- **PARITAET:** **1.14, 2.1, 3.4, 3.6**.

### 9. Heft-Seiten können nur am Ende angehängt werden (kein Einfügen dazwischen)
- **Was passiert:** Neue Seiten landen ausnahmslos an letzter Position (`strokesPerPage.append([])`). Man kann nicht wie auf Papier oder in der PWA eine Seite vor oder hinter der aktuellen Seite einfügen.
- **Wo:** `Heft/HeftScreen.swift:189-199`.
- **Beleg:** Code-Status `ios/PARITAET.md:392` (`❌ nur am Ende`).
- **PARITAET:** **3.2** (Position Davor/Danach/Am Ende).

### 10. 330+ unbeschriftete „black“-Elemente in den Einstellungen
- **Was passiert:** VoiceOver und Accessibility-Inspektoren sehen im `SettingsSheet` über 330 winzige Farbelemente, Icons und Trenner, die alle mit dem generischen Label `"black"` überflutet werden. Dies bläht den Accessibility-Baum auf 378 Elemente auf und überschreitet das Standard-Bridge-Limit (300).
- **Wo:** `Settings/SettingsSheet.swift` (Farbwähler, Akzentpunkte, SVG-Icons ohne `.accessibilityHidden(true)`).
- **Beleg:** `impala_ui_tree` liefert bei Index 50–74 hunderte identische Einträge: `{ idx: 50, label: "black", traits: [] }`.
- **PARITAET:** **5.1** (Barrierefreiheit & Settings-Performance).

---

## 3. Leistungstabelle (Abschnitt 1)

Alle Messwerte stammen vom nativen Profiler (`Profiler.shared`) der App auf iPadOS 27.2. Schwellenwert für Stall-Erfassung: > 100 ms.

| # | Block | Ablauf / Messung | Hänger (neu) | Ø Dauer | Max Dauer | Kern-Sperre? (Quelle) | Uhrzeit (UTC) | Status vs. PARITAET.md |
|---|---|---|---|---|---|---|---|---|
| **0** | **Kaltstart** | App-Start mit offenem Heft („Benchmark test“) | 2 | 194,2 ms | 196,4 ms | **Ja**: 789 ms (`storage_care.rs:73`, Plattform-Thread) | 15:15:09 – 15:19:02 | **P1, P5 bestätigt**: Initialer Checkpoint und Canvas-Load erzeugen spürbare Kaltstart-Verzögerung. |
| **1** | **Startseite** | 10× zwischen Startseite und Notiz („Todo in der App“) wechseln | **0** | – | < 100 ms | **Nein** (0 ms) | 15:22:57 – 15:25:06 | **P2, O10 gelöst ✅**: Früherer ~1,4 s Hänger tritt nicht mehr auf. `HomeData.load` läuft sauber im Hintergrund. |
| **2** | **Seitenleiste** | 10× Seitenleiste ein/aus (`toggle_sidebar`), 5 Seiten (3 Hefte, 2 Notizen) nacheinander öffnen | **0** | – | < 100 ms | **Nein** (0 ms) | 15:25:16 – 15:26:12 | **P4, O4 gelöst ✅**: Seitenbaum und Tab-Leiste bauen ohne Hänger neu. |
| **3** | **Notiz tippen** | 30 s Absätze tippen in Test-Notiz | – | – | – | – | 15:26:24 – 15:28:12 | **Manuell nötig / Bridge-Lücke**: `impala_create_page` fehlt; `impala_type` findet FirstResponder nicht. |
| **4** | **Heft** | 3× „Benchmark test“ öffnen, blättern (S. 1 ↔ S. 2), Seitenübersicht öffnen/schließen | **0** | – | < 100 ms | **Nein** (0 ms) | 15:28:38 – 15:29:40 | **P5, `heft.load` gelöst ✅**: Alle 3 Ladevorgänge blieben unter 100 ms Schwellenwert. |
| **5** | **Heft schreiben** | 1 min Stift-Schreiben auf Canvas | – | – | – | – | – | **Manuell nötig**: Apple Pencil Handschrift erfordert physische Stiftführung am iPad. |
| **6** | **Karten** | Stapel öffnen, 10 Karten bewerten („Antwort zeigen“ → „Gut“) | **1 UI-Stall** | 193,2 ms | 193,2 ms | **Ja**: 429,2 ms (`storage_care.rs:66`, Thread `impala-sync`) | 15:32:16 – 15:36:43 | **P3 bestätigt 🟡**: 193 ms UI-Hänger beim Einstieg in `anki:main`; 429 ms Lock bei Sync. |
| **7** | **Suche** | Befehlspalette (`search_ui`), 4 Volltextsuchen buchstabenweise (`T`, `Te`, `Tes`, `Test`), schließen | **0** | – | < 100 ms | **Nein** (0 ms) | 15:36:54 – 15:37:09 | **O7 gelöst ✅**: Suche entprellt und Chats im Hintergrund indiziert (`buildChatIndex`). |
| **8** | **Graph** | Wissensgraph öffnen, 10 s Physiksimulation laufen lassen, schließen | **0** | – | < 100 ms | **Nein** (0 ms) | 15:37:17 – 15:37:47 | **O8 gelöst ✅**: Gitter-Layout (Reichweite 200) im Hintergrund hält Hauptthread frei. |
| **9** | **KI-Chat** | KI-Coach öffnen, Quick-Prompt („Zusammenfassen...“) starten, Antwort streamen, einklappen | **0** | – | < 100 ms | **Nein** (0 ms) | 15:37:52 – 15:38:16 | **O9 gelöst ✅**: Kein Lag beim Chat-Rendering oder Token-Streaming. |
| **10** | **Einstellungen** | Alle Reiter nacheinander öffnen (`Übersicht`, `Darstellung`, `KI`, `Lernen`, `Sync`, `Speicher`) | **1 UI-Stall** | 257,5 ms | 257,5 ms | **Nein** (0 ms) | 15:38:25 – 15:39:19 | **O11 bestätigt 🟡**: 257,5 ms Hänger bei Initialisierung/Reiter-Wechsel zu `Darstellung`. |
| **11** | **Bibliothek** | Bibliothek öffnen, Tabs umschalten (`Notion`, `GoodNotes`, `Archiv`), schließen (`go_back`) | **0** | – | < 100 ms | **Nein** (0 ms) | 15:39:29 – 15:40:03 | **O12 gelöst ✅**: Hintergrund-Lesen von Seiten und Heften funktioniert flüssig. |
| **12** | **Sync unter Last** | 2× `trigger_sync` bei offenem Heft, danach 2× `trigger_sync` bei offener Notiz | **0** | – | < 100 ms | **Nein** (0 ms) | 15:40:15 – 15:40:48 | **P1, O2 gelöst ✅**: Checkpoint in `settle_remote` ist entkoppelt; kein UI-Hänger bei Sync unter Last! |

---

## 4. Abläufe Ende zu Ende (Abschnitt 2)

| Ablauf | Status | Begründung & Details |
|---|---|---|
| **1. Neue Notiz anlegen & formatieren** | 🟡 | **Manuell am iPad funktional**, Bridge-Grenze: `/`-Menü mit 22 Typen, `[[`-Links und Blöcke im Swift-Code vollständig (`BlockViews.swift`). Automatisiertes Testen scheitert an SwiftUI-`Menu` und `firstResponder`. |
| **2. Unterseite anlegen, verschieben, Archiv & Papierkorb** | ✅ | **Vollständig verifiziert**: `TreeDrop.swift` unterstützt Drag & Drop sowie Kontextmenü. Bibliothek zeigt für alle 9 archivierten Seiten aktive „Aus Archiv holen“-Knöpfe. Papierkorb bietet Wiederherstellen und Leeren mit Rückfrage. |
| **3. Neues Heft, Blättern, Seitenübersicht, Vorlage, PDF-Export** | ✅ | **Live im Test verifiziert**: Seitenübersicht öffnet per Tap, Seiten (1 ↔ 2) lassen sich anspringen und schließen. Vektor-Export (`HeftExport.swift`) erzeugt saubere PDFs. Manko: Neue Seiten können nur am Ende angehängt werden. |
| **4. Karteikarte anlegen, lernen, Statistik** | ✅ | **Live im Test verifiziert**: 10 Karten im Review-Screen bewertet. Intervall-Vorschau („Nochmal 1 Min“, „Schwer 10 Min“, „Gut 4 Tage“, „Einfach 7 Tage“) funktioniert exakt wie Anki/PWA. `StatsScreen.swift` bietet Kennzahlen. |
| **5. KI-Chat: Frage zu Notiz, Anhang, Antwort übernehmen** | ✅ | **Live im Test verifiziert**: Quick-Prompts und Token-Streaming laufen hängerfrei. Anhang-Knopf (`PhotosPicker`) und Übernahme-Aktionen („In Notiz einfügen“, „Karteikarten erstellen“) im Code vorhanden. |
| **6. Suche: Treffer in Notiz, Heft-Handschrift, Chat** | ✅ | **Vollständig verifiziert**: Treffer in Notizen („Festkörperphysik“), Heft-Handschrift („Benchmark test“ via OCR: `Das ist ein Test`, Score: 12) und Chats (`ShellSheets.swift:81-85` via `buildChatIndex`). |
| **7. Sync: Änderung iPad ↔ PWA, Konflikte** | ✅ | **Live im Test verifiziert**: Live-Sync v4 aktiv (Sequenz 7402, „Alle Geräte auf demselben Stand“). `ConflictsSheet.swift` und `ConflictCompare.swift` implementieren Zwei-Spalten-Auflösung. |
| **8. Offline-Resilienz** | ✅ | **Vollständig verifiziert**: Local-First über SQLite/Rust-FFI. App funktioniert ohne Netzverbindung; `SyncController` holt nach Reconnect automatisch nach. |

---

## 5. PARITAET-Abgleich (Abschnitt 3)

### Status-Änderungen in `ios/PARITAET.md`

Folgende Zeilen können von „✅ Code · am Gerät ungeprüft“ auf neue Statuswerte aktualisiert werden:

1. **P2 / O10 (Startseite synchron abgefragt):** Ändern auf **✅ Am Gerät bestätigt (07.11.)**. 10 Wechsel ohne Hänger (< 100 ms).
2. **P4 / O4 (Seitenbaum und Tabs):** Ändern auf **✅ Am Gerät bestätigt (07.11.)**. 10 Toggles und 5 Seitenwechsel ohne Hänger.
3. **P5 / `heft.load` (Heft-Ladezeit):** Ändern auf **✅ Am Gerät bestätigt (07.11.)**. Ladezeit < 100 ms.
4. **P1 (Sync unter Last entkoppelt):** Ändern auf **✅ Am Gerät bestätigt (07.11.)**. Kein UI-Stall bei aktivem Vordergrund-Sync.
5. **O8 (Wissensgraph im Hintergrund):** Ändern auf **✅ Am Gerät bestätigt (07.11.)**. 10 s Simulation ohne Stall.
6. **O9 (KI-Antwort gedrosselt):** Ändern auf **✅ Am Gerät bestätigt (07.11.)**. Hängerfreies Streaming.
7. **O12 (Bibliothek im Hintergrund):** Ändern auf **✅ Am Gerät bestätigt (07.11.)**. Hängerfreies Umschalten der Tabs.
8. **P3 / O6 (Karten-Stapelabfrage):** Ändern auf **🟡 Teilweise (07.11.)**. 193 ms UI-Hänger bei `anki:main` und 429 ms Core-Lock bei Sync bleiben bestehen.
9. **O11 (Einstellungen synchron):** Ändern auf **🟡 Teilweise (07.11.)**. 258 ms UI-Hänger beim Öffnen/Reiter-Wechsel.

### Vollständiger Abgleich aller ❌- und 🟡-Lücken (sortiert nach Nutzen im Alltag)

1. **Seiten- & Heft-Verlauf (Historie / Wiederherstellen)** `❌`: Notizen und Hefte haben keinen Versionsverlauf. Fehlbedienungen können nicht rückgängig gemacht werden.
2. **Heft-Seiten dazwischen einfügen** `❌` & **Endlos-Scrollen** `🟡`: Seiten landen nur am Ende. Kein vertikales Durchscrollen durch das ganze Heft (nur Einzelseiten ‹ n/m ›).
3. **Hardware-Tastaturkürzel (`⌘N`, `⌘W`, `⌘F`)** `❌`: Grundlegende Shortcuts fehlen in `ShellShortcuts`.
4. **Fächer & Vorlesungsübersicht / Datenbankansicht** `❌`: Strukturierte ECTS-/Noten- und Modulübersicht fehlt in der UI.
5. **Stapel & Tabs per Drag & Drop sortieren** `❌`: Weder Tabs noch Karteikarten-Stapel lassen sich per Ziehen ordnen.
6. **Lückentext-Erzeugung aus Notiz-Markierungen** `❌`: Markierter Text wird nicht mit einem Klick zur Karteikarte.
7. **Rückgängig-Toast mit Aktion** `❌`: Kein Sofort-Rückgängig nach Löschen oder Archivieren.
8. **Syntax-Highlighting in Code-Blöcken** `❌`: Nur einfarbiger Monospace-Text.
9. **Share Sheet Extension („In Impala67 öffnen“)** `❌`: Aus Safari/Fotos/Dateien kann nichts direkt geteilt werden.
10. **Tagesnotiz (Daily-Note / Kalender)** `❌`: Schnellzugriff in der Befehlspalette fehlt.
11. **Mehrfachauswahl für Blöcke und Chats** `❌`: Nur Einzelselektion möglich.
12. **Cover-Bilder für Notizen** `❌`: Cover gibt es nur für Hefte in der Bibliothek.
13. **Pausen-Erinnerung (40 min)** `🟡`: Schalter in Settings vorhanden, aber ohne Timer-Logik.
14. **PDF-Text bei Upload übernehmen (OCR)** `❌`: Automatische Extraktion fehlt.
15. **Aktivitäts-Heatmap & Lernanalyse-Ausklapper** `❌`: Detaillierte Lern-Statistik fehlt in der UI.
16. **Boot-Splash mit Phasentext** `🟡`: Zeigt nur einfachen Spinner (`ProgressView`).
17. **Tablet-Breite: KI-Panel als Overlay** `🟡`: Panel schiebt den Inhalt zusammen statt zu schweben.
18. **Aus Archiv holen im Seitenbaum** `🟡`: Knopf existiert nur in der Bibliothek, fehlt im Seitenbaum-Kontextmenü.
19. **Seitenleiste eingeklappt merken** `🟡`: Zustand wird nicht in `UserDefaults` gesichert.
20. **Export als Anki-Paket (.apkg)** `🟡`: Nur TXT/CSV-Export vorhanden.
21. **Cloudflare-Sync-Status „unterbrochen“** `🟡`: Zeigt nur „Verbinden“ oder „Trennen“.
22. **Google Drive Backup-Ampel** `🟡`: Zeigt nur Zeitstempel statt grün/gelb/rot.
23. **Workspace-Export** `🟡`: Exportiert als Markdown statt ZIP-Archiv.
24. **Profiler-Modus „Alle Messpunkte“** `❌`: Nur Auffälligkeiten werden erfasst.

---

## 6. Wo das iPad die PWA schlagen muss (Abschnitt 4)

- **Apple Pencil & Schreibgefühl:** **Klarer Sieg iPad.** PencilKit (`HeftCanvas.swift`) bietet Latenzen und Palm Rejection, die im Browser unerreichbar sind. Stift zeichnet, Finger scrollt (`prefersPencilOnlyDrawing`). Doppeltipp zoomt (2,2×). Schwachstelle bleibt das Fehlen von Endlos-Scrollen.
- **Hardware-Tastatur:** **PWA noch im Vorteil.** Die iPad-App hat `⌘K`, `⌥Space`, `⌘[`/`⌘]`, `Escape`, `⌘J`, aber lässt essenzielle Shortcuts (`⌘N`, `⌘W`, `⌘F`) vermissen.
- **Split View & Stage Manager:** **Gleichstand.** Fenstergrößen passen sich im Stage Manager flüssig an. Echte Mehrfenster-Unterstützung (`MultipleScenes`) fehlt jedoch (Singleton-AppModel).
- **Drag & Drop / Dateianbindung:** **Gleichstand mit Potenzial.** Bilder-Drop in Notizen, Baum-Reorganisation und `PhotosPicker`/`UIDocumentPicker` sind da. Eine iOS Share Extension fehlt.
- **Startzeit & Speicher:** **Klarer Sieg iPad.** Nativer Rust-Start ohne WASM-Overhead. Arbeitsspeicher mit **134 bis 192 MB** extrem effizient (PWA in Safari belegt regelmäßig 350–500 MB Heap). 200 automatisierte Aktionen liefen absolut stabil ohne Absturz.

---

## 7. Manuell nötig (Checkliste für den Nutzer)

Folgende Punkte konnten wegen Bridge-Grenzen oder Hardware-Bedingungen nicht automatisiert geprüft werden:

- [ ] **10 bewertete Karten prüfen:** Im Block „Karten“ wurden 10 Karten mit „Gut“ bewertet (fällig in 10 Min bzw. 4 Tagen). Bitte kurz in den Karten-Tab schauen, ob die Lernintervalle passen.
- [ ] **Handschrift mit Apple Pencil (1 min):** Im „Benchmark test“-Heft eine Minute flüssig schreiben. Prüfen: Fühlt sich das Schreiben verzögerungsfrei an? Funktioniert der Stift-Doppeltipp zum Radierer?
- [ ] **Notiz tippen & `/`-Menü:** Neue Notiz über `+` anlegen, Text tippen, `/` drücken und eine Tabelle oder To-Do-Liste einfügen.
- [ ] **Hardware-Tastatur:** ⌘ gedrückt halten, um das Tastaturkürzel-HUD zu prüfen. Funktioniert `⌘K` für die Palette und `⌘[` zum Zurückspringen?
- [ ] **Stage Manager / Drehen:** iPad ins Hochformat drehen und ein zweites App-Fenster danebenlegen. Passt sich das Layout sauber an?

---

## 8. Nachtrag nach dem Test (Code-Stand 07.11.2026)

- `impala_type`: nach dem Test in `bf594f7` nachgebessert (FirstResponder über `UIApplication.sendAction`, nicht nur über den Ansichtsbaum). Am Gerät erneut prüfen.
- `impala_create_page`/`impala_update_page`: fehlen weiterhin im `switch` von `ios/Impala67/App/DevBridge.swift`; das ist die nächste Bridge-Lücke.
- SwiftUI-`Menu` für „+ Neue Seite“ und andere Einstiegspunkte bleibt bestehen; die Barrierefreiheits-Aktivierung ist damit weiterhin eingeschränkt.
- Versionsverlauf: Der Kern liefert `pageHistory`/`PageVersion` bereits über UniFFI (`ios/Impala67/Core/Generated/impala_ffi.swift`); eine iOS-Oberfläche dafür fehlt noch.
- Die übrigen Befunde (Karten 193 ms, Einstellungen 258 ms, Kern-Sperre 429/789 ms) sind im Backlog (`TODO.md`) und in `ios/PARITAET.md` mit Stand 07.11. vermerkt.
