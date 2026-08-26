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
	heftDiffOps,
} from "../web/sync-core.js";
import {
	deriveSyncCredentials,
	encryptPayload,
	decryptPayload,
	encryptBlobRecord,
	decryptBlobRecord,
	generateSyncKey,
	formatStorageUsage,
	sha256Hex,
} from "../web/sync-crypto.js";
import { DB } from "../web/db.js";
import { S, STATE } from "../web/state.js";
import { CLOUDFLARE_SYNC } from "../web/sync-cloudflare.js";

const storageMap = new Map();
globalThis.localStorage = {
	getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
	setItem: (k, v) => { storageMap.set(k, String(v)); },
	removeItem: (k) => { storageMap.delete(k); },
	clear: () => { storageMap.clear(); },
};
globalThis.IDBKeyRange = { lowerBound: (lower, open = false) => ({ lower, lowerOpen: open }) };

function createMemoryIndexedDB() {
	const databases = new Map();
	return {
		deleteDatabase(name) {
			const req = { onsuccess: null, onerror: null };
			setTimeout(() => {
				databases.delete(name);
				req.onsuccess?.({ target: req });
			}, 0);
			return req;
		},
		open(name, version = 1) {
			const req = { onsuccess: null, onerror: null, onupgradeneeded: null, result: null, error: null };
			setTimeout(() => {
				let dbRec = databases.get(name);
				const oldVersion = dbRec ? dbRec.version : 0;
				if (!dbRec) {
					dbRec = { name, version, stores: new Map(), autoIncs: new Map(), txQueue: Promise.resolve() };
					databases.set(name, dbRec);
				}
				const isUpgrade = version > oldVersion;
				const dbObj = {
					name, version,
					get objectStoreNames() {
						return { contains: (s) => dbRec.stores.has(s), [Symbol.iterator]: function* () { yield* dbRec.stores.keys(); } };
					},
					createObjectStore(storeName, opts = {}) {
						if (!dbRec.stores.has(storeName)) {
							dbRec.stores.set(storeName, new Map());
							dbRec.autoIncs.set(storeName, { keyPath: opts.keyPath || null, autoInc: !!opts.autoIncrement, nextKey: 1 });
						}
						return { createIndex() {} };
					},
					transaction(storeNames, mode = "readonly") {
						let aborted = false;
						let txCompleteResolve;
						const txCompletePromise = new Promise((res) => { txCompleteResolve = res; });
						const prevQueue = dbRec.txQueue;
						let myTurnResolve;
						const myTurnPromise = new Promise((res) => { myTurnResolve = res; });
						dbRec.txQueue = prevQueue.then(() => myTurnPromise).then(() => txCompletePromise);
						prevQueue.then(() => { myTurnResolve(); });

						let pendingReqCount = 0;
						let completed = false;
						function scheduleCommitCheck() {
							if (completed || aborted) return;
							if (pendingReqCount === 0) {
								completed = true;
								setTimeout(() => {
									if (!aborted) {
										tx.oncomplete?.({ target: tx });
										txCompleteResolve();
									}
								}, 0);
							}
						}

						const tx = {
							mode, error: null, oncomplete: null, onerror: null, onabort: null,
							abort() {
								aborted = true;
								tx.error = new Error("Transaction aborted");
								setTimeout(() => { tx.onabort?.({ target: tx }); txCompleteResolve(); }, 0);
							},
							objectStore(sName) {
								const storeMap = dbRec.stores.get(sName);
								const meta = dbRec.autoIncs.get(sName) || { keyPath: null, autoInc: false, nextKey: 1 };
								if (!storeMap) throw new Error(`Object store not found: ${sName}`);
								function makeReq(fn) {
									pendingReqCount++;
									const r = { onsuccess: null, onerror: null, result: null, error: null };
									myTurnPromise.then(() => {
										setTimeout(() => {
											if (aborted) return;
											try {
												r.result = fn();
												r.onsuccess?.({ target: r });
											} catch (err) {
												r.error = err;
												r.onerror?.({ target: r });
											} finally {
												pendingReqCount--;
												scheduleCommitCheck();
											}
										}, 0);
									});
									return r;
								}
								return {
									get(k) { return makeReq(() => { const v = storeMap.get(k); return v !== undefined ? structuredClone(v) : undefined; }); },
									getAll() { return makeReq(() => [...storeMap.values()].map((v) => structuredClone(v))); },
									getAllKeys() { return makeReq(() => [...storeMap.keys()]); },
									count() { return makeReq(() => storeMap.size); },
									put(v, k) { return makeReq(() => {
										let key = k;
										if (meta.keyPath && v && typeof v === "object") {
											key = v[meta.keyPath];
											if (key === undefined && meta.autoInc) { key = meta.nextKey++; v[meta.keyPath] = key; }
										}
										if (key === undefined && meta.autoInc) { key = meta.nextKey++; }
										if (typeof key === "number" && meta.autoInc) meta.nextKey = Math.max(meta.nextKey, key + 1);
										storeMap.set(key, structuredClone(v));
										return key;
									}); },
									add(v, k) { return makeReq(() => {
										let key = k;
										if (meta.keyPath && v && typeof v === "object") {
											key = v[meta.keyPath];
											if (key === undefined && meta.autoInc) { key = meta.nextKey++; v[meta.keyPath] = key; }
										}
										if (key === undefined && meta.autoInc) { key = meta.nextKey++; }
										if (typeof key === "number" && meta.autoInc) meta.nextKey = Math.max(meta.nextKey, key + 1);
										if (storeMap.has(key)) throw new Error("Key already exists: " + key);
										storeMap.set(key, structuredClone(v));
										return key;
									}); },
									delete(k) { return makeReq(() => { storeMap.delete(k); return undefined; }); },
									openCursor(range, dir = "next") {
										const r = { onsuccess: null, onerror: null, result: null };
										pendingReqCount++;
										myTurnPromise.then(() => {
											setTimeout(() => {
												if (aborted) return;
												let entries = [...storeMap.entries()];
												if (range && range.lower !== undefined) {
													entries = entries.filter(([k]) => (range.lowerOpen ? k > range.lower : k >= range.lower));
												}
												if (dir === "prev") entries.reverse();
												let idx = 0;
												function step() {
													if (idx < entries.length) {
														const [curKey, curVal] = entries[idx];
														r.result = {
															key: curKey,
															value: structuredClone(curVal),
															continue() {
																idx++;
																pendingReqCount++;
																setTimeout(step, 0);
															}
														};
													} else {
														r.result = null;
													}
													try {
														r.onsuccess?.({ target: r });
													} finally {
														pendingReqCount--;
														scheduleCommitCheck();
													}
												}
												step();
											}, 0);
										});
										return r;
									},
								};
							},
						};
						myTurnPromise.then(() => {
							setTimeout(scheduleCommitCheck, 0);
						});
						return tx;
					},
					close() {},
				};
				req.result = dbObj;
				if (isUpgrade && req.onupgradeneeded) {
					req.transaction = dbObj.transaction([...dbRec.stores.keys()], "versionchange");
					req.onupgradeneeded({ target: req });
				}
				setTimeout(() => req.onsuccess?.({ target: req }), 5);
			}, 0);
			return req;
		}
	};
}

class MockWebSocket {
	static instances = [];
	constructor(url) {
		this.url = url;
		this.readyState = 1;
		this.listeners = {};
		MockWebSocket.instances.push(this);
		this.sent = [];
		queueMicrotask(() => {
			this.emit("open");
		});
	}
	addEventListener(type, cb) {
		this.listeners[type] = this.listeners[type] || [];
		this.listeners[type].push(cb);
	}
	removeEventListener(type, cb) {
		if (this.listeners[type]) {
			this.listeners[type] = this.listeners[type].filter((fn) => fn !== cb);
		}
	}
	send(data) {
		this.sent.push(data);
	}
	close() {
		this.readyState = 3;
		this.emit("close");
	}
	emit(type, event = {}) {
		const list = (this.listeners[type] || []).slice();
		for (const fn of list) fn(event);
	}
}

