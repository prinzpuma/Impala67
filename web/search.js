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
let lastFocus = null; // Fokus vor dem Oeffnen -> nach Esc/Hintergrund-Klick zurueckgeben
let renderTimer = 0; // Debounce-Handle fuer die Eingabe (siehe wirePalette)
// PERF: CHATS.load() parst localStorage-JSON komplett — das lief pro Tastendruck (und pro
// ↑/↓) erneut. Einmal je Palette-Sitzung reicht; beim Oeffnen/Schliessen verworfen.
let chatCache = null;
const loadChats = () => (chatCache || (chatCache = CHATS.load()));

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
	// WARUM: Fokus vor dem Oeffnen merken. Ohne das haengt der Fokus nach Esc am body
	// und Weitertippen im Editor ist weg.
	if (!isPaletteOpen()) lastFocus = document.activeElement;
	paletteMode = mode || "command";
	const el = host();
	chatCache = null; // frische Sitzung -> Chat-Liste neu einlesen
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
	// WARUM: laufender Debounce wuerde nach dem Schliessen noch suchen/rendern -> abbrechen.
	if (renderTimer) { clearTimeout(renderTimer); renderTimer = 0; }
	chatCache = null;
	const back = lastFocus;
	lastFocus = null;
	if (back && back.isConnected && typeof back.focus === "function") back.focus();
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
		{ type: "action", icon: "📓", label: "Gemini Notebook öffnen (ehemals NotebookLM)", run: click("btnNotebookLM") },
		{ type: "action", icon: light ? "🌙" : "☀️", label: light ? "Dunkles Design" : "Helles Design", run: () => {
			localStorage.setItem("impala67Theme", light ? "dark" : "light");
			SETTINGS.applyTheme();
		} },
		{ type: "action", icon: "🗑", label: "Papierkorb öffnen", run: click("btnTrash") },
		{ type: "action", icon: "☁", label: "Drive-Sync in Einstellungen öffnen", run: click("btnSettings") },
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

// WARUM: Sortierung nach Datum stand zweimal im File, einmal ungeklammert —
// eine Seite ohne "updated" liess Strg+K mit TypeError platzen. Eine Quelle.
function recentPages(limit) {
	return STATE.activePages().slice()
		.sort((a, b) => (b.updated || "").localeCompare(a.updated || ""))
		.slice(0, limit);
}

// Breadcrumb-Pfad einer Seite für die New-Tab-Liste (Workspace › Eltern › …)
// PERF: pro Render gemerkt — der Pfad wurde je Seite zweimal erlaufen (Filter + Anzeige)
// und fuer gemeinsame Eltern immer wieder von neuem; Cache leert renderList.
const pathCache = new Map();
function pagePathLabel(pg) {
	if (!pg) return "";
	const memo = pathCache.get(pg.id);
	if (memo !== undefined) return memo;
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
	const out = parts.filter(Boolean).join(" › ");
	pathCache.set(pg.id, out);
	return out;
}

function gather(q) {
	const ql = q.trim().toLowerCase();
	const rows = [];

	// Plus-Tab-Menü: Schnellaktionen oben, dann Seiten/Chats (Titel-Suche, mehr Treffer)
	if (paletteMode === "newTab") {
		const acts = newTabActions().filter((a) => !ql || a.label.toLowerCase().includes(ql));
		// WARUM: leerer Kopf erzeugte eine leere Ueberschriftszeile -> Luecke oben im Menue.
		if (acts.length) rows.push(...acts);
		const pages = (ql
			? STATE.activePages().filter((p) => (p.title || "").toLowerCase().includes(ql)
				|| pagePathLabel(p).toLowerCase().includes(ql))
			: recentPages(14)
		).map((p) => ({ type: "page", page: p, path: pagePathLabel(p) }));
		let chats = loadChats(); // gecacht, siehe loadChats
		chats = (ql
			? chats.filter((s) => (s.title || "").toLowerCase().includes(ql))
			: chats).slice(0, ql ? 8 : 4);
		if (pages.length) rows.push({ head: ql ? "Seiten" : "Zuletzt" }, ...pages);
		if (chats.length) rows.push({ head: "Chats" }, ...chats.map((s) => ({ type: "chat", chat: s })));
		return rows;
	}

	const pages = ql
		? STATE.searchNotes(ql).map((r) => ({ type: "page", page: r.page, snippet: r.snippet }))
		: recentPages(6).map((p) => ({ type: "page", page: p }));
	let chats = loadChats(); // gecacht, siehe loadChats
	chats = (ql
		? chats.filter((s) => (s.title || "").toLowerCase().includes(ql) || (s.messages || []).some((m) => (m.content || "").toLowerCase().includes(ql)))
		: chats).slice(0, ql ? 5 : 3);
	const acts = actionItems().filter((a) => !ql || a.label.toLowerCase().includes(ql));
	if (pages.length) rows.push({ head: ql ? "Seiten" : "Zuletzt bearbeitet" }, ...pages);
	if (chats.length) rows.push({ head: "Chats" }, ...chats.map((s) => ({ type: "chat", chat: s })));
	if (acts.length) rows.push({ head: "Aktionen" }, ...acts);
	return rows;
}

