"use strict";

import { S, STATE } from "./state.js";
import { HANDSCHRIFT } from "./handschrift.js";
import { HEFT } from "./heft.js";
import { RAG } from "./rag.js";
import { HANDWRITING_MODEL_VERSION } from "./handwriting-model-version.js";
import { PAGE_W, PAGE_H, composePageText } from "./heft-document-core.js";
import { SCAN_OCR } from "./scan-ocr.js";
import { HEFT_INDEX_PROGRESS } from "./heft-index-progress.js";
import { BUS } from "./event-bus.js";

// heft-indexer.js — Automatischer, akkuschonender Hintergrund-Crawler für Handschrift-Hefte.
//
// Aufgabe:
//   Durchsucht beim App-Start den Bestand. Jede Seite mit Strichen, die noch keinen
//   ocrText hat, wird nacheinander in Idle-Phasen durch die lokale Vektor-Handschrifterkennung
//   analysiert, gespeichert, synchronisiert und ins RAG übergeben.
//   Gescannte Bilder ohne ocr-Feld (Scan-Flag oder ältere Vollseiten-Scans) werden per
//   Tesseract (scan-ocr.js) erkannt; das Ergebnis steht am Bild (ocr) und fließt über
//   composePageText in den Seitentext.
//   Nach einem Modellwechsel (HANDWRITING_MODEL_VERSION) werden einmalig ALLE Seiten neu
//   erkannt, damit alte Notizen vom besseren Modell profitieren.
//   Läuft im Hintergrund und pausiert sofort, wenn der Nutzer aktiv schreibt.

