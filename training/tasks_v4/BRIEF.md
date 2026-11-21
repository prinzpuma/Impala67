# Auftrag: neue Trainings-Aufgaben (v4) für das Impala67-Finetuning

Ziel: Ein kleines lokales Modell (Qwen3.5-4B) soll lernen, in der Notiz-App Impala67 mit den flachen
Werkzeugen (`core/impala-ai/src/tool_defs_flat.json`) **inhaltlich richtige** Antworten zu geben.
Jede Aufgabe wird später gegen eine Kopie der echten Nutzerdaten durchgespielt; nur Durchläufe,
deren `check` besteht, kommen in den Trainingsdatensatz. Die Checks sind also der Qualitätsfilter.

## Dateiformat

Lege genau eine Datei `training/tasks_v4/<kategorie>.mjs` an:

```js
import { hasTool, calledTool, hasToolWhere, hasChange, hasChangeWhere, countCreatedCards,
	noToolErrors, noTools, noChanges, nonEmpty, maxLen, matchText, notText, writtenTo } from "../task_helpers.mjs";

export default [
	{
		id: "v4-<kategorie>-<kurzname>",      // eindeutig, Präfix v4-
		mode: "mcp",                          // "mcp" (externer Assistent, nichts offen) oder "app" (Chat in der App)
		workspacePage: "Festkörperphysik",    // nur bei mode "app": Seite, die gerade offen ist (exakter Titel)
		answers: ["…"],                       // nur wenn ask_choice vorkommt: Antwort(en) des Nutzers
		turns: [
			{ text: "Nutzer-Nachricht", check: (r) => noToolErrors(r) && hasTool("read_pages")(r) && matchText(/…/i)(r) },
			// weitere Runden im selben Gespräch …
		],
	},
];
```

Helfer: siehe `training/task_helpers.mjs`. `r.text` = Antwort, `r.tools` = Werkzeugaufrufe,
`r.changes` = Schreib-Operationen (`page.create|patch|append|replace|props|rename|move|trash|archive`,
`card.create|update|move|trash|suspend|reset`, `deck.create|rename|move|trash`, `heft.append`).
`writtenTo(/titel/i)(r)` liefert den geschriebenen Text zu einer Seite.

## Regeln (wichtig)

1. **Echte Daten:** Nutze nur Seiten, Ordner und Stapel, die es wirklich gibt. Prüfe Titel und
   Inhalte mit den MCP-Werkzeugen `mcp__impala67__impala_list_pages`, `…_read_pages`, `…_search`,
   `…_list_decks`, `…_list_cards` (vorher per ToolSearch laden). **Nur lesen** – niemals Schreib-Werkzeuge
   der echten App aufrufen (create/edit/organize/write/heft/storage sind verboten).
2. **Faktenchecks aus echten Inhalten:** Wenn die Antwort ein Datum, eine Zahl, einen Namen oder
   einen Fachbegriff aus einer Seite nennen muss, lies die Seite und baue den Regex aus dem echten Wert.
   Regexe tolerant gegenüber Schreibweisen (`0?6\.\s*(12|dez)`, `1[,.]33\s*mA`), aber nicht beliebig.
3. **Natürliche Sprache:** Schreib die Nutzer-Nachrichten so, wie ein Student wirklich fragt –
   **keine Werkzeugnamen** im Text, keine Anleitungen wie „nutze read_pages“. Deutsch, gern locker.
4. **Kein Test-Leak:** Nicht verwenden (das ist der Benchmark): Heft „Aufbau-Übungsblatt · Von Blatt 2 zu
   Blatt 4“; Lab-1-Abgabe/Report-Termine; DGL-Klausurtermin/Hilfsmittel; FKP-Übungsgruppe; DGL Blatt 04
   Abgabe; „was machen wir heute in DGL“/nichtlineare DGL; FKP-Tracker Blatt 02/Anwesenheit; Karten zu
   Lab 1 in „Elektronik::Praktikum::Lab 1“; Kontinuumsmechanik V04 ins Vorlesungsverzeichnis; Lernpfad
   „Blatt 2 → Oszillator“; BJT-Skript-PDF Analysebeispiele / Early-Effekt; Elektronik-Klausur am 12. Februar,
   HS 1015, Lernpartner Malte; Emitterschaltung/CMRR/NMOS-PMOS/Stromspiegel/Z-Diode/Miller/741 als
   Wissensfragen-Kette. Ähnliche *Arten* von Aufgaben mit *anderen* Fächern/Fakten sind erwünscht.
5. **Checks streng genug:** Jede Runde prüft (a) dass nötige Werkzeuge ohne Fehler benutzt wurden bzw.
   bei reinen Wissens-/Tutor-Fragen `noTools`, (b) den inhaltlichen Kern per Regex, (c) bei Änderungen,
   dass nichts Falsches passiert (`!hasChange("page.replace")`, kein Duplikat, nur die gewünschte Seite).
   Ein Check, der fast jede Antwort durchlässt, ist wertlos.
6. **Mehrrundig:** Mindestens die Hälfte der Aufgaben hat 2–3 Runden, die aufeinander aufbauen
   („kürzer bitte“, „und was heißt das für …“, „prüf meine Lösung“).
7. Danach `node --check training/tasks_v4/<kategorie>.mjs` ausführen und Fehler beheben.
8. Antworte am Ende nur mit: Dateiname, Anzahl Aufgaben, Anzahl Runden, und welche Seiten du gelesen hast.
