"use strict";

import { U } from "./util.js";
import { icon } from "./icons.js";

// zeitstrahl-graph.js — Graph des KI-Zeitstrahls: Zeitachse oben (Jahre/Epochen), Stränge als
// farbige Bänder, Lektionen als Stationen, Klausur als Ziel am rechten Ende.
// Layout (Spalten, Spuren, Stränge, Achse) liefert der Kern (core/impala-lehrer, view).

const esc = (s) => U.esc(String(s ?? ""));

// Raster (px, vor Zoom)
const COL = 244, NODE_W = 204, NODE_H = 100, LANE = 122, AXIS = 66, PAD_X = 36, TOP = 18, BAND_HEAD = 30, PAD_B = 48, GOAL_W = 150;
const PALETTE = ["blue", "orange", "green", "purple", "pink", "yellow", "red"];

export const STATE_LABEL = { mastered: "Gemeistert", next: "Als Nächstes", later: "Später" };

export function fmtYear(y) {
	if (y == null || !Number.isFinite(Number(y))) return "";
	const n = Math.round(Number(y));
	return n < 0 ? `${-n} v. Chr.` : String(n);
}

function colLabel(c) {
	if (!c || c.from == null) return "";
	const a = fmtYear(c.from), b = fmtYear(c.to);
	return a === b ? a : `${a}–${b}`;
}

export function examInfo(exam) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(String(exam || ""))) return null;
	const day = new Date(exam + "T00:00:00");
	const today = new Date(); today.setHours(0, 0, 0, 0);
	const days = Math.round((day - today) / 86400000);
	const date = day.toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" });
	const rel = days > 1 ? `in ${days} Tagen` : days === 1 ? "morgen" : days === 0 ? "heute" : "vorbei";
	return { days, date, rel };
}

export function strandColor(i) {
	return i < 0 ? "var(--zs-accent)" : `rgb(var(--c-${PALETTE[i % PALETTE.length]}))`;
}

export function progressRing(pct, size = 48) {
	const r = size / 2 - 4, c = 2 * Math.PI * r;
	return `<svg class="zs-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">` +
		`<circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="zs-ring-bg"/>` +
		`<circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="zs-ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}"/></svg>`;
}

// Geometrie aus der Kern-Ansicht: x/y je Knoten, Bänder je Strang, Gesamtgröße.
function geometry(v) {
	const strands = v.strands || [];
	const bandOfLane = (lane) => strands.findIndex((s) => lane >= s.lane && lane < s.lane + s.lanes);
	const yOfLane = (lane) => {
		const b = bandOfLane(lane);
		return AXIS + TOP + (strands.length ? (b + 1) * BAND_HEAD : 0) + lane * LANE;
	};
	const pos = new Map(v.nodes.map((n) => [n.id, { x: PAD_X + n.col * COL, y: yOfLane(n.lane), band: bandOfLane(n.lane), n }]));
	const lanes = Math.max(1, v.lanes);
	const bottom = yOfLane(lanes - 1) + NODE_H;
	const goalX = PAD_X + Math.max(1, v.cols) * COL;
	const hasGoal = !!examInfo(v.exam);
	const w = (hasGoal ? goalX + GOAL_W : goalX - (COL - NODE_W)) + PAD_X;
	const h = bottom + PAD_B;
	const bands = strands.map((s, i) => ({ ...s, i, top: yOfLane(s.lane) - BAND_HEAD, height: s.lanes * LANE - (LANE - NODE_H) + BAND_HEAD + 14 }));
	return { pos, w, h, bottom, goalX, hasGoal, bands, yTop: AXIS + TOP };
}

function edgePath(x1, y1, x2, y2) {
	const c = Math.max(28, (x2 - x1) / 2);
	return `M${x1} ${y1} C${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`;
}

