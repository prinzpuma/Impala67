"use strict";

// web/embedding-worker.js — Web Worker für lokale Inferenz mit Transformers.js v3.
// Führt Inferenz (Bekko a8m, Granite 97M, etc.) komplett abseits des UI-Threads aus.
// Unterstützt WebGPU mit automatischem WASM-CPU-Fallback, Matryoshka-Kürzung (z.B. 256d)
// und L2-Normalisierung. Auto-Unload nach 60 s Inaktivität (0 MB RAM im Leerlauf).

let pipeline = null;
let env = null;
let extractor = null;
let currentModel = null;
let currentDim = 256;
let idleTimer = null;
let isInitializing = false;
let initPromise = null;

const IDLE_TIMEOUT_MS = 60000; // 60s bis zum Entladen aus dem RAM

function resetIdleTimer() {
	if (idleTimer) clearTimeout(idleTimer);
	idleTimer = setTimeout(() => {
		unloadModel();
	}, IDLE_TIMEOUT_MS);
}

function unloadModel() {
	if (extractor) {
		try {
			if (typeof extractor.dispose === "function") extractor.dispose();
		} catch (e) { console.warn("Fehler beim Entladen des Modells:", e); }
		extractor = null;
	}
	currentModel = null;
	try {
		self.postMessage({ type: "unloaded" });
	} catch {}
}

// L2-Normalisierung für exakte Kosinus-Ähnlichkeit via Skalarprodukt
function normalizeVec(vec) {
	let sum = 0;
	for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
	const norm = Math.sqrt(sum) || 1;
	const out = new Array(vec.length);
	for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
	return out;
}

async function loadTransformers() {
	if (!pipeline) {
		const tf = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3");
		pipeline = tf.pipeline;
		env = tf.env;
		if (env) {
			env.allowLocalModels = false;
			env.useBrowserCache = true;
		}
	}
	return { pipeline, env };
}

async function initExtractor(modelId = "hotchpotch/bekko-embedding-v1-a8m", dim = 256, onProgress = null) {
	if (extractor && currentModel === modelId) {
		currentDim = dim;
		resetIdleTimer();
		return extractor;
	}
	if (isInitializing && initPromise) return initPromise;

	isInitializing = true;
	initPromise = (async () => {
		try {
			await loadTransformers();
			const options = {
				device: "webgpu", // Transformers.js fällt automatisch auf WASM zurück, wenn WebGPU nicht verfügbar ist
				progress_callback: (p) => {
					if (onProgress) onProgress(p);
					try {
						self.postMessage({
							type: "progress",
							model: modelId,
							status: p.status,
							file: p.file,
							progress: p.progress,
							loaded: p.loaded,
							total: p.total,
						});
					} catch {}
				},
			};
			extractor = await pipeline("feature-extraction", modelId, options);
			currentModel = modelId;
			currentDim = dim;
			resetIdleTimer();
			return extractor;
		} finally {
			isInitializing = false;
			initPromise = null;
		}
	})();

	return initPromise;
}

async function isModelCached(modelId = "hotchpotch/bekko-embedding-v1-a8m") {
	try {
		if (typeof caches === "undefined") return false;
		const cacheNames = await caches.keys();
		for (const name of cacheNames) {
			if (name.includes("transformers") || name.includes("impala67")) {
				const cache = await caches.open(name);
				const requests = await cache.keys();
				const hasModel = requests.some((r) => r.url.includes(modelId.replace(/\//g, "%2F")) || r.url.includes(modelId));
				if (hasModel) return true;
			}
		}
		return false;
	} catch {
		return false;
	}
}

async function deleteModelCache(modelId = "hotchpotch/bekko-embedding-v1-a8m") {
	unloadModel();
	try {
		if (typeof caches === "undefined") return false;
		const cacheNames = await caches.keys();
		let deletedCount = 0;
		for (const name of cacheNames) {
			if (name.includes("transformers") || name.includes("impala67")) {
				const cache = await caches.open(name);
				const requests = await cache.keys();
				for (const r of requests) {
					if (r.url.includes(modelId.replace(/\//g, "%2F")) || r.url.includes(modelId)) {
						await cache.delete(r);
						deletedCount++;
					}
				}
			}
		}
		return deletedCount > 0;
	} catch (e) {
		console.warn("Fehler beim Löschen des Modell-Caches:", e);
		return false;
	}
}

self.addEventListener("message", async (e) => {
	const msg = e.data;
	if (!msg || !msg.type) return;

	switch (msg.type) {
		case "ping":
			self.postMessage({ type: "pong" });
			break;

		case "status": {
			const model = msg.model || "hotchpotch/bekko-embedding-v1-a8m";
			const cached = await isModelCached(model);
			self.postMessage({
				type: "status-result",
				model,
				cached,
				loadedInRam: !!extractor && currentModel === model,
				id: msg.id,
			});
			break;
		}

		case "download": {
			const model = msg.model || "hotchpotch/bekko-embedding-v1-a8m";
			const dim = msg.dim || 256;
			try {
				await initExtractor(model, dim);
				self.postMessage({
					type: "download-complete",
					model,
					id: msg.id,
				});
			} catch (err) {
				self.postMessage({
					type: "error",
					id: msg.id,
					error: String(err?.message || err),
				});
			}
			break;
		}

		case "embed": {
			const { texts, model = "hotchpotch/bekko-embedding-v1-a8m", dim = 256, id } = msg;
			if (!Array.isArray(texts)) {
				self.postMessage({ type: "error", id, error: "texts muss ein Array sein." });
				return;
			}
			try {
				const ext = await initExtractor(model, dim);
				resetIdleTimer();

				// Feature-Extraction mit mean pooling
				const output = await ext(texts, { pooling: "mean", normalize: false });
				const rawVectors = typeof output.tolist === "function" ? output.tolist() : Array.from(output);

				// Matryoshka-Kürzung (z.B. auf 256 Dimensionen) und anschließende L2-Normalisierung
				const vectors = rawVectors.map((v) => {
					const arr = Array.isArray(v) ? v : Array.from(v);
					const sliced = dim && dim < arr.length ? arr.slice(0, dim) : arr;
					return normalizeVec(sliced);
				});

				self.postMessage({
					type: "embed-result",
					id,
					vectors,
				});
			} catch (err) {
				self.postMessage({
					type: "error",
					id,
					error: String(err?.message || err),
				});
			}
			break;
		}

		case "delete": {
			const model = msg.model || "hotchpotch/bekko-embedding-v1-a8m";
			const success = await deleteModelCache(model);
			self.postMessage({
				type: "delete-result",
				model,
				success,
				id: msg.id,
			});
			break;
		}

		case "unload": {
			unloadModel();
			break;
		}
	}
});
