import test from "node:test";
import assert from "node:assert/strict";

import { FACH, KNOWN_SUBJECTS, SUBJECTS, DEFAULT_SUBJECT, resolveSubject } from "../web/fach.js";
import { S } from "../web/state.js";
import { EMBEDDINGS } from "../web/embedding.js";

test("KNOWN_SUBJECTS enthält exakt die 17 offiziellen Schulfächer", () => {
	assert.equal(KNOWN_SUBJECTS.length, 17);
	assert.ok(Object.isFrozen(KNOWN_SUBJECTS));
	assert.deepEqual(KNOWN_SUBJECTS, [
		"Mathematik",
		"Deutsch",
		"Englisch",
		"Physik",
		"Chemie",
		"Biologie",
		"Geschichte",
		"Geografie",
		"Informatik",
		"Wirtschaft",
		"Kunst",
		"Musik",
		"Religion / Ethik",
		"Französisch",
		"Spanisch",
		"Latein",
		"Sport",
	]);
	assert.equal(SUBJECTS, KNOWN_SUBJECTS);
	assert.equal(FACH.KNOWN_SUBJECTS, KNOWN_SUBJECTS);
	assert.equal(FACH.DEFAULT_SUBJECT, "Allgemein");
	assert.equal(DEFAULT_SUBJECT, "Allgemein");
});

