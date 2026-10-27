// Schreibt die Golden-Files für `cargo test -p impala-sync` aus den JS-Originalen:
// - tests/golden/compact/*.json: Event-Liste plus die Indizes, die web/compact-events.js behält.
// - tests/golden/protocol.json: Wire-Format, Chunk-Grenzen, verschlüsselte Pakete (fester
//   Schlüssel, IVs aus einem Byte-Zähler wie CounterRandom), Blob-Regeln, Worker-Auswertung.
// Neu erzeugen nur, wenn sich das JS-Verhalten bewusst ändert: node core/tools/gen-golden-sync.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compactEvents } from "../../web/compact-events.js";
import { sampleLog } from "./sample-log.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../impala-sync/tests/golden");
const dir = path.join(root, "compact");
fs.mkdirSync(dir, { recursive: true });

const t = (h) => `2026-03-01T${String(h).padStart(2, "0")}:00:00.000Z`;
// Handverlesene Grenzfälle, jeder mit Kommentar im Event-Feld `why`.
const edge = [
	{ why: "Inhalt älter als Löschung: fällt", t: t(1), seq: 1, type: "pageUpdate", payload: { id: "a", patch: { content: "x" } } },
	{ why: "gleiche Zeit wie Löschung: fällt (<=)", t: t(2), seq: 2, type: "pageUpdate", payload: { id: "a", patch: { title: "y" } } },
	{ why: "Löschung", t: t(2), seq: 3, type: "pageDelete", payload: { id: "a" } },
	{ why: "nach Löschung: bleibt", t: t(3), seq: 4, type: "pageUpdate", payload: { id: "a", patch: { title: "z" } } },
	{ why: "Löschung mit leerem t zählt nicht", t: "", seq: 5, type: "cardDelete", payload: { id: "k" } },
	{ why: "Karte bleibt", t: t(1), seq: 6, type: "cardUpdate", payload: { id: "k", patch: { front: "f" } } },
	{ why: "von neuerem überdeckt", t: t(4), seq: 7, type: "cardUpdate", payload: { id: "k", patch: { front: "g" } } },
	{ why: "leerer Patch bleibt", t: t(5), seq: 8, type: "cardUpdate", payload: { id: "k", patch: {} } },
	{ why: "neuester", t: t(6), seq: 9, type: "cardUpdate", payload: { id: "k", patch: { front: "h", back: "b" } } },
	{ why: "ohne patch bleibt", t: t(6), seq: 10, type: "pageUpdate", payload: { id: "b" } },
	{ why: "ohne payload bleibt", t: t(6), seq: 11, type: "pageUpdate", payload: null },
	{ why: "settings überdeckt", t: t(1), seq: 12, type: "settingsSet", payload: { theme: "dark" } },
	{ why: "settings bleibt", t: t(2), seq: 13, type: "settingsSet", payload: { theme: "light", font: 12 } },
	{ why: "settings leer bleibt", t: t(3), seq: 14, type: "settingsSet", payload: null },
	{ why: "Tabs alt", t: t(1), seq: 15, type: "uiTabsSet", payload: { tabs: ["a"] } },
	{ why: "Tabs neu", t: t(2), seq: 16, type: "uiTabsSet" },
	{ why: "Baum ohne key fällt", t: t(2), seq: 17, type: "uiTreeSet", payload: { open: true } },
	{ why: "Baum leerer key ist ein key", t: t(2), seq: 18, type: "uiTreeSet", payload: { key: "" } },
	{ why: "Chat-Gleichstand: späteres gewinnt", t: t(1), seq: 19, type: "chatUpsert", payload: { id: "c", updated: t(9) } },
	{ why: "Chat-Gleichstand: späteres gewinnt", t: t(2), seq: 20, type: "chatUpsert", payload: { id: "c", updated: t(9) } },
	{ why: "Chat ohne updated nimmt t", t: t(10), seq: 21, type: "chatUpsert", payload: { id: "d" } },
	{ why: "Chat älteres updated verliert", t: t(11), seq: 22, type: "chatUpsert", payload: { id: "d", updated: t(1) } },
	{ why: "Chat ohne id bleibt", t: t(11), seq: 23, type: "chatUpsert", payload: { id: "" } },
	{ why: "Artikel ohne id fällt", t: t(11), seq: 24, type: "homeArticleUpsert", payload: {} },
	{ why: "Bild referenziert", t: t(1), seq: 25, type: "heftBlob", payload: { hash: "H1" } },
	{ why: "Bild nicht referenziert", t: t(1), seq: 26, type: "heftBlob", payload: { hash: "H2" } },
	{ why: "Bild ohne Hash", t: t(1), seq: 27, type: "heftBlob", payload: {} },
	{ why: "Ops mit null und Strings", t: t(2), seq: 28, type: "heftOps", payload: { ops: [null, { o: "s" }, { o: { ref: "H1" } }, { o: { ref: "" } }] } },
	{ why: "Snap mit falsy Seite", t: t(2), seq: 29, type: "heftSnap", payload: { doc: { pages: [0, { images: [null, { ref: "H3" }] }, {}] } } },
	{ why: "Bild aus Snap", t: t(1), seq: 30, type: "heftBlob", payload: { hash: "H3" } },
	{ why: "gleiches t, seq entscheidet", t: t(7), seq: 32, type: "settingsSet", payload: { a: 1 } },
	{ why: "gleiches t, seq entscheidet", t: t(7), seq: 31, type: "settingsSet", payload: { a: 2 } },
	{ why: "ohne seq zählt als 0", t: t(7), type: "settingsSet", payload: { b: 1 } },
	{ why: "unbekannter Typ bleibt", t: t(7), seq: 33, type: "teleEvent", payload: "kein Objekt" },
	{ why: "ohne Typ bleibt", t: t(7), seq: 34 },
	...Array.from({ length: 12 }, (_, i) => ({ why: "Verlaufs-Schutz: 10 Inhalte bleiben", t: t(12 + i), seq: 40 + i, type: "pageUpdate", payload: { id: "v", patch: { content: "v" + i } } })),
	...Array.from({ length: 34 }, (_, i) => ({ why: "nur 30 neueste Artikel (Gleichstand: Reihenfolge)", t: t(i % 24), seq: 60 + i, type: "homeArticleUpsert", payload: { id: "art" + i, created: i < 6 ? t(1) : "2026-02-" + String(1 + (i % 27)).padStart(2, "0") } })),
];

