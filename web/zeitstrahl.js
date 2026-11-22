"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { BUS } from "./event-bus.js";
import { icon, lead } from "./icons.js";
import { ZS_STORE, ZS_CORE } from "./zeitstrahl-store.js";

// zeitstrahl.js — KI-Zeitstrahl: Lernwelt aus Lektions-Knoten (Konzept: docs/KI-LEHRERMODUS-PLAN.md §6).
// Horizontal: wenige Ursprünge links, nach rechts verzweigend, Stränge übereinander.
// Opt-in über Einstellungen → Lernen → Beta-Lernfunktionen (S.settings.experiments.zeitstrahl).
// Daten: eigene Lehrer-Datenbank (zeitstrahl-store.js), Logik im Kern (core/impala-lehrer).

const esc = (s) => U.esc(String(s ?? ""));
const enabled = () => !!S.settings?.experiments?.zeitstrahl;

// Raster des Graphen (px)
const COL = 290, LANE = 138, NODE_W = 228, NODE_H = 106, PAD = 36;

const UI_KEY = "impala67Zeitstrahl";
const ui = (() => {
	try { return { tl: null, node: null, ...JSON.parse(localStorage.getItem(UI_KEY) || "{}") }; } catch { return { tl: null, node: null }; }
})();
function saveUi() { try { localStorage.setItem(UI_KEY, JSON.stringify({ tl: ui.tl, node: ui.node })); } catch {} }

const rerender = () => BUS.emit("ui:render");

function currentTimeline() {
	const tl = (ui.tl && ZS_STORE.getSync(ui.tl)) || ZS_STORE.all()[0] || null;
	if (tl && ui.tl !== tl.id) { ui.tl = tl.id; ui.node = null; }
	return tl;
}
const nodeOf = (tl, id) => (tl?.nodes || []).find((n) => n.id === id) || null;

const STATE_LABEL = { mastered: "Gemeistert", next: "Als Nächstes", later: "Später" };
const WS_LABEL = { open: "offen", submitted: "eingereicht", passed: "bestanden", failed: "nochmal" };

// ---------- Graph ----------
function edgePath(a, b) {
	const x1 = PAD + a.col * COL + NODE_W, y1 = PAD + a.lane * LANE + NODE_H / 2;
	const x2 = PAD + b.col * COL, y2 = PAD + b.lane * LANE + NODE_H / 2;
	const c = Math.max(24, (x2 - x1) / 2);
	return `M${x1} ${y1} C${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`;
}

function nodeCard(n) {
	const quiz = n.quiz?.total ? `<span class="zs-badge${n.quiz.passed ? " ok" : ""}" title="Quiz">${icon("help")}${n.quiz.passed ? "✓" : n.quiz.total}</span>` : "";
	const ws = n.worksheet ? `<span class="zs-badge${n.worksheet === "passed" ? " ok" : ""}" title="Arbeitsblatt: ${esc(WS_LABEL[n.worksheet] || n.worksheet)}">${icon("pen")}${n.worksheet === "passed" ? "✓" : ""}</span>` : "";
	return `<button type="button" class="zs-node is-${esc(n.state)}" data-zsnode="${esc(n.id)}" style="left:${PAD + n.col * COL}px;top:${PAD + n.lane * LANE}px;width:${NODE_W}px;height:${NODE_H}px" title="${esc(STATE_LABEL[n.state] || "")}">` +
		(n.era ? `<span class="zs-era">${esc(n.era)}</span>` : "") +
		`<span class="zs-node-title">${esc(n.title)}</span>` +
		(n.summary ? `<span class="zs-node-sum">${esc(n.summary)}</span>` : "") +
		`<span class="zs-node-foot">${quiz}${ws}${n.state === "mastered" ? `<span class="zs-done">${icon("check-circle")}</span>` : ""}</span></button>`;
}

