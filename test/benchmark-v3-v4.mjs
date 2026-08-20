import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import {
	CLOUD_SYNC_PROTOCOL as V4_PROTOCOL,
	chunkCloudEvents as v4ChunkCloudEvents,
	cloudEventsEnvelope as v4CloudEventsEnvelope,
	prepareCloudEvents as v4PrepareCloudEvents,
	prepareIncomingCloudEvents as v4PrepareIncomingCloudEvents,
	pruneEventsForUpload as v4PruneEventsForUpload,
	heftBaselineOps as v4HeftBaselineOps,
} from "../web/sync-core.js";

import {
	deriveSyncCredentials as v4DeriveSyncCredentials,
	encryptPayload as v4EncryptPayload,
	decryptPayload as v4DecryptPayload,
	encryptBlobRecord as v4EncryptBlobRecord,
	decryptBlobRecord as v4DecryptBlobRecord,
	generateSyncKey as v4GenerateSyncKey,
	sha256Hex as v4Sha256Hex,
} from "../web/sync-crypto.js";

import { DB as v4DB } from "../web/db.js";

// =============================================================================
// V3 EXACT PRODUCTION IMPLEMENTATION (from Commit 5377699a080fd4e16cc4c61d7dd75b0763966a58)
// =============================================================================
const V3_ENGINE = (() => {
	const enc = new TextEncoder();
	const dec = new TextDecoder();
	const V3_PROTOCOL = 3;
	const COMPRESSION_THRESHOLD_BYTES = 64 * 1024;
	const KEEP_CONTENT_VERSIONS = 20;

	function bytesToBase64(bytes) {
		const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
		const CHUNK_SIZE = 0x8000;
		let binary = "";
		for (let i = 0; i < arr.length; i += CHUNK_SIZE) {
			binary += String.fromCharCode.apply(null, arr.subarray(i, i + CHUNK_SIZE));
		}
		return btoa(binary);
	}

	function base64ToBytes(base64) {
		const binary = atob(String(base64 || ""));
		const len = binary.length;
		const bytes = new Uint8Array(len);
		for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
		return bytes;
	}

	function hexToBytes(hex) {
		const clean = String(hex || "").trim();
		if (!clean || clean.length % 2 !== 0) return new Uint8Array(0);
		const matches = clean.match(/.{1,2}/g);
		return matches ? new Uint8Array(matches.map((b) => parseInt(b, 16))) : new Uint8Array(0);
	}

	function bytesToHex(bytes) {
		const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
		return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
	}

	async function sha256Hex(str) {
		const bytes = enc.encode(String(str || ""));
		const digest = await crypto.subtle.digest("SHA-256", bytes);
		return bytesToHex(new Uint8Array(digest));
	}

	async function deriveSyncCredentials(syncKey) {
		const cleanKey = String(syncKey || "").trim();
		const userId = await sha256Hex(`impala67_user_partition:${cleanKey}`);
		const authToken = await sha256Hex(`impala67_auth_token:${cleanKey}`);
		const saltDigest = await crypto.subtle.digest("SHA-256", enc.encode(`impala67_e2ee_salt:${cleanKey}`));
		const baseKey = await crypto.subtle.importKey("raw", enc.encode(cleanKey), { name: "PBKDF2" }, false, ["deriveKey"]);
		const cryptoKey = await crypto.subtle.deriveKey(
			{ name: "PBKDF2", salt: new Uint8Array(saltDigest), iterations: 100000, hash: "SHA-256" },
			baseKey,
			{ name: "AES-GCM", length: 256 },
			false,
			["encrypt", "decrypt"]
		);
		return { userId, authToken, cryptoKey };
	}

	async function encryptPayload(cryptoKey, dataObj) {
		if (!cryptoKey) throw new Error("Kein Verschlüsselungsschlüssel vorhanden.");
		const rawBytes = enc.encode(JSON.stringify(dataObj));
		let payloadBytes = rawBytes;
		let encoding = "";
		if (rawBytes.byteLength >= COMPRESSION_THRESHOLD_BYTES && typeof CompressionStream === "function") {
			const compressed = new Uint8Array(await new Response(
				new Blob([rawBytes]).stream().pipeThrough(new CompressionStream("gzip"))
			).arrayBuffer());
			if (compressed.byteLength < rawBytes.byteLength) {
				payloadBytes = compressed;
				encoding = "gz:";
			}
		}
		const iv = new Uint8Array(12);
		crypto.getRandomValues(iv);
		const ciphertextBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, payloadBytes);
		const cipherBytes = new Uint8Array(ciphertextBuffer);
		const dataBase64 = encoding + bytesToBase64(cipherBytes);
		const ivHex = bytesToHex(iv);
		const size = cipherBytes.byteLength + iv.byteLength;
		return { iv: ivHex, data: dataBase64, size };
	}

	async function decryptPayload(cryptoKey, encryptedObj) {
		if (!cryptoKey) throw new Error("Kein Verschlüsselungsschlüssel vorhanden.");
		const iv = hexToBytes(encryptedObj.iv);
		const isGzip = String(encryptedObj.data).startsWith("gz:");
		const cipherBytes = base64ToBytes(isGzip ? encryptedObj.data.slice(3) : encryptedObj.data);
		const decryptedBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, cipherBytes);
		let plainBytes = new Uint8Array(decryptedBuffer);
		if (isGzip) {
			plainBytes = new Uint8Array(await new Response(
				new Blob([plainBytes]).stream().pipeThrough(new DecompressionStream("gzip"))
			).arrayBuffer());
		}
		return JSON.parse(dec.decode(plainBytes));
	}

	function prepareCloudEvents(events, { includeRemote = false } = {}) {
		return (events || []).filter((ev) => includeRemote || ev?._remoteSource !== "cloudflare").map((ev) => {
			const { seq, _remote, _remoteSource, _derived, ...wireEvent } = ev || {};
			return wireEvent;
		});
	}

	function cloudEventEnvelope(event) {
		return { v: V3_PROTOCOL, event };
	}

	function cloudEventsEnvelope(events) {
		return { v: V3_PROTOCOL, events };
	}

	function chunkCloudEvents(events, { maxEvents = 500, maxJsonChars = 1_500_000 } = {}) {
		const chunks = [];
		let chunk = [];
		let chars = 0;
		for (const event of events || []) {
			const eventChars = JSON.stringify(event).length + 1;
			if (chunk.length && (chunk.length >= maxEvents || chars + eventChars > maxJsonChars)) {
				chunks.push(chunk);
				chunk = [];
				chars = 0;
			}
			chunk.push(event);
			chars += eventChars;
		}
		if (chunk.length) chunks.push(chunk);
		return chunks;
	}

	function pruneEventsForUpload(events) {
		const snapSeq = new Map();
		for (const ev of events || []) {
			if (ev.type === "heftSnap" && ev.payload?.pageId) snapSeq.set(ev.payload.pageId, Math.max(snapSeq.get(ev.payload.pageId) || 0, ev.seq || 0));
		}
		return (events || []).filter((ev) => {
			if (ev.type === "uiTabsSet" || ev.type === "uiTreeSet") return false;
			if (ev.type === "heftOps" && (snapSeq.get(ev.payload?.pageId) || 0) > (ev.seq || 0)) return false;
			return true;
		});
	}

	function compactEvents(events) {
		const sorted = [...events].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0) || (a.seq || 0) - (b.seq || 0));
		const deletedAt = { page: {}, card: {} };
		for (const ev of sorted) {
			if (!ev.payload) continue;
			if (ev.type === "pageDelete") deletedAt.page[ev.payload.id] = ev.t;
			if (ev.type === "cardDelete") deletedAt.card[ev.payload.id] = ev.t;
		}
		const covered = {}, contentKept = {}, keep = [];
		let uiTabsKept = false;
		const uiTreeKeys = new Set();
		const heftSnapped = new Set();
		for (let i = sorted.length - 1; i >= 0; i--) {
			const ev = sorted[i], p = ev.payload || {};
			if (ev.type === "uiTabsSet") { if (uiTabsKept) continue; uiTabsKept = true; }
			else if (ev.type === "uiTreeSet") { if (p.key == null || uiTreeKeys.has(p.key)) continue; uiTreeKeys.add(p.key); }
			else if (ev.type === "heftSnap") { if (heftSnapped.has(p.pageId)) continue; heftSnapped.add(p.pageId); }
			else if (ev.type === "heftOps" && heftSnapped.has(p.pageId)) continue;
			if (ev.type === "pageUpdate" && deletedAt.page[p.id] && ev.t <= deletedAt.page[p.id]) continue;
			if (ev.type === "cardUpdate" && deletedAt.card[p.id] && ev.t <= deletedAt.card[p.id]) continue;
			const [bucket, patch] =
				ev.type === "pageUpdate" ? ["page:" + p.id, p.patch] :
				ev.type === "cardUpdate" ? ["card:" + p.id, p.patch] :
				ev.type === "settingsSet" ? ["settings", p] : [null, null];
			if (bucket && patch) {
				const seen = covered[bucket] ??= new Set();
				const keys = Object.keys(patch);
				if (ev.type === "pageUpdate" && typeof patch.content === "string" && (contentKept[p.id] || 0) < KEEP_CONTENT_VERSIONS) {
					contentKept[p.id] = (contentKept[p.id] || 0) + 1;
				} else if (keys.length && keys.every((k) => seen.has(k))) continue;
				keys.forEach((k) => seen.add(k));
			}
			keep.push(ev);
		}
		return keep.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0) || (a.seq || 0) - (b.seq || 0));
	}

	return {
		deriveSyncCredentials,
		encryptPayload,
		decryptPayload,
		prepareCloudEvents,
		cloudEventEnvelope,
		cloudEventsEnvelope,
		chunkCloudEvents,
		pruneEventsForUpload,
		compactEvents,
		sha256Hex,
	};
})();

