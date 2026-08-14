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

const { S, STATE } = await import("../web/state.js");
const { TOOLS } = await import("../web/tools.js");

// Die Tests brauchen keine IndexedDB: der echte Reducer prüft dieselben Events, nur die
// Persistenzschicht wird durch einen synchronen In-Memory-Dispatch ersetzt.
STATE.dispatch = async (type, payload) => STATE.reduce({ id: crypto.randomUUID(), t: new Date().toISOString(), type, payload });

function reset() {
	S.pages = {};
	S.cards = {};
	S.decks = {};
	S.heftDocs = {};
	S.heftMeta = {};
	S.tabs = [];
	S.currentPageId = null;
	S.currentWorkspaceId = "default";
}

test("KI erhält nur die kompakte Werkzeugoberfläche", () => {
	assert.deepEqual(TOOLS.defs.map((x) => x.function.name), [
		"inspect", "change", "view_heft_page", "ask_choice", "calculate", "send_to_notebooklm",
	]);
	assert.ok(JSON.stringify(TOOLS.defs).length < 5000, "Tool-Schema bleibt kompakt");
});

test("gebündelte Änderungen lassen sich vollständig rückgängig machen", async () => {
	reset();
	const result = await TOOLS.run("change", { operations: [
		{ op: "page.create", title: "Physik", content: "Impuls" },
		{ op: "card.create", deck: "Physik", cards: [{ front: "Was ist Impuls?", back: "$p=mv$" }, { front: "Einheit?", back: "$Ns$" }] },
	] });
	assert.equal(result.ok, true);
	assert.equal(Object.keys(S.pages).length, 1);
	assert.equal(Object.keys(S.cards).length, 2);
	assert.ok(result._undo);

	await TOOLS.undo(result._undo);
	assert.equal(Object.keys(S.pages).length, 0);
	assert.equal(Object.keys(S.cards).length, 0);
	assert.equal(Object.keys(S.decks).length, 0);
});

test("Fehler rollen vorherige Operationen zurück", async () => {
	reset();
	const result = await TOOLS.run("change", { operations: [
		{ op: "page.create", title: "Kurzlebig", content: "wird entfernt" },
		{ op: "page.append", title: "Fehlt", content: "x" },
	] });
	assert.match(result.error, /Alle vorherigen Änderungen wurden zurückgenommen/);
	assert.equal(Object.keys(S.pages).length, 0);
});

test("stales Undo überschreibt keine neueren Änderungen", async () => {
	reset();
	const result = await TOOLS.run("change", { operations: [{ op: "page.create", title: "Sicher", content: "v1" }] });
	const page = Object.values(S.pages)[0];
	await STATE.dispatch("pageUpdate", { id: page.id, patch: { content: "v2" } });
	await assert.rejects(() => TOOLS.undo(result._undo), /erneut geändert/);
	assert.equal(S.pages[page.id].content, "v2");
});

test("eine einzelne Karte lässt sich über card.move verschieben", async () => {
	reset();
	await STATE.dispatch("cardCreate", { id: "eins", front: "Einzelfrage", back: "Antwort", deck: "Alt" });
	const result = await TOOLS.run("change", { operations: [{ op: "card.move", front: "Einzelfrage", to: "Neu" }] });
	assert.equal(result.ok, true);
	assert.equal(S.cards.eins.deck, "Neu");
});

test("Integralgrenzen dürfen verschachtelte Kommas enthalten", async () => {
	window.math = {
		evaluate: (expr) => expr === "min(1,2)" ? 1 : expr === "max(2,3)" ? 3 : Number(expr),
		compile: () => ({ evaluate: ({ x }) => x }),
		format: (value) => String(value),
	};
	const result = await TOOLS.run("calculate", { expression: 'integrate("x","x",min(1,2),max(2,3))' });
	assert.equal(result.ok, true);
	assert.ok(Math.abs(Number(result.result) - 4) < 1e-9);
});
