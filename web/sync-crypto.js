"use strict";

const enc = new TextEncoder();
const dec = new TextDecoder();
const COMPRESSION_THRESHOLD_BYTES = 64 * 1024;

export const MAX_USER_STORAGE_BYTES = 1024 * 1024 * 1024; // 1.000 MB (1 GB) Quota pro Nutzer

export function bytesToBase64(bytes) {
	const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	const CHUNK_SIZE = 0x8000;
	let binary = "";
	for (let i = 0; i < arr.length; i += CHUNK_SIZE) {
		binary += String.fromCharCode.apply(null, arr.subarray(i, i + CHUNK_SIZE));
	}
	return btoa(binary);
}

export function base64ToBytes(base64) {
	const binary = atob(String(base64 || ""));
	const len = binary.length;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

export function hexToBytes(hex) {
	const clean = String(hex || "").trim();
	if (!clean || clean.length % 2 !== 0) return new Uint8Array(0);
	const matches = clean.match(/.{1,2}/g);
	return matches ? new Uint8Array(matches.map((b) => parseInt(b, 16))) : new Uint8Array(0);
}

export function bytesToHex(bytes) {
	const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(str) {
	const bytes = enc.encode(String(str || ""));
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return bytesToHex(new Uint8Array(digest));
}

/**
 * Generiert einen sicheren, lesbaren 16-stelligen Sync-Schlüssel
 * z. B. "impala-a7f9-2c3e-8b1d-9f4a"
 */
export function generateSyncKey() {
	const randomBytes = new Uint8Array(8);
	crypto.getRandomValues(randomBytes);
	const hex = bytesToHex(randomBytes);
	return `impala-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
}

/**
 * Leitet aus dem Sync-Schlüssel deterministisch ab:
 * 1. userId (öffentlicher Bezeichner für den Cloudflare-Kanal / D1 Partition)
 * 2. cryptoKey (geheimer AES-GCM 256-Bit Schlüssel, bleibt ausschließlich im Browser)
 */
export async function deriveSyncCredentials(syncKey) {
	const cleanKey = String(syncKey || "").trim();
	if (!cleanKey) throw new Error("Sync-Schlüssel darf nicht leer sein.");
	if (typeof crypto === "undefined" || !crypto.subtle) {
		throw new Error("Web Crypto API (crypto.subtle) ist in dieser Umgebung nicht verfügbar. Bitte nutze HTTPS.");
	}

	// Öffentliche User-ID: SHA-256 Hash mit Salz
	const userId = await sha256Hex(`impala67_user_partition:${cleanKey}`);

	// Autorisierungs-Token: Beweist dem Server Schreib- und Löschberechtigung
	const authToken = await sha256Hex(`impala67_auth_token:${cleanKey}`);

	// Geheimer AES-GCM Schlüssel via PBKDF2
	const saltDigest = await crypto.subtle.digest("SHA-256", enc.encode(`impala67_e2ee_salt:${cleanKey}`));
	const baseKey = await crypto.subtle.importKey(
		"raw",
		enc.encode(cleanKey),
		{ name: "PBKDF2" },
		false,
		["deriveKey"]
	);

	const cryptoKey = await crypto.subtle.deriveKey(
		{
			name: "PBKDF2",
			salt: new Uint8Array(saltDigest),
			iterations: 100000,
			hash: "SHA-256",
		},
		baseKey,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"]
	);

	return { userId, authToken, cryptoKey };
}

/**
 * Verschlüsselt ein beliebiges JS-Objekt mit AES-GCM
 */
export async function encryptPayload(cryptoKey, dataObj) {
	if (!cryptoKey) throw new Error("Kein Verschlüsselungsschlüssel vorhanden.");
	const rawBytes = enc.encode(JSON.stringify(dataObj));
	let payloadBytes = rawBytes;
	let encoding = "";
	if (rawBytes.byteLength >= COMPRESSION_THRESHOLD_BYTES && typeof CompressionStream === "function") {
		const compressed = new Uint8Array(await new Response(
			new Blob([rawBytes]).stream().pipeThrough(new CompressionStream("gzip"))
		).arrayBuffer());
		if (compressed.byteLength < rawBytes.byteLength) {
			payloadBytes = compressed;
			encoding = "gz:";
		}
	}
	
	// 12-Byte IV für AES-GCM
	const iv = new Uint8Array(12);
	crypto.getRandomValues(iv);

	const ciphertextBuffer = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		cryptoKey,
		payloadBytes
	);

	const cipherBytes = new Uint8Array(ciphertextBuffer);
	const dataBase64 = encoding + bytesToBase64(cipherBytes);
	const ivHex = bytesToHex(iv);
	const size = cipherBytes.byteLength + iv.byteLength;

	return {
		iv: ivHex,
		data: dataBase64,
		size,
	};
}

/**
 * Entschlüsselt ein verschlüsseltes Paket { iv, data }
 */
export async function decryptPayload(cryptoKey, encryptedObj) {
	if (!cryptoKey) throw new Error("Kein Verschlüsselungsschlüssel vorhanden.");
	if (!encryptedObj || !encryptedObj.iv || !encryptedObj.data) {
		throw new Error("Ungültiges Verschlüsselungspaket.");
	}

	const iv = hexToBytes(encryptedObj.iv);
	const isGzip = String(encryptedObj.data).startsWith("gz:");
	const cipherBytes = base64ToBytes(isGzip ? encryptedObj.data.slice(3) : encryptedObj.data);

	const decryptedBuffer = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv },
		cryptoKey,
		cipherBytes
	);

	let plainBytes = new Uint8Array(decryptedBuffer);
	if (isGzip) {
		if (typeof DecompressionStream !== "function") {
			throw new Error("Gzip-komprimierte Cloud-Daten werden auf diesem Gerät nicht unterstützt.");
		}
		plainBytes = new Uint8Array(await new Response(
			new Blob([plainBytes]).stream().pipeThrough(new DecompressionStream("gzip"))
		).arrayBuffer());
	}
	const jsonStr = dec.decode(plainBytes);
	return JSON.parse(jsonStr);
}

/**
 * Hilfsfunktion zur formatierten Darstellung von Byte-Größen
 */
export function formatStorageUsage(bytes, limit = MAX_USER_STORAGE_BYTES) {
	const b = Math.max(0, Number(bytes) || 0);
	const lim = Math.max(1, Number(limit) || MAX_USER_STORAGE_BYTES);
	const mbUsed = (b / (1024 * 1024)).toFixed(1);
	const mbLimit = (lim / (1024 * 1024)).toFixed(0);
	const percent = Math.min(100, Math.round((b / lim) * 100));
	return {
		bytes: b,
		limit: lim,
		mbUsed: Number(mbUsed),
		mbLimit: Number(mbLimit),
		percent,
		formatted: `${mbUsed} MB / ${mbLimit} MB (${percent} %)`,
	};
}
