import test from "node:test";
import assert from "node:assert/strict";

const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.has(key) ? values.get(key) : null,
	setItem: (key, value) => values.set(key, String(value)),
	removeItem: (key) => values.delete(key),
};

const { PERF_PROFILER } = await import("../web/performance-profiler.js");

test("Profiler bleibt opt-in und exportiert nur begrenzte Metadaten", () => {
	assert.equal(PERF_PROFILER.isEnabled(), false);
	PERF_PROFILER.setEnabled(true);
	PERF_PROFILER.setContextProvider(() => ({ view: "page", pages: 12 }));
	PERF_PROFILER.record("test", 140.55, { name: "sync", count: 3, nested: { secret: "nicht exportieren" } });
	const report = JSON.parse(PERF_PROFILER.report());
	const entry = report.records.find((item) => item.kind === "test");
	assert.equal(entry.durationMs, 140.6);
	assert.equal(entry.name, "sync");
	assert.equal(entry.count, 3);
	assert.equal(entry.nested, undefined);
	assert.equal(entry.context.view, "page");
	assert.equal(entry.context.pages, 12);
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
