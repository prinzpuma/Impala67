"use strict";

import { U } from "./util.js";
import { icon } from "./icons.js";

// zeitstrahl-graph.js — Zeitstrahl als eine Linie: Markierungen an den exakten Jahren
// (maßstabsgetreu), Beschriftung abwechselnd oben und unten, Zustand nur am Punkt.
// Lernpfad (ohne Jahre): gleichmäßige Abstände in der Reihenfolge des Kerns (Spalte, Spur).

const esc = (s) => U.esc(String(s ?? ""));

const PAD = 70, MIN_GAP = 18, LABEL_W = 150, ROW_H = 54, STEM = 20, LINE_GAP = 26;

export const STATE_LABEL = { mastered: "Geschafft", next: "Als Nächstes", later: "Später" };

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

// Runde Jahre für die Skala: Schrittweite passend zur Spanne.
function ticks(min, max) {
	const span = Math.max(1, max - min);
	const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => span / s <= 8) || 1000;
	const out = [];
	for (let y = Math.ceil(min / step) * step; y <= max; y += step) out.push(y);
	return out;
}

// x je Knoten: Jahre maßstabsgetreu; zu dicht liegende Punkte rücken minimal auseinander.
function place(v, width) {
	const history = v.kind !== "path" && v.nodes.some((n) => n.year != null);
	const list = v.nodes.slice().sort((a, b) =>
		history ? (a.year ?? Infinity) - (b.year ?? Infinity) || a.col - b.col : a.col - b.col || a.lane - b.lane);
	const dated = history ? list.filter((n) => n.year != null) : [];
	const min = dated.length ? dated[0].year : 0, max = dated.length ? dated[dated.length - 1].year : 0;
	const inner = Math.max(width - 2 * PAD, (list.length - 1) * MIN_GAP);
	let last = -Infinity;
	const pts = list.map((n, i) => {
		let x = history && n.year != null
			? PAD + (max > min ? ((n.year - min) / (max - min)) * inner : inner / 2)
			: history ? PAD + inner + MIN_GAP * 2 : PAD + (list.length > 1 ? (i / (list.length - 1)) * inner : inner / 2);
		x = Math.max(x, last + MIN_GAP);
		last = x;
		return { n, x };
	});
	return { pts, history, min, max, inner, end: Math.max(PAD + inner, last) + PAD };
}

// Beschriftungen: abwechselnd oben/unten, bei Platzmangel eine Reihe weiter weg.
function rows(pts) {
	const right = { up: [], down: [] };
	return pts.map((p, i) => {
		const pref = i % 2 ? "down" : "up";
		const pick = (side) => {
			const r = right[side].findIndex((edge) => p.x - LABEL_W / 2 > edge + 6);
			return r < 0 ? right[side].length : r;
		};
		const other = pref === "up" ? "down" : "up";
		const a = pick(pref), b = pick(other);
		const side = b < a ? other : pref, row = Math.min(a, b);
		right[side][row] = p.x + LABEL_W / 2;
		return { ...p, side, row };
	});
}

