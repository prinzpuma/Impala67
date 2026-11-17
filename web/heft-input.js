"use strict";

// Stift- und Maus-Eingabe im Heft: Zeichnen, Radieren, Laser, Lasso (Auswählen,
// Verschieben, Skalieren), Bilder/Textfelder direkt antippen bzw. halten und die
// Formerkennung beim Halten.
// Aus heft.js herausgelöst. Gemeinsamer Zustand (Dokument, Werkzeug, Auswahl, laufender
// Strich) bleibt in heft.js und kommt über die Getter/Setter von H herein; was nur die
// Eingabe braucht (aktive Stifte, Laser-Timer, Doppeltipp, Radierer-Frame) lebt hier.

import { U } from "./util.js";
import { PAGE_W, PAGE_H } from "./heft-document-core.js";
import { fitStrokeShape, hitBox, strokeBounds, strokeGeometry, applyGeometries, packStrokes, nearPoint } from "./heft-geometry.js";
import { CORE } from "./rust-core.js";
import { lassoBounds, selectStrokesByLasso, lassoTouchAction, hitLassoHandle, isLassoBodyHit, drawLassoPath } from "./heft-lasso.js";

export function createHeftInput(H) {
	const { vp, imagesOf, textsOf, hitText, redrawPage, updateChrome, dropLasso, pushUndo, refresh, openTextEditor, setWriting, drawStroke, scheduleSave, renderThumb } = H;
	const { stopAnim, applyTouchAction, gesture, PALM_UNDO_MS, liveInkCtx, clearLiveInk, commitStrokeRender } = vp;
	const activePenPointers = new Set();
	let lastPenUpAt = 0, lastStrokeAt = 0;
	const PEN_GRACE_MS = 400;
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
	const touchNavigates = () => H.viewOnly || (H.onlyPen && !penRecently());
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
		const p0 = pos(e, H.drawing.cv), pg = H.doc.pages[H.drawing.pageIdx];
		showEraserRing(e);
		// Der Radierer des Kerns kennt die Striche der Seite seit Gestenbeginn; Mini-Schritte
		// (unter 35 % des Radius) prüft er nicht erneut.
		const hit = H.drawing.eraser.eraseAt(p0[0], p0[1]);
		if (hit.length) {
			const ids = new Set(Array.from(hit, (i) => H.drawing.eraseList[i].id));
			const removed = pg.strokes.filter((s) => ids.has(s.id));
			pg.strokes = pg.strokes.filter((s) => !ids.has(s.id)); H.drawing.removed.push(...removed);
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
		if (!H.doc || H.viewOnly) return;
		// Zweiter Finger während eines Finger-Strichs: Das ist ein Pinch, kein Strich. Den
		// angefangenen Strich verwerfen – sonst landeten beide Finger als Zickzack darin.
		if (H.drawing && H.drawing.pts && !H.drawing.lasso && H.drawing.pointerType === "touch" && e.pointerType === "touch" && H.drawing.pointerId !== e.pointerId) {
			const pi0 = H.drawing.pageIdx;
			if (snapTimer) { clearTimeout(snapTimer); snapTimer = null; }
			H.drawing = null;
			setWriting(false);
			if (!clearLiveInk(pi0)) redrawPage(pi0);
			return;
		}
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
			// Kurz nach dem Stift ist eine Berührung der Handballen – nicht „Lasso beenden“.
			if (penRecently()) return;
			H.tool = "pen"; H.expanded = true;
			updateChrome();
			return;
		}
		if (grabSelection(e, cv, pg, pi, p)) return;
		if (rejected(e) && touchLasso !== "interact") {
			// „Nur Stift“: Finger blättert; ein Tipp wählt Bild/Text aus, Halten auch Scans.
			// Ein zweiter Finger (Zoom, Rückgängig) ist kein Tipp.
			if (e.pointerType === "touch" && !penRecently() && pickable()) {
				if (pick) cancelPick();
				else armPick(e, cv, pg, pi, p, objectAt(pg, p), true);
			}
			return;
		}
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
						pointerId: e.pointerId, pointerType: e.pointerType, pageId: pg.id,
						lassoResize: true,
						byTouch: e.pointerType === "touch",
						strokes: H.lassoSel.strokes,
						originals: H.lassoSel.strokes.map(strokeGeometry),
						transform: new CORE.HeftTransform(...packStrokes(H.lassoSel.strokes)),
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
					H.drawing = { pointerId: e.pointerId, pointerType: e.pointerType, pageId: pg.id, lassoMove: true, byTouch: e.pointerType === "touch", strokes: H.lassoSel.strokes, transform: new CORE.HeftTransform(...packStrokes(H.lassoSel.strokes)), bounds0: { ...bb }, cv, pageIdx: pi, start: p, dx: 0, dy: 0 };
					return;
				}
			}

			// Neue Auswahl: alte Markierung sofort wegräumen (lag sie auf einer anderen
			// Seite, blieb ihr Rahmen dort sonst als Geist stehen).
			dropLasso();
			H.drawing = { pointerId: e.pointerId, pointerType: e.pointerType, pageId: pg.id, lasso: true, pts: [p], cv, ctx: x, pageIdx: pi };
			return;
		}
		if (H.tool === "laser") {

			H.drawing = { pointerId: e.pointerId, pointerType: e.pointerType, pageId: pg.id, laser: true, tool: "pen", color: "#ef4444", size: 7, pts: [p], cv, ctx: x, pageIdx: pi };
			return;
		}
		if (H.sel) { const spi = H.sel.pageIdx; H.sel = null; redrawPage(spi); }
		if (H.tool === "eraser") { H.drawing = { pointerId: e.pointerId, pointerType: e.pointerType, pageId: pg.id, erasing: true, removed: [], eraseList: pg.strokes.slice(), eraser: new CORE.HeftEraser(...packStrokes(pg.strokes), H.eraserSize), cv, ctx: x, pageIdx: pi }; eraseAt(e); }
		else {
			H.drawing = { pointerId: e.pointerId, pointerType: e.pointerType, pageId: pg.id, tool: H.tool, color: H.color, size: H.size, pts: [p], cv, ctx: x, pageIdx: pi }; armHoldSnap(p);
			// Finger (wenn er zeichnet) oder Maus: Halten auf Bild/Text wählt es aus statt zu zeichnen.
			const obj = e.pointerType !== "pen" && (H.tool === "pen" || H.tool === "marker") ? objectAt(pg, p) : null;
			if (obj) armPick(e, cv, pg, pi, p, obj, false);
		}

		setWriting(true);
	}

	// ── Bilder & Texte direkt auswählen ──
	// Mit „Nur Stift“ wählt ein Fingertipp aus, sonst (Finger zeichnet, Maus) das Halten.
	// Eine bestehende Auswahl greift jeder Zeiger: Griff oben rechts löscht, unten rechts
	// skaliert, die Fläche verschiebt; Antippen eines ausgewählten Texts bearbeitet ihn.
	const PICK_HOLD_MS = 450, PICK_SLOP_PX = 8;
	let pick = null;
	const pickable = () => H.tool !== "lasso" && H.tool !== "laser";
	// Seitenfüllende Bilder (Scans, PDF-Seiten) nur per Halten – sonst griffe jeder Tipp die Seite.
	const pageSized = (im) => im.w * im.h > PAGE_W * PAGE_H * 0.6;
	function objectAt(pg, p) {
		const t = hitText(pg, p);
		if (t) return { im: t, isText: true };
		const im = hitImage(pg, p);
		return im ? { im, isText: false } : null;
	}
	function selectObject(pi, obj) {
		const old = H.sel && H.sel.pageIdx;
		H.sel = obj.isText ? { pageIdx: pi, txtId: obj.im.id } : { pageIdx: pi, imgId: obj.im.id };
		if (old != null && old !== pi) redrawPage(old);
		redrawPage(pi);
		updateChrome();
	}
	function clearSelection() {
		if (!H.sel) return;
		const spi = H.sel.pageIdx; H.sel = null; redrawPage(spi); updateChrome();
	}
	function grabObject(e, cv, pg, pi, start, obj, extra) {
		const im = obj.im;
		try { cv.setPointerCapture(e.pointerId); } catch {  }
		H.idx = pi;
		H.drawing = { pointerId: e.pointerId, pointerType: e.pointerType, pageId: pg.id, byTouch: e.pointerType === "touch", im, isText: obj.isText, cv, pageIdx: pi, start, orig: { x: im.x, y: im.y, w: im.w, h: im.h }, imgMove: true, ...extra };
	}
	function grabSelection(e, cv, pg, pi, p) {
		if (!H.sel || H.sel.pageIdx !== pi || !pickable() || (e.pointerType === "touch" && penRecently())) return false;
		const isText = !!H.sel.txtId;
		const im = isText ? textsOf(pg).find((t) => t.id === H.sel.txtId) : imagesOf(pg).find((i) => i.id === H.sel.imgId);
		if (!im) return false;
		const tol = e.pointerType === "touch" ? 22 : 16, h = im.h || 60;
		if (nearPoint(p, im.x + im.w, im.y, tol)) {
			e.preventDefault();
			if (isText) { pg.texts = textsOf(pg).filter((t) => t !== im); pushUndo({ kind: "txtDel", txt: im, pageIdx: pi }); }
			else { pg.images = imagesOf(pg).filter((i) => i !== im); pushUndo({ kind: "imgDel", img: im, pageIdx: pi }); }
			H.sel = null;
			refresh(pi);
			return true;
		}
		const resize = nearPoint(p, im.x + im.w, im.y + h, tol);
		if (!resize && !hitBox([{ x: im.x, y: im.y, w: im.w, h }], p)) return false;
		e.preventDefault();
		grabObject(e, cv, pg, pi, p, { im, isText }, resize ? { imgMove: false, imgResize: true } : { tapEdit: isText });
		return true;
	}
	function armPick(e, cv, pg, pi, p, obj, nav) {
		cancelPick();
		pick = { pointerId: e.pointerId, pointerType: e.pointerType, cx: e.clientX, cy: e.clientY, t: Date.now(), cv, pg, pi, p, obj, nav };
		if (obj) pick.timer = setTimeout(() => holdPick(e), PICK_HOLD_MS);
	}
	function cancelPick() {
		if (pick && pick.timer) clearTimeout(pick.timer);
		pick = null;
	}
	function holdPick(e) {
		const pk = pick; pick = null;
		if (!pk || !H.doc || H.doc.pages[pk.pi] !== pk.pg) return;
		if (!pk.nav) {
			// Angefangenen Strich verwerfen – das Halten war ein Griff, kein Punkt.
			if (!H.drawing || H.drawing.pointerId !== pk.pointerId || !H.drawing.pts) return;
			if (snapTimer) { clearTimeout(snapTimer); snapTimer = null; }
			H.drawing = null;
			clearLiveInk(pk.pi);
		}
		selectObject(pk.pi, pk.obj);
		grabObject(e, pk.cv, pk.pg, pk.pi, pk.p, pk.obj, {});
		if (navigator.vibrate) { try { navigator.vibrate(12); } catch {  } }
	}
	function movePick(e) {
		if (pick && e.pointerId === pick.pointerId && Math.hypot(e.clientX - pick.cx, e.clientY - pick.cy) > PICK_SLOP_PX) cancelPick();
	}
	function endPick(e) {
		if (!pick || !e || e.pointerId !== pick.pointerId) return;
		const pk = pick; cancelPick();
		if (!pk.nav || e.type !== "pointerup" || Date.now() - pk.t > PICK_HOLD_MS) return;
		if (pk.obj && !pageSized(pk.obj.im)) selectObject(pk.pi, pk.obj);
		else clearSelection();
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
		movePick(e);
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
			const dx = pm[0] - H.drawing.start[0], dy = pm[1] - H.drawing.start[1];
			if (dx !== H.drawing.dx || dy !== H.drawing.dy) {
				applyGeometries(H.drawing.strokes, H.drawing.transform.moveBy(dx, dy));
				H.drawing.dx = dx; H.drawing.dy = dy;
				const b = H.drawing.bounds0;
				if (H.lassoSel) H.lassoSel.bounds = { minX: b.minX + dx, maxX: b.maxX + dx, minY: b.minY + dy, maxY: b.maxY + dy };
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

			applyGeometries(H.drawing.strokes, H.drawing.transform.scaleBy(anchor[0], anchor[1], factor));
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
		endPick(e);
		// Hebt der Handballen oder ein zweiter Finger ab, läuft der Strich des Stifts weiter.
		if (H.drawing && e && !ownsDrawing(e)) return;
		if (snapTimer) { clearTimeout(snapTimer); snapTimer = null; }
		lastStrokeAt = Date.now();
		setWriting(false);
		hideEraserRing();
		if (!H.drawing) return;
		// Seite per ID: Eine Fremdänderung während der Geste (neue Seite davor) verschiebt Indizes.
		const pi = H.drawing.pageId ? H.doc.pages.findIndex((page) => page.id === H.drawing.pageId) : H.drawing.pageIdx;
		const pg = H.doc.pages[pi];
		if (!pg) { H.drawing = null; return; }
		H.drawing.pageIdx = pi;
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
				scheduleSave(); renderThumb(pi);
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
			const { im, orig, tapEdit } = H.drawing;
			// Kaum bewegt = Antippen: ein ausgewählter Text öffnet sich zum Bearbeiten.
			if (tapEdit && Math.hypot(im.x - orig.x, im.y - orig.y) < 4) {
				im.x = orig.x; im.y = orig.y;
				H.drawing = null;
				openTextEditor(pi, im.x, im.y, im);
				return;
			}
			if (H.drawing.moved && (im.x !== orig.x || im.y !== orig.y || im.w !== orig.w)) {
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
		cancelPick();
	}
	// Schreibt der Nutzer gerade (Strich läuft, Stift auf dem Glas oder Strich vor < 3,5 s)?
	const isWriting = () => !!(H.drawing || activePenPointers.size > 0 || (Date.now() - lastStrokeAt < 3500));

	return { onDown, onMove, onUp, penRecently, touchNavigates, isWriting, reset };
}
