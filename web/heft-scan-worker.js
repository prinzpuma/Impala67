// heft-scan-worker.js — Module-Worker für die Scan-Pipeline: Quelle begrenzen → entzerren →
// Filter → Drehen → JPEG. Nutzt dieselben reinen Funktionen wie der Hauptthread-Fallback
// (heft-scan-pixels.js). Anfrage: { id, bitmap, sw, sh, quad, mode, rot }.
// Antwort: { id, blob, w, h, quality } oder { id, error }.
import {
	SCAN_JPEG_QUALITY, SCAN_SOURCE_MAX, prepareSource, warpPixels, applyScanModePixels,
	rotatePixels, scanQualityPixels, writePixels,
} from "./heft-scan-pixels.js";

const mk = (w, h) => new OffscreenCanvas(w, h);

self.onmessage = async (e) => {
	const { id, bitmap, sw, sh, quad, mode, rot } = e.data || {};
	try {
		const src = prepareSource(bitmap, sw, sh, quad, SCAN_SOURCE_MAX, mk);
		if (bitmap.close) bitmap.close();
		let pix = warpPixels(src.pixels, src.quad);
		applyScanModePixels(pix, mode);
		pix = rotatePixels(pix, rot || 0);
		const quality = scanQualityPixels(pix);
		const blob = await writePixels(pix, mk).convertToBlob({ type: "image/jpeg", quality: SCAN_JPEG_QUALITY });
		self.postMessage({ id, blob, w: pix.width, h: pix.height, quality });
	} catch (err) {
		self.postMessage({ id, error: String((err && err.message) || err) });
	}
};
