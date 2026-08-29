import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { SyncRoom } from "../server/worker.js";

class MemoryR2 {
	constructor() { this.map = new Map(); }
	async put(key, bytes, opts = {}) { this.map.set(key, { bytes: new Uint8Array(bytes), customMetadata: opts.customMetadata || {} }); }
	async get(key) { const rec = this.map.get(key); return rec ? { customMetadata: rec.customMetadata, arrayBuffer: async () => rec.bytes.buffer.slice(rec.bytes.byteOffset, rec.bytes.byteOffset + rec.bytes.byteLength) } : null; }
	async head(key) { return this.map.has(key) ? {} : null; }
	async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) this.map.delete(key); }
	async list({ prefix = "" } = {}) {
		const keys = [...this.map.keys()].filter((key) => key.startsWith(prefix)).sort();
		return { objects: keys.map((key) => ({ key })), truncated: false, cursor: "" };
	}
}

class MemoryD1 {
	constructor() { this.events = []; this.accounts = new Map(); }
	holdCountReads(expected, timeoutMs = 100) {
		let reads = 0, release;
		const gate = new Promise((resolve) => { release = resolve; });
		let timer = null;
		this.beforeCount = async () => {
			reads++;
			if (!timer) timer = setTimeout(release, timeoutMs);
			if (reads >= expected) { clearTimeout(timer); release(); }
			await gate;
		};
	}
	prepare(sql) {
		const db = this;
		const bound = (args = []) => ({
			async first() {
				if (/MAX\(seq\)/i.test(sql)) return { max_seq: Math.max(0, ...db.events.filter((e) => e.user_id === args[0]).map((e) => e.seq)) };
				if (/SELECT auth_token_hash,total_bytes/i.test(sql)) return db.accounts.get(args[0]) || null;
				if (/COUNT\(\*\)/i.test(sql)) { await db.beforeCount?.(); return { cnt: db.accounts.size }; }
				throw new Error(`Unhandled first SQL: ${sql}`);
			},
			async all() {
				if (/SELECT event_id FROM sync_events/i.test(sql)) {
					const [user, ...ids] = args; return { results: db.events.filter((e) => e.user_id === user && ids.includes(e.event_id)).map((e) => ({ event_id: e.event_id })) };
				}
				if (/SELECT seq,event_id id,iv,r2_key,size,created_at/i.test(sql)) {
					const [user, since, limit] = args;
					return { results: db.events.filter((e) => e.user_id === user && e.seq > since).sort((a,b) => a.seq-b.seq).slice(0, limit).map((e) => ({ seq:e.seq,id:e.event_id,iv:e.iv,r2_key:e.r2_key,size:e.size,created_at:e.created_at })) };
				}
				throw new Error(`Unhandled all SQL: ${sql}`);
			},
			async run() { return db.run(sql, args); },
		});
		return { bind: (...args) => bound(args), first: () => bound([]).first(), all: () => bound([]).all(), run: () => bound([]).run() };
	}
	async run(sql, args) {
		if (/INSERT INTO user_storage/i.test(sql)) {
			const [user, hash, bytes, updated, existingUser, maxUsers] = args;
			if (!this.accounts.has(existingUser) && this.accounts.size >= maxUsers) return { meta: { changes: 0, rows_written: 0 } };
			this.accounts.set(user, { auth_token_hash: hash, total_bytes: bytes, updated_at: updated });
			return { meta: { changes: 1, rows_written: 1 } };
		}
		if (/UPDATE user_storage SET total_bytes=0/i.test(sql)) {
			const [updated, user] = args, rec = this.accounts.get(user); if (rec) Object.assign(rec, { total_bytes: 0, updated_at: updated }); return {};
		}
		if (/UPDATE user_storage SET total_bytes/i.test(sql)) {
			const [bytes, updated, user] = args, rec = this.accounts.get(user); if (rec) Object.assign(rec, { total_bytes: bytes, updated_at: updated }); return {};
		}
		if (/INSERT INTO sync_events/i.test(sql)) {
			const [user_id, seq, event_id, iv, r2_key, size, created_at] = args;
			this.events.push({ user_id, seq, event_id, iv, r2_key, size, created_at }); return {};
		}
		if (/DELETE FROM sync_events/i.test(sql)) { this.events = this.events.filter((e) => e.user_id !== args[0]); return {}; }
		throw new Error(`Unhandled run SQL: ${sql}`);
	}
	async batch(statements) { for (const statement of statements) await statement.run(); return []; }
}