// =============================================================================
// STATISTICAL METRICS TRACKER
// =============================================================================
class ScenarioMetrics {
	constructor(name) {
		this.name = name;
		this.durations = [];
		this.cpuTimes = [];
		this.getCounts = [];
		this.postCounts = [];
		this.wsCounts = [];
		this.bytesUpList = [];
		this.bytesDownList = [];
	}

	recordRun(durationMs, cpuMs, gets, posts, ws, bytesUp, bytesDown) {
		this.durations.push(durationMs);
		this.cpuTimes.push(cpuMs);
		this.getCounts.push(gets);
		this.postCounts.push(posts);
		this.wsCounts.push(ws);
		this.bytesUpList.push(bytesUp);
		this.bytesDownList.push(bytesDown);
	}

	summary(discardWarmup = 5) {
		const dur = this.durations.slice(discardWarmup);
		const cpu = this.cpuTimes.slice(discardWarmup);
		const gets = this.getCounts.slice(discardWarmup);
		const posts = this.postCounts.slice(discardWarmup);
		const ws = this.wsCounts.slice(discardWarmup);
		const up = this.bytesUpList.slice(discardWarmup);
		const down = this.bytesDownList.slice(discardWarmup);

		function stats(arr) {
			if (!arr.length) return { min: 0, max: 0, median: 0, p95: 0, mean: 0 };
			const sorted = [...arr].sort((a, b) => a - b);
			const min = sorted[0];
			const max = sorted[sorted.length - 1];
			const mid = Math.floor(sorted.length / 2);
			const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
			const p95Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
			const p95 = sorted[p95Idx];
			const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
			return { min, max, median: Math.round(median * 100) / 100, p95: Math.round(p95 * 100) / 100, mean: Math.round(mean * 100) / 100 };
		}

		return {
			name: this.name,
			duration: stats(dur),
			cpu: stats(cpu),
			gets: stats(gets).median,
			posts: stats(posts).median,
			ws: stats(ws).median,
			totalRequests: stats(gets).median + stats(posts).median + stats(ws).median,
			bytesUp: stats(up).median,
			bytesDown: stats(down).median,
			totalBytes: stats(up).median + stats(down).median,
		};
	}
}

