import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
for (const key of ["window", "document", "Element", "Node", "HTMLElement", "MutationObserver", "navigator"]) {
	Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });
Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true });

const { S, STATE } = await import("../web/state.js");
const { DB } = await import("../web/db.js");
const { SRS } = await import("../web/srs.js");
const { splitThink } = await import("../web/think-heuristik.js");

const reset = () => {
	S.pages = {}; S.cards = {}; S.decks = {}; S.gnFolders = {}; S.reviews = [];
	S.tabs = []; S.activeTabId = null; S.currentPageId = null; S.view = "home";
};

test("Seiten- und Stapel-Teilbäume haben je eine zentrale Regel", () => {
	reset();
	S.pages = {
		root: { id: "root", parentId: null },
		child: { id: "child", parentId: "root" },
		grandchild: { id: "grandchild", parentId: "child" },
	};
	assert.deepEqual([...STATE.pageSubtreeIds("root")].sort(), ["child", "grandchild", "root"]);
	assert.equal(STATE.pageInTree("grandchild", "root"), true);
	assert.equal(STATE.pageInTree("root", "child"), false);
	assert.equal(STATE.deckInTree("Mathe::Analysis", "Mathe"), true);
	assert.equal(STATE.deckInTree("Mathematik", "Mathe"), false);
});

test("Kinder einer Legacy-Seite werden unabhängig vom aktuell geöffneten Workspace gefunden", () => {
	reset();
	S.currentWorkspaceId = "other";
	S.pages = {
		legacy: { id: "legacy", parentId: null },
		child: { id: "child", parentId: "legacy" },
	};
	STATE.reduce({ type: "pageUpdate", payload: { id: "legacy", patch: { title: "Legacy" } }, t: "2026-01-01T00:00:00.000Z" });
	assert.deepEqual(STATE.childrenOf("legacy").map((page) => page.id), ["child"]);
});

test("Seiten-Lifecycle entfernt betroffene Tabs zentral", () => {
	reset();
	S.pages = { root: { id: "root", parentId: null }, child: { id: "child", parentId: "root" }, keep: { id: "keep", parentId: null } };
	S.tabs = ["root", "child", "keep"];
	S.activeTabId = "child"; S.currentPageId = "child"; S.view = "page";
	STATE.reduce({ id: "trash", t: "2026-01-02T00:00:00.000Z", type: "pageTrash", payload: { id: "root" } });
	assert.deepEqual(S.tabs, ["keep"]);
	assert.equal(S.activeTabId, null);
	assert.equal(S.currentPageId, null);
	assert.equal(S.view, "home");
});

test("endgültiges Seitenlöschen entfernt auch den lokalen RAG-Vektor", () => {
	reset();
	S.pages = { gone: { id: "gone", parentId: null } };
	const originalDelVec = DB.delVec;
	const deleted = [];
	DB.delVec = async (id) => { deleted.push(id); };
	try {
		STATE.reduce({ id: "delete-page", t: "2026-01-02T00:00:00.000Z", type: "pageDelete", payload: { id: "gone" } });
		assert.deepEqual(deleted, ["gone"]);
		assert.equal(S.pages.gone, undefined);
	} finally {
		DB.delVec = originalDelVec;
	}
});

test("Fremd-Events informieren UI und Live-Module über denselben Pfad", () => {
	reset();
	let changed = 0, remote = 0;
	const previous = STATE.onChange;
	STATE.onChange = (type, ev) => { if (type === "syncImport" && ev.payload.count === 1) changed++; };
	STATE.onRemoteApplied((types) => { if (types.has("pageCreate")) remote++; });
	STATE.applyRemoteEvents([{ id: "remote-page", t: "2026-01-02T00:00:00.000Z", type: "pageCreate", payload: { id: "remote", title: "Remote" } }]);
	STATE.onChange = previous;
	assert.equal(S.pages.remote.title, "Remote");
	assert.equal(changed, 1);
	assert.equal(remote, 1);
});

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

test("globales Fehleroverlay setzt fremde Fehlertexte nur als Text", async () => {
	const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
	const overlay = html.slice(html.indexOf("function showErrorOverlay"), html.indexOf("window.onerror ="));
	assert.doesNotMatch(overlay, /innerHTML/);
	assert.match(overlay, /textContent/);
});
