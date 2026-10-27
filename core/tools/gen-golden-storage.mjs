// Golden-Files für impala-storage aus der echten PWA-Logik (web/db.js, web/state-checkpoint.js).
//
// IndexedDB gibt es in Node nicht; der Generator nutzt fake-indexeddb, das bewusst NICHT in
// package.json steht. Einmalig in ein beliebiges Verzeichnis installieren und den Pfad angeben:
//   npm i --prefix <tmp> fake-indexeddb@6
//   FAKE_INDEXEDDB=<tmp>/node_modules/fake-indexeddb node core/tools/gen-golden-storage.mjs
//
// Ausgabe: core/impala-storage/tests/golden/{scenario,roundtrip,checkpoint,js-values}.json
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { webcrypto } from "node:crypto";
import { JSDOM } from "jsdom";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fakeDir = process.env.FAKE_INDEXEDDB;
if (!fakeDir) {
	console.error("FAKE_INDEXEDDB fehlt (Pfad zu node_modules/fake-indexeddb, siehe Kopf der Datei).");
	process.exit(1);
}
const fake = await import(pathToFileURL(join(fakeDir, "build/esm/index.js")).href);
globalThis.indexedDB = new fake.IDBFactory();
globalThis.IDBKeyRange = fake.IDBKeyRange;
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const dom = new JSDOM("", { url: "http://localhost/" });
globalThis.localStorage = dom.window.localStorage;

const web = (file) => pathToFileURL(join(root, "web", file)).href;
const { DB } = await import(web("db.js"));
const CP = await import(web("state-checkpoint.js"));
const { reorderSafe } = await import(web("event-order.js"));

const out = join(root, "core/impala-storage/tests/golden");
mkdirSync(out, { recursive: true });
const write = (name, data) => writeFileSync(join(out, name), JSON.stringify(data, null, 1) + "\n");
const withoutExportedAt = (json) => json.replace(/"exportedAt":"[^"]*"/, '"exportedAt":""');
const T = (i) => new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString();
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const log = async () => DB.allEvents();

// ---- Szenario: Ereignisfolge mit erwarteten Logs ------------------------------------------
await DB.open();
const steps = [];
const add = async (ev) => { await DB.addEvent(ev); steps.push({ op: "add", event: ev }); };
const snapshot = async () => steps.push({ op: "log", events: await log(), info: await DB.eventLogInfo() });

await add({ id: "p1", t: T(1), type: "pageCreate", payload: { id: "p1", title: "Eins", content: "" } });
await add({ id: "s1", t: T(2), type: "settingsSet", payload: { theme: "dark", notionToken: "geheim", aiProviders: [{ id: "a", key: "k" }] } });
for (let i = 0; i < 230; i++) {
	await add({ id: "u" + i, t: T(10 + i), type: "pageUpdate", payload: { id: "p1", patch: { content: "Text " + i } } });
}
for (let i = 0; i < 4; i++) await add({ id: "tabs" + i, t: T(300 + i), type: "uiTabsSet", payload: { tabs: [i] } });
await add({ id: "tree1", t: T(310), type: "uiTreeSet", payload: { key: "p1", open: true } });
await add({ id: "h1", t: T(320), type: "heftOps", payload: { id: "hp", ops: [{ t: "s+", p: "a", o: { id: "s", pts: [[1.5, 2.25, 0.5]] } }] } });
await add({ id: "h2", t: T(321), type: "heftSnap", payload: { id: "hp", doc: { pages: [] } } });
await snapshot();

