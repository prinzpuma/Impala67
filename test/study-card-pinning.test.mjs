import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body><main id=main></main></body>", { url: "http://localhost/" });
for (const key of ["window", "document", "Element", "Node", "HTMLElement", "MutationObserver"]) {
	Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });
Object.defineProperty(globalThis, "requestAnimationFrame", { value: (fn) => setTimeout(fn, 0), configurable: true });
Object.defineProperty(globalThis, "matchMedia", { value: () => ({
	matches: false, addEventListener() {}, removeEventListener() {}
}), configurable: true });

const { S, STATE } = await import("../web/state.js");
const { SRS } = await import("../web/srs.js");
const { RENDER_ANKI } = await import("../web/render-anki.js");
const { APP } = await import("../web/app.js");

test("Lernkarte bleibt fest, wenn sich der Queue-Kopf vor dem Aufdecken ändert", () => {
	const now = Date.now();
	S.cards = {
		frage: { id: "frage", front: "Frage A", back: "Antwort A", deck: "Test", suspended: false,
			srs: SRS.newCard(new Date(now - 1000).toISOString()), created: new Date(now - 1000).toISOString() },
		learning: { id: "learning", front: "Frage B", back: "Antwort B", deck: "Test", suspended: false,
			srs: { ...SRS.newCard(new Date(now + 3600000).toISOString()), state: "learning", step: 1 },
			created: new Date(now - 2000).toISOString() },
	};
	S.decks = { Test: { name: "Test", created: new Date(now).toISOString() } };
	S.reviews = [];
	S.ankiDeck = "Test";
	S.ankiTab = "study";
	S.view = "anki";
	S.reviewShowBack = false;
	S.reviewCardId = null;

	const main = document.getElementById("main");
	RENDER_ANKI.renderAnki(main);
	assert.equal(S.reviewCardId, "frage");
	assert.match(main.textContent, /Frage A/);

	STATE.reduce({ type: "cardUpdate", payload: { id: "learning", patch: {
		srs: { ...S.cards.learning.srs, due: new Date(now - 500).toISOString() }
	} }, t: new Date(now).toISOString() });
	assert.equal(STATE.studySnapshot("Test").dueNow[0].id, "learning", "Queue-Kopf hat gewechselt");

	RENDER_ANKI.renderAnki(main);
	assert.equal(S.reviewCardId, "frage");
	assert.match(main.textContent, /Frage A/);
	assert.doesNotMatch(main.textContent, /Frage B/);
	assert.equal(main.querySelector("[data-ankishowback]").dataset.card, "frage");
	assert.equal(APP.showStudyAnswer("learning"), false, "eine andere Karte darf nicht aufgedeckt werden");
	assert.equal(APP.showStudyAnswer("frage"), true);
	assert.match(main.textContent, /Antwort A/);
	assert.doesNotMatch(main.textContent, /Antwort B/);
});
