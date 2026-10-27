// Vergleicht Rust-Kern (WASM) und JS-Original: gleiches Ergebnis auf vielen Zufalls-Logs,
// dann Laufzeit auf einem großen Log. Erst node core/tools/build.mjs, dann
// node core/tools/bench.mjs [Events] [Fuzz-Runden]
import fs from "node:fs";
import { compactEvents } from "../../web/compact-events.js";
import { sampleLog } from "./sample-log.mjs";

const [n = 100_000, rounds = 300] = process.argv.slice(2).map(Number);
// WASM aus core/target/wasm/ (node core/tools/build.mjs); die PWA nutzt den Kern noch nicht.
const core = await import("../target/wasm/impala_core.js");
await core.default({ module_or_path: fs.readFileSync(new URL("../target/wasm/impala_core_bg.wasm", import.meta.url)) });
const wasm = (events) => Array.from(core.compactOrder(events), (i) => events[i]);

const same = (a, b) => a.length === b.length && a.every((ev, i) => ev === b[i]);
for (let seed = 1000; seed < 1000 + rounds; seed++) {
	const events = sampleLog(seed, 20 + (seed % 7) * 150);
	if (!same(compactEvents(events), wasm(events))) throw new Error("Abweichung bei Seed " + seed);
}
console.log(`${rounds} Zufalls-Logs: Rust und JS identisch.`);

const events = sampleLog(42, n, { contentSize: 3000 });
const time = (fn) => {
	const ms = [];
	for (let i = 0; i < 7; i++) { const t0 = performance.now(); fn(events); ms.push(performance.now() - t0); }
	return ms.sort((a, b) => a - b)[3]; // Median
};
time(compactEvents); time(wasm); // Aufwärmen
const js = time(compactEvents), rs = time(wasm);
console.log(`${n} Events (${compactEvents(events).length} behalten): JS ${js.toFixed(1)} ms, Rust/WASM ${rs.toFixed(1)} ms (Median aus 7)`);
