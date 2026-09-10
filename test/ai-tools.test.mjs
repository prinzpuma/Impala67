import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
for (const key of ["window", "document", "Element", "Node", "HTMLElement", "MutationObserver", "navigator"]) {
	Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });
Object.defineProperty(globalThis, "requestAnimationFrame", { value: (fn) => setTimeout(fn, 0), configurable: true });
Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true });

const { S, STATE } = await import("../web/state.js");
const { TOOLS } = await import("../web/tools.js");

// Die Tests brauchen keine IndexedDB: der echte Reducer prüft dieselben Events, nur die
// Persistenzschicht wird durch einen synchronen In-Memory-Dispatch ersetzt.
STATE.dispatch = async (type, payload) => STATE.reduce({ id: crypto.randomUUID(), t: new Date().toISOString(), type, payload });

function reset() {
	S.pages = {};
	S.cards = {};
	S.decks = {};
	S.heftDocs = {};
	S.heftMeta = {};
	S.tabs = [];
	S.currentPageId = null;
	S.currentWorkspaceId = "default";
}

test("KI erhält nur die kompakte Werkzeugoberfläche", () => {
	assert.deepEqual(TOOLS.defs.map((x) => x.function.name), [
		"inspect", "change", "view_heft_page", "ask_choice", "calculate", "send_to_notebooklm",
	]);
	assert.ok(JSON.stringify(TOOLS.defs).length < 5000, "Tool-Schema bleibt kompakt");
});

test("gebündelte Änderungen lassen sich vollständig rückgängig machen", async () => {
	reset();
	const result = await TOOLS.run("change", { operations: [
		{ op: "page.create", title: "Physik", content: "Impuls" },
		{ op: "card.create", deck: "Physik", cards: [{ front: "Was ist Impuls?", back: "$p=mv$" }, { front: "Einheit?", back: "$Ns$" }] },
	] });
	assert.equal(result.ok, true);
	assert.equal(Object.keys(S.pages).length, 1);
	assert.equal(Object.keys(S.cards).length, 2);
	assert.ok(result._undo);

	await TOOLS.undo(result._undo);
	assert.equal(Object.keys(S.pages).length, 0);
	assert.equal(Object.keys(S.cards).length, 0);
	assert.equal(Object.keys(S.decks).length, 0);
});

test("Fehler rollen vorherige Operationen zurück", async () => {
	reset();
	const result = await TOOLS.run("change", { operations: [
		{ op: "page.create", title: "Kurzlebig", content: "wird entfernt" },
		{ op: "page.append", title: "Fehlt", content: "x" },
	] });
	assert.match(result.error, /Alle vorherigen Änderungen wurden zurückgenommen/);
	assert.equal(Object.keys(S.pages).length, 0);
});

test("Seitenänderungen akzeptieren auch text als Schreibfeld und schreiben nie undefined", async () => {
	reset();
	await STATE.dispatch("pageCreate", { id: "p1", title: "Physik", parentId: null, content: "Start" });
	const result = await TOOLS.run("change", { operations: [{ op: "page.append", title: "Physik", text: "Weiter" }] });
	assert.equal(result.ok, true);
	assert.equal(S.pages.p1.content, "Start\n\nWeiter");

	const invalid = await TOOLS.run("change", { operations: [{ op: "page.append", title: "Physik" }] });
	assert.match(invalid.error, /content fehlt/i);
	assert.doesNotMatch(S.pages.p1.content, /undefined/);
});

test("Kartenänderungen akzeptieren Gemmas verschachtelte card-Schreibweise", async () => {
	reset();
	await STATE.dispatch("cardCreate", { id: "karte1", front: "Was ist Kraft?", back: "F = m · a", deck: "Standard" });
	const result = await TOOLS.run("change", { operations: [{
		card: { op: "card.update", front: "Was ist Kraft?", back: "F = m · a; Kraft ist Masse mal Beschleunigung." },
	}] });
	assert.equal(result.ok, true);
	assert.equal(S.cards.karte1.back, "F = m · a; Kraft ist Masse mal Beschleunigung.");
});

