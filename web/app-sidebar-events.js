"use strict";
import { S, STATE } from "./state.js";
import { RENDER } from "./render.js";
import { RENDER_ANKI } from "./render-anki.js";
import { RAG } from "./rag.js";
import { U } from "./util.js";

const render = (...a) => RENDER.render(...a);
const $ = (id) => U.el(id);
const closestOf = (e, sel) => { const t = e && e.target; return t && t.nodeType === 1 && t.closest ? t.closest(sel) : null; };
const dsOf = (e) => (e && e.target && e.target.dataset) || {};

// ---------- Verschieben in der Sidebar ----------
// Stapel: weiterhin HTML5 Drag & Drop (unverändert — dort nicht als Bug gemeldet).
// Seiten: Pointer-Events statt HTML5-DnD, s. u. (Bug-Fix „kommt noch“, 22. Juli).
const clearDropMarks = () => {
	document.querySelectorAll(".row.drop-target,.row.drop-before,.row.drop-after").forEach((r) => {
		r.classList.remove("drop-target", "drop-before", "drop-after");
		r.style.borderTop = "";
		r.style.borderBottom = "";
	});
};

const markDropZone = (row, zone) => {
	clearDropMarks();
	if (!row) return;
	if (zone === "before") { row.classList.add("drop-before"); row.style.borderTop = "2px solid #4a9eff"; }
	else if (zone === "after") { row.classList.add("drop-after"); row.style.borderBottom = "2px solid #4a9eff"; }
	else row.classList.add("drop-target");
};

// Drei Zonen: oberes Viertel = DAVOR, unteres = DANACH, Mitte = als Kind/Unterstapel
const dropZoneFor = (row, clientY) => {
	const r = row.getBoundingClientRect();
	const y = clientY - r.top;
	if (y < r.height * 0.25) return "before";
	if (y > r.height * 0.75) return "after";
	return "into";
};

export async function movePageSubtreeToWorkspace(pageId, workspaceId) {
	if (!pageId || !workspaceId) return;
	for (const id of STATE.pageSubtreeIds(pageId)) {
		const page = S.pages[id];
		if (page && (page.workspaceId || "default") !== workspaceId) {
			await STATE.dispatch("pageUpdate", { id, patch: { workspaceId } });
		}
	}
}

async function movePageRelative(movedId, targetId, zone) {
	const target = S.pages[targetId], moved = S.pages[movedId];
	if (!target || !moved || STATE.pageInTree(target.id, moved.id)) return;
	// Geschwister des Ziels in Anzeige-Reihenfolge; neue Position = Mittelwert der
	// Sortierschlüssel der künftigen Nachbarn (STATE.sortKeyOf).
	const sibs = STATE.childrenOf(target.parentId || null, target.workspaceId || "default").filter((p) => p.id !== moved.id);
	const idx = sibs.findIndex((p) => p.id === target.id);
	if (idx === -1) return;
	const pos = zone === "before" ? idx : idx + 1;
	const prev = sibs[pos - 1], next = sibs[pos];
	const kPrev = prev ? STATE.sortKeyOf(prev) : null;
	const kNext = next ? STATE.sortKeyOf(next) : null;
	const order = kPrev != null && kNext != null ? (kPrev + kNext) / 2 : kPrev != null ? kPrev + 60000 : kNext != null ? kNext - 60000 : Date.now();
	await STATE.dispatch("pageMove", { id: moved.id, parentId: target.parentId || null, order });
	await movePageSubtreeToWorkspace(moved.id, target.workspaceId || "default");
}

async function movePageInto(movedId, targetId) {
	const moved = S.pages[movedId];
	const target = targetId ? S.pages[targetId] : null;
	if (!moved || (targetId && (!target || STATE.pageInTree(targetId, movedId)))) return;
	await STATE.dispatch("pageMove", { id: movedId, parentId: targetId || null });
	await movePageSubtreeToWorkspace(movedId, target ? (target.workspaceId || "default") : (moved.workspaceId || "default"));
}

// ---------- Inline-Umbenennen (Seiten + Stapel) — Enter bestätigt, Esc/Blur bricht ab ----------
// FIX: commitRename lief zweimal — Enter bestätigte, der folgende Fokusverlust
// bestätigte erneut (doppeltes Neuzeichnen); nach Escape schrieb der Fokusverlust den
// verworfenen Text sogar noch fest. Der Umbenenn-Zustand ist jetzt die Sperre: ist er
// geräumt, war die Umbenennung schon erledigt oder abgebrochen.
export function focusRenameInput(inp) {
	if (!inp) return;
	inp.focus();
	inp.select();
}

