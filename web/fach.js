"use strict";

import { S } from "./state.js";
import { EMBEDDINGS } from "./embedding.js";
import { DB } from "./db.js";

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
]);

export const SUBJECTS = KNOWN_SUBJECTS;
export const DEFAULT_SUBJECT = "Allgemein";

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
			"matrizen", "matrix", "terme", "gleichung", "gleichungen",
			"funktionen", "differentialgleichung", "nullstellen",
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
		aliases: ["physik", "physics"],
		keywords: [
			"mechanik", "optik", "optics", "elektrizitätslehre", "elektrodynamik",
			"thermodynamik", "thermodynamics", "astrophysik", "quantenphysik",
			"atomphysik", "kernphysik", "kinematik", "dynamik", "magnetismus",
			"schwingungen", "schwingung", "wellenlehre", "wellen", "gravitation",
			"relativitätstheorie", "stromkreis", "induktion", "lorentzkraft",
			"newton", "kreisbewegung", "reibungskraft", "energieerhaltung",
		],
	},
	{
		name: "Chemie",
		aliases: ["chemie", "chemistry"],
		keywords: [
			"anorganik", "organik", "anorganische chemie", "organische chemie",
			"periodensystem", "stöchiometrie", "chemische reaktionen", "chemische reaktion",
			"reaktionen", "reaktion", "säuren und basen", "säuren", "basen",
			"säure", "base", "atombau", "chemische bindung", "kovalente bindung",
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
			"geologie", "kartografie", "kartographie", "atmosphäre", "klimawandel",
			"topographie", "stadtgeographie", "stadtgeografie", "tektonik",
			"kontinente", "kontinent", "tropen", "geomorphologie", "demographie",
			"demografie", "migration", "glazialmorphologie", "sedimentation",
		],
	},
	{
		name: "Informatik",
		aliases: ["informatik", "computer science", "computer-science", "info"],
		keywords: [
			"programmierung", "programmieren", "python", "javascript", "typescript",
			"java", "c++", "c#", "algorithmen", "algorithmus", "algorithms",
			"datenbanken", "datenbank", "sql", "datenstrukturen", "netzwerke",
			"rechnernetze", "softwareentwicklung", "html", "css", "coding",
			"objektorientierte programmierung", "oop", "rekursion", "sortieralgorithmen",
		],
	},
	{
		name: "Wirtschaft",
		aliases: [
			"wirtschaft", "wirtschaft & recht", "wirtschaft und recht", "wiwat",
			"bwl", "vwl", "ökonomie", "oekonomie", "economics",
		],
		keywords: [
			"finanzen", "unternehmen", "volkswirtschaft", "betriebswirtschaft",
			"volkswirtschaftslehre", "betriebswirtschaftslehre", "rechnungswesen",
			"marketing", "geldpolitik", "inflation", "angebot und nachfrage",
			"marktformen", "marktwirtschaft", "steuern", "bilanz", "buchführung",
			"gewinn und verlust", "bip", "bruttoinlandsprodukt", "konjunktur",
			"wirtschaftskreislauf", "aktiengesellschaft", "gmbh",
		],
	},
	{
		name: "Kunst",
		aliases: ["kunst", "art", "bildende kunst"],
		keywords: [
			"zeichnen", "zeichnung", "malerei", "malen", "kunstgeschichte",
			"skulptur", "plastik", "farbtheorie", "farbenlehre", "perspektive",
			"grafik", "bildanalyse", "design", "architektur", "epochen der kunst",
			"impressionismus", "expressionismus", "surrealismus", "kubismus",
			"barock", "renaissance-kunst", "pop art", "radierung", "aquarell",
		],
	},
	{
		name: "Musik",
		aliases: ["musik", "music"],
		keywords: [
			"musiktheorie", "notenlehre", "harmonielehre", "instrumente",
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
			"werte", "philosophieren", "sokrates", "platon", "aristoteles", "kant",
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
			"anaerob", "sportbiologie", "koordination",
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
const EXACT_MAP = new Map();
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

// Schneller Keyword- & Regex-Abgleich
export function resolveSubject(text) {
	const sanitized = sanitize(text);
	if (!sanitized) return null;
	const lower = sanitized.toLowerCase();

	// 1. Direkter Sofortabgleich (z. B. "Mathe" -> "Mathematik", "Wiwat" -> "Wirtschaft")
	if (EXACT_MAP.has(lower)) {
		return EXACT_MAP.get(lower);
	}

	// 2. Keyword- & Alias-Bewertung
	let bestSubject = null;
	let bestScore = 0;

	for (const rule of COMPILED_RULES) {
		let score = 0;
		if (rule.aliasRegex) {
			const m = sanitized.match(rule.aliasRegex);
			if (m) score += m.length * 4;
		}
		if (rule.keywordRegex) {
			const m = sanitized.match(rule.keywordRegex);
			if (m) score += m.length * 2;
		}
		if (score > bestScore) {
			bestScore = score;
			bestSubject = rule.name;
		}
	}

	return bestScore > 0 ? bestSubject : null;
}

function resolveSubjectFromContent(content) {
	if (!content) return null;
	const sample = String(content).slice(0, 3000);
	let bestSubject = null;
	let bestScore = 0;

	for (const rule of COMPILED_RULES) {
		let score = 0;
		if (rule.aliasRegex) {
			const m = sample.match(rule.aliasRegex);
			if (m) score += m.length * 3;
		}
		if (rule.keywordRegex) {
			const m = sample.match(rule.keywordRegex);
			if (m) score += m.length * 2;
		}
		if (score > bestScore) {
			bestScore = score;
			bestSubject = rule.name;
		}
	}

	// Schwellenwert für Fließtext: mindestens 2 Keywords oder 1 Alias + 1 Keyword
	return bestScore >= 4 ? bestSubject : null;
}

// In-Memory-Klassifikations-Cache für Embedding & Textanalyse
const pageClassificationCache = new Map(); // pageId -> { updated, subject }
const activeEmbeddingJobs = new Set();

function getCachedSubject(pageObj) {
	if (!pageObj?.id) return null;
	const entry = pageClassificationCache.get(pageObj.id);
	if (entry && entry.updated === pageObj.updated) {
		return entry.subject;
	}
	return null;
}

function setCachedSubject(pageObj, subject) {
	if (!pageObj?.id || !subject) return;
	pageClassificationCache.set(pageObj.id, { updated: pageObj.updated, subject });
}

// Vektor-Ähnlichkeits-Berechnung (Kosinus-Ähnlichkeit)
function norm(v) {
	let s = 0;
	for (let i = 0; i < v.length; i++) s += v[i] * v[i];
	return Math.sqrt(s) || 1;
}

function dot(a, b) {
	let s = 0;
	const len = Math.min(a.length, b.length);
	for (let i = 0; i < len; i++) s += a[i] * b[i];
	return s;
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

async function classifyVector(vec) {
	if (!vec || !vec.length) return null;
	const prototypes = await getPrototypeVectors();
	if (!prototypes || prototypes.size === 0) return null;

	const vecNorm = norm(vec);
	let bestSubject = null;
	let bestScore = -1;

	for (const [subject, pVec] of prototypes.entries()) {
		if (pVec.length !== vec.length) continue;
		const sim = dot(vec, pVec) / vecNorm;
		if (sim > bestScore) {
			bestScore = sim;
			bestSubject = subject;
		}
	}

	// Mindestähnlichkeit zum Fach-Prototyp
	if (bestSubject && bestScore >= 0.35) {
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
	if (!pageObj?.id || activeEmbeddingJobs.has(pageObj.id)) return;
	activeEmbeddingJobs.add(pageObj.id);

	const run = async () => {
		try {
			const detected = await classifyPageWithEmbedding(pageObj);
			if (detected) {
				setCachedSubject(pageObj, detected);
			}
		} catch {
			// Embedding-Fehler still abfangen
		} finally {
			activeEmbeddingJobs.delete(pageObj.id);
		}
	};

	if (typeof queueMicrotask === "function") {
		queueMicrotask(run);
	} else {
		setTimeout(run, 0);
	}
}

function explicitTag(pageObj) {
	if (!pageObj || !Array.isArray(pageObj.tags)) return "";
	for (const raw of pageObj.tags) {
		const tag = sanitize(raw);
		const match = tag.match(/^(?:fach|fachbereich|subject)\s*:\s*(.+)$/i);
		if (match) {
			const resolved = resolveSubject(match[1]);
			if (resolved) return resolved;
		}
		const direct = resolveSubject(tag);
		if (direct) return direct;
	}
	return "";
}

function ancestorSubject(pageObj) {
	let cur = pageObj, hops = 0;
	while (cur && cur.parentId && S?.pages?.[cur.parentId] && hops++ < 100) {
		cur = S.pages[cur.parentId];
		if (cur.subject) {
			const s = resolveSubject(cur.subject);
			if (s) return s;
		}
		const tag = explicitTag(cur);
		if (tag) return tag;
		const titleSubject = resolveSubject(cur.title);
		if (titleSubject) return titleSubject;
	}
	return null;
}

function workspaceSubject(pageObj) {
	const workspaceName = S?.workspaces?.[pageObj?.workspaceId || "default"]?.name;
	return workspaceName ? resolveSubject(workspaceName) : null;
}

// Haupt-API
export const FACH = (() => {
	function clean(value) {
		const resolved = resolveSubject(value);
		return resolved || DEFAULT_SUBJECT;
	}

	function page(pageObj) {
		if (!pageObj) return { name: DEFAULT_SUBJECT, source: "fallback" };

		// 1. Explizites Fachfeld der Seite
		if (pageObj.subject) {
			const s = resolveSubject(pageObj.subject);
			if (s) return { name: s, source: "manual" };
		}

		// 2. Tag-Angabe (z. B. "fach: Mathe", "Biologie")
		const tagSubj = explicitTag(pageObj);
		if (tagSubj) return { name: tagSubj, source: "tag" };

		// 3. Seitentitel
		if (pageObj.title) {
			const titleSubj = resolveSubject(pageObj.title);
			if (titleSubj) return { name: titleSubj, source: "title" };
		}

		// 4. Übergeordnete Seiten / Ordnerstruktur
		const anc = ancestorSubject(pageObj);
		if (anc) return { name: anc, source: "page-root" };

		// 5. Workspace-Name
		const ws = workspaceSubject(pageObj);
		if (ws) return { name: ws, source: "workspace" };

		// 6. Gecachte Embedding- oder Inhalts-Erkennung
		const cached = getCachedSubject(pageObj);
		if (cached) return { name: cached, source: "embedding" };

		// 7. Fließtext-Schlüsselwörter
		if (pageObj.content) {
			const contentSubj = resolveSubjectFromContent(pageObj.content);
			if (contentSubj) {
				setCachedSubject(pageObj, contentSubj);
				return { name: contentSubj, source: "content" };
			}
		}

		// 8. Hintergrund-Embedding anstoßen (blockiert niemals synchron)
		if (pageObj.content && String(pageObj.content).trim().length >= 30) {
			scheduleBackgroundEmbedding(pageObj);
		}

		return { name: DEFAULT_SUBJECT, source: "fallback" };
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
				setCachedSubject(pageObj, detected);
				return { name: detected, source: "embedding" };
			}
		} catch {}

		return syncResult;
	}

	function clearCache() {
		pageClassificationCache.clear();
		activeEmbeddingJobs.clear();
		prototypeVectors = null;
		prototypePromise = null;
		cachedModelIdentity = "";
	}

	return {
		KNOWN_SUBJECTS,
		SUBJECTS: KNOWN_SUBJECTS,
		DEFAULT_SUBJECT,
		clean,
		page,
		pageAsync,
		detectPageAsync: pageAsync,
		classifyWithEmbedding: classifyPageWithEmbedding,
		deck,
		context,
		card,
		resolveSubject,
		clearCache,
	};
})();

