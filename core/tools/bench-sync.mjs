// Misst die JS-Version der Upload-Strecke auf einem großen Log: Kompaktierung, Wire-Aufbereitung
// + Chunking, Paketbau (SHA-256-ID + gzip + AES-GCM). Schreibt dieselben Eingaben nach
// core/target/bench/sync-input.json für die Rust-Messung:
//   node core/tools/bench-sync.mjs [Events] [Inhaltsgröße]
//   cargo run -p impala-sync --example bench --profile native
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compactEvents } from "../../web/compact-events.js";
import { chunkCloudEvents, cloudEventsEnvelope, prepareCloudEvents } from "../../web/sync-core.js";
import { deriveSyncCredentials, encryptPayload, sha256Hex } from "../../web/sync-crypto.js";
import { sampleLog } from "./sample-log.mjs";

const [n = 20_000, size = 1000] = process.argv.slice(2).map(Number);
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "../target/bench");
fs.mkdirSync(out, { recursive: true });
const events = JSON.parse(JSON.stringify(sampleLog(42, n, { contentSize: size })));
fs.writeFileSync(path.join(out, "sync-input.json"), JSON.stringify(events));
const { cryptoKey } = await deriveSyncCredentials("impala-0123-4567-89ab-cdef-0011-2233-4455-6677");

const median = async (fn) => {
	const ms = [];
	for (let i = 0; i < 7; i++) { const t0 = performance.now(); await fn(); ms.push(performance.now() - t0); }
	return ms.sort((a, b) => a - b)[3];
};
let kept, chunks;
const compact = () => { kept = compactEvents(events); };
const prepare = () => { chunks = chunkCloudEvents(prepareCloudEvents(kept, { includeRemote: true })); };
const pack = async () => {
	for (const chunk of chunks) {
		const id = `p-${await sha256Hex(chunk.map((e) => e.id).join("\n"))}`;
		await encryptPayload(cryptoKey, cloudEventsEnvelope(chunk));
		void id;
	}
};
compact(); prepare(); await pack(); // Aufwärmen
const t = { compact: await median(compact), prepare: await median(prepare), pack: await median(pack) };
const mb = (Buffer.byteLength(JSON.stringify(events)) / 1e6).toFixed(1);
console.log(`JS: ${n} Events (${mb} MB), ${kept.length} behalten, ${chunks.length} Pakete`);
console.log(`  Kompaktierung ${t.compact.toFixed(1)} ms, Aufbereitung+Chunking ${t.prepare.toFixed(1)} ms, Paketbau ${t.pack.toFixed(1)} ms, gesamt ${(t.compact + t.prepare + t.pack).toFixed(1)} ms (Median aus 7)`);
