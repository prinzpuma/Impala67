import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import {
	CLOUD_SYNC_PROTOCOL,
	chunkCloudEvents,
	cloudEventsEnvelope,
	prepareCloudEvents,
	prepareIncomingCloudEvents,
	pruneEventsForUpload,
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
	sha256Hex,
} from "../web/sync-crypto.js";

// -----------------------------------------------------------------------------
// METRICS COLLECTOR
// -----------------------------------------------------------------------------
class MetricsTracker {
	constructor(name) {
		this.name = name;
		this.httpGetCount = 0;
		this.httpPostCount = 0;
		this.wsMessageCount = 0;
		this.bytesUploaded = 0;
		this.bytesDownloaded = 0;
		this.startTime = 0;
		this.endTime = 0;
		this.startCpu = null;
		this.endCpu = null;
	}

	start() {
		this.startTime = performance.now();
		this.startCpu = process.cpuUsage();
	}

	stop() {
		this.endTime = performance.now();
		this.endCpu = process.cpuUsage(this.startCpu);
	}

	recordUpload(bytes, isPost = true) {
		if (isPost) this.httpPostCount++;
		this.bytesUploaded += bytes;
	}

	recordDownload(bytes, isGet = true) {
		if (isGet) this.httpGetCount++;
		this.bytesDownloaded += bytes;
	}

	recordWs(bytes) {
		this.wsMessageCount++;
		this.bytesUploaded += bytes;
	}

	get durationMs() {
		return Math.round((this.endTime - this.startTime) * 100) / 100;
	}

	get cpuMs() {
		if (!this.endCpu) return 0;
		return Math.round(((this.endCpu.user + this.endCpu.system) / 1000) * 100) / 100;
	}

	get totalRequests() {
		return this.httpGetCount + this.httpPostCount + this.wsMessageCount;
	}

	get totalBytes() {
		return this.bytesUploaded + this.bytesDownloaded;
	}

	summary() {
		return {
			name: this.name,
			durationMs: this.durationMs,
			cpuMs: this.cpuMs,
			requests: this.totalRequests,
			getRequests: this.httpGetCount,
			postRequests: this.httpPostCount,
			wsMessages: this.wsMessageCount,
			bytesUp: this.bytesUploaded,
			bytesDown: this.bytesDownloaded,
			totalBytes: this.totalBytes,
		};
	}
}

// -----------------------------------------------------------------------------
// SIMULATED V3 PIPELINE (Legacy v3 Sync Mechanics)
// -----------------------------------------------------------------------------
class SimulatedV3Client {
	constructor(id, syncKey, metrics) {
		this.id = id;
		this.syncKey = syncKey;
		this.metrics = metrics;
		this.creds = null;
		this.events = [];
		this.lastSyncedSeq = 0;
		this.lastUploadedSeq = 0;
	}

	async init() {
		this.creds = await deriveSyncCredentials(this.syncKey);
	}

	async addEvent(type, payload, t = new Date().toISOString()) {
		const ev = { id: `ev-${this.id}-${Math.random().toString(36).slice(2, 9)}`, seq: this.events.length + 1, t, type, payload };
		this.events.push(ev);
		return ev;
	}

	// v3 Delta Sync: Encrypts each event individually into its own packet
	async syncDelta(server) {
		// 1. Pull
		this.metrics.recordDownload(50, true);
		const pullData = await server.getEventsV3(this.lastSyncedSeq);
		const pullWire = JSON.stringify(pullData);
		this.metrics.recordDownload(Buffer.byteLength(pullWire), false);

		if (pullData.events?.length) {
			for (const p of pullData.events) {
				const dec = await decryptPayload(this.creds.cryptoKey, p);
				this.events.push({ ...dec.event, seq: this.events.length + 1 });
			}
			this.lastSyncedSeq = pullData.maxSeq;
		}

		// 2. Push unsynced events (v3: 1 packet per event for delta)
		const unsynced = this.events.filter((e) => e.seq > this.lastUploadedSeq);
		if (unsynced.length > 0) {
			const packets = [];
			for (const ev of unsynced) {
				const rawPayload = { type: ev.type, payload: ev.payload, id: ev.id, t: ev.t };
				const enc = await encryptPayload(this.creds.cryptoKey, { event: rawPayload });
				packets.push({ id: ev.id, iv: enc.iv, data: enc.data, size: enc.size });
			}

			// v3 batches packets into MAX 20 per HTTP request
			const BATCH_SIZE = 20;
			for (let i = 0; i < packets.length; i += BATCH_SIZE) {
				const batch = packets.slice(i, i + BATCH_SIZE);
				const wireBody = JSON.stringify({ events: batch });
				this.metrics.recordUpload(Buffer.byteLength(wireBody), true);
				const resp = await server.postEventsV3(batch);
				this.metrics.recordDownload(Buffer.byteLength(JSON.stringify(resp)), false);
			}
			this.lastUploadedSeq = this.events.length;
		}
	}
}