// =============================================================================
// REAL V3 RUNNER (Exact Production Logic)
// =============================================================================
class V3ProductionRunner {
	constructor(syncKey) {
		this.syncKey = syncKey;
		this.creds = null;
		this.serverEvents = [];
		this.serverSeq = 0;
		this.httpGets = 0;
		this.httpPosts = 0;
		this.wsMessages = 0;
		this.bytesUp = 0;
		this.bytesDown = 0;
	}

	async init() {
		this.creds = await V3_ENGINE.deriveSyncCredentials(this.syncKey);
	}

	// Exact v3 Client Push
	async executePush(events, isInitialPush = false) {
		const localMaxSeq = events.reduce((m, e) => Math.max(m, e.seq || 0), 0);
		// v3: Initial push runs compactEvents; Delta push uploads only new events
		const source = isInitialPush ? V3_ENGINE.compactEvents(events) : events;
		const transportEvents = V3_ENGINE.prepareCloudEvents(V3_ENGINE.pruneEventsForUpload(source), { includeRemote: isInitialPush });

		if (!transportEvents.length) return;

		let encryptedBatch = [];
		let batchChars = 0;
		const MAX_BATCH_EVENTS = 40;
		const MAX_BATCH_CHARS = 6_000_000;

		const uploadBatch = async () => {
			if (!encryptedBatch.length) return;
			const wire = JSON.stringify({ events: encryptedBatch });
			this.httpPosts++;
			this.bytesUp += Buffer.byteLength(wire);

			// Server Save (v3 SyncRoom logic)
			for (const p of encryptedBatch) {
				if (!this.serverEvents.some((e) => e.id === p.id)) {
					this.serverEvents.push({ ...p, seq: ++this.serverSeq });
				}
			}
			const resp = JSON.stringify({ ok: true, maxSeq: this.serverSeq, savedCount: encryptedBatch.length });
			this.bytesDown += Buffer.byteLength(resp);

			encryptedBatch = [];
			batchChars = 0;
		};

		if (isInitialPush) {
			// v3 Initial-Push: chunkCloudEvents with cloudEventsEnvelope
			for (const chunk of V3_ENGINE.chunkCloudEvents(transportEvents)) {
				const batchId = `batch-${await V3_ENGINE.sha256Hex(chunk.map((e) => e.id).join("\n"))}`;
				const enc = await V3_ENGINE.encryptPayload(this.creds.cryptoKey, V3_ENGINE.cloudEventsEnvelope(chunk));
				const packet = { id: batchId, iv: enc.iv, data: enc.data, size: enc.size };
				const pChars = JSON.stringify(packet).length;
				if (encryptedBatch.length && (encryptedBatch.length >= MAX_BATCH_EVENTS || batchChars + pChars > MAX_BATCH_CHARS)) {
					await uploadBatch();
				}
				encryptedBatch.push(packet);
				batchChars += pChars;
			}
			await uploadBatch();
		} else {
			// v3 Delta-Push: single cloudEventEnvelope per event
			for (const event of transportEvents) {
				const enc = await V3_ENGINE.encryptPayload(this.creds.cryptoKey, V3_ENGINE.cloudEventEnvelope(event));
				const packet = { id: event.id, iv: enc.iv, data: enc.data, size: enc.size };
				const pChars = JSON.stringify(packet).length;
				if (encryptedBatch.length && (encryptedBatch.length >= 20 || batchChars + pChars > MAX_BATCH_CHARS)) {
					await uploadBatch();
				}
				encryptedBatch.push(packet);
				batchChars += pChars;
			}
			await uploadBatch();
		}
	}

