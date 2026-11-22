# Konzeptplan: KI-Lehrer-Modus & Baustein-Arbeitsblätter (Impala67)

> **Status:** Konzeptentwurf (Baustein-Arbeitsblätter `create_worksheet` bereits umgesetzt; Lehrer-Workspace, Protokoll, Zwei-Takt-Schleife und Finetuning offen)

---

## 1. Vision & Grundprinzip

Der **KI-Lehrer-Modus** ist ein eigenständiger Lern-Modus, in dem die KI als **persönlicher Lehrer und Versuchsleiter** die komplette Steuerung übernimmt:

- **Zielorientiert auf Klausuren hin:** Lehrplan auf Basis von Klausurtermin, Vorlesungszeit, Abgaben/Übungen und Lernfortschritt.
- **Live-Beobachtung:** Während du lernst (Karten, Arbeitsblätter, Übungen), misst das System exakt mit (Zeit pro Aufgabe, Fehlerarten, Abbrüche, Zögern, Heft-Eingaben), gibt gezielte Tipps und füllt bei Bedarf ein **strukturiertes Protokoll**.
- **Asynchrone Optimierung (Idle / Über Nacht am PC):** Wenn du nicht da bist, wertet das lokale Modell deine Sitzungsdaten aus, aktualisiert deinen Lernstand, passt den Lehrplan an und bereitet Arbeitsblätter, Zusammenfassungen und Kontrollfragen für das nächste Mal vor.
- **Strikt getrennte KI-Datenbank:** Die KI bekommt einen eigenen abgeschotteten Bereich („Lehrer-Workspace“), in dem sie Struktur, Ordner, Lehrpläne, Arbeitsblätter und Protokolle frei organisieren darf – ohne deine persönliche Notiz-Bibliothek anzufassen.

---

## 2. Baustein-Arbeitsblätter (Vorlagen-System)

Statt dass die KI mühsam Layouts erfindet, wählt sie **modulare Vorlagen-Bausteine** und kombiniert sie zu einem vollständigen Arbeitsblatt.

### A) Vorlagen-Baukasten (Auswahl)
Die KI wählt je nach Lernziel einen Rahmen + beliebige Bausteine:
1. **Lückentext** (Definitionen, Merksätze, Formeln mit definierten Lücken + Lösungsschlüssel)
2. **Rechen- / Herleitungsbox** (Aufgabenstellung + definierter Leerraum / Kästchen zum handschriftlichen Rechnen + Stufen-Hinweise)
3. **Fehler-Suche („Finde den Denkfehler“)** (fehlerhafter Beweis/Code/Rechenweg zum Markieren & Korrigieren)
4. **Zuordnung / Vergleichs-Matrix** (Begriffe, Eigenschaften, Verfahren gegenüberstellen)
5. **Konzept-Check / Kurzfragen** (Verständnisfragen mit Bewertungskriterien)
6. **Kompakt-Zusammenfassung / Spickzettel** (verdichtete Übersicht für genau die Schwachstellen aus dem Protokoll)

### B) Zwei Ausgabewege aus demselben Bauplan
Die KI erzeugt **ein strukturiertes JSON** (Titel, Fach, Zeitbudget, Liste von Bausteinen + versteckten Lösungen/Hinweisen):
- **Interaktiv in der App:** Direkt klick-/tippbar (z. B. Lückentext am PC ausfüllen mit sofortiger Prüfung & Zeitmessung).
- **Als Heft-Seite (`Seitenhintergrund`):** Deterministisch als sauberes DIN-A4-Layout gerendert und ins Heft gelegt. Du schreibst mit dem Stift in die Boxen; die KI sieht danach über Seitenbild + `ocrText`, *was* du in welche Box geschrieben hast, und kann gezielt korrigieren.

---

## 3. Technische Umsetzung: App-Tool + MCP + getrennte KI-Datenbank

### A) Wie Tools in Impala67 gebaut werden (nicht „eine Menge MCP-Tools“)
In Impala67 leitet `mcp/content-tools.mjs` alle `impala_*`-MCP-Tools automatisch aus einer einzigen Quelle ab: **`core/impala-ai/src/tool_defs_flat.json`**.
- **Ein Tool definieren = App + MCP gleichzeitig:** Wenn das Arbeitsblatt-System als normales flaches Tool in `tool_defs_flat.json` (und Ausführung in Kern/`tools.js`) landet, funktioniert es **sowohl direkt in der App (mit lokalem/Cloud-Modell, auch mobil) als auch automatisch als `impala_*`-Tool über MCP**.
- **Wenige, klare Tools statt Tool-Flut:** Viele kleine Einzel-Tools überfordern lokale Modelle und blähen das Prompt-Schema auf. Statt 10 Arbeitsblatt-Tools reicht **ein** flaches Tool:
  - `create_worksheet`: Nimmt `title`, `subject`, `target` (`"page"` | `"heft"` | `"teacher"`), und `blocks` (Array aus Vorlagen-Typen wie `cloze`, `calc`, `find_error`, `matrix`, `summary`). Den Rest (A4-Rendering, Kästchen, Lösungsauswertung, Einfügen ins Heft) übernimmt deterministischer App-/Kern-Code.
