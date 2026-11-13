"use strict";

// Hauptthread-Seite des Strich-Workers (heft-ink-worker.js). render() liefert ein
// ImageBitmap mit allen Strichen der Seite oder null (kein Worker/OffscreenCanvas,
// Fehler, Seite zu klein): dann zeichnet der Aufrufer wie bisher selbst.
// Die Punkte gehen als Float32Array hinüber (Kopie per memcpy statt 100.000 kleiner
// Arrays); die Umwandlung je Strich wird zwischengespeichert, solange pts und bbox gleich
// bleiben (heft-geometry.js setzt bei jeder Verschiebung eine neue bbox).

// Kleinere Seiten zeichnet der Hauptthread schneller selbst, als ein Bild hin und her geht.
const MIN_POINTS = 3000;

export function createInkRenderer() {
	const supported = typeof Worker === "function" && typeof OffscreenCanvas === "function" && typeof createImageBitmap === "function";
	let worker = null, broken = !supported, seq = 0;
	const pending = new Map();
	const packed = new WeakMap();

	function ensureWorker() {
		if (worker || broken) return worker;
		try {
			worker = new Worker(new URL("./heft-ink-worker.js", import.meta.url), { type: "module" });
			worker.onmessage = (e) => {
				const job = pending.get(e.data.id);
				if (!job) { e.data.bitmap?.close(); return; }
				pending.delete(e.data.id);
				// Z. B. OffscreenCanvas ohne 2D-Kontext (ältere Safari-Versionen): nicht weiter versuchen.
				if (e.data.error) { broken = true; console.warn("Heft-Strich-Worker:", e.data.error); }
				job(e.data.error ? null : e.data.bitmap);
			};
			worker.onerror = (e) => {
				console.warn("Heft-Strich-Worker ausgefallen, zeichne im Hauptthread:", e.message || e);
				broken = true;
				for (const job of pending.values()) job(null);
				pending.clear();
				worker?.terminate(); worker = null;
			};
		} catch (err) {
			broken = true; worker = null;
		}
		return worker;
	}

	function pack(s) {
		const hit = packed.get(s);
		if (hit && hit.pts === s.pts && hit.n === s.pts.length && hit.bbox === s.bbox) return hit.xyp;
		const pts = s.pts, xyp = new Float32Array(pts.length * 3);
		for (let i = 0, j = 0; i < pts.length; i++, j += 3) {
			const p = pts[i];
			xyp[j] = p[0]; xyp[j + 1] = p[1]; xyp[j + 2] = p[2] == null ? -1 : p[2];
		}
		packed.set(s, { pts, n: pts.length, bbox: s.bbox, xyp });
		return xyp;
	}

	return {
		// strokes: Striche der Seite; w/h: Pixelgröße; m: Transform (wie setTransform).
		render(strokes, w, h, m) {
			if (broken || !strokes || !strokes.length) return null;
			let points = 0;
			for (const s of strokes) points += s.pts ? s.pts.length : 0;
			if (points < MIN_POINTS || !ensureWorker()) return null;
			const list = [];
			for (const s of strokes) {
				if (!s.pts || !s.pts.length) continue;
				list.push({ tool: s.tool, color: s.color, size: s.size, shape: s.shape || null, xyp: pack(s) });
			}
			const id = ++seq;
			return new Promise((resolve) => {
				pending.set(id, resolve);
				worker.postMessage({ id, w, h, m, strokes: list });
			});
		},
	};
}
