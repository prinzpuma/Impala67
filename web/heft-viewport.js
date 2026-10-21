"use strict";

// Heft-Ansicht: Zoom, Verschieben, Seiten- und Detail-Kacheln sowie Finger-Gesten.
// Aus heft.js herausgelöst; Seiteninhalt, Stift und Werkzeuge bleiben dort.
// heft.js reicht über ctx seine (beim Neuaufbau wechselnden) Zeichenflächen und
// die Zeichenfunktionen herein; die Ansicht selbst (view, fitScale, Kacheln) lebt hier.

import { U } from "./util.js";
import { PAGE_W, PAGE_H } from "./heft-document-core.js";
import { PERF_PROFILER } from "./performance-profiler.js";

export function createHeftViewport(ctx) {
	let scale = 1, fitScale = 1;
	let detailVisible = new Set();

	// --- Ansicht: EINE Wahrheit (26. Juli, Neubau) ---------------------------
	// view = { x, y, k }: x/y ist die linke obere Ecke des sichtbaren Bereichs in
	// BASIS-Pixeln (Layout ohne Zoom), k der Zoomfaktor. Angewendet wird
	// ausschliesslich ein CSS-transform auf .heft-pages. Kein natives Scrollen, kein
	// Umlayouten beim Zoomen, keine Nachkorrektur: der Punkt unter den Fingern bleibt
	// per Konstruktion stehen. Dadurch sind keepAnchor, flipGlide, setZoom/queueZoom,
	// das Grid-Zentrieren und das Wachsen der Zeichenflaechen beim Zoomen entfallen.
	const ZOOM_MIN = 0.4, ZOOM_MAX = 6;
	const view = { x: 0, y: 0, k: 1 };
	const PAD_X = 18, PAD_BOTTOM = 56;
	const padTop = () => (window.innerWidth < 640 ? 36 : 46);

	// Die Basis-Seite hat jetzt eine FESTE Groesse (fit, unabhaengig vom Zoom),
	// deshalb darf sie in voller Geraeteauflaesung gefuellt werden. Die alte Grenze
	// von 1.5 stammte aus der Zeit, als die Zeichenflaeche mit dem Zoom mitwuchs -
	// auf einem 2x/3x-Bildschirm war dadurch jede Schrift dauerhaft weich.
	const MAX_RENDER_DPR = 3, MAX_RENDER_PIXELS = 6_000_000, MAX_CANVAS_DIM = 4096;
	let zoomSettleTimer = 0, gesturePrefetchTimer = 0;
	const gesture = {
		pts: new Map(), pinch: null, last: null, maxCount: 0, moved: false, startedAt: 0, restore: null,
		raf: 0, fling: 0, anim: null, paintZoom: false, vx: 0, vy: 0, lastT: 0,
		lastTap: 0, tapX: 0, tapY: 0, lastTwoTap: 0,
	};
	const scrollEl = () => (ctx.host() ? ctx.host().querySelector(".heft-scroll") : null);
	const pagesEl = () => (ctx.host() ? ctx.host().querySelector(".heft-pages") : null);
	const clamp = (v, lo, hi) => U.clamp(v, lo, hi);
	// Geometrie aendert sich nur bei layout()/DOM-Neuaufbau. Die alten Getter
	// erzwangen dagegen in jedem Scroll-Frame mehrere synchrone Layout-Messungen.
	let geometry = { viewport: null, content: { w: 1, h: 1 }, pages: [] };
	const viewport = () => geometry.viewport;
	const contentSize = () => geometry.content;
	function refreshGeometry(vp) {
		const scroll = scrollEl(), pgs = pagesEl();
		if (!scroll || !pgs) { geometry = { viewport: null, content: { w: 1, h: 1 }, pages: [] }; return; }
		const rect = vp || scroll.getBoundingClientRect();
		geometry = {
			viewport: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
			content: { w: pgs.offsetWidth, h: pgs.offsetHeight },
			pages: ctx.pageSlots().map((slot, i) => {
				const base = ctx.canvases()[i];
				return slot && base ? {
					top: slot.offsetTop, height: slot.offsetHeight,
					x: slot.offsetLeft + base.offsetLeft, y: slot.offsetTop + base.offsetTop,
					w: base.offsetWidth, h: base.offsetHeight,
					baseLeft: base.offsetLeft, baseTop: base.offsetTop,
				} : null;
			}),
		};
	}

	function stopAnim() {
		if (gesture.raf) cancelAnimationFrame(gesture.raf);
		if (gesture.fling) cancelAnimationFrame(gesture.fling);
		gesture.raf = gesture.fling = 0; gesture.paintZoom = false;
		if (gesturePrefetchTimer) { clearTimeout(gesturePrefetchTimer); gesturePrefetchTimer = 0; }
		if (gesture.anim) { gesture.anim(); gesture.anim = null; }
	}
	function navReset() {
		stopAnim(); gesture.pts.clear();
		gesture.pinch = null; gesture.last = null; gesture.maxCount = 0; gesture.moved = false;
		gesture.vx = gesture.vy = 0; gesture.lastTap = 0; gesture.lastTwoTap = 0; gesture.restore = null;
	}
	// Grenzen an EINER Stelle: passt der Inhalt in die Ansicht, wird zentriert,
	// sonst am Rand gestoppt.
	function clampView(v) {
		const vp = viewport(); if (!vp) return v;
		const c = contentSize();
		v.k = clamp(v.k, ZOOM_MIN, ZOOM_MAX);
		const vw = vp.width / v.k, vh = vp.height / v.k;
		v.x = c.w <= vw ? (c.w - vw) / 2 : clamp(v.x, 0, c.w - vw);
		v.y = c.h <= vh ? (c.h - vh) / 2 : clamp(v.y, 0, c.h - vh);
		return v;
	}
	// Die EINZIGE Stelle, die die Ansicht auf den Bildschirm bringt.
	// Waehrend einer Geste wird NUR das transform gesetzt (billig, deshalb
	// fluessig) und der Layer per will-change fixiert. Beim Abschluss bzw. nach
	// einer kurzen Pause wird der Layer wieder FREIGEGEBEN und alles in echter
	// Aufloesung gezeichnet. Genau das fehlte: ein dauerhaftes
	// will-change: transform friert die Rasterung des Layers auf einer Zoomstufe
	// ein, der Browser skaliert danach nur noch ein altes Bild hoch - alles wirkte
	// unscharf.
	function paintView(commit, zooming = false) {
		const pgs = pagesEl(); if (!pgs) return;
		clampView(view);
		scale = fitScale * view.k;
		// Vor dem Transform-Schreibzugriff promoten. Vorher kam will-change erst
		// DANACH; Safari musste den riesigen Seiten-Layer im ersten Bewegungsframe
		// synchron neu zusammensetzen — der sichtbare Ruck direkt beim Losscrollen.
		if (!commit && pgs.style.willChange !== "transform") pgs.style.willChange = "transform";
		// Auf GANZE Geraetepixel einrasten. Eine gebrochene Verschiebung laesst den
		// Browser den ganzen Layer neu abtasten (bilinear) - Striche, Schrift und
		// importierte PDF-Seiten werden dadurch weich, obwohl die Aufloesung stimmt.
		const dprSnap = window.devicePixelRatio || 1;
		const snap = (v) => Math.round(v * dprSnap) / dprSnap;
		pgs.style.transform = "translate(" + snap(-view.x * view.k) + "px, " + snap(-view.y * view.k) + "px) scale(" + view.k.toFixed(4) + ")";
		positionDetailLayers();
		if (!commit) {
			// Während der Geste nur die bereits gerasterte Fläche verschieben. Eine
			// vollständige Seitenprüfung pro Frame blockierte Safari beim Scrollen.
			if (zooming) scheduleZoomSettleRender();
			else scheduleGesturePrefetch();
			return;
		}
		if (gesturePrefetchTimer) { clearTimeout(gesturePrefetchTimer); gesturePrefetchTimer = 0; }
		clearTimeout(zoomSettleTimer); zoomSettleTimer = 0;
		sharpen();
	}
	// Scharf machen: Layer freigeben, damit der Browser neu rastert, dann Seiten
	// und Detail-Kacheln fuer die aktuelle Zoomstufe fuellen.
	function sharpen() {
		const pgs = pagesEl(); if (!pgs) return;
		pgs.style.willChange = "auto";
		// Ein abgeschlossener Zoom oder ein Layoutwechsel (z. B. Seitenleiste)
		// braucht immer eine Kachel fuer die EXAKT aktuelle Fit-/Zoomstufe.
		// Eine nur geometrisch noch abdeckende alte Kachel darf hier nicht bleiben:
		// WebKit skaliert sie sonst hoch und das Heft wirkt dauerhaft unscharf.
		renderVisiblePages(false, true);
		ctx.viewChanged();
	}
	function schedulePaint(zooming = false) {
		gesture.paintZoom = gesture.paintZoom || zooming;
		const pgs = pagesEl();
		if (pgs && pgs.style.willChange !== "transform") pgs.style.willChange = "transform";
		if (gesture.raf) return;
		gesture.raf = requestAnimationFrame(() => {
			const isZoom = !!gesture.paintZoom;
			gesture.raf = 0; gesture.paintZoom = false;
			paintView(false, isZoom);
		});
	}
	function renderVisibleBasePages() {
		if (!ctx.doc()) return;
		const nativeDpr = Math.min(MAX_RENDER_DPR, (window.devicePixelRatio || 1) * 1.5);
		const pageW = PAGE_W * fitScale, pageH = PAGE_H * fitScale;
		const pixelBudgetDpr = Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, pageW * pageH));
		const edgeBudgetDpr = MAX_CANVAS_DIM / Math.max(pageW, pageH);
		const safeDpr = Math.max(0.5, Math.min(nativeDpr, pixelBudgetDpr, edgeBudgetDpr));
		for (const i of visiblePageIndices()) {
			const cv = ctx.canvases()[i];
			if (!cv) continue;
			cv.__heftDpr = safeDpr; cv.__heftScale = fitScale;
			const w = Math.max(1, Math.round(pageW * safeDpr));
			const h = Math.max(1, Math.round(pageH * safeDpr));
			const needsRender = cv.width !== w || cv.height !== h;
			if (cv.width !== w) cv.width = w;
			if (cv.height !== h) cv.height = h;
			if (needsRender) ctx.redrawBasePage(i);
		}
	}
	function scheduleGesturePrefetch() {
		// Debounce statt Throttle: kontinuierliches Scrollen darf nie mitten in der
		// Bewegung Canvas-Seiten rasterisieren. Ein Touch-Ende rendert ohnehin sofort.
		if (gesturePrefetchTimer) clearTimeout(gesturePrefetchTimer);
		gesturePrefetchTimer = setTimeout(() => {
			gesturePrefetchTimer = 0;
			if (ctx.host() && ctx.doc()) renderVisibleBasePages();
		}, 80);
	}
	// Punkt unter (clientX, clientY) festhalten: ein Schritt, keine Korrektur.
	function zoomAt(nextK, clientX, clientY, commit) {
		const vp = viewport(); if (!vp) return;
		const k = clamp(nextK, ZOOM_MIN, ZOOM_MAX);
		const bx = view.x + (clientX - vp.left) / view.k, by = view.y + (clientY - vp.top) / view.k;
		view.k = k; view.x = bx - (clientX - vp.left) / k; view.y = by - (clientY - vp.top) / k;
		if (commit) paintView(true); else schedulePaint(true);
	}
	function animateTo(nx, ny, nk, dur = 300) {
		stopAnim();
		const pgs = pagesEl();
		if (pgs && pgs.style.willChange !== "transform") pgs.style.willChange = "transform";
		const from = { x: view.x, y: view.y, k: view.k };
		const to = clampView({ x: nx, y: ny, k: nk });
		const zooming = Math.abs(to.k - from.k) > 0.0001;
		gesture.anim = U.animate(dur, (t, e) => {
			view.x = from.x + (to.x - from.x) * e;
			view.y = from.y + (to.y - from.y) * e;
			view.k = from.k + (to.k - from.k) * e;
			paintView(t >= 1, zooming);
			if (t >= 1) gesture.anim = null;
		});
	}
	// Alle Seiten, die hoechstens pad Basis-Pixel vom sichtbaren Bereich entfernt sind.
	function pageIndicesWithin(pad) {
		const vp = viewport(); if (!vp) return [];
		const vh = vp.height / view.k;
		const top = view.y - pad, bot = view.y + vh + pad, out = [];
		geometry.pages.forEach((page, i) => {
			if (!page) return;
			if (page.top + page.height >= top && page.top <= bot) out.push(i);
		});
		return out;
	}
	// Gezeichnet wird eine ganze Bildschirmhoehe im Voraus, damit eine Seite schon
	// fertig ist, bevor sie ins Bild kommt.
	function visiblePageIndices() {
		const vp = viewport(); if (!vp) return [];
		return pageIndicesWithin(Math.max(400, (vp.height / view.k) * 1.2));
	}
	// Detail-Kachel: deckt den sichtbaren Teil einer Seite scharf ab. Alles in
	// BASIS-Pixeln aus view gerechnet (nicht aus getBoundingClientRect) — deshalb
	// stimmt die Kachel auch mitten in einer Geste, und ihre Kosten haengen an der
	// Bildschirmgroesse statt am Zoomfaktor.
	function tileDpr(r) {
		// Die Kachel ist die EINZIGE Quelle der Schärfe (die Basis-Seite bleibt bei fit) — sie darf
		// deshalb die volle Geräteauflösung nutzen. Die alte 2er-Grenze machte 3x-Bildschirme
		// dauerhaft weich, obwohl das Pixel-Budget noch Luft hatte.
		// Überabtastung: bei Bildschirm-Zoom (k≈1) ist die Schrift sonst nur so fein wie ein
		// Gerätepixel — 1,5× rendern und vom Browser herunterskalieren lassen macht dünne
		// Striche deutlich glatter. Beim Hineinzoomen schneidet das Pixel-Budget unten das
		// von selbst wieder weg.
		const native = Math.min(MAX_RENDER_DPR, (window.devicePixelRatio || 1) * 1.5);
		const w = Math.max(1, r.w * view.k), h = Math.max(1, r.h * view.k);
		return Math.max(0.5, Math.min(native, Math.sqrt(MAX_RENDER_PIXELS / (w * h)), MAX_CANVAS_DIM / Math.max(w, h)));
	}
	function tileTransform(x, t) {
		const f = t.dpr * t.k;
		x.setTransform(t.dpr * t.scale, 0, 0, t.dpr * t.scale, -t.x * f, -t.y * f);
	}
	// layerRectFor arbeitet in Layout-Pixeln: diese Werte bestimmen Position und
	// Größe des CSS-Canvas. Striche und Bilder liegen dagegen in den festen
	// Seiten-Pixeln (PAGE_W/PAGE_H). Culling muss deshalb zurück in Seiten-Pixel
	// umgerechnet werden. Ohne diese Umrechnung verschwanden auf iPadOS je nach
	// fitScale ganze Strichbereiche beim Zoom.
	function pageRectForTile(r, f = fitScale) {
		const scaleForPage = Math.max(0.0001, f || 1);
		return { x: r.x / scaleForPage, y: r.y / scaleForPage, w: r.w / scaleForPage, h: r.h / scaleForPage };
	}
	function pageOrigin(i) {
		return geometry.pages[i] || null;
	}
	function layerRectFor(i, over = 64) {
		const vp = viewport(), o = pageOrigin(i);
		if (!vp || !o) return null;
		const vw = vp.width / view.k, vh = vp.height / view.k;
		// Auf ganze Basis-Pixel runden: eine gebrochene Kachelkante wird sonst beim
		// Anzeigen weich gerechnet.
		// Der Rand zählt in BILDSCHIRM-Pixeln, nicht in Basis-Pixeln. Vorher wuchs er mit dem Zoom
		// (bei k=5 über 700 Basis-Pixel je Seite): die Kachelfläche sprengte MAX_RENDER_PIXELS,
		// tileDpr fiel unter 1 und die Kachel wurde HOCHSKALIERT — ausgerechnet beim Hineinzoomen.
		// Kleinerer Rand (64 statt 140): Schärfe schlägt Vorausrendern.
		const pad = over / view.k;
		const x0 = Math.floor(clamp(view.x - o.x - pad, 0, o.w)), y0 = Math.floor(clamp(view.y - o.y - pad, 0, o.h));
		const x1 = Math.ceil(clamp(view.x + vw - o.x + pad, 0, o.w)), y1 = Math.ceil(clamp(view.y + vh - o.y + pad, 0, o.h));
		if (x1 - x0 < 2 || y1 - y0 < 2) return null;
		return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
	}
	function positionDetailLayer(cv) {
		const t = cv && cv.__heftTile, page = t && pageOrigin(t.pageIndex);
		if (!t || !page || cv.style.display === "none") return;
		const dprSnap = window.devicePixelRatio || 1;
		const snap = (v) => Math.round(v * dprSnap) / dprSnap;
		// Die Detailkachel ist absichtlich ein DIREKTES Kind der unskalierten
		// .heft-scroll. So kann WebKit sie weder mit .heft-pages zusammenrasterisieren
		// noch bei hohem Zoom ein altes Bild der Kachel hochskalieren.
		cv.style.left = snap((page.x + t.x - view.x) * view.k) + "px";
		cv.style.top = snap((page.y + t.y - view.y) * view.k) + "px";
		cv.style.width = (t.w * view.k) + "px";
		cv.style.height = (t.h * view.k) + "px";
	}
	function positionDetailLayers() {
		ctx.detailCanvases().forEach(positionDetailLayer);
		ctx.wetCanvases().forEach(positionDetailLayer);
	}
	function placeLayer(cv, i, r, dpr) {
		const page = geometry.pages[i], k = view.k;
		if (!page) return;
		cv.style.transformOrigin = "0 0";
		cv.style.transform = "none";
		const pw = Math.max(1, Math.round(r.w * dpr * k)), ph = Math.max(1, Math.round(r.h * dpr * k));
		if (cv.width !== pw) cv.width = pw;
		if (cv.height !== ph) cv.height = ph;
		cv.__heftDpr = dpr; cv.__heftScale = fitScale * k;
		cv.__heftTile = { pageIndex: i, x: r.x, y: r.y, w: r.w, h: r.h, dpr, k, scale: fitScale * k };
		cv.style.display = "block";
		positionDetailLayer(cv);
	}
	// Ausgeblendete Kacheln geben ihren Speicher frei (je bis zu ~24 MB). Nur versteckt hielt
	// jede besuchte Seite zwei volle Kacheln; auf dem iPad war das Canvas-Limit nach 15–20
	// Seiten erreicht – Seiten blieben leer. Beim Wiederzeigen setzt placeLayer die Größe neu.
	function hideLayer(cv) {
		if (!cv) return;
		cv.style.display = "none";
		cv.__heftTile = null;
		if (cv.width || cv.height) { cv.width = 0; cv.height = 0; }
	}

	function renderDetailTile(i) {
		const tile = ctx.detailCanvases()[i], wet = ctx.wetCanvases()[i], pg = ctx.doc()?.pages[i];
		if (!tile || !pg) return;

		const drawing = ctx.drawing();
		if (drawing && drawing.pageIdx === i && drawing.ctx && !drawing.erasing) return;
		const r = layerRectFor(i);
		if (!r) { hideLayer(tile); hideLayer(wet); return; }
		const dpr = tileDpr(r);
		placeLayer(tile, i, r, dpr);
		const x = tile.getContext("2d");
		x.setTransform(1, 0, 0, 1, 0, 0);
		x.clearRect(0, 0, tile.width, tile.height);
		x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
		tileTransform(x, tile.__heftTile);
		ctx.renderPageTo(x, pg, i, pageRectForTile(r));
		if (wet) {
			placeLayer(wet, i, r, dpr);
			const wx = wet.getContext("2d");
			wx.setTransform(1, 0, 0, 1, 0, 0);
			wx.clearRect(0, 0, wet.width, wet.height);
		}
	}
	function tileCovers(i) {
		const tile = ctx.detailCanvases()[i], t = tile && tile.__heftTile;
		// Eine Kachel mit HÖHERER Zoomstufe hat mehr Gerätepixel als nötig — sie ist scharf und
		// darf bleiben. Der alte Exakt-Vergleich verwarf sie bei der kleinsten Bewegung, dadurch
		// wurde bei jedem Frame neu gerendert (bzw. während der Geste gar nicht).
		if (!t || tile.style.display === "none" || t.k < view.k - 0.0001) return false;
		// Beim Ein-/Ausklappen der Seitenleiste aendert sich fitScale, view.k aber
		// nicht. Ohne diesen Vergleich galt die Kachel der alten Seitenbreite weiter
		// als scharf und wurde vom Browser auf die neue Breite skaliert.
		if (Math.abs(t.scale - fitScale * t.k) > 0.0001) return false;
		const need = layerRectFor(i, 0);
		if (!need) return false;
		return t.x <= need.x + 0.5 && t.y <= need.y + 0.5 &&
			t.x + t.w >= need.x + need.w - 0.5 && t.y + t.h >= need.y + need.h - 0.5;
	}

	function renderDetailTiles(force = false) {
		if (!ctx.doc()) return;
		const finish = PERF_PROFILER.start("heft.render-tiles", { force }, 16);
		const next = new Set(pageIndicesWithin(Math.max(4, 64 / view.k)));
		for (const i of detailVisible) {
			if (!next.has(i)) { hideLayer(ctx.detailCanvases()[i]); hideLayer(ctx.wetCanvases()[i]); }
		}
		for (const i of next) {
			if (!layerRectFor(i)) { hideLayer(ctx.detailCanvases()[i]); hideLayer(ctx.wetCanvases()[i]); continue; }
			if (!force && tileCovers(i)) continue;
			renderDetailTile(i);
		}
		detailVisible = next;
		finish();
	}

	function liveInkCtx(i) {
		const wet = ctx.wetCanvases()[i];
		if (wet) {
			let r = wet.__heftTile;
			if (!r || wet.style.display === "none") {
				r = layerRectFor(i);
				if (r) {
					const dpr = tileDpr(r);
					placeLayer(wet, i, r, dpr);
				}
			}
			if (wet.__heftTile && wet.style.display !== "none") {
				const x = wet.getContext("2d");
				x.setTransform(1, 0, 0, 1, 0, 0);
				tileTransform(x, wet.__heftTile);
				return x;
			}
		}

		const x = ctx.canvases()[i].getContext("2d");
		ctx.applyTransform(x);
		return x;
	}
	function clearLiveInk(i) {
		const wet = ctx.wetCanvases()[i];
		if (!wet || !wet.__heftTile || wet.style.display === "none") return false;
		const x = wet.getContext("2d");
		x.setTransform(1, 0, 0, 1, 0, 0);
		x.clearRect(0, 0, wet.width, wet.height);
		tileTransform(x, wet.__heftTile);
		return true;
	}

	function commitStrokeRender(i, stroke) {
		const finish = PERF_PROFILER.start("heft.stroke", { points: stroke?.pts?.length || 0 }, 8);
		const cv = ctx.canvases()[i];
		if (cv && cv.width > 1) { const x = cv.getContext("2d"); ctx.applyTransform(x); ctx.drawStroke(x, stroke); }
		const tile = ctx.detailCanvases()[i];
		if (tile && tile.__heftTile && tile.style.display !== "none") {
			const x = tile.getContext("2d"); tileTransform(x, tile.__heftTile); ctx.drawStroke(x, stroke);
		}
		clearLiveInk(i);
		finish();
	}
	function renderVisiblePages(skipTiles = false, forceTiles = false) {
		if (!ctx.doc()) return;
		const visible = new Set(visiblePageIndices());
		// Weiter aussen liegende Seiten behalten ihr Bild noch (Speicher gegen Ruckeln):
		// beim Hin- und Herscrollen muss dieselbe Seite sonst dauernd neu gezeichnet
		// werden, und genau das fuehlte sich wie "laedt ewig" an.
		const vpKeep = viewport();
		const keep = new Set(pageIndicesWithin(vpKeep ? (vpKeep.height / view.k) * 3.5 : 1200));

		// Die Basis-Seite wird IMMER in Basis-Aufloesung gefuellt, unabhaengig vom Zoom:
		// beim Zoomen muss dadurch keine Zeichenflaeche wachsen und nichts neu gezeichnet
		// werden. Die Schaerfe liefert die Detail-Kachel darueber.
		const nativeDpr = Math.min(MAX_RENDER_DPR, (window.devicePixelRatio || 1) * 1.5);
		const pageW = PAGE_W * fitScale, pageH = PAGE_H * fitScale;
		const pixelBudgetDpr = Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, pageW * pageH));
		const edgeBudgetDpr = MAX_CANVAS_DIM / Math.max(pageW, pageH);

		const safeDpr = Math.max(0.5, Math.min(nativeDpr, pixelBudgetDpr, edgeBudgetDpr));
		ctx.canvases().forEach((cv, i) => {
			if (!visible.has(i)) {
				if (!keep.has(i) && (cv.width !== 1 || cv.height !== 1)) { cv.width = 1; cv.height = 1; }
				hideLayer(ctx.detailCanvases()[i]); hideLayer(ctx.wetCanvases()[i]);
				return;
			}
			cv.__heftDpr = safeDpr; cv.__heftScale = fitScale;
			const w = Math.max(1, Math.round(pageW * safeDpr));
			const h = Math.max(1, Math.round(pageH * safeDpr));

			const needsRender = cv.width !== w || cv.height !== h;
			if (cv.width !== w) cv.width = w;
			if (cv.height !== h) cv.height = h;
			if (needsRender) ctx.redrawBasePage(i);
		});

		if (!skipTiles) renderDetailTiles(forceTiles);
	}
	function scheduleZoomSettleRender() {
		clearTimeout(zoomSettleTimer);
		zoomSettleTimer = setTimeout(() => { zoomSettleTimer = 0; sharpen(); }, 110);
	}

	// Nur bei Groessenaenderung oder Neuaufbau: fit neu bestimmen und den Mittelpunkt
	// der Ansicht halten. Beim Zoomen wird das NIE aufgerufen.
	// settle (Fenster-/Containergroesse): PERF wie beim Pinch-Zoom nur verschieben und
	// erst nach kurzer Ruhe scharf rastern. Vorher rasterte jedes Resize-Ereignis alle
	// sichtbaren Seiten neu — beim animierten Ein-/Ausklappen der Seitenleiste am Tablet
	// (0,5 s) in JEDEM Frame. Gleiche Groesse (z. B. Erstmeldung des Observers) = nichts tun.
	let layoutSize = "";
	function layout(settle = false) {
		const scroll = scrollEl(), pgs = pagesEl();
		if (!scroll) return;
		const vp = scroll.getBoundingClientRect();
		const size = vp.width + "x" + vp.height;
		if (settle && size === layoutSize) return;
		layoutSize = size;
		const padT = padTop();
		const availW = Math.max(1, vp.width - 2 * PAD_X), availH = Math.max(1, vp.height - padT - PAD_BOTTOM);
		const prev = fitScale || 1;
		const cx = view.x + (vp.width / view.k) / 2, cy = view.y + (vp.height / view.k) / 2;
		fitScale = Math.max(0.05, Math.min(availW / PAGE_W, availH / PAGE_H, 1));
		if (pgs) {
			pgs.style.setProperty("--heft-page-w", (PAGE_W * fitScale) + "px");
			pgs.style.setProperty("--heft-page-h", (PAGE_H * fitScale) + "px");
			// Der Rand ist Teil des Inhalts und zoomt mit. JS ist die einzige Quelle dafuer,
			// damit CSS und Rechnung nie auseinanderlaufen.
			pgs.style.padding = padT + "px " + PAD_X + "px " + PAD_BOTTOM + "px";
			pgs.style.transformOrigin = "0 0";
		}
		const f = fitScale / prev;
		view.x = cx * f - (vp.width / view.k) / 2;
		view.y = cy * f - (vp.height / view.k) / 2;
		// Ein Layout-Read nach den Groessen-Aenderungen; Gesten arbeiten danach
		// ausschliesslich mit stabilen Zahlen aus dem Cache.
		refreshGeometry(vp);
		paintView(!settle, settle);
	}
	function animateZoom(target, clientX, clientY, dur = 280) {
		const vp = viewport(); if (!vp) return;
		const k = clamp(target, ZOOM_MIN, ZOOM_MAX);
		const bx = view.x + (clientX - vp.left) / view.k, by = view.y + (clientY - vp.top) / view.k;
		animateTo(bx - (clientX - vp.left) / k, by - (clientY - vp.top) / k, k, dur);
	}

	// Alle Gesten macht heft.js selbst, es gibt kein natives Scrollen mehr.
	function applyTouchAction() {
		const scroll = scrollEl();
		if (scroll) scroll.style.touchAction = "none";
		ctx.canvases().forEach((cv) => { if (cv) cv.style.touchAction = "none"; });
	}

	function onPenBoundary(e) {
		if (e.pointerType !== "pen") return;
		if (e.type === "pointerover") e.currentTarget.style.touchAction = "none";
	}

	// Handballen: KEINE Erkennung ueber die Kontaktflaeche (ein Daumen meldet die
	// gleiche Flaeche). Setzt der Stift innerhalb von PALM_UNDO_MS nach einer
	// Beruehrung auf, war es die Hand und die Verschiebung wird zurueckgenommen
	// (siehe onDown).
	const PALM_UNDO_MS = 350;
	const fingersOf = (list) => [...list].filter((t) => t.touchType !== "stylus");
	const touchMid = (t) => [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2];
	const touchDist = (t) => Math.max(1, Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY));
	// EIN Finger verschiebt nur im Stift-Modus (sonst zeichnet er), ZWEI Finger
	// verschieben und zoomen immer.
	const panWithOneFinger = () => ctx.touchNavigates();
	function startGesture(fingers) {
		if (fingers.length >= 2) {
			gesture.pinch = { d0: touchDist(fingers), mid0: touchMid(fingers), k0: view.k, x0: view.x, y0: view.y };
			gesture.last = null;
		} else {
			gesture.pinch = null;
			gesture.last = fingers.length === 1 ? [fingers[0].clientX, fingers[0].clientY] : null;
		}
		gesture.lastT = performance.now();
		gesture.vx = gesture.vy = 0;
	}
	function onTouchStart(e) {
		// Stift aktiv → Touch-Gesten komplett ignorieren (Zoom, Pan, Undo).
		// Greift plattformuebergreifend (Android hat kein touchType, aber
		// pointerdown mit pointerType=pen feuert VOR touchstart).
		if (ctx.penRecently()) return;
		// Finger zieht gerade die Lasso-Auswahl: nicht gleichzeitig die Seite verschieben.
		if (ctx.drawing() && ctx.drawing().byTouch) return;
		const fingers = fingersOf(e.touches);
		if (!fingers.length) return;
		for (const t of fingersOf(e.changedTouches)) gesture.pts.set(t.identifier, { x: t.clientX, y: t.clientY });
		gesture.maxCount = Math.max(gesture.maxCount, fingers.length);
		if (gesture.pts.size === 1) {
			gesture.moved = false; gesture.startedAt = Date.now();
			// Ansicht VOR der Beruehrung merken (Handballen-Nachsorge in onDown).
			const before = { x: view.x, y: view.y, k: view.k };
			gesture.restore = () => { view.x = before.x; view.y = before.y; view.k = before.k; paintView(true); };
		}
		if (fingers.length < 2 && !panWithOneFinger()) return;
		e.preventDefault(); stopAnim();
		startGesture(fingers);
	}
	function onTouchMove(e) {
		if (ctx.penRecently()) { navReset(); return; }
		if (ctx.drawing() && ctx.drawing().byTouch) return;
		for (const t of e.changedTouches) {
			const s = gesture.pts.get(t.identifier);
			if (s && Math.hypot(t.clientX - s.x, t.clientY - s.y) > 6) gesture.moved = true;
		}
		const fingers = fingersOf(e.touches);
		if (!fingers.length) return;
		if (fingers.length >= 2) {
			e.preventDefault();
			if (!gesture.pinch) startGesture(fingers);
			const g = gesture.pinch, vp = viewport();
			if (!g || !vp) return;
			const k = clamp(g.k0 * (touchDist(fingers) / g.d0), ZOOM_MIN, ZOOM_MAX);
			const mid = touchMid(fingers);
			// Der Basis-Punkt, der beim Gestenstart unter dem Fingermittelpunkt lag, liegt
			// danach unter dem AKTUELLEN Mittelpunkt: Zoomen und Verschieben in EINER
			// Rechnung, ohne Zwischenschritt und ohne Nachkorrektur.
			const bx = g.x0 + (g.mid0[0] - vp.left) / g.k0, by = g.y0 + (g.mid0[1] - vp.top) / g.k0;
			view.k = k;
			view.x = bx - (mid[0] - vp.left) / k;
			view.y = by - (mid[1] - vp.top) / k;
			schedulePaint(true);
			return;
		}
		if (!gesture.last || !panWithOneFinger()) return;
		e.preventDefault();
		const t = fingers[0], now = performance.now();
		const dx = t.clientX - gesture.last[0], dy = t.clientY - gesture.last[1];
		const dt = Math.max(8, now - gesture.lastT);
		gesture.vx = dx / dt; gesture.vy = dy / dt; gesture.lastT = now;
		gesture.last = [t.clientX, t.clientY];
		view.x -= dx / view.k; view.y -= dy / view.k;
		schedulePaint();
	}
	// Schwung nach dem Loslassen (das leistete vorher der native Scroller).
	function startFling() {
		let vx = gesture.vx, vy = gesture.vy, last = performance.now();
		const step = (now) => {
			const dt = Math.min(32, now - last); last = now;
			const decay = Math.pow(0.996, dt);
			vx *= decay; vy *= decay;
			const px = view.x, py = view.y;
			view.x -= vx * dt / view.k; view.y -= vy * dt / view.k;
			paintView(false);
			const still = Math.abs(view.x - px) < 0.15 && Math.abs(view.y - py) < 0.15;
			if (Math.hypot(vx, vy) < 0.03 || still) { gesture.fling = 0; paintView(true); return; }
			gesture.fling = requestAnimationFrame(step);
		};
		gesture.fling = requestAnimationFrame(step);
	}
	// true = es sind noch Finger unten, die Geste laeuft weiter.
	function endGesture(e) {
		for (const t of e.changedTouches) gesture.pts.delete(t.identifier);
		const fingers = fingersOf(e.touches);
		if (fingers.length) { startGesture(fingers); return true; }
		gesture.pinch = null; gesture.last = null;
		return false;
	}
	function onTouchEnd(e) {
		if (endGesture(e)) return;
		// Stift-Touches duerfen keine Finger-Gesten (Zoom, Undo, Fling) ausloesen.
		if (ctx.penRecently()) return;
		const ended = fingersOf(e.changedTouches);
		if (!ended.length) return;
		const quick = Date.now() - gesture.startedAt < 300 && !gesture.moved;
		const count = gesture.maxCount; gesture.maxCount = 0;
		if (quick && count === 2) {
			// Undo erst beim DOPPEL-Tipp mit zwei Fingern (vorher reichte EIN Zwei-Finger-Tipp —
			// zu viele versehentliche Rückgängig beim Umgreifen/Abstützen).
			const now2f = Date.now();
			if (now2f - gesture.lastTwoTap < 500) { gesture.lastTwoTap = 0; ctx.undo(); }
			else gesture.lastTwoTap = now2f;
			return;
		}
		if (quick && count >= 3) { ctx.redo(); return; }
		if (quick && count === 1 && ended.length) {
			const t = ended[0], now = Date.now();
			if (now - gesture.lastTap < 330 && Math.hypot(t.clientX - gesture.tapX, t.clientY - gesture.tapY) < 64) {

				gesture.lastTap = 0;
				animateZoom(view.k >= 1.9 ? 1 : Math.max(2.2, Math.min(ZOOM_MAX, view.k * 1.8)), t.clientX, t.clientY);
				return;
			}
			gesture.lastTap = now; gesture.tapX = t.clientX; gesture.tapY = t.clientY;
			return;
		}
		if (gesture.moved && count === 1 && performance.now() - gesture.lastT < 90 && Math.hypot(gesture.vx, gesture.vy) > 0.25) startFling();
		else paintView(true);
	}
	function onTouchCancel(e) {
		gesture.moved = true;
		if (endGesture(e)) return;
		paintView(true);
	}
	let wheelCommitT = 0;
	function onWheelZoom(e) {
		e.preventDefault(); stopAnim();
		if (e.ctrlKey || e.metaKey) zoomAt(view.k * Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY, false);
		else { view.x += e.deltaX / view.k; view.y += e.deltaY / view.k; schedulePaint(); }
		clearTimeout(wheelCommitT);
		wheelCommitT = setTimeout(() => paintView(true), 160);
	}

	// Seite, deren Mitte der Bildschirmmitte am nächsten liegt (aktuelle Seite).
	function centerPageIndex() {
		const vp = viewport(); if (!vp) return -1;
		const mid = view.y + (vp.height / view.k) / 2;
		let best = 0, bestD = Infinity;
		geometry.pages.forEach((page, i) => {
			if (!page) return;
			const d2 = Math.abs(page.top + page.height / 2 - mid);
			if (d2 < bestD) { bestD = d2; best = i; }
		});
		return best;
	}

	// Beim Schließen des Hefts: Gesten, Timer und Geometrie zurücksetzen.
	function reset() {
		navReset();
		clearTimeout(wheelCommitT); clearTimeout(zoomSettleTimer); zoomSettleTimer = 0;
		detailVisible = new Set();
		geometry = { viewport: null, content: { w: 1, h: 1 }, pages: [] };
	}

	return {
		view, gesture, PALM_UNDO_MS, scale: () => scale,
		viewport, contentSize, scrollEl, stopAnim, navReset, animateTo, layout, reset, centerPageIndex,
		visiblePageIndices, pageRectForTile, renderDetailTile, renderVisiblePages,
		liveInkCtx, clearLiveInk, commitStrokeRender, applyTouchAction,
		onPenBoundary, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onWheelZoom,
	};
}
