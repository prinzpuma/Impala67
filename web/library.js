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

// ---------- GoodNotes-artige Bibliothek: Deckblätter (eigenes Bild oder vorgefertigt) ----------
export const COVER_PRESETS = ["sunset", "ocean", "forest", "grape", "mono"];

// Ohne eigenes Cover: deterministisch eine der vorgefertigten Verlaufs-Vorlagen aus
// Titel/ID ableiten, damit jede Kachel wie in GoodNotes ein festes Deckblatt hat.
export function defaultCover(pg) {
	const s = (pg.title || "") + (pg.id || "");
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return COVER_PRESETS[h % COVER_PRESETS.length];
}

// Cover-Fläche einer Kachel: eigenes Bild (per data-coverimg nachgeladen) oder Verlauf.
export function libCoverHtml(pg) {
	const icon = pg.icon || (pg.pdfId ? "📄" : "📝");
	if (pg.coverImg) {
		return '<div class="lib-cover has-img" data-coverimg="' + U.esc(pg.coverImg) + '"><span class="lib-cover-icon">' + U.esc(icon) + "</span></div>";
	}
	const preset = pg.cover || defaultCover(pg);
	// Papier-Vorschau wie in GoodNotes: die ersten Inhaltszeilen auf dem Deckblatt
	const firstLines = (pg.content || "").split("\n").filter((l) => l.trim() && !l.startsWith("![")).slice(0, 4)
		.map((l) => l.replace(/[#>*`\-\[\]]/g, "").trim().slice(0, 36)).filter(Boolean);
	return '<div class="lib-cover cover-' + U.esc(preset) + '"><span class="lib-cover-icon">' + U.esc(icon) + "</span>" +
		'<span class="lib-cover-paper">' + firstLines.map((l) => "<i>" + U.esc(l) + "</i>").join("") + "</span></div>";
}

// Eine Dokument-Kachel: Deckblatt (eigenes Bild oder vorgefertigt) + Titel + Datum.
// Hat die Seite Unterseiten, erscheint zusätzlich ein Ordner-Knopf zum Hineinnavigieren.
export function libCardHtml(pg) {
	const kids = STATE.childrenOf(pg.id, pg.workspaceId);
	const into = kids.length
		? '<button class="lib-into" data-libinto="' + pg.id + '" title="Unterseiten öffnen">📁 ' + kids.length + "</button>"
		: "";
	return '<div class="lib-card" data-page="' + pg.id + '">' +
		libCoverHtml(pg) + into +
		'<div class="lib-card-title">' + (pg.isTemplate ? "📑 " : "") + U.esc(pg.title) + "</div>" +
		'<div class="lib-card-date">' + U.fmtDate(pg.updated) + "</div>" +
	"</div>";
}

// Bibliothek: GoodNotes-artige Kachel-Ansicht (Ordner + Dokument-Deckblätter) mit
// Ordner-Navigation und Breadcrumb, plus alternative Tabellen-Ansicht.
export function renderLibrary(main) {
	const view = (S.libView === "table") ? "table" : "grid";
	const q = (S.libFilter || "").trim().toLowerCase();
	const matches = (pg) => (!S.libTag || (pg.tags || []).includes(S.libTag))
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
	let html = '<div class="library"><div class="lib-head"><h1>Bibliothek</h1>' +
		'<input id="libFilter" placeholder="Filtern (Titel, Tags)…" autocomplete="off" value="' + U.esc(S.libFilter || "") + '">' +
		'<div class="mode-btns">' + sbtn("updated", "Datum") + sbtn("title", "Name") + '</div>' +
		'<div class="mode-btns">' + vbtn("grid", "Kacheln") + vbtn("table", "Tabelle") + "</div></div>";
	// Tag-Verwaltung: Chips mit Zähler — Klick filtert, ✎ benennt den aktiven Tag um.
	const tagCounts = {};
	STATE.activePages().forEach((p) => (p.tags || []).forEach((tag) => { tagCounts[tag] = (tagCounts[tag] || 0) + 1; }));
	const tagNames = Object.keys(tagCounts).sort((a, b) => tagCounts[b] - tagCounts[a]);
	if (tagNames.length) {
		html += '<div class="tag-row">' + tagNames.map((tag) =>
			'<button class="tag-chip' + (S.libTag === tag ? " active" : "") + '" data-tagfilter="' + U.esc(tag) + '">#' + U.esc(tag) + " · " + tagCounts[tag] + "</button>"
		).join("") + (S.libTag ? '<button class="tag-chip" data-tagrename="' + U.esc(S.libTag) + '" title="Tag umbenennen">✎ umbenennen</button>' : "") + "</div>";
	}
	// Vorlagen-Galerie: alle als Vorlage markierten Seiten mit Ein-Klick-„Verwenden“.
	const tpls = STATE.activePages().filter((p) => p.isTemplate);
	if (tpls.length && !q && !S.libTag) {
		html += '<div class="tpl-gallery"><h3>📑 Vorlagen</h3><div class="tpl-list">' + tpls.map((p) =>
			'<span class="tpl-item">' + (p.icon ? U.esc(p.icon) + " " : "📑 ") + U.esc(p.title) +
			' <button class="mini" data-tpluse="' + p.id + '">Verwenden</button>' +
			' <button class="mini" data-page="' + p.id + '">Öffnen</button></span>'
		).join("") + "</div></div>";
	}

	if (view === "table") {
		const key = S.libSort || "updated";
		const dir = S.libSortDir || -1;
		const rows = STATE.activePages().filter(matches).sort((a, b) => {
			const va = key === "title" ? a.title.toLowerCase() : (a[key] || "");
			const vb = key === "title" ? b.title.toLowerCase() : (b[key] || "");
			return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
		});
		const arrow = (k) => (key === k ? (dir === 1 ? " ↑" : " ↓") : "");
		html += '<table class="lib-table"><thead><tr>' +
			'<th data-libsort="title" title="Klicken zum Sortieren">Titel' + arrow("title") + "</th>" +
			"<th>Workspace</th><th>Tags</th>" +
			'<th data-libsort="created" title="Klicken zum Sortieren">Erstellt' + arrow("created") + "</th>" +
			'<th data-libsort="updated" title="Klicken zum Sortieren">Geändert' + arrow("updated") + "</th>" +
			"</tr></thead><tbody>" +
			rows.map((pg) =>
				'<tr data-page="' + pg.id + '">' +
					"<td>" + (pg.icon ? U.esc(pg.icon) + " " : pg.pdfId ? "📄 " : "📝 ") + U.esc(pg.title) + (pg.isTemplate ? ' <span class="tpl-badge">Vorlage</span>' : "") + "</td>" +
					"<td>" + U.esc((S.workspaces[pg.workspaceId] || {}).name || "—") + "</td>" +
					"<td>" + (pg.tags && pg.tags.length ? U.esc(pg.tags.join(", ")) : "—") + "</td>" +
					"<td>" + U.fmtDate(pg.created) + "</td>" +
					"<td>" + U.fmtDate(pg.updated) + "</td>" +
				"</tr>"
			).join("") + "</tbody></table>";
		if (!rows.length) html += '<div class="empty small">Keine Seiten' + (q ? " für diesen Filter" : "") + "</div>";
	} else if (q || S.libTag) {
		// Kachel-Ansicht mit aktivem Filter: flache Treffer-Kacheln über alle Workspaces
		const hits = sortPages(STATE.activePages().filter(matches));
		html += '<div class="lib-grid">' + hits.map((pg) => libCardHtml(pg)).join("") + "</div>";
		if (!hits.length) html += '<div class="empty small">Keine Seiten für diesen Filter</div>';
		html += "</div>";
		main.innerHTML = html;
		hydrateCovers(main);
		return;
	} else {
		let folder = S.libFolder;
		const wsList = Object.values(S.workspaces);
		// Nur ein Workspace? Dann direkt hinein — die Ordner-Zwischenebene ist unnötig.
		if (!folder && wsList.length === 1) folder = { wsId: wsList[0].id, pageId: null };
		let crumbs = "";
		if (folder && (folder.pageId || wsList.length > 1)) {
			const cur = folder.pageId ? S.pages[folder.pageId] : null;
			const upAttr = cur
				? (cur.parentId ? 'data-libinto="' + cur.parentId + '"' : 'data-libws="' + U.esc(folder.wsId) + '"')
				: 'data-libroot="1"';
			crumbs += '<button class="lib-back" ' + upAttr + ' title="Zurück">‹</button>';
		}
		crumbs += '<span class="lib-crumb" data-libroot="1">🗂 Alle</span>';
		let tiles = "";
		if (!folder) {
			tiles = Object.values(S.workspaces).map((ws) => {
				const count = STATE.activePages().filter((p) => (p.workspaceId || "default") === ws.id).length;
				return '<button class="lib-folder" data-libws="' + U.esc(ws.id) + '"><span class="lib-folder-ico">📁</span>' +
					'<span class="lib-folder-name">' + U.esc(ws.name) + "</span>" +
					'<span class="lib-folder-count">' + count + " Seiten</span></button>";
			}).join("") || '<div class="empty small">Keine Workspaces</div>';
		} else {
			const ws = S.workspaces[folder.wsId] || { name: "Workspace", id: folder.wsId };
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
			// „Neue Seite“-Kachel direkt im aktuellen Ordner (wie das + in GoodNotes)
			tiles += '<button class="lib-newdoc" data-libnew="1" title="Neue Seite hier anlegen"><span class="lib-newdoc-plus">＋</span><span>Neue Seite</span></button>';
		}
		html += '<div class="lib-crumbs">' + crumbs + "</div>";
		html += '<div class="lib-grid">' + tiles + "</div>";
		if (!folder) html += '<div class="lib-new"><input id="inpWsName" placeholder="Neuer Workspace…"><button id="btnCreateWs">Erstellen</button></div>';
		html += "</div>";
		main.innerHTML = html;
		hydrateCovers(main);
		return;
	}
	html += '<div class="lib-new"><input id="inpWsName" placeholder="Neuer Workspace…">' +
		'<button id="btnCreateWs">Erstellen</button></div></div>';
	main.innerHTML = html;
	hydrateCovers(main);
}

// Ganzen Workspace als ZIP voller Markdown-Dateien exportieren (Ordnerstruktur = Seitenbaum)
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
	if (!files.length) { alert("Dieser Workspace hat keine Seiten."); return; }
	U.downloadBlob(safe(ws ? ws.name : "Workspace") + ".zip", U.zip(files));
}

// Bibliothek-Aktionen aus wireEvents und input-Listeners:

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
	libCoverHtml,
	defaultCover,
	COVER_PRESETS,
	handleLibView,
	handleLibFolderNavigation,
	handleLibNewPage,
	handleLibSort,
	handleFilterInput,
	handleCreateWorkspace
};