// v4-Kategorie "gedaechtnis": lange Chats. Private Fakten werden beiläufig genannt, zwischendurch
// kommen kurze Fachfragen, am Ende werden die Fakte abgefragt (eine Aufgabe korrigiert einen Fakt).
// Die Fakten sind bewusst NICHT die Benchmark-Fakten (Elektronik-Klausur, Malte, HS 1015, Emitter-Kette).
// Regeln: training/tasks_v4/BRIEF.md

import { matchText, noChanges, noTools, noToolErrors, notText } from "../task_helpers.mjs";

export default [
	// 1. Chemie: Praktikum-Fakten, Avogadro, pH, Katalysator
	{
		id: "v4-gedaechtnis-chemie-praktikum",
		mode: "mcp",
		turns: [
			{
				text: "Kurz vorab: Mein Chemie-Praktikum ist donnerstags, Raum 0.21. Merk dir das bitte, du musst nichts speichern.",
				check: (r) => noChanges(r) && noToolErrors(r) && matchText(/merk|gemerkt|notiert|klar|verstanden|behalt|\bok/i)(r),
			},
			{
				text: "Was ist eigentlich die Avogadro-Konstante, ungefähr?",
				check: (r) => noTools(r) && matchText(/6[,.]0\d{0,2}\D{0,25}10\D{0,4}(23|²³)/)(r),
			},
			{
				text: "Und wenn ich 0,1 mol/L Salzsäure habe, was ist der pH-Wert ungefähr?",
				check: (r) => noTools(r) && matchText(/pH.{0,40}\b1([,.]0*)?\b/i)(r),
			},
			{
				text: "Okay. Und was ist ein Katalysator, kurz gesagt?",
				check: (r) =>
					noTools(r) && matchText(/aktivierungsenergie|beschleunig|schneller|senkt|nicht verbraucht|unverbraucht/i)(r),
			},
			{
				text: "Wann und wo habe ich mein Chemie-Praktikum nochmal?",
				check: (r) => noChanges(r) && matchText(/donnerstag/i)(r) && matchText(/0[.,]21/)(r),
			},
		],
	},

	// 2. Festkörperphysik (App-Modus): Tutor und PIN, Korrektur der PIN, Brillouin-Zone, Bloch
	{
		id: "v4-gedaechtnis-festkoerper-pin-korrektur",
		mode: "app",
		workspacePage: "Festkörperphysik",
		turns: [
			{
				text: "Merk dir bitte: Mein Tutor für Festkörperphysik heißt Jonas, und die Abgabe-PIN ist 8264. Du musst das nicht speichern, nur im Kopf behalten.",
				check: (r) => noChanges(r) && noToolErrors(r) && matchText(/merk|gemerkt|behalt|klar|verstanden|notiert/i)(r),
			},
			{
				text: "Was ist eigentlich die Brillouin-Zone, grob erklärt?",
				check: (r) =>
					noChanges(r) && noToolErrors(r) && matchText(/wellenvektor|k-?raum|reziprok|impuls|wellenzahl|gitter/i)(r),
			},
			{
				text: "Ach nee, die PIN ist 8246, nicht 8264.",
				check: (r) => noChanges(r) && noToolErrors(r) && matchText(/8246/)(r),
			},
			{
				text: "Und was besagt das Bloch-Theorem?",
				check: (r) =>
					noTools(r) && matchText(/bloch|periodisch|gitterperiod|wellenfunktion|ebene.{0,3}welle/i)(r),
			},
			{
				text: "Wie hieß noch mal mein Tutor, und welche PIN gilt jetzt für die Abgabe?",
				check: (r) =>
					noChanges(r) &&
					matchText(/jonas/i)(r) &&
					matchText(/8246/)(r) &&
					notText(/PIN\D{0,20}8264/i)(r),
			},
		],
	},

	// 3. Statik: Lerngruppe, Gleichgewicht, Biegemoment, Freischnitt
	{
		id: "v4-gedaechtnis-statik-lerngruppe",
		mode: "mcp",
		turns: [
			{
				text: "Meine Lerngruppe heißt „Team Gamma“ und trifft sich mittwochs um 18:30 Uhr. Merk dir das einfach, speichern musst du nichts.",
				check: (r) => noChanges(r) && noToolErrors(r) && matchText(/merk|gemerkt|notiert|klar|verstanden|behalt|\bok/i)(r),
			},
			{
				text: "Statik-Frage: Welche Gleichgewichtsbedingungen gelten für einen starren Körper in der Ebene?",
				check: (r) =>
					noTools(r) && matchText(/(Σ|∑|summe)[^\n]{0,30}(F|M|Kraft|Moment)|momentensatz|kräftegleichgewicht/i)(r),
			},
			{
				text: "Und welche Einheit hat ein Biegemoment?",
				check: (r) => noTools(r) && matchText(/N\s*[·*.]?\s*m\b|Nm\b|Newton\s*-?\s*Meter/i)(r),
			},
			{
				text: "Was ist ein Freischnitt, in einem Satz?",
				check: (r) =>
					noTools(r) && matchText(/freischnitt|freigeschnitten|freigemacht|freigelegt|herausgetrennt|isoliert/i)(r),
			},
			{
				text: "Wie heißt meine Lerngruppe nochmal, und wann treffen wir uns?",
				check: (r) =>
					noChanges(r) && matchText(/team\s*gamma/i)(r) && matchText(/mittwoch/i)(r) && matchText(/18[:.,]30/)(r),
			},
		],
	},

	// 4. DGL-Numerik (App-Modus): Übung, Euler, Korrektur des Raums, implizit, Schrittweite
	{
		id: "v4-gedaechtnis-numerik-raum-korrektur",
		mode: "app",
		workspacePage: "Festkörperphysik",
		turns: [
			{
				text: "Die Numerik-Übung ist freitags um 10 Uhr im Raum 1.12, Ansprechpartnerin ist Dr. Hanna Keller. Merk dir das bitte, du musst nichts speichern.",
				check: (r) => noChanges(r) && noToolErrors(r) && matchText(/merk|gemerkt|notiert|klar|verstanden|behalt|\bok/i)(r),
			},
			{
				text: "Was macht das Euler-Verfahren bei einer Differentialgleichung im Kern?",
				check: (r) =>
					noChanges(r) && noToolErrors(r) && matchText(/euler/i)(r) && matchText(/schritt|steigung|tangente|y_?\{?n\s*\+\s*1|linear/i)(r),
			},
			{
				text: "Ach nee, der Raum ist 0.23, nicht 1.12.",
				check: (r) => noChanges(r) && noToolErrors(r) && matchText(/0[.,]23/)(r),
			},
			{
				text: "Und was ist der Unterschied zu einem impliziten Verfahren?",
				check: (r) => noTools(r) && matchText(/implizit/i)(r) && matchText(/stabil|steif|gleichung/i)(r),
			},
			{
				text: "Was ist eigentlich die Schrittweite h, und warum ist sie wichtig?",
				check: (r) => noTools(r) && matchText(/schrittweite|\bh\b/i)(r) && matchText(/genau|fehler|stabil|klein|konvergen|ordnung/i)(r),
			},
			{
				text: "Wann und wo ist die Numerik-Übung, und wer ist die Ansprechpartnerin?",
				check: (r) =>
					noChanges(r) &&
					matchText(/freitag/i)(r) &&
					matchText(/10\s*Uhr|10[:.]00|\b10\b/i)(r) &&
					matchText(/0[.,]23/)(r) &&
					matchText(/keller/i)(r) &&
					notText(/(raum|in)\s*1[.,]12/i)(r),
			},
		],
	},

	// 5. Digitaltechnik: Hochschulsport, Multiplexer, sequenziell, Korrektur der Halle, 3-Bit-Zähler
	{
		id: "v4-gedaechtnis-digitaltechnik-halle",
		mode: "mcp",
		turns: [
			{
				text: "Mein Hochschulsport-Kurs ist dienstags um 7:45 Uhr in Halle 3, die Trainerin heißt Lea. Merk dir das, speichern musst du nichts.",
				check: (r) => noChanges(r) && noToolErrors(r) && matchText(/merk|gemerkt|notiert|klar|verstanden|behalt|\bok/i)(r),
			},
			{
				text: "Digitaltechnik: Was macht ein Multiplexer?",
				check: (r) => noTools(r) && matchText(/eingänge?|auswahl|auswählen|wählt|select/i)(r),
			},
			{
				text: "Und was unterscheidet kombinatorische von sequenziellen Schaltungen?",
				check: (r) => noTools(r) && matchText(/speicher|takt|gedächtnis|zustand/i)(r),
			},
			{
				text: "Ach, Halle 3 war falsch, der Kurs ist in Halle 5.",
				check: (r) => noChanges(r) && noToolErrors(r) && matchText(/halle\s*5/i)(r),
			},
			{
				text: "Wie viele verschiedene Zustände kann ein 3-Bit-Zähler annehmen?",
				check: (r) => noTools(r) && matchText(/\b8\b|acht/i)(r),
			},
			{
				text: "Wann und wo ist mein Hochschulsport, und wie heißt die Trainerin?",
				check: (r) =>
					noChanges(r) &&
					matchText(/dienstag/i)(r) &&
					matchText(/7[:.]45/)(r) &&
					matchText(/halle\s*5/i)(r) &&
					matchText(/lea/i)(r) &&
					notText(/halle\s*3\b/i)(r),
			},
		],
	},

	// 6. Mix Chemie/Festkörper: Lernpartnerin, Lieblingsformel, Statik-Klausur, Bandmodell, pH
	{
		id: "v4-gedaechtnis-mix-lieblingsformel",
		mode: "mcp",
		turns: [
			{
				text: "Drei Sachen noch: Meine Lernpartnerin heißt Sophie, meine Lieblingsformel ist die Euler-Identität e^(iπ) + 1 = 0, und die Statik-Klausur ist am 19. März. Merk dir das bitte, du musst nichts speichern.",
				check: (r) => noChanges(r) && noToolErrors(r) && matchText(/merk|gemerkt|notiert|klar|verstanden|behalt|\bok/i)(r),
			},
			{
				text: "Chemie kurz: Was ist ein Katalysator?",
				check: (r) =>
					noTools(r) && matchText(/aktivierungsenergie|beschleunig|schneller|senkt|unverbraucht|nicht verbraucht|geschwindigkeit/i)(r),
			},
			{
				text: "Bandmodell: Was ist der Unterschied zwischen Leiter, Halbleiter und Isolator?",
				check: (r) => noTools(r) && matchText(/bandl[üu]cke/i)(r) && matchText(/leitungsband|valenzband/i)(r),
			},
			{
				text: "Und was bedeutet der pH-Wert eigentlich?",
				check: (r) =>
					noTools(r) && matchText(/wasserstoff|h\+|h₃o|oxonium|logarithm|-log|negativ.{0,20}(log|dekad)/i)(r),
			},
			{
				text: "Wie heißt nochmal meine Lernpartnerin, was ist meine Lieblingsformel, und wann ist die Statik-Klausur?",
				check: (r) =>
					noChanges(r) &&
					matchText(/sophie/i)(r) &&
					matchText(/euler|e\s*\^/i)(r) &&
					matchText(/19\.?\s*(märz|3\.)|19[./]0?3/i)(r),
			},
		],
	},
];
