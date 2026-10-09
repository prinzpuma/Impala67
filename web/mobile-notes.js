"use strict";
import { S, STATE } from "./state.js";
import { RENDER } from "./render.js";
import { U } from "./util.js";
import { MOBILE_VIEW } from "./mobile-view.js";

// Notizen-Browser der Handy-UI (#mNotes). Zeigt jeweils eine Ebene der Seitenhierarchie
// (Drill-down statt Baum). Die Suche ersetzt die Ebenenansicht durch eine flache Trefferliste.

const ws = () => S.currentWorkspaceId || "default";
const wsPages = () => STATE.activePages().filter((pg) => (pg.workspaceId || "default") === ws());

let parent = null; // aktuelle Ebene (Seiten-ID) oder null = Wurzel
let query = ""; // aktueller Suchtext (getrimmt)
let host = null; // Container #mNotes
let boundInput = null; // Suchfeld, an das der input-Listener bereits hängt

const pageOf = (id) => (id && S.pages[id]) || null;

// Kinder einer Seite genau einmal pro refresh ermitteln (Cache wird von refresh() übergeben).
function kidsOf(id, cache) {
	if (!cache.has(id)) {
		const list = STATE.childrenOf(id, ws()) || [];
		cache.set(id, list.map((c) => (typeof c === "object" && c ? c : pageOf(c))).filter(Boolean));
	}
	return cache.get(id);
}

const updatedKey = (pg) => String((pg && pg.updated) || "");
const byUpdatedDesc = (a, b) => (updatedKey(b) < updatedKey(a) ? -1 : updatedKey(b) > updatedKey(a) ? 1 : 0);

// Zeile einer Notiz, exakt nach Spezifikation.
function rowHtml(pg, cache) {
	const id = U.esc(pg.id);
	const title = String(pg.title || "").trim() ? pg.title : "Ohne Titel";
	const icon = U.esc(String(RENDER.pageIconLabel(pg) || ""));
	const date = pg.updated ? U.esc(U.fmtDate(pg.updated)) : "";
	const count = kidsOf(pg.id, cache).length;
	const drill = count
		? `<button type="button" class="m-note-drill" data-mdrill="${id}" aria-label="Unterseiten öffnen"><span>${count}</span>${MOBILE_VIEW.icon("forward")}</button>`
		: "";
	return (
		`<div class="m-row m-note" data-mrow="${id}">` +
		`<button type="button" class="m-note-main" data-page="${id}">` +
		`<span class="m-note-ico">${icon}</span>` +
		`<span class="m-row-text"><strong>${U.esc(title)}</strong><small>${date}</small></span>` +
		`</button>` +
		drill +
		`<button type="button" class="m-iconbtn m-note-more" data-mmenu="${id}" aria-label="Optionen">${MOBILE_VIEW.icon("dots")}</button>` +
		`</div>`
	);
}

function groupHtml(pages, cache) {
	return `<div class="m-group">${pages.map((pg) => rowHtml(pg, cache)).join("")}</div>`;
}

function sectionHtml(label, pages, cache) {
	if (!pages.length) return "";
	return `<h2 class="m-section-label">${U.esc(label)}</h2>` + groupHtml(pages, cache);
}

function searchHtml(q, cache) {
	const hits = wsPages()
		.filter((pg) => String(pg.title || "").toLowerCase().includes(q.toLowerCase()))
		.sort(byUpdatedDesc)
		.slice(0, 50);
	if (!hits.length) {
		return (
			`<div class="m-empty"><strong>Keine Treffer</strong>` +
			`<p>Für „${U.esc(q)}“ wurde nichts gefunden.</p></div>`
		);
	}
	return groupHtml(hits, cache);
}

