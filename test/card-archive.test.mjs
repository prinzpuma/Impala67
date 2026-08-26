import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body><main id=main></main></body>", { url: "http://localhost/" });
for (const key of ["window", "document", "Element", "Node", "HTMLElement", "MutationObserver", "navigator"]) {
	Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });
Object.defineProperty(globalThis, "requestAnimationFrame", { value: (fn) => setTimeout(fn, 0), configurable: true });
Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true });
Object.defineProperty(globalThis, "ResizeObserver", { value: class { observe() {} disconnect() {} }, configurable: true });

const { S, STATE } = await import("../web/state.js");
const { SRS } = await import("../web/srs.js");
const { RENDER_ANKI } = await import("../web/render-anki.js");
const { GRAPH } = await import("../web/graph.js");

function card(id, deck, extra = {}) {
	return { id, deck, front: "Frage " + id, back: "Antwort " + id, suspended: false,
		srs: SRS.newCard("2026-08-25T00:00:00.000Z"), created: "2026-08-25T00:00:00.000Z", ...extra };
}

function reset() {
	S.cards = {
		active: card("active", "Aktiv"),
		inParent: card("inParent", "Mathe::Analysis"),
		own: card("own", "Aktiv", { archived: true, archivedAt: "2026-08-26T10:00:00.000Z" }),
	};
	S.decks = {
		Aktiv: { name: "Aktiv" },
		Mathe: { name: "Mathe", archived: true, archivedAt: "2026-08-26T09:00:00.000Z" },
		"Mathe::Analysis": { name: "Mathe::Analysis" },
	};
	S.reviews = [];
	S.ankiDeck = null;
	S.ankiTab = "decks";
	S.ankiSearch = "";
}

test("Stapelarchiv wird zentral an Unterstapel und Karten vererbt", () => {
	reset();
	assert.equal(STATE.isDeckArchived("Mathe::Analysis"), true);
	assert.equal(STATE.isCardArchived(S.cards.inParent), true);
	assert.equal(STATE.isCardArchived(S.cards.own), true);
	assert.deepEqual(STATE.activeCards().map((item) => item.id), ["active"]);
	assert.deepEqual(STATE.studySnapshot(null, new Date("2026-08-26T12:00:00.000Z")).dueNow.map((item) => item.id), ["active"]);
});

test("Wiederherstellen eines Stapels verändert eigene Kartenarchive nicht", () => {
	reset();
	STATE.reduce({ id: "restore", type: "deckUnarchive", t: "2026-08-26T12:00:00.000Z", payload: { name: "Mathe" } });
	assert.equal(STATE.isCardArchived(S.cards.inParent), false);
	assert.equal(STATE.isCardArchived(S.cards.own), true);
	assert.deepEqual(STATE.activeCards().map((item) => item.id).sort(), ["active", "inParent"]);
});

test("Archivansicht zeigt Stapelwurzeln und einzelne Karten ohne Doppelung", () => {
	reset();
	S.ankiTab = "archive";
	const main = document.getElementById("main");
	RENDER_ANKI.renderAnki(main);
	assert.match(main.textContent, /Mathe/);
	assert.match(main.textContent, /Frage own/);
	assert.doesNotMatch(main.textContent, /Frage inParent/);
	assert.ok(main.querySelector('[data-deckunarchive="Mathe"]'));
	assert.ok(main.querySelector('[data-ankiunarchive="own"]'));
});

test("Wissensgraph blendet archivierte Karten und leere Skills nur in der Anzeige aus", () => {
	reset();
	S.settings.embedModel = "test-model";
	S.settings.knowledgeGraph = {
		v: 5, model: "test-model", sourceFingerprint: "alt",
		subjects: [{ id: "subject", name: "Mathematik" }],
		topics: [{ id: "topic", subjectId: "subject", name: "Analysis" }],
		skills: [
			{ id: "visible", subjectId: "subject", topicId: "topic", title: "Aktiver Skill", cardIds: ["active"] },
			{ id: "hidden", subjectId: "subject", topicId: "topic", title: "Archivierter Skill", cardIds: ["inParent"] },
		],
		bridges: [{ id: "edge", a: "visible", b: "hidden" }],
	};
	GRAPH.open();
	assert.match(document.querySelector(".graph-stage").textContent, /Aktiver Skill/);
	assert.doesNotMatch(document.querySelector(".graph-stage").textContent, /Archivierter Skill/);
	GRAPH.close();
});
