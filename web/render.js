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

const deckTreeHtml = (...args) => RENDER_ANKI.deckTreeHtml(...args);
const renderAnki = (...args) => RENDER_ANKI.renderAnki(...args);

// Gemeinsamer Icon-Helfer: eigenes Icon > PDF-Symbol > Fallback (Standard 📝).
// Ersetzt 8 vorher verstreute, fast identische Kopien in dieser Datei sowie in
// library.js und search.js (dort über RENDER.pageIconLabel/RENDER.pageIconHtml).
function pageIconLabel(pg, fallback) {
	if (pg.icon) return pg.icon;
	if (pg.kind === "heft") return "📓";
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
	return !!(ae && ((ae.classList && (ae.classList.contains("blk-input") || ae.classList.contains("blk-rich-edit"))) ||
		(ae.isContentEditable && ae.closest && ae.closest(".block-editor"))));
}

// Fokus-Ziele, bei denen ein Neuaufbau von #main den Cursor/die Eingabe zerstören
// würde (Titel, Filter, Token-Felder, Block-/DB-Zellen-Editor).
const PROTECTED_FOCUS_IDS = new Set(["pageTitle", "inpWsName", "inpNotionToken", "inpNotionPage", "libFilter", "ankiSearch"]);
function isProtectedFocus(ae) {
	return !!ae && (PROTECTED_FOCUS_IDS.has(ae.id) || (ae.isContentEditable && ae.closest && ae.closest(".block-editor")) || (ae.classList &&
		(ae.classList.contains("blk-input") || ae.classList.contains("blk-rich-edit") || ae.classList.contains("db-cell"))));
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
		// Editor-eigener Autosave: sein DOM/Scroll ist bereits konsistent (der
		// Block-Editor hat sich nach jeder Änderung selbst neu gezeichnet). dispatch()
		// feuert dieses Event erst NACH dem asynchronen IndexedDB-Write, also oft in
		// einem Moment, in dem der Fokus kurz nicht in einem Textfeld liegt (z.B.
		// nach Undo mit reiner Blockauswahl). isEditingBlock() hielt das früher
		// fälschlich für eine externe Änderung und baute #main (inkl. .page-scroll)
		// komplett neu auf — der frische Scroll-Container startete dann immer bei 0.
		if (p.viaEditor) return;
		if (isEditingBlock()) return;
		// Externe Content-Änderung der geöffneten Seite (z.B. KI-Tool) → nur Main
		if (p.id === S.currentPageId && S.view === "page") {
			renderMain();
			return;
		}
		return;
	}
	// Heft gespeichert: der Canvas ist die Live-Ansicht — kein Full-Render nötig.
	// Nur die Bibliothek (Metadaten/Vorschau) auffrischen, falls sie gerade offen ist.
	if (type === "heftUpdated") {
		if (S.view === "library") renderMain();
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

	// Mobile Shell v2: die Dock-Pille (☰/+/✦) ist eine reine Aktions-Leiste ohne
	// Bereichs-Zustand — Aktiv-Zustände zeigt das Navigator-Sheet selbst über die
	// Topbar-Pillen oben (dieselben Elemente wie am Desktop, nichts doppelt).
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
	// Side-Panel-Chip IMMER befüllen — auch wenn das Panel eingeklappt ist.
	// FIX: Früher wurde bei body.panel-collapsed die Pille übersprungen/geleert.
	// Beim Aufklappen (btnShowPanel) lief kein erneutes renderStatusDot → leere Pille
	// im kleinen Chat, während der große Chat (renderFullChat) sie frisch füllte.
	// Das Panel selbst ist per CSS versteckt (body.panel-collapsed #panel), der DOM-Stand
	// muss trotzdem aktuell bleiben, damit der Status beim Öffnen sofort sichtbar ist.
	const sideChip = U.el("aiStatusChip");
	if (sideChip) fillAiStatusChip(sideChip, meta);
	// Vollbild-Chat: nur wenn view === chat (Chip wird bei renderFullChat neu erzeugt)
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

function currentThinkingCapability() {
	const provider = String(S.settings.aiProviderId || "");
	const model = String(S.settings.aiModel || "");
	const pr = (S.settings.aiProviders || []).find((item) => item.id === provider);
	const base = String((pr && pr.base) || "").replace(/\/+$/, "");
	const key = [provider, base, model].join("::");
	return (S.thinkingCapabilities || {})[key] || null;
}

// Baut den Inhalt des einheitlichen Modell-Dropdowns: nach Quelle gruppiert, das
// aktive Modell mit Häkchen, unten ein Bereich für ein frei eingetipptes Modell
// (Quelle über Chips wählbar statt über ein hässliches natives <select>).
// ★ Modell-Favoriten (18. Juli): angepinnte Modelle stehen quellenübergreifend ganz
// oben im Dropdown. Gespeichert lokal als "providerId::modelId" — bewusst nicht
// synchronisiert, weil Quellen-IDs pro Gerät verschieden sein können.
const MODEL_FAV_KEY = "impala67FavModels";
function favModels() {
	try { return new Set(JSON.parse(localStorage.getItem(MODEL_FAV_KEY) || "[]")); } catch (err) { return new Set(); }
}
function toggleFavModel(key) {
	const s = favModels();
	if (s.has(key)) s.delete(key); else s.add(key);
	try { localStorage.setItem(MODEL_FAV_KEY, JSON.stringify([...s])); } catch (err) { /* egal */ }
}
// Capture-Listener, damit der Stern NICHT gleichzeitig das Modell umschaltet
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
	const curProviderId = S.settings.aiProviderId || "";
	const curModel = S.settings.aiModel || "";
	const live = S.availableModels || [];
	const section = S.modelMenuSection || "root";
	const back = '<button class="model-submenu-back" data-modelmenuback="1">‹ Zurück</button>';
	if (section === "root") {
		const enabled = S.settings.thinkingEnabled !== false;
		const cap = currentThinkingCapability();
		const label = enabled ? "Ein" : "Aus";
		// Nie den Eintrag entfernen: Ein unbekanntes Modell darf nicht den
		// Dropdown-Inhalt „wegblenden“. Die Unterseite erklärt stattdessen klar,
		// ob der aktuelle Chat-Adapter eine Thinking-Stufe steuern kann.
		const thinkingRow = '<button class="model-submenu-row" data-modelsubmenu="thinking"><span>Thinking</span><small>' + U.esc(label) + ' ›</small></button>';
		return '<button class="model-submenu-row" data-modelsubmenu="models"><span>Modell</span><small>' + U.esc(currentModelLabel()) + ' ›</small></button>' + thinkingRow;
	}
	if (section === "thinking") {
		const cap = currentThinkingCapability();
		if (!cap || cap.state === "loading") {
			return back + '<div class="menu-label">Thinking</div><div class="menu-note">API-Fähigkeiten werden geprüft…</div>';
		}
		const enabled = S.settings.thinkingEnabled !== false;
		const note = !cap || cap.state === "loading"
			? "Modellinformationen werden geladen…"
			: (cap.error || "Das Modell verwendet bei Aktivierung seine dokumentierte Standardtiefe.");
		return back + '<div class="menu-label">Thinking</div><div class="menu-note">' + U.esc(note) + '</div>' +
			[[true, "Ein"], [false, "Aus"]].map(([value, label]) => '<button class="menu-item' + (value === enabled ? " active" : "") + '" data-thinkingenabled="' + (value ? "1" : "0") + '">' +
				'<span class="menu-item-label">' + label + '</span>' + (value === enabled ? '<span class="menu-check">✓</span>' : "") + '</button>').join("");
	}
	let html = back + '<div class="menu-label">Verfügbare Modelle</div>';
	if (S.modelMenuLoading) return html + '<div class="menu-note">Modelle werden geladen…</div>';
	const favSet = favModels();
	const opt = (prId, value, active) => {
		const favKey = prId + "::" + value;
		const fav = favSet.has(favKey);
		return '<div class="model-row">' +
			'<button class="menu-item' + (active ? " active" : "") + '" data-modelset="' + U.esc(prId) + "::" + U.esc(value) + '">' +
			'<span class="menu-item-label">' + U.esc(value) + '</span>' + (active ? '<span class="menu-check">✓</span>' : "") + '</button>' +
			'<button type="button" class="model-fav' + (fav ? " on" : "") + '" data-modelfav="' + U.esc(favKey) + '" title="' + (fav ? "Favorit entfernen" : "Als Favorit ganz nach oben pinnen") + '">' + (fav ? "★" : "☆") + '</button></div>';
	};
	// ★ Favoriten zuerst — quellenübergreifend ganz oben
	const favLive = live.filter((m) => favSet.has(m.providerId + "::" + m.id));
	if (favLive.length) {
		html += '<div class="menu-label">★ Favoriten</div>' +
			favLive.map((m) => opt(m.providerId, m.id, m.providerId === curProviderId && m.id === curModel)).join("");
	}
	providers.forEach((pr) => {
		const liveForPr = live.filter((m) => m.providerId === pr.id && !favSet.has(pr.id + "::" + m.id));
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
		// Wie Seiten-⋯: nach dem Rebuild fixed positionieren, sonst clippt #tree.
		if (S.deckMenuOpenName) {
			const name = S.deckMenuOpenName;
			const anchor = tree.querySelector('[data-deckmenu="' + CSS.escape(name) + '"]');
			const menu = tree.querySelector('[data-deckmenu-panel="' + CSS.escape(name) + '"]');
			if (anchor && menu) POPOVERS.position(anchor, menu, { align: "end", gap: 2 });
		}
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
	// Wie beim Stapel-⋯-Menü: das offene Seiten-⋯-Menü nach JEDEM Rebuild neu
	// fixed positionieren. Ohne das fiel das frisch eingebaute Menü auf sein
	// CSS-Fallback zurück (position:absolute in der Zeile) und wurde vom
	// overflow des Baums abgeschnitten — das ⋯-/Löschen-Menü verschwand, sobald
	// irgendein Hintergrund-Render (Autosave, Sync, Dispatch) feuerte.
	if (S.pageMenuOpenId) {
		const anchor = tree.querySelector('[data-pagemenu="' + S.pageMenuOpenId + '"]');
		const menu = tree.querySelector(".page-menu");
		if (anchor && menu) POPOVERS.position(anchor, menu, { align: "end", gap: 2 });
	}
}

// Chat-Verlauf in der Sidebar (Chat-Modus) — die Volltextsuche über Titel UND Inhalte läuft jetzt im Befehls-Menü (Strg+K).
function chatListHtml() {
	const sessions = (typeof CHATS !== "undefined") ? CHATS.load() : [];
	let html = '<div class="row" data-newchat="1"><span class="row-title">+ Neuer Chat</span></div>';
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
	const panelCollapsed = document.body.classList.contains("panel-collapsed");
	let html = '<button class="navbtn" id="btnSidebarToggle" title="Linke Spalte ein-/ausklappen">☰</button>' +
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
	// „+“ öffnet einen neuen Tab (Navigation ersetzt sonst den aktuellen)
	html += '<button class="tabchip tabchip-new" id="btnTabNew" data-tabnew="1" title="Neuen Tab öffnen">+</button>';
	html += "</div>";
	// Der KI-Zugriff sitzt als runder Notion-artiger Button unten rechts.
	// In der Tab-Leiste bleibt dadurch nur die Navigation.
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
	// Offenes Heft schließen, sobald die Ansicht es nicht mehr zeigt (speichert implizit).
	if (HEFT.activeId && (S.view !== "page" || S.currentPageId !== HEFT.activeId)) HEFT.unmount();
	if (S.view === "library") { LIBRARY.renderLibrary(main); return; }
	if (S.view === "anki") { renderAnki(main); return; }
	if (S.view === "noten") { SCHULNOTEN.render(main); return; }
	if (S.view === "daily") { renderDaily(main); return; }
	if (S.view === "trash") { renderTrash(main); return; }
	if (S.view === "chat") { renderFullChat(main); return; }
	if (S.view === "notebooklm") { NLM.renderPane(main); return; }
	const pg = S.currentPageId ? S.pages[S.currentPageId] : null;
	if (S.view === "home" || !pg) { renderHome(main); return; }

	// GoodNotes-Heft: Fokusmodus. Über der Papierfläche bleibt NUR die globale
	// Tab-Leiste. Kein Breadcrumb, Titel oder Seitenkopf nimmt Schreibfläche weg.
	if (pg.kind === "heft") {
		main.innerHTML = '<div id="heftStage" class="heft-stage" aria-label="' + U.esc(pg.title) + '"></div>';
		const stage = U.el("heftStage");
		if (stage) HEFT.mount(stage, pg.id);
		return;
	}

	// Wie in Notion: nur noch EINE, durchgehend bearbeitbare und angezeigte Ansicht —
	// kein Moduswechsel mehr. Der Block-Editor (editor.js) ist immer aktiv.
	main.innerHTML =
		// Navigation gehört zur Seiten-Chrome oben links; die eigentliche Seite
		// bleibt davon unabhängig als zentrierte Dokumentfläche ausgerichtet.
		'<div class="page-chrome"><div class="page-topbar">' + breadcrumbHtml(pg) + topbarActionsHtml(pg) + "</div></div>" +
		'<div class="page-scroll"><div class="page-meta">' +
			(pg.coverImg || pg.cover
				? '<div class="page-cover ' + (pg.coverImg ? "has-img" : "cover-" + pg.cover) + '"' + (pg.coverImg ? ' data-coverimg="' + U.esc(pg.coverImg) + '"' : "") + '><div class="cover-btns">' +
					'<button data-coverpick="1">Cover ändern</button><button data-coverremove="1">Entfernen</button>' +
					"</div></div>"
				: "") +
			'<div class="page-heading">' +
				'<button class="page-icon" data-iconpick="1" title="Icon ändern">' + pageIconLabel(pg) + "</button>" +
				(!pg.cover && !pg.coverImg ? '<button class="addcover-btn" data-coverpick="1">+ Cover</button>' : "") +
			"</div>" +
			// Ein mehrzeilig wachsender Titel wie in Notion – ein <input> würde lange
			// Seitennamen zwangsläufig abschneiden.
			'<textarea id="pageTitle" rows="1" autocomplete="off" aria-label="Seitentitel">' + U.esc(pg.title) + "</textarea>" +
			backlinksChipHtml(pg) +
		"</div>" +
		(pg.db ? dbTableHtml(pg) : "") +
		'<div class="editor-wrap"><div id="blockEditor" class="block-editor"></div></div></div>' +
		// src="about:blank" verhindert die Chrome-Warnung "Unsafe attempt to load URL file://..."
		// (ein iframe ohne src lädt sonst die eigene Seiten-URL als Platzhalter).
		(S.pdfOpen && pg.pdfId ? '<iframe id="pdfFrame" class="pdf-frame" src="about:blank" title="PDF"></iframe>' : "");
	hydrateCovers(main);
	// Titelhöhe direkt an den Inhalt koppeln. Der Listener gehört zur frisch
	// gerenderten Seite und kann deshalb ohne globalen Zustand auskommen.
	const titleInput = U.el("pageTitle");
	if (titleInput) {
		const fitTitle = () => {
			titleInput.style.height = "auto";
			titleInput.style.height = Math.max(44, titleInput.scrollHeight) + "px";
		};
		fitTitle();
		titleInput.addEventListener("input", fitTitle);
	}
	const beHost = U.el("blockEditor");
	// Ein Editor für alles: der WYSIWYG-Editor (editor.js) beherrscht alle
	// Blockstrukturen — keine Legacy-Weiche mehr.
	if (beHost) EDITOR.mount(beHost, pg.id);
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
		'<div class="row-btns" style="margin:8px 0 14px"><button class="mini" data-dbnewrow="' + pg.id + '">+ Neue Zeile</button></div></div>';
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
const RESOLVED_CONFLICT_KEY = "impala67_resolved_conflicts";
function loadResolvedConflictIds() {
	try { return new Set(JSON.parse(localStorage.getItem(RESOLVED_CONFLICT_KEY) || "[]")); } catch { return new Set(); }
}
function markConflictResolved(conflictPageId) {
	if (!conflictPageId) return;
	const ids = loadResolvedConflictIds();
	ids.add(conflictPageId);
	// Der Schlüssel ist nur eine lokale UI-Quittierung; klein halten, damit alte
	// Konfliktkopien keinen dauerhaft wachsenden LocalStorage-Eintrag erzeugen.
	localStorage.setItem(RESOLVED_CONFLICT_KEY, JSON.stringify([...ids].slice(-200)));
}
function isConflictPage(p) {
	return !!(p && !loadResolvedConflictIds().has(p.id) && ((p.id || "").startsWith("conflictpg-") || (p.title || "").startsWith("⚠ Konflikt")));
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
	const hasTextComparison = !c.conflictType && (!!left || !!right);
	const lineCount = (text) => String(text).split("\n").length;
	// U.diffLines wechselt bei sehr langen Seiten bewusst in einen groben Modus,
	// um den Browser nicht mit einer quadratischen Diff-Matrix zu blockieren.
	// Der frühere Resolver zeigte dann nur dessen Platzhalter — nicht den Inhalt.
	const coarseComparison = hasTextComparison && (lineCount(left) > 400 || lineCount(right) > 400);
	const diff = hasTextComparison && !coarseComparison ? U.diffLines(left, right) : [];
	const paneHtml = (side) => {
		if (coarseComparison) {
			const content = side === "local" ? left : right;
			return '<pre class="conflict-fulltext">' + (U.esc(content) || "(Kein Text vorhanden.)") + "</pre>";
		}
		return diff.filter((d) => d.type === "same" || (side === "local" ? d.type === "del" : d.type === "add")).map((d) => {
			const changed = d.type !== "same";
			const cls = changed ? (side === "local" ? "local-only" : "remote-only") : "same";
			const marker = changed ? (side === "local" ? "−" : "+") : "";
			return '<div class="conflict-line ' + cls + '"><span class="conflict-line-marker">' + marker + "</span>" + (U.esc(d.text) || "&nbsp;") + "</div>";
		}).join("") || '<div class="conflict-empty">Kein Text vorhanden.</div>';
	};
	const winnerLabel = c.winner === "local" ? "Dieses Gerät" : "Drive / anderes Gerät";
	const conflictSummary = c.reason || (c.conflictType === "delete-change"
		? "Auf einem Gerät wurde die Seite gelöscht, während sie auf dem anderen Gerät noch geändert oder verschoben wurde. Die App kann diese beiden Aktionen nicht automatisch zusammenführen."
		: "Diese Seite wurde nach der letzten erfolgreichen Synchronisierung zweimal unabhängig geändert: auf diesem Gerät am " + fmtConflictTime(c.localTime) + " und in Drive am " + fmtConflictTime(c.remoteTime) + ". Deshalb kann die App nicht sicher entscheiden, welchen Text du behalten möchtest.");
	const comparisonHtml = hasTextComparison
		? '<div class="conflict-compare"><section class="conflict-pane local"><header><b>Dieses Gerät</b><small>' + U.esc(fmtConflictTime(c.localTime)) + '</small></header><div class="conflict-pane-body">' + paneHtml("local") + '</div></section><section class="conflict-pane remote"><header><b>Drive / anderes Gerät</b><small>' + U.esc(fmtConflictTime(c.remoteTime)) + '</small></header><div class="conflict-pane-body">' + paneHtml("remote") + '</div></section></div>' + (coarseComparison ? '<p class="conflict-key">Lange Seite: Beide vollständigen Inhalte werden gezeigt. Eine zeilenweise Markierung wäre hier zu langsam.</p>' : '<p class="conflict-key"><span>− Nur dieses Gerät</span><span>+ Nur Drive / anderes Gerät</span><span>Unmarkiert: gleich</span></p>')
		: '<div class="conflict-no-compare"><b>' +
		  (c.conflictType === "heft" ? "Kein visueller Vergleich von Handzeichnungen" : "Kein Textvergleich möglich") +
		  '</b><span>' +
		  (c.conflictType === "heft" ? "Handzeichnungen können nicht zeilenweise verglichen werden. Der ältere Stand wurde als Kopie gerettet. Öffne das Konflikt-Heft in der Bibliothek, um zu entscheiden, was du übernehmen möchtest." : "Die Änderung betrifft den Seitenstatus, nicht zwei Textfassungen. Öffne die gerettete Kopie und entscheide anschließend, was erhalten bleiben soll.") +
		  '</span></div>';
	o.hidden = false;
	o.innerHTML = '<div class="modal conflict-modal">' +
		'<button class="modal-x" id="btnCloseOverlay" title="Schließen">✕</button>' +
		'<header class="conflict-head"><span class="conflict-icon">⚠</span><span><b>Synchronisation braucht eine Entscheidung' +
		(items.length > 1 ? " · " + (i + 1) + " von " + items.length : "") + "</b><small>“" +
		U.esc(c.title || "Seite") + "”</small></span></header>" +
		'<div class="conflict-reason"><b>Warum sehe ich das?</b> ' + U.esc(conflictSummary) +
		(c.legacy ? "" : '<br><span class="hint">Die App empfiehlt: <b>' + U.esc(winnerLabel) + "</b> behalten, weil dieser Stand den neueren Zeitstempel hat.</span>") +
		"</div>" +
		comparisonHtml +
		'<div class="conflict-actions">' +
		'<button class="primary" data-conflictresolve="keep-winner">Empfehlung übernehmen</button>' +
		(c.pageId && !c.legacy ? '<button data-conflictresolve="use-loser">Stattdessen anderen Stand übernehmen</button>' : "") +
		"</div></div>";
}
async function resolveConflict(action) {
	const list = S.conflictResolveList || loadPendingConflicts();
	const i = S.conflictResolveIndex || 0;
	const conf = list[i];
	if (!conf) return;
	if (action === "use-loser" && conf.pageId) {
		if (conf.conflictType === "heft") {
			// Erst die noch sichtbare Winner-Ansicht schließen: unmount() könnte sonst
			// den alten In-Memory-Stand zurückschreiben. Danach frisch aus dem Winner-Blob mounten.
			if (HEFT.activeId === conf.pageId) HEFT.unmount(true);
			const loserBlob = await DB.getBlob("heft:" + conf.conflictPageId);
			if (loserBlob && loserBlob.buf && loserBlob.meta) {
				await DB.putBlob("heft:" + conf.pageId, loserBlob.buf, { ...loserBlob.meta, hash: conf.loserHash });
				await STATE.dispatch("heftUpdated", { pageId: conf.pageId, rev: loserBlob.meta.rev, pages: loserBlob.meta.pages || 1, bytes: loserBlob.buf.byteLength, blobHash: conf.loserHash });
			}
		} else if (conf.conflictType === "delete-change") {
			// Die Konfliktkopie ist der gerettete Stand. Titel, Workspace und Elternordner
			// werden aus dem Konflikt-Payload wiederhergestellt, statt sie auf Root zu lassen.
			await STATE.dispatch("pageUpdate", { id: conf.conflictPageId, patch: {
				title: conf.title,
				parentId: conf.parentId || null,
				workspaceId: conf.workspaceId || "default"
			} });
		} else {
			await STATE.dispatch("pageUpdate", { id: conf.pageId, patch: { content: conf.loserContent } });
		}
	}
	if (conf.conflictPageId && S.pages[conf.conflictPageId]) {
		const shouldTrash = action === "keep-winner" || (action === "use-loser" && conf.conflictType !== "delete-change");
		if (shouldTrash) {
			await STATE.dispatch("pageTrash", { id: conf.conflictPageId });
		}
	}
	// Pending bereinigen (auch wenn nur „beide behalten“ → aus der Warteschlange).
	// Die Kopie wird außerdem lokal als erledigt markiert; sonst erzeugte gerade
	// „Beide behalten“ beim nächsten Start wieder denselben Banner/Dialog.
	markConflictResolved(conf.conflictPageId);
	const next = loadPendingConflicts().filter((x) => (x.conflictPageId || x.pageId) !== (conf.conflictPageId || conf.pageId));
	savePendingConflicts(next);
	if (next.length) {
		openConflictResolver(Math.min(i, Math.max(0, next.length - 1)));
		render();
		return;
	}
	const o = U.el("overlay");
	if (o) { o.hidden = true; o.innerHTML = ""; }
	U.toast("Konflikt erledigt.", "success");
	render();
}

// Home v3 (15. Juli 2026): persönliches Dashboard — Begrüßung mit Datum,
// Lern-Kennzahlen (Lernzeit, Streak, fällige Karten, Erfolgsquote), Heute-Leiste,
// Telemetrie-Insights (telemetrie.js) und ausklappbare Bereiche, die sich ihren
// Zustand merken. Das ebenfalls ausklappbare Lernzeit-Widget liefert lernzeit.js.
const HOME_FOLD_KEY = "impala67HomeFolds";
function homeFolds() {
	try { return JSON.parse(localStorage.getItem(HOME_FOLD_KEY) || "{}") || {}; } catch { return {}; }
}
function homeFoldOpen(id, fallback) {
	const folds = homeFolds();
	return folds[id] === undefined ? fallback : !!folds[id];
}
function homeFold(id, summary, body, fallbackOpen) {
	return '<details class="home-fold" data-fold="' + id + '"' + (homeFoldOpen(id, fallbackOpen) ? " open" : "") +
		'><summary>' + summary + '</summary><div class="home-fold-body">' + body + '</div></details>';
}
// <details>-Zustand persistieren — "toggle" blubbert nicht, daher Capture-Phase.
document.addEventListener("toggle", (event) => {
	const el = event.target;
	if (!el || !el.matches || !el.matches("details[data-fold]")) return;
	const folds = homeFolds();
	folds[el.getAttribute("data-fold")] = el.open;
	localStorage.setItem(HOME_FOLD_KEY, JSON.stringify(folds));
}, true);
function renderHome(main) {
	// 📌 Scroll-Anker: Jede Aktion auf Home (Fold auf/zu, Pins, Sync …) löst ein
	// komplettes Re-Render aus — vorher hüpfte die Seite danach immer wieder an
	// den Anfang. Position vorher merken, nach dem Neuaufbau wiederherstellen.
	const homeScroller = main.querySelector(".home");
	const keepScroll = (homeScroller && homeScroller.scrollTop) || main.scrollTop || 0;
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
	const dateLine = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
	const cardCount = ((STATE.activeCards && STATE.activeCards()) || Object.values(S.cards).filter((c) => !c.trashed)).length;
	const lz = LERNZEIT.statsForHome();
	// Erfolgsquote der letzten 30 Tage — echte Wiederholungen (ohne Erstbewertungen
	// und Lernschritte), gleiche Definition wie die Retention in der Statistik.
	const cut30 = new Date(Date.now() - 30 * 864e5).toISOString();
	const graded30 = (S.reviews || []).filter((r) => r.t >= cut30 && r.grade > 0 && !r.first && !r.learning);
	const retention30 = graded30.length >= 10 ? Math.round(graded30.filter((r) => r.grade > 1).length / graded30.length * 100) : null;

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
			'<button class="home-pill" data-noten-open="1" title="Schulnoten öffnen">' +
				'<span class="home-pill-ico">🎓</span><span class="home-pill-body"><b>Noten</b><small>Eintragen & Schnitt ansehen</small></span></button>' +
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

	// Kennzahlen-Reihe: heute gelernt, Streak, fällige Karten, Erfolgsquote
	const stats =
		'<div class="home-statgrid">' +
			'<div class="home-stat accent"><b>' + LERNZEIT.fmt(lz.todaySeconds) + '</b><small>heute gelernt</small></div>' +
			'<div class="home-stat"><b><span class="home-streak-flame">🔥</span>' + lz.streakDays + '</b><small>' + (lz.streakDays === 1 ? "Tag Streak" : "Tage Streak") + '</small></div>' +
			'<div class="home-stat' + (due ? " accent" : "") + '"><b>' + due + '</b><small>Karten fällig</small></div>' +
			'<div class="home-stat' + (retention30 !== null && retention30 >= 85 ? " good" : "") + '"><b>' + (retention30 === null ? "—" : retention30 + " %") + '</b><small>Erfolgsquote (30 Tage)</small></div>' +
		"</div>";

	main.innerHTML = '<div class="home home-v2 home-slim">' +
		'<header class="home-hero"><div><h1>' + greeting + ' 👋</h1><p class="home-meta">' + dateLine + "</p>" +
		'<div class="home-hero-meta">' +
			'<span class="home-chip">📄 <b>' + pages.length + '</b> Seiten</span>' +
			'<span class="home-chip">🃏 <b>' + cardCount + '</b> Karten</span>' +
			'<span class="home-chip">✦ <b>' + chats.length + '</b> Chats</span>' +
			'<span class="home-chip' + (lz.goalPct < 100 ? " warn" : "") + '">🎯 Wochenziel <b>' + lz.goalPct + ' %</b></span>' +
		"</div></div>" +
		'<button class="home-customize" data-set="look" title="Design anpassen">⚙</button></header>' +
		conflictBanner +
		stats +
		'<div class="quick-actions">' +
			'<button data-homeaction="newpage">+ Neue Seite</button>' +
		"</div>" +
		'<section class="home-section home-section-continue">' + continueBlock + "</section>" +
		todayPills +
		homeFold("insights", '🧠 Lern-Insights <span class="fold-meta">aus deiner Telemetrie</span>', TELE.homeInsightsHtml(), true) +
		homeFold("recent", '📄 Zuletzt <span class="fold-meta">' + pages.length + ' Seiten</span>',
			recentPages + '<div class="fold-foot"><button class="mini" data-homeaction="library">Bibliothek öffnen ›</button></div>', true) +
		(recentChats
			? homeFold("chats", '✦ Chats <span class="fold-meta">' + chats.length + '</span>',
				'<div class="home-list">' + recentChats + '</div><div class="fold-foot"><button class="mini" data-homeaction="chats">Alle Chats ›</button></div>', false)
			: "") +
		LERNZEIT.homeWidgetHtml() +
		"</div>";
	if (keepScroll) {
		main.scrollTop = keepScroll;
		if (main.scrollTop !== keepScroll) {
			// Falls nicht #main scrollt, sondern der .home-Container selbst
			const h = main.querySelector(".home");
			if (h) h.scrollTop = keepScroll;
		}
	}
}

// Papierkorb: Seiten, Stapel und Karten — Soft-Delete mit Wiederherstellen / Endgültig löschen.
function renderTrash(main) {
	const pages = STATE.trashedPages();
	const decks = (STATE.trashedDeckRoots && STATE.trashedDeckRoots()) || [];
	const cards = (STATE.orphanTrashedCards && STATE.orphanTrashedCards()) || [];
	const empty = !pages.length && !decks.length && !cards.length;
	let html = '<div class="library"><div class="lib-head"><div><h1>🗑 Papierkorb</h1><p class="hint">Seiten, Stapel und Karten — wiederherstellbar, bis du sie endgültig löschst.</p></div>' +
		'<button class="danger" data-trashclear="1">Papierkorb leeren</button></div>';
	if (empty) {
		html += '<p class="hint">Der Papierkorb ist leer.</p></div>';
		main.innerHTML = html;
		return;
	}
	html += '<div class="trash-list">';
	if (pages.length) {
		html += '<div class="ws-head"><span class="ws-name">Seiten</span></div>' +
			pages.map((pg) =>
				'<div class="trash-row">' +
					'<span class="row-title">' + pageIconHtml(pg) + U.esc(pg.title) + "</span>" +
					'<span class="hint">gelöscht ' + U.fmtDate(pg.trashedAt || pg.updated) + "</span>" +
					'<button data-pagerestore="' + pg.id + '">↩ Wiederherstellen</button>' +
					'<button data-pagepurge="' + pg.id + '" class="danger">🗑 Endgültig löschen</button>' +
				"</div>"
			).join("");
	}
	if (decks.length) {
		html += '<div class="ws-head"><span class="ws-name">Stapel</span></div>' +
			decks.map((name) => {
				const d = S.decks[name] || {};
				const n = Object.values(S.cards).filter((c) => {
					if (!c.trashed) return false;
					const deck = c.deck || "Standard";
					return deck === name || deck.startsWith(name + "::");
				}).length;
				return '<div class="trash-row">' +
					'<span class="row-title">🃏 ' + U.esc(name) + (n ? " · " + n + " Karte(n)" : "") + "</span>" +
					'<span class="hint">gelöscht ' + U.fmtDate(d.trashedAt || "") + "</span>" +
					'<button data-deckrestore="' + U.esc(name) + '">↩ Wiederherstellen</button>' +
					'<button data-deckpurge="' + U.esc(name) + '" class="danger">🗑 Endgültig löschen</button>' +
				"</div>";
			}).join("");
	}
	if (cards.length) {
		html += '<div class="ws-head"><span class="ws-name">Karten</span></div>' +
			cards.map((c) => {
				const front = (c.front || "").replace(/\s+/g, " ").trim();
				const short = front.length > 60 ? front.slice(0, 60) + "…" : front;
				return '<div class="trash-row">' +
					'<span class="row-title">🃏 ' + U.esc(short || "(leere Vorderseite)") + "</span>" +
					'<span class="hint">' + U.esc(c.deck || "Standard") + " · gelöscht " + U.fmtDate(c.trashedAt || "") + "</span>" +
					'<button data-cardrestore="' + c.id + '">↩ Wiederherstellen</button>' +
					'<button data-cardpurge="' + c.id + '" class="danger">🗑 Endgültig löschen</button>' +
				"</div>";
			}).join("");
	}
	html += "</div></div>";
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

// Anlege-Dialog: EIN Dialog, zwei klare Typen — Notion-Seite (Block-Editor) oder
// GoodNotes-Heft (Papier + Stift). Vorlagen erscheinen darunter als Zusatzoptionen.
function openTemplatePicker() {
	const tpls = STATE.activePages().filter((p) => p.isTemplate);
	const o = U.el("overlay");
	o.hidden = false;
	o.innerHTML = modal(
		"<h3>Neu anlegen</h3>" +
		'<div class="newpage-cards">' +
			'<button type="button" class="newpage-card" data-tplblank="1">' +
				'<span class="newpage-visual is-notion" aria-hidden="true"><i></i><i></i><i></i></span>' +
				"<b>Notion-Seite</b><small>Blöcke · Markdown · Verlinkungen</small>" +
			"</button>" +
			'<button type="button" class="newpage-card" data-tplheft="1">' +
				'<span class="newpage-visual is-heft" aria-hidden="true"><span></span></span>' +
				"<b>GoodNotes-Heft</b><small>Papier · Stift · Seiten</small>" +
			"</button>" +
		"</div>" +
		(tpls.length ? '<p class="hint">Oder aus einer Vorlage:</p>' : "") +
		tpls.map((p) =>
			'<button class="tpl-opt" data-tpluse="' + p.id + '">' + (p.icon ? U.esc(p.icon) + " " : (p.kind === "heft" ? "📓 " : "📑 ")) + U.esc(p.title) + "</button>"
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
	ask_choice: "Rückfrage gestellt", delete_page: "Seite gelöscht", delete_flashcard: "Karte gelöscht", delete_deck: "Stapel gelöscht",
};
function toolChipHtml(m) {
	return '<div class="tool-chip' + (m.error ? " err" : "") + '" title="Werkzeug: ' + U.esc(m.name) + '">⚙️ ' + U.esc(TOOL_LABELS[m.name] || m.name) +
		(m.detail ? ' <span class="tool-detail">· ' + U.esc(m.detail) + "</span>" : "") + (m.error ? " — Fehler" : "") + "</div>";
}

function chatStaticHtml(historyList) {
	// Fertige Nachrichten getrennt vom Live-Entwurf aufbauen. Beim Streamen bleibt
	// dieser Teil unverändert und muss weder erneut als Markdown noch für Math/Code
	// verarbeitet werden.
	const list = historyList || [];
	return list.map((m) => {
		if (m.role === "edit") return editCardHtml(m);
		if (m.role === "question") return questionCardHtml(m);
		if (m.role === "tool") return toolChipHtml(m);
		if (m.role === "assistant") return assistantMsgHtml(m);
		return userMsgHtml(m, list);
	}).join("");
}

function chatLiveParts(historyList) {
	if (!S.aiBusy) return { think: "", rest: "" };
	const activeList = S.aiActiveChatType === "side" ? S.sideChat : S.chat;
	if (historyList !== activeList) return { think: "", rest: "" };
	// Während offener ask_choice-Karte keine zweite „busy“-Zeile — die Frage IST der Wartezustand.
	const waitingChoice = activeList.some((m) => m.role === "question" && !m.answered);
	// Denkprozess UND Antwort-Draft parallel zeigen. Vorher versteckte jedes
	// aiDraft-Zeichen die Think-Box komplett — bei Heuristik-Lecks wirkte der
	// ganze Denkprozess wie die normale Antwort.
	const think = S.aiThinkingDraft ? thinkingLiveHtml() : "";
	let rest = "";
	if (S.aiDraft) rest = '<div class="msg assistant busy"><div class="md">' + U.md(S.aiDraft) + "</div></div>";
	else if (!S.aiThinkingDraft && !waitingChoice) rest = '<div class="msg assistant busy">' + U.esc(S.aiStatus || "…") + "</div>";
	return { think, rest };
}

// Vollständige, aber sehr viel günstigere Änderungsprüfung als ein neues innerHTML
// für den gesamten Verlauf. Die FNV-Signatur erkennt auch In-Place-Änderungen
// (z.B. Undo, aufgeklapptes Thinking oder beantwortete Rückfragen).
function chatHistorySignature(list) {
	// PERF (Feinschliff v11): vorher wurde der GESAMTE Verlauf pro Aufruf per
	// JSON.stringify in einen Riesen-String verwandelt (inkl. Bild-Daten-URLs)
	// und erst dann gehasht — viel Allokation/GC in jedem Render. Jetzt werden
	// die Felder direkt in den FNV-Hash gefaltet, ohne Zwischenstring.
	let hash = 2166136261;
	const add = (s) => {
		for (let i = 0; i < s.length; i++) {
			hash ^= s.charCodeAt(i);
			hash = Math.imul(hash, 16777619);
		}
		hash ^= 30; // Feldtrenner (Record Separator)
		hash = Math.imul(hash, 16777619);
	};
	for (const m of list || []) {
		for (const k in m) {
			const v = m[k];
			add(k);
			if (v == null) add("");
			else if (typeof v === "object") add(JSON.stringify(v));
			else add(String(v));
		}
	}
	return hash >>> 0;
}

function enhanceChatStatic(log, staticEnd) {
	for (let node = log.firstChild; node && node !== staticEnd; node = node.nextSibling) {
		if (node.nodeType === Node.ELEMENT_NODE) {
			U.renderMath(node);
			U.highlightCode(node);
		}
	}
}

function renderChatLog(log, historyList) {
	const signature = chatHistorySignature(historyList);
	let staticEnd = log._chatStaticEnd;
	let live = log._chatLive;
	// Fertige Nachrichten bleiben direkte Kinder des Logs. Das bewahrt vorhandene
	// Flex-/CSS-Regeln und Event-Delegation; nur der Live-Bereich erhält einen
	// unsichtbaren Container als gezieltes Patch-Ziel.
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
		const template = document.createElement("template");
		template.innerHTML = chatStaticHtml(historyList);
		staticEnd.before(template.content);
		log._chatStaticSignature = signature;
		enhanceChatStatic(log, staticEnd);
	}
	// BUGFIX (17. Juli): Der Live-Bereich wurde bisher bei JEDEM Streaming-Delta
	// komplett per innerHTML ersetzt (~alle 80 ms). Lag zwischen Mousedown und
	// Mouseup ein Rebuild, ging der Klick verloren — die „Denkt nach…“-Box ließ
	// sich während der Generierung praktisch nie ausklappen. Jetzt: Think-Box und
	// Antwort-Draft getrennt patchen; wächst nur der Denktext, wird ausschließlich
	// der Textknoten aktualisiert und der Toggle-Button bleibt stabil im DOM.
	const liveParts = chatLiveParts(historyList);
	let thinkHost = live._thinkHost;
	let restHost = live._restHost;
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
			// Aufgeklappt: automatisch am unteren Ende bleiben, damit der neueste
			// Gedanke sichtbar ist, ohne dass der Nutzer nachscrollen muss.
			if (S.thinkingLiveExpanded) body.scrollTop = body.scrollHeight;
		}
	}
	if (restHost._chatHtml !== liveParts.rest) {
		restHost.innerHTML = liveParts.rest;
		restHost._chatHtml = liveParts.rest;
		U.renderMath(restHost);
		U.highlightCode(restHost);
	}
	// Ans Ende folgen — aber nur, wenn der Nutzer nicht gerade hochgescrollt hat,
	// um etwas nachzulesen (sonst reißt das Streaming die Ansicht immer nach unten).
	const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 160;
	if (nearBottom || !log._chatAutoScrolled) { log.scrollTop = log.scrollHeight; log._chatAutoScrolled = true; }
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
	renderChatLog(log, S.sideChat);
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
			(empty ? '<p class="hint chat-empty-hint">Stell deine erste Frage — die Antwort erscheint hier groß, LaTeX und Code werden live gerendert.</p>' +
				// Schnellstart-Chips: setzen einen Prompt-Anfang ins Eingabefeld (kein Auto-Senden)
				'<div class="chat-suggests">' +
				'<button type="button" data-chatsuggest="Erkläre mir Schritt für Schritt: ">💡 Erkläre mir…</button>' +
				'<button type="button" data-chatsuggest="Erstelle Karteikarten zu: ">🃏 Karteikarten zu…</button>' +
				'<button type="button" data-chatsuggest="Fasse kompakt zusammen: ">📄 Fasse zusammen…</button>' +
				'<button type="button" data-chatsuggest="Stell mir 5 Prüfungsfragen zu: ">🎯 Quiz mich zu…</button>' +
				'</div>' : "") +
			'<div id="mainChatLog" class="chat-log-full"></div>' +
			'<form id="mainChatForm" class="chat-form-full">' +
				'<div id="mainPendingChip" hidden></div>' +
				'<div class="composer-body"><textarea id="mainChatInput" rows="1" placeholder="Frag deinen KI-Coach…"></textarea></div>' +
				'<div class="composer-actions"><div class="composer-actions-left">' +
					'<button type="button" id="btnAttachFull" title="Fotos und Dateien hinzufügen">+</button>' +
					'<button type="button" id="btnModelChipFull" class="composer-tool" title="Modell wählen"></button>' +
				'</div><button id="mainChatSubmit" type="submit" title="Senden" disabled>↑</button></div>' +
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
	renderChatLog(log, S.chat);
}

// Einheitliche "Gedankengang"-Box: exakt dieselbe Struktur/Optik für live (während
// des Streamings) und finalisiert (nach Abschluss) — vorher zwei komplett
// unterschiedlich aussehende Bausteine. Jetzt: Icon+Label+Chevron-Kopf, sanfte
// Höhen-Animation beim Auf-/Zuklappen, weicher Fade-Verlauf statt hartem
// Abschneiden in der Live-Vorschau.
function thinkBoxHtml(opts) {
	const expanded = !!opts.expanded;
	const stateClass = expanded ? " expanded" : (opts.live ? " peek" : "");
	return '<div class="think-box' + (opts.live ? " live" : "") + stateClass + '">' +
		'<button type="button" class="think-toggle" ' + opts.toggleAttr + ' aria-expanded="' + (expanded ? "true" : "false") + '">' +
			'<span class="think-icon">' + (opts.live ? "🧠" : "💭") + '</span>' +
			'<span class="think-label">' + U.esc(opts.label) + '</span>' +
			'<span class="think-chevron">▸</span>' +
		"</button>" +
		'<div class="think-body-wrap"><div class="think-body">' + U.esc(opts.text || "") + "</div></div>" +
	"</div>";
}

// Während des Streamings: Mini-Vorschau mit den letzten 2 Zeilen, ausklappbar.
function thinkingLiveHtml() {
	const full = S.aiThinkingDraft;
	const expanded = !!S.thinkingLiveExpanded;
	return thinkBoxHtml({
		text: expanded ? full : U.lastLines(full, 2),
		expanded, live: true, label: "Denkt nach…", toggleAttr: 'id="btnThinkLive"',
	});
}

// Nach Abschluss: komplett eingeklappte Leiste, die man wieder aufklappen kann.
function assistantMsgHtml(m) {
	let html = "";
	if (m.reasoning) {
		html += thinkBoxHtml({
			text: m.reasoning, expanded: !!m.reasoningExpanded, live: false,
			label: "Gedankengang", toggleAttr: 'data-reasoningtoggle="' + m.mid + '"',
		});
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
			'<div class="change-page-legend"><span class="leg add">+ hinzugefügt</span><span class="leg del">− entfernt</span><span class="leg same">unverändert</span></div>' +
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
	const snap = STATE.studySnapshot(null);
	if (snap.done) {
		o.innerHTML = modal(
			"<h3>Gratulation! 🎉</h3>" +
			'<p class="hint">Dieser Stapel ist für heute fertig — keine fälligen Karten und keine offenen Lernschritte mehr.</p>' +
			'<div class="modal-actions"><button id="btnCloseOverlay">Schließen</button></div>'
		);
		return;
	}
	// Anki: statische „Congratulations“-Meldung, kein Live-Countdown (den gibt es in
	// Anki nicht). „Erneut prüfen“ baut die Ansicht neu auf, OHNE reviewShowBack zu
	// setzen — die vorherige Version tat das über btnShowBack fälschlich mit, wodurch
	// eine inzwischen fällig gewordene Karte direkt mit aufgedeckter Rückseite gezeigt
	// worden wäre, ohne die Vorderseite je zu sehen.
	if (snap.finishedForNow && snap.learnWaiting && snap.learnWaiting.length) {
		o.innerHTML = modal(
			"<h3>Geschafft! 🎉</h3>" +
			'<p class="hint">Du hast diesen Stapel für den Moment fertig gelernt. ' + snap.learnWaiting.length + " Lernkarte(n) sind später heute wieder dran.</p>" +
			'<div class="modal-actions"><button id="btnReviewRefresh">Erneut prüfen</button><button id="btnCloseOverlay">Später</button></div>'
		);
		return;
	}
	const c = snap.dueNow[0];
	const cnt = snap.counts;
	o.innerHTML = modal(
		"<h3>" + cnt.neu + " neu · " + cnt.learn + " lernen · " + cnt.review + " wdh.</h3>" +
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
	const cards = Object.values(S.cards).filter((c) => !c.trashed).sort((a, b) => a.srs.due.localeCompare(b.srs.due));
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
	renderHistoryModal,
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
	openIconPicker,
	openCoverPicker,
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