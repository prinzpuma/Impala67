import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body><div id='ai-embedding'><input type='hidden' id='inpEmbed' value=''><div id='localEmbeddingStatus' class='settings-status is-idle'><span class='settings-status-dot'></span><span class='settings-row-copy'><b>Semantische Suche (Bekko a8m)</b><small id='localEmbeddingMsg'></small><div class='progress-bar' id='localEmbeddingProgress' hidden><div class='progress-fill'></div></div></span><span id='localEmbeddingActions'><button type='button' id='btnDownloadLocalEmbedding'>Herunterladen</button></span></div></div></body>", { url: "http://localhost/" });
for (const key of ["window", "document", "Element", "Node", "HTMLElement", "MutationObserver", "navigator"]) {
	Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });
Object.defineProperty(globalThis, "requestAnimationFrame", { value: (fn) => setTimeout(fn, 0), configurable: true });
Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true });

const { S, STATE } = await import("../web/state.js");
const { AI } = await import("../web/ai.js");
const { EMBEDDINGS } = await import("../web/embedding.js");
const { RAG } = await import("../web/rag.js");
const { DB } = await import("../web/db.js");
const { updateLocalEmbeddingManagerUi } = await import("../web/settings.js");

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

test("queued remote embeddings keep the provider and model selected when enqueued", async () => {
	const originalFetch = globalThis.fetch;
	const originalProviders = S.settings.aiProviders;
	const originalProviderId = S.settings.embedProviderId;
	const originalModel = S.settings.embedModel;
	const requests = [];
	let releaseFirst;
	const firstResponse = new Promise((resolve) => { releaseFirst = resolve; });
	S.settings.aiProviders = [
		{ id: "provider-a", base: "https://a.example/v1", key: "key-a" },
		{ id: "provider-b", base: "https://b.example/v1", key: "key-b" },
	];
	S.settings.embedProviderId = "provider-a";
	S.settings.embedModel = "model-a";
	globalThis.fetch = async (url, options) => {
		requests.push({ url: String(url), body: JSON.parse(options.body) });
		if (requests.length === 1) await firstResponse;
		return new Response(JSON.stringify({ data: [{ embedding: [1, 0] }] }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	};

	try {
		const first = AI.embed(["eins"], { priority: "background" });
		while (!requests.length) await new Promise((resolve) => setTimeout(resolve, 0));
		const second = AI.embed(["zwei"], { priority: "background" });
		S.settings.embedProviderId = "provider-b";
		S.settings.embedModel = "model-b";
		releaseFirst();
		await Promise.all([first, second]);

		assert.deepEqual(requests.map((request) => request.url), [
			"https://a.example/v1/embeddings",
			"https://a.example/v1/embeddings",
		]);
		assert.deepEqual(requests.map((request) => request.body.model), ["model-a", "model-a"]);
	} finally {
		globalThis.fetch = originalFetch;
		S.settings.aiProviders = originalProviders;
		S.settings.embedProviderId = originalProviderId;
		S.settings.embedModel = originalModel;
		releaseFirst();
	}
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

	// RAG nutzt die zyklusfreie Embedding-Schnittstelle direkt.
	const origEmbed = EMBEDDINGS.embed;
	EMBEDDINGS.embed = async (texts) => {
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
		assert.equal(p1Data.providerId, "local");
		assert.ok(p1Data.chunks[0].vec instanceof Float32Array);
		assert.equal(p1Data.chunks[0].vec.length, 256);

		// Search for photosynthese
		const hits = await RAG.search("Pflanzen und Licht", 5);
		assert.ok(hits.length > 0);
		assert.equal(hits[0].title, "Photosynthese");
		assert.equal(hits[0].score, 1);
	} finally {
		EMBEDDINGS.embed = origEmbed;
	}
});

test("Hybrid-RAG hebt exakte Fachbegriffe trotz schwacher Semantik an", async () => {
	S.settings.embedModel = "local:hybrid-test";
	S.settings.embedProviderId = "local";
	S.pages = {
		exact: { id: "exact", title: "ATP-Synthase", content: "Protonengradient", updated: 1 },
		semantic: { id: "semantic", title: "Zellatmung", content: "Energiegewinnung im Mitochondrium", updated: 1 },
	};
	const oldAll = DB.allVecs, oldEmbed = EMBEDDINGS.embed;
	DB.allVecs = async () => ({
		exact: { model: "local:hybrid-test", providerId: "local", chunks: [{ text: "ATP-Synthase und Protonengradient", vec: [0, 1], norm: 1 }] },
		semantic: { model: "local:hybrid-test", providerId: "local", chunks: [{ text: "Energiegewinnung im Mitochondrium", vec: [0.6, 0.8], norm: 1 }] },
	});
	let searchPriority = "";
	EMBEDDINGS.embed = async (_texts, options) => { searchPriority = options?.priority; return [[1, 0]]; };
	try {
		const hits = await RAG.search("ATP-Synthase", 2);
		assert.equal(searchPriority, "foreground");
		assert.equal(hits[0].title, "ATP-Synthase");
		assert.equal(hits[0].lexicalScore, 1);
		assert.equal(hits[0].semanticScore, 0);
		assert.equal(hits[1].semanticScore, 0.6);
		assert.ok(hits[0].score > hits[1].score);
	} finally { DB.allVecs = oldAll; EMBEDDINGS.embed = oldEmbed; }
});

test("RAG behandelt kurze exakte Begriffe als Token statt als Zufalls-Substring", async () => {
	S.settings.embedModel = "local:short-token-test";
	S.pages = {
		exact: { id: "exact", title: "AI", content: "Künstliche Intelligenz", updated: 1 },
		substring: { id: "substring", title: "Training", content: "Trainingsplan", updated: 1 },
	};
	const oldAll = DB.allVecs, oldEmbed = EMBEDDINGS.embed;
	DB.allVecs = async () => ({
		exact: { model: "local:short-token-test", providerId: "local", chunks: [{ text: "AI als Fachbegriff", vec: [0, 1], norm: 1 }] },
		substring: { model: "local:short-token-test", providerId: "local", chunks: [{ text: "Training und Trainingsplan", vec: [0.65, Math.sqrt(1 - 0.65 ** 2)], norm: 1 }] },
	});
	EMBEDDINGS.embed = async () => [[1, 0]];
	try {
		const hits = await RAG.search("AI", 2);
		assert.equal(hits[0].title, "AI");
		assert.ok(hits[1].score < 0.7, "Training darf keinen Exact-Floor durch den Teilstring ai erhalten");
	} finally { DB.allVecs = oldAll; EMBEDDINGS.embed = oldEmbed; }
});

test("RAG begrenzt lokale Embedding-Batches für große Seiten", async () => {
	S.settings.embedModel = "local:bekko-a8m";
	S.settings.embedProviderId = "local";
	S.pages = {
		"large": {
			id: "large",
			title: "Großes Dokument",
			content: Array.from({ length: 12 }, (_, i) => `Absatz ${i} ` + "x".repeat(760)).join("\n\n"),
			updated: 200,
		},
	};

	const batchSizes = [];
	const priorities = [];
	const origEmbed = EMBEDDINGS.embed;
	const origPutVec = DB.putVec;
	try {
		DB.putVec = async () => {};
		EMBEDDINGS.embed = async (texts, options) => {
			batchSizes.push(texts.length);
			priorities.push(options?.priority);
			return texts.map(() => new Array(256).fill(0));
		};
		await RAG.indexPage("large");

		assert.ok(batchSizes.length > 1);
		assert.ok(Math.max(...batchSizes) <= 4);
		assert.equal(batchSizes.reduce((sum, size) => sum + size, 0), 12);
		assert.ok(priorities.every((priority) => priority === "background"));
	} finally {
		EMBEDDINGS.embed = origEmbed;
		DB.putVec = origPutVec;
	}
});

test("RAG speichert keine Vektoren unter einem während der Indexierung gewechselten Modell", async () => {
	const originalModel = S.settings.embedModel;
	const originalProviderId = S.settings.embedProviderId;
	const originalPages = S.pages;
	const originalEmbed = EMBEDDINGS.embed;
	const originalPutVec = DB.putVec;
	let stored = null;
	S.settings.embedModel = "model-before";
	S.settings.embedProviderId = "provider-before";
	S.pages = {
		page: { id: "page", title: "Modellwechsel", content: "Ein kurzer Inhalt", updated: 1 },
	};
	EMBEDDINGS.embed = async (texts) => {
		S.settings.embedModel = "model-after";
		S.settings.embedProviderId = "provider-after";
		return texts.map(() => [1, 0]);
	};
	DB.putVec = async (_id, value) => { stored = value; };

	try {
		await assert.rejects(() => RAG.indexPage("page"), /Embedding-Konfiguration.*geändert/);
		assert.equal(stored, null);
	} finally {
		S.settings.embedModel = originalModel;
		S.settings.embedProviderId = originalProviderId;
		S.pages = originalPages;
		EMBEDDINGS.embed = originalEmbed;
		DB.putVec = originalPutVec;
	}
});

test("RAG markiert veralteten Inhalt nicht als aktuellen Seitenindex", async () => {
	const originalModel = S.settings.embedModel;
	const originalProviderId = S.settings.embedProviderId;
	const originalPages = S.pages;
	const originalEmbed = EMBEDDINGS.embed;
	const originalPutVec = DB.putVec;
	let stored = null;
	S.settings.embedModel = "stable-model";
	S.settings.embedProviderId = "stable-provider";
	S.pages = {
		page: { id: "page", title: "Alt", content: "Alter Inhalt", updated: "before" },
	};
	EMBEDDINGS.embed = async (texts) => {
		S.pages.page.title = "Neu";
		S.pages.page.content = "Neuer Inhalt";
		S.pages.page.updated = "after";
		return texts.map(() => [1, 0]);
	};
	DB.putVec = async (_id, value) => { stored = value; };

	try {
		await assert.rejects(() => RAG.indexPage("page"), /Seite wurde während der Indexierung geändert/);
		assert.equal(stored, null);
	} finally {
		S.settings.embedModel = originalModel;
		S.settings.embedProviderId = originalProviderId;
		S.pages = originalPages;
		EMBEDDINGS.embed = originalEmbed;
		DB.putVec = originalPutVec;
	}
});

test("updateLocalEmbeddingManagerUi keeps cache and activation state separate", async () => {
	const statusEl = document.getElementById("localEmbeddingStatus");
	const actionsEl = document.getElementById("localEmbeddingActions");
	const inpEmbed = document.getElementById("inpEmbed");

	const origStatus = AI.getLocalEmbeddingStatus;
	try {
		// Mock cached = false (Not downloaded)
		AI.getLocalEmbeddingStatus = async () => ({ id: "local:bekko-a8m", name: "Bekko a8m", sizeMb: 124, cached: false });
		await updateLocalEmbeddingManagerUi();

		assert.ok(statusEl.className.includes("is-idle"));
		assert.ok(actionsEl.querySelector("#btnDownloadLocalEmbedding"));
		assert.equal(actionsEl.querySelector("#btnDeleteLocalEmbedding"), null);
		assert.equal(inpEmbed.value, "");

		// Mock cached = true (Downloaded)
		AI.getLocalEmbeddingStatus = async () => ({ id: "local:bekko-a8m", name: "Bekko a8m", sizeMb: 124, cached: true });
		await updateLocalEmbeddingManagerUi();

		assert.ok(statusEl.className.includes("is-idle"));
		assert.ok(actionsEl.querySelector("#btnEnableLocalEmbedding"));
		assert.equal(actionsEl.querySelector("#btnDeleteLocalEmbedding"), null);
		assert.equal(inpEmbed.value, "");

		// Cached and explicitly activated
		inpEmbed.value = "local::local:bekko-a8m";
		await updateLocalEmbeddingManagerUi();

		assert.ok(statusEl.className.includes("is-ok"));
		assert.ok(actionsEl.querySelector("#btnDeleteLocalEmbedding"));
		assert.equal(actionsEl.querySelector("#btnDownloadLocalEmbedding"), null);
		assert.equal(inpEmbed.value, "local::local:bekko-a8m");
	} finally {
		AI.getLocalEmbeddingStatus = origStatus;
	}
});
