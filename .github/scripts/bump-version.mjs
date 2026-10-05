// Inkrementiert die Patch-Version synchron in allen Versionsdateien (PWA + Service-Worker + Android).
import fs from "node:fs";

const pkgPath = "./package.json";
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const [major, minor, patch] = (pkg.version || "2.2.0").split(".").map(Number);
const newVersion = `${major}.${minor}.${patch + 1}`;

pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

const versionPath = "./web/version.json";
const metadata = JSON.parse(fs.readFileSync(versionPath, "utf8"));
metadata.version = newVersion;
metadata.updated = new Date().toISOString().slice(0, 10);
fs.writeFileSync(versionPath, JSON.stringify(metadata, null, 2) + "\n");

const updaterPath = "./web/updater.js";
let updater = fs.readFileSync(updaterPath, "utf8");
updater = updater.replace(/const BUILD_VERSION = "[^"]+"/, `const BUILD_VERSION = "${newVersion}"`);
fs.writeFileSync(updaterPath, updater);

const workerPath = "./web/service-worker.js";
let worker = fs.readFileSync(workerPath, "utf8");
worker = worker.replace(/const CACHE = "impala67-v[^"]+"/, `const CACHE = "impala67-v${newVersion}"`);
fs.writeFileSync(workerPath, worker);

const gradlePath = "./android/app/build.gradle";
if (fs.existsSync(gradlePath)) {
  let gradle = fs.readFileSync(gradlePath, "utf8");
  const versionCode = major * 100000 + minor * 1000 + (patch + 1);
  gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
  gradle = gradle.replace(/versionName\s+"[^"]+"/, `versionName "${newVersion}"`);
  fs.writeFileSync(gradlePath, gradle);
}

console.log(`Version erhöht: ${major}.${minor}.${patch} -> ${newVersion}`);
