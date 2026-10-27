// Misst, wo der Rust-Kern als WASM in der PWA schneller wäre als das JS-Original: Vektorsuche und
// RAG-Ranking. Ohne Binding, weil gemessen und verworfen (Zahlen in docs/NATIV-PLAN.md): Markdown
// (langsamer, Blöcke müssen als JSON über die Grenze) und Heft-Geometrie (schneller, aber nur
// Bruchteile einer Millisekunde je Ereignis bei doppeltem Zustand). Prüft vorher, dass beide dasselbe liefern. JS und WASM
// laufen abwechselnd im selben Prozess (gleiche Last für beide), Median nach Aufwärmen.
//   node core/tools/build.mjs && node core/tools/bench-wasm.mjs [WASM-Ordner, Standard core/target/wasm]
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { dot, norm, rankRag } from "../../web/rag-ranking.js";


const dir = path.resolve(process.argv[2] || new URL("../target/wasm", import.meta.url).pathname);
const core = await import(path.join(dir, "impala_core.js"));
const wasmBytes = fs.readFileSync(path.join(dir, "impala_core_bg.wasm"));
await core.default({ module_or_path: wasmBytes });
console.log(`WASM ${path.relative(process.cwd(), dir) || "."}: ${(wasmBytes.length / 1024).toFixed(1)} KB roh, ${(zlib.gzipSync(wasmBytes, { level: 9 }).length / 1024).toFixed(1)} KB gzip`);

const RUNS = 9;
// Abwechselnd messen: je Runde erst JS, dann WASM (bzw. umgekehrt in ungeraden Runden).
// `fn` liefert entweder nichts (ganze Laufzeit zählt) oder selbst gemessene Millisekunden.
function race(name, variants, runs = RUNS) {
	const names = Object.keys(variants);
	const ms = Object.fromEntries(names.map((n) => [n, []]));
	const once = (n) => { const t0 = performance.now(); const r = variants[n](); return typeof r === "number" ? r : performance.now() - t0; };
	for (let w = 0; w < 2; w++) for (const n of names) once(n);
	for (let i = 0; i < runs; i++) for (const n of (i % 2 ? [...names].reverse() : names)) ms[n].push(once(n));
	const med = Object.fromEntries(names.map((n) => [n, ms[n].sort((a, b) => a - b)[runs >> 1]]));
	console.log(`${name.padEnd(40)} ` + names.map((n) => `${n} ${med[n].toFixed(med[n] < 10 ? 3 : 1).padStart(8)} ms`).join("   "));
	return med;
}
const check = (ok, what) => { if (!ok) throw new Error("Abweichung: " + what); };

