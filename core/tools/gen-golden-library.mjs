#!/usr/bin/env node
// Erzeugt Golden-Tests für Bibliothek, Seitenbaum und Heft-Regal aus den bisherigen JS-Regeln (web/library.js).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const COVER_PRESETS = ["sunset", "ocean", "forest", "grape", "mono"];
const FOLDER_TONES = ["sky", "mint", "lilac", "sand", "rose", "slate"];

function jsDefaultCover(pg) {
	const s = (pg.title || "") + (pg.id || "");
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return COVER_PRESETS[h % COVER_PRESETS.length];
}

function jsFolderTone(key) {
	const s = String(key || "");
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return FOLDER_TONES[h % FOLDER_TONES.length];
}

function jsGnOrder(item) {
	return typeof item.gnOrder === "number" ? item.gnOrder
		: (typeof item.order === "number" ? item.order : Date.parse(item.created || "") || 0);
}

const coverSamples = [
	{ title: "Analysis I", id: "p-101" },
	{ title: "Lineare Algebra", id: "p-202" },
	{ title: "", id: "heft-abc-123" },
	{ title: "Übungsblatt 4 — Differentialgleichungen", id: "9f8e7d6c" },
];

const toneSamples = ["f1", "Uni", "Mathematik & Statistik", "", "ordner-99"];

const sampleState = {
	workspaces: {
		default: { id: "default", name: "Privat", created: "2026-01-01T00:00:00Z" },
		uni: { id: "uni", name: "Studium", created: "2026-01-02T00:00:00Z" },
	},
	treeOpen: {
		p1: true,
		"ws:default": true,
	},
	gnFolders: {
		f1: { id: "f1", title: "Semester 1", parentId: null, order: 10, created: "2026-01-01T00:00:00Z" },
		f2: { id: "f2", title: "Analysis", parentId: "f1", order: 5, created: "2026-01-02T00:00:00Z" },
	},
	pages: {
		p1: { id: "p1", title: "Vorlesung", workspaceId: "default", parentId: null, order: 1, favorite: true, tags: ["uni", "mathe"], updated: "2026-11-01T10:00:00Z", created: "2026-10-01T10:00:00Z" },
		p2: { id: "p2", title: "Kapitel 1", workspaceId: "default", parentId: "p1", order: 1, pdfId: "pdf:1", tags: ["script"], updated: "2026-11-02T10:00:00Z", created: "2026-10-02T10:00:00Z" },
		p3: { id: "p3", title: "Mitschrieb", workspaceId: "default", parentId: null, kind: "heft", gnFolderId: "f1", gnOrder: 20, favorite: true, updated: "2026-11-03T10:00:00Z", created: "2026-10-03T10:00:00Z" },
		p4: { id: "p4", title: "Vorlage Protokoll", workspaceId: "uni", parentId: null, order: 1, isTemplate: true, updated: "2026-11-04T10:00:00Z", created: "2026-10-04T10:00:00Z" },
		p5: { id: "p5", title: "Alte Klausur", workspaceId: "default", parentId: null, archived: true, archivedRoot: true, archivedAt: "2026-11-05T10:00:00Z", updated: "2026-11-05T10:00:00Z", created: "2026-10-05T10:00:00Z" },
		p6: { id: "p6", title: "Lösung Teil 1", workspaceId: "default", parentId: "p5", archived: true, updated: "2026-11-05T11:00:00Z", created: "2026-10-05T11:00:00Z" },
	},
};

const out = {
	covers: coverSamples.map((c) => ({ ...c, cover: jsDefaultCover(c) })),
	tones: toneSamples.map((k) => ({ key: k, tone: jsFolderTone(k) })),
	gnOrders: [
		{ item: { gnOrder: 42, order: 10, created: "2026-01-01T00:00:00Z" }, expected: jsGnOrder({ gnOrder: 42, order: 10, created: "2026-01-01T00:00:00Z" }) },
		{ item: { order: 15, created: "2026-01-01T00:00:00Z" }, expected: jsGnOrder({ order: 15, created: "2026-01-01T00:00:00Z" }) },
		{ item: { created: "2026-01-01T00:00:00.000Z" }, expected: jsGnOrder({ created: "2026-01-01T00:00:00.000Z" }) },
	],
	state: sampleState,
	expectedNotionAll: {
		all: 4,
		fav: 2,
		pdf: 1,
		tpl: 1,
		sections: [
			{
				workspaceId: "default",
				workspaceName: "Privat",
				rows: [
					{ id: "p1", depth: 0, hasKids: true, collapsed: false },
					{ id: "p2", depth: 1, hasKids: false, collapsed: false },
					{ id: "p3", depth: 0, hasKids: false, collapsed: false },
				],
			},
			{
				workspaceId: "uni",
				workspaceName: "Studium",
				rows: [
					{ id: "p4", depth: 0, hasKids: false, collapsed: false },
				],
			},
		],
	},
	expectedNotionSearchScript: {
		all: 4,
		fav: 2,
		pdf: 1,
		tpl: 1,
		sections: [
			{
				workspaceId: "default",
				workspaceName: "Privat",
				rows: [
					{ id: "p1", depth: 0, hasKids: true, collapsed: false },
					{ id: "p2", depth: 1, hasKids: false, collapsed: false },
				],
			},
		],
	},
	expectedArchiveAll: {
		all: 1,
		hefte: 0,
		pages: 1,
		sections: [
			{
				workspaceId: "default",
				workspaceName: "Privat",
				rows: [
					{ id: "p5", depth: 0, hasKids: true, collapsed: true },
				],
			},
		],
	},
	expectedShelfRoot: {
		folderId: null,
		ancestors: [],
		items: [
			{ kind: "folder", id: "f1", order: 10, directCount: 2 },
		],
		allCount: 0,
		favCount: 0,
	},
	expectedShelfF1: {
		folderId: "f1",
		ancestors: ["f1"],
		items: [
			{ kind: "folder", id: "f2", order: 5, directCount: 0 },
			{ kind: "heft", id: "p3", order: 20, directCount: 0 },
		],
		allCount: 1,
		favCount: 1,
	},
};

const target = path.join(ROOT, "core/impala-model/tests/golden/library.json");
fs.writeFileSync(target, JSON.stringify(out, null, 2) + "\n");
console.log("Wrote", target);
