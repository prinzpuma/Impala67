"use strict";

import { DB } from "./db.js";
import { U } from "./util.js";

// Gemeinsame Medienauflösung für Markdown-ZIP und Druck/PDF. Lokale Editor-
// Medien stehen im Markdown nur als IndexedDB-ID (img:/file:); außerhalb der
// App wären diese Verweise wertlos. Parser und Namensregel leben deshalb hier.
const IMAGE_RE = /!\[([^\]]*)\]\((img:[^)\s]+)(?:\s+["'][^)]*["'])?\)/g;
const FILE_RE = /^(\s*):::file\s+(file:\S+)(?:\s+(.+?))?\s*$/gm;

const MIME_EXT = {
	"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif",
	"image/webp": ".webp", "image/svg+xml": ".svg", "application/pdf": ".pdf",
	"audio/mpeg": ".mp3", "audio/mp4": ".m4a", "video/mp4": ".mp4",
	"text/plain": ".txt", "text/markdown": ".md",
};

export function safeExportName(value, fallback = "Datei") {
	return String(value || fallback).replace(/[\\/:*?"<>|#]/g, "_").trim().slice(0, 100) || fallback;
}

export function mediaReferences(markdown) {
	const refs = [], seen = new Set();
	const add = (id, name, kind) => {
		if (!id || seen.has(id)) return;
		seen.add(id); refs.push({ id, name: String(name || ""), kind });
	};
	String(markdown || "").replace(IMAGE_RE, (_all, alt, id) => { add(id, alt, "image"); return _all; });
	String(markdown || "").replace(FILE_RE, (_all, _indent, id, name) => { add(id, name, "file"); return _all; });
	return refs;
}

export function rewriteMediaReferences(markdown, hrefs) {
	const hrefOf = (id) => hrefs instanceof Map ? hrefs.get(id) : hrefs?.[id];
	return String(markdown || "")
		.replace(IMAGE_RE, (all, alt, id) => hrefOf(id) ? `![${alt}](${hrefOf(id)})` : all)
		.replace(FILE_RE, (all, indent, id, name) => hrefOf(id) ? `${indent}[${name || "Datei"}](${hrefOf(id)})` : all);
}

function extensionFor(name, mime) {
	const hit = String(name || "").match(/\.[a-z0-9]{1,8}$/i);
	return hit ? hit[0].toLowerCase() : MIME_EXT[String(mime || "").toLowerCase()] || "";
}

export async function loadExportAsset(id, preferredName) {
	const rec = await DB.getBlob(id);
	const buf = rec && (rec.buf || rec.data);
	if (!buf || !buf.byteLength) return null;
	const mime = rec.meta?.type || "application/octet-stream";
	const rawName = preferredName || rec.meta?.name || id.replace(/^[^:]+:/, "") || "Datei";
	let name = safeExportName(rawName);
	const ext = extensionFor(name, mime);
	if (ext && !name.toLowerCase().endsWith(ext)) name += ext;
	return { id, name, mime, data: new Uint8Array(buf) };
}

export async function inlineLocalImages(markdown) {
	const hrefs = new Map();
	for (const ref of mediaReferences(markdown).filter((item) => item.kind === "image")) {
		const asset = await loadExportAsset(ref.id, ref.name);
		if (asset) hrefs.set(ref.id, `data:${asset.mime};base64,${U.bufToB64(asset.data.buffer)}`);
	}
	return rewriteMediaReferences(markdown, hrefs);
}

export const EXPORT_MEDIA = { safeExportName, mediaReferences, rewriteMediaReferences, loadExportAsset, inlineLocalImages };
