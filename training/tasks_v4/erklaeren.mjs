// Kategorie „erklaeren“: Der Nutzer will eine konkrete Vorlesung aus seinen Notizen erklärt haben.
// Runde 1: Überblick + Vorkenntnisse (Seite gelesen, Kernbegriffe der echten Seite).
// Runde 2: zu kompliziert → kürzer, gegliedert, mit Alltagsbild/Beispiel.
// Runde 3: konkrete Ja/Nein- oder Faktfrage zum Inhalt der Seite.
// Alle Aufgaben sind rein lesend (noChanges), Fakten stammen aus den gelesenen Seiten.

import { hasTool, matchText, maxLen, nonEmpty, noToolErrors, noChanges, notText } from "../task_helpers.mjs";

// Schreibt nichts, meldet keine Werkzeugfehler.
const basis = (r) => noToolErrors(r) && noChanges(r);
// Gegliedert: Aufzählung, nummerierte Liste oder Stichpunkte (auch fett formatiert).
const GEGLIEDERT = matchText(/(^|\n)\s*(\*{0,2}\d+[.)]|[-*•])\s+/);
// Alltagsbild oder Beispiel.
const ALLTAG = matchText(/z\.\s?B\.|beispiel|stell dir|vergleich|bild|wie (ein|eine|beim)|alltag/i);

