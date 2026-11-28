"use strict";
// Sync-Konflikte: Pending-Liste, Quittierung, Entscheidungs-Dialog und Tastatur-/Klick-Events.
// Darstellung (HTML, Zeilenvergleich) liegt in conflict-ui.js.
import { S, STATE } from "./state.js";
import { BUS } from "./event-bus.js";
import { U } from "./util.js";
import { conflictDialogHtml, recommendedAction } from "./conflict-ui.js";

const $ = (id) => U.el(id);
const lsGet = (k, fb) => U.storage.getJson(k, fb);
const lsSet = (k, v) => U.storage.setJson(k, v);

function openOverlay(html) {
	const o = U.takeOverlay();
	if (!o) return null;
	if (o.hidden) {
		o.hidden = false;
		o.innerHTML = html;
	} else {
		U.morph(o, html);
	}
	return o;
}

const CONFLICT_KEY = "impala67_pending_conflicts";
const RESOLVED_CONFLICT_KEY = "impala67_resolved_conflicts";
const loadResolvedConflictIds = () => new Set(lsGet(RESOLVED_CONFLICT_KEY, []));

function markConflictResolved(conflictPageId) {
	if (!conflictPageId) return;
	// nur lokale UI-Quittierung; klein halten (kein wachsender LocalStorage)
	lsSet(RESOLVED_CONFLICT_KEY, [...loadResolvedConflictIds().add(conflictPageId)].slice(-200));
}

// Maßgeblich ist der ⚠-Titel: „Beide behalten“ benennt die Kopie um, und das reist per Sync mit.
// PERF: billige Titelprüfung zuerst — sonst las die Startseite pro Seite (3×) die
// Erledigt-Liste aus dem localStorage und parste sie neu.
export const isConflictPage = (p) => !!(p && (p.title || "").startsWith("⚠ Konflikt") && !loadResolvedConflictIds().has(p.id));
export const loadPendingConflicts = () => lsGet(CONFLICT_KEY, []);

function savePendingConflicts(list) {
	if (!list || !list.length) { U.storage.remove(CONFLICT_KEY); return; }
	// Bug-1-Fix: localContent/remoteContent können die localStorage-Quota sprengen.
	// Fallback: ohne Textfelder speichern — beim Öffnen des Dialogs werden sie aus
	// S.pages rekonstruiert (solange die Sitzung läuft ist das verlustfrei).
	if (U.storage.setJson(CONFLICT_KEY, list)) return;
	const slim = list.map(({ localContent, remoteContent, loserContent, ...rest }) => rest);
	U.storage.setJson(CONFLICT_KEY, slim);
}

export function mergePendingConflicts(details) {
	const map = new Map(loadPendingConflicts().map((c) => [c.conflictPageId || c.pageId, c]));
	for (const c of details || []) map.set(c.conflictPageId || c.pageId, c);
	savePendingConflicts([...map.values()]);
}

// Gerettete Kopien aus früheren Konflikten (ohne gespeicherte Details), verglichen mit der
// heutigen Seite gleichen Titels (Kern: legacy_conflict_items).
const legacyConflictItems = () => STATE.conflictLegacyItems(loadResolvedConflictIds());

// Quelle der offenen Konflikte: Pending-Liste, sonst gerettete Alt-Kopien
function conflictSource() {
	const items = loadPendingConflicts();
	return items.length ? items : legacyConflictItems();
}

const closeConflictDialog = () => U.closeOverlay();

export function openConflictResolver(index) {
	const items = conflictSource();
	if (!items.length) return void U.toast("Keine offenen Konflikte.", "success");
	const i = Math.max(0, Math.min(Number(index) || 0, items.length - 1));
	// Bug-1-Fix: Textfelder können fehlen, wenn localStorage-Quota beim Speichern überschritten wurde.
	// Der Kern ergänzt sie aus dem Zustand: die Kopie hält den unterlegenen, die Seite den gewinnenden Stand.
	const c = STATE.conflictWithTexts(items[i]);
	// Das rekonstruierte Objekt MUSS zurück in die Liste: resolveConflict liest S.conflictResolveList[i].
	items[i] = c;
	S.conflictResolveIndex = i;
	S.conflictResolveList = items;
	const copyText = (S.pages[c.conflictPageId] || {}).content || "";
	const o = openOverlay(conflictDialogHtml(items, i, { copyText }));
	const d = o && o.querySelector(".conflict-modal");
	if (d && !d.contains(document.activeElement)) d.focus({ preventScroll: true });
}

// Eine Entscheidung für EINEN Konflikt anwenden. Liefert false, wenn sie nicht sicher ausführbar
// war (dann ist nichts verändert). loserContent geht nie als undefined an pageUpdate.
async function applyConflictAction(conf, action) {
	const copyId = conf.conflictPageId;
	// Welche Events die Entscheidung braucht, rechnet der Kern (conflict.rs resolve).
	const plan = STATE.conflictResolve(conf, action);
	if (plan.error === "copy-missing") { U.toast("Die gerettete Kopie fehlt. Es wurde nichts geändert.", "error"); return false; }
	if (plan.error === "loser-missing") { U.toast("Der andere Stand ist nicht mehr vorhanden. Es wurde nichts geändert.", "error"); return false; }
	for (const [type, payload] of plan.events) await STATE.dispatch(type, payload);
	// Konflikt quittieren und aus der Pending-Liste nehmen (sonst kommt derselbe Dialog nach dem nächsten Start wieder)
	markConflictResolved(copyId);
	const key = copyId || conf.pageId;
	savePendingConflicts(loadPendingConflicts().filter((x) => (x.conflictPageId || x.pageId) !== key));
	return true;
}

