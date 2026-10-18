"use strict";

// Fehlertolerante Ergänzung zur Volltextsuche: findet Seiten trotz Tippfehlern,
// „ae“ statt „ä“, „f“ statt „ph“ und halb getippter Wörter. Läuft nur, wenn die
// exakte Suche zu wenig liefert (siehe STATE.searchNotes).

// Schreibweisen angleichen, die beim Tippen oft abweichen. Beide Seiten (Suchwort
// und Seitentext) laufen hier durch, deshalb darf die Faltung „unschön“ sein.
export function fold(s) {
	return String(s).toLowerCase()
		.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
		.normalize("NFD").replace(/[̀-ͯ]/g, "")
		.replace(/ph/g, "f").replace(/th/g, "t");
}

const SPLIT = /[^\p{L}\p{N}]+/u;

// Faltung je Wortform merken: dieselben Wörter stehen auf fast jeder Seite, und der
// erste Indexaufbau faltete sonst jedes Vorkommen einzeln.
const foldCache = new Map();
function foldWord(form) {
	let key = foldCache.get(form);
	if (key === undefined) {
		if (foldCache.size >= 200000) foldCache.clear();
		foldCache.set(form, key = fold(form));
	}
	return key;
}

// Wörter als Originalform (für die Markierung) → gefaltete Form (zum Vergleich), jede Form einmal.
function words(text) {
	const out = new Map();
	for (const form of String(text).toLowerCase().split(SPLIT)) {
		if (form.length >= 2 && !out.has(form)) out.set(form, foldWord(form));
	}
	return out;
}

// Drei wiederverwendete Zeilen: die Suche ruft das pro Tastendruck für den ganzen
// Wortschatz auf, neue Arrays je Aufruf kosteten dort den Großteil der Zeit.
let rows = [new Int32Array(64), new Int32Array(64), new Int32Array(64)];

// Editierdistanz mit Vertauschung (OSA) zwischen a und den ersten bLen Zeichen von b;
// bricht ab, sobald sie sicher über max liegt.
export function typoDistance(a, b, max, bLen = b.length) {
	if (Math.abs(a.length - bLen) > max) return max + 1;
	if (rows[0].length <= bLen) rows = rows.map(() => new Int32Array(bLen * 2));
	let [prev2, prev, cur] = rows;
	for (let j = 0; j <= bLen; j++) prev[j] = j;
	for (let i = 1; i <= a.length; i++) {
		const ai = a.charCodeAt(i - 1);
		cur[0] = i;
		let rowMin = i;
		for (let j = 1; j <= bLen; j++) {
			const bj = b.charCodeAt(j - 1);
			let v = prev[j - 1] + (ai === bj ? 0 : 1);
			if (prev[j] + 1 < v) v = prev[j] + 1;
			if (cur[j - 1] + 1 < v) v = cur[j - 1] + 1;
			if (i > 1 && j > 1 && ai === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === bj && prev2[j - 2] + 1 < v) v = prev2[j - 2] + 1;
			cur[j] = v;
			if (v < rowMin) rowMin = v;
		}
		if (rowMin > max) return max + 1;
		[prev2, prev, cur] = [prev, cur, prev2];
	}
	return prev[bLen];
}

// 3 = gleiches Wort, 2 = Wortanfang, 1 = Tippfehler, 0 = kein Treffer.
function quality(term, word) {
	if (word === term) return 3;
	if (word.startsWith(term)) return 2;
	const max = term.length >= 8 ? 2 : term.length >= 4 ? 1 : 0;
	if (!max) return 0;
	if (typoDistance(term, word, max) <= max) return 1;
	// Wort wird noch getippt: Tippfehler im Anfang („fotosint“ → „fotosintese“).
	if (term.length >= 5 && word.length > term.length && typoDistance(term, word, max, term.length) <= max) return 1;
	return 0;
}

export function createFuzzyIndex() {
	const vocab = new Map(); // gefaltetes Wort → { pages: Set<pageId>, forms: Set<string> }
	const pageKeys = new Map(); // pageId → Set gefalteter Wörter

	function setPage(id, text) {
		for (const key of pageKeys.get(id) || []) {
			const v = vocab.get(key);
			if (v && v.pages.delete(id) && !v.pages.size) vocab.delete(key);
		}
		const keys = new Set();
		for (const [form, key] of words(text)) {
			let v = vocab.get(key);
			if (!v) vocab.set(key, v = { pages: new Set(), forms: new Set() });
			v.pages.add(id);
			v.forms.add(form);
			keys.add(key);
		}
		pageKeys.set(id, keys);
	}

	// Jedes Suchwort muss auf der Seite vorkommen (UND). Liefert Seiten mit Punktzahl
	// und den getroffenen Originalformen zum Markieren.
	function search(query, allow) {
		const terms = [...new Set(words(query).values())].filter((t) => t.length >= 3);
		if (!terms.length) return [];
		let hits = null; // pageId → { score, forms }
		for (const term of terms) {
			const next = new Map();
			for (const [key, v] of vocab) {
				const q = quality(term, key);
				if (!q) continue;
				for (const id of v.pages) {
					if (hits ? !hits.has(id) : !allow(id)) continue;
					let h = next.get(id);
					if (!h) next.set(id, h = { q: 0, forms: [] });
					if (q > h.q) h.q = q;
					h.forms.push(...v.forms);
				}
			}
			for (const [id, h] of next) {
				const prev = hits && hits.get(id);
				h.score = (prev ? prev.score : 0) + h.q;
				if (prev) h.forms.push(...prev.forms);
			}
			hits = next;
			if (!hits.size) return [];
		}
		return [...hits].map(([id, h]) => ({ id, score: h.score, forms: [...new Set(h.forms)] }));
	}

	return { setPage, search };
}