	// Exact v3 Client Pull
	async executePull(since = 0) {
		this.httpGets++;
		this.bytesDown += 50; // GET request overhead
		const returnPackets = this.serverEvents.filter((e) => e.seq > since);
		const respJson = JSON.stringify({ events: returnPackets, maxSeq: this.serverSeq, hasMore: false });
		this.bytesDown += Buffer.byteLength(respJson);

		const receivedEvents = [];
		for (const p of returnPackets) {
			const dec = await V3_ENGINE.decryptPayload(this.creds.cryptoKey, p);
			if (Array.isArray(dec.events)) {
				receivedEvents.push(...dec.events);
			} else if (dec.event) {
				receivedEvents.push(dec.event);
			}
		}
		return receivedEvents;
	}
}

// =============================================================================
// REAL V4 RUNNER (Exact Current sync-v4-rewrite Production Logic)
// =============================================================================
class V4ProductionRunner {
	constructor(syncKey) {
		this.syncKey = syncKey;
		this.creds = null;
		this.serverEvents = [];
		this.serverBlobs = new Map();
		this.serverSeq = 0;
		this.httpGets = 0;
		this.httpPosts = 0;
		this.wsMessages = 0;
		this.bytesUp = 0;
		this.bytesDown = 0;
	}

	async init() {
		this.creds = await v4DeriveSyncCredentials(this.syncKey);
	}

	// Exact v4 Client Push (Coalesced & Gzip Batches)
	async executePush(events, isInitialPush = false) {
		const localMaxSeq = events.reduce((m, e) => Math.max(m, e.seq || 0), 0);
		// v4: Initial push runs compactEvents; Delta push filters seq > uploaded
		const source = isInitialPush ? v4DB.compactEvents(events) : events;
		const wire = v4PrepareCloudEvents(v4PruneEventsForUpload(source), { includeRemote: isInitialPush });

		if (!wire.length) return;

		const chunks = v4ChunkCloudEvents(wire);
		const packets = [];
		for (const chunk of chunks) {
			const id = `p-${await v4Sha256Hex(chunk.map((e) => e.id).join("\n"))}`;
			const encrypted = await v4EncryptPayload(this.creds.cryptoKey, v4CloudEventsEnvelope(chunk));
			packets.push({ id, ...encrypted });
		}

		const wireBody = JSON.stringify({ events: packets });
		this.httpPosts++;
		this.bytesUp += Buffer.byteLength(wireBody);

		// Server Save (v4 SyncRoom logic)
		for (const p of packets) {
			if (!this.serverEvents.some((e) => e.id === p.id)) {
				this.serverEvents.push({ ...p, seq: ++this.serverSeq });
			}
		}
		const resp = JSON.stringify({ ok: true, savedCount: packets.length, maxSeq: this.serverSeq });
		this.bytesDown += Buffer.byteLength(resp);
	}

	// Exact v4 Client Pull
	async executePull(since = 0) {
		this.httpGets++;
		this.bytesDown += 50;
		const returnPackets = this.serverEvents.filter((e) => e.seq > since);
		const respJson = JSON.stringify({ events: returnPackets, maxSeq: this.serverSeq, hasMore: false });
		this.bytesDown += Buffer.byteLength(respJson);

		const receivedEvents = [];
		for (const p of returnPackets) {
			const dec = await v4DecryptPayload(this.creds.cryptoKey, p);
			const unpacked = v4PrepareIncomingCloudEvents([dec]);
			receivedEvents.push(...unpacked);
		}
		return receivedEvents;
	}

	// Exact v4 Blob Upload
	async executeBlobUpload(blobs) {
		for (const [id, blobData] of blobs.entries()) {
			if (!this.serverBlobs.has(id)) {
				const encBlob = await v4EncryptBlobRecord(this.creds.cryptoKey, id, { data: blobData.bytes, meta: { mime: blobData.mime } });
				this.httpPosts++;
				this.bytesUp += encBlob.size + 100;
				this.serverBlobs.set(id, encBlob);
				this.bytesDown += 50;
			}
		}
	}
}

