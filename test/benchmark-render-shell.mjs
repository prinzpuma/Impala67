import { performance } from "node:perf_hooks";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<!doctype html><body><main id="main"></main></body>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;

const { U } = await import("../web/util.js");
const main = document.getElementById("main");
const rows = Array.from({ length: 250 }, (_, i) => ({ id: "row-" + i, title: "Datensatz " + i, value: "Wert " + i }));
const build = () => '<div class="page-scroll"><div class="db-view"><table><tbody>' +
	rows.map((r) => `<tr data-key="${r.id}"><td>${r.title}</td><td><input value="${r.value}"></td></tr>`).join("") +
	'</tbody></table></div><div id="blockEditor" data-owned="1"></div></div>';

const rounds = 250;
const sample = (cached) => {
	let last = null;
	const t0 = performance.now();
	for (let i = 0; i < rounds; i++) {
		const html = build();
		if (!cached || html !== last) U.morph(main, html);
		last = html;
	}
	return performance.now() - t0;
};

// Warm-up reduziert den Einfluss des ersten JIT-/DOM-Aufbaus.
sample(false);
sample(true);
const before = sample(false);
const after = sample(true);
const saved = before - after;
const pct = before ? saved / before * 100 : 0;

console.log("\n=== IDENTISCHE SEITENSHELL: 250 HINTERGRUND-RENDERS / 250 TABELLENZEILEN ===");
console.log(`Vorher (Markup parsen + DOM abgleichen): ${before.toFixed(2)} ms`);
console.log(`Nachher (Stringvergleich, DOM bleibt):    ${after.toFixed(2)} ms`);
console.log(`Ersparnis:                                ${saved.toFixed(2)} ms (${pct.toFixed(1)} %)`);
