import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { SyncRoom } from "../server/worker.js";
import { CLOUD_SYNC_PROTOCOL, pruneEventsForUpload, isBlobAlive } from "../web/sync-core.js";
import { DB } from "../web/db.js";
// Der Sync-Client ist der Rust-Kern (web/core/, npm run build:core) – derselbe, den die PWA lädt.
import initCore, * as CORE from "../web/core/impala_core.js";
await initCore({ module_or_path: fs.readFileSync(new URL("../web/core/impala_core_bg.wasm", import.meta.url)) });

// --- In-Memory Cloudflare D1 / R2 Mocks ---
class MemoryR2 {
	constructor() { this.map = new Map(); }
	async put(key, bytes, opts = {}) {
		// Dateien kommen wie bei R2 als Stream (request.body), Pakete als Bytes.
		const raw = bytes instanceof ReadableStream ? await new Response(bytes).arrayBuffer() : bytes;
		this.map.set(key, { bytes: new Uint8Array(raw), customMetadata: opts.customMetadata || {} });
	}
	async get(key) {
		const rec = this.map.get(key);
		return rec ? {
			customMetadata: rec.customMetadata,
			size: rec.bytes.byteLength,
			body: rec.bytes,
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
	const key = CORE.generateSyncKey();
	const creds = CORE.syncAuth(key);
	await room.init(creds.userId);
	await room.authorize(creds.authToken);
	return { room, key, creds, DB, BUCKET };
}

// fetch des Kerns direkt in den Durable Object des Workers.
const roomHttp = (room) => ({
	async send({ method, url, headers, body }) {
		// Content-Length setzt im echten Betrieb der Browser; der Worker verlangt ihn bei Dateien.
		const all = body ? [...headers, ["Content-Length", String(body.byteLength)]] : headers;
		const res = await room.fetch(new Request(url, { method, headers: all, body }));
		return { status: res.status, headers: [...res.headers], body: new Uint8Array(await res.arrayBuffer()) };
	},
});

// Ablage eines Geräts im Speicher (in der App: IndexedDB, localStorage, App-Zustand).
function memoryDevice() {
	const d = { state: {}, events: [], blobs: new Map(), pages: {} };
	d.add = (ev) => {
		d.events.push({ ...ev, seq: d.events.length + 1 });
		if (ev.type === "pageCreate") d.pages[ev.payload.id] = ev.payload;
	};
	d.store = {
		loadState: () => d.state,
		saveState: (s) => { d.state = s; },
		maxSeq: () => d.events.length,
		eventsAfter: (after, upTo) => d.events.filter((e) => e.seq > after && e.seq <= upTo),
		filterForUpload: (events) => events,
		importRemote: (events) => { for (const ev of events) if (!d.events.some((e) => e.id === ev.id)) d.add(ev); },
		pages: () => d.pages,
		blobIds: () => [...d.blobs.keys()],
		getBlob: (id) => d.blobs.get(id) || null,
		putBlob: (id, meta, data) => { d.blobs.set(id, { meta, data }); },
	};
	return d;
}

const openClient = (room, key, device, clientId) =>
	CORE.SyncCore.open("https://worker.test", key, clientId, roomHttp(room), device.store, undefined);

// Platzhalter-Paket: Der Server sieht ohnehin nur Chiffretext.
const opaquePacket = (id) => ({ id, iv: "0".repeat(24), data: "AAAA", size: 15 });

// ==========================================
// 1. SCHLÜSSEL & ANMELDUNG (Rust-Kern)
// ==========================================
test("Sync-Kern: Schlüssel, deterministische Anmeldung, Validierung", async () => {
	const key = CORE.generateSyncKey();
	assert.match(key, /^impala-[a-f0-9]{4}(?:-[a-f0-9]{4}){7}$/);
	const a = CORE.syncAuth(key), b = CORE.syncAuth(key);
	assert.equal(a.userId, b.userId);
	assert.equal(a.authToken, b.authToken);
	assert.match(a.userId, /^[0-9a-f]{64}$/);
	assert.notEqual(CORE.syncAuth(CORE.generateSyncKey()).userId, a.userId);
	assert.throws(() => CORE.syncAuth("ungueltig"));
	assert.throws(() => CORE.syncAuth(""));
	await assert.rejects(() => CORE.SyncCore.open("https://worker.test", "ungueltig", "c", roomHttp(null), memoryDevice().store, undefined));
});

// ==========================================
// 2. APP-REGELN, DIE IN JS BLEIBEN
// ==========================================
test("Sync: UI-Events gehen nicht hoch, Drei-Wege-Merge, Blob-Lebenszyklus", () => {
	assert.equal(CLOUD_SYNC_PROTOCOL, 4);
	const pruned = pruneEventsForUpload([{ id: "e1", type: "pageCreate" }, { id: "ui", type: "uiTabsSet" }, { id: "t", type: "uiTreeSet" }]);
	assert.deepEqual(pruned.map((e) => e.id), ["e1"]);

	const merged = DB.merge3("a\nb\nc", "A\nb\nc", "a\nb\nC");
	assert.equal(merged.ok, true);
	assert.equal(merged.text, "A\nb\nC");
	assert.equal(DB.merge3("a\nb\nc", "A\nb\nc", "B\nb\nc").ok, false);

	const pages = { pageA: { id: "pageA", coverImg: "cover:c1", content: "![Bild](img:i1)\n:::file file:f1 Datei" } };
	assert.equal(isBlobAlive("cover:c1", pages), true);
	assert.equal(isBlobAlive("img:i1", pages), true);
	assert.equal(isBlobAlive("file:f1", pages), true);
	assert.equal(isBlobAlive("img:verwaist", pages), false);
});

// ==========================================
// 3. SERVER & GERÄTE (Rust-Client gegen den echten Worker-Code)
// ==========================================
test("Sync Server: Idempotenz, Reihenfolge und Autorisierung", async () => {
	const { room, creds } = await createRoom();
	assert.equal(await room.authorize("falscher-token"), false);
	assert.equal(await room.authorize(creds.authToken), true);

	assert.equal((await room.savePackets([opaquePacket("p-1")])).saved.length, 1);
	// Doppelte Übertragung ist idempotent
	assert.equal((await room.savePackets([opaquePacket("p-1")])).saved.length, 0);
	const { events } = await room.readEvents(0, 10);
	assert.deepEqual(events.map((e) => e.id), ["p-1"]);
});

test("Sync Simulation: Zwei Offline-Geräte konvergieren ohne Datenverlust, Server sieht nur Chiffretext", async () => {
	const { room, key } = await createRoom();
	const a = memoryDevice(), b = memoryDevice();
	const blobId = "img:0b6f0a3e-6a51-4f4c-9b8e-2d2f6b8c1a10";
	a.add({ id: "ev-A", t: "2026-09-01T10:00:00Z", type: "pageCreate", payload: { id: "pA", title: "Notiz A", content: `![x](${blobId})` } });
	a.blobs.set(blobId, { meta: { type: "image/png" }, data: new Uint8Array([1, 2, 3, 4]) });
	b.add({ id: "ev-B", t: "2026-09-01T10:00:01Z", type: "pageCreate", payload: { id: "pB", title: "Notiz B" } });
	b.add({ id: "ui-B", t: "2026-09-01T10:00:02Z", type: "uiTabsSet", payload: { tabs: ["pB"] } });

	const ca = await openClient(room, key, a, "A"), cb = await openClient(room, key, b, "B");
	await ca.sync(false);
	await cb.sync(false);
	await ca.sync(false);

	const ids = (d) => d.events.map((e) => e.id).sort();
	assert.deepEqual(ids(a), ["ev-A", "ev-B"]);
	assert.deepEqual(ids(b), ["ev-A", "ev-B", "ui-B"]);
	assert.equal(a.events.find((e) => e.id === "ev-B")._remoteSource, "cloudflare");
	assert.deepEqual([...b.blobs.get(blobId).data], [1, 2, 3, 4]);
	assert.equal(b.blobs.get(blobId).meta.type, "image/png");
	assert.ok(a.state.lastSyncedSeq > 0 && a.state.lastUploadedSeq === a.events.length);

	const { events: packets } = await room.readEvents(0, 100);
	for (const p of packets) assert.ok(!p.data.includes("Notiz") && !atob(p.data.replace(/^gz:/, "")).includes("Notiz"));
	ca.free(); cb.free();
});

test("Sync Server: Reset setzt Daten zurück, das nächste Gerät baut die Cloud neu auf", async () => {
	const { room, key } = await createRoom();
	const a = memoryDevice(), b = memoryDevice();
	a.add({ id: "ev-1", t: "2026-09-01T10:00:00Z", type: "pageCreate", payload: { id: "p1" } });
	const ca = await openClient(room, key, a, "A"), cb = await openClient(room, key, b, "B");
	await ca.sync(false);
	await cb.sync(false);
	assert.equal((await room.readEvents(0, 10)).events.length, 1);
	const genBefore = room.generation;

	await ca.resetCloud();
	assert.ok(room.generation > genBefore);
	assert.equal((await room.readEvents(0, 10)).events.length, 0);
	assert.equal(ca.state().generation, room.generation);

	// B merkt den Generationswechsel und lädt seinen Stand komplett neu hoch.
	await cb.sync(false);
	assert.equal(cb.state().generation, room.generation);
	assert.equal((await room.readEvents(0, 10)).events.length, 1);
	ca.free(); cb.free();
});
