"use strict";

// web/handwriting-ctc.js — CTC-Decoding & Wörterbuch-Korrektur für Strichsequenz-Inferenz.

import { HANDWRITING_VOCAB } from "./handwriting-vocab.js";
import { GERMAN_WORDS } from "./handwriting-words-de.js";

export const HANDWRITING_CTC = (() => {
	// Häufigste deutsche Wörter plus Notiz-, Kalender- und Mathe-Begriffe für Post-Processing
	const COMMON_WORDS = new Set([
		...GERMAN_WORDS,
		"der", "die", "das", "und", "in", "den", "von", "zu", "mit",
		"sich", "des", "auf", "für", "ist", "im", "dem", "nicht", "ein", "eine",
		"als", "auch", "es", "an", "werden", "aus", "er", "hat", "dass", "sie",
		"nach", "wird", "bei", "einer", "um", "am", "sind", "noch", "wie", "einem",
		"über", "einen", "so", "zum", "war", "haben", "nur", "oder", "aber", "vor",
		"zur", "bis", "mehr", "durch", "man", "sein", "wurde", "sei", "prozent",
		"ich", "du", "wir", "ihr", "mein", "meine", "meiner", "dein", "deine", "unser",
		"kann", "können", "muss", "müssen", "soll", "sollte", "sollten", "wollen",
		"geht", "gibt", "gut", "sehr", "hier", "da", "dort", "jetzt", "immer", "wieder",
		"schon", "dann", "wenn", "weil", "alle", "alles", "viele", "nichts", "etwas",
		"notiz", "notizen", "aufgabe", "aufgaben", "projekt", "projekte", "idee", "ideen",
		"ziel", "ziele", "datum", "heute", "morgen", "gestern", "wichtig", "dringend",
		"treffen", "meeting", "bericht", "arbeit", "schule", "studium", "thema", "kapitel",
		"seite", "seiten", "punkt", "punkte", "text", "texte", "zeile", "zeilen",
		"lernen", "lesen", "schreiben", "übung", "übungen", "beispiel", "beispiele",
		"frage", "fragen", "antwort", "antworten", "code", "test", "fehler", "plan",
		"neu", "neue", "neues", "groß", "große", "klein", "kleine",
		"montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag", "sonntag",
		"januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september",
		"oktober", "november", "dezember", "jahr", "woche", "monat", "tag", "stunde",
		// Mathe-, Einheiten- und MINT-Begriffe
		"sin", "cos", "tan", "lim", "log", "exp", "max", "min", "grad",
	]);

	// Wörter, deren unsicherstes Zeichen darüber liegt, gelten als sicher erkannt.
	// Benchmark (Okt. 2026): falsche Wörter max. 0,63, richtige meist ≥ 0,8.
	const CORRECT_BELOW_CONFIDENCE = 0.7;

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
		if (!rawWord || rawWord.length < 4) return rawWord;
		// Im Mathe-Modus Formelausdrücke nicht antasten
		if (mode === "math") {
			if (/^[\d\W]+$/.test(rawWord) || /[=+\-*/^_{}()\\]/.test(rawWord)) return rawWord;
		} else {
			if (/^[\d\W]+$/.test(rawWord) || /[=+\-*/]/.test(rawWord)) return rawWord;
		}

		// Satzzeichen am Rand isolieren (inkl. deutscher Umlaute und typischer Anführungszeichen)
		const match = rawWord.match(/^([^\p{L}\p{N}]*)([\s\S]*?)([^\p{L}\p{N}]*)$/u);
		if (!match) return rawWord;
		const [, prefix, core, suffix] = match;

		// Kurze Kerne (< 4 Buchstaben) nicht korrigieren (Schutz vor Falschersetzungen wie wir -> wird)
		if (core.length < 4) return rawWord;

		// Abkürzungen komplett in Großbuchstaben (z. B. GPU, CPU, API) nicht verändern
		if (core === core.toUpperCase() && core.length >= 2) return rawWord;

		const lower = core.toLowerCase();
		if (COMMON_WORDS.has(lower)) return rawWord;

		// Höchstens 1 Fehler: bei 2 erlaubten Fehlern kippen echte Wörter außerhalb der Liste
		// (teilen -> zeilen, Physiker -> Physik).
		const maxAllowed = 1;
		let bestMatch = null;
		let minDistance = Infinity;
		let tie = false;

		for (const dictWord of COMMON_WORDS) {
			if (Math.abs(dictWord.length - lower.length) > maxAllowed) continue;
			const dist = levenshtein(lower, dictWord);
			if (dist <= maxAllowed) {
				if (dist < minDistance) {
					minDistance = dist;
					bestMatch = dictWord;
					tie = false;
				} else if (dist === minDistance) {
					tie = true;
				}
			}
		}

		// Nur bei eindeutigem besten Treffer korrigieren (kein unklares Raten bei Gleichstand)
		if (bestMatch && !tie && minDistance <= maxAllowed) {
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

	// Formel statt Fließtext: ein "=" oder ein Mathezeichen, auf das noch etwas folgt (x^2, ∫2x).
	// Ein angehängtes Zeichen am Wortende ("Handbreit√") zählt nicht.
	const FORMULA_HINT = /=|[\^_{}<>~√∫∑πλαβ]\S/;

	// Dekodiert CTC-Logits mit genauer Konfidenz- und Statusberechnung.
	// options.mode: "text" sperrt Mathezeichen, "math" erlaubt sie; ohne Angabe entscheidet die
	// ungesperrte Lesung selbst, ob die Zeile eine Formel ist.
	function decodeWithConfidence(logits2D, vocab = HANDWRITING_VOCAB, options = {}) {
		if (!logits2D || !logits2D.length) {
			return { text: "", rawText: "", confidence: 0, status: "empty", isConfident: false, blankRatio: 1, charConfidences: [] };
		}
		if (!options.mode) {
			const asMath = decodeWithConfidence(logits2D, vocab, { ...options, mode: "math" });
			return FORMULA_HINT.test(asMath.rawText) ? asMath : decodeWithConfidence(logits2D, vocab, { ...options, mode: "text" });
		}
		const blank = vocab.BLANK_INDEX ?? 0;
		const threshold = Number(options.threshold ?? 0.80);
		const mode = options.mode;
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
		const text = cleanTranscription(rawText, { ...options, charConfidences });

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
	// charConfidences (optional, 1:1 zu den Zeichen von text): Ein Wort wird nur korrigiert,
	// wenn das Modell bei mindestens einem seiner Zeichen unsicher war. Sicher erkannte
	// Wörter außerhalb der Liste (z. B. "Treffer") bleiben so unangetastet.
	function cleanTranscription(text, options = {}) {
		const raw = String(text || "");
		const mode = options.mode || "text";
		const confs = options.charConfidences?.length === raw.length ? options.charConfidences : null;
		const words = [];
		const re = /\S+/g;
		let m;
		while ((m = re.exec(raw))) {
			let word = m[0];
			if (mode !== "math") {
				// Schutz gegen angehängte oder fehldekodierte Mathe-Zeichen ("Handbreit√")
				word = word.replace(/[\^_<>{}\~√∫∑πλαβ\\]/g, "");
				if (!word) continue;
			}
			const minConf = confs ? Math.min(...confs.slice(m.index, m.index + m[0].length)) : 0;
			words.push(minConf < CORRECT_BELOW_CONFIDENCE ? correctWord(word, mode) : word);
		}
		return words.join(" ");
	}

	return {
		decodeWithConfidence,
		cleanTranscription,
		correctWord,
		levenshtein,
	};
})();

