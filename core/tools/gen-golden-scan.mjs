// gen-golden-scan.mjs — Erzeugt golden/cases.json für `cargo test -p impala-scan`
// aus der JS-Implementierung in web/heft-scan-*.js.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	dist2d, quadArea, isConvex, toGray, detectSizes, fullQuadPixels,
	refineQuadPixels, detectQuadPixels
} from "../../web/heft-scan-detect.js";

import {
	warpPixels, downscalePixels, rotatePixels, lumStatsPixels, scanQualityPixels
} from "../../web/heft-scan-pixels.js";

import { applyScanModePixels } from "../../web/heft-scan-enhance.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "../impala-scan/tests/golden");
fs.mkdirSync(outDir, { recursive: true });

// PRNG für deterministische Testdaten
function prng(seed) {
	let s = seed % 2147483647;
	if (s <= 0) s += 2147483646;
	return () => {
		s = (s * 16807) % 2147483647;
		return (s - 1) / 2147483646;
	};
}

// 1. Geometrie
const geomCases = [];
const rand = prng(42);
for (let i = 0; i < 10; i++) {
	const q = [
		[Math.round(rand() * 100), Math.round(rand() * 100)],
		[Math.round(150 + rand() * 100), Math.round(rand() * 100)],
		[Math.round(150 + rand() * 100), Math.round(150 + rand() * 100)],
		[Math.round(rand() * 100), Math.round(150 + rand() * 100)],
	];
	geomCases.push({
		quad: q,
		area: quadArea(q),
		convex: isConvex(q),
	});
}

// 2. Synthetisches Dokumentenbild (helles Blatt auf dunklem Tisch mit Gradient und Schrift)
function createSyntheticDocument(w, h, seed) {
	const r = prng(seed);
	const data = new Uint8ClampedArray(w * h * 4);

	// Dunkler Tisch-Hintergrund (Holz/Grau mit Körnung)
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const idx = (y * w + x) * 4;
			const grain = Math.round((r() - 0.5) * 8);
			data[idx] = Math.max(0, Math.min(255, 45 + grain));
			data[idx + 1] = Math.max(0, Math.min(255, 38 + grain));
			data[idx + 2] = Math.max(0, Math.min(255, 32 + grain));
			data[idx + 3] = 255;
		}
	}

	// Trapezförmiges Blatt Papier (z. B. leicht gedreht)
	const q = [
		[Math.round(w * 0.18), Math.round(h * 0.15)],
		[Math.round(w * 0.82), Math.round(h * 0.12)],
		[Math.round(w * 0.86), Math.round(h * 0.88)],
		[Math.round(w * 0.14), Math.round(h * 0.84)],
	];

	// Point-in-polygon für das Blatt
	function insideSheet(x, y) {
		let inside = false;
		for (let i = 0, j = 3; i < 4; j = i++) {
			const xi = q[i][0], yi = q[i][1];
			const xj = q[j][0], yj = q[j][1];
			const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
			if (intersect) inside = !inside;
		}
		return inside;
	}

	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (!insideSheet(x, y)) continue;
			const idx = (y * w + x) * 4;
			// Schattenverlauf von links oben nach rechts unten
			const light = 215 + Math.round((1.0 - (x + y) / (w + h)) * 30);
			const grain = Math.round((r() - 0.5) * 6);
			let c = Math.max(0, Math.min(255, light + grain));

			// Textzeilen auf dem Blatt
			if (y % 28 >= 12 && y % 28 <= 14 && x % 16 > 3 && x > w * 0.25 && x < w * 0.75) {
				c = Math.max(0, Math.min(255, c - 120)); // Dunkle Tinte
			}

			data[idx] = c;
			data[idx + 1] = c;
			data[idx + 2] = Math.max(0, c - 5); // leicht warmes Papier
			data[idx + 3] = 255;
		}
	}

	return { data: Array.from(data), width: w, height: h, quad: q };
}

console.log("Erzeuge synthetische Bilder für Golden-Tests...");
const docSmall = createSyntheticDocument(240, 320, 101);
const docMedium = createSyntheticDocument(480, 640, 202);

// 3. Bildoperationen testen
const imgObj = (doc) => ({
	width: doc.width,
	height: doc.height,
	data: new Uint8ClampedArray(doc.data),
});

// Warp
const warpedMedium = warpPixels(imgObj(docMedium), docMedium.quad);
const warpResult = {
	width: warpedMedium.width,
	height: warpedMedium.height,
	lumStats: lumStatsPixels(warpedMedium),
	samplePixels: [
		Array.from(warpedMedium.data.slice(0, 16)),
		Array.from(warpedMedium.data.slice(warpedMedium.data.length - 16)),
	],
};

// Enhance Modi auf dem entzerrten Bild
const enhanceResults = {};
for (const mode of ["color", "bw", "gray", "photo"]) {
	const cloned = {
		width: warpedMedium.width,
		height: warpedMedium.height,
		data: new Uint8ClampedArray(warpedMedium.data),
	};
	applyScanModePixels(cloned, mode);
	enhanceResults[mode] = {
		lumStats: lumStatsPixels(cloned),
		quality: scanQualityPixels(cloned),
		samplePixels: [
			Array.from(cloned.data.slice(0, 16)),
			Array.from(cloned.data.slice(cloned.data.length / 2 - 8, cloned.data.length / 2 + 8)),
			Array.from(cloned.data.slice(cloned.data.length - 16)),
		],
	};
}

// Rotation & Downscale
const rot90 = rotatePixels(imgObj(docSmall), 1);
const rot180 = rotatePixels(imgObj(docSmall), 2);
const downscaled = downscalePixels(imgObj(docSmall), 120, 160);

// Dokumenterkennung
const sizes = detectSizes(docMedium.width, docMedium.height);
const analysisImg = downscalePixels(imgObj(docMedium), sizes.dw, sizes.dh);
const grayRefine = toGray(downscalePixels(imgObj(docMedium), sizes.gw, sizes.gh));
const refineObj = { gray: grayRefine, gw: sizes.gw, gh: sizes.gh };

const detectedQuad = detectQuadPixels(analysisImg, docMedium.width, docMedium.height, refineObj);

import zlib from "node:zlib";

fs.writeFileSync(path.join(outDir, "doc_small.bin.gz"), zlib.gzipSync(Buffer.from(docSmall.data)));
fs.writeFileSync(path.join(outDir, "doc_medium.bin.gz"), zlib.gzipSync(Buffer.from(docMedium.data)));

const goldenData = {
	geomCases,
	docSmall: {
		width: docSmall.width,
		height: docSmall.height,
		rot90Stats: lumStatsPixels(rot90),
		rot180Stats: lumStatsPixels(rot180),
		downscaleStats: lumStatsPixels(downscaled),
	},
	docMedium: {
		width: docMedium.width,
		height: docMedium.height,
		quad: docMedium.quad,
		detectedQuad,
		warpResult,
		enhanceResults,
	},
};

const outFile = path.join(outDir, "cases.json");
fs.writeFileSync(outFile, JSON.stringify(goldenData, null, 2));
console.log(`Golden-Testdaten geschrieben nach: ${outFile} (${(fs.statSync(outFile).size / 1024).toFixed(1)} KB)`);
console.log(`doc_small.bin.gz: ${(fs.statSync(path.join(outDir, "doc_small.bin.gz")).size / 1024).toFixed(1)} KB`);
console.log(`doc_medium.bin.gz: ${(fs.statSync(path.join(outDir, "doc_medium.bin.gz")).size / 1024).toFixed(1)} KB`);

