// Kategorie „verzeichnis“: Vorlesungs-Verzeichnisse (📖 Vorlesungen) als Datenbank-Seiten.
// Spalten je Fach verschieden: DGL/Festkörper mit Schwierigkeit + Klausurrelevanz, Elektronik mit Klausur
// (Analog/Digital), Chemie ohne gesetzte Werte. Keine Kontinuumsmechanik-Aufgabe mit V04/„4 · Lager“ (Benchmark).

import { hasChange, hasTool, matchText, noChanges, noToolErrors, nonEmpty, notText, writtenTo } from "../task_helpers.mjs";

// Schreibt-Text zur Seite „Chemische Bindung II“ bzw. „Magnetismus“ prüfen.
const wroteBindung2 = (re) => (rec) => re.test(writtenTo(/bindung\s*ii/i)(rec));
const wroteMagnetismus = (re) => (rec) => re.test(writtenTo(/magnetismus/i)(rec));
// Eigenschaften (Status, Schwierigkeit, Klausurrelevanz) gesetzt – als props-Änderung oder im Eintrag.
const propsHave = (titleRe, re) => (rec) =>
	rec.changes.some((c) => {
		const blob = JSON.stringify(c.props ?? c);
		return re.test(blob) && titleRe.test(String(c?.title || "")) && (c.op === "page.props" || c.op === "page.patch" || c.props);
	});

