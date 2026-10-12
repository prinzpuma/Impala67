"use strict";
import { PERF_PROFILER } from "./performance-profiler.js";

// scan-ocr.js — Texterkennung (OCR) für gescannte Heftseiten mit Tesseract.js.
//
// Aufgabe:
//   Liefert für ein Scan-Bild (Data-URL oder Blob) den erkannten Text. Tesseract.js wird
//   erst beim ersten Bedarf per <script> nachgeladen. Es gibt genau einen wiederverwendeten
//   Worker; Aufträge laufen seriell. Nach 60 s ohne Auftrag wird der Worker beendet, um Akku
//   und Speicher zu schonen. Sprachdaten cached Tesseract selbst (IndexedDB).
//   Fehler (offline, CDN nicht erreichbar) werden als Exception weitergereicht.

const TESSERACT_VERSION = "7.0.0";
const CDN = "https://cdn.jsdelivr.net/npm/";
const SCRIPT_URL = `${CDN}tesseract.js@${TESSERACT_VERSION}/dist/tesseract.min.js`;
// SRI-Hash der exakten Datei; bei einem Versionswechsel neu berechnen.
const SCRIPT_INTEGRITY = "sha384-2BQ3U3OdKOb0Uczxqr41I9UvZkzr4V9Hv8uSzMMZAlmhsFClvdZX5wi5fDCzG+tM";
const WORKER_PATH = `${CDN}tesseract.js@${TESSERACT_VERSION}/dist/worker.min.js`;
const CORE_PATH = `${CDN}tesseract.js-core@${TESSERACT_VERSION}`;
const LANGS = "deu+eng";
const IDLE_MS = 60000;
// Unter diesem Wert ist die Erkennung zu unsicher: lieber kein Text als Müll im Suchindex.
const MIN_CONFIDENCE = 30;
const MIN_CHARS = 3;

let scriptPromise = null;
let workerPromise = null;
let idleTimer = 0;
let queue = Promise.resolve();

// Text bereinigen: Mehrfach-Leerzeichen und Leerzeilen zusammenfassen, Ränder trimmen.
export function cleanOcrText(raw) {
	return String(raw || "")
		.replace(/[ \t ]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n\s*\n/g, "\n")
		.trim();
}

function loadTesseract() {
	if (window.Tesseract) return Promise.resolve(window.Tesseract);
	if (!scriptPromise) {
		scriptPromise = new Promise((resolve, reject) => {
			const script = document.createElement("script");
			script.src = SCRIPT_URL;
			script.crossOrigin = "anonymous";
			script.integrity = SCRIPT_INTEGRITY;
			script.async = true;
			script.onload = () => {
				if (window.Tesseract) resolve(window.Tesseract);
				else { scriptPromise = null; reject(new Error("Tesseract ist nach dem Laden nicht verfügbar")); }
			};
			script.onerror = () => {
				scriptPromise = null;
				script.remove();
				reject(new Error("Tesseract.js konnte nicht geladen werden"));
			};
			document.head.appendChild(script);
		});
	}
	return scriptPromise;
}

function getWorker() {
	clearTimeout(idleTimer);
	if (!workerPromise) {
		// Laden + Sprachdaten: im Profiler als ocr.load (Fehler inklusive) sichtbar.
		workerPromise = PERF_PROFILER.run("ocr.load", () => loadTesseract()
			.then((T) => T.createWorker(LANGS, 1, { workerPath: WORKER_PATH, corePath: CORE_PATH })), { runtime: TESSERACT_VERSION }, 0)
			.catch((err) => { workerPromise = null; throw err; });
	}
	return workerPromise;
}

function scheduleIdleStop() {
	clearTimeout(idleTimer);
	idleTimer = setTimeout(() => {
		const current = workerPromise;
		workerPromise = null;
		if (current) current.then((worker) => worker.terminate()).catch(() => {});
	}, IDLE_MS);
}

// src: Data-URL oder Blob. Ergebnis: { text, confidence }; text ist "" bei unsicherer Erkennung.
export function recognize(src) {
	const run = async () => {
		const worker = await getWorker();
		const finish = PERF_PROFILER.start("ocr.recognize", { runtime: TESSERACT_VERSION }, 0);
		let data;
		try { ({ data } = await worker.recognize(src)); }
		catch (err) { finish({ failed: true, errorName: err?.name || "Error", errorMessage: err?.message || String(err) }); throw err; }
		const confidence = Number(data && data.confidence) || 0;
		const text = cleanOcrText(data && data.text);
		finish({ confidence: Math.round(confidence), chars: text.length });
		if (confidence < MIN_CONFIDENCE || text.length < MIN_CHARS) return { text: "", confidence };
		return { text, confidence };
	};
	const job = queue.then(run);
	queue = job.catch(() => {});
	return job.finally(scheduleIdleStop);
}

export const SCAN_OCR = { recognize };
