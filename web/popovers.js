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
	// 🐛 FIX: Selbst-Schließen versteckte nur das DOM — Zustandsflaggen (z.B. S.modelMenuOpen,
	// S.topMenu) blieben "offen", das nächste Render holte das Menü als Geist zurück.
	// closeAll() räumt DOM UND Zustand an einer Stelle und stößt das Render an.
	if (!menu.hidden) { menu.hidden = true; closeAll(); return false; }
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
	// 🐛 FIX: Diese Flags sind Render-EINGABEN, kommen aber nicht über STATE.dispatch. Ohne
	// Anstoss blieb ein geschlossenes Menü als Geist im DOM stehen, bis zufällig etwas
	// anderes ein Render auslöste — daher „ganz viele Popups tauchen komisch auf“.
	// Ereignis statt Import von render.js: kein Ringschluss zwischen den Modulen.
	if (changed.model || changed.sidebar || changed.main) document.dispatchEvent(new CustomEvent("popovers:changed"));
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
	// 🐛 FIX: Wer das Overlay belegt, hinterlegt seinen Schließweg als o._close (siehe
	// U.confirm). Nur so kommt auch das wartende Promise zum Abschluss — vorher riss
	// dieser Handler den Dialog aus dem DOM und der aufrufende `await` hing für immer.
	if (typeof o._close === "function") return void o._close();
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
	if (!btn) return;
	e.preventDefault();
	// 🐛 FIX: Touch/Stift feuern beim langen Druck ZUSÄTZLICH contextmenu — das Menü wurde
	// zweimal umgeschaltet und blieb dadurch zu. Native Geste hat Vorrang (eigener Timer
	// wird verworfen), ein durch sie geöffnetes Menü nicht erneut anfassen; Folge-Klick
	// schlucken wie beim eigenen Langdruck (lpStart != null ⇒ Geste kam von Touch/Stift).
	if (lpFiredAt) return;
	if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
	openRowMenu(btn);
	if (lpStart) lpFiredAt = performance.now();
});
// Langer Druck (550 ms, max. 10 px Bewegung) als Rechtsklick-Ersatz für Touch/Stift.
// 🐛 FIX: Zeitfenster statt Boolean. Der Klick-Schlucker unten galt bis zum NÄCHSTEN
// Klick — kam keiner (Menü per Tastatur, Zurück-Geste oder Sync geschlossen), fraß er
// irgendwann einen völlig unbeteiligten Klick. Ein Zeitfenster kann nicht hängen bleiben.
const LP_SWALLOW_MS = 700;
let lpTimer = null, lpStart = null, lpFiredAt = 0;
document.addEventListener("pointerdown", (e) => {
	if (e.pointerType === "mouse") return;
	const btn = rowMenuButton(e.target);
	if (!btn) return;
	lpStart = { x: e.clientX, y: e.clientY };
	lpFiredAt = 0;
	clearTimeout(lpTimer);
	// Erst das Menü öffnen, DANN das Zeitfenster starten — sonst würde der synthetische
	// btn.click() vom Schlucker unten gleich wieder verschluckt.
	lpTimer = setTimeout(() => { openRowMenu(btn); lpFiredAt = performance.now(); lpTimer = null; }, 550);
}, true);
document.addEventListener("pointermove", (e) => {
	if (lpTimer && lpStart && Math.hypot(e.clientX - lpStart.x, e.clientY - lpStart.y) > 10) { clearTimeout(lpTimer); lpTimer = null; }
}, true);
// lpStart mit aufräumen: dient dem contextmenu-Zweig als Merkmal "Geste war Touch/Stift".
["pointerup", "pointercancel"].forEach((type) => document.addEventListener(type, () => { clearTimeout(lpTimer); lpTimer = null; lpStart = null; }, true));
// Nach einem langen Druck den nachfolgenden echten Klick schlucken — sonst
// würde die Seite geöffnet und das frisch geöffnete Menü sofort wieder geschlossen.
document.addEventListener("click", (e) => {
	if (!lpFiredAt) return;
	const fresh = performance.now() - lpFiredAt < LP_SWALLOW_MS;
	lpFiredAt = 0;
	if (fresh) { e.preventDefault(); e.stopPropagation(); }
}, true);

export const POPOVERS = { position, toggleElement, closeAll, closeOutside, blurActive };