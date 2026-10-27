// Golden-Files für impala-model aus der echten PWA-Logik (web/state.js, web/event-order.js,
// web/db.js merge3/Import-Konflikte, web/conflict-ui.js).
//
// Lade-, Checkpoint- und Import-Fälle brauchen IndexedDB; dafür fake-indexeddb (nicht in
// package.json, einmalig in ein beliebiges Verzeichnis installieren):
//   npm i --prefix <tmp> fake-indexeddb@6
//   FAKE_INDEXEDDB=<tmp>/node_modules/fake-indexeddb node core/tools/gen-golden-model.mjs
// Jeder IndexedDB-Fall läuft in einem eigenen Kindprozess (die App kennt nur EINE Datenbank).
// Festgenagelt: Zeitzone Europe/Berlin, Date.now (2030-01-01), Zufalls-IDs gibt es im Reducer nicht.
//
// Ausgabe: core/impala-model/tests/golden/{replay,load,import,merge,queries,conflict-ui}.json
// Zustände stehen als Digest (SHA-256 über kanonisches JSON, 16 Hex) nach jedem Schritt drin,
// ausgewählte Endzustände vollständig. DUMP=<dir> schreibt zusätzlich alle Zustände voll heraus.
process.env.TZ = "Europe/Berlin";
import { spawnSync } from "node:child_process";
import { createHash, webcrypto } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { modelEvents } from "./sample-model.mjs";
import { rng } from "./sample-log.mjs";

const self = fileURLToPath(import.meta.url);
const root = resolve(dirname(self), "../..");
const web = (file) => pathToFileURL(join(root, "web", file)).href;
const FIXED_NOW = Date.UTC(2030, 0, 1);
Date.now = () => FIXED_NOW;
if (typeof window === "undefined") {
	globalThis.window = globalThis;
	globalThis.location = { href: "http://localhost/" };
}
globalThis.localStorage = new JSDOM("", { url: "http://localhost/" }).window.localStorage;
if (!globalThis.crypto) globalThis.crypto = webcrypto;
console.warn = () => {}; // Reducer-Warnungen bei absichtlich kaputten Events

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const canon = (v) => {
	if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
	if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
	return JSON.stringify(v);
};
const digest = (v) => createHash("sha256").update(canon(clone(v))).digest("hex").slice(0, 16);
let freshCount = 0;
const freshState = async () => import(web("state.js") + "?fresh=" + ++freshCount);
const CP = await import(web("state-checkpoint.js"));
const ORDER = await import(web("event-order.js"));
const persisted = (S) => clone(CP.checkpointStateOf(S));

// ---- Kindprozess: ein IndexedDB-Fall ----------------------------------------------------------
if (process.argv[2] === "--child") {
	const fakeDir = process.env.FAKE_INDEXEDDB;
	const fake = await import(pathToFileURL(join(fakeDir, "build/esm/index.js")).href);
	globalThis.indexedDB = new fake.IDBFactory();
	globalThis.IDBKeyRange = fake.IDBKeyRange;
	// Checkpoint-Planer: ohne Wartezeit (Ruhephase 10 s) speichern.
	const realSetTimeout = setTimeout;
	globalThis.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, ms > 1000 ? 0 : ms, ...a);
	const spec = JSON.parse(readFileSync(process.argv[3], "utf8"));
	const { DB } = await import(web("db.js"));
	await DB.open();
	const out = await (spec.kind === "load" ? childLoad(spec, DB) : childImport(spec, DB));
	writeFileSync(process.argv[4], JSON.stringify(out));
	process.exit(0);
}

async function addAll(DB, list) { for (const e of list) await DB.addEvent(e); }

async function waitCheckpoint(DB, STATE, before) {
	STATE.scheduleCheckpoint();
	for (let i = 0; i < 200; i++) {
		await new Promise((r) => setImmediate(r));
		const cp = await DB.getStateCheckpoint();
		if (cp && cp !== before && JSON.stringify(cp?.maxSeq) !== JSON.stringify(before?.maxSeq)) return cp;
	}
	return (await DB.getStateCheckpoint()) || null;
}

async function dumpBlobs(DB) {
	const out = {};
	for (const key of await DB.allBlobKeys()) {
		if (!DB.isStateCheckpointKey(key)) continue;
		const rec = await DB.getBlob(key);
		out[key] = rec && typeof rec.data === "string" ? rec.data : rec;
	}
	return out;
}

