# Testauftrag iPad-App (für Gemini über die MCP-Bridge)

**Status:** Erledigt am 07.11.2026 – Bericht: [`IPAD-TESTBERICHT-2026-11-07.md`](IPAD-TESTBERICHT-2026-11-07.md).

Ziel: Die iPad-App soll **besser als die PWA** sein - flüssiger, ohne Hänger, mit allem, was die
PWA kann. Du **testest und misst nur**, du änderst keinen Code. Ergebnis ist ein Bericht
(`docs/IPAD-TESTBERICHT-<Datum>.md`), mit dem Claude die Fehler behebt.

Grundlage: `ios/PARITAET.md` (Stand der Gleichheit). Die wichtigsten Leistungs-Punkte sind inzwischen
am Gerät geprüft; offene Punkte und neue Lücken stehen im Bericht vom 07.11.2026.

## Regeln

- **Nutzerdaten nicht anfassen.** Eigene Testseiten heißen `[Test] …` und kommen am Ende in den
  Papierkorb. Nichts Bestehendes umbenennen, verschieben oder löschen.
- **Kein `impala_storage_cleanup` während der Messungen** – es sperrt den Kern ~5 s und verfälscht
  alles. Höchstens einmal ganz am Ende, getrennt gemessen.
- Vor jedem Block `impala_get_performance_trace` lesen (Ausgangslage), danach wieder lesen und nur
  die **neuen** Hänger dem Block zuordnen. Uhrzeit jedes Schritts notieren.
- Jeder Befund mit Beleg: Bildschirmfoto (`impala_screenshot`), Hänger-Werte (ms, Ansicht,
  Kern-Sperre ja/nein + Quelle) oder genaue Fehlermeldung.
- Ein Schritt geht nicht über die Bridge (z. B. Stift-Schreiben)? Dann als „manuell nötig“
  vermerken, nicht raten.

## Werkzeuge

- Bedienen: `impala_ui_tree` (mit `query` / `interactive: true`), `impala_tap` (`label`, `index`
  oder `x`/`y`), `impala_type` (nach Tipp ins Feld; `submit: true` = Enter).
- Navigieren: `impala_run_ui_action` – `open_page`, `close_active_tab`, `search_ui`,
  `toggle_sidebar`, `trigger_sync`, **`go_back`** (wie ‹, schließt zuerst Sheets),
  **`dismiss`** (schließt Sheet oder obersten Dialog).
- Messen: `impala_get_performance_trace`, `impala_get_diagnostics` (Speicher, Kern, Sync).
- Daten: `impala_list_pages`, `impala_get_page`, `impala_create_page`, `impala_update_page`, `impala_search`, `impala_list_flashcards`, `impala_create_flashcard`.

## 0. Bridge selbst (zuerst, nach dem neuen Build)

1. `impala_ui_tree` auf Startseite, im Heft, in einer Notiz, in den Einstellungen: liefert der Baum
   jetzt Elemente mit sinnvollen Beschriftungen? Anzahl je Ansicht notieren.
2. `impala_tap` per `label`, per `index`, per `x`/`y` – je ein Knopf, der sichtbar etwas tut.
3. Suchfeld antippen → `impala_type` „Test“ → kommen Treffer? Danach `dismiss`.
4. `go_back` aus Notiz, aus Sheet, aus Bibliothek.

Funktioniert hier etwas nicht: genau beschreiben und trotzdem mit den Daten-Tools weitermachen.

## 1. Leistung – die wichtigste Frage

Für jede Ansicht: **Hänger-Anzahl, Ø, Max, Kern-Sperre beteiligt?** Zielwert: kein Hänger über
100 ms im normalen Gebrauch, die PWA hat hier keine.

