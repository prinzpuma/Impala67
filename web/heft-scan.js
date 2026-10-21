"use strict";

// heft-scan.js — Bildverarbeitungs-Kern des Dokument-Scanners. Blatt-Erkennung →
// Kanten-Verfeinerung → perspektivische Entzerrung → Beleuchtung/Filter → Qualität.
// Die Pixelrechnung liegt in heft-scan-pixels.js (rein, ohne DOM) und läuft im Worker
// heft-scan-worker.js; dieser Hauptthread-Teil kümmert sich um Bildquellen, Canvas-Brücke
// und den Worker-Lebenszyklus. Kamera-/Overlay-UI lebt in heft-scanner-ui.js.
import {
	SCAN_JPEG_QUALITY, SCAN_SOURCE_MAX, readPixels, writePixels, prepareSource, warpPixels,
	applyScanModePixels, rotatePixels, lumStatsPixels, scanQualityPixels, toGray,
	detectSizes, detectQuadPixels, fullQuadPixels, quadArea, isConvex,
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
	// Dokumenterkennung v4: liest Analysebild und Graubild aus dem Canvas, die Auswahl
	// selbst liegt rein in heft-scan-pixels.js (detectQuadPixels). Unsicher → ganzes Bild.
	function detectQuad(img, w, h) {
		if (!w || !h) return fullQuadPixels(w, h);
		try {
			// Aufnahme: mehr Analyseauflösung für präzisere Ecken. Die Live-Vorschau
			// bleibt klein, weil heft-scanner-ui.js nur 300 px breit prüft.
			const s = detectSizes(w, h);
			const analysis = readPixels(img, s.dw, s.dh, mkCanvas);
			let refine = null;
			try {
				refine = { gray: toGray(readPixels(img, s.gw, s.gh, mkCanvas)), gw: s.gw, gh: s.gh };
			} catch (e) { console.warn("Heft: Kanten-Verfeinerung übersprungen", e); }
			return detectQuadPixels(analysis, w, h, refine);
		} catch (e) {
			console.warn("Heft: Dokumenterkennung fehlgeschlagen", e);
			return fullQuadPixels(w, h);
		}
	}
	// Kennzahlen aus demselben Kern wie die Ergebnisprüfung (heft-scan-pixels.js)
	function lumStats(cv, step = 1) {
		return lumStatsPixels(readPixels(cv, cv.width, cv.height, mkCanvas), step);
	}
	const tick = () => new Promise((r) => setTimeout(r, 0));

	// Scan-Pipeline und Blatt-Erkennung im Worker: ein lazy erzeugter Worker, Anfragen per id.
	// Fällt der Worker aus (onerror oder Fehlerantwort), wird dauerhaft auf den Hauptthread
	// umgeschaltet. Alle Anfragetypen (process/detect/live) laufen über dieselbe ask().
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
	// Eine Anfrage an den Worker. transfer = ImageBitmaps, die übergeben werden; bei Abbruch
	// werden sie geschlossen, damit keine Bitmap im Speicher hängen bleibt.
	function ask(msg, transfer = []) {
		return new Promise((resolve, reject) => {
			if (!getWorker() || workerDown) { reject(new Error("Scan-Worker ausgefallen")); return; }
			const id = ++reqId;
			pending.set(id, { resolve, reject });
			worker.postMessage({ ...msg, id }, transfer);
		}).catch((err) => {
			transfer.forEach((b) => { if (b.close) b.close(); });
			throw err;
		});
	}
	async function renderInWorker(img, sw, sh, quad, mode, rot) {
		// Kopie als ImageBitmap, damit das Rohbild des Aufrufers gültig bleibt (er gibt es selbst frei)
		const bitmap = await createImageBitmap(img);
		return ask({ type: "process", bitmap, sw, sh, quad, mode, rot }, [bitmap]);
	}
	// Blatt-Erkennung ohne Hauptthread-Last. Ohne Worker oder bei Fehler: synchroner detectQuad.
	async function detectQuadAsync(src, w, h) {
		if (workerAvailable()) {
			try {
				const bitmap = await createImageBitmap(src);
				const res = await ask({ type: "detect", bitmap, w, h }, [bitmap]);
				return res.quad;
			} catch (e) { markWorkerDown(); console.warn("Heft: Erkennung im Worker umgangen", e); }
		}
		return detectQuad(src, w, h);
	}
	// Live-Prüfung der Kameravorschau: 300-px-Bild aus dem Video (billig auf dem Hauptthread),
	// Erkennung und Kennzahlen im Worker. Ergebnis wie zuvor liveQualityFrame.
	function liveInfo({ quad, mean, contrast, sharp, sw, sh }) {
		const area = quadArea(quad) / Math.max(1, sw * sh);
		const found = quadArea(quad) < sw * sh * 0.96;
		const margin = found ? Math.min(...quad.map((p) => Math.min(p[0], p[1], sw - 1 - p[0], sh - 1 - p[1]))) : 0;
		return { quad, found, mean, contrast, sharp, area, margin, sw, sh };
	}
	async function liveCheck(video) {
		const sw = 300, sh = Math.max(150, Math.round(video.videoHeight / Math.max(1, video.videoWidth) * sw));
		const c = mkCanvas(sw, sh);
		c.getContext("2d", { willReadFrequently: true }).drawImage(video, 0, 0, sw, sh);
		if (workerAvailable()) {
			try {
				const bitmap = await createImageBitmap(c);
				return liveInfo(await ask({ type: "live", bitmap }, [bitmap]));
			} catch (e) { markWorkerDown(); console.warn("Heft: Live-Prüfung im Worker umgangen", e); }
		}
		// Hauptthread-Fallback: dieselbe Rechnung wie der Worker (step 2 bei den Kennzahlen)
		const { mean, contrast, sharp } = lumStats(c, 2);
		return liveInfo({ quad: detectQuad(c, sw, sh), mean, contrast, sharp, sw, sh });
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
	// Das dekodierte Rohbild (12 MP ≈ 48 MB) wird nach jedem Lauf freigegeben statt je
	// Aufnahme behalten – sonst brachten 15–20 Scans Safari auf dem iPad zum Absturz.
	// Ein erneuter Lauf (Filter, Ecken) dekodiert es neu.
	async function processShot(sh, snapshot) {
		const img = await loadImg(sh.src);
		try { return await processDecoded(sh, img, snapshot); }
		finally { if (img !== sh.src && typeof img?.close === "function") { try { img.close(); } catch { /* schon frei */ } } }
	}
	async function processDecoded(sh, img, snapshot) {
		const { w, h } = sizeOf(img);
		sh.w = w; sh.h = h;
		let quad = snapshot && snapshot.quad ? snapshot.quad.map((p) => p.slice()) : sh.quad;
		if (!Array.isArray(quad) || quad.length !== 4) {
			quad = await detectQuadAsync(img, sh.w, sh.h);
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
	return {
		SCAN_MODES, loadImg, quadArea, isConvex, detectQuad, detectQuadAsync, liveCheck,
		processShot, blobToDataUrl,
	};
})();
