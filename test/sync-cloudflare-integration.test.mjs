import test from "node:test";
import assert from "node:assert/strict";

import worker, { SyncRoom } from "../server/worker.js";
import { CLOUD_SYNC_PROTOCOL, CLOUD_SYNC_PROTOCOL_HEADER, cloudEventsEnvelope, prepareIncomingCloudEvents } from "../web/sync-core.js";
import {
	deriveSyncCredentials,
	encryptPayload,
	decryptPayload,
	generateSyncKey,
	MAX_USER_STORAGE_BYTES,
} from "../web/sync-crypto.js";

const KEY_A = "impala-0001-0002-0003-0004-0005-0006-0007-0008";
const KEY_B = "impala-1001-1002-1003-1004-1005-1006-1007-1008";

function syncHeaders(authToken, extra = {}) {
	return {
		Authorization: `Bearer ${authToken}`,
		[CLOUD_SYNC_PROTOCOL_HEADER]: String(CLOUD_SYNC_PROTOCOL),
		...extra,
	};
}

// In-Memory Cloudflare D1, R2, Storage & Worker Mock
function createMockEnv() {
	const dbStore = {
		events: [],
		accounts: new Map(),
		queries: [],
	};
	const bucketStore = new Map();
	const storageMap = new Map();

	const mockBucket = {
		async put(key, data, options = {}) {
			const bytes = data instanceof Uint8Array ? new Uint8Array(data) : new TextEncoder().encode(String(data || ""));
			bucketStore.set(key, { bytes, customMetadata: options.customMetadata || {} });
			return { key };
		},
		async get(key) {
			const item = bucketStore.get(key);
			if (!item) return null;
			return {
				key,
				customMetadata: item.customMetadata,
				async text() {
					return new TextDecoder().decode(item.bytes);
				},
				async arrayBuffer() {
					return item.bytes.buffer.slice(item.bytes.byteOffset, item.bytes.byteOffset + item.bytes.byteLength);
				},
			};
		},
		async head(key) {
			return bucketStore.has(key) ? {} : null;
		},
		async delete(keys) {
			const arr = Array.isArray(keys) ? keys : [keys];
			for (const k of arr) bucketStore.delete(k);
		},
		async list(options = {}) {
			const prefix = options.prefix || "";
			const objects = [];
			for (const [k] of bucketStore.entries()) {
				if (k.startsWith(prefix)) {
					objects.push({ key: k });
				}
			}
			return { objects, truncated: false, cursor: "" };
		},
	};

	const mockDb = {
		prepare(query) {
			dbStore.queries.push(query);
			const createOp = (params = []) => ({
				_query: query,
				_params: params,
				bind(...newParams) {
					return createOp(newParams);
				},
				async first() {
					if (query.includes("COUNT(*)")) {
						return { cnt: dbStore.accounts.size };
					}
					if (query.includes("MAX(seq)")) {
						const [userId] = params;
						const userEvents = dbStore.events.filter((e) => e.user_id === userId);
						const max = userEvents.reduce((m, e) => Math.max(m, e.seq), 0);
						return { max_seq: max };
					}
					if (query.includes("user_storage")) {
						const [userId] = params;
						const record = dbStore.accounts.get(userId);
						return record ? { total_bytes: record.total_bytes, auth_token_hash: record.auth_token_hash } : null;
					}
					return null;
				},
				async all() {
					if (query.includes("SELECT event_id FROM sync_events")) {
						const [userId, ...ids] = params;
						const matching = dbStore.events.filter((e) => e.user_id === userId && ids.includes(e.event_id));
						return { results: matching.map((e) => ({ event_id: e.event_id })) };
					}
					if (query.includes("SELECT seq,event_id id,iv,r2_key,size,created_at FROM sync_events")) {
						const [userId, since, limit] = params;
						const rows = dbStore.events
							.filter((e) => e.user_id === userId && e.seq > since)
							.sort((a, b) => a.seq - b.seq)
							.slice(0, limit)
							.map((e) => ({
								seq: e.seq,
								id: e.event_id,
								iv: e.iv,
								r2_key: e.r2_key,
								size: e.size,
								created_at: e.created_at,
							}));
						return { results: rows };
					}
					return { results: [] };
				},
				async run() {
					if (query.includes("INSERT INTO user_storage")) {
						const [userId, authHash, totalBytes, updatedAt] = params;
						dbStore.accounts.set(userId, { auth_token_hash: authHash, total_bytes: totalBytes, updated_at: updatedAt });
						return {};
					}
					if (query.includes("UPDATE user_storage SET total_bytes=0")) {
						const [updatedAt, userId] = params;
						const rec = dbStore.accounts.get(userId);
						if (rec) Object.assign(rec, { total_bytes: 0, updated_at: updatedAt });
						return {};
					}
					if (query.includes("UPDATE user_storage SET total_bytes=?")) {
						const [totalBytes, updatedAt, userId] = params;
						const rec = dbStore.accounts.get(userId);
						if (rec) Object.assign(rec, { total_bytes: totalBytes, updated_at: updatedAt });
						return {};
					}
					if (query.includes("INSERT INTO sync_events")) {
						const [userId, seq, eventId, iv, r2Key, size, createdAt] = params;
						dbStore.events.push({ user_id: userId, seq, event_id: eventId, iv, r2_key: r2Key, size, created_at: createdAt });
						return {};
					}
					if (query.includes("DELETE FROM sync_events")) {
						const [userId] = params;
						dbStore.events = dbStore.events.filter((e) => e.user_id !== userId);
						return {};
					}
					return {};
				},
			});
			return createOp();
		},
		async batch(statements) {
			for (const s of statements) await s.run();
			return [];
		},
	};

	const mockStorage = {
		async get(key) { return storageMap.get(key); },
		async put(key, val) { storageMap.set(key, val); },
		async delete(key) { storageMap.delete(key); },
	};

	const env = {
		DB: mockDb,
		BUCKET: mockBucket,
	};
	const ctx = {
		storage: mockStorage,
		getWebSockets: () => [],
	};

	return { env, ctx, dbStore, bucketStore, storageMap };
}

