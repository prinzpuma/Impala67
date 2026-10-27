// Baut den Rust-Kern als WASM nach web/core/ (npm run build:core). Plattformneutral.
// Voraussetzungen: Rust mit Ziel wasm32-unknown-unknown und wasm-bindgen-cli in der Version
// aus core/impala-wasm/Cargo.toml (Befehle siehe Fehlermeldungen). Kein wasm-opt: bringt hier
// nur ~1 KB gzip und wäre ein weiteres Werkzeug.
// --weak-refs: Kern-Objekte, die JS nicht ausdrücklich freigibt, räumt der Garbage Collector weg.
// Die Ausgabe wird committet; core/wasm-build.json hält Quell- und Ausgabe-Hashes fest,
// damit `npm run check:core` (Teil von verify) einen vergessenen Neubau bemerkt.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildStamp, CORE, OUT, STAMP } from "./stamp.mjs";

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
run("wasm-bindgen", ["--target", "web", "--no-typescript", "--weak-refs", "--out-dir", OUT, "--out-name", "impala_core",
	path.join(CORE, "target/wasm32-unknown-unknown/release/impala_wasm.wasm")],
	`Installieren: cargo install wasm-bindgen-cli --version ${bindgenVersion} --locked`);

fs.writeFileSync(STAMP, JSON.stringify(buildStamp(), null, "\t") + "\n");
for (const f of fs.readdirSync(OUT)) console.log(`web/core/${f}: ${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(1)} KB`);
console.log("Stempel: core/wasm-build.json");
