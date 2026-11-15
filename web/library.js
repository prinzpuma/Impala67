"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { DB } from "./db.js";
import { BUS } from "./event-bus.js";
import { TABS } from "./tabs.js";
import { HEFT } from "./heft.js";
import { EXPORT_MEDIA } from "./export-media.js";
import { icon, lead, pageIcon } from "./icons.js";
import { PLATFORM } from "./platform.js";
import { CORE } from "./rust-core.js";

const renderMain = () => BUS.emit("ui:render-main");
const render = (opts) => BUS.emit("ui:render", opts);
const hydrateCovers = (root) => BUS.emit("ui:hydrate-covers", root);

// ---------- GoodNotes Documents: Cover-Presets + Notebook-Regal ----------
export const COVER_PRESETS = ["sunset", "ocean", "forest", "grape", "mono"];

export function defaultCover(pg) {
	return CORE.defaultCover(String(pg?.title || ""), String(pg?.id || ""));
}

export function folderTone(key) {
	return CORE.folderTone(String(key || ""));
}

// Jedes Heft bekommt ein eigenes Cover: die gewählte Farbe gibt die Farbfamilie vor, die Heft-ID
// entscheidet über Farbton, Muster, Platz des Namensschilds und Gummiband. Gleiche ID = gleiches Cover.
const COVER_HUES = { sunset: 18, ocean: 214, forest: 128, grape: 312 };
const COVER_PATTERNS = 8;
function coverLook(pg) {
	const s = String(pg.id || pg.title || "");
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
	const preset = pg.cover || null;
	const hue = preset === "mono" ? 30 : (preset in COVER_HUES ? COVER_HUES[preset] + (h % 37) - 18 : h % 360);
	const sat = preset === "mono" ? 5 : 30 + ((h >>> 6) % 16);
	const light = preset === "mono" ? 20 + ((h >>> 10) % 10) : 40 + ((h >>> 10) % 13);
	return "gen pat-" + ((h >>> 14) % COVER_PATTERNS) + " lab-" + ((h >>> 18) % 3) + ((h >>> 21) % 3 === 0 ? " band" : "") +
		'" style="--ch:' + hue + ";--cs:" + sat + "%;--cl:" + light + "%";
}

// Portrait-Notebook im Schulheft-Stil: Rücken + Stoff-Cover mit hellem Namensschild wie auf einem
// Composition Book. Ein eigenes Bild füllt das ganze Cover ohne Schild – es ist das Gesicht des Hefts.
export function libCoverHtml(pg) {
	const title = (pg.title || "Ohne Titel").trim();
	const spine = '<div class="lib-notebook"><div class="lib-spine" aria-hidden="true"></div>';
	if (pg.coverImg) return spine + '<div class="lib-cover has-img" data-coverimg="' + U.esc(pg.coverImg) + '" role="img" aria-label="' + U.esc(title) + '"></div></div>';
	const short = title.length > 28 ? title.slice(0, 28) + "…" : title;
	const label = '<span class="lib-cover-label"><b>' + U.esc(short) + '</b><i aria-hidden="true"></i><i aria-hidden="true"></i></span>';
	return spine + '<div class="lib-cover ' + coverLook(pg) + '">' + label + "</div></div>";
}

// Notion-Seite als flaches Dokumentblatt (Icon, Titel, erste Textzeile, Linien) —
// bewusst Notion-Look; nur GoodNotes-Hefte bekommen das Notizbuch-Cover.
export function libDocHtml(pg) {
	const pgIcon = pageIcon(pg);
	const firstLine = CORE.mdFirstLine(String(pg.content || ""));
	return '<div class="lib-docsheet">' +
		'<span class="lib-docsheet-icon">' + pgIcon + "</span>" +
		'<span class="lib-docsheet-title">' + U.esc((pg.title || "Ohne Titel").slice(0, 44)) + "</span>" +
		(firstLine ? '<span class="lib-docsheet-text">' + U.esc(firstLine) + "</span>" : "") +
		'<span class="lib-docsheet-lines" aria-hidden="true"><i></i><i></i><i></i></span>' +
	"</div>";
}

