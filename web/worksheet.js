"use strict";

import { S, STATE } from "./state.js";
import { CORE } from "./rust-core.js";
import { U } from "./util.js";
import { RENDER } from "./render.js";
import { emptyHeftPage, blobId, ocrKey } from "./heft-document-core.js";
import { imagePage } from "./heft-import.js";

// Rendert strukturierte Arbeitsblatt-Vorlagen (SVG aus impala-heft) zu scharfen PNG-Seiten
// und legt sie als festliegende Seitenhintergründe in ein neues oder bestehendes Heft.

const RENDER_W = 1500;
const RENDER_H = 2121;
const PAPER_BG = "#fcfbf8";

function isBlankHeftPage(pg) {
	return !pg.bg && !(pg.strokes || []).length && !(pg.texts || []).length && !(pg.images || []).length;
}

function findExistingHeft(ref) {
	const key = String(ref || "").trim();
	if (!key) return { error: "create_worksheet: heft darf nicht leer sein." };
	const byId = S.pages?.[key];
	if (byId && !byId.trashed) {
		if (byId.kind !== "heft") return { error: `„${byId.title || key}“ ist kein Heft.` };
		return { page: byId };
	}
	const low = key.toLowerCase();
	const matches = Object.values(S.pages || {}).filter(
		(pg) => pg && !pg.trashed && pg.kind === "heft" && String(pg.title || "").trim().toLowerCase() === low
	);
	if (!matches.length) return { error: `Heft „${key}“ nicht gefunden.` };
	if (matches.length > 1) return { error: `Mehrere Hefte heißen „${key}“ — bitte eindeutige ID angeben.` };
	return { page: matches[0] };
}

export function svgToPng(svgText, width = RENDER_W, height = RENDER_H) {
	return new Promise((resolve, reject) => {
		const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const img = new Image();
		img.onload = () => {
			try {
				const canvas = document.createElement("canvas");
				canvas.width = width;
				canvas.height = height;
				const ctx = canvas.getContext("2d");
				ctx.fillStyle = PAPER_BG;
				ctx.fillRect(0, 0, width, height);
				ctx.drawImage(img, 0, 0, width, height);
				resolve({ src: canvas.toDataURL("image/png"), w: width, h: height });
			} catch (err) {
				reject(err);
			} finally {
				URL.revokeObjectURL(url);
			}
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error("Arbeitsblatt-SVG konnte nicht gerendert werden."));
		};
		img.src = url;
	});
}

export async function createWorksheet(args = {}, {
	core = CORE,
	state = STATE,
	runTool,
	undoTool,
	rasterize = svgToPng,
	loadHeft = () => import("./heft.js"),
	renderUi = () => RENDER?.render?.(),
} = {}) {
	if (!runTool) return { error: "create_worksheet: runTool fehlt." };

	let rendered;
	try {
		rendered = core.heftRenderWorksheet(args);
	} catch (err) {
		return { error: String(err?.message || err) };
	}

	const pages = Array.isArray(rendered?.pages) ? rendered.pages : [];
	if (!pages.length) return { error: "create_worksheet: Keine Seiten erzeugt." };

	const hasTargetHeft = typeof args.heft === "string" && args.heft.trim().length > 0;
	if (args.dry_run === true) {
		if (hasTargetHeft) {
			const found = findExistingHeft(args.heft);
			if (found.error) return { error: found.error };
		} else {
			const probe = await runTool("create_pages", {
				dry_run: true,
				pages: [{ title: rendered.title, ...(args.parent ? { parent: args.parent } : {}), heft: true }],
			});
			if (probe?.error) return probe;
		}
		return {
			ok: true,
			dryRun: true,
			title: rendered.title,
			subject: rendered.subject,
			totalPoints: rendered.totalPoints,
			pageCount: pages.length,
		};
	}

	let pageId;
	let targetTitle = rendered.title;
	let undo = null;

	if (hasTargetHeft) {
		const found = findExistingHeft(args.heft);
		if (found.error) return { error: found.error };
		pageId = found.page.id;
		targetTitle = found.page.title || rendered.title;
	} else {
		const created = await runTool("create_pages", {
			pages: [{ title: rendered.title, ...(args.parent ? { parent: args.parent } : {}), heft: true }],
		});
		const first = created?.results?.[0];
		pageId = first?.id || created?.id || null;
		if (!created || created.error || !pageId) return created?.error ? created : { error: "Heft konnte nicht angelegt werden." };
		targetTitle = first?.title || created.title || rendered.title;
		undo = created._undo || null;
	}

	try {
		const { HEFT } = await loadHeft();
		if (HEFT?.openDoc?.(pageId)) await HEFT.saveNow();

		const existingPages = (HEFT?.openDoc?.(pageId) || state.heftDoc(pageId))?.pages || [];
		const blankStarter = existingPages.length === 1 && isBlankHeftPage(existingPages[0]) ? existingPages[0] : null;
		let insertAt = existingPages.length;
		const ops = [];

		for (const p of pages) {
			const img = await rasterize(p.svg, RENDER_W, RENDER_H);
			const hash = blobId(img.src);
			if (!state.hasHeftBlob(hash)) {
				await state.dispatch("heftBlob", { hash, data: img.src });
			}
			const pg = imagePage(
				{ ref: hash, w: img.w, h: img.h, ocr: p.ocrText },
				"blank",
				{ blobRef: () => hash, newPage: (paper) => emptyHeftPage(U.uid(), paper) }
			);
			ops.push({ t: "pg+", at: insertAt, page: { id: pg.id, paper: pg.paper || "blank", ...(pg.h ? { h: pg.h } : {}) } });
			ops.push({ t: "pgb", p: pg.id, bg: pg.bg });
			if (p.ocrText) {
				ops.push({ t: "ocr", p: pg.id, text: p.ocrText, src: "pwa", key: ocrKey(pg) });
			}
			insertAt++;
		}

		if (blankStarter) {
			ops.push({ t: "pg-", p: blankStarter.id });
		}
		await state.dispatch("heftOps", { pageId, ops });
		renderUi();

		const out = {
			ok: true,
			id: pageId,
			title: targetTitle,
			heft: true,
			pagesAdded: pages.length,
			pageCount: existingPages.length + pages.length - (blankStarter ? 1 : 0),
			totalPoints: rendered.totalPoints,
			open_page: targetTitle,
		};
		if (undo) Object.defineProperty(out, "_undo", { value: undo, enumerable: false });
		return out;
	} catch (err) {
		if (undo && undoTool) {
			try { await undoTool(undo); } catch {}
		}
		return { error: String(err?.message || err) };
	}
}
