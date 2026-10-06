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

const MODEL_CACHE_KEY = "impala67-handwriting-model-v3";

async function fetchModelBuffer(modelPath) {
	if (typeof caches !== "undefined") {
		try {
			const cache = await caches.open(MODEL_CACHE_KEY);
			let response = await cache.match(modelPath);
			if (!response) {
				response = await fetch(modelPath + "?v=2.2.20");
				if (response.ok) {
					await cache.put(modelPath, response.clone());
				}
			}
			return await response.arrayBuffer();
		} catch (e) {
			console.info("[handwriting-worker] Cache Storage nicht verfügbar, lade direkt:", e);
		}
	}
	const res = await fetch(modelPath + "?v=2.2.20");
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

// Führt Inferenz für eine einzelne Zeile von [dx, dy, pen_down]-Features aus
async function recognizeLineFeatures(features) {
	if (!features || features.length < 3) return "";
	if (!session) {
		await initSession();
	}
	if (!session) {
		throw new Error("Handschrift-Modell ist nicht geladen.");
	}

	const seqLen = features.length;
	// Input-Tensor: Shape [1, seq_len, 3]
	const flatData = new Float32Array(seqLen * 3);
	for (let i = 0; i < seqLen; i++) {
		flatData[i * 3 + 0] = features[i][0]; // dx
		flatData[i * 3 + 1] = features[i][1]; // dy
		flatData[i * 3 + 2] = features[i][2]; // pen_down
	}

	const inputTensor = new ort.Tensor("float32", flatData, [1, seqLen, 3]);
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

	return HANDWRITING_CTC.greedyDecode(logits2D, HANDWRITING_VOCAB);
}

// Erkennt eine Liste von Strichen auf einer Seite (mit 2D-Mathe/Bruch-Unterstützung)
async function recognizePageStrokes(strokes) {
	// Prüfe zuerst, ob die Strichmenge als 2D-Bruch aufgebaut ist
	const fraction = HANDWRITING_PREPROCESSOR.detectFraction(strokes);
	if (fraction) {
		try {
			const numFeat = HANDWRITING_PREPROCESSOR.extractLineFeatures(fraction.numeratorStrokes);
			const denFeat = HANDWRITING_PREPROCESSOR.extractLineFeatures(fraction.denominatorStrokes);
			const [numText, denText] = await Promise.all([
				numFeat.length >= 3 ? recognizeLineFeatures(numFeat) : Promise.resolve(""),
				denFeat.length >= 3 ? recognizeLineFeatures(denFeat) : Promise.resolve(""),
			]);

			let sideText = "";
			if (fraction.sideStrokes.length >= 2) {
				const sideFeat = HANDWRITING_PREPROCESSOR.extractLineFeatures(fraction.sideStrokes);
				if (sideFeat.length >= 3) sideText = await recognizeLineFeatures(sideFeat);
			}

			const fracLaTeX = `\\frac{${numText.trim() || "?"}}{${denText.trim() || "?"}}`;
			if (sideText.trim()) {
				// Prüfe ob sideStrokes links oder rechts vom Bruch lagen
				const sideBox = fraction.sideStrokes.reduce(
					(acc, s) => {
						const b = HANDWRITING_PREPROCESSOR.strokeBbox(s);
						if (!b) return acc;
						return { minX: Math.min(acc.minX, b.minX), maxX: Math.max(acc.maxX, b.maxX) };
					},
					{ minX: Infinity, maxX: -Infinity }
				);
				if (sideBox.maxX < fraction.barBox.minX) {
					return `${sideText.trim()} ${fracLaTeX}`;
				}
				return `${fracLaTeX} ${sideText.trim()}`;
			}
			return fracLaTeX;
		} catch (err) {
			console.info("[handwriting-worker] 2D-Bruch-Erkennung Fallback auf Zeilenerkennung:", err);
		}
	}

	const lines = HANDWRITING_PREPROCESSOR.segmentLines(strokes);
	if (!lines.length) return "";

	const recognizedLines = [];
	for (const line of lines) {
		const features = HANDWRITING_PREPROCESSOR.extractLineFeatures(line.strokes);
		if (features.length < 5) continue;
		try {
			const text = await recognizeLineFeatures(features);
			if (text && text.trim()) {
				recognizedLines.push(HANDWRITING_CTC.cleanTranscription(text));
			}
		} catch (err) {
			console.warn("[handwriting-worker] Zeile konnte nicht erkannt werden:", err);
		}
	}

	return recognizedLines.join("\n");
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
			const text = await recognizePageStrokes(msg.strokes || []);
			self.postMessage({ type: "result", id, text });
		} catch (err) {
			self.postMessage({ type: "error", id, error: err?.message || String(err) });
		}
		return;
	}

	if (msg.type === "recognize_line") {
		const id = msg.id;
		try {
			const text = await recognizeLineFeatures(msg.features || []);
			self.postMessage({ type: "result", id, text });
		} catch (err) {
			self.postMessage({ type: "error", id, error: err?.message || String(err) });
		}
		return;
	}
});
