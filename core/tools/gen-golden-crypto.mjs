// Golden-Files für impala-crypto (core/impala-crypto/tests/golden/crypto.json), erzeugt mit dem
// JS-Original web/sync-crypto.js (WebCrypto + CompressionStream aus Node).
// Zufall (IVs, Schlüssel) ist ein Byte-Zähler wie CounterRandom in Rust.
//   node core/tools/gen-golden-crypto.mjs          schreibt die Golden-Files
//   node core/tools/gen-golden-crypto.mjs --check  prüft, ob JS liest, was Rust geschrieben hat
//                                                  (core/target/tmp/crypto-from-rust.json, entsteht
//                                                  bei cargo test -p impala-crypto)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
let counter = 0;
Object.defineProperty(globalThis.crypto, "getRandomValues", {
	configurable: true,
	value: (a) => { for (let i = 0; i < a.length; i++) a[i] = counter++ & 0xff; return a; },
});
const C = await import("../../web/sync-crypto.js");
const enc = new TextEncoder();
const b64 = (bytes) => C.bytesToBase64(bytes);

if (process.argv.includes("--check")) {
	const file = path.join(here, "../target/tmp/crypto-from-rust.json");
	const out = JSON.parse(fs.readFileSync(file, "utf8"));
	const { cryptoKey } = await C.deriveSyncCredentials(out.syncKey);
	for (const p of out.packets) {
		const value = await C.decryptPayload(cryptoKey, p);
		if (JSON.stringify(value) !== p.json) throw new Error("Paket von Rust falsch gelesen: " + p.json.slice(0, 40));
	}
	for (const b of out.blobs) {
		const r = await C.decryptBlobRecord(cryptoKey, b.iv, C.base64ToBytes(b.bytes));
		if (r.id !== b.id || JSON.stringify(r.meta) !== JSON.stringify(b.meta) || b64(new Uint8Array(r.buf)) !== b.data) throw new Error("Blob von Rust falsch gelesen: " + b.id);
	}
	for (const g of out.gzip) {
		const text = new TextDecoder().decode(await C.gunzip(C.base64ToBytes(g.gz)));
		if (text !== g.text) throw new Error("gzip von Rust falsch gelesen");
	}
	console.log(`JS liest Rust: ${out.packets.length} Pakete, ${out.blobs.length} Blobs, ${out.gzip.length} gzip – ok`);
	process.exit(0);
}

const golden = {};

// Kodierungen
const byteCases = [[], [0], [255, 254], [1, 2, 3], [0, 1, 2, 3, 4, 250, 251, 252, 253, 254, 255], Array.from({ length: 70 }, (_, i) => (i * 37) & 255)];
golden.encoding = byteCases.map((bytes) => ({ bytes, base64: b64(new Uint8Array(bytes)), hex: C.bytesToHex(new Uint8Array(bytes)) }));
golden.sha256 = [];
for (const text of ["", "impala67", "äöü € 😀", "x".repeat(1000)]) golden.sha256.push({ text, hex: await C.sha256Hex(text) });

// Schlüssel: Rohschlüssel per deriveBits (gleiche Parameter); dass er dem echten cryptoKey
// entspricht, belegen die Pakete unten (verschlüsselt mit dem echten Schlüssel).
const syncKeys = ["impala-0123-4567-89ab-cdef-0011-2233-4455-6677", "  IMPALA-ABCD-ef01-2345-6789-abcd-ef01-2345-6789\n"];
golden.keys = [];
for (const syncKey of syncKeys) {
	const clean = syncKey.trim();
	const creds = await C.deriveSyncCredentials(syncKey);
	const salt = await crypto.subtle.digest("SHA-256", enc.encode(`impala67_e2ee_salt:${clean}`));
	const base = await crypto.subtle.importKey("raw", enc.encode(clean), "PBKDF2", false, ["deriveBits"]);
	const raw = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, base, 256);
	golden.keys.push({ syncKey, userId: creds.userId, authToken: creds.authToken, rawKey: C.bytesToHex(raw) });
}
golden.invalidKeys = ["", "impala", "impala-0123-4567-89ab-cdef-0011-2233-4455", "impala-0123-4567-89ab-cdef-0011-2233-4455-667g",
	"impala-0123-4567-89ab-cdef-0011-2233-4455-6677-8899", "impala_0123-4567-89ab-cdef-0011-2233-4455-6677", "xmpala-0123-4567-89ab-cdef-0011-2233-4455-6677"];
