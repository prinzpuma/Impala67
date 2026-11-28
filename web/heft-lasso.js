"use strict";

import { U } from "./util.js";
import { CORE } from "./rust-core.js";
import { packStrokes } from "./heft-geometry.js";

// Lasso-Logik im Rust-Kern (core/impala-heft lasso.rs): Grenzen, Auswahl, Griffe, Kopien.
// Hier bleiben Zeichnen und die Aktionen der Leiste.

// Gemeinsame Grenzen der Striche (Punkte und Form-Umriss), null ohne Punkte.
export const lassoBounds = (strokes) => (Array.isArray(strokes) && strokes.length ? CORE.heftLassoBounds(...packStrokes(strokes)) ?? null : null);

// Striche einer Seite, die das Lasso umschließt (Schwerpunkt oder ≥ 25 % der Stützpunkte innen).
export function selectStrokesByLasso(strokes, poly) {
	if (!Array.isArray(strokes) || !strokes.length || !Array.isArray(poly) || poly.length < 3) return [];
	return Array.from(CORE.heftSelectByLasso(...packStrokes(strokes), Float64Array.from(poly.flatMap((p) => [p[0], p[1]]))), (i) => strokes[i]);
}

// Tippen außerhalb der Auswahl schaltet zurück auf den Stift, auf der Auswahl: verschieben/skalieren.
export const lassoTouchAction = (pointerType, currentTool, onLasso) => CORE.heftLassoTouchAction(pointerType === "touch", currentTool === "lasso", !!onLasso);

export const LASSO_HANDLE_RADIUS = 5.5;
export const LASSO_HIT_RADIUS = 18;

// Die 4 Eckgriffe { tl, tr, bl, br } mit gegenüberliegendem Anker für proportionales Skalieren.
export const getLassoHandles = (bounds) => (bounds ? CORE.heftLassoHandles(bounds) : null);

// Getroffener Eckgriff (mit Anker) oder null.
export const hitLassoHandle = (pos, bounds, hitRadius = LASSO_HIT_RADIUS) => (bounds ? CORE.heftHitLassoHandle(pos[0], pos[1], bounds, hitRadius) : null);

// Liegt der Tipp im (erweiterten) Auswahlrahmen zum Verschieben?
export const isLassoBodyHit = (pos, bounds, tolerance = 12) => !!bounds && CORE.heftIsLassoBodyHit(pos[0], pos[1], bounds, tolerance);

// Drehgriff über dem oberen Rand des Auswahlrahmens (`{ x, y, cx, cy }`).
export const getLassoRotateHandle = (bounds) => (bounds ? CORE.heftLassoRotateHandle(bounds) : null);

// Trifft der Zeiger den Drehgriff?
export const hitLassoRotateHandle = (pos, bounds, hitRadius = LASSO_HIT_RADIUS) => !!bounds && CORE.heftHitLassoRotateHandle(pos[0], pos[1], bounds, hitRadius);

// Bilder oder Textfelder einer Seite, die das Lasso umschließt (im Kern entschieden).
export function selectItemsByLasso(items, poly, defaultH = 36) {
	if (!Array.isArray(items) || !items.length || !Array.isArray(poly) || poly.length < 3) return [];
	const rects = new Float64Array(items.length * 4);
	for (let i = 0; i < items.length; i++) {
		const o = items[i];
		rects[i * 4] = Number(o.x) || 0;
		rects[i * 4 + 1] = Number(o.y) || 0;
		rects[i * 4 + 2] = Math.max(1, Number(o.w) || 200);
		rects[i * 4 + 3] = Math.max(1, Number(o.h) || defaultH);
	}
	const polyFlat = Float64Array.from(poly.flatMap((p) => [p[0], p[1]]));
	return Array.from(CORE.heftSelectRectsByLasso(rects, polyFlat), (i) => items[i]);
}

