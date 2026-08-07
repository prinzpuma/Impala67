"use strict";
import { COLLAPSE } from "./collapse.js";
import { CHATS } from "./chats.js";
import { DB } from "./db.js";
import { EDITOR } from "./editor.js";
import { RAG } from "./rag.js";
import { RENDER } from "./render.js";
import { RENDER_ANKI } from "./render-anki.js";
import { S, STATE } from "./state.js";
import { SRS } from "./srs.js";
import { U } from "./util.js";
import { SETTINGS } from "./settings.js";
import { LIBRARY } from "./library.js";
import { TABS } from "./tabs.js";
import { SEARCH } from "./search.js";
import { SHORTCUTS } from "./shortcuts.js";
import { CHAT_FULLSCREEN } from "./chat-fullscreen.js";
import { VOICE } from "./voice.js";
import { POPOVERS } from "./popovers.js";
import { AI } from "./ai.js";
import { HEFT } from "./heft.js";
import { FACH } from "./fach.js";

// Kurz-Aliasse — bewusst spät gebunden ((...a) =>) wegen Modul-Zyklen.
// FIX: toter openNewTab-Alias entfernt (wurde nirgends aufgerufen)
const render = (...a) => RENDER.render(...a);
const openTemplatePicker = (...a) => RENDER.openTemplatePicker(...a);
const openPage = (...a) => TABS.openPage(...a);
const closeTab = (...a) => TABS.closeTab(...a);
const navBack = (...a) => TABS.navBack(...a);
const navForward = (...a) => TABS.navForward(...a);
const openHomeOverview = (...a) => TABS.openHomeOverview(...a);
const saveCurrentChat = (...a) => CHAT_FULLSCREEN.saveCurrentChat(...a);
const sendChatMessage = (...a) => CHAT_FULLSCREEN.sendChatMessage(...a);
const renderModelBar = (...a) => RENDER.renderModelBar(...a);
const renderModelMenu = (...a) => RENDER.renderModelMenu(...a);
const renderSidebar = (...a) => RENDER.renderSidebar(...a);
const renderMain = (...a) => RENDER.renderMain(...a);
const renderTabs = (...a) => RENDER.renderTabs(...a);
const openReview = (...a) => RENDER.openReview(...a);
const openCards = (...a) => RENDER.openCards(...a);
const openIconPicker = (...a) => RENDER.openIconPicker(...a);
const openCoverPicker = (...a) => RENDER.openCoverPicker(...a);
const localDayKey = (...a) => RENDER.localDayKey(...a);
const renderHistoryModal = (...a) => RENDER.renderHistoryModal(...a);
const ankiCardsOf = (...a) => RENDER_ANKI.ankiCardsOf(...a);
const openCardEditor = (...a) => RENDER_ANKI.openCardEditor(...a);
const renderAnki = (...a) => RENDER_ANKI.renderAnki(...a);

// app.js v2 — Init + Event-Verkabelung. KISS/DRY-Refactor, funktionsgleich.
const $ = (id) => U.el(id);
const esc = (s) => U.esc(s);
// FIX (Absturz "e.target.closest is not a function"): e.target ist NICHT immer ein
// Element. Bei Tastatur-, Fokus- und Drag-Ereignissen kann es das Dokument selbst
// oder ein Textknoten sein — dort gibt es weder closest() noch dataset. Statt 20
// Einzelabfragen gibt es genau zwei Helfer, die alle Delegations-Listener nutzen.
const closestOf = (e, sel) => { const t = e && e.target; return t && t.nodeType === 1 && t.closest ? t.closest(sel) : null; };
const dsOf = (e) => (e && e.target && e.target.dataset) || {};
const blurActive = () => document.activeElement?.blur();
const closeTopMenu = () => { if (S.topMenu) { S.topMenu = null; renderMain(); } };
const focusPageTitle = () => { const ti = $("pageTitle"); if (ti) { ti.focus(); ti.select(); } };
// deck gleich name oder Unterstapel davon?
const inDeck = (deck, name) => deck === name || deck.startsWith(name + "::");
// Alle Nachfahren einer Seite inkl. ihrer selbst (Verschieben-Dialog, Papierkorb)
function descendantsOf(pageId) {
	// PERF: EIN Durchlauf baut den Eltern→Kinder-Index, danach werden nur noch echte
	// Kinder besucht — vorher scannte JEDE Rekursionsebene ALLE Seiten (O(n²) bei
	// tiefen Bäumen; spürbares Haken bei Verschieben/Papierkorb in großen Workspaces).
	const byParent = new Map();
	for (const p of Object.values(S.pages)) {
		const k = p.parentId || null;
		let kids = byParent.get(k);
		if (!kids) { kids = []; byParent.set(k, kids); }
		kids.push(p.id);
	}
	const set = new Set([pageId]);
	const stack = [pageId];
	while (stack.length) {
		for (const kid of byParent.get(stack.pop()) || []) {
			if (!set.has(kid)) { set.add(kid); stack.push(kid); }
		}
	}
	return set;
}

export function closeOverlay() {
	const o = $("overlay");
	if (o) { o.hidden = true; o.classList.remove("change-overlay"); o.innerHTML = ""; }
	S.reviewShowBack = false;
}
// Großer Chat wird dynamisch gerendert → Debug- und Voice-Button hier nachrüsten
// (Kommentar saß vorher falsch: der prompt()-Hinweis gehört zu openPromptDialog)
function mountFullChatDebugButton() {
	const head = document.querySelector(".chat-full-head");
	if (!head || head.querySelector("#btnAiDebugFull")) return;
	const mk = (props) => Object.assign(document.createElement("button"), { type: "button", ...props });
	head.appendChild(mk({ id: "btnAiDebugFull", className: "ai-debug-btn", title: "Letztes KI-Debugprotokoll in die Zwischenablage kopieren", textContent: "Debugprotokoll" }));
	const submit = $("mainChatSubmit");
	if (submit && !$("btnVoiceFull")) {
		// SVG statt Emoji — konsistent mit den übrigen Icons (voice.js pflegt den Zustand)
		const voiceBtn = mk({ id: "btnVoiceFull", className: "composer-tool", title: "Spracheingabe starten (Alt+Leertaste)" });
		voiceBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v4"/></svg>';
		submit.before(voiceBtn);
	}
}

async function copyAiDebugTrace() {
	const report = AI.debugReport();
	try {
		await navigator.clipboard.writeText(report);
		U.toast("KI-Debugprotokoll kopiert — hier im Chat einfügen.", "success");
	} catch {
		// Clipboard blockiert (file:// / Berechtigung) → auswählbarer Dialog statt Datenverlust
		const o = $("overlay");
		if (!o) return;
		o.hidden = false;
		o.innerHTML = '<div class="modal modal-sm"><button class="modal-x" id="btnCloseOverlay" title="Schließen">✕</button>' +
			'<h3>KI-Debugprotokoll</h3><p class="hint">Zwischenablage blockiert. Bitte den folgenden Text kopieren und hier einfügen.</p>' +
			`<textarea class="ai-debug-copy" readonly>${esc(report)}</textarea></div>`;
		const area = o.querySelector("textarea");
		if (area) { area.focus(); area.select(); }
	}
}

// Eigener Eingabe-Dialog statt window.prompt() — nutzt #overlay wie alle Dialoge
function openPromptDialog(title, onSubmit, initial) {
	const o = $("overlay");
	if (!o) return;
	o.innerHTML = `<div class="modal modal-sm"><h3>${esc(title)}</h3><input id="dlgPromptInput" autocomplete="off" value="${esc(initial || "")}">` +
		'<div class="modal-actions"><button id="dlgPromptCancel">Abbrechen</button><button id="dlgPromptOk">OK</button></div></div>';
	o.hidden = false;
	const inp = $("dlgPromptInput");
	const submit = () => { const v = inp.value.trim(); closeOverlay(); if (v) onSubmit(v); };
	$("dlgPromptOk").addEventListener("click", submit);
	$("dlgPromptCancel").addEventListener("click", () => closeOverlay());
	inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
	inp.focus();
	inp.select();
}

// „Verschieben nach…“: Ziel = Workspace-Wurzel oder Seite (ohne eigene Nachfahren)
function openMoveDialog(pageId) {
	const o = $("overlay");
	const pg = S.pages[pageId];
	if (!o || !pg) return;
	const bad = descendantsOf(pageId);
	let items = "";
	for (const ws of Object.values(S.workspaces)) {
		items += `<button class="menu-item" data-movetarget="ws:${esc(ws.id)}">📁 ${esc(ws.name)}</button>`;
		const walk = (parentId, depth) => {
			for (const p of STATE.childrenOf(parentId, ws.id)) {
				if (bad.has(p.id) || p.trashed) continue;
				items += `<button class="menu-item" data-movetarget="pg:${p.id}" style="padding-left:${14 + depth * 16}px">${p.icon ? esc(p.icon) + " " : "📝 "}${esc(p.title)}</button>`;
				walk(p.id, depth + 1);
			}
		};
		walk(null, 1);
	}
	o.innerHTML = `<div class="modal modal-sm"><h3>„${esc(pg.title)}“ verschieben nach…</h3><div class="move-list">${items}</div>` +
		'<div class="modal-actions"><button id="dlgMoveCancel">Abbrechen</button></div></div>';
	o.hidden = false;
	S.movePageId = pageId;
	$("dlgMoveCancel").addEventListener("click", () => closeOverlay());
}

function isDescendant(childId, ancestorId) {
	for (let cur = S.pages[childId]; cur && cur.parentId; cur = S.pages[cur.parentId]) {
		if (cur.parentId === ancestorId) return true;
	}
	return false;
}

// Seite samt Unterseiten duplizieren (parallel); "(Kopie)" nur am Wurzel-Titel
async function duplicatePage(pageId, newParentId, newWsId) {
	const pg = S.pages[pageId];
	if (!pg) return null;
	const id = U.uid();
	const wsId = newWsId || pg.workspaceId;
	await STATE.dispatch("pageCreate", {
		id, title: pg.title + (newParentId === undefined ? " (Kopie)" : ""),
		parentId: newParentId !== undefined ? newParentId : pg.parentId,
		content: pg.content, workspaceId: wsId, icon: pg.icon, cover: pg.cover,
		coverImg: pg.coverImg, tags: pg.tags, kind: pg.kind || "notion",
	});
	await Promise.all(STATE.childrenOf(pg.id, pg.workspaceId).map((kid) => duplicatePage(kid.id, id, wsId)));
	return id;
}

// Anlegen zeigt IMMER den Typ-Dialog (Seite/Heft); Vorlagen darin als Zusatzoptionen
function newPageFlow(wsId, parentId) {
	S.pendingNewPage = { wsId, parentId };
	openTemplatePicker();
}

