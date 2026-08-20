import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import {
	cloudEventsEnvelope,
	prepareCloudEvents,
	pruneEventsForUpload,
} from "../web/sync-core.js";

import {
	deriveSyncCredentials,
	generateSyncKey,
	sha256Hex,
} from "../web/sync-crypto.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

function bytesToBase64(value) {
	const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
	let out = "";
	for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(out);
}

function bytesToHex(value) {
	return [...(value instanceof Uint8Array ? value : new Uint8Array(value))]
		.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function gzip(bytes) {
	if (typeof CompressionStream !== "function") return null;
	return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
}

async function encryptPayloadCustom(cryptoKey, value, gzipThreshold) {
	if (!cryptoKey) throw new Error("Kein Verschlüsselungsschlüssel vorhanden.");
	const raw = enc.encode(JSON.stringify(value));
	let bytes = raw, prefix = "";
	if (raw.byteLength >= gzipThreshold) {
		const packed = await gzip(raw);
		if (packed && packed.byteLength < raw.byteLength) { bytes = packed; prefix = "gz:"; }
	}
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, bytes));
	return { iv: bytesToHex(iv), data: prefix + bytesToBase64(ciphertext), size: ciphertext.byteLength + iv.byteLength };
}

function chunkEventsCustom(events, maxEvents = 250, maxJsonChars = 1_000_000) {
	const out = [];
	let chunk = [], chars = 0;
	for (const event of events || []) {
		const n = JSON.stringify(event).length + 1;
		if (chunk.length && (chunk.length >= maxEvents || chars + n > maxJsonChars)) {
			out.push(chunk); chunk = []; chars = 0;
		}
		chunk.push(event); chars += n;
	}
	if (chunk.length) out.push(chunk);
	return out;
}

function calcHttpPosts(packets, maxPackets = 20, maxChars = 6_000_000) {
	let posts = 0;
	for (let i = 0; i < packets.length;) {
		let count = 0;
		let chars = 0;
		while (i < packets.length && count < maxPackets) {
			const packet = packets[i];
			const n = String(packet?.id || "").length + String(packet?.iv || "").length + String(packet?.data || "").length + 64;
			if (count && chars + n > maxChars) break;
			chars += n;
			count++;
			i++;
		}
		posts++;
	}
	return posts;
}

// -----------------------------------------------------------------------------
// REALISTIC EVENT DATA GENERATOR
// -----------------------------------------------------------------------------
function generateRealisticEvents(count) {
	const titles = [
		"Einkaufsliste", "Projektnotizen Impala67", "Mathematik Übungen", "Meeting Notizen",
		"Ideen für Blogpost", "Zusammenfassung Kapitel 4", "Wichtige Passwörter & Tokens (redacted)",
		"Reiseplanung Italien 2026", "Lernkartei Biologie", "Tagebucheintrag",
	];
	const sampleParagraphs = [
		"Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
		"Hier ist eine detaillierte Aufzählung:\n- Punkt 1: Erste Anforderungen definieren\n- Punkt 2: Architektur aufsetzen\n- Punkt 3: Tests schreiben und validieren",
		"```javascript\nfunction helloWorld() {\n  console.log('Impala67 Sync v4');\n}\n```\nDies ist ein Code-Snippet.",
		"Wichtige Notiz: Bitte bis morgen die Cloudflare D1 und R2 Bereinigung abschließen.",
	];

	const events = [];
	for (let i = 1; i <= count; i++) {
		const title = `${titles[i % titles.length]} #${i}`;
		const numParas = 1 + (i % 4);
		const content = Array.from({ length: numParas }, (_, p) => sampleParagraphs[(i + p) % sampleParagraphs.length]).join("\n\n");
		events.push({
			seq: i,
			id: `real-ev-${i}`,
			t: new Date(Date.now() + i * 1000).toISOString(),
			type: "pageCreate",
			payload: {
				id: `pg-${i}`,
				title,
				content,
				tags: [`tag-${i % 5}`, `workspace-${i % 3}`],
				folderId: i % 10 === 0 ? `folder-${i / 10}` : null,
			},
		});
	}
	return events;
}

// -----------------------------------------------------------------------------
// BENCHMARK VARIANTS RUNNER
// -----------------------------------------------------------------------------
const VARIANTS = [
	{ name: "A: maxEvents=250, gzip>=64KB (aktuell)", maxEvents: 250, gzipAt: 64 * 1024 },
	{ name: "B: maxEvents=250, gzip>=32KB", maxEvents: 250, gzipAt: 32 * 1024 },
	{ name: "C: maxEvents=250, gzip>=16KB", maxEvents: 250, gzipAt: 16 * 1024 },
	{ name: "D: maxEvents=500, gzip>=64KB", maxEvents: 500, gzipAt: 64 * 1024 },
	{ name: "E: maxEvents=500, gzip>=32KB", maxEvents: 500, gzipAt: 32 * 1024 },
];

