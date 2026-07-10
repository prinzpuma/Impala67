"use strict";
import { CHATS } from "./chats.js";
import { COLLAPSE } from "./collapse.js";
import { DB } from "./db.js";
import { EDITOR } from "./editor.js";
import { PDFS } from "./pdfs.js";
import { RENDER_ANKI } from "./render-anki.js";
import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { SETTINGS } from "./settings.js";
import { LIBRARY } from "./library.js";
import { NLM } from "./notebooklm.js";
import { POPOVERS } from "./popovers.js";

const deckTreeHtml = (...args) => RENDER_ANKI.deckTreeHtml(...args);
const renderAnki = (...args) => RENDER_ANKI.renderAnki(...args);

// Gemeinsamer Icon-Helfer: eigenes Icon > PDF-Symbol > Fallback (Standard 📝).
// Ersetzt 8 vorher verstreute, fast identische Kopien in dieser Datei sowie in
// library.js und search.js (dort über RENDER.pageIconLabel/RENDER.pageIconHtml).
function pageIconLabel(pg, fallback) {
	if (pg.icon) return pg.icon;
	if (pg.pdfId) return "📄";
	return fallback === undefined ? "📝" : fallback;
}
function pageIconHtml(pg, fallback) {
	const icon = pageIconLabel(pg, fallback);
	return icon ? U.esc(icon) + " " : "";
}

// Aktiv im Block-Editor? Wird an mehreren Stellen gebraucht, um Re-Renders
// während des Tippens zu überspringen (Editor besitzt dann die Live-Ansicht).
function isEditingBlock() {
	const ae = document.activeElement;
	return !!(ae && ae.classList && ae.classList.contains("blk-input"));
}

// Fokus-Ziele, bei denen ein Neuaufbau von #main den Cursor/die Eingabe zerstören
// würde (Titel, Filter, Token-Felder, Block-/DB-Zellen-Editor).
const PROTECTED_FOCUS_IDS = new Set(["pageTitle", "inpWsName", "inpNotionToken", "inpNotionPage", "libFilter", "ankiSearch"]);
function isProtectedFocus(ae) {
	return !!ae && (PROTECTED_FOCUS_IDS.has(ae.id) || (ae.classList && (ae.classList.contains("blk-input") || ae.classList.contains("db-cell"))));
}

// render.js — UI-Aufbau im Notion-Stil: einklappbare Sidebar (Workspaces/Seiten
// oder Chat-Verlauf), Tab-Leiste mit Zurück/Vor, Notion-artiger Seitenkopf
// (Breadcrumb, Icon, Cover), Chat mit Modellwahl, Thinking- und Edit-Karten.
function render() {
	renderSidebar();
	renderMain();
	renderTabs();
	renderChat();
	if (S.view === "chat") renderMainChatLog();
	renderPendingChip("side");
	renderPendingChip("full");
	renderStatusDot();
	renderModelBar();
	const due = STATE.dueCards().length;
	const el = U.el("dueCount");
	if (el) el.textContent = due;
}

// PERF (10. Juli): Full-Render nach jedem dispatch() war der teuerste Hot Path.
// Content-Autosave (editor.save → pageUpdate {content}) triggert keinen Full-Render
// mehr, solange der Block-Editor den Fokus hat. Mehrere dispatches in einem Frame
// werden per rAF zu einem Render zusammengezogen.
let _renderRaf = 0;
function scheduleRender() {
	if (_renderRaf) return;
	_renderRaf = requestAnimationFrame(() => {
		_renderRaf = 0;
		render();
	});
}
function onStateChange(type, ev) {
	const p = (ev && ev.payload) || {};
	// Reiner Content-Patch: Editor besitzt die Live-Ansicht — Sidebar/Tabs/Chat
	// neu bauen wäre O(Seitenbaum + Chat-Markdown/Math) ohne sichtbaren Gewinn.
	if (type === "pageUpdate" && p.patch && Object.keys(p.patch).length === 1 && "content" in p.patch) {
		if (isEditingBlock()) return;
		// Externe Content-Änderung der geöffneten Seite (z.B. KI-Tool) → nur Main
		if (p.id === S.currentPageId && S.view === "page") {
			renderMain();
			return;
		}
		return;
	}
	// Modell-/Thinking-Umschalter: nur die Modell-Leiste, nicht die ganze App
	if (type === "settingsSet") {
		const keys = Object.keys(p);
		if (keys.length && keys.every((k) => k === "aiModel" || k === "aiProviderId" || k === "thinkingLevel")) {
			renderModelBar();
			return;
		}
	}
	scheduleRender();
}

function renderTopbar() {
	// Genau EINE UI-Pille aufgeklappt.
	// Expliziter Chat-Modus (Sidebar-Chatliste) hat Vorrang vor Anki — sonst
	// bleibt nach Karten → Chat die Karten-Pille aktiv und die Chat-Pille wächst
	// erst, wenn man einen Chat anklickt (openPage setzt view auf "chat").
	const mode = S.sidebarMode === "chats" ? "chats"
		: (S.view === "anki" ? "anki" : "files");
	const home = U.el("btnHome");
	const chat = U.el("btnChatTab");
	const anki = U.el("btnAnki");
	if (home) home.classList.toggle("active", mode === "files");
	if (chat) chat.classList.toggle("active", mode === "chats");
	if (anki) anki.classList.toggle("active", mode === "anki");
	const lib = U.el("btnLibrary");
	if (lib) lib.classList.toggle("active", S.view === "library");
	const daily = U.el("btnDaily");
	if (daily) daily.classList.toggle("active", S.view === "daily");
}

function aiStatusMeta() {
	if (S.aiOnline === true) return { cls: "online", title: "KI verbunden", label: "KI online" };
	if (S.aiOnline === false) return { cls: "offline", title: "KI nicht erreichbar (Einstellungen → KI prüfen)", label: "KI offline" };
	return { cls: "checking", title: "KI-Status wird geprüft…", label: "KI …" };
}

// KI-Status-Pille nur im Chat (Side-Panel-Header + Vollbild-Chat-Header).
// Nicht in Tab-Leiste / FAB / Mobile — dort stört sie und ist oft unsichtbar relevant.
function fillAiStatusChip(chip, meta) {
	if (!chip) return;
	chip.className = "ai-status-chip" + (meta.cls ? " " + meta.cls : "");
	chip.title = meta.title + " — Klick: erneut prüfen";
	chip.innerHTML = '<span class="dot ' + meta.cls + '"></span><span class="ai-status-label">' + U.esc(meta.label) + "</span>";
	chip.hidden = false;
}
function renderStatusDot() {
	const meta = aiStatusMeta();
	// Side-Panel nur füllen, wenn Panel sichtbar (Chat offen)
	const panelOpen = !document.body.classList.contains("panel-collapsed") || document.body.classList.contains("chat-full");
	const sideChip = U.el("aiStatusChip");
	if (sideChip) {
		if (panelOpen) fillAiStatusChip(sideChip, meta);
		else sideChip.hidden = true;
	}
	// Vollbild-Chat: nur wenn view === chat
	const fullChip = U.el("aiStatusChipFull");
	if (fullChip) {
		if (S.view === "chat") fillAiStatusChip(fullChip, meta);
		else fullChip.hidden = true;
	}
	const set = U.el("aiStatusSettings");
	if (set) {
		set.className = "ai-status-banner" + (meta.cls ? " " + meta.cls : "");
		set.innerHTML = '<span class="dot ' + meta.cls + '"></span><span>' + U.esc(meta.title) + '</span>' +
			'<button type="button" id="btnRecheckAI" class="mini">Erneut prüfen</button>';
	}
}

// Aktuelles Modell als lesbares Label ("Quelle · modell").
function currentModelLabel() {
	const cur = S.settings.aiModel || "";
	const pr = (S.settings.aiProviders || []).find((p) => p.id === S.settings.aiProviderId);
	return cur ? ((pr ? pr.name + " · " : "") + cur) : "Kein Modell";
}

// Aktualisiert beide Auslöser: das kompakte Icon im kleinen Chat-Panel und den
// Modell-Chip unten rechts im großen Chat-Fenster (wie in Notion).
function renderModelBar() {
	const label = currentModelLabel();
	const modelIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="8" x2="20" y2="8"/><circle cx="9" cy="8" r="2.6" fill="currentColor"/><line x1="4" y1="16" x2="20" y2="16"/><circle cx="15" cy="16" r="2.6" fill="currentColor"/></svg>';
	const chip = U.el("btnModelChipFull");
	if (chip) { chip.innerHTML = modelIcon; chip.title = "Modell: " + label; }
	const icon = U.el("btnModelMenu");
	if (icon) { icon.innerHTML = modelIcon; icon.title = "Modell: " + label; }
	renderModelMenu();
}

