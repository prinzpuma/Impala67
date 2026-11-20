# Parität: native Apps ↔ PWA

Die PWA (`web/`) ist die Vorlage. Hier stehen **nur die Lücken** der Android-App (`android/`) und der
iPad-App (`ios/`) – was nicht hier steht, gilt als erledigt oder bewusst anders.

**Quelle ist der Funktionskatalog `docs/funktionen.json`**, nicht diese Datei: Die Tabellen unten erzeugt
`npm run check:paritaet -- --schreiben`. Neue PWA-Funktion → Zeile im Katalog; Lücke geschlossen → Status in
der Zeile löschen und im nativen Code `// funktion: <id>` an die Umsetzung schreiben. Einstellungen gleicht das
Skript selbst ab (`web/settings-schema.js` gegen die Suchindizes der Apps). `npm run check:paritaet -- --details`
zeigt unmarkierte Funktionen und PWA-Module ohne Katalogeintrag.

Stand: 15.11.2026. Grundlage: Android-Inventar vom 01.11. und iPad-Abgleich vom 05.–12.11., gegen die
heutigen Pakete geprüft (nicht am Gerät). Die alten Einzellisten liegen in der Git-Historie
(`android/UI-INVENTAR.md`, `ios/PARITAET.md`, entfernt am 15.11.2026).

**Zeichen:** ❌ fehlt · 🟡 teilweise/abweichend · ✅ erledigt · ⚪ bewusst anders · – betrifft die App nicht

## Bewusst nicht geplant

Daily-Notizen (iPad), Abschreiben, Export „Alle Handschrift“, „x % analysiert“, Anki-`.apkg` (iPad, TXT/CSV
reicht), eigener KI-Knopf im Heft, @-Erwähnungen und eigene Modell-ID (in der PWA tote Pfade),
KI-Trainingsbeispiel aus dem Lasso, MCP-Bridge in Android, Statusband/Update-Banner (nur PWA).

**Android vorerst zurückgestellt:** Schulnoten, Fächer, Experimente, Handschrift-Einstellungen, Controller,
Heft-Kopfmenüs, eigenes Cover-Bild, Startbildschirm-Widget und die Telefon-Oberfläche (Teil 6).

## Leistung (iPad, vor allen Funktionslücken)

Am Gerät am 07.11. nachgemessen (Bericht damals: `docs/IPAD-TESTBERICHT-2026-11-07.md`, jetzt in der Git-Historie).
Offen:

| # | Problem | Fundstelle (`ios/Impala67/`) |
|---|---|---|
| P1 | Eine Sperre für den ganzen Kern; Sync-Import und Checkpoint halten sie lange (429 ms beim Karten-Sync) | `Core/ImpalaStore.swift` |
| P3/O6 | Stapelbaum und Übersicht lesen `deckOverview`/`studyQueue` bei jeder Kartenänderung doppelt auf dem Hauptthread (193 ms) | `Cards/DeckTree.swift`, `Cards/CardsScreen.swift` |
| O11 | KI-Einstellungen scannen bei jeder Änderung alle Hefte (258 ms) | `Settings/SettingsAi.swift` |
| – | Kaltstart 789 ms; Profiler-Hänger ohne Namen/Quelle | `App/`, Profiler |

Am 14.11. im Code behoben, am Gerät nachmessen: Kompaktierung aus dem Sync in `saveCheckpoint` verlegt (P1),
Handschrift-Scan nicht mehr beim Hintergrund-Sync (P6), Heft-Striche in der Lade-Warteschlange bauen (P7),
Notiz-Speichern in eigener Warteschlange (P8), ferne Heftseiten entladen (P9), Bewerten im Hintergrund.

<!-- funktionen:start (erzeugt von tools/paritaet.mjs, nicht von Hand ändern) -->

## 1. Shell & Navigation

