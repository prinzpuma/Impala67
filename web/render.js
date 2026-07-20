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
import { HEFT } from "./heft.js";
import { LERNZEIT } from "./lernzeit.js";
import { SCHULNOTEN } from "./schulnoten.js";
import { TELE } from "./telemetrie.js";

// v13: KISS/DRY-Refactor, funktionsgleich zu v12. Fixes: openReview crasht nicht
// mehr bei leerer dueNow-Queue; toter Code entfernt (cap/note im Modell-Menü,
// panelCollapsed in renderTabs). DRY: lsGet/lsSet, openOverlay, blobUrl, trashRow.
const esc = (s) => U.esc(s);
const $ = (id) => U.el(id);
const lsGet = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* egal */ } };
function openOverlay(html) {
	const o = $("overlay");
	if (!o) return null;
	o.hidden = false;
	o.innerHTML = html;
	return o;
}

const deckTreeHtml = (...a) => RENDER_ANKI.deckTreeHtml(...a);
const renderAnki = (...a) => RENDER_ANKI.renderAnki(...a);

// Icon: eigenes > Heft > PDF > Fallback (auch von library.js/search.js genutzt)
const pageIconLabel = (pg, fb = "📝") => pg.icon || (pg.kind === "heft" ? "📓" : pg.pdfId ? "📄" : fb);
const pageIconHtml = (pg, fb) => { const i = pageIconLabel(pg, fb); return i ? esc(i) + " " : ""; };

// Fokus-Wächter: Re-Renders überspringen, solange der Nutzer tippt
const inBlockEditor = (ae) => !!(ae && ((ae.classList && (ae.classList.contains("blk-input") || ae.classList.contains("blk-rich-edit"))) || (ae.isContentEditable && ae.closest && ae.closest(".block-editor"))));
const isEditingBlock = () => inBlockEditor(document.activeElement);
const PROTECTED_FOCUS_IDS = new Set(["pageTitle", "inpWsName", "inpNotionToken", "inpNotionPage", "libFilter", "ankiSearch"]);
const isProtectedFocus = (ae) => !!ae && (PROTECTED_FOCUS_IDS.has(ae.id) || inBlockEditor(ae) || (ae.classList && ae.classList.contains("db-cell")));

// render.js — UI-Aufbau im Notion-Stil: Sidebar, Tabs, Seitenkopf, Chat.
function render() {
	// Expliziter render() storniert einen ausstehenden rAF-Render (sonst Doppel-Aufbau)
	if (_renderRaf) { cancelAnimationFrame(_renderRaf); _renderRaf = 0; }
	renderSidebar();
	renderMain();
	renderTabs();
	renderChat();
	if (S.view === "chat") renderMainChatLog();
	renderPendingChip("side");
	renderPendingChip("full");
	renderStatusDot();
	renderModelBar();
	const due = $("dueCount");
	if (due) due.textContent = STATE.dueCards().length;
}

// PERF: mehrere dispatches pro Frame → EIN Render (rAF-gebündelt)
let _renderRaf = 0;
function scheduleRender() {
	if (_renderRaf) return;
	_renderRaf = requestAnimationFrame(() => { _renderRaf = 0; render(); });
}
function onStateChange(type, ev) {
	const p = ev?.payload || {};
	// Reiner Content-Patch: Editor besitzt die Live-Ansicht. viaEditor = eigener
	// Autosave (Fokus-Check würde nach dem async IndexedDB-Write fälschlich anschlagen
	// und #main samt Scroll neu bauen). Extern geänderte offene Seite → nur Main.
	if (type === "pageUpdate" && p.patch && Object.keys(p.patch).length === 1 && "content" in p.patch) {
		if (p.viaEditor || isEditingBlock()) return;
		if (p.id === S.currentPageId && S.view === "page") renderMain();
		return;
	}
	// Heft: Canvas ist die Live-Ansicht — nur die Bibliothek auffrischen, falls offen
	if (type === "heftUpdated") {
		if (S.view === "library") renderMain();
		return;
	}
	// Modell-/Thinking-Umschalter: nur die Modell-Leiste
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
	// Genau EINE Pille aktiv; expliziter Chat-Modus hat Vorrang vor Anki
	const mode = S.sidebarMode === "chats" ? "chats" : S.view === "anki" ? "anki" : "files";
	const set = (id, on) => { const b = $(id); if (b) b.classList.toggle("active", on); };
	set("btnHome", mode === "files");
	set("btnChatTab", mode === "chats");
	set("btnAnki", mode === "anki");
	set("btnLibrary", S.view === "library");
	set("btnDaily", S.view === "daily");
}

function aiStatusMeta() {
	if (S.aiOnline === true) return { cls: "online", title: "KI verbunden", label: "KI online" };
	if (S.aiOnline === false) return { cls: "offline", title: "KI nicht erreichbar (Einstellungen → KI prüfen)", label: "KI offline" };
	return { cls: "checking", title: "KI-Status wird geprüft…", label: "KI …" };
}

// KI-Status-Pille nur im Chat (Side-Panel + Vollbild)
function fillAiStatusChip(chip, meta) {
	if (!chip) return;
	chip.className = "ai-status-chip " + meta.cls;
	chip.title = meta.title + " — Klick: erneut prüfen";
	chip.innerHTML = `<span class="dot ${meta.cls}"></span><span class="ai-status-label">${esc(meta.label)}</span>`;
	chip.hidden = false;
}
function renderStatusDot() {
	const meta = aiStatusMeta();
	// FIX: Side-Chip IMMER befüllen (auch bei body.panel-collapsed) — der DOM muss
	// beim Aufklappen aktuell sein, sonst bleibt die Pille im kleinen Chat leer
	fillAiStatusChip($("aiStatusChip"), meta);
	const fullChip = $("aiStatusChipFull");
	if (fullChip) {
		if (S.view === "chat") fillAiStatusChip(fullChip, meta);
		else fullChip.hidden = true;
	}
	const set = $("aiStatusSettings");
	if (set) {
		set.className = "ai-status-banner " + meta.cls;
		set.innerHTML = `<span class="dot ${meta.cls}"></span><span>${esc(meta.title)}</span><button type="button" id="btnRecheckAI" class="mini">Erneut prüfen</button>`;
	}
}

function currentModelLabel() {
	const cur = S.settings.aiModel || "";
	const pr = (S.settings.aiProviders || []).find((p) => p.id === S.settings.aiProviderId);
	return cur ? (pr ? pr.name + " · " : "") + cur : "Kein Modell";
}

// Beide Auslöser (kleines Panel + großer Chat) bekommen dasselbe Icon/Label
function renderModelBar() {
	const label = currentModelLabel();
	const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="8" x2="20" y2="8"/><circle cx="9" cy="8" r="2.6" fill="currentColor"/><line x1="4" y1="16" x2="20" y2="16"/><circle cx="15" cy="16" r="2.6" fill="currentColor"/></svg>';
	for (const id of ["btnModelChipFull", "btnModelMenu"]) {
		const b = $(id);
		if (b) { b.innerHTML = icon; b.title = "Modell: " + label; }
	}
	renderModelMenu();
}

function currentThinkingCapability() {
	const pr = (S.settings.aiProviders || []).find((p) => p.id === S.settings.aiProviderId);
	const base = String((pr && pr.base) || "").replace(/\/+$/, "");
	const key = [String(S.settings.aiProviderId || ""), base, String(S.settings.aiModel || "")].join("::");
	return (S.thinkingCapabilities || {})[key] || null;
}

// ★ Modell-Favoriten: "providerId::modelId", bewusst lokal (Quellen-IDs sind gerätespezifisch)
const MODEL_FAV_KEY = "impala67FavModels";
const favModels = () => new Set(lsGet(MODEL_FAV_KEY, []));
function toggleFavModel(key) {
	const s = favModels();
	s.has(key) ? s.delete(key) : s.add(key);
	lsSet(MODEL_FAV_KEY, [...s]);
}
// Capture: Stern darf nicht gleichzeitig das Modell umschalten
document.addEventListener("click", (e) => {
	const b = e.target && e.target.closest && e.target.closest("[data-modelfav]");
	if (!b) return;
	e.preventDefault();
	e.stopPropagation();
	toggleFavModel(b.dataset.modelfav);
	renderModelMenu();
}, true);

function modelMenuInnerHtml() {
	const providers = S.settings.aiProviders || [];
	const curPr = S.settings.aiProviderId || "";
	const curModel = S.settings.aiModel || "";
	const live = S.availableModels || [];
	const section = S.modelMenuSection || "root";
	const back = '<button class="model-submenu-back" data-modelmenuback="1">‹ Zurück</button>';
	const enabled = S.settings.thinkingEnabled !== false;
	if (section === "root") {
		// Thinking-Eintrag nie ausblenden — die Unterseite erklärt die Fähigkeit selbst
		return `<button class="model-submenu-row" data-modelsubmenu="models"><span>Modell</span><small>${esc(currentModelLabel())} ›</small></button>` +
			`<button class="model-submenu-row" data-modelsubmenu="thinking"><span>Thinking</span><small>${enabled ? "Ein" : "Aus"} ›</small></button>`;
	}
	if (section === "thinking") {
		const cap = currentThinkingCapability();
		if (!cap || cap.state === "loading") return back + '<div class="menu-label">Thinking</div><div class="menu-note">API-Fähigkeiten werden geprüft…</div>';
		return back + '<div class="menu-label">Thinking</div><div class="menu-note">' + esc(cap.error || "Das Modell verwendet bei Aktivierung seine dokumentierte Standardtiefe.") + "</div>" +
			[[true, "Ein"], [false, "Aus"]].map(([v, label]) =>
				`<button class="menu-item${v === enabled ? " active" : ""}" data-thinkingenabled="${v ? "1" : "0"}"><span class="menu-item-label">${label}</span>${v === enabled ? '<span class="menu-check">✓</span>' : ""}</button>`).join("");
	}
	const head = back + '<div class="menu-label">Verfügbare Modelle</div>';
	if (S.modelMenuLoading) return head + '<div class="menu-note">Modelle werden geladen…</div>';
	const favSet = favModels();
	const opt = (prId, value, active) => {
		const favKey = prId + "::" + value, fav = favSet.has(favKey);
		return `<div class="model-row"><button class="menu-item${active ? " active" : ""}" data-modelset="${esc(prId)}::${esc(value)}"><span class="menu-item-label">${esc(value)}</span>${active ? '<span class="menu-check">✓</span>' : ""}</button>` +
			`<button type="button" class="model-fav${fav ? " on" : ""}" data-modelfav="${esc(favKey)}" title="${fav ? "Favorit entfernen" : "Als Favorit ganz nach oben pinnen"}">${fav ? "★" : "☆"}</button></div>`;
	};
	const rows = (ms) => ms.map((m) => opt(m.providerId, m.id, m.providerId === curPr && m.id === curModel)).join("");
	// ★ Favoriten quellenübergreifend zuerst
	const favLive = live.filter((m) => favSet.has(m.providerId + "::" + m.id));
	let body = favLive.length ? '<div class="menu-label">★ Favoriten</div>' + rows(favLive) : "";
	for (const pr of providers) {
		const rest = live.filter((m) => m.providerId === pr.id && !favSet.has(pr.id + "::" + m.id));
		if (rest.length) body += `<div class="menu-label">${esc(pr.name || pr.id)}</div>` + rows(rest);
	}
	return head + (body || '<div class="menu-note">Gerade ist kein Modell erreichbar oder geladen.</div>');
}

