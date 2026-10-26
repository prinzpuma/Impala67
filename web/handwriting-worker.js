"use strict";

// web/handwriting-worker.js — Web Worker für lokale Handschrift- und Stricherkennung.
// Führt Inferenz abseits des UI-Threads aus (100 % offline / on-device via ONNX Runtime Web).

import { HANDWRITING_PREPROCESSOR } from "./handwriting-preprocessor.js";
import { HANDWRITING_VOCAB } from "./handwriting-vocab.js";
import { HANDWRITING_CTC } from "./handwriting-ctc.js";
import { HANDWRITING_MODEL_VERSION } from "./handwriting-model-version.js";
import { rasterizeLine, findInkGaps, IMAGE_HEIGHT } from "./handwriting-rasterizer.js";
import { createLexicon } from "./handwriting-lexicon.js";

const ORT_VERSION = "1.30.0";
let ort = null;
let session = null;
let modelLoading = null; // Promise des laufenden Ladevorgangs
let modelReady = false;
let currentModelPath = "./handwriting-model.onnx";

async function loadOrt() {
	if (!ort) {
		try {
			// Nur CPU (WASM): das „all“-Paket brächte zusätzlich WebGPU/WebGL mit und lädt 28 statt 14 MB WebAssembly
			ort = await import(`https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort.wasm.bundle.min.mjs`);
			if (ort?.env?.wasm) {
				ort.env.wasm.numThreads = 1;
				ort.env.wasm.simd = true;
			}
		} catch (e) {
			console.warn("[handwriting-worker] ONNX Runtime Web konnte nicht importiert werden:", e);
			throw e;
		}
	}
	return ort;
}

// Neuer Cache-Name und neue URL je Modellversion umgehen alte Kopien.
const MODEL_VERSION = HANDWRITING_MODEL_VERSION;
const MODEL_CACHE_KEY = `impala67-handwriting-model-${MODEL_VERSION}`;

// Ältere Modellversionen belegen sonst je ~13 MB, bis der Speicher voll ist.
function dropOldModelCaches() {
	caches.keys()
		.then((keys) => Promise.all(keys
			.filter((k) => k.startsWith("impala67-handwriting-model-") && k !== MODEL_CACHE_KEY)
			.map((k) => caches.delete(k))))
		.catch(() => {});
}

// Modell und Wörterbuch: einmal je Version laden, danach aus dem eigenen Cache
async function fetchCached(path) {
	if (typeof caches !== "undefined") {
		try {
			const cache = await caches.open(MODEL_CACHE_KEY);
			let response = await cache.match(path);
			if (!response) {
				response = await fetch(`${path}?v=${MODEL_VERSION}`);
				if (response.ok) {
					await cache.put(path, response.clone());
					dropOldModelCaches();
				}
			}
			return response;
		} catch (e) {
			console.info("[handwriting-worker] Cache Storage nicht verfügbar, lade direkt:", e);
		}
	}
	return fetch(`${path}?v=${MODEL_VERSION}`);
}

// Großes Wörterbuch (handwriting-lexicon.js); fehlt es, liest die Erkennung ohne weiter
const LEXICON_PATH = "./handwriting-lexicon-de.txt";
let lexicon = null;
let lexiconLoading = null;
function loadLexicon() {
	if (!lexiconLoading) {
		lexiconLoading = fetchCached(LEXICON_PATH)
			.then((res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				return res.text();
			})
			.then((text) => (lexicon = createLexicon(text)))
			.catch((e) => {
				console.warn("[handwriting-worker] Wörterbuch nicht geladen:", e);
				lexiconLoading = null;
				return null;
			});
	}
	return lexiconLoading;
}

// Gleichzeitige Anfragen warten auf denselben Ladevorgang, statt leer auszugehen
function initSession(modelPath = currentModelPath) {
	if (session && currentModelPath === modelPath) return Promise.resolve(session);
	if (!modelLoading) modelLoading = loadSession(modelPath).finally(() => { modelLoading = null; });
	return modelLoading;
}

