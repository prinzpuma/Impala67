"use strict";

import { U } from "./util.js";
import { fmtYear } from "./zeitstrahl-graph.js";

// zeitstrahl-lesson.js — Story-Feinschliff der Lektionsansicht nach dem Zeichnen:
// Abschnitts-Fortschritt in der Kopfzeile (aus den ###-Abschnitten der Story) und
// „Offene Frage“ als Abschluss-Box mit dem Weg zur nächsten Lektion.

const esc = (s) => U.esc(String(s ?? ""));
const OPEN = /^offene frage/i;

/** Fasst „### Offene Frage“ und den Text bis zur nächsten Überschrift in eine Box. */
function wrapOpenQuestion(body, next) {
	const h = [...body.querySelectorAll(":scope > h3")].find((x) => OPEN.test(x.textContent.trim()));
	if (!h) return null;
	const box = document.createElement("section");
	box.className = "zs-open";
	h.before(box);
	let el = h;
	while (el && !(el !== h && /^H[1-3]$/.test(el.tagName))) {
		const nx = el.nextElementSibling;
		box.append(el);
		el = nx;
	}
	if (next) {
		box.insertAdjacentHTML("beforeend", `<button type="button" class="zs-btn primary" data-zsnode="${esc(next.id)}">Weiter: ${esc([fmtYear(next.year), next.title].filter(Boolean).join(", "))}</button>`);
	}
	return box;
}

/** Kleine Leiste je Story-Abschnitt; füllt sich beim Lesen, Klick springt hin. */
function stepBar(world, body) {
	const heads = [...body.querySelectorAll(":scope > h3, :scope > .zs-open > h3")];
	const top = world.querySelector(".zs-lesson-top");
	if (heads.length < 2 || !top) return;
	const nav = document.createElement("nav");
	nav.className = "zs-steps";
	nav.setAttribute("aria-label", "Abschnitte");
	nav.innerHTML = heads.map((h, i) => `<button type="button" data-step="${i}" title="${esc(h.textContent.trim())}" aria-label="${esc(h.textContent.trim())}"></button>`).join("");
	top.querySelector(".zs-lesson-nav")?.after(nav);
	const bars = [...nav.children];
	const update = () => {
		const line = world.getBoundingClientRect().top + world.clientHeight * .6;
		heads.forEach((h, i) => bars[i].classList.toggle("is-seen", h.getBoundingClientRect().top < line));
	};
	nav.addEventListener("click", (e) => {
		const b = e.target.closest("[data-step]");
		if (!b) return;
		e.stopPropagation();
		heads[Number(b.dataset.step)]?.scrollIntoView({ behavior: "smooth", block: "start" });
	});
	world.addEventListener("scroll", update, { passive: true });
	update();
}

export function decorateLesson(world, next) {
	const body = world?.querySelector(".zs-body");
	if (!body) return;
	wrapOpenQuestion(body, next);
	stepBar(world, body);
}
