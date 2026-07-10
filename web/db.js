"use strict";
import { U } from "./util.js";
// db.js — IndexedDB-Persistenz: Event-Log (append-only) + PDF-Blobs.
// Sync-Modell: Export = Log + Blobs als JSON. Import = Log-Merge (nur unbekannte
// Events werden übernommen, sortiert nach Zeitstempel deterministisch abgespielt).
// Ein späterer Google-Drive-Sync ersetzt nur Export/Import durch die Drive-API —
// am Datenmodell ändert sich nichts.
//
// Rewrite (10. Juli 2026): ensureOpen()/validateEvent() ergänzt (fehlende Validierung),
// open() memoisiert gegen parallele Doppel-Aufrufe, migrateLegacy() liest Keys+Werte
// jetzt aus derselben Transaktion, addEvent() ist nur noch ein addEvents()-Alias
// (vorher doppelter Code), resetDatabase() behandelt beide deleteDatabase()-Aufrufe
// jetzt mit echter Fehlerbehandlung, importAll() validiert data.events, allVecs()
// liest parallel statt sequenziell.
export const DB = (() => {
	let db = null;
	let openPromise = null; // Memoisiert offene/laufende open()-Aufrufe (verhindert Doppel-Open-Race)

	// FIX: vorher führte ein Aufruf vor open() zu einem kryptischen
	// "Cannot read properties of null" beim ersten db.transaction(...).
	function ensureOpen() {
		if (!db) throw new Error("DB.open() muss zuerst aufgerufen werden.");
	}

	// FIX: fehlende Validierung — ein Event ohne id/t/type ließ sich bisher klaglos
	// ins append-only Log schreiben und sorgte später für schwer auffindbare Bugs.
	function validateEvent(ev) {
		if (!ev || typeof ev !== "object") throw new Error("Event muss ein Objekt sein.");
		if (!ev.id || !ev.t || !ev.type) throw new Error("Event benötigt id, t und type.");
	}

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

	const done = (t) => new Promise((res, rej) => {
		t.oncomplete = () => res();
		t.onerror = () => rej(t.error);
		t.onabort = () => rej(t.error);
	});
	const val = (r) => new Promise((res, rej) => {
		r.onsuccess = () => res(r.result);
		r.onerror = () => rej(r.error);
	});

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
			// FIX: Keys + Werte jetzt aus DERSELBEN Quell-Transaktion lesen (vorher zwei
			// separate readonly-Transaktionen — theoretisch inkonsistent, falls zwischen
			// beiden noch geschrieben wird) und parallel statt nacheinander abgefragt.
			const srcStore = legacy.transaction(store).objectStore(store);
			const [keys, vals] = await Promise.all([val(srcStore.getAllKeys()), val(srcStore.getAll())]);
			const destTx = db.transaction(store, "readwrite");
			const destStore = destTx.objectStore(store);
			vals.forEach((v, i) => { if (store === "events") destStore.put(v); else destStore.put(v, keys[i]); });
			await done(destTx);
		}
		legacy.close();
	}

	// FIX: mehrfache/parallele open()-Aufrufe teilten sich bisher KEINEN gemeinsamen
	// Zustand — zwei gleichzeitige Aufrufe (z.B. durch einen doppelten Boot-Pfad)
	// konnten die DB parallel öffnen und die Migration doppelt anstoßen (Race Condition).
	// Jetzt liefert ein laufender open() denselben Promise an alle Aufrufer; schlägt er
	// fehl, wird der nächste Aufruf einen neuen Versuch starten.
	function open() {
		if (!openPromise) {
			openPromise = (async () => {
				db = await openRaw("impala67", 2);
				await migrateLegacy();
			})().catch((e) => { openPromise = null; throw e; });
		}
		return openPromise;
	}

	// Viele Events in EINER Transaktion — beim Import/Sync um Größenordnungen schneller.
	async function addEvents(evs) {
		ensureOpen();
		const list = Array.isArray(evs) ? evs : [evs];
		if (!list.length) return;
		list.forEach(validateEvent);
		const t = db.transaction("events", "readwrite");
		const store = t.objectStore("events");
		list.forEach((ev) => store.add(ev));
		return done(t);
	}
	// addEvent war vorher fast identischer Code (eigene Transaktion, ein add()) —
	// jetzt nur noch ein Alias auf addEvents([ev]) (dedupliziert).
	const addEvent = (ev) => addEvents([ev]);

	async function allEvents() {
		ensureOpen();
		return val(db.transaction("events").objectStore("events").getAll());
	}
	async function putBlob(id, buf, meta) {
		ensureOpen();
		const t = db.transaction("blobs", "readwrite");
		t.objectStore("blobs").put({ buf, meta }, id);
		return done(t);
	}
	async function getBlob(id) {
		ensureOpen();
		return val(db.transaction("blobs").objectStore("blobs").get(id));
	}
	async function allBlobKeys() {
		ensureOpen();
		return val(db.transaction("blobs").objectStore("blobs").getAllKeys());
	}

	// Embedding-Vektoren (RAG) — nicht Teil des Event-Logs, lokal neu berechenbar
	async function putVec(pageId, rec) {
		ensureOpen();
		const t = db.transaction("vecs", "readwrite");
		t.objectStore("vecs").put(rec, pageId);
		return done(t);
	}
	async function getVec(pageId) {
		ensureOpen();
		return val(db.transaction("vecs").objectStore("vecs").get(pageId));
	}
	async function delVec(pageId) {
		ensureOpen();
		const t = db.transaction("vecs", "readwrite");
		t.objectStore("vecs").delete(pageId);
		return done(t);
	}
	async function allVecs() {
		ensureOpen();
		const keys = await val(db.transaction("vecs").objectStore("vecs").getAllKeys());
		// PERF: parallel statt einer sequenziellen await-Schleife über getVec().
		const entries = await Promise.all(keys.map(async (k) => [k, await getVec(k)]));
		return Object.fromEntries(entries);
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
		ensureOpen();
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

	// Höchste lokale Sequenznummer — Basis des Sync-Wasserstands („war was schon hochgeladen?“).
	function maxSeq() {
		ensureOpen();
		return new Promise((res, rej) => {
			const req = db.transaction("events").objectStore("events").openCursor(null, "prev");
			req.onsuccess = () => res(req.result ? Number(req.result.key) : 0);
			req.onerror = () => rej(req.error);
		});
	}

	async function exportAll() {
		ensureOpen();
		// Keys/Tokens niemals exportieren: alte settingsSet-Events werden beim Export
		// bereinigt (neue enthalten ohnehin keine Secrets mehr — siehe state.js).
		// Kompaktiert exportieren: Drive-Datei & Backups enthalten keine toten Zwischenstände.
		const events = compactEvents(await allEvents()).map((ev) => {
			if (ev.type !== "settingsSet" || !ev.payload) return ev;
			const p = { ...ev.payload };
			if (p.notionToken) p.notionToken = "";
			if (p.corsProxy) p.corsProxy = "";
			// FIX (Audit): Alt-Events mit Desktop-Secret aus Export/Drive-Sync entfernen
			if (p.driveDesktopClientSecret) p.driveDesktopClientSecret = "";
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
	// Rückgabe: { added, conflicts, conflictDetails }.
	async function importAll(json, opts = {}) {
		ensureOpen();
		const data = JSON.parse(json);
		// Alt-Exporte (app: "notion") bleiben importierbar — gleiche Datenstruktur, nur anderer Name.
		if (data.app !== "impala67" && data.app !== "notion") throw new Error("Keine Impala67-Exportdatei.");
		// FIX: fehlende Validierung — eine kaputte/fremde Exportdatei mit data.events als
		// Nicht-Array brach bisher mit einem kryptischen ".filter is not a function" ab.
		const incomingEvents = Array.isArray(data.events) ? data.events : [];
		const local = await allEvents();
		const existing = new Set(local.map((e) => e.id));
		const fresh = incomingEvents.filter((ev) => ev && ev.id && !existing.has(ev.id));
		// Konflikt-Erkennung: dieselbe Seite wurde seit dem letzten Sync lokal UND auf einem
		// anderen Gerät inhaltlich geändert. Der Log-Merge entscheidet still per „späterer
		// Zeitstempel gewinnt“ — der unterlegene Stand wird hier als Konfliktkopie gerettet.
		// conflictDetails speist das Lösungs-Popup (Grund + Diff) und den Homescreen-Banner.
		let conflictCount = 0;
		const conflictDetails = [];
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
				const title = info.title || "Seite";
				const winner = mine.t <= remote.t ? "remote" : "local";
				const conflictPageId = "conflictpg-" + loser.id;
				conflictDetails.push({
					pageId: id,
					title,
					reason: "Dieselbe Seite wurde seit dem letzten Sync sowohl hier als auch auf einem anderen Gerät am Inhalt geändert. Der neuere Zeitstempel gewinnt; der ältere Stand liegt als Kopie bereit.",
					localContent: mine.payload.patch.content,
					remoteContent: remote.payload.patch.content,
					localTime: mine.t,
					remoteTime: remote.t,
					winner,
					loserContent: loser.payload.patch.content,
					loserTime: loser.t,
					conflictPageId,
					eventId: "conflict-" + loser.id,
				});
				fresh.push({
					id: "conflict-" + loser.id, t: U.now(), type: "pageCreate",
					payload: {
						id: conflictPageId,
						title: "⚠ Konflikt: " + title + " — Stand " + loser.t.slice(0, 16).replace("T", " "),
						content: loser.payload.patch.content,
						parentId: info.parentId || null, workspaceId: info.workspaceId || "default",
					},
				});
				conflictCount++;
			}

			// Konflikt-Erkennung (2): Löschen wettstreitet mit Verschieben/Ändern. Wird eine Seite auf
			// einem Gerät endgültig gelöscht, während sie auf einem anderen Gerät seit dem letzten Sync
			// verschoben, wiederhergestellt oder sonst geändert wurde, gewinnt beim Log-Merge immer das
			// Löschen (die Seite verschwindet) — der Verschiebe-/Änderungsversuch ginge sonst
			// stillschweigend verloren (Bug: dafür wurde bisher kein Konflikt erkannt). Wie beim
			// Inhalts-Konflikt oben retten wir den unterlegenen Stand als Kopie, statt das Löschen
			// zu unterdrücken.
			const lifecycleTypes = new Set(["pageMove", "pageUpdate", "pageTrash", "pageRestore"]);
			const deletesOf = (evs, extra) => {
				const out = {};
				for (const ev of evs) {
					if (ev.type === "pageDelete" && ev.payload && (!extra || extra(ev))) out[ev.payload.id] = ev;
				}
				return out;
			};
			const lifecycleOf = (evs, extra) => {
				const out = {};
				for (const ev of evs) {
					if (lifecycleTypes.has(ev.type) && ev.payload && (!extra || extra(ev))) {
						if (!out[ev.payload.id] || ev.t > out[ev.payload.id].t) out[ev.payload.id] = ev; // jüngstes zählt
					}
				}
				return out;
			};
			const localDeletes = deletesOf(local, (ev) => (ev.seq || 0) > opts.unsyncedAfterSeq);
			const remoteDeletes = deletesOf(fresh);
			const localLifecycle = lifecycleOf(local, (ev) => (ev.seq || 0) > opts.unsyncedAfterSeq);
			const remoteLifecycle = lifecycleOf(fresh);
			const lifecyclePairs = [
				...Object.keys(localDeletes).filter((id) => remoteLifecycle[id]).map((id) => ({ id, del: localDeletes[id], moved: remoteLifecycle[id] })),
				...Object.keys(remoteDeletes).filter((id) => localLifecycle[id]).map((id) => ({ id, del: remoteDeletes[id], moved: localLifecycle[id] })),
			];
			for (const { id, del, moved } of lifecyclePairs) {
				if (existing.has("lifeconflict-" + moved.id)) continue;
				const info = (opts.pageInfo && opts.pageInfo(id)) || {};
				const title = (moved.payload && moved.payload.title) || info.title || "Seite";
				const content = info.content != null ? info.content : ((moved.payload && moved.payload.patch && moved.payload.patch.content) || "");
				const parentId = (moved.type === "pageMove" && moved.payload.parentId) || info.parentId || null;
				const conflictPageId = "conflictpg-" + moved.id;
				conflictDetails.push({
					pageId: id,
					title,
					reason: "Diese Seite wurde auf einem Gerät endgültig gelöscht, während sie auf einem anderen Gerät seit dem letzten Sync verschoben, wiederhergestellt oder geändert wurde. Das Löschen gewinnt beim Merge; der andere Stand liegt als Kopie bereit.",
					deletedAt: del.t,
					changedAt: moved.t,
					conflictPageId,
					eventId: "lifeconflict-" + moved.id,
				});
				fresh.push({
					id: "lifeconflict-" + moved.id, t: U.now(), type: "pageCreate",
					payload: {
						id: conflictPageId,
						title: "⚠ Konflikt (gelöscht/verschoben): " + title,
						content,
						parentId, workspaceId: info.workspaceId || "default",
					},
				});
				conflictCount++;
			}
		}
		fresh.forEach((ev) => { delete ev.seq; }); // neue lokale Sequenznummer
		if (fresh.length) await addEvents(fresh);
		const blobs = data.blobs && typeof data.blobs === "object" ? data.blobs : {};
		for (const [k, v] of Object.entries(blobs)) {
			if (!(await getBlob(k))) await putBlob(k, U.b64ToBuf(v.b64), v.meta);
		}
		return { added: fresh.length, conflicts: conflictCount, conflictDetails };
	}

	async function resetDatabase() {
		if (db) db.close();
		db = null;
		openPromise = null; // nach dem Reset muss ein neuer open()-Aufruf wieder wirklich öffnen
		const deleteDb = (name) => new Promise((resolve, reject) => {
			const req = indexedDB.deleteDatabase(name);
			req.onsuccess = () => resolve();
			req.onerror = () => reject(req.error);
			// Ohne diesen Handler bleibt das Promise für immer offen, wenn ein anderer Tab
			// dieselbe Datenbank noch geöffnet hält (weder onsuccess noch onerror feuern dann).
			req.onblocked = () => reject(new Error("Datenbank ist noch in einem anderen Tab geöffnet. Bitte alle anderen Tabs dieser App schließen und erneut versuchen."));
		});
		// FIX: das Löschen der Alt-Datenbank ("notion") lief bisher komplett ohne
		// Fehlerbehandlung nebenher (fire-and-forget) — Fehler verschwanden stillschweigend.
		// Jetzt: nicht fatal (die Haupt-DB wird trotzdem gelöscht), aber sichtbar geloggt.
		await deleteDb("notion").catch((e) => console.warn("Alt-Datenbank 'notion' konnte nicht gelöscht werden:", e));
		await deleteDb("impala67");
	}

	async function clearPages() {
		ensureOpen();
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