async function loadSession(modelPath) {
	const started = performance.now();
	try {
		await loadOrt();
		currentModelPath = modelPath;
		const modelBuffer = await (await fetchCached(modelPath)).arrayBuffer();
		const executionProviders = ["wasm"];
		session = await ort.InferenceSession.create(modelBuffer, {
			executionProviders,
			graphOptimizationLevel: "all",
		});
		modelReady = true;
		// loadMs/runtime landen im Profiler des Hauptthreads (handschrift.js).
		self.postMessage({ type: "ready", model: modelPath, loadMs: Math.round(performance.now() - started), runtime: ORT_VERSION });
		return session;
	} catch (e) {
		console.warn("[handwriting-worker] Fehler beim Laden des ONNX-Modells:", e);
		self.postMessage({ type: "init_error", error: e?.message || String(e), runtime: ORT_VERSION });
		return null;
	}
}

// Breiteste Zeilenbilder im Training (handwriting/train_image.py lässt breitere aus). Breitere Zeilen werden an
// Lücken in Stücke höchstens dieser Breite geteilt und einzeln gelesen: Das Modell sieht nur Breiten wie im
// Training, und der Speicher der Faltungsschichten (wächst linear mit der Breite) halbiert sich gegenüber 4096 px.
const MAX_TRAINING_WIDTH = 2048;
// Schnittstellen: Lücken ab dieser Breite; die breiteste Lücke in der hinteren Hälfte des Fensters gewinnt
const CHUNK_GAP_PX = 8;
// Mindestabstand eines Schnitts vom Stückanfang (= Rand des Zeilenbilds, rasterizeLine PADDING)
const PADDING_COLUMNS = 6;
// Leere Spalten ab dieser Breite (Zeilenbild 64 px hoch) sind sicher eine Wortlücke. Bei fremden ScaDS-Schreibern
// ab 32 px ohne Nachteil; 24 px half nur eigenen Formel-Zeilen und kostete bei ScaDS leicht, 16 px trennte Buchstaben.
const WORD_GAP_PX = 32;

// Führt Inferenz für ein Zeilenbild aus (rasterizeLine: Graustufen 0..1, Höhe 64)
async function recognizeLineImage(image, options = {}) {
	if (!session) {
		await initSession();
	}
	if (!session) {
		throw new Error("Handschrift-Modell ist nicht geladen.");
	}

	const inputTensor = new ort.Tensor("float32", image.data, [1, 1, IMAGE_HEIGHT, image.width]);
	const feeds = {};
	const inputName = session.inputNames[0] || "input";
	feeds[inputName] = inputTensor;

	const results = await session.run(feeds);
	const outputName = session.outputNames[0] || "output";
	const outputTensor = results[outputName];

	// Output-Tensor Shape: [seq_out, 1, vocab_size] oder [1, seq_out, vocab_size]
	const dims = outputTensor.dims;
	const outData = outputTensor.data;

	let numSteps = 0, vocabSize = 0;
	let stepStride = 0;

	if (dims.length === 3) {
		if (dims[0] === 1) {
			// [1, steps, vocab]
			numSteps = dims[1];
			vocabSize = dims[2];
			stepStride = vocabSize;
		} else {
			// [steps, 1, vocab]
			numSteps = dims[0];
			vocabSize = dims[2];
			stepStride = vocabSize;
		}
	} else if (dims.length === 2) {
		numSteps = dims[0];
		vocabSize = dims[1];
		stepStride = vocabSize;
	}

	const logits2D = [];
	for (let s = 0; s < numSteps; s++) {
		const offset = s * stepStride;
		const row = new Float32Array(vocabSize);
		for (let v = 0; v < vocabSize; v++) {
			row[v] = outData[offset + v];
		}
		logits2D.push(row);
	}

	HANDWRITING_CTC.markGapSpaces(logits2D, findInkGaps(image, WORD_GAP_PX), image.width);
	return HANDWRITING_CTC.decodeWithConfidence(logits2D, HANDWRITING_VOCAB, { ...options, lexicon });
}

