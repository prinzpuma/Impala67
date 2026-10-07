"use strict";

// web/handwriting-worker.js — Web Worker für lokale Handschrift- und Stricherkennung.
// Führt Inferenz abseits des UI-Threads aus (100 % offline / on-device via ONNX Runtime Web).

import { HANDWRITING_PREPROCESSOR } from "./handwriting-preprocessor.js";
import { HANDWRITING_VOCAB } from "./handwriting-vocab.js";
import { HANDWRITING_CTC } from "./handwriting-ctc.js";

let ort = null;
let session = null;
let modelLoading = false;
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

const MODEL_CACHE_KEY = "impala67-handwriting-model-v4";

async function fetchModelBuffer(modelPath) {
	if (typeof caches !== "undefined") {
		try {
			const cache = await caches.open(MODEL_CACHE_KEY);
			let response = await cache.match(modelPath);
			if (!response) {
				response = await fetch(modelPath + "?v=2.2.21");
				if (response.ok) {
					await cache.put(modelPath, response.clone());
				}
			}
			return await response.arrayBuffer();
		} catch (e) {
			console.info("[handwriting-worker] Cache Storage nicht verfügbar, lade direkt:", e);
		}
	}
	const res = await fetch(modelPath + "?v=2.2.21");
	return await res.arrayBuffer();
}

async function initSession(modelPath = currentModelPath) {
	if (session && currentModelPath === modelPath) return session;
	if (modelLoading) return null;
	modelLoading = true;
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
	} finally {
		modelLoading = false;
	}
}

// Maximale Punktsequenzlänge aus dem Training (darüber wird das Netz unzuverlässiger)
const MAX_TRAINING_POINTS = 450;

// Führt Inferenz für eine einzelne Zeile von [dx, dy, pen_down]-Features aus
async function recognizeLineFeatures(features, options = {}) {
	if (!features || features.length < 3) {
		return { text: "", rawText: "", confidence: 0, status: "empty", isConfident: false, blankRatio: 1 };
	}
	if (!session) {
		await initSession();
	}
	if (!session) {
		throw new Error("Handschrift-Modell ist nicht geladen.");
	}

	const seqLen = features.length;
	// Input-Tensor: Shape [1, seq_len, 4]
	const flatData = new Float32Array(seqLen * 4);
	for (let i = 0; i < seqLen; i++) {
		flatData[i * 4 + 0] = features[i][0]; // dx
		flatData[i * 4 + 1] = features[i][1]; // dy
		flatData[i * 4 + 2] = features[i][2]; // pen_down
		flatData[i * 4 + 3] = features[i][3] !== undefined ? features[i][3] : 0.0; // y_rel
	}

	const inputTensor = new ort.Tensor("float32", flatData, [1, seqLen, 4]);
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
		} else if (s.pts.length < 2) {
			strokeStatus[i] = "skipped_too_short";
		} else {
			validInkStrokes.push({ stroke: s, origIdx: i });
		}
	}

	// Prüfe zuerst 2D-Brüche
	const fraction = HANDWRITING_PREPROCESSOR.detectFraction(strokes);
	if (fraction) {
		try {
			const numFeat = HANDWRITING_PREPROCESSOR.extractLineFeatures(fraction.numeratorStrokes);
			const denFeat = HANDWRITING_PREPROCESSOR.extractLineFeatures(fraction.denominatorStrokes);
			const [numRes, denRes] = await Promise.all([
				numFeat.length >= 3 ? recognizeLineFeatures(numFeat, options) : Promise.resolve({ text: "", isConfident: false }),
				denFeat.length >= 3 ? recognizeLineFeatures(denFeat, options) : Promise.resolve({ text: "", isConfident: false }),
			]);

			let sideText = "";
			if (fraction.sideStrokes.length >= 2) {
				const sideFeat = HANDWRITING_PREPROCESSOR.extractLineFeatures(fraction.sideStrokes);
				if (sideFeat.length >= 3) {
					const sideRes = await recognizeLineFeatures(sideFeat, options);
					if (sideRes.isConfident) sideText = sideRes.text;
				}
			}

			// Striche als erkannt markieren
			for (let i = 0; i < totalStrokesCount; i++) {
				if (!strokeStatus[i]) strokeStatus[i] = (numRes.isConfident && denRes.isConfident) ? "recognized" : "uncertain";
			}

			const fracLaTeX = `\\frac{${numRes.text.trim() || "?"}}{${denRes.text.trim() || "?"}}`;
			let fullText = fracLaTeX;
			if (sideText.trim()) {
				const sideBox = fraction.sideStrokes.reduce(
					(acc, s) => {
						const b = HANDWRITING_PREPROCESSOR.strokeBbox(s);
						if (!b) return acc;
						return { minX: Math.min(acc.minX, b.minX), maxX: Math.max(acc.maxX, b.maxX) };
					},
					{ minX: Infinity, maxX: -Infinity }
				);
				fullText = (sideBox.maxX < fraction.barBox.minX) ? `${sideText.trim()} ${fracLaTeX}` : `${fracLaTeX} ${sideText.trim()}`;
			}

			return {
				text: (numRes.isConfident || denRes.isConfident) ? fullText : "",
				lines: [fullText],
				accounting: {
					total: totalStrokesCount,
					recognized: (numRes.isConfident && denRes.isConfident) ? totalStrokesCount : 0,
					uncertain: (!numRes.isConfident || !denRes.isConfident) ? totalStrokesCount : 0,
					skipped: 0,
					balanced: true,
				}
			};
		} catch (err) {
			console.info("[handwriting-worker] 2D-Bruch Fallback auf Standard-Segmentierung:", err);
		}
	}

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

		const features = HANDWRITING_PREPROCESSOR.extractLineFeatures(lineStrokes);

		// Prüfung auf zu lange Sequenzen (Training-Limit)
		const isTooLong = features.length > MAX_TRAINING_POINTS;
		if (isTooLong) {
			console.warn(`[handwriting-accounting] Warnung: Strichgruppe mit ${features.length} Features ist länger als Trainingsdaten (${MAX_TRAINING_POINTS}).`);
		}

		let status = "skipped_too_short";
		let text = "";
		let confidence = 0;

		if (features.length < 5) {
			status = "skipped_too_short";
			for (const idx of lineOrigIndices) strokeStatus[idx] = "skipped_too_short";
		} else {
			try {
				const rec = await recognizeLineFeatures(features, options);
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

				if (status === "recognized" && text && text.trim()) {
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
			featuresCount: features.length,
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

	if (msg.type === "recognize_line") {
		const id = msg.id;
		try {
			const res = await recognizeLineFeatures(msg.features || [], msg.options || {});
			self.postMessage({
				type: "result",
				id,
				text: res.text,
				confidence: res.confidence,
				status: res.status,
				isConfident: res.isConfident,
				blankRatio: res.blankRatio,
			});
		} catch (err) {
			self.postMessage({ type: "error", id, error: err?.message || String(err) });
		}
		return;
	}
});