// 🃏-Bereich öffnen — läuft seit 23. Juli als eigener Tab "anki:main" über TABS.openPage
// (gleiche Mechanik wie nlm:main): view/sidebarMode, Tab-Leiste, Verlauf und Render
// kommen von dort — die Sonderbehandlung hier entfällt (KISS).
// == 🖐️ EINE Definition von „Touch“ und „Handy“ (28. Juli) ==
// Vorher fragten vier Stellen unterschiedlich: max-width 700px, max-width 768px,
// (pointer: coarse), (hover: none). iPadOS meldet im Desktop-Modus hover:hover/pointer:fine —
// das iPad galt je nach Stelle mal als Handy, mal als Maus-Gerät. Quelle der Wahrheit sind
// jetzt diese zwei Abfragen; das CSS liest das Ergebnis als body.is-touch / body.is-phone.
const MQ_PHONE = matchMedia("(max-width: 700px), (pointer: coarse) and (max-height: 500px)");
const MQ_TOUCH = matchMedia("(pointer: coarse), (hover: none)");
const PLATFORM = {
	phoneQuery: MQ_PHONE,
	isPhone: () => MQ_PHONE.matches,
	isTouch: () => MQ_TOUCH.matches || navigator.maxTouchPoints > 1,
	sync() {
		document.body.classList.toggle("is-touch", PLATFORM.isTouch());
		document.body.classList.toggle("is-phone", PLATFORM.isPhone());
	},
};
for (const q of [MQ_PHONE, MQ_TOUCH]) q.addEventListener("change", PLATFORM.sync);
PLATFORM.sync();

// ⛶ Karteikarten-Vollbild als Zustand statt als loser Body-Klasse — so weiß jede Ansicht,
// dass es an ist, und es lässt sich überall wieder verlassen (⛶-Taste, auch auf dem Handy).
function setAnkiZen(on) {
	S.ankiZen = !!on;
	document.body.classList.toggle("anki-zen", S.ankiZen);
}

function openAnki(tab, deck) {
	S.ankiTab = tab || "decks";
	if (deck !== undefined) S.ankiDeck = deck;
	S.reviewShowBack = false;
	blurActive();
	openPage("anki:main");
}

// Daily Note öffnen — Seite (und 📅-Sammelordner) bei Bedarf anlegen
async function openDailyNote(key) {
	let pg = STATE.activePages().find((p) => p.daily === key);
	if (!pg) {
		let root = STATE.activePages().find((p) => p.dailyRoot);
		if (!root) {
			const rid = U.uid();
			await STATE.dispatch("pageCreate", { id: rid, title: "Daily Notes", icon: "📅", workspaceId: "default", dailyRoot: true });
			root = S.pages[rid];
		}
		const id = U.uid();
		const title = new Date(key + "T12:00:00").toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
		await STATE.dispatch("pageCreate", { id, title, parentId: root.id, workspaceId: root.workspaceId || "default", icon: "📅", daily: key, content: "" });
		pg = S.pages[id];
	}
	if (pg) openPage(pg.id);
}

// Seitenverlauf öffnen (Versionen aus dem Event-Log rekonstruiert)
async function openHistory(pageId) {
	S.histVersions = await STATE.pageHistory(pageId);
	S.histIndex = S.histVersions.length - 1;
	S.histPageId = pageId;
	renderHistoryModal();
}

// FSRS-Bewertung als EIN Event (Browser-Inline + Review-Modal), grade immer im
// Payload (Tageslimits/Statistik). _ratingInFlight verhindert Doppel-Bewertung:
// zwei schnelle Klicks/Tasten lasen sonst beide den alten Stand → kaputte Intervalle
let _ratingInFlight = false;
async function rateAndReviewCard(cardId, grade, renderedReviewId) {
	if (_ratingInFlight) return null;
	const card = S.cards[cardId];
	if (!card) return null;
	_ratingInFlight = true;
	try {
		const wasNew = card.srs.state === "new";
		const wasLearning = card.srs.state === "learning" || card.srs.state === "relearning";
		const previous = (S.reviews || []).filter((item) => item && item.cardId === card.id && item.grade > 0)
			.sort((a, b) => String(b.t).localeCompare(String(a.t)))[0] || null;
		const subject = FACH.card(card);
		const reviewId = renderedReviewId || U.uid();
		const intervalDays = previous ? Math.max(0, (Date.now() - new Date(previous.t).getTime()) / 864e5) : null;
		const srs = SRS.rate(card.srs, grade);
		await STATE.dispatch("cardReview", {
			id: card.id, srs, grade, reviewId, deck: card.deck || "Standard", first: wasNew, learning: wasLearning,
			subject: subject.name, subjectSource: subject.source, dueAt: card.srs.due || null,
			previousReviewAt: previous?.t || null, intervalDays,
		});
		return card;
	} finally {
		_ratingInFlight = false;
	}
}

// Anki-Tastatur (docs.ankiweb.net/studying.html): Space/Enter → Antwort,
// Bewertet wird ausschließlich die in showStudyAnswer festgepinnte, sichtbare Karte.
// FIX: Der frühere Fallback auf dueNow[0] in gradeStudyCard konnte eine ANDERE Karte
// bewerten, wenn sich die Queue zwischen Aufdecken und Tastendruck ändert — genau der
// Fehler, den das Festpinnen verhindern soll. Nicht wieder einbauen.
// bei sichtbarer Antwort → Good(3); 1–4 → Again/Hard/Good/Easy
const inStudy = () => S.view === "anki" && S.ankiTab === "study";
// Bug-Fix („kommt noch“, 22. Juli): Die sichtbare Karte wird beim Aufdecken in
// S.reviewCardId festgepinnt. Vorher lasen Aufdecken UND Bewerten blind dueNow[0] —
// ändert sich die Queue dazwischen (Learning-Karte wird fällig), sprang die Ansicht
// auf eine andere Karte bzw. Space/Enter bewertete die falsche Karte.
function showStudyAnswer(cardId) {
	if (!inStudy() || S.reviewShowBack) return false;
	const due = STATE.studySnapshot(S.ankiDeck).dueNow;
	// Die tatsächlich angezeigte Karte gewinnt; dueNow[0] ist nur der Fallback für die Leertaste.
	// Vorher entschied dueNow[0] auch darüber, OB aufgedeckt wird — bei einer Queue-Änderung
	// zwischen Render und Klick konnte so die falsche Karte festgepinnt werden.
	const c = (cardId && due.find((x) => x.id === cardId)) || due[0];
	if (!c) return false;
	S.reviewCardId = c.id;
	S.reviewShowBack = true;
	renderMain();
	return true;
}
async function gradeStudyCard(grade) {
	if (!inStudy() || !S.reviewShowBack) return false;
	const c = S.cards[S.reviewCardId];
	if (!c) return false;
	await rateAndReviewCard(c.id, Math.max(1, Math.min(4, Number(grade) || 3)));
	S.reviewShowBack = false; // dispatch triggert den Render
	return true;
}
async function studySpaceOrEnter() {
	if (!inStudy()) return false;
	return S.reviewShowBack ? gradeStudyCard(3) : showStudyAnswer();
}

// Einheitlicher Einstieg für neue Chats (Sidebar, Home, „+ Tab“-Menü)
function startNewChat(opts = {}) {
	// Während die KI streamt, würde ein neuer Chat S.chat unter dem laufenden
	// Lauf austauschen — die Antwort landete im falschen Chat.
	if (S.aiBusy) { U.toast("Die KI antwortet noch — bitte kurz warten.", "error"); return; }
	saveCurrentChat();
	// FIX: Vorher wurde hier sofort eine LEERE Sitzung ins Event-Log geschrieben und auf alle
	// Geräte gesynct — jeder Klick auf „+ Neuer Chat“ hinterließ einen Geister-Chat in der
	// Liste. Die Sitzung entsteht jetzt mit der ersten Nachricht; CHATS.persist übernimmt
	// dabei genau diese vorgemerkte ID, damit der offene Tab weiter passt.
	const newId = U.uid();
	S.chat = [];
	S.currentChatId = newId;
	openPage("chat:" + newId, opts.newTab ? { newTab: true } : undefined);
}

// Neue Seite direkt in neuem Tab („+ → Neue Seite“ im Tab-Menü)
async function createPageInNewTab(wsId, parentId, tpl) {
	const id = U.uid();
	S.currentWorkspaceId = wsId || S.currentWorkspaceId;
	await STATE.dispatch("pageCreate", {
		id, title: tpl ? tpl.title : "Neue Seite", parentId: parentId || null,
		content: tpl ? tpl.content : "", icon: tpl ? tpl.icon : null,
		tags: tpl ? tpl.tags : [], workspaceId: S.currentWorkspaceId,
	});
	openPage(id, { newTab: true });
	focusPageTitle();
	return id;
}

// Chat-Composer: wächst mit dem Text; Senden nur bei Inhalt aktiv
function syncComposer(input) {
	if (!input) return;
	const full = input.id === "mainChatInput";
	const form = $(full ? "mainChatForm" : "chatForm");
	const submit = $(full ? "mainChatSubmit" : "chatSubmit");
	const max = full ? 260 : 210;
	input.style.height = "auto";
	input.style.height = Math.min(max, Math.max(30, input.scrollHeight)) + "px";
	input.style.overflowY = input.scrollHeight > max ? "auto" : "hidden";
	if (form) form.classList.toggle("has-text", !!input.value.trim());
	// ⏹ Während die KI antwortet, ist der Senden-Button ein Abbrechen-Button (immer aktiv)
	const busy = S.aiBusy && S.aiActiveChatType === (full ? "full" : "side");
	if (submit) {
		submit.disabled = busy ? false : !input.value.trim();
		submit.textContent = busy ? "⏹" : "↑";
		submit.title = busy ? "Antwort abbrechen" : "Senden";
		submit.classList.toggle("busy", busy);
	}
}

// Darstellungs-Buttons → handleAppearanceSelect(gruppe, wert) — statt 14 case-Zeilen
const APPEARANCE_BTN = {
	btnDensityComfortable: ["density", "comfortable"], btnDensityCompact: ["density", "compact"],
	btnMotionFull: ["motion", "full"], btnMotionReduced: ["motion", "reduced"],
	btnFontS: ["fontsize", "s"], btnFontM: ["fontsize", "m"], btnFontL: ["fontsize", "l"],
	btnLockOn: ["overlearn", "on"], btnLockOff: ["overlearn", "off"],
	btnConfOn: ["confidence", "on"], btnConfOff: ["confidence", "off"],
	btnTeleOn: ["telemetry", "on"], btnTeleOff: ["telemetry", "off"],
};

