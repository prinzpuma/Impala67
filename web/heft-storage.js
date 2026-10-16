"use strict";
import { S, STATE } from "./state.js";
import { DB } from "./db.js";
import { U } from "./util.js";
import { blobId } from "./heft-document-core.js";

const enc = new TextEncoder(), dec = new TextDecoder();

// ---- Schlüssel-Helfer für Persistenz und Altbestände ----
export const KEY = (p) => "heft:" + p;
export const INK_LEGACY = (p) => "impala67.ink." + p;

// ---- Bilder, Scans und PDF-Seiten als eigene, unveränderliche Blob-Events ----
// Ein Foto oder Scan ist schnell 1–3 MB groß. Bisher steckte die komplette dataURL
// IM Bild-Objekt des Hefts. Folge: jedes Verschieben und jedes Skalieren schickte das
// ganze Bild erneut durchs Log (die Signatur änderte sich, also ging ein "i=" mit
// voller Nutzlast raus), und jeder Verdichtungs-Snapshot trug sämtliche Bilder noch
// einmal mit sich. Bei ein paar gescannten Seiten wuchs das Log dadurch in Minuten
// um zweistellige Megabyte — genau die Datenmenge, die der Sync danach hin- und
// hertragen musste.
// Jetzt wird der Bildinhalt GENAU EINMAL als "heftBlob" geschrieben; das Heft merkt
// sich nur noch den Inhalts-Hash ({ id, ref, x, y, w, h }, ca. 80 Byte). Verschieben
// kostet damit ein paar Byte statt ein paar Megabyte, und zwei Geräte, die dasselbe
// Bild einfügen, teilen sich automatisch einen Eintrag (gleicher Inhalt = gleicher Hash).
const pendingBlobData = new Map();
const blobWrites = new Map();

export function ensureBlobPersisted(hash, dataUrl) {
	if (blobWrites.has(hash)) return blobWrites.get(hash);
	const write = STATE.dispatch("heftBlob", { hash, data: dataUrl }).then(() => {
		pendingBlobData.delete(hash);
	}).finally(() => {
		if (blobWrites.get(hash) === write) blobWrites.delete(hash);
	});
	blobWrites.set(hash, write);
	return write;
}

export function blobRef(dataUrl) {
	const hash = blobId(dataUrl);
	if (!S.heftBlobs[hash]) {
		// Sofort im Speicher hinterlegen, damit das Bild ohne Wartezeit gezeichnet werden
		// kann; das Event ist nur die Persistenz (der Reducer überschreibt nichts).
		S.heftBlobs[hash] = dataUrl;
		pendingBlobData.set(hash, dataUrl);
		void ensureBlobPersisted(hash, dataUrl).catch((e) => console.warn("Heft: Bilddaten speichern fehlgeschlagen", e));
	}
	return hash;
}

export async function persistReferencedBlobs(saveDoc) {
	const refs = new Set((saveDoc?.pages || []).flatMap((pg) => (pg.images || []).map((im) => im.ref).filter(Boolean)));
	for (const ref of refs) {
		const data = pendingBlobData.get(ref);
		if (data) await ensureBlobPersisted(ref, data);
	}
}

// Bildquelle auflösen: neue Bilder tragen ref, Alt-Bestände noch src.
export const imgSrc = (im) => (im && im.ref ? (S.heftBlobs[im.ref] || "") : (im && im.src) || "");

// Alt-Bild (dataURL inline) beim ersten Anfassen in eine Referenz umschreiben.
export function toRefImage(im) {
	if (!im || !im.src || im.ref) return im;
	const { src, ...rest } = im;
	return { ...rest, ref: blobRef(src) };
}

// ---- Alt-Bestände & Normalisierung ----
// Alt-Bestände (Blob je Heft bzw. localStorage-Ink) werden beim ersten Öffnen
// EINMAL in ein heftSnap-Event überführt. Danach lebt das Heft nur noch im Log.
export function normalizeDoc(d) {
	const withId = (o) => (o && o.id ? o : { ...o, id: U.uid() });
	const pages = (d && Array.isArray(d.pages) ? d.pages : []).map((pg) => ({
		id: pg.id || U.uid(),
		paper: pg.paper || "lined",
		strokes: (pg.strokes || []).map(withId),
		images: (pg.images || []).map((im) => toRefImage(withId(im))),
		texts: (pg.texts || []).map(withId),
		ocrText: pg.ocrText || "",
	}));
	return pages.length ? { v: 2, rev: 0, pages } : null;
}

export async function readLegacyDoc(p) {
	try {
		const rec = await DB.getBlob(KEY(p));
		if (rec && rec.buf && rec.buf.byteLength) {
			const parsed = JSON.parse(dec.decode(rec.buf));
			const norm = normalizeDoc(parsed);
			if (norm) return norm;
		}
	} catch (e) { console.warn("Heft: Alt-Blob lesen fehlgeschlagen", e); }
	const legacy = takeLegacyInk(p);
	if (legacy) return normalizeDoc({ pages: [{ paper: "lined", strokes: legacy }] });
	return null;
}

