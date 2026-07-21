"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { DB } from "./db.js";
import { RENDER } from "./render.js";
import { APP } from "./app.js";
import { NLM } from "./notebooklm.js";
import { TABS } from "./tabs.js";
import { COLLAPSE } from "./collapse.js";

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
	// Ruhiges Kontextmenü statt eines dauerhaften Emoji-Buttons auf dem Cover.
	const coverBtn = isHeft
		? '<button class="lib-cover-btn" data-libcover="' + pg.id + '" title="Heftoptionen" aria-label="Heftoptionen">•••</button>'
		: "";
	const heftPages = (S.heftMeta && S.heftMeta[pg.id] && S.heftMeta[pg.id].pages) || 1;
	const meta = isHeft
		? "Heft · " + heftPages + " Seite" + (heftPages === 1 ? "" : "n") + " · " + U.fmtDate(pg.updated)
		: U.fmtDate(pg.updated) + (pg.pdfId ? " · PDF" : "");
	return '<div class="lib-card" data-page="' + pg.id + '">' +
		'<div class="lib-card-visual">' + visual + into + fav + coverBtn + "</div>" +
		'<div class="lib-card-title">' + (pg.isTemplate ? '<span class="lib-tpl">Vorlage</span> ' : "") + U.esc(pg.title) + "</div>" +
		'<div class="lib-card-date">' + meta + "</div></div>";
}

// Eigenständiger GoodNotes-Ordner: kein Workspace, keine Notion-Seite.
function gnOrder(item) {
	return typeof item.gnOrder === "number" ? item.gnOrder
		: (typeof item.order === "number" ? item.order : Date.parse(item.created || "") || 0);
}
function gnFolderHtml(folder) {
	const direct = Object.values(S.gnFolders || {}).filter((f) => f.parentId === folder.id).length +
		STATE.activePages().filter((p) => p.kind === "heft" && p.gnFolderId === folder.id).length;
	const tone = folderTone(folder.id || folder.title);
	return '<div class="lib-folder gn-folder tone-' + tone + '" draggable="true" data-gnfolder="' + U.esc(folder.id) +
		'" data-gnitem="f:' + U.esc(folder.id) + '" data-gnorder="' + gnOrder(folder) + '">' +
		'<span class="lib-folder-visual" aria-hidden="true"><span class="lib-folder-tab"></span><span class="lib-folder-body"></span></span>' +
		'<span class="lib-folder-name">' + U.esc(folder.title) + "</span>" +
		'<span class="lib-folder-count">' + direct + (direct === 1 ? " Objekt" : " Objekte") + "</span>" +
		'<button class="gn-folder-more" data-gnfoldermenu="' + U.esc(folder.id) + '" title="Ordneroptionen" aria-label="Ordneroptionen">•••</button></div>'; 
}
// Kompatibler Export für andere Module; GoodNotes verwendet intern gnFolderHtml.
export function libFolderHtml(folder) { return gnFolderHtml(folder); }

// GoodNotes-artiger Neu-Dialog: eine Aktion, danach klarer Typ statt permanenter
// "Neue Ordner"-Kachel und Eingabezeile in der Bibliothek.
function openShelfNewDialog() {
	const o = U.el("overlay");
	if (!o) return;
	const currentFolder = typeof S.libFolder === "string" ? S.gnFolders[S.libFolder] : null;
	const where = currentFolder ? "in „" + U.esc(currentFolder.title) + "“" : "in Dokumente";
	o.hidden = false;
	o.innerHTML = '<div class="modal modal-sm lib-create-modal">' +
		'<button class="modal-x" id="btnCloseOverlay" title="Schließen">✕</button>' +
		'<h3>Neu</h3><p class="hint">Was möchtest du ' + where + ' anlegen?</p>' +
		'<div class="lib-create-choices">' +
		'<button type="button" data-libnewkind="heft"><span>📓</span><b>Neues Heft</b><small>Cover wählen und direkt losschreiben</small></button>' +
		'<button type="button" data-libnewkind="folder"><span>📁</span><b>Neuer Ordner</b><small>Hefte und weitere Ordner organisieren</small></button>' +
		'</div></div>';
}

function openGnFolderMenu(folderId) {
	const folder = S.gnFolders[folderId];
	const o = U.el("overlay");
	if (!folder || !o) return;
	o.hidden = false;
	o.innerHTML = '<div class="modal modal-sm lib-create-modal">' +
		'<button class="modal-x" id="btnCloseOverlay" title="Schließen">✕</button>' +
		'<h3>„' + U.esc(folder.title) + '“</h3>' +
		'<p class="hint">Beim Löschen bleiben Hefte und Unterordner erhalten und wandern eine Ebene nach oben.</p>' +
		'<div class="modal-actions"><button id="btnCloseOverlay">Abbrechen</button>' +
		'<button class="danger" data-gnfolderdelete="' + folder.id + '">Ordner löschen</button></div></div>';
}