const cases = { "edge-cases": edge };
for (const [name, seed, n, size] of [["small-1", 1, 60, 20], ["small-2", 2, 150, 20], ["medium-3", 3, 800, 30], ["medium-4", 4, 1500, 30], ["large-5", 5, 2500, 8]]) {
	cases[name] = sampleLog(seed, n, { contentSize: size });
}
for (const [name, list] of Object.entries(cases)) {
	const events = JSON.parse(JSON.stringify(list)); // genau das, was Rust liest
	const index = new Map(events.map((ev, i) => [ev, i]));
	const kept = compactEvents(events).map((ev) => index.get(ev));
	const body = "{\n\"kept\": " + JSON.stringify(kept) + ",\n\"events\": [\n" + events.map((ev) => JSON.stringify(ev)).join(",\n") + "\n]}\n";
	fs.writeFileSync(path.join(dir, name + ".json"), body);
	console.log(`${name}: ${events.length} Events, ${kept.length} behalten`);
}

// ---------------------------------------------------------------------------
// Protokoll v4 (web/sync-core.js, sync-crypto.js, sync-transfer.js, sync-cloudflare.js, sync-maintenance.js)

let counter = 0;
Object.defineProperty(globalThis.crypto, "getRandomValues", {
	configurable: true,
	value: (a) => { for (let i = 0; i < a.length; i++) a[i] = counter++ & 0xff; return a; },
});
const core = await import("../../web/sync-core.js");
const C = await import("../../web/sync-crypto.js");
const transfer = await import("../../web/sync-transfer.js");
const { acknowledgedUploadCursor } = await import("../../web/sync-cloudflare.js");
const { shouldCompactCloud } = await import("../../web/sync-maintenance.js");
const roundtrip = (v) => JSON.parse(JSON.stringify(v));
const P = {};

