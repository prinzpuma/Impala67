// bench-scan.mjs — Benchmark der JS-Version von heft-scan zum Vergleich mit Rust

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
	detectSizes, toGray, detectQuadPixels
} from "../../web/heft-scan-detect.js";

import {
	warpPixels, downscalePixels
} from "../../web/heft-scan-pixels.js";

import { applyScanModePixels } from "../../web/heft-scan-enhance.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const goldenDir = path.join(here, "../impala-scan/tests/golden");

const cases = JSON.parse(fs.readFileSync(path.join(goldenDir, "cases.json"), "utf8"));
const gzBytes = fs.readFileSync(path.join(goldenDir, "doc_medium.bin.gz"));
const rawData = zlib.gunzipSync(gzBytes);

const medImg = {
	width: cases.docMedium.width,
	height: cases.docMedium.height,
	data: new Uint8ClampedArray(rawData),
};
const quad = cases.docMedium.quad;

function median(arr) {
	const s = arr.slice().sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)];
}

const runs = 20;

// 1. Detect
const detectTimes = [];
for (let i = 0; i < runs; i++) {
	const t0 = performance.now();
	const sizes = detectSizes(medImg.width, medImg.height);
	const analysis = downscalePixels(medImg, sizes.dw, sizes.dh);
	const refineSrc = downscalePixels(medImg, sizes.gw, sizes.gh);
	const grayRefine = toGray(refineSrc);
	detectQuadPixels(analysis, medImg.width, medImg.height, { gray: grayRefine, gw: sizes.gw, gh: sizes.gh });
	detectTimes.push(performance.now() - t0);
}

// 2. Warp
const warpTimes = [];
for (let i = 0; i < runs; i++) {
	const t0 = performance.now();
	warpPixels(medImg, quad);
	warpTimes.push(performance.now() - t0);
}

// 3. Enhance
const warped = warpPixels(medImg, quad);
const colorTimes = [];
const bwTimes = [];

for (let i = 0; i < runs; i++) {
	const cloned = { width: warped.width, height: warped.height, data: new Uint8ClampedArray(warped.data) };
	const t0 = performance.now();
	applyScanModePixels(cloned, "color");
	colorTimes.push(performance.now() - t0);

	const cloned2 = { width: warped.width, height: warped.height, data: new Uint8ClampedArray(warped.data) };
	const t1 = performance.now();
	applyScanModePixels(cloned2, "bw");
	bwTimes.push(performance.now() - t1);
}

console.log("--- Impala Scan JS Benchmark (Node V8) ---");
console.log(`Dokumenterkennung (Detect): ${median(detectTimes).toFixed(2)} ms`);
console.log(`Entzerrung (Warp):          ${median(warpTimes).toFixed(2)} ms`);
console.log(`Aufbereitung Farbe:         ${median(colorTimes).toFixed(2)} ms`);
console.log(`Aufbereitung S/W:           ${median(bwTimes).toFixed(2)} ms`);