- **Lehrer-Modus-Steuerung:** Für die getrennte Lehrer-DB wenige klare Werkzeuge (z. B. `teacher_plan`, `teacher_log` für die Protokoll-Vorlage) plus optionales `workspace: "teacher"` bei Lese-/Arbeitsblatt-Tools, statt den Tool-Katalog zu verdoppeln.

### B) Trennung der Datenbanken
- **Persönliche Bibliothek (bisheriger Workspace):** Bleibt unangetastet. Der KI-Lehrer darf hier **nur lesen** (Vorlesungsskripte, PDFs, Folien, deine Mitschriebe, Abgaben als Rohstoff).
- **KI-Lehrer-Datenbank (eigener Raum):** Eigene lokale Speicherung (getrennter Store in IndexedDB bzw. getrennter Event-Stream, damit deine normalen Notizen, Sync-Limits und die Seitenliste sauber bleiben).
  - Hier entscheidet die KI **frei über Ordnerstruktur, Benennung, Umstrukturierung und Aufräumen**.
  - Enthält: Lehrpläne, Klausur-Roadmaps, generierte Arbeitsblätter, Lehrer-Zusammenfassungen, diagnostische Tests und die Schüler-Protokolle.
  - Optional: Was dir besonders gefällt, kannst du bewusst „In meine Bibliothek übernehmen“.

---

## 4. Das KI-Protokoll („Versuchskaninchen-Akte“)

Damit die KI nicht unstrukturiert Prosa schreibt, bekommt sie eine **feste Protokoll-Vorlage** mit klaren Feldern, die sie **eigenständig nach Bedarf** (nicht zwanghaft bei jedem Klick) befüllt und fortschreibt.

### Vorgeschlagene Struktur der Protokoll-Vorlage
1. **Sitzungs-Metadaten (automatisch erfasst, nicht von KI geschätzt):**
   - Start/Ende, Uhrzeit, Dauer je Aufgabe/Karte in ms, Anzahl Hinweise, Abbrüche, Trefferquote.
2. **Beobachtungen & Fehlermuster (KI füllt bei Auffälligkeiten aus):**
   - *Was klappt sicher?*
   - *Wo wird gezögert oder geraten?*
   - *Konkreter Fehlertyp* (z. B. Flüchtigkeitsfehler vs. fehlendes Grundkonzept vs. Transferproblem).
3. **Lernprofil-Hypothesen (über Sitzungen hinweg fortgeschrieben):**
   - *Welches Format wirkt bei diesem Fach am besten?* (z. B. erst Lückentext → dann Rechnung vs. direkt Fehler-Suche)
   - *Belastungsgrenze / Ermüdungspunkt* (z. B. nach X Minuten sinkt Rechengenauigkeit)
4. **Maßnahmen für die nächste Einheit (verbindlich für die Idle-Phase):**
   - *Nächster Fokus*, *zu erstellendes Arbeitsblatt*, *Lehrplan-Anpassung*.

---

## 5. Lehrplan-Steuerung & Zwei-Takt-Schleife

### A) Lehrplan-Ebene (pro Fach / Klausur)
Eingaben vom Nutzer (einmalig oder bei Änderungen):
- **Klausur-Ziel:** Datum, geschätzte Relevanz/Gewichtung der Themen, Altklausuren/Übungsblätter.
- **Zeitbudget & Termine:** Vorlesungszeiten, wöchentliches Lernzeit-Ziel, Abgabe-Deadlines für Übungsblätter.

Daraus pflegt die KI einen **dynamischen Wochen-/Tagesplan**:
- Balanciert automatisch: *Vorlesung nachbereiten* vs. *Abgabe-Übungen vorbereiten* vs. *Wiederholung gegen Vergessen* vs. *Klausur-Simulation*.
- Merkt die KI, dass ein Thema länger dauert als geplant, schiebt sie Puffer um oder warnt frühzeitig (*„Thema X frisst zu viel Zeit – für die Klausur reicht hier Basis-Sicherheit, Fokus lieber auf Y“*).

