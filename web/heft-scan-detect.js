// heft-scan-detect.js — Dokumenterkennung des Scanners (rein, ohne DOM, ohne Import aus
// heft-scan-pixels.js; dorthin re-exportiert). Ablauf: Analysebild → Kanten und Hough-Linien →
// Viereck-Kandidaten (Linienpaare und alte Masken-Komponenten) → eine gemeinsame Bewertung
// (Kantenstützung, Kontrast, Fläche) → Ausgabe in Originalkoordinaten mit Kanten-Verfeinerung.

// ---------- Geometrie ----------

export const dist2d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function quadArea(q) {
	let a = 0;
	for (let i = 0; i < 4; i++) { const p = q[i], r = q[(i + 1) % 4]; a += p[0] * r[1] - r[0] * p[1]; }
	return Math.abs(a) / 2;
}

export function isConvex(q) {
	let sign = 0;
	for (let i = 0; i < 4; i++) {
		const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
		const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
		if (!z) continue;
		if (!sign) sign = z > 0 ? 1 : -1;
		else if ((z > 0 ? 1 : -1) !== sign) return false;
	}
	return sign !== 0;
}

// ---------- Kanten-Verfeinerung ----------

const REFINE_LINE_STEPS = 24, REFINE_MIN_HITS = 8, REFINE_MIN_GRAD = 8, REFINE_MAX_RESID = 2;
const REFINE_MAX_MOVE = 0.04, REFINE_AREA_MIN = 0.8, REFINE_AREA_MAX = 1.2;

