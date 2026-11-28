"use strict";

// Schlüsselableitung des Cloudflare-Syncs (100 000 PBKDF2-Runden im Kern) abseits des UI-Threads:
// Im Hauptthread blockierte sie jeden Start ~200 ms. Antwort: { key } als Hex-Text oder { error }.
// Kern erst bei Bedarf laden (top-level await), sonst ginge die erste Nachricht verloren.
const coreReady = import("./rust-core.js");

self.onmessage = async ({ data }) => {
	try {
		const { CORE } = await coreReady;
		self.postMessage({ key: CORE.deriveSyncKey(String(data || "")) });
	} catch (error) {
		self.postMessage({ error: String(error?.message || error) });
	}
};
