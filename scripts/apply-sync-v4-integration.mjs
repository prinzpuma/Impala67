import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const write = (file, text) => fs.writeFileSync(path.join(root, file), text);
function replaceOnce(text, from, to, label) {
	const at = text.indexOf(from);
	if (at < 0) throw new Error(`Patch '${label}' passt nicht zum erwarteten main-Stand 5377699a.`);
	if (text.indexOf(from, at + from.length) >= 0) throw new Error(`Patch '${label}' ist mehrdeutig.`);
	return text.slice(0, at) + to + text.slice(at + from.length);
}

let db = read("web/db.js");
db = replaceOnce(db,
	'const DROPPABLE_TYPES = new Set(["uiTabsSet", "uiTreeSet", "heftOps"]);',
	'const DROPPABLE_TYPES = new Set(["uiTabsSet", "uiTreeSet"]);',
	"heftOps niemals per Floor verwerfen");
db = replaceOnce(db,
	'\t\tconst heftSnapped = new Set(); // pageIds, für die (rückwärts gelesen) schon ein heftSnap steht\n',
	'', "Snapshot-Kompaktierungszustand entfernen");
db = replaceOnce(db,
	'\t\t\t// Heft: der jüngste heftSnap je Seite beschreibt den ganzen Stand — alles Ältere\n\t\t\t// desselben Hefts (Ops wie ältere Snapshots) ist damit redundant. Pro pageId, nicht global.\n\t\t\telse if (ev.type === "heftSnap") { if (heftSnapped.has(p.pageId)) continue; heftSnapped.add(p.pageId); }\n\t\t\telse if (ev.type === "heftOps" && heftSnapped.has(p.pageId)) continue;\n',
	'', "kausal unsichere Heft-Snapshot-Kompaktierung entfernen");

const oldCompactLocal = `\tasync function compactLocal(minDrop = 200) {
\t\tconst evs = await allEvents();
\t\tconst compacted = compactEvents(evs);
\t\tconst dropped = evs.length - compacted.length;
\t\tif (dropped < minDrop) return 0;
\t\tawait rw("events", (s) => { s.clear(); compacted.forEach(({ seq, ...ev }) => s.add(ev)); });
\t\t// Untergrenze setzen, damit fremde Deltas die verworfenen Events nicht zurückbringen.
\t\tlocalStorage.setItem(COMPACT_FLOOR_KEY, compacted.length ? compacted[0].t : U.now());
\t\t// Der seq-Raum ist komplett neu vergeben — jede seq-basierte Sync-Marke ist damit
\t\t// bedeutungslos. 0 = beim nächsten Sync alles erneut anbieten; importAll bzw. der Cloud-Sync
\t\t// ist per Event-id / Deduplizierung idempotent, es entstehen also keine Duplikate.
\t\t// Auch die Cloudflare-Upload-Cursor müssen auf 0 gesetzt werden, da sonst neue Events
\t\t// wegen eines alten, zu hohen Upload-Cursors übersprungen würden (stiller Datenverlust).
\t\tlocalStorage.setItem("impala67_drive_uploaded_seq", "0");
\t\tlocalStorage.removeItem("impala67_drive_synced_seq");
\t\ttry {
\t\t\tif (typeof localStorage !== "undefined") {
\t\t\t\tfor (let i = 0; i < localStorage.length; i++) {
\t\t\t\t\tconst k = localStorage.key(i);
\t\t\t\t\tif (k && (k === "impala67_cf_last_uploaded_local_seq" || k.startsWith("impala67_cf_last_uploaded_local_seq_"))) {
\t\t\t\t\t\tlocalStorage.setItem(k, "0");
\t\t\t\t\t}
\t\t\t\t}
\t\t\t}
\t\t} catch {}
\t\tif (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
\t\t\twindow.dispatchEvent(new CustomEvent("impala67:db-compacted"));
\t\t}
\t\treturn dropped;
\t}`;
const newCompactLocal = `\tasync function compactLocal(minDrop = 200) {
\t\tensureOpen();
\t\treturn new Promise((resolve, reject) => {
\t\t\tconst tx = db.transaction("events", "readwrite"), store = tx.objectStore("events");
\t\t\tconst req = store.getAll();
\t\t\tlet dropped = 0, floor = "";
\t\t\treq.onsuccess = () => {
\t\t\t\tconst evs = req.result || [], compacted = compactEvents(evs);
\t\t\t\tdropped = evs.length - compacted.length;
\t\t\t\tif (dropped < minDrop) return;
\t\t\t\tconst keep = new Set(compacted.map((ev) => ev.seq));
\t\t\t\tfor (const ev of evs) if (!keep.has(ev.seq)) store.delete(ev.seq);
\t\t\t\tfloor = compacted.length ? compacted[0].t : U.now();
\t\t\t};
\t\t\treq.onerror = () => { try { tx.abort(); } catch {} };
\t\t\ttx.oncomplete = () => {
\t\t\t\tif (dropped >= minDrop) localStorage.setItem(COMPACT_FLOOR_KEY, floor);
\t\t\t\tresolve(dropped >= minDrop ? dropped : 0);
\t\t\t};
\t\t\ttx.onerror = tx.onabort = () => reject(tx.error || req.error);
\t\t});
\t}`;
db = replaceOnce(db, oldCompactLocal, newCompactLocal, "atomare drop-only Kompaktierung mit stabilen seq");

