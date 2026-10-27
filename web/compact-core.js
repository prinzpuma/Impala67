"use strict";
import { compactEvents } from "./compact-events.js";

// Kompaktierung über den Rust-Kern (Quellcode in core/, als WASM in web/core/, gebaut mit
// npm run build:core). Liefert dasselbe Ergebnis wie compactEvents – die Golden-Tests in
// core/ vergleichen beide. Rückfall auf JS, wenn das Modul nicht lädt (alte WebView, Datei
// fehlt) oder das Log Formen enthält, die nur die JS-Regeln abdecken (der Kern wirft dann).
// Über die Grenze wandern nur die Felder, die die Regeln lesen; zurück kommen Indizes.
export async function loadCompact(wasmSource) {
	try {
		const core = await import("./core/impala_core.js");
		await core.default(wasmSource ? { module_or_path: wasmSource } : undefined);
		return (events) => {
			try {
				return Array.from(core.compactOrder(events), (i) => events[i]);
			} catch (e) {
				console.warn("Rust-Kern: Kompaktierung läuft in JS –", e?.message || e);
				return compactEvents(events);
			}
		};
	} catch (e) {
		console.warn("Rust-Kern nicht geladen, Kompaktierung läuft in JS –", e?.message || e);
		return compactEvents;
	}
}
