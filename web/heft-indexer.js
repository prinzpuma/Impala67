"use strict";

import { S, STATE } from "./state.js";
import { HANDSCHRIFT } from "./handschrift.js";
import { HEFT } from "./heft.js";
import { RAG } from "./rag.js";
import { HANDWRITING_MODEL_VERSION } from "./handwriting-model-version.js";

// heft-indexer.js — Automatischer, akkuschonender Hintergrund-Crawler für Handschrift-Hefte.
//
// Aufgabe:
//   Durchsucht beim App-Start den Bestand. Jede Seite mit Strichen, die noch keinen
//   ocrText hat, wird nacheinander in Idle-Phasen durch die lokale Vektor-Handschrifterkennung
//   analysiert, gespeichert, synchronisiert und ins RAG übergeben.
//   Nach einem Modellwechsel (HANDWRITING_MODEL_VERSION) werden einmalig ALLE Seiten neu
//   erkannt, damit alte Notizen vom besseren Modell profitieren.
//   Läuft im Hintergrund und pausiert sofort, wenn der Nutzer aktiv schreibt.

export const HEFT_INDEXER = (() => {
	let scanRunning = false;
	let scanTimer = null;
	// In dieser Sitzung schon geprüfte Seiten. Neue Striche ändern den Schlüssel,
	// dann wird die Seite erneut geprüft.
	const checked = new Set();
	const checkKey = (pageId, pg) => `${pageId}:${pg.id}:${pg.strokes.length}`;

	// Pro Gerät gemerkt: Mit welcher Modellversion wurde der Bestand zuletzt komplett erkannt?
	const MODEL_KEY = "impala67_heft_index_model";
	// Die Lesung hängt auch an der Erkennungslogik: Bei einer Änderung dort (ohne neues Modell)
	// RECOGNIZER_REVISION erhöhen, damit alle Seiten einmal neu erkannt werden.
	const RECOGNIZER_REVISION = 5; // 5: unsichere Zeilen liefern Text; 4: Beam-Search mit Wörterbuch; 3: robuste Zeilentrennung mit Skizzen-Filter
	const INDEX_VERSION = `${HANDWRITING_MODEL_VERSION}+r${RECOGNIZER_REVISION}`;
	const readIndexedModel = () => { try { return localStorage.getItem(MODEL_KEY); } catch { return null; } };
	const writeIndexedModel = () => { try { localStorage.setItem(MODEL_KEY, INDEX_VERSION); } catch {} };
	let reindexAll = false;
	let hadFailure = false; // z. B. offline, Modell noch nicht geladen: Durchlauf gilt dann nicht als erledigt

	// Findet alle noch nicht analysierten Seiten mit echten Strichen (nach Modellwechsel: alle)
	function findUnindexedPages() {
		const jobs = [];
		const heftDocs = S.heftDocs || {};
		for (const [pageId, doc] of Object.entries(heftDocs)) {
			if (!doc || !Array.isArray(doc.pages)) continue;
			for (let idx = 0; idx < doc.pages.length; idx++) {
				const pg = doc.pages[idx];
				if (!pg || !Array.isArray(pg.strokes) || !pg.strokes.length || checked.has(checkKey(pageId, pg))) continue;
				if (reindexAll || !String(pg.ocrText || "").trim()) {
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
			// Erst nach einem vollständigen Durchlauf merken; bricht die App vorher ab, geht es beim nächsten Start weiter
			if (reindexAll && !hadFailure) writeIndexedModel();
			reindexAll = false;
			scanRunning = false;
			return;
		}

		const job = unindexed[0];
		checked.add(checkKey(job.pageId, job.page));
		try {
			let text = null;
			if (Array.isArray(job.page.strokes) && job.page.strokes.length > 0) {
				try {
					text = await HANDSCHRIFT.recognizeStrokes(job.page.strokes);
				} catch (err) {
					hadFailure = true;
					console.info("[heft-indexer] Stricherkennung Fehler:", err);
				}
			}
			// Nur bei geändertem Ergebnis schreiben (Neuerkennung erzeugt sonst unnötige Sync-Ereignisse).
			// Ein leeres Ergebnis ersetzt keinen vorhandenen Text: sicherer bei reinen Skizzen mit Beschriftung.
			if (text != null && String(text).trim() && String(text).trim() !== String(job.page.ocrText || "").trim()) {
					const recognized = String(text).trim();
					job.page.ocrText = recognized;
					await STATE.dispatch("heftOps", {
						pageId: job.pageId,
						ops: [{ t: "ocr", p: job.page.id, text: recognized }],
					});
					try { RAG.queuePage(job.pageId); } catch {}
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
		reindexAll = readIndexedModel() !== INDEX_VERSION;
		hadFailure = false;
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
	};
})();