export default [
	// 1 ─ Laplace-Transformation (mcp, 3 Runden)
	{
		id: "v4-erklaeren-laplace-stabilitaet",
		mode: "mcp",
		turns: [
			{
				text: "Erklär mir kurz, worum es in „10 · Laplace-Transformation“ geht und was ich vorher können muss.",
				check: (r) =>
					basis(r) &&
					hasTool("read_pages")(r) &&
					maxLen(1800)(r) &&
					matchText(/laplace/i)(r) &&
					matchText(/anfangswert|differential|DGL/i)(r) &&
					matchText(/partialbruch|integral|fourier|pol/i)(r),
			},
			{
				text: "Das ist mir zu kompliziert. Erklär es einfacher und in kleinen Häppchen, bitte.",
				check: (r) => basis(r) && nonEmpty(120)(r) && maxLen(1500)(r) && GEGLIEDERT(r) && ALLTAG(r),
			},
			{
				text: "Kurze Frage: Ist ein Pol mit Realteil genau null, also direkt auf der imaginären Achse, stabil, grenzstabil oder instabil?",
				check: (r) => basis(r) && matchText(/grenzstabil/i)(r),
			},
		],
	},

	// 2 ─ Fourier-Methoden, Übertragungsfunktion (app, 2 Runden)
	{
		id: "v4-erklaeren-fourier-lti",
		mode: "app",
		workspacePage: "9 · Fourier-Methoden",
		turns: [
			{
				text: "Worum geht es in „9 · Fourier-Methoden“ und was muss ich vorher können? Bitte kurz.",
				check: (r) =>
					basis(r) &&
					hasTool("read_pages")(r) &&
					maxLen(1800)(r) &&
					matchText(/green|impulsantwort|übertragungsfunktion|faltung/i)(r) &&
					matchText(/fourier|integral|differential|DGL/i)(r),
			},
			{
				text: "Das ist mir zu viel auf einmal. Erklär mir die Übertragungsfunktion einfacher, in kleinen Schritten, mit einem Beispiel aus dem Alltag.",
				check: (r) =>
					basis(r) &&
					nonEmpty(120)(r) &&
					maxLen(1500)(r) &&
					GEGLIEDERT(r) &&
					ALLTAG(r) &&
					matchText(/übertragungsfunktion|H\s*\(\s*ω|verstärk/i)(r),
			},
		],
	},

	// 3 ─ Der MOSFET, Betriebsbereiche (mcp, 3 Runden)
	{
		id: "v4-erklaeren-mosfet-bereiche",
		mode: "mcp",
		turns: [
			{
				text: "Erklär mir den MOSFET aus „12 · Der MOSFET“. Was muss ich dafür schon wissen?",
				check: (r) =>
					basis(r) &&
					hasTool("read_pages")(r) &&
					maxLen(1800)(r) &&
					matchText(/gate|gatespannung|spannungsgesteuert/i)(r) &&
					matchText(/sperr/i)(r) &&
					matchText(/triode/i)(r) &&
					matchText(/sättigung/i)(r) &&
					matchText(/halbleiter|bjt|diode|spannung|strom/i)(r),
			},
			{
				text: "Zu viel Text. Mach mir daraus drei Stichpunkte, einen für jeden Bereich.",
				check: (r) =>
					basis(r) &&
					maxLen(1200)(r) &&
					GEGLIEDERT(r) &&
					matchText(/sperr/i)(r) &&
					matchText(/triode/i)(r) &&
					matchText(/sättigung/i)(r),
			},
			{
				text: "Muss an das Gate beim MOSFET ein Strom fließen, damit der Kanal gesteuert wird? Ja oder nein?",
				check: (r) =>
					basis(r) &&
					matchText(/\bnein\b/i)(r) &&
					matchText(/kein(en)?\s+(gate-?)?strom|I_?G\s*=\s*0|kein\s+strom/i)(r),
			},
		],
	},

	// 4 ─ MOSFET-Arbeitspunkt (app, 2 Runden)
	{
		id: "v4-erklaeren-mosfet-arbeitspunkt",
		mode: "app",
		workspacePage: "13 · MOSFET-Arbeitspunkt & Modelle",
		turns: [
			{
				text: "Was ist der Arbeitspunkt beim MOSFET laut „13 · MOSFET-Arbeitspunkt & Modelle“ und wie geht man vor? Kurz bitte.",
				check: (r) =>
					basis(r) &&
					hasTool("read_pages")(r) &&
					maxLen(1800)(r) &&
					matchText(/arbeitspunkt/i)(r) &&
					matchText(/quadrat|sättigung|V_?GS|Gleichung/i)(r),
			},
			{
				text: "Das ist mir zu knapp. Erklär mir die Schritte einfacher, nummeriert, und mit einem Zahlen-Beispiel.",
				check: (r) =>
					basis(r) &&
					maxLen(1500)(r) &&
					GEGLIEDERT(r) &&
					matchText(/\d/)(r) &&
					matchText(/beispiel/i)(r),
			},
		],
	},

	// 5 ─ Operationsverstärker mit Gegenkopplung (mcp, 2 Runden)
	{
		id: "v4-erklaeren-opv-gegenkopplung",
		mode: "mcp",
		turns: [
			{
				text: "Erklär mir in ein paar Sätzen, was ein Operationsverstärker mit Gegenkopplung macht, aus „15 · Operationsverstärker“. Was sollte ich vorher wissen?",
				check: (r) =>
					basis(r) &&
					hasTool("read_pages")(r) &&
					maxLen(1800)(r) &&
					matchText(/gegenkopplung/i)(r) &&
					matchText(/verstärk/i)(r) &&
					matchText(/widerst[aä]nd/i)(r) &&
					matchText(/ohm|spannung|strom/i)(r),
			},
			{
				text: "Zu kompliziert. Bitte nur die zwei goldenen Regeln, in einfachen Worten und als Liste.",
				check: (r) =>
					basis(r) &&
					maxLen(1200)(r) &&
					GEGLIEDERT(r) &&
					matchText(/spannung/i)(r) &&
					matchText(/strom/i)(r),
			},
		],
	},

	// 6 ─ Chemische Bindung I (mcp, 3 Runden)
	{
		id: "v4-erklaeren-bindung-typen",
		mode: "mcp",
		turns: [
			{
				text: "Erkläre mir „4 · Chemische Bindung I“ kurz: welche Bindungstypen gibt es, und was muss ich vorher können?",
				check: (r) =>
					basis(r) &&
					hasTool("read_pages")(r) &&
					maxLen(1800)(r) &&
					matchText(/ionisch/i)(r) &&
					matchText(/metallisch/i)(r) &&
					matchText(/kovalent/i)(r) &&
					matchText(/elektronegativ|oktett|valenz|periodensystem|PSE/i)(r),
			},
			{
				text: "Das ist mir zu trocken. Erklär es mit einem Bild aus dem Alltag, Schritt für Schritt.",
				check: (r) => basis(r) && nonEmpty(120)(r) && maxLen(1500)(r) && GEGLIEDERT(r) && ALLTAG(r),
			},
			{
				text: "Welcher Bindungstyp hat ein delokalisiertes Elektronengas?",
				check: (r) => basis(r) && matchText(/metall/i)(r),
			},
		],
	},

	// 7 ─ Bindungsverhältnisse im Festkörper (app, 2 Runden)
	{
		id: "v4-erklaeren-bindungsverhaeltnisse",
		mode: "app",
		workspacePage: "Bindungsverhältnisse",
		turns: [
			{
				text: "Was passiert im Kristall laut „Bindungsverhältnisse“? Erklär mir das kurz, ich hab die Vorlesung verpasst.",
				check: (r) =>
					basis(r) &&
					hasTool("read_pages")(r) &&
					maxLen(1800)(r) &&
					matchText(/anziehung/i)(r) &&
					matchText(/abstoßung|pauli/i)(r) &&
					matchText(/minimal|minimum|gleichgewicht/i)(r),
			},
			{
				text: "Zu schwer. Erklär mir die Lennard-Jones-Kurve in drei kleinen Schritten, mit einem Vergleich aus dem Alltag.",
				check: (r) =>
					basis(r) &&
					nonEmpty(120)(r) &&
					maxLen(1500)(r) &&
					GEGLIEDERT(r) &&
					ALLTAG(r) &&
					matchText(/lennard|abstand|potential|energie/i)(r),
			},
		],
	},

	// 8 ─ Trends im Periodensystem (mcp, 2 Runden)
	{
		id: "v4-erklaeren-pse-trends",
		mode: "mcp",
		turns: [
			{
				text: "Erklär mir „3 · Trends im PSE“ kurz: warum wird ein Element nach rechts oben hin elektronegativer?",
				check: (r) =>
					basis(r) &&
					hasTool("read_pages")(r) &&
					maxLen(1800)(r) &&
					matchText(/kernladung|effektiv|kern/i)(r) &&
					matchText(/elektronegativ/i)(r) &&
					matchText(/fluor/i)(r),
			},
			{
				text: "Mach daraus eine Tabelle: Atomradius, Ionisierungsenergie und Elektronegativität, jeweils innerhalb einer Periode und innerhalb einer Gruppe.",
				check: (r) =>
					basis(r) &&
					maxLen(1800)(r) &&
					matchText(/\|[^\n]*\|/)(r) &&
					matchText(/radius/i)(r) &&
					matchText(/ionisierung/i)(r) &&
					matchText(/elektronegativität/i)(r),
			},
		],
	},

	// 9 ─ CMOS-Inverter (app, 3 Runden)
	{
		id: "v4-erklaeren-cmos-inverter",
		mode: "app",
		workspacePage: "20 · CMOS-Grundlagen – der Inverter",
		turns: [
			{
				text: "Was ist ein CMOS-Inverter laut „20 · CMOS-Grundlagen – der Inverter“? Kurz erklären, was ich vorher können muss.",
				check: (r) =>
					basis(r) &&
					hasTool("read_pages")(r) &&
					maxLen(1800)(r) &&
					matchText(/inverter/i)(r) &&
					matchText(/pmos|p-?kanal/i)(r) &&
					matchText(/nmos|n-?kanal/i)(r) &&
					matchText(/leistung|verlust/i)(r) &&
					matchText(/MOSFET|Transistor|Schalter/i)(r),
			},
			{
				text: "Ich verstehe nicht, warum im Ruhezustand kein Strom fließt. Erklär mir das in kleinen Schritten mit einem Beispiel.",
				check: (r) =>
					basis(r) &&
					nonEmpty(120)(r) &&
					maxLen(1500)(r) &&
					GEGLIEDERT(r) &&
					ALLTAG(r) &&
					matchText(/sperr|aus/i)(r),
			},
			{
				text: "Muss der PMOS beim symmetrischen Inverter breiter oder schmaler sein als der NMOS? Sag mir die Richtung und das ungefähre Verhältnis.",
				check: (r) => basis(r) && matchText(/breiter/i)(r) && matchText(/3|drei/i)(r),
			},
		],
	},

	// 10 ─ Diskrete Fourier-Transformation und FFT (mcp, 2 Runden)
	{
		id: "v4-erklaeren-fourier-dft",
		mode: "mcp",
		turns: [
			{
				text: "Was ist eigentlich die DFT aus „9 · Fourier-Methoden“ und warum braucht man dafür die FFT?",
				check: (r) =>
					basis(r) &&
					hasTool("read_pages")(r) &&
					maxLen(1800)(r) &&
					matchText(/DFT|diskret/i)(r) &&
					matchText(/FFT/i)(r) &&
					matchText(/nyquist|abtast|messpunkt|frequenzauflösung/i)(r) &&
					matchText(/schnell|log|O\(/i)(r),
			},
			{
				text: "Das ist mir zu technisch. Erklär es einfacher: Stell dir ein Audiosignal vor, was macht die Transformation damit?",
				check: (r) =>
					basis(r) &&
					nonEmpty(120)(r) &&
					maxLen(1500)(r) &&
					ALLTAG(r) &&
					matchText(/audio|ton|musik|stimme|schwingung|frequenz/i)(r),
			},
		],
	},
];
