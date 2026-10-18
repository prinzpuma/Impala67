"use strict";

import { S, STATE } from "./state.js";
import { EMBEDDINGS } from "./embedding.js";
import { DB } from "./db.js";
import { dot, norm } from "./rag-ranking.js";

// Offizieller Schulfächer-Katalog
export const KNOWN_SUBJECTS = Object.freeze([
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
	"Elektrotechnik",
	"Maschinenbau",
	"Politik",
]);

// Keine Fächer, sondern Kategorien: Sammelseiten (Semester, gemischte Fächer) und
// alles, was sich nicht eindeutig zuordnen lässt. Bewusst nicht in KNOWN_SUBJECTS,
// damit Lernzeit-/Analyse-Statistiken nur echte Fächer zeigen.
export const DEFAULT_SUBJECT = "Sonstiges";
export const OVERVIEW_SUBJECT = "Übersicht";

const MAX_LEN = 80;

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

const SUBJECT_DEFINITIONS = [
	{
		name: "Mathematik",
		aliases: ["mathematik", "mathe", "math", "mathematics", "maths"],
		keywords: [
			"algebra", "geometrie", "geometry", "analysis", "stochastik",
			"vektoren", "vektor", "vektorrechnung", "arithmetik",
			"differentialrechnung", "integralrechnung", "ableitung", "ableitungen",
			"integral", "integrale", "trigonometrie", "bruchrechnung", "brüche",
			"kurvendiskussion", "lineare algebra", "wahrscheinlichkeitsrechnung",
			"matrizen", "matrix", "terme", "differentialgleichung", "differentialgleichungen",
			"nullstellen", "lineare gleichungssysteme", "determinanten", "determinante",
			"eigenwerte", "eigenvektoren", "vektorräume", "vektorraum", "grenzwerte",
			"stetigkeit", "mehrdimensionale integration", "taylorreihe", "numerik",
		],
	},
	{
		name: "Deutsch",
		aliases: ["deutsch", "german"],
		keywords: [
			"literatur", "literaturgeschichte", "grammatik", "erörterung",
			"gedicht", "gedichte", "gedichtanalyse", "lyrik", "epik", "dramatik",
			"rechtschreibung", "diktat", "textanalyse", "sachtext",
			"inhaltsangabe", "interpretation", "aufsatz", "charakterisierung",
			"leseverstehen", "lektüre", "sprachwandel", "novelle", "ballade",
			"szenenanalyse", "kurzgeschichte",
		],
	},
	{
		name: "Englisch",
		aliases: ["englisch", "english"],
		keywords: [
			"vocab", "vocabulary", "grammar", "reading comprehension",
			"listening comprehension", "mediation", "phrasal verbs", "irregular verbs",
			"idioms", "tenses", "simple present", "present perfect", "past simple",
			"past perfect", "reported speech", "passive voice", "conditional sentences",
		],
	},
	{
		name: "Physik",
		aliases: ["physik", "physics", "experimentalphysik", "festkörperphysik", "theoretische physik", "quantenmechanik"],
		keywords: [
			"mechanik", "optik", "optics", "elektrizitätslehre", "elektrodynamik",
			"thermodynamik", "thermodynamics", "astrophysik", "quantenphysik",
			"atomphysik", "kernphysik", "kinematik", "magnetismus", "elektrostatik",
			"schwingungen", "schwingung", "wellenlehre", "wellen", "gravitation",
			"relativitätstheorie", "stromkreis", "lorentzkraft", "maxwell-gleichungen",
			"newton", "kreisbewegung", "reibungskraft", "energieerhaltung", "interferometrie",
			"kristallgitter", "realgitter", "reziprokes gitter", "phononen", "bändermodell",
		],
	},
	{
		name: "Chemie",
		aliases: ["chemie", "chemistry"],
		keywords: [
			"anorganik", "organik", "anorganische chemie", "organische chemie",
			"periodensystem", "stöchiometrie", "chemische reaktionen", "chemische reaktion",
			"säuren und basen", "säuren", "säure", "atombau", "chemische bindung", "kovalente bindung",
			"ionenbindung", "moleküle", "molekül", "redox", "redoxreaktion",
			"elektrochemie", "titration", "alkane", "alkene", "alkohole", "ester",
			"polymere", "pse",
		],
	},
	{
		name: "Biologie",
		aliases: ["biologie", "bio", "biology"],
		keywords: [
			"genetik", "ökologie", "oekologie", "zellbiologie", "evolution",
			"neurobiologie", "fotosynthese", "photosynthese", "anatomie",
			"botanik", "zoologie", "stoffwechsel", "immunsystem", "mitose",
			"meiose", "dna", "rna", "genexpression", "ökosystem", "nervensystem",
			"synapse", "synapsen", "enzym", "enzyme", "proteinbiosynthese",
			"vererbung", "zellteilung",
		],
	},
	{
		name: "Geschichte",
		aliases: ["geschichte", "history", "historie"],
		keywords: [
			"weimarer republik", "mittelalter", "antike", "weltkriege", "weltkrieg",
			"ddr", "brd", "französische revolution", "nationalsozialismus", "ns-zeit",
			"drittes reich", "kaiserreich", "kalter krieg", "römisches reich",
			"römische republik", "römische antike", "holocaust", "industrialisierung",
			"imperialismus", "bismarck", "renaissance", "aufklärung",
			"erster weltkrieg", "zweiter weltkrieg", "deutsche einheit", "mauerfall",
			"feudalismus", "absolutismus",
		],
	},
	{
		name: "Geografie",
		aliases: ["geografie", "geographie", "erdkunde", "geography"],
		keywords: [
			"klimazonen", "klimazone", "plattentektonik", "vulkanismus", "vulkane",
			"geologie", "kartografie", "kartographie", "klimawandel",
			"topographie", "stadtgeographie", "stadtgeografie", "tektonik",
			"kontinente", "kontinent", "tropen", "geomorphologie", "demographie",
			"demografie", "glazialmorphologie", "sedimentation",
		],
	},
	{
		name: "Informatik",
		aliases: ["informatik", "computer science", "computer-science"],
		keywords: [
			"programmierung", "programmieren", "python", "javascript", "typescript",
			"java", "c++", "c#", "algorithmen", "algorithmus", "algorithms",
			"datenbanken", "datenbank", "sql", "datenstrukturen",
			"rechnernetze", "softwareentwicklung", "html", "css", "coding",
			"objektorientierte programmierung", "oop", "rekursion", "sortieralgorithmen",
		],
	},
	{
		name: "Wirtschaft",
		aliases: [
			"wirtschaft", "wirtschaft & recht", "wirtschaft und recht", "wiwat",
			"bwl", "vwl", "ökonomie", "oekonomie", "economics", "wirtschaften",
		],
		keywords: [
			"finanzen", "volkswirtschaft", "betriebswirtschaft",
			"volkswirtschaftslehre", "betriebswirtschaftslehre", "rechnungswesen",
			"marketing", "geldpolitik", "inflation", "angebot und nachfrage",
			"marktformen", "marktwirtschaft", "bilanz", "buchführung",
			"gewinn und verlust", "bip", "bruttoinlandsprodukt", "konjunktur",
			"wirtschaftskreislauf", "aktiengesellschaft", "gmbh",
		],
	},
	{
		name: "Kunst",
		aliases: ["kunst", "art", "bildende kunst"],
		keywords: [
			"malerei", "malen", "kunstgeschichte",
			"skulptur", "farbtheorie", "farbenlehre",
			"bildanalyse", "epochen der kunst",
			"impressionismus", "expressionismus", "surrealismus", "kubismus",
			"barock", "renaissance-kunst", "pop art", "radierung", "aquarell",
		],
	},
	{
		name: "Musik",
		aliases: ["musik", "music"],
		keywords: [
			"musiktheorie", "notenlehre", "harmonielehre",
			"instrumentenkunde", "gehörbildung", "komposition", "tonleiter",
			"tonleitern", "akkorde", "akkord", "rhythmus", "partitur", "gesang",
			"melodie", "symphonie", "sonate", "notenlesen", "dreiklänge",
			"dur und moll", "kadenz", "kadenzen", "tonart",
		],
	},
	{
		name: "Religion / Ethik",
		aliases: [
			"religion / ethik", "religion/ethik", "religion", "ethik",
			"philosophie", "philo", "religionslehre", "religionsunterricht", "ethikunterricht",
		],
		keywords: [
			"evangelisch", "katholisch", "theologie", "moral", "bibel", "glaube",
			"philosophieren", "sokrates", "platon", "aristoteles", "kant",
			"kategorischer imperativ", "utilitarismus", "deontologie", "menschenwürde",
			"gerechtigkeit", "gewissen", "weltreligionen", "judentum", "christentum",
			"islam", "buddhismus", "hinduismus",
		],
	},
	{
		name: "Französisch",
		aliases: ["französisch", "franzoesisch", "français", "francais", "french"],
		keywords: [
			"vocabulaire", "grammaire", "passé composé", "imparfait", "subjonctif",
			"futur simple", "conditionnel", "französische grammatik", "verbes français",
			"pronoms", "adjectifs", "französisch-vokabeln",
		],
	},
	{
		name: "Spanisch",
		aliases: ["spanisch", "español", "espanol", "spanish"],
		keywords: [
			"vocabulario", "gramática", "gramatica", "subjuntivo", "indefinido",
			"imperfecto", "spanische grammatik", "verbos en español", "spanisch-vokabeln",
			"pronombres",
		],
	},
	{
		name: "Latein",
		aliases: ["latein", "lingua latina", "latin"],
		keywords: [
			"grammatica", "deklination", "konjugation", "vokabeln latein",
			"latein-vokabeln", "lateinisch", "lateinische", "caesar", "cicero",
			"ovid", "seneca", "aci", "ablativus absolutus", "participium coniunctum",
			"gerundium",
		],
	},
	{
		name: "Sport",
		aliases: ["sport"],
		keywords: [
			"sporttheorie", "trainingslehre", "bewegungslehre", "leichtathletik",
			"gymnastik", "ausdauer", "krafttraining", "sportunterricht", "fitness",
			"biomechanik", "trainingsmethoden", "superkompensation", "aerob",
			"anaerob", "sportbiologie",
		],
	},
	{
		name: "Elektrotechnik",
		aliases: ["elektrotechnik", "e-technik", "etechnik", "elektronik", "electrical engineering"],
		keywords: [
			"netzwerkanalyse", "zweipole", "zweipol", "wechselstrom", "wechselstromrechnung",
			"gleichstrom", "impedanz", "maschenstrom", "maschenstromverfahren", "knotenpotential",
			"knotenpotentialverfahren", "ersatzschaltbild", "ersatzschaltbilder", "schaltung",
			"schaltungen", "diode", "dioden", "transistor", "transistoren", "operationsverstärker",
			"kondensator", "spule", "ohmsches gesetz", "kirchhoff", "kirchhoffsche regeln",
			"ltspice", "spannungsteiler", "stromteiler", "rc-schaltung", "rc-schaltungen",
			"bauelemente", "halbleiter", "leistungsanpassung", "reaktive netzwerke",
		],
	},
	{
		name: "Maschinenbau",
		aliases: [
			"maschinenbau", "technische mechanik", "kontinuumsmechanik", "festigkeitslehre",
			"werkstoffkunde", "konstruktionslehre", "maschinenelemente", "mechanical engineering",
		],
		keywords: [
			"statik", "balken", "biegemoment", "biegemomente", "biegemomentenverlauf",
			"schnittgrößen", "querkraft", "querkraftverlauf", "flächenträgheitsmoment",
			"flächenträgheitsmomente", "steiner-satz", "freikörperbild", "lagerkräfte",
			"spannungstensor", "hookesches gesetz", "torsion", "knickung", "finite elemente",
			"getriebe", "werkstoffe",
		],
	},
	{
		name: "Politik",
		aliases: ["politik", "sozialkunde", "gemeinschaftskunde", "powi", "politikwissenschaft"],
		keywords: [
			"demokratie", "bundestag", "bundesrat", "grundgesetz", "gewaltenteilung",
			"föderalismus", "europäische union", "bundesverfassungsgericht", "parteien",
			"wahlrecht", "rechtsstaat",
		],
	},
];

