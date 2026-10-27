// Messung der PWA-Speicherschicht (web/db.js) auf denselben Eingaben wie
// core/impala-storage/examples/bench.rs. ACHTUNG: fake-indexeddb ist eine reine JS-Nachbildung
// (In-Memory, ohne Strukturklon-Fastpath, ohne Festplatte) – die Zahlen sagen nichts über echtes
// IndexedDB im Browser, nur über die Größenordnung der JS-Logik obendrauf.
//   FAKE_INDEXEDDB=<tmp>/node_modules/fake-indexeddb node core/tools/bench-storage.mjs
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fakeDir = process.env.FAKE_INDEXEDDB;
if (!fakeDir) { console.error("FAKE_INDEXEDDB fehlt (siehe Kopf der Datei)."); process.exit(1); }
const fake = await import(pathToFileURL(join(fakeDir, "build/esm/index.js")).href);
globalThis.IDBKeyRange = fake.IDBKeyRange;
globalThis.localStorage = new JSDOM("", { url: "http://localhost/" }).window.localStorage;

const N = 100_000, SINGLE = 1_000, RUNS = Number(process.env.RUNS || 3);
const pad = (n, w) => String(n).padStart(w, "0");
const event = (i) => ({
	id: "ev-" + pad(i, 8),
	t: `2026-01-01T00:${pad(Math.floor(i / 60000) % 60, 2)}:${pad(Math.floor(i / 1000) % 60, 2)}.${pad(i % 1000, 3)}Z`,
	type: "pageUpdate",
	payload: { id: "page-" + (i % 500), patch: { content: `Absatz ${i} – etwas Text für eine typische Seite.` } },
});
const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const time = async (fn) => { const t = performance.now(); await fn(); return performance.now() - t; };
const freshDb = async (run) => {
	globalThis.indexedDB = new fake.IDBFactory();
	const { DB } = await import(pathToFileURL(join(root, "web/db.js")).href + "?run=" + run);
	await DB.open();
	return DB;
};
const events = Array.from({ length: N }, (_, i) => event(i));
const res = { import: [], read: [], tail: [], info: [], single: [] };
for (let run = 0; run < RUNS; run++) {
	const DB = await freshDb(run);
	res.import.push(await time(() => DB.importAll({ app: "impala67", events })));
	res.read.push(await time(async () => { if ((await DB.allEvents()).length !== N) throw new Error("count"); }));
	res.tail.push(await time(() => DB.eventsAfterSeqAll(N - 1000)));
	res.info.push(await time(() => DB.eventLogInfo()));
	res.single.push(await time(async () => { for (let i = 0; i < SINGLE; i++) await DB.addEvent(event(N + i)); }));
}
const f = (x) => x.toFixed(1).padStart(8);
console.log(`db.js mit fake-indexeddb (Median aus ${RUNS}):`);
console.log(`  ${N} Events per importAll (eine Transaktion): ${f(median(res.import))} ms`);
console.log(`  ${SINGLE} Events einzeln (addEvent):           ${f(median(res.single))} ms`);
console.log(`  alle ${N} Events lesen (allEvents):        ${f(median(res.read))} ms`);
console.log(`  letzte 1000 Events lesen:                     ${f(median(res.tail))} ms`);
console.log(`  eventLogInfo:                                 ${f(median(res.info))} ms`);
