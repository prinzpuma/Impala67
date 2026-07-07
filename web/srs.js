"use strict";
// srs.js — FSRS-lite: vereinfachte Variante des FSRS-Algorithmus.
// Gespeichert werden stability / difficulty / due / reps / lapses — dieselben
// Felder wie bei ts-fsrs, d.h. ein späterer Umstieg auf die volle FSRS-Library
// braucht keine Datenmigration.
const SRS = (() => {
	// Lernschritte wie in Anki: neue Karten durchlaufen erst kurze Minuten-Schritte
	// (1 Min → 10 Min) und „graduieren“ dann zu Tages-Intervallen. Vergessene Karten
	// durchlaufen einen Wiederlern-Schritt, statt sofort wieder Tage zu warten.
	const LEARN_STEPS = [1, 10]; // Minuten
	const RELEARN_STEPS = [10]; // Minuten
	const GRADUATE_DAYS = 1; // Intervall nach dem letzten Lernschritt
	const EASY_DAYS = 4; // „Einfach“ während des Lernens graduiert sofort hiermit
	const MAX_IVL = 1825; // maximales Intervall in Tagen (5 Jahre)
	const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

	function newCard(t) {
		return { state: "new", stability: 0, difficulty: 5, due: t, reps: 0, lapses: 0, step: 0, last: null };
	}

	// grade: 1 = Nochmal, 2 = Schwer, 3 = Gut, 4 = Einfach.
	// reps zählt jede Bewertung (Tracker „wie oft gelernt“), lapses jedes Vergessen.
	// fuzz streut Tages-Intervalle leicht (wie Anki), damit nicht alle Karten am selben Tag fällig werden.
	function rate(srs, grade, now = new Date(), fuzz = true) {
		const s = { ...srs };
		s.reps = (s.reps || 0) + 1;
		s.step = s.step || 0;
		s.last = now.toISOString();
		s.difficulty = clamp((s.difficulty || 5) - (grade - 3) * 0.5, 1, 10);
		const dueMins = (m) => { s.due = new Date(now.getTime() + Math.max(1, Math.round(m)) * 60e3).toISOString(); };
		const dueDays = (d) => {
			d = Math.max(1, Math.round(d));
			if (fuzz && d > 2) d += Math.round((Math.random() - 0.5) * Math.min(6, d * 0.1) * 2);
			d = clamp(d, 1, MAX_IVL);
			s.stability = d; // Stabilität = aktuelles Intervall in Tagen
			s.due = new Date(now.getTime() + d * 864e5).toISOString();
		};

		if (s.state === "new") { s.state = "learning"; s.step = 0; }

		if (s.state === "learning" || s.state === "relearning") {
			const relearn = s.state === "relearning";
			const steps = relearn ? RELEARN_STEPS : LEARN_STEPS;
			if (grade === 1) { s.step = 0; dueMins(steps[0]); }
			else if (grade === 2) { dueMins(steps[Math.min(s.step, steps.length - 1)] * 1.5); }
			else if (grade === 3) {
				s.step += 1;
				if (s.step < steps.length) dueMins(steps[s.step]);
				else { s.state = "review"; s.step = 0; dueDays(relearn ? Math.max(1, s.stability) : GRADUATE_DAYS); }
			} else {
				s.state = "review";
				s.step = 0;
				dueDays(relearn ? Math.max(2, s.stability * 1.2) : EASY_DAYS);
			}
		} else if (grade === 1) {
			// Review vergessen: Fehler zählen, Intervall halbieren, kurz neu lernen
			s.lapses = (s.lapses || 0) + 1;
			s.state = "relearning";
			s.step = 0;
			s.stability = Math.max(1, s.stability * 0.5);
			dueMins(RELEARN_STEPS[0]);
		} else {
			// Review bestanden: Intervall wächst mit einem Faktor, den die Karten-
			// Schwierigkeit dämpft (schwere Karten wachsen langsamer — wie Ankis Ease).
			const ease = 2.6 - (s.difficulty - 1) * 0.12; // 1.52 … 2.6
			const factor = grade === 2 ? 1.2 : grade === 3 ? ease : ease * 1.35;
			dueDays(Math.max(s.stability + 1, s.stability * factor));
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