// Laden: Log A → Start (Voll-Replay) → Checkpoint (echter persistCheckpoint) → Log B → Start.
async function childLoad(spec, DB) {
	const { STATE, S } = await import(web("state.js"));
	await addAll(DB, clone(spec.first));
	const r1 = await STATE.load();
	let cp = await waitCheckpoint(DB, STATE, null);
	if (spec.mutateCheckpoint && cp) {
		cp = clone(cp);
		const m = spec.mutateCheckpoint;
		if (m.dropOrderTimes) delete cp.orderTimes;
		if (m.dropArticles) delete cp.state.homeArticles;
		if (m.unreconciled) delete cp.reconciledArchive;
		if (m.groqName) cp.state.settings.aiProviders[0].name = "Cloudflare (Groq)";
		if (m.dropCreated) for (const id of m.dropCreated) if (cp.state.pages[id]) delete cp.state.pages[id].created;
		await DB.putStateCheckpoint(cp, {}, {});
	}
	if (spec.legacyCheckpoint && cp) {
		// Format 1: alles in einem Objekt, im alten Schlüssel.
		const legacy = { format: 1, maxSeq: cp.maxSeq, eventCount: cp.eventCount, lastEventId: cp.lastEventId, maxTime: cp.maxTime, state: persisted(S), ...(cp.orderTimes ? { orderTimes: cp.orderTimes } : {}), reconciledArchive: true };
		await DB.clearStateCheckpoint();
		const db = await new Promise((res) => { const q = indexedDB.open("impala67"); q.onsuccess = () => res(q.result); });
		await new Promise((res) => { const t = db.transaction("blobs", "readwrite"); t.objectStore("blobs").put(legacy, "__impala67_state_checkpoint_v1__"); t.oncomplete = res; });
		db.close();
	}
	const checkpointRecords = await dumpBlobs(DB);
	await addAll(DB, clone(spec.second));
	const stored = await DB.getStateCheckpoint();
	const info = await DB.eventLogInfo();
	const reason = CP.stateCheckpointRejectReason(stored, info, stored?.maxSeq ? await DB.eventAtSeq(stored.maxSeq) : null, await DB.eventsAfterSeqAll(stored?.maxSeq || 0, info.maxSeq));
	const r2 = await STATE.load();
	const afterLoad = persisted(S);
	// Danach verspätete Fremd-Events live: wird noch ein Checkpoint gespeichert?
	const before = await DB.getStateCheckpoint();
	let liveSaved = null, afterLive = null;
	if (spec.live?.length) {
		await addAll(DB, clone(spec.live));
		STATE.applyRemoteEvents(clone(spec.live));
		afterLive = persisted(S);
		const after = await waitCheckpoint(DB, STATE, before);
		liveSaved = !!after && after.maxSeq !== before?.maxSeq;
	}
	const log = await DB.allEvents();
	return { first: r1, checkpointRecords, report: { ...r2, reason }, state: afterLoad, afterLive, liveSaved, log };
}

// Import: lokales Log (teils schon gesynct) + fremdes Paket → Konflikte und abgeleitete Events.
async function childImport(spec, DB) {
	const { STATE, S } = await import(web("state.js"));
	await addAll(DB, clone(spec.local));
	for (const ev of spec.localRemote || []) await DB.addEvent({ ...clone(ev), _remote: true, _remoteSource: "cloudflare" });
	await STATE.load();
	const local = await DB.allEvents();
	const opts = { remote: true, remoteSource: "cloudflare", unsyncedAfterSeq: spec.unsyncedAfterSeq, pageInfo: (id) => S.pages[id] };
	if (spec.partialLocal) opts.localEvents = local.filter((ev) => ev.seq > spec.unsyncedAfterSeq);
	const res = await DB.importAll({ app: "impala67", events: clone(spec.remote) }, opts);
	return {
		local,
		conflicts: res.conflictDetails, merged: res.mergedDetails,
		derived: res.importedEvents.filter((ev) => ev._derived).map((ev) => { const { seq, ...rest } = ev; return rest; }),
		fresh: res.importedEvents.filter((ev) => !ev._derived).map((ev) => ev.id),
	};
}

function runChild(spec) {
	const dir = process.env.DUMP || join(root, "core/target/tmp");
	mkdirSync(dir, { recursive: true });
	const inFile = join(dir, "model-child-in.json"), outFile = join(dir, "model-child-out.json");
	writeFileSync(inFile, JSON.stringify(spec));
	const res = spawnSync(process.execPath, [self, "--child", inFile, outFile], { stdio: ["ignore", "inherit", "inherit"], env: process.env });
	if (res.status !== 0) throw new Error("Kindprozess fehlgeschlagen: " + spec.name);
	return JSON.parse(readFileSync(outFile, "utf8"));
}

