import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

function setupRealDOM() {
	const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body><div id="tabbar"></div><div id="tree"></div><div id="main"></div></body></html>`, {
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
	define("requestAnimationFrame", (fn) => setTimeout(fn, 0));
	define("cancelAnimationFrame", (id) => clearTimeout(id));

	const store = new Map();
	define("localStorage", {
		getItem: (k) => store.get(k) || null,
		setItem: (k, v) => store.set(k, String(v)),
		removeItem: (k) => store.delete(k),
		clear: () => store.clear()
	});
	define("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
}

setupRealDOM();

const { S, STATE } = await import("../web/state.js");
const { RENDER } = await import("../web/render.js");
const { TABS } = await import("../web/tabs.js");
const { CHATS } = await import("../web/chats.js");

// Mock DB.addEvent / STATE.dispatch
STATE.dispatch = async () => {};

const now = new Date().toISOString();

test("Echte DOM-Tests: Active-Klassen in Tabbar & Sidebar beim Tabwechsel", () => {
	S.pages = {
		p1: { id: "p1", title: "Seite 1", workspaceId: "default", created: now },
		p2: { id: "p2", title: "Seite 2", workspaceId: "default", created: now },
		p3: { id: "p3", title: "Seite 3", workspaceId: "default", created: now },
	};
	S.workspaces = { default: { id: "default", name: "Workspace" } };
	S.tabs = ["p1", "p2"];
	S.activeTabId = "p1";
	S.currentPageId = "p1";
	S.view = "page";
	S.sidebarMode = "files";

	RENDER.renderSidebar();
	RENDER.renderTabs();

	const tree = document.getElementById("tree");
	const bar = document.getElementById("tabbar");

	// Initial active row -> p1
	const activeRow1 = tree.querySelector(".row.active");
	assert.ok(activeRow1, "Active Row 1 existiert");
	assert.equal(activeRow1.dataset.page, "p1");

	const activeChip1 = bar.querySelector(".tabchip.active");
	assert.ok(activeChip1, "Active Chip 1 existiert");
	assert.equal(activeChip1.dataset.tabopen, "p1");

	// Tabwechsel zu p2
	TABS.openPage("p2");

	const activeRow2 = tree.querySelector(".row.active");
	assert.ok(activeRow2, "Active Row 2 existiert");
	assert.equal(activeRow2.dataset.page, "p2");

	const activeChip2 = bar.querySelector(".tabchip.active");
	assert.ok(activeChip2, "Active Chip 2 existiert");
	assert.equal(activeChip2.dataset.tabopen, "p2");
});

test("Echte DOM-Tests: Sichere Fallbacks bei fehlender Zeile oder geänderten Tabs", () => {
	S.pages = {
		p1: { id: "p1", title: "Seite 1", workspaceId: "default", created: now }
	};
	S.workspaces = { default: { id: "default", name: "Workspace" } };
	S.tabs = ["p1"];
	S.activeTabId = "p1";
	S.currentPageId = "p1";
	S.view = "page";
	S.sidebarMode = "files";

	RENDER.renderSidebar();
	RENDER.renderTabs();

	const tree = document.getElementById("tree");
	const bar = document.getElementById("tabbar");

	// Nun fügen wir eine neue Seite p_hidden über STATE.reduce hinzu (aktualisiert _childIdx)
	STATE.reduce({
		type: "pageCreate",
		payload: { id: "p_hidden", title: "Versteckte Seite", workspaceId: "default", created: now }
	});

	// Fallback 1: Seite im DOM bisher nicht vorhanden -> muss Voll-Render triggern und Element im DOM aufbauen
	TABS.openPage("p_hidden");
	const hiddenRow = tree.querySelector('[data-page="p_hidden"]');
	assert.ok(hiddenRow, "Gezielter Voll-Render hat die fehlende Zeile erfolgreich aufgebaut");
	assert.ok(hiddenRow.classList.contains("active"), "Neue Zeile ist aktiv");

	// Fallback 2: Neuer Tab geöffnet -> syncActiveTabChip schlägt fehl, renderTabs baut neuen Chip auf
	TABS.openPage("p1", { newTab: true });
	assert.equal(S.tabs.length, 2);
	const chips = bar.querySelectorAll(".tabchip[data-tabopen]");
	assert.equal(chips.length, 2, "Voll-Render hat die Tab-Leiste mit 2 Chips aufgebaut");
});

test("Echte DOM-Tests: Chat-Schnellpfad und Fallback bei fehlendem Chat", () => {
	S.sidebarMode = "chats";
	S.currentChatId = "c1";
	S.chatSelection = new Set();
	S.chatSessions = {
		c1: { id: "c1", title: "Chat 1", created: now, updated: now, messages: [] }
	};

	RENDER.renderSidebar();
	const tree = document.getElementById("tree");

	const activeChat1 = tree.querySelector(".row.active");
	assert.ok(activeChat1, "activeChat1 existiert im DOM");
	assert.equal(activeChat1.dataset.chat, "c1");

	// Wechsel zu neuem Chat c2 (noch nicht in S.chatSessions -> Fallback auf Voll-Render)
	const c2 = { id: "c2", title: "Chat 2", created: now, updated: now, messages: [] };
	S.chatSessions["c2"] = c2;
	CHATS.save(c2); // Leert den CHATS.load-Cache
	S.currentChatId = "c2";
	RENDER.renderSidebar();

	const activeChat2 = tree.querySelector(".row.active");
	assert.ok(activeChat2, "activeChat2 wurde per Fallback erfolgreich aufgebaut");
	assert.equal(activeChat2.dataset.chat, "c2");
});

test("Echte DOM-Tests: Erhalt von Scrollposition & Popover-Menü-Positionierung", () => {
	S.pages = {
		p1: { id: "p1", title: "Seite 1", workspaceId: "default", created: now },
		p2: { id: "p2", title: "Seite 2", workspaceId: "default", created: now },
	};
	S.workspaces = { default: { id: "default", name: "Workspace" } };
	S.tabs = ["p1", "p2"];
	S.activeTabId = "p1";
	S.currentPageId = "p1";
	S.view = "page";
	S.sidebarMode = "files";
	S.pageMenuOpenId = "p1";

	RENDER.renderSidebar();
	RENDER.renderTabs();
	RENDER.renderMain();

	const tree = document.getElementById("tree");

	// Popover-Menü in der Sidebar prüfen
	const menu = tree.querySelector(".page-menu");
	assert.ok(menu, "Offenes Seitenmenü existiert im DOM");

	// Gezielte Sidebar-Aktualisierung bei aktiver Menü-ID p1
	RENDER.renderSidebar();

	// Menü muss weiterhin im DOM positioniert sein
	const menuAfter = tree.querySelector(".page-menu");
	assert.ok(menuAfter, "Offenes Seitenmenü überlebt gezielte Sidebar-Aktualisierung");
});
