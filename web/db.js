"use strict";
import { U } from "./util.js";
// db.js — IndexedDB-Persistenz: append-only Event-Log + Blobs (PDF/Heft) + Vecs (RAG).
// Sync = Log-Merge: Union per Event-id, Replay deterministisch nach Zeitstempel.
// Rewrite (20. Juli 2026): KISS/DRY-Kompaktierung, öffentliche API unverändert. Fixes:
// • allVecs/exportAll lesen Keys+Werte aus EINER Transaktion (vorher eine Transaktion je Key)
// • importAll prüft Blob-Existenz über ein Key-Set statt getBlob() pro Blob
// • reconstructPageFromEvents sortiert nach Zeit — lokale Liste ist seq-geordnet, nach einem
//   Import überschrieben sonst ÄLTERE Patches den neueren Stand (gleiche Falle wie contentHeadsOf-Fix)
// • deletesOf: jüngstes Event per t statt Array-Reihenfolge (dito)
export const DB = (() => {
	let db = null, openPromise = null; // openPromise memoisiert open() gegen Doppel-Open-Races

	const ensureOpen = () => { if (!db) throw new Error("DB.open() muss zuerst aufgerufen werden."); };
	const validateEvent = (ev) => {
		if (!ev || typeof ev !== "object") throw new Error("Event muss ein Objekt sein.");
		if (!ev.id || !ev.t || !ev.type) throw new Error("Event benötigt id, t und type.");
	};

	const done = (t) => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error); });
	const val = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
	// Generische Store-Zugriffe — ersetzen 8 fast identische Funktionsrümpfe.
	const rw = (name, fn) => { ensureOpen(); const t = db.transaction(name, "readwrite"); fn(t.objectStore(name)); return done(t); };
	const ro = (name, fn) => { ensureOpen(); return val(fn(db.transaction(name).objectStore(name))); };
	const dump = async (name) => { // Keys+Werte konsistent aus DERSELBEN readonly-Transaktion
		ensureOpen();
		const s = db.transaction(name).objectStore(name);
		const [keys, vals] = await Promise.all([val(s.getAllKeys()), val(s.getAll())]);
		return keys.map((k, i) => [k, vals[i]]);
	};

	function openRaw(name, version) {
		return new Promise((resolve, reject) => {
			const req = version ? indexedDB.open(name, version) : indexedDB.open(name);
			req.onupgradeneeded = () => {
				if (!version) { req.transaction.abort(); resolve(null); return; } // ohne Version: nur Existenz prüfen, nie anlegen
				const d = req.result;
				if (!d.objectStoreNames.contains("events")) d.createObjectStore("events", { keyPath: "seq", autoIncrement: true });
				for (const s of ["blobs", "vecs"]) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}

	// Einmalige Migration der Alt-DB "notion"; Alt-DB bleibt als Sicherheitsnetz bis resetDatabase liegen.
	async function migrateLegacy() {
		if (await ro("events", (s) => s.count())) return;
		let legacy = null;
		try { legacy = await openRaw("notion"); } catch { return; }
		if (!legacy || !legacy.objectStoreNames.contains("events")) { legacy?.close(); return; }
		for (const store of ["events", "blobs", "vecs"]) {
			if (!legacy.objectStoreNames.contains(store)) continue;
			const src = legacy.transaction(store).objectStore(store);
			const [keys, vals] = await Promise.all([val(src.getAllKeys()), val(src.getAll())]);
			await rw(store, (dst) => vals.forEach((v, i) => (store === "events" ? dst.put(v) : dst.put(v, keys[i]))));
		}
		legacy.close();
	}

	// iPadOS/Safari: open() kann nach App-Kill ewig hängen (weder onsuccess noch onerror) → Timeout + Retry.
	async function openWithRetry(attempts = 4) {
		let lastErr = null;
		for (let i = 0; i < attempts; i++) {
			try {
				return await Promise.race([
					openRaw("impala67", 2),
					new Promise((_, rej) => setTimeout(() => rej(new Error("IndexedDB antwortet nicht (Versuch " + (i + 1) + ")")), 3000 + i * 2000)),
				]);
			} catch (e) {
				lastErr = e;
				console.warn("DB-Open fehlgeschlagen, neuer Versuch:", e);
				await new Promise((r) => setTimeout(r, 250));
			}
		}
		throw lastErr || new Error("IndexedDB ließ sich nicht öffnen.");
	}

	function open() {
		openPromise ??= (async () => { db = await openWithRetry(); await migrateLegacy(); })()
			.catch((e) => { openPromise = null; throw e; }); // Fehlschlag → nächster Aufruf versucht neu
		return openPromise;
	}

	// Viele Events in EINER Transaktion — beim Import/Sync um Größenordnungen schneller.
	async function addEvents(evs) {
		ensureOpen();
		const list = Array.isArray(evs) ? evs : [evs];
		if (!list.length) return;
		list.forEach(validateEvent);
		return rw("events", (s) => list.forEach((ev) => s.add(ev)));
	}
	const addEvent = (ev) => addEvents([ev]);
	const allEvents = () => ro("events", (s) => s.getAll());

	// Cursor liest nur oberhalb des Sync-Wasserstands. _remote-Events (echte Drive-Downloads) sind
	// kein lokales Echo und werden nicht erneut hochgeladen; Konfliktkopien syncen normal.
	function eventsAfterSeq(seq) {
		ensureOpen();
		return new Promise((res, rej) => {
			const out = [];
			const req = db.transaction("events").objectStore("events").openCursor(IDBKeyRange.lowerBound(Number(seq || 0), true));
			req.onsuccess = () => {
				const cur = req.result;
				if (!cur) return res(out);
				if (!cur.value._remote) out.push(cur.value);
				cur.continue();
			};
			req.onerror = () => rej(req.error);
		});
	}

	const putBlob = (id, buf, meta) => rw("blobs", (s) => s.put({ buf, meta }, id));
	const getBlob = (id) => ro("blobs", (s) => s.get(id));
	const delBlob = (id) => rw("blobs", (s) => s.delete(id)); // Blob-GC lebt in boot.js
	const allBlobKeys = () => ro("blobs", (s) => s.getAllKeys());

	// Vecs (RAG-Embeddings): nicht Teil des Event-Logs, lokal neu berechenbar.
	const putVec = (pageId, rec) => rw("vecs", (s) => s.put(rec, pageId));
	const getVec = (pageId) => ro("vecs", (s) => s.get(pageId));
	const delVec = (pageId) => rw("vecs", (s) => s.delete(pageId));
	const allVecs = async () => Object.fromEntries(await dump("vecs"));

	// ---- Log-Kompaktierung: verlustfrei & deterministisch (drop-only) → Log-Merge bleibt konsistent,
	// auch wenn Geräte zu unterschiedlichen Zeitpunkten kompaktieren. Regeln:
	// 1. Patch-Events (pageUpdate/cardUpdate/settingsSet) fliegen, wenn ALLE Felder von neueren Patches
	//    desselben Ziels überschrieben sind (pageUpdate trägt vollen content = DER Speicherfresser).
	// 2. Updates endgültig gelöschter Seiten/Karten fliegen. Rest bleibt (klein, teils reihenfolge-abhängig).
	// Verlaufs-Schutz: N jüngste Inhalts-Stände je Seite überleben — pageHistory liest das Event-Log.
	const KEEP_CONTENT_VERSIONS = 10;
	function compactEvents(events) {
		const sorted = [...events].sort((a, b) => a.t.localeCompare(b.t) || (a.seq || 0) - (b.seq || 0));
		const deletedAt = { page: {}, card: {} };
		for (const ev of sorted) {
			if (!ev.payload) continue;
			if (ev.type === "pageDelete") deletedAt.page[ev.payload.id] = ev.t;
			if (ev.type === "cardDelete") deletedAt.card[ev.payload.id] = ev.t;
		}
		const covered = {}, contentKept = {}, keep = [];
		for (let i = sorted.length - 1; i >= 0; i--) { // rückwärts: neueste zuerst
			const ev = sorted[i], p = ev.payload || {};
			if (ev.type === "pageUpdate" && deletedAt.page[p.id] && ev.t <= deletedAt.page[p.id]) continue;
			if (ev.type === "cardUpdate" && deletedAt.card[p.id] && ev.t <= deletedAt.card[p.id]) continue;
			const [bucket, patch] =
				ev.type === "pageUpdate" ? ["page:" + p.id, p.patch] :
				ev.type === "cardUpdate" ? ["card:" + p.id, p.patch] :
				ev.type === "settingsSet" ? ["settings", p] : [null, null];
			if (bucket && patch) {
				const seen = covered[bucket] ??= new Set();
				const keys = Object.keys(patch);
				if (ev.type === "pageUpdate" && typeof patch.content === "string" && (contentKept[p.id] || 0) < KEEP_CONTENT_VERSIONS) {
					contentKept[p.id] = (contentKept[p.id] || 0) + 1; // Verlaufs-Schutz: immer behalten
				} else if (keys.length && keys.every((k) => seen.has(k))) continue; // komplett überschrieben
				keys.forEach((k) => seen.add(k));
			}
			keep.push(ev);
		}
		return keep.reverse();
	}

	// Nur nach erfolgreichem Sync aufrufen: Seq-Nummern werden neu vergeben, der Sync-Wasserstand
	// (impala67_drive_synced_seq) muss danach neu gesetzt werden. Unter minDrop lohnt das Neuschreiben nicht.
	async function compactLocal(minDrop = 200) {
		const evs = await allEvents();
		const compacted = compactEvents(evs);
		const dropped = evs.length - compacted.length;
		if (dropped < minDrop) return 0;
		await rw("events", (s) => { s.clear(); compacted.forEach(({ seq, ...ev }) => s.add(ev)); });
		return dropped;
	}

	// Höchste lokale Sequenznummer — Basis des Sync-Wasserstands.
	function maxSeq() {
		ensureOpen();
		return new Promise((res, rej) => {
			const req = db.transaction("events").objectStore("events").openCursor(null, "prev");
			req.onsuccess = () => res(req.result ? Number(req.result.key) : 0);
			req.onerror = () => rej(req.error);
		});
	}

	// SECURITY: settingsSet-Events aus alten Versionen können Klartext-Secrets enthalten. Für
	// Drive-Snapshots/Deltas bereinigen — der MANUELLE Backup-Export behält sie bewusst.
	function redactSecretsFromEvent(ev) {
		if (!ev || ev.type !== "settingsSet" || !ev.payload) return ev;
		const p = { ...ev.payload };
		let changed = false;
		for (const k of ["notionToken", "driveDesktopClientSecret"]) if (p[k]) { p[k] = ""; changed = true; }
		if (Array.isArray(p.aiProviders) && p.aiProviders.some((pr) => pr?.key)) {
			p.aiProviders = p.aiProviders.map((pr) => (pr?.key ? { ...pr, key: "" } : pr));
			changed = true;
		}
		return changed ? { ...ev, payload: p } : ev;
	}

	// includeBlobs=false: PERF für den Drive-Snapshot (Blobs würden sofort wieder verworfen).
	async function exportAll(opts = {}) {
		let events = compactEvents(await allEvents());
		if (opts.redactSecrets) events = events.map(redactSecretsFromEvent);
		const blobs = {};
		if (opts.includeBlobs !== false) {
			for (const [k, rec] of await dump("blobs")) blobs[k] = { meta: rec.meta, b64: U.bufToB64(rec.buf) };
		}
		return JSON.stringify({ app: "impala67", version: 1, exportedAt: U.now(), events, blobs });
	}

	// Jüngstes passendes Event je Ziel per ZEITSTEMPEL — Seq-Reihenfolge lügt nach Imports.
	const headsOf = (evs, keyOf, extra) => {
		const heads = {};
		for (const ev of evs) {
			const id = keyOf(ev);
			if (id != null && (!extra || extra(ev)) && (!heads[id] || ev.t > heads[id].t)) heads[id] = ev;
		}
		return heads;
	};
	// Jüngster Inhalts-Stand je Seite — Kern der Konflikt-Erkennung (pure, test/test-core.mjs testet direkt).
	const contentHeadsOf = (evs, extra) => headsOf(evs, (ev) => (ev.type === "pageUpdate" && typeof ev.payload?.patch?.content === "string" ? ev.payload.id : null), extra);
	// Jüngste versionierte Heft-Binärdatei je Seite — der Hash im Event bestimmt exakt die Drive-Blob-Datei.
	const heftHeadsOf = (evs, extra) => headsOf(evs, (ev) => (ev.type === "heftUpdated" && ev.payload?.pageId && ev.payload?.blobHash ? ev.payload.pageId : null), extra);

	// Letzter bekannter Stand einer Seite rein aus Events (pure, exportiert für Tests). Wichtig beim
	// Lösch-Konflikt: die Seite ist lokal ggf. schon gelöscht, opts.pageInfo(id) wäre leer.
	function reconstructPageFromEvents(events, id) {
		const pg = { title: "Seite", content: "", kind: "notion", parentId: null, workspaceId: "default", heftMeta: null };
		const apply = (src, isPatch) => {
			if (isPatch ? src.title !== undefined : src.title) pg.title = src.title;
			if (src.content !== undefined) pg.content = src.content;
			if (isPatch ? src.kind !== undefined : src.kind) pg.kind = src.kind;
			if ("parentId" in src) pg.parentId = src.parentId || null;
			if (src.workspaceId) pg.workspaceId = src.workspaceId;
		};
		const relevant = events
			.filter((ev) => ev.payload && (ev.payload.id === id || ev.payload.pageId === id))
			.sort((a, b) => (a.t || "").localeCompare(b.t || "")); // FIX: Zeit- statt Seq-Reihenfolge
		for (const ev of relevant) {
			const p = ev.payload;
			if (ev.type === "pageCreate") apply(p, false);
			else if (ev.type === "pageUpdate" && p.patch) apply(p.patch, true);
			else if (ev.type === "pageMove") pg.parentId = p.parentId || null;
			else if (ev.type === "heftUpdated") {
				pg.kind = "heft";
				pg.heftMeta = { rev: p.rev || 1, pages: p.pages || 1, bytes: p.bytes || 0, blobHash: p.blobHash };
			}
		}
		return pg;
	}

	// Merge-Import: idempotent — doppelte Events (gleiche id) werden übersprungen.
	// opts (nur Drive-Sync): unsyncedAfterSeq = Seq des letzten Uploads (Basis der Konflikt-Erkennung),
	// pageInfo(id) → {title,parentId,workspaceId}, remote = echter Drive-Download.
	// Rückgabe: { added, conflicts, conflictDetails, importedEvents }.
	async function importAll(json, opts = {}) {
		ensureOpen();
		const data = JSON.parse(json);
		if (data.app !== "impala67" && data.app !== "notion") throw new Error("Keine Impala67-Exportdatei."); // Alt-Exporte bleiben importierbar
		const incoming = Array.isArray(data.events) ? data.events : []; // kaputte Exporte nicht crashen lassen
		const local = await allEvents();
		const existing = new Set(local.map((e) => e.id));
		const fresh = incoming.filter((ev) => ev && ev.id && !existing.has(ev.id));
		// Nur echte Drive-Downloads als _remote markieren — ein manueller Backup-Import ist eine lokale
		// Nutzeraktion und muss normal hochgeladen werden. (Set VOR den Konfliktkopien bilden: die syncen normal.)
		const remoteIds = opts.remote ? new Set(fresh.map((ev) => ev.id)) : new Set();
		const conflictDetails = [];
		if (typeof opts.unsyncedAfterSeq === "number" && fresh.length) {
			const localOnly = (ev) => (ev.seq || 0) > opts.unsyncedAfterSeq; // seit letztem Sync, kennt kein anderes Gerät
			const info = (id) => (opts.pageInfo && opts.pageInfo(id)) || {};

			// (1) Inhalts-Konflikt: gleiche Seite lokal UND remote geändert. Replay: späterer Zeitstempel
			// gewinnt still — der unterlegene Stand wird als Konfliktkopie gerettet.
			const localHeads = contentHeadsOf(local, localOnly), remoteHeads = contentHeadsOf(fresh);
			for (const [id, remote] of Object.entries(remoteHeads)) {
				const mine = localHeads[id];
				if (!mine || mine.payload.patch.content === remote.payload.patch.content) continue;
				const loser = mine.t <= remote.t ? mine : remote;
				if (existing.has("conflict-" + loser.id)) continue;
				const pi = info(id), title = pi.title || "Seite", conflictPageId = "conflictpg-" + loser.id;
				conflictDetails.push({
					pageId: id, title,
					reason: "Dieselbe Seite wurde seit dem letzten Sync sowohl hier als auch auf einem anderen Gerät am Inhalt geändert. Der neuere Zeitstempel gewinnt; der ältere Stand liegt als Kopie bereit.",
					localContent: mine.payload.patch.content, remoteContent: remote.payload.patch.content,
					localTime: mine.t, remoteTime: remote.t,
					winner: mine.t <= remote.t ? "remote" : "local",
					loserContent: loser.payload.patch.content, loserTime: loser.t,
					conflictPageId, eventId: "conflict-" + loser.id,
				});
				fresh.push({
					id: "conflict-" + loser.id, t: U.now(), type: "pageCreate",
					payload: {
						id: conflictPageId,
						title: "⚠ Konflikt: " + title + " — Stand " + loser.t.slice(0, 16).replace("T", " "),
						content: loser.payload.patch.content,
						parentId: pi.parentId || null, workspaceId: pi.workspaceId || "default",
					},
				});
			}

			// (2) Heft-Konflikt: versionierter Blob — ein Zeitstempel-Gewinner kann den anderen Blob nicht
			// still ersetzen. Verlierer wird als eigenes Heft gerettet, Drive kopiert exakt dessen Hash.
			const localHefts = heftHeadsOf(local, localOnly), remoteHefts = heftHeadsOf(fresh);
			for (const [id, remote] of Object.entries(remoteHefts)) {
				const mine = localHefts[id];
				if (!mine || mine.payload.blobHash === remote.payload.blobHash) continue;
				const loser = mine.t <= remote.t ? mine : remote;
				if (existing.has("heftconflict-" + loser.id)) continue;
				const pi = info(id), conflictPageId = "heftconflictpg-" + loser.id;
				conflictDetails.push({
					pageId: id, title: pi.title || "Heft", conflictPageId, conflictType: "heft",
					loserSource: loser === mine ? "local" : "remote", loserHash: loser.payload.blobHash,
					winner: mine.t <= remote.t ? "remote" : "local",
					reason: "Dieses Heft wurde auf zwei Geräten geändert. Der ältere Stand wurde als separates Konflikt-Heft gesichert.",
				});
				fresh.push(
					{ id: "heftconflict-" + loser.id, t: U.now(), type: "pageCreate", payload: { id: conflictPageId, title: "⚠ Konflikt-Heft: " + (pi.title || "Heft"), content: "", parentId: pi.parentId || null, workspaceId: pi.workspaceId || "default", kind: "heft" } },
					{ id: "heftconflictmeta-" + loser.id, t: U.now(), type: "heftUpdated", payload: { pageId: conflictPageId, rev: loser.payload.rev || 1, pages: loser.payload.pages || 1, bytes: loser.payload.bytes || 0, blobHash: loser.payload.blobHash } },
				);
			}

			// (3) Endgültig-gelöscht vs. verschoben/geändert: Löschen gewinnt beim Merge immer — der andere
			// Stand ginge sonst still verloren und wird als Kopie gerettet.
			const LIFE = new Set(["pageMove", "pageUpdate", "pageTrash", "pageRestore"]);
			const deletesOf = (evs, extra) => headsOf(evs, (ev) => (ev.type === "pageDelete" && ev.payload ? ev.payload.id : null), extra);
			const lifecycleOf = (evs, extra) => headsOf(evs, (ev) => (LIFE.has(ev.type) && ev.payload ? ev.payload.id : null), extra);
			const localDel = deletesOf(local, localOnly), remoteDel = deletesOf(fresh);
			const localLife = lifecycleOf(local, localOnly), remoteLife = lifecycleOf(fresh);
			const pairs = [
				...Object.keys(localDel).filter((id) => remoteLife[id]).map((id) => ({ id, del: localDel[id], moved: remoteLife[id], loserSource: "remote" })),
				...Object.keys(remoteDel).filter((id) => localLife[id]).map((id) => ({ id, del: remoteDel[id], moved: localLife[id], loserSource: "local" })),
			];
			for (const { id, del, moved, loserSource } of pairs) {
				if (existing.has("lifeconflict-" + moved.id)) continue;
				const conflictPageId = "conflictpg-" + moved.id;
				const pg = reconstructPageFromEvents([...local, ...fresh], id); // Seite ist lokal ggf. schon weg
				const isHeft = pg.kind === "heft" && pg.heftMeta?.blobHash;
				conflictDetails.push({
					pageId: id, title: pg.title,
					reason: "Diese Seite wurde auf einem Gerät endgültig gelöscht, während sie auf einem anderen Gerät seit dem letzten Sync verschoben, wiederhergestellt oder geändert wurde. Das Löschen gewinnt beim Merge; der andere Stand liegt als Kopie bereit.",
					deletedAt: del.t, changedAt: moved.t, conflictPageId, conflictType: "delete-change",
					parentId: pg.parentId, workspaceId: pg.workspaceId, eventId: "lifeconflict-" + moved.id,
					...(isHeft ? { loserHash: pg.heftMeta.blobHash, loserSource } : {}),
				});
				fresh.push({
					id: "lifeconflict-" + moved.id, t: U.now(), type: "pageCreate",
					payload: { id: conflictPageId, title: "⚠ Konflikt (gelöscht/verschoben): " + pg.title, content: pg.content, parentId: pg.parentId, workspaceId: pg.workspaceId, kind: pg.kind },
				});
				if (isHeft) fresh.push({ id: "lifeconflictmeta-" + moved.id, t: U.now(), type: "heftUpdated", payload: { pageId: conflictPageId, ...pg.heftMeta } });
			}
		}
		fresh.forEach((ev) => { delete ev.seq; if (remoteIds.has(ev.id)) ev._remote = true; }); // neue lokale Seq
		if (fresh.length) await addEvents(fresh);
		const blobs = data.blobs && typeof data.blobs === "object" ? data.blobs : {};
		const have = new Set(await allBlobKeys());
		for (const [k, v] of Object.entries(blobs)) if (!have.has(k)) await putBlob(k, U.b64ToBuf(v.b64), v.meta);
		// importedEvents = tiefe Kopien für Live-Replay ohne reload — UI darf den Import-Payload nicht mutieren.
		return { added: fresh.length, conflicts: conflictDetails.length, conflictDetails, importedEvents: fresh.map((ev) => JSON.parse(JSON.stringify(ev))) };
	}

	async function resetDatabase() {
		db?.close();
		db = null;
		openPromise = null; // nächster open() muss wieder wirklich öffnen
		const deleteDb = (name) => new Promise((resolve, reject) => {
			const req = indexedDB.deleteDatabase(name);
			req.onsuccess = () => resolve();
			req.onerror = () => reject(req.error);
			// Ohne onblocked bliebe das Promise ewig offen, wenn ein anderer Tab die DB noch offen hält.
			req.onblocked = () => reject(new Error("Datenbank ist noch in einem anderen Tab geöffnet. Bitte alle anderen Tabs dieser App schließen und erneut versuchen."));
		});
		await deleteDb("notion").catch((e) => console.warn("Alt-Datenbank 'notion' konnte nicht gelöscht werden:", e)); // nicht fatal
		await deleteDb("impala67");
	}

	// Seiten-Reset: Page-Events, Vecs und Blobs (außer Hintergrundbild) entsorgen — Settings überleben.
	// Löschungen synchron im onsuccess anstoßen: nach einem await wäre die Transaktion (Safari) ggf. schon zu.
	function clearPages() {
		ensureOpen();
		const t = db.transaction(["events", "vecs", "blobs"], "readwrite");
		const pageTypes = new Set(["pageCreate", "pageUpdate", "pageMove", "pageDelete", "pageTrash", "pageRestore"]);
		const evStore = t.objectStore("events");
		const evReq = evStore.getAll();
		evReq.onsuccess = () => evReq.result.forEach((ev) => { if (pageTypes.has(ev.type)) evStore.delete(ev.seq); });
		t.objectStore("vecs").clear();
		const blobStore = t.objectStore("blobs");
		const keysReq = blobStore.getAllKeys();
		keysReq.onsuccess = () => keysReq.result.forEach((k) => { if (k !== "bgImage") blobStore.delete(k); });
		return done(t);
	}

	return { open, addEvent, addEvents, allEvents, eventsAfterSeq, compactEvents, compactLocal, contentHeadsOf, heftHeadsOf, reconstructPageFromEvents, redactSecretsFromEvent, maxSeq, putBlob, getBlob, delBlob, allBlobKeys, putVec, getVec, delVec, allVecs, exportAll, importAll, resetDatabase, clearPages };
})();