// Kachel nach Seitentyp: Heft = GoodNotes-Notizbuch, Notion-Seite = Dokumentblatt.
export function libCardHtml(pg) {
	const fav = pg.favorite ? '<span class="lib-fav" title="Favorit">★</span>' : "";
	const isHeft = pg.kind === "heft";
	const visual = isHeft ? libCoverHtml(pg) : libDocHtml(pg);
	// Ruhiges Kontextmenü statt eines dauerhaften Emoji-Buttons auf dem Cover.
	const coverBtn = isHeft
		? '<button class="lib-cover-btn" data-libcover="' + pg.id + '" title="Heftoptionen" aria-label="Heftoptionen">•••</button>'
		: "";
	const heftPages = STATE.heftMeta(pg.id)?.pages || 1;
	const meta = isHeft
		? "Heft · " + heftPages + " Seite" + (heftPages === 1 ? "" : "n") + " · " + U.fmtDate(pg.updated)
		: U.fmtDate(pg.updated) + (pg.pdfId ? " · PDF" : "");
	return '<div class="lib-card" data-page="' + pg.id + '">' +
		'<div class="lib-card-visual">' + visual + fav + coverBtn + "</div>" +
		'<div class="lib-card-title">' + (pg.isTemplate ? '<span class="lib-tpl">Vorlage</span> ' : "") + U.esc(pg.title) + "</div>" +
		'<div class="lib-card-date">' + meta + "</div></div>";
}

// Eigenständiger GoodNotes-Ordner: kein Workspace, keine Notion-Seite.
function gnFolderHtml(folder, directCount, orderVal) {
	const direct = typeof directCount === "number" ? directCount : STATE.gnFolderDirectCount(folder.id);
	const ord = typeof orderVal === "number" ? orderVal : Number(folder.order || 0);
	const tone = folderTone(folder.id || folder.title);
	return '<div class="lib-folder gn-folder tone-' + tone + '" draggable="true" data-gnfolder="' + U.esc(folder.id) +
		'" data-gnitem="f:' + U.esc(folder.id) + '" data-gnorder="' + ord + '">' +
		'<span class="lib-folder-visual" aria-hidden="true"><span class="lib-folder-tab"></span><span class="lib-folder-body"></span></span>' +
		'<span class="lib-folder-name">' + U.esc(folder.title) + "</span>" +
		'<span class="lib-folder-count">' + direct + (direct === 1 ? " Objekt" : " Objekte") + "</span>" +
		'<button class="gn-folder-more" data-gnfoldermenu="' + U.esc(folder.id) + '" title="Ordneroptionen" aria-label="Ordneroptionen">•••</button></div>';
}

// GoodNotes-artiger Neu-Dialog: eine Aktion, danach klarer Typ statt permanenter
// "Neue Ordner"-Kachel und Eingabezeile in der Bibliothek.
function openShelfNewDialog() {
	const o = U.takeOverlay();
	if (!o) return;
	const currentFolder = typeof S.libFolder === "string" ? S.gnFolders[S.libFolder] : null;
	const where = currentFolder ? "in „" + U.esc(currentFolder.title) + "“" : "in Dokumente";
	o.hidden = false;
	o.innerHTML = '<div class="modal modal-sm lib-create-modal">' +
		'<button class="modal-x" id="btnCloseOverlay" title="Schließen">✕</button>' +
		'<h3>Neu</h3><p class="hint">Was möchtest du ' + where + ' anlegen?</p>' +
		'<div class="lib-create-choices">' +
		'<button type="button" data-libnewkind="heft"><span>' + icon("notebook") + '</span><b>Neues Heft</b><small>Cover wählen und direkt losschreiben</small></button>' +
		'<button type="button" data-libnewkind="folder"><span>' + icon("folder") + '</span><b>Neuer Ordner</b><small>Hefte und weitere Ordner organisieren</small></button>' +
		'</div></div>';
}