// Wire-Aufbereitung: lokale Metadaten weg, Cloudflare-Echo weg (außer includeRemote).
const wireInput = roundtrip([
	...sampleLog(7, 60, { contentSize: 20 }),
	{ id: "m1", seq: 9, _remote: true, _remoteSource: "cloudflare", _derived: true, t: "x", type: "pageUpdate", payload: { seq: 1, _remote: 2 } },
	{ id: "m2", _remoteSource: "drive", t: "y", type: "uiTreeSet", payload: { key: "k" } },
	{ "2": "zwei", b: 1, "1": "eins", _derived: false, t: "z", type: "teleEvent" },
	{ id: "m3", t: "ä😀\u0001\"\\", n: [0.1, 1e21, 1e-7, -0, 123456789.5, 2 ** 60], type: "settingsSet", payload: { "a b": null } },
]);
P.prepare = {
	input: wireInput,
	wire: core.prepareCloudEvents(wireInput).map((e) => JSON.stringify(e)),
	wireWithRemote: core.prepareCloudEvents(wireInput, { includeRemote: true }).map((e) => JSON.stringify(e)),
	pruned: core.pruneEventsForUpload(wireInput).map((e) => e.id ?? null),
	echo: wireInput.map((e) => [core.shouldUploadToSync(e, "cloudflare"), core.shouldUploadToSync(e, "drive")]),
};

// Eingehende Envelopes
const incomingCases = [
	[{ v: 4, events: [{ id: "a", t: "1" }, { id: "b", t: "2", nested: { seq: 1 } }] }],
	[{ v: 4, event: { id: "alt" } }, { v: 4, events: [{ id: "c" }] }],
	[{ v: 3, events: [{ id: "a" }] }],
	[{ v: "4", events: [{ id: "a" }] }],
	[{ v: 4, events: [] }],
	[{ v: 4 }],
	[{ v: 4, events: [null] }],
	[{ v: 4, events: [[1]] }],
	[{ v: 4, events: [{ id: "a", seq: 1 }] }],
	[{ v: 4, events: [{ id: "a", _remoteSource: "drive" }] }],
	[null],
];
P.incoming = incomingCases.map((envelopes) => {
	try { return { envelopes, out: core.prepareIncomingCloudEvents(roundtrip(envelopes)).map((e) => JSON.stringify(e)) }; }
	catch (e) { return { envelopes, error: e.message }; }
});

// Chunk-Grenzen nach UTF-8-Bytes und Anzahl
const chunkEvents = core.prepareCloudEvents(roundtrip([
	...sampleLog(8, 120, { contentSize: 60 }),
	...Array.from({ length: 25 }, (_, i) => ({ id: "u" + i, t: "t", payload: "äöü€😀".repeat(i * 5) })),
]));
const chunkOpts = [{}, { maxEvents: 7 }, { maxJsonBytes: 1500 }, { maxEvents: 20, maxJsonBytes: 6000 }, { maxJsonBytes: 1 }, { maxEvents: 0 }];
P.chunks = {
	events: chunkEvents,
	cases: chunkOpts.map((opts) => ({ opts, sizes: core.chunkCloudEvents(chunkEvents, opts).map((c) => c.length) })),
};

// Verschlüsselte Pakete wie push() in web/sync-cloudflare.js (dort nicht exportiert, Schritte
// hier eins zu eins): Chunk → p-<sha256(IDs)> → encryptPayload(Envelope) → postPackets-Körper.
const syncKey = "impala-0123-4567-89ab-cdef-0011-2233-4455-6677";
const { cryptoKey } = await C.deriveSyncCredentials(syncKey);
const enc = new TextEncoder();
const salt = await crypto.subtle.digest("SHA-256", enc.encode(`impala67_e2ee_salt:${syncKey}`));
const base = await crypto.subtle.importKey("raw", enc.encode(syncKey), "PBKDF2", false, ["deriveBits"]);
P.rawKey = C.bytesToHex(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, base, 256));
const packetWire = core.prepareCloudEvents(roundtrip([
	...sampleLog(9, 150, { contentSize: 120 }),
	{ t: "ohne-id", type: "teleEvent" },
	{ id: 5, t: "zahl", type: "teleEvent" },
	{ id: null, t: "null", type: "teleEvent" },
	{ id: ["a", 1, null], t: "liste", type: "teleEvent" },
	{ id: "groß", t: "x".repeat(40000), type: "pageUpdate" },
]));
const packetLimits = { maxEvents: 250, maxJsonBytes: 12000 };
counter = 0;
const packets = [];
for (const events of core.chunkCloudEvents(packetWire, packetLimits)) {
	const id = `p-${await C.sha256Hex(events.map((event) => event.id).join("\n"))}`;
	packets.push({ id, ...(await C.encryptPayload(cryptoKey, core.cloudEventsEnvelope(events))) });
}
const MAX_HTTP_PACKETS = 20, MAX_HTTP_CHARS = 6_000_000; // wie postPackets()
const bodies = [];
for (let i = 0; i < packets.length;) {
	const parts = [];
	let chars = 0;
	while (i < packets.length && parts.length < MAX_HTTP_PACKETS) {
		const json = JSON.stringify(packets[i]), n = transfer.utf8Length(json) + 1;
		if (parts.length && chars + n > MAX_HTTP_CHARS) break;
		parts.push(json); chars += n; i++;
	}
	bodies.push('{"events":[' + parts.join(",") + "]}");
}
P.packets = {
	limits: packetLimits,
	wire: packetWire,
	packets,
	bodies: await Promise.all(bodies.map(async (b) => ({ bytes: transfer.utf8Length(b), sha256: await C.sha256Hex(b) }))),
};

