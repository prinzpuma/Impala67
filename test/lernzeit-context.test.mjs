import test from "node:test";
import assert from "node:assert/strict";

import { idlePromptContextKind } from "../web/lernzeit-context.js";

function state(patch = {}) {
	return {
		view: "home",
		ankiTab: "decks",
		currentPageId: null,
		pages: {},
		...patch,
	};
}

test("Idle-Frage ist nur in Heft, Chat und Kartenlernen erlaubt", () => {
	assert.equal(idlePromptContextKind(state({ view: "chat" })), "ai");
	assert.equal(idlePromptContextKind(state({ view: "anki", ankiTab: "study" })), "cards");
	assert.equal(idlePromptContextKind(state({
		view: "page",
		currentPageId: "heft-1",
		pages: { "heft-1": { id: "heft-1", kind: "heft" } },
	})), "notebook");

	assert.equal(idlePromptContextKind(state({ view: "home" })), null);
	assert.equal(idlePromptContextKind(state({ view: "anki", ankiTab: "decks" })), null);
	assert.equal(idlePromptContextKind(state({
		view: "page",
		currentPageId: "note-1",
		pages: { "note-1": { id: "note-1", kind: "note" } },
	})), null);
});

test("offene Einstellungen sperren jeden darunterliegenden Lernkontext", () => {
	assert.equal(idlePromptContextKind(state({ view: "chat" }), true), null);
	assert.equal(idlePromptContextKind(state({ view: "anki", ankiTab: "study" }), true), null);
	assert.equal(idlePromptContextKind(state({
		view: "page",
		currentPageId: "heft-1",
		pages: { "heft-1": { id: "heft-1", kind: "heft" } },
	}), true), null);
});