function graphHtml(tl, v) {
	const pos = new Map(v.nodes.map((n) => [n.id, n]));
	const w = PAD * 2 + Math.max(1, v.cols) * COL - (COL - NODE_W);
	const h = PAD * 2 + Math.max(1, v.lanes) * LANE - (LANE - NODE_H);
	const edges = v.edges.map((e) => {
		const a = pos.get(e.from), b = pos.get(e.to);
		return a && b ? `<path class="zs-edge is-${esc(b.state)}${a.state === "mastered" ? " from-done" : ""}" d="${edgePath(a, b)}"/>` : "";
	}).join("");
	const next = v.nodes.find((n) => n.state === "next");
	const pct = v.stats.total ? Math.round((v.stats.mastered / v.stats.total) * 100) : 0;
	return `<header class="zs-head">` +
		`<div class="zs-head-copy"><h1 class="zs-title">${esc(tl.title)}</h1>` +
		`<p class="zs-sub">${esc([tl.subject, tl.description].filter(Boolean).join(" · "))}</p></div>` +
		`<div class="zs-progress" title="${v.stats.mastered} von ${v.stats.total} gemeistert"><span class="zs-progress-bar"><span style="width:${pct}%"></span></span><span class="zs-progress-txt">${v.stats.mastered}/${v.stats.total}</span></div>` +
		(next ? `<button type="button" class="zs-btn primary" data-zsnode="${esc(next.id)}">${lead("play")}Nächste Lektion</button>` : "") +
		`</header>` +
		(v.nodes.length
			? `<div class="zs-scroll" data-zsscroll="1"><div class="zs-canvas" style="width:${w}px;height:${h}px">` +
				`<svg class="zs-edges" width="${w}" height="${h}" aria-hidden="true">${edges}</svg>` +
				v.nodes.map(nodeCard).join("") + `</div></div>`
			: `<div class="zs-empty"><p>Dieser Zeitstrahl hat noch keine Lektionen.</p>${askButton("build", "Lektionen von der KI bauen lassen")}</div>`);
}

// ---------- Lektion ----------
function imageSrc(img) {
	const src = String(img?.src || "");
	return /^(https:\/\/|data:image\/)/.test(src) ? src : "";
}

function sourcesHtml(sources) {
	if (!sources?.length) return "";
	const items = sources.map((s) => {
		const label = esc(s.title || s.ref);
		if (s.kind === "page") {
			const pg = STATE.findPage?.(String(s.ref || "")) || null;
			return pg ? `<li><button type="button" class="zs-link" data-zsopen="${esc(pg.id)}">${lead("note")}${label}</button></li>` : `<li>${lead("note")}${label} <span class="hint">(nicht gefunden)</span></li>`;
		}
		const href = /^https?:\/\//.test(String(s.ref || "")) ? s.ref : s.kind === "wiki" ? `https://de.wikipedia.org/wiki/${encodeURIComponent(String(s.ref || ""))}` : "";
		return href ? `<li><a class="zs-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${lead(s.kind === "wiki" ? "book" : "external")}${label}</a></li>` : `<li>${label}</li>`;
	}).join("");
	return `<section class="zs-sec"><h3>${lead("link")}Quellen</h3><ul class="zs-sources">${items}</ul></section>`;
}

function resultMark(r) {
	if (!r) return "";
	if (r.correct === true) return `<span class="zs-res ok">${icon("check")}richtig</span>`;
	if (r.correct === false) return `<span class="zs-res bad">${icon("x")}falsch</span>`;
	return `<span class="zs-res wait">${icon("hourglass")}KI prüft</span>`;
}

function questionHtml(q, i, answer, result, attempt) {
	const name = `zsq-${i}`;
	const prompt = q.q ? `<div class="zs-q-text md">${U.md(q.q)}</div>` : "";
	let input = "";
	if (q.type === "choice") {
		const multi = (q.correct || []).length > 1;
		const chosen = new Set((Array.isArray(answer) ? answer : answer != null ? [answer] : []).map(Number));
		input = `<div class="zs-options">${(q.options || []).map((o, k) =>
			`<label class="zs-opt"><input type="${multi ? "checkbox" : "radio"}" name="${name}" value="${k}"${chosen.has(k) ? " checked" : ""}><span class="md">${U.md(String(o))}</span></label>`).join("")}</div>` +
			(multi ? `<p class="hint">Mehrere Antworten möglich.</p>` : "");
	} else if (q.type === "text") {
		input = `<textarea class="zs-input" name="${name}" rows="3" placeholder="Deine Antwort / Rechnung …">${esc(answer ?? "")}</textarea>`;
	} else if (q.type === "number") {
		input = `<div class="zs-num"><input class="zs-input" name="${name}" inputmode="decimal" autocomplete="off" value="${esc(answer ?? "")}" placeholder="Ergebnis">${q.unit ? `<span class="zs-unit">${esc(q.unit)}</span>` : ""}</div>`;
	} else if (q.type === "cloze") {
		const vals = Array.isArray(answer) ? answer : [];
		let k = 0;
		const parts = String(q.text || "").split(/\{\{[\s\S]*?\}\}/);
		input = `<div class="zs-cloze">${parts.map((p, idx) => esc(p) + (idx < parts.length - 1 ? `<input class="zs-gap" name="${name}" data-gap="${k}" autocomplete="off" value="${esc(vals[k++] ?? "")}">` : "")).join("")}</div>`;
	}
	const solved = attempt && result;
	const expected = solved && result.correct !== true && result.expected ? `<div class="zs-expected">Lösung: <span class="md">${U.md(String(result.expected))}</span></div>` : "";
	const feedback = result?.feedback ? `<div class="zs-feedback">${esc(result.feedback)}</div>` : "";
	const explain = solved && q.explain ? `<div class="zs-explain md">${U.md(q.explain)}</div>` : "";
	return `<li class="zs-q${result ? " has-res" : ""}" data-zsq="${i}" data-type="${esc(q.type)}">` +
		`<div class="zs-q-head"><span class="zs-q-no">${i + 1}</span>${resultMark(solved ? result : null)}</div>${prompt}${input}${expected}${feedback}${explain}</li>`;
}

