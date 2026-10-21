"use strict";

// Stift- und Maus-Eingabe im Heft: Zeichnen, Radieren, Laser, Lasso (Auswählen,
// Verschieben, Skalieren), Bilder/Textfelder greifen und die Formerkennung beim Halten.
// Aus heft.js herausgelöst. Gemeinsamer Zustand (Dokument, Werkzeug, Auswahl, laufender
// Strich) bleibt in heft.js und kommt über die Getter/Setter von H herein; was nur die
// Eingabe braucht (aktive Stifte, Laser-Timer, Doppeltipp, Radierer-Frame) lebt hier.

import { U } from "./util.js";
import { BUS } from "./event-bus.js";
import { PAGE_W, PAGE_H } from "./heft-document-core.js";
import { fitStrokeShape, hitBox, strokeBounds, translateStroke, strokeGeometry, scaleStrokeFrom, nearPoint, strokeHitAt } from "./heft-geometry.js";
import { lassoBounds, selectStrokesByLasso, lassoTouchAction, hitLassoHandle, isLassoBodyHit, drawLassoPath } from "./heft-lasso.js";

export function createHeftInput(H) {
	const { vp, imagesOf, textsOf, hitText, redrawPage, updateChrome, dropLasso, pushUndo, refresh, openTextEditor, setWriting, drawStroke, scheduleSave, renderThumb } = H;
	const { stopAnim, applyTouchAction, gesture, PALM_UNDO_MS, liveInkCtx, clearLiveInk, commitStrokeRender } = vp;
	const activePenPointers = new Set();
	let lastPenUpAt = 0, lastStrokeAt = 0;
	const PEN_GRACE_MS = 400;
	let lastEmptyTap = null;
	const laserTimers = new Set();

	// r: optional vorab gemessenes Rechteck — gebündelte Stift-Events teilen sich eine Messung.
	const pos = (e, cv, r = cv.getBoundingClientRect()) => {
		return [
			Math.round((e.clientX - r.left) / vp.scale() * 10) / 10,
			Math.round((e.clientY - r.top) / vp.scale() * 10) / 10,
			Math.round((e.pressure || 0.5) * 100) / 100,
		];
	};

	const penRecently = () => activePenPointers.size > 0 || Date.now() - lastPenUpAt < PEN_GRACE_MS;
	const rejected = (e) => e.pointerType === "touch" && (H.onlyPen || penRecently());
	const touchNavigates = () => H.onlyPen && !penRecently();
	// Nur der Zeiger, der die Geste begonnen hat, bewegt oder beendet sie.
	const ownsDrawing = (e) => H.drawing.pointerId == null || e.pointerId === H.drawing.pointerId;
	const hitImage = (pg, p) => hitBox(imagesOf(pg), p);
	let eraseFrame = 0; // PERF: gedrosselter Redraw für Radierer & Lasso-Verschieben
	const redrawNextFrame = (pi) => { if (!eraseFrame) eraseFrame = requestAnimationFrame(() => { eraseFrame = 0; redrawPage(pi); }); };
	// Radierer-Feedback ("wo wirkt er?"): ein Ring in echter Radierer-Größe als DOM-Element
	// im Host. Bewusst KEIN Canvas-Zeichnen — das hinterlässt Schlieren auf der Seite oder
	// erzwingt zusätzliche Redraws; dieses Element folgt einfach dem Zeiger.
	function showEraserRing(e) {
		if (!H.host) return;
		let ring = H.host.querySelector(".heft-eraser-ring");
		if (!ring) { ring = document.createElement("div"); ring.className = "heft-eraser-ring"; H.host.appendChild(ring); }
		// GRÖSSE: eraserSize sind Seiten-Einheiten, der Ring lebt im unskalierten Host —
		// maßgeblich ist deshalb scale (= fitScale * view.k). Vorher fehlte fitScale, der
		// Ring war dadurch deutlich größer als die Fläche, die wirklich radiert.
		const box = H.host.getBoundingClientRect(), d = H.eraserSize * 2 * vp.scale();
		ring.style.width = ring.style.height = d + "px";
		ring.style.left = (e.clientX - box.left) + "px";
		ring.style.top = (e.clientY - box.top) + "px";
		ring.hidden = false;
	}
	function hideEraserRing() {
		const ring = H.host && H.host.querySelector(".heft-eraser-ring");
		if (ring) ring.hidden = true;
	}
	// Strichradierer: ein berührter Strich geht GANZ weg. Das Auftrennen an der
	// Radierer-Fläche ist wieder raus — es kostete pro Pointer-Event neue Strich-Objekte
	// (samt neuen IDs, Sync-Ereignissen und Voll-Redraws) und war deshalb zäh.
	function eraseAt(e) {
		// PERF: erst messen, dann den Ring verschieben — andersherum erzwang jedes
		// Pointer-Event ein zusätzliches synchrones Layout.
		const p0 = pos(e, H.drawing.cv), r = H.eraserSize, pg = H.doc.pages[H.drawing.pageIdx];
		showEraserRing(e);
		// PERF: Pointer-Events feuern viel dichter, als der Radierer breit ist —
		// Mini-Schritte müssen nicht jedes Mal alle Striche der Seite prüfen.
		const lp = H.drawing.lastErase;
		if (lp && Math.hypot(p0[0] - lp[0], p0[1] - lp[1]) < r * 0.35) return;
		H.drawing.lastErase = p0;
		const keep = [], removed = [];
		for (const s of pg.strokes) {
			if (strokeHitAt(s, p0[0], p0[1], r)) removed.push(s); else keep.push(s);
		}
		if (removed.length) {
			pg.strokes = keep; H.drawing.removed.push(...removed);
			// PERF: höchstens EIN Redraw pro Frame — der Bildschirm zeichnet seltener,
			// als Pointer-Events eintreffen.
			redrawNextFrame(H.drawing.pageIdx);
		}
	}
	function onDown(e) {

		if (e.pointerType === "pen") {
			activePenPointers.add(e.pointerId); stopAnim(); applyTouchAction();
			// Handballen-Nachsorge: hat eine Berührung Millisekunden vorher die Seite
			// verschoben, war das die Hand — zurück auf die alte Position.
			if (gesture.restore && Date.now() - gesture.startedAt < PALM_UNDO_MS) gesture.restore();
			gesture.restore = null;
		}
		// Handballen: eine bereits bestehende blaue Markierung wegräumen (CSS verhindert
		// neue, das hier löst die alte auf — sonst blieb sie sichtbar hängen).
		// nicht 'sel' benennen: verdeckte die Heft-Auswahl im ganzen Block
		if (e.pointerType !== "mouse") { const domSel = window.getSelection?.(); if (domSel && !domSel.isCollapsed) domSel.removeAllRanges(); }
		if (!H.doc) return;
		const cv = e.currentTarget;
		const slot = cv.closest('.heft-page-slot');
		const pi = slot ? Number(slot.dataset.hepage) : H.idx;
		const pg = H.doc.pages[pi];
		if (!pg) return;
		const p = pos(e, cv);
		const activeLassoBox = H.lassoSel && H.lassoSel.pageIdx === pi ? (H.lassoSel.bounds || lassoBounds(H.lassoSel.strokes)) : null;
		const onLasso = !!activeLassoBox && isLassoBodyHit(p, activeLassoBox, 20);
		// Ein Fingertipp außerhalb beendet Auswahl UND Lasso-Modus. Der Nur-Stift-
		// Schalter darf dagegen Verschieben/Skalieren einer Auswahl per Finger zulassen.
		const touchLasso = lassoTouchAction(e.pointerType, H.tool, onLasso);
		if (touchLasso === "dismiss") {
			H.tool = "pen"; H.expanded = true;
			updateChrome();
			return;
		}
		if (rejected(e) && touchLasso !== "interact") return;
		H.idx = pi;
		e.preventDefault();
		try { cv.setPointerCapture(e.pointerId); } catch {  }

		const x = liveInkCtx(pi);
		if (H.tool === "lasso") {

			if (H.lassoSel && H.lassoSel.pageIdx === pi && H.lassoSel.strokes.length) {
				const bb = H.lassoSel.bounds || lassoBounds(H.lassoSel.strokes);
				const handle = bb && hitLassoHandle(p, bb, e.pointerType === "touch" ? 22 : 18);
				if (handle) {
					const anchor = handle.anchor;
					const startDist = Math.max(12, Math.hypot(p[0] - anchor[0], p[1] - anchor[1]));
					H.drawing = {
						pointerId: e.pointerId,
						lassoResize: true,
						byTouch: e.pointerType === "touch",
						strokes: H.lassoSel.strokes,
						originals: H.lassoSel.strokes.map(strokeGeometry),
						cv,
						pageIdx: pi,
						anchor,
						bb,
						startPos: [p[0], p[1]],
						startDist,
						factor: 1,
					};
					return;
				}
				if (bb && isLassoBodyHit(p, bb, 12)) {
					H.drawing = { pointerId: e.pointerId, lassoMove: true, byTouch: e.pointerType === "touch", strokes: H.lassoSel.strokes, cv, pageIdx: pi, last: p, dx: 0, dy: 0 };
					return;
				}
			}

			// Neue Auswahl: alte Markierung sofort wegräumen (lag sie auf einer anderen
			// Seite, blieb ihr Rahmen dort sonst als Geist stehen).
			dropLasso();
			H.drawing = { pointerId: e.pointerId, lasso: true, pts: [p], cv, ctx: x, pageIdx: pi };
			return;
		}
		if (H.tool === "laser") {

			H.drawing = { pointerId: e.pointerId, laser: true, tool: "pen", color: "#ef4444", size: 7, pts: [p], cv, ctx: x, pageIdx: pi };
			return;
		}
		if (H.tool === "select") {

			const st = H.sel && H.sel.pageIdx === pi && H.sel.txtId ? textsOf(pg).find((t2) => t2.id === H.sel.txtId) : null;
			if (st && nearPoint(p, st.x + st.w, st.y, 16)) {

				pg.texts = textsOf(pg).filter((t2) => t2 !== st);
				pushUndo({ kind: "txtDel", txt: st, pageIdx: pi });
				H.sel = null;
				refresh(pi);
				return;
			}
			if (st && nearPoint(p, st.x + st.w, st.y + (st.h || 60), 16)) {

				H.drawing = { pointerId: e.pointerId, imgResize: true, isText: true, im: st, cv, pageIdx: pi, start: p, orig: { x: st.x, y: st.y, w: st.w, h: st.h } };
				return;
			}
			const ht = hitText(pg, p);
			if (ht) {
				const now = Date.now();
				if (H.sel && H.sel.txtId === ht.id && now - (H.sel.tapAt || 0) < 400) {

					H.sel = { pageIdx: pi, txtId: ht.id, tapAt: 0 };
					openTextEditor(pi, ht.x, ht.y, ht);
					return;
				}
				H.sel = { pageIdx: pi, txtId: ht.id, tapAt: now };
				H.drawing = { pointerId: e.pointerId, imgMove: true, isText: true, im: ht, cv, pageIdx: pi, start: p, orig: { x: ht.x, y: ht.y, w: ht.w, h: ht.h } };
				redrawPage(pi);
				return;
			}

			const im = H.sel && H.sel.pageIdx === pi ? imagesOf(pg).find((i2) => i2.id === H.sel.imgId) : null;
			if (im && nearPoint(p, im.x + im.w, im.y, 16)) {

				pg.images = imagesOf(pg).filter((i2) => i2 !== im);
				pushUndo({ kind: "imgDel", img: im, pageIdx: pi });
				H.sel = null;
				refresh(pi);
				return;
			}
			if (im && nearPoint(p, im.x + im.w, im.y + im.h, 16)) {

				H.drawing = { pointerId: e.pointerId, imgResize: true, im, cv, pageIdx: pi, start: p, orig: { x: im.x, y: im.y, w: im.w, h: im.h } };
				return;
			}
			const hit = hitImage(pg, p);
			if (hit) {
				H.sel = { pageIdx: pi, imgId: hit.id };
				H.drawing = { pointerId: e.pointerId, imgMove: true, im: hit, cv, pageIdx: pi, start: p, orig: { x: hit.x, y: hit.y, w: hit.w, h: hit.h } };
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
				if (H.sel) { const spi = H.sel.pageIdx; H.sel = null; redrawPage(spi); }
			}
			return;
		}
		if (H.sel) { const spi = H.sel.pageIdx; H.sel = null; redrawPage(spi); }
		if (H.tool === "eraser") { H.drawing = { pointerId: e.pointerId, erasing: true, removed: [], cv, ctx: x, pageIdx: pi }; eraseAt(e); }
		else { H.drawing = { pointerId: e.pointerId, tool: H.tool, color: H.color, size: H.size, pts: [p], cv, ctx: x, pageIdx: pi }; armHoldSnap(p); }

		setWriting(true);
	}

	let snapTimer = null;
	function armHoldSnap(p) {
		if (snapTimer) clearTimeout(snapTimer);
		snapTimer = null;
		if (!H.drawing || H.drawing.snapped || H.drawing.laser || !(H.drawing.tool === "pen" || H.drawing.tool === "marker")) return;
		H.drawing.holdAnchor = p;
		snapTimer = setTimeout(trySnapShape, 550);
	}
	function trySnapShape() {
		snapTimer = null;
		if (!H.drawing || H.drawing.snapped || !H.drawing.pts || H.drawing.pts.length < 8) return;
		const shape = fitShape(H.drawing.pts);
		if (!shape) return;
		H.drawing.snapped = shape;
		if (!clearLiveInk(H.drawing.pageIdx)) redrawPage(H.drawing.pageIdx);
		drawStroke(H.drawing.ctx, { tool: "shape", color: H.drawing.color, size: H.drawing.size, pts: [H.drawing.pts[0]], shape });
		if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) {  } }
	}

	function fitShape(pts) {
		return fitStrokeShape(pts);
	}
	function onMove(e) {
		// Ein per Finger gegriffenes Lasso (onDown: "interact") darf sich auch per Finger
		// bewegen — sonst verwarf "Nur Stift" jede Bewegung und die Auswahl blieb stehen.
		if (!H.drawing || !ownsDrawing(e) || (rejected(e) && !H.drawing.byTouch)) return;
		e.preventDefault();
		if (H.drawing.lasso) {
			const p = pos(e, H.drawing.cv);
			const last = H.drawing.pts[H.drawing.pts.length - 1];
			if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= 2.5) {
				H.drawing.pts.push(p);
				if (!clearLiveInk(H.drawing.pageIdx)) redrawPage(H.drawing.pageIdx);
				drawLassoPath(H.drawing.ctx, H.drawing.pts);
			}
			return;
		}
		if (H.drawing.lassoMove) {

			const pm = pos(e, H.drawing.cv);
			const dx = pm[0] - H.drawing.last[0], dy = pm[1] - H.drawing.last[1];
			if (dx || dy) {
				H.drawing.strokes.forEach((s) => translateStroke(s, dx, dy));
				H.drawing.dx += dx; H.drawing.dy += dy; H.drawing.last = pm;
				if (H.lassoSel && H.lassoSel.bounds) {
					H.lassoSel.bounds.minX += dx; H.lassoSel.bounds.maxX += dx;
					H.lassoSel.bounds.minY += dy; H.lassoSel.bounds.maxY += dy;
				}
				redrawNextFrame(H.drawing.pageIdx); // PERF: pro Frame statt pro Pointer-Event
			}
			return;
		}
		if (H.drawing.lassoResize) {
			const p = pos(e, H.drawing.cv);
			const anchor = H.drawing.anchor;
			const startPos = H.drawing.startPos;
			const startDist = H.drawing.startDist;

			// Vektor vom Anker zur Start-Klickposition
			const vx = (startPos[0] - anchor[0]) / startDist;
			const vy = (startPos[1] - anchor[1]) / startDist;

			// Vektor vom Anker zur aktuellen Zeigerposition
			const dx = p[0] - anchor[0];
			const dy = p[1] - anchor[1];

			// Projektion auf die Diagonale: startet bei exakt 1.0 (kein Ruck), wächst/schrumpft kontinuierlich
			const currentDist = dx * vx + dy * vy;

			// Maximaler Faktor, damit die skalierte Box auf der Seite bleibt (Kanten mit Abstand > 0 zum Anker)
			const bb0 = H.drawing.bb;
			let maxFactor = Infinity;
			if (bb0.minX < anchor[0]) maxFactor = Math.min(maxFactor, anchor[0] / (anchor[0] - bb0.minX));
			if (bb0.maxX > anchor[0]) maxFactor = Math.min(maxFactor, (PAGE_W - anchor[0]) / (bb0.maxX - anchor[0]));
			if (bb0.minY < anchor[1]) maxFactor = Math.min(maxFactor, anchor[1] / (anchor[1] - bb0.minY));
			if (bb0.maxY > anchor[1]) maxFactor = Math.min(maxFactor, (PAGE_H - anchor[1]) / (bb0.maxY - anchor[1]));
			// Mindestens 1, falls die Auswahl schon über den Rand ragt (sonst würde sie zwanghaft schrumpfen)
			maxFactor = Math.max(1, maxFactor);

			const factor = Math.max(0.15, Math.min(6.0, maxFactor, currentDist / startDist));

			H.drawing.strokes.forEach((stroke, i) => scaleStrokeFrom(stroke, H.drawing.originals[i], anchor[0], anchor[1], factor));
			H.drawing.factor = factor;
			if (H.lassoSel) H.lassoSel.bounds = lassoBounds(H.drawing.strokes);
			redrawNextFrame(H.drawing.pageIdx);
			return;
		}
		if (H.drawing.snapped) {

			const pSnap = pos(e, H.drawing.cv);
			H.drawing.pts.push(pSnap);
			if (H.drawing.snapped.type === "line") { H.drawing.snapped.x2 = pSnap[0]; H.drawing.snapped.y2 = pSnap[1]; }
			if (!clearLiveInk(H.drawing.pageIdx)) redrawPage(H.drawing.pageIdx);
			drawStroke(H.drawing.ctx, { tool: "shape", color: H.drawing.color, size: H.drawing.size, pts: [H.drawing.pts[0]], shape: H.drawing.snapped });
			return;
		}
		if (H.drawing.imgMove || H.drawing.imgResize) {
			const p = pos(e, H.drawing.cv);
			const dx = p[0] - H.drawing.start[0], dy = p[1] - H.drawing.start[1];
			const im = H.drawing.im, o = H.drawing.orig;
			if (H.drawing.imgMove) {
				im.x = Math.min(PAGE_W - 20, Math.max(20 - im.w, o.x + dx));
				im.y = Math.min(PAGE_H - 20, Math.max(20 - im.h, o.y + dy));
			} else if (H.drawing.isText) {
				im.w = Math.max(120, o.w + dx);
			} else {
				const w = Math.max(40, o.w + dx);
				im.w = w; im.h = w * (o.h / o.w);
			}
			H.drawing.moved = true;
			redrawNextFrame(H.drawing.pageIdx); // PERF: pro Frame statt pro Pointer-Event (Stift feuert öfter als der Bildschirm)
			return;
		}
		if (H.drawing.erasing) { eraseAt(e); return; }

		let evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
		if (!evs || !evs.length) evs = [e];
		const rect = H.drawing.cv.getBoundingClientRect();
		for (const ce of evs) {
			H.drawing.pts.push(pos(ce, H.drawing.cv, rect));
			const n = H.drawing.pts.length;

			const tail = H.drawing.tool === "marker" ? 2 : 3;
			drawStroke(H.drawing.ctx, { tool: H.drawing.tool, color: H.drawing.color, size: H.drawing.size, pts: H.drawing.pts.slice(Math.max(0, n - tail)) });
		}

		const lastP = H.drawing.pts[H.drawing.pts.length - 1];
		if (!H.drawing.holdAnchor || Math.hypot(lastP[0] - H.drawing.holdAnchor[0], lastP[1] - H.drawing.holdAnchor[1]) > 6) armHoldSnap(lastP);
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
		// Hebt der Handballen oder ein zweiter Finger ab, läuft der Strich des Stifts weiter.
		if (H.drawing && e && !ownsDrawing(e)) return;
		if (snapTimer) { clearTimeout(snapTimer); snapTimer = null; }
		lastStrokeAt = Date.now();
		setWriting(false);
		hideEraserRing();
		if (!H.drawing) return;
		const pi = H.drawing.pageIdx;
		const pg = H.doc.pages[pi];
		if (!pg) { H.drawing = null; return; }
		if (H.drawing.lasso) {
			clearLiveInk(pi);
			const poly = H.drawing.pts;
			const hits = selectStrokesByLasso(pg.strokes, poly);
			H.lassoSel = hits.length ? { pageIdx: pi, strokes: hits, bounds: lassoBounds(hits) } : null;
			H.drawing = null; redrawPage(pi); updateChrome(); return;
		}
		if (H.drawing.lassoMove) {
			if (H.drawing.dx || H.drawing.dy) {
				pushUndo({ kind: "lassoMove", strokes: H.drawing.strokes, dx: H.drawing.dx, dy: H.drawing.dy, pageIdx: pi });
				scheduleSave(); renderThumb(pi);
			}
			if (H.lassoSel) H.lassoSel.bounds = lassoBounds(H.drawing.strokes);
			H.drawing = null; redrawPage(pi); updateChrome(); return;
		}
		if (H.drawing.lassoResize) {
			if (Math.abs(H.drawing.factor - 1) > 0.001) {
				pushUndo({ kind: "lassoResize", strokes: H.drawing.strokes, prev: H.drawing.originals, pageIdx: pi });
				scheduleSave(); renderThumb(pi); BUS.emit("heft:schedule-page", { pageId: H.pid, page: pg });
			}
			if (H.lassoSel) H.lassoSel.bounds = lassoBounds(H.drawing.strokes);
			H.drawing = null; redrawPage(pi); updateChrome(); return;
		}
		if (H.drawing.laser) {
			const laserPage = pi;
			const timer = setTimeout(() => { laserTimers.delete(timer); redrawPage(laserPage); }, 900);
			laserTimers.add(timer); H.drawing = null; return;
		}
		if (H.drawing.imgMove || H.drawing.imgResize) {
			const { im, orig, moved } = H.drawing;
			if (moved && (im.x !== orig.x || im.y !== orig.y || im.w !== orig.w)) {
				pushUndo({ kind: "imgMod", im, pageIdx: pi, prev: orig });
				scheduleSave(); renderThumb(pi);
			}
			H.drawing = null;
			updateChrome();
			return;
		}
		if (H.drawing.erasing) {
			if (H.drawing.removed.length) {
				pushUndo({ kind: "erase", removed: H.drawing.removed, pageIdx: pi });
				scheduleSave();
				renderThumb(pi);
			}
		} else {

			// Jeder Strich bekommt eine stabile ID — sie ist der Schlüssel dafür, dass
			// zwei Geräte dieselben Striche als dieselben erkennen und nicht doppeln.
			const stroke = H.drawing.snapped
				? { id: U.uid(), tool: "shape", color: H.drawing.color, size: H.drawing.size, pts: [H.drawing.pts[0], H.drawing.pts[H.drawing.pts.length - 1]], shape: H.drawing.snapped }
				: { id: U.uid(), tool: H.drawing.tool, color: H.drawing.color, size: H.drawing.size, pts: H.drawing.pts };
			strokeBounds(stroke);
			pg.strokes.push(stroke);
			pushUndo({ kind: "add", stroke, pageIdx: pi });
			scheduleSave();

			commitStrokeRender(pi, stroke);
			renderThumb(pi);
			if (H.drawing.tool === "pen" || H.drawing.tool === "marker") BUS.emit("heft:schedule-page", { pageId: H.pid, page: pg });
		}
		H.drawing = null;
		updateChrome();
	}

	// Beim Schließen des Hefts: laufende Timer und Stift-Zustand verwerfen.
	function reset() {
		laserTimers.forEach(clearTimeout); laserTimers.clear();
		activePenPointers.clear();
		if (eraseFrame) { cancelAnimationFrame(eraseFrame); eraseFrame = 0; }
		if (snapTimer) { clearTimeout(snapTimer); snapTimer = null; }
	}
	// Schreibt der Nutzer gerade (Strich läuft, Stift auf dem Glas oder Strich vor < 3,5 s)?
	const isWriting = () => !!(H.drawing || activePenPointers.size > 0 || (Date.now() - lastStrokeAt < 3500));

	return { onDown, onMove, onUp, penRecently, touchNavigates, isWriting, reset };
}
