"use strict";

// SHA-256 für JS-Teile (Checkpoints, v4-Migration). Ende-zu-Ende-Verschlüsselung und gzip
// für Cloudflare-Sync und Drive-Backup liegen im Rust-Kern (core/impala-crypto).

const enc = new TextEncoder();
const toUint8 = (v) => (v instanceof Uint8Array ? v : new Uint8Array(v));

function bytesToHex(value) {
	return [...toUint8(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value) {
	const bytes = value instanceof Uint8Array ? value : enc.encode(String(value ?? ""));
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return bytesToHex(digest);
}