function rootHtml(cache) {
	const all = wsPages();
	if (!all.length) {
		return (
			`<div class="m-empty"><strong>Noch keine Notizen</strong>` +
			`<button type="button" class="m-pill" data-homeaction="newpage">Erste Notiz anlegen</button></div>`
		);
	}
	const favorites = all.filter((pg) => pg.favorite).sort(byUpdatedDesc).slice(0, 20);
	const recent = all.slice().sort(byUpdatedDesc).slice(0, 5);
	const roots = kidsOf(null, cache);
	return (
		sectionHtml("Favoriten", favorites, cache) +
		sectionHtml("Zuletzt bearbeitet", recent, cache) +
		sectionHtml("Alle Notizen", roots, cache)
	);
}

function levelHtml(cache) {
	const pg = pageOf(parent);
	const title = String((pg && pg.title) || "").trim() ? pg.title : "Ohne Titel";
	const crumb =
		`<div class="m-notes-crumb"><strong>${U.esc(title)}</strong>` +
		`<button type="button" class="m-pill" data-addchild="${U.esc(parent)}">＋ Unterseite</button></div>`;
	const kids = kidsOf(parent, cache);
	const body = kids.length
		? groupHtml(kids, cache)
		: `<div class="m-empty"><strong>Noch keine Unterseiten</strong></div>`;
	return crumb + body;
}

// Entfernt die Ebene, wenn die Seite gelöscht, im Papierkorb oder archiviert ist.
function ensureParentExists() {
	const pg = pageOf(parent);
	if (parent && (!pg || pg.trashed || pg.archived)) parent = null;
}

function refresh() {
	if (!host) return;
	const list = host.querySelector("#mNotesList");
	if (!list) return;
	ensureParentExists();
	const cache = new Map();
	let html;
	if (query) html = searchHtml(query, cache);
	else if (parent) html = levelHtml(cache);
	else html = rootHtml(cache);
	list.innerHTML = html;
}

// Grundgerüst einsetzen (einmalig) und Liste füllen. Das Suchfeld bleibt bei refresh() erhalten.
function render(el) {
	if (!el) return;
	host = el;
	let input = el.querySelector("#mNotesSearch");
	if (!el.querySelector(".m-notes") || !input) {
		el.innerHTML =
			`<div class="m-notes">` +
			`<div class="m-search-wrap">${MOBILE_VIEW.icon("search")}` +
			`<input id="mNotesSearch" class="m-search" type="search" placeholder="Notizen durchsuchen" autocomplete="off" enterkeyhint="search" value="${U.esc(query)}">` +
			`</div>` +
			`<div id="mNotesList"></div>` +
			`</div>`;
		input = el.querySelector("#mNotesSearch");
	}
	if (input && input !== boundInput) {
		input.addEventListener("input", () => {
			query = input.value.trim();
			refresh();
		});
		boundInput = input;
	}
	refresh();
}

function inHost(node) {
	return !!(host && node && host.contains(node));
}

// Klicks in #mNotes. Gibt { type } zurück, wenn der Controller reagieren soll; sonst null.
function handleClick(e) {
	const t = e && e.target;
	if (!t || typeof t.closest !== "function") return null;

	const drill = t.closest("[data-mdrill]");
	if (drill && inHost(drill)) {
		parent = drill.dataset.mdrill || null;
		query = "";
		const input = host.querySelector("#mNotesSearch");
		if (input) input.value = "";
		refresh();
		host.scrollTop = 0;
		return { type: "drill" };
	}

	const menu = t.closest("[data-mmenu]");
	if (menu && inHost(menu)) return { type: "menu", id: menu.dataset.mmenu };

	// data-page, data-addchild und data-homeaction behandelt app.js global.
	return null;
}

function canGoUp() {
	return parent !== null;
}

function goUp() {
	const pg = pageOf(parent);
	parent = (pg && pg.parentId) || null;
	refresh();
}

function reset() {
	parent = null;
	query = "";
	if (host) {
		const input = host.querySelector("#mNotesSearch");
		if (input) input.value = "";
	}
	refresh();
}

function title() {
	if (!parent) return "Notizen";
	const pg = pageOf(parent);
	return (pg && pg.title) || "Ohne Titel";
}

function parentId() {
	return parent;
}

export const MOBILE_NOTES = Object.freeze({ render, refresh, handleClick, canGoUp, goUp, reset, title, parentId });