// EIN Inhalt für beide Dropdown-Container (kleines Panel + großes Chat-Fenster)
function renderModelMenu() {
	const inner = modelMenuInnerHtml();
	for (const id of ["modelMenu", "modelMenuFull"]) {
		const m = $(id);
		if (!m) continue;
		const which = id === "modelMenuFull" ? "full" : "panel";
		const show = S.modelMenuOpen && (S.modelMenuAnchor || "panel") === which;
		m.hidden = !show;
		if (show) {
			m.innerHTML = inner;
			POPOVERS.position($(which === "full" ? "btnModelChipFull" : "btnModelMenu"), m, { prefer: "above", gap: 6 });
		}
	}
}

// ---------- Sidebar (Collapse-Zustand bleibt über Neustarts erhalten) ----------
function wsHeadHtml(ws) {
	const key = "ws:" + ws.id;
	return `<div class="ws-head"><button class="row-chevron ws-chevron${COLLAPSE.isCollapsed(key) ? "" : " open"}" data-collapse="${key}" title="Ein-/Ausklappen">▸</button><span class="ws-name">${esc(ws.name)}</span><button class="mini" data-newpage="${ws.id}" title="Neue Seite in ${esc(ws.name)}">+</button></div>`;
}

// PERF: identisches Markup nicht erneut parsen/layouten — Stringvergleich ist
// um Größenordnungen billiger als innerHTML
function setHtmlIfChanged(el, html, key = "_lastHtml") {
	if (el[key] === html) return false;
	el.innerHTML = html;
	el[key] = html;
	return true;
}

// "files" = Workspaces mit Seitenbaum, "chats" = Chat-Verlauf
function renderSidebar() {
	renderTopbar();
	const tree = $("tree");
	if (!tree) return;
	// FIX: Hintergrund-Render darf laufendes Umbenennen (Fokus + Text) nicht zerstören;
	// Commit/Abbrechen leert die Flags VOR render() und läuft normal durch
	const ae = document.activeElement;
	if ((S.renamingPageId || S.renamingDeck) && ae && ae.dataset && (ae.dataset.renamename || ae.dataset.deckrenamename)) return;
	// Expliziter Chat-Modus hat Vorrang (sonst aus Anki heraus nie erreichbar)
	if (S.sidebarMode === "chats") return void setHtmlIfChanged(tree, chatListHtml());
	if (S.view === "anki") {
		setHtmlIfChanged(tree, deckTreeHtml());
		// Offenes ⋯-Menü nach Rebuild fixed neu positionieren, sonst clippt #tree
		if (S.deckMenuOpenName) {
			const name = CSS.escape(S.deckMenuOpenName);
			const anchor = tree.querySelector(`[data-deckmenu="${name}"]`);
			const menu = tree.querySelector(`[data-deckmenu-panel="${name}"]`);
			if (anchor && menu) POPOVERS.position(anchor, menu, { align: "end", gap: 2 });
		}
		return;
	}
	// ★ Favoriten immer oben, dann Workspaces mit Seitenbaum
	const favs = STATE.activePages().filter((p) => p.favorite);
	let html = favs.length ? '<div class="ws-head"><span class="ws-name">★ Favoriten</span></div>' + favs.map((p) => rowHtml(p, 0, p.workspaceId)).join("") : "";
	for (const ws of Object.values(S.workspaces)) {
		html += wsHeadHtml(ws);
		if (!COLLAPSE.isCollapsed("ws:" + ws.id)) html += branchHtml(null, 0, ws.id) || '<div class="empty small">Keine Seiten</div>';
	}
	setHtmlIfChanged(tree, html);
	// dito: offenes Seiten-⋯-Menü nach JEDEM Rebuild neu positionieren
	if (S.pageMenuOpenId) {
		const anchor = tree.querySelector(`[data-pagemenu="${S.pageMenuOpenId}"]`);
		const menu = tree.querySelector(".page-menu");
		if (anchor && menu) POPOVERS.position(anchor, menu, { align: "end", gap: 2 });
	}
}

// Chat-Verlauf in der Sidebar (Volltextsuche läuft im Befehls-Menü, Strg+K)
function chatListHtml() {
	return '<div class="row" data-newchat="1"><span class="row-title">+ Neuer Chat</span></div>' +
		CHATS.load().map((s) =>
			`<div class="row${s.id === S.currentChatId ? " active" : ""}" data-chat="${s.id}"><span class="row-title">${esc(s.title || "Chat")}</span><span class="hint">${U.fmtDate(s.updated || s.created)}</span>` +
			`<button class="row-add" data-chatrename="${s.id}" title="Chat umbenennen">✎</button><button class="row-add danger" data-chatdel="${s.id}" title="Chat löschen">🗑</button></div>`).join("");
}

function branchHtml(parentId, depth, wsId) {
	return depth > 8 ? "" : STATE.childrenOf(parentId, wsId).map((pg) => rowHtml(pg, depth, wsId)).join("");
}

function rowHtml(pg, depth, wsId) {
	const active = pg.id === S.currentPageId && S.view === "page" ? " active" : "";
	const hasKids = STATE.childrenOf(pg.id, wsId || pg.workspaceId).length > 0;
	const collapsed = COLLAPSE.isCollapsed(pg.id);
	return `<div class="row${active}" draggable="true" data-page="${pg.id}" style="padding-left:${6 + depth * 16}px">` +
		(hasKids ? `<button class="row-chevron${collapsed ? "" : " open"}" data-collapse="${pg.id}" title="Ein-/Ausklappen">▸</button>` : '<span class="row-chevron spacer"></span>') +
		(S.renamingPageId === pg.id
			? `<input class="row-rename-input" data-renamename="${esc(pg.id)}" value="${esc(pg.title)}" autocomplete="off">`
			: `<span class="row-title">${pageIconHtml(pg, "")}${esc(pg.title)}</span>`) +
		`<button class="row-add" data-pagemenu="${pg.id}" title="Weitere Optionen">⋯</button>` +
		`<button class="row-add" data-addchild="${pg.id}" title="Unterseite anlegen">+</button>` +
		(S.pageMenuOpenId === pg.id ? pageMenuHtml(pg) : "") +
		"</div>" + (hasKids && !collapsed ? branchHtml(pg.id, depth + 1, wsId || pg.workspaceId) : "");
}

// Geteilte Menüpunkte für Seiten-⋯ (Sidebar) und Topbar-⋯
const menuBtn = (attr, id, label, cls = "") => `<button class="menu-item${cls}" data-${attr}="${id}">${label}</button>`;
const dupTplItems = (pg) => menuBtn("pageduplicate", pg.id, "📋 Duplizieren") + menuBtn("pagetemplate", pg.id, "📑 " + (pg.isTemplate ? "Vorlage entfernen" : "Als Vorlage"));
const moveTrashItems = (pg) => menuBtn("pagemove", pg.id, "📦 Verschieben nach…") + menuBtn("pagetrash", pg.id, "🗑 Löschen", " danger");
function pageMenuHtml(pg) {
	return '<div class="page-menu">' + menuBtn("pagerename", pg.id, "✎ Umbenennen") + dupTplItems(pg) +
		menuBtn("pagefav", pg.id, pg.favorite ? "★ Favorit entfernen" : "☆ Zu Favoriten") + moveTrashItems(pg) + "</div>";
}

// ---------- Tab-Leiste (Zurück/Vor + offene Seiten UND Chats) ----------
function renderTabs() {
	const bar = $("tabbar");
	if (!bar) return;
	// Chat-Titel einmal laden (nicht pro Tab CHATS.load())
	const chatById = new Map();
	try { CHATS.load().forEach((s) => chatById.set(s.id, s)); } catch { /* ignore */ }
	let html = '<button class="navbtn" id="btnSidebarToggle" title="Linke Spalte ein-/ausklappen">☰</button>' +
		`<button class="navbtn" id="btnNavBack" ${S.navIndex > 0 ? "" : "disabled"} title="Zurück">‹</button>` +
		`<button class="navbtn" id="btnNavForward" ${S.navIndex < S.navHistory.length - 1 ? "" : "disabled"} title="Vor">›</button>` +
		'<div class="tabstrip">';
	html += S.tabs.map((id) => {
		const isChat = id.startsWith("chat:"), isNlm = id === "nlm:main";
		let title;
		if (isChat) title = "✦ " + esc(chatById.get(id.slice(5))?.title || "Chat"); // ✦ = KI-Markenzeichen wie Home/FAB
		else if (isNlm) title = "📓 NotebookLM";
		else {
			const pg = S.pages[id];
			if (!pg) return "";
			title = pageIconHtml(pg) + esc(pg.title);
		}
		const active = id === S.activeTabId && ((isChat && S.view === "chat") || (isNlm && S.view === "notebooklm") || (!isChat && !isNlm && S.view === "page")) ? " active" : "";
		return `<div class="tabchip${active}" data-tabopen="${id}"><span class="tabchip-title">${title}</span><button class="tabchip-x" data-tabclose="${id}" title="Schließen">✕</button></div>`;
	}).join("");
	// „+“ öffnet einen neuen Tab (Navigation ersetzt sonst den aktuellen)
	html += '<button class="tabchip tabchip-new" id="btnTabNew" data-tabnew="1" title="Neuen Tab öffnen">+</button></div>';
	setHtmlIfChanged(bar, html);
}

