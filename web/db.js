"use strict";
// db.js — IndexedDB-Persistenz: Event-Log (append-only) + PDF-Blobs.
// Sync-Modell: Export = Log + Blobs als JSON. Import = Log-Merge (nur unbekannte
// Events werden übernommen, sortiert nach Zeitstempel deterministisch abgespielt).
// Ein späterer Google-Drive-Sync ersetzt nur Export/Import durch die Drive-API —
// am Datenmodell ändert sich nichts.
const DB = (() => {
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

	async function exportAll() {
		// Keys/Tokens niemals exportieren: alte settingsSet-Events werden beim Export
		// bereinigt (neue enthalten ohnehin keine Secrets mehr — siehe state.js).
		const events = (await allEvents()).map((ev) => {
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
	async function importAll(json) {
		const data = JSON.parse(json);
		// Alt-Exporte (app: "notion") bleiben importierbar — gleiche Datenstruktur, nur anderer Name.
		if (data.app !== "impala67" && data.app !== "notion") throw new Error("Keine Impala67-Exportdatei.");
		const existing = new Set((await allEvents()).map((e) => e.id));
		const fresh = (data.events || []).filter((ev) => !existing.has(ev.id));
		fresh.forEach((ev) => { delete ev.seq; }); // neue lokale Sequenznummer
		if (fresh.length) await addEvents(fresh);
		const added = fresh.length;
		for (const [k, v] of Object.entries(data.blobs || {})) {
			if (!(await getBlob(k))) await putBlob(k, U.b64ToBuf(v.b64), v.meta);
		}
		return added;
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
		const t = db.transaction(["events", "vecs"], "readwrite");
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
		return done(t);
	}

	return { open, addEvent, addEvents, allEvents, putBlob, getBlob, putVec, getVec, delVec, allVecs, exportAll, importAll, resetDatabase, clearPages };
})();