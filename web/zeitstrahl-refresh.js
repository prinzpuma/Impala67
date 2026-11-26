"use strict";

import { U } from "./util.js";
import { icon, lead } from "./icons.js";
import { ZS_STORE, ZS_CORE } from "./zeitstrahl-store.js";
import { fmtYear } from "./zeitstrahl-graph.js";

// zeitstrahl-refresh.js — Gemischte Kurz-Auffrischung (Interleaving) über alle verblassenden
// und schwachen Knoten eines Zeitstrahls inkl. Konfidenz-Abfrage („Wie sicher?“).

const esc = (s) => U.esc(String(s ?? ""));

export function confidenceHtml(name, current = "") {
	const opts = [["sure", "Sicher"], ["unsure", "Unsicher"], ["guess", "Geraten"]];
	return `<div class="zs-conf" role="radiogroup" aria-label="Wie sicher bist du?">` +
		`<span class="hint">Wie sicher?</span>` +
		opts.map(([v, lbl]) =>
			`<label class="zs-conf-opt"><input type="radio" name="${esc(name)}" value="${v}"${current === v ? " checked" : ""}><span>${lbl}</span></label>`
		).join("") + `</div>`;
}

function inputHtml(q, name) {
	if (q.type === "choice") {
		const multi = (q.correct || []).length > 1;
		return `<div class="zs-options">${(q.options || []).map((o, k) =>
			`<label class="zs-opt"><input type="${multi ? "checkbox" : "radio"}" name="${name}" value="${k}"><span class="md">${U.md(String(o))}</span></label>`
		).join("")}</div>`;
	}
	if (q.type === "number") {
		return `<div class="zs-num"><input class="zs-input" name="${name}" inputmode="decimal" autocomplete="off" placeholder="Ergebnis">${q.unit ? `<span class="zs-unit">${esc(q.unit)}</span>` : ""}</div>`;
	}
	if (q.type === "cloze") {
		let k = 0;
		const parts = String(q.text || "").split(/\{\{[\s\S]*?\}\}/);
		return `<div class="zs-cloze">${parts.map((p, idx) => esc(p) + (idx < parts.length - 1 ? `<input class="zs-gap" name="${name}" data-gap="${k++}" autocomplete="off">` : "")).join("")}</div>`;
	}
	return `<textarea class="zs-input" name="${name}" rows="2" placeholder="Deine Antwort …"></textarea>`;
}

export function readInput(container, q) {
	if (q.type === "choice") return [...container.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked')].filter((x) => !x.name.startsWith("conf-")).map((x) => Number(x.value));
	if (q.type === "cloze") return [...container.querySelectorAll(".zs-gap")].map((x) => x.value);
	return container.querySelector(".zs-input")?.value ?? "";
}

export function refreshHtml(tl, session, outcome) {
	if (!session?.items?.length) {
		return `<header class="zs-lesson-top"><button type="button" class="zs-btn quiet" data-zsback="1">${lead("chevron-left")}${esc(tl.title)}</button></header>` +
			`<div class="zs-empty">${icon("check-circle", "", 36)}<h2>Alles frisch!</h2><p>Aktuell verblasst kein Thema – du kannst direkt mit der nächsten Lektion weitermachen.</p>` +
			`<div class="zs-actions center"><button type="button" class="zs-btn primary" data-zsback="1">Zurück zum Zeitstrahl</button></div></div>`;
	}
	const resMap = outcome?.results || [];
	const banner = outcome
		? `<div class="zs-ref-done"><b>${outcome.correct_count} von ${outcome.total_count} richtig</b> – ${outcome.refreshed_nodes.length} Knoten aufgefrischt!` +
			`<div class="zs-actions"><button type="button" class="zs-btn primary" data-zsback="1">Zurück zum Zeitstrahl</button></div></div>`
		: "";
	const cards = session.items.map((it, i) => {
		const q = it.question || {};
		const r = resMap[i] || null;
		const cls = r ? (r.correct === true ? " is-ok" : r.correct === false ? " is-bad" : " is-wait") : "";
		const badge = [it.year != null ? fmtYear(it.year) : "", it.node_title, it.reason].filter(Boolean).join(" · ");
		return `<li class="zs-q${cls}" data-zsr="${i}">` +
			`<div class="zs-q-head"><span class="zs-q-no">${i + 1}</span><span class="zs-chip">${esc(badge)}</span>` +
			(r ? `<span class="zs-res ${r.correct === true ? "ok" : r.correct === false ? "bad" : "wait"}">${r.correct === true ? "richtig" : r.correct === false ? "falsch" : "offen"}</span>` : "") + `</div>` +
			(q.q ? `<div class="zs-q-text md">${U.md(q.q)}</div>` : "") +
			inputHtml(q, `zsr-${i}`) +
			confidenceHtml(`conf-r-${i}`) +
			(r && r.correct === false && r.expected ? `<div class="zs-expected">Lösung: <span class="md">${U.md(r.expected)}</span></div>` : "") +
			(r && r.explain ? `<div class="zs-explain md">${U.md(r.explain)}</div>` : "") +
			`</li>`;
	}).join("");

	return `<header class="zs-lesson-top"><button type="button" class="zs-btn quiet" data-zsback="1">${lead("chevron-left")}${esc(tl.title)}</button>` +
		`<span class="zs-chip next">${icon("zap")}Kurz-Auffrischung · ${session.node_count} Knoten · ca. ${session.estimated_minutes} Min.</span></header>` +
		`<article class="zs-lesson">` +
		`<div class="zs-lesson-hero"><h1 class="zs-lesson-title">Gemischte Auffrischung</h1>` +
		`<p class="zs-lead">Fragen aus allen verblassenden Themen gemischt – kurzes aktives Erinnern hält den Stoff bis zur Klausur stabil.</p></div>` +
		banner +
		`<ol class="zs-qs">${cards}</ol>` +
		(!outcome ? `<div class="zs-actions"><button type="button" class="zs-btn primary" data-zsrefsubmit="1">${lead("check")}Auffrischung auswerten</button></div>` : "") +
		`</article>`;
}

export async function submitRefresh(root, tl, session) {
	const subs = session.items.map((it, i) => {
		const li = root.querySelector(`[data-zsr="${i}"]`);
		const ans = li ? readInput(li, it.question || {}) : "";
		const conf = li?.querySelector(`input[name="conf-r-${i}"]:checked`)?.value || "";
		return { node_id: it.node_id, question_index: it.question_index, answer: ans, confidence: conf };
	});
	const out = ZS_CORE.recordRefresh(tl, subs);
	if (out.error) { U.toast?.(out.error, "error"); return null; }
	await ZS_STORE.put(out.timeline);
	U.toast?.(`${out.correct_count}/${out.total_count} richtig – ${out.refreshed_nodes.length} Knoten aufgefrischt!`, "success");
	return out;
}