function openGnFolderMenu(folderId) {
	const folder = S.gnFolders[folderId];
	const o = U.takeOverlay();
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
	const o = U.takeOverlay();
	if (!o) return;
	o.innerHTML = '<div class="modal modal-sm lib-create-modal">' +
		'<button class="modal-x" id="btnCloseOverlay" title="Schließen">✕</button>' +
		'<h3>Neuer Ordner</h3><p class="hint">Der Ordner erscheint nur in Dokumente, nie im Notion-Baum.</p>' +
		'<input id="libFolderName" placeholder="Ordnername" autocomplete="off">' +
		'<div class="modal-actions"><button id="btnCloseOverlay">Abbrechen</button><button class="primary" data-libcreatefolder="1">Erstellen</button></div></div>';
	const inp = U.el("libFolderName");
	if (inp) inp.focus();
}

function openShelfHeftDialog() {
	const o = U.takeOverlay();
	if (!o) return;
	const swatches = COVER_PRESETS.map((c, i) =>
		'<button type="button" class="cover-swatch cover-' + c + (i === 0 ? " active" : "") +
		'" data-libnewcover="' + c + '" title="Cover auswählen"></button>').join("");
	S.libNewCover = COVER_PRESETS[0];
	S.libNewCoverFile = null;
	o.innerHTML = '<div class="modal modal-sm lib-create-modal">' +
		'<button class="modal-x" id="btnCloseOverlay" title="Schließen">✕</button>' +
		'<h3>Neues Heft</h3><input id="libHeftName" value="Neues Heft" aria-label="Heftname" autocomplete="off">' +
		'<label class="lib-create-label">Eigenes Cover</label><div class="lib-create-img">' +
		'<button type="button" id="btnLibNewCoverImg">' + lead("image") + 'Eigenes Bild wählen</button><span id="libNewCoverImgName" class="hint"></span></div>' +
		'<label class="lib-create-label">Oder eine Farbe</label><div class="cover-grid lib-create-covers">' + swatches + '</div>' +
		'<div class="modal-actions"><button id="btnCloseOverlay">Abbrechen</button><button class="primary" data-libcreateheft="1">Heft erstellen</button></div></div>';
	const inp = U.el("libHeftName");
	if (inp) {
		inp.focus();
		if (!PLATFORM.isTouch()) {
			inp.select();
		} else {
			try {
				const len = inp.value.length;
				inp.setSelectionRange(len, len);
			} catch { /* ignore */ }
		}
	}
}

// Cover-Picker für bestehende Hefte aus dem GoodNotes-Regal.
function openLibCoverPicker(pageId) {
	const pg = S.pages[pageId];
	if (!pg) return;
	S.libCoverPageId = pageId;
	const o = U.takeOverlay();
	if (!o) return;
	const swatches = COVER_PRESETS.map((c) =>
		'<button type="button" class="cover-swatch cover-' + c + (pg.cover === c && !pg.coverImg ? " active" : "") +
		'" data-libcoverset="' + c + '" title="' + c + '"></button>').join("");
	o.hidden = false;
	o.innerHTML = '<div class="modal modal-sm lib-create-modal">' +
		'<button class="modal-x" id="btnCloseOverlay" title="Schließen">✕</button>' +
		'<h3>Heftoptionen</h3><p class="hint">„' + U.esc(pg.title || "Heft") + '“</p>' +
		'<div class="lib-cover-hero"><div class="lib-cover-preview">' + libCoverHtml(pg) + "</div>" +
		'<div class="lib-cover-hero-text"><b>Eigenes Cover</b><p class="hint">' +
		(pg.coverImg ? "Dein Bild ist das Cover dieses Hefts." : "Ein eigenes Bild füllt das ganze Cover – so erkennst du das Heft im Regal sofort.") + "</p>" +
		'<button type="button" class="primary" id="btnLibCoverUpload">' + lead("image") + (pg.coverImg ? "Anderes Bild wählen" : "Eigenes Bild wählen") + "</button></div></div>" +
		'<label class="lib-create-label">' + (pg.coverImg ? "Oder eine Farbe" : "Farbe") + '</label><div class="cover-grid">' + swatches + "</div>" +
		'<div class="modal-actions">' +
		'<button type="button" data-libcoverset="">' + (pg.coverImg ? "Bild entfernen" : "Farbe zurücksetzen") + "</button>" +
		(pg.archived
			? '<button type="button" data-pageunarchive="' + pg.id + '">' + lead("undo") + 'Aus Archiv holen</button>'
			: '<button type="button" data-libheftarchive="' + pg.id + '">' + lead("archive") + 'Archivieren</button>') +
		'<button type="button" class="danger" data-libhefttrash="' + pg.id + '">In Papierkorb</button>' +
		'<button type="button" id="btnCloseOverlay">Schließen</button></div></div>';
	hydrateCovers(o);
}

