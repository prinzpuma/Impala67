import fs from "node:fs";

const expected = process.argv[2] || JSON.parse(fs.readFileSync("web/version.json", "utf8")).version;
if (!/^\d+\.\d+\.\d+$/.test(expected)) {
	throw new Error(`Invalid version: ${expected}`);
}

const metadata = JSON.parse(fs.readFileSync("web/version.json", "utf8"));
const updater = fs.readFileSync("web/updater.js", "utf8");
const worker = fs.readFileSync("web/service-worker.js", "utf8");
const build = updater.match(/const BUILD_VERSION = "([^"]+)"/u)?.[1];
const cache = worker.match(/const CACHE = "([^"]+)"/u)?.[1];

if (metadata.version !== expected || build !== expected || cache !== `impala67-v${expected}`) {
	throw new Error(`Version files are out of sync: version.json=${metadata.version}, updater.js=${build}, service-worker.js=${cache}, expected=${expected}`);
}

console.log(`Version files in sync: ${expected}`);
