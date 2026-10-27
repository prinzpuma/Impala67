// Hashes von Rust-Quellen und WASM-Ausgabe (gemeinsam für build.mjs und check:core).
// Textdateien werden mit LF gehasht, damit Windows-Checkouts (CRLF) denselben Stempel ergeben.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OUT = path.resolve(CORE, "../web/core");
export const STAMP = path.join(CORE, "wasm-build.json");

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const text = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

function walk(dir, out = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(full, out);
		else out.push(full);
	}
	return out;
}

// Alles, was die .wasm beeinflusst: Manifeste, Lockfile, Quellcode (keine Tests, keine Tools).
function sourceFiles() {
	const crates = fs.readdirSync(CORE).filter((d) => fs.existsSync(path.join(CORE, d, "Cargo.toml")));
	return ["Cargo.toml", "Cargo.lock", ...crates.flatMap((c) => [
		path.join(c, "Cargo.toml"),
		...walk(path.join(CORE, c, "src")).map((f) => path.relative(CORE, f)),
	])].map((f) => f.split(path.sep).join("/")).sort();
}

export function buildStamp() {
	const sources = crypto.createHash("sha256");
	for (const f of sourceFiles()) sources.update(f + "\0" + text(path.join(CORE, f)) + "\0");
	const output = {};
	for (const f of fs.existsSync(OUT) ? fs.readdirSync(OUT).sort() : []) {
		const file = path.join(OUT, f);
		output[f] = sha(f.endsWith(".wasm") ? fs.readFileSync(file) : text(file));
	}
	return { sources: sources.digest("hex"), output };
}
