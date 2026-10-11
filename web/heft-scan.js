"use strict";

// heft-scan.js — Bildverarbeitungs-Kern des Dokument-Scanners. Blatt-Erkennung →
// Kanten-Verfeinerung → perspektivische Entzerrung → Beleuchtung/Filter → Qualität.
// Die Pixelrechnung liegt in heft-scan-pixels.js (rein, ohne DOM) und läuft im Worker
// heft-scan-worker.js; dieser Hauptthread-Teil kümmert sich um Bildquellen, Canvas-Brücke
// und den Worker-Lebenszyklus. Kamera-/Overlay-UI lebt in heft-scanner-ui.js.
import {
	SCAN_JPEG_QUALITY, SCAN_SOURCE_MAX, readPixels, writePixels, prepareSource, warpPixels,
	applyScanModePixels, rotatePixels, lumStatsPixels, scanQualityPixels, toGray,
	refineQuadPixels, quadArea, isConvex,
} from "./heft-scan-pixels.js";

export const SCANCORE = (() => {
	// Pipeline wie GoodNotes/Office Lens: Aufnahme → Blatt-Erkennung → perspektivische
	// Entzerrung → Beleuchtung rausrechnen + Filter → Nachbearbeitung → PDF/Heftseiten.
	// Erkennung v4: Papier-Maske (hell + unbunt + nicht dunkler als lokaler Hintergrund)
	// → größte plausible Fläche → konvexe Hülle → flächenmaximales Viereck.
	const SCAN_MODES = [["color", "Farbe"], ["bw", "S/W"], ["gray", "Graustufen"], ["photo", "Foto"]];
	const mkCanvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
	// Größe immer über natural*, Canvas/ImageBitmap haben nur width/height
	const sizeOf = (img) => ({ w: img.naturalWidth || img.width, h: img.naturalHeight || img.height });
	const loadImgEl = (src) => new Promise((res, rej) => {
		const im = new Image();
		im.onload = () => res(im);
		im.onerror = () => rej(new Error("Bild dekodieren fehlgeschlagen"));
		im.src = src;
	});
	// Akzeptiert URL/Data-URL, Blob, Canvas oder ImageBitmap. Canvas/ImageBitmap kommen unverändert zurück.
	const loadImg = async (src) => {
		if (src && typeof src.getContext === "function") return src;
		if (typeof ImageBitmap !== "undefined" && src instanceof ImageBitmap) return src;
		if (typeof Blob !== "undefined" && src instanceof Blob) {
			if (typeof createImageBitmap === "function") return createImageBitmap(src);
			const url = URL.createObjectURL(src);
			try { return await loadImgEl(url); } finally { URL.revokeObjectURL(url); }
		}
		return loadImgEl(src);
	};
	const blobToDataUrl = (blob) => new Promise((res, rej) => {
		const fr = new FileReader();
		fr.onload = () => res(fr.result);
		fr.onerror = () => rej(fr.error || new Error("Blob lesen fehlgeschlagen"));
		fr.readAsDataURL(blob);
	});
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
	// Dokumenterkennung v4. Gibt bei unsicherer Erkennung IMMER das ganze Bild
	// zurück — niemals Inhalt abschneiden.
	function detectQuad(img, w, h) {
		const full = [[0, 0], [Math.max(0, w - 1), 0], [Math.max(0, w - 1), Math.max(0, h - 1)], [0, Math.max(0, h - 1)]];
		if (!w || !h) return full;
		try {
			// Aufnahme: mehr Analyseauflösung für präzisere Ecken. Die Live-Vorschau
			// bleibt klein, weil heft-scanner-ui.js nur 300 px breit prüft.
			const dw = Math.min(720, w), kk = dw / w, dh = Math.max(12, Math.round(h * kk));
			const d = readPixels(img, dw, dh, mkCanvas).data;
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
			// den am Bildrand gemessenen Tisch und eine kantenumschlossene Fläche.
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
				// Closing füllt Textlöcher, anschließendes Opening entfernt kleine Reflexe.
				const closed = morphPass(morphPass(m, dw, dh, 1), dw, dh, 0);
				return morphPass(morphPass(closed, dw, dh, 0), dw, dh, 1);
			});
			// Bei Schatten kann eine einzelne Maske genau eine Ecke verlieren. Ein vierter,
			// konservativer Kandidat vereinigt die unabhängigen Hinweise.
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
			// … dann Ecken gegen Hüllpunkte tauschen, solange die Fläche wächst (flächenmaximales
			// konvexes Viereck in der Hülle sind die echten Papierecken).
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
			// Auf Originalkoordinaten zurück, dann Kanten auf die echten Blattkanten ziehen
			const q0 = quad.map((p) => [p[0] / kk, p[1] / kk]);
			const q = refineQuad(img, w, h, q0);
			// Leicht nach innen (≈0,5 %): die Antialiasing-Kante zwischen Blatt und Tisch würde
			// sonst als 1–2 px dunkler Strich im Scan stehen (S/W macht ihn schwarz, OCR liest „|“).
			const ccx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4;
			const ccy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
			for (const p of q) {
				p[0] = Math.max(0, Math.min(w - 1, ccx + (p[0] - ccx) * 0.99));
				p[1] = Math.max(0, Math.min(h - 1, ccy + (p[1] - ccy) * 0.99));
			}
			// Plausibilität — sonst lieber das ganze Bild behalten
			const areaQ = quadArea(q);
			if (areaQ < w * h * 0.1 || areaQ > w * h * 0.985 || !isConvex(q)) return full;
			for (let i = 0; i < 4; i++) if (Math.hypot(q[i][0] - q[(i + 1) % 4][0], q[i][1] - q[(i + 1) % 4][1]) < Math.min(w, h) * 0.12) return full;
			return q;
		} catch (e) {
			console.warn("Heft: Dokumenterkennung fehlgeschlagen", e);
			return full;
		}
	}
	// Kanten-Verfeinerung in höherer Auflösung (längste Seite max. 1600 px). Eingabe und
	// Ausgabe in Originalkoordinaten. Bei Fehlern kommt das Eingangs-Viereck zurück.
	const REFINE_MAX_SIDE = 1600;
	function refineQuad(img, w, h, quad) {
		try {
			const kr = Math.min(1, REFINE_MAX_SIDE / Math.max(w, h, 1));
			const gw = Math.max(2, Math.round(w * kr)), gh = Math.max(2, Math.round(h * kr));
			const gray = toGray(readPixels(img, gw, gh, mkCanvas));
			const sx = gw / w, sy = gh / h;
			const res = refineQuadPixels(gray, gw, gh, quad.map((p) => [p[0] * sx, p[1] * sy]));
			return res.map((p) => [p[0] / sx, p[1] / sy]);
		} catch (e) {
			console.warn("Heft: Kanten-Verfeinerung übersprungen", e);
			return quad;
		}
	}
	// Kennzahlen aus demselben Kern wie die Ergebnisprüfung (heft-scan-pixels.js)
	function lumStats(cv, step = 1) {
		return lumStatsPixels(readPixels(cv, cv.width, cv.height, mkCanvas), step);
	}
	const tick = () => new Promise((r) => setTimeout(r, 0));

	// Scan-Pipeline im Worker: ein lazy erzeugter Worker, Anfragen per id. Fällt der Worker
	// aus (onerror oder Fehlerantwort), wird dauerhaft auf den Hauptthread umgeschaltet.
	let worker = null, workerDown = false, reqId = 0;
	const pending = new Map();
	const workerAvailable = () => !workerDown && typeof Worker === "function" &&
		typeof OffscreenCanvas === "function" && typeof createImageBitmap === "function";
	function markWorkerDown() {
		workerDown = true;
		if (worker) { try { worker.terminate(); } catch (e) { /* bereits beendet */ } worker = null; }
		for (const p of pending.values()) p.reject(new Error("Scan-Worker ausgefallen"));
		pending.clear();
	}
	function getWorker() {
		if (worker) return worker;
		try {
			worker = new Worker(new URL("./heft-scan-worker.js", import.meta.url), { type: "module" });
		} catch (e) { markWorkerDown(); return null; }
		worker.onmessage = (ev) => {
			const { id, error, ...res } = ev.data || {};
			const p = pending.get(id);
			if (!p) return;
			pending.delete(id);
			if (error) { p.reject(new Error(error)); markWorkerDown(); } else p.resolve(res);
		};
		worker.onerror = () => markWorkerDown();
		return worker;
	}
	async function renderInWorker(img, sw, sh, quad, mode, rot) {
		if (!getWorker()) throw new Error("kein Worker");
		// Kopie als ImageBitmap, damit das Original (sh.img) für Neuberechnungen erhalten bleibt
		const bitmap = await createImageBitmap(img);
		return new Promise((resolve, reject) => {
			if (workerDown || !worker) { bitmap.close(); reject(new Error("Scan-Worker ausgefallen")); return; }
			const id = ++reqId;
			pending.set(id, { resolve, reject });
			worker.postMessage({ id, bitmap, sw, sh, quad, mode, rot }, [bitmap]);
		});
	}
	// Hauptthread-Fallback: dieselben Funktionen, mit Pausen zwischen den schweren Schritten
	async function renderOnMainThread(img, sw, sh, quad, mode, rot) {
		const src = prepareSource(img, sw, sh, quad, SCAN_SOURCE_MAX, mkCanvas);
		await tick();
		let pix = warpPixels(src.pixels, src.quad);
		await tick();
		applyScanModePixels(pix, mode);
		await tick();
		pix = rotatePixels(pix, rot || 0);
		const quality = scanQualityPixels(pix);
		const cv = writePixels(pix, mkCanvas);
		const blob = await new Promise((res, rej) => cv.toBlob(
			(b) => (b ? res(b) : rej(new Error("JPEG-Export fehlgeschlagen"))), "image/jpeg", SCAN_JPEG_QUALITY));
		return { blob, w: pix.width, h: pix.height, quality };
	}
	// Ein Scan: Rohbild → entzerren → Filter → Drehung → JPEG-Blob + Qualität.
	// Jeder Lauf verarbeitet einen unveränderlichen Schnappschuss von Ecken, Filter und
	// Drehung, damit ein älterer Lauf nie ein neueres Ergebnis überschreibt.
	async function processShot(sh, snapshot) {
		const img = sh.img || await loadImg(sh.src);
		const { w, h } = sizeOf(img);
		sh.img = img; sh.w = w; sh.h = h;
		let quad = snapshot && snapshot.quad ? snapshot.quad.map((p) => p.slice()) : sh.quad;
		if (!Array.isArray(quad) || quad.length !== 4) {
			quad = detectQuad(img, sh.w, sh.h);
			if (!snapshot) sh.quad = quad;
		}
		const mode = (snapshot && snapshot.mode) || sh.mode || "color";
		const rot = snapshot && snapshot.rot != null ? snapshot.rot : (sh.rot || 0);
		await tick();
		let res = null;
		if (workerAvailable()) {
			try { res = await renderInWorker(img, sh.w, sh.h, quad, mode, rot); }
			catch (e) { markWorkerDown(); console.warn("Heft: Scan-Worker umgangen", e); }
		}
		if (!res) res = await renderOnMainThread(img, sh.w, sh.h, quad, mode, rot);
		const out = { blob: res.blob, w: res.w, h: res.h, quality: res.quality };
		if (!snapshot || snapshot.commit !== false) sh.out = out;
		return out;
	}
	// Nur die Namen, die heft-scanner-ui.js wirklich zieht.
	return { SCAN_MODES, loadImg, quadArea, isConvex, detectQuad, processShot, lumStats, blobToDataUrl };
})();
