// v4-Kategorie "tutor": Lerncoach-Verhalten (Übungen erzeugen, Rechenweg prüfen, nur nächsten Schritt nennen).
// Regeln: BRIEF.md. Soll-Werte sind vorab nachgerechnet; Themen bewusst außerhalb des Benchmarks.
import { hasTool, noToolErrors, matchText, notText } from "../task_helpers.mjs";

// Zählt Aufgaben-Zeilen wie "Aufgabe 1 …" oder "2. …" am Zeilenanfang.
const countTasks = (r) =>
	(String(r.text || "").match(/^\s*(?:\*\*)?\s*(?:Aufgabe\s*\d+|\d+\s*[.)])/gim) || []).length;
const taskCount = (n) => (r) => countTasks(r) === n;
// Keine Lösungszeilen wie "Lösung:", "Ergebnis:", "Lösungsweg:".
const noSolutions = (r) =>
	!/^\s*[*#>\-\s]*(?:\*\*)?\s*(?:lösung|lösungsweg|lösungsvorschlag|ergebnis|antwort)\b[^\n]*:/im.test(String(r.text || ""));
// Schwierigkeit steigt: "leicht/einfach" kommt vor "schwer/anspruchsvoll".
const ordered = (r) => {
	const t = String(r.text || "");
	const a = t.search(/leicht|einfach|einstieg/i);
	const b = t.search(/schwer|anspruchsvoll|knifflig|fortgeschritten/i);
	return a >= 0 && b > a;
};
const falsch = /falsch|stimmt nicht|nicht richtig|nicht ganz|passt nicht/i;
const richtig = /richtig|stimmt|korrekt|passt/i;

export default [
	// 1. (a) Laplace: Übungen, Urteil richtig, Urteil falsch
	{
		id: "v4-tutor-laplace-uebungen",
		mode: "mcp",
		turns: [
			{
				text: "Gib mir 4 Übungsaufgaben von leicht bis schwer zur Laplace-Transformation, nur die Aufgaben, bitte ohne Lösungen.",
				check: (r) =>
					noToolErrors(r) &&
					taskCount(4)(r) &&
					noSolutions(r) &&
					ordered(r) &&
					matchText(/laplace|\\mathcal\{L\}|F\(s\)|L\{/i)(r),
			},
			{
				text: "Zu Aufgabe 1: Laplace-Transformation von f(t) = t·e^(−2t). Ich hab F(s) = 1/(s+2)² raus. Stimmt das?",
				check: (r) =>
					noToolErrors(r) &&
					matchText(richtig)(r) &&
					notText(/falsch|stimmt nicht|nicht richtig|leider nicht/i)(r) &&
					matchText(/verschieb|s\s*\+\s*2/i)(r),
			},
			{
				text: "Aufgabe 2 hab ich so gelöst: L{cos(3t)} = s/(s²+3). Richtig oder nicht?",
				check: (r) =>
					noToolErrors(r) &&
					matchText(falsch)(r) &&
					matchText(/s\s*(?:\^\s*2|²)\s*\+\s*9|s\^2\s*\+\s*9/i)(r),
			},
		],
	},
	// 2. (a) Fourier: Übungen, dann ein falsches Ergebnis
	{
		id: "v4-tutor-fourier-uebungen",
		mode: "mcp",
		turns: [
			{
				text: "Ich soll Fourier-Reihen üben. Gib mir 3 Aufgaben von leicht bis schwer, nur die Aufgaben, keine Lösungen.",
				check: (r) =>
					noToolErrors(r) &&
					taskCount(3)(r) &&
					noSolutions(r) &&
					ordered(r) &&
					matchText(/fourier|sin|cos|periode/i)(r),
			},
			{
				text: "Bei f(x) = x auf (−π, π) hab ich b₂ = 2 raus. Passt das?",
				check: (r) =>
					noToolErrors(r) &&
					matchText(falsch)(r) &&
					matchText(/[-−]\s*1(?![\d.,])/)(r),
			},
		],
	},
	// 3. (b) Euler-Verfahren: Fehler in Zeile 4 (Produkt statt Summe), Folgefrage
	{
		id: "v4-tutor-euler-rechenweg",
		mode: "mcp",
		turns: [
			{
				text:
					"Hier mein Euler-Rechenweg für y' = t + y, y(0) = 1, Schrittweite h = 0,5. " +
					"Zeile 1: y_(n+1) = y_n + h·f(t_n, y_n). " +
					"Zeile 2: f(0; 1) = 0 + 1 = 1, also y_1 = 1 + 0,5·1 = 1,5. " +
					"Zeile 3: t_1 = 0,5 und y_1 = 1,5. " +
					"Zeile 4: f(0,5; 1,5) = 0,5 · 1,5 = 0,75, also y_2 = 1,5 + 0,5 · 0,75 = 1,875. Stimmt das?",
				check: (r) =>
					noToolErrors(r) &&
					matchText(/zeile\s*4/i)(r) &&
					matchText(/=\s*2(?:[,.]0+)?\b|\b2(?:[,.]0+)?\s*(?:ist|wäre|ergibt)/i)(r) &&
					matchText(/2[,.]5\b/)(r) &&
					matchText(falsch)(r),
			},
			{
				text: "Und wenn ich in Zeile 4 alles richtig mache: was ist dann y bei t = 1?",
				check: (r) => noToolErrors(r) && matchText(/2[,.]5\b/)(r),
			},
		],
	},
	// 4. (b) Spannungsteiler: Rechenfehler in Zeile 4, Folgefrage mit R1 = 2 kΩ
	{
		id: "v4-tutor-kirchhoff-spannungsteiler",
		mode: "mcp",
		turns: [
			{
				text:
					"Ich rechne den Spannungsteiler: U = 12 V, R1 = 1 kΩ, R2 = 3 kΩ, gesucht ist U_a über R2. " +
					"Zeile 1: U_a = U · R2/(R1+R2). Zeile 2: R1+R2 = 4 kΩ. Zeile 3: R2/(R1+R2) = 3/4 = 0,75. " +
					"Zeile 4: U_a = 12 V · 0,75 = 10 V. Passt das so?",
				check: (r) =>
					noToolErrors(r) &&
					matchText(/zeile\s*4/i)(r) &&
					matchText(/\b9(?:[,.]0)?\s*V\b/)(r) &&
					matchText(falsch)(r),
			},
			{
				text: "Okay. Und wenn ich R1 auf 2 kΩ ändere, was kommt für U_a raus?",
				check: (r) => noToolErrors(r) && matchText(/7[,.]2\s*V|7[,.]2\b/)(r),
			},
		],
	},
	// 5. (c) Diode: nur nächster Schritt, dann Strom
	{
		id: "v4-tutor-diode-schritt",
		mode: "mcp",
		turns: [
			{
				text:
					"Ich hänge bei einer Diodenschaltung fest: eine Spannungsquelle mit 5 V, dazu ein Reihenwiderstand " +
					"von 1 kΩ und eine Siliziumdiode in Durchlassrichtung mit 0,7 V Flussspannung. " +
					"Sag mir bitte nur den nächsten Schritt, nicht das Ergebnis.",
				check: (r) =>
					noToolErrors(r) &&
					matchText(/masche|kirchhoff|schritt|zuerst|als nächstes|ansatz|setz/i)(r) &&
					notText(/4[,.]3\s*mA|0[,.]0043\s*A|4\.3\s*mA/i)(r),
			},
			{
				text: "Super, dann bitte das Ergebnis: wie groß ist der Diodenstrom?",
				check: (r) => noToolErrors(r) && matchText(/4[,.]3\s*mA/i)(r),
			},
		],
	},
	// 6. (c) MOSFET im App-Kontext: nur nächster Schritt, dann Strom
	{
		id: "v4-tutor-mosfet-schritt",
		mode: "app",
		workspacePage: "13 · MOSFET-Arbeitspunkt & Modelle",
		turns: [
			{
				text:
					"Ich komm bei der Arbeitspunkt-Aufgabe nicht weiter. NMOS mit U_th = 2 V, U_GS = 4 V, U_DS = 6 V " +
					"und β = 4 mA/V², Formel I_D = β/2 · (U_GS − U_th)². Sag mir nur, was der nächste Schritt ist, nicht den Strom.",
				check: (r) =>
					noToolErrors(r) &&
					matchText(/sättigung|abschnür|pinch|U_?DS|schritt|nächst|zuerst/i)(r) &&
					notText(/\b8(?:[,.]0)?\s*mA/i)(r),
			},
			{
				text: "Gut, dann bitte den Drainstrom I_D.",
				check: (r) => noToolErrors(r) && matchText(/8(?:[,.]0)?\s*mA/i)(r),
			},
		],
	},
	// 7. (b) Nichtinvertierender OPV: Formel in Zeile 2 falsch, Folgefrage mit Rf = 4,7 kΩ
	{
		id: "v4-tutor-opv-verstaerkung",
		mode: "app",
		workspacePage: "16 · OPV-Anwendungen",
		turns: [
			{
				text:
					"Hier mein Rechenweg für einen nichtinvertierenden Verstärker. Zeile 1: Schaltung nichtinvertierend. " +
					"Zeile 2: V = 1 + R1/Rf. Zeile 3: R1 = 1 kΩ, Rf = 9 kΩ. Zeile 4: V = 1 + 1/9 ≈ 1,11. Wo ist der Fehler?",
				check: (r) =>
					noToolErrors(r) &&
					matchText(/zeile\s*2/i)(r) &&
					matchText(/R_?f\s*\/\s*R_?1|Rf\/R1/i)(r) &&
					matchText(/\b10\b/)(r) &&
					matchText(falsch)(r),
			},
			{
				text: "Und wenn ich Rf auf 4,7 kΩ ändere, bei gleichem R1 = 1 kΩ: was ist V?",
				check: (r) => noToolErrors(r) && matchText(/5[,.]7\b/)(r),
			},
		],
	},
	// 8. (a) Bragg im App-Kontext: Übungen, dann falsches Ergebnis zu Aufgabe 2
	{
		id: "v4-tutor-bragg-uebungen",
		mode: "app",
		workspacePage: "4 · Bragg, Laue, Wellenvektor & Reziprokes Gitter",
		turns: [
			{
				text: "Gib mir 3 Übungsaufgaben zur Bragg-Bedingung, leicht bis schwer, nur die Aufgaben ohne Lösungen.",
				check: (r) =>
					noToolErrors(r) &&
					taskCount(3)(r) &&
					noSolutions(r) &&
					ordered(r) &&
					matchText(/bragg|sin\s*θ|sinθ|2\s*d|λ/i)(r),
			},
			{
				text: "Zu Aufgabe 2: λ = 0,154 nm, d = 0,308 nm, n = 1. Ich hab θ = 30° raus. Stimmt das?",
				check: (r) =>
					noToolErrors(r) &&
					matchText(falsch)(r) &&
					matchText(/14[,.]5\s*°|14[,.]48|14\s*°/i)(r),
			},
		],
	},
	// 9. (c) Packungsdichte fcc: nur Schritt, dann Endergebnis
	{
		id: "v4-tutor-packung-fcc",
		mode: "mcp",
		turns: [
			{
				text:
					"Ich hänge bei der Packungsdichte der kubisch flächenzentrierten Struktur (fcc) fest. " +
					"Sag mir nur den nächsten Schritt, nicht das Endergebnis.",
				check: (r) =>
					noToolErrors(r) &&
					matchText(/schritt|zuerst|als nächstes|anzahl|atome|kugel|elementarzelle|volumen/i)(r) &&
					notText(/74\s*%|0[,.]74/i)(r),
			},
			{
				text: "Alles klar, und wie hoch ist die Packungsdichte am Ende?",
				check: (r) => noToolErrors(r) && matchText(/74\s*%|0[,.]74/i)(r),
			},
		],
	},
	// 10. (b) Lagerreaktionen: Hebelarm falsch, Folgefrage Probe
	{
		id: "v4-tutor-kraefte-lager",
		mode: "app",
		workspacePage: "4 · Lager, Lagerreaktionen & Statische Bestimmtheit",
		turns: [
			{
				text:
					"Einfacher Balken, Länge 4 m, Lager A links, Lager B rechts, Einzelkraft F = 10 kN im Abstand 1 m von A. " +
					"Zeile 1: Momentengleichgewicht um B: A · 4 m − F · 1 m = 0. Zeile 2: A = 10 kN · 1 m / 4 m = 2,5 kN. " +
					"Zeile 3: B = 10 kN − 2,5 kN = 7,5 kN. Stimmt das?",
				check: (r) =>
					noToolErrors(r) &&
					matchText(/zeile\s*1|zeile\s*2/i)(r) &&
					matchText(/7[,.]5\s*kN/)(r) &&
					matchText(/hebel|abstand|3\s*m\b/i)(r) &&
					matchText(falsch)(r),
			},
			{
				text: "Und wie prüfe ich, dass meine Lagerkräfte stimmen?",
				check: (r) =>
					noToolErrors(r) &&
					matchText(/A\s*\+\s*B\s*=\s*(?:10|F)|7[,.]5\s*(?:kN)?\s*\+\s*2[,.]5|kräftegleichgewicht|summe der (?:vertikal|kräfte)/i)(r),
			},
		],
	},
	// 11. (c) pH Salzsäure: nur Schritt, dann pH
	{
		id: "v4-tutor-ph-schritt",
		mode: "mcp",
		turns: [
			{
				text: "Ich komm bei der pH-Berechnung für 0,01 mol/L Salzsäure nicht weiter. Sag mir nur den nächsten Schritt, nicht den pH.",
				check: (r) =>
					noToolErrors(r) &&
					matchText(/schritt|zuerst|als nächstes|stark|vollständig|dissoziier|H_?3?O|H\+/i)(r) &&
					notText(/pH\s*(?:=|ist|von)\s*2(?:[,.]0)?\b/i)(r),
			},
			{
				text: "Gut, dann bitte der pH-Wert.",
				check: (r) => noToolErrors(r) && matchText(/pH[^\n]{0,40}(=|ist|von|beträgt)\s*2(?:[,.]0+)?(?![\d,.])/i)(r),
			},
		],
	},
	// 12. (a) Elektronenkonfiguration: Übungen, Fe richtig, Cr falsch
	{
		id: "v4-tutor-elektron-uebungen",
		mode: "mcp",
		turns: [
			{
				text: "Gib mir 4 Übungsaufgaben zur Elektronenkonfiguration, leicht bis schwer, nur die Aufgaben ohne Lösungen.",
				check: (r) =>
					noToolErrors(r) &&
					taskCount(4)(r) &&
					noSolutions(r) &&
					ordered(r) &&
					matchText(/elektron|konfiguration|orbital|3d|4s|1s/i)(r),
			},
			{
				text: "Zu Aufgabe 1: Elektronenkonfiguration von Eisen (Z = 26). Ich hab 1s² 2s² 2p⁶ 3s² 3p⁶ 4s² 3d⁶ raus. Passt?",
				check: (r) =>
					noToolErrors(r) &&
					matchText(richtig)(r) &&
					notText(falsch)(r),
			},
			{
				text: "Aufgabe 2 zu Chrom (Z = 24): [Ar] 3d⁴ 4s². Stimmt das?",
				check: (r) =>
					noToolErrors(r) &&
					matchText(falsch)(r) &&
					matchText(/3d\s*(?:\^\s*)?(?:⁵|5)\b/)(r) &&
					matchText(/4s\s*(?:\^\s*)?(?:¹|1)\b/)(r),
			},
		],
	},
];
