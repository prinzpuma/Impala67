"use strict";

// Lädt den Rust-Kern (web/core/, gebaut mit npm run build:core) einmal und erst bei Bedarf:
// Die erste Ansicht wartet nicht auf die WASM-Datei.
let corePromise = null;

export function loadCore() {
	corePromise ||= import("./core/impala_core.js").then(async (core) => {
		await core.default();
		return core;
	}).catch((error) => {
		corePromise = null;
		throw error;
	});
	return corePromise;
}
