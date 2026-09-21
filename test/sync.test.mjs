import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { SyncRoom } from "../server/worker.js";
import {
	CLOUD_SYNC_PROTOCOL,
	CLOUD_SYNC_PROTOCOL_HEADER,
	chunkCloudEvents,
	cloudEventsEnvelope,
	prepareCloudEvents,
	prepareIncomingCloudEvents,
	pruneEventsForUpload,
	isBlobAlive,
	isSyncBlobId,
	heftBaselineOps,
} from "../web/sync-core.js";
import { DB } from "../web/db.js";
import {
	deriveSyncCredentials,
	encryptPayload,
	decryptPayload,
	encryptBlobRecord,
	decryptBlobRecord,
	generateSyncKey,
	formatStorageUsage,
} from "../web/sync-crypto.js";

// --- In-Memory Cloudflare D1 / R2 Mocks ---
class MemoryR2 {
	constructor() { this.map = new Map(); }
	async put(key, bytes, opts = {}) {
		this.map.set(key, { bytes: new Uint8Array(bytes), customMetadata: opts.customMetadata || {} });
	}
	async get(key) {
		const rec = this.map.get(key);
		return rec ? {
			customMetadata: rec.customMetadata,
			arrayBuffer: async () => rec.bytes.buffer.slice(rec.bytes.byteOffset, rec.bytes.byteOffset + rec.bytes.byteLength),
		} : null;
	}
	async head(key) { return this.map.has(key) ? {} : null; }
	async delete(keys) {
		for (const key of Array.isArray(keys) ? keys : [keys]) this.map.delete(key);
	}
	async list({ prefix = "" } = {}) {
		const keys = [...this.map.keys()].filter((k) => k.startsWith(prefix)).sort();
		return { objects: keys.map((key) => ({ key })), truncated: false, cursor: "" };
	}
}

class MemoryD1 {
	constructor() {
		this.events = [];
		this.accounts = new Map();
	}
	prepare(sql) {
		const db = this;
		const bound = (args = []) => ({
			async first() {
				if (/MAX\(seq\)/i.test(sql)) {
					const matching = db.events.filter((e) => e.user_id === args[0]);
					return { max_seq: matching.length ? Math.max(...matching.map((e) => e.seq)) : 0 };
				}
				if (/SELECT auth_token_hash,total_bytes/i.test(sql)) return db.accounts.get(args[0]) || null;
				if (/COUNT\(\*\)/i.test(sql)) return { cnt: db.accounts.size };
				throw new Error(`Unhandled first SQL: ${sql}`);
			},
			async all() {
				if (/SELECT event_id FROM sync_events/i.test(sql)) {
					const [user, ...ids] = args;
					return { results: db.events.filter((e) => e.user_id === user && ids.includes(e.event_id)).map((e) => ({ event_id: e.event_id })) };
				}
				if (/SELECT seq,event_id id,iv,r2_key,size,created_at/i.test(sql)) {
					const [user, since, limit] = args;
					return {
						results: db.events
							.filter((e) => e.user_id === user && e.seq > since)
							.sort((a, b) => a.seq - b.seq)
							.slice(0, limit)
							.map((e) => ({ seq: e.seq, id: e.event_id, iv: e.iv, r2_key: e.r2_key, size: e.size, created_at: e.created_at })),
					};
				}
				throw new Error(`Unhandled all SQL: ${sql}`);
			},
			async run() { return db.run(sql, args); },
		});
		return { bind: (...args) => bound(args), first: () => bound([]).first(), all: () => bound([]).all(), run: () => bound([]).run() };
	}
	async run(sql, args) {
		if (/INSERT INTO user_storage/i.test(sql)) {
			const [user, hash, bytes, updated] = args;
			this.accounts.set(user, { auth_token_hash: hash, total_bytes: bytes, updated_at: updated });
			return { meta: { rows_written: 1, changes: 1 } };
		}
		if (/UPDATE user_storage SET total_bytes=0/i.test(sql)) {
			const rec = this.accounts.get(args[1]);
			if (rec) rec.total_bytes = 0;
			return {};
		}
		if (/UPDATE user_storage SET total_bytes/i.test(sql)) {
			const rec = this.accounts.get(args[2]);
			if (rec) rec.total_bytes = args[0];
			return {};
		}
		if (/INSERT INTO sync_events/i.test(sql)) {
			const [user, seq, event_id, iv, r2_key, size, created] = args;
			this.events.push({ user_id: user, seq, event_id, iv, r2_key, size, created_at: created });
			return {};
		}
		if (/DELETE FROM sync_events/i.test(sql)) {
			this.events = this.events.filter((e) => e.user_id !== args[0]);
			return {};
		}
		throw new Error(`Unhandled run SQL: ${sql}`);
	}
	async batch(stmts) { for (const s of stmts) await s.run(); }
}

class MemoryStorage {
	constructor() { this.map = new Map(); }
	async get(k) { return this.map.get(k); }
	async put(k, v) { this.map.set(k, v); }
}