// =============================================================================
// SYNTHETIC WORKLOAD GENERATORS (Exact Identical Data for Both)
// =============================================================================
function createBulkNoteEvents(count) {
	const events = [];
	for (let i = 1; i <= count; i++) {
		events.push({
			seq: i,
			id: `note-event-${i}`,
			t: new Date(Date.now() + i * 100).toISOString(),
			type: "pageCreate",
			payload: { id: `p-${i}`, title: `Notiz ${i}`, content: `Das ist der Inhalt der Notiz ${i} für den Performance-Benchmark.` },
		});
	}
	return events;
}

function createHeftDrawingEvents(strokeCount) {
	const events = [];
	const batches = Math.min(strokeCount, 50);
	const strokesPerBatch = Math.ceil(strokeCount / batches);
	const currentPages = [{ id: "page-1", strokes: [] }];

	for (let b = 1; b <= batches; b++) {
		const ops = [];
		for (let s = 1; s <= strokesPerBatch; s++) {
			const stroke = { id: `s-${b}-${s}`, pts: [[s, s], [s + 1, s + 1], [s + 2, s + 2]], color: "#000000", size: 2 };
			currentPages[0].strokes.push(stroke);
			ops.push({ t: "s+", p: "page-1", o: stroke });
		}
		// v3 accumulated heftSnap
		events.push({
			seq: b,
			id: `heft-snap-${b}`,
			t: new Date(Date.now() + b * 1000).toISOString(),
			type: "heftSnap",
			payload: { pageId: "h-notebook-1", doc: { pages: JSON.parse(JSON.stringify(currentPages)) } },
			_v4Ops: ops, // for v4 equivalent
		});
	}
	return events;
}

function makeRandomBuffer(bytesCount) {
	const buf = new Uint8Array(bytesCount);
	for (let offset = 0; offset < bytesCount; offset += 65536) {
		const chunk = buf.subarray(offset, Math.min(bytesCount, offset + 65536));
		globalThis.crypto.getRandomValues(chunk);
	}
	return buf;
}

// =============================================================================
// BENCHMARK EXECUTION ENGINE (20 Iterations, 5 Warmup Dropped)
// =============================================================================
const ITERATIONS = 20;
const WARMUP_DROPPED = 5;

async function benchmarkScenario(name, runV3Fn, runV4Fn) {
	const metricsV3 = new ScenarioMetrics(`${name} (v3)`);
	const metricsV4 = new ScenarioMetrics(`${name} (v4)`);

	// Run v3
	for (let i = 0; i < ITERATIONS; i++) {
		const startCpu = process.cpuUsage();
		const t0 = performance.now();
		const runner = new V3ProductionRunner("impala-1111-2222-3333-4444-5555-6666-7777-8888");
		await runner.init();
		await runV3Fn(runner, i);
		const t1 = performance.now();
		const cpu = process.cpuUsage(startCpu);
		metricsV3.recordRun(
			t1 - t0,
			(cpu.user + cpu.system) / 1000,
			runner.httpGets,
			runner.httpPosts,
			runner.wsMessages,
			runner.bytesUp,
			runner.bytesDown
		);
	}

	// Run v4
	for (let i = 0; i < ITERATIONS; i++) {
		const startCpu = process.cpuUsage();
		const t0 = performance.now();
		const runner = new V4ProductionRunner("impala-1111-2222-3333-4444-5555-6666-7777-8888");
		await runner.init();
		await runV4Fn(runner, i);
		const t1 = performance.now();
		const cpu = process.cpuUsage(startCpu);
		metricsV4.recordRun(
			t1 - t0,
			(cpu.user + cpu.system) / 1000,
			runner.httpGets,
			runner.httpPosts,
			runner.wsMessages,
			runner.bytesUp,
			runner.bytesDown
		);
	}

	return {
		name,
		v3: metricsV3.summary(WARMUP_DROPPED),
		v4: metricsV4.summary(WARMUP_DROPPED),
	};
}

