"use strict";
import { AI } from "./ai.js";
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

function renderTopbar() {
	const home = U.el("btnHome");
	const chat = U.el("btnChatTab");
	if (home) home.classList.toggle("active", S.sidebarMode === "files");
	if (chat) chat.classList.toggle("active", S.sidebarMode === "chats");
	const lib = U.el("btnLibrary");
	if (lib) lib.classList.toggle("active", S.view === "library");
	const anki = U.el("btnAnki");
	if (anki) anki.classList.toggle("active", S.view === "anki");
	const daily = U.el("btnDaily");
	if (daily) daily.classList.toggle("active", S.view === "daily");
}

function renderStatusDot() {
	const dot = U.el("aiDot");
	if (!dot) return;
	dot.className = "dot" + (S.aiOnline === true ? " online" : S.aiOnline === false ? " offline" : "");
	dot.title = S.aiOnline === true ? "KI verbunden"
		: S.aiOnline === false ? "KI nicht erreichbar (Einstellungen prüfen)" : "KI-Status wird geprüft…";
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
			: '<span class="row-title">' + (pg.icon ? U.esc(pg.icon) + " " : pg.pdfId ? "📄 " : "") + U.esc(pg.title) + "</span>") +
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
	let html = '<button class="navbtn" id="btnSidebarToggle" title="Seitenleiste ein-/ausblenden">☰</button>' +
		'<button class="navbtn" id="btnNavBack" ' + (canBack ? "" : "disabled") + ' title="Zurück">‹</button>' +
		'<button class="navbtn" id="btnNavForward" ' + (canFwd ? "" : "disabled") + ' title="Vor">›</button>' +
		'<div class="tabstrip">';
	html += S.tabs.map((id) => {
		let title = "";
		const isChat = id.startsWith("chat:");
		const isNlm = id === "nlm:main";
		if (isChat) {
			const chatId = id.slice(5);
			const s = CHATS.load().find((x) => x.id === chatId);
			title = "💬 " + (s ? s.title : "Chat");
		} else if (isNlm) {
			title = "📓 NotebookLM";
		} else {
			const pg = S.pages[id];
			if (!pg) return "";
			title = (pg.icon ? U.esc(pg.icon) + " " : pg.pdfId ? "📄 " : "📝 ") + U.esc(pg.title);
		}
		const active = id === S.activeTabId && ((isChat && S.view === "chat") || (isNlm && S.view === "notebooklm") || (!isChat && !isNlm && S.view === "page")) ? " active" : "";
		return '<div class="tabchip' + active + '" data-tabopen="' + id + '">' +
			'<span class="tabchip-title">' + title + '</span>' +
			'<button class="tabchip-x" data-tabclose="' + id + '" title="Schließen">✕</button></div>';
	}).join("");
	html += "</div>";
	bar.innerHTML = html;
}

