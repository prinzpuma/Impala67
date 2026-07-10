#!/usr/bin/env node
"use strict";

/**
 * Impala67 - Notion -> lokale Dateien Sync
 * -----------------------------------------
 * Laedt alle Datei-Unterseiten aus der Notion-Seite
 * "Impala67 - Notion-Klon (Local-First Web-App)" und schreibt sie als
 * lokale Dateien in diesen Projektordner.
 *
 * Einrichtung (einmalig):
 * 1. Gehe zu https://www.notion.so/my-integrations und erstelle eine neue
 *    "Internal Integration" (nur Leserechte / "Read content" werden benoetigt).
 * 2. Kopiere den "Internal Integration Secret".
 * 3. Oeffne in Notion die Seite "Impala67 - Notion-Klon (Local-First Web-App)"
 *    -> "..." Menue -> Verbindungen / Connections -> deine Integration hinzufuegen.
 *    (Das gibt automatisch Lesezugriff auf die Seite und ALLE Unterseiten.)
 * 4. Kopiere .env.example zu .env und trage den Secret ein.
 * 5. Doppelklick auf sync_impala67.bat (Windows) bzw. sync_impala67.command (Mac).
 */

const fs = require("fs");
const path = require("path");

// ---- Konfiguration ---------------------------------------------------

// ID der Notion-Seite "Impala67 - Notion-Klon (Local-First Web-App)"
const DEFAULT_PARENT_PAGE_ID = "4bd12878-3ab2-4e60-a045-514024100521";

const NOTION_VERSION = "2022-06-28";
const NOTION_API_BASE = "https://api.notion.com/v1";

// ---- Hilfsfunktionen ---------------------------------------------------

function loadDotEnv() {
	const envPath = path.join(__dirname, ".env");
	if (!fs.existsSync(envPath)) return;
	const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const idx = trimmed.indexOf("=");
		if (idx === -1) continue;
		const key = trimmed.slice(0, idx).trim();
		let value = trimmed.slice(idx + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		if (!process.env[key]) process.env[key] = value;
	}
}

