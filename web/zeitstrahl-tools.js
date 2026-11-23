"use strict";

import { ZS_STORE, ZS_CORE } from "./zeitstrahl-store.js";

// zeitstrahl-tools.js — KI-Werkzeuge des Zeitstrahls (Definitionen: core/impala-lehrer/src/tool_defs.json).
// Dieselbe Ausführung für App-KI (tools.js) und MCP (mcp-bridge.js → TOOLS.runFlat).

export const ZS_TOOL_DEFS = ZS_CORE.toolDefs();
export const ZS_TOOL_NAMES = new Set(ZS_TOOL_DEFS.map((d) => d.function?.name).filter(Boolean));

async function readTimeline(a) {
	await ZS_STORE.load();
	if (!a.title) {
		const list = ZS_STORE.all().map((tl) => ZS_CORE.listEntry(tl));
		return { timelines: list, hint: list.length ? "Mit title einen Zeitstrahl öffnen." : "Noch kein Zeitstrahl – mit edit_timeline anlegen." };
	}
	const tl = ZS_STORE.getSync(a.title);
	if (!tl) return { error: `Zeitstrahl „${a.title}“ nicht gefunden.`, timelines: ZS_STORE.all().map((t) => t.title) };
	return ZS_CORE.describe(tl, a.node);
}

async function editTimeline(a) {
	const { dry_run: dryRun, ...edit } = a;
	if (!String(edit.title || "").trim()) return { error: "edit_timeline: title fehlt." };
	await ZS_STORE.load();
	const before = ZS_STORE.getSync(edit.title);
	const out = ZS_CORE.applyEdit(before, edit);
	if (out.error) return out;
	const summary = { ok: true, timeline: out.timeline.title, id: out.timeline.id, created: !before, added: out.added, updated: out.updated, removed: out.removed, nodes: out.timeline.nodes.length, ...(out.warnings?.length ? { warnings: out.warnings } : {}) };
	if (dryRun) return { ...summary, dryRun: true };
	await ZS_STORE.put(out.timeline);
	return summary;
}

async function checkLesson(a) {
	const { dry_run: dryRun, ...check } = a;
	await ZS_STORE.load();
	const tl = ZS_STORE.getSync(check.timeline);
	if (!tl) return { error: `check_lesson: Zeitstrahl „${check.timeline}“ nicht gefunden.` };
	const out = ZS_CORE.applyCheck(tl, check);
	if (out.error) return out;
	if (dryRun) return { ok: true, dryRun: true, node: out.node };
	await ZS_STORE.put(out.timeline);
	return { ok: true, node: out.node };
}

// Wikipedia: Suche (api.php, CORS über origin=*) und Zusammenfassung mit Bild (REST).
async function wikipedia(a) {
	const lang = /^[a-z]{2,3}$/.test(String(a.lang || "")) ? a.lang : "de";
	const q = String(a.query || "").trim();
	if (!q) return { error: "wikipedia: query fehlt." };
	const base = `https://${lang}.wikipedia.org`;
	try {
		const sr = await fetch(`${base}/w/api.php?action=query&list=search&format=json&origin=*&srlimit=5&srsearch=${encodeURIComponent(q)}`).then((r) => r.json());
		const hits = (sr?.query?.search || []).map((h) => h.title);
		if (!hits.length) return { error: `Kein Wikipedia-Artikel zu „${q}“.` };
		const title = hits.find((t) => t.toLowerCase() === q.toLowerCase()) || hits[0];
		const sum = await fetch(`${base}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`).then((r) => r.json());
		return {
			title: sum.title || title,
			description: sum.description || "",
			extract: String(sum.extract || "").slice(0, 2500),
			url: sum.content_urls?.desktop?.page || `${base}/wiki/${encodeURIComponent(title)}`,
			image: sum.originalimage?.source || sum.thumbnail?.source || null,
			other_results: hits.filter((t) => t !== title),
			hint: "Als Quelle: {kind:\"wiki\", ref:url, title}. Bild: images [{src:image, credit:\"Wikimedia Commons\"}].",
		};
	} catch (err) {
		return { error: "Wikipedia nicht erreichbar: " + String(err?.message || err) };
	}
}

const RUN = { read_timeline: readTimeline, edit_timeline: editTimeline, check_lesson: checkLesson, wikipedia };

export async function runZeitstrahlTool(name, args) {
	const fn = RUN[name];
	if (!fn) return { error: "Unbekanntes Tool: " + name };
	return fn(args && typeof args === "object" ? args : {});
}
