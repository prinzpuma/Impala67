"use strict";

// Fach-Erkennung über den Rust-Kern (`core/impala-fach`); hier bleibt nur die
// asynchrone Embedding-Einordnung als letzter Rückfall für unklassifizierte Seiten.

import { CORE } from "./rust-core.js";
import { S, STATE } from "./state.js";
import { EMBEDDINGS } from "./embedding.js";
import { DB } from "./db.js";
import { dot, norm } from "./vector-math.js";

export const KNOWN_SUBJECTS = Object.freeze(CORE.fachKnownSubjects());

export const DEFAULT_SUBJECT = "Sonstiges";
export const OVERVIEW_SUBJECT = "Übersicht";

export function resolveSubject(raw) {
	if (raw == null) return null;
	return CORE.fachResolveSubject(String(raw)) ?? null;
}

// Vordefinierte Vektor-Prototypentexte für semantische Ähnlichkeitsabgleiche
const SUBJECT_PROTOTYPES = Object.freeze({
	"Mathematik": "Mathematik Mathe Algebra Geometrie Analysis Stochastik Vektoren Differentialrechnung Integralrechnung Trigonometrie Kurvendiskussion Wahrscheinlichkeitsrechnung Gleichungen Arithmetik",
	"Deutsch": "Deutsch Literatur Grammatik Erörterung Gedicht Lyrik Epik Dramatik Rechtschreibung Diktat Textanalyse Sachtext Interpretation Aufsatz Lektüre",
	"Englisch": "English Englisch Vocabulary Vocab Grammar Reading Comprehension Listening Mediation Phrasal Verbs Tenses Language",
	"Physik": "Physik Physics Mechanik Optik Elektrizitätslehre Thermodynamik Astrophysik Quantenphysik Atomphysik Kinematik Magnetismus Schwingungen Wellen Gravitation Relativitätstheorie Stromkreis Kraft Newton Energie Beschleunigung Geschwindigkeit",
	"Chemie": "Chemie Chemistry Anorganik Organik Periodensystem Chemische Reaktionen Stöchiometrie Säuren Basen Atombau Bindung Moleküle Redox Elektrochemie Titration",
	"Biologie": "Biologie Bio Biology Genetik Ökologie Zellbiologie Evolution Neurobiologie Fotosynthese Anatomie Botanik Zoologie Stoffwechsel Immunsystem DNA RNA Zelle",
	"Geschichte": "Geschichte History Weimarer Republik Mittelalter Antike Weltkriege DDR Revolution Nationalsozialismus Drittes Reich Kaiserreich Kalter Krieg Römisches Reich Epochen",
	"Geografie": "Geografie Geographie Erdkunde Geography Klimazonen Plattentektonik Vulkanismus Geologie Kartografie Atmosphäre Klimawandel Topographie Stadtgeographie Kontinente Tektonik",
	"Informatik": "Informatik Computer Science Info Programmierung Python Java JavaScript Algorithmen Datenbanken SQL Datenstrukturen Netzwerke Softwareentwicklung Coding Rechnernetze",
	"Wirtschaft": "Wirtschaft Wirtschaft und Recht Wiwat BWL VWL Ökonomie Finanzen Unternehmen Volkswirtschaft Betriebswirtschaft Rechnungswesen Marketing Geldpolitik Inflation Markt Bilanz",
	"Kunst": "Kunst Art Bildende Kunst Zeichnen Malerei Kunstgeschichte Skulptur Plastik Farbtheorie Perspektive Grafik Bildanalyse Malen Design Architektur",
	"Musik": "Musik Music Musiktheorie Notenlehre Harmonielehre Instrumente Gehörbildung Komposition Tonleiter Akkorde Rhythmus Partitur Gesang Melodie Symphonie",
	"Religion / Ethik": "Religion Ethik Philosophie Philo Theologie Moral Bibel Glaube Werte Philosophieren Sokrates Kant Menschenwürde Gerechtigkeit Gewissen Sinnfragen",
	"Französisch": "Französisch Franzoesisch Français Francais French Vocabulaire Grammaire Langue Française Traduction Compréhension Verbes",
	"Spanisch": "Spanisch Español Espanol Spanish Vocabulario Gramática Lengua Española Traducción Comprensión Verbos",
	"Latein": "Latein Lingua Latina Latin Grammatica Deklination Konjugation Vokabeln Lateinisch Caesar Cicero Ovid ACI Ablativus Absolutus",
	"Sport": "Sport Sporttheorie Trainingslehre Bewegungslehre Leichtathletik Gymnastik Ausdauer Krafttraining Sportunterricht Fitness Biomechanik",
	"Elektrotechnik": "Elektrotechnik Elektronik Netzwerkanalyse Zweipole Wechselstromrechnung Impedanz Kirchhoff Maschenstrom Knotenpotential Ersatzschaltbild Dioden Transistoren Operationsverstärker Kondensator Spule Halbleiter Schaltungen",
	"Maschinenbau": "Maschinenbau Technische Mechanik Kontinuumsmechanik Statik Festigkeitslehre Balken Biegemoment Schnittgrößen Flächenträgheitsmoment Freikörperbild Lagerkräfte Werkstoffkunde Konstruktion Maschinenelemente Torsion",
	"Politik": "Politik Sozialkunde Gemeinschaftskunde Demokratie Bundestag Grundgesetz Wahlen Gewaltenteilung Föderalismus Parteien Europäische Union Bundesverfassungsgericht",
});

