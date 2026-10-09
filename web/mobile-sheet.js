"use strict";
import { MOBILE_VIEW } from "./mobile-view.js"; // MOBILE_VIEW.icon("x") → SVG-String

const CHANGE_EVENT = "msheet:change";
const CLOSE_DELAY_MS = 300;
const DRAG_CLOSE_DISTANCE = 90;
const DRAG_CLOSE_VELOCITY = 0.5; // px/ms

let scrimEl = null;
let sheetEl = null;
let titleEl = null;
let bodyEl = null;
let closeBtnEl = null;
let keyBound = false;

let isOpenNow = false;
let onCloseFn = null;
let returnFocusEl = null;
let clearTimer = 0;

// Wischgeste: kind = "pointer" (Griff/Kopf) oder "touch" (Body, ganz oben gescrollt)
let drag = null;
let touchStartY = null;

function isOpen() {
	return isOpenNow;
}

function notifyChange() {
	document.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

function setContent(title, html) {
	titleEl.textContent = String(title ?? "");
	bodyEl.innerHTML = String(html ?? "");
	bodyEl.scrollTop = 0;
}

function resetInlineStyle() {
	if (!sheetEl) return;
	sheetEl.style.transform = "";
	sheetEl.style.transition = "";
}

// ---------- Lazy DOM ----------

function ensure() {
	if (sheetEl) return;

	scrimEl = document.createElement("div");
	scrimEl.id = "mSheetScrim";
	scrimEl.className = "m-scrim";

	sheetEl = document.createElement("div");
	sheetEl.id = "mSheet";
	sheetEl.className = "m-sheet";
	sheetEl.setAttribute("role", "dialog");
	sheetEl.setAttribute("aria-modal", "true");
	sheetEl.setAttribute("aria-labelledby", "mSheetTitle");
	sheetEl.innerHTML =
		'<div class="m-sheet-grip" aria-hidden="true"></div>' +
		'<div class="m-sheet-head"><strong id="mSheetTitle" class="m-sheet-title"></strong>' +
		'<button type="button" class="m-iconbtn" data-msheetclose aria-label="Schließen">' +
		MOBILE_VIEW.icon("x") +
		"</button></div>" +
		'<div class="m-sheet-body"></div>';

	titleEl = sheetEl.querySelector(".m-sheet-title");
	bodyEl = sheetEl.querySelector(".m-sheet-body");
	closeBtnEl = sheetEl.querySelector("[data-msheetclose]");

	scrimEl.addEventListener("click", () => close());
	sheetEl.addEventListener("click", onSheetClick);
	sheetEl.addEventListener("pointerdown", onPointerDown);
	sheetEl.addEventListener("pointermove", onPointerMove);
	sheetEl.addEventListener("pointerup", onPointerEnd);
	sheetEl.addEventListener("pointercancel", onPointerEnd);
	bodyEl.addEventListener("touchstart", onTouchStart, { passive: true });
	bodyEl.addEventListener("touchmove", onTouchMove, { passive: true });
	bodyEl.addEventListener("touchend", onTouchEnd, { passive: true });
	bodyEl.addEventListener("touchcancel", onTouchEnd, { passive: true });

	if (!keyBound) {
		keyBound = true;
		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape" && isOpen()) close();
		});
	}

	document.body.append(scrimEl, sheetEl);
}

// ---------- Klicks ----------

function onSheetClick(e) {
	const target = e.target;
	if (!(target instanceof Element)) return;

	if (target.closest("[data-msheetclose]")) {
		setTimeout(close, 0);
		return;
	}

	// Aktion im Body: erst nach dem Klick schließen, damit die globalen Handler in app.js noch laufen.
	const control = target.closest("button, a");
	if (!control || !bodyEl.contains(control)) return;
	if (control.hasAttribute("data-mkeep") || control.closest("[data-mkeep]")) return;
	setTimeout(close, 0);
}

// ---------- Wischen nach unten ----------

function beginDrag(kind, y, time) {
	drag = { kind, y0: y, lastY: y, lastT: time, dy: 0, v: 0 };
}

function moveDrag(kind, y, time) {
	if (!drag || drag.kind !== kind) return;
	const dt = time - drag.lastT;
	if (dt > 0) drag.v = (y - drag.lastY) / dt;
	drag.lastY = y;
	drag.lastT = time;

	const dy = Math.max(0, y - drag.y0);
	drag.dy = dy;
	if (dy > 0) {
		sheetEl.style.transition = "none";
		sheetEl.style.transform = `translateY(${dy}px)`;
	}
}

