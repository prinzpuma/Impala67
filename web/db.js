"use strict";
import { U } from "./util.js";
// db.js — IndexedDB-Persistenz: Event-Log (append-only) + PDF-Blobs.
// Sync-Modell: Export = Log + Blobs als JSON. Import = Log-Merge (nur unbekannte
// Events werden übernommen, sortiert nach Zeitstempel deterministisch abgespielt).
// Ein späterer Google-Drive-Sync ersetzt nur Export/Import durch die Drive-API —
// am Datenmodell ändert sich nichts.
export const DB = (() => {
	let db = null;

	function openRaw(name, version) {
		return new Promise((resolve, reject) => {
			const req = version ? indexedDB.open(name, version) : indexedDB.open(name);
			req.onupgradeneeded = () => {
				// Ohne Versionsangabe wird nur GEPRÜFT, ob die DB existiert — nie neu anlegen.
				if (!version) { req.transaction.abort(); resolve(null); return; }
				const d = req.result;
				if (!d.objectStoreNames.contains("events")) {
					d.createObjectStore("events", { keyPath: "seq", autoIncrement: true });
				}
				if (!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs");
				if (!d.objectStoreNames.contains("vecs")) d.createObjectStore("vecs");
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}

	// Einmalige Migration: die Datenbank hieß vor der Umbenennung "notion". Beim ersten
	// Start unter dem neuen Namen werden alle Stores kopiert — die alte DB bleibt als
	// Sicherheitsnetz liegen (wird erst bei resetDatabase mit entsorgt).
	async function migrateLegacy() {
		const hasEvents = await val(db.transaction("events").objectStore("events").count());
		if (hasEvents) return;
		let legacy = null;
		try { legacy = await openRaw("notion"); } catch { return; }
		if (!legacy || !legacy.objectStoreNames.contains("events")) { if (legacy) legacy.close(); return; }
		for (const store of ["events", "blobs", "vecs"]) {
			if (!legacy.objectStoreNames.contains(store)) continue;
			const src = legacy.transaction(store).objectStore(store);
			const keys = await val(src.getAllKeys());
			const vals = await val(legacy.transaction(store).objectStore(store).getAll());
			const t = db.transaction(store, "readwrite");
			const dst = t.objectStore(store);
			vals.forEach((v, i) => { if (store === "events") dst.put(v); else dst.put(v, keys[i]); });
			await done(t);
		}
		legacy.close();
	}

	async function open() {
		db = await openRaw("impala67", 2);
		await migrateLegacy();
	}

	const done = (t) => new Promise((res, rej) => {
		t.oncomplete = () => res();
		t.onerror = () => rej(t.error);
		t.onabort = () => rej(t.error);
	});
	const val = (r) => new Promise((res, rej) => {
		r.onsuccess = () => res(r.result);
		r.onerror = () => rej(r.error);
	});

	async function addEvent(ev) {
		const t = db.transaction("events", "readwrite");
		t.objectStore("events").add(ev);
		return done(t);
	}
	// Viele Events in EINER Transaktion — beim Import/Sync um Größenordnungen schneller.
	async function addEvents(evs) {
		const t = db.transaction("events", "readwrite");
		const store = t.objectStore("events");
		evs.forEach((ev) => store.add(ev));
		return done(t);
	}
	async function allEvents() {
		return val(db.transaction("events").objectStore("events").getAll());
	}
	async function putBlob(id, buf, meta) {
		const t = db.transaction("blobs", "readwrite");
		t.objectStore("blobs").put({ buf, meta }, id);
		return done(t);
	}
	async function getBlob(id) {
		return val(db.transaction("blobs").objectStore("blobs").get(id));
	}
	async function allBlobKeys() {
		return val(db.transaction("blobs").objectStore("blobs").getAllKeys());
	}

	// Embedding-Vektoren (RAG) — nicht Teil des Event-Logs, lokal neu berechenbar
	async function putVec(pageId, rec) {
		const t = db.transaction("vecs", "readwrite");
		t.objectStore("vecs").put(rec, pageId);
		return done(t);
	}
	async function getVec(pageId) {
		return val(db.transaction("vecs").objectStore("vecs").get(pageId));
	}
	async function delVec(pageId) {
		const t = db.transaction("vecs", "readwrite");
		t.objectStore("vecs").delete(pageId);
		return done(t);
	}
	async function allVecs() {
		const keys = await val(db.transaction("vecs").objectStore("vecs").getAllKeys());
		const out = {};
		for (const k of keys) out[k] = await getVec(k);
		return out;
	}

	// ---- Log-Kompaktierung -----------------------------------------------------
	// Verlustfrei & deterministisch (drop-only): gleiche Event-Menge => gleiches
	// Ergebnis auf jedem Gerät => der Log-Merge (Union nach Event-id) bleibt
	// konsistent, auch wenn Geräte zu unterschiedlichen Zeitpunkten kompaktieren.
	//
	// Zwei Regeln:
	// 1. Patch-Events (pageUpdate/cardUpdate/settingsSet) sind wirkungslos, wenn ALLE
	//    ihre Felder von neueren Patches desselben Ziels überschrieben werden.
	//    pageUpdate trägt bei jedem Edit den vollen content — DER Speicherfresser:
	//    von hunderten Zwischenständen einer Seite überlebt nur der letzte.
	// 2. pageUpdate/cardUpdate endgültig gelöschter Seiten/Karten sind wirkungslos
	//    („endgültig löschen“ entfernt den Inhalt damit auch wirklich aus dem Log).
	// Alles andere (Create/Move/Trash/Reviews/Deck-Events) bleibt unangetastet — die
	// Events sind klein und teils reihenfolge-abhängig (Subtree-/Zyklus-Logik).
	function compactEvents(events) {
		const sorted = [...events].sort((a, b) => a.t.localeCompare(b.t) || (a.seq || 0) - (b.seq || 0));
		const pageDeletedAt = {}, cardDeletedAt = {};
		for (const ev of sorted) {
			if (!ev.payload) continue;
			if (ev.type === "pageDelete") pageDeletedAt[ev.payload.id] = ev.t;
			if (ev.type === "cardDelete") cardDeletedAt[ev.payload.id] = ev.t;
		}
		const covered = {}; // Ziel -> Felder, die bereits von NEUEREN Events gesetzt werden
		const keep = [];
		for (let i = sorted.length - 1; i >= 0; i--) { // rückwärts: neueste zuerst
			const ev = sorted[i], p = ev.payload || {};
			if (ev.type === "pageUpdate" && pageDeletedAt[p.id] && ev.t <= pageDeletedAt[p.id]) continue;
			if (ev.type === "cardUpdate" && cardDeletedAt[p.id] && ev.t <= cardDeletedAt[p.id]) continue;
			let bucket = null, patch = null;
			if (ev.type === "pageUpdate") { bucket = "page:" + p.id; patch = p.patch; }
			else if (ev.type === "cardUpdate") { bucket = "card:" + p.id; patch = p.patch; }
			else if (ev.type === "settingsSet") { bucket = "settings"; patch = p; }
			if (bucket && patch) {
				const seen = covered[bucket] || (covered[bucket] = new Set());
				const keys = Object.keys(patch);
				if (keys.length && keys.every((k) => seen.has(k))) continue; // komplett überschrieben
				keys.forEach((k) => seen.add(k));
			}
			keep.push(ev);
		}
		return keep.reverse();
	}

	// Lokalen Event-Store kompaktiert neu schreiben. Nur nach erfolgreichem Sync
	// aufrufen: die Sequenznummern werden neu vergeben, der Sync-Wasserstand
	// (impala67_drive_synced_seq) muss danach neu gesetzt werden. Unter minDrop
	// gesparten Events lohnt das Neuschreiben nicht.
	async function compactLocal(minDrop = 200) {
		const evs = await allEvents();
		const compacted = compactEvents(evs);
		if (evs.length - compacted.length < minDrop) return 0;
		const t = db.transaction("events", "readwrite");
		const store = t.objectStore("events");
		store.clear();
		compacted.forEach((ev) => { const e = { ...ev }; delete e.seq; store.add(e); });
		await done(t);
		return evs.length - compacted.length;
	}

	// Höchste lokale Sequenznummer — Basis des Sync-Wasserstands („was war schon hochgeladen?“).
	function maxSeq() {
		return new Promise((res, rej) => {
			const req = db.transaction("events").objectStore("events").openCursor(null, "prev");
			req.onsuccess = () => res(req.result ? Number(req.result.key) : 0);
			req.onerror = () => rej(req.error);
		});
	}

	async function exportAll() {
		// Keys/Tokens niemals exportieren: alte settingsSet-Events werden beim Export
		// bereinigt (neue enthalten ohnehin keine Secrets mehr — siehe state.js).
		// Kompaktiert exportieren: Drive-Datei & Backups enthalten keine toten Zwischenstände.
		const events = compactEvents(await allEvents()).map((ev) => {
			if (ev.type !== "settingsSet" || !ev.payload) return ev;
			const p = { ...ev.payload };
			if (p.notionToken) p.notionToken = "";
			if (p.corsProxy) p.corsProxy = "";
			if (Array.isArray(p.aiProviders)) p.aiProviders = p.aiProviders.map((pr) => ({ ...pr, key: "" }));
			return { ...ev, payload: p };
		});
		const keys = await allBlobKeys();
		const blobs = {};
		for (const k of keys) {
			const rec = await getBlob(k);
			blobs[k] = { meta: rec.meta, b64: U.bufToB64(rec.buf) };
		}
		return JSON.stringify({ app: "impala67", version: 1, exportedAt: U.now(), events, blobs });
	}

	// Merge-Import: idempotent — doppelte Events (gleiche id) werden übersprungen.
	// opts (nur beim Drive-Sync gesetzt):
	//   unsyncedAfterSeq — Sequenznummer des letzten erfolgreichen Uploads. Lokale Events
	//     danach kennt noch kein anderes Gerät → Basis der Konflikt-Erkennung.
	//   pageInfo(id) — liefert {title, parentId, workspaceId} für Konfliktkopien.
	// Rückgabe: { added, conflicts }.
	async function importAll(json, opts = {}) {
		const data = JSON.parse(json);
		// Alt-Exporte (app: "notion") bleiben importierbar — gleiche Datenstruktur, nur anderer Name.
		if (data.app !== "impala67" && data.app !== "notion") throw new Error("Keine Impala67-Exportdatei.");
		const local = await allEvents();
		const existing = new Set(local.map((e) => e.id));
		const fresh = (data.events || []).filter((ev) => !existing.has(ev.id));
		// Konflikt-Erkennung: dieselbe Seite wurde seit dem letzten Sync lokal UND auf einem
		// anderen Gerät inhaltlich geändert. Der Log-Merge entscheidet still per „späterer
		// Zeitstempel gewinnt“ — der unterlegene Stand wird hier als Konfliktkopie gerettet.
		// Deterministische Event-id: erkennen BEIDE Geräte denselben Konflikt, entsteht die
		// Kopie trotzdem nur einmal (der Merge dedupliziert nach id).
		let conflictCount = 0;
		if (typeof opts.unsyncedAfterSeq === "number" && fresh.length) {
			const contentHeads = (evs, extra) => {
				const heads = {};
				for (const ev of evs) {
					const p = ev.payload || {};
					if (ev.type === "pageUpdate" && p.patch && typeof p.patch.content === "string" && (!extra || extra(ev))) heads[p.id] = ev;
				}
				return heads;
			};
			const localHeads = contentHeads(local, (ev) => (ev.seq || 0) > opts.unsyncedAfterSeq);
			const remoteHeads = contentHeads(fresh);
			for (const [id, remote] of Object.entries(remoteHeads)) {
				const mine = localHeads[id];
				if (!mine || mine.payload.patch.content === remote.payload.patch.content) continue;
				const loser = mine.t <= remote.t ? mine : remote; // Replay: späterer Zeitstempel gewinnt
				if (existing.has("conflict-" + loser.id)) continue;
				const info = (opts.pageInfo && opts.pageInfo(id)) || {};
				fresh.push({
					id: "conflict-" + loser.id, t: U.now(), type: "pageCreate",
					payload: {
						id: "conflictpg-" + loser.id,
						title: "⚠ Konflikt: " + (info.title || "Seite") + " — Stand " + loser.t.slice(0, 16).replace("T", " "),
						content: loser.payload.patch.content,
						parentId: info.parentId || null, workspaceId: info.workspaceId || "default",
					},
				});
				conflictCount++;
			}
		}
		fresh.forEach((ev) => { delete ev.seq; }); // neue lokale Sequenznummer
		if (fresh.length) await addEvents(fresh);
		for (const [k, v] of Object.entries(data.blobs || {})) {
			if (!(await getBlob(k))) await putBlob(k, U.b64ToBuf(v.b64), v.meta);
		}
		return { added: fresh.length, conflicts: conflictCount };
	}

	async function resetDatabase() {
		return new Promise((resolve, reject) => {
			if (db) db.close();
			db = null;
			indexedDB.deleteDatabase("notion"); // Alt-Datenbank (vor der Umbenennung) mit entsorgen
			const req = indexedDB.deleteDatabase("impala67");
			req.onsuccess = () => resolve();
			req.onerror = () => reject(req.error);
			// Ohne diesen Handler bleibt das Promise für immer offen, wenn ein anderer Tab
			// dieselbe Datenbank noch geöffnet hält (weder onsuccess noch onerror feuern dann).
			req.onblocked = () => reject(new Error("Datenbank ist noch in einem anderen Tab geöffnet. Bitte alle anderen Tabs dieser App schließen und erneut versuchen."));
		});
	}

	async function clearPages() {
		const t = db.transaction(["events", "vecs", "blobs"], "readwrite");
		const evStore = t.objectStore("events");
		const pageTypes = new Set(["pageCreate", "pageUpdate", "pageMove", "pageDelete", "pageTrash", "pageRestore"]);
		// Löschungen synchron im onsuccess-Callback anstoßen: nach einem await kann
		// die Transaktion (v.a. in Safari) bereits automatisch geschlossen sein.
		const req = evStore.getAll();
		req.onsuccess = () => {
			for (const ev of req.result) {
				if (pageTypes.has(ev.type)) evStore.delete(ev.seq);
			}
		};
		t.objectStore("vecs").clear();
		// FIX (Audit): PDF-Blobs gehören zu den gelöschten Seiten und blieben bisher als
		// Speicherleck in IndexedDB zurück. Alles außer dem Hintergrundbild entsorgen —
		// Einstellungen (und damit das Hintergrundbild) sollen den Reset überleben.
		const blobStore = t.objectStore("blobs");
		const keysReq = blobStore.getAllKeys();
		keysReq.onsuccess = () => {
			for (const k of keysReq.result) {
				if (k !== "bgImage") blobStore.delete(k);
			}
		};
		return done(t);
	}

	return { open, addEvent, addEvents, allEvents, compactEvents, compactLocal, maxSeq, putBlob, getBlob, putVec, getVec, delVec, allVecs, exportAll, importAll, resetDatabase, clearPages };
})();