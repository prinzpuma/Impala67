"use strict";

// == 🖐️ EINE Definition von „Touch“ und „Handy“ (28. Juli) ==
// Vorher fragten vier Stellen unterschiedlich: max-width 700px, max-width 768px,
// (pointer: coarse), (hover: none). iPadOS meldet im Desktop-Modus hover:hover/pointer:fine —
// das iPad galt je nach Stelle mal als Handy, mal als Maus-Gerät. Quelle der Wahrheit sind
// jetzt diese zwei Abfragen; das CSS liest das Ergebnis als body.is-touch / body.is-phone.
// Eigenes Modul, damit alle Stellen es direkt importieren statt über window.PLATFORM zu gehen.

import { PLATFORM_NATIVE } from "./platform-native.js";

// Ohne Browser (Node-Tests) gibt es kein matchMedia/document: dann gilt „kein Touch, kein Handy“.
const query = (q) => (typeof matchMedia === "function" ? matchMedia(q) : { matches: false, addEventListener() {} });
const MQ_PHONE = query("(max-width: 700px), (pointer: coarse) and (max-height: 500px)");
const MQ_TOUCH = query("(pointer: coarse), (hover: none)");

export const PLATFORM = {
	phoneQuery: MQ_PHONE,
	isPhone: () => MQ_PHONE.matches,
	isTouch: () => MQ_TOUCH.matches || (typeof navigator !== "undefined" && navigator.maxTouchPoints > 1),
	isIOS: () => typeof navigator !== "undefined" && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && Number(navigator.maxTouchPoints || 0) > 1)),
	isStandalone: () => typeof window !== "undefined" && !!(window.navigator?.standalone || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)),
	sync() {
		if (typeof document === "undefined" || !document.body) return;
		document.body.classList.toggle("is-touch", PLATFORM.isTouch());
		document.body.classList.toggle("is-phone", PLATFORM.isPhone());
		document.body.classList.toggle("is-ios", PLATFORM.isIOS());
		document.body.classList.toggle("is-standalone", PLATFORM.isStandalone());
		document.body.classList.toggle("is-native", PLATFORM_NATIVE.isNative);
	},
	native: PLATFORM_NATIVE,
};
for (const q of [MQ_PHONE, MQ_TOUCH]) q.addEventListener("change", PLATFORM.sync);
PLATFORM.sync();
