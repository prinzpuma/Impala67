"use strict";

// search.js — Befehls-Menü (Strg+K) im Notion-Stil. Ersetzt die alte Sidebar-Suche:
// EIN Overlay für alles — Seiten (Titel + Volltext mit Fundstellen-Vorschau),
// Chats und Schnell-Aktionen. Bedienung per Tastatur (↑/↓, Enter, Esc) oder Maus.
// Die Aktionen lösen bewusst die vorhandenen Buttons/Flows der App aus — keine Doppel-Logik.

import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { CHATS } from "./chats.js";
import { TABS } from "./tabs.js";
import { RENDER } from "./render.js";
import { SETTINGS } from "./settings.js";
import { APP } from "./app.js";

let items = []; // aktuell angezeigte, auswählbare Einträge (für ↑/↓ und Enter)
let selIdx = 0;
let paletteMode = "command"; // "command" = Strg+K | "newTab" = Plus in der Tab-Leiste (Notion-Stil)

function host() {
	let el = U.el("palette");
	if (!el) {
		el = document.createElement("div");
		el.id = "palette";
		el.hidden = true;
		document.body.appendChild(el);
		wirePalette(el);
	}
	return el;
}

export function isPaletteOpen() {
	const el = U.el("palette");
	return !!el && !el.hidden;
}

function openPaletteUi(mode, placeholder) {
	paletteMode = mode || "command";
	const el = host();
	el.hidden = false;
	el.dataset.mode = paletteMode;
	el.innerHTML = '<div class="palette-box' + (paletteMode === "newTab" ? " palette-newtab" : "") + '">' +
		'<input id="paletteInput" placeholder="' + U.esc(placeholder || "Suchen oder Befehl eingeben…") + '" autocomplete="off">' +
		'<div id="paletteList" class="palette-list"></div>' +
		(paletteMode === "newTab"
			? '<div class="palette-foot"><span><kbd>↵</kbd> Öffnen</span><span><kbd>Esc</kbd> Schließen</span></div>'
			: "") +
		"</div>";
	selIdx = 0;
	renderList("");
	const inp = U.el("paletteInput");
	if (inp) inp.focus();
}

export function openPalette() {
	openPaletteUi("command", "Suchen oder Befehl eingeben…");
}

// Notion-artiges Menü beim „+“ in der Tab-Leiste: suchen & in neuem Tab öffnen
export function openNewTabMenu() {
	openPaletteUi("newTab", "In neuem Tab öffnen…");
}

export function closePalette() {
	const el = U.el("palette");
	if (el) { el.hidden = true; el.innerHTML = ""; delete el.dataset.mode; }
	paletteMode = "command";
}

// Der 🔍-Button in der Sidebar-Topbar öffnet/schließt ebenfalls das Befehls-Menü.
export function handleSearchToggle() {
	if (isPaletteOpen()) closePalette();
	else openPalette();
}

function actionItems() {
	const due = STATE.dueCards().length;
	const light = (localStorage.getItem("impala67Theme") || localStorage.getItem("notionTheme")) === "light";
	const click = (id) => () => { const b = U.el(id); if (b) b.click(); };
	return [
		{ type: "action", icon: "＋", label: "Neue Seite", run: () => APP.newPageFlow(Object.keys(S.workspaces)[0] || "default", null) },
		{ type: "action", icon: "🃏", label: "Karten wiederholen" + (due ? " — " + due + " fällig" : ""), run: () => RENDER.openReview() },
		// FIX: #btnCards gibt es in index.html nicht mehr (UI-Entrümpelung) —
		// stummer No-Op. Direkt den Anki-Browser öffnen (wie case "btnCards" in app.js).
		{ type: "action", icon: "▱", label: "Karten verwalten", run: () => APP.openAnki("browser") },
		{ type: "action", icon: "📅", label: "Daily Note von heute öffnen", run: () => APP.openDailyNote(RENDER.localDayKey(new Date())) },
		{ type: "action", icon: "🗓", label: "Daily-Notes-Kalender öffnen", run: click("btnDaily") },
		{ type: "action", icon: "📓", label: "NotebookLM öffnen", run: click("btnNotebookLM") },
		{ type: "action", icon: light ? "🌙" : "☀️", label: light ? "Dunkles Design" : "Helles Design", run: () => {
			localStorage.setItem("impala67Theme", light ? "dark" : "light");
			SETTINGS.applyTheme();
		} },
		{ type: "action", icon: "🗑", label: "Papierkorb öffnen", run: click("btnTrash") },
		{ type: "action", icon: "☁", label: "Drive-Sync starten", run: click("btnDriveSync") },
		{ type: "action", icon: "⚙", label: "Einstellungen öffnen", run: click("btnSettings") }
	];
}

