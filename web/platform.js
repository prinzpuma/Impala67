"use strict";

// == 🖐️ EINE Definition von „Touch“ (28. Juli) ==
// Vorher fragten vier Stellen unterschiedlich: max-width 700px, max-width 768px,
// (pointer: coarse), (hover: none). iPadOS meldet im Desktop-Modus hover:hover/pointer:fine —
// das iPad galt je nach Stelle mal als Handy, mal als Maus-Gerät. Quelle der Wahrheit ist
// jetzt diese Abfrage; das CSS liest das Ergebnis als body.is-touch.
// Eigenes Modul, damit alle Stellen es direkt importieren statt über window.PLATFORM zu gehen.

// Ohne Browser (Node-Tests) gibt es kein matchMedia/document: dann gilt „kein Touch“.
const query = (q) => (typeof matchMedia === "function" ? matchMedia(q) : { matches: false, addEventListener() {} });
const MQ_TOUCH = query("(pointer: coarse), (hover: none)");

export const PLATFORM = {
	isTouch: () => MQ_TOUCH.matches || (typeof navigator !== "undefined" && navigator.maxTouchPoints > 1),
	isIOS: () => typeof navigator !== "undefined" && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && Number(navigator.maxTouchPoints || 0) > 1)),
	isStandalone: () => typeof window !== "undefined" && !!(window.navigator?.standalone || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)),
	sync() {
		if (typeof document === "undefined" || !document.body) return;
		document.body.classList.toggle("is-touch", PLATFORM.isTouch());
		document.body.classList.toggle("is-ios", PLATFORM.isIOS());
		document.body.classList.toggle("is-standalone", PLATFORM.isStandalone());
	},
};
MQ_TOUCH.addEventListener("change", PLATFORM.sync);
PLATFORM.sync();
