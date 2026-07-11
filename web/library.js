"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { RENDER } from "./render.js";
import { APP } from "./app.js";

const renderMain = (...args) => RENDER.renderMain(...args);
const render = (...args) => RENDER.render(...args);
const hydrateCovers = (...args) => RENDER.hydrateCovers(...args);
const ancestorsOf = (...args) => RENDER.ancestorsOf(...args);
const newPageFlow = (...args) => APP.newPageFlow(...args);

// ---------- GoodNotes Documents: Cover-Presets + Notebook-Regal ----------
export const COVER_PRESETS = ["sunset", "ocean", "forest", "grape", "mono"];
const FOLDER_TONES = ["sky", "mint", "lilac", "sand", "rose", "slate"];

export function defaultCover(pg) {
	const s = (pg.title || "") + (pg.id || "");
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return COVER_PRESETS[h % COVER_PRESETS.length];
}

export function folderTone(key) {
	const s = String(key || "");
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return FOLDER_TONES[h % FOLDER_TONES.length];
}

// Portrait-Notebook: Rücken + Cover (Bild oder Verlauf) + Titel-Label auf dem Cover.
export function libCoverHtml(pg) {
	const icon = RENDER.pageIconLabel(pg);
	const title = (pg.title || "Ohne Titel").trim();
	const short = title.length > 28 ? title.slice(0, 28) + "…" : title;
	if (pg.coverImg) {
		return '<div class="lib-notebook"><div class="lib-spine" aria-hidden="true"></div>' +
			'<div class="lib-cover has-img" data-coverimg="' + U.esc(pg.coverImg) + '">' +
			'<span class="lib-cover-shade"></span><span class="lib-cover-label">' + U.esc(short) + "</span></div></div>";
	}
	const preset = pg.cover || defaultCover(pg);
	return '<div class="lib-notebook"><div class="lib-spine" aria-hidden="true"></div>' +
		'<div class="lib-cover cover-' + U.esc(preset) + '">' +
		'<span class="lib-cover-icon">' + U.esc(icon) + "</span>" +
		'<span class="lib-cover-label">' + U.esc(short) + "</span></div></div>";
}

