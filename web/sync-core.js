"use strict";

const enc = new TextEncoder();
const dec = new TextDecoder();

export const CLOUD_SYNC_PROTOCOL = 4;
export const CLOUD_SYNC_PROTOCOL_HEADER = "X-Impala-Sync-Protocol";
export const LOCAL_EVENT_METADATA_KEYS = Object.freeze(["seq", "_remote", "_remoteSource", "_derived"]);

export const shouldUploadToSync = (event, target) => event?._remoteSource !== target;
export const shouldUploadDelta = (localMaxSeq, uploadedSeq) => Number(localMaxSeq || 0) > Number(uploadedSeq || 0);

export function unseenRemoteFiles(files, knownIds) {
	const known = knownIds instanceof Set ? knownIds : new Set(knownIds || []);
	return (files || []).filter((file) => file?.id && !known.has(file.id));
}

export function newestFile(files, names) {
	const allowed = new Set(names || []);
	return (files || []).filter((file) => allowed.has(file.name))
		.sort((a, b) => String(b.modifiedTime || "").localeCompare(String(a.modifiedTime || "")))[0] || null;
}

export async function sha256Hex(value) {
	const bytes = value instanceof Uint8Array ? value : enc.encode(String(value ?? ""));
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const jsonByteLength = (value) => enc.encode(JSON.stringify(value)).byteLength;

export async function encodeJson(value) {
	const raw = enc.encode(JSON.stringify(value));
	if (typeof CompressionStream !== "function") return { bytes: raw, encoding: "identity" };
	const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip"));
	return { bytes: new Uint8Array(await new Response(stream).arrayBuffer()), encoding: "gzip" };
}

export async function decodeJson(bytes, encoding) {
	let stream = new Blob([bytes]).stream();
	if (encoding === "gzip") {
		if (typeof DecompressionStream !== "function") throw new Error("Gzip wird auf diesem Gerät nicht unterstützt.");
		stream = stream.pipeThrough(new DecompressionStream("gzip"));
	}
	return JSON.parse(dec.decode(await new Response(stream).arrayBuffer()));
}

export function boundedKnownIds(ids, max = 2000) {
	return [...new Set(ids || [])].slice(-Math.max(1, Number(max) || 2000));
}

export function prepareCloudEvents(events, { includeRemote = false } = {}) {
	return (events || [])
		.filter((event) => includeRemote || shouldUploadToSync(event, "cloudflare"))
		.map((event) => {
			const wire = { ...(event || {}) };
			for (const key of LOCAL_EVENT_METADATA_KEYS) delete wire[key];
			return wire;
		});
}

function prepareIncomingCloudEvent(event) {
	if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("Cloud-Event ist ungültig.");
	for (const key of LOCAL_EVENT_METADATA_KEYS) {
		if (Object.hasOwn(event, key)) throw new Error("Cloud-Event enthält unzulässige lokale Metadaten.");
	}
	return { ...event, _remote: true, _remoteSource: "cloudflare" };
}

export function prepareIncomingCloudEvents(envelopes) {
	return (envelopes || []).flatMap((envelope) => {
		if (!envelope || envelope.v !== CLOUD_SYNC_PROTOCOL) throw new Error(`Sync-Protokoll v${CLOUD_SYNC_PROTOCOL} erforderlich.`);
		const events = Array.isArray(envelope.events) ? envelope.events : envelope.event ? [envelope.event] : [];
		if (!events.length) throw new Error("Cloud-Event-Paket ist leer.");
		return events.map(prepareIncomingCloudEvent);
	});
}

export const cloudEventEnvelope = (event) => ({ v: CLOUD_SYNC_PROTOCOL, event });
export function cloudEventsEnvelope(events) {
	if (!Array.isArray(events) || !events.length) throw new Error("Cloud-Event-Paket ist leer.");
	return { v: CLOUD_SYNC_PROTOCOL, events };
}

export function chunkCloudEvents(events, { maxEvents = 250, maxJsonBytes, maxJsonChars = 1_000_000 } = {}) {
	// maxJsonChars bleibt als rückwärtskompatibler Optionsname erhalten; gemessen
	// wird seit v4.1 ausschließlich die tatsächliche UTF-8-Größe.
	const byteLimit = Math.max(1, Number(maxJsonBytes ?? maxJsonChars) || 1_000_000);
	const out = [];
	let chunk = [], bytes = 0;
	for (const event of events || []) {
		const n = jsonByteLength(event) + 1;
		if (chunk.length && (chunk.length >= maxEvents || bytes + n > byteLimit)) {
			out.push(chunk); chunk = []; bytes = 0;
		}
		chunk.push(event); bytes += n;
	}
	if (chunk.length) out.push(chunk);
	return out;
}

// Öffentliche Bezeichnung aus v4 beibehalten; der Wert ist jetzt tatsächlich
// eine UTF-8-Byte-Schätzung des JSON-Pakets statt bloßer JS-Zeichenanzahl.
export const encryptedPacketChars = (packet) => jsonByteLength(packet) + 1;

export function heftBaselineOps(doc) {
	const pages = Array.isArray(doc?.pages) ? doc.pages : [];
	const ops = pages.map((page, at) => ({ t: "pg+", at, page: { id: page.id, paper: page.paper || "lined" } }));
	if (pages.length) ops.push({ t: "pgo", order: pages.map((page) => page.id) });
	for (const page of pages) {
		if (page.ocrText) ops.push({ t: "ocr", p: page.id, text: page.ocrText });
		for (const stroke of page.strokes || []) ops.push({ t: "s+", p: page.id, o: stroke });
		for (const image of page.images || []) ops.push({ t: "i+", p: page.id, o: image });
		for (const text of page.texts || []) ops.push({ t: "x+", p: page.id, o: text });
	}
	return ops;
}

export function heftDiffOps(current, target) {
	const before = Array.isArray(current?.pages) ? current.pages : [];
	const after = Array.isArray(target?.pages) ? target.pages : [];
	const oldPages = new Map(before.map((page) => [page.id, page]));
	const newIds = new Set(after.map((page) => page.id));
	const ops = [];
	for (const page of before) if (page?.id && !newIds.has(page.id)) ops.push({ t: "pg-", p: page.id });
	after.forEach((page, at) => { if (page?.id && !oldPages.has(page.id)) ops.push({ t: "pg+", at, page: { id: page.id, paper: page.paper || "lined" } }); });
	const beforeOrder = before.filter((p) => newIds.has(p.id)).map((p) => p.id);
	const afterOrder = after.map((p) => p.id);
	if (beforeOrder.join("\n") !== afterOrder.join("\n")) ops.push({ t: "pgo", order: afterOrder });
	const diffList = (pageId, kind, oldList, newList) => {
		const old = new Map((oldList || []).filter((x) => x?.id).map((x) => [x.id, x]));
		const next = new Map((newList || []).filter((x) => x?.id).map((x) => [x.id, x]));
		const removed = [...old.keys()].filter((id) => !next.has(id));
		if (removed.length) ops.push({ t: kind + "-", p: pageId, ids: removed });
		for (const [id, value] of next) {
			const previous = old.get(id);
			if (!previous) ops.push({ t: kind + "+", p: pageId, o: value });
			else if (JSON.stringify(previous) !== JSON.stringify(value)) ops.push({ t: kind + "=", p: pageId, o: value });
		}
	};
	for (const page of after) {
		if (!page?.id) continue;
		const old = oldPages.get(page.id);
		if (old && (old.paper || "lined") !== (page.paper || "lined")) ops.push({ t: "pgp", p: page.id, paper: page.paper || "lined" });
		if ((old?.ocrText || "") !== (page.ocrText || "")) ops.push({ t: "ocr", p: page.id, text: page.ocrText || "" });
		diffList(page.id, "s", old?.strokes, page.strokes);
		diffList(page.id, "i", old?.images, page.images);
		diffList(page.id, "x", old?.texts, page.texts);
	}
	return ops;
}

export function pruneEventsForUpload(events) {
	return (events || []).filter((event) => event?.type !== "uiTabsSet" && event?.type !== "uiTreeSet");
}

export function isSyncBlobId(id) {
	const key = String(id || "");
	return /^(?:img:|file:|cover:|pdftext:)/.test(key) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
}

export function isBlobAlive(key, pages) {
	const k = String(key || "");
	if (!k) return false;
	const strings = [];
	for (const page of Object.values(pages || {})) {
		if (!page || typeof page !== "object") continue;
		for (const value of Object.values(page)) if (typeof value === "string" && value) strings.push(value);
	}
	const ref = (target) => !!target && strings.some((value) => value.includes(target));
	if (k.startsWith("heft:")) return !!pages?.[k.slice(5)];
	if (k.startsWith("pdftext:")) return ref(k.slice(8));
	if (k.startsWith("cover:")) return ref(k) || ref(k.slice(6));
	if (k.startsWith("img:") || k.startsWith("file:")) return ref(k);
	if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) return ref(k);
	return true; // Fail-Safe: gerätespezifische oder nicht-synchronisierte Spezialschlüssel ("bgImage", "heftver:...") nie löschen
}