// ---- Replay: Zufallsfolgen ----------------------------------------------------------------------
const out = join(root, "core/impala-model/tests/golden");
mkdirSync(out, { recursive: true });
const write = (name, data) => writeFileSync(join(out, name), JSON.stringify(data) + "\n");
const dump = (name, data) => { if (process.env.DUMP) writeFileSync(join(process.env.DUMP, name), JSON.stringify(data, null, 1)); };
const sortEvents = (events) => events.slice().sort((a, b) => (String(a?.t || "") < String(b?.t || "") ? -1 : String(a?.t || "") > String(b?.t || "") ? 1 : 0) || (a?.seq || 0) - (b?.seq || 0));

// Laufzeit-Regel aus reduce(): ab wann weicht der Speicher vom sortierten Replay ab?
function orderedFlags(events) {
	const times = new Map();
	let loaded = "", ordered = true;
	return events.map((ev) => {
		const t = String(ev.t || "");
		if (t < loaded && !ORDER.reorderSafe(ev, times)) ordered = false;
		ORDER.noteEventOrder(times, ev);
		if (t > loaded) loaded = t;
		return ordered;
	});
}

const replay = [];
const finalStates = {};
const REPLAY = [[1, 250], [2, 250], [3, 300], [4, 200], [5, 300], [6, 150, { late: 0.15 }], [7, 200, { pages: 5, cards: 4 }], [8, 300]];
const replayEvents = {};
for (const [seed, n, opts] of REPLAY) {
	const events = modelEvents(seed, n, opts);
	replayEvents[seed] = events;
	const live = await freshState();
	const steps = [];
	for (const ev of events) {
		live.STATE.applyRemoteEvents([clone(ev)]);
		steps.push(digest(CP.checkpointStateOf(live.S)));
	}
	const sorted = await freshState();
	for (const ev of sortEvents(events)) sorted.STATE.reduce(clone(ev));
	const sortedState = persisted(sorted.S);
	const flags = orderedFlags(events);
	// Gegenprobe der Regel: solange geordnet, gleicht der Laufzeit-Zustand dem sortierten Replay.
	if (flags.at(-1) && steps.at(-1) !== digest(sortedState)) throw new Error("Regel verletzt: Seed " + seed);
	finalStates[seed] = { live: live.S, sorted: sorted.S, STATE: sorted.STATE, mod: sorted };
	dump("replay-" + seed + ".json", { live: persisted(live.S), sorted: sortedState });
	replay.push({
		seed, events, steps, ordered: flags.map((f) => (f ? 1 : 0)).join(""),
		sorted: digest(sortedState),
		...(seed <= 2 ? { sortedState } : {}),
	});
}

// Belastungsprobe (nicht im Repo): STRESS=<datei> schreibt viele weitere Folgen für den
// ignorierten Test `belastung` (cargo test -p impala-model -- --ignored, STRESS=<datei>).
if (process.env.STRESS) {
	const stress = [];
	for (let seed = 100; seed < 100 + Number(process.env.STRESS_SEEDS || 40); seed++) {
		const opts = { late: [0.05, 0.2, 0][seed % 3], pages: [14, 5, 30][seed % 3], cards: [12, 4, 20][seed % 3] };
		const events = modelEvents(seed, 400, opts);
		const live = await freshState();
		const steps = [];
		for (const ev of events) { live.STATE.applyRemoteEvents([clone(ev)]); steps.push(digest(CP.checkpointStateOf(live.S))); }
		const sorted = await freshState();
		for (const ev of sortEvents(events)) sorted.STATE.reduce(clone(ev));
		stress.push({ seed, events, steps, ordered: orderedFlags(events).map((f) => (f ? 1 : 0)).join(""), sorted: digest(persisted(sorted.S)) });
	}
	writeFileSync(process.env.STRESS, JSON.stringify({ random: stress }));
}