test("FACH.clean und resolveSubject ordnen Aliase und Begriffe den echten Schulfächern zu", () => {
	// Mathematik
	assert.equal(FACH.clean("Mathe"), "Mathematik");
	assert.equal(FACH.clean("math"), "Mathematik");
	assert.equal(FACH.clean("Analysis"), "Mathematik");
	assert.equal(FACH.clean("Stochastik"), "Mathematik");
	assert.equal(FACH.clean("Vektoren"), "Mathematik");

	// Deutsch
	assert.equal(FACH.clean("Deutsch"), "Deutsch");
	assert.equal(FACH.clean("German"), "Deutsch");
	assert.equal(FACH.clean("Literatur"), "Deutsch");
	assert.equal(FACH.clean("Gedicht"), "Deutsch");
	assert.equal(FACH.clean("Erörterung"), "Deutsch");

	// Englisch
	assert.equal(FACH.clean("English"), "Englisch");
	assert.equal(FACH.clean("Vocab"), "Englisch");
	assert.equal(FACH.clean("Vocabulary"), "Englisch");
	assert.equal(FACH.clean("Grammar"), "Englisch");

	// Physik
	assert.equal(FACH.clean("Physics"), "Physik");
	assert.equal(FACH.clean("Mechanik"), "Physik");
	assert.equal(FACH.clean("Optik"), "Physik");
	assert.equal(FACH.clean("Elektrizitätslehre"), "Physik");
	assert.equal(FACH.clean("Thermodynamik"), "Physik");
	assert.equal(FACH.clean("Astrophysik"), "Physik");

	// Chemie
	assert.equal(FACH.clean("Chemistry"), "Chemie");
	assert.equal(FACH.clean("Anorganik"), "Chemie");
	assert.equal(FACH.clean("Organik"), "Chemie");
	assert.equal(FACH.clean("Periodensystem"), "Chemie");

	// Biologie
	assert.equal(FACH.clean("Bio"), "Biologie");
	assert.equal(FACH.clean("Biology"), "Biologie");
	assert.equal(FACH.clean("Genetik"), "Biologie");
	assert.equal(FACH.clean("Ökologie"), "Biologie");
	assert.equal(FACH.clean("Zellbiologie"), "Biologie");
	assert.equal(FACH.clean("Evolution"), "Biologie");
	assert.equal(FACH.clean("Neurobiologie"), "Biologie");

	// Geschichte
	assert.equal(FACH.clean("History"), "Geschichte");
	assert.equal(FACH.clean("Weimarer Republik"), "Geschichte");
	assert.equal(FACH.clean("Mittelalter"), "Geschichte");
	assert.equal(FACH.clean("Antike"), "Geschichte");
	assert.equal(FACH.clean("Weltkriege"), "Geschichte");
	assert.equal(FACH.clean("DDR"), "Geschichte");

	// Geografie
	assert.equal(FACH.clean("Geographie"), "Geografie");
	assert.equal(FACH.clean("Erdkunde"), "Geografie");
	assert.equal(FACH.clean("Geography"), "Geografie");
	assert.equal(FACH.clean("Klimazonen"), "Geografie");
	assert.equal(FACH.clean("Plattentektonik"), "Geografie");

	// Informatik
	assert.equal(FACH.clean("Computer Science"), "Informatik");
	assert.equal(FACH.clean("Info"), "Informatik");
	assert.equal(FACH.clean("Programmierung"), "Informatik");
	assert.equal(FACH.clean("Python"), "Informatik");
	assert.equal(FACH.clean("Java"), "Informatik");
	assert.equal(FACH.clean("Algorithmen"), "Informatik");
	assert.equal(FACH.clean("Datenbanken"), "Informatik");

	// Wirtschaft
	assert.equal(FACH.clean("Wirtschaft & Recht"), "Wirtschaft");
	assert.equal(FACH.clean("Wirtschaft und Recht"), "Wirtschaft");
	assert.equal(FACH.clean("Wiwat"), "Wirtschaft");
	assert.equal(FACH.clean("BWL"), "Wirtschaft");
	assert.equal(FACH.clean("VWL"), "Wirtschaft");
	assert.equal(FACH.clean("Ökonomie"), "Wirtschaft");
	assert.equal(FACH.clean("Finanzen"), "Wirtschaft");

	// Kunst
	assert.equal(FACH.clean("Art"), "Kunst");
	assert.equal(FACH.clean("Zeichnen"), "Kunst");
	assert.equal(FACH.clean("Malerei"), "Kunst");
	assert.equal(FACH.clean("Kunstgeschichte"), "Kunst");

	// Musik
	assert.equal(FACH.clean("Music"), "Musik");
	assert.equal(FACH.clean("Musiktheorie"), "Musik");
	assert.equal(FACH.clean("Notenlehre"), "Musik");
	assert.equal(FACH.clean("Harmonielehre"), "Musik");
	assert.equal(FACH.clean("Instrumente"), "Musik");

	// Religion / Ethik
	assert.equal(FACH.clean("Religion"), "Religion / Ethik");
	assert.equal(FACH.clean("Ethik"), "Religion / Ethik");
	assert.equal(FACH.clean("Philosophie"), "Religion / Ethik");
	assert.equal(FACH.clean("Philo"), "Religion / Ethik");

	// Französisch
	assert.equal(FACH.clean("Français"), "Französisch");
	assert.equal(FACH.clean("French"), "Französisch");
	assert.equal(FACH.clean("Vocabulaire"), "Französisch");

	// Spanisch
	assert.equal(FACH.clean("Español"), "Spanisch");
	assert.equal(FACH.clean("Spanish"), "Spanisch");
	assert.equal(FACH.clean("Vocabulario"), "Spanisch");

	// Latein
	assert.equal(FACH.clean("Lingua Latina"), "Latein");
	assert.equal(FACH.clean("Latin"), "Latein");
	assert.equal(FACH.clean("Grammatica"), "Latein");

	// Sport
	assert.equal(FACH.clean("Sport"), "Sport");
	assert.equal(FACH.clean("Sporttheorie"), "Sport");
	assert.equal(FACH.clean("Trainingslehre"), "Sport");
});

test("FACH.clean fällt bei unbekannten oder generischen Begriffen auf 'Allgemein' zurück", () => {
	assert.equal(FACH.clean("Inbox"), "Allgemein");
	assert.equal(FACH.clean("Notizen"), "Allgemein");
	assert.equal(FACH.clean("Einkaufsliste"), "Allgemein");
	assert.equal(FACH.clean("Projekt X"), "Allgemein");
	assert.equal(FACH.clean("Zufall 123"), "Allgemein");
	assert.equal(FACH.clean("Karteikarten"), "Allgemein");
	assert.equal(FACH.clean(""), "Allgemein");
	assert.equal(FACH.clean(null), "Allgemein");
	assert.equal(FACH.clean(undefined), "Allgemein");
});