// ---------- Ansichts-Umschalter: 📝 Notion · 📓 GoodNotes · 🗄 Archiv ----------
// Dasselbe Heft existiert nur EINMAL (eine Seiten-ID) — die Ansichten sind nur
// verschiedene Zuordnungen: Notion = Seitenbaum (Hefte als normale Unterseiten),
// GoodNotes = flaches Regal mit Ordnern (= Workspaces). Keine Kopien, nie zwei IDs.
function libModeTabsHtml() {
	const mode = S.libMode || "notion";
	const b = (m, label) => '<button class="lib-mode' + (mode === m ? " active" : "") + '" data-libmode="' + m + '">' + label + "</button>";
	return '<div class="lib-modes">' + b("notion", lead("note") + "Notion") + b("hefte", lead("notebook") + "GoodNotes") + b("archive", lead("archive") + "Archiv") + "</div>";
}

// Einheitlicher Aufbau aller Bibliotheks-Ansichten: Titel + Modi, darunter eine feste Werkzeugzeile
// (links Filter bzw. Pfad, rechts Suche). Dadurch stehen Suche und Inhalt in jedem Modus gleich.
function libToolbarHtml(left, right) {
	const pages = STATE.activePages();
	const hefte = pages.filter((p) => p.kind === "heft").length;
	const n = (count, one, many) => count + " " + (count === 1 ? one : many);
	const sub = n(pages.length - hefte, "Seite", "Seiten") + " · " + n(hefte, "Heft", "Hefte");
	return '<div class="lib-head"><div class="lib-head-left"><h1>Bibliothek</h1><span class="lib-sub">' + sub + "</span></div></div>" +
		'<div class="lib-top"><div class="lib-bar">' + libModeTabsHtml() + '<div class="lib-head-tools">' + (right || "") + "</div></div>" +
		'<div class="lib-toolbar-left">' + left + "</div></div>";
}
function libSearchHtml(placeholder) {
	return '<label class="lib-search">' + icon("search") +
		'<input id="libFilter" placeholder="' + placeholder + '" autocomplete="off" value="' + U.esc(S.libFilter || "") + '"></label>';
}
// Zeilen-Info rechts: Typ als kleine Marke, daneben das Datum.
function treeMetaHtml(pg, dateLabel) {
	return '<span class="lib-kind">' + (pg.kind === "heft" ? "Heft" : "Seite") + '</span><span class="lib-date">' + dateLabel + "</span>";
}
function treeSectionHtml(name, rows) {
	const count = rows.split('class="notion-tree-row').length - 1;
	return '<section class="notion-tree-workspace"><div class="notion-tree-workspace-name">' + U.esc(name) + "<span>" + count + "</span></div>" +
		'<div class="notion-tree-list">' + rows + "</div></section>";
}

export function renderLibrary(main) {
	const mode = S.libMode || "notion";
	if (mode === "hefte") { renderHefteShelf(main); return; }
	if (mode === "archive") { renderArchiveLibrary(main); return; }
	// Notion bleibt ein kompakter Baum: Eltern, Unterseiten und ihre gespeicherte
	// Reihenfolge werden nicht in eine nach Datum sortierte Tabelle aufgelöst.
	renderNotionTree(main);
}

