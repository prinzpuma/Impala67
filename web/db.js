"use strict";
import { U } from "./util.js";
import { SETTINGS_SYNC } from "./settings-sync.js";
// IndexedDB-Persistenz für Events, Blobs und lokale Suchdaten.
// Wichtige Regeln: Events sind unveränderlich und per ID zusammenführbar; der Replay ist
// zeitlich deterministisch; Heft-Striche und Bilder reisen vollständig im Event-Log.
// Historische Reparaturen stehen im Git-Verlauf, die aktuellen Schutzregeln direkt bei der Logik.
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
				// blockiert jeden Versionswechsel und resetDatabase (onblocked) — genau der
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
	const allBlobKeys = () => ro("blobs", (s) => s.getAllKeys());

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

	// ---- Log-Kompaktierung: verlustfrei & deterministisch (drop-only) → Log-Merge bleibt konsistent,
	// auch wenn Geräte zu unterschiedlichen Zeitpunkten kompaktieren. Regeln:
	// 1. Patch-Events (pageUpdate/cardUpdate/settingsSet) fliegen, wenn ALLE Felder von neueren Patches
	//    desselben Ziels überschrieben sind (pageUpdate trägt vollen content = DER Speicherfresser).
	// 2. Updates endgültig gelöschter Seiten/Karten fliegen. Rest bleibt (klein, teils reihenfolge-abhängig).
	// 3. UI-Zustand: uiTabsSet ist ein Gesamtsnapshot (nur der jüngste zählt), uiTreeSet eine
	//    Operation je key (jüngstes Event je key genügt) — beide fluteten das Log sonst dauerhaft.
	// 4. teleEvent: Roh-Telemetrie verfällt nach TELE_KEEP_DAYS (drop-only, kein Merge-Konflikt —
	//    ältere Auswertungen verlieren nur Alt-Daten, nie aktuelle).
	// Verlaufs-Schutz: N jüngste Inhalts-Stände je Seite überleben — pageHistory liest das Event-Log.
	const KEEP_CONTENT_VERSIONS = 10;
	const TELE_KEEP_DAYS = 90;
	// Kompaktierungs-Untergrenze: alles ÄLTERE dieser Typen wurde bewusst verdichtet.
	// Ohne die Marke schleust der (per Event-id idempotente) Merge wegkompaktierte Events
	// aus fremden Deltas wieder ein — die Kompaktierung erreichte ihr Ziel dann NIE, und
	// die 90-Tage-Telemetrie-Regel griff faktisch nicht.
	// Bewusst NUR diese drei Typen: ein lange offline gewesenes Gerät hat legitime alte
	// pageUpdate-Patches, die weiterhin ankommen müssen. Für pageUpdate ist Wieder-
	// auferstehung nur ein Platz-, kein Korrektheitsproblem (Replay ist LWW über t).
	const COMPACT_FLOOR_KEY = "impala67_compact_floor";
	// heftOps steht mit auf der Liste, weil ein heftSnap denselben Zustand vollständig ersetzt —
	// verdichtete Strich-Operationen dürfen nicht über fremde Deltas zurückkehren (sie wären zwar
	// idempotent, würden aber den Log wieder aufblähen, den der Snapshot gerade zusammengefasst hat).
	const DROPPABLE_TYPES = new Set(["uiTabsSet", "uiTreeSet", "heftOps"]);
	const compactFloor = () => localStorage.getItem(COMPACT_FLOOR_KEY) || "";
	// Exportiert, damit test/test-sync.mjs genau diese Regel prüfen kann — der Fehler,
	// den sie verhindert, war nur über zwei aufeinanderfolgende importAll-Aufrufe sichtbar.
	// [A2] _derived = von einem Import SELBST erzeugtes Merge-/Konflikt-Event. Es liegt über dem
	// Wasserstand und ist nicht _remote, ist aber keine Bearbeitung DIESES Nutzers. Ohne die Ausnahme
	// meldet der zweite importAll-Aufruf (drive.js, Post-Upload-Sweep) Konflikte gegen den eigenen Merge.
	// Hochgeladen werden sie trotzdem — eventsAfterSeq filtert nur _remote.
	const isLocalOnly = (ev, unsyncedAfterSeq) => (ev.seq || 0) > unsyncedAfterSeq && !ev._remote && !ev._derived;
	function compactEvents(events) {
		const sorted = [...events].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0) || (a.seq || 0) - (b.seq || 0));
		const deletedAt = { page: {}, card: {} };
		for (const ev of sorted) {
			if (!ev.payload) continue;
			if (ev.type === "pageDelete") deletedAt.page[ev.payload.id] = ev.t;
			if (ev.type === "cardDelete") deletedAt.card[ev.payload.id] = ev.t;
		}
		const covered = {}, contentKept = {}, keep = [];
		let uiTabsKept = false;
		const uiTreeKeys = new Set();
		const heftSnapped = new Set(); // pageIds, für die (rückwärts gelesen) schon ein heftSnap steht
		for (let i = sorted.length - 1; i >= 0; i--) { // rückwärts: neueste zuerst
			const ev = sorted[i], p = ev.payload || {};
			if (ev.type === "uiTabsSet") { if (uiTabsKept) continue; uiTabsKept = true; }
			else if (ev.type === "uiTreeSet") { if (p.key == null || uiTreeKeys.has(p.key)) continue; uiTreeKeys.add(p.key); }
			// Heft: der jüngste heftSnap je Seite beschreibt den ganzen Stand — alles Ältere
			// desselben Hefts (Ops wie ältere Snapshots) ist damit redundant. Pro pageId, nicht global.
			else if (ev.type === "heftSnap") { if (heftSnapped.has(p.pageId)) continue; heftSnapped.add(p.pageId); }
			else if (ev.type === "heftOps" && heftSnapped.has(p.pageId)) continue;
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
		keep.reverse();
		// Bilddaten (heftBlob) sind unveränderlich: sie können nie "überschrieben" werden und
		// fallen deshalb durch keine der Regeln oben. Weg dürfen sie trotzdem — aber nur, wenn
		// KEIN behaltenes Heft-Event sie noch referenziert (Bild gelöscht, Seite entfernt,
		// oder der neueste Snapshot enthält sie schlicht nicht mehr). Genau das ist der Grund,
		// warum die Bilder überhaupt aus dem Heft-Dokument ausgezogen sind: so lässt sich der
		// größte Speicherposten gezielt aufräumen, statt ihn in jedem Snapshot mitzuschleppen.
		const usedRefs = new Set();
		for (const ev of keep) {
			const p = ev.payload || {};
			if (ev.type === "heftOps") {
				for (const op of p.ops || []) if (op && op.o && op.o.ref) usedRefs.add(op.o.ref);
			} else if (ev.type === "heftSnap") {
				for (const pg of (p.doc && p.doc.pages) || []) for (const im of pg.images || []) if (im && im.ref) usedRefs.add(im.ref);
			}
		}
		return keep.filter((ev) => ev.type !== "heftBlob" || usedRefs.has(ev.payload && ev.payload.hash));
	}

	// Nur nach erfolgreichem Sync aufrufen: Seq-Nummern werden neu vergeben, der Sync-Wasserstand
	// (impala67_drive_synced_seq) muss danach neu gesetzt werden. Unter minDrop lohnt das Neuschreiben nicht.
	async function compactLocal(minDrop = 200) {
		const evs = await allEvents();
		const compacted = compactEvents(evs);
		const dropped = evs.length - compacted.length;
		if (dropped < minDrop) return 0;
		await rw("events", (s) => { s.clear(); compacted.forEach(({ seq, ...ev }) => s.add(ev)); });
		// Untergrenze setzen, damit fremde Deltas die verworfenen Events nicht zurückbringen.
		localStorage.setItem(COMPACT_FLOOR_KEY, compacted.length ? compacted[0].t : U.now());
		// Der seq-Raum ist komplett neu vergeben — jede seq-basierte Sync-Marke ist damit
		// bedeutungslos. 0 = beim nächsten Sync alles erneut anbieten; importAll ist per
		// Event-id idempotent, es entstehen also keine Duplikate.
		// Vorher stand hier nur ein Kommentar: drive.js [F4] klemmte den zu hohen Wasserstand
		// auf den GESCHRUMPFTEN maxSeq — darunter lagen dann nie hochgeladene Events, die
		// eventsAfterSeq dauerhaft übersprang (stiller Verlust Richtung anderer Geräte).
		localStorage.setItem("impala67_drive_uploaded_seq", "0");
		localStorage.removeItem("impala67_drive_synced_seq");
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
	const stripLocalFlags = ({ _remote, _derived, seq, ...ev }) => ev;

	async function exportAll(opts = {}) {
		let events = compactEvents(await allEvents()).map(stripLocalFlags);
		if (opts.redactSecrets !== false) events = events.map(redactSecretsFromEvent).filter(Boolean);
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
			.sort((a, b) => ((a.t || "") < (b.t || "") ? -1 : (a.t || "") > (b.t || "") ? 1 : 0)); // FIX: Zeit- statt Seq-Reihenfolge
		for (const ev of relevant) {
			const p = ev.payload;
			if (ev.type === "pageCreate") apply(p, false);
			else if (ev.type === "pageUpdate" && p.patch) apply(p.patch, true);
			else if (ev.type === "pageMove") pg.parentId = p.parentId || null;
			else if (ev.type === "heftOps" || ev.type === "heftSnap") pg.kind = "heft"; // Inhalt lebt im Log, nicht in Metadaten
			// Alt-Logs (vor v8) kennen nur heftUpdated als Zeiger auf eine Drive-Binärdatei. Solche
			// Events liegen auf lange nicht gesyncten Geräten weiterhin im Log — ohne diesen Zweig
			// galt die Seite dort als normale Notiz und das Heft war unerreichbar.
			else if (ev.type === "heftUpdated") { pg.kind = "heft"; pg.heftMeta = { rev: p.rev, pages: p.pages, bytes: p.bytes, blobHash: p.blobHash }; }
		}
		return pg;
	}

	// ---- Drei-Wege-Abgleich (diff3) -------------------------------------------------
	// Bisher entschied bei zwei gleichzeitig geänderten Fassungen DERSELBEN Seite allein der
	// Zeitstempel: ein Gerät gewann, das andere bekam eine „⚠ Konflikt“-Kopie — auch dann,
	// wenn die Bearbeitungen völlig verschiedene Absätze betrafen und sich gar nicht
	// widersprachen. merge3 vergleicht beide Fassungen gegen den letzten GEMEINSAMEN Stand:
	//   • nur eine Seite hat einen Abschnitt geändert → diese Änderung wird übernommen
	//   • beide haben ihn identisch geändert          → einmal übernommen
	//   • beide haben ihn unterschiedlich geändert    → echte Überlappung → ok:false, der
	//     Aufrufer fällt auf LWW + Konfliktkopie zurück (es geht also nie etwas verloren)
	// Pure Funktion ohne DB-Zugriff — test/test-sync.mjs prüft sie direkt.
	const MERGE_MAX_LINES = 1200; // O(n*m)-Matrix: darüber lohnt der Versuch nicht
	// LCS als Paar-Liste (Index in A, Index in B) — Grundlage beider Zwei-Wege-Diffs.
	function lcsPairs(A, B) {
		const n = A.length, m = B.length;
		const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
		for (let i = n - 1; i >= 0; i--) {
			const row = dp[i], next = dp[i + 1];
			for (let j = m - 1; j >= 0; j--) {
				row[j] = A[i] === B[j] ? next[j + 1] + 1 : Math.max(next[j], row[j + 1]);
			}
		}
		const pairs = [];
		let i = 0, j = 0;
		while (i < n && j < m) {
			if (A[i] === B[j]) { pairs.push([i, j]); i++; j++; }
			else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
			else j++;
		}
		return pairs;
	}
	function merge3(base, mine, theirs) {
		if (mine === theirs) return { ok: true, text: mine, changed: false };
		if (mine === base) return { ok: true, text: theirs, changed: true };
		if (theirs === base) return { ok: true, text: mine, changed: false };
		// [A3] Ohne belastbare gemeinsame Basis gibt es keinen Drei-Wege-Abgleich. base === "" tritt real
		// auf (Verlaufsfenster KEEP_CONTENT_VERSIONS abgelaufen, pageCreate ohne content). B ist dann [""]
		// und der Anker-Lauf unten ankert auf einer LEEREN Zeile, die es in fast jedem Markdown-Dokument
		// gibt — Ergebnis war ok:true mit einem aus beiden Fassungen zusammengesteckten Text, ohne
		// Konfliktmeldung und ohne Kopie. Lieber ehrlich Konflikt: der Aufrufer rettet dann beide Stände.
		if (!String(base ?? "").trim()) return { ok: false };
		const B = String(base ?? "").split("\n");
		const M = String(mine ?? "").split("\n");
		const T = String(theirs ?? "").split("\n");
		if (B.length > MERGE_MAX_LINES || M.length > MERGE_MAX_LINES || T.length > MERGE_MAX_LINES) return { ok: false };
		// Stabile Anker: Basiszeilen, die in BEIDEN Fassungen unverändert wiederkehren.
		const mMap = new Map(lcsPairs(B, M));
		const tMap = new Map(lcsPairs(B, T));
		const anchors = [];
		let lastM = -1, lastT = -1;
		for (let b = 0; b < B.length; b++) {
			if (!B[b].trim()) continue; // [A3] Leerzeilen stehen überall — als Anker wertlos und gefährlich
			const m = mMap.get(b), t = tMap.get(b);
			if (m === undefined || t === undefined || m <= lastM || t <= lastT) continue;
			anchors.push([b, m, t]);
			lastM = m; lastT = t;
		}
		anchors.push([B.length, M.length, T.length]); // Abschluss-Anker
		const out = [];
		let b0 = 0, m0 = 0, t0 = 0;
		for (const [b1, m1, t1] of anchors) {
			const bChunk = B.slice(b0, b1).join("\n");
			const mChunk = M.slice(m0, m1), tChunk = T.slice(t0, t1);
			const mStr = mChunk.join("\n"), tStr = tChunk.join("\n");
			if (mStr === tStr) out.push(...mChunk);        // beide gleich (auch: beide unverändert)
			else if (mStr === bChunk) out.push(...tChunk); // nur die Gegenseite hat geändert
			else if (tStr === bChunk) out.push(...mChunk); // nur dieses Gerät hat geändert
			else return { ok: false };                     // echte Überlappung → Konfliktkopie
			if (b1 < B.length) out.push(B[b1]);            // der Anker selbst
			b0 = b1 + 1; m0 = m1 + 1; t0 = t1 + 1;
		}
		const text = out.join("\n");
		return { ok: true, text, changed: text !== mine };
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
			const t = typeof ev.t === "number" ? new Date(ev.t).toISOString() : ev.t;
			if (!ev.id || typeof ev.type !== "string" || typeof t !== "string" || !t) return null;
			return t === ev.t ? ev : { ...ev, t };
		});
		const malformed = normalized.filter((ev) => !ev).length;
		if (malformed) console.warn("[importAll] " + malformed + " unbrauchbare Event(s) übersprungen (fehlende id/t/type).");
		const transportEvents = opts.remote && opts.allowSecrets === false
			? SETTINGS_SYNC.sanitizeEvents(normalized, false)
			: normalized.filter(Boolean);
		// [A1] heftOps stand global in DROPPABLE_TYPES — mit derselben Begründung, die weiter oben für
		// pageUpdate ausdrücklich ABGELEHNT wird. Der Unterschied ist entscheidend: eine verworfene
		// pageUpdate kostet nur Platz (Replay ist LWW über t), ein verworfener Strich ist WEG. Ein Gerät,
		// das lange offline gezeichnet hat, verlor seine Handschrift beim ersten Sync still — und weil
		// dieses Gerät danach einen heftSnap schreibt, spiegelte sich der Verlust zurück.
		// Jetzt gilt die Untergrenze für Hefte PRO SEITE und nur dann, wenn ein lokal vorhandener
		// heftSnap den betroffenen Stand nachweislich abdeckt.
		const heftSnapFloor = new Map(); // pageId -> t des jüngsten lokalen heftSnap
		for (const ev of local) {
			if (ev.type !== "heftSnap" || !ev.payload?.pageId) continue;
			const cur = heftSnapFloor.get(ev.payload.pageId);
			if (!cur || ev.t > cur) heftSnapFloor.set(ev.payload.pageId, ev.t);
		}
		const droppedByFloor = (ev) => {
			if (!floor || ev.t >= floor) return false;
			if (ev.type === "heftOps") {
				const snapT = heftSnapFloor.get(ev.payload?.pageId);
				return !!snapT && ev.t < snapT; // nur, wenn ein Snapshot diesen Stand wirklich enthält
			}
			return DROPPABLE_TYPES.has(ev.type);
		};
		const fresh = transportEvents.filter((ev) => !existing.has(ev.id) && !droppedByFloor(ev));
		// Nur echte Drive-Downloads als _remote markieren — ein manueller Backup-Import ist eine lokale
		// Nutzeraktion und muss normal hochgeladen werden. (Set VOR den Konfliktkopien bilden: die syncen normal.)
		const remoteIds = opts.remote ? new Set(fresh.map((ev) => ev.id)) : new Set();
		// Hybride logische Uhr (siehe util.js): die eigene Uhr auf jeden gesehenen fremden
		// Zeitstempel heben, BEVOR unten Merge-/Konflikt-Events mit U.now() entstehen. Sonst
		// könnte eine nachgehende Geräteuhr Events datieren, die im Replay VOR dem gerade
		// importierten Stand landen, den sie eigentlich ablösen sollen.
		U.observeTimes(fresh);
		const conflictDetails = [];
		const mergedDetails = [];
		if (typeof opts.unsyncedAfterSeq === "number" && fresh.length) {
			// _remote = echter Drive-Download. Solche Events bekommen beim Import zwar eine frische
			// lokale seq (> unsyncedAfterSeq), sind aber NIE eine Änderung DIESES Geräts.
			// Ohne den !_remote-Filter meldete ein Sync mit Snapshot UND Delta Konflikte gegen sich
			// selbst: syncRaw importiert erst den Snapshot, dessen Events liegen im zweiten
			// importAll-Aufruf über dem Wasserstand und galten damit als "meine ungesyncten
			// Änderungen" — Ergebnis waren "⚠ Konflikt"-Kopien ohne jede lokale Bearbeitung.
			const localOnly = (ev) => isLocalOnly(ev, opts.unsyncedAfterSeq); // seit letztem Sync, kennt kein anderes Gerät
			// [A9] Der UI-Zustand (S.pages) kann veraltet sein: der zweite Tab betritt syncRaw mit dem Stand
			// VOR dem Import des ersten (der Web Lock serialisiert nur, er teilt keinen Speicher). Titel und
			// Ablageort einer Konfliktkopie waren dadurch falsch. Das Log ist die Wahrheit — also Rückfall.
			const info = (id) => {
				const pi = (opts.pageInfo && opts.pageInfo(id)) || null;
				if (pi && pi.title) return pi;
				const pg = reconstructPageFromEvents([...local, ...fresh], id);
				return { title: pg.title, parentId: pg.parentId, workspaceId: pg.workspaceId };
			};

			// (1) Inhalts-Konflikt: gleiche Seite lokal UND remote geändert. Erst wird ein
			// Drei-Wege-Abgleich versucht; nur bei echter Überlappung greift LWW + Konfliktkopie.
			const localHeads = contentHeadsOf(local, localOnly), remoteHeads = contentHeadsOf(fresh);
			// Letzter GEMEINSAMER Stand = alles, was dieses Gerät schon gesynct hatte bzw. selbst
			// per Sync bekommen hat. Genau die Basis, von der beide Seiten losgelaufen sind.
			const commonEvents = local.filter((ev) => !localOnly(ev));
			for (const [id, remote] of Object.entries(remoteHeads)) {
				const mine = localHeads[id];
				if (!mine || mine.payload.patch.content === remote.payload.patch.content) continue;
				// (1a) Betreffen die beiden Bearbeitungen verschiedene Stellen, gibt es gar keinen
				// Konflikt — beide werden übernommen. Die Merge-Event-id ist aus beiden Quell-ids
				// abgeleitet und seitenunabhängig sortiert: beide Geräte erzeugen dieselbe id, der
				// Merge ist damit idempotent und läuft nach dem Rück-Sync nicht doppelt.
				const mergeId = "merge3-" + (mine.id < remote.id ? mine.id + "-" + remote.id : remote.id + "-" + mine.id);
				if (existing.has(mergeId)) continue; // schon zusammengeführt — kein Konflikt mehr
				const m3 = merge3(reconstructPageFromEvents(commonEvents, id).content, mine.payload.patch.content, remote.payload.patch.content);
				if (m3.ok) {
					mergedDetails.push({ pageId: id, title: info(id).title || "Seite", localTime: mine.t, remoteTime: remote.t });
					fresh.push({ id: mergeId, t: U.now(), type: "pageUpdate", _derived: true, payload: { id, patch: { content: m3.text } } });
					continue;
				}
				// (1b) Echte Überlappung: der spätere Zeitstempel gewinnt still, der unterlegene
				// Stand wird als Kopie gerettet. Gleichstand deterministisch per id brechen, damit
				// BEIDE Geräte denselben Verlierer wählen (sonst legt jede Seite eine Kopie an).
				const remoteWins = mine.t !== remote.t ? mine.t < remote.t : mine.id < remote.id;
				const loser = remoteWins ? mine : remote;
				if (existing.has("conflict-" + loser.id)) continue;
				const pi = info(id), title = pi.title || "Seite", conflictPageId = "conflictpg-" + loser.id;
				conflictDetails.push({
					pageId: id, title,
					reason: "Dieselbe Seite wurde seit dem letzten Sync sowohl hier als auch auf einem anderen Gerät geändert — und zwar an derselben Stelle, sodass sie sich nicht automatisch zusammenführen ließ. Der neuere Zeitstempel gewinnt; der ältere Stand liegt als Kopie bereit.",
					localContent: mine.payload.patch.content, remoteContent: remote.payload.patch.content,
					localTime: mine.t, remoteTime: remote.t,
					winner: remoteWins ? "remote" : "local",
					loserContent: loser.payload.patch.content, loserTime: loser.t,
					conflictPageId, eventId: "conflict-" + loser.id,
				});
				fresh.push({
					id: "conflict-" + loser.id, t: U.now(), type: "pageCreate", _derived: true,
					payload: {
						id: conflictPageId,
						title: "⚠ Konflikt: " + title + " — Stand " + loser.t.slice(0, 16).replace("T", " "),
						content: loser.payload.patch.content,
						parentId: pi.parentId || null, workspaceId: pi.workspaceId || "default",
					},
				});
			}

			// (2) Heft-Konflikte gibt es seit v8 nicht mehr. Hefte reisen als Strich-Operationen
			// (heftOps/heftSnap) im selben Log wie alles andere: zwei Geräte, die gleichzeitig in
			// dasselbe Heft zeichnen, ergeben die Vereinigung beider Striche. Nichts zu entscheiden,
			// nichts zu retten — deshalb steht hier bewusst kein Code mehr.

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
				conflictDetails.push({
					pageId: id, title: pg.title,
					reason: "Diese Seite wurde auf einem Gerät endgültig gelöscht, während sie auf einem anderen Gerät seit dem letzten Sync verschoben, wiederhergestellt oder geändert wurde. Das Löschen gewinnt beim Merge; der andere Stand liegt als Kopie bereit.",
					deletedAt: del.t, changedAt: moved.t, conflictPageId, conflictType: "delete-change",
					parentId: pg.parentId, workspaceId: pg.workspaceId, eventId: "lifeconflict-" + moved.id,
					loserSource,
				});
				fresh.push({
					id: "lifeconflict-" + moved.id, t: U.now(), type: "pageCreate", _derived: true,
					payload: { id: conflictPageId, title: "⚠ Konflikt (gelöscht/verschoben): " + pg.title, content: pg.content, parentId: pg.parentId, workspaceId: pg.workspaceId, kind: pg.kind },
				});
				// Heft-Striche werden hier NICHT mitkopiert: sie liegen als heftOps/heftSnap unter der
				// ursprünglichen Seiten-id im Log und sind damit weiterhin vollständig vorhanden.
			}
		}
		fresh.forEach((ev) => { delete ev.seq; if (remoteIds.has(ev.id)) ev._remote = true; }); // neue lokale Seq
		if (fresh.length) await addEvents(fresh);
		const blobs = data.blobs && typeof data.blobs === "object" ? data.blobs : {};
		const have = new Set(await allBlobKeys());
		// PERF: fehlende Blobs in EINER Transaktion statt einer je Blob (Erst-Import mit vielen PDFs/Heften).
		const missing = Object.entries(blobs).filter(([k]) => !have.has(k));
		if (missing.length) await rw("blobs", (s) => missing.forEach(([k, v]) => s.put({ buf: U.b64ToBuf(v.b64), meta: v.meta }, k)));
		// importedEvents = tiefe Kopien für Live-Replay ohne reload — UI darf den Import-Payload nicht mutieren.
		return { added: fresh.length, malformed, conflicts: conflictDetails.length, conflictDetails, merged: mergedDetails.length, mergedDetails, importedEvents: fresh.map((ev) => JSON.parse(JSON.stringify(ev))) };
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
		// FIX (Umsetzungs-Runde 21. Juli): auch Heft-Metadaten, GoodNotes-Ordner und die
		// seitenbezogenen UI-Events entsorgen — sonst überlebten heftUpdated/gnFolder*/
		// uiTreeSet/uiTabsSet den Reset und referenzierten Seiten, die es nicht mehr gibt.
		// Hinweis bleibt: bereits gesyncte Events können per Drive-Merge zurückkehren —
		// der Seiten-Reset ist ein LOKALER Neuanfang, kein Drive-Reset.
		const pageTypes = new Set(["pageCreate", "pageUpdate", "pageMove", "pageDelete", "pageTrash", "pageRestore",
			"heftOps", "heftSnap", "heftBlob", "heftUpdated", "gnFolderCreate", "gnFolderMove", "gnFolderDelete", "gnItemMove", "uiTreeSet", "uiTabsSet"]);
		const evStore = t.objectStore("events");
		const evReq = evStore.getAll();
		evReq.onsuccess = () => evReq.result.forEach((ev) => { if (pageTypes.has(ev.type)) evStore.delete(ev.seq); });
		t.objectStore("vecs").clear();
		const blobStore = t.objectStore("blobs");
		const keysReq = blobStore.getAllKeys();
		keysReq.onsuccess = () => keysReq.result.forEach((k) => { if (k !== "bgImage") blobStore.delete(k); });
		return done(t);
	}

	return { open, addEvent, addEvents, allEvents, eventsAfterSeq, filterEventsForSync, compactEvents, compactLocal, compactFloor, DROPPABLE_TYPES, isLocalOnly, merge3, contentHeadsOf, reconstructPageFromEvents, redactSecretsFromEvent, maxSeq, putBlob, getBlob, delBlob, allBlobKeys, blobUrl, revokeBlobUrl, putVec, getVec, delVec, allVecs, exportAll, importAll, resetDatabase, clearPages };
})();