// Notion-Seite als flaches Dokumentblatt (Icon, Titel, erste Textzeile, Linien) —
// bewusst Notion-Look; nur GoodNotes-Hefte bekommen das Notizbuch-Cover.
export function libDocHtml(pg) {
	const icon = RENDER.pageIconLabel(pg);
	const firstLine = ((pg.content || "").split("\n").find((l) => l.trim() && !l.trim().startsWith("#")) || "").replace(/[#>*`\[\]]/g, "").slice(0, 80);
	return '<div class="lib-docsheet">' +
		'<span class="lib-docsheet-icon">' + U.esc(icon) + "</span>" +
		'<span class="lib-docsheet-title">' + U.esc((pg.title || "Ohne Titel").slice(0, 44)) + "</span>" +
		(firstLine ? '<span class="lib-docsheet-text">' + U.esc(firstLine) + "</span>" : "") +
		'<span class="lib-docsheet-lines" aria-hidden="true"><i></i><i></i><i></i></span>' +
	"</div>";
}

// Kachel nach Seitentyp: Heft = GoodNotes-Notizbuch, Notion-Seite = Dokumentblatt.
// Beide zeigen exakt die Unterstruktur (Zahl-Badge öffnet die Unterebene).
export function libCardHtml(pg) {
	const kids = STATE.childrenOf(pg.id, pg.workspaceId);
	const into = kids.length
		? '<button class="lib-into" data-libinto="' + pg.id + '" title="Unterebene öffnen">' + kids.length + "</button>"
		: "";
	const fav = pg.favorite ? '<span class="lib-fav" title="Favorit">★</span>' : "";
	const isHeft = pg.kind === "heft";
	const visual = isHeft ? libCoverHtml(pg) : libDocHtml(pg);
	const heftPages = (S.heftMeta && S.heftMeta[pg.id] && S.heftMeta[pg.id].pages) || 1;
	const meta = isHeft
		? "Heft · " + heftPages + " Seite" + (heftPages === 1 ? "" : "n") + " · " + U.fmtDate(pg.updated)
		: U.fmtDate(pg.updated) + (pg.pdfId ? " · PDF" : "");
	return '<div class="lib-card" data-page="' + pg.id + '">' +
		'<div class="lib-card-visual">' + visual + into + fav + "</div>" +
		'<div class="lib-card-title">' + (pg.isTemplate ? '<span class="lib-tpl">Vorlage</span> ' : "") + U.esc(pg.title) + "</div>" +
		'<div class="lib-card-date">' + meta + "</div></div>";
}

// Workspace = farbiger Ordner (GoodNotes-Farbordner), kein Emoji-Hero.
export function libFolderHtml(ws, count) {
	const tone = folderTone(ws.id || ws.name);
	return '<button class="lib-folder tone-' + tone + '" data-libws="' + U.esc(ws.id) + '">' +
		'<span class="lib-folder-visual" aria-hidden="true"><span class="lib-folder-tab"></span><span class="lib-folder-body"></span></span>' +
		'<span class="lib-folder-name">' + U.esc(ws.name) + "</span>" +
		'<span class="lib-folder-count">' + count + (count === 1 ? " Notiz" : " Notizen") + "</span></button>";
}

function newWorkspaceInputHtml() {
	return '<div class="lib-new"><input id="inpWsName" placeholder="Neuer Ordner…" autocomplete="off">' +
		'<button id="btnCreateWs">Erstellen</button></div>';
}

export function renderLibrary(main) {
	const view = (S.libView === "table") ? "table" : "grid";
	const q = (S.libFilter || "").trim().toLowerCase();
	const smart = S.libSmart || null;
	const allPages = STATE.activePages();
	const smartMatch = (pg) => !smart
		|| (smart === "fav" && pg.favorite)
		|| (smart === "pdf" && pg.pdfId)
		|| (smart === "tpl" && pg.isTemplate)
		|| (smart === "untagged" && !(pg.tags || []).length);
	const matches = (pg) => smartMatch(pg)
		&& (!S.libTag || (pg.tags || []).includes(S.libTag))
		&& (!q || pg.title.toLowerCase().includes(q)
		|| (pg.tags || []).some((tag) => String(tag).toLowerCase().includes(q)));
	const vbtn = (v, label) => '<button data-libview="' + v + '" class="' + (view === v ? "active" : "") + '">' + label + "</button>";
	const skey = S.libSort || "updated";
	const sdir = S.libSortDir || -1;
	const sbtn = (k, label) => '<button data-libsort="' + k + '" class="' + (skey === k ? "active" : "") + '">' + label + (skey === k ? (sdir === 1 ? " ↑" : " ↓") : "") + "</button>";
	const sortPages = (arr) => arr.slice().sort((a, b) => {
		const va = skey === "title" ? a.title.toLowerCase() : (a[skey] || "");
		const vb = skey === "title" ? b.title.toLowerCase() : (b[skey] || "");
		return (va < vb ? -1 : va > vb ? 1 : 0) * sdir;
	});

	let html = '<div class="library lib-docs">' +
		'<div class="lib-head">' +
			'<div class="lib-head-left"><h1>Dokumente</h1>' +
			'<p class="lib-sub hint">Notizen, Ordner und Deckblätter</p></div>' +
			'<div class="lib-head-tools">' +
				'<input id="libFilter" placeholder="Suchen…" autocomplete="off" value="' + U.esc(S.libFilter || "") + '">' +
				'<div class="mode-btns lib-sort">' + sbtn("updated", "Datum") + sbtn("title", "Name") + "</div>" +
				'<div class="mode-btns">' + vbtn("grid", "Raster") + vbtn("table", "Liste") + "</div>" +
			"</div></div>";

	const smartDefs = [["all", "Alle", allPages.length],
		["fav", "Favoriten", allPages.filter((p) => p.favorite).length],
		["pdf", "PDFs", allPages.filter((p) => p.pdfId).length],
		["tpl", "Vorlagen", allPages.filter((p) => p.isTemplate).length],
		["untagged", "Ohne Tag", allPages.filter((p) => !(p.tags || []).length).length]];
	html += '<div class="lib-tabs">' + smartDefs.map(([id, label, n]) =>
		'<button class="lib-tab' + ((smart === id || (!smart && id === "all")) ? " active" : "") + '" data-libsmart="' + id + '">' +
		U.esc(label) + '<span class="lib-tab-n">' + n + "</span></button>").join("") + "</div>";

	const tagCounts = {};
	allPages.forEach((p) => (p.tags || []).forEach((tag) => { tagCounts[tag] = (tagCounts[tag] || 0) + 1; }));
	const tagNames = Object.keys(tagCounts).sort((a, b) => tagCounts[b] - tagCounts[a]);
	if (tagNames.length) {
		html += '<div class="tag-row lib-tags">' + tagNames.map((tag) =>
			'<button class="tag-chip' + (S.libTag === tag ? " active" : "") + '" data-tagfilter="' + U.esc(tag) + '">#' + U.esc(tag) + " · " + tagCounts[tag] + "</button>"
		).join("") + (S.libTag ? '<button class="tag-chip" data-tagrename="' + U.esc(S.libTag) + '" title="Tag umbenennen">Umbenennen</button>' : "") + "</div>";
	}

	if (view === "table") {
		const arrow = (k) => (skey === k ? (sdir === 1 ? " ↑" : " ↓") : "");
		const rows = sortPages(allPages.filter(matches));
		html += '<table class="lib-table"><thead><tr>' +
			'<th data-libsort="title" title="Klicken zum Sortieren">Titel' + arrow("title") + "</th>" +
			"<th>Ordner</th><th>Tags</th>" +
			'<th data-libsort="created" title="Klicken zum Sortieren">Erstellt' + arrow("created") + "</th>" +
			'<th data-libsort="updated" title="Klicken zum Sortieren">Geändert' + arrow("updated") + "</th>" +
			"</tr></thead><tbody>" +
			rows.map((pg) =>
				'<tr data-page="' + pg.id + '">' +
					"<td>" + U.esc(RENDER.pageIconLabel(pg)) + " " + U.esc(pg.title) + (pg.isTemplate ? ' <span class="tpl-badge">Vorlage</span>' : "") + "</td>" +
					"<td>" + U.esc((S.workspaces[pg.workspaceId] || {}).name || "—") + "</td>" +
					"<td>" + (pg.tags && pg.tags.length ? U.esc(pg.tags.join(", ")) : "—") + "</td>" +
					"<td>" + U.fmtDate(pg.created) + "</td>" +
					"<td>" + U.fmtDate(pg.updated) + "</td>" +
				"</tr>"
			).join("") + "</tbody></table>";
		if (!rows.length) html += '<div class="empty small">Keine Notizen' + (q ? " für diese Suche" : "") + "</div>";
	} else if (q || S.libTag || smart) {
		const hits = sortPages(allPages.filter(matches));
		html += '<div class="lib-grid">' + hits.map((pg) => libCardHtml(pg)).join("") + "</div>";
		if (!hits.length) html += '<div class="empty small">Keine Notizen für diesen Filter</div>';
		html += "</div>";
		main.innerHTML = html;
		hydrateCovers(main);
		return;
	} else {
		let folder = S.libFolder;
		const wsList = Object.values(S.workspaces);
		if (!folder && wsList.length === 1) folder = { wsId: wsList[0].id, pageId: null };
		let crumbs = "";
		if (folder && (folder.pageId || wsList.length > 1)) {
			const cur = folder.pageId ? S.pages[folder.pageId] : null;
			const upAttr = cur
				? (cur.parentId ? 'data-libinto="' + cur.parentId + '"' : 'data-libws="' + U.esc(folder.wsId) + '"')
				: 'data-libroot="1"';
			crumbs += '<button class="lib-back" ' + upAttr + ' title="Zurück">‹</button>';
		}
		crumbs += '<span class="lib-crumb" data-libroot="1">Alle</span>';
		let tiles = "";
		if (!folder) {
			tiles = Object.values(S.workspaces).map((ws) => {
				const count = allPages.filter((p) => (p.workspaceId || "default") === ws.id).length;
				return libFolderHtml(ws, count);
			}).join("") || '<div class="empty small">Keine Ordner</div>';
		} else {
			const ws = S.workspaces[folder.wsId] || { name: "Ordner", id: folder.wsId };
			crumbs += '<span class="lib-crumb-sep">/</span><span class="lib-crumb" data-libws="' + U.esc(ws.id) + '">' + U.esc(ws.name) + "</span>";
			if (folder.pageId) {
				ancestorsOf(S.pages[folder.pageId] || {}).forEach((a) => {
					crumbs += '<span class="lib-crumb-sep">/</span><span class="lib-crumb" data-libinto="' + a.id + '">' + U.esc(a.title) + "</span>";
				});
				const cur = S.pages[folder.pageId];
				if (cur) crumbs += '<span class="lib-crumb-sep">/</span><span class="lib-crumb current">' + U.esc(cur.title) + "</span>";
			}
			const kids = sortPages(STATE.childrenOf(folder.pageId || null, folder.wsId));
			tiles = kids.map((pg) => libCardHtml(pg)).join("");
			tiles += '<button class="lib-newdoc" data-libnew="1" title="Neue Notiz hier anlegen">' +
				'<span class="lib-newdoc-notebook" aria-hidden="true"><span class="lib-spine"></span><span class="lib-cover lib-cover-empty"><span class="lib-newdoc-plus">＋</span></span></span>' +
				'<span class="lib-card-title">Neue Notiz</span></button>';
		}
		html += '<div class="lib-crumbs">' + crumbs + "</div>";
		html += '<div class="lib-grid">' + tiles + "</div>";
		if (!folder) html += newWorkspaceInputHtml();
		html += "</div>";
		main.innerHTML = html;
		hydrateCovers(main);
		return;
	}
	html += newWorkspaceInputHtml() + "</div>";
	main.innerHTML = html;
	hydrateCovers(main);
}

export function exportWorkspaceZip(wsId) {
	const ws = S.workspaces[wsId];
	const safe = (s) => String(s || "Ohne Titel").replace(/[\\/:*?"<>|#]/g, "_").trim().slice(0, 80) || "Seite";
	const files = [];
	const used = new Set();
	const walk = (parentId, path) => {
		STATE.childrenOf(parentId, wsId).forEach((pg) => {
			let base = path + safe(pg.title), n = 2;
			while (used.has(base)) base = path + safe(pg.title) + " (" + (n++) + ")";
			used.add(base);
			files.push({ name: base + ".md", text: "# " + pg.title + "\n\n" + (pg.content || "") });
			walk(pg.id, base + "/");
		});
	};
	walk(null, "");
	if (!files.length) { alert("Dieser Ordner hat keine Seiten."); return; }
	U.downloadBlob(safe(ws ? ws.name : "Ordner") + ".zip", U.zip(files));
}

export function handleLibView(viewType) {
	S.libView = viewType;
	renderMain();
}

export function handleLibFolderNavigation(t) {
	if (t.dataset.libroot) {
		S.libFolder = null;
	} else if (t.dataset.libws) {
		S.libFolder = { wsId: t.dataset.libws, pageId: null };
	} else if (t.dataset.libinto) {
		const pg = S.pages[t.dataset.libinto];
		if (pg) S.libFolder = { wsId: pg.workspaceId || "default", pageId: pg.id };
	}
	renderMain();
}

export async function handleLibNewPage() {
	const f = S.libFolder || { wsId: Object.keys(S.workspaces)[0] || "default", pageId: null };
	await newPageFlow(f.wsId, f.pageId);
}

export function handleLibSort(sortBy) {
	if (S.libSort === sortBy) S.libSortDir = -(S.libSortDir || -1);
	else { S.libSort = sortBy; S.libSortDir = 1; }
	renderMain();
}

export function handleFilterInput(e) {
	S.libFilter = e.target.value;
	const pos = e.target.selectionStart;
	renderLibrary(U.el("main"));
	const inp = U.el("libFilter");
	if (inp) { inp.focus(); inp.selectionStart = inp.selectionEnd = pos; }
}

export async function handleCreateWorkspace() {
	const inp = document.getElementById("inpWsName");
	const name = inp ? inp.value.trim() : "";
	if (name) {
		await STATE.dispatch("workspaceCreate", { id: U.uid(), name });
		render();
	}
}

export const LIBRARY = {
	exportWorkspaceZip,
	renderLibrary,
	libCardHtml,
	libDocHtml,
	libCoverHtml,
	libFolderHtml,
	folderTone,
	defaultCover,
	COVER_PRESETS,
	handleLibView,
	handleLibFolderNavigation,
	handleLibNewPage,
	handleLibSort,
	handleFilterInput,
	handleCreateWorkspace
};