"use strict";

import { CORE } from "./rust-core.js";
import { BUS } from "./event-bus.js";

// zeitstrahl-store.js — Getrennte Lehrer-Datenbank des KI-Zeitstrahls.
// Eigene IndexedDB („impala67-lehrer“), unabhängig vom Event-Log der Notizen: kein Sync,
// keine Seitenliste, keine Speichergrenzen der Bibliothek. Die Logik (Upsert, Layout, Quiz,
// Meistern) liegt im Rust-Kern (core/impala-lehrer); hier nur Ein-/Ausgabe und ein Zwischenspeicher.

const DB_NAME = "impala67-lehrer";
const STORE = "timelines";

let dbPromise = null;
let cache = null; // Map id → Zeitstrahl
let loading = null;

function openDb() {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve, reject) => {
		if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB nicht verfügbar"));
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	}).catch((err) => { dbPromise = null; throw err; });
	return dbPromise;
}

function tx(mode, fn) {
	return openDb().then((db) => new Promise((resolve, reject) => {
		const t = db.transaction(STORE, mode);
		const out = fn(t.objectStore(STORE));
		t.oncomplete = () => resolve(out?.result ?? out);
		t.onerror = () => reject(t.error);
		t.onabort = () => reject(t.error);
	}));
}

// Ohne IndexedDB (Node-Tests) bleibt alles im Speicher.
async function load() {
	if (cache) return cache;
	if (!loading) {
		loading = (async () => {
			const map = new Map();
			try {
				const all = await tx("readonly", (st) => st.getAll());
				for (const tl of all || []) if (tl?.id) map.set(tl.id, tl);
			} catch { /* kein IndexedDB: leerer Speicher */ }
			cache = map;
			return map;
		})();
	}
	return loading;
}

async function persist(tl) {
	try { await tx("readwrite", (st) => st.put(tl)); } catch { /* Node/Tests: nur Speicher */ }
}

const norm = (s) => String(s ?? "").trim().toLowerCase();

export const ZS_STORE = {
	/** Schon geladen? (Synchrones Zeichnen braucht den Zwischenspeicher.) */
	ready: () => !!cache,
	load,
	/** Synchron aus dem Zwischenspeicher (nach load()). */
	all() {
		return cache ? [...cache.values()].sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || ""))) : [];
	},
	getSync(ref) {
		if (!cache || !ref) return null;
		if (cache.has(ref)) return cache.get(ref);
		const key = norm(ref);
		return [...cache.values()].find((tl) => norm(tl.title) === key || norm(tl.id) === key) || null;
	},
	async get(ref) {
		await load();
		return this.getSync(ref);
	},
	async put(tl) {
		await load();
		cache.set(tl.id, tl);
		await persist(tl);
		BUS.emit("zs:changed", tl.id);
		return tl;
	},
	async remove(id) {
		await load();
		cache.delete(id);
		try { await tx("readwrite", (st) => st.delete(id)); } catch {}
		BUS.emit("zs:changed", id);
	},
	/** Nur für Tests: Speicher leeren. */
	_reset() { cache = new Map(); loading = Promise.resolve(cache); },
};

// Dünne Hülle um den Kern: Zeit von außen, Fehler als { error }.
const now = () => new Date().toISOString();
const safe = (fn) => { try { return fn(); } catch (err) { return { error: String(err?.message || err) }; } };

export const ZS_CORE = {
	applyEdit: (tl, edit) => safe(() => CORE.lehrerApplyEdit(tl || null, edit, now())),
	view: (tl) => CORE.lehrerView(tl),
	recordQuiz: (tl, node, answers) => safe(() => CORE.lehrerRecordQuiz(tl, node, answers, now())),
	applyCheck: (tl, check) => safe(() => CORE.lehrerApplyCheck(tl, check, now())),
	describe: (tl, node) => safe(() => CORE.lehrerDescribe(tl, node || null)),
	listEntry: (tl) => CORE.lehrerListEntry(tl),
	toolDefs: () => { try { return CORE.lehrerToolDefs() || []; } catch { return []; } },
};