// Handverlesene Grenzfälle mit vollem Zustand nach jedem Schritt.
const T = (i) => new Date(Date.UTC(2026, 3, 1, 9) + i * 60_000).toISOString();
let k = 0;
const ev = (type, payload, t) => ({ id: "h" + ++k, t: t || T(k), type, payload, seq: k });
const hand = [
	ev("pageCreate", { id: "a", title: "A" }), ev("pageCreate", { id: "b", parentId: "a", title: "B" }),
	ev("pageCreate", { id: "c", parentId: "b", title: "C", kind: "heft" }),
	ev("pageMove", { id: "a", parentId: "c" }), // Zyklus: abgelehnt
	ev("pageUpdate", { id: "a", patch: { parentId: "c" } }), // Zyklus per Patch: erlaubt (wie JS)
	ev("pageTrash", { id: "b" }), ev("pageRestore", { id: "a" }), ev("pageArchive", { id: "b" }), ev("pageUnarchive", { id: "c" }),
	ev("uiTabsSet", { tabs: ["a", "b", "c", "a", "chat:x", "nlm:main", "anki:main", "zz"], activeTabId: "c" }),
	ev("pageDelete", { id: "c" }), ev("pageDelete", {}),
	ev("cardCreate", { id: "k1", front: "F", back: "B", deck: "X::Y" }), ev("cardCreate", { id: "k2", deck: "X" }),
	ev("deckRename", { from: "X", to: "X::Y" }), ev("deckRename", { from: "X::Y", to: "X::Y" }), ev("deckRename", { from: "X::Y::Y", to: undefined }),
	ev("deckDuplicate", { name: "undefined::Y" }), ev("deckMove", { from: "undefined", target: "Z" }), ev("deckTrash", { name: "Z" }),
	ev("cardCreate", { id: "k3", deck: "Z::undefined" }), ev("deckArchive", { name: "Z" }), ev("deckDelete", { name: "Z" }),
	ev("settingsSet", { aiProviders: [{ id: "openai", key: "sk-a" }] }), ev("settingsSet", { aiProviders: [{ id: "openai", key: "" }, { id: "neu" }] }),
	ev("settingsSet", { aiProviders: [{ id: "openai", key: null }] }), ev("settingsSet", { aiProviders: [{ id: "x" }, null] }),
	ev("settingsSet", { deckConf: { "*": { leechThreshold: 1 } } }),
	ev("cardCreate", { id: "k4", srs: { state: "review", due: T(0), lapses: 1 } }),
	ev("cardReview", { id: "k4", grade: 1, srs: { state: "relearning", due: T(40), lapses: 2 }, reviewId: "r1" }),
	ev("cardReviewUndo", { id: "k4", srs: { state: "review", due: T(0), lapses: 0 }, unsuspend: true, reviewId: "r1" }),
	ev("cardUpdate", { id: "k4", patch: { srs: null } }), ev("cardReview", { id: "k4", grade: 3, srs: { state: "review" } }),
	ev("gnFolderCreate", { id: "f1" }), ev("gnFolderCreate", { id: "f2", parentId: "f1" }), ev("gnFolderMove", { id: "f1", parentId: "f2" }),
	ev("pageCreate", { id: "h", kind: "heft", gnFolderId: "f2" }), ev("gnItemMove", { id: "h", folderId: "f2", order: 3 }),
	ev("gnFolderDelete", { id: "f2" }),
	ev("heftOps", { pageId: "h", ops: [{ t: "pg+", page: { id: "q" } }, { t: "s+", p: "q", o: { id: "s", pts: [[1, 2, 0.5]] } }, null] }),
	ev("heftBlob", { hash: "H", data: "data:x" }), ev("heftBlob", { hash: "H", data: "data:yy" }),
	ev("heftSnap", { pageId: "h", doc: { pages: [{ id: "q", strokes: [], images: [{ id: "i", ref: "H" }] }] } }),
	ev("chatUpsert", { id: "c1", messages: [], updated: T(100) }), ev("chatDelete", { id: "c1" }), ev("chatUpsert", { id: "c1", messages: [1] }),
	ev("uiTabsSet", { tabs: ["chat:c1", "chat:null", "h"] }),
	ev("homeArticleUpsert", { id: "x", body: "B", created: T(200) }), ev("homeArticleUpsert", { id: "x", body: "alt", updated: T(1) }),
	ev("learningSessionUpsert", { id: "l", durationSeconds: "12.5", subject: " M " }), ev("learningSessionUpsert", { id: "l", durationSeconds: 3 }),
	ev("learningSessionDelete", { id: "l", updated: T(0) }), ev("learningSessionDelete", { id: "neu" }),
	ev("gradeAdd", { id: "g", subject: " Mathe ", grade: "2,5" }), ev("gradeAdd", { id: "g", subject: " Mathe ", grade: "2.5", weight: "0" }), ev("gradeDelete", { id: "g" }),
	ev("teleEvent", { kind: { a: 1 } }), ev("uiTreeSet", { key: "ws:x", open: false }), ev("uiTreeSet", { key: "p", open: 1 }), ev("uiTreeSet", { key: "p" }),
	ev("workspaceCreate", { id: "w" }), ev("deckReorder", { name: "Neu", order: 2 }),
	ev("futureEvent", { id: "a", anything: [1, 2] }), { id: "bad", t: T(500), type: 5, payload: {}, seq: ++k },
];
const handState = await freshState();
const handSteps = [];
for (const e of hand) {
	handState.STATE.reduce(clone(e));
	handSteps.push(digest(CP.checkpointStateOf(handState.S)));
}
dump("hand.json", persisted(handState.S));
write("replay.json", { random: replay, hand: { events: hand, steps: handSteps, final: persisted(handState.S) } });