### B) Takt 1 – Live-Modus („Lehrer sitzt daneben“)
- **Start:** Ein Knopf *„Nächste Einheit starten“* – keine eigene Auswahl nötig.
- **Ablauf:** Die KI steuert die Reihenfolge (z. B. kurzes Warm-up → Arbeitsblatt → Reflexion / Mini-Check).
- **Beobachtung & Hilfe:** Stoppuhr läuft pro Element mit; bei Stillstand, wiederholtem Fehler oder Hilfe-Klick gibt die KI genau den kleinsten nötigen Tipp und notiert das Ereignis.

### C) Takt 2 – Hintergrund-Labor („Wenn du weg bist“)
Läuft lokal am PC (wenn Modell erreichbar & Rechner idle/am Strom):
1. Wertet neue Telemetrie + fertige Arbeitsblätter/Heftseiten der letzten Sitzung aus.
2. Aktualisiert **Protokoll-Vorlage** und **Lehrplan-Fortschritt**.
3. Überprüft Lernziele (*Was wurde wirklich beherrscht, was nur geraten?*).
4. Produziert vorab das Material für die nächste Sitzung (Arbeitsblätter aus Vorlagen, gezielte Zusammenfassung, Kontroll-Lückentext).

---

## 6. KI-Zeitstrahl-Modus („Lernwelt aus Skripten & Geschichte“)

Ein alternativer, vollständig KI-kurierter Lernmodus, der trockene Fächer (z. B. Elektronik/E-Technik) als **interaktiven, verzweigten Zeitstrahl** aufbaut – getarnt als Entdeckungs-/Geschichtsunterricht mit Ziel auf die konkreten Klausurthemen.

### Grundprinzip
- **Vollständig KI-generierte Lernwelt:** Die KI liest alle relevanten Inhalte aus deinem Workspace (Vorlesungsskripte, PDFs, Notizen, Abgaben, Altklausuren) sowie **Wikipedia** als historische Quelle und erstellt daraus Lektions-Knoten mit Einführung, Quizzen, Arbeitsblättern (`create_worksheet`) und Karteikarten.
- **Abzweigungen & Zusammenführungen:** Parallele Stränge verbinden verschiedene Themen/Fächer miteinander (z. B. wie Halbleiterphysik und Schaltungstechnik zusammenlaufen) und führen gezielt auf die Klausur-Ziele zu.
- **Flexibler Umfang (Ganzes Semester vs. Nachsteuerung):** Liegen alle Skripte bereits vor, kann die KI direkt den gesamten Semester-Zeitstrahl samt Lektionen entwerfen – und ihn später anhand deines echten Lernfortschritts dynamisch anpassen (Zwischenschritte einfügen, Schwerpunkte verschieben).

### Qualität & Gestaltung
1. **Quellen-Anker pro Knoten:** Jeder Zeitstrahl-Knoten speichert verbindlich seine Quellen (konkrete Workspace-Seiten/PDFs für Klausurstoff & Notation + Wikipedia-Artikel für Historie/Intuition), sodass ein Klick direkt zur Originalquelle führt.
2. **Gute Bilder & Visualisierungen:** Zentral für das Verständnis – Einbau passender Bilder, Schaltpläne, Diagramme, Skript-Ausschnitte, Wikipedia/Commons-Grafiken oder generierter SVG-Skizzen direkt in den Lektionen.
3. **Freie thematische Gestaltung durch die KI:** Die KI bekommt bewusst große gestalterische Freiheit beim visuellen Aufbau und Design (z. B. eigene Layouts, CSS/SVG-Styles, Farb- und Epochen-Welten je nach Fach/Thema – etwa ein technischer Schaltplan-/Oszilloskop-Look oder eine leuchtende „Sacred Timeline“), statt in starre Theme-Parameter gezwängt zu werden.
4. **Harter Übungskern:** Die historische Story dient als motivierender Einstieg; gemeistert ist ein Knoten erst, wenn die zugehörigen Übungen/Arbeitsblätter/Kontrollfragen bestanden sind (Fortschrittsanzeige direkt am Zeitstrahl).

