import test from "node:test";
import assert from "node:assert/strict";

if (typeof window === "undefined") {
	globalThis.window = globalThis;
	globalThis.location = { href: "http://localhost/" };
}

import { EventBus } from "../web/event-bus.js";
import { FACH, KNOWN_SUBJECTS, resolveSubject } from "../web/fach.js";
import { SRS } from "../web/srs.js";
const { cmpSemver } = await import("../web/updater.js");

// ==========================================
// 1. EVENT BUS TESTS
// ==========================================
test("EventBus: on, emit, off und once arbeiten zuverlässig", () => {
	const bus = new EventBus();
	const received = [];

	const unsub = bus.on("page:change", (payload) => received.push(payload));
	bus.emit("page:change", { id: "p1" });
	assert.equal(received.length, 1);
	assert.equal(received[0].id, "p1");

	// Unsubscribe stoppt Empfang
	unsub();
	bus.emit("page:change", { id: "p2" });
	assert.equal(received.length, 1);

	// once feuert genau einmal
	let onceCount = 0;
	bus.once("init", () => onceCount++);
	bus.emit("init");
	bus.emit("init");
	assert.equal(onceCount, 1);
});

// ==========================================
// 2. FACH / SUBJECT CLASSIFICATION
// ==========================================
test("Fach: 17 standardisierte Fächer & Alias-Auflösung", () => {
	assert.equal(KNOWN_SUBJECTS.length, 17);
	assert.ok(Object.isFrozen(KNOWN_SUBJECTS));

	// Alias-Erkennung
	assert.equal(FACH.clean("Mathe"), "Mathematik");
	assert.equal(FACH.clean("Analysis"), "Mathematik");
	assert.equal(FACH.clean("Physics"), "Physik");
	assert.equal(FACH.clean("Mechanik"), "Physik");
	assert.equal(FACH.clean("Vocab"), "Englisch");
	assert.equal(FACH.clean("Literatur"), "Deutsch");

	// Unbekannte Begriffe geben bei resolveSubject null zurück, FACH.clean fällt auf Allgemein zurück
	assert.equal(resolveSubject("UnbekanntesThema123"), null);
	assert.equal(FACH.clean("UnbekanntesThema123"), "Allgemein");
});

// ==========================================
// 3. SRS (SPACED REPETITION) FSRS-5 LOGIK
// ==========================================
test("SRS: Karten-Initialisierung und Intervall-Progression", () => {
	const now = new Date("2026-09-01T12:00:00Z");
	const card = SRS.newCard(now.toISOString());
	assert.equal(card.state, "new");
	assert.equal(card.reps, 0);
	assert.equal(card.lapses, 0);

	// Erste Bewertung mit "Gut" (grade 3) versetzt Karte in "learning"
	const rated1 = SRS.rate(card, 3, now);
	assert.equal(rated1.state, "learning");
	assert.equal(rated1.reps, 1);
	assert.ok(new Date(rated1.due) >= now);

	// Sofortiges Graduieren mit "Einfach" (grade 4)
	const reviewCard = SRS.rate(card, 4, now);
	assert.equal(reviewCard.state, "review");

	// Vergessen einer gelernten Karte (grade 1 im Review-Zustand) erzeugt einen Lapse
	const lapsed = SRS.rate(reviewCard, 1, now);
	assert.equal(lapsed.lapses, 1);
	assert.equal(lapsed.state, "relearning");
});

// ==========================================
// 4. VERSIONIERUNG & SEMVER
// ==========================================
test("Updater: Semantischer Versionsvergleich", () => {
	assert.ok(cmpSemver("0.3.0", "0.3.1") < 0);
	assert.ok(cmpSemver("0.3.1", "0.3.0") > 0);
	assert.equal(cmpSemver("0.3.0", "0.3.0"), 0);
	assert.ok(cmpSemver("v1.0.0", "0.9.9") > 0);
	assert.ok(cmpSemver("0.3.0-beta.1", "0.3.0") < 0);
	assert.ok(cmpSemver("1.0.0", "1.0.0-rc.1") > 0);
});
