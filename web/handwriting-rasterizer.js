"use strict";

// web/handwriting-rasterizer.js — Zeile (Striche) → Graustufenbild für das Bild-Modell.
// Gleiche Regeln wie handwriting/rasterize.py (Training): Zeile auf 64 px Höhe skaliert (Bounding-Box,
// 6 px Rand), 2,5 px breite runde Striche, schwarz auf weiß, Werte 0..1, Breite auf ein Vielfaches von 4.
// Läuft im Worker (OffscreenCanvas).

export const IMAGE_HEIGHT = 64;
const PADDING = 6;
const STROKE_WIDTH = 2.5;
// Flache Zeilen (Unterstrich, Bruchstrich, Minus) bekamen sonst eine riesige Skalierung: Ein
// 0,4 Einheiten hoher Strich ergab ein 143.512 px breites Bild – Inferenz über Gigabytes,
// Timeout, auf dem iPad ein eingefrorener Tab. Unter dieser Höhe (Seiten-Einheiten, ~1,7 mm)
// zählt die Zeile als so hoch und liegt mittig; normale Zeilen bleiben wie im Training.
const MIN_INK_HEIGHT = 8;
// Doppelte Trainingsbreite: Längere Zeilen werden kleiner gezeichnet statt endlos breit.
const MAX_WIDTH = 4096;

// Rückgabe: { data: Float32Array(64 * width), width } oder null ohne Tinte
export function rasterizeLine(strokes) {
	let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
	for (const s of strokes) {
		for (const p of s.pts || []) {
			if (p[0] < minX) minX = p[0];
			if (p[0] > maxX) maxX = p[0];
			if (p[1] < minY) minY = p[1];
			if (p[1] > maxY) maxY = p[1];
		}
	}
	if (!Number.isFinite(minX)) return null;
	let scale = (IMAGE_HEIGHT - 2 * PADDING) / Math.max(maxY - minY, MIN_INK_HEIGHT);
	scale = Math.min(scale, (MAX_WIDTH - 2 * PADDING) / Math.max(maxX - minX, 1e-6));
	const inkWidth = Math.floor((maxX - minX) * scale) + 2 * PADDING;
	const width = Math.max(4, Math.ceil(inkWidth / 4) * 4);
	const top = (IMAGE_HEIGHT - (maxY - minY) * scale) / 2; // = PADDING bei normaler Zeilenhöhe

	const canvas = new OffscreenCanvas(width, IMAGE_HEIGHT);
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, width, IMAGE_HEIGHT);
	ctx.strokeStyle = ctx.fillStyle = "#000";
	ctx.lineWidth = STROKE_WIDTH;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	const tx = (x) => (x - minX) * scale + PADDING;
	const ty = (y) => (y - minY) * scale + top;
	for (const s of strokes) {
		const pts = s.pts || [];
		if (!pts.length) continue;
		if (pts.length === 1) {
			ctx.beginPath();
			ctx.arc(tx(pts[0][0]), ty(pts[0][1]), STROKE_WIDTH / 2, 0, 2 * Math.PI);
			ctx.fill();
			continue;
		}
		ctx.beginPath();
		ctx.moveTo(tx(pts[0][0]), ty(pts[0][1]));
		for (let i = 1; i < pts.length; i++) ctx.lineTo(tx(pts[i][0]), ty(pts[i][1]));
		ctx.stroke();
	}

	const rgba = ctx.getImageData(0, 0, width, IMAGE_HEIGHT).data;
	const data = new Float32Array(width * IMAGE_HEIGHT);
	for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4] / 255;
	return { data, width };
}

// Leere Spaltenbereiche [von, bis) zwischen Tinte, mindestens minWidth px breit (Wortlücken)
export function findInkGaps(image, minWidth) {
	const { data, width } = image;
	const gaps = [];
	let lastInk = -1;
	for (let x = 0; x < width; x++) {
		let ink = false;
		for (let y = 0; y < IMAGE_HEIGHT && !ink; y++) ink = data[y * width + x] < 0.8;
		if (!ink) continue;
		if (lastInk >= 0 && x - lastInk - 1 >= minWidth) gaps.push([lastInk + 1, x]);
		lastInk = x;
	}
	return gaps;
}
