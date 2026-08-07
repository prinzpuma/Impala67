import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<!DOCTYPE html><div id="main"></div>', { url: "http://localhost/" });
for (const [key, value] of Object.entries({
	window: dom.window, document: dom.window.document, Element: dom.window.Element,
	Node: dom.window.Node, HTMLElement: dom.window.HTMLElement,
	CustomEvent: dom.window.CustomEvent, MutationObserver: dom.window.MutationObserver,
})) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const store = new Map();
globalThis.localStorage = {
	getItem: (key) => store.get(key) || null,
	setItem: (key, value) => store.set(key, String(value)),
	removeItem: (key) => store.delete(key), clear: () => store.clear(),
};

const { S, STATE } = await import("../web/state.js");
const { RENDER } = await import("../web/render.js");
STATE.dispatch = async () => {};

const messages = (prefix, count) => Array.from({ length: count }, (_, i) => ({
	mid: `${prefix}-${i}`,
	role: i % 2 ? "assistant" : "user",
	content: `Nachricht ${i}: kurze Benchmark-Antwort ohne Sonderformatierung.`,
}));

test("Warmwechsel zwischen langen Chats", () => {
	const now = new Date().toISOString();
	const one = messages("a", 300), two = messages("b", 300);
	S.chatSessions = {
		c1: { id: "c1", title: "Chat 1", created: now, updated: now, messages: one },
		c2: { id: "c2", title: "Chat 2", created: now, updated: now, messages: two },
	};
	S.view = "chat";

	const visit = (id, list) => {
		S.currentChatId = id;
		S.chat = list;
		RENDER.renderMain();
	};
	const coldStart = performance.now();
	visit("c1", one);
	visit("c2", two);
	const coldMs = (performance.now() - coldStart) / 2;

	const first = document.querySelector('.chat-full-wrap[data-chatid="c2"]');
	const iterations = 40;
	const warmStart = performance.now();
	for (let i = 0; i < iterations; i++) visit(i % 2 ? "c2" : "c1", i % 2 ? two : one);
	const warmMs = (performance.now() - warmStart) / iterations;
	visit("c2", two);
	assert.equal(document.querySelector(".chat-full-wrap"), first);
	assert.ok(warmMs < coldMs, `Warmwechsel ${warmMs.toFixed(2)} ms sollte unter Kaltaufbau ${coldMs.toFixed(2)} ms liegen`);
	console.log(`\nChatwechsel mit 300 Nachrichten: kalt ${coldMs.toFixed(2)} ms, warm ${warmMs.toFixed(2)} ms, ${((1 - warmMs / coldMs) * 100).toFixed(1)}% weniger.`);
});
