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

function page(id, title, extra = {}) {
	return {
		id,
		title,
		content: "",
		parentId: null,
		workspaceId: "default",
		created: "2026-09-01T10:00:00.000Z",
		updated: "2026-09-01T10:00:00.000Z",
		...extra,
	};
}

function reset() {
	S.pages = {
		active1: page("active1", "Aktive Notiz 1"),
		parent1: page("parent1", "Projekt"),
		child1: page("child1", "Teilaufgabe 1", { parentId: "parent1" }),
		child2: page("child2", "Teilaufgabe 2", { parentId: "parent1" }),
		heft1: page("heft1", "Mathe Heft", { kind: "heft" }),
	};
	S.tabs = ["active1", "parent1", "child1", "heft1"];
	S.activeTabId = "parent1";
	S.currentPageId = "parent1";
	S.currentWorkspaceId = "default";
	S.view = "page";
}

test("Archivieren einer Seite schließt Tabs und markiert Unterbaum", () => {
	reset();
	STATE.reduce({ id: "ev1", type: "pageArchive", t: "2026-09-10T12:00:00.000Z", payload: { id: "parent1" } });

	assert.equal(S.pages.parent1.archived, true);
	assert.equal(S.pages.parent1.archivedRoot, true);
	assert.equal(S.pages.child1.archived, true);
	assert.equal(S.pages.child2.archived, true);

	// Tabs von parent1 und child1 wurden geschlossen
	assert.deepEqual(S.tabs, ["active1", "heft1"]);
	assert.equal(S.activeTabId, null);
	assert.equal(S.currentPageId, null);
	assert.equal(S.view, "home");
});

test("Archivierte Seiten und Hefte werden von activePages() und childrenOf() ausgeschlossen", () => {
	reset();
	STATE.reduce({ id: "ev1", type: "pageArchive", t: "2026-09-10T12:00:00.000Z", payload: { id: "heft1" } });
	STATE.reduce({ id: "ev2", type: "pageArchive", t: "2026-09-10T12:01:00.000Z", payload: { id: "parent1" } });

	const active = STATE.activePages().map((p) => p.id);
	assert.deepEqual(active, ["active1"]);

	// childrenOf auf root
	const rootKids = STATE.childrenOf(null, "default").map((p) => p.id);
	assert.deepEqual(rootKids, ["active1"]);

	// childrenOf auf archivierten parent1 ist leer
	const parentKids = STATE.childrenOf("parent1", "default");
	assert.deepEqual(parentKids, []);
});

test("archivedPages() und archivedPageRoots() liefern korrekte Hierarchien", () => {
	reset();
	STATE.reduce({ id: "ev1", type: "pageArchive", t: "2026-09-10T12:00:00.000Z", payload: { id: "heft1" } });
	STATE.reduce({ id: "ev2", type: "pageArchive", t: "2026-09-10T12:05:00.000Z", payload: { id: "parent1" } });

	const allArchived = STATE.archivedPages().map((p) => p.id);
	// Nach archivedAt sortiert: parent1 (12:05), child1/2 (12:05), heft1 (12:00)
	assert.equal(allArchived.includes("parent1"), true);
	assert.equal(allArchived.includes("child1"), true);
	assert.equal(allArchived.includes("child2"), true);
	assert.equal(allArchived.includes("heft1"), true);
	assert.equal(allArchived.includes("active1"), false);

	// archivedPageRoots() liefert nur parent1 und heft1, nicht die Kinder child1/child2
	const roots = STATE.archivedPageRoots().map((p) => p.id);
	assert.deepEqual(roots, ["parent1", "heft1"]);
});

test("Wiederherstellen (pageUnarchive) stellt Baum wieder her", () => {
	reset();
	STATE.reduce({ id: "ev1", type: "pageArchive", t: "2026-09-10T12:00:00.000Z", payload: { id: "parent1" } });
	STATE.reduce({ id: "ev2", type: "pageUnarchive", t: "2026-09-10T12:10:00.000Z", payload: { id: "parent1" } });

	assert.equal(S.pages.parent1.archived, false);
	assert.equal(S.pages.child1.archived, false);
	assert.equal(S.pages.child2.archived, false);

	const active = STATE.activePages().map((p) => p.id).sort();
	assert.deepEqual(active, ["active1", "child1", "child2", "heft1", "parent1"]);

	const kids = STATE.childrenOf("parent1", "default").map((p) => p.id).sort();
	assert.deepEqual(kids, ["child1", "child2"]);
});

