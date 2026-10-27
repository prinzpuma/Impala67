// Schreibt die Golden-Files für `cargo test -p impala-drive` (core/impala-drive/tests/golden/)
// aus dem JS-Original (web/drive.js, drive-sync-policy.js, drive-status.js, backup-status.js,
// settings-action-state.js).
//
// So läuft drive.js in Node: jsdom stellt window/document/localStorage bereit. Ein Lade-Hook
// ersetzt nur db.js und state.js durch Attrappen (IndexedDB gibt es in Node nicht; der Import
// selbst ist Sache von impala-storage). Alles andere lädt unverändert: sync-core.js, util.js,
// settings-sync.js, sync-crypto.js (gzip über CompressionStream). Außerdem:
//  • fetch → nachgebaute Drive-API v3 (Dateien, Listing mit Paginierung, Changes-Token,
//    Multipart-Upload, Download, Löschen, Quota) mit Störungen je Fall; jede Anfrage samt
//    Antwort wird aufgezeichnet (Uploads: Metadaten + Inhalt nach gunzip),
//  • Date → feste Zeit, Math.random → 0.5 (Boundary, Backoff-Jitter), setTimeout ohne Wartezeit
//    (Backoff-Wartezeiten werden mitgeschrieben).
// Neu erzeugen: node core/tools/gen-golden-drive.mjs
process.env.TZ = "UTC";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "../impala-drive/tests/golden");
fs.mkdirSync(outDir, { recursive: true });

// ── Laufzeit ───────────────────────────────────────────────────────────────
const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
for (const key of ["window", "document", "Element", "Node", "HTMLElement", "MutationObserver", "navigator", "CustomEvent"]) {
	Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });
Object.defineProperty(globalThis, "requestAnimationFrame", { value: (fn) => setTimeout(fn, 0), configurable: true });
Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true });

const FIXED = Date.parse("2026-10-27T14:05:00Z");
const SERVER = FIXED - 30000; // Server-Uhr 30 s hinter dem Gerät → Versatz wird angewendet
const RealDate = Date;
globalThis.Date = class extends RealDate {
	constructor(...a) { super(...(a.length ? a : [FIXED])); }
	static now() { return FIXED; }
};
Math.random = () => 0.5;
const realSetTimeout = globalThis.setTimeout;
let sleeps = [];
globalThis.setTimeout = (fn, ms, ...rest) => {
	if (ms >= 500 && ms < 10000) sleeps.push(ms); // Backoff 750/1500/3000 (ohne Ablauf-Timer)
	if (ms >= 10000) return 0; // Ablauf-Hinweis, Auto-Sync: nie auslösen
	return realSetTimeout(fn, 0, ...rest);
};

// db.js/state.js → Attrappen aus globalThis
const hooks = `
export async function resolve(spec, ctx, next) {
	const m = /(?:^|\\/)(db|state)\\.js$/.exec(spec);
	if (m && ctx.parentURL && ctx.parentURL.includes("/web/")) {
		const src = m[1] === "db" ? "export const DB = globalThis.__mockDB;"
			: "export const S = globalThis.__mockS; export const STATE = globalThis.__mockSTATE;";
		return { url: "data:text/javascript," + encodeURIComponent(src), shortCircuit: true };
	}
	return next(spec, ctx);
}`;
register("data:text/javascript," + encodeURIComponent(hooks));

const { SETTINGS_SYNC } = await import("../../web/settings-sync.js");
const CHECKPOINT = (k) => k === "__impala67_state_checkpoint_v1__" || k === "__impala67_state_checkpoint_v2__"
	|| k.startsWith("__impala67_state_checkpoint_v2_blob__:") || k.startsWith("__impala67_state_checkpoint_v3_heft__:");
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const clone = (v) => JSON.parse(JSON.stringify(v));
const noExportedAt = (text) => text.replace(/"exportedAt":"[^"]*"/g, '"exportedAt":""');

