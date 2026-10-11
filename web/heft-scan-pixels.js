// heft-scan-pixels.js — reine Pixel-Funktionen des Dokument-Scanners, ohne DOM.
// Bilder sind { data: Uint8ClampedArray (RGBA), width, height }. Canvas wird nur an den
// Rändern gebraucht (readPixels/writePixels; mk = Canvas-Fabrik). Dieselben Funktionen
// laufen im Worker (heft-scan-worker.js) und im Hauptthread-Fallback (heft-scan.js).

export const SCAN_JPEG_QUALITY = 0.95;
export const SCAN_SOURCE_MAX = 2600;
const OUT_MAX_EDGE = 2200, OUT_MAX_PIXELS = 4_800_000;

// ---------- Canvas-Brücke (nur Lesen/Schreiben der Pixel) ----------

// Liest ein Bild (Canvas, ImageBitmap, Image) in exakt w×h Pixel. Ein Canvas in passender
// Größe wird direkt ausgelesen, sonst skaliert es über ein Hilfs-Canvas.
export function readPixels(drawable, w, h, mk) {
	let cv = drawable;
	if (!(typeof drawable.getContext === "function" && drawable.width === w && drawable.height === h)) {
		cv = mk(w, h);
		cv.getContext("2d", { willReadFrequently: true }).drawImage(drawable, 0, 0, w, h);
	}
	const d = cv.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h);
	return { data: d.data, width: w, height: h };
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

// ---------- Geometrie ----------

const dist2d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

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
	const edgeScale = Math.min(1, OUT_MAX_EDGE / Math.max(W, H, 1));
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

// Beleuchtungskarte des Papiers: stark verkleinern, 2× Max-Filter (Text fällt aus
// der Schätzung heraus), 2× Box-Blur — beim Anwenden bilinear hochgerechnet.
// Getrennte Kanal-Karten, damit der Weißabgleich auch Farbstiche im Schatten entfernt.
function backgroundMap(pix) {
	const bw = Math.max(8, Math.round(pix.width / 16));
	const bh = Math.max(8, Math.round(pix.height / 16));
	const d = downscalePixels(pix, bw, bh).data;
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

// „Foto“-Filter: Kontrast strecken über 2%/98%-Luminanz-Perzentile — kanalgleich, damit
// Farben nicht kippen. Streckung als 0…255-Tabelle.
function enhancePixels(pix) {
	const px = pix.data;
	const hist = new Uint32Array(256);
	for (let i = 0; i < px.length; i += 4) hist[(px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8]++;
	const total = px.length / 4;
	let lo = 0, hi = 255, acc = 0;
	for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * 0.02) { lo = i; break; } }
	acc = 0;
	for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= total * 0.02) { hi = i; break; } }
	const span = Math.max(1, hi - lo);
	const lut = new Uint8Array(256);
	for (let v = 0; v < 256; v++) { const o = Math.round((v - lo) * 255 / span); lut[v] = o < 0 ? 0 : o > 255 ? 255 : o; }
	for (let i = 0; i < px.length; i += 4) {
		px[i] = lut[px[i]];
		px[i + 1] = lut[px[i + 1]];
		px[i + 2] = lut[px[i + 2]];
	}
}