test("FACH.deck erkennt echte Schulfächer in Deck-Pfaden und fällt sonst auf 'Allgemein' zurück", () => {
	assert.deepEqual(FACH.deck("Mathematik::Analysis::Differentialrechnung"), { name: "Mathematik", source: "deck-root" });
	assert.deepEqual(FACH.deck("Spanisch::Vokabeln"), { name: "Spanisch", source: "deck-root" });
	assert.deepEqual(FACH.deck("Bio::Genetik"), { name: "Biologie", source: "deck-root" });
	assert.deepEqual(FACH.deck("Wirtschaft & Recht::Klausur"), { name: "Wirtschaft", source: "deck-root" });
	assert.deepEqual(FACH.deck("Latein::Deklination"), { name: "Latein", source: "deck-root" });
	assert.deepEqual(FACH.deck("Inbox::Latein"), { name: "Latein", source: "deck-root" });

	// Beliebige Decknamen dürfen nicht mehr als Fach ausgegeben werden
	assert.deepEqual(FACH.deck("Inbox::Kapitel 1"), { name: "Allgemein", source: "fallback" });
	assert.deepEqual(FACH.deck("Inbox"), { name: "Allgemein", source: "fallback" });
	assert.deepEqual(FACH.deck("Standard"), { name: "Allgemein", source: "fallback" });
	assert.deepEqual(FACH.deck("Test-Deck"), { name: "Allgemein", source: "fallback" });
	assert.deepEqual(FACH.deck(""), { name: "Allgemein", source: "fallback" });
});

test("FACH.page wertet Schulfach über Prioritätenkette (Subject > Tag > Titel > Ordner > Content) aus", () => {
	FACH.clearCache();
	S.pages = {};
	S.workspaces = {};

	// 1. Explizites subject
	assert.deepEqual(FACH.page({ subject: "Mathe" }), { name: "Mathematik", source: "manual" });
	// Ungültiges subject fällt weiter durch
	assert.deepEqual(FACH.page({ subject: "MeinOrdner" }), { name: "Allgemein", source: "fallback" });

	// 2. Tags
	assert.deepEqual(FACH.page({ tags: ["fach: Physik"] }), { name: "Physik", source: "tag" });
	assert.deepEqual(FACH.page({ tags: ["subject: Chemistry"] }), { name: "Chemie", source: "tag" });
	assert.deepEqual(FACH.page({ tags: ["Informatik"] }), { name: "Informatik", source: "tag" });
	assert.deepEqual(FACH.page({ tags: ["todo", "wichtig"] }), { name: "Allgemein", source: "fallback" });

	// 3. Seitentitel
	assert.deepEqual(FACH.page({ title: "Die Weimarer Republik und ihr Scheitern" }), { name: "Geschichte", source: "title" });
	assert.deepEqual(FACH.page({ title: "Plattentektonik & Erdbeben" }), { name: "Geografie", source: "title" });
	assert.deepEqual(FACH.page({ title: "Harmonielehre und Kadenzen" }), { name: "Musik", source: "title" });

	// 4. Übergeordnete Hierarchie (Parent-Chain)
	S.pages["root-1"] = { id: "root-1", title: "Biologie LK" };
	S.pages["sub-1"] = { id: "sub-1", parentId: "root-1", title: "Mitschrift Dienstag" };
	assert.deepEqual(FACH.page(S.pages["sub-1"]), { name: "Biologie", source: "page-root" });

	// 5. Fließtext-Erkennung (Content)
	const bioNote = {
		id: "note-bio",
		title: "Mitschrift 12.10.",
		content: "Heute behandelten wir die Zellteilung, Mitose und Meiose sowie die Struktur der DNA in der Zellbiologie.",
	};
	assert.deepEqual(FACH.page(bioNote), { name: "Biologie", source: "content" });

	// 6. Beliebige/unklare Notizen landen sauber bei 'Allgemein'
	const randomNote = {
		id: "note-random",
		title: "Einkaufsliste Supermarkt",
		content: "Milch, Eier, Mehl und Zucker kaufen.",
	};
	assert.deepEqual(FACH.page(randomNote), { name: "Allgemein", source: "fallback" });
});

