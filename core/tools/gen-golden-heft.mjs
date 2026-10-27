// Schreibt die Golden-Files für `cargo test -p impala-heft` (core/impala-heft/tests/golden/*.json)
// aus den echten JS-Modulen: Reducer (state.js), Diff (heft-document-core.js), Geometrie,
// Lasso, Zeichnen (heft.js renderPageTo mit aufzeichnendem Canvas), Export, Seiten.
// Deterministisch (feste Seeds). Neu erzeugen nur bei bewusster JS-Änderung:
//   node core/tools/gen-golden-heft.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

// ---- Browser nachbilden (wie test/heft.test.mjs) ----
const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, { url: "http://localhost/" });
const define = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
define("window", dom.window);
define("document", dom.window.document);
for (const k of ["Element", "Node", "HTMLElement", "CustomEvent", "MutationObserver", "Image"]) define(k, dom.window[k]);
define("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
define("requestAnimationFrame", (fn) => setTimeout(fn, 0));
define("cancelAnimationFrame", (id) => clearTimeout(id));
const store = new Map();
define("localStorage", { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(), key: () => null, length: 0 });
define("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));

// Aufzeichnendes Canvas: jeder stroke()/fill() hält Pfad, Breite und Deckkraft fest.
class RecordingContext {
	constructor() { this.log = []; this.path = []; this.lineWidth = 1; this.globalAlpha = 1; this.stack = []; }
	save() { this.stack.push([this.lineWidth, this.globalAlpha]); }
	restore() { [this.lineWidth, this.globalAlpha] = this.stack.pop() || [1, 1]; }
	beginPath() { this.path = []; }
	moveTo(x, y) { this.path.push(["M", x, y]); }
	lineTo(x, y) { this.path.push(["L", x, y]); }
	quadraticCurveTo(cx, cy, x, y) { this.path.push(["Q", cx, cy, x, y]); }
	arc(x, y, r) { this.path.push(["A", x, y, r]); }
	ellipse(cx, cy, rx, ry) { this.path.push(["E", cx, cy, rx, ry]); }
	stroke() { this.log.push({ op: "stroke", lw: this.lineWidth, alpha: this.globalAlpha, path: this.path }); }
	fill() { this.log.push({ op: "fill", alpha: this.globalAlpha, path: this.path }); }
	strokeRect(x, y, w, h) { this.log.push({ op: "rect", lw: this.lineWidth, alpha: this.globalAlpha, rect: [x, y, w, h] }); }
	fillRect() {} clearRect() {} setTransform() {} drawImage() {} setLineDash() {} fillText() {}
	measureText() { return { width: 40 }; }
}
dom.window.HTMLCanvasElement.prototype.getContext = function () { return (this._ctx ||= new RecordingContext()); };

const { S, STATE } = await import("../../web/state.js");
console.warn = () => {}; // erwartete Reducer-Warnungen (übersprungene Events) nicht ausgeben
STATE.dispatch = async () => {};
const { U } = await import("../../web/util.js");
const DC = await import("../../web/heft-document-core.js");
const G = await import("../../web/heft-geometry.js");
const L = await import("../../web/heft-lasso.js");
const PC = await import("../../web/heft-pages-core.js");
const EX = await import("../../web/heft-export.js");
const { heftBaselineOps } = await import("../../web/sync-core.js");
const { normalizeDoc } = await import("../../web/heft-storage.js");
const { HEFT } = await import("../../web/heft.js");

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../impala-heft/tests/golden");
fs.mkdirSync(dir, { recursive: true });
const clone = (v) => JSON.parse(JSON.stringify(v));
const write = (name, data) => {
	const body = JSON.stringify(data) + "\n";
	fs.writeFileSync(path.join(dir, name + ".json"), body);
	console.log(`${name}.json: ${(body.length / 1024).toFixed(1)} KB`);
};

// ---- Zufall ----
function mulberry32(seed) {
	return () => {
		seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
let rnd = mulberry32(1);
const rf = (a, b) => a + rnd() * (b - a);
const ri = (a, b) => Math.floor(rf(a, b + 1));
const pick = (list) => list[Math.floor(rnd() * list.length)];
const q1 = (v) => Math.round(v * 10) / 10;
const q2 = (v) => Math.round(v * 100) / 100;
let uidN = 0;
const nid = (p = "s") => p + (++uidN);
U.uid = () => "uid" + (++uidN);

const COLORS = ["#1c1c1e", "#2f6fed", "#e0483e"];
function freehand(n = ri(1, 40), opts = {}) {
	let x = rf(20, 980), y = rf(20, 1390), dx = rf(-4, 4), dy = rf(-4, 4);
	const pts = [];
	for (let i = 0; i < n; i++) {
		pts.push([q1(x), q1(y), q2(rf(0.1, 1))]);
		dx += rf(-1.5, 1.5); dy += rf(-1.5, 1.5);
		x += dx; y += dy;
	}
	const s = { id: nid(), tool: opts.tool || pick(["pen", "pen", "marker"]), color: pick(COLORS), size: pick([1.6, 3, 5.5]), pts };
	return s;
}
function randomShape() {
	const x = q1(rf(50, 900)), y = q1(rf(50, 1300)), w = q1(rf(15, 300)), h = q1(rf(15, 300));
	switch (ri(0, 4)) {
		case 0: return { type: "line", x1: x, y1: y, x2: q1(x + rf(-200, 200)), y2: q1(y + rf(-200, 200)) };
		case 1: return { type: "rect", x1: x, y1: y, x2: x + w, y2: y + h };
		case 2: return { type: "triangle", x1: x, y1: y, x2: x + w, y2: y, x3: q1(x + w / 2), y3: y + h };
		case 3: return { type: "arrow", x1: x, y1: y, x2: x + w, y2: y + h, h1x: x + w - 20, h1y: y + h, h2x: x + w, h2y: y + h - 20 };
		default: return { type: "ellipse", cx: x, cy: y, rx: q1(w / 2), ry: q1(h / 2) };
	}
}
function shapeStroke() {
	const shape = randomShape();
	return { id: nid(), tool: "shape", color: pick(COLORS), size: pick([1.6, 3, 5.5]), pts: [[q1(rf(0, 999)), q1(rf(0, 999)), 0.5], [q1(rf(0, 999)), q1(rf(0, 999)), 0.5]], shape };
}
const randomStroke = () => (rnd() < 0.2 ? shapeStroke() : freehand(ri(1, 12)));
const randomImage = () => {
	const im = { id: nid("i"), ref: "b" + ri(1, 5), x: q1(rf(0, 800)), y: q1(rf(0, 1200)), w: q1(rf(40, 400)), h: q1(rf(40, 400)) };
	if (rnd() < 0.3) im.ocr = "Scan " + ri(1, 9);
	return im;
};
const randomText = () => {
	const t = { id: nid("x"), x: q1(rf(0, 800)), y: q1(rf(0, 1200)), w: 400, text: "Text " + ri(1, 99) };
	if (rnd() < 0.5) t.h = ri(40, 200);
	if (rnd() < 0.3) t.color = pick(COLORS);
	return t;
};
const PAPERS = ["lined", "grid", "dots", "blank"];
function randomPage(items = 4) {
	return {
		id: nid("p"), paper: pick(PAPERS),
		strokes: Array.from({ length: ri(0, items) }, randomStroke),
		images: Array.from({ length: ri(0, 2) }, randomImage),
		texts: Array.from({ length: ri(0, 2) }, randomText),
		ocrText: rnd() < 0.4 ? "ocr " + ri(1, 9) : "",
	};
}
const randomDoc = (pages = ri(1, 4)) => ({ v: 2, rev: 0, pages: Array.from({ length: pages }, () => randomPage()) });

// ===================================================================
// 1. Reducer: Event-Folgen → Heft danach
function randomOp(doc) {
	const pages = doc.pages;
	const pg = pages.length && rnd() < 0.9 ? pick(pages) : null;
	const pid = pg ? pg.id : pick(["nope", "p0"]);
	const known = (list) => (list.length && rnd() < 0.8 ? pick(list).id : nid("zz"));
	switch (ri(0, 14)) {
		case 0: return { t: "pg+", at: pick([0, pages.length, ri(-2, pages.length + 2), 1.5, undefined]), page: { id: rnd() < 0.85 ? nid("p") : pages[0]?.id || "p0", paper: pick([...PAPERS, "", undefined]) } };
		case 1: return pages.length > 1 ? { t: "pg-", p: pid } : { t: "ocr", p: pid, text: "x" };
		case 2: { const order = pages.map((p) => p.id).sort(() => rnd() - 0.5); if (rnd() < 0.3) order.splice(0, 1); if (rnd() < 0.3) order.push("unknown"); if (rnd() < 0.2) order.unshift(order[order.length - 1]); return { t: "pgo", order }; }
		case 3: return { t: "pgp", p: pid, paper: pick([...PAPERS, ""]) };
		case 4: return { t: "ocr", p: pid, text: rnd() < 0.2 ? "" : "Text " + ri(1, 99) };
		case 5: case 6: return { t: "s+", p: pid, o: rnd() < 0.15 && pg?.strokes.length ? clone(pick(pg.strokes)) : randomStroke() };
		case 7: { const o = randomStroke(); o.id = pg ? known(pg.strokes) : o.id; if (rnd() < 0.3) o.opacity = 0.5; return { t: "s=", p: pid, o }; }
		case 8: return { t: "s-", p: pid, ids: pg ? [known(pg.strokes), known(pg.strokes)] : ["a"] };
		case 9: return { t: "i+", p: pid, o: randomImage() };
		case 10: { const o = randomImage(); o.id = pg ? known(pg.images) : o.id; return { t: "i=", p: pid, o }; }
		case 11: return { t: rnd() < 0.5 ? "i-" : "x-", p: pid, ids: pg ? [known(rnd() < 0.5 ? pg.images : pg.texts)] : [] };
		case 12: return { t: "x+", p: pid, o: randomText() };
		case 13: { const o = randomText(); o.id = pg ? known(pg.texts) : o.id; return { t: "x=", p: pid, o }; }
		default: return pick([null, {}, { t: 5 }, { t: "zz" }, { t: "s+" }, { t: "s+", p: pid }, { t: "s+", p: pid, o: { pts: [] } }, { t: "s=", p: pid, o: "str" }, { t: "pg+" }, { t: "pg+", page: {} }, { t: "s*", p: pid }, { t: "q+", p: pid, o: { id: "q" } }]);
	}
}
const T = (n) => `2026-03-01T${String(Math.floor(n / 60) % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}:00.000Z`;
function runReducer(pageId, events, every = 4) {
	delete S.heftDocs[pageId];
	S.heftBlobs = {};
	const docs = [];
	events.forEach((ev, i) => {
		STATE.reduce({ type: ev.type, t: T(i), seq: i + 1, payload: clone(ev.payload) });
		// Stand nach jedem 4. und dem letzten Event (hält die Datei klein).
		docs.push(i % every === every - 1 || i === events.length - 1 ? (S.heftDocs[pageId] ? clone(S.heftDocs[pageId]) : null) : "-");
	});
	return { docs, blobs: clone(S.heftBlobs) };
}
const reducerCases = [];
for (const seed of [11, 12, 13, 14, 15, 16]) {
	rnd = mulberry32(seed);
	const pageId = "heft" + seed;
	delete S.heftDocs[pageId];
	const events = [];
	for (let i = 0; i < 40; i++) {
		const cur = S.heftDocs[pageId] || { pages: [] };
		let ev;
		if (i === 25 && seed % 2) ev = { type: "heftSnap", payload: { pageId, doc: clone({ pages: cur.pages.slice(0, 2) }) } };
		else if (rnd() < 0.08) ev = { type: "heftBlob", payload: { hash: "b" + ri(1, 3), data: "data:" + ri(1, 9) } };
		else ev = { type: "heftOps", payload: { pageId, ops: Array.from({ length: i === 0 ? 1 : ri(1, 5) }, () => (i === 0 ? { t: "pg+", page: { id: "p0" } } : randomOp(cur))) } };
		events.push(clone(ev));
		STATE.reduce({ type: ev.type, t: T(i), seq: i + 1, payload: clone(ev.payload) }); // Stand für die nächste Zufalls-Op
	}
	reducerCases.push({ name: "zufall-" + seed, pageId, events, ...runReducer(pageId, events) });
}
// Handverlesene Grenzfälle
{
	const pageId = "edge";
	const st = (id, extra = {}) => ({ id, tool: "pen", color: "#000", size: 3, pts: [[1, 2, 0.5], [3, 4, 0.6]], ...extra });
	const ops = (...list) => ({ type: "heftOps", payload: { pageId, ops: list } });
	const events = [
		ops({ t: "pg+", page: { id: "a" } }, { t: "pg+", at: 0, page: { id: "b", paper: "grid" } }, { t: "pg+", at: 99, page: { id: "c", paper: "" } }, { t: "pg+", at: -3, page: { id: "d" } }, { t: "pg+", at: 1.7, page: { id: "e" } }, { t: "pg+", at: "2", page: { id: "f" } }),
		ops({ t: "pg+", page: { id: "a", paper: "dots" } }), // doppelt: bleibt
		ops({ t: "s+", p: "a", o: st("s1") }, { t: "s+", p: "a", o: st("s2", { opacity: 0.4, bbox: { minX: 0, minY: 0, maxX: 9, maxY: 9 } }) }, { t: "s+", p: "a", o: st("s3") }, { t: "s+", p: "a", o: st("s1", { color: "#f00" }) }),
		ops({ t: "s=", p: "a", o: { id: "s2", pts: [[5, 5]] } }, { t: "s=", p: "a", o: st("s9") }, { t: "s-", p: "a", ids: ["s1", "nope"] }),
		ops({ t: "s+", p: "a", o: { id: "pt", pts: [[1, 2], [3, 4, 0.5, 1234], [null, 5, 0.5], [7, 8, null]] } }, { t: "s+", p: "a", o: { id: "sh", tool: "shape", pts: [[0, 0, 0.5]], shape: { type: "line", x1: 0, y1: 0, x2: 10, y2: 10 } } }, { t: "s+", p: "a", o: { id: "odd", tool: "pen", size: "3", pts: "x", shape: { type: "blob", k: 1 } } }),
		ops({ t: "i+", p: "a", o: { id: "i1", ref: "H1", x: 1, y: 2, w: 3, h: 4, ocr: "Scan" } }, { t: "i=", p: "a", o: { id: "i1", ref: "H1", x: 5, y: 2, w: 3, h: 4 } }, { t: "i+", p: "a", o: { id: "i2", src: "data:x", x: 0, y: 0, w: 1, h: 1 } }),
		ops({ t: "x+", p: "a", o: { id: "t1", x: 1, y: 2, w: 400, h: 60, text: "Hallo", hidden: true } }, { t: "x=", p: "a", o: { id: "t1", x: 1, y: 2, text: "Neu" } }, { t: "x-", p: "a", ids: ["t9"] }),
		ops({ t: "pgo", order: ["c", "zz", "a", "c"] }, { t: "pgp", p: "a", paper: "blank" }, { t: "pgp", p: "b" }, { t: "pgp", p: "zz", paper: "grid" }, { t: "ocr", p: "a", text: "Erkannt" }, { t: "ocr", p: "b" }),
		ops({ t: "pgo", order: "kaputt" }, { t: "pg-", p: "d" }, { t: "pg-", p: "zz" }, null, { t: "s+", o: st("ohneSeite") }, { t: "s+", p: "a", o: { id: "" } }),
		{ type: "heftOps", payload: { pageId, ops: [] } },
		{ type: "heftOps", payload: { pageId: "", ops: [{ t: "pg+", page: { id: "q" } }] } },
		{ type: "heftOps", payload: { pageId } },
		{ type: "heftBlob", payload: { hash: "H1", data: "data:eins" } },
		{ type: "heftBlob", payload: { hash: "H1", data: "data:zwei" } },
		{ type: "heftBlob", payload: { hash: "H2" } },
		{ type: "heftSnap", payload: { pageId, doc: { pages: [{ id: "n1", paper: "", strokes: "kaputt", images: [{ id: "i", ref: "H1", x: 0, y: 0, w: 1, h: 1 }], foo: 1 }, { id: "n2", paper: "grid", ocrText: "o", texts: [{ id: "t", x: 0, y: 0, text: "t" }] }] } } },
		{ type: "heftSnap", payload: { pageId, doc: { pages: [{ id: "x1" }, null] } } }, // null-Seite: JS wirft, Event fällt
		{ type: "heftSnap", payload: { pageId, doc: { pages: "nein" } } },
		ops({ t: "s+", p: "n1", o: st("nach-snap") }),
	];
	reducerCases.push({ name: "grenzfaelle", pageId, events, ...runReducer(pageId, events, 1) });
}
write("reducer", reducerCases);

// ===================================================================
// 2. Diff: diffDocument(applyOpsToShadow(documentShadow(prev), log), next)
function mutate(doc) {
	const next = clone(doc);
	for (let k = ri(1, 6); k > 0; k--) {
		const pg = next.pages.length ? pick(next.pages) : null;
		switch (ri(0, 16)) {
			case 0: next.pages.splice(ri(0, next.pages.length), 0, randomPage(3)); break;
			case 1: if (next.pages.length > 1) next.pages.splice(ri(0, next.pages.length - 1), 1); break;
			case 2: next.pages.sort(() => rnd() - 0.5); break;
			case 3: if (pg) pg.paper = pick(PAPERS); break;
			case 4: if (pg) pg.ocrText = rnd() < 0.3 ? "" : "neu " + ri(1, 9); break;
			case 5: if (pg) pg.strokes.push(randomStroke()); break;
			case 6: if (pg?.strokes.length) pg.strokes.splice(ri(0, pg.strokes.length - 1), 1); break;
			case 7: if (pg?.strokes.length) { const s = pick(pg.strokes); s.color = pick(COLORS); s.size = pick([1.6, 3, 5.5, 8]); } break;
			case 8: if (pg?.strokes.length) { const s = pick(pg.strokes); s.pts.forEach((p) => { p[0] += 5; }); if (s.shape) s.shape = randomShape(); } break;
			case 9: if (pg?.strokes.length) { const s = pick(pg.strokes); if (s.pts.length > 2) s.pts[1][0] += 7; s.tool = "marker"; s.bbox = { minX: 0, minY: 0, maxX: 1, maxY: 1 }; } break; // zählt nicht
			case 10: if (pg) pg.images.push(randomImage()); break;
			case 11: if (pg?.images.length) { const im = pick(pg.images); pick([() => { im.x += 3; }, () => { im.ref = "b9"; }, () => { im.ocr = "ocr neu"; }, () => { delete im.ref; im.src = "data:" + "x".repeat(ri(1, 20)); }, () => { delete im.ref; }])(); } break;
			case 12: if (pg?.images.length) pg.images.splice(0, 1); break;
			case 13: if (pg) pg.texts.push(randomText()); break;
			case 14: if (pg?.texts.length) { const t = pick(pg.texts); pick([() => { t.text += "!"; }, () => { t.h = ri(10, 300); }, () => { t.hidden = true; }, () => { t.color = "#123456"; }, () => { t.x += 1; }])(); } break;
			case 15: if (pg?.texts.length) pg.texts.pop(); break;
			default: if (pg) { const s = randomStroke(); pg.strokes.push(s, { ...clone(s), color: "#999" }, { pts: [[1, 1, 0.5]] }); } // doppelte ID, ohne ID
		}
	}
	return next;
}
const diffCases = [];
for (let seed = 100; seed < 140; seed++) {
	rnd = mulberry32(seed);
	const prev = randomDoc();
	const log = seed % 3 === 0 ? DC.diffDocument(DC.documentShadow(prev), mutate(prev)).ops : [];
	const next = mutate(prev);
	const shadow = DC.applyOpsToShadow(DC.documentShadow(clone(prev)), clone(log));
	diffCases.push({ prev, log: clone(log), next, ops: clone(DC.diffDocument(shadow, clone(next)).ops) });
}
{
	rnd = mulberry32(99);
	const next = randomDoc(3);
	diffCases.push({ prev: null, log: [], next, ops: clone(DC.diffDocument(null, clone(next)).ops) });
	diffCases.push({ prev: next, log: [], next: clone(next), ops: clone(DC.diffDocument(DC.documentShadow(clone(next)), clone(next)).ops) });
}
write("diff", diffCases);

// ===================================================================
// 3. Geometrie
rnd = mulberry32(7);
const geoStrokes = [];
for (let i = 0; i < 60; i++) geoStrokes.push(i % 4 === 3 ? shapeStroke() : freehand(i % 10 === 0 ? 1 : ri(2, 30)));
geoStrokes.push({ id: "leer", tool: "pen", color: "#000", size: 3, pts: [] });
geoStrokes.push({ id: "ohne-dicke", tool: "pen", color: "#000", pts: [[10, 10, 0.5], [20, 30, 0.5]] });
geoStrokes.push({ id: "gespeicherte-bbox", tool: "pen", color: "#000", size: 3, pts: [[10, 10, 0.5]], bbox: { minX: 0, minY: 0, maxX: 500, maxY: 500 } });
const geometry = geoStrokes.map((s) => {
	const b = G.strokeBounds(clone(s));
	const outline = G.strokeOutline(clone(s)).map((p) => [p[0], p[1]]);
	const queries = [];
	const base = s.pts[0] || [500, 500];
	for (let k = 0; k < 12; k++) {
		const x = q1(base[0] + rf(-40, 40)), y = q1(base[1] + rf(-40, 40)), r = pick([2, 8, 16, 30]);
		queries.push([x, y, r, G.strokeHitAt(clone(s), x, y, r)]);
	}
	const moved = clone(s); G.translateStroke(moved, 12.5, -7);
	const scaled = clone(s); const geo = G.strokeGeometry(scaled); const ax = rf(0, 500), ay = rf(0, 500), f = pick([0.5, 1.37, 2]);
	G.scaleStrokeFrom(scaled, geo, ax, ay, f);
	const back = clone(scaled); G.applyStrokeGeometry(back, G.strokeGeometry(clone(s)));
	const movedFrom = clone(s); G.moveStrokeFrom(movedFrom, G.strokeGeometry(clone(s)), -3, 4);
	return { stroke: s, bounds: b, outline, queries, moved, scale: [ax, ay, f], scaled, back, movedFrom };
});

// Gesten für die Formerkennung
rnd = mulberry32(8);
const noise = (v, a) => q1(v + rf(-a, a));
function gesture(kind) {
	const pts = [];
	const cx = rf(200, 800), cy = rf(200, 1200), w = rf(20, 300), h = rf(20, 300), a = pick([0, 1, 3, 6]);
	const push = (x, y) => pts.push([noise(x, a), noise(y, a), 0.5]);
	const seg = (x0, y0, x1, y1, n) => { for (let i = 0; i < n; i++) push(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n); };
	switch (kind) {
		case "line": seg(cx, cy, cx + w, cy + rf(-h, h), ri(3, 40)); push(cx + w, cy + h / 3); break;
		case "rect": { const n = ri(4, 12); seg(cx, cy, cx + w, cy, n); seg(cx + w, cy, cx + w, cy + h, n); seg(cx + w, cy + h, cx, cy + h, n); seg(cx, cy + h, cx, cy, n); push(cx + rf(0, 5), cy); break; }
		case "ellipse": { const n = ri(12, 60); for (let i = 0; i <= n; i++) push(cx + Math.cos(i / n * Math.PI * 2) * w / 2, cy + Math.sin(i / n * Math.PI * 2) * h / 2); break; }
		case "triangle": { const n = ri(4, 12); seg(cx, cy, cx + w, cy, n); seg(cx + w, cy, cx + w / 2, cy + h, n); seg(cx + w / 2, cy + h, cx, cy, n); push(cx, cy); break; }
		case "arrow": { const n = ri(5, 15), tx = cx + w + 40, ty = cy + rf(-30, 30); seg(cx, cy, tx, ty, n); seg(tx, ty, tx - 25, ty - 15, 4); seg(tx - 25, ty - 15, tx, ty, 4); seg(tx, ty, tx - 25, ty + 15, 4); push(tx - 25, ty + 15); break; }
		case "kurz": push(cx, cy); push(cx + 3, cy + 2); if (rnd() < 0.5) push(cx + 6, cy + 1); break;
		default: { let x = cx, y = cy; for (let i = 0, n = ri(3, 50); i < n; i++) { x += rf(-30, 30); y += rf(-30, 30); push(x, y); } }
	}
	return pts;
}
const shapes = [];
for (const kind of ["line", "rect", "ellipse", "triangle", "arrow", "kurz", "kritzel"]) {
	for (let i = 0; i < 18; i++) { const pts = gesture(kind); shapes.push({ kind, pts, shape: G.fitStrokeShape(clone(pts)) }); }
}
const polygons = [];
for (let i = 0; i < 20; i++) {
	const n = ri(3, 12), cx = rf(100, 900), cy = rf(100, 1300);
	const poly = Array.from({ length: n }, (_, k) => { const ang = k / n * Math.PI * 2, r = rf(20, 200); return [q1(cx + Math.cos(ang) * r), q1(cy + Math.sin(ang) * r)]; });
	if (i % 5 === 0) poly.push([poly[0][0] + 50, poly[0][1]], [poly[0][0] + 50, poly[0][1]]); // waagerechte Kante
	const points = Array.from({ length: 25 }, () => { const x = q1(cx + rf(-220, 220)), y = q1(cy + rf(-220, 220)); return [x, y, G.pointInPolygon([x, y], poly)]; });
	const near = points.slice(0, 5).map(([x, y]) => [x, y, G.nearPoint(poly[0], x, y, 50)]);
	polygons.push({ poly, points, near });
}
const boxItems = [{ x: 0, y: 0, w: 100, h: 50 }, { x: 50, y: 20, w: 100 }, { x: 200, y: 200, w: 10, h: 0 }, { x: 10, y: 300 }, { x: 40, y: 10, w: 30, h: 30 }];
const boxQueries = [[10, 10], [60, 30], [60, 75], [120, 60], [205, 255], [15, 310], [45, 15], [-1, 0], [100, 50], [150, 80]].map(([x, y]) => [x, y, boxItems.indexOf(G.hitBox(boxItems, [x, y]))]);
write("geometry", { strokes: geometry, shapes, polygons, hitBox: { items: boxItems, queries: boxQueries } });

// ===================================================================
// 4. Lasso und Radierer
rnd = mulberry32(21);
const lassoCases = [];
for (let i = 0; i < 9; i++) {
	const strokes = Array.from({ length: 30 }, (_, k) => (k % 7 === 0 ? shapeStroke() : freehand(ri(1, 28))));
	const s0 = pick(strokes).pts[0] || [500, 500];
	const n = ri(3, 30), cx = s0[0], cy = s0[1], r = rf(50, 400);
	const poly = Array.from({ length: n }, (_, k) => { const ang = k / n * Math.PI * 2; return [q1(cx + Math.cos(ang) * r * rf(0.7, 1.2)), q1(cy + Math.sin(ang) * r * rf(0.7, 1.2)), 0.5]; });
	const sel = L.selectStrokesByLasso(clone(strokes), poly).map((s) => s.id);
	const chosen = strokes.filter((s) => sel.includes(s.id));
	const bounds = L.lassoBounds(clone(chosen));
	const probes = [];
	if (bounds) {
		for (let k = 0; k < 10; k++) {
			const x = q1(rf(bounds.minX - 40, bounds.maxX + 40)), y = q1(rf(bounds.minY - 40, bounds.maxY + 40));
			const radius = pick([18, 22]), h = L.hitLassoHandle([x, y], bounds, radius);
			probes.push([x, y, radius, h ? h.name : null, L.isLassoBodyHit([x, y], bounds, 12)]);
		}
		const hd = L.getLassoHandles(bounds);
		probes.push([hd.br.x, hd.br.y, 18, L.hitLassoHandle([hd.br.x, hd.br.y], bounds).name, L.isLassoBodyHit([hd.br.x, hd.br.y], bounds, 12)]);
	}
	let dup = null;
	if (chosen.length) {
		const doc = { pages: [{ strokes: [] }] };
		const res = L.duplicateLassoStrokes({ pageIdx: 0, strokes: clone(chosen.slice(0, 3)) }, doc, () => {});
		dup = res.strokes;
	}
	lassoCases.push({ strokes, poly, selected: sel, bounds, polyBounds: L.polygonBounds(poly), probes, duplicates: dup, dupIdsFrom: dup ? Number(dup[0].id.slice(3)) : 0 });
}
const touch = [];
for (const pt of ["touch", "pen", "mouse"]) for (const tool of ["lasso", "pen"]) for (const on of [true, false]) touch.push([pt, tool, on, L.lassoTouchAction(pt, tool, on)]);

// Radierer: eraseAt aus heft-input.js ist an DOM-Ereignisse gebunden; hier dieselbe Regel
// (Drossel 0,35·r, strokeHitAt) auf den echten Geometrie-Funktionen.
rnd = mulberry32(31);
const eraserCases = [];
for (let i = 0; i < 4; i++) {
	let strokes = Array.from({ length: 60 }, (_, k) => (k % 9 === 0 ? shapeStroke() : freehand(ri(1, 20))));
	const radius = pick([6, 16, 30]);
	const start = pick(strokes).pts[0];
	let x = start[0], y = start[1];
	const path = [], removed = [];
	let last = null;
	const input = clone(strokes);
	for (let k = 0; k < 60; k++) {
		if (k % 6 === 5 && strokes.length) { const t = pick(pick(strokes).pts.length ? pick(strokes).pts : [[x, y]]); x = t[0]; y = t[1]; } // zum nächsten Strich springen
		x = q1(x + rf(-12, 12)); y = q1(y + rf(-12, 12));
		path.push([x, y]);
		if (last && Math.hypot(x - last[0], y - last[1]) < radius * 0.35) { removed.push([]); continue; }
		last = [x, y];
		const keep = [], gone = [];
		for (const s of strokes) (G.strokeHitAt(s, x, y, radius) ? gone : keep).push(s);
		strokes = keep;
		removed.push(gone.map((s) => s.id));
	}
	eraserCases.push({ strokes: input, radius, path, removed });
}
write("lasso", { lasso: lassoCases, touch, eraser: eraserCases });

// ===================================================================
// 5. Zeichnen: drawStroke/paintPaper über HEFT.renderPageTo
rnd = mulberry32(41);
const renderStrokes = [];
for (let i = 0; i < 30; i++) renderStrokes.push(i % 5 === 4 ? shapeStroke() : freehand(i % 6 === 0 ? 1 : ri(2, 15), { tool: pick(["pen", "marker", "pen"]) }));
renderStrokes.push({ id: "druck0", tool: "pen", color: "#000", size: 3, pts: [[0, 0, 0], [10, 10, 0.4], [20, 5]] });
renderStrokes.push({ id: "dreieck", tool: "shape", color: "#000", size: 2, pts: [[0, 0, 0.5]], shape: { type: "triangle", x1: 0, y1: 0, x2: 10, y2: 0, x3: 5, y3: 9 } });
renderStrokes.push({ id: "pfeil", tool: "shape", color: "#000", pts: [[0, 0, 0.5]], shape: { type: "arrow", x1: 0, y1: 0, x2: 100, y2: 0, h1x: 80, h1y: -10, h2x: 80, h2y: 10 } });
renderStrokes.push({ id: "rechteck", tool: "shape", color: "#000", size: 3, pts: [[0, 0, 0.5]], shape: { type: "rect", x1: 50, y1: 60, x2: 10, y2: 20 } });
renderStrokes.push({ id: "form-ohne-punkte", tool: "shape", color: "#000", size: 3, pts: [], shape: { type: "line", x1: 0, y1: 0, x2: 9, y2: 9 } });
const render = renderStrokes.map((s) => {
	const ctx = new RecordingContext();
	HEFT.renderPageTo(ctx, { id: "r", paper: "blank", strokes: [clone(s)], images: [], texts: [] }, -1);
	return { stroke: s, log: ctx.log };
});
const paper = PAPERS.map((kind) => {
	const ctx = new RecordingContext();
	HEFT.renderPageTo(ctx, { id: "r", paper: kind, strokes: [], images: [], texts: [] }, -1);
	return { kind, log: ctx.log };
});
write("render", { strokes: render, paper });

// ===================================================================
// 6. Kleinteile: blobId, Seitentext, Export, Seiten, Basis-Ops, Altbestände
const blobIds = ["", "a", "data:image/png;base64,iVBORw0KGgo=", "Grüße 😀 ✓", "x".repeat(5000)].map((s) => [s, DC.blobId(s)]);
const pageTexts = [
	["  Hand  ", { images: [{ ocr: " Scan1 " }, { ocr: "" }, {}, { ocr: "Scan2" }] }],
	["", { images: [] }],
	["﻿Text\n", { images: [{ ocr: " " }] }],
	["", { images: [{ ocr: "nur Scan" }] }],
].map(([t, p]) => [t, p, DC.composePageText(t, p)]);
const names = [undefined, "", "Mein/Heft: *Test*?", "  leer  ", " # ", "x".repeat(100), "😀".repeat(45), "a<b>c|d\"e#f"].map((t) => [t ?? null, EX.exportName("p", t === undefined ? {} : { p: { title: t } })]);
const jpeg = (n) => "data:image/jpeg;base64," + Buffer.from(Array.from({ length: n }, (_, i) => (i * 37) & 255)).toString("base64");
const shots = [{ dataUrl: jpeg(50), w: 2480, h: 3507 }, { dataUrl: jpeg(9), w: 1000, h: 300 }, { dataUrl: jpeg(3), w: 7, h: 9001 }];
const pdf = Buffer.from(EX.buildPdf(shots)).toString("base64");
const pagesCore = {
	move: [[[0, 1, 2, 3], 0, 2], [[0, 1, 2, 3], 3, 0], [[0, 1], 1, 1], [[0, 1], 0, 5]].map(([list, from, to]) => { const l = list.slice(); const ok = PC.movePage(l, from, to); return [list, from, to, ok, l]; }),
	insert: [["start", 3, 5], ["before", 3, 5], ["before", 9, 5], ["after", 3, 5], ["after", 4, 5], ["end", 0, 5], ["sonst", 0, 2]].map(([p, c, n]) => [p, c, n, PC.insertAt(p, c, n)]),
	canDelete: [[3, 1], [3, 3], [3, 0], [1, 1], [5, 4]].map(([a, b]) => [a, b, PC.canDeletePages(a, b)]),
};
rnd = mulberry32(51);
const baseline = [randomDoc(3), { pages: [] }, { pages: [{ id: "a", paper: "", strokes: [{ pts: [] }], ocrText: "t" }] }].map((d) => [d, clone(heftBaselineOps(clone(d)))]);
uidN = 0;
const legacyIn = [
	{ pages: [{ paper: "grid", strokes: [{ pts: [[1, 2, 0.5]] }, { id: "s", pts: [] }], images: [{ src: "data:image/png;base64,AAAA", x: 0, y: 0, w: 5, h: 5 }, { id: "r", ref: "H", x: 1, y: 1, w: 1, h: 1 }], texts: [{ text: "t", x: 0, y: 0 }], ocrText: "o" }, { id: "p2" }] },
	{ pages: [] },
	{},
];
const legacy = legacyIn.map((d) => { const before = uidN; S.heftBlobs = {}; const out = normalizeDoc(clone(d)); return { input: d, idsFrom: before, output: out, blobs: clone(S.heftBlobs) }; });
const sizes = [2480, 1000, 220, 333].map((w) => { const c = document.createElement("canvas"); c.width = w; HEFT.paintInto?.(c, { strokes: [] }, -1); return [w, Math.round(DC.PAGE_H * (w / DC.PAGE_W))]; });
write("misc", { blobIds, pageTexts, names, pdf: { shots: shots.map((s) => ({ jpeg: s.dataUrl.split(",")[1], w: s.w, h: s.h })), bytes: pdf }, pagesCore, baseline, legacy, sizes });
process.exit(0);
