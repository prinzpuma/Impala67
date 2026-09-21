"use strict";
import { U } from "./util.js";
import { PLATFORM_NATIVE } from "./platform-native.js";

// handschrift.js — Handschrift- und Text-Erkennung für GoodNotes-Hefte (heft.js).
//
// Strategie:
//   1) Native Android App: Google ML Kit (On-Device Text Recognition, 0 ms Cloud-Latenz,
//      100 % offline, 0 API-Token-Kosten).
//   2) Web/Desktop-Fallback: Lokales Tesseract (window.Tesseract) mit Vorverarbeitung.
//   3) Kein LLM für Hintergrund-OCR: Das spart massiv Tokens und Akku. Das LLM greift
//      auf den erkannten Text über das RAG-System zu und liest Bilder nur bei expliziter
//      Frage nach Skizzen/Diagrammen.
export const HANDSCHRIFT = (() => {
	const tesseractReady = () => typeof window !== "undefined" && !!window.Tesseract;
	const available = () => true;

	async function ensureTesseractLoaded() {
		if (tesseractReady()) return true;
		try {
			await U.loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js", "Tesseract");
			return tesseractReady();
		} catch {
			throw new Error("Tesseract-OCR konnte nicht geladen werden. 📶 Internetverbindung für den Erstabruf erforderlich.");
		}
	}

	// Vorverarbeitung für Tesseract: Graustufen + weiche Schwelle. Papier und
	// Linien werden weiß, Tinte schwarz — hebt die Trefferquote bei lokalem Fallback.
	function preprocess(canvas) {
		const c = document.createElement("canvas");
		c.width = canvas.width; c.height = canvas.height;
		const x = c.getContext("2d", { willReadFrequently: true });
		x.drawImage(canvas, 0, 0);
		const d = x.getImageData(0, 0, c.width, c.height);
		const px = d.data;
		for (let i = 0; i < px.length; i += 4) {
			const v = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
			const o = v > 176 ? 255 : v < 112 ? 0 : Math.round((v - 112) / 64 * 255);
			px[i] = px[i + 1] = px[i + 2] = o;
		}
		x.putImageData(d, 0, 0);
		return c;
	}

	async function recognizeTesseract(canvas) {
		await ensureTesseractLoaded();
		const pre = preprocess(canvas);
		const res = await window.Tesseract.recognize(pre, "deu+eng");
		const data = (res && res.data) || {};
		const lines = (data.lines || [])
			.filter((l) => (l.confidence || 0) >= 35)
			.map((l) => String(l.text || "").trim())
			.filter(Boolean);
		return (lines.length ? lines.join("\n") : String(data.text || "")).trim();
	}

	// Liefert erkannten Text oder null (= Aufrufer behält den bisherigen Stand).
	async function recognize(canvas) {
		if (!canvas) return null;

		// 1. Priorität: On-Device Google ML Kit auf Android
		if (PLATFORM_NATIVE.isNative && PLATFORM_NATIVE.ocr.isAvailable) {
			try {
				const mlkitText = await PLATFORM_NATIVE.ocr.recognizeCanvas(canvas);
				if (mlkitText != null) return mlkitText;
			} catch (e) {
				console.warn("Handschrift: ML Kit fehlgeschlagen — Fallback auf Tesseract", e);
			}
		}

		// 2. Priorität: Lokales Tesseract im Browser
		try {
			return await recognizeTesseract(canvas);
		} catch (e) {
			console.warn("Handschrift: Tesseract fehlgeschlagen", e);
		}

		return null;
	}

	return { available, recognize };
})();