// Fremde Events: seq wird neu vergeben, Dubletten/Kaputtes fallen weg, Zahlen-t wird ISO.
const wire = {
	app: "impala67",
	events: [
		{ id: "w1", t: T(400), type: "pageCreate", payload: { id: "p2", title: "Zwei" }, seq: 9999 },
		{ id: "p1", t: T(1), type: "pageCreate", payload: { id: "p1" } },
		{ id: "w2", t: Date.UTC(2026, 0, 2, 3, 4, 5, 678), type: "pageUpdate", payload: { id: "p2", patch: { title: "Zwei!" } } },
		{ id: "", t: T(1), type: "x" }, { t: T(1), type: "x" }, { id: "w3", type: "x" }, null, 5,
		{ id: "w4", t: T(401), type: "settingsSet", payload: { driveDesktopClientSecret: "x" } },
		{ id: "w5", t: T(402), type: "settingsSet", payload: { lang: "de", notionToken: "y" } },
		{ id: "w1", t: T(400), type: "pageCreate", payload: { id: "p2" } },
	],
};
let r = await DB.importAll(wire, { remote: true, remoteSource: "cloudflare", allowSecrets: false });
steps.push({ op: "import", data: wire, opts: { remote: "cloudflare", denySecrets: true }, expect: { added: r.added, malformed: r.malformed } });
const backup = { app: "notion", events: [{ id: "b1", t: T(403), type: "pageMove", payload: { id: "p2", parentId: "p1" } }] };
r = await DB.importAll(JSON.stringify(backup));
steps.push({ op: "import", data: backup, opts: {}, expect: { added: r.added, malformed: r.malformed } });
// Höchste seq, aber von der Kompaktierung verworfen (älterer Tab-Stand): bleibt trotzdem (Wasserstand).
await add({ id: "tabs-late", t: T(299), type: "uiTabsSet", payload: { tabs: [] } });
await snapshot();

const dropped = await DB.compactLocalIfDue();
steps.push({ op: "compactIfDue", expect: { dropped, floor: localStorage.getItem("impala67_compact_floor") } });
await snapshot();
const again = await DB.compactLocalIfDue();
steps.push({ op: "compactIfDue", expect: { dropped: again, floor: localStorage.getItem("impala67_compact_floor") } });

// Unter der Untergrenze: UI-Events werden abgewiesen, Fachliches nicht.
const late = { app: "impala67", events: [
	{ id: "old-tabs", t: T(0), type: "uiTabsSet", payload: { tabs: [] } },
	{ id: "old-page", t: T(0), type: "pageUpdate", payload: { id: "p1", patch: { title: "alt" } } },
] };
r = await DB.importAll(late, { remote: true });
steps.push({ op: "import", data: late, opts: { remote: "drive" }, expect: { added: r.added, malformed: r.malformed } });
await add({ id: "h3", t: T(500), type: "heftOps", payload: { id: "hp", ops: [] } });
await snapshot();

const upTo = (await DB.eventLogInfo()).maxSeq - 1; // h3 liegt darüber und bleibt
const baselines = [{ id: "base-hp", t: T(501), type: "heftOps", payload: { id: "hp", ops: [{ t: "pg+", at: 0, page: { id: "a", paper: "lined" } }] }, seq: 4 }];
const replaced = await DB.replaceHeftHistory(baselines, upTo);
steps.push({ op: "replaceHeftHistory", baselines, upTo, expect: replaced });
await snapshot();

// Blobs: mit/ohne Metadaten, Heft-Verlauf, Hintergrundbild.
const blobs = [
	["img:0a1b2c3d-0000-4000-8000-00000000abcd", [1, 2, 3, 250], { name: "image.png", size: 4, type: "image/png" }],
	["pdftext:x", [104, 105], { type: "text/plain" }],
	["heftver:hp:1767225600000:1", [123, 125], { type: "application/json", kind: "heftver" }],
	["bgImage", [9], undefined],
];
for (const [key, bytes, meta] of blobs) {
	await DB.putBlob(key, new Uint8Array(bytes).buffer, meta);
	steps.push({ op: "putBlob", key, b64: b64(bytes), ...(meta ? { meta } : {}) });
}
await DB.putStateCheckpoint({ format: 3, maxSeq: 1, eventCount: 1, state: {}, heftBlobSizes: {}, heftDocHashes: {} }, {}, {});
steps.push({ op: "putCheckpoint", record: { format: 3, maxSeq: 1, eventCount: 1, state: {}, heftBlobSizes: {}, heftDocHashes: {} } });
steps.push({ op: "blobKeys", expect: (await DB.allBlobKeys()).filter((k) => !DB.isStateCheckpointKey(k)) });
steps.push({ op: "export", opts: {}, json: withoutExportedAt(await DB.exportAll()) });
steps.push({ op: "export", opts: { redactSecrets: false, includeBlobs: false }, json: withoutExportedAt(await DB.exportAll({ redactSecrets: false, includeBlobs: false })) });
const pwaExport = await DB.exportAll();