// Asynchrone Embedding-Klassifikation als letzter Rückfall (nicht blockierend)
const EMBED_MIN = 0.25;
const EMBED_MARGIN = 0.03;
const embeddingCache = new Map(); // pageId -> { updated, name, source }
const embeddingTried = new Map(); // pageId -> updated
let prototypeVectors = null; // Map<string, Float32Array>
let prototypeModelKey = "";
let prototypeLoadPromise = null;

function getCachedSubject(pageObj) {
	if (!pageObj?.id) return null;
	const hit = embeddingCache.get(pageObj.id);
	if (hit && hit.updated === pageObj.updated) {
		return { name: hit.name, source: hit.source };
	}
	return null;
}

function setCachedSubject(pageObj, name, source = "embedding") {
	if (!pageObj?.id || !name) return;
	embeddingCache.set(pageObj.id, { updated: pageObj.updated, name, source });
}

async function ensurePrototypes() {
	const modelKey = `${S?.settings?.embedProviderId || ""}:${S?.settings?.embedModel || ""}`;
	if (!S?.settings?.embedModel) return null;
	if (prototypeVectors && prototypeModelKey === modelKey) return prototypeVectors;
	if (prototypeLoadPromise && prototypeModelKey === modelKey) return prototypeLoadPromise;

	prototypeModelKey = modelKey;
	prototypeLoadPromise = (async () => {
		try {
			const entries = Object.entries(SUBJECT_PROTOTYPES);
			const texts = entries.map(([, desc]) => desc);
			const vectors = await EMBEDDINGS.embed(texts, { priority: "background" });
			const map = new Map();
			for (let i = 0; i < entries.length; i++) {
				if (vectors[i] && vectors[i].length > 0) {
					const v = Float32Array.from(vectors[i]);
					const n = norm(v);
					if (n > 0) {
						for (let k = 0; k < v.length; k++) v[k] /= n;
						map.set(entries[i][0], v);
					}
				}
			}
			prototypeVectors = map;
			return map;
		} catch {
			return null;
		} finally {
			prototypeLoadPromise = null;
		}
	})();
	return prototypeLoadPromise;
}