export function takeLegacyInk(p) {
	try {
		if (typeof localStorage === "undefined") return null;
		const raw = localStorage.getItem(INK_LEGACY(p));
		if (!raw) return null;
		const d = JSON.parse(raw);
		localStorage.removeItem(INK_LEGACY(p));
		if (d && Array.isArray(d.strokes) && d.strokes.length) return d.strokes;
	} catch (e) { console.warn("Heft: Legacy-Ink lesen fehlgeschlagen", e); }
	return null;
}

export function purgeOrphanLegacyInk() {
	try {
		if (typeof localStorage === "undefined") return;
		const doomed = [];
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (k && k.startsWith("impala67.ink.")) doomed.push(k);
		}
		doomed.forEach((k) => {
			const id = k.slice("impala67.ink.".length);
			const pg = S.pages && S.pages[id];
			if (pg && pg.kind === "heft") return;
			localStorage.removeItem(k);
		});
	} catch {  }
}

// ---- Verlauf: lokale Snapshots je Heft ----
// Zeitstempel + rev stecken im Blob-Key ("heftver:<pid>:<t>:<rev>") — Auflisten und
// Aufräumen brauchen so nur allBlobKeys(), keine Meta-Reads. Bewusst NICHT über Drive
// gesynct: Snapshots erzeugen keine heftUpdated-Events, der Sync sieht sie nie.
const VER_PREFIX = (p) => "heftver:" + p + ":";
const VER_TTL = 24 * 60 * 60 * 1000, VER_GAP = 10 * 60 * 1000, VER_MAX = 20;
const verLast = {}; // letzter Snapshot-Zeitpunkt je Heft (spart Key-Scan bei jedem Save)

export async function listSnapshots(p) {
	const pre = VER_PREFIX(p);
	return (await DB.allBlobKeys())
		.filter((k) => k.startsWith(pre))
		.map((k) => { const [t, rev] = k.slice(pre.length).split(":"); return { key: k, t: Number(t) || 0, rev: Number(rev) || 0 }; })
		.sort((a, b) => b.t - a.t);
}

export async function pruneSnapshots(p) {
	const cutoff = Date.now() - VER_TTL;
	const all = await listSnapshots(p);
	const keep = all.filter((s, i) => i < VER_MAX && s.t >= cutoff);
	for (const s of all) if (!keep.includes(s)) await DB.delBlob(s.key);
	return keep;
}

export const encodeDoc = (d) => {
	const b = enc.encode(JSON.stringify({ v: 2, pages: (d && d.pages) || [] }));
	return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

export async function writeSnapshot(p, buf, rev) {
	const t = Date.now();
	await DB.putBlob(VER_PREFIX(p) + t + ":" + rev, buf, { type: "application/json", kind: "heftver" });
	verLast[p] = t;
}

export async function maybeSnapshot(p, d) {
	try {
		if (!verLast[p]) { const s = await listSnapshots(p); verLast[p] = s.length ? s[0].t : 0; }
		if (Date.now() - verLast[p] < VER_GAP) return; // gedrosselt: max. alle 10 Min.
		await writeSnapshot(p, encodeDoc(d), ((d && d.pages) || []).length);
		await pruneSnapshots(p);
	} catch (e) { console.warn("Heft: Verlauf-Snapshot fehlgeschlagen", e); }
}

export async function loadSnapshotDoc(key) {
	try {
		const rec = await DB.getBlob(key);
		if (!rec || !rec.buf) return null;
		return normalizeDoc(JSON.parse(dec.decode(rec.buf)));
	} catch (e) {
		console.warn("Heft: Snapshot decodieren fehlgeschlagen", e);
		return null;
	}
}

export async function restoreSnapshot(p, key, { getCurrentDoc, restoreDoc, toast = U.toast } = {}) {
	const rec = await DB.getBlob(key);
	if (!rec || !rec.buf) { if (toast) toast("Snapshot nicht mehr vorhanden", "error"); return; }
	const cur = getCurrentDoc ? await getCurrentDoc(p) : null;
	// Sicherheitsnetz: aktuellen Stand IMMER sichern — Wiederherstellen ist damit selbst umkehrbar.
	if (cur) await writeSnapshot(p, encodeDoc(cur), ((cur && cur.pages) || []).length);
	let restored = null;
	try {
		restored = normalizeDoc(JSON.parse(dec.decode(rec.buf)));
	} catch (e) {
		console.warn("Heft: Snapshot decodieren fehlgeschlagen", e);
	}
	if (!restored) { if (toast) toast("Snapshot ist leer", "error"); return; }
	// Wiederherstellen ist ein normales Event — es synchronisiert damit von allein.
	if (restoreDoc) await restoreDoc(p, restored);
	if (toast) toast("Heft-Stand wiederhergestellt");
}
