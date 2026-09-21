import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
for (const key of ["window", "document", "Element", "Node", "HTMLElement", "MutationObserver", "navigator"]) {
	Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });
Object.defineProperty(globalThis, "requestAnimationFrame", { value: (fn) => setTimeout(fn, 0), configurable: true });
Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true });

const { S, STATE } = await import("../web/state.js");
const { AI } = await import("../web/ai.js");
const { EMBEDDINGS } = await import("../web/embedding.js");
const { TOOLS } = await import("../web/tools.js");

STATE.dispatch = async (type, payload) => STATE.reduce({ id: crypto.randomUUID(), t: new Date().toISOString(), type, payload });

function resetState() {
	S.pages = {};
	S.cards = {};
	S.decks = {};
	S.heftDocs = {};
	S.heftMeta = {};
	S.tabs = [];
	S.currentPageId = null;
}

// ==========================================
// 1. EMBEDDINGS & VEKTOR-SIMILARITY
// ==========================================
test("AI Embedding: Bekko a8m Modell-Definition & Dimension", () => {
	assert.ok(Array.isArray(AI.LOCAL_EMBEDDING_MODELS));
	const bekko = AI.LOCAL_EMBEDDING_MODELS.find((m) => m.id === "local:bekko-a8m");
	assert.ok(bekko, "Bekko a8m muss definiert sein");
	assert.equal(bekko.dim, 256);
	assert.equal(bekko.hfId, "hotchpotch/bekko-embedding-v1-a8m");
});

test("AI Embedding: Cosine-Similarity & Matryoshka-Slicing", () => {
	function cosine(a, b) {
		let dot = 0, sumA = 0, sumB = 0;
		for (let i = 0; i < a.length; i++) {
			dot += a[i] * b[i];
			sumA += a[i] * a[i];
			sumB += b[i] * b[i];
		}
		const denom = Math.sqrt(sumA) * Math.sqrt(sumB);
		return denom ? dot / denom : 0;
	}

	// Identische Vektoren haben Ähnlichkeit 1.0
	const v1 = new Float32Array([1, 0, 0]);
	const v2 = new Float32Array([1, 0, 0]);
	assert.ok(Math.abs(cosine(v1, v2) - 1.0) < 1e-5);

	// Orthogonale Vektoren haben Ähnlichkeit 0.0
	const v3 = new Float32Array([0, 1, 0]);
	assert.ok(Math.abs(cosine(v1, v3)) < 1e-5);

	// 256d Matryoshka-Slice
	const fullA = new Float32Array(768).map((_, i) => Math.cos(i));
	const fullB = new Float32Array(768).map((_, i) => Math.cos(i + 0.05));
	const sliceA = fullA.slice(0, 256);
	const sliceB = fullB.slice(0, 256);
	const sim = cosine(sliceA, sliceB);
	assert.ok(sim > 0.8 && sim <= 1.0, "Ähnliche Vektoren behalten auch bei 256d hohe Ähnlichkeit");
});

// ==========================================
// 2. AI TOOLS & ATOMARE OPERATIONEN
// ==========================================
test("AI Tools: Kompakte Funktionsdefinitionen", () => {
	const names = TOOLS.defs.map((t) => t.function.name);
	assert.ok(names.includes("inspect"));
	assert.ok(names.includes("change"));
	assert.ok(names.includes("calculate"));
	assert.ok(JSON.stringify(TOOLS.defs).length < 5000, "Tool-Definitionen bleiben schlank");
});

test("AI Tools: Atomare Notizen- und Kartenerstellung mit vollständigem Undo", async () => {
	resetState();

	const runResult = await TOOLS.run("change", {
		operations: [
			{ op: "page.create", title: "Mathematik", content: "Ableitungsregeln" },
			{ op: "card.create", deck: "Mathematik", cards: [{ front: "(x^2)'", back: "2x" }] },
		],
	});

	assert.equal(runResult.ok, true);
	assert.equal(Object.keys(S.pages).length, 1);
	assert.equal(Object.keys(S.cards).length, 1);
	assert.ok(runResult._undo);

	// Undo macht alle erzeugten Einträge restlos rückgängig
	await TOOLS.undo(runResult._undo);
	assert.equal(Object.keys(S.pages).length, 0);
	assert.equal(Object.keys(S.cards).length, 0);
});