// Spalten [from, to) eines Zeilenbilds; Breite auf ein Vielfaches von 4, Rest weiß
function sliceImage(image, from, to) {
	const width = Math.max(4, Math.ceil((to - from) / 4) * 4);
	const data = new Float32Array(width * IMAGE_HEIGHT).fill(1);
	for (let y = 0; y < IMAGE_HEIGHT; y++) {
		data.set(image.data.subarray(y * image.width + from, y * image.width + to), y * width);
	}
	return { data, width };
}

// Schnittpunkte für Zeilen breiter als MAX_TRAINING_WIDTH: in jedem Fenster die breiteste Lücke der hinteren
// Hälfte (sonst irgendeine), ohne Lücke hart an der Fenstergrenze. space: Lücke breit genug für eine Wortgrenze.
function chunkCuts(image) {
	const gaps = findInkGaps(image, CHUNK_GAP_PX);
	const cuts = [];
	let start = 0;
	while (image.width - start > MAX_TRAINING_WIDTH) {
		const limit = start + MAX_TRAINING_WIDTH;
		let best = null, bestLate = null;
		for (const gap of gaps) {
			const mid = Math.floor((gap[0] + gap[1]) / 2);
			if (mid <= start + PADDING_COLUMNS || mid > limit) continue;
			const w = gap[1] - gap[0];
			if (!best || w > best.w) best = { mid, w };
			if (mid > start + MAX_TRAINING_WIDTH / 2 && (!bestLate || w > bestLate.w)) bestLate = { mid, w };
		}
		const pick = bestLate || best;
		const at = pick ? pick.mid : limit;
		cuts.push({ at, space: !!pick && pick.w >= WORD_GAP_PX });
		start = at;
	}
	return cuts;
}

// Wie recognizeLineImage, aber breite Zeilen in Stücken; onChunk(width) vor jeder Inferenz (Absturz-Spur).
// Stücke, die das Modell für eine Zeichnung hält, fallen weg – wie sonst ganze Zeichnungs-Zeilen.
async function recognizeWideLine(image, options, onChunk) {
	const cuts = chunkCuts(image);
	if (!cuts.length) {
		onChunk(image.width);
		return recognizeLineImage(image, options);
	}
	let text = "", textWidth = 0, weighted = 0, allRecognized = true, sawDrawing = false, from = 0;
	for (let i = 0; i <= cuts.length; i++) {
		const to = i < cuts.length ? cuts[i].at : image.width;
		const part = sliceImage(image, from, to);
		onChunk(part.width);
		const rec = await recognizeLineImage(part, options);
		const partText = (rec.text || "").trim();
		if (rec.status === "drawing") sawDrawing = true;
		else if (partText) {
			text += text ? (cuts[i - 1].space ? " " : "") + partText : partText;
			weighted += rec.confidence * (to - from);
			textWidth += to - from;
			allRecognized = allRecognized && rec.status === "recognized";
		}
		from = to;
	}
	if (!text) return { text: "", confidence: 0, status: sawDrawing ? "drawing" : "empty" };
	return { text, confidence: weighted / textWidth, status: allRecognized ? "recognized" : "uncertain" };
}

