"use strict";
import { U } from "./util.js";
import { BUS } from "./event-bus.js";
import { DB } from "./db.js";
import { PERF_PROFILER } from "./performance-profiler.js";
import { createCheckpointScheduler } from "./checkpoint-scheduler.js";
import { CORE } from "./rust-core.js";
import { installViews } from "./state-views.js";
// state.js — Zustand der App. Das Datenmodell (Zustand, Reducer, Laden aus Checkpoint und Log,
// Reihenfolge, Checkpoints, Abfragen) liegt im Rust-Kern (core/impala-model, hier ModelCore).
// Jede Änderung ist ein Event: dispatch() speichert es in IndexedDB und lässt es den Kern
// anwenden. Die Oberfläche liest über Abfragen und die Lese-Ansichten in S (state-views.js);
// Hefte und ihre Bilder nur über STATE.heftDoc/heftPage/heftBlob.
export { BUS } from "./event-bus.js";

// Der eine Zustand im Kern (je Tab).
const M = new CORE.ModelCore();

// Flüchtiger Zustand der Oberfläche (nicht im Log). Die gespeicherten Teile (pages, cards,
// decks, settings, …) hängt installViews() unten als nur lesbare Ansichten an.
export const S = {
	tabs: [], // offene Seiten- oder Chat-IDs (Präfix "chat:" für Chats); gespeichert per uiTabsSet
	activeTabId: null,
	chat: [], // Haupt-Chatverlauf (Vollbild-Tab)
	sideChat: [], // Verlauf für das kleine KI-Seitenpanel
	sideChatId: null, // eigene gespeicherte Chat-Sitzung des Seitenpanels
	aiActiveChatType: "side", // "side" | "full"
	aiActiveChatId: null, // laufende Antwort bleibt an ihre Sitzung gebunden, auch nach Navigation
	highlightedPageId: null, // Für die Hervorhebung geänderter Blöcke
	highlightedDiff: null, // Diff-Array für die Hervorhebung geänderter Blöcke
	currentPageId: null,
	currentWorkspaceId: "default",
	view: "home", // "home" | "page" | "library" | "chat" | "anki" | "noten" | "daily" | "trash"
	pendingImage: null,
	pendingAttachmentTarget: null, // "side" | "full" — Chat, dem der ausgewählte Anhang gehört
	attachTarget: "side", // zuletzt geöffneter Datei-Dialog; erst nach Dateiauswahl wird der Anhang zugeordnet
	settingsSection: "overview",
	sidebarMode: "files", // "files" | "chats"
	navHistory: [], // für Zurück/Vor
	navIndex: -1,
	aiThinkingDraft: "", // aktuell gestreamter Denkprozess (Reasoning-Modelle)
	thinkingLiveExpanded: false,
	pdfOpen: true,
	aiBusy: false,
	aiStatus: "",
	aiDraft: "",
	aiOnline: null, // null = unbekannt, true/false = Ping-Ergebnis
	reviewShowBack: false,
	reviewCardId: null, // Karte bleibt von der Frage bis zur Bewertung fest angeheftet
	pendingTextFile: null, // { name, content, size } — langer geklebter Text, wird als .txt-Anhang statt Fließtext gesendet
	pendingPdf: null, // { name, content, size, pages } — PDF-Anhang für den aktuellen Chat, wird nicht automatisch als Seite gespeichert
	availableModels: [], // vom Server abgefragte Modell-Liste (ephemer, nicht persistiert)
	modelMenuOpen: false,
	modelMenuAnchor: "panel", // welches Chat-Fenster das Modell-Dropdown geöffnet hat: "panel" | "full"
	modelMenuLoading: false, // true, solange listModels() die Quellen abfragt
	modelMenuSection: "root", // "root" | "models" | "thinking"
	customModelProviderPick: null, // im Dropdown gewählte Quelle für ein eigenes Modell
	refineOpenMid: null, // mid einer Assistenten-Antwort, deren "Anpassen"-Menü offen ist
	libMode: "notion", // Bibliothek-Ansicht: "notion" (Dokumente/Seitenbaum) | "hefte" (GoodNotes-Regal) | "nlm" (NotebookLM-Mediathek)
	nlmLibFilter: "all", // NotebookLM-Mediathek-Filter: "all" | "inbox" | "audio" | "video" | "mindmap" | "slides"
	libFolder: null, // geöffneter GoodNotes-Ordner im Hefte-Regal (gnFolders-ID), null = Wurzel
	libFilter: "", // Filtertext der Bibliothek (Titel + Tags)
	pageMenuOpenId: null, // ID der Seite, deren ⋯-Menü in der Sidebar gerade offen ist
	histVersions: null, // geladene Versionen für den Seitenverlauf-Dialog
	histIndex: 0, // aktuell ausgewählte Version im Verlauf
	histPageId: null, // Seite, deren Verlauf gerade offen ist
	pendingNewPage: null, // { wsId, parentId } während der Vorlagen-Auswahl
	ankiTab: "decks", // Karteikarten-Bereich: "decks" | "browser" | "stats" | "archive" | "study"
	ankiDeck: null, // aktuell gewählter Stapel (null = alle)
	ankiSort: "due", // Browser-Sortierung: "front" | "deck" | "state" | "due" | "interval" | "reps" | "lapses" | "created"
	ankiSortDir: 1, // 1 = aufsteigend, -1 = absteigend
	ankiSearch: "", // Suchtext im Karten-Browser
	ankiBrowserLimit: 200, // Karten-Browser: max. gerenderte Zeilen („mehr anzeigen“ erhöht)
	dailyMonth: null, // "YYYY-MM" im Daily-Notes-Kalender (null = aktueller Monat)
};