function renderTreeRowsFromCore(rows, rowMeta, rowActions) {
	return rows.map((r) => {
		const pg = S.pages[r.id];
		if (!pg) return "";
		const caret = r.hasKids
			? '<button class="notion-tree-caret' + (r.collapsed ? "" : " open") + '" data-collapse="' + pg.id + '" title="Ein-/Ausklappen">' + icon("chevron-right") + "</button>"
			: '<span class="notion-tree-caret spacer"></span>';
		return '<div class="notion-tree-row' + (pg.kind === "heft" ? " is-heft" : "") + '" data-page="' + pg.id + '" style="--tree-depth:' + r.depth + '">' +
			caret +
			(pg.coverImg
				? '<span class="notion-tree-icon has-img" data-coverimg="' + U.esc(pg.coverImg) + '"></span>'
				: '<span class="notion-tree-icon">' + pageIcon(pg) + "</span>") +
			'<span class="notion-tree-title">' + U.esc(pg.title || "Ohne Titel") + "</span>" +
			'<span class="notion-tree-meta">' + rowMeta(pg) + "</span>" + (rowActions ? rowActions(pg) : "") + "</div>";
	}).join("");
}

// ---------- Notion-Ansicht: kompakter Seitenbaum aus dem Rust-Kern ----------
function renderNotionTree(main) {
	const q = (S.libFilter || "").trim();
	const smart = S.libSmart || null;
	const res = STATE.libraryNotionTree(smart, S.libTag || null, q);
	const notionMeta = (pg) => treeMetaHtml(pg, U.fmtDate(pg.updated));
	const smartDefs = [["all", "Alle", res.all], ["fav", "Favoriten", res.fav], ["pdf", "PDFs", res.pdf], ["tpl", "Vorlagen", res.tpl]];
	const tabs = '<div class="lib-tabs">' + smartDefs.map(([id, label, n]) =>
		'<button class="lib-tab' + ((smart === id || (!smart && id === "all")) ? " active" : "") + '" data-libsmart="' + id + '">' + U.esc(label) + '<span class="lib-tab-n">' + n + "</span></button>").join("") + "</div>";
	let html = '<div class="library lib-docs lib-notion-tree" data-key="lib:notion">' + libToolbarHtml(tabs, libSearchHtml("Seiten suchen…")) + '<div class="lib-body">';
	for (const sec of res.sections) {
		const rows = renderTreeRowsFromCore(sec.rows, notionMeta);
		if (!rows) continue;
		html += treeSectionHtml(sec.workspaceName, rows);
	}
	if (!html.includes("notion-tree-row")) html += '<div class="empty small">Keine Seiten für diesen Filter</div>';
	U.morph(main, html + "</div></div>");
	hydrateCovers(main);
}