// Attrappe von DB: Event-Log mit seq, Blobs, Import ohne Konflikterkennung (die liegt in db.js).
let db;
function resetDb(events = [], blobs = {}) {
	db = { events: [], blobs: new Map(), lastSeq: 0, imports: [], puts: [] };
	for (const ev of events) { db.events.push(clone(ev)); db.lastSeq = Math.max(db.lastSeq, ev.seq); }
	for (const [k, v] of Object.entries(blobs)) db.blobs.set(k, { buf: Uint8Array.from(Buffer.from(v.b64, "base64")).buffer, meta: v.meta });
}
const stripLocal = ({ _remote, _remoteSource, _derived, seq, ...ev }) => ev;
globalThis.__mockDB = {
	maxSeq: async () => db.lastSeq,
	eventsAfterSeq: async (seq, target = "drive") => db.events.filter((e) => e.seq > seq && e._remoteSource !== target).map(clone),
	filterEventsForSync: (events, includeSecrets = true) => SETTINGS_SYNC.sanitizeEvents(events, includeSecrets),
	async importAll(data, opts) {
		db.imports.push({ unsyncedAfterSeq: opts.unsyncedAfterSeq, data: JSON.parse(noExportedAt(JSON.stringify(data))) });
		const have = new Set(db.events.map((e) => e.id));
		const fresh = [];
		for (const ev of data.events || []) {
			if (!ev || have.has(ev.id)) continue;
			have.add(ev.id);
			const c = clone(ev);
			delete c.seq;
			c._remote = true;
			c._remoteSource = "drive";
			c.seq = ++db.lastSeq;
			db.events.push(c);
			fresh.push(c);
		}
		for (const [k, v] of Object.entries(data.blobs || {})) {
			if (CHECKPOINT(k) || db.blobs.has(k)) continue;
			db.blobs.set(k, { buf: Uint8Array.from(Buffer.from(v.b64, "base64")).buffer, meta: v.meta });
		}
		return { added: fresh.length, conflicts: 0, conflictDetails: [], merged: 0, mergedDetails: [], importedEvents: fresh.map(clone) };
	},
	async exportAll(opts = {}) {
		let events = db.events.map(clone).map(stripLocal);
		if (opts.redactSecrets !== false) events = events.map((ev) => SETTINGS_SYNC.sanitizeEvent(ev, false)).filter(Boolean);
		return JSON.stringify({ app: "impala67", version: 1, exportedAt: "", events, blobs: {} });
	},
	allBlobKeys: async () => [...db.blobs.keys()].sort(),
	getBlob: async (id) => db.blobs.get(id),
	async putBlob(id, buf, meta) { db.blobs.set(id, { buf, meta }); db.puts.push({ id, b64: b64(new Uint8Array(buf)), meta }); },
	isStateCheckpointKey: CHECKPOINT,
	compactLocalIfDue: async () => false,
	isOpen: () => false,
};
globalThis.__mockS = { settings: {}, pages: {} };
globalThis.__mockSTATE = { applyRemoteEventsCooperative: async () => {}, scheduleCheckpoint() {}, onAfterDispatch() {} };

localStorage.setItem("impala67_drive_device_id", "dev-A");
const { U } = await import("../../web/util.js");
const toasts = [];
U.toast = (msg) => toasts.push(msg);
const { DRIVE } = await import("../../web/drive.js");
// Ohne Token: registriert nur die Auslöser (u. a. pagehide → flushUpload), kein Sync.
localStorage.removeItem("impala67_drive_token");
await DRIVE.startAutoSync();