// Heft-Ausgangsstand (migrateLocalV4)
const heftDocs = {
	h1: { pages: [
		{ id: "pa", paper: "grid", ocrText: "Hallo", strokes: [{ id: "s1", pts: [1, 2] }], images: [{ id: "i1", ref: "r" }], texts: [{ id: "x1", text: "t" }] },
		{ id: "pb", paper: "", strokes: null, images: [] },
		{ paper: "dots", ocrText: "" },
	] },
	h2: { pages: [] },
	h3: { pages: "kaputt" },
	h4: {},
};
P.heft = await Promise.all(Object.entries(heftDocs).map(async ([pageId, doc]) => {
	const ops = core.heftBaselineOps(doc);
	const hash = await C.sha256Hex(JSON.stringify(doc?.pages || []));
	return { pageId, doc, ops: JSON.stringify(ops), id: ops.length ? `v4-heft-${pageId}-${hash.slice(0, 24)}` : null };
}));

// Blob-Regeln
const U1 = "3f2504e0-4f89-11d3-9a0c-0305e82c3301", U2 = "a1b2c3d4-0000-1111-2222-333344445555", U3 = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const blobPages = {
	p1: { content: `![](img:${U1}) und cover:${U2.toUpperCase()} sowie IMG:${U3}`, n: 3, empty: "" },
	p2: { content: "Anhang file:bericht.pdf", coverImg: "cover:bild.png", pdfId: "file:doc.pdf" },
	p3: null,
	heft1: { kind: "heft" },
	p4: { content: `aa${U3}a` },
};
const blobKeys = ["", `img:${U1}`, U1, U1.toUpperCase(), `file:${U1}`, `cover:${U2.toUpperCase()}`, `cover:${U2}`, U2.toUpperCase(), `img:${U3}`, U3,
	`IMG:${U3}`, "file:bericht.pdf", "file:fehlt.pdf", "pdftext:file:doc.pdf", "pdftext:file:x", "cover:bild.png", "heft:heft1", "heft:p3", "heft:nix",
	"bgImage", "heftver:1", "img:", "img:a\0b", "pdftext:", "cover:"];
const alive = core.blobAliveChecker(blobPages);
P.blobs = { pages: blobPages, cases: blobKeys.map((key) => ({ key, alive: alive(key), syncId: core.isSyncBlobId(key) })) };

// Dateien (Drive)
const files = [
	{ id: "1", name: "a", modifiedTime: "2026-01-02T10:00:00.000Z" },
	{ id: "", name: "a", modifiedTime: "2026-03-01T10:00:00.000Z" },
	{ id: "3", name: "b", modifiedTime: "2026-05-01T10:00:00.000Z" },
	{ id: "4", name: "a", modifiedTime: "2026-01-02T10:00:00.000Z" },
	{ id: "5", name: "c" },
	{ id: "6", name: "a", modifiedTime: "2026-01-02T10:00:00Z" },
];
P.files = {
	files,
	unseen: core.unseenRemoteFiles(files, ["1", "4"]).map((f) => f.id),
	newest: [["a"], ["b", "c"], ["c"], ["x"]].map((names) => ({ names, id: core.newestFile(files, names)?.id ?? null })),
	known: [[["a", "b", "a", "c", "d"], 2], [["a", "b", "a", "c", "d"], 0], [["x"], 5]]
		.map(([ids, max]) => ({ ids, max, out: core.boundedKnownIds(ids, max) })),
	// Standardgrenze 2000: IDs k0…k2049, k0…k49 doppelt → die letzten 2000 eindeutigen
	knownDefault: (() => { const out = core.boundedKnownIds(Array.from({ length: 2100 }, (_, i) => "k" + (i % 2050))); return { count: out.length, first: out[0], last: out.at(-1) }; })(),
};