function openShelfFolderDialog() {
	const o = U.el("overlay");
	if (!o) return;
	o.innerHTML = '<div class="modal modal-sm lib-create-modal">' +
		'<button class="modal-x" id="btnCloseOverlay" title="Schließen">✕</button>' +
		'<h3>Neuer Ordner</h3><p class="hint">Der Ordner erscheint nur in Dokumente, nie im Notion-Baum.</p>' +
		'<input id="libFolderName" placeholder="Ordnername" autocomplete="off">' +
		'<div class="modal-actions"><button id="btnCloseOverlay">Abbrechen</button><button class="primary" data-libcreatefolder="1">Erstellen</button></div></div>';
	setTimeout(() => { const inp = U.el("libFolderName"); if (inp) inp.focus(); }, 0);
}

function openShelfHeftDialog() {
	const o = U.el("overlay");
	if (!o) return;
	const swatches = COVER_PRESETS.map((c, i) =>
		'<button type="button" class="cover-swatch cover-' + c + (i === 0 ? " active" : "") +
		'" data-libnewcover="' + c + '" title="Cover auswählen"></button>').join("");
	S.libNewCover = COVER_PRESETS[0];
	o.innerHTML = '<div class="modal modal-sm lib-create-modal">' +
		'<button class="modal-x" id="btnCloseOverlay" title="Schließen">✕</button>' +
		'<h3>Neues Heft</h3><input id="libHeftName" value="Neues Heft" aria-label="Heftname" autocomplete="off">' +
		'<label class="lib-create-label">Cover</label><div class="cover-grid lib-create-covers">' + swatches + '</div>' +
		'<div class="modal-actions"><button id="btnCloseOverlay">Abbrechen</button><button class="primary" data-libcreateheft="1">Heft erstellen</button></div></div>';
	setTimeout(() => { const inp = U.el("libHeftName"); if (inp) inp.select(); }, 0);
}

// Cover-Picker für bestehende Hefte aus dem GoodNotes-Regal.
function openLibCoverPicker(pageId) {
	const pg = S.pages[pageId];
	if (!pg) return;
	S.libCoverPageId = pageId;
	const o = U.el("overlay");
	if (!o) return;
	const swatches = COVER_PRESETS.map((c) =>
		'<button type="button" class="cover-swatch cover-' + c + (pg.cover === c && !pg.coverImg ? " active" : "") +
		'" data-libcoverset="' + c + '" title="' + c + '"></button>').join("");
	o.hidden = false;
	o.innerHTML = '<div class="modal modal-sm">' +
		'<button class="modal-x" id="btnCloseOverlay" title="Schließen">✕</button>' +
		'<h3>Heftoptionen</h3><p class="hint">„' + U.esc(pg.title || "Heft") + '“</p>' +
		'<div class="cover-grid">' + swatches + "</div>" +
		'<p class="hint">Oder ein eigenes Bild als Deckblatt (wird lokal gespeichert):</p>' +
		'<div class="row-btns"><button type="button" id="btnLibCoverUpload">🖼 Eigenes Bild wählen</button></div>' +
		'<div class="modal-actions">' +
		'<button type="button" data-libcoverset="">Cover entfernen</button>' +
		'<button type="button" class="danger" data-libhefttrash="' + pg.id + '">In Papierkorb</button>' +
		'<button type="button" id="btnCloseOverlay">Schließen</button></div></div>'; 
}

// ---------- Ansichts-Umschalter: 📝 Notion · 📓 GoodNotes · 📥 Gemini Notebook ----------
// Dasselbe Heft existiert nur EINMAL (eine Seiten-ID) — die Ansichten sind nur
// verschiedene Zuordnungen: Notion = Seitenbaum (Hefte als normale Unterseiten),
// GoodNotes = flaches Regal mit Ordnern (= Workspaces), Gemini Notebook = Artefakt-
// Mediathek (Inbox + eingeordnete Downloads). Keine Kopien, nie zwei IDs.
function libModeTabsHtml() {
	const mode = S.libMode || "notion";
	const b = (m, label) => '<button class="lib-mode' + (mode === m ? " active" : "") + '" data-libmode="' + m + '">' + label + "</button>";
	return '<div class="lib-modes">' + b("notion", "📝 Notion") + b("hefte", "📓 GoodNotes") + b("nlm", "📥 Gemini Notebook") + "</div>";
}

export function renderLibrary(main) {
	const mode = S.libMode || "notion";
	if (mode === "hefte") { renderHefteShelf(main); return; }
	if (mode === "nlm") { renderNlmLibrary(main); return; }
	// Notion bleibt ein kompakter Baum: Eltern, Unterseiten und ihre gespeicherte
	// Reihenfolge werden nicht in eine nach Datum sortierte Tabelle aufgelöst.
	renderNotionTree(main);
}

