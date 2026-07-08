"use strict";
// srs.js — voller FSRS-Scheduler (FSRS-5-Formeln, Standardparameter) mit Anki-artigen
// Lernschritten für Minuten-Intervalle. Gespeichert werden weiterhin
// stability / difficulty / due / reps / lapses / state / step / last — dieselben
// Felder wie vorher (FSRS-lite) und wie ts-fsrs: keine Datenmigration nötig.
const SRS = (() => {
	// FSRS-5-Standardgewichte w0…w18 (wie ts-fsrs) — w0…w3 sind die Start-Stabilitäten
	// für Nochmal/Schwer/Gut/Einfach, der Rest steuert Schwierigkeit & Stabilitätswachstum.
	const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575,
		0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
	const DECAY = -0.5;
	const FACTOR = 19 / 81; // R(t=S) = 90 % — Stabilität = Intervall bei 90 % Behaltensquote
	const REQUEST_RETENTION = 0.9; // Ziel-Behaltensquote (Anki-Standard)
	const LEARN_STEPS = [1, 10]; // Minuten (wie Anki)
	const RELEARN_STEPS = [10];
	const MAX_IVL = 36500;
	const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

	const initStability = (g) => Math.max(0.1, W[g - 1]);
	const initDifficulty = (g) => clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, 1, 10);
	// Abrufwahrscheinlichkeit nach t Tagen bei Stabilität S2
	const retrievability = (t, S2) => Math.pow(1 + FACTOR * (Math.max(0, t) / Math.max(0.1, S2)), DECAY);
	// Intervall, bei dem R auf die Ziel-Behaltensquote gefallen ist
	const nextInterval = (S2) => clamp(Math.round((S2 / FACTOR) * (Math.pow(REQUEST_RETENTION, 1 / DECAY) - 1)), 1, MAX_IVL);

	function nextDifficulty(D, g) {
		const d = D - W[6] * (g - 3);
		return clamp(W[7] * initDifficulty(4) + (1 - W[7]) * d, 1, 10); // Mean-Reversion Richtung Standard
	}
	// Stabilität nach ERFOLGREICHER Wiederholung (grade 2-4)
	function recallStability(D, S2, R, g) {
		const hard = g === 2 ? W[15] : 1;
		const easy = g === 4 ? W[16] : 1;
		return S2 * (1 + Math.exp(W[8]) * (11 - D) * Math.pow(S2, -W[9]) * (Math.exp(W[10] * (1 - R)) - 1) * hard * easy);
	}
	// Stabilität nach VERGESSEN (grade 1) — nie größer als vorher
	function forgetStability(D, S2, R) {
		return Math.min(W[11] * Math.pow(D, -W[12]) * (Math.pow(S2 + 1, W[13]) - 1) * Math.exp(W[14] * (1 - R)), S2);
	}
	// Kurzzeit-Anpassung während der Lernschritte (FSRS-5 „short term")
	const shortTermStability = (S2, g) => Math.max(0.1, S2 * Math.exp(W[17] * (g - 3 + W[18])));

	function newCard(t) {
		return { state: "new", stability: 0, difficulty: 5, due: t, reps: 0, lapses: 0, step: 0, last: null };
	}

	// grade: 1 = Nochmal, 2 = Schwer, 3 = Gut, 4 = Einfach.
	// reps zählt jede Bewertung, lapses jedes Vergessen. fuzz streut Tages-Intervalle
	// leicht (wie Anki), damit nicht alle Karten am selben Tag fällig werden.
	function rate(srs, grade, now = new Date(), fuzz = true) {
		const s = { ...srs };
		const elapsedDays = s.last ? (now - new Date(s.last)) / 864e5 : 0;
		s.reps = (s.reps || 0) + 1;
		s.step = s.step || 0;
		s.last = now.toISOString();
		const dueMins = (m) => { s.due = new Date(now.getTime() + Math.max(1, Math.round(m)) * 60e3).toISOString(); };
		const dueDays = (d) => {
			d = Math.max(1, Math.round(d));
			if (fuzz && d > 2) d += Math.round((Math.random() - 0.5) * Math.min(6, d * 0.1) * 2);
			d = clamp(d, 1, MAX_IVL);
			s.due = new Date(now.getTime() + d * 864e5).toISOString();
		};

		if (s.state === "new") {
			s.state = "learning";
			s.step = 0;
			s.stability = initStability(grade);
			s.difficulty = initDifficulty(grade);
		} else {
			s.difficulty = nextDifficulty(s.difficulty || 5, grade);
		}

		if (s.state === "learning" || s.state === "relearning") {
			const relearn = s.state === "relearning";
			const steps = relearn ? RELEARN_STEPS : LEARN_STEPS;
			// Innerhalb der Lernschritte: Kurzzeit-Stabilität statt Tages-Formel
			if (srs.state !== "new") s.stability = shortTermStability(s.stability || initStability(grade), grade);
			if (grade === 1) { s.step = 0; dueMins(steps[0]); }
			else if (grade === 2) { dueMins(steps[Math.min(s.step, steps.length - 1)] * 1.5); }
			else if (grade === 3) {
				s.step += 1;
				if (s.step < steps.length) dueMins(steps[s.step]);
				else { s.state = "review"; s.step = 0; dueDays(nextInterval(s.stability)); }
			} else {
				s.state = "review";
				s.step = 0;
				s.stability = Math.max(s.stability, initStability(4));
				dueDays(nextInterval(s.stability));
			}
		} else if (grade === 1) {
			// Review vergessen: FSRS-Vergessens-Stabilität, dann kurz neu lernen
			const R = retrievability(elapsedDays, s.stability);
			s.lapses = (s.lapses || 0) + 1;
			s.state = "relearning";
			s.step = 0;
			s.stability = Math.max(0.1, forgetStability(s.difficulty, Math.max(0.1, s.stability), R));
			dueMins(RELEARN_STEPS[0]);
		} else {
			// Review bestanden: echtes FSRS-Stabilitätswachstum (statt Ease-Faktor-Näherung)
			const S0 = Math.max(0.1, s.stability || initStability(grade));
			const R = retrievability(elapsedDays, S0);
			s.stability = recallStability(s.difficulty, S0, R, grade);
			dueDays(nextInterval(s.stability));
		}
		return s;
	}

	// Intervall-Vorschau für die vier Antwort-Knöpfe (wie in Anki: "10 Min", "3 Tage", "2 Mon.")
	function fmtIvl(ms) {
		const min = ms / 60e3;
		if (min < 60) return Math.max(1, Math.round(min)) + " Min";
		const days = min / 1440;
		if (days < 1.5) return "1 Tag";
		if (days < 31) return Math.round(days) + " Tage";
		if (days < 365) return Math.round(days / 30) + " Mon.";
		return (Math.round(days / 36.5) / 10) + " Jahre";
	}

	// Simuliert rate() für alle vier Bewertungen, ohne die Karte zu verändern.
	function preview(srs, now = new Date()) {
		const out = {};
		for (let g = 1; g <= 4; g++) {
			out[g] = fmtIvl(new Date(rate(srs, g, now, false).due) - now); // ohne Fuzz → stabile Vorschau
		}
		return out;
	}

	return { newCard, rate, preview };
})();