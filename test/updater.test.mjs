import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = {};
globalThis.location = { href: "https://example.test/Impala67/" };
Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });

const { fetchDeployedVersion, workerVersion } = await import("../web/updater.js?test=worker-fallback");

test("Update-Check nutzt den Service-Worker, wenn version.json ausfällt", async () => {
	const requested = [];
	globalThis.fetch = async (url) => {
		requested.push(String(url));
		if (requested.length < 3) {
			return { ok: false, status: 503, headers: { get: () => "application/json" } };
		}
		return {
			ok: true,
			status: 200,
			text: async () => 'const CACHE = "impala67-v0.3.42";',
		};
	};

	const result = await fetchDeployedVersion();
	assert.deepEqual(result, { latest: "0.3.42", source: "service-worker.js" });
	assert.equal(requested.length, 3);
});

test("Updater liest die tatsächlich geladene Version direkt vom Service Worker", async () => {
	const worker = {
		postMessage(message, ports) {
			assert.deepEqual(message, { type: "GET_VERSION" });
			ports[0].postMessage({ type: "VERSION", version: "0.3.42" });
		},
	};
	assert.equal(await workerVersion(worker), "0.3.42");
});
