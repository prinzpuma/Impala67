import test from "node:test";
import assert from "node:assert/strict";

import { CLOUDFLARE_SYNC } from "../web/sync-cloudflare.js";
import { generateSyncKey, formatStorageUsage, MAX_USER_STORAGE_BYTES } from "../web/sync-crypto.js";

test("CLOUDFLARE_SYNC hat initialen Status und Methoden", () => {
	const status = CLOUDFLARE_SYNC.status();
	assert.ok(status);
	assert.ok(["disconnected", "connecting", "connected", "syncing", "error"].includes(status.status));
	assert.equal(typeof CLOUDFLARE_SYNC.configure, "function");
	assert.equal(typeof CLOUDFLARE_SYNC.syncNow, "function");
	assert.equal(typeof CLOUDFLARE_SYNC.disconnect, "function");
	assert.equal(typeof CLOUDFLARE_SYNC.purgeCloudData, "function");
});

test("CLOUDFLARE_SYNC generiert sicheren Sync-Schlüssel", () => {
	const key = CLOUDFLARE_SYNC.generateSyncKey();
	assert.ok(key.startsWith("impala-"));
	assert.equal(key.split("-").length, 5);
});

test("CLOUDFLARE_SYNC Trennen setzt Zustand zurück", () => {
	CLOUDFLARE_SYNC.disconnect();
	const status = CLOUDFLARE_SYNC.status();
	assert.equal(status.status, "disconnected");
});

test("formatStorageUsage schützt vor Überlauf", () => {
	const usage = formatStorageUsage(500 * 1024 * 1024, MAX_USER_STORAGE_BYTES);
	assert.equal(usage.percent, 100);
	assert.equal(usage.mbUsed, 500);

	const overUsage = formatStorageUsage(550 * 1024 * 1024, MAX_USER_STORAGE_BYTES);
	assert.equal(overUsage.percent, 100);
	assert.equal(overUsage.mbUsed, 550);
});