// ── Nachgebaute Drive-API v3 ─────────────────────────────────────────────────
function gz(text) { return new Uint8Array(zlib.gzipSync(Buffer.from(text))); }
const enc = new TextEncoder();
let drive;
function newDrive({ pageSize = 3 } = {}) {
	drive = { files: [], changes: [], nextId: 1, tick: 0, faults: [], expired: new Set(), pageSize, onUpload: null };
}
function stamp() { return new RealDate(Date.UTC(2026, 9, 27, 10, 0, 0) + 1000 * ++drive.tick).toISOString(); }
function addFile(name, content, appProperties, extra = {}) {
	const bytes = typeof content === "string" ? enc.encode(content) : content;
	const f = { id: extra.id || "f" + String(drive.nextId++).padStart(3, "0"), name, modifiedTime: extra.modifiedTime || stamp(), size: String(bytes.length), appProperties, bytes };
	drive.files.push(f);
	drive.changes.push({ fileId: f.id, removed: false, file: view(f, true) });
	return f;
}
const json = (v) => JSON.stringify(v);
const deltaFile = (device, from, to, events, { encoding = "gzip", props = true } = {}) => {
	const body = json({ app: "impala67", version: 2, exportedAt: "2026-10-26T08:00:00.000Z", events, blobs: {} });
	return addFile(`impala67-delta-v2-${device}-${from}-${to}.json.gz`, encoding === "gzip" ? gz(body) : body,
		props ? { encoding, device, from: String(from), to: String(to) } : undefined);
};
function view(f, withTrashed = false) {
	const v = { id: f.id, name: f.name, modifiedTime: f.modifiedTime, size: f.size };
	if (f.appProperties) v.appProperties = f.appProperties;
	if (withTrashed) v.trashed = !!f.trashed;
	return v;
}
const live = () => drive.files.filter((f) => !f.trashed);

function respond(status, body, type = "application/json") {
	const headers = { date: new RealDate(SERVER).toUTCString() };
	if (body !== null && body !== undefined) headers["content-type"] = type;
	return { status, headers, body: body ?? null };
}

function splitBytes(buf, sep) {
	const i = buf.indexOf(sep);
	return i < 0 ? null : [buf.subarray(0, i), buf.subarray(i + sep.length)];
}

function parseMultipart(bytes, contentType) {
	const boundary = /boundary=(.+)$/.exec(contentType)[1];
	const buf = Buffer.from(bytes);
	const head = Buffer.from("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n");
	if (!buf.subarray(0, head.length).equals(head)) throw new Error("Multipart-Kopf unerwartet");
	const [meta, rest] = splitBytes(buf.subarray(head.length), Buffer.from("\r\n--" + boundary + "\r\nContent-Type: application/octet-stream\r\n\r\n"));
	const tail = Buffer.from("\r\n--" + boundary + "--");
	if (!rest.subarray(rest.length - tail.length).equals(tail)) throw new Error("Multipart-Ende unerwartet");
	return { boundary, meta: meta.toString("utf8"), content: new Uint8Array(rest.subarray(0, rest.length - tail.length)) };
}