async function createRoom() {
	const DB = new MemoryD1(), BUCKET = new MemoryR2(), storage = new MemoryStorage();
	const room = new SyncRoom({ storage, getWebSockets: () => [] }, { DB, BUCKET });
	const key = generateSyncKey();
	const creds = await deriveSyncCredentials(key);
	await room.init(creds.userId);
	await room.authorize(creds.authToken);
	return { room, creds, DB, BUCKET };
}

// ==========================================
// 1. E2EE CRYPTO TESTS
// ==========================================
test("Sync Crypto: Deterministische Credentials & Key-Validierung", async () => {
	const key = generateSyncKey();
	assert.match(key, /^impala-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}$/);
	const c1 = await deriveSyncCredentials(key);
	const c2 = await deriveSyncCredentials(key);
	assert.equal(c1.userId, c2.userId);
	assert.equal(c1.authToken, c2.authToken);
	assert.ok(c1.cryptoKey);

	await assert.rejects(async () => deriveSyncCredentials("ungueltig"));
	await assert.rejects(async () => deriveSyncCredentials(""));
});

test("Sync Crypto: Verlustfreier E2EE Roundtrip für JSON und Binärdaten", async () => {
	const { cryptoKey } = await deriveSyncCredentials(generateSyncKey());
	const payload = { noteId: "n-1", content: "Geheimer Text #!?", numbers: [1, 2, 3], nested: { ok: true } };
	const encrypted = await encryptPayload(cryptoKey, payload);
	const decrypted = await decryptPayload(cryptoKey, encrypted);
	assert.deepEqual(decrypted, payload);

	// Falscher Schlüssel schlägt fehl
	const { cryptoKey: wrongKey } = await deriveSyncCredentials(generateSyncKey());
	await assert.rejects(async () => decryptPayload(wrongKey, encrypted));

	// Binär-Blobs (z. B. PDF / Cover)
	const testBytes = new TextEncoder().encode("Test-PDF-Bytes-12345").buffer;
	const blobRecord = await encryptBlobRecord(cryptoKey, "file:pdf-1", { buf: testBytes, meta: { type: "application/pdf" } });
	const decryptedBlob = await decryptBlobRecord(cryptoKey, blobRecord.iv, blobRecord.bytes);
	assert.equal(decryptedBlob.id, "file:pdf-1");
	assert.equal(decryptedBlob.meta.type, "application/pdf");
	assert.equal(new TextDecoder().decode(decryptedBlob.buf), "Test-PDF-Bytes-12345");
});

test("Sync Crypto: Gzip-Komprimierung oberhalb der 16-KB-Schwelle", async () => {
	const { cryptoKey } = await deriveSyncCredentials(generateSyncKey());
	const smallData = { text: "Klein" };
	const smallEncrypted = await encryptPayload(cryptoKey, smallData);
	assert.deepEqual(await decryptPayload(cryptoKey, smallEncrypted), smallData);

	const largeData = { text: "X".repeat(50000) };
	const largeEncrypted = await encryptPayload(cryptoKey, largeData);
	assert.deepEqual(await decryptPayload(cryptoKey, largeEncrypted), largeData);
	// Verschlüsselte gzip-Bytes beginnen mit gz: und sind signifikant kleiner
	assert.ok(largeEncrypted.data.startsWith("gz:"));
	assert.ok(largeEncrypted.data.length < 2000);
});

// ==========================================
// 2. PROTOKOLL v4 REGELN & WIRE FORMAT
// ==========================================
test("Sync Protocol v4: Wire-Format & Filter-Regeln", () => {
	assert.equal(CLOUD_SYNC_PROTOCOL, 4);

	// Veraltete Protokolle (< 4) ablehnen
	assert.throws(() => prepareIncomingCloudEvents([{ v: 3, event: { id: "old", type: "pageCreate" } }]), /v4/);

	// Remote-Echos und UI-Tabs werden für Cloud-Upload ausgefiltert
	const local1 = { id: "e1", t: "1", type: "pageCreate", payload: { id: "p1" } };
	const local2 = { id: "e2", t: "2", type: "heftOps", payload: { pageId: "h1", ops: [] } };
	const remote = { id: "e3", t: "3", type: "pageUpdate", _remoteSource: "cloudflare", payload: {} };
	const uiTab = { id: "ui", t: "4", type: "uiTabsSet", payload: {} };

	const cloudEvents = prepareCloudEvents([local1, local2, remote]);
	assert.deepEqual(cloudEvents.map((e) => e.id), ["e1", "e2"]);

	const pruned = pruneEventsForUpload([local1, local2, uiTab]);
	assert.deepEqual(pruned.map((e) => e.id), ["e1", "e2"]);

	// Chunking
	const batch = Array.from({ length: 501 }, (_, i) => ({ id: `id-${i}`, t: `${i}`, type: "x" }));
	const chunks = chunkCloudEvents(batch, { maxEvents: 250 });
	assert.equal(chunks.length, 3);
	assert.equal(chunks[0].length, 250);
	assert.equal(chunks[1].length, 250);
	assert.equal(chunks[2].length, 1);
});

