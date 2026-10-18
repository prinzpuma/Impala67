"use strict";

import { U } from "./util.js";
import {
	strokeBounds,
	translateStroke,
	pointInPolygon,
	strokeOutline
} from "./heft-geometry.js";

/**
 * Berechnet die Bounding Box aller übergebenen Striche.
 * Schnelle Schleifen ohne Closure-Allocations.
 */
export function lassoBounds(strokes) {
	if (!Array.isArray(strokes) || !strokes.length) return null;
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (let i = 0; i < strokes.length; i++) {
		const s = strokes[i];
		const pts = s.pts;
		if (Array.isArray(pts) && pts.length) {
			for (let j = 0; j < pts.length; j++) {
				const p = pts[j];
				if (p[0] < minX) minX = p[0];
				if (p[0] > maxX) maxX = p[0];
				if (p[1] < minY) minY = p[1];
				if (p[1] > maxY) maxY = p[1];
			}
		}
		if (s.shape) {
			const outline = strokeOutline(s);
			for (let j = 0; j < outline.length; j++) {
				const p = outline[j];
				if (p[0] < minX) minX = p[0];
				if (p[0] > maxX) maxX = p[0];
				if (p[1] < minY) minY = p[1];
				if (p[1] > maxY) maxY = p[1];
			}
		}
	}
	return isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/**
 * Berechnet die Bounding Box eines Polygons (Array von [x, y]).
 */
export function polygonBounds(poly) {
	if (!Array.isArray(poly) || !poly.length) return null;
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (let i = 0; i < poly.length; i++) {
		const p = poly[i];
		if (p[0] < minX) minX = p[0];
		if (p[0] > maxX) maxX = p[0];
		if (p[1] < minY) minY = p[1];
		if (p[1] > maxY) maxY = p[1];
	}
	return isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/**
 * Schneller AABB-Überschneidungstest zweier Bounding Boxes.
 */
export function boxesIntersect(a, b) {
	return !!(a && b && a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY);
}

/**
 * Tiefe Kopie eines einzelnen Strichs ohne JSON.stringify-Overhead.
 */
export function cloneStroke(stroke) {
	const copy = {
		id: U.uid(),
		tool: stroke.tool,
		color: stroke.color,
		size: stroke.size,
		pts: Array.isArray(stroke.pts) ? stroke.pts.map((p) => p.slice()) : []
	};
	if (stroke.shape) copy.shape = { ...stroke.shape };
	if (stroke.opacity != null) copy.opacity = stroke.opacity;
	strokeBounds(copy);
	return copy;
}

/**
 * Robuste, performante Prüfung, ob ein Strich im Lasso-Polygon liegt:
 * 1. O(1) Bounding-Box-Vorfilterung gegen grobe Abstände.
 * 2. Einzelpunkte / sehr kurze Striche (z.B. i-Punkte): Ein Punkt muss im Polygon liegen.
 * 3. Längere Striche: Schwerpunkt muss im Polygon liegen ODER mindestens 25 % der Stützpunkte.
 *    Verhindert versehentliches Auswählen benachbarter Zeilen bei minimalem Randkontakt.
 */
export function strokeInPolygon(stroke, poly, polyBox) {
	const box = stroke.bbox || strokeBounds(stroke);
	if (!boxesIntersect(box, polyBox)) return false;

	const outline = strokeOutline(stroke);
	if (!outline || !outline.length) return false;

	if (outline.length <= 2) {
		for (let i = 0; i < outline.length; i++) {
			if (pointInPolygon(outline[i], poly)) return true;
		}
		return false;
	}

	let hits = 0;
	let sumX = 0, sumY = 0;
	const count = outline.length;
	// Maximal 24 Abtastpunkte für maximale Geschwindigkeit
	const step = count > 24 ? Math.ceil(count / 24) : 1;
	let sampled = 0;

	for (let i = 0; i < count; i += step) {
		const pt = outline[i];
		sumX += pt[0];
		sumY += pt[1];
		sampled++;
		if (pointInPolygon(pt, poly)) hits++;
	}

	// Schwerpunkt im Polygon?
	if (sampled > 0) {
		const centroid = [sumX / sampled, sumY / sampled];
		if (pointInPolygon(centroid, poly)) return true;
	}

	// Oder mindestens 2 Treffer und >= 25 % der Punkte
	return hits >= 2 && hits / sampled >= 0.25;
}

/**
 * Filtert alle Striche einer Seite, die vom Lasso umschlossen sind.
 * Schnelle Vorfilterung über AABB.
 */
export function selectStrokesByLasso(strokes, poly) {
	if (!Array.isArray(strokes) || !strokes.length || !Array.isArray(poly) || poly.length < 3) return [];
	const polyBox = polygonBounds(poly);
	if (!polyBox) return [];
	const results = [];
	for (let i = 0; i < strokes.length; i++) {
		if (strokeInPolygon(strokes[i], poly, polyBox)) {
			results.push(strokes[i]);
		}
	}
	return results;
}

/**
 * Touch-Action-Entscheidung:
 * Tippen außerhalb der Auswahl schaltet zurück auf den Stift.
 * Tippen auf die Auswahl erlaubt Draggen/Skalieren.
 */
export const lassoTouchAction = (pointerType, currentTool, onLasso) =>
	pointerType === "touch" && currentTool === "lasso" ? (onLasso ? "interact" : "dismiss") : "none";

export const LASSO_HANDLE_OFFSET = 8;
export const LASSO_HANDLE_RADIUS = 5.5;
export const LASSO_HIT_RADIUS = 18;

/**
 * Liefert die 4 Eckgriffe für eine Bounding Box:
 * tl: oben-links, tr: oben-rechts, bl: unten-links, br: unten-rechts
 * Jeder Griff hat einen gegenüberliegenden Ankerpunkt für die proportionale Skalierung.
 */
export function getLassoHandles(bounds) {
	if (!bounds) return null;
	const off = LASSO_HANDLE_OFFSET;
	return {
		tl: { x: bounds.minX - off, y: bounds.minY - off, anchor: [bounds.maxX, bounds.maxY], name: "tl" },
		tr: { x: bounds.maxX + off, y: bounds.minY - off, anchor: [bounds.minX, bounds.maxY], name: "tr" },
		bl: { x: bounds.minX - off, y: bounds.maxY + off, anchor: [bounds.maxX, bounds.minY], name: "bl" },
		br: { x: bounds.maxX + off, y: bounds.maxY + off, anchor: [bounds.minX, bounds.minY], name: "br" }
	};
}

/**
 * Prüft, ob ein Klick/Tap einen der 4 Eckgriffe getroffen hat.
 * Gibt das Griff-Objekt mit Anker zurück oder null.
 */
export function hitLassoHandle(pos, bounds, hitRadius = LASSO_HIT_RADIUS) {
	if (!bounds) return null;
	const handles = getLassoHandles(bounds);
	if (!handles) return null;
	const r2 = hitRadius * hitRadius;
	for (const key of ["br", "tr", "bl", "tl"]) {
		const h = handles[key];
		const dx = pos[0] - h.x, dy = pos[1] - h.y;
		if (dx * dx + dy * dy <= r2) return h;
	}
	return null;
}

/**
 * Prüft, ob ein Klick/Tap innerhalb des Auswahl-Bereichs zum Verschieben liegt.
 */
export function isLassoBodyHit(pos, bounds, tolerance = 12) {
	if (!bounds) return false;
	return (
		pos[0] >= bounds.minX - tolerance &&
		pos[0] <= bounds.maxX + tolerance &&
		pos[1] >= bounds.minY - tolerance &&
		pos[1] <= bounds.maxY + tolerance
	);
}

/**
 * Zeichnet den Lasso-Auswahlrahmen (gestrichelte Bounding-Box + 4 Eckgriffe).
 */
export function drawLassoSelection(ctx, strokes, cachedBounds = null) {
	const bb = cachedBounds || lassoBounds(strokes || []);
	if (!bb) return;
	const off = LASSO_HANDLE_OFFSET;
	ctx.save();
	ctx.setLineDash([7, 4]);
	ctx.strokeStyle = "#2f6fed";
	ctx.lineWidth = 1.8;
	ctx.strokeRect(bb.minX - off, bb.minY - off, bb.maxX - bb.minX + 2 * off, bb.maxY - bb.minY + 2 * off);
	ctx.setLineDash([]);

	const handles = [
		[bb.minX - off, bb.minY - off],
		[bb.maxX + off, bb.minY - off],
		[bb.minX - off, bb.maxY + off],
		[bb.maxX + off, bb.maxY + off]
	];

	for (let i = 0; i < 4; i++) {
		const [hx, hy] = handles[i];
		ctx.beginPath();
		ctx.arc(hx, hy, LASSO_HANDLE_RADIUS, 0, Math.PI * 2);
		ctx.fillStyle = "#2f6fed";
		ctx.fill();
		ctx.strokeStyle = "#ffffff";
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
	if (!lassoSel || !lassoSel.strokes || !lassoSel.strokes.length) {
		if (bar) bar.remove();
		return;
	}
	if (!bar) {
		bar = document.createElement("div");
		bar.className = "heft-lasso-bar";
		host.appendChild(bar);
	}
	bar.innerHTML =
		'<button type="button" class="heft-lasso-btn" data-helassotext="1" title="Handschrift als Text erkennen & kopieren">' + lead("note") + 'In Text</button>' +
		'<button type="button" class="heft-lasso-btn" data-helassodup="1" title="Auswahl duplizieren">' + lead("copy") + 'Duplizieren</button>' +
		'<button type="button" class="heft-lasso-btn heft-lasso-del" data-helassodel="1" title="Auswahl löschen">' + lead("trash") + 'Löschen</button>' +
		'<button type="button" class="heft-lasso-btn heft-lasso-train" data-helassotrain="1" title="Als KI-Trainingsbeispiel speichern" aria-label="Als KI-Trainingsbeispiel speichern">' + lead("graduation") + '</button>' +
		'<button type="button" class="heft-lasso-btn heft-lasso-close" data-helassoclear="1" title="Auswahl aufheben" aria-label="Auswahl aufheben">✕</button>';
}

/**
 * Dupliziert die ausgewählten Striche um 28px versetzt und registriert Undo.
 */
export function duplicateLassoStrokes(lassoSel, doc, pushUndo) {
	if (!lassoSel || !doc) return null;
	const pg = doc.pages[lassoSel.pageIdx];
	if (!pg) return null;
	const copies = lassoSel.strokes.map((s) => {
		const c = cloneStroke(s);
		translateStroke(c, 28, 28);
		return c;
	});
	pg.strokes.push(...copies);
	pushUndo({ kind: "lassoDup", strokes: copies, pageIdx: lassoSel.pageIdx });
	const newBounds = lassoBounds(copies);
	return { pageIdx: lassoSel.pageIdx, strokes: copies, bounds: newBounds };
}

/**
 * Löscht die ausgewählten Striche über eine ID-Menge und registriert Undo.
 */
export function deleteLassoStrokes(lassoSel, doc, pushUndo) {
	if (!lassoSel || !doc) return null;
	const pg = doc.pages[lassoSel.pageIdx];
	if (!pg) return null;
	const strokes = lassoSel.strokes.slice();
	const idSet = new Set(strokes.map((s) => s.id));
	pg.strokes = pg.strokes.filter((s) => !idSet.has(s.id));
	pushUndo({ kind: "lassoDel", strokes, pageIdx: lassoSel.pageIdx });
	return lassoSel.pageIdx;
}

/**
 * Führt die Handschrifterkennung (OCR) für die Auswahl durch und kopiert den Text.
 */
export async function recognizeLassoText(lassoSel, handschrift, toast, perfProfiler) {
	if (!lassoSel || !lassoSel.strokes || !lassoSel.strokes.length) return;
	try {
		if (toast) toast("Handschrift wird erkannt…");
		const text = await handschrift.recognizeStrokes(lassoSel.strokes);
		if (text && text.trim()) {
			let copied = true;
			try {
				await navigator.clipboard.writeText(text.trim());
			} catch (e) {
				copied = false;
				if (perfProfiler) perfProfiler.error("clipboard-error", e, { source: "heft-lasso" });
			}
			if (toast) toast((copied ? "Erkannt & kopiert: „" : "Erkannt (Kopieren nicht möglich): „") + text.trim() + "“");
		} else {
			if (toast) toast("Kein Text erkannt.");
		}
	} catch (e) {
		if (toast) toast("Erkennung fehlgeschlagen: " + (e?.message || e));
	}
}

/**
 * Speichert die Auswahl als Trainingsbeispiel für die Handschrift-KI.
 */
export async function trainLassoSample(lassoSel, handschrift, toast) {
	if (!lassoSel || !lassoSel.strokes || !lassoSel.strokes.length) return;
	let guess = "";
	try {
		guess = (await handschrift.recognizeStrokes(lassoSel.strokes)) || "";
	} catch {}
	const label = window.prompt("Welcher Text steht in dieser Auswahl?", guess);
	if (label != null && label.trim()) {
		const saved = handschrift.saveTrainingSample(lassoSel.strokes, label.trim());
		if (saved && toast) {
			const count = handschrift.getTrainingSamples().length;
			toast("Gespeichert! (" + count + " Trainingsbeispiele gesammelt)");
		}
	}
}