// Aktionen nur für das „+ Tab“-Menü (wie in Notion oben: Neuer Chat / Neue Seite)
function newTabActions() {
	const wsId = S.currentWorkspaceId || Object.keys(S.workspaces)[0] || "default";
	return [
		{ type: "action", icon: "✦", label: "Neuen Chat starten", kind: "Schnellaktion", run: () => {
			if (typeof APP.startNewChat === "function") APP.startNewChat({ newTab: true });
			else {
				// Fallback: Chat-Tab-Button / neue Session über Sidebar-Flow
				const b = U.el("btnChatTab");
				if (b) b.click();
			}
		} },
		{ type: "action", icon: "📄", label: "Neue Seite", kind: "Schnellaktion", run: async () => {
			// Immer in neuem Tab anlegen (wie Notion + → Neue Seite)
			if (typeof APP.createPageInNewTab === "function") await APP.createPageInNewTab(wsId, null);
			else await APP.newPageFlow(wsId, null);
		} },
	];
}

// Breadcrumb-Pfad einer Seite für die New-Tab-Liste (Workspace › Eltern › …)
function pagePathLabel(pg) {
	if (!pg) return "";
	const parts = [];
	let cur = pg;
	const guard = new Set();
	while (cur && cur.parentId && !guard.has(cur.parentId)) {
		guard.add(cur.parentId);
		const p = S.pages[cur.parentId];
		if (!p || p.trashed) break;
		parts.unshift(p.title || "");
		cur = p;
	}
	const ws = S.workspaces[pg.workspaceId] || S.workspaces.default;
	if (ws && ws.name) parts.unshift(ws.name);
	return parts.filter(Boolean).join(" › ");
}

function gather(q) {
	const ql = q.trim().toLowerCase();
	const rows = [];

	// Plus-Tab-Menü: Schnellaktionen oben, dann Seiten/Chats (Titel-Suche, mehr Treffer)
	if (paletteMode === "newTab") {
		const acts = newTabActions().filter((a) => !ql || a.label.toLowerCase().includes(ql));
		if (acts.length) rows.push({ head: "" }, ...acts);
		const pages = (ql
			? STATE.activePages().filter((p) => (p.title || "").toLowerCase().includes(ql)
				|| pagePathLabel(p).toLowerCase().includes(ql))
			: STATE.activePages().slice().sort((a, b) => (b.updated || "").localeCompare(a.updated || "")).slice(0, 14)
		).map((p) => ({ type: "page", page: p, path: pagePathLabel(p) }));
		let chats = (typeof CHATS !== "undefined") ? CHATS.load() : [];
		chats = (ql
			? chats.filter((s) => (s.title || "").toLowerCase().includes(ql))
			: chats).slice(0, ql ? 8 : 4);
		if (pages.length) rows.push({ head: ql ? "Seiten" : "Zuletzt" }, ...pages);
		if (chats.length) rows.push({ head: "Chats" }, ...chats.map((s) => ({ type: "chat", chat: s })));
		return rows;
	}

	const pages = ql
		? STATE.searchNotes(ql).map((r) => ({ type: "page", page: r.page, snippet: r.snippet }))
		: STATE.activePages().slice().sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 6).map((p) => ({ type: "page", page: p }));
	let chats = (typeof CHATS !== "undefined") ? CHATS.load() : [];
	chats = (ql
		? chats.filter((s) => (s.title || "").toLowerCase().includes(ql) || (s.messages || []).some((m) => (m.content || "").toLowerCase().includes(ql)))
		: chats).slice(0, ql ? 5 : 3);
	const acts = actionItems().filter((a) => !ql || a.label.toLowerCase().includes(ql));
	if (pages.length) rows.push({ head: ql ? "Seiten" : "Zuletzt bearbeitet" }, ...pages);
	if (chats.length) rows.push({ head: "Chats" }, ...chats.map((s) => ({ type: "chat", chat: s })));
	if (acts.length) rows.push({ head: "Aktionen" }, ...acts);
	return rows;
}