test("Sync Protocol v4: Drei-Wege-Merge bei Notizen", () => {
	// Disjunkte Änderungen auf separaten Zeilen verschmelzen sauber
	const merged = DB.merge3("a\nb\nc", "A\nb\nc", "a\nb\nC");
	assert.equal(merged.ok, true);
	assert.equal(merged.text, "A\nb\nC");

	// Kollidierende Änderung auf derselben Zeile erzeugt Konflikt
	const conflict = DB.merge3("a\nb\nc", "A\nb\nc", "B\nb\nc");
	assert.equal(conflict.ok, false);
});

test("Sync Protocol v4: Blob-Lebenszyklus und GC-Filter", () => {
	assert.equal(isSyncBlobId("img:bild1"), true);
	assert.equal(isSyncBlobId("file:doc1"), true);
	assert.equal(isSyncBlobId("bgImage"), false);
	assert.equal(isSyncBlobId("heftver:x"), false);

	const pages = {
		pageA: { id: "pageA", coverImg: "cover:c1", content: "![Bild](img:i1)\n:::file file:f1 Datei" },
	};
	assert.equal(isBlobAlive("cover:c1", pages), true);
	assert.equal(isBlobAlive("img:i1", pages), true);
	assert.equal(isBlobAlive("file:f1", pages), true);
	assert.equal(isBlobAlive("img:verwaist", pages), false);
});

// ==========================================
// 3. SERVER & MULTI-DEVICE SIMULATION
// ==========================================
test("Sync Server: Idempotenz, Reihenfolge und Autorisierung", async () => {
	const { room, creds } = await createRoom();

	// Unautorisierter Zugriff wird abgewehrt
	assert.equal(await room.authorize("falscher-token"), false);
	assert.equal(await room.authorize(creds.authToken), true);

	const ev1 = { id: "ev-1", t: "2026-09-01T10:00:00Z", type: "pageCreate", payload: { id: "p1", title: "P1" } };
	const packet1 = { id: "p-1", ...(await encryptPayload(creds.cryptoKey, cloudEventsEnvelope([ev1]))) };

	// Erstes Speichern erfolgreich
	const res1 = await room.savePackets([packet1]);
	assert.equal(res1.saved.length, 1);

	// Doppelte Übertragung ist idempotent und erzeugt keinen Duplikateintrag
	const res2 = await room.savePackets([packet1]);
	assert.equal(res2.saved.length, 0);

	const { events } = await room.readEvents(0, 10);
	assert.equal(events.length, 1);
	assert.equal(events[0].id, "p-1");
});

test("Sync Simulation: Zwei Offline-Geräte konvergieren ohne Datenverlust", async () => {
	const { room, creds } = await createRoom();

	// Gerät A erstellt lokal Notiz A
	const evA = { id: "ev-A", t: "2026-09-01T10:00:00Z", type: "pageCreate", payload: { id: "pA", title: "Notiz A" } };
	const packA = { id: "p-A", ...(await encryptPayload(creds.cryptoKey, cloudEventsEnvelope([evA]))) };

	// Gerät B erstellt lokal Notiz B
	const evB = { id: "ev-B", t: "2026-09-01T10:00:01Z", type: "pageCreate", payload: { id: "pB", title: "Notiz B" } };
	const packB = { id: "p-B", ...(await encryptPayload(creds.cryptoKey, cloudEventsEnvelope([evB]))) };

	// Beide Geräte synchronisieren mit dem Server
	await Promise.all([room.savePackets([packA]), room.savePackets([packB])]);

	// Gerät A und Gerät B pullen die Server-Events
	const { events: serverEvents } = await room.readEvents(0, 10);
	assert.equal(serverEvents.length, 2);

	const receivedA = [];
	for (const pkt of serverEvents) {
		const decrypted = await decryptPayload(creds.cryptoKey, pkt);
		receivedA.push(...prepareIncomingCloudEvents([decrypted]));
	}

	const receivedIds = new Set(receivedA.map((e) => e.id));
	assert.ok(receivedIds.has("ev-A"));
	assert.ok(receivedIds.has("ev-B"));
});

test("Sync Server: Reset setzt Daten zurück und erhöht die Generation", async () => {
	const { room, creds } = await createRoom();

	const ev = { id: "ev-1", t: "2026-09-01T10:00:00Z", type: "pageCreate", payload: { id: "p1" } };
	const pack = { id: "p-1", ...(await encryptPayload(creds.cryptoKey, cloudEventsEnvelope([ev]))) };
	await room.savePackets([pack]);

	const before = await room.readEvents(0, 10);
	assert.equal(before.events.length, 1);
	const genBefore = room.generation;

	// Reset durchführen
	await room.reset();

	const after = await room.readEvents(0, 10);
	assert.equal(after.events.length, 0);
	assert.ok(room.generation > genBefore);
});