function edgesSvg(v, g) {
	const hasKids = new Set(v.edges.map((e) => e.from));
	const out = v.edges.map((e) => {
		const a = g.pos.get(e.from), b = g.pos.get(e.to);
		if (!a || !b) return "";
		const cls = a.n.state === "mastered" ? (b.n.state === "later" ? "is-later" : b.n.state === "next" ? "is-active" : "is-done") : "is-later";
		return `<path class="zs-edge ${cls}" style="--zs-strand:${strandColor(b.band)}" d="${edgePath(a.x + NODE_W, a.y + NODE_H / 2, b.x, b.y + NODE_H / 2)}"/>`;
	});
	// Alle Enden laufen in die Klausur.
	if (g.hasGoal) {
		for (const n of v.nodes) {
			if (hasKids.has(n.id)) continue;
			const a = g.pos.get(n.id);
			const cls = n.state === "mastered" ? "is-done" : "is-later";
			out.push(`<path class="zs-edge zs-edge-goal ${cls}" style="--zs-strand:${strandColor(a.band)}" d="${edgePath(a.x + NODE_W, a.y + NODE_H / 2, g.goalX, a.y + NODE_H / 2)}"/>`);
		}
	}
	return `<svg class="zs-edges" width="${g.w}" height="${g.h}" aria-hidden="true">${out.join("")}</svg>`;
}

function nodeCard(n, p) {
	const meta = [fmtYear(n.year), n.era].filter(Boolean);
	const quiz = n.quiz?.total ? `<span class="zs-badge${n.quiz.passed ? " ok" : ""}" title="Kontrollfragen">${icon("help")}${n.quiz.passed ? "" : n.quiz.total}</span>` : "";
	const ws = n.worksheet ? `<span class="zs-badge${n.worksheet === "passed" ? " ok" : ""}" title="Arbeitsblatt">${icon("pen")}</span>` : "";
	const tag = n.draft ? `<span class="zs-tag draft">${icon("pen-tool")}Entwurf</span>`
		: n.state === "next" ? `<span class="zs-tag next">Als Nächstes</span>`
			: n.state === "mastered" ? `<span class="zs-tag done">${icon("check")}Gemeistert</span>` : "";
	return `<button type="button" class="zs-node is-${esc(n.state)}${n.draft ? " is-draft" : ""}" data-zsnode="${esc(n.id)}" ` +
		`style="left:${p.x}px;top:${p.y}px;width:${NODE_W}px;height:${NODE_H}px;--zs-strand:${strandColor(p.band)}" title="${esc(STATE_LABEL[n.state] || "")}">` +
		`<span class="zs-station" aria-hidden="true"></span>` +
		(meta.length ? `<span class="zs-node-meta">${n.year != null ? `<b>${esc(fmtYear(n.year))}</b>` : ""}${n.era ? `<span>${esc(n.era)}</span>` : ""}</span>` : "") +
		`<span class="zs-node-title">${esc(n.title)}</span>` +
		`<span class="zs-node-foot">${tag}<span class="zs-node-badges">${quiz}${ws}</span></span></button>`;
}

// Epochen-Bänder: aufeinanderfolgende Spalten mit gleicher Epoche zusammengefasst.
function eraBands(v) {
	const out = [];
	(v.columns || []).forEach((c, i) => {
		const era = String(c.era || "");
		const last = out[out.length - 1];
		if (last && last.era === era) last.to = i;
		else out.push({ era, from: i, to: i });
	});
	return out;
}

function axisHtml(v, g, nextCol) {
	const path = v.kind === "path";
	const cols = v.columns || [];
	const bands = path ? [] : eraBands(v);
	const half = (COL - NODE_W) / 2;
	const eras = bands.filter((b) => b.era).map((b) =>
		`<span class="zs-axis-era" style="left:${PAD_X + b.from * COL - half}px;width:${(b.to - b.from + 1) * COL}px"><span>${esc(b.era)}</span></span>`).join("");
	const ticks = cols.map((c, i) => {
		const label = path ? `Schritt ${i + 1}` : colLabel(c);
		return label ? `<span class="zs-axis-tick${i === nextCol ? " is-now" : ""}" style="left:${PAD_X + i * COL}px">${esc(label)}</span>` : "";
	}).join("");
	const goal = g.hasGoal ? `<span class="zs-axis-tick is-goal" style="left:${g.goalX}px">${icon("target")}Ziel</span>` : "";
	return `<div class="zs-axis" style="width:${g.w}px;height:${AXIS}px"><div class="zs-axis-line"></div>${eras}${ticks}${goal}</div>`;
}