// Offener Chat: Der Kern lässt seinen Tab gelten, auch bevor die Sitzung gespeichert ist.
let _currentChatId = null;
Object.defineProperty(S, "currentChatId", {
	get: () => _currentChatId,
	set: (id) => { _currentChatId = id ?? null; M.setCurrentChatId(_currentChatId == null ? undefined : String(_currentChatId)); },
	enumerable: true,
});

// pages, cards, decks, settings, reviews … (nur lesbar, siehe state-views.js)
const VIEWS = installViews(S, M);

const ids = (json) => JSON.parse(json);
const page = (id) => S.pages[id];
const card = (id) => S.cards[id];

export const STATE = (() => {
	// Revisionen der Lese-Abfragen: jedes Event, das Seiten bzw. Karten berührt, macht die
	// zwischengespeicherten Abfrage-Ergebnisse ungültig.
	let _pageRev = 0;
	let _cardRev = 0;
	let _stateRevision = 0;
	let _loading = false;
	let _queuedRemoteEvents = [];
	const _memo = new Map(); // "Abfrage|Schlüssel" → { rev, value }
	function memo(key, rev, compute) {
		const hit = _memo.get(key);
		if (hit && hit.rev === rev) return hit.value;
		const value = compute();
		_memo.set(key, { rev, value });
		return value;
	}
	const pageMemo = (key, compute) => memo("p|" + key, _pageRev, compute);
	const cardMemo = (key, compute) => memo("c|" + key, _cardRev, compute);
	const _heftMeta = new Map();

	// Race-Condition-Fix (10. Juli): serialisiert dispatch()-Aufrufe. Jeder Aufrufer erhält sein
	// eigenes Promise; ein Fehlschlag blockiert nachfolgende Aufrufe nicht.
	let _dispatchChain = Promise.resolve();

	// Offizieller Hook-Mechanismus: before-Hooks laufen VOR dem Persistieren (z.B. Undo-Snapshot),
	// after-Hooks NACH dem Anwenden + onChange (z.B. Event an andere Tabs funken).
	// Hook-Fehler werden geloggt, brechen dispatch aber nie ab.
	const _dispatchHooks = { before: [], after: [] };
	const onBeforeDispatch = (fn) => { _dispatchHooks.before.push(fn); };
	const onAfterDispatch = (fn) => { _dispatchHooks.after.push(fn); };

	// Wer auf eingetroffene Fremdänderungen reagieren muss — z.B. ein offenes Heft, das sofort die
	// Striche des anderen Geräts zeigen soll — hängt sich hier ein. fn(types: Set, events: Array).
	const _remoteHooks = [];
	const onRemoteApplied = (fn) => { _remoteHooks.push(fn); };
	const emitRemoteApplied = (types, events) => {
		for (const fn of _remoteHooks) {
			try { fn(types, events); } catch (e) { console.warn("remote-Hook:", e); }
		}
	};

	// Meldung des Kerns verarbeiten: Ansichten und Abfragen ungültig machen, geschlossene Seiten
	// aus der Oberfläche nehmen, gespeicherte Tabs übernehmen.
	// meta: { origin } aus dispatch() bzw. { remote: true } für Fremd-Events; geht nur an die Oberfläche.
	function afterApply(ev, touched, meta) {
		_stateRevision++;
		VIEWS.touch(touched);
		if (touched.pages || touched.heft) _pageRev++;
		if (touched.cards || touched.decks || touched.reviews || touched.settings) _cardRev++;
		if (touched.heft) _heftMeta.delete(touched.heft);
		if (touched.blob) _heftMeta.clear();
		if (touched.closedPages) closePageTabs(touched.closedPages);
		if (touched.tabs) adoptTabs();
		if (!_loading) emitDomainEvents(ev, meta);
	}

	// Gespeicherte Tabs (uiTabsSet) in die Oberfläche übernehmen.
	function adoptTabs() {
		const t = JSON.parse(M.tabs());
		S.tabs = t.tabs;
		S.activeTabId = t.activeTabId;
	}

	// Entfernte Seiten: Tabs und offene Ansicht schließen (die gespeicherten Tabs schließt der Kern).
	function closePageTabs(list) {
		const gone = new Set(list || []);
		if (!gone.size) return;
		S.tabs = (S.tabs || []).filter((id) => !gone.has(id));
		if (gone.has(S.activeTabId)) S.activeTabId = null;
		if (gone.has(S.currentPageId)) {
			S.currentPageId = null;
			if (S.view === "page") S.view = "home";
		}
		// Vektoren liegen bewusst außerhalb des Event-Logs; beim endgültigen Löschen müssen sie mit weg.
	}
	function deletePageVector(pageId) {
		if (!pageId) return;
		try {
			const pending = DB.delVec(pageId);
			if (pending && typeof pending.catch === "function") pending.catch((err) => console.warn("Seitenvektor konnte nicht gelöscht werden:", err));
		} catch (err) {
			// Ohne geöffnete Datenbank (Tests) gibt es auch keinen Vektor.
			if (!String(err?.message || err).includes("DB.open")) console.warn("Seitenvektor konnte nicht gelöscht werden:", err);
		}
	}

	function emitDomainEvents(ev, meta) {
		const type = ev?.type;
		const p = ev?.payload || {};
		switch (type) {
			case "pageCreate":
				BUS.emit("state:page-created", { id: p.id, page: S.pages[p.id], event: ev });
				break;
			case "pageUpdate":
			case "pageMove":
			case "pageRestore":
				BUS.emit("state:page-updated", { id: p.id, patch: p.patch, page: S.pages[p.id], event: ev });
				break;
			case "pageTrash":
				BUS.emit("state:page-updated", { id: p.id, trashed: true, page: S.pages[p.id], event: ev });
				BUS.emit("state:page-deleted", { id: p.id, trashed: true, event: ev });
				break;
			case "pageArchive":
				BUS.emit("state:page-updated", { id: p.id, archived: true, page: S.pages[p.id], event: ev });
				break;
			case "pageUnarchive":
				BUS.emit("state:page-updated", { id: p.id, archived: false, page: S.pages[p.id], event: ev });
				break;
			case "pageDelete":
				deletePageVector(p.id);
				BUS.emit("state:page-deleted", { id: p.id, hard: true, event: ev });
				break;
			case "heftOps":
			case "heftSnap":
				BUS.emit("state:heft-changed", { pageId: p.pageId, event: ev, origin: meta?.origin, remote: !!meta?.remote });
				break;
			case "heftBlob":
				BUS.emit("state:heft-changed", { hash: p.hash, event: ev });
				break;
			default:
				if (type && (type.startsWith("card") || type.startsWith("deck"))) {
					BUS.emit("state:cards-updated", { type, payload: p, cardId: p.id, deck: p.deck || p.name, event: ev });
				}
				break;
		}
	}

	// ---- Fremd-Events -----------------------------------------------------------------------
	// EIN Pfad für bereits persistierte Fremd-Events (Drive, Cloudflare und BroadcastChannel):
	// Uhr nachziehen, im Kern anwenden (er sortiert nach Zeit), UI invalidieren, Live-Module informieren.
	const REMOTE = Object.freeze({ remote: true });
	function applyRemoteNow(events) {
		const list = (Array.isArray(events) ? events : []).filter((ev) => ev && typeof ev === "object");
		if (!list.length) return [];
		if (_loading) { _queuedRemoteEvents.push(...list); return list; }
		return PERF_PROFILER.measure("state.remote-replay", () => {
			for (const ev of list) U.observeTime(ev.t);
			const applied = JSON.parse(M.applyRemote(JSON.stringify(list)));
			const ordered = applied.map(({ i, touched }) => { afterApply(list[i], touched, REMOTE); return list[i]; });
			if (typeof STATE.onChange === "function") STATE.onChange("syncImport", { payload: { count: ordered.length } });
			emitRemoteApplied(new Set(ordered.map((ev) => ev?.type).filter((t) => typeof t === "string")), ordered);
			return ordered;
		}, { eventCount: list.length }, 16);
	}
	const applyRemoteEvents = (events) => applyRemoteNow(events);
	// Früher spielte JS Event für Event mit Pausen ab; der Kern wendet auch große Pakete am Stück an.
	const applyRemoteEventsCooperative = async (events) => applyRemoteNow(events);

	// ---- Eigene Änderungen ------------------------------------------------------------------
	async function dispatchOne(type, payload, meta) {
		if (typeof type !== "string" || !type) {
			console.error("[dispatch] Ungültiger Event-Typ:", type);
			throw new Error("dispatch erwartet einen Event-Typen als String, erhalten: " + typeof type);
		}
		// Das append-only Event darf keine Referenzen auf veränderliche Aufruferobjekte behalten.
		if (payload && typeof payload === "object") payload = structuredClone(payload);
		for (const fn of _dispatchHooks.before) {
			try { fn(type, payload); } catch (e) { console.warn("dispatch-Hook (before):", e); }
		}
		const json = CORE.ModelCore.localEvent(type, payload === undefined ? "" : JSON.stringify(payload), U.uid(), U.now());
		const ev = JSON.parse(json);
		// Erst persistieren, dann anwenden — sonst zeigt die UI bei einem Speicherfehler
		// (z.B. Quota voll) Änderungen, die nie gespeichert wurden.
		try {
			await DB.addEvent(ev);
		} catch (e) {
			let quota = "";
			try {
				const est = await navigator.storage?.estimate?.();
				if (est?.quota) quota = " — Speicher: " + Math.round((est.usage || 0) / 1048576) + " von " + Math.round(est.quota / 1048576) + " MB belegt";
			} catch { /* Diagnose ist optional */ }
			U.toast("Speichern fehlgeschlagen" + quota + ": " + (e && e.message ? e.message : e), "error");
			throw e;
		}
		afterApply(ev, JSON.parse(M.applyLocal(json)), meta);
		// boot.js setzt einmalig: STATE.onChange = () => RENDER.render();
		if (typeof STATE.onChange === "function") STATE.onChange(type, ev);
		for (const fn of _dispatchHooks.after) {
			try { fn(ev); } catch (e) { console.warn("dispatch-Hook (after):", e); }
		}
		BUS.emit("state:event-dispatched", ev);
		return ev;
	}
	// meta (optional, nicht gespeichert): { origin } – wer das Event erzeugt hat (z.B. der Heft-Editor,
	// dessen Arbeitskopie die Änderung schon enthält).
	function dispatch(type, payload, meta) {
		const run = _dispatchChain.then(() => dispatchOne(type, payload, meta));
		_dispatchChain = run.then(() => undefined, () => undefined);
		return run;
	}

	// ---- Start ------------------------------------------------------------------------------
	const LOAD_CHUNK = 2000;
	function feedEvents(events, full) {
		for (let i = 0; i < events.length; i += LOAD_CHUNK) M.loadEvents(JSON.stringify(events.slice(i, i + LOAD_CHUNK)), full);
	}

	// Checkpoint + Rest des Logs, sonst das ganze Log. IndexedDB liest JS, rechnen tut der Kern.
	async function load() {
		const finishProfile = PERF_PROFILER.start("state.load", {}, 20);
		_loading = true; _queuedRemoteEvents = [];
		try {
			const [info, checkpoint] = await Promise.all([
				PERF_PROFILER.run("state.event-info", () => DB.eventLogInfo(), {}, 5),
				PERF_PROFILER.run("state.checkpoint-read", () => DB.getStateCheckpoint().catch(() => null), {}, 5),
			]);
			let boundary = null, tail = [], all = null;
			if (checkpoint) {
				const maxSeq = Number(checkpoint.maxSeq) || 0;
				[boundary, tail] = await PERF_PROFILER.run("state.checkpoint-tail", () => Promise.all([
					maxSeq ? DB.eventAtSeq(maxSeq) : Promise.resolve(null),
					DB.eventsAfterSeqAll(maxSeq, info.maxSeq),
				]), { fromSeq: maxSeq, toSeq: info.maxSeq }, 5);
			} else {
				all = await PERF_PROFILER.run("state.full-event-read", () => DB.allEvents(), {}, 5);
			}
			M.loadBegin(JSON.stringify({ info, checkpoint, boundary }));
			feedEvents(tail, false);
			if (all) feedEvents(all, true);
			// Hefte des Checkpoints liegen als eigene Teile; was fehlt, verwirft der Kern den Checkpoint.
			for (const hash of new Set(Object.values(checkpoint?.heftDocHashes || {}))) {
				const json = await DB.getStateCheckpointHeft(hash);
				if (typeof json === "string") M.loadHeftDoc(hash, json);
			}
			let report = PERF_PROFILER.measure("state.core-load", () => JSON.parse(M.loadFinish(U.now())), { tail: tail.length }, 5);
			if (report.needAll) {
				all = await PERF_PROFILER.run("state.full-event-read", () => DB.allEvents(), {}, 5);
				feedEvents(all, true);
				report = PERF_PROFILER.measure("state.core-load", () => JSON.parse(M.loadFinish(U.now())), { full: all.length }, 5);
			}
			// Nur den ungültigen Kernzustand verwerfen: Heft-Bilder sind inhaltsadressiert und bleiben gültig.
			if (report.clearCheckpoint) DB.clearStateCheckpoint({ keepHeftBlobs: true }).catch(() => {});
			if (report.maxTime) U.observeTime(report.maxTime);
			VIEWS.reset();
			_pageRev++; _cardRev++; _stateRevision++;
			_memo.clear(); _heftMeta.clear();
			adoptTabs();
			_loading = false;
			const queued = _queuedRemoteEvents;
			_queuedRemoteEvents = [];
			// Was der Start schon enthielt, erkennt der Kern nicht wieder: doppelte IDs aussortieren.
			const loadedIds = new Set([...tail, ...(all || [])].map((event) => event?.id).filter(Boolean));
			const fresh = queued.filter((event) => !event?.id || !loadedIds.has(event.id));
			if (fresh.length) applyRemoteNow(fresh);
			finishProfile({ count: report.count, replayed: report.replayed, checkpointUsed: report.checkpointUsed, ...(report.rejectReason ? { rejectReason: report.rejectReason } : {}) });
			return { maxSeq: report.maxSeq, maxTime: report.maxTime, count: report.count, replayed: report.replayed, checkpointUsed: report.checkpointUsed };
		} catch (error) {
			finishProfile({ failed: true, errorName: error?.name || "Error", errorMessage: error?.message || String(error) });
			throw error;
		} finally {
			_loading = false;
		}
	}

	// ---- Heft-Bilder ------------------------------------------------------------------------
	// Bilder aus dem Checkpoint werden nur für das Heft geladen, das sie braucht. Fehlt ein Teil,
	// wird das Log nach dem heftBlob durchsucht.
	const hasHeftBlob = (hash) => M.hasHeftBlob(String(hash));
	const heftBlob = (hash) => (hash ? M.heftBlob(String(hash)) : undefined);
	const releaseHeftBlobs = (keep) => M.releaseHeftBlobs(JSON.stringify([...(keep || [])]));
	async function hydrateHeftBlobs(targetHashes = null) {
		const targets = JSON.stringify(targetHashes ? [...targetHashes] : null);
		const needed = JSON.parse(M.blobsToHydrate(targets));
		const found = {}, recovered = {};
		const BATCH_SIZE = 4;
		for (let i = 0; i < needed.length; i += BATCH_SIZE) {
			const batch = needed.slice(i, i + BATCH_SIZE);
			try {
				const chunk = await PERF_PROFILER.run("state.checkpoint-heft-read", () => DB.getStateCheckpointPayload(batch), { count: batch.length }, 5);
				for (const [hash, data] of Object.entries(chunk || {})) if (typeof data === "string") found[hash] = data;
			} catch (error) {
				console.warn("[state] Fehler beim Lesen der Heft-Checkpoint-Blobs:", error);
			}
		}
		const missing = new Set(needed.filter((hash) => typeof found[hash] !== "string"));
		if (missing.size) {
			console.warn("[state] Heft-Checkpoint-Payload unvollständig (" + missing.size + " fehlend), prüfe Event-Log:", [...missing]);
			for (const event of await DB.allEvents()) {
				const p = event?.payload || {};
				if (event?.type === "heftBlob" && missing.has(p.hash) && typeof p.data === "string") {
					recovered[p.hash] = p.data;
					missing.delete(p.hash);
					if (!missing.size) break;
				}
			}
		}
		M.hydrateHeftBlobs(targets, JSON.stringify(found), JSON.stringify(recovered));
		if (Object.keys(recovered).length) _heftMeta.clear();
		return true;
	}

	// ---- Hefte (nur gezielte Abfragen, keine Kopie aller Hefte) --------------------------------
	const heftDoc = (pageId) => { const json = pageId ? M.heftDoc(String(pageId)) : undefined; return json ? JSON.parse(json) : null; };
	const heftPage = (pageId, index) => { const json = M.heftPage(String(pageId), Math.max(0, index | 0)); return json ? JSON.parse(json) : null; };
	const heftPageById = (pageId, key) => { const json = M.heftPageById(String(pageId), String(key)); return json ? JSON.parse(json) : null; };
	const heftPageIds = (pageId) => { const json = M.heftPageIds(String(pageId)); return json ? JSON.parse(json) : null; };
	// Schatten des gespeicherten Hefts (CORE.HeftShadow) für den Heft-Editor, ohne Umweg über JS.
	const heftShadow = (pageId) => M.heftShadow(String(pageId)) || null;
	const heftIds = () => ids(M.heftIds());
	const heftImageRefs = (pageId) => ids(M.heftImageRefs(String(pageId)));
	// Alle Hefte ohne Strichpunkte (Handschrift-Index): [{ pageId, pages: [{ id, strokes, ocrText, images }] }].
	const heftIndexSummary = () => JSON.parse(M.heftIndexSummary());
	// { rev, pages, ocrText, updated, bytes } — gemerkt bis zum nächsten Event dieses Hefts.
	function heftMeta(pageId) {
		if (!pageId) return null;
		if (!_heftMeta.has(pageId)) {
			const json = M.heftMeta(String(pageId));
			_heftMeta.set(pageId, json ? Object.freeze(JSON.parse(json)) : null);
		}
		return _heftMeta.get(pageId);
	}
	// Heft samt noch nicht gespeicherter Operationen, ohne etwas zu ändern (Heft-Editor bei Fremdänderungen).
	const heftPreview = (pageId, ops) => { const json = M.heftPreview(String(pageId), JSON.stringify(ops || [])); return json ? JSON.parse(json) : null; };

	// ---- Checkpoint -------------------------------------------------------------------------
	async function persistCheckpoint() {
		const finishProfile = PERF_PROFILER.start("state.checkpoint-save", {}, 20);
		try {
			const revision = _stateRevision;
			const current = await PERF_PROFILER.run("state.checkpoint-save-info", () => DB.eventLogInfo(), {}, 5);
			const base = M.baseSeq();
			const after = current.maxSeq > base
				? await PERF_PROFILER.run("state.checkpoint-save-tail", () => DB.eventsAfterSeqAll(base, current.maxSeq), { fromSeq: base, toSeq: current.maxSeq }, 5)
				: [];
			const parts = await DB.stateCheckpointPartHashes();
			// Der Checkpoint muss genau zu current.maxSeq passen: Kam inzwischen ein Event dazu, später erneut.
			if (revision !== _stateRevision) { finishProfile({ stale: true }); return false; }
			const res = PERF_PROFILER.measure("state.checkpoint-build", () => JSON.parse(M.checkpointSave(JSON.stringify({
				info: current,
				after: after.map((event) => ({ id: event?.id, seq: event?.seq })),
				blobHashes: parts.blobs,
				heftHashes: parts.hefte,
			}))), { eventCount: current.count }, 5);
			if (res.status === "written") {
				try {
					await PERF_PROFILER.run("state.checkpoint-write", () => DB.putStateCheckpoint(res.checkpoint, res.blobs, res.hefte), {
						eventCount: current.count, newHeftBlobs: Object.keys(res.blobs).length, newHefte: Object.keys(res.hefte).length,
					}, 5);
				} catch (error) {
					M.checkpointNotWritten(JSON.stringify(Object.keys(res.blobs)));
					throw error;
				}
			}
			finishProfile({ eventCount: current.count, status: res.status });
			// Speicher weicht vom sortierten Replay ab ("out-of-order"): alten Checkpoint behalten und
			// nicht erneut versuchen, bis der nächste Start wieder sortiert einspielt.
			return res.status !== "stale";
		} catch (error) {
			finishProfile({ failed: true, errorName: error?.name || "Error", errorMessage: error?.message || String(error) });
			console.warn("[state] Start-Checkpoint konnte nicht gespeichert werden:", error);
			return false;
		}
	}
	const checkpointScheduler = createCheckpointScheduler(() => persistCheckpoint(), {
		// Tippen-First: Erst nach 10s echter Ruhe plus Idle speichern. Der Checkpoint ist nur
		// Cache — das Event-Log ist die Wahrheit — also lieber später speichern als ruckeln.
		quietMs: 10000,
		onError: (error) => console.warn("[state] Start-Checkpoint fehlgeschlagen:", error),
	});
	const scheduleCheckpoint = () => checkpointScheduler.schedule();

	// ---- Migration --------------------------------------------------------------------------
	// Alte localStorage-Ablage der Zugangsdaten einmalig ins Log übernehmen.
	async function migrateLegacySecretsToSync() {
		let current = null, older = null;
		try { current = localStorage.getItem("impala67.secrets"); older = localStorage.getItem("notion.secrets"); } catch { return; }
		const patch = M.legacySecretsPatch(current ?? undefined, older ?? undefined);
		if (!patch) return;
		await dispatch("settingsSet", JSON.parse(patch));
		localStorage.removeItem("impala67.secrets");
		localStorage.removeItem("notion.secrets");
	}

	// ---- Abfragen ---------------------------------------------------------------------------
	const pagesOf = (list) => list.map(page).filter(Boolean);
	const cardsOf = (list) => list.map(card).filter(Boolean);
	const childPagesOf = (id) => pagesOf(pageMemo("childPages|" + (id || ""), () => ids(M.childPagesOf(id || undefined))));
	const childrenOf = (id, wsId) => pagesOf(pageMemo("children|" + (id || "") + "|" + (wsId || "") + "|" + (S.currentWorkspaceId || ""),
		() => ids(M.childrenOf(id || undefined, wsId || undefined, S.currentWorkspaceId || undefined))));
	const pageSubtreeIds = (id) => new Set(ids(M.pageSubtree(String(id))));
	const pageInTree = (pageId, rootId) => M.pageInTree(pageId || undefined, String(rootId));
	const deckInTree = (deck, root) => !!root && CORE.deckInTree(String(deck || ""), String(root));
	const isDeckArchived = (name) => M.isDeckArchived(String(name || ""));
	const isCardArchived = (c) => !!c && M.isCardArchived(String(c.id));
	const isPageArchived = (pgOrId) => {
		const id = typeof pgOrId === "object" ? pgOrId?.id : pgOrId;
		return !!id && M.isPageArchived(String(id));
	};
	const sortKeyOf = (pg) => (pg?.id ? M.sortKeyOf(String(pg.id)) : 0);
	const trashedPages = () => pagesOf(pageMemo("trashed", () => ids(M.trashedPages())));
	const activePages = () => pagesOf(pageMemo("active", () => ids(M.activePages())));
	const archivedPages = () => pagesOf(pageMemo("archived", () => ids(M.archivedPages())));
	const archivedPageRoots = () => pagesOf(pageMemo("archivedRoots", () => ids(M.archivedPageRoots())));
	const activeCards = () => cardsOf(cardMemo("active", () => ids(M.activeCards())));
	const archivedCards = () => cardsOf(cardMemo("archived", () => ids(M.archivedCards())));
	const trashedCards = () => cardsOf(cardMemo("trashed", () => ids(M.trashedCards())));
	const archivedDeckRoots = () => cardMemo("archivedDeckRoots", () => ids(M.archivedDeckRoots())).slice();
	const trashedDeckRoots = () => cardMemo("trashedDeckRoots", () => ids(M.trashedDeckRoots())).slice();
	const orphanArchivedCards = () => cardsOf(cardMemo("orphanArchived", () => ids(M.orphanArchivedCards())));
	const orphanTrashedCards = () => cardsOf(cardMemo("orphanTrashed", () => ids(M.orphanTrashedCards())));
	const deckConfOf = (deck) => cardMemo("deckConf|" + (deck || ""), () => Object.freeze(JSON.parse(M.deckConf(String(deck || "")))));
	const pageTitles = () => activePages().map((pg) => pg.title);
	// Titel → erste nicht gelöschte Seite (Archiv inklusive): [[Wiki-Links]] im Editor.
	const pagesByTitle = () => pageMemo("byTitle", () => new Map(ids(M.pagesByTitle()).map(([title, id]) => [title, page(id)]).filter(([, pg]) => pg)));
	function findPage(title, options = {}) {
		if (!title) return null;
		const id = M.findPage(String(title), options.includeArchived !== false);
		return (id && page(id)) || null;
	}
	const backlinksOf = (pageId) => pagesOf(pageMemo("backlinks|" + pageId, () => ids(M.backlinksOf(String(pageId)))));

	// Seitensuche (impala-search im Kern): exakte Treffer (Titel +10, je Fundstelle +1), aufgefüllt
	// mit Tippfehler-Treffern, archivierte unter den aktiven.
	function searchNotes(query, options = {}) {
		return PERF_PROFILER.measure("search.notes", () => {
			if (!String(query)) return [];
			return JSON.parse(M.searchNotes(String(query), !!options.includeArchived))
				.map((h) => ({ page: page(h.id), score: h.score, terms: h.terms ?? undefined, snippet: h.snippet }))
				.filter((h) => h.page);
		}, { query: String(query).slice(0, 40) }, 15);
	}

	// Lernwarteschlange (impala-model study.rs). Tagesgrenzen in lokaler Zeit rechnet JS, der Kern
	// kennt keine Zeitzone. Gemerkt bis zum nächsten Karten-Event, höchstens 2 s (Fälligkeiten sind
	// zeitabhängig); ein ausdrückliches `now` umgeht den Zwischenspeicher.
	const LEARN_AHEAD_MS = 20 * 60e3;
	const _snapCache = { rev: -1, t: 0, map: new Map() };
	const overlearnLock = () => { try { return localStorage.getItem("impala67Overlearn") !== "off"; } catch { return true; } };
	function computeStudySnapshot(deck, now = new Date()) {
		const t = now instanceof Date ? now : new Date(now);
		const dayStart = new Date(t.getFullYear(), t.getMonth(), t.getDate());
		const eod = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1, 0, 0, 0, 0);
		const s = JSON.parse(M.studySnapshot(deck || undefined, t.getTime(), dayStart.getTime(), eod.getTime(), !!S.ankiMix, overlearnLock()));
		return {
			dueNow: cardsOf(s.dueNow),
			learnDue: cardsOf(s.learnDue),
			learnWaiting: cardsOf(s.learnWaiting),
			learnLaterToday: cardsOf(s.learnLaterToday),
			reviewsDue: cardsOf(s.reviewsDue),
			newDue: cardsOf(s.newDue),
			counts: s.counts,
			nextLearnAt: s.nextLearnAt ? new Date(s.nextLearnAt) : null,
			lockedAhead: s.lockedAhead,
			done: s.done,
			finishedForNow: s.finishedForNow,
			available: s.available,
			now: t,
			endOfDay: eod,
			learnAheadMs: LEARN_AHEAD_MS,
		};
	}
	function studySnapshot(deck, now) {
		if (now !== undefined) return computeStudySnapshot(deck, now);
		const key = (deck || "") + "|" + (S.ankiMix ? 1 : 0) + "|" + (overlearnLock() ? 1 : 0);
		const t = Date.now();
		if (_snapCache.rev !== _cardRev || t - _snapCache.t > 2000) {
			_snapCache.map.clear();
			_snapCache.rev = _cardRev;
			_snapCache.t = t;
		}
		let snap = _snapCache.map.get(key);
		if (!snap) {
			snap = PERF_PROFILER.measure("anki.study-snapshot", () => computeStudySnapshot(deck), { deck: String(deck || "all") }, 15);
			_snapCache.map.set(key, snap);
		}
		return snap;
	}
	// .slice(): Aufrufer dürfen das Ergebnis verändern, ohne den Zwischenspeicher zu beschädigen.
	const dueCards = () => studySnapshot(null).dueNow.slice();

	// Seitenverlauf aus dem Log (append-only, also vollständig). Nur Events dieser Seite gehen in den Kern.
	async function pageHistory(pageId) {
		const events = (await DB.allEvents()).filter((ev) => ev?.payload?.id === pageId);
		return JSON.parse(CORE.pageHistory(JSON.stringify(events), String(pageId)));
	}

	// Konflikt-Prüfung eines Imports (db.js importAll) mit dem aktuellen Zustand.
	const importConflicts = (...args) => M.importConflicts(...args);
	// Konflikt-Dialog: gerettete Alt-Kopien, fehlende Texte ergänzen, Events einer Entscheidung.
	const conflictLegacyItems = (resolvedIds) => JSON.parse(M.conflictLegacyItems(JSON.stringify([...(resolvedIds || [])])));
	const conflictWithTexts = (c) => JSON.parse(M.conflictWithTexts(JSON.stringify(c)));
	const conflictResolve = (c, action) => JSON.parse(M.conflictResolve(JSON.stringify(c), String(action)));

	return {
		onChange: null, dispatch, applyRemoteEvents, applyRemoteEventsCooperative, onBeforeDispatch, onAfterDispatch, onRemoteApplied,
		load, hydrateHeftBlobs, hasHeftBlob, heftBlob, releaseHeftBlobs, heftDoc, heftShadow, heftPage, heftPageById, heftPageIds, heftIds, heftImageRefs, heftIndexSummary, heftMeta, heftPreview,
		scheduleCheckpoint, checkpointNow: persistCheckpoint, loadedSeq: () => M.loadedSeq(), loadedTime: () => M.loadedTime(), cardRevision: () => _cardRev, pageRevision: () => _pageRev,
		migrateLegacySecretsToSync, importConflicts, conflictLegacyItems, conflictWithTexts, conflictResolve, childPagesOf, childrenOf, pageSubtreeIds, pageInTree, deckInTree,
		isDeckArchived, isCardArchived, isPageArchived, sortKeyOf, trashedPages, activePages, archivedPages, archivedPageRoots, activeCards,
		archivedDeckRoots, orphanArchivedCards, trashedDeckRoots, orphanTrashedCards, pageTitles, pagesByTitle, findPage, searchNotes,
		dueCards, studySnapshot, deckConfOf, backlinksOf, pageHistory,
	};
})();

// Breadcrumb-Elternkette (Workspace › Eltern › aktuelle Seite)
export function ancestorsOf(pg) {
	if (!pg?.id) return [];
	return ids(M.ancestorsOf(String(pg.id))).map(page).filter(Boolean);
}

// ★ Modell-Favoriten: "providerId::modelId", bewusst lokal (Quellen-IDs sind gerätespezifisch).
const MODEL_FAV_KEY = "impala67FavModels";
export function favModels() {
	return new Set(U.storage.getJson(MODEL_FAV_KEY, []));
}
export function toggleFavModel(key) {
	const s = favModels();
	s.has(key) ? s.delete(key) : s.add(key);
	U.storage.setJson(MODEL_FAV_KEY, [...s]);
}
export function removeProviderFavorites(providerId) {
	if (!providerId) return;
	const prefix = providerId + "::";
	const remaining = [...favModels()].filter((k) => !k.startsWith(prefix));
	U.storage.setJson(MODEL_FAV_KEY, remaining);
}