await DB.clearPages();
steps.push({ op: "clearPages" });
// Nummern werden nie wiederverwendet, auch nachdem das höchste Event gelöscht wurde.
await add({ id: "after-reset", t: T(600), type: "pageCreate", payload: { id: "p3" } });
await snapshot();
steps.push({ op: "blobKeys", expect: await DB.allBlobKeys() });
write("scenario.json", { steps });

// ---- Roundtrip: PWA-Export in eine frische DB, wieder exportieren --------------------------
globalThis.indexedDB = new fake.IDBFactory();
localStorage.clear();
const { DB: FRESH } = await import(web("db.js") + "?fresh");
await FRESH.open();
await FRESH.importAll(pwaExport);
write("roundtrip.json", { export: withoutExportedAt(pwaExport), reexport: withoutExportedAt(await FRESH.exportAll()) });

// ---- Checkpoints -------------------------------------------------------------------------
const heftDoc = (n) => ({ v: 2, rev: n, pages: [{ id: "a", paper: "lined", strokes: [{ id: "s" + n, tool: "pen", color: "#000", size: 2,
	pts: [[1.5, 0.1 + 0.2, 1 / 3], [1e21, 1e-7, -2.5], [123456789.123, 0, 5e-324]] }], images: [{ id: "i", ref: "h" + n }], texts: [], ocrText: "Grüße ✓" }] });
const stateOf = (n) => ({
	pages: { p1: { id: "p1", title: "Eins " + n } }, cards: {}, grades: {}, learningSessions: [], chatSessions: {}, homeArticles: {},
	settings: { theme: "dark" }, decks: {}, workspaces: { default: { id: "default" } }, gnFolders: {}, treeOpen: { p1: true },
	tabs: [], activeTabId: null, reviews: [], telemetry: {},
	heftDocs: { hp: heftDoc(n), hq: heftDoc(0) },
	heftBlobs: { ["h" + n]: "data:image/png;base64,AAA" + n, h0: "data:image/png;base64,ÄÖ" },
});
const writes = [];
const info = await FRESH.eventLogInfo();
for (const n of [1, 2]) {
	const state = stateOf(n);
	const { heftDocHashes, heftDocJson } = await CP.hashHeftDocs(CP.serializeHeftDocs(state.heftDocs));
	const known = n === 1 ? {} : { h1: 999 };
	const orderTimes = n === 2 ? new Map([["page:p1", T(5)]]) : null;
	const checkpoint = CP.makeStateCheckpoint(state, info, T(7), known, heftDocHashes, orderTimes);
	const dirty = Object.fromEntries(Object.entries(state.heftBlobs).filter(([h]) => h !== "h1" || n === 1));
	await FRESH.putStateCheckpoint(checkpoint, dirty, heftDocJson);
	const parts = {};
	for (const key of await FRESH.allBlobKeys()) {
		if (!FRESH.isStateCheckpointKey(key) || key.endsWith("_v2__")) continue;
		parts[key] = (await FRESH.getBlob(key)).data;
	}
	writes.push({
		state, info, maxTime: T(7), known, orderTimes: orderTimes ? Object.fromEntries(orderTimes) : null, dirty,
		expect: { checkpoint: await FRESH.getStateCheckpoint(), heftDocHashes, parts },
	});
}

// Prüfung/Lesen für alle Formate.
const ev = (seq, id, t) => ({ id, t, type: "pageUpdate", payload: { id: "p1", patch: { title: id } }, seq });
const legacy = { format: 1, maxSeq: 2, eventCount: 2, lastEventId: "e2", state: stateOf(1) };
const v2 = { format: 2, maxSeq: 2, eventCount: 2, lastEventId: "e2", maxTime: T(10), heftBlobSizes: {},
	state: Object.fromEntries(CP.STATE_CHECKPOINT_CORE_KEYS.filter((k) => k !== "heftDocs").map((k) => [k, stateOf(2)[k]])),
	heftDocsJson: JSON.stringify(stateOf(2).heftDocs), orderTimes: { "page:p1": T(10) } };
