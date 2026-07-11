// Setzt die Versionsnummer in allen relevanten Dateien.
// Wird nur im CI-Workflow ausgefuehrt und NICHT zurueck ins Repository committet.
//
// Nutzung: node .github/scripts/set-version.mjs 0.2.35

import fs from "node:fs";

const NEW = process.argv[2];

if (!NEW || !/^\d+\.\d+\.\d+$/.test(NEW)) {
  console.error("Nutzung: node set-version.mjs <version>, z.B. 0.2.35");
  process.exit(1);
}

function writeJson(path, mutate) {
  const json = JSON.parse(fs.readFileSync(path, "utf8"));
  mutate(json);
  fs.writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
}

writeJson("./src-tauri/tauri.conf.json", (json) => {
  json.version = NEW;
});

writeJson("./package.json", (json) => {
  json.version = NEW;
});

{
  const path = "./web/version.json";
  let json = { name: "Impala67" };

  if (fs.existsSync(path)) {
    json = JSON.parse(fs.readFileSync(path, "utf8"));
  }

  json.version = NEW;
  json.updated = new Date().toISOString().slice(0, 10);

  fs.writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
}

{
  const path = "./web/updater.js";
  let source = fs.readFileSync(path, "utf8");

  if (!/const BUILD_VERSION = "[^"]+"/.test(source)) {
    console.error("BUILD_VERSION fehlt in web/updater.js");
    process.exit(1);
  }

  source = source.replace(
    /const BUILD_VERSION = "[^"]+"/,
    `const BUILD_VERSION = "${NEW}"`
  );

  fs.writeFileSync(path, source);
}

console.log(`Version ${NEW} gesetzt.`);