| Block | Ablauf | Prüft (PARITAET.md) |
|---|---|---|
| Kaltstart | App neu starten lassen (Nutzer), Diagnose: Zeit bis bedienbar, Speicher | Start, Checkpoint |
| Startseite | 10× zwischen Startseite und einer Notiz wechseln | P2, O10 |
| Seitenleiste | Seitenleiste 10× ein/aus, 5 Seiten nacheinander öffnen | P4, O4 |
| Notiz tippen | `[Test] Tippen` anlegen, 30 s lang Absätze tippen (`impala_type`) | O3 |
| Heft | „Benchmark test“ öffnen, blättern, Seitenübersicht, schließen; 3× | `heft.load`, P5 |
| Heft schreiben | **manuell**: Nutzer schreibt 1 min; danach Trace lesen | O1, O2, O5 |
| Karten | Kartenübersicht, Stapel öffnen, 10 Karten bewerten | P3, O6 |
| Suche | Befehlspalette, Wort Buchstabe für Buchstabe tippen | O7 |
| Graph | Graph öffnen, 10 s laufen lassen | O8 |
| KI-Chat | Eine Frage stellen, während der Antwort Trace lesen | O9 |
| Einstellungen | Alle Bereiche öffnen | O11 |
| Bibliothek | Bibliothek öffnen, scrollen | O12 |
| Sync unter Last | `trigger_sync` während Notiz-Tippen und während Heft offen | P1, O2 |

Der Spitzenwert vom letzten Trace (Startseite 1.395 ms ohne Kern-Sperre) ist ein Hinweis auf
langsames Neuzeichnen: Herausfinden, **welcher Wechsel** ihn auslöst.

## 2. Alltags-Abläufe Ende zu Ende

Jeder Ablauf: geht er komplett durch, ohne Hänger, ohne falsche Anzeige?

1. Neue Notiz anlegen, Titel setzen, Überschrift/Liste/Checkbox/Tabelle/Code-Block per `/`-Menü,
   Link auf andere Seite, zurück, wieder öffnen → alles da?
2. Unterseite anlegen, im Baum verschieben, archivieren, aus dem Archiv holen, in den Papierkorb,
   wiederherstellen.
3. Neues Heft, Seite hinzufügen, Seitenübersicht, Papier/Vorlage ändern, Bild einfügen, Export als
   PDF.
4. Karteikarte anlegen, lernen, Statistik ansehen.
5. KI-Chat: Frage zu einer Notiz, Anhang, Antwort übernehmen.
6. Suche: Treffer in Notiz, in Heft-Handschrift, in Chat.
7. Sync: Änderung auf dem iPad → in der PWA sichtbar (und umgekehrt); Zeit messen. Konflikt
   erzeugen (gleiche Notiz auf beiden Geräten offline ändern) → Konflikt-Dialog prüfen.
8. Offline: Nutzer schaltet WLAN aus → App normal bedienbar? Wieder an → Sync holt nach?

## 3. Lücken gegenüber der PWA

Alle ❌- und 🟡-Zeilen aus `ios/PARITAET.md` durchgehen und für jede bestätigen: **fehlt wirklich /
inzwischen da / anders als beschrieben**. Danach nach Nutzen sortieren: Was vermisst man im
Alltag am iPad sofort (z. B. Seitenverlauf, Rückgängig-Toast, Daily-Notiz, Tabs ordnen)?

## 4. Wo das iPad die PWA schlagen muss

Diese Dinge kann nur die native App – prüfen, ob sie da sind und gut funktionieren:

- Apple Pencil: Schreibgefühl/Verzögerung (manuell), Doppeltipp, Scribble in Textfeldern.
- Hardware-Tastatur: ⌘-Kürzel (⌘K, ⌘N, ⌘W, ⌘F, ⌘Z …), ⌘ gedrückt halten zeigt die Liste.
- Split View / Stage Manager / mehrere Fenster, Drehen, Größenwechsel ohne Fehler.
- Drag & Drop aus Dateien/Fotos in Notiz und Heft, Teilen-Menü in die App.
- Start schneller als die PWA, Speicherverbrauch, Akku über 10 min Schreiben.

## Bericht

`docs/IPAD-TESTBERICHT-<JJJJ-MM-TT>.md` mit:

1. **Kurzfazit** (5 Zeilen): Ist die App heute besser als die PWA? Was macht sie „Müll“?
2. **Top 10 Probleme**, nach Schwere: Was passiert, wo (Ansicht/Schritt), Beleg (ms, Bild,
   Meldung), betroffene PARITAET-Nummer.
3. **Leistungstabelle** aus Abschnitt 1 (Hänger je Block, Ø/Max, Kern-Sperre + Quelle).
4. **Abläufe** aus Abschnitt 2: ✅ / ❌ mit Grund.
5. **PARITAET-Abgleich**: Zeilen, deren Status nicht stimmt.
6. **Manuell nötig**: was der Nutzer selbst prüfen muss.

Am Ende: alle `[Test] …`-Seiten in den Papierkorb.