// Nach einer Entscheidung: nächsten offenen Konflikt zeigen, sonst schließen.
function afterConflictResolved(i) {
	const rest = conflictSource();
	if (rest.length) openConflictResolver(Math.min(i, rest.length - 1));
	else { closeConflictDialog(); U.toast("Konflikt erledigt.", "success"); }
	BUS.emit("ui:render");
}

// Entscheidung für den gerade angezeigten Konflikt (Buttons im Dialog)
export async function resolveConflict(action) {
	const list = S.conflictResolveList || loadPendingConflicts();
	const i = S.conflictResolveIndex || 0;
	const conf = list[i];
	if (!conf) return;
	if (!(await applyConflictAction(conf, action))) return;
	afterConflictResolved(i);
}

// „Alle X Konflikte mit Empfehlung lösen“: wendet die Empfehlung auf alle Konflikte mit Empfehlung an.
async function resolveAllRecommended() {
	const todo = conflictSource().filter((c) => recommendedAction(c));
	if (!todo.length) return;
	const ok = await U.confirm(
		`Bei ${todo.length} Konflikten wird die Empfehlung übernommen. Die jeweils andere Fassung landet im Papierkorb und lässt sich dort wiederherstellen.`,
		{ title: `Alle ${todo.length} Konflikte lösen?`, ok: "Mit Empfehlung lösen" });
	if (!ok) { openConflictResolver(S.conflictResolveIndex || 0); return; }
	let done = 0;
	try {
		for (const c of todo) {
			if (!(await applyConflictAction(c, recommendedAction(c)))) break;
			done++;
		}
	} catch (err) {
		U.toast("Nicht alle Konflikte konnten gelöst werden.", "error");
	}
	if (done) U.toast(`${done} ${done === 1 ? "Konflikt" : "Konflikte"} gelöst.`, "success");
	if (conflictSource().length) openConflictResolver(0);
	else closeConflictDialog();
	BUS.emit("ui:render");
}

if (typeof document !== "undefined") {
	// Escape schließt, ↑/↓ wechseln den Konflikt (nicht in Scroll-Bereichen des Vergleichs).
	document.addEventListener("keydown", (e) => {
		const o = $("overlay");
		if (!o || o.hidden || !o.querySelector(".conflict-modal")) return;
		if (e.key === "Escape") { e.preventDefault(); closeConflictDialog(); return; }
		if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
		const t = e.target;
		if (t && t.closest && t.closest(".cf-scroll, .cf-pane-text")) return;
		if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
		const n = (S.conflictResolveList || []).length;
		if (n < 2) return;
		e.preventDefault();
		const step = e.key === "ArrowDown" ? 1 : -1;
		openConflictResolver((((S.conflictResolveIndex || 0) + step) % n + n) % n);
	});

	// Nav (‹ / ›), Sprung zur nächsten Änderung und Schnell-Lösung. Capture-Phase, damit die Klicks
	// nicht vorher in der allgemeinen Overlay-Delegation landen.
	document.addEventListener("click", (e) => {
		const nav = e.target && e.target.closest && e.target.closest("[data-conflictnav]");
		if (nav && !nav.disabled) {
			e.preventDefault();
			e.stopPropagation();
			const list = S.conflictResolveList || loadPendingConflicts();
			if (!list.length) return;
			const step = Number(nav.dataset.conflictnav) || 0;
			openConflictResolver((((S.conflictResolveIndex || 0) + step) % list.length + list.length) % list.length);
			return;
		}
		const bulk = e.target && e.target.closest && e.target.closest("[data-conflictbulk]");
		if (bulk) {
			e.preventDefault();
			e.stopPropagation();
			resolveAllRecommended();
			return;
		}
		const jump = e.target && e.target.closest && e.target.closest("[data-conflictdiffnext]");
		if (!jump) return;
		e.preventDefault();
		e.stopPropagation();
		const box = $("conflictDiffScroll");
		if (!box) return;
		const marks = [...box.querySelectorAll("[data-changeidx]")];
		if (!marks.length) return;
		// Nächste Änderung unterhalb der aktuellen Position — sonst wieder von vorne (Rundlauf).
		const boxTop = box.getBoundingClientRect().top;
		const next = marks.find((m) => m.getBoundingClientRect().top - boxTop > 8) || marks[0];
		box.scrollTo({ top: Math.max(0, box.scrollTop + next.getBoundingClientRect().top - boxTop - 40), behavior: "smooth" });
	}, true);
}

BUS.on("ui:merge-pending-conflicts", (details) => mergePendingConflicts(details));
BUS.on("ui:open-conflict-resolver", (idx) => openConflictResolver(idx));
