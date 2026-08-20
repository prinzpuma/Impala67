import test from "node:test";
import assert from "node:assert/strict";
import {
	generateSyncKey,
	deriveSyncCredentials,
	encryptPayload,
	decryptPayload,
	formatStorageUsage,
	bytesToBase64,
	base64ToBytes,
	bytesToHex,
	hexToBytes,
	MAX_USER_STORAGE_BYTES,
} from "../web/sync-crypto.js";

const KEY_A = "impala-0001-0002-0003-0004-0005-0006-0007-0008";
const KEY_B = "impala-1001-1002-1003-1004-1005-1006-1007-1008";

test("generateSyncKey erzeugt einen strukturierten 128-Bit-Schlüssel", () => {
	const key1 = generateSyncKey();
	const key2 = generateSyncKey();
	assert.match(key1, /^impala-(?:[0-9a-f]{4}-){7}[0-9a-f]{4}$/);
	assert.notEqual(key1, key2);
	assert.equal(key1.replace(/^impala-/, "").replaceAll("-", "").length, 32);
});

test("deriveSyncCredentials leitet deterministische User-ID und CryptoKey ab", async () => {
	const key = KEY_A;
	const creds1 = await deriveSyncCredentials(key);
	const creds2 = await deriveSyncCredentials(key);

	assert.equal(creds1.userId, creds2.userId);
	assert.equal(typeof creds1.userId, "string");
	assert.equal(creds1.userId.length, 64); // SHA-256 Hex
	assert.ok(creds1.cryptoKey);
});

test("alte oder frei formatierte Sync-Schlüssel werden abgelehnt", async () => {
	await assert.rejects(() => deriveSyncCredentials("impala-a7f9-2c3e-8b1d-9f4a"), /128-Bit/);
	await assert.rejects(() => deriveSyncCredentials("impala-secret-key-42"), /128-Bit/);
});

test("encryptPayload und decryptPayload führen vollständigen E2EE-Zyklus durch", async () => {
	const key = KEY_A;
	const { cryptoKey } = await deriveSyncCredentials(key);

	const originalEvent = {
		id: "ev-123",
		t: "2026-08-19T10:00:00.000Z",
		type: "pageCreate",
		payload: { id: "p1", title: "Geheime Notiz", content: "Top Secret 🤫" },
	};

	const encrypted = await encryptPayload(cryptoKey, originalEvent);
	assert.ok(encrypted.iv);
	assert.ok(encrypted.data);
	assert.ok(encrypted.size > 0);
	assert.notEqual(encrypted.data, JSON.stringify(originalEvent));

	const decrypted = await decryptPayload(cryptoKey, encrypted);
	assert.deepEqual(decrypted, originalEvent);
});

test("große Sync-Events werden vor E2EE komprimiert und verlustfrei gelesen", async () => {
	const { cryptoKey } = await deriveSyncCredentials(KEY_A);
	const originalEvent = {
		id: "large-event",
		type: "heftSnap",
		payload: { pageId: "h1", doc: { strokes: Array.from({ length: 20000 }, (_, index) => ({ x: index % 500, y: index % 300 })) } },
	};

	const encrypted = await encryptPayload(cryptoKey, originalEvent);
	assert.ok(encrypted.data.startsWith("gz:"));
	assert.ok(encrypted.data.length < JSON.stringify(originalEvent).length / 2);
	assert.deepEqual(await decryptPayload(cryptoKey, encrypted), originalEvent);
});

test("decryptPayload mit falschem Schlüssel schlägt fehl", async () => {
	const creds1 = await deriveSyncCredentials(KEY_A);
	const creds2 = await deriveSyncCredentials(KEY_B);

	const event = { id: "ev-1", type: "test", payload: "secret" };
	const encrypted = await encryptPayload(creds1.cryptoKey, event);

	await assert.rejects(async () => {
		await decryptPayload(creds2.cryptoKey, encrypted);
	});
});

test("formatStorageUsage berechnet MB und Prozent korrekt für 1.000 MB Limit", () => {
	const usage1 = formatStorageUsage(0);
	assert.equal(usage1.mbUsed, 0);
	assert.equal(usage1.mbLimit, 1000);
	assert.equal(usage1.percent, 0);

	const usage2 = formatStorageUsage(500_000_000); // 500 MB
	assert.equal(usage2.mbUsed, 500);
	assert.equal(usage2.percent, 50);

	const usage3 = formatStorageUsage(1_000_000_000); // 1000 MB
	assert.equal(usage3.mbUsed, 1000);
	assert.equal(usage3.percent, 100);
});

test("Base64 und Hex Helfer arbeiten verlustfrei", () => {
	const bytes = new Uint8Array([0, 15, 255, 128, 42, 7]);
	const b64 = bytesToBase64(bytes);
	assert.deepEqual(base64ToBytes(b64), bytes);

	const hex = bytesToHex(bytes);
	assert.deepEqual(hexToBytes(hex), bytes);
});
