import test from "node:test";
import assert from "node:assert/strict";

if (typeof window === "undefined") {
	globalThis.window = globalThis;
	globalThis.location = { href: "http://localhost/" };
}

import { EventBus } from "../web/event-bus.js";
import { FACH, KNOWN_SUBJECTS, resolveSubject } from "../web/fach.js";
import { S, STATE } from "../web/state.js";
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
test("Fach: standardisierte Fächer & Alias-Auflösung", () => {
	assert.equal(KNOWN_SUBJECTS.length, 20);
	assert.ok(Object.isFrozen(KNOWN_SUBJECTS));

	// Alias-Erkennung
	assert.equal(FACH.clean("Mathe"), "Mathematik");
	assert.equal(FACH.clean("Analysis"), "Mathematik");
	assert.equal(FACH.clean("Physics"), "Physik");
	assert.equal(FACH.clean("Mechanik"), "Physik");
	assert.equal(FACH.clean("Vocab"), "Englisch");
	assert.equal(FACH.clean("Literatur"), "Deutsch");

	// Unbekannte Begriffe geben bei resolveSubject null zurück, FACH.clean fällt auf Sonstiges zurück
	assert.equal(resolveSubject("UnbekanntesThema123"), null);
	assert.equal(FACH.clean("UnbekanntesThema123"), "Sonstiges");
	assert.equal(FACH.clean("Allgemein"), "Sonstiges");

	// Uni-Fächer und mehrdeutige Begriffe
	assert.equal(resolveSubject("Kontinuumsmechanik"), "Maschinenbau");
	assert.equal(resolveSubject("Einführung in die Elektrotechnik"), "Elektrotechnik");
	assert.equal(resolveSubject("Festkörperphysik"), "Physik");
	assert.equal(resolveSubject("Funktionen"), null);
	assert.equal(resolveSubject("Messwerte und Werte"), null);
});

test("Fach: Ordner vor Titel, Übersicht und festgelegtes Fach", () => {
	// Seiten entstehen wie in der App über Events (der Zustand liegt im Rust-Kern).
	let n = 0;
	const ev = (type, payload) => ({ id: "fach-" + (++n), t: "2026-10-01T10:00:" + String(n).padStart(2, "0") + ".000Z", type, payload });
	const add = (id, title, parentId = null, extra = {}) => {
		STATE.applyRemoteEvents([ev("pageCreate", { id, title, parentId, content: "" })]);
		if (Object.keys(extra).length) STATE.applyRemoteEvents([ev("pageUpdate", { id, patch: extra })]);
	};
	add("f-sem", "📚 Semester 1");
	add("f-inf", "Informatik 1", "f-sem");
	add("f-fun", "Funktionen (VL 1-9)", "f-inf");
	add("f-kombi", "Kombiniertes Lernen: Mathe × Experimentalphysik");
	add("f-man", "Kontinuumsmechanik", null, { subject: "Physik" });
	add("f-kid", "Blatt 3", "f-man");
	try {
		assert.equal(FACH.page(S.pages["f-fun"]).name, "Informatik");
		assert.equal(FACH.page(S.pages["f-sem"]).name, "Übersicht");
		assert.equal(FACH.page(S.pages["f-kombi"]).name, "Übersicht");
		assert.deepEqual(FACH.page(S.pages["f-kid"]), { name: "Physik", source: "inherited" });
	} finally {
		for (const id of ["f-sem", "f-inf", "f-fun", "f-kombi", "f-man", "f-kid"]) STATE.applyRemoteEvents([ev("pageDelete", { id })]);
	}
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
