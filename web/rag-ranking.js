"use strict";

// Reine Ranking-Logik fuer RAG. Sie wird im Browser-Worker ausgefuehrt und bleibt
// zugleich als Fallback fuer Browser ohne Worker-Unterstuetzung direkt testbar.
const STOP_WORDS = new Set(["aber", "alle", "auch", "aus", "bei", "das", "dem", "den", "der", "des", "die", "ein", "eine", "einer", "eines", "für", "hat", "ich", "ist", "mit", "nach", "oder", "sich", "sind", "und", "von", "was", "wie", "wird", "zu", "the", "and", "for", "from", "that", "this", "with"]);
const termsOf = (value) => (String(value || "").toLocaleLowerCase("de-DE").match(/[\p{L}\p{N}_-]{2,}/gu) || []).filter((term) => !STOP_WORDS.has(term));
const norm = (v) => { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; return Math.sqrt(s) || 1; };
const dot = (a, b) => { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; };
const exactLexicalMatch = (query, searchable) => {
	if (!query) return false;
	if (query.length >= 4) return searchable.includes(query);
	return termsOf(searchable).includes(query);
};

function lexicalScores(query, docs) {
	const terms = [...new Set(termsOf(query))];
	const scores = new Map();
	if (!terms.length || !docs.length) return scores;
	const tokenDocs = docs.map((doc) => ({ doc, tokens: termsOf(doc.title + "\n" + doc.text) }));
	const avgLen = tokenDocs.reduce((sum, row) => sum + row.tokens.length, 0) / tokenDocs.length || 1;
	const df = new Map(terms.map((term) => [term, tokenDocs.filter((row) => row.tokens.includes(term)).length]));
	const phrase = String(query || "").trim().toLocaleLowerCase("de-DE");
	for (const row of tokenDocs) {
		const counts = new Map();
		row.tokens.forEach((term) => counts.set(term, (counts.get(term) || 0) + 1));
		let score = 0;
		for (const term of terms) {
			const tf = counts.get(term) || 0;
			if (!tf) continue;
			const idf = Math.log(1 + (tokenDocs.length - (df.get(term) || 0) + 0.5) / ((df.get(term) || 0) + 0.5));
			const den = tf + 1.2 * (0.25 + 0.75 * row.tokens.length / avgLen);
			score += idf * tf * 2.2 / den;
			if (String(row.doc.title || "").toLocaleLowerCase("de-DE").includes(term)) score += idf * 0.8;
		}
		if (phrase.length >= 3 && (row.doc.title + "\n" + row.doc.text).toLocaleLowerCase("de-DE").includes(phrase)) score += 2;
		if (score) scores.set(row.doc, score);
	}
	return scores;
}

export function rankRag({ query, qv, vecs, pages, model, providerId, k = 6 }) {
	const qn = norm(qv);
	const docs = [];
	for (const [pageId, rec] of Object.entries(vecs || {})) {
		const pg = pages?.[pageId];
		if (!pg || pg.trashed || rec.model !== model || String(rec.providerId || "") !== String(providerId || "")) continue;
		for (const c of rec.chunks || []) {
			if (!c.vec || c.vec.length !== qv.length) continue;
			const semantic = dot(qv, c.vec) / (qn * (c.norm || norm(c.vec)));
			docs.push({ pageId, title: pg.title, text: c.text, semantic });
		}
	}
	const lexical = lexicalScores(query, docs);
	const maxLexical = Math.max(0, ...lexical.values());
	const exactQuery = String(query || "").trim().toLocaleLowerCase("de-DE");
	const hits = docs.map((doc) => {
		const semantic = Math.max(0, doc.semantic || 0);
		const lex = maxLexical ? (lexical.get(doc) || 0) / maxLexical : 0;
		const title = String(doc.title || "").trim().toLocaleLowerCase("de-DE");
		const searchable = (doc.title + "\n" + doc.text).toLocaleLowerCase("de-DE");
		const exactFloor = exactQuery && title === exactQuery ? 0.8 : exactLexicalMatch(exactQuery, searchable) ? 0.7 : 0;
		const score = Math.max(semantic + (1 - semantic) * 0.45 * lex, exactFloor);
		return { title: doc.title, snippet: doc.text.slice(0, 400), score, semanticScore: doc.semantic, lexicalScore: lex, pageId: doc.pageId };
	});
	hits.sort((a, b) => b.score - a.score);
	const perPage = Object.create(null), out = [];
	for (const h of hits) {
		if ((perPage[h.pageId] || 0) >= 2) continue;
		perPage[h.pageId] = (perPage[h.pageId] || 0) + 1;
		out.push({ title: h.title, snippet: h.snippet, score: Math.round(h.score * 1000) / 1000, semanticScore: Math.round(h.semanticScore * 1000) / 1000, lexicalScore: Math.round(h.lexicalScore * 1000) / 1000 });
		if (out.length >= k) break;
	}
	return out;
}