// Helper Memory Stores
class SimR2 {
	constructor() { this.map = new Map(); }
	async put(key, bytes, opts = {}) { this.map.set(key, { bytes: new Uint8Array(bytes), customMetadata: opts.customMetadata || {} }); }
	async get(key) {
		const rec = this.map.get(key);
		return rec ? {
			customMetadata: rec.customMetadata,
			arrayBuffer: async () => rec.bytes.buffer.slice(rec.bytes.byteOffset, rec.bytes.byteOffset + rec.bytes.byteLength),
		} : null;
	}
	async head(key) { return this.map.has(key) ? {} : null; }
	async delete(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) this.map.delete(k); }
	async list({ prefix = "", cursor = "" } = {}) {
		const keys = [...this.map.keys()].filter((k) => k.startsWith(prefix)).sort();
		return { objects: keys.map((key) => ({ key })), truncated: false, cursor: "" };
	}
}

class SimD1 {
	constructor() { this.events = []; this.accounts = new Map(); }
	prepare(sql) {
		const db = this;
		const bound = (args = []) => ({
			async first() {
				if (/MAX\(seq\)/i.test(sql)) {
					const [user] = args;
					const userEvents = db.events.filter((e) => e.user_id === user);
					return { max_seq: userEvents.reduce((m, e) => Math.max(m, e.seq), 0) };
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
					const rows = db.events.filter((e) => e.user_id === user && e.seq > since).sort((a, b) => a.seq - b.seq).slice(0, limit);
					return { results: rows.map((e) => ({ seq: e.seq, id: e.event_id, iv: e.iv, r2_key: e.r2_key, size: e.size, created_at: e.created_at })) };
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
			return {};
		}
		if (/UPDATE user_storage SET total_bytes=0/i.test(sql)) {
			const [updated, user] = args, rec = this.accounts.get(user);
			if (rec) Object.assign(rec, { total_bytes: 0, updated_at: updated });
			return {};
		}
		if (/UPDATE user_storage SET total_bytes/i.test(sql)) {
			const [bytes, updated, user] = args, rec = this.accounts.get(user);
			if (rec) Object.assign(rec, { total_bytes: bytes, updated_at: updated });
			return {};
		}
		if (/INSERT INTO sync_events/i.test(sql)) {
			const [user_id, seq, event_id, iv, r2_key, size, created_at] = args;
			this.events.push({ user_id, seq, event_id, iv, r2_key, size, created_at });
			return {};
		}
		if (/DELETE FROM sync_events/i.test(sql)) {
			this.events = this.events.filter((e) => e.user_id !== args[0]);
			return {};
		}
		throw new Error(`Unhandled run SQL: ${sql}`);
	}
	async batch(statements) { for (const s of statements) await s.run(); return []; }
}

class SimStorage {
	constructor() { this.map = new Map(); }
	async get(k) { return this.map.get(k); }
	async put(k, v) { this.map.set(k, v); }
	async delete(k) { this.map.delete(k); }
}

function createSimulatedServer() {
	const DB = new SimD1(), BUCKET = new SimR2(), storage = new SimStorage();
	const ctx = { storage, getWebSockets: () => [] };
	const room = new SyncRoom(ctx, { DB, BUCKET });
	return { room, DB, BUCKET, storage };
}

// Simulated Client Instance
class SimulatedClient {
	constructor(id, syncKey, serverRoom) {
		this.id = id;
		this.syncKey = syncKey;
		this.serverRoom = serverRoom;
		this.credentials = null;
		this.events = [];
		this.blobs = new Map();
		this.lastSyncedSeq = 0;
		this.lastUploadedLocalSeq = 0;
		this.generation = 1;
		this.seqCounter = 0;
	}

	async init() {
		this.credentials = await deriveSyncCredentials(this.syncKey);
		await this.serverRoom.init(this.credentials.userId);
		await this.serverRoom.authorize(this.credentials.authToken);
	}

	async addLocalEvent(type, payload, t = new Date().toISOString()) {
		const id = `ev-${this.id}-${++this.seqCounter}-${Math.random().toString(16).slice(2, 8)}`;
		const ev = { id, seq: this.events.length + 1, t, type, payload };
		this.events.push(ev);
		return ev;
	}

	async sync() {
		// 1. Pull
		await this.pull();
		// 2. Push
		await this.push();
		// 3. Final Pull
		await this.pull();
	}

	async pull() {
		while (true) {
			const since = this.lastSyncedSeq;
			const { events: packets, stopped } = await this.serverRoom.readEvents(since, 100);
			if (!packets || !packets.length) break;

			let expected = since + 1;
			for (const packet of packets) {
				if (packet.seq !== expected) throw new Error(`Lücke: erwartet ${expected}, bekommen ${packet.seq}`);
				const envelope = await decryptPayload(this.credentials.cryptoKey, packet);
				const incoming = prepareIncomingCloudEvents([envelope]);
				for (const inc of incoming) {
					if (!this.events.some((e) => e.id === inc.id)) {
						this.events.push({ ...inc, seq: this.events.length + 1 });
					}
				}
				this.lastSyncedSeq = packet.seq;
				expected++;
			}
			if (stopped || packets.length < 100) break;
		}
	}

	async push(opts = {}) {
		const unuploaded = this.events.filter((e) => Number(e.seq || 0) > this.lastUploadedLocalSeq && e._remoteSource !== "cloudflare");
		if (!unuploaded.length) {
			this.lastUploadedLocalSeq = this.events.reduce((max, e) => Math.max(max, Number(e.seq) || 0), 0);
			return;
		}

		const wire = prepareCloudEvents(pruneEventsForUpload(unuploaded));
		const chunks = chunkCloudEvents(wire, { maxEvents: opts.maxEvents || 250 });
		const packets = [];
		for (const chunk of chunks) {
			const id = `p-${await sha256Hex(chunk.map((e) => e.id).join("\n"))}`;
			const encrypted = await encryptPayload(this.credentials.cryptoKey, cloudEventsEnvelope(chunk));
			packets.push({ id, ...encrypted });
		}
		const res = await this.serverRoom.savePackets(packets);
		if (!res.ok) throw new Error(`Push fehlgeschlagen: ${res.error}`);
		this.lastUploadedLocalSeq = this.events.reduce((max, e) => Math.max(max, Number(e.seq) || 0), 0);
	}

	logicalState() {
		// Reconstruct pages
		const pages = {};
		const sorted = [...this.events].sort((a, b) => a.t.localeCompare(b.t) || (a.seq || 0) - (b.seq || 0));
		for (const ev of sorted) {
			if (ev.type === "pageCreate") pages[ev.payload.id] = { id: ev.payload.id, title: ev.payload.title, content: ev.payload.content || "" };
			else if (ev.type === "pageUpdate" && pages[ev.payload.id]) {
				if (ev.payload.patch?.title) pages[ev.payload.id].title = ev.payload.patch.title;
				if (ev.payload.patch?.content !== undefined) pages[ev.payload.id].content = ev.payload.patch.content;
			}
			else if (ev.type === "pageDelete") delete pages[ev.payload.id];
		}
		return pages;
	}
}

// -----------------------------------------------------------------------------
// 3. ZWEI-GERÄTE-SIMULATION
// -----------------------------------------------------------------------------
test("Zwei-Geräte-Simulation: Offline-Erstellung, Konvergenz und Cursor-Stabilität ohne Duplikate", async () => {
	const { room } = createSimulatedServer();
	const syncKey = generateSyncKey();
	const clientA = new SimulatedClient("A", syncKey, room);
	const clientB = new SimulatedClient("B", syncKey, room);
	await clientA.init();
	await clientB.init();

	// A erstellt A1 offline
	await clientA.addLocalEvent("pageCreate", { id: "p1", title: "Note A1", content: "Content A1" }, "2026-08-20T10:00:00Z");

	// B erstellt B1 offline
	await clientB.addLocalEvent("pageCreate", { id: "p2", title: "Note B1", content: "Content B1" }, "2026-08-20T10:01:00Z");

	// A synchronisiert zuerst
	await clientA.sync();

	// B synchronisiert danach
	await clientB.sync();

	// A synchronisiert nochmals, um B1 abzuholen
	await clientA.sync();

	// Beide Geräte müssen A1 und B1 besitzen und denselben logischen Endzustand haben
	const stateA = clientA.logicalState();
	const stateB = clientB.logicalState();
	assert.deepEqual(stateA, stateB);
	assert.ok(stateA["p1"] && stateA["p2"]);

	const countA = clientA.events.length;
	const countB = clientB.events.length;
	const cursorA = clientA.lastSyncedSeq;
	const cursorB = clientB.lastSyncedSeq;

	// Erneuter Sync ohne Änderungen
	await clientA.sync();
	await clientB.sync();

	// Erwartung: Keine Duplikate, kein Ping-Pong, Cursors stabil
	assert.equal(clientA.events.length, countA);
	assert.equal(clientB.events.length, countB);
	assert.equal(clientA.lastSyncedSeq, cursorA);
	assert.equal(clientB.lastSyncedSeq, cursorB);
});

// -----------------------------------------------------------------------------
// 4. DREI-GERÄTE-SIMULATION
// -----------------------------------------------------------------------------
test("Drei-Geräte-Simulation: ungünstige Sync-Reihenfolge & Replay-Konsistenz", async () => {
	const { room } = createSimulatedServer();
	const syncKey = generateSyncKey();
	const clientA = new SimulatedClient("A", syncKey, room);
	const clientB = new SimulatedClient("B", syncKey, room);
	const clientC = new SimulatedClient("C", syncKey, room);
	await clientA.init();
	await clientB.init();
	await clientC.init();

	// Gemeinsame Ausgangsbasis: Seite X und Y
	await clientA.addLocalEvent("pageCreate", { id: "pX", title: "Page X Base", content: "Base X" }, "2026-08-20T08:00:00Z");
	await clientA.addLocalEvent("pageCreate", { id: "pY", title: "Page Y Base", content: "Base Y" }, "2026-08-20T08:01:00Z");
	await clientA.sync();
	await clientB.sync();
	await clientC.sync();

	// Alle offline
	// A ändert Seite X
	await clientA.addLocalEvent("pageUpdate", { id: "pX", patch: { content: "Page X updated by A" } }, "2026-08-20T09:00:00Z");
	// B ändert Seite Y
	await clientB.addLocalEvent("pageUpdate", { id: "pY", patch: { content: "Page Y updated by B" } }, "2026-08-20T09:05:00Z");
	// C erstellt Seite Z
	await clientC.addLocalEvent("pageCreate", { id: "pZ", title: "Page Z created by C", content: "Content Z" }, "2026-08-20T09:10:00Z");

	// In ungünstiger Reihenfolge synchronisieren: B, A, C, A, B, C
	await clientB.sync();
	await clientA.sync();
	await clientC.sync();
	await clientA.sync();
	await clientB.sync();
	await clientC.sync();

	// Alle drei müssen denselben logischen Endzustand haben
	const stateA = clientA.logicalState();
	const stateB = clientB.logicalState();
	const stateC = clientC.logicalState();
	assert.deepEqual(stateA, stateB);
	assert.deepEqual(stateB, stateC);
	assert.equal(stateA["pX"].content, "Page X updated by A");
	assert.equal(stateA["pY"].content, "Page Y updated by B");
	assert.equal(stateA["pZ"].title, "Page Z created by C");

	// Replay / Rebuild: simuliere Rebuild aus dem Eventlog
	const replayedA = clientA.logicalState();
	const replayedB = clientB.logicalState();
	const replayedC = clientC.logicalState();
	assert.deepEqual(replayedA, stateA);
	assert.deepEqual(replayedB, stateB);
	assert.deepEqual(replayedC, stateC);
});

// -----------------------------------------------------------------------------
// 5. CURSOR-RACE — KRITISCH
// -----------------------------------------------------------------------------
test("Cursor-Race: Gerät A lädt eigenes Event hoch während fremdes Event ansteht", async () => {
	const { room } = createSimulatedServer();
	const syncKey = generateSyncKey();
	const clientA = new SimulatedClient("A", syncKey, room);
	const clientB = new SimulatedClient("B", syncKey, room);
	await clientA.init();
	await clientB.init();

	// Server auf Stand 10 bringen
	for (let i = 1; i <= 10; i++) {
		await clientA.addLocalEvent("pageCreate", { id: `p-init-${i}`, title: `Init ${i}` }, `2026-08-20T01:00:${String(i).padStart(2, "0")}Z`);
	}
	await clientA.push({ maxEvents: 1 });
	await clientA.pull();
	await clientB.pull();
	assert.equal(clientA.lastSyncedSeq, 10);
	assert.equal(clientB.lastSyncedSeq, 10);

	// Gerät B schreibt seq 11 auf den Server
	await clientB.addLocalEvent("pageCreate", { id: "p-from-B-11", title: "Note from B" }, "2026-08-20T02:00:00Z");
	await clientB.push({ maxEvents: 1 }); // Server hat nun seq 11

	// Bevor Gerät A seq 11 pulled, erstellt A ein eigenes lokales Event und lädt es hoch (POST)
	await clientA.addLocalEvent("pageCreate", { id: "p-from-A-12", title: "Note from A" }, "2026-08-20T02:01:00Z");
	await clientA.push({ maxEvents: 1 }); // Erhält seq 12 auf dem Server

	// WICHTIG: Nach dem POST darf clientA NICHT lastSyncedSeq = 12 setzen!
	assert.equal(clientA.lastSyncedSeq, 10, "lastSyncedSeq darf nach eigenem POST noch NICHT 12 sein");

	// Jetzt führt A den normalen Pull aus
	await clientA.pull();

	// Erst nachdem 11 und 12 tatsächlich verarbeitet wurden, ist lastSyncedSeq === 12
	assert.equal(clientA.lastSyncedSeq, 12);
	assert.ok(clientA.events.some((e) => e.payload?.id === "p-from-B-11"));
	assert.ok(clientA.events.some((e) => e.payload?.id === "p-from-A-12"));
});

// -----------------------------------------------------------------------------
// 6. SEQUENZLÜCKE
// -----------------------------------------------------------------------------
test("Sequenzlücke: Client springt bei Lücken nicht vor, sondern verlangt fehlende Sequenzen", async () => {
	const { room, DB } = createSimulatedServer();
	const syncKey = generateSyncKey();
	const client = new SimulatedClient("A", syncKey, room);
	await client.init();

	// Events 1 bis 10 erstellen
	for (let i = 1; i <= 10; i++) {
		await client.addLocalEvent("pageCreate", { id: `p-${i}`, title: `Note ${i}` });
	}
	await client.push({ maxEvents: 1 });
	await client.pull();
	assert.equal(client.lastSyncedSeq, 10);

	// Simuliere: Server erhält seq 12, aber 11 fehlt (Lücke 10 -> 12)
	const creds = client.credentials;
	const p12 = { id: "p-12-only", iv: "00112233445566778899aabb", data: "AAAA" };
	const r2Key = `users/${creds.userId}/events/${p12.id}.bin`;
	await room.env.BUCKET.put(r2Key, new TextEncoder().encode("AAAA"));
	DB.events.push({ user_id: creds.userId, seq: 12, event_id: p12.id, iv: p12.iv, r2_key: r2Key, size: 10, created_at: new Date().toISOString() });

	// Pull muss die Lücke bemerken und ablehnen
	await assert.rejects(async () => {
		await client.pull();
	}, /Server-Sequenzlücke|Lücke/);

	// Cursor bleibt bei 10!
	assert.equal(client.lastSyncedSeq, 10);
});

// -----------------------------------------------------------------------------
// 7. DOPPELTE / WIEDERHOLTE REQUESTS
// -----------------------------------------------------------------------------
test("Doppelte / Wiederholte Requests: 2x, 10x und parallele POSTs verändern den Server nur einmal", async () => {
	const { room } = createSimulatedServer();
	const creds = await deriveSyncCredentials(generateSyncKey());
	await room.init(creds.userId);
	await room.authorize(creds.authToken);

	const event = { id: "dup-test-1", t: "2026-08-20T12:00:00Z", type: "pageCreate", payload: { id: "p1", title: "Unique" } };
	const enc = await encryptPayload(creds.cryptoKey, cloudEventsEnvelope([event]));
	const packet = { id: "dup-packet-1", iv: enc.iv, data: enc.data };

	// 2x hintereinander
	const r1 = await room.savePackets([packet]);
	const r2 = await room.savePackets([packet]);
	assert.equal(r1.ok, true);
	assert.equal(r1.saved.length, 1);
	assert.equal(r2.ok, true);
	assert.equal(r2.saved.length, 0); // Idempotent ignoriert

	// 10x parallel
	const parallelTasks = Array.from({ length: 10 }, () => room.savePackets([packet]));
	const results = await Promise.all(parallelTasks);
	for (const res of results) assert.equal(res.ok, true);
	assert.equal(room.maxSeq, 1, "Sequenznummer darf sich bei Duplikaten nicht erhöhen");
});

// -----------------------------------------------------------------------------
// 8. REQUEST-REORDERING
// -----------------------------------------------------------------------------
test("Request-Reordering: Umgekehrte Ankunftsreihenfolge führt zu deterministischem Zustand", async () => {
	// Fall 1: pageCreate vs direkt folgendes pageUpdate
	const evCreate = { id: "p1-create", seq: 1, t: "2026-08-20T10:00:00.000Z", type: "pageCreate", payload: { id: "p1", title: "Initialer Titel", content: "V1" } };
	const evUpdate = { id: "p1-update", seq: 2, t: "2026-08-20T10:01:00.000Z", type: "pageUpdate", payload: { id: "p1", patch: { title: "Neuer Titel", content: "V2" } } };

	// Replay in umgekehrter Ankunftsreihenfolge: [evUpdate, evCreate]
	const pageNormal = DB.reconstructPageFromEvents([evCreate, evUpdate], "p1");
	const pageReordered = DB.reconstructPageFromEvents([evUpdate, evCreate], "p1");
	assert.deepEqual(pageNormal, pageReordered);
	assert.equal(pageReordered.title, "Neuer Titel");
	assert.equal(pageReordered.content, "V2");

	// Fall 2: cardCreate vs cardUpdate
	const cardCreate = { id: "c1-create", seq: 1, t: "2026-08-20T10:00:00.000Z", type: "cardCreate", payload: { id: "c1", front: "Frage 1", back: "Antwort 1" } };
	const cardUpdate = { id: "c1-update", seq: 2, t: "2026-08-20T10:02:00.000Z", type: "cardUpdate", payload: { id: "c1", patch: { back: "Korrigierte Antwort" } } };

	const compactNormal = DB.compactEvents([cardCreate, cardUpdate]);
	const compactReordered = DB.compactEvents([cardUpdate, cardCreate]);
	assert.equal(compactNormal.length, compactReordered.length);
});

// -----------------------------------------------------------------------------
// 9. OFFLINE NOTE CONFLICT (3-WEGE-MERGE)
// -----------------------------------------------------------------------------
test("Offline Note Conflict: 3-Wege-Merge bei getrennten Zeilen und deterministische Konfliktkopie bei Kollision", () => {
	const base = "Zeile 1\nZeile 2\nZeile 3";

	// A ändert Zeile 1
	const mine = "Zeile 1 modifiziert von A\nZeile 2\nZeile 3";
	// B ändert Zeile 3
	const theirs = "Zeile 1\nZeile 2\nZeile 3 modifiziert von B";

	const mergeRes = DB.merge3(base, mine, theirs);
	assert.equal(mergeRes.ok, true);
	assert.equal(mergeRes.text, "Zeile 1 modifiziert von A\nZeile 2\nZeile 3 modifiziert von B");

	// Echter Konflikt: A und B ändern dieselbe Zeile 2 unterschiedlich
	const mineConflict = "Zeile 1\nZeile 2 Konflikt A\nZeile 3";
	const theirsConflict = "Zeile 1\nZeile 2 Konflikt B\nZeile 3";

	const collisionRes = DB.merge3(base, mineConflict, theirsConflict);
	assert.equal(collisionRes.ok, false, "Kollision muss als Konflikt erkannt werden");
});

// -----------------------------------------------------------------------------
// 10 & 11. HEFT / HANDSCHRIFT & RESTORE / UNDO
// -----------------------------------------------------------------------------
test("Heft-Sync: Parallele Striche beider Geräte bleiben erhalten und Restore löscht keine fremden Offline-Striche", () => {
	// A und B haben gleiches Heft docBase
	const docBase = { pages: [{ id: "pg-1", paper: "lined", strokes: [{ id: "s-base", pts: [[10, 10]] }] }] };

	// A zeichnet Stroke A
	const strokeA = { id: "s-A", pts: [[20, 20]], color: "#ff0000", size: 3 };
	const opsA = [{ t: "s+", p: "pg-1", o: strokeA }];

	// B zeichnet Stroke B offline
	const strokeB = { id: "s-B", pts: [[30, 30]], color: "#00ff00", size: 3 };
	const opsB = [{ t: "s+", p: "pg-1", o: strokeB }];

	// Wenn beide ops im Log aufeinandertreffen:
	const allOps = [...opsA, ...opsB];
	const strokes = [];
	for (const op of allOps) {
		if (op.t === "s+") strokes.push(op.o);
	}
	assert.equal(strokes.length, 2);
	assert.ok(strokes.some((s) => s.id === "s-A"));
	assert.ok(strokes.some((s) => s.id === "s-B"));

	// Restore / Undo Test: Restore erzeugt diffDoc -> heftOps
	const restoredTarget = { pages: [{ id: "pg-1", paper: "lined", strokes: [{ id: "s-base", pts: [[10, 10]] }] }] };
	const currentDoc = { pages: [{ id: "pg-1", paper: "lined", strokes: [{ id: "s-base", pts: [[10, 10]] }, strokeA] }] };

	const restoreOps = heftDiffOps(currentDoc, restoredTarget);
	// Restore entfernt gezielt nur strokeA (s- mit id s-A)
	assert.deepEqual(restoreOps, [{ t: "s-", p: "pg-1", ids: ["s-A"] }]);

	// Wenn danach der verspätete Offline-Stroke B (s-B) eintrifft, wird er NICHT gelöscht!
	const combined = [...restoreOps, ...opsB];
	const finalStrokes = [{ id: "s-base" }, strokeA];
	for (const op of combined) {
		if (op.t === "s-") {
			for (const id of op.ids) {
				const idx = finalStrokes.findIndex((s) => s.id === id);
				if (idx >= 0) finalStrokes.splice(idx, 1);
			}
		} else if (op.t === "s+") {
			finalStrokes.push(op.o);
		}
	}
	assert.ok(finalStrokes.some((s) => s.id === "s-B"), "Stroke B muss erhalten bleiben");
	assert.equal(finalStrokes.some((s) => s.id === "s-A"), false, "Stroke A wurde wie gewünscht restored");
});

// -----------------------------------------------------------------------------
// 12 & 13. BLOB-SYNC & GROSSE BLOBS (1 KB bis 5 MB)
// -----------------------------------------------------------------------------
test("Blob-Sync: E2EE Roundtrip byte-genau für 1 KB, 100 KB, 1 MB und 5 MB", async () => {
	const credentials = await deriveSyncCredentials(generateSyncKey());
	const sizes = [1024, 100 * 1024, 1024 * 1024, 5 * 1024 * 1024];

	for (const size of sizes) {
		const rawBytes = new Uint8Array(size);
		for (let i = 0; i < size; i += 1024) rawBytes[i] = (i / 1024) % 256;

		const id = `file:test-${size}`;
		const meta = { type: "application/pdf", name: `test-${size}.pdf` };

		const encrypted = await encryptBlobRecord(credentials.cryptoKey, id, { buf: rawBytes.buffer, meta });
		const decrypted = await decryptBlobRecord(credentials.cryptoKey, encrypted.iv, encrypted.bytes);

		assert.equal(decrypted.id, id);
		assert.equal(decrypted.meta.type, meta.type);
		assert.equal(decrypted.meta.name, meta.name);
		assert.equal(decrypted.buf.byteLength, size);

		const decView = new Uint8Array(decrypted.buf);
		assert.deepEqual(decView.subarray(0, 100), rawBytes.subarray(0, 100));
		assert.deepEqual(decView.subarray(size - 100), rawBytes.subarray(size - 100));
	}
});

// -----------------------------------------------------------------------------
// 14. BLOB-DEDUPE / ORPHANS & FAIL-SAFE FÜR BGIMAGE
// -----------------------------------------------------------------------------
test("Blob-Dedupe & Orphans: bgImage und interne Schlüssel bleiben unberührt vom Blob-GC", () => {
	const pages = {
		p1: { id: "p1", title: "Page 1", content: "Hier ist ein Bild: ![bild](img:i1) und Datei :::file file:f1" },
	};

	assert.equal(isBlobAlive("img:i1", pages), true);
	assert.equal(isBlobAlive("file:f1", pages), true);
	assert.equal(isBlobAlive("img:orphan", pages), false);
	assert.equal(isBlobAlive("file:orphan", pages), false);

	// FAIL-SAFE: Lokale Nicht-Sync-Schlüssel wie bgImage und heftver:* MÜSSEN true liefern
	assert.equal(isBlobAlive("bgImage", pages), true, "bgImage darf vom lokalen GC niemals gelöscht werden");
	assert.equal(isBlobAlive("heftver:p1:12345:1", pages), true, "heftver darf nicht gelöscht werden");

	// isSyncBlobId trennt sauber zwischen Cloud-Kandidaten und lokalen Blobs
	assert.equal(isSyncBlobId("img:i1"), true);
	assert.equal(isSyncBlobId("file:f1"), true);
	assert.equal(isSyncBlobId("pdftext:11111111-2222-3333-4444-555555555555"), true);
	assert.equal(isSyncBlobId("bgImage"), false);
	assert.equal(isSyncBlobId("heftver:p1:123:1"), false);
});

// -----------------------------------------------------------------------------
// 15. CLOUD RESET & FULL RESEED
// -----------------------------------------------------------------------------
test("Cloud Reset & Reseed: Lokale Events aus fremder Quelle können nach Reset neu hochgeladen werden", async () => {
	const { room } = createSimulatedServer();
	const syncKey = generateSyncKey();
	const clientA = new SimulatedClient("A", syncKey, room);
	const clientB = new SimulatedClient("B", syncKey, room);
	await clientA.init();
	await clientB.init();

	// A und B erstellen Daten
	await clientA.addLocalEvent("pageCreate", { id: "pA", title: "Note from A" });
	await clientB.addLocalEvent("pageCreate", { id: "pB", title: "Note from B" });
	await clientA.sync();
	await clientB.sync();
	await clientA.sync();

	assert.equal(room.maxSeq, 2);

	// A führt Cloud-Reset aus
	await room.reset();
	assert.equal(room.maxSeq, 0);
	assert.equal(room.generation, 2);

	// A hat noch alle lokalen Events (einschl. des ehemals von B stammenden Events)
	const localEventsOnA = clientA.events;
	assert.equal(localEventsOnA.length, 2);

	// A lädt alle Events neu hoch (includeRemote: true)
	const reseedWire = prepareCloudEvents(localEventsOnA, { includeRemote: true });
	assert.equal(reseedWire.length, 2);

	const packet = {
		id: "reseed-packet",
		...(await encryptPayload(clientA.credentials.cryptoKey, cloudEventsEnvelope(reseedWire))),
	};
	const res = await room.savePackets([packet]);
	assert.equal(res.ok, true);
	assert.equal(room.maxSeq, 1);

	// B synchronisiert und konvergiert wieder mit A
	clientB.lastSyncedSeq = 0; // reset detected
	await clientB.sync();
	assert.deepEqual(clientA.logicalState(), clientB.logicalState());
});

// -----------------------------------------------------------------------------
// 16. FALSCHER E2EE-SCHLÜSSEL
// -----------------------------------------------------------------------------
test("Falscher E2EE-Schlüssel: Entschlüsselung schlägt fehl und Cursor bleibt unverändert", async () => {
	const credsA = await deriveSyncCredentials(generateSyncKey());
	const credsB = await deriveSyncCredentials(generateSyncKey());

	const packet = await encryptPayload(credsA.cryptoKey, { id: "sec-1", t: "2026-08-20T10:00:00Z", type: "pageCreate" });

	// Versuche mit Schlüssel B zu entschlüsseln
	await assert.rejects(async () => {
		await decryptPayload(credsB.cryptoKey, packet);
	});
});

// -----------------------------------------------------------------------------
// 17 & 18. ABBRUCH WÄHREND PULL & PUSH
// -----------------------------------------------------------------------------
test("Abbruch während Pull: Cursor bleibt auf letztem intakten Paket stehen", async () => {
	const creds = await deriveSyncCredentials(generateSyncKey());
	const packets = [];
	for (let i = 101; i <= 104; i++) {
		const enc = await encryptPayload(creds.cryptoKey, cloudEventsEnvelope([{ id: `ev-${i}`, type: "pageCreate" }]));
		packets.push({ seq: i, id: `p-${i}`, iv: enc.iv, data: enc.data });
	}

	// Simuliere Pull-Verarbeitung mit Fehler bei seq 103
	let lastSyncedSeq = 100;
	try {
		for (const p of packets) {
			if (p.seq === 103) throw new Error("Netzwerkabbruch bei 103");
			const decrypted = await decryptPayload(creds.cryptoKey, p);
			prepareIncomingCloudEvents([decrypted]);
			lastSyncedSeq = p.seq;
		}
	} catch (e) {
		// Fehler abgefangen
	}

	assert.equal(lastSyncedSeq, 102, "Cursor darf nur bis zum letzten erfolgreichen Paket (102) fortgeschritten sein");
});

// -----------------------------------------------------------------------------
// 21. KOMPAKTIERUNG: ATOMAR & DROP-ONLY
// -----------------------------------------------------------------------------
test("Kompaktierung: Drop-only behält Sequenznummern und verwirft keine neuen parallelen Events", () => {
	const events = [
		{ seq: 1, id: "p1-create", t: "2026-08-20T01:00:00Z", type: "pageCreate", payload: { id: "p1", title: "V1" } },
		{ seq: 2, id: "p1-update-1", t: "2026-08-20T01:01:00Z", type: "pageUpdate", payload: { id: "p1", patch: { title: "V2" } } },
		{ seq: 3, id: "p1-update-2", t: "2026-08-20T01:02:00Z", type: "pageUpdate", payload: { id: "p1", patch: { title: "V3" } } },
		{ seq: 4, id: "p2-create", t: "2026-08-20T01:03:00Z", type: "pageCreate", payload: { id: "p2", title: "P2" } },
	];

	const compacted = DB.compactEvents(events);
	const keepSeqs = new Set(compacted.map((e) => e.seq));

	// seq 2 wurde gedroppt, seq 1, 3, 4 bleiben mit ORIGINAL-Sequenzen
	assert.equal(keepSeqs.has(2), false);
	assert.equal(keepSeqs.has(1), true);
	assert.equal(keepSeqs.has(3), true);
	assert.equal(keepSeqs.has(4), true);

	// Sequenznummern bleiben unverändert
	for (const e of compacted) {
		const orig = events.find((x) => x.id === e.id);
		assert.equal(e.seq, orig.seq);
	}
});

test("Kompaktierung: echtes DB.compactLocal bewahrt parallelen neuen Event und dessen Sequenznummer", async () => {
	globalThis.indexedDB = createMemoryIndexedDB();
	await DB.open();

	await DB.addEvent({ id: "p1-c", t: "2026-08-20T01:00:00Z", type: "pageCreate", payload: { id: "p1", title: "Note 1" } }); // seq 1
	await DB.addEvent({ id: "p1-u1", t: "2026-08-20T01:01:00Z", type: "pageUpdate", payload: { id: "p1", patch: { title: "Note 1 - Rev 2" } } }); // seq 2
	await DB.addEvent({ id: "p1-u2", t: "2026-08-20T01:02:00Z", type: "pageUpdate", payload: { id: "p1", patch: { title: "Note 1 - Rev 3" } } }); // seq 3
	await DB.addEvent({ id: "p2-c", t: "2026-08-20T01:03:00Z", type: "pageCreate", payload: { id: "p2", title: "Note 2" } }); // seq 4

	// Wirklich gleichzeitig gestartet: Kompaktierung und paralleler Schreibvorgang
	const compactPromise = DB.compactLocal(1);
	const writePromise = DB.addEvent({ id: "p3-c", t: "2026-08-20T01:04:00Z", type: "pageCreate", payload: { id: "p3", title: "Note 3" } });

	const [dropped] = await Promise.all([compactPromise, writePromise]);
	assert.equal(dropped, 1, "Genau das redundante Update muss verworfen werden");

	const evs = await DB.allEvents();
	assert.equal(evs.length, 4);

	// Sequenznummern bleiben unverändert
	assert.equal(evs.find((e) => e.id === "p1-c").seq, 1);
	assert.equal(evs.find((e) => e.id === "p1-u1"), undefined);
	assert.equal(evs.find((e) => e.id === "p1-u2").seq, 3);
	assert.equal(evs.find((e) => e.id === "p2-c").seq, 4);
	assert.equal(evs.find((e) => e.id === "p3-c").seq, 5, "Der neue Event muss mit seiner ursprünglichen Sequenz erhalten bleiben");
});

// -----------------------------------------------------------------------------
// 22. LANGZEIT- & STRESSTEST (10.000 Events & 1.000 Wechsel)
// -----------------------------------------------------------------------------
test("Langzeit- und Stresstest: 10.000 Events über 3 Geräte konvergieren ohne Datenverlust", async () => {
	const { room } = createSimulatedServer();
	const syncKey = generateSyncKey();
	const clients = [
		new SimulatedClient("A", syncKey, room),
		new SimulatedClient("B", syncKey, room),
		new SimulatedClient("C", syncKey, room),
	];
	for (const c of clients) await c.init();

	const TOTAL_EVENTS = 10000;
	const types = ["pageCreate", "pageUpdate", "settingsSet", "cardCreate", "heftOps"];

	// 10.000 kleine Events auf die 3 Clients verteilen
	for (let i = 0; i < TOTAL_EVENTS; i++) {
		const client = clients[i % 3];
		const type = types[i % types.length];
		let payload = {};
		if (type === "pageCreate") payload = { id: `stress-p-${i}`, title: `Page ${i}` };
		else if (type === "pageUpdate") payload = { id: `stress-p-${i % 100}`, patch: { title: `Updated ${i}` } };
		else if (type === "settingsSet") payload = { theme: i % 2 === 0 ? "dark" : "light" };
		else if (type === "cardCreate") payload = { id: `stress-c-${i}`, front: `Q ${i}`, back: `A ${i}` };
		else if (type === "heftOps") payload = { pageId: `stress-h-${i % 50}`, ops: [{ t: "s+", p: `stress-h-${i % 50}`, o: { id: `s-${i}`, pts: [[i % 100, i % 100]] } }] };

		await client.addLocalEvent(type, payload, new Date(Date.now() + i * 100).toISOString());

		// Regelmäßige Sync-Pässe in zufälliger Reihenfolge
		if (i % 250 === 0) {
			const order = [...clients].sort(() => Math.random() - 0.5);
			for (const c of order) await c.sync();
		}
	}

	// Abschließender Sync-Rundlauf über alle Clients
	for (let pass = 0; pass < 3; pass++) {
		for (const c of clients) await c.sync();
	}

	// Alle Clients müssen exakt dieselbe Anzahl eindeutiger Event-IDs besitzen
	const setA = new Set(clients[0].events.map((e) => e.id));
	const setB = new Set(clients[1].events.map((e) => e.id));
	const setC = new Set(clients[2].events.map((e) => e.id));

	assert.equal(setA.size, TOTAL_EVENTS);
	assert.equal(setB.size, TOTAL_EVENTS);
	assert.equal(setC.size, TOTAL_EVENTS);

	// Logical state konvergiert
	assert.deepEqual(clients[0].logicalState(), clients[1].logicalState());
	assert.deepEqual(clients[1].logicalState(), clients[2].logicalState());
});

// -----------------------------------------------------------------------------
// 23. NOTEBOOK V4 MIGRATION RACE & REAL INDEXEDDB TEST
// -----------------------------------------------------------------------------
test("Notebook v4 Migration: Race-Bedingung mit neuem heftOps-Write während replaceHeftHistory bewahrt neuen Event", async () => {
	globalThis.indexedDB = createMemoryIndexedDB();
	await DB.open();

	// 1. Initialer Zustand: altes Snapshot-Event und alte heftOps
	await DB.addEvent({ seq: 1, id: "h1-snap", t: "2026-08-20T01:00:00Z", type: "heftSnap", payload: { pageId: "h1", doc: { pages: [{ id: "p1" }] } } });
	await DB.addEvent({ seq: 2, id: "h1-op1", t: "2026-08-20T01:01:00Z", type: "heftOps", payload: { pageId: "h1", ops: [{ t: "s+", p: "p1", o: { id: "s1" } }] } });

	// 2. Migration ermittelt den aktuellen Sequenzstand (upToSeq = 2) und berechnet Baseline
	const upToSeq = await DB.maxSeq();
	assert.equal(upToSeq, 2);

	const baselines = [
		{ id: "v4-heft-h1-baseline", t: "2026-08-20T01:01:30Z", type: "heftOps", payload: { pageId: "h1", ops: [{ t: "s+", p: "p1", o: { id: "s1" } }] } },
	];

	// 3. Race: Während/nach der Baseline-Berechnung, bevor replaceHeftHistory fertig ist, wird ein NEUER heftOps-Event geschrieben
	await DB.addEvent({ id: "h1-new-stroke-3", t: "2026-08-20T01:02:00Z", type: "heftOps", payload: { pageId: "h1", ops: [{ t: "s+", p: "p1", o: { id: "s-new-3" } }] } });

	// 4. replaceHeftHistory läuft mit upToSeq
	await DB.replaceHeftHistory(baselines, upToSeq);

	// 5. Prüfe: Der neue Event seq 3 darf NICHT gelöscht worden sein!
	const eventsAfter = await DB.allEvents();
	assert.ok(eventsAfter.some((e) => e.id === "h1-new-stroke-3"), "Der während der Migration neu geschriebene Event muss erhalten bleiben");
	assert.ok(eventsAfter.some((e) => e.id === "v4-heft-h1-baseline"), "Baseline-Event muss eingefügt worden sein");
	assert.equal(eventsAfter.some((e) => e.id === "h1-snap"), false, "Altes heftSnap muss gelöscht sein");
	assert.equal(eventsAfter.some((e) => e.id === "h1-op1"), false, "Altes heftOps vor upToSeq muss gelöscht sein");
});

// -----------------------------------------------------------------------------
// 24. APP-NEUSTART & VOLLE REKONSTRUKTION
// -----------------------------------------------------------------------------
test("App-Neustart: Vollständige Rekonstruktion aus serialisierter Ablage", async () => {
	const { room } = createSimulatedServer();
	const syncKey = generateSyncKey();
	const client = new SimulatedClient("Device-1", syncKey, room);
	await client.init();

	await client.addLocalEvent("pageCreate", { id: "p-persist", title: "Persisted Note", content: "Original" });
	await client.addLocalEvent("pageUpdate", { id: "p-persist", patch: { content: "Updated content" } });
	await client.sync();

	const stateBefore = client.logicalState();

	// Simuliere Neustart: RAM verwerfen, aus "Ablage" laden
	const persistedEventsJson = JSON.stringify(client.events);
	const persistedCursor = client.lastSyncedSeq;

	const reloadedClient = new SimulatedClient("Device-1", syncKey, room);
	await reloadedClient.init();
	reloadedClient.events = JSON.parse(persistedEventsJson);
	reloadedClient.lastSyncedSeq = persistedCursor;

	const stateAfter = reloadedClient.logicalState();
	assert.deepEqual(stateBefore, stateAfter);

	// Weiterer Sync nach Neustart läuft sauber ohne neue Duplikate
	await reloadedClient.sync();
	assert.equal(reloadedClient.events.length, 2);
	assert.equal(reloadedClient.lastSyncedSeq, persistedCursor);
});

// -----------------------------------------------------------------------------
// 25. CROSS-TAB-MIGRATION REGRESSIONSTESTS (A, B, C)
// -----------------------------------------------------------------------------
test("Cross-Tab-Race A: Tab A lädt Snapshot, Tab B schreibt danach s+, Migration A -> s+ muss erhalten bleiben", async () => {
	globalThis.indexedDB = createMemoryIndexedDB();
	globalThis.localStorage.clear();
	await DB.resetDatabase();
	await DB.open();
	S.pages = {}; S.heftDocs = {}; S.heftMeta = {};

	// 1. Initialer DB-Zustand: Heft h1 mit Strich s1
	await DB.addEvent({ seq: 1, id: "h1-create", t: "2026-08-20T01:00:00.000Z", type: "pageCreate", payload: { id: "h1", kind: "heft", title: "Heft A" } });
	await DB.addEvent({ seq: 2, id: "h1-s1", t: "2026-08-20T01:01:00.000Z", type: "heftOps", payload: { pageId: "h1", ops: [{ t: "pg+", page: { id: "p1", paper: "lined" } }, { t: "s+", p: "p1", o: { id: "s1", color: "#000", pts: [10, 10] } }] } });

	// 2. Tab A lädt Snapshot
	const snapshotA = await STATE.load();
	assert.equal(snapshotA.maxSeq, 2);
	assert.ok(S.heftDocs.h1?.pages?.[0]?.strokes?.some((s) => s.id === "s1"));

	// 3. Tab B schreibt danach s+ (seq 3, neuer Zeitstempel)
	await DB.addEvent({ seq: 3, id: "h1-s2", t: "2026-08-20T01:02:00.000Z", type: "heftOps", payload: { pageId: "h1", ops: [{ t: "s+", p: "p1", o: { id: "s2", color: "#f00", pts: [20, 20] } }] } });

	// 4. Tab A führt Migration mit seinem Snapshot aus
	await CLOUDFLARE_SYNC.migrateLocalV4(snapshotA);

	// 5. Reload der App: Zustand aus DB neu aufbauen
	S.pages = {}; S.heftDocs = {}; S.heftMeta = {};
	await STATE.load();

	const strokes = S.heftDocs.h1?.pages?.[0]?.strokes || [];
	assert.equal(strokes.length, 2, "Beide Striche s1 und s2 müssen nach Reload vorhanden sein");
	assert.ok(strokes.some((s) => s.id === "s1"), "Strich s1 aus Baseline muss erhalten bleiben");
	assert.ok(strokes.some((s) => s.id === "s2"), "Strich s2 aus Tab B muss erhalten bleiben");
});

test("Cross-Tab-Race B: Tab A lädt Snapshot, Tab B schreibt danach s-, Migration A -> Gelöschter Strich darf nach Reload NICHT wieder auferstehen", async () => {
	globalThis.indexedDB = createMemoryIndexedDB();
	globalThis.localStorage.clear();
	await DB.resetDatabase();
	await DB.open();
	S.pages = {}; S.heftDocs = {}; S.heftMeta = {};

	// 1. Initialer DB-Zustand: Heft h1 mit Strich s1
	await DB.addEvent({ seq: 1, id: "h1-create", t: "2026-08-20T01:00:00.000Z", type: "pageCreate", payload: { id: "h1", kind: "heft", title: "Heft B" } });
	await DB.addEvent({ seq: 2, id: "h1-s1", t: "2026-08-20T01:01:00.000Z", type: "heftOps", payload: { pageId: "h1", ops: [{ t: "pg+", page: { id: "p1", paper: "lined" } }, { t: "s+", p: "p1", o: { id: "s1", color: "#000", pts: [10, 10] } }] } });

	// 2. Tab A lädt Snapshot (enthält s1)
	const snapshotA = await STATE.load();
	assert.equal(snapshotA.maxSeq, 2);
	assert.ok(S.heftDocs.h1?.pages?.[0]?.strokes?.some((s) => s.id === "s1"));

	// 3. Tab B schreibt danach s- (Löschung von s1 bei seq 3)
	await DB.addEvent({ seq: 3, id: "h1-del-s1", t: "2026-08-20T01:02:00.000Z", type: "heftOps", payload: { pageId: "h1", ops: [{ t: "s-", p: "p1", ids: ["s1"] }] } });

	// 4. Tab A führt Migration mit seinem Snapshot aus
	await CLOUDFLARE_SYNC.migrateLocalV4(snapshotA);

	// 5. Reload der App: Replay aus DB
	S.pages = {}; S.heftDocs = {}; S.heftMeta = {};
	await STATE.load();

	const strokes = S.heftDocs.h1?.pages?.[0]?.strokes || [];
	assert.equal(strokes.length, 0, "Strich s1 darf nach Reload NICHT durch die Baseline wieder auferstehen");
	assert.equal(strokes.some((s) => s.id === "s1"), false, "Gelöschter Strich muss gelöscht bleiben");
});

test("Cross-Tab-Race C: Tab A lädt Snapshot, Tab B schreibt zwischen STATE.load und Cutoff-Ermittlung -> Kein Event darf gelöscht werden", async () => {
	globalThis.indexedDB = createMemoryIndexedDB();
	globalThis.localStorage.clear();
	await DB.resetDatabase();
	await DB.open();
	S.pages = {}; S.heftDocs = {}; S.heftMeta = {};

	// 1. Initialer DB-Zustand: 10 Events
	for (let i = 1; i <= 10; i++) {
		await DB.addEvent({ seq: i, id: `init-ev-${i}`, t: `2026-08-20T01:0${i % 10}:00.000Z`, type: "pageCreate", payload: { id: `p-${i}`, title: `Note ${i}` } });
	}

	// 2. Tab A lädt Snapshot bei seq 10
	const snapshotA = await STATE.load();
	assert.equal(snapshotA.maxSeq, 10);

	// 3. Tab B schreibt neue Events (seq 11, 12, 13)
	await DB.addEvent({ seq: 11, id: "tab-b-ev-11", t: "2026-08-20T01:11:00.000Z", type: "pageCreate", payload: { id: "p-11", title: "Note 11" } });
	await DB.addEvent({ seq: 12, id: "tab-b-heft-12", t: "2026-08-20T01:12:00.000Z", type: "heftOps", payload: { pageId: "p-11", ops: [{ t: "s+", p: "p1", o: { id: "s-tab-b-12" } }] } });
	await DB.addEvent({ seq: 13, id: "tab-b-ev-13", t: "2026-08-20T01:13:00.000Z", type: "pageUpdate", payload: { id: "p-11", patch: { title: "Note 11 patch" } } });

	// 4. Tab A führt Migration aus (Cutoff = snapshotA.maxSeq = 10)
	await CLOUDFLARE_SYNC.migrateLocalV4(snapshotA);

	// 5. Prüfe: Keines der neuen Events von Tab B darf gelöscht worden sein!
	const all = await DB.allEvents();
	assert.ok(all.some((e) => e.id === "tab-b-ev-11"), "Event 11 muss erhalten bleiben");
	assert.ok(all.some((e) => e.id === "tab-b-heft-12"), "Heft-Event 12 von Tab B darf nicht gelöscht werden");
	assert.ok(all.some((e) => e.id === "tab-b-ev-13"), "Event 13 muss erhalten bleiben");
});

test("Start-Checkpoint spielt nur den neuen Tail und fällt bei älterem Import auf Voll-Replay zurück", async () => {
	globalThis.indexedDB = createMemoryIndexedDB();
	globalThis.localStorage.clear();
	await DB.resetDatabase();
	await DB.open();

	await DB.addEvent({ seq: 1, id: "checkpoint-base", t: "2026-08-20T10:00:00.000Z", type: "pageCreate", payload: { id: "cp-base", title: "Basis" } });
	const first = await STATE.load();
	assert.equal(first.checkpointUsed, false);
	assert.equal(await STATE.persistCheckpoint(), true);

	await DB.addEvent({ seq: 2, id: "checkpoint-tail", t: "2026-08-20T10:01:00.000Z", type: "pageCreate", payload: { id: "cp-tail", title: "Tail" } });
	S.pages = {};
	const warm = await STATE.load();
	assert.equal(warm.checkpointUsed, true);
	assert.equal(warm.replayed, 1);
	assert.equal(S.pages["cp-base"].title, "Basis");
	assert.equal(S.pages["cp-tail"].title, "Tail");

	await DB.addEvent({ seq: 3, id: "checkpoint-older-import", t: "2026-08-19T09:00:00.000Z", type: "pageCreate", payload: { id: "cp-old", title: "Älterer Import" } });
	S.pages = {};
	const fallback = await STATE.load();
	assert.equal(fallback.checkpointUsed, false);
	assert.equal(fallback.replayed, 3);
	assert.equal(S.pages["cp-old"].title, "Älterer Import");
});

// -----------------------------------------------------------------------------
// 26. IGNOREDBLOBKEYS INVALIDIERUNG ENGER MACHEN
// -----------------------------------------------------------------------------
test("Blob-GC Regression: unreferenzierter Remote-Blob wird ignoriert und bei non-page Dispatch nicht erneut geladen, erst bei echter Page-Referenz", async () => {
	globalThis.indexedDB = createMemoryIndexedDB();
	globalThis.localStorage.clear();
	await DB.resetDatabase();
	await DB.open();
	S.pages = {}; S.heftDocs = {}; S.heftMeta = {}; S.settings = {};

	const originalFetch = globalThis.fetch;
	const originalWebSocket = globalThis.WebSocket;
	MockWebSocket.instances = [];
	globalThis.WebSocket = MockWebSocket;

	const key = generateSyncKey();
	const creds = await deriveSyncCredentials(key);

	// Server besitzt einen gültig verschlüsselten, aber lokal nicht referenzierten Blob
	const BLOB_ID = "img:unreferenced-blob-test-1";
	const BLOB_DATA = new Uint8Array([1, 2, 3, 4, 5]);
	const encBlob = await encryptBlobRecord(creds.cryptoKey, BLOB_ID, { buf: BLOB_DATA.buffer, meta: { mime: "image/png" } });
	const blobKey = await sha256Hex(`impala67_blob:${BLOB_ID}`);

	let blobGetCount = 0;
	let serverEvents = [];

	globalThis.fetch = async (url, init = {}) => {
		const urlStr = String(url);
		if (urlStr.includes("/api/sync")) {
			return new Response(JSON.stringify({ events: serverEvents, maxSeq: serverEvents.length, hasMore: false, generation: 1 }), {
				status: 200, headers: { "Content-Type": "application/json" },
			});
		}
		if (urlStr.includes("/api/blobs")) {
			return new Response(JSON.stringify({ keys: [blobKey], cursor: "" }), {
				status: 200, headers: { "Content-Type": "application/json" },
			});
		}
		if (urlStr.includes(`/api/blob/${blobKey}`) && (!init.method || init.method === "GET")) {
			blobGetCount++;
			return new Response(encBlob.bytes, {
				status: 200,
				headers: { "Content-Type": "application/octet-stream", "X-Impala-IV": encBlob.iv },
			});
		}
		if (urlStr.includes("/api/events") && init.method === "POST") {
			return new Response(JSON.stringify({ ok: true, savedCount: 0, maxSeq: serverEvents.length, usage: 100, generation: 1 }), {
				status: 200, headers: { "Content-Type": "application/json" },
			});
		}
		return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
	};

	try {
		const configured = await CLOUDFLARE_SYNC.configure("https://sync.example.com", key);
		assert.equal(configured, true);

		// 1. Erster Sync lädt und entschlüsselt den Blob, ignoriert ihn da nicht in S.pages referenziert
		await CLOUDFLARE_SYNC.syncNow();
		assert.equal(blobGetCount, 1, "Erster Sync muss den unreferenzierten Blob einmal anfragen");
		const localBlob1 = await DB.getBlob(BLOB_ID);
		assert.equal(localBlob1, undefined, "Unreferenzierter Blob darf nicht in DB gespeichert werden");

		// 2. Normale lokale Änderung OHNE neue Blob-Referenz (z. B. chatUpsert)
		await STATE.dispatch("chatUpsert", { id: "c1", messages: [{ role: "user", text: "Hallo" }] });

		// 3. Zweiter Sync darf denselben Blob NICHT erneut GETten
		await CLOUDFLARE_SYNC.syncNow();
		assert.equal(blobGetCount, 1, "Zweiter Sync nach chatUpsert darf den ignorierten Blob NICHT erneut GETten");

		// 4. Danach lokale Änderung, die genau diesen Blob referenziert (pageCreate mit ![img](...))
		await STATE.dispatch("pageCreate", { id: "note-ref-blob", title: "Note with Blob", content: `Hier ist das Bild: ![Bild](${BLOB_ID})` });

		// 5. Nächster Sync muss ihn herunterladen und speichern
		await CLOUDFLARE_SYNC.syncNow();
		assert.equal(blobGetCount, 2, "Dritter Sync nach pageCreate muss den Blob erneut abrufen");
		const localBlobFinal = await DB.getBlob(BLOB_ID);
		assert.ok(localBlobFinal, "Blob muss nach Referenzierung in DB gespeichert sein");
		assert.deepEqual(new Uint8Array(localBlobFinal.buf), BLOB_DATA);
	} finally {
		CLOUDFLARE_SYNC.disconnect();
		globalThis.fetch = originalFetch;
		globalThis.WebSocket = originalWebSocket;
	}
});
