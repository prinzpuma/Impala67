import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
for (const key of ["window", "document", "Element", "Node", "HTMLElement", "MutationObserver", "navigator"]) {
	Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });
Object.defineProperty(globalThis, "requestAnimationFrame", { value: (fn) => setTimeout(fn, 0), configurable: true });
Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true });

const { S } = await import("../web/state.js");
const { AI } = await import("../web/ai.js");

test("Modellabfragen ignorieren nicht eingerichtete Cloud-Quellen", async () => {
	S.settings.aiProviders = [
		{ id: "google", name: "Google", base: "https://generativelanguage.googleapis.com/v1beta/openai", key: "" },
		{ id: "openai", name: "OpenAI", base: "https://api.openai.com/v1", key: "" },
		{ id: "local-test", name: "Lokal", base: "http://127.0.0.1:45671/v1", key: "" },
	];
	let calls = 0;
	globalThis.fetch = async (url) => {
		calls++;
		assert.equal(url, "http://127.0.0.1:45671/v1/models");
		return { ok: true, json: async () => ({ data: [{ id: "local-chat" }] }) };
	};

	assert.deepEqual(await AI.listModels(), [{ id: "local-chat", providerId: "local-test" }]);
	assert.equal(calls, 1);
});

test("parallele und kurz aufeinanderfolgende Modellabfragen teilen sich eine Anfrage", async () => {
	S.settings.aiProviders = [
		{ id: "cache-test", name: "Testserver", base: "http://127.0.0.1:45672/v1", key: "" },
	];
	let calls = 0;
	globalThis.fetch = async () => {
		calls++;
		await new Promise((resolve) => setTimeout(resolve, 5));
		return { ok: true, json: async () => ({ data: [{ id: "fast-model" }] }) };
	};

	const [a, b] = await Promise.all([AI.listModels(), AI.listModels()]);
	assert.deepEqual(a, b);
	await AI.listModels();
	assert.equal(calls, 1);

	await AI.listModels({ force: true });
	assert.equal(calls, 2);
});
