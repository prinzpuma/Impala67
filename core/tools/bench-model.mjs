// Messung des JS-Reducers (web/state.js) auf denselben Eingaben wie
// core/impala-model/examples/bench.rs: 100 000 Events aller Typen (sample-model.mjs) nach Zeit
// sortieren und abspielen – das, was ein Start ohne Checkpoint tut (ohne IndexedDB-Lesen) –,
// dazu der gespeicherte Zustand als JSON (Checkpoint-Inhalt) und 10 000 Fremd-Events live.
// Schreibt die Eingabe nach core/target/bench/model-events.json (liest das Rust-Beispiel).
//   node core/tools/bench-model.mjs   (RUNS=5, N=100000)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { modelEvents } from "./sample-model.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
globalThis.window = globalThis;
globalThis.location = { href: "http://localhost/" };
globalThis.localStorage = new JSDOM("", { url: "http://localhost/" }).window.localStorage;
console.warn = () => {};

const N = Number(process.env.N || 100_000), LIVE = 10_000, RUNS = Number(process.env.RUNS || 5);
const events = modelEvents(42, N, { pages: 400, cards: 300, stepMs: 30_000 });
const live = modelEvents(43, LIVE, { pages: 400, cards: 300, stepMs: 30_000, offsetMs: N * 16_000 });
const dir = join(root, "core/target/bench");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "model-events.json"), JSON.stringify({ events, live }));

const web = (f) => pathToFileURL(join(root, "web", f)).href;
const { checkpointStateOf } = await import(web("state-checkpoint.js"));
const sortEvents = (list) => list.slice().sort((a, b) => (String(a?.t || "") < String(b?.t || "") ? -1 : String(a?.t || "") > String(b?.t || "") ? 1 : 0) || (a?.seq || 0) - (b?.seq || 0));
const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const res = { replay: [], json: [], live: [] };
for (let run = 0; run < RUNS; run++) {
	const input = structuredClone(events); // der Reducer behält Verweise auf Payloads
	const { STATE, S } = await import(web("state.js") + "?run=" + run);
	let t = performance.now();
	for (const ev of sortEvents(input)) STATE.reduce(ev);
	res.replay.push(performance.now() - t);
	t = performance.now();
	const json = JSON.stringify(checkpointStateOf(S));
	res.json.push(performance.now() - t);
	const liveInput = structuredClone(live);
	t = performance.now();
	for (const ev of liveInput) STATE.applyRemoteEvents([ev]);
	res.live.push(performance.now() - t);
	if (run === 0) console.log(`Zustand: ${Object.keys(S.pages).length} Seiten, ${Object.keys(S.cards).length} Karten, ${S.reviews.length} Reviews, JSON ${(json.length / 1e6).toFixed(1)} MB`);
}
const f = (x) => x.toFixed(1).padStart(8);
console.log(`JS (Node ${process.version}, Median aus ${RUNS}):`);
console.log(`  ${N} Events sortieren + abspielen:  ${f(median(res.replay))} ms`);
console.log(`  Zustand als JSON (Checkpoint):        ${f(median(res.json))} ms`);
console.log(`  ${LIVE} Fremd-Events einzeln live:     ${f(median(res.live))} ms`);
