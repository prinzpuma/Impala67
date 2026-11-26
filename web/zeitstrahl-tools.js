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
	const { dry_run: dryRun, delete: remove, ...edit } = a;
	if (!String(edit.title || "").trim()) return { error: "edit_timeline: title fehlt." };
	await ZS_STORE.load();
	const before = ZS_STORE.getSync(edit.title);
	if (remove) {
		if (!before) return { error: `edit_timeline: Zeitstrahl „${edit.title}“ nicht gefunden.` };
		const summary = { ok: true, deleted: true, timeline: before.title, id: before.id, nodes: (before.nodes || []).length };
		if (dryRun) return { ...summary, dryRun: true };
		await ZS_STORE.remove(before.id);
		return summary;
	}
	const out = ZS_CORE.applyEdit(before, edit);
	if (out.error) return out;
	const summary = { ok: true, timeline: out.timeline.title, id: out.timeline.id, created: !before, added: out.added, updated: out.updated, removed: out.removed, nodes: out.timeline.nodes.length, ...(out.warnings?.length ? { warnings: out.warnings } : {}), ...(out.story?.length ? { story_todo: out.story } : {}) };
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

const RUN = { read_timeline: readTimeline, edit_timeline: editTimeline, check_lesson: checkLesson };

export async function runZeitstrahlTool(name, args) {
	const fn = RUN[name];
	if (!fn) return { error: "Unbekanntes Tool: " + name };
	return fn(args && typeof args === "object" ? args : {});
}
