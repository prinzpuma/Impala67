// Schreibt die Golden-Files für `cargo test -p impala-ink` (core/impala-ink/tests/golden/*.json) aus dem
// JS-Original: handwriting-ctc.js, handwriting-lexicon.js, handwriting-preprocessor.js, handwriting-rasterizer.js
// und der ganze Ablauf von handwriting-worker.js (Worker im Node nachgebildet).
//
// Braucht einmalig Referenz-Pakete außerhalb des Repos (nicht in package.json):
//   npm install --ignore-scripts --prefix <dir> onnxruntime-node@1.22.0 @napi-rs/canvas@0.1.80 hersheytext@1.0.0
//   node core/tools/gen-golden-ink.mjs <dir>
// onnxruntime-node rechnet das Modell (statt ONNX Runtime Web), @napi-rs/canvas (Skia wie Chrome) ersetzt
// OffscreenCanvas, hersheytext liefert Einstrich-Schriften als künstliche Handschrift.
//
// Logits werden kompakt gespeichert (je Schritt die 8 größten Werte, Rest = Zeilen-Minimum, Vielfache von 1/256):
// Das JS dekodiert genau diese Werte, Rust liest sie bitgleich. Binärdaten: base64(deflateRaw(...)).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire, register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.join(here, "../../web");
const outDir = path.join(here, "../impala-ink/tests/golden");
const refDir = process.argv[2];
if (!refDir) throw new Error("Aufruf: node core/tools/gen-golden-ink.mjs <Ordner mit onnxruntime-node, @napi-rs/canvas, hersheytext>");
const req = createRequire(path.join(path.resolve(refDir), "node_modules", "x.js"));
const ort = req("onnxruntime-node");
const { createCanvas } = req("@napi-rs/canvas");
const hershey = req("hersheytext/hersheytext.json");

// --- Hilfen -------------------------------------------------------------------------------------------------
function rng(seed) {
	let s = seed >>> 0 || 1;
	return () => {
		s ^= s << 13; s >>>= 0;
		s ^= s >>> 17;
		s ^= s << 5; s >>>= 0;
		return s / 0x100000000;
	};
}
const pack = (bytes) => zlib.deflateRawSync(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), { level: 9 }).toString("base64");
const CLASSES = 101, TOP = 8;

// Logits → kompakt: je Schritt [Minimum: i16][TOP × (Klasse: u8, Wert: i16)], Werte × 256
function compactLogits(data, steps) {
	const buf = new DataView(new ArrayBuffer(steps * (2 + TOP * 3)));
	const out = new Float32Array(steps * CLASSES);
	const q = (v) => Math.max(-32768, Math.min(32767, Math.round(v * 256)));
	for (let t = 0; t < steps; t++) {
		const row = data.subarray(t * CLASSES, (t + 1) * CLASSES);
		const order = Array.from(row.keys()).sort((a, b) => row[b] - row[a] || a - b);
		let min = Infinity;
		for (const v of row) min = Math.min(min, v);
		let o = t * (2 + TOP * 3);
		buf.setInt16(o, q(min), true);
		out.fill(q(min) / 256, t * CLASSES, (t + 1) * CLASSES);
		o += 2;
		for (const c of order.slice(0, TOP)) {
			buf.setUint8(o, c);
			buf.setInt16(o + 1, q(row[c]), true);
			out[t * CLASSES + c] = q(row[c]) / 256;
			o += 3;
		}
	}
	return { packed: pack(new Uint8Array(buf.buffer)), values: out };
}
const rows = (flat, steps) => Array.from({ length: steps }, (_, t) => flat.slice(t * CLASSES, (t + 1) * CLASSES));
const round = (x, d = 6) => Math.round(x * 10 ** d) / 10 ** d;

