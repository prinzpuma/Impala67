// beta-motion.js — Bewegungsschicht des Beta-Designs.
// Morph von der angeklickten Fläche in die neue Ansicht, gleitende Markierung in
// Umschaltern und hochzählende Kennzahlen. Rein additiv: liest nur DOM und S,
// ändert keinen App-Zustand. Aus bei „Bewegung reduzieren“ (App-Einstellung, wie überall).
import { S } from "./state.js";

const SOURCES = ".deck-row, .hv-continue, .hv-pin, .hv-stat, .anki-stat, .hv-recall, .la-block, .lib-card, .notion-tree-row";
const SWITCHES = [".lib-tabs", ".lz-view-switch", ".mode-btns"];
const EASE = "cubic-bezier(.2, .8, .2, 1)";

let lastKey = "";
let source = null;
let enterTimer = 0;

function enabled() {
	const b = document.body.classList;
	return b.contains("beta-ui") && !b.contains("reduce-motion");
}

function spring() {
	return getComputedStyle(document.body).getPropertyValue("--b-spring").trim() || EASE;
}

function viewKey() {
	return S.view + "|" + (S.ankiTab || "") + "|" + (S.currentPageId || "");
}

// pointerdown kommt vor dem Klick-Handler der App: Lage und Look der Quelle
// werden gemerkt, bevor der Render das DOM ersetzt.
function onPointerDown(e) {
	if (!enabled()) return;
	const el = e.target.closest?.(SOURCES);
	if (el && el.closest("#main")) {
		const cs = getComputedStyle(el);
		const bg = cs.backgroundColor;
		source = {
			rect: el.getBoundingClientRect(),
			radius: cs.borderRadius,
			bg: bg && bg !== "rgba(0, 0, 0, 0)" ? bg : getComputedStyle(document.body).getPropertyValue("--panel-solid"),
			at: performance.now(),
		};
	}
	const btn = e.target.closest?.("button, .lib-tab");
	const sel = btn && SWITCHES.find((s) => btn.closest(s));
	if (sel && !btn.classList.contains("active")) slideSwitch(sel);
}

// Gleitende Markierung: das ::before des neuen aktiven Knopfs startet dort, wo das alte lag.
function slideSwitch(sel) {
	const old = document.querySelector(sel + " .active");
	if (!old) return;
	const from = old.getBoundingClientRect();
	let frames = 0;
	const tick = () => {
		const now = document.querySelector(sel + " .active");
		if (now && now !== old && now.isConnected) {
			const to = now.getBoundingClientRect();
			if (to.left !== from.left || to.right !== from.right) {
				try {
					now.animate(
						{ left: [from.left - to.left + "px", "0px"], right: [to.right - from.right + "px", "0px"] },
						{ duration: 480, easing: spring(), pseudoElement: "::before" },
					);
				} catch { /* ältere Browser: Markierung springt einfach */ }
			}
			return;
		}
		if (++frames < 60) requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
}

// Morph: eine Hülle wächst von der Quelle zur Zielfläche und blendet dann aus.
function morph(target) {
	const from = source.rect;
	const r = target.getBoundingClientRect();
	const to = { left: r.left, top: Math.max(r.top, 0), width: r.width, height: Math.min(r.height, innerHeight - Math.max(r.top, 0)) };
	if (to.width < 40 || to.height < 40) return;
	const ghost = document.createElement("div");
	ghost.className = "bm-ghost";
	Object.assign(ghost.style, { left: to.left + "px", top: to.top + "px", width: to.width + "px", height: to.height + "px", background: source.bg });
	document.body.appendChild(ghost);
	const targetRadius = getComputedStyle(target).borderRadius;
	ghost.animate([
		{ left: from.left + "px", top: from.top + "px", width: from.width + "px", height: from.height + "px", borderRadius: source.radius, opacity: 1 },
		{ left: to.left + "px", top: to.top + "px", width: to.width + "px", height: to.height + "px", borderRadius: targetRadius, opacity: 1, offset: .7 },
		{ left: to.left + "px", top: to.top + "px", width: to.width + "px", height: to.height + "px", borderRadius: targetRadius, opacity: 0 },
	], { duration: 520, easing: EASE }).finished.finally(() => ghost.remove());
	target.animate({ opacity: [0, 1] }, { duration: 260, delay: 220, easing: EASE, fill: "backwards" });
}

function morphTarget(main) {
	if (S.view === "anki" && S.ankiTab === "study") return main.querySelector(".study-card");
	return main.firstElementChild;
}

function countUp(main) {
	main.querySelectorAll(".hv-stat > b, .anki-stat > b").forEach((el) => {
		const n = /^\d+$/.test(el.textContent.trim()) ? Number(el.textContent) : 0;
		if (n < 2 || n > 99999) return;
		const start = performance.now();
		const step = (t) => {
			if (!el.isConnected) return;
			const p = Math.min(1, (t - start) / 700);
			el.textContent = String(Math.round(n * (1 - Math.pow(1 - p, 3))));
			if (p < 1) requestAnimationFrame(step);
		};
		requestAnimationFrame(step);
	});
}

function onViewChange(main) {
	main.classList.remove("bm-enter");
	void main.offsetWidth;
	main.classList.add("bm-enter");
	clearTimeout(enterTimer);
	enterTimer = setTimeout(() => main.classList.remove("bm-enter"), 1000);
	const target = morphTarget(main);
	if (source && performance.now() - source.at < 1200 && target) morph(target);
	else if (S.view === "page" && target && !document.body.classList.contains("heft-open")) {
		target.animate({ opacity: [0, 1], transform: ["translateY(4px)", "none"] }, { duration: 200, easing: EASE });
	}
	source = null;
	countUp(main);
}

function init() {
	const main = document.getElementById("main");
	if (!main) return;
	lastKey = viewKey();
	document.addEventListener("pointerdown", onPointerDown, true);
	new MutationObserver(() => {
		const key = viewKey();
		if (key === lastKey) return;
		lastKey = key;
		if (enabled()) onViewChange(main);
	}).observe(main, { childList: true, subtree: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
