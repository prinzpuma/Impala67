"use strict";

// heft-scan.js — Bildverarbeitungs-Kern des Dokument-Scanners (am 15. Juli 2026
// unverändert aus heft.js ausgelagert). Reine Funktionen ohne Modul-Zustand:
// Blatt-Erkennung → perspektivische Entzerrung → Beleuchtung/Filter → Qualität.
// Kamera-/Overlay-UI und der Scan-Ablauf leben weiterhin in heft.js.
export const SCANCORE = (() => {
	// Pipeline wie GoodNotes/Office Lens: Aufnahme → Blatt-Erkennung → perspektivische
	// Entzerrung → Beleuchtung rausrechnen + Filter → Nachbearbeitung → PDF/Heftseiten.
	// Erkennung v4: Papier-Maske (hell + unbunt + nicht dunkler als lokaler Hintergrund)
	// → größte plausible Fläche → konvexe Hülle → flächenmaximales Viereck. Das findet
	// im Gegensatz zur alten Extrempunkt-Suche auch GEDREHTE Blätter zuverlässig.
	const SCAN_MODES = [["color", "Farbe"], ["bw", "S/W"], ["gray", "Graustufen"], ["photo", "Foto"]];
	const loadImg = (src) => new Promise((res, rej) => {
		const im = new Image();
		im.onload = () => res(im);
		im.onerror = () => rej(new Error("Bild dekodieren fehlgeschlagen"));
		im.src = src;
	});
	const dist2d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
	function quadArea(q) {
		let a = 0;
		for (let i = 0; i < 4; i++) { const p = q[i], r = q[(i + 1) % 4]; a += p[0] * r[1] - r[0] * p[1]; }
		return Math.abs(a) / 2;
	}
	function isConvex(q) {
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
	// Separabler Box-Blur mit Gleitsumme — O(n) statt O(n·r²) wie der alte 5×5-Schleifen-Blur
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
	// Dokumenterkennung v4. Gibt bei unsicherer Erkennung IMMER das ganze Bild
	// zurück — niemals Inhalt abschneiden.
	function detectQuad(img, w, h) {
		const full = [[0, 0], [Math.max(0, w - 1), 0], [Math.max(0, w - 1), Math.max(0, h - 1)], [0, Math.max(0, h - 1)]];
		if (!w || !h) return full;
		try {
			// Aufnahme: mehr Analyseauflösung für präzisere Ecken. Die Live-Vorschau
			// bleibt klein, weil ihr Bild ohnehin nur 240 px breit ist.
			const dw = Math.min(720, w), kk = dw / w, dh = Math.max(12, Math.round(h * kk));
			const c = document.createElement("canvas");
			c.width = dw; c.height = dh;
			const cx = c.getContext("2d", { willReadFrequently: true });
			cx.drawImage(img, 0, 0, dw, dh);
			const d = cx.getImageData(0, 0, dw, dh).data;
			const n = dw * dh;
			const L = new Float32Array(n), sat = new Float32Array(n);
			const ca = new Float32Array(n), cb = new Float32Array(n), edge = new Float32Array(n);
			let sumL = 0, borderL = 0, borderA = 0, borderB = 0, borderN = 0;
			for (let i = 0; i < n; i++) {
				const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
				const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
				L[i] = r * 0.299 + g * 0.587 + b * 0.114;
				sat[i] = mx ? (mx - mn) / mx : 0;
				ca[i] = r - g; cb[i] = b - g; sumL += L[i];
				const y = (i / dw) | 0, x2 = i % dw;
				if (x2 < 3 || y < 3 || x2 >= dw - 3 || y >= dh - 3) {
					borderL += L[i]; borderA += ca[i]; borderB += cb[i]; borderN++;
				}
			}
			borderL /= Math.max(1, borderN); borderA /= Math.max(1, borderN); borderB /= Math.max(1, borderN);
			for (let y = 1; y < dh - 1; y++) for (let x2 = 1; x2 < dw - 1; x2++) {
				const i = y * dw + x2;
				const gx = L[i + 1] - L[i - 1], gy = L[i + dw] - L[i - dw];
				edge[i] = Math.abs(gx) + Math.abs(gy);
			}
			const meanL = sumL / n;
			const blur = blurMap(L, dw, dh, Math.max(5, Math.round(dw / 70)));
			// Drei voneinander unabhängige Segmentierungen: helles Papier, Farbe gegen
			// den am Bildrand gemessenen Tisch und eine kantenumschlossene Fläche. So
			// funktionieren auch cremefarbene Blätter und weißes Papier auf hellem Tisch.
			const lightMask = new Uint8Array(n), colorMask = new Uint8Array(n);
			// Ein fester, globaler Helligkeitsboden schnitt beschattete Papierbereiche
			// (häufig die untere Blattkante, wo Hand/Telefon Licht blockieren) aus der
			// Papiermaske heraus — die erkannten Ecken rückten dann nach innen.
			const thrPaper = Math.max(58, meanL * 0.55);
			for (let i = 0; i < n; i++) {
				const colorDelta = Math.hypot((L[i] - borderL) * 0.75, ca[i] - borderA, cb[i] - borderB);
				lightMask[i] = L[i] >= thrPaper && sat[i] < 0.48 && L[i] >= blur[i] * 0.78 ? 1 : 0;
				colorMask[i] = L[i] > 32 && colorDelta > 13 && (sat[i] < 0.72 || L[i] > borderL + 12) ? 1 : 0;
			}
			// Starke Kanten bilden eine Barriere. Vom Außenrand wird der Tisch geflutet;
			// was von einer geschlossenen Blattkante umschlossen bleibt, ist Kandidat 3.
			const edgeBarrier = new Uint8Array(n), outside = new Uint8Array(n), flood = new Int32Array(n);
			let edgeMean = 0;
			for (let i = 0; i < n; i++) edgeMean += edge[i];
			const edgeThr = Math.max(18, edgeMean / n * 2.35);
			for (let i = 0; i < n; i++) edgeBarrier[i] = edge[i] >= edgeThr ? 1 : 0;
			const barrier = morphPass(edgeBarrier, dw, dh, 1);
			let ft = 0;
			const seed = (i) => { if (!outside[i] && !barrier[i]) { outside[i] = 1; flood[ft++] = i; } };
			for (let x2 = 0; x2 < dw; x2++) { seed(x2); seed((dh - 1) * dw + x2); }
			for (let y = 1; y < dh - 1; y++) { seed(y * dw); seed(y * dw + dw - 1); }
			while (ft) {
				const p = flood[--ft], x2 = p % dw, y = (p / dw) | 0;
				if (x2 > 0) seed(p - 1); if (x2 < dw - 1) seed(p + 1);
				if (y > 0) seed(p - dw); if (y < dh - 1) seed(p + dw);
			}
			const enclosedMask = new Uint8Array(n);
			for (let i = 0; i < n; i++) enclosedMask[i] = outside[i] || barrier[i] ? 0 : 1;
			const masks = [lightMask, colorMask, enclosedMask].map((m) => {
				// Closing füllt Textlöcher, anschließendes Opening entfernt kleine Reflexe,
				// ohne die Blattkante dauerhaft nach innen zu verschieben.
				const closed = morphPass(morphPass(m, dw, dh, 1), dw, dh, 0);
				return morphPass(morphPass(closed, dw, dh, 0), dw, dh, 1);
			});
			// Bei Schatten kann eine einzelne Maske genau eine Ecke verlieren. Ein vierter,
			// konservativer Kandidat vereinigt die unabhängigen Hinweise; die anschließende
			// Form-/Kantenbewertung entscheidet weiter gegen Tische und Hintergründe.
			const combinedMask = new Uint8Array(n);
			for (let i = 0; i < n; i++) combinedMask[i] = (lightMask[i] && (colorMask[i] || enclosedMask[i])) || (colorMask[i] && enclosedMask[i]) ? 1 : 0;
			const combinedClosed = morphPass(morphPass(combinedMask, dw, dh, 1), dw, dh, 0);
			masks.push(morphPass(morphPass(combinedClosed, dw, dh, 0), dw, dh, 1));
			const stack = new Int32Array(n);
			let best = null, bestScore = -1;
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
					if (sc > bestScore) { bestScore = sc; best = boundary; }
				}
			}
			if (!best) return full;
			const hull = convexHull(best);
			if (hull.length < 4) return full;
			// Start-Viereck aus Extrempunkten (x+y bzw. x−y) …
			let tl = hull[0], tr = hull[0], br = hull[0], bl = hull[0];
			for (const p of hull) {
				if (p[0] + p[1] < tl[0] + tl[1]) tl = p;
				if (p[0] + p[1] > br[0] + br[1]) br = p;
				if (p[0] - p[1] > tr[0] - tr[1]) tr = p;
				if (p[0] - p[1] < bl[0] - bl[1]) bl = p;
			}
			let quad = [tl, tr, br, bl];
			// … dann Ecken gegen Hüllpunkte tauschen, solange die Fläche wächst.
			// Extrempunkte allein versagen bei gedrehten Blättern (der v2-Bug); das
			// flächenmaximale konvexe Viereck in der Hülle sind die echten Papierecken.
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
			// Reihenfolge tl→tr→br→bl herstellen (Winkelsortierung um den Schwerpunkt)
			const cqx = (quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0]) / 4;
			const cqy = (quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1]) / 4;
			quad.sort((a, b) => Math.atan2(a[1] - cqy, a[0] - cqx) - Math.atan2(b[1] - cqy, b[0] - cqx));
			let st = 0;
			for (let i = 1; i < 4; i++) if (quad[i][0] + quad[i][1] < quad[st][0] + quad[st][1]) st = i;
			quad = quad.slice(st).concat(quad.slice(0, st));
			// Zurückskalieren, minimal nach außen (Schatten/Antialiasing), an den Rand klemmen
			const q = quad.map((p) => [p[0] / kk, p[1] / kk]);
			const ccx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4;
			const ccy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
			for (const p of q) {
				p[0] = Math.max(0, Math.min(w - 1, ccx + (p[0] - ccx) * 1.045));
				p[1] = Math.max(0, Math.min(h - 1, ccy + (p[1] - ccy) * 1.045));
			}
			// Plausibilität — sonst lieber das ganze Bild behalten
			const areaQ = quadArea(q);
			if (areaQ < w * h * 0.1 || areaQ > w * h * 0.985 || !isConvex(q)) return full;
			for (let i = 0; i < 4; i++) if (dist2d(q[i], q[(i + 1) % 4]) < Math.min(w, h) * 0.12) return full;
			return q;
		} catch (e) {
			console.warn("Heft: Dokumenterkennung fehlgeschlagen", e);
			return full;
		}
	}
	// Homographie Ziel-Rechteck → Quell-Quad: 8×8-Gleichungssystem, Gauß mit Pivot
	function homography(quad, W, H) {
		const dst = [[0, 0], [W, 0], [W, H], [0, H]];
		const A = [], b = [];
		for (let i = 0; i < 4; i++) {
			const X = dst[i][0], Y = dst[i][1], x = quad[i][0], y = quad[i][1];
			A.push([X, Y, 1, 0, 0, 0, -X * x, -Y * x]); b.push(x);
			A.push([0, 0, 0, X, Y, 1, -X * y, -Y * y]); b.push(y);
		}
		for (let c = 0; c < 8; c++) {
			let piv = c;
			for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
			const tA = A[c]; A[c] = A[piv]; A[piv] = tA;
			const tb = b[c]; b[c] = b[piv]; b[piv] = tb;
			const pv = A[c][c] || 1e-9;
			for (let r = c + 1; r < 8; r++) {
				const f = A[r][c] / pv;
				for (let k2 = c; k2 < 8; k2++) A[r][k2] -= f * A[c][k2];
				b[r] -= f * b[c];
			}
		}
		const hm = new Float64Array(8);
		for (let r = 7; r >= 0; r--) {
			let s = b[r];
			for (let k2 = r + 1; k2 < 8; k2++) s -= A[r][k2] * hm[k2];
			hm[r] = s / (A[r][r] || 1e-9);
		}
		return hm; // srcX = (h0·X + h1·Y + h2) / (h6·X + h7·Y + 1), srcY analog
	}
	// Perspektivische Entzerrung: Zielgröße aus den Kantenlängen des Quads,
	// Rückwärts-Mapping mit bilinearem Sampling — kein Verzerren, keine Treppen
	function warpPerspective(img, iw, ih, quad) {
		// Defensive: echte Natural-Größe, falls w/h und Image auseinanderlaufen
		const nw = img.naturalWidth || iw, nh = img.naturalHeight || ih;
		if (nw !== iw || nh !== ih) {
			const sx = nw / iw, sy = nh / ih;
			quad = quad.map((p) => [p[0] * sx, p[1] * sy]);
			iw = nw; ih = nh;
		}
		let W = Math.round(Math.max(dist2d(quad[0], quad[1]), dist2d(quad[3], quad[2])));
		let H = Math.round(Math.max(dist2d(quad[0], quad[3]), dist2d(quad[1], quad[2])));
		// Scan-Ausgabe erhält genug Reserve für kleine Schrift, Formeln und OCR.
		// Kanten- UND Pixelbudget begrenzen Speicher auf iPadOS, statt pauschal auf
		// 1280 px herunterzuskalieren.
		const edgeScale = Math.min(1, 2200 / Math.max(W, H, 1));
		const pixelScale = Math.min(1, Math.sqrt(4_800_000 / Math.max(1, W * H)));
		const k = Math.min(edgeScale, pixelScale);
		W = Math.max(8, Math.round(W * k));
		H = Math.max(8, Math.round(H * k));
		const sourceScale = Math.min(1, 2600 / Math.max(iw, ih, 1));
		if (sourceScale < 1) {
			quad = quad.map((p) => [p[0] * sourceScale, p[1] * sourceScale]);
			iw = Math.max(2, Math.round(iw * sourceScale));
			ih = Math.max(2, Math.round(ih * sourceScale));
		}
		const sc = document.createElement("canvas");
		sc.width = iw; sc.height = ih;
		const scx = sc.getContext("2d", { willReadFrequently: true });
		// Explizit auf iw×ih skalieren — sonst leere/falsche Pixel wenn Maße nicht passen
		scx.drawImage(img, 0, 0, iw, ih);
		const sd = scx.getImageData(0, 0, iw, ih).data;
		const out = document.createElement("canvas");
		out.width = W; out.height = H;
		const ox = out.getContext("2d");
		const od = ox.createImageData(W, H);
		const op = od.data;
		const hm = homography(quad, W, H);
		for (let y = 0; y < H; y++) {
			for (let x = 0; x < W; x++) {
				const den = hm[6] * x + hm[7] * y + 1;
				let sx = (hm[0] * x + hm[1] * y + hm[2]) / den;
				let sy = (hm[3] * x + hm[4] * y + hm[5]) / den;
				// Bilinear-Sampling liest x0+1/y0+1. Daher Quellkoordinaten
				// bewusst auf den vorletzten Pixel begrenzen, statt am Rand in die
				// nächste Zeile bzw. hinter das Bild zu lesen.
				if (sx < 0) sx = 0; else if (sx > iw - 2.001) sx = iw - 2.001;
				if (sy < 0) sy = 0; else if (sy > ih - 2.001) sy = ih - 2.001;
				const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
				const i00 = (y0 * iw + x0) * 4, i10 = i00 + 4, i01 = i00 + iw * 4, i11 = i01 + 4;
				const o = (y * W + x) * 4;
				op[o] = sd[i00] * (1 - fx) * (1 - fy) + sd[i10] * fx * (1 - fy) + sd[i01] * (1 - fx) * fy + sd[i11] * fx * fy;
				op[o + 1] = sd[i00 + 1] * (1 - fx) * (1 - fy) + sd[i10 + 1] * fx * (1 - fy) + sd[i01 + 1] * (1 - fx) * fy + sd[i11 + 1] * fx * fy;
				op[o + 2] = sd[i00 + 2] * (1 - fx) * (1 - fy) + sd[i10 + 2] * fx * (1 - fy) + sd[i01 + 2] * (1 - fx) * fy + sd[i11 + 2] * fx * fy;
				op[o + 3] = 255;
			}
		}
		ox.putImageData(od, 0, 0);
		return out;
	}
	// Beleuchtungskarte des Papiers: stark verkleinern, 2× Max-Filter (Text fällt aus
	// der Schätzung heraus), 2× Box-Blur — beim Anwenden bilinear hochgerechnet
	function backgroundMap(cv) {
		const bw = Math.max(8, Math.round(cv.width / 16));
		const bh = Math.max(8, Math.round(cv.height / 16));
		const c = document.createElement("canvas");
		c.width = bw; c.height = bh;
		const cx = c.getContext("2d");
		cx.drawImage(cv, 0, 0, bw, bh);
		const d = cx.getImageData(0, 0, bw, bh).data;
		// Getrennte Kanal-Karten statt nur einer Luminanz-Karte — sonst bewahrt der
		// "Weißabgleich" nur die Helligkeit, nicht die Farbe. Ein Schatten mit
		// warmem Farbstich (z. B. Zimmerlicht) blieb dadurch gelblich.
		const pass3x3 = (src, useMax) => {
			const dst = new Float32Array(bw * bh);
			for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
				let acc = 0, cnt = 0;
				for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
					const yy = Math.min(bh - 1, Math.max(0, y + dy));
					const xx = Math.min(bw - 1, Math.max(0, x + dx));
					const v = src[yy * bw + xx];
					if (useMax) { if (v > acc) acc = v; } else { acc += v; cnt++; }
				}
				dst[y * bw + x] = useMax ? acc : acc / cnt;
			}
			return dst;
		};
		const smooth = (m) => pass3x3(pass3x3(pass3x3(pass3x3(m, true), true), false), false);
		let mr = new Float32Array(bw * bh), mg = new Float32Array(bw * bh), mb = new Float32Array(bw * bh);
		for (let i = 0; i < bw * bh; i++) { mr[i] = d[i * 4]; mg[i] = d[i * 4 + 1]; mb[i] = d[i * 4 + 2]; }
		mr = smooth(mr); mg = smooth(mg); mb = smooth(mb);
		return { r: mr, g: mg, b: mb, bw, bh };
	}
	function sampleMap(map, bw, bh, fx, fy) {
		// Bilinear-Sampling braucht jeweils einen rechten und unteren Nachbarn —
		// am Rand deshalb auf den vorletzten Eintrag klemmen (sonst NaN-Ränder).
		let x = fx - 0.5, y = fy - 0.5;
		if (x < 0) x = 0; else if (x > bw - 2.001) x = bw - 2.001;
		if (y < 0) y = 0; else if (y > bh - 2.001) y = bh - 2.001;
		const x0 = x | 0, y0 = y | 0, dx = x - x0, dy = y - y0;
		return map[y0 * bw + x0] * (1 - dx) * (1 - dy) + map[y0 * bw + x0 + 1] * dx * (1 - dy) +
			map[(y0 + 1) * bw + x0] * (1 - dx) * dy + map[(y0 + 1) * bw + x0 + 1] * dx * dy;
	}
	// „Foto“-Filter: Kontrast strecken über 2%/98%-Luminanz-Perzentile — bewusst
	// kanalgleich, damit Farben nicht kippen (für Fotos statt Dokumenten)
	function enhanceScan(cv) {
		const x = cv.getContext("2d");
		const d = x.getImageData(0, 0, cv.width, cv.height);
		const px = d.data;
		const hist = new Uint32Array(256);
		for (let i = 0; i < px.length; i += 4) hist[(px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8]++;
		const total = px.length / 4;
		let lo = 0, hi = 255, acc = 0;
		for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * 0.02) { lo = i; break; } }
		acc = 0;
		for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= total * 0.02) { hi = i; break; } }
		const span = Math.max(1, hi - lo);
		const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
		for (let i = 0; i < px.length; i += 4) {
			px[i] = clamp((px[i] - lo) * 255 / span);
			px[i + 1] = clamp((px[i + 1] - lo) * 255 / span);
			px[i + 2] = clamp((px[i + 2] - lo) * 255 / span);
		}
		x.putImageData(d, 0, 0);
	}
	// Scan-Aufbereitung — bewusst aggressiv, damit der Unterschied zum Rohfoto
	// sofort erkennbar ist (wie Office Lens / GoodNotes):
	// 1) Beleuchtung rausrechnen  2) Papier → weiß, Tinte → dunkler  3) leichter Unsharp
	// 4) S/W mit harter, aber weicher Schwelle
	function applyScanMode(cv, mode) {
		if (mode === "photo") { enhanceScan(cv); return; }
		const w = cv.width, h = cv.height;
		const x = cv.getContext("2d", { willReadFrequently: true });
		const bg = backgroundMap(cv);
		const d = x.getImageData(0, 0, w, h);
		const px = d.data;
		const kx = bg.bw / w, ky = bg.bh / h;
		const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
		// Starke Papier-Aufhellung + Tinte halten (S-Kurve nach Weißabgleich)
		const docTone = (v) => {
			let t = Math.max(0, Math.min(1, v / 255));
			t = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
			if (t > 0.72) t = 0.72 + (t - 0.72) * 1.9;
			if (t < 0.35) t = t * 0.85;
			return clamp(t * 255);
		};
		// S/W-Schwelle aus dem tatsächlichen Scan ableiten. Das bewahrt hellen
		// Bleistift und blasse Schrift besser als der alte feste Bereich 110…200.
		let bwLow = 110, bwSpan = 90;
		if (mode === "bw") {
			const hist = new Uint32Array(256);
			let samples = 0;
			for (let sy = 0; sy < h; sy += 4) for (let sx = 0; sx < w; sx += 4) {
				const i = (sy * w + sx) * 4;
				const baseR = Math.max(36, sampleMap(bg.r, bg.bw, bg.bh, sx * kx, sy * ky));
				const baseG = Math.max(36, sampleMap(bg.g, bg.bw, bg.bh, sx * kx, sy * ky));
				const baseB = Math.max(36, sampleMap(bg.b, bg.bw, bg.bh, sx * kx, sy * ky));
				const rr = clamp(px[i] * 255 / baseR), gg = clamp(px[i + 1] * 255 / baseG), bb = clamp(px[i + 2] * 255 / baseB);
				hist[docTone((rr * 77 + gg * 150 + bb * 29) >> 8)]++; samples++;
			}
			const percentile = (p) => {
				let acc = 0, target = samples * p;
				for (let n = 0; n < 256; n++) { acc += hist[n]; if (acc >= target) return n; }
				return 255;
			};
			const dark = percentile(.01), light = percentile(.92), span = light - dark;
			if (span >= 48) { bwLow = clamp(dark + span * .12); bwSpan = Math.max(55, span * .62); }
		}
		for (let y = 0; y < h; y++) {
			const fy = y * ky;
			for (let x2 = 0; x2 < w; x2++) {
				const i = (y * w + x2) * 4;
				// Weißabgleich je Kanal einzeln: eine gemeinsame Helligkeits-Karte hat
				// einen Farbstich im Schatten (z. B. Gelbstich) nur abgedunkelt, nicht entfernt.
				const gr = Math.max(36, sampleMap(bg.r, bg.bw, bg.bh, x2 * kx, fy));
				const gg = Math.max(36, sampleMap(bg.g, bg.bw, bg.bh, x2 * kx, fy));
				const gb = Math.max(36, sampleMap(bg.b, bg.bw, bg.bh, x2 * kx, fy));
				const r = clamp(px[i] * 255 / gr);
				const g2 = clamp(px[i + 1] * 255 / gg);
				const b = clamp(px[i + 2] * 255 / gb);
				if (mode === "color") {
					px[i] = docTone(r);
					px[i + 1] = docTone(g2);
					px[i + 2] = docTone(b);
				} else {
					const v = docTone((r * 77 + g2 * 150 + b * 29) >> 8);
					let o;
					if (mode === "bw") {
						// Smoothstep 110…200 — Text schwarz, Papier weiß, klar erkennbar
						let t = (v - bwLow) / bwSpan;
						t = t < 0 ? 0 : t > 1 ? 1 : t;
						o = clamp(255 * t * t * (3 - 2 * t));
					} else {
						o = clamp((v - 128) * 1.45 + 128);
					}
					px[i] = px[i + 1] = px[i + 2] = o;
				}
			}
		}
		// Leichter Unsharp-Mask (Text schärfer, Scan-Look)
		const copy = new Uint8ClampedArray(px);
		const amount = 0.55;
		for (let y = 1; y < h - 1; y++) {
			for (let x2 = 1; x2 < w - 1; x2++) {
				const i = (y * w + x2) * 4;
				for (let c = 0; c < 3; c++) {
					const c0 = copy[i + c];
					const blur2 =
						(copy[i - w * 4 + c] + copy[i + w * 4 + c] + copy[i - 4 + c] + copy[i + 4 + c] + c0 * 4) / 8;
					px[i + c] = clamp(c0 + (c0 - blur2) * amount);
				}
			}
		}
		x.putImageData(d, 0, 0);
	}
	// 90°-Drehung(en) für die Nachbearbeitung
	function rotateCanvas(cv, rot) {
		const r = ((rot % 4) + 4) % 4;
		if (!r) return cv;
		const c = document.createElement("canvas");
		if (r === 2) { c.width = cv.width; c.height = cv.height; } else { c.width = cv.height; c.height = cv.width; }
		const x = c.getContext("2d");
		x.translate(c.width / 2, c.height / 2);
		x.rotate(r * Math.PI / 2);
		x.drawImage(cv, -cv.width / 2, -cv.height / 2);
		return c;
	}
	// Prüft das fertige, entzerrte Bild statt nur den Live-Stream. Die Kennzahl
	// ist bewusst ein Hinweis, kein Blocker: schlechte Lichtverhältnisse dürfen
	// weiterhin als Foto gesichert und später manuell bearbeitet werden.
	function scanOutputQuality(cv) {
		const max = 360, k = Math.min(1, max / Math.max(cv.width, cv.height));
		const w = Math.max(2, Math.round(cv.width * k)), h = Math.max(2, Math.round(cv.height * k));
		const probe = document.createElement("canvas"); probe.width = w; probe.height = h;
		const x = probe.getContext("2d", { willReadFrequently: true });
		x.drawImage(cv, 0, 0, w, h);
		const px = x.getImageData(0, 0, w, h).data;
		let sum = 0, sum2 = 0, lap = 0;
		const lum = new Uint8Array(w * h);
		for (let i = 0; i < lum.length; i++) {
			const v = (px[i * 4] * 77 + px[i * 4 + 1] * 150 + px[i * 4 + 2] * 29) >> 8;
			lum[i] = v; sum += v; sum2 += v * v;
		}
		for (let y = 1; y < h - 1; y++) for (let x2 = 1; x2 < w - 1; x2++) {
			const i = y * w + x2;
			lap += Math.abs(4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - w] - lum[i + w]);
		}
		let dark = 0, bright = 0;
		for (let i = 0; i < lum.length; i++) { if (lum[i] < 28) dark++; if (lum[i] > 245) bright++; }
		const contrast = Math.sqrt(Math.max(0, sum2 / lum.length - Math.pow(sum / lum.length, 2)));
		const sharp = lap / Math.max(1, (w - 2) * (h - 2));
		const darkRatio = dark / lum.length, brightRatio = bright / lum.length;
		// Qualitätsprüfung ist ein Hinweis, kein Blocker: Ein Scan bleibt speicherbar,
		// bekommt aber bei Unschärfe, wenig Kontrast oder starken Clippings ein Badge.
		return { sharp, contrast, darkRatio, brightRatio, soft: sharp < 5.5, flat: contrast < 13,
			tooDark: darkRatio > 0.18, glare: brightRatio > 0.92 && contrast < 18 };
	}
	// Ein Scan: Rohbild → entzerren → Filter → Drehung → fertige Scan-Seite
	// tick() gibt dem Browser zwischen den schweren Schritten Luft (sonst „eingefroren“)
	const tick = () => new Promise((r) => setTimeout(r, 0));
	async function processShot(sh, snapshot) {
		// Jeder Lauf verarbeitet einen unveränderlichen Schnappschuss von Ecken,
		// Filter und Drehung. So kann ein älterer Async-Lauf nie ein neueres
		// Bearbeitungsergebnis überschreiben.
		const img = sh.img || await loadImg(sh.src);
		sh.img = img;
		sh.w = img.naturalWidth || sh.w;
		sh.h = img.naturalHeight || sh.h;
		let quad = snapshot && snapshot.quad ? snapshot.quad.map((p) => p.slice()) : sh.quad;
		if (!Array.isArray(quad) || quad.length !== 4) {
			quad = detectQuad(img, sh.w, sh.h);
			if (!snapshot) sh.quad = quad;
		}
		const mode = (snapshot && snapshot.mode) || sh.mode || "color";
		const rot = snapshot && snapshot.rot != null ? snapshot.rot : (sh.rot || 0);
		await tick();
		let cv = warpPerspective(img, sh.w, sh.h, quad);
		await tick();
		applyScanMode(cv, mode);
		await tick();
		if (rot) cv = rotateCanvas(cv, rot);
		// Ein einziger finaler JPEG-Export: Rohaufnahme und Zwischenpipeline bleiben
		// verlustfrei, damit Textkanten nicht durch doppelte Kompression ausfransen.
		const out = { dataUrl: cv.toDataURL("image/jpeg", 0.96), w: cv.width, h: cv.height, quality: scanOutputQuality(cv) };
		if (!snapshot || snapshot.commit !== false) sh.out = out;
		return out;
	}
	return { SCAN_MODES, loadImg, dist2d, quadArea, isConvex, convexHull, blurMap, morphPass, detectQuad, homography, warpPerspective, backgroundMap, sampleMap, enhanceScan, applyScanMode, rotateCanvas, scanOutputQuality, tick, processShot };
})();