"use strict";

// heft-ink-worker.js — Module-Worker: rastert die Striche einer Heft-Seite auf eine
// durchsichtige OffscreenCanvas, damit eine dichte Seite beim Scrollen nicht den
// Hauptthread blockiert. Papier, Bilder, Text und Auswahl zeichnet weiter der Hauptthread.
// Anfrage: { id, w, h, m: [a, b, c, d, e, f], strokes: [{ tool, color, size, shape, xyp }] }
//   xyp: Float32Array mit x, y, Druck je Punkt (Druck < 0 = ohne Druck).
// Antwort: { id, bitmap } (übertragen) oder { id, error }.
import { drawStroke } from "./heft-stroke-draw.js";

function pointsOf(xyp) {
	const pts = new Array(xyp.length / 3);
	for (let i = 0, j = 0; i < pts.length; i++, j += 3) {
		const p = xyp[j + 2];
		pts[i] = p >= 0 ? [xyp[j], xyp[j + 1], p] : [xyp[j], xyp[j + 1]];
	}
	return pts;
}

self.onmessage = (e) => {
	const { id, w, h, m, strokes } = e.data;
	try {
		const cv = new OffscreenCanvas(w, h);
		const x = cv.getContext("2d");
		x.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
		for (const s of strokes) drawStroke(x, { tool: s.tool, color: s.color, size: s.size, shape: s.shape, pts: pointsOf(s.xyp) });
		const bitmap = cv.transferToImageBitmap();
		self.postMessage({ id, bitmap }, [bitmap]);
	} catch (err) {
		self.postMessage({ id, error: String(err && err.message || err) });
	}
};
