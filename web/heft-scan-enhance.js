// heft-scan-enhance.js — Bildaufbereitung des Dokument-Scanners (reine Pixel-Funktionen, ohne DOM).
// Bilder sind { data: Uint8ClampedArray (RGBA), width, height } und werden in place verändert.
//
// Ablauf für Farbe / Graustufen / S/W:
//   1) Papierfarbe je Bereich schätzen (helle Pixel je Block, nicht der Mittelwert — Text zieht
//      den Mittelwert in dichten Absätzen sonst nach unten) und herausdividieren → Schatten,
//      Lichtverlauf und Farbstich verschwinden, Papier ≈ 1.0.
//   2) Tonkurve aus dem Bild selbst: Papierniveau → Weiß, dunkelste Tinte → fast Schwarz,
//      Gamma > 1 hält dünne/blasse Schrift (Bleistift, Kugelschreiber) sichtbar dunkel.
//      Die alte feste S-Kurve hob alles Mittelgraue auf Weiß und ließ solche Schrift verschwinden.
//   3) S/W: weiche Schwelle nach Otsu zwischen Tinte und Papier.

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

// Papierfarbe je Block: Mittel der hellsten ~30 % (nach Helligkeit) je Kanal, dann ein
// Max-Filter (Blöcke voller Text/Bild übernehmen das Papier der Nachbarn) und zwei Glättungen.
function paperMap(pix) {
	const w = pix.width, h = pix.height, d = pix.data;
	const B = Math.max(8, Math.round(Math.min(w, h) / 40));
	const bw = Math.max(2, Math.ceil(w / B)), bh = Math.max(2, Math.ceil(h / B));
	const mr = new Float32Array(bw * bh), mg = new Float32Array(bw * bh), mb = new Float32Array(bw * bh);
	const hist = new Uint32Array(256);
	for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
		const x0 = bx * B, y0 = by * B, x1 = Math.min(w, x0 + B), y1 = Math.min(h, y0 + B);
		hist.fill(0);
		let n = 0;
		for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
			const i = (y * w + x) * 4;
			hist[(d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8]++; n++;
		}
		let acc = 0, thr = 255;
		for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.3) { thr = v; break; } }
		let r = 0, g = 0, b = 0, c = 0;
		for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
			const i = (y * w + x) * 4;
			if (((d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8) >= thr) { r += d[i]; g += d[i + 1]; b += d[i + 2]; c++; }
		}
		const o = by * bw + bx;
		mr[o] = r / Math.max(1, c); mg[o] = g / Math.max(1, c); mb[o] = b / Math.max(1, c);
	}
	const pass = (src, useMax) => {
		const dst = new Float32Array(bw * bh);
		for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
			let acc = 0, cnt = 0;
			for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
				const v = src[Math.min(bh - 1, Math.max(0, y + dy)) * bw + Math.min(bw - 1, Math.max(0, x + dx))];
				if (useMax) { if (v > acc) acc = v; } else { acc += v; cnt++; }
			}
			dst[y * bw + x] = useMax ? acc : acc / cnt;
		}
		return dst;
	};
	const smooth = (m) => pass(pass(pass(m, true), false), false);
	return { r: smooth(mr), g: smooth(mg), b: smooth(mb), bw, bh, B };
}

// „Foto“-Filter: Kontrast strecken über 2%/98%-Luminanz-Perzentile — kanalgleich, damit
// Farben nicht kippen (für Fotos statt Dokumenten).
function enhancePhoto(pix) {
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
	for (let v = 0; v < 256; v++) lut[v] = clamp255(Math.round((v - lo) * 255 / span));
	for (let i = 0; i < px.length; i += 4) { px[i] = lut[px[i]]; px[i + 1] = lut[px[i + 1]]; px[i + 2] = lut[px[i + 2]]; }
}

// 3×3-Median: entfernt einzelne dunkle Papierfasern/Körnung (1–2 px), Stift-Striche sind breiter
// und bleiben. Ohne ihn stand raues Papier als Punkte-Rauschen im Scan (unruhig, ~40 % größere Datei).
function median3(src, w, h) {
	const out = new Uint16Array(src.length);
	const v = new Uint16Array(9);
	for (let y = 0; y < h; y++) {
		const ym = y > 0 ? y - 1 : y, yp = y < h - 1 ? y + 1 : y;
		for (let x = 0; x < w; x++) {
			const xm = x > 0 ? x - 1 : x, xp = x < w - 1 ? x + 1 : x;
			v[0] = src[ym * w + xm]; v[1] = src[ym * w + x]; v[2] = src[ym * w + xp];
			v[3] = src[y * w + xm]; v[4] = src[y * w + x]; v[5] = src[y * w + xp];
			v[6] = src[yp * w + xm]; v[7] = src[yp * w + x]; v[8] = src[yp * w + xp];
			// Teil-Sortierung bis zum Median (Index 4)
			for (let i = 0; i <= 4; i++) {
				let m = i;
				for (let j = i + 1; j < 9; j++) if (v[j] < v[m]) m = j;
				const t = v[i]; v[i] = v[m]; v[m] = t;
			}
			out[y * w + x] = v[4];
		}
	}
	return out;
}