// ---- Abfragen und Lernwarteschlange auf den Endzuständen ---------------------------------------
const queries = [];
for (const [seed] of REPLAY) {
	const { sorted: S, STATE } = finalStates[seed];
	const ids = (list) => list.map((p) => p.id);
	const pageIds = Object.keys(S.pages);
	const q = {
		seed,
		activePages: ids(STATE.activePages()), trashedPages: ids(STATE.trashedPages()), archivedPages: ids(STATE.archivedPages()),
		archivedPageRoots: ids(STATE.archivedPageRoots()), activeCards: ids(STATE.activeCards()),
		archivedDeckRoots: STATE.archivedDeckRoots(), trashedDeckRoots: STATE.trashedDeckRoots(),
		orphanArchivedCards: ids(STATE.orphanArchivedCards()), orphanTrashedCards: ids(STATE.orphanTrashedCards()),
		pageTitles: STATE.pageTitles(),
		pagesByTitle: Object.fromEntries([...STATE.pagesByTitle()].map(([t, p]) => [t, p.id])),
		children: [null, ...pageIds].flatMap((id) => [null, "ws1"].map((ws) => ({ id, ws, kids: ids(STATE.childrenOf(id, ws)) }))),
		childPages: [null, ...pageIds].map((id) => ({ id, kids: ids(STATE.childPagesOf(id)) })),
		subtree: pageIds.map((id) => ({ id, ids: [...STATE.pageSubtreeIds(id)].sort() })),
		archived: pageIds.map((id) => STATE.isPageArchived(id)),
		find: ["Mathe", "mathe", "an", "Blatt 3", "zz", "ohne"].map((t) => [t, STATE.findPage(t)?.id ?? null, STATE.findPage(t, { includeArchived: false })?.id ?? null]),
		backlinks: pageIds.map((id) => ({ id, ids: ids(STATE.backlinksOf(id)) })),
		// Erst alle aktiven Seiten in Seitenreihenfolge in den Tippfehler-Index (siehe Bericht:
		// sonst hängt die Reihenfolge gleich bewerteter Treffer von früheren Suchen ab).
		warm: STATE.searchNotes("qqqq").length,
		search: ["mathe", "zeile 3", "analysys", "zellen", "x"].map((t) => ({ q: t, hits: STATE.searchNotes(t).map((h) => [h.page.id, h.score, h.snippet]) })),
		deckConf: ["Mathe::Analysis::Folgen", "Physik", "", "Mathe"].map((d) => STATE.deckConfOf(d)),
		study: [],
	};
	const { ancestorsOf } = finalStates[seed].mod;
	q.ancestors = pageIds.map((id) => ({ id, ids: ids(ancestorsOf(S.pages[id])) }));
	for (const [deck, nowIso, mix, lock] of [[null, "2026-03-02T10:00:00.000Z", false, true], ["Mathe", "2026-03-03T22:30:00.000Z", false, true], [null, "2026-03-04T23:30:00.000Z", true, false], ["Physik", "2026-03-01T06:00:00.000Z", true, true], [null, "2026-02-27T12:00:00.000Z", false, true]]) {
		S.ankiMix = mix;
		localStorage.setItem("impala67Overlearn", lock ? "" : "off");
		const t = new Date(nowIso);
		const snap = STATE.studySnapshot(deck, t);
		const dayStart = new Date(t.getFullYear(), t.getMonth(), t.getDate()).toISOString();
		const sid = (l) => l.map((c) => c.id);
		q.study.push({
			deck, now: nowIso, mix, lock, dayStart, dayEnd: snap.endOfDay.toISOString(),
			dueNow: sid(snap.dueNow), learnDue: sid(snap.learnDue), learnWaiting: sid(snap.learnWaiting), learnLaterToday: sid(snap.learnLaterToday),
			reviewsDue: sid(snap.reviewsDue), newDue: sid(snap.newDue), counts: snap.counts,
			nextLearnAt: snap.nextLearnAt ? snap.nextLearnAt.toISOString() : null, lockedAhead: snap.lockedAhead,
			done: snap.done, finishedForNow: snap.finishedForNow, available: snap.available,
		});
	}
	S.ankiMix = false;
	localStorage.removeItem("impala67Overlearn");
	queries.push(q);
}
write("queries.json", queries);

