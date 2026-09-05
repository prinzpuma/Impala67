"use strict";

const enc = new TextEncoder();
const dec = new TextDecoder();
const JSON_GZIP_AT = 16 * 1024;
const SYNC_KEY_RE = /^impala-(?:[0-9a-f]{4}-){7}[0-9a-f]{4}$/i;
const toUint8 = (v) => (v instanceof Uint8Array ? v : new Uint8Array(v));

export const MAX_USER_STORAGE_BYTES = 1_000_000_000;

export function bytesToBase64(value) {
	const bytes = toUint8(value);
	let out = "";
	for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(out);
}

export function base64ToBytes(value) {
	const s = atob(String(value || ""));
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
	return out;
}

export function bytesToHex(value) {
	return [...toUint8(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(value) {
	const hex = String(value || "").trim();
	if (!hex || hex.length % 2) return new Uint8Array();
	return new Uint8Array(hex.match(/../g).map((part) => parseInt(part, 16)));
}

export async function sha256Hex(value) {
	const digest = await crypto.subtle.digest("SHA-256", enc.encode(String(value ?? "")));
	return bytesToHex(digest);
}

export function generateSyncKey() {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return `impala-${bytesToHex(bytes).match(/.{4}/g).join("-")}`;
}

export async function deriveSyncCredentials(syncKey) {
	const clean = String(syncKey || "").trim();
	if (!SYNC_KEY_RE.test(clean)) throw new Error("Ungültiger Sync-Schlüssel. Bitte einen neuen 128-Bit-Schlüssel erzeugen.");
	if (!globalThis.crypto?.subtle) throw new Error("Web Crypto API ist nicht verfügbar. Bitte HTTPS verwenden.");

	const [userId, authToken, salt] = await Promise.all([
		sha256Hex(`impala67_user_partition:${clean}`),
		sha256Hex(`impala67_auth_token:${clean}`),
		crypto.subtle.digest("SHA-256", enc.encode(`impala67_e2ee_salt:${clean}`)),
	]);
	const base = await crypto.subtle.importKey("raw", enc.encode(clean), "PBKDF2", false, ["deriveKey"]);
	const cryptoKey = await crypto.subtle.deriveKey(
		{ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
		base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
	);
	return { userId, authToken, cryptoKey };
}

async function transformBytes(bytes, transformer) {
	const stream = new Blob([bytes]).stream().pipeThrough(transformer);
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gzip(bytes) {
	if (typeof CompressionStream !== "function") return null;
	return transformBytes(bytes, new CompressionStream("gzip"));
}

async function gunzip(bytes) {
	if (typeof DecompressionStream !== "function") throw new Error("Gzip wird auf diesem Gerät nicht unterstützt.");
	return transformBytes(bytes, new DecompressionStream("gzip"));
}

async function encryptBytes(cryptoKey, bytes) {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, bytes));
	return { iv: bytesToHex(iv), bytes: ciphertext, size: ciphertext.byteLength + iv.byteLength };
}

async function decryptBytes(cryptoKey, ivHex, bytes) {
	return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: hexToBytes(ivHex) }, cryptoKey, bytes));
}

export async function encryptPayload(cryptoKey, value) {
	if (!cryptoKey) throw new Error("Kein Verschlüsselungsschlüssel vorhanden.");
	const raw = enc.encode(JSON.stringify(value));
	let bytes = raw, prefix = "";
	if (raw.byteLength >= JSON_GZIP_AT) {
		const packed = await gzip(raw);
		if (packed && packed.byteLength < raw.byteLength) { bytes = packed; prefix = "gz:"; }
	}
	const encrypted = await encryptBytes(cryptoKey, bytes);
	return { iv: encrypted.iv, data: prefix + bytesToBase64(encrypted.bytes), size: encrypted.size };
}

export async function decryptPayload(cryptoKey, packet) {
	if (!cryptoKey || !packet?.iv || !packet?.data) throw new Error("Ungültiges Verschlüsselungspaket.");
	const gz = String(packet.data).startsWith("gz:");
	let plain = await decryptBytes(cryptoKey, packet.iv, base64ToBytes(gz ? packet.data.slice(3) : packet.data));
	if (gz) plain = await gunzip(plain);
	return JSON.parse(dec.decode(plain));
}

// Binärblobs werden ohne Base64/JSON-Overhead verschlüsselt.
// Layout vor AES-GCM: uint32 headerLength | JSON({id,meta}) | raw bytes.
export async function encryptBlobRecord(cryptoKey, id, record) {
	const raw = record?.buf || record?.data;
	if (!raw) throw new Error(`Blob ${id} enthält keine Daten.`);
	const body = toUint8(raw);
	const header = enc.encode(JSON.stringify({ id, meta: record?.meta || {} }));
	const packed = new Uint8Array(4 + header.length + body.length);
	new DataView(packed.buffer).setUint32(0, header.length, false);
	packed.set(header, 4); packed.set(body, 4 + header.length);
	return encryptBytes(cryptoKey, packed);
}

export async function decryptBlobRecord(cryptoKey, iv, ciphertext) {
	const packed = await decryptBytes(cryptoKey, iv, toUint8(ciphertext));
	if (packed.byteLength < 4) throw new Error("Ungültiger Blob-Datensatz.");
	const headerLen = new DataView(packed.buffer, packed.byteOffset, packed.byteLength).getUint32(0, false);
	if (headerLen < 2 || headerLen > packed.byteLength - 4) throw new Error("Ungültiger Blob-Header.");
	const header = JSON.parse(dec.decode(packed.subarray(4, 4 + headerLen)));
	if (!header?.id) throw new Error("Blob-ID fehlt.");
	const bytes = packed.slice(4 + headerLen);
	return { id: header.id, meta: header.meta || {}, buf: bytes.buffer };
}

export function formatStorageUsage(bytes, limit = MAX_USER_STORAGE_BYTES) {
	const used = Math.max(0, Number(bytes) || 0), cap = Math.max(1, Number(limit) || MAX_USER_STORAGE_BYTES);
	const mbUsed = Number((used / 1_000_000).toFixed(1)), mbLimit = Math.round(cap / 1_000_000);
	const percent = Math.min(100, Math.round((used / cap) * 100));
	return { bytes: used, limit: cap, mbUsed, mbLimit, percent, formatted: `${mbUsed.toFixed(1)} MB / ${mbLimit} MB (${percent} %)` };
}