// JSON-Dateien (Drive): JS-gzip muss Rust lesen
const driveValue = { app: "impala67", version: 2, events: sampleLog(3, 30), text: "äöü" };
const packed = await core.encodeJson(driveValue);
P.encodedJson = { value: driveValue, encoding: packed.encoding, b64: C.bytesToBase64(packed.bytes) };

// Worker-Antworten
const ackCases = [
	[{ generation: 2, ack: { fromSeq: 5, toSeq: 7, savedCount: 2 } }, 2, 5],
	[{ generation: 2, ack: { fromSeq: 5, toSeq: 5, savedCount: 0 } }, 2, 5],
	[{ generation: 3, ack: { fromSeq: 5, toSeq: 7, savedCount: 2 } }, 2, 5],
	[{ generation: 2, ack: { fromSeq: 4, toSeq: 7, savedCount: 3 } }, 2, 5],
	[{ generation: 2, ack: { fromSeq: 5, toSeq: 4, savedCount: -1 } }, 2, 5],
	[{ generation: 2, ack: { fromSeq: 5, toSeq: 7, savedCount: 1 } }, 2, 5],
	[{ generation: "2", ack: { fromSeq: "5", toSeq: 7.0, savedCount: 2 } }, 2, 5],
	[{ generation: 2.5, ack: { fromSeq: 5, toSeq: 7, savedCount: 2 } }, 2, 5],
	[{ generation: 2, ack: { fromSeq: 5, toSeq: 7.5, savedCount: 2.5 } }, 2, 5],
	[{ generation: 2 }, 2, 5],
	[{ generation: 2, ack: 0 }, 2, 5],
	[{ generation: 1, ack: { fromSeq: 0, toSeq: 9007199254740992, savedCount: 9007199254740992 } }, 1, 0],
	[{}, 0, 0],
];
P.ack = ackCases.map(([data, generation, seq]) => ({ data, generation, seq, out: acknowledgedUploadCursor(data, generation, seq) }));
const DAY = 86_400_000;
const compactCases = [
	[{ status: "connected", usage: { percent: 85 } }, 0, 8 * DAY, false],
	[{ status: "connected", usage: { percent: 85 } }, 2 * DAY, 8 * DAY, false],
	[{ status: "connected", usage: { percent: 100 } }, 2 * DAY, 8 * DAY, false],
	[{ status: "connected", usage: { percent: 79 } }, 0, 8 * DAY, false],
	[{ status: "connected", usage: {} }, 0, 8 * DAY, false],
	[{ status: "connected" }, 0, 0, true],
	[{ status: "syncing", usage: { percent: 99 } }, 0, 8 * DAY, true],
	[{ status: "connected", usage: { percent: 80 } }, 1 * DAY, 8 * DAY, false],
];
P.compactCloud = compactCases.map(([status, last, now, bypass]) => ({
	connected: status.status === "connected", percent: status.usage?.percent ?? null, last, now, bypass,
	out: shouldCompactCloud(status, last, now, bypass),
}));
P.retry = {
	delays: Array.from({ length: 13 }, (_, i) => transfer.syncRetryDelayMs(i)),
	retryable: [0, 200, 400, 401, 403, 404, 408, 409, 410, 413, 425, 426, 429, 500, 502, 503].map((status) => [status, transfer.isRetryableSyncError({ status })]),
};

fs.writeFileSync(path.join(root, "protocol.json"), JSON.stringify(P) + "\n");
console.log(`protocol.json: ${packets.length} Pakete (${packets.filter((p) => p.data.startsWith("gz:")).length} gzip), ${bodies.length} Upload-Körper, ${P.chunks.cases.length} Chunk-Fälle, ${(fs.statSync(path.join(root, "protocol.json")).size / 1024).toFixed(0)} KB`);
process.exit(0);