// ---- 1. Vektorsuche (Eingaben wie core/tools/bench-search.mjs) ----
function mulberry(seed) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
{
	console.log("\n# Vektorsuche / RAG");
	const SYL = ["ka", "lo", "mi", "ne", "ru", "sa", "te", "vo", "zu", "ber", "chen", "dor", "fel", "gru", "hal", "ion", "kraft", "licht", "mat", "phy"];
	const pick = (r, n) => Math.floor(r() * n);
	const word = (r) => Array.from({ length: 2 + pick(r, 3) }, () => SYL[pick(r, SYL.length)]).join("");
	const text = (r, n) => Array.from({ length: n }, () => word(r)).join(" ");
	const n = 20000, dim = 384, k = 10;
	const r = mulberry(42);
	const matrix = new Float32Array(n * dim);
	for (let i = 0; i < matrix.length; i++) matrix[i] = r() - 0.5;
	const query = Float32Array.from({ length: dim }, () => r() - 0.5);
	const rows = Array.from({ length: n }, (_, i) => matrix.subarray(i * dim, (i + 1) * dim));
	const norms = rows.map(norm);

	// JS wie bench-search.mjs / rag-ranking.js: Objekt je Zeile, ganze Liste sortieren.
	const jsTop = () => {
		const qn = norm(query);
		return rows.map((row, i) => ({ i, s: dot(query, row) / (qn * norms[i]) })).sort((a, b) => b.s - a.s).slice(0, k);
	};
	// JS so gut wie möglich: flache Matrix, eine Schleife, Top-k durch Einfügen.
	const flatNorms = Float64Array.from(norms);
	const jsFlat = () => {
		const qn = norm(query), idx = new Int32Array(k).fill(-1), sc = new Float64Array(k).fill(-Infinity);
		for (let i = 0, o = 0; i < n; i++, o += dim) {
			let s = 0;
			for (let j = 0; j < dim; j++) s += query[j] * matrix[o + j];
			s /= qn * flatNorms[i];
			if (s <= sc[k - 1]) continue;
			let p = k - 1;
			while (p > 0 && sc[p - 1] < s) { sc[p] = sc[p - 1]; idx[p] = idx[p - 1]; p--; }
			sc[p] = s; idx[p] = i;
		}
		return Array.from(idx, (i, p) => ({ i, s: sc[p] }));
	};
	let ix;
	race("Index anlegen (Kopie + Beträge)", {
		JS: () => { rows.map(norm); },
		WASM: () => { ix?.free(); ix = new core.VectorIndex(matrix, dim); },
	});
	const wasmTop = () => { const t = ix.topK(query, k); const o = Array.from(t.indices, (i, p) => ({ i, s: t.scores[p] })); t.free(); return o; };
	const a = jsTop(), b = jsFlat(), c = wasmTop();
	check(a.every((h, p) => h.i === b[p].i && h.i === c[p].i && Math.abs(h.s - c[p].s) < 1e-5), "Top-k");
	console.log(`Top-${k} identisch (bester Zeilenindex ${a[0].i}, max. Score-Abweichung ${Math.max(...a.map((h, p) => Math.abs(h.s - c[p].s))).toExponential(1)})`);
	race(`Anfrage ${n} × ${dim}, Top-${k}`, { "JS (rag-ranking)": jsTop, "JS (flach)": jsFlat, WASM: wasmTop }, 15);

	// RAG-Ranking wie bench-search.mjs: 2000 Seiten × 10 Chunks.
	const vecs = {}, pages = {}, ids = [], counts = [], texts = [];
	for (let p = 0; p < n / 10; p++) {
		const chunks = Array.from({ length: 10 }, (_, c) => ({ text: text(r, 40), vec: rows[p * 10 + c] }));
		pages["p" + p] = { title: text(r, 2), trashed: false, archived: false };
		vecs["p" + p] = { model: "m", providerId: "local", chunks };
		ids.push("p" + p); counts.push(10); texts.push(...chunks.map((ch) => ch.text));
	}
	const q = word(r) + " " + word(r);
	let rag;
	const titles = ids.map((id) => pages[id].title).join("\0"), flags = Uint8Array.from(ids, (id) => pages[id].trashed | (pages[id].archived << 1));
	race("RAG-Index anlegen (einmalig)", {
		WASM: () => { rag?.free(); rag = new core.RagIndex(ids.join("\0"), Uint32Array.from(counts), texts.join("\0"), matrix, dim); rag.setPages(titles, flags); },
	}, 3);
	race("RAG: Seitenangaben setzen (setPages)", { WASM: () => rag.setPages(titles, flags) });
	const jsRag = () => rankRag({ query: q, qv: query, vecs, pages, model: "m", providerId: "local", k: 6 });
	const wasmRag = () => JSON.parse(rag.rank(q, query, 6));
	const ra = jsRag(), rb = wasmRag();
	check(ra.length === rb.length && ra.every((h, p) => h.pageId === rb[p].pageId && h.snippet === rb[p].snippet && Math.abs(h.score - rb[p].score) <= 0.0011), "rankRag");
	console.log(`RAG-Treffer identisch (${ra.map((h) => h.pageId).join(", ")})`);
	race(`RAG-Anfrage ${n} Chunks, k = 6`, { JS: jsRag, WASM: wasmRag });
	rag.free(); ix.free();
}