test("Kartenänderungen dürfen die Auswahl über query angeben", async () => {
	reset();
	await STATE.dispatch("cardCreate", { id: "karte2", front: "Was ist Kraft?", back: "F = m · a", deck: "Standard" });
	const result = await TOOLS.run("change", { operations: [{
		op: "card.update", query: "Was ist Kraft?", new_back: "F = m · a; Masse mal Beschleunigung.",
	}] });
	assert.equal(result.ok, true);
	assert.equal(S.cards.karte2.back, "F = m · a; Masse mal Beschleunigung.");
});

test("stales Undo überschreibt keine neueren Änderungen", async () => {
	reset();
	const result = await TOOLS.run("change", { operations: [{ op: "page.create", title: "Sicher", content: "v1" }] });
	const page = Object.values(S.pages)[0];
	await STATE.dispatch("pageUpdate", { id: page.id, patch: { content: "v2" } });
	await assert.rejects(() => TOOLS.undo(result._undo), /erneut geändert/);
	assert.equal(S.pages[page.id].content, "v2");
});

test("eine einzelne Karte lässt sich über card.move verschieben", async () => {
	reset();
	await STATE.dispatch("cardCreate", { id: "eins", front: "Einzelfrage", back: "Antwort", deck: "Alt" });
	const result = await TOOLS.run("change", { operations: [{ op: "card.move", front: "Einzelfrage", to: "Neu" }] });
	assert.equal(result.ok, true);
	assert.equal(S.cards.eins.deck, "Neu");
});

test("Integralgrenzen dürfen verschachtelte Kommas enthalten", async () => {
	window.math = {
		evaluate: (expr) => expr === "min(1,2)" ? 1 : expr === "max(2,3)" ? 3 : Number(expr),
		compile: () => ({ evaluate: ({ x }) => x }),
		format: (value) => String(value),
	};
	const result = await TOOLS.run("calculate", { expression: 'integrate("x","x",min(1,2),max(2,3))' });
	assert.equal(result.ok, true);
	assert.ok(Math.abs(Number(result.result) - 4) < 1e-9);
});

test("page.patch ersetzt gezielt Textabschnitte und unterstützt Undo", async () => {
	reset();
	await STATE.dispatch("pageCreate", { id: "p_patch", title: "Patch-Test", parentId: null, content: "Zeile 1\nZu ersetzender Text\nZeile 3" });
	const result = await TOOLS.run("change", { operations: [
		{ op: "page.patch", title: "Patch-Test", search: "Zu ersetzender Text", replace: "Neuer Inhalt" },
	] });
	assert.equal(result.ok, true);
	assert.equal(S.pages.p_patch.content, "Zeile 1\nNeuer Inhalt\nZeile 3");
	assert.ok(result._undo);

	await TOOLS.undo(result._undo);
	assert.equal(S.pages.p_patch.content, "Zeile 1\nZu ersetzender Text\nZeile 3");
});

test("page.patch schlägt fehl wenn Suchtext fehlt oder mehrdeutig ist", async () => {
	reset();
	await STATE.dispatch("pageCreate", { id: "p_dup", title: "Mehrdeutig", parentId: null, content: "Echo Test Echo" });

	// Nicht gefunden
	const notFound = await TOOLS.run("change", { operations: [
		{ op: "page.patch", title: "Mehrdeutig", search: "NichtDa", replace: "X" },
	] });
	assert.match(notFound.error, /Suchtext wurde in der Seite nicht gefunden/);
	assert.equal(S.pages.p_dup.content, "Echo Test Echo");

	// Mehrdeutig
	const ambiguous = await TOOLS.run("change", { operations: [
		{ op: "page.patch", title: "Mehrdeutig", search: "Echo", replace: "X" },
	] });
	assert.match(ambiguous.error, /mehrfach in der Seite vor/);
	assert.equal(S.pages.p_dup.content, "Echo Test Echo");
});