test("FACH.context und FACH.card verknüpfen Stapel und Seite deterministisch", () => {
	S.pages = {};
	S.cards = {};

	// Deck hat ein Schulfach
	assert.deepEqual(FACH.context({ deck: "Mathematik::Algebra" }), { name: "Mathematik", source: "deck-root" });

	// Deck ist generisch ('Inbox'), aber Seite hat Schulfach
	S.pages["p-chem"] = { id: "p-chem", subject: "Chemie" };
	assert.deepEqual(FACH.context({ deck: "Inbox", pageId: "p-chem" }), { name: "Chemie", source: "manual" });

	// Weder Deck noch Seite haben Schulfach -> Allgemein
	S.pages["p-random"] = { id: "p-random", title: "Einkaufszettel" };
	assert.deepEqual(FACH.context({ deck: "Inbox", pageId: "p-random" }), { name: "Allgemein", source: "fallback" });

	// FACH.card delegiert korrekt
	assert.deepEqual(FACH.card({ deck: "Physik::Optik" }), { name: "Physik", source: "deck-root" });
	assert.deepEqual(FACH.card({ deck: "Inbox", pageId: "p-chem" }), { name: "Chemie", source: "manual" });
});

test("FACH.detectPageAsync und Embedding-Klassifikation funktionieren mit Embedding-Dienst", async () => {
	FACH.clearCache();

	// Mock-Adapter für EMBEDDINGS
	// Prototyp-Vektoren: 17 Fächer, wir geben jedem Fach eine eigene Dimension im 17D-Vektor
	const subjectIndex = new Map(KNOWN_SUBJECTS.map((s, i) => [s, i]));

	EMBEDDINGS.setAdapter({
		embed: async (texts) => {
			return texts.map((text) => {
				const v = new Float32Array(KNOWN_SUBJECTS.length);
				const lower = String(text).toLowerCase();
				for (const [subj, idx] of subjectIndex.entries()) {
					if (lower.includes(subj.toLowerCase())) {
						v[idx] += 1.0;
					}
				}
				if (lower.includes("newton") || lower.includes("beschleunigung")) {
					v[subjectIndex.get("Physik")] += 2.0;
				}
				// Normalisieren
				let sum = 0;
				for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
				const mag = Math.sqrt(sum) || 1;
				for (let i = 0; i < v.length; i++) v[i] /= mag;
				return v;
			});
		},
	});

	// Eine Notiz ohne Keywords im Titel, aber mit physikalischem Inhalt
	const physicsNote = {
		id: "p-async-1",
		title: "Versuchsaufbau 3b",
		content: "Wir messen die Beschleunigung und berechnen die resultierende Kraft nach Newton.",
		updated: 100,
	};

	const result = await FACH.detectPageAsync(physicsNote);
	assert.equal(result.name, "Physik");
	assert.equal(result.source, "embedding");

	// Nachfolgender synchroner Aufruf liest aus dem Embedding-Cache
	const cachedResult = FACH.page(physicsNote);
	assert.equal(cachedResult.name, "Physik");
	assert.equal(cachedResult.source, "embedding");

	FACH.clearCache();
});

test("FACH.detectPageAsync fängt Embedding-Fehler robust ab und liefert Fallback", async () => {
	FACH.clearCache();
	EMBEDDINGS.setAdapter({
		embed: async () => {
			throw new Error("Modell nicht geladen");
		},
	});

	const unklarNote = {
		id: "p-err-1",
		title: "Unbekannter Titel",
		content: "Irgendein beliebiger Text ohne erkennbare Schulfächer.",
		updated: 1,
	};

	const res = await FACH.detectPageAsync(unklarNote);
	assert.equal(res.name, "Allgemein");
	assert.equal(res.source, "fallback");
	FACH.clearCache();
});