async function runVariantTest(variant, events, iterations = 20, discard = 5) {
	const syncKey = generateSyncKey();
	const creds = await deriveSyncCredentials(syncKey);
	const wireEvents = prepareCloudEvents(pruneEventsForUpload(events));

	const durations = [];
	const cpuTimes = [];
	let packetsCount = 0;
	let totalWireBytes = 0;
	let httpPostCount = 0;

	for (let it = 0; it < iterations; it++) {
		const startCpu = process.cpuUsage();
		const t0 = performance.now();

		const chunks = chunkEventsCustom(wireEvents, variant.maxEvents);
		const packets = [];
		for (const chunk of chunks) {
			const id = `p-${await sha256Hex(chunk.map((e) => e.id).join("\n"))}`;
			const enc = await encryptPayloadCustom(creds.cryptoKey, cloudEventsEnvelope(chunk), variant.gzipAt);
			packets.push({ id, ...enc });
		}

		const wireJson = JSON.stringify({ events: packets });
		const wireBytes = Buffer.byteLength(wireJson);
		const posts = calcHttpPosts(packets);

		const t1 = performance.now();
		const cpu = process.cpuUsage(startCpu);

		durations.push(t1 - t0);
		cpuTimes.push((cpu.user + cpu.system) / 1000);
		packetsCount = packets.length;
		totalWireBytes = wireBytes;
		httpPostCount = posts;
	}

	const validDur = durations.slice(discard).sort((a, b) => a - b);
	const validCpu = cpuTimes.slice(discard).sort((a, b) => a - b);
	const mid = Math.floor(validDur.length / 2);
	const p95Idx = Math.min(validDur.length - 1, Math.floor(validDur.length * 0.95));

	return {
		name: variant.name,
		medianDur: Math.round(validDur[mid] * 100) / 100,
		p95Dur: Math.round(validDur[p95Idx] * 100) / 100,
		medianCpu: Math.round(validCpu[mid] * 100) / 100,
		p95Cpu: Math.round(validCpu[p95Idx] * 100) / 100,
		packets: packetsCount,
		wireBytes: totalWireBytes,
		httpPosts: httpPostCount,
	};
}

async function main() {
	console.log("================================================================================");
	console.log("   V4 KOMPRESSIONS- & CHUNK-VARIANTEN BENCHMARK (20 Runs, 5 Warmup verworfen)");
	console.log("================================================================================\n");

	const workloads = [
		{ label: "100 Events (synthetisch)", count: 100, realistic: false },
		{ label: "1.000 Events (synthetisch)", count: 1000, realistic: false },
		{ label: "10.000 Events (synthetisch)", count: 10000, realistic: false },
		{ label: "100 Delta-Events (realistische Notizen)", count: 100, realistic: true },
		{ label: "1.000 Events (realistische Notizen)", count: 1000, realistic: true },
		{ label: "10.000 Events (realistische Notizen)", count: 10000, realistic: true },
	];

	function fmtBytes(b) {
		if (b < 1024) return `${b} B`;
		if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
		return `${(b / (1024 * 1024)).toFixed(2)} MB`;
	}

	for (const wl of workloads) {
		console.log(`\n📊 WORKLOAD: ${wl.label}`);
		console.log("--------------------------------------------------------------------------------");
		const events = wl.realistic
			? generateRealisticEvents(wl.count)
			: Array.from({ length: wl.count }, (_, i) => ({
				seq: i + 1,
				id: `ev-${i + 1}`,
				t: new Date().toISOString(),
				type: "pageCreate",
				payload: { id: `p-${i + 1}`, title: `Note ${i + 1}`, content: "Standard note content." },
			}));

		const tableData = [];
		for (const variant of VARIANTS) {
			const res = await runVariantTest(variant, events);
			tableData.push({
				Variante: res.name,
				"Dauer Median": `${res.medianDur} ms`,
				"Dauer p95": `${res.p95Dur} ms`,
				"CPU Median": `${res.medianCpu} ms`,
				"Wire Bytes": fmtBytes(res.wireBytes),
				Pakete: res.packets,
				"HTTP POSTs": res.httpPosts,
			});
		}
		console.table(tableData);
	}
}

main().catch(console.error);
