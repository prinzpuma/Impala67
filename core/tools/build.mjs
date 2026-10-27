// Baut die WASM-Hülle des Kerns nach core/target/wasm/ (nur für Messungen; die PWA nutzt den
// Kern noch nicht). Plattformneutral: node core/tools/build.mjs
// Voraussetzungen: rustup target add wasm32-unknown-unknown und wasm-bindgen-cli in der Version
// aus core/impala-wasm/Cargo.toml (Befehle siehe Fehlermeldungen).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OUT = path.join(CORE, "target/wasm");

const run = (cmd, args, hint) => {
	const res = spawnSync(cmd, args, { cwd: CORE, stdio: "inherit", shell: false });
	if (res.error || res.status !== 0) {
		console.error(`\n${cmd} fehlgeschlagen.${hint ? " " + hint : ""}`);
		process.exit(1);
	}
};

const bindgenVersion = fs.readFileSync(path.join(CORE, "impala-wasm/Cargo.toml"), "utf8").match(/wasm-bindgen = "=([^"]+)"/)[1];
run("cargo", ["build", "--release", "--target", "wasm32-unknown-unknown", "-p", "impala-wasm"],
	"Ziel fehlt? rustup target add wasm32-unknown-unknown");
fs.rmSync(OUT, { recursive: true, force: true });
run("wasm-bindgen", ["--target", "web", "--no-typescript", "--out-dir", OUT, "--out-name", "impala_core",
	path.join(CORE, "target/wasm32-unknown-unknown/release/impala_wasm.wasm")],
	`Installieren: cargo install wasm-bindgen-cli --version ${bindgenVersion} --locked`);
for (const f of fs.readdirSync(OUT)) console.log(`core/target/wasm/${f}: ${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(1)} KB`);
