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

const render = (...args) => RENDER.render(...args);
const openTemplatePicker = (...args) => RENDER.openTemplatePicker(...args);
const openPage = (...args) => TABS.openPage(...args);
const openNewTab = (...args) => TABS.openNewTab(...args);
const closeTab = (...args) => TABS.closeTab(...args);
const navBack = (...args) => TABS.navBack(...args);
const navForward = (...args) => TABS.navForward(...args);
const saveCurrentChat = (...args) => CHAT_FULLSCREEN.saveCurrentChat(...args);
const toggleChatFull = (...args) => CHAT_FULLSCREEN.toggleChatFull(...args);
const sendChatMessage = (...args) => CHAT_FULLSCREEN.sendChatMessage(...args);
const renderModelBar = (...args) => RENDER.renderModelBar(...args);
const renderModelMenu = (...args) => RENDER.renderModelMenu(...args);
const renderSidebar = (...args) => RENDER.renderSidebar(...args);
const renderMain = (...args) => RENDER.renderMain(...args);
const renderTabs = (...args) => RENDER.renderTabs(...args);
const openReview = (...args) => RENDER.openReview(...args);
const openCards = (...args) => RENDER.openCards(...args);
const openIconPicker = (...args) => RENDER.openIconPicker(...args);
const openCoverPicker = (...args) => RENDER.openCoverPicker(...args);
const localDayKey = (...args) => RENDER.localDayKey(...args);
const renderHistoryModal = (...args) => RENDER.renderHistoryModal(...args);
const ankiCardsOf = (...args) => RENDER_ANKI.ankiCardsOf(...args);
const openCardEditor = (...args) => RENDER_ANKI.openCardEditor(...args);
const renderAnki = (...args) => RENDER_ANKI.renderAnki(...args);

// app.js — Initialisierung und Event-Verkabelung.


export function closeOverlay() {
	const o = U.el("overlay");
	if (o) {
		o.hidden = true;
		o.classList.remove("change-overlay");
		o.innerHTML = "";
	}
	S.reviewShowBack = false;
}
// Eigener Eingabe-Dialog statt window.prompt() — nutzt das #overlay wie alle anderen Dialoge.
function mountFullChatDebugButton() {
	const head = document.querySelector(".chat-full-head");
	if (!head || head.querySelector("#btnAiDebugFull")) return;
	const button = document.createElement("button");
	button.type = "button";
	button.id = "btnAiDebugFull";
	button.className = "ai-debug-btn";
	button.title = "Letztes KI-Debugprotokoll in die Zwischenablage kopieren";
	button.textContent = "Debugprotokoll";
	head.appendChild(button);
	// Der große Chat wird dynamisch gerendert. Deshalb den Voice-Button hier
	// unmittelbar links vor der Sendetaste einhängen, statt Markup zu duplizieren.
	const submit = document.getElementById("mainChatSubmit");
	if (submit && !document.getElementById("btnVoiceFull")) {
		const voice = document.createElement("button");
		voice.type = "button";
		voice.id = "btnVoiceFull";
		voice.className = "composer-tool";
		voice.title = "Spracheingabe starten (Alt+Leertaste)";
		voice.textContent = "🎙";
		submit.before(voice);
	}
}

async function copyAiDebugTrace() {
	const report = AI.debugReport();
	try {
		await navigator.clipboard.writeText(report);
		U.toast("KI-Debugprotokoll kopiert — hier im Chat einfügen.", "success");
	} catch {
		// Clipboard kann bei file:// oder ohne Berechtigung blockiert sein. Dann
		// erscheint der Bericht in einem auswählbaren Dialog statt verloren zu gehen.
		const o = U.el("overlay");
		if (!o) return;
		o.hidden = false;
		o.innerHTML = '<div class="modal modal-sm"><button class="modal-x" id="btnCloseOverlay" title="Schließen">✕</button>' +
			'<h3>KI-Debugprotokoll</h3><p class="hint">Zwischenablage blockiert. Bitte den folgenden Text kopieren und hier einfügen.</p>' +
			'<textarea class="ai-debug-copy" readonly>' + U.esc(report) + '</textarea></div>';
		const area = o.querySelector("textarea");
		if (area) { area.focus(); area.select(); }
	}
}

function openPromptDialog(title, onSubmit, initial) {
	const o = U.el("overlay");
	if (!o) return;
	o.innerHTML = '<div class="modal modal-sm">' +
		"<h3>" + U.esc(title) + "</h3>" +
		'<input id="dlgPromptInput" autocomplete="off" value="' + U.esc(initial || "") + '">' +
		'<div class="modal-actions"><button id="dlgPromptCancel">Abbrechen</button><button id="dlgPromptOk">OK</button></div>' +
		"</div>";
	o.hidden = false;
	const inp = U.el("dlgPromptInput");
	const submit = () => { const v = inp.value.trim(); closeOverlay(); if (v) onSubmit(v); };
	U.el("dlgPromptOk").addEventListener("click", submit);
	U.el("dlgPromptCancel").addEventListener("click", () => closeOverlay());
	inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
	inp.focus();
	inp.select();
}