function renderMain() {
	// Nicht neu bauen, während der Nutzer tippt (Cursor bleibt erhalten)
	if (isProtectedFocus(document.activeElement)) return;
	const main = $("main");
	if (!main) return;
	// Eingebettetes NotebookLM-Webview ist ein OS-Overlay → aktiv ausblenden
	if (S.view !== "notebooklm") NLM.hideEmbeddedIfActive();
	// Offenes Heft schließen, sobald die Ansicht es nicht mehr zeigt (speichert implizit)
	if (HEFT.activeId && (S.view !== "page" || S.currentPageId !== HEFT.activeId)) HEFT.unmount();
	const views = { library: (m) => LIBRARY.renderLibrary(m), anki: renderAnki, noten: (m) => SCHULNOTEN.render(m), daily: renderDaily, trash: renderTrash, chat: renderFullChat, notebooklm: (m) => NLM.renderPane(m) };
	if (views[S.view]) return void views[S.view](main);
	const pg = S.currentPageId ? S.pages[S.currentPageId] : null;
	if (S.view === "home" || !pg) return void renderHome(main);

	// Heft = Fokusmodus: nur die globale Tab-Leiste über der Papierfläche.
	// FIX: dasselbe gemountete Heft NIE remounten — sonst verlieren Hintergrund-
	// Renders Scroll/Zoom/Undo und die Ansicht springt auf eine andere Seite
	if (pg.kind === "heft") {
		if (HEFT.activeId === pg.id && main.querySelector("#heftStage")) return;
		main.innerHTML = `<div id="heftStage" class="heft-stage" aria-label="${esc(pg.title)}"></div>`;
		const stage = $("heftStage");
		if (stage) HEFT.mount(stage, pg.id);
		return;
	}

	// EINE durchgehend editierbare Ansicht (Block-Editor immer aktiv).
	// Scroll-Position über Hintergrund-Renders retten (.page-scroll startete sonst bei 0)
	const oldScroller = main.querySelector(".page-scroll");
	const keepPageScroll = oldScroller && main.dataset.scrollPageId === pg.id ? oldScroller.scrollTop : 0;
	main.dataset.scrollPageId = pg.id;
	main.innerHTML =
		'<div class="page-chrome"><div class="page-topbar">' + breadcrumbHtml(pg) + topbarActionsHtml(pg) + "</div></div>" +
		'<div class="page-scroll"><div class="page-meta">' +
			(pg.coverImg || pg.cover
				? `<div class="page-cover ${pg.coverImg ? "has-img" : "cover-" + pg.cover}"${pg.coverImg ? ` data-coverimg="${esc(pg.coverImg)}"` : ""}><div class="cover-btns"><button data-coverpick="1">Cover ändern</button><button data-coverremove="1">Entfernen</button></div></div>`
				: "") +
			'<div class="page-heading">' +
				`<button class="page-icon" data-iconpick="1" title="Icon ändern">${pageIconLabel(pg)}</button>` +
				(!pg.cover && !pg.coverImg ? '<button class="addcover-btn" data-coverpick="1">+ Cover</button>' : "") +
			"</div>" +
			// Mehrzeilig wachsender Titel (ein <input> würde lange Namen abschneiden)
			`<textarea id="pageTitle" rows="1" autocomplete="off" aria-label="Seitentitel">${esc(pg.title)}</textarea>` +
			backlinksChipHtml(pg) +
		"</div>" +
		(pg.db ? dbTableHtml(pg) : "") +
		'<div class="editor-wrap"><div id="blockEditor" class="block-editor"></div></div></div>' +
		// src="about:blank" verhindert Chromes "Unsafe attempt to load URL file://..."
		(S.pdfOpen && pg.pdfId ? '<iframe id="pdfFrame" class="pdf-frame" src="about:blank" title="PDF"></iframe>' : "");
	hydrateCovers(main);
	if (keepPageScroll) {
		const sc = main.querySelector(".page-scroll");
		if (sc) sc.scrollTop = keepPageScroll;
	}
	// Titelhöhe an den Inhalt koppeln (Listener gehört zur frischen Seite)
	const titleInput = $("pageTitle");
	if (titleInput) {
		const fitTitle = () => {
			titleInput.style.height = "auto";
			titleInput.style.height = Math.max(44, titleInput.scrollHeight) + "px";
		};
		fitTitle();
		titleInput.addEventListener("input", fitTitle);
	}
	const beHost = $("blockEditor");
	if (beHost) EDITOR.mount(beHost, pg.id);
	if (S.pdfOpen && pg.pdfId) PDFS.urlFor(pg.pdfId).then((u) => {
		const f = $("pdfFrame");
		if (f && u) f.src = u;
	});
}

// Topbar rechts: Teilen, Favoriten-Stern, ⋯ (Stern/Menüpunkte via app.js, Auf/Zu via extras.js)
function topbarActionsHtml(pg) {
	return '<div class="topbar-actions">' +
		`<span class="topbar-wrap"><button class="topbar-btn" data-sharemenu="1" title="Exportieren & Teilen">↗ Teilen</button>${S.topMenu === "share" ? shareMenuHtml(pg) : ""}</span>` +
		`<button class="topbar-btn${pg.favorite ? " fav-active" : ""}" data-pagefav="${pg.id}" title="${pg.favorite ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen"}">${pg.favorite ? "★" : "☆"}</button>` +
		`<span class="topbar-wrap"><button class="topbar-btn" data-morepagemenu="1" title="Weitere Optionen">⋯</button>${S.topMenu === "more" ? moreMenuHtml(pg) : ""}</span></div>`;
}

function shareMenuHtml(pg) {
	return '<div class="page-menu top-menu">' + menuBtn("exportpdf", pg.id, "🖨 Als PDF exportieren / drucken") +
		menuBtn("exportmd", pg.id, "⬇ Als Markdown (.md) speichern") + menuBtn("copylink", pg.id, "🔗 Internen Link kopieren") + "</div>";
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
		(marks ? menuBtn("cardsfromhl", pg.id, `🃏 Karten aus Markierungen (${marks})`) : "") +
		dupTplItems(pg) + moveTrashItems(pg) + "</div>";
}

// „↙ N Rückverweise“ unter dem Titel — Klick klappt die Liste auf
function backlinksChipHtml(pg) {
	const links = STATE.backlinksOf(pg.id);
	if (!links.length) return "";
	return `<div class="backlinks-row"><button class="backlinks-chip" data-backlinks="1">↙ ${links.length} Rückverweise</button>` +
		(S.backlinksOpen ? '<div class="backlinks">' + links.slice(0, 20).map((l) => `<span class="crumb" data-page="${l.id}">${pageIconHtml(l)}${esc(l.title)}</span>`).join("") + "</div>" : "") + "</div>";
}

// Datenbank-Seite (pg.db): Unterseiten als editierbare Tabelle; Zell-Änderungen
// laufen als pageUpdate-Event (Verlauf/Diff/Sync greifen)
function dbTableHtml(pg) {
	const cols = ((pg.db && pg.db.schema) || []).filter((c) => c.type !== "title");
	const RO = { formula: 1, rollup: 1, created_time: 1, last_edited_time: 1, created_by: 1, last_edited_by: 1, people: 1, relation: 1, files: 1, button: 1, unique_id: 1, verification: 1 };
	return '<div class="db-view md"><table class="db-table"><thead><tr><th>Name</th>' +
		cols.map((c) => `<th title='${esc(c.type || "text")}'>${esc(c.name)}</th>`).join("") + "</tr></thead><tbody>" +
		STATE.childrenOf(pg.id, pg.workspaceId).map((r) => `<tr><td><span class="crumb" data-page="${r.id}">${pageIconHtml(r)}${esc(r.title)}</span></td>` +
			cols.map((c) => {
				const v = esc((r.props || {})[c.name] || "");
				return RO[c.type] ? `<td><span class="hint">${v}</span></td>` : `<td><input class="db-cell" data-dbrow="${r.id}" data-dbcol="${esc(c.name)}" value="${v}"></td>`;
			}).join("") + "</tr>").join("") +
		`</tbody></table><div class="row-btns" style="margin:8px 0 14px"><button class="mini" data-dbnewrow="${pg.id}">+ Neue Zeile</button></div></div>`;
}

// Breadcrumb: Workspace › Eltern › aktuelle Seite
function ancestorsOf(pg) {
	const chain = [];
	for (let cur = S.pages[pg.parentId]; cur; cur = S.pages[cur.parentId]) chain.unshift(cur);
	return chain;
}

function breadcrumbHtml(pg) {
	const ws = S.workspaces[pg.workspaceId] || { name: "Privat" };
	return `<div class="breadcrumb"><span class="crumb" data-crumbws="1">${esc(ws.name)}</span>` +
		ancestorsOf(pg).map((a) => `<span class="crumb-sep">/</span><span class="crumb" data-page="${a.id}">${esc(a.title)}</span>`).join("") +
		`<span class="crumb-sep">/</span><span class="crumb current">${esc(pg.title)}</span></div>`;
}

