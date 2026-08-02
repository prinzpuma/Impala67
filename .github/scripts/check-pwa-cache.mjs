// Prüft, ob jedes statisch importierte App-Modul im Offline-Cache liegt.
import fs from "node:fs";
import path from "node:path";

const web = path.resolve("web");
const worker = fs.readFileSync(path.join(web, "service-worker.js"), "utf8");
const block = worker.match(/const APP_FILES = \[([\s\S]*?)\];/);
if (!block) throw new Error("APP_FILES fehlt in service-worker.js");

const cached = new Set([...block[1].matchAll(/["']\.\/([^"']+)["']/g)].map((m) => m[1]));
const missing = new Set();
for (const file of fs.readdirSync(web).filter((name) => name.endsWith(".js"))) {
  const source = fs.readFileSync(path.join(web, file), "utf8");
  for (const match of source.matchAll(/\bimport\s+(?:[^"'()]*?\s+from\s+)?["']\.\/([^"']+\.js)["']/g)) {
    if (!cached.has(match[1])) missing.add(match[1]);
  }
}

if (missing.size) throw new Error("Offline-Cache fehlt für: " + [...missing].sort().join(", "));
console.log("Offline-Cache enthält alle statisch importierten Module.");
