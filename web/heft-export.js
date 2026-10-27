"use strict";
import { S } from "./state.js";
import { U } from "./util.js";
import { icon } from "./icons.js";
import { CORE } from "./rust-core.js";

// FIX unscharfe Exporte: vorher 1600px Breite (~190 dpi auf A4) — jetzt 300 dpi.
export const EXPORT_W = 2480;

export const exportName = (pageId, pages = (S && S.pages) || {}) => CORE.heftExportName(pages[pageId]?.title ? String(pages[pageId].title) : undefined);

export const exportIdxs = (d, indices) =>
	(indices && indices.length ? indices : (d && d.pages ? d.pages.map((_, i) => i) : []));

export function dataUrlBytes(du) {
	const bin = atob(du.slice(du.indexOf(",") + 1));
	const u = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
	return u;
}

// PDF aus JPEG-Seitenbildern ({ dataUrl, w, h }), A4, zentriert (Rust-Kern).
export function buildPdf(shots) {
	const jpgs = shots.map((sh) => dataUrlBytes(sh.dataUrl));
	const all = new Uint8Array(jpgs.reduce((n, j) => n + j.length, 0));
	let at = 0;
	for (const j of jpgs) { all.set(j, at); at += j.length; }
	return CORE.heftBuildPdf(all, Uint32Array.from(jpgs, (j) => j.length), Uint32Array.from(shots, (sh) => sh.w), Uint32Array.from(shots, (sh) => sh.h));
}

const nextFrame = () => typeof requestAnimationFrame === "function"
	? new Promise((r) => requestAnimationFrame(r))
	: new Promise((r) => setTimeout(r, 0));

export async function pdfBlob(pageId, indices, onStatus, { loadDoc, renderCanvas } = {}) {
	const d = (typeof pageId === "object" && pageId !== null && Array.isArray(pageId.pages))
		? pageId
		: (loadDoc ? await loadDoc(pageId) : null);
	if (!d || !renderCanvas) return null;
	const idxs = exportIdxs(d, indices);
	const shots = [];
	for (let n = 0; n < idxs.length; n++) {
		const i = idxs[n];
		if (onStatus) onStatus("Erzeuge Seite " + (n + 1) + " von " + idxs.length + " …");
		const c = renderCanvas(d.pages[i], EXPORT_W);
		shots.push({ dataUrl: c.toDataURL("image/jpeg", 0.95), w: c.width, h: c.height });
		await nextFrame(); // 300-dpi-Seiten sind teuer — UI zwischen den Seiten atmen lassen
	}
	return new Blob([buildPdf(shots)], { type: "application/pdf" });
}

export async function imageFiles(pageId, indices, baseName, onStatus, { loadDoc, renderCanvas } = {}) {
	const d = (typeof pageId === "object" && pageId !== null && Array.isArray(pageId.pages))
		? pageId
		: (loadDoc ? await loadDoc(pageId) : null);
	if (!d || !renderCanvas) return [];
	const idxs = exportIdxs(d, indices);
	const files = [];
	for (let n = 0; n < idxs.length; n++) {
		const i = idxs[n];
		if (onStatus) onStatus("Erzeuge Bild " + (n + 1) + " von " + idxs.length + " …");
		const c = renderCanvas(d.pages[i], EXPORT_W);
		files.push(new File([dataUrlBytes(c.toDataURL("image/png"))], baseName + "-seite-" + (i + 1) + ".png", { type: "image/png" }));
		await nextFrame();
	}
	return files;
}

export async function exportPdf(pageId, indices, { loadDoc, renderCanvas, download = U.downloadBlob, toast = U.toast } = {}) {
	const blob = await pdfBlob(pageId, indices, null, { loadDoc, renderCanvas });
	if (!blob) return;
	if (download) download(exportName(pageId) + ".pdf", blob);
	const d = (typeof pageId === "object" && pageId !== null && Array.isArray(pageId.pages))
		? pageId
		: (loadDoc ? await loadDoc(pageId) : null);
	const idxs = d ? exportIdxs(d, indices) : [];
	if (toast) toast("PDF mit " + idxs.length + " Seite(n) gespeichert");
}