function escapeRegex(str) {
	return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildBoundaryRegex(terms) {
	if (!terms || !terms.length) return null;
	const escaped = terms.map(escapeRegex);
	escaped.sort((a, b) => b.length - a.length);
	return new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${escaped.join("|")})(?=$|[^\\p{L}\\p{N}])`, "giu");
}

// Exakter Alias-Index für Soforttreffer
const EXACT_MAP = new Map([["info", "Informatik"], ["et", "Elektrotechnik"]]);
for (const def of SUBJECT_DEFINITIONS) {
	EXACT_MAP.set(def.name.toLowerCase(), def.name);
	for (const alias of def.aliases) {
		EXACT_MAP.set(alias.toLowerCase(), def.name);
	}
}

// Vorkompilierte Regex-Muster je Fach
const COMPILED_RULES = SUBJECT_DEFINITIONS.map((def) => {
	// "art" im Fließtext / Titel ausschließen, um falsche Treffer ("eine Art...") zu vermeiden
	const aliasTerms = def.name === "Kunst"
		? def.aliases.filter((a) => a !== "art")
		: def.aliases;

	return {
		name: def.name,
		aliasRegex: buildBoundaryRegex(aliasTerms),
		keywordRegex: buildBoundaryRegex(def.keywords),
	};
});

function sanitize(value) {
	return String(value || "")
		.replace(/[\u0000-\u001f]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, MAX_LEN);
}

// Punkte je Fach: Namen (Alias) zählen mehr als Fachbegriffe. Absteigend sortiert.
function rankSubjects(text, aliasWeight, keywordWeight) {
	const ranked = [];
	for (const rule of COMPILED_RULES) {
		let score = 0;
		if (rule.aliasRegex) score += (text.match(rule.aliasRegex) || []).length * aliasWeight;
		if (rule.keywordRegex) score += (text.match(rule.keywordRegex) || []).length * keywordWeight;
		if (score) ranked.push({ name: rule.name, score });
	}
	return ranked.sort((a, b) => b.score - a.score);
}

// Nur eindeutige Ergebnisse: genug Punkte UND mindestens doppelt so viele wie das zweitbeste
// Fach. Alles andere ist mehrdeutig und bekommt bewusst kein Fach (lieber "Sonstiges" als falsch).
function clearWinner(ranked, minScore) {
	const [best, second] = ranked;
	if (!best || best.score < minScore) return null;
	return !second || best.score >= 2 * second.score ? best.name : null;
}

// Titel, Tags, Stapelnamen: ein Fachname oder ein eindeutiger Fachbegriff genügt
export function resolveSubject(text) {
	const sanitized = sanitize(text);
	if (!sanitized) return null;
	const lower = sanitized.toLowerCase();
	if (EXACT_MAP.has(lower)) return EXACT_MAP.get(lower);
	return clearWinner(rankSubjects(sanitized, 4, 2), 2);
}

// Fließtext: mindestens drei Fachbegriffe (oder Name + Begriffe) mit klarem Vorsprung
function resolveSubjectFromContent(content) {
	if (!content) return null;
	return clearWinner(rankSubjects(String(content).slice(0, 3000), 3, 2), 6);
}

// Fließtext-Fach je Seitenstand gemerkt — auch „kein Fach“. Die rund 40 Regex-Durchläufe
// je Seite liefen sonst bei jedem Render erneut für jede Seite ohne erkennbares Fach.
const contentSubjectCache = new Map(); // pageId -> { updated, subject }
function contentSubjectOf(pageObj) {
	const hit = contentSubjectCache.get(pageObj.id);
	if (hit && hit.updated === pageObj.updated) return hit.subject;
	const subject = resolveSubjectFromContent(pageObj.content);
	contentSubjectCache.set(pageObj.id, { updated: pageObj.updated, subject });
	return subject;
}

// Nennt ein Titel mehrere Fächer beim Namen ("ET × Mathe × Physik"), ist es eine Sammelseite
function namesSeveralSubjects(text) {
	const sanitized = sanitize(text);
	return COMPILED_RULES.filter((rule) => rule.aliasRegex && (sanitized.match(rule.aliasRegex) || []).length).length >= 2;
}

// Sammelseiten am Titel erkennen: "Semester 3", "Übersicht", "Stundenplan" …
const OVERVIEW_TITLE = /^[^\p{L}\p{N}]*(?:semester|wintersemester|sommersemester|übersicht|uebersicht|overview|dashboard|stundenplan|studienplan|klausurplan|lernplan|inhaltsverzeichnis)(?=$|[^\p{L}])/iu;
const isOverviewTitle = (title) => OVERVIEW_TITLE.test(sanitize(title)) || namesSeveralSubjects(title);

// In-Memory-Klassifikations-Cache für Embedding & Textanalyse
const pageClassificationCache = new Map(); // pageId -> { updated, subject, source }
// pageId -> updated: je Seitenstand höchstens EIN Embedding-Versuch, auch ohne Treffer.
// page() läuft bei jedem Render; ohne diese Sperre löste jede Seite ohne erkennbares Fach
// pro Render eine neue Embedding-Anfrage aus (bei Online-Anbietern echte API-Kosten).
const embeddingTried = new Map();

function getCachedSubject(pageObj) {
	if (!pageObj?.id) return null;
	const entry = pageClassificationCache.get(pageObj.id);
	if (entry && entry.updated === pageObj.updated) {
		return { name: entry.subject, source: entry.source };
	}
	return null;
}

function setCachedSubject(pageObj, subject, source) {
	if (!pageObj?.id || !subject) return;
	pageClassificationCache.set(pageObj.id, { updated: pageObj.updated, subject, source });
}

let prototypeVectors = null;
let prototypePromise = null;
let cachedModelIdentity = "";

async function getPrototypeVectors() {
	const currentModel = String(S?.settings?.embedModel || "default");
	if (prototypeVectors && cachedModelIdentity === currentModel) {
		return prototypeVectors;
	}
	if (prototypePromise) return prototypePromise;

	prototypePromise = (async () => {
		try {
			const subjects = KNOWN_SUBJECTS;
			const texts = subjects.map((s) => SUBJECT_PROTOTYPES[s]);
			const vectors = await EMBEDDINGS.embed(texts, { priority: "background" });
			if (!Array.isArray(vectors) || vectors.length !== subjects.length) {
				return null;
			}
			const map = new Map();
			for (let i = 0; i < subjects.length; i++) {
				const v = vectors[i];
				const n = norm(v);
				const nv = new Float32Array(v.length);
				for (let j = 0; j < v.length; j++) nv[j] = v[j] / n;
				map.set(subjects[i], nv);
			}
			prototypeVectors = map;
			cachedModelIdentity = currentModel;
			return map;
		} catch {
			return null;
		} finally {
			prototypePromise = null;
		}
	})();

	return prototypePromise;
}

const EMBED_MIN = 0.4, EMBED_MARGIN = 0.04;
async function classifyVector(vec) {
	if (!vec || !vec.length) return null;
	const prototypes = await getPrototypeVectors();
	if (!prototypes || prototypes.size === 0) return null;

	const vecNorm = norm(vec);
	let bestSubject = null;
	let bestScore = -1, secondScore = -1;

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

	// Mindestähnlichkeit UND klarer Abstand zum zweitnächsten Fach — die Prototypen sind nur
	// Stichwortlisten, knappe Entscheidungen sind meist Zufall (Kontinuumsmechanik → Sport).
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

	// 1. Bereits durch RAG indexierten Vektor aus IndexedDB nutzen, falls vorhanden
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

	// 2. Direkte Embedding-Berechnung auf Titel & Notizentext
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

// Fachfeld oder Tag darf auch eine Kategorie sein — so lassen sich Fehlgriffe dauerhaft korrigieren
function resolveExplicit(value) {
	const lower = sanitize(value).toLowerCase();
	if (!lower) return null;
	if (lower === OVERVIEW_SUBJECT.toLowerCase() || lower === "uebersicht") return OVERVIEW_SUBJECT;
	if (lower === DEFAULT_SUBJECT.toLowerCase() || lower === "allgemein") return DEFAULT_SUBJECT;
	return resolveSubject(value);
}

// Ausdrücklich festgelegt: Fachfeld der Seite (Menü „Fach festlegen“) oder Tag ("fach: Mathe", "Biologie")
function explicitSubject(pageObj) {
	if (!pageObj) return null;
	if (pageObj.subject) {
		const s = resolveExplicit(pageObj.subject);
		if (s) return s;
	}
	for (const raw of Array.isArray(pageObj.tags) ? pageObj.tags : []) {
		const match = sanitize(raw).match(/^(?:fach|fachbereich|subject)\s*:\s*(.+)$/i);
		const s = match ? resolveExplicit(match[1]) : resolveSubject(raw);
		if (s) return s;
	}
	return null;
}

// Seitenkette von der obersten Seite bis zur Seite selbst
function lineage(pageObj) {
	const chain = [pageObj], seen = new Set([pageObj.id]);
	let cur = pageObj;
	while (cur.parentId && S?.pages?.[cur.parentId] && !seen.has(cur.parentId)) {
		cur = S.pages[cur.parentId];
		seen.add(cur.id);
		chain.unshift(cur);
	}
	return chain;
}

// Fach einer Seite nur aus ihr selbst (ohne Eltern) — für die Abstimmung der Unterseiten
const intrinsicCache = new Map(); // pageId -> { updated, subject }
function intrinsicSubject(pageObj) {
	const hit = intrinsicCache.get(pageObj.id);
	if (hit && hit.updated === pageObj.updated) return hit.subject;
	const explicit = explicitSubject(pageObj);
	const subject = explicit
		? (KNOWN_SUBJECTS.includes(explicit) ? explicit : null)
		: isOverviewTitle(pageObj.title) ? null : resolveSubject(pageObj.title) || contentSubjectOf(pageObj);
	intrinsicCache.set(pageObj.id, { updated: pageObj.updated, subject });
	return subject;
}

// Unterseiten stimmen ab: klare Mehrheit (≥ 2/3) → deren Fach, gemischt → Übersicht
function childrenVote(pageObj) {
	const votes = new Map();
	let n = 0;
	// Über den Eltern-Index statt über alle Seiten: page() für jede Seite war sonst O(n²).
	for (const child of STATE.childPagesOf(pageObj.id)) {
		if (child.trashed) continue;
		const s = intrinsicSubject(child);
		if (!s) continue;
		n++;
		votes.set(s, (votes.get(s) || 0) + 1);
	}
	if (n < 2) return null;
	const [top, count] = [...votes].sort((a, b) => b[1] - a[1])[0];
	return count / n >= 2 / 3 ? { name: top, source: "children" } : { name: OVERVIEW_SUBJECT, source: "overview" };
}

function workspaceSubject(pageObj) {
	const workspaceName = S?.workspaces?.[pageObj?.workspaceId || "default"]?.name;
	return workspaceName ? resolveSubject(workspaceName) : null;
}

// Haupt-API
export const FACH = (() => {
	function clean(value) {
		return resolveExplicit(value) || DEFAULT_SUBJECT;
	}

	// Reihenfolge = Verlässlichkeit. Die Ordnerstruktur schlägt den eigenen Titel: Eine Notiz
	// „Funktionen“ im Ordner „Informatik 1“ ist Informatik, nicht Mathematik.
	function page(pageObj) {
		if (!pageObj) return { name: DEFAULT_SUBJECT, source: "fallback" };

		// 1. Für diese Seite festgelegt (Fachfeld oder Tag)
		const own = explicitSubject(pageObj);
		if (own) return { name: own, source: "manual" };

		// 2. Nächste übergeordnete Seite mit festgelegtem Fach vererbt es — außer „Übersicht“:
		//    Unter einer Sammelseite hat jeder Zweig sein eigenes Fach.
		const chain = lineage(pageObj);
		for (let i = chain.length - 2; i >= 0; i--) {
			const s = explicitSubject(chain[i]);
			if (s && s !== OVERVIEW_SUBJECT) return { name: s, source: "inherited" };
		}

		// 3. Oberste Seite mit eindeutigem Fach im Titel bestimmt den ganzen Zweig
		for (const node of chain) {
			if (isOverviewTitle(node.title)) continue;
			const s = resolveSubject(node.title);
			if (s) return { name: s, source: node === pageObj ? "title" : "page-root" };
		}

		// 4. Sammelseiten: am Titel oder an Unterseiten mit gemischten Fächern
		if (isOverviewTitle(pageObj.title)) return { name: OVERVIEW_SUBJECT, source: "overview" };
		const vote = childrenVote(pageObj);
		if (vote) return vote;

		// 5. Fließtext bzw. gemerktes Embedding-Ergebnis (je Seitenstand)
		const cached = getCachedSubject(pageObj);
		if (cached) return cached;
		const contentSubj = contentSubjectOf(pageObj);
		if (contentSubj) return { name: contentSubj, source: "content" };

		// 6. Workspace-Name
		const ws = workspaceSubject(pageObj);
		if (ws) return { name: ws, source: "workspace" };

		// 7. Hintergrund-Embedding anstoßen (blockiert niemals synchron)
		if (pageObj.content && String(pageObj.content).trim().length >= 30) {
			scheduleBackgroundEmbedding(pageObj);
		}

		return { name: DEFAULT_SUBJECT, source: "fallback" };
	}

	// Echte Fächer einer Seitenliste, zuletzt bearbeitetes zuerst (ohne Übersicht/Sonstiges)
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
		const raw = sanitize(deckName);
		if (!raw) return { name: DEFAULT_SUBJECT, source: "fallback" };

		// Stapel-Pfade wie "Mathematik::Analysis" oder "Latein::Vokabeln"
		const parts = raw.split("::").map((p) => p.trim()).filter(Boolean);
		for (const part of parts) {
			const s = resolveSubject(part);
			if (s) return { name: s, source: "deck-root" };
		}

		const whole = resolveSubject(raw);
		if (whole) return { name: whole, source: "deck-root" };

		return { name: DEFAULT_SUBJECT, source: "fallback" };
	}

	function context({ deck: deckName, pageId } = {}) {
		const deckValue = deck(deckName);
		if (deckValue.source !== "fallback") return deckValue;

		const pageValue = pageId && S?.pages?.[pageId] ? page(S.pages[pageId]) : null;
		if (pageValue && pageValue.source !== "fallback") return pageValue;

		return pageValue || deckValue;
	}

	function card(cardObj) {
		return context({ deck: cardObj?.deck, pageId: cardObj?.pageId });
	}

	async function pageAsync(pageObj) {
		const syncResult = page(pageObj);
		if (syncResult.source !== "fallback") return syncResult;
		if (!pageObj || !pageObj.content) return syncResult;

		try {
			const detected = await classifyPageWithEmbedding(pageObj);
			if (detected) {
				setCachedSubject(pageObj, detected, "embedding");
				return { name: detected, source: "embedding" };
			}
		} catch {}

		return syncResult;
	}


	return {
		KNOWN_SUBJECTS,
		DEFAULT_SUBJECT,
		OVERVIEW_SUBJECT,
		clean,
		page,
		subjectsOf,
		pageAsync,
		deck,
		context,
		card,
		resolveSubject,
	};
})();

