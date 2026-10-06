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

	// Gruppiert Striche in Textzeilen (von oben nach unten, darin von links nach rechts)
	function segmentLines(strokes) {
		const valid = filterInkStrokes(strokes);
		if (!valid.length) return [];

		const items = valid.map((s) => ({ stroke: s, bbox: strokeBbox(s) })).filter((item) => item.bbox);
		if (!items.length) return [];

		// Nach vertikalem Zentrum sortieren
		items.sort((a, b) => a.bbox.cy - b.bbox.cy);

		const lines = [];
		for (const item of items) {
			let placed = false;
			for (const line of lines) {
				const lineH = Math.max(20, line.maxY - line.minY);
				const strokeH = Math.max(10, item.bbox.h);
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

		// Innerhalb jeder Zeile Striche von links nach rechts sortieren
		return lines.map((l) => {
			l.items.sort((a, b) => a.bbox.minX - b.bbox.minX);
			return {
				strokes: l.items.map((i) => i.stroke),
				bbox: { minX: l.minX, maxX: l.maxX, minY: l.minY, maxY: l.maxY, h: l.maxY - l.minY, w: l.maxX - l.minX },
			};
		});
	}

	// Schätzt den Neigungswinkel einer Zeile/Strichmenge (in Radiant) via linearer Regression / Trägheitsachse
	function estimateOrientation(strokes) {
		let n = 0, sumX = 0, sumY = 0;
		for (const s of strokes) {
			const pts = s.pts || [];
			for (const p of pts) {
				sumX += p[0];
				sumY += p[1];
				n++;
			}
		}
		if (n < 6) return 0;
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

	// Erkennt 2D-Mathe-Strukturen (insbesondere Bruchstriche mit Zähler und Nenner)
	// Ein Bruchstrich ist charakterisiert durch:
	// 1. Deutlich breiter als hoch (Aspekt-Verhältnis > 3.0)
	// 2. Hat Striche oberhalb (Zähler) UND unterhalb (Nenner)
	function detectFraction(strokes) {
		if (!strokes || strokes.length < 3) return null;
		for (let i = 0; i < strokes.length; i++) {
			const s = strokes[i];
			const box = strokeBbox(s);
			if (!box || box.w < 20 || box.h > 15) continue;
			if (box.w / Math.max(1, box.h) < 2.5) continue; // Kein horizontaler Strich

			// Prüfe, ob andere Striche oberhalb und unterhalb innerhalb der horizontalen Spanne liegen
			const above = [];
			const below = [];
			const side = [];

			for (let j = 0; j < strokes.length; j++) {
				if (i === j) continue;
				const other = strokes[j];
				const obox = strokeBbox(other);
				if (!obox) continue;

				// Horizontale Überlappung mit dem potenziellen Bruchstrich
				const xOverlap = Math.min(box.maxX, obox.maxX) - Math.max(box.minX, obox.minX);
				const horizCoverage = xOverlap / Math.max(1, obox.w);

				if (horizCoverage > 0.4 || (obox.minX >= box.minX - 10 && obox.maxX <= box.maxX + 10)) {
					if (obox.maxY <= box.minY + 5) {
						above.push(other);
					} else if (obox.minY >= box.maxY - 5) {
						below.push(other);
					} else {
						side.push(other);
					}
				} else {
					side.push(other);
				}
			}

			if (above.length > 0 && below.length > 0) {
				return {
					barStroke: s,
					numeratorStrokes: above,
					denominatorStrokes: below,
					sideStrokes: side,
					barBox: box,
				};
			}
		}
		return null;
	}

	// Resampling eines einzelnen Strichs auf äquidistante Punkte
	function resampleStroke(pts, step = STEP_PIXELS) {
		if (pts.length <= 1) return pts.map((p) => [p[0], p[1]]);
		const out = [[pts[0][0], pts[0][1]]];
		let curDist = 0;

		for (let i = 1; i < pts.length; i++) {
			const p0 = pts[i - 1];
			const p1 = pts[i];
			const segDist = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
			if (segDist === 0) continue;

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
		const angle = estimateOrientation(lineStrokes);
		const deskewed = Math.abs(angle) > 0.015 ? deskewStrokes(lineStrokes, angle) : lineStrokes;

		// 2. Ermittle Zeilenhöhe ZUVOR, damit das Resampling streng skaleninvariant ist!
		// Das neuronale Netz erwartet ca. 20-25 Punkte pro Einheits-Höhe (step = 0.045 * height).
		let minY = Infinity, maxY = -Infinity;
		for (const s of deskewed) {
			const pts = s.pts || [];
			for (const p of pts) {
				if (p[1] < minY) minY = p[1];
				if (p[1] > maxY) maxY = p[1];
			}
		}
		const rawHeight = Math.max(10, maxY - minY);
		const step = options.step || Math.max(1.5, rawHeight * 0.045);

		const resampledStrokes = [];
		let minX = Infinity, maxX = -Infinity;
		minY = Infinity; maxY = -Infinity;

		for (const s of deskewed) {
			const pts = s.pts || [];
			if (pts.length === 0) continue;
			const r = resampleStroke(pts, step);
			if (r.length === 0) continue;
			for (const p of r) {
				if (p[0] < minX) minX = p[0];
				if (p[0] > maxX) maxX = p[0];
				if (p[1] < minY) minY = p[1];
				if (p[1] > maxY) maxY = p[1];
			}
			resampledStrokes.push(r);
		}

		if (!resampledStrokes.length) return [];

		// Normierungsfaktor: Zeilenhöhe normieren (auf 1.0 Einheit)
		const height = Math.max(10, maxY - minY);
		const scale = 1.0 / height;

		const features = [];
		let lastX = null, lastY = null;

		for (let si = 0; si < resampledStrokes.length; si++) {
			const stroke = resampledStrokes[si];
			const firstPt = stroke[0];

			if (lastX !== null && lastY !== null) {
				// Stift angehoben (Pen-Up-Sprung zum nächsten Strich)
				const dx = (firstPt[0] - lastX) * scale;
				const dy = (firstPt[1] - lastY) * scale;
				features.push([dx, dy, 0]); // pen_down = 0
			}

			lastX = firstPt[0];
			lastY = firstPt[1];

			for (let pi = 1; pi < stroke.length; pi++) {
				const pt = stroke[pi];
				const dx = (pt[0] - lastX) * scale;
				const dy = (pt[1] - lastY) * scale;
				features.push([dx, dy, 1]); // pen_down = 1
				lastX = pt[0];
				lastY = pt[1];
			}
		}

		return features;
	}

	return {
		strokeBbox,
		filterInkStrokes,
		segmentLines,
		estimateOrientation,
		deskewStrokes,
		detectFraction,
		resampleStroke,
		extractLineFeatures,
	};
})();