const oldFloor = `\t\t// [A1] heftOps stand global in DROPPABLE_TYPES — mit derselben Begründung, die weiter oben für
\t\t// pageUpdate ausdrücklich ABGELEHNT wird. Der Unterschied ist entscheidend: eine verworfene
\t\t// pageUpdate kostet nur Platz (Replay ist LWW über t), ein verworfener Strich ist WEG. Ein Gerät,
\t\t// das lange offline gezeichnet hat, verlor seine Handschrift beim ersten Sync still — und weil
\t\t// dieses Gerät danach einen heftSnap schreibt, spiegelte sich der Verlust zurück.
\t\t// Jetzt gilt die Untergrenze für Hefte PRO SEITE und nur dann, wenn ein lokal vorhandener
\t\t// heftSnap den betroffenen Stand nachweislich abdeckt.
\t\tconst heftSnapFloor = new Map(); // pageId -> t des jüngsten lokalen heftSnap
\t\tfor (const ev of local) {
\t\t\tif (ev.type !== "heftSnap" || !ev.payload?.pageId) continue;
\t\t\tconst cur = heftSnapFloor.get(ev.payload.pageId);
\t\t\tif (!cur || ev.t > cur) heftSnapFloor.set(ev.payload.pageId, ev.t);
\t\t}
\t\tconst droppedByFloor = (ev) => {
\t\t\tif (!floor || ev.t >= floor) return false;
\t\t\tif (ev.type === "heftOps") {
\t\t\t\tconst snapT = heftSnapFloor.get(ev.payload?.pageId);
\t\t\t\treturn !!snapT && ev.t < snapT; // nur, wenn ein Snapshot diesen Stand wirklich enthält
\t\t\t}
\t\t\treturn DROPPABLE_TYPES.has(ev.type);
\t\t};`;
const newFloor = `\t\t// Nur wirklich wegwerfbare gerätespezifische UI-Events unterhalb der
\t\t// Kompaktierungsgrenze blockieren. Fachliche Heft-Operationen sind immer zulässig.
\t\tconst droppedByFloor = (ev) => !!floor && ev.t < floor && DROPPABLE_TYPES.has(ev.type);`;
db = replaceOnce(db, oldFloor, newFloor, "Import-Floor ohne Heft-Snapshot-Annahme");
db = replaceOnce(db,
	'\t\t\t\tev._remoteSource = "drive";',
	'\t\t\t\tev._remoteSource = opts.remoteSource || "drive";',
	"gemeinsame Drive/Cloudflare-Merge-Quelle");
db = replaceOnce(db,
	'\t// Höchste lokale Sequenznummer — Basis des Sync-Wasserstands.\n',
	`\t// Einmalige v4-Migration: alten Heft-Transportzustand atomar durch je EIN
\t// vollständiges heftOps-Baseline-Event ersetzen. Keine Zwischenphase ohne Heftdaten.
\tasync function replaceHeftHistory(baselines = []) {
\t\tensureOpen();
\t\tconst list = Array.isArray(baselines) ? baselines : [];
\t\tlist.forEach(validateEvent);
\t\treturn new Promise((resolve, reject) => {
\t\t\tconst tx = db.transaction("events", "readwrite"), store = tx.objectStore("events");
\t\t\tconst req = store.getAll();
\t\t\treq.onsuccess = () => {
\t\t\t\tfor (const ev of req.result || []) if (ev.type === "heftOps" || ev.type === "heftSnap") store.delete(ev.seq);
\t\t\t\tfor (const event of list) { const { seq, ...clean } = event; store.add(clean); }
\t\t\t};
\t\t\treq.onerror = () => { try { tx.abort(); } catch {} };
\t\t\ttx.oncomplete = () => resolve(list.length);
\t\t\ttx.onerror = tx.onabort = () => reject(tx.error || req.error);
\t\t});
\t}

\t// Höchste lokale Sequenznummer — Basis des Sync-Wasserstands.
`,
	"atomare v4-Heft-Baseline-Migration");
