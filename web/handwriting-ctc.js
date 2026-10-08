"use strict";

// web/handwriting-ctc.js — CTC-Decoding & Wörterbuch-Korrektur für Strichsequenz-Inferenz.

import { HANDWRITING_VOCAB } from "./handwriting-vocab.js";

export const HANDWRITING_CTC = (() => {
	// Kompakte Liste häufiger deutscher Notiz- und Alltagswörter für Post-Processing
	const COMMON_WORDS = new Set([
		"der", "die", "das", "und", "in", "den", "von", "zu", "mit",
		"sich", "des", "auf", "für", "ist", "im", "dem", "nicht", "ein", "eine",
		"als", "auch", "es", "an", "werden", "aus", "er", "hat", "dass", "sie",
		"nach", "wird", "bei", "einer", "um", "am", "sind", "noch", "wie", "einem",
		"über", "einen", "so", "zum", "war", "haben", "nur", "oder", "aber", "vor",
		"zur", "bis", "mehr", "durch", "man", "sein", "wurde", "sei", "prozent",
		"notiz", "notizen", "aufgabe", "aufgaben", "projekt", "projekte", "idee", "ideen",
		"ziel", "ziele", "datum", "heute", "morgen", "gestern", "wichtig", "dringend",
		"treffen", "meeting", "bericht", "arbeit", "schule", "studium", "thema", "kapitel",
		"montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag", "sonntag",
		"januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september",
		"oktober", "november", "dezember", "jahr", "woche", "monat", "tag", "stunde",
		"frage", "fragen", "antwort", "antworten", "code", "test", "fehler", "plan",
		// Mathe-, Einheiten- und MINT-Begriffe
		"sin", "cos", "tan", "lim", "log", "exp", "max", "min", "grad",
	]);

	// Levenshtein-Distanz zur Fehlertoleranz
	function levenshtein(a, b) {
		if (a === b) return 0;
		if (!a.length) return b.length;
		if (!b.length) return a.length;
		const row = [];
		for (let i = 0; i <= b.length; i++) row[i] = i;
		for (let i = 1; i <= a.length; i++) {
			let prev = i;
			for (let j = 1; j <= b.length; j++) {
				const val = a[i - 1] === b[j - 1] ? row[j - 1] : Math.min(row[j - 1], prev, row[j]) + 1;
				row[j - 1] = prev;
				prev = val;
			}
			row[b.length] = prev;
		}
		return row[b.length];
	}

	// Korrigiert ein einzelnes Wort über das Wörterbuch
	function correctWord(rawWord, mode = "text") {
		if (!rawWord || rawWord.length < 3) return rawWord;
		// Im Mathe-Modus Formelausdrücke nicht antasten
		if (mode === "math") {
			if (/^[\d\W]+$/.test(rawWord) || /[=+\-*/^_{}()\\]/.test(rawWord)) return rawWord;
		} else {
			if (/^[\d\W]+$/.test(rawWord) || /[=+\-*/]/.test(rawWord)) return rawWord;
		}

		// Satzzeichen am Rand isolieren
		const match = rawWord.match(/^([^\w]*)(.*?)([^\w]*)$/);
		if (!match) return rawWord;
		const [, prefix, core, suffix] = match;
		if (core.length < 3) return rawWord;

		const lower = core.toLowerCase();
		if (COMMON_WORDS.has(lower)) return rawWord;

		let bestMatch = null;
		let minDistance = 2; // Maximal 1 Fehler bei kurzen Wörtern, 2 bei langen Wörtern

		for (const dictWord of COMMON_WORDS) {
			if (Math.abs(dictWord.length - lower.length) > 1) continue;
			const dist = levenshtein(lower, dictWord);
			if (dist < minDistance) {
				minDistance = dist;
				bestMatch = dictWord;
				if (dist === 1) break; // Schnellabgleich
			}
		}

		if (bestMatch && minDistance <= (core.length >= 6 ? 2 : 1)) {
			// Großschreibung des Originals beibehalten
			const isCapitalized = core[0] === core[0].toUpperCase();
			const corrected = isCapitalized ? bestMatch.charAt(0).toUpperCase() + bestMatch.slice(1) : bestMatch;
			return prefix + corrected + suffix;
		}

		return rawWord;
	}

	// Berechnet Softmax über ein 1D-Float32Array
	function softmax(arr) {
		let maxVal = -Infinity;
		for (let i = 0; i < arr.length; i++) {
			if (arr[i] > maxVal) maxVal = arr[i];
		}
		let sum = 0;
		const expArr = new Float32Array(arr.length);
		for (let i = 0; i < arr.length; i++) {
			const e = Math.exp(arr[i] - maxVal);
			expArr[i] = e;
			sum += e;
		}
		const invSum = sum > 0 ? 1 / sum : 1;
		for (let i = 0; i < arr.length; i++) {
			expArr[i] *= invSum;
		}
		return expArr;
	}

	// Dekodiert CTC-Logits mit genauer Konfidenz- und Statusberechnung
	function decodeWithConfidence(logits2D, vocab = HANDWRITING_VOCAB, options = {}) {
		if (!logits2D || !logits2D.length) {
			return { text: "", rawText: "", confidence: 0, status: "empty", isConfident: false, blankRatio: 1, charConfidences: [] };
		}
		const blank = vocab.BLANK_INDEX ?? 0;
		const threshold = Number(options.threshold ?? 0.80);
		const mode = options.mode || "text";
		const isTextMode = mode !== "math";
		const mathIndices = isTextMode && vocab.MATH_INDICES ? vocab.MATH_INDICES : null;
		const numSteps = logits2D.length;

		let blankCount = 0;
		const collapsed = [];
		const charConfidences = [];
		let currentRunIdx = null;
		let currentRunMaxProb = 0;

		for (let t = 0; t < numSteps; t++) {
			let stepLogits = logits2D[t];
			if (mathIndices && mathIndices.size > 0) {
				stepLogits = new Float32Array(stepLogits);
				for (const mIdx of mathIndices) {
					stepLogits[mIdx] = -Infinity;
				}
			}
			const probs = softmax(stepLogits);

			let bestIdx = 0;
			let bestProb = -Infinity;
			for (let c = 0; c < probs.length; c++) {
				if (probs[c] > bestProb) {
					bestProb = probs[c];
					bestIdx = c;
				}
			}

			if (bestIdx === blank) {
				blankCount++;
				if (currentRunIdx !== null) {
					collapsed.push(currentRunIdx);
					charConfidences.push(currentRunMaxProb);
					currentRunIdx = null;
					currentRunMaxProb = 0;
				}
			} else {
				if (bestIdx === currentRunIdx) {
					if (bestProb > currentRunMaxProb) currentRunMaxProb = bestProb;
				} else {
					if (currentRunIdx !== null) {
						collapsed.push(currentRunIdx);
						charConfidences.push(currentRunMaxProb);
					}
					currentRunIdx = bestIdx;
					currentRunMaxProb = bestProb;
				}
			}
		}

		if (currentRunIdx !== null) {
			collapsed.push(currentRunIdx);
			charConfidences.push(currentRunMaxProb);
		}

		const blankRatio = blankCount / Math.max(1, numSteps);
		const rawChars = collapsed.map((idx) => vocab.charForIndex(idx));
		const rawText = rawChars.join("");
		const text = cleanTranscription(rawText, options);

		// Gesamt-Konfidenz: Arithmetisches Mittel der Zeichen-Wahrscheinlichkeiten
		let confidence = 0;
		if (charConfidences.length > 0) {
			const sum = charConfidences.reduce((a, b) => a + b, 0);
			confidence = sum / charConfidences.length;
		}

		// Statusbestimmung (Zeichnung vs. Unsicher vs. Erkannt)
		let status = "recognized";
		if (text.length === 0) {
			status = "empty";
		} else if (confidence < 0.45 || (text.length <= 2 && confidence < 0.60)) {
			// Chaotische Ausgabe -> Reine Zeichnung ("kein Text"). blankRatio taugt dafür nicht:
			// seit der Median-Normalisierung liefert auch saubere Schrift ~97 % Blank-Schritte.
			status = "drawing";
		} else if (confidence < threshold) {
			// Unsicher: Liegt unterhalb der Kauderwelsch-Schwelle
			status = "uncertain";
		}

		const isConfident = status === "recognized";

		return {
			text,
			rawText,
			confidence: Math.round(confidence * 1000) / 1000,
			status,
			isConfident,
			blankRatio: Math.round(blankRatio * 1000) / 1000,
			charConfidences,
		};
	}

	// Bereinigung von Formatierungsfehlern und Wörterbuch-Abgleich
	function cleanTranscription(text, options = {}) {
		let cleaned = String(text || "")
			.replace(/\s+/g, " ")
			.trim();

		const mode = options.mode || "text";
		if (mode !== "math") {
			// Schutz gegen angehängte oder fehldekodierte Mathe-Zeichen ("Handbreit√")
			cleaned = cleaned.replace(/[\^_<>{}\~√∫∑πλαβ\\]/g, "").replace(/\s+/g, " ").trim();
		}

		// Wörterbuch-Korrektur über einzelne Wörter laufen lassen
		return cleaned
			.split(" ")
			.map((w) => correctWord(w, mode))
			.join(" ");
	}

	return {
		decodeWithConfidence,
		cleanTranscription,
		correctWord,
		levenshtein,
	};
})();