test("change validiert alle Operationen vorab und meldet gesammelte Fehler ohne Änderungen", async () => {
	reset();
	await STATE.dispatch("pageCreate", { id: "p_safe", title: "Unberührt", parentId: null, content: "Bleibt unverändert" });

	const result = await TOOLS.run("change", { operations: [
		{ op: "page.append", content: "Ohne Titel" },
		{ op: "unbekannt.op", title: "X" },
		{ op: "page.patch", title: "Unberührt" }, // search und replace fehlen
	] });

	assert.match(result.error, /change: Validierungsfehler in 3 Operation\(en\)/);
	assert.match(result.error, /Operation 1 \(page\.append\): title oder content fehlt/);
	assert.match(result.error, /Operation 2: unbekannte Operation „unbekannt\.op“/);
	assert.match(result.error, /Operation 3 \(page\.patch\): title, search oder replace fehlt/);
	assert.match(result.error, /Keine Änderungen ausgeführt/);
	assert.equal(S.pages.p_safe.content, "Bleibt unverändert");
});

test("KI kann Seiten über inspect und change archivieren, auflisten und wiederherstellen", async () => {
	reset();
	await STATE.dispatch("pageCreate", { id: "p1", title: "Mathe", content: "Analysis", parentId: null });
	await STATE.dispatch("pageCreate", { id: "p2", title: "Latein", content: "Vokabeln", parentId: null });

	// Vorher: inspect("archived") ist leer
	const beforeInspect = await TOOLS.run("inspect", { kind: "archived" });
	assert.equal(beforeInspect.archived.length, 0);

	// Archivieren über change
	const archiveRes = await TOOLS.run("change", { operations: [
		{ op: "page.archive", title: "Mathe" },
	] });
	assert.equal(archiveRes.ok, true);
	assert.equal(S.pages.p1.archived, true);
	assert.equal(S.pages.p2.archived, undefined);

	// Jetzt findet inspect("archived") die archivierte Notiz
	const afterInspect = await TOOLS.run("inspect", { kind: "archived" });
	assert.equal(afterInspect.archived.length, 1);
	assert.equal(afterInspect.archived[0].title, "Mathe");

	// Wiederherstellen über change
	const unarchiveRes = await TOOLS.run("change", { operations: [
		{ op: "page.unarchive", title: "Mathe" },
	] });
	assert.equal(unarchiveRes.ok, true);
	assert.equal(S.pages.p1.archived, false);

	// Wiederherstellen lässt sich rückgängig machen
	await TOOLS.undo(unarchiveRes._undo);
	assert.equal(S.pages.p1.archived, true);

	// Heft archivieren
	await STATE.dispatch("pageCreate", { id: "h1", title: "Skizzenheft", content: "", parentId: null, kind: "heft" });
	const heftArchiveRes = await TOOLS.run("change", { operations: [
		{ op: "page.archive", title: "Skizzenheft" },
	] });
	assert.equal(heftArchiveRes.ok, true);
	assert.equal(S.pages.h1.archived, true);

	const inspectHeft = await TOOLS.run("inspect", { kind: "archived" });
	const heftEntry = inspectHeft.archived.find((x) => x.title === "Skizzenheft");
	assert.ok(heftEntry);
	assert.equal(heftEntry.kind, "heft");

	// KI-Suche durchsucht automatisch auch archivierte Inhalte
	const searchRes = await TOOLS.run("inspect", { kind: "search", query: "Analysis" });
	assert.ok(searchRes.results.some((r) => r.title === "Mathe" && r.archived === true));

	// KI kann archivierte Seite direkt per inspect("page") lesen
	const readRes = await TOOLS.run("inspect", { kind: "page", titles: ["Mathe"] });
	assert.equal(readRes.pages[0].title, "Mathe");
	assert.equal(readRes.pages[0].archived, true);
	assert.equal(readRes.pages[0].content, "Analysis");
});

