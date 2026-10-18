"use strict";

// web/handwriting-lexicon.js — Großes Wörterbuch (handwriting-lexicon-de.txt) für die Handschrift-Erkennung.
// Jedes Wort einer Zeile wird ein zweites Mal gelesen, diesmal nur entlang echter Wörter (CTC-Suche durch das
// Wörterbuch, deutsche Endungen erlaubt). Die Wörterbuch-Lesung ersetzt die freie Lesung, solange das Modell
// sie nicht viel unwahrscheinlicher findet ("Veranfworturng" → "Verantwortung").
// Speicher: der sortierte Dateitext plus Wortanfänge statt eines Objekt-Baums (der bräuchte über 200 MB).

// Vorsprung (log-Wahrscheinlichkeit) der Wörterbuch-Lesung. Okt. 2026 auf Heft-Mitschriften und fremden
// ScaDS-Schreibern am besten bei 12 (ScaDS: 669 Wörter verbessert, 51 verschlechtert; 16 schon schlechter).
// Bekannte Wörter, Abkürzungen und Zahlen bleiben unangetastet.
const LEXICON_BONUS = 12;
const BEAM_WIDTH = 16;
const MIN_LOG_PROB = Math.log(1e-4); // seltenere Zeichen pro Schritt gar nicht erst verfolgen
// Fehlende Beugungsformen ("pflegerische", "Angstgefühle"): an jedes Wort darf eine dieser Endungen
const ENDINGS = ["e", "en", "er", "es", "em", "n", "s"];
const PUNCTUATION = new Set([".", ",", ":", "!", "?", "-", "(", ")", "'"]);

function logAdd(a, b) {
	if (a === -Infinity) return b;
	if (b === -Infinity) return a;
	return Math.max(a, b) + Math.log1p(Math.exp(-Math.abs(a - b)));
}

