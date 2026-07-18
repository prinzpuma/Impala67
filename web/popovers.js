"use strict";

// popovers.js — eine gemeinsame Steuerung für alle schwebenden Menüs.
// Zentralisiert Positionierung, gegenseitiges Schließen, Außenklick-Erkennung
// und kleine Fokus-Helfer für Seiten-/Stapel-Menüs, Topbar-Menüs, Modellwahl
// und Dateianhänge — EIN Ort für alle wiederkehrenden Popover-Muster.

import { S } from "./state.js";
import { U } from "./util.js";

// Positioniert `menu` (fixed) relativ zu `anchor`, bleibt innerhalb des Viewports.
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

// Errät aus der Element-ID, welcher closeAll()-Kategorie ein Menü/Auslöser
// angehört — so muss jede Aufrufstelle von toggleElement() den Typ nicht selbst kennen.
function guessCategory(el) {
	const id = (el && el.id) || "";
	if (/model/i.test(id)) return "model";
	if (/attach/i.test(id)) return "attach";
	return "";
}

// Generischer Auf/Zu-Umschalter für ein Popover: schließt beim Öffnen alle
// ANDEREN Popover (nie sich selbst) und positioniert relativ zum Auslöser.
// FIX: `except` war früher hart auf "attach" gesetzt — jedes Menü, das über
// toggleElement lief (z.B. das Modell-Menü), schloss dadurch fälschlich nicht
// das Anhang-Menü ("Menü schließt sich nicht"). Jetzt wird die eigene
// Kategorie automatisch erkannt (Menü- oder Anker-ID) bzw. per opts.except
// explizit übergeben, und nur die WIRKLICH anderen Popover werden geschlossen.
export function toggleElement(menu, anchor, opts = {}) {
	if (!menu) return false;
	if (!menu.hidden) { menu.hidden = true; return false; }
	closeAll(opts.except || guessCategory(menu) || guessCategory(anchor));
	position(anchor, menu, opts);
	return true;
}

// Schließt alle Popover-Kategorien außer der in `except` genannten.
export function closeAll(except = "") {
	const changed = { model: false, sidebar: false, main: false, attach: false };
	const attach = U.el("attachMenu");
	if (except !== "attach" && attach && !attach.hidden) { attach.hidden = true; changed.attach = true; }
	if (except !== "model") {
		// Modell-Menüs werden normalerweise über den Render-State gesteuert. Beim
		// Öffnen eines anderen Menüs gibt es aber kein komplettes Re-Render —
		// deshalb beide DOM-Varianten hier sofort ausblenden, damit sie nie überlappen.
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

// Ermittelt aus einem Klick-Ziel, welche Popover-Kategorie offen bleiben soll.
export function closeOutside(target) {
	const keep = target && target.closest
		? target.closest("#attachMenu,#btnAttach,#btnAttachFull") ? "attach"
		: target.closest(".model-menu,#btnModelMenu,#btnModelChipFull") ? "model"
		// Stapel-⋯ und sein Panel MÜSSEN vor dem generischen .page-menu stehen,
		// sonst schließt closeAll das Stapel-Menü beim Klick auf „In Papierkorb“.
		: target.closest("[data-deckmenu],[data-deckmenu-panel],[data-deckdel],[data-deckrename],[data-deckduplicate]") ? "deck"
		: target.closest("[data-pagemenu]") ? "page"
		: target.closest(".page-menu:not(.top-menu)") ? (S.deckMenuOpenName ? "deck" : "page")
		: target.closest(".top-menu,[data-sharemenu],[data-morepagemenu]") ? "top"
		: ""
		: "";
	return closeAll(keep);
}

// Kleiner, wiederkehrender Fokus-Helfer: Notion blendet die Text-/Eingabe-
// Auswahl konsequent aus, sobald eine Navigations- oder Menü-Aktion ausgeführt
// wird — vorher war das in jedem Modul einzeln als "if (document.activeElement)
// document.activeElement.blur();" nachgebaut (siehe tabs.js).
export function blurActive() {
	const ae = document.activeElement;
	if (ae && typeof ae.blur === "function") ae.blur();
}

// 🪟 Außenklick auf den abgedunkelten Hintergrund schließt jedes Overlay-Modal
// (Einstellungen, Dialoge, Verlauf …) — vorher blieb z. B. das Einstellungsfenster
// stehen, bis man das ✕ traf. Der Klick zählt nur, wenn er WIRKLICH auf dem
// Hintergrund startet (nicht in der Modal-Box), damit kein Dialog beim
// Verwischen einer Textauswahl verschwindet.
document.addEventListener("pointerdown", (e) => {
	const o = document.getElementById("overlay");
	if (!o || o.hidden || e.target !== o) return;
	const x = o.querySelector("#btnCloseOverlay");
	if (x) x.click();
	else { o.hidden = true; o.innerHTML = ""; }
}, true);

// 👆 Kontextmenüs aufgepeppt: Rechtsklick (Maus) oder langer Druck (iPad/Stift)
// auf eine Zeile öffnet direkt deren ⋯-Menü — überall dort, wo die Zeile schon
// einen Menü-Knopf besitzt (Seiten- und Stapelzeilen in Sidebar & Listen).
function rowMenuButton(target) {
	const row = target && target.closest ? target.closest(".row,.tree-row,.home-list-row,.lib-card,.deck-row") : null;
	return row ? row.querySelector("[data-pagemenu],[data-deckmenu]") : null;
}
function openRowMenu(btn) {
	if (!btn) return false;
	if (navigator.vibrate) { try { navigator.vibrate(10); } catch { /* egal */ } }
	btn.click();
	return true;
}
document.addEventListener("contextmenu", (e) => {
	const btn = rowMenuButton(e.target);
	if (btn) { e.preventDefault(); openRowMenu(btn); }
});
// Langer Druck (550 ms, max. 10 px Bewegung) als Rechtsklick-Ersatz für Touch/Stift.
let lpTimer = null, lpStart = null, lpFired = false;
document.addEventListener("pointerdown", (e) => {
	if (e.pointerType === "mouse") return;
	const btn = rowMenuButton(e.target);
	if (!btn) return;
	lpStart = { x: e.clientX, y: e.clientY };
	lpFired = false;
	clearTimeout(lpTimer);
	// Erst das Menü öffnen, DANN lpFired setzen — sonst würde der synthetische
	// btn.click() vom Schlucker unten gleich wieder verschluckt.
	lpTimer = setTimeout(() => { openRowMenu(btn); lpFired = true; lpTimer = null; }, 550);
}, true);
document.addEventListener("pointermove", (e) => {
	if (lpTimer && lpStart && Math.hypot(e.clientX - lpStart.x, e.clientY - lpStart.y) > 10) { clearTimeout(lpTimer); lpTimer = null; }
}, true);
["pointerup", "pointercancel"].forEach((type) => document.addEventListener(type, () => { clearTimeout(lpTimer); lpTimer = null; }, true));
// Nach einem langen Druck den nachfolgenden echten Klick schlucken — sonst
// würde die Seite geöffnet und das frisch geöffnete Menü sofort wieder geschlossen.
document.addEventListener("click", (e) => {
	if (lpFired) { lpFired = false; e.preventDefault(); e.stopPropagation(); }
}, true);

export const POPOVERS = { position, toggleElement, closeAll, closeOutside, blurActive };