// ---------- Notion-Ansicht: kompakter Seitenbaum, kein Kartenraster ----------
function renderNotionTree(main) {
	const q = (S.libFilter || "").trim().toLowerCase();
	const smart = S.libSmart || null;
	const allPages = STATE.activePages();
	const ownMatch = (pg) => (!smart
		|| (smart === "fav" && pg.favorite)
		|| (smart === "pdf" && pg.pdfId)
		|| (smart === "tpl" && pg.isTemplate)
		|| (smart === "untagged" && !(pg.tags || []).length))
		&& (!S.libTag || (pg.tags || []).includes(S.libTag))
		&& (!q || (pg.title || "").toLowerCase().includes(q)
			|| (pg.tags || []).some((tag) => String(tag).toLowerCase().includes(q)));
	// Bei einer Suche bleiben passende Unterseiten samt ihren Eltern sichtbar.
	const visible = (pg) => ownMatch(pg)
		|| STATE.childrenOf(pg.id, pg.workspaceId).some(visible);
	const walk = (parentId, wsId, depth) => STATE.childrenOf(parentId, wsId)
		.filter(visible)
		.map((pg) => {
			const kids = STATE.childrenOf(pg.id, wsId).filter(visible);
			// Ein-/Ausklappen teilt sich denselben Zustand wie die Sidebar (S.treeOpen) —
			// dieselbe Seite, dieselbe Klapp-Info, nur eine andere Ansicht.
			const collapsed = kids.length > 0 && COLLAPSE.isCollapsed(pg.id);
			const type = pg.kind === "heft" ? "Heft" : "Seite";
			const caret = kids.length
				? '<button class="notion-tree-caret" data-collapse="' + pg.id + '" title="Ein-/Ausklappen">' + (collapsed ? "▸" : "▾") + "</button>"
				: '<span class="notion-tree-caret spacer"></span>';
			const row = '<div class="notion-tree-row" data-page="' + pg.id + '" style="--tree-depth:' + depth + '">' +
				caret +
				'<span class="notion-tree-icon">' + U.esc(RENDER.pageIconLabel(pg)) + "</span>" +
				'<span class="notion-tree-title">' + U.esc(pg.title || "Ohne Titel") + "</span>" +
				'<span class="notion-tree-meta">' + type + " · " + U.fmtDate(pg.updated) + "</span></div>";
			return row + (collapsed ? "" : walk(pg.id, wsId, depth + 1));
		}).join("");
	const wsIds = [...new Set(allPages.map((pg) => pg.workspaceId || "default"))];
	const smartDefs = [["all", "Alle", allPages.length], ["fav", "Favoriten", allPages.filter((p) => p.favorite).length], ["pdf", "PDFs", allPages.filter((p) => p.pdfId).length], ["tpl", "Vorlagen", allPages.filter((p) => p.isTemplate).length]];
	let html = '<div class="library lib-docs lib-notion-tree"><div class="lib-head">' +
		'<div class="lib-head-left"><h1>Bibliothek</h1>' + libModeTabsHtml() + "</div>" +
		'<div class="lib-head-tools"><input id="libFilter" placeholder="Seiten suchen…" autocomplete="off" value="' + U.esc(S.libFilter || "") + '"></div></div>';
	html += '<div class="lib-tabs">' + smartDefs.map(([id, label, n]) =>
		'<button class="lib-tab' + ((smart === id || (!smart && id === "all")) ? " active" : "") + '" data-libsmart="' + id + '">' + U.esc(label) + '<span class="lib-tab-n">' + n + "</span></button>").join("") + "</div>";
	wsIds.forEach((wsId) => {
		const rows = walk(null, wsId, 0);
		if (!rows) return;
		const ws = S.workspaces[wsId] || { name: "Privat" };
		html += '<section class="notion-tree-workspace"><div class="notion-tree-workspace-name">' + U.esc(ws.name) + "</div>" + rows + "</section>";
	});
	if (!html.includes('notion-tree-row')) html += '<div class="empty small">Keine Seiten für diesen Filter</div>';
	main.innerHTML = html + "</div>";
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
		renderMain();
	}
}

