import test from "node:test";
import assert from "node:assert/strict";

const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.has(key) ? values.get(key) : null,
	setItem: (key, value) => values.set(key, String(value)),
	removeItem: (key) => values.delete(key),
};

const performanceObservers = [];
globalThis.PerformanceObserver = class {
	static supportedEntryTypes = ["longtask", "event"];
	constructor(callback) { this.callback = callback; performanceObservers.push(this); }
	observe(options) { this.type = options.type; this.options = options; }
	disconnect() {}
	emit(entries) { this.callback({ getEntries: () => entries }); }
};

const { PERF_PROFILER } = await import("../web/performance-profiler.js");

test("Profiler bleibt opt-in und exportiert nur begrenzte Metadaten", () => {
	assert.equal(PERF_PROFILER.isEnabled(), false);
	PERF_PROFILER.setEnabled(true);
	PERF_PROFILER.setContextProvider(() => ({ view: "page", pages: 12 }));
	PERF_PROFILER.record("test", 140.55, { name: "sync", count: 3, nested: { secret: "nicht exportieren" } });
	const report = JSON.parse(PERF_PROFILER.report());
	assert.equal(report.formatVersion, 2);
	assert.equal(report.contextEncoding, "delta");
	const entry = report.records.find((item) => item.kind === "test");
	assert.equal(entry.durationMs, 140.6);
	assert.equal(entry.name, "sync");
	assert.equal(entry.count, 3);
	assert.equal(entry.nested, undefined);
	assert.equal(entry.context.view, "page");
	assert.equal(entry.context.pages, 12);
	PERF_PROFILER.setEnabled(false);
});

test("Profiler bündelt überlappende Browser-Signale und verwirft Hover-Rauschen", () => {
	PERF_PROFILER.setEnabled(true);
	PERF_PROFILER.clear();
	const current = performanceObservers.slice(-2);
	const events = current.find((observer) => observer.type === "event");
	const tasks = current.find((observer) => observer.type === "longtask");
	assert.equal(events.options.buffered, undefined);
	assert.equal(tasks.options.buffered, undefined);
	events.emit([
		{ name: "pointerover", startTime: 100, duration: 120, interactionId: 0 },
		{ name: "pointerup", startTime: 110, duration: 120, interactionId: 42 },
		{ name: "mouseup", startTime: 110, duration: 120, interactionId: 42 },
		{ name: "click", startTime: 110, duration: 120, interactionId: 42 },
	]);
	tasks.emit([{ name: "self", startTime: 100, duration: 125 }]);
	const report = JSON.parse(PERF_PROFILER.report());
	const stalls = report.records.filter((item) => item.kind === "main-thread-stall");
	assert.equal(stalls.length, 1);
	assert.equal(stalls[0].eventCount, 3);
	assert.equal(stalls[0].interactionCount, 1);
	assert.equal(stalls[0].sources, "long-task+slow-input");
	assert.doesNotMatch(stalls[0].events, /pointerover/);
	assert.equal(report.records.some((item) => ["long-task", "slow-input", "event-loop-lag"].includes(item.kind)), false);
	PERF_PROFILER.setEnabled(false);
});

test("Profiler ordnet Hänger den zeitlich überlappenden Operationen zu", () => {
	PERF_PROFILER.setEnabled(true);
	PERF_PROFILER.clear();
	const tasks = performanceObservers.slice(-2).find((observer) => observer.type === "longtask");
	const finish = PERF_PROFILER.start("state.load", {}, 0);
	const started = performance.now();
	tasks.emit([{ name: "self", startTime: started, duration: 120 }]);
	finish();
	const report = JSON.parse(PERF_PROFILER.report());
	const stall = report.records.find((item) => item.kind === "main-thread-stall");
	assert.deepEqual(stall.context.operations.map((entry) => entry.name), ["state.load"]);
	PERF_PROFILER.setEnabled(false);
});

test("Profiler speichert unveränderten Kontext nur einmal", () => {
	PERF_PROFILER.setEnabled(true);
	PERF_PROFILER.clear();
	PERF_PROFILER.setContextProvider(() => ({ view: "page", pages: 12 }));
	PERF_PROFILER.record("first", 20);
	PERF_PROFILER.record("second", 21);
	const report = JSON.parse(PERF_PROFILER.report());
	assert.deepEqual(report.records[0].context, { view: "page", pages: 12, visibility: "unknown" });
	assert.equal(report.records[1].context, undefined);
	PERF_PROFILER.setEnabled(false);
});

test("Profiler begrenzt das lokale Protokoll", () => {
	PERF_PROFILER.setEnabled(true);
	PERF_PROFILER.clear();
	for (let i = 0; i < 220; i++) PERF_PROFILER.record("sample", i, { index: i });
	const report = JSON.parse(PERF_PROFILER.report());
	assert.equal(report.records.length, 180);
	assert.equal(report.records[0].index, 40);
	assert.equal(report.records.at(-1).index, 219);
	PERF_PROFILER.setEnabled(false);
});