export function toGray(pix) {
	const n = pix.width * pix.height, d = pix.data, g = new Float32Array(n);
	for (let i = 0; i < n; i++) g[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
	return g;
}

function sampleGray(g, w, h, x, y) {
	x = Math.min(w - 1, Math.max(0, x)); y = Math.min(h - 1, Math.max(0, y));
	const x0 = x | 0, y0 = y | 0, x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
	const fx = x - x0, fy = y - y0;
	return (g[y0 * w + x0] * (1 - fx) + g[y0 * w + x1] * fx) * (1 - fy) +
		(g[y1 * w + x0] * (1 - fx) + g[y1 * w + x1] * fx) * fy;
}

// Treffer entlang einer Kante: an 24 Stützpunkten (10…90 %) der stärkste Gradient in ±R.
// Die Richtung ist die des Übergangs Blatt (innen) → Tisch (außen), per Mehrheit über alle
// Stützpunkte in 2R Abstand gemessen. Textkanten im Blatt haben meist die Gegenrichtung
// und werden so nicht mit der Blattkante verwechselt.
function edgeHits(g, gw, gh, a, b, R, cen) {
	const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
	const hits = [];
	if (len < 2) return hits;
	let nx = -dy / len, ny = dx / len;
	// Normale zeigt ins Blatt (zum Viereck-Schwerpunkt)
	if (nx * (cen[0] - (a[0] + b[0]) / 2) + ny * (cen[1] - (a[1] + b[1]) / 2) < 0) { nx = -nx; ny = -ny; }
	const L = (x, y) => sampleGray(g, gw, gh, x, y);
	const pts = [];
	let votes = 0;
	for (let k = 0; k < REFINE_LINE_STEPS; k++) {
		const t = 0.1 + 0.8 * k / (REFINE_LINE_STEPS - 1);
		const px = a[0] + dx * t, py = a[1] + dy * t;
		pts.push([px, py]);
		votes += Math.sign(L(px + nx * 2 * R, py + ny * 2 * R) - L(px - nx * 2 * R, py - ny * 2 * R));
	}
	const pol = votes >= 0 ? 1 : -1;
	for (const [px, py] of pts) {
		// Auf Pixelkanten ist der Gradient ein Plateau: die Mitte aller Maxima gilt
		const grads = [];
		let best = 0;
		for (let s = -R; s <= R; s += 0.5) {
			const qx = px + nx * s, qy = py + ny * s;
			const grad = pol * (L(qx + nx, qy + ny) - L(qx - nx, qy - ny)) / 2;
			grads.push([s, grad]);
			if (grad > best) best = grad;
		}
		if (best < REFINE_MIN_GRAD) continue;
		const peaks = grads.filter(([, grad]) => grad >= best - 1e-6).map(([s]) => s);
		const s = (peaks[0] + peaks[peaks.length - 1]) / 2;
		hits.push([px + nx * s, py + ny * s]);
	}
	return hits;
}

// Total-Least-Squares-Gerade (Hauptachse der Punktwolke)
function fitLine(pts) {
	let mx = 0, my = 0;
	for (const p of pts) { mx += p[0]; my += p[1]; }
	mx /= pts.length; my /= pts.length;
	let sxx = 0, syy = 0, sxy = 0;
	for (const p of pts) {
		const dx = p[0] - mx, dy = p[1] - my;
		sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
	}
	const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
	return { c: [mx, my], u: [Math.cos(th), Math.sin(th)] };
}

function residual(line, p) {
	return Math.abs((p[0] - line.c[0]) * -line.u[1] + (p[1] - line.c[1]) * line.u[0]);
}

// Gerade durch die Treffer; Ausreißer (> 2 px) fliegen raus, dann neu gefittet.
// Zu wenige Treffer → null (Aufrufer behält die ursprüngliche Kante).
function fitEdge(pts) {
	if (pts.length < REFINE_MIN_HITS) return null;
	const line = fitLine(pts);
	const inliers = pts.filter((p) => residual(line, p) <= REFINE_MAX_RESID);
	if (inliers.length < REFINE_MIN_HITS) return null;
	return inliers.length === pts.length ? line : fitLine(inliers);
}

function lineThrough(a, b) {
	const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
	return { c: [a[0], a[1]], u: [(b[0] - a[0]) / len, (b[1] - a[1]) / len] };
}

// Schnittpunkt zweier Geraden (null bei Parallelen)
function intersectLines(l1, l2) {
	const den = l1.u[0] * l2.u[1] - l1.u[1] * l2.u[0];
	if (Math.abs(den) < 1e-6) return null;
	const dx = l2.c[0] - l1.c[0], dy = l2.c[1] - l1.c[1];
	const t = (dx * l2.u[1] - dy * l2.u[0]) / den;
	return [l1.c[0] + t * l1.u[0], l1.c[1] + t * l1.u[1]];
}

// Verfeinert ein Viereck (Koordinaten in gray-Auflösung) auf die echten Blattkanten.
// Jede Ecke wandert höchstens 4 % der Quad-Diagonale; ist das Ergebnis nicht konvex
// oder die Fläche unplausibel, kommt das unveränderte Viereck zurück.
export function refineQuadPixels(gray, gw, gh, quad) {
	const diag = Math.max(dist2d(quad[0], quad[2]), dist2d(quad[1], quad[3]));
	const R = Math.max(6, 0.015 * Math.hypot(gw, gh));
	const cen = [(quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0]) / 4, (quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1]) / 4];
	const lines = [];
	for (let e = 0; e < 4; e++) {
		const a = quad[e], b = quad[(e + 1) % 4];
		lines.push(fitEdge(edgeHits(gray, gw, gh, a, b, R, cen)) || lineThrough(a, b));
	}
	const out = [];
	for (let i = 0; i < 4; i++) {
		// Ecke i liegt zwischen Kante i-1 und Kante i
		const x = intersectLines(lines[(i + 3) % 4], lines[i]);
		out.push(x && dist2d(x, quad[i]) <= REFINE_MAX_MOVE * diag ? x : quad[i].slice());
	}
	const unchanged = quad.map((p) => p.slice());
	if (!isConvex(out)) return unchanged;
	const a0 = quadArea(quad), a1 = quadArea(out);
	if (a0 < 1 || a1 < a0 * REFINE_AREA_MIN || a1 > a0 * REFINE_AREA_MAX) return unchanged;
	return out;
}


// ---------- Dokumenterkennung (rein, ohne Canvas) ----------

// Analyse- und Verfeinerungsauflösung. Worker und Hauptthread skalieren damit identisch.
export const DETECT_MAX = 720, REFINE_MAX = 1600;

export function detectSizes(w, h) {
	const dw = Math.min(DETECT_MAX, w), kk = dw / w, dh = Math.max(12, Math.round(h * kk));
	const kr = Math.min(1, REFINE_MAX / Math.max(w, h, 1));
	return { dw, dh, gw: Math.max(2, Math.round(w * kr)), gh: Math.max(2, Math.round(h * kr)) };
}

export function fullQuadPixels(w, h) {
	return [[0, 0], [Math.max(0, w - 1), 0], [Math.max(0, w - 1), Math.max(0, h - 1)], [0, Math.max(0, h - 1)]];
}

// Konvexe Hülle (Andrew Monotone Chain) — Grundlage der Eckensuche
function convexHull(pts) {
	const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	if (p.length < 3) return p;
	const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
	const lower = [];
	for (const pt of p) {
		while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
		lower.push(pt);
	}
	const upper = [];
	for (let i = p.length - 1; i >= 0; i--) {
		const pt = p[i];
		while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
		upper.push(pt);
	}
	lower.pop(); upper.pop();
	return lower.concat(upper);
}

