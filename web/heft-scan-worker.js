// heft-scan-worker.js — Module-Worker für Scan-Pipeline und Blatt-Erkennung. Nutzt dieselben
// reinen Funktionen wie der Hauptthread (heft-scan-pixels.js). Anfragen tragen ein Feld `type`:
//  - "process" (Standard, auch ohne Feld): { id, bitmap, sw, sh, quad, mode, rot }
//    → Quelle begrenzen → entzerren → Filter → Drehen → JPEG. Antwort { id, blob, w, h, quality }.
//  - "detect": { id, bitmap, w, h } → Blatt-Ecken für Originalgröße w×h. Antwort { id, quad }.
//  - "live":   { id, bitmap } (ca. 300 px breit) → Helligkeit/Kontrast/Schärfe + Ecken.
//    Antwort { id, quad, mean, contrast, sharp, sw, sh }.
// Fehler: { id, error }. Die Erkennung läuft hier, damit der Hauptthread frei für die Bedienung bleibt.
import {
	SCAN_JPEG_QUALITY, SCAN_SOURCE_MAX, readPixels, prepareSource, warpPixels, applyScanModePixels,
	rotatePixels, scanQualityPixels, writePixels, detectSizes, detectQuadPixels, fullQuadPixels,
	lumStatsPixels, toGray,
} from "./heft-scan-pixels.js";

const mk = (w, h) => new OffscreenCanvas(w, h);

// Wie detectQuad im Hauptthread: unsicher oder fehlerhaft → ganzes Bild.
function detectInWorker(bitmap, w, h) {
	if (!w || !h) return fullQuadPixels(w, h);
	try {
		const s = detectSizes(w, h);
		const analysis = readPixels(bitmap, s.dw, s.dh, mk);
		let refine = null;
		try {
			refine = { gray: toGray(readPixels(bitmap, s.gw, s.gh, mk)), gw: s.gw, gh: s.gh };
		} catch (e) { console.warn("Heft: Kanten-Verfeinerung übersprungen", e); }
		return detectQuadPixels(analysis, w, h, refine);
	} catch (e) {
		console.warn("Heft: Dokumenterkennung fehlgeschlagen", e);
		return fullQuadPixels(w, h);
	}
}

async function processJob({ bitmap, sw, sh, quad, mode, rot }) {
	const src = prepareSource(bitmap, sw, sh, quad, SCAN_SOURCE_MAX, mk);
	if (bitmap.close) bitmap.close();
	let pix = warpPixels(src.pixels, src.quad);
	applyScanModePixels(pix, mode);
	pix = rotatePixels(pix, rot || 0);
	const quality = scanQualityPixels(pix);
	const blob = await writePixels(pix, mk).convertToBlob({ type: "image/jpeg", quality: SCAN_JPEG_QUALITY });
	return { blob, w: pix.width, h: pix.height, quality };
}

self.onmessage = async (e) => {
	const msg = e.data || {};
	const { id, bitmap, type = "process" } = msg;
	try {
		if (type === "detect") {
			const quad = detectInWorker(bitmap, msg.w, msg.h);
			if (bitmap.close) bitmap.close();
			self.postMessage({ id, quad });
		} else if (type === "live") {
			const sw = bitmap.width, sh = bitmap.height;
			const pix = readPixels(bitmap, sw, sh, mk);
			if (bitmap.close) bitmap.close();
			const { mean, contrast, sharp } = lumStatsPixels(pix, 2);
			const quad = detectQuadPixels(pix, sw, sh, { gray: toGray(pix), gw: sw, gh: sh });
			self.postMessage({ id, quad, mean, contrast, sharp, sw, sh });
		} else {
			const res = await processJob(msg);
			self.postMessage({ id, ...res });
		}
	} catch (err) {
		if (bitmap && bitmap.close) bitmap.close();
		self.postMessage({ id, error: String((err && err.message) || err) });
	}
};
