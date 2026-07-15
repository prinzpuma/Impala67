"use strict";
import { S, STATE } from "./state.js";
import { DB } from "./db.js";
import { U } from "./util.js";
import { AI } from "./ai.js";
import { PDFS } from "./pdfs.js";
// rag.js — Semantische Suche (RAG): Notizen werden in Chunks zerlegt, als
// Embeddings in IndexedDB gespeichert und per Kosinus-Ähnlichkeit durchsucht.
// Benötigt ein Embedding-Modell in ⚙️ (Gemini: gemini-embedding-001,
// OpenAI: text-embedding-3-small, oder ein LM-Studio-Embedding-Modell).
export const RAG = (() => {
	const queue = new Set();
	let timer = null;

	const enabled = () => !!S.settings.embedModel;

	// Chunking v2 (15. Juli): Überschriften beginnen neue Chunks (thematisch
	// saubere Treffer) und benachbarte Chunks überlappen sich leicht — Antworten,
	// die genau auf einer Chunk-Grenze liegen, gehen nicht mehr verloren.
	function chunk(text, size = 800, overlap = 120) {
		const parts = [];
		const paras = String(text || "").split(/\n\n+/);
		let cur = "";
		const push = () => { if (cur.trim()) parts.push(cur); };
		for (const p of paras) {
			const isHeading = /^#{1,3}\s/.test(p);
			if (cur && (isHeading || (cur + "\n\n" + p).length > size)) {
				push();
				// Überlappung: das Ende des letzten Chunks leitet den nächsten ein.
				cur = (overlap ? cur.slice(-overlap) + "\n\n" : "") + p;
			} else cur = cur ? cur + "\n\n" + p : p;
		}
		push();
		return parts.slice(0, 80); // großzügiger, damit auch PDF-Volltext hineinpasst
	}

	async function indexPage(pageId) {
		if (!enabled()) return;
		const pg = S.pages[pageId];
		// Gelöschte (Papierkorb-)Seiten aus dem Index entfernen statt sie zu indexieren
		if (!pg || pg.trashed) { await DB.delVec(pageId); return; }
		let text = pg.title + "\n\n" + pg.content;
		// PDF-Volltext mitindexieren: der bei der Aufnahme extrahierte Text liegt als
		// eigener Blob ("pdftext:<id>") in IndexedDB; ältere PDFs werden einmalig nachextrahiert.
		if (pg.pdfId) {
			try {
				let rec = await DB.getBlob("pdftext:" + pg.pdfId);
				if (!rec) {
					const pdf = await DB.getBlob(pg.pdfId);
					if (pdf && window.pdfjsLib) {
						const ex = await PDFS.extractText(pdf.buf.slice(0));
						await DB.putBlob("pdftext:" + pg.pdfId, new TextEncoder().encode(ex.text).buffer, { type: "text/plain" });
						rec = await DB.getBlob("pdftext:" + pg.pdfId);
					}
				}
				if (rec && rec.buf) text += "\n\n" + new TextDecoder().decode(rec.buf).slice(0, 60000);
			} catch (e) { console.warn("PDF-Volltext für RAG fehlgeschlagen:", e); }
		}
		const chunks = chunk(text);
		if (!chunks.length) { await DB.delVec(pageId); return; }
		const vecs = await AI.embed(chunks);
		// Unvollständige Embedding-Antworten verwerfen statt einen halben Index zu
		// speichern — queuePage fängt den Fehler und die Seite bleibt „stale“.
		if (!Array.isArray(vecs) || vecs.length !== chunks.length || vecs.some((v) => !v || !v.length)) {
			throw new Error("Embedding unvollständig für Seite " + pageId);
		}
		// Normen einmalig beim Indexieren vorberechnen — die Suche spart sich damit
		// pro Chunk eine komplette Betrags-Berechnung (spürbar bei vielen Seiten).
		// model wird mitgespeichert: reindexStale() erkennt daran einen Modellwechsel.
		await DB.putVec(pageId, {
			updated: pg.updated,
			model: S.settings.embedModel,
			chunks: chunks.map((text, i) => ({ text, vec: vecs[i], norm: norm(vecs[i]) })),
		});
		vecCache = null; // Suche lädt beim nächsten Mal frisch
	}

	// Debounced-Warteschlange — wird nach Edits/Ingest aus app.js & pdfs.js befüllt.
	function queuePage(pageId) {
		if (!enabled()) return;
		queue.add(pageId);
		clearTimeout(timer);
		timer = setTimeout(async () => {
			const ids = [...queue];
			queue.clear();
			for (const id of ids) {
				try { await indexPage(id); } catch (e) { console.warn("RAG-Index fehlgeschlagen:", e); }
			}
		}, 2500);
	}

	// Fehlende/veraltete Seiten nachindexieren (beim Start und nach ⚙️-Änderung).
	// Modellwechsel-Fix (15. Juli, später): Vorher wurde nur der Seitenstand
	// verglichen — nach einem Wechsel des Embedding-Modells blieben ALLE Vektoren
	// alt, und die Suche fand still nichts mehr (andere Dimension) oder lieferte
	// falsche Scores (gleiche Dimension, inkompatibler Vektorraum). Jetzt wird
	// jeder Eintrag neu indexiert, dessen model nicht zum aktuellen Modell passt
	// (Alt-Einträge ohne model-Feld werden dabei einmalig migriert).
	async function reindexStale() {
		if (!enabled()) return;
		const vecs = await DB.allVecs();
		const model = S.settings.embedModel;
		for (const pg of STATE.activePages()) {
			const v = vecs[pg.id];
			if (!v || v.updated !== pg.updated || v.model !== model) queuePage(pg.id);
		}
	}

	const norm = (v) => { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; return Math.sqrt(s) || 1; };
	const dot = (a, b) => { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; };

	// Suche v2 (15. Juli):
	// - Vektoren werden im Speicher gecacht (IndexedDB-Volllast nur noch alle 30 s
	//   bzw. nach eigenem Re-Index) statt bei JEDER Suche.
	// - Query-Embeddings der letzten 20 Fragen werden wiederverwendet (Auto-RAG in
	//   ai.js stellt oft ähnliche/identische Fragen erneut).
	// - Vorberechnete Normen + reines Skalarprodukt statt kompletter Kosinus-Formel.
	// - Max. 2 Treffer pro Seite: k Ergebnisse decken mehrere Seiten ab, statt dass
	//   eine einzige lange Seite alle Plätze belegt.
	// - Chunks mit fremder Embedding-Dimension (Modellwechsel) werden übersprungen
	//   statt falsche Scores zu liefern; reindexStale() ersetzt sie ohnehin.
	let vecCache = null, vecCacheAt = 0;
	const queryCache = new Map();
	async function allVecsCached() {
		if (!vecCache || Date.now() - vecCacheAt > 30000) {
			vecCache = await DB.allVecs();
			vecCacheAt = Date.now();
		}
		return vecCache;
	}
	async function queryVec(query) {
		const key = String(query || "").trim().toLowerCase() + "::" + (S.settings.embedModel || "");
		if (queryCache.has(key)) return queryCache.get(key);
		const [qv] = await AI.embed([query]);
		queryCache.set(key, qv);
		if (queryCache.size > 20) queryCache.delete(queryCache.keys().next().value);
		return qv;
	}
	async function search(query, k = 6) {
		if (!enabled()) return null; // Aufrufer fällt auf Stichwortsuche zurück
		const qv = await queryVec(query);
		const qn = norm(qv);
		const vecs = await allVecsCached();
		const hits = [];
		for (const [pageId, rec] of Object.entries(vecs)) {
			const pg = S.pages[pageId];
			if (!pg || pg.trashed) continue; // Papierkorb-Seiten nicht in Suchergebnissen
			if (rec.model && rec.model !== S.settings.embedModel) continue; // alter Index nach Modellwechsel — reindexStale() baut ihn neu
			for (const c of rec.chunks) {
				if (!c.vec || c.vec.length !== qv.length) continue; // anderes Embedding-Modell
				const score = dot(qv, c.vec) / (qn * (c.norm || norm(c.vec)));
				hits.push({ pageId, title: pg.title, snippet: c.text.slice(0, 400), score });
			}
		}
		hits.sort((a, b) => b.score - a.score);
		const perPage = Object.create(null);
		const out = [];
		for (const h of hits) {
			if ((perPage[h.pageId] || 0) >= 2) continue;
			perPage[h.pageId] = (perPage[h.pageId] || 0) + 1;
			out.push({ title: h.title, snippet: h.snippet, score: Math.round(h.score * 1000) / 1000 });
			if (out.length >= k) break;
		}
		return out;
	}

	return { queuePage, reindexStale, search, indexPage, enabled };
})();