function endDrag(kind) {
	if (!drag || drag.kind !== kind) return;
	const { dy, v } = drag;
	drag = null;
	resetInlineStyle();
	if (dy > 0 && (dy > DRAG_CLOSE_DISTANCE || v > DRAG_CLOSE_VELOCITY)) close();
}

function onPointerDown(e) {
	if (drag || !isOpen() || e.button !== 0) return;
	const target = e.target;
	if (!(target instanceof Element)) return;
	if (target.closest("button, a, input, select, textarea")) return;
	if (!target.closest(".m-sheet-grip, .m-sheet-head")) return;

	beginDrag("pointer", e.clientY, e.timeStamp);
	try {
		sheetEl.setPointerCapture(e.pointerId);
	} catch (_) {
		// Ohne Pointer-Capture funktioniert das Wischen trotzdem, nur weniger zuverlässig.
	}
}

function onPointerMove(e) {
	moveDrag("pointer", e.clientY, e.timeStamp);
}

function onPointerEnd() {
	endDrag("pointer");
}

function onTouchStart(e) {
	touchStartY = null;
	if (!isOpen() || drag || e.touches.length !== 1) return;
	if (bodyEl.scrollTop > 0) return;
	touchStartY = e.touches[0].clientY;
}

function onTouchMove(e) {
	if (touchStartY === null || e.touches.length !== 1) return;
	const y = e.touches[0].clientY;
	if (!drag) {
		if (bodyEl.scrollTop > 0) {
			touchStartY = null;
			return;
		}
		if (y - touchStartY <= 0) return;
		beginDrag("touch", touchStartY, e.timeStamp);
	}
	moveDrag("touch", y, e.timeStamp);
}

function onTouchEnd() {
	touchStartY = null;
	endDrag("touch");
}

// ---------- Öffentliche API ----------

function open({ title = "", html = "", onClose = null } = {}) {
	ensure();
	clearTimeout(clearTimer);

	if (isOpen()) {
		// Inhalt ersetzen; das vorherige onClose wird bewusst NICHT aufgerufen.
		setContent(title, html);
		onCloseFn = typeof onClose === "function" ? onClose : null;
		return;
	}

	const active = document.activeElement;
	returnFocusEl = active instanceof HTMLElement && !sheetEl.contains(active) ? active : null;

	setContent(title, html);
	onCloseFn = typeof onClose === "function" ? onClose : null;
	isOpenNow = true;

	document.body.classList.add("m-sheet-open");
	requestAnimationFrame(() => {
		if (!isOpen() || !sheetEl) return;
		scrimEl.classList.add("is-open");
		sheetEl.classList.add("is-open");
	});

	try {
		closeBtnEl.focus({ preventScroll: true });
	} catch (_) {
		// Fokus ist nur Komfort.
	}
	notifyChange();
}

function close() {
	if (!isOpen()) return;
	isOpenNow = false;
	drag = null;
	touchStartY = null;

	scrimEl.classList.remove("is-open");
	sheetEl.classList.remove("is-open");
	resetInlineStyle();
	document.body.classList.remove("m-sheet-open");
	clearTimeout(clearTimer);

	const callback = onCloseFn;
	onCloseFn = null;
	if (callback) {
		try {
			callback();
		} catch (err) {
			console.warn("mobile-sheet: onClose fehlgeschlagen", err);
		}
	}

	// Falls onClose sofort wieder ein Sheet geöffnet hat, nichts zurücksetzen.
	if (!isOpen()) {
		clearTimer = setTimeout(() => {
			if (!isOpen() && bodyEl) bodyEl.innerHTML = "";
		}, CLOSE_DELAY_MS);

		const back = returnFocusEl;
		returnFocusEl = null;
		if (back && back.isConnected) {
			try {
				back.focus({ preventScroll: true });
			} catch (_) {
				// Fokus ist nur Komfort.
			}
		}
	}

	notifyChange();
}

function isSheetOpen() {
	return isOpen();
}

function destroy() {
	clearTimeout(clearTimer);
	const wasOpen = isOpen();

	isOpenNow = false;
	drag = null;
	touchStartY = null;
	document.body.classList.remove("m-sheet-open");

	const callback = onCloseFn;
	onCloseFn = null;
	if (wasOpen && callback) {
		try {
			callback();
		} catch (err) {
			console.warn("mobile-sheet: onClose fehlgeschlagen", err);
		}
	}

	if (scrimEl) scrimEl.remove();
	if (sheetEl) sheetEl.remove();
	scrimEl = null;
	sheetEl = null;
	titleEl = null;
	bodyEl = null;
	closeBtnEl = null;
	returnFocusEl = null;

	if (wasOpen) notifyChange();
}

export const MOBILE_SHEET = Object.freeze({ open, close, isOpen: isSheetOpen, destroy });
