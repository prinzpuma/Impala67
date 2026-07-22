"use strict";
export const SRS = (() => {
	// FSRS-5-Standardgewichte w0…w18 (wie ts-fsrs) — w0…w3 sind die Start-Stabilitäten
	// für Nochmal/Schwer/Gut/Einfach, der Rest steuert Schwierigkeit & Stabilitätswachstum.
	// KEIN Bug („kommt noch“, 22. Juli): „Einfach“ auf einer NEUEN Karte ⇒ ~16 Tage.
	// Das ist korrektes FSRS-5-Verhalten: Start-Stabilität w3 ≈ 15.69 Tage, und wegen
	// I(0.9, S) = S ist das erste Intervall genau die Stabilität ⇒ round(15.69) = 16.
	// Anki mit aktiviertem FSRS zeigt für Easy auf einer neuen Karte denselben Wert.
	// „Einfach“ ist für triviale Karten gedacht — im Zweifel „Gut“ drücken (graduiert
	// über die Lernschritte, erstes Review-Intervall dann w2 ≈ 3 Tage).
	const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575,
		0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
	const DECAY = -0.5;
	const FACTOR = 19 / 81; // R(t=S) = 90 % — Stabilität = Intervall bei 90 % Behaltensquote
	const REQUEST_RETENTION = 0.9; // Ziel-Behaltensquote (Anki-Standard)
	const LEARN_STEPS = [1, 10]; // Minuten (wie Anki)
	const RELEARN_STEPS = [10];
	const MAX_IVL = 36500;
	const MIN_STABILITY = 0.1;
	const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

	const initStability = (g) => Math.max(MIN_STABILITY, W[g - 1]);
	const initDifficulty = (g) => clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, 1, 10);
	// Abrufwahrscheinlichkeit nach t Tagen bei Stabilität S (FSRS-4.5/5 power curve)
	const retrievability = (t, S) => {
		const safeS = Math.max(MIN_STABILITY, S || MIN_STABILITY);
		const safeT = Math.max(0, t || 0);
		return Math.pow(1 + FACTOR * (safeT / safeS), DECAY);
	};
	// Intervall, bei dem R auf die Ziel-Behaltensquote gefallen ist (I(0.9,S)=S)
	const nextInterval = (S) => {
		const safeS = Math.max(MIN_STABILITY, S || MIN_STABILITY);
		const raw = (safeS / FACTOR) * (Math.pow(REQUEST_RETENTION, 1 / DECAY) - 1);
		// NaN/negativ → 1 Tag; nie 0 (Anki-kompatibel, FSRS-Intervall mind. 1 Tag im Review)
		if (!Number.isFinite(raw) || raw <= 0) return 1;
		return clamp(Math.round(raw), 1, MAX_IVL);
	};

	// FSRS-5 Difficulty-Update:
	//   ΔD(G) = -w6·(G-3)
	//   D'    = D + ΔD·(10-D)/9   ← Linear Damping (fehlte zuvor!)
	//   D''   = w7·D0(4) + (1-w7)·D'  ← Mean-Reversion Richtung Easy-Default
	function nextDifficulty(D, g) {
		const d0 = clamp(Number(D) || 5, 1, 10);
		const grade = clamp(Number(g) || 3, 1, 4);
		const delta = -W[6] * (grade - 3);
		const damped = d0 + delta * (10 - d0) / 9;
		return clamp(W[7] * initDifficulty(4) + (1 - W[7]) * damped, 1, 10);
	}
	// Stabilität nach ERFOLGREICHER Wiederholung (grade 2-4)
	function recallStability(D, S, R, g) {
		const safeS = Math.max(MIN_STABILITY, S || MIN_STABILITY);
		const safeD = clamp(Number(D) || 5, 1, 10);
		const safeR = clamp(Number(R) || 0, 0, 1);
		const hard = g === 2 ? W[15] : 1;
		const easy = g === 4 ? W[16] : 1;
		const next = safeS * (1 + Math.exp(W[8]) * (11 - safeD) * Math.pow(safeS, -W[9]) *
			(Math.exp(W[10] * (1 - safeR)) - 1) * hard * easy);
		// Erfolgreiche Reviews dürfen S nicht verringern (FSRS-Invariante SInc ≥ 1)
		return Math.max(safeS, Number.isFinite(next) ? next : safeS);
	}
	// Stabilität nach VERGESSEN (grade 1) — nie größer als vorher
	function forgetStability(D, S, R) {
		const safeS = Math.max(MIN_STABILITY, S || MIN_STABILITY);
		const safeD = clamp(Math.max(1, Number(D) || 5), 1, 10);
		const safeR = clamp(Number(R) || 0, 0, 1);
		const next = W[11] * Math.pow(safeD, -W[12]) * (Math.pow(safeS + 1, W[13]) - 1) *
			Math.exp(W[14] * (1 - safeR));
		const bounded = Math.min(Number.isFinite(next) ? next : MIN_STABILITY, safeS);
		return Math.max(MIN_STABILITY, bounded);
	}
	// Kurzzeit-Anpassung während der Lernschritte (FSRS-5 „short term")
	const shortTermStability = (S, g) => {
		const safeS = Math.max(MIN_STABILITY, S || MIN_STABILITY);
		const grade = clamp(Number(g) || 3, 1, 4);
		const next = safeS * Math.exp(W[17] * (grade - 3 + W[18]));
		return Math.max(MIN_STABILITY, Number.isFinite(next) ? next : safeS);
	};

	// Reine due-Helfer für rate(): liefern nur das neue ISO-Datum zurück, statt wie
	// vorher als Closures bei jedem rate()-Aufruf neu erzeugt zu werden und `s.due`
	// selbst zu mutieren. Verhalten (inkl. Fuzzing) ist unverändert.
	// Keine Rundung auf ganze Minuten mehr: Anki speichert Lernschritt-Fälligkeiten
	// sekundengenau (z.B. Hard-Durchschnitt 5.5 Min = 5:30, nicht aufgerundet auf 6 Min).
	const dueAfterMinutes = (now, m) => {
		const mins = Math.max(0.0167, Number(m) || 1);
		return new Date(now.getTime() + mins * 60e3).toISOString();
	};
	const dueAfterDays = (now, d, fuzz) => {
		let days = Math.max(1, Math.round(Number(d) || 1));
		if (fuzz && days > 2) days += Math.round((Math.random() - 0.5) * Math.min(6, days * 0.1) * 2);
		days = clamp(days, 1, MAX_IVL);
		return new Date(now.getTime() + days * 864e5).toISOString();
	};

	function newCard(t) {
		return { state: "new", stability: 0, difficulty: 5, due: t, reps: 0, lapses: 0, step: 0, last: null };
	}

	// grade: 1 = Nochmal, 2 = Schwer, 3 = Gut, 4 = Einfach.
	// reps zählt jede Bewertung, lapses jedes Vergessen. fuzz streut Tages-Intervalle
	// leicht (wie Anki), damit nicht alle Karten am selben Tag fällig werden.
	function rate(srs, grade, now = new Date(), fuzz = true) {
		const s = { ...srs };
		const g = clamp(Math.round(Number(grade) || 0), 1, 4);
		const elapsedDays = s.last ? (now - new Date(s.last)) / 864e5 : 0;
		s.reps = (s.reps || 0) + 1;
		s.step = s.step || 0;
		s.last = now.toISOString();

		if (s.state === "new") {
			s.state = "learning";
			s.step = 0;
			s.stability = initStability(g);
			s.difficulty = initDifficulty(g);
		} else {
			s.difficulty = nextDifficulty(s.difficulty || 5, g);
		}

		if (s.state === "learning" || s.state === "relearning") {
			const relearn = s.state === "relearning";
			const steps = relearn ? RELEARN_STEPS : LEARN_STEPS;
			// Innerhalb der Lernschritte: Kurzzeit-Stabilität statt Tages-Formel
			if (srs.state !== "new") s.stability = shortTermStability(s.stability || initStability(g), g);
			// Anki Learning-Steps (docs.ankiweb.net/deck-options.html):
			// Again → Schritt 0, Delay steps[0]
			// Hard  → 1. Schritt & ≥2 Steps: Mittelwert steps[0]+steps[1] (1m+10m→~6m);
			//         späteren Step wiederholen; nur 1 Step: 1.5×
			// Good  → nächster Step (New+Good: step 0→1, Delay 10m)
			// Easy  → sofort graduieren
			if (g === 1) {
				s.step = 0;
				s.due = dueAfterMinutes(now, steps[0]);
			} else if (g === 2) {
				const i = Math.min(s.step || 0, steps.length - 1);
				let mins;
				if (steps.length === 1) mins = steps[0] * 1.5;
				else if (i === 0) mins = (steps[0] + steps[1]) / 2;
				else mins = steps[i];
				s.due = dueAfterMinutes(now, mins);
			} else if (g === 3) {
				s.step = (s.step || 0) + 1;
				if (s.step < steps.length) s.due = dueAfterMinutes(now, steps[s.step]);
				else { s.state = "review"; s.step = 0; s.due = dueAfterDays(now, nextInterval(s.stability), fuzz); }
			} else {
				s.state = "review";
				s.step = 0;
				s.stability = Math.max(s.stability, initStability(4));
				s.due = dueAfterDays(now, nextInterval(s.stability), fuzz);
			}
		} else if (g === 1) {
			// Review vergessen: FSRS-Vergessens-Stabilität, dann kurz neu lernen
			const R = retrievability(elapsedDays, s.stability);
			s.lapses = (s.lapses || 0) + 1;
			s.state = "relearning";
			s.step = 0;
			s.stability = forgetStability(s.difficulty, s.stability, R);
			s.due = dueAfterMinutes(now, RELEARN_STEPS[0]);
		} else {
			// Review bestanden: echtes FSRS-Stabilitätswachstum (statt Ease-Faktor-Näherung)
			const S0 = Math.max(MIN_STABILITY, s.stability || initStability(g));
			const R = retrievability(elapsedDays, S0);
			s.stability = recallStability(s.difficulty, S0, R, g);
			s.due = dueAfterDays(now, nextInterval(s.stability), fuzz);
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

	// Reine Formeln für Unit-Tests / Debugging (FSRS-5-Referenz)
	const formulas = {
		W, DECAY, FACTOR, REQUEST_RETENTION, MAX_IVL, MIN_STABILITY,
		initStability, initDifficulty, retrievability, nextInterval,
		nextDifficulty, recallStability, forgetStability, shortTermStability,
	};

	return { newCard, rate, preview, formulas };
})();