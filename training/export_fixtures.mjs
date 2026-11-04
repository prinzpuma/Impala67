#!/usr/bin/env node
// export_fixtures.mjs — Holt echte Workspace-Daten NUR LESEND über die MCP-Live-Bridge
// (Relay auf ws://127.0.0.1:8765/relay) und legt sie als Benchmark-Fixtures ab:
//   training/data/fixtures/workspace.json   (Seitenliste, Seiteninhalte, Karten)
//   training/data/fixtures/hefte/*.png       (Heftseiten als Bild) + hefte.json (Metadaten, App-Lesung)
// Aufruf: node training/export_fixtures.mjs [--pages 30] [--heft-pages 3]
// Voraussetzung: MCP-Server läuft (Claude-Sitzung) und die App ist im Browser offen.

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const OUT = join(dirname(fileURLToPath(import.meta.url)), "data", "fixtures");
const READ_ONLY = new Set(["impala_list_pages", "impala_get_page", "impala_list_flashcards", "impala_heft_page_image", "impala_search"]);
const arg = (name, def) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > 0 ? Number(process.argv[i + 1]) : def;
};
const MAX_PAGES = arg("pages", 40);
const HEFT_PAGES = arg("heft-pages", 3);

const ws = new WebSocket("ws://127.0.0.1:8765/relay", { origin: "http://localhost" });
const pending = new Map();
let seq = 1;

function call(tool, args = {}) {
	if (!READ_ONLY.has(tool)) throw new Error(`Nur lesende Werkzeuge erlaubt: ${tool}`);
	const relayCallId = `fx${seq++}`;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => { pending.delete(relayCallId); reject(new Error(`Timeout: ${tool}`)); }, 60000);
		pending.set(relayCallId, (res) => { clearTimeout(timer); res?.error ? reject(new Error(`${tool}: ${res.error}`)) : resolve(res); });
		ws.send(JSON.stringify({ relayCallId, tool, args }));
	});
}

ws.on("message", (raw) => {
	const data = JSON.parse(raw);
	const done = data?.relayCallId && pending.get(data.relayCallId);
	if (done) { pending.delete(data.relayCallId); done(data.result); }
});

ws.on("open", () => setTimeout(() => main().catch((e) => { console.error(e.message); process.exit(1); }), 300));
ws.on("error", (e) => { console.error("Bridge nicht erreichbar:", e.message); process.exit(1); });

async function main() {
	mkdirSync(join(OUT, "hefte"), { recursive: true });
	const list = await call("impala_list_pages", { limit: 500 });
	const all = list.pages;
	const notion = all.filter((p) => p.kind === "notion" && !p.id.startsWith("conflictpg-"));
	const hefte = all.filter((p) => p.kind === "heft");

	const pages = [];
	for (const p of notion.slice(0, MAX_PAGES)) {
		const full = await call("impala_get_page", { id: p.id });
		pages.push({ ...p, content: full.content ?? full.text ?? "" });
		process.stdout.write(".");
	}
	const cards = (await call("impala_list_flashcards", { limit: 500 })).cards ?? [];
	writeFileSync(join(OUT, "workspace.json"), JSON.stringify({ exported: new Date().toISOString(), pageList: all, pages, cards }, null, 1));
	console.log(`\n${all.length} Seiten gelistet, ${pages.length} Inhalte, ${cards.length} Karten.`);

	const heftMeta = [];
	for (const h of hefte) {
		for (let i = 0; i < HEFT_PAGES; i++) {
			let res;
			try { res = await call("impala_heft_page_image", { page_id: h.id, page_index: i }); } catch (e) { console.log(`  ${h.title} #${i}: ${e.message}`); break; }
			if (res.inkStrokes) {
				const file = `${h.id}_${i}.png`;
				writeFileSync(join(OUT, "hefte", file), Buffer.from(res.image.split(",")[1], "base64"));
				heftMeta.push({ id: h.id, title: h.title, subject: h.subject, pageIndex: i, pageCount: res.pageCount, inkStrokes: res.inkStrokes, appReading: res.appReading, file });
			}
			if (i + 1 >= res.pageCount) break;
		}
		process.stdout.write("h");
	}
	writeFileSync(join(OUT, "hefte.json"), JSON.stringify(heftMeta, null, 1));
	console.log(`\n${heftMeta.length} Heftseiten mit Tinte exportiert -> ${OUT}`);
	ws.close();
}
