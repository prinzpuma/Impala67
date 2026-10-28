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

// Crates, die in die .wasm eingehen: impala-wasm und alle seine Pfad-Abhängigkeiten.
// Nur-native Crates (impala-ffi …) ändern den Stempel nicht.
function wasmCrates() {
	const seen = new Set();
	const todo = ["impala-wasm"];
	while (todo.length) {
		const c = todo.pop();
		if (seen.has(c)) continue;
		seen.add(c);
		for (const m of text(path.join(CORE, c, "Cargo.toml")).matchAll(/path\s*=\s*"\.\.\/([^"]+)"/g)) todo.push(m[1]);
	}
	return [...seen];
}

// Die Pakete aus Cargo.lock, die impala-wasm (transitiv) nutzt, als „name version quelle prüfsumme
// -> abhängigkeiten“. Abhängigkeiten aufgelöst, weil Cargo „winnow“ zu „winnow 0.7.13“ umschreibt,
// sobald ein anderes Crate eine zweite Version mitbringt.
function wasmLock() {
	const blocks = text(path.join(CORE, "Cargo.lock")).split("[[package]]").slice(1).map((b) => {
		const field = (k) => (b.match(new RegExp(`^${k} = "([^"]*)"`, "m")) || [])[1] || "";
		const deps = (b.match(/^dependencies = \[([^\]]*)\]/m) || [])[1] || "";
		return {
			name: field("name"), version: field("version"), source: field("source"), checksum: field("checksum"),
			deps: [...deps.matchAll(/"([^"]+)"/g)].map((m) => m[1].split(" ")),
		};
	});
	const find = ([name, version]) => blocks.find((p) => p.name === name && (!version || p.version === version));
	const seen = new Map();
	const todo = [find(["impala-wasm"])];
	while (todo.length) {
		const p = todo.pop();
		if (!p || seen.has(p)) continue;
		const deps = p.deps.map(find);
		seen.set(p, deps.map((d) => d ? `${d.name} ${d.version}` : "?").sort().join(","));
		todo.push(...deps);
	}
	return [...seen].map(([p, deps]) => `${p.name} ${p.version} ${p.source} ${p.checksum} -> ${deps}`).sort().join("\n");
}

// Alles, was die .wasm beeinflusst: Workspace-Einstellungen (ohne Mitgliederliste), benutzte Pakete
// aus dem Lockfile, Manifeste und Quellcode der beteiligten Crates (keine Tests, keine Tools).
export function buildStamp() {
	const sources = crypto.createHash("sha256");
	const workspace = text(path.join(CORE, "Cargo.toml")).replace(/^members = \[[^\]]*\]\n/m, "").replace(/^#.*\n/gm, "");
	sources.update("Cargo.toml\0" + workspace + "\0Cargo.lock\0" + wasmLock() + "\0");
	const files = wasmCrates().flatMap((c) => [
		path.join(c, "Cargo.toml"),
		...walk(path.join(CORE, c, "src")).map((f) => path.relative(CORE, f)),
	]).map((f) => f.split(path.sep).join("/")).sort();
	for (const f of files) sources.update(f + "\0" + text(path.join(CORE, f)) + "\0");
	const output = {};
	for (const f of fs.existsSync(OUT) ? fs.readdirSync(OUT).sort() : []) {
		const file = path.join(OUT, f);
		output[f] = sha(f.endsWith(".wasm") ? fs.readFileSync(file) : text(file));
	}
	return { sources: sources.digest("hex"), output };
}