// „Verschieben nach…“-Dialog: Ziel wählen (Workspace-Wurzel oder Seite, ohne eigene Nachfahren).
function openMoveDialog(pageId) {
	const o = U.el("overlay");
	const pg = S.pages[pageId];
	if (!o || !pg) return;
	const bad = new Set([pageId]);
	(function collect(pid) {
		for (const p of Object.values(S.pages)) if (p.parentId === pid && !bad.has(p.id)) { bad.add(p.id); collect(p.id); }
	})(pageId);
	let items = "";
	for (const ws of Object.values(S.workspaces)) {
		items += '<button class="menu-item" data-movetarget="ws:' + U.esc(ws.id) + '">📁 ' + U.esc(ws.name) + "</button>";
		const walk = (parentId, depth) => {
			for (const p of STATE.childrenOf(parentId, ws.id)) {
				if (bad.has(p.id) || p.trashed) continue;
				items += '<button class="menu-item" data-movetarget="pg:' + p.id + '" style="padding-left:' + (14 + depth * 16) + 'px">' +
					(p.icon ? U.esc(p.icon) + " " : "📝 ") + U.esc(p.title) + "</button>";
				walk(p.id, depth + 1);
			}
		};
		walk(null, 1);
	}
	o.innerHTML = '<div class="modal modal-sm"><h3>„' + U.esc(pg.title) + '“ verschieben nach…</h3>' +
		'<div class="move-list">' + items + "</div>" +
		'<div class="modal-actions"><button id="dlgMoveCancel">Abbrechen</button></div></div>';
	o.hidden = false;
	S.movePageId = pageId;
	U.el("dlgMoveCancel").addEventListener("click", () => closeOverlay());
}



function isDescendant(childId, ancestorId) {
	let cur = S.pages[childId];
	while (cur && cur.parentId) {
		if (cur.parentId === ancestorId) return true;
		cur = S.pages[cur.parentId];
	}
	return false;
}



// Dupliziert eine Seite samt aller Unterseiten (wie in Notion), "(Kopie)" an den Titel angehängt.
async function duplicatePage(pageId, newParentId, newWsId) {
	const pg = S.pages[pageId];
	if (!pg) return null;
	const id = U.uid();
	const parentId = newParentId !== undefined ? newParentId : pg.parentId;
	const wsId = newWsId || pg.workspaceId;
	await STATE.dispatch("pageCreate", {
		id, title: pg.title + (newParentId === undefined ? " (Kopie)" : ""), parentId, content: pg.content,
		workspaceId: wsId, icon: pg.icon, cover: pg.cover, coverImg: pg.coverImg, tags: pg.tags,
		kind: pg.kind || "notion",
	});
	const kids = STATE.childrenOf(pg.id, pg.workspaceId);
	await Promise.all(kids.map((kid) => duplicatePage(kid.id, id, wsId))); // parallel statt sequenziell
	return id;
}

// Neue Seite anlegen — kind: "notion" (Standard) oder "heft" (GoodNotes-Notizbuch).
// Optional mit Vorlage (tpl): übernimmt Titel/Inhalt/Icon/Tags/Typ der Vorlage.
async function createPageIn(wsId, parentId, tpl, kind) {
	const id = U.uid();
	S.currentWorkspaceId = wsId || S.currentWorkspaceId;
	const k = kind || (tpl && tpl.kind) || "notion";
	await STATE.dispatch("pageCreate", {
		id, title: tpl ? tpl.title : (k === "heft" ? "Neues Heft" : "Neue Seite"), parentId: parentId || null,
		content: tpl ? tpl.content : "", icon: tpl ? tpl.icon : (k === "heft" ? "📓" : null), tags: tpl ? tpl.tags : [],
		workspaceId: S.currentWorkspaceId, kind: k,
	});
	openPage(id);
	const ti = document.getElementById("pageTitle");
	if (ti) { ti.focus(); ti.select(); }
}

// Anlegen zeigt IMMER den Typ-Dialog (Notion-Seite oder GoodNotes-Heft) —
// Vorlagen erscheinen darin als zusätzliche Optionen.
async function newPageFlow(wsId, parentId) {
	S.pendingNewPage = { wsId, parentId };
	openTemplatePicker();
}

// Karteikarten-Bereich öffnen (🃏-Pille oben links): Stapel/Browser/Statistik/Lernen
// sidebarMode bleibt unberührt für den Dateibaum, aber die Topbar-Pille ist exklusiv „anki“
// (renderTopbar priorisiert view==="anki" über sidebarMode).
function openAnki(tab, deck) {
	S.view = "anki";
	S.sidebarMode = "files"; // Stapel-Baum in der Sidebar (nicht Chat-Liste)
	S.ankiTab = tab || "decks";
	if (deck !== undefined) S.ankiDeck = deck;
	S.reviewShowBack = false;
	toggleChatFull(false);
	if (document.activeElement) document.activeElement.blur();
	render();
}

// Daily Note eines Tages öffnen — Seite (und der 📅-Sammelordner) werden bei Bedarf angelegt.
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
		const d = new Date(key + "T12:00:00");
		const title = d.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
		await STATE.dispatch("pageCreate", {
			id, title, parentId: root.id, workspaceId: root.workspaceId || "default",
			icon: "📅", daily: key, content: "",
		});
		pg = S.pages[id];
	}
	if (pg) openPage(pg.id);
}

// Ganzen Workspace als ZIP voller Markdown-Dateien exportieren (Ordnerstruktur = Seitenbaum)


// Öffnet den Seitenverlauf (Versionen aus dem Event-Log rekonstruiert).
async function openHistory(pageId) {
	const versions = await STATE.pageHistory(pageId);
	S.histVersions = versions;
	S.histIndex = versions.length - 1;
	S.histPageId = pageId;
	renderHistoryModal();
}

