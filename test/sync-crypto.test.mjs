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

test("generateSyncKey erzeugt 16-stelligen strukturierten Schlüssel", () => {
	const key1 = generateSyncKey();
	const key2 = generateSyncKey();
	assert.ok(key1.startsWith("impala-"));
	assert.notEqual(key1, key2);
	assert.equal(key1.split("-").length, 5);
});

test("deriveSyncCredentials leitet deterministische User-ID und CryptoKey ab", async () => {
	const key = "impala-test-1234-5678-9abc";
	const creds1 = await deriveSyncCredentials(key);
	const creds2 = await deriveSyncCredentials(key);

	assert.equal(creds1.userId, creds2.userId);
	assert.equal(typeof creds1.userId, "string");
	assert.equal(creds1.userId.length, 64); // SHA-256 Hex
	assert.ok(creds1.cryptoKey);
});

test("encryptPayload und decryptPayload führen vollständigen E2EE-Zyklus durch", async () => {
	const key = "impala-secret-key-42";
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

test("decryptPayload mit falschem Schlüssel schlägt fehl", async () => {
	const creds1 = await deriveSyncCredentials("impala-key-1");
	const creds2 = await deriveSyncCredentials("impala-key-2");

	const event = { id: "ev-1", type: "test", payload: "secret" };
	const encrypted = await encryptPayload(creds1.cryptoKey, event);

	await assert.rejects(async () => {
		await decryptPayload(creds2.cryptoKey, encrypted);
	});
});

test("formatStorageUsage berechnet MB und Prozent korrekt für 200 MB Limit", () => {
	const usage1 = formatStorageUsage(0);
	assert.equal(usage1.mbUsed, 0);
	assert.equal(usage1.mbLimit, 200);
	assert.equal(usage1.percent, 0);

	const usage2 = formatStorageUsage(100 * 1024 * 1024); // 100 MB
	assert.equal(usage2.mbUsed, 100);
	assert.equal(usage2.percent, 50);

	const usage3 = formatStorageUsage(200 * 1024 * 1024); // 200 MB
	assert.equal(usage3.mbUsed, 200);
	assert.equal(usage3.percent, 100);
});

test("Base64 und Hex Helfer arbeiten verlustfrei", () => {
	const bytes = new Uint8Array([0, 15, 255, 128, 42, 7]);
	const b64 = bytesToBase64(bytes);
	assert.deepEqual(base64ToBytes(b64), bytes);

	const hex = bytesToHex(bytes);
	assert.deepEqual(hexToBytes(hex), bytes);
});
