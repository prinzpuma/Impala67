"use strict";

// web/handwriting-vocab.js — Vokabular und Indizes für CTC Handschrifterkennung.
// Index 0 ist das CTC-Blank-Token.
// Stimmt 1:1 mit handwriting/vocabulary.json überein.

export const HANDWRITING_VOCAB = (() => {
	const CHARACTERS = [
		"", // 0: <blank>
		"a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m",
		"n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
		"A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
		"N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
		"ä", "ö", "ü", "Ä", "Ö", "Ü", "ß",
		"0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
		" ",
		".", ",", "!", "?", "-", "+", ":", "/", "*", "=", "(", ")",
		"@", "#", "%", "'",
		"^", "_", "<", ">", "{", "}", "~", "√", "∫", "∑", "π", "λ", "α", "β"
	];

	const CHAR_TO_IDX = new Map(CHARACTERS.map((char, index) => [char, index]));

	return {
		BLANK_INDEX: 0,
		CHARACTERS,
		CHAR_TO_IDX,
		size: CHARACTERS.length,
		charForIndex: (idx) => CHARACTERS[idx] || "",
		indexForChar: (char) => CHAR_TO_IDX.get(char) ?? 0,
	};
})();
