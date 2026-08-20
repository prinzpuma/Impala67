import test from "node:test";
import assert from "node:assert/strict";

import { CLOUDFLARE_SYNC, resetSyncCursorStorage, syncCursorStorageKeys } from "../web/sync-cloudflare.js";
import { generateSyncKey, formatStorageUsage, MAX_USER_STORAGE_BYTES } from "../web/sync-crypto.js";
import { DB } from "../web/db.js";

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
	assert.match(key, /^impala-(?:[0-9a-f]{4}-){7}[0-9a-f]{4}$/);
});

test("Cloud-Purge setzt genau die benutzerspezifischen Sync-Cursor zurück", () => {
	const values = new Map([
		["impala67_cf_last_seq", "11"],
		["impala67_cf_last_uploaded_local_seq", "12"],
		["impala67_cf_last_seq_user-a", "91"],
		["impala67_cf_last_uploaded_local_seq_user-a", "92"],
		["impala67_cf_last_seq_user-b", "71"],
		["impala67_cf_last_uploaded_local_seq_user-b", "72"],
	]);
	const storage = {
		setItem: (key, value) => values.set(key, value),
	};
	resetSyncCursorStorage(storage, "user-a");
	const keys = syncCursorStorageKeys("user-a");
	assert.equal(values.get(keys.lastSynced), "0");
	assert.equal(values.get(keys.lastUploaded), "0");
	assert.equal(values.get("impala67_cf_last_seq_user-b"), "71");
	assert.equal(values.get("impala67_cf_last_seq"), "11");
	assert.throws(() => syncCursorStorageKeys(), /User-ID/);
});

test("CLOUDFLARE_SYNC Trennen setzt Zustand zurück", () => {
	CLOUDFLARE_SYNC.disconnect();
	const status = CLOUDFLARE_SYNC.status();
	assert.equal(status.status, "disconnected");
});

test("formatStorageUsage schützt vor Überlauf", () => {
	const usage = formatStorageUsage(1_000_000_000, MAX_USER_STORAGE_BYTES);
	assert.equal(usage.percent, 100);
	assert.equal(usage.mbUsed, 1000);

	const overUsage = formatStorageUsage(1_100_000_000, MAX_USER_STORAGE_BYTES);
	assert.equal(overUsage.percent, 100);
	assert.equal(overUsage.mbUsed, 1100);
});

test("Browser- oder Serverfehler werden nicht als erfolgreicher Sync verschluckt", async () => {
	const originalFetch = globalThis.fetch;
	const originalWebSocket = globalThis.WebSocket;
	const originalEventIds = DB.eventIds;
	globalThis.WebSocket = undefined;
	DB.eventIds = async () => [];
	globalThis.fetch = async () => new Response(JSON.stringify({ error: "CORS-Konfiguration fehlt" }), {
		status: 403,
		headers: { "Content-Type": "application/json" },
	});
	try {
		const success = await CLOUDFLARE_SYNC.configure("https://sync.example", generateSyncKey());
		assert.equal(success, false);
		assert.match(CLOUDFLARE_SYNC.status().detail, /CORS-Konfiguration fehlt/);
		await assert.rejects(() => CLOUDFLARE_SYNC.syncNow(), /CORS-Konfiguration fehlt/);
	} finally {
		CLOUDFLARE_SYNC.disconnect();
		globalThis.fetch = originalFetch;
		globalThis.WebSocket = originalWebSocket;
		DB.eventIds = originalEventIds;
	}
});