// ---- merge3 ------------------------------------------------------------------------------------
const { DB } = await import(web("db.js"));
const merges = [];
const mr = rng(77);
const lines = ["# Titel", "Absatz eins", "Absatz zwei", "", "- Punkt", "- Punkt", "Ende", "  ", "Mitte", "Formel x²"];
const doc = (n) => Array.from({ length: n }, () => lines[Math.floor(mr() * lines.length)]).join("\n");
const edit = (text) => {
	const L = text.split("\n");
	for (let i = 0, m = 1 + Math.floor(mr() * 3); i < m; i++) {
		const at = Math.floor(mr() * (L.length + 1)), roll = mr();
		if (roll < 0.4) L.splice(at, 0, "Neu " + Math.floor(mr() * 9));
		else if (roll < 0.7) L.splice(at, 1);
		else L[Math.min(at, L.length - 1)] = "Geändert " + Math.floor(mr() * 9);
	}
	return L.join("\n");
};
for (let i = 0; i < 160; i++) {
	const base = i % 17 === 0 ? "" : doc(2 + Math.floor(mr() * 14));
	const mine = mr() < 0.1 ? base : edit(base), theirs = mr() < 0.1 ? base : mr() < 0.05 ? mine : edit(base);
	merges.push([base, mine, theirs, DB.merge3(base, mine, theirs)]);
}
const big = Array.from({ length: 1300 }, (_, i) => "Zeile " + i).join("\n");
for (const [b, m, t] of [[big, big + "\nx", "y\n" + big], ["a\nb", "a\nb\nc", "z\na\nb"], ["a\n\nb", "a\n\nX\nb", "a\nY\n\nb"], [" ", "x", "y"], ["a\nb\nc", "a\nc", "a\nb"]]) merges.push([b, m, t, DB.merge3(b, m, t)]);
write("merge.json", merges);

// ---- Konflikt-Dialog (reine Logik) -------------------------------------------------------------
const CUI = await import(web("conflict-ui.js"));
const titlesCases = ["⚠ Konflikt: Mathe — Stand 2026-03-01 10:00", "⚠ Konflikt (gelöscht/verschoben): ⚠ Konflikt: A", "⚠ Konflikt:", "Normal", "A — Stand x\ny", "⚠ Konflikt (gelöscht/verschoben) B", "", "⚠ Konflikt:  \tX — Stand 1 — Stand 2"];
const cuiPages = [
	{ id: "o1", title: "Mathe", content: "a\nb\nc", parentId: null, updated: T(5) },
	{ id: "o2", title: "Mathe", content: "a", parentId: "p", updated: T(9) },
	{ id: "o3", title: "Umbenannt", content: "x\ny\n z ", updated: T(3) },
	{ id: "k1", title: "⚠ Konflikt: Mathe — Stand 2026-03-01 10:00", content: "a\nb\nneu", parentId: null, updated: T(7) },
	{ id: "k2", title: "⚠ Konflikt: ⚠ Konflikt: Mathe", content: "a", updated: T(8) },
	{ id: "k3", title: "⚠ Konflikt: Weg", content: "x\nz", updated: T(2) },
	{ id: "k4", title: "⚠ Konflikt: Leer", content: "", parentId: "p", updated: T(1) },
];
const conflicts = [
	{ conflictType: "delete-change", title: "T", conflictPageId: "k1" },
	{ winner: "remote", localContent: "a", remoteContent: "b" }, { winner: "local" }, { legacy: true, nested: true },
	{ legacy: true, pageId: "o1", extraLines: 0 }, { legacy: true, pageId: "o1", extraLines: 2 }, { legacy: true, pageId: null, extraLines: 0 },
];
const diffs = [["a\nb\nc", "a\nx\nc"], ["", "a\nb"], ["a\nb", ""], ["same", "same"], [Array.from({ length: 30 }, (_, i) => "L" + i).join("\n"), Array.from({ length: 30 }, (_, i) => (i === 15 ? "X" : "L" + i)).join("\n")], [Array.from({ length: 450 }, (_, i) => "a" + i).join("\n"), Array.from({ length: 450 }, (_, i) => "b" + i).join("\n")], ["x\ny\nz\nw", "y\nx\nw\nz\nq"]];
write("conflict-ui.json", {
	titles: titlesCases.map((t) => [t, CUI.conflictTitle({ title: t })]),
	legacy: cuiPages.filter((p) => p.title.startsWith("⚠")).map((p) => ({ id: p.id, info: (({ title, nested, original, extraLines }) => ({ title, nested, original: original?.id ?? null, extraLines }))(CUI.legacyCopyInfo(p, cuiPages)) })),
	pages: cuiPages,
	actions: conflicts.map((c) => ({ c, actions: CUI.conflictActions(c).map((a) => [a.action, !!a.recommended]), recommended: CUI.recommendedAction(c), time: CUI.conflictTime({ ...c, localTime: c.localContent ? T(1) : undefined, loserTime: T(2) }) })),
	diffs: diffs.map(([a, b]) => { const d = CUI.conflictDiff(a, b); return { a, b, diff: d, rows: d ? CUI.alignDiffRows(d) : null }; }),
});

