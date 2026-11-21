#!/usr/bin/env node
// Führt alle angenommenen Trajektorien zusammen und teilt sie je Kategorie in Training/Validierung.
// Quellen: data/trajectories_raw.jsonl (v3) und data/teacher_shard_*.jsonl (v4, Lehrer-Läufe).
// Aufruf: node training/merge_dataset.mjs [--val 0.1]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { leaksIn } from "./leak_filter.mjs";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "data");
const valIdx = process.argv.indexOf("--val");
const VAL = valIdx > 0 ? Number(process.argv[valIdx + 1]) : 0.1;

const rows = new Map();
const sources = ["trajectories_raw.jsonl", ...readdirSync(DATA).filter((f) => /^teacher_shard_\d+\.jsonl$/.test(f))];
for (const f of sources) {
	for (const line of readFileSync(join(DATA, f), "utf8").split("\n")) {
		if (!line.trim()) continue;
		const r = JSON.parse(line);
		rows.set(r.id, r); // gleiche ID: letzter Lauf gewinnt
	}
}

// Benchmark-Lösungen dürfen nicht ins Training (sonst misst der Benchmark Auswendiglernen).
for (const [id, r] of rows) {
	const hits = leaksIn(r.messages);
	if (hits.length) { rows.delete(id); console.log(`verworfen (Benchmark-Leck: ${hits.join(", ")}): ${id}`); }
}

// Kategorie = Präfix bis zum zweiten Bindestrich (flat-calc, v4-tutor, …)
const byCat = new Map();
for (const r of [...rows.values()].sort((a, b) => a.id.localeCompare(b.id))) {
	const cat = r.id.split("-").slice(0, 2).join("-");
	if (!byCat.has(cat)) byCat.set(cat, []);
	byCat.get(cat).push(r);
}
const train = [], val = [];
for (const list of byCat.values()) {
	// Kleine Kategorien (< 4) nur ins Training; sonst ~VAL gleichmäßig verteilt in die Validierung.
	const nVal = list.length >= 4 ? Math.max(1, Math.round(list.length * VAL)) : 0;
	const valAt = new Set(Array.from({ length: nVal }, (_, k) => Math.floor((k * list.length) / nVal)));
	list.forEach((r, i) => (valAt.has(i) ? val : train).push({ messages: r.messages }));
}
writeFileSync(join(DATA, "impala_flat_train.jsonl"), train.map((r) => JSON.stringify(r)).join("\n") + "\n");
writeFileSync(join(DATA, "impala_flat_val.jsonl"), val.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`${rows.size} Trajektorien (${[...byCat].map(([c, l]) => `${c} ${l.length}`).join(", ")})`);
console.log(`→ ${train.length} Training / ${val.length} Validierung`);
