"use strict";
import { S, STATE } from "./state.js";
import { DB } from "./db.js";
import { U } from "./util.js";

// heft.js — GoodNotes-Kern für Impala67.
//
// v8 (11. Juli 2026) — kompletter Rewrite von Scanner + Navigation:
// - Dokument-Scanner v3: Papier-Maske → größte Komponente → konvexe Hülle →
//   flächenmaximales Viereck (findet auch GEDREHTE Blätter — die alte Extrempunkt-
//   Suche versagte dort), Entzerrung per Homographie (bilinear), Beleuchtung
//   rausrechnen + Filter, Live-Qualitäts-Anzeige mit echtem Erkennungs-Rahmen und
//   Auto-Auslöser, Nachbearbeitung (Ecken/Filter/Drehen/Vergleich), eigener
//   PDF-1.4-Writer (JPEG/DCTDecode) → PDF-Download und/oder Heftseiten
// - Navigation v2: 1 Finger scrollt delta-basiert mit Trägheit, 2 Finger pinchen um
//   den Fingermittelpunkt (während der Geste nur CSS-Größen — die scharfe Canvas-
//   Auflösung wird genau EINMAL am Gestenende gerendert), Doppeltipp passt das Blatt
//   an den Bildschirm an (erneut: 2× an die Tippstelle), 2-/3-Finger-Tipp =
//   Undo/Redo, Strg/Cmd + Mausrad zoomt am Desktop
// - Taskbar v7 unverändert: Haupt-Pill fest zentriert, nur das Options-Tray ist frei
//   verschiebbar; Bilder wie in GoodNotes (einfügen, verschieben, skalieren, löschen)
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
	// Navigation v2: gesamter Gesten-Zustand lebt in EINEM Objekt (siehe unten).
	// onlyPen default true: Palm Rejection für Apple Pencil.
	// Aktive Stifte werden separat verfolgt, damit ein Handballen nie als Scroll-Geste zählt.
	let tool = "pen", color = COLORS[0], size = 3, onlyPen = true;
	const activePenPointers = new Set();
	let expanded = false;    // Options-Tray erst nach Klick auf Schreiben/Radierer
	let trayPos = null;      // {x,y} nur für das verschiebbare Options-Tray
	let trayDrag = null;     // laufender Drag des Options-Trays
	let drawing = null, saveT = 0, resizeFn = null, resizeObserver = null, scrollFn = null;
	let undoStack = [], redoStack = [];
	let sel = null;          // { pageIdx, imgId } — ausgewähltes Bild (Auswahl-Werkzeug)
	let lassoSel = null;     // { pageIdx, strokes[] } — Auswahl von Freihand-Strichen
	let holdTool = null, holdTimer = 0, suppressEraserClick = false;
	const laserTimers = new Set();
	let insertPos = "after"; // ＋-Menü: "before" | "after" | "last"
	let pop = null;          // offenes Toolbar-Popup (Seiten / Bilder / ＋)
	let scanUI = null;       // Scanner-Overlay { wrap, stream, shots[], edit, busy }
	let ocrBusy = false, ocrTimer = 0; // stille Hintergrund-Indexierung für die normale Suche

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
			// Nur erkannter Text wird in den kleinen Metadaten-Index übernommen;
			// Bilder und Striche bleiben weiterhin ausschließlich im Heft-Blob.
			const ocrText = saveDoc.pages.map((pg) => pg.ocrText || "").filter(Boolean).join("\n");
			await STATE.dispatch("heftUpdated", { pageId: savePid, rev: saveDoc.rev, pages: saveDoc.pages.length, bytes: bytes.byteLength, ocrText });
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
				// FIX (v8): nur die Vorschauen DIESES Hefts invalidieren — vorher wurden
				// die Thumbnails ALLER Hefte verworfen und teuer neu gerendert.
				if (pid) Object.keys(thumbs).forEach((k) => { if (k.startsWith(pid + ":")) delete thumbs[k]; });
				// Ein Bild betrifft nur seine eigene Heftseite.
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
	// Jeder Canvas kennt seine tatsächlich gerenderte Pixelratio. Sie kann bei
	// großem Zoom kleiner als devicePixelRatio sein, damit nie riesige Backing Stores
	// entstehen, die auf iPad/Safari zu Weißbildern oder Speicherabbrüchen führen.
	function applyTransform(x) {
		const dpr = x.canvas.__heftDpr || 1;
		x.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
	}
	function redrawPage(i) {
		if (!doc || !doc.pages[i]) return;
		const cv = canvases[i];
		if (!cv || cv.width < 2 || cv.height < 2) return;
		const x = cv.getContext('2d');
		x.setTransform(1, 0, 0, 1, 0, 0);
		x.clearRect(0, 0, cv.width, cv.height);
		applyTransform(x);
		renderPageTo(x, doc.pages[i], i);
	}
	function redraw() { renderVisiblePages(); }

	// ---------- Navigation v3: frei zoomen, 2D-Pan, stabiler Fokuspunkt ----------
	// Ein einziger CSS-Variablen-Write skaliert alle Seiten. Die teuren Canvas-Bitmaps
	// werden erst nach der Geste neu gerendert. Der Zoom-Anker ist ein Punkt IM Blatt,
	// nicht die Mitte des Scroll-Containers — dadurch kann man überall hineinzoomen.
	// Seiten sind kein Infinite Canvas: Der feste Maximalzoom hält Matrix,
	// Speicherbedarf und Eingabepräzision stabil. Das Rendering arbeitet nur
	// für sichtbare Seiten und verwendet einen festen Pixel-Budget-Deckel.
	const ZOOM_MIN = 1, ZOOM_MAX = 3.5;
	// iPad/Safari leert Canvas-Flächen oft lautlos, bevor das theoretische
	// Speicherlimit erreicht ist. Ein konservatives Budget plus Kantenlimit
	// verhindert weiße Seiten beim starken Zoom.
	const MAX_RENDER_DPR = 2.5, MAX_RENDER_PIXELS = 8_000_000, MAX_CANVAS_DIM = 4096;
	let visibleRenderTimer = 0, lastInteractiveRender = 0;
	const gesture = {
		pointers: new Map(), mode: null, maxCount: 0, moved: false, startedAt: 0,
		vx: 0, vy: 0, lastT: 0, pinchDist: 0, pinchZoom: 1, pinchAnchor: null,
		raf: 0, zoomFrame: 0, pendingZoom: null,
		lastTap: 0, tapX: 0, tapY: 0,
	};
	const scrollEl = () => (host ? host.querySelector(".heft-scroll") : null);
	const pagesEl = () => (host ? host.querySelector(".heft-pages") : null);
	function stopAnim() {
		if (gesture.raf) cancelAnimationFrame(gesture.raf);
		if (gesture.zoomFrame) cancelAnimationFrame(gesture.zoomFrame);
		gesture.raf = gesture.zoomFrame = 0; gesture.pendingZoom = null;
	}
	function navReset() {
		stopAnim(); gesture.pointers.clear();
		gesture.mode = null; gesture.maxCount = 0; gesture.moved = false;
		gesture.vx = gesture.vy = 0; gesture.pinchAnchor = null; gesture.lastTap = 0;
	}
	function applyView(commit) {
		const scroll = scrollEl(); if (!scroll) return;
		// Die tatsächliche Innenbreite ist entscheidend: im Hochformat hatten Padding und
		// Scrollbar bislang einen Teil der Zoom-Breite verschluckt.
		const innerW = Math.max(1, scroll.clientWidth - 36);
		const innerH = Math.max(1, scroll.clientHeight - 36);
		// Zoom 1 bedeutet immer „ganze Seite sichtbar“ – in Breite UND Höhe.
		// Dadurch entspricht der Doppeltipp dem Notion-Verhalten statt nur auf
		// Seitenbreite zu springen.
		const fit = Math.max(0.1, Math.min(innerW / PAGE_W, innerH / PAGE_H, 1));
		scale = fit * zoom;
		const cssW = Math.max(1, PAGE_W * scale), cssH = Math.max(1, PAGE_H * scale);
		const pages = pagesEl();
		if (pages) {
			pages.style.setProperty("--heft-page-w", cssW + "px");
			pages.style.setProperty("--heft-page-h", cssH + "px");
			pages.style.minWidth = Math.max(innerW, cssW) + "px";
		} else canvases.forEach((cv) => { cv.style.width = cssW + "px"; cv.style.height = cssH + "px"; });
		if (commit) renderVisiblePages();
		else {
			// Während eines Pinchs bleibt CSS-Scaling sofort flüssig. Zusätzlich wird
			// höchstens alle 110 ms scharf nachgerendert – deutlich klarer als eine
			// reine Gesten-Ende-Lösung, ohne jeden Pointer-Frame teuer zu rasterisieren.
			const now = performance.now();
			if (now - lastInteractiveRender > 110) {
				lastInteractiveRender = now;
				scheduleVisibleRender(0);
			}
		}
	}
	function visiblePageIndices() {
		const scroll = scrollEl(); if (!scroll) return [];
		const sr = scroll.getBoundingClientRect(), pad = Math.max(180, sr.height * .35), out = [];
		pageSlots.forEach((slot, i) => {
				if (!slot) return;
				const r = slot.getBoundingClientRect();
				if (r.bottom >= sr.top - pad && r.top <= sr.bottom + pad) out.push(i);
			});
		return out;
	}
	function renderVisiblePages() {
		if (!doc) return;
		const visible = new Set(visiblePageIndices());
		// Das Budget gilt pro sichtbarer Seite. Bei hohem Zoom wird DPR sanft
		// reduziert, statt eine Canvasdimension zu erzeugen, die der Browser leert.
		const nativeDpr = Math.min(MAX_RENDER_DPR, window.devicePixelRatio || 1);
		const pageW = PAGE_W * scale, pageH = PAGE_H * scale;
		const pixelBudgetDpr = Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, pageW * pageH));
		const edgeBudgetDpr = MAX_CANVAS_DIM / Math.max(pageW, pageH);
		// Bei extremem Zoom darf DPR unter 1 sinken. Das ist besser als eine von
		// Safari verworfene (weiße) Canvas; sobald herausgezoomt wird, steigt die
		// scharfe Auflösung automatisch wieder an.
		const safeDpr = Math.max(0.5, Math.min(nativeDpr, pixelBudgetDpr, edgeBudgetDpr));
		canvases.forEach((cv, i) => {
			if (!visible.has(i)) {
				// Unsichtbare Seiten geben ihren großen Backing Store sofort frei.
				if (cv.width !== 1 || cv.height !== 1) { cv.width = 1; cv.height = 1; }
				return;
			}
			cv.__heftDpr = safeDpr;
			const w = Math.max(1, Math.round(PAGE_W * scale * safeDpr));
			const h = Math.max(1, Math.round(PAGE_H * scale * safeDpr));
			if (cv.width !== w) cv.width = w;
			if (cv.height !== h) cv.height = h;
			redrawPage(i);
		});
	}
	function scheduleVisibleRender(delay = 90) {
		clearTimeout(visibleRenderTimer);
		visibleRenderTimer = setTimeout(() => { visibleRenderTimer = 0; renderVisiblePages(); }, delay);
	}
	// Beim Drehen des Geräts bzw. beim Ein-/Ausblenden von UI bleibt derselbe Punkt
	// der Seite im Sichtfenster. Ohne diesen Anker sprang die Hochkant-Ansicht sichtbar.
	function layout() {
		const scroll = scrollEl();
		if (!scroll || !canvases.length) { applyView(true); return; }
		const r = scroll.getBoundingClientRect();
		const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
		const anchor = makeZoomAnchor(cx, cy);
		applyView(true); keepAnchor(anchor, cx, cy);
	}
	function canvasAt(clientX, clientY) {
		const direct = document.elementFromPoint(clientX, clientY);
		const hit = direct && direct.closest && direct.closest(".heft-canvas");
		if (hit) return hit;
		let best = canvases[idx] || canvases[0] || null, bd = Infinity;
		canvases.forEach((cv) => {
			const r = cv.getBoundingClientRect();
			const dx = clientX < r.left ? r.left - clientX : clientX > r.right ? clientX - r.right : 0;
			const dy = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
			const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = cv; }
		});
		return best;
	}
	function makeZoomAnchor(clientX, clientY) {
		const cv = canvasAt(clientX, clientY); if (!cv) return null;
		const r = cv.getBoundingClientRect();
		return { cv, nx: Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width))), ny: Math.max(0, Math.min(1, (clientY - r.top) / Math.max(1, r.height))) };
	}
	function keepAnchor(anchor, clientX, clientY) {
		const scroll = scrollEl(); if (!scroll || !anchor || !anchor.cv.isConnected) return;
		const r = anchor.cv.getBoundingClientRect();
		scroll.scrollLeft += r.left + r.width * anchor.nx - clientX;
		scroll.scrollTop += r.top + r.height * anchor.ny - clientY;
	}
	function setZoom(next, clientX, clientY, commit, fixedAnchor) {
		next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
		const anchor = fixedAnchor || makeZoomAnchor(clientX, clientY);
		zoom = next; applyView(commit); keepAnchor(anchor, clientX, clientY);
	}
	function queueZoom(next, clientX, clientY, anchor) {
		gesture.pendingZoom = { next, clientX, clientY, anchor };
		if (gesture.zoomFrame) return;
		gesture.zoomFrame = requestAnimationFrame(() => {
			gesture.zoomFrame = 0;
			const p = gesture.pendingZoom; gesture.pendingZoom = null;
			if (p) setZoom(p.next, p.clientX, p.clientY, false, p.anchor);
		});
	}
	function animateZoom(target, clientX, clientY) {
		stopAnim();
		const from = zoom, anchor = makeZoomAnchor(clientX, clientY);
		const t0 = performance.now(), dur = 280;
		const step = (now) => {
			const t = Math.min(1, (now - t0) / dur), eased = 1 - Math.pow(1 - t, 4);
			setZoom(from + (target - from) * eased, clientX, clientY, false, anchor);
			if (t < 1) gesture.raf = requestAnimationFrame(step);
			else { gesture.raf = 0; applyView(true); keepAnchor(anchor, clientX, clientY); }
		};
		gesture.raf = requestAnimationFrame(step);
	}
	function startFling() {
		const scroll = scrollEl(); if (!scroll) return;
		let vx = gesture.vx * 16, vy = gesture.vy * 16;
		if (Math.hypot(vx, vy) < 2) return;
		let last = performance.now();
		const step = (now) => {
			const dt = Math.min(32, now - last) / 16.67; last = now;
			const decay = Math.pow(0.92, dt); vx *= decay; vy *= decay;
			const ox = scroll.scrollLeft, oy = scroll.scrollTop;
			scroll.scrollLeft -= vx * dt; scroll.scrollTop -= vy * dt;
			if (scroll.scrollLeft === ox) vx = 0; if (scroll.scrollTop === oy) vy = 0;
			gesture.raf = Math.hypot(vx, vy) > 0.35 ? requestAnimationFrame(step) : 0;
		};
		gesture.raf = requestAnimationFrame(step);
	}
	function pinchPair() { const a = [...gesture.pointers.values()]; return a.length >= 2 ? [a[0], a[1]] : null; }
	function beginPinch() {
		const pair = pinchPair(); if (!pair) return;
		const mx = (pair[0].x + pair[1].x) / 2, my = (pair[0].y + pair[1].y) / 2;
		gesture.mode = "pinch";
		gesture.pinchDist = Math.max(1, Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y));
		gesture.pinchZoom = zoom; gesture.pinchAnchor = makeZoomAnchor(mx, my);
	}
	function onTouchPointerDown(e) {
		if (e.pointerType !== "touch" || !touchNavigates() || !scrollEl()) return;
		e.preventDefault(); stopAnim();
		try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
		gesture.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
		gesture.maxCount = Math.max(gesture.maxCount, gesture.pointers.size);
		if (gesture.pointers.size === 1) {
			gesture.mode = "scroll"; gesture.moved = false; gesture.startedAt = Date.now();
			gesture.vx = gesture.vy = 0; gesture.lastT = e.timeStamp;
		} else beginPinch();
	}
	function onTouchPointerMove(e) {
		const p = gesture.pointers.get(e.pointerId); if (!p || e.pointerType !== "touch") return;
		if (activePenPointers.size) { navReset(); return; }
		const scroll = scrollEl(); if (!scroll) return;
		e.preventDefault();
		const dx = e.clientX - p.x, dy = e.clientY - p.y;
		p.x = e.clientX; p.y = e.clientY;
		if (Math.hypot(p.x - p.sx, p.y - p.sy) > 7) gesture.moved = true;
		if (gesture.mode === "pinch") {
			const pair = pinchPair(); if (!pair) return;
			const dist = Math.max(1, Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y));
			const mx = (pair[0].x + pair[1].x) / 2, my = (pair[0].y + pair[1].y) / 2;
			queueZoom(gesture.pinchZoom * dist / gesture.pinchDist, mx, my, gesture.pinchAnchor);
			return;
		}
		scroll.scrollLeft -= dx; scroll.scrollTop -= dy;
		const dt = Math.max(1, e.timeStamp - gesture.lastT);
		gesture.vx = 0.68 * gesture.vx + 0.32 * (dx / dt);
		gesture.vy = 0.68 * gesture.vy + 0.32 * (dy / dt); gesture.lastT = e.timeStamp;
	}
	function onTouchPointerUp(e) {
		if (!gesture.pointers.has(e.pointerId)) return;
		e.preventDefault();
		const wasPinch = gesture.mode === "pinch";
		gesture.pointers.delete(e.pointerId);
		if (gesture.pointers.size >= 2) { beginPinch(); return; }
		if (gesture.pointers.size === 1) {
			if (wasPinch) { if (gesture.pendingZoom) { const p = gesture.pendingZoom; gesture.pendingZoom = null; setZoom(p.next, p.clientX, p.clientY, false, p.anchor); } applyView(true); }
			const left = [...gesture.pointers.values()][0]; left.sx = left.x; left.sy = left.y;
			gesture.mode = "scroll"; gesture.vx = gesture.vy = 0; gesture.lastT = e.timeStamp; return;
		}
		const quick = Date.now() - gesture.startedAt < 300 && !gesture.moved;
		const count = gesture.maxCount; gesture.maxCount = 0; gesture.mode = null;
		if (wasPinch) { if (gesture.pendingZoom) { const p = gesture.pendingZoom; gesture.pendingZoom = null; setZoom(p.next, p.clientX, p.clientY, false, p.anchor); } applyView(true); return; }
		if (quick && count === 2) { undo(); return; }
		if (quick && count >= 3) { redo(); return; }
		if (quick && count === 1) {
			const now = Date.now();
			if (now - gesture.lastTap < 330 && Math.hypot(e.clientX - gesture.tapX, e.clientY - gesture.tapY) < 64) {
				// Doppeltipp am Tablet: stets zur vollständigen Seitengröße zurück.
				// Kein Toggle auf einen beliebigen Nahzoom – das bleibt dem Pinch vorbehalten.
				gesture.lastTap = 0; animateZoom(1, e.clientX, e.clientY); return;
			}
			gesture.lastTap = now; gesture.tapX = e.clientX; gesture.tapY = e.clientY; return;
		}
		if (gesture.moved && count === 1) startFling();
	}
	let wheelCommitT = 0;
	function onWheelZoom(e) {
		if (!e.ctrlKey && !e.metaKey) return;
		e.preventDefault();
		const factor = Math.exp(-e.deltaY * 0.0022);
		queueZoom(zoom * factor, e.clientX, e.clientY, makeZoomAnchor(e.clientX, e.clientY));
		clearTimeout(wheelCommitT); wheelCommitT = setTimeout(() => applyView(true), 160);
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
	// Finger sind entweder Navigation (Standard) oder – nach bewusster Umschaltung – Zeichenwerkzeug.
	// Während ein Stift aufliegt, werden sämtliche Touch-Ereignisse als Handballen verworfen.
	const rejected = (e) => e.pointerType === "touch" && (onlyPen || activePenPointers.size > 0);
	const touchNavigates = () => onlyPen && activePenPointers.size === 0;
	const near = (p, x, y, r) => { const dx = p[0] - x, dy = p[1] - y; return dx * dx + dy * dy <= r * r; };
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
		if (e.pointerType === "pen") { activePenPointers.add(e.pointerId); stopAnim(); }
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
	function onUp(e) {
		if (e && e.pointerType === "pen") activePenPointers.delete(e.pointerId);
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
			if (drawing.tool === "pen" || drawing.tool === "marker") scheduleHandwritingIndex(pi);
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

	// ---------- Taskbar v7: feste Haupt-Pill + verschiebbares Options-Tray ----------
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
					'<span class="heft-sep" aria-hidden="true"></span>' +
					'<button type="button" data-hetool="lasso" class="heft-main' + (tool === "lasso" ? " active" : "") +
						'" title="Lasso — Striche auswählen">⌁</button>' +
					'<button type="button" data-hetool="laser" class="heft-main heft-laser' + (tool === "laser" ? " active" : "") +
						'" title="Laserpointer — nicht speichern">⊙</button>' +
					'<button type="button" data-hetool="shape" class="heft-main' + (tool === "shape" ? " active" : "") +
						'" title="Formen — Linie, Rechteck, Kreis">▱</button>' +
					'<span class="heft-sep" aria-hidden="true"></span>' +
					'<button type="button" data-heimgmenu="1" class="heft-main' +
						((pop && pop.dataset.kind === "img") || tool === "select" ? " active" : "") + '" title="Bilder einfügen oder bearbeiten">🖼</button>' +
					'<span class="heft-sep" aria-hidden="true"></span>' +
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
		return '<div class="heft-scroll"><div class="heft-pages">' + pages + '</div></div>' + toolbarHtml();
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
			'<button type="button" class="heft-pop-row" data-hetool="select">⬚ Bilder auswählen & bearbeiten</button>' +
			'<div class="heft-pop-sep"></div>' +
			'<button type="button" class="heft-pop-row" data-heimgadd="1">🖼 Bild hinzufügen</button>' +
			'<button type="button" class="heft-pop-row" data-heimgcam="1">📷 Bild aufnehmen</button>' +
			'<div class="heft-pop-sub">Ausgewählte Bilder lassen sich direkt auf der Seite verschieben, skalieren oder löschen.</div>';
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
			'<button type="button" class="heft-pop-row" data-heimport="1">⬳ Importieren</button>' +
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
			// PDF-Seiten mit 3× statt 2× rasterisieren: beim Zoom deutlich schärfer,
			// ohne die Speicher- und Importkosten eines 4×-Imports zu verursachen.
			const vp = p.getViewport({ scale: 3 });
			const c = document.createElement("canvas");
			c.width = Math.round(vp.width); c.height = Math.round(vp.height);
			await p.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
			// Höhere JPEG-Qualität bewahrt feine Schrift und Formeln; JPEG bleibt für
			// mehrseitige Skripte wesentlich kompakter und schneller als PNG.
			doc.pages.splice(at, 0, imagePage({ src: c.toDataURL("image/jpeg", 0.92), w: c.width, h: c.height }, "blank", true));
			at++;
		}
		return at;
	}

	// ---------- Dateien scannen: Dokument-Scanner v3 (kompletter Rewrite) ----------
	// Pipeline wie GoodNotes/Office Lens: Aufnahme → Blatt-Erkennung → perspektivische
	// Entzerrung → Beleuchtung rausrechnen + Filter → Nachbearbeitung → PDF/Heftseiten.
	// Erkennung v4: Papier-Maske (hell + unbunt + nicht dunkler als lokaler Hintergrund)
	// → größte plausible Fläche → konvexe Hülle → flächenmaximales Viereck. Das findet
	// im Gegensatz zur alten Extrempunkt-Suche auch GEDREHTE Blätter zuverlässig.
	const SCAN_MODES = [["color", "Farbe"], ["bw", "S/W"], ["gray", "Graustufen"], ["photo", "Foto"]];
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
	function isConvex(q) {
		let sign = 0;
		for (let i = 0; i < 4; i++) {
			const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
			const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
			if (!z) continue;
			if (!sign) sign = z > 0 ? 1 : -1;
			else if ((z > 0 ? 1 : -1) !== sign) return false;
		}
		return sign !== 0;
	}
	// Konvexe Hülle (Andrew Monotone Chain) — Grundlage der Eckensuche
	function convexHull(pts) {
		const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
		if (p.length < 3) return p;
		const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
		const lower = [];
		for (const pt of p) {
			while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
			lower.push(pt);
		}
		const upper = [];
		for (let i = p.length - 1; i >= 0; i--) {
			const pt = p[i];
			while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
			upper.push(pt);
		}
		lower.pop(); upper.pop();
		return lower.concat(upper);
	}
	// Separabler Box-Blur mit Gleitsumme — O(n) statt O(n·r²) wie der alte 5×5-Schleifen-Blur
	function blurMap(src, dw, dh, r) {
		const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
		const pass = (inp, outp, len, stride, lines, lineStride) => {
			for (let l = 0; l < lines; l++) {
				const base = l * lineStride;
				let acc = 0;
				for (let i = -r; i <= r; i++) acc += inp[base + Math.min(len - 1, Math.max(0, i)) * stride];
				for (let i = 0; i < len; i++) {
					outp[base + i * stride] = acc / (2 * r + 1);
					acc += inp[base + Math.min(len - 1, i + r + 1) * stride] - inp[base + Math.max(0, i - r) * stride];
				}
			}
		};
		pass(src, tmp, dw, 1, dh, dw);
		pass(tmp, out, dh, dw, dw, 1);
		return out;
	}
	// Separable Morphologie: pick=1 Dilatation, pick=0 Erosion (Radius 2)
	function morphPass(src, dw, dh, pick) {
		const n = dw * dh, mid = new Uint8Array(n), out = new Uint8Array(n);
		for (let i = 0; i < n; i++) {
			const x = i % dw;
			let v = src[i] === pick;
			for (let k = 1; k <= 2 && !v; k++) v = (x - k >= 0 && src[i - k] === pick) || (x + k < dw && src[i + k] === pick);
			mid[i] = v ? pick : 1 - pick;
		}
		for (let i = 0; i < n; i++) {
			const y = (i / dw) | 0;
			let v = mid[i] === pick;
			for (let k = 1; k <= 2 && !v; k++) v = (y - k >= 0 && mid[i - k * dw] === pick) || (y + k < dh && mid[i + k * dw] === pick);
			out[i] = v ? pick : 1 - pick;
		}
		return out;
	}
	// Dokumenterkennung v4. Gibt bei unsicherer Erkennung IMMER das ganze Bild
	// zurück — niemals Inhalt abschneiden.
	function detectQuad(img, w, h) {
		const full = [[0, 0], [Math.max(0, w - 1), 0], [Math.max(0, w - 1), Math.max(0, h - 1)], [0, Math.max(0, h - 1)]];
		if (!w || !h) return full;
		try {
			const dw = Math.min(480, w), kk = dw / w, dh = Math.max(12, Math.round(h * kk));
			const c = document.createElement("canvas");
			c.width = dw; c.height = dh;
			const cx = c.getContext("2d", { willReadFrequently: true });
			cx.drawImage(img, 0, 0, dw, dh);
			const d = cx.getImageData(0, 0, dw, dh).data;
			const n = dw * dh;
			const L = new Float32Array(n), sat = new Float32Array(n);
			const ca = new Float32Array(n), cb = new Float32Array(n), edge = new Float32Array(n);
			let sumL = 0, borderL = 0, borderA = 0, borderB = 0, borderN = 0;
			for (let i = 0; i < n; i++) {
				const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
				const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
				L[i] = r * 0.299 + g * 0.587 + b * 0.114;
				sat[i] = mx ? (mx - mn) / mx : 0;
				ca[i] = r - g; cb[i] = b - g; sumL += L[i];
				const y = (i / dw) | 0, x2 = i % dw;
				if (x2 < 3 || y < 3 || x2 >= dw - 3 || y >= dh - 3) {
					borderL += L[i]; borderA += ca[i]; borderB += cb[i]; borderN++;
				}
			}
			borderL /= Math.max(1, borderN); borderA /= Math.max(1, borderN); borderB /= Math.max(1, borderN);
			for (let y = 1; y < dh - 1; y++) for (let x2 = 1; x2 < dw - 1; x2++) {
				const i = y * dw + x2;
				const gx = L[i + 1] - L[i - 1], gy = L[i + dw] - L[i - dw];
				edge[i] = Math.abs(gx) + Math.abs(gy);
			}
			const meanL = sumL / n;
			const blur = blurMap(L, dw, dh, Math.max(5, Math.round(dw / 70)));
			// Drei voneinander unabhängige Segmentierungen: helles Papier, Farbe gegen
			// den am Bildrand gemessenen Tisch und eine kantenumschlossene Fläche. So
			// funktionieren auch cremefarbene Blätter und weißes Papier auf hellem Tisch.
			const lightMask = new Uint8Array(n), colorMask = new Uint8Array(n);
			const thrPaper = Math.max(78, meanL * 0.70);
			for (let i = 0; i < n; i++) {
				const colorDelta = Math.hypot((L[i] - borderL) * 0.75, ca[i] - borderA, cb[i] - borderB);
				lightMask[i] = L[i] >= thrPaper && sat[i] < 0.48 && L[i] >= blur[i] * 0.78 ? 1 : 0;
				colorMask[i] = L[i] > 45 && colorDelta > 13 && (sat[i] < 0.72 || L[i] > borderL + 12) ? 1 : 0;
			}
			// Starke Kanten bilden eine Barriere. Vom Außenrand wird der Tisch geflutet;
			// was von einer geschlossenen Blattkante umschlossen bleibt, ist Kandidat 3.
			const edgeBarrier = new Uint8Array(n), outside = new Uint8Array(n), flood = new Int32Array(n);
			let edgeMean = 0;
			for (let i = 0; i < n; i++) edgeMean += edge[i];
			const edgeThr = Math.max(18, edgeMean / n * 2.35);
			for (let i = 0; i < n; i++) edgeBarrier[i] = edge[i] >= edgeThr ? 1 : 0;
			const barrier = morphPass(edgeBarrier, dw, dh, 1);
			let ft = 0;
			const seed = (i) => { if (!outside[i] && !barrier[i]) { outside[i] = 1; flood[ft++] = i; } };
			for (let x2 = 0; x2 < dw; x2++) { seed(x2); seed((dh - 1) * dw + x2); }
			for (let y = 1; y < dh - 1; y++) { seed(y * dw); seed(y * dw + dw - 1); }
			while (ft) {
				const p = flood[--ft], x2 = p % dw, y = (p / dw) | 0;
				if (x2 > 0) seed(p - 1); if (x2 < dw - 1) seed(p + 1);
				if (y > 0) seed(p - dw); if (y < dh - 1) seed(p + dw);
			}
			const enclosedMask = new Uint8Array(n);
			for (let i = 0; i < n; i++) enclosedMask[i] = outside[i] || barrier[i] ? 0 : 1;
			const masks = [lightMask, colorMask, enclosedMask].map((m) => {
				// Closing füllt Textlöcher, anschließendes Opening entfernt kleine Reflexe,
				// ohne die Blattkante dauerhaft nach innen zu verschieben.
				const closed = morphPass(morphPass(m, dw, dh, 1), dw, dh, 0);
				return morphPass(morphPass(closed, dw, dh, 0), dw, dh, 1);
			});
			const stack = new Int32Array(n);
			let best = null, bestScore = -1;
			for (let mi = 0; mi < masks.length; mi++) {
				const mask = masks[mi], seen = new Uint8Array(n);
				for (let s0 = 0; s0 < n; s0++) {
					if (!mask[s0] || seen[s0]) continue;
					let top = 0, area = 0, touches = 0, edgeSum = 0;
					let minX = dw, maxX = 0, minY = dh, maxY = 0;
					const boundary = [];
					stack[top++] = s0; seen[s0] = 1;
					while (top) {
						const p = stack[--top], py = (p / dw) | 0, pxx = p % dw; area++;
						if (pxx < minX) minX = pxx; if (pxx > maxX) maxX = pxx;
						if (py < minY) minY = py; if (py > maxY) maxY = py;
						let bnd = pxx <= 0 || py <= 0 || pxx >= dw - 1 || py >= dh - 1;
						if (bnd) touches++;
						if (pxx > 0) { const j = p - 1; if (mask[j]) { if (!seen[j]) { seen[j] = 1; stack[top++] = j; } } else bnd = true; }
						if (pxx < dw - 1) { const j = p + 1; if (mask[j]) { if (!seen[j]) { seen[j] = 1; stack[top++] = j; } } else bnd = true; }
						if (py > 0) { const j = p - dw; if (mask[j]) { if (!seen[j]) { seen[j] = 1; stack[top++] = j; } } else bnd = true; }
						if (py < dh - 1) { const j = p + dw; if (mask[j]) { if (!seen[j]) { seen[j] = 1; stack[top++] = j; } } else bnd = true; }
						if (bnd) { boundary.push([pxx, py]); edgeSum += edge[p]; }
					}
					if (area < n * 0.075 || area > n * 0.965 || boundary.length < 20) continue;
					const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
					const fill = Math.min(1, area / (bw * bh)), aspect = bw / bh;
					if (aspect < 0.24 || aspect > 4.2) continue;
					const cx2 = (minX + maxX) / 2, cy2 = (minY + maxY) / 2;
					const centerPenalty = Math.hypot(cx2 - dw / 2, cy2 - dh / 2) / Math.hypot(dw, dh);
					const edgeBonus = Math.min(1.8, edgeSum / Math.max(1, boundary.length * edgeThr));
					const touchPenalty = 1 - Math.min(0.72, touches / Math.max(1, boundary.length) * 2.5);
					const sc = area * (0.45 + fill) * (0.8 + edgeBonus) * touchPenalty * (1 - centerPenalty * 0.35) * (mi === 2 ? 1.08 : 1);
					if (sc > bestScore) { bestScore = sc; best = boundary; }
				}
			}
			if (!best) return full;
			const hull = convexHull(best);
			if (hull.length < 4) return full;
			// Start-Viereck aus Extrempunkten (x+y bzw. x−y) …
			let tl = hull[0], tr = hull[0], br = hull[0], bl = hull[0];
			for (const p of hull) {
				if (p[0] + p[1] < tl[0] + tl[1]) tl = p;
				if (p[0] + p[1] > br[0] + br[1]) br = p;
				if (p[0] - p[1] > tr[0] - tr[1]) tr = p;
				if (p[0] - p[1] < bl[0] - bl[1]) bl = p;
			}
			let quad = [tl, tr, br, bl];
			// … dann Ecken gegen Hüllpunkte tauschen, solange die Fläche wächst.
			// Extrempunkte allein versagen bei gedrehten Blättern (der v2-Bug); das
			// flächenmaximale konvexe Viereck in der Hülle sind die echten Papierecken.
			let improved = true, guard = 0;
			while (improved && guard++ < 10) {
				improved = false;
				for (let ci = 0; ci < 4; ci++) {
					let bestA = quadArea(quad), bestP = quad[ci];
					for (const p of hull) {
						const q2 = [quad[0], quad[1], quad[2], quad[3]];
						q2[ci] = p;
						const a2 = quadArea(q2);
						if (a2 > bestA + 0.5 && isConvex(q2)) { bestA = a2; bestP = p; }
					}
					if (bestP !== quad[ci]) { quad[ci] = bestP; improved = true; }
				}
			}
			// Reihenfolge tl→tr→br→bl herstellen (Winkelsortierung um den Schwerpunkt)
			const cqx = (quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0]) / 4;
			const cqy = (quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1]) / 4;
			quad.sort((a, b) => Math.atan2(a[1] - cqy, a[0] - cqx) - Math.atan2(b[1] - cqy, b[0] - cqx));
			let st = 0;
			for (let i = 1; i < 4; i++) if (quad[i][0] + quad[i][1] < quad[st][0] + quad[st][1]) st = i;
			quad = quad.slice(st).concat(quad.slice(0, st));
			// Zurückskalieren, minimal nach außen (Schatten/Antialiasing), an den Rand klemmen
			const q = quad.map((p) => [p[0] / kk, p[1] / kk]);
			const ccx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4;
			const ccy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
			for (const p of q) {
				p[0] = Math.max(0, Math.min(w - 1, ccx + (p[0] - ccx) * 1.03));
				p[1] = Math.max(0, Math.min(h - 1, ccy + (p[1] - ccy) * 1.03));
			}
			// Plausibilität — sonst lieber das ganze Bild behalten
			const areaQ = quadArea(q);
			if (areaQ < w * h * 0.1 || areaQ > w * h * 0.985 || !isConvex(q)) return full;
			for (let i = 0; i < 4; i++) if (dist2d(q[i], q[(i + 1) % 4]) < Math.min(w, h) * 0.12) return full;
			return q;
		} catch (e) {
			console.warn("Heft: Dokumenterkennung fehlgeschlagen", e);
			return full;
		}
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
				// Bilinear-Sampling liest x0+1/y0+1. Daher Quellkoordinaten
				// bewusst auf den vorletzten Pixel begrenzen, statt am Rand in die
				// nächste Zeile bzw. hinter das Bild zu lesen.
				if (sx < 0) sx = 0; else if (sx > iw - 2.001) sx = iw - 2.001;
				if (sy < 0) sy = 0; else if (sy > ih - 2.001) sy = ih - 2.001;
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
		// Bilinear-Sampling braucht jeweils einen rechten und unteren Nachbarn —
		// am Rand deshalb auf den vorletzten Eintrag klemmen (sonst NaN-Ränder).
		let x = fx - 0.5, y = fy - 0.5;
		if (x < 0) x = 0; else if (x > bw - 2.001) x = bw - 2.001;
		if (y < 0) y = 0; else if (y > bh - 2.001) y = bh - 2.001;
		const x0 = x | 0, y0 = y | 0, dx = x - x0, dy = y - y0;
		return m[y0 * bw + x0] * (1 - dx) * (1 - dy) + m[y0 * bw + x0 + 1] * dx * (1 - dy) +
			m[(y0 + 1) * bw + x0] * (1 - dx) * dy + m[(y0 + 1) * bw + x0 + 1] * dx * dy;
	}
	// „Foto“-Filter: Kontrast strecken über 2%/98%-Luminanz-Perzentile — bewusst
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
	// Scan-Aufbereitung — bewusst aggressiv, damit der Unterschied zum Rohfoto
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
			let t = Math.max(0, Math.min(1, v / 255));
			t = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
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
				const r = clamp(px[i] * 255 / g);
				const g2 = clamp(px[i + 1] * 255 / g);
				const b = clamp(px[i + 2] * 255 / g);
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
					const blur2 =
						(copy[i - w * 4 + c] + copy[i + w * 4 + c] + copy[i - 4 + c] + copy[i + 4 + c] + c0 * 4) / 8;
					px[i + c] = clamp(c0 + (c0 - blur2) * amount);
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
		// Ein vorhandener automatisch oder manuell bestimmter Zuschnitt bleibt stabil;
		// nur ein fehlender/defekter Rahmen wird neu erkannt.
		const needDetect = !Array.isArray(sh.quad) || sh.quad.length !== 4;
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

	// ---------- Scanner-Overlay: Kamera, Live-Prüfung, Aufnahme ----------
	async function openScanner() {
		if (scanUI) return;
		const wrap = document.createElement("div");
		wrap.className = "heft-scan";
		wrap.innerHTML =
			'<div class="heft-scan-top"><b>Dateien scannen</b><button type="button" data-hescanclose="1" title="Schließen">✕</button></div>' +
			'<div class="heft-scan-stage"><video autoplay playsinline muted></video>' +
				'<svg class="heft-scan-guide" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points="7,7 93,7 93,93 7,93"></polygon></svg>' +
				'<div class="heft-scan-quality" data-hescanquality="1">Kamera wird geprüft…</div>' +
				'<div class="heft-scan-hint">Blatt vollständig ins Bild legen. Grün = bereit; der Rahmen zeigt exakt den späteren Zuschnitt.</div></div>' +
			'<div class="heft-scan-shots"></div>' +
			'<div class="heft-scan-bar">' +
				'<button type="button" class="heft-scan-shutter" data-hescanshot="1" title="Seite aufnehmen"></button>' +
				'<div class="heft-scan-actions">' +
					'<button type="button" data-hescanautocap="1" title="Auto-Scan aktivieren">⚡ Auto aus</button>' +
					'<button type="button" data-hescanpdf="1" disabled>📄 Als PDF speichern</button>' +
					'<button type="button" data-hescanheft="1" disabled>📓 In Heft einfügen</button>' +
				'</div>' +
			'</div>' +
			'<div class="heft-scan-busy" hidden><span>Scan wird aufbereitet…</span></div>';
		document.body.appendChild(wrap);
		scanUI = { wrap, stream: null, shots: [], edit: null, busy: false, liveTimer: 0, liveStable: 0, autoCapture: false, autoArmed: false, autoCooldown: 0 };
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
			} catch (cameraError) {
				// Nur bei einer nicht erfüllbaren Kamera-/Constraint-Wahl auf die allgemeine
				// Kamera ausweichen. Bei verweigerter Berechtigung würde ein zweiter
				// getUserMedia-Aufruf sonst erneut nachfragen bzw. den Fallback verzögern.
				const name = cameraError && cameraError.name;
				if (name !== "OverconstrainedError" && name !== "ConstraintNotSatisfiedError" && name !== "NotFoundError") throw cameraError;
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
	// Live-Prüfung vor dem Auslösen: kleine Vorschau → Helligkeit/Schärfe/Kontrast +
	// ECHTE Dokumenterkennung. Der grüne Rahmen zeigt damit exakt den späteren
	// Zuschnitt (v2 zeigte nur eine grobe Bounding-Box, die der Aufnahme oft widersprach).
	function liveQualityFrame(video) {
		const sw = 240, sh = Math.max(120, Math.round(video.videoHeight / Math.max(1, video.videoWidth) * sw));
		const c = document.createElement("canvas"); c.width = sw; c.height = sh;
		const x = c.getContext("2d", { willReadFrequently: true });
		x.drawImage(video, 0, 0, sw, sh);
		const px = x.getImageData(0, 0, sw, sh).data;
		let sum = 0, sum2 = 0, lap = 0;
		const lum = new Uint8Array(sw * sh);
		for (let i = 0; i < lum.length; i++) {
			const v = (px[i * 4] * 77 + px[i * 4 + 1] * 150 + px[i * 4 + 2] * 29) >> 8;
			lum[i] = v; sum += v; sum2 += v * v;
		}
		for (let y = 1; y < sh - 1; y += 2) for (let x2 = 1; x2 < sw - 1; x2 += 2) {
			const i = y * sw + x2;
			lap += Math.abs(4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - sw] - lum[i + sw]);
		}
		const count = sw * sh;
		const mean = sum / count, contrast = Math.sqrt(Math.max(0, sum2 / count - mean * mean));
		const sharp = lap / Math.max(1, ((sw - 2) * (sh - 2)) / 4);
		const quad = detectQuad(c, sw, sh);
		const found = quadArea(quad) < sw * sh * 0.96; // Vollbild-Fallback = nichts erkannt
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
		else if (!info.found) label.textContent = "Blatt vollständig ins Bild legen";
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
				if (!ready) {
					// Erst wenn das Blatt den Rahmen wieder verlassen hat, darf Auto für die
					// nächste Seite neu scharf sein — verhindert Duplikate bei ruhig liegendem Blatt.
					owner.liveStable = 0;
					owner.autoArmed = true;
					return;
				}
				owner.liveStable++;
				// Drei stabile Prüfrunden (~1 s) verhindern Fehlauslösungen beim Bewegen.
				if (owner.autoCapture && owner.autoArmed && owner.liveStable >= 3 && Date.now() > owner.autoCooldown) {
					owner.autoArmed = false;
					owner.liveStable = 0;
					owner.autoCooldown = Date.now() + 1800;
					scanCapture(true);
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
			if (scanUI.autoCapture) { scanUI.autoArmed = true; scanUI.liveStable = 0; }
			else { scanUI.autoArmed = false; }
			b.classList.toggle("active", scanUI.autoCapture);
			b.textContent = scanUI.autoCapture ? "⚡ Auto an" : "⚡ Auto aus";
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
			// Filter sofort anwenden (nicht erst bei Übernehmen) — sonst wirken die Chips „tot“
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
		else if (d.hescandel) {
			if (scanUI.edit) { const i = scanUI.edit.i; closeEdit(); scanUI.shots.splice(i, 1); renderShots(); }
		}
		else if (d.hescandone) finishEdit();
	}
	async function scanCapture(isAuto = false) {
		const owner = scanUI;
		if (!owner || owner.busy) return;
		// Ein manueller Scan zählt als Verarbeitung der aktuellen Seite. Auto darf
		// dieselbe ruhige Ansicht danach nicht noch einmal erfassen.
		if (!isAuto) { owner.autoArmed = false; owner.liveStable = 0; owner.autoCooldown = Date.now() + 1800; }
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
		// Auto-Zuschnitt bleibt aktiv. detectQuad() gibt bei unsicherer Erkennung
		// das vollständige Bild zurück, statt einen fragwürdigen Zuschnitt zu erzwingen.
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

	// ---------- Scan-Nachbearbeitung: Ecken ziehen, Filter, Drehen ----------
	// Schreibt Edit-Zustand zurück und rechnet den Scan SOFORT neu (Filter/Drehen/Ecken
	// sind damit echte Aktionen — nicht erst beim Schließen der Ansicht).
	let liveSeq = 0, editCommitT = 0;
	// Ecken dürfen nacheinander und beliebig oft verschoben werden. Währenddessen
	// bleibt immer das vollständige Rohfoto sichtbar; die teure Entzerrung läuft
	// gebündelt im Hintergrund statt die Edit-Ansicht nach jedem Griff zu verlassen.
	function queueCornerReprocess() {
		clearTimeout(editCommitT);
		editCommitT = setTimeout(() => { editCommitT = 0; liveReprocessEdit(true); }, 160);
	}
	async function liveReprocessEdit(quiet = false) {
		const owner = scanUI;
		const ed = owner && owner.edit;
		if (!ed || !owner) return;
		const sh = owner.shots[ed.i];
		if (!sh) return;
		sh.quad = ed.quad.map((p) => p.slice());
		sh.mode = ed.mode;
		sh.rot = ed.rot;
		const seq = ++liveSeq;
		if (!quiet) setScanBusy(true, "Filter wird angewendet…");
		try {
			await processShot(sh);
			// Scanner geschlossen/gewechselt oder neuere Aktion: Ergebnis nicht mehr in alte UI schreiben.
			if (scanUI !== owner || seq !== liveSeq) return;
			renderShots();
			if (owner.edit && owner.edit.el === ed.el) {
				ed.dirty = false;
				// Im Ecken-Modus niemals auf die zugeschnittene Vorschau wechseln: das
				// vollständige Bild samt allen vier Griffen bleibt unmittelbar editierbar.
				if (!ed.cornerMode && sh.out) drawEditResult(sh);
			}
		} catch (e) {
			console.warn("Heft: Live-Aufbereitung fehlgeschlagen", e);
			if (scanUI === owner && U.toast) U.toast("Scan-Aufbereitung fehlgeschlagen", "error");
		} finally {
			if (!quiet && scanUI === owner && seq === liveSeq) setScanBusy(false);
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
			if (!scanUI || !scanUI.edit || scanUI.edit.el !== ed.el) return;
			// Bei verschachtelten/fixed Overlays kann die Stage im ersten Layout-Frame
			// noch 0×0 melden. Dann die Viewport-Größe verwenden.
			const stageW = stage.clientWidth || window.innerWidth;
			const stageH = stage.clientHeight || Math.max(180, window.innerHeight - 170);
			const k = Math.max(0.02, Math.min((stageW - 24) / img.naturalWidth, (stageH - 24) / img.naturalHeight));
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
				'<button type="button" data-hescandel="1">🗑 Löschen</button>' +
				'<button type="button" class="heft-scan-apply" data-hescandone="1">✓ Fertig</button>' +
			'</div>';
		scanUI.wrap.appendChild(ed);
		// sh.src bleibt das vollständige Rohfoto. Der Zuschnitt wird ausschließlich als
		// Quad gespeichert — deshalb lassen sich alle Ecken jederzeit auch wieder nach
		// außen ziehen, selbst nachdem bereits ein Scan-Ergebnis berechnet wurde.
		scanUI.edit = { i, el: ed, quad: (sh.quad || []).map((p) => p.slice()), mode: sh.mode || "color", rot: sh.rot || 0, img: null, drag: -1, k: 1, cornerMode: false, compare: false, dirty: false };
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
		clearTimeout(editCommitT); editCommitT = 0;
		if (scanUI && scanUI.edit) { scanUI.edit.el.remove(); scanUI.edit = null; }
	}
	function layoutEdit() {
		const ed = scanUI && scanUI.edit;
		if (!ed || !ed.img) return;
		const stage = ed.el.querySelector(".heft-scan-editstage");
		const cv = ed.el.querySelector("canvas");
		const sh = scanUI.shots[ed.i];
		const stageW = stage.clientWidth || window.innerWidth;
		const stageH = stage.clientHeight || Math.max(180, window.innerHeight - 170);
		ed.k = Math.max(0.02, Math.min((stageW - 24) / sh.w, (stageH - 24) / sh.h));
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
		if (was < 0) return;
		const sh = scanUI.shots[ed.i];
		// Gekreuzte oder extrem kleine Quads erzeugen eine singuläre Homographie —
		// dann den letzten gültigen Zuschnitt behalten.
		if (!sh || quadArea(ed.quad) < sh.w * sh.h * 0.015 || !isConvex(ed.quad)) {
			ed.quad = sh && sh.quad ? sh.quad.map((p) => p.slice()) : ed.quad;
			drawEdit();
			if (U.toast) U.toast("Ecken dürfen sich nicht kreuzen und müssen ausreichend Abstand haben.", "error");
			return;
		}
		// Der Rohbild-/Eckenmodus bleibt aktiv. Die Vorschau wird nach einer kurzen
		// Pause aktualisiert, ohne die Griffe zu entfernen oder das Bild zuzuschneiden.
		ed.dirty = true;
		queueCornerReprocess();
	}
	async function finishEdit() {
		// Filter/Drehen/Ecken laufen live — „Fertig“ speichert nur den Stand und schließt
		const owner = scanUI;
		const ed = owner && owner.edit;
		if (!ed || !owner) return;
		const sh = owner.shots[ed.i];
		if (sh) {
			sh.quad = ed.quad.map((p) => p.slice());
			sh.mode = ed.mode;
			sh.rot = ed.rot;
			// Ausstehende Eckbewegungen werden beim Übernehmen garantiert aus dem vollen
			// Rohbild gerechnet — nie aus einem bereits zugeschnittenen Zwischenergebnis.
			clearTimeout(editCommitT); editCommitT = 0;
			if (!sh.out || ed.dirty) {
				setScanBusy(true, "Scan wird aufbereitet…");
				try { await processShot(sh); ed.dirty = false; } catch (e2) { console.warn("Heft: Scan aufbereiten fehlgeschlagen", e2); }
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
	// Handschrift wird nach einer Schreibpause still lokal indexiert. Die Ergebnisse
	// erscheinen dadurch in der normalen Strg/Cmd+K-Suche – ohne separates Werkzeug,
	// Prompt oder künstliche zweite Suche.
	// OCR erhält eine saubere, hochaufgelöste Schreibfläche statt eines Screenshots
	// mit Papierlinien, Griffen und UI. Tesseract kann damit Blockschrift und klare
	// Druckschrift wesentlich zuverlässiger als auf der gerenderten Heftseite lesen.
	function handwritingSignature(pg) {
		return (pg.strokes || []).map((s) => (s.tool || "pen") + ":" + (s.size || 0) + ":" + ((s.pts && s.pts.length) || 0)).join("|");
	}
	function handwritingOcrCanvas(pageIndex, fallbackCanvas) {
		const pg = doc && doc.pages[pageIndex];
		const strokes = pg && pg.strokes ? pg.strokes : [];
		// Bei importierten Bild-/Scan-Seiten gibt es keine editierbaren Striche.
		// Dann bleibt der vorhandene Canvas die sinnvolle Fallback-Quelle.
		if (!strokes.length) return fallbackCanvas;
		const k = 1.8;
		const out = document.createElement("canvas");
		out.width = Math.round(PAGE_W * k); out.height = Math.round(PAGE_H * k);
		const x = out.getContext("2d", { willReadFrequently: true });
		x.fillStyle = "#fff"; x.fillRect(0, 0, out.width, out.height);
		x.scale(k, k);
		strokes.forEach((s) => {
			// Einheitliche dunkle Tinte und etwas kräftigere Linien erhöhen den
			// Kontrast; Marker werden als normale Schrift statt transparent gerendert.
			const clean = { ...s, color: "#111827", size: Math.max(2.4, s.size || 3), tool: s.tool === "marker" ? "pen" : s.tool };
			drawStroke(x, clean);
		});
		return out;
	}
	function scheduleHandwritingIndex(pageIndex) {
		clearTimeout(ocrTimer);
		// Erst nach einer echten Schreibpause: keine OCR-Jobs während des Schreibens.
		ocrTimer = setTimeout(() => { indexHandwritingPage(pageIndex); }, 2600);
	}
	// Native Browser-Erkennung ist der bevorzugte Pfad: Sie verarbeitet echte
	// Stiftstriche statt eines Bildes, benötigt kein zusätzliches Modell und bleibt
	// lokal. Nicht unterstützte Browser fallen kontrolliert auf OCR zurück.
	async function nativeHandwritingText(pg) {
		if (!("createHandwritingRecognizer" in navigator) || !("HandwritingStroke" in window)) return null;
		let recognizer = null, drawing = null;
		try {
			const constraints = { languages: ["de"] };
			if (typeof navigator.queryHandwritingRecognizerSupport === "function") {
				const support = await navigator.queryHandwritingRecognizerSupport(constraints);
				if (!support) return null;
			}
			recognizer = await navigator.createHandwritingRecognizer(constraints);
			drawing = recognizer.startDrawing({ recognitionType: "text", inputType: "stylus", alternatives: 1 });
			for (const ink of pg.strokes || []) {
				if (!ink.pts || !ink.pts.length) continue;
				const stroke = new HandwritingStroke();
				ink.pts.forEach((pt, i) => stroke.addPoint({ x: pt[0], y: pt[1], t: i * 16 }));
				drawing.addStroke(stroke);
			}
			const predictions = await drawing.getPrediction();
			return predictions && predictions[0] && predictions[0].text ? predictions[0].text.trim() : "";
		} catch (err) {
			console.info("Native Handschrifterkennung nicht verfügbar:", err);
			return null;
		} finally {
			try { if (drawing) drawing.clear(); } catch { /* ignore */ }
			try { if (recognizer) recognizer.finish(); } catch { /* ignore */ }
		}
	}
	async function indexHandwritingPage(pageIndex) {
		if (!doc || ocrBusy) return;
		const pg = doc.pages[pageIndex];
		const cv = host && host.querySelectorAll(".heft-canvas")[pageIndex];
		if (!pg || !cv || cv.width < 2 || cv.height < 2) return;
		const signature = handwritingSignature(pg);
		if (pg.ocrSourceSig === signature) return; // unveränderte Seite nie doppelt erkennen
		ocrBusy = true;
		try {
			let text = await nativeHandwritingText(pg);
			if (text === null && window.Tesseract && window.Tesseract.recognize) {
				const source = handwritingOcrCanvas(pageIndex, cv);
				const result = await window.Tesseract.recognize(source, "deu+eng", {
					logger: () => {}, tessedit_pageseg_mode: "6", preserve_interword_spaces: "1",
				});
				text = ((result && result.data && result.data.text) || "")
					.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
				const confidence = Number(result && result.data && result.data.confidence) || 0;
				if (confidence < 25 && text.length < 8) text = "";
			}
			if (text !== null && doc && doc.pages[pageIndex]) {
				doc.pages[pageIndex].ocrText = text;
				doc.pages[pageIndex].ocrSourceSig = signature;
				scheduleSave();
			}
		} catch (err) {
			console.warn("Heft: Hintergrund-OCR fehlgeschlagen", err);
		} finally { ocrBusy = false; }
	}
	function onHostClick(e) {
		const b = e.target.closest("button, .heft-pop-thumb");
		if (!b || !doc) return;
		const d = b.dataset;
		if (suppressEraserClick && d.hetool === "eraser") return;
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
				// Bildauswahl, Lasso und Laser: kein Options-Tray
				tool = d.hetool; expanded = false;
				if (d.hetool === "select") closePop();
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
		else if (d.heonlypen) { onlyPen = !onlyPen; }
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
			// Beim Scrollen werden nur die nun sichtbaren Seiten hochaufgelöst gehalten.
			scheduleVisibleRender();
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
		if (!scroll) return;
		scrollFn = onScroll;
		scroll.addEventListener("scroll", scrollFn, { passive: true });
		// Desktop: Strg/Cmd + Mausrad zoomt direkt auf der Papierfläche (statt Browser-Zoom)
		scroll.addEventListener("wheel", onWheelZoom, { passive: false });
	}
	function rebuildScroll() {
		if (!host || !doc) return;
		const scroll = host.querySelector(".heft-scroll");
		if (!scroll) return;
		const keep = scroll.scrollTop;
		scroll.innerHTML = '<div class="heft-pages">' + doc.pages.map((_, i) =>
			'<div class="heft-page-slot" data-hepage="' + i + '">' +
				'<canvas class="heft-canvas"></canvas>' +
				'<span class="heft-page-label">Seite ' + (i + 1) + '</span>' +
			'</div>'
		).join('') + '</div>';
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
		zoom = 1; navReset();
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
		// Das Einklappen der linken Seitenleiste verändert häufig nur die Breite
		// des Heft-Containers, nicht die Fenstergröße. ResizeObserver reagiert
		// genau auf diesen Layoutwechsel und passt die Seite sofort erneut ein.
		if (window.ResizeObserver) {
			resizeObserver = new ResizeObserver(() => layout());
			resizeObserver.observe(host);
		}
		bindCanvas();
		bindScroll();
		bindTrayDrag();
		layout();
		// Auch bereits vorhandene Notizen werden beim Öffnen still nachindexiert.
		// Zuvor lief OCR nur nach einem NEUEN Stiftstrich; dadurch blieben ältere
		// Hefte in der normalen Suche unsichtbar.
		scheduleHandwritingIndex(idx);
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
		if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
		scrollFn = null;
		host = null; pid = null; doc = null; idx = 0; canvases = []; pageSlots = [];
		drawing = null; sel = null; lassoSel = null; undoStack = []; redoStack = [];
		laserTimers.forEach(clearTimeout); laserTimers.clear();
		clearTimeout(holdTimer); clearTimeout(ocrTimer); ocrTimer = 0; holdTool = null; suppressEraserClick = false;
		// Navigation vollständig zurücksetzen (Gesten, Trägheit, laufende Animationen)
		navReset(); activePenPointers.clear(); clearTimeout(wheelCommitT); clearTimeout(visibleRenderTimer); visibleRenderTimer = 0;
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
