// Messung des Datenmodells, wie die PWA es nutzt (ModelCore als WASM aus web/core/), auf denselben
// Eingaben wie core/impala-model/examples/bench.rs (nativ): 100 000 Events aller Typen
// (sample-model.mjs) abspielen – ein Start ohne Checkpoint, ohne IndexedDB-Lesen –, 10 000
// Fremd-Events einzeln live und Checkpoint berechnen. Das JS-Datenmodell gibt es nicht mehr.
// Schreibt die Eingabe nach core/target/bench/model-events.json (liest das Rust-Beispiel).
//   node core/tools/bench-model.mjs   (RUNS=5, N=100000)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { modelEvents } from "./sample-model.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const N = Number(process.env.N || 100_000), LIVE = 10_000, RUNS = Number(process.env.RUNS || 5);
const events = modelEvents(42, N, { pages: 400, cards: 300, stepMs: 30_000 });
const live = modelEvents(43, LIVE, { pages: 400, cards: 300, stepMs: 30_000, offsetMs: N * 16_000 });
const dir = join(root, "core/target/bench");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "model-events.json"), JSON.stringify({ events, live }));

const { default: init, ...CORE } = await import(new URL("../../web/core/impala_core.js", import.meta.url));
await init({ module_or_path: readFileSync(join(root, "web/core/impala_core_bg.wasm")) });

// Wie IndexedDB: jedes Event mit lokaler Folgenummer.
const stored = events.map((ev, i) => ({ ...ev, seq: i + 1 }));
const info = { count: stored.length, maxSeq: stored.length, lastEventId: String(stored.at(-1)?.id || "") };
const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const res = { replay: [], live: [], checkpoint: [] };
for (let run = 0; run < RUNS; run++) {
	const M = new CORE.ModelCore();
	let t = performance.now();
	M.loadBegin(JSON.stringify({ info, checkpoint: null, boundary: null }));
	for (let i = 0; i < stored.length; i += 2000) M.loadEvents(JSON.stringify(stored.slice(i, i + 2000)), true);
	M.loadFinish("");
	res.replay.push(performance.now() - t);
	t = performance.now();
	const cp = JSON.parse(M.checkpointSave(JSON.stringify({ info, after: [], blobHashes: [], heftHashes: [] })));
	res.checkpoint.push(performance.now() - t);
	t = performance.now();
	for (const ev of live) M.applyRemote(JSON.stringify([ev]));
	res.live.push(performance.now() - t);
	if (run === 0) console.log(`Zustand: ${Object.keys(JSON.parse(M.records("pages", "null"))).length} Seiten, Checkpoint ${cp.status}, JSON ${(JSON.stringify(cp.checkpoint).length / 1e6).toFixed(1)} MB`);
	M.free();
}
const f = (x) => x.toFixed(1).padStart(8);
console.log(`PWA-Kern (WASM, Node ${process.version}, Median aus ${RUNS}):`);
console.log(`  ${N} Events lesen, sortieren + abspielen: ${f(median(res.replay))} ms`);
console.log(`  Checkpoint berechnen:                     ${f(median(res.checkpoint))} ms`);
console.log(`  ${LIVE} Fremd-Events einzeln live:          ${f(median(res.live))} ms`);