class MemoryStorage {
	constructor() { this.map = new Map(); }
	async get(key) { return this.map.get(key); }
	async put(key, value) { this.map.set(key, value); }
}

const packet = (id, text = "AAAA") => ({ id, iv: "00112233445566778899aabb", data: text });
const makeRoom = () => {
	const DB = new MemoryD1(), BUCKET = new MemoryR2(), storage = new MemoryStorage();
	const ctx = { storage, getWebSockets: () => [] };
	return { room: new SyncRoom(ctx, { DB, BUCKET }), DB, BUCKET, storage };
};

test("event writes are ordered, idempotent and readable", async () => {
	const { room, DB } = makeRoom();
	await room.init("user-1234567890123456");
	assert.equal(await room.authorize("secret-token"), true);
	const a = await room.savePackets([packet("a")]);
	const b = await room.savePackets([packet("b")]);
	const duplicate = await room.savePackets([packet("a")]);
	assert.deepEqual(a.saved.map((e) => e.seq), [1]);
	assert.deepEqual(b.saved.map((e) => e.seq), [2]);
	assert.equal(duplicate.saved.length, 0);
	assert.deepEqual({ fromSeq: a.fromSeq, toSeq: a.toSeq }, { fromSeq: 0, toSeq: 1 });
	assert.deepEqual({ fromSeq: b.fromSeq, toSeq: b.toSeq }, { fromSeq: 1, toSeq: 2 });
	assert.deepEqual({ fromSeq: duplicate.fromSeq, toSeq: duplicate.toSeq }, { fromSeq: 2, toSeq: 2 });
	const page = await room.readEvents(0, 10);
	assert.deepEqual(page.events.map((e) => e.seq), [1, 2]);
	assert.equal(DB.events.length, 2);
});

test("reset preserves channel authorization but clears data and advances generation", async () => {
	const { room, DB, BUCKET } = makeRoom();
	await room.init("user-1234567890123456");
	assert.equal(await room.authorize("secret-token"), true);
	await room.savePackets([packet("a")]);
	const oldHash = DB.accounts.get(room.userId).auth_token_hash;
	const response = await room.reset();
	assert.equal(response.status, 200);
	assert.equal(DB.events.length, 0);
	assert.equal(BUCKET.map.size, 0);
	assert.equal(DB.accounts.get(room.userId).auth_token_hash, oldHash);
	assert.equal(DB.accounts.get(room.userId).total_bytes, 0);
	assert.equal(await room.authorize("wrong-token"), false);
	assert.equal(await room.authorize("secret-token"), true);
	assert.equal(room.generation, 2);
});

test("existing tokens use the Workers timing-safe comparison", async () => {
	const subtle = globalThis.crypto.subtle;
	const original = Object.getOwnPropertyDescriptor(subtle, "timingSafeEqual");
	let comparisons = 0;
	Object.defineProperty(subtle, "timingSafeEqual", {
		configurable: true,
		value(left, right) {
			comparisons++;
			const a = new Uint8Array(left.buffer || left, left.byteOffset || 0, left.byteLength);
			const b = new Uint8Array(right.buffer || right, right.byteOffset || 0, right.byteLength);
			if (a.byteLength !== b.byteLength) return false;
			let difference = 0;
			for (let i = 0; i < a.byteLength; i++) difference |= a[i] ^ b[i];
			return difference === 0;
		},
	});
	try {
		const { room } = makeRoom();
		await room.init("user-1234567890123456");
		assert.equal(await room.authorize("secret-token"), true);
		assert.equal(await room.authorize("wrong-token"), false);
		assert.equal(await room.authorize("secret-token"), true);
		assert.equal(comparisons, 2);
	} finally {
		if (original) Object.defineProperty(subtle, "timingSafeEqual", original);
		else delete subtle.timingSafeEqual;
	}
});

test("blob downloads stream the R2 body without buffering the whole object", async () => {
	const { room, BUCKET } = makeRoom();
	const bytes = new Uint8Array([1, 2, 3, 4]);
	BUCKET.get = async () => ({
		customMetadata: { iv: "00112233445566778899aabb" },
		body: new Blob([bytes]).stream(),
		arrayBuffer: async () => { throw new Error("R2 object must not be buffered"); },
	});
	const response = await room.getBlob("a".repeat(64));
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("X-Impala-IV"), "00112233445566778899aabb");
	assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});

