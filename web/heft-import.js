"use strict";

import { S } from "./state.js";
import { U } from "./util.js";
import { PDFS } from "./pdfs.js";
import { insertAt } from "./heft-pages-core.js";
import { PAGE_W, PAGE_H } from "./heft-document-core.js";

// heft-import.js — Datei-, Bild- und PDF-Import sowie Dialoge für Hefte

export function filePick({ accept = "image/*", multiple = false, capture = false } = {}, cb) {
	const inp = Object.assign(document.createElement("input"), { type: "file", accept, multiple });
	if (capture) inp.setAttribute("capture", "environment"); // öffnet auf Tablets/Handys direkt die Kamera
	inp.onchange = () => {
		const files = Array.from(inp.files || []);
		if (files.length) cb(multiple ? files : files[0]);
	};
	inp.click();
}

export const pickImage = (capture, cb) => filePick({ capture }, cb);

export const niceBytes = (bytes) =>
	bytes < 1024 * 1024
		? Math.max(1, Math.round(bytes / 1024)) + " KB"
		: (bytes / 1024 / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " MB";

export function transferOverlay(title, subtitle, body, actions) {
	const o = U.el("overlay");
	if (!o) return null;
	o.hidden = false;
	o.innerHTML =
		'<section class="heft-transfer" role="dialog" aria-modal="true"><header><div><h2>' +
		U.esc(title) +
		'</h2><p>' +
		U.esc(subtitle) +
		'</p></div><button type="button" id="btnCloseOverlay" aria-label="Schließen">×</button></header><div class="heft-transfer-body">' +
		body +
		'</div><footer>' +
		actions +
		'</footer></section>';
	return o;
}

export function closeTransferOverlay() {
	const o = U.el("overlay");
	if (o) o.hidden = true;
}

export function fileToImageData(f, maxDim, mime = "image/jpeg", quality = 0.86) {
	return new Promise((resolve, reject) => {
		const r = new FileReader();
		r.onerror = () => reject(new Error("Datei lesen fehlgeschlagen"));
		r.onload = () => {
			const img = new Image();
			img.onload = () => {
				let w = img.naturalWidth, h = img.naturalHeight;
				const k = Math.min(1, maxDim / Math.max(w, h));
				w = Math.max(1, Math.round(w * k));
				h = Math.max(1, Math.round(h * k));
				const c = document.createElement("canvas");
				c.width = w;
				c.height = h;
				const x = c.getContext("2d");
				x.fillStyle = "#fff";
				x.fillRect(0, 0, w, h);
				x.drawImage(img, 0, 0, w, h);
				resolve({ src: mime === "image/png" ? c.toDataURL("image/png") : c.toDataURL(mime, quality), w, h });
			};
			img.onerror = () => reject(new Error("Bild dekodieren fehlgeschlagen"));
			img.src = r.result;
		};
		r.readAsDataURL(f);
	});
}

export function imagePage(im, paper, bleed, {
	blobRef = (src) => src,
	newPage = (p) => ({ id: U.uid(), paper: p || "lined", strokes: [], images: [], texts: [], ocrText: "" }),
	pageW = PAGE_W,
	pageH = PAGE_H
} = {}) {
	const pg = newPage(paper || "blank");
	const pad = bleed ? 0 : 40;
	const k = Math.min((pageW - pad * 2) / im.w, (pageH - pad * 2) / im.h);
	const ref = im.ref || blobRef(im.src);
	(pg.images || (pg.images = [])).push({
		id: U.uid(),
		ref,
		x: (pageW - im.w * k) / 2,
		y: (pageH - im.h * k) / 2,
		w: im.w * k,
		h: im.h * k,
		...(im.scan ? { scan: true } : {})
	});
	return pg;
}

export async function insertImageFile(f, {
	getPage,
	getIdx,
	blobRef = (src) => src,
	pushUndo,
	onInserted,
	pageW = PAGE_W,
	pageH = PAGE_H,
	toast = U.toast
} = {}) {
	try {
		const pg = typeof getPage === "function" ? getPage() : getPage;
		if (!pg) return null;
		const pageIdx = typeof getIdx === "function" ? getIdx() : getIdx;
		const im = await fileToImageData(f, 1400);
		const k = Math.min((pageW * 0.7) / im.w, (pageH * 0.7) / im.h, 1);
		const ref = im.ref || blobRef(im.src);
		const img = {
			id: U.uid(),
			ref,
			x: (pageW - im.w * k) / 2,
			y: (pageH - im.h * k) / 2,
			w: im.w * k,
			h: im.h * k
		};
		(pg.images || (pg.images = [])).push(img);
		if (pushUndo) pushUndo({ kind: "imgAdd", img, pageIdx });
		if (onInserted) onInserted({ img, pageIdx });
		return img;
	} catch (e) {
		console.warn("Heft: Bild einfügen fehlgeschlagen", e);
		if (toast) toast("Bild konnte nicht eingefügt werden", "error");
		return null;
	}
}

export async function addImagePageFromFile(f, {
	getPage,
	addPageAt,
	blobRef,
	newPage,
	pageW = PAGE_W,
	pageH = PAGE_H
} = {}) {
	try {
		const im = await fileToImageData(f, 1600);
		const pg = typeof getPage === "function" ? getPage() : getPage;
		const paper = pg ? pg.paper : "blank";
		const newPg = imagePage(im, paper, false, { blobRef, newPage, pageW, pageH });
		if (addPageAt) addPageAt(null, newPg);
		return newPg;
	} catch (e) {
		console.warn("Heft: Bild-Seite fehlgeschlagen", e);
		return null;
	}
}

export async function importPdf(f, at, targetDoc, {
	blobRef,
	newPage,
	pageW = PAGE_W,
	pageH = PAGE_H,
	pdfs = PDFS,
	toast = U.toast
} = {}) {
	try {
		await pdfs.ensureLoaded();
	} catch (e) {
		if (toast) toast("PDF-Engine konnte nicht geladen werden: " + ((e && e.message) || e), "error");
		return at;
	}
	const pdf = await pdfs.openDocument(await f.arrayBuffer());
	for (let i = 1; i <= pdf.numPages; i++) {
		const p = await pdf.getPage(i);
		const vp = p.getViewport({ scale: 3 });
		const c = document.createElement("canvas");
		c.width = Math.round(vp.width);
		c.height = Math.round(vp.height);
		const cx = c.getContext("2d");
		cx.fillStyle = "#fff";
		cx.fillRect(0, 0, c.width, c.height);
		await p.render({ canvasContext: cx, viewport: vp }).promise;

		const pg = imagePage(
			{ src: c.toDataURL("image/jpeg", 0.92), w: c.width, h: c.height },
			"blank",
			true,
			{ blobRef, newPage, pageW, pageH }
		);
		targetDoc.pages.splice(at, 0, pg);
		at++;
	}
	return at;
}

export async function importFilesIntoHeft(targetId, files, position, onStatus, {
	getActiveDoc = () => null,
	getActivePid = () => null,
	getActiveIdx = () => 0,
	loadDoc,
	persistDoc,
	rebuildScroll,
	go,
	blobRef,
	newPage,
	pageW = PAGE_W,
	pageH = PAGE_H,
	pdfs = PDFS,
	toast = U.toast
} = {}) {
	const activePid = typeof getActivePid === "function" ? getActivePid() : getActivePid;
	const activeDoc = typeof getActiveDoc === "function" ? getActiveDoc() : getActiveDoc;
	const activeIdx = typeof getActiveIdx === "function" ? getActiveIdx() : getActiveIdx;

	const targetDoc = (targetId === activePid && activeDoc)
		? activeDoc
		: (loadDoc ? await loadDoc(targetId) : null);
	if (!targetDoc) throw new Error("Ziel-Heft konnte nicht geöffnet werden.");
	const current = targetId === activePid ? activeIdx : Math.max(0, (targetDoc.pages ? targetDoc.pages.length : 1) - 1);
	let at = insertAt(position, current, targetDoc.pages.length);
	for (const f of files) {
		if (onStatus) onStatus("Importiere " + f.name + " …");
		const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
		if (isPdf) {
			at = await importPdf(f, at, targetDoc, { blobRef, newPage, pageW, pageH, pdfs, toast });
		} else if (f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(f.name)) {
			const im = await fileToImageData(f, 1600);
			const pg = imagePage(im, "blank", false, { blobRef, newPage, pageW, pageH });
			targetDoc.pages.splice(at, 0, pg);
			at++;
		}
	}
	if (persistDoc) await persistDoc(targetId, targetDoc);
	if (targetId === activePid && activeDoc === targetDoc) {
		if (rebuildScroll) rebuildScroll();
		if (go) go(Math.max(0, at - 1));
	}
	return at;
}

export function openImportDialog(files, initialHeftId, {
	importFiles,
	getActivePid = () => null,
	pages = (S && S.pages) || {},
	pdfs = PDFS,
	toast = U.toast,
	transferOverlay: makeOverlay = transferOverlay,
	closeTransferOverlay: hideOverlay = closeTransferOverlay,
	...importOpts
} = {}) {
	files = Array.from(files || []).filter(Boolean);
	if (!files.length) return null;
	const resolvedInitialId = initialHeftId !== undefined
		? initialHeftId
		: (typeof getActivePid === "function" ? getActivePid() : getActivePid);
	const onlyPdfs = files.every((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
	const hefts = Object.values(pages || {}).filter((pg) => pg && !pg.trashed && pg.kind === "heft");
	const destinations =
		(onlyPdfs ? '<option value="notes">Als neue Notiz-Seite(n)</option>' : "") +
		hefts
			.map((pg) => '<option value="heft:' + U.esc(pg.id) + '"' + (pg.id === resolvedInitialId ? ' selected' : '') + '>' + U.esc(pg.title || "Heft") + '</option>')
			.join("");
	const rows = files
		.map((f) => '<div class="heft-transfer-file"><span>' + (f.type === "application/pdf" || /\.pdf$/i.test(f.name) ? "PDF" : "IMG") + '</span><div><b>' + U.esc(f.name) + '</b><small>' + niceBytes(f.size || 0) + '</small></div></div>')
		.join("");
	const body =
		'<div class="heft-transfer-files">' + rows + '</div><div class="heft-transfer-field"><label for="heftImportTarget">Ort</label><select id="heftImportTarget">' + destinations + '</select></div>' +
		'<div class="heft-transfer-field" id="heftImportPositionWrap"><label for="heftImportPosition">Einfügen</label><select id="heftImportPosition"><option value="after">Nach der aktuellen Seite</option><option value="before">Vor der aktuellen Seite</option><option value="start">Am Anfang</option><option value="end">Am Ende</option></select></div>' +
		'<p class="heft-transfer-hint">PDF-Seiten werden als unveränderliche Heftseiten eingefügt. Als Notiz entsteht pro PDF eine eigene Seite mit durchsuchbarem Inhalt.</p>';
	const o = makeOverlay(
		"In Impala67 importieren",
		files.length + (files.length === 1 ? " Datei" : " Dateien") + " ausgewählt",
		body,
		'<button type="button" data-hetransfercancel="1">Abbrechen</button><button type="button" class="primary" data-hetransferimport="1">Importieren</button>'
	);
	if (!o) return null;
	const target = o.querySelector("#heftImportTarget");
	const positionWrap = o.querySelector("#heftImportPositionWrap");
	const syncTarget = () => { if (positionWrap) positionWrap.hidden = target.value === "notes"; };
	if (target) {
		target.addEventListener("change", syncTarget);
		syncTarget();
	}
	const cancelBtn = o.querySelector("[data-hetransfercancel]");
	if (cancelBtn) cancelBtn.addEventListener("click", hideOverlay);
	const closeBtn = o.querySelector("#btnCloseOverlay");
	if (closeBtn) closeBtn.addEventListener("click", hideOverlay);

	const importBtn = o.querySelector("[data-hetransferimport]");
	if (importBtn) {
		importBtn.addEventListener("click", async (e) => {
			const button = e.currentTarget, label = button.textContent;
			button.disabled = true;
			button.textContent = "Importiere …";
			try {
				if (target && target.value === "notes") {
					for (const file of files) await pdfs.ingest(file, (message) => { button.textContent = message; });
				} else {
					const targetId = target ? target.value.replace(/^heft:/, "") : "";
					const position = o.querySelector("#heftImportPosition") ? o.querySelector("#heftImportPosition").value : "after";
					if (importFiles) {
						await importFiles(targetId, files, position, (message) => { button.textContent = message; });
					} else {
						await importFilesIntoHeft(targetId, files, position, (message) => { button.textContent = message; }, {
							getActivePid,
							toast,
							pdfs,
							...importOpts
						});
					}
				}
				hideOverlay();
				if (toast) toast("Import abgeschlossen", "success");
			} catch (error) {
				button.disabled = false;
				button.textContent = label;
				if (toast) toast("Import fehlgeschlagen: " + ((error && error.message) || error), "error");
			}
		});
	}
	return o;
}

export function importFiles({
	pickFiles = filePick,
	openDialog = openImportDialog,
	getPid = () => null
} = {}) {
	pickFiles({ accept: "image/*,application/pdf", multiple: true }, (files) => {
		const initialId = typeof getPid === "function" ? getPid() : getPid;
		if (openDialog) openDialog(files, initialId);
	});
}
