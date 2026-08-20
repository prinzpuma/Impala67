"use strict";

// Schmale, zyklusfreie Schnittstelle zwischen RAG und der KI-Implementierung.
// ai.js registriert genau einen Adapter; RAG muss ai.js dadurch nicht mehr
// zurueck-importieren und kann Embeddings trotzdem unabhaengig verwenden.
let adapter = null;

function requireAdapter() {
	if (!adapter) throw new Error("Embedding-Dienst ist noch nicht initialisiert.");
	return adapter;
}

export const EMBEDDINGS = {
	setAdapter(next) {
		if (!next || typeof next.embed !== "function") {
			throw new TypeError("Der Embedding-Adapter benötigt eine embed-Funktion.");
		}
		adapter = next;
	},
	embed: (...args) => requireAdapter().embed(...args),
	listModels: (...args) => requireAdapter().listModels(...args),
	getLocalStatus: (...args) => requireAdapter().getLocalStatus(...args),
	downloadLocal: (...args) => requireAdapter().downloadLocal(...args),
	deleteLocal: (...args) => requireAdapter().deleteLocal(...args),
	onProgress: (...args) => requireAdapter().onProgress(...args),
};