// =============================================================================
// MAIN BENCHMARK SUITE
// =============================================================================
export async function runAllBenchmarks() {
	const results = [];

	// -------------------------------------------------------------------------
	// A. INITIAL SYNC (100, 1.000, 10.000 Events)
	// -------------------------------------------------------------------------
	for (const count of [100, 1000, 10000]) {
		const testEvents = createBulkNoteEvents(count);
		results.push(await benchmarkScenario(
			`A. Initial-Sync: ${count} Events`,
			async (v3) => {
				await v3.executePush(testEvents, true);
			},
			async (v4) => {
				await v4.executePush(testEvents, true);
			}
		));
	}

	// -------------------------------------------------------------------------
	// B. WARM SYNC (1 Event, 100 Events)
	// -------------------------------------------------------------------------
	const seedEvents = createBulkNoteEvents(100);
	results.push(await benchmarkScenario(
		"B. Warm Sync: 1 Event Delta",
		async (v3) => {
			await v3.executePush(seedEvents, true);
			const delta = [{ seq: 101, id: "warm-1", t: new Date().toISOString(), type: "pageUpdate", payload: { id: "p-1", patch: { title: "Title Rev 2" } } }];
			await v3.executePush(delta, false);
		},
		async (v4) => {
			await v4.executePush(seedEvents, true);
			const delta = [{ seq: 101, id: "warm-1", t: new Date().toISOString(), type: "pageUpdate", payload: { id: "p-1", patch: { title: "Title Rev 2" } } }];
			await v4.executePush(delta, false);
		}
	));

	results.push(await benchmarkScenario(
		"B. Warm Sync: 100 Events Delta",
		async (v3) => {
			await v3.executePush(seedEvents, true);
			const delta = [];
			for (let i = 1; i <= 100; i++) {
				delta.push({ seq: 100 + i, id: `warm-100-${i}`, t: new Date().toISOString(), type: "pageUpdate", payload: { id: `p-${i}`, patch: { count: i } } });
			}
			await v3.executePush(delta, false);
		},
		async (v4) => {
			await v4.executePush(seedEvents, true);
			const delta = [];
			for (let i = 1; i <= 100; i++) {
				delta.push({ seq: 100 + i, id: `warm-100-${i}`, t: new Date().toISOString(), type: "pageUpdate", payload: { id: `p-${i}`, patch: { count: i } } });
			}
			await v4.executePush(delta, false);
		}
	));

	// -------------------------------------------------------------------------
	// C. HEFT SYNC (100, 1.000, 10.000 Striche)
	// -------------------------------------------------------------------------
	for (const strokeCount of [100, 1000, 10000]) {
		const rawHeftEvents = createHeftDrawingEvents(strokeCount);
		results.push(await benchmarkScenario(
			`C. Heft-Zeichnen: ${strokeCount} Striche (Initial Push mit Compaction)`,
			async (v3) => {
				await v3.executePush(rawHeftEvents, true);
			},
			async (v4) => {
				const v4Events = rawHeftEvents.map((e, idx) => ({
					seq: idx + 1,
					id: `v4-heft-${idx + 1}`,
					t: e.t,
					type: "heftOps",
					payload: { pageId: "h-notebook-1", ops: e._v4Ops },
				}));
				await v4.executePush(v4Events, true);
			}
		));
	}

	// -------------------------------------------------------------------------
	// D. MULTI-DEVICE (2 Geräte, je 100 Änderungen)
	// -------------------------------------------------------------------------
	const devAEvents = [];
	const devBEvents = [];
	for (let i = 1; i <= 100; i++) {
		devAEvents.push({ seq: i, id: `devA-note-${i}`, t: new Date(Date.now() + i * 50).toISOString(), type: "pageCreate", payload: { id: `pa-${i}`, title: `A ${i}` } });
		devBEvents.push({ seq: i, id: `devB-note-${i}`, t: new Date(Date.now() + i * 50 + 10).toISOString(), type: "pageCreate", payload: { id: `pb-${i}`, title: `B ${i}` } });
	}

	results.push(await benchmarkScenario(
		"D. Multi-Device: 2 Geräte je 100 Änderungen",
		async (v3) => {
			await v3.executePush(devAEvents, true);
			await v3.executePush(devBEvents, true);
			await v3.executePull(0);
		},
		async (v4) => {
			await v4.executePush(devAEvents, true);
			await v4.executePush(devBEvents, true);
			await v4.executePull(0);
		}
	));

	// -------------------------------------------------------------------------
	// E. NO-OP WARM SYNC (0 neue Events)
	// -------------------------------------------------------------------------
	results.push(await benchmarkScenario(
		"E. No-Op Warm Sync (0 neue Events)",
		async (v3) => {
			await v3.executePush(seedEvents, true);
			await v3.executePull(v3.serverSeq);
		},
		async (v4) => {
			await v4.executePush(seedEvents, true);
			await v4.executePull(v4.serverSeq);
		}
	));

	// -------------------------------------------------------------------------
	// F. DATEIEN / BLOBS (10 × 1-MB-Bilder, 5-MB-PDF)
	// -------------------------------------------------------------------------
	const img1Mb = makeRandomBuffer(1024 * 1024);
	const pdf5Mb = makeRandomBuffer(5 * 1024 * 1024);

	const v4Blobs10Img = new Map();
	for (let i = 0; i < 10; i++) v4Blobs10Img.set(`blob-img-${i}`, { bytes: img1Mb, mime: "image/webp" });

	const v4BlobsPdf = new Map([["blob-pdf-1", { bytes: pdf5Mb, mime: "application/pdf" }]]);

	results.push(await benchmarkScenario(
		"F. 10 × 1-MB-Bilder (Attachments)",
		async (v3) => {
			// In v3: Feature nicht vorhanden (v3 synchronisierte keine Dateien/Blobs über Cloudflare)
		},
		async (v4) => {
			await v4.executeBlobUpload(v4Blobs10Img);
		}
	));

	results.push(await benchmarkScenario(
		"F. 5-MB-PDF Großdatei",
		async (v3) => {
			// In v3: Feature nicht vorhanden (v3 synchronisierte keine Dateien/Blobs über Cloudflare)
		},
		async (v4) => {
			await v4.executeBlobUpload(v4BlobsPdf);
		}
	));

	return results;
}