// ---- Sync-Konflikte: Pending-Liste + Lösungs-Popup mit Diff -----
const CONFLICT_KEY = "impala67_pending_conflicts";
const RESOLVED_CONFLICT_KEY = "impala67_resolved_conflicts";
const DATETIME_OPTS = { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" };
const loadResolvedConflictIds = () => new Set(lsGet(RESOLVED_CONFLICT_KEY, []));
function markConflictResolved(conflictPageId) {
	if (!conflictPageId) return;
	// nur lokale UI-Quittierung; klein halten (kein wachsender LocalStorage)
	lsSet(RESOLVED_CONFLICT_KEY, [...loadResolvedConflictIds().add(conflictPageId)].slice(-200));
}
const isConflictPage = (p) => !!(p && !loadResolvedConflictIds().has(p.id) && ((p.id || "").startsWith("conflictpg-") || (p.title || "").startsWith("⚠ Konflikt")));
const loadPendingConflicts = () => lsGet(CONFLICT_KEY, []);
function savePendingConflicts(list) {
	if (!list || !list.length) localStorage.removeItem(CONFLICT_KEY);
	else lsSet(CONFLICT_KEY, list);
}
function mergePendingConflicts(details) {
	const map = new Map(loadPendingConflicts().map((c) => [c.conflictPageId || c.pageId, c]));
	for (const c of details || []) map.set(c.conflictPageId || c.pageId, c);
	savePendingConflicts([...map.values()]);
}
function fmtConflictTime(iso) {
	try { return new Date(iso).toLocaleString("de-DE", DATETIME_OPTS); } catch { return iso || "?"; }
}
function legacyConflictItems() {
	return STATE.activePages().filter(isConflictPage).map((p) => ({
		pageId: null,
		title: (p.title || "").replace(/^⚠ Konflikt:\s*/, "").split(" — Stand")[0],
		reason: "Unterlegener Stand einer früheren Sync-Kollision. Vergleiche den Text und entscheide, was behalten wird.",
		localContent: p.content || "", remoteContent: "",
		localTime: p.updated, remoteTime: null,
		winner: "remote", loserContent: p.content || "", loserTime: p.updated,
		conflictPageId: p.id, eventId: null, legacy: true,
	}));
}
// Popup zeigt IMMER beide Stände: Hefte als Blob-Vorschau der ersten Seite,
// Lösch-Konflikte als „gelöscht“ gegen die gerettete Kopie
const conflictPaneHead = (label, time) => `<header><b>${label}</b>${time ? `<small>${esc(fmtConflictTime(time))}</small>` : ""}</header>`;
const conflictHeftPane = (side, label, time, blobKey) => `<section class="conflict-pane ${side}">${conflictPaneHead(label, time)}<div class="conflict-pane-body conflict-heft-body"><canvas width="420" data-conflictheft="${esc(blobKey)}"></canvas><small class="conflict-heft-note"></small></div></section>`;
function buildSpecialComparisonHtml(c) {
	const notePane = (side, label, time, note) => `<section class="conflict-pane ${side}">${conflictPaneHead(label, time)}<div class="conflict-pane-body"><div class="conflict-empty">${esc(note)}</div></div></section>`;
	const textPane = (side, label, time, text) => `<section class="conflict-pane ${side}">${conflictPaneHead(label, time)}<div class="conflict-pane-body"><pre class="conflict-fulltext">${esc(text) || "(Kein Text vorhanden.)"}</pre></div></section>`;
	if (c.conflictType === "heft") {
		const winnerKey = "heft:" + c.pageId, loserKey = "heft:" + c.conflictPageId;
		return '<div class="conflict-compare">' +
			conflictHeftPane("local", "Dieses Gerät", c.localTime, c.winner === "local" ? winnerKey : loserKey) +
			conflictHeftPane("remote", "Drive / anderes Gerät", c.remoteTime, c.winner === "local" ? loserKey : winnerKey) +
			'</div><p class="conflict-key">Vorschau: jeweils die erste Heft-Seite. Der unterlegene Stand liegt zusätzlich als „⚠ Konflikt-Heft“ in der Bibliothek.</p>';
	}
	if (c.conflictType === "delete-change") {
		const kept = c.loserHash
			? conflictHeftPane("remote", "✏️ Geänderter Stand (gerettete Kopie)", c.changedAt, "heft:" + c.conflictPageId)
			: textPane("remote", "✏️ Geänderter Stand (gerettete Kopie)", c.changedAt, ((S.pages[c.conflictPageId] || {}).content || ""));
		return '<div class="conflict-compare">' +
			notePane("local", "🗑 Gelöscht", c.deletedAt, "Die Seite wurde auf einem Gerät endgültig gelöscht. Beim Zusammenführen gewinnt das Löschen — der andere Stand wurde als Kopie gerettet (rechts).") +
			kept + "</div>";
	}
	return '<div class="conflict-no-compare"><b>Kein Textvergleich möglich</b><span>Die Änderung betrifft den Seitenstatus, nicht zwei Textfassungen. Öffne die gerettete Kopie und entscheide anschließend, was erhalten bleiben soll.</span></div>';
}
function fillConflictHeftPreviews(root) {
	root.querySelectorAll("canvas[data-conflictheft]").forEach(async (cv) => {
		const note = cv.parentElement?.querySelector(".conflict-heft-note");
		let pages = 0;
		try { pages = await HEFT.renderBlobPreview(cv.dataset.conflictheft, cv); } catch (e) { console.warn("Konflikt-Vorschau:", e); }
		if (note) note.textContent = pages ? (pages > 1 ? "Seite 1 von " + pages : "") : "Vorschau nicht möglich — dieser Stand liegt lokal nicht (mehr) vor.";
	});
}
function openConflictResolver(index) {
	let items = loadPendingConflicts();
	if (!items.length) items = legacyConflictItems();
	if (!items.length) return void U.toast("Keine offenen Konflikte.", "success");
	const i = Math.max(0, Math.min(Number(index) || 0, items.length - 1));
	S.conflictResolveIndex = i;
	S.conflictResolveList = items;
	const c = items[i];
	const left = c.localContent || "", right = c.remoteContent || "";
	const hasTextComparison = !c.conflictType && (!!left || !!right);
	// U.diffLines wechselt bei sehr langen Seiten in einen groben Modus (keine
	// quadratische Diff-Matrix) → dann beide Volltexte zeigen statt Platzhalter
	const lines = (t) => String(t).split("\n").length;
	const coarse = hasTextComparison && (lines(left) > 400 || lines(right) > 400);
	const diff = hasTextComparison && !coarse ? U.diffLines(left, right) : [];
	const paneHtml = (side) => {
		if (coarse) return '<pre class="conflict-fulltext">' + (esc(side === "local" ? left : right) || "(Kein Text vorhanden.)") + "</pre>";
		return diff.filter((d) => d.type === "same" || (side === "local" ? d.type === "del" : d.type === "add")).map((d) => {
			const changed = d.type !== "same";
			return `<div class="conflict-line ${changed ? (side === "local" ? "local-only" : "remote-only") : "same"}"><span class="conflict-line-marker">${changed ? (side === "local" ? "−" : "+") : ""}</span>${esc(d.text) || "&nbsp;"}</div>`;
		}).join("") || '<div class="conflict-empty">Kein Text vorhanden.</div>';
	};
	const winnerLabel = c.winner === "local" ? "Dieses Gerät" : "Drive / anderes Gerät";
	const conflictSummary = c.reason || (c.conflictType === "delete-change"
		? "Auf einem Gerät wurde die Seite gelöscht, während sie auf dem anderen Gerät noch geändert oder verschoben wurde. Die App kann diese beiden Aktionen nicht automatisch zusammenführen."
		: "Diese Seite wurde nach der letzten erfolgreichen Synchronisierung zweimal unabhängig geändert: auf diesem Gerät am " + fmtConflictTime(c.localTime) + " und in Drive am " + fmtConflictTime(c.remoteTime) + ". Deshalb kann die App nicht sicher entscheiden, welchen Text du behalten möchtest.");
	const pane = (side, label, time) => `<section class="conflict-pane ${side}"><header><b>${label}</b><small>${esc(fmtConflictTime(time))}</small></header><div class="conflict-pane-body">${paneHtml(side)}</div></section>`;
	const comparisonHtml = hasTextComparison
		? '<div class="conflict-compare">' + pane("local", "Dieses Gerät", c.localTime) + pane("remote", "Drive / anderes Gerät", c.remoteTime) + "</div>" +
			(coarse ? '<p class="conflict-key">Lange Seite: Beide vollständigen Inhalte werden gezeigt. Eine zeilenweise Markierung wäre hier zu langsam.</p>' : '<p class="conflict-key"><span>− Nur dieses Gerät</span><span>+ Nur Drive / anderes Gerät</span><span>Unmarkiert: gleich</span></p>')
		: buildSpecialComparisonHtml(c);
	const o = openOverlay('<div class="modal conflict-modal">' +
		'<button class="modal-x" id="btnCloseOverlay" title="Schließen">✕</button>' +
		'<header class="conflict-head"><span class="conflict-icon">⚠</span><span><b>Synchronisation braucht eine Entscheidung' +
		(items.length > 1 ? ` · ${i + 1} von ${items.length}` : "") + `</b><small>“${esc(c.title || "Seite")}”</small></span></header>` +
		'<div class="conflict-reason"><b>Warum sehe ich das?</b> ' + esc(conflictSummary) +
		(c.legacy ? "" : `<br><span class="hint">Die App empfiehlt: <b>${esc(winnerLabel)}</b> behalten, weil dieser Stand den neueren Zeitstempel hat.</span>`) +
		"</div>" + comparisonHtml +
		'<div class="conflict-actions"><button class="primary" data-conflictresolve="keep-winner">Empfehlung übernehmen</button>' +
		(c.pageId && !c.legacy ? '<button data-conflictresolve="use-loser">Stattdessen anderen Stand übernehmen</button>' : "") +
		"</div></div>");
	if (o) fillConflictHeftPreviews(o);
}
async function resolveConflict(action) {
	const list = S.conflictResolveList || loadPendingConflicts();
	const i = S.conflictResolveIndex || 0;
	const conf = list[i];
	if (!conf) return;
	if (action === "use-loser" && conf.pageId) {
		if (conf.conflictType === "heft") {
			// Winner-Ansicht erst schließen (unmount könnte alten In-Memory-Stand
			// zurückschreiben), dann Loser-Blob in den Winner-Slot kopieren
			if (HEFT.activeId === conf.pageId) HEFT.unmount(true);
			const loserBlob = await DB.getBlob("heft:" + conf.conflictPageId);
			if (loserBlob && loserBlob.buf && loserBlob.meta) {
				await DB.putBlob("heft:" + conf.pageId, loserBlob.buf, { ...loserBlob.meta, hash: conf.loserHash });
				await STATE.dispatch("heftUpdated", { pageId: conf.pageId, rev: loserBlob.meta.rev, pages: loserBlob.meta.pages || 1, bytes: loserBlob.buf.byteLength, blobHash: conf.loserHash });
			}
		} else if (conf.conflictType === "delete-change") {
			// Gerettete Kopie: Titel/Workspace/Elternordner aus dem Payload zurück (nicht Root)
			await STATE.dispatch("pageUpdate", { id: conf.conflictPageId, patch: { title: conf.title, parentId: conf.parentId || null, workspaceId: conf.workspaceId || "default" } });
		} else {
			await STATE.dispatch("pageUpdate", { id: conf.pageId, patch: { content: conf.loserContent } });
		}
	}
	if (conf.conflictPageId && S.pages[conf.conflictPageId] &&
		(action === "keep-winner" || (action === "use-loser" && conf.conflictType !== "delete-change"))) {
		await STATE.dispatch("pageTrash", { id: conf.conflictPageId });
	}
	// Pending bereinigen + Kopie lokal quittieren (sonst kommt derselbe Banner/Dialog
	// bei „Beide behalten“ nach dem nächsten Start wieder)
	markConflictResolved(conf.conflictPageId);
	const next = loadPendingConflicts().filter((x) => (x.conflictPageId || x.pageId) !== (conf.conflictPageId || conf.pageId));
	savePendingConflicts(next);
	if (next.length) { openConflictResolver(Math.min(i, next.length - 1)); render(); return; }
	const o = $("overlay");
	if (o) { o.hidden = true; o.innerHTML = ""; }
	U.toast("Konflikt erledigt.", "success");
	render();
}

// Home v3: persönliches Dashboard — Begrüßung, Kennzahlen, Heute-Leiste,
// Telemetrie-Insights, ausklappbare Bereiche mit gemerktem Zustand
const HOME_FOLD_KEY = "impala67HomeFolds";
const homeFolds = () => lsGet(HOME_FOLD_KEY, {}) || {};
const homeFoldOpen = (id, fb) => { const f = homeFolds(); return f[id] === undefined ? fb : !!f[id]; };
const homeFold = (id, summary, body, fbOpen) => `<details class="home-fold" data-fold="${id}"${homeFoldOpen(id, fbOpen) ? " open" : ""}><summary>${summary}</summary><div class="home-fold-body">${body}</div></details>`;
// <details>-Zustand persistieren — "toggle" blubbert nicht → Capture-Phase
document.addEventListener("toggle", (e) => {
	const el = e.target;
	if (!el || !el.matches || !el.matches("details[data-fold]")) return;
	lsSet(HOME_FOLD_KEY, { ...homeFolds(), [el.getAttribute("data-fold")]: el.open });
}, true);
function renderHome(main) {
	// Scroll-Anker: jedes Re-Render (Fold, Pins, Sync…) hüpfte sonst nach oben
	const homeScroller = main.querySelector(".home");
	const keepScroll = (homeScroller && homeScroller.scrollTop) || main.scrollTop || 0;
	const pages = STATE.activePages();
	const conflictCount = Math.max(loadPendingConflicts().length, pages.filter(isConflictPage).length);
	const recent = pages.filter((p) => !isConflictPage(p)).slice().sort((a, b) => (b.updated || "").localeCompare(a.updated || "")).slice(0, 6);
	const chats = CHATS.load().slice().sort((a, b) => (b.updated || b.created || "").localeCompare(a.updated || a.created || ""));
	const due = STATE.dueCards().length;
	const lastBk = localStorage.getItem("impala67LastBackup") || localStorage.getItem("notionLastBackup");
	const bkDays = lastBk ? Math.max(0, Math.floor((Date.now() - new Date(lastBk).getTime()) / 864e5)) : null;
	const bkDue = pages.length > 3 && (bkDays === null || bkDays > 7);
	const daily = pages.find((p) => p.daily === localDayKey(new Date()));
	const dailyLine = daily ? ((daily.content || "").split("\n").find((l) => l.trim()) || "").replace(/^#+\s*/, "").slice(0, 48) : "";
	const hour = new Date().getHours();
	const greeting = hour < 5 ? "Gute Nacht" : hour < 11 ? "Guten Morgen" : hour < 18 ? "Guten Tag" : "Guten Abend";
	const dateLine = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
	const cardCount = ((STATE.activeCards && STATE.activeCards()) || Object.values(S.cards).filter((c) => !c.trashed)).length;
	const lz = LERNZEIT.statsForHome();
	// Erfolgsquote 30 Tage: echte Wiederholungen wie die Statistik-Retention.
	// FIX: bei < 10 strengen Reviews auf alle bewerteten zurückfallen (gleiche
	// breite Definition wie die Insights) statt widersprüchlich „—“ zu zeigen
	const cut30 = new Date(Date.now() - 30 * 864e5).toISOString();
	const graded30 = (S.reviews || []).filter((r) => r.t >= cut30 && r.grade > 0 && !r.first && !r.learning);
	const gradedWide30 = (S.reviews || []).filter((r) => r.t >= cut30 && r.grade > 0);
	const pool = graded30.length >= 10 ? graded30 : (gradedWide30.length >= 10 ? gradedWide30 : null);
	const retention30 = pool ? Math.round(pool.filter((r) => r.grade > 1).length / pool.length * 100) : null;

	const conflictBanner = conflictCount
		? `<div class="conflict-banner"><div class="conflict-banner-copy"><b>⚠ ${conflictCount} Sync-Konflikt${conflictCount === 1 ? "" : "e"}</b><span>Gleiche Seite auf mehreren Geräten geändert — Diff prüfen & lösen.</span></div><button data-conflictopen="0">Jetzt lösen</button></div>`
		: "";

	// Kompakte „Heute“-Leiste statt großer Widget-Kacheln
	const pill = (cls, attr, title, ico, b, small) => `<button class="home-pill${cls}" ${attr} title="${title}"><span class="home-pill-ico">${ico}</span><span class="home-pill-body"><b>${b}</b><small>${small}</small></span></button>`;
	const todayPills = '<div class="home-today">' +
		pill("", 'data-homeaction="daily"', "Daily Note", "📅", "Daily", esc(dailyLine || (daily ? "Öffnen" : "Heute anlegen"))) +
		pill(due ? " attention" : "", 'data-homeaction="cards"', "Karteikarten", "🃏", due + " fällig", due ? "Jetzt lernen" : "Alles erledigt") +
		pill("", 'data-noten-open="1"', "Schulnoten öffnen", "🎓", "Noten", "Eintragen & Schnitt ansehen") +
		(bkDue ? pill(" attention", 'data-homeaction="backup"', "Backup", "↥", "Backup", bkDays === null ? "Noch keins" : `Vor ${bkDays} Tag${bkDays === 1 ? "" : "en"}`) : "") +
		"</div>";

	const continueBlock = recent[0]
		? `<button class="home-continue" data-page="${recent[0].id}"><span class="recent-icon">${esc(pageIconLabel(recent[0]))}</span><span class="recent-copy"><small>Weitermachen</small><b>${esc(recent[0].title)}</b><small>Zuletzt · ${U.fmtDate(recent[0].updated)}</small></span><span class="recent-arrow">›</span></button>`
		: '<button class="home-continue muted" data-homeaction="newpage"><span class="recent-icon">✦</span><span class="recent-copy"><small>Start</small><b>Erste Seite anlegen</b><small>Workspace ist noch leer</small></span><span class="recent-arrow">›</span></button>';

	const listRow = (attr, ico, b, small) => `<button class="home-list-row" ${attr}><span class="recent-icon sm">${ico}</span><b>${b}</b><small>${small}</small><i>›</i></button>`;
	const recentPages = recent.length
		? '<div class="home-list">' + recent.map((pg) => listRow(`data-page="${pg.id}"`, esc(pageIconLabel(pg)), esc(pg.title), U.fmtDate(pg.updated))).join("") + "</div>"
		: '<div class="empty-state compact"><b>Noch keine Seiten</b><p>Leg die erste an oder öffne die Bibliothek.</p><button data-homeaction="newpage">Neue Seite</button></div>';
	const recentChats = chats.slice(0, 3).map((c) => listRow(`data-chat="${c.id}"`, "✦", esc(c.title || "Chat"), U.fmtDate(c.updated || c.created))).join("");

	// Kennzahlen: heute gelernt, Streak, fällige Karten, Erfolgsquote
	const stats = '<div class="home-statgrid">' +
		`<div class="home-stat accent"><b>${LERNZEIT.fmt(lz.todaySeconds)}</b><small>heute gelernt</small></div>` +
		`<div class="home-stat"><b><span class="home-streak-flame">🔥</span>${lz.streakDays}</b><small>${lz.streakDays === 1 ? "Tag Streak" : "Tage Streak"}</small></div>` +
		`<div class="home-stat${due ? " accent" : ""}"><b>${due}</b><small>Karten fällig</small></div>` +
		`<div class="home-stat${retention30 !== null && retention30 >= 85 ? " good" : ""}"><b>${retention30 === null ? "—" : retention30 + " %"}</b><small>Erfolgsquote (30 Tage)</small></div></div>`;

	const homeHtml = '<div class="home home-v2 home-slim">' +
		`<header class="home-hero"><div><h1>${greeting} 👋</h1><p class="home-meta">${dateLine}</p><div class="home-hero-meta">` +
			`<span class="home-chip">📄 <b>${pages.length}</b> Seiten</span><span class="home-chip">🃏 <b>${cardCount}</b> Karten</span><span class="home-chip">✦ <b>${chats.length}</b> Chats</span>` +
			`<span class="home-chip${lz.goalPct < 100 ? " warn" : ""}">🎯 Wochenziel <b>${lz.goalPct} %</b></span>` +
		'</div></div><button class="home-customize" data-set="look" title="Design anpassen">⚙</button></header>' +
		conflictBanner + stats +
		'<div class="quick-actions"><button data-homeaction="newpage">+ Neue Seite</button></div>' +
		'<section class="home-section home-section-continue">' + continueBlock + "</section>" +
		todayPills +
		homeFold("insights", '🧠 Lern-Insights <span class="fold-meta">aus deiner Telemetrie</span>', TELE.homeInsightsHtml(), true) +
		homeFold("recent", `📄 Zuletzt <span class="fold-meta">${pages.length} Seiten</span>`, recentPages + '<div class="fold-foot"><button class="mini" data-homeaction="library">Bibliothek öffnen ›</button></div>', true) +
		(recentChats ? homeFold("chats", `✦ Chats <span class="fold-meta">${chats.length}</span>`, '<div class="home-list">' + recentChats + '</div><div class="fold-foot"><button class="mini" data-homeaction="chats">Alle Chats ›</button></div>', false) : "") +
		LERNZEIT.homeWidgetHtml() + "</div>";
	// PERF: nur neu aufbauen, wenn sich das Markup wirklich geändert hat
	if (main._lastHomeHtml === homeHtml && main.querySelector(".home")) return;
	main.innerHTML = homeHtml;
	main._lastHomeHtml = homeHtml;
	if (keepScroll) {
		main.scrollTop = keepScroll;
		if (main.scrollTop !== keepScroll) {
			const h = main.querySelector(".home"); // falls .home selbst scrollt
			if (h) h.scrollTop = keepScroll;
		}
	}
}

// Papierkorb: Seiten, Stapel, Karten — Soft-Delete mit Wiederherstellen / Endgültig löschen
const trashRow = (kind, id, title, hint) =>
	`<div class="trash-row"><span class="row-title">${title}</span><span class="hint">${hint}</span>` +
	`<button data-${kind}restore="${id}">↩ Wiederherstellen</button><button data-${kind}purge="${id}" class="danger">🗑 Endgültig löschen</button></div>`;
function renderTrash(main) {
	const pages = STATE.trashedPages();
	const decks = (STATE.trashedDeckRoots && STATE.trashedDeckRoots()) || [];
	const cards = (STATE.orphanTrashedCards && STATE.orphanTrashedCards()) || [];
	let html = '<div class="library"><div class="lib-head"><div><h1>🗑 Papierkorb</h1><p class="hint">Seiten, Stapel und Karten — wiederherstellbar, bis du sie endgültig löschst.</p></div><button class="danger" data-trashclear="1">Papierkorb leeren</button></div>';
	if (!pages.length && !decks.length && !cards.length) {
		main.innerHTML = html + '<p class="hint">Der Papierkorb ist leer.</p></div>';
		return;
	}
	const head = (label) => `<div class="ws-head"><span class="ws-name">${label}</span></div>`;
	html += '<div class="trash-list">';
	if (pages.length) html += head("Seiten") + pages.map((pg) => trashRow("page", pg.id, pageIconHtml(pg) + esc(pg.title), "gelöscht " + U.fmtDate(pg.trashedAt || pg.updated))).join("");
	if (decks.length) html += head("Stapel") + decks.map((name) => {
		const n = Object.values(S.cards).filter((c) => c.trashed && ((c.deck || "Standard") === name || (c.deck || "Standard").startsWith(name + "::"))).length;
		return trashRow("deck", esc(name), "🃏 " + esc(name) + (n ? ` · ${n} Karte(n)` : ""), "gelöscht " + U.fmtDate((S.decks[name] || {}).trashedAt || ""));
	}).join("");
	if (cards.length) html += head("Karten") + cards.map((c) => {
		const front = (c.front || "").replace(/\s+/g, " ").trim();
		return trashRow("card", c.id, "🃏 " + esc((front.length > 60 ? front.slice(0, 60) + "…" : front) || "(leere Vorderseite)"), esc(c.deck || "Standard") + " · gelöscht " + U.fmtDate(c.trashedAt || ""));
	}).join("");
	main.innerHTML = html + "</div></div>";
}

// Blob → Object-URL, einmal je Sitzung gecacht (Cover + Inline-Bilder)
const COVER_URLS = {}, IMG_URLS = {};
async function blobUrl(cache, id, fallbackType) {
	if (cache[id]) return cache[id];
	try {
		const rec = await DB.getBlob(id);
		if (!rec || !rec.buf || !rec.buf.byteLength) return null;
		return (cache[id] = URL.createObjectURL(new Blob([rec.buf], { type: (rec.meta && rec.meta.type) || fallbackType })));
	} catch (e) { console.warn("Blob konnte nicht geladen werden:", e); return null; }
}

// Cover/Bilder nach dem Rendern nachladen (innerHTML kann kein async)
function hydrateCovers(root) {
	(root || document).querySelectorAll("[data-coverimg]").forEach(async (el) => {
		if (el.dataset.coverHydrated) return;
		el.dataset.coverHydrated = "1";
		const u = await blobUrl(COVER_URLS, el.dataset.coverimg, "image/jpeg");
		if (u) el.style.backgroundImage = `url('${u}')`;
	});
}
function hydrateImages(root) {
	(root || document).querySelectorAll('img[src^="img:"]').forEach(async (img) => {
		const u = await blobUrl(IMG_URLS, img.getAttribute("src"), "image/png");
		if (u) img.src = u;
	});
}

// Lokaler Tages-Schlüssel "YYYY-MM-DD" (bewusst NICHT toISOString — Zeitzone!)
function localDayKey(x) {
	const d = new Date(x);
	return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// Daily Notes (📅): Monatskalender, jeder Tag eine eigene Seite
function renderDaily(main) {
	const now = new Date();
	const cur = S.dailyMonth ? new Date(S.dailyMonth + "-01T12:00:00") : new Date(now.getFullYear(), now.getMonth(), 1);
	const y = cur.getFullYear(), mo = cur.getMonth();
	const todayKey = localDayKey(now);
	const notes = {};
	STATE.activePages().forEach((p) => { if (p.daily) notes[p.daily] = p; });
	const startOffset = (new Date(y, mo, 1).getDay() + 6) % 7; // Montag = 0
	let cells = '<div class="cal-day other"></div>'.repeat(startOffset);
	for (let d = 1, days = new Date(y, mo + 1, 0).getDate(); d <= days; d++) {
		const key = y + "-" + String(mo + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
		const pg = notes[key];
		const snippet = pg ? ((pg.content || "").split("\n").find((l) => l.trim()) || "") : "";
		cells += `<div class="cal-day${key === todayKey ? " today" : ""}${pg ? " has-note" : ""}" data-dailyday="${key}" title="${key}"><span class="cal-num">${d}</span>${pg ? `<span class="cal-snippet">${esc(snippet.slice(0, 70))}</span>` : ""}</div>`;
	}
	main.innerHTML = '<div class="library daily"><div class="lib-head"><h1>📅 Daily Notes</h1>' +
		'<div class="mode-btns"><button data-dailynav="-1" title="Voriger Monat">‹</button><button id="btnDailyToday">Heute</button><button data-dailynav="1" title="Nächster Monat">›</button></div>' +
		`<span class="hint">${cur.toLocaleDateString("de-DE", { month: "long", year: "numeric" })} — Tag anklicken öffnet (oder erstellt) die Tagesseite</span></div>` +
		'<div class="cal-grid cal-head-row">' + ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((d) => `<div class="cal-dow">${d}</div>`).join("") + "</div>" +
		'<div class="cal-grid">' + cells + "</div></div>";
}

// Anlege-Dialog: Notion-Seite oder GoodNotes-Heft, Vorlagen darunter
function openTemplatePicker() {
	const tpls = STATE.activePages().filter((p) => p.isTemplate);
	openOverlay(modal(
		"<h3>Neu anlegen</h3>" +
		'<div class="newpage-cards">' +
			'<button type="button" class="newpage-card" data-tplblank="1"><span class="newpage-visual is-notion" aria-hidden="true"><i></i><i></i><i></i></span><b>Notion-Seite</b><small>Blöcke · Markdown · Verlinkungen</small></button>' +
			'<button type="button" class="newpage-card" data-tplheft="1"><span class="newpage-visual is-heft" aria-hidden="true"><span></span></span><b>GoodNotes-Heft</b><small>Papier · Stift · Seiten</small></button>' +
		"</div>" +
		(tpls.length ? '<p class="hint">Oder aus einer Vorlage:</p>' : "") +
		tpls.map((p) => `<button class="tpl-opt" data-tpluse="${p.id}">${p.icon ? esc(p.icon) + " " : (p.kind === "heft" ? "📓 " : "📑 ")}${esc(p.title)}</button>`).join("") +
		'<div class="modal-actions"><button id="btnCloseOverlay">Abbrechen</button></div>'
	));
}

// Verlauf: Versionsliste (Event-Log) links, Vorschau rechts; Wiederherstellen
// erzeugt ein NEUES Event — der Verlauf bleibt vollständig
function renderHistoryModal() {
	const vs = S.histVersions || [];
	const idx = Math.max(0, Math.min(S.histIndex, vs.length - 1));
	const v = vs[idx];
	const items = vs.map((x, i) => ({ x, i })).reverse().slice(0, 50).map(({ x, i }) =>
		`<button class="hist-item${i === idx ? " active" : ""}" data-histversion="${i}">${new Date(x.t).toLocaleString("de-DE", DATETIME_OPTS)}${i === vs.length - 1 ? ' <span class="hint">aktuell</span>' : ""}</button>`).join("");
	const o = openOverlay('<div class="modal hist-modal">' +
		'<button class="modal-x" id="btnCloseOverlay" title="Schließen">✕</button>' +
		'<div class="hist-list"><h3>🕘 Verlauf</h3>' + (items || '<p class="hint">Keine Versionen</p>') + "</div>" +
		`<div class="hist-preview"><h3>${esc(v ? v.title : "")}</h3><div class="md hist-md">${v ? U.md(v.content) : ""}</div>` +
		`<div class="modal-actions"><button id="btnHistRestore" ${!v || idx === vs.length - 1 ? "disabled" : ""}>↩ Diese Version wiederherstellen</button></div></div></div>`);
	const pv = o && o.querySelector(".hist-md");
	if (pv) { U.renderMath(pv); U.highlightCode(pv); hydrateImages(pv); }
}

// ---------- Chat: Nachrichten, Thinking (live + final), Edit-Karten, Datei-Chips ----------
// historyList = der Chat, in dem die Nachricht steht (side ODER full) — sonst
// greift die Bearbeiten-Sperre im Seitenpanel nie (früher nur S.chat geprüft)
function userMsgHtml(m, historyList) {
	// Bearbeiten gesperrt, solange darunter nicht rückgängig gemachte Edits stehen
	const list = historyList || S.chat;
	const idx = list.findIndex((x) => x.mid === m.mid);
	const locked = idx !== -1 && list.slice(idx + 1).some((x) => x.role === "edit" && !x.undone);
	return '<div class="msg user">' +
		`<button class="msg-edit${locked ? " locked" : ""}" data-editmsg="${m.mid}" title="${locked ? "Erst spätere Änderungen rückgängig machen" : "Bearbeiten"}">${locked ? "🔒" : "✎"}</button>` +
		(m.content ? esc(m.content) : "") +
		(m.image ? `<img class="msg-img" src="${m.image}" alt="Anhang">` : "") +
		(m.textFile ? fileChipHtml(m) : "") +
		(m.pdfFile ? `<div class="file-chip"><span>📄 ${esc(m.pdfFile.name)} · ${m.pdfFile.pages || "?"} Seiten</span></div>` : "") +
		"</div>";
}

// Lange geklebte Texte als .txt-Karte (Modell bekommt den Inhalt trotzdem als Kontext)
const fileChipHtml = (m) => `<div class="file-chip"><span>📄 ${esc(m.textFile.name)} · ${m.textFile.size} Zeichen</span><button data-filedownload="${m.mid}">Herunterladen</button></div>`;

// Werkzeug-Karte je Tool-Aufruf („Hat … verwendet“)
const TOOL_LABELS = {
	read_page: "Seite gelesen", search_notes: "Notizen durchsucht", semantic_search: "Semantische Suche",
	create_page: "Seite erstellt", append_to_page: "Seite ergänzt", replace_page_content: "Seite überschrieben",
	create_flashcard: "Karteikarte erstellt", create_cloze_card: "Cloze-Karten erstellt", move_page: "Seite verschoben",
	list_pages: "Seiten aufgelistet", list_due_cards: "Fällige Karten", send_to_notebooklm: "An NotebookLM",
	ask_choice: "Rückfrage gestellt", delete_page: "Seite gelöscht", delete_flashcard: "Karte gelöscht", delete_deck: "Stapel gelöscht",
};
const toolChipHtml = (m) => `<div class="tool-chip${m.error ? " err" : ""}" title="Werkzeug: ${esc(m.name)}">⚙️ ${esc(TOOL_LABELS[m.name] || m.name)}${m.detail ? ` <span class="tool-detail">· ${esc(m.detail)}</span>` : ""}${m.error ? " — Fehler" : ""}</div>`;

// Fertige Nachrichten getrennt vom Live-Entwurf — bleibt beim Streamen unangetastet
function chatStaticHtml(list = []) {
	return list.map((m) =>
		m.role === "edit" ? editCardHtml(m)
		: m.role === "question" ? questionCardHtml(m)
		: m.role === "tool" ? toolChipHtml(m)
		: m.role === "assistant" ? assistantMsgHtml(m)
		: userMsgHtml(m, list)).join("");
}

function chatLiveParts(historyList) {
	if (!S.aiBusy) return { think: "", rest: "" };
	const activeList = S.aiActiveChatType === "side" ? S.sideChat : S.chat;
	if (historyList !== activeList) return { think: "", rest: "" };
	// Offene ask_choice-Karte IST der Wartezustand — keine zweite busy-Zeile
	const waitingChoice = activeList.some((m) => m.role === "question" && !m.answered);
	// Think-Box UND Draft parallel — sonst wirkt geleaktes Reasoning wie die Antwort
	const think = S.aiThinkingDraft ? thinkingLiveHtml() : "";
	const rest = S.aiDraft ? '<div class="msg assistant busy"><div class="md">' + U.md(S.aiDraft) + "</div></div>"
		: (!S.aiThinkingDraft && !waitingChoice ? '<div class="msg assistant busy">' + esc(S.aiStatus || "…") + "</div>" : "");
	return { think, rest };
}

// FNV-Signatur statt innerHTML-Neuaufbau — erkennt auch In-Place-Änderungen
// (Undo, aufgeklapptes Thinking, beantwortete Rückfragen). PERF: Felder direkt
// in den Hash falten, kein JSON.stringify des ganzen Verlaufs (Bild-Data-URLs!)
function chatHistorySignature(list) {
	let hash = 2166136261;
	const add = (v) => {
		const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
		for (let i = 0; i < s.length; i++) { hash ^= s.charCodeAt(i); hash = Math.imul(hash, 16777619); }
		hash ^= 30; // Feldtrenner
		hash = Math.imul(hash, 16777619);
	};
	for (const m of list || []) for (const k in m) { add(k); add(m[k]); }
	return hash >>> 0;
}

function enhanceChatStatic(log, staticEnd) {
	for (let n = log.firstChild; n && n !== staticEnd; n = n.nextSibling)
		if (n.nodeType === Node.ELEMENT_NODE) { U.renderMath(n); U.highlightCode(n); }
}

function renderChatLog(log, historyList) {
	const signature = chatHistorySignature(historyList);
	let staticEnd = log._chatStaticEnd, live = log._chatLive;
	// Fertige Nachrichten bleiben direkte Kinder (CSS/Event-Delegation); nur der
	// Live-Bereich bekommt einen unsichtbaren Container als Patch-Ziel
	if (!staticEnd || !live || staticEnd.parentNode !== log || live.parentNode !== log) {
		staticEnd = document.createComment("chat-static-end");
		live = document.createElement("div");
		live.className = "chat-live";
		live.style.display = "contents";
		log.replaceChildren(staticEnd, live);
		log._chatStaticEnd = staticEnd;
		log._chatLive = live;
		log._chatStaticSignature = null;
	}
	if (log._chatStaticSignature !== signature) {
		while (log.firstChild !== staticEnd) log.removeChild(log.firstChild);
		const tpl = document.createElement("template");
		tpl.innerHTML = chatStaticHtml(historyList);
		staticEnd.before(tpl.content);
		log._chatStaticSignature = signature;
		enhanceChatStatic(log, staticEnd);
	}
	// FIX: Live-Bereich nicht mehr pro Streaming-Delta per innerHTML ersetzen —
	// Klicks zwischen Mousedown/-up gingen verloren, die Think-Box ließ sich nie
	// aufklappen. Think und Draft getrennt patchen, Toggle bleibt stabil im DOM
	const liveParts = chatLiveParts(historyList);
	let thinkHost = live._thinkHost, restHost = live._restHost;
	if (!thinkHost || !restHost || thinkHost.parentNode !== live || restHost.parentNode !== live) {
		thinkHost = document.createElement("div");
		thinkHost.style.display = "contents";
		restHost = document.createElement("div");
		restHost.style.display = "contents";
		live.replaceChildren(thinkHost, restHost);
		live._thinkHost = thinkHost;
		live._restHost = restHost;
		thinkHost._structure = null;
		restHost._chatHtml = null;
	}
	const thinkStructure = liveParts.think ? "think:" + (S.thinkingLiveExpanded ? "1" : "0") : "";
	if (thinkHost._structure !== thinkStructure) {
		thinkHost.innerHTML = liveParts.think;
		thinkHost._structure = thinkStructure;
	} else if (liveParts.think) {
		const body = thinkHost.querySelector(".think-body");
		const thinkText = S.thinkingLiveExpanded ? S.aiThinkingDraft : U.lastLines(S.aiThinkingDraft, 2);
		if (body && body.textContent !== thinkText) {
			body.textContent = thinkText;
			if (S.thinkingLiveExpanded) body.scrollTop = body.scrollHeight; // am neuesten Gedanken bleiben
		}
	}
	if (restHost._chatHtml !== liveParts.rest) {
		restHost.innerHTML = liveParts.rest;
		restHost._chatHtml = liveParts.rest;
		U.renderMath(restHost);
		U.highlightCode(restHost);
	}
	// Ans Ende folgen — außer der Nutzer hat hochgescrollt, um nachzulesen
	const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 160;
	if (nearBottom || !log._chatAutoScrolled) { log.scrollTop = log.scrollHeight; log._chatAutoScrolled = true; }
}

// Rückfrage-Karte (ask_choice): Frage + Options-Zeilen, nach Klick nur die Antwort
function questionCardHtml(m) {
	if (m.answered) {
		return `<div class="msg assistant question-card answered"><div class="q-label">Rückfrage</div><div class="q-text">${esc(m.question)}</div><div class="q-picked"><span class="q-check">✓</span> <b>${esc(m.answer)}</b></div></div>`;
	}
	const opts = Array.isArray(m.options) ? m.options : [];
	return `<div class="msg assistant question-card pending" data-qmid="${esc(m.mid)}"><div class="q-label">Rückfrage</div><div class="q-text">${esc(m.question)}</div><div class="q-options">` +
		opts.map((o, i) => `<button type="button" class="q-opt" data-answerq="${esc(m.mid)}" data-answeridx="${i}"><span class="q-opt-label">${esc(o)}</span></button>`).join("") + "</div></div>";
}

function renderSideContextChip() {
	const chip = $("sideContextChip");
	if (!chip) return;
	const pg = S.currentPageId ? S.pages[S.currentPageId] : null;
	chip.hidden = !pg;
	chip.innerHTML = pg ? `<span class="side-context-icon">📄</span><span class="side-context-title">${esc(pg.title || "Unbenannte Seite")}</span><span class="side-context-note">Seitenkontext</span>` : "";
}

function renderChat() {
	renderSideContextChip();
	const log = $("chatLog");
	if (log) renderChatLog(log, S.sideChat);
}

// PERF (Tab-Wechsel): Chat-Log-DOM je Chat wiederverwenden. Beim Wechsel zwischen
// (langen) Chats wurden sonst ALLE Nachrichten inkl. KaTeX/Code-Highlighting neu
// aufgebaut — renderChatLog patcht auf dem gecachten DOM nur noch Unterschiede.
const CHATLOG_CACHE = new Map(); // chatId → <div class="chat-log-full">
function cachedChatLog(chatId) {
	let el = CHATLOG_CACHE.get(chatId);
	if (!el) {
		el = document.createElement("div");
		el.className = "chat-log-full";
		el.addEventListener("scroll", () => { el._keepScroll = el.scrollTop; }, { passive: true });
		CHATLOG_CACHE.set(chatId, el);
		for (const key of CHATLOG_CACHE.keys()) { // Cache klein halten (älteste zuerst raus)
			if (CHATLOG_CACHE.size <= 6) break;
			CHATLOG_CACHE.delete(key);
		}
	}
	el.id = "mainChatLog";
	return el;
}

// Vollbild-Chat im Hauptbereich — gleiche Bausteine wie das Seitenpanel.
// FIX: bestehendes Chat-Fenster WIEDERVERWENDEN statt pro Hintergrund-Render neu
// bauen — sonst riss ein frisches #mainChatLog die Ansicht per Auto-Scroll nach
// unten und getippter Text im Eingabefeld ging verloren
function renderFullChat(main) {
	const s = S.currentChatId ? CHATS.load().find((x) => x.id === S.currentChatId) : null;
	const title = (s && s.title) || "Neuer Chat";
	const empty = !S.chat.length;
	const oldWrap = main.querySelector(".chat-full-wrap");
	if (oldWrap && oldWrap.dataset.chatid === String(S.currentChatId || "")) {
		const h1 = oldWrap.querySelector(".chat-full-head h1");
		const wantTitle = "✦ " + title;
		if (h1 && h1.textContent !== wantTitle) h1.textContent = wantTitle;
		if (!empty) {
			oldWrap.querySelector(".chat-empty-hint")?.remove();
			oldWrap.querySelector(".chat-suggests")?.remove();
		}
		renderMainChatLog();
		renderPendingChip("full");
		return;
	}
	main.innerHTML =
		`<div class="chat-full-wrap" data-chatid="${esc(String(S.currentChatId || ""))}">` +
			'<div class="chat-full-head"><button type="button" class="ai-status-chip" id="aiStatusChipFull" title="KI-Status" data-aistatus="1"></button>' +
			`<h1>✦ ${esc(title)}</h1></div>` +
			// Schnellstart-Chips setzen einen Prompt-Anfang ins Eingabefeld (kein Auto-Senden)
			(empty ? '<p class="hint chat-empty-hint">Stell deine erste Frage — die Antwort erscheint hier groß, LaTeX und Code werden live gerendert.</p>' +
				'<div class="chat-suggests">' +
				'<button type="button" data-chatsuggest="Erkläre mir Schritt für Schritt: ">💡 Erkläre mir…</button>' +
				'<button type="button" data-chatsuggest="Erstelle Karteikarten zu: ">🃏 Karteikarten zu…</button>' +
				'<button type="button" data-chatsuggest="Fasse kompakt zusammen: ">📄 Fasse zusammen…</button>' +
				'<button type="button" data-chatsuggest="Stell mir 5 Prüfungsfragen zu: ">🎯 Quiz mich zu…</button></div>' : "") +
			'<div id="mainChatLog" class="chat-log-full"></div>' +
			'<form id="mainChatForm" class="chat-form-full"><div id="mainPendingChip" hidden></div>' +
				'<div class="composer-body"><textarea id="mainChatInput" rows="1" placeholder="Frag deinen KI-Coach…"></textarea></div>' +
				'<div class="composer-actions"><div class="composer-actions-left">' +
					'<button type="button" id="btnAttachFull" title="Fotos und Dateien hinzufügen">+</button>' +
					'<button type="button" id="btnModelChipFull" class="composer-tool" title="Modell wählen"></button>' +
				'</div><button id="mainChatSubmit" type="submit" title="Senden" disabled>↑</button></div>' +
				'<div id="modelMenuFull" class="model-menu" hidden></div></form></div>';
	// Frisches Log-Element gegen das gecachte DOM dieses Chats tauschen
	if (S.currentChatId) {
		const fresh = $("mainChatLog");
		const cached = cachedChatLog(String(S.currentChatId));
		if (fresh && cached !== fresh) {
			fresh.replaceWith(cached);
			cached.scrollTop = cached._keepScroll || 0;
		}
	}
	renderMainChatLog();
	renderPendingChip("full");
	renderStatusDot();
	const inp = $("mainChatInput");
	if (empty && inp) inp.focus();
}

function renderMainChatLog() {
	const log = $("mainChatLog");
	if (log) renderChatLog(log, S.chat);
}

// EINE "Gedankengang"-Box für live UND finalisiert (gleiche Struktur/Optik)
function thinkBoxHtml(opts) {
	const expanded = !!opts.expanded;
	return `<div class="think-box${opts.live ? " live" : ""}${expanded ? " expanded" : opts.live ? " peek" : ""}">` +
		`<button type="button" class="think-toggle" ${opts.toggleAttr} aria-expanded="${expanded ? "true" : "false"}">` +
			`<span class="think-icon">${opts.live ? "🧠" : "💭"}</span><span class="think-label">${esc(opts.label)}</span><span class="think-chevron">▸</span></button>` +
		`<div class="think-body-wrap"><div class="think-body">${esc(opts.text || "")}</div></div></div>`;
}

// Live: Mini-Vorschau mit den letzten 2 Zeilen, ausklappbar
const thinkingLiveHtml = () => thinkBoxHtml({
	text: S.thinkingLiveExpanded ? S.aiThinkingDraft : U.lastLines(S.aiThinkingDraft, 2),
	expanded: !!S.thinkingLiveExpanded, live: true, label: "Denkt nach…", toggleAttr: 'id="btnThinkLive"',
});

function assistantMsgHtml(m) {
	const think = m.reasoning ? thinkBoxHtml({ text: m.reasoning, expanded: !!m.reasoningExpanded, live: false, label: "Gedankengang", toggleAttr: `data-reasoningtoggle="${m.mid}"` }) : "";
	const refine = S.refineOpenMid === m.mid
		? `<div class="refine-menu"><button data-refine="${m.mid}" data-mode="longer">⬆️ Länger</button><button data-refine="${m.mid}" data-mode="same">↔️ Gleich</button><button data-refine="${m.mid}" data-mode="shorter">⬇️ Kürzer</button></div>`
		: "";
	return think + '<div class="msg assistant"><div class="md">' + U.md(m.content) + "</div>" +
		`<div class="msg-tools"><button class="msg-tool-btn" data-copymsg="${m.mid}" title="Antwort in die Zwischenablage kopieren">📋 Kopieren</button>` +
		`<button class="msg-tool-btn" data-refinetoggle="${m.mid}" title="Antwort anpassen">✦ Anpassen</button>${refine}</div></div>`;
}

function editCardHtml(m) {
	const title = m.pageTitle || "Unbenannt";
	const label = m.created ? "Hat erstellt" : "Hat geändert";
	const icon = m.after?.icon || S.pages[m.pageId]?.icon || "📄";
	return `<div class="edit-card${m.undone ? " undone" : ""}"><div class="edit-title">${esc(m.summary || (label + " " + title))}</div>` +
		`<div class="edit-actions-row"><button class="btn-show-changes" data-difftoggle="${m.mid}">Änderungen anzeigen</button>` +
		`<button class="btn-undo-icon" data-undo="${m.mid}" ${m.undone ? "disabled" : ""} title="Rückgängig machen">↺</button></div>` +
		`<div class="edit-subtitle">${label}</div><div class="edit-files-list"><div class="edit-file-item">${esc(icon)} ${esc(title)}</div></div></div>`;
}

// Seitenartige Diff-Vorschau: grün/rot markierte Blöcke statt Code-Diff
function changePageBodyHtml(beforeContent, afterContent) {
	const before = String(beforeContent || ""), after = String(afterContent || "");
	if (!before && after) return '<div class="change-page-body md highlight-page-add">' + U.md(after) + "</div>";
	if (!after && before) return '<div class="change-page-body md highlight-page-del">' + U.md(before) + "</div>";
	const diff = typeof U.diffLines === "function" ? U.diffLines(before, after) : [];
	if (!diff.length) return '<div class="change-page-body md">' + U.md(after) + "</div>";
	const chunks = [];
	let buf = [], kind = "same";
	const flush = () => {
		if (!buf.length) return;
		chunks.push(`<div class="change-block ${kind} md">` + U.md(buf.join("\n")) + "</div>");
		buf = [];
	};
	diff.forEach((d) => {
		const t = d.type === "add" || d.type === "del" ? d.type : "same";
		if (t !== kind) { flush(); kind = t; }
		buf.push(d.text);
	});
	flush();
	return '<div class="change-page-body">' + chunks.join("") + "</div>";
}

function openChangePreview(m) {
	const o = $("overlay");
	if (!o || !m) return;
	const before = m.before || {}, after = m.after || {};
	const title = after.title || m.pageTitle || before.title || "Unbenannte Seite";
	const icon = after.icon || S.pages[m.pageId]?.icon || "📄";
	o.hidden = false;
	o.classList.add("change-overlay");
	o.innerHTML =
		'<div class="change-page-flyout" role="dialog" aria-label="Änderungsvorschau">' +
			'<button class="modal-x" id="btnCloseOverlay" title="Schließen">✕</button>' +
			`<div class="change-page-toolbar"><span class="change-page-badge">${m.created ? "Neu" : "Geändert"} · KI</span>` +
			`<span class="hint">${m.created ? "Seite erstellt" : "Seite geändert"}</span>` +
			`<button class="btn-undo-change" data-undo="${m.mid}" ${m.undone ? "disabled" : ""}>↺ Rückgängig</button>` +
			(m.pageId ? `<button type="button" class="mini" data-openchangepage="${esc(m.pageId)}">Seite öffnen</button>` : "") + "</div>" +
			`<article class="change-page-sheet"><div class="change-page-heading"><span class="change-page-icon">${esc(icon)}</span><h1 class="change-page-title">${esc(title)}</h1></div>` +
			changePageBodyHtml(before.content, after.content) + "</article>" +
			'<div class="change-page-legend"><span class="leg add">+ hinzugefügt</span><span class="leg del">− entfernt</span><span class="leg same">unverändert</span></div></div>';
	const sheet = o.querySelector(".change-page-sheet");
	if (sheet) { U.renderMath(sheet); U.highlightCode(sheet); hydrateImages(sheet); }
	const close = () => { o.hidden = true; o.classList.remove("change-overlay"); o.innerHTML = ""; };
	// „Seite öffnen“: Vorschau schließen und navigieren
	o.querySelector("[data-openchangepage]")?.addEventListener("click", (e) => {
		const id = e.currentTarget.dataset.openchangepage;
		close();
		if (typeof window.openPage === "function") window.openPage(id);
		else if (S.pages[id]) { S.currentPageId = id; S.view = "page"; render(); }
	});
	// Klick auf den Overlay-Hintergrund schließt
	const onBg = (e) => { if (e.target === o) { close(); o.removeEventListener("click", onBg); } };
	o.addEventListener("click", onBg);
}

function renderPendingChip(type) {
	const chip = $(type === "full" ? "mainPendingChip" : "pendingChip");
	if (!chip) return;
	let html = "";
	if (S.pendingAttachmentTarget === type) {
		// EIN Markup für alle Anhang-Arten (Bild/Text/PDF): Icon · Titel · Meta · ✕
		const att = (ico, name, meta, btnAttr) =>
			`<span class="chip-ico">${ico}</span><span class="chip-body"><b>${esc(name)}</b><small>${esc(meta)}</small></span><button class="chip-x" ${btnAttr} title="Anhang entfernen">✕</button>`;
		if (S.pendingImage) html = att(`<img src="${S.pendingImage}" alt="">`, "Bild", "wird mitgesendet", 'data-removeattachment="1"');
		else if (S.pendingTextFile) html = att("📄", S.pendingTextFile.name, S.pendingTextFile.size + " Zeichen · wird als Datei angehängt", 'id="btnRemoveTextFile"');
		else if (S.pendingPdf) html = att("📄", S.pendingPdf.name, (S.pendingPdf.pages || "?") + " Seiten · wird als PDF-Kontext angehängt", 'id="btnRemovePdf"');
	}
	chip.hidden = !html;
	chip.classList.toggle("attach-chip", !!html);
	chip.innerHTML = html;
}

// ---------- Modals ----------
function modal(inner) {
	return '<div class="modal">' + inner + "</div>";
}
const closeAction = '<div class="modal-actions"><button id="btnCloseOverlay">Schließen</button></div>';

function openIconPicker() {
	if (!S.currentPageId) return;
	const icons = ["📝", "📘", "📕", "📙", "📗", "🧪", "🧮", "⚡", "🧢", "📐", "🔬", "💡", "🎯", "📊", "🗂", "📎", "✅", "⭐", "🔥", "🎓", "🧠", "📚", "🛠", "🚀"];
	openOverlay(modal(
		"<h3>Icon wählen</h3>" +
		'<div class="icon-grid">' + icons.map((i) => `<button class="icon-opt" data-iconset="${i}">${i}</button>`).join("") + "</div>" +
		'<div class="modal-actions"><button data-iconset="">Entfernen</button><button id="btnCloseOverlay">Schließen</button></div>'
	));
}

function openCoverPicker() {
	if (!S.currentPageId) return;
	openOverlay(modal(
		"<h3>Cover wählen</h3>" +
		'<div class="cover-grid">' + ["sunset", "ocean", "forest", "grape", "mono"].map((c) => `<button class="cover-swatch cover-${c}" data-coverset="${c}"></button>`).join("") + "</div>" +
		'<p class="hint">Oder ein eigenes Bild als Deckblatt (wird lokal gespeichert):</p>' +
		'<div class="row-btns"><button id="btnCoverUpload">🖼 Eigenes Bild wählen</button></div>' +
		'<div class="modal-actions"><button data-coverset="">Entfernen</button><button id="btnCloseOverlay">Schließen</button></div>'
	));
}

function openReview() {
	const snap = STATE.studySnapshot(null);
	if (snap.done) {
		return void openOverlay(modal("<h3>Gratulation! 🎉</h3>" +
			'<p class="hint">Dieser Stapel ist für heute fertig — keine fälligen Karten und keine offenen Lernschritte mehr.</p>' + closeAction));
	}
	// Wie Anki: statische Meldung, kein Live-Countdown. „Erneut prüfen“ baut neu auf
	// OHNE reviewShowBack — sonst zeigte eine inzwischen fällige Karte direkt die Rückseite
	if (snap.finishedForNow && snap.learnWaiting && snap.learnWaiting.length) {
		return void openOverlay(modal("<h3>Geschafft! 🎉</h3>" +
			`<p class="hint">Du hast diesen Stapel für den Moment fertig gelernt. ${snap.learnWaiting.length} Lernkarte(n) sind später heute wieder dran.</p>` +
			'<div class="modal-actions"><button id="btnReviewRefresh">Erneut prüfen</button><button id="btnCloseOverlay">Später</button></div>'));
	}
	const c = snap.dueNow[0];
	// FIX: leere dueNow-Queue crashte hier vorher (undefined.front)
	if (!c) return void openOverlay(modal("<h3>Gratulation! 🎉</h3>" + '<p class="hint">Gerade ist keine Karte fällig.</p>' + closeAction));
	const cnt = snap.counts;
	openOverlay(modal(
		`<h3>${cnt.neu} neu · ${cnt.learn} lernen · ${cnt.review} wdh.</h3>` +
		'<div class="card-face md">' + U.md(c.front) + "</div>" +
		(S.reviewShowBack
			? '<div class="card-face back md">' + U.md(c.back) + '</div><div class="grades">' +
				[[1, "Nochmal"], [2, "Schwer"], [3, "Gut"], [4, "Einfach"]].map(([g, l]) => `<button data-grade="${g}" data-card="${c.id}">${l}</button>`).join("") + "</div>"
			: '<div class="modal-actions"><button id="btnShowBack">Antwort zeigen</button></div>') +
		`<div class="modal-actions review-tools"><button data-ankiedit="${c.id}" title="Karte bearbeiten">✎ Bearbeiten</button>` +
		`<button data-reviewsuspend="${c.id}" title="Karte aussetzen (zählt nicht mehr als fällig)">⏸ Aussetzen</button>` +
		'<button id="btnCloseOverlay">Beenden</button></div>'
	));
}

function openCards() {
	const cards = Object.values(S.cards).filter((c) => !c.trashed).sort((a, b) => a.srs.due.localeCompare(b.srs.due));
	const rows = cards.map((c) =>
		`<div class="card-row"><textarea data-front="${c.id}" rows="2">${esc(c.front)}</textarea><textarea data-back="${c.id}" rows="2">${esc(c.back)}</textarea>` +
		`<div class="card-meta"><span>fällig: ${U.fmtDate(c.srs.due)} · Wdh. ${c.srs.reps || 0}</span>` +
		`<span><button data-cardsave="${c.id}">Speichern</button> <button data-carddel="${c.id}" class="danger">Löschen</button></span></div></div>`).join("");
	openOverlay(modal(`<h3>Karten verwalten (${cards.length})</h3>` +
		'<div class="cards-list">' + (rows || '<p class="hint">Noch keine Karten.</p>') + "</div>" + closeAction));
}

export const RENDER = {
	render, onStateChange, scheduleRender,
	renderTopbar, renderModelMenu, renderModelBar, renderStatusDot,
	renderSidebar, renderTabs, renderMain, renderHistoryModal,
	renderChat, renderMainChatLog, renderPendingChip, openChangePreview,
	openTemplatePicker, openReview, openCards, openIconPicker, openCoverPicker,
	hydrateImages, hydrateCovers, localDayKey, modal, ancestorsOf,
	loadPendingConflicts, savePendingConflicts, mergePendingConflicts, openConflictResolver, resolveConflict,
	pageIconLabel, pageIconHtml,
	openSettings: (...a) => SETTINGS.openSettings(...a),
	renderLibrary: (...a) => LIBRARY.renderLibrary(...a),
	libCardHtml: (...a) => LIBRARY.libCardHtml(...a),
};