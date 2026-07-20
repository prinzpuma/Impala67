"use strict";
import { S, STATE } from "./state.js";
import { DB } from "./db.js";
import { U } from "./util.js";
import { HANDSCHRIFT } from "./handschrift.js";
import { SCANCORE } from "./heft-scan.js";

// heft.js — GoodNotes-Kern für Impala67 (v12: KISS/DRY-Refactor, funktionsgleich zu v11).
// Persistenz: EIN Blob je Heft ("heft:" + pageId) in IndexedDB; Metadaten via "heftUpdated"-Event.
// Scanner-Bildverarbeitung lebt in heft-scan.js (SCANCORE), Handschrift-OCR in handschrift.js.

export const HEFT = (() => {
	const PAGE_W = 1000, PAGE_H = 1414;
	const KEY = (p) => "heft:" + p;
	const INK_LEGACY = (p) => "impala67.ink." + p;
	const COLORS = ["#1c1c1e", "#2f6fed", "#e0483e", "#1f9d55", "#f5b800", "#8b7cc8"];
	const SIZES = [["F", 1.6], ["M", 3], ["B", 5.5]];
	const PAPERS = [["lined", "☰", "Liniert"], ["grid", "▦", "Kariert"], ["dots", "⣿", "Punkte"], ["blank", "▢", "Blanko"]];

	const docs = {};
	const thumbs = {};
	const dropThumbs = (p) => Object.keys(thumbs).forEach((k) => { if (k.startsWith(p + ":")) delete thumbs[k]; });
	const thumbJobs = {};
	const imgCache = {};
	let host = null, pid = null, doc = null, idx = 0, scale = 1, zoom = 1;
	let canvases = [];
	let detailCanvases = [];
	let wetCanvases = [];
	let pageSlots = [];

	const savedTools = (() => { try { return JSON.parse(localStorage.getItem("impala67HeftTools") || "{}"); } catch (err) { return {}; } })();
	let tool = "pen", color = savedTools.color || COLORS[0], size = savedTools.size || 3, onlyPen = savedTools.onlyPen !== false;
	let eraserSize = savedTools.eraserSize || 16;
	let inlineEd = null;
	let lastEmptyTap = null;
	function saveToolPrefs() { try { localStorage.setItem("impala67HeftTools", JSON.stringify({ color, size, onlyPen, eraserSize })); } catch (err) {  } }
	const activePenPointers = new Set();
	let lastPenUpAt = 0;
	const PEN_GRACE_MS = 400;
	let expanded = false;
	let trayPos = null;
	let trayDrag = null;
	let drawing = null, saveT = 0, resizeFn = null, resizeObserver = null, scrollFn = null;
	let undoStack = [], redoStack = [];
	const pushUndo = (a) => { undoStack.push(a); redoStack = []; };
	let sel = null;
	let lassoSel = null;
	let holdTool = null, holdTimer = 0, suppressEraserClick = false;
	const laserTimers = new Set();
	let insertPos = "after";
	let pop = null;
	let exportSel = null; // Set<pageIndex> im Export-Auswahlmodus des Seiten-Menüs
	let scanUI = null;

	const ocrQueueV2 = new Set();
	const ocrLastRun = new Map();
	let ocrTimerV2 = 0, ocrBusyV2 = false;
	function scheduleHandwritingIndexV2(pi) {
		if (!HANDSCHRIFT.available()) return;
		ocrQueueV2.add(pi);
		clearTimeout(ocrTimerV2);
		ocrTimerV2 = setTimeout(runHandwritingIndexV2, 4000);
	}
	async function runHandwritingIndexV2() {
		if (ocrBusyV2 || !doc || !pid) { clearTimeout(ocrTimerV2); ocrTimerV2 = setTimeout(runHandwritingIndexV2, 4000); return; }
		const jobPid = pid, jobDoc = doc;
		const indices = [...ocrQueueV2];
		ocrQueueV2.clear();
		ocrBusyV2 = true;
		try {
			for (const pi of indices) {
				const key = jobPid + ":" + pi;
				if (Date.now() - (ocrLastRun.get(key) || 0) < 45000) { ocrQueueV2.add(pi); continue; }
				const pg = jobDoc.pages[pi];
				if (!pg || !(pg.strokes && pg.strokes.length)) continue;

				const cv = renderPageCanvas(pg, 1100);
				ocrLastRun.set(key, Date.now());
				const text = await HANDSCHRIFT.recognize(cv);

				if (pid !== jobPid || doc !== jobDoc || text == null) continue;
				if (String(text).trim() !== String(pg.ocrText || "").trim()) {
					pg.ocrText = String(text).trim();
					scheduleSave();
				}
			}
		} catch (e) { console.warn("Heft: Handschrift-Erkennung v2 fehlgeschlagen", e); }
		ocrBusyV2 = false;

		if (ocrQueueV2.size) { clearTimeout(ocrTimerV2); ocrTimerV2 = setTimeout(runHandwritingIndexV2, 45000); }
	}

	const enc = new TextEncoder(), dec = new TextDecoder();

	async function blobHash(buf) {
		const bytes = new Uint8Array(buf);
		const digest = await crypto.subtle.digest("SHA-256", bytes);
		return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
	}
	const newPage = (paper) => ({ id: U.uid(), paper: paper || "lined", strokes: [], images: [], texts: [] });
	const emptyDoc = () => ({ v: 1, rev: 1, pages: [newPage()] });
	const page = () => (doc ? doc.pages[idx] : null);
	const imagesOf = (pg) => (pg.images || (pg.images = []));

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
		} catch {  }
	}

	async function load(p) {
		// Sync-Fix: docs[p] ist ein reiner In-Memory-Cache und wurde bisher NIE
		// invalidiert, wenn ein anderes Gerät dasselbe Heft synchronisiert hat —
		// reconcileHeftBlobs (drive.js) schreibt den neuen Blob nur in IndexedDB,
		// nie in docs. S.heftMeta[p].rev wird dagegen bei JEDEM heftUpdated-Event
		// aktuell gehalten, auch bei importierten Sync-Events (STATE.reduce in
		// replayImported). Weicht rev ab, ist der Cache veraltet und wird verworfen —
		// genau das verursachte den Bug "neue Heftseite kommt trotz Sync nicht an,
		// erst nach App-Neustart".
		const meta = S.heftMeta && S.heftMeta[p];
		const stale = docs[p] && meta && meta.rev !== docs[p].rev;
		if (docs[p] && !stale) return docs[p];
		let d = null;
		try {
			const rec = await DB.getBlob(KEY(p));
			if (rec && rec.buf && rec.buf.byteLength) {
				const parsed = JSON.parse(dec.decode(rec.buf));
				if (parsed && Array.isArray(parsed.pages) && parsed.pages.length) d = parsed;
			}
		} catch (e) { console.warn("Heft: Laden fehlgeschlagen", e); }
		if (!d) d = emptyDoc();

		d.pages.forEach((pg) => { if (!Array.isArray(pg.images)) pg.images = []; if (!Array.isArray(pg.texts)) pg.texts = []; });

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
			try { localStorage.removeItem(INK_LEGACY(p)); } catch {  }
		}
		docs[p] = d;
		return d;
	}
	function scheduleSave() { clearTimeout(saveT); saveT = setTimeout(saveNow, 350); }
	const refresh = (i) => { scheduleSave(); redrawPage(i); renderThumb(i); updateChrome(); };

	async function persistDoc(savePid, saveDoc) {
		saveDoc.rev = (saveDoc.rev || 1) + 1;
		const bytes = enc.encode(JSON.stringify(saveDoc));
		const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
		const contentHash = await blobHash(buf);
		dropThumbs(savePid);
		await DB.putBlob(KEY(savePid), buf, { type: "application/json", kind: "heft", rev: saveDoc.rev, hash: contentHash });
		await maybeSnapshot(savePid, buf, saveDoc.rev);

		const ocrText = saveDoc.pages
			.map((pg) => [pg.ocrText || "", (pg.texts || []).map((t) => t.text).join("\n")].filter(Boolean).join("\n"))
			.filter(Boolean).join("\n");
		await STATE.dispatch("heftUpdated", { pageId: savePid, rev: saveDoc.rev, pages: saveDoc.pages.length, bytes: bytes.byteLength, ocrText, blobHash: contentHash });
	}
	async function saveNow() {
		clearTimeout(saveT);
		if (!pid || !doc) return;

		const savePid = pid, saveDoc = doc;
		try { await persistDoc(savePid, saveDoc); }
		catch (e) { console.warn("Heft: Speichern fehlgeschlagen", e); }
	}

	// ---- Verlauf: lokale Snapshots je Heft (siehe "kommt noch") ----
	// Zeitstempel + rev stecken im Blob-Key ("heftver:<pid>:<t>:<rev>") — Auflisten und
	// Aufräumen brauchen so nur allBlobKeys(), keine Meta-Reads. Bewusst NICHT über Drive
	// gesynct: Snapshots erzeugen keine heftUpdated-Events, der Sync sieht sie nie.
	const VER_PREFIX = (p) => "heftver:" + p + ":";
	const VER_TTL = 24 * 60 * 60 * 1000, VER_GAP = 10 * 60 * 1000, VER_MAX = 20;
	const verLast = {}; // letzter Snapshot-Zeitpunkt je Heft (spart Key-Scan bei jedem Save)
	async function listSnapshots(p) {
		const pre = VER_PREFIX(p);
		return (await DB.allBlobKeys())
			.filter((k) => k.startsWith(pre))
			.map((k) => { const [t, rev] = k.slice(pre.length).split(":"); return { key: k, t: Number(t) || 0, rev: Number(rev) || 0 }; })
			.sort((a, b) => b.t - a.t);
	}
	async function pruneSnapshots(p) {
		const cutoff = Date.now() - VER_TTL;
		const all = await listSnapshots(p);
		const keep = all.filter((s, i) => i < VER_MAX && s.t >= cutoff);
		for (const s of all) if (!keep.includes(s)) await DB.delBlob(s.key);
		return keep;
	}
	async function writeSnapshot(p, buf, rev) {
		const t = Date.now();
		await DB.putBlob(VER_PREFIX(p) + t + ":" + rev, buf, { type: "application/json", kind: "heftver" });
		verLast[p] = t;
	}
	async function maybeSnapshot(p, buf, rev) {
		try {
			if (!verLast[p]) { const s = await listSnapshots(p); verLast[p] = s.length ? s[0].t : 0; }
			if (Date.now() - verLast[p] < VER_GAP) return; // gedrosselt: max. alle 10 Min.
			await writeSnapshot(p, buf, rev);
			await pruneSnapshots(p);
		} catch (e) { console.warn("Heft: Verlauf-Snapshot fehlgeschlagen", e); }
	}
	async function restoreSnapshot(p, key) {
		const rec = await DB.getBlob(key);
		if (!rec || !rec.buf) { if (U.toast) U.toast("Snapshot nicht mehr vorhanden", "error"); return; }
		const cur = pid === p && doc ? doc : await load(p);
		// Sicherheitsnetz: aktuellen Stand IMMER sichern — Wiederherstellen ist damit selbst umkehrbar.
		const curBytes = enc.encode(JSON.stringify(cur));
		await writeSnapshot(p, curBytes.buffer.slice(curBytes.byteOffset, curBytes.byteOffset + curBytes.byteLength), cur.rev || 1);
		const d = JSON.parse(dec.decode(rec.buf));
		d.pages.forEach((pg) => { if (!Array.isArray(pg.images)) pg.images = []; if (!Array.isArray(pg.texts)) pg.texts = []; });
		d.rev = cur.rev || 1; // persistDoc zählt auf rev+1 hoch → Sync sieht den restaurierten Stand als neu
		docs[p] = d;
		await persistDoc(p, d);
		if (pid === p) {
			doc = d; idx = Math.min(idx, d.pages.length - 1); sel = null; lassoSel = null; undoStack = []; redoStack = [];
			rebuildScroll(); updateChrome();
		}
		if (U.toast) U.toast("Heft-Stand wiederhergestellt");
	}
	async function openVerlaufPop() {
		if (!pop || !pid) return;
		const owner = pop;
		owner.dataset.kind = "verlauf";
		owner.innerHTML = '<div class="heft-pop-head">Verlauf wird geladen…</div>';
		let snaps = [];
		try { snaps = await pruneSnapshots(pid); } catch (e) { console.warn("Heft: Verlauf laden fehlgeschlagen", e); }
		if (pop !== owner) return; // Pop wurde inzwischen geschlossen/ersetzt
		const fmt = (t) => new Date(t).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
		owner.__verSnaps = snaps;
		owner.innerHTML = '<div class="heft-pop-head">Verlauf (letzte 24 h)</div>' +
			(snaps.length
				? '<div class="heft-pop-grid">' + snaps.map((s, i) =>
					'<div class="heft-pop-thumb" data-heverrestore="' + i + '" role="button" tabindex="0" title="Stand ' + fmt(s.t) + ' wiederherstellen">' +
						'<canvas width="92" height="130"></canvas><span>' + fmt(s.t) + '</span></div>').join("") + '</div>' +
					'<div class="heft-pop-sub">Antippen stellt den Stand wieder her — der aktuelle Stand wird vorher im Verlauf gesichert. Snapshots entstehen automatisch (max. alle 10 Min.), bleiben 24 h und nur auf diesem Gerät.</div>'
				: '<div class="heft-pop-sub">Noch keine Snapshots — sie entstehen automatisch beim Schreiben (max. alle 10 Min., 24 h aufbewahrt, nur auf diesem Gerät).</div>') +
			'<button type="button" class="heft-pop-row" data-hepagesback="1">← Zurück</button>';
		const cvs = owner.querySelectorAll(".heft-pop-thumb canvas");
		snaps.forEach((s, i) => { if (cvs[i]) renderBlobPreview(s.key, cvs[i]); });
	}

	function contentBottom(pg) {
		let y = 40;
		(pg.strokes || []).forEach((s) => (s.pts || []).forEach((p) => { if (p[1] > y) y = p[1]; }));
		(pg.images || []).forEach((im) => { if (im.y + im.h > y) y = im.y + im.h; });
		(pg.texts || []).forEach((t) => { if (t.y + (t.h || 60) > y) y = t.y + (t.h || 60); });
		return y;
	}
	async function addText(p, text, opts = {}) {
		const body = String(text || "").trim();
		if (!p || !body) return { ok: false, error: "Kein Text" };
		const d = await load(p);
		let pi = opts.pageIndex != null ? Math.max(0, Math.min(d.pages.length - 1, Number(opts.pageIndex) || 0)) : d.pages.length - 1;
		let pg = d.pages[pi], addedPage = false;
		const size = Math.max(16, Math.min(60, Number(opts.size) || 30));
		const w = Math.max(240, Math.min(PAGE_W - 120, Number(opts.w) || PAGE_W - 160));

		const probe = document.createElement("canvas").getContext("2d");
		const t = { id: U.uid(), text: body, x: 80, y: 0, w, h: 60, size, color: String(opts.color || "#1c1c1e") };
		t.h = Math.round(wrapTextLines(probe, t).length * size * TEXT_LH + TEXT_PAD * 2);
		let y = contentBottom(pg) + 30;
		if (opts.pageIndex == null && y > 80 && y + Math.min(t.h, 220) > PAGE_H - 50) {
			pg = newPage(pg.paper); d.pages.push(pg); pi = d.pages.length - 1; addedPage = true; y = 60;
		}
		t.y = Math.min(y, PAGE_H - 80);
		textsOf(pg).push(t);
		if (pid === p && doc === d) {

			pushUndo({ kind: "txtAdd", txt: t, pageIdx: pi });
			if (addedPage) rebuildScroll(); else redrawPage(pi);
			renderThumb(pi); updateChrome();
			scheduleSave();
		} else {
			await persistDoc(p, d);
		}
		return { ok: true, pageIndex: pi, addedPage };
	}
	const hasHeft = (p) => !!((S.heftMeta && S.heftMeta[p]) || docs[p]);
	const pagesOf = (p) => (S.heftMeta && S.heftMeta[p] && S.heftMeta[p].pages) || (docs[p] ? docs[p].pages.length : 1);

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

			let from = pts[0];
			for (let i = 1; i < pts.length; i++) {
				const cur = pts[i];
				const to = i < pts.length - 1 ? [(cur[0] + pts[i + 1][0]) / 2, (cur[1] + pts[i + 1][1]) / 2] : cur;
				x.beginPath(); x.lineWidth = segW(s.size, ((pts[i - 1][2] || 0.5) + (cur[2] || 0.5)) / 2);
				x.moveTo(from[0], from[1]);
				x.quadraticCurveTo(cur[0], cur[1], to[0], to[1]);
				x.stroke();
				from = to;
			}
		}
		x.restore();
	}

	const textsOf = (pg) => (pg.texts || (pg.texts = []));
	const TEXT_LH = 1.4, TEXT_PAD = 10;
	function wrapTextLines(x, t) {
		x.font = "500 " + (t.size || 30) + "px ui-rounded, 'Segoe Print', sans-serif";
		const maxW = Math.max(60, (t.w || 400) - TEXT_PAD * 2);
		const lines = [];
		for (const raw of String(t.text || "").split("\n")) {
			let line = "";
			for (const word of raw.split(/\s+/)) {
				const probe = line ? line + " " + word : word;
				if (line && x.measureText(probe).width > maxW) { lines.push(line); line = word; }
				else line = probe;
			}
			lines.push(line);
		}
		return lines;
	}
	function drawTextBox(x, t) {
		x.save();
		const lines = wrapTextLines(x, t);
		const lh = (t.size || 30) * TEXT_LH;
		t.h = Math.round(lines.length * lh + TEXT_PAD * 2);
		x.fillStyle = t.color || "#1c1c1e";
		x.textBaseline = "top";
		lines.forEach((line, i) => x.fillText(line, t.x + TEXT_PAD, t.y + TEXT_PAD + i * lh));
		x.restore();
	}

	const hitBox = (arr, p) => {
		for (let i = arr.length - 1; i >= 0; i--) {
			const o = arr[i];
			if (p[0] >= o.x && p[0] <= o.x + o.w && p[1] >= o.y && p[1] <= o.y + (o.h || 60)) return o;
		}
		return null;
	};
	const hitText = (pg, p) => hitBox(textsOf(pg), p);

	function imgEl(im) {
		let c = imgCache[im.id];
		if (!c) {
			c = new Image();
			c.onload = () => {

				if (pid) dropThumbs(pid);

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
		const bb = lassoBBox(strokes || []);
		if (!bb) return;
		x.save(); x.setLineDash([8, 5]); x.strokeStyle = "#2f6fed"; x.lineWidth = 2;
		x.strokeRect(bb.minX - 9, bb.minY - 9, bb.maxX - bb.minX + 18, bb.maxY - bb.minY + 18); x.restore();
	}

	function lassoBBox(strokes) {
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		strokes.forEach((s) => strokeOutline(s).forEach((p) => { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); }));
		return isFinite(minX) ? { minX, minY, maxX, maxY } : null;
	}
	function translateStroke(s, dx, dy) {
		if (Array.isArray(s.pts)) s.pts.forEach((p) => { p[0] += dx; p[1] += dy; });
		const sh = s.shape;
		if (!sh) return;
		if (sh.x1 != null) { sh.x1 += dx; sh.y1 += dy; sh.x2 += dx; sh.y2 += dy; }
		if (sh.cx != null) { sh.cx += dx; sh.cy += dy; }
	}
	function drawSelection(x, im) {
		x.save();
		x.strokeStyle = "#2f6fed"; x.lineWidth = 1.5; x.setLineDash([6, 4]);
		x.strokeRect(im.x, im.y, im.w, im.h);
		x.setLineDash([]);

		x.fillStyle = "#2f6fed";
		x.beginPath(); x.arc(im.x + im.w, im.y + im.h, 7, 0, Math.PI * 2); x.fill();

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
		(pg.texts || []).forEach((t) => { if (!t.hidden) drawTextBox(x, t); });
		if (lassoSel && lassoSel.pageIdx === pi) drawLassoSelection(x, lassoSel.strokes);
		if (sel && doc && sel.pageIdx === pi && doc.pages[pi] === pg) {
			const im = sel.imgId ? imagesOf(pg).find((i2) => i2.id === sel.imgId) : null;
			if (im) drawSelection(x, im);
			const tx = sel.txtId ? textsOf(pg).find((t2) => t2.id === sel.txtId) : null;
			if (tx) drawSelection(x, tx);
		}
	}

	// pageIndex: welche Seite gezeigt wird (Default 0). Rückgabe null bei Fehler,
	// sonst { pageIndex, pageCount } — vorher fix Seite 0, ohne Rückmeldung welche
	// Seite es war (Konflikt-Popup zeigte dadurch bei Hefts immer "Seite 1").
	async function renderBlobPreview(blobKey, cv, pageIndex = 0) {
		try {
			const rec = await DB.getBlob(blobKey);
			if (!rec || !rec.buf) return null;
			const d = JSON.parse(new TextDecoder().decode(rec.buf));
			if (!d || !Array.isArray(d.pages) || !d.pages.length) return null;
			const pi = Math.max(0, Math.min(d.pages.length - 1, pageIndex));
			const pg = d.pages[pi];
			if (!Array.isArray(pg.strokes)) pg.strokes = [];
			paintInto(cv, pg, -1);
			return { pageIndex: pi, pageCount: d.pages.length };
		} catch (e) {
			console.warn("Heft-Konflikt-Vorschau fehlgeschlagen:", e);
			return null;
		}
	}

	// Erste Seite, auf der sich zwei Heft-Blobs inhaltlich unterscheiden — damit
	// das Konflikt-Popup die tatsächlich abweichende Seite zeigt statt immer Seite 1.
	async function findDivergentPage(keyA, keyB) {
		try {
			const [a, b] = await Promise.all([DB.getBlob(keyA), DB.getBlob(keyB)]);
			if (!a || !a.buf || !b || !b.buf) return 0;
			const pagesA = JSON.parse(new TextDecoder().decode(a.buf)).pages || [];
			const pagesB = JSON.parse(new TextDecoder().decode(b.buf)).pages || [];
			for (let i = 0; i < Math.max(pagesA.length, pagesB.length); i++) {
				if (JSON.stringify(pagesA[i] || null) !== JSON.stringify(pagesB[i] || null)) return i;
			}
			return 0;
		} catch (e) {
			console.warn("Heft: Divergenz-Suche fehlgeschlagen", e);
			return 0;
		}
	}

	function applyTransform(x) {
		const dpr = x.canvas.__heftDpr || 1;
		x.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
	}
	function redrawPage(i) {
		if (!doc || !doc.pages[i]) return;
		const cv = canvases[i];
		if (cv && cv.width >= 2 && cv.height >= 2) {
			const x = cv.getContext('2d');
			x.setTransform(1, 0, 0, 1, 0, 0);
			x.clearRect(0, 0, cv.width, cv.height);
			applyTransform(x);
			renderPageTo(x, doc.pages[i], i);
		}

		renderDetailTile(i);
	}
	function redraw() { renderVisiblePages(); }

	const ZOOM_MIN = 1, ZOOM_MAX = 3.5;

	const MAX_RENDER_DPR = 1.5, MAX_RENDER_PIXELS = 6_000_000, MAX_CANVAS_DIM = 4096;
	let visibleRenderTimer = 0, zoomSettleTimer = 0, scrollRenderFrame = 0, scrollSettleTimer = 0;
	const gesture = {
		touches: new Map(), pinch: null, maxCount: 0, moved: false, startedAt: 0,
		raf: 0, zoomFrame: 0, pendingZoom: null,
		lastTap: 0, tapX: 0, tapY: 0, lastTwoTap: 0,
	};
	const scrollEl = () => (host ? host.querySelector(".heft-scroll") : null);
	const pagesEl = () => (host ? host.querySelector(".heft-pages") : null);
	const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

	const clearPagesFx = (pgs = pagesEl()) => { if (pgs) { pgs.style.transform = ""; pgs.style.transformOrigin = ""; pgs.style.willChange = ""; } };
	function stopAnim() {
		if (gesture.raf) cancelAnimationFrame(gesture.raf);
		if (gesture.zoomFrame) cancelAnimationFrame(gesture.zoomFrame);
		gesture.raf = gesture.zoomFrame = 0; gesture.pendingZoom = null;

		if (gesture.dtap) { gesture.dtap = false; clearPagesFx(); }
	}
	function navReset() {
		stopAnim(); gesture.touches.clear();

		clearPagesFx();
		gesture.pinch = null; gesture.maxCount = 0; gesture.moved = false; gesture.lastTap = 0; gesture.lastTwoTap = 0;
	}
	function applyView(commit) {
		const scroll = scrollEl(); if (!scroll) return;

		const innerW = Math.max(1, scroll.clientWidth - 36);
		const innerH = Math.max(1, scroll.clientHeight - 36);

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
		else hideDetailCanvases();

	}
	function visiblePageIndices() {
		const scroll = scrollEl(); if (!scroll) return [];

		const sr = scroll.getBoundingClientRect(), pad = Math.max(600, sr.height * 1.5), out = [];
		pageSlots.forEach((slot, i) => {
				if (!slot) return;
				const r = slot.getBoundingClientRect();
				if (r.bottom >= sr.top - pad && r.top <= sr.bottom + pad) out.push(i);
			});
		return out;
	}
	function tileDpr() { return Math.min(2, window.devicePixelRatio || 1); }
	function tileTransform(x, t) { x.setTransform(t.dpr * t.scale, 0, 0, t.dpr * t.scale, -t.x * t.dpr, -t.y * t.dpr); }

	function layerRectFor(i) {
		const scroll = scrollEl(), base = canvases[i];
		if (!scroll || !base) return null;
		const sr = scroll.getBoundingClientRect(), pr = base.getBoundingClientRect();
		if (pr.bottom <= sr.top || pr.top >= sr.bottom || pr.right <= sr.left || pr.left >= sr.right) return null;
		const over = 200;
		const x0 = Math.max(0, Math.min(pr.width, sr.left - pr.left - over));
		const y0 = Math.max(0, Math.min(pr.height, sr.top - pr.top - over));
		const x1 = Math.max(0, Math.min(pr.width, sr.right - pr.left + over));
		const y1 = Math.max(0, Math.min(pr.height, sr.bottom - pr.top + over));
		if (x1 - x0 < 2 || y1 - y0 < 2) return null;
		return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
	}
	function placeLayer(cv, i, r, dpr) {
		const base = canvases[i];
		cv.style.left = Math.round(base.offsetLeft + r.x) + "px";
		cv.style.top = Math.round(base.offsetTop + r.y) + "px";
		cv.style.width = r.w + "px"; cv.style.height = r.h + "px";
		const pw = Math.max(1, Math.round(r.w * dpr)), ph = Math.max(1, Math.round(r.h * dpr));
		if (cv.width !== pw) cv.width = pw;
		if (cv.height !== ph) cv.height = ph;
		cv.__heftTile = { x: r.x, y: r.y, w: r.w, h: r.h, dpr, scale };
		cv.style.display = "block";
	}
	function hideLayer(cv) { if (cv) { cv.style.display = "none"; cv.__heftTile = null; } }
	function hideDetailCanvases() { detailCanvases.forEach(hideLayer); wetCanvases.forEach(hideLayer); }

	function renderDetailTile(i) {
		const tile = detailCanvases[i], wet = wetCanvases[i];
		if (!tile || !doc || !doc.pages[i]) return;

		if (drawing && drawing.pageIdx === i && drawing.ctx && !drawing.erasing) return;
		const r = layerRectFor(i);
		if (!r) { hideLayer(tile); hideLayer(wet); return; }
		const dpr = tileDpr();
		placeLayer(tile, i, r, dpr);
		const x = tile.getContext("2d");
		x.setTransform(1, 0, 0, 1, 0, 0);
		x.clearRect(0, 0, tile.width, tile.height);
		x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
		tileTransform(x, tile.__heftTile);
		renderPageTo(x, doc.pages[i], i);
		if (wet) {
			placeLayer(wet, i, r, dpr);
			const wx = wet.getContext("2d");
			wx.setTransform(1, 0, 0, 1, 0, 0);
			wx.clearRect(0, 0, wet.width, wet.height);
		}
	}
	function tileCovers(i) {
		const tile = detailCanvases[i], t = tile && tile.__heftTile;
		if (!t || tile.style.display === "none" || Math.abs(t.scale - scale) > 0.0001 || t.dpr !== tileDpr()) return false;
		const scroll = scrollEl(), base = canvases[i];
		if (!scroll || !base) return false;
		const sr = scroll.getBoundingClientRect(), pr = base.getBoundingClientRect();
		const nx0 = Math.max(0, sr.left - pr.left), ny0 = Math.max(0, sr.top - pr.top);
		const nx1 = Math.min(pr.width, sr.right - pr.left), ny1 = Math.min(pr.height, sr.bottom - pr.top);
		return t.x <= nx0 && t.y <= ny0 && t.x + t.w >= nx1 && t.y + t.h >= ny1;
	}

	function renderDetailTiles(force = false) {
		if (!doc) return;
		canvases.forEach((_, i) => {
			if (!layerRectFor(i)) { hideLayer(detailCanvases[i]); hideLayer(wetCanvases[i]); return; }
			if (!force && tileCovers(i)) return;
			renderDetailTile(i);
		});
	}

	function liveInkCtx(i) {
		const wet = wetCanvases[i];
		if (wet && wet.__heftTile && wet.style.display !== "none") {
			const x = wet.getContext("2d");
			tileTransform(x, wet.__heftTile);
			return x;
		}

		const x = canvases[i].getContext("2d");
		applyTransform(x);
		return x;
	}
	function clearLiveInk(i) {
		const wet = wetCanvases[i];
		if (!wet || !wet.__heftTile || wet.style.display === "none") return false;
		const x = wet.getContext("2d");
		x.setTransform(1, 0, 0, 1, 0, 0);
		x.clearRect(0, 0, wet.width, wet.height);
		tileTransform(x, wet.__heftTile);
		return true;
	}

	function commitStrokeRender(i, stroke) {
		const cv = canvases[i];
		if (cv && cv.width > 1) { const x = cv.getContext("2d"); applyTransform(x); drawStroke(x, stroke); }
		const tile = detailCanvases[i];
		if (tile && tile.__heftTile && tile.style.display !== "none") {
			const x = tile.getContext("2d"); tileTransform(x, tile.__heftTile); drawStroke(x, stroke);
		}
		clearLiveInk(i);
	}
	function renderVisiblePages(skipTiles = false) {
		if (!doc) return;
		const visible = new Set(visiblePageIndices());

		const nativeDpr = Math.min(MAX_RENDER_DPR, window.devicePixelRatio || 1);
		const pageW = PAGE_W * scale, pageH = PAGE_H * scale;
		const pixelBudgetDpr = Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, pageW * pageH));
		const edgeBudgetDpr = MAX_CANVAS_DIM / Math.max(pageW, pageH);

		const safeDpr = Math.max(0.5, Math.min(nativeDpr, pixelBudgetDpr, edgeBudgetDpr));
		canvases.forEach((cv, i) => {
			if (!visible.has(i)) {

				if (cv.width !== 1 || cv.height !== 1) { cv.width = 1; cv.height = 1; }
				hideLayer(detailCanvases[i]); hideLayer(wetCanvases[i]);
				return;
			}
			cv.__heftDpr = safeDpr;
			const w = Math.max(1, Math.round(PAGE_W * scale * safeDpr));
			const h = Math.max(1, Math.round(PAGE_H * scale * safeDpr));

			const needsRender = cv.width !== w || cv.height !== h;
			if (cv.width !== w) cv.width = w;
			if (cv.height !== h) cv.height = h;
			if (needsRender) redrawPage(i);
		});

		if (!skipTiles) renderDetailTiles(false);
	}
	function scheduleVisibleRender(delay = 90) {
		clearTimeout(visibleRenderTimer);
		visibleRenderTimer = setTimeout(() => { visibleRenderTimer = 0; renderVisiblePages(); }, delay);
	}

	function scheduleZoomSettleRender() {
		clearTimeout(zoomSettleTimer);
		zoomSettleTimer = setTimeout(() => { zoomSettleTimer = 0; renderVisiblePages(); }, 140);
	}

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
		return { cv, nx: clamp((clientX - r.left) / Math.max(1, r.width), 0, 1), ny: clamp((clientY - r.top) / Math.max(1, r.height), 0, 1) };
	}
	function keepAnchor(anchor, clientX, clientY) {
		const scroll = scrollEl(); if (!scroll || !anchor || !anchor.cv.isConnected) return;
		const r = anchor.cv.getBoundingClientRect();
		scroll.scrollLeft += r.left + r.width * anchor.nx - clientX;
		scroll.scrollTop += r.top + r.height * anchor.ny - clientY;
	}
	function setZoom(next, clientX, clientY, commit, fixedAnchor) {
		next = clamp(next, ZOOM_MIN, ZOOM_MAX);
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

	function flipGlide(cv, first, dur) {
		const pgs = pagesEl();
		if (!pgs || !cv || !cv.isConnected || !first) { scheduleZoomSettleRender(); return; }
		const pr = pgs.getBoundingClientRect(), last = cv.getBoundingClientRect();
		const s = first.width / Math.max(1, last.width);
		const dx = (first.left - pr.left) - (last.left - pr.left) * s;
		const dy = (first.top - pr.top) - (last.top - pr.top) * s;

		if (Math.abs(1 - s) < 0.003 && Math.abs(dx) < 1.5 && Math.abs(dy) < 1.5) { scheduleZoomSettleRender(); return; }
		pgs.style.transformOrigin = "0 0";
		pgs.style.willChange = "transform";
		pgs.style.transform = "translate(" + dx + "px, " + dy + "px) scale(" + s + ")";
		gesture.dtap = true;
		const t0 = performance.now();
		const step = (now) => {
			const t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 3);
			if (t < 1) {
				pgs.style.transform = "translate(" + (dx * (1 - e)) + "px, " + (dy * (1 - e)) + "px) scale(" + (s + (1 - s) * e) + ")";
				gesture.raf = requestAnimationFrame(step);
			} else {
				gesture.raf = 0; gesture.dtap = false;
				clearPagesFx(pgs);
				scheduleZoomSettleRender();
			}
		};
		gesture.raf = requestAnimationFrame(step);
	}
	function animateZoom(target, clientX, clientY) {
		stopAnim();
		target = clamp(target, ZOOM_MIN, ZOOM_MAX);
		const anchor = makeZoomAnchor(clientX, clientY);

		if (!anchor) { setZoom(target, clientX, clientY, false, anchor); scheduleZoomSettleRender(); return; }
		const first = anchor.cv.getBoundingClientRect();
		setZoom(target, clientX, clientY, false, anchor);
		flipGlide(anchor.cv, first, 320);
	}

	function applyTouchAction() {

		const mode = touchNavigates() ? "pan-x pan-y" : "none";
		const scroll = scrollEl();
		if (scroll) scroll.style.touchAction = mode;
		canvases.forEach((cv) => { if (cv) cv.style.touchAction = mode; });
	}

	function onPenBoundary(e) {
		if (e.pointerType !== "pen") return;
		if (e.type === "pointerover") e.currentTarget.style.touchAction = "none";
		else if (!activePenPointers.size) applyTouchAction();
	}

	function settlePinch() {

		const g = gesture.pinch;
		gesture.pinch = null;
		if (gesture.zoomFrame) { cancelAnimationFrame(gesture.zoomFrame); gesture.zoomFrame = 0; }
		const cv = g && g.anchor && g.anchor.cv && g.anchor.cv.isConnected ? g.anchor.cv : null;
		const first = cv ? cv.getBoundingClientRect() : null;
		clearPagesFx();
		if (g && g.factor !== 1) setZoom(g.zoom0 * g.factor, g.mid[0], g.mid[1], false, g.anchor);
		if (gesture.pendingZoom) { const p = gesture.pendingZoom; gesture.pendingZoom = null; setZoom(p.next, p.clientX, p.clientY, false, p.anchor); }
		applyView(false);
		if (first) flipGlide(cv, first, 200); else scheduleZoomSettleRender();
	}

	const fingersOf = (list) => [...list].filter((t) => t.touchType !== "stylus");
	const touchMid = (t) => [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2];
	const touchDist = (t) => Math.max(1, Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY));
	function onTouchStart(e) {

		if (fingersOf(e.changedTouches).length !== e.changedTouches.length) e.preventDefault();
		if (!touchNavigates()) return;
		for (const t of fingersOf(e.changedTouches)) gesture.touches.set(t.identifier, { x: t.clientX, y: t.clientY });
		const fingers = fingersOf(e.touches);
		gesture.maxCount = Math.max(gesture.maxCount, fingers.length);
		if (gesture.touches.size === 1) { stopAnim(); gesture.moved = false; gesture.startedAt = Date.now(); }
		if (fingers.length >= 2 && !gesture.pinch) {

			e.preventDefault(); stopAnim();
			const [mx, my] = touchMid(fingers);

			const pgs = pagesEl();
			if (pgs) {
				const pr = pgs.getBoundingClientRect();
				pgs.style.transformOrigin = (mx - pr.left) + "px " + (my - pr.top) + "px";
				pgs.style.willChange = "transform";
			}
			gesture.pinch = { d0: touchDist(fingers), zoom0: zoom, anchor: makeZoomAnchor(mx, my), mid0: [mx, my], mid: [mx, my], factor: 1 };
		}
	}
	function onTouchMove(e) {
		if (penRecently()) { navReset(); return; }
		for (const t of e.changedTouches) {
			const s = gesture.touches.get(t.identifier);
			if (s && Math.hypot(t.clientX - s.x, t.clientY - s.y) > 7) gesture.moved = true;
		}
		const fingers = fingersOf(e.touches);
		if (gesture.pinch && fingers.length >= 2) {
			e.preventDefault();
			const [mx, my] = touchMid(fingers);

			const g = gesture.pinch;
			g.factor = clamp(touchDist(fingers) / g.d0, ZOOM_MIN / g.zoom0, ZOOM_MAX / g.zoom0);
			g.mid = [mx, my];
			if (!gesture.zoomFrame) gesture.zoomFrame = requestAnimationFrame(() => {
				gesture.zoomFrame = 0;
				const gp = gesture.pinch, pgs = pagesEl();
				if (!gp || !pgs) return;
				pgs.style.transform = "translate(" + (gp.mid[0] - gp.mid0[0]) + "px, " + (gp.mid[1] - gp.mid0[1]) + "px) scale(" + gp.factor + ")";
			});
		}
	}
	function onTouchEnd(e) {
		for (const t of e.changedTouches) gesture.touches.delete(t.identifier);
		if (gesture.pinch && fingersOf(e.touches).length < 2) settlePinch();
		if (e.touches.length) return;
		const quick = Date.now() - gesture.startedAt < 300 && !gesture.moved;
		const count = gesture.maxCount; gesture.maxCount = 0;
		if (quick && count === 2) {
			// Undo erst beim DOPPEL-Tipp mit zwei Fingern (vorher reichte EIN Zwei-Finger-Tipp —
			// zu viele versehentliche Rückgängig beim Umgreifen/Abstützen).
			const now2f = Date.now();
			if (now2f - gesture.lastTwoTap < 500) { gesture.lastTwoTap = 0; undo(); }
			else gesture.lastTwoTap = now2f;
			return;
		}
		if (quick && count >= 3) { redo(); return; }
		if (quick && count === 1 && e.changedTouches.length) {
			const t = e.changedTouches[0], now = Date.now();
			if (now - gesture.lastTap < 330 && Math.hypot(t.clientX - gesture.tapX, t.clientY - gesture.tapY) < 64) {

				gesture.lastTap = 0;
				animateZoom(zoom >= 1.9 ? 1 : Math.max(2.2, Math.min(ZOOM_MAX, zoom * 1.8)), t.clientX, t.clientY);
				return;
			}
			gesture.lastTap = now; gesture.tapX = t.clientX; gesture.tapY = t.clientY;
		}
	}
	function onTouchCancel(e) {
		for (const t of e.changedTouches) gesture.touches.delete(t.identifier);
		if (gesture.pinch && fingersOf(e.touches).length < 2) settlePinch();

		gesture.moved = true;
	}
	let wheelCommitT = 0;
	function onWheelZoom(e) {
		if (!e.ctrlKey && !e.metaKey) return;
		e.preventDefault();
		const factor = Math.exp(-e.deltaY * 0.0022);
		queueZoom(zoom * factor, e.clientX, e.clientY, makeZoomAnchor(e.clientX, e.clientY));
		clearTimeout(wheelCommitT); wheelCommitT = setTimeout(() => scheduleZoomSettleRender(), 160);
	}

	const pos = (e, cv) => {
		const r = cv.getBoundingClientRect();
		return [
			Math.round((e.clientX - r.left) / scale * 10) / 10,
			Math.round((e.clientY - r.top) / scale * 10) / 10,
			Math.round((e.pressure || 0.5) * 100) / 100,
		];
	};

	const penRecently = () => activePenPointers.size > 0 || Date.now() - lastPenUpAt < PEN_GRACE_MS;
	const rejected = (e) => e.pointerType === "touch" && (onlyPen || penRecently());
	const touchNavigates = () => onlyPen && !penRecently();
	const near = (p, x, y, r) => { const dx = p[0] - x, dy = p[1] - y; return dx * dx + dy * dy <= r * r; };
	function pointInPolygon(p, poly) {
		let hit = false;
		for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
			const a = poly[i], b = poly[j];
			if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / ((b[1] - a[1]) || .0001) + a[0]) hit = !hit;
		}
		return hit;
	}
	const hitImage = (pg, p) => hitBox(imagesOf(pg), p);

	const segDist2 = (px, py, ax, ay, bx, by) => {
		const dx = bx - ax, dy = by - ay;
		const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / ((dx * dx + dy * dy) || 1)));
		const qx = ax + t * dx, qy = ay + t * dy;
		return (px - qx) * (px - qx) + (py - qy) * (py - qy);
	};
	function strokeOutline(s) {
		const sh = s.shape;
		const pts = [];
		if (sh && sh.type === "line") {
			for (let i = 0; i <= 16; i++) pts.push([sh.x1 + (sh.x2 - sh.x1) * i / 16, sh.y1 + (sh.y2 - sh.y1) * i / 16]);
			return pts;
		}
		if (sh && sh.type === "rect") {
			const cs = [[sh.x1, sh.y1], [sh.x2, sh.y1], [sh.x2, sh.y2], [sh.x1, sh.y2], [sh.x1, sh.y1]];
			for (let k = 0; k < 4; k++) for (let i = 0; i < 8; i++) {
				const t = i / 8;
				pts.push([cs[k][0] + (cs[k + 1][0] - cs[k][0]) * t, cs[k][1] + (cs[k + 1][1] - cs[k][1]) * t]);
			}
			pts.push([sh.x1, sh.y1]);
			return pts;
		}
		if (sh && (sh.type === "ellipse" || sh.type === "circle")) {
			const rx = sh.rx != null ? sh.rx : sh.r, ry = sh.ry != null ? sh.ry : sh.r;
			for (let i = 0; i <= 24; i++) { const a = i / 24 * Math.PI * 2; pts.push([sh.cx + Math.cos(a) * rx, sh.cy + Math.sin(a) * ry]); }
			return pts;
		}
		return s.pts || [];
	}
	function strokeHitAt(s, x, y, r) {
		const pts = strokeOutline(s);
		if (!pts.length) return false;
		const rr = r + (s.size || 2) / 2, rr2 = rr * rr;
		if (pts.length === 1) { const dx = pts[0][0] - x, dy = pts[0][1] - y; return dx * dx + dy * dy <= rr2; }
		for (let i = 1; i < pts.length; i++) if (segDist2(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= rr2) return true;
		return false;
	}
	let eraseFrame = 0; // PERF: gedrosselter Redraw für Radierer & Lasso-Verschieben
	const redrawNextFrame = (pi) => { if (!eraseFrame) eraseFrame = requestAnimationFrame(() => { eraseFrame = 0; redrawPage(pi); }); };
	function eraseAt(e) {
		const p0 = pos(e, drawing.cv), r = eraserSize, pg = doc.pages[drawing.pageIdx];
		const keep = [], removed = [];
		for (const s of pg.strokes) (strokeHitAt(s, p0[0], p0[1], r) ? removed : keep).push(s);
		if (removed.length) {
			pg.strokes = keep; drawing.removed.push(...removed);
			// PERF: höchstens EIN Redraw pro Frame — Pointer-Events feuern (v.a. mit
			// Coalescing) deutlich öfter als der Bildschirm zeichnet; Radieren auf
			// vollen Seiten ruckelte dadurch.
			redrawNextFrame(drawing.pageIdx);
		}
	}
	function onDown(e) {

		if (e.pointerType === "pen") { activePenPointers.add(e.pointerId); stopAnim(); applyTouchAction(); }
		if (rejected(e) || !doc) return;
		const cv = e.currentTarget;
		const slot = cv.closest('.heft-page-slot');
		const pi = slot ? Number(slot.dataset.hepage) : idx;
		const pg = doc.pages[pi];
		if (!pg) return;
		idx = pi;
		e.preventDefault();
		try { cv.setPointerCapture(e.pointerId); } catch {  }

		const x = liveInkCtx(pi);
		const p = pos(e, cv);
		if (tool === "lasso") {

			if (lassoSel && lassoSel.pageIdx === pi && lassoSel.strokes.length) {
				const bb = lassoBBox(lassoSel.strokes);
				if (bb && p[0] >= bb.minX - 12 && p[0] <= bb.maxX + 12 && p[1] >= bb.minY - 12 && p[1] <= bb.maxY + 12) {
					drawing = { lassoMove: true, strokes: lassoSel.strokes, cv, pageIdx: pi, last: p, dx: 0, dy: 0 };
					return;
				}
			}

			drawing = { lasso: true, pts: [p], cv, ctx: x, pageIdx: pi };
			return;
		}
		if (tool === "laser") {

			drawing = { laser: true, tool: "pen", color: "#ef4444", size: 7, pts: [p], cv, ctx: x, pageIdx: pi };
			return;
		}
		if (tool === "select") {

			const st = sel && sel.pageIdx === pi && sel.txtId ? textsOf(pg).find((t2) => t2.id === sel.txtId) : null;
			if (st && near(p, st.x + st.w, st.y, 16)) {

				pg.texts = textsOf(pg).filter((t2) => t2 !== st);
				pushUndo({ kind: "txtDel", txt: st, pageIdx: pi });
				sel = null;
				refresh(pi);
				return;
			}
			if (st && near(p, st.x + st.w, st.y + (st.h || 60), 16)) {

				drawing = { imgResize: true, isText: true, im: st, cv, pageIdx: pi, start: p, orig: { x: st.x, y: st.y, w: st.w, h: st.h } };
				return;
			}
			const ht = hitText(pg, p);
			if (ht) {
				const now = Date.now();
				if (sel && sel.txtId === ht.id && now - (sel.tapAt || 0) < 400) {

					sel = { pageIdx: pi, txtId: ht.id, tapAt: 0 };
					openTextEditor(pi, ht.x, ht.y, ht);
					return;
				}
				sel = { pageIdx: pi, txtId: ht.id, tapAt: now };
				drawing = { imgMove: true, isText: true, im: ht, cv, pageIdx: pi, start: p, orig: { x: ht.x, y: ht.y, w: ht.w, h: ht.h } };
				redrawPage(pi);
				return;
			}

			const im = sel && sel.pageIdx === pi ? imagesOf(pg).find((i2) => i2.id === sel.imgId) : null;
			if (im && near(p, im.x + im.w, im.y, 16)) {

				pg.images = imagesOf(pg).filter((i2) => i2 !== im);
				pushUndo({ kind: "imgDel", img: im, pageIdx: pi });
				sel = null;
				refresh(pi);
				return;
			}
			if (im && near(p, im.x + im.w, im.y + im.h, 16)) {

				drawing = { imgResize: true, im, cv, pageIdx: pi, start: p, orig: { x: im.x, y: im.y, w: im.w, h: im.h } };
				return;
			}
			const hit = hitImage(pg, p);
			if (hit) {
				sel = { pageIdx: pi, imgId: hit.id };
				drawing = { imgMove: true, im: hit, cv, pageIdx: pi, start: p, orig: { x: hit.x, y: hit.y, w: hit.w, h: hit.h } };
				redrawPage(pi);
				lastEmptyTap = null;
			} else {

				const now2 = Date.now();
				if (lastEmptyTap && lastEmptyTap.pi === pi && now2 - lastEmptyTap.t < 450 && Math.hypot(p[0] - lastEmptyTap.p[0], p[1] - lastEmptyTap.p[1]) < 40) {
					lastEmptyTap = null;
					openTextEditor(pi, Math.max(20, p[0] - 10), Math.max(20, p[1] - 20), null);
					return;
				}
				lastEmptyTap = { pi, t: now2, p };
				if (sel) { const spi = sel.pageIdx; sel = null; redrawPage(spi); }
			}
			return;
		}
		if (sel) { const spi = sel.pageIdx; sel = null; redrawPage(spi); }
		if (tool === "eraser") { drawing = { erasing: true, removed: [], cv, ctx: x, pageIdx: pi }; eraseAt(e); }
		else { drawing = { tool, color, size, pts: [p], cv, ctx: x, pageIdx: pi }; armHoldSnap(p); }

		const chromeEl = host && host.querySelector(".heft-chrome");
		if (chromeEl) chromeEl.classList.add("heft-writing");
	}

	let snapTimer = null;
	function armHoldSnap(p) {
		if (snapTimer) clearTimeout(snapTimer);
		snapTimer = null;
		if (!drawing || drawing.snapped || drawing.laser || !(drawing.tool === "pen" || drawing.tool === "marker")) return;
		drawing.holdAnchor = p;
		snapTimer = setTimeout(trySnapShape, 550);
	}
	function trySnapShape() {
		snapTimer = null;
		if (!drawing || drawing.snapped || !drawing.pts || drawing.pts.length < 8) return;
		const shape = fitShape(drawing.pts);
		if (!shape) return;
		drawing.snapped = shape;
		if (!clearLiveInk(drawing.pageIdx)) redrawPage(drawing.pageIdx);
		drawStroke(drawing.ctx, { tool: "shape", color: drawing.color, size: drawing.size, pts: [drawing.pts[0]], shape });
		if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) {  } }
	}

	function fitShape(pts) {
		const a = pts[0], b = pts[pts.length - 1];
		const w = b[0] - a[0], h = b[1] - a[1], len = Math.hypot(w, h);
		let pathLen = 0;
		for (let i = 1; i < pts.length; i++) pathLen += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
		if (pathLen < 30) return null;
		let maxDev = 0;
		for (const p of pts) maxDev = Math.max(maxDev, Math.abs(h * (p[0] - a[0]) - w * (p[1] - a[1])) / Math.max(1, len));
		const closed = pts.length > 10 && Math.hypot(b[0] - a[0], b[1] - a[1]) < Math.max(18, pathLen * 0.2);
		if (closed) {
			let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
			pts.forEach((p) => { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); });
			const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, rx = (maxX - minX) / 2, ry = (maxY - minY) / 2;
			if (rx < 10 || ry < 10) return null;
			let errRect = 0, errEllipse = 0;
			pts.forEach((p) => {
				const dxRect = Math.min(Math.abs(p[0] - minX), Math.abs(p[0] - maxX));
				const dyRect = Math.min(Math.abs(p[1] - minY), Math.abs(p[1] - maxY));
				errRect += Math.min(dxRect, dyRect);
				const nx = rx ? (p[0] - cx) / rx : 0, ny = ry ? (p[1] - cy) / ry : 0;
				errEllipse += Math.abs(Math.hypot(nx, ny) - 1) * Math.max(rx, ry);
			});
			if (errRect < errEllipse * 0.85) return { type: "rect", x1: minX, y1: minY, x2: maxX, y2: maxY };
			return { type: "ellipse", cx, cy, rx, ry };
		}
		if (maxDev < Math.max(10, len * 0.1)) return { type: "line", x1: a[0], y1: a[1], x2: b[0], y2: b[1] };
		return null;
	}
	function onMove(e) {
		if (!drawing || rejected(e)) return;
		e.preventDefault();
		if (drawing.lasso) {
			drawing.pts.push(pos(e, drawing.cv));

			if (!clearLiveInk(drawing.pageIdx)) redrawPage(drawing.pageIdx);
			const x = drawing.ctx;
			x.save(); x.setLineDash([7, 4]); x.strokeStyle = "#2f6fed"; x.lineWidth = 1.7;
			x.beginPath(); x.moveTo(drawing.pts[0][0], drawing.pts[0][1]);
			for (let i = 1; i < drawing.pts.length; i++) x.lineTo(drawing.pts[i][0], drawing.pts[i][1]);
			x.stroke(); x.restore();
			return;
		}
		if (drawing.lassoMove) {

			const pm = pos(e, drawing.cv);
			const dx = pm[0] - drawing.last[0], dy = pm[1] - drawing.last[1];
			if (dx || dy) {
				drawing.strokes.forEach((s) => translateStroke(s, dx, dy));
				drawing.dx += dx; drawing.dy += dy; drawing.last = pm;
				redrawNextFrame(drawing.pageIdx); // PERF: pro Frame statt pro Pointer-Event
			}
			return;
		}
		if (drawing.snapped) {

			const pSnap = pos(e, drawing.cv);
			drawing.pts.push(pSnap);
			if (drawing.snapped.type === "line") { drawing.snapped.x2 = pSnap[0]; drawing.snapped.y2 = pSnap[1]; }
			if (!clearLiveInk(drawing.pageIdx)) redrawPage(drawing.pageIdx);
			drawStroke(drawing.ctx, { tool: "shape", color: drawing.color, size: drawing.size, pts: [drawing.pts[0]], shape: drawing.snapped });
			return;
		}
		if (drawing.imgMove || drawing.imgResize) {
			const p = pos(e, drawing.cv);
			const dx = p[0] - drawing.start[0], dy = p[1] - drawing.start[1];
			const im = drawing.im, o = drawing.orig;
			if (drawing.imgMove) {
				im.x = Math.min(PAGE_W - 20, Math.max(20 - im.w, o.x + dx));
				im.y = Math.min(PAGE_H - 20, Math.max(20 - im.h, o.y + dy));
			} else if (drawing.isText) {
				im.w = Math.max(120, o.w + dx);
			} else {
				const w = Math.max(40, o.w + dx);
				im.w = w; im.h = w * (o.h / o.w);
			}
			drawing.moved = true;
			redrawPage(drawing.pageIdx);
			return;
		}
		if (drawing.erasing) { eraseAt(e); return; }

		let evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
		if (!evs || !evs.length) evs = [e];
		for (const ce of evs) {
			drawing.pts.push(pos(ce, drawing.cv));
			const n = drawing.pts.length;

			const tail = drawing.tool === "marker" ? 2 : 3;
			drawStroke(drawing.ctx, { tool: drawing.tool, color: drawing.color, size: drawing.size, pts: drawing.pts.slice(Math.max(0, n - tail)) });
		}

		const lastP = drawing.pts[drawing.pts.length - 1];
		if (!drawing.holdAnchor || Math.hypot(lastP[0] - drawing.holdAnchor[0], lastP[1] - drawing.holdAnchor[1]) > 6) armHoldSnap(lastP);
	}
	function onUp(e) {
		if (e && e.pointerType === "pen") {
			activePenPointers.delete(e.pointerId);
			lastPenUpAt = Date.now();
			if (!activePenPointers.size) {

				applyTouchAction();
				setTimeout(applyTouchAction, PEN_GRACE_MS + 30);
			}
		}
		if (snapTimer) { clearTimeout(snapTimer); snapTimer = null; }
		const chromeUp = host && host.querySelector(".heft-chrome");
		if (chromeUp) chromeUp.classList.remove("heft-writing");
		if (!drawing) return;
		const pi = drawing.pageIdx;
		const pg = doc.pages[pi];
		if (!pg) { drawing = null; return; }
		if (drawing.lasso) {
			const poly = drawing.pts;

			const hits = poly.length >= 3 ? pg.strokes.filter((s) => strokeOutline(s).some((p) => pointInPolygon(p, poly))) : [];
			lassoSel = hits.length ? { pageIdx: pi, strokes: hits } : null;
			drawing = null; redrawPage(pi); updateChrome(); return;
		}
		if (drawing.lassoMove) {
			if (drawing.dx || drawing.dy) {
				pushUndo({ kind: "lassoMove", strokes: drawing.strokes, dx: drawing.dx, dy: drawing.dy, pageIdx: pi });
				scheduleSave(); renderThumb(pi);
			}
			drawing = null; redrawPage(pi); updateChrome(); return;
		}
		if (drawing.laser) {
			const laserPage = pi;
			const timer = setTimeout(() => { laserTimers.delete(timer); redrawPage(laserPage); }, 900);
			laserTimers.add(timer); drawing = null; return;
		}
		if (drawing.imgMove || drawing.imgResize) {
			const { im, orig, moved } = drawing;
			if (moved && (im.x !== orig.x || im.y !== orig.y || im.w !== orig.w)) {
				pushUndo({ kind: "imgMod", im, pageIdx: pi, prev: orig });
				scheduleSave(); renderThumb(pi);
			}
			drawing = null;
			updateChrome();
			return;
		}
		if (drawing.erasing) {
			if (drawing.removed.length) {
				pushUndo({ kind: "erase", removed: drawing.removed, pageIdx: pi });
				scheduleSave();
				renderThumb(pi);
			}
		} else {

			const stroke = drawing.snapped
				? { tool: "shape", color: drawing.color, size: drawing.size, pts: [drawing.pts[0], drawing.pts[drawing.pts.length - 1]], shape: drawing.snapped }
				: { tool: drawing.tool, color: drawing.color, size: drawing.size, pts: drawing.pts };
			pg.strokes.push(stroke);
			pushUndo({ kind: "add", stroke, pageIdx: pi });
			scheduleSave();

			commitStrokeRender(pi, stroke);
			renderThumb(pi);
			if (drawing.tool === "pen" || drawing.tool === "marker") scheduleHandwritingIndexV2(pi);
		}
		drawing = null;
		updateChrome();
	}

	function applyHistory(fromStack, toStack, isRedo) {
		const a = fromStack.pop(); if (!a || !doc) return;
		const pi = a.pageIdx != null ? a.pageIdx : idx;
		const pg = doc.pages[pi]; if (!pg) return;
		if (a.kind === "lassoMove") { const d = isRedo ? 1 : -1; a.strokes.forEach((s) => translateStroke(s, d * a.dx, d * a.dy)); }
		else if (a.kind === "imgMod") { const cur = { x: a.im.x, y: a.im.y, w: a.im.w, h: a.im.h }; Object.assign(a.im, a.prev); a.prev = cur; }
		else if (a.kind === "txtEdit") { const cur = a.txt.text; a.txt.text = a.prev; a.prev = cur; }
		else {

			const spec = {
				add: ["strokes", [a.stroke], true], erase: ["strokes", a.removed, false], lassoDel: ["strokes", a.strokes, false],
				lassoDup: ["strokes", a.strokes, true],
				imgAdd: ["images", [a.img], true], imgDel: ["images", [a.img], false],
				txtAdd: ["texts", [a.txt], true], txtDel: ["texts", [a.txt], false],
			}[a.kind];
			if (!spec) return;
			const [key, items, addsOnRedo] = spec;
			if (isRedo === addsOnRedo) (pg[key] || (pg[key] = [])).push(...items);
			else {
				pg[key] = (pg[key] || []).filter((o) => !items.includes(o));
				if (sel && items.some((o) => o.id && (sel.imgId === o.id || sel.txtId === o.id))) sel = null;
				if (lassoSel && items.some((o) => lassoSel.strokes.includes(o))) lassoSel = null;
			}
		}
		toStack.push(a);
		refresh(pi);
	}
	function undo() { applyHistory(undoStack, redoStack, false); }
	function redo() { applyHistory(redoStack, undoStack, true); }

	function sizeLine(sz) {
		const h = sz[1] <= 2 ? 1.5 : sz[1] <= 4 ? 3 : 5;
		return '<button type="button" class="heft-size' + (size === sz[1] ? " active" : "") +
			'" data-hesize="' + sz[1] + '" title="Strich: ' + sz[0] + '">' +
			'<i style="height:' + h + 'px"></i></button>';
	}
	function trayStyle() {
		if (!trayPos) return "";
		return ' style="left:' + Math.round(trayPos.x) + 'px;top:' + Math.round(trayPos.y) + 'px;transform:none"';
	}

	let chromeMin = false;
	const icon = (p) => '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
	function toolbarHtml() {
		const writeOn = tool === "pen" || tool === "marker";
		const showWrite = expanded && writeOn;
		const showEraser = expanded && tool === "eraser";

		const svgPen = icon('<path d="M17 3.5a2.6 2.6 0 0 1 3.7 3.7L7.7 20.2 2.5 21.5l1.3-5.2z"/><path d="M14.5 6l3.5 3.5"/>');
		const svgMarker = icon('<path d="M14.5 5.5l4 4L9.5 18.5h-4v-4z"/><path d="M4 21.5h16"/>');
		const svgEraser = icon('<path d="M20 20H9l-4.3-4.3a2 2 0 0 1 0-2.8l8.6-8.6a2 2 0 0 1 2.8 0l4.2 4.2a2 2 0 0 1 0 2.8L13.5 18"/><path d="M8.5 9.5l6 6"/>');
		const svgLasso = icon('<ellipse cx="12" cy="9.5" rx="7.5" ry="5.5" stroke-dasharray="3.2 3"/><path d="M7.5 14.5c-2.2 1.8-.6 4.3 1.5 4.1 2-.2 1.2 2-.8 2.9"/>');
		const svgLaser = icon('<circle cx="12" cy="12" r="2.4"/><path d="M12 4.2v2.2M12 17.6v2.2M4.2 12h2.2M17.6 12h2.2M6.5 6.5l1.6 1.6M15.9 15.9l1.6 1.6M17.5 6.5l-1.6 1.6M8.1 15.9l-1.6 1.6"/>');
		const svgImage = icon('<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4.5 17.5l5-5 3.5 3.5 2.5-2.5 4 4"/>');
		const svgUndo = icon('<path d="M8.5 5L4 9.5 8.5 14"/><path d="M4 9.5h10.5a5 5 0 0 1 0 10H11"/>');
		const svgRedo = icon('<path d="M15.5 5L20 9.5 15.5 14"/><path d="M20 9.5H9.5a5 5 0 0 0 0 10H13"/>');
		const svgHand = icon('<path d="M8.5 11.5V5.2a1.3 1.3 0 0 1 2.6 0V10m0-5.5a1.3 1.3 0 0 1 2.6 0V10m0-3.8a1.3 1.3 0 0 1 2.6 0v6.6c0 3.9-2.5 6.4-5.9 6.4-2.6 0-4.1-1.2-5.3-3.3l-2-3.6c-.5-.9-.2-1.9.7-2.3.8-.4 1.7-.1 2.2.7l1.5 2.3z"/>');
		const svgPages = icon('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.5h16M4 15h16"/>');
		const svgPlus = icon('<path d="M12 5v14M5 12h14"/>');
		const svgSpark = icon('<path d="M12 3.5l1.9 4.9 4.9 1.9-4.9 1.9L12 17.1l-1.9-4.9-4.9-1.9 4.9-1.9z"/>');
		const svgChevDown = icon('<path d="M6 9.5l6 6 6-6"/>');
		const writeIcon = tool === "marker" ? svgMarker : svgPen;

		if (chromeMin) {
			return '<div class="heft-chrome heft-chrome-min" aria-hidden="false">' +
				'<div class="heft-float" role="toolbar" aria-label="Werkzeuge">' +
					'<div class="heft-pill heft-pill-min">' +
						'<button type="button" data-heexpand="1" class="heft-main" title="Werkzeugleiste ausklappen">' +
							writeIcon + '<span class="heft-color-dot" style="background:' + color + '"></span>' +
							'<span class="heft-chev">▾</span></button>' +
					'</div>' +
				'</div>' +
			'</div>';
		}

		let tray = "";
		if (showWrite) {
			tray =
				'<div class="heft-tray" data-hetray="1" role="group" aria-label="Schreib-Optionen"' + trayStyle() + '>' +
					'<button type="button" class="heft-tray-drag" data-hetraydrag="1" title="Optionen verschieben" aria-label="Optionen verschieben">⠿</button>' +
					'<button type="button" data-hetool="pen" class="heft-opt' + (tool === "pen" ? " active" : "") +
						'" title="Stift">' + svgPen + '</button>' +
					'<button type="button" data-hetool="marker" class="heft-opt' + (tool === "marker" ? " active" : "") +
						'" title="Marker">' + svgMarker + '</button>' +
					'<span class="heft-sep" aria-hidden="true"></span>' +
					SIZES.map(sizeLine).join("") +
					'<span class="heft-sep" aria-hidden="true"></span>' +
					COLORS.map((c) => '<button type="button" class="heft-swatch' + (color === c ? " active" : "") +
						'" data-hecolor="' + c + '" style="--sw:' + c + ';background:' + c + '" title="Farbe"></button>').join("") +
					'<span class="heft-sep" aria-hidden="true"></span>' +
					'<button type="button" data-heonlypen="1" class="heft-opt' + (onlyPen ? " active" : "") +
						'" title="' + (onlyPen ? "Nur Stift zeichnet" : "Finger dürfen zeichnen") + '">' +
						(onlyPen ? svgPen : svgHand) + '</button>' +
				'</div>';
		} else if (showEraser) {

			tray =
				'<div class="heft-tray" data-hetray="1" role="group" aria-label="Radierer-Optionen"' + trayStyle() + '>' +
					'<button type="button" class="heft-tray-drag" data-hetraydrag="1" title="Optionen verschieben" aria-label="Optionen verschieben">⠿</button>' +
					[["Klein", 10], ["Mittel", 16], ["Groß", 30]].map((z) => '<button type="button" class="heft-size' + (eraserSize === z[1] ? " active" : "") +
						'" data-heerasersize="' + z[1] + '" title="Radierer: ' + z[0] + '"><i style="height:' + Math.max(2, Math.round(z[1] / 5)) + 'px"></i></button>').join("") +
				'</div>';
		}

		return '<div class="heft-chrome" aria-hidden="false">' +
			'<button type="button" class="heft-corner heft-corner-l' + (pop && pop.dataset.kind === "pages" ? " active" : "") +
				'" data-hepagesmenu="1" title="Seiten">' + svgPages +
				'<span class="heft-pageno-inline">' + (idx + 1) + '/' + doc.pages.length + '</span></button>' +
			'<div class="heft-float" role="toolbar" aria-label="Werkzeuge">' +
				'<div class="heft-pill">' +
					'<button type="button" data-hewrite="1" class="heft-main' + (writeOn ? " active" : "") +
						(showWrite ? " open" : "") + '" title="Schreiben">' +
						writeIcon + '<span class="heft-color-dot" style="background:' + color + '"></span><span class="heft-chev">▾</span></button>' +
					'<button type="button" data-hetool="eraser" class="heft-main' + (tool === "eraser" ? " active" : "") +
						(showEraser ? " open" : "") + '" title="Radierer">' + svgEraser + '</button>' +
					'<span class="heft-sep" aria-hidden="true"></span>' +
					'<button type="button" data-hetool="lasso" class="heft-main' + (tool === "lasso" ? " active" : "") +
						'" title="Lasso — Striche auswählen">' + svgLasso + '</button>' +

					'<button type="button" data-hetool="laser" class="heft-main heft-laser' + (tool === "laser" ? " active" : "") +
						'" title="Laserpointer — nicht speichern">' + svgLaser + '</button>' +
					'<span class="heft-sep" aria-hidden="true"></span>' +
					'<button type="button" data-heimgmenu="1" class="heft-main' +
						((pop && pop.dataset.kind === "img") || tool === "select" ? " active" : "") + '" title="Bilder einfügen oder bearbeiten">' + svgImage + '</button>' +
					'<span class="heft-sep" aria-hidden="true"></span>' +
					'<button type="button" data-heundo="1" class="heft-main" title="Rückgängig"' +
						(undoStack.length ? "" : " disabled") + '>' + svgUndo + '</button>' +
					'<button type="button" data-heredo="1" class="heft-main" title="Wiederholen"' +
						(redoStack.length ? "" : " disabled") + '>' + svgRedo + '</button>' +
					'<span class="heft-sep" aria-hidden="true"></span>' +
					'<button type="button" data-hecollapse="1" class="heft-main heft-min-btn" title="Leiste einklappen — mehr Platz zum Schreiben">' + svgChevDown + '</button>' +
				'</div>' +
			'</div>' +
			tray +
			'<div class="heft-corner-r">' +
				'<button type="button" class="heft-corner heft-chat" data-hechat="1" title="KI-Chat">' + svgSpark + '</button>' +
				'<button type="button" class="heft-corner heft-plus' + (pop && pop.dataset.kind === "plus" ? " active" : "") +
					'" data-heplusmenu="1" title="Seite hinzufügen">' + svgPlus + '</button>' +
			'</div>' +
		'</div>';
	}
	const pagesHtml = () => '<div class="heft-pages">' + doc.pages.map((_, i) =>
		'<div class="heft-page-slot" data-hepage="' + i + '">' +
			'<canvas class="heft-canvas"></canvas>' +
			'<span class="heft-page-label">Seite ' + (i + 1) + '</span>' +
		'</div>').join('') + addPageGhostHtml() + '</div>';
	const viewHtml = () => '<div class="heft-scroll">' + pagesHtml() + '</div>' + toolbarHtml();

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
		try { grip.setPointerCapture(e.pointerId); } catch {  }
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
		try { e.target.releasePointerCapture(e.pointerId); } catch {  }
		trayDrag.tray.classList.remove("is-dragging");
		trayDrag = null;
	}

	function closePop() {
		document.removeEventListener("pointerdown", onDocPointerDown, true);
		if (pop) { pop.remove(); pop = null; }
		exportSel = null;
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
		const picking = !!exportSel;
		const n = picking ? exportSel.size : 0;
		return '<div class="heft-pop-head">' + (picking ? 'Seiten für Export antippen' : 'Seiten') + '</div>' +
			'<div class="heft-pop-grid">' + doc.pages.map((_, i) =>
				'<div class="heft-pop-thumb' + ((picking ? exportSel.has(i) : i === idx) ? ' active' : '') + '" data-hethumb="' + i + '" role="button" tabindex="0" title="Seite ' + (i + 1) + '">' +
					'<canvas width="92" height="130"></canvas>' +
					'<span>' + (i + 1) + (picking && exportSel.has(i) ? ' ✓' : '') + '</span>' +
					(!picking && doc.pages.length > 1 ? '<button type="button" class="heft-pop-del" data-hedelpage="' + i + '" title="Seite löschen">🗑</button>' : '') +
				'</div>').join('') + '</div>' +
			'<div class="heft-pop-sep"></div>' +
			(picking
				? '<button type="button" class="heft-pop-row" data-heexppdf="1"' + (n ? '' : ' disabled') + '>📄 Als PDF exportieren (' + n + ')</button>' +
					'<button type="button" class="heft-pop-row" data-heexpimg="1"' + (n ? '' : ' disabled') + '>🖼 Als Bild(er) exportieren (' + n + ')</button>' +
					'<button type="button" class="heft-pop-row" data-heexpcancel="1">Abbrechen</button>'
				: '<button type="button" class="heft-pop-row" data-heexpstart="1">⬆ Exportieren als PDF oder Bild…</button>' +
					'<button type="button" class="heft-pop-row" data-heverlauf="1">🕘 Verlauf (letzte 24 h)…</button>');
	}

	function paintPopThumbs() {
		if (doc) doc.pages.forEach((_, i) => renderThumb(i));
	}
	function refreshPagesPop() {
		if (!pop || pop.dataset.kind !== "pages" || !doc) return;
		pop.innerHTML = pagesPopHtml();
		paintPopThumbs();
	}
	function imgPopHtml() {
		return '<div class="heft-pop-head">Bilder</div>' +
			'<button type="button" class="heft-pop-row" data-hetool="select">⬚ Bilder & Texte auswählen & bearbeiten</button>' +
			'<div class="heft-pop-sep"></div>' +
			'<button type="button" class="heft-pop-row" data-hetextadd="1">✍️ Text schreiben</button>' +
			'<button type="button" class="heft-pop-row" data-heimgadd="1">🖼 Bild hinzufügen</button>' +
			'<button type="button" class="heft-pop-row" data-heimgcam="1">📷 Bild aufnehmen</button>' +
			'<div class="heft-pop-sub">Ausgewähltes lässt sich verschieben, skalieren oder löschen. Doppeltipp auf eine Text-Box bearbeitet den Text.</div>';
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
			'<div class="heft-pop-head">Vorlage dieser Seite ändern</div>' +
			'<div class="heft-tpl-row">' +
				PAPERS.map((p) => '<button type="button" class="heft-tpl' + (p[0] === curPaper ? ' active' : '') + '" data-hesetpaper="' + p[0] + '">' +
					'<i class="heft-tpl-paper heft-tpl-' + p[0] + '"></i><span>' + p[2] + '</span></button>').join("") +
			'</div>' +
			'<div class="heft-pop-sep"></div>' +
			'<button type="button" class="heft-pop-row" data-headdimg="1">🖼 Bild</button>' +
			'<button type="button" class="heft-pop-row" data-heimport="1">⬳ Importieren</button>' +
			'<button type="button" class="heft-pop-row" data-hescan="1">📷 Dateien scannen</button>';
	}

	function openTextEditor(pi, px, py, txt) {
		closeTextEditor(true);
		const slot = host && host.querySelectorAll(".heft-page-slot")[pi];
		const cvEl = slot && slot.querySelector("canvas");
		const pg = doc && doc.pages[pi];
		if (!cvEl || !pg) return;
		const k = cvEl.getBoundingClientRect().width / PAGE_W;
		const fs = txt && txt.size ? txt.size : 30;
		const w = txt ? txt.w : Math.max(240, Math.min(420, PAGE_W - px - 40));
		const ta = document.createElement("textarea");
		ta.className = "heft-text-editor";
		ta.value = txt ? txt.text : "";
		ta.style.left = ((txt ? txt.x : px) * k + cvEl.offsetLeft) + "px";
		ta.style.top = ((txt ? txt.y : py) * k + cvEl.offsetTop) + "px";
		ta.style.width = Math.max(80, w * k) + "px";
		ta.style.font = "500 " + (fs * k) + "px ui-rounded, 'Segoe Print', sans-serif";
		ta.style.lineHeight = String(TEXT_LH);
		ta.style.color = txt ? (txt.color || "#1c1c1e") : color;
		slot.appendChild(ta);
		inlineEd = { ta, pi, txt, x: px, y: py };
		if (txt) { txt.hidden = true; redrawPage(pi); }
		const fit = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; };
		fit();
		ta.addEventListener("input", fit);
		ta.addEventListener("pointerdown", (ev) => ev.stopPropagation());
		ta.addEventListener("keydown", (ev) => {
			ev.stopPropagation();
			if (ev.key === "Escape") { ev.preventDefault(); closeTextEditor(false); }
			else if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); closeTextEditor(true); }
		});
		ta.addEventListener("blur", () => closeTextEditor(true));
		setTimeout(() => ta.focus(), 40);
	}
	function closeTextEditor(commit) {
		if (!inlineEd) return;
		const { ta, pi, txt, x: px, y: py } = inlineEd;
		inlineEd = null;
		const val = String(ta.value || "");
		ta.remove();
		const pg = doc && doc.pages[pi];
		if (txt) delete txt.hidden;
		if (!pg) return;
		const body = val.replace(/\s+$/, "");
		if (commit && txt && body.trim() && body !== txt.text) {
			pushUndo({ kind: "txtEdit", txt, prev: txt.text, pageIdx: pi });
			txt.text = body; scheduleSave();
		} else if (commit && txt && !body.trim()) {
			pg.texts = textsOf(pg).filter((t2) => t2 !== txt);
			pushUndo({ kind: "txtDel", txt, pageIdx: pi });
			if (sel && sel.txtId === txt.id) sel = null;
			scheduleSave();
		} else if (commit && !txt && body.trim()) {
			const t = { id: U.uid(), text: body, x: px, y: py, w: Math.max(240, Math.min(420, PAGE_W - px - 40)), h: 60, size: 30, color };
			textsOf(pg).push(t);
			pushUndo({ kind: "txtAdd", txt: t, pageIdx: pi });
			sel = { pageIdx: pi, txtId: t.id, tapAt: 0 };
			scheduleSave();
		}
		redrawPage(pi); renderThumb(pi); updateChrome();
	}
	// Kein Neuaufbau, wenn sich nichts geändert hat — vorher wurde die Leiste bei
	// JEDEM Strich komplett ersetzt (Flackern, Icons kurz weg, "springt hin und her").
	let lastChromeHtml = "";
	function updateChrome() {
		if (!host || !doc) return;
		const html = toolbarHtml();
		const chrome = host.querySelector(".heft-chrome");
		if (chrome && html === lastChromeHtml) { updateLassoBar(); refreshPagesPop(); return; }
		lastChromeHtml = html;
		if (chrome) { const t = document.createElement("div"); t.innerHTML = html; chrome.replaceWith(t.firstChild); }
		else host.insertAdjacentHTML("beforeend", html);
		bindTrayDrag();
		updateLassoBar();
		refreshPagesPop();
	}

	function updateLassoBar() {
		if (!host) return;
		let bar = host.querySelector(".heft-lasso-bar");
		if (!lassoSel || !lassoSel.strokes.length) { if (bar) bar.remove(); return; }
		if (!bar) { bar = document.createElement("div"); bar.className = "heft-lasso-bar"; host.appendChild(bar); }
		const n = lassoSel.strokes.length;
		bar.innerHTML = "<span>🪢 " + n + (n === 1 ? " Strich" : " Striche") + " · ziehen verschiebt</span>" +
			'<button type="button" data-helassodup="1">⧉ Duplizieren</button>' +
			'<button type="button" data-helassodel="1">🗑 Löschen</button>' +
			'<button type="button" data-helassoclear="1">Aufheben</button>';
	}
	function duplicateLassoSelection() {
		if (!lassoSel || !doc) return;
		const pg = doc.pages[lassoSel.pageIdx];
		if (!pg) return;

		const copies = lassoSel.strokes.map((s) => {
			const c = JSON.parse(JSON.stringify(s));
			translateStroke(c, 28, 28);
			return c;
		});
		pg.strokes.push(...copies);
		pushUndo({ kind: "lassoDup", strokes: copies, pageIdx: lassoSel.pageIdx });
		lassoSel = { pageIdx: lassoSel.pageIdx, strokes: copies };
		scheduleSave(); redrawPage(lassoSel.pageIdx); renderThumb(lassoSel.pageIdx); updateChrome();
	}
	function deleteLassoSelection() {
		if (!lassoSel || !doc) return;
		const pg = doc.pages[lassoSel.pageIdx];
		if (!pg) { lassoSel = null; updateChrome(); return; }
		const strokes = lassoSel.strokes.slice();
		pg.strokes = pg.strokes.filter((s) => !strokes.includes(s));
		pushUndo({ kind: "lassoDel", strokes, pageIdx: lassoSel.pageIdx });
		const lpi = lassoSel.pageIdx; lassoSel = null;
		refresh(lpi);
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

	// Seite in ein vorhandenes Canvas einpassen (Breite vorgegeben, Höhe folgt A4)
	function paintInto(cv, pg, pi) {
		const k = cv.width / PAGE_W;
		cv.height = Math.round(PAGE_H * k); // setzt die Höhe UND leert das Canvas
		const x = cv.getContext("2d");
		x.setTransform(k, 0, 0, k, 0, 0);
		renderPageTo(x, pg, pi);
	}
	function renderThumb(i) {
		if (!pop || pop.dataset.kind !== "pages" || !doc || !doc.pages[i]) return;
		const cv = pop.querySelectorAll(".heft-pop-thumb canvas")[i];
		if (cv) paintInto(cv, doc.pages[i], i);
	}

	function insertIndex() {
		if (!doc) return 0;
		return insertPos === "before" ? idx : insertPos === "last" ? doc.pages.length : idx + 1;
	}
	function go(i) {
		if (!doc) return;
		idx = Math.max(0, Math.min(doc.pages.length - 1, i));

		drawing = null;
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
		const hasContent = (pg.strokes && pg.strokes.length) || (pg.images && pg.images.length) || (pg.texts && pg.texts.length);
		if (hasContent && !confirm("Diese Heftseite wirklich löschen?")) return;
		doc.pages.splice(i, 1);
		sel = null; undoStack = []; redoStack = [];
		scheduleSave(); rebuildScroll(); go(Math.min(i, doc.pages.length - 1));
	}

	// EIN Datei-Dialog für Bilder, Import und Scanner (vorher 3x fast identisch)
	function filePick({ accept = "image/*", multiple = false, capture = false } = {}, cb) {
		const inp = Object.assign(document.createElement("input"), { type: "file", accept, multiple });
		if (capture) inp.setAttribute("capture", "environment"); // öffnet auf Tablets/Handys direkt die Kamera
		inp.onchange = () => { const files = Array.from(inp.files || []); if (files.length) cb(multiple ? files : files[0]); };
		inp.click();
	}
	const pickImage = (capture, cb) => filePick({ capture }, cb);
	function fileToImageData(f, maxDim, mime = "image/jpeg", quality = 0.86) {

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
					x.fillStyle = "#fff"; x.fillRect(0, 0, w, h);
					x.drawImage(img, 0, 0, w, h);
					resolve({ src: mime === "image/png" ? c.toDataURL("image/png") : c.toDataURL(mime, quality), w, h });
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
			pushUndo({ kind: "imgAdd", img, pageIdx: idx });
			sel = { pageIdx: idx, imgId: img.id };
			tool = "select";
			expanded = false;
			refresh(idx);
		} catch (e) {
			console.warn("Heft: Bild einfügen fehlgeschlagen", e);
			if (U.toast) U.toast("Bild konnte nicht eingefügt werden", "error");
		}
	}
	function imagePage(im, paper, bleed) {

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

	function importFiles() {
		filePick({ accept: "image/*,application/pdf", multiple: true }, async (files) => {
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
		});
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

			const vp = p.getViewport({ scale: 3 });
			const c = document.createElement("canvas");
			c.width = Math.round(vp.width); c.height = Math.round(vp.height);
			await p.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;

			doc.pages.splice(at, 0, imagePage({ src: c.toDataURL("image/jpeg", 0.92), w: c.width, h: c.height }, "blank", true));
			at++;
		}
		return at;
	}

	const { SCAN_MODES, loadImg, quadArea, isConvex, detectQuad, processShot } = SCANCORE;

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
		scanUI = { wrap, stream: null, shots: [], edit: null, busy: false, liveTimer: 0, liveStable: 0, liveMissing: 0, liveHistory: [], autoCapture: false, autoArmed: false, autoCooldown: 0 };
		const ui = scanUI;
		wrap.addEventListener("click", onScanClick);
		try {
			if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("getUserMedia fehlt");

			let stream = null;
			try {
				stream = await navigator.mediaDevices.getUserMedia({
					video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
					audio: false,
				});
			} catch (cameraError) {

				const name = cameraError && cameraError.name;
				if (name !== "OverconstrainedError" && name !== "ConstraintNotSatisfiedError" && name !== "NotFoundError") throw cameraError;
				stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
			}

			if (scanUI !== ui || !wrap.isConnected) { try { stream.getTracks().forEach((t) => t.stop()); } catch {  } return; }
			ui.stream = stream;
			const video = wrap.querySelector("video");
			video.srcObject = stream;
			video.muted = true;
			video.setAttribute("playsinline", "");

			try { await video.play(); } catch (e2) { console.warn("Heft: Video-play blockiert", e2); }
			startLiveQuality(video, ui);
			const track = stream.getVideoTracks && stream.getVideoTracks()[0];
			if (track) {

				try {
					const caps = track.getCapabilities ? track.getCapabilities() : null;
					const advanced = {};
					if (caps && Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) advanced.focusMode = "continuous";
					if (caps && Array.isArray(caps.exposureMode) && caps.exposureMode.includes("continuous")) advanced.exposureMode = "continuous";
					if (Object.keys(advanced).length) await track.applyConstraints({ advanced: [advanced] });
				} catch (constraintError) { console.info("Heft: Kamera-Automatik bleibt auf Gerätestandard", constraintError); }
				track.addEventListener("ended", () => showCameraStopped(ui), { once: true });
			}
			video.addEventListener("error", () => showCameraStopped(ui), { once: true });
		} catch (e) {

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
	function showCameraStopped(owner) {
		if (!owner || scanUI !== owner || !owner.wrap.isConnected) return;
		stopLiveQuality();
		try { if (owner.stream) owner.stream.getTracks().forEach((t) => t.stop()); } catch {  }
		owner.stream = null;
		const stage = owner.wrap.querySelector(".heft-scan-stage");
		if (stage) stage.innerHTML = '<div class="heft-scan-nocam"><p>Kameraverbindung wurde unterbrochen.</p><button type="button" data-hescanpick="1">Fotos auswählen…</button><small>Bereits aufgenommene Scans bleiben erhalten.</small></div>';
		const shut = owner.wrap.querySelector(".heft-scan-shutter");
		if (shut) shut.disabled = true;
		if (U.toast) U.toast("Kamera wurde beendet — du kannst Fotos auswählen.", "error");
	}
	function closeScanner() {
		if (!scanUI) return;
		stopLiveQuality();
		try { if (scanUI.stream) scanUI.stream.getTracks().forEach((t) => t.stop()); } catch {  }
		try { scanUI.wrap.remove(); } catch {  }
		scanUI = null;
	}

	function quadDelta(a, b) {
		if (!a || !b || a.length !== 4 || b.length !== 4) return Infinity;
		let sum = 0;
		for (let i = 0; i < 4; i++) sum += Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]);
		return sum / 4;
	}
	function stabilizeLiveInfo(info, owner) {
		if (!info.found) { owner.liveHistory = []; return info; }
		const last = owner.liveHistory && owner.liveHistory[owner.liveHistory.length - 1];
		const jump = last ? quadDelta(info.quad, last.quad) : 0;

		if (jump > Math.max(info.sw, info.sh) * 0.14) owner.liveHistory = [];
		const entry = { quad: info.quad.map((p) => p.slice()), mean: info.mean, sharp: info.sharp, contrast: info.contrast };
		(owner.liveHistory || (owner.liveHistory = [])).push(entry);
		if (owner.liveHistory.length > 5) owner.liveHistory.shift();
		const hist = owner.liveHistory;
		const median = (values) => { const s = values.slice().sort((a, b) => a - b); return s[(s.length / 2) | 0]; };

		const quad = info.quad.map((_, i) => [median(hist.map((f) => f.quad[i][0])), median(hist.map((f) => f.quad[i][1]))]);
		let spread = 0;
		for (const frame of hist) spread = Math.max(spread, quadDelta(frame.quad, quad));
		return { ...info, quad, jitter: spread, stable: hist.length >= 3 && spread < Math.max(info.sw, info.sh) * 0.035 };
	}
	function liveQualityFrame(video) {

		const sw = 300, sh = Math.max(150, Math.round(video.videoHeight / Math.max(1, video.videoWidth) * sw));
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
		const found = quadArea(quad) < sw * sh * 0.96;
		const area = quadArea(quad) / Math.max(1, sw * sh);
		const margin = found ? Math.min(...quad.map((p) => Math.min(p[0], p[1], sw - 1 - p[0], sh - 1 - p[1]))) : 0;
		return { quad, found, mean, contrast, sharp, area, margin, sw, sh };
	}
	function setLiveGuide(info, video) {
		if (!scanUI) return;
		const stage = scanUI.wrap.querySelector(".heft-scan-stage");
		const guide = scanUI.wrap.querySelector(".heft-scan-guide polygon");
		const label = scanUI.wrap.querySelector("[data-hescanquality]");
		if (!stage || !guide || !label || !video) return;

		const sr = stage.getBoundingClientRect(), vr = video.getBoundingClientRect();
		const left = (vr.left - sr.left) / Math.max(1, sr.width) * 100;
		const top = (vr.top - sr.top) / Math.max(1, sr.height) * 100;
		const width = vr.width / Math.max(1, sr.width) * 100;
		const height = vr.height / Math.max(1, sr.height) * 100;
		const toPct = (p) => (left + p[0] / info.sw * width).toFixed(1) + "," + (top + p[1] / info.sh * height).toFixed(1);
		guide.setAttribute("points", info.quad.map(toPct).join(" "));
		const lightOK = info.mean >= 62 && info.mean <= 235;
		const sharpOK = info.sharp >= 8;
		const contrastOK = info.contrast >= 16;
		const framingOK = info.area >= 0.12 && info.area <= 0.90 && info.margin >= 2;
		const ready = info.found && lightOK && sharpOK && contrastOK && framingOK;
		const stableReady = ready && info.stable;
		guide.parentElement.classList.toggle("ready", stableReady);
		guide.parentElement.classList.toggle("warn", !stableReady);
		if (stableReady) label.textContent = "✓ Dokument stabil erkannt · bereit";
		else if (!info.found) label.textContent = "Blatt vollständig ins Bild legen";
		else if (!framingOK) label.textContent = "Blattrand vollständig sichtbar halten";
		else if (!sharpOK) label.textContent = "Kamera ruhiger halten";
		else if (!lightOK) label.textContent = info.mean < 62 ? "Mehr Licht nötig" : "Zu hell / Spiegelung vermeiden";
		else if (!contrastOK) label.textContent = "Kontrast zu gering";
		else label.textContent = "Dokument wird stabilisiert…";
		return stableReady;
	}
	function startLiveQuality(video, owner) {
		if (!owner || scanUI !== owner) return;
		stopLiveQuality();
		const check = () => {
			if (scanUI !== owner || owner.busy || !video.videoWidth || !video.isConnected) return;
			try {
				const info = stabilizeLiveInfo(liveQualityFrame(video), owner);
				const ready = setLiveGuide(info, video);
				if (!ready) {
					owner.liveStable = 0;

					owner.liveMissing = info.found ? 0 : owner.liveMissing + 1;
					if (owner.liveMissing >= 3) owner.autoArmed = true;
					return;
				}
				owner.liveMissing = 0;
				owner.liveStable++;

				if (owner.autoCapture && owner.autoArmed && owner.liveStable >= 5 && Date.now() > owner.autoCooldown) {
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

			if (scanUI.edit) {
				scanUI.edit.mode = d.hescanmode;
				scanUI.edit.dirty = true;
				scanUI.edit.el.querySelectorAll("[data-hescanmode]").forEach((m) => m.classList.toggle("active", m.dataset.hescanmode === scanUI.edit.mode));
				liveReprocessEdit();
			}
		}
		else if (d.hescanrot) {
			if (scanUI.edit) {
				scanUI.edit.rot = (scanUI.edit.rot + 1) % 4;
				scanUI.edit.dirty = true;
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

		if (!isAuto) { owner.autoArmed = false; owner.liveStable = 0; owner.autoCooldown = Date.now() + 1800; }
		const video = owner.wrap.querySelector("video");
		if (!video) return;

		setScanBusy(true, "Kamera wird vorbereitet…");

		if (!video.videoWidth || !video.videoHeight) {
			try { await video.play(); } catch {  }
			if (scanUI !== owner) return;
			if (!video.videoWidth) {
				setScanBusy(false);
				if (U.toast) U.toast("Kamera startet noch — kurz warten und erneut tippen", "error");
				return;
			}
		}
		setScanBusy(true, "Aufnahme wird aufbereitet…");
		try {

			const cap = 2600, k = Math.min(1, cap / Math.max(video.videoWidth, video.videoHeight));
			const c = document.createElement("canvas");
			c.width = Math.max(2, Math.round(video.videoWidth * k)); c.height = Math.max(2, Math.round(video.videoHeight * k));
			const captureCtx = c.getContext("2d");
			captureCtx.imageSmoothingEnabled = true; captureCtx.imageSmoothingQuality = "high";
			captureCtx.drawImage(video, 0, 0, c.width, c.height);

			await addRawScan(c.toDataURL("image/png"), c.width, c.height, owner);
		} catch (e) {
			console.warn("Heft: Scan fehlgeschlagen", e);
			if (U.toast) U.toast("Scan fehlgeschlagen", "error");
		}
		if (scanUI === owner) setScanBusy(false);
	}

	async function addRawScan(src, w, h, owner) {
		const img = await loadImg(src);

		const iw = img.naturalWidth || w, ih = img.naturalHeight || h;

		const quad = detectQuad(img, iw, ih);
		const sh = { src, w: iw, h: ih, quad, autoCrop: quadArea(quad) < iw * ih * 0.96, mode: "color", rot: 0, out: null, img };
		await processShot(sh);
		if (scanUI !== owner || !sh.out) return;
		owner.shots.push(sh);
		renderShots();
	}
	function renderShots() {
		if (!scanUI) return;
		const strip = scanUI.wrap.querySelector(".heft-scan-shots");
		if (!strip) return;

		strip.innerHTML = scanUI.shots.map((sh, i) => {
			const src = (sh.out && sh.out.dataUrl) || sh.src;
			const quality = sh.out && sh.out.quality;
			const note = !sh.autoCrop ? "Vollbild" : (quality && quality.soft ? "Weich" : (quality && quality.tooDark ? "Dunkel" : (quality && quality.glare ? "Spiegelung" : (quality && quality.flat ? "Kontrast" : ""))));
			return '<button type="button" class="heft-scan-shot" data-hescanedit="' + i + '" title="Scan ' + (i + 1) + ' nachbearbeiten">' +
				'<img src="' + src + '" alt="Scan ' + (i + 1) + '"><span>' + (i + 1) + '</span>' +
				(note ? '<small>' + note + '</small>' : "") + '</button>';
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
		filePick({ multiple: true, capture: true }, async (files) => {
			const owner = scanUI;
			if (!owner) return;
			setScanBusy(true, "Fotos werden aufbereitet…");
			for (const f of files) {
				try {
					const im = await fileToImageData(f, 2400, "image/png");
					if (scanUI !== owner) return;
					await addRawScan(im.src, im.w, im.h, owner);
				} catch (e) {
					console.warn("Heft: Scan-Foto fehlgeschlagen", e);
					if (U.toast) U.toast("Foto konnte nicht gelesen werden", "error");
				}
			}
			if (scanUI === owner) setScanBusy(false);
		});
	}

	let liveSeq = 0, editCommitT = 0;

	function queueCornerReprocess() {
		clearTimeout(editCommitT);
		editCommitT = setTimeout(() => { editCommitT = 0; liveReprocessEdit(true); }, 160);
	}

	function syncShotWithEdit(sh, ed) {
		sh.quad = ed.quad.map((p) => p.slice());
		sh.mode = ed.mode;
		sh.rot = ed.rot;
		sh.autoCrop = quadArea(sh.quad) < sh.w * sh.h * 0.96;
		return { quad: sh.quad.map((p) => p.slice()), mode: sh.mode, rot: sh.rot, commit: false };
	}
	async function liveReprocessEdit(quiet = false) {
		const owner = scanUI;
		const ed = owner && owner.edit;
		if (!ed || !owner) return;
		const sh = owner.shots[ed.i];
		if (!sh) return;

		const snapshot = syncShotWithEdit(sh, ed);
		const seq = ++liveSeq;
		if (!quiet) setScanBusy(true, "Filter wird angewendet…");
		try {
			const out = await processShot(sh, snapshot);

			if (scanUI !== owner || seq !== liveSeq) return;
			sh.out = out;
			renderShots();
			if (owner.edit && owner.edit.el === ed.el) {
				ed.dirty = false;
				if (!ed.cornerMode && sh.out) drawEditResult(sh);
			}
		} catch (e) {
			console.warn("Heft: Live-Aufbereitung fehlgeschlagen", e);
			if (scanUI === owner && U.toast) U.toast("Scan-Aufbereitung fehlgeschlagen", "error");
		} finally {
			if (!quiet && scanUI === owner && seq === liveSeq) setScanBusy(false);
		}
	}

	function fitStageScale(el, contentW, contentH) {
		const stageW = el.clientWidth || window.innerWidth;
		const stageH = el.clientHeight || Math.max(180, window.innerHeight - 170);
		return Math.max(0.02, Math.min((stageW - 24) / contentW, (stageH - 24) / contentH));
	}

	function drawEditResult(sh) {
		const ed = scanUI && scanUI.edit;
		if (!ed || !sh.out) return;
		const stage = ed.el.querySelector(".heft-scan-editstage");
		const cv = ed.el.querySelector("canvas");
		if (!stage || !cv) return;
		const img = new Image();
		img.onload = () => {
			if (!scanUI || !scanUI.edit || scanUI.edit.el !== ed.el) return;

			const k = fitStageScale(stage, img.naturalWidth, img.naturalHeight);
			cv.width = Math.max(1, Math.round(img.naturalWidth * k));
			cv.height = Math.max(1, Math.round(img.naturalHeight * k));
			const x = cv.getContext("2d");
			x.clearRect(0, 0, cv.width, cv.height);
			if (ed.compare && ed.img) {
				const half = cv.width / 2;

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

		scanUI.edit = { i, el: ed, quad: (sh.quad || []).map((p) => p.slice()), mode: sh.mode || "color", rot: sh.rot || 0, img: null, drag: -1, k: 1, cornerMode: false, compare: false, dirty: false };
		const cv = ed.querySelector("canvas");
		cv.addEventListener("pointerdown", onEditDown);
		cv.addEventListener("pointermove", onEditMove);
		cv.addEventListener("pointerup", onEditUp);
		cv.addEventListener("pointercancel", onEditUp);

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
		ed.k = fitStageScale(stage, sh.w, sh.h);
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

		x.save();
		x.fillStyle = "rgba(3,5,10,0.55)";
		x.beginPath();
		x.rect(0, 0, cv.width, cv.height);
		x.moveTo(q[0][0] * k, q[0][1] * k);
		for (let i = 3; i >= 1; i--) x.lineTo(q[i][0] * k, q[i][1] * k);
		x.closePath();
		x.fill("evenodd");
		x.restore();

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

		const sx = cv.width / Math.max(1, r.width);
		const sy = cv.height / Math.max(1, r.height);
		const k = (scanUI.edit && scanUI.edit.k) || 1;
		return [((e.clientX - r.left) * sx) / k, ((e.clientY - r.top) * sy) / k];
	}
	function onEditDown(e) {
		const ed = scanUI && scanUI.edit;
		if (!ed || !ed.img) return;

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

		if (!sh || quadArea(ed.quad) < sh.w * sh.h * 0.015 || !isConvex(ed.quad)) {
			ed.quad = sh && sh.quad ? sh.quad.map((p) => p.slice()) : ed.quad;
			drawEdit();
			if (U.toast) U.toast("Ecken dürfen sich nicht kreuzen und müssen ausreichend Abstand haben.", "error");
			return;
		}

		ed.dirty = true;
		queueCornerReprocess();
	}
	async function finishEdit() {

		const owner = scanUI;
		const ed = owner && owner.edit;
		if (!ed || !owner) return;
		const sh = owner.shots[ed.i];
		if (sh) {
			const snapshot = syncShotWithEdit(sh, ed);

			clearTimeout(editCommitT); editCommitT = 0;
			if (!sh.out || ed.dirty) {

				const seq = ++liveSeq;
				setScanBusy(true, "Scan wird aufbereitet…");
				try {
					const out = await processShot(sh, snapshot);
					if (scanUI === owner && seq === liveSeq) { sh.out = out; ed.dirty = false; }
				} catch (e2) { console.warn("Heft: Scan aufbereiten fehlgeschlagen", e2); }
				if (scanUI === owner) setScanBusy(false);
			}
		}
		if (scanUI !== owner) return;
		closeEdit();
		renderShots();
	}

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

	// ---- Heft-Export (Seiten-Menü + Teilen-Menü): Seiten als PDF oder PNG ----
	// DRY: nutzt renderPageCanvas fürs Zeichnen und buildPdf aus dem Scanner.
	async function loadDocFor(pageId) {
		const d = pageId === pid && doc ? doc : await load(pageId);
		if (!d) return null;
		// Bilder vorab dekodieren, sonst fehlen sie auf frisch geladenen Canvases
		const jobs = [];
		d.pages.forEach((pg) => (pg.images || []).forEach((im) => { const el = imgEl(im); if (el.decode) jobs.push(el.decode().catch(() => {})); }));
		await Promise.all(jobs);
		return d;
	}
	const exportName = (pageId) => (String((S.pages[pageId] && S.pages[pageId].title) || "Heft").replace(/[\\/:*?"<>|#]/g, "_").trim().slice(0, 80) || "Heft");
	const exportIdxs = (d, indices) => (indices && indices.length ? indices : d.pages.map((_, i) => i));
	// FIX unscharfe Exporte: vorher 1600px Breite (~190 dpi auf A4) — jetzt 300 dpi.
	const EXPORT_W = 2480;
	const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
	async function exportPdf(pageId, indices) {
		const d = await loadDocFor(pageId);
		if (!d) return;
		const idxs = exportIdxs(d, indices);
		const shots = [];
		for (const i of idxs) {
			const c = renderPageCanvas(d.pages[i], EXPORT_W);
			shots.push({ dataUrl: c.toDataURL("image/jpeg", 0.95), w: c.width, h: c.height });
			await nextFrame(); // 300-dpi-Seiten sind teuer — UI zwischen den Seiten atmen lassen
		}
		U.downloadBlob(exportName(pageId) + ".pdf", new Blob([buildPdf(shots)], { type: "application/pdf" }));
		if (U.toast) U.toast("PDF mit " + idxs.length + " Seite(n) gespeichert");
	}
	async function exportImages(pageId, indices) {
		const d = await loadDocFor(pageId);
		if (!d) return;
		const idxs = exportIdxs(d, indices);
		for (let n = 0; n < idxs.length; n++) {
			const i = idxs[n];
			const c = renderPageCanvas(d.pages[i], EXPORT_W);
			U.downloadBlob(exportName(pageId) + "-seite-" + (i + 1) + ".png", new Blob([dataUrlBytes(c.toDataURL("image/png"))], { type: "image/png" }));
			// FIX "Fehlermeldung nach dem Export": mehrere Downloads im selben Tick werden
			// vom Browser geblockt — der zweite Aufruf warf, der catch meldete "Export
			// fehlgeschlagen", obwohl die erste Datei längst gespeichert war. Jetzt gestaffelt.
			if (n < idxs.length - 1) await new Promise((r) => setTimeout(r, 350));
		}
		if (U.toast) U.toast(idxs.length + " Bild(er) gespeichert");
	}
	function exportSelected(kind) {
		if (!pid || !exportSel || !exportSel.size) return;
		const idxs = [...exportSel].sort((a, b) => a - b);
		closePop();
		(kind === "pdf" ? exportPdf(pid, idxs) : exportImages(pid, idxs)).catch((e) => {
			console.warn("Heft: Export fehlgeschlagen", e);
			// Echte Ursache anzeigen statt pauschal "fehlgeschlagen" — sonst ist der
			// nächste Bug-Report wieder nur "kommt immer eine fehlermeldung".
			if (U.toast) U.toast("Export fehlgeschlagen: " + ((e && e.message) || e), "error");
		});
	}

	const readyScanOuts = () => scanUI.shots.map((sh) => sh.out).filter((o) => o && o.dataUrl && o.w && o.h);
	function scanFinishPdf() {
		try {
			const outs = readyScanOuts();
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
		const outs = readyScanOuts();
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

	function onHostClick(e) {
		const b = e.target.closest("button, .heft-pop-thumb");
		if (!b || !doc) return;
		const d = b.dataset;
		if (d.helassodup) { duplicateLassoSelection(); return; }
		if (d.helassodel) { deleteLassoSelection(); return; }
		if (d.helassoclear) { const lpi = lassoSel && lassoSel.pageIdx; lassoSel = null; if (lpi != null) redrawPage(lpi); updateChrome(); return; }
		if (suppressEraserClick && d.hetool === "eraser") return;
		if (d.hepagesmenu) { togglePop("pages", b); return; }
		if (d.heplusmenu) { togglePop("plus", b); return; }
		if (d.heimgmenu) { togglePop("img", b); return; }
		if (d.heexpstart) { exportSel = new Set(doc.pages.map((_, i) => i)); refreshPagesPop(); return; }
		if (d.heexpcancel) { exportSel = null; refreshPagesPop(); return; }
		if (d.heexppdf) { exportSelected("pdf"); return; }
		if (d.heexpimg) { exportSelected("img"); return; }
		if (d.heverlauf) { openVerlaufPop(); return; }
		if (d.hepagesback) { if (pop) { pop.dataset.kind = "pages"; pop.innerHTML = pagesPopHtml(); paintPopThumbs(); } return; }
		if (d.heverrestore != null) {
			const s = pop && pop.__verSnaps && pop.__verSnaps[Number(d.heverrestore)];
			if (!s) return;
			if (!confirm("Diesen Stand wiederherstellen? Der aktuelle Stand wird vorher im Verlauf gesichert.")) return;
			closePop();
			restoreSnapshot(pid, s.key).catch((e2) => {
				console.warn("Heft: Wiederherstellen fehlgeschlagen", e2);
				if (U.toast) U.toast("Wiederherstellen fehlgeschlagen: " + ((e2 && e2.message) || e2), "error");
			});
			return;
		}
		if (d.hedelpage != null) { e.stopPropagation(); deletePageAt(Number(d.hedelpage)); return; }
		if (d.hethumb != null) {
			const ti = Number(d.hethumb);
			if (exportSel) { exportSel.has(ti) ? exportSel.delete(ti) : exportSel.add(ti); refreshPagesPop(); }
			else go(ti);
			return;
		}
		if (d.hepos) {
			insertPos = d.hepos;
			if (pop) pop.querySelectorAll(".heft-seg").forEach((s) => s.classList.toggle("active", s.dataset.hepos === insertPos));
			return;
		}
		if (d.headdtpl) { closePop(); addPageAt(d.headdtpl); return; }
		if (d.headdend) { addPageAtEnd(); return; }
		if (d.headdimg) { closePop(); pickImage(false, addImagePageFromFile); return; }
		if (d.heimport) { closePop(); importFiles(); return; }
		if (d.hescan) { closePop(); openScanner(); return; }
		if (d.hetextadd) { closePop(); tool = "select"; expanded = false; openTextEditor(idx, 80, Math.min(contentBottom(page()) + 30, PAGE_H - 160), null); return; }
		if (d.heimgadd) { closePop(); pickImage(false, insertImageFile); return; }
		if (d.heimgcam) { closePop(); pickImage(true, insertImageFile); return; }
		if (d.hewrite) {

			if (tool === "pen" || tool === "marker") expanded = !expanded;
			else { tool = "pen"; expanded = true; }
			if (sel) { const spi = sel.pageIdx; sel = null; redrawPage(spi); }
		}
		else if (d.hetool) {
			if (d.hetool === "eraser") {
				if (tool === "eraser") expanded = !expanded;
				else { tool = "eraser"; expanded = true; }
			} else if (d.hetool === "pen" || d.hetool === "marker") {

				tool = d.hetool; expanded = true;
			} else {

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
		else if (d.heerasersize) eraserSize = parseFloat(d.heerasersize);
		else if (d.heundo) { undo(); return; }
		else if (d.heredo) { redo(); return; }
		else if (d.hecollapse) { chromeMin = true; updateChrome(); return; }
		else if (d.heexpand) { chromeMin = false; updateChrome(); return; }
		else if (d.heonlypen) { onlyPen = !onlyPen; applyTouchAction(); }
		else if (d.hesetpaper) {
			const pg = page(); if (!pg) return;
			pg.paper = d.hesetpaper;
			closePop();
			redrawPage(idx); scheduleSave(); renderThumb(idx);
		}
		else if (d.hechat) {

			document.body.classList.remove("panel-collapsed");
			try { if (window.RENDER && window.RENDER.renderTabs) window.RENDER.renderTabs(); } catch {  }
			return;
		}
		else return;
		saveToolPrefs();
		updateChrome();
	}
	function onKey(e) {
		const t = e.target;
		if (t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;

		if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z" || e.key === "y")) {
			e.preventDefault();
			if (e.key === "y" || e.shiftKey) redo(); else undo();
			return;
		}
		if (e.key === "Escape") {
			if (scanUI && scanUI.edit) { e.preventDefault(); closeEdit(); }
			else if (scanUI) { e.preventDefault(); closeScanner(); }
			else if (pop) { e.preventDefault(); closePop(); }
			return;
		}
		if ((e.key === "Delete" || e.key === "Backspace") && lassoSel && doc) {
			e.preventDefault();
			deleteLassoSelection();
			return;
		}
		if ((e.key === "Delete" || e.key === "Backspace") && sel && doc) {

			const pg = doc.pages[sel.pageIdx];
			const im = pg && sel.imgId ? imagesOf(pg).find((i2) => i2.id === sel.imgId) : null;
			const tx = pg && sel.txtId ? textsOf(pg).find((t2) => t2.id === sel.txtId) : null;
			if (im || tx) {
				e.preventDefault();
				if (im) { pg.images = pg.images.filter((i2) => i2 !== im); undoStack.push({ kind: "imgDel", img: im, pageIdx: sel.pageIdx }); }
				else { pg.texts = textsOf(pg).filter((t2) => t2 !== tx); undoStack.push({ kind: "txtDel", txt: tx, pageIdx: sel.pageIdx }); }
				redoStack = [];
				const spi = sel.pageIdx; sel = null;
				refresh(spi);
			}
			return;
		}
	}

	function onScroll() {
		if (!host || !doc) return;

		if (!scrollRenderFrame) scrollRenderFrame = requestAnimationFrame(() => {
			scrollRenderFrame = 0;
			renderVisiblePages(true);
		});
		clearTimeout(scrollSettleTimer);
		scrollSettleTimer = setTimeout(() => { scrollSettleTimer = 0; renderVisiblePages(); }, 120);
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

		canvases = host ? [...host.querySelectorAll(".heft-canvas")] : [];
		pageSlots = canvases.map((cv) => cv.closest(".heft-page-slot"));

		detailCanvases = pageSlots.map((slot) => {
			if (!slot) return null;
			if (getComputedStyle(slot).position === "static") slot.style.position = "relative";
			const d = document.createElement("canvas");
			d.className = "heft-detail-canvas";
			Object.assign(d.style, { position: "absolute", pointerEvents: "none", zIndex: "2", display: "none" });
			slot.appendChild(d);
			return d;
		});

		wetCanvases = pageSlots.map((slot) => {
			if (!slot) return null;
			const d = document.createElement("canvas");
			d.className = "heft-wet-canvas";
			Object.assign(d.style, { position: "absolute", pointerEvents: "none", zIndex: "3", display: "none" });
			slot.appendChild(d);
			return d;
		});
		canvases.forEach((cv) => {
			cv.addEventListener("pointerdown", onDown);
			cv.addEventListener("pointermove", onMove);
			cv.addEventListener("pointerup", onUp);
			cv.addEventListener("pointercancel", onUp);

			cv.addEventListener("pointerover", onPenBoundary);
			cv.addEventListener("pointerout", onPenBoundary);
		});

		applyTouchAction();
	}
	function bindScroll() {
		const scroll = host.querySelector(".heft-scroll");
		if (!scroll) return;
		scrollFn = onScroll;
		scroll.addEventListener("scroll", scrollFn, { passive: true });

		scroll.addEventListener("wheel", onWheelZoom, { passive: false });

		scroll.addEventListener("touchstart", onTouchStart, { passive: false });
		scroll.addEventListener("touchmove", onTouchMove, { passive: false });
		scroll.addEventListener("touchend", onTouchEnd);
		scroll.addEventListener("touchcancel", onTouchCancel);
		scroll.style.overscrollBehavior = "contain";
	}

	const addPageGhostHtml = () => '<button type="button" class="heft-addpage" data-headdend="1">＋ Neue Seite</button>';
	let pull = null;
	function addPageAtEnd() {
		const prevPos = insertPos;
		insertPos = "last";
		addPageAt(doc && doc.pages.length ? doc.pages[doc.pages.length - 1].paper : "lined");
		insertPos = prevPos;
	}
	function bindPullToAdd() {
		const scroll = scrollEl();
		if (!scroll || scroll.dataset.hepull) return;
		scroll.dataset.hepull = "1";
		const atEnd = () => scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 4;
		scroll.addEventListener("touchstart", (ev) => { pull = { y0: ev.touches[0].clientY, startAtEnd: atEnd(), armed: false }; }, { passive: true });
		scroll.addEventListener("touchmove", (ev) => {
			if (!pull || !pull.startAtEnd) return;
			const dy = pull.y0 - ev.touches[0].clientY;
			const btn = scroll.querySelector(".heft-addpage");
			if (atEnd() && dy > 70) { pull.armed = true; if (btn) { btn.classList.add("armed"); btn.textContent = "⬆ Loslassen: neue Seite"; } }
			else if (pull.armed) { pull.armed = false; if (btn) { btn.classList.remove("armed"); btn.textContent = "＋ Neue Seite"; } }
		}, { passive: true });
		scroll.addEventListener("touchend", () => {
			if (pull && pull.armed) addPageAtEnd();
			pull = null;
		});
	}
	function rebuildScroll() {
		if (!host || !doc) return;
		const scroll = host.querySelector(".heft-scroll");
		if (!scroll) return;
		const keep = scroll.scrollTop;
		scroll.innerHTML = pagesHtml();
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
		if (pid !== pageId) return;
		idx = 0; sel = null; undoStack = []; redoStack = []; insertPos = "after";
		zoom = 1; navReset();
		expanded = false;

		trayPos = null; trayDrag = null;
		host.innerHTML = viewHtml();
		bindPullToAdd();
		host.addEventListener("click", onHostClick);
		host.addEventListener("pointerdown", onHostPointerDown);
		host.addEventListener("pointerup", onHostPointerUp);
		host.addEventListener("pointercancel", onHostPointerUp);
		document.addEventListener("keydown", onKey);
		resizeFn = () => layout();
		window.addEventListener("resize", resizeFn);

		if (window.ResizeObserver) {
			resizeObserver = new ResizeObserver(() => layout());
			resizeObserver.observe(host);
		}
		bindCanvas();
		bindScroll();
		bindTrayDrag();
		layout();

		scheduleHandwritingIndexV2(idx);
		purgeOrphanLegacyInk();
		pruneSnapshots(pageId).catch(() => {}); // abgelaufene Verlauf-Snapshots beim Öffnen wegräumen
	}
	function unmount(discardPending = false) {
		closePop();
		closeScanner();

		if (saveT) {
			if (discardPending) { clearTimeout(saveT); saveT = 0; }
			else saveNow();
		}
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
		if (pid) {
			const closedPid = pid;
			Object.keys(thumbs).forEach((k) => { if (k.startsWith(closedPid + ":")) delete thumbs[k]; });
		}
		Object.keys(imgCache).forEach((k) => { imgCache[k].src = ""; delete imgCache[k]; });
		host = null; pid = null; doc = null; idx = 0; canvases = []; pageSlots = []; detailCanvases = []; wetCanvases = [];
		drawing = null; sel = null; lassoSel = null; undoStack = []; redoStack = [];
		laserTimers.forEach(clearTimeout); laserTimers.clear();
		clearTimeout(holdTimer); ocrQueueV2.clear(); clearTimeout(ocrTimerV2); ocrTimerV2 = 0; holdTool = null; suppressEraserClick = false;

		navReset(); activePenPointers.clear(); clearTimeout(wheelCommitT); clearTimeout(visibleRenderTimer); visibleRenderTimer = 0; clearTimeout(scrollSettleTimer); scrollSettleTimer = 0;
		if (eraseFrame) { cancelAnimationFrame(eraseFrame); eraseFrame = 0; }
		trayDrag = null;
	}

	function renderPageCanvas(pg, w, pageIdx = -1) {
		const c = document.createElement("canvas");
		c.width = w;
		paintInto(c, pg, pageIdx);
		return c;
	}
	async function thumbnail(pageId, pageIndex, width) {
		const i = pageIndex || 0, w = width || 220;
		const key = pageId + ":" + i + ":" + w;
		if (thumbs[key]) return thumbs[key];

		if (thumbJobs[key]) return thumbJobs[key];
		const job = (async () => {
			const d = await load(pageId);
			const pg = d.pages[i];
			if (!pg) return null;
			const c = renderPageCanvas(pg, w);
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

	async function pageAsDataUrl(pageId, pageIdx, w = 1200) {
		if (!pageId) return null;
		const d = pageId === pid && doc ? doc : await load(pageId);
		const pg = d && d.pages && d.pages[pageIdx || 0];
		if (!pg) return null;
		return renderPageCanvas(pg, w).toDataURL("image/png");
	}

	return {
		mount, unmount, saveNow, addText, hasHeft, pagesOf, thumbnail, hydrateEmbeds, renderBlobPreview, findDivergentPage, pageAsDataUrl, exportPdf, exportImages,
		get activeId() { return pid; },
		get activeIndex() { return idx; },
	};
})();