| PWA-Funktion | Android | iPad |
|---|---|---|
| Boot-Splash mit 12-s-Hinweis „Neu laden“ | ✅ | 🟡 nur Spinner |
| Tablet 701–1024 px: KI-Panel als Overlay, Seitenleiste 220 px | 🟡 andere Schwellen | 🟡 Panel fest |
| Dialoge als Sheet ≤ 600 px | 🟡 Mitten-Dialoge | ⚪ System |
| Umbenennen direkt in der Zeile | ✅ Desk, 🟡 Telefon (Dialog) | 🟡 Alert |
| „Aus Archiv holen“ im Seitenmenü | 🟡 nur Archiv-Ansicht | 🟡 nur Bibliothek |
| Stapel / Tabs per Ziehen ordnen | ✅ Stapel, ❌ Tabs | ❌ |
| Chat-Verlauf: Mehrfachauswahl | ✅ | ❌ |
| Seitenleiste eingeklappt merken, Breite ziehen | ✅ | 🟡 nicht gemerkt, Systemteiler |
| Papierkorb: Filter Alle/Seiten/Stapel/Karten | ❌ nur Seiten | prüfen |
| Toasts mit Farbe und Aktion (Rückgängig) | 🟡 ohne Farbe/Aktion | ❌ Aktion, 🟡 nur im Editor |
| Escape-Kaskade, Palette mit ↑ ↓ Enter, Strg/⌘+K | 🟡 | 🟡 |
| Befehlspalette: Präfix „Archiv · “, Gruppe „Chats“ | prüfen | 🟡 Präfix fehlt |
| Wissensgraph: Modi, Suche, Analyse | ✅ | 🟡 nur Erkunden |
| Performance-Hinweis „Einschalten“ | ❌ | ❌ |
| Heft-Vollbild blendet Seitenleiste und Tabs aus | 🟡 nur KI-Knopf | prüfen |

## 2. Seiten & Editor

