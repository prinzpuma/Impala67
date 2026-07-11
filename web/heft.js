"use strict";
import { S, STATE } from "./state.js";
import { DB } from "./db.js";
import { U } from "./util.js";

// heft.js — GoodNotes-Kern für Impala67.
//
// Taskbar v7 (11. Juli 2026):
// - Haupt-Pill bleibt IMMER fest zentriert oben (nie draggable)
// - Nur das Options-Tray darunter ist separat frei verschiebbar
// - Beide liegen über dem Papier, ohne Banner oder verlorenen Canvas-Platz
// - Drag ist strikt auf den Tray-Griff begrenzt — Werkzeug-Klicks bleiben stabil
// - Bilder wie in GoodNotes: einfügen (Datei/Kamera), mit dem Auswahl-Werkzeug verschieben,
//   skalieren (Griff unten rechts) und löschen (✕ oben rechts oder Entf-Taste)
// - Dokument-Scanner v2 („Dateien scannen"): Kamera (getUserMedia) → automatische
//   Dokumenterkennung (größte helle, unbunte Fläche → 4 Ecken) → perspektivische
//   Entzerrung (Homographie, bilineares Sampling) → Beleuchtung glätten + Filter
//   (Farbe / S/W / Graustufen / Foto) → Nachbearbeitung pro Scan (Ecken ziehen,
//   Filter, Drehen, Auto-Zuschnitt) → eigener minimaler PDF-1.4-Writer (JPEG/
//   DCTDecode) → PDF-Download und/oder Scans als neue Heftseiten
//
// Persistenz: EIN Blob je Heft (heft:<pageId>) in IndexedDB. Damit wandert der Inhalt
// automatisch durch Export/Backup und den Drive-Sync (Blob-Pipeline). Nur Metadaten
// laufen als leichtes Event `heftUpdated` durchs Log — keine Stroke-Flut im Event-Log.
export const HEFT = (() => {
	const PAGE_W = 1000, PAGE_H = 1414; // logisches A4
	const KEY = (p) => "heft:" + p;
	const INK_LEGACY = (p) => "impala67.ink." + p;
	const COLORS = ["#1c1c1e", "#2f6fed", "#e0483e", "#1f9d55", "#f5b800", "#8b7cc8"];
	const SIZES = [["F", 1.6], ["M", 3], ["B", 5.5]];
	const PAPERS = [["lined", "☰", "Liniert"], ["grid", "▦", "Kariert"], ["dots", "⣿", "Punkte"], ["blank", "▢", "Blanko"]];

	const docs = {};     // pid → Dokument (Cache)
	const thumbs = {};   // "pid:index:breite" → dataURL
	const thumbJobs = {}; // parallele Anfragen auf dieselbe Vorschau teilen sich einen Render
	const imgCache = {}; // imageId → HTMLImageElement (dekodierte Bild-Objekte)
	let host = null, pid = null, doc = null, idx = 0, scale = 1, zoom = 1;
	let canvases = []; // wird nur beim Mount/Seitenumbau gesammelt, nicht pro Stiftbewegung gesucht
	let pageSlots = []; // passende Seiten-Container für die Scroll-Erkennung
	const touchPointers = new Map(); // aktive Finger für Scrollen/Pinch-Zoom
	let pinch = null;                // { distance, midX, midY, startZoom }
	let touchTap = null;             // Zwei-/Drei-Finger-Tap für Undo/Redo
	// onlyPen default true: Palm Rejection für Apple Pencil
	let tool = "pen", color = COLORS[0], size = 3, onlyPen = true, penSeen = false;
	let expanded = false;    // Options-Tray erst nach Klick auf Schreiben/Radierer
	let trayPos = null;      // {x,y} nur für das verschiebbare Options-Tray
	let trayDrag = null;     // laufender Drag des Options-Trays
	let drawing = null, saveT = 0, resizeFn = null, scrollFn = null;
	let undoStack = [], redoStack = [];
	let sel = null;          // { pageIdx, imgId } — ausgewähltes Bild (Auswahl-Werkzeug)
	let lassoSel = null;     // { pageIdx, strokes[] } — Auswahl von Freihand-Strichen
	let holdTool = null, holdTimer = 0, suppressEraserClick = false;
	const laserTimers = new Set();
	let insertPos = "after"; // ＋-Menü: "before" | "after" | "last"
	let pop = null;          // offenes Toolbar-Popup (Seiten / Bilder / ＋)
	let scanUI = null;       // Scanner-Overlay { wrap, stream, shots[], edit, busy }
	let ocrBusy = false;     // lokale Texterkennung läuft

	const enc = new TextEncoder(), dec = new TextDecoder();
	const newPage = (paper) => ({ id: U.uid(), paper: paper || "lined", strokes: [], images: [] });
	const emptyDoc = () => ({ v: 1, rev: 1, pages: [newPage()] });
	const page = () => (doc ? doc.pages[idx] : null);
	const imagesOf = (pg) => (pg.images || (pg.images = []));

	// ---------- Legacy ink.js (localStorage-Overlay) ----------
	function takeLegacyInk(p) {
		try {
			const raw = localStorage.getItem(INK_LEGACY(p));
			if (!raw) return null;
			const d = JSON.parse(raw);
			localStorage.removeItem(INK_LEGACY(p));
			if (d && Array.isArray(d.strokes) && d.strokes.length) return d.strokes;
		} catch (e) { console.warn("Heft: Legacy-Ink lesen fehlgeschlagen", e); }
		return null;
	}
	function purgeOrphanLegacyInk() {
		try {
			const doomed = [];
			for (let i = 0; i < localStorage.length; i++) {
				const k = localStorage.key(i);
				if (k && k.startsWith("impala67.ink.")) doomed.push(k);
			}
			doomed.forEach((k) => {
				const id = k.slice("impala67.ink.".length);
				const pg = S.pages && S.pages[id];
				if (pg && pg.kind === "heft") return;
				localStorage.removeItem(k);
			});
		} catch { /* ignore */ }
	}

	// ---------- Persistenz ----------
	async function load(p) {
		if (docs[p]) return docs[p];
		let d = null;
		try {
			const rec = await DB.getBlob(KEY(p));
			if (rec && rec.buf && rec.buf.byteLength) {
				const parsed = JSON.parse(dec.decode(rec.buf));
				if (parsed && Array.isArray(parsed.pages) && parsed.pages.length) d = parsed;
			}
		} catch (e) { console.warn("Heft: Laden fehlgeschlagen", e); }
		if (!d) d = emptyDoc();
		// Ältere Hefte kennen pg.images noch nicht — nachrüsten
		d.pages.forEach((pg) => { if (!Array.isArray(pg.images)) pg.images = []; });
		// Legacy-Ink: nur in leeres Heft (keine Striche irgendwo) übernehmen
		const empty = d.pages.every((pg) => !(pg.strokes && pg.strokes.length));
		if (empty) {
			const legacy = takeLegacyInk(p);
			if (legacy) {
				d.pages[0].strokes = legacy;
				d.pages[0].paper = d.pages[0].paper || "lined";
				docs[p] = d;
				try {
					const bytes = enc.encode(JSON.stringify(d));
					await DB.putBlob(KEY(p), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { type: "application/json", kind: "heft", rev: d.rev || 1 });
					await STATE.dispatch("heftUpdated", { pageId: p, rev: d.rev || 1, pages: d.pages.length, bytes: bytes.byteLength });
				} catch (e) { console.warn("Heft: Legacy-Ink speichern fehlgeschlagen", e); }
			}
		} else {
			try { localStorage.removeItem(INK_LEGACY(p)); } catch { /* ignore */ }
		}
		docs[p] = d;
		return d;
	}
	function scheduleSave() { clearTimeout(saveT); saveT = setTimeout(saveNow, 350); }
	async function saveNow() {
		clearTimeout(saveT);
		if (!pid || !doc) return;
		// Schnappschuss VOR dem ersten await: unmount() ruft saveNow() bewusst OHNE await
		// auf und setzt pid/doc danach sofort auf null.
		const savePid = pid, saveDoc = doc;
		saveDoc.rev = (saveDoc.rev || 1) + 1;
		const bytes = enc.encode(JSON.stringify(saveDoc));
		Object.keys(thumbs).forEach((k) => { if (k.startsWith(savePid + ":")) delete thumbs[k]; });
		try {
			await DB.putBlob(KEY(savePid), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { type: "application/json", kind: "heft", rev: saveDoc.rev });
			await STATE.dispatch("heftUpdated", { pageId: savePid, rev: saveDoc.rev, pages: saveDoc.pages.length, bytes: bytes.byteLength });
		} catch (e) { console.warn("Heft: Speichern fehlgeschlagen", e); }
	}
	const hasHeft = (p) => !!((S.heftMeta && S.heftMeta[p]) || docs[p]);
	const pagesOf = (p) => (S.heftMeta && S.heftMeta[p] && S.heftMeta[p].pages) || (docs[p] ? docs[p].pages.length : 1);

	// ---------- Papier + Striche + Bilder ----------
	function paintPaper(x, w, h, kind) {
		x.fillStyle = "#fbfaf7";
		x.fillRect(0, 0, w, h);
		if (kind === "blank") return;
		x.save();
		if (kind === "dots") {
			x.fillStyle = "rgba(60,80,120,0.20)";
			for (let y = 40; y < h; y += 28) for (let gx = 40; gx < w; gx += 28) { x.beginPath(); x.arc(gx, y, 1.2, 0, Math.PI * 2); x.fill(); }
		} else {
			x.strokeStyle = "rgba(70,110,180,0.15)";
			x.lineWidth = 1;
			const x0 = kind === "lined" ? 90 : 0, x1 = kind === "lined" ? w - 50 : w;
			for (let y = kind === "lined" ? 96 : 28; y < h - (kind === "lined" ? 40 : 0); y += 28) { x.beginPath(); x.moveTo(x0, y); x.lineTo(x1, y); x.stroke(); }
			if (kind === "grid") for (let gx = 28; gx < w; gx += 28) { x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, h); x.stroke(); }
			if (kind === "lined") { x.strokeStyle = "rgba(224,72,62,0.22)"; x.beginPath(); x.moveTo(90, 40); x.lineTo(90, h - 40); x.stroke(); }
		}
		x.restore();
	}
	const segW = (b, p) => Math.max(0.5, b * (0.4 + (p == null ? 0.5 : p) * 1.2));
	function drawStroke(x, s) {
		const pts = s.pts;
		if (!pts || !pts.length) return;
		x.save();
		x.lineCap = "round"; x.lineJoin = "round"; x.strokeStyle = s.color;
		if (s.tool === "shape" && s.shape) {
			x.lineWidth = s.size || 3;
			const a = s.shape;
			if (a.type === "line") { x.beginPath(); x.moveTo(a.x1, a.y1); x.lineTo(a.x2, a.y2); x.stroke(); }
			else if (a.type === "ellipse") { x.beginPath(); x.ellipse(a.cx, a.cy, Math.abs(a.rx), Math.abs(a.ry), 0, 0, Math.PI * 2); x.stroke(); }
			else { x.strokeRect(Math.min(a.x1, a.x2), Math.min(a.y1, a.y2), Math.abs(a.x2 - a.x1), Math.abs(a.y2 - a.y1)); }
		} else if (s.tool === "marker") {
			x.globalAlpha = 0.32; x.lineWidth = s.size * 3;
			x.beginPath(); x.moveTo(pts[0][0], pts[0][1]);
			for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]);
			x.stroke();
		} else if (pts.length === 1) {
			x.beginPath(); x.fillStyle = s.color;
			x.arc(pts[0][0], pts[0][1], segW(s.size, pts[0][2]) / 2, 0, Math.PI * 2); x.fill();
		} else {
			for (let i = 1; i < pts.length; i++) {
				x.beginPath(); x.lineWidth = segW(s.size, pts[i][2]);
				x.moveTo(pts[i - 1][0], pts[i - 1][1]); x.lineTo(pts[i][0], pts[i][1]); x.stroke();
			}
		}
		x.restore();
	}
	// Bild-Objekte: dekodierte Image-Elemente cachen; nach dem Laden einmal neu zeichnen
	function imgEl(im) {
		let c = imgCache[im.id];
		if (!c) {
			c = new Image();
			c.onload = () => {
				Object.keys(thumbs).forEach((k) => delete thumbs[k]);
				// Ein Bild betrifft nur seine eigene Heftseite. Alle Canvas-Seiten und
				// sämtliche Popup-Thumbnails neu zu zeichnen war bei großen Heften teuer.
				if (host && doc) {
					const pageIndex = doc.pages.findIndex((pg) => (pg.images || []).some((item) => item.id === im.id));
					if (pageIndex !== -1) { redrawPage(pageIndex); renderThumb(pageIndex); }
				}
			};
			c.src = im.src;
			imgCache[im.id] = c;
		}
		return c;
	}
	function drawLassoSelection(x, strokes) {
		if (!strokes || !strokes.length) return;
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		strokes.forEach((s) => (s.pts || []).forEach((p) => { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); }));
		if (!isFinite(minX)) return;
		x.save(); x.setLineDash([8, 5]); x.strokeStyle = "#2f6fed"; x.lineWidth = 2;
		x.strokeRect(minX - 9, minY - 9, maxX - minX + 18, maxY - minY + 18); x.restore();
	}
	function drawSelection(x, im) {
		x.save();
		x.strokeStyle = "#2f6fed"; x.lineWidth = 1.5; x.setLineDash([6, 4]);
		x.strokeRect(im.x, im.y, im.w, im.h);
		x.setLineDash([]);
		// Griff unten rechts: Skalieren
		x.fillStyle = "#2f6fed";
		x.beginPath(); x.arc(im.x + im.w, im.y + im.h, 7, 0, Math.PI * 2); x.fill();
		// ✕ oben rechts: Löschen
		x.fillStyle = "#e0483e";
		x.beginPath(); x.arc(im.x + im.w, im.y, 9, 0, Math.PI * 2); x.fill();
		x.strokeStyle = "#fff"; x.lineWidth = 2;
		x.beginPath();
		x.moveTo(im.x + im.w - 4, im.y - 4); x.lineTo(im.x + im.w + 4, im.y + 4);
		x.moveTo(im.x + im.w + 4, im.y - 4); x.lineTo(im.x + im.w - 4, im.y + 4);
		x.stroke();
		x.restore();
	}
	function renderPageTo(x, pg, pi) {
		paintPaper(x, PAGE_W, PAGE_H, pg.paper);
		(pg.images || []).forEach((im) => {
			const el = imgEl(im);
			if (el.complete && el.naturalWidth) x.drawImage(el, im.x, im.y, im.w, im.h);
		});
		pg.strokes.forEach((s) => drawStroke(x, s));
		if (lassoSel && lassoSel.pageIdx === pi) drawLassoSelection(x, lassoSel.strokes);
		if (sel && doc && sel.pageIdx === pi && doc.pages[pi] === pg) {
			const im = imagesOf(pg).find((i2) => i2.id === sel.imgId);
			if (im) drawSelection(x, im);
		}
	}
	function applyTransform(x) { const dpr = window.devicePixelRatio || 1; x.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0); }
	function redrawPage(i) {
		if (!doc || !doc.pages[i]) return;
		const cv = canvases[i];
		if (!cv) return;
		const x = cv.getContext('2d');
		x.setTransform(1, 0, 0, 1, 0, 0);
		x.clearRect(0, 0, cv.width, cv.height);
		applyTransform(x);
		renderPageTo(x, doc.pages[i], i);
	}
	function redraw() { if (doc) doc.pages.forEach((_, i) => redrawPage(i)); }
	function layout() {
		if (!host) return;
		const scroll = host.querySelector('.heft-scroll');
		if (!scroll) return;
		const availW = scroll.clientWidth - 24;
		// Fit-to-width als Basis; Pinch-Zoom multipliziert diese Ansicht bis 4×.
		const fit = Math.max(0.1, Math.min(availW / PAGE_W, 1));
		scale = fit * zoom;
		const dpr = window.devicePixelRatio || 1;
		const cssW = Math.round(PAGE_W * scale), cssH = Math.round(PAGE_H * scale);
		canvases.forEach((cv) => {
			cv.style.width = cssW + 'px';
			cv.style.height = cssH + 'px';
			cv.width = Math.round(PAGE_W * scale * dpr);
			cv.height = Math.round(PAGE_H * scale * dpr);
		});
		redraw();
	}

	// ---------- Pointer (Apple Pencil / Maus / Finger) ----------
	const pos = (e, cv) => {
		const r = cv.getBoundingClientRect();
		return [
			Math.round((e.clientX - r.left) / scale * 10) / 10,
			Math.round((e.clientY - r.top) / scale * 10) / 10,
			Math.round((e.pressure || 0.5) * 100) / 100,
		];
	};
	const rejected = (e) => e.pointerType === "touch" && (onlyPen || penSeen);
	const near = (p, x, y, r) => { const dx = p[0] - x, dy = p[1] - y; return dx * dx + dy * dy <= r * r; };
	// ---------- Touch: 1 Finger = nativer Scroll · 2 Finger = Pinch-Zoom ----------
	function touchDistance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
	function touchMid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
	function touchPair() { const a = [...touchPointers.values()]; return a.length >= 2 ? [a[0], a[1]] : null; }
	function onTouchPointerDown(e) {
		if (e.pointerType !== "touch") return;
		if (!touchTap) touchTap = { count: 0, started: Date.now(), moved: false };
		touchTap.count++;
		touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, cv: e.currentTarget });
		const pair = touchPair();
		if (!pair || !host) return;
		const mid = touchMid(pair[0], pair[1]);
		pinch = { distance: Math.max(1, touchDistance(pair[0], pair[1])), midX: mid.x, midY: mid.y, startZoom: zoom };
		// Zweiter Finger: Browser-Geste blockieren, damit nur das Papier zoomt.
		try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
	}
	function onTouchPointerMove(e) {
		if (e.pointerType !== "touch" || !touchPointers.has(e.pointerId)) return;
		const p = touchPointers.get(e.pointerId);
		if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 12 && touchTap) touchTap.moved = true;
		p.x = e.clientX; p.y = e.clientY;
		const pair = touchPair();
		if (!pinch || !pair || !host) return; // ein Finger bleibt nativer Scroll
		e.preventDefault();
		const scroll = host.querySelector('.heft-scroll');
		if (!scroll) return;
		const dist = Math.max(1, touchDistance(pair[0], pair[1]));
		const nextZoom = Math.max(0.55, Math.min(4, pinch.startZoom * (dist / pinch.distance)));
		if (Math.abs(nextZoom - zoom) < 0.003) return;
		const oldScale = scale;
		const mid = touchMid(pair[0], pair[1]);
		const r = scroll.getBoundingClientRect();
		const focalX = mid.x - r.left, focalY = mid.y - r.top;
		const logicalX = (scroll.scrollLeft + focalX) / oldScale;
		const logicalY = (scroll.scrollTop + focalY) / oldScale;
		zoom = nextZoom;
		layout();
		scroll.scrollLeft = Math.max(0, logicalX * scale - focalX);
		scroll.scrollTop = Math.max(0, logicalY * scale - focalY);
	}
	function onTouchPointerUp(e) {
		if (e.pointerType !== "touch") return;
		touchPointers.delete(e.pointerId);
		const pair = touchPair();
		if (pair) {
			const mid = touchMid(pair[0], pair[1]);
			pinch = { distance: Math.max(1, touchDistance(pair[0], pair[1])), midX: mid.x, midY: mid.y, startZoom: zoom };
			return;
		}
		pinch = null;
		// Zwei Finger tippen = Undo · drei Finger tippen = Redo. Scroll/Pinch lösen nichts aus.
		const tap = touchTap; touchTap = null;
		if (tap && !tap.moved && Date.now() - tap.started < 320) {
			if (tap.count === 2) { e.preventDefault(); undo(); }
			else if (tap.count >= 3) { e.preventDefault(); redo(); }
		}
	}
	function pointInPolygon(p, poly) {
		let hit = false;
		for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
			const a = poly[i], b = poly[j];
			if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / ((b[1] - a[1]) || .0001) + a[0]) hit = !hit;
		}
		return hit;
	}
	function hitImage(pg, p) {
		const arr = imagesOf(pg);
		for (let i = arr.length - 1; i >= 0; i--) {
			const im = arr[i];
			if (p[0] >= im.x && p[0] <= im.x + im.w && p[1] >= im.y && p[1] <= im.y + im.h) return im;
		}
		return null;
	}
	function eraseAt(e) {
		const p0 = pos(e, drawing.cv), r = 14, pg = doc.pages[drawing.pageIdx];
		const keep = [], removed = [];
		outer: for (const s of pg.strokes) {
			for (const pt of s.pts) {
				const dx = pt[0] - p0[0], dy = pt[1] - p0[1];
				if (dx * dx + dy * dy <= r * r) { removed.push(s); continue outer; }
			}
			keep.push(s);
		}
		if (removed.length) { pg.strokes = keep; drawing.removed.push(...removed); redrawPage(drawing.pageIdx); }
	}
	function onDown(e) {
		if (e.pointerType === "pen") penSeen = true;
		if (rejected(e) || !doc) return;
		const cv = e.currentTarget;
		const slot = cv.closest('.heft-page-slot');
		const pi = slot ? Number(slot.dataset.hepage) : idx;
		const pg = doc.pages[pi];
		if (!pg) return;
		idx = pi;
		e.preventDefault();
		cv.setPointerCapture(e.pointerId);
		const x = cv.getContext('2d');
		const p = pos(e, cv);
		if (tool === "lasso") {
			// Freies Lasso um Striche ziehen. Auswahl kann danach mit Entf gelöscht werden.
			drawing = { lasso: true, pts: [p], cv, ctx: x, pageIdx: pi };
			return;
		}
		if (tool === "shape") {
			// Rohbewegung sammeln; beim Loslassen wird Linie/Rechteck/Ellipse erkannt.
			drawing = { shape: true, pts: [p], cv, ctx: x, pageIdx: pi };
			return;
		}
		if (tool === "laser") {
			// Laser wird direkt gezeichnet, aber nie gespeichert.
			drawing = { laser: true, tool: "pen", color: "#ef4444", size: 7, pts: [p], cv, ctx: x, pageIdx: pi };
			applyTransform(x);
			return;
		}
		if (tool === "select") {
			// Auswahl-Werkzeug: Bilder antippen, verschieben, skalieren, löschen
			const im = sel && sel.pageIdx === pi ? imagesOf(pg).find((i2) => i2.id === sel.imgId) : null;
			if (im && near(p, im.x + im.w, im.y, 16)) {
				// ✕ oben rechts: Bild löschen
				pg.images = imagesOf(pg).filter((i2) => i2 !== im);
				undoStack.push({ kind: "imgDel", img: im, pageIdx: pi }); redoStack = [];
				sel = null;
				scheduleSave(); redrawPage(pi); renderThumb(pi); updateChrome();
				return;
			}
			if (im && near(p, im.x + im.w, im.y + im.h, 16)) {
				// Griff unten rechts: Skalieren (Seitenverhältnis bleibt)
				drawing = { imgResize: true, im, cv, pageIdx: pi, start: p, orig: { x: im.x, y: im.y, w: im.w, h: im.h } };
				return;
			}
			const hit = hitImage(pg, p);
			if (hit) {
				sel = { pageIdx: pi, imgId: hit.id };
				drawing = { imgMove: true, im: hit, cv, pageIdx: pi, start: p, orig: { x: hit.x, y: hit.y, w: hit.w, h: hit.h } };
				redrawPage(pi);
			} else if (sel) { const spi = sel.pageIdx; sel = null; redrawPage(spi); }
			return;
		}
		if (sel) { const spi = sel.pageIdx; sel = null; redrawPage(spi); }
		if (tool === "eraser") { drawing = { erasing: true, removed: [], cv, ctx: x, pageIdx: pi }; eraseAt(e); }
		else { drawing = { tool, color, size, pts: [p], cv, ctx: x, pageIdx: pi }; applyTransform(x); }
	}
	function onMove(e) {
		if (!drawing || rejected(e)) return;
		e.preventDefault();
		if (drawing.lasso) {
			drawing.pts.push(pos(e, drawing.cv));
			redrawPage(drawing.pageIdx);
			const x = drawing.ctx; applyTransform(x);
			x.save(); x.setLineDash([7, 4]); x.strokeStyle = "#2f6fed"; x.lineWidth = 1.7;
			x.beginPath(); x.moveTo(drawing.pts[0][0], drawing.pts[0][1]);
			for (let i = 1; i < drawing.pts.length; i++) x.lineTo(drawing.pts[i][0], drawing.pts[i][1]);
			x.stroke(); x.restore();
			return;
		}
		if (drawing.shape) {
			drawing.pts.push(pos(e, drawing.cv));
			redrawPage(drawing.pageIdx);
			const a = drawing.pts[0], b = drawing.pts[drawing.pts.length - 1], x = drawing.ctx;
			applyTransform(x); drawStroke(x, { tool: "shape", color, size, pts: [a, b], shape: { type: "rect", x1: a[0], y1: a[1], x2: b[0], y2: b[1] } });
			return;
		}
		if (drawing.imgMove || drawing.imgResize) {
			const p = pos(e, drawing.cv);
			const dx = p[0] - drawing.start[0], dy = p[1] - drawing.start[1];
			const im = drawing.im, o = drawing.orig;
			if (drawing.imgMove) {
				im.x = Math.min(PAGE_W - 20, Math.max(20 - im.w, o.x + dx));
				im.y = Math.min(PAGE_H - 20, Math.max(20 - im.h, o.y + dy));
			} else {
				const w = Math.max(40, o.w + dx);
				im.w = w; im.h = w * (o.h / o.w);
			}
			drawing.moved = true;
			redrawPage(drawing.pageIdx);
			return;
		}
		if (drawing.erasing) { eraseAt(e); return; }
		const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
		for (const ce of evs) {
			drawing.pts.push(pos(ce, drawing.cv));
			const n = drawing.pts.length;
			drawStroke(drawing.ctx, { tool: drawing.tool, color: drawing.color, size: drawing.size, pts: drawing.pts.slice(n - 2) });
		}
	}
	function onUp() {
		if (!drawing) return;
		const pi = drawing.pageIdx;
		const pg = doc.pages[pi];
		if (!pg) { drawing = null; return; }
		if (drawing.lasso) {
			const poly = drawing.pts;
			const hits = pg.strokes.filter((s) => (s.pts || []).some((p) => pointInPolygon(p, poly)));
			lassoSel = hits.length ? { pageIdx: pi, strokes: hits } : null;
			drawing = null; redrawPage(pi); updateChrome(); return;
		}
		if (drawing.shape) {
			const pts = drawing.pts, a = pts[0], b = pts[pts.length - 1];
			const w = b[0] - a[0], h = b[1] - a[1], len = Math.hypot(w, h);
			let maxDev = 0;
			for (const p of pts) maxDev = Math.max(maxDev, Math.abs(h * (p[0] - a[0]) - w * (p[1] - a[1])) / Math.max(1, len));
			const closed = pts.length > 10 && Math.hypot(b[0] - a[0], b[1] - a[1]) < Math.max(18, Math.min(Math.abs(w), Math.abs(h)) * .65);
			let shape;
			if (closed) {
				let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
				pts.forEach((p) => { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); });
				shape = { type: "ellipse", cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, rx: (maxX - minX) / 2, ry: (maxY - minY) / 2 };
			} else if (maxDev < Math.max(8, len * .08)) shape = { type: "line", x1: a[0], y1: a[1], x2: b[0], y2: b[1] };
			else shape = { type: "rect", x1: a[0], y1: a[1], x2: b[0], y2: b[1] };
			const stroke = { tool: "shape", color, size, pts: [a, b], shape };
			pg.strokes.push(stroke); undoStack.push({ kind: "add", stroke, pageIdx: pi }); redoStack = [];
			drawing = null; scheduleSave(); redrawPage(pi); renderThumb(pi); updateChrome(); return;
		}
		if (drawing.laser) {
			const laserPage = pi;
			const timer = setTimeout(() => { laserTimers.delete(timer); redrawPage(laserPage); }, 900);
			laserTimers.add(timer); drawing = null; return;
		}
		if (drawing.imgMove || drawing.imgResize) {
			const { im, orig, moved } = drawing;
			if (moved && (im.x !== orig.x || im.y !== orig.y || im.w !== orig.w)) {
				undoStack.push({ kind: "imgMod", im, pageIdx: pi, prev: orig }); redoStack = [];
				scheduleSave(); renderThumb(pi);
			}
			drawing = null;
			updateChrome();
			return;
		}
		if (drawing.erasing) {
			if (drawing.removed.length) {
				undoStack.push({ kind: "erase", removed: drawing.removed, pageIdx: pi });
				redoStack = [];
				scheduleSave();
				renderThumb(pi);
			}
		} else {
			// Nur serialisierbare Felder speichern — nie Canvas/DOM am Stroke hängen
			const stroke = { tool: drawing.tool, color: drawing.color, size: drawing.size, pts: drawing.pts };
			pg.strokes.push(stroke);
			undoStack.push({ kind: "add", stroke, pageIdx: pi });
			redoStack = [];
			scheduleSave();
			redrawPage(pi);
			renderThumb(pi);
		}
		drawing = null;
		updateChrome();
	}

	// ---------- Undo / Redo (Striche + Bilder, mit pageIdx) ----------
	function undo() {
		const a = undoStack.pop(); if (!a || !doc) return;
		const pi = a.pageIdx != null ? a.pageIdx : idx;
		const pg = doc.pages[pi]; if (!pg) return;
		if (a.kind === "add") pg.strokes = pg.strokes.filter((s) => s !== a.stroke);
		else if (a.kind === "erase") pg.strokes.push(...a.removed);
		else if (a.kind === "imgAdd") { pg.images = imagesOf(pg).filter((i2) => i2 !== a.img); if (sel && sel.imgId === a.img.id) sel = null; }
		else if (a.kind === "imgDel") imagesOf(pg).push(a.img);
		else if (a.kind === "imgMod") { const cur = { x: a.im.x, y: a.im.y, w: a.im.w, h: a.im.h }; Object.assign(a.im, a.prev); a.prev = cur; }
		else if (a.kind === "lassoDel") pg.strokes.push(...a.strokes);
		redoStack.push(a); redrawPage(pi); scheduleSave(); renderThumb(pi); updateChrome();
	}
	function redo() {
		const a = redoStack.pop(); if (!a || !doc) return;
		const pi = a.pageIdx != null ? a.pageIdx : idx;
		const pg = doc.pages[pi]; if (!pg) return;
		if (a.kind === "add") pg.strokes.push(a.stroke);
		else if (a.kind === "erase") pg.strokes = pg.strokes.filter((s) => !a.removed.includes(s));
		else if (a.kind === "imgAdd") imagesOf(pg).push(a.img);
		else if (a.kind === "imgDel") { pg.images = imagesOf(pg).filter((i2) => i2 !== a.img); if (sel && sel.imgId === a.img.id) sel = null; }
		else if (a.kind === "imgMod") { const cur = { x: a.im.x, y: a.im.y, w: a.im.w, h: a.im.h }; Object.assign(a.im, a.prev); a.prev = cur; }
		else if (a.kind === "lassoDel") pg.strokes = pg.strokes.filter((s) => !a.strokes.includes(s));
		undoStack.push(a); redrawPage(pi); scheduleSave(); renderThumb(pi); updateChrome();
	}

	// ---------- Taskbar v6: freistehende Floating-Pill (GoodNotes-Platzeffizienz) ----------
	function sizeLine(sz) {
		const h = sz[1] <= 2 ? 1.5 : sz[1] <= 4 ? 3 : 5;
		return '<button type="button" class="heft-size' + (size === sz[1] ? " active" : "") +
			'" data-hesize="' + sz[1] + '" title="Strich: ' + sz[0] + '">' +
			'<i style="height:' + h + 'px"></i></button>';
	}
	function trayStyle() {
		if (!trayPos) return ""; // CSS: direkt unter der festen Haupt-Pill
		return ' style="left:' + Math.round(trayPos.x) + 'px;top:' + Math.round(trayPos.y) + 'px;transform:none"';
	}
	function toolbarHtml() {
		const curPaper = page() ? page().paper : "lined";
		const paperMeta = PAPERS.find((p) => p[0] === curPaper) || PAPERS[0];
		const writeOn = tool === "pen" || tool === "marker";
		const showWrite = expanded && writeOn;
		const showEraser = expanded && tool === "eraser";
		const writeIcon = tool === "marker" ? "▮" : "✎";
		// Hauptleiste bleibt fest. Nur das separate Options-Tray erhält einen Drag-Griff.
		let tray = "";
		if (showWrite) {
			tray =
				'<div class="heft-tray" data-hetray="1" role="group" aria-label="Schreib-Optionen"' + trayStyle() + '>' +
					'<button type="button" class="heft-tray-drag" data-hetraydrag="1" title="Optionen verschieben" aria-label="Optionen verschieben">⠿</button>' +
					'<button type="button" data-hetool="pen" class="heft-opt' + (tool === "pen" ? " active" : "") +
						'" title="Stift">✎</button>' +
					'<button type="button" data-hetool="marker" class="heft-opt' + (tool === "marker" ? " active" : "") +
						'" title="Marker">▮</button>' +
					'<span class="heft-sep" aria-hidden="true"></span>' +
					SIZES.map(sizeLine).join("") +
					'<span class="heft-sep" aria-hidden="true"></span>' +
					COLORS.map((c) => '<button type="button" class="heft-swatch' + (color === c ? " active" : "") +
						'" data-hecolor="' + c + '" style="--sw:' + c + '" title="Farbe"></button>').join("") +
					'<span class="heft-sep" aria-hidden="true"></span>' +
					'<button type="button" data-hepapercycle="1" class="heft-opt" title="Papier: ' +
						paperMeta[2] + '">' + paperMeta[1] + '</button>' +
					'<button type="button" data-heonlypen="1" class="heft-opt' + (onlyPen ? " active" : "") +
						'" title="' + (onlyPen ? "Nur Stift zeichnet" : "Finger dürfen zeichnen") + '">' +
						(onlyPen ? "🖊" : "✋") + '</button>' +
				'</div>';
		} else if (showEraser) {
			tray =
				'<div class="heft-tray" data-hetray="1" role="group" aria-label="Radierer-Optionen"' + trayStyle() + '>' +
					'<button type="button" class="heft-tray-drag" data-hetraydrag="1" title="Optionen verschieben" aria-label="Optionen verschieben">⠿</button>' +
					SIZES.map(sizeLine).join("") +
				'</div>';
		}
		// Overlay: kein Banner. Die Haupt-Pill sitzt fest, das Tray wird separat gerendert.
		return '<div class="heft-chrome" aria-hidden="false">' +
			'<button type="button" class="heft-corner heft-corner-l' + (pop && pop.dataset.kind === "pages" ? " active" : "") +
				'" data-hepagesmenu="1" title="Seiten">▤' +
				'<span class="heft-pageno-inline">' + (idx + 1) + '/' + doc.pages.length + '</span></button>' +
			'<div class="heft-float" role="toolbar" aria-label="Werkzeuge">' +
				'<div class="heft-pill">' +
					'<button type="button" data-hewrite="1" class="heft-main' + (writeOn ? " active" : "") +
						(showWrite ? " open" : "") + '" title="Schreiben">' +
						writeIcon + '<span class="heft-chev">▾</span></button>' +
					'<button type="button" data-hetool="eraser" class="heft-main' + (tool === "eraser" ? " active" : "") +
						(showEraser ? " open" : "") + '" title="Radierer">⌫</button>' +
					'<button type="button" data-hetool="select" class="heft-main' + (tool === "select" ? " active" : "") +
						'" title="Bilder auswählen">⬚</button>' +
					'<button type="button" data-hetool="lasso" class="heft-main' + (tool === "lasso" ? " active" : "") +
						'" title="Lasso — Striche auswählen">⌁</button>' +
					'<button type="button" data-hetool="laser" class="heft-main heft-laser' + (tool === "laser" ? " active" : "") +
						'" title="Laserpointer — nicht speichern">⊙</button>' +
					'<button type="button" data-hetool="shape" class="heft-main' + (tool === "shape" ? " active" : "") +
						'" title="Formen — Linie, Rechteck, Kreis">▱</button>' +
					'<button type="button" data-heocr="1" class="heft-main" title="Handschrift suchen / Seite indexieren"' + (ocrBusy ? " disabled" : "") + '>⌕</button>' +
					'<button type="button" data-heimgmenu="1" class="heft-main' +
						(pop && pop.dataset.kind === "img" ? " active" : "") + '" title="Bilder">🖼</button>' +
					'<button type="button" data-heundo="1" class="heft-main" title="Rückgängig"' +
						(undoStack.length ? "" : " disabled") + '>↺</button>' +
					'<button type="button" data-heredo="1" class="heft-main" title="Wiederholen"' +
						(redoStack.length ? "" : " disabled") + '>↻</button>' +
				'</div>' +
			'</div>' +
			tray +
			'<div class="heft-corner-r">' +
				'<button type="button" class="heft-corner heft-chat" data-hechat="1" title="KI-Chat">✦</button>' +
				'<button type="button" class="heft-corner heft-plus' + (pop && pop.dataset.kind === "plus" ? " active" : "") +
					'" data-heplusmenu="1" title="Seite hinzufügen">＋</button>' +
			'</div>' +
		'</div>';
	}
	function viewHtml() {
		const pages = doc.pages.map((_, i) =>
			'<div class="heft-page-slot" data-hepage="' + i + '">' +
				'<canvas class="heft-canvas"></canvas>' +
				'<span class="heft-page-label">Seite ' + (i + 1) + '</span>' +
			'</div>'
		).join('');
		// Chrome fliegt ÜBER dem Scroll — kein Platzverlust im Layout
		return '<div class="heft-scroll">' + pages + '</div>' + toolbarHtml();
	}
	// Nur das Options-Tray ist verschiebbar. Die Hauptleiste bleibt bewusst fix.
	function onTrayPointerDown(e) {
		const grip = e.target.closest("[data-hetraydrag]");
		const tray = e.target.closest("[data-hetray]");
		if (!grip || !tray || !host) return;
		e.preventDefault(); e.stopPropagation();
		const r = tray.getBoundingClientRect(), hr = host.getBoundingClientRect();
		trayDrag = { tray, pid: e.pointerId, ox: e.clientX - r.left, oy: e.clientY - r.top };
		trayPos = { x: r.left - hr.left, y: r.top - hr.top };
		tray.style.left = Math.round(trayPos.x) + "px";
		tray.style.top = Math.round(trayPos.y) + "px";
		tray.style.transform = "none";
		tray.classList.add("is-dragging");
		try { grip.setPointerCapture(e.pointerId); } catch { /* ignore */ }
	}
	function onTrayPointerMove(e) {
		if (!trayDrag || !host || e.pointerId !== trayDrag.pid) return;
		e.preventDefault();
		const hr = host.getBoundingClientRect(), tr = trayDrag.tray.getBoundingClientRect();
		const x = Math.min(Math.max(8, e.clientX - hr.left - trayDrag.ox), Math.max(8, hr.width - tr.width - 8));
		const y = Math.min(Math.max(8, e.clientY - hr.top - trayDrag.oy), Math.max(8, hr.height - tr.height - 8));
		trayPos = { x, y };
		trayDrag.tray.style.left = Math.round(x) + "px";
		trayDrag.tray.style.top = Math.round(y) + "px";
	}
	function onTrayPointerUp(e) {
		if (!trayDrag || e.pointerId !== trayDrag.pid) return;
		try { e.target.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
		trayDrag.tray.classList.remove("is-dragging");
		trayDrag = null;
	}

	// ---------- Toolbar-Popups (Seiten / Bilder / ＋) ----------
	function closePop() {
		document.removeEventListener("pointerdown", onDocPointerDown, true);
		if (pop) { pop.remove(); pop = null; }
	}
	function onDocPointerDown(e) {
		if (!pop) return;
		if (pop.contains(e.target)) return;
		if (e.target.closest && e.target.closest("[data-hepagesmenu],[data-heplusmenu],[data-heimgmenu]")) return;
		closePop();
	}
	function openPop(anchor, html, kind, cls) {
		closePop();
		pop = document.createElement("div");
		pop.className = "heft-pop" + (cls ? " " + cls : "");
		pop.dataset.kind = kind;
		pop.innerHTML = html;
		host.appendChild(pop);
		// Unter dem Auslöser positionieren, am Host-Rand ausrichten
		const hr = host.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
		pop.style.top = Math.round(ar.bottom - hr.top + 6) + "px";
		let left = Math.round(ar.left - hr.left);
		if (left + pop.offsetWidth > hr.width - 8) left = Math.round(hr.width - pop.offsetWidth - 8);
		pop.style.left = Math.max(8, left) + "px";
		setTimeout(() => document.addEventListener("pointerdown", onDocPointerDown, true), 0);
	}
	function togglePop(kind, anchor) {
		if (pop && pop.dataset.kind === kind) { closePop(); return; }
		if (kind === "pages") { openPop(anchor, pagesPopHtml(), "pages", "heft-pop-pages"); paintPopThumbs(); }
		else if (kind === "plus") openPop(anchor, plusPopHtml(), "plus", "heft-pop-plus");
		else if (kind === "img") openPop(anchor, imgPopHtml(), "img", "heft-pop-img");
	}
	function pagesPopHtml() {
		return '<div class="heft-pop-head">Seiten</div>' +
			'<div class="heft-pop-grid">' + doc.pages.map((_, i) =>
				'<div class="heft-pop-thumb' + (i === idx ? ' active' : '') + '" data-hethumb="' + i + '" role="button" tabindex="0" title="Seite ' + (i + 1) + '">' +
					'<canvas width="92" height="130"></canvas>' +
					'<span>' + (i + 1) + '</span>' +
					(doc.pages.length > 1 ? '<button type="button" class="heft-pop-del" data-hedelpage="' + i + '" title="Seite löschen">🗑</button>' : '') +
				'</div>').join('') + '</div>';
	}
	function paintPopThumbs() {
		if (!pop || pop.dataset.kind !== "pages" || !doc) return;
		pop.querySelectorAll(".heft-pop-thumb canvas").forEach((cv, i) => {
			if (!doc.pages[i]) return;
			const x = cv.getContext("2d");
			const k = cv.width / PAGE_W;
			cv.height = Math.round(PAGE_H * k);
			x.setTransform(k, 0, 0, k, 0, 0);
			renderPageTo(x, doc.pages[i], i);
		});
	}
	function refreshPagesPop() {
		if (!pop || pop.dataset.kind !== "pages" || !doc) return;
		pop.innerHTML = pagesPopHtml();
		paintPopThumbs();
	}
	function imgPopHtml() {
		return '<div class="heft-pop-head">Bilder</div>' +
			'<button type="button" class="heft-pop-row" data-heimgadd="1">🖼 Bild hinzufügen</button>' +
			'<button type="button" class="heft-pop-row" data-heimgcam="1">📷 Bild aufnehmen</button>' +
			'<div class="heft-pop-sub">Eingefügte Bilder mit dem Auswahl-Werkzeug (⬚) verschieben, skalieren oder löschen.</div>';
	}
	function plusPopHtml() {
		const seg = (k, lbl) => '<button type="button" class="heft-seg' + (insertPos === k ? ' active' : '') + '" data-hepos="' + k + '">' + lbl + '</button>';
		const curPaper = page() ? page().paper : "lined";
		const tpl = (p, lbl, sub) =>
			'<button type="button" class="heft-tpl" data-headdtpl="' + p + '">' +
				'<i class="heft-tpl-paper heft-tpl-' + p + '"></i><span>' + lbl + '</span>' + (sub ? '<small>' + sub + '</small>' : '') +
			'</button>';
		return '<div class="heft-pop-head">Seite hinzufügen</div>' +
			'<div class="heft-seg-row">' + seg("before", "Vor dieser") + seg("after", "Nach dieser") + seg("last", "Letzte Seite") + '</div>' +
			'<div class="heft-pop-head">Neue Vorlagen</div>' +
			'<div class="heft-pop-sub">Die hier gezeigten Vorlagen übernehmen wenn möglich die Eigenschaften der aktuellen Seite.</div>' +
			'<div class="heft-tpl-row">' +
				tpl(curPaper, "Aktuelle Vorlage", "A4") +
				PAPERS.filter((p) => p[0] !== curPaper).map((p) => tpl(p[0], p[2], "")).join("") +
			'</div>' +
			'<div class="heft-pop-sep"></div>' +
			'<button type="button" class="heft-pop-row" data-headdimg="1">🖼 Bild</button>' +
			'<button type="button" class="heft-pop-row" data-heimport="1">⭳ Importieren</button>' +
			'<button type="button" class="heft-pop-row" data-hescan="1">📷 Dateien scannen</button>';
	}
	function updateChrome() {
		if (!host || !doc) return;
		const chrome = host.querySelector(".heft-chrome");
		if (chrome) { const t = document.createElement("div"); t.innerHTML = toolbarHtml(); chrome.replaceWith(t.firstChild); }
		else host.insertAdjacentHTML("beforeend", toolbarHtml());
		bindTrayDrag();
		refreshPagesPop();
	}
	function bindTrayDrag() {
		const tray = host && host.querySelector("[data-hetray]");
		if (!tray || tray.dataset.hebound) return;
		tray.dataset.hebound = "1";
		tray.addEventListener("pointerdown", onTrayPointerDown);
		tray.addEventListener("pointermove", onTrayPointerMove);
		tray.addEventListener("pointerup", onTrayPointerUp);
		tray.addEventListener("pointercancel", onTrayPointerUp);
	}
	// Thumbnail im Seiten-Popup aktualisieren (früher: feste Leiste unten)
	function renderThumb(i) {
		if (!pop || pop.dataset.kind !== "pages" || !doc || !doc.pages[i]) return;
		const cv = pop.querySelectorAll(".heft-pop-thumb canvas")[i];
		if (!cv) return;
		const x = cv.getContext("2d");
		const k = cv.width / PAGE_W;
		x.setTransform(1, 0, 0, 1, 0, 0);
		x.clearRect(0, 0, cv.width, cv.height);
		x.setTransform(k, 0, 0, k, 0, 0);
		renderPageTo(x, doc.pages[i], i);
	}

	// ---------- Seiten-Operationen ----------
	function insertIndex() {
		if (!doc) return 0;
		return insertPos === "before" ? idx : insertPos === "last" ? doc.pages.length : idx + 1;
	}
	function go(i) {
		if (!doc) return;
		idx = Math.max(0, Math.min(doc.pages.length - 1, i));
		undoStack = []; redoStack = []; drawing = null;
		const slot = host && host.querySelectorAll(".heft-page-slot")[idx];
		if (slot) slot.scrollIntoView({ behavior: "smooth", block: "center" });
		updateChrome();
	}
	function addPageAt(paper, pageObj) {
		const at = insertIndex();
		doc.pages.splice(at, 0, pageObj || newPage(paper || (page() ? page().paper : "lined")));
		sel = null;
		scheduleSave(); rebuildScroll(); go(at);
	}
	function deletePageAt(i) {
		if (!doc || doc.pages.length <= 1 || !doc.pages[i]) return;
		const pg = doc.pages[i];
		const hasContent = (pg.strokes && pg.strokes.length) || (pg.images && pg.images.length);
		if (hasContent && !confirm("Diese Heftseite wirklich löschen?")) return;
		doc.pages.splice(i, 1);
		sel = null; undoStack = []; redoStack = [];
		scheduleSave(); rebuildScroll(); go(Math.min(i, doc.pages.length - 1));
	}

	// ---------- Bilder einfügen (Datei / Kamera) ----------
	function pickImage(capture, cb) {
		const inp = document.createElement("input");
		inp.type = "file";
		inp.accept = "image/*";
		if (capture) inp.setAttribute("capture", "environment"); // öffnet auf Tablets/Handys direkt die Kamera
		inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) cb(f); };
		inp.click();
	}
	function fileToImageData(f, maxDim) {
		// Datei → verkleinertes JPEG-dataURL (bleibt im Heft-Blob serialisierbar)
		return new Promise((resolve, reject) => {
			const r = new FileReader();
			r.onerror = () => reject(new Error("Datei lesen fehlgeschlagen"));
			r.onload = () => {
				const img = new Image();
				img.onload = () => {
					let w = img.naturalWidth, h = img.naturalHeight;
					const k = Math.min(1, maxDim / Math.max(w, h));
					w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
					const c = document.createElement("canvas");
					c.width = w; c.height = h;
					const x = c.getContext("2d");
					x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); // PNG-Transparenz → weiß
					x.drawImage(img, 0, 0, w, h);
					resolve({ src: c.toDataURL("image/jpeg", 0.86), w, h });
				};
				img.onerror = () => reject(new Error("Bild dekodieren fehlgeschlagen"));
				img.src = r.result;
			};
			r.readAsDataURL(f);
		});
	}
	async function insertImageFile(f) {
		try {
			const pg = page(); if (!pg) return;
			const im = await fileToImageData(f, 1400);
			const k = Math.min((PAGE_W * 0.7) / im.w, (PAGE_H * 0.7) / im.h, 1);
			const img = { id: U.uid(), src: im.src, x: (PAGE_W - im.w * k) / 2, y: (PAGE_H - im.h * k) / 2, w: im.w * k, h: im.h * k };
			imagesOf(pg).push(img);
			undoStack.push({ kind: "imgAdd", img, pageIdx: idx }); redoStack = [];
			sel = { pageIdx: idx, imgId: img.id };
			tool = "select"; // direkt verschieben/skalieren können
			expanded = false; // Auswahl braucht kein Expand-Panel
			scheduleSave(); redrawPage(idx); renderThumb(idx); updateChrome();
		} catch (e) {
			console.warn("Heft: Bild einfügen fehlgeschlagen", e);
			if (U.toast) U.toast("Bild konnte nicht eingefügt werden", "error");
		}
	}
	function imagePage(im, paper, bleed) {
		// Neue Seite mit Bild: bleed=true → randlos (Scans/PDF-Seiten), sonst mit Rand
		const pg = newPage(paper || "blank");
		const pad = bleed ? 0 : 40;
		const k = Math.min((PAGE_W - pad * 2) / im.w, (PAGE_H - pad * 2) / im.h);
		pg.images.push({ id: U.uid(), src: im.src, x: (PAGE_W - im.w * k) / 2, y: (PAGE_H - im.h * k) / 2, w: im.w * k, h: im.h * k });
		return pg;
	}
	async function addImagePageFromFile(f) {
		try {
			const im = await fileToImageData(f, 1600);
			addPageAt(null, imagePage(im, page() ? page().paper : "blank", false));
		} catch (e) { console.warn("Heft: Bild-Seite fehlgeschlagen", e); }
	}

	// ---------- Importieren (Bilder + PDF via pdf.js) ----------
	function importFiles() {
		const inp = document.createElement("input");
		inp.type = "file";
		inp.accept = "image/*,application/pdf";
		inp.multiple = true;
		inp.onchange = async () => {
			const files = Array.from(inp.files || []);
			if (!files.length) return;
			let at = insertIndex();
			for (const f of files) {
				try {
					if (f.type === "application/pdf") at = await importPdf(f, at);
					else if (f.type.startsWith("image/")) {
						const im = await fileToImageData(f, 1600);
						doc.pages.splice(at, 0, imagePage(im, "blank", false)); at++;
					}
				} catch (e) {
					console.warn("Heft: Import fehlgeschlagen", f.name, e);
					if (U.toast) U.toast("Import fehlgeschlagen: " + f.name, "error");
				}
			}
			scheduleSave(); rebuildScroll(); go(Math.max(0, at - 1));
		};
		inp.click();
	}
	async function importPdf(f, at) {
		const lib = window.pdfjsLib;
		if (!lib) {
			if (U.toast) U.toast("PDF-Import braucht pdf.js — bitte einmal den PDF-Bereich öffnen", "error");
			return at;
		}
		const buf = await f.arrayBuffer();
		const pdf = await lib.getDocument({ data: buf }).promise;
		for (let i = 1; i <= pdf.numPages; i++) {
			const p = await pdf.getPage(i);
			const vp = p.getViewport({ scale: 2 });
			const c = document.createElement("canvas");
			c.width = Math.round(vp.width); c.height = Math.round(vp.height);
			await p.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
			doc.pages.splice(at, 0, imagePage({ src: c.toDataURL("image/jpeg", 0.85), w: c.width, h: c.height }, "blank", true));
			at++;
		}
		return at;
	}

	// ---------- Dateien scannen: Dokument-Scanner v2 ----------
	// Wie GoodNotes/Office-Scanner: Aufnahme → automatische Dokumenterkennung →
	// perspektivische Entzerrung → Beleuchtung glätten + Filter → Nachbearbeitung
	// (Ecken ziehen, Filter wechseln, drehen) → PDF und/oder Heftseiten
	const SCAN_MODES = [["color", "Farbe"], ["bw", "S/W"], ["gray", "Graustufen"], ["photo", "Foto"]];
	async function openScanner() {
		if (scanUI) return;
		const wrap = document.createElement("div");
		wrap.className = "heft-scan";
		wrap.innerHTML =
			'<div class="heft-scan-top"><b>Dateien scannen</b><button type="button" data-hescanclose="1" title="Schließen">✕</button></div>' +
			'<div class="heft-scan-stage"><video autoplay playsinline muted></video>' +
				'<svg class="heft-scan-guide" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points="7,7 93,7 93,93 7,93"></polygon></svg>' +
				'<div class="heft-scan-quality" data-hescanquality="1">Kamera wird geprüft…</div>' +
				'<div class="heft-scan-hint">Blatt vollständig in den Rahmen legen. Grün = bereit; bei Gelb Kamera ruhiger halten oder Licht verbessern.</div></div>' +
			'<div class="heft-scan-shots"></div>' +
			'<div class="heft-scan-bar">' +
				'<button type="button" class="heft-scan-shutter" data-hescanshot="1" title="Seite aufnehmen"></button>' +
				'<div class="heft-scan-actions">' +
					'<button type="button" data-hescanautocap="1" class="active" title="Bei ruhigem, gutem Dokument automatisch auslösen">⚡ Auto</button>' +
					'<button type="button" data-hescanpdf="1" disabled>📄 Als PDF speichern</button>' +
					'<button type="button" data-hescanheft="1" disabled>📓 In Heft einfügen</button>' +
				'</div>' +
			'</div>' +
			'<div class="heft-scan-busy" hidden><span>Scan wird aufbereitet…</span></div>';
		document.body.appendChild(wrap);
		scanUI = { wrap, stream: null, shots: [], edit: null, busy: false, liveTimer: 0, liveStable: 0, autoCapture: true, autoCooldown: 0 };
		const ui = scanUI; // Besitzer dieser asynchronen Kamera-Sitzung
		wrap.addEventListener("click", onScanClick);
		try {
			if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("getUserMedia fehlt");
			// Zuerst „environment“, sonst irgendeine Kamera — verhindert OverconstrainedError auf Desktop
			let stream = null;
			try {
				stream = await navigator.mediaDevices.getUserMedia({
					video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
					audio: false,
				});
			} catch {
				stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
			}
			// Während await könnte geschlossen oder ein neuer Scanner geöffnet worden sein.
			if (scanUI !== ui || !wrap.isConnected) { try { stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ } return; }
			ui.stream = stream;
			const video = wrap.querySelector("video");
			video.srcObject = stream;
			video.muted = true;
			video.setAttribute("playsinline", "");
			// iOS/Safari: autoplay allein reicht oft nicht — sonst bleibt videoWidth=0 und der Auslöser tut nichts
			try { await video.play(); } catch (e2) { console.warn("Heft: Video-play blockiert", e2); }
			startLiveQuality(video, ui);
		} catch (e) {
			// Keine Kamera / keine Freigabe → Fallback: Fotos auswählen (mit capture-Hint)
			console.warn("Heft: Kamera nicht verfügbar", e);
			if (scanUI === ui) {
				wrap.querySelector(".heft-scan-stage").innerHTML =
					'<div class="heft-scan-nocam"><p>Keine Kamera verfügbar oder Zugriff abgelehnt.</p>' +
					'<button type="button" data-hescanpick="1">Fotos auswählen…</button></div>';
				const shut = wrap.querySelector(".heft-scan-shutter");
				if (shut) shut.disabled = true;
			}
		}
	}
	function closeScanner() {
		if (!scanUI) return;
		stopLiveQuality();
		try { if (scanUI.stream) scanUI.stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
		try { scanUI.wrap.remove(); } catch { /* ignore */ }
		scanUI = null;
	}
	// Live-Prüfung vor dem Auslösen: Dokument-Quad, Helligkeit und Schärfe.
	// Läuft bewusst nur ca. 3×/s auf einer kleinen Vorschau, nicht auf dem Vollbild.
	function liveQualityFrame(video) {
		const sw = 240, sh = Math.max(120, Math.round(video.videoHeight / Math.max(1, video.videoWidth) * sw));
		const c = document.createElement("canvas"); c.width = sw; c.height = sh;
		const x = c.getContext("2d", { willReadFrequently: true });
		x.drawImage(video, 0, 0, sw, sh);
		const px = x.getImageData(0, 0, sw, sh).data;
		let sum = 0, sum2 = 0, count = 0, lap = 0;
		const lum = new Uint8Array(sw * sh);
		for (let i = 0; i < lum.length; i++) {
			const v = (px[i * 4] * 77 + px[i * 4 + 1] * 150 + px[i * 4 + 2] * 29) >> 8;
			lum[i] = v; sum += v; sum2 += v * v; count++;
		}
		for (let y = 1; y < sh - 1; y += 2) for (let x2 = 1; x2 < sw - 1; x2 += 2) {
			const i = y * sw + x2;
			lap += Math.abs(4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - sw] - lum[i + sw]);
		}
		const mean = sum / count, contrast = Math.sqrt(Math.max(0, sum2 / count - mean * mean));
		const sharp = lap / Math.max(1, ((sw - 2) * (sh - 2)) / 4);
		// Leichter Live-Bounding-Box-Pass: absichtlich nicht detectQuad(), denn die
		// vollständige Kanten-/Morphologie gehört erst zur Aufnahme und würde die Kamera ruckeln lassen.
		const cut = Math.max(105, mean * 0.82);
		let minX = sw, minY = sh, maxX = 0, maxY = 0, hit = 0;
		for (let y = 2; y < sh - 2; y += 2) for (let x2 = 2; x2 < sw - 2; x2 += 2) {
			const i = y * sw + x2;
			if (lum[i] < cut) continue;
			const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
			if (Math.max(r, g, b) - Math.min(r, g, b) > 72) continue; // bunter Tisch ≠ Papier
			hit++;
			if (x2 < minX) minX = x2; if (x2 > maxX) maxX = x2;
			if (y < minY) minY = y; if (y > maxY) maxY = y;
		}
		const bw = maxX - minX, bh = maxY - minY;
		const found = hit > (sw * sh) * 0.018 && bw > sw * 0.28 && bh > sh * 0.28 &&
			minX > 1 && minY > 1 && maxX < sw - 2 && maxY < sh - 2;
		const padX = Math.max(2, bw * 0.025), padY = Math.max(2, bh * 0.025);
		const quad = found
			? [[minX - padX, minY - padY], [maxX + padX, minY - padY], [maxX + padX, maxY + padY], [minX - padX, maxY + padY]]
			: [[sw * .07, sh * .07], [sw * .93, sh * .07], [sw * .93, sh * .93], [sw * .07, sh * .93]];
		return { quad, found, mean, contrast, sharp, sw, sh };
	}
	function setLiveGuide(info) {
		if (!scanUI) return;
		const guide = scanUI.wrap.querySelector(".heft-scan-guide polygon");
		const label = scanUI.wrap.querySelector("[data-hescanquality]");
		if (!guide || !label) return;
		const toPct = (p) => (p[0] / info.sw * 100).toFixed(1) + "," + (p[1] / info.sh * 100).toFixed(1);
		guide.setAttribute("points", info.quad.map(toPct).join(" "));
		const lightOK = info.mean >= 62 && info.mean <= 235;
		const sharpOK = info.sharp >= 8;
		const contrastOK = info.contrast >= 16;
		const ready = info.found && lightOK && sharpOK && contrastOK;
		guide.parentElement.classList.toggle("ready", ready);
		guide.parentElement.classList.toggle("warn", !ready);
		if (ready) label.textContent = "✓ Dokument erkannt · bereit";
		else if (!info.found) label.textContent = "Blatt vollständig in den Rahmen legen";
		else if (!sharpOK) label.textContent = "Kamera ruhiger halten";
		else if (!lightOK) label.textContent = info.mean < 62 ? "Mehr Licht nötig" : "Zu hell / Spiegelung vermeiden";
		else if (!contrastOK) label.textContent = "Kontrast zu gering";
		return ready;
	}
	function startLiveQuality(video, owner) {
		if (!owner || scanUI !== owner) return;
		stopLiveQuality();
		const check = () => {
			if (scanUI !== owner || owner.busy || !video.videoWidth || !video.isConnected) return;
			try {
				const ready = setLiveGuide(liveQualityFrame(video));
				scanUI.liveStable = ready ? scanUI.liveStable + 1 : 0;
				// Drei stabile Prüfrunden (~1 s) verhindern Fehlauslösungen beim Bewegen.
				if (scanUI.autoCapture && ready && scanUI.liveStable >= 3 && Date.now() > scanUI.autoCooldown) {
					scanUI.liveStable = 0;
					scanUI.autoCooldown = Date.now() + 1800;
					scanCapture();
				}
			} catch (e) { console.warn("Heft: Live-Scan-Prüfung fehlgeschlagen", e); }
		};
		check();
		owner.liveTimer = setInterval(check, 340);
	}
	function stopLiveQuality() {
		if (scanUI && scanUI.liveTimer) { clearInterval(scanUI.liveTimer); scanUI.liveTimer = 0; }
	}
	function setScanBusy(on, label) {
		if (!scanUI) return;
		scanUI.busy = !!on;
		const el = scanUI.wrap.querySelector(".heft-scan-busy");
		if (el) {
			el.hidden = !on;
			const sp = el.querySelector("span");
			if (sp && label) sp.textContent = label;
		}
		const shut = scanUI.wrap.querySelector(".heft-scan-shutter");
		if (shut) shut.disabled = !!on;
	}
	function onScanClick(e) {
		const b = e.target.closest("button");
		if (!b || !scanUI) return;
		const d = b.dataset;
		if (d.hescanclose) closeScanner();
		else if (d.hescanshot) scanCapture();
		else if (d.hescanpdf) { if (scanUI.shots.length) scanFinishPdf(); }
		else if (d.hescanheft) { if (scanUI.shots.length) scanFinishHeft(); }
		else if (d.hescanautocap) {
			scanUI.autoCapture = !scanUI.autoCapture;
			b.classList.toggle("active", scanUI.autoCapture);
			b.textContent = scanUI.autoCapture ? "⚡ Auto" : "⚡ Manuell";
		}
		else if (d.hescanpick) scanPickFiles();
		else if (d.hescancompare) {
			const ed = scanUI.edit;
			if (ed) {
				ed.compare = !ed.compare;
				b.textContent = ed.compare ? "◐ Nur Scan" : "◑ Vorher/Nachher";
				const sh = scanUI.shots[ed.i];
				if (sh && sh.out) drawEditResult(sh);
			}
		}
		else if (d.hescancorners) {
			const ed = scanUI.edit;
			if (ed && ed.img) { ed.cornerMode = true; layoutEdit(); }
			else if (U.toast) U.toast("Rohbild wird geladen…");
		}
		else if (d.hescanedit != null) openEdit(Number(d.hescanedit));
		else if (d.hescaneditback) closeEdit();
		else if (d.hescanmode) {
			// Filter sofort anwenden (nicht erst bei Übernehmen) — sonst wirken die Chips „tot"
			if (scanUI.edit) {
				scanUI.edit.mode = d.hescanmode;
				scanUI.edit.el.querySelectorAll("[data-hescanmode]").forEach((m) => m.classList.toggle("active", m.dataset.hescanmode === scanUI.edit.mode));
				liveReprocessEdit();
			}
		}
		else if (d.hescanrot) {
			if (scanUI.edit) {
				scanUI.edit.rot = (scanUI.edit.rot + 1) % 4;
				const rb = scanUI.edit.el.querySelector("[data-hescanrot]");
				if (rb) rb.textContent = "⟳ Drehen" + (scanUI.edit.rot ? " (" + (scanUI.edit.rot * 90) + "°)" : "");
				liveReprocessEdit();
			}
		}
		else if (d.hescanauto) {
			const ed = scanUI.edit;
			if (ed && ed.img) {
				const sh = scanUI.shots[ed.i];
				ed.quad = detectQuad(ed.img, sh.w, sh.h);
				ed.cornerMode = true; // Ecken-Editor am Rohbild
				layoutEdit();
				liveReprocessEdit(); // sofort neu entzerren + aufbereiten
			} else if (ed) {
				// Bild noch am Laden — nach onload erneut versuchen
				if (U.toast) U.toast("Bild wird geladen…");
			}
		}
		else if (d.hescandel) {
			if (scanUI.edit) { const i = scanUI.edit.i; closeEdit(); scanUI.shots.splice(i, 1); renderShots(); }
		}
		else if (d.hescandone) finishEdit();
	}
	async function scanCapture() {
		const owner = scanUI;
		if (!owner || owner.busy) return;
		const video = owner.wrap.querySelector("video");
		if (!video) return;
		// Video noch nicht bereit (häufig auf iOS, wenn play() noch nicht durch ist)
		if (!video.videoWidth || !video.videoHeight) {
			try { await video.play(); } catch { /* ignore */ }
			if (!video.videoWidth) {
				if (U.toast) U.toast("Kamera startet noch — kurz warten und erneut tippen", "error");
				return;
			}
		}
		setScanBusy(true, "Aufnahme wird aufbereitet…");
		try {
			// Bei sehr großen Kamera-Streams begrenzen: spart Speicher ohne sichtbaren Textverlust.
			const cap = 2048, k = Math.min(1, cap / Math.max(video.videoWidth, video.videoHeight));
			const c = document.createElement("canvas");
			c.width = Math.max(2, Math.round(video.videoWidth * k)); c.height = Math.max(2, Math.round(video.videoHeight * k));
			c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
			await addRawScan(c.toDataURL("image/jpeg", 0.92), c.width, c.height, owner);
		} catch (e) {
			console.warn("Heft: Scan fehlgeschlagen", e);
			if (U.toast) U.toast("Scan fehlgeschlagen", "error");
		}
		if (scanUI === owner) setScanBusy(false);
	}
	// Rohbild → Dokument erkennen → entzerren → aufbereiten → in den Scan-Streifen
	async function addRawScan(src, w, h, owner) {
		const img = await loadImg(src);
		// Immer die echten Bildmaße nutzen (sonst stimmen Quad/Warp nicht)
		const iw = img.naturalWidth || w, ih = img.naturalHeight || h;
		const sh = { src, w: iw, h: ih, quad: detectQuad(img, iw, ih), mode: "color", rot: 0, out: null, img };
		await processShot(sh);
		if (scanUI !== owner || !sh.out) return;
		owner.shots.push(sh);
		renderShots();
	}
	function renderShots() {
		if (!scanUI) return;
		const strip = scanUI.wrap.querySelector(".heft-scan-shots");
		if (!strip) return;
		// out kann null sein, wenn die Aufbereitung fehlschlug — dann Rohbild zeigen
		strip.innerHTML = scanUI.shots.map((sh, i) => {
			const src = (sh.out && sh.out.dataUrl) || sh.src;
			return '<button type="button" class="heft-scan-shot" data-hescanedit="' + i + '" title="Scan ' + (i + 1) + ' nachbearbeiten">' +
				'<img src="' + src + '" alt="Scan ' + (i + 1) + '"><span>' + (i + 1) + '</span></button>';
		}).join("");
		strip.scrollLeft = strip.scrollWidth;
		const ready = scanUI.shots.filter((sh) => sh.out && sh.out.dataUrl);
		const n = ready.length;
		const pdfBtn = scanUI.wrap.querySelector("[data-hescanpdf]");
		const heftBtn = scanUI.wrap.querySelector("[data-hescanheft]");
		if (pdfBtn) { pdfBtn.disabled = !n; pdfBtn.textContent = "📄 Als PDF speichern" + (n ? " (" + n + ")" : ""); }
		if (heftBtn) { heftBtn.disabled = !n; heftBtn.textContent = "📓 In Heft einfügen" + (n ? " (" + n + ")" : ""); }
	}
	function scanPickFiles() {
		const inp = document.createElement("input");
		inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
		inp.setAttribute("capture", "environment");
		inp.onchange = async () => {
			const owner = scanUI;
			const files = Array.from(inp.files || []);
			if (!files.length || !owner) return;
			setScanBusy(true, "Fotos werden aufbereitet…");
			for (const f of files) {
				try {
					const im = await fileToImageData(f, 2048);
					if (scanUI !== owner) return;
					await addRawScan(im.src, im.w, im.h, owner);
				} catch (e) {
					console.warn("Heft: Scan-Foto fehlgeschlagen", e);
					if (U.toast) U.toast("Foto konnte nicht gelesen werden", "error");
				}
			}
			if (scanUI === owner) setScanBusy(false);
		};
		inp.click();
	}
	// „Foto"-Filter: Kontrast strecken über 2%/98%-Luminanz-Perzentile — bewusst
	// kanalgleich, damit Farben nicht kippen (für Fotos statt Dokumenten)
	function enhanceScan(cv) {
		const x = cv.getContext("2d");
		const d = x.getImageData(0, 0, cv.width, cv.height);
		const px = d.data;
		const hist = new Uint32Array(256);
		for (let i = 0; i < px.length; i += 4) hist[(px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8]++;
		const total = px.length / 4;
		let lo = 0, hi = 255, acc = 0;
		for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * 0.02) { lo = i; break; } }
		acc = 0;
		for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= total * 0.02) { hi = i; break; } }
		const span = Math.max(1, hi - lo);
		const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
		for (let i = 0; i < px.length; i += 4) {
			px[i] = clamp((px[i] - lo) * 255 / span);
			px[i + 1] = clamp((px[i + 1] - lo) * 255 / span);
			px[i + 2] = clamp((px[i + 2] - lo) * 255 / span);
		}
		x.putImageData(d, 0, 0);
	}
	// ---------- Scanner-Pipeline: Erkennung → Entzerrung → Aufbereitung ----------
	const loadImg = (src) => new Promise((res, rej) => {
		const im = new Image();
		im.onload = () => res(im);
		im.onerror = () => rej(new Error("Bild dekodieren fehlgeschlagen"));
		im.src = src;
	});
	const dist2d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
	function quadArea(q) {
		let a = 0;
		for (let i = 0; i < 4; i++) { const p = q[i], r = q[(i + 1) % 4]; a += p[0] * r[1] - r[0] * p[1]; }
		return Math.abs(a) / 2;
	}
	// Dokumenterkennung v3: helles unbuntes Papier + Kanten + morphologisches Schließen
	// (Text-Löcher füllen) + Rechteck-Score. Deutlich robuster als reine Helligkeits-Flut.
	function detectQuad(img, w, h) {
		const full = [[w * 0.06, h * 0.06], [w * 0.94, h * 0.06], [w * 0.94, h * 0.94], [w * 0.06, h * 0.94]];
		if (!w || !h) return full;
		const dw = 400, kk = dw / w, dh = Math.max(12, Math.round(h * kk));
		const c = document.createElement("canvas");
		c.width = dw; c.height = dh;
		const cx = c.getContext("2d", { willReadFrequently: true });
		cx.drawImage(img, 0, 0, dw, dh);
		const d = cx.getImageData(0, 0, dw, dh).data;
		const n = dw * dh;
		const L = new Float32Array(n), sat = new Float32Array(n);
		let sumL = 0;
		for (let i = 0; i < n; i++) {
			const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
			const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
			const lum = r * 0.299 + g * 0.587 + b * 0.114;
			L[i] = lum; sat[i] = mx ? (mx - mn) / mx : 0; sumL += lum;
		}
		const meanL = sumL / n;
		// 3×3-Boxblur der Luminanz → lokaler Hintergrund
		const blur = new Float32Array(n);
		for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
			let s = 0, ctn = 0;
			for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
				const yy = y + dy, xx = x + dx;
				if (yy < 0 || yy >= dh || xx < 0 || xx >= dw) continue;
				s += L[yy * dw + xx]; ctn++;
			}
			blur[y * dw + x] = s / ctn;
		}
		// Sobel-Kantenstärke (Dokumentrand ist oft dunkler/kontrastreicher)
		const edge = new Float32Array(n);
		for (let y = 1; y < dh - 1; y++) for (let x = 1; x < dw - 1; x++) {
			const i = y * dw + x;
			const gx = -L[i - dw - 1] - 2 * L[i - 1] - L[i + dw - 1] + L[i - dw + 1] + 2 * L[i + 1] + L[i + dw + 1];
			const gy = -L[i - dw - 1] - 2 * L[i - dw] - L[i - dw + 1] + L[i + dw - 1] + 2 * L[i + dw] + L[i + dw + 1];
			edge[i] = Math.hypot(gx, gy);
		}
		// Papier-Maske: hell, relativ unbunt, nahe/über lokalem Hintergrund
		// (schließt Schreibtisch ab, der dunkler oder bunter ist)
		const mask0 = new Uint8Array(n);
		const thrPaper = Math.max(95, meanL * 0.78);
		for (let i = 0; i < n; i++) {
			const paperLike = L[i] >= thrPaper && sat[i] < 0.28 && L[i] >= blur[i] * 0.88;
			mask0[i] = paperLike ? 1 : 0;
		}
		// Morphologisches Schließen: Textlöcher im Blatt füllen (dilate → erode)
		const morph = (src, dilate) => {
			const out = new Uint8Array(n);
			for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
				let v = dilate ? 0 : 1;
				for (let dy = -2; dy <= 2 && (dilate ? !v : v); dy++)
					for (let dx = -2; dx <= 2 && (dilate ? !v : v); dx++) {
						const yy = y + dy, xx = x + dx;
						if (yy < 0 || yy >= dh || xx < 0 || xx >= dw) continue;
						const m = src[yy * dw + xx];
						if (dilate) { if (m) v = 1; } else { if (!m) v = 0; }
					}
				out[y * dw + x] = v;
			}
			return out;
		};
		const mask = morph(morph(mask0, true), false);
		// Zusammenhängende Komponenten bewerten (nicht nur größte Fläche)
		const seen = new Uint8Array(n), stack = new Int32Array(n);
		// Nur Eck-/Flächenwerte speichern, nie alle Pixel einer Komponente als JS-Array.
		let best = null, bestScore = -1;
		for (let s0 = 0; s0 < n; s0++) {
			if (!mask[s0] || seen[s0]) continue;
			let top = 0, minX = dw, maxX = 0, minY = dh, maxY = 0, border = 0, eSum = 0, area = 0;
			let tl = s0, tr = s0, br = s0, bl = s0, vTl = Infinity, vTr = -Infinity, vBr = -Infinity, vBl = Infinity;
			stack[top++] = s0; seen[s0] = 1;
			while (top) {
				const p = stack[--top];
				area++;
				const py = (p / dw) | 0, pxx = p % dw;
				const sm = pxx + py, df = pxx - py;
				if (sm < vTl) { vTl = sm; tl = p; }
				if (sm > vBr) { vBr = sm; br = p; }
				if (df > vTr) { vTr = df; tr = p; }
				if (df < vBl) { vBl = df; bl = p; }
				if (pxx < minX) minX = pxx; if (pxx > maxX) maxX = pxx;
				if (py < minY) minY = py; if (py > maxY) maxY = py;
				if (pxx <= 1 || py <= 1 || pxx >= dw - 2 || py >= dh - 2) border++;
				eSum += edge[p];
				if (pxx > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[top++] = p - 1; }
				if (pxx < dw - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[top++] = p + 1; }
				if (py > 0 && mask[p - dw] && !seen[p - dw]) { seen[p - dw] = 1; stack[top++] = p - dw; }
				if (py < dh - 1 && mask[p + dw] && !seen[p + dw]) { seen[p + dw] = 1; stack[top++] = p + dw; }
			}
			if (area < n * 0.08 || area > n * 0.96) continue; // zu klein / fast ganzes Bild = Tisch
			const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
			const rectFill = area / (bw * bh); // wie rechteckig die Fläche ist
			const borderFrac = border / area;
			const aspect = bw / bh;
			const aspectOk = aspect > 0.35 && aspect < 2.9 ? 1 : 0.45;
			// guter Dokument-Score: Fläche, Füllgrad, wenig Bildrand, etwas Kante am Rand
			const sc = area * (0.35 + rectFill) * aspectOk * (1 - Math.min(0.7, borderFrac * 2)) * (1 + Math.min(1.2, eSum / (area * 40)));
			if (sc > bestScore) { bestScore = sc; best = { tl, tr, br, bl }; }
		}
		if (!best) return full;
		// Ecken der besten Komponente: direkt aus dem Flood-Fill übernommen.
		let tl = best.tl, tr = best.tr, br = best.br, bl = best.bl;
		// Ecken an starken Kanten feinjustieren (±3 px)
		const snap = (p) => {
			const y0 = (p / dw) | 0, x0 = p % dw;
			let bestP = p, bestE = edge[p];
			for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
				const yy = y0 + dy, xx = x0 + dx;
				if (yy < 1 || yy >= dh - 1 || xx < 1 || xx >= dw - 1) continue;
				const i = yy * dw + xx;
				if (edge[i] > bestE) { bestE = edge[i]; bestP = i; }
			}
			return bestP;
		};
		tl = snap(tl); tr = snap(tr); br = snap(br); bl = snap(bl);
		const pt = (p) => [(p % dw) / kk, ((p / dw) | 0) / kk];
		const q = [pt(tl), pt(tr), pt(br), pt(bl)];
		// Plausibilität
		const areaQ = quadArea(q);
		if (areaQ < w * h * 0.10 || areaQ > w * h * 0.97) return full;
		for (let i = 0; i < 4; i++) if (dist2d(q[i], q[(i + 1) % 4]) < Math.min(w, h) * 0.12) return full;
		// Konvexität prüfen: bei einem gültigen Quad zeigen ALLE vier
		// Kanten-Drehungen in dieselbe Richtung. Die frühere Prüfung verglich
		// zwei Punkte an derselben Kante und verwarf dadurch sogar gute Rechtecke.
		const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
		const turns = [cross(q[0], q[1], q[2]), cross(q[1], q[2], q[3]), cross(q[2], q[3], q[0]), cross(q[3], q[0], q[1])];
		const pos = turns.every((v) => v > 0), neg = turns.every((v) => v < 0);
		if (!pos && !neg) return full; // Selbstkreuzung oder eingeknickte Ecken
		return q;
	}
	// Homographie Ziel-Rechteck → Quell-Quad: 8×8-Gleichungssystem, Gauß mit Pivot
	function homography(quad, W, H) {
		const dst = [[0, 0], [W, 0], [W, H], [0, H]];
		const A = [], b = [];
		for (let i = 0; i < 4; i++) {
			const X = dst[i][0], Y = dst[i][1], x = quad[i][0], y = quad[i][1];
			A.push([X, Y, 1, 0, 0, 0, -X * x, -Y * x]); b.push(x);
			A.push([0, 0, 0, X, Y, 1, -X * y, -Y * y]); b.push(y);
		}
		for (let c = 0; c < 8; c++) {
			let piv = c;
			for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
			const tA = A[c]; A[c] = A[piv]; A[piv] = tA;
			const tb = b[c]; b[c] = b[piv]; b[piv] = tb;
			const pv = A[c][c] || 1e-9;
			for (let r = c + 1; r < 8; r++) {
				const f = A[r][c] / pv;
				for (let k2 = c; k2 < 8; k2++) A[r][k2] -= f * A[c][k2];
				b[r] -= f * b[c];
			}
		}
		const hm = new Float64Array(8);
		for (let r = 7; r >= 0; r--) {
			let s = b[r];
			for (let k2 = r + 1; k2 < 8; k2++) s -= A[r][k2] * hm[k2];
			hm[r] = s / (A[r][r] || 1e-9);
		}
		return hm; // srcX = (h0·X + h1·Y + h2) / (h6·X + h7·Y + 1), srcY analog
	}
	// Perspektivische Entzerrung: Zielgröße aus den Kantenlängen des Quads,
	// Rückwärts-Mapping mit bilinearem Sampling — kein Verzerren, keine Treppen
	function warpPerspective(img, iw, ih, quad) {
		// Defensive: echte Natural-Größe, falls w/h und Image auseinanderlaufen
		const nw = img.naturalWidth || iw, nh = img.naturalHeight || ih;
		if (nw !== iw || nh !== ih) {
			const sx = nw / iw, sy = nh / ih;
			quad = quad.map((p) => [p[0] * sx, p[1] * sy]);
			iw = nw; ih = nh;
		}
		let W = Math.round(Math.max(dist2d(quad[0], quad[1]), dist2d(quad[3], quad[2])));
		let H = Math.round(Math.max(dist2d(quad[0], quad[3]), dist2d(quad[1], quad[2])));
		// Ausgabe auf 1280 px begrenzen, Eingabe separat auf 1800 px: gleiche Lesbarkeit,
		// deutlich weniger Speicher als ein Vollauflösungs-Canvas der Kamera.
		const k = Math.min(1, 1280 / Math.max(W, H, 1));
		W = Math.max(8, Math.round(W * k));
		H = Math.max(8, Math.round(H * k));
		const sourceScale = Math.min(1, 1800 / Math.max(iw, ih, 1));
		if (sourceScale < 1) {
			quad = quad.map((p) => [p[0] * sourceScale, p[1] * sourceScale]);
			iw = Math.max(2, Math.round(iw * sourceScale));
			ih = Math.max(2, Math.round(ih * sourceScale));
		}
		const sc = document.createElement("canvas");
		sc.width = iw; sc.height = ih;
		const scx = sc.getContext("2d", { willReadFrequently: true });
		// Explizit auf iw×ih skalieren — sonst leere/falsche Pixel wenn Maße nicht passen
		scx.drawImage(img, 0, 0, iw, ih);
		const sd = scx.getImageData(0, 0, iw, ih).data;
		const out = document.createElement("canvas");
		out.width = W; out.height = H;
		const ox = out.getContext("2d");
		const od = ox.createImageData(W, H);
		const op = od.data;
		const hm = homography(quad, W, H);
		for (let y = 0; y < H; y++) {
			for (let x = 0; x < W; x++) {
				const den = hm[6] * x + hm[7] * y + 1;
				let sx = (hm[0] * x + hm[1] * y + hm[2]) / den;
				let sy = (hm[3] * x + hm[4] * y + hm[5]) / den;
				if (sx < 0) sx = 0; else if (sx > iw - 1.001) sx = iw - 1.001;
				if (sy < 0) sy = 0; else if (sy > ih - 1.001) sy = ih - 1.001;
				const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
				const i00 = (y0 * iw + x0) * 4, i10 = i00 + 4, i01 = i00 + iw * 4, i11 = i01 + 4;
				const o = (y * W + x) * 4;
				op[o] = sd[i00] * (1 - fx) * (1 - fy) + sd[i10] * fx * (1 - fy) + sd[i01] * (1 - fx) * fy + sd[i11] * fx * fy;
				op[o + 1] = sd[i00 + 1] * (1 - fx) * (1 - fy) + sd[i10 + 1] * fx * (1 - fy) + sd[i01 + 1] * (1 - fx) * fy + sd[i11 + 1] * fx * fy;
				op[o + 2] = sd[i00 + 2] * (1 - fx) * (1 - fy) + sd[i10 + 2] * fx * (1 - fy) + sd[i01 + 2] * (1 - fx) * fy + sd[i11 + 2] * fx * fy;
				op[o + 3] = 255;
			}
		}
		ox.putImageData(od, 0, 0);
		return out;
	}
	// Beleuchtungskarte des Papiers: stark verkleinern, 2× Max-Filter (Text fällt aus
	// der Schätzung heraus), 2× Box-Blur — beim Anwenden bilinear hochgerechnet
	function backgroundMap(cv) {
		const bw = Math.max(8, Math.round(cv.width / 16));
		const bh = Math.max(8, Math.round(cv.height / 16));
		const c = document.createElement("canvas");
		c.width = bw; c.height = bh;
		const cx = c.getContext("2d");
		cx.drawImage(cv, 0, 0, bw, bh);
		const d = cx.getImageData(0, 0, bw, bh).data;
		let m = new Float32Array(bw * bh);
		for (let i = 0; i < bw * bh; i++) m[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8;
		const pass3x3 = (src, useMax) => {
			const dst = new Float32Array(bw * bh);
			for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
				let acc = 0, cnt = 0;
				for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
					const yy = Math.min(bh - 1, Math.max(0, y + dy));
					const xx = Math.min(bw - 1, Math.max(0, x + dx));
					const v = src[yy * bw + xx];
					if (useMax) { if (v > acc) acc = v; } else { acc += v; cnt++; }
				}
				dst[y * bw + x] = useMax ? acc : acc / cnt;
			}
			return dst;
		};
		m = pass3x3(pass3x3(m, true), true);
		m = pass3x3(pass3x3(m, false), false);
		return { map: m, bw, bh };
	}
	function sampleMap(bg, fx, fy) {
		const bw = bg.bw, bh = bg.bh, m = bg.map;
		let x = fx - 0.5, y = fy - 0.5;
		if (x < 0) x = 0; else if (x > bw - 1.001) x = bw - 1.001;
		if (y < 0) y = 0; else if (y > bh - 1.001) y = bh - 1.001;
		const x0 = x | 0, y0 = y | 0, dx = x - x0, dy = y - y0;
		return m[y0 * bw + x0] * (1 - dx) * (1 - dy) + m[y0 * bw + x0 + 1] * dx * (1 - dy) +
			m[(y0 + 1) * bw + x0] * (1 - dx) * dy + m[(y0 + 1) * bw + x0 + 1] * dx * dy;
	}
	// Scan-Aufbereitung v3 — bewusst aggressiv, damit der Unterschied zum Rohfoto
	// sofort erkennbar ist (wie Office Lens / GoodNotes):
	// 1) Beleuchtung rausrechnen  2) Papier → weiß, Tinte → dunkler  3) leichter Unsharp
	// 4) S/W mit harter, aber weicher Schwelle
	function applyScanMode(cv, mode) {
		if (mode === "photo") { enhanceScan(cv); return; }
		const w = cv.width, h = cv.height;
		const x = cv.getContext("2d", { willReadFrequently: true });
		const bg = backgroundMap(cv);
		const d = x.getImageData(0, 0, w, h);
		const px = d.data;
		const kx = bg.bw / w, ky = bg.bh / h;
		const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
		// Starke Papier-Aufhellung + Tinte halten (S-Kurve nach Weißabgleich)
		const docTone = (v) => {
			// Weißabgleich schon geschehen: v ≈ 0…255 auf weißem Papier
			// helles Papier knallweiß, dunkle Striche dunkler
			let t = Math.max(0, Math.min(1, v / 255));
			// S-Kurve: Mitte absenken (Text), oben anheben (Papier)
			t = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
			// extra Push: alles über ~0.72 → Richtung 1.0
			if (t > 0.72) t = 0.72 + (t - 0.72) * 1.9;
			if (t < 0.35) t = t * 0.85;
			return clamp(t * 255);
		};
		for (let y = 0; y < h; y++) {
			const fy = y * ky;
			for (let x2 = 0; x2 < w; x2++) {
				const i = (y * w + x2) * 4;
				const g = Math.max(36, sampleMap(bg, x2 * kx, fy));
				// Weißabgleich: durch geschätzte Papierhelligkeit teilen
				let r = clamp(px[i] * 255 / g);
				let g2 = clamp(px[i + 1] * 255 / g);
				let b = clamp(px[i + 2] * 255 / g);
				if (mode === "color") {
					px[i] = docTone(r);
					px[i + 1] = docTone(g2);
					px[i + 2] = docTone(b);
				} else {
					const v = docTone((r * 77 + g2 * 150 + b * 29) >> 8);
					let o;
					if (mode === "bw") {
						// Smoothstep 110…200 — Text schwarz, Papier weiß, klar erkennbar
						let t = (v - 110) / 90;
						t = t < 0 ? 0 : t > 1 ? 1 : t;
						o = clamp(255 * t * t * (3 - 2 * t));
					} else {
						o = clamp((v - 128) * 1.45 + 128);
					}
					px[i] = px[i + 1] = px[i + 2] = o;
				}
			}
		}
		// Leichter Unsharp-Mask (Text schärfer, Scan-Look)
		const copy = new Uint8ClampedArray(px);
		const amount = 0.55;
		for (let y = 1; y < h - 1; y++) {
			for (let x2 = 1; x2 < w - 1; x2++) {
				const i = (y * w + x2) * 4;
				for (let c = 0; c < 3; c++) {
					const c0 = copy[i + c];
					const blur =
						(copy[i - w * 4 + c] + copy[i + w * 4 + c] + copy[i - 4 + c] + copy[i + 4 + c] + c0 * 4) / 8;
					px[i + c] = clamp(c0 + (c0 - blur) * amount);
				}
			}
		}
		x.putImageData(d, 0, 0);
	}
	// 90°-Drehung(en) für die Nachbearbeitung
	function rotateCanvas(cv, rot) {
		const r = ((rot % 4) + 4) % 4;
		if (!r) return cv;
		const c = document.createElement("canvas");
		if (r === 2) { c.width = cv.width; c.height = cv.height; } else { c.width = cv.height; c.height = cv.width; }
		const x = c.getContext("2d");
		x.translate(c.width / 2, c.height / 2);
		x.rotate(r * Math.PI / 2);
		x.drawImage(cv, -cv.width / 2, -cv.height / 2);
		return c;
	}
	// Ein Scan: Rohbild → entzerren → Filter → Drehung → fertige Scan-Seite
	// tick() gibt dem Browser zwischen den schweren Schritten Luft (sonst „eingefroren“)
	const tick = () => new Promise((r) => setTimeout(r, 0));
	async function processShot(sh) {
		// Rohbild je Scan nur einmal dekodieren — Filter/Drehen/Ecken nutzen denselben Cache.
		const img = sh.img || await loadImg(sh.src);
		sh.img = img;
		sh.w = img.naturalWidth || sh.w;
		sh.h = img.naturalHeight || sh.h;
		// Immer frisch erkennen, wenn kein manuelles Quad gesetzt — oder wenn das alte
		// Quad praktisch das ganze Bild ist (alte schlechte Erkennung)
		const needDetect = !Array.isArray(sh.quad) || sh.quad.length !== 4 ||
			quadArea(sh.quad) > sh.w * sh.h * 0.92;
		if (needDetect) sh.quad = detectQuad(img, sh.w, sh.h);
		await tick();
		let cv = warpPerspective(img, sh.w, sh.h, sh.quad);
		await tick();
		applyScanMode(cv, sh.mode || "color");
		await tick();
		if (sh.rot) cv = rotateCanvas(cv, sh.rot);
		// JPEG etwas höher — Scan-Text bleibt schärfer
		sh.out = { dataUrl: cv.toDataURL("image/jpeg", 0.92), w: cv.width, h: cv.height };
	}

	// ---------- Scan-Nachbearbeitung: Ecken ziehen, Filter, Drehen ----------
	// Schreibt Edit-Zustand zurück und rechnet den Scan SOFORT neu (Filter/Drehen/Auto
	// sind damit echte Aktionen — nicht erst beim Schließen der Ansicht).
	let liveSeq = 0;
	async function liveReprocessEdit() {
		const owner = scanUI;
		const ed = owner && owner.edit;
		if (!ed || !owner) return;
		const sh = owner.shots[ed.i];
		if (!sh) return;
		sh.quad = ed.quad.map((p) => p.slice());
		sh.mode = ed.mode;
		sh.rot = ed.rot;
		const seq = ++liveSeq;
		setScanBusy(true, "Filter wird angewendet…");
		try {
			await processShot(sh);
			// Scanner geschlossen/gewechselt oder neuere Aktion: Ergebnis nicht mehr in alte UI schreiben.
			if (scanUI !== owner || seq !== liveSeq) return;
			renderShots();
			if (owner.edit && owner.edit.el === ed && sh.out) drawEditResult(sh);
		} catch (e) {
			console.warn("Heft: Live-Aufbereitung fehlgeschlagen", e);
			if (scanUI === owner && U.toast) U.toast("Scan-Aufbereitung fehlgeschlagen", "error");
		} finally {
			if (scanUI === owner && seq === liveSeq) setScanBusy(false);
		}
	}
	// Nach Filter/Drehen: fertiges Ergebnis im Edit-Canvas anzeigen.
	// Auf Wunsch mit echter Vorher/Nachher-Teilung statt einer kaum sichtbaren Änderung.
	function drawEditResult(sh) {
		const ed = scanUI && scanUI.edit;
		if (!ed || !sh.out) return;
		const stage = ed.el.querySelector(".heft-scan-editstage");
		const cv = ed.el.querySelector("canvas");
		if (!stage || !cv) return;
		const img = new Image();
		img.onload = () => {
			if (!scanUI || !scanUI.edit || scanUI.edit.el !== ed) return;
			const k = Math.max(0.02, Math.min((stage.clientWidth - 24) / img.naturalWidth, (stage.clientHeight - 24) / img.naturalHeight));
			cv.width = Math.max(1, Math.round(img.naturalWidth * k));
			cv.height = Math.max(1, Math.round(img.naturalHeight * k));
			const x = cv.getContext("2d");
			x.clearRect(0, 0, cv.width, cv.height);
			if (ed.compare && ed.img) {
				const half = cv.width / 2;
				// Rohbild links; aufbereitete, entzerrte Seite rechts.
				x.drawImage(ed.img, 0, 0, half, cv.height);
				x.drawImage(img, half, 0, half, cv.height);
				x.fillStyle = "rgba(3,5,10,.7)";
				x.fillRect(0, 0, half, 21); x.fillRect(half, 0, half, 21);
				x.strokeStyle = "rgba(255,255,255,.8)"; x.lineWidth = 2;
				x.beginPath(); x.moveTo(half, 0); x.lineTo(half, cv.height); x.stroke();
				x.fillStyle = "#fff"; x.font = "600 11px -apple-system,sans-serif"; x.textAlign = "center";
				x.fillText("VORHER", half / 2, 14); x.fillText("AUFBEREITET", half + half / 2, 14);
			} else {
				x.drawImage(img, 0, 0, cv.width, cv.height);
			}
			x.fillStyle = "rgba(3,5,10,0.55)";
			x.fillRect(0, cv.height - 22, cv.width, 22);
			x.fillStyle = "rgba(255,255,255,0.88)";
			x.font = "11px -apple-system,sans-serif";
			x.textAlign = "center";
			x.fillText(ed.compare ? "Links Rohfoto · rechts entzerrter und aufbereiteter Scan" : "Aufbereitet · Ecken anpassen für manuellen Zuschnitt", cv.width / 2, cv.height - 7);
		};
		img.src = sh.out.dataUrl;
	}
	function openEdit(i) {
		const sh = scanUI.shots[i];
		if (!sh) return;
		closeEdit();
		const ed = document.createElement("div");
		ed.className = "heft-scan-edit";
		ed.innerHTML =
			'<div class="heft-scan-top"><b>Scan ' + (i + 1) + ' bearbeiten</b><button type="button" data-hescaneditback="1" title="Zurück">✕</button></div>' +
			'<div class="heft-scan-editstage"><canvas></canvas></div>' +
			'<div class="heft-scan-modes">' + SCAN_MODES.map((m) =>
				'<button type="button" data-hescanmode="' + m[0] + '" class="' + (sh.mode === m[0] ? "active" : "") + '">' + m[1] + '</button>').join("") + '</div>' +
			'<div class="heft-scan-editbar">' +
				'<button type="button" data-hescancompare="1">◑ Vorher/Nachher</button>' +
				'<button type="button" data-hescancorners="1">⌜ Ecken anpassen</button>' +
				'<button type="button" data-hescanrot="1">⟳ Drehen' + (sh.rot ? " (" + (sh.rot * 90) + "°)" : "") + '</button>' +
				'<button type="button" data-hescanauto="1">◱ Auto-Zuschnitt</button>' +
				'<button type="button" data-hescandel="1">🗑 Löschen</button>' +
				'<button type="button" class="heft-scan-apply" data-hescandone="1">✓ Fertig</button>' +
			'</div>';
		scanUI.wrap.appendChild(ed);
		scanUI.edit = { i, el: ed, quad: (sh.quad || []).map((p) => p.slice()), mode: sh.mode || "color", rot: sh.rot || 0, img: null, drag: -1, k: 1, cornerMode: false, compare: false };
		const cv = ed.querySelector("canvas");
		cv.addEventListener("pointerdown", onEditDown);
		cv.addEventListener("pointermove", onEditMove);
		cv.addEventListener("pointerup", onEditUp);
		cv.addEventListener("pointercancel", onEditUp);
		// Zuerst fertiges Ergebnis zeigen; bereits dekodiertes Rohbild wiederverwenden.
		if (sh.out) drawEditResult(sh);
		const setRaw = (img) => {
			if (scanUI && scanUI.edit && scanUI.edit.el === ed) {
				scanUI.edit.img = img;
				if (!sh.out) layoutEdit();
			}
		};
		if (sh.img) setRaw(sh.img);
		else loadImg(sh.src).then((img) => { sh.img = img; setRaw(img); }).catch((e) => console.warn("Heft: Rohbild laden fehlgeschlagen", e));
	}
	function closeEdit() {
		if (scanUI && scanUI.edit) { scanUI.edit.el.remove(); scanUI.edit = null; }
	}
	function layoutEdit() {
		const ed = scanUI && scanUI.edit;
		if (!ed || !ed.img) return;
		const stage = ed.el.querySelector(".heft-scan-editstage");
		const cv = ed.el.querySelector("canvas");
		const sh = scanUI.shots[ed.i];
		ed.k = Math.max(0.02, Math.min((stage.clientWidth - 24) / sh.w, (stage.clientHeight - 24) / sh.h));
		cv.width = Math.max(1, Math.round(sh.w * ed.k));
		cv.height = Math.max(1, Math.round(sh.h * ed.k));
		drawEdit();
	}
	function drawEdit() {
		const ed = scanUI && scanUI.edit;
		if (!ed || !ed.img) return;
		const cv = ed.el.querySelector("canvas");
		const x = cv.getContext("2d");
		const k = ed.k, q = ed.quad;
		x.clearRect(0, 0, cv.width, cv.height);
		x.drawImage(ed.img, 0, 0, cv.width, cv.height);
		// Außenbereich abdunkeln (evenodd: Rechteck minus Quad)
		x.save();
		x.fillStyle = "rgba(3,5,10,0.55)";
		x.beginPath();
		x.rect(0, 0, cv.width, cv.height);
		x.moveTo(q[0][0] * k, q[0][1] * k);
		for (let i = 3; i >= 1; i--) x.lineTo(q[i][0] * k, q[i][1] * k);
		x.closePath();
		x.fill("evenodd");
		x.restore();
		// Rahmen + Eck-Griffe
		x.strokeStyle = "#6fc3ff"; x.lineWidth = 2;
		x.beginPath();
		x.moveTo(q[0][0] * k, q[0][1] * k);
		for (let i = 1; i < 4; i++) x.lineTo(q[i][0] * k, q[i][1] * k);
		x.closePath();
		x.stroke();
		q.forEach((p) => {
			x.beginPath(); x.arc(p[0] * k, p[1] * k, 10, 0, Math.PI * 2);
			x.fillStyle = "rgba(111,195,255,0.25)"; x.fill();
			x.beginPath(); x.arc(p[0] * k, p[1] * k, 5, 0, Math.PI * 2);
			x.fillStyle = "#6fc3ff"; x.fill();
		});
	}
	function editPos(e, cv) {
		const r = cv.getBoundingClientRect();
		// CSS kann das Canvas skalieren — auf Buffer-Koordinaten umrechnen, dann /k → Bildkoordinaten
		const sx = cv.width / Math.max(1, r.width);
		const sy = cv.height / Math.max(1, r.height);
		const k = (scanUI.edit && scanUI.edit.k) || 1;
		return [((e.clientX - r.left) * sx) / k, ((e.clientY - r.top) * sy) / k];
	}
	function onEditDown(e) {
		const ed = scanUI && scanUI.edit;
		if (!ed || !ed.img) return;
		// Tippen auf die fertige Vorschau → Ecken-Modus (Rohbild + Griffe)
		if (!ed.cornerMode) {
			ed.cornerMode = true;
			layoutEdit();
			return;
		}
		e.preventDefault();
		e.currentTarget.setPointerCapture(e.pointerId);
		const p = editPos(e, e.currentTarget);
		const rr = 34 / ed.k;
		let best = -1, bd = rr * rr;
		ed.quad.forEach((q, i) => {
			const dx = q[0] - p[0], dy = q[1] - p[1];
			if (dx * dx + dy * dy <= bd) { bd = dx * dx + dy * dy; best = i; }
		});
		ed.drag = best;
	}
	function onEditMove(e) {
		const ed = scanUI && scanUI.edit;
		if (!ed || ed.drag < 0) return;
		e.preventDefault();
		const sh = scanUI.shots[ed.i];
		const p = editPos(e, e.currentTarget);
		ed.quad[ed.drag] = [Math.min(sh.w, Math.max(0, p[0])), Math.min(sh.h, Math.max(0, p[1]))];
		drawEdit();
	}
	function onEditUp() {
		const ed = scanUI && scanUI.edit;
		if (!ed) return;
		const was = ed.drag;
		ed.drag = -1;
		// Nach dem Ziehen einer Ecke: sofort neu entzerren + Filter anwenden
		if (was >= 0) liveReprocessEdit();
	}
	async function finishEdit() {
		// Filter/Drehen/Ecken laufen live — „Fertig" speichert nur den Stand und schließt
		const owner = scanUI;
		const ed = owner && owner.edit;
		if (!ed || !owner) return;
		const sh = owner.shots[ed.i];
		if (sh) {
			sh.quad = ed.quad.map((p) => p.slice());
			sh.mode = ed.mode;
			sh.rot = ed.rot;
			// Falls noch kein out (z.B. Live noch am Laufen): einmal sicher nachrechnen
			if (!sh.out) {
				setScanBusy(true, "Scan wird aufbereitet…");
				try { await processShot(sh); } catch (e2) { console.warn("Heft: Scan aufbereiten fehlgeschlagen", e2); }
				if (scanUI === owner) setScanBusy(false);
			}
		}
		if (scanUI !== owner) return;
		closeEdit();
		renderShots();
	}
	// Minimaler PDF-1.4-Writer: je Scan eine A4-Seite mit eingebettetem JPEG (DCTDecode).
	// Keine externe Lib nötig — erzeugt ein echtes, überall lesbares PDF.
	function buildPdf(shots) {
		const tenc = new TextEncoder();
		const parts = [];
		const offsets = [];
		let len = 0;
		const push = (u8) => { parts.push(u8); len += u8.length; };
		const pushStr = (s) => push(tenc.encode(s));
		const A4W = "595.28", A4H = "841.89";
		pushStr("%PDF-1.4\n");
		const n = shots.length;
		const pageObj = (i) => 3 + i * 3, imgObj = (i) => 4 + i * 3, cntObj = (i) => 5 + i * 3;
		const obj = (num, body) => { offsets[num] = len; pushStr(num + " 0 obj\n" + body + "\nendobj\n"); };
		obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
		obj(2, "<< /Type /Pages /Kids [" + shots.map((_, i) => pageObj(i) + " 0 R").join(" ") + "] /Count " + n + " >>");
		shots.forEach((sh, i) => {
			const k = Math.min(595.28 / sh.w, 841.89 / sh.h);
			const w = sh.w * k, h = sh.h * k, ox = (595.28 - w) / 2, oy = (841.89 - h) / 2;
			obj(pageObj(i), "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + A4W + " " + A4H + "] " +
				"/Resources << /XObject << /Im" + i + " " + imgObj(i) + " 0 R >> >> /Contents " + cntObj(i) + " 0 R >>");
			const jpg = dataUrlBytes(sh.dataUrl);
			offsets[imgObj(i)] = len;
			pushStr(imgObj(i) + " 0 obj\n<< /Type /XObject /Subtype /Image /Width " + sh.w + " /Height " + sh.h +
				" /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + jpg.length + " >>\nstream\n");
			push(jpg);
			pushStr("\nendstream\nendobj\n");
			const cs = "q " + w.toFixed(2) + " 0 0 " + h.toFixed(2) + " " + ox.toFixed(2) + " " + oy.toFixed(2) + " cm /Im" + i + " Do Q";
			obj(cntObj(i), "<< /Length " + cs.length + " >>\nstream\n" + cs + "\nendstream");
		});
		const xrefAt = len;
		const count = 3 + n * 3;
		let xref = "xref\n0 " + count + "\n0000000000 65535 f \n";
		for (let i = 1; i < count; i++) xref += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
		pushStr(xref + "trailer\n<< /Size " + count + " /Root 1 0 R >>\nstartxref\n" + xrefAt + "\n%%EOF");
		const out = new Uint8Array(len);
		let o = 0;
		parts.forEach((p) => { out.set(p, o); o += p.length; });
		return out;
	}
	function dataUrlBytes(du) {
		const bin = atob(du.slice(du.indexOf(",") + 1));
		const u = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
		return u;
	}
	function scanFinishPdf() {
		try {
			const outs = scanUI.shots.map((sh) => sh.out).filter((o) => o && o.dataUrl && o.w && o.h);
			if (!outs.length) { if (U.toast) U.toast("Keine fertigen Scans zum Export", "error"); return; }
			const bytes = buildPdf(outs);
			U.downloadBlob("scan-" + new Date().toISOString().slice(0, 10) + ".pdf", new Blob([bytes], { type: "application/pdf" }));
			if (U.toast) U.toast("PDF mit " + outs.length + " Seite(n) gespeichert");
		} catch (e) {
			console.warn("Heft: PDF erzeugen fehlgeschlagen", e);
			if (U.toast) U.toast("PDF konnte nicht erzeugt werden", "error");
		}
	}
	function scanFinishHeft() {
		const outs = scanUI.shots.map((sh) => sh.out).filter((o) => o && o.dataUrl && o.w && o.h);
		closeScanner();
		if (!doc || !outs.length) {
			if (U.toast) U.toast("Keine fertigen Scans zum Einfügen", "error");
			return;
		}
		let at = insertIndex();
		outs.forEach((o) => { doc.pages.splice(at, 0, imagePage({ src: o.dataUrl, w: o.w, h: o.h }, "blank", true)); at++; });
		scheduleSave(); rebuildScroll(); go(at - 1);
		if (U.toast) U.toast(outs.length + " Scan(s) als Heftseiten eingefügt");
	}

	// ---------- Klicks (delegiert am Host — fängt auch die Popups) ----------
	// Lokale OCR: Canvas wird direkt im Browser erkannt, Text wird im Heft-Blob gespeichert.
	async function searchHandwriting() {
		if (!doc || ocrBusy) return;
		const query = prompt("Handschrift durchsuchen\n\nSuchbegriff eingeben. Leere Eingabe indexiert zuerst die aktuelle Seite.", "");
		if (query && query.trim()) {
			const q = query.trim().toLocaleLowerCase("de");
			const found = doc.pages.findIndex((p) => (p.ocrText || "").toLocaleLowerCase("de").includes(q));
			if (found >= 0) { go(found); if (U.toast) U.toast("Treffer auf Seite " + (found + 1)); }
			else if (U.toast) U.toast("Kein Treffer in indexierten Seiten — Seite zuerst mit ⌕ indexieren.");
			return;
		}
		if (!window.Tesseract || !window.Tesseract.recognize) {
			if (U.toast) U.toast("OCR-Modul wird noch geladen — danach erneut versuchen.", "error");
			return;
		}
		const cv = host && host.querySelectorAll(".heft-canvas")[idx];
		if (!cv) return;
		ocrBusy = true; updateChrome();
		try {
			if (U.toast) U.toast("Handschrift wird lokal erkannt…");
			const result = await window.Tesseract.recognize(cv, "deu+eng", { logger: () => {} });
			const text = ((result && result.data && result.data.text) || "").trim();
			page().ocrText = text;
			scheduleSave();
			if (U.toast) U.toast(text ? "Seite indexiert — ⌕ durchsucht nun die Handschrift." : "Kein Text erkannt.", text ? "success" : "error");
		} catch (err) {
			console.warn("Heft: OCR fehlgeschlagen", err);
			if (U.toast) U.toast("Texterkennung konnte nicht geladen werden.", "error");
		} finally { ocrBusy = false; updateChrome(); }
	}
	function onHostClick(e) {
		const b = e.target.closest("button, .heft-pop-thumb");
		if (!b || !doc) return;
		const d = b.dataset;
		if (suppressEraserClick && d.hetool === "eraser") return;
		if (d.heocr) { searchHandwriting(); return; }
		if (d.hepagesmenu) { togglePop("pages", b); return; }
		if (d.heplusmenu) { togglePop("plus", b); return; }
		if (d.heimgmenu) { togglePop("img", b); return; }
		if (d.hedelpage != null) { e.stopPropagation(); deletePageAt(Number(d.hedelpage)); return; }
		if (d.hethumb != null) { go(Number(d.hethumb)); return; }
		if (d.hepos) {
			insertPos = d.hepos;
			if (pop) pop.querySelectorAll(".heft-seg").forEach((s) => s.classList.toggle("active", s.dataset.hepos === insertPos));
			return;
		}
		if (d.headdtpl) { closePop(); addPageAt(d.headdtpl); return; }
		if (d.headdimg) { closePop(); pickImage(false, addImagePageFromFile); return; }
		if (d.heimport) { closePop(); importFiles(); return; }
		if (d.hescan) { closePop(); openScanner(); return; }
		if (d.heimgadd) { closePop(); pickImage(false, insertImageFile); return; }
		if (d.heimgcam) { closePop(); pickImage(true, insertImageFile); return; }
		if (d.hewrite) {
			// Schreiben-Gruppe: erneut tippen klappt Optionen zu, sonst Stift + Expand
			if (tool === "pen" || tool === "marker") expanded = !expanded;
			else { tool = "pen"; expanded = true; }
			if (sel) { const spi = sel.pageIdx; sel = null; redrawPage(spi); }
		}
		else if (d.hetool) {
			if (d.hetool === "eraser") {
				if (tool === "eraser") expanded = !expanded;
				else { tool = "eraser"; expanded = true; }
			} else if (d.hetool === "pen" || d.hetool === "marker") {
				// Variante im Expand-Panel — Optionen bleiben offen
				tool = d.hetool; expanded = true;
			} else {
				// Auswahl, Lasso und Laser: kein Options-Tray
				tool = d.hetool; expanded = false;
			}
			if (tool !== "lasso") lassoSel = null;
			if (tool !== "select" && sel) { const spi = sel.pageIdx; sel = null; redrawPage(spi); }
		}
		else if (d.hecolor) {
			color = d.hecolor;
			if (tool === "eraser" || tool === "select") { tool = "pen"; expanded = true; }
		}
		else if (d.hesize) size = parseFloat(d.hesize);
		else if (d.heundo) { undo(); return; }
		else if (d.heredo) { redo(); return; }
		else if (d.heonlypen) { onlyPen = !onlyPen; if (!onlyPen) penSeen = false; }
		else if (d.hepapercycle) {
			const pg = page(); if (!pg) return;
			const i = PAPERS.findIndex((p) => p[0] === pg.paper);
			pg.paper = PAPERS[(i + 1) % PAPERS.length][0];
			redrawPage(idx); scheduleSave(); renderThumb(idx);
		}
		else if (d.hechat) {
			// Chat-Panel wieder einblenden (Heft läuft im Fokus-Modus)
			document.body.classList.remove("panel-collapsed");
			try { if (window.RENDER && window.RENDER.renderTabs) window.RENDER.renderTabs(); } catch { /* ignore */ }
			return;
		}
		else return;
		updateChrome();
	}
	function onKey(e) {
		const t = e.target;
		if (t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
		if (e.key === "Escape") {
			if (scanUI && scanUI.edit) { e.preventDefault(); closeEdit(); }
			else if (scanUI) { e.preventDefault(); closeScanner(); }
			else if (pop) { e.preventDefault(); closePop(); }
			return;
		}
		if ((e.key === "Delete" || e.key === "Backspace") && lassoSel && doc) {
			const pg = doc.pages[lassoSel.pageIdx];
			if (pg) {
				e.preventDefault();
				const strokes = lassoSel.strokes.slice();
				pg.strokes = pg.strokes.filter((s) => !strokes.includes(s));
				undoStack.push({ kind: "lassoDel", strokes, pageIdx: lassoSel.pageIdx }); redoStack = [];
				const lpi = lassoSel.pageIdx; lassoSel = null;
				scheduleSave(); redrawPage(lpi); renderThumb(lpi); updateChrome();
			}
			return;
		}
		if ((e.key === "Delete" || e.key === "Backspace") && sel && doc) {
			const pg = doc.pages[sel.pageIdx];
			const im = pg && imagesOf(pg).find((i2) => i2.id === sel.imgId);
			if (im) {
				e.preventDefault();
				pg.images = pg.images.filter((i2) => i2 !== im);
				undoStack.push({ kind: "imgDel", img: im, pageIdx: sel.pageIdx }); redoStack = [];
				const spi = sel.pageIdx; sel = null;
				scheduleSave(); redrawPage(spi); renderThumb(spi); updateChrome();
			}
			return;
		}
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
			e.preventDefault();
			if (e.shiftKey) redo(); else undo();
		}
	}

	// ---------- Scroll: aktuelle Seite erkennen (debounced) ----------
	function onScroll() {
		if (!host || !doc) return;
		clearTimeout(onScroll.t);
		onScroll.t = setTimeout(() => {
			if (!host || !doc) return;
			const scroll = host.querySelector(".heft-scroll");
			if (!scroll) return;
			const mid = scroll.getBoundingClientRect().top + scroll.clientHeight / 2;
			let best = 0, bestD = Infinity;
			pageSlots.forEach((slot, i) => {
				if (!slot) return;
				const r = slot.getBoundingClientRect();
				const d2 = Math.abs((r.top + r.bottom) / 2 - mid);
				if (d2 < bestD) { bestD = d2; best = i; }
			});
			if (best !== idx) { idx = best; updateChrome(); }
		}, 80);
	}

	// ---------- Mount / Unmount ----------
	// Radierer gedrückt halten: temporär radieren, beim Loslassen automatisch zum vorherigen Tool zurück.
	function onHostPointerDown(e) {
		const eraser = e.target.closest && e.target.closest('[data-hetool="eraser"]');
		if (!eraser || e.button > 0) return;
		clearTimeout(holdTimer);
		holdTimer = setTimeout(() => {
			holdTool = tool; tool = "eraser"; expanded = false; suppressEraserClick = true; updateChrome();
		}, 380);
	}
	function onHostPointerUp() {
		clearTimeout(holdTimer);
		if (!holdTool) return;
		tool = holdTool; holdTool = null; updateChrome();
		setTimeout(() => { suppressEraserClick = false; }, 0);
	}
	function bindCanvas() {
		// DOM-Suche nur nach Mount/Rebuild; Zeichnen greift anschließend direkt zu.
		canvases = host ? [...host.querySelectorAll(".heft-canvas")] : [];
		pageSlots = canvases.map((cv) => cv.closest(".heft-page-slot"));
		canvases.forEach((cv) => {
			cv.addEventListener("pointerdown", onDown);
			cv.addEventListener("pointermove", onMove);
			cv.addEventListener("pointerup", onUp);
			cv.addEventListener("pointercancel", onUp);
			// Separat von der Zeichenlogik: Finger scrollen/zoomen direkt auf dem Blatt.
			cv.addEventListener("pointerdown", onTouchPointerDown, { passive: false });
			cv.addEventListener("pointermove", onTouchPointerMove, { passive: false });
			cv.addEventListener("pointerup", onTouchPointerUp, { passive: false });
			cv.addEventListener("pointercancel", onTouchPointerUp, { passive: false });
		});
	}
	function bindScroll() {
		const scroll = host.querySelector(".heft-scroll");
		if (scroll) { scrollFn = onScroll; scroll.addEventListener("scroll", scrollFn, { passive: true }); }
	}
	function rebuildScroll() {
		if (!host || !doc) return;
		const scroll = host.querySelector(".heft-scroll");
		if (!scroll) return;
		const keep = scroll.scrollTop;
		scroll.innerHTML = doc.pages.map((_, i) =>
			'<div class="heft-page-slot" data-hepage="' + i + '">' +
				'<canvas class="heft-canvas"></canvas>' +
				'<span class="heft-page-label">Seite ' + (i + 1) + '</span>' +
			'</div>'
		).join('');
		bindCanvas();
		layout();
		scroll.scrollTop = keep;
	}
	async function mount(container, pageId) {
		unmount();
		host = container;
		pid = pageId;
		if (getComputedStyle(host).position === "static") host.style.position = "relative";
		doc = await load(pageId);
		if (pid !== pageId) return; // während des Ladens weggewechselt
		idx = 0; sel = null; undoStack = []; redoStack = []; insertPos = "after";
		zoom = 1; touchPointers.clear(); pinch = null;
		expanded = false; // Floating-Pill startet kompakt — Options erst nach Klick
		// Haupt-Pill ist immer fest. Tray startet direkt darunter und kann danach verschoben werden.
		trayPos = null; trayDrag = null;
		host.innerHTML = viewHtml();
		host.addEventListener("click", onHostClick);
		host.addEventListener("pointerdown", onHostPointerDown);
		host.addEventListener("pointerup", onHostPointerUp);
		host.addEventListener("pointercancel", onHostPointerUp);
		document.addEventListener("keydown", onKey);
		resizeFn = () => layout();
		window.addEventListener("resize", resizeFn);
		bindCanvas();
		bindScroll();
		bindTrayDrag();
		layout();
		purgeOrphanLegacyInk();
	}
	function unmount() {
		closePop();
		closeScanner();
		if (saveT) saveNow(); // bewusst ohne await — saveNow macht vorher einen Schnappschuss
		if (host) {
			host.removeEventListener("click", onHostClick);
			host.removeEventListener("pointerdown", onHostPointerDown);
			host.removeEventListener("pointerup", onHostPointerUp);
			host.removeEventListener("pointercancel", onHostPointerUp);
			host.innerHTML = "";
		}
		document.removeEventListener("keydown", onKey);
		if (resizeFn) { window.removeEventListener("resize", resizeFn); resizeFn = null; }
		scrollFn = null;
		host = null; pid = null; doc = null; idx = 0; canvases = []; pageSlots = [];
		drawing = null; sel = null; lassoSel = null; undoStack = []; redoStack = [];
		laserTimers.forEach(clearTimeout); laserTimers.clear();
		clearTimeout(holdTimer); holdTool = null; suppressEraserClick = false;
		touchPointers.clear(); pinch = null; touchTap = null;
		trayDrag = null;
	}

	// ---------- Thumbnails + Embeds (für Bibliothek und :::heft-Blöcke) ----------
	async function thumbnail(pageId, pageIndex, width) {
		const i = pageIndex || 0, w = width || 220;
		const key = pageId + ":" + i + ":" + w;
		if (thumbs[key]) return thumbs[key];
		// Bibliothek und Einbettungen können dieselbe Vorschau gleichzeitig anfordern.
		// Ein gemeinsames Promise verhindert doppelte Canvas-Renders in diesem Fall.
		if (thumbJobs[key]) return thumbJobs[key];
		const job = (async () => {
			const d = await load(pageId);
			const pg = d.pages[i];
			if (!pg) return null;
			const c = document.createElement("canvas");
			const k = w / PAGE_W;
			c.width = w; c.height = Math.round(PAGE_H * k);
			const x = c.getContext("2d");
			x.setTransform(k, 0, 0, k, 0, 0);
			renderPageTo(x, pg, -1);
			const url = c.toDataURL("image/png");
			thumbs[key] = url;
			return url;
		})();
		thumbJobs[key] = job;
		try { return await job; }
		finally { delete thumbJobs[key]; }
	}
	async function hydrateEmbeds(root) {
		const nodes = (root || document).querySelectorAll("[data-heftembed]");
		for (const el of nodes) {
			const id = el.dataset.heftembed;
			if (!id || el.dataset.heftdone) continue;
			el.dataset.heftdone = "1";
			try {
				const url = await thumbnail(id, 0, 320);
				if (url) el.innerHTML = '<img class="heft-embed-img" src="' + url + '" alt="Heft-Vorschau">' +
					'<span class="heft-embed-label">📓 ' + U.esc((S.pages[id] && S.pages[id].title) || "Heft") + " · " + pagesOf(id) + " Seite(n)</span>";
			} catch (e) { console.warn("Heft: Embed-Vorschau fehlgeschlagen", e); }
		}
	}

	return {
		mount, unmount, saveNow, hasHeft, pagesOf, thumbnail, hydrateEmbeds,
		get activeId() { return pid; },
	};
})();