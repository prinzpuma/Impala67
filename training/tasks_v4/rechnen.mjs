import { hasTool, matchText, noChanges, noToolErrors } from "../task_helpers.mjs";

// Kategorie "rechnen": Werte aus echten Seiten (oder vom Nutzer vorgegeben) mit dem calculate-Werkzeug
// nachrechnen bzw. mit geänderten Parametern neu rechnen. Alle Sollwerte sind vorab in Python nachgerechnet.

const all =
	(...fns) =>
	(r) =>
		fns.every((f) => f(r));

export default [
	// 1 · Thévenin am Spannungsteiler (echte Seite: 2 · Wiederholung ET 2)
	{
		id: "v4-rechnen-et-thevenin",
		mode: "mcp",
		turns: [
			{
				text: "Auf der Seite „2 · Wiederholung ET 2 – Quellen, Thévenin & Norton“ steht die Formel für die Ersatzspannung. Ich habe eine Quelle mit 12 V, oben 4,7 kΩ und unten 2,2 kΩ gegen Masse. Wie groß sind Ersatzspannung und Innenwiderstand an den Klemmen unten?",
				check: (r) =>
					all(
						noToolErrors,
						hasTool("read_pages"),
						hasTool("calculate"),
						matchText(/3[,.]8[23]\s*V/),
						matchText(/1[,.](49|50)\s*k/),
						noChanges,
					)(r),
			},
			{
				text: "Was passiert mit der Ersatzspannung, wenn ich den unteren Widerstand auf 3,3 kΩ erhöhe? Wie viel Prozent ist das gegenüber vorher?",
				check: (r) =>
					all(
						noToolErrors,
						hasTool("calculate"),
						matchText(/4[,.](9[45]|95)\s*V/),
						matchText(/29[,.][34]\s*%|29\s*%/),
						noChanges,
					)(r),
			},
			{
				text: "Okay, zurück auf 2,2 kΩ. Wenn ich zwischen den Klemmen einen 1 kΩ-Widerstand anschließe, wie groß ist dann der Strom durch ihn?",
				check: (r) =>
					all(
						noToolErrors,
						hasTool("calculate"),
						matchText(/1[,.]5[23]\s*mA/),
						noChanges,
					)(r),
			},
		],
	},

	// 2 · Diode mit Lastgerade (echte Seite über Diodenschaltungen und Lastgerade)
	{
		id: "v4-rechnen-diode-lastgerade",
		mode: "mcp",
		turns: [
			{
				text: "Ich habe eine Diode in Reihe mit 470 Ω an 5 V. Die Diode ist mit 0,7 V Flussspannung angenähert. Schau in meine Notizen zur Lastgerade und sag mir den Strom im Arbeitspunkt.",
				check: (r) =>
					all(
						noToolErrors,
						hasTool("calculate"),
						matchText(/9[,.]1[45]\s*mA/),
						noChanges,
					)(r),
			},
			{
				text: "Und wenn ich den Widerstand auf 1 kΩ vergrößere: welcher Strom ergibt sich, und um wie viel Prozent sinkt er?",
				check: (r) =>
					all(
						noToolErrors,
						hasTool("calculate"),
						matchText(/4[,.]30?\s*mA/),
						matchText(/53[,.]?0?\s*%/),
						noChanges,
					)(r),
			},
			{
				text: "Bei den 4,3 mA: wie groß ist der Kleinsignal-Widerstand der Diode, wenn man 26 mV Temperaturspannung annimmt?",
				check: (r) =>
					all(
						noToolErrors,
						hasTool("calculate"),
						matchText(/6[,.]0\d?\s*(Ω|ohm)/i),
						noChanges,
					)(r),
			},
		],
	},

	// 3 · MOSFET-Arbeitspunkt (echte Seite: 13 · MOSFET-Arbeitspunkt & Modelle)
	{
		id: "v4-rechnen-mosfet-arbeitspunkt",
		mode: "mcp",
		turns: [
			{
				text: "Auf meiner MOSFET-Seite steht die Sättigungsformel für den Drainstrom. Mit K = 1 mA/V², Schwellspannung 1,5 V und U_GS = 3,5 V: wie groß ist I_D?",
				check: (r) =>
					all(
						noToolErrors,
						hasTool("read_pages"),
						hasTool("calculate"),
						matchText(/(?<![\d,.])2(?:[,.]0+)?\s*mA/),
						noChanges,
					)(r),
			},
			{
				text: "Was ändert sich, wenn ich U_GS auf 4 V erhöhe? Gib mir den neuen Strom und die prozentuale Änderung.",
				check: (r) =>
					all(
						noToolErrors,
						hasTool("calculate"),
						matchText(/3[,.]1[23]\d?\s*mA/),
						matchText(/56[,.][23]\s*%|56\s*%/),
						noChanges,
					)(r),
			},
			{
				text: "Jetzt mit U_GS = 4 V, Drainwiderstand 2,2 kΩ und U_DD = 12 V: welche Drainspannung kommt raus, und ist der Transistor noch in Sättigung?",
				check: (r) =>
					all(
						noToolErrors,
						hasTool("calculate"),
						matchText(/5[,.]1[23]\d?\s*V/),
						matchText(/sättigung|saettigung/i),
						noChanges,
					)(r),
			},
		],
	},

	// 4 · OPV-Verstärkung (echte Seite: 15 · Operationsverstärker)
	{
		id: "v4-rechnen-opv-verstaerkung",
		mode: "mcp",
		turns: [
			{
				text: "Invertierender Verstärker mit R1 = 1 kΩ und R2 = 10 kΩ. Die Eingangsspannung ist 0,25 V. Was kommt am Ausgang raus? Die Formel steht auf der OPV-Seite.",
				check: (r) =>
					all(
						noToolErrors,
						hasTool("read_pages"),
						hasTool("calculate"),
						matchText(/[-−]\s*2[,.]5\s*V/),
						noChanges,
					)(r),
			},
			{
				text: "Und wenn ich denselben Verstärker nicht invertierend aufbaue, also mit den gleichen Widerständen und 0,25 V am Eingang: was kommt dann heraus?",
				check: (r) =>
					all(
						noToolErrors,
						hasTool("calculate"),
						matchText(/2[,.]75\s*V/),
						noChanges,
					)(r),
			},
			{
				text: "Gut. Der OPV hat offen eine Verstärkung von 10⁵ bei 10 Hz. Wie groß ist die Grenzfrequenz, wenn ich mit der nicht invertierenden Verstärkung 11 gegenkoppele? Die Rechnung mit der Verstärkungs-Bandbreite-Konstante passt dazu.",
				check: (r) =>
					all(
						noToolErrors,
						hasTool("calculate"),
						matchText(/9[01][,.]?\d*\s*kHz/),
						noChanges,
					)(r),
			},
		],
	},

	// 5 · Bragg-Winkel und Einheiten (echte Seite: Strukturaufklärung – Bragg, reziprokes Gitter & Beugungsmethoden)
	{
		id: "v4-rechnen-bragg-winkel",
		mode: "mcp",
		turns: [
			{
				text: "Ich habe Cu-Kα-Strahlung mit λ = 1,5406 Å und eine Ebenenschar mit d = 2,45 Å. Unter welchen Winkeln θ wird gebeugt, und wie groß ist 2θ? Denk an die Beugungsordnung n.",
				check: (r) =>
					all(
						noToolErrors,
						hasTool("calculate"),
						matchText(/18[,.]3\s*°/),
						matchText(/36[,.]7\s*°/),
						matchText(/39[,.]0\s*°/),
						noChanges,
					)(r),
			},
			{
				text: "Jetzt Beugungswinkel 2θ = 80° bei n = 1 an derselben Ebenenschar: welche Wellenlänge braucht man?",
				check: (r) =>
					all(
						noToolErrors,
						hasTool("calculate"),
						matchText(/3[,.]1[45]\s*Å/),
						noChanges,
					)(r),
			},
			{
				text: "Und für diese Wellenlänge: welche Wellenzahl k = 2π/λ in 1/m und welche Photonenenergie in keV? Bitte mit Einheit angeben.",
				check: (r) =>
					all(
						noToolErrors,
						hasTool("calculate"),
						matchText(/(1[,.]9[89]|2(?:[,.]0+)?)\s*[·×x*]?\s*10/i),
						matchText(/3[,.]9[34]\s*keV/),
						noChanges,
					)(r),
			},
		],
	},

	// 6 · Packungsdichte und Gitterradius (echte Seite: 3 · Zinkblende, hcp/fcc-Packungsdichte & Diamantgitter)
	{
		id: "v4-rechnen-packungsdichte",
		mode: "mcp",
		turns: [
			{
				text: "Auf meiner Übungsseite zur Packungsdichte steht die Aufgabe zum kubisch raumzentrierten Gitter. Wie groß ist dort die Packungsdichte von Kugeln?",
				check: (r) =>
					all(
						noToolErrors,
						hasTool("read_pages"),
						hasTool("calculate"),
						matchText(/68[,.]?0?\s*%/),
						noChanges,
					)(r),
			},
			{
				text: "Jetzt das Diamantgitter mit a = 5,43 Å und 8 Kugeln pro Elementarzelle, die sich gerade berühren. Welcher Kugelradius ergibt sich, und wie groß ist die Packungsdichte?",
				check: (r) =>
					all(
						noToolErrors,
						hasTool("calculate"),
						matchText(/1[,.]1[78]\s*Å/),
						matchText(/34[,.]?0?\s*%/),
						noChanges,
					)(r),
			},
			{
				text: "Zum Schluss: Silizium hat rund 5·10²² Atome pro cm³ und etwa 28 Nukleonen pro Atom, eine Nukleonenmasse von 1,6605·10⁻²⁴ g vorausgesetzt. Welche Dichte in g/cm³ folgt daraus?",
				check: (r) =>
					all(
						noToolErrors,
						hasTool("calculate"),
						matchText(/2[,.]3[23]\s*g/),
						noChanges,
					)(r),
			},
		],
	},

	// 7 · Euler-Schritt einer DGL (Verfahren aus: 12 · Runge-Kutta-Verfahren)
	{
		id: "v4-rechnen-euler-dgl",
		mode: "mcp",
		turns: [
			{
				text: "Ich habe y' = −2y + t mit y(0) = 1 und Schrittweite h = 0,1. Was ergibt ein einzelner Euler-Schritt für y(0,1)? Die Vorschrift steht in meinem Runge-Kutta-Skript.",
				check: (r) =>
					all(
						noToolErrors,
						hasTool("read_pages"),
						hasTool("calculate"),
						matchText(/0[,.]80?\b/),
						noChanges,
					)(r),
			},
			{
				text: "Mach denselben Schritt mit dem Heun-Verfahren. Welcher Wert kommt raus?",
				check: (r) =>
					all(
						noToolErrors,
						hasTool("calculate"),
						matchText(/0[,.]825\b/),
						noChanges,
					)(r),
			},
			{
				text: "Und wenn ich mit dem einfachen Euler-Verfahren statt h = 0,1 zwei Schritte mit h = 0,05 mache: welcher Wert für y(0,1) kommt dann heraus?",
				check: (r) =>
					all(
						noToolErrors,
						hasTool("calculate"),
						matchText(/0[,.]8125\b|0[,.]81\b/),
						noChanges,
					)(r),
			},
		],
	},

	// 8 · Lagerreaktionen am Balken (echte Seite: 4 · Lager, Lagerreaktionen & Statische Bestimmtheit)
	{
		id: "v4-rechnen-balken-lager",
		mode: "mcp",
		turns: [
			{
				text: "Balken mit 4 m Länge, links ein Festlager, rechts ein Loslager. Bei 1 m von links greift eine Einzellast von 10 kN an. Welche Lagerreaktionen ergeben sich? Schau bitte in meine Notizen zu Lagern.",
				check: (r) =>
					all(
						noToolErrors,
						hasTool("read_pages"),
						hasTool("calculate"),
						matchText(/7[,.]5\s*kN/),
						matchText(/2[,.]5\s*kN/),
						noChanges,
					)(r),
			},
			{
				text: "Jetzt statt der Einzellast eine gleichmäßig verteilte Last von 2 kN/m über die ganze Länge. Wie groß sind die Auflagerkräfte dann?",
				check: (r) =>
					all(
						noToolErrors,
						hasTool("calculate"),
						matchText(/4[,.]0?\s*kN/),
						noChanges,
					)(r),
			},
			{
				text: "Wenn ich jetzt noch ein zweites Festlager dazu setze statt des Loslagers, ist das System dann noch statisch bestimmt?",
				check: (r) =>
					all(
						noToolErrors,
						matchText(/unbestimmt/i),
						noChanges,
					)(r),
			},
		],
	},

	// 9 · pH und Stoffmenge (Werte vom Nutzer vorgegeben)
	{
		id: "v4-rechnen-ph-salzsaeure",
		mode: "mcp",
		turns: [
			{
				text: "Ich habe Salzsäure mit 0,01 mol/L. Was ist der pH-Wert? Die Säure ist vollständig dissoziiert.",
				check: (r) =>
					all(
						noToolErrors,
						matchText(/pH[^\n]{0,40}=\s*2(?:[,.]0+)?(?![\d,.])/i),
						noChanges,
					)(r),
			},
			{
				text: "Ich verdünne die Lösung um den Faktor 10. Wie ändert sich der pH-Wert, und um wie viele Einheiten?",
				check: (r) =>
					all(
						noToolErrors,
						matchText(/pH[^\n]{0,40}=\s*3(?:[,.]0+)?(?![\d,.])|\b3[,.]00?\b/),
						matchText(/(eine?|1)\s+(pH-?)?Einheit|um\s+(eine|1)\b|\+\s*1(,0)?\b/i),
						noChanges,
					)(r),
			},
			{
				text: "Wie viel HCl steckt in 250 mL der ursprünglichen 0,01-molaren Lösung? Gib Stoffmenge und Masse an, mit M(HCl) = 36,46 g/mol.",
				check: (r) =>
					all(
						noToolErrors,
						hasTool("calculate"),
						matchText(/0[,.]0025\s*mol/),
						matchText(/9[01][,.]\d\s*mg|0[,.]09[01]\d*\s*g/),
						noChanges,
					)(r),
			},
		],
	},

	// 10 · Laplace-Werte und Pole (echte Seite: 10 · Laplace-Transformation)
	{
		id: "v4-rechnen-laplace-werte",
		mode: "mcp",
		turns: [
			{
				text: "Auf meiner Laplace-Seite steht die Regel für eine mit e^(−at) multiplizierte Funktion. Was ist die Laplace-Transformierte von t·e^(−3t) an der Stelle s = 5?",
				check: (r) =>
					all(
						noToolErrors,
						hasTool("read_pages"),
						hasTool("calculate"),
						matchText(/0[,.]015625|0[,.]0156|1\s*\/\s*64/),
						noChanges,
					)(r),
			},
			{
				text: "Und wenn die Zeitfunktion 5·cos(2t) ist: welchen Wert hat die Transformierte bei s = 1?",
				check: (r) =>
					all(
						noToolErrors,
						hasTool("calculate"),
						matchText(/(=|ist|ergibt)\s*1([,.]0+)?\b/i),
						noChanges,
					)(r),
			},
			{
				text: "Wo liegen die Pole von F(s) = 1/(s² + 4s + 13), und ist das System stabil?",
				check: (r) =>
					all(
						noToolErrors,
						hasTool("calculate"),
						matchText(/[-−]\s*2\s*(±|\+\/-|\+\/−)\s*3\s*i/),
						matchText(/stabil/i),
						noChanges,
					)(r),
			},
		],
	},
];
