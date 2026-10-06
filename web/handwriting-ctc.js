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
	function correctWord(rawWord) {
		if (!rawWord || rawWord.length < 3) return rawWord;
		// Reines Zahlen-, Symbol- oder Matheformel-Wort nicht antasten
		if (/^[\d\W]+$/.test(rawWord) || /[=+\-*/^_{}()\\]/.test(rawWord)) return rawWord;

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

	// Greedy CTC-Decoding: Argmax pro Zeitschritt, identische aufeinanderfolgende Token kollabieren, Blank entfernen
	function greedyDecode(logits2D, vocab = HANDWRITING_VOCAB) {
		if (!logits2D || !logits2D.length) return "";
		const blank = vocab.BLANK_INDEX ?? 0;
		const indices = [];

		for (let t = 0; t < logits2D.length; t++) {
			const step = logits2D[t];
			let bestIdx = 0, bestVal = -Infinity;
			for (let c = 0; c < step.length; c++) {
				if (step[c] > bestVal) {
					bestVal = step[c];
					bestIdx = c;
				}
			}
			indices.push(bestIdx);
		}

		// CTC-Kompression: Duplikate kollabieren und Blank entfernen
		const collapsed = [];
		let prev = null;
		for (const idx of indices) {
			if (idx !== prev) {
				if (idx !== blank) {
					collapsed.push(idx);
				}
				prev = idx;
			}
		}

		const rawText = collapsed.map((idx) => vocab.charForIndex(idx)).join("");
		return cleanTranscription(rawText);
	}

	// Bereinigung von Formatierungsfehlern und Wörterbuch-Abgleich
	function cleanTranscription(text) {
		const cleaned = String(text || "")
			.replace(/\s+/g, " ")
			.trim();

		// Wörterbuch-Korrektur über einzelne Wörter laufen lassen
		return cleaned
			.split(" ")
			.map(correctWord)
			.join(" ");
	}

	return {
		greedyDecode,
		cleanTranscription,
		correctWord,
		levenshtein,
	};
})();
