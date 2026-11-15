#!/usr/bin/env node
// Funktionskatalog prüfen und docs/PARITAET.md daraus erzeugen.
//   node tools/paritaet.mjs              prüft Katalog, Fundstellen, Markierungen; Fehler, wenn PARITAET.md veraltet ist
//   node tools/paritaet.mjs --schreiben  schreibt den erzeugten Teil von docs/PARITAET.md neu
//   node tools/paritaet.mjs --details    listet zusätzlich unmarkierte Funktionen und PWA-Module ohne Katalogeintrag
// Katalog: docs/funktionen.json. Native Markierung im Code: Kommentar `funktion: <id>` (mehrere mit Komma).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const WRITE = args.has("--schreiben");
const DETAILS = args.has("--details");
const PLATTFORMEN = [["android", "Android"], ["ios", "iPad"]];
const STATUS_RE = /^(❌|🟡|⚪|–|✅|prüfen)/u;
const ID_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const START = "<!-- funktionen:start (erzeugt von tools/paritaet.mjs, nicht von Hand ändern) -->";
const END = "<!-- funktionen:end -->";

const errors = [];
const warnings = [];
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");

function walk(dir, ext, out = []) {
	if (!fs.existsSync(dir)) return out;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith(".") || entry.name === "build" || entry.name === "node_modules") continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(full, ext, out);
		else if (ext.some((e) => entry.name.endsWith(e))) out.push(full);
	}
	return out;
}
const readAll = (files) => files.map((f) => ({ file: f, text: fs.readFileSync(f, "utf8") }));

// ---- Quellen ----
const katalog = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/funktionen.json"), "utf8"));
const webDir = path.join(ROOT, "web");
const webFiles = readAll(walk(webDir, [".js", ".html", ".css"]).filter((f) => !rel(f).startsWith("web/core/")));
const webText = webFiles.map((f) => f.text).join("\n");
const nativ = {
	android: readAll(walk(path.join(ROOT, "android/app/src"), [".kt"])),
	ios: readAll(walk(path.join(ROOT, "ios/Impala67"), [".swift"]).filter((f) => !rel(f).includes("/Generated/"))),
};
const nativText = { android: nativ.android.map((f) => f.text).join("\n"), ios: nativ.ios.map((f) => f.text).join("\n") };

// ---- Katalog prüfen ----
const bereiche = new Map(katalog.bereiche.map((b) => [b.id, b]));
const ids = new Map();
for (const f of katalog.funktionen) {
	if (!ID_RE.test(f.id || "")) errors.push(`Ungültige ID „${f.id}“ (Form: bereich.name)`);
	if (ids.has(f.id)) errors.push(`Doppelte ID „${f.id}“`);
	ids.set(f.id, f);
	if (!bereiche.has(f.bereich)) errors.push(`${f.id}: unbekannter Bereich „${f.bereich}“`);
	if (!f.titel) errors.push(`${f.id}: Titel fehlt`);
	for (const [key] of PLATTFORMEN) {
		if (f[key] !== undefined && !STATUS_RE.test(String(f[key]))) errors.push(`${f.id}: Status ${key} „${f[key]}“ beginnt nicht mit ❌ 🟡 ⚪ – ✅ oder „prüfen“`);
	}
	for (const anker of f.pwa || []) {
		if (!fs.existsSync(path.join(webDir, anker)) && !webText.includes(anker)) errors.push(`${f.id}: PWA-Fundstelle „${anker}“ gibt es in web/ nicht mehr`);
	}
	const l = f.leistung;
	if (l) {
		if (!(l.ms > 0)) errors.push(`${f.id}: leistung.ms fehlt`);
		if (l.pwa && !webText.includes(`"${l.pwa}"`)) errors.push(`${f.id}: PWA-Messpunkt „${l.pwa}“ nicht gefunden`);
		if (l.ios && !nativText.ios.includes(`"${l.ios}"`)) errors.push(`${f.id}: iPad-Messpunkt „${l.ios}“ nicht gefunden`);
		if (l.android) {
			const [cat, name] = l.android.split(":");
			if (!new RegExp(`measure\\(\\s*"${cat}"\\s*,\\s*"${name}"`).test(nativText.android)) errors.push(`${f.id}: Android-Messpunkt „${l.android}“ (Profiler.measure("kategorie", "name")) nicht gefunden`);
		}
	}
}