// -----------------------------------------------------------------------------
// SIMULATED V4 PIPELINE (Impala67 Production v4 Architecture)
// -----------------------------------------------------------------------------
class SimulatedV4Client {
	constructor(id, syncKey, metrics) {
		this.id = id;
		this.syncKey = syncKey;
		this.metrics = metrics;
		this.creds = null;
		this.events = [];
		this.blobs = new Map();
		this.lastSyncedSeq = 0;
		this.lastUploadedSeq = 0;
	}

	async init() {
		this.creds = await deriveSyncCredentials(this.syncKey);
	}

	async addEvent(type, payload, t = new Date().toISOString()) {
		const ev = { id: `ev-${this.id}-${Math.random().toString(36).slice(2, 9)}`, seq: this.events.length + 1, t, type, payload };
		this.events.push(ev);
		return ev;
	}

	async addBlob(bytes, mime = "image/webp") {
		const hash = await sha256Hex(bytes);
		const id = `b-${hash.slice(0, 32)}`;
		this.blobs.set(id, { id, bytes: new Uint8Array(bytes), mime });
		return id;
	}

	async sync(server) {
		// 1. Pull
		this.metrics.recordDownload(50, true);
		const pullData = await server.getEventsV4(this.lastSyncedSeq);
		const pullWire = JSON.stringify(pullData);
		this.metrics.recordDownload(Buffer.byteLength(pullWire), false);

		if (pullData.events?.length) {
			for (const p of pullData.events) {
				const dec = await decryptPayload(this.creds.cryptoKey, p);
				const unpacked = prepareIncomingCloudEvents([dec]);
				for (const ev of unpacked) {
					this.events.push({ ...ev, seq: this.events.length + 1 });
				}
			}
			this.lastSyncedSeq = pullData.maxSeq;
		}

		// 2. Blob Sync (only unsynced blobs)
		for (const [id, blobRec] of this.blobs.entries()) {
			if (!server.hasBlob(id)) {
				const encBlob = await encryptBlobRecord(this.creds.cryptoKey, id, { data: blobRec.bytes, meta: { mime: blobRec.mime } });
				this.metrics.recordUpload(encBlob.size + 100, true);
				await server.putBlobV4(id, encBlob);
				this.metrics.recordDownload(50, false);
			}
		}

		// 3. Push Delta (gzip compressed batches up to 200 events)
		const unsynced = this.events.filter((e) => e.seq > this.lastUploadedSeq);
		if (unsynced.length > 0) {
			const wire = prepareCloudEvents(pruneEventsForUpload(unsynced), { includeRemote: false });
			if (wire.length > 0) {
				const chunks = chunkCloudEvents(wire);
				const packets = [];
				for (const chunk of chunks) {
					const id = `p-${await sha256Hex(chunk.map((e) => e.id).join("\n"))}`;
					const enc = await encryptPayload(this.creds.cryptoKey, cloudEventsEnvelope(chunk));
					packets.push({ id, ...enc });
				}

				const wireBody = JSON.stringify({ events: packets });
				this.metrics.recordUpload(Buffer.byteLength(wireBody), true);
				const resp = await server.postEventsV4(packets);
				this.metrics.recordDownload(Buffer.byteLength(JSON.stringify(resp)), false);
			}
			this.lastUploadedSeq = this.events.length;
		}
	}
}

// -----------------------------------------------------------------------------
// BENCHMARK SERVER IMPLEMENTATION
// -----------------------------------------------------------------------------
class BenchmarkServer {
	constructor() {
		this.eventsV3 = [];
		this.eventsV4 = [];
		this.blobsV4 = new Map();
		this.seqCounterV3 = 0;
		this.seqCounterV4 = 0;
	}