### Einbindung ins App-Layout
- **Einstieg als Pille oben links (`#sidebar`):** Als eigener Tab/Pille oben links neben `Home / Chats / Karteikarten / Suchen`.
- **Standardmäßig deaktiviert (Opt-in über Einstellungen):** Über einen Schalter in den Einstellungen lässt sich der Modus aktivieren. Ist er aus (Standard), bleibt die Pille oben links komplett ausgeblendet, sodass die App für normale Nutzung unverändert schlank bleibt.
- **3-Spalten-Nutzung (`web/index.html`):**
  - **Links (`#tree`):** Zeigt die **getrennte Lehrer-Datenbank** (Klausur-Ziele, Fächer, Lehrplan, Protokolle), während die normale Notiz-Seitenliste unberührt bleibt.
  - **Mitte (`#main`):** Zeigt den **interaktiven Zeitstrahl** bzw. beim Klick auf einen Knoten die Lektion (Story, Bilder, Arbeitsblatt, Quiz) – optional im Vollbild-Lernmodus.
  - **Rechts (`#panel`):** Der bestehende KI-Coach übernimmt in diesem Modus den **Lehrer-Kontext** (aktuelle Lektion, Quellen, Protokoll).
- **Startseite (`Home`):** Zusätzlich eine prominente Kachel **„Nächste Einheit starten“** mit Klausur-Countdown für den Einstieg mit einem Klick.

---

## 7. LLM-Finetuning – Lehren aus dem früheren Versuch

In `training/AGENTS.md` zeigt der frühere Versuch klar, warum das erste Finetuning schlechter als das Basismodell war (`7/45` vs. `24/45`):
- Synthetische Einzeiler und winzige Denkblöcke haben das Modell dazu gebracht, kaum noch nachzudenken (Thinking kollabierte von ~488 auf ~44 Tokens) und Bilder zu ignorieren.
- Damals musste das kleine 4B-Modell noch verschachtelte `change`-Aufrufe treffen.

### Fahrplan für die neue Finetuning-Session
1. **Basis & Schema modernisieren:**
   - `training/` (insbesondere `benchmark_agent.py`, `generate_dataset.py`, `tool_defs.json`) von den alten verschachtelten `change`-Tools auf das aktuelle **flache Tool-Format** (`core/impala-ai/src/tool_defs_flat.json`) umstellen.
   - Erst eine ehrliche **Baseline** des un-finetunten Modells auf dem flachen Agenten-Benchmark messen.
2. **Option B (Rejection Sampling / Self-Distillation) statt synthetischer Mini-Daten:**
   - Echte Aufgaben aus deinem Workspace (inkl. langen Vorlesungsauszügen, Heft-Bildern via `view_heft_page`, LaTeX-Karten und später Arbeitsblatt-JSONs) von einem starken Lehrer-Modell bzw. Best-of-N durchlaufen lassen.
   - **Nur Verläufe behalten, die den harten Validator bestehen** – und zwar mit **vollständigem `<think>…</think>`-Block und echten Bildern**, damit Reasoning und Vision beim Training nicht mehr wegkollabieren.
3. **Gezielte Spezial-Fähigkeiten im Datensatz verankern:**
   - Sauberes Arbeitsblatt-Vorlagen-JSON (inkl. KaTeX-Mathe und Lückentext-Syntax).
   - Prägnante Protokoll-Einträge und kurze sokratische Hinweise statt langatmiger Standard-Antworten.
4. **Modellwahl nach Ziel-Hardware:**
   - Für PC (LM Studio / Ollama) prüfen, welches Basismodell (z. B. 4B für Geschwindigkeit/Gerät vs. 9B–14B+ für stärkere Pädagogik) am besten zum lokalen VRAM passt, und gegen die neue Baseline benchmarken – nur ein Finetune, der die Baseline klar schlägt, wird übernommen.

---

## 8. Offene Punkte für unsere Diskussion

1. **Sync & Geräte:** Soll die getrennte KI-Datenbank rein lokal auf dem PC liegen (Startpunkt) oder auch auf iPad/Android gesynct werden (z. B. um dort vorbereitete Arbeitsblätter im Heft mit dem Stift zu lösen)?
2. **Nächster Schritt:** Nach `create_worksheet` als Nächstes **die getrennte KI-Datenbank + Protokoll-Schleife** bauen oder zuerst den **KI-Zeitstrahl-Modus** als Oberfläche?
3. **Eingriffsstärke des Live-Lehrers:** Wie stark soll die KI während einer laufenden Sitzung eingreifen (nur auf Knopfdruck / nach Aufgabenende vs. proaktive Hinweise)?
4. **Zeitstrahl-Design & Bilder:** Welche konkreten Design-Templates/Themes (z. B. Zeitstrahl-Graph, Schaltplan-Stil) und Bildquellen (Skript-Zuschnitte, Wikimedia/Wikipedia-API, SVG) soll die KI beim Bau der Lektionen nutzen dürfen?
5. **Hardware am PC:** Welche GPU / wie viel VRAM steht lokal zur Verfügung (bestimmt direkt, welches Basismodell + Finetuning-Größe wir einplanen)?