function mark(text, ql) {
	const esc = U.esc(text);
	if (!ql) return esc;
	return esc.replace(new RegExp("(" + ql.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi"), "<mark>$1</mark>");
}

function renderList(q) {
	const list = U.el("paletteList");
	if (!list) return;
	const ql = q.trim().toLowerCase();
	const rows = gather(q);
	items = rows.filter((r) => !r.head);
	if (selIdx >= items.length) selIdx = Math.max(0, items.length - 1);
	let i = 0;
	list.innerHTML = rows.map((r) => {
		if (r.head) return '<div class="palette-head">' + r.head + "</div>";
		const idx = i++;
		const sel = idx === selIdx ? " selected" : "";
		if (r.type === "page") {
			const pg = r.page;
			const snip = r.snippet ? r.snippet.replace(/\s+/g, " ").trim().slice(0, 110) : "";
			const path = r.path || "";
			return '<button class="palette-item' + sel + '" data-palidx="' + idx + '">' +
				'<span class="palette-icon">' + U.esc(RENDER.pageIconLabel(pg)) + "</span>" +
				'<span class="palette-main"><span class="palette-title">' + mark(pg.title, ql) + "</span>" +
				(path ? '<span class="palette-snip">' + mark(path, ql) + "</span>"
					: (snip ? '<span class="palette-snip">' + mark(snip, ql) + "</span>" : "")) +
				"</span>" +
				'<span class="palette-kind">' + (paletteMode === "newTab" && path ? U.esc(path.split(" › ").slice(-1)[0] || "") : U.fmtDate(pg.updated)) + "</span></button>";
		}
		if (r.type === "chat") {
			return '<button class="palette-item' + sel + '" data-palidx="' + idx + '">' +
				'<span class="palette-icon">✦</span>' +
				'<span class="palette-main"><span class="palette-title">' + mark(r.chat.title || "Chat", ql) + "</span></span>" +
				'<span class="palette-kind">' + U.fmtDate(r.chat.updated || r.chat.created) + "</span></button>";
		}
		return '<button class="palette-item' + sel + '" data-palidx="' + idx + '">' +
			'<span class="palette-icon">' + r.icon + "</span>" +
			'<span class="palette-main"><span class="palette-title">' + mark(r.label, ql) + "</span></span>" +
			'<span class="palette-kind">' + U.esc(r.kind || "Aktion") + "</span></button>";
	}).join("") || '<div class="empty">Nichts gefunden</div>';
	const selEl = list.querySelector(".palette-item.selected");
	if (selEl) selEl.scrollIntoView({ block: "nearest" });
}

function runItem(it) {
	const asNewTab = paletteMode === "newTab";
	closePalette();
	if (!it) return;
	if (it.type === "page") TABS.openPage(it.page.id, asNewTab ? { newTab: true } : undefined);
	else if (it.type === "chat") TABS.openPage("chat:" + it.chat.id, asNewTab ? { newTab: true } : undefined);
	else if (it.run) it.run();
}

// FIX: ↑/↓/Enter/Escape griffen bisher nur, solange der Fokus exakt im
// Eingabefeld lag (e.target.id === "paletteInput"). Landete der Fokus aus
// irgendeinem Grund auf einem Listeneintrag, reagierte insbesondere Escape
// gar nicht mehr — genau das Muster "Menü lässt sich nicht schließen".
// Jetzt reicht jedes Tastatur-Ziel INNERHALB des Befehls-Menüs.
function wirePalette(el) {
	el.addEventListener("click", (e) => {
		if (e.target === el) { closePalette(); return; } // Klick auf den Hintergrund schließt
		const btn = e.target.closest("[data-palidx]");
		if (btn) runItem(items[Number(btn.dataset.palidx)]);
	});
	el.addEventListener("input", (e) => {
		if (e.target.id === "paletteInput") { selIdx = 0; renderList(e.target.value); }
	});
	el.addEventListener("keydown", (e) => {
		if (!el.contains(e.target)) return;
		const inputVal = (U.el("paletteInput") || {}).value || "";
		if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Escape") e.stopPropagation();
		if (e.key === "ArrowDown") { e.preventDefault(); selIdx = Math.min(items.length - 1, selIdx + 1); renderList(inputVal); }
		else if (e.key === "ArrowUp") { e.preventDefault(); selIdx = Math.max(0, selIdx - 1); renderList(inputVal); }
		else if (e.key === "Enter") { e.preventDefault(); runItem(items[selIdx]); }
		else if (e.key === "Escape") { e.preventDefault(); closePalette(); }
	});
}

export const SEARCH = {
	openPalette,
	openNewTabMenu,
	closePalette,
	isPaletteOpen,
	handleSearchToggle
};