	async postEventsV3(packets) {
		for (const p of packets) {
			if (!this.eventsV3.some((e) => e.id === p.id)) {
				this.eventsV3.push({ ...p, seq: ++this.seqCounterV3 });
			}
		}
		return { ok: true, maxSeq: this.seqCounterV3 };
	}

	async getEventsV3(since) {
		const evs = this.eventsV3.filter((e) => e.seq > since);
		return { events: evs, maxSeq: this.seqCounterV3 };
	}

	async postEventsV4(packets) {
		for (const p of packets) {
			if (!this.eventsV4.some((e) => e.id === p.id)) {
				this.eventsV4.push({ ...p, seq: ++this.seqCounterV4 });
			}
		}
		return { ok: true, maxSeq: this.seqCounterV4 };
	}

	async getEventsV4(since) {
		const evs = this.eventsV4.filter((e) => e.seq > since);
		return { events: evs, maxSeq: this.seqCounterV4 };
	}

	hasBlob(id) {
		return this.blobsV4.has(id);
	}

	async putBlobV4(id, blobData) {
		this.blobsV4.set(id, blobData);
		return { ok: true };
	}
}

// -----------------------------------------------------------------------------
// BENCHMARK SUITE EXECUTION
// -----------------------------------------------------------------------------
export async function runFullBenchmark() {
	const results = [];

	async function compare(name, scenarioFn) {
		const metricsV3 = new MetricsTracker(`${name} (v3)`);
		const metricsV4 = new MetricsTracker(`${name} (v4)`);

		metricsV3.start();
		await scenarioFn("v3", metricsV3);
		metricsV3.stop();

		metricsV4.start();
		await scenarioFn("v4", metricsV4);
		metricsV4.stop();

		results.push({ name, v3: metricsV3.summary(), v4: metricsV4.summary() });
	}

	const syncKey = generateSyncKey();

	// 1. Bulk Event Sync: 100, 1.000, 10.000 lokale Events
	for (const count of [100, 1000, 10000]) {
		await compare(`1. Initial Sync: ${count} Events`, async (version, metrics) => {
			const server = new BenchmarkServer();
			if (version === "v3") {
				const client = new SimulatedV3Client("A", syncKey, metrics);
				await client.init();
				for (let i = 0; i < count; i++) {
					await client.addEvent("pageCreate", { id: `p-${i}`, title: `Note ${i}`, body: "Lorem ipsum dolor sit amet" });
				}
				await client.syncDelta(server);
			} else {
				const client = new SimulatedV4Client("A", syncKey, metrics);
				await client.init();
				for (let i = 0; i < count; i++) {
					await client.addEvent("pageCreate", { id: `p-${i}`, title: `Note ${i}`, body: "Lorem ipsum dolor sit amet" });
				}
				await client.sync(server);
			}
		});
	}

	// 2. 1 einzelne Änderung nach vollständigem Sync (Warm Sync)
	await compare("2. Einzelne Änderung (Warm Sync)", async (version, metrics) => {
		const server = new BenchmarkServer();
		if (version === "v3") {
			const client = new SimulatedV3Client("A", syncKey, metrics);
			await client.init();
			for (let i = 0; i < 50; i++) await client.addEvent("pageCreate", { id: `p-${i}`, title: `N ${i}` });
			await client.syncDelta(server);

			await client.addEvent("pageUpdate", { id: "p-1", patch: { title: "Updated Note 1" } });
			await client.syncDelta(server);
		} else {
			const client = new SimulatedV4Client("A", syncKey, metrics);
			await client.init();
			for (let i = 0; i < 50; i++) await client.addEvent("pageCreate", { id: `p-${i}`, title: `N ${i}` });
			await client.sync(server);

			await client.addEvent("pageUpdate", { id: "p-1", patch: { title: "Updated Note 1" } });
			await client.sync(server);
		}
	});

	// 3. 100 Änderungen auf einmal (Burst Batch)
	await compare("3. 100 Änderungen auf einmal (Burst Batch)", async (version, metrics) => {
		const server = new BenchmarkServer();
		if (version === "v3") {
			const client = new SimulatedV3Client("A", syncKey, metrics);
			await client.init();
			for (let i = 0; i < 100; i++) await client.addEvent("pageUpdate", { id: `p-${i}`, patch: { count: i } });
			await client.syncDelta(server);
		} else {
			const client = new SimulatedV4Client("A", syncKey, metrics);
			await client.init();
			for (let i = 0; i < 100; i++) await client.addEvent("pageUpdate", { id: `p-${i}`, patch: { count: i } });
			await client.sync(server);
		}
	});

	// 4. Heft mit 100 / 1.000 / 10.000 Strichen
	for (const strokeCount of [100, 1000, 10000]) {
		await compare(`4. Heft-Zeichnen: ${strokeCount} Striche`, async (version, metrics) => {
			const server = new BenchmarkServer();
			if (version === "v3") {
				const client = new SimulatedV3Client("A", syncKey, metrics);
				await client.init();
				const currentPages = [{ id: "page-1", strokes: [] }];
				const batches = Math.min(strokeCount, 50);
				const strokesPerBatch = Math.ceil(strokeCount / batches);
				for (let b = 0; b < batches; b++) {
					for (let s = 0; s < strokesPerBatch; s++) {
						currentPages[0].strokes.push({ id: `s-${b}-${s}`, pts: [[s, s], [s + 1, s + 1], [s + 2, s + 2]], color: "#000", size: 2 });
					}
					await client.addEvent("heftSnap", { pageId: "h-1", doc: { pages: JSON.parse(JSON.stringify(currentPages)) } });
				}
				await client.syncDelta(server);
			} else {
				const client = new SimulatedV4Client("A", syncKey, metrics);
				await client.init();
				const batches = Math.min(strokeCount, 50);
				const strokesPerBatch = Math.ceil(strokeCount / batches);
				for (let b = 0; b < batches; b++) {
					const ops = [];
					for (let s = 0; s < strokesPerBatch; s++) {
						ops.push({ t: "s+", p: "page-1", o: { id: `s-${b}-${s}`, pts: [[s, s], [s + 1, s + 1], [s + 2, s + 2]], color: "#000", size: 2 } });
					}
					await client.addEvent("heftOps", { pageId: "h-1", ops });
				}
				await client.sync(server);
			}
		});
	}

	// 5. 10 × 1-MB-Bilder (Attachments & Dedupe)
function makeBinaryBuffer(bytesCount) {
	const buf = new Uint8Array(bytesCount);
	for (let offset = 0; offset < bytesCount; offset += 65536) {
		const chunk = buf.subarray(offset, Math.min(bytesCount, offset + 65536));
		globalThis.crypto.getRandomValues(chunk);
	}
	return buf;
}

	// 5. 10 × 1-MB-Bilder (Attachments & Dedupe)
	await compare("5. 10 × 1-MB-Bilder (Attachments)", async (version, metrics) => {
		const server = new BenchmarkServer();
		const images = Array.from({ length: 10 }, () => makeBinaryBuffer(1024 * 1024));

		if (version === "v3") {
			const client = new SimulatedV3Client("A", syncKey, metrics);
			await client.init();
			for (let i = 0; i < 10; i++) {
				const b64 = Buffer.from(images[i]).toString("base64");
				await client.addEvent("cardCreate", { id: `card-${i}`, front: `Question ${i}`, back: `Answer ${i}`, image: `data:image/webp;base64,${b64}` });
			}
			await client.syncDelta(server);
		} else {
			const client = new SimulatedV4Client("A", syncKey, metrics);
			await client.init();
			for (let i = 0; i < 10; i++) {
				const blobId = await client.addBlob(images[i], "image/webp");
				await client.addEvent("cardCreate", { id: `card-${i}`, front: `Question ${i}`, back: `Answer ${i}`, blobId });
			}
			await client.sync(server);
		}
	});

	// 6. 5-MB-PDF (Großdatei-Upload)
	await compare("6. 5-MB-PDF (Großdatei-Upload)", async (version, metrics) => {
		const server = new BenchmarkServer();
		const pdfBytes = makeBinaryBuffer(5 * 1024 * 1024);

		if (version === "v3") {
			const client = new SimulatedV3Client("A", syncKey, metrics);
			await client.init();
			const b64 = Buffer.from(pdfBytes).toString("base64");
			await client.addEvent("pageCreate", { id: "p-pdf", title: "Document PDF", pdfData: `data:application/pdf;base64,${b64}` });
			await client.syncDelta(server);
		} else {
			const client = new SimulatedV4Client("A", syncKey, metrics);
			await client.init();
			const blobId = await client.addBlob(pdfBytes, "application/pdf");
			await client.addEvent("pageCreate", { id: "p-pdf", title: "Document PDF", pdfBlobId: blobId });
			await client.sync(server);
		}
	});

	// 7. Zwei Geräte mit parallelen Änderungen
	await compare("7. Zwei Geräte mit parallelen Änderungen", async (version, metrics) => {
		const server = new BenchmarkServer();
		if (version === "v3") {
			const clientA = new SimulatedV3Client("DevA", syncKey, metrics);
			const clientB = new SimulatedV3Client("DevB", syncKey, metrics);
			await clientA.init();
			await clientB.init();

			for (let i = 0; i < 50; i++) await clientA.addEvent("pageCreate", { id: `a-${i}`, title: `A-${i}` });
			for (let i = 0; i < 50; i++) await clientB.addEvent("pageCreate", { id: `b-${i}`, title: `B-${i}` });

			await clientA.syncDelta(server);
			await clientB.syncDelta(server);
			await clientA.syncDelta(server);
		} else {
			const clientA = new SimulatedV4Client("DevA", syncKey, metrics);
			const clientB = new SimulatedV4Client("DevB", syncKey, metrics);
			await clientA.init();
			await clientB.init();

			for (let i = 0; i < 50; i++) await clientA.addEvent("pageCreate", { id: `a-${i}`, title: `A-${i}` });
			for (let i = 0; i < 50; i++) await clientB.addEvent("pageCreate", { id: `b-${i}`, title: `B-${i}` });

			await clientA.sync(server);
			await clientB.sync(server);
			await clientA.sync(server);
		}
	});

	// 8. Kalter Komplettsync
	await compare("8. Kalter Komplettsync (500 Events Download)", async (version, metrics) => {
		const server = new BenchmarkServer();
		const dummyMetrics = new MetricsTracker("init");
		if (version === "v3") {
			const seed = new SimulatedV3Client("Seed", syncKey, dummyMetrics);
			await seed.init();
			for (let i = 0; i < 500; i++) await seed.addEvent("pageCreate", { id: `p-${i}`, title: `Note ${i}` });
			await seed.syncDelta(server);

			const client2 = new SimulatedV3Client("Dev2", syncKey, metrics);
			await client2.init();
			await client2.syncDelta(server);
		} else {
			const seed = new SimulatedV4Client("Seed", syncKey, dummyMetrics);
			await seed.init();
			for (let i = 0; i < 500; i++) await seed.addEvent("pageCreate", { id: `p-${i}`, title: `Note ${i}` });
			await seed.sync(server);

			const client2 = new SimulatedV4Client("Dev2", syncKey, metrics);
			await client2.init();
			await client2.sync(server);
		}
	});

	// 9. Warmer Delta-Sync
	await compare("9. Warmer No-Op Sync (0 neue Events)", async (version, metrics) => {
		const server = new BenchmarkServer();
		const dummyMetrics = new MetricsTracker("init");
		if (version === "v3") {
			const client = new SimulatedV3Client("A", syncKey, dummyMetrics);
			await client.init();
			for (let i = 0; i < 100; i++) await client.addEvent("pageCreate", { id: `p-${i}`, title: `Note ${i}` });
			await client.syncDelta(server);

			client.metrics = metrics;
			await client.syncDelta(server);
		} else {
			const client = new SimulatedV4Client("A", syncKey, dummyMetrics);
			await client.init();
			for (let i = 0; i < 100; i++) await client.addEvent("pageCreate", { id: `p-${i}`, title: `Note ${i}` });
			await client.sync(server);

			client.metrics = metrics;
			await client.sync(server);
		}
	});

	return results;
}