function handle(method, url, headers, body) {
	const u = new URL(url);
	const p = u.pathname;
	const fault = drive.faults.find((f) => f.method === method && p.startsWith(f.path) && f.times > 0);
	if (fault) { fault.times--; return respond(fault.status, fault.body ?? json({ error: { code: fault.status, message: "Störung" } })); }
	if (method === "GET" && p === "/drive/v3/changes/startPageToken") return respond(200, json({ kind: "drive#startPageToken", startPageToken: "tok-" + drive.changes.length }));
	if (method === "GET" && p === "/drive/v3/changes") {
		const token = u.searchParams.get("pageToken");
		if (drive.expired.has(token) || !/^tok-\d+$/.test(token)) return respond(410, json({ error: { code: 410, message: "Invalid page token" } }));
		const at = Number(token.slice(4));
		const page = drive.changes.slice(at, at + drive.pageSize);
		const out = { changes: page.map((c) => (c.removed ? { fileId: c.fileId, removed: true } : { fileId: c.fileId, removed: false, file: c.file })) };
		if (at + drive.pageSize < drive.changes.length) out.nextPageToken = "tok-" + (at + drive.pageSize);
		else out.newStartPageToken = "tok-" + drive.changes.length;
		return respond(200, json(out));
	}
	if (method === "GET" && p === "/drive/v3/files") {
		const at = Number(u.searchParams.get("pageToken") || 0);
		const sizesOnly = u.searchParams.get("fields").includes("files(size)");
		const list = (sizesOnly ? drive.files : live()).slice(at, at + drive.pageSize);
		const out = {};
		if (at + drive.pageSize < (sizesOnly ? drive.files : live()).length) out.nextPageToken = String(at + drive.pageSize);
		out.files = list.map((f) => (sizesOnly ? { size: f.size } : view(f)));
		return respond(200, json(out));
	}
	if (method === "GET" && p === "/drive/v3/about") return respond(200, json({ storageQuota: { limit: "16106127360", usage: "5368709120", usageInDrive: "1000" } }));
	let m = /^\/drive\/v3\/files\/([^/]+)$/.exec(p);
	if (m && method === "GET" && u.searchParams.get("alt") === "media") {
		const f = live().find((x) => x.id === m[1]);
		return f ? respond(200, f.bytes, "application/octet-stream") : respond(404, json({ error: { code: 404, message: "File not found" } }));
	}
	if (m && method === "DELETE") {
		const f = live().find((x) => x.id === m[1]);
		if (!f) return respond(404, json({ error: { code: 404, message: "File not found" } }));
		drive.files = drive.files.filter((x) => x !== f);
		drive.changes.push({ fileId: f.id, removed: true });
		return respond(204, null);
	}
	m = /^\/upload\/drive\/v3\/files(?:\/([^/]+))?$/.exec(p);
	if (m && (method === "POST" || method === "PATCH")) {
		const part = parseMultipart(body, headers["Content-Type"]);
		const meta = JSON.parse(part.meta);
		let f;
		if (m[1]) {
			f = live().find((x) => x.id === m[1]);
			if (!f) return respond(404, json({ error: { code: 404, message: "File not found" } }));
			Object.assign(f, { name: meta.name, appProperties: { ...(f.appProperties || {}), ...meta.appProperties }, bytes: part.content, size: String(part.content.length), modifiedTime: stamp() });
			drive.changes.push({ fileId: f.id, removed: false, file: view(f, true) });
		} else {
			f = addFile(meta.name, part.content, meta.appProperties);
		}
		drive.onUpload?.(meta.name);
		return respond(200, json({ id: f.id, name: f.name, modifiedTime: f.modifiedTime, appProperties: f.appProperties }));
	}
	return respond(400, json({ error: { code: 400, message: "Unbekannter Aufruf " + method + " " + p } }));
}

let exchanges = [];
function recordBody(headers, bytes) {
	if (!bytes) return null;
	const type = headers["Content-Type"] || "";
	if (type.startsWith("multipart/related")) {
		const part = parseMultipart(bytes, type);
		const meta = JSON.parse(part.meta);
		const gzip = meta.appProperties?.encoding === "gzip";
		const content = gzip ? zlib.gunzipSync(Buffer.from(part.content)).toString("utf8") : Buffer.from(part.content).toString("utf8");
		return { multipart: { meta: part.meta, encoding: meta.appProperties?.encoding, content: noExportedAt(content) } };
	}
	return { text: Buffer.from(bytes).toString("utf8") };
}
globalThis.fetch = async (url, init = {}) => {
	const method = init.method || "GET";
	const headers = { ...(init.headers || {}) };
	const bytes = init.body ? new Uint8Array(await init.body.arrayBuffer()) : null;
	const res = handle(method, String(url), headers, bytes);
	const isBytes = res.body instanceof Uint8Array;
	exchanges.push({
		request: { method, url: String(url), headers: Object.entries(headers), body: recordBody(headers, bytes) },
		response: { status: res.status, headers: Object.entries(res.headers), ...(isBytes ? { b64: b64(res.body) } : { text: res.body }) },
	});
	return new Response(res.body, { status: res.status, headers: res.headers });
};

