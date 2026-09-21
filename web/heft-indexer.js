"use strict";

import { S, STATE } from "./state.js";
import { HANDSCHRIFT } from "./handschrift.js";
import { HEFT } from "./heft.js";
import { RAG } from "./rag.js";

// heft-indexer.js — Automatischer, akkuschonender Hintergrund-Crawler für Handschrift-Hefte.
//
// Aufgabe:
//   Durchsucht beim App-Start und bei neuen Heften den Bestand. Jede Seite mit
//   Strichen, die noch keinen ocrText hat, wird nacheinander in Idle-Phasen durch
//   ML Kit (oder lokalen Fallback) analysiert, gespeichert, synchronisiert und ins RAG übergeben.
//   Läuft genau EINMAL im Hintergrund und pausiert sofort, wenn der Nutzer aktiv schreibt.

export const HEFT_INDEXER = (() => {
	let scanRunning = false;
	let scanTimer = null;

	// Findet alle noch nicht per OCR analysierten Seiten mit echten Strichen
	function findUnindexedPages() {
		const jobs = [];
		const heftDocs = S.heftDocs || {};
		for (const [pageId, doc] of Object.entries(heftDocs)) {
			if (!doc || !Array.isArray(doc.pages)) continue;
			for (let idx = 0; idx < doc.pages.length; idx++) {
				const pg = doc.pages[idx];
				// Seite hat Striche, aber noch keinen erkannten Text
				if (pg && Array.isArray(pg.strokes) && pg.strokes.length > 0 && (!pg.ocrText || !String(pg.ocrText).trim())) {
					jobs.push({ pageId, pageIdx: idx, page: pg });
				}
			}
		}
		return jobs;
	}

	async function processNextBatch() {
		if (!scanRunning) return;

		// Wenn der Nutzer gerade im Heft zeichnet oder schreibt: pausieren und später fortsetzen
		if (HEFT.isWriting && HEFT.isWriting()) {
			scanTimer = setTimeout(processNextBatch, 5000);
			return;
		}

		const unindexed = findUnindexedPages();
		if (!unindexed.length) {
			scanRunning = false;
			return;
		}

		const job = unindexed[0];
		try {
			const cv = await HEFT.pageCanvas(job.pageId, job.pageIdx, 1100);
			if (cv) {
				const text = await HANDSCHRIFT.recognize(cv);
				if (text != null && String(text).trim()) {
					const recognized = String(text).trim();
					job.page.ocrText = recognized;
					await STATE.dispatch("heftOps", {
						pageId: job.pageId,
						ops: [{ t: "ocr", p: job.page.id, text: recognized }],
					});
					try { RAG.queuePage(job.pageId); } catch {}
				} else {
					// Markieren, damit nicht unendlich wiederholt wird (z. B. reine Skizze ohne Text)
					job.page.ocrText = " ";
					await STATE.dispatch("heftOps", {
						pageId: job.pageId,
						ops: [{ t: "ocr", p: job.page.id, text: " " }],
					});
				}
			}
		} catch (err) {
			console.warn("[heft-indexer] Seite konnte nicht analysiert werden:", err);
		}

		// Nach jedem Durchlauf kurz an den Browser abgeben (2 s Schonpause, schont Akku & CPU)
		if (scanRunning) {
			scanTimer = setTimeout(processNextBatch, 2000);
		}
	}

	function startBackgroundScan() {
		if (scanRunning) return;
		scanRunning = true;
		clearTimeout(scanTimer);
		// Startet 2 Sekunden nach Aufruf, damit der initiale Renderzyklus frei bleibt
		scanTimer = setTimeout(processNextBatch, 2000);
	}

	function stop() {
		scanRunning = false;
		clearTimeout(scanTimer);
	}

	return {
		startBackgroundScan,
		findUnindexedPages,
		stop,
		get isRunning() { return scanRunning; },
	};
})();