// -----------------------------------------------------------------------------
// HOTSPOT PROFILE BENCHMARKS
// -----------------------------------------------------------------------------
export async function runHotspotBenchmarks() {
	const hotspotA = [];
	for (const count of [100, 1000, 10000, 50000]) {
		const localEvents = [];
		for (let i = 1; i <= count; i++) {
			localEvents.push({ seq: i, id: `e-${i}`, type: "pageUpdate", payload: { id: `p-${i % 50}` } });
		}
		const incomingEvents = [
			{ id: "e-1" },
			{ id: "e-2" },
			{ id: `e-${Math.floor(count / 2)}` },
		];

		const startCpu = process.cpuUsage();
		const t0 = performance.now();

		const serverEventIds = new Set(incomingEvents.map((e) => e.id));
		let confirmedCursor = 0;
		for (const ev of localEvents) {
			if (ev.seq <= confirmedCursor) continue;
			if (serverEventIds.has(ev.id)) {
				confirmedCursor = ev.seq;
			} else {
				break;
			}
		}

		const t1 = performance.now();
		const cpu = process.cpuUsage(startCpu);
		hotspotA.push({
			"Lokale Events": count,
			"Dauer (ms)": Math.round((t1 - t0) * 1000) / 1000,
			"CPU Zeit (ms)": Math.round(((cpu.user + cpu.system) / 1000) * 1000) / 1000,
		});
	}

	const hotspotB = [];
	for (const count of [10, 100, 1000, 5000]) {
		const remoteBlobKeys = Array.from({ length: count }, (_, i) => `blob-${i}`);
		const localNeededKeys = new Set(Array.from({ length: 50 }, (_, i) => `blob-${i * 2}`));

		const startCpu = process.cpuUsage();
		const t0 = performance.now();

		const remoteSet = new Set(remoteBlobKeys);
		const missingLocally = [];
		for (const k of remoteBlobKeys) {
			if (!localNeededKeys.has(k)) missingLocally.push(k);
		}

		const t1 = performance.now();
		const cpu = process.cpuUsage(startCpu);
		hotspotB.push({
			"Blobs im Remote Store": count,
			"Dauer (ms)": Math.round((t1 - t0) * 1000) / 1000,
			"CPU Zeit (ms)": Math.round(((cpu.user + cpu.system) / 1000) * 1000) / 1000,
		});
	}

	return { hotspotA, hotspotB };
}

