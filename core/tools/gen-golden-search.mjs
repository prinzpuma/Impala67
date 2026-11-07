// core/tools/gen-golden-search.mjs
// Golden-Files für impala-search: Palette (preview, highlight_ranges) und Einstellungssuche (searchSettings).
// Ausführung: node core/tools/gen-golden-search.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "../impala-search/tests/golden");

const { SETTINGS_ITEMS, SETTINGS_SECTIONS, searchSettings } = await import("../../web/settings-schema.js");

// 1. Palette Golden
const previewCases = [
	{ input: "  a\n\n b\t", output: "a b" },
	{ input: "x".repeat(200), output: "x".repeat(110) },
	{ input: "   Hello   world!  \nThis is a test.\t\tOk?  ", output: "Hello world! This is a test. Ok?" },
	{ input: "", output: "" },
	{ input: "   ", output: "" },
];

const highlightCases = [
	{ text: "Foto und foto, Fotos", query: "foto", terms: ["fotos"], want: [[0, 4], [9, 13], [15, 19]] },
	{ text: "Größe", query: "grö", terms: [], want: [[0, 4]] }, // "Grö" in "Größe" (Grö is 4 bytes in utf-8)
	{ text: "abc", query: "", terms: [], want: [] },
	{ text: "Karten wiederholen — 3 fällig", query: "karte", terms: ["karten"], want: [[0, 6]] },
	{ text: "Neuer Chat mit KI", query: "chat", terms: [], want: [[6, 10]] },
];

fs.writeFileSync(path.join(outDir, "palette.json"), JSON.stringify({
	previews: previewCases,
	highlights: highlightCases,
}, null, 2) + "\n");

// 2. Settings Search Golden
const queries = [
	"",
	"theme",
	"dark",
	"status",
	"ki",
	"sync",
	"speicher",
	"modus",
	"karten",
	"controller",
	"offline",
	"erscheinungsbild",
	"backup",
	"vibration",
	"mcp",
	"scanner",
	"danger",
	"nichtvorhanden",
	"google drive",
	"ki quellen",
	"tagesartikel",
];

const contexts = [
	{ name: "all", ctx: { native: true, web: true } },
	{ name: "web", ctx: { web: true } },
	{ name: "native", ctx: { native: true } },
];

const settingsCases = [];
for (const q of queries) {
	for (const { name, ctx } of contexts) {
		const results = searchSettings(q, 8, ctx);
		settingsCases.push({
			query: q,
			context: name,
			hits: results.map(r => ({
				id: r.id,
				section: r.section,
				score: r.score,
			})),
		});
	}
}

// Auch die normalisierten Einträge für den Katalog exportieren
const catalog = SETTINGS_ITEMS.map(item => {
	const section = SETTINGS_SECTIONS.find(s => s.id === item.section);
	const normalize = (value) => String(value || "").toLocaleLowerCase("de-DE")
		.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
	return {
		id: item.id,
		section: item.section,
		platform: item.platform || null,
		title: normalize(item.label),
		haystack: normalize([item.label, item.description, item.group, item.keywords, section?.label].join(" ")),
	};
});

fs.writeFileSync(path.join(outDir, "settings_search.json"), JSON.stringify({
	catalog,
	cases: settingsCases,
}, null, 2) + "\n");

// 3. Rust Source settings_catalog.rs
const rustCatalogLines = catalog.map(item => {
	const plat = item.platform ? `Some("${item.platform}")` : "None";
	return `    ("${item.id}", "${item.section}", ${plat}, "${item.title}", "${item.haystack}"),`;
});

const rustCode = `//! Automatisch erzeugt durch \`core/tools/gen-golden-search.mjs\` aus \`web/settings-schema.js\`.
//! Enthält die normalisierten Such-Tokens (IDs, Bereichs-IDs, Plattform-Filter, Titel- und Volltext-Tokens).
//! Die formatierten Anzeigetexte (Labels, Beschreibungen) bleiben in der jeweiligen App.

pub(crate) static DEFAULT_CATALOG: &[(&str, &str, Option<&str>, &str, &str)] = &[
${rustCatalogLines.join("\n")}
];
`;

fs.writeFileSync(path.join(here, "../impala-search/src/settings_catalog.rs"), rustCode);

console.log("Golden-Files für Suche und Einstellungen erfolgreich erzeugt.");

