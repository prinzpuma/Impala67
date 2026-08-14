"use strict";

const enc = new TextEncoder();
const dec = new TextDecoder();

export function shouldUploadDelta(localMaxSeq, uploadedSeq) {
	return Number(localMaxSeq || 0) > Number(uploadedSeq || 0);
}

export function unseenRemoteFiles(files, knownIds) {
	const known = knownIds instanceof Set ? knownIds : new Set(knownIds || []);
	return (files || []).filter((f) => f && f.id && !known.has(f.id));
}

export function newestFile(files, names) {
	const allow = new Set(names || []);
	return (files || []).filter((f) => allow.has(f.name))
		.sort((a, b) => String(b.modifiedTime || "").localeCompare(String(a.modifiedTime || "")))[0] || null;
}

export async function sha256Hex(value) {
	const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

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

// Nur gerätespezifische UI-Zustände und bereits in einem neueren Heft-Snapshot
// enthaltene Striche aus dem Transport entfernen. Nutzungsstatistiken bleiben erhalten.
export function pruneEventsForUpload(events) {
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

export function isBlobAlive(key, pages) {
	const k = String(key || "");
	if (!k) return false;
	const pageStrings = [];
	for (const pg of Object.values(pages || {})) {
		if (!pg || typeof pg !== "object") continue;
		for (const v of Object.values(pg)) {
			if (typeof v === "string" && v) pageStrings.push(v);
		}
	}
	const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
	const isRef = (target) => !!target && pageStrings.some((s) => s.includes(target));

	if (k.startsWith("heft:")) return !!(pages && pages[k.slice(5)]);
	if (k.startsWith("pdftext:")) return isRef(k.slice(8));
	if (k.startsWith("cover:")) return isRef(k) || isRef(k.slice(6));
	if (isUuid(k)) return isRef(k);
	// Fail-safe: gerätespezifische oder unbekannte Schlüssel ("bgImage", "heftver:...") nie löschen
	return true;
}