// ── Fälle ────────────────────────────────────────────────────────────────────
const DRIVE_KEYS = ["device_id", "file_index", "known_deltas", "uploaded_seq", "snapshot_stamp", "upload_hashes", "secret_scrub", "synced_seq", "last_ok", "known_blobs", "token", "token_expiry"];
const lsDump = () => Object.fromEntries(DRIVE_KEYS.map((k) => ["impala67_drive_" + k, localStorage.getItem("impala67_drive_" + k)]).filter(([, v]) => v !== null));
function resetLs(entries = {}) {
	for (const k of DRIVE_KEYS) if (k !== "device_id") localStorage.removeItem("impala67_drive_" + k);
	localStorage.setItem("impala67_drive_token", "tok-A");
	localStorage.setItem("impala67_drive_token_expiry", String(FIXED + 3600e3));
	for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
}
const T = (i) => new RealDate(Date.UTC(2026, 9, 27, 9, 0, i)).toISOString();
const ev = (id, i, type, payload, extra = {}) => ({ id, t: T(i), type, payload, ...extra });
const withSeq = (list) => list.map((e, i) => ({ ...e, seq: i + 1 }));
const blobJson = (id, meta, bytes) => json({ id, meta, b64: b64(bytes) });
const sha = async (text) => Buffer.from(await crypto.subtle.digest("SHA-256", enc.encode(text))).toString("hex");

const cases = [];
async function run(name, { op = "sync", settings = {}, events = [], blobs = {}, keepDb = false } = {}) {
	if (!keepDb) resetDb(events, blobs);
	db.imports = []; db.puts = [];
	globalThis.__mockS.settings = settings;
	exchanges = []; sleeps = []; toasts.length = 0;
	const before = { ls: lsDump(), events: clone(db.events), blobs: Object.fromEntries([...db.blobs].map(([k, v]) => [k, { meta: v.meta, b64: b64(new Uint8Array(v.buf)) }])) };
	U._clockOffsetMs = 0;
	let result = null, error = null;
	try {
		if (op === "sync") {
			const statuses = [];
			const r = await DRIVE.sync((s) => statuses.push(s));
			result = { imported: r.imported, uploaded: r.uploaded, conflicts: r.conflicts, merged: r.merged, statuses };
		} else if (op === "flush") {
			// flushUpload ist intern; pagehide löst es aus (startAutoSync wird dafür nicht gebraucht).
			window.dispatchEvent(new window.Event("pagehide"));
			await new Promise((r) => realSetTimeout(r, 50));
		} else if (op === "storage") {
			result = await DRIVE.storageInfo();
		}
	} catch (e) {
		error = e.message;
	}
	cases.push({
		name, op, allowSecrets: settings.syncSecrets !== false, before,
		exchanges, imports: db.imports, puts: db.puts,
		after: { ls: lsDump(), status: DRIVE.status().authState, clockOffsetMs: U._clockOffsetMs, toasts: [...toasts] },
		result, error, sleeps,
	});
	console.log(`${name}: ${exchanges.length} Anfragen, ${db.imports.length} Importe${error ? ", Fehler: " + error : ""}`);
}

