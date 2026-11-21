// v4-Aufgaben: Organisatorisches (Fristen, Termine, Räume, Abgabe, Prüfungsinfos, Kontakte).
// Fakten stammen aus den gelesenen Seiten: „0 · Organisatorisches“ (Chemie), „Festkörperphysik“ (+ Übungen),
// „Kontinuumsmechanik“ (+ Übungen), „Differentialgleichungen“ (+ Übungen), „Elektronik – Bauelemente …“ (+ Praktikum).
// Bewusst NICHT verwendet (Test-Leak): DGL-Blatt-04-Abgabe, DGL-Klausurtermin/Hilfsmittel, FKP-Übungsgruppe,
// Lab-Report-Termine, Elektronik-Klausur am 12. Februar.

import { hasTool, matchText, noChanges, noToolErrors } from "../task_helpers.mjs";

// Mindestens eines der Lese-Werkzeuge wurde benutzt.
const gelesen = (r) => ["read_pages", "search", "list_pages", "get_context"].some((n) => hasTool(n)(r));

export default [
	{
		id: "v4-orga-chemie-material",
		mode: "mcp",
		turns: [
			{
				text: "Wo bekomme ich in der Chemie-Vorlesung Allgemeine und Anorganische Chemie die Folien und die Übungszettel her?",
				check: (r) => noToolErrors(r) && noChanges(r) && gelesen(r) && matchText(/ILIAS/)(r) && matchText(/Tutorat|Übungszettel|Übungsblätter/i)(r),
			},
			{
				text: "Und wer hält die Vorlesung?",
				check: (r) => noToolErrors(r) && noChanges(r) && matchText(/Kurz/)(r),
			},
			{
				text: "Gibt es zu den Tutoraten auch einen festen Rhythmus?",
				check: (r) => noToolErrors(r) && noChanges(r) && matchText(/wöchentlich|jede Woche|wöchentl/i)(r),
			},
		],
	},
	{
		id: "v4-orga-fkp-vorlesung",
		mode: "app",
		workspacePage: "Festkörperphysik",
		turns: [
			{
				text: "Wann und wo ist die Vorlesung zur Festkörperphysik?",
				check: (r) => noToolErrors(r) && noChanges(r) && gelesen(r) && matchText(/08:20/)(r) && matchText(/HS\s*00\s*036|Schick/i)(r) && matchText(/101/)(r),
			},
			{
				text: "Gibt es da noch einen zweiten Termin in der Woche?",
				check: (r) => noToolErrors(r) && noChanges(r) && matchText(/Di|Dienstag/)(r) && matchText(/12:15/)(r),
			},
			{
				text: "Wo findet die Übung am Donnerstag statt?",
				check: (r) => noToolErrors(r) && noChanges(r) && matchText(/78/)(r) && matchText(/00\s*014/)(r),
			},
		],
	},
	{
		id: "v4-orga-fkp-pruefung",
		mode: "mcp",
		turns: [
			{
				text: "Wie lautet die Prüfungsnummer für Festkörperphysik, und steht der Klausurtermin schon fest?",
				check: (r) => noToolErrors(r) && noChanges(r) && gelesen(r) && matchText(/11LE50PL-BScMST-4006/)(r) && matchText(/offen|noch nicht|nicht fest/i)(r),
			},
			{
				text: "Wann war die Klausur im Vorjahr?",
				check: (r) => noToolErrors(r) && noChanges(r) && matchText(/20\.\s*(03|3|März)\.?\s*2026/i)(r),
			},
		],
	},
	{
		id: "v4-orga-fkp-vorrechnen",
		mode: "app",
		workspacePage: "Festkörperphysik",
		turns: [
			{
				text: "Bis wann muss ich die Lösung fürs Vorrechnen hochladen?",
				check: (r) => noToolErrors(r) && noChanges(r) && gelesen(r) && matchText(/Dienstag|Di\b/)(r) && matchText(/06:00|6 Uhr|6:00/)(r),
			},
			{
				text: "Wird das Vorrechnen auch bewertet?",
				check: (r) => noToolErrors(r) && noChanges(r) && matchText(/nicht (bewertet|benotet)|unbewertet/i)(r),
			},
		],
	},
	{
		id: "v4-orga-km-gruppen",
		mode: "mcp",
		turns: [
			{
				text: "Wer leitet die Übungen bei Kontinuumsmechanik, und gibt es eine Gruppe auf Englisch?",
				check: (r) => noToolErrors(r) && noChanges(r) && gelesen(r) && matchText(/Matura/)(r) && matchText(/Metta/)(r) && matchText(/englisch/i)(r),
			},
			{
				text: "Wie gebe ich die Übungsblätter ab?",
				check: (r) => noToolErrors(r) && noChanges(r) && matchText(/ILIAS/)(r) && matchText(/Zweier|Dreier|Gruppe/i)(r),
			},
			{
				text: "Wie viel muss ich in der Studienleistung schaffen?",
				check: (r) => noToolErrors(r) && noChanges(r) && matchText(/50\s*(%|Prozent)/)(r) && matchText(/rot/i)(r),
			},
		],
	},
	{
		id: "v4-orga-km-abgabe",
		mode: "app",
		workspacePage: "Kontinuumsmechanik",
		turns: [
			{
				text: "Wann ist die Abgabe für das Übungsblatt zum Flächenschwerpunkt?",
				check: (r) => noToolErrors(r) && noChanges(r) && gelesen(r) && matchText(/22\.\s*11|22\.11\./)(r),
			},
			{
				text: "Welcher Wochentag ist das?",
				check: (r) => noToolErrors(r) && noChanges(r) && matchText(/Sonntag/i)(r),
			},
			{
				text: "Heute ist Mittwoch, der 18.11.2026. Wie viel Zeit habe ich bis dahin noch?",
				check: (r) => noToolErrors(r) && noChanges(r) && matchText(/4\s*Tage|vier\s*Tage/i)(r),
			},
		],
	},
	{
		id: "v4-orga-dgl-vorlesung",
		mode: "mcp",
		turns: [
			{
				text: "Wann und wo ist die Vorlesung Differentialgleichungen?",
				check: (r) =>
					noToolErrors(r) &&
					noChanges(r) &&
					gelesen(r) &&
					matchText(/mittwoch|\bMi\b/i)(r) &&
					matchText(/14:15/)(r) &&
					matchText(/15:45/)(r) &&
					matchText(/082/)(r) &&
					matchText(/00\s*006/)(r),
			},
			{
				text: "Und bis wann muss ich die Übungsblätter abgeben?",
				check: (r) => noToolErrors(r) && noChanges(r) && matchText(/Mittwoch/)(r) && matchText(/14:15/)(r),
			},
			{
				text: "Angenommen, ich bekomme am Mittwoch, dem 25.11.2026, ein neues Blatt. Bis wann muss ich das abgeben?",
				check: (r) => noToolErrors(r) && noChanges(r) && matchText(/02\.\s*12|2\.\s*12\.?|2\.\s*Dezember/i)(r) && matchText(/14:15/)(r),
			},
		],
	},
	{
		id: "v4-orga-dgl-punkte",
		mode: "app",
		workspacePage: "Differentialgleichungen",
		turns: [
			{
				text: "Wie viele Punkte habe ich bisher bei den Übungsblättern, und reicht das für die Zulassung?",
				check: (r) => noToolErrors(r) && noChanges(r) && gelesen(r) && matchText(/18/)(r) && matchText(/90\s*%/)(r),
			},
			{
				text: "Was steht als Feedback zu Blatt 02 drin?",
				check: (r) => noToolErrors(r) && noChanges(r) && matchText(/KI/)(r) && matchText(/Titel/)(r),
			},
		],
	},
	{
		id: "v4-orga-elektronik-pruefung",
		mode: "app",
		workspacePage: "Elektronik – Bauelemente und analoge Schaltungen",
		turns: [
			{
				text: "Wie sind die Elektronik-Klausuren aufgebaut, und wie lang dauern sie?",
				check: (r) =>
					noToolErrors(r) &&
					noChanges(r) &&
					gelesen(r) &&
					matchText(/120/)(r) &&
					matchText(/90/)(r) &&
					matchText(/analog/i)(r) &&
					matchText(/digital/i)(r),
			},
			{
				text: "Welche Hilfsmittel darf ich mitnehmen?",
				check: (r) =>
					noToolErrors(r) &&
					noChanges(r) &&
					matchText(/Taschenrechner/)(r) &&
					matchText(/(kein|ohne|nicht|nur)[^.\n]{0,40}formelsammlung|formelsammlung[^.\n]{0,30}(nicht|verboten|kein)/i)(r),
			},
			{
				text: "Und das Labor, ist das Pflicht?",
				check: (r) => noToolErrors(r) && noChanges(r) && matchText(/Pflicht/)(r),
			},
		],
	},
	{
		id: "v4-orga-fkp-uebung-blatt4",
		mode: "mcp",
		turns: [
			{
				text: "Wann ist in Festkörperphysik die Übung zu Blatt 4, und worum geht es da?",
				check: (r) => noToolErrors(r) && noChanges(r) && gelesen(r) && matchText(/24\.\s*11|24\.11\./)(r) && matchText(/Bragg|Laue/)(r),
			},
			{
				text: "Und Blatt 5, wann ist das?",
				check: (r) =>
					noToolErrors(r) && noChanges(r) && matchText(/01\.\s*12|1\.\s*12\.?|1\. Dezember/i)(r) && matchText(/Brillouin|Debye/)(r),
			},
		],
	},
];