// ---------- GoodNotes-Dokumente: eigener Dateibaum, getrennt von Notion ----------
// Hefte behalten ihre Notion-Seite, bekommen hier aber eine unabhängige Ablage.
// Ordner existieren ausschließlich in S.gnFolders und erscheinen nie in Notion.
function gnAncestors(folderId) {
	const out = [];
	let cur = S.gnFolders[folderId];
	const seen = new Set();
	while (cur && !seen.has(cur.id)) { seen.add(cur.id); out.unshift(cur); cur = S.gnFolders[cur.parentId]; }
	return out;
}
function gnContent(folderId, query) {
	const folders = Object.values(S.gnFolders || {}).filter((f) => f.parentId === folderId && (!query || f.title.toLowerCase().includes(query)));
	const hefte = STATE.activePages().filter((p) => p.kind === "heft" && (p.gnFolderId || null) === folderId &&
		(!query || (p.title || "").toLowerCase().includes(query)));
	return folders.map((f) => ({ type: "folder", value: f, order: gnOrder(f) }))
		.concat(hefte.map((p) => ({ type: "heft", value: p, order: gnOrder(p) })))
		.sort((a, b) => a.order - b.order || (a.value.created || "").localeCompare(b.value.created || ""));
}
export function renderHefteShelf(main) {
	const q = (S.libFilter || "").trim().toLowerCase();
	// Alte Workspace-Navigation niemals in den neuen GN-Baum übernehmen.
	const folderId = typeof S.libFolder === "string" && S.gnFolders[S.libFolder] ? S.libFolder : null;
	if (S.libFolder && !folderId) S.libFolder = null;
	const current = folderId ? S.gnFolders[folderId] : null;
	const items = q
		? Object.values(S.gnFolders || {}).filter((f) => f.title.toLowerCase().includes(q)).map((f) => ({ type: "folder", value: f, order: gnOrder(f) }))
			.concat(STATE.activePages().filter((p) => p.kind === "heft" && (p.title || "").toLowerCase().includes(q)).map((p) => ({ type: "heft", value: p, order: gnOrder(p) }))).sort((a, b) => a.order - b.order)
		: gnContent(folderId, "");
	const crumbs = q ? '<span class="lib-crumb current">Suche</span>'
		: '<button class="gn-crumb-root" data-gnroot="1">Dokumente</button>' + gnAncestors(folderId).map((f) =>
			'<span class="lib-crumb-sep">/</span><button class="gn-crumb" data-gnfolder="' + f.id + '">' + U.esc(f.title) + "</button>").join("");
	let html = '<div class="library lib-docs lib-shelf gn-shelf">' +
		'<div class="lib-head"><div class="lib-head-left"><h1>Bibliothek</h1>' + libModeTabsHtml() + "</div>" +
		'<div class="lib-head-tools"><input id="libFilter" placeholder="Suchen" autocomplete="off" value="' + U.esc(S.libFilter || "") + '">' +
		'<button class="lib-new-action" data-libshelfnew="1">+ Neu</button></div></div>' +
		'<div class="lib-crumbs gn-crumbs">' + crumbs + "</div>" +
		'<div class="lib-grid gn-grid" data-gndrop-root="1">' + items.map((item) => item.type === "folder"
			? gnFolderHtml(item.value)
			: libCardHtml(item.value).replace('class="lib-card"', 'class="lib-card gn-card" draggable="true" data-gnitem="p:' + item.value.id + '" data-gnorder="' + item.order + '"'))
			.join("") + "</div>" +
		(items.length ? "" : '<div class="empty small">' + (q ? "Keine Treffer" : (current ? "Dieser Ordner ist leer." : "Noch keine Hefte oder Ordner.")) + "</div>") +
		'<p class="hint lib-shelf-hint">Ziehe Hefte auf Ordner zum Einsortieren. Ziehe Ordner auf Ordner, um Unterordner anzulegen. Die Reihenfolge hier ist unabhängig von Notion.</p></div>';
	main.innerHTML = html;
	hydrateCovers(main);
}

