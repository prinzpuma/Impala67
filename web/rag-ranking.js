"use strict";

// Reine Ranking-Logik fuer RAG. Sie wird im Browser-Worker ausgefuehrt und bleibt
// zugleich als Fallback fuer Browser ohne Worker-Unterstuetzung direkt testbar.
const STOP_WORDS = new Set(["aber", "alle", "auch", "aus", "bei", "das", "dem", "den", "der", "des", "die", "ein", "eine", "einer", "eines", "für", "hat", "ich", "ist", "mit", "nach", "oder", "sich", "sind", "und", "von", "was", "wie", "wird", "zu", "the", "and", "for", "from", "that", "this", "with"]);
const lower = (value) => String(value || "").toLocaleLowerCase("de-DE");
// Erwartet bereits klein geschriebenen Text (jeder Chunk wird nur einmal umgewandelt).
const termsOf = (lc) => (lc.match(/[\p{L}\p{N}_-]{2,}/gu) || []).filter((term) => !STOP_WORDS.has(term));
export const norm = (v) => { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; return Math.sqrt(s) || 1; };
export const dot = (a, b) => { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; };

// query ist getrimmt und klein geschrieben. Legt doc.counts (Term → Häufigkeit) an,
// das rankRag für den exakten Kurzwort-Treffer wiederverwendet.
function lexicalScores(query, docs) {
	const terms = [...new Set(termsOf(query))];
	const scores = new Map();
	if (!terms.length || !docs.length) return scores;
	let totalLen = 0;
	for (const doc of docs) {
		const tokens = termsOf(doc.searchable);
		doc.counts = new Map();
		for (const term of tokens) doc.counts.set(term, (doc.counts.get(term) || 0) + 1);
		doc.len = tokens.length;
		totalLen += tokens.length;
	}
	const avgLen = totalLen / docs.length || 1;
	const idf = new Map(terms.map((term) => {
		const df = docs.filter((doc) => doc.counts.has(term)).length;
		return [term, Math.log(1 + (docs.length - df + 0.5) / (df + 0.5))];
	}));
	for (const doc of docs) {
		let score = 0;
		for (const term of terms) {
			const tf = doc.counts.get(term);
			if (!tf) continue;
			const w = idf.get(term);
			const den = tf + 1.2 * (0.25 + 0.75 * doc.len / avgLen);
			score += w * tf * 2.2 / den;
			if (doc.titleLc.includes(term)) score += w * 0.8;
		}
		if (query.length >= 3 && doc.searchable.includes(query)) score += 2;
		if (score) scores.set(doc, score);
	}
	return scores;
}

export function rankRag({ query, qv, vecs, pages, model, providerId, k = 6 }) {
	const qn = norm(qv);
	const docs = [];
	for (const [pageId, rec] of Object.entries(vecs || {})) {
		const pg = pages?.[pageId];
		if (!pg || pg.trashed || rec.model !== model || String(rec.providerId || "") !== String(providerId || "")) continue;
		const titleLc = lower(pg.title);
		for (const c of rec.chunks || []) {
			if (!c.vec || c.vec.length !== qv.length) continue;
			const semantic = dot(qv, c.vec) / (qn * (c.norm || norm(c.vec)));
			docs.push({ pageId, title: pg.title, text: c.text, semantic, archived: !!pg.archived, titleLc, searchable: lower(pg.title + "\n" + c.text) });
		}
	}
	const exactQuery = lower(query).trim();
	const lexical = lexicalScores(exactQuery, docs);
	const maxLexical = Math.max(0, ...lexical.values());
	const hits = docs.map((doc) => {
		const semantic = Math.max(0, doc.semantic || 0);
		const lex = maxLexical ? (lexical.get(doc) || 0) / maxLexical : 0;
		// Kurze Anfragen (< 4 Zeichen) zählen nur als ganzes Wort, sonst als Teilstring.
		const exactMatch = exactQuery && (exactQuery.length >= 4 ? doc.searchable.includes(exactQuery) : !!doc.counts?.has(exactQuery));
		const exactFloor = exactQuery && doc.titleLc.trim() === exactQuery ? 0.8 : exactMatch ? 0.7 : 0;
		const score = Math.max(semantic + (1 - semantic) * 0.45 * lex, exactFloor);
		return { title: doc.title, snippet: doc.text.slice(0, 400), score, semanticScore: doc.semantic, lexicalScore: lex, pageId: doc.pageId, archived: doc.archived };
	});
	hits.sort((a, b) => b.score - a.score);
	const perPage = Object.create(null), out = [];
	for (const h of hits) {
		if ((perPage[h.pageId] || 0) >= 2) continue;
		perPage[h.pageId] = (perPage[h.pageId] || 0) + 1;
		out.push({ pageId: h.pageId, title: h.title, snippet: h.snippet, score: Math.round(h.score * 1000) / 1000, semanticScore: Math.round(h.semanticScore * 1000) / 1000, lexicalScore: Math.round(h.lexicalScore * 1000) / 1000, archived: !!h.archived });
		if (out.length >= k) break;
	}
	return out;
}