// Separabler Box-Blur mit Gleitsumme — O(n) statt O(n·r²)
function blurMap(src, dw, dh, r) {
	const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
	const pass = (inp, outp, len, stride, lines, lineStride) => {
		for (let l = 0; l < lines; l++) {
			const base = l * lineStride;
			let acc = 0;
			for (let i = -r; i <= r; i++) acc += inp[base + Math.min(len - 1, Math.max(0, i)) * stride];
			for (let i = 0; i < len; i++) {
				outp[base + i * stride] = acc / (2 * r + 1);
				acc += inp[base + Math.min(len - 1, i + r + 1) * stride] - inp[base + Math.max(0, i - r) * stride];
			}
		}
	};
	pass(src, tmp, dw, 1, dh, dw);
	pass(tmp, out, dh, dw, dw, 1);
	return out;
}

// Separable Morphologie: pick=1 Dilatation, pick=0 Erosion (Radius 2)
function morphPass(src, dw, dh, pick) {
	const n = dw * dh, mid = new Uint8Array(n), out = new Uint8Array(n);
	for (let i = 0; i < n; i++) {
		const x = i % dw;
		let v = src[i] === pick;
		for (let k = 1; k <= 2 && !v; k++) v = (x - k >= 0 && src[i - k] === pick) || (x + k < dw && src[i + k] === pick);
		mid[i] = v ? pick : 1 - pick;
	}
	for (let i = 0; i < n; i++) {
		const y = (i / dw) | 0;
		let v = mid[i] === pick;
		for (let k = 1; k <= 2 && !v; k++) v = (y - k >= 0 && mid[i - k * dw] === pick) || (y + k < dh && mid[i + k * dw] === pick);
		out[i] = v ? pick : 1 - pick;
	}
	return out;
}

// Flächenmaximales konvexes Viereck in der Hülle einer Blattgrenze (Ecken tl→tr→br→bl).
// null, wenn die Hülle kein Viereck hergibt.
function quadFromBoundary(boundary) {
	const hull = convexHull(boundary);
	if (hull.length < 4) return null;
	// Start-Viereck aus Extrempunkten (x+y bzw. x−y) …
	let tl = hull[0], tr = hull[0], br = hull[0], bl = hull[0];
	for (const p of hull) {
		if (p[0] + p[1] < tl[0] + tl[1]) tl = p;
		if (p[0] + p[1] > br[0] + br[1]) br = p;
		if (p[0] - p[1] > tr[0] - tr[1]) tr = p;
		if (p[0] - p[1] < bl[0] - bl[1]) bl = p;
	}
	const quad = [tl, tr, br, bl];
	// … dann Ecken gegen Hüllpunkte tauschen, solange die Fläche wächst.
	let improved = true, guard = 0;
	while (improved && guard++ < 10) {
		improved = false;
		for (let ci = 0; ci < 4; ci++) {
			let bestA = quadArea(quad), bestP = quad[ci];
			for (const p of hull) {
				const q2 = [quad[0], quad[1], quad[2], quad[3]];
				q2[ci] = p;
				const a2 = quadArea(q2);
				if (a2 > bestA + 0.5 && isConvex(q2)) { bestA = a2; bestP = p; }
			}
			if (bestP !== quad[ci]) { quad[ci] = bestP; improved = true; }
		}
	}
	return orderQuad(quad);
}


// ---------- Erkennung: Linien (Hough) ----------

// Hough-Linien: θ in 1°-Schritten, Stimmen nur innerhalb ±HOUGH_TOL° der Gradientenrichtung
const HOUGH_DEG = 180, HOUGH_HALF = 90, HOUGH_TOL = 6, HOUGH_PEAKS = 24, HOUGH_MIN_FRAC = 0.12;
// Gegenseiten „ungefähr parallel“ (Perspektive), Nachbarseiten mindestens 40° auseinander
const PAR_DEG = 35, ADJ_DEG = 40, PAIR_KEEP = 40;
// Bewertung je Seite: Abtastpunkte, Toleranz quer zur Seite, Richtungsfehler des Gradienten
const SIDE_SAMPLES = 40, SIDE_TOL = 6, SIDE_DIR_COS = Math.cos(25 * Math.PI / 180), SIDE_CONTRAST_OFF = 6;
const EDGE_CANDIDATES = 6; // Masken-Komponenten, die als Vierecke mitbewertet werden
// Kantenstützung unter diesem Wert gilt als unsicher → ganzes Bild
const SIDE_SUP_MIN = 0.3;
// Kantenschwelle für den Gradientenbetrag (Sobel-Einheiten auf 0…255-Graustufen)
const EDGE_MIN = 25;

