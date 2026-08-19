import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body><div id='localEmbeddingManager' hidden><span id='localEmbeddingBadge'></span><div id='localEmbeddingMsg'></div><button id='btnDownloadLocalEmbedding'></button><button id='btnDeleteLocalEmbedding'></button></div><select id='inpEmbed'></select></body>", { url: "http://localhost/" });
for (const key of ["window", "document", "Element", "Node", "HTMLElement", "MutationObserver", "navigator"]) {
	Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });
Object.defineProperty(globalThis, "requestAnimationFrame", { value: (fn) => setTimeout(fn, 0), configurable: true });
Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true });

const { S, STATE } = await import("../web/state.js");
const { AI } = await import("../web/ai.js");
const { RAG } = await import("../web/rag.js");
const { DB } = await import("../web/db.js");
const { refreshEmbeddingModels, updateLocalEmbeddingManagerUi } = await import("../web/settings.js");

test("LOCAL_EMBEDDING_MODELS contains Bekko a8m as recommended model", () => {
	assert.ok(Array.isArray(AI.LOCAL_EMBEDDING_MODELS));
	assert.equal(AI.LOCAL_EMBEDDING_MODELS.length, 1);
	const bekko = AI.LOCAL_EMBEDDING_MODELS.find((m) => m.id === "local:bekko-a8m");
	assert.ok(bekko, "Bekko a8m must be defined");
	assert.equal(bekko.dim, 256);
	assert.equal(bekko.hfId, "hotchpotch/bekko-embedding-v1-a8m");
	assert.equal(bekko.recommended, true);
});

test("Vector normalization produces unit length vectors (L2 norm = 1)", () => {
	function normalizeVec(vec) {
		let sum = 0;
		for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
		const norm = Math.sqrt(sum) || 1;
		const out = new Array(vec.length);
		for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
		return out;
	}

	const raw = [3, 4, 0, 0]; // norm is 5
	const norm = normalizeVec(raw);
	assert.equal(norm.length, 4);
	assert.ok(Math.abs(norm[0] - 0.6) < 1e-6);
	assert.ok(Math.abs(norm[1] - 0.8) < 1e-6);
	
	// Test unit length
	const l2 = Math.sqrt(norm.reduce((sum, v) => sum + v * v, 0));
	assert.ok(Math.abs(l2 - 1.0) < 1e-6);
});

test("Matryoshka slicing and cosine similarity works seamlessly with 256d vectors", () => {
	// Simulate two 768d raw vectors from model
	const rawA = new Float32Array(768).map((_, i) => Math.sin(i));
	const rawB = new Float32Array(768).map((_, i) => Math.sin(i + 0.1));

	// Slice to 256d
	const slicedA = rawA.slice(0, 256);
	const slicedB = rawB.slice(0, 256);
	assert.equal(slicedA.length, 256);
	assert.equal(slicedB.length, 256);

	// Dot product on unit vectors equals cosine similarity
	let dot = 0, sumA = 0, sumB = 0;
	for (let i = 0; i < 256; i++) {
		dot += slicedA[i] * slicedB[i];
		sumA += slicedA[i] * slicedA[i];
		sumB += slicedB[i] * slicedB[i];
	}
	const normA = Math.sqrt(sumA);
	const normB = Math.sqrt(sumB);
	const cosSim = dot / (normA * normB);

	assert.ok(cosSim > 0.8 && cosSim <= 1.0);
});

test("embedding model settings expose only the tested Bekko model", async () => {
	const models = await AI.listEmbeddingModels();
	assert.deepEqual(models.map((m) => [m.providerId, m.id]), [["local", "local:bekko-a8m"]]);
});

test("refreshEmbeddingModels does not re-add an unsupported saved model", async () => {
	const select = document.getElementById("inpEmbed");
	const hint = document.createElement("small");
	hint.id = "embeddingModelHint";
	document.body.append(hint);
	select.dataset.currentembed = "text-embedding-3-small";
	select.dataset.currentprov = "openai";

	await refreshEmbeddingModels();
	assert.deepEqual(Array.from(select.options).map((o) => o.value), ["", "local::local:bekko-a8m"]);
	assert.equal(select.value, "");
	assert.match(hint.textContent, /nicht mehr angeboten/);

	select.dataset.currentembed = "local:bekko-a8m";
	select.dataset.currentprov = "local";
	await refreshEmbeddingModels();
	assert.equal(select.value, "local::local:bekko-a8m");
	hint.remove();
});

test("RAG indexes and searches with 256d vectors", async () => {
	S.settings.embedModel = "local:bekko-a8m";
	S.settings.embedProviderId = "local";
	S.pages = {
		"p1": { id: "p1", title: "Photosynthese", content: "Lichtreaktion und Chlorophyll", updated: 100 },
		"p2": { id: "p2", title: "Mechanik", content: "Kräfte und Hebelgesetze", updated: 100 },
	};

	const storedVecs = new Map();
	DB.putVec = async (id, data) => { storedVecs.set(id, data); };
	DB.allVecs = async () => Object.fromEntries(storedVecs);

	// Mock AI.embed for testing
	const origEmbed = AI.embed;
	AI.embed = async (texts) => {
		return texts.map((t) => {
			const vec = new Array(256).fill(0);
			if (t.includes("Photosynthese") || t.includes("Lichtreaktion") || t.includes("Pflanzen")) {
				vec[0] = 1.0;
			} else {
				vec[1] = 1.0;
			}
			return vec;
		});
	};

	try {
		await RAG.indexPage("p1");
		await RAG.indexPage("p2");

		assert.equal(storedVecs.size, 2);
		const p1Data = storedVecs.get("p1");
		assert.equal(p1Data.model, "local:bekko-a8m");
		assert.equal(p1Data.chunks[0].vec.length, 256);

		// Search for photosynthese
		const hits = await RAG.search("Pflanzen und Licht", 5);
		assert.ok(hits.length > 0);
		assert.equal(hits[0].title, "Photosynthese");
		assert.equal(hits[0].score, 1);
	} finally {
		AI.embed = origEmbed;
	}
});

test("updateLocalEmbeddingManagerUi responds to local vs remote model selection", async () => {
	const select = document.getElementById("inpEmbed");
	const manager = document.getElementById("localEmbeddingManager");
	select.innerHTML = '<option value="openai::text-embedding-3-small">OpenAI</option><option value="local::local:bekko-a8m">Bekko</option>';

	// When non-local is selected
	select.value = "openai::text-embedding-3-small";
	await updateLocalEmbeddingManagerUi();
	assert.equal(manager.hidden, true);

	// When local is selected
	select.value = "local::local:bekko-a8m";
	await updateLocalEmbeddingManagerUi();
	assert.equal(manager.hidden, false);
	const badge = document.getElementById("localEmbeddingBadge");
	assert.ok(badge.textContent.length > 0);
});
