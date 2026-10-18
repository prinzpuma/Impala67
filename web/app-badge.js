"use strict";

// Zahl am App-Icon: fällige Karten (neu + lernen + wiederholen) wie im Lernen-Tab.
// Nur installierte PWAs zeigen das Badge; ohne Badging-API passiert nichts.

import { STATE } from "./state.js";

const supported = typeof navigator !== "undefined" && "setAppBadge" in navigator;
let last = -1;
let timer = 0;

function dueCount() {
	try {
		const c = STATE.studySnapshot(null).counts;
		return (c.neu || 0) + (c.learn || 0) + (c.review || 0);
	} catch { return 0; }
}

function update() {
	timer = 0;
	const n = dueCount();
	if (n === last) return;
	last = n;
	const p = n ? navigator.setAppBadge(n) : navigator.clearAppBadge();
	p?.catch?.(() => { /* z. B. nicht installiert oder keine Berechtigung */ });
}

// WARUM gebündelt: Beim Lernen kommt pro Bewertung ein Dispatch; der Snapshot ist
// zwar memoisiert, das Badge muss aber nicht öfter als alle 2 s nachziehen.
function schedule() {
	if (!timer) timer = setTimeout(update, 2000);
}

export function startAppBadge() {
	if (!supported) return;
	update();
	STATE.onAfterDispatch(schedule);
	STATE.onRemoteApplied(schedule);
	// Karten werden auch ohne Eingabe fällig (Tageswechsel, Lern-Schritte).
	document.addEventListener("visibilitychange", () => { if (!document.hidden) schedule(); });
	setInterval(schedule, 10 * 60 * 1000);
}
