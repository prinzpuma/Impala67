import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { SyncRoom } from "../server/worker.js";
import { cloudEventsEnvelope, prepareCloudEvents, prepareIncomingCloudEvents } from "../web/sync-core.js";
import { deriveSyncCredentials, encryptPayload, decryptPayload, generateSyncKey } from "../web/sync-crypto.js";

class R2 {
	constructor() { this.map = new Map(); }
	async put(key, bytes, opts = {}) { this.map.set(key, { bytes: new Uint8Array(bytes), customMetadata: opts.customMetadata || {} }); }
	async get(key) { const r = this.map.get(key); return r ? { customMetadata: r.customMetadata, arrayBuffer: async () => r.bytes.buffer.slice(r.bytes.byteOffset, r.bytes.byteOffset + r.bytes.byteLength) } : null; }
	async head(key) { return this.map.has(key) ? {} : null; }
	async delete(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) this.map.delete(k); }
	async list({ prefix = "" } = {}) { const keys = [...this.map.keys()].filter((k) => k.startsWith(prefix)); return { objects: keys.map((key) => ({ key })), truncated: false, cursor: "" }; }
}
class D1 {
	constructor() { this.events = []; this.accounts = new Map(); }
	prepare(sql) {
		const db = this, q = (args = []) => ({
			async first() {
				if (/MAX\(seq\)/i.test(sql)) return { max_seq: Math.max(0, ...db.events.filter((e) => e.user_id === args[0]).map((e) => e.seq)) };
				if (/SELECT auth_token_hash,total_bytes/i.test(sql)) return db.accounts.get(args[0]) || null;
				if (/COUNT\(\*\)/i.test(sql)) return { cnt: db.accounts.size };
				throw new Error("first: " + sql);
			},
			async all() {
				if (/SELECT event_id FROM sync_events/i.test(sql)) { const [u, ...ids] = args; return { results: db.events.filter((e) => e.user_id === u && ids.includes(e.event_id)).map((e) => ({ event_id: e.event_id })) }; }
				if (/SELECT seq,event_id id,iv,r2_key,size,created_at/i.test(sql)) { const [u, since, limit] = args; return { results: db.events.filter((e) => e.user_id === u && e.seq > since).sort((a,b) => a.seq-b.seq).slice(0,limit).map((e) => ({ seq:e.seq,id:e.event_id,iv:e.iv,r2_key:e.r2_key,size:e.size,created_at:e.created_at })) }; }
				throw new Error("all: " + sql);
			},
			async run() { return db.run(sql, args); },
		});
		return { bind: (...args) => q(args), first: () => q().first(), all: () => q().all(), run: () => q().run() };
	}
	async run(sql, a) {
		if (/INSERT INTO user_storage/i.test(sql)) { this.accounts.set(a[0], { auth_token_hash:a[1], total_bytes:a[2], updated_at:a[3] }); return { meta: { rows_written: 1, changes: 1 } }; }
		if (/UPDATE user_storage SET total_bytes=0/i.test(sql)) { const r=this.accounts.get(a[1]); if(r) r.total_bytes=0; return {}; }
		if (/UPDATE user_storage SET total_bytes/i.test(sql)) { const r=this.accounts.get(a[2]); if(r) r.total_bytes=a[0]; return {}; }
		if (/INSERT INTO sync_events/i.test(sql)) { this.events.push({ user_id:a[0],seq:a[1],event_id:a[2],iv:a[3],r2_key:a[4],size:a[5],created_at:a[6] }); return {}; }
		if (/DELETE FROM sync_events/i.test(sql)) { this.events=this.events.filter((e)=>e.user_id!==a[0]); return {}; }
		throw new Error("run: " + sql);
	}
	async batch(xs) { for (const x of xs) await x.run(); }
}
class Store { constructor(){this.map=new Map();} async get(k){return this.map.get(k);} async put(k,v){this.map.set(k,v);} }

async function packetFor(key, events) {
	const encrypted = await encryptPayload(key, cloudEventsEnvelope(events));
	return { id: "p-" + events.map((e) => e.id).join("-"), ...encrypted };
}
async function pulled(room, key) {
	const { events } = await room.readEvents(0, 100);
	const out = [];
	for (const packet of events) out.push(...prepareIncomingCloudEvents([await decryptPayload(key, packet)]));
	return out;
}

test("two offline devices converge and reset can reseed remote-origin events", async () => {
	const DB = new D1(), BUCKET = new R2(), storage = new Store();
	const room = new SyncRoom({ storage, getWebSockets: () => [] }, { DB, BUCKET });
	const credentials = await deriveSyncCredentials(generateSyncKey());
	await room.init(credentials.userId);
	assert.equal(await room.authorize(credentials.authToken), true);

	const a = { id:"a", t:"2026-08-20T20:00:00.000Z", type:"pageCreate", payload:{ id:"pa", title:"A" } };
	const b = { id:"b", t:"2026-08-20T20:00:01.000Z", type:"pageCreate", payload:{ id:"pb", title:"B" } };
	await Promise.all([
		room.savePackets([await packetFor(credentials.cryptoKey, [a])]),
		room.savePackets([await packetFor(credentials.cryptoKey, [b])]),
	]);
	const onA = await pulled(room, credentials.cryptoKey), onB = await pulled(room, credentials.cryptoKey);
	assert.deepEqual(new Set(onA.map((e) => e.id)), new Set(["a","b"]));
	assert.deepEqual(new Set(onB.map((e) => e.id)), new Set(["a","b"]));

	const localA = [a, { ...b, _remote:true, _remoteSource:"cloudflare" }];
	assert.deepEqual(prepareCloudEvents(localA).map((e) => e.id), ["a"]);
	assert.deepEqual(prepareCloudEvents(localA, { includeRemote:true }).map((e) => e.id), ["a","b"]);
	await room.reset();
	await room.savePackets([await packetFor(credentials.cryptoKey, prepareCloudEvents(localA, { includeRemote:true }))]);
	const reseeded = await pulled(room, credentials.cryptoKey);
	assert.deepEqual(new Set(reseeded.map((e) => e.id)), new Set(["a","b"]));
});
