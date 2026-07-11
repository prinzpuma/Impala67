"use strict";
import { S } from "./state.js";
// ink.js — GoodNotes-Ebene (v1): Handschrift & Skizzen pro Seite mit Apple-Pencil-
// Support. Selbstständiges Modul nach dem extras.js-Muster: eigener Style-Block,
// eigener Floating-Button, KEINE Änderungen an render.js/app.js nötig.
//
// - Öffnen: ✏️-Button unten rechts in der Seitenansicht (blauer Punkt = Seite hat Tinte)
// - Striche als VEKTOREN in logischen A4-Koordinaten (1000×1414) — geräteunabhängig,
//   verlustfrei bei Rotation/Resize; Speicherung pro Seite: impala67.ink.<pageId>
// - Apple Pencil: Druckstärke (e.pressure) steuert die Strichbreite, Coalesced
//   Events für glatte Linien, automatische Palm Rejection (sobald ein Stift erkannt
//   wurde, zeichnen Finger nicht mehr — umschaltbar über den ✋/✏️-Button)
// - Werkzeuge: Stift, Marker (transparent, konstante Breite), strichweiser Radierer,
//   5 Farben, 3 Breiten, Undo/Redo (auch Cmd/Strg+Z), PNG-Export, Esc = schließen
export const INK = (() => {
	const PAGE_W = 1000, PAGE_H = 1414; // logisches A4-Blatt
	const KEY = (pid) => "impala67.ink." + pid;
	const COLORS = ["#1a1a1a", "#2f6fed", "#e0483e", "#1f9d55", "#f5b800"];
	const SIZES = [["S", 2], ["M", 3.5], ["L", 6]];

	let overlay = null, canvas = null, ctx = null, scale = 1;
	let pageId = null, strokes = [], undoStack = [], redoStack = [];
	let tool = "pen", color = COLORS[0], size = 3.5, onlyPen = true, penSeen = false;
	let drawing = null, saveTimer = 0, resizeHandler = null;

	// ---------- Persistenz ----------
	function loadStrokes(pid) {
		try {
			const d = JSON.parse(localStorage.getItem(KEY(pid)) || "null");
			return d && Array.isArray(d.strokes) ? d.strokes : [];
		} catch { return []; }
	}
	function saveNow() {
		clearTimeout(saveTimer);
		if (!pageId) return;
		try {
			if (strokes.length) localStorage.setItem(KEY(pageId), JSON.stringify({ v: 1, w: PAGE_W, h: PAGE_H, strokes }));
			else localStorage.removeItem(KEY(pageId));
		} catch (e) { console.warn("Ink: Speichern fehlgeschlagen", e); }
	}
	function scheduleSave() {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(saveNow, 250);
	}
	function hasInk(pid) {
		try { return !!localStorage.getItem(KEY(pid)); } catch { return false; }
	}

	// ---------- Zeichnen ----------
	const segW = (base, p) => Math.max(0.5, base * (0.4 + (p == null ? 0.5 : p) * 1.2));
	function drawStrokeOn(x, s) {
		const pts = s.pts;
		if (!pts.length) return;
		x.save();
		x.lineCap = "round";
		x.lineJoin = "round";
		x.strokeStyle = s.color;
		if (s.tool === "marker") {
			// Marker: EIN Pfad mit konstanter Breite — segmentweises Zeichnen würde an
			// den Übergängen dunkle Alpha-Flecken erzeugen.
			x.globalAlpha = 0.35;
			x.lineWidth = s.size * 2.4;
			x.beginPath();
			x.moveTo(pts[0][0], pts[0][1]);
			for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]);
			x.stroke();
		} else if (pts.length === 1) {
			x.beginPath();
			x.fillStyle = s.color;
			x.arc(pts[0][0], pts[0][1], segW(s.size, pts[0][2]) / 2, 0, Math.PI * 2);
			x.fill();
		} else {
			// Stift: Druckstärke je Segment (Apple Pencil)
			for (let i = 1; i < pts.length; i++) {
				x.beginPath();
				x.lineWidth = segW(s.size, pts[i][2]);
				x.moveTo(pts[i - 1][0], pts[i - 1][1]);
				x.lineTo(pts[i][0], pts[i][1]);
				x.stroke();
			}
		}
		x.restore();
	}
	function applyTransform() {
		const dpr = window.devicePixelRatio || 1;
		ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
	}
	function redraw() {
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		applyTransform();
		strokes.forEach((s) => drawStrokeOn(ctx, s));
	}
	function layout() {
		const stage = overlay.querySelector(".ink-stage");
		const availW = stage.clientWidth - 20, availH = stage.clientHeight - 20;
		scale = Math.max(0.1, Math.min(availW / PAGE_W, availH / PAGE_H));
		const dpr = window.devicePixelRatio || 1;
		canvas.style.width = Math.round(PAGE_W * scale) + "px";
		canvas.style.height = Math.round(PAGE_H * scale) + "px";
		canvas.width = Math.round(PAGE_W * scale * dpr);
		canvas.height = Math.round(PAGE_H * scale * dpr);
		redraw();
	}

	// ---------- Pointer: Apple Pencil / Maus / Finger ----------
	const pos = (e) => {
		const r = canvas.getBoundingClientRect();
		return [
			Math.round((e.clientX - r.left) / scale * 10) / 10,
			Math.round((e.clientY - r.top) / scale * 10) / 10,
			Math.round((e.pressure || 0.5) * 100) / 100,
		];
	};
	// Palm Rejection: sobald einmal ein Stift gesehen wurde, zeichnen Finger nicht mehr
	const rejected = (e) => e.pointerType === "touch" && (onlyPen || penSeen);
	function eraseAt(e) {
		const p0 = pos(e);
		const r = 14; // Radius in logischen Einheiten
		const keep = [], removed = [];
		outer: for (const s of strokes) {
			for (const p of s.pts) {
				const dx = p[0] - p0[0], dy = p[1] - p0[1];
				if (dx * dx + dy * dy <= r * r) { removed.push(s); continue outer; }
			}
			keep.push(s);
		}
		if (removed.length) {
			strokes = keep;
			drawing.removed.push(...removed);
			redraw();
		}
	}
	function onDown(e) {
		if (e.pointerType === "pen") penSeen = true;
		if (rejected(e)) return;
		e.preventDefault();
		canvas.setPointerCapture(e.pointerId);
		if (tool === "eraser") {
			drawing = { erasing: true, removed: [] };
			eraseAt(e);
		} else {
			drawing = { tool, color, size, pts: [pos(e)] };
			applyTransform();
		}
	}
	function onMove(e) {
		if (!drawing || rejected(e)) return;
		e.preventDefault();
		if (drawing.erasing) { eraseAt(e); return; }
		// Coalesced Events: iPadOS liefert Pencil-Punkte mit 240 Hz — ohne sie wirken
		// schnelle Striche eckig.
		const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
		for (const ce of evs) {
			drawing.pts.push(pos(ce));
			const n = drawing.pts.length;
			drawStrokeOn(ctx, { tool: drawing.tool, color: drawing.color, size: drawing.size, pts: drawing.pts.slice(n - 2) });
		}
	}
	function onUp() {
		if (!drawing) return;
		if (drawing.erasing) {
			if (drawing.removed.length) {
				undoStack.push({ kind: "erase", removed: drawing.removed });
				redoStack = [];
				scheduleSave();
			}
		} else {
			strokes.push(drawing);
			undoStack.push({ kind: "add", stroke: drawing });
			redoStack = [];
			scheduleSave();
			redraw(); // glättet Marker-Segmentnähte des Live-Zeichnens
		}
		drawing = null;
		updateToolbar();
	}

	// ---------- Undo / Redo ----------
	function undo() {
		const a = undoStack.pop();
		if (!a) return;
		if (a.kind === "add") strokes = strokes.filter((s) => s !== a.stroke);
		else strokes.push(...a.removed);
		redoStack.push(a);
		redraw(); scheduleSave(); updateToolbar();
	}
	function redo() {
		const a = redoStack.pop();
		if (!a) return;
		if (a.kind === "add") strokes.push(a.stroke);
		else strokes = strokes.filter((s) => !a.removed.includes(s));
		undoStack.push(a);
		redraw(); scheduleSave(); updateToolbar();
	}

	// ---------- Toolbar ----------
	function toolbarHtml() {
		const tb = (attr, val, label, title, active) =>
			'<button type="button" data-' + attr + '="' + val + '" class="' + (active ? "active" : "") + '" title="' + title + '">' + label + "</button>";
		return '<div class="ink-toolbar">' +
			tb("inktool", "pen", "✒️", "Stift (Druckstärke)", tool === "pen") +
			tb("inktool", "marker", "🖍", "Marker", tool === "marker") +
			tb("inktool", "eraser", "◻️", "Radierer (strichweise)", tool === "eraser") +
			'<span class="ink-sep"></span>' +
			COLORS.map((c) => '<button type="button" class="ink-swatch' + (color === c ? " active" : "") + '" data-inkcolor="' + c + '" style="background:' + c + '" title="Farbe"></button>').join("") +
			'<span class="ink-sep"></span>' +
			SIZES.map((sz) => tb("inksize", sz[1], sz[0], "Strichbreite " + sz[0], size === sz[1])).join("") +
			'<span class="ink-sep"></span>' +
			'<button type="button" data-inkundo="1" title="Rückgängig (Strg/Cmd+Z)" ' + (undoStack.length ? "" : "disabled") + ">↺</button>" +
			'<button type="button" data-inkredo="1" title="Wiederholen" ' + (redoStack.length ? "" : "disabled") + ">↻</button>" +
			tb("inkonlypen", "1", onlyPen ? "✏️" : "✋", onlyPen ? "Nur Stift zeichnet (Palm Rejection an)" : "Finger dürfen zeichnen", onlyPen) +
			'<span class="ink-spacer"></span>' +
			'<button type="button" data-inkexport="1" title="Als PNG exportieren">⬇ PNG</button>' +
			'<button type="button" data-inkclear="1" title="Blatt leeren">🗑</button>' +
			'<button type="button" class="primary" data-inkclose="1">Fertig</button>' +
		"</div>";
	}
	function updateToolbar() {
		if (!overlay) return;
		const old = overlay.querySelector(".ink-toolbar");
		if (!old) return;
		const tmp = document.createElement("div");
		tmp.innerHTML = toolbarHtml();
		old.replaceWith(tmp.firstChild);
	}
	function onToolbarClick(e) {
		const b = e.target.closest("button");
		if (!b) return;
		if (b.dataset.inktool) tool = b.dataset.inktool;
		else if (b.dataset.inkcolor) { color = b.dataset.inkcolor; if (tool === "eraser") tool = "pen"; }
		else if (b.dataset.inksize) size = parseFloat(b.dataset.inksize);
		else if (b.dataset.inkundo) { undo(); return; }
		else if (b.dataset.inkredo) { redo(); return; }
		else if (b.dataset.inkonlypen) { onlyPen = !onlyPen; if (!onlyPen) penSeen = false; }
		else if (b.dataset.inkexport) { exportPng(); return; }
		else if (b.dataset.inkclear) {
			if (strokes.length && confirm("Blatt wirklich leeren?")) {
				undoStack.push({ kind: "erase", removed: strokes });
				strokes = [];
				redoStack = [];
				redraw();
				scheduleSave();
			}
		}
		else if (b.dataset.inkclose) { close(); return; }
		else return;
		updateToolbar();
	}

	// ---------- Export ----------
	function exportPng() {
		const k = 2;
		const c = document.createElement("canvas");
		c.width = PAGE_W * k;
		c.height = PAGE_H * k;
		const x = c.getContext("2d");
		x.fillStyle = "#ffffff";
		x.fillRect(0, 0, c.width, c.height);
		x.setTransform(k, 0, 0, k, 0, 0);
		strokes.forEach((s) => drawStrokeOn(x, s));
		const a = document.createElement("a");
		const pg = S.pages[pageId];
		a.download = ((pg && pg.title) || "Skizze") + ".png";
		a.href = c.toDataURL("image/png");
		a.click();
	}

	// ---------- Öffnen / Schließen ----------
	function onKey(e) {
		if (e.key === "Escape") close();
		else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
			e.preventDefault();
			if (e.shiftKey) redo(); else undo();
		}
	}
	function open(pid) {
		if (overlay) close();
		pageId = pid;
		strokes = loadStrokes(pid);
		undoStack = [];
		redoStack = [];
		drawing = null;
		overlay = document.createElement("div");
		overlay.className = "ink-overlay";
		overlay.innerHTML = toolbarHtml() + '<div class="ink-stage"><canvas class="ink-canvas"></canvas></div>';
		document.body.appendChild(overlay);
		canvas = overlay.querySelector("canvas");
		ctx = canvas.getContext("2d");
		overlay.addEventListener("click", onToolbarClick);
		canvas.addEventListener("pointerdown", onDown);
		canvas.addEventListener("pointermove", onMove);
		canvas.addEventListener("pointerup", onUp);
		canvas.addEventListener("pointercancel", onUp);
		resizeHandler = () => layout();
		window.addEventListener("resize", resizeHandler);
		document.addEventListener("keydown", onKey);
		layout();
	}
	function close() {
		if (!overlay) return;
		saveNow();
		window.removeEventListener("resize", resizeHandler);
		document.removeEventListener("keydown", onKey);
		overlay.remove();
		overlay = null;
		canvas = null;
		ctx = null;
		pageId = null;
	}

	// ---------- Bootstrap: Styles + Floating-Button ----------
	const CSS = [
		"#inkFab{position:fixed;right:18px;bottom:96px;z-index:9000;width:52px;height:52px;border-radius:50%;font-size:22px;border:1px solid var(--edge,#c9c9c9);background:var(--panel-solid,#fff);box-shadow:0 4px 16px rgba(0,0,0,.18);cursor:pointer}",
		"#inkFab.has-ink::after{content:'';position:absolute;top:6px;right:6px;width:9px;height:9px;border-radius:50%;background:#2f6fed}",
		".ink-overlay{position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,.45);display:flex;flex-direction:column}",
		".ink-toolbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;background:var(--panel-solid,#fff);border-bottom:1px solid var(--edge,#c9c9c9);padding:8px calc(10px + env(safe-area-inset-right)) 8px calc(10px + env(safe-area-inset-left));padding-top:calc(8px + env(safe-area-inset-top))}",
		".ink-toolbar button{min-height:38px;min-width:38px;touch-action:manipulation}",
		".ink-toolbar button.active{outline:2px solid #2f6fed;outline-offset:-2px}",
		".ink-swatch{width:26px;height:26px;border-radius:50%;border:2px solid rgba(127,127,127,.35);padding:0}",
		".ink-sep{width:1px;height:24px;background:var(--edge,#c9c9c9);margin:0 4px}",
		".ink-spacer{flex:1}",
		".ink-stage{flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:10px}",
		".ink-canvas{background:#fff repeating-linear-gradient(to bottom,transparent 0 27px,rgba(47,111,237,.14) 27px 28px);border-radius:6px;box-shadow:0 8px 30px rgba(0,0,0,.35);touch-action:none}",
	].join("\n");
	function init() {
		const st = document.createElement("style");
		st.textContent = CSS;
		document.head.appendChild(st);
		const b = document.createElement("button");
		b.id = "inkFab";
		b.type = "button";
		b.hidden = true;
		b.title = "Handschrift & Skizzen (Apple Pencil)";
		b.textContent = "✏️";
		b.addEventListener("click", () => {
			if (S.view === "page" && S.currentPageId) open(S.currentPageId);
		});
		document.body.appendChild(b);
		// Bewusst ein leichter Poll statt STATE.onChange: boot.js belegt den einzigen
		// onChange-Slot mit RENDER.render — so bleibt ink.js komplett entkoppelt.
		setInterval(() => {
			const show = S.view === "page" && !!S.currentPageId && !overlay;
			b.hidden = !show;
			if (show) b.classList.toggle("has-ink", hasInk(S.currentPageId));
		}, 800);
	}
	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
	else init();

	return { open, close, hasInk };
})();