db = replaceOnce(db,
	'reconstructPageFromEvents, redactSecretsFromEvent, maxSeq, putBlob',
	'reconstructPageFromEvents, redactSecretsFromEvent, replaceHeftHistory, maxSeq, putBlob',
	"replaceHeftHistory exportieren");
write("web/db.js", db);

let heft = read("web/heft.js");
heft = replaceOnce(heft,
	'\tconst published = {};\n\tconst opsSince = {};   // veröffentlichte Operationen seit der letzten Verdichtung\n\tconst lastSnap = {};   // Zeitpunkt der letzten Verdichtung je Heft\n\tconst SNAP_MIN_OPS = 300, SNAP_MIN_GAP = 5 * 60 * 1000;\n',
	'\tconst published = {};\n',
	"automatische Heft-Snapshots entfernen");
heft = replaceOnce(heft,
	'\t\tif (legacy) await STATE.dispatch("heftSnap", { pageId: p, doc: legacy });',
	'\t\tif (legacy) await STATE.dispatch("heftOps", { pageId: p, ops: diffDoc(null, legacy) });',
	"Legacy-Heft als Operationen migrieren");
heft = replaceOnce(heft,
	'\t\tpublished[savePid] = nextPublished;\n\t\topsSince[savePid] = (opsSince[savePid] || 0) + ops.length;\n\t\tawait maybeCompact(savePid, saveDoc);\n\t\tawait maybeSnapshot(savePid, saveDoc);',
	'\t\tpublished[savePid] = nextPublished;\n\t\tawait maybeSnapshot(savePid, saveDoc);',
	"Persistenz ohne kausal unsichere Verdichtung");
const oldMaybeCompact = `
\t// Verdichtung: nach vielen Operationen einmal den Gesamtstand als heftSnap
\t// schreiben. db.js darf alle älteren heftOps desselben Hefts dann wegwerfen —
\t// so wächst das Log nicht mit jedem Strich für immer weiter.
\tasync function maybeCompact(p, d) {
\t\tif ((opsSince[p] || 0) < SNAP_MIN_OPS) return;
\t\tif (Date.now() - (lastSnap[p] || 0) < SNAP_MIN_GAP) return;
\t\topsSince[p] = 0;
\t\tlastSnap[p] = Date.now();
\t\ttry {
\t\t\tawait STATE.dispatch("heftSnap", { pageId: p, doc: { pages: d.pages } });
\t\t\tpublished[p] = shadowOf(S.heftDocs[p] || d);
\t\t} catch (e) { console.warn("Heft: Verdichtung fehlgeschlagen", e); }
\t}
`;
heft = replaceOnce(heft, oldMaybeCompact, "\n", "maybeCompact entfernen");
heft = replaceOnce(heft,
	'\t\tawait STATE.dispatch("heftSnap", { pageId: p, doc: { pages: JSON.parse(JSON.stringify(restored?.pages || [])) } });\n\t\tconst d = S.heftDocs[p];',
	'\t\tconst target = { v: 2, rev: 0, pages: JSON.parse(JSON.stringify(restored?.pages || [])) };\n\t\tconst current = S.heftDocs[p] || { v: 2, rev: 0, pages: [] };\n\t\tconst ops = diffDoc(shadowOf(current), target);\n\t\tif (ops.length) await STATE.dispatch("heftOps", { pageId: p, ops });\n\t\tconst d = S.heftDocs[p];',
	"Heft-Restore als Operationen statt Vollersatz");
write("web/heft.js", heft);

let tools = read("web/tools.js");
tools = replaceOnce(tools,
	'\t\t\tif (typeof HEFT.restoreDoc === "function") await HEFT.restoreDoc(x.id, { pages: clone(x.before?.pages || []) });\n\t\t\telse await STATE.dispatch("heftSnap", { pageId: x.id, doc: { pages: clone(x.before?.pages || []) } });',
	'\t\t\tif (typeof HEFT.restoreDoc !== "function") throw new Error("Heft-Wiederherstellung ist nicht verfügbar.");\n\t\t\tawait HEFT.restoreDoc(x.id, { pages: clone(x.before?.pages || []) });',
	"Tool-Undo ohne heftSnap-Fallback");
write("web/tools.js", tools);

console.log("Impala67 Sync v4 integration patches applied to db.js, heft.js and tools.js");
