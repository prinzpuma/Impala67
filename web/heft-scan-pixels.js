// heft-scan-pixels.js — reine Pixel-Funktionen des Dokument-Scanners, ohne DOM.
// Bilder sind { data: Uint8ClampedArray (RGBA), width, height }. Canvas wird nur an den
// Rändern gebraucht (readPixels/writePixels; mk = Canvas-Fabrik). Dieselben Funktionen
// laufen im Worker (heft-scan-worker.js) und im Hauptthread-Fallback (heft-scan.js).

import { dist2d } from "./heft-scan-detect.js";
export { detectQuadPixels, detectSizes, fullQuadPixels, DETECT_MAX, REFINE_MAX, refineQuadPixels, toGray, quadArea, isConvex } from "./heft-scan-detect.js";

// Scan-Ausgabe: sparsam, aber gut lesbar. Gemessen an einer A4-Seite (Okt. 2026):
// 2200 px / JPEG 0.95 ≈ 610 KB, 1800 px / 0.78 ≈ 230 KB — Texterkennung unverändert
// (100 % Wörter). Gilt für den eigenen Scanner UND den Google-Scanner der APK.
export const SCAN_JPEG_QUALITY = 0.78;
export const SCAN_OUT_MAX_EDGE = 1800;
// Quelle vor dem Entzerren höchstens so groß: genug für 12-MP-Fotos (4032 px), damit
// die verkleinerte Ausgabe ihre Schärfe aus dem vollen Kamerafoto bekommt.
export const SCAN_SOURCE_MAX = 4096;
const OUT_MAX_PIXELS = 4_800_000;

// ---------- Canvas-Brücke (nur Lesen/Schreiben der Pixel) ----------

// Liest ein Bild (Canvas, ImageBitmap, Image) in exakt w×h Pixel. Ein Canvas in passender
// Größe wird direkt ausgelesen, sonst skaliert es über ein Hilfs-Canvas. Das Hilfs-Canvas
// bewusst OHNE willReadFrequently: so skaliert die GPU, und nur das kleine Ergebnis wird
// einmal zurückgelesen. Mit dem Flag skalierte der Browser 12-MP-Fotos in Software (~1 s).
export function readPixels(drawable, w, h, mk) {
	if (typeof drawable.getContext === "function" && drawable.width === w && drawable.height === h) {
		const d = drawable.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h);
		return { data: d.data, width: w, height: h };
	}
	const cv = mk(w, h), ctx = cv.getContext("2d");
	ctx.imageSmoothingQuality = "high";
	ctx.drawImage(drawable, 0, 0, w, h);
	return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
}

export function writePixels(pix, mk) {
	const cv = mk(pix.width, pix.height);
	const ctx = cv.getContext("2d");
	const id = ctx.createImageData(pix.width, pix.height);
	id.data.set(pix.data);
	ctx.putImageData(id, 0, 0);
	return cv;
}

// Quelle auf maxSide begrenzen (Pixel werden gelesen, Viereck mitskaliert).
export function prepareSource(drawable, sw, sh, quad, maxSide, mk) {
	const s = Math.min(1, maxSide / Math.max(sw, sh, 1));
	const iw = s < 1 ? Math.max(2, Math.round(sw * s)) : sw;
	const ih = s < 1 ? Math.max(2, Math.round(sh * s)) : sh;
	const pixels = readPixels(drawable, iw, ih, mk);
	const kx = iw / sw, ky = ih / sh;
	return { pixels, quad: quad.map((p) => [p[0] * kx, p[1] * ky]) };
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

// ---------- Entzerrung ----------

// Perspektivische Entzerrung: Zielgröße aus den Kantenlängen des Quads (mit Größenbudget),
// Rückwärts-Mapping mit bilinearem Sampling. src muss bereits begrenzt sein (prepareSource).
export function warpPixels(src, quad) {
	const iw = src.width, ih = src.height, sd = src.data;
	let W = Math.round(Math.max(dist2d(quad[0], quad[1]), dist2d(quad[3], quad[2])));
	let H = Math.round(Math.max(dist2d(quad[0], quad[3]), dist2d(quad[1], quad[2])));
	// Scan-Ausgabe erhält genug Reserve für kleine Schrift, Formeln und OCR. Kanten- UND
	// Pixelbudget begrenzen den Speicher auf iPadOS, statt pauschal herunterzuskalieren.
	const edgeScale = Math.min(1, SCAN_OUT_MAX_EDGE / Math.max(W, H, 1));
	const pixelScale = Math.min(1, Math.sqrt(OUT_MAX_PIXELS / Math.max(1, W * H)));
	const k = Math.min(edgeScale, pixelScale);
	W = Math.max(8, Math.round(W * k));
	H = Math.max(8, Math.round(H * k));
	const op = new Uint8ClampedArray(W * H * 4);
	const hm = homography(quad, W, H);
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			const den = hm[6] * x + hm[7] * y + 1;
			let sx = (hm[0] * x + hm[1] * y + hm[2]) / den;
			let sy = (hm[3] * x + hm[4] * y + hm[5]) / den;
			// Bilinear-Sampling liest x0+1/y0+1. Daher Quellkoordinaten bewusst auf den
			// vorletzten Pixel begrenzen, statt am Rand in die nächste Zeile zu lesen.
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
	return { data: op, width: W, height: H };
}

// ---------- Beleuchtung & Filter ----------

// Blockmittelwert-Verkleinerung (ersetzt drawImage-Skalierung, damit reine Pixelfunktion)
export function downscalePixels(pix, w, h) {
	const s = pix.data, sw = pix.width, sh = pix.height;
	const out = new Uint8ClampedArray(w * h * 4);
	for (let y = 0; y < h; y++) {
		const y0 = Math.floor(y * sh / h), y1 = Math.min(sh, Math.max(y0 + 1, Math.floor((y + 1) * sh / h)));
		for (let x = 0; x < w; x++) {
			const x0 = Math.floor(x * sw / w), x1 = Math.min(sw, Math.max(x0 + 1, Math.floor((x + 1) * sw / w)));
			let r = 0, g = 0, b = 0, n = 0;
			for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
				const i = (yy * sw + xx) * 4;
				r += s[i]; g += s[i + 1]; b += s[i + 2]; n++;
			}
			const o = (y * w + x) * 4;
			out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
		}
	}
	return { data: out, width: w, height: h };
}

