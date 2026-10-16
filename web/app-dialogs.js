"use strict";
import { BACKUP } from "./backup-status.js";
import { CHAT_FULLSCREEN } from "./chat-fullscreen.js";
import { FACH } from "./fach.js";
import { icon, lead, pageIcon } from "./icons.js";
import { RENDER } from "./render.js";
import { S, STATE } from "./state.js";
import { SRS } from "./srs.js";
import { TABS } from "./tabs.js";
import { U } from "./util.js";
import { BUS } from "./event-bus.js";

const $ = (id) => U.el(id);
const esc = (s) => U.esc(s);
const blurActive = () => document.activeElement?.blur();
const openPage = (...a) => TABS.openPage(...a);
const openTemplatePicker = (...a) => RENDER.openTemplatePicker(...a);
const renderHistoryModal = (...a) => RENDER.renderHistoryModal(...a);
const renderMain = (...a) => RENDER.renderMain(...a);
const saveCurrentChat = (...a) => CHAT_FULLSCREEN.saveCurrentChat(...a);

const isTouch = () => (typeof window !== "undefined" && window.PLATFORM?.isTouch ? window.PLATFORM.isTouch() : false);

const focusPageTitle = () => {
	if (isTouch()) return;
	const ti = $("pageTitle");
	if (ti) {
		ti.focus();
		ti.select();
	}
};

export function closeOverlay() {
	const o = $("overlay");
	if (o) { o.hidden = true; o.classList.remove("change-overlay"); o.innerHTML = ""; }
	S.reviewShowBack = false;
}

// Startseiten-Hinweis „Jetzt sichern“: Cloudflare und Drive in einem Klick (Drive darf neu anmelden).
export async function backupFromHome(button) {
	button.disabled = true;
	button.textContent = "Sichert…";
	try {
		await BACKUP.backupNow();
		U.toast("Alles gesichert.", "success");
	} catch (err) {
		U.toast("Sichern fehlgeschlagen: " + (err?.message || err), "error");
		button.disabled = false;
		button.textContent = "Jetzt sichern";
	}
}

export function mountFullChatVoiceButton() {
	const submit = $("mainChatSubmit");
	if (!submit || $("btnVoiceFull")) return;
	// SVG statt Emoji — konsistent mit den übrigen Icons (voice.js pflegt den Zustand)
	const voiceBtn = Object.assign(document.createElement("button"), { type: "button", id: "btnVoiceFull", className: "composer-tool", title: "Spracheingabe starten (Alt+Leertaste)" });
	voiceBtn.innerHTML = icon("mic");
	submit.before(voiceBtn);
}

// Eigener Eingabe-Dialog statt window.prompt() — nutzt #overlay wie alle Dialoge
export function openPromptDialog(title, onSubmit, initial) {
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
	if (!isTouch()) {
		inp.select();
	} else {
		try {
			const len = inp.value.length;
			inp.setSelectionRange(len, len);
		} catch { /* ignore */ }
	}
}