// WARUM: Regex wurde je Zeile UND je Tastendruck neu kompiliert. Jetzt einmal pro
// Render bauen und durchreichen. text||"" weil leere Titel sonst "undefined" anzeigten.
function markRe(ql) {
	return ql ? new RegExp("(" + ql.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi") : null;
}

function mark(text, re) {
	const esc = U.esc(text || "");
	return re ? esc.replace(re, "<mark>$1</mark>") : esc;
}

function renderList(q) {
	const list = U.el("paletteList");
	if (!list) return;
	const ql = q.trim().toLowerCase();
	const re = markRe(ql);
	pathCache.clear(); // Titel/Eltern koennen sich zwischen Renders geaendert haben
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
				'<span class="palette-main"><span class="palette-title">' + mark(pg.title, re) + "</span>" +
				(path ? '<span class="palette-snip">' + mark(path, re) + "</span>"
					: (snip ? '<span class="palette-snip">' + mark(snip, re) + "</span>" : "")) +
				"</span>" +
				'<span class="palette-kind">' + (paletteMode === "newTab" && path ? U.esc(path.split(" › ").slice(-1)[0] || "") : U.fmtDate(pg.updated)) + "</span></button>";
		}
		if (r.type === "chat") {
			return '<button class="palette-item' + sel + '" data-palidx="' + idx + '">' +
				'<span class="palette-icon">✦</span>' +
				'<span class="palette-main"><span class="palette-title">' + mark(r.chat.title || "Chat", re) + "</span></span>" +
				'<span class="palette-kind">' + U.fmtDate(r.chat.updated || r.chat.created) + "</span></button>";
		}
		return '<button class="palette-item' + sel + '" data-palidx="' + idx + '">' +
			'<span class="palette-icon">' + r.icon + "</span>" +
			'<span class="palette-main"><span class="palette-title">' + mark(r.label, re) + "</span></span>" +
			'<span class="palette-kind">' + U.esc(r.kind || "Aktion") + "</span></button>";
	}).join("") || '<div class="empty">Nichts gefunden</div>';
	const selEl = list.querySelector(".palette-item.selected");
	if (selEl) selEl.scrollIntoView({ block: "nearest" });
}

// PERF: ↑/↓ rief bisher renderList() — also komplette Volltextsuche plus Neuaufbau der
// ganzen Liste, nur um die Markierung zu verschieben. Auswahl ist reine Optik: Klasse
// umhaengen. Damit ruckelt Halten der Pfeiltaste auch bei vielen Seiten nicht mehr.
function moveSel(delta) {
	const list = U.el("paletteList");
	if (!items.length || !list) return;
	selIdx = Math.max(0, Math.min(items.length - 1, selIdx + delta));
	const nodes = list.querySelectorAll(".palette-item");
	nodes.forEach((n) => n.classList.toggle("selected", Number(n.dataset.palidx) === selIdx));
	if (nodes[selIdx]) nodes[selIdx].scrollIntoView({ block: "nearest" });
}

function runItem(it) {
	const asNewTab = paletteMode === "newTab";
	// WARUM: bei Treffer/Aktion keinen alten Fokus zurueckgeben - das Ziel setzt ihn selbst.
	if (it) lastFocus = null;
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
	// WARUM: jeder Tastendruck lief sofort durch Volltextsuche + kompletten Listenaufbau
	// -> Tippen ruckelte bei vielen Seiten. Kurz sammeln, dann einmal rendern.
	el.addEventListener("input", (e) => {
		if (e.target.id !== "paletteInput") return;
		selIdx = 0;
		const val = e.target.value;
		if (renderTimer) clearTimeout(renderTimer);
		renderTimer = setTimeout(() => { renderTimer = 0; renderList(val); }, 70);
	});
	el.addEventListener("keydown", (e) => {
		if (!el.contains(e.target)) return;
		const inputVal = (U.el("paletteInput") || {}).value || "";
		// WARUM: Debounce kann noch offen sein -> vor Navigation/Enter erst aktuell rendern,
		// sonst oeffnet Enter einen Treffer zur alten Eingabe.
		if (renderTimer && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter")) {
			clearTimeout(renderTimer); renderTimer = 0; renderList(inputVal);
		}
		if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Escape") e.stopPropagation();
		if (e.key === "ArrowDown") { e.preventDefault(); moveSel(1); }
		else if (e.key === "ArrowUp") { e.preventDefault(); moveSel(-1); }
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
