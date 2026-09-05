"use strict";
import { S } from "./state.js";
import { U } from "./util.js";

// FIX unscharfe Exporte: vorher 1600px Breite (~190 dpi auf A4) — jetzt 300 dpi.
export const EXPORT_W = 2480;

export const exportName = (pageId, pages = (S && S.pages) || {}) =>
	(String((pages[pageId] && pages[pageId].title) || "Heft").replace(/[\\/:*?"<>|#]/g, "_").trim().slice(0, 80) || "Heft");

export const exportIdxs = (d, indices) =>
	(indices && indices.length ? indices : (d && d.pages ? d.pages.map((_, i) => i) : []));

export function dataUrlBytes(du) {
	const bin = atob(du.slice(du.indexOf(",") + 1));
	const u = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
	return u;
}

export function buildPdf(shots) {
	const tenc = new TextEncoder();
	const parts = [];
	const offsets = [];
	let len = 0;
	const push = (u8) => { parts.push(u8); len += u8.length; };
	const pushStr = (s) => push(tenc.encode(s));
	const A4W = "595.28", A4H = "841.89";
	pushStr("%PDF-1.4\n");
	const n = shots.length;
	const pageObj = (i) => 3 + i * 3, imgObj = (i) => 4 + i * 3, cntObj = (i) => 5 + i * 3;
	const obj = (num, body) => { offsets[num] = len; pushStr(num + " 0 obj\n" + body + "\nendobj\n"); };
	obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
	obj(2, "<< /Type /Pages /Kids [" + shots.map((_, i) => pageObj(i) + " 0 R").join(" ") + "] /Count " + n + " >>");
	shots.forEach((sh, i) => {
		const k = Math.min(595.28 / sh.w, 841.89 / sh.h);
		const w = sh.w * k, h = sh.h * k, ox = (595.28 - w) / 2, oy = (841.89 - h) / 2;
		obj(pageObj(i), "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + A4W + " " + A4H + "] " +
			"/Resources << /XObject << /Im" + i + " " + imgObj(i) + " 0 R >> >> /Contents " + cntObj(i) + " 0 R >>");
		const jpg = dataUrlBytes(sh.dataUrl);
		offsets[imgObj(i)] = len;
		pushStr(imgObj(i) + " 0 obj\n<< /Type /XObject /Subtype /Image /Width " + sh.w + " /Height " + sh.h +
			" /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + jpg.length + " >>\nstream\n");
		push(jpg);
		pushStr("\nendstream\nendobj\n");
		const cs = "q " + w.toFixed(2) + " 0 0 " + h.toFixed(2) + " " + ox.toFixed(2) + " " + oy.toFixed(2) + " cm /Im" + i + " Do Q";
		obj(cntObj(i), "<< /Length " + cs.length + " >>\nstream\n" + cs + "\nendstream");
	});
	const xrefAt = len;
	const count = 3 + n * 3;
	let xref = "xref\n0 " + count + "\n0000000000 65535 f \n";
	for (let i = 1; i < count; i++) xref += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
	pushStr(xref + "trailer\n<< /Size " + count + " /Root 1 0 R >>\nstartxref\n" + xrefAt + "\n%%EOF");
	const out = new Uint8Array(len);
	let o = 0;
	parts.forEach((p) => { out.set(p, o); o += p.length; });
	return out;
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

export async function exportImages(pageId, indices, { loadDoc, renderCanvas, download = U.downloadBlob, toast = U.toast } = {}) {
	const files = await imageFiles(pageId, indices, exportName(pageId), null, { loadDoc, renderCanvas });
	for (let n = 0; n < files.length; n++) {
		if (download) download(files[n].name, files[n]);
		if (n < files.length - 1) await new Promise((r) => setTimeout(r, 350));
	}
	const idxs = files;
	if (toast) toast(idxs.length + " Bild(er) gespeichert");
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
	const body = '<div class="heft-transfer-summary"><span>↗</span><div><small>Auswahl</small><b>' + indices.length + (indices.length === 1 ? ' Seite' : ' Seiten') + '</b><em>' + U.esc(title) + '</em></div></div>' +
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