// text: ein Wort je Zeile, klein geschrieben, sortiert (handwriting/build_lexicon.py)
export function createLexicon(text) {
	const starts = [0];
	for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
	if (starts[starts.length - 1] < text.length) starts.push(text.length + 1);
	const offsets = Uint32Array.from(starts);
	const size = offsets.length - 1;

	// Zeichen d von Wort i, -1 hinter dem Wortende (kürzere Wörter sortieren vor ihre Verlängerungen)
	const keyAt = (i, d) => (d < offsets[i + 1] - 1 - offsets[i] ? text.charCodeAt(offsets[i] + d) : -1);
	const lowerBound = (lo, hi, d, key) => {
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (keyAt(mid, d) < key) lo = mid + 1;
			else hi = mid;
		}
		return lo;
	};
	// Knoten = Bereich [lo, hi) aller Wörter mit gemeinsamem Anfang der Länge d
	const root = { lo: 0, hi: size, d: 0 };
	const child = (node, code) => {
		const lo = lowerBound(node.lo, node.hi, node.d, code);
		if (lo >= node.hi || keyAt(lo, node.d) !== code) return null;
		return { lo, hi: lowerBound(lo, node.hi, node.d, code + 1), d: node.d + 1 };
	};
	const isWord = (node) => keyAt(node.lo, node.d) === -1;

	function has(word) {
		let node = root;
		for (let i = 0; node && i < word.length; i++) node = child(node, word.charCodeAt(i));
		return !!node && isWord(node);
	}

	// Endungs-Knoten { ending } hängen hinter einem fertigen Wort
	const nextNode = (node, code) => {
		if (node.ending !== undefined) {
			const ending = node.ending + String.fromCharCode(code);
			return ENDINGS.some((e) => e.startsWith(ending)) ? { ending } : null;
		}
		const next = child(node, code);
		if (next || !isWord(node)) return next;
		const ending = String.fromCharCode(code);
		return ENDINGS.some((e) => e.startsWith(ending)) ? { ending } : null;
	};
	const isComplete = (node) => (node.ending !== undefined ? ENDINGS.includes(node.ending) : isWord(node));

	// CTC-Prefix-Beam-Search, die nur Wörterbuch-Wörter zulässt (Satzzeichen davor und danach erlaubt).
	// phase 0: Satzzeichen davor, 1: im Wort, 2: Satzzeichen danach. Großbuchstabe nur am Wortanfang.
	function searchWord(logProbs, vocab, blank) {
		const lowerCode = [];
		const kind = []; // "upper", "lower", "punct" oder undefined
		for (let c = 0; c < vocab.size; c++) {
			const ch = vocab.charForIndex(c);
			const lower = ch.toLowerCase();
			lowerCode[c] = lower.charCodeAt(0);
			kind[c] = PUNCTUATION.has(ch) ? "punct" : /^\p{L}$/u.test(ch) && ch.length === 1 ? (ch === lower ? "lower" : "upper") : undefined;
		}
		let beams = new Map([["", { text: "", last: -1, pb: 0, pnb: -Infinity, phase: 0, node: root, letters: 0 }]]);
		for (const lp of logProbs) {
			const next = new Map();
			const entry = (parent, c, phase, node) => {
				const text = c < 0 ? parent.text : parent.text + vocab.charForIndex(c);
				let b = next.get(text);
				if (!b) {
					b = c < 0 ? { ...parent, pb: -Infinity, pnb: -Infinity }
						: { text, last: c, pb: -Infinity, pnb: -Infinity, phase, node, letters: parent.letters + (phase === 1 ? 1 : 0) };
					next.set(text, b);
				}
				return b;
			};
			const cands = [];
			for (let c = 0; c < lp.length; c++) if (c !== blank && kind[c] && lp[c] >= MIN_LOG_PROB) cands.push(c);
			for (const b of beams.values()) {
				const total = logAdd(b.pb, b.pnb);
				const same = entry(b, -1);
				same.pb = logAdd(same.pb, total + lp[blank]);
				if (b.last >= 0) same.pnb = logAdd(same.pnb, b.pnb + lp[b.last]);
				for (const c of cands) {
					let phase = b.phase, node = b.node;
					if (kind[c] === "punct") {
						if (b.phase === 1) {
							if (!isComplete(b.node)) continue;
							phase = 2;
						}
					} else {
						if (b.phase === 2 || (b.phase === 1 && kind[c] === "upper")) continue;
						node = nextNode(b.phase === 0 ? root : b.node, lowerCode[c]);
						if (!node) continue;
						phase = 1;
					}
					const ext = entry(b, c, phase, node);
					ext.pnb = logAdd(ext.pnb, (c === b.last ? b.pb : total) + lp[c]);
				}
			}
			const score = (b) => logAdd(b.pb, b.pnb);
			beams = new Map([...next.entries()].sort((x, y) => score(y[1]) - score(x[1])).slice(0, BEAM_WIDTH));
		}
		let best = null, bestScore = -Infinity;
		for (const b of beams.values()) {
			if (b.phase === 0 || (b.phase === 1 && !isComplete(b.node))) continue;
			const s = logAdd(b.pb, b.pnb);
			if (s > bestScore) { bestScore = s; best = b; }
		}
		return best && { text: best.text, score: bestScore, letters: best.letters };
	}

	// Ersetzt die freie Lesung raw eines Wortabschnitts (probs: Softmax je Zeitschritt) durch die
	// wahrscheinlichste Wörterbuch-Lesung. Bekannte Wörter, Abkürzungen (GPU, "M.") und Zahlen bleiben.
	function correct(raw, probs, vocab) {
		const core = raw.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
		if (core.length < 2 || /\d/.test(raw) || core === core.toUpperCase() || has(core.toLowerCase())) return raw;
		const blank = vocab.BLANK_INDEX ?? 0;
		const logProbs = probs.map((p) => p.map(Math.log));
		const best = searchWord(logProbs, vocab, blank);
		if (!best || best.letters < 2) return raw;
		return best.score + LEXICON_BONUS >= ctcScore(logProbs, raw, vocab, blank) ? best.text : raw;
	}

	return { size, has, correct };
}

// log P(text | Zeitschritte) nach CTC (Summe über alle Ausrichtungen)
function ctcScore(logProbs, text, vocab, blank) {
	const labels = [];
	for (const ch of text) {
		const idx = vocab.CHAR_TO_IDX.get(ch);
		if (idx === undefined) return -Infinity;
		labels.push(idx);
	}
	const S = 2 * labels.length + 1;
	const ext = Array.from({ length: S }, (_, s) => (s % 2 ? labels[(s - 1) / 2] : blank));
	let alpha = new Float64Array(S).fill(-Infinity);
	alpha[0] = logProbs[0][blank];
	if (S > 1) alpha[1] = logProbs[0][ext[1]];
	for (let t = 1; t < logProbs.length; t++) {
		const next = new Float64Array(S).fill(-Infinity);
		for (let s = 0; s < S; s++) {
			let v = alpha[s];
			if (s > 0) v = logAdd(v, alpha[s - 1]);
			if (s > 1 && ext[s] !== blank && ext[s] !== ext[s - 2]) v = logAdd(v, alpha[s - 2]);
			next[s] = v + logProbs[t][ext[s]];
		}
		alpha = next;
	}
	return S > 1 ? logAdd(alpha[S - 1], alpha[S - 2]) : alpha[0];
}
