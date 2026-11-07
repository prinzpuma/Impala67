#!/usr/bin/env node
// Erzeugt Golden-Tests für Schulnoten, Tagesartikel-Auswahl und Chat-Sitzungsliste
// aus den bisherigen JS-Regeln (web/schulnoten.js, web/home-article.js, web/chats.js).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// --- JS-Referenzimplementierung aus web/schulnoten.js ---
function jsAllGrades(gradesMap) {
	const out = [];
	for (const [id, g] of Object.entries(gradesMap || {})) {
		if (!g || g.deleted) continue;
		const val = Number(g.grade);
		if (!Number.isFinite(val)) continue;
		const w = Number(g.weight);
		out.push({
			id: g.id || id,
			subject: String(g.subject || "Allgemein").trim() || "Allgemein",
			grade: val,
			weight: Number.isFinite(w) && w > 0 ? w : 1,
			date: g.date || (g.created ? String(g.created).slice(0, 10) : ""),
			comment: g.comment ? String(g.comment) : "",
			created: g.created || "",
		});
	}
	return out.sort((a, b) => String(b.date || b.created || "").localeCompare(String(a.date || a.created || "")));
}

function jsAverage(list) {
	if (!list.length) return null;
	let sum = 0, weight = 0;
	for (const g of list) {
		const w = Number.isFinite(Number(g.weight)) && Number(g.weight) > 0 ? Number(g.weight) : 1;
		const v = Number(g.grade);
		if (!Number.isFinite(v)) continue;
		sum += v * w;
		weight += w;
	}
	return weight > 0 ? sum / weight : null;
}

function jsSubjects(gradesMap) {
	const bySubj = new Map();
	for (const g of jsAllGrades(gradesMap)) {
		if (!bySubj.has(g.subject)) bySubj.set(g.subject, []);
		bySubj.get(g.subject).push(g);
	}
	return [...bySubj.entries()]
		.map(([subject, grades]) => ({ subject, grades, average: jsAverage(grades) }))
		.sort((a, b) => a.subject.toLowerCase().localeCompare(b.subject.toLowerCase()) || (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0));
}

const fmtGrade = (n, digits = 2) => {
	const v = Number(n);
	return Number.isFinite(v) ? v.toFixed(digits).replace(".", ",") : "–";
};
const weightLabel = (w) => {
	const n = Number(w);
	if (!Number.isFinite(n) || n === 1) return "1×";
	return `${String(n).replace(".", ",")}×`;
};

function jsExportMarkdown(gradesMap, todayLabel) {
	const list = jsAllGrades(gradesMap);
	const overall = jsAverage(list);
	const subjs = jsSubjects(gradesMap);
	const lines = [
		"# Schulnoten-Übersicht",
		"",
		`**Gesamtschnitt:** ${overall !== null ? fmtGrade(overall, 2) : "–"} (${list.length} ${list.length === 1 ? "Note" : "Noten"}) · Stand: ${todayLabel}`,
		"",
	];
	for (const s of subjs) {
		lines.push(`## ${s.subject} (Ø ${s.average !== null ? fmtGrade(s.average, 2) : "–"})`);
		lines.push("");
		lines.push("| Datum | Note | Gewichtung | Kommentar |");
		lines.push("| --- | --- | --- | --- |");
		for (const g of s.grades) {
			lines.push(`| ${g.date || "–"} | ${fmtGrade(g.grade, 1)} | ${weightLabel(g.weight)} | ${(g.comment || "").replace(/\|/g, "\\|")} |`);
		}
		lines.push("");
	}
	return lines.join("\n");
}

function jsGradeTier(n) {
	const v = Number(n);
	if (v <= 1.5) return 1;
	if (v <= 2.5) return 2;
	if (v <= 3.5) return 3;
	if (v <= 4.5) return 4;
	return 5;
}

// --- JS-Referenzimplementierung aus web/home-article.js ---
function jsPickTopic(topicsRaw, historyFirstTopics) {
	const own = String(topicsRaw || "").split(/[,;\n]/).map((t) => t.trim()).filter(Boolean);
	if (!own.length) return null;
	const lastUse = (t) => {
		const i = historyFirstTopics.findIndex((h) => String(h || "").toLowerCase() === t.toLowerCase());
		return i < 0 ? Infinity : i;
	};
	return own.reduce((best, t) => (lastUse(t) > lastUse(best) ? t : best));
}

