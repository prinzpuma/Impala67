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
	// Kopien 28 Einheiten versetzt, mit neuen IDs (Rust-Kern).
	const copies = CORE.heftDuplicateStrokes(lassoSel.strokes, U.uid);
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
 * Safari erlaubt das Kopieren nur innerhalb der Nutzergeste – nach dem await auf die Erkennung
 * war sie verbraucht und das Kopieren schlug immer fehl. Darum startet der Schreibauftrag
 * sofort im Klick, der Text wird als Promise nachgereicht (ClipboardItem).
 */
export async function recognizeLassoText(lassoSel, handschrift, toast, perfProfiler) {
	if (!lassoSel || !lassoSel.strokes || !lassoSel.strokes.length) return;
	if (toast) toast("Handschrift wird erkannt…");
	const recognized = Promise.resolve().then(() => handschrift.recognizeStrokes(lassoSel.strokes, {}, "lasso")).then((t) => String(t || "").trim());
	let copying = null;
	if (typeof ClipboardItem === "function" && navigator.clipboard?.write) {
		const blob = recognized.then((t) => { if (!t) throw new Error("Kein Text erkannt."); return new Blob([t], { type: "text/plain" }); });
		try { copying = navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]); }
		catch { copying = null; }
		copying?.catch(() => {}); // Ergebnis wird unten ausgewertet
	}
	try {
		const text = await recognized;
		if (!text) { if (toast) toast("Kein Text erkannt."); return; }
		let copied = true;
		try {
			await (copying || navigator.clipboard.writeText(text));
		} catch (e) {
			copied = false;
			if (perfProfiler) perfProfiler.error("clipboard-error", e, { source: "heft-lasso" });
		}
		if (toast) toast((copied ? "Erkannt & kopiert: „" : "Erkannt (Kopieren nicht möglich): „") + text + "“");
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
		guess = (await handschrift.recognizeStrokes(lassoSel.strokes, {}, "lasso-train")) || "";
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