// Gemeinsame Grenzen aus Strichen, Bildern und Textfeldern.
export function lassoSelectionBounds(strokes, images = [], texts = []) {
	let bb = lassoBounds(strokes || []);
	const grow = (x, y, w, h) => {
		if (!bb) bb = { minX: x, minY: y, maxX: x + w, maxY: y + h };
		else {
			if (x < bb.minX) bb.minX = x;
			if (y < bb.minY) bb.minY = y;
			if (x + w > bb.maxX) bb.maxX = x + w;
			if (y + h > bb.maxY) bb.maxY = y + h;
		}
	};
	for (const im of images || []) grow(Number(im.x) || 0, Number(im.y) || 0, Math.max(1, Number(im.w) || 1), Math.max(1, Number(im.h) || 1));
	for (const tb of texts || []) grow(Number(tb.x) || 0, Number(tb.y) || 0, Math.max(1, Number(tb.w) || 200), Math.max(1, Number(tb.h) || 36));
	return bb;
}

// Bild oder Textfeld von einer gemerkten Ausgangslage aus verschieben, skalieren oder drehen.
export function transformLassoItem(item, orig, op, isText = false) {
	const minW = isText ? 60 : 24, minH = isText ? 20 : 24;
	const x = orig.x, y = orig.y, w = orig.w, h = orig.h;
	if (op.kind === "move") {
		item.x = x + op.dx; item.y = y + op.dy;
	} else if (op.kind === "scale") {
		item.x = op.ax + (x - op.ax) * op.factor;
		item.y = op.ay + (y - op.ay) * op.factor;
		item.w = Math.max(minW, w * op.factor);
		if (!isText || orig.hasH) item.h = Math.max(minH, h * op.factor);
		if (isText && orig.size != null) item.size = Math.min(96, Math.max(10, orig.size * op.factor));
	} else if (op.kind === "rotate") {
		const s = Math.sin(op.angle), c = Math.cos(op.angle);
		const mx = x + w / 2 - op.cx, my = y + h / 2 - op.cy;
		const nx = op.cx + mx * c - my * s, ny = op.cy + mx * s + my * c;
		item.x = nx - w / 2; item.y = ny - h / 2;
	}
}

export const itemSnapshot = (o, defaultH = 36) => ({
	x: Number(o.x) || 0, y: Number(o.y) || 0, w: Math.max(1, Number(o.w) || 200), h: Math.max(1, Number(o.h) || defaultH),
	hasH: o.h != null, size: o.size != null ? Number(o.size) : null,
});

/**
 * Zeichnet den Lasso-Auswahlrahmen (gestrichelte Bounding-Box + 4 Eckgriffe).
 */
export function drawLassoSelection(ctx, strokes, cachedBounds = null) {
	const bb = cachedBounds || lassoBounds(strokes || []);
	if (!bb) return;
	const h = getLassoHandles(bb);
	ctx.save();
	ctx.setLineDash([7, 4]);
	ctx.strokeStyle = "#2f6fed";
	ctx.lineWidth = 1.8;
	ctx.strokeRect(h.tl.x, h.tl.y, h.br.x - h.tl.x, h.br.y - h.tl.y);
	ctx.setLineDash([]);

	for (const { x: hx, y: hy } of [h.tl, h.tr, h.bl, h.br]) {
		ctx.beginPath();
		ctx.arc(hx, hy, LASSO_HANDLE_RADIUS, 0, Math.PI * 2);
		ctx.fillStyle = "#2f6fed";
		ctx.fill();
		ctx.strokeStyle = "#ffffff";
		ctx.lineWidth = 2;
		ctx.stroke();
	}

	// Drehgriff mittig über dem oberen Rand.
	const rot = getLassoRotateHandle(bb);
	if (rot) {
		ctx.beginPath();
		ctx.moveTo(rot.cx, h.tl.y);
		ctx.lineTo(rot.x, rot.y);
		ctx.strokeStyle = "#2f6fed";
		ctx.lineWidth = 1.6;
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(rot.x, rot.y, LASSO_HANDLE_RADIUS + 1.5, 0, Math.PI * 2);
		ctx.fillStyle = "#ffffff";
		ctx.fill();
		ctx.strokeStyle = "#2f6fed";
		ctx.lineWidth = 2;
		ctx.stroke();
	}

	ctx.restore();
}

/**
 * Zeichnet den Freihand-Lassopfad während der Auswahl-Geste.
 */
