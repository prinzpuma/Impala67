"use strict";
import { S, STATE } from "./state.js";
import { DB } from "./db.js";
import { U } from "./util.js";

// heft.js — GoodNotes-Kern für Impala67.
//
// Taskbar v3 (11. Juli 2026):
// - Links: „Seiten" öffnet ein Popup mit Thumbnails (Springen/Löschen) — keine fixe Leiste unten mehr
// - Mitte: Stift / Marker / Radierer / Auswahl (⬚ für Bilder), Farben, Stärken, Bilder-Option (🖼),
//   Undo/Redo, Papier-Umschalter, Palm-Rejection
// - Rechts: ✦ Chat und ＋ (neue Seite): Vor dieser / Nach dieser / Letzte Seite, Vorlagen,
//   Bild, Importieren (Bilder + PDF via pdf.js), Dateien scannen (echter PDF-Scanner)
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
	const imgCache = {}; // imageId → HTMLImageElement (dekodierte Bild-Objekte)
	let host = null, pid = null, doc = null, idx = 0, scale = 1;
	// onlyPen default true: Palm Rejection für Apple Pencil
	let tool = "pen", color = COLORS[0], size = 3, onlyPen = true, penSeen = false;
	let drawing = null, saveT = 0, resizeFn = null, scrollFn = null;
	let undoStack = [], redoStack = [];
	let sel = null;          // { pageIdx, imgId } — ausgewähltes Bild (Auswahl-Werkzeug)
	let insertPos = "after"; // ＋-Menü: "before" | "after" | "last"
	let pop = null;          // offenes Toolbar-Popup (Seiten / Bilder / ＋)
	let scanUI = null;       // Scanner-Overlay { wrap, stream, shots[], edit, busy }

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
		if (s.tool === "marker") {
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
				if (host && doc) { redraw(); refreshPagesPop(); }
			};
			c.src = im.src;
			imgCache[im.id] = c;
		}
		return c;
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
		if (sel && doc && sel.pageIdx === pi && doc.pages[pi] === pg) {
			const im = imagesOf(pg).find((i2) => i2.id === sel.imgId);
			if (im) drawSelection(x, im);
		}
	}
	function applyTransform(x) { const dpr = window.devicePixelRatio || 1; x.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0); }
	function redrawPage(i) {
		if (!doc || !doc.pages[i]) return;
		const cv = host && host.querySelectorAll('.heft-canvas')[i];
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
		scale = Math.max(0.1, Math.min(availW / PAGE_W, 1));
		const dpr = window.devicePixelRatio || 1;
		const cssW = Math.round(PAGE_W * scale), cssH = Math.round(PAGE_H * scale);
		host.querySelectorAll('.heft-canvas').forEach((cv) => {
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
		undoStack.push(a); redrawPage(pi); scheduleSave(); renderThumb(pi); updateChrome();
	}

	// ---------- Taskbar v3: links Seiten-Popup · Mitte Werkzeuge · rechts ＋-Menü ----------
	function toolbarHtml() {
		const curPaper = page() ? page().paper : "lined";
		const paperMeta = PAPERS.find((p) => p[0] === curPaper) || PAPERS[0];
		const sizeDot = (sz) => {
			const px = sz[1] <= 2 ? 6 : sz[1] <= 4 ? 9 : 13;
			return '<button type="button" class="heft-size' + (size === sz[1] ? " active" : "") +
				'" data-hesize="' + sz[1] + '" title="Strich: ' + sz[0] + '">' +
				'<i style="width:' + px + 'px;height:' + px + 'px"></i></button>';
		};
		return '<div class="heft-toolbar">' +
			'<div class="heft-tb-left">' +
				'<button type="button" class="heft-action' + (pop && pop.dataset.kind === "pages" ? " active" : "") +
					'" data-hepagesmenu="1" title="Seiten anzeigen">▤ Seiten' +
					'<span class="heft-pageno-inline">' + (idx + 1) + '/' + doc.pages.length + '</span></button>' +
			"</div>" +
			'<div class="heft-tb-center">' +
				'<div class="heft-toolgroup" role="group" aria-label="Werkzeug">' +
					'<button type="button" data-hetool="pen" class="' + (tool === "pen" ? "active" : "") + '" title="Stift">✎</button>' +
					'<button type="button" data-hetool="marker" class="' + (tool === "marker" ? "active" : "") + '" title="Marker">▮</button>' +
					'<button type="button" data-hetool="eraser" class="' + (tool === "eraser" ? "active" : "") + '" title="Radierer">⌫</button>' +
					'<button type="button" data-hetool="select" class="' + (tool === "select" ? "active" : "") + '" title="Auswahl — Bilder verschieben/skalieren/löschen">⬚</button>' +
				"</div>" +
				'<div class="heft-toolgroup" role="group" aria-label="Farbe">' +
					COLORS.map((c) => '<button type="button" class="heft-swatch' + (color === c ? " active" : "") +
						'" data-hecolor="' + c + '" style="--sw:' + c + '" title="Farbe"></button>').join("") +
				"</div>" +
				'<div class="heft-toolgroup" role="group" aria-label="Stärke">' +
					SIZES.map(sizeDot).join("") +
				"</div>" +
				'<div class="heft-toolgroup" role="group" aria-label="Bilder">' +
					'<button type="button" data-heimgmenu="1" class="' + (pop && pop.dataset.kind === "img" ? "active" : "") + '" title="Bilder — hinzufügen oder aufnehmen">🖼</button>' +
				"</div>" +
				'<div class="heft-toolgroup" role="group" aria-label="Verlauf">' +
					'<button type="button" data-heundo="1" title="Rückgängig (Strg+Z)"' + (undoStack.length ? "" : " disabled") + '>↺</button>' +
					'<button type="button" data-heredo="1" title="Wiederholen"' + (redoStack.length ? "" : " disabled") + '>↻</button>' +
				"</div>" +
				'<div class="heft-toolgroup" role="group" aria-label="Papier">' +
					'<button type="button" data-hepapercycle="1" title="Papier: ' + paperMeta[2] + ' (tippen zum Wechseln)">' +
						paperMeta[1] + ' <span class="heft-paper-label">' + paperMeta[2] + '</span></button>' +
					'<button type="button" data-heonlypen="1" class="' + (onlyPen ? "active" : "") +
						'" title="' + (onlyPen ? "Nur Stift zeichnet" : "Finger dürfen zeichnen") + '">' +
						(onlyPen ? "🖊" : "✋") + "</button>" +
				"</div>" +
			"</div>" +
			'<div class="heft-tb-right">' +
				'<button type="button" class="heft-action heft-chat" data-hechat="1" title="KI-Chat öffnen">✦ Chat</button>' +
				'<button type="button" class="heft-action heft-plus' + (pop && pop.dataset.kind === "plus" ? " active" : "") +
					'" data-heplusmenu="1" title="Seite hinzufügen">＋</button>' +
			"</div>" +
		"</div>";
	}
	function viewHtml() {
		const pages = doc.pages.map((_, i) =>
			'<div class="heft-page-slot" data-hepage="' + i + '">' +
				'<canvas class="heft-canvas"></canvas>' +
				'<span class="heft-page-label">Seite ' + (i + 1) + '</span>' +
			'</div>'
		).join('');
		return toolbarHtml() + '<div class="heft-scroll">' + pages + '</div>';
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
		const tb = host.querySelector(".heft-toolbar");
		if (tb) { const t = document.createElement("div"); t.innerHTML = toolbarHtml(); tb.replaceWith(t.firstChild); }
		refreshPagesPop();
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
			'<div class="heft-scan-stage"><video autoplay playsinline muted></video><div class="heft-scan-frame"></div>' +
				'<div class="heft-scan-hint">Dokument flach in den Rahmen halten — Zuschnitt und Aufbereitung passieren automatisch. Scans unten antippen zum Nachbearbeiten.</div></div>' +
			'<div class="heft-scan-shots"></div>' +
			'<div class="heft-scan-bar">' +
				'<button type="button" class="heft-scan-shutter" data-hescanshot="1" title="Seite aufnehmen"></button>' +
				'<div class="heft-scan-actions">' +
					'<button type="button" data-hescanpdf="1" disabled>📄 Als PDF speichern</button>' +
					'<button type="button" data-hescanheft="1" disabled>📓 In Heft einfügen</button>' +
				'</div>' +
			'</div>';
		document.body.appendChild(wrap);
		scanUI = { wrap, stream: null, shots: [], edit: null, busy: false };
		wrap.addEventListener("click", onScanClick);
		try {
			scanUI.stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: "environment", width: { ideal: 2048 }, height: { ideal: 1536 } },
				audio: false,
			});
			if (!scanUI) { try { scanUI = null; } catch { } return; }
			wrap.querySelector("video").srcObject = scanUI.stream;
		} catch (e) {
			// Keine Kamera / keine Freigabe → Fallback: Fotos auswählen (mit capture-Hint)
			console.warn("Heft: Kamera nicht verfügbar", e);
			if (scanUI) {
				wrap.querySelector(".heft-scan-stage").innerHTML =
					'<div class="heft-scan-nocam"><p>Keine Kamera verfügbar oder Zugriff abgelehnt.</p>' +
					'<button type="button" data-hescanpick="1">Fotos auswählen…</button></div>';
				wrap.querySelector(".heft-scan-shutter").disabled = true;
			}
		}
	}
	function closeScanner() {
		if (!scanUI) return;
		try { if (scanUI.stream) scanUI.stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
		scanUI.wrap.remove();
		scanUI = null;
	}
	function onScanClick(e) {
		const b = e.target.closest("button");
		if (!b || !scanUI) return;
		const d = b.dataset;
		if (d.hescanclose) closeScanner();
		else if (d.hescanshot) scanCapture();
		else if (d.hescanpdf) { if (scanUI.shots.length) scanFinishPdf(); }
		else if (d.hescanheft) { if (scanUI.shots.length) scanFinishHeft(); }
		else if (d.hescanpick) scanPickFiles();
		else if (d.hescanedit != null) openEdit(Number(d.hescanedit));
		else if (d.hescaneditback) closeEdit();
		else if (d.hescanmode) {
			if (scanUI.edit) {
				scanUI.edit.mode = d.hescanmode;
				scanUI.edit.el.querySelectorAll("[data-hescanmode]").forEach((m) => m.classList.toggle("active", m.dataset.hescanmode === scanUI.edit.mode));
			}
		}
		else if (d.hescanrot) { if (scanUI.edit) scanUI.edit.rot = (scanUI.edit.rot + 1) % 4; }
		else if (d.hescanauto) {
			const ed = scanUI.edit;
			if (ed && ed.img) { const sh = scanUI.shots[ed.i]; ed.quad = detectQuad(ed.img, sh.w, sh.h); drawEdit(); }
		}
		else if (d.hescandel) {
			if (scanUI.edit) { const i = scanUI.edit.i; closeEdit(); scanUI.shots.splice(i, 1); renderShots(); }
		}
		else if (d.hescandone) finishEdit();
	}
	async function scanCapture() {
		const video = scanUI.wrap.querySelector("video");
		if (!video || !video.videoWidth || scanUI.busy) return;
		scanUI.busy = true;
		const shut = scanUI.wrap.querySelector(".heft-scan-shutter");
		if (shut) shut.disabled = true;
		try {
			const c = document.createElement("canvas");
			c.width = video.videoWidth; c.height = video.videoHeight;
			c.getContext("2d").drawImage(video, 0, 0);
			await addRawScan(c.toDataURL("image/jpeg", 0.92), c.width, c.height);
		} catch (e) { console.warn("Heft: Scan fehlgeschlagen", e); }
		if (scanUI) {
			scanUI.busy = false;
			const s2 = scanUI.wrap.querySelector(".heft-scan-shutter");
			if (s2) s2.disabled = false;
		}
	}
	// Rohbild → Dokument erkennen → entzerren → aufbereiten → in den Scan-Streifen
	async function addRawScan(src, w, h) {
		const img = await loadImg(src);
		const sh = { src, w, h, quad: detectQuad(img, w, h), mode: "color", rot: 0, out: null };
		await processShot(sh);
		if (!scanUI) return;
		scanUI.shots.push(sh);
		renderShots();
	}
	function renderShots() {
		if (!scanUI) return;
		const strip = scanUI.wrap.querySelector(".heft-scan-shots");
		strip.innerHTML = scanUI.shots.map((sh, i) =>
			'<button type="button" class="heft-scan-shot" data-hescanedit="' + i + '" title="Scan ' + (i + 1) + ' nachbearbeiten">' +
				'<img src="' + sh.out.dataUrl + '" alt="Scan ' + (i + 1) + '"><span>' + (i + 1) + '</span></button>').join("");
		strip.scrollLeft = strip.scrollWidth;
		const n = scanUI.shots.length;
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
			for (const f of Array.from(inp.files || [])) {
				try {
					const im = await fileToImageData(f, 2400);
					if (!scanUI) return;
					await addRawScan(im.src, im.w, im.h);
				} catch (e) { console.warn("Heft: Scan-Foto fehlgeschlagen", e); }
			}
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
	// Automatische Dokumenterkennung: Papier = größte helle, unbunte zusammenhängende
	// Fläche. Verkleinert analysieren, Flood-Fill, Ecken über Extremwerte von x±y.
	// Findet sich nichts Plausibles, bleibt ein voller Rahmen mit 4% Rand.
	function detectQuad(img, w, h) {
		const dw = 320, kk = dw / w, dh = Math.max(8, Math.round(h * kk));
		const c = document.createElement("canvas");
		c.width = dw; c.height = dh;
		const cx = c.getContext("2d");
		cx.drawImage(img, 0, 0, dw, dh);
		const d = cx.getImageData(0, 0, dw, dh).data;
		const n = dw * dh;
		const score = new Float32Array(n);
		let mean = 0;
		for (let i = 0; i < n; i++) {
			const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
			const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
			const v = mx - (mx - mn) * 0.9; // hell und unbunt → hoher Wert (Papier)
			score[i] = v; mean += v;
		}
		mean /= n;
		let hiMean = 0, hiN = 0;
		for (let i = 0; i < n; i++) if (score[i] > mean) { hiMean += score[i]; hiN++; }
		const thr = hiN ? (mean + hiMean / hiN) / 2 : mean;
		const mask = new Uint8Array(n);
		for (let i = 0; i < n; i++) mask[i] = score[i] >= thr ? 1 : 0;
		// Größte zusammenhängende Fläche (iterativer Flood-Fill, 4er-Nachbarschaft)
		const seen = new Uint8Array(n), stack = new Int32Array(n);
		let best = null, bestSize = 0;
		for (let s0 = 0; s0 < n; s0++) {
			if (!mask[s0] || seen[s0]) continue;
			let top = 0;
			stack[top++] = s0; seen[s0] = 1;
			const px = [];
			while (top) {
				const p = stack[--top];
				px.push(p);
				const py = (p / dw) | 0, pxx = p % dw;
				if (pxx > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[top++] = p - 1; }
				if (pxx < dw - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[top++] = p + 1; }
				if (py > 0 && mask[p - dw] && !seen[p - dw]) { seen[p - dw] = 1; stack[top++] = p - dw; }
				if (py < dh - 1 && mask[p + dw] && !seen[p + dw]) { seen[p + dw] = 1; stack[top++] = p + dw; }
			}
			if (px.length > bestSize) { bestSize = px.length; best = px; }
		}
		const full = [[w * 0.04, h * 0.04], [w * 0.96, h * 0.04], [w * 0.96, h * 0.96], [w * 0.04, h * 0.96]];
		if (!best || bestSize < n * 0.12) return full;
		let tl = 0, tr = 0, br = 0, bl = 0, vTl = Infinity, vTr = -Infinity, vBr = -Infinity, vBl = Infinity;
		for (const p of best) {
			const py = (p / dw) | 0, pxx = p % dw;
			const s = pxx + py, df = pxx - py;
			if (s < vTl) { vTl = s; tl = p; }
			if (s > vBr) { vBr = s; br = p; }
			if (df > vTr) { vTr = df; tr = p; }
			if (df < vBl) { vBl = df; bl = p; }
		}
		const pt = (p) => [(p % dw) / kk, ((p / dw) | 0) / kk];
		const q = [pt(tl), pt(tr), pt(br), pt(bl)];
		// Plausibilität: genug Fläche, keine entarteten Kanten — sonst voller Rahmen
		if (quadArea(q) < w * h * 0.15) return full;
		for (let i = 0; i < 4; i++) if (dist2d(q[i], q[(i + 1) % 4]) < Math.min(w, h) * 0.15) return full;
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
		let W = Math.round(Math.max(dist2d(quad[0], quad[1]), dist2d(quad[3], quad[2])));
		let H = Math.round(Math.max(dist2d(quad[0], quad[3]), dist2d(quad[1], quad[2])));
		const k = Math.min(1, 1600 / Math.max(W, H));
		W = Math.max(8, Math.round(W * k));
		H = Math.max(8, Math.round(H * k));
		const sc = document.createElement("canvas");
		sc.width = iw; sc.height = ih;
		const scx = sc.getContext("2d");
		scx.drawImage(img, 0, 0);
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
	// Filter: „Farbe" teilt jeden Kanal durch die Beleuchtung (Papier → weiß, Schatten
	// weg, Farben bleiben), „S/W" legt eine weiche Schwelle darüber (Text tiefschwarz),
	// „Graustufen" entfernt Farbe mit etwas Kontrast, „Foto" = enhanceScan (Perzentile)
	function applyScanMode(cv, mode) {
		if (mode === "photo") { enhanceScan(cv); return; }
		const w = cv.width, h = cv.height;
		const x = cv.getContext("2d");
		const bg = backgroundMap(cv);
		const d = x.getImageData(0, 0, w, h);
		const px = d.data;
		const kx = bg.bw / w, ky = bg.bh / h;
		const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
		for (let y = 0; y < h; y++) {
			const fy = y * ky;
			for (let x2 = 0; x2 < w; x2++) {
				const i = (y * w + x2) * 4;
				const g = Math.max(48, sampleMap(bg, x2 * kx, fy));
				if (mode === "color") {
					px[i] = clamp(px[i] * 255 / g);
					px[i + 1] = clamp(px[i + 1] * 255 / g);
					px[i + 2] = clamp(px[i + 2] * 255 / g);
				} else {
					const v = clamp(((px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8) * 255 / g);
					let o;
					if (mode === "bw") {
						// Weiche Schwelle (Smoothstep 140…210): Text tiefschwarz, Papier reinweiß
						let t = (v - 140) / 70;
						t = t < 0 ? 0 : t > 1 ? 1 : t;
						o = 255 * t * t * (3 - 2 * t);
					} else {
						o = clamp((v - 128) * 1.15 + 128); // Graustufen mit etwas Kontrast
					}
					px[i] = px[i + 1] = px[i + 2] = o;
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
	async function processShot(sh) {
		const img = await loadImg(sh.src);
		let cv = warpPerspective(img, sh.w, sh.h, sh.quad);
		applyScanMode(cv, sh.mode);
		if (sh.rot) cv = rotateCanvas(cv, sh.rot);
		sh.out = { dataUrl: cv.toDataURL("image/jpeg", 0.9), w: cv.width, h: cv.height };
	}

	// ---------- Scan-Nachbearbeitung: Ecken ziehen, Filter, Drehen ----------
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
				'<button type="button" data-hescanrot="1">⟳ Drehen</button>' +
				'<button type="button" data-hescanauto="1">◱ Auto-Zuschnitt</button>' +
				'<button type="button" data-hescandel="1">🗑 Löschen</button>' +
				'<button type="button" class="heft-scan-apply" data-hescandone="1">✓ Übernehmen</button>' +
			'</div>';
		scanUI.wrap.appendChild(ed);
		scanUI.edit = { i, el: ed, quad: sh.quad.map((p) => p.slice()), mode: sh.mode, rot: sh.rot, img: null, drag: -1, k: 1 };
		const cv = ed.querySelector("canvas");
		cv.addEventListener("pointerdown", onEditDown);
		cv.addEventListener("pointermove", onEditMove);
		cv.addEventListener("pointerup", onEditUp);
		cv.addEventListener("pointercancel", onEditUp);
		loadImg(sh.src).then((img) => { if (scanUI && scanUI.edit && scanUI.edit.el === ed) { scanUI.edit.img = img; layoutEdit(); } });
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
		return [(e.clientX - r.left) / scanUI.edit.k, (e.clientY - r.top) / scanUI.edit.k];
	}
	function onEditDown(e) {
		const ed = scanUI && scanUI.edit;
		if (!ed || !ed.img) return;
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
	function onEditUp() { if (scanUI && scanUI.edit) scanUI.edit.drag = -1; }
	async function finishEdit() {
		const ed = scanUI.edit;
		if (!ed) return;
		const sh = scanUI.shots[ed.i];
		sh.quad = ed.quad.map((p) => p.slice());
		sh.mode = ed.mode;
		sh.rot = ed.rot;
		closeEdit();
		try { await processShot(sh); } catch (e2) { console.warn("Heft: Scan aufbereiten fehlgeschlagen", e2); }
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
			const bytes = buildPdf(scanUI.shots.map((sh) => sh.out));
			U.downloadBlob("scan-" + new Date().toISOString().slice(0, 10) + ".pdf", new Blob([bytes], { type: "application/pdf" }));
			if (U.toast) U.toast("PDF mit " + scanUI.shots.length + " Seite(n) gespeichert");
		} catch (e) {
			console.warn("Heft: PDF erzeugen fehlgeschlagen", e);
			if (U.toast) U.toast("PDF konnte nicht erzeugt werden", "error");
		}
	}
	function scanFinishHeft() {
		const outs = scanUI.shots.map((sh) => sh.out);
		closeScanner();
		if (!doc || !outs.length) return;
		let at = insertIndex();
		outs.forEach((o) => { doc.pages.splice(at, 0, imagePage({ src: o.dataUrl, w: o.w, h: o.h }, "blank", true)); at++; });
		scheduleSave(); rebuildScroll(); go(at - 1);
		if (U.toast) U.toast(outs.length + " Scan(s) als Heftseiten eingefügt");
	}

	// ---------- Klicks (delegiert am Host — fängt auch die Popups) ----------
	function onHostClick(e) {
		const b = e.target.closest("button, .heft-pop-thumb");
		if (!b || !doc) return;
		const d = b.dataset;
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
		if (d.hetool) { tool = d.hetool; if (tool !== "select" && sel) { const spi = sel.pageIdx; sel = null; redrawPage(spi); } }
		else if (d.hecolor) { color = d.hecolor; if (tool === "eraser" || tool === "select") tool = "pen"; }
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
			host.querySelectorAll(".heft-page-slot").forEach((slot, i) => {
				const r = slot.getBoundingClientRect();
				const d2 = Math.abs((r.top + r.bottom) / 2 - mid);
				if (d2 < bestD) { bestD = d2; best = i; }
			});
			if (best !== idx) { idx = best; updateChrome(); }
		}, 80);
	}

	// ---------- Mount / Unmount ----------
	function bindCanvas() {
		host.querySelectorAll(".heft-canvas").forEach((cv) => {
			cv.addEventListener("pointerdown", onDown);
			cv.addEventListener("pointermove", onMove);
			cv.addEventListener("pointerup", onUp);
			cv.addEventListener("pointercancel", onUp);
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
		host.innerHTML = viewHtml();
		host.addEventListener("click", onHostClick);
		document.addEventListener("keydown", onKey);
		resizeFn = () => layout();
		window.addEventListener("resize", resizeFn);
		bindCanvas();
		bindScroll();
		layout();
		purgeOrphanLegacyInk();
	}
	function unmount() {
		closePop();
		closeScanner();
		if (saveT) saveNow(); // bewusst ohne await — saveNow macht vorher einen Schnappschuss
		if (host) {
			host.removeEventListener("click", onHostClick);
			host.innerHTML = "";
		}
		document.removeEventListener("keydown", onKey);
		if (resizeFn) { window.removeEventListener("resize", resizeFn); resizeFn = null; }
		scrollFn = null;
		host = null; pid = null; doc = null; idx = 0;
		drawing = null; sel = null; undoStack = []; redoStack = [];
	}

	// ---------- Thumbnails + Embeds (für Bibliothek und :::heft-Blöcke) ----------
	async function thumbnail(pageId, pageIndex, width) {
		const i = pageIndex || 0, w = width || 220;
		const key = pageId + ":" + i + ":" + w;
		if (thumbs[key]) return thumbs[key];
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