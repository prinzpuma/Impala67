// Prüft, ob die committete WASM-Ausgabe (web/core/) zum Rust-Quellcode (core/) passt.
// Braucht kein Rust: verglichen werden nur die Hashes aus core/wasm-build.json.
import fs from "node:fs";
import { buildStamp, STAMP } from "../../core/tools/stamp.mjs";

const saved = JSON.parse(fs.readFileSync(STAMP, "utf8"));
const now = buildStamp();
if (saved.sources !== now.sources) {
	throw new Error("Rust-Kern geändert, WASM nicht neu gebaut: npm run build:core ausführen und web/core/ committen.");
}
if (JSON.stringify(saved.output) !== JSON.stringify(now.output)) {
	throw new Error("web/core/ passt nicht zum Stempel: nicht von Hand ändern, npm run build:core ausführen.");
}
console.log("WASM-Kern passt zum Rust-Quellcode.");
