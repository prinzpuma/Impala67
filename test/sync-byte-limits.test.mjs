import test from "node:test";
import assert from "node:assert/strict";
import { chunkCloudEvents, jsonByteLength } from "../web/sync-core.js";

test("Cloud-Event-Chunks begrenzen echte UTF-8-Bytes statt JS-Zeichen", () => {
	const a = { id: "a", type: "pageUpdate", payload: { text: "😀".repeat(20) } };
	const b = { id: "b", type: "pageUpdate", payload: { text: "ä".repeat(20) } };
	const bytesA = jsonByteLength(a), bytesB = jsonByteLength(b);
	assert.ok(bytesA > JSON.stringify(a).length);
	assert.ok(bytesB > JSON.stringify(b).length);
	const limit = bytesA + bytesB;
	assert.equal(chunkCloudEvents([a, b], { maxJsonBytes: limit + 2 }).length, 1);
	assert.equal(chunkCloudEvents([a, b], { maxJsonBytes: limit }).length, 2);
});

test("alter maxJsonChars-Optionsname misst aus Kompatibilitätsgründen ebenfalls Bytes", () => {
	const events = [
		{ id: "a", payload: { text: "😀".repeat(12) } },
		{ id: "b", payload: { text: "😀".repeat(12) } },
	];
	const one = jsonByteLength(events[0]) + 1;
	assert.equal(chunkCloudEvents(events, { maxJsonChars: one }).length, 2);
});