export function drawLassoPath(ctx, pts) {
	if (!ctx || !pts || pts.length < 2) return;
	ctx.save();
	ctx.setLineDash([7, 4]);
	ctx.strokeStyle = "#2f6fed";
	ctx.lineWidth = 1.7;
	ctx.beginPath();
	ctx.moveTo(pts[0][0], pts[0][1]);
	for (let i = 1; i < pts.length; i++) {
		ctx.lineTo(pts[i][0], pts[i][1]);
	}
	ctx.stroke();
	ctx.restore();
}

/**
 * Aktualisiert oder entfernt die kompakte, aufgeräumte Lasso-Aktionsleiste.
 * Keine störenden Tutorial-Texte mehr — nur noch direkte, intuitive Aktionen.
 */
export function updateLassoBarUI(host, lassoSel, lead) {
	if (!host) return;
	let bar = host.querySelector(".heft-lasso-bar");
	const total = lassoSel ? (lassoSel.strokes?.length || 0) + (lassoSel.images?.length || 0) + (lassoSel.texts?.length || 0) : 0;
	if (!total) {
		if (bar) bar.remove();
		return;
	}
	if (!bar) {
		bar = document.createElement("div");
		bar.className = "heft-lasso-bar";
		host.appendChild(bar);
	}
	bar.innerHTML =
		'<button type="button" class="heft-lasso-btn" data-helassodup="1" title="Auswahl duplizieren">' + lead("copy") + 'Duplizieren</button>' +
		'<button type="button" class="heft-lasso-btn heft-lasso-del" data-helassodel="1" title="Auswahl löschen">' + lead("trash") + 'Löschen</button>' +
		'<button type="button" class="heft-lasso-btn heft-lasso-close" data-helassoclear="1" title="Auswahl aufheben" aria-label="Auswahl aufheben">✕</button>';
}

/**
 * Dupliziert die ausgewählten Striche, Bilder und Textfelder um 28px versetzt und registriert Undo.
 */
export function duplicateLassoStrokes(lassoSel, doc, pushUndo) {
	if (!lassoSel || !doc) return null;
	const pg = doc.pages[lassoSel.pageIdx];
	if (!pg) return null;
	const copies = lassoSel.strokes?.length ? CORE.heftDuplicateStrokes(lassoSel.strokes, U.uid) : [];
	if (copies.length) pg.strokes.push(...copies);
	const imgCopies = (lassoSel.images || []).map((im) => ({ ...im, id: U.uid(), x: (Number(im.x) || 0) + 28, y: (Number(im.y) || 0) + 28 }));
	if (imgCopies.length) (pg.images || (pg.images = [])).push(...imgCopies);
	const txtCopies = (lassoSel.texts || []).map((tb) => ({ ...tb, id: U.uid(), x: (Number(tb.x) || 0) + 28, y: (Number(tb.y) || 0) + 28 }));
	if (txtCopies.length) (pg.texts || (pg.texts = [])).push(...txtCopies);
	pushUndo({ kind: "lassoDup", strokes: copies, images: imgCopies, texts: txtCopies, pageIdx: lassoSel.pageIdx });
	return { pageIdx: lassoSel.pageIdx, strokes: copies, images: imgCopies, texts: txtCopies, bounds: lassoSelectionBounds(copies, imgCopies, txtCopies) };
}

/**
 * Löscht die ausgewählten Striche, Bilder und Textfelder über ID-Mengen und registriert Undo.
 */
export function deleteLassoStrokes(lassoSel, doc, pushUndo) {
	if (!lassoSel || !doc) return null;
	const pg = doc.pages[lassoSel.pageIdx];
	if (!pg) return null;
	const strokes = (lassoSel.strokes || []).slice();
	const images = (lassoSel.images || []).slice();
	const texts = (lassoSel.texts || []).slice();
	if (strokes.length) {
		const ids = new Set(strokes.map((s) => s.id));
		pg.strokes = pg.strokes.filter((s) => !ids.has(s.id));
	}
	if (images.length && pg.images) {
		const ids = new Set(images.map((im) => im.id));
		pg.images = pg.images.filter((im) => !ids.has(im.id));
	}
	if (texts.length && pg.texts) {
		const ids = new Set(texts.map((tb) => tb.id));
		pg.texts = pg.texts.filter((tb) => !ids.has(tb.id));
	}
	pushUndo({ kind: "lassoDel", strokes, images, texts, pageIdx: lassoSel.pageIdx });
	return lassoSel.pageIdx;
}