// „Verschieben nach…“: Ziel = Workspace-Wurzel oder Seite (ohne eigene Nachfahren)
export function openMoveDialog(pageId) {
	const o = $("overlay");
	const pg = S.pages[pageId];
	if (!o || !pg) return;
	const bad = STATE.pageSubtreeIds(pageId);
	let items = "";
	for (const ws of Object.values(S.workspaces)) {
		items += `<button class="menu-item" data-movetarget="ws:${esc(ws.id)}">${lead("folder")}${esc(ws.name)}</button>`;
		const walk = (parentId, depth) => {
			for (const p of STATE.childrenOf(parentId, ws.id)) {
				if (bad.has(p.id) || p.trashed) continue;
				items += `<button class="menu-item" data-movetarget="pg:${p.id}" style="padding-left:${14 + depth * 16}px">${pageIcon(p, "note", "i-lead")}${esc(p.title)}</button>`;
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

// Seite samt Unterseiten duplizieren (parallel); "(Kopie)" nur am Wurzel-Titel
export async function duplicatePage(pageId, newParentId, newWsId) {
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
export function newPageFlow(wsId, parentId) {
	S.pendingNewPage = { wsId, parentId };
	openTemplatePicker();
}

// ⛶ Karteikarten-Vollbild als Zustand statt als loser Body-Klasse — so weiß jede Ansicht,
// dass es an ist, und es lässt sich überall wieder verlassen (⛶-Taste, auch auf dem Handy).
export function setAnkiZen(on) {
	S.ankiZen = !!on;
	document.body.classList.toggle("anki-zen", S.ankiZen);
}

export function resetStudyCard() {
	S.reviewShowBack = false;
	S.reviewCardId = null;
}

export function openAnki(tab, deck) {
	S.ankiTab = tab || "decks";
	if (deck !== undefined) S.ankiDeck = deck;
	resetStudyCard();
	blurActive();
	openPage("anki:main");
}

// Daily Note öffnen — Seite (und 📅-Sammelordner) bei Bedarf anlegen
export async function openDailyNote(key) {
	let pg = STATE.activePages().find((p) => p.daily === key);
	if (!pg) {
		let root = STATE.activePages().find((p) => p.dailyRoot);
		if (!root) {
			const rid = U.uid();
			await STATE.dispatch("pageCreate", { id: rid, title: "Daily Notes", icon: null, workspaceId: "default", dailyRoot: true });
			root = S.pages[rid];
		}
		const id = U.uid();
		const title = new Date(key + "T12:00:00").toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
		await STATE.dispatch("pageCreate", { id, title, parentId: root.id, workspaceId: root.workspaceId || "default", icon: null, daily: key, content: "" });
		pg = S.pages[id];
	}
	if (pg) openPage(pg.id);
}

// Seitenverlauf öffnen (Versionen aus dem Event-Log rekonstruiert)
export async function openHistory(pageId) {
	S.histVersions = await STATE.pageHistory(pageId);
	S.histIndex = S.histVersions.length - 1;
	S.histPageId = pageId;
	renderHistoryModal();
}

// FSRS-Bewertung als EIN Event (Browser-Inline + Review-Modal), grade immer im
// Payload (Tageslimits/Statistik). _ratingInFlight verhindert Doppel-Bewertung:
// zwei schnelle Klicks/Tasten lasen sonst beide den alten Stand → kaputte Intervalle
let _ratingInFlight = false;
export async function rateAndReviewCard(cardId, grade, renderedReviewId) {
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

const inStudy = () => S.view === "anki" && S.ankiTab === "study";
// Bug-Fix („kommt noch“, 22. Juli): Die sichtbare Karte wird beim Aufdecken in
// S.reviewCardId festgepinnt. Vorher lasen Aufdecken UND Bewerten blind dueNow[0] —
// ändert sich die Queue dazwischen (Learning-Karte wird fällig), sprang die Ansicht
// auf eine andere Karte bzw. Space/Enter bewertete die falsche Karte.
export function showStudyAnswer(cardId) {
	if (!inStudy() || S.reviewShowBack) return false;
	// Die beim Rendern festgepinnte Karte ist die einzige, die aufgedeckt werden darf.
	// Sie muss nicht mehr im aktuellen Queue-Snapshot stehen: Genau dieser Snapshot
	// kann sich geändert haben, während der Lernende die Frage beantwortet.
	if (cardId && S.reviewCardId && cardId !== S.reviewCardId) return false;
	const c = S.cards[cardId || S.reviewCardId];
	if (!c || c.trashed || c.suspended) return false;
	S.reviewCardId = c.id;
	S.reviewShowBack = true;
	renderMain();
	return true;
}

export async function gradeStudyCard(grade) {
	if (!inStudy() || !S.reviewShowBack) return false;
	const c = S.cards[S.reviewCardId];
	if (!c) return false;
	await rateAndReviewCard(c.id, Math.max(1, Math.min(4, Number(grade) || 3)));
	resetStudyCard(); // dispatch triggert den Render
	return true;
}

export async function studySpaceOrEnter() {
	if (!inStudy()) return false;
	return S.reviewShowBack ? gradeStudyCard(3) : showStudyAnswer();
}

// Einheitlicher Einstieg für neue Chats (Sidebar, Home, „+ Tab“-Menü)
export function startNewChat(opts = {}) {
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
export async function createPageInNewTab(wsId, parentId, tpl) {
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
export function syncComposer(input) {
	if (!input) return;
	const full = input.id === "mainChatInput";
	const form = $(full ? "mainChatForm" : "chatForm");
	const max = full ? 260 : 210;
	input.style.height = "auto";
	input.style.height = Math.min(max, Math.max(30, input.scrollHeight)) + "px";
	input.style.overflowY = input.scrollHeight > max ? "auto" : "hidden";
	if (form) form.classList.toggle("has-text", !!input.value.trim());
	CHAT_FULLSCREEN.updateSubmitButtons();
}

BUS.on("ui:close-overlay", (el) => closeOverlay(el));
BUS.on("ui:new-page-flow", (arg) => newPageFlow(arg));

