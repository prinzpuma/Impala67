"use strict";

import { S } from "./state.js";
import { HANDSCHRIFT } from "./handschrift.js";
import { HANDWRITING_PREPROCESSOR as PRE } from "./handwriting-preprocessor.js";
import { HANDWRITING_CTC } from "./handwriting-ctc.js";

// web/heft-label.js — Heftseiten von einer Bild-KI beschriften lassen (MCP), damit das lokale
// Modell aus echten Notizen lernt.
//   1) pageImage:  Seite als Bild mit Koordinatenraster + was das lokale Modell darauf liest.
//   2) labelLines: Die KI legt selbst fest, was eine Zeile ist (Rahmen, Leserichtung, Text).
//      Die Striche werden zugeordnet, in Leserichtung gedreht und als Trainingsbeispiel
//      gespeichert. Nebenbei wird gemessen, wie gut die Zeilenzerlegung der App (segmentLines) passt.

export const HEFT_LABEL = (() => {
	const PAGE_W = 1000, PAGE_H = 1414, GRID = 100; // Seitenmaße wie in heft.js

	function getPage(pageId, pageIdx) {
		const doc = S.heftDocs?.[pageId];
		const pg = doc?.pages?.[pageIdx];
		if (!pg) throw new Error(`Heftseite nicht gefunden: ${pageId}, Seite ${pageIdx}`);
		return { doc, pg, strokes: PRE.filterInkStrokes(pg.strokes || []) };
	}

	function renderPage(strokes) {
		const canvas = document.createElement("canvas");
		canvas.width = PAGE_W;
		canvas.height = PAGE_H;
		const ctx = canvas.getContext("2d");
		ctx.fillStyle = "#ffffff";
		ctx.fillRect(0, 0, PAGE_W, PAGE_H);
		// Koordinatenraster, damit die KI Rahmen in Seitenkoordinaten angeben kann
		ctx.strokeStyle = "#dfe5ef";
		ctx.fillStyle = "#8a94a6";
		ctx.lineWidth = 1;
		ctx.font = "13px sans-serif";
		for (let x = GRID; x < PAGE_W; x += GRID) {
			ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, PAGE_H); ctx.stroke();
			ctx.fillText(String(x), x + 3, 13);
		}
		for (let y = GRID; y < PAGE_H; y += GRID) {
			ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PAGE_W, y); ctx.stroke();
			ctx.fillText(String(y), 3, y - 3);
		}
		ctx.strokeStyle = "#111111";
		ctx.fillStyle = "#111111";
		ctx.lineWidth = 2.5;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		for (const s of strokes) {
			const pts = s.pts;
			if (pts.length === 1) {
				ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], 1.5, 0, Math.PI * 2); ctx.fill();
				continue;
			}
			ctx.beginPath();
			ctx.moveTo(pts[0][0], pts[0][1]);
			for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
			ctx.stroke();
		}
		return canvas.toDataURL("image/png");
	}

	async function pageImage({ page_id, page_index = 0 }) {
		const { doc, pg, strokes } = getPage(page_id, page_index);
		let appReading = "";
		try {
			appReading = strokes.length ? await HANDSCHRIFT.recognizeStrokes(pg.strokes) : "";
		} catch (e) {
			appReading = `(Erkennung fehlgeschlagen: ${e.message})`;
		}
		return {
			pageId: page_id,
			pageIndex: page_index,
			pageCount: doc.pages.length,
			size: { width: PAGE_W, height: PAGE_H },
			inkStrokes: strokes.length,
			appReading,
			image: renderPage(strokes),
		};
	}

	// Dreht Striche um ihren Mittelpunkt, sodass die Leserichtung (angle in Grad, 0 = links→rechts,
	// 90 = oben→unten) waagerecht von links nach rechts verläuft
	function rotateToReading(strokes, angleDeg) {
		if (!angleDeg) return strokes;
		const a = (angleDeg * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
		let n = 0, sx = 0, sy = 0;
		for (const s of strokes) for (const p of s.pts) { sx += p[0]; sy += p[1]; n++; }
		const cx = sx / n, cy = sy / n;
		return strokes.map((s) => ({
			...s,
			pts: s.pts.map((p) => {
				const dx = p[0] - cx, dy = p[1] - cy;
				return [cx + dx * cos + dy * sin, cy - dx * sin + dy * cos];
			}),
		}));
	}

	async function labelLines({ page_id, page_index = 0, lines, save = true }) {
		const { strokes } = getPage(page_id, page_index);
		if (!Array.isArray(lines) || !lines.length) throw new Error("lines fehlt: [{ box: [x0, y0, x1, y1], text, angle }]");
		const boxes = lines.map((l, i) => {
			const b = l.box;
			if (!Array.isArray(b) || b.length !== 4 || b.some((v) => !Number.isFinite(Number(v)))) throw new Error(`Zeile ${i + 1}: box muss [x0, y0, x1, y1] sein`);
			const [x0, y0, x1, y1] = b.map(Number);
			return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
		});

		// Jeder Strich gehört zum (kleinsten) Rahmen, in dem sein Mittelpunkt liegt
		const owner = new Map();
		const unassigned = [];
		let ambiguous = 0;
		for (const s of strokes) {
			const b = PRE.strokeBbox(s);
			if (!b) continue;
			const cx = (b.minX + b.maxX) / 2, cy = b.cy;
			const hits = boxes.map((bx, j) => (cx >= bx.x0 && cx <= bx.x1 && cy >= bx.y0 && cy <= bx.y1 ? j : -1)).filter((j) => j >= 0);
			if (hits.length > 1) ambiguous++;
			if (!hits.length) { unassigned.push([Math.round(cx), Math.round(cy)]); continue; }
			const area = (j) => (boxes[j].x1 - boxes[j].x0) * (boxes[j].y1 - boxes[j].y0);
			owner.set(s, hits.reduce((best, j) => (area(j) < area(best) ? j : best)));
		}

		// Zeilenzerlegung der App zum Vergleich
		const appLineOf = new Map();
		PRE.segmentLines(strokes).forEach((line, k) => line.strokes.forEach((s) => appLineOf.set(s, k)));
		const llmLinesPerAppLine = new Map();
		for (const [s, j] of owner) {
			const k = appLineOf.get(s);
			if (!llmLinesPerAppLine.has(k)) llmLinesPerAppLine.set(k, new Set());
			llmLinesPerAppLine.get(k).add(j);
		}

		if (save) HANDSCHRIFT.removeTrainingSamples({ source: "llm", pageId: page_id, pageIdx: page_index });
		const results = [];
		let errApp = 0, chars = 0, saved = 0, saveFailed = 0;
		for (let j = 0; j < lines.length; j++) {
			const text = String(lines[j].text || "").trim();
			const own = strokes.filter((s) => owner.get(s) === j);
			const appLines = new Set(own.map((s) => appLineOf.get(s)));
			const row = { nr: j + 1, text, strokes: own.length, splitByApp: appLines.size > 1 };
			if (!own.length || !text) { results.push({ ...row, skipped: own.length ? "kein Text" : "keine Striche im Rahmen" }); continue; }
			const lineStrokes = PRE.orderLineStrokes(rotateToReading(own, Number(lines[j].angle) || 0));
			try {
				row.app = String(await HANDSCHRIFT.recognizeStrokes(lineStrokes)).replace(/\n/g, " ");
				row.errors = HANDWRITING_CTC.levenshtein(row.app, text);
				errApp += row.errors;
				chars += text.length;
			} catch (e) {
				row.app = `(Fehler: ${e.message})`;
			}
			if (save) {
				if (HANDSCHRIFT.saveTrainingSample(lineStrokes, text, { source: "llm", pageId: page_id, pageIdx: page_index })) saved++;
				else saveFailed++;
			}
			results.push(row);
		}

		return {
			pageId: page_id,
			pageIndex: page_index,
			saved,
			...(saveFailed ? { saveFailed, hint: "Speichern fehlgeschlagen (Speicher voll?) – Samples exportieren und leeren." } : {}),
			modelCer: chars ? Math.round((1000 * errApp) / chars) / 10 : null,
			segmentation: {
				llmLinesSplitByApp: results.filter((r) => r.splitByApp).length,
				appLinesMixingLlmLines: [...llmLinesPerAppLine.values()].filter((set) => set.size > 1).length,
			},
			ambiguousStrokes: ambiguous,
			unassignedStrokes: unassigned.length,
			...(unassigned.length ? { unassignedCenters: unassigned.slice(0, 15) } : {}),
			lines: results,
		};
	}

	return { pageImage, labelLines };
})();
