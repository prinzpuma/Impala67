"use strict";

// web/embedding-worker.js — Web Worker für lokale Inferenz mit Transformers.js v3.
// Führt die Bekko-a8m-Inferenz komplett abseits des UI-Threads aus.
// Nutzt WebGPU, wenn ein Adapter verfügbar ist, sonst WASM-CPU; Matryoshka-Kürzung (z.B. 256d)
// und L2-Normalisierung. Geraeteabhaengiges Auto-Unload begrenzt den RAM, ohne
// bei jeder kurzen Arbeitspause die teure Pipeline erneut aufzubauen.

let pipeline = null;
let env = null;
let extractor = null;
let currentModel = null;
let currentDevice = null;
let currentDim = 256;
let idleTimer = null;
let isInitializing = false;
let initPromise = null;

const idleTimeoutMs = () => {
	const memory = Number(typeof navigator !== "undefined" && navigator.deviceMemory) || 0;
	if (isAppleTouchDevice() || (memory && memory <= 4)) return 3 * 60000;
	return 10 * 60000;
};

function resetIdleTimer() {
	if (idleTimer) clearTimeout(idleTimer);
	idleTimer = setTimeout(() => {
		unloadModel();
	}, idleTimeoutMs());
}

function unloadModel() {
	if (extractor) {
		try {
			if (typeof extractor.dispose === "function") extractor.dispose();
		} catch (e) { console.warn("Fehler beim Entladen des Modells:", e); }
		extractor = null;
	}
	currentModel = null;
	currentDevice = null;
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


function isAppleTouchDevice() {
	if (typeof navigator === "undefined") return false;
	const ua = String(navigator.userAgent || "");
	const platform = String(navigator.platform || "");
	// iPadOS can report a desktop Mac user agent, and WorkerNavigator may not
	// expose maxTouchPoints. Treating Mac-like Apple user agents conservatively
	// also keeps Safari/WebKit on the safer WASM path.
	return /iPad|iPhone|iPod|Macintosh/i.test(ua) || (platform === "MacIntel" && Number(navigator.maxTouchPoints || 0) > 1);
}

async function chooseDevice() {
	if (isAppleTouchDevice()) {
		console.info("Apple-Touch-Gerät erkannt, verwende speicherschonendes WASM statt WebGPU.");
		return "wasm";
	}
	try {
		if (typeof navigator !== "undefined" && navigator.gpu && typeof navigator.gpu.requestAdapter === "function") {
			const adapter = await navigator.gpu.requestAdapter();
			if (adapter) return "webgpu";
		}
	} catch (e) {
		console.info("WebGPU nicht verfügbar, verwende WASM:", e?.message || e);
	}
	return "wasm";
}

function postProgress(modelId, p) {
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
			const device = await chooseDevice();
			let usedDevice = device;
			const options = {
				device,
				// Bekko veröffentlicht die browseroptimierte Datei als onnx/model.onnx.
				// Transformers.js wählt genau diese Datei mit dtype "fp32"; die Datei
				// selbst enthält bereits die kompakte int8-Embedding-Tabelle.
				dtype: "fp32",
				progress_callback: (p) => onProgress?.(p),
			};
			try {
				extractor = await pipeline("feature-extraction", modelId, options);
			} catch (err) {
				if (device !== "webgpu") throw err;
				console.warn("WebGPU-Modellstart fehlgeschlagen, wechsle auf WASM:", err?.message || err);
				usedDevice = "wasm";
				extractor = await pipeline("feature-extraction", modelId, { ...options, device: "wasm" });
			}
			currentModel = modelId;
			currentDevice = usedDevice;
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

function belongsToModel(url, modelId) {
	const raw = String(url || "");
	let decoded = raw;
	try { decoded = decodeURIComponent(raw); } catch {}
	return decoded.includes(modelId) || raw.includes(modelId.replace(/\//g, "%2F"));
}

const REQUIRED_MODEL_FILES = ["/config.json", "/tokenizer.json", "/tokenizer_config.json", "/onnx/model.onnx"];

function cachedModelFile(url) {
	let path;
	try {
		path = decodeURIComponent(new URL(url).pathname);
	} catch {
		path = String(url || "").split(/[?#]/, 1)[0];
	}
	return REQUIRED_MODEL_FILES.find((file) => path.endsWith(file)) || null;
}

async function modelCacheStatus(modelId = "hotchpotch/bekko-embedding-v1-a8m") {
	try {
		if (typeof caches === "undefined") return { cached: false, partial: false };
		const cacheNames = await caches.keys();
		const missing = new Set(REQUIRED_MODEL_FILES);
		let partial = false;
		for (const name of cacheNames) {
			if (name.includes("transformers") || name.includes("impala67")) {
				const cache = await caches.open(name);
				const requests = await cache.keys();
				for (const request of requests) {
					if (!belongsToModel(request.url, modelId)) continue;
					partial = true;
					const file = cachedModelFile(request.url);
					if (file) missing.delete(file);
				}
			}
		}
		return { cached: missing.size === 0, partial: partial && missing.size > 0 };
	} catch {
		return { cached: false, partial: false };
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
					if (belongsToModel(r.url, modelId)) {
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

const foregroundEmbeds = [], backgroundEmbeds = [];
let processingEmbeds = false;

async function runEmbed(msg) {
	const { texts, model = "hotchpotch/bekko-embedding-v1-a8m", dim = 256, id } = msg;
	if (!Array.isArray(texts)) {
		self.postMessage({ type: "error", id, error: "texts muss ein Array sein." });
		return;
	}
	try {
		const ext = await initExtractor(model, dim, (p) => postProgress(model, p));
		resetIdleTimer();
		const output = await ext(texts, { pooling: "mean", normalize: false });
		const rawVectors = typeof output.tolist === "function" ? output.tolist() : Array.from(output);
		const vectors = rawVectors.map((v) => {
			const arr = Array.isArray(v) ? v : Array.from(v);
			const sliced = dim && dim < arr.length ? arr.slice(0, dim) : arr;
			return normalizeVec(sliced);
		});
		self.postMessage({ type: "embed-result", id, vectors });
	} catch (err) {
		self.postMessage({ type: "error", id, error: String(err?.message || err) });
	}
}

async function processEmbedQueue() {
	if (processingEmbeds) return;
	processingEmbeds = true;
	try {
		while (foregroundEmbeds.length || backgroundEmbeds.length) {
			await runEmbed(foregroundEmbeds.shift() || backgroundEmbeds.shift());
		}
	} finally { processingEmbeds = false; }
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
			const cacheStatus = await modelCacheStatus(model);
			self.postMessage({
				type: "status-result",
				model,
				cached: cacheStatus.cached,
				partial: cacheStatus.partial,
				loadedInRam: !!extractor && currentModel === model,
				device: currentModel === model ? currentDevice : null,
				id: msg.id,
			});
			break;
		}

		case "download": {
			const model = msg.model || "hotchpotch/bekko-embedding-v1-a8m";
			const dim = msg.dim || 256;
			try {
				await initExtractor(model, dim, (p) => postProgress(model, p));
				self.postMessage({
					type: "download-complete",
					model,
					device: currentDevice,
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
			(msg.priority === "background" ? backgroundEmbeds : foregroundEmbeds).push(msg);
			processEmbedQueue();
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