// --- Browser-Umgebung für den Worker -----------------------------------------------------------------------
globalThis.OffscreenCanvas = class {
	constructor(w, h) { this.canvas = createCanvas(w, h); }
	getContext(kind) { return this.canvas.getContext(kind); }
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
	if (/^https?:/.test(url)) return realFetch(url);
	const file = path.join(web, String(url).replace(/^\.\//, "").replace(/\?.*$/, ""));
	return new Response(fs.readFileSync(file));
};
let onMessage = null;
let pending = null;
globalThis.self = {
	addEventListener: (type, fn) => { if (type === "message") onMessage = fn; },
	postMessage: (msg) => { if (pending && (msg.type === "result" || msg.type === "error")) pending(msg); },
};
// ONNX Runtime Web (CDN) → onnxruntime-node; jede Inferenz wird mitgeschrieben und auf kompakte Logits gerundet
const inferences = [];
let fullPrecision = null; // erste Inferenz voll genau (Vergleich mit tract)
globalThis.__inkOrt = {
	Tensor: ort.Tensor,
	env: { wasm: {} },
	InferenceSession: {
		async create(buffer) {
			const session = await ort.InferenceSession.create(Buffer.from(buffer));
			return {
				inputNames: session.inputNames,
				outputNames: session.outputNames,
				async run(feeds) {
					const input = feeds.input;
					const width = input.dims[3];
					const res = await session.run(feeds);
					const out = res.output;
					const steps = out.dims[0];
					const { packed, values } = compactLogits(out.data, steps);
					const gray = Uint8Array.from(input.data, (v) => Math.round(v * 255));
					if (!fullPrecision) fullPrecision = { width, image: pack(gray), steps, logits: pack(new Float32Array(out.data)) };
					inferences.push({ width, steps, image: pack(gray), logits: packed });
					return { output: new ort.Tensor("float32", values, out.dims) };
				},
			};
		},
	},
};
register("data:text/javascript," + encodeURIComponent(`
	export async function resolve(spec, ctx, next) {
		if (spec.startsWith("https://cdn.jsdelivr.net/npm/onnxruntime-web")) return { url: "data:text/javascript,export const Tensor = globalThis.__inkOrt.Tensor, env = globalThis.__inkOrt.env, InferenceSession = globalThis.__inkOrt.InferenceSession;", shortCircuit: true };
		return next(spec, ctx);
	}`));

const { HANDWRITING_CTC } = await import(pathToFileURL(path.join(web, "handwriting-ctc.js")));
const { HANDWRITING_VOCAB } = await import(pathToFileURL(path.join(web, "handwriting-vocab.js")));
const { HANDWRITING_PREPROCESSOR: PRE } = await import(pathToFileURL(path.join(web, "handwriting-preprocessor.js")));
const { rasterizeLine, findInkGaps } = await import(pathToFileURL(path.join(web, "handwriting-rasterizer.js")));
const { createLexicon } = await import(pathToFileURL(path.join(web, "handwriting-lexicon.js")));
const lexicon = createLexicon(fs.readFileSync(path.join(web, "handwriting-lexicon-de.txt"), "utf8"));
const quiet = (fn) => async (...a) => {
	const { debug, error, info } = console;
	console.debug = console.error = console.info = () => {};
	try { return await fn(...a); } finally { Object.assign(console, { debug, error, info }); }
};
await quiet(() => import(pathToFileURL(path.join(web, "handwriting-worker.js"))))();
if (!onMessage) throw new Error("Worker hat keinen message-Handler registriert");
let reqId = 0;
const recognize = quiet((strokes, known = {}) => new Promise((resolve) => {
	pending = resolve;
	onMessage({ data: { type: "recognize_strokes", id: ++reqId, strokes, options: {}, known } });
}));

// --- Künstliche Handschrift (Hershey-Einstrich-Schrift, gezittert) -----------------------------------------
let strokeId = 0;
function writeText(text, { x0, y0, size = 1.1, slope = 0, font = "scripts", seed = 1, jitter = 0.35 }) {
	const f = hershey[font];
	const r = rng(seed);
	const strokes = [];
	let x = x0;
	const put = (px, py) => {
		const X = x + px * size, Y = y0 + py * size + (x - x0) * slope;
		return [round(X + (r() - 0.5) * jitter, 2), round(Y + (r() - 0.5) * jitter, 2)];
	};
	for (const ch of text) {
		if (ch === " ") { x += 14 * size; continue; }
		const base = { "ä": "a", "ö": "o", "ü": "u", "Ä": "A", "Ö": "O", "Ü": "U" }[ch] || ch;
		const glyph = f.chars[base.charCodeAt(0) - 33];
		if (!glyph) continue;
		for (const part of glyph.d.split("M").filter(Boolean)) {
			const nums = part.replace("L", " ").trim().split(/[\s,]+/).map(Number);
			const pts = [];
			for (let i = 0; i + 1 < nums.length; i += 2) {
				const p = [nums[i], nums[i + 1]];
				// Stift tastet dichter ab als die Schrift: Zwischenpunkte
				if (pts.length) {
					const [qx, qy] = pts[pts.length - 1].raw;
					const steps = Math.max(1, Math.round(Math.hypot(p[0] - qx, p[1] - qy) / 2));
					for (let k = 1; k < steps; k++) pts.push({ raw: [qx + ((p[0] - qx) * k) / steps, qy + ((p[1] - qy) * k) / steps] });
				}
				pts.push({ raw: p });
			}
			strokes.push({ id: `s${++strokeId}`, tool: "pen", pts: pts.map((p) => put(p.raw[0], p.raw[1])) });
		}
		if (base !== ch) {
			// Umlaut-Punkte
			for (const dx of [3, 9]) strokes.push({ id: `s${++strokeId}`, tool: "pen", pts: [put(dx, 8), put(dx + 0.6, 8.5)] });
		}
		x += Number(glyph.o) * 1.68 * size;
	}
	return strokes;
}

const pages = {
	notes: [
		...writeText("Heute ist ein wichtiges Treffen", { x0: 40, y0: 60, seed: 11 }),
		...writeText("Die Aufgabe für Montag lernen", { x0: 40, y0: 120, seed: 12, slope: 0.04 }),
		...writeText("x^2 + y = 5", { x0: 40, y0: 180, seed: 13, font: "futural" }),
		...writeText("Übung macht den Meister", { x0: 60, y0: 240, seed: 14, font: "cursive", slope: -0.08 }),
	],
	mixed: [
		...writeText("Projekt Plan", { x0: 30, y0: 50, seed: 21 }),
		{ id: "box", tool: "pen", pts: [[20, 20], [500, 20], [500, 400], [20, 400], [20, 20]] },
		{ id: "shape1", tool: "shape", pts: [[0, 0], [100, 100]] },
		{ id: "eraser1", tool: "eraser", pts: [[10, 10], [12, 12]] },
		{ id: "leer", tool: "pen", pts: [] },
		{ id: "punkt", tool: "pen", pts: [[300, 300]] },
		...writeText("Fehler im Code", { x0: 60, y0: 140, seed: 22, font: "timesi", slope: 0.25 }),
		...writeText("ok", { x0: 300, y0: 250, seed: 23 }),
	],
	wide: writeText("Die Verantwortung für das Projekt liegt bei allen Mitgliedern der Gruppe und wir treffen uns morgen", { x0: 10, y0: 40, seed: 31, size: 1.0 }),
};

// --- 1. Vorverarbeitung + ganzer Ablauf --------------------------------------------------------------------
const pipeline = [];
const preprocess = [];
for (const [name, strokes] of Object.entries(pages)) {
	const lines = PRE.segmentLines(strokes);
	const index = new Map(strokes.map((s, i) => [s, i]));
	const shuffled = (list, seed) => { const r = rng(seed); return list.map((s) => [r(), s]).sort((a, b) => a[0] - b[0]).map((x) => x[1]); };
	preprocess.push({
		name,
		strokes,
		lines: lines.map((l, k) => {
			const desk = PRE.deskewLine(l.strokes);
			const image = rasterizeLine(desk);
			const mixed = shuffled(l.strokes, 100 + k);
			return {
				strokes: l.strokes.map((s) => index.get(s)),
				bbox: l.bbox,
				deskewed: { first: desk[0].pts[0], last: desk.at(-1).pts.at(-1), bbox: PRE.strokeBbox({ pts: desk.flatMap((s) => s.pts) }) },
				imageWidth: image.width,
				gaps32: findInkGaps(image, 32),
				// orderLineStrokes auf gemischter Reihenfolge: Eingabe-Indizes und Ergebnis (Indizes in die Eingabe)
				order: { input: mixed.map((s) => index.get(s)), output: PRE.orderLineStrokes(mixed).map((s) => mixed.indexOf(s)) },
			};
		}),
	});

	inferences.length = 0;
	const first = await recognize(strokes);
	const runs = [{ known: {}, result: first, inferences: inferences.splice(0) }];
	if (name === "notes") {
		// Zweiter Lauf: eine Zeile neu (ein Strich verschoben), der Rest aus dem Zeilen-Cache
		const moved = strokes.map((s, i) => (i === 3 ? { ...s, pts: s.pts.map(([x, y]) => [x + 0.5, y]) } : s));
		const second = await recognize(moved, first.lineCache);
		runs.push({ known: first.lineCache, moved: 3, result: second, inferences: inferences.splice(0) });
	}
	pipeline.push({ name, runs: runs.map((r) => ({ ...r, result: { text: r.result.text, lines: r.result.lines, lineCache: r.result.lineCache, accounting: r.result.accounting } })) });
}

// --- 2. Dekodierung realer Logits (gerenderte Wörter durchs Modell) -------------------------------------------
const session = await ort.InferenceSession.create(path.join(web, "handwriting-model.onnx"));
async function renderLogits(text, font, noiseSeed, noise = 6) {
	const c = createCanvas(4, 64).getContext("2d");
	c.font = font;
	const w = Math.max(4, Math.ceil((c.measureText(text).width + 12) / 4) * 4);
	const canvas = createCanvas(w, 64);
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, w, 64);
	ctx.fillStyle = "#000";
	ctx.font = font;
	ctx.textBaseline = "middle";
	ctx.fillText(text, 6, 33);
	const rgba = ctx.getImageData(0, 0, w, 64).data;
	const data = new Float32Array(w * 64);
	for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4] / 255;
	const out = (await session.run({ input: new ort.Tensor("float32", data, [1, 1, 64, w]) })).output;
	const raw = new Float32Array(out.data);
	if (noiseSeed) {
		// Verrauschte Variante: zwingt Fehllesungen, die Wörterbuch und Korrektur beheben müssen
		const r = rng(noiseSeed);
		for (let i = 0; i < raw.length; i++) raw[i] += (r() - 0.5) * noise;
	}
	return { width: w, steps: out.dims[0], gaps: findInkGaps({ data, width: w }, 32), ...compactLogits(raw, out.dims[0]) };
}
const samples = [
	["Heute", "36px DejaVu Sans"], ["wichtig", "italic 34px DejaVu Serif"], ["Verantwortung", "34px Liberation Sans"],
	["Übungen", "36px FreeSans"], ["Meeting morgen", "32px Carlito"], ["x^2+y=5", "34px DejaVu Sans"],
	["a=b+c", "34px Liberation Serif"], ["GPU", "36px DejaVu Sans"], ["12.03.2026", "32px DejaVu Sans"],
	["(Notiz)", "34px FreeSans"], ["Grüße, Anna!", "32px DejaVu Serif"], ["pflegerische", "32px Liberation Sans"],
	["Handbreit", "italic 32px FreeSans"], ["Straße", "34px DejaVu Sans"], ["ok", "36px DejaVu Sans"],
	["die Aufgabe ist schwer", "30px Liberation Serif"], ["Mo", "34px Carlito"], ["√x", "36px DejaVu Sans"],
	["Wahrscheinlichkeit", "italic 30px DejaVu Serif"], ["Zusammenfassung", "32px FreeSans"], ["Rechnernetze", "32px Carlito"],
];
const optionSets = [
	{ name: "lexikon", options: {}, lexicon: true },
	{ name: "ohne-lexikon", options: {}, lexicon: false },
	{ name: "text", options: { mode: "text" }, lexicon: true },
	{ name: "math", options: { mode: "math" }, lexicon: false },
	{ name: "schwelle", options: { threshold: 0.95 }, lexicon: true },
];
const decode = [];
const strip = (r) => ({ ...r, charConfidences: Array.from(r.charConfidences) });
for (const [k, [text, font]] of samples.entries()) {
	for (const noise of [0, 1000 + k]) {
		const s = await renderLogits(text, font, noise);
		const results = {};
		for (const set of optionSets) {
			results[set.name] = strip(HANDWRITING_CTC.decodeWithConfidence(rows(s.values, s.steps), HANDWRITING_VOCAB, { ...set.options, lexicon: set.lexicon ? lexicon : undefined }));
		}
		const marked = rows(s.values, s.steps);
		HANDWRITING_CTC.markGapSpaces(marked, s.gaps, s.width);
		results.luecken = strip(HANDWRITING_CTC.decodeWithConfidence(marked, HANDWRITING_VOCAB, { lexicon }));
		decode.push({ text, font, noise: !!noise, width: s.width, steps: s.steps, gaps: s.gaps, logits: s.packed, results });
	}
}