function renderMain() {
	// Nicht neu bauen, während der Nutzer tippt (Cursor bleibt erhalten)
	const ae = document.activeElement;
	if (ae && (ae.id === "pageTitle" || ae.id === "inpWsName" || ae.id === "inpNotionToken" || ae.id === "inpNotionPage" || ae.id === "libFilter" || ae.id === "ankiSearch"
		|| (ae.classList && (ae.classList.contains("blk-input") || ae.classList.contains("db-cell"))))) return;

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
				'<button class="page-icon" data-iconpick="1" title="Icon ändern">' + (pg.icon || (pg.pdfId ? "📄" : "📝")) + "</button>" +
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
			'<span class="crumb" data-page="' + l.id + '">' + (l.icon ? U.esc(l.icon) + " " : "📝 ") + U.esc(l.title) + "</span>").join("") + "</div>";
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
		rows.map((r) => '<tr><td><span class="crumb" data-page="' + r.id + '">' + (r.icon ? U.esc(r.icon) + " " : "📄 ") + U.esc(r.title) + "</span></td>" +
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

// Persönliches Home-Dashboard: konfigurierbare Widgets, Schnellaktionen und
// zuletzt verwendete Inhalte. Es ersetzt KEINE Navigation — die drei Hauptpillen
// Home, Chat und Bibliothek bleiben unverändert und eindeutig.
function renderHome(main) {
	const pages = STATE.activePages();
	const recent = pages.slice().sort((a, b) => (b.updated || "").localeCompare(a.updated || "")).slice(0, 8);
	const favorites = pages.filter((p) => p.favorite).sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
	const pdfs = pages.filter((p) => p.pdfId).sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
	const chats = CHATS.load().slice().sort((a, b) => (b.updated || b.created || "").localeCompare(a.updated || a.created || ""));
	const due = STATE.dueCards().length;
	const lastBk = localStorage.getItem("impala67LastBackup") || localStorage.getItem("notionLastBackup");
	const bkDays = lastBk ? Math.max(0, Math.floor((Date.now() - new Date(lastBk).getTime()) / 864e5)) : null;
	const bkDue = pages.length > 3 && (bkDays === null || bkDays > 7);
	const todayKey = localDayKey(new Date());
	const daily = pages.find((p) => p.daily === todayKey);
	const dailyLine = daily ? ((daily.content || "").split("\n").find((l) => l.trim()) || "").replace(/^#+\s*/, "").slice(0, 54) : "";
	const hour = new Date().getHours();
	const greeting = hour < 5 ? "Gute Nacht" : hour < 11 ? "Guten Morgen" : hour < 18 ? "Guten Tag" : "Guten Abend";
	const widgetOrder = SETTINGS.dashboardWidgets();
	const tile = (id, cls, icon, number, label, action, attrs) =>
		'<button class="home-widget home-widget-' + id + (cls ? " " + cls : "") + '" ' + (attrs || "") + '>' +
			'<span class="widget-icon">' + icon + '</span><span class="widget-copy"><span class="widget-value">' + U.esc(String(number)) +
			'</span><span class="widget-label">' + U.esc(label) + '</span><span class="widget-action">' + U.esc(action) + '</span></span></button>';
	const widgets = {
		continue: recent[0]
			? tile("continue", "wide", recent[0].icon || (recent[0].pdfId ? "📄" : "📝"), recent[0].title, "Weitermachen", "Zuletzt bearbeitet · " + U.fmtDate(recent[0].updated), 'data-page="' + recent[0].id + '"')
			: tile("continue", "wide muted", "✦", "Erste Seite", "Weitermachen", "Jetzt eine Seite anlegen", 'data-homeaction="newpage"'),
		daily: tile("daily", "", "📅", daily ? "Heute" : "Neu", "Daily Note", dailyLine || (daily ? "Öffnen" : "Tagesseite anlegen"), 'data-homeaction="daily"'),
		cards: tile("cards", due ? "attention" : "", "🃏", due, "Karten fällig", due ? "Lernsession starten" : "Alles erledigt", 'data-homeaction="cards"'),
		favorites: tile("favorites", "", "★", favorites.length, "Favoriten", favorites[0] ? favorites[0].title : "Noch nichts angeheftet", favorites[0] ? 'data-page="' + favorites[0].id + '"' : 'data-homeaction="library"'),
		chats: tile("chats", "", "✦", chats.length, "Chats", chats[0] ? (chats[0].title || "Letzten Chat öffnen") : "Neuen Chat beginnen", chats[0] ? 'data-chat="' + chats[0].id + '"' : 'data-homeaction="newchat"'),
		pdfs: tile("pdfs", "", "▤", pdfs.length, "PDFs", pdfs[0] ? pdfs[0].title : "Noch keine PDFs", pdfs[0] ? 'data-page="' + pdfs[0].id + '"' : 'data-homeaction="library"'),
		backup: tile("backup", bkDue ? "attention" : "", "↥", bkDays === null ? "—" : bkDays + " T", "Backup", bkDays === null ? "Erstes Backup erstellen" : "Zuletzt vor " + bkDays + " Tag" + (bkDays === 1 ? "" : "en"), 'data-homeaction="backup"'),
	};
	const recentPages = recent.length
		? '<div class="home-recent-grid">' + recent.map((pg) => '<button class="recent-card" data-page="' + pg.id + '">' +
			'<span class="recent-icon">' + U.esc(pg.icon || (pg.pdfId ? "📄" : "📝")) + '</span><span class="recent-copy"><b>' + U.esc(pg.title) +
			'</b><small>' + U.fmtDate(pg.updated) + '</small></span><span class="recent-arrow">›</span></button>').join("") + '</div>'
		: '<div class="empty-state"><span>✦</span><b>Dein Workspace ist bereit</b><p>Lege die erste Seite an oder importiere ein PDF.</p><button data-homeaction="newpage">Neue Seite</button></div>';
	const recentChats = chats.slice(0, 4).map((chat) => '<button class="home-list-row" data-chat="' + chat.id + '"><span>✦</span><b>' +
		U.esc(chat.title || "Chat") + '</b><small>' + U.fmtDate(chat.updated || chat.created) + '</small><i>›</i></button>').join("");
	main.innerHTML = '<div class="home home-v2">' +
		'<header class="home-hero"><div><span class="home-eyebrow">IMPALA67</span><h1>' + greeting + ' 👋</h1><p>' +
		pages.length + ' Seiten · ' + Object.keys(S.cards).length + ' Karteikarten · ' + chats.length + ' Chats</p></div>' +
		'<button class="home-customize" data-set="look" title="Dashboard und Design anpassen">⚙ Anpassen</button></header>' +
		'<div class="quick-actions"><button data-homeaction="newpage">＋ Neue Seite</button><button data-homeaction="search">⌕ Suchen</button>' +
		'<button data-homeaction="newchat">✦ Neuer Chat</button><button data-homeaction="library">▦ Bibliothek</button></div>' +
		'<section class="home-widget-grid">' + widgetOrder.map((id) => widgets[id] || "").join("") + '</section>' +
		'<section class="home-section"><div class="section-head"><div><span class="section-kicker">ARBEIT</span><h2>Zuletzt bearbeitet</h2></div>' +
		'<button data-homeaction="library">Alle in der Bibliothek ›</button></div>' + recentPages + '</section>' +
		(recentChats ? '<section class="home-section"><div class="section-head"><div><span class="section-kicker">KI</span><h2>Letzte Chats</h2></div>' +
		'<button data-homeaction="chats">Alle Chats ›</button></div><div class="home-list">' + recentChats + '</div></section>' : '') +
		'</div>';
}

// Papierkorb: gelöschte Seiten mit Wiederherstellen / Endgültig-löschen-Optionen.
function renderTrash(main) {
	const items = STATE.trashedPages();
	let html = '<div class="library"><h1>🗑 Papierkorb</h1><p class="hint">Einträge werden nach 30 Tagen automatisch endgültig gelöscht.</p>';
	html += items.length
		? '<div class="trash-list">' + items.map((pg) =>
			'<div class="trash-row">' +
				'<span class="row-title">' + (pg.icon ? U.esc(pg.icon) + " " : pg.pdfId ? "📄 " : "📝 ") + U.esc(pg.title) + "</span>" +
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
function userMsgHtml(m) {
	// Wie in Notion: Bearbeiten ist gesperrt, solange danach noch nicht rückgängig
	// gemachte Seitenänderungen (edit-Karten) stehen.
	const idx = S.chat.findIndex((x) => x.mid === m.mid);
	const locked = idx !== -1 && S.chat.slice(idx + 1).some((x) => x.role === "edit" && !x.undone);
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
const TOOL_LABELS = { read_page: "Seite gelesen", search_notes: "Notizen durchsucht", semantic_search: "Semantische Suche", create_page: "Seite erstellt", append_to_page: "Seite ergänzt", replace_page_content: "Seite überschrieben", create_flashcard: "Karteikarte erstellt", create_cloze_card: "Cloze-Karten erstellt", move_page: "Seite verschoben", list_pages: "Seiten aufgelistet" };
function toolChipHtml(m) {
	return '<div class="tool-chip' + (m.error ? " err" : "") + '" title="Werkzeug: ' + U.esc(m.name) + '">⚙️ ' + U.esc(TOOL_LABELS[m.name] || m.name) +
		(m.detail ? ' <span class="tool-detail">· ' + U.esc(m.detail) + "</span>" : "") + (m.error ? " — Fehler" : "") + "</div>";
}

function chatMsgListHtml(historyList) {
	const parts = (historyList || []).map((m) => {
		if (m.role === "edit") return editCardHtml(m);
		if (m.role === "question") return questionCardHtml(m);
		if (m.role === "tool") return toolChipHtml(m);
		if (m.role === "assistant") return assistantMsgHtml(m);
		return userMsgHtml(m);
	});
	if (S.aiBusy) {
		const activeList = S.aiActiveChatType === "side" ? S.sideChat : S.chat;
		if (historyList === activeList) {
			if (S.aiDraft) parts.push('<div class="msg assistant busy"><div class="md">' + U.md(S.aiDraft) + "</div></div>");
			else if (S.aiThinkingDraft) parts.push(thinkingLiveHtml());
			else parts.push('<div class="msg assistant busy">' + U.esc(S.aiStatus || "…") + "</div>");
		}
	}
	return parts.join("");
}

// Rückfrage-Karte (ask_choice-Tool): anklickbare Optionen, danach die gewählte Antwort fixiert.
function questionCardHtml(m) {
	if (m.answered) {
		return '<div class="msg assistant question-card answered"><div class="q-text">❓ ' + U.esc(m.question) + "</div>" +
			'<div class="q-picked">Ausgewählt: <b>' + U.esc(m.answer) + "</b></div></div>";
	}
	return '<div class="msg assistant question-card"><div class="q-text">❓ ' + U.esc(m.question) + "</div>" +
		'<div class="q-options">' + (m.options || []).map((o) =>
			'<button class="q-opt" data-answerq="' + m.mid + '" data-answer="' + U.esc(o) + '">' + U.esc(o) + "</button>"
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
			'<h1>💬 ' + U.esc(title) + "</h1>" +
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
	const diff = m.after.content && m.before.content ? U.diffLines(m.before.content, m.after.content) : [];
	const diffHtml = diff.map((d) =>
		'<div class="diffline ' + d.type + '">' + (d.type === "add" ? "+ " : d.type === "del" ? "− " : "  ") + U.esc(d.text) + "</div>"
	).join("");
	return '<div class="edit-card">' +
		'<div class="edit-title">' + U.esc(m.summary || (label + " " + title)) + '</div>' +
		'<div class="edit-actions-row">' +
			'<button class="btn-show-changes" data-difftoggle="' + m.mid + '">Änderungen anzeigen</button>' +
			'<button class="btn-undo-icon" data-undo="' + m.mid + '" ' + (m.undone ? "disabled" : "") + ' title="Rückgängig machen">↺</button>' +
		'</div>' +
		'<div class="edit-subtitle">' + label + '</div>' +
		'<div class="edit-files-list">' +
			'<div class="edit-file-item">📄 ' + U.esc(title) + '</div>' +
		'</div>' +
		"</div>";
}

function openChangePreview(m) {
	const o = U.el("overlay");
	if (!o || !m) return;
	const title = m.pageTitle || "Unbenannte Seite";
	const label = m.created ? "Seite erstellt" : "Seite geändert";
	const diff = m.after.content && m.before.content ? U.diffLines(m.before.content, m.after.content) : [];
	const diffHtml = diff.map((d) => '<div class="change-line ' + d.type + '">' +
		(d.type === "add" ? "+ " : d.type === "del" ? "− " : "  ") + U.esc(d.text) + "</div>").join("");
	o.hidden = false;
	o.innerHTML = '<div class="modal change-preview">' +
		'<button class="modal-x" id="btnCloseOverlay" title="Schließen">✕</button>' +
		'<header class="change-preview-head"><span class="change-preview-icon">📄</span><span><b>' + U.esc(title) + '</b><small>' + label + ' · KI</small></span></header>' +
		'<div class="change-preview-bar"><span>Änderungen</span><button class="btn-undo-change" data-undo="' + m.mid + '" ' + (m.undone ? "disabled" : "") + '>↺ Rückgängig</button></div>' +
		'<div class="change-preview-diff">' + (diffHtml || '<div class="hint">Keine Textunterschiede verfügbar.</div>') + '</div>' +
		'</div>';
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
	openChangePreview
};