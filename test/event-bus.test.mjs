import test from "node:test";
import assert from "node:assert/strict";

import { BUS, EventBus } from "../web/event-bus.js";

test("EventBus: on und emit rufen registrierte Listener mit Payload auf", () => {
	const bus = new EventBus();
	const received = [];

	bus.on("test:event", (payload) => {
		received.push(payload);
	});

	bus.emit("test:event", { value: 42 });
	bus.emit("test:event", { value: 43 });

	assert.equal(received.length, 2);
	assert.deepEqual(received[0], { value: 42 });
	assert.deepEqual(received[1], { value: 43 });
});

test("EventBus: Mehrere Listener für dasselbe Event empfangen die Nachricht in Reihenfolge", () => {
	const bus = new EventBus();
	const order = [];

	bus.on("multi", () => order.push("first"));
	bus.on("multi", () => order.push("second"));

	bus.emit("multi", true);

	assert.deepEqual(order, ["first", "second"]);
});

test("EventBus: off deregistriert Listener zuverlässig", () => {
	const bus = new EventBus();
	let callCount = 0;
	const listener = () => { callCount++; };

	bus.on("sample", listener);
	bus.emit("sample");
	assert.equal(callCount, 1);

	bus.off("sample", listener);
	bus.emit("sample");
	assert.equal(callCount, 1, "Deregistrierter Listener darf nicht mehr aufgerufen werden");
});

test("EventBus: on() gibt eine Unsubscribe-Funktion zurück", () => {
	const bus = new EventBus();
	let callCount = 0;

	const unsubscribe = bus.on("unsub:test", () => {
		callCount++;
	});

	assert.equal(typeof unsubscribe, "function");

	bus.emit("unsub:test");
	assert.equal(callCount, 1);

	unsubscribe();
	bus.emit("unsub:test");
	assert.equal(callCount, 1, "Nach Aufruf von unsubscribe darf der Listener nicht mehr feuern");
});

test("EventBus: once() ruft Listener genau einmal auf und deregistriert sich selbst", () => {
	const bus = new EventBus();
	const received = [];

	bus.once("single", (data) => {
		received.push(data);
	});

	bus.emit("single", "first-run");
	bus.emit("single", "second-run");

	assert.equal(received.length, 1);
	assert.equal(received[0], "first-run");
});

test("EventBus: once() Unsubscribe-Rückgabewert funktioniert vor dem ersten Aufruf", () => {
	const bus = new EventBus();
	let callCount = 0;

	const unsubscribe = bus.once("early:unsub", () => {
		callCount++;
	});

	unsubscribe();
	bus.emit("early:unsub");

	assert.equal(callCount, 0, "Deregistrierter once-Listener darf nie aufgerufen werden");
});

test("EventBus: off() mit Originalfunktion deregistriert auch once-Listener", () => {
	const bus = new EventBus();
	let callCount = 0;
	const fn = () => { callCount++; };

	bus.once("off:once", fn);
	bus.off("off:once", fn);
	bus.emit("off:once");

	assert.equal(callCount, 0, "off mit Originalfunktion muss auch once-Wrapper entfernen");
});

test("EventBus: Fehlerisolierung — Werfender Listener bricht weder andere Listener noch den Fluss ab", () => {
	const bus = new EventBus();
	const executed = [];
	const originalConsoleError = console.error;
	let loggedError = null;

	console.error = (...args) => {
		loggedError = args;
	};

	try {
		bus.on("failing", () => {
			executed.push("before-throw");
			throw new Error("UI-Crash im Listener");
		});

		bus.on("failing", () => {
			executed.push("after-throw");
		});

		// emit darf trotz des Fehlers nicht throwen:
		assert.doesNotThrow(() => {
			bus.emit("failing", { test: true });
		});

		assert.deepEqual(executed, ["before-throw", "after-throw"]);
		assert.ok(loggedError, "Fehler muss über console.error protokolliert worden sein");
		assert.match(loggedError[0], /\[EventBus\] Fehler in Listener für "failing":/);
	} finally {
		console.error = originalConsoleError;
	}
});

test("EventBus: clear(eventName) bereinigt nur spezifiziertes Event", () => {
	const bus = new EventBus();
	let aCount = 0, bCount = 0;

	bus.on("eventA", () => aCount++);
	bus.on("eventB", () => bCount++);

	bus.clear("eventA");

	bus.emit("eventA");
	bus.emit("eventB");

	assert.equal(aCount, 0);
	assert.equal(bCount, 1);
});

