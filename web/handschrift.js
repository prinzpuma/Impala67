"use strict";
import { U } from "./util.js";
import { PERF_PROFILER } from "./performance-profiler.js";

// handschrift.js — Handschrift- und Strich-Erkennung für Impala67 (heft.js).
//
// Einziger Erkennungsweg: Vektor-Handschrift on-device via ONNX Runtime Web
// (handwriting-worker.js) — 100 % offline, erkennt Strichsequenzen, Mathe-Formeln
// und Brüche direkt aus Vektordaten. (Bild-OCR per ML Kit wurde mit v2.2.18 entfernt.)
export const HANDSCHRIFT = (() => {

	let inkWorker = null;
	let inkReqId = 0;
	const inkPending = new Map();

	// Das Modell belegt im Worker schnell über 100 MB (WebAssembly-Speicher wächst, schrumpft aber nie).
	// Auf Tablets mit 4 GB beendet Android die App dann eher. Darum den Worker nach einer Minute ohne
	// Anfrage und sofort im Hintergrund beenden; die nächste Erkennung lädt das Modell neu (~2 s).
	const IDLE_RELEASE_MS = 60000;
	let idleTimer = 0;
	function releaseWorker() {
		clearTimeout(idleTimer);
		if (!inkWorker || inkPending.size) return;
		try { inkWorker.terminate(); } catch {}
		inkWorker = null;
	}
	function scheduleRelease() {
		clearTimeout(idleTimer);
		if (inkPending.size) return;
		if (typeof document !== "undefined" && document.hidden) releaseWorker();
		else idleTimer = setTimeout(releaseWorker, IDLE_RELEASE_MS);
	}
	if (typeof document !== "undefined") {
		document.addEventListener("visibilitychange", () => { if (document.hidden) releaseWorker(); });
	}

	// Absturz-Spur: Solange eine Erkennung läuft, steht hier, wo der Worker gerade ist (Modell laden, Zeile N,
	// Bildbreite). Stürzt die WebView dabei ab, meldet der nächste Start handwriting-crash mit genau diesem Stand.
	const INFLIGHT_KEY = "impala67_handwriting_inflight";
	let inflight = null;
	function writeInflight(step) {
		inflight = { ...inflight, ...step, at: new Date().toISOString(), visibility: typeof document !== "undefined" ? document.visibilityState : "" };
		try { localStorage.setItem(INFLIGHT_KEY, JSON.stringify(inflight)); } catch {}
	}
	function clearInflight() {
		inflight = null;
		try { localStorage.removeItem(INFLIGHT_KEY); } catch {}
	}
	try {
		const last = JSON.parse(localStorage.getItem(INFLIGHT_KEY) || "null");
		if (last) {
			localStorage.removeItem(INFLIGHT_KEY);
			PERF_PROFILER.error("handwriting-crash", new Error("App brach während der Handschrift-Erkennung ab"), last);
		}
	} catch {}
	// Normales Schließen mitten in einer Erkennung ist kein Absturz
	if (typeof window !== "undefined") window.addEventListener("pagehide", clearInflight);

	function getInkWorker() {
		clearTimeout(idleTimer);
		if (!inkWorker && typeof Worker !== "undefined") {
			try {
				inkWorker = new Worker("./handwriting-worker.js", { type: "module" });
				inkWorker.addEventListener("message", (e) => {
					const msg = e.data || {};
					if (msg.type === "ready") PERF_PROFILER.record("operation", msg.loadMs || 0, { name: "handwriting.model-load", runtime: msg.runtime });
					else if (msg.type === "init_error") PERF_PROFILER.error("handwriting-error", new Error(msg.error || "Handschrift-Modell konnte nicht geladen werden"), { runtime: msg.runtime });
					else if (msg.type === "line_error") PERF_PROFILER.error("handwriting-line-error", new Error(msg.error || "Inferenzfehler"), { width: msg.width });
					if (msg.type === "progress") {
						if (inkPending.has(msg.id)) writeInflight({ phase: msg.phase, line: msg.line, lines: msg.lines, width: msg.width });
						return;
					}
					if (msg.id && inkPending.has(msg.id)) {
						const { resolve, reject } = inkPending.get(msg.id);
						inkPending.delete(msg.id);
						if (msg.type === "error") reject(new Error(msg.error));
						else resolve(msg.text || "");
					}
				});
				inkWorker.addEventListener("error", (err) => {
					PERF_PROFILER.error("handwriting-worker-error", new Error(err?.message || "Worker-Fehler"), { phase: inflight?.phase, width: inflight?.width });
					const pending = [...inkPending.values()];
					inkPending.clear();
					for (const { reject } of pending) reject(new Error(err?.message || "Worker-Fehler"));
					try { inkWorker?.terminate(); } catch {}
					inkWorker = null;
				});
			} catch { inkWorker = null; }
		}
		return inkWorker;
	}

	// source: Aufrufer für die Absturz-Spur ("indexer", "lasso", "label" …)
	async function recognizeStrokes(strokes, options = {}, source = "") {
		if (!strokes || !strokes.length) return "";
		const worker = getInkWorker();
		if (!worker) throw new Error("Handwriting-Worker nicht verfügbar.");
		const id = ++inkReqId;
		return PERF_PROFILER.run("handwriting.recognize", () => new Promise((resolve, reject) => {
			const done = () => {
				clearTimeout(timeout);
				if (!inkPending.size) clearInflight();
				scheduleRelease();
			};
			const timeout = setTimeout(() => {
				const entry = inkPending.get(id);
				if (entry) {
					inkPending.delete(id);
					entry.reject(new Error("Timeout bei Handschrift-Erkennung"));
				}
			}, 15000);
			inkPending.set(id, {
				resolve: (res) => { done(); resolve(res); },
				reject: (err) => { done(); reject(err); },
			});
			writeInflight({ source, strokes: strokes.length, phase: "queued", line: 0, lines: 0, width: 0 });
			worker.postMessage({ type: "recognize_strokes", id, strokes, options });
		}), { strokes: strokes.length, source }, 50);
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

	// Entfernt Beispiele, deren Felder alle zu match passen (z. B. { source: "llm", pageId, pageIdx }),
	// damit eine neu beschriftete Seite ihre alten Beispiele ersetzt statt sie zu verdoppeln.
	function removeTrainingSamples(match) {
		const keys = Object.keys(match || {});
		if (!keys.length) return 0;
		const samples = getTrainingSamples();
		const kept = samples.filter((s) => !keys.every((k) => s[k] === match[k]));
		try { localStorage.setItem(STORAGE_KEY_SAMPLES, JSON.stringify(kept)); } catch {}
		return samples.length - kept.length;
	}

	function exportTrainingSamplesJson() {
		return JSON.stringify(getTrainingSamples(), null, 2);
	}

	// Teilen-Menü (iPad: „In Drive sichern“), sonst normaler Download.
	// Muss direkt aus einem Klick heraus aufgerufen werden (navigator.share braucht die Geste).
	async function shareTrainingSamples() {
		const name = "my_handwriting_samples.json";
		const json = exportTrainingSamplesJson();
		const file = typeof File !== "undefined" ? new File([json], name, { type: "application/json" }) : null;
		if (file && navigator.canShare?.({ files: [file] })) {
			try {
				await navigator.share({ files: [file], title: name });
				return "geteilt";
			} catch (e) {
				if (e?.name === "AbortError") return "abgebrochen";
			}
		}
		U.download(name, json);
		return "heruntergeladen";
	}

	function clearTrainingSamples() {
		try { localStorage.removeItem(STORAGE_KEY_SAMPLES); } catch {}
	}

	return {
		recognizeStrokes,
		saveTrainingSample,
		removeTrainingSamples,
		getTrainingSamples,
		shareTrainingSamples,
		clearTrainingSamples,
	};
})();