test("Worker Health Endpoint liefert v4-Metadaten", async () => {
	const { env } = createMockEnv();
	const res = await worker.fetch(new Request("https://example.com/api/health"), env);
	assert.equal(res.status, 200);
	const data = await res.json();
	assert.equal(data.protocol, 4);
	assert.equal(data.app, "Impala67 Sync Server");
	assert.ok(data.features.includes("ordered_http_sync"));
});

test("Worker lehnt alte Sync-Protokolle mit 426 ab", async () => {
	const { env } = createMockEnv();
	const resV3 = await worker.fetch(new Request("https://example.com/api/quota", {
		headers: { [CLOUD_SYNC_PROTOCOL_HEADER]: "3" },
	}), env);
	assert.equal(resV3.status, 426);
	assert.match((await resV3.json()).error, /Sync-Protokoll v4 erforderlich/);
});

test("Deduplizierung: Bereits gespeicherte Events werden ignoriert", async () => {
	const { env, ctx } = createMockEnv();
	const room = new SyncRoom(ctx, env);
	const { userId, authToken, cryptoKey } = await deriveSyncCredentials(generateSyncKey());
	await room.init(userId);
	assert.equal(await room.authorize(authToken), true);

	const packet1 = { id: "p-1", iv: "00112233445566778899aabb", data: "AAAA" };
	const packet2 = { id: "p-2", iv: "00112233445566778899aabb", data: "BBBB" };

	// 1. Upload von p-1 und p-2
	const res1 = await room.savePackets([packet1, packet2]);
	assert.equal(res1.ok, true);
	assert.equal(res1.saved.length, 2);
	assert.equal(room.maxSeq, 2);

	// 2. Erneuter Upload von p-1, p-2 und neuem p-3
	const packet3 = { id: "p-3", iv: "00112233445566778899aabb", data: "CCCC" };
	const res2 = await room.savePackets([packet1, packet2, packet3]);
	assert.equal(res2.ok, true);
	assert.equal(res2.saved.length, 1);
	assert.equal(res2.saved[0].id, "p-3");
	assert.equal(room.maxSeq, 3);

	// 3. No-Op Upload
	const res3 = await room.savePackets([packet1, packet2]);
	assert.equal(res3.ok, true);
	assert.equal(res3.saved.length, 0);
	assert.equal(room.maxSeq, 3);
});

test("Deduplizierung: Doppelte Packet-IDs im selben Batch werden nur einmal gespeichert", async () => {
	const { env, ctx } = createMockEnv();
	const room = new SyncRoom(ctx, env);
	const { userId, authToken } = await deriveSyncCredentials(generateSyncKey());
	await room.init(userId);
	await room.authorize(authToken);

	const packet = { id: "same-id", iv: "00112233445566778899aabb", data: "AAAA" };
	const res = await room.savePackets([packet, packet]);
	assert.equal(res.ok, true);
	assert.equal(res.saved.length, 1);
	assert.equal(room.maxSeq, 1);
});

test("Strikte Sequenzierung: Parallele Uploads erhalten eindeutige aufsteigende Sequenzen", async () => {
	const { env, ctx } = createMockEnv();
	const room = new SyncRoom(ctx, env);
	const { userId, authToken } = await deriveSyncCredentials(generateSyncKey());
	await room.init(userId);
	await room.authorize(authToken);

	const p1 = room.savePackets([{ id: "par-1", iv: "00112233445566778899aabb", data: "AAAA" }]);
	const p2 = room.savePackets([{ id: "par-2", iv: "00112233445566778899aabb", data: "BBBB" }]);
	const p3 = room.savePackets([{ id: "par-3", iv: "00112233445566778899aabb", data: "CCCC" }]);

	const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
	assert.equal(r1.ok, true);
	assert.equal(r2.ok, true);
	assert.equal(r3.ok, true);

	const allSeqs = [...r1.saved, ...r2.saved, ...r3.saved].map((p) => p.seq);
	assert.deepEqual(allSeqs.sort((a, b) => a - b), [1, 2, 3]);
	assert.equal(room.maxSeq, 3);
});