test("EventBus: clear() ohne Argumente bereinigt alle registrierten Listener", () => {
	const bus = new EventBus();
	let count = 0;

	bus.on("a", () => count++);
	bus.on("b", () => count++);

	bus.clear();

	bus.emit("a");
	bus.emit("b");

	assert.equal(count, 0);
});

test("EventBus: Robuste Behandlung ungültiger Eingaben", () => {
	const bus = new EventBus();

	// Darf keine Fehler werfen und leere Unsubscribe-Funktion liefern
	const noop = bus.on(null, null);
	assert.equal(typeof noop, "function");
	assert.doesNotThrow(() => noop());

	assert.doesNotThrow(() => bus.off("", null));
	assert.doesNotThrow(() => bus.emit("", {}));
	assert.doesNotThrow(() => bus.once(undefined, () => {}));
});

test("EventBus: Singleton BUS ist als Instanz exportiert und einsatzbereit", () => {
	assert.ok(BUS instanceof EventBus);
	assert.equal(typeof BUS.on, "function");
	assert.equal(typeof BUS.off, "function");
	assert.equal(typeof BUS.emit, "function");
	assert.equal(typeof BUS.once, "function");
	assert.equal(typeof BUS.clear, "function");
});

// --- Integration mit STATE & dispatch ---
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
for (const key of ["window", "document", "Element", "Node", "HTMLElement", "MutationObserver", "navigator"]) {
	Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });
Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true });

const { S, STATE } = await import("../web/state.js");
const { DB } = await import("../web/db.js");
DB.addEvent = async (ev) => ev;

test("State-Integration: dispatch emittiert state:event-dispatched und fachliche Events", async () => {
	BUS.clear();

	const dispatched = [];
	const createdPages = [];
	const updatedPages = [];
	const deletedPages = [];
	const heftChanges = [];
	const cardUpdates = [];

	const unsubs = [
		BUS.on("state:event-dispatched", (ev) => dispatched.push(ev)),
		BUS.on("state:page-created", (payload) => createdPages.push(payload)),
		BUS.on("state:page-updated", (payload) => updatedPages.push(payload)),
		BUS.on("state:page-deleted", (payload) => deletedPages.push(payload)),
		BUS.on("state:heft-changed", (payload) => heftChanges.push(payload)),
		BUS.on("state:cards-updated", (payload) => cardUpdates.push(payload)),
	];

	// 1. pageCreate
	await STATE.dispatch("pageCreate", { id: "p_test1", title: "Test Page 1" });
	assert.equal(createdPages.length, 1);
	assert.equal(createdPages[0].id, "p_test1");
	assert.equal(createdPages[0].page?.title, "Test Page 1");
	assert.equal(dispatched.length, 1);
	assert.equal(dispatched[0].type, "pageCreate");

	// 2. pageUpdate
	await STATE.dispatch("pageUpdate", { id: "p_test1", patch: { title: "Title v2" } });
	assert.equal(updatedPages.length, 1);
	assert.equal(updatedPages[0].id, "p_test1");
	assert.deepEqual(updatedPages[0].patch, { title: "Title v2" });
	assert.equal(dispatched.length, 2);

	// 3. pageDelete
	await STATE.dispatch("pageDelete", { id: "p_test1" });
	assert.equal(deletedPages.length, 1);
	assert.equal(deletedPages[0].id, "p_test1");
	assert.equal(dispatched.length, 3);

	// 4. heftOps
	await STATE.dispatch("heftOps", { pageId: "h_test1", ops: [{ t: "s+", p: "h_test1", o: { id: "stroke1", pts: [[0, 0]] } }] });
	assert.equal(heftChanges.length, 1);
	assert.equal(heftChanges[0].pageId, "h_test1");
	assert.equal(dispatched.length, 4);

	// 5. cardCreate
	await STATE.dispatch("cardCreate", { id: "c_test1", front: "Frage", back: "Antwort" });
	assert.equal(cardUpdates.length, 1);
	assert.equal(cardUpdates[0].cardId, "c_test1");
	assert.equal(dispatched.length, 5);

	unsubs.forEach((u) => u());
	BUS.clear();
});
