"use strict";

import { U } from "./util.js";
import { icon } from "./icons.js";

// zeitstrahl-graph.js — Übersicht eines Zeitstrahls in zwei Ansichten:
// „Faden“ (senkrecht wie ein Longread, zwischen den Kapiteln die offene Frage zur nächsten Lektion)
// und „Streifen“ (Kapitel-Karten zum Wischen, Epochen als Farbleiste, Zeitsprünge als schmale Streifen).
// Aussehen je Zeitstrahl über die Thema-Variablen (--zs-*, siehe css/zeitstrahl.css).

const esc = (s) => U.esc(String(s ?? ""));
const ERA_COLORS = 6;
const GAP_YEARS = 20;

export const STATE_LABEL = { mastered: "Geschafft", next: "Als Nächstes", later: "Später" };
export const LAYOUTS = ["faden", "reel"];

export function fmtYear(y) {
	if (y == null || !Number.isFinite(Number(y))) return "";
	const n = Math.round(Number(y));
	return n < 0 ? `${-n} v. Chr.` : String(n);
}

export function examInfo(exam) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(String(exam || ""))) return null;
	const day = new Date(exam + "T00:00:00");
	const today = new Date(); today.setHours(0, 0, 0, 0);
	const days = Math.round((day - today) / 86400000);
	const rel = days > 1 ? `in ${days} Tagen` : days === 1 ? "morgen" : days === 0 ? "heute" : "vorbei";
	return { days, rel };
}

const isHistory = (v) => v.kind !== "path" && v.nodes.some((n) => n.year != null);

/** Lernreihenfolge: Geschichte nach Jahr, Lernpfad nach Spalte und Spur des Kerns. */
export function orderedNodes(v) {
	const history = isHistory(v);
	return v.nodes.slice().sort((a, b) =>
		history ? (a.year ?? Infinity) - (b.year ?? Infinity) || a.col - b.col : a.col - b.col || a.lane - b.lane);
}

/** Epochen in der Reihenfolge ihres ersten Auftretens → Farbe --zs-era-1 … --zs-era-6. */
function eraColors(seq) {
	const idx = new Map();
	for (const n of seq) if (n.era && !idx.has(n.era)) idx.set(n.era, (idx.size % ERA_COLORS) + 1);
	return (n) => `--era:var(--zs-era-${idx.get(n.era) || 1})`;
}

/** Skizze der KI (als Bild, Skripte laufen darin nicht) oder das erste Bild der Lektion. */
function artHtml(n, cls) {
	const svg = typeof n.svg === "string" && n.svg.trim().toLowerCase().startsWith("<svg") ? n.svg : "";
	if (svg) return `<img class="${cls}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}" alt="" aria-hidden="true">`;
	if (n.image) return `<img class="${cls} is-photo" src="${esc(n.image)}" alt="" aria-hidden="true" loading="lazy" referrerpolicy="no-referrer">`;
	return "";
}

const memCls = (n) => n.memory_state && n.memory_state !== "fresh" ? ` mem-${esc(n.memory_state)}` : "";

function stateHint(n) {
	if (n.draft) return "Entwurf";
	if (n.state === "mastered") return n.freshness ? `Geschafft · Frische ${n.freshness}%` : "Geschafft";
	return n.state === "next" ? "Als Nächstes" : "";
}

function threadHtml(v) {
	const seq = orderedNodes(v);
	const history = isHistory(v);
	const era = eraColors(seq);
	const parts = seq.map((n, i) => {
		const nx = seq[i + 1];
		const when = history ? fmtYear(n.year) : String(i + 1);
		const ch = `<article class="zs-ch is-${esc(n.state)}${memCls(n)}${n.draft ? " is-draft" : ""}" style="${era(n)}" data-zsch="${esc(n.id)}">` +
			`<div class="zs-ch-year">${esc(when)}</div>` +
			`<div class="zs-ch-body"><div class="zs-ch-card">${artHtml(n, "zs-ch-art")}` +
			(n.era ? `<div class="zs-ch-era">${esc(n.era)}</div>` : "") +
			`<h2 class="zs-ch-title">${esc(n.title)}</h2>` +
			(n.summary ? `<p class="zs-ch-hook">${esc(n.summary)}</p>` : "") +
			`<div class="zs-ch-act"><button type="button" class="zs-btn${n.state === "next" ? " primary" : ""}" data-zsnode="${esc(n.id)}">${n.state === "mastered" ? "Nochmal lesen" : "Kapitel lesen"}</button>` +
			`<span class="zs-ch-state">${esc(stateHint(n))}</span></div></div></div></article>`;
		if (!nx) return ch;
		const gap = history && n.year != null && nx.year != null && nx.year > n.year
			? `${Math.round(nx.year - n.year)} ${Math.round(nx.year - n.year) === 1 ? "Jahr" : "Jahre"} später` : "";
		const q = n.open_question
			? `<p class="zs-link-q"><b>Offene Frage</b><span class="zs-link-txt">${esc(n.open_question)}</span></p>`
			: `<p class="zs-link-q is-empty"></p>`;
		return ch + `<div class="zs-link"><div class="zs-link-gap">${esc(gap)}</div>${q}</div>`;
	});
	return `<div class="zs-thread"><div class="zs-pulse" aria-hidden="true"></div>${parts.join("")}</div>`;
}