export function graphHtml(v, { width, zoom }) {
	const { pts, history, min, max, inner, end } = place(v, width * zoom);
	const labeled = rows(pts);
	const up = Math.max(0, ...labeled.filter((p) => p.side === "up").map((p) => p.row + 1));
	const down = Math.max(0, ...labeled.filter((p) => p.side === "down").map((p) => p.row + 1));
	const lineY = 24 + up * ROW_H + STEM;
	const h = lineY + STEM + down * ROW_H + LINE_GAP + 10;
	const next = labeled.filter((p) => p.n.state === "next").sort((a, b) => a.x - b.x)[0];
	const doneTo = next ? next.x : labeled.every((p) => p.n.state === "mastered") && labeled.length ? labeled[labeled.length - 1].x : PAD;

	const scale = history && max > min
		? ticks(min, max).map((y) => {
			const x = PAD + ((y - min) / (max - min)) * inner;
			return `<line class="zs-tick" x1="${x}" y1="${lineY - 4}" x2="${x}" y2="${lineY + 4}"/><text class="zs-tick-txt" x="${x}" y="${h - 8}" text-anchor="middle">${esc(fmtYear(y))}</text>`;
		}).join("")
		: "";
	const stems = labeled.map((p) => {
		const len = STEM + p.row * ROW_H;
		const y2 = p.side === "up" ? lineY - len : lineY + len;
		return `<line class="zs-stem is-${esc(p.n.state)}" x1="${p.x}" y1="${lineY}" x2="${p.x}" y2="${y2}"/>`;
	}).join("");
	const dots = labeled.map((p) =>
		`<circle class="zs-dotmark is-${esc(p.n.state)}" cx="${p.x}" cy="${lineY}" r="${p.n.state === "next" ? 8 : 6}"/>` +
		(p.n.state === "next" ? `<circle class="zs-halo" cx="${p.x}" cy="${lineY}" r="15"/>` : "")).join("");
	const labels = labeled.map((p) => {
		const len = STEM + p.row * ROW_H;
		// Oben am unteren Rand ausgerichtet (wächst nach oben), unten am oberen.
		const pos = p.side === "up" ? `bottom:${h - (lineY - len) + 2}px` : `top:${lineY + len + 2}px`;
		const when = history ? fmtYear(p.n.year) : `${labeled.indexOf(p) + 1}.`;
		return `<button type="button" class="zs-mark is-${esc(p.n.state)}${p.n.draft ? " is-draft" : ""} ${p.side}" data-zsnode="${esc(p.n.id)}" ` +
			`style="left:${p.x - LABEL_W / 2}px;${pos};width:${LABEL_W}px" title="${esc(p.n.title)}${p.n.summary ? " – " + esc(p.n.summary) : ""}">` +
			`<b>${esc(when)}</b><span>${esc(p.n.title)}</span></button>`;
	}).join("");

	return `<div class="zs-graph"><div class="zs-scroll" data-zsscroll="1"><div class="zs-canvas" style="width:${end}px;height:${h}px">` +
		`<svg class="zs-line-svg" width="${end}" height="${h}" aria-hidden="true">` +
		`<line class="zs-line" x1="${PAD / 2}" y1="${lineY}" x2="${end - PAD / 2}" y2="${lineY}"/>` +
		`<line class="zs-line-done" x1="${PAD / 2}" y1="${lineY}" x2="${doneTo}" y2="${lineY}"/>` +
		scale + stems + dots + `</svg>${labels}</div></div>` +
		`<div class="zs-tools" role="toolbar" aria-label="Ansicht">` +
		`<button type="button" class="zs-tool" data-zszoom="-" aria-label="Verkleinern">${icon("minus")}</button>` +
		`<button type="button" class="zs-tool" data-zszoom="+" aria-label="Vergrößern">${icon("plus")}</button>` +
		`</div></div>`;
}

/** Scrollt die nächste Lektion ins linke Drittel (nur wenn der Strahl breiter ist als die Ansicht). */
export function focusNext(root) {
	const scroll = root.querySelector("[data-zsscroll]");
	const el = root.querySelector(".zs-mark.is-next");
	if (!scroll || !el || scroll.scrollWidth <= scroll.clientWidth) return;
	scroll.scrollTo({ left: Math.max(0, parseFloat(el.style.left) - scroll.clientWidth / 3), behavior: "smooth" });
}

/** Ziehen mit der Maus verschiebt den Strahl; Strg/⌘ + Mausrad zoomt. */
export function attachGraph(root, onZoom) {
	const scroll = root.querySelector("[data-zsscroll]");
	if (!scroll) return;
	let drag = null;
	scroll.addEventListener("pointerdown", (e) => {
		if (e.pointerType !== "mouse" || e.button !== 0 || e.target.closest("button")) return;
		drag = { x: e.clientX, l: scroll.scrollLeft };
		scroll.setPointerCapture(e.pointerId);
		scroll.classList.add("is-dragging");
	});
	scroll.addEventListener("pointermove", (e) => { if (drag) scroll.scrollLeft = drag.l - (e.clientX - drag.x); });
	const end = () => { drag = null; scroll.classList.remove("is-dragging"); };
	scroll.addEventListener("pointerup", end);
	scroll.addEventListener("pointercancel", end);
	scroll.addEventListener("wheel", (e) => {
		if (!e.ctrlKey && !e.metaKey) return;
		e.preventDefault();
		onZoom(e.deltaY < 0 ? 0.25 : -0.25);
	}, { passive: false });
}