export async function commitRename(input) {
	if (input.dataset.renamename) {
		const id = input.dataset.renamename;
		if (S.renamingPageId !== id) return;
		const newTitle = input.value.trim();
		const pg = S.pages[id];
		S.renamingPageId = null;
		if (newTitle && pg && newTitle !== pg.title) {
			await STATE.dispatch("pageUpdate", { id, patch: { title: newTitle } });
			RAG.queuePage(id);
		}
		render();
	} else if (input.dataset.deckrenamename) {
		const from = input.dataset.deckrenamename;
		if (S.renamingDeck !== from) return;
		const newLabel = input.value.trim();
		const oldLabel = from.split("::").pop();
		S.renamingDeck = null;
		if (newLabel && newLabel !== oldLabel) {
			const prefix = from.includes("::") ? from.slice(0, from.lastIndexOf("::") + 2) : "";
			const to = prefix + newLabel;
			await STATE.dispatch("deckRename", { from, to });
			if (S.ankiDeck && STATE.deckInTree(S.ankiDeck, from)) S.ankiDeck = to + S.ankiDeck.slice(from.length);
		}
		render();
	}
}

// ---------- ↔️ Breite der linken Spalte ziehen (Griff #sidebarResizer) ----------
// EINE Quelle der Wahrheit: die CSS-Variable --sidebar-w. Sie steht inline am <body>
// (gewinnt damit gegen die Kompakt-Regeln in styles.css), die Grid-Spalten lesen sie.
// Pointer-Events wie beim Seiten-Verschieben — ein Pfad für Maus und Touch.
export const SIDEBAR_W_KEY = "impala67.sidebarWidth";
export const SIDEBAR_W_MIN = 180, SIDEBAR_W_MAX = 560;
export const setSidebarWidth = (px, persist) => {
	const w = Math.round(Math.min(SIDEBAR_W_MAX, Math.max(SIDEBAR_W_MIN, px)));
	document.body.style.setProperty("--sidebar-w", w + "px");
	if (persist) { try { localStorage.setItem(SIDEBAR_W_KEY, String(w)); } catch { /* ignore */ } }
};