// Normierte Werte (Pixel / Papier) liegen in 0…~1.2; als 0…NB-1 quantisiert für Histogramme/LUTs.
const NB = 1024, NMAX = 1.25;
const qn = (v) => { const q = (v / NMAX * (NB - 1)) | 0; return q < 0 ? 0 : q >= NB ? NB - 1 : q; };

export function applyScanModePixels(pix, mode) {
	if (mode === "photo") { enhancePhoto(pix); return pix; }
	const w = pix.width, h = pix.height, px = pix.data;
	const bg = paperMap(pix);
	// Körnung nur bei großen Scans filtern: dort sind Stift-Striche mehrere Pixel breit. In kleinen
	// Bildern sind Striche ~1 px — der Median würde echte Schrift löschen.
	const denoise = Math.min(w, h) >= 1000;
	// Bilineare Gewichte der Papierkarte je Spalte/Zeile vorberechnen
	const colI = new Int32Array(w), colF = new Float32Array(w);
	for (let x = 0; x < w; x++) {
		let f = (x + 0.5) / bg.B - 0.5;
		if (f < 0) f = 0; else if (f > bg.bw - 1.001) f = bg.bw - 1.001;
		colI[x] = f | 0; colF[x] = f - (f | 0);
	}
	const paperAt = (map, y, x) => {
		let fy = (y + 0.5) / bg.B - 0.5;
		if (fy < 0) fy = 0; else if (fy > bg.bh - 1.001) fy = bg.bh - 1.001;
		const y0 = fy | 0, dy = fy - y0, o = y0 * bg.bw + colI[x], dx = colF[x];
		return Math.max(24, map[o] * (1 - dx) * (1 - dy) + map[o + 1] * dx * (1 - dy) + map[o + bg.bw] * (1 - dx) * dy + map[o + bg.bw + 1] * dx * dy);
	};
	// 1) Normieren (Papier ≈ 1.0); Ergebnis quantisiert je Kanal + Luminanz
	const n = w * h, qr = new Uint16Array(n), qg = new Uint16Array(n), qb = new Uint16Array(n), ql = new Uint16Array(n);
	const hist = new Uint32Array(NB);
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
		const k = y * w + x, i = k * 4;
		const r = px[i] / paperAt(bg.r, y, x), g = px[i + 1] / paperAt(bg.g, y, x), b = px[i + 2] / paperAt(bg.b, y, x);
		qr[k] = qn(r); qg[k] = qn(g); qb[k] = qn(b);
		const l = qn(r * 0.299 + g * 0.587 + b * 0.114);
		ql[k] = l; hist[l]++;
	}
	// 2) Tonkurve aus dem Histogramm: Papier = Median (meist Papier), Tinte = 1. Perzentil
	const pct = (p) => { let acc = 0; for (let v = 0; v < NB; v++) { acc += hist[v]; if (acc >= n * p) return v; } return NB - 1; };
	const paper = pct(0.5), ink = Math.min(pct(0.01), paper * 0.6);
	// Weißpunkt knapp unter dem Papier: 0.90 löschte blassen Bleistift und Heftlinien, 0.955 ließ
	// Papierstruktur stehen (+45 % Dateigröße). 0.92 ist der gemessene Mittelweg.
	const white = paper * 0.92;
	const black = ink * 0.85;
	const span = Math.max(1, white - black);
	const tone = new Float32Array(NB);
	for (let v = 0; v < NB; v++) {
		const t = (v - black) / span;
		tone[v] = t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(t, 1.5);
	}
	if (mode === "color") {
		const lut = new Uint8Array(NB);
		for (let v = 0; v < NB; v++) lut[v] = clamp255(tone[v] * 255);
		const mr = denoise ? median3(qr, w, h) : qr, mg = denoise ? median3(qg, w, h) : qg, mb = denoise ? median3(qb, w, h) : qb;
		for (let k = 0, i = 0; k < n; k++, i += 4) { px[i] = lut[mr[k]]; px[i + 1] = lut[mg[k]]; px[i + 2] = lut[mb[k]]; }
		return pix;
	}
	let lut = new Uint8Array(NB);
	if (mode === "bw") {
		// 3) Otsu auf der Tonkurve (zwischen Tinte und Papier), Schwelle begrenzt, weiche Kante
		const th = new Float64Array(256);
		for (let v = 0; v < NB; v++) th[Math.round(tone[v] * 255)] += hist[v];
		let sum = 0, tot = 0;
		for (let v = 0; v < 256; v++) { sum += v * th[v]; tot += th[v]; }
		let sB = 0, wB = 0, best = 0, T = 180;
		for (let v = 0; v < 256; v++) {
			wB += th[v]; if (!wB) continue;
			const wF = tot - wB; if (!wF) break;
			sB += v * th[v];
			const mB = sB / wB, mF = (sum - sB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
			if (between > best) { best = between; T = v; }
		}
		T = Math.min(215, Math.max(120, T + 12));
		for (let v = 0; v < NB; v++) {
			const t = (tone[v] * 255 - (T - 18)) / 36;
			const s = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
			lut[v] = clamp255(s * 255);
		}
	} else {
		for (let v = 0; v < NB; v++) lut[v] = clamp255(tone[v] * 255);
	}
	const ml = denoise ? median3(ql, w, h) : ql;
	for (let k = 0, i = 0; k < n; k++, i += 4) px[i] = px[i + 1] = px[i + 2] = lut[ml[k]];
	return pix;
}