// Analysebild einmal aufbereiten: Helligkeit, Farbe, Gradient und Kanten (NMS + Hysterese).
function buildContext(analysis, w, h) {
	const dw = analysis.width, dh = analysis.height, d = analysis.data, n = dw * dh;
	const L = new Float32Array(n), sat = new Float32Array(n);
	const ca = new Float32Array(n), cb = new Float32Array(n), edge = new Float32Array(n);
	let sumL = 0, borderL = 0, borderA = 0, borderB = 0, borderN = 0;
	for (let i = 0; i < n; i++) {
		const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
		const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
		L[i] = r * 0.299 + g * 0.587 + b * 0.114;
		sat[i] = mx ? (mx - mn) / mx : 0;
		ca[i] = r - g; cb[i] = b - g; sumL += L[i];
		const y = (i / dw) | 0, x = i % dw;
		if (x < 3 || y < 3 || x >= dw - 3 || y >= dh - 3) {
			borderL += L[i]; borderA += ca[i]; borderB += cb[i]; borderN++;
		}
	}
	borderL /= Math.max(1, borderN); borderA /= Math.max(1, borderN); borderB /= Math.max(1, borderN);
	let edgeSum = 0;
	for (let y = 1; y < dh - 1; y++) for (let x = 1; x < dw - 1; x++) {
		const i = y * dw + x;
		edge[i] = Math.abs(L[i + 1] - L[i - 1]) + Math.abs(L[i + dw] - L[i - dw]);
		edgeSum += edge[i];
	}
	// Geglättetes Graubild für Gradient und Kontrastmessung (zwei 3×3-Boxen)
	const S = blurMap(blurMap(L, dw, dh, 1), dw, dh, 1);
	const gx = new Float32Array(n), gy = new Float32Array(n), mag = new Float32Array(n);
	for (let y = 1; y < dh - 1; y++) for (let x = 1; x < dw - 1; x++) {
		const i = y * dw + x;
		gx[i] = S[i - dw + 1] + 2 * S[i + 1] + S[i + dw + 1] - S[i - dw - 1] - 2 * S[i - 1] - S[i + dw - 1];
		gy[i] = S[i + dw - 1] + 2 * S[i + dw] + S[i + dw + 1] - S[i - dw - 1] - 2 * S[i - dw] - S[i - dw + 1];
		mag[i] = Math.hypot(gx[i], gy[i]);
	}
	// Kantenpixel: Gradientenbetrag über fester Schwelle. Bewusst ohne Non-Maximum-Suppression:
	// Kanten bleiben dick genug, dass ein Versatz von 1–2 px sie nicht verfehlt.
	const hi = EDGE_MIN, E = new Uint8Array(n);
	for (let i = 0; i < n; i++) E[i] = mag[i] >= hi ? 1 : 0;
	return {
		dw, dh, n, kk: dw / w, L, sat, ca, cb, edge, S, gx, gy, mag, E, hi,
		meanL: sumL / n, borderL, borderA, borderB, edgeThr: Math.max(18, edgeSum / n * 2.35),
	};
}

// Hough-Transformation mit (ρ, θ), ρ = x·cosθ + y·sinθ. Liefert die stärksten Geraden (gierig,
// jede Umgebung wird nach einem Treffer gesperrt).
function houghLines(ctx) {
	const { dw, dh, n, gx, gy, mag, E, hi } = ctx;
	const D = Math.ceil(Math.hypot(dw, dh)), RW = 2 * D + 1;
	const acc = new Float32Array(HOUGH_DEG * RW);
	const cosT = new Float64Array(HOUGH_DEG), sinT = new Float64Array(HOUGH_DEG);
	for (let t = 0; t < HOUGH_DEG; t++) {
		cosT[t] = Math.cos(t * Math.PI / HOUGH_DEG); sinT[t] = Math.sin(t * Math.PI / HOUGH_DEG);
	}
	for (let i = 0; i < n; i++) {
		if (!E[i]) continue;
		const x = i % dw, y = (i / dw) | 0, wgt = Math.min(2, mag[i] / hi);
		// Die Gradientenrichtung steht senkrecht zur Kante: Normalenwinkel der Geraden ≈ Gradientenwinkel
		const phi = Math.round(Math.atan2(gy[i], gx[i]) * 180 / Math.PI);
		for (let dt = -HOUGH_TOL; dt <= HOUGH_TOL; dt++) {
			const t = (((phi + dt) % HOUGH_DEG) + HOUGH_DEG) % HOUGH_DEG;
			acc[t * RW + Math.round(x * cosT[t] + y * sinT[t]) + D] += wgt;
		}
	}
	const lines = [], minScore = HOUGH_MIN_FRAC * Math.min(dw, dh);
	for (let k = 0; k < HOUGH_PEAKS; k++) {
		let best = 0, bi = -1;
		for (let i = 0; i < acc.length; i++) if (acc[i] > best) { best = acc[i]; bi = i; }
		if (bi < 0 || best < minScore) break;
		const t = (bi / RW) | 0, r = bi - t * RW;
		lines.push({ t, c: cosT[t], s: sinT[t], rho: r - D, score: best });
		// Umgebung sperren (±5°, ±8 px), damit dieselbe Kante nicht zweimal gewinnt
		for (let dt = -5; dt <= 5; dt++) {
			const tt = t + dt;
			if (tt < 0 || tt >= HOUGH_DEG) continue;
			for (let dr = Math.max(0, r - 8); dr <= Math.min(RW - 1, r + 8); dr++) acc[tt * RW + dr] = 0;
		}
	}
	return lines;
}