export async function exportWorkspaceZip(wsId) {
	const ws = S.workspaces[wsId];
	const safe = (s) => EXPORT_MEDIA.safeExportName(s || "Ohne Titel", "Seite").slice(0, 80);
	const files = [];
	const used = new Set();
	const assets = new Map();
	const usedAssetNames = new Set();
	const uniqueAssetName = (raw) => {
		const dot = raw.lastIndexOf("."), stem = dot > 0 ? raw.slice(0, dot) : raw, ext = dot > 0 ? raw.slice(dot) : "";
		let name = raw, n = 2;
		while (usedAssetNames.has(name.toLowerCase())) name = stem + " (" + (n++) + ")" + ext;
		usedAssetNames.add(name.toLowerCase());
		return name;
	};
	const addBlobAsset = async (id, preferredName) => {
		if (!id) return null;
		if (assets.has(id)) return assets.get(id);
		const asset = await EXPORT_MEDIA.loadExportAsset(id, preferredName);
		if (!asset) { assets.set(id, null); return null; }
		asset.name = uniqueAssetName(asset.name);
		files.push({ name: "_assets/" + asset.name, text: asset.data });
		assets.set(id, asset);
		return asset;
	};
	const relativeAsset = (depth, asset) => asset ? "../".repeat(depth) + "_assets/" + encodeURI(asset.name) : null;
	const walk = async (parentId, path, depth) => {
		for (const pg of STATE.childrenOf(parentId, wsId)) {
			let base = path + safe(pg.title), n = 2;
			while (used.has(base)) base = path + safe(pg.title) + " (" + (n++) + ")";
			used.add(base);
			const hrefs = new Map();
			for (const ref of EXPORT_MEDIA.mediaReferences(pg.content)) {
				const asset = await addBlobAsset(ref.id, ref.name);
				if (asset) hrefs.set(ref.id, relativeAsset(depth, asset));
			}
			let content = EXPORT_MEDIA.rewriteMediaReferences(pg.content || "", hrefs);
			const additions = [];
			if (pg.coverImg) {
				const cover = await addBlobAsset(pg.coverImg, safe(pg.title) + " Cover");
				if (cover) additions.push("![Cover](" + relativeAsset(depth, cover) + ")");
			}
			if (pg.pdfId) {
				const pdf = await addBlobAsset(pg.pdfId, safe(pg.title) + ".pdf");
				if (pdf) additions.push("[Original-PDF](" + relativeAsset(depth, pdf) + ")");
			}
			if (pg.kind === "heft") {
				const blob = await HEFT.pdfBlob(pg.id);
				if (blob) {
					const name = uniqueAssetName(safe(pg.title) + ".pdf");
					files.push({ name: "_assets/" + name, text: new Uint8Array(await blob.arrayBuffer()) });
					additions.push("[Heft als PDF](" + "../".repeat(depth) + "_assets/" + encodeURI(name) + ")");
				}
			}
			if (additions.length) content = additions.join("\n\n") + (content ? "\n\n" + content : "");
			files.push({ name: base + ".md", text: "# " + pg.title + "\n\n" + content });
			await walk(pg.id, base + "/", depth + 1);
		}
	};
	await walk(null, "", 0);
	if (!files.length) { U.toast("Dieser Ordner hat keine Seiten."); return; }
	U.downloadBlob(safe(ws ? ws.name : "Ordner") + ".zip", U.zip(files));
}

// U.morph lässt das fokussierte Suchfeld samt Cursor stehen (vorher baute innerHTML die
// Ansicht neu: Fokusverlust, auf dem Tablet ging die Tastatur zu, IME-Eingaben brachen ab).
export function handleFilterInput(e) {
	S.libFilter = e.target.value;
	renderLibrary(U.el("main"));
}

export async function handleCreateWorkspace() {
	const inp = document.getElementById("inpWsName");
	const name = inp ? inp.value.trim() : "";
	if (name) {
		await STATE.dispatch("workspaceCreate", { id: U.uid(), name });
	}
}

// ---------- GoodNotes-Dokumente: eigener Dateibaum aus dem Rust-Kern ----------
export function renderHefteShelf(main) {
	const q = (S.libFilter || "").trim();
	const view = STATE.libraryGnShelf(typeof S.libFolder === "string" ? S.libFolder : null, "all", q);
	S.libFolder = view.folderId || null;
	const current = view.folderId ? S.gnFolders[view.folderId] : null;
	const crumbs = q ? '<span class="lib-crumb current">Suche</span>'
		: '<button class="gn-crumb-root" data-gnroot="1">Dokumente</button>' + view.ancestors.map((fid) => {
			const f = S.gnFolders[fid];
			return f ? '<span class="lib-crumb-sep">/</span><button class="gn-crumb" data-gnfolder="' + f.id + '">' + U.esc(f.title) + "</button>" : "";
		}).join("");
	const cards = view.items.map((item) => {
		if (item.kind === "folder") {
			const f = S.gnFolders[item.id];
			return f ? gnFolderHtml(f, item.directCount, item.order) : "";
		}
		const pg = S.pages[item.id];
		return pg ? libCardHtml(pg).replace('class="lib-card"', 'class="lib-card gn-card" draggable="true" data-gnitem="p:' + pg.id + '" data-gnorder="' + item.order + '"') : "";
	}).join("");
	let html = '<div class="library lib-docs lib-shelf gn-shelf" data-key="lib:shelf">' + libToolbarHtml('<div class="lib-crumbs gn-crumbs">' + crumbs + "</div>",
			libSearchHtml("Hefte suchen") +
			'<button class="gn-new" data-libshelfnew="1">' + icon("plus") + "<span>Neu</span></button>") +
		'<div class="lib-body"><div class="lib-grid gn-grid" data-gndrop-root="1">' + cards + "</div>" +
		(view.items.length ? "" : '<div class="empty small">' + (q ? "Keine Treffer" : (current ? "Dieser Ordner ist leer." : "Noch keine Hefte oder Ordner.")) + "</div>") +
		'<p class="hint lib-shelf-hint">Ziehe Hefte auf Ordner zum Einsortieren. Ziehe Ordner auf Ordner, um Unterordner anzulegen. Die Reihenfolge hier ist unabhängig von Notion.</p></div></div>';
	U.morph(main, html);
	hydrateCovers(main);
}