// ---------- Gemini-Notebook-Ansicht (ehemals NotebookLM): Inbox + Mediathek ----------
const NLM_FILTERS = [["all", "Alle"], ["inbox", "📥 Inbox"], ["audio", "🎧 Podcasts"], ["video", "🎬 Videos"], ["mindmap", "🧠 Mind Maps"], ["slides", "📑 Folien"]];
export function renderNlmLibrary(main) {
	main.innerHTML = '<div class="library lib-docs lib-nlm">' +
		'<div class="lib-head"><div class="lib-head-left"><h1>Bibliothek</h1>' + libModeTabsHtml() + "</div></div>" +
		'<div id="nlmLibBody"><div class="empty small">Lade Mediathek…</div></div></div>';
	NLM.listArtifacts().then((list) => {
		const body = U.el("nlmLibBody");
		if (!body) return;
		const filter = S.nlmLibFilter || "all";
		const match = (f) => filter === "all"
			|| (filter === "inbox" && !f.placedPageId)
			|| (filter === "slides" && (f.kind === "slides-pdf" || f.kind === "slides-pptx"))
			|| f.kind === filter;
		const inboxN = list.filter((f) => !f.placedPageId).length;
		const tabs = NLM_FILTERS.map(([id, label]) =>
			'<button class="lib-tab' + (filter === id ? " active" : "") + '" data-nlmfilter="' + id + '">' + label +
			(id === "inbox" && inboxN ? '<span class="lib-tab-n">' + inboxN + "</span>" : "") + "</button>").join("");
		const rows = list.filter(match).map((f) => {
			const src = (f.sourcePageIds || []).map((id) => S.pages[id]).filter((p) => p && !p.trashed);
			const placed = (f.placedPageId && S.pages[f.placedPageId] && !S.pages[f.placedPageId].trashed) ? S.pages[f.placedPageId] : null;
			const sub = placed
				? '📄 eingeordnet in <a href="#" data-nlmgoto="' + placed.id + '">' + U.esc((placed.title || "Ohne Titel").slice(0, 40)) + "</a>"
				: (src.length ? "Quelle: " + U.esc(src.map((p) => p.title || "Ohne Titel").join(", ").slice(0, 60)) : "📥 Inbox — noch nicht eingeordnet");
			return '<div class="nlm-lib-row' + (placed ? "" : " nlm-lib-inbox") + '">' +
				'<span class="nlm-lib-icon">' + NLM.kindIcon(f.kind) + "</span>" +
				'<span class="nlm-lib-main"><span class="nlm-lib-name">' + U.esc(f.name) + "</span>" +
				'<span class="nlm-lib-sub">' + NLM.kindLabel(f.kind) + " · " + U.fmtDate(new Date(f.ts).toISOString()) + (f.size ? " · " + (Math.round(f.size / 1048576 * 10) / 10) + " MB" : "") + " · " + sub + "</span></span>" +
				'<span class="nlm-lib-btns"><button data-nlmlibplay="' + f.id + '" title="Öffnen/Abspielen">▶</button>' +
				'<button data-nlmlibplace="' + f.id + '" title="Einordnen">📌</button>' +
				'<button data-nlmlibsave="' + f.id + '" title="Herunterladen">⬇</button>' +
				'<button data-nlmlibdel="' + f.id + '" title="Löschen">🗑</button></span></div>';
		}).join("");
		body.innerHTML = '<div class="lib-tabs">' + tabs + "</div>" +
			(rows || '<div class="empty small">Noch keine Gemini-Notebook-Dateien — Downloads im 📓-Tab importieren (Knopf oder Drag & Drop), dann erscheinen sie hier.</div>');
	});
}