function backdropHtml(v, g, nextCol) {
	const half = (COL - NODE_W) / 2;
	const eras = v.kind === "path" ? "" : eraBands(v).map((b, k) =>
		`<div class="zs-era-band${k % 2 ? " alt" : ""}" style="left:${PAD_X + b.from * COL - half}px;width:${(b.to - b.from + 1) * COL}px;height:${g.h}px"></div>`).join("");
	const strands = g.bands.map((b) =>
		`<div class="zs-strand" style="top:${b.top}px;height:${b.height}px;width:${g.w}px;--zs-strand:${strandColor(b.i)}">` +
		`<span class="zs-strand-label">${esc(b.name || "Weitere")}</span></div>`).join("");
	const now = nextCol >= 0 ? `<div class="zs-now" style="left:${PAD_X + nextCol * COL - half / 2}px;top:${AXIS}px;height:${g.h - AXIS}px" title="Du bist hier"></div>` : "";
	return eras + strands + now;
}

function goalHtml(v, g) {
	const ex = examInfo(v.exam);
	if (!ex) return "";
	const top = g.yTop, height = g.bottom - top;
	return `<div class="zs-goal${ex.days < 0 ? " is-past" : ""}" style="left:${g.goalX}px;top:${top}px;width:${GOAL_W}px;height:${Math.max(NODE_H, height)}px">` +
		`<span class="zs-goal-icon">${icon("target", "", 28)}</span><b>Klausur</b><span>${esc(ex.date)}</span><span class="zs-goal-rel">${esc(ex.rel)}</span></div>`;
}

/** Graph-Bereich (Achse, Bänder, Kanten, Stationen, Ziel) samt Zoom-Leiste. */
export function graphHtml(v, zoom) {
	const g = geometry(v);
	const next = v.nodes.filter((n) => n.state === "next").sort((a, b) => a.col - b.col)[0];
	const nextCol = next ? next.col : -1;
	return `<div class="zs-graph">` +
		`<div class="zs-scroll" data-zsscroll="1"><div class="zs-canvas" style="width:${g.w}px;height:${g.h}px;zoom:${zoom}">` +
		axisHtml(v, g, nextCol) + backdropHtml(v, g, nextCol) + edgesSvg(v, g) +
		v.nodes.map((n) => nodeCard(n, g.pos.get(n.id))).join("") + goalHtml(v, g) +
		`</div></div>` +
		`<div class="zs-tools" role="toolbar" aria-label="Ansicht">` +
		`<button type="button" class="zs-tool" data-zszoom="-" aria-label="Verkleinern">${icon("minus")}</button>` +
		`<span class="zs-tool-val">${Math.round(zoom * 100)}%</span>` +
		`<button type="button" class="zs-tool" data-zszoom="+" aria-label="Vergrößern">${icon("plus")}</button>` +
		(next ? `<button type="button" class="zs-tool" data-zsfocus="1" aria-label="Zur nächsten Lektion">${icon("target")}</button>` : "") +
		`</div></div>`;
}

/** Scrollt die nächste Lektion ins linke Drittel. */
export function focusNext(root, zoom) {
	const scroll = root.querySelector("[data-zsscroll]");
	const el = root.querySelector(".zs-node.is-next") || root.querySelector(".zs-node");
	if (!scroll || !el) return;
	const left = parseFloat(el.style.left) * zoom, top = parseFloat(el.style.top) * zoom;
	scroll.scrollTo({ left: Math.max(0, left - scroll.clientWidth / 3), top: Math.max(0, top - scroll.clientHeight / 3), behavior: "smooth" });
}

/** Ziehen mit der Maus verschiebt den Graphen; Strg/⌘ + Mausrad zoomt. */
export function attachGraph(root, onZoom) {
	const scroll = root.querySelector("[data-zsscroll]");
	if (!scroll) return;
	let drag = null;
	scroll.addEventListener("pointerdown", (e) => {
		if (e.pointerType !== "mouse" || e.button !== 0 || e.target.closest("button")) return;
		drag = { x: e.clientX, y: e.clientY, l: scroll.scrollLeft, t: scroll.scrollTop };
		scroll.setPointerCapture(e.pointerId);
		scroll.classList.add("is-dragging");
	});
	scroll.addEventListener("pointermove", (e) => {
		if (!drag) return;
		scroll.scrollLeft = drag.l - (e.clientX - drag.x);
		scroll.scrollTop = drag.t - (e.clientY - drag.y);
	});
	const end = () => { drag = null; scroll.classList.remove("is-dragging"); };
	scroll.addEventListener("pointerup", end);
	scroll.addEventListener("pointercancel", end);
	scroll.addEventListener("wheel", (e) => {
		if (!e.ctrlKey && !e.metaKey) return;
		e.preventDefault();
		onZoom(e.deltaY < 0 ? 0.1 : -0.1);
	}, { passive: false });
}