function jsChooseNotes(pool, recentUsedIds, recentFocuses, knownSubjects) {
	const used = new Set(recentUsedIds);
	const lastFocus = new Set(recentFocuses.slice(0, 2).filter(Boolean));
	const usable = pool.filter((p) => p.contentLen >= 40)
		.map((p) => ({ p, archived: p.archived, subject: p.subject, used: used.has(p.id) }))
		.filter((n) => n.subject !== "Übersicht & Organisation");
	const candidates = usable.some((n) => !n.archived) ? usable.filter((n) => !n.archived) : usable;
	const bySubject = new Map();
	for (const n of candidates) {
		const g = bySubject.get(n.subject) || { fresh: 0, newest: "" };
		if (!n.used) g.fresh++;
		if (String(n.p.updated || "") > g.newest) g.newest = String(n.p.updated || "");
		bySubject.set(n.subject, g);
	}
	const known = (s) => (knownSubjects.includes(s) ? 1 : 0);
	const focus = [...bySubject].sort(([a, x], [b, y]) =>
		(lastFocus.has(a) - lastFocus.has(b)) || ((x.fresh ? 0 : 1) - (y.fresh ? 0 : 1)) || (known(b) - known(a)) || (y.newest < x.newest ? -1 : y.newest > x.newest ? 1 : 0))[0]?.[0] || null;
	const inFocus = usable.filter((n) => n.subject === focus).sort((a, b) => (a.used - b.used) || (b.p.updated < a.p.updated ? -1 : b.p.updated > a.p.updated ? 1 : 0));
	const main = inFocus.filter((n) => !n.archived || candidates === usable).slice(0, 4);
	const side = inFocus.filter((n) => n.archived && !main.includes(n)).slice(0, 2);
	return { focus, noteIds: [...main, ...side].map((n) => n.p.id) };
}

// --- JS-Referenzimplementierung aus web/chats.js ---
const stamp = (...vals) => String(vals.find(Boolean) || "");
const atLeast = (a, b) => String(a || "") >= String(b || "");
const sorted = (list) => [...list].sort((a, b) => (String(b.updated) < String(a.updated) ? -1 : (String(b.updated) > String(a.updated) ? 1 : 0)));

function jsNormalize(session, now) {
	if (!session?.id) return null;
	return {
		...session,
		id: String(session.id),
		title: String(session.title || ""),
		messages: Array.isArray(session.messages) ? session.messages : [],
		created: stamp(session.created, session.updated, now),
		updated: stamp(session.updated, session.created, now),
	};
}

function jsMergedSessions(stateChats, localRaw, now) {
	const byId = new Map();
	for (const item of localRaw) {
		const s = jsNormalize(item, now);
		if (s) byId.set(s.id, s);
	}
	for (const item of Object.values(stateChats || {})) {
		if (!item?.id) continue;
		const id = String(item.id);
		if (item.deleted) {
			const cached = byId.get(id);
			if (!cached || atLeast(item.deletedAt, cached.updated)) byId.delete(id);
			continue;
		}
		const s = jsNormalize(item, now);
		const old = byId.get(id);
		if (s && (!old || atLeast(s.updated, old.updated))) byId.set(id, s);
	}
	return sorted([...byId.values()]);
}

const gradesCases = [
	{
		today: "07.11.2026",
		grades: {
			g1: { id: "g1", subject: "Mathematik", grade: 1.3, weight: 2, date: "2026-10-15", comment: "Klausur 1 | Analysis", created: "2026-10-15T10:00:00.000Z" },
			g2: { id: "g2", subject: "Mathematik", grade: 2.0, weight: 1, date: "2026-09-20", comment: "Test", created: "2026-09-20T09:00:00.000Z" },
			g3: { id: "g3", subject: "Informatik", grade: 1.0, weight: 1.5, date: "", comment: "", created: "2026-11-01T12:00:00.000Z" },
			g4: { id: "g4", subject: "Informatik", grade: 3.7, weight: 1, date: "2026-10-01", comment: "Projekt", created: "2026-10-01T08:00:00.000Z", deleted: true },
			g5: { id: "g5", subject: "  ", grade: 2.7, weight: 0, date: "2026-10-10", comment: "Mündlich", created: "2026-10-10T08:00:00.000Z" },
		},
	},
	{
		today: "01.01.2026",
		grades: {},
	},
];