// Baut den Inhalt des einheitlichen Modell-Dropdowns: nach Quelle gruppiert, das
// aktive Modell mit Häkchen, unten ein Bereich für ein frei eingetipptes Modell
// (Quelle über Chips wählbar statt über ein hässliches natives <select>).
function modelMenuInnerHtml() {
	const providers = S.settings.aiProviders || [];
	const curProviderId = S.settings.aiProviderId || "";
	const curModel = S.settings.aiModel || "";
	const live = S.availableModels || [];
	const section = S.modelMenuSection || "root";
	const back = '<button class="model-submenu-back" data-modelmenuback="1">‹ Zurück</button>';
	if (section === "root") {
		const thinking = S.settings.thinkingLevel || "auto";
		return '<button class="model-submenu-row" data-modelsubmenu="models"><span>Modell</span><small>' + U.esc(currentModelLabel()) + ' ›</small></button>' +
			'<button class="model-submenu-row" data-modelsubmenu="thinking"><span>Thinking</span><small>' + U.esc(thinking === "auto" ? "Automatisch" : thinking[0].toUpperCase() + thinking.slice(1)) + ' ›</small></button>';
	}
	if (section === "thinking") {
		const cur = S.settings.thinkingLevel || "auto";
		const levels = [["auto", "Automatisch"], ["low", "Niedrig"], ["medium", "Mittel"], ["high", "Hoch"]];
		return back + '<div class="menu-label">Thinking-Stufe</div><div class="menu-note">Wirkt nur bei Modellen und APIs, die Thinking unterstützen.</div>' +
			levels.map(([id, label]) => '<button class="menu-item' + (id === cur ? " active" : "") + '" data-thinkinglevel="' + id + '">' +
				'<span class="menu-item-label">' + label + '</span>' + (id === cur ? '<span class="menu-check">✓</span>' : "") + '</button>').join("");
	}
	let html = back + '<div class="menu-label">Verfügbare Modelle</div>';
	if (S.modelMenuLoading) return html + '<div class="menu-note">Modelle werden geladen…</div>';
	const opt = (prId, value, active) => '<button class="menu-item' + (active ? " active" : "") + '" data-modelset="' + U.esc(prId) + "::" + U.esc(value) + '">' +
		'<span class="menu-item-label">' + U.esc(value) + '</span>' + (active ? '<span class="menu-check">✓</span>' : "") + '</button>';
	providers.forEach((pr) => {
		const liveForPr = live.filter((m) => m.providerId === pr.id);
		if (!liveForPr.length) return;
		html += '<div class="menu-label">' + U.esc(pr.name || pr.id) + '</div>' +
			liveForPr.map((m) => opt(pr.id, m.id, pr.id === curProviderId && m.id === curModel)).join("");
	});
	return html === back + '<div class="menu-label">Verfügbare Modelle</div>'
		? html + '<div class="menu-note">Gerade ist kein Modell erreichbar oder geladen.</div>' : html;
}

// Zeigt/versteckt beide Dropdown-Container (kleines Panel + großes Chat-Fenster)
// und befüllt den gerade geöffneten mit demselben Inhalt — ein Design für beide.
function renderModelMenu() {
	const inner = modelMenuInnerHtml();
	["modelMenu", "modelMenuFull"].forEach((id) => {
		const el = U.el(id);
		if (!el) return;
		const which = id === "modelMenuFull" ? "full" : "panel";
		const show = S.modelMenuOpen && (S.modelMenuAnchor || "panel") === which;
		el.hidden = !show;
		if (show) {
			el.innerHTML = inner;
			// Beide Chat-Varianten verwenden dieselbe Messung und erscheinen dadurch
			// direkt über ihrem jeweiligen Regler-Icon.
			POPOVERS.position(U.el(which === "full" ? "btnModelChipFull" : "btnModelMenu"), el, { prefer: "above", gap: 6 });
		}
	});
}

// ---------- Ein-/Ausklappen (Workspaces + Unterseiten, bleibt über Neustarts erhalten) ----------
function wsHeadHtml(ws) {
	const key = "ws:" + ws.id;
	const collapsed = COLLAPSE.isCollapsed(key);
	return '<div class="ws-head">' +
		'<button class="row-chevron ws-chevron' + (collapsed ? "" : " open") + '" data-collapse="' + key + '" title="Ein-/Ausklappen">▸</button>' +
		'<span class="ws-name">' + U.esc(ws.name) + "</span>" +
		'<button class="mini" data-newpage="' + ws.id + '" title="Neue Seite in ' + U.esc(ws.name) + '">+</button></div>';
}

// Sidebar: "files" = Workspaces mit einklappbarem Seitenbaum, "chats" = Chat-Verlauf
function renderSidebar() {
	renderTopbar();
	const tree = U.el("tree");
	if (!tree) return;
	// FIX: ein Hintergrund-Render (z.B. durch einen Content-Patch anderswo) konnte
	// bisher mitten im Umbenennen einer Seite/eines Stapels den kompletten Baum neu
	// aufbauen und dabei Fokus + bereits getippten Text im Umbenennen-Feld zerstören.
	// Der eigentliche Commit-/Abbrechen-Render läuft weiterhin normal durch, weil er
	// die renamingPageId/renamingDeck-Flags VOR dem Aufruf von render() bereits leert.
	const ae = document.activeElement;
	if ((S.renamingPageId || S.renamingDeck) && ae && ae.dataset && (ae.dataset.renamename || ae.dataset.deckrenamename)) return;

	// Explizit gewählter Chat-Modus hat Vorrang — sonst ist die Chat-Liste
	// aus der Anki-Ansicht heraus nie erreichbar (Chat-Knopf wirkte "tot").
	if (S.sidebarMode === "chats") {
		tree.innerHTML = chatListHtml();
		return;
	}

	// Im Karteikarten-Bereich zeigt die linke Spalte den Stapel-Baum — wie der
	// Seitenbaum im Home-Tab: Unterstapel anlegen, ein-/ausklappen, umbenennen.
	if (S.view === "anki") {
		tree.innerHTML = deckTreeHtml();
		return;
	}

	let html = "";
	// ★ Favoriten — gepinnte Seiten immer oben in der Sidebar
	const favs = STATE.activePages().filter((p) => p.favorite);
	if (favs.length) {
		html += '<div class="ws-head"><span class="ws-name">★ Favoriten</span></div>' +
			favs.map((p) => rowHtml(p, 0, p.workspaceId)).join("");
	}
	for (const ws of Object.values(S.workspaces)) {
		html += wsHeadHtml(ws);
		if (!COLLAPSE.isCollapsed("ws:" + ws.id)) {
			html += branchHtml(null, 0, ws.id) || '<div class="empty small">Keine Seiten</div>';
		}
	}
	tree.innerHTML = html;
}

// Chat-Verlauf in der Sidebar (Chat-Modus) — die Volltextsuche über Titel UND Inhalte läuft jetzt im Befehls-Menü (Strg+K).
function chatListHtml() {
	const sessions = (typeof CHATS !== "undefined") ? CHATS.load() : [];
	let html = '<div class="row" data-newchat="1"><span class="row-title">＋ Neuer Chat</span></div>';
	html += sessions.map((s) =>
		'<div class="row' + (s.id === S.currentChatId ? " active" : "") + '" data-chat="' + s.id + '">' +
		'<span class="row-title">' + U.esc(s.title || "Chat") + "</span>" +
		'<span class="hint">' + U.fmtDate(s.updated || s.created) + "</span>" +
		'<button class="row-add" data-chatrename="' + s.id + '" title="Chat umbenennen">✎</button>' +
		'<button class="row-add danger" data-chatdel="' + s.id + '" title="Chat löschen">🗑</button></div>'
	).join("");
	return html;
}

function branchHtml(parentId, depth, wsId) {
	if (depth > 8) return "";
	return STATE.childrenOf(parentId, wsId).map((pg) => rowHtml(pg, depth, wsId)).join("");
}

function rowHtml(pg, depth, wsId) {
	const active = pg.id === S.currentPageId && S.view === "page" ? " active" : "";
	const kids = STATE.childrenOf(pg.id, wsId || pg.workspaceId);
	const hasKids = kids.length > 0;
	const collapsed = COLLAPSE.isCollapsed(pg.id);
	const chevron = hasKids
		? '<button class="row-chevron' + (collapsed ? "" : " open") + '" data-collapse="' + pg.id + '" title="Ein-/Ausklappen">▸</button>'
		: '<span class="row-chevron spacer"></span>';
	const childHtml = hasKids && !collapsed ? branchHtml(pg.id, depth + 1, wsId || pg.workspaceId) : "";
	const menuOpen = S.pageMenuOpenId === pg.id;
	const renaming = S.renamingPageId === pg.id;
	return '<div class="row' + active + '" draggable="true" data-page="' + pg.id + '" style="padding-left:'
		+ (6 + depth * 16) + 'px">' +
		chevron +
		(renaming
			? '<input class="row-rename-input" data-renamename="' + U.esc(pg.id) + '" value="' + U.esc(pg.title) + '" autocomplete="off">'
			: '<span class="row-title">' + pageIconHtml(pg, "") + U.esc(pg.title) + "</span>") +
		'<button class="row-add" data-pagemenu="' + pg.id + '" title="Weitere Optionen">⋯</button>' +
		'<button class="row-add" data-addchild="' + pg.id + '" title="Unterseite anlegen">+</button>' +
		(menuOpen ? pageMenuHtml(pg) : "") +
		"</div>" + childHtml;
}

// Notion-artiges ⋯-Menü je Seite: Umbenennen, Duplizieren, Vorlage, Löschen (→ Papierkorb).
function pageMenuHtml(pg) {
	return '<div class="page-menu">' +
		'<button class="menu-item" data-pagerename="' + pg.id + '">✎ Umbenennen</button>' +
		'<button class="menu-item" data-pageduplicate="' + pg.id + '">📋 Duplizieren</button>' +
		'<button class="menu-item" data-pagetemplate="' + pg.id + '">📑 ' + (pg.isTemplate ? "Vorlage entfernen" : "Als Vorlage") + "</button>" +
		'<button class="menu-item" data-pagefav="' + pg.id + '">' + (pg.favorite ? "★ Favorit entfernen" : "☆ Zu Favoriten") + "</button>" +
		'<button class="menu-item" data-pagemove="' + pg.id + '">📦 Verschieben nach…</button>' +
		'<button class="menu-item danger" data-pagetrash="' + pg.id + '">🗑 Löschen</button>' +
		"</div>";
}

