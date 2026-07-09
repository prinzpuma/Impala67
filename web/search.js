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

export function openPalette() {
	const el = host();
	el.hidden = false;
	el.innerHTML = '<div class="palette-box">' +
		'<input id="paletteInput" placeholder="Suchen oder Befehl eingeben…" autocomplete="off">' +
		'<div id="paletteList" class="palette-list"></div>' +
		"</div>";
	selIdx = 0;
	renderList("");
	const inp = U.el("paletteInput");
	if (inp) inp.focus();
}

export function closePalette() {
	const el = U.el("palette");
	if (el) { el.hidden = true; el.innerHTML = ""; }
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
		{ type: "action", icon: "▱", label: "Karten verwalten", run: click("btnCards") },
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

function gather(q) {
	const ql = q.trim().toLowerCase();
	const rows = [];
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
			return '<button class="palette-item' + sel + '" data-palidx="' + idx + '">' +
				'<span class="palette-icon">' + (pg.icon ? U.esc(pg.icon) : pg.pdfId ? "📄" : "📝") + "</span>" +
				'<span class="palette-main"><span class="palette-title">' + mark(pg.title, ql) + "</span>" +
				(snip ? '<span class="palette-snip">' + mark(snip, ql) + "</span>" : "") + "</span>" +
				'<span class="palette-kind">' + U.fmtDate(pg.updated) + "</span></button>";
		}
		if (r.type === "chat") {
			return '<button class="palette-item' + sel + '" data-palidx="' + idx + '">' +
				'<span class="palette-icon">💬</span>' +
				'<span class="palette-main"><span class="palette-title">' + mark(r.chat.title || "Chat", ql) + "</span></span>" +
				'<span class="palette-kind">' + U.fmtDate(r.chat.updated || r.chat.created) + "</span></button>";
		}
		return '<button class="palette-item' + sel + '" data-palidx="' + idx + '">' +
			'<span class="palette-icon">' + r.icon + "</span>" +
			'<span class="palette-main"><span class="palette-title">' + mark(r.label, ql) + "</span></span>" +
			'<span class="palette-kind">Aktion</span></button>';
	}).join("") || '<div class="empty">Nichts gefunden</div>';
	const selEl = list.querySelector(".palette-item.selected");
	if (selEl) selEl.scrollIntoView({ block: "nearest" });
}

function runItem(it) {
	closePalette();
	if (!it) return;
	if (it.type === "page") TABS.openPage(it.page.id);
	else if (it.type === "chat") TABS.openPage("chat:" + it.chat.id);
	else if (it.run) it.run();
}

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
		if (e.target.id !== "paletteInput") return;
		if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Escape") e.stopPropagation();
		if (e.key === "ArrowDown") { e.preventDefault(); selIdx = Math.min(items.length - 1, selIdx + 1); renderList(e.target.value); }
		else if (e.key === "ArrowUp") { e.preventDefault(); selIdx = Math.max(0, selIdx - 1); renderList(e.target.value); }
		else if (e.key === "Enter") { e.preventDefault(); runItem(items[selIdx]); }
		else if (e.key === "Escape") { e.preventDefault(); closePalette(); }
	});
}

export const SEARCH = {
	openPalette,
	closePalette,
	isPaletteOpen,
	handleSearchToggle
};