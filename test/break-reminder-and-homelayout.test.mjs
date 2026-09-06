import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

function setupRealDOM() {
	const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body><div id="tabbar"></div><div id="tree"></div><div id="main"></div><div id="overlay" hidden></div></body></html>`, {
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
const {
	HOME_SECTIONS,
	homeLayout,
	getBreakReminder,
	setBreakReminder,
	isBreakReminderEnabled,
	handleAppearanceSelect,
	BREAK_REMINDER_KEY,
} = await import("../web/settings.js");

test("Speicherung des Erstellungsdatums in web/state.js", () => {
	// 1. pageCreate mit explizitem created
	STATE.reduce({
		id: "ev-p1",
		t: "2026-09-01T10:00:00.000Z",
		type: "pageCreate",
		payload: {
			id: "page-1",
			title: "Seite 1",
			created: "2026-08-01T08:00:00.000Z",
		},
	});
	assert.equal(S.pages["page-1"].created, "2026-08-01T08:00:00.000Z");

	// 2. pageCreate ohne explizites created -> nutzt ev.t
	STATE.reduce({
		id: "ev-p2",
		t: "2026-09-02T10:00:00.000Z",
		type: "pageCreate",
		payload: {
			id: "page-2",
			title: "Seite 2",
		},
	});
	assert.equal(S.pages["page-2"].created, "2026-09-02T10:00:00.000Z");

	// 3. Ältere Seite ohne created simuliert (z.B. alter Checkpoint)
	S.pages["page-legacy"] = {
		id: "page-legacy",
		title: "Legacy",
		updated: "2026-07-15T12:00:00.000Z",
		trashed: false,
	};
	// activePages() ergänzt created robust als Fallback auf updated
	const pages = STATE.activePages();
	const legacy = pages.find((p) => p.id === "page-legacy");
	assert.ok(legacy);
	assert.equal(legacy.created, "2026-07-15T12:00:00.000Z");
	assert.equal(STATE.sortKeyOf(legacy), Date.parse("2026-07-15T12:00:00.000Z"));
});

test("Pausen-Erinnerung in web/settings.js", () => {
	localStorage.clear();
	// Standard ist true
	assert.equal(getBreakReminder(), true);
	assert.equal(isBreakReminderEnabled(), true);

	// Deaktivieren
	setBreakReminder(false);
	assert.equal(localStorage.getItem(BREAK_REMINDER_KEY), "off");
	assert.equal(getBreakReminder(), false);

	// Aktivieren
	setBreakReminder(true);
	assert.equal(localStorage.getItem(BREAK_REMINDER_KEY), "on");
	assert.equal(getBreakReminder(), true);

	// Über handleAppearanceSelect steuern
	handleAppearanceSelect("breakReminder", "off");
	assert.equal(localStorage.getItem(BREAK_REMINDER_KEY), "off");
	assert.equal(getBreakReminder(), false);
});

test("Bereichskonfiguration in web/settings.js", () => {
	// chats und continue dürfen nicht in HOME_SECTIONS sein
	assert.ok(!HOME_SECTIONS.some((s) => s.id === "chats"));
	assert.ok(!HOME_SECTIONS.some((s) => s.id === "continue"));

	// recent muss "Zuletzt & Weitermachen" sein
	const recentSec = HOME_SECTIONS.find((s) => s.id === "recent");
	assert.ok(recentSec);
	assert.equal(recentSec.label, "Zuletzt & Weitermachen");
	assert.equal(recentSec.hint, "zuletzt bearbeitete Notizen und schneller Wiedereinstieg");

	// Alt-Layout Migration testen:
	localStorage.clear();
	const legacyLayout = [
		{ id: "insights", on: true },
		{ id: "continue", on: true },
		{ id: "today", on: true },
		{ id: "recent", on: false },
		{ id: "chats", on: true },
	];
	localStorage.setItem("impala67HomeLayout", JSON.stringify(legacyLayout));

	const migrated = homeLayout();
	// chats darf nicht enthalten sein
	assert.ok(!migrated.some((e) => e.id === "chats"));
	// continue darf nicht enthalten sein
	assert.ok(!migrated.some((e) => e.id === "continue"));
	// recent muss vorhanden sein und aktiv sein (weil continue on: true war)
	const recentEntry = migrated.find((e) => e.id === "recent");
	assert.ok(recentEntry);
	assert.equal(recentEntry.on, true);
	// Es darf keine Duplikate geben
	const ids = migrated.map((e) => e.id);
	assert.equal(new Set(ids).size, ids.length);
	// Alle bekannten Bereiche aus HOME_SECTIONS müssen vorhanden sein
	for (const sec of HOME_SECTIONS) {
		assert.ok(ids.includes(sec.id), `Fehlt: ${sec.id}`);
	}
});