// ---------- Tab-Leiste (Zurück/Vor + offene Seiten UND Chats, wie eine Notion-Tableiste) ----------
function renderTabs() {
	const bar = U.el("tabbar");
	if (!bar) return;
	const canBack = S.navIndex > 0;
	const canFwd = S.navIndex < S.navHistory.length - 1;
	// Chat-Titel einmal laden (nicht pro Tab CHATS.load())
	const chatById = new Map();
	try { CHATS.load().forEach((s) => chatById.set(s.id, s)); } catch { /* ignore */ }
	let html = '<button class="navbtn" id="btnSidebarToggle" title="Seitenleiste ein-/ausblenden">☰</button>' +
		'<button class="navbtn" id="btnNavBack" ' + (canBack ? "" : "disabled") + ' title="Zurück">‹</button>' +
		'<button class="navbtn" id="btnNavForward" ' + (canFwd ? "" : "disabled") + ' title="Vor">›</button>' +
		'<div class="tabstrip">';
	html += S.tabs.map((id) => {
		let title = "";
		const isChat = id.startsWith("chat:");
		const isNlm = id === "nlm:main";
		if (isChat) {
			const s = chatById.get(id.slice(5));
			// ✦ statt 💬 — gleiches KI-Markenzeichen wie Home/FAB, kein lila Bubble-Emoji
			title = "✦ " + U.esc(s ? (s.title || "Chat") : "Chat");
		} else if (isNlm) {
			title = "📓 NotebookLM";
		} else {
			const pg = S.pages[id];
			if (!pg) return "";
			title = pageIconHtml(pg) + U.esc(pg.title);
		}
		const active = id === S.activeTabId && ((isChat && S.view === "chat") || (isNlm && S.view === "notebooklm") || (!isChat && !isNlm && S.view === "page")) ? " active" : "";
		return '<div class="tabchip' + active + '" data-tabopen="' + id + '">' +
			'<span class="tabchip-title">' + title + '</span>' +
			'<button class="tabchip-x" data-tabclose="' + id + '" title="Schließen">✕</button></div>';
	}).join("");
	// Notion-artiges „+“: öffnet einen neuen Tab (Navigation ersetzt sonst den aktuellen)
	html += '<button class="tabchip tabchip-new" id="btnTabNew" data-tabnew="1" title="Neuen Tab öffnen">＋</button>';
	html += "</div>";
	bar.innerHTML = html;
}

function renderMain() {
	// Nicht neu bauen, während der Nutzer tippt (Cursor bleibt erhalten)
	if (isProtectedFocus(document.activeElement)) return;

	const main = U.el("main");
	if (!main) return;
	// Eingebettetes NotebookLM-Webview (Desktop) liegt als OS-Overlay über der UI —
	// verlässt der Nutzer den Tab, muss es aktiv ausgeblendet werden (kein DOM-Element).
	if (S.view !== "notebooklm") NLM.hideEmbeddedIfActive();
	if (S.view === "library") { LIBRARY.renderLibrary(main); return; }
	if (S.view === "anki") { renderAnki(main); return; }
	if (S.view === "daily") { renderDaily(main); return; }
	if (S.view === "trash") { renderTrash(main); return; }
	if (S.view === "chat") { renderFullChat(main); return; }
	if (S.view === "notebooklm") { NLM.renderPane(main); return; }
	const pg = S.currentPageId ? S.pages[S.currentPageId] : null;
	if (S.view === "home" || !pg) { renderHome(main); return; }

	// Wie in Notion: nur noch EINE, durchgehend bearbeitbare und angezeigte Ansicht —
	// kein Moduswechsel mehr. Der Block-Editor (editor.js) ist immer aktiv.
	main.innerHTML =
		'<div class="page-meta">' +
			'<div class="page-topbar">' + breadcrumbHtml(pg) + topbarActionsHtml(pg) + "</div>" +
			(pg.coverImg || pg.cover
				? '<div class="page-cover ' + (pg.coverImg ? "has-img" : "cover-" + pg.cover) + '"' + (pg.coverImg ? ' data-coverimg="' + U.esc(pg.coverImg) + '"' : "") + '><div class="cover-btns">' +
					'<button data-coverpick="1">Cover ändern</button><button data-coverremove="1">Entfernen</button>' +
					"</div></div>"
				: "") +
			'<div class="page-heading">' +
				'<button class="page-icon" data-iconpick="1" title="Icon ändern">' + pageIconLabel(pg) + "</button>" +
				(!pg.cover && !pg.coverImg ? '<button class="addcover-btn" data-coverpick="1">＋ Cover</button>' : "") +
			"</div>" +
			'<input id="pageTitle" value="' + U.esc(pg.title) + '" autocomplete="off">' +
			backlinksChipHtml(pg) +
		"</div>" +
		(pg.db ? dbTableHtml(pg) : "") +
		'<div class="editor-wrap"><div id="blockEditor" class="block-editor"></div></div>' +
		// src="about:blank" verhindert die Chrome-Warnung "Unsafe attempt to load URL file://..."
		// (ein iframe ohne src lädt sonst die eigene Seiten-URL als Platzhalter).
		(S.pdfOpen && pg.pdfId ? '<iframe id="pdfFrame" class="pdf-frame" src="about:blank" title="PDF"></iframe>' : "");
	hydrateCovers(main);
	if (typeof EDITOR !== "undefined") {
		const beHost = U.el("blockEditor");
		if (beHost) EDITOR.mount(beHost, pg.id);
	}
	if (S.pdfOpen && pg.pdfId) {
		PDFS.urlFor(pg.pdfId).then((u) => {
			const f = U.el("pdfFrame");
			if (f && u) f.src = u;
		});
	}
}

