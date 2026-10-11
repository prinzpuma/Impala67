"use strict";

// web/heft-index-progress.js — Fortschritt der Handschrift-Analyse (heft-indexer.js) für die Einstellungen.
// Eigenes kleines Modul, damit die Einstellungen den großen Indexer (und das Heft) nicht importieren müssen.

let current = null; // { done, total, running }

export const HEFT_INDEX_PROGRESS = {
	get: () => current,
	set(next) {
		current = next;
		if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("impala67:heft-index-progress", { detail: next }));
	},
	label(p = current) {
		if (!p) return "Handschrift-Analyse startet …";
		if (!p.total) return "Noch keine Handschrift in Heften";
		// Abrunden: 100 % erst, wenn wirklich alle Seiten erkannt sind
		const pct = Math.floor((p.done / p.total) * 100);
		return `${pct} % der Handschrift analysiert (${p.done} von ${p.total} Seiten)` + (p.running && p.done < p.total ? " · läuft …" : "");
	},
};
