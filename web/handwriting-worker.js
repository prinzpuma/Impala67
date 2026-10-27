"use strict";

// web/handwriting-worker.js — Web Worker für lokale Handschrift- und Stricherkennung.
// Der Seitenablauf (Zeilen, Zeilen-Cache, Begradigen, Rastern, Stückeln, Dekodieren, Strich-Bilanz)
// läuft im Rust-Kern (impala-ink); hier bleiben Laden und Inferenz (100 % offline via ONNX Runtime Web).

import { HANDWRITING_MODEL_VERSION } from "./handwriting-model-version.js";
import { CORE } from "./rust-core.js";

// Zeilenbilder des Kerns sind 64 px hoch (impala-ink raster::IMAGE_HEIGHT).
const IMAGE_HEIGHT = 64;

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

// Erkenner des Kerns mit großem Wörterbuch; fehlt das Wörterbuch, liest die Erkennung ohne weiter
// (und versucht es beim nächsten Mal erneut).
const LEXICON_PATH = "./handwriting-lexicon-de.txt";
let engine = null;
let engineLoading = null;
function loadEngine() {
	if (!engineLoading) {
		engineLoading = fetchCached(LEXICON_PATH)
			.then((res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				return res.arrayBuffer();
			})
			.then((buf) => (engine = new CORE.InkEngine(new Uint8Array(buf))))
			.catch((e) => {
				console.warn("[handwriting-worker] Wörterbuch nicht geladen:", e);
				engineLoading = null;
				return (engine ||= new CORE.InkEngine(undefined));
			});
	}
	return engineLoading;
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

// Inferenz für ein Zeilenbild des Kerns (Graustufen 0..1, Höhe 64) → Logits steps × Klassen, zeilenweise.
// Die Ausgabe [1, steps, vocab] bzw. [steps, 1, vocab] liegt schon in dieser Reihenfolge.
async function runModel(data, width) {
	if (!session) await initSession();
	if (!session) throw new Error("Handschrift-Modell ist nicht geladen.");
	const inputName = session.inputNames[0] || "input";
	const results = await session.run({ [inputName]: new ort.Tensor("float32", data, [1, 1, IMAGE_HEIGHT, width]) });
	return results[session.outputNames[0] || "output"].data;
}

// Erkennt die Striche einer Seite. progress({ phase, line, lines, width }): Absturz-Spur im Hauptthread
// (handschrift.js). known: schon gelesene Zeilen; nur neue/geänderte Zeilen gehen durchs Modell.
async function recognizePageStrokes(strokes, options, progress, known) {
	let line = 0, lines = 0;
	const model = {
		lineStarted(n, total) { line = n; lines = total; progress({ phase: "rasterize", line, lines, width: 0 }); },
		run(data, width) { progress({ phase: "infer", line, lines, width }); return runModel(data, width); },
	};
	const res = await engine.recognizePage(JSON.stringify(strokes || []), JSON.stringify(options || {}), JSON.stringify(known || {}), model);
	for (const g of res.accounting.groups) {
		// z. B. "WebAssembly.Memory(): could not allocate memory": im Leistungsprotokoll sichtbar machen
		if (g.error) self.postMessage({ type: "line_error", error: g.error, width: g.imageWidth });
	}
	return res;
}

self.addEventListener("message", async (event) => {
	const msg = event.data;
	if (!msg) return;

	if (msg.type === "init") {
		await Promise.all([initSession(msg.modelPath || currentModelPath), loadEngine()]);
		return;
	}

	if (msg.type === "recognize_strokes") {
		const id = msg.id;
		const progress = (step) => self.postMessage({ type: "progress", id, ...step });
		try {
			// Ohne Modell wäre jede Zeile still "leer": als Fehler melden, damit Aufrufer es später erneut versuchen
			if (!session || !engine) progress({ phase: "model-load" });
			const [ready] = await Promise.all([initSession(), loadEngine()]);
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

