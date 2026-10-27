// Laufzeit der JS-Heft-Geometrie auf denselben Eingaben wie core/impala-heft/examples/bench.rs
// (gleicher Zufallsgenerator, gleiche Reihenfolge). Median aus 7 Läufen.
//   node core/tools/bench-heft.mjs
if (typeof window === "undefined") { globalThis.window = globalThis; globalThis.location = { href: "http://localhost/" }; }
const G = await import("../../web/heft-geometry.js");
const L = await import("../../web/heft-lasso.js");
const DC = await import("../../web/heft-document-core.js");

function mulberry32(seed) {
	return () => {
		seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const rnd = mulberry32(42);
const rf = (a, b) => a + rnd() * (b - a);
const q1 = (v) => Math.round(v * 10) / 10, q2 = (v) => Math.round(v * 100) / 100;

const N = 5000;
const strokes = [];
for (let i = 0; i < N; i++) {
	const n = 10 + Math.floor(rnd() * 40);
	let x = rf(20, 980), y = rf(20, 1390), dx = rf(-3, 3), dy = rf(-3, 3);
	const pts = [];
	for (let k = 0; k < n; k++) { pts.push([q1(x), q1(y), q2(rf(0.2, 1))]); dx += rf(-1, 1); dy += rf(-1, 1); x += dx; y += dy; }
	const s = { id: "s" + i, tool: "pen", color: "#000", size: 3, pts };
	G.strokeBounds(s);
	strokes.push(s);
}
const queries = Array.from({ length: 2000 }, () => [q1(rf(0, 1000)), q1(rf(0, 1414))]);
const polys = Array.from({ length: 200 }, () => {
	const cx = rf(100, 900), cy = rf(100, 1300), r = rf(50, 300);
	return Array.from({ length: 24 }, (_, k) => { const a = k / 24 * Math.PI * 2, rr = r * rf(0.7, 1.2); return [q1(cx + Math.cos(a) * rr), q1(cy + Math.sin(a) * rr)]; });
});
const path = [];
{ let x = rf(100, 900), y = rf(100, 1300); for (let k = 0; k < 300; k++) { x += rf(-8, 8); y += rf(-8, 8); path.push([q1(x), q1(y)]); } }

const median = (fn) => {
	fn();
	const ms = [];
	let out;
	for (let i = 0; i < 7; i++) { const t0 = performance.now(); out = fn(); ms.push(performance.now() - t0); }
	return [ms.sort((a, b) => a - b)[3], out];
};
const report = (name, [ms, check]) => console.log(`${name.padEnd(34)} ${ms.toFixed(2).padStart(9)} ms   (Prüfsumme ${check})`);

report("Treffer-Test 2000 × 5000 Striche", median(() => { let n = 0; for (const [x, y] of queries) for (const s of strokes) if (G.strokeHitAt(s, x, y, 16)) n++; return n; }));
report("Lasso 200 Polygone × 5000", median(() => { let n = 0; for (const p of polys) n += L.selectStrokesByLasso(strokes, p).length; return n; }));
report("Radierer 300 Schritte", median(() => {
	let list = strokes.slice(), last = null, removed = 0;
	const r = 16;
	for (const [x, y] of path) {
		if (last && Math.hypot(x - last[0], y - last[1]) < r * 0.35) continue;
		last = [x, y];
		const keep = [];
		for (const s of list) if (G.strokeHitAt(s, x, y, r)) removed++; else keep.push(s);
		list = keep;
	}
	return removed;
}));
const doc = { v: 2, rev: 0, pages: [{ id: "p", paper: "lined", strokes, images: [], texts: [], ocrText: "" }] };
const shadow = DC.documentShadow(doc);
const next = { ...doc, pages: [{ ...doc.pages[0], strokes: [...strokes, { id: "neu", tool: "pen", color: "#000", size: 3, pts: [[1, 1, 0.5]] }] }] };
report("Diff nach 1 Strich (5000 Striche)", median(() => DC.diffDocument(shadow, next).ops.length));
report("Formerkennung 5000 Striche", median(() => strokes.reduce((n, s) => n + (G.fitStrokeShape(s.pts) ? 1 : 0), 0)));
