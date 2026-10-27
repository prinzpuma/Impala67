// Messung JS: CTC-Dekodierung (web/handwriting-ctc.js + handwriting-lexicon.js) auf denselben realen Logits wie
// core/impala-ink/examples/bench.rs, optional Modell-Inferenz mit ONNX Runtime (nativ und Web/WASM wie in der App).
//   node core/tools/bench-ink.mjs [<Ordner mit onnxruntime-node und onnxruntime-web>]
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { HANDWRITING_CTC } from "../../web/handwriting-ctc.js";
import { HANDWRITING_VOCAB } from "../../web/handwriting-vocab.js";
import { createLexicon } from "../../web/handwriting-lexicon.js";
import { findInkGaps } from "../../web/handwriting-rasterizer.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.join(here, "../../web");
const golden = JSON.parse(fs.readFileSync(path.join(here, "../impala-ink/tests/golden/pipeline.json"), "utf8"));
const CLASSES = 101;
const unpack = (b64) => zlib.inflateRawSync(Buffer.from(b64, "base64"));
function logits(b64, steps) {
	const b = unpack(b64);
	const out = [];
	for (let t = 0; t < steps; t++) {
		const o = t * 26;
		const row = new Float32Array(CLASSES).fill(b.readInt16LE(o) / 256);
		for (let k = 0; k < 8; k++) row[b[o + 2 + k * 3]] = b.readInt16LE(o + 3 + k * 3) / 256;
		out.push(row);
	}
	return out;
}
const median = (runs, fn) => {
	fn();
	const ms = [];
	for (let i = 0; i < runs; i++) { const t = performance.now(); fn(); ms.push(performance.now() - t); }
	return ms.sort((a, b) => a - b)[runs >> 1];
};
const lines = golden.pipeline.flatMap((p) => p.runs[0].inferences).map((inf) => {
	const gray = unpack(inf.image);
	const image = { width: inf.width, data: Float32Array.from(gray, (g) => g / 255) };
	return { width: inf.width, image, logits: logits(inf.logits, inf.steps) };
});
const steps = lines.reduce((n, l) => n + l.logits.length, 0);

const text = fs.readFileSync(path.join(web, "handwriting-lexicon-de.txt"), "utf8");
const load = median(5, () => createLexicon(text));
const lexicon = createLexicon(text);
console.log(`Wörterbuch laden (${lexicon.size} Wörter): ${load.toFixed(1)} ms`);
const prepared = lines.map((l) => {
	const rows = l.logits.map((r) => new Float32Array(r));
	HANDWRITING_CTC.markGapSpaces(rows, findInkGaps(l.image, 32), l.width);
	return rows;
});
for (const [name, lex] of [["mit Wörterbuch", lexicon], ["ohne Wörterbuch", undefined]]) {
	const ms = median(15, () => { for (const rows of prepared) HANDWRITING_CTC.decodeWithConfidence(rows, HANDWRITING_VOCAB, { lexicon: lex }); });
	console.log(`Dekodieren ${name}: ${prepared.length} Zeilen, ${steps} Schritte: ${ms.toFixed(2)} ms (Median aus 15)`);
}

const refDir = process.argv[2];
if (refDir) {
	const req = createRequire(path.join(path.resolve(refDir), "node_modules", "x.js"));
	const model = fs.readFileSync(path.join(web, "handwriting-model.onnx"));
	for (const [name, pkg] of [["ONNX Runtime nativ", "onnxruntime-node"], ["ONNX Runtime Web (WASM, 1 Thread)", "onnxruntime-web"]]) {
		const ort = req(pkg);
		if (ort.env?.wasm) ort.env.wasm.numThreads = 1;
		let t = performance.now();
		const session = await ort.InferenceSession.create(model, pkg === "onnxruntime-web" ? { executionProviders: ["wasm"], graphOptimizationLevel: "all" } : {});
		console.log(`${name}: Modell laden ${(performance.now() - t).toFixed(0)} ms`);
		for (const width of [312, 612, 1032]) {
			const line = lines.find((l) => l.width === width);
			if (!line) continue;
			const input = new ort.Tensor("float32", line.image.data, [1, 1, 64, width]);
			await session.run({ input });
			const ms = [];
			for (let i = 0; i < 5; i++) { t = performance.now(); await session.run({ input }); ms.push(performance.now() - t); }
			console.log(`${name}: Inferenz Breite ${width} px: ${ms.sort((a, b) => a - b)[2].toFixed(1)} ms (Median aus 5)`);
		}
	}
}