// Notion-artige Topbar rechts: Teilen-Menü, Favoriten-Stern, ⋯-Menü.
// Verhalten: Stern & Menüpunkte laufen über app.js, Menü-Auf/Zu über extras.js.
function topbarActionsHtml(pg) {
	return '<div class="topbar-actions">' +
		'<span class="topbar-wrap"><button class="topbar-btn" data-sharemenu="1" title="Exportieren & Teilen">↗ Teilen</button>' +
			(S.topMenu === "share" ? shareMenuHtml(pg) : "") + "</span>" +
		'<button class="topbar-btn' + (pg.favorite ? " fav-active" : "") + '" data-pagefav="' + pg.id + '" title="' + (pg.favorite ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen") + '">' + (pg.favorite ? "★" : "☆") + "</button>" +
		'<span class="topbar-wrap"><button class="topbar-btn" data-morepagemenu="1" title="Weitere Optionen">⋯</button>' +
			(S.topMenu === "more" ? moreMenuHtml(pg) : "") + "</span>" +
	"</div>";
}

function shareMenuHtml(pg) {
	return '<div class="page-menu top-menu">' +
		'<button class="menu-item" data-exportpdf="' + pg.id + '">🖨 Als PDF exportieren / drucken</button>' +
		'<button class="menu-item" data-exportmd="' + pg.id + '">⬇ Als Markdown (.md) speichern</button>' +
		'<button class="menu-item" data-copylink="' + pg.id + '">🔗 Internen Link kopieren</button>' +
	"</div>";
}

function moreMenuHtml(pg) {
	const marks = ((pg.content || "").match(/==[^=\n]+==/g) || []).length + ((pg.content || "").match(/\{\{c\d+::/g) || []).length;
	return '<div class="page-menu top-menu">' +
		'<button class="menu-item" data-editundo="1">↩ Rückgängig <span class="menu-hint">Strg+Z</span></button>' +
		'<button class="menu-item" data-editredo="1">↪ Wiederholen <span class="menu-hint">Strg+Y</span></button>' +
		'<div class="menu-sep"></div>' +
		'<button class="menu-item" id="btnHistory">🕘 Verlauf</button>' +
		(pg.pdfId ? '<button class="menu-item" id="btnOpenPdf">' + (S.pdfOpen ? "📄 PDF schließen" : "📄 PDF anzeigen") + "</button>" : "") +
		'<button class="menu-item" data-iconpick="1">😀 Icon ändern</button>' +
		'<button class="menu-item" data-coverpick="1">🖼 Cover ändern</button>' +
		(marks ? '<button class="menu-item" data-cardsfromhl="' + pg.id + '">🃏 Karten aus Markierungen (' + marks + ")</button>" : "") +
		'<button class="menu-item" data-pageduplicate="' + pg.id + '">📋 Duplizieren</button>' +
		'<button class="menu-item" data-pagetemplate="' + pg.id + '">📑 ' + (pg.isTemplate ? "Vorlage entfernen" : "Als Vorlage") + "</button>" +
		'<button class="menu-item" data-pagemove="' + pg.id + '">📦 Verschieben nach…</button>' +
		'<button class="menu-item danger" data-pagetrash="' + pg.id + '">🗑 Löschen</button>' +
	"</div>";
}

// „↙ N Rückverweise“ unter dem Titel (wie in Notion) — Klick klappt die Liste auf.
function backlinksChipHtml(pg) {
	const links = STATE.backlinksOf(pg.id);
	if (!links.length) return "";
	let html = '<div class="backlinks-row"><button class="backlinks-chip" data-backlinks="1">↙ ' + links.length + " Rückverweise</button>";
	if (S.backlinksOpen) {
		html += '<div class="backlinks">' + links.slice(0, 20).map((l) =>
			'<span class="crumb" data-page="' + l.id + '">' + pageIconHtml(l) + U.esc(l.title) + "</span>").join("") + "</div>";
	}
	return html + "</div>";
}

// ---------- Datenbank-Ansicht (echte Datenbanken statt kopierter Tabellen) ----------
// Eine Datenbank-Seite (pg.db) zeigt ihre Unterseiten als editierbare Tabelle:
// Spalten = pg.db.schema, Zellwerte = props der Zeilen-Seiten. Zellen-Änderungen
// laufen als normales pageUpdate-Event → Verlauf, Diff und Notion-Sync greifen.
function dbTableHtml(pg) {
	const cols = ((pg.db && pg.db.schema) || []).filter((c) => c.type !== "title");
	const rows = STATE.childrenOf(pg.id, pg.workspaceId);
	const RO = { formula: 1, rollup: 1, created_time: 1, last_edited_time: 1, created_by: 1, last_edited_by: 1, people: 1, relation: 1, files: 1, button: 1, unique_id: 1, verification: 1 };
	return '<div class="db-view md"><table class="db-table"><thead><tr><th>Name</th>' +
		cols.map((c) => "<th title='" + U.esc(c.type || "text") + "'>" + U.esc(c.name) + "</th>").join("") +
		"</tr></thead><tbody>" +
		rows.map((r) => '<tr><td><span class="crumb" data-page="' + r.id + '">' + pageIconHtml(r) + U.esc(r.title) + "</span></td>" +
			cols.map((c) => RO[c.type]
				? '<td><span class="hint">' + U.esc((r.props || {})[c.name] || "") + "</span></td>"
				: '<td><input class="db-cell" data-dbrow="' + r.id + '" data-dbcol="' + U.esc(c.name) + '" value="' + U.esc((r.props || {})[c.name] || "") + '"></td>').join("") +
		"</tr>").join("") +
		"</tbody></table>" +
		'<div class="row-btns" style="margin:8px 0 14px"><button class="mini" data-dbnewrow="' + pg.id + '">＋ Neue Zeile</button></div></div>';
}

// Breadcrumb: Workspace › Elternseiten › aktuelle Seite (wie in Notion)
function ancestorsOf(pg) {
	const chain = [];
	let cur = pg;
	while (cur && cur.parentId) {
		cur = S.pages[cur.parentId];
		if (cur) chain.unshift(cur);
	}
	return chain;
}

function breadcrumbHtml(pg) {
	const ws = S.workspaces[pg.workspaceId] || { name: "Privat" };
	const chain = ancestorsOf(pg);
	let html = '<div class="breadcrumb"><span class="crumb" data-crumbws="1">' + U.esc(ws.name) + "</span>";
	chain.forEach((a) => {
		html += '<span class="crumb-sep">/</span><span class="crumb" data-page="' + a.id + '">' + U.esc(a.title) + "</span>";
	});
	html += '<span class="crumb-sep">/</span><span class="crumb current">' + U.esc(pg.title) + "</span></div>";
	return html;
}

// ---- Sync-Konflikte: Pending-Liste + Lösungs-Popup mit Diff -----
const CONFLICT_KEY = "impala67_pending_conflicts";
function isConflictPage(p) {
	return !!(p && ((p.id || "").startsWith("conflictpg-") || (p.title || "").startsWith("⚠ Konflikt")));
}
function loadPendingConflicts() {
	try { return JSON.parse(localStorage.getItem(CONFLICT_KEY) || "[]"); } catch { return []; }
}
function savePendingConflicts(list) {
	if (!list || !list.length) localStorage.removeItem(CONFLICT_KEY);
	else localStorage.setItem(CONFLICT_KEY, JSON.stringify(list));
}
function mergePendingConflicts(details) {
	const map = new Map(loadPendingConflicts().map((c) => [c.conflictPageId || c.pageId, c]));
	for (const c of details || []) map.set(c.conflictPageId || c.pageId, c);
	savePendingConflicts([...map.values()]);
}
function fmtConflictTime(iso) {
	try { return new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }); }
	catch { return iso || "?"; }
}
function legacyConflictItems() {
	return STATE.activePages().filter(isConflictPage).map((p) => ({
		pageId: null,
		title: (p.title || "").replace(/^⚠ Konflikt:\s*/, "").split(" — Stand")[0],
		reason: "Unterlegener Stand einer früheren Sync-Kollision. Vergleiche den Text und entscheide, was behalten wird.",
		localContent: p.content || "",
		remoteContent: "",
		localTime: p.updated,
		remoteTime: null,
		winner: "remote",
		loserContent: p.content || "",
		loserTime: p.updated,
		conflictPageId: p.id,
		eventId: null,
		legacy: true,
	}));
}
function openConflictResolver(index) {
	let items = loadPendingConflicts();
	if (!items.length) items = legacyConflictItems();
	if (!items.length) { U.toast("Keine offenen Konflikte.", "success"); return; }
	const i = Math.max(0, Math.min(Number(index) || 0, items.length - 1));
	S.conflictResolveIndex = i;
	S.conflictResolveList = items;
	const c = items[i];
	const o = U.el("overlay");
	if (!o) return;
	const left = c.localContent || "";
	const right = c.remoteContent || "";
	const diff = U.diffLines(left, right);
	const diffHtml = diff.map((d) => {
		if (d.type === "same") return '<div class="change-line same">' + U.esc(d.text) + "</div>";
		return '<div class="change-line ' + d.type + '">' + (d.type === "add" ? "+ " : "− ") + U.esc(d.text) + "</div>";
	}).join("");
	const winnerLabel = c.winner === "local" ? "dieses Gerät (neuerer Zeitstempel)" : "anderer Stand / Drive (neuerer Zeitstempel)";
	o.hidden = false;
	o.innerHTML = '<div class="modal conflict-modal">' +
		'<button class="modal-x" id="btnCloseOverlay" title="Schließen">✕</button>' +
		'<header class="conflict-head"><span class="conflict-icon">⚠</span><span><b>Sync-Konflikt' +
		(items.length > 1 ? " (" + (i + 1) + "/" + items.length + ")" : "") + "</b><small>" +
		U.esc(c.title || "Seite") + "</small></span></header>" +
		'<div class="conflict-reason"><b>Warum?</b> ' + U.esc(c.reason || "") +
		(c.legacy ? "" : '<br><span class="hint">Lokal: ' + U.esc(fmtConflictTime(c.localTime)) +
		" · Remote: " + U.esc(fmtConflictTime(c.remoteTime)) + " · Gewinner: " + winnerLabel + "</span>") +
		'<br><span class="hint">Im Diff: <b>−</b> nur auf diesem Gerät · <b>+</b> nur auf dem anderen Stand · unmarkiert = gleich.</span></div>' +
		'<div class="conflict-legend"><span class="leg del">− nur hier</span><span class="leg add">+ anderer Stand</span><span class="leg same">gleich</span></div>' +
		'<div class="change-preview-diff conflict-diff">' + (diffHtml || '<div class="hint">Keine Textunterschiede (oder nur Legacy-Kopie ohne Gegenseite).</div>') + "</div>" +
		'<div class="conflict-actions">' +
		(items.length > 1 ? '<button data-conflictnav="-1">‹ Zurück</button><button data-conflictnav="1">Weiter ›</button>' : "") +
		(c.pageId ? '<button data-conflictpage="' + U.esc(c.pageId) + '">Original öffnen</button>' : "") +
		(c.conflictPageId ? '<button data-conflictpage="' + U.esc(c.conflictPageId) + '">Konflikt-Kopie öffnen</button>' : "") +
		'<button class="primary" data-conflictresolve="keep-winner">Gewinner behalten</button>' +
		(c.pageId && !c.legacy ? '<button data-conflictresolve="use-loser">Unterlegenen übernehmen</button>' : "") +
		'<button data-conflictresolve="keep-both">Beide behalten</button>' +
		"</div></div>";
}
async function resolveConflict(action) {
	const list = S.conflictResolveList || loadPendingConflicts();
	const i = S.conflictResolveIndex || 0;
	const conf = list[i];
	if (!conf) return;
	if (action === "use-loser" && conf.pageId) {
		await STATE.dispatch("pageUpdate", { id: conf.pageId, patch: { content: conf.loserContent } });
	}
	if ((action === "keep-winner" || action === "use-loser") && conf.conflictPageId && S.pages[conf.conflictPageId]) {
		await STATE.dispatch("pageTrash", { id: conf.conflictPageId });
	}
	// Pending bereinigen (auch wenn nur „beide behalten“ → aus der Warteschlange)
	const next = loadPendingConflicts().filter((x) => (x.conflictPageId || x.pageId) !== (conf.conflictPageId || conf.pageId));
	savePendingConflicts(next);
	if (next.length || (action === "keep-both" && legacyConflictItems().length)) {
		openConflictResolver(Math.min(i, Math.max(0, next.length - 1)));
		render();
		return;
	}
	const o = U.el("overlay");
	if (o) { o.hidden = true; o.innerHTML = ""; }
	U.toast("Konflikt erledigt.", "success");
	render();
}

// Persönliches Home: ruhig, wenig Flächen — Fokus statt Widget-Wand.
// Keine großen Dashboard-Kacheln mehr; nur Hero, Aktionen, Heute-Leiste und Listen.
// (Dashboard-Widget-Einstellungen bleiben in den Settings, steuern hier aber nichts mehr.)
function renderHome(main) {
	const pages = STATE.activePages();
	const pendingConflicts = loadPendingConflicts();
	const conflictPages = pages.filter(isConflictPage);
	const conflictCount = Math.max(pendingConflicts.length, conflictPages.length);
	const recent = pages.filter((p) => !isConflictPage(p)).slice().sort((a, b) => (b.updated || "").localeCompare(a.updated || "")).slice(0, 6);
	const chats = CHATS.load().slice().sort((a, b) => (b.updated || b.created || "").localeCompare(a.updated || a.created || ""));
	const due = STATE.dueCards().length;
	const lastBk = localStorage.getItem("impala67LastBackup") || localStorage.getItem("notionLastBackup");
	const bkDays = lastBk ? Math.max(0, Math.floor((Date.now() - new Date(lastBk).getTime()) / 864e5)) : null;
	const bkDue = pages.length > 3 && (bkDays === null || bkDays > 7);
	const todayKey = localDayKey(new Date());
	const daily = pages.find((p) => p.daily === todayKey);
	const dailyLine = daily ? ((daily.content || "").split("\n").find((l) => l.trim()) || "").replace(/^#+\s*/, "").slice(0, 48) : "";
	const hour = new Date().getHours();
	const greeting = hour < 5 ? "Gute Nacht" : hour < 11 ? "Guten Morgen" : hour < 18 ? "Guten Tag" : "Guten Abend";

	const conflictBanner = conflictCount
		? '<div class="conflict-banner"><div class="conflict-banner-copy"><b>⚠ ' + conflictCount + " Sync-Konflikt" + (conflictCount === 1 ? "" : "e") +
			"</b><span>Gleiche Seite auf mehreren Geräten geändert — Diff prüfen & lösen.</span></div>" +
			'<button data-conflictopen="0">Jetzt lösen</button></div>'
		: "";

	// Kompakte „Heute“-Leiste statt großer Widget-Kacheln
	const todayPills =
		'<div class="home-today">' +
			'<button class="home-pill" data-homeaction="daily" title="Daily Note">' +
				'<span class="home-pill-ico">📅</span><span class="home-pill-body"><b>Daily</b><small>' +
				U.esc(dailyLine || (daily ? "Öffnen" : "Heute anlegen")) + "</small></span></button>" +
			'<button class="home-pill' + (due ? " attention" : "") + '" data-homeaction="cards" title="Karteikarten">' +
				'<span class="home-pill-ico">🃏</span><span class="home-pill-body"><b>' + due + " fällig</b><small>" +
				(due ? "Jetzt lernen" : "Alles erledigt") + "</small></span></button>" +
			(bkDue
				? '<button class="home-pill attention" data-homeaction="backup" title="Backup">' +
					'<span class="home-pill-ico">↥</span><span class="home-pill-body"><b>Backup</b><small>' +
					(bkDays === null ? "Noch keins" : "Vor " + bkDays + " Tag" + (bkDays === 1 ? "" : "en")) +
					"</small></span></button>"
				: "") +
		"</div>";

	const continueBlock = recent[0]
		? '<button class="home-continue" data-page="' + recent[0].id + '">' +
			'<span class="recent-icon">' + U.esc(pageIconLabel(recent[0])) + '</span>' +
			'<span class="recent-copy"><small>Weitermachen</small><b>' + U.esc(recent[0].title) +
			'</b><small>Zuletzt · ' + U.fmtDate(recent[0].updated) + '</small></span><span class="recent-arrow">›</span></button>'
		: '<button class="home-continue muted" data-homeaction="newpage">' +
			'<span class="recent-icon">✦</span><span class="recent-copy"><small>Start</small><b>Erste Seite anlegen</b>' +
			'<small>Workspace ist noch leer</small></span><span class="recent-arrow">›</span></button>';

	const recentPages = recent.length
		? '<div class="home-list">' + recent.map((pg) =>
			'<button class="home-list-row" data-page="' + pg.id + '">' +
			'<span class="recent-icon sm">' + U.esc(pageIconLabel(pg)) + "</span><b>" + U.esc(pg.title) +
			"</b><small>" + U.fmtDate(pg.updated) + "</small><i>›</i></button>").join("") + "</div>"
		: '<div class="empty-state compact"><b>Noch keine Seiten</b><p>Leg die erste an oder öffne die Bibliothek.</p>' +
			'<button data-homeaction="newpage">Neue Seite</button></div>';

	const recentChats = chats.slice(0, 3).map((chat) =>
		'<button class="home-list-row" data-chat="' + chat.id + '"><span class="recent-icon sm">✦</span><b>' +
		U.esc(chat.title || "Chat") + "</b><small>" + U.fmtDate(chat.updated || chat.created) + "</small><i>›</i></button>"
	).join("");

	main.innerHTML = '<div class="home home-v2 home-slim">' +
		'<header class="home-hero"><div><h1>' + greeting + '</h1><p class="home-meta">' +
		pages.length + " Seiten · " + Object.keys(S.cards).length + " Karten · " + chats.length + " Chats</p></div>" +
		'<button class="home-customize" data-set="look" title="Design anpassen">⚙</button></header>' +
		conflictBanner +
		'<div class="quick-actions">' +
			'<button data-homeaction="newpage">＋ Neue Seite</button>' +
		"</div>" +
		'<section class="home-section home-section-continue">' + continueBlock + "</section>" +
		todayPills +
		'<section class="home-section"><div class="section-head"><h2>Zuletzt</h2>' +
		'<button data-homeaction="library">Alle ›</button></div>' + recentPages + "</section>" +
		(recentChats
			? '<section class="home-section"><div class="section-head"><h2>Chats</h2>' +
				'<button data-homeaction="chats">Alle ›</button></div><div class="home-list">' + recentChats + "</div></section>"
			: "") +
		"</div>";
}

// Papierkorb: gelöschte Seiten mit Wiederherstellen / Endgültig-löschen-Optionen.
function renderTrash(main) {
	const items = STATE.trashedPages();
	let html = '<div class="library"><h1>🗑 Papierkorb</h1><p class="hint">Einträge werden nach 30 Tagen automatisch endgültig gelöscht.</p>';
	html += items.length
		? '<div class="trash-list">' + items.map((pg) =>
			'<div class="trash-row">' +
				'<span class="row-title">' + pageIconHtml(pg) + U.esc(pg.title) + "</span>" +
				'<span class="hint">gelöscht ' + U.fmtDate(pg.trashedAt || pg.updated) + "</span>" +
				'<button data-pagerestore="' + pg.id + '">↩ Wiederherstellen</button>' +
				'<button data-pagepurge="' + pg.id + '" class="danger">🗑 Endgültig löschen</button>' +
			"</div>"
		).join("") + "</div>"
		: '<p class="hint">Der Papierkorb ist leer.</p>';
	html += "</div>";
	main.innerHTML = html;
}

// ---------- GoodNotes-artige Bibliothek: Deckblätter (eigenes Bild oder vorgefertigt) ----------
const COVER_URLS = {}; // blobId → Object-URL (einmal je Sitzung erzeugt und gecacht)


async function coverObjectUrl(blobId) {
	if (COVER_URLS[blobId]) return COVER_URLS[blobId];
	try {
		const rec = await DB.getBlob(blobId);
		if (!rec || !rec.buf || !rec.buf.byteLength) return null;
		const url = URL.createObjectURL(new Blob([rec.buf], { type: (rec.meta && rec.meta.type) || "image/jpeg" }));
		COVER_URLS[blobId] = url;
		return url;
	} catch (e) { console.warn("Cover konnte nicht geladen werden:", e); return null; }
}

// Lädt eigene Cover-Bilder nach dem Rendern nach (innerHTML kann kein async).
function hydrateCovers(root) {
	(root || document).querySelectorAll("[data-coverimg]").forEach(async (el) => {
		if (el.dataset.coverHydrated) return;
		el.dataset.coverHydrated = "1";
		const u = await coverObjectUrl(el.dataset.coverimg);
		if (u) el.style.backgroundImage = "url('" + u + "')";
	});
}

// Lädt lokal gespeicherte Bilder (![...](img:...)) in gerendertem Markdown nach.
const IMG_URLS = {};
function hydrateImages(root) {
	(root || document).querySelectorAll('img[src^="img:"]').forEach(async (img) => {
		const id = img.getAttribute("src");
		if (IMG_URLS[id]) { img.src = IMG_URLS[id]; return; }
		try {
			const rec = await DB.getBlob(id);
			if (!rec || !rec.buf || !rec.buf.byteLength) return;
			const url = URL.createObjectURL(new Blob([rec.buf], { type: (rec.meta && rec.meta.type) || "image/png" }));
			IMG_URLS[id] = url;
			img.src = url;
		} catch (e) { console.warn("Bild konnte nicht geladen werden:", e); }
	});
}

// Lokaler Tages-Schlüssel "YYYY-MM-DD" (bewusst NICHT toISOString — Zeitzone!)
function localDayKey(x) {
	const d = new Date(x);
	return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// ---------- Daily Notes (📅-Tab): Monatskalender, jeder Tag ist eine eigene Seite ----------
function renderDaily(main) {
	const now = new Date();
	const cur = S.dailyMonth ? new Date(S.dailyMonth + "-01T12:00:00") : new Date(now.getFullYear(), now.getMonth(), 1);
	const y = cur.getFullYear(), mo = cur.getMonth();
	const monthLabel = cur.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
	const todayKey = localDayKey(now);
	const notes = {};
	STATE.activePages().forEach((p) => { if (p.daily) notes[p.daily] = p; });
	const startOffset = (new Date(y, mo, 1).getDay() + 6) % 7; // Montag = 0
	const daysInMonth = new Date(y, mo + 1, 0).getDate();
	let cells = "";
	for (let i = 0; i < startOffset; i++) cells += '<div class="cal-day other"></div>';
	for (let d = 1; d <= daysInMonth; d++) {
		const key = y + "-" + String(mo + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
		const pg = notes[key];
		const snippet = pg ? ((pg.content || "").split("\n").find((l) => l.trim()) || "") : "";
		cells += '<div class="cal-day' + (key === todayKey ? " today" : "") + (pg ? " has-note" : "") + '" data-dailyday="' + key + '" title="' + key + '">' +
			'<span class="cal-num">' + d + "</span>" +
			(pg ? '<span class="cal-snippet">' + U.esc(snippet.slice(0, 70)) + "</span>" : "") +
		"</div>";
	}
	main.innerHTML = '<div class="library daily"><div class="lib-head"><h1>📅 Daily Notes</h1>' +
		'<div class="mode-btns"><button data-dailynav="-1" title="Voriger Monat">‹</button><button id="btnDailyToday">Heute</button><button data-dailynav="1" title="Nächster Monat">›</button></div>' +
		'<span class="hint">' + monthLabel + " — Tag anklicken öffnet (oder erstellt) die Tagesseite</span></div>" +
		'<div class="cal-grid cal-head-row">' + ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((d) => '<div class="cal-dow">' + d + "</div>").join("") + "</div>" +
		'<div class="cal-grid">' + cells + "</div></div>";
}

// Vorlagen-Auswahl beim Anlegen einer neuen Seite: "Leere Seite" oder eine der
// als Vorlage markierten Seiten (⋯-Menü → Als Vorlage) als Startinhalt.
function openTemplatePicker() {
	const tpls = STATE.activePages().filter((p) => p.isTemplate);
	const o = U.el("overlay");
	o.hidden = false;
	o.innerHTML = modal(
		"<h3>Neue Seite</h3>" +
		'<button class="tpl-opt" data-tplblank="1">📄 Leere Seite</button>' +
		(tpls.length ? '<p class="hint">Oder aus einer Vorlage:</p>' : "") +
		tpls.map((p) =>
			'<button class="tpl-opt" data-tpluse="' + p.id + '">' + (p.icon ? U.esc(p.icon) + " " : "📑 ") + U.esc(p.title) + "</button>"
		).join("") +
		'<div class="modal-actions"><button id="btnCloseOverlay">Abbrechen</button></div>'
	);
}

// Seitenverlauf-Dialog: Versionsliste links (aus dem Event-Log), Vorschau rechts,
// Wiederherstellen erzeugt ein NEUES Event — der Verlauf selbst bleibt vollständig erhalten.
function renderHistoryModal() {
	const o = U.el("overlay");
	o.hidden = false;
	const vs = S.histVersions || [];
	const idx = Math.max(0, Math.min(S.histIndex, vs.length - 1));
	const v = vs[idx];
	const items = vs.map((x, i) => ({ x, i })).reverse().slice(0, 50).map(({ x, i }) =>
		'<button class="hist-item' + (i === idx ? " active" : "") + '" data-histversion="' + i + '">' +
			new Date(x.t).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) +
			(i === vs.length - 1 ? ' <span class="hint">aktuell</span>' : "") +
		"</button>"
	).join("");
	o.innerHTML = '<div class="modal hist-modal">' +
		'<button class="modal-x" id="btnCloseOverlay" title="Schließen">✕</button>' +
		'<div class="hist-list"><h3>🕘 Verlauf</h3>' + (items || '<p class="hint">Keine Versionen</p>') + "</div>" +
		'<div class="hist-preview"><h3>' + U.esc(v ? v.title : "") + "</h3>" +
			'<div class="md hist-md">' + (v ? U.md(v.content) : "") + "</div>" +
			'<div class="modal-actions"><button id="btnHistRestore" ' + (!v || idx === vs.length - 1 ? "disabled" : "") + ">↩ Diese Version wiederherstellen</button></div>" +
		"</div></div>";
	const pv = o.querySelector(".hist-md");
	if (pv) { U.renderMath(pv); U.highlightCode(pv); hydrateImages(pv); }
}

// ---------- Chat: Nachrichten, Thinking-Prozess (live + finalisiert), Edit-Karten mit Undo, Datei-Chips ----------
// historyList = der Chat, in dem die Nachricht steht (side ODER full) — sonst greift die
// Bearbeiten-Sperre im Seitenpanel nie (früher immer nur S.chat geprüft).
function userMsgHtml(m, historyList) {
	// Wie in Notion: Bearbeiten ist gesperrt, solange darunter noch nicht rückgängig
	// gemachte Seitenänderungen (edit-Karten) stehen.
	const list = historyList || S.chat;
	const idx = list.findIndex((x) => x.mid === m.mid);
	const locked = idx !== -1 && list.slice(idx + 1).some((x) => x.role === "edit" && !x.undone);
	return '<div class="msg user">' +
		'<button class="msg-edit' + (locked ? " locked" : "") + '" data-editmsg="' + m.mid + '" title="' +
			(locked ? "Erst spätere Änderungen rückgängig machen" : "Bearbeiten") + '">' + (locked ? "🔒" : "✎") + "</button>" +
		(m.content ? U.esc(m.content) : "") +
		(m.image ? '<img class="msg-img" src="' + m.image + '" alt="Anhang">' : "") +
		(m.textFile ? fileChipHtml(m) : "") +
		(m.pdfFile ? '<div class="file-chip"><span>📄 ' + U.esc(m.pdfFile.name) + ' · ' + (m.pdfFile.pages || "?") + ' Seiten</span></div>' : "") +
		"</div>";
}

// Lange geklebte Texte werden nicht ausgeschrieben, sondern als kleine .txt-Karte
// gezeigt (herunterladbar); das Modell bekommt den Inhalt trotzdem als Kontext.
function fileChipHtml(m) {
	return '<div class="file-chip"><span>📄 ' + U.esc(m.textFile.name) + " · " + m.textFile.size + ' Zeichen</span>' +
		'<button data-filedownload="' + m.mid + '">Herunterladen</button></div>';
}

// Werkzeug-Anzeige wie in Notion („Hat … verwendet“): kleine graue Karte je Tool-Aufruf,
// bei der semantischen Suche inklusive des verwendeten Embedding-Modells (aus ai.js).
const TOOL_LABELS = {
	read_page: "Seite gelesen", search_notes: "Notizen durchsucht", semantic_search: "Semantische Suche",
	create_page: "Seite erstellt", append_to_page: "Seite ergänzt", replace_page_content: "Seite überschrieben",
	create_flashcard: "Karteikarte erstellt", create_cloze_card: "Cloze-Karten erstellt", move_page: "Seite verschoben",
	list_pages: "Seiten aufgelistet", list_due_cards: "Fällige Karten", send_to_notebooklm: "An NotebookLM",
	ask_choice: "Rückfrage gestellt",
};
function toolChipHtml(m) {
	return '<div class="tool-chip' + (m.error ? " err" : "") + '" title="Werkzeug: ' + U.esc(m.name) + '">⚙️ ' + U.esc(TOOL_LABELS[m.name] || m.name) +
		(m.detail ? ' <span class="tool-detail">· ' + U.esc(m.detail) + "</span>" : "") + (m.error ? " — Fehler" : "") + "</div>";
}

function chatMsgListHtml(historyList) {
	// Chronologische Reihenfolge beibehalten: Edit-Karten gehören ZUR Nachricht/Turn
	// (direkt danach), NICHT ans absolute Chat-Ende (das war ein Fehler).
	const list = historyList || [];
	const parts = list.map((m) => {
		if (m.role === "edit") return editCardHtml(m);
		if (m.role === "question") return questionCardHtml(m);
		if (m.role === "tool") return toolChipHtml(m);
		if (m.role === "assistant") return assistantMsgHtml(m);
		return userMsgHtml(m, list);
	});
	if (S.aiBusy) {
		const activeList = S.aiActiveChatType === "side" ? S.sideChat : S.chat;
		if (historyList === activeList) {
			// Während offener ask_choice-Karte keine zweite „busy“-Zeile — die Frage IST der Wartezustand.
			const waitingChoice = activeList.some((m) => m.role === "question" && !m.answered);
			if (S.aiDraft) parts.push('<div class="msg assistant busy"><div class="md">' + U.md(S.aiDraft) + "</div></div>");
			else if (S.aiThinkingDraft) parts.push(thinkingLiveHtml());
			else if (!waitingChoice) parts.push('<div class="msg assistant busy">' + U.esc(S.aiStatus || "…") + "</div>");
		}
	}
	return parts.join("");
}

// Rückfrage-Karte (ask_choice) — Notion-Umfrage-Style: Frage + volle Options-Zeilen,
// nach Klick nur die gewählte Antwort (kein extra Tool-Chip).
function questionCardHtml(m) {
	if (m.answered) {
		return '<div class="msg assistant question-card answered">' +
			'<div class="q-label">Rückfrage</div>' +
			'<div class="q-text">' + U.esc(m.question) + "</div>" +
			'<div class="q-picked"><span class="q-check">✓</span> <b>' + U.esc(m.answer) + "</b></div></div>";
	}
	const opts = Array.isArray(m.options) ? m.options : [];
	return '<div class="msg assistant question-card pending" data-qmid="' + U.esc(m.mid) + '">' +
		'<div class="q-label">Rückfrage</div>' +
		'<div class="q-text">' + U.esc(m.question) + "</div>" +
		'<div class="q-options">' + opts.map((o, i) =>
			'<button type="button" class="q-opt" data-answerq="' + U.esc(m.mid) + '" data-answeridx="' + i + '">' +
			'<span class="q-opt-label">' + U.esc(o) + "</span></button>"
		).join("") + "</div></div>";
}

// Nach dem Setzen von innerHTML wird LaTeX gerendert (KaTeX) und Code eingefärbt (highlight.js) —
// beides live, auch während die Antwort noch streamt.
function renderSideContextChip() {
	const chip = U.el("sideContextChip");
	if (!chip) return;
	const pg = S.currentPageId ? S.pages[S.currentPageId] : null;
	if (!pg) {
		chip.hidden = true;
		chip.innerHTML = "";
		return;
	}
	chip.hidden = false;
	chip.innerHTML = '<span class="side-context-icon">📄</span><span class="side-context-title">' +
		U.esc(pg.title || "Unbenannte Seite") + '</span><span class="side-context-note">Seitenkontext</span>';
}

function renderChat() {
	renderSideContextChip();
	const log = U.el("chatLog");
	if (!log) return;
	log.innerHTML = chatMsgListHtml(S.sideChat);
	U.renderMath(log);
	U.highlightCode(log);
	log.scrollTop = log.scrollHeight;
}

// Ein Vollbild-Chat, der genau im Hauptbereich gerendert wird (gleiche Bausteine wie das Seitenpanel).
// Layout wie Notions eigenes KI-Panel: Log wächst nach oben, das Eingabefeld bleibt
// fest unten und ist horizontal zentriert — unabhängig von der Nachrichtenzahl.
function renderFullChat(main) {
	const s = S.currentChatId ? CHATS.load().find((x) => x.id === S.currentChatId) : null;
	const title = (s && s.title) || "Neuer Chat";
	const empty = !S.chat.length;
	main.innerHTML =
		'<div class="chat-full-wrap">' +
			'<div class="chat-full-head">' +
				'<button type="button" class="ai-status-chip" id="aiStatusChipFull" title="KI-Status" data-aistatus="1"></button>' +
				'<h1>✦ ' + U.esc(title) + "</h1>" +
			"</div>" +
			(empty ? '<p class="hint chat-empty-hint">Stell deine erste Frage — die Antwort erscheint hier groß, LaTeX und Code werden live gerendert.</p>' : "") +
			'<div id="mainChatLog" class="chat-log-full"></div>' +
			'<form id="mainChatForm" class="chat-form-full">' +
				'<div id="mainPendingChip" hidden></div>' +
				'<button type="button" id="btnAttachFull" title="Fotos und Dateien hinzufügen">+</button>' +
				'<button type="button" id="btnModelChipFull" class="composer-tool" title="Modell wählen"></button>' +
				'<textarea id="mainChatInput" rows="1" placeholder="Frag deinen KI-Coach…"></textarea>' +
				'<button type="submit" title="Senden">➤</button>' +
				'<div id="modelMenuFull" class="model-menu" hidden></div>' +
			"</form>" +
		"</div>";
	renderMainChatLog();
	renderPendingChip("full");
	renderStatusDot();
	const inp = U.el("mainChatInput");
	if (empty && inp) inp.focus();
}

function renderMainChatLog() {
	const log = U.el("mainChatLog");
	if (!log) return;
	log.innerHTML = chatMsgListHtml(S.chat);
	U.renderMath(log);
	U.highlightCode(log);
	log.scrollTop = log.scrollHeight;
}

// Während des Streamings: Mini-Ansicht mit den letzten 2 Zeilen, ausklappbar.
function thinkingLiveHtml() {
	const full = S.aiThinkingDraft;
	const expanded = !!S.thinkingLiveExpanded;
	return '<div class="think-box">' +
		'<div class="think-head"><span>🧠 Denkt nach…</span>' +
		'<button id="btnThinkLive">' + (expanded ? "Einklappen ▾" : "Ausklappen ▸") + "</button></div>" +
		'<div class="think-body' + (expanded ? " full" : " mini") + '">' + U.esc(expanded ? full : U.lastLines(full, 2)) + "</div>" +
		"</div>";
}

// Nach Abschluss: komplett eingeklappte Leiste, die man wieder aufklappen kann.
function assistantMsgHtml(m) {
	let html = "";
	if (m.reasoning) {
		const expanded = !!m.reasoningExpanded;
		html += '<div class="think-box done">' +
			'<button class="think-toggle" data-reasoningtoggle="' + m.mid + '">' +
			(expanded ? "▾ Gedankengang" : "▸ Gedankengang anzeigen") + "</button>" +
			(expanded ? '<div class="think-body full">' + U.esc(m.reasoning) + "</div>" : "") +
			"</div>";
	}
	const refineOpen = S.refineOpenMid === m.mid;
	html += '<div class="msg assistant"><div class="md">' + U.md(m.content) + "</div>" +
		'<div class="msg-tools">' +
			'<button class="msg-tool-btn" data-copymsg="' + m.mid + '" title="Antwort in die Zwischenablage kopieren">📋 Kopieren</button>' +
			'<button class="msg-tool-btn" data-refinetoggle="' + m.mid + '" title="Antwort anpassen">✦ Anpassen</button>' +
			(refineOpen
				? '<div class="refine-menu">' +
					'<button data-refine="' + m.mid + '" data-mode="longer">⬆️ Länger</button>' +
					'<button data-refine="' + m.mid + '" data-mode="same">↔️ Gleich</button>' +
					'<button data-refine="' + m.mid + '" data-mode="shorter">⬇️ Kürzer</button>' +
					"</div>"
				: "") +
		"</div></div>";
	return html;
}

function editCardHtml(m) {
	const title = m.pageTitle || "Unbenannt";
	const label = m.created ? "Hat erstellt" : "Hat geändert";
	const icon = (m.after && m.after.icon) || (S.pages[m.pageId] && S.pages[m.pageId].icon) || "📄";
	return '<div class="edit-card' + (m.undone ? " undone" : "") + '">' +
		'<div class="edit-title">' + U.esc(m.summary || (label + " " + title)) + "</div>" +
		'<div class="edit-actions-row">' +
			'<button class="btn-show-changes" data-difftoggle="' + m.mid + '">Änderungen anzeigen</button>' +
			'<button class="btn-undo-icon" data-undo="' + m.mid + '" ' + (m.undone ? "disabled" : "") + ' title="Rückgängig machen">↺</button>' +
		"</div>" +
		'<div class="edit-subtitle">' + label + "</div>" +
		'<div class="edit-files-list">' +
			'<div class="edit-file-item">' + U.esc(icon) + " " + U.esc(title) + "</div>" +
		"</div></div>";
}

// Baut eine seitenartige Vorschau (wie die echte Seite), mit grün/rot markierten Diff-Zeilen.
// Notion-Stil: große „Seite“ fliegt aus dem Overlay, nicht nur ein Code-Diff.
function changePageBodyHtml(beforeContent, afterContent) {
	const before = String(beforeContent || "");
	const after = String(afterContent || "");
	if (!before && after) {
		// Neu erstellt: ganze Seite als „hinzugefügt“
		return '<div class="change-page-body md highlight-page-add">' + U.md(after) + "</div>";
	}
	if (!after && before) {
		return '<div class="change-page-body md highlight-page-del">' + U.md(before) + "</div>";
	}
	const diff = typeof U.diffLines === "function" ? U.diffLines(before, after) : [];
	if (!diff.length) {
		return '<div class="change-page-body md">' + U.md(after) + "</div>";
	}
	// Zeilenweise Diff → wie Seite lesbar, mit farbigen Blöcken (nicht Monospace-Code)
	const chunks = [];
	let buf = [];
	let kind = "same";
	const flush = () => {
		if (!buf.length) return;
		const text = buf.join("\n");
		buf = [];
		if (kind === "add") chunks.push('<div class="change-block add md">' + U.md(text) + "</div>");
		else if (kind === "del") chunks.push('<div class="change-block del md">' + U.md(text) + "</div>");
		else chunks.push('<div class="change-block same md">' + U.md(text) + "</div>");
	};
	diff.forEach((d) => {
		const t = d.type === "add" ? "add" : d.type === "del" ? "del" : "same";
		if (t !== kind) { flush(); kind = t; }
		buf.push(d.text);
	});
	flush();
	return '<div class="change-page-body">' + chunks.join("") + "</div>";
}

function openChangePreview(m) {
	const o = U.el("overlay");
	if (!o || !m) return;
	const before = m.before || {};
	const after = m.after || {};
	const title = after.title || m.pageTitle || before.title || "Unbenannte Seite";
	const icon = after.icon || (S.pages[m.pageId] && S.pages[m.pageId].icon) || "📄";
	const label = m.created ? "Seite erstellt" : "Seite geändert";
	const bodyHtml = changePageBodyHtml(before.content, after.content);
	o.hidden = false;
	o.classList.add("change-overlay");
	o.innerHTML =
		'<div class="change-page-flyout" role="dialog" aria-label="Änderungsvorschau">' +
			'<button class="modal-x" id="btnCloseOverlay" title="Schließen">✕</button>' +
			'<div class="change-page-toolbar">' +
				'<span class="change-page-badge">' + (m.created ? "Neu" : "Geändert") + " · KI</span>" +
				'<span class="hint">' + U.esc(label) + "</span>" +
				'<button class="btn-undo-change" data-undo="' + m.mid + '" ' + (m.undone ? "disabled" : "") + '>↺ Rückgängig</button>' +
				(m.pageId ? '<button type="button" class="mini" data-openchangepage="' + U.esc(m.pageId) + '">Seite öffnen</button>' : "") +
			"</div>" +
			'<article class="change-page-sheet">' +
				'<div class="change-page-heading">' +
					'<span class="change-page-icon">' + U.esc(icon) + "</span>" +
					'<h1 class="change-page-title">' + U.esc(title) + "</h1>" +
				"</div>" +
				bodyHtml +
			"</article>" +
			'<div class="change-page-legend"><span class="leg add">＋ hinzugefügt</span><span class="leg del">− entfernt</span><span class="leg same">unverändert</span></div>' +
		"</div>";
	const sheet = o.querySelector(".change-page-sheet");
	if (sheet) {
		U.renderMath(sheet);
		U.highlightCode(sheet);
		hydrateImages(sheet);
	}
	// „Seite öffnen“: Vorschau schließen und Seite navigieren
	const openBtn = o.querySelector("[data-openchangepage]");
	if (openBtn) {
		openBtn.addEventListener("click", () => {
			o.hidden = true;
			o.classList.remove("change-overlay");
			o.innerHTML = "";
			if (typeof window.openPage === "function") window.openPage(openBtn.dataset.openchangepage);
			else if (S.pages[openBtn.dataset.openchangepage]) {
				S.currentPageId = openBtn.dataset.openchangepage;
				S.view = "page";
				render();
			}
		});
	}
	// Overlay-Klick außerhalb schließt
	const onBg = (e) => { if (e.target === o) { o.hidden = true; o.classList.remove("change-overlay"); o.innerHTML = ""; o.removeEventListener("click", onBg); } };
	o.addEventListener("click", onBg);
}

function renderPendingChip(type) {
	const chip = U.el(type === "full" ? "mainPendingChip" : "pendingChip");
	if (!chip) return;
	if (S.pendingAttachmentTarget !== type) {
		chip.hidden = true;
		chip.innerHTML = "";
		return;
	}
	if (S.pendingImage) {
		chip.hidden = false;
		chip.innerHTML = '<img src="' + S.pendingImage + '" alt=""> <span>Bild</span>' +
			'<button data-removeattachment="1" title="Entfernen">✕</button>';
	} else if (S.pendingTextFile) {
		chip.hidden = false;
		chip.innerHTML = '📄 ' + U.esc(S.pendingTextFile.name) + ' (' + S.pendingTextFile.size + ' Zeichen) wird als Datei angehängt ' +
			'<button id="btnRemoveTextFile" title="Entfernen">✕</button>';
	} else if (S.pendingPdf) {
		chip.hidden = false;
		chip.innerHTML = '📄 ' + U.esc(S.pendingPdf.name) + ' (' + (S.pendingPdf.pages || "?") + ' Seiten) wird als PDF-Kontext angehängt ' +
			'<button id="btnRemovePdf" title="Entfernen">✕</button>';
	} else {
		chip.hidden = true;
		chip.innerHTML = "";
	}
}

// ---------- Modals ----------
function modal(inner) {
	return '<div class="modal">' + inner + "</div>";
}

function openIconPicker() {
	if (!S.currentPageId) return;
	const icons = ["📝", "📘", "📕", "📙", "📗", "🧪", "🧮", "⚡", "🧢", "📐", "🔬", "💡", "🎯", "📊", "🗂", "📎", "✅", "⭐", "🔥", "🎓", "🧠", "📚", "🛠", "🚀"];
	const o = U.el("overlay");
	o.hidden = false;
	o.innerHTML = modal(
		"<h3>Icon wählen</h3>" +
		'<div class="icon-grid">' + icons.map((i) => '<button class="icon-opt" data-iconset="' + i + '">' + i + "</button>").join("") + "</div>" +
		'<div class="modal-actions"><button data-iconset="">Entfernen</button><button id="btnCloseOverlay">Schließen</button></div>'
	);
}

function openCoverPicker() {
	if (!S.currentPageId) return;
	const covers = ["sunset", "ocean", "forest", "grape", "mono"];
	const o = U.el("overlay");
	o.hidden = false;
	o.innerHTML = modal(
		"<h3>Cover wählen</h3>" +
		'<div class="cover-grid">' + covers.map((c) => '<button class="cover-swatch cover-' + c + '" data-coverset="' + c + '"></button>').join("") + "</div>" +
		'<p class="hint">Oder ein eigenes Bild als Deckblatt (wird lokal gespeichert):</p>' +
		'<div class="row-btns"><button id="btnCoverUpload">🖼 Eigenes Bild wählen</button></div>' +
		'<div class="modal-actions"><button data-coverset="">Entfernen</button><button id="btnCloseOverlay">Schließen</button></div>'
	);
}

function openReview() {
	const o = U.el("overlay");
	o.hidden = false;
	const due = STATE.dueCards();
	if (!due.length) {
		o.innerHTML = modal(
			"<h3>Alles wiederholt 🎉</h3>" +
			'<p class="hint">Gerade sind keine Karten fällig. Die KI legt beim Lernen automatisch neue an.</p>' +
			'<div class="modal-actions"><button id="btnCloseOverlay">Schließen</button></div>'
		);
		return;
	}
	const c = due[0];
	o.innerHTML = modal(
		"<h3>Wiederholen · noch " + due.length + " fällig</h3>" +
		'<div class="card-face md">' + U.md(c.front) + "</div>" +
		(S.reviewShowBack
			? '<div class="card-face back md">' + U.md(c.back) + "</div>" +
				'<div class="grades">' +
					'<button data-grade="1" data-card="' + c.id + '">Nochmal</button>' +
					'<button data-grade="2" data-card="' + c.id + '">Schwer</button>' +
					'<button data-grade="3" data-card="' + c.id + '">Gut</button>' +
					'<button data-grade="4" data-card="' + c.id + '">Einfach</button>' +
				"</div>"
			: '<div class="modal-actions"><button id="btnShowBack">Antwort zeigen</button></div>') +
		'<div class="modal-actions review-tools">' +
			'<button data-ankiedit="' + c.id + '" title="Karte bearbeiten">✎ Bearbeiten</button>' +
			'<button data-reviewsuspend="' + c.id + '" title="Karte aussetzen (zählt nicht mehr als fällig)">⏸ Aussetzen</button>' +
			'<button id="btnCloseOverlay">Beenden</button></div>'
	);
}

function openCards() {
	const o = U.el("overlay");
	o.hidden = false;
	const cards = Object.values(S.cards).sort((a, b) => a.srs.due.localeCompare(b.srs.due));
	const rows = cards.map((c) =>
		'<div class="card-row">' +
			'<textarea data-front="' + c.id + '" rows="2">' + U.esc(c.front) + "</textarea>" +
			'<textarea data-back="' + c.id + '" rows="2">' + U.esc(c.back) + "</textarea>" +
			'<div class="card-meta"><span>fällig: ' + U.fmtDate(c.srs.due) + " · Wdh. " + (c.srs.reps || 0) + "</span>" +
			'<span><button data-cardsave="' + c.id + '">Speichern</button> ' +
			'<button data-carddel="' + c.id + '" class="danger">Löschen</button></span></div>' +
		"</div>"
	).join("");
	o.innerHTML = modal(
		"<h3>Karten verwalten (" + cards.length + ")</h3>" +
		'<div class="cards-list">' + (rows || '<p class="hint">Noch keine Karten.</p>') + "</div>" +
		'<div class="modal-actions"><button id="btnCloseOverlay">Schließen</button></div>'
	);
}

export const RENDER = {
	render,
	onStateChange,
	scheduleRender,
	renderTopbar,
	renderModelMenu,
	renderSidebar,
	renderMain,
	openSettings: (...args) => SETTINGS.openSettings(...args),
	openReview,
	openCards,
	renderChat,
	renderMainChatLog,
	openTemplatePicker,
	renderStatusDot,
	renderTabs,
	hydrateImages,
	localDayKey,
	modal,
	hydrateCovers,
	ancestorsOf,
	renderLibrary: (...args) => LIBRARY.renderLibrary(...args),
	libCardHtml: (...args) => LIBRARY.libCardHtml(...args),
	renderModelBar,
	renderPendingChip,
	openChangePreview,
	loadPendingConflicts,
	savePendingConflicts,
	mergePendingConflicts,
	openConflictResolver,
	resolveConflict,
	pageIconLabel,
	pageIconHtml
};