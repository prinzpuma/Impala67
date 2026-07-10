"use strict";

// popovers.js — eine gemeinsame Steuerung für alle schwebenden Menüs.
// Zentralisiert Positionierung, gegenseitiges Schließen und Außenklick-Erkennung
// für Seiten-/Stapel-Menüs, Topbar-Menüs, Modellwahl und Dateianhänge.

import { S } from "./state.js";
import { U } from "./util.js";

export function position(anchor, menu, opts = {}) {
	if (!anchor || !menu) return;
	const gap = opts.gap == null ? 4 : opts.gap;
	const r = anchor.getBoundingClientRect();
	menu.style.position = "fixed";
	menu.style.visibility = "hidden";
	menu.hidden = false;
	const width = menu.offsetWidth || opts.width || 180;
	const height = menu.offsetHeight || 0;
	let left = opts.align === "end" ? r.right - width : r.left;
	left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
	let top = opts.prefer === "above" ? r.top - height - gap : r.bottom + gap;
	if (top + height > window.innerHeight - 8) top = r.top - height - gap;
	if (top < 8) top = Math.min(window.innerHeight - height - 8, r.bottom + gap);
	menu.style.left = Math.round(left) + "px";
	menu.style.top = Math.round(Math.max(8, top)) + "px";
	menu.style.right = "auto";
	menu.style.bottom = "auto";
	menu.style.visibility = "visible";
}

export function toggleElement(menu, anchor, opts = {}) {
	if (!menu) return false;
	if (!menu.hidden) { menu.hidden = true; return false; }
	// Das gerade geöffnete Composer-Menü aussparen; alle anderen Varianten
	// (auch Modell-Menüs im jeweils anderen Chat) werden zuverlässig geschlossen.
	closeAll("attach");
	position(anchor, menu, opts);
	return true;
}

// Schließt alle anderen Menüs, wenn ein neues geöffnet wird.
export function closeAll(except = "") {
	const changed = { model: false, sidebar: false, main: false, attach: false };
	const attach = U.el("attachMenu");
	if (except !== "attach" && attach && !attach.hidden) { attach.hidden = true; changed.attach = true; }
	if (except !== "model") {
		// Modell-Menüs werden normalerweise über den Render-State gesteuert. Beim
		// Öffnen des Anhang-Menüs gibt es aber kein komplettes Re-Render — deshalb
		// beide DOM-Varianten hier sofort ausblenden, damit sie nie überlappen.
		[U.el("modelMenu"), U.el("modelMenuFull")].forEach((menu) => {
			if (menu && !menu.hidden) menu.hidden = true;
		});
		if (S.modelMenuOpen) { S.modelMenuOpen = false; changed.model = true; }
	}
	if (except !== "page" && S.pageMenuOpenId) { S.pageMenuOpenId = null; changed.sidebar = true; }
	if (except !== "deck" && S.deckMenuOpenName) { S.deckMenuOpenName = null; changed.sidebar = true; }
	if (except !== "top" && S.topMenu) { S.topMenu = null; changed.main = true; }
	return changed;
}

export function closeOutside(target) {
	const keep = target && target.closest
		? target.closest("#attachMenu,#btnAttach,#btnAttachFull") ? "attach"
		: target.closest(".model-menu,#btnModelMenu,#btnModelChipFull") ? "model"
		: target.closest("[data-pagemenu]") ? "page"
		: target.closest("[data-deckmenu]") ? "deck"
		: target.closest(".page-menu:not(.top-menu)") ? (S.pageMenuOpenId ? "page" : "deck")
		: target.closest(".top-menu,[data-sharemenu],[data-morepagemenu]") ? "top"
		: ""
		: "";
	const changed = closeAll(keep);
	return changed;
}

export const POPOVERS = { position, toggleElement, closeAll, closeOutside };