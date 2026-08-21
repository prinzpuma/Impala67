import test from "node:test";
import assert from "node:assert/strict";
import {
	CLOUD_COMPACT_COOLDOWN_MS,
	CLOUD_COMPACT_THRESHOLD_PERCENT,
	compactCloudData,
	shouldCompactCloud,
} from "../web/sync-maintenance.js";

test("Auto-Compaction startet nur verbunden, oberhalb der Schwelle und außerhalb des Cooldowns", () => {
	const now = 2_000_000_000_000;
	assert.equal(shouldCompactCloud({ status: "connected", usage: { percent: CLOUD_COMPACT_THRESHOLD_PERCENT - 1 } }, 0, now), false);
	assert.equal(shouldCompactCloud({ status: "syncing", usage: { percent: 100 } }, 0, now), false);
	assert.equal(shouldCompactCloud({ status: "connected", usage: { percent: CLOUD_COMPACT_THRESHOLD_PERCENT } }, now - CLOUD_COMPACT_COOLDOWN_MS + 1, now), false);
	assert.equal(shouldCompactCloud({ status: "connected", usage: { percent: CLOUD_COMPACT_THRESHOLD_PERCENT } }, now - CLOUD_COMPACT_COOLDOWN_MS, now), true);
});

test("Compaction synchronisiert, setzt Generation zurück und baut danach kompakt neu auf", async () => {
	const calls = [];
	let syncCount = 0;
	let usage = 900_000_000;
	const stored = new Map();
	const storage = {
		getItem: (key) => stored.get(key) ?? null,
		setItem: (key, value) => stored.set(key, String(value)),
	};
	const sync = {
		isConfigured: () => true,
		status: () => ({ status: "connected", usage: { bytes: usage, percent: Math.round(usage / 10_000_000) } }),
		syncNow: async () => {
			calls.push("sync");
			syncCount++;
			if (syncCount === 2) usage = 320_000_000;
			return true;
		},
		purgeCloudData: async () => { calls.push("reset"); usage = 0; return true; },
	};
	const now = 2_000_000_000_000;
	const result = await compactCloudData(sync, { storage, now });
	assert.deepEqual(calls, ["sync", "reset", "sync"]);
	assert.deepEqual(result, { compacted: true, before: 900_000_000, after: 320_000_000, reclaimed: 580_000_000 });
	assert.equal([...stored.values()][0], String(now));
});