// A: erster Sync eines Geräts mit vorhandenem Drive-Stand
{
	newDrive();
	addFile("impala67-sync.json", json({ app: "impala67", version: 1, exportedAt: "", events: [ev("old1", 1, "pageCreate", { id: "alt" })], blobs: {} }), undefined, { modifiedTime: "2026-01-01T00:00:00.000Z" });
	addFile("impala67-snapshot-v2.json.gz", gz(json({ app: "impala67", version: 1, exportedAt: "", events: [ev("b1", 2, "pageCreate", { id: "p2", title: "Von B", content: "" }), ev("b2", 3, "pageUpdate", { id: "p2", patch: { content: "B-Text" } })], blobs: {} })), { encoding: "gzip", protocol: "2" });
	deltaFile("dev-B", 3, 4, [ev("b3", 4, "pageUpdate", { id: "p2", patch: { title: "B2" } }), ev("b1", 2, "pageCreate", { id: "p2", title: "Von B", content: "" })]);
	deltaFile("dev-B", 5, 5, [ev("b5", 5, "cardCreate", { id: "k1", front: "Ä€😀" })], { props: false });
	deltaFile("dev-X", 1, 1, [ev("x1", 6, "pageCreate", { id: "px" }, { seq: 99, _remote: true, _remoteSource: "cloudflare" })], { encoding: "identity" });
	const cover = "cover:33333333-3333-4333-8333-333333333333";
	const coverJson = blobJson(cover, { name: "c.jpg", type: "image/jpeg" }, [9, 9, 9]);
	addFile("impala67-blob-v2-" + await sha(coverJson) + ".json.gz", gz(coverJson), { encoding: "gzip", hash: await sha(coverJson), blobId: cover });
	const img4 = "img:44444444-4444-4444-8444-444444444444";
	const img4Json = blobJson(img4, { name: "d.png", type: "image/png" }, [4, 4]);
	addFile("impala67-blob-v2-" + await sha(img4Json) + ".json.gz", gz(img4Json), { encoding: "gzip", hash: await sha(img4Json) });
	addFile("impala67-blob-v2-0000.json.gz", gz(blobJson("heftver:p9:1:1", {}, [1])), { encoding: "gzip", hash: "0000", blobId: "heftver:p9:1:1" });
	addFile("notizen.txt", "fremd", undefined);
	drive.faults.push({ method: "GET", path: "/drive/v3/files", status: 503, times: 1 });
	drive.onUpload = (name) => {
		if (name.startsWith("impala67-delta-v2-dev-A")) { drive.onUpload = null; deltaFile("dev-C", 1, 1, [ev("c1", 20, "pageUpdate", { id: "p1", patch: { content: "spät" } })]); }
	};
	resetLs();
	await run("erster-sync", {
		settings: { syncSecrets: false },
		events: withSeq([
			ev("a1", 10, "pageCreate", { id: "p1", title: "Hallo", content: "Welt" }),
			ev("a2", 11, "settingsSet", { theme: "dark", notionToken: "geheim", aiProviders: [{ id: "x", key: "k1", name: "X" }] }),
			ev("a3", 12, "uiTabsSet", { tabs: ["p1"] }),
			ev("a4", 13, "pageUpdate", { id: "p1", patch: { content: "Welt!" } }, { _remote: true, _remoteSource: "cloudflare" }),
			ev("a5", 14, "pageUpdate", { id: "p1", patch: { content: "Echo" } }, { _remote: true, _remoteSource: "drive" }),
			ev("a6", 15, "settingsSet", { notionToken: "nur-geheim" }),
			ev("a7", 16, "pageMove", { id: "p1", parentId: null }, { _derived: true }),
		]),
		blobs: {
			"img:11111111-1111-4111-8111-111111111111": { meta: { name: "a.png", type: "image/png", hash: "h-img" }, b64: b64([1, 2, 3]) },
			"file:22222222-2222-4222-8222-222222222222": { meta: { name: "b.pdf", type: "application/pdf" }, b64: b64([37, 80, 68, 70]) },
			[cover]: { meta: { name: "c.jpg", type: "image/jpeg" }, b64: b64([9, 9, 9]) },
			"heftver:p1:1:1": { meta: {}, b64: b64([7]) },
			"__impala67_state_checkpoint_v2__": { meta: {}, b64: b64([8]) },
			"bgImage": { b64: b64([5, 5]) },
		},
	});
	// B: Folgelauf über den Changes-Index (gelöschte, verworfene und neue Dateien)
	db.events.push({ ...ev("a8", 30, "pageUpdate", { id: "p1", patch: { content: "neu" } }), seq: ++db.lastSeq });
	const del = drive.files.find((f) => f.name.startsWith("impala67-delta-v2-dev-B-3-4"));
	drive.files = drive.files.filter((f) => f !== del);
	drive.changes.push({ fileId: del.id, removed: true });
	const trash = drive.files.find((f) => f.name === "notizen.txt");
	trash.trashed = true;
	drive.changes.push({ fileId: trash.id, removed: false, file: view(trash, true) });
	deltaFile("dev-B", 6, 7, [ev("b6", 31, "pageUpdate", { id: "p2", patch: { content: "B3" } })]);
	await run("folge-sync", { settings: { syncSecrets: false }, keepDb: true });
}

