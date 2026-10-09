"use strict";

// web/handwriting-preprocessor.js
// Vorverarbeitung von Strichen (Digital Ink) aus web/heft.js für ML-Inferenz.
//
// Schritte:
// 1. Striche filtern (keine Formen/Radierer).
// 2. Zeilensegmentierung (Gruppierung vertikal überlappender Striche zu Textzeilen).
// 3. Räumliches Resampling (äquidistante Abtastung entlang des Strichverlaufs, unabhängig von Schreibtempo).
// 4. Feature-Extraktion: Delta-Koordinaten (dx, dy) und Stift-Zustand (pen_down: 1 = Zeichnen, 0 = Absetzen).

export const HANDWRITING_PREPROCESSOR = (() => {
	const STEP_PIXELS = 4; // Äquidistanter Punktabstand in Pixeln

	// Berechnet die Bounding Box eines Strichs
	function strokeBbox(stroke) {
		const pts = stroke.pts || [];
		if (!pts.length) return null;
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (let i = 0; i < pts.length; i++) {
			const p = pts[i];
			if (p[0] < minX) minX = p[0];
			if (p[0] > maxX) maxX = p[0];
			if (p[1] < minY) minY = p[1];
			if (p[1] > maxY) maxY = p[1];
		}
		return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY, cy: (minY + maxY) / 2 };
	}

	// Filtert reine Schreibstriche (Pen, Pencil)
	function filterInkStrokes(strokes) {
		return (strokes || []).filter((s) => {
			if (!s || !Array.isArray(s.pts) || s.pts.length === 0) return false;
			if (s.tool === "shape" || s.tool === "eraser" || s.tool === "laser") return false;
			return true;
		});
	}

	// Gruppiert Striche in Textzeilen (von oben nach unten, darin von links nach rechts unter Wahrung der natürlichen Strichfolge)
	function segmentLines(strokes) {
		const valid = filterInkStrokes(strokes);
		if (!valid.length) return [];

		const items = valid.map((s, idx) => ({ stroke: s, bbox: strokeBbox(s), origIdx: idx })).filter((item) => item.bbox);
		if (!items.length) return [];

		// Nach vertikalem Zentrum sortieren
		items.sort((a, b) => a.bbox.cy - b.bbox.cy);

		const lines = [];
		for (const item of items) {
			let placed = false;
			for (const line of lines) {
				const lineH = Math.max(20, line.maxY - line.minY);
				// Vertikaler Überlappungs-Check
				const overlap = Math.min(line.maxY, item.bbox.maxY) - Math.max(line.minY, item.bbox.minY);
				const closeY = Math.abs(item.bbox.cy - line.cy) < lineH * 0.7;

				if (overlap > 0 || closeY) {
					line.items.push(item);
					line.minY = Math.min(line.minY, item.bbox.minY);
					line.maxY = Math.max(line.maxY, item.bbox.maxY);
					line.minX = Math.min(line.minX, item.bbox.minX);
					line.maxX = Math.max(line.maxX, item.bbox.maxX);
					line.cy = (line.minY + line.maxY) / 2;
					placed = true;
					break;
				}
			}
			if (!placed) {
				lines.push({
					minX: item.bbox.minX, maxX: item.bbox.maxX,
					minY: item.bbox.minY, maxY: item.bbox.maxY,
					cy: item.bbox.cy,
					items: [item],
				});
			}
		}

		// Zeilen von oben nach unten sortieren
		lines.sort((a, b) => a.minY - b.minY);

		return lines.map((l) => {
			const sortedItems = sortLineItems(l.items);
			return {
				strokes: sortedItems.map((i) => i.stroke),
				bbox: { minX: l.minX, maxX: l.maxX, minY: l.minY, maxY: l.maxY, h: l.maxY - l.minY, w: l.maxX - l.minX },
			};
		});
	}

	// Striche innerhalb einer Zeile ordnen.
	// Überlappende oder nah beieinander liegende Striche (z.B. Stamm + Querstrich von 't'/'f'/'A' oder i-Punkte)
	// bleiben im selben Zeichencluster in ihrer chronologischen Zeichenreihenfolge (origIdx).
	// Räumlich getrennte Zeichen/Wortblöcke werden von links nach rechts geordnet.
	function sortLineItems(lineItems) {
		if (lineItems.length <= 1) return lineItems;
		const sorted = lineItems.slice().sort((a, b) => a.bbox.minX - b.bbox.minX);
		const clusters = [];
		for (const it of sorted) {
			let merged = false;
			for (const cl of clusters) {
				const overlap = Math.min(cl.maxX, it.bbox.maxX) - Math.max(cl.minX, it.bbox.minX);
				const close = it.bbox.minX <= cl.maxX + Math.max(8, (cl.maxY - cl.minY) * 0.25);
				if (overlap > 0 || close) {
					cl.items.push(it);
					cl.minX = Math.min(cl.minX, it.bbox.minX);
					cl.maxX = Math.max(cl.maxX, it.bbox.maxX);
					cl.minY = Math.min(cl.minY, it.bbox.minY);
					cl.maxY = Math.max(cl.maxY, it.bbox.maxY);
					merged = true;
					break;
				}
			}
			if (!merged) {
				clusters.push({
					minX: it.bbox.minX, maxX: it.bbox.maxX,
					minY: it.bbox.minY, maxY: it.bbox.maxY,
					items: [it],
				});
			}
		}
		clusters.sort((a, b) => a.minX - b.minX);
		const result = [];
		for (const cl of clusters) {
			cl.items.sort((a, b) => a.origIdx - b.origIdx);
			result.push(...cl.items);
		}
		return result;
	}

	// Ordnet die Striche einer (bereits waagerechten) Zeile wie segmentLines; strokes in Zeichenreihenfolge.
	function orderLineStrokes(strokes) {
		const items = strokes.map((s, idx) => ({ stroke: s, bbox: strokeBbox(s), origIdx: idx })).filter((it) => it.bbox);
		return sortLineItems(items).map((it) => it.stroke);
	}

	// Schätzt den Neigungswinkel einer Zeile/Strichmenge (in Radiant) via linearer Regression / Trägheitsachse
	function estimateOrientation(strokes) {
		let n = 0, sumX = 0, sumY = 0;
		let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
		for (const s of strokes) {
			const pts = s.pts || [];
			for (const p of pts) {
				sumX += p[0];
				sumY += p[1];
				if (p[0] < minX) minX = p[0];
				if (p[0] > maxX) maxX = p[0];
				if (p[1] < minY) minY = p[1];
				if (p[1] > maxY) maxY = p[1];
				n++;
			}
		}
		if (n < 6) return 0;
		const w = maxX - minX;
		const h = maxY - minY;
		if (w < h * 1.5) return 0; // Nur echte horizontale Zeilen drehen, keine isolierten Zeichen

		const cx = sumX / n;
		const cy = sumY / n;

		let sxx = 0, syy = 0, sxy = 0;
		for (const s of strokes) {
			const pts = s.pts || [];
			for (const p of pts) {
				const dx = p[0] - cx;
				const dy = p[1] - cy;
				sxx += dx * dx;
				syy += dy * dy;
				sxy += dx * dy;
			}
		}
		// Hauptträgheitswinkel
		const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
		// Nur begradigen, wenn der Winkel innerhalb von ca. ±45 Grad liegt
		if (Math.abs(angle) > Math.PI / 4) return 0;
		return angle;
	}

	// Dreht Striche um ein Zentrum zurück (Begradigung / Deskewing)
	function deskewStrokes(strokes, angleRad) {
		if (Math.abs(angleRad) < 0.015) return strokes; // Weniger als ~1 Grad Schieflage ignorieren
		let n = 0, sumX = 0, sumY = 0;
		for (const s of strokes) {
			const pts = s.pts || [];
			for (const p of pts) {
				sumX += p[0];
				sumY += p[1];
				n++;
			}
		}
		if (n === 0) return strokes;
		const cx = sumX / n;
		const cy = sumY / n;
		const cosA = Math.cos(-angleRad);
		const sinA = Math.sin(-angleRad);

		return strokes.map((s) => ({
			...s,
			pts: (s.pts || []).map((p) => {
				const dx = p[0] - cx;
				const dy = p[1] - cy;
				return [
					cx + dx * cosA - dy * sinA,
					cy + dx * sinA + dy * cosA,
				];
			}),
		}));
	}

	// Resampling eines einzelnen Strichs auf äquidistante Punkte
	function resampleStroke(pts, step = STEP_PIXELS) {
		if (!pts || pts.length === 0) return [];
		if (pts.length === 1) return [[pts[0][0], pts[0][1]], [pts[0][0], pts[0][1]]];
		const out = [[pts[0][0], pts[0][1]]];
		let curDist = 0;

		for (let i = 1; i < pts.length; i++) {
			const p0 = pts[i - 1];
			const p1 = pts[i];
			const segDist = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
			if (segDist < 1e-6) continue;

			let walked = 0;
			while (curDist + (segDist - walked) >= step) {
				const rem = step - curDist;
				walked += rem;
				const t = walked / segDist;
				const nx = p0[0] + (p1[0] - p0[0]) * t;
				const ny = p0[1] + (p1[1] - p0[1]) * t;
				out.push([nx, ny]);
				curDist = 0;
			}
			curDist += (segDist - walked);
		}

		const last = pts[pts.length - 1];
		if (out.length < 2 || Math.hypot(last[0] - out[out.length - 1][0], last[1] - out[out.length - 1][1]) > step * 0.5) {
			out.push([last[0], last[1]]);
		}
		return out;
	}

	// Berechnet die normalisierte Feature-Sequenz für eine Liste von Strichen einer Zeile
	// Rückgabe: Array von [dx, dy, pen_down]
	function extractLineFeatures(lineStrokes, options = {}) {
		// 1. Automatische Begradigung / Deskewing bei schräger Handschrift
		const angle = options.deskew !== false ? estimateOrientation(lineStrokes) : 0;
		const deskewed = (options.deskew !== false && Math.abs(angle) > 0.015) ? deskewStrokes(lineStrokes, angle) : lineStrokes;

		// 2. Normalisierung auf Kleinbuchstaben-Höhe (Median der Strichhöhen) statt Gesamtrahmen
		let minY = Infinity, maxY = -Infinity;
		for (const s of deskewed) {
			const pts = s.pts || s || [];
			for (const p of pts) {
				if (p[1] < minY) minY = p[1];
				if (p[1] > maxY) maxY = p[1];
			}
		}
		const medH = calculateStrokeHeightMedian(deskewed, 10.0);
		const normHeight = options.lineHeight || (medH > 0.1 ? medH : Math.max(5.0, maxY - minY));
		const step = options.step || Math.max(normHeight > 2.0 ? 0.6 : 0.045, normHeight * 0.045);

		const resampledStrokes = [];
		let minX = Infinity, maxX = -Infinity;

		for (const s of deskewed) {
			const pts = s.pts || s || [];
			if (!pts.length) continue;
			const r = resampleStroke(pts, step);
			if (r.length < 2) continue;
			for (const p of r) {
				if (p[0] < minX) minX = p[0];
				if (p[0] > maxX) maxX = p[0];
			}
			resampledStrokes.push(r);
		}

		if (!resampledStrokes.length) return [];

		// Normierungsfaktor: auf Kleinbuchstaben-Höhe (Median) normieren
		const height = normHeight;
		const scale = 1.0 / height;
		const refMinY = options.lineMinY !== undefined ? options.lineMinY : minY;

		const features = [];
		let lastX = null, lastY = null;

		for (let si = 0; si < resampledStrokes.length; si++) {
			const stroke = resampledStrokes[si];
			const firstPt = stroke[0];
			const firstYRel = (firstPt[1] - refMinY) * scale - 0.5;

			if (lastX !== null && lastY !== null) {
				// Stift angehoben (Pen-Up-Sprung zum nächsten Strich)
				const dx = (firstPt[0] - lastX) * scale;
				const dy = (firstPt[1] - lastY) * scale;
				features.push([dx, dy, 0, firstYRel]); // pen_down = 0
			}

			lastX = firstPt[0];
			lastY = firstPt[1];

			for (let pi = 1; pi < stroke.length; pi++) {
				const pt = stroke[pi];
				const dx = (pt[0] - lastX) * scale;
				const dy = (pt[1] - lastY) * scale;
				const yRel = (pt[1] - refMinY) * scale - 0.5;
				features.push([dx, dy, 1, yRel]); // pen_down = 1
				lastX = pt[0];
				lastY = pt[1];
			}
		}

		return features;
	}

	// Berechnet den Median der Strichhöhen als robuste Referenz für die Schrifthöhe
	function calculateStrokeHeightMedian(strokes, fallback = 10.0) {
		if (!strokes || !strokes.length) return fallback;
		const heights = [];
		for (const s of strokes) {
			const pts = s.pts || s;
			if (!pts || pts.length < 2) continue;
			let minY = Infinity, maxY = -Infinity;
			for (const p of pts) {
				const y = p[1];
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
			}
			const h = maxY - minY;
			if (h > 0) heights.push(h);
		}
		if (!heights.length) return fallback;
		heights.sort((a, b) => a - b);
		const mid = Math.floor(heights.length / 2);
		return heights.length % 2 !== 0 ? heights[mid] : (heights[mid - 1] + heights[mid]) / 2;
	}

	// Trennt eine Strichsequenz anhand des relativen horizontalen Abstands (relativ zur Schrifthöhe) in Wörter
	function segmentLineIntoWords(strokes, gapThresh = null, gapFactor = 1.1) {
		if (!strokes || !strokes.length) return [];
		if (gapThresh === null || gapThresh === undefined) {
			const medH = calculateStrokeHeightMedian(strokes);
			gapThresh = Math.max(4.0, gapFactor * medH);
		}
		const getBox = (s) => {
			const pts = s.pts || s;
			let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
			for (const p of pts) {
				const x = p[0], y = p[1];
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
			}
			return { minX, maxX, minY, maxY };
		};

		const words = [];
		let curWord = [strokes[0]];
		let curBox = getBox(strokes[0]);

		for (let i = 1; i < strokes.length; i++) {
			const s = strokes[i];
			const b = getBox(s);
			const gap = b.minX - curBox.maxX;
			if (gap > gapThresh) {
				words.push(curWord);
				curWord = [s];
				curBox = { ...b };
			} else {
				curWord.push(s);
				curBox.maxX = Math.max(curBox.maxX, b.maxX);
				curBox.minY = Math.min(curBox.minY, b.minY);
				curBox.maxY = Math.max(curBox.maxY, b.maxY);
			}
		}
		words.push(curWord);
		return words;
	}

	return {
		strokeBbox,
		filterInkStrokes,
		segmentLines,
		orderLineStrokes,
		estimateOrientation,
		deskewStrokes,
		resampleStroke,
		extractLineFeatures,
		calculateStrokeHeightMedian,
		segmentLineIntoWords,
	};
})();