// Bildaufbereitung (Farbe / Graustufen / S/W / Foto) liegt in heft-scan-enhance.js.
export { applyScanModePixels } from "./heft-scan-enhance.js";

// ---------- Drehung ----------

// 90°-Schritte im Uhrzeigersinn (rot = 1 → 90° rechts), wie canvas.rotate(+π/2)
export function rotatePixels(pix, rot) {
	const r = ((rot % 4) + 4) % 4;
	if (!r) return pix;
	const W = pix.width, H = pix.height, swap = r % 2 === 1;
	const outW = swap ? H : W, outH = swap ? W : H;
	const out = new Uint8ClampedArray(outW * outH * 4), s = pix.data;
	for (let sy = 0; sy < H; sy++) for (let sx = 0; sx < W; sx++) {
		let dx, dy;
		if (r === 1) { dx = H - 1 - sy; dy = sx; }
		else if (r === 2) { dx = W - 1 - sx; dy = H - 1 - sy; }
		else { dx = sy; dy = W - 1 - sx; }
		const si = (sy * W + sx) * 4, di = (dy * outW + dx) * 4;
		out[di] = s[si]; out[di + 1] = s[si + 1]; out[di + 2] = s[si + 2]; out[di + 3] = s[si + 3];
	}
	return { data: out, width: outW, height: outH };
}

// ---------- Kennzahlen ----------

// EINE Definition von Helligkeit, Kontrast und Schärfe (Live-Vorschau und Ergebnis teilen sie).
// step > 1 tastet die Laplace-Summe gröber ab.
export function lumStatsPixels(pix, step = 1) {
	const w = pix.width, h = pix.height, px = pix.data;
	const lum = new Uint8Array(w * h);
	let sum = 0, sum2 = 0, dark = 0, bright = 0;
	for (let i = 0; i < lum.length; i++) {
		const v = (px[i * 4] * 77 + px[i * 4 + 1] * 150 + px[i * 4 + 2] * 29) >> 8;
		lum[i] = v; sum += v; sum2 += v * v;
		if (v < 28) dark++; else if (v > 245) bright++;
	}
	let lap = 0, taps = 0;
	for (let y = 1; y < h - 1; y += step) for (let x2 = 1; x2 < w - 1; x2 += step) {
		const i = y * w + x2;
		lap += Math.abs(4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - w] - lum[i + w]); taps++;
	}
	const mean = sum / lum.length;
	return { mean, contrast: Math.sqrt(Math.max(0, sum2 / lum.length - mean * mean)),
		sharp: lap / Math.max(1, taps), darkRatio: dark / lum.length, brightRatio: bright / lum.length };
}

// Prüft das fertige Bild. Die Kennzahl ist ein Hinweis, kein Blocker.
export function scanQualityPixels(pix) {
	const max = 360, k = Math.min(1, max / Math.max(pix.width, pix.height));
	const small = downscalePixels(pix, Math.max(2, Math.round(pix.width * k)), Math.max(2, Math.round(pix.height * k)));
	const { sharp, contrast, darkRatio, brightRatio } = lumStatsPixels(small);
	return { sharp, contrast, darkRatio, brightRatio, soft: sharp < 5.5, flat: contrast < 13,
		tooDark: darkRatio > 0.18, glare: brightRatio > 0.92 && contrast < 18 };
}

