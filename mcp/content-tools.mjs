// Inhalts-Werkzeuge des MCP-Servers = die flachen Werkzeuge der App-KI (eine Quelle:
// core/impala-ai/src/tool_defs_flat.json). Ausgeführt werden sie in der App (web/mcp-bridge.js
// → TOOLS.runFlat), mit denselben Prüfungen wie im KI-Chat. Name mit Präfix impala_.
import { readFileSync } from "node:fs";

const FLAT = JSON.parse(readFileSync(new URL("../core/impala-ai/src/tool_defs_flat.json", import.meta.url), "utf8"));
// Nur im App-Chat sinnvoll (Rückfrage-Knöpfe, Rechner, Heftbild mit eigenem MCP-Werkzeug).
const APP_ONLY = new Set(["ask_choice", "calculate", "view_heft_page"]);

export const CONTENT_TOOLS = FLAT.map((d) => d.function).filter((f) => !APP_ONLY.has(f.name)).map((f) => ({
	name: "impala_" + f.name,
	description: f.description,
	inputSchema: f.parameters,
}));

// Schreibende Inhalts-Werkzeuge (Timeout-Hinweis im Server, Simulation im Benchmark).
export const CONTENT_WRITE = new Set(CONTENT_TOOLS.map((t) => t.name).filter((n) => /^impala_(create_|edit_|organize_|write_)/.test(n)));
