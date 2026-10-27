// JS-Vergleich zu core/impala-search/examples/bench.rs (gleiche Eingaben, gleicher Zufall):
// Vektorsuche (Skalarprodukt wie rag-ranking.js + Sortierung), rankRag, Unscharf-Suche.
// node core/tools/bench-search.mjs
import { dot, norm, rankRag } from "../../web/rag-ranking.js";
import { createFuzzyIndex } from "../../web/search-fuzzy.js";

function rng(seed) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const SYL = ["ka", "lo", "mi", "ne", "ru", "sa", "te", "vo", "zu", "ber", "chen", "dor", "fel", "gru", "hal", "ion", "kraft", "licht", "mat", "phy"];
const pick = (r, n) => Math.floor(r() * n);
const word = (r) => Array.from({ length: 2 + pick(r, 3) }, () => SYL[pick(r, SYL.length)]).join("");
const text = (r, n) => Array.from({ length: n }, () => word(r)).join(" ");
const median = (fn, runs) => {
	fn();
	const ms = Array.from({ length: runs }, () => { const t = performance.now(); fn(); return performance.now() - t; });
	return ms.sort((a, b) => a - b)[Math.floor(runs / 2)];
};

const n = 20000, dim = 384, k = 10;
let r = rng(42);
const matrix = new Float32Array(n * dim);
for (let i = 0; i < matrix.length; i++) matrix[i] = r() - 0.5;
const query = Float32Array.from({ length: dim }, () => r() - 0.5);
const rows = Array.from({ length: n }, (_, i) => matrix.subarray(i * dim, (i + 1) * dim));
const norms = rows.map(norm);
let best;
const vec = median(() => {
	const qn = norm(query);
	best = rows.map((row, i) => ({ i, s: dot(query, row) / (qn * norms[i]) })).sort((a, b) => b.s - a.s).slice(0, k);
}, 9);
console.log(`Vektorsuche ${n} × ${dim}, Top-${k}: ${vec.toFixed(2)} ms (bester Zeilenindex ${best[0].i})`);

const vecs = {}, pages = {};
for (let p = 0; p < n / 10; p++) {
	const chunks = Array.from({ length: 10 }, (_, c) => ({ text: text(r, 40), vec: rows[p * 10 + c] }));
	pages["p" + p] = { title: text(r, 2), trashed: false, archived: false };
	vecs["p" + p] = { model: "m", providerId: "local", chunks };
}
const q = word(r) + " " + word(r);
let hits;
const rank = median(() => { hits = rankRag({ query: q, qv: query, vecs, pages, model: "m", providerId: "local", k: 6 }); }, 9);
console.log(`RAG-Ranking ${n} Chunks: Anfrage ${rank.toFixed(2)} ms (Treffer ${hits[0].pageId})`);

r = rng(7);
const docs = Array.from({ length: 2000 }, (_, i) => ["s" + i, text(r, 150)]);
const queries = Array.from({ length: 10 }, () => { const w = word(r); const at = Math.floor(w.length / 2); return w.slice(0, at) + "x" + w.slice(at); });
let ix;
const build = median(() => { ix = createFuzzyIndex(); for (const [id, t] of docs) ix.setPage(id, t); }, 3);
let found = 0;
const search = median(() => { found = 0; for (const qq of queries) found += ix.search(qq, () => true).length; }, 5) / queries.length;
console.log(`Unscharf-Suche 2000 Seiten: Aufbau ${build.toFixed(1)} ms, Anfrage ${search.toFixed(2)} ms (${found} Treffer gesamt)`);
