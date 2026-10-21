"use strict";

// Kleine UI-Helfer, die app.js und die app-click-*-Module gemeinsam nutzen.

import { S } from "./state.js";
import { U } from "./util.js";
import { RENDER } from "./render.js";
import { PLATFORM } from "./platform.js";
import { blurActive } from "./popovers.js";

// FIX (Absturz "e.target.closest is not a function"): e.target ist NICHT immer ein
// Element. Bei Tastatur-, Fokus- und Drag-Ereignissen kann es das Dokument selbst
// oder ein Textknoten sein — dort gibt es weder closest() noch dataset. Statt 20
// Einzelabfragen gibt es genau zwei Helfer, die alle Delegations-Listener nutzen.
export const closestOf = (e, sel) => { const t = e && e.target; return t && t.nodeType === 1 && t.closest ? t.closest(sel) : null; };
export const dsOf = (e) => (e && e.target && e.target.dataset) || {};
export { blurActive };
export const closeTopMenu = () => { if (S.topMenu) { S.topMenu = null; RENDER.renderMain(); } };
export const focusPageTitle = () => {
	if (PLATFORM.isTouch()) return;
	const ti = U.el("pageTitle");
	if (ti) {
		ti.focus();
		ti.select();
	}
};