function quizHtml(node) {
	const quiz = node.quiz || [];
	if (!quiz.length) return "";
	const attempt = node.progress?.quiz || null;
	const results = attempt?.results || [];
	const pending = results.some((r) => r && r.correct == null);
	const status = node.progress?.quiz_passed ? `<span class="zs-chip ok">${icon("check")}bestanden</span>`
		: attempt ? (pending ? `<span class="zs-chip wait">KI-Bewertung offen</span>` : `<span class="zs-chip bad">noch nicht bestanden</span>`) : "";
	return `<section class="zs-sec zs-quiz"><h3>${lead("help")}Kontrollfragen ${status}</h3>` +
		`<ol class="zs-qs">${quiz.map((q, i) => questionHtml(q, i, attempt?.answers?.[i], results[i], !!attempt)).join("")}</ol>` +
		`<div class="zs-actions"><button type="button" class="zs-btn primary" data-zsquiz="1">${lead("check")}Antworten prüfen</button>` +
		(pending ? askButton("quiz", "Freitext von der KI bewerten lassen") : "") + `</div></section>`;
}

function worksheetHtml(node) {
	const ws = node.progress?.worksheet || {};
	if (!node.worksheet) {
		return `<section class="zs-sec zs-ws"><h3>${lead("pen")}Arbeitsblatt</h3><p class="hint">Noch kein Arbeitsblatt verknüpft.</p>` +
			`<div class="zs-actions">${askButton("make-worksheet", "Arbeitsblatt erstellen lassen")}</div></section>`;
	}
	const heft = STATE.findPage?.(String(node.worksheet)) || null;
	const st = ws.status || "open";
	return `<section class="zs-sec zs-ws"><h3>${lead("pen")}Arbeitsblatt <span class="zs-chip ${st === "passed" ? "ok" : st === "failed" ? "bad" : st === "submitted" ? "wait" : ""}">${esc(WS_LABEL[st] || st)}</span></h3>` +
		(ws.feedback ? `<div class="zs-feedback">${esc(ws.feedback)}</div>` : "") +
		`<div class="zs-actions">` +
		(heft
			? `<button type="button" class="zs-btn" data-zsopen="${esc(heft.id)}">${lead("notebook")}„${esc(heft.title)}“ öffnen</button>` + (st !== "passed" ? askButton("worksheet", "Fertig – prüfen lassen") : "")
			: `<span class="hint">Heft „${esc(node.worksheet)}“ nicht gefunden.</span>` + askButton("make-worksheet", "Arbeitsblatt erstellen lassen")) +
		`</div></section>`;
}

function askButton(kind, label) {
	return `<button type="button" class="zs-btn quiet" data-zsask="${esc(kind)}">${lead("sparkles")}${esc(label)}</button>`;
}

