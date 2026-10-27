"use strict";
// Sync-Hilfen, die noch in JS gebraucht werden (Drive-Backup, Blob-Aufräumen, v4-Migration).
// Das Cloudflare-Protokoll selbst (Wire-Format, Pakete, E2EE) steht im Rust-Kern (core/impala-sync).
import { gzip, gunzip } from "./sync-crypto.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

export const CLOUD_SYNC_PROTOCOL = 4;
export const CLOUD_SYNC_PROTOCOL_HEADER = "X-Impala-Sync-Protocol";

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

// Bytes gzippen; ohne CompressionStream unverändert („identity“).
export async function gzipBytes(raw) {
	const packed = await gzip(raw);
	return packed ? { bytes: packed, encoding: "gzip" } : { bytes: raw, encoding: "identity" };
}

export const encodeJson = (value) => gzipBytes(enc.encode(JSON.stringify(value)));
// Für schon serialisierte Exporte (DB.exportAll): kein Parse-und-Stringify des ganzen Logs.
export const encodeJsonText = (text) => gzipBytes(enc.encode(text));

export async function decodeJson(bytes, encoding) {
	return JSON.parse(dec.decode(encoding === "gzip" ? await gunzip(bytes) : bytes));
}

export function boundedKnownIds(ids, max = 2000) {
	return [...new Set(ids || [])].slice(-Math.max(1, Number(max) || 2000));
}

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


export function pruneEventsForUpload(events) {
	return (events || []).filter((event) => event?.type !== "uiTabsSet" && event?.type !== "uiTreeSet");
}

const UUID_SRC = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const BLOB_REF_EXACT = new RegExp("^(?:img:|file:|cover:)?" + UUID_SRC + "$", "i");
// Lookahead statt normalem Treffer: findet auch überlappende Vorkommen, die Menge enthält
// damit genau die Verweise, die text.includes() finden würde.
const BLOB_REF_SCAN = new RegExp("(?=((?:img:|file:|cover:)?" + UUID_SRC + "))", "gi");

// Für viele Schlüssel auf einmal: Seitentexte nur EINMAL einsammeln statt je Blob
// erneut über alle Seiten zu laufen (lief im Sync synchron und fror die UI ein).
// Das Trennzeichen \0 kommt in keinem Schlüssel vor — Treffer bleiben exakt dieselben.
// UUID-basierte IDs (der Normalfall) stehen nach EINEM Durchlauf in einer Menge: vorher lief
// text.includes() je Blob über den ganzen Seitentext — bei vielen Dateien und großen Seiten
// Milliarden Zeichenvergleiche bei jedem Sync mit neuen Daten.
export function blobAliveChecker(pages) {
	const strings = [];
	for (const page of Object.values(pages || {})) {
		if (!page || typeof page !== "object") continue;
		for (const value of Object.values(page)) if (typeof value === "string" && value) strings.push(value);
	}
	const text = strings.join("\0");
	let refs = null;
	const ref = (target) => {
		if (!target || target.includes("\0")) return false;
		if (!BLOB_REF_EXACT.test(target)) return text.includes(target);
		if (!refs) refs = new Set(Array.from(text.matchAll(BLOB_REF_SCAN), (m) => m[1]));
		return refs.has(target);
	};
	return (key) => {
		const k = String(key || "");
		if (!k) return false;
		if (k.startsWith("heft:")) return !!pages?.[k.slice(5)];
		if (k.startsWith("pdftext:")) return ref(k.slice(8));
		if (k.startsWith("cover:")) return ref(k) || ref(k.slice(6));
		if (k.startsWith("img:") || k.startsWith("file:")) return ref(k);
		if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) return ref(k);
		return true; // Fail-Safe: gerätespezifische oder nicht-synchronisierte Spezialschlüssel ("bgImage", "heftver:...") nie löschen
	};
}

export function isBlobAlive(key, pages) {
	return blobAliveChecker(pages)(key);
}
