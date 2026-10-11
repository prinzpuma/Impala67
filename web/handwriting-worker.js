"use strict";

// web/handwriting-worker.js — Web Worker für lokale Handschrift- und Stricherkennung.
// Führt Inferenz abseits des UI-Threads aus (100 % offline / on-device via ONNX Runtime Web).

import { HANDWRITING_PREPROCESSOR } from "./handwriting-preprocessor.js";
import { HANDWRITING_VOCAB } from "./handwriting-vocab.js";
import { HANDWRITING_CTC } from "./handwriting-ctc.js";
import { HANDWRITING_MODEL_VERSION } from "./handwriting-model-version.js";
import { rasterizeLine, IMAGE_HEIGHT } from "./handwriting-rasterizer.js";

let ort = null;
let session = null;
let modelLoading = null; // Promise des laufenden Ladevorgangs
let modelReady = false;
let currentModelPath = "./handwriting-model.onnx";

async function loadOrt() {
	if (!ort) {
		try {
			ort = await import("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.all.bundle.min.mjs");
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

async function fetchModelBuffer(modelPath) {
	if (typeof caches !== "undefined") {
		try {
			const cache = await caches.open(MODEL_CACHE_KEY);
			let response = await cache.match(modelPath);
			if (!response) {
				response = await fetch(`${modelPath}?v=${MODEL_VERSION}`);
				if (response.ok) {
					await cache.put(modelPath, response.clone());
				}
			}
			return await response.arrayBuffer();
		} catch (e) {
			console.info("[handwriting-worker] Cache Storage nicht verfügbar, lade direkt:", e);
		}
	}
	const res = await fetch(`${modelPath}?v=${MODEL_VERSION}`);
	return await res.arrayBuffer();
}

// Gleichzeitige Anfragen warten auf denselben Ladevorgang, statt leer auszugehen
function initSession(modelPath = currentModelPath) {
	if (session && currentModelPath === modelPath) return Promise.resolve(session);
	if (!modelLoading) modelLoading = loadSession(modelPath).finally(() => { modelLoading = null; });
	return modelLoading;
}

async function loadSession(modelPath) {
	try {
		await loadOrt();
		currentModelPath = modelPath;
		const modelBuffer = await fetchModelBuffer(modelPath);
		const executionProviders = ["wasm"];
		session = await ort.InferenceSession.create(modelBuffer, {
			executionProviders,
			graphOptimizationLevel: "all",
		});
		modelReady = true;
		self.postMessage({ type: "ready", model: modelPath });
		return session;
	} catch (e) {
		console.warn("[handwriting-worker] Fehler beim Laden des ONNX-Modells:", e);
		self.postMessage({ type: "init_error", error: e?.message || String(e) });
		return null;
	}
}

// Breiteste Zeilenbilder im Training (handwriting/train_image.py); breitere werden unzuverlässiger.
const MAX_TRAINING_WIDTH = 2048;

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

	return HANDWRITING_CTC.decodeWithConfidence(logits2D, HANDWRITING_VOCAB, options);
}

// Erkennt eine Liste von Strichen auf einer Seite mit vollständiger Strich-Bilanzierung
async function recognizePageStrokes(strokes, options = {}) {
	const totalStrokesCount = Array.isArray(strokes) ? strokes.length : 0;
	if (totalStrokesCount === 0) {
		return { text: "", lines: [], accounting: { total: 0, recognized: 0, uncertain: 0, skipped: 0, balanced: true } };
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

	for (const line of lines) {
		const lineStrokes = line.strokes || [];
		const lineOrigIndices = [];
		for (const s of lineStrokes) {
			const found = validInkStrokes.find((v) => v.stroke === s && strokeStatus[v.origIdx] === null);
			if (found) lineOrigIndices.push(found.origIdx);
		}

		const pointCount = lineStrokes.reduce((n, s) => n + ((s.pts && s.pts.length) || 0), 0);
		const image = pointCount >= 5 ? rasterizeLine(HANDWRITING_PREPROCESSOR.deskewLine(lineStrokes)) : null;

		// Prüfung auf zu breite Zeilen (Training-Limit)
		const isTooLong = !!image && image.width > MAX_TRAINING_WIDTH;
		if (isTooLong) {
			console.warn(`[handwriting-accounting] Warnung: Zeilenbild mit ${image.width} px ist breiter als die Trainingsdaten (${MAX_TRAINING_WIDTH} px).`);
		}

		let status = "skipped_too_short";
		let text = "";
		let confidence = 0;

		if (!image) {
			status = "skipped_too_short";
			for (const idx of lineOrigIndices) strokeStatus[idx] = "skipped_too_short";
		} else {
			try {
				const rec = await recognizeLineImage(image, options);
				text = rec.text;
				confidence = rec.confidence;
				status = rec.status; // recognized, uncertain, drawing, empty

				if (isTooLong && status === "recognized") {
					// Bei extrem langen Zeilen Sicherheitsabzug
					if (rec.confidence < 0.90) status = "uncertain";
				}

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
				status = "error";
				for (const idx of lineOrigIndices) strokeStatus[idx] = "error";
			}
		}

		groupsReport.push({
			strokesCount: lineStrokes.length,
			imageWidth: image ? image.width : 0,
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
		await initSession(msg.modelPath || currentModelPath);
		return;
	}

	if (msg.type === "recognize_strokes") {
		const id = msg.id;
		try {
			// Ohne Modell wäre jede Zeile still "leer": als Fehler melden, damit Aufrufer es später erneut versuchen
			if (!(await initSession())) throw new Error("Handschrift-Modell ist nicht geladen.");
			const res = await recognizePageStrokes(msg.strokes || [], msg.options || {});
			self.postMessage({
				type: "result",
				id,
				text: res.text,
				lines: res.lines,
				accounting: res.accounting,
			});
		} catch (err) {
			self.postMessage({ type: "error", id, error: err?.message || String(err) });
		}
		return;
	}
});