for (const k of golden.invalidKeys) {
	if (await C.deriveSyncCredentials(k).then(() => true, () => false)) throw new Error("JS nimmt ungültigen Schlüssel an: " + k);
}
counter = 7;
golden.generatedKey = { counterStart: 7, key: C.generateSyncKey() };

// Pakete mit dem echten Schlüssel von syncKeys[0].
const { cryptoKey } = await C.deriveSyncCredentials(syncKeys[0]);
let seed = 1;
const noise = (n) => Array.from({ length: n }, () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return String.fromCharCode(33 + (seed % 90)); }).join("");
const values = [
	{ v: 4, events: [] },
	{ v: 4, events: [{ id: "e1", t: "2026-01-01T00:00:00.000Z", type: "pageUpdate", payload: { id: "p", patch: { content: "äöü € 😀\n\t\"" } } }] },
	{ v: 4, events: [{ id: "e2", n: [0.1, 1e21, -0, 1e-7, 123456789.125], s: "x".repeat(20000) }] }, // gzip lohnt
	{ v: 4, events: [{ id: "e3", s: noise(17000) }] }, // ≥ 16 KB, gzip aber kaum kleiner? JS entscheidet
	"nur ein Text",
];
golden.packets = [];
for (const [i, value] of values.entries()) {
	counter = 100 + i * 20;
	const start = counter;
	const packet = await C.encryptPayload(cryptoKey, value);
	golden.packets.push({ counterStart: start, json: JSON.stringify(value), ...packet });
	const back = await C.decryptPayload(cryptoKey, packet);
	if (JSON.stringify(back) !== JSON.stringify(value)) throw new Error("JS-Roundtrip kaputt");
}

// Blobs
const blobs = [
	{ id: "img:3f2504e0-4f89-11d3-9a0c-0305e82c3301", record: { buf: new Uint8Array([137, 80, 78, 71, 0, 1, 2, 255]).buffer, meta: { name: "Bild.png", type: "image/png", size: 8 } } },
	{ id: "file:ä", record: { data: new Uint8Array(3000).map((_, i) => i * 7) } },
	{ id: "pdftext:x", record: { buf: new Uint8Array([]).buffer, meta: null } },
];
golden.blobs = [];
for (const [i, { id, record }] of blobs.entries()) {
	counter = 200 + i * 20;
	const start = counter;
	const out = await C.encryptBlobRecord(cryptoKey, id, record);
	const back = await C.decryptBlobRecord(cryptoKey, out.iv, out.bytes);
	golden.blobs.push({ counterStart: start, id, meta: back.meta, data: b64(new Uint8Array(back.buf)), iv: out.iv, bytes: b64(out.bytes), size: out.size });
}

// gzip aus JS (Rust muss es lesen)
golden.gzip = [];
for (const text of ["", "hallo", "äöü ".repeat(5000)]) golden.gzip.push({ text, gz: b64(await C.gzip(enc.encode(text))) });

// Speicheranzeige
const usage = [[0], [250000], [50000], [1450000], [999999999], [1e9 + 1], [5e8, 2e9], [123456789, 0], [12, "abc"], [-5, 0.5], ["7", "100"], [null, null], [1e21], [149999, 1e6], [2500000, 5e6]];
// Eingaben als Number(x) (NaN → null), die Rust-API nimmt Zahlen.
const num = (x) => (Number.isNaN(Number(x)) ? null : Number(x));
golden.usage = usage.map(([bytes, limit]) => ({ input: [num(bytes), limit === undefined ? null : num(limit)], out: C.formatStorageUsage(bytes, limit) }));

const dir = path.join(here, "../impala-crypto/tests/golden");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "crypto.json"), JSON.stringify(golden, null, 1) + "\n");
console.log(`crypto.json: ${golden.packets.length} Pakete (${golden.packets.filter((p) => p.data.startsWith("gz:")).length} gzip), ${golden.blobs.length} Blobs, ${golden.usage.length} Quota-Fälle`);