export default [
	// 1 · DGL: alle als klausurrelevant markiert, keine „hoch“ bei Schwierigkeit
	{
		id: "v4-verzeichnis-dgl-klausur",
		mode: "mcp",
		turns: [
			{
				text: "Welche Vorlesungen in Differentialgleichungen sind eigentlich klausurrelevant markiert? Ich will nur wissen, wo ich anfangen soll.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					noChanges(r) &&
					matchText(/hoch/i)(r) &&
					matchText(/14|alle|sämtlich/i)(r),
			},
			{
				text: "Und welche davon hat laut Verzeichnis eine hohe Schwierigkeit? Sag mir auch, welche Stufen überhaupt vorkommen.",
				check: (r) =>
					noToolErrors(r) &&
					noChanges(r) &&
					matchText(/leicht/i)(r) &&
					matchText(/mittel/i)(r) &&
					matchText(/kein|nicht|keine|gibt es nicht|keine.*hoch/i)(r),
			},
		],
	},

	// 2 · Festkörper: die einzige „schwer“-Vorlesung und ihre Folienzahl
	{
		id: "v4-verzeichnis-fkp-schwer",
		mode: "mcp",
		turns: [
			{
				text: "Welche Festkörperphysik-Vorlesung ist im Verzeichnis als schwer eingestuft, und wie wichtig ist sie für die Klausur?",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					noChanges(r) &&
					matchText(/strukturaufkl|bragg/i)(r) &&
					matchText(/sehr hoch/i)(r),
			},
			{
				text: "Wie viele Folien hat diese Vorlesung laut Verzeichnis?",
				check: (r) => noToolErrors(r) && noChanges(r) && matchText(/\b28\b/)(r),
			},
		],
	},

	// 3 · Elektronik: Analog- und Digital-Teil aus der Spalte Klausur
	{
		id: "v4-verzeichnis-elektronik-klausur",
		mode: "mcp",
		turns: [
			{
				text: "Für die Elektronik-Klausur: Welche Vorlesungen gehören zum Analog-Teil und welche zum Digital-Teil?",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					noChanges(r) &&
					matchText(/\b1\s*(–|-|bis)\s*16\b/)(r) &&
					matchText(/\b17\s*(–|-|bis)\s*22\b/)(r),
			},
			{
				text: "Und auf welchen Skript-Seiten steht die 9 · BJT-Verstärker 1?",
				check: (r) =>
					noToolErrors(r) &&
					(hasTool("read_pages")(r) || hasTool("search")(r)) &&
					noChanges(r) &&
					matchText(/128\s*(–|-|bis)\s*144/)(r),
			},
		],
	},

	// 4 · Chemie: offene Vorlesung und ihr Datum
	{
		id: "v4-verzeichnis-chemie-offen",
		mode: "mcp",
		turns: [
			{
				text: "Welche Chemie-Vorlesungen sind im Verzeichnis noch offen und nicht zusammengefasst?",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					noChanges(r) &&
					matchText(/bindung\s*ii/i)(r),
			},
			{
				text: "Seit wann ist die denn datiert? Gib mir das Datum so, wie es im Verzeichnis steht.",
				check: (r) =>
					noToolErrors(r) &&
					noChanges(r) &&
					matchText(/19\.\s*11\.\s*(20)?26|2026-11-19|19\.\s*november/i)(r),
			},
		],
	},

	// 5 · Lückeneintrag füllen: Chemische Bindung II (Status Offen, Inhalt leer)
	{
		id: "v4-verzeichnis-fill-bindung2",
		mode: "mcp",
		turns: [
			{
				text: "Ich habe „5 · Chemische Bindung II“ noch nicht gemacht, aber ich hab mir den Stoff angeschaut. Schreib mir bitte den Eintrag fertig, ich fasse es kurz zusammen: Im zweiten Teil geht es um die Molekülgeometrie nach dem VSEPR-Modell. Freie Elektronenpaare stoßen stärker ab als bindende, daher ist der H2O-Winkel kleiner als der Tetraederwinkel von 109,5°. Die Hybridisierung (sp, sp², sp³) erklärt die Geometrie über gemischte Orbitale. Zuletzt geht es um Molekülorbitale: Bindungsordnung = (bindende − antibindende Elektronen) / 2. Klausurrelevanz hoch, Schwierigkeit mittel.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					!hasChange("page.create")(r) &&
					!hasChange("page.trash")(r) &&
					wroteBindung2(/\[!blue\]/)(r) &&
					wroteBindung2(/Zusammenfassung/)(r) &&
					wroteBindung2(/VSEPR|Hybridisierung|Molek/i)(r) &&
					propsHave(/bindung\s*ii/i, /hoch/i)(r) &&
					propsHave(/bindung\s*ii/i, /mittel/i)(r),
			},
			{
				text: "Prüf selbst, ob der Eintrag wie die anderen Chemie-Vorlesungen aufgebaut ist und ob alle Spalten gefüllt sind. Wenn nicht, korrigier es.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					!hasChange("page.create")(r) &&
					!hasChange("page.trash")(r) &&
					matchText(/korrig|passt|vollst|aufgebaut|geprüft|ergänz|bereits|alles/i)(r),
			},
		],
	},

	// 6 · Lückeneintrag füllen: Magnetismus (Status Offen, Folien fehlen)
	{
		id: "v4-verzeichnis-fill-magnetismus",
		mode: "mcp",
		turns: [
			{
				text: "Der Eintrag „Magnetismus“ in der Festkörperphysik ist noch leer. Ich hab den Stoff jetzt durch, kannst du ihn ausfüllen? Kurz gesagt: Diamagnetismus ist schwach und negativ, bei allen Stoffen vorhanden, weil die Elektronenpaare im Feld abstoßen. Paramagnetismus kommt von ungepaarten Elektronen, die sich in Feldrichtung ausrichten und schwach anziehen. Ferromagnetismus ist stark, weil die Spins in Weißschen Bezirken parallel stehen; oberhalb der Curie-Temperatur verschwindet er. Schwierigkeit mittel, Klausurrelevanz hoch.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					!hasChange("page.create")(r) &&
					!hasChange("page.trash")(r) &&
					wroteMagnetismus(/dia/i)(r) &&
					wroteMagnetismus(/para/i)(r) &&
					wroteMagnetismus(/ferro/i)(r) &&
					wroteMagnetismus(/curie|weiß/i)(r) &&
					propsHave(/magnetismus/i, /zusammengefasst/i)(r) &&
					propsHave(/magnetismus/i, /hoch/i)(r),
			},
			{
				text: "Schau nochmal drüber: ist der Eintrag wie die anderen Festkörper-Vorlesungen aufgebaut und sind alle Spalten gefüllt? Falls nicht, korrigiere es.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					!hasChange("page.create")(r) &&
					!hasChange("page.trash")(r) &&
					matchText(/korrig|passt|vollst|aufgebaut|geprüft|ergänz|bereits|alles/i)(r),
			},
		],
	},

	// 7 · DGL: Status-Frage (eine Runde, Gegenprobe)
	{
		id: "v4-verzeichnis-dgl-status",
		mode: "mcp",
		turns: [
			{
				text: "Gibt es in Differentialgleichungen Vorlesungen, die noch nicht zusammengefasst sind?",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					noChanges(r) &&
					matchText(/keine|nein|alle|nicht/i)(r) &&
					nonEmpty(30)(r),
			},
		],
	},

	// 8 · Festkörper: offene Vorlesungen, dann Klausurrelevanz einer offenen
	{
		id: "v4-verzeichnis-fkp-offen",
		mode: "mcp",
		turns: [
			{
				text: "Welche Festkörperphysik-Vorlesungen sind noch offen?",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					noChanges(r) &&
					matchText(/elastizit/i)(r) &&
					matchText(/elektronen/i)(r) &&
					matchText(/magnet/i)(r),
			},
			{
				text: "Und was steht bei der Klausurrelevanz von dem Magnetismus-Eintrag?",
				check: (r) =>
					noToolErrors(r) &&
					noChanges(r) &&
					matchText(/nicht|leer|fehlt|keine|noch/i)(r) &&
					notText(/sehr hoch/i)(r),
			},
		],
	},
];