function lessonHtml(tl, node, entry, v) {
	const kids = v.edges.filter((e) => e.from === node.id).map((e) => v.nodes.find((n) => n.id === e.to)).filter(Boolean);
	const parents = (node.parents || []).map((id) => v.nodes.find((n) => n.id === id)).filter(Boolean);
	const imgs = (node.images || []).map((img) => ({ ...img, src: imageSrc(img) })).filter((img) => img.src);
	const svg = typeof node.svg === "string" && node.svg.trim().startsWith("<svg") ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(node.svg)}` : "";
	const gallery = imgs.length || svg
		? `<div class="zs-gallery">${svg ? `<figure class="zs-fig"><img src="${svg}" alt=""></figure>` : ""}${imgs.map((img) =>
			`<figure class="zs-fig"><img src="${esc(img.src)}" alt="${esc(img.caption || "")}" loading="lazy" referrerpolicy="no-referrer">${img.caption || img.credit ? `<figcaption>${esc(img.caption || "")}${img.credit ? ` <span class="hint">${esc(img.credit)}</span>` : ""}</figcaption>` : ""}</figure>`).join("")}</div>`
		: "";
	const navList = (list, label) => list.length ? `<div class="zs-nav-list"><span class="hint">${label}</span>${list.map((n) => `<button type="button" class="zs-pill is-${esc(n.state)}" data-zsnode="${esc(n.id)}">${esc(n.title)}</button>`).join("")}</div>` : "";
	return `<header class="zs-lesson-top"><button type="button" class="zs-btn quiet" data-zsback="1">${lead("chevron-left")}${esc(tl.title)}</button>` +
		`<span class="zs-chip ${entry?.state === "mastered" ? "ok" : entry?.state === "next" ? "next" : ""}">${esc(STATE_LABEL[entry?.state] || "")}</span></header>` +
		`<article class="zs-lesson">` +
		(node.era ? `<div class="zs-era big">${esc(node.era)}</div>` : "") +
		`<h1 class="zs-lesson-title">${esc(node.title)}</h1>` +
		(node.summary ? `<p class="zs-lead">${esc(node.summary)}</p>` : "") +
		gallery +
		(node.body ? `<div class="zs-body md">${U.md(node.body)}</div>` : "") +
		(node.progress?.feedback ? `<div class="zs-teacher">${lead("graduation")}<span>${esc(node.progress.feedback)}</span></div>` : "") +
		quizHtml(node) + worksheetHtml(node) + sourcesHtml(node.sources) +
		`<footer class="zs-lesson-foot">${navList(parents, "Vorher")}${navList(kids, "Weiter")}</footer>` +
		`</article>`;
}

function emptyHtml() {
	return `<div class="zs-empty zs-welcome"><div class="zs-welcome-icon">${icon("timeline", "", 40)}</div><h1>KI-Zeitstrahl</h1>` +
		`<p>Die KI baut aus deinen Skripten, Notizen, Altklausuren und Wikipedia eine Lernwelt: Lektionen als Zeitstrahl mit Geschichte, Bildern, Kontrollfragen und Arbeitsblättern – zielgerichtet auf deine Klausur.</p>` +
		`${askButton("build", "Zeitstrahl mit der KI bauen")}</div>`;
}

// Eigenes Theme der KI: per CSS-Nesting auf diesen Zeitstrahl begrenzt (der Kern hat es entschärft).
function themeStyle(tl) {
	const css = String(tl.theme?.css || "");
	if (!css.trim()) return "";
	const id = String(tl.id).replace(/[^a-z0-9_-]/gi, "");
	return `<style>.zs-world[data-zs="${id}"]{${css.replace(/<\//g, "")}}</style>`;
}

// ---------- Zeichnen ----------
function render(main) {
	main._lastPageShellHtml = null;
	if (!ZS_STORE.ready()) {
		if (main.dataset.zsKey !== "loading") { main.innerHTML = `<div class="zs-world"><div class="zs-empty">Lädt …</div></div>`; main.dataset.zsKey = "loading"; }
		ZS_STORE.load().then(rerender);
		return;
	}
	const tl = currentTimeline();
	const node = tl && ui.node ? nodeOf(tl, ui.node) : null;
	if (ui.node && !node) ui.node = null;
	// Nur bei echten Änderungen neu aufbauen – sonst gingen Eingaben im Quiz bei jedem App-Render verloren.
	const key = tl ? `${tl.id}|${tl.updated}|${node?.id || ""}` : "empty";
	if (main.dataset.zsKey === key && main.querySelector(".zs-world")) return;
	// Scrollstand des Graphen über Neuaufbauten hinweg halten.
	const prevScroll = main.querySelector("[data-zsscroll]");
	const scrollPos = prevScroll ? { l: prevScroll.scrollLeft, t: prevScroll.scrollTop } : null;
	main.dataset.zsKey = key;
	if (!tl) { main.innerHTML = `<div class="zs-world" data-key="zs">${emptyHtml()}</div>`; return; }
	const v = ZS_CORE.view(tl);
	const accent = /^#[0-9a-f]{3,8}$/i.test(String(tl.theme?.accent || "")) ? `--zs-accent:${tl.theme.accent};` : "";
	main.innerHTML = `<div class="zs-world${node ? " is-lesson" : ""}" data-key="zs" data-zs="${esc(String(tl.id).replace(/[^a-z0-9_-]/gi, ""))}" style="${accent}">` +
		themeStyle(tl) + (node ? lessonHtml(tl, node, v.nodes.find((n) => n.id === node.id), v) : graphHtml(tl, v)) + `</div>`;
	const scroll = main.querySelector("[data-zsscroll]");
	if (scroll && scrollPos && !node) { scroll.scrollLeft = scrollPos.l; scroll.scrollTop = scrollPos.t; }
	if (node) { main.scrollTop = 0; U.renderMath?.(main.querySelector(".zs-lesson")); }
}

function treeHtml() {
	if (!ZS_STORE.ready()) { ZS_STORE.load().then(rerender); return `<div class="empty small">Lädt …</div>`; }
	const list = ZS_STORE.all();
	const cur = currentTimeline();
	let html = `<div class="ws-head"><span class="ws-name">${lead("timeline")}KI-Zeitstrahl</span></div>`;
	if (!list.length) return html + `<div class="empty small">Noch kein Zeitstrahl</div>`;
	for (const tl of list) {
		const e = ZS_CORE.listEntry(tl);
		const active = cur && tl.id === cur.id;
		html += `<div class="row zs-row${active && !ui.node ? " active" : ""}" data-zstl="${esc(tl.id)}"><span class="row-title">${esc(tl.title)}</span><span class="hint">${e.mastered}/${e.total}</span></div>`;
		if (!active) continue;
		const v = ZS_CORE.view(tl);
		const nodes = v.nodes.slice().sort((a, b) => a.col - b.col || a.lane - b.lane);
		html += nodes.map((n) => `<div class="row zs-row zs-sub is-${esc(n.state)}${ui.node === n.id ? " active" : ""}" data-zsnode="${esc(n.id)}" style="--depth:1"><span class="zs-dot"></span><span class="row-title">${esc(n.title)}</span></div>`).join("");
	}
	return html;
}

// ---------- KI-Kontext & Aufträge ----------
function workspace() {
	const tl = ZS_STORE.ready() ? currentTimeline() : null;
	if (!tl) return { title: "KI-Zeitstrahl (leer)", content: "Der Nutzer ist im KI-Zeitstrahl-Modus, es gibt noch keinen Zeitstrahl. Werkzeuge: edit_timeline, read_timeline, check_lesson, wikipedia, create_worksheet." };
	const node = ui.node ? nodeOf(tl, ui.node) : null;
	const d = ZS_CORE.describe(tl, node?.id);
	return {
		title: node ? `KI-Zeitstrahl „${tl.title}“ – Lektion „${node.title}“` : `KI-Zeitstrahl „${tl.title}“`,
		content: "KI-Zeitstrahl (Lehrer-Datenbank; Werkzeuge read_timeline, edit_timeline, check_lesson, wikipedia, create_worksheet):\n" + JSON.stringify(d).slice(0, 9000),
	};
}

function askPrompt(kind, tl, node) {
	const where = tl ? `im Zeitstrahl „${tl.title}“` : "";
	switch (kind) {
		case "quiz": return `Bewerte bitte meine Freitext-Antworten im Quiz der Lektion „${node.title}“ ${where}: lies sie mit read_timeline (node) und trage das Ergebnis mit check_lesson ein, mit kurzem Feedback.`;
		case "worksheet": return `Ich bin mit dem Arbeitsblatt „${node.worksheet}“ zur Lektion „${node.title}“ ${where} fertig. Sieh dir bitte die Heftseiten mit view_heft_page an, prüfe meine Lösungen und trage das Ergebnis mit check_lesson ein (worksheet passed oder failed, kurzes Feedback).`;
		case "make-worksheet": return `Erstelle bitte mit create_worksheet ein Arbeitsblatt zur Lektion „${node.title}“ ${where} (passend zu Story und Klausurstoff) und verknüpfe es danach mit edit_timeline (worksheet = Hefttitel).`;
		case "build": return tl
			? `Baue bitte die Lektionen für den Zeitstrahl „${tl.title}“ aus: lies meine Skripte/Notizen (search, read_pages) und passende Wikipedia-Artikel und lege die Knoten mit edit_timeline an (Story, Bilder, Quellen, Quiz, Verzweigungen).`
			: `Baue mir einen KI-Zeitstrahl für das Fach `;
		default: return "";
	}
}

async function ask(kind) {
	const tl = ZS_STORE.ready() ? currentTimeline() : null;
	const node = tl && ui.node ? nodeOf(tl, ui.node) : null;
	const text = askPrompt(kind, tl, node);
	if (!text) return;
	document.body.classList.remove("panel-collapsed");
	// Offener Auftrag (Fach fehlt): nur vorbefüllen, der Nutzer ergänzt und schickt ab.
	if (kind === "build" && !tl) {
		const inp = document.getElementById("chatInput");
		if (inp) {
			inp.value = text + "…: lies dazu meine Skripte (search, read_pages) und Wikipedia und lege ihn mit edit_timeline an.";
			inp.focus();
			inp.setSelectionRange(text.length, text.length + 1);
			inp.dispatchEvent(new Event("input", { bubbles: true }));
		}
		return;
	}
	if (S.aiBusy) { U.toast?.("Eine KI-Antwort läuft bereits.", "error"); return; }
	if (kind === "worksheet" && node && node.progress?.worksheet?.status !== "submitted") {
		const out = ZS_CORE.applyCheck(tl, { timeline: tl.id, node: node.id, worksheet: "submitted" });
		if (!out.error) await ZS_STORE.put(out.timeline);
	}
	const { CHAT_FULLSCREEN } = await import("./chat-fullscreen.js");
	await CHAT_FULLSCREEN.sendChatMessage(text, "side");
}

function collectAnswers(root, node) {
	return (node.quiz || []).map((q, i) => {
		const li = root.querySelector(`[data-zsq="${i}"]`);
		if (!li) return null;
		if (q.type === "choice") return [...li.querySelectorAll("input:checked")].map((x) => Number(x.value));
		if (q.type === "cloze") return [...li.querySelectorAll(".zs-gap")].map((x) => x.value);
		const el = li.querySelector(".zs-input");
		return el ? el.value : "";
	});
}

async function submitQuiz(root) {
	const tl = currentTimeline();
	const node = tl && nodeOf(tl, ui.node);
	if (!node) return;
	const out = ZS_CORE.recordQuiz(tl, node.id, collectAnswers(root, node));
	if (out.error) { U.toast?.(out.error, "error"); return; }
	await ZS_STORE.put(out.timeline);
	const g = out.grade;
	U.toast?.(g.passed ? "Quiz bestanden!" : g.pending_ai?.length ? `${g.auto_correct}/${g.auto_total} automatisch richtig – Freitext prüft die KI.` : `${g.auto_correct}/${g.auto_total} richtig – noch nicht bestanden.`);
}

function open(tlId, nodeId) {
	if (tlId !== undefined) ui.tl = tlId;
	ui.node = nodeId || null;
	saveUi();
	if (S.view !== "zeitstrahl") { S.view = "zeitstrahl"; S.sidebarMode = "files"; }
	rerender();
}

// Klicks: eigene Delegation (wie library.js), nur für data-zs*-Ziele.
if (typeof document !== "undefined") {
	document.addEventListener("click", (e) => {
		const t = e.target?.closest?.("[data-zsnode],[data-zstl],[data-zsback],[data-zsquiz],[data-zsask],[data-zsopen]");
		if (!t) return;
		const d = t.dataset;
		if (d.zsopen) {
			e.preventDefault();
			import("./tabs.js").then(({ TABS }) => TABS.openPage(d.zsopen));
			return;
		}
		e.preventDefault();
		if (d.zstl) return open(d.zstl, null);
		if (d.zsnode) return open(undefined, d.zsnode);
		if (d.zsback) return open(undefined, null);
		if (d.zsquiz) return void submitQuiz(t.closest(".zs-world"));
		if (d.zsask) return void ask(d.zsask);
	});
}

BUS.on("zs:changed", () => { if (S.view === "zeitstrahl" || S.sidebarMode === "files") rerender(); });
BUS.provide("zs:workspace", workspace);

export const ZS = { enabled, render, treeHtml, open };