const current = writes[1].expect.checkpoint;
const cases = [];
const judge = (name, checkpoint, infoNow, boundary, tail) => {
	const times = CP.checkpointOrderTimes(checkpoint);
	cases.push({
		name, checkpoint, info: infoNow, boundary, tail,
		reorderSafe: tail.map((e) => reorderSafe(e, times)),
		expect: CP.stateCheckpointRejectReason(checkpoint, infoNow, boundary, tail),
		saved: checkpoint?.format === 3 ? null : CP.checkpointSavedState(checkpoint) ?? null,
	});
};
const info3 = { count: 3, maxSeq: 3, lastEventId: "e3" };
judge("legacy-ok", legacy, info3, ev(2, "e2", T(2)), [ev(3, "e3", T(3))]);
judge("legacy-keys", { ...legacy, state: { pages: {} } }, info3, ev(2, "e2", T(2)), [ev(3, "e3", T(3))]);
judge("v2-ok", v2, info3, ev(2, "e2", T(2)), [ev(3, "e3", T(11))]);
judge("v2-older-tail-safe", v2, info3, ev(2, "e2", T(2)), [{ ...ev(3, "e3", T(1)), payload: { id: "p9", patch: { title: "x" } } }]);
judge("v2-older-tail", v2, info3, ev(2, "e2", T(2)), [ev(3, "e3", T(1))]);
judge("v2-blob-sizes", { ...v2, heftBlobSizes: [] }, info3, ev(2, "e2", T(2)), [ev(3, "e3", T(11))]);
judge("seq-ahead", { ...v2, maxSeq: 9 }, info3, null, []);
judge("count", v2, { ...info3, count: 5 }, ev(2, "e2", T(2)), [ev(3, "e3", T(11))]);
judge("boundary", v2, info3, ev(2, "other", T(2)), [ev(3, "e3", T(11))]);
judge("tail-seq", v2, { ...info3, count: 3 }, ev(2, "e2", T(2)), [ev(2, "e2", T(11))]);
judge("format", { ...v2, format: 7 }, info3, null, []);
judge("no-state", { ...v2, state: null }, info3, null, []);
judge("current-ok", current, { count: current.eventCount, maxSeq: current.maxSeq, lastEventId: current.lastEventId },
	await FRESH.eventAtSeq(current.maxSeq), []);
write("checkpoint.json", { writes, cases, savedCurrent: CP.checkpointSavedState(current, stateOf(2).heftDocs) });

// ---- JS-Zahlen und -Daten ----------------------------------------------------------------
const bits = (x) => { const v = new DataView(new ArrayBuffer(8)); v.setFloat64(0, x); return v.getBigUint64(0).toString(16).padStart(16, "0"); };
const numbers = [0, -0, 1, -1, 0.5, 0.1 + 0.2, 1 / 3, 2 / 3, 1e21, 1e20, 123e20, 1e-6, 1e-7, 1.5e-7, 5e-324, Number.MAX_VALUE,
	Number.MAX_SAFE_INTEGER, 2 ** 53 + 2, 123456789.123, -2.5e-12, 4.35, 0.000123, 1234567890123456789012, 100, 1e300, Math.PI];
const dates = [0, -1, 1.5, -1.5, 1767225600000, 253402300799999, 253402300800000, -62135596800001, 8.64e15, -8.64e15, 8.64e15 + 1];
write("js-values.json", {
	numbers: numbers.map((x) => ({ bits: bits(x), js: JSON.stringify(x) })),
	dates: dates.map((ms) => { const d = new Date(ms); return { ms, iso: Number.isNaN(d.getTime()) ? null : d.toISOString() }; }),
});
console.log("Golden-Files geschrieben nach", out);