test("blob uploads stream the request body after checking its declared size", async () => {
	const { room, BUCKET } = makeRoom();
	await room.init("user-1234567890123456");
	assert.equal(await room.authorize("secret-token"), true);
	const bytes = new Uint8Array([5, 6, 7, 8]), key = "b".repeat(64);
	const request = new Request("https://example.com/upload", {
		method: "PUT",
		headers: { "Content-Length": String(bytes.byteLength), "X-Impala-IV": "00112233445566778899aabb" },
		body: bytes,
	});
	request.arrayBuffer = async () => { throw new Error("request body must not be buffered"); };
	let streamed = false;
	BUCKET.put = async (storedKey, body, options) => {
		streamed = body === request.body;
		const stored = new Uint8Array(await new Response(body).arrayBuffer());
		BUCKET.map.set(storedKey, { bytes: stored, customMetadata: options.customMetadata });
	};
	const response = await room.putBlob(key, request);
	assert.equal(response.status, 201);
	assert.equal(streamed, true);
	assert.deepEqual(BUCKET.map.get(`users/${room.userId}/blobs/${key}`).bytes, bytes);
});

test("malformed WebSocket messages are rejected without escaping the handler", async () => {
	const { room } = makeRoom();
	await room.init("user-1234567890123456");
	const sent = [], closed = [];
	const ws = {
		deserializeAttachment: () => ({ userId: room.userId, authenticated: true, protocol: 4 }),
		send: (message) => sent.push(JSON.parse(message)),
		close: (code, reason) => closed.push([code, reason]),
	};
	await assert.doesNotReject(() => room.webSocketMessage(ws, "{not-json"));
	assert.deepEqual(sent, [{ type: "invalid_message", error: "Ungültige WebSocket-Nachricht" }]);
	assert.deepEqual(closed, [[4400, "Invalid message"]]);
});

test("legacy missing D1 account is repaired without allowing channel takeover", async () => {
	const { room, DB, BUCKET, storage } = makeRoom();
	await room.init("user-1234567890123456");
	assert.equal(await room.authorize("secret-token"), true);
	DB.accounts.delete(room.userId);
	const ctx = { storage, getWebSockets: () => [] };
	const repaired = new SyncRoom(ctx, { DB, BUCKET });
	await repaired.init(room.userId);
	assert.equal(DB.accounts.has(room.userId), false);
	assert.equal(await repaired.authorize("wrong-token"), false);
	assert.equal(await repaired.authorize("secret-token"), true);
	assert.equal(DB.accounts.has(room.userId), true);
});

test("concurrent first authorization accepts exactly one token", async () => {
	const { room, DB } = makeRoom();
	await room.init("user-1234567890123456");
	DB.holdCountReads(2);
	const authorized = await Promise.all([
		room.authorize("first-secret-token"),
		room.authorize("second-secret-token"),
	]);
	assert.equal(authorized.filter(Boolean).length, 1);
	assert.equal(await room.authorize("first-secret-token"), authorized[0]);
	assert.equal(await room.authorize("second-secret-token"), authorized[1]);
});

test("concurrent account creation cannot exceed the global user limit", async () => {
	const DB = new MemoryD1(), BUCKET = new MemoryR2();
	const rooms = Array.from({ length: 11 }, (_, index) => new SyncRoom({
		storage: new MemoryStorage(),
		getWebSockets: () => [],
	}, { DB, BUCKET }));
	await Promise.all(rooms.map((room, index) => room.init(`user-${String(index).padStart(16, "0")}`)));
	DB.holdCountReads(rooms.length);
	const authorized = await Promise.all(rooms.map((room, index) => room.authorize(`secret-${index}`)));
	assert.equal(authorized.filter(Boolean).length, 10);
	assert.equal(DB.accounts.size, 10);
});

test("first v4 authorization discards legacy cloud data exactly once", async () => {
	const { room, DB, BUCKET, storage } = makeRoom();
	await room.init("user-1234567890123456");
	assert.equal(await room.authorize("secret-token"), true);
	await room.savePackets([packet("legacy")]);
	assert.equal(DB.events.length, 1);
	storage.map.delete("protocolVersion");
	const migrated = new SyncRoom({ storage, getWebSockets: () => [] }, { DB, BUCKET });
	await migrated.init(room.userId);
	assert.equal(await migrated.authorize("secret-token"), true);
	assert.equal(DB.events.length, 0);
	assert.equal(BUCKET.map.size, 0);
	assert.equal(migrated.generation, 2);
	assert.equal(storage.map.get("protocolVersion"), 4);
	await migrated.savePackets([packet("v4")]);
	assert.equal(DB.events.length, 1);
	assert.equal(await migrated.authorize("secret-token"), true);
	assert.equal(DB.events.length, 1, "v4 data must not be wiped on later authorizations");
});
