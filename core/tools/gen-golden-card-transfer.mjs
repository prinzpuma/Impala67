// Erzeugt core/impala-model/tests/golden/card-transfer.json aus den echten JS-Funktionen in web/extras.js.
// Ausführen: node core/tools/gen-golden-card-transfer.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { CORE } from "../../web/rust-core.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outDir = path.join(repoRoot, "core/impala-model/tests/golden");

globalThis.CORE = CORE;

const dom = new JSDOM("<!doctype html><body><div id=overlay></div></body>", { url: "http://localhost/" });
for (const key of ["window", "document", "Element", "Node", "HTMLElement", "MutationObserver", "navigator", "DOMParser"]) {
	Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}

let lastDownload = null;
globalThis.S = { cards: {}, ankiDeck: "Standard" };
globalThis.STATE = {
	activeCards: () => [],
	onBeforeDispatch: () => {},
	onAfterDispatch: () => {},
};
globalThis.U = {
	uid: () => "test-uid",
	downloadText: (name, content) => { lastDownload = { name, content }; },
	el: () => dom.window.document.createElement("div"),
	takeOverlay: () => dom.window.document.createElement("div"),
	toast: () => {},
};
globalThis.BUS = { emit: () => {}, on: () => {} };
globalThis.NLM = {};
globalThis.HEFT = {};
globalThis.EXPORT_MEDIA = {};
globalThis.OPTIONAL_MODULE_URLS = {};
globalThis.PERF_PROFILER = { run: (k, fn) => fn() };

let code = fs.readFileSync(path.join(repoRoot, "web/extras.js"), "utf8");
code = code.replace(/import\s+[^;]+;/g, "");
code = code.replace(/export\s+const\s+EXTRAS\s*=/, "const EXTRAS =");
code = code.replace(
	"return { canUndoReview, createClozeCards };",
	"return { exportTxt, exportCsv, parseCsv, parseTableCards, parseImpalaTxt, parseCardText, cardKey, duplicateCount, stripHtml };"
);

const func = new Function("globalThis", "S", "STATE", "U", "BUS", "DOMParser", "getLastDownload", `
  ${code}
  return {
    exportTxt: (cards) => { STATE.activeCards = () => cards; EXTRAS.exportTxt(); return getLastDownload().content; },
    exportCsv: (cards) => { STATE.activeCards = () => cards; EXTRAS.exportCsv(); return getLastDownload().content; },
    parseCsv: EXTRAS.parseCsv,
    parseTableCards: (t, deck) => { S.ankiDeck = deck || "Standard"; return EXTRAS.parseTableCards(t); },
    parseImpalaTxt: (t, deck) => { S.ankiDeck = deck || "Standard"; return EXTRAS.parseImpalaTxt(t); },
    parseCardText: (t, deck) => { S.ankiDeck = deck || "Standard"; return EXTRAS.parseCardText(t); },
    cardKey: EXTRAS.cardKey,
    duplicateCount: (cards, existing) => { S.cards = existing || {}; return EXTRAS.duplicateCount(cards); },
    stripHtml: EXTRAS.stripHtml,
  };
`);

const api = func(globalThis, globalThis.S, globalThis.STATE, globalThis.U, globalThis.BUS, globalThis.DOMParser, () => lastDownload);

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