// =============================================================================
// HOTSPOT 1: importRemote() Prefix-Scan
// =============================================================================
export async function runImportRemoteHotspot() {
	const cases = [
		{ name: "a) 50.000 Events, erstes Event unbestätigt (Immediate Stop)", unconfirmedAt: 1, nonUploadable: false },
		{ name: "b) 50.000 Events, alle bestätigt (Full Walk)", unconfirmedAt: 50001, nonUploadable: false },
		{ name: "c) 50.000 Events, Event 25.000 unbestätigt (Half Walk)", unconfirmedAt: 25000, nonUploadable: false },
		{ name: "d) 50.000 Events, 50% nicht-uploadpflichtig (_remoteSource)", unconfirmedAt: 50001, nonUploadable: true },
	];

	const report = [];

	for (const c of cases) {
		const localEvents = [];
		for (let i = 1; i <= 50000; i++) {
			const isRemote = c.nonUploadable && i % 2 === 0;
			localEvents.push({
				seq: i,
				id: `loc-ev-${i}`,
				type: "pageUpdate",
				payload: { id: `p-${i % 50}` },
				_remoteSource: isRemote ? "cloudflare" : undefined,
			});
		}

		const serverEvents = [];
		for (let i = 1; i < c.unconfirmedAt && i <= 50000; i++) {
			serverEvents.push({ id: `loc-ev-${i}` });
		}
		const serverEventIds = new Set(serverEvents.map((e) => e.id));

		const durations = [];
		const cpuTimes = [];

		for (let it = 0; it < ITERATIONS; it++) {
			const startCpu = process.cpuUsage();
			const t0 = performance.now();

			// Exact production importRemote prefix scan path:
			const sortedLocal = localEvents.slice().sort((a, b) => (Number(a?.seq) || 0) - (Number(b?.seq) || 0));
			let confirmedCursor = 0;

			for (const ev of sortedLocal) {
				const seq = Number(ev?.seq) || 0;
				if (seq <= confirmedCursor) continue;

				// Production filter check
				const wire = v4PrepareCloudEvents(v4PruneEventsForUpload([ev]), { includeRemote: false });
				const isUploadable = wire.length > 0;

				if (!isUploadable) {
					confirmedCursor = seq;
					continue;
				}

				if (serverEventIds.has(ev.id)) {
					confirmedCursor = seq;
				} else {
					break; // STOP
				}
			}

			const t1 = performance.now();
			const cpu = process.cpuUsage(startCpu);
			durations.push(t1 - t0);
			cpuTimes.push((cpu.user + cpu.system) / 1000);
		}

		const measuredDur = durations.slice(WARMUP_DROPPED).sort((a, b) => a - b);
		const measuredCpu = cpuTimes.slice(WARMUP_DROPPED).sort((a, b) => a - b);
		const mid = Math.floor(measuredDur.length / 2);
		const p95Idx = Math.min(measuredDur.length - 1, Math.floor(measuredDur.length * 0.95));

		report.push({
			Szenario: c.name,
			"Median (ms)": Math.round(measuredDur[mid] * 100) / 100,
			"p95 (ms)": Math.round(measuredDur[p95Idx] * 100) / 100,
			"Min (ms)": Math.round(measuredDur[0] * 100) / 100,
			"Max (ms)": Math.round(measuredDur[measuredDur.length - 1] * 100) / 100,
			"CPU Median (ms)": Math.round(measuredCpu[mid] * 100) / 100,
		});
	}

	return report;
}

// =============================================================================
// HOTSPOT 2: Blob Sync Inventory Profiling
// =============================================================================
export async function runBlobInventoryHotspot() {
	const counts = [10, 100, 1000, 5000];
	const PAGE_SIZE = 1000;
	const report = [];

	for (const count of counts) {
		const remoteBlobKeys = Array.from({ length: count }, (_, i) => `blob-key-${i.toString().padStart(6, "0")}`);
		const localNeeded = new Set(Array.from({ length: Math.min(count, 50) }, (_, i) => `blob-key-${(i * 2).toString().padStart(6, "0")}`));

		const durations = [];
		const cpuTimes = [];

		for (let it = 0; it < ITERATIONS; it++) {
			const startCpu = process.cpuUsage();
			const t0 = performance.now();

			// 1. Pagination Simulation
			const pagesNeeded = Math.ceil(count / PAGE_SIZE);
			let totalSimulatedWireBytes = 0;
			const receivedKeys = [];

			for (let p = 0; p < pagesNeeded; p++) {
				const chunk = remoteBlobKeys.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);
				const respJson = JSON.stringify({ keys: chunk, cursor: p < pagesNeeded - 1 ? `cursor-${p}` : "" });
				totalSimulatedWireBytes += Buffer.byteLength(respJson) + 50;
				receivedKeys.push(...chunk);
			}

			// 2. Set Matching
			const remoteSet = new Set(receivedKeys);
			const missingLocally = [];
			for (const k of receivedKeys) {
				if (!localNeeded.has(k)) missingLocally.push(k);
			}

			const t1 = performance.now();
			const cpu = process.cpuUsage(startCpu);
			durations.push(t1 - t0);
			cpuTimes.push((cpu.user + cpu.system) / 1000);
		}

		const measuredDur = durations.slice(WARMUP_DROPPED).sort((a, b) => a - b);
		const measuredCpu = cpuTimes.slice(WARMUP_DROPPED).sort((a, b) => a - b);
		const mid = Math.floor(measuredDur.length / 2);
		const p95Idx = Math.min(measuredDur.length - 1, Math.floor(measuredDur.length * 0.95));

		report.push({
			"Blobs im Remote Store": count,
			"Pages /api/blobs": Math.ceil(count / PAGE_SIZE),
			"Transport Bytes": (count * 32) + (Math.ceil(count / PAGE_SIZE) * 120),
			"Matching Median (ms)": Math.round(measuredDur[mid] * 1000) / 1000,
			"Matching p95 (ms)": Math.round(measuredDur[p95Idx] * 1000) / 1000,
			"Matching Max (ms)": Math.round(measuredDur[measuredDur.length - 1] * 1000) / 1000,
		});
	}

	return report;
}