// Bewertet eine Karteikarte per FSRS und dispatcht das Ergebnis als EIN Event —
// von beiden Lernorten (Anki-Browser-Inline-Bewertung UND Review-Modal) genutzt,
// damit "grade" immer im Event-Payload steht (Tageslimits/Statistik werten das aus).
// Schutz vor Doppel-Bewertung: rate()/dispatch() ist asynchron — ohne Sperre konnte
// ein schneller Doppel-Tastendruck oder -Klick (Leertaste+Zifferntaste, zweimal auf
// denselben Bewertungs-Knopf) dieselbe Karte zweimal bewerten, weil beide Aufrufe
// noch denselben (alten) Kartenstand lasen, bevor der erste fertig war — das gab
// kaputte/doppelte Intervalle.
let _ratingInFlight = false;
async function rateAndReviewCard(cardId, grade) {
	if (_ratingInFlight) return null;
	const card = S.cards[cardId];
	if (!card) return null;
	_ratingInFlight = true;
	try {
		const wasNew = card.srs.state === "new";
		const wasLearning = card.srs.state === "learning" || card.srs.state === "relearning";
		const srs = SRS.rate(card.srs, grade);
		await STATE.dispatch("cardReview", {
			id: card.id, srs, grade,
			reviewId: U.uid(),
			deck: card.deck || "Standard",
			first: wasNew,
			learning: wasLearning
		});
		return card;
	} finally {
		_ratingInFlight = false;
	}
}

// Anki-Tastatur (docs.ankiweb.net/studying.html):
// Space/Enter → Antwort; bei sichtbarer Antwort Space/Enter → Good (3).
// 1–4 → Again/Hard/Good/Easy.
function showStudyAnswer() {
	if (S.view !== "anki" || S.ankiTab !== "study") return false;
	// Space bei sichtbarer Antwort = Good (Anki-Standard)
	if (S.reviewShowBack) return false;
	const snap = STATE.studySnapshot(S.ankiDeck);
	if (!snap.dueNow.length) return false;
	S.reviewShowBack = true;
	renderMain();
	return true;
}
async function gradeStudyCard(grade) {
	if (S.view !== "anki" || S.ankiTab !== "study") return false;
	if (!S.reviewShowBack) return false;
	const snap = STATE.studySnapshot(S.ankiDeck);
	const c = snap.dueNow[0];
	if (!c) return false;
	const g = Math.max(1, Math.min(4, Number(grade) || 3));
	await rateAndReviewCard(c.id, g);
	S.reviewShowBack = false;
	// dispatch() triggert onChange/render — Review-Show-Back ist vor dem nächsten Frame false
	return true;
}
// Space/Enter: Antwort ODER Gut
async function studySpaceOrEnter() {
	if (S.view !== "anki" || S.ankiTab !== "study") return false;
	if (!S.reviewShowBack) return showStudyAnswer();
	return gradeStudyCard(3);
}

// Einheitlicher Einstieg für neue Chats — wird von Sidebar, Home und „+ Tab“-Menü genutzt.
// opts.newTab: Chat in neuem Tab öffnen (Notion-Stil, Plus in der Tab-Leiste).
function startNewChat(opts) {
	opts = opts || {};
	saveCurrentChat();
	const newId = U.uid();
	const list = CHATS.load();
	list.unshift({ id: newId, title: "", created: U.now(), updated: U.now(), messages: [] });
	CHATS.save(list);
	S.chat = [];
	S.currentChatId = newId;
	openPage("chat:" + newId, opts.newTab ? { newTab: true } : undefined);
}

// Neue Seite direkt in einem neuen Tab (für „+ → Neue Seite“ im Tab-Menü).
async function createPageInNewTab(wsId, parentId, tpl) {
	const id = U.uid();
	S.currentWorkspaceId = wsId || S.currentWorkspaceId;
	await STATE.dispatch("pageCreate", {
		id,
		title: tpl ? tpl.title : "Neue Seite",
		parentId: parentId || null,
		content: tpl ? tpl.content : "",
		icon: tpl ? tpl.icon : null,
		tags: tpl ? tpl.tags : [],
		workspaceId: S.currentWorkspaceId,
	});
	openPage(id, { newTab: true });
	const ti = document.getElementById("pageTitle");
	if (ti) { ti.focus(); ti.select(); }
	return id;
}

// Chat-Composer: wächst mit dem Text; Sendetaste ist nur bei Inhalt aktiv.
function syncComposer(input) {
	if (!input) return;
	const full = input.id === "mainChatInput";
	const form = U.el(full ? "mainChatForm" : "chatForm");
	const submit = U.el(full ? "mainChatSubmit" : "chatSubmit");
	input.style.height = "auto";
	const max = full ? 260 : 210;
	input.style.height = Math.min(max, Math.max(30, input.scrollHeight)) + "px";
	input.style.overflowY = input.scrollHeight > max ? "auto" : "hidden";
	if (form) form.classList.toggle("has-text", !!input.value.trim());
	if (submit) submit.disabled = !input.value.trim();
}