// Stärker verrauschte Lesungen: nur die Standard-Lesung mit Wörterbuch, deckt die Wörterbuch-Suche breit ab
const stress = [];
for (const [k, [text, font]] of samples.entries()) {
	for (let n = 0; n < 3; n++) {
		const s = await renderLogits(text, font, 5000 + 7 * k + n, 10);
		const r = HANDWRITING_CTC.decodeWithConfidence(rows(s.values, s.steps), HANDWRITING_VOCAB, { lexicon });
		stress.push({ text, steps: s.steps, logits: s.packed, out: { text: r.text, status: r.status, confidence: r.confidence } });
	}
}

// --- 3. Wortkorrektur, Bereinigung, Levenshtein, Vokabular, Zeilenschlüssel ----------------------------------
const words = ["Wichtgi", "wichtgi", "Notiy", "(Notiy,", "Aufgaba", "Montaf", "GPUS", "x+yz", "12ab", "äöüß", "Treffer",
	"Beispiell", "beispie", "Fehlr", "Sonnatg", "zeilen", "teilen", "Meetin", "ab", "abc", "Hallo!", "__a_", "f(x)a", "Seitn."];
const correct = words.flatMap((w) => ["text", "math"].map((mode) => ({ word: w, mode, out: HANDWRITING_CTC.correctWord(w, mode) })));
const clean = [
	{ text: "  Hallo   Welt√ x^2 ", mode: "text" }, { text: "x^2 + y_1", mode: "math" }, { text: "√ ∫ Wichtgi", mode: "text" },
	{ text: "Wichtgi Notiy", mode: "text", charConfidences: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.5, 0.6, 0.9, 0.9, 0.9, 0.9] },
	{ text: "Wichtgi Notiy", mode: "text", charConfidences: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.95, 0.9, 0.9, 0.9, 0.3] },
	{ text: "Wichtgi", mode: "text", charConfidences: [0.9] },
].map((c) => ({ ...c, out: HANDWRITING_CTC.cleanTranscription(c.text, { mode: c.mode, charConfidences: c.charConfidences }) }));
const pairs = [["", ""], ["", "abc"], ["kitten", "sitting"], ["Straße", "Strasse"], ["über", "uber"], ["Heute ist", "Heute is"]];
const levenshtein = pairs.map(([a, b]) => ({ a, b, d: HANDWRITING_CTC.levenshtein(a, b) }));
const lexWords = ["haus", "häuser", "verantwortung", "pflegerische", "hausx", "", "a", "zzzzz", "übung", "straße"];
const lexHas = lexWords.map((w) => ({ word: w, has: lexicon.has(w) }));

fs.mkdirSync(outDir, { recursive: true });
const write = (name, data) => {
	const file = path.join(outDir, name);
	fs.writeFileSync(file, JSON.stringify(data) + "\n");
	console.log(`${name}: ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
};
write("pipeline.json", { preprocess, pipeline });
write("decode.json", { vocab: HANDWRITING_VOCAB.CHARACTERS, cases: decode, stress, correct, clean, levenshtein, lexicon: { size: lexicon.size, has: lexHas } });
write("tract.json", fullPrecision);