// Winkel zwischen zwei Geraden in Grad, 0…90 (Richtungen ohne Vorzeichen)
function lineAngleDeg(a, b) {
	const d = Math.abs(a.t - b.t) % HOUGH_DEG;
	return Math.min(d, HOUGH_DEG - d);
}

// Abstand zweier fast paralleler Geraden in Pixeln (Vorzeichen-Wechsel bei θ-Überlauf beachten)
function lineSeparation(a, b) {
	return Math.abs(Math.abs(a.t - b.t) <= HOUGH_HALF ? a.rho - b.rho : a.rho + b.rho);
}

// Schnittpunkt zweier Geraden (Normalform), null bei Parallelen
function houghIntersect(a, b) {
	const det = a.c * b.s - a.s * b.c;
	if (Math.abs(det) < 1e-6) return null;
	return [(a.rho * b.s - a.s * b.rho) / det, (a.c * b.rho - a.rho * b.c) / det];
}

// Ungefähr parallele Linienpaare, nach Stärke sortiert und auf PAIR_KEEP begrenzt
function linePairs(lines, dw, dh) {
	const minSep = 0.08 * Math.min(dw, dh), pairs = [];
	for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
		const a = lines[i], b = lines[j];
		if (lineAngleDeg(a, b) > PAR_DEG || lineSeparation(a, b) < minSep) continue;
		pairs.push([a, b, a.score + b.score]);
	}
	pairs.sort((p, q) => q[2] - p[2]);
	return pairs.slice(0, PAIR_KEEP);
}

// Vierecke aus zwei Linienpaaren: jedes Paar bildet ein Gegenseitenpaar, die beiden Paare
// kreuzen sich mit mindestens ADJ_DEG Unterschied. Ecken dürfen höchstens 3 % der Diagonale
// außerhalb des Bildes liegen (dann klemmen sie an den Rand).
function lineQuads(ctx, lines) {
	const { dw, dh } = ctx, pairs = linePairs(lines, dw, dh), out = [];
	const tol = 0.03 * Math.hypot(dw, dh);
	const cross = (P, Q) => [P[0], P[1]].every((a) => [Q[0], Q[1]].every((b) => lineAngleDeg(a, b) >= ADJ_DEG));
	for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
		const [a0, a1] = pairs[i], [b0, b1] = pairs[j];
		if (!cross(pairs[i], pairs[j])) continue;
		// Umlauf: a0∩b0 → a1∩b0 → a1∩b1 → a0∩b1 (jede Seite liegt auf genau einer Linie)
		const c = [houghIntersect(a0, b0), houghIntersect(a1, b0), houghIntersect(a1, b1), houghIntersect(a0, b1)];
		if (c.some((p) => !p || p[0] < -tol || p[1] < -tol || p[0] > dw - 1 + tol || p[1] > dh - 1 + tol)) continue;
		const quad = c.map((p) => [Math.min(dw - 1, Math.max(0, p[0])), Math.min(dh - 1, Math.max(0, p[1]))]);
		if (isConvex(quad)) out.push(quad);
	}
	return out;
}

// ---------- Erkennung: Masken (alter Weg, bleibt als Kandidatenquelle) ----------

