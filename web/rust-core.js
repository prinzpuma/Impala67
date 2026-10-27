"use strict";

// Der Rust-Kern (web/core/, gebaut mit npm run build:core), synchron nutzbar: Wer dieses Modul
// importiert, wartet beim Laden (top-level await), bis die WASM-Datei bereit ist. Alle Bereiche
// teilen sich die eine Instanz. In Node (Tests, Werkzeuge) kommt die WASM-Datei von der Platte.
import init, * as CORE from "./core/impala_core.js";

const WASM_URL = new URL("./core/impala_core_bg.wasm", import.meta.url);
const inNode = typeof process !== "undefined" && !!process.versions?.node;
await init({ module_or_path: inNode ? await (await import("node:fs/promises")).readFile(WASM_URL) : WASM_URL });

export { CORE };