// ---- Native Markierungen ----
const markiert = { android: new Map(), ios: new Map() };
for (const [key] of PLATTFORMEN) {
	for (const { file, text } of nativ[key]) {
		for (const m of text.matchAll(/\bfunktion:[ \t]*([a-z0-9.-]+(?:[ \t]*,[ \t]*[a-z0-9.-]+)*)/g)) {
			for (const id of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
				if (!ids.has(id)) errors.push(`${rel(file)}: Markierung „${id}“ steht nicht im Katalog`);
				else if (!markiert[key].has(id)) markiert[key].set(id, rel(file));
			}
		}
	}
}
for (const f of katalog.funktionen) {
	for (const [key, name] of PLATTFORMEN) {
		if (String(f[key] || "").startsWith("❌") && markiert[key].has(f.id)) warnings.push(`${f.id}: ${name} ist markiert (${markiert[key].get(f.id)}), Katalog sagt „${f[key]}“`);
	}
}

// ---- Einstellungen: Suchindex der PWA gegen die Suchindizes der Apps ----
const { SETTINGS_ITEMS } = await import(pathToFileURL(path.join(webDir, "settings-schema.js")).href);
const iosSettings = fs.readFileSync(path.join(ROOT, "ios/Impala67/Settings/SettingsSearch.swift"), "utf8");
const iosSettingIds = new Set([...iosSettings.matchAll(/id:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]));
const androidSettings = fs.readFileSync(path.join(ROOT, "android/app/src/main/java/org/impala67/app/settings/SettingsSearch.kt"), "utf8");
const androidLabels = new Set([...androidSettings.matchAll(/SettingsItem\(\s*"[^"]*"\s*,\s*"[^"]*"\s*,\s*"([^"]*)"/g)].map((m) => m[1]));
const einstellungen = SETTINGS_ITEMS.map((item) => {
	const over = ids.get("einstellung." + item.id) || {};
	return {
		titel: item.group === item.label ? item.label : `${item.group}: ${item.label}`,
		android: over.android ?? (androidLabels.has(item.label) ? undefined : "❌ nicht im Suchindex"),
		ios: over.ios ?? (iosSettingIds.has(item.id) ? undefined : "❌ nicht im Suchindex"),
	};
});
for (const f of katalog.funktionen) {
	if (f.id.startsWith("einstellung.") && !SETTINGS_ITEMS.some((i) => "einstellung." + i.id === f.id)) errors.push(`${f.id}: keine Einstellung mit dieser ID in settings-schema.js`);
}

// ---- Markdown erzeugen ----
const zelle = (v) => String(v ?? "✅").replace(/\|/g, "\\|");
// Eine Zeile erscheint, solange eine App noch eine Lücke hat (❌, 🟡 oder „prüfen“).
const offen = (f, spalten) => spalten.some(([key]) => /❌|🟡|prüfen/u.test(String(f[key] ?? "")));
let md = "";
for (const b of katalog.bereiche) {
	const spalten = PLATTFORMEN.filter(([key]) => !b.nur || b.nur.includes(key));
	const zeilen = katalog.funktionen.filter((f) => f.bereich === b.id && !f.id.startsWith("einstellung.") && offen(f, spalten));
	const extra = b.id === "einstellungen" ? einstellungen.filter((f) => offen(f, spalten)) : [];
	if (!zeilen.length && !extra.length) continue;
	md += `\n## ${b.titel}\n\n| PWA-Funktion | ${spalten.map(([, n]) => n).join(" | ")} |\n|---|${spalten.map(() => "---|").join("")}\n`;
	for (const f of [...zeilen, ...extra]) md += `| ${zelle(f.titel)} | ${spalten.map(([key]) => zelle(f[key])).join(" | ")} |\n`;
}
const budgets = katalog.funktionen.filter((f) => f.leistung);
if (budgets.length) {
	md += "\n## Leistungsbudgets\n\nGleiches Ziel für alle Versionen; gemessen über den Profiler der jeweiligen App (Messpunkt). „–“ = noch kein Messpunkt.\n\n";
	md += "| Funktion | Budget | PWA | Android | iPad |\n|---|---|---|---|---|\n";
	for (const f of budgets) {
		const l = f.leistung;
		const mp = (v) => (v ? "`" + v + "`" : "–");
		md += `| ${zelle(f.titel)} | ≤ ${l.ms} ms | ${mp(l.pwa)} | ${mp(l.android)} | ${mp(l.ios)} |\n`;
	}
}

const paritaetPath = path.join(ROOT, "docs/PARITAET.md");
const paritaet = fs.readFileSync(paritaetPath, "utf8");
const a = paritaet.indexOf(START);
const e = paritaet.indexOf(END);
if (a < 0 || e < a) {
	errors.push(`docs/PARITAET.md: Marken ${START} … ${END} fehlen`);
} else {
	const neu = paritaet.slice(0, a + START.length) + "\n" + md + "\n" + paritaet.slice(e);
	if (neu !== paritaet) {
		if (WRITE) { fs.writeFileSync(paritaetPath, neu); console.log("docs/PARITAET.md neu geschrieben."); }
		else errors.push("docs/PARITAET.md ist veraltet: npm run check:paritaet -- --schreiben");
	}
}

// ---- Bericht ----
const alle = katalog.funktionen.filter((f) => !f.id.startsWith("einstellung."));
console.log(`Funktionskatalog: ${alle.length} Funktionen, ${SETTINGS_ITEMS.length} Einstellungen, ${budgets.length} Leistungsbudgets.`);
for (const [key, name] of PLATTFORMEN) {
	const relevant = alle.filter((f) => !bereiche.get(f.bereich)?.nur || bereiche.get(f.bereich).nur.includes(key));
	const zaehl = (re) => relevant.filter((f) => re.test(String(f[key] ?? "✅"))).length;
	const fertig = relevant.filter((f) => f[key] === undefined);
	const ohneMarke = fertig.filter((f) => !markiert[key].has(f.id));
	const settingsFehlen = einstellungen.filter((s) => String(s[key] || "").startsWith("❌")).length;
	console.log(`  ${name}: ${fertig.length} erledigt, ${zaehl(/^🟡|^✅ .*🟡/u)} teilweise, ${zaehl(/^❌/u)} fehlen, ${zaehl(/^prüfen/u)} prüfen, ${zaehl(/^⚪|^–/u)} bewusst anders · ${markiert[key].size} markiert, ${ohneMarke.length} erledigte ohne Markierung · Einstellungen: ${settingsFehlen} fehlen`);
	if (DETAILS && ohneMarke.length) console.log("    ohne Markierung: " + ohneMarke.map((f) => f.id).join(", "));
}
if (DETAILS) {
	const anker = katalog.funktionen.flatMap((f) => f.pwa || []);
	const module = fs.readdirSync(webDir).filter((n) => n.endsWith(".js") && !anker.includes(n));
	console.log(`  PWA-Module ohne Katalogeintrag (${module.length}): ${module.join(", ")}`);
	const ohneAnker = alle.filter((f) => !(f.pwa || []).length).map((f) => f.id);
	console.log(`  Funktionen ohne PWA-Fundstelle (${ohneAnker.length}): ${ohneAnker.join(", ")}`);
}
for (const w of warnings) console.warn("Hinweis: " + w);
for (const err of errors) console.error("Fehler: " + err);
process.exit(errors.length ? 1 : 0);