async function notionFetch(url) {
	const res = await fetch(url, {
		headers: {
			Authorization: "Bearer " + process.env.NOTION_TOKEN,
			"Notion-Version": NOTION_VERSION,
			"Content-Type": "application/json",
		},
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error("Notion API " + res.status + " bei " + url + ": " + text);
	}
	return res.json();
}

async function getAllChildren(blockId) {
	const results = [];
	let cursor;
	do {
		const qs = new URLSearchParams({ page_size: "100" });
		if (cursor) qs.set("start_cursor", cursor);
		const url = NOTION_API_BASE + "/blocks/" + blockId + "/children?" + qs.toString();
		const data = await notionFetch(url);
		results.push(...data.results);
		cursor = data.has_more ? data.next_cursor : undefined;
	} while (cursor);
	return results;
}

function richTextToPlain(richText) {
	return (richText || []).map((t) => t.plain_text).join("");
}

async function collectPageText(blockId, depth) {
	depth = depth || 0;
	// Sammelt Code-Block-Inhalte und normalen Text (fuer "impala67/..."-Erkennung)
	// ueber alle Bloecke der Seite, inkl. verschachtelter Bloecke (z.B. Toggles).
	const codeParts = [];
	const textParts = [];
	const blocks = await getAllChildren(blockId);
	for (const block of blocks) {
		const type = block.type;
		const data = block[type];
		if (type === "code") {
			codeParts.push(richTextToPlain(data.rich_text));
		} else if (data && Array.isArray(data.rich_text)) {
			textParts.push(richTextToPlain(data.rich_text));
		}
		if (block.has_children && depth < 4 && type !== "child_page") {
			const nested = await collectPageText(block.id, depth + 1);
			codeParts.push(...nested.code);
			textParts.push(...nested.text);
		}
	}
	return { code: codeParts, text: textParts };
}

function extractFilenameFromTitle(title) {
	// Entfernt ein evtl. Emoji-/Icon-Praefix und nutzt den Seitentitel selbst als
	// Dateiname, falls die Seite bereits exakt so heisst (z.B. "chat-fullscreen.js").
	const match = title.match(/([A-Za-z0-9_.-]+\.[A-Za-z0-9]+)\s*$/);
	return match ? match[1] : null;
}

function parseRelativePath(textParts, title) {
	const joined = textParts.join("\n");

	// 1) Bevorzugt: explizite "Speicherort: ..."-Zeile, unabhaengig vom genauen
	//    Projekt-Praefix (impala67/, notion/, etc. - das Praefix wird eh verworfen).
	const afterLabel = joined.match(/Speicherort:\s*`?([^\s`*"']+)/i);
	if (afterLabel) return afterLabel[1].replace(/^[^/]+\//, "");

	// 2) Fallback: irgendein "<projektname>/pfad"-Hinweis im Text, auch ohne das
	//    Wort "Speicherort" davor.
	const genericPrefixed = joined.match(/(?:impala67|notion)\/([^\s`*"']+)/i);
	if (genericPrefixed) return genericPrefixed[1];

	// 3) Letzter Fallback: kein Pfad-Hinweis im Seitentext gefunden, aber der
	//    Seitentitel ist bereits der Dateiname.
	return title ? extractFilenameFromTitle(title) : null;
}

function shouldSkip(relPath, skipPatterns) {
	return skipPatterns.some((p) => p && relPath.toLowerCase().includes(p.toLowerCase()));
}

function loadFileMap() {
	// Optionale Datei file-map.json neben diesem Skript: erlaubt es, fuer
	// einzelne Dateien einen abweichenden lokalen Pfad zu erzwingen, z.B.
	// wenn dein Quellcode in Unterordnern liegt (Notion kennt keine Ordner).
	// Beispiel-Inhalt:
	// {
	//   "boot.js": "web/boot.js",
	//   "styles.css": "web/styles.css"
	// }
	const mapPath = path.join(__dirname, "file-map.json");
	if (!fs.existsSync(mapPath)) return {};
	try {
		return JSON.parse(fs.readFileSync(mapPath, "utf8"));
	} catch (err) {
		console.error("Warnung: file-map.json konnte nicht gelesen werden: " + err.message);
		return {};
	}
}

// ---- Hauptlogik ---------------------------------------------------

async function main() {
	if (typeof fetch !== "function") {
		console.error(
			"Dieses Skript benoetigt Node.js 18 oder neuer (globales fetch). Bitte Node aktualisieren: https://nodejs.org",
		);
		process.exitCode = 1;
		return;
	}

	loadDotEnv();

	if (!process.env.NOTION_TOKEN) {
		console.error(
			"Fehler: NOTION_TOKEN fehlt. Kopiere .env.example zu .env und trage deinen Notion-Integration-Secret ein.",
		);
		process.exitCode = 1;
		return;
	}

	const PARENT_PAGE_ID = process.env.IMPALA_PARENT_PAGE_ID || DEFAULT_PARENT_PAGE_ID;
	const OUTPUT_DIR = path.resolve(__dirname, process.env.IMPALA_OUTPUT_DIR || ".");
	const SKIP_PATTERNS = (process.env.IMPALA_SKIP_PATTERNS || "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);

	// Standard: es werden NUR bereits vorhandene lokale Dateien ersetzt.
	// Es werden keine neuen Dateien/Ordner angelegt, damit der Projektordner
	// nicht mit Dateien vollgemuellt wird, die dort vorher nicht existierten.
	// Setze IMPALA_CREATE_NEW=true in der .env, um auch neue Dateien anzulegen.
	const CREATE_NEW = process.env.IMPALA_CREATE_NEW === "true";

	const FILE_MAP = loadFileMap();

	console.log("Ziel-Ordner: " + OUTPUT_DIR);
	console.log("Lade Datei-Unterseiten aus Notion...\n");

	const children = await getAllChildren(PARENT_PAGE_ID);
	const filePages = children.filter((b) => b.type === "child_page");

	let written = 0;
	let skipped = 0;

	for (const page of filePages) {
		const title = page.child_page.title;
		const result = await collectPageText(page.id);
		const code = result.code;
		const text = result.text;
		const relPath = parseRelativePath(text, title);

		if (!relPath || code.length === 0) {
			console.log("  - uebersprungen (keine Datei-Zuordnung/Code): " + title);
			skipped++;
			continue;
		}

		let cleanedRelPath = relPath;

		// Ueberschreibt den Pfad, falls in file-map.json ein Eintrag existiert
		// (z.B. um eine Unterordner-Struktur wie "web/boot.js" abzubilden).
		if (FILE_MAP[cleanedRelPath]) {
			cleanedRelPath = FILE_MAP[cleanedRelPath];
		}

		if (shouldSkip(cleanedRelPath, SKIP_PATTERNS)) {
			console.log("  - uebersprungen (Skip-Muster): " + cleanedRelPath);
			skipped++;
			continue;
		}

		const outPath = path.join(OUTPUT_DIR, cleanedRelPath);
		const existsLocally = fs.existsSync(outPath);

		if (!existsLocally && !CREATE_NEW) {
			console.log("  - uebersprungen (lokal nicht vorhanden, wird nicht neu angelegt): " + cleanedRelPath);
			skipped++;
			continue;
		}

		const content = code.join("\n\n");
		fs.mkdirSync(path.dirname(outPath), { recursive: true });
		fs.writeFileSync(outPath, content, "utf8");
		console.log("  " + (existsLocally ? "OK (ersetzt)" : "OK (neu angelegt)") + "  " + cleanedRelPath);
		written++;
	}

	console.log("\nFertig: " + written + " Datei(en) geschrieben, " + skipped + " Seite(n) uebersprungen.");
}

main().catch((err) => {
	console.error("Sync fehlgeschlagen:", err.message);
	process.exitCode = 1;
});