function wireEvents() {
	// STATE.dispatch() löst über STATE.onChange bereits einen gebündelten rAF-Render aus.
	// Handler mit persistierten Änderungen rufen deshalb nicht zusätzlich render() auf;
	// reine UI-Navigation ohne dispatch() rendert weiterhin sofort.
	// Datenbank-Tabellen: Zellwert speichern (props der Zeilen-Seite) — normales
	// pageUpdate-Event, damit Verlauf, Diff und Notion-Sync die Änderung mitbekommen.
	document.addEventListener("change", async (e) => {
		const cell = e.target.closest(".db-cell");
		if (!cell) return;
		const row = S.pages[cell.dataset.dbrow];
		if (!row) return;
		const props = { ...(row.props || {}) };
		props[cell.dataset.dbcol] = cell.value;
		await STATE.dispatch("pageUpdate", { id: row.id, patch: { props } });
	});
	// „＋ Neue Zeile“ in der Datenbank-Ansicht — wird beim nächsten Sync als echte Notion-Zeile angelegt
	document.addEventListener("click", async (e) => {
		const btn = e.target.closest("[data-dbnewrow]");
		if (!btn) return;
		const dbPg = S.pages[btn.dataset.dbnewrow];
		if (!dbPg) return;
		await STATE.dispatch("pageCreate", { id: U.uid(), title: "Neue Zeile", parentId: dbPg.id, workspaceId: dbPg.workspaceId || "default", props: {} });
	});

	// Intercept clicks on links pointing to local pages
	document.addEventListener("click", (e) => {
		const a = e.target.closest("a");
		if (!a) return;
		const href = a.getAttribute("href") || "";
		const rawId = href.replace(/^(#|\/)/, "");
		// Importierte Seiten können UUIDs mit ODER ohne Bindestriche verwenden.
		// Erst den exakten Wert prüfen, erst danach auf das alte Normalformat fallen.
		const id = S.pages[rawId] ? rawId : rawId.replace(/-/g, "");
		if (S.pages[id]) {
			e.preventDefault();
			openPage(id);
		}
	});

	// Mobile Shell v2 — Navigator-Sheet (body.mnav-open): Tippen auf den Abdunkler
	// oder Escape schließt das Sheet. Aktionen im Sheet, die die Hauptansicht
	// wechseln, schließen es mit (Seiten/Chats erledigt bereits openPage in tabs.js;
	// die Topbar-Pillen Home/Chat/Suche wechseln nur den Sheet-Inhalt und bleiben offen).
	document.addEventListener("click", (e) => {
		if (!document.body.classList.contains("mnav-open")) return;
		if (e.target.closest("#mDock") || e.target.closest("#btnSidebarToggle")) return;
		if (!e.target.closest("#sidebar")) { document.body.classList.remove("mnav-open"); return; }
		if (e.target.closest("#btnLibrary, #btnTrash, #btnDaily, #btnAnki, [data-deckopen], [data-ankistudy]")) {
			document.body.classList.remove("mnav-open");
		}
	});
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && document.body.classList.contains("mnav-open")) {
			document.body.classList.remove("mnav-open");
		}
	});

	// Klicks (Delegation) — alle interaktiven Elemente sind explizit gelistet,
	// damit sie unabhängig vom Tag (button/span) zuverlässig ausgelöst werden.
	const CLICKABLE = "[data-page],[data-grade],[data-set],[data-chat],[data-newchat],[data-newpage]," +
		"[data-collapse],[data-crumbws],[data-tabopen],[data-tabclose],[data-undo],[data-difftoggle]," +
		"[data-reasoningtoggle],[data-iconset],[data-coverset],[data-coverpick],[data-coverremove]," +
		"[data-iconpick],[data-filedownload],[data-modelset],[data-chatdel],[data-editmsg]," +
		"[data-answerq],[data-refinetoggle],[data-refine],[data-inserttoggle],[data-insertmark],[data-libview]," +
		"[data-libws],[data-libinto],[data-libroot]," +
		"[data-ankitab],[data-ankistudy],[data-ankigrade],[data-ankishowback],[data-ankiwaitrefresh],[data-ankisort],[data-ankimore],[data-ankideckfilter]," +
		"[data-ankisuspend],[data-ankidel],[data-ankiedit],[data-ankinewcard],[data-cardeditorsave]," +
		"[data-dailyday],[data-dailynav],[data-zipws]," +
		"[data-deckopen],[data-decknew],[data-decksub],[data-deckrename],[data-deckdel],[data-deckmenu],[data-deckduplicate],[data-libnew]," +
		"[data-pagemenu],[data-pagerename],[data-pageduplicate],[data-pagetrash],[data-pagerestore],[data-pagepurge],[data-cardrestore],[data-cardpurge],[data-deckrestore],[data-deckpurge]," +
		"[data-pagetemplate],[data-tplblank],[data-tplheft],[data-tpluse],[data-libsort],[data-histversion],[data-renamename],[data-deckrenamename]," +
		"[data-conflictopen],[data-conflictnav],[data-conflictresolve],[data-conflictpage],button";

	document.addEventListener("click", async (e) => {
		// --- Stapel-⋯ ZUERST, BEVOR closeOutside die Sidebar neu rendert ---
		// Bug: closeOutside + data-deckopen liefen im selben Klick und zerstörten
		// das Menü ("springt kurz weg und verschwindet" / Löschen wirkungslos).
		const deckMenuBtn = e.target.closest("[data-deckmenu]");
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
		const deckAction = e.target.closest("[data-deckdel],[data-deckrename],[data-deckduplicate]");
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
				if (S.ankiDeck && (S.ankiDeck === name || S.ankiDeck.startsWith(name + "::"))) S.ankiDeck = null;
				U.toast("Stapel im Papierkorb.", "success");
			} else {
				render();
			}
			return;
		}

		const t = e.target.closest(CLICKABLE);
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

		// Schnellaktionen des Home-Dashboards. Navigation bleibt bewusst unverändert:
		// Home/Chat/Bibliothek sind die drei Hauptpillen, das Dashboard startet nur Aktionen.
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

		// Ein-/Ausklappen (Workspace oder Seite mit Unterseiten)
		if (t.dataset.collapse) {
			// treeOpen ist ein synchronisiertes Event. Erst nach der Persistenz
			// neu zeichnen, damit der Default (eingeklappt) nie kurz aufblitzt.
			await COLLAPSE.toggle(t.dataset.collapse);
			if (S.view === "library") renderMain(); else renderSidebar();
			return;
		}

		// Icon-/Cover-Auswahl (auch aus dem Topbar-⋯-Menü erreichbar — Menü vorher schließen,
		// sonst bleibt es hinter dem Auswahl-Dialog offen)
		if (t.dataset.iconpick) { if (S.topMenu) { S.topMenu = null; renderMain(); } openIconPicker(); return; }
		if (t.dataset.coverpick) { if (S.topMenu) { S.topMenu = null; renderMain(); } openCoverPicker(); return; }
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

		// Thinking-Prozess: live (während Streaming) oder finalisiert ausklappen
		if (t.id === "btnThinkLive" || t.dataset.reasoningtoggle) {
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
				AI.detectThinkingCapabilities().then(() => renderModelMenu()).catch(() => renderModelMenu());
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
			AI.detectThinkingCapabilities().then(() => renderModelMenu()).catch(() => renderModelMenu());
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

		// Modell aus der eigenen Dropdown-Liste wählen (Wert kodiert als "quelleId::modell")
		if (t.dataset.modelset) {
			const raw = t.dataset.modelset;
			const sep = raw.indexOf("::");
			const providerId = sep === -1 ? S.settings.aiProviderId : raw.slice(0, sep);
			const model = sep === -1 ? raw : raw.slice(sep + 2);
			await STATE.dispatch("settingsSet", { aiProviderId: providerId, aiModel: model });
			S.modelMenuOpen = false;
			renderModelBar();
			// Jede Auswahl startet die modellbezogene Probe sofort. Das Thinking-
			// Menü zeigt später ausschließlich die bestätigten Stufen dieses Modells.
			AI.detectThinkingCapabilities().then(renderModelBar, renderModelBar);
			SETTINGS.checkAI();
			return;
		}

		// Quelle entfernen (Einstellungen → KI)
		if (t.dataset.provdel) {
			const providers = (S.settings.aiProviders || []).filter((p) => p.id !== t.dataset.provdel);
			await STATE.dispatch("settingsSet", { aiProviders: providers });
			SETTINGS.openSettings("ki");
			return;
		}

		// Quelle für ein eigenes Modell wählen (Chips im Modell-Dropdown) — Eingabe bleibt erhalten
		if (t.dataset.customprov) {
			const keep = (document.getElementById("customModelInput") || {}).value || "";
			S.customModelProviderPick = t.dataset.customprov;
			renderModelMenu();
			const inp2 = document.getElementById("customModelInput");
			if (inp2) { inp2.value = keep; inp2.focus(); }
			return;
		}

		// Eigenes Modell für die gewählte Quelle setzen (unten im Modell-Dropdown)
		if (t.dataset.modelcustomapply) {
			const inp = document.getElementById("customModelInput");
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

		// KI-Chat aus der Liste löschen
		if (t.dataset.chatdel) {
			CHAT_FULLSCREEN.handleDeleteChat(t);
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
		if (t.dataset.ankitab) { S.ankiTab = t.dataset.ankitab; S.reviewShowBack = false; renderMain(); return; }
		if (t.hasAttribute("data-ankistudy")) {
			S.ankiDeck = t.dataset.ankistudy || null;
			S.ankiTab = "study";
			S.reviewShowBack = false;
			renderMain();
			return;
		}
		if (t.dataset.ankishowback) { S.reviewShowBack = true; renderMain(); return; }
		if (t.dataset.ankiwaitrefresh) { S.reviewShowBack = false; renderMain(); return; }
		if (t.dataset.ankigrade) {
			await rateAndReviewCard(t.dataset.card, Number(t.dataset.ankigrade));
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
			const front = (U.el("cardFront") || {}).value || "";
			const back = (U.el("cardBack") || {}).value || "";
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
			S.ankiDeck = deck === "Standard" ? null : deck;
			closeOverlay();
			return;
		}

		// ---------- Stapel-Baum: Stapel öffnen (nicht bei ⋯ / + / Menü) ----------
		if (t.hasAttribute("data-deckopen") && !e.target.closest(".row-add, .page-menu, input, button")) {
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
				const ti = document.getElementById("pageTitle");
				if (ti) { ti.focus(); ti.select(); }
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
			if (S.topMenu) { S.topMenu = null; renderMain(); } // Topbar-⋯-Menü schließen, sonst bleibt es hinter dem Dialog offen
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
			// Workspace-Zugehörigkeit für die ganze Unterstruktur mitziehen
			const setWs = async (pid) => {
				const p = S.pages[pid];
				if (!p) return;
				if (wsId && p.workspaceId !== wsId) await STATE.dispatch("pageUpdate", { id: pid, patch: { workspaceId: wsId } });
				for (const c of Object.values(S.pages)) if (c.parentId === pid) await setWs(c.id);
			};
			await setWs(moveId);
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
				// Alle offenen Tabs der Seite UND ihrer Unterseiten schließen, da sie in den
				// Papierkorb wandern. FIX (14. Juli 2026): Vorher wurde nur der Tab der Seite
				// selbst geschlossen — Unterseiten-Tabs blieben als Geister-Tabs offen; war
				// gerade eine Unterseite geöffnet, blieb die Ansicht auf dem Papierkorb-Inhalt.
				const gone = new Set([id]);
				(function collect(pid) {
					for (const p of Object.values(S.pages)) if (p.parentId === pid && !gone.has(p.id)) { gone.add(p.id); collect(p.id); }
				})(id);
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
			const n = Object.values(S.cards).filter((c) => {
				const d = c.deck || "Standard";
				return d === name || d.startsWith(name + "::");
			}).length;
			if (await U.confirm('Stapel „' + name + '“ endgültig löschen?' +
				(n ? " " + n + " Karte(n) werden unwiderruflich entfernt." : "") +
				" Das kann nicht rückgängig gemacht werden.", {
				title: "Endgültig löschen", ok: "Löschen", danger: true,
			})) {
				await STATE.dispatch("deckDelete", { name });
			}
			return;
		}

		// Chat-Verlauf: neuer Chat / Chat auswählen
		if (t.dataset.newchat) { startNewChat(); return; }
		if (t.dataset.chat) {
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

		switch (t.id) {
			// Mobile Shell v2 — Dock-Pille: ☰ Navigator-Sheet, 🃏 Karten, ＋ Neu, ✦ KI-Sheet
			case "btnMNav":
				document.body.classList.toggle("mnav-open");
				break;
			case "btnMCards":
				document.body.classList.remove("mnav-open");
				openAnki();
				break;
			case "btnMNew":
				document.body.classList.remove("mnav-open");
				await newPageFlow(S.currentWorkspaceId || Object.keys(S.workspaces)[0] || "default", null);
				break;
			case "btnMAi":
				// Gleiche Mechanik wie der Desktop-FAB (Panel einblenden) — das
				// Vollbild-Layout kommt rein aus CSS („Mobile Shell v2", styles.css).
				document.body.classList.remove("mnav-open");
				document.body.classList.remove("panel-collapsed");
				renderTabs();
				break;
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
				toggleChatFull(false);
				if (document.activeElement) document.activeElement.blur();
				render();
				break;
			case "btnChatExpand":
				CHAT_FULLSCREEN.toggleChatFull();
				break;
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
				CHAT_FULLSCREEN.handleAttachMenuToggle(t);
				break;
			case "attachFile":
				U.el("attachMenu").hidden = true;
				U.el("fileAttachment").click();
				break;
			case "attachMention":
				U.el("attachMenu").hidden = true;
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
				CHAT_FULLSCREEN.toggleChatFull(false);
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
			case "btnPickBg": U.el("fileBg").click(); break;
			case "btnCoverUpload": {
				const pid = S.currentPageId;
				if (!pid) break;
				const inp = document.createElement("input");
				inp.type = "file";
				inp.accept = "image/*";
				inp.onchange = async () => {
					const file = inp.files && inp.files[0];
					if (!file) return;
					try {
						const buf = await U.readAsBuffer(file);
						const blobId = "cover:" + U.uid();
						await DB.putBlob(blobId, buf, { name: file.name, type: file.type });
						await STATE.dispatch("pageUpdate", { id: pid, patch: { coverImg: blobId, cover: null } });
						closeOverlay();
					} catch (err) {
						alert("Bild konnte nicht als Cover gesetzt werden: " + err.message);
					}
				};
				inp.click();
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
				toggleChatFull(false);
				if (document.activeElement) document.activeElement.blur();
				render();
				break;
			case "btnDailyToday": await openDailyNote(localDayKey(new Date())); break;
			case "btnHistory":
				if (S.topMenu) { S.topMenu = null; renderMain(); } // ⋯-Menü schließen, sonst bleibt es hinter dem Verlauf-Dialog offen
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
				const mobile = window.matchMedia("(max-width: 768px)").matches;
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
			case "btnDensityComfortable": SETTINGS.handleAppearanceSelect("density", "comfortable"); break;
			case "btnDensityCompact": SETTINGS.handleAppearanceSelect("density", "compact"); break;
			case "btnMotionFull": SETTINGS.handleAppearanceSelect("motion", "full"); break;
			case "btnMotionReduced": SETTINGS.handleAppearanceSelect("motion", "reduced"); break;
			case "btnImport": U.el("fileImport").click(); break;
			case "btnOpenPdf":
				S.topMenu = null; // FIX: render() zeichnete das noch offene ⋯-Menü sonst sofort wieder
				S.pdfOpen = !S.pdfOpen;
				if (document.activeElement) document.activeElement.blur();
				render();
				break;
			case "btnResetAll":
				await SETTINGS.handleResetAll(t);
				break;
			case "btnTrash":
				S.view = "trash";
				if (document.activeElement) document.activeElement.blur();
				render();
				break;
		}
	});

	// Eingaben (Delegation) — inkl. Live-Vorschau im Split-Modus
	// PERF (10. Juli): Anki-Suche debounced — vorher Full-Render der Browser-Tabelle pro Tastendruck
	const debouncedAnkiSearch = U.debounce((value, pos) => {
		S.ankiSearch = value;
		renderAnki(U.el("main"));
		const inp = U.el("ankiSearch");
		if (inp) { inp.focus(); inp.selectionStart = inp.selectionEnd = pos; }
	}, 150);
	document.addEventListener("input", (e) => {
		if (e.target.id === "chatInput" || e.target.id === "mainChatInput") syncComposer(e.target);
		// Bibliotheks-Filter: live filtern, Fokus + Cursorposition nach dem Neuaufbau erhalten
		if (e.target.id === "libFilter") {
			LIBRARY.handleFilterInput(e);
		}
		// Karten-Browser: live suchen (debounced), Fokus + Cursorposition erhalten
		if (e.target.id === "ankiSearch") {
			const pos = e.target.selectionStart;
			debouncedAnkiSearch(e.target.value, pos);
		}
	});
	document.addEventListener("change", async (e) => {
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

	// Drag & Drop: Seite auf Seite ziehen = Unterseite; auf freien Baum = oberste Ebene.
	// Gleiches gilt für Stapel: Stapel auf Stapel ziehen = Unterstapel; auf freien
	// Baum = Stammebene. dragId kann eine Seiten-ID oder ein Stapelname sein;
	// dragType unterscheidet beide ("page" vs "deck").
	let dragId = null, dragType = null, dropZone = null;
	document.addEventListener("dragstart", (e) => {
		// ⋯ / + / Inputs in der Zeile dürfen KEINEN Drag starten — sonst frisst
		// der Browser den Klick und das Menü flackert nur kurz auf.
		if (e.target.closest("button, input, a, .page-menu, .row-add, .row-chevron")) {
			e.preventDefault();
			return;
		}
		const pageRow = e.target.closest("[data-page]");
		if (pageRow) { dragId = pageRow.dataset.page; dragType = "page"; e.dataTransfer.effectAllowed = "move"; return; }
		const deckRow = e.target.closest("[data-deck]");
		if (deckRow) { dragId = deckRow.dataset.deck; dragType = "deck"; e.dataTransfer.effectAllowed = "move"; return; }
	});
	// mousedown auf Zeilen-Buttons: Drag der Eltern-Zeile unterbinden
	document.addEventListener("mousedown", (e) => {
		if (e.target.closest(".row-add, [data-deckmenu], [data-pagemenu], .page-menu")) {
			e.stopPropagation();
		}
	}, true);
	const clearDropMarks = () => {
		document.querySelectorAll(".row.drop-target,.row.drop-before,.row.drop-after").forEach((r) => {
			r.classList.remove("drop-target", "drop-before", "drop-after");
			r.style.borderTop = "";
			r.style.borderBottom = "";
		});
	};
	document.addEventListener("dragover", (e) => {
		if (!dragId) return;
		const pageRow = e.target.closest("[data-page]");
		const deckRow = e.target.closest("[data-deck]");
		if (pageRow || deckRow || e.target.closest("#tree")) {
			e.preventDefault();
			clearDropMarks();
			// Drei Zonen beim Ziehen über eine Seiten-Zeile: oberes Viertel = DAVOR
			// einsortieren, unteres Viertel = DANACH, Mitte = als Unterseite (wie bisher).
			dropZone = "into";
			if (pageRow && dragType === "page") {
				const r = pageRow.getBoundingClientRect();
				const y = e.clientY - r.top;
				if (y < r.height * 0.25) dropZone = "before";
				else if (y > r.height * 0.75) dropZone = "after";
			}
			if (pageRow) {
				if (dropZone === "before") { pageRow.classList.add("drop-before"); pageRow.style.borderTop = "2px solid #4a9eff"; }
				else if (dropZone === "after") { pageRow.classList.add("drop-after"); pageRow.style.borderBottom = "2px solid #4a9eff"; }
				else pageRow.classList.add("drop-target");
			}
			else if (deckRow) deckRow.classList.add("drop-target");
		}
	});
	document.addEventListener("dragend", () => { dropZone = null; clearDropMarks(); });
	// Einsortieren VOR/NACH einer Seite (Sortier-Zonen) — läuft VOR dem allgemeinen
	// Drop-Handler und stoppt ihn, wenn eine Sortier-Zone getroffen wurde.
	document.addEventListener("drop", async (e) => {
		if (!dragId || dragType !== "page" || dropZone === "into" || dropZone == null) return;
		const pageRow = e.target.closest("[data-page]");
		if (!pageRow) return;
		const zone = dropZone;
		e.preventDefault();
		e.stopImmediatePropagation();
		clearDropMarks();
		const target = S.pages[pageRow.dataset.page];
		const moved = S.pages[dragId];
		dragId = null; dragType = null; dropZone = null;
		if (!target || !moved || target.id === moved.id || isDescendant(target.id, moved.id)) return;
		// Geschwister des Ziels in Anzeige-Reihenfolge; neue Position = Mittelwert
		// der Sortierschlüssel der künftigen Nachbarn (STATE.sortKeyOf).
		const sibs = STATE.childrenOf(target.parentId || null, target.workspaceId || "default").filter((p) => p.id !== moved.id);
		const idx = sibs.findIndex((p) => p.id === target.id);
		if (idx === -1) return;
		const pos = zone === "before" ? idx : idx + 1;
		const prev = sibs[pos - 1], next = sibs[pos];
		const kPrev = prev ? STATE.sortKeyOf(prev) : null;
		const kNext = next ? STATE.sortKeyOf(next) : null;
		let order;
		if (kPrev != null && kNext != null) order = (kPrev + kNext) / 2;
		else if (kPrev != null) order = kPrev + 60000;
		else if (kNext != null) order = kNext - 60000;
		else order = Date.now();
		await STATE.dispatch("pageMove", { id: moved.id, parentId: target.parentId || null, order });
		// Workspace angleichen, falls über Workspace-Grenzen einsortiert wurde
		if ((moved.workspaceId || "default") !== (target.workspaceId || "default")) {
			await STATE.dispatch("pageUpdate", { id: moved.id, patch: { workspaceId: target.workspaceId || "default" } });
		}
	});
	document.addEventListener("drop", async (e) => {
		if (!dragId) return;
		const pageRow = e.target.closest("[data-page]");
		const deckRow = e.target.closest("[data-deck]");
		const inTree = e.target.closest("#tree");
		document.querySelectorAll(".row.drop-target").forEach((r) => r.classList.remove("drop-target"));
		if (!pageRow && !deckRow && !inTree) { dragId = null; dragType = null; return; }
		e.preventDefault();
		if (dragType === "page") {
			const targetId = pageRow ? pageRow.dataset.page : null;
			if (targetId !== dragId && !(targetId && isDescendant(targetId, dragId))) {
				await STATE.dispatch("pageMove", { id: dragId, parentId: targetId });
			}
		} else if (dragType === "deck") {
			const targetDeck = deckRow ? deckRow.dataset.deck : "";
			// Verhindern: Stapel in sich selbst oder in eigenen Unterstapel ziehen (Zyklus).
			if (targetDeck !== dragId && targetDeck !== "Standard" && !targetDeck.startsWith(dragId + "::")) {
				await STATE.dispatch("deckMove", { from: dragId, target: targetDeck });
				if (S.ankiDeck && (S.ankiDeck === dragId || S.ankiDeck.startsWith(dragId + "::"))) {
					const label = dragId.split("::").pop();
					const newRoot = (targetDeck ? targetDeck + "::" : "") + label;
					S.ankiDeck = newRoot + S.ankiDeck.slice(dragId.length);
				}
			}
		}
		dragId = null;
		dragType = null;
	});
	document.addEventListener("dragend", () => {
		document.querySelectorAll(".row.drop-target").forEach((r) => r.classList.remove("drop-target"));
		dragId = null;
	});

	// Chat — sowohl das Seitenpanel-Formular als auch das Vollbild-Chat-Tab-Formular
	// (letzteres wird bei jedem Render neu erzeugt, daher über Delegation abgefangen).
	document.addEventListener("submit", async (e) => {
		if (e.target.id === "chatForm") {
			e.preventDefault();
			const inp = U.el("chatInput");
			const text = inp.value.trim();
			inp.value = ""; syncComposer(inp);
			await sendChatMessage(text, "side");
		} else if (e.target.id === "mainChatForm") {
			e.preventDefault();
			const inp = U.el("mainChatInput");
			const text = inp.value.trim();
			inp.value = ""; syncComposer(inp);
			await sendChatMessage(text, "full");
		}
	});
	// Enter sendet, Shift+Enter = Zeilenumbruch (Seitenpanel + Vollbild-Chat)
	document.addEventListener("keydown", (e) => {
		if (e.key !== "Enter" || e.shiftKey) return;
		if (e.target.id === "chatInput") { e.preventDefault(); U.el("chatForm").requestSubmit(); }
		else if (e.target.id === "mainChatInput") { e.preventDefault(); U.el("mainChatForm").requestSubmit(); }
	});

	// ---------- Inline-Umbenennen (Seiten + Stapel) — Enter bestätigt, Esc/Blur bricht ab ----------
	async function commitRename(input) {
		if (input.dataset.renamename) {
			const id = input.dataset.renamename;
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
			const newLabel = input.value.trim().replace(/::/g, ":");
			const oldLabel = from.split("::").pop();
			S.renamingDeck = null;
			if (newLabel && newLabel !== oldLabel) {
				const prefix = from.includes("::") ? from.slice(0, from.lastIndexOf("::") + 2) : "";
				const to = prefix + newLabel;
				await STATE.dispatch("deckRename", { from, to });
				if (S.ankiDeck && (S.ankiDeck === from || S.ankiDeck.startsWith(from + "::"))) S.ankiDeck = to + S.ankiDeck.slice(from.length);
			}
			render();
		}
	}
	document.addEventListener("keydown", (e) => {
		if (!e.target.dataset.renamename && !e.target.dataset.deckrenamename) return;
		if (e.key === "Enter") { e.preventDefault(); commitRename(e.target); }
		else if (e.key === "Escape") {
			S.renamingPageId = null;
			S.renamingDeck = null;
			render();
		}
	});
	document.addEventListener("focusout", (e) => {
		if (e.target.dataset.renamename || e.target.dataset.deckrenamename) commitRename(e.target);
	});
	// Der große Chat wird dynamisch nach jedem Tab-/Chat-Render aufgebaut. Der
	// Observer hängt den Debug-Button deshalb ausschließlich in dessen Kopfzeile,
	// nie in den kleinen Seiten-Chat.
	const main = U.el("main");
	if (main) new MutationObserver(mountFullChatDebugButton).observe(main, { childList: true, subtree: true });
	mountFullChatDebugButton();

	// Tastenkombinationen (Shortcuts) registrieren
	SHORTCUTS.wireShortcuts();
	// Langen geklebten Text automatisch als .txt-Anhang behandeln statt im Feld auszuschreiben
	document.addEventListener("paste", (e) => {
		CHAT_FULLSCREEN.handlePaste(e);
	});
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
	openAnki,
	rateAndReviewCard,
	showStudyAnswer,
	gradeStudyCard,
	studySpaceOrEnter
};