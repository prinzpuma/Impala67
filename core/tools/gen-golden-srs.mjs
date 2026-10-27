// Schreibt die Golden-Files für `cargo test -p impala-srs` (core/impala-srs/tests/golden/*.json)
// aus dem JS-Original web/srs.js: zufällige Bewertungsfolgen mit festen Zeiten → Kartenzustand
// und Vorschau nach jedem Schritt. Math.random (Fuzz) wird je Schritt durch einen festen Wert
// ersetzt und mitgeschrieben (null = nicht aufgerufen).
// Neu erzeugen nur, wenn sich das JS-Verhalten bewusst ändert: node core/tools/gen-golden-srs.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SRS } from "../../web/srs.js";
import { rng } from "./sample-log.mjs";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../impala-srs/tests/golden");
fs.mkdirSync(dir, { recursive: true });

let nextRandom = 0;
let usedRandom = null;
Math.random = () => { usedRandom = nextRandom; return nextRandom; };

const MIN = 60e3, DAY = 864e5;
const T0 = Date.UTC(2026, 0, 5, 8, 30, 0, 123);

// Nächster Bewertungszeitpunkt relativ zur Fälligkeit: pünktlich, verspätet, zu früh, Uhr zurück …
function nextTime(r, card, now) {
	const due = Date.parse(card.due);
	const k = r();
	if (k < 0.35) return due + Math.floor(r() * 30 * MIN);
	if (k < 0.6) return due + Math.floor(r() * 40 * DAY);
	if (k < 0.75) return now + Math.floor(r() * (due - now));
	if (k < 0.85) return now + Math.floor(r() * 3 * MIN);
	if (k < 0.92) return due + Math.floor(r() * 400 * DAY);
	if (k < 0.97) return now - Math.floor(r() * 2 * DAY); // Uhr des Geräts geht nach
	return now; // gleiche Millisekunde
}

function sequence(seed, start, steps) {
	const r = rng(seed);
	let card = start;
	let now = Date.parse(card.due || new Date(T0).toISOString()) || T0;
	const out = [];
	for (let k = 0; k < steps; k++) {
		now = nextTime(r, card, now);
		const at = new Date(now);
		const grade = r() < 0.08 ? [0, 5, 2.6, -1][Math.floor(r() * 4)] : 1 + Math.floor(r() * 4);
		const fuzz = r() < 0.8;
		nextRandom = r();
		usedRandom = null;
		const after = SRS.rate(card, grade, at, fuzz);
		const rand = usedRandom;
		out.push({ now: at.toISOString(), grade, fuzz, rand, after, preview: SRS.preview(after, at) });
		card = after;
	}
	return { start, steps: out };
}

const iso = (ms) => new Date(ms).toISOString();
const cases = [];
for (let s = 1; s <= 150; s++) cases.push(sequence(s, SRS.newCard(iso(T0 + s * 37 * MIN)), 4 + (s % 16)));
// Lose geformte Altkarten (fehlende Felder, Nullwerte, last fehlt/kaputt, Zusatzfelder)
const loose = [
	{ state: "review", stability: 0, difficulty: 0, due: iso(T0), last: null },
	{ state: "review", stability: 12.5, difficulty: 7.2, due: iso(T0 + 3 * DAY), reps: 9, lapses: 2, step: 0, last: iso(T0 - 9 * DAY), ease: 2500, interval: 12 },
	{ state: "review", stability: 400, difficulty: 1, due: iso(T0), reps: 40, lapses: 0, last: iso(T0 - 380 * DAY) },
	{ state: "review", stability: 0.05, difficulty: 10, due: iso(T0), last: "kaputt" },
	{ state: "learning", stability: 3.173, difficulty: 2.1, due: iso(T0), reps: 1, lapses: 0, step: 7, last: iso(T0 - 10 * MIN) },
	{ state: "learning", due: iso(T0) },
	{ state: "relearning", stability: 2, difficulty: 6, due: iso(T0), reps: 5, lapses: 1, step: 0, last: iso(T0 - DAY) },
	{ state: "relearning", stability: 0, difficulty: 11, due: iso(T0), step: 3 },
	{ state: "new", stability: 0, difficulty: 5, due: iso(T0), reps: 0, lapses: 0, step: 0, last: null },
	{ state: "review", stability: 36000, difficulty: 3, due: iso(T0), reps: 3, lapses: 0, last: iso(T0 - 36000 * DAY) },
];
loose.forEach((c, k) => cases.push(sequence(1000 + k, c, 12)));

const retrievability = [];
for (const t of [0, 0.001, 0.5, 1, 2.5, 10, 100, 1e4, -3]) for (const S of [0, 0.1, 0.5, 1, 3.173, 15.69, 365, 1e5]) retrievability.push([t, S, SRS.retrievability(t, S)]);
// fmtIvl (nur über preview erreichbar): Karte mit fester Stabilität, Intervall = Stabilität
const formats = [];
const nowF = new Date(T0);
for (const S of [0.1, 0.4, 0.6, 1.2, 1.4, 1.6, 2.5, 5, 29, 30.4, 31, 45, 200, 364, 365, 366, 900, 3650, 36500, 99999]) {
	const c = { state: "learning", stability: S, difficulty: 5, due: iso(T0), reps: 1, lapses: 0, step: 1, last: iso(T0) };
	formats.push({ card: c, now: nowF.toISOString(), preview: SRS.preview(c, nowF) });
}

// fmtIvl ist nicht exportiert: Quelltext aus web/srs.js auswerten
const srsSrc = fs.readFileSync(path.join(dir, "../../../../web/srs.js"), "utf8");
const fmtStart = srsSrc.indexOf("function fmtIvl(ms) {");
const fmtEnd = srsSrc.indexOf("\n\t}\n", fmtStart) + 3;
const fmtIvl = new Function(srsSrc.slice(fmtStart, fmtEnd) + "\nreturn fmtIvl;")();
const ivl = [];
for (const m of [0, 1, 29e3, 30e3, 59.4 * MIN, 59.6 * MIN, 60 * MIN, 89 * MIN, 23.4 * 60 * MIN, 23.5 * 60 * MIN, 1.49 * DAY, 1.5 * DAY, 2.5 * DAY, 30.9 * DAY, 31 * DAY, 45 * DAY, 364 * DAY, 365 * DAY, 400 * DAY, 3650 * DAY, 36500 * DAY, 1234567890123])
	ivl.push([m, fmtIvl(m)]);

const write = (file, data) => {
	const json = JSON.stringify(data);
	fs.writeFileSync(path.join(dir, file), json + "\n");
	console.log(file, json.length, "Bytes");
};
write("sequences.json", cases);
write("functions.json", { retrievability, formats, ivl });
