import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = {};
globalThis.location = { href: "https://example.test/Impala67/" };
Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });

const { cmpSemver, fetchDeployedVersion, workerVersion } = await import("../web/updater.js?test=worker-fallback");

test("cmpSemver vergleicht semantische Versionsnummern korrekt", () => {
	assert.equal(cmpSemver("0.3.0", "0.3.1") < 0, true);
	assert.equal(cmpSemver("0.3.1", "0.3.0") > 0, true);
	assert.equal(cmpSemver("0.3.0", "0.3.0"), 0);
	assert.equal(cmpSemver("v0.3.1", "0.3.0") > 0, true);
	assert.equal(cmpSemver("0.3.0-beta.1", "0.3.0") < 0, true);
	assert.equal(cmpSemver("0.3.0", "0.3.0-beta.1") > 0, true);
	assert.equal(cmpSemver("1.0.0", "0.9.9") > 0, true);
});

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

test("installAppUpdate sendet SKIP_WAITING und lädt sicher neu, selbst wenn der Worker träge antwortet", async () => {
	let skipWaitingSent = false;
	let reloadedUrl = null;
	globalThis.location = {
		href: "https://example.test/Impala67/",
		replace(url) { reloadedUrl = url; }
	};
	globalThis.navigator.serviceWorker = {
		controller: null,
		async getRegistration() {
			return {
				waiting: {
					postMessage(msg) {
						if (msg.type === "SKIP_WAITING") skipWaitingSent = true;
					}
				}
			};
		}
	};

	const res = await globalThis.window.installAppUpdate();
	assert.equal(skipWaitingSent, true);
	assert.equal(res.reloaded, true);
	assert.match(reloadedUrl, /\?_v=\d+/);
});

