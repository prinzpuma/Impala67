// gen-golden-srs.mjs — Erzeugt golden/cloze.json für `cargo test -p impala-srs`
// aus der JS-Implementierung in web/extras.js und web/home-view.js.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "../impala-srs/tests/golden");
fs.mkdirSync(outDir, { recursive: true });

// Original-JS-Logik aus web/extras.js
const clozeRe = () => /\{\{c(\d+)::([\s\S]*?)(?:::([^{}]*?))?\}\}/g;

function clozeIndexes(text) {
	const set = new Set();
	const re = clozeRe();
	let m;
	while ((m = re.exec(text))) set.add(Number(m[1]));
	return [...set].sort((a, b) => a - b);
}

const clozeFront = (text, idx) => text.replace(clozeRe(), (all, n, ans, hint) =>
	Number(n) === idx ? "**[" + (hint ? "…" + hint + "…" : "…") + "]**" : ans);

const clozeBack = (text, idx) => text.replace(clozeRe(), (all, n, ans) =>
	Number(n) === idx ? "**==" + ans + "==**" : ans);

// Original-JS-Logik aus web/home-view.js (mit [\s\S]*? wie extras.js statt .*?, damit Mehrzeiler funktionieren)
const CLOZE = /\{\{c\d+::([\s\S]*?)(?:::[^}]*)?\}\}/g;
function clozeRecall(front) {
	const cloze = CLOZE.test(front);
	CLOZE.lastIndex = 0;
	if (!cloze) return null;
	const question = front.replace(CLOZE, "＿＿＿");
	const answers = [...front.matchAll(CLOZE)].map((m) => m[1]);
	return { question, answers };
}

// Original-Logik aus web/extras.js für Markierungen und Zeilenpräfix
const CO = "{{";
const CC = "}}";

function highlightsToCloze(line) {
	if (!/==[^=\n]+==/.test(line)) return null;
	let i = 0;
	return line.replace(/==([^=\n]+)==/g, (a, t) => CO + "c" + (++i) + "::" + t + CC);
}

function stripLinePrefix(line) {
	return line.replace(/^[\s>#*-]*(\[[ x]\]\s*)?/, "").trim();
}

function clozeWrap(text, a, b) {
	const min = Math.min(a, b);
	const max = Math.max(a, b);
	const sel = text.slice(min, max);
	const idxs = clozeIndexes(text);
	const next = idxs.length > 0 ? idxs[idxs.length - 1] + 1 : 1;
	const open = "{{c" + next + "::";
	const resText = text.slice(0, min) + open + sel + "}}" + text.slice(max);
	const cursor = sel.length === 0 ? min + open.length : min + open.length + sel.length + 2;
	return { text: resText, cursor };
}

// Testfälle
const testSentences = [
	"",
	"Ein ganz normaler Satz ohne jede Lücke.",
	"Die Hauptstadt von Frankreich ist {{c1::Paris}}.",
	"Die Hauptstadt von Frankreich ist {{c1::Paris::Stadt}}.",
	"{{c1::Paris}} ist die Hauptstadt von {{c2::Frankreich::Land}} in {{c3::Europa}}.",
	"In Deutschland sind {{c1::Berlin}} und {{c1::Hamburg}} Millionenstädte.",
	"Reihenfolge: {{c2::Zweiter Schritt}}, danach {{c1::Erster Schritt}} und wieder {{c2::Zweiter Schritt}}.",
	"Sonderzeichen: {{c1::München & Köln::Städte}} haben über 1.000.000 Einwohner (ca. 100%).",
	"Mehrzeilig: {{c1::Erste Zeile\nZweite Zeile::Zwei Zeilen}} Ende.",
];

const sentenceCases = testSentences.map((text) => {
	const idxs = clozeIndexes(text);
	const frontCases = {};
	const backCases = {};
	for (const i of [...idxs, 99]) {
		frontCases[String(i)] = clozeFront(text, i);
	}
	for (const i of idxs) {
		backCases[String(i)] = clozeBack(text, i);
	}
	return {
		text,
		indexes: idxs,
		front: frontCases,
		back: backCases,
		recall: clozeRecall(text),
	};
});

const wrapCases = [
	{ text: "Paris ist die Hauptstadt", a: 0, b: 5, expected: clozeWrap("Paris ist die Hauptstadt", 0, 5) },
	{ text: "Paris ist die Hauptstadt", a: 0, b: 0, expected: clozeWrap("Paris ist die Hauptstadt", 0, 0) },
	{ text: "Paris ist die Hauptstadt", a: 24, b: 24, expected: clozeWrap("Paris ist die Hauptstadt", 24, 24) },
	{ text: "Paris ist die Hauptstadt", a: 14, b: 24, expected: clozeWrap("Paris ist die Hauptstadt", 14, 24) },
	{ text: "{{c1::Paris}} ist die Hauptstadt von Frankreich", a: 38, b: 48, expected: clozeWrap("{{c1::Paris}} ist die Hauptstadt von Frankreich", 38, 48) },
	{ text: "Schöne Grüße aus München", a: 18, b: 25, expected: clozeWrap("Schöne Grüße aus München", 18, 25) },
];

const highlightCases = [
	"Eine Notiz mit ==wichtigem== Begriff.",
	"Keine Markierung hier.",
	"Mehrere ==erste== und ==zweite== Markierungen.",
	"==Alles markiert==",
	"Kaputtes == ohne Ende",
	"== == leerer Inhalt",
].map((line) => ({
	input: line,
	output: highlightsToCloze(line),
}));

const stripCases = [
	"- [ ] Todo offen",
	"  - [x] Erledigt",
	"> [ ] Zitat mit Checkbox",
	"### Überschrift 3",
	"  * Aufzählung",
	"Normaler Text",
].map((line) => ({
	input: line,
	output: stripLinePrefix(line),
}));

const golden = {
	sentences: sentenceCases,
	wraps: wrapCases,
	highlights: highlightCases,
	strips: stripCases,
};

const targetPath = path.join(outDir, "cloze.json");
fs.writeFileSync(targetPath, JSON.stringify(golden, null, "\t") + "\n");
console.log(`Golden-Datei geschrieben: ${targetPath} (${fs.statSync(targetPath).size} Bytes)`);