// ---------- Archiv-Ansicht: dieselbe Baum-Struktur aus dem Rust-Kern ----------
export function renderArchiveLibrary(main) {
	const q = (S.libFilter || "").trim();
	const typeFilter = S.libArchiveType || "all";
	const res = STATE.libraryArchiveTree(typeFilter, q);
	const archiveMeta = (pg) => treeMetaHtml(pg, "archiviert " + U.fmtDate(pg.archivedAt || pg.updated));
	const archiveActions = (pg) => '<span class="archive-row-actions">' +
		'<button type="button" class="mini" data-pageunarchive="' + pg.id + '" title="Aus Archiv wiederherstellen">' + lead("undo") + 'Wiederherstellen</button>' +
		'<button type="button" class="mini danger" data-pagetrash="' + pg.id + '" title="In Papierkorb">' + icon("trash") + '</button></span>';
	const filterTabs = [
		["all", "Alle", res.all],
		["hefte", lead("notebook") + "Hefte", res.hefte],
		["pages", lead("note") + "Seiten", res.pages],
	];
	const tabs = '<div class="lib-tabs">' + filterTabs.map(([id, label, n]) =>
		'<button class="lib-tab' + (typeFilter === id ? " active" : "") + '" data-libarchivefilter="' + id + '">' + label + '<span class="lib-tab-n">' + n + "</span></button>").join("") + "</div>";
	let html = '<div class="library lib-docs lib-notion-tree lib-archive" data-key="lib:archive">' + libToolbarHtml(tabs, libSearchHtml("Archiv durchsuchen…")) + '<div class="lib-body">';
	if (!res.all) {
		html += '<div class="empty small">Das Archiv ist leer. Archivierte Hefte und Seiten erscheinen hier und können jederzeit wiederhergestellt werden.</div>';
		U.morph(main, html + "</div></div>");
		return;
	}
	for (const sec of res.sections) {
		const rows = renderTreeRowsFromCore(sec.rows, archiveMeta, archiveActions);
		if (!rows) continue;
		html += treeSectionHtml(sec.workspaceName, rows);
	}
	if (!html.includes("notion-tree-row")) html += '<div class="empty small">Keine Treffer für diese Suche im Archiv.</div>';
	U.morph(main, html + "</div></div>");
	hydrateCovers(main);
}

