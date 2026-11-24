# Impala67 – Offene Punkte

Nur Offenes, nach Priorität. Erledigtes steht im Git-Log, Lücken der nativen Apps in `docs/PARITAET.md`.
Stand: 15.11.2026.

## 1. Am Gerät prüfen (gebaut, ungetestet)

- **iPad** (Wunschliste 12.11., Ziel: Heft so gut wie GoodNotes): Lasso (`Heft/HeftLasso.swift`; offen: Bilder/Textfelder
  mitnehmen, Drehen), Text-Werkzeug „T“, Laserpointer, Notiz-Cover, Mehrfachauswahl im Editor, Aktivitäts-Heatmap,
  Kartenbrowser-Sortierung, Verlauf (Notizen und Hefte), Bridge-Inhaltswerkzeuge über `ImpalaCore.runMcpTool` auf dem Gerät prüfen, „Verwandt“ über `NLEmbedding` (Schwelle 0,5 passend?).
- **iPad-Leistung nachmessen**: Einstellungen „Darstellung“ (258 ms) und Kern-Sperre nach Sync (429 ms) seit `bf594f7`
  behoben; Kartenübersicht (193 ms) und Kaltstart (789 ms) messen;
  Hänger-Fixes vom 14.11. (Heft öffnen, Notiz speichern, ferne Heftseiten entladen) und Zwei-/Drei-Finger-Tipp
  für Rückgängig/Wiederholen im Heft prüfen. Weitere Punkte: `docs/PARITAET.md` → Leistung.
- **Android**: Module vom 2./3.11. (Graph, Bibliothek/PDF, Daily, Statistik, Import/Export, KI-Extras,
  Scanner) sind nur im Code geprüft; ein Punkt gilt erst als erledigt, wenn der Emulator-Screenshot zur PWA passt.
- **Drive**: Login und Upload großer Dateien (resumable, `Location`-Header) mit echtem Google-Konto.

## 2. Nächste Schritte

- **Heft-KI**: Aktionen auf Basis von `ocrText` und Seitenbildern, z. B. „Lernzettel aus diesem Heft“, „Karteikarten
  aus Heft-Seite“.
- **Handschrift schärfen**: lange Sätze, Skizzen-Abgrenzung, Mathe (`handwriting/evaluate_notes_benchmark.py`).
- **iPad-Semantik**: Suche nach Bedeutung, RAG-Quellen im Chat, Fach-Einordnung per Embedding; SwiftUI-Menüs barrierefrei.
- **Android-Semantik**: „Verwandt“-Leiste und RAG-Quellen (semantischer Index auf Android).

## 3. Kern und Leistung

- Heft-Speichern übergibt die ganze Arbeitskopie für den Diff (≈ 50 ms bei 2000 Strichen) → nur geänderte Seiten.
- Start vom Checkpoint ≈ 15–30 % langsamer als früher in JS (Text-Übergabe an WASM, `opt-level = "z"`):
  Binärformat oder Teile je Sammlung prüfen.
- WASM-Größe (≈ 2,4 MB): `opt-level` abwägen (`3` → 4,4 MB, Start ≈ 25 % schneller), `regex` in `impala-ai` ersetzen.
- Bekko-Embedding mit tract Ende-zu-Ende prüfen; `ort`-Feature oder Plattform-Erkenner statt tract.

## 4. Optional / bewusst offen (gemessen unkritisch)

- `web/editor.js`: Blockauswahl-Tasten und `wire` nur mit Getter/Setter-Schnittstelle schneiden; `web/app.js`: `wireEvents()`.
- KI-Werkzeug `change` kopiert vor jeder Änderung alle Seiten/Karten fürs Undo (`tools.js` `managedSnapshot`).
- RAG `related()` liest alle Vektoren im Hauptthread (~200 Einträge).
- Verspätetes, kollidierendes Fremd-Event erscheint bis zum Neustart in Ankunftsreihenfolge.
- Android: Startbildschirm-Widget für fällige Karten.
