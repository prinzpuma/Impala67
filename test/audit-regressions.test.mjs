import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
for (const key of ["window", "document", "Element", "Node", "HTMLElement", "MutationObserver", "navigator"]) {
	Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });
Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true });

const { S, STATE } = await import("../web/state.js");
const { SRS } = await import("../web/srs.js");
const { splitThink } = await import("../web/think-heuristik.js");

const reset = () => {
	S.pages = {}; S.cards = {}; S.decks = {}; S.gnFolders = {}; S.reviews = [];
};

test("Stapelduplikate erhalten beim Replay desselben Events dieselben Karten-IDs", () => {
	reset();
	S.decks.Alt = { name: "Alt" };
	S.cards.karte = { id: "karte", front: "F", back: "B", deck: "Alt", srs: SRS.newCard("2026-01-01T00:00:00.000Z") };
	const ev = { id: "duplicate-event", t: "2026-01-02T00:00:00.000Z", type: "deckDuplicate", payload: { name: "Alt" } };
	STATE.reduce(ev);
	const first = Object.keys(S.cards).filter((id) => id !== "karte");
	delete S.cards[first[0]]; delete S.decks["Alt (Kopie)"];
	STATE.reduce(ev);
	assert.deepEqual(Object.keys(S.cards).filter((id) => id !== "karte"), first);
});

test("Heftordner-Reihenfolge stammt aus dem Event statt aus der lokalen Uhr", () => {
	reset();
	STATE.reduce({ id: "folder-event", t: "2026-01-02T03:04:05.000Z", type: "gnFolderCreate", payload: { id: "f" } });
	assert.equal(S.gnFolders.f.order, Date.parse("2026-01-02T03:04:05.000Z"));
});

test("Seiten ohne Titel machen die Seitensuche nicht unbrauchbar", () => {
	reset();
	S.pages.leer = { id: "leer", content: "", trashed: false };
	assert.doesNotThrow(() => STATE.findPage("x"));
});

test("leere KI-Nachrichten sind für die Thinking-Aufteilung gültig", () => {
	assert.deepEqual(splitThink(null), { content: "", reasoning: "" });
});
