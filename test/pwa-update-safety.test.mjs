import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("neuer Service Worker übernimmt eine laufende alte App nicht automatisch", async () => {
	const sw = await readFile(new URL("../web/service-worker.js", import.meta.url), "utf8");
	const install = sw.slice(sw.indexOf('self.addEventListener("install"'), sw.indexOf('self.addEventListener("activate"'));
	assert.doesNotMatch(install, /\.then\(\(\) => self\.skipWaiting\(\)\)/);
	assert.match(sw, /e\.data\?\.type === "SKIP_WAITING"/);
	assert.match(sw, /sync-maintenance\.js/);
	assert.match(sw, /rag-worker\.js/);
	assert.match(sw, /rag-ranking\.js/);
});

test("Updater aktiviert waiting Worker erst beim bewussten Installationspfad", async () => {
	const updater = await readFile(new URL("../web/updater.js", import.meta.url), "utf8");
	assert.match(updater, /waiting\.postMessage\(\{ type: "SKIP_WAITING" \}\)/);
	assert.match(updater, /controllerchange/);
	const check = updater.slice(updater.indexOf("window.checkAppUpdate"), updater.indexOf("window.installAppUpdate"));
	assert.doesNotMatch(check, /postMessage\(\{ type: "SKIP_WAITING" \}\)/);
});
