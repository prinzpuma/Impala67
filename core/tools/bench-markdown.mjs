// Misst parse/serialize des JS-Originals (web/editor-markdown.js) auf einem großen Dokument und
// schreibt dieselbe Eingabe nach core/target/bench-markdown.md für die Rust-Messung:
//   node core/tools/bench-markdown.mjs [Blöcke]
//   cargo run -p impala-markdown --example bench --profile native
import fs from "node:fs";
import { parse, serialize } from "../../web/editor-markdown.js";
import { rng } from "./sample-log.mjs";

const n = Number(process.argv[2] || 5000);
const r = rng(5000);
const word = () => ["Notiz", "FSRS", "Stabilität", "über", "Ähnlichkeit", "x²", "😀", "Lernplan", "**fett**", "[[Wiki]]", "$a+b$"][Math.floor(r() * 11)];
const words = (k) => Array.from({ length: k }, word).join(" ");
const make = [
	() => words(30) + "\n" + words(20),
	() => "## " + words(4),
	() => "- " + words(8) + "\n  " + words(5),
	() => "  - [ ] " + words(6),
	() => "1. " + words(7),
	() => "> " + words(10) + "\n> " + words(6),
	() => "```js\nconst a = 1;\nfunction f() { return a; }\n```",
	() => "| a | b | c |\n|---|---|---|\n| " + words(2) + " | x | y |",
	() => "$$\n\\int_0^1 x^2\\,dx\n$$",
	() => "<!--@c:red-->\n" + words(12),
	() => "> [!blue] " + words(3) + "\n> " + words(9),
	() => "<details>\n<summary>" + words(2) + "</summary>\n\n" + words(15) + "\n</details>",
];
const md = Array.from({ length: n }, () => make[Math.floor(r() * make.length)]()).join("\n\n");
fs.writeFileSync(new URL("../target/bench-markdown.md", import.meta.url), md);

let id = 0;
const uid = () => "b" + (++id);
const median = (fn) => {
	const ms = [];
	for (let i = 0; i < 11; i++) { const t0 = performance.now(); fn(); ms.push(performance.now() - t0); }
	return ms.sort((a, b) => a - b)[5];
};
const blocks = parse(md, uid);
median(() => parse(md, uid)); // Aufwärmen
const p = median(() => parse(md, uid));
const s = median(() => serialize(blocks));
console.log(`JS: ${blocks.length} Blöcke, ${(md.length / 1024).toFixed(0)} KiB – parse ${p.toFixed(2)} ms, serialize ${s.toFixed(2)} ms (Median aus 11)`);
