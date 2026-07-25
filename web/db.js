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
// Audit-Fixes (25. Juli 2026) — gefunden über das Zusammenspiel mit drive.js, nicht in dieser Datei allein:
// • importAll: _remote-Events zählen nicht mehr als "lokale Änderung" → keine Geister-Konflikte
// • Kompaktierungs-Untergrenze (COMPACT_FLOOR_KEY) → der Merge bringt verdichtete Events nicht zurück
// • compactLocal setzt die seq-basierten Sync-Marken zurück → keine still unhochgeladenen Events mehr
// Ausbau (25. Juli 2026, zweite Runde):
// • merge3(): echter Drei-Wege-Abgleich gegen den letzten GEMEINSAMEN Stand — zwei
//   Bearbeitungen derselben Seite an verschiedenen Stellen werden jetzt zusammengeführt,
//   statt per LWW eine „⚠ Konflikt“-Kopie zu erzeugen. Nur echte Überlappung bleibt Konflikt.
// • Hybride logische Uhr: importierte Zeitstempel heben die lokale Uhr an (U.observeTimes),
//   Gleichstände werden deterministisch per Event-id gebrochen — vorher konnten bei exakt
//   gleichem t BEIDE Geräte sich selbst als Verlierer sehen und je eine Kopie anlegen.
// v8 (25. Juli 2026) — Hefte reisen als Events, nicht mehr als Blob:
// • heftUpdated (Zeiger auf eine Drive-Binärdatei) ist ersetzt durch heftOps (Strich-Operationen)
//   und heftSnap (Vollstand). Damit gibt es nur noch EINEN Transportweg: das Event-Log.
// • Der komplette Heft-Konfliktzweig entfällt — Strich-Operationen zweier Geräte mischen sich
//   von selbst (Union, idempotent), es gibt keinen Gewinner und keine Verlierer-Kopie mehr.
// • heftHeadsOf entfällt ersatzlos (es gibt keine Blob-Hashes mehr, die abzugleichen wären).
// • Kompaktierung: ein heftSnap macht alle älteren heftOps DESSELBEN Hefts überflüssig.
// Bewusst OHNE Rückwärtskompatibilität (Einzelnutzer-Absprache): Alt-Hefte werden beim ersten
// Öffnen aus dem lokalen Blob in einen heftSnap migriert (heft.js), danach ist der Blob Geschichte.
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
	const DROPPABLE_TYPES = new Set(["uiTabsSet", "uiTreeSet", "teleEvent", "heftOps"]);
	const compactFloor = () => localStorage.getItem(COMPACT_FLOOR_KEY) || "";
	// Exportiert, damit test/test-sync.mjs genau diese Regel prüfen kann — der Fehler,
	// den sie verhindert, war nur über zwei aufeinanderfolgende importAll-Aufrufe sichtbar.
	const isLocalOnly = (ev, unsyncedAfterSeq) => (ev.seq || 0) > unsyncedAfterSeq && !ev._remote;
	function compactEvents(events) {
		const sorted = [...events].sort((a, b) => a.t.localeCompare(b.t) || (a.seq || 0) - (b.seq || 0));
		const deletedAt = { page: {}, card: {} };
		for (const ev of sorted) {
			if (!ev.payload) continue;
			if (ev.type === "pageDelete") deletedAt.page[ev.payload.id] = ev.t;
			if (ev.type === "cardDelete") deletedAt.card[ev.payload.id] = ev.t;
		}
		const covered = {}, contentKept = {}, keep = [];
		const teleCutoff = new Date(Date.now() - TELE_KEEP_DAYS * 864e5).toISOString();
		let uiTabsKept = false;
		const uiTreeKeys = new Set();
		const heftSnapped = new Set(); // pageIds, für die (rückwärts gelesen) schon ein heftSnap steht
		for (let i = sorted.length - 1; i >= 0; i--) { // rückwärts: neueste zuerst
			const ev = sorted[i], p = ev.payload || {};
			if (ev.type === "uiTabsSet") { if (uiTabsKept) continue; uiTabsKept = true; }
			else if (ev.type === "uiTreeSet") { if (p.key == null || uiTreeKeys.has(p.key)) continue; uiTreeKeys.add(p.key); }
			else if (ev.type === "teleEvent" && ev.t < teleCutoff) continue;
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

	// SECURITY: entfernt Klartext-Secrets aus settingsSet-Events. Der Drive-Sync nutzt das
	// BEWUSST NICHT — API-Keys & Co. sollen übers Event-Log auf die eigenen Geräte replizieren
	// (appDataFolder = privater App-Speicher im eigenen Konto, siehe state.js). Gedacht für
	// Exporte, die das eigene Konto verlassen (z.B. geteilte Backups).
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
	// SECURITY (secure by default): Secrets werden standardmäßig entfernt — Exporte können
	// das eigene Konto verlassen (geteilte Backups, Bug-Reports). NUR der Drive-Sync opts
	// mit redactSecrets:false aus, weil er Keys bewusst über den privaten appDataFolder
	// aufs eigene Konto repliziert (siehe state.js). Vorher war Redaction opt-in — ein
	// vergessenes Flag exportierte Klartext-Keys.
	async function exportAll(opts = {}) {
		let events = compactEvents(await allEvents());
		if (opts.redactSecrets !== false) events = events.map(redactSecretsFromEvent);
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
			.sort((a, b) => (a.t || "").localeCompare(b.t || "")); // FIX: Zeit- statt Seq-Reihenfolge
		for (const ev of relevant) {
			const p = ev.payload;
			if (ev.type === "pageCreate") apply(p, false);
			else if (ev.type === "pageUpdate" && p.patch) apply(p.patch, true);
			else if (ev.type === "pageMove") pg.parentId = p.parentId || null;
			else if (ev.type === "heftOps" || ev.type === "heftSnap") pg.kind = "heft"; // Inhalt lebt im Log, nicht in Metadaten
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
		const fresh = incoming.filter((ev) => ev && ev.id && !existing.has(ev.id) &&
			!(floor && ev.t < floor && DROPPABLE_TYPES.has(ev.type))); // keine Wiederauferstehung verdichteter Events
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
			const info = (id) => (opts.pageInfo && opts.pageInfo(id)) || {};

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
					fresh.push({ id: mergeId, t: U.now(), type: "pageUpdate", payload: { id, patch: { content: m3.text } } });
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
					id: "conflict-" + loser.id, t: U.now(), type: "pageCreate",
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
					id: "lifeconflict-" + moved.id, t: U.now(), type: "pageCreate",
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
		return { added: fresh.length, conflicts: conflictDetails.length, conflictDetails, merged: mergedDetails.length, mergedDetails, importedEvents: fresh.map((ev) => JSON.parse(JSON.stringify(ev))) };
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
			"heftOps", "heftSnap", "gnFolderCreate", "gnFolderMove", "gnFolderDelete", "gnItemMove", "uiTreeSet", "uiTabsSet"]);
		const evStore = t.objectStore("events");
		const evReq = evStore.getAll();
		evReq.onsuccess = () => evReq.result.forEach((ev) => { if (pageTypes.has(ev.type)) evStore.delete(ev.seq); });
		t.objectStore("vecs").clear();
		const blobStore = t.objectStore("blobs");
		const keysReq = blobStore.getAllKeys();
		keysReq.onsuccess = () => keysReq.result.forEach((k) => { if (k !== "bgImage") blobStore.delete(k); });
		return done(t);
	}

	return { open, addEvent, addEvents, allEvents, eventsAfterSeq, compactEvents, compactLocal, compactFloor, DROPPABLE_TYPES, isLocalOnly, merge3, contentHeadsOf, reconstructPageFromEvents, redactSecretsFromEvent, maxSeq, putBlob, getBlob, delBlob, allBlobKeys, putVec, getVec, delVec, allVecs, exportAll, importAll, resetDatabase, clearPages };
})();