function reelHtml(v) {
	const seq = orderedNodes(v);
	const history = isHistory(v);
	const era = eraColors(seq);
	const frames = seq.map((n, i) => {
		const prev = seq[i - 1];
		const years = history && prev && n.year != null && prev.year != null ? Math.round(n.year - prev.year) : 0;
		const gap = years >= GAP_YEARS ? `<div class="zs-jump" aria-hidden="true"><span>${years} Jahre</span></div>` : "";
		const when = history ? fmtYear(n.year) : String(i + 1);
		return gap + `<button type="button" class="zs-frame is-${esc(n.state)}${memCls(n)}${n.draft ? " is-draft" : ""}" style="${era(n)}" data-zsnode="${esc(n.id)}">` +
			`<span class="zs-frame-band"></span>` +
			`<span class="zs-frame-in">${n.era ? `<span class="zs-frame-era">${esc(n.era)}</span>` : ""}<span class="zs-frame-year">${esc(when)}</span>${artHtml(n, "zs-frame-art")}` +
			`<span class="zs-frame-title">${esc(n.title)}</span>` +
			(n.summary ? `<span class="zs-frame-hook">${esc(n.summary)}</span>` : "") +
			`<span class="zs-frame-foot"><span class="zs-dot"></span>${esc(stateHint(n) || "Noch offen")}</span></span></button>`;
	}).join("");
	return `<div class="zs-reel-wrap"><div class="zs-reel" data-zsreel="1">${frames}</div>` +
		`<div class="zs-reel-nav"><button type="button" class="zs-iconbtn" data-zsreelnav="-1" aria-label="Zurück">${icon("chevron-left")}</button>` +
		`<button type="button" class="zs-iconbtn" data-zsreelnav="1" aria-label="Weiter">${icon("chevron-right")}</button></div></div>`;
}

export function overviewHtml(v, layout) {
	return layout === "reel" ? reelHtml(v) : threadHtml(v);
}

/** Fortschrittslinie im Faden bis zur nächsten Lektion (ganz, wenn alles geschafft ist). */
function placePulse(root) {
	const thread = root.querySelector(".zs-thread");
	const pulse = thread?.querySelector(".zs-pulse");
	if (!pulse) return;
	const chs = [...thread.querySelectorAll(".zs-ch")];
	const next = thread.querySelector(".zs-ch.is-next") || (chs.every((c) => c.classList.contains("is-mastered")) ? chs.at(-1) : chs[0]);
	const first = chs[0];
	if (!next || !first) return;
	pulse.style.top = `${first.offsetTop + 20}px`;
	pulse.style.height = `${Math.max(0, next.offsetTop - first.offsetTop)}px`;
}

/** Nächste Lektion ins Bild holen (Faden: senkrecht in `main`, Streifen: waagrecht). */
export function focusNext(root, main) {
	const reel = root.querySelector("[data-zsreel]");
	if (reel) {
		const f = reel.querySelector(".zs-frame.is-next");
		if (f) reel.scrollLeft = Math.max(0, f.offsetLeft - (reel.clientWidth - f.offsetWidth) / 2);
		return;
	}
	const ch = root.querySelector(".zs-ch.is-next");
	if (!ch || !main) return;
	const top = ch.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
	if (top > main.clientHeight * .6) main.scrollTop = top - 80;
}

export function attachOverview(root) {
	placePulse(root);
	const thread = root.querySelector(".zs-thread");
	if (thread && typeof ResizeObserver !== "undefined") {
		const ro = new ResizeObserver(() => { if (!thread.isConnected) ro.disconnect(); else placePulse(root); });
		ro.observe(thread);
	}
	const reel = root.querySelector("[data-zsreel]");
	root.querySelectorAll("[data-zsreelnav]").forEach((b) => b.addEventListener("click", (e) => {
		e.stopPropagation();
		reel?.scrollBy({ left: Number(b.dataset.zsreelnav) * Math.max(280, reel.clientWidth * .7), behavior: "smooth" });
	}));
}