// C: Wiederherstellen aus einem v1-Snapshot (Altname, unkomprimiert, Blobs im Dokument)
{
	newDrive();
	addFile("notion-sync.json", json({
		app: "notion", version: 1, exportedAt: "2025-01-01T00:00:00.000Z",
		events: [ev("v1", 1, "pageCreate", { id: "q1", title: "Alt", content: "![](img:55555555-5555-4555-8555-555555555555)" }), ev("v2", 2, "settingsSet", { theme: "light", notionToken: "alt-geheim" })],
		blobs: {
			"img:55555555-5555-4555-8555-555555555555": { meta: { name: "e.png", type: "image/png" }, b64: b64([1, 1, 2, 3, 5, 8]) },
			"__impala67_state_checkpoint_v2__": { b64: b64([0]) },
		},
	}), undefined);
	resetLs();
	await run("v1-wiederherstellen", { settings: {} });
}

// D: Kompaktierung (≥ 50 Deltas), ein Löschen scheitert, ein Delta ist schon bekannt
{
	newDrive({ pageSize: 25 });
	const snap = addFile("impala67-snapshot-v2.json.gz", gz(json({ app: "impala67", version: 1, exportedAt: "", events: [], blobs: {} })), { encoding: "gzip", protocol: "2" });
	const deltas = [];
	for (let i = 0; i < 51; i++) deltas.push(deltaFile("dev-B", i + 1, i + 1, [ev("d" + i, 40 + (i % 20), "cardCreate", { id: "c" + i })]));
	drive.faults.push({ method: "DELETE", path: "/drive/v3/files/" + deltas[7].id, status: 404, times: 1 });
	resetLs({ impala67_drive_known_deltas: json([deltas[0].id, "weg"]), impala67_drive_snapshot_stamp: snap.id + ":" + snap.modifiedTime, impala67_drive_uploaded_seq: "1" });
	await run("kompaktierung", { settings: { syncSecrets: true }, events: withSeq([ev("l1", 1, "pageCreate", { id: "z" }), ev("l2", 2, "settingsSet", { notionToken: "bleibt" })]) });
}

// E: abgelaufenes Changes-Token → einmal voll listen
{
	newDrive();
	deltaFile("dev-B", 1, 1, [ev("e1", 1, "pageCreate", { id: "e" })]);
	drive.expired.add("tok-alt");
	resetLs({ impala67_drive_file_index: json({ token: "tok-alt", files: { zz: { id: "zz", name: "impala67-delta-v2-dev-B-9-9.json.gz", modifiedTime: "2026-01-01T00:00:00.000Z" } } }) });
	await run("changes-token-ungueltig", { settings: {} });
}

// F: Token-Kopien aus Drive entfernen (Nutzer hat die Token-Synchronisierung ausgeschaltet)
{
	newDrive();
	addFile("impala67-snapshot-v2.json.gz", gz(json({ app: "impala67", version: 1, exportedAt: "", events: [ev("s1", 1, "settingsSet", { notionToken: "alt" })], blobs: {} })), { encoding: "gzip", protocol: "2" });
	addFile("impala67-sync.json", json({ app: "impala67", version: 1, events: [], blobs: {} }), undefined, { modifiedTime: "2026-01-01T00:00:00.000Z" });
	deltaFile("dev-B", 1, 2, [ev("s2", 2, "settingsSet", { theme: "dark", notionToken: "x" })]);
	resetLs({ impala67_drive_secret_scrub: "1" });
	await run("geheimnisse-entfernen", { settings: { syncSecrets: false }, events: withSeq([ev("m1", 5, "settingsSet", { theme: "blue", aiProviders: [{ id: "o", key: "sk" }] })]) });
}

