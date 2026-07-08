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

	function chunk(text, size = 800) {
		const parts = [];
		const paras = String(text || "").split(/\n\n+/);
		let cur = "";
		for (const p of paras) {
			if ((cur + "\n\n" + p).length > size && cur) { parts.push(cur); cur = p; }
			else cur = cur ? cur + "\n\n" + p : p;
		}
		if (cur.trim()) parts.push(cur);
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
		await DB.putVec(pageId, {
			updated: pg.updated,
			chunks: chunks.map((text, i) => ({ text, vec: vecs[i] })),
		});
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
	async function reindexStale() {
		if (!enabled()) return;
		const vecs = await DB.allVecs();
		for (const pg of STATE.activePages()) {
			const v = vecs[pg.id];
			if (!v || v.updated !== pg.updated) queuePage(pg.id);
		}
	}

	const cosine = (a, b) => {
		let dot = 0, na = 0, nb = 0;
		for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
		return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
	};

	async function search(query, k = 5) {
		if (!enabled()) return null; // Aufrufer fällt auf Stichwortsuche zurück
		const [qv] = await AI.embed([query]);
		const vecs = await DB.allVecs();
		const hits = [];
		for (const [pageId, rec] of Object.entries(vecs)) {
			const pg = S.pages[pageId];
			if (!pg || pg.trashed) continue; // Papierkorb-Seiten nicht in Suchergebnissen
			for (const c of rec.chunks) {
				hits.push({ title: pg.title, snippet: c.text.slice(0, 300), score: cosine(qv, c.vec) });
			}
		}
		hits.sort((a, b) => b.score - a.score);
		return hits.slice(0, k);
	}

	return { queuePage, reindexStale, search, indexPage, enabled };
})();