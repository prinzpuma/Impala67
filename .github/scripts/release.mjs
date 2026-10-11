// release.mjs — PWA veröffentlichen: Version erhöhen, alles committen, main pushen.
// Aufruf: npm run release [-- "Commit-Nachricht"]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function run(cmd, args, fehler) {
	try {
		return execFileSync(cmd, args, { cwd: ROOT, stdio: ["inherit", "pipe", "inherit"], encoding: "utf8" }).trim();
	} catch {
		console.error(`FEHLER: ${fehler}`);
		process.exit(1);
	}
}

const branch = run("git", ["branch", "--show-current"], "Git wurde nicht gefunden.");
if (branch !== "main") {
	console.error(`FEHLER: Nur der Branch main wird veröffentlicht (aktuell: ${branch || "unbekannt"}).`);
	process.exit(1);
}

console.log("Version automatisch erhöhen...");
console.log(run(process.execPath, [".github/scripts/bump-version.mjs"], "Versionserhöhung fehlgeschlagen."));
const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const message = process.argv[2] || `release: v${version}`;

run("git", ["add", "-A"], "Dateien konnten nicht vorgemerkt werden.");
console.log(`Commit: ${message}`);
run("git", ["commit", "-m", message], "Commit fehlgeschlagen.");
console.log("Lade den Commit nach GitHub hoch ...");
run("git", ["push", "origin", "main"], "Push auf main fehlgeschlagen.");

console.log(`\nErfolgreich! v${version} wurde veröffentlicht. GitHub Pages aktualisiert jetzt die PWA.`);