const topicCases = [
	{ topicsRaw: "Mathematik, Physik; Informatik\nChemie", history: ["Physik", "Mathematik"] },
	{ topicsRaw: "Analysis, Lineare Algebra", history: ["Lineare Algebra", "Analysis"] },
	{ topicsRaw: "   , ; ", history: ["Mathematik"] },
];

const knownSubjects = ["Mathematik", "Informatik", "Physik", "Chemie"];
const chooseCases = [
	{
		pool: [
			{ id: "p1", contentLen: 120, updated: "2026-11-05T10:00:00Z", archived: false, subject: "Mathematik" },
			{ id: "p2", contentLen: 200, updated: "2026-11-06T10:00:00Z", archived: false, subject: "Mathematik" },
			{ id: "p3", contentLen: 80, updated: "2026-11-04T10:00:00Z", archived: true, subject: "Mathematik" },
			{ id: "p4", contentLen: 150, updated: "2026-11-07T10:00:00Z", archived: false, subject: "Informatik" },
			{ id: "p5", contentLen: 20, updated: "2026-11-07T12:00:00Z", archived: false, subject: "Physik" },
			{ id: "p6", contentLen: 300, updated: "2026-11-07T15:00:00Z", archived: false, subject: "Übersicht & Organisation" },
		],
		recentUsedIds: ["p4"],
		recentFocuses: ["Informatik"],
	},
	{
		pool: [
			{ id: "a1", contentLen: 90, updated: "2026-10-01T10:00:00Z", archived: true, subject: "Physik" },
			{ id: "a2", contentLen: 110, updated: "2026-10-02T10:00:00Z", archived: true, subject: "Physik" },
		],
		recentUsedIds: [],
		recentFocuses: [],
	},
];

const chatCases = [
	{
		now: "2026-11-07T12:00:00.000Z",
		stateChats: {
			c1: { id: "c1", title: "Sync Chat 1", created: "2026-11-01T10:00:00Z", updated: "2026-11-05T10:00:00Z", messages: [{ role: "user", content: "Hallo", mid: "m1" }] },
			c2: { id: "c2", title: "Gelöscht", created: "2026-11-01T10:00:00Z", updated: "2026-11-06T10:00:00Z", deleted: true, deletedAt: "2026-11-08T10:00:00Z" },
		},
		localRaw: [
			{ id: "c1", title: "Alt Lokal", created: "2026-11-01T10:00:00Z", updated: "2026-11-02T10:00:00Z", messages: [] },
			{ id: "c2", title: "Sollte weg sein", created: "2026-11-01T10:00:00Z", updated: "2026-11-07T10:00:00Z", messages: [] },
			{ id: "c3", title: "", created: "", updated: "", messages: [{ role: "assistant", content: "Antwort", thinking: "Denke...", extra: 123 }, { role: "", content: "ungültig" }] },
		],
	},
];

const out = {
	grades: gradesCases.map((c) => ({
		...c,
		all: jsAllGrades(c.grades),
		average: jsAverage(jsAllGrades(c.grades)),
		subjects: jsSubjects(c.grades),
		markdown: jsExportMarkdown(c.grades, c.today),
	})),
	tiers: [1.0, 1.5, 1.6, 2.5, 2.6, 3.5, 3.6, 4.5, 4.6, 5.0].map((g) => ({ grade: g, tier: jsGradeTier(g) })),
	topics: topicCases.map((c) => ({ ...c, picked: jsPickTopic(c.topicsRaw, c.history) })),
	choose: chooseCases.map((c) => ({ ...c, knownSubjects, result: jsChooseNotes(c.pool, c.recentUsedIds, c.recentFocuses, knownSubjects) })),
	chats: chatCases.map((c) => ({ ...c, merged: jsMergedSessions(c.stateChats, c.localRaw, c.now) })),
};

const target = path.join(ROOT, "core/impala-model/tests/golden/kleinteile.json");
fs.writeFileSync(target, JSON.stringify(out, null, 2) + "\n");
console.log("Wrote", target);
