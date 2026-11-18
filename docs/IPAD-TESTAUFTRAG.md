# Testauftrag iPad-App (über die MCP-Bridge)

Ziel: Die iPad-App soll flüssiger als die PWA sein und alles können, was die PWA kann. Der Tester **testet und
misst nur**, er ändert keinen Code. Ergebnis ist ein Bericht `docs/IPAD-TESTBERICHT-<JJJJ-MM-TT>.md`; sind die
Befunde behoben und in `docs/PARITAET.md` übernommen, wird der Bericht wieder gelöscht.
Einrichtung der Bridge: `node mcp/lan-setup.mjs` (Port 8766), Adresse in der App unter Einstellungen → App & Speicher
→ Für Entwickler.

## Regeln

- **Nutzerdaten nicht anfassen.** Eigene Testseiten heißen `[Test] …` und kommen am Ende in den Papierkorb.
- **Kein `impala_storage_cleanup` während der Messungen** (sperrt den Kern ~5 s).
- Vor und nach jedem Block `impala_get_performance_trace` lesen und nur neue Hänger dem Block zuordnen.
- Jeder Befund mit Beleg: `impala_screenshot`, Hänger-Werte (ms, Ansicht, Kern-Sperre + Quelle) oder Fehlermeldung.
- Geht ein Schritt nicht über die Bridge (z. B. Stift-Schreiben): „manuell nötig“ vermerken, nicht raten.

## Werkzeuge

- Bedienen: `impala_ui_tree` (`query`, `interactive: true`), `impala_tap` (`label`, `index` oder `x`/`y`),
  `impala_type` (`submit: true` = Enter).
- Navigieren: `impala_run_ui_action` – `open_page`, `close_active_tab`, `search_ui`, `toggle_sidebar`,
  `trigger_sync`, `go_back`, `dismiss`.
- Messen: `impala_get_performance_trace`, `impala_get_diagnostics`.
- Daten: dieselben Werkzeuge wie die App-KI (`impala_search`, `impala_read_pages`, `impala_create_pages`,
  `impala_edit_page`, `impala_list_cards`, `impala_create_cards` …, siehe `mcp/README.md`), im Kern ausgeführt.

## 1. Leistung

Je Block Hänger-Anzahl, Ø, Max, Kern-Sperre. Ziel: kein Hänger über 100 ms im normalen Gebrauch.

| Block | Ablauf |
|---|---|
| Kaltstart | App neu starten (Nutzer), Zeit bis bedienbar, Speicher |
| Startseite / Seitenleiste | 10× Startseite ↔ Notiz; Seitenleiste 10× ein/aus, 5 Seiten öffnen |
| Notiz tippen | `[Test] Tippen` anlegen, 30 s Absätze tippen |
| Heft | großes Heft öffnen, blättern, Seitenübersicht, 3×; **manuell** 1 min schreiben |
| Karten | Übersicht, Stapel öffnen, 10 Karten bewerten |
| Suche, Graph, KI, Einstellungen, Bibliothek | je einmal durchgehen, während der KI-Antwort Trace lesen |
| Sync unter Last | `trigger_sync` beim Tippen und bei offenem Heft |

## 2. Abläufe Ende zu Ende

Notiz mit `/`-Blöcken und Link; Unterseite verschieben, archivieren, zurückholen, Papierkorb, wiederherstellen;
Heft mit neuer Seite, Papier, Bild, PDF-Export; Karteikarte anlegen und lernen; KI-Frage zu einer Notiz mit Anhang;
Suche in Notiz, Handschrift, Chat; Sync iPad ↔ PWA mit Zeit und einem Konflikt; offline bedienen und nachsyncen.

## 3. Lücken und iPad-Stärken

- Alle iPad-Zeilen in `docs/PARITAET.md` prüfen: fehlt wirklich / inzwischen da / anders. Nach Alltagsnutzen sortieren.
- Nur nativ: Apple Pencil (Gefühl, Doppeltipp, Scribble), ⌘-Kürzel, Split View/Stage Manager, Drehen,
  Drag & Drop aus Dateien/Fotos, Teilen in die App, Start, Speicher, Akku über 10 min Schreiben.

## Bericht

1. Kurzfazit (5 Zeilen). 2. Top 10 Probleme mit Beleg. 3. Leistungstabelle. 4. Abläufe ✅/❌ mit Grund.
5. Zeilen in `docs/PARITAET.md`, deren Stand nicht stimmt. 6. Was der Nutzer manuell prüfen muss.