test("Wiederherstellen eines einzelnen Kinds bei archiviertem Elternteil wandert auf Root", () => {
	reset();
	STATE.reduce({ id: "ev1", type: "pageArchive", t: "2026-09-10T12:00:00.000Z", payload: { id: "parent1" } });
	// Nur child1 unarchiven, während parent1 archiviert bleibt
	STATE.reduce({ id: "ev2", type: "pageUnarchive", t: "2026-09-10T12:10:00.000Z", payload: { id: "child1" } });

	assert.equal(S.pages.child1.archived, false);
	assert.equal(S.pages.child1.parentId, null); // auf Root verschoben
	assert.equal(S.pages.parent1.archived, true);
	assert.equal(S.pages.child2.archived, true);

	const rootKids = STATE.childrenOf(null, "default").map((p) => p.id).sort();
	assert.deepEqual(rootKids, ["active1", "child1", "heft1"]);
});

test("Heft-Archivierung und Wiederherstellung", () => {
	reset();
	STATE.reduce({ id: "ev1", type: "pageArchive", t: "2026-09-10T12:00:00.000Z", payload: { id: "heft1" } });
	assert.equal(STATE.isPageArchived("heft1"), true);
	assert.equal(STATE.activePages().some((p) => p.id === "heft1"), false);

	STATE.reduce({ id: "ev2", type: "pageUnarchive", t: "2026-09-10T12:05:00.000Z", payload: { id: "heft1" } });
	assert.equal(STATE.isPageArchived("heft1"), false);
	assert.equal(STATE.activePages().some((p) => p.id === "heft1"), true);
});

test("findPage findet aktive Seiten bevorzugt, aber auch archivierte Seiten als Fallback", () => {
	reset();
	S.pages.arch1 = page("arch1", "Altes Projekt", { archived: true, content: "Geheime Formel E=mc2" });
	S.pages.activeDup = page("activeDup", "Projekt");

	// Exakter Treffer auf archivierte Seite
	const foundArch = STATE.findPage("Altes Projekt");
	assert.ok(foundArch);
	assert.equal(foundArch.id, "arch1");

	// Aktive Seite hat Vorrang bei gleichem Namen
	const foundActive = STATE.findPage("Projekt");
	assert.ok(foundActive);
	assert.equal(foundActive.id, "parent1");
});

test("searchNotes durchsucht mit includeArchived auch archivierte Seiten", () => {
	reset();
	S.pages.arch1 = page("arch1", "Archivierte Quantenmechanik", { archived: true, content: "Schrödinger Gleichung" });

	// Standard: nur aktive
	const activeOnly = STATE.searchNotes("Schrödinger");
	assert.equal(activeOnly.length, 0);

	// Mit includeArchived: findet auch archivierte Notiz
	const withArch = STATE.searchNotes("Schrödinger", { includeArchived: true });
	assert.equal(withArch.length, 1);
	assert.equal(withArch[0].page.id, "arch1");
});

test("Checkpoint-Wiederherstellung wendet nachträglich pageArchive-Events an", async () => {
	const { DB } = await import("../web/db.js");
	reset();
	// Simuliere: Checkpoint hat active1 noch ohne archived
	const originalAllEvents = DB.allEvents;
	const originalEventLogInfo = DB.eventLogInfo;
	const originalGetStateCheckpoint = DB.getStateCheckpoint;
	const originalEventAtSeq = DB.eventAtSeq;
	const originalEventsAfterSeqAll = DB.eventsAfterSeqAll;

	try {
		DB.allEvents = async () => [
			{ seq: 1, id: "ev-create", t: "2026-09-01T10:00:00.000Z", type: "pageCreate", payload: { id: "active1", title: "Aktive Notiz 1" } },
			{ seq: 2, id: "ev-arch", t: "2026-09-01T10:05:00.000Z", type: "pageArchive", payload: { id: "active1" } },
		];
		DB.eventLogInfo = async () => ({ count: 2, maxSeq: 2, lastEventId: "ev-arch" });
		DB.eventAtSeq = async () => ({ seq: 2, id: "ev-arch", t: "2026-09-01T10:05:00.000Z" });
		DB.eventsAfterSeqAll = async () => [];
		DB.getStateCheckpoint = async () => ({
			format: 2,
			maxSeq: 2,
			eventCount: 2,
			lastEventId: "ev-arch",
			maxTime: "2026-09-01T10:05:00.000Z",
			heftBlobSizes: {},
			state: {
				pages: { active1: page("active1", "Aktive Notiz 1", { archived: false }) },
				cards: {}, grades: {}, learningSessions: {}, chatSessions: {}, settings: {},
				decks: {}, workspaces: {}, gnFolders: {}, treeOpen: {}, tabs: [], activeTabId: null,
				reviews: [], telemetry: {}, heftDocs: {},
			},
		});

		await STATE.load();
		// active1 muss nach dem Checkpoint-Laden durch die Archiv-Reconciliation archived: true sein!
		assert.equal(S.pages.active1.archived, true);
	} finally {
		DB.allEvents = originalAllEvents;
		DB.eventLogInfo = originalEventLogInfo;
		DB.getStateCheckpoint = originalGetStateCheckpoint;
		DB.eventAtSeq = originalEventAtSeq;
		DB.eventsAfterSeqAll = originalEventsAfterSeqAll;
	}
});


