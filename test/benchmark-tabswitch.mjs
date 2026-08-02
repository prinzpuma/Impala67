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

const { S } = await import("../web/state.js");
const { RENDER } = await import("../web/render.js");

function populateWorkspace(pageCount) {
	S.pages = {};
	S.workspaces = { default: { id: "default", name: "Haupt-Workspace" } };
	const pageIds = [];
	for (let i = 1; i <= pageCount; i++) {
		const id = `p_${i}`;
		pageIds.push(id);
		S.pages[id] = {
			id,
			title: `Notizblatt ${i} mit echtem DOM`,
			workspaceId: "default",
			content: `Inhalt von Seite ${i}`,
			created: new Date(1700000000000 + i * 1000).toISOString(),
			favorite: i % 20 === 0
		};
	}
	S.tabs = pageIds.slice(0, 10);
	S.activeTabId = pageIds[0];
	S.currentPageId = pageIds[0];
	S.currentChatId = null;
	S.view = "page";
	S.sidebarMode = "files";
	S.navHistory = [pageIds[0]];
	S.navIndex = 0;
	return pageIds;
}

test("DOM-Modell-Messung (JSDOM) des Tabwechsels über verschiedene Seitenbestände", () => {
	try {
		const sizes = [10, 100, 1000, 3000];
		console.log("\n=== DOM-MODELL-BENCHMARK-MESSUNG (JSDOM) ===");
		console.log("Seitenanzahl | Vorher (Voll-Render DOM ms) | Nachher (Targeted DOM ms) | Beschleunigung");
		console.log("--------------------------------------------------------------------------------------");

		for (const count of sizes) {
			const pageIds = populateWorkspace(count);
			const testTabIds = pageIds.slice(0, 10);

			// Initialer Voll-Render
			RENDER.renderSidebar();
			RENDER.renderTabs();
			RENDER.renderMain();

			const iterations = 20;

			// 1. MESSUNG VORHER
			const tree = document.getElementById("tree");
			const bar = document.getElementById("tabbar");

			const t0 = performance.now();
			for (let i = 0; i < iterations; i++) {
				const targetId = testTabIds[i % testTabIds.length];
				S.activeTabId = targetId;
				S.currentPageId = targetId;

				delete tree.dataset.sbmode;
				delete tree._lastHtml;
				delete bar._lastHtml;

				RENDER.renderSidebar();
				RENDER.renderTabs();
				RENDER.renderMain();
			}
			const t1 = performance.now();
			const timeBeforeMs = (t1 - t0) / iterations;

			// 2. MESSUNG NACHHER
			RENDER.renderSidebar();
			RENDER.renderTabs();

			const t2 = performance.now();
			for (let i = 0; i < iterations; i++) {
				const targetId = testTabIds[i % testTabIds.length];
				S.activeTabId = targetId;
				S.currentPageId = targetId;

				RENDER.renderSidebar();
				RENDER.renderTabs();
				RENDER.renderMain();
			}
			const t3 = performance.now();
			const timeAfterMs = (t3 - t2) / iterations;

			const speedup = (timeBeforeMs / timeAfterMs).toFixed(1) + "x";
			console.log(
				`${String(count).padStart(12)} | ${timeBeforeMs.toFixed(4).padStart(26)} | ${timeAfterMs.toFixed(4).padStart(24)} | ${speedup.padStart(14)}`
			);

			assert.ok(timeAfterMs <= timeBeforeMs, "Nachher-Zeit muss kleiner/gleich Vorher-Zeit sein");
		}
		console.log("--------------------------------------------------------------------------------------\n");
	} catch (err) {
		console.error("BENCHMARK ERROR:", err);
		throw err;
	}
});
