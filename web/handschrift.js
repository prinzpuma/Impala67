"use strict";
import { S } from "./state.js";
import { AI } from "./ai.js";

// handschrift.js — Handschrift-Erkennung v2 für GoodNotes-Hefte (heft.js).
//
// Warum v2: Tesseract ist ein Druckschrift-OCR. Auf Handschrift liefert es fast
// ausschließlich Zeichenmüll — die Heft-Suche war damit faktisch kaputt. Moderne
// Vision-Modelle (Gemini 2.5, GPT-4.1) lesen Handschrift dagegen zuverlässig und
// sind in Impala67 ohnehin als KI-Quelle konfiguriert.
//
// Strategie:
//   1) Vision-Modell der aktiven KI-Quelle (wenn multimodal) — beste Qualität.
//   2) Fallback: lokales Tesseract (window.Tesseract aus index.html) mit
//      Vorverarbeitung + Konfidenz-Filter — Bilddaten verlassen den Browser nicht.
//   3) recognize() → null bei Fehlern: der Aufrufer behält den alten ocrText.
export const HANDSCHRIFT = (() => {
	// Multimodale Modelle laut MODEL_PRESETS in ai.js. Lokale Server melden ihre
	// Vision-Fähigkeit nicht einheitlich — dort bleibt Tesseract der sichere Weg.
	function visionReady() {
		const pr = (S.settings.aiProviders || []).find((p) => p.id === S.settings.aiProviderId) || null;
		const model = String(S.settings.aiModel || "").toLowerCase();
		if (!pr || !pr.base) return false;
		if (S.settings.handwritingAi === false) return false; // Opt-out in den Einstellungen möglich
		return /gemini-2\.5|gpt-4\.1|gpt-4o/.test(model);
	}
	const tesseractReady = () => typeof window !== "undefined" && !!window.Tesseract;
	const available = () => visionReady() || tesseractReady();

	// Vorverarbeitung für Tesseract: Graustufen + weiche Schwelle. Papier und die
	// hellblauen Linien werden weiß, Tinte schwarz — das hebt die Trefferquote
	// deutlich, ersetzt aber kein Vision-Modell.
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

	async function recognizeVision(canvas) {
		const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
		const messages = [
			{ role: "system", content: "Du bist ein OCR-System. Transkribiere ALLEN handschriftlichen und gedruckten Text der Notizbuchseite. Erhalte Zeilenumbrüche; mathematische Ausdrücke als LaTeX. Antworte NUR mit dem transkribierten Text, ohne Kommentar oder Einleitung. Ist kein Text lesbar, antworte mit LEER." },
			{ role: "user", content: [
				{ type: "text", text: "Transkribiere diese Seite." },
				{ type: "image_url", image_url: { url: dataUrl } },
			] },
		];
		const msg = await AI.chatOnce(messages);
		const text = String((msg && msg.content) || "").trim();
		return /^\(?(leer|kein text|empty|no text)\)?\.?$/i.test(text) ? "" : text;
	}

	async function recognizeTesseract(canvas) {
		const pre = preprocess(canvas);
		const res = await window.Tesseract.recognize(pre, "deu+eng");
		const data = (res && res.data) || {};
		// Konfidenz-Filter: Tesseract-Zeilen unter ~35 % sind bei Handschrift fast
		// immer Müll und vergifteten bisher die Suche.
		const lines = (data.lines || [])
			.filter((l) => (l.confidence || 0) >= 35)
			.map((l) => String(l.text || "").trim())
			.filter(Boolean);
		return (lines.length ? lines.join("\n") : String(data.text || "")).trim();
	}

	// Liefert erkannten Text oder null (= Aufrufer behält den bisherigen Stand).
	async function recognize(canvas) {
		try {
			if (visionReady()) return await recognizeVision(canvas);
		} catch (e) { console.warn("Handschrift: Vision-OCR fehlgeschlagen — Fallback auf Tesseract", e); }
		try {
			if (tesseractReady()) return await recognizeTesseract(canvas);
		} catch (e) { console.warn("Handschrift: Tesseract fehlgeschlagen", e); }
		return null;
	}

	return { available, recognize };
})();