// Ansichts-Umschalter + NotebookLM-Mediathek: eigene Delegation + Styles
// (kein Eingriff in app.js nötig — gleiche Technik wie extras.js/notebooklm.js).
const libStyle = document.createElement("style");
libStyle.textContent = [
	".lib-modes{display:flex;gap:6px;margin-top:6px}",
	".lib-mode{font-size:12.5px;padding:4px 12px;border-radius:20px;border:1px solid rgba(128,128,128,.3);background:transparent;color:inherit;cursor:pointer}",
	".lib-mode.active{background:#4c8dff;border-color:#4c8dff;color:#fff}",
	".nlm-lib-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid rgba(128,128,128,.22);border-radius:10px;margin-bottom:8px}",
	".nlm-lib-row.nlm-lib-inbox{border-color:rgba(76,141,255,.55);background:rgba(76,141,255,.07)}",
	".nlm-lib-icon{font-size:22px;flex:none}",
	".nlm-lib-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}",
	".nlm-lib-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
	".nlm-lib-sub{font-size:12px;opacity:.65;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
	".nlm-lib-btns{display:flex;gap:4px;flex:none}",
	".nlm-lib-btns button{border:none;background:rgba(128,128,128,.15);border-radius:7px;padding:5px 8px;cursor:pointer;color:inherit}",
	".nlm-lib-btns button:hover{background:rgba(128,128,128,.3)}",
	".lib-shelf-hint{margin-top:14px;opacity:.55}",
	".notion-tree-workspace{margin-top:14px;border-top:1px solid rgba(128,128,128,.18)}",
	".notion-tree-workspace-name{padding:10px 8px 6px;font-size:12px;font-weight:700;opacity:.58;text-transform:uppercase;letter-spacing:.04em}",
	".notion-tree-row{width:100%;display:flex;align-items:center;gap:7px;min-height:34px;padding:6px 10px 6px calc(10px + var(--tree-depth) * 22px);border:0;border-top:1px solid rgba(128,128,128,.1);background:transparent;color:inherit;text-align:left;cursor:pointer}",
	".notion-tree-row:hover{background:rgba(128,128,128,.1)}",
	".notion-tree-caret{width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;opacity:.55;flex:none;border:0;background:transparent;color:inherit;cursor:pointer;border-radius:5px;padding:0}",
	".notion-tree-caret:hover{background:rgba(128,128,128,.18)}",
	".notion-tree-caret.spacer{cursor:default}",
	".notion-tree-caret.spacer:hover{background:transparent}",
	".notion-tree-icon{flex:none}",
	".notion-tree-title{font-weight:560;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
	".notion-tree-meta{margin-left:auto;padding-left:12px;font-size:12px;opacity:.55;white-space:nowrap}",
	".lib-new-action{min-height:34px;padding:5px 12px;border-radius:8px;background:#2783df;color:#fff;font-size:13px;font-weight:650}",
	".lib-new-action:hover{background:#3692ef}",
	".lib-cover-btn{position:absolute;right:5px;bottom:5px;z-index:3;min-height:26px;padding:0 7px;border:1px solid rgba(255,255,255,.22);border-radius:7px;background:rgba(15,16,19,.58);color:#fff;font-size:10px;letter-spacing:1px;opacity:0;cursor:pointer;backdrop-filter:blur(6px);transition:opacity .12s}",
	".lib-card-visual{position:relative}",
	".lib-card:hover .lib-cover-btn,.lib-cover-btn:focus{opacity:1}",
	".lib-create-modal{gap:14px}",
	".lib-create-choices{display:grid;grid-template-columns:1fr 1fr;gap:8px}",
	".lib-create-choices button{min-height:130px;display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:14px;text-align:left;background:var(--surface-subtle);border:1px solid var(--edge-soft);border-radius:10px}",
	".lib-create-choices button:hover{border-color:var(--accent-border);background:var(--accent-soft)}",
	".lib-create-choices span{font-size:24px}.lib-create-choices b{font-size:14px}.lib-create-choices small{font-size:11.5px;color:var(--text2);line-height:1.35}",
	".lib-create-label{font-size:12px;color:var(--text2);font-weight:650;margin-bottom:-7px}",
	".lib-create-covers .cover-swatch.active{outline:2px solid var(--accent);outline-offset:2px}",
	".gn-shelf{max-width:none!important;padding-top:20px}",
	".gn-shelf .lib-head{padding-bottom:14px;border-bottom:1px solid var(--edge-soft);margin-bottom:0}",
	".gn-shelf .lib-head-left .lib-modes{margin-top:6px}",
	".gn-crumbs{margin:14px 0 24px}.gn-crumb-root,.gn-crumb{min-height:0;padding:0;background:transparent;color:var(--text2);font-size:13px}.gn-crumb-root:hover,.gn-crumb:hover{background:transparent;color:var(--text);text-decoration:underline}",
	".gn-folder-more{position:absolute;right:0;bottom:-2px;min-height:24px;padding:0 5px;background:transparent;color:var(--text2);font-size:10px;letter-spacing:1px;opacity:0}.gn-folder{position:relative}.gn-folder:hover .gn-folder-more,.gn-folder-more:focus{opacity:1}.gn-folder-more:hover{color:var(--text);background:var(--surface-hover)}",
	".gn-grid{grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:28px 24px;min-height:180px;align-items:start}",
	".gn-grid.gn-drop-active{outline:2px dashed var(--accent);outline-offset:10px;border-radius:12px}",
	".gn-folder,.gn-card{user-select:none;-webkit-user-select:none}.gn-folder[draggable=true],.gn-card[draggable=true]{cursor:grab}.gn-folder[draggable=true]:active,.gn-card[draggable=true]:active{cursor:grabbing}",
	".gn-card .lib-into{display:none}",
	".gn-folder.gn-drop-target .lib-folder-visual,.gn-card.gn-drop-target .lib-notebook{filter:drop-shadow(0 0 0 2px var(--accent)) drop-shadow(0 10px 22px rgba(76,141,255,.35))}",
	".gn-folder.gn-dragging,.gn-card.gn-dragging{opacity:.35}",
	"@media(max-width:640px){.gn-toolbar{align-items:flex-start;flex-direction:column}.gn-toolbar-actions{width:100%}.gn-toolbar-actions #libFilter{flex:1;min-width:0}.gn-grid{grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:22px 16px}}",
].join("\n");
document.head.appendChild(libStyle);