// Helle Fläche, Farbe gegen den Tisch und kantenumschlossene Fläche als Masken; die stärksten
// Komponenten werden zu Vierecken. Bewertet wird wie bei den Linien (scoreQuad).
function maskQuads(ctx) {
	const { dw, dh, n, L, sat, ca, cb, borderL, borderA, borderB, meanL, edge, edgeThr } = ctx;
	const blur = blurMap(L, dw, dh, Math.max(5, Math.round(dw / 70)));
	const lightMask = new Uint8Array(n), colorMask = new Uint8Array(n);
	// Ein fester, globaler Helligkeitsboden schnitt beschattete Papierbereiche aus.
	const thrPaper = Math.max(58, meanL * 0.55);
	for (let i = 0; i < n; i++) {
		const colorDelta = Math.hypot((L[i] - borderL) * 0.75, ca[i] - borderA, cb[i] - borderB);
		lightMask[i] = L[i] >= thrPaper && sat[i] < 0.48 && L[i] >= blur[i] * 0.78 ? 1 : 0;
		colorMask[i] = L[i] > 32 && colorDelta > 13 && (sat[i] < 0.72 || L[i] > borderL + 12) ? 1 : 0;
	}
	// Starke Kanten bilden eine Barriere. Vom Außenrand wird der Tisch geflutet;
	// was von einer geschlossenen Blattkante umschlossen bleibt, ist Kandidat 3.
	const edgeBarrier = new Uint8Array(n), outside = new Uint8Array(n), flood = new Int32Array(n);
	for (let i = 0; i < n; i++) edgeBarrier[i] = edge[i] >= edgeThr ? 1 : 0;
	const barrier = morphPass(edgeBarrier, dw, dh, 1);
	let ft = 0;
	const seed = (i) => { if (!outside[i] && !barrier[i]) { outside[i] = 1; flood[ft++] = i; } };
	for (let x = 0; x < dw; x++) { seed(x); seed((dh - 1) * dw + x); }
	for (let y = 1; y < dh - 1; y++) { seed(y * dw); seed(y * dw + dw - 1); }
	while (ft) {
		const p = flood[--ft], x = p % dw, y = (p / dw) | 0;
		if (x > 0) seed(p - 1); if (x < dw - 1) seed(p + 1);
		if (y > 0) seed(p - dw); if (y < dh - 1) seed(p + dw);
	}
	const enclosedMask = new Uint8Array(n);
	for (let i = 0; i < n; i++) enclosedMask[i] = outside[i] || barrier[i] ? 0 : 1;
	// Closing füllt Textlöcher, anschließendes Opening entfernt kleine Reflexe.
	const masks = [lightMask, colorMask, enclosedMask].map((m) => {
		const closed = morphPass(morphPass(m, dw, dh, 1), dw, dh, 0);
		return morphPass(morphPass(closed, dw, dh, 0), dw, dh, 1);
	});
	// Bei Schatten kann eine einzelne Maske genau eine Ecke verlieren. Ein vierter,
	// konservativer Kandidat vereinigt die unabhängigen Hinweise.
	const combinedMask = new Uint8Array(n);
	for (let i = 0; i < n; i++) combinedMask[i] = (lightMask[i] && (colorMask[i] || enclosedMask[i])) || (colorMask[i] && enclosedMask[i]) ? 1 : 0;
	const combinedClosed = morphPass(morphPass(combinedMask, dw, dh, 1), dw, dh, 0);
	masks.push(morphPass(morphPass(combinedClosed, dw, dh, 0), dw, dh, 1));
	const stack = new Int32Array(n), cands = [];
	for (let mi = 0; mi < masks.length; mi++) {
		const mask = masks[mi], seen = new Uint8Array(n);
		for (let s0 = 0; s0 < n; s0++) {
			if (!mask[s0] || seen[s0]) continue;
			let top = 0, area = 0, touches = 0, edgeSum = 0;
			let minX = dw, maxX = 0, minY = dh, maxY = 0;
			const boundary = [];
			stack[top++] = s0; seen[s0] = 1;
			while (top) {
				const p = stack[--top], py = (p / dw) | 0, pxx = p % dw; area++;
				if (pxx < minX) minX = pxx; if (pxx > maxX) maxX = pxx;
				if (py < minY) minY = py; if (py > maxY) maxY = py;
				let bnd = pxx <= 0 || py <= 0 || pxx >= dw - 1 || py >= dh - 1;
				if (bnd) touches++;
				if (pxx > 0) { const j = p - 1; if (mask[j]) { if (!seen[j]) { seen[j] = 1; stack[top++] = j; } } else bnd = true; }
				if (pxx < dw - 1) { const j = p + 1; if (mask[j]) { if (!seen[j]) { seen[j] = 1; stack[top++] = j; } } else bnd = true; }
				if (py > 0) { const j = p - dw; if (mask[j]) { if (!seen[j]) { seen[j] = 1; stack[top++] = j; } } else bnd = true; }
				if (py < dh - 1) { const j = p + dw; if (mask[j]) { if (!seen[j]) { seen[j] = 1; stack[top++] = j; } } else bnd = true; }
				if (bnd) { boundary.push([pxx, py]); edgeSum += edge[p]; }
			}
			if (area < n * 0.075 || area > n * 0.965 || boundary.length < 20) continue;
			const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
			const fill = Math.min(1, area / (bw * bh)), aspect = bw / bh;
			if (aspect < 0.24 || aspect > 4.2) continue;
			const cx2 = (minX + maxX) / 2, cy2 = (minY + maxY) / 2;
			const centerPenalty = Math.hypot(cx2 - dw / 2, cy2 - dh / 2) / Math.hypot(dw, dh);
			const edgeBonus = Math.min(1.8, edgeSum / Math.max(1, boundary.length * edgeThr));
			const touchPenalty = 1 - Math.min(0.72, touches / Math.max(1, boundary.length) * 2.5);
			const sc = area * (0.45 + fill) * (0.8 + edgeBonus) * touchPenalty * (1 - centerPenalty * 0.35) * (mi >= 2 ? 1.08 : 1);
			cands.push({ sc, boundary });
		}
	}
	cands.sort((p, q) => q.sc - p.sc);
	return cands.slice(0, EDGE_CANDIDATES).map((c) => quadFromBoundary(c.boundary)).filter(Boolean);
}

