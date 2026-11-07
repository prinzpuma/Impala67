// Erzeugt core/impala-model/tests/golden/card-transfer.json aus den echten JS-Funktionen in web/extras.js.
// Ausführen: node core/tools/gen-golden-card-transfer.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outDir = path.join(repoRoot, "core/impala-model/tests/golden");

const dom = new JSDOM("<!doctype html><body><div id=overlay></div></body>", { url: "http://localhost/" });
const DOMParser = dom.window.DOMParser;

const TXT_HEADER = "# Impala67-Karteikarten v1";
const textEscape = (s) => String(s ?? "").replace(/^(?=\\|@(?:stapel|frage|antwort)\b|---\s*$)/gim, "\\");

function exportTxt(cards) {
	const byDeck = new Map();
	for (const c of cards) {
		const deck = c.deck || "Standard";
		if (!byDeck.has(deck)) byDeck.set(deck, []);
		byDeck.get(deck).push(c);
	}
	const parts = [TXT_HEADER];
	for (const [deck, list] of byDeck) {
		parts.push("", "@stapel " + deck);
		for (const c of list) parts.push("@frage", textEscape(c.front), "@antwort", textEscape(c.back), "---");
	}
	return parts.join("\n");
}

const csvEscape = (s) => {
	s = String(s ?? "");
	return /[";\n\t]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

function exportCsv(cards) {
	return "front;back;deck\n" + cards.map((c) => [c.front, c.back, c.deck || "Standard"].map(csvEscape).join(";")).join("\n");
}

function parseCsv(text) {
	const separatorName = (text.match(/^#separator:(.+)$/mi) || [])[1]?.trim().toLowerCase();
	const separators = { tab: "\t", comma: ",", semicolon: ";", colon: ":", pipe: "|", space: " " };
	const contentLine = text.split(/\r?\n/).find((line) => line && !line.startsWith("#")) || "";
	const sep = separators[separatorName] || (separatorName?.length === 1 ? separatorName : contentLine.includes("\t") ? "\t" : contentLine.includes(";") ? ";" : ",");
	const rows = [];
	let row = [], cur = "", inQ = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (inQ) {
			if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
			else cur += ch;
		} else if (ch === '"') inQ = true;
		else if (ch === sep) { row.push(cur); cur = ""; }
		else if (ch === "\n" || ch === "\r") {
			if (ch === "\r" && text[i + 1] === "\n") i++;
			row.push(cur); cur = "";
			if (row.some((x) => x !== "")) rows.push(row);
			row = [];
		} else cur += ch;
	}
	row.push(cur);
	if (row.some((x) => x !== "")) rows.push(row);
	return rows;
}

function parseTableCards(text, defaultDeck = "Standard") {
	const rows = parseCsv(text);
	const directives = text.split(/\r?\n/).filter((line) => line.startsWith("#"));
	const deckDirective = directives.map((line) => line.match(/^#deck:(.+)$/i)).find(Boolean);
	const fallbackDeck = (deckDirective?.[1] || defaultDeck || "Standard").trim();
	const columnOf = (name) => {
		const hit = directives.map((line) => line.match(new RegExp("^#" + name + " column:(\\d+)$", "i"))).find(Boolean);
		return hit ? Number(hit[1]) - 1 : -1;
	};
	const special = ["guid", "notetype", "deck", "tags"].map(columnOf).filter((i) => i >= 0);
	const deckColumn = columnOf("deck");
	const cards = [], errors = [];
	for (const row of rows) {
		if (!row.length || String(row[0]).startsWith("#")) continue;
		const header = row.map((x) => String(x).trim().toLowerCase());
		if (header[0] === "front" && header[1] === "back") continue;
		const content = row.map((_, i) => i).filter((i) => !special.includes(i));
		const front = String(row[content[0]] || "").trim();
		const back = String(row[content[1]] || "").trim();
		const deck = String(deckColumn >= 0 ? row[deckColumn] : (deckDirective ? fallbackDeck : row[2]) || fallbackDeck).trim() || "Standard";
		if (front && back) cards.push({ front, back, deck });
		else if (front) errors.push("Eine Karte hat keine Antwort: " + front.slice(0, 60));
	}
	return { cards, errors, format: directives.length ? "Anki-Text" : "CSV/TSV" };
}

function parseImpalaTxt(text, defaultDeck = "Standard") {
	const cards = [], errors = [];
	let deck = defaultDeck || "Standard", mode = "", value = [], draft = null, lineNo = 0;
	const saveValue = () => {
		if (!draft || !mode) return;
		draft[mode] = value.join("\n").trim();
		value = [];
	};
	const saveCard = () => {
		saveValue();
		if (!draft) return;
		if (!draft.front || !draft.back || !draft.deck) errors.push("Zeile " + draft.line + ": Frage, Antwort oder gültiger Stapel fehlt.");
		else cards.push({ front: draft.front, back: draft.back, deck: draft.deck });
		draft = null; mode = ""; value = [];
	};
	for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
		lineNo++;
		const line = raw.trim();
		const deckMatch = line.match(/^@stapel\s+(.+)$/i);
		if (deckMatch) {
			saveCard();
			const parts = deckMatch[1].split("::").map((part) => part.trim());
			deck = parts.some((part) => !part) ? "" : parts.join("::");
			if (!deck) errors.push("Zeile " + lineNo + ": Ungültiger Stapelpfad.");
			continue;
		}
		if (/^@frage\s*$/i.test(line)) {
			saveCard();
			draft = { front: "", back: "", deck, line: lineNo }; mode = "front"; continue;
		}
		if (/^@antwort\s*$/i.test(line)) {
			saveValue();
			if (!draft) errors.push("Zeile " + lineNo + ": Antwort ohne Frage.");
			else mode = "back";
			continue;
		}
		if (/^---\s*$/.test(line)) { saveCard(); continue; }
		if (draft && mode) value.push(raw.replace(/^\\(?=\\|@(?:stapel|frage|antwort)\b|---\s*$)/i, ""));
	}
	saveCard();
	return { cards, errors, format: "Impala-TXT" };
}

function parseCardText(text, defaultDeck = "Standard") {
	text = text.replace(/^\uFEFF/, "");
	return /(^|\n)@(?:stapel|frage|antwort)\b/i.test(text) ? parseImpalaTxt(text, defaultDeck) : parseTableCards(text, defaultDeck);
}

const cardKey = (c, back, deck) => {
	if (typeof c === "object" && c !== null) {
		return [c.deck || "Standard", c.front, c.back].map((x) => String(x || "").trim()).join("\u001f");
	}
	return [deck || "Standard", c, back].map((x) => String(x || "").trim()).join("\u001f");
};

function duplicateCount(cards, existing = {}) {
	const seen = new Set(Object.values(existing).filter((c) => !c.trashed).map(cardKey));
	let count = 0;
	for (const card of cards) {
		const key = cardKey(card);
		if (seen.has(key)) count++;
		seen.add(key);
	}
	return count;
}

const stripHtml = (s) => {
	const html = String(s || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/div>\s*<div>/gi, "\n");
	return (new DOMParser().parseFromString(html, "text/html").body.textContent || "").trim();
};

const api = {
	exportTxt,
	exportCsv,
	parseCsv,
	parseTableCards,
	parseImpalaTxt,
	parseCardText,
	cardKey,
	duplicateCount,
	stripHtml,
};

// ── Test-Fälle ────────────────────────────────────────────────────────────────
const cardSets = [
	[],
	[
		{ front: "Einfache Frage", back: "Einfache Antwort", deck: "Standard" }
	],
	[
		{ front: "Frage 1", back: "Antwort 1", deck: "Bio" },
		{ front: "Frage 2", back: "Antwort 2", deck: "Bio" },
		{ front: "Frage 3", back: "Antwort 3", deck: "Mathe::Analysis" }
	],
	[
		{ front: "Karte ohne Stapel", back: "Antwort", deck: "" },
		{ front: "Karte mit Leerzeichen-Stapel", back: "Antwort", deck: "   " }
	],
	[
		{
			front: "@frage am Anfang\nund @stapel hier\n\\@antwort auch\n---\n--- \n\\escaped\n\\\\doppelt",
			back: "Zeile 1\nZeile 2 mit Sonderzeichen: ; \" \t \n---",
			deck: "Test::Escapes"
		},
		{
			front: "@stapel_not_marker @fragezeichen",
			back: "Normaler Text mit \\LaTeX Formel",
			deck: "Test::Special"
		}
	],
	[
		{
			front: "Frage mit \"Anführungszeichen\" und ; Semikolon\nund Umbruch\tund Tab",
			back: "Antwort; mit \"vielen\" ;;; Semikolons\nund Umbrüchen\n\nund Leerzeilen",
			deck: "CSV\"Deck;1"
		}
	]
];

const exportTxtCases = cardSets.map((cards) => ({
	input: cards,
	output: api.exportTxt(cards)
}));

const exportCsvCases = cardSets.map((cards) => ({
	input: cards,
	output: api.exportCsv(cards)
}));

const csvInputs = [
	"",
	"front;back;deck\nf1;b1;d1\nf2;b2;d2",
	"front,back,deck\nf1,b1,d1\n\"f,2\",\"b,2\",\"d,2\"",
	"front\tback\tdeck\nf1\tb1\td1",
	"#separator:tab\n#deck:Custom\nf1\tb1",
	"#separator:semicolon\n\"front with ; and \"\"quotes\"\"\";\"back line 1\nline 2\";MyDeck",
	"#separator:pipe\nf1|b1|d1\nf2|b2|d2",
	"#separator:comma\n\n\n# Kommentar\n\"a\",\"b\",\"c\"\n\n",
	"front;back\nOnlyFront;\n;OnlyBack\n;",
];

const parseCsvCases = csvInputs.map((text) => ({
	input: text,
	output: api.parseCsv(text)
}));

const tableCardInputs = [
	{
		text: "front;back;deck\nZelle;Mitochondrium;Bio\nAtom;Proton;Physik",
		defaultDeck: "Standard"
	},
	{
		text: "#separator:tab\n#deck:Chemie\nSauerstoff\tO\nWasserstoff\tH",
		defaultDeck: "Standard"
	},
	{
		text: "#separator:tab\n#deck:Medizin\n#guid column:1\n#notetype column:2\n#deck column:3\nguid1\tBasic\tAnatomie\tHerz\tMuskel\nguid2\tBasic\tAnatomie\tLunge\tOrgan",
		defaultDeck: "Standard"
	},
	{
		text: "Keine Antwort vorhanden;",
		defaultDeck: "Standard"
	},
	{
		text: "front,back\nFrage 1,Antwort 1\nFrage 2,",
		defaultDeck: "FallbackDeck"
	},
	{
		text: "# Kommentar\n#separator:comma\nf1,b1,deck1\n# noch ein Kommentar\nf2,b2",
		defaultDeck: "FallbackDeck"
	}
];

const parseTableCases = tableCardInputs.map(({ text, defaultDeck }) => ({
	input: { text, defaultDeck },
	output: api.parseTableCards(text, defaultDeck)
}));

const impalaTxtInputs = [
	{
		text: `# Impala67-Karteikarten v1

@stapel Bio
@frage
Was ist ATP?
@antwort
Adenosintriphosphat, der universelle Energieträger.
---
@frage
Zweite Frage
@antwort
Zweite Antwort
---`,
		defaultDeck: "Standard"
	},
	{
		text: `\uFEFF# Mit BOM und CRLF\r
\r
@stapel Mathe::Analysis\r
@frage\r
\@frage mit Formatmarker\r
\\\@antwort mit Backslash\r
\\---\r
@antwort\r
Antwort mit \\LaTeX\r
---`,
		defaultDeck: "Standard"
	},
	{
		text: `@stapel Ungueltig::::Pfad
@frage
Frage
@antwort
Antwort
---
@antwort
Antwort ohne Frage
---
@frage
Frage ohne Antwort
---`,
		defaultDeck: "Standard"
	},
	{
		text: `@stapel Neuer::Stapel
@frage

@antwort
Antwort ohne Frage-Text
---`,
		defaultDeck: "Standard"
	}
];

const parseImpalaTxtCases = impalaTxtInputs.map(({ text, defaultDeck }) => ({
	input: { text, defaultDeck },
	output: api.parseImpalaTxt(text, defaultDeck)
}));

const parseCardTextCases = [
	...impalaTxtInputs.map(({ text, defaultDeck }) => ({
		input: { text, defaultDeck },
		output: api.parseCardText(text, defaultDeck)
	})),
	...tableCardInputs.map(({ text, defaultDeck }) => ({
		input: { text, defaultDeck },
		output: api.parseCardText(text, defaultDeck)
	}))
];

const cardKeyInputs = [
	{ front: "Frage", back: "Antwort", deck: "Bio" },
	{ front: "  Frage mit Leerzeichen  ", back: "\nAntwort mit Umbruch\n", deck: "  Bio  " },
	{ front: "Frage", back: "Antwort", deck: "" },
	{ front: "", back: "", deck: "Standard" }
];

const cardKeyCases = cardKeyInputs.map((c) => ({
	input: c,
	output: api.cardKey(c)
}));

const duplicateCountCases = [
	{
		cards: [
			{ front: "F1", back: "B1", deck: "D1" },
			{ front: "F2", back: "B2", deck: "D2" }
		],
		existing: {}
	},
	{
		cards: [
			{ front: "F1", back: "B1", deck: "D1" },
			{ front: "F1", back: "B1", deck: "D1" },
			{ front: "F2", back: "B2", deck: "D2" }
		],
		existing: {}
	},
	{
		cards: [
			{ front: "F1", back: "B1", deck: "D1" },
			{ front: "F2", back: "B2", deck: "D2" }
		],
		existing: {
			c1: { front: "F1", back: "B1", deck: "D1", trashed: false },
			c2: { front: "F2", back: "B2", deck: "D2", trashed: true }
		}
	}
];

const duplicateCases = duplicateCountCases.map(({ cards, existing }) => ({
	input: { cards, existing },
	output: api.duplicateCount(cards, existing)
}));

const htmlInputs = [
	"",
	"Einfacher Text",
	"Text mit <br> und <br/> und <br /> Umbrüchen",
	"<div>Erste Zeile</div><div>Zweite Zeile</div>",
	"<div>Zeile 1</div> <div>Zeile 2</div>",
	"<b>Fett</b>, <i>kursiv</i>, <u>unterstrichen</u>, <span style=\"color:red\">rot</span>",
	"<img src=\"x\" onerror=\"alert(1)\">Bild-Tag",
	"&lt;b&gt;Entitäten&lt;/b&gt; &amp; &quot;Anführungszeichen&quot; &apos;Apos&#39; &nbsp; Nicht-Trennend",
	"   \n  Leerzeichen drumherum  \t\n  ",
	"<div><span>Verschachtelt <b>und</b> <i>gemischt</i></span></div>"
];

const stripHtmlCases = htmlInputs.map((html) => ({
	input: html,
	output: api.stripHtml(html)
}));

const goldenData = {
	exportTxt: exportTxtCases,
	exportCsv: exportCsvCases,
	parseCsv: parseCsvCases,
	parseTableCards: parseTableCases,
	parseImpalaTxt: parseImpalaTxtCases,
	parseCardText: parseCardTextCases,
	cardKey: cardKeyCases,
	duplicateCount: duplicateCases,
	stripHtml: stripHtmlCases
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
	path.join(outDir, "card-transfer.json"),
	JSON.stringify(goldenData, null, 2) + "\n",
	"utf8"
);
console.log("Golden-Datei geschrieben:", path.join(outDir, "card-transfer.json"));