// ---- IndexedDB-Fälle (Kindprozesse) ------------------------------------------------------------
if (!process.env.FAKE_INDEXEDDB) {
	console.error("FAKE_INDEXEDDB fehlt: Lade- und Import-Fälle übersprungen (siehe Kopf der Datei).");
	process.exit(0);
}
const loads = [];
// Die Logs stammen aus den Replay-Folgen (Seed, Schnitt): nichts doppelt in den Golden-Files.
const loadCase = (name, seed, cut, opts = {}) => {
	const events = replayEvents[seed];
	const first = events.slice(0, cut);
	// Rest: auf Wunsch um 5 Tage zurückdatiert (verspätete Fremd-Events, älter als der Checkpoint).
	const firstMax = first.reduce((m, e) => (e.t > m ? e.t : m), "");
	const second = events.slice(cut).map((e, i) => {
		if (opts.lateSecond) return { ...e, t: new Date(Date.parse(e.t) - 5 * 86_400_000).toISOString() };
		// onTime: kein Event im Rest ist älter als der Checkpoint (Checkpoint bleibt nutzbar).
		if (opts.onTime && e.t < firstMax) return { ...e, t: new Date(Date.parse(firstMax) + i + 1).toISOString() };
		return e;
	});
	let live = [];
	if (opts.live === "safe") {
		// Älter als alles Angewandte, aber nach dem letzten „wirkt auf vieles“-Event: darf angehängt werden.
		const all = [...first, ...second];
		const maxT = Date.parse(all.reduce((m, e) => (e.t > m ? e.t : m), ""));
		const lastAll = Date.parse(all.filter((e) => ORDER.orderKeysOf(e) === null).reduce((m, e) => (e.t > m ? e.t : m), "1970-01-01T00:00:00.000Z"));
		const t = new Date(lastAll < maxT - 2 ? Math.floor((lastAll + maxT) / 2) : maxT).toISOString();
		live = [
			{ id: "live-safe-1", t, type: "heftBlob", payload: { hash: "hz", data: "data:image/png;base64,ZZ" }, seq: events.length + 1 },
			{ id: "live-safe-2", t, type: "pageUpdate", payload: { id: "pz", patch: { content: "x" } }, seq: events.length + 2 },
		];
	} else if (opts.live) {
		live = modelEvents(seed + 100, opts.live, { offsetMs: -3 * 86_400_000, stepMs: 60_000, late: 0 }).map((e, i) => ({ ...e, id: "live" + seed + "-" + i, seq: events.length + i + 1 }));
	}
	const res = runChild({ kind: "load", name, first, second, live, mutateCheckpoint: opts.mutate, legacyCheckpoint: opts.legacy });
	if (res.log.length !== events.length + live.length) throw new Error("Log unvollständig: " + name);
	loads.push({
		name, seed, cut, lateSecond: !!opts.lateSecond, onTime: !!opts.onTime, live,
		checkpointRecords: res.checkpointRecords, report: res.report, state: digest(res.state),
		...(opts.full ? { stateFull: res.state } : {}), afterLive: res.afterLive ? digest(res.afterLive) : null, liveSaved: res.liveSaved,
	});
	dump("load-" + name + ".json", res);
};
loadCase("tail", 1, 170, { full: true, onTime: true });
loadCase("random-tail", 1, 200, {});
loadCase("late-tail", 2, 180, { lateSecond: true });
loadCase("no-order-times", 3, 220, { mutate: { dropOrderTimes: true }, lateSecond: true });
loadCase("old-checkpoint", 4, 150, { mutate: { unreconciled: true, groqName: true, dropCreated: ["p1", "p2", "p3"] }, full: true, onTime: true });
loadCase("legacy-format", 5, 200, { legacy: true, onTime: true });
loadCase("live-late", 8, 280, { live: 25, onTime: true });
loadCase("live-late-safe", 7, 200, { live: "safe" });
loadCase("empty-tail", 6, 150, {});
write("load.json", loads);