export function wireSidebarEvents() {
	// Stapel (Decks): unverändertes HTML5 Drag & Drop
	let deckDragId = null, deckDropZone = null;
	document.addEventListener("dragstart", (e) => {
		if (closestOf(e, "button, input, a, .page-menu, .row-add, .row-chevron")) { e.preventDefault(); return; }
		const deckRow = closestOf(e, "[data-deck]");
		if (deckRow) { deckDragId = deckRow.dataset.deck; e.dataTransfer.effectAllowed = "move"; }
	});
	document.addEventListener("dragover", (e) => {
		if (!deckDragId) return;
		const deckRow = closestOf(e, "[data-deck]");
		if (!deckRow && !closestOf(e, "#tree")) return;
		e.preventDefault();
		deckDropZone = deckRow ? dropZoneFor(deckRow, e.clientY) : "into";
		markDropZone(deckRow, deckDropZone);
	});
	document.addEventListener("dragend", () => { deckDragId = null; deckDropZone = null; clearDropMarks(); });
	// EIN drop-Handler für Stapel: oberes/unteres Viertel = Reihenfolge (deckReorder),
	// Mitte bzw. freie Baumfläche = Verschieben (deckMove).
	// FIX: Vorher zwei drop-Listener, die sich per stopImmediatePropagation gegenseitig
	// ausbremsten — die Registrierungsreihenfolge entschied über das Verhalten, und der
	// Zustand (deckDragId/deckDropZone) wurde in beiden Zweigen unterschiedlich geräumt.
	document.addEventListener("drop", async (e) => {
		if (!deckDragId) return;
		const deckRow = closestOf(e, "[data-deck]");
		const inTree = closestOf(e, "#tree");
		clearDropMarks();
		if (!deckRow && !inTree) { deckDragId = null; deckDropZone = null; return; }
		e.preventDefault();
		const moved = deckDragId;
		const zone = deckDropZone;
		deckDragId = null; deckDropZone = null;
		if (deckRow && (zone === "before" || zone === "after")) {
			const target = deckRow.dataset.deck;
			if (!target || STATE.deckInTree(target, moved)) return;
			// Sortieren gilt je Ebene: Ziel muss ein Geschwister-Stapel sein
			const parentOf = (n) => (n.includes("::") ? n.slice(0, n.lastIndexOf("::")) : "");
			if (parentOf(target) !== parentOf(moved)) return;
			const sibs = RENDER_ANKI.ankiDecks().filter((n) => parentOf(n) === parentOf(target) && n !== moved);
			const idx = sibs.indexOf(target);
			if (idx === -1) return;
			sibs.splice(zone === "before" ? idx : idx + 1, 0, moved);
			// Reihenfolge komplett neu durchnummerieren — robust gegen fehlende order-Werte
			for (let i = 0; i < sibs.length; i++) {
				await STATE.dispatch("deckReorder", { name: sibs[i], order: (i + 1) * 1000 });
			}
			return;
		}
		const targetDeck = deckRow ? deckRow.dataset.deck : "";
		// kein Zyklus: nicht in sich selbst / eigenen Unterstapel ziehen
		if (targetDeck !== "Standard" && !STATE.deckInTree(targetDeck, moved)) {
			await STATE.dispatch("deckMove", { from: moved, target: targetDeck });
			if (S.ankiDeck && STATE.deckInTree(S.ankiDeck, moved)) {
				const label = moved.split("::").pop();
				const newRoot = (targetDeck ? targetDeck + "::" : "") + label;
				S.ankiDeck = newRoot + S.ankiDeck.slice(moved.length);
			}
		}
	});

	// Seiten (Pages): Pointer-Events statt HTML5-DnD — Bug-Fix „kommt noch“ (22. Juli):
	// HTML5-Drag&Drop startet auf iPad nur per Long-Press und kollidiert mit dem
	// Scrollen. Pointer-Events (pointerdown/-move/-up) laufen in Maus- und Touch-
	// Browsern identisch — ein
	// Code-Pfad statt Plattform-Sonderfälle. Dieselbe Zielfindung (davor/danach/als Kind)
	// und dieselben dispatch-Aufrufe wie vorher, nur die Eingabe-Ereignisse sind ersetzt.
	const PAGE_DRAG_THRESHOLD = 6; // px, bevor aus einem Tipp ein Drag wird (KISS: eine Schwelle für Maus+Touch)
	// iPad-Fix: Mit Finger war JEDER Wisch über einer Heft-Zeile sofort ein Drag —
	// Scrollen der Seitenleiste verschob dadurch Hefte. Auf Touch gilt jetzt wie in
	// Notion/GoodNotes: kurz halten, DANN ziehen. Wischt man vorher los, ist es Scrollen.
	const TOUCH_HOLD_MS = 380;
	let pageDrag = null; // { id, pointerId, startX, startY, dragging, row, ghost, target, zone }
	function endPageDrag() {
		if (!pageDrag) return;
		pageDrag.ghost?.remove();
		if (pageDrag.row) pageDrag.row.style.touchAction = "";
		clearDropMarks();
		pageDrag = null;
	}
	document.addEventListener("pointerdown", (e) => {
		if (e.button !== undefined && e.button !== 0) return;
		const row = closestOf(e, "#tree .row[data-page]");
		if (!row || closestOf(e, "button, input, a, .page-menu, .row-add, .row-chevron")) return;
		pageDrag = { id: row.dataset.page, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, dragging: false, row, touch: e.pointerType !== "mouse", downAt: Date.now() };
	});
	document.addEventListener("pointermove", (e) => {
		if (!pageDrag || e.pointerId !== pageDrag.pointerId) return;
		if (!pageDrag.dragging) {
			const moved = Math.hypot(e.clientX - pageDrag.startX, e.clientY - pageDrag.startY);
			if (pageDrag.touch && Date.now() - pageDrag.downAt < TOUCH_HOLD_MS) {
				// Bewegung innerhalb der Haltezeit = Scrollwisch → Drag-Kandidat verwerfen
				if (moved >= PAGE_DRAG_THRESHOLD) endPageDrag();
				return;
			}
			if (moved < PAGE_DRAG_THRESHOLD) return;
			// FIX (Absturz "pageDrag.ghost.style" von undefined, 22. Juli): Ghost ERST
			// vollständig aufbauen und NUR bei Erfolg auf pageDrag schreiben — "dragging"
			// zuletzt setzen. Vorher stand dragging=true schon fest, bevor das Ghost
			// erzeugt war; warf setPointerCapture() dazwischen (z. B. Zeile durch einen
			// Re-Render inzwischen aus dem DOM entfernt), blieb dragging=true ohne Ghost
			// stehen — jeder weitere pointermove crashte auf pageDrag.ghost.style.
			// setPointerCapture ist hier unnötig (Zielsuche läuft über
			// document.elementFromPoint statt über e.target) und daher entfernt (KISS).
			const pg = S.pages[pageDrag.id];
			const ghost = document.createElement("div");
			ghost.className = "row drag-ghost";
			Object.assign(ghost.style, {
				position: "fixed", left: "0", top: "0", width: pageDrag.row.getBoundingClientRect().width + "px",
				pointerEvents: "none", opacity: "0.9", zIndex: "9999",
				background: "var(--bg-elevated, #fff)", boxShadow: "0 4px 14px rgba(0,0,0,.18)",
			});
			ghost.textContent = (pg?.icon ? pg.icon + " " : "") + (pg?.title || "");
			document.body.appendChild(ghost);
			// Touch-Scroll erst JETZT unterbinden (Drag erkannt) — ein normaler Wisch zum
			// Scrollen der Seitenleiste, der auf einer Zeile beginnt, bleibt so unangetastet.
			pageDrag.row.style.touchAction = "none";
			pageDrag.ghost = ghost;
			pageDrag.dragging = true;
		}
		if (!pageDrag.ghost) return; // Sicherheitsnetz: ohne Ghost keine Drag-Anzeige möglich
		e.preventDefault();
		pageDrag.ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 12}px)`;
		const under = document.elementFromPoint(e.clientX, e.clientY);
		const overRow = under?.closest?.("#tree .row[data-page]");
		// Über der eigenen Zeile: KEIN Ziel (sonst landete die Seite fälschlich in der
		// Wurzel — der else-if-Zweig für freie Baumfläche griff, weil overRow zwar
		// existierte, aber per id-Check verworfen wurde).
		if (overRow && overRow.dataset.page === pageDrag.id) {
			pageDrag.target = undefined;
			pageDrag.zone = null;
			clearDropMarks();
		} else if (overRow) {
			pageDrag.target = overRow.dataset.page;
			pageDrag.zone = dropZoneFor(overRow, e.clientY);
			markDropZone(overRow, pageDrag.zone);
		} else if (under?.closest?.("#tree")) {
			pageDrag.target = null; // freie Fläche im Baum = Wurzelebene
			pageDrag.zone = "into";
			clearDropMarks();
		} else {
			pageDrag.target = undefined; // außerhalb des Baums abgesetzt = ungültiges Ziel
			clearDropMarks();
		}
	}, { passive: false });
	document.addEventListener("pointerup", async (e) => {
		if (!pageDrag || e.pointerId !== pageDrag.pointerId) return;
		const { id, dragging, target, zone, row } = pageDrag;
		endPageDrag();
		if (!dragging) return; // reiner Tipp/Klick — der normale Seiten-Öffnen-Handler übernimmt
		// Der Browser feuert nach dem Drag noch ein "click" auf dieselbe Zeile — einmalig unterdrücken
		row.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); }, { capture: true, once: true });
		if (target === undefined) return;
		if (target && zone !== "into") await movePageRelative(id, target, zone);
		else await movePageInto(id, target || null);
	});
	document.addEventListener("pointercancel", (e) => { if (pageDrag && e.pointerId === pageDrag.pointerId) endPageDrag(); });

	// Inline-Umbenennen-Events (Enter bestätigt, Esc/Blur bricht ab)
	document.addEventListener("keydown", (e) => {
		const ds = dsOf(e);
		if (!ds.renamename && !ds.deckrenamename) return;
		if (e.key === "Enter") { e.preventDefault(); commitRename(e.target); }
		else if (e.key === "Escape") {
			S.renamingPageId = null;
			S.renamingDeck = null;
			render();
		}
	});
	document.addEventListener("focusout", (e) => {
		const ds = dsOf(e);
		if (!ds.renamename && !ds.deckrenamename) return;
		commitRename(e.target);
	});

	// Breite der linken Spalte ziehen (Griff #sidebarResizer)
	try {
		const savedW = Number(localStorage.getItem(SIDEBAR_W_KEY) || 0);
		if (savedW) setSidebarWidth(savedW, false);
	} catch { /* ignore */ }
	let sidebarResize = null;
	document.addEventListener("pointerdown", (e) => {
		if (e.button !== undefined && e.button !== 0) return;
		if (!closestOf(e, "#sidebarResizer")) return;
		const bar = $("sidebar");
		if (!bar) return;
		e.preventDefault();
		sidebarResize = { pointerId: e.pointerId, startX: e.clientX, startW: bar.getBoundingClientRect().width };
		document.body.classList.add("sidebar-resizing");
	});
	document.addEventListener("pointermove", (e) => {
		if (!sidebarResize || e.pointerId !== sidebarResize.pointerId) return;
		e.preventDefault();
		setSidebarWidth(sidebarResize.startW + (e.clientX - sidebarResize.startX), false);
	}, { passive: false });
	const endSidebarResize = (e) => {
		if (!sidebarResize || (e && e.pointerId !== sidebarResize.pointerId)) return;
		sidebarResize = null;
		document.body.classList.remove("sidebar-resizing");
		const bar = $("sidebar");
		if (bar) setSidebarWidth(bar.getBoundingClientRect().width, true);
	};
	document.addEventListener("pointerup", endSidebarResize);
	document.addEventListener("pointercancel", endSidebarResize);
	// Doppelklick auf den Griff = zurück zur Standardbreite (CSS entscheidet wieder)
	document.addEventListener("dblclick", (e) => {
		if (!closestOf(e, "#sidebarResizer")) return;
		document.body.style.removeProperty("--sidebar-w");
		try { localStorage.removeItem(SIDEBAR_W_KEY); } catch { /* ignore */ }
	});
}