document.addEventListener("click", async (e) => {
	const hit = (sel) => e.target && e.target.closest && e.target.closest(sel);
	let el;
	if ((el = hit("[data-libmode]"))) { S.libMode = el.dataset.libmode; S.libFolder = null; renderMain(); return; }
	if ((el = hit("[data-libshelfnew]"))) { openShelfNewDialog(); return; }
	if ((el = hit("[data-libnewkind]"))) {
		if (el.dataset.libnewkind === "folder") openShelfFolderDialog();
		else openShelfHeftDialog();
		return;
	}
	if ((el = hit("[data-libnewcover]"))) {
		S.libNewCover = el.dataset.libnewcover;
		document.querySelectorAll("[data-libnewcover]").forEach((x) => x.classList.toggle("active", x.dataset.libnewcover === S.libNewCover));
		return;
	}
	if ((el = hit("[data-libcreatefolder]"))) {
		const inp = U.el("libFolderName");
		const name = inp && inp.value.trim();
		if (!name) { if (inp) inp.focus(); return; }
		await STATE.dispatch("gnFolderCreate", { id: U.uid(), title: name, parentId: typeof S.libFolder === "string" ? S.libFolder : null, order: Date.now() });
		S.libFolder = typeof S.libFolder === "string" ? S.libFolder : null;
		const o = U.el("overlay"); if (o) { o.hidden = true; o.innerHTML = ""; }
		renderMain();
		return;
	}
	if ((el = hit("[data-libcreateheft]"))) {
		const inp = U.el("libHeftName");
		const title = (inp && inp.value.trim()) || "Neues Heft";
		const gnFolderId = typeof S.libFolder === "string" ? S.libFolder : null;
		const id = U.uid();
		await STATE.dispatch("pageCreate", { id, title, parentId: null, content: "", icon: "📓", cover: S.libNewCover || COVER_PRESETS[0], tags: [], workspaceId: S.currentWorkspaceId || "default", gnFolderId, gnOrder: Date.now(), kind: "heft" });
		S.libNewCover = null;
		const o = U.el("overlay"); if (o) { o.hidden = true; o.innerHTML = ""; }
		TABS.openPage(id);
		return;
	}
	if ((el = hit("[data-gnfoldermenu]"))) { e.preventDefault(); e.stopPropagation(); openGnFolderMenu(el.dataset.gnfoldermenu); return; }
	if ((el = hit("[data-gnfolderdelete]"))) {
		const id = el.dataset.gnfolderdelete;
		await STATE.dispatch("gnFolderDelete", { id });
		if (S.libFolder === id) S.libFolder = null;
		const o = U.el("overlay"); if (o) { o.hidden = true; o.innerHTML = ""; }
		renderMain();
		return;
	}
	if ((el = hit("[data-gnroot]"))) { S.libFolder = null; renderMain(); return; }
	if ((el = hit("[data-gnfolder]"))) { S.libFolder = el.dataset.gnfolder; renderMain(); return; }
	if ((el = hit("[data-libcover]"))) {
		e.preventDefault();
		e.stopPropagation();
		openLibCoverPicker(el.dataset.libcover);
		return;
	}
	if ((el = hit("[data-libhefttrash]"))) {
		const pg = S.pages[el.dataset.libhefttrash];
		if (!pg || !await U.confirm('„' + pg.title + '“ in den Papierkorb legen?', { title: "Heft löschen", ok: "In Papierkorb", danger: true })) return;
		await STATE.dispatch("pageTrash", { id: pg.id });
		S.libCoverPageId = null;
		const o = U.el("overlay"); if (o) { o.hidden = true; o.innerHTML = ""; }
		renderMain();
		return;
	}
	if ((el = hit("[data-libcoverset]"))) {
		const pid = S.libCoverPageId;
		const val = el.getAttribute("data-libcoverset"); // "" = entfernen
		S.libCoverPageId = null;
		if (pid && S.pages[pid]) {
			await STATE.dispatch("pageUpdate", {
				id: pid,
				patch: val ? { cover: val, coverImg: null } : { cover: null, coverImg: null },
			});
		}
		const o = U.el("overlay");
		if (o) { o.hidden = true; o.innerHTML = ""; }
		if (S.view === "library") renderMain();
		return;
	}
	if ((el = hit("#btnLibCoverUpload"))) {
		const pid = S.libCoverPageId;
		if (!pid) return;
		const inp = document.createElement("input");
		inp.type = "file";
		inp.accept = "image/*";
		inp.onchange = async () => {
			const file = inp.files && inp.files[0];
			if (!file) return;
			try {
				const buf = await U.readAsBuffer(file);
				const blobId = "cover:" + U.uid();
				await DB.putBlob(blobId, buf, { name: file.name, type: file.type });
				await STATE.dispatch("pageUpdate", { id: pid, patch: { coverImg: blobId, cover: null } });
				S.libCoverPageId = null;
				const o = U.el("overlay");
				if (o) { o.hidden = true; o.innerHTML = ""; }
				if (S.view === "library") renderMain();
			} catch (err) {
				alert("Bild konnte nicht als Cover gesetzt werden: " + (err && err.message ? err.message : err));
			}
		};
		inp.click();
		return;
	}
	if ((el = hit("[data-libnewheft]"))) {
		// Direkt ein Heft anlegen — kein Notion-Seite/GoodNotes-Heft-Dialog im GoodNotes-Regal.
		const folder = S.libFolder || { wsId: Object.keys(S.workspaces)[0] || "default", pageId: null };
		const id = U.uid();
		await STATE.dispatch("pageCreate", {
			id, title: "Neues Heft", parentId: folder.pageId || null, content: "",
			icon: "📓", workspaceId: folder.wsId || Object.keys(S.workspaces)[0] || "default", kind: "heft",
		});
		TABS.openPage(id);
		return;
	}
	if ((el = hit("[data-nlmfilter]"))) { S.nlmLibFilter = el.dataset.nlmfilter; renderMain(); return; }
	if ((el = hit("[data-nlmgoto]"))) { e.preventDefault(); TABS.openPage(el.dataset.nlmgoto); return; }
	if ((el = hit("[data-nlmlibplay]"))) { NLM.playById(el.dataset.nlmlibplay); return; }
	if ((el = hit("[data-nlmlibplace]"))) { NLM.placeById(el.dataset.nlmlibplace); return; }
	if ((el = hit("[data-nlmlibsave]"))) { NLM.saveById(el.dataset.nlmlibsave); return; }
	if ((el = hit("[data-nlmlibdel]"))) {
		if (!confirm("Datei endgültig aus der Mediathek löschen?")) return;
		await NLM.deleteById(el.dataset.nlmlibdel);
		renderMain();
		return;
	}
});