const imports = [];
const importCase = (name, spec) => {
	const res = runChild({ kind: "import", name, ...spec });
	imports.push({ name, unsyncedAfterSeq: spec.unsyncedAfterSeq, partialLocal: !!spec.partialLocal, remote: spec.remote, ...res });
};
const I = (i) => new Date(Date.UTC(2026, 4, 1, 8) + i * 60_000).toISOString();
let s = 0;
const e = (id, t, type, payload) => ({ id, t: I(t), type, payload, seq: ++s });
const base = [
	e("b1", 1, "pageCreate", { id: "P", title: "Plan", content: "Kopf\nA\nB\nC\nFuß" }), e("b2", 2, "pageCreate", { id: "Q", title: "Quelle", content: "x" }),
	e("b3", 3, "pageCreate", { id: "R", title: "Rest", content: "eins\nzwei" }), e("b4", 4, "pageCreate", { id: "D", title: "Del", parentId: "P", content: "weg" }),
	e("b5", 5, "pageCreate", { id: "M", title: "Move", content: "m" }), e("b6", 6, "pageCreate", { id: "E", title: "Leer" }),
];
const localOnly = [
	e("l1", 10, "pageUpdate", { id: "P", patch: { content: "Kopf\nA lokal\nB\nC\nFuß" } }),
	e("l2", 11, "pageUpdate", { id: "R", patch: { content: "eins\nZWEI lokal" } }),
	e("l3", 12, "pageDelete", { id: "D" }), e("l4", 13, "pageUpdate", { id: "M", patch: { title: "Move2" } }),
	e("l5", 14, "pageUpdate", { id: "E", patch: { content: "hier" } }), e("l6", 15, "pageTrash", { id: "Q" }),
];
s = 100;
const remote = [
	e("r1", 20, "pageUpdate", { id: "P", patch: { content: "Kopf\nA\nB\nC fremd\nFuß" } }),
	e("r2", 9, "pageUpdate", { id: "R", patch: { content: "eins\nzwei fremd" } }),
	e("r3", 21, "pageMove", { id: "D", parentId: null }), e("r4", 22, "pageDelete", { id: "M" }),
	e("r5", 14, "pageUpdate", { id: "E", patch: { content: "dort" } }), e("r6", 23, "pageDelete", { id: "Q" }),
	e("b2", 2, "pageCreate", { id: "Q", title: "Dublette" }),
];
importCase("basis", { local: [...base, ...localOnly], unsyncedAfterSeq: 6, remote });
importCase("basis-partial", { local: [...base, ...localOnly], unsyncedAfterSeq: 6, remote, partialLocal: true });
importCase("schon-geloest", { local: [...base, ...localOnly, { id: "merge3-l1-r1", t: I(30), type: "pageUpdate", _derived: true, payload: { id: "P", patch: { content: "Kopf\nA lokal\nB\nC fremd\nFuß" } }, seq: 13 }, { id: "conflict-r2", t: I(31), type: "pageCreate", _derived: true, payload: { id: "conflictpg-r2", title: "x" }, seq: 14 }], unsyncedAfterSeq: 6, remote });
importCase("alles-gesynct", { local: [...base, ...localOnly], unsyncedAfterSeq: 99, remote });
importCase("eigenes-echo", { local: base, localRemote: localOnly, unsyncedAfterSeq: 6, remote });
// Zufällig: zwei Geräte bearbeiten dieselben Seiten.
for (const seed of [21, 22, 23]) {
	const r = rng(seed);
	const ids = ["A", "B", "C", "D"];
	let q = 0;
	const mk = (pre, i, type, payload) => ({ id: pre + i, t: I(i * 2 + (pre === "x" ? 1 : 0)), type, payload, seq: ++q });
	const loc = ids.map((id, i) => mk("c", i, "pageCreate", { id, title: "T" + id, content: "1\n2\n3\n4\n5", ...(r() < 0.5 ? { parentId: "A" } : {}) }));
	const doEdit = (pre, i) => {
		const id = ids[Math.floor(r() * ids.length)], roll = r();
		if (roll < 0.6) { const L = "1\n2\n3\n4\n5".split("\n"); L[Math.floor(r() * 5)] = pre + i; return mk(pre, i, "pageUpdate", { id, patch: { content: L.join("\n") } }); }
		if (roll < 0.7) return mk(pre, i, "pageDelete", { id });
		if (roll < 0.8) return mk(pre, i, "pageMove", { id, parentId: null });
		return mk(pre, i, pick3(r, ["pageTrash", "pageRestore", "pageArchive", "pageUnarchive"]), { id });
	};
	const localEdits = Array.from({ length: 8 }, (_, i) => doEdit("y", 10 + i));
	q = 500;
	const remoteEdits = Array.from({ length: 8 }, (_, i) => doEdit("x", 10 + i));
	importCase("zufall-" + seed, { local: [...loc, ...localEdits], unsyncedAfterSeq: 4, remote: remoteEdits });
}
function pick3(r, arr) { return arr[Math.floor(r() * arr.length)]; }
write("import.json", imports);
console.log("Golden-Files geschrieben:", out);