function wireEvents() {
	// dispatch() rendert bereits rAF-gebündelt → nach dispatch kein extra render();
	// reine UI-Navigation ohne dispatch rendert sofort.
	// „＋ Neue Zeile“ in der Datenbank-Ansicht — wird beim nächsten Sync als echte Notion-Zeile angelegt
	document.addEventListener("click", async (e) => {
		const btn = closestOf(e, "[data-dbnewrow]");
		if (!btn) return;
		const dbPg = S.pages[btn.dataset.dbnewrow];
		if (!dbPg) return;
		await STATE.dispatch("pageCreate", { id: U.uid(), title: "Neue Zeile", parentId: dbPg.id, workspaceId: dbPg.workspaceId || "default", props: {} });
	});

	// Links auf lokale Seiten abfangen (importierte UUIDs mit ODER ohne Bindestriche).
	// FIX „Seite springt nach oben“ (Teil 1): tote/leere #-Anker (href="#" oder
	// unbekannte IDs) lösten bisher die Browser-Hash-Navigation aus — und die
	// scrollt das Dokument an den Anfang. Interne Anker ohne echtes Ziel werden
	// deshalb IMMER abgefangen, nicht nur bekannte Seiten-IDs.
	document.addEventListener("click", (e) => {
		const a = closestOf(e, "a");
		if (!a) return;
		const href = a.getAttribute("href") || "";
		const rawId = href.replace(/^(#|\/)/, "");
		const id = S.pages[rawId] ? rawId : rawId.replace(/-/g, "");
		if (S.pages[id]) {
			e.preventDefault();
			openPage(id);
		} else if (href.startsWith("#")) {
			e.preventDefault();
		}
	});

	// Home: Einzelklick = Dateibaum, Doppelklick = Home-Übersicht
	document.addEventListener("dblclick", (e) => {
		if (!closestOf(e, "#btnHome")) return;
		e.preventDefault();
		openHomeOverview();
	});

	// ＋ Neu-Menü der Karteikarten-Kopfzeile (render-anki.js, <details class="anki-new">):
	// Auf-/Zuklappen macht der Browser nativ — hier nur schließen bei Außenklick oder
	// nach einer gewählten Menü-Aktion (Neue Karte / Neuer Stapel / Import / Export).
	document.addEventListener("click", (e) => {
		if (!(e.target instanceof Element)) return;
		document.querySelectorAll("details.anki-new[open]").forEach((d) => {
			if (!d.contains(e.target) || e.target.closest(".anki-new-menu")) d.removeAttribute("open");
		});
	});

	// FIX: Live-„Denkt nach…“-Box auf pointerdown — Rebuilds zwischen Mousedown/-up
	// fraßen den click (render.js patcht zusätzlich in-place, das hier ist das Netz)
	document.addEventListener("pointerdown", (e) => {
		if (e.button !== undefined && e.button !== 0) return;
		const t = closestOf(e, "#btnThinkLive");
		if (!t) return;
		e.preventDefault();
		CHAT_FULLSCREEN.handleReasoningToggle(t);
	});

	// Klicks (Delegation) — alle interaktiven Elemente sind explizit gelistet,
	// damit sie unabhängig vom Tag (button/span) zuverlässig ausgelöst werden.
	const CLICKABLE = "[data-page],[data-grade],[data-set],[data-chat],[data-sidechat],[data-newchat],[data-newpage]," +
		"[data-collapse],[data-crumbws],[data-tabopen],[data-tabclose],[data-undo],[data-difftoggle]," +
		"[data-reasoningtoggle],[data-iconset],[data-coverset],[data-coverpick],[data-coverremove]," +
		"[data-iconpick],[data-filedownload],[data-modelset],[data-chatdel],[data-chatsel],[data-chatselall],[data-chatselnone],[data-chatdelsel],[data-editmsg]," +
		"[data-answerq],[data-refinetoggle],[data-refine],[data-inserttoggle],[data-insertmark],[data-libview]," +
		"[data-libws],[data-libinto],[data-libroot]," +
		"[data-ankitab],[data-ankistudy],[data-ankigrade],[data-ankishowback],[data-ankiwaitrefresh],[data-ankisort],[data-ankimore],[data-ankideckfilter],[data-ankizen]," +
		"[data-ankisuspend],[data-ankidel],[data-ankiedit],[data-ankinewcard],[data-cardeditorsave]," +
		"[data-dailyday],[data-dailynav],[data-zipws]," +
		"[data-deckopen],[data-decknew],[data-decksub],[data-deckrename],[data-deckdel],[data-deckmenu],[data-deckduplicate],[data-libnew]," +
		"[data-pagemenu],[data-pagerename],[data-pageduplicate],[data-pagetrash],[data-pagerestore],[data-pagepurge],[data-cardrestore],[data-cardpurge],[data-deckrestore],[data-deckpurge]," +
		"[data-pagetemplate],[data-tplblank],[data-tplheft],[data-tpluse],[data-libsort],[data-histversion],[data-renamename],[data-deckrenamename]," +
		"[data-conflictopen],[data-conflictnav],[data-conflictresolve],[data-conflictpage],button";

	document.addEventListener("click", async (e) => {
		// Stapel-⋯ ZUERST, sonst zerstört closeOutside das Menü im selben Klick
		const deckMenuBtn = closestOf(e, "[data-deckmenu]");
		if (deckMenuBtn) {
			e.preventDefault();
			e.stopPropagation();
			const name = deckMenuBtn.dataset.deckmenu;
			const open = S.deckMenuOpenName !== name;
			S.pageMenuOpenId = null;
			S.topMenu = null;
			S.modelMenuOpen = false;
			S.deckMenuOpenName = open ? name : null;
			renderSidebar(); // positioniert offenes Menü in render.js
			return;
		}
		const deckAction = closestOf(e, "[data-deckdel],[data-deckrename],[data-deckduplicate]");
		if (deckAction) {
			e.preventDefault();
			e.stopPropagation();
			const name = deckAction.dataset.deckdel || deckAction.dataset.deckrename || deckAction.dataset.deckduplicate;
			S.deckMenuOpenName = null;
			renderSidebar();
			if (deckAction.hasAttribute("data-deckrename")) {
				S.renamingDeck = name;
				renderSidebar();
				const inp = document.querySelector('[data-deckrenamename="' + CSS.escape(name) + '"]');
				if (inp) { inp.focus(); inp.select(); }
				return;
			}
			if (deckAction.hasAttribute("data-deckduplicate")) {
				await STATE.dispatch("deckDuplicate", { name });
				return;
			}
			// data-deckdel
			const n = ankiCardsOf(name).length;
			const msg = 'Stapel „' + name + '“ in den Papierkorb legen?' +
				(n ? " " + n + " Karte(n) (inkl. Unterstapel) wandern mit und sind wiederherstellbar." : "");
			if (await U.confirm(msg, { title: "Stapel löschen", ok: "In Papierkorb", danger: true })) {
				await STATE.dispatch("deckTrash", { name });
				if (S.ankiDeck && inDeck(S.ankiDeck, name)) S.ankiDeck = null;
				U.toast("Stapel im Papierkorb.", "success");
			} else {
				render();
			}
			return;
		}

		// Topbar-Menüs (Teilen/⋯) VOR closeOutside; blurActive nötig, weil renderMain
		// bei geschütztem Fokus (Editor/Titel) sonst nie neu zeichnet
		const topMenuBtn = closestOf(e, "[data-sharemenu],[data-morepagemenu]");
		if (topMenuBtn) {
			e.preventDefault();
			e.stopPropagation();
			const which = topMenuBtn.hasAttribute("data-sharemenu") ? "share" : "more";
			const open = S.topMenu !== which;
			const changed = POPOVERS.closeAll("top");
			POPOVERS.blurActive();
			S.topMenu = open ? which : null;
			if (changed.sidebar) renderSidebar();
			renderMain();
			return;
		}

		const t = closestOf(e, CLICKABLE);
		// Eine Außenklick-Logik für alle Popovers (Anhang, Modell, Seite, Stapel, Topbar).
		const closedPopovers = POPOVERS.closeOutside(e.target);
		if (closedPopovers.model) renderModelMenu();
		if (closedPopovers.sidebar) renderSidebar();
		if (closedPopovers.main) renderMain();
		if (!t) return;

		// Darstellung: dieselben zentralen Optionen steuern alle Komponenten über CSS-Tokens.
		if (t.dataset.accent) { SETTINGS.handleAppearanceSelect("accent", t.dataset.accent); return; }
		if (t.dataset.dashtoggle) { SETTINGS.handleDashboardToggle(t.dataset.dashtoggle); return; }
		if (t.dataset.dashmove) {
			const [id, direction] = t.dataset.dashmove.split(":");
			SETTINGS.handleDashboardMove(id, Number(direction));
			return;
		}
		if (t.dataset.dashadd) { SETTINGS.handleDashboardAdd(); return; }
		if (t.dataset.removeattachment) { CHAT_FULLSCREEN.handleRemoveAttachment(); return; }
		// Seitenkontext abwählen — wie ein Anhang entfernen, gilt nur für die aktuelle Seite
		if (t.dataset.removecontext) { S.sideContextOff = S.currentPageId; RENDER.renderChat(); return; }
		if (t.id === "btnVoice") { VOICE.toggle("side"); return; }
		if (t.id === "btnVoiceFull") { VOICE.toggle("full"); return; }

		// Chat umbenennen (Sidebar-Chatliste) — gleicher Dialog wie bei Stapeln
		if (t.dataset.chatrename) {
			const list = CHATS.load();
			const s = list.find((x) => x.id === t.dataset.chatrename);
			if (!s) return;
			openPromptDialog("Chat umbenennen", (name) => {
				s.title = name;
				CHATS.save(list);
				render();
			}, s.title || "");
			return;
		}
		// Schnellstart-Chip im leeren Chat: Prompt-Anfang einsetzen, Cursor ans Ende
		if (t.dataset.chatsuggest) {
			const inp = $("mainChatInput") || $("chatInput");
			if (inp) { inp.value = t.dataset.chatsuggest; inp.focus(); inp.dispatchEvent(new Event("input", { bubbles: true })); }
			return;
		}
		// Codeblock kopieren (Knopf wird in U.highlightCode eingefügt)
		if (t.dataset.codecopy) {
			const pre = t.closest("pre");
			const code = pre && pre.querySelector("code");
			if (code) navigator.clipboard.writeText(code.innerText.replace(/\s*$/, "\n")).then(
				() => U.toast("Code kopiert.", "success"),
				() => U.toast("Zwischenablage blockiert.", "error"));
			return;
		}
		// KI-Antwort in die Zwischenablage kopieren
		if (t.dataset.copymsg) {
			const m = S.chat.find((x) => x.mid === t.dataset.copymsg) || S.sideChat.find((x) => x.mid === t.dataset.copymsg);
			if (m) navigator.clipboard.writeText(m.content || "").then(
				() => U.toast("Antwort kopiert.", "success"),
				() => U.toast("Zwischenablage blockiert.", "error"));
			return;
		}
		// Review-Overlay: Karte aussetzen und direkt mit der nächsten fälligen weitermachen
		if (t.dataset.reviewsuspend) {
			await STATE.dispatch("cardUpdate", { id: t.dataset.reviewsuspend, patch: { suspended: true } });
			S.reviewShowBack = false;
			openReview();
			return;
		}
		// Bibliothek: Smart-Sammlungen (Alle/Favoriten/PDFs/Vorlagen/ohne Tag)
		if (t.dataset.libsmart) {
			const v = t.dataset.libsmart;
			S.libSmart = v === "all" || S.libSmart === v ? null : v;
			renderMain();
			return;
		}

		// Sync-Konflikt-Dialog (Popup + Homescreen-Banner/Widget)
		if (t.dataset.conflictopen != null) {
			RENDER.openConflictResolver(t.dataset.conflictopen);
			return;
		}
		if (t.dataset.conflictnav) {
			const cur = S.conflictResolveIndex || 0;
			RENDER.openConflictResolver(cur + Number(t.dataset.conflictnav));
			return;
		}
		if (t.dataset.conflictresolve) {
			await RENDER.resolveConflict(t.dataset.conflictresolve);
			return;
		}
		if (t.dataset.conflictpage) {
			closeOverlay();
			openPage(t.dataset.conflictpage);
			return;
		}

		// Schnellaktionen des Home-Dashboards
		if (t.dataset.homeaction) {
			switch (t.dataset.homeaction) {
				case "search": SEARCH.openPalette(); break;
				case "newpage": await newPageFlow(S.currentWorkspaceId || Object.keys(S.workspaces)[0] || "default", null); break;
				case "newchat": startNewChat(); break;
				case "chats": S.sidebarMode = "chats"; render(); break;
				case "library": S.view = "library"; S.libFolder = null; render(); break;
				case "cards": openAnki("study", null); break;
				case "daily": await openDailyNote(localDayKey(new Date())); break;
				case "backup": await SETTINGS.handleBackupNow(); break;
				case "conflicts": RENDER.openConflictResolver(0); break;
			}
			return;
		}

		// Ein-/Ausklappen — erst nach Persistenz zeichnen (kein Aufblitzen des Defaults)
		if (t.dataset.collapse) {
			const key = t.dataset.collapse;
			await COLLAPSE.toggle(key);
			if (S.view === "library") renderMain();
			else if (S.view === "anki" && key.startsWith("deck:")) render();
			else renderSidebar();
			return;
		}

		// Icon-/Cover-Auswahl (auch aus dem Topbar-⋯-Menü erreichbar — Menü vorher schließen,
		// sonst bleibt es hinter dem Auswahl-Dialog offen)
		if (t.dataset.iconpick) { closeTopMenu(); openIconPicker(); return; }
		if (t.dataset.coverpick) { closeTopMenu(); openCoverPicker(); return; }
		if (t.dataset.coverremove) {
			if (S.currentPageId) await STATE.dispatch("pageUpdate", { id: S.currentPageId, patch: { cover: null, coverImg: null } });
			return;
		}
		if (t.hasAttribute("data-iconset")) {
			if (S.currentPageId) await STATE.dispatch("pageUpdate", { id: S.currentPageId, patch: { icon: t.dataset.iconset || null } });
			closeOverlay();
			return;
		}
		if (t.hasAttribute("data-coverset")) {
			if (S.currentPageId) await STATE.dispatch("pageUpdate", { id: S.currentPageId, patch: { cover: t.dataset.coverset || null, coverImg: null } });
			closeOverlay();
			return;
		}

		// Breadcrumb: Workspace-Segment öffnet Home für diesen Workspace
		if (t.dataset.crumbws) {
			const pg = S.currentPageId ? S.pages[S.currentPageId] : null;
			if (pg) S.currentWorkspaceId = pg.workspaceId || "default";
			S.view = "home";
			render();
			return;
		}

		// Tab-Leiste: Tab öffnen / schließen / neuer Tab (Notion-artig: + = neuer Tab)
		if (t.dataset.tabopen) { openPage(t.dataset.tabopen, { skipHistory: false }); return; }
		if (t.dataset.tabclose) { closeTab(t.dataset.tabclose); return; }
		if (t.dataset.tabnew != null || t.id === "btnTabNew") {
			// Plus: Notion-artiges Menü „In neuem Tab öffnen…“ (Suche + Neue Seite / Chat)
			SEARCH.openNewTabMenu();
			return;
		}

		// Thinking-Prozess (finalisiert) ausklappen. Die LIVE-Box läuft über den
		// pointerdown-Listener oben — hier nur abfangen, damit nichts doppelt feuert.
		if (t.id === "btnThinkLive") return;
		if (t.dataset.reasoningtoggle) {
			CHAT_FULLSCREEN.handleReasoningToggle(t);
			return;
		}

		// Edit-Karte: Diff ein-/ausblenden, Rückgängig machen
		if (t.dataset.difftoggle) {
			CHAT_FULLSCREEN.handleDiffCardToggle(t);
			return;
		}
		if (t.dataset.undo) {
			await CHAT_FULLSCREEN.handleUndo(t);
			return;
		}

		// Datei-Chip im Chat: geklebten Text als .txt herunterladen
		if (t.dataset.filedownload) {
			CHAT_FULLSCREEN.handleFileDownload(t);
			return;
		}

		// Modell-Menü: Notion-artige Untermenüs für Modell und Thinking-Stufe.
		if (t.dataset.modelsubmenu) {
			S.modelMenuSection = t.dataset.modelsubmenu;
			renderModelMenu();
			if (S.modelMenuSection === "thinking") {
				AI.detectThinkingCapabilities().then(renderModelMenu, renderModelMenu);
			}
			return;
		}
		if (t.dataset.thinkingprobe) {
			const store = S.thinkingCapabilities || {};
			const pr = (S.settings.aiProviders || []).find((item) => item.id === S.settings.aiProviderId);
			const key = [S.settings.aiProviderId || "", String((pr && pr.base) || "").replace(/\/+$/, ""), S.settings.aiModel || ""].join("::");
			delete store[key];
			S.thinkingCapabilities = store;
			renderModelMenu();
			AI.detectThinkingCapabilities().then(renderModelMenu, renderModelMenu);
			return;
		}
		if (t.dataset.modelmenuback) {
			S.modelMenuSection = "root";
			renderModelMenu();
			return;
		}
		if (t.dataset.thinkingenabled !== undefined) {
			await STATE.dispatch("settingsSet", { thinkingEnabled: t.dataset.thinkingenabled === "1" });
			S.modelMenuSection = "root";
			renderModelMenu();
			return;
		}

		// Modell wählen (Chat-Dropdown ODER Einstellungen → KI) — Wert "quelleId::modell"
		if (t.dataset.modelset) {
			const raw = t.dataset.modelset;
			const sep = raw.indexOf("::");
			const providerId = sep === -1 ? S.settings.aiProviderId : raw.slice(0, sep);
			const model = sep === -1 ? raw : raw.slice(sep + 2);
			await STATE.dispatch("settingsSet", { aiProviderId: providerId, aiModel: model });
			S.modelMenuOpen = false;
			renderModelBar();
			// Auswahl in offenen KI-Einstellungen sofort als aktiv markieren
			if (typeof SETTINGS.paintSettingsModels === "function") SETTINGS.paintSettingsModels();
			// Jede Auswahl startet die modellbezogene Probe sofort. Das Thinking-
			// Menü zeigt später ausschließlich die bestätigten Stufen dieses Modells.
			AI.detectThinkingCapabilities().then(renderModelBar, renderModelBar);
			SETTINGS.checkAI();
			return;
		}

		// KI-Einstellungen: horizontaler Unter-Tab (Modelle | Quellen | Mehr)
		if (t.dataset.aitab) {
			SETTINGS.switchKiTab(t.dataset.aitab);
			return;
		}

		// Verbindung EINER Quelle testen (Einstellungen → KI) — nutzt die aktuellen Feldwerte
		if (t.dataset.provtest) {
			await SETTINGS.handleProviderTest(t);
			return;
		}
		// Vorgeschlagene Server-URL übernehmen (z. B. fehlendes /v1) und direkt erneut testen
		if (t.dataset.provfixbase) {
			const row = document.querySelector('[data-provrow="' + t.dataset.provfixbase + '"]');
			const baseInput = row && row.querySelector("[data-provbase]");
			if (baseInput) baseInput.value = t.dataset.base || "";
			await SETTINGS.testProviderRow(t.dataset.provfixbase);
			return;
		}

		// Quelle entfernen (Einstellungen → KI)
		if (t.dataset.provdel) {
			// FIX: erst die aktuellen (ungespeicherten) Feldwerte ALLER Zeilen einsammeln —
			// vorher verwarf das Löschen einer Quelle die offenen Eingaben der anderen.
			const rows = Array.from(document.querySelectorAll("[data-provrow]"));
			const fromDom = rows.map((row) => {
				const val = (sel) => { const el = row.querySelector(sel); return el ? el.value.trim() : ""; };
				return { id: row.dataset.provrow, name: val("[data-provname]") || row.dataset.provrow, base: val("[data-provbase]"), key: val("[data-provkey]") };
			});
			const providers = (fromDom.length ? fromDom : (S.settings.aiProviders || [])).filter((p) => p.id !== t.dataset.provdel);
			const patch = { aiProviders: providers };
			// FIX: war die gelöschte Quelle im Chat aktiv, zeigten aiProviderId/aiModel ins Leere
			// (z. B. aktive Quelle „google" + Modell „local-model" → garantiert keine Verbindung).
			if (S.settings.aiProviderId === t.dataset.provdel) {
				patch.aiProviderId = providers[0] ? providers[0].id : "";
				patch.aiModel = "";
			}
			// FIX: dito für die Embedding-Quelle — zurück auf „automatisch".
			if (S.settings.embedProviderId === t.dataset.provdel) patch.embedProviderId = "";
			await STATE.dispatch("settingsSet", patch);
			S.settingsKiTab = "sources";
			SETTINGS.openSettings("ki");
			return;
		}

		// Quelle für ein eigenes Modell wählen (Chips im Modell-Dropdown) — Eingabe bleibt erhalten
		if (t.dataset.customprov) {
			const keep = ($("customModelInput") || {}).value || "";
			S.customModelProviderPick = t.dataset.customprov;
			renderModelMenu();
			const inp2 = $("customModelInput");
			if (inp2) { inp2.value = keep; inp2.focus(); }
			return;
		}

		// Eigenes Modell für die gewählte Quelle setzen (unten im Modell-Dropdown)
		if (t.dataset.modelcustomapply) {
			const inp = $("customModelInput");
			const providerId = S.customModelProviderPick || S.settings.aiProviderId;
			const model = inp ? inp.value.trim() : "";
			if (model) {
				await STATE.dispatch("settingsSet", { aiProviderId: providerId, aiModel: model });
				S.modelMenuOpen = false;
				renderModelBar();
				AI.detectThinkingCapabilities().then(renderModelBar, renderModelBar);
				SETTINGS.checkAI();
			}
			return;
		}

		// Chat-Mehrfachauswahl (Kästchen je Zeile + Kopfzeile der Chat-Liste)
		if (t.dataset.chatsel) { CHAT_FULLSCREEN.handleChatSelectToggle(t); return; }
		if (t.dataset.chatselall) { CHAT_FULLSCREEN.handleChatSelectAll(); return; }
		if (t.dataset.chatselnone) { CHAT_FULLSCREEN.handleChatSelectNone(); return; }
		if (t.dataset.chatdelsel) { await CHAT_FULLSCREEN.handleDeleteSelectedChats(); return; }

		// KI-Chat aus der Liste löschen
		if (t.dataset.chatdel) {
			await CHAT_FULLSCREEN.handleDeleteChat(t);
			return;
		}

		// Nutzer-Nachricht nachträglich bearbeiten
		if (t.dataset.editmsg) {
			CHAT_FULLSCREEN.handleEditUserMessage(t);
			return;
		}

		// Rückfrage-Karte: Option anklicken löst den wartenden Agent-Loop auf
		if (t.dataset.answerq) {
			CHAT_FULLSCREEN.handleAnswerQuestion(t);
			return;
		}

		// KI-Status-Pille im Chat-Header / Settings: erneut pingen; Offline → Einstellungen
		if (t.dataset.aistatus || t.id === "btnRecheckAI") {
			SETTINGS.checkAI();
			if (t.dataset.aistatus && S.aiOnline === false) SETTINGS.openSettings("ki");
			return;
		}

		// "✦ Anpassen"-Menü (länger/kürzer) an einer KI-Antwort ein-/ausblenden
		if (t.dataset.refinetoggle) {
			CHAT_FULLSCREEN.handleRefineToggle(t);
			return;
		}
		if (t.dataset.refine) {
			await CHAT_FULLSCREEN.handleRefineSelect(t);
			return;
		}

		// Bibliothek: Kachel-/Tabellen-Ansicht umschalten
		if (t.dataset.libview) {
			LIBRARY.handleLibView(t.dataset.libview);
			return;
		}

		// Bibliothek (Kacheln): Ordner-Navigation (Wurzel, Workspace, in Unterseiten)
		if (t.dataset.libroot || t.dataset.libws || t.dataset.libinto) {
			LIBRARY.handleLibFolderNavigation(t);
			return;
		}

		// Bibliothek: „＋ Neue Seite“-Kachel legt die Seite direkt im aktuellen Ordner an
		if (t.dataset.libnew) {
			await LIBRARY.handleLibNewPage();
			return;
		}

		// Bibliothek: Spaltenüberschrift klicken = sortieren (erneut klicken = Richtung wechseln)
		if (t.dataset.libsort) {
			LIBRARY.handleLibSort(t.dataset.libsort);
			return;
		}

		// ---------- Anki-Bereich: Tabs, Lernen, Bewerten, Sortieren, Karten-Verwaltung ----------
		// ⛶ Vollbild (23. Juli): Body-Klasse blendet Seitenleiste + Tab-Leiste aus — rein per
		// CSS auf die sichtbare Anki-Ansicht begrenzt (styles.css, :has), erneut klicken = zurück.
		if (t.dataset.ankizen) { setAnkiZen(!S.ankiZen); return; }
		if (t.dataset.ankitab) { S.ankiTab = t.dataset.ankitab; S.reviewShowBack = false; renderMain(); return; }
		if (t.hasAttribute("data-ankistudy")) {
			S.ankiDeck = t.dataset.ankistudy || null;
			// Interleaved Practice: nur der „Gemischt lernen“-Button aktiviert den Misch-Modus
			S.ankiMix = t.hasAttribute("data-ankimix");
			// 🧑‍🏫 Feynman-Modus als eigene Lern-Option aus der Stapel-Übersicht
			S.ankiFeyn = t.hasAttribute("data-ankifeyn");
			S.ankiTab = "study";
			S.reviewShowBack = false;
			// Home v4: der Stapel-Überblick startet das Lernen direkt von der Homeseite —
			// dafür ggf. in die Anki-Ansicht wechseln (seit 23. Juli als eigener Tab anki:main).
			if (S.view !== "anki") openPage("anki:main");
			else renderMain();
			return;
		}
		// DRY: Klick auf „Antwort zeigen“ nutzt denselben Aufdeck-Pfad wie die
		// Leertaste — inkl. Festpinnen der sichtbaren Karte (Bug-Fix, s. oben).
		if (t.dataset.ankishowback) { showStudyAnswer(t.dataset.card); return; }
		if (t.dataset.ankiwaitrefresh) { S.reviewShowBack = false; renderMain(); return; }
		if (t.dataset.ankigrade) {
			await rateAndReviewCard(t.dataset.card, Number(t.dataset.ankigrade), t.dataset.reviewId);
			S.reviewShowBack = false;
			return;
		}
		if (t.dataset.ankimore) {
			S.ankiBrowserLimit = (S.ankiBrowserLimit || 200) + 500;
			renderMain();
			return;
		}
		if (t.dataset.ankisort) {
			if (S.ankiSort === t.dataset.ankisort) S.ankiSortDir = -(S.ankiSortDir || 1);
			else { S.ankiSort = t.dataset.ankisort; S.ankiSortDir = 1; }
			renderMain();
			return;
		}
		if (t.hasAttribute("data-ankideckfilter")) {
			S.ankiDeck = t.dataset.ankideckfilter || null;
			S.ankiTab = "browser";
			renderMain();
			return;
		}
		if (t.dataset.ankisuspend) {
			const c = S.cards[t.dataset.ankisuspend];
			if (c) await STATE.dispatch("cardUpdate", { id: c.id, patch: { suspended: !c.suspended } });
			return;
		}
		if (t.dataset.ankidel) {
			// Soft-Delete → Papierkorb (wiederherstellbar)
			if (await U.confirm("Diese Karte in den Papierkorb legen?", { title: "Karte löschen", ok: "In Papierkorb", danger: true })) {
				await STATE.dispatch("cardTrash", { id: t.dataset.ankidel });
				U.toast("Karte im Papierkorb.", "success");
			}
			return;
		}
		if (t.dataset.ankiedit) { openCardEditor(t.dataset.ankiedit); return; }
		if (t.dataset.ankinewcard) { openCardEditor(null); return; }
		if (t.dataset.cardeditorsave) {
			const front = ($("cardFront") || {}).value || "";
			const back = ($("cardBack") || {}).value || "";
			// Stapel aus Select bzw. „Neuer Stapel“-Feld (kein freies datalist mehr)
			const deck = (RENDER_ANKI.readCardEditorDeck && RENDER_ANKI.readCardEditorDeck()) || "Standard";
			if (!front.trim()) { U.toast("Die Vorderseite darf nicht leer sein.", "error"); return; }
			if (deck === "__new__" || !String(deck).trim()) { U.toast("Bitte einen Stapel wählen oder einen neuen Namen eingeben.", "error"); return; }
			// Neuen Stapel-Namen im Baum anlegen, falls noch unbekannt
			if (deck !== "Standard" && !(S.decks || {})[deck] && !Object.values(S.cards).some((c) => (c.deck || "") === deck)) {
				await STATE.dispatch("deckCreate", { name: deck });
			}
			if (t.dataset.cardeditorsave === "new") {
				await STATE.dispatch("cardCreate", { id: U.uid(), front, back, deck });
			} else {
				await STATE.dispatch("cardUpdate", { id: t.dataset.cardeditorsave, patch: { front, back, deck } });
			}
			// Bug-Fix (Karteikarten): Nicht mitten im Lernen den aktiven Stapel
			// wechseln — ✎ Bearbeiten im Lernmodus kappte sonst die laufende
			// Session auf den Stapel der gerade bearbeiteten Karte.
			if (S.ankiTab !== "study") S.ankiDeck = deck === "Standard" ? null : deck;
			closeOverlay();
			return;
		}

		// ---------- Stapel-Baum: Stapel öffnen (nicht bei ⋯ / + / Menü) ----------
		if (t.hasAttribute("data-deckopen") && !closestOf(e, ".row-add, .page-menu, input, button")) {
			S.ankiDeck = t.dataset.deckopen || null;
			S.deckMenuOpenName = null;
			if (S.ankiTab === "study") S.ankiTab = "decks";
			render();
			return;
		}
		if (t.dataset.decknew || t.dataset.decksub) {
			const parent = t.dataset.decksub || "";
			openPromptDialog(parent ? 'Name des Unterstapels von „' + parent.split("::").pop() + '“' : "Name des neuen Stapels", async (name) => {
				const full = (parent ? parent + "::" : "") + name.replace(/::/g, ":");
				await STATE.dispatch("deckCreate", { name: full });
				S.ankiDeck = full;
			});
			return;
		}

		// ---------- Daily Notes: Tag anklicken / Monat blättern ----------
		if (t.dataset.dailyday) { await openDailyNote(t.dataset.dailyday); return; }
		if (t.dataset.dailynav) {
			const base = S.dailyMonth ? new Date(S.dailyMonth + "-01T12:00:00") : new Date();
			const d = new Date(base.getFullYear(), base.getMonth() + Number(t.dataset.dailynav), 1);
			S.dailyMonth = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
			renderMain();
			return;
		}

		// Workspace als Markdown-ZIP exportieren (Einstellungen → Backup)
		if (t.dataset.zipws) { LIBRARY.exportWorkspaceZip(t.dataset.zipws); return; }

		// ⋯-Menü: Seite als Vorlage markieren / Markierung entfernen
		if (t.dataset.pagetemplate) {
			S.pageMenuOpenId = null;
			S.topMenu = null; // auch im Topbar-⋯-Menü — sonst bleibt es nach der Aktion offen
			const pg = S.pages[t.dataset.pagetemplate];
			if (pg) await STATE.dispatch("pageUpdate", { id: pg.id, patch: { isTemplate: !pg.isTemplate } });
			return;
		}

		// Anlege-Dialog: Notion-Seite, GoodNotes-Heft oder Vorlage als Startinhalt
		if (t.dataset.tplblank || t.dataset.tplheft) {
			const kind = t.dataset.tplheft ? "heft" : "notion";
			const p = S.pendingNewPage;
			S.pendingNewPage = null;
			closeOverlay();
			if (p) {
				const id = U.uid();
				await STATE.dispatch("pageCreate", {
					id, title: kind === "heft" ? "Neues Heft" : "Neue Seite", parentId: p.parentId || null, content: "",
					icon: kind === "heft" ? "📓" : null, tags: [], workspaceId: p.wsId || S.currentWorkspaceId, kind,
				});
				openPage(id, p.newTab ? { newTab: true } : undefined);
				focusPageTitle();
			}
			return;
		}
		if (t.dataset.tpluse) {
			const p = S.pendingNewPage;
			const tpl = S.pages[t.dataset.tpluse];
			S.pendingNewPage = null;
			closeOverlay();
			if (p && tpl) {
				const id = U.uid();
				await STATE.dispatch("pageCreate", {
					id, title: tpl.title, parentId: p.parentId || null, content: tpl.content || "",
					icon: tpl.icon || null, tags: tpl.tags || [], workspaceId: p.wsId || S.currentWorkspaceId,
					kind: tpl.kind || "notion",
				});
				openPage(id, p.newTab ? { newTab: true } : undefined);
			}
			return;
		}

		// Seitenverlauf: Version in der Liste auswählen → Vorschau aktualisieren
		if (t.dataset.histversion) {
			S.histIndex = Number(t.dataset.histversion);
			renderHistoryModal();
			return;
		}

		if (t.dataset.set) { SETTINGS.openSettings(t.dataset.set); return; }

		// Neue Seite in einem Workspace (+ neben dem Workspace-Namen)
		if (t.dataset.newpage) { await newPageFlow(t.dataset.newpage, null); return; }

		// Unterseite anlegen (+ neben einer Seiten-Zeile)
		if (t.dataset.addchild) {
			const parent = S.pages[t.dataset.addchild];
			await newPageFlow(parent ? parent.workspaceId : S.currentWorkspaceId, t.dataset.addchild);
			return;
		}

		// ⋯-Menü je Seite (wie in Notion): öffnen/schließen, Duplizieren, Löschen (→ Papierkorb)
		if (t.dataset.pagemenu) {
			const id = t.dataset.pagemenu;
			S.pageMenuOpenId = S.pageMenuOpenId === id ? null : id;
			renderSidebar();
			if (S.view === "library") renderMain();
			// Menü fest (fixed) über dem Button positionieren, damit es nicht vom
			// Scroll-Container der Seitenleiste (#tree, overflow:auto) abgeschnitten wird.
			if (S.pageMenuOpenId) POPOVERS.position(
				document.querySelector('[data-pagemenu="' + id + '"]'),
				// :not(.top-menu): nie versehentlich das Topbar-⋯-Menü greifen
				document.querySelector(".page-menu:not(.top-menu)"), { align: "end", gap: 2 });
			return;
		}
		// ⋯-Menü: Seite umbenennen — wie bei Stapeln per Inline-Textfeld direkt in der Zeile.
		if (t.dataset.pagefav) {
			S.pageMenuOpenId = null;
			const pg = S.pages[t.dataset.pagefav];
			if (pg) await STATE.dispatch("pageUpdate", { id: pg.id, patch: { favorite: !pg.favorite } });
			return;
		}
		if (t.dataset.pagemove) {
			S.pageMenuOpenId = null;
			closeTopMenu(); // sonst bleibt das Topbar-⋯-Menü hinter dem Dialog offen
			renderSidebar();
			openMoveDialog(t.dataset.pagemove);
			return;
		}
		if (t.dataset.movetarget && S.movePageId) {
			const moveId = S.movePageId;
			const val = t.dataset.movetarget;
			const parentId = val.startsWith("pg:") ? val.slice(3) : null;
			const wsId = val.startsWith("ws:") ? val.slice(3) : (S.pages[parentId] || {}).workspaceId;
			await STATE.dispatch("pageMove", { id: moveId, parentId });
			// PERF: Workspace der ganzen Unterstruktur mitziehen, aber über den EINEN Index aus
			// descendantsOf statt pro Ebene alle Seiten zu scannen (war O(n²) — Zwilling des
			// oben in descendantsOf bereits behobenen Falls; Verschieben hakte in großen Bäumen).
			if (wsId) {
				for (const pid of descendantsOf(moveId)) {
					const p = S.pages[pid];
					if (p && p.workspaceId !== wsId) await STATE.dispatch("pageUpdate", { id: pid, patch: { workspaceId: wsId } });
				}
			}
			S.movePageId = null;
			closeOverlay();
			return;
		}
		if (t.dataset.tagfilter) {
			S.libTag = S.libTag === t.dataset.tagfilter ? null : t.dataset.tagfilter;
			renderMain();
			return;
		}
		if (t.dataset.tagrename) {
			const oldTag = t.dataset.tagrename;
			openPromptDialog('Tag „' + oldTag + '“ umbenennen', async (newTag) => {
				for (const p of STATE.activePages()) {
					if ((p.tags || []).includes(oldTag)) {
						const tags = [...new Set(p.tags.map((x) => (x === oldTag ? newTag : x)))];
						await STATE.dispatch("pageUpdate", { id: p.id, patch: { tags } });
					}
				}
				if (S.libTag === oldTag) S.libTag = newTag;
				renderMain();
			}, oldTag);
			return;
		}
		if (t.dataset.pagerename) {
			const id = t.dataset.pagerename;
			S.pageMenuOpenId = null;
			S.renamingPageId = id;
			renderSidebar();
			const inp = document.querySelector('[data-renamename="' + CSS.escape(id) + '"]');
			if (inp) { inp.focus(); inp.select(); }
			return;
		}
		if (t.dataset.pageduplicate) {
			S.pageMenuOpenId = null;
			S.topMenu = null; // FIX: Duplizieren aus dem Topbar-⋯-Menü ließ das Menü auf der neuen Seite offen
			const newId = await duplicatePage(t.dataset.pageduplicate);
			if (newId) openPage(newId);
			else render();
			return;
		}
		if (t.dataset.pagetrash) {
			S.pageMenuOpenId = null;
			S.topMenu = null; // Löschen ist auch im Topbar-⋯-Menü — sonst bleibt es offen
			const id = t.dataset.pagetrash;
			const pg = S.pages[id];
			if (pg) {
				// Tabs der Seite UND aller Unterseiten schließen (sonst Geister-Tabs)
				const gone = descendantsOf(id);
				S.tabs = S.tabs.filter((tid) => !gone.has(tid));
				if (gone.has(S.currentPageId)) { S.currentPageId = null; S.view = "home"; }
				await STATE.dispatch("pageTrash", { id });
				U.toast("Seite im Papierkorb.", "success");
			} else {
				render(); // nur Menü-Zustand geändert, kein dispatch → sofort neu zeichnen
			}
			return;
		}
		if (t.dataset.pagerestore) {
			await STATE.dispatch("pageRestore", { id: t.dataset.pagerestore });
			return;
		}
		if (t.dataset.pagepurge) {
			const pg = S.pages[t.dataset.pagepurge];
			if (pg && await U.confirm('„' + pg.title + '“ endgültig löschen? Das kann nicht rückgängig gemacht werden.', {
				title: "Endgültig löschen", ok: "Löschen", danger: true,
			})) {
				await STATE.dispatch("pageDelete", { id: t.dataset.pagepurge });
			}
			return;
		}
		// Papierkorb vollständig und endgültig leeren. Die Reihenfolge ist wichtig:
		// erst Seiten, dann Stapel, danach verwaiste Karten; alles bleibt bis zur
		// Bestätigung unverändert und wird als einzelne, synchronisierbare Events gelöscht.
		if (t.dataset.trashclear) {
			const pageIds = STATE.trashedPages().map((p) => p.id);
			const deckRoots = STATE.trashedDeckRoots();
			const cardIds = STATE.orphanTrashedCards().map((c) => c.id);
			const total = pageIds.length + deckRoots.length + cardIds.length;
			if (!total) { U.toast("Der Papierkorb ist bereits leer.", "success"); return; }
			if (!await U.confirm("Alle " + total + " Elemente im Papierkorb endgültig löschen? Das kann nicht rückgängig gemacht werden.", {
				title: "Papierkorb leeren", ok: "Endgültig löschen", danger: true,
			})) return;
			for (const id of pageIds) await STATE.dispatch("pageDelete", { id });
			for (const name of deckRoots) await STATE.dispatch("deckDelete", { name });
			for (const id of cardIds) await STATE.dispatch("cardDelete", { id });
			U.toast("Papierkorb geleert.", "success");
			return;
		}

		// Papierkorb: Karten & Stapel wiederherstellen / endgültig löschen
		if (t.dataset.cardrestore) {
			await STATE.dispatch("cardRestore", { id: t.dataset.cardrestore });
			U.toast("Karte wiederhergestellt.", "success");
			return;
		}
		if (t.dataset.cardpurge) {
			const c = S.cards[t.dataset.cardpurge];
			const label = c ? (c.front || "").slice(0, 40) : "Karte";
			if (await U.confirm('Karte „' + label + (label.length >= 40 ? "…" : "") + '“ endgültig löschen? Das kann nicht rückgängig gemacht werden.', {
				title: "Endgültig löschen", ok: "Löschen", danger: true,
			})) {
				await STATE.dispatch("cardDelete", { id: t.dataset.cardpurge });
			}
			return;
		}
		if (t.dataset.deckrestore) {
			await STATE.dispatch("deckRestore", { name: t.dataset.deckrestore });
			U.toast("Stapel wiederhergestellt.", "success");
			return;
		}
		if (t.dataset.deckpurge) {
			const name = t.dataset.deckpurge;
			const n = Object.values(S.cards).filter((c) => inDeck(c.deck || "Standard", name)).length;
			if (await U.confirm('Stapel „' + name + '“ endgültig löschen?' +
				(n ? " " + n + " Karte(n) werden unwiderruflich entfernt." : "") +
				" Das kann nicht rückgängig gemacht werden.", {
				title: "Endgültig löschen", ok: "Löschen", danger: true,
			})) {
				await STATE.dispatch("deckDelete", { name });
			}
			return;
		}

		// Chat-Verlauf: neuer Chat / Chat auswählen. Während die KI streamt, würde
		// ein Wechsel S.chat unter dem laufenden Lauf austauschen — die Antwort
		// landete im falschen Chat. Deshalb kurz blocken statt still korrumpieren.
		if (t.dataset.newchat) { startNewChat(); return; }
		// Verlauf im Seitenchat: alte Unterhaltung direkt im Panel weiterführen
		// (kein Tab-Wechsel wie bei data-chat).
		if (t.dataset.sidechat) {
			if (S.aiBusy) { U.toast("Die KI antwortet noch — bitte kurz warten.", "error"); return; }
			CHAT_FULLSCREEN.saveSideChat();
			const s = CHATS.load().find((x) => x.id === t.dataset.sidechat);
			S.chatHistOpen = false;
			S.sideChat = s ? s.messages.slice() : [];
			S.sideChatId = s ? s.id : null;
			render();
			return;
		}
		if (t.dataset.chat) {
			if (S.aiBusy) { U.toast("Die KI antwortet noch — bitte kurz warten.", "error"); return; }
			saveCurrentChat();
			openPage("chat:" + t.dataset.chat);
			return;
		}

		// Kartenmanager: Speichern / Löschen
		if (t.dataset.cardsave) {
			const id = t.dataset.cardsave;
			const f = document.querySelector('[data-front="' + id + '"]');
			const b = document.querySelector('[data-back="' + id + '"]');
			if (f && b) await STATE.dispatch("cardUpdate", { id, patch: { front: f.value, back: b.value } });
			openCards();
			return;
		}
		if (t.dataset.carddel) {
			if (await U.confirm("Diese Karte in den Papierkorb legen?", { title: "Karte löschen", ok: "In Papierkorb", danger: true })) {
				await STATE.dispatch("cardTrash", { id: t.dataset.carddel });
				openCards();
			}
			return;
		}

		// Undo/Redo aus dem ⋯-Menü der Seite — nutzt dieselben Stapel wie Strg+Z / Strg+Y
		if (t.dataset.editundo || t.dataset.editredo) {
			const redo = !!t.dataset.editredo;
			S.topMenu = null;
			RENDER.renderMain();
			await EDITOR.undoRedo(redo);
			return;
		}

		// Seite öffnen (Sidebar, Home-Karte, Bibliothek oder Breadcrumb-Vorfahre)
		if (t.dataset.page) { openPage(t.dataset.page); return; }

		// Karten-Bewertung im Review
		if (t.dataset.grade) {
			await rateAndReviewCard(t.dataset.card, Number(t.dataset.grade));
			S.reviewShowBack = false;
			openReview();
			return;
		}

		// Darstellungs-Umschalter über die Map statt 14 case-Zeilen
		const appearance = APPEARANCE_BTN[t.id];
		if (appearance) { SETTINGS.handleAppearanceSelect(...appearance); return; }

		switch (t.id) {
			case "btnAiFab":
				// Desktop-Schnellzugriff unten rechts: nur das Seitenpanel öffnen,
				// damit die aktuelle Seite sichtbar bleibt.
				document.body.classList.remove("panel-collapsed");
				renderTabs();
				break;
			case "btnHome":
				S.sidebarMode = "files";
				// Aus Anki/Daily/Bibliothek/Papierkorb führt Home auch inhaltlich zurück
				if (S.view === "anki" || S.view === "daily" || S.view === "library" || S.view === "trash") {
					S.view = S.currentPageId ? "page" : "home";
				}
				render();
				break;
			// Chat-Taste: zeigt den Chat-Verlauf in der Sidebar
			case "btnChatTab":
				S.sidebarMode = "chats";
				render();
				break;
			case "btnLibrary":
				S.view = "library";
				S.libFolder = null;
				blurActive();
				render();
				break;
			case "btnChatHist": // Verlauf-Dropdown; Liste baut render.js
				S.chatHistOpen = !S.chatHistOpen;
				render();
				break;
			case "btnChatNew": // alte Unterhaltung ist gesichert, bleibt in der Chat-Liste
				if (S.aiBusy && S.aiActiveChatType === "side") { U.toast("Die KI antwortet noch — bitte kurz warten.", "error"); break; }
				CHAT_FULLSCREEN.saveSideChat();
				S.sideChat = [];
				S.sideChatId = null;
				render();
				U.toast("Neuer Chat gestartet");
				break;
			case "btnChatExpand": {
				// Ersetzt den alten Vollbildmodus: Seitenchat als eigenen Tab öffnen.
				if (S.aiBusy) { U.toast("Die KI antwortet noch — bitte kurz warten.", "error"); break; }
				CHAT_FULLSCREEN.saveSideChat();
				const sideId = S.sideChatId;
				S.sideChat = [];
				S.sideChatId = null;
				document.body.classList.add("panel-collapsed");
				if (sideId) openPage("chat:" + sideId, { newTab: true });
				else startNewChat({ newTab: true });
				break;
			}
			case "btnNavBack": navBack(); break;
			case "btnNavForward": navForward(); break;
			case "btnSearchToggle":
				SEARCH.handleSearchToggle();
				break;
			case "btnCreateWs":
				await LIBRARY.handleCreateWorkspace();
				break;
			case "btnAttach":
			case "btnAttachFull":
				// 📓 Heft-Anhang nur anbieten, wenn gerade ein Heft geöffnet ist.
				if ($("attachHeft")) $("attachHeft").hidden = !HEFT.activeId;
				CHAT_FULLSCREEN.handleAttachMenuToggle(t);
				break;
			case "attachHeft":
				// 👁 Aktuelle Heft-Seite als Bild anhängen — die KI kann sie damit wie
				// ein Foto "lesen" (Vision). Die Modell-Auswahl bleibt unangetastet.
				$("attachMenu").hidden = true;
				try {
					const heftUrl = await HEFT.pageAsDataUrl(HEFT.activeId, HEFT.activeIndex);
					if (!heftUrl) { U.toast("Öffne zuerst ein Heft, um eine Seite anzuhängen.", "error"); break; }
					S.pendingImage = heftUrl;
					S.pendingTextFile = null;
					S.pendingPdf = null;
					S.pendingAttachmentTarget = S.attachTarget || "side";
					RENDER.renderPendingChip(S.pendingAttachmentTarget);
					U.toast("Heft-Seite angehängt — sie geht mit der nächsten Nachricht an die KI.", "success");
				} catch (err) {
					U.toast("Heft-Seite konnte nicht angehängt werden: " + err.message, "error");
				}
				break;
			case "attachFile":
				$("attachMenu").hidden = true;
				$("fileAttachment").click();
				break;
			case "attachMention":
				$("attachMenu").hidden = true;
				U.toast("Seiten- und Personen-Erwähnungen folgen als Nächstes.", "success");
				break;
			case "btnRemoveImage":
				CHAT_FULLSCREEN.handleRemoveImage();
				break;
			case "btnRemoveTextFile":
				CHAT_FULLSCREEN.handleRemoveTextFile();
				break;
			case "btnRemovePdf":
				CHAT_FULLSCREEN.handleRemovePdf();
				break;
			case "btnTogglePanel":
				document.body.classList.add("panel-collapsed");
				renderTabs();
				break;
			case "btnShowPanel":
				document.body.classList.remove("panel-collapsed");
				renderTabs();
				break;
			case "btnSettings": SETTINGS.openSettings(); break;
			case "btnAiDebug":
			case "btnAiDebugFull":
				await copyAiDebugTrace();
				break;
			case "btnMigrateNotion":
			case "btnNotionSync":
				await SETTINGS.handleNotionSync(t);
				break;
			case "btnNotionCancel":
				SETTINGS.handleNotionCancel();
				break;
			case "btnDriveLogin":
				await SETTINGS.handleDriveLogin(t);
				break;
			case "btnDriveLogout":
				SETTINGS.handleDriveLogout();
				break;
			case "btnDriveSyncSettings":
				await SETTINGS.handleDriveSyncSettings(t);
				break;
			case "btnAddProvider":
				await SETTINGS.handleAddProvider();
				break;
			case "btnRefreshModels":
				await SETTINGS.refreshChatModels();
				break;
			case "btnApplyCustomModel":
				await SETTINGS.handleApplyCustomModel();
				break;
			case "btnRefreshEmbedding":
				await SETTINGS.refreshEmbeddingModels();
				break;
			case "btnCheckUpdate":
				await SETTINGS.handleCheckUpdate();
				break;
			case "btnApplyPwaUpdate":
				await SETTINGS.handleApplyPwaUpdate();
				break;
			case "btnSaveSettings":
				await SETTINGS.handleSaveSettings();
				break;
			case "btnModelMenu":
			case "btnModelChipFull":
				await CHAT_FULLSCREEN.handleModelMenuToggle(t);
				break;
			case "btnPickBg": $("fileBg").click(); break;
			case "btnCoverUpload": {
				const pid = S.currentPageId;
				if (!pid) break;
				// U.pickImageFile: gemeinsamer Datei-Dialog (siehe auch library.js).
				const file = await U.pickImageFile();
				if (!file) break;
				try {
					const buf = await U.readAsBuffer(file);
					const blobId = "cover:" + U.uid();
					await DB.putBlob(blobId, buf, { name: file.name, type: file.type });
					await STATE.dispatch("pageUpdate", { id: pid, patch: { coverImg: blobId, cover: null } });
					closeOverlay();
				} catch (err) {
					alert("Bild konnte nicht als Cover gesetzt werden: " + err.message);
				}
				break;
			}
			case "btnClearBg":
				await SETTINGS.handleClearBg();
				break;
			case "btnCloseOverlay": closeOverlay(); break;
			case "btnAnki": openAnki(); break;
			case "btnReview":
			case "btnReviewHome":
				openAnki("study", null);
				break;
			case "btnShowBack": S.reviewShowBack = true; openReview(); break;
			case "btnReviewRefresh": openReview(); break;
			case "btnCards": openAnki("browser"); break;
			case "btnDaily":
				S.view = "daily";
				S.dailyMonth = null;
				blurActive();
				render();
				break;
			case "btnDailyToday": await openDailyNote(localDayKey(new Date())); break;
			case "btnHistory":
				closeTopMenu(); // sonst bleibt das ⋯-Menü hinter dem Verlauf-Dialog offen
				if (S.currentPageId) await openHistory(S.currentPageId);
				break;
			case "btnHistRestore": {
				const vs = S.histVersions || [];
				const v = vs[Math.max(0, Math.min(S.histIndex, vs.length - 1))];
				if (v && S.histPageId) {
					// Wiederherstellen = neues Event (der Verlauf bleibt vollständig erhalten)
					await STATE.dispatch("pageUpdate", { id: S.histPageId, patch: { title: v.title, content: v.content } });
					RAG.queuePage(S.histPageId);
					closeOverlay();
				}
				break;
			}
			case "btnDriveSync":
				await SETTINGS.handleDriveSync(t);
				break;
			case "btnDailyHome":
				await openDailyNote(localDayKey(new Date()));
				break;
			case "btnBackupNow":
			case "btnExport":
				await SETTINGS.handleBackupNow();
				break;
			case "btnSidebarToggle": {
				// Mobile: Navigator-Sheet öffnen. Desktop: linke Spalte einklappen (☰ bleibt in der Tab-Leiste).
				const mobile = PLATFORM.isPhone(); // dieselbe Definition wie mobile.js und das CSS
				if (mobile) {
					document.body.classList.toggle("mnav-open");
				} else {
					const on = document.body.classList.toggle("sidebar-collapsed");
					try { localStorage.setItem("impala67.sidebarCollapsed", on ? "1" : "0"); } catch { /* ignore */ }
				}
				break;
			}
			case "btnThemeDark":
			case "btnThemeLight":
				SETTINGS.handleThemeSelect(t.id === "btnThemeLight" ? "light" : "dark");
				break;
			case "btnImport": $("fileImport").click(); break;
			case "btnOpenPdf":
				S.topMenu = null; // sonst zeichnet render() das offene ⋯-Menü sofort wieder
				S.pdfOpen = !S.pdfOpen;
				blurActive();
				render();
				break;
			case "btnResetAll":
				await SETTINGS.handleResetAll(t);
				break;
			case "btnTrash":
				S.view = "trash";
				blurActive();
				render();
				break;
		}
	});

	// Eingaben (Delegation) — inkl. Live-Vorschau im Split-Modus
	// PERF (10. Juli): Anki-Suche debounced — vorher Full-Render der Browser-Tabelle pro Tastendruck
	const debouncedAnkiSearch = U.debounce((value, pos) => {
		S.ankiSearch = value;
		renderAnki($("main"));
		const inp = $("ankiSearch");
		if (inp) { inp.focus(); inp.selectionStart = inp.selectionEnd = pos; }
	}, 150);
	document.addEventListener("input", (e) => {
		if (e.target.id === "chatInput" || e.target.id === "mainChatInput") syncComposer(e.target);
		// Bibliotheks-Filter: live filtern, Fokus + Cursorposition nach dem Neuaufbau erhalten
		if (e.target.id === "libFilter") {
			LIBRARY.handleFilterInput(e);
		}
		// KI-Einstellungen: Modelle live filtern. Nur die Liste wird neu gezeichnet,
		// das Suchfeld selbst nicht — Fokus und Cursor bleiben von allein.
		if (e.target.id === "inpModelSearch") {
			S.modelQuery = e.target.value;
			SETTINGS.paintSettingsModels();
		}
		// Karten-Browser: live suchen (debounced), Fokus + Cursorposition erhalten
		if (e.target.id === "ankiSearch") {
			const pos = e.target.selectionStart;
			debouncedAnkiSearch(e.target.value, pos);
		}
	});
	document.addEventListener("change", async (e) => {
		// DB-Tabellen: Zellwert als normales pageUpdate (Verlauf/Diff/Sync greifen).
		// Zusammengelegt: es gab zwei change-Listener am document (Zwillinge, die mit der
		// Zeit auseinanderlaufen) — jetzt EIN Einstiegspunkt für alle change-Ereignisse.
		const cell = closestOf(e, ".db-cell");
		if (cell) {
			const row = S.pages[cell.dataset.dbrow];
			if (!row) return;
			const props = { ...(row.props || {}) };
			props[cell.dataset.dbcol] = cell.value;
			await STATE.dispatch("pageUpdate", { id: row.id, patch: { props } });
			return;
		}
		if (e.target.id === "inpThemeFollowSystem") {
			SETTINGS.handleSystemThemeToggle(!!e.target.checked);
			return;
		}
		if (e.target.id === "pageTitle") {
			const pg = S.currentPageId ? S.pages[S.currentPageId] : null;
			if (pg && e.target.value.trim()) {
				await STATE.dispatch("pageUpdate", { id: pg.id, patch: { title: e.target.value.trim() } });
				RAG.queuePage(pg.id);
			}
		}
		if (e.target.id === "modelSelect") {
			await STATE.dispatch("settingsSet", { aiModel: e.target.value });
			AI.detectThinkingCapabilities().then(renderModelBar, renderModelBar);
			SETTINGS.checkAI();
		}
		if (e.target.id === "fileAttachment" && e.target.files[0]) {
			if (e.target.files[0].type === "application/pdf") await CHAT_FULLSCREEN.handleFilePdfChange(e);
			else if (e.target.files[0].type.startsWith("image/")) CHAT_FULLSCREEN.handleFileImgChange(e);
		}
		if (e.target.id === "filePdf" && e.target.files[0]) {
			await CHAT_FULLSCREEN.handleFilePdfChange(e);
		}
		if (e.target.id === "fileImg" && e.target.files[0]) {
			CHAT_FULLSCREEN.handleFileImgChange(e);
		}
		if (e.target.id === "fileBg" && e.target.files[0]) {
			await SETTINGS.handleFileBgChange(e);
		}
		if (e.target.id === "fileImport" && e.target.files[0]) {
			await SETTINGS.handleImportChange(e);
		}
	});

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
	// ENTFERNT (toter Rest aus der HTML5-DnD-Zeit): ein globaler mousedown-Blocker in der
	// Capture-Phase. Stapel-Drag (dragstart) und Seiten-Drag (pointerdown) filtern diese
	// Buttons längst selbst; der Blocker konnte nur noch andere Module um ihr mousedown
	// bringen. Nicht wieder einbauen.

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
			if (!target || target === moved || target.startsWith(moved + "::")) return;
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
		if (targetDeck !== moved && targetDeck !== "Standard" && !targetDeck.startsWith(moved + "::")) {
			await STATE.dispatch("deckMove", { from: moved, target: targetDeck });
			if (S.ankiDeck && inDeck(S.ankiDeck, moved)) {
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
	async function movePageRelative(movedId, targetId, zone) {
		const target = S.pages[targetId], moved = S.pages[movedId];
		if (!target || !moved || target.id === moved.id || isDescendant(target.id, moved.id)) return;
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
		// Workspace angleichen, falls über Workspace-Grenzen einsortiert wurde
		if ((moved.workspaceId || "default") !== (target.workspaceId || "default")) {
			await STATE.dispatch("pageUpdate", { id: moved.id, patch: { workspaceId: target.workspaceId || "default" } });
		}
	}
	async function movePageInto(movedId, targetId) {
		if (targetId && (targetId === movedId || isDescendant(targetId, movedId))) return;
		await STATE.dispatch("pageMove", { id: movedId, parentId: targetId || null });
	}

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
	// Chat-Formulare (Panel + Vollbild) per Delegation — Vollbild-Form wird pro Render neu erzeugt
	const CHAT_FORMS = { chatForm: ["chatInput", "side"], mainChatForm: ["mainChatInput", "full"] };
	document.addEventListener("submit", async (e) => {
		const def = CHAT_FORMS[e.target.id];
		if (!def) return;
		e.preventDefault();
		// ⏹ Läuft gerade eine Antwort, bricht der Senden-Button sie ab statt zu senden
		if (S.aiBusy) { AI.abortActive(); return; }
		const inp = $(def[0]);
		const text = inp.value.trim();
		inp.value = ""; syncComposer(inp);
		await sendChatMessage(text, def[1]);
	});
	// Enter sendet, Shift+Enter = Zeilenumbruch (Seitenpanel + Vollbild-Chat)
	document.addEventListener("keydown", (e) => {
		if (e.key !== "Enter" || e.shiftKey) return;
		if (e.target.id === "chatInput") { e.preventDefault(); $("chatForm").requestSubmit(); }
		else if (e.target.id === "mainChatInput") { e.preventDefault(); $("mainChatForm").requestSubmit(); }
	});

	// ---------- Inline-Umbenennen (Seiten + Stapel) — Enter bestätigt, Esc/Blur bricht ab ----------
	// FIX: commitRename lief zweimal — Enter bestätigte, der folgende Fokusverlust
	// bestätigte erneut (doppeltes Neuzeichnen); nach Escape schrieb der Fokusverlust den
	// verworfenen Text sogar noch fest. Der Umbenenn-Zustand ist jetzt die Sperre: ist er
	// geräumt, war die Umbenennung schon erledigt oder abgebrochen.
	async function commitRename(input) {
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
			const newLabel = input.value.trim().replace(/::/g, ":");
			const oldLabel = from.split("::").pop();
			S.renamingDeck = null;
			if (newLabel && newLabel !== oldLabel) {
				const prefix = from.includes("::") ? from.slice(0, from.lastIndexOf("::") + 2) : "";
				const to = prefix + newLabel;
				await STATE.dispatch("deckRename", { from, to });
				if (S.ankiDeck && inDeck(S.ankiDeck, from)) S.ankiDeck = to + S.ankiDeck.slice(from.length);
			}
			render();
		}
	}
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
		if (ds.renamename || ds.deckrenamename) commitRename(e.target);
	});
	// Debug-Button nach jedem Chat-Render nachrüsten (nur großer Chat, nie Seiten-Panel)
	// PERF: Während die KI streamt, ändert sich #main hunderte Mal pro Antwort — der
	// Observer suchte bei JEDER Änderung im DOM (und löste sich mit dem eingefügten Knopf
	// gleich selbst wieder aus). Jetzt wird pro Frame höchstens einmal nachgerüstet.
	const main = $("main");
	if (main) {
		let mountQueued = false;
		new MutationObserver(() => {
			if (mountQueued) return;
			mountQueued = true;
			requestAnimationFrame(() => { mountQueued = false; mountFullChatDebugButton(); });
		}).observe(main, { childList: true, subtree: true });
	}
	mountFullChatDebugButton();

	// ---------- ↔️ Breite der linken Spalte ziehen (Griff #sidebarResizer) ----------
	// EINE Quelle der Wahrheit: die CSS-Variable --sidebar-w. Sie steht inline am <body>
	// (gewinnt damit gegen die Kompakt-Regeln in styles.css), die Grid-Spalten lesen sie.
	// Pointer-Events wie beim Seiten-Verschieben — ein Pfad für Maus und Touch.
	const SIDEBAR_W_KEY = "impala67.sidebarWidth";
	const SIDEBAR_W_MIN = 180, SIDEBAR_W_MAX = 560;
	const setSidebarWidth = (px, persist) => {
		const w = Math.round(Math.min(SIDEBAR_W_MAX, Math.max(SIDEBAR_W_MIN, px)));
		document.body.style.setProperty("--sidebar-w", w + "px");
		if (persist) { try { localStorage.setItem(SIDEBAR_W_KEY, String(w)); } catch { /* ignore */ } }
	};
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

	// Tastenkombinationen (Shortcuts) registrieren
	SHORTCUTS.wireShortcuts();
	// Langen geklebten Text automatisch als .txt-Anhang behandeln statt im Feld auszuschreiben
	document.addEventListener("paste", (e) => {
		CHAT_FULLSCREEN.handlePaste(e);
	});

	// 📱 FIX iPad-Tastatur v2 — ROOT-CAUSE-FIX „Seite springt nach oben“ (Teil 2):
	// Der frühere pauschale focusout-Listener setzte auf ALLEN Geräten bei JEDEM
	// Fokusverlust den Scroll auf 0/0 zurück — daher der Sprung nach oben, egal wo
	// man in der App war. Jetzt gilt (KISS): zurückgesetzt wird nur noch, wenn
	// (a) vorher wirklich eine Bildschirmtastatur offen war (visualViewport) und
	// (b) das Fenster tatsächlich verschoben ist. Sonst passiert exakt nichts.
	const isEditing = () => {
		const a = document.activeElement;
		return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable);
	};
	const viewportDisplaced = () =>
		window.scrollY > 0 || document.documentElement.scrollTop > 0 || document.body.scrollTop > 0 ||
		(window.visualViewport && window.visualViewport.offsetTop > 0);
	const resetViewportScroll = () => {
		if (isEditing() || !viewportDisplaced()) return; // Tastatur offen ODER nichts verschoben → nichts tun
		window.scrollTo(0, 0);
		document.documentElement.scrollTop = 0;
		document.body.scrollTop = 0;
	};
	if (window.visualViewport) {
		let kbOpen = false;
		window.visualViewport.addEventListener("resize", () => {
			const open = window.visualViewport.height < window.innerHeight * 0.82;
			if (kbOpen && !open) setTimeout(resetViewportScroll, 60);
			kbOpen = open;
		});
		// Fokusverlust NUR bei offener Tastatur nachziehen — nie mehr global.
		document.addEventListener("focusout", () => {
			if (kbOpen) setTimeout(resetViewportScroll, 100);
		});
	}
}

export const APP = {
	COLLAPSE,
	CHATS,
	wireEvents,
	closeOverlay,
	newPageFlow,
	openDailyNote,
	startNewChat,
	createPageInNewTab,
	// Für Strg+K-Aktionen (search.js) — „Karten verwalten“ & Co.
	PLATFORM,
	openAnki,
	setAnkiZen,
	rateAndReviewCard,
	showStudyAnswer,
	gradeStudyCard,
	studySpaceOrEnter
};