// GoodNotes-Drag-and-drop ist absichtlich vollständig vom globalen Notion-Drag
// getrennt. Es verändert ausschliesslich gnFolderId/gnOrder bzw. gnFolders.
let gnDrag = null;
const clearGnDropState = () => {
	document.querySelectorAll(".gn-drop-target,.gn-dragging").forEach((el) => el.classList.remove("gn-drop-target", "gn-dragging"));
	document.querySelectorAll(".gn-drop-active").forEach((el) => el.classList.remove("gn-drop-active"));
};
const parseGnItem = (raw) => {
	const parts = String(raw || "").split(":");
	return parts.length === 2 && (parts[0] === "f" || parts[0] === "p") ? { type: parts[0], id: parts[1] } : null;
};
function gnTargetParent(item) {
	if (!item) return null;
	return item.type === "f" ? ((S.gnFolders[item.id] || {}).parentId || null) : ((S.pages[item.id] || {}).gnFolderId || null);
}
document.addEventListener("dragstart", (e) => {
	if (S.libMode !== "hefte") return;
	const node = e.target && e.target.closest && e.target.closest("[data-gnitem]");
	const item = node && parseGnItem(node.dataset.gnitem);
	if (!item) return;
	gnDrag = item;
	node.classList.add("gn-dragging");
	e.dataTransfer.effectAllowed = "move";
	e.dataTransfer.setData("text/plain", node.dataset.gnitem);
	// Die globale Notion-DnD-Delegation darf dieses Heft nicht als Notion-Seite
	// interpretieren und damit parentId/workspaceId verändern.
	e.stopImmediatePropagation();
}, true);
document.addEventListener("dragover", (e) => {
	if (!gnDrag || S.libMode !== "hefte") return;
	const folder = e.target && e.target.closest && e.target.closest("[data-gnfolder]");
	const item = e.target && e.target.closest && e.target.closest("[data-gnitem]");
	const root = e.target && e.target.closest && e.target.closest("[data-gndrop-root]");
	if (!folder && !item && !root) return;
	e.preventDefault();
	clearGnDropState();
	if (folder && folder.dataset.gnfolder !== gnDrag.id) folder.classList.add("gn-drop-target");
	else if (item && item.dataset.gnitem !== gnDrag.type + ":" + gnDrag.id) item.classList.add("gn-drop-target");
	else if (root) root.classList.add("gn-drop-active");
	e.dataTransfer.dropEffect = "move";
	e.stopImmediatePropagation();
}, true);
document.addEventListener("drop", async (e) => {
	if (!gnDrag || S.libMode !== "hefte") return;
	const folderNode = e.target && e.target.closest && e.target.closest("[data-gnfolder]");
	const itemNode = e.target && e.target.closest && e.target.closest("[data-gnitem]");
	const root = e.target && e.target.closest && e.target.closest("[data-gndrop-root]");
	if (!folderNode && !itemNode && !root) return;
	e.preventDefault();
	e.stopImmediatePropagation();
	const source = gnDrag;
	gnDrag = null;
	clearGnDropState();
	const targetItem = itemNode && parseGnItem(itemNode.dataset.gnitem);
	// Auf einen Ordner = hineinlegen (Unterordner bzw. Heft in Ordner).
	// Auf ein Heft = davor einsortieren. Freie Fläche = Dokumente-Wurzel.
	let parentId = folderNode ? folderNode.dataset.gnfolder : (targetItem ? gnTargetParent(targetItem) : null);
	if (source.type === "f" && (parentId === source.id || !S.gnFolders[source.id])) return;
	let order = Date.now();
	if (!folderNode && targetItem && itemNode) order = Number(itemNode.dataset.gnorder || Date.now()) - 0.5;
	if (source.type === "f") await STATE.dispatch("gnFolderMove", { id: source.id, parentId, order });
	else await STATE.dispatch("gnItemMove", { id: source.id, folderId: parentId, order });
	if (S.view === "library") renderMain();
}, true);
document.addEventListener("dragend", () => { gnDrag = null; clearGnDropState(); }, true);

export const LIBRARY = {
	exportWorkspaceZip,
	renderLibrary,
	renderHefteShelf,
	renderNlmLibrary,
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