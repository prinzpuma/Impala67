// Setzt die Versionsnummer in den PWA-Dateien.
// Wird nur im CI-Workflow ausgeführt und nicht zurück ins Repository committet.

import fs from "node:fs";
import crypto from "node:crypto";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Nutzung: node set-version.mjs <version>, z.B. 0.3.0");
  process.exit(1);
}

const pkgPath = "./package.json";
if (fs.existsSync(pkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  pkg.version = version;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
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

const workerPath = "./web/service-worker.js";
let worker = fs.readFileSync(workerPath, "utf8");
if (!/const CACHE = "impala67-v[^"]+"/.test(worker)) {
  console.error("CACHE fehlt in web/service-worker.js");
  process.exit(1);
}
worker = worker.replace(/const CACHE = "impala67-v[^"]+"/, `const CACHE = "impala67-v${version}"`);
fs.writeFileSync(workerPath, worker);

// Handschrift-Modellversion = Prüfsumme der Modelldatei: ändert sich genau dann, wenn ein neues
// Modell eingecheckt wird (neuer Cache im Worker, einmalige Neuerkennung aller Heftseiten).
const modelPath = "./web/handwriting-model.onnx";
const modelVersionPath = "./web/handwriting-model-version.js";
const modelHash = crypto.createHash("sha256").update(fs.readFileSync(modelPath)).digest("hex").slice(0, 12);
let modelVersion = fs.readFileSync(modelVersionPath, "utf8");
if (!/export const HANDWRITING_MODEL_VERSION = "[^"]+"/.test(modelVersion)) {
  console.error("HANDWRITING_MODEL_VERSION fehlt in web/handwriting-model-version.js");
  process.exit(1);
}
modelVersion = modelVersion.replace(/export const HANDWRITING_MODEL_VERSION = "[^"]+"/, `export const HANDWRITING_MODEL_VERSION = "${modelHash}"`);
fs.writeFileSync(modelVersionPath, modelVersion);
console.log(`Handschrift-Modellversion gesetzt: ${modelHash}.`);

const gradlePath = "./android/app/build.gradle";
if (fs.existsSync(gradlePath)) {
  let gradle = fs.readFileSync(gradlePath, "utf8");
  const [major, minor, patch] = version.split(".").map(Number);
  const versionCode = major * 100000 + minor * 1000 + patch;
  gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
  gradle = gradle.replace(/versionName\s+"[^"]+"/, `versionName "${version}"`);
  fs.writeFileSync(gradlePath, gradle);
  console.log(`Android build.gradle gesetzt: versionCode ${versionCode}, versionName "${version}".`);
}

console.log(`PWA-Version ${version} gesetzt.`);