// Ansichts-Umschalter: eigene Delegation (Styles: css/library.css).

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
		S.libNewCoverFile = null;
		const name = U.el("libNewCoverImgName");
		if (name) name.textContent = "";
		document.querySelectorAll("[data-libnewcover]").forEach((x) => x.classList.toggle("active", x.dataset.libnewcover === S.libNewCover));
		return;
	}
	if ((el = hit("#btnLibNewCoverImg"))) {
		// Eigenes Bild hat Vorrang vor der Farbe; gespeichert wird es erst beim Erstellen.
		const file = await U.pickImageFile();
		if (!file) return;
		S.libNewCoverFile = file;
		const name = U.el("libNewCoverImgName");
		if (name) name.textContent = file.name;
		document.querySelectorAll("[data-libnewcover]").forEach((x) => x.classList.remove("active"));
		return;
	}
	if ((el = hit("[data-libcreatefolder]"))) {
		const inp = U.el("libFolderName");
		const name = inp && inp.value.trim();
		if (!name) { if (inp) inp.focus(); return; }
		await STATE.dispatch("gnFolderCreate", { id: U.uid(), title: name, parentId: typeof S.libFolder === "string" ? S.libFolder : null, order: Date.now() });
		S.libFolder = typeof S.libFolder === "string" ? S.libFolder : null;
		U.closeOverlay();
		renderMain();
		return;
	}
	if ((el = hit("[data-libcreateheft]"))) {
		const inp = U.el("libHeftName");
		const title = (inp && inp.value.trim()) || "Neues Heft";
		const gnFolderId = typeof S.libFolder === "string" ? S.libFolder : null;
		const id = U.uid();
		let coverImg = null;
		if (S.libNewCoverFile) {
			try {
				coverImg = "cover:" + U.uid();
				await DB.putBlob(coverImg, await U.readAsBuffer(S.libNewCoverFile), { name: S.libNewCoverFile.name, type: S.libNewCoverFile.type });
			} catch (err) {
				coverImg = null;
				U.toast("Bild konnte nicht als Cover gesetzt werden: " + (err && err.message ? err.message : err), "error");
			}
		}
		await STATE.dispatch("pageCreate", { id, title, parentId: null, content: "", cover: coverImg ? null : (S.libNewCover || COVER_PRESETS[0]), coverImg, tags: [], workspaceId: S.currentWorkspaceId || "default", gnFolderId, gnOrder: Date.now(), kind: "heft" });
		S.libNewCover = null;
		S.libNewCoverFile = null;
		U.closeOverlay();
		TABS.openPage(id);
		return;
	}
	if ((el = hit("[data-gnfoldermenu]"))) { e.preventDefault(); e.stopPropagation(); openGnFolderMenu(el.dataset.gnfoldermenu); return; }
	if ((el = hit("[data-gnfolderdelete]"))) {
		const id = el.dataset.gnfolderdelete;
		await STATE.dispatch("gnFolderDelete", { id });
		if (S.libFolder === id) S.libFolder = null;
		U.closeOverlay();
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
	if ((el = hit("[data-libheftarchive]"))) {
		const pg = S.pages[el.dataset.libheftarchive];
		if (!pg) return;
		await STATE.dispatch("pageArchive", { id: pg.id });
		U.toast("Heft archiviert.", "success");
		S.libCoverPageId = null;
		U.closeOverlay();
		renderMain();
		return;
	}
	if ((el = hit("[data-libarchivefilter]"))) {
		S.libArchiveType = el.dataset.libarchivefilter;
		renderMain();
		return;
	}
	if ((el = hit("[data-libhefttrash]"))) {
		const pg = S.pages[el.dataset.libhefttrash];
		if (!pg || !await U.confirm('„' + pg.title + '“ in den Papierkorb legen?', { title: "Heft löschen", ok: "In Papierkorb", danger: true })) return;
		await STATE.dispatch("pageTrash", { id: pg.id });
		S.libCoverPageId = null;
		U.closeOverlay();
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
		U.closeOverlay();
		if (S.view === "library") renderMain();
		return;
	}
	if ((el = hit("#btnLibCoverUpload"))) {
		const pid = S.libCoverPageId;
		if (!pid) return;
		// U.pickImageFile: gemeinsamer Datei-Dialog (siehe auch app.js).
		const file = await U.pickImageFile();
		if (!file) return;
		try {
			const buf = await U.readAsBuffer(file);
			const blobId = "cover:" + U.uid();
			await DB.putBlob(blobId, buf, { name: file.name, type: file.type });
			await STATE.dispatch("pageUpdate", { id: pid, patch: { coverImg: blobId, cover: null } });
			S.libCoverPageId = null;
			U.closeOverlay();
			if (S.view === "library") renderMain();
		} catch (err) {
			U.toast("Bild konnte nicht als Cover gesetzt werden: " + (err && err.message ? err.message : err), "error");
		}
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
	libCardHtml,
	libDocHtml,
	libCoverHtml,
	folderTone,
	defaultCover,
	COVER_PRESETS,
	handleFilterInput,
	handleCreateWorkspace
};