// Alle Stift-Striche der App als Rohdaten (Punkte), z. B. als Trainingsdaten für die Handschrift-Erkennung.
// Nur Seiten mit Strichen; `index` ist die Seitennummer im Heft (ab 0).
export function allInk(state = S, trainingSamples = []) {
	const notebooks = [];
	for (const [pageId, doc] of Object.entries((state && state.heftDocs) || {})) {
		const pages = ((doc && doc.pages) || [])
			.map((pg, index) => ({ index, id: pg.id, paper: pg.paper, ocrText: pg.ocrText || "", strokes: pg.strokes || [] }))
			.filter((pg) => pg.strokes.length);
		if (pages.length) notebooks.push({ pageId, title: (state.pages && state.pages[pageId] && state.pages[pageId].title) || "Heft", pages });
	}
	const strokeCount = notebooks.reduce((n, nb) => n + nb.pages.reduce((m, pg) => m + pg.strokes.length, 0), 0);
	return { format: "impala67-ink", version: 1, exportedAt: new Date().toISOString(), strokeCount, notebooks, trainingSamples };
}

export async function deliverExport(files, download = U.downloadBlob) {
	let canShare = false;
	try { canShare = !!(typeof navigator !== "undefined" && navigator.share && navigator.canShare?.({ files })); } catch { /* Download-Fallback */ }
	if (canShare) {
		try { await navigator.share({ title: "Impala67 Heft", files }); return "shared"; }
		catch (error) { if (error && error.name === "AbortError") return "cancelled"; }
	}
	for (let i = 0; i < files.length; i++) {
		if (download) download(files[i].name, files[i]);
		if (i < files.length - 1) await new Promise((r) => setTimeout(r, 350));
	}
	return "saved";
}

export function openExportDialog({
	pageId,
	indices,
	defaultName = exportName(pageId),
	title = (S && S.pages && S.pages[pageId] && S.pages[pageId].title) || "Heft",
	createPdfBlob,
	createImageFiles,
	deliver = deliverExport,
	transferOverlay,
	closeTransferOverlay,
	toast = U.toast,
}) {
	const body = '<div class="heft-transfer-summary"><span>' + icon("upload") + '</span><div><small>Auswahl</small><b>' + indices.length + (indices.length === 1 ? ' Seite' : ' Seiten') + '</b><em>' + U.esc(title) + '</em></div></div>' +
		'<div class="heft-transfer-field"><label for="heftExportName">Dateiname</label><input id="heftExportName" value="' + U.esc(defaultName) + '"></div><h3>Format</h3><div class="heft-transfer-formats">' +
		'<label><input type="radio" name="heftExportFormat" value="pdf" checked><span><b>PDF-Dokument</b><small>Alle ausgewählten Seiten in einer Datei</small></span><i>✓</i></label>' +
		'<label><input type="radio" name="heftExportFormat" value="images"><span><b>Einzelne Bilder</b><small>Eine PNG-Datei pro ausgewählter Seite</small></span><i>✓</i></label></div>';
	const o = transferOverlay("Heft exportieren", "Format prüfen und anschließend teilen", body, '<button type="button" data-hetransfercancel="1">Abbrechen</button><button type="button" class="primary" data-hetransferexport="1">Exportieren</button>');
	o.querySelector("[data-hetransfercancel]").addEventListener("click", closeTransferOverlay);
	o.querySelector("[data-hetransferexport]").addEventListener("click", async (e) => {
		const button = e.currentTarget, label = button.textContent, format = o.querySelector('input[name="heftExportFormat"]:checked').value;
		const name = (o.querySelector("#heftExportName").value || defaultName).replace(/[\\/:*?"<>|#]/g, "_").trim().slice(0, 80) || defaultName;
		button.disabled = true; button.textContent = "Wird erstellt …";
		try {
			let files;
			if (format === "pdf") {
				const blob = await createPdfBlob(pageId, indices, (s) => { button.textContent = s; });
				files = [new File([blob], name + ".pdf", { type: "application/pdf" })];
			} else {
				files = await createImageFiles(pageId, indices, name, (s) => { button.textContent = s; });
			}
			const result = await deliver(files);
			if (result !== "cancelled") {
				closeTransferOverlay();
				if (toast) toast(result === "shared" ? "Export geteilt" : "Export gespeichert", "success");
			} else {
				button.disabled = false;
				button.textContent = label;
			}
		} catch (error) {
			button.disabled = false;
			button.textContent = label;
			if (toast) toast("Export fehlgeschlagen: " + ((error && error.message) || error), "error");
		}
	});
	return o;
}
