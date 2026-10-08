"use strict";
import { U } from "./util.js";

// handschrift.js — Handschrift- und Strich-Erkennung für Impala67 (heft.js).
//
// Pipeline:
//   1) Vektor-Handschrift (Primär): On-Device WebAssembly via ONNX Runtime Web
//      (handwriting-worker.js) — 100 % offline, < 2 ms Inferenz, erkennt Strichsequenzen,
//      Mathe-Formeln und Brüche direkt aus Vektordaten.
//   2) Native Android App (Fallback für reine Bitmaps/Fotos): Google ML Kit
//      (On-Device Text Recognition via platform-native.js).
export const HANDSCHRIFT = (() => {
	const available = () => true;

	let inkWorker = null;
	let inkReqId = 0;
	const inkPending = new Map();

	function getInkWorker() {
		if (!inkWorker && typeof Worker !== "undefined") {
			try {
				inkWorker = new Worker("./handwriting-worker.js", { type: "module" });
				inkWorker.addEventListener("message", (e) => {
					const msg = e.data || {};
					if (msg.id && inkPending.has(msg.id)) {
						const { resolve, reject, fullDetails } = inkPending.get(msg.id);
						inkPending.delete(msg.id);
						if (msg.type === "error") reject(new Error(msg.error));
						else resolve(fullDetails ? msg : (msg.text || ""));
					}
				});
				inkWorker.addEventListener("error", (err) => {
					for (const { reject } of inkPending.values()) reject(new Error(err?.message || "Worker-Fehler"));
					inkPending.clear();
					try { inkWorker?.terminate(); } catch {}
					inkWorker = null;
				});
			} catch { inkWorker = null; }
		}
		return inkWorker;
	}

	async function recognizeStrokes(strokes, options = {}) {
		if (!strokes || !strokes.length) return "";
		const worker = getInkWorker();
		if (!worker) throw new Error("Handwriting-Worker nicht verfügbar.");
		const id = ++inkReqId;
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				if (inkPending.has(id)) {
					inkPending.delete(id);
					reject(new Error("Timeout bei Handschrift-Erkennung"));
				}
			}, 15000);
			inkPending.set(id, {
				resolve: (res) => { clearTimeout(timeout); resolve(res); },
				reject: (err) => { clearTimeout(timeout); reject(err); },
				fullDetails: false,
			});
			worker.postMessage({ type: "recognize_strokes", id, strokes, options });
		});
	}

	async function recognizeStrokesDetails(strokes, options = {}) {
		if (!strokes || !strokes.length) return { text: "", lines: [], accounting: { total: 0, balanced: true } };
		const worker = getInkWorker();
		if (!worker) throw new Error("Handwriting-Worker nicht verfügbar.");
		const id = ++inkReqId;
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				if (inkPending.has(id)) {
					inkPending.delete(id);
					reject(new Error("Timeout bei Handschrift-Erkennung"));
				}
			}, 15000);
			inkPending.set(id, {
				resolve: (res) => { clearTimeout(timeout); resolve(res); },
				reject: (err) => { clearTimeout(timeout); reject(err); },
				fullDetails: true,
			});
			worker.postMessage({ type: "recognize_strokes", id, strokes, options });
		});
	}

	const STORAGE_KEY_SAMPLES = "impala67_handwriting_training_samples";

	function getTrainingSamples() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY_SAMPLES);
			return raw ? JSON.parse(raw) : [];
		} catch { return []; }
	}

	// meta: optionale Zusatzfelder, z. B. { split: "eval" } für Messzeilen aus dem Abschreib-Modus
	function saveTrainingSample(strokes, label, meta = {}) {
		if (!strokes || !strokes.length || !label || !String(label).trim()) return false;
		const samples = getTrainingSamples();
		samples.push({
			...meta,
			id: U.uid(),
			text: String(label).trim(),
			strokes: strokes.map((s) => ({
				pts: (s.pts || []).map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]),
			})),
			createdAt: Date.now(),
		});
		try {
			localStorage.setItem(STORAGE_KEY_SAMPLES, JSON.stringify(samples));
			return true;
		} catch (e) {
			console.warn("Handschrift: Fehler beim Speichern des Trainingsbeispiels:", e);
			return false;
		}
	}

	function exportTrainingSamplesJson() {
		return JSON.stringify(getTrainingSamples(), null, 2);
	}

	function clearTrainingSamples() {
		try { localStorage.removeItem(STORAGE_KEY_SAMPLES); } catch {}
	}

	return {
		available,
		recognizeStrokes,
		recognizeStrokesDetails,
		saveTrainingSample,
		getTrainingSamples,
		exportTrainingSamplesJson,
		clearTrainingSamples,
	};
})();