| PWA-Funktion | Android | iPad |
|---|---|---|
| Seiten-Cover im Editor (anzeigen, ändern, eigenes Bild) | ❌ nur Dialog, kein eigenes Bild | ✅ |
| Seitenmenü: Vorlesungsübersicht | ❌ | prüfen |
| Seitenmenü: „Karten aus Markierungen“ | ❌ | prüfen |
| Teilen / PDF-Druck mit Markdown, Formeln, Bildern | 🟡 nur Klartext | prüfen |
| Blöcke ziehen (⋮⋮), mit Maus über Grenzen markieren, Dateien droppen | ❌ | 🟡 |
| Blockfarbe (Bedienung), Farbe wiederholen ⇧⌘H | ❌ | 🟡 |
| Live-Kürzel `---`, ` ```sprache `, `$$` | 🟡 | ✅ |
| Markdown-Zeichen ausblenden, sobald Muster vollständig | 🟡 sichtbar | 🟡 abgeblendet |
| Formel-Popover (Block und Inline) | 🟡 | 🟡 kein Popover |
| Code: Syntax-Hervorhebung, Sprache ändern | ❌ | ❌ |
| Spalten umbrechen bei schmaler Breite | 🟡 | 🟡 |
| Video/Audio, PDF inline im Block; PDF-Text beim Hochladen | 🟡 PDF-Viewer vorhanden, Rest prüfen | ❌ |
| Heft-Block mit Vorschaubild | 🟡 | 🟡 |
| Blockauswahl- und Toggle-Tasten | ❌ | ✅ |
| PDF aus der Zwischenablage mit Zielwahl | ❌ | prüfen |
| Markdown-ZIP mit Medien | ❌ | 🟡 nur `.md` |

## 3. Heft

| PWA-Funktion | Android | iPad |
|---|---|---|
| Lasso: Bilder/Textfelder mitnehmen, Drehen | prüfen | 🟡 am Gerät prüfen |
| Entf/Rücktaste löscht Lasso-Auswahl | ❌ | 🟡 nur Leiste |
| Optionsleiste verschiebbar (⠿) | ❌ | prüfen |
| Seitenübersicht: Wischen wählt mehrere, Auto-Scroll, Export/Import aus Auswahl | 🟡 | ❌ |
| PDF-Export aus dem Seitenkopf/Teilen-Menü | 🟡 Dialog da, Kopf-Menü Stub | ✅ |
| ⋯-Menü im Heft: Favorit, Icon, Cover, Duplizieren, Verlauf | ❌ | 🟡 |
| Mausrad/Trackpad blättert, Strg/⌘ zoomt | ❌ | ❌ |
| Handballen-Rücknahme (350 ms), zweiter Finger bricht Strich ab | ❌ | prüfen |
| Seitenhintergrund (PDF-Seite, Arbeitsblatt): liegt fest, nicht auswählbar; ältere Apps zeigen „bitte aktualisieren“ | 🟡 Scans als Hintergrund, kein PDF-Import ins Heft | ✅ |
| Import-Dialog mit Ziel und Position; PDF-Text übernehmen | 🟡 | 🟡 |
| Zuletzt angesehene Seite merken | 🟡 nur Sitzung | prüfen |
| „Heft-Seite als Bild an KI anhängen“ | prüfen | prüfen |
| KI-Arbeitsblätter aus Vorlagen direkt als Heftseiten erzeugen (`create_worksheet`) | ❌ | ❌ |

## 4. KI-Chat & Karteikarten

| PWA-Funktion | Android | iPad |
|---|---|---|
| Änderungskarte „Änderungen anzeigen“ / Seiten-Diff | 🟡 | ❌ |
| Leerer Chat: Leucht-Kugel, Eingabe mittig | ✅ | ❌ |
| Vollbild-Kopf „✦ Titel“ mit Status | 🟡 | 🟡 |
| Modellwahl: Favoriten ★, Denkaufwand Automatisch/Reduziert | prüfen | ❌ |
| Karten: Tabs Stapel/Browser/Statistik/Archiv | 🟡 | 🟡 Kopf/Menü |
| Speichern verlangt Vorderseite | 🟡 | 🟡 |
| Lernansicht: Selbsteinschätzung, Tastatur ␣/1–4 | ❌ | prüfen |
| Lernanalyse (Statistik-Tab, Startseite), Wochenziel-Prognose | ✅ | ❌ |
| Beta-Lernfunktionen / Experimente (Hinweise, Quiz, Variation, Fehler-Detektor, Pre-Testing, Wissenslücken) | ❌ Platzhalter | ❌ teilweise |
| Pausen-Erinnerung (Logik) | prüfen | 🟡 nur Schalter |
| Fächer: Liste in den Einstellungen, „+ Fach“-Chips | ❌ | 🟡 Zuordnung da |
| Schulnoten | ❌ | ❌ (Kern-API vorhanden) |
| Controller/Gamepad-Lernen | ❌ Platzhalter | ❌ |

## 5. Einstellungen, Sync, Backup

| PWA-Funktion | Android | iPad |
|---|---|---|
| Speichern-Leiste und „Änderungen verwerfen?“ | 🟡 | ❌ |
| Handschrift-Einstellungen | ❌ Platzhalter | ⚪ Apple Vision |
| Cloudflare: Zustand „unterbrochen“, QR aus Foto/Screenshot | 🟡 | 🟡 / ❌ |
| Drive: Fehlertexte, Ergebnis-Toasts, Sichern beim Schließen | 🟡 | 🟡 |
| Backup-Ampel | prüfen | 🟡 nur Zeitstempel |
| Profiler-Modus „Alle Messpunkte“ | – | ❌ |
| Lokale KI: Embedding-Modell | ❌ nicht im Suchindex | ✅ |
| Lokale KI: Handschrifterkennung | ❌ nicht im Suchindex | ✅ |
| Beta-Lernfunktionen | ❌ nicht im Suchindex | ✅ |
| Controller: Mit Controller lernen | ❌ nicht im Suchindex | ✅ |
| Controller: Tastenbelegung | ❌ nicht im Suchindex | ❌ nicht im Suchindex |
| Controller: Deadzone & HID | ❌ nicht im Suchindex | ❌ nicht im Suchindex |
| Google Drive: Tokens über Drive synchronisieren | ❌ nicht im Suchindex | ✅ |
| Erweitert: Google Client-ID | ❌ nicht im Suchindex | ✅ |
| App: App-Updates | ❌ nicht im Suchindex | ✅ |

## 6. Telefon (nur Android)

| PWA-Funktion | Android |
|---|---|
| Seitenoptionen (⋯) im Editor-Kopf mit allen Einträgen des Desk-Menüs | ❌ |
| Kopf-Untertitel „N fällig“, Badge-Kappung „99+“ | ❌ |
| „+“ im Dock legt im Kontext eine Unterseite an | 🟡 |
| Notiz-Menü: Duplizieren, Verschieben; Menüs als Bottom-Sheet | 🟡 |
| Langdruck auf Stapel, Bibliotheks-Karten, Blöcke | ❌ |
| Dock bei Tastatur/Lernmodus ausblenden | 🟡 |
| Übergänge: Morph, Hochzählen, Puls am Sync-Punkt; System-„Reduzierte Bewegung“ | 🟡 |

## Leistungsbudgets

Gleiches Ziel für alle Versionen; gemessen über den Profiler der jeweiligen App (Messpunkt). „–“ = noch kein Messpunkt.

| Funktion | Budget | PWA | Android | iPad |
|---|---|---|---|---|
| Kaltstart bis zur bedienbaren Oberfläche | ≤ 1000 ms | `state.load` | – | `boot.core-open` |
| Seite im Editor öffnen | ≤ 100 ms | `editor.mount` | – | – |
| Heft öffnen | ≤ 300 ms | `heft.mount` | – | `heft.load` |
| Strich zeichnen (ein Bild pro Frame) | ≤ 16 ms | `heft.stroke` | `heft:strokeLayer` | – |
| Heft speichern | ≤ 50 ms | `heft.save` | – | `heft.commit` |
| Cloudflare-Sync-Durchlauf | ≤ 500 ms | `cloudflare.sync` | – | – |

<!-- funktionen:end -->