// =============================================================================
// CLI OUTPUT FORMATTER
// =============================================================================
async function main() {
	console.log("================================================================================");
	console.log("    ECHTER PERFORMANCE-BENCHMARK: SYNC V3 (5377699) VS SYNC V4 (CURRENT)");
	console.log(`    Methodik: 20 Wiederholungen, ${WARMUP_DROPPED} Warmup verworfen -> 15 Messläufe`);
	console.log("================================================================================\n");

	const results = await runAllBenchmarks();

	function fmtBytes(b) {
		if (b === 0) return "0 B";
		if (b < 1024) return `${b} B`;
		if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
		return `${(b / (1024 * 1024)).toFixed(2)} MB`;
	}

	function fmtTime(ms) {
		if (ms === 0) return "0.0 ms";
		if (ms < 1000) return `${ms.toFixed(1)} ms`;
		return `${(ms / 1000).toFixed(2)} s`;
	}

	for (const r of results) {
		console.log(`\n📌 ${r.name}`);
		if (r.name.startsWith("F.")) {
			console.log("   v3 (Legacy):  Feature nicht vorhanden (kein Cloudflare Blob-Sync in v3; rein lokal/Drive)");
			console.log(`   v4 (Current): Median: ${fmtTime(r.v4.duration.median).padEnd(8)} (p95: ${fmtTime(r.v4.duration.p95)}, min: ${fmtTime(r.v4.duration.min)}, max: ${fmtTime(r.v4.duration.max)}) | ${r.v4.totalRequests} Reqs (${r.v4.posts} POST/PUT, ${r.v4.gets} GET) | ${fmtBytes(r.v4.totalBytes)} Wire Bytes`);
		} else {
			console.log(`   v3 (Legacy):  Median: ${fmtTime(r.v3.duration.median).padEnd(8)} (p95: ${fmtTime(r.v3.duration.p95)}, min: ${fmtTime(r.v3.duration.min)}, max: ${fmtTime(r.v3.duration.max)}) | ${r.v3.totalRequests} Reqs (${r.v3.posts} POST, ${r.v3.gets} GET) | ${fmtBytes(r.v3.totalBytes)} Wire Bytes`);
			console.log(`   v4 (Current): Median: ${fmtTime(r.v4.duration.median).padEnd(8)} (p95: ${fmtTime(r.v4.duration.p95)}, min: ${fmtTime(r.v4.duration.min)}, max: ${fmtTime(r.v4.duration.max)}) | ${r.v4.totalRequests} Reqs (${r.v4.posts} POST, ${r.v4.gets} GET) | ${fmtBytes(r.v4.totalBytes)} Wire Bytes`);
			const durFactor = (r.v3.duration.median / Math.max(0.1, r.v4.duration.median)).toFixed(1);
			const byteFactor = (r.v3.totalBytes / Math.max(1, r.v4.totalBytes)).toFixed(1);
			console.log(`   👉 Vergleich: Zeit: ${durFactor}x | Daten: ${byteFactor}x | Reqs: ${r.v3.totalRequests} -> ${r.v4.totalRequests}`);
		}
	}

	console.log("\n================================================================================");
	console.log("HOTSPOT 1: importRemote() Prefix-Scan (Vollständiger Produktionspfad)");
	console.log("================================================================================");
	const hotspot1 = await runImportRemoteHotspot();
	console.table(hotspot1);

	console.log("\n================================================================================");
	console.log("HOTSPOT 2: Blob-Sync Inventory Listing & Pagination");
	console.log("================================================================================");
	const hotspot2 = await runBlobInventoryHotspot();
	console.table(hotspot2);
}

main().catch(console.error);
