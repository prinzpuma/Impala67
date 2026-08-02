// Setzt die Versionsnummer in den PWA-Dateien.
// Wird nur im CI-Workflow ausgeführt und nicht zurück ins Repository committet.

import fs from "node:fs";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Nutzung: node set-version.mjs <version>, z.B. 0.3.0");
  process.exit(1);
}

const versionPath = "./web/version.json";
const metadata = JSON.parse(fs.readFileSync(versionPath, "utf8"));
metadata.version = version;
metadata.updated = new Date().toISOString().slice(0, 10);
fs.writeFileSync(versionPath, JSON.stringify(metadata, null, 2) + "\n");

const updaterPath = "./web/updater.js";
let updater = fs.readFileSync(updaterPath, "utf8");
if (!/const BUILD_VERSION = "[^"]+"/.test(updater)) {
  console.error("BUILD_VERSION fehlt in web/updater.js");
  process.exit(1);
}
updater = updater.replace(/const BUILD_VERSION = "[^"]+"/, `const BUILD_VERSION = "${version}"`);
fs.writeFileSync(updaterPath, updater);

console.log(`PWA-Version ${version} gesetzt.`);
