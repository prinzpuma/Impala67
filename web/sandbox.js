"use strict";

// Spielwiese für den KI-Benchmark (tools/ai-bench): eine eigene Kopie der Daten auf einem eigenen
// Browser-Ursprung (eigene IndexedDB). Dort schreiben die Werkzeuge echt, aber nichts verlässt das
// Gerät: kein Cloudflare-Sync, kein Drive-Backup, und die MCP-Bridge spricht nur mit dem Benchmark.
// Einschalten: ?sandbox=<Port der Benchmark-Bridge> – nur auf einem unbenutzten Ursprung (ohne
// gespeicherte Impala-Einträge), damit die echte App nie versehentlich zur Spielwiese wird.
// Danach bleibt sie es (Merkzeichen im localStorage), bis die Website-Daten gelöscht werden.
const KEY = "impala67Sandbox";

function detect() {
	try {
		const port = Number(localStorage.getItem(KEY)) || 0;
		if (port) return port;
		const asked = Number(new URLSearchParams(location.search).get("sandbox")) || 0;
		if (!asked) return 0;
		const used = Object.keys(localStorage).some((k) => /^(impala|notion)/i.test(k));
		if (used) { console.warn("[Spielwiese] Abgelehnt: Dieser Ursprung enthält schon App-Daten."); return 0; }
		localStorage.setItem(KEY, String(asked));
		return asked;
	} catch { return 0; }
}

const port = typeof window === "undefined" ? 0 : detect();
export const SANDBOX = Object.freeze({ on: port > 0, bridgeUrl: port ? `ws://127.0.0.1:${port}` : "" });
if (SANDBOX.on && typeof document !== "undefined") document.title = "Spielwiese · " + document.title;
