// Versionsnummer aus den Release-Tags (vX.Y.Z) – die einzige Quelle für PWA, Android-Release und iPad-App.
// package.json wird im Repository nicht hochgezählt; ohne diese Quelle liefen PWA-Zwischenstände unter den
// Releases her (2.2.88-dev nach v2.2.123).
//
//   node version-from-tags.mjs dev [N]            HEAD trägt einen Release-Tag: genau diese Version,
//                                                 sonst nächster Patch als Vorabversion (2.2.124-dev.N)
//   node version-from-tags.mjs next patch|minor|major   nächste freie Release-Version
//   node version-from-tags.mjs app                nur Ziffern (iPad CFBundleShortVersionString):
//                                                 Release-Tag an HEAD bzw. nächster Patch
//
// Braucht alle Tags im Checkout (actions/checkout mit fetch-depth: 0).

import { execSync } from "node:child_process";

const git = (args) => execSync(`git ${args}`, { encoding: "utf8" }).trim();
const parse = (tag) => tag.slice(1).split(".").map(Number);
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const releaseTags = (list) => list.split("\n").map((t) => t.trim()).filter((t) => /^v\d+\.\d+\.\d+$/.test(t));

const all = releaseTags(git("tag -l v*")).map(parse).sort(cmp);
const latest = all.at(-1) || [0, 0, 0];
const atHead = releaseTags(git("tag --points-at HEAD")).map(parse).sort(cmp).at(-1);
const str = (v) => v.join(".");
const nextPatch = [latest[0], latest[1], latest[2] + 1];

const [mode, arg] = process.argv.slice(2);
if (mode === "dev") {
  const n = arg || "0";
  console.log(atHead ? str(atHead) : `${str(nextPatch)}-dev.${n}`);
} else if (mode === "app") {
  console.log(str(atHead || nextPatch));
} else if (mode === "next") {
  const [ma, mi, pa] = latest;
  const v = arg === "major" ? [ma + 1, 0, 0] : arg === "minor" ? [ma, mi + 1, 0] : [ma, mi, pa + 1];
  const taken = new Set(all.map(str));
  while (taken.has(str(v))) v[2]++;
  console.log(str(v));
} else {
  console.error("Nutzung: version-from-tags.mjs dev [N] | app | next patch|minor|major");
  process.exit(1);
}