// ---------- Erkennung: gemeinsame Bewertung ----------

// Trifft ein Kantenpixel quer zur Seite (±SIDE_TOL) mit passender Gradientenrichtung?
function sideHit(ctx, px, py, nx, ny) {
	const { dw, dh, E, gx, gy, mag } = ctx;
	for (let s = -SIDE_TOL; s <= SIDE_TOL; s++) {
		const x = Math.round(px + nx * s), y = Math.round(py + ny * s);
		if (x < 1 || y < 1 || x >= dw - 1 || y >= dh - 1) continue;
		const i = y * dw + x;
		if (E[i] && Math.abs(gx[i] * nx + gy[i] * ny) >= mag[i] * SIDE_DIR_COS) return true;
	}
	return false;
}

// Bewertung eines Vierecks (Analyse-Auflösung). sup = Kantenstützung 0…1 (Mittel aus Minimum und
// Mittel über die 4 Seiten: eine Seite ohne Kante drückt den Wert), sc = Auswahlgewicht.
// null, wenn Winkel oder Seitenlängen unplausibel sind.
function scoreQuad(q, ctx) {
	const { dw, dh, S } = ctx;
	const minSide = 0.08 * Math.min(dw, dh);
	for (let i = 0; i < 4; i++) {
		const p = q[i], a = q[(i + 3) % 4], b = q[(i + 1) % 4];
		const ux = a[0] - p[0], uy = a[1] - p[1], vx = b[0] - p[0], vy = b[1] - p[1];
		const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
		if (lu < minSide || lv < minSide) return null;
		const cosA = (ux * vx + uy * vy) / (lu * lv);
		if (cosA > Math.SQRT1_2 || cosA < -Math.SQRT1_2) return null;
	}
	const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
	let supMin = 1, supSum = 0, conSum = 0, bright = 0;
	for (let e = 0; e < 4; e++) {
		const a = q[e], b = q[(e + 1) % 4];
		const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
		let nx = -dy / len, ny = dx / len;
		// Normale zeigt ins Viereck
		if (nx * (cx - (a[0] + b[0]) / 2) + ny * (cy - (a[1] + b[1]) / 2) < 0) { nx = -nx; ny = -ny; }
		let hits = 0, diff = 0;
		for (let k = 0; k < SIDE_SAMPLES; k++) {
			const t = (k + 0.5) / SIDE_SAMPLES, px = a[0] + dx * t, py = a[1] + dy * t;
			if (sideHit(ctx, px, py, nx, ny)) hits++;
			const o = SIDE_CONTRAST_OFF;
			diff += sampleGray(S, dw, dh, px + nx * o, py + ny * o) - sampleGray(S, dw, dh, px - nx * o, py - ny * o);
		}
		const sup = hits / SIDE_SAMPLES, dm = diff / SIDE_SAMPLES;
		supMin = Math.min(supMin, sup); supSum += sup; conSum += Math.abs(dm);
		if (dm > 0) bright++;
	}
	const sup = (supMin + supSum / 4) / 2;
	// Kontrast über die Kanten (≈30 Helligkeitsstufen = volle Wertung); helles Papier leicht bevorzugt
	const cf = Math.min(1, conSum / 4 / 30);
	const frac = quadArea(q) / (dw * dh);
	// Große Vierecke bevorzugen, Vollbild-Kandidaten (fast das ganze Bild) abwerten
	const areaF = Math.sqrt(frac) * (frac > 0.92 ? 0.5 : 1);
	const sc = sup * sup * (0.4 + 0.6 * cf) * (0.85 + 0.15 * bright / 4) * areaF;
	return { sc, sup };
}

