"use strict";
import { U } from "./util.js";
import { SETTINGS_SYNC } from "./settings-sync.js";
import { PERF_PROFILER } from "./performance-profiler.js";
import { compactEvents, compactEventStore } from "./compact-events.js";
import { yieldToMain } from "./cooperative.js";
// IndexedDB-Persistenz für Events, Blobs und lokale Suchdaten.
// Wichtige Regeln: Events sind unveränderlich und per ID zusammenführbar; der Replay ist
// zeitlich deterministisch; Heft-Striche und Bilder reisen vollständig im Event-Log.
// Historische Reparaturen stehen im Git-Verlauf, die aktuellen Schutzregeln direkt bei der Logik.
export const DB = (() => {
	let db = null, openPromise = null; // openPromise memoisiert open() gegen Doppel-Open-Races

	const ensureOpen = () => { if (!db) throw new Error("DB.open() muss zuerst aufgerufen werden."); };
	const validateEvent = (ev) => {
		if (!ev || typeof ev !== "object") throw new Error("Event muss ein Objekt sein.");
		if (!ev.id || !ev.t || typeof ev.type !== "string" || !ev.type) throw new Error("Event benötigt id, t und type als String.");
	};

	const done = (t) => new Promise((res, rej) => {
		t.oncomplete = () => res();
		t.onerror = t.onabort = () => {
			const err = t.error;
			if (err) PERF_PROFILER.error("db.transaction-error", err, { mode: t.mode });
			rej(err);
		};
	});
	const val = (r) => new Promise((res, rej) => {
		r.onsuccess = () => res(r.result);
		r.onerror = () => {
			const err = r.error;
			if (err) PERF_PROFILER.error("db.request-error", err);
			rej(err);
		};
	});
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

	// Einmalige Migration der Alt-DB "notion"; die Alt-DB bleibt als Sicherheitsnetz liegen.
	async function migrateLegacy() {
		if (await ro("events", (s) => s.count())) return;
		let legacy = null;
		try { legacy = await openRaw("notion"); } catch { return; }
		if (!legacy || !legacy.objectStoreNames.contains("events")) { legacy?.close(); return; }
		// "events" bewusst ZULETZT: jeder Store kopiert atomar in EINER Transaktion, und
		// der Migrations-Check oben schaut auf events.count(). Bricht die Migration mitten-
		// drin ab (Tab zu, Crash), ist events noch leer und der nächste Start setzt die
		// Kopie einfach fort — vorher blockierte ein teilmigrierter Stand für immer.
		for (const store of ["blobs", "vecs", "events"]) {
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
			const opening = openRaw("impala67", 2);
			let timer = 0;
			try {
				return await Promise.race([
					opening,
					new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("IndexedDB antwortet nicht (Versuch " + (i + 1) + ")")), 3000 + i * 2000); }),
				]);
			} catch (e) {
				// Der abgelaufene Versuch läuft im Hintergrund weiter. Kommt er später doch durch,
				// MUSS die Verbindung geschlossen werden: eine vergessene offene Verbindung
				// blockiert jeden Versionswechsel (onblocked) — genau der
				// Zustand, in dem die App „Datenbank ist noch in einem anderen Tab geöffnet“
				// meldet, obwohl gar kein zweiter Tab offen ist.
				opening.then((d) => { if (d && d !== db) d.close(); }).catch(() => {});
				lastErr = e;
				console.warn("DB-Open fehlgeschlagen, neuer Versuch:", e);
				await new Promise((r) => setTimeout(r, 250));
			} finally {
				clearTimeout(timer); // sonst hängt der Wecker bis zu 11 s nach dem Erfolg nach
			}
		}
		throw lastErr || new Error("IndexedDB ließ sich nicht öffnen.");
	}

	function open() {
		openPromise ??= (async () => {
			const finish = PERF_PROFILER.start("db.open", {}, 50);
			try {
				db = await openWithRetry();
				await migrateLegacy();
			} catch (e) {
				PERF_PROFILER.error("db.open-error", e);
				throw e;
			} finally {
				finish();
			}
		})().catch((e) => { openPromise = null; throw e; }); // Fehlschlag → nächster Aufruf versucht neu
		return openPromise;
	}

	// Alle lokal vorhandenen Event-ids (für die Dublettenprüfung in importAll, wenn der Aufrufer
	// nur ein Delta des Logs mitgibt). Inkrementell: nur Events oberhalb der zuletzt gelesenen seq
	// werden nachgeladen — das erfasst auch Events, die ein anderer Tab geschrieben hat.
	// PERF: in Häppchen mit Pause dazwischen. Der erste Aufruf nach dem Start liest den GANZEN
	// Log — am Stück war das ein einziger Main-Thread-Block (86k Events: 660 ms am PC, auf
	// alten Geräten Sekunden). Gleiche Gesamtarbeit, aber die Oberfläche bleibt bedienbar.
	const KNOWN_IDS_CHUNK = 1000;
	let _knownEventIds = null, _knownMaxSeq = 0, _knownScan = null;
	function ensureKnownEventIds() {
		return (_knownScan ??= scanKnownEventIds().finally(() => { _knownScan = null; }));
	}
	async function scanKnownEventIds() {
		for (;;) {
			if (!_knownEventIds) { _knownEventIds = new Set(); _knownMaxSeq = 0; }
			const ids = _knownEventIds;
			const delta = await eventsAfterSeqAll(_knownMaxSeq, Infinity, KNOWN_IDS_CHUNK);
			if (ids !== _knownEventIds) continue; // währenddessen verworfen (Kompaktierung) → neu
			for (const ev of delta) {
				if (ev?.id) ids.add(ev.id);
				_knownMaxSeq = Math.max(_knownMaxSeq, Number(ev?.seq) || 0);
			}
			if (delta.length < KNOWN_IDS_CHUNK) return ids;
			await yieldToMain();
		}
	}
	const forgetKnownEventIds = () => { _knownEventIds = null; _knownMaxSeq = 0; };

	// Viele Events in EINER Transaktion — beim Import/Sync um Größenordnungen schneller.
	async function addEvents(evs) {
		ensureOpen();
		const list = Array.isArray(evs) ? evs : [evs];
		if (!list.length) return;
		list.forEach(validateEvent);
		const result = await rw("events", (s) => list.forEach((ev) => s.add(ev)));
		if (_knownEventIds) list.forEach((ev) => { if (ev?.id) _knownEventIds.add(ev.id); });
		return result;
	}
	const addEvent = (ev) => addEvents([ev]);
	const allEvents = () => ro("events", (s) => s.getAll());
	const eventAtSeq = (seq) => ro("events", (s) => s.get(Number(seq) || 0));
	function eventLogInfo() {
		ensureOpen();
		return new Promise((resolve, reject) => {
			const store = db.transaction("events").objectStore("events");
			const countReq = store.count(), lastReq = store.openCursor(null, "prev");
			let count, last, failed = false;
			const doneInfo = () => {
				if (failed || count === undefined || last === undefined) return;
				resolve({ count, maxSeq: last ? Number(last.key) || 0 : 0, lastEventId: String(last?.value?.id || "") });
			};
			const fail = (request) => { if (!failed) { failed = true; reject(request.error); } };
			countReq.onsuccess = () => { count = Number(countReq.result) || 0; doneInfo(); };
			lastReq.onsuccess = () => { last = lastReq.result || null; doneInfo(); };
			countReq.onerror = () => fail(countReq);
			lastReq.onerror = () => fail(lastReq);
		});
	}
	// Cursor/Batch liest nur das begrenzte Delta oberhalb des Sync-Wasserstands. Jeder
	// Transport unterdrückt ausschließlich sein eigenes Echo; Cloudflare-Events
	// dürfen deshalb weiterhin ins Drive-Backup und umgekehrt.
	function eventsAfterSeqAll(seq, upToSeq = Infinity, limit = 0) {
		const lower = Number(seq || 0), upper = Number(upToSeq);
		if (Number.isFinite(upper) && upper <= lower) return Promise.resolve([]);
		const range = Number.isFinite(upper)
			? IDBKeyRange.bound(lower, upper, true, false)
			: IDBKeyRange.lowerBound(lower, true);
		return ro("events", (s) => (limit ? s.getAll(range, limit) : s.getAll(range))).then((all) => all || []);
	}

	const putBlob = (id, buf, meta) => rw("blobs", (s) => s.put({ buf, meta }, id));
	const getBlob = (id) => ro("blobs", (s) => s.get(id));
	const allBlobKeys = () => ro("blobs", (s) => s.getAllKeys());
	// Abgeleiteter Start-Checkpoint: lokal, versioniert und jederzeit aus dem Event-Log
	// neu erzeugbar. Der reservierte Blob-Schlüssel erfüllt bewusst kein Sync-ID-Muster.
	const LEGACY_STATE_CHECKPOINT_KEY = "__impala67_state_checkpoint_v1__";
	const STATE_CHECKPOINT_KEY = "__impala67_state_checkpoint_v2__";
	const STATE_CHECKPOINT_BLOB_PREFIX = "__impala67_state_checkpoint_v2_blob__:";
	// Heft-Striche je Heft als eigener, inhaltsadressierter Eintrag (JSON-Text, Schlüssel = Hash).
	const STATE_CHECKPOINT_HEFT_PREFIX = "__impala67_state_checkpoint_v3_heft__:";
	const isStateCheckpointKey = (key) => key === LEGACY_STATE_CHECKPOINT_KEY || key === STATE_CHECKPOINT_KEY
		|| String(key).startsWith(STATE_CHECKPOINT_BLOB_PREFIX) || String(key).startsWith(STATE_CHECKPOINT_HEFT_PREFIX);
	async function getStateCheckpoint() {
		const current = await ro("blobs", (s) => s.get(STATE_CHECKPOINT_KEY));
		return current || ro("blobs", (s) => s.get(LEGACY_STATE_CHECKPOINT_KEY));
	}
	function getStateCheckpointPayload(hashes) {
		ensureOpen();
		const ids = [...new Set((hashes || []).filter(Boolean))];
		if (!ids.length) return Promise.resolve({});
		const store = db.transaction("blobs").objectStore("blobs");
		return Promise.all(ids.map(async (hash) => {
			const rec = await val(store.get(STATE_CHECKPOINT_BLOB_PREFIX + hash));
			return [hash, (rec && typeof rec.data === "string") ? rec.data : null];
		})).then((entries) => Object.fromEntries(entries));
	}
	// Kernzustand und neue, inhaltsadressierte Heft-Bilder werden gemeinsam committed.
	// Bereits gespeicherte Hashes sind unveränderlich und werden deshalb nicht erneut
	// geklont oder geschrieben. Das beseitigt den großen Checkpoint-Write im Normalfall.
	// Bilder, die der neue Checkpoint nicht mehr kennt, fliegen in derselben Transaktion —
	// sonst sammelten sich verwaiste Heft-Bilder unbegrenzt an.
	const stateCheckpointBlobRange = () => IDBKeyRange.bound(STATE_CHECKPOINT_BLOB_PREFIX, STATE_CHECKPOINT_BLOB_PREFIX + "￿");
	const stateCheckpointHeftRange = () => IDBKeyRange.bound(STATE_CHECKPOINT_HEFT_PREFIX, STATE_CHECKPOINT_HEFT_PREFIX + "￿");
	const getStateCheckpointHeft = (hash) => ro("blobs", (s) => s.get(STATE_CHECKPOINT_HEFT_PREFIX + hash))
		.then((rec) => (rec && typeof rec.data === "string" ? rec.data : null));
	// Schreibt nur Einträge, deren Hash noch fehlt (unveränderte Hefte kosten nichts), und
	// räumt in derselben Transaktion alles weg, was der neue Checkpoint nicht mehr kennt.
	function putPartitionedEntries(s, range, prefix, entries, known) {
		const checkReq = s.getAllKeys(range);
		checkReq.onsuccess = () => {
			const existingKeys = new Set(checkReq.result || []);
			entries.forEach(([hash, data]) => {
				const key = prefix + hash;
				if (!existingKeys.has(key)) s.put({ data }, key);
			});
			if (known) existingKeys.forEach((key) => {
				if (!known.has(String(key).slice(prefix.length))) s.delete(key);
			});
		};
	}
	function putStateCheckpoint(checkpoint, heftBlobs, heftDocs) {
		const validEntries = (map) => Object.entries(map || {}).filter(([hash, data]) => hash && typeof data === "string");
		const knownBlobs = checkpoint?.heftBlobSizes && typeof checkpoint.heftBlobSizes === "object" ? new Set(Object.keys(checkpoint.heftBlobSizes)) : null;
		const knownHefte = checkpoint?.heftDocHashes && typeof checkpoint.heftDocHashes === "object" ? new Set(Object.values(checkpoint.heftDocHashes)) : null;
		return rw("blobs", (s) => {
			putPartitionedEntries(s, stateCheckpointBlobRange(), STATE_CHECKPOINT_BLOB_PREFIX, validEntries(heftBlobs), knownBlobs);
			if (knownHefte) putPartitionedEntries(s, stateCheckpointHeftRange(), STATE_CHECKPOINT_HEFT_PREFIX, validEntries(heftDocs), knownHefte);
			s.put(checkpoint, STATE_CHECKPOINT_KEY);
			s.delete(LEGACY_STATE_CHECKPOINT_KEY);
		});
	}
	// Schon gespeicherte Checkpoint-Teile (Hashes), damit der Kern nur Neues schreiben lässt.
	function stateCheckpointPartHashes() {
		ensureOpen();
		const store = db.transaction("blobs").objectStore("blobs");
		const keys = (range, prefix) => val(store.getAllKeys(range)).then((list) => (list || []).map((k) => String(k).slice(prefix.length)));
		return Promise.all([keys(stateCheckpointBlobRange(), STATE_CHECKPOINT_BLOB_PREFIX), keys(stateCheckpointHeftRange(), STATE_CHECKPOINT_HEFT_PREFIX)])
			.then(([blobs, hefte]) => ({ blobs, hefte }));
	}
	// Ein Range-Delete statt eines Requests je Schlüssel: Safari brach die Einzel-Deletes
	// (276 Stück) mit „without an in-progress transaction“ ab.
	function clearStateCheckpoint({ keepHeftBlobs = false } = {}) {
		return rw("blobs", (s) => {
			s.delete(STATE_CHECKPOINT_KEY);
			s.delete(LEGACY_STATE_CHECKPOINT_KEY);
			if (!keepHeftBlobs) { s.delete(stateCheckpointBlobRange()); s.delete(stateCheckpointHeftRange()); }
		});
	}

	// ---- Object-URLs: EIN Cache für die ganze App ---------------------------
	// Vorher hatte fast jede Datei ihre eigene Lösung: render.js (COVER_URLS/IMG_URLS),
	// editor.js (BLOB_URLS) und pdfs.js (urlCache) pflegten drei getrennte Caches mit
	// derselben Logik, während settings.js bei JEDEM Aufruf einen neuen Object-URL fürs
	// Hintergrundbild erzeugte, der nie freigegeben wurde. Ein Object-URL hält den
	// kompletten Blob im Speicher — bei Fotos und PDFs sind das schnell Megabyte je Aufruf.
	// Der Cache gehört neben den Blob-Speicher: nur hier ist bekannt, wann ein Blob
	// verschwindet, und nur so kann die Freigabe überhaupt zuverlässig passieren.
	const OBJECT_URLS = new Map(); // Blob-id → Object-URL
	// Laufender Aufbau je Blob-id. Ohne diese Sperre erzeugten zwei gleichzeitige Aufrufe
	// (Editor und Vorschau hydrieren dasselbe Bild) ZWEI Object-URLs; die zweite überschrieb
	// die erste in der Map, und die erste hielt ihren Blob bis zum Neuladen im Speicher fest.
	const URL_PENDING = new Map();
	function blobUrl(id, fallbackType) {
		if (!id) return Promise.resolve(null);
		const hit = OBJECT_URLS.get(id);
		if (hit) return Promise.resolve(hit);
		const laufend = URL_PENDING.get(id);
		if (laufend) return laufend;
		const p = (async () => {
		try {
			const rec = await getBlob(id);
			// rec.data = Alt-Datensätze aus der früheren "notion"-DB.
			const buf = rec && (rec.buf || rec.data);
			if (!buf || !buf.byteLength) return null;
			const url = URL.createObjectURL(new Blob([buf], { type: (rec.meta && rec.meta.type) || fallbackType || "" }));
			OBJECT_URLS.set(id, url);
			return url;
		} catch (e) {
			console.warn("Blob konnte nicht geladen werden:", e);
			return null;
		}
		})().finally(() => URL_PENDING.delete(id));
		URL_PENDING.set(id, p);
		return p;
	}
	function revokeBlobUrl(id) {
		const url = OBJECT_URLS.get(id);
		if (!url) return false;
		URL.revokeObjectURL(url);
		OBJECT_URLS.delete(id);
		return true;
	}
	// Beim Löschen eines Blobs MUSS der Object-URL mitsterben: er zeigt sonst weiter auf
	// Daten, die es nicht mehr gibt, und hält sie zugleich im Speicher fest.
	const delBlob = (id) => { revokeBlobUrl(id); return rw("blobs", (s) => s.delete(id)); }; // Blob-GC lebt in boot.js
	// Nach pagehide sind alle Object-URLs tot — ohne Leeren löge der Cache nach einer
	// bfcache-Rückkehr mit widerrufenen URLs weiter (stand vorher nur in pdfs.js).
	if (typeof window !== "undefined" && window.addEventListener) {
		window.addEventListener("pagehide", () => { for (const id of [...OBJECT_URLS.keys()]) revokeBlobUrl(id); });
	}

	// Vecs (RAG-Embeddings): nicht Teil des Event-Logs, lokal neu berechenbar.
	const putVec = (pageId, rec) => rw("vecs", (s) => s.put(rec, pageId));
	const getVec = (pageId) => ro("vecs", (s) => s.get(pageId));
	const delVec = (pageId) => rw("vecs", (s) => s.delete(pageId));
	const allVecs = async () => Object.fromEntries(await dump("vecs"));

	// Kompaktierungs-Regeln: compact-events.js.
	// Kompaktierungs-Untergrenze: alles ÄLTERE dieser Typen wurde bewusst verdichtet.
	// Ohne die Marke schleust der (per Event-id idempotente) Merge wegkompaktierte Events
	// aus fremden Deltas wieder ein — die Kompaktierung erreichte ihr Ziel dann NIE, und
	// die 90-Tage-Telemetrie-Regel griff faktisch nicht.
	// Bewusst NUR diese drei Typen: ein lange offline gewesenes Gerät hat legitime alte
	// pageUpdate-Patches, die weiterhin ankommen müssen. Für pageUpdate ist Wieder-
	// auferstehung nur ein Platz-, kein Korrektheitsproblem (Replay ist LWW über t).
	const COMPACT_FLOOR_KEY = "impala67_compact_floor";
	const DROPPABLE_TYPES = new Set(["uiTabsSet", "uiTreeSet"]);
	const compactFloor = () => localStorage.getItem(COMPACT_FLOOR_KEY) || "";
	// Exportiert, damit test/test-sync.mjs genau diese Regel prüfen kann — der Fehler,
	// den sie verhindert, war nur über zwei aufeinanderfolgende importAll-Aufrufe sichtbar.
	// [A2] _derived = von einem Import SELBST erzeugtes Merge-/Konflikt-Event. Es liegt über dem
	// Wasserstand und ist nicht _remote, ist aber keine Bearbeitung DIESES Nutzers. Ohne die Ausnahme
	// meldet der zweite importAll-Aufruf (Drive-Kern, späte Deltas) Konflikte gegen den eigenen Merge.
	// Hochgeladen werden sie trotzdem — der Upload-Filter verwirft nur _remote.
	const isLocalOnly = (ev, unsyncedAfterSeq) => (ev.seq || 0) > unsyncedAfterSeq && !ev._remote && !ev._derived;

	// Bevorzugt im Worker (compact-worker.js): Lesen und Sortieren des ganzen Logs fror die
	// UI sonst über eine Sekunde ein. Scheitert der Worker (alte WebViews, Node-Tests),
	// läuft dieselbe Logik wie bisher hier — beides ist drop-only und damit wiederholbar.
	const COMPACT_WORKER_TIMEOUT_MS = 60000;
	function compactInWorker(minDrop) {
		if (typeof Worker === "undefined") return Promise.resolve(null);
		return new Promise((resolve) => {
			let worker;
			const finish = (result) => { clearTimeout(timer); worker?.terminate(); resolve(result); };
			// terminate() bricht eine offene Transaktion ab — nichts wird halb gelöscht.
			const timer = setTimeout(() => finish(null), COMPACT_WORKER_TIMEOUT_MS);
			try { worker = new Worker(new URL("./compact-worker.js", import.meta.url), { type: "module" }); }
			catch { finish(null); return; }
			worker.onmessage = ({ data }) => {
				if (data?.error) console.warn("Kompaktierung im Worker fehlgeschlagen:", data.error);
				finish(data && !data.error ? data : null);
			};
			worker.onerror = (e) => { e.preventDefault?.(); finish(null); };
			worker.postMessage({ name: db.name, version: db.version, minDrop });
		});
	}
	async function compactLocal(minDrop = 200) {
		ensureOpen();
		const { dropped, floor } = (await compactInWorker(minDrop)) || (await compactEventStore(db, minDrop));
		if (!dropped) return 0;
		forgetKnownEventIds();
		localStorage.setItem(COMPACT_FLOOR_KEY, floor || U.now());
		return dropped;
	}

	// Die Kompaktierung liest und sortiert den gesamten Log. Deshalb erst prüfen, wenn seit der
	// letzten Analyse mindestens so viele neue Events hinzukamen, wie compactLocal als Gewinn
	// verlangt. Gemeinsam für Drive und Cloudflare — vorher lief sie nur nach einem Drive-Sync.
	const COMPACT_CHECK_STEP = 200, COMPACT_CHECK_SEQ_KEY = "impala67_compact_checked_seq";
	async function compactLocalIfDue() {
		const top = await maxSeq();
		const checked = Math.min(Number(localStorage.getItem(COMPACT_CHECK_SEQ_KEY) || localStorage.getItem("impala67_drive_compact_checked_seq") || 0), top);
		if (top - checked < COMPACT_CHECK_STEP) return 0;
		const dropped = await compactLocal(COMPACT_CHECK_STEP);
		localStorage.setItem(COMPACT_CHECK_SEQ_KEY, String(top));
		return dropped;
	}

	// Einmalige v4-Migration: alten Heft-Transportzustand atomar durch je EIN
	// vollständiges heftOps-Baseline-Event ersetzen. Keine Zwischenphase ohne Heftdaten.
	// upToSeq schützt vor Race Conditions: neuere Events als upToSeq werden nicht gelöscht.
	async function replaceHeftHistory(baselines = [], upToSeq = 0) {
		ensureOpen();
		const list = Array.isArray(baselines) ? baselines : [];
		list.forEach(validateEvent);
		const cutoff = Number(upToSeq || 0);
		return new Promise((resolve, reject) => {
			const tx = db.transaction("events", "readwrite"), store = tx.objectStore("events");
			const req = store.getAll();
			req.onsuccess = () => {
				forgetKnownEventIds();
				for (const ev of req.result || []) {
					if ((ev.type === "heftOps" || ev.type === "heftSnap") && cutoff > 0 && ev.seq && ev.seq <= cutoff) {
						store.delete(ev.seq);
					}
				}
				for (const event of list) { const { seq, ...clean } = event; store.add(clean); }
			};
			req.onerror = () => { try { tx.abort(); } catch {} };
			tx.oncomplete = () => resolve(list.length);
			tx.onerror = tx.onabort = () => reject(tx.error || req.error);
		});
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

	// SECURITY: Exporte entfernen Klartext-Secrets standardmäßig. Der Drive-Transport
	// entscheidet zentral über SETTINGS_SYNC, ob Tokens bewusst mitreisen dürfen.
	function redactSecretsFromEvent(ev) {
		return SETTINGS_SYNC.sanitizeEvent(ev, false) || null;
	}

	function filterEventsForSync(events, includeSecrets = true) {
		return SETTINGS_SYNC.sanitizeEvents(events, includeSecrets);
	}

	// includeBlobs=false: PERF für den Drive-Snapshot (Blobs würden sofort wieder verworfen).
	// SECURITY (secure by default): Secrets werden standardmäßig entfernt — Exporte können
	// das eigene Konto verlassen (geteilte Backups, Bug-Reports). Der Drive-Sync setzt
	// redactSecrets nur dann auf false, wenn der Nutzer die Token-Synchronisierung erlaubt.
	// _remote ("kam per Drive herein") und _derived ("selbst erzeugter Merge") sind GERÄTE-lokale
	// Marken: sie steuern hier den Upload-Filter und die Konflikt-Erkennung. Mitexportiert gelten
	// die Events auf dem Zielgerät als „schon gesynct“ — ein per Backup eingespielter Stand würde
	// dort NIE hochgeladen (stiller Verlust Richtung aller anderen Geräte). seq fällt gleich mit:
	// die Nummer gilt nur lokal und wird beim Import ohnehin neu vergeben.
	const stripLocalFlags = ({ _remote, _remoteSource, _derived, seq, ...ev }) => ev;

	async function exportAll(opts = {}) {
		let events = compactEvents(await allEvents()).map(stripLocalFlags);
		if (opts.redactSecrets !== false) events = events.map(redactSecretsFromEvent).filter(Boolean);
		const blobs = {};
		if (opts.includeBlobs !== false) {
			for (const [k, rec] of await dump("blobs")) {
				if (isStateCheckpointKey(k)) continue;
				blobs[k] = { meta: rec.meta, b64: U.bufToB64(rec.buf || rec.data) };
			}
		}
		return JSON.stringify({ app: "impala67", version: 1, exportedAt: U.now(), events, blobs });
	}

	// Merge-Import: idempotent — doppelte Events (gleiche id) werden übersprungen.
	// opts (nur Drive-Sync): unsyncedAfterSeq = Seq des letzten Uploads (Basis der Konflikt-Erkennung),
	// conflictCheck = STATE.importConflicts (Konflikt-Prüfung im Kern), remote = echter Download.
	// Rückgabe: { added, conflicts, conflictDetails, importedEvents }.
	// Importe laufen nacheinander: Dublettenprüfung (seenIds) und Schreiben liegen mehrere awaits
	// auseinander. Holten Cloudflare und Drive denselben Rückstand gleichzeitig (Start, „online“),
	// landeten dieselben Events doppelt im Log – Wiederholungen und Telemetrie zählten doppelt.
	let _importChain = Promise.resolve();
	function importAll(json, opts) {
		const run = _importChain.then(() => importAllNow(json, opts));
		_importChain = run.catch(() => {});
		return run;
	}
	async function importAllNow(json, opts = {}) {
		ensureOpen();
		const finishProfile = PERF_PROFILER.start("db.import", { remote: !!opts.remote }, 20);
		const data = typeof json === "string" ? JSON.parse(json) : json;
		if (!data || typeof data !== "object") throw new Error("Keine Impala67-Exportdatei.");
		if (data.app !== "impala67" && data.app !== "notion") throw new Error("Keine Impala67-Exportdatei."); // Alt-Exporte bleiben importierbar
		const incoming = Array.isArray(data.events) ? data.events : []; // kaputte Exporte nicht crashen lassen
		// Sync-Transporte, die den Log fuer ihre Cursor-Pruefung ohnehin schon gelesen
		// haben, duerfen denselben konsistenten Snapshot weiterreichen. Das vermeidet
		// einen zweiten kompletten IndexedDB-Read pro Importseite.
		// localEvents ist beim Cloudflare-Sync nur das unbestätigte Delta (seq > Upload-Cursor).
		// Für die Konflikt-Erkennung "was habe ICH geändert" reicht das — für alles andere nicht:
		// Dublettenprüfung und gelöste Konflikte (conflict-/merge3-/lifeconflict-ids) brauchen
		// ALLE lokalen ids, die Drei-Wege-Basis die ganze Historie. Mit nur dem Delta wurden
		// längst vorhandene Events erneut importiert und gelöste Konflikte als neue Kopien angelegt.
		const partialLocal = Array.isArray(opts.localEvents);
		const local = partialLocal ? opts.localEvents : await allEvents();
		// Bekannte ids nur nachschlagen, nicht kopieren (~80k je Pull-Seite). Neue ids landen in
		// einer eigenen Menge: Scheitert der Import, darf der Cache nichts Ungeschriebenes kennen.
		const known = partialLocal ? await ensureKnownEventIds() : null;
		const added = new Set();
		const seenIds = { has: (id) => added.has(id) || !!known?.has(id), add: (id) => { added.add(id); } };
		local.forEach((e) => seenIds.add(e.id));
		let fullLog = partialLocal ? null : local;
		const history = async () => (fullLog ??= await allEvents());
		const floor = compactFloor();
		// [A4] EIN kaputtes Event legte bisher den ganzen Sync still: der Filter prüfte nur id,
		// validateEvent verlangt aber auch t und type und WIRFT — damit flog die komplette
		// addEvents-Transaktion. Und weil knownDeltaIds (drive.js) korrekterweise erst NACH
		// erfolgreichem Import gesetzt wird, holte jeder folgende Sync exakt dasselbe Paket erneut.
		// Der Fehler heilte nie aus, auf keinem Gerät. Jetzt: normalisieren, Unbrauchbares aussortieren.
		// Nebenbei der t-Vertrag: drive.js akzeptiert Zahlen (evTime), hier wird überall localeCompare
		// gerufen. Zahlen werden deshalb hier EINMAL auf ISO-Strings gezogen statt verworfen.
		const normalized = incoming.map((ev) => {
			if (!ev || typeof ev !== "object") return null;
			let t = ev.t;
			if (typeof t === "number") {
				const date = new Date(t);
				if (!Number.isFinite(t) || Number.isNaN(date.getTime())) return null;
				t = date.toISOString();
			}
			if (!ev.id || typeof ev.type !== "string" || typeof t !== "string" || !t) return null;
			// Import-Metadaten (seq/_remoteSource) werden weiter unten angepasst. Immer
			// auf einer eigenen Hülle arbeiten, damit der entschlüsselte bzw. geladene
			// Transport-Payload unverändert und für Diagnose/Wiederholung nutzbar bleibt.
			return { ...ev, t };
		});
		const malformed = normalized.filter((ev) => !ev).length;
		if (malformed) console.warn("[importAll] " + malformed + " unbrauchbare Event(s) übersprungen (fehlende id/t/type).");
		const transportEvents = opts.remote && opts.allowSecrets === false
			? SETTINGS_SYNC.sanitizeEvents(normalized, false)
			: normalized.filter(Boolean);
		// Nur wirklich wegwerfbare gerätespezifische UI-Events unterhalb der
		// Kompaktierungsgrenze blockieren. Fachliche Heft-Operationen sind immer zulässig.
		const droppedByFloor = (ev) => !!floor && ev.t < floor && DROPPABLE_TYPES.has(ev.type);
		const fresh = transportEvents.filter((ev) => {
			if (seenIds.has(ev.id) || droppedByFloor(ev)) return false;
			seenIds.add(ev.id);
			return true;
		});
		// Nur echte Downloads als _remote markieren — ein manueller Backup-Import ist eine lokale
		// Nutzeraktion und muss normal hochgeladen werden. (Set VOR den Konfliktkopien bilden: die syncen normal.)
		const remoteIds = opts.remote ? new Set(fresh.map((ev) => ev.id)) : new Set();
		// Hybride logische Uhr (siehe util.js): die eigene Uhr auf jeden gesehenen fremden
		// Zeitstempel heben, BEVOR unten Merge-/Konflikt-Events mit U.now() entstehen. Sonst
		// könnte eine nachgehende Geräteuhr Events datieren, die im Replay VOR dem gerade
		// importierten Stand landen, den sie eigentlich ablösen sollen.
		U.observeTimes(fresh);
		const conflictDetails = [];
		const mergedDetails = [];
		if (typeof opts.unsyncedAfterSeq === "number" && fresh.length && typeof opts.conflictCheck === "function") {
			// Konflikt-Prüfung im Rust-Kern (impala-model conflict.rs): (1) dieselbe Seite lokal UND fremd
			// geändert → Drei-Wege-Abgleich, sonst LWW + Konfliktkopie; (2) endgültig gelöscht vs.
			// geändert → Löschen gewinnt, der andere Stand wird Kopie. _remote = echter Download: solche
			// Events sind nie eine Änderung DIESES Geräts, auch wenn ihre lokale seq über dem Wasserstand liegt.
			// Der Kern braucht nur die lokalen Events nach dem Wasserstand; das ganze Log nur bei einem
			// Kandidaten (dann meldet er needHistory).
			const after = opts.unsyncedAfterSeq;
			const freshJson = JSON.stringify(fresh);
			const localJson = JSON.stringify(local.filter((ev) => (Number(ev?.seq) || 0) > after));
			const known = (id) => seenIds.has(id);
			const now = () => U.now();
			let res = JSON.parse(opts.conflictCheck(freshJson, localJson, after, undefined, known, now));
			if (res.needHistory) res = JSON.parse(opts.conflictCheck(freshJson, localJson, after, JSON.stringify(await history()), known, now));
			conflictDetails.push(...res.conflicts);
			mergedDetails.push(...res.merged);
			fresh.push(...res.added);
		}
		fresh.forEach((ev) => {
			delete ev.seq;
			if (remoteIds.has(ev.id)) {
				ev._remote = true;
				ev._remoteSource = opts.remoteSource || "drive";
			}
		}); // neue lokale Seq
		if (fresh.length) await addEvents(fresh);
		const blobEntries = data.blobs && typeof data.blobs === "object" ? Object.entries(data.blobs) : [];
		// PERF: Sync-Pakete (Cloudflare) bringen nie Blobs mit — dann auch nicht bei jedem Paket alle
		// Blob-Schlüssel aus IndexedDB lesen. Fehlende Blobs in EINER Transaktion statt einer je Blob.
		if (blobEntries.length) {
			const have = new Set(await allBlobKeys());
			const missing = blobEntries.filter(([k]) => !isStateCheckpointKey(k) && !have.has(k));
			if (missing.length) await rw("blobs", (s) => missing.forEach(([k, v]) => s.put({ buf: U.b64ToBuf(v.b64), meta: v.meta }, k)));
		}
		// importedEvents = tiefe Kopien für Live-Replay ohne reload — UI darf den Import-Payload nicht mutieren.
		// structuredClone vermeidet den teuren JSON-Text-Roundtrip. Die tiefe Kopie
		// bleibt nötig: Live-Module dürfen den unveränderlichen Import nicht mitmutieren.
		const importedEvents = fresh.map((ev) => structuredClone(ev));
		finishProfile({ added: fresh.length, incoming: incoming.length });
		return { added: fresh.length, malformed, conflicts: conflictDetails.length, conflictDetails, merged: mergedDetails.length, mergedDetails, importedEvents };
	}

	// Seiten-Reset: Page-Events, Vecs und Blobs (außer Hintergrundbild) entsorgen — Settings überleben.
	// Löschungen synchron im onsuccess anstoßen: nach einem await wäre die Transaktion (Safari) ggf. schon zu.
	function clearPages() {
		ensureOpen();
		const t = db.transaction(["events", "vecs", "blobs"], "readwrite");
		// FIX (Umsetzungs-Runde 21. Juli): auch Heft-Metadaten, GoodNotes-Ordner und die
		// seitenbezogenen UI-Events entsorgen — sonst überlebten heftUpdated/gnFolder*/
		// uiTreeSet/uiTabsSet den Reset und referenzierten Seiten, die es nicht mehr gibt.
		// Hinweis bleibt: bereits gesyncte Events können per Drive-Merge zurückkehren —
		// der Seiten-Reset ist ein LOKALER Neuanfang, kein Drive-Reset.
		const pageTypes = new Set(["pageCreate", "pageUpdate", "pageMove", "pageDelete", "pageTrash", "pageRestore", "pageArchive", "pageUnarchive",
			"heftOps", "heftSnap", "heftBlob", "heftUpdated", "gnFolderCreate", "gnFolderMove", "gnFolderDelete", "gnItemMove", "uiTreeSet", "uiTabsSet"]);
		const evStore = t.objectStore("events");
		forgetKnownEventIds();
		const evReq = evStore.getAll();
		evReq.onsuccess = () => evReq.result.forEach((ev) => { if (pageTypes.has(ev.type)) evStore.delete(ev.seq); });
		t.objectStore("vecs").clear();
		const blobStore = t.objectStore("blobs");
		const keysReq = blobStore.getAllKeys();
		keysReq.onsuccess = () => keysReq.result.forEach((k) => { if (k !== "bgImage") blobStore.delete(k); });
		return done(t);
	}

	return { open, isOpen: () => Boolean(db), addEvent, allEvents, eventAtSeq, eventLogInfo, eventsAfterSeqAll, filterEventsForSync, compactEvents, compactLocalIfDue, isLocalOnly, replaceHeftHistory, stateCheckpointPartHashes, maxSeq, putBlob, getBlob, delBlob, allBlobKeys, getStateCheckpoint, getStateCheckpointPayload, getStateCheckpointHeft, putStateCheckpoint, clearStateCheckpoint, isStateCheckpointKey, blobUrl, putVec, getVec, delVec, allVecs, exportAll, importAll, clearPages };
})();