// -----------------------------------------------------------------------------
// CLI RUNNER
// -----------------------------------------------------------------------------
async function main() {
	console.log("================================================================================");
	console.log("           IMPALA67 SYNC BENCHMARK: V3 (LEGACY) VS V4 (CURRENT)");
	console.log("================================================================================\n");

	const results = await runFullBenchmark();

	function fmtBytes(b) {
		if (b < 1024) return `${b} B`;
		if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
		return `${(b / (1024 * 1024)).toFixed(2)} MB`;
	}

	function fmtTime(ms) {
		if (ms < 1000) return `${ms.toFixed(0)} ms`;
		return `${(ms / 1000).toFixed(2)} s`;
	}

	console.log("SZENARIEN-ÜBERSICHT:");
	console.log("--------------------------------------------------------------------------------");
	for (const r of results) {
		const timeFactor = (r.v3.durationMs / Math.max(1, r.v4.durationMs)).toFixed(1);
		const byteFactor = (r.v3.totalBytes / Math.max(1, r.v4.totalBytes)).toFixed(1);
		const reqDiff = `${r.v3.requests} -> ${r.v4.requests}`;
		console.log(`\n📌 ${r.name}`);
		console.log(`   v3 (Legacy):  ${fmtTime(r.v3.durationMs).padEnd(10)} | ${String(r.v3.requests).padStart(3)} HTTP Reqs | ${fmtBytes(r.v3.totalBytes).padEnd(10)} Wire Bytes | ${r.v3.cpuMs} ms CPU`);
		console.log(`   v4 (Current): ${fmtTime(r.v4.durationMs).padEnd(10)} | ${String(r.v4.requests).padStart(3)} HTTP Reqs | ${fmtBytes(r.v4.totalBytes).padEnd(10)} Wire Bytes | ${r.v4.cpuMs} ms CPU`);
		console.log(`   👉 Vorteil:   ${timeFactor}x schneller | ${byteFactor}x weniger Daten | Reqs: ${reqDiff}`);
	}

	console.log("\n================================================================================");
	console.log("HOTSPOT PROFILING");
	console.log("================================================================================");

	const { hotspotA, hotspotB } = await runHotspotBenchmarks();

	console.log("\n[Hotspot A] importRemote() Prefix-Scan CPU-Zeit & Dauer:");
	console.table(hotspotA);

	console.log("\n[Hotspot B] Remote Blob Inventory Listing & In-Memory Matching:");
	console.table(hotspotB);
}

main().catch(console.error);
