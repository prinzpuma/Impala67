"use strict";

import { PERF_PROFILER } from "./performance-profiler.js";

// Einziges angebotenes lokales Embedding-Modell (Bekko a8m, läuft im Worker).
export const LOCAL_EMBED_MODEL_ID = "local:bekko-a8m";

export const LOCAL_EMBEDDING_MODELS = [
	{
		id: LOCAL_EMBED_MODEL_ID,
		hfId: "hotchpotch/bekko-embedding-v1-a8m",
		name: "Bekko a8m (Lokal im Browser, 256d)",
		dim: 256,
		sizeMb: 165,
		context: 8192,
		providerId: "local",
		providerName: "Lokal (Offline)",
		recommended: true,
	},
];

// Stand der lokal erzeugten Vektoren. Erhöhen, wenn dasselbe Modell andere Vektoren
// liefert (z. B. Runtime-Update) — gespeicherte Vektoren gelten dann als veraltet
// und werden einmal neu berechnet. r2: Transformers.js 4 (korrekte Tokenisierung).
const LOCAL_EMBED_REVISION = 2;

// Modellkennung, unter der Vektoren gespeichert und verglichen werden.
export function vectorModelKey(model) {
	const id = String(model || "");
	return id === LOCAL_EMBED_MODEL_ID ? id + "#r" + LOCAL_EMBED_REVISION : id;
}

// Nur vollständige, endliche Vektoren dürfen in den Index.
export function isValidVector(vec) {
	if (!vec || !vec.length) return false;
	for (let i = 0; i < vec.length; i++) if (!Number.isFinite(vec[i])) return false;
	return true;
}

let embeddingWorker = null;
let embeddingWorkerReqId = 0;
const embeddingWorkerPending = new Map();
const embeddingWorkerListeners = new Set();

function getEmbeddingWorker() {
	if (!embeddingWorker && typeof Worker !== "undefined") {
		try {
			embeddingWorker = new Worker("./embedding-worker.js", { type: "module" });
			embeddingWorker.addEventListener("message", (e) => {
				const msg = e.data;
				if (!msg) return;
				if (msg.loadInfo) PERF_PROFILER.record("operation", msg.loadInfo.loadMs || 0, { name: "embedding.model-load", ...msg.loadInfo });
				if (msg.type === "progress") {
					for (const l of embeddingWorkerListeners) {
						try { l(msg); } catch {}
					}
				}
				if (msg.id && embeddingWorkerPending.has(msg.id)) {
					const { resolve, reject } = embeddingWorkerPending.get(msg.id);
					embeddingWorkerPending.delete(msg.id);
					if (msg.type === "error") reject(new Error(msg.error || "Worker-Fehler"));
					else resolve(msg);
				}
			});
			embeddingWorker.addEventListener("error", (err) => {
				console.warn("Embedding Worker Error:", err);
				PERF_PROFILER.error("embedding-worker-error", new Error(err?.message || "Embedding Worker Fehler"));
				for (const [, { reject }] of embeddingWorkerPending) {
					reject(new Error(err?.message || "Embedding Worker Fehler"));
				}
				embeddingWorkerPending.clear();
			});
		} catch (e) {
			console.warn("Konnte Embedding Worker nicht starten:", e);
		}
	}
	return embeddingWorker;
}

function postEmbeddingWorkerMessage(type, payload = {}) {
	const worker = getEmbeddingWorker();
	if (!worker) return Promise.reject(new Error("Web Worker werden in diesem Browser nicht unterstützt."));
	const id = "emb_" + (++embeddingWorkerReqId) + "_" + Date.now();
	return new Promise((resolve, reject) => {
		embeddingWorkerPending.set(id, { resolve, reject });
		worker.postMessage({ type, id, ...payload });
	});
}

function onEmbeddingProgress(listener) {
	embeddingWorkerListeners.add(listener);
	return () => embeddingWorkerListeners.delete(listener);
}

function resolveLocalModel(modelId = LOCAL_EMBED_MODEL_ID) {
	return LOCAL_EMBEDDING_MODELS.find((m) => m.id === modelId) || LOCAL_EMBEDDING_MODELS[0];
}

async function getLocalEmbeddingStatus(modelId = LOCAL_EMBED_MODEL_ID) {
	const def = resolveLocalModel(modelId);
	try {
		const res = await postEmbeddingWorkerMessage("status", { model: def.hfId });
		return { ...def, cached: !!res.cached, partial: !!res.partial, loadedInRam: !!res.loadedInRam };
	} catch (err) {
		return { ...def, cached: false, partial: false, loadedInRam: false, error: err?.message };
	}
}

async function downloadLocalEmbedding(modelId = LOCAL_EMBED_MODEL_ID) {
	const def = resolveLocalModel(modelId);
	return await postEmbeddingWorkerMessage("download", { model: def.hfId, dim: def.dim });
}

async function deleteLocalEmbedding(modelId = LOCAL_EMBED_MODEL_ID) {
	const def = resolveLocalModel(modelId);
	return await postEmbeddingWorkerMessage("delete", { model: def.hfId });
}

async function listEmbeddingModels() {
	return LOCAL_EMBEDDING_MODELS.map((m) => ({
		id: m.id,
		providerId: m.providerId,
		providerName: m.providerName,
		label: m.name,
	}));
}

async function embedLocal(texts, { modelId = LOCAL_EMBED_MODEL_ID, priority = "foreground" } = {}) {
	if (!Array.isArray(texts)) throw new TypeError("Embedding-Texte müssen als Array übergeben werden.");
	const def = resolveLocalModel(modelId);
	const res = await postEmbeddingWorkerMessage("embed", { texts, model: def.hfId, dim: def.dim, priority });
	if (!res || !Array.isArray(res.vectors)) throw new Error("Lokales Embedding lieferte keine Vektoren.");
	if (res.vectors.length !== texts.length) throw new Error(`Lokales Embedding unvollständig (${res.vectors.length}/${texts.length}).`);
	return res.vectors;
}

// Schmale, zyklusfreie Schnittstelle zwischen RAG/Einstellungen und der KI-Implementierung.
// Der lokale Embedding-Worker wird direkt hier verwaltet; ai.js registriert den Adapter für
// den kombinierten Embedding-Aufruf (lokal oder Remote-Provider).
let adapter = null;

function requireAdapter() {
	if (!adapter) throw new Error("Embedding-Dienst ist noch nicht initialisiert.");
	return adapter;
}

export const EMBEDDINGS = {
	LOCAL_EMBEDDING_MODELS,
	setAdapter(next) {
		if (!next || typeof next.embed !== "function") {
			throw new TypeError("Der Embedding-Adapter benötigt eine embed-Funktion.");
		}
		adapter = next;
	},
	embed: (texts, ...args) => PERF_PROFILER.run("embedding.embed", () => requireAdapter().embed(texts, ...args), { count: texts?.length }, 100),
	embedLocal,
	listModels: (...args) => (adapter?.listModels ? adapter.listModels(...args) : listEmbeddingModels(...args)),
	getLocalStatus: (...args) => (adapter?.getLocalStatus ? adapter.getLocalStatus(...args) : getLocalEmbeddingStatus(...args)),
	downloadLocal: (...args) => (adapter?.downloadLocal ? adapter.downloadLocal(...args) : downloadLocalEmbedding(...args)),
	deleteLocal: (...args) => (adapter?.deleteLocal ? adapter.deleteLocal(...args) : deleteLocalEmbedding(...args)),
	onProgress: (...args) => (adapter?.onProgress ? adapter.onProgress(...args) : onEmbeddingProgress(...args)),
};