// G: Drive lehnt das Token ab (401)
{
	newDrive();
	drive.faults.push({ method: "GET", path: "/drive/v3/changes/startPageToken", status: 401, times: 1 });
	resetLs();
	await run("token-abgelehnt", { settings: {} });
}

// H: Kurzweg beim Schließen (nur hochladen)
{
	newDrive();
	resetLs({ impala67_drive_uploaded_seq: "1" });
	await run("schliessen-flush", { op: "flush", settings: {}, events: withSeq([ev("h1", 1, "pageCreate", { id: "h" }), ev("h2", 2, "pageUpdate", { id: "h", patch: { content: "x" } }), ev("h3", 3, "uiTreeSet", { key: "h" })]) });
}

// I: Speicheranzeige (Quota + Größe des App-Ordners, 429 mit Backoff)
{
	newDrive({ pageSize: 2 });
	for (let i = 0; i < 5; i++) addFile("impala67-blob-v2-" + i + ".json.gz", "x".repeat(10 + i), { encoding: "identity" });
	drive.faults.push({ method: "GET", path: "/drive/v3/about", status: 429, times: 2 });
	resetLs();
	await run("speicher", { op: "storage", settings: {} });
}

fs.writeFileSync(path.join(outDir, "flows.json"), JSON.stringify({ fixedNow: FIXED, cases }, null, 1) + "\n");

// ── Reine Regeln ─────────────────────────────────────────────────────────────
const policy = await import("../../web/drive-sync-policy.js");
const status = await import("../../web/drive-status.js");
const actions = await import("../../web/settings-action-state.js");
const { backupView } = await import("../../web/backup-status.js");
const minuteInputs = [undefined, null, 5, 15, 30, 60, 180, 1440, 7, "15", "abc", 0, -5, 30.5];
const rules = {
	intervals: minuteInputs.map((m) => ({ input: m === undefined ? null : m, minutes: policy.normalizeDriveSyncMinutes({ driveAutoSyncMinutes: m }), ms: policy.driveSyncIntervalMs({ driveAutoSyncMinutes: m }) })),
	afterChange: [true, false, "true", 1, null].map((v) => ({ input: v, result: policy.driveSyncAfterChange({ driveSyncAfterChange: v }) })),
	authState: [[false, false], [false, true], [true, false], [true, true]].map(([tokenValid, sessionKnown]) => ({ tokenValid, sessionKnown, result: status.driveAuthState({ tokenValid, sessionKnown }) })),
	statusView: [],
	backupView: [],
	actionState: [],
};
for (const authState of Object.values(status.DRIVE_AUTH_STATE)) {
	for (const syncState of ["idle", "syncing", "waiting", "ok", "error"]) {
		for (const online of [true, false]) {
			for (const [email, label, detail] of [["", "", ""], ["a@b.de", "Synchronisiere…", ""], ["a@b.de", "Sync fehlgeschlagen", "Drive-Fehler 500"]]) {
				rules.statusView.push({ input: { authState, syncState, online, email, label, detail }, result: status.driveStatusView({ authState, syncState, online, email, label, detail }) });
			}
		}
	}
}
for (const hasChannel of [true, false]) {
	for (const since of [null, "kaputt", new RealDate(FIXED - 3600e3).toISOString(), new RealDate(FIXED - 24 * 3600e3).toISOString(), new RealDate(FIXED - 30 * 3600e3).toISOString()]) {
		rules.backupView.push({ hasChannel, unsafeSince: since, now: FIXED, result: backupView({ hasChannel, unsafeSince: since, now: FIXED }) });
	}
}
for (const hasClient of [true, false]) for (const connected of [true, false]) for (const needsLogin of [true, false]) {
	rules.actionState.push({ hasClient, connected, needsLogin, result: actions.driveActionState({ hasClient, connected, needsLogin }) });
}
fs.writeFileSync(path.join(outDir, "rules.json"), JSON.stringify(rules, null, 1) + "\n");
console.log("rules.json geschrieben");
process.exit(0);