// Scan-Aufbereitung (verändert pix in place): 1) Beleuchtung rausrechnen
// 2) Papier → weiß, Tinte → dunkler 3) leichter Unsharp 4) S/W mit weicher Schwelle.
export function applyScanModePixels(pix, mode) {
	if (mode === "photo") { enhancePixels(pix); return pix; }
	const w = pix.width, h = pix.height, px = pix.data;
	const bg = backgroundMap(pix);
	const kx = bg.bw / w, ky = bg.bh / h;
	const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
	// Starke Papier-Aufhellung + Tinte halten (S-Kurve nach Weißabgleich). Eingang ist
	// IMMER ein ganzzahliger Kanalwert 0…255 -> Tabelle statt Kurve je Pixel.
	const docLut = new Uint8Array(256);
	for (let v = 0; v < 256; v++) {
		let t = v / 255;
		t = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
		if (t > 0.72) t = 0.72 + (t - 0.72) * 1.9;
		if (t < 0.35) t = t * 0.85;
		docLut[v] = clamp(t * 255);
	}
	// Beleuchtungskarte: Bilinear-Gewichte hängen nur an x bzw. y — einmal je Spalte/Zeile.
	const colI = new Int32Array(w), colF = new Float32Array(w);
	for (let x2 = 0; x2 < w; x2++) {
		let fx = x2 * kx - 0.5;
		if (fx < 0) fx = 0; else if (fx > bg.bw - 2.001) fx = bg.bw - 2.001;
		const i0 = fx | 0;
		colI[x2] = i0; colF[x2] = fx - i0;
	}
	const rowAt = (yy) => {
		let fy = yy * ky - 0.5;
		if (fy < 0) fy = 0; else if (fy > bg.bh - 2.001) fy = bg.bh - 2.001;
		const i0 = fy | 0;
		return { i0, f: fy - i0 };
	};
	// Weißabgleich je Kanal einzeln (ein gemeinsamer Helligkeitswert ließe Farbstiche stehen).
	const base = (map, o, dx, dy) => Math.max(36,
		map[o] * (1 - dx) * (1 - dy) + map[o + 1] * dx * (1 - dy) +
		map[o + bg.bw] * (1 - dx) * dy + map[o + bg.bw + 1] * dx * dy);
	// S/W-Schwelle aus dem tatsächlichen Scan ableiten (bewahrt hellen Bleistift besser).
	let bwLow = 110, bwSpan = 90;
	if (mode === "bw") {
		const hist = new Uint32Array(256);
		let samples = 0;
		for (let sy = 0; sy < h; sy += 4) {
			const row = rowAt(sy);
			for (let sx = 0; sx < w; sx += 4) {
				const i = (sy * w + sx) * 4, o = row.i0 * bg.bw + colI[sx], fx = colF[sx];
				const rr = clamp(px[i] * 255 / base(bg.r, o, fx, row.f));
				const gg = clamp(px[i + 1] * 255 / base(bg.g, o, fx, row.f));
				const bb = clamp(px[i + 2] * 255 / base(bg.b, o, fx, row.f));
				hist[docLut[(rr * 77 + gg * 150 + bb * 29) >> 8]]++; samples++;
			}
		}
		const percentile = (p) => {
			let acc = 0; const target = samples * p;
			for (let n = 0; n < 256; n++) { acc += hist[n]; if (acc >= target) return n; }
			return 255;
		};
		const dark = percentile(.01), light = percentile(.92), span = light - dark;
		if (span >= 48) { bwLow = clamp(dark + span * .12); bwSpan = Math.max(55, span * .62); }
	}
	const monoLut = mode === "color" ? null : new Uint8Array(256);
	if (monoLut) for (let v = 0; v < 256; v++) {
		if (mode === "bw") {
			let t = (v - bwLow) / bwSpan;
			t = t < 0 ? 0 : t > 1 ? 1 : t;
			monoLut[v] = clamp(255 * t * t * (3 - 2 * t));
		} else monoLut[v] = clamp((v - 128) * 1.45 + 128);
	}
	for (let y = 0; y < h; y++) {
		const row = rowAt(y);
		for (let x2 = 0; x2 < w; x2++) {
			const i = (y * w + x2) * 4, o = row.i0 * bg.bw + colI[x2], fx = colF[x2];
			const r = clamp(px[i] * 255 / base(bg.r, o, fx, row.f));
			const g2 = clamp(px[i + 1] * 255 / base(bg.g, o, fx, row.f));
			const b = clamp(px[i + 2] * 255 / base(bg.b, o, fx, row.f));
			if (monoLut) px[i] = px[i + 1] = px[i + 2] = monoLut[docLut[(r * 77 + g2 * 150 + b * 29) >> 8]];
			else { px[i] = docLut[r]; px[i + 1] = docLut[g2]; px[i + 2] = docLut[b]; }
		}
	}
	// Leichter Unsharp-Mask (Text schärfer). In S/W und Graustufen ist r=g=b — dort EINEN
	// Kanal rechnen und kopieren.
	const copy = new Uint8ClampedArray(px);
	const amount = 0.55;
	const chans = monoLut ? 1 : 3;
	for (let y = 1; y < h - 1; y++) {
		for (let x2 = 1; x2 < w - 1; x2++) {
			const i = (y * w + x2) * 4;
			for (let c = 0; c < chans; c++) {
				const c0 = copy[i + c];
				const blur2 =
					(copy[i - w * 4 + c] + copy[i + w * 4 + c] + copy[i - 4 + c] + copy[i + 4 + c] + c0 * 4) / 8;
				px[i + c] = clamp(c0 + (c0 - blur2) * amount);
			}
			if (monoLut) px[i + 1] = px[i + 2] = px[i];
		}
	}
	return pix;
}

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
