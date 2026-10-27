"use strict";

// Karteikarten-Planung (FSRS-5, Anki-Lernschritte und -Fuzz) im Rust-Kern (core/impala-srs).
// Der Lernstand `card.srs` hat dieselbe Form wie bisher.
import { CORE } from "./rust-core.js";

export const SRS = {
	newCard: (t) => CORE.srsNewCard(String(t || "")),
	// grade: 1 = Nochmal, 2 = Schwer, 3 = Gut, 4 = Einfach. fuzz streut Tages-Intervalle leicht.
	rate: (srs, grade, now = new Date(), fuzz = true) => CORE.srsRate(srs, Number(grade), now.getTime(), fuzz ? Math.random() : undefined),
	// Intervall-Vorschau der vier Antwort-Knöpfe ("10 Min", "3 Tage", "2 Mon."), ohne Fuzz.
	preview(srs, now = new Date()) {
		const [a, b, c, d] = CORE.srsPreview(srs, now.getTime());
		return { 1: a, 2: b, 3: c, 4: d };
	},
	// Abrufwahrscheinlichkeit jetzt; ohne `last` (Altkarten) aus der Fälligkeit zurückgerechnet.
	retrievability: (srs, now = new Date()) => (srs ? CORE.srsRetrievability(srs, now.getTime()) : undefined),
};