export const HEFT_INDEXER = (() => {
	let scanRunning = false;
	let scanTimer = null;
	// In dieser Sitzung schon geprüfte Aufgaben. Neue Striche ändern den Schlüssel,
	// dann wird die Seite erneut geprüft.
	const checked = new Set();
	const checkKey = (pageId, pg) => `${pageId}:${pg.id}:${pg.strokes.length}`;
	const scanKey = (pageId, pg, im) => `${pageId}:${pg.id}:img:${im.id}`;

	// Priorisierte Aufgaben: Seiten, auf denen der Nutzer gerade gezeichnet hat
	const priorityQueue = new Map();
	let priorityTimer = null;
	let busy = false;

	const runWhenIdle = (fn) => {
		if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
			return window.requestIdleCallback(fn, { timeout: 10000 });
		}
		return setTimeout(fn, 0);
	};

	// Pro Gerät gemerkt: Mit welcher Modellversion wurde der Bestand zuletzt komplett erkannt?
	const MODEL_KEY = "impala67_heft_index_model";
	// Die Lesung hängt auch an der Erkennungslogik: Bei einer Änderung dort (ohne neues Modell)
	// RECOGNIZER_REVISION erhöhen, damit alle Seiten einmal neu erkannt werden.
	const RECOGNIZER_REVISION = 6; // 6: Bild-Modell (Zeile als Bild statt Punktfolge); 5: unsichere Zeilen liefern Text; 4: Beam-Search mit Wörterbuch; 3: robuste Zeilentrennung mit Skizzen-Filter
	const INDEX_VERSION = `${HANDWRITING_MODEL_VERSION}+r${RECOGNIZER_REVISION}`;
	const readIndexedModel = () => { try { return localStorage.getItem(MODEL_KEY); } catch { return null; } };
	const writeIndexedModel = () => { try { localStorage.setItem(MODEL_KEY, INDEX_VERSION); } catch {} };
	// Pro Gerät: Seiten (checkKey), die mit INDEX_VERSION erkannt sind. Ergibt den Fortschritt und lässt eine
	// Neu-Erkennung nach einem Neustart weiterlaufen, statt von vorn zu beginnen.
	const DONE_KEY = "impala67_heft_index_done";
	const done = (() => {
		try {
			const saved = JSON.parse(localStorage.getItem(DONE_KEY) || "null");
			if (saved && saved.version === INDEX_VERSION && Array.isArray(saved.keys)) return new Set(saved.keys);
		} catch {}
		return new Set();
	})();
	const saveDone = () => { try { localStorage.setItem(DONE_KEY, JSON.stringify({ version: INDEX_VERSION, keys: [...done] })); } catch {} };
	let reindexAll = false;
	let hadFailure = false; // z. B. offline, Modell noch nicht geladen: Durchlauf gilt dann nicht als erledigt

	// Ein Bild ist eine offene Scan-Aufgabe, wenn es noch kein ocr-Feld hat und entweder
	// als Scan markiert ist oder als älterer Vollseiten-Scan gilt.
	const EDGE_PX = 1;
	const fillsPage = (im) => (im.x <= EDGE_PX && PAGE_W - (im.x + im.w) <= EDGE_PX) || (im.y <= EDGE_PX && PAGE_H - (im.y + im.h) <= EDGE_PX);
	function isPendingScan(pg, im) {
		if (!im || !im.ref || im.ocr !== undefined) return false;
		if (im.scan === true) return true;
		// Ältere Scans ohne Flag: einziges Bild einer strichlosen Seite, das die Seite ausfüllt.
		return !(pg.strokes && pg.strokes.length) && pg.images.length === 1 && fillsPage(im);
	}

	// Findet alle offenen Aufgaben: Stricherkennung (nach Modellwechsel: alle) und Scan-Bilder
	// Nebenbei: Fortschritt (Seiten mit Strichen gesamt / davon erledigt) und alle aktuellen Seiten-Schlüssel
	function findUnindexedPages() {
		const jobs = [];
		const heftDocs = S.heftDocs || {};
		let total = 0;
		let doneCount = 0;
		const present = new Set();
		for (const [pageId, doc] of Object.entries(heftDocs)) {
			if (!doc || !Array.isArray(doc.pages)) continue;
			for (let idx = 0; idx < doc.pages.length; idx++) {
				const pg = doc.pages[idx];
				if (!pg) continue;
				if (Array.isArray(pg.strokes) && pg.strokes.length) {
					const key = checkKey(pageId, pg);
					const hasText = !!String(pg.ocrText || "").trim();
					total++;
					present.add(key);
					// Fehlgeschlagene Seiten (checked, aber nicht done) zählen nicht als erledigt
					if (done.has(key) || (!reindexAll && hasText)) doneCount++;
					if (!checked.has(key) && !done.has(key) && (reindexAll || !hasText)) {
						jobs.push({ kind: "strokes", key, pageId, pageIdx: idx, page: pg });
					}
				}
				for (const im of pg.images || []) {
					const key = scanKey(pageId, pg, im);
					if (!checked.has(key) && isPendingScan(pg, im)) {
						jobs.push({ kind: "scan", key, pageId, pageIdx: idx, page: pg, image: im });
					}
				}
			}
		}
		HEFT_INDEX_PROGRESS.set({ done: doneCount, total, running: scanRunning });
		lastPresent = present;
		return jobs;
	}
	let lastPresent = new Set();

	// true = Seite ist erkannt (auch ohne Text, z. B. reine Skizze); false = später erneut versuchen
	async function indexStrokes(job) {
		let text = null;
		try {
			text = await HANDSCHRIFT.recognizeStrokes(job.page.strokes);
		} catch (err) {
			hadFailure = true;
			console.info("[heft-indexer] Stricherkennung Fehler:", err);
		}
		if (text == null) return false;
		done.add(job.key);
		saveDone();
		// Ein leeres Ergebnis ersetzt keinen vorhandenen Text: sicherer bei reinen Skizzen mit Beschriftung.
		const composed = composePageText(text, job.page);
		if (!composed || composed === String(job.page.ocrText || "").trim()) return;
		job.page.ocrText = composed;
		await STATE.dispatch("heftOps", {
			pageId: job.pageId,
			ops: [{ t: "ocr", p: job.page.id, text: composed }],
		});
		try { RAG.queuePage(job.pageId); } catch {}
	}

	async function blobData(ref) {
		if (typeof S.heftBlobs[ref] !== "string") await STATE.hydrateHeftBlobs([ref]);
		return typeof S.heftBlobs[ref] === "string" ? S.heftBlobs[ref] : "";
	}

	// Ein Scan-Bild: Striche der Seite zuerst (ihr Text fließt in den Seitentext), dann das Bild.
	// Fehler (offline, CDN nicht erreichbar) lassen das Bild offen: nächster Start versucht es erneut.
	async function indexScanImage(job) {
		const { pageId, page: pg, image: im } = job;
		try {
			let strokeText = "";
			if (pg.strokes && pg.strokes.length) strokeText = await HANDSCHRIFT.recognizeStrokes(pg.strokes);
			const src = await blobData(im.ref);
			if (!src) return;
			const { text } = await SCAN_OCR.recognize(src);
			const previous = String(pg.ocrText || "").trim();
			im.ocr = text;
			const composed = composePageText(strokeText, pg);
			const ops = [{ t: "i=", p: pg.id, o: im }];
			if (composed && composed !== previous) {
				pg.ocrText = composed;
				ops.push({ t: "ocr", p: pg.id, text: composed });
			}
			await STATE.dispatch("heftOps", { pageId, ops });
			try { RAG.queuePage(pageId); } catch {}
		} catch (err) {
			hadFailure = true;
			console.info("[heft-indexer] Scan-Erkennung übersprungen (offline?):", err);
		}
	}

	function schedulePage(pageId, pg, force = false) {
		if (!pageId || !pg || !Array.isArray(pg.strokes) || !pg.strokes.length) return;
		if (HANDSCHRIFT.available && !HANDSCHRIFT.available()) return;
		const key = checkKey(pageId, pg);
		const isRecentEdit = force || (HEFT.isWriting && HEFT.isWriting());
		if (!isRecentEdit && done.has(key) && String(pg.ocrText || "").trim()) return;
		checked.delete(key);
		done.delete(key);
		priorityQueue.set(`${pageId}:${pg.id}`, {
			kind: "strokes",
			key,
			pageId,
			page: pg,
		});
		clearTimeout(priorityTimer);
		priorityTimer = setTimeout(() => runWhenIdle(processNextBatch), 3500);
	}

	async function processNextBatch() {
		if (busy) return;

		// Wenn der Nutzer gerade im Heft zeichnet oder schreibt: pausieren und später fortsetzen
		if (HEFT.isWriting && HEFT.isWriting()) {
			clearTimeout(scanTimer);
			clearTimeout(priorityTimer);
			const retryDelay = priorityQueue.size ? 3500 : 5000;
			const timerId = setTimeout(() => runWhenIdle(processNextBatch), retryDelay);
			if (priorityQueue.size) priorityTimer = timerId;
			else scanTimer = timerId;
			return;
		}

		// 1. Zuerst priorisierte Aufgaben abarbeiten (Seiten, auf denen gerade gezeichnet wurde)
		if (priorityQueue.size > 0) {
			const [pageKey, job] = priorityQueue.entries().next().value;
			priorityQueue.delete(pageKey);
			busy = true;
			checked.add(job.key);
			try {
				await indexStrokes(job);
			} catch (err) {
				console.warn("[heft-indexer] Priorisierte Seite konnte nicht analysiert werden:", err);
			} finally {
				busy = false;
			}
			if (priorityQueue.size > 0) {
				clearTimeout(priorityTimer);
				priorityTimer = setTimeout(() => runWhenIdle(processNextBatch), 500);
			} else if (scanRunning) {
				clearTimeout(scanTimer);
				scanTimer = setTimeout(() => runWhenIdle(processNextBatch), 2000);
			}
			return;
		}

		// 2. Falls ein Hintergrund-Scan aktiv ist: unindizierten Bestand abarbeiten
		if (!scanRunning) return;

		const unindexed = findUnindexedPages();
		if (!unindexed.length) {
			// Erst nach einem vollständigen Durchlauf merken; bricht die App vorher ab, geht es beim nächsten Start weiter
			if (reindexAll && !hadFailure) writeIndexedModel();
			// Schlüssel gelöschter oder geänderter Seiten verwerfen, damit die Liste nicht wächst
			for (const key of done) if (!lastPresent.has(key)) done.delete(key);
			saveDone();
			reindexAll = false;
			scanRunning = false;
			const p = HEFT_INDEX_PROGRESS.get();
			if (p) HEFT_INDEX_PROGRESS.set({ ...p, running: false });
			return;
		}

		const job = unindexed[0];
		checked.add(job.key);
		busy = true;
		try {
			if (job.kind === "scan") await indexScanImage(job);
			else await indexStrokes(job);
		} catch (err) {
			console.warn("[heft-indexer] Seite konnte nicht analysiert werden:", err);
		} finally {
			busy = false;
		}

		// Nach jedem Durchlauf kurz an den Browser abgeben (2 s Schonpause, schont Akku & CPU)
		if (scanRunning) {
			clearTimeout(scanTimer);
			scanTimer = setTimeout(() => runWhenIdle(processNextBatch), 2000);
		}
	}

	function startBackgroundScan() {
		// Läuft schon: die Schleife holt neue Seiten bei jedem Durchlauf selbst ab.
		if (scanRunning) return;
		scanRunning = true;
		reindexAll = readIndexedModel() !== INDEX_VERSION;
		hadFailure = false;
		clearTimeout(scanTimer);
		// Startet 2 Sekunden nach Aufruf, damit der initiale Renderzyklus frei bleibt
		scanTimer = setTimeout(() => runWhenIdle(processNextBatch), 2000);
	}

	function stop() {
		scanRunning = false;
		clearTimeout(scanTimer);
		clearTimeout(priorityTimer);
		priorityQueue.clear();
	}

	return {
		startBackgroundScan,
		findUnindexedPages,
		schedulePage,
		scheduleCheck: schedulePage,
		stop,
	};
})();

BUS.on("heft:schedule-page", (p) => { if (p && p.pageId) HEFT_INDEXER.schedulePage(p.pageId, p.page); });
BUS.on("heft:start-background-scan", () => HEFT_INDEXER.startBackgroundScan());