// Ecken in die Reihenfolge tl→tr→br→bl bringen (Winkel um den Schwerpunkt, Start = kleinstes x+y)
function orderQuad(quad) {
	const cqx = (quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0]) / 4;
	const cqy = (quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1]) / 4;
	const q = quad.slice().sort((a, b) => Math.atan2(a[1] - cqy, a[0] - cqx) - Math.atan2(b[1] - cqy, b[0] - cqx));
	let st = 0;
	for (let i = 1; i < 4; i++) if (q[i][0] + q[i][1] < q[st][0] + q[st][1]) st = i;
	return q.slice(st).concat(q.slice(0, st));
}

// Vom Analyse-Viereck zur Ausgabe: Originalkoordinaten, Kanten-Verfeinerung, Einzug, Plausibilität.
// null, wenn das Ergebnis unplausibel ist (der Aufrufer nimmt dann das ganze Bild).
function finishQuad(quad, ctx, w, h, refine) {
	const q0 = orderQuad(quad).map((p) => [p[0] / ctx.kk, p[1] / ctx.kk]);
	let q = q0;
	if (refine) {
		try {
			const sx = refine.gw / w, sy = refine.gh / h;
			const res = refineQuadPixels(refine.gray, refine.gw, refine.gh, q0.map((p) => [p[0] * sx, p[1] * sy]));
			q = res.map((p) => [p[0] / sx, p[1] / sy]);
		} catch (e) {
			console.warn("Heft: Kanten-Verfeinerung übersprungen", e);
		}
	}
	// Leicht nach innen (≈0,5 %): die Antialiasing-Kante zwischen Blatt und Tisch würde
	// sonst als 1–2 px dunkler Strich im Scan stehen (S/W macht ihn schwarz, OCR liest „|“).
	const ccx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4;
	const ccy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
	for (const p of q) {
		p[0] = Math.max(0, Math.min(w - 1, ccx + (p[0] - ccx) * 0.99));
		p[1] = Math.max(0, Math.min(h - 1, ccy + (p[1] - ccy) * 0.99));
	}
	const areaQ = quadArea(q);
	if (areaQ < w * h * 0.1 || areaQ > w * h * 0.985 || !isConvex(q)) return null;
	for (let i = 0; i < 4; i++) if (Math.hypot(q[i][0] - q[(i + 1) % 4][0], q[i][1] - q[(i + 1) % 4][1]) < Math.min(w, h) * 0.12) return null;
	return q;
}

// ---------- Dokumenterkennung ----------

// Bestes bewertetes Viereck einer Kandidatenliste (oder null)
function bestQuad(quads, ctx) {
	let best = null;
	for (const quad of quads) {
		const s = scoreQuad(quad, ctx);
		if (s && (!best || s.sc > best.sc)) best = { quad, sc: s.sc, sup: s.sup };
	}
	return best;
}

// Dokumenterkennung v5. analysis = { data, width, height } (RGBA, ≤ DETECT_MAX breit, Größe
// aus detectSizes). w, h = Originalgröße. refine = { gray, gw, gh } (Graubild aus toGray,
// ≤ REFINE_MAX) oder null (dann ohne Kanten-Verfeinerung). Ergebnis in Originalkoordinaten.
// Linien-Vierecke und Masken-Vierecke werden mit derselben Bewertung verglichen; das beste
// gewinnt. Bei unsicherer Erkennung IMMER das ganze Bild — niemals Inhalt abschneiden.
export function detectQuadPixels(analysis, w, h, refine) {
	const full = fullQuadPixels(w, h);
	if (!w || !h) return full;
	try {
		const ctx = buildContext(analysis, w, h);
		const best = bestQuad(lineQuads(ctx, houghLines(ctx)).concat(maskQuads(ctx)), ctx);
		if (!best || best.sup < SIDE_SUP_MIN) return full;
		return finishQuad(best.quad, ctx, w, h, refine) || full;
	} catch (e) {
		console.warn("Heft: Dokumenterkennung fehlgeschlagen", e);
		return full;
	}
}