test("Quota-Enforcement: Pakete über 1.000 MB werden abgewiesen", async () => {
	const { env, ctx } = createMockEnv();
	const room = new SyncRoom(ctx, env);
	const { userId, authToken } = await deriveSyncCredentials(generateSyncKey());
	await room.init(userId);
	await room.authorize(authToken);

	// Simuliere fast vollen Speicher
	room.totalBytes = 999_999_990;

	const packet = { id: "overflow", iv: "00112233445566778899aabb", data: "AAAA".repeat(100) };
	const res = await room.savePackets([packet]);
	assert.equal(res.ok, false);
	assert.equal(res.status, 413);
	assert.match(res.error, /Quota überschritten/);
});

test("D1 + R2 Hybrid-Speicherung: Payloads liegen in R2 und D1 speichert Metadaten", async () => {
	const { env, ctx, bucketStore, dbStore } = createMockEnv();
	const room = new SyncRoom(ctx, env);
	const { userId, authToken } = await deriveSyncCredentials(generateSyncKey());
	await room.init(userId);
	await room.authorize(authToken);

	const packet = { id: "hybrid-1", iv: "00112233445566778899aabb", data: "AAAA" };
	const res = await room.savePackets([packet]);
	assert.equal(res.ok, true);

	assert.ok(bucketStore.has(`users/${userId}/events/hybrid-1.bin`));
	assert.equal(dbStore.events.length, 1);
	assert.equal(dbStore.events[0].event_id, "hybrid-1");
	assert.equal(dbStore.events[0].r2_key, `users/${userId}/events/hybrid-1.bin`);
});

test("R2-Rollback: Bei D1-Fehler werden neu angelegte R2-Objekte bereinigt", async () => {
	const { env, ctx, bucketStore } = createMockEnv();
	const room = new SyncRoom(ctx, env);
	const { userId, authToken } = await deriveSyncCredentials(generateSyncKey());
	await room.init(userId);
	await room.authorize(authToken);

	// D1-Batch werfen lassen
	env.DB.batch = async () => { throw new Error("D1 Error"); };

	const packet = { id: "rollback-1", iv: "00112233445566778899aabb", data: "AAAA" };
	const res = await room.savePackets([packet]);
	assert.equal(res.ok, false);
	assert.equal(res.status, 500);

	// R2 Objekt muss aufgeräumt sein
	assert.equal(bucketStore.has(`users/${userId}/events/rollback-1.bin`), false);
});

test("Cloud-Reset löscht Events und Blobs, erhöht Generation und behält Auth-Bindung", async () => {
	const { env, ctx, bucketStore, dbStore } = createMockEnv();
	const room = new SyncRoom(ctx, env);
	const { userId, authToken } = await deriveSyncCredentials(generateSyncKey());
	await room.init(userId);
	await room.authorize(authToken);

	await room.savePackets([{ id: "ev-reset", iv: "00112233445566778899aabb", data: "AAAA" }]);
	assert.equal(dbStore.events.length, 1);
	assert.equal(bucketStore.size, 1);

	const initialGen = room.generation;
	const res = await room.reset();
	assert.equal(res.status, 200);
	assert.equal(room.generation, initialGen + 1);
	assert.equal(room.maxSeq, 0);
	assert.equal(room.totalBytes, 0);
	assert.equal(dbStore.events.length, 0);
	assert.equal(bucketStore.size, 0);

	// Auth-Bindung bleibt intakt
	assert.equal(await room.authorize(authToken), true);
	assert.equal(await room.authorize("wrong-token"), false);
});

test("Security: Ungültiger Bearer-Token wird mit 403 abgewiesen", async () => {
	const { env, ctx } = createMockEnv();
	const room = new SyncRoom(ctx, env);
	const { userId, authToken } = await deriveSyncCredentials(generateSyncKey());
	await room.init(userId);
	await room.authorize(authToken);

	const req = new Request(`https://example.com/api/quota?user=${userId}`, {
		headers: syncHeaders("wrong-token"),
	});
	const res = await room.fetch(req);
	assert.equal(res.status, 403);
	assert.match((await res.json()).error, /Ungültiger Autorisierungs-Token/);
});

test("Security: Pfad- und Blob-Key-Manipulation wird abgewiesen", async () => {
	const { env, ctx } = createMockEnv();
	const room = new SyncRoom(ctx, env);
	const { userId, authToken } = await deriveSyncCredentials(generateSyncKey());
	await room.init(userId);
	await room.authorize(authToken);

	const reqBadKey = new Request(`https://example.com/api/blob/invalid-key?user=${userId}`, {
		headers: syncHeaders(authToken),
	});
	const resBadKey = await room.fetch(reqBadKey);
	assert.equal(resBadKey.status, 400);

	const reqTraversal = new Request(`https://example.com/api/blob/invalid..other?user=${userId}`, {
		headers: syncHeaders(authToken),
	});
	const resTraversal = await room.fetch(reqTraversal);
	assert.equal(resTraversal.status, 400);
});
