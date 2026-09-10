import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

function setupRealDOM() {
	const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body><div id="overlay" hidden></div><div id="main"></div></body></html>`, {
		url: "http://localhost/",
		referrer: "http://localhost/",
		contentType: "text/html",
	});

	const define = (k, v) => {
		try {
			Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
		} catch {
			globalThis[k] = v;
		}
	};

	define("window", dom.window);
	define("document", dom.window.document);
	define("Element", dom.window.Element);
	define("Node", dom.window.Node);
	define("HTMLElement", dom.window.HTMLElement);
	define("CustomEvent", dom.window.CustomEvent);
	define("MutationObserver", dom.window.MutationObserver);
	define("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
	define("requestAnimationFrame", (fn) => setTimeout(fn, 0));
	define("cancelAnimationFrame", (id) => clearTimeout(id));

	const store = new Map();
	define("localStorage", {
		getItem: (k) => store.get(k) || null,
		setItem: (k, v) => store.set(k, String(v)),
		removeItem: (k) => store.delete(k),
		clear: () => store.clear(),
	});
	define("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
}

setupRealDOM();

const { S, STATE } = await import("../web/state.js");
const { U } = await import("../web/util.js");
const { renderSettingsPage } = await import("../web/settings-renderer.js");
const { handleDeleteAllCards } = await import("../web/settings.js");

test("Settings Renderer: danger-cards shows accurate counts and button state", () => {
	// 1. Ohne Karten
	S.cards = {};
	S.decks = {};
	let html = renderSettingsPage("data", { version: "2.2.0" });
	assert.ok(html.includes('id="danger-cards"'));
	assert.ok(html.includes("Keine Karteikarten vorhanden"));
	assert.ok(html.includes('id="btnResetCards" class="danger" disabled'));

	// 2. Mit 3 Karten
	S.cards = {
		c1: { id: "c1", front: "F1", back: "B1", deck: "Standard" },
		c2: { id: "c2", front: "F2", back: "B2", deck: "Bio" },
		c3: { id: "c3", front: "F3", back: "B3", deck: "Bio::Zelle" },
	};
	S.decks = {
		Bio: { name: "Bio" },
		"Bio::Zelle": { name: "Bio::Zelle" },
	};
	html = renderSettingsPage("data", { version: "2.2.0" });
	assert.ok(html.includes("3 Karteikarten · wird per Sync auch auf deinen anderen Geräten gelöscht"));
	assert.ok(html.includes('id="btnResetCards" class="danger"'));
	assert.ok(!html.includes('id="btnResetCards" class="danger" disabled'));
});

test("handleDeleteAllCards: bricht ab, wenn keine Karten vorhanden sind", async () => {
	S.cards = {};
	S.decks = {};
	let confirmCalled = false;
	const origConfirm = U.confirm;
	U.confirm = async () => { confirmCalled = true; return true; };

	try {
		const res = await handleDeleteAllCards();
		assert.equal(res, false);
		assert.equal(confirmCalled, false);
	} finally {
		U.confirm = origConfirm;
	}
});

test("handleDeleteAllCards: bricht ab, wenn der Nutzer im Dialog abbricht", async () => {
	S.cards = { c1: { id: "c1", front: "F", back: "B" } };
	S.decks = {};
	const origConfirm = U.confirm;
	U.confirm = async () => false;

	try {
		const res = await handleDeleteAllCards();
		assert.equal(res, false);
		assert.ok(S.cards.c1);
	} finally {
		U.confirm = origConfirm;
	}
});

test("handleDeleteAllCards: löscht alle Stapel und Karten und setzt Lernstatus zurück", async () => {
	S.cards = {
		c1: { id: "c1", front: "F1", back: "B1", deck: "Standard" },
		c2: { id: "c2", front: "F2", back: "B2", deck: "Sprachen" },
	};
	S.decks = {
		Sprachen: { name: "Sprachen" },
	};
	S.ankiDeck = "Sprachen";
	S.reviewCardId = "c2";
	S.reviewShowBack = true;

	const dispatched = [];
	const origDispatch = STATE.dispatch;
	STATE.dispatch = async (type, payload) => {
		dispatched.push({ type, payload });
		if (type === "cardDelete") {
			delete S.cards[payload.id];
		} else if (type === "deckDelete") {
			delete S.decks[payload.name];
		}
	};

	const origConfirm = U.confirm;
	U.confirm = async () => true;

	const btn = document.createElement("button");
	btn.textContent = "Karten löschen";

	try {
		const res = await handleDeleteAllCards(btn);
		assert.equal(res, true);
		assert.equal(Object.keys(S.cards).length, 0);
		assert.equal(Object.keys(S.decks).length, 0);
		assert.equal(S.ankiDeck, null);
		assert.equal(S.reviewCardId, null);
		assert.equal(S.reviewShowBack, false);

		// Prüfe, dass deckDelete und cardDelete aufgerufen wurden
		assert.ok(dispatched.some((d) => d.type === "deckDelete" && d.payload.name === "Sprachen"));
		assert.ok(dispatched.some((d) => d.type === "cardDelete" && d.payload.id === "c1"));
		assert.ok(dispatched.some((d) => d.type === "cardDelete" && d.payload.id === "c2"));
	} finally {
		STATE.dispatch = origDispatch;
		U.confirm = origConfirm;
	}
});