// Kurzer Schlüssel einer Zeile aus ihren Strichen (id, Punktzahl, erster/letzter Punkt): ändert sich, sobald
// ein Strich dazukommt, wegfällt oder verschoben wird. cyrb53, damit der Cache klein bleibt.
function lineSignature(lineStrokes, options) {
	const parts = lineStrokes.map((s) => {
		const pts = s.pts || [], a = pts[0] || [], b = pts[pts.length - 1] || [];
		return `${s.id || ""}:${pts.length}:${a[0]},${a[1]}:${b[0]},${b[1]}`;
	}).sort();
	const str = JSON.stringify(options) + "|" + parts.join("|");
	let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// Erkennt eine Liste von Strichen auf einer Seite mit vollständiger Strich-Bilanzierung
// progress({ phase, line, lines, width }): Absturz-Spur im Hauptthread (handschrift.js)
// known: { Zeilenschlüssel: { text, confidence, status } } schon gelesener Zeilen; nur neue/geänderte Zeilen
// gehen durchs Modell. Neu gelesene Zeilen kommen als lineCache zurück.
async function recognizePageStrokes(strokes, options = {}, progress = () => {}, known = {}) {
	const totalStrokesCount = Array.isArray(strokes) ? strokes.length : 0;
	if (totalStrokesCount === 0) {
		return { text: "", lines: [], lineCache: {}, accounting: { total: 0, recognized: 0, uncertain: 0, skipped: 0, balanced: true } };
	}

	// 1. Strich-Tracking initialisieren: Jeder Strich bekommt genau einen Status
	const strokeStatus = new Array(totalStrokesCount).fill(null);
	const validInkStrokes = [];

	for (let i = 0; i < totalStrokesCount; i++) {
		const s = strokes[i];
		if (!s || !Array.isArray(s.pts) || s.pts.length === 0) {
			strokeStatus[i] = "skipped_empty";
		} else if (s.tool === "shape" || s.tool === "eraser" || s.tool === "laser") {
			strokeStatus[i] = "skipped_tool";
		} else {
			validInkStrokes.push({ stroke: s, origIdx: i });
		}
	}

	// Brüche brauchen keinen Sonderweg: Das Modell ist auf MathWriting mit Brüchen als "a/b" trainiert
	// und liest sie direkt innerhalb der Zeile.
	const rawInkOnly = validInkStrokes.map((v) => v.stroke);
	const lines = HANDWRITING_PREPROCESSOR.segmentLines(rawInkOnly);

	const recognizedLines = [];
	const groupsReport = [];
	const lineCache = {};

	for (const [lineIndex, line] of lines.entries()) {
		const lineStrokes = line.strokes || [];
		progress({ phase: "rasterize", line: lineIndex + 1, lines: lines.length, width: 0 });
		const lineOrigIndices = [];
		for (const s of lineStrokes) {
			const found = validInkStrokes.find((v) => v.stroke === s && strokeStatus[v.origIdx] === null);
			if (found) lineOrigIndices.push(found.origIdx);
		}

		const pointCount = lineStrokes.reduce((n, s) => n + ((s.pts && s.pts.length) || 0), 0);
		const sig = pointCount >= 5 ? lineSignature(lineStrokes, options) : "";
		const cached = sig && known[sig];
		const image = pointCount >= 5 && !cached ? rasterizeLine(HANDWRITING_PREPROCESSOR.deskewLine(lineStrokes)) : null;

		// Breiter als im Training: wird in Stücken gelesen (recognizeWideLine)
		const isTooLong = !!image && image.width > MAX_TRAINING_WIDTH;

		let status = "skipped_too_short";
		let text = "";
		let confidence = 0;

		if (cached) {
			({ text, confidence, status } = cached);
			for (const idx of lineOrigIndices) strokeStatus[idx] = status;
			if ((status === "recognized" || status === "uncertain") && text && text.trim()) recognizedLines.push(text);
		} else if (!image) {
			status = "skipped_too_short";
			for (const idx of lineOrigIndices) strokeStatus[idx] = "skipped_too_short";
		} else {
			try {
				const rec = await recognizeWideLine(image, options, (width) => progress({ phase: "infer", line: lineIndex + 1, lines: lines.length, width }));
				text = rec.text;
				confidence = rec.confidence;
				status = rec.status; // recognized, uncertain, drawing, empty
				lineCache[sig] = { text, confidence, status };

				for (const idx of lineOrigIndices) {
					strokeStatus[idx] = status;
				}

				// Unsichere Zeilen (meist kurze Formeln wie "y=5") liefern trotzdem Text: für die Suche
				// ist eine fast richtige Lesung besser als keine. Nur Zeichnungen fallen weg.
				if ((status === "recognized" || status === "uncertain") && text && text.trim()) {
					recognizedLines.push(text);
				}
			} catch (err) {
				console.warn("[handwriting-worker] Inferenzfehler in Zeile:", err);
				// z. B. "WebAssembly.Memory(): could not allocate memory": im Leistungsprotokoll sichtbar machen
				self.postMessage({ type: "line_error", error: err?.message || String(err), width: image.width });
				status = "error";
				for (const idx of lineOrigIndices) strokeStatus[idx] = "error";
			}
		}

		groupsReport.push({
			strokesCount: lineStrokes.length,
			imageWidth: image ? image.width : 0,
			cached: !!cached,
			status,
			confidence,
			text,
			tooLong: isTooLong,
		});
	}

	// 2. Summen-Abgleich (Accounting Verification)
	// Jeder Strich MUSS genau einer Kategorie zugeordnet sein!
	let recognizedCount = 0;
	let uncertainCount = 0;
	let skippedCount = 0;
	let unassignedCount = 0;

	for (let i = 0; i < totalStrokesCount; i++) {
		const st = strokeStatus[i];
		if (!st) {
			unassignedCount++;
			strokeStatus[i] = "unassigned";
		} else if (st === "recognized") {
			recognizedCount++;
		} else if (st === "uncertain") {
			uncertainCount++;
		} else {
			skippedCount++;
		}
	}

	const balanced = (recognizedCount + uncertainCount + skippedCount) === totalStrokesCount && unassignedCount === 0;
	if (!balanced) {
		console.error(`[handwriting-accounting] FEHLER: Strich-Bilanz geht nicht auf! Gesamt: ${totalStrokesCount}, Erkannt: ${recognizedCount}, Unsicher: ${uncertainCount}, Übersprungen: ${skippedCount}, Nicht zugeordnet: ${unassignedCount}`);
	} else {
		console.debug(`[handwriting-accounting] Strich-Bilanz sauber aufgegangen (${totalStrokesCount} Striche: ${recognizedCount} erkannt, ${uncertainCount} unsicher, ${skippedCount} übersprungen).`);
	}

	return {
		text: recognizedLines.join("\n"),
		lines: recognizedLines,
		lineCache,
		accounting: {
			total: totalStrokesCount,
			recognized: recognizedCount,
			uncertain: uncertainCount,
			skipped: skippedCount,
			unassigned: unassignedCount,
			balanced,
			groups: groupsReport,
		}
	};
}

self.addEventListener("message", async (event) => {
	const msg = event.data;
	if (!msg) return;

	if (msg.type === "init") {
		await Promise.all([initSession(msg.modelPath || currentModelPath), loadLexicon()]);
		return;
	}

	if (msg.type === "recognize_strokes") {
		const id = msg.id;
		const progress = (step) => self.postMessage({ type: "progress", id, ...step });
		try {
			// Ohne Modell wäre jede Zeile still "leer": als Fehler melden, damit Aufrufer es später erneut versuchen
			if (!session || !lexicon) progress({ phase: "model-load" });
			const [ready] = await Promise.all([initSession(), loadLexicon()]);
			if (!ready) throw new Error("Handschrift-Modell ist nicht geladen.");
			const res = await recognizePageStrokes(msg.strokes || [], msg.options || {}, progress, msg.known || {});
			self.postMessage({
				type: "result",
				id,
				text: res.text,
				lines: res.lines,
				lineCache: res.lineCache,
				accounting: res.accounting,
			});
		} catch (err) {
			self.postMessage({ type: "error", id, error: err?.message || String(err) });
		}
		return;
	}
});

