"use strict";

// Strich-Geometrie im Rust-Kern (core/impala-heft): Grenzen, Umriss, Formerkennung, Verschieben,
// Skalieren, Treffer-Tests. Die Striche bleiben JS-Objekte; neue Geometrie wird zurückgeschrieben.
import { CORE } from "./rust-core.js";

// Geometrie aus dem Kern ({ pts, shape, size, bbox }) in den Strich übernehmen.
export function assignGeometry(stroke, g) {
	stroke.pts = g.pts;
	if (g.shape) stroke.shape = g.shape; else delete stroke.shape;
	if (g.size != null) stroke.size = g.size;
	stroke.bbox = g.bbox ?? null;
}

// Oberstes Bild/Textfeld unter dem Punkt (h fehlt ⇒ 60).
export function hitBox(items, point) {
	const frames = new Float64Array(items.length * 4);
	items.forEach((it, i) => frames.set([Number(it.x), Number(it.y), Number(it.w), Number(it.h || 0)], i * 4));
	const at = CORE.heftHitBox(frames, point[0], point[1]);
	return at >= 0 ? items[at] : null;
}

// Form-Erkennung: Linie, Pfeil, Dreieck, Rechteck oder Ellipse; null ohne Form.
export const fitStrokeShape = (points) => (Array.isArray(points) ? CORE.heftFitShape(points) ?? null : null);

export const strokeOutline = (stroke) => CORE.heftStrokeOutline(stroke);

// Grenzen samt Rand; einmal gerechnet und in stroke.bbox zwischengespeichert.
export function strokeBounds(stroke) {
	if (!stroke) return null;
	if (stroke.bbox) return stroke.bbox;
	stroke.bbox = CORE.heftStrokeBounds(stroke) ?? null;
	return stroke.bbox;
}

export function translateStroke(stroke, deltaX, deltaY) {
	const hadBox = !!stroke.bbox;
	assignGeometry(stroke, CORE.heftTranslate(stroke, deltaX, deltaY));
	if (!hadBox) delete stroke.bbox;
}

// Ausgangsgeometrie für Verschieben/Skalieren/Rückgängig (reine Kopie).
export function strokeGeometry(stroke) {
	return { pts: (stroke.pts || []).map((point) => point.slice()), shape: stroke.shape ? { ...stroke.shape } : null, size: stroke.size || 3 };
}

export const applyStrokeGeometry = (stroke, geometry) => assignGeometry(stroke, CORE.heftApplyGeometry(geometry));

// Striche im Binärformat für den Kern (Gesten über ganze Seiten wären als JSON zu langsam):
// Punkte [x, y, Druck|NaN] hintereinander, je Strich Punktzahl, Dicke, Grenzen, Formen als JSON.
export function packStrokes(strokes) {
	let total = 0;
	for (const s of strokes) total += Array.isArray(s.pts) ? s.pts.length : 0;
	const coords = new Float64Array(total * 3), counts = new Uint32Array(strokes.length);
	const sizes = new Float64Array(strokes.length), bboxes = new Float64Array(strokes.length * 4).fill(NaN);
	const shapes = {};
	let at = 0;
	strokes.forEach((s, i) => {
		const pts = Array.isArray(s.pts) ? s.pts : [];
		counts[i] = pts.length;
		for (const p of pts) { coords[at++] = p[0]; coords[at++] = p[1]; coords[at++] = p.length > 2 && p[2] != null ? p[2] : NaN; }
		sizes[i] = s.size != null ? Number(s.size) : NaN;
		const b = s.bbox;
		if (b) bboxes.set([b.minX, b.minY, b.maxX, b.maxY], i * 4);
		if (s.shape) shapes[i] = s.shape;
	});
	return [coords, counts, sizes, bboxes, JSON.stringify(shapes)];
}

// Geometrie aus dem Kern im Binärformat ({ xy, counts, sizes, bboxes, shapes }) zurückschreiben.
// Punkte werden an Ort und Stelle aktualisiert (Druck bleibt); hat ein Sync den Strich mitten in
// der Geste ersetzt (andere Punktzahl), bekommt er die Punkte der Ausgangsgeometrie neu.
export function applyGeometries(strokes, g) {
	let at = 0;
	strokes.forEach((s, i) => {
		const n = g.counts[i];
		if (Array.isArray(s.pts) && s.pts.length === n) for (const p of s.pts) { p[0] = g.xy[at++]; p[1] = g.xy[at++]; }
		else { s.pts = Array.from({ length: n }, () => [g.xy[at++], g.xy[at++]]); }
		const shape = g.shapes?.[i];
		if (shape) s.shape = shape; else delete s.shape;
		if (!Number.isNaN(g.sizes[i])) s.size = g.sizes[i];
		const b = i * 4;
		s.bbox = Number.isNaN(g.bboxes[b]) ? null : { minX: g.bboxes[b], minY: g.bboxes[b + 1], maxX: g.bboxes[b + 2], maxY: g.bboxes[b + 3] };
	});
}

// Für eine Auswahl während einer Geste: new CORE.HeftTransform(...packStrokes(strokes)) und je
// Bewegung moveBy/scaleBy (rechnet absolut von der Ausgangsgeometrie, siehe heft-input.js).
function transformOne(stroke, geometry, run) {
	const target = { ...geometry, pts: (geometry.pts || []).map((p) => p.slice()) };
	const t = new CORE.HeftTransform(...packStrokes([target]));
	try { applyGeometries([target], run(t)); } finally { t.free(); }
	stroke.pts = target.pts;
	if (target.shape) stroke.shape = target.shape; else delete stroke.shape;
	stroke.size = target.size;
	stroke.bbox = target.bbox;
}
// Verschiebt absolut von der Ausgangsgeometrie aus: Setzt ein Speichern oder Sync den Strich
// mitten in der Geste auf einen älteren Stand zurück, geht keine Teilbewegung verloren.
export const moveStrokeFrom = (stroke, geometry, deltaX, deltaY) => transformOne(stroke, geometry, (t) => t.moveBy(deltaX, deltaY));
export const scaleStrokeFrom = (stroke, geometry, anchorX, anchorY, factor) => transformOne(stroke, geometry, (t) => t.scaleBy(anchorX, anchorY, factor));

export const nearPoint = (point, x, y, radius) => CORE.heftNearPoint(point[0], point[1], x, y, radius);