async function classifyVector(vec) {
	if (!vec || !vec.length) return null;
	const prototypes = await ensurePrototypes();
	if (!prototypes || !prototypes.size) return null;

	const vecNorm = norm(vec);
	if (vecNorm === 0) return null;

	let bestSubject = null;
	let bestScore = -1;
	let secondScore = -1;

	for (const [subject, pVec] of prototypes.entries()) {
		if (pVec.length !== vec.length) continue;
		const sim = dot(vec, pVec) / vecNorm;
		if (sim > bestScore) {
			secondScore = bestScore;
			bestScore = sim;
			bestSubject = subject;
		} else if (sim > secondScore) {
			secondScore = sim;
		}
	}

	if (bestSubject && bestScore >= EMBED_MIN && bestScore - secondScore >= EMBED_MARGIN) {
		return { name: bestSubject, score: bestScore };
	}
	return null;
}

export async function classifyTextWithEmbedding(text) {
	const sample = String(text || "").trim().slice(0, 1500);
	if (sample.length < 30) return null;
	try {
		const [vec] = await EMBEDDINGS.embed([sample], { priority: "background" });
		const match = await classifyVector(vec);
		return match?.name || null;
	} catch {
		return null;
	}
}

export async function classifyPageWithEmbedding(pageObj) {
	if (!pageObj) return null;

	try {
		if (typeof DB !== "undefined" && DB?.getVec && pageObj.id) {
			const record = await DB.getVec(pageObj.id);
			const firstChunkVec = record?.chunks?.[0]?.vec;
			if (firstChunkVec) {
				const match = await classifyVector(firstChunkVec);
				if (match?.name) return match.name;
			}
		}
	} catch {}

	const text = (pageObj.title ? pageObj.title + "\n\n" : "") + (pageObj.content || "");
	return await classifyTextWithEmbedding(text);
}

function scheduleBackgroundEmbedding(pageObj) {
	if (!pageObj?.id || !S?.settings?.embedModel || embeddingTried.get(pageObj.id) === pageObj.updated) return;
	embeddingTried.set(pageObj.id, pageObj.updated);

	const run = async () => {
		try {
			const detected = await classifyPageWithEmbedding(pageObj);
			if (detected) {
				setCachedSubject(pageObj, detected, "embedding");
			}
		} catch {
			// Embedding-Fehler still abfangen
		}
	};

	if (typeof queueMicrotask === "function") {
		queueMicrotask(run);
	} else {
		setTimeout(run, 0);
	}
}

export const FACH = (() => {
	function clean(value) {
		return value == null ? DEFAULT_SUBJECT : CORE.fachClean(String(value));
	}

	function page(pageObj) {
		if (!pageObj?.id) return { name: DEFAULT_SUBJECT, source: "fallback" };
		const ignoreManual = pageObj.subject === null && S?.pages?.[pageObj.id]?.subject != null;
		const res = STATE.pageSubject(pageObj.id, ignoreManual);
		if (res.source !== "fallback") return res;

		const cached = getCachedSubject(pageObj);
		if (cached) return cached;

		if (pageObj.content && String(pageObj.content).trim().length >= 30) {
			scheduleBackgroundEmbedding(pageObj);
		}
		return res;
	}

	function subjectsOf(pages) {
		const out = [];
		const newest = [...pages].sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")));
		for (const p of newest) {
			const s = page(p).name;
			if (KNOWN_SUBJECTS.includes(s) && !out.includes(s)) out.push(s);
		}
		return out;
	}

	function deck(deckName) {
		return deckName == null ? { name: DEFAULT_SUBJECT, source: "fallback" } : CORE.fachDeckSubject(String(deckName));
	}

	function context({ deck: deckName, pageId } = {}) {
		return STATE.cardSubject(String(deckName || ""), pageId || null);
	}

	function card(cardObj) {
		return context({ deck: cardObj?.deck, pageId: cardObj?.pageId });
	}

	return {
		KNOWN_SUBJECTS,
		DEFAULT_SUBJECT,
		OVERVIEW_SUBJECT,
		clean,
		page,
		subjectsOf,
		deck,
		context,
		card,
		resolveSubject,
	};
})();
