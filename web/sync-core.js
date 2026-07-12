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