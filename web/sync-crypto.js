"use strict";

// Hash und Kompression für JS-Teile (Drive-Backup, Checkpoints, v4-Migration). Die
// Ende-zu-Ende-Verschlüsselung des Cloudflare-Syncs liegt im Rust-Kern (core/impala-crypto).

const enc = new TextEncoder();
const toUint8 = (v) => (v instanceof Uint8Array ? v : new Uint8Array(v));

export function bytesToHex(value) {
	return [...toUint8(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value) {
	const bytes = value instanceof Uint8Array ? value : enc.encode(String(value ?? ""));
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return bytesToHex(digest);
}

async function transformBytes(bytes, transformer) {
	const stream = new Blob([bytes]).stream().pipeThrough(transformer);
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Gemeinsame Kompression für Drive/Checkpoint-JSON (sync-core.js).
// gzip liefert null, wenn das Gerät keinen CompressionStream kennt.
export async function gzip(bytes) {
	if (typeof CompressionStream !== "function") return null;
	return transformBytes(bytes, new CompressionStream("gzip"));
}

export async function gunzip(bytes) {
	if (typeof DecompressionStream !== "function") throw new Error("Gzip wird auf diesem Gerät nicht unterstützt.");
	return transformBytes(bytes, new DecompressionStream("gzip"));
}
