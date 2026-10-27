"use strict";

// RAG-Ranking über den Rust-Kern (core/impala-search): Der Index (Chunk-Vektoren, -Texte,
// Wortzählungen) wird einmal gebaut und bleibt im Kern; jede Anfrage übergibt nur den
// Abfragevektor. Läuft im RAG-Worker und, ohne Worker, im Hauptthread.
import { CORE } from "./rust-core.js";

// \0 trennt die Listen an der Kern-Grenze.
const clean = (s) => String(s || "").replaceAll("\0", "");

// Index aus den IndexedDB-Vektoren (`vecs`: pageId → { model, providerId, chunks }) einer Herkunft.
export function buildRagIndex(vecs, model, providerId) {
	const ids = [], counts = [], texts = [], rows = [];
	let dim = 0;
	for (const [pageId, rec] of Object.entries(vecs || {})) {
		if (!rec || rec.model !== model || String(rec.providerId || "") !== String(providerId || "")) continue;
		let n = 0;
		for (const c of rec.chunks || []) {
			const text = clean(c?.text);
			if (!text || !c.vec?.length || (dim && c.vec.length !== dim)) continue;
			dim ||= c.vec.length;
			rows.push(c.vec); texts.push(text); n++;
		}
		if (n) { ids.push(clean(pageId)); counts.push(n); }
	}
	const matrix = new Float32Array(rows.length * dim);
	rows.forEach((v, i) => matrix.set(v, i * dim));
	return { index: new CORE.RagIndex(ids.join("\0"), Uint32Array.from(counts), texts.join("\0"), matrix, dim || 1), ids };
}

// Seitenangaben (Titel, Papierkorb, Archiv) zur Anfragezeit in Index-Reihenfolge setzen.
function setPages(built, pages) {
	const titles = [], flags = new Uint8Array(built.ids.length);
	built.ids.forEach((id, i) => {
		const pg = pages?.[id];
		titles.push(clean(pg?.title));
		flags[i] = !pg || pg.trashed ? 1 : pg.archived ? 2 : 0;
	});
	built.index.setPages(titles.join("\0"), flags);
}

// Hybrid-Treffer (Vektor + BM25 + exakter Treffer), höchstens 2 je Seite.
export function rankRag(built, { query, qv, pages, k = 6 }) {
	setPages(built, pages);
	return JSON.parse(built.index.rank(String(query || ""), Float32Array.from(qv || []), k));
}

// Inhaltlich ähnliche Seiten (ohne Papierkorb/Archiv): [{ id, score }].
export function relatedPages(built, pages, pageId, k = 3) {
	setPages(built, pages);
	return JSON.parse(built.index.related(String(pageId), k));
}
