"use strict";

// Schmale, zyklusfreie Schnittstelle zwischen RAG und der KI-Implementierung.
// ai.js registriert genau einen Adapter; RAG muss ai.js dadurch nicht mehr
// zurueck-importieren und kann Embeddings trotzdem unabhaengig verwenden.
let adapter = null;

function requireAdapter() {
	if (!adapter) throw new Error("Embedding-Dienst ist noch nicht initialisiert.");
	return adapter;
}

import { PERF_PROFILER } from "./performance-profiler.js";

// Einziges angebotenes lokales Embedding-Modell (Bekko a8m, läuft im Worker).
export const LOCAL_EMBED_MODEL_ID = "local:bekko-a8m";

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

export const EMBEDDINGS = {
	setAdapter(next) {
		if (!next || typeof next.embed !== "function") {
			throw new TypeError("Der Embedding-Adapter benötigt eine embed-Funktion.");
		}
		adapter = next;
	},
	embed: (texts, ...args) => PERF_PROFILER.run("embedding.embed", () => requireAdapter().embed(texts, ...args), { count: texts?.length }, 100),
	listModels: (...args) => requireAdapter().listModels(...args),
	getLocalStatus: (...args) => requireAdapter().getLocalStatus(...args),
	downloadLocal: (...args) => requireAdapter().downloadLocal(...args),
	deleteLocal: (...args) => requireAdapter().deleteLocal(...args),
	onProgress: (...args) => requireAdapter().onProgress(...args),
};
