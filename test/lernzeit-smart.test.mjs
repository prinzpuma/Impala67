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
const { FACH } = await import("../web/fach.js");
const { LERNZEIT } = await import("../web/lernzeit.js");

test("LERNZEIT: 40-Minuten-Pausenerinnerung Einstellung & Prompt", () => {
	localStorage.clear();
	assert.equal(LERNZEIT.isBreakReminderEnabled(), true);

	localStorage.setItem("impala67BreakReminder", "0");
	assert.equal(LERNZEIT.isBreakReminderEnabled(), false);

	localStorage.setItem("impala67BreakReminder", "1");
	assert.equal(LERNZEIT.isBreakReminderEnabled(), true);

	const overlay = document.getElementById("overlay");
	overlay.hidden = true;
	overlay.innerHTML = "";

	LERNZEIT.showBreakReminderPrompt();
	assert.equal(overlay.hidden, false);
	assert.ok(overlay.querySelector(".lz-break-modal"));
	assert.ok(overlay.querySelector('[data-lz-break="5"]'));
	assert.ok(overlay.querySelector('[data-lz-break="dismiss"]'));
	assert.ok(overlay.textContent.includes("40 Minuten"));

	// Klick auf "Weiterlernen"
	const dismissBtn = overlay.querySelector('[data-lz-break="dismiss"]');
	dismissBtn.click();
	assert.equal(overlay.hidden, true);

	// Klick auf "5 Min Pause"
	LERNZEIT.showBreakReminderPrompt();
	assert.equal(overlay.hidden, false);
	const breakBtn = overlay.querySelector('[data-lz-break="5"]');
	breakBtn.click();
	assert.equal(overlay.hidden, true);
	assert.equal(LERNZEIT.getActiveStretchMs(), 0);
});

test("LERNZEIT: homeWidgetHtml enthält keinen Timer mehr und hat lz-summary-card", () => {
	const html = LERNZEIT.homeWidgetHtml();
	// Kein manueller Timer
	assert.equal(html.includes("lz-timer-card"), false);
	assert.equal(html.includes("Fokusblock starten"), false);
	assert.equal(html.includes("lzCustomMinutes"), false);

	// Saubere Summary-Card
	assert.ok(html.includes("lz-summary-card"));
	assert.ok(html.includes("lz-summary-hero"));
	assert.ok(html.includes("lz-summary-time"));
	assert.ok(html.includes("Wochenziel"));

	// Kartenqualität mit Prüfungsreife / Behaltequote
	assert.ok(html.includes("Kartenqualität"));
	assert.ok(html.includes("Noch keine Reviews") || html.includes("Behaltequote"));

	// Smarte Lern-Analysen
	assert.ok(html.includes("Smarte Lern-Analysen"));
});

test("LERNZEIT: Fächer-Filterung im Widget beschränkt sich auf echte Schulfächer", () => {
	const html = LERNZEIT.homeWidgetHtml();
	// Enthält nur bekannte Schulfächer oder den Empty-Hint
	assert.ok(html.includes("Fächer & Lernkontexte"));
	assert.ok(!html.includes("Allgemein am stärksten"));
});

test("LERNZEIT: computeSmartInsights erkennt Fälligkeitsspitzen und Vergessensalarm", () => {
	// Erstelle Testkarte mit lapses >= 4
	S.cards = S.cards || {};
	S.cards["card-lapse-test"] = {
		id: "card-lapse-test",
		front: "Frage",
		back: "Antwort",
		srs: { lapses: 5, state: "review" },
		trashed: false,
		suspended: false,
	};

	const insights = LERNZEIT.computeSmartInsights({});
	const forgetting = insights.find((i) => i.id === "forgettingAlarm");
	assert.ok(forgetting, "Vergessenskurven-Alarm vorhanden");
	assert.ok(forgetting.title.includes("kurz vor dem Vergessen"));

	// Bereinigen
	delete S.cards["card-lapse-test"];
});
