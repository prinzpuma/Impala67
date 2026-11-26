"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { BUS } from "./event-bus.js";
import { icon, lead } from "./icons.js";
import { ZS_STORE, ZS_CORE } from "./zeitstrahl-store.js";
import { overviewHtml, attachOverview, focusNext, orderedNodes, fmtYear, examInfo, STATE_LABEL, LAYOUTS } from "./zeitstrahl-graph.js";
import { openTimelineDialog, openNodeDialog, sendAi, skeletonPrompt, fillPrompt, downloadJson } from "./zeitstrahl-dialogs.js";
import { openOnboarding } from "./zeitstrahl-onboarding.js";
import { openLightbox, openSourcePreview, lessonEditorHtml, wireLessonEditor } from "./zeitstrahl-edit.js";
import { confidenceHtml, refreshHtml, submitRefresh, readInput } from "./zeitstrahl-refresh.js";

// zeitstrahl.js — KI-Zeitstrahl: Übersicht der Lernwelten, Faden/Streifen (zeitstrahl-graph.js) und
// Lektionsansicht. Konzept: docs/KI-LEHRERMODUS-PLAN.md §6.
// Opt-in über Einstellungen → Lernen → Beta-Lernfunktionen (S.settings.experiments.zeitstrahl).
// Daten: eigene Lehrer-Datenbank (zeitstrahl-store.js), Logik im Kern (core/impala-lehrer).

const esc = (s) => U.esc(String(s ?? ""));
const enabled = () => !!S.settings?.experiments?.zeitstrahl;

const UI_KEY = "impala67Zeitstrahl";
const ui = (() => {
	const base = { tl: null, node: null, layout: LAYOUTS[0], editing: false, treeFilter: "", phase: null, pretestResult: null, refresh: null, refreshOutcome: null };
	try { const u = { ...base, ...JSON.parse(localStorage.getItem(UI_KEY) || "{}") }; return { ...u, editing: false, treeFilter: "", phase: null, pretestResult: null, refresh: null, refreshOutcome: null, layout: LAYOUTS.includes(u.layout) ? u.layout : LAYOUTS[0] }; } catch { return base; }
})();
function saveUi() { try { localStorage.setItem(UI_KEY, JSON.stringify({ tl: ui.tl, node: ui.node, layout: ui.layout })); } catch {} }

const rerender = () => BUS.emit("ui:render");

/** Offener Zeitstrahl; ohne Auswahl die Übersicht (null). */
function currentTimeline() {
	const tl = ui.tl ? ZS_STORE.getSync(ui.tl) : null;
	if (ui.tl && !tl) { ui.tl = null; ui.node = null; }
	return tl;
}
const nodeOf = (tl, id) => (tl?.nodes || []).find((n) => n.id === id) || null;
const WS_LABEL = { open: "offen", submitted: "eingereicht", passed: "bestanden", failed: "nochmal" };
const KIND_LABEL = { history: ["timeline", "Geschichte"], path: ["trending-up", "Lernpfad"] };

// Schrift auf der Akzentfarbe der KI: hell oder dunkel je nach Helligkeit.
function onAccent(hex) {
	let h = String(hex).slice(1);
	if (h.length <= 4) h = [...h].slice(0, 3).map((c) => c + c).join("");
	const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? "#141414" : "#ffffff";
}

function examChip(exam) {
	const ex = examInfo(exam);
	return ex ? `<span class="zs-chip ${ex.days < 0 ? "" : ex.days <= 14 ? "warn" : "next"}">${icon("target")}Klausur ${esc(ex.rel)}</span>` : "";
}

// ---------- Übersicht ----------
function cardHtml(tl) {
	const e = ZS_CORE.listEntry(tl);
	const v = ZS_CORE.view(tl);
	const [kIcon, kLabel] = KIND_LABEL[e.kind] || KIND_LABEL.history;
	const dots = v.nodes.slice().sort((a, b) => a.col - b.col || a.lane - b.lane).slice(0, 14)
		.map((n) => `<i class="is-${esc(n.state)}${n.draft ? " is-draft" : ""}"></i>`).join("");
	const accent = /^#[0-9a-f]{3,8}$/i.test(e.accent || "") ? ` style="--zs-accent:${e.accent}"` : "";
	return `<button type="button" class="zs-card" data-zstl="${esc(tl.id)}"${accent}>` +
		`<span class="zs-card-strip" aria-hidden="true">${dots || "<i></i><i></i><i></i>"}</span>` +
		`<span class="zs-eyebrow">${icon(kIcon)}${esc([kLabel, e.subject].filter(Boolean).join(" · "))}</span>` +
		`<span class="zs-card-title">${esc(e.title)}</span>` +
		(e.description ? `<span class="zs-card-desc">${esc(e.description)}</span>` : "") +
		`<span class="zs-card-foot"><span class="zs-card-count"><b>${e.mastered}</b>/${e.total} geschafft</span>` +
		`<span class="zs-card-chips">${e.drafts ? `<span class="zs-chip">${icon("pen-tool")}${e.drafts} Entwürfe</span>` : ""}${examChip(e.exam)}</span></span></button>`;
}

function homeHtml() {
	const list = ZS_STORE.all();
	if (!list.length) {
		return `<div class="zs-welcome"><div class="zs-welcome-art" aria-hidden="true"><i class="is-mastered"></i><i class="is-mastered"></i><i class="is-next"></i><i></i><i></i><b>${icon("target", "", 22)}</b></div>` +
			`<h1>Lern dein Fach als Geschichte</h1>` +
			`<p>Die KI baut aus deinen Skripten, Notizen und Altklausuren einen Zeitstrahl: erst ein kurzes Interview zu deinem Ziel, dann ein Gerüst und Lektionen mit Story, Bildern, Kontrollfragen und Arbeitsblättern – bis zur Klausur.</p>` +
			`<div class="zs-actions center"><button type="button" class="zs-btn primary big" data-zsnew="1">${lead("sparkles")}Ersten Zeitstrahl starten</button>` +
			`<button type="button" class="zs-btn" data-zsimport="1">${lead("upload")}Backup importieren</button></div></div>`;
	}
	return `<div class="zs-home"><header class="zs-home-head"><div><div class="zs-eyebrow">${icon("timeline")}KI-Zeitstrahl</div><h1>Deine Lernwelten</h1></div>` +
		`<div class="zs-hero-actions"><button type="button" class="zs-btn quiet" data-zsimport="1" title="JSON-Backup importieren">${lead("upload")}Import</button>` +
		`<button type="button" class="zs-btn quiet" data-zsexport="all" title="Alle Zeitstrahlen als JSON sichern">${lead("download")}Backup</button>` +
		`<button type="button" class="zs-btn primary" data-zsnew="1">${lead("sparkles")}Neuer Zeitstrahl</button></div></header>` +
		`<div class="zs-cards">${list.map(cardHtml).join("")}` +
		`<button type="button" class="zs-card zs-card-new" data-zsnew="1">${icon("plus", "", 26)}<span>Neuer Zeitstrahl</span><small>Interview oder MCP</small></button></div></div>`;
}

// ---------- Graph-Ansicht ----------
function heroHtml(tl, v) {
	const next = v.nodes.filter((n) => n.state === "next").sort((a, b) => a.col - b.col)[0];
	const [, kLabel] = KIND_LABEL[v.kind] || KIND_LABEL.history;
	const ex = examInfo(tl.exam);
	const meta = [tl.subject || kLabel, `${v.stats.mastered} von ${v.stats.total} geschafft`, ex ? `Klausur ${ex.rel}` : ""].filter(Boolean).join(" · ");
	return `<header class="zs-hero">` +
		`<button type="button" class="zs-iconbtn" data-zshome="1" aria-label="Alle Zeitstrahlen" title="Alle Zeitstrahlen">${icon("chevron-left")}</button>` +
		`<div class="zs-hero-copy"><h1 class="zs-title">${esc(tl.title)}</h1><p class="zs-sub">${esc(meta)}</p></div>` +
		`<div class="zs-hero-actions">` +
		`<div class="zs-vseg" role="group" aria-label="Ansicht">` +
		[["faden", "Faden"], ["reel", "Streifen"]].map(([k, l]) => `<button type="button" data-zslayout="${k}" aria-pressed="${ui.layout === k}">${l}</button>`).join("") + `</div>` +
		`<button type="button" class="zs-iconbtn" data-zsadd="1" aria-label="Lektion hinzufügen" title="Lektion hinzufügen">${icon("plus")}</button>` +
		`<button type="button" class="zs-iconbtn" data-zsedit="tl" aria-label="Zeitstrahl bearbeiten" title="Zeitstrahl bearbeiten">${icon("gear")}</button>` +
		(next ? `<button type="button" class="zs-btn primary" data-zsnode="${esc(next.id)}">${lead("play")}Weiterlernen</button>` : "") +
		`</div></header>` +
		(v.stats.drafts
			? `<p class="zs-note">${v.stats.drafts} von ${v.stats.total} Lektionen sind noch Entwürfe – prüfen, dann <button type="button" class="zs-link" data-zsask="fill">ausarbeiten lassen</button>.</p>`
			: "");
}

function todayBandHtml(v) {
	const t = v.today || {};
	const hasRefresh = (t.refresh_nodes || 0) > 0;
	const weak = t.weak_nodes || [];
	const hasPace = t.days_to_exam > 0 && t.new_per_day > 0;
	if (!hasRefresh && !weak.length && !hasPace) return "";
	const parts = [];
	if (hasRefresh) {
		parts.push(`<button type="button" class="zs-btn primary" data-zsrefresh="1">${lead("zap")}Heute auffrischen (${t.refresh_nodes} · ca. ${t.refresh_minutes} Min.)</button>`);
	}
	if (hasPace) {
		parts.push(`<span class="zs-chip">${icon("target")}Ziel: ca. ${t.new_per_day} neue ${t.new_per_day === 1 ? "Lektion" : "Lektionen"}/Tag (${t.days_to_exam} Tage)</span>`);
	}
	const radar = weak.length
		? `<div class="zs-radar"><span class="zs-chip bad">${icon("alert")}Schwachstellen:</span>` +
			weak.slice(0, 3).map((w) =>
				`<button type="button" class="zs-pill is-weak" data-zsnode="${esc(w.id)}">${esc(w.title)}</button>` +
				`<button type="button" class="zs-link" data-zsweak="${esc(w.id)}" title="KI um vertiefende Übung / Zwischenlektion bitten">${icon("sparkles")}Übung</button>`
			).join("") + `</div>`
		: "";
	return `<div class="zs-today"><div class="zs-today-row">${parts.join("")}</div>${radar}</div>`;
}

function graphViewHtml(tl, v) {
	if (!v.nodes.length) {
		return heroHtml(tl, v) + `<div class="zs-empty">${icon("sprout", "", 36)}<h2>Noch keine Lektionen</h2><p>Lass die KI ein Gerüst bauen oder lege die erste Lektion selbst an.</p>` +
			`<div class="zs-actions center"><button type="button" class="zs-btn primary" data-zsask="build">${lead("sparkles")}Gerüst bauen lassen</button>` +
			`<button type="button" class="zs-btn" data-zsadd="1">${lead("plus")}Lektion anlegen</button></div></div>`;
	}
	return heroHtml(tl, v) + todayBandHtml(v) + overviewHtml(v, ui.layout);
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
	return `<li class="zs-q${solved ? ` has-res is-${result.correct === true ? "ok" : result.correct === false ? "bad" : "wait"}` : ""}" data-zsq="${i}" data-type="${esc(q.type)}">` +
		`<div class="zs-q-head"><span class="zs-q-no">${i + 1}</span>${resultMark(solved ? result : null)}</div>${prompt}${input}${confidenceHtml(`conf-q-${i}`)}${expected}${feedback}${explain}</li>`;
}

function quizHtml(node) {
	const quiz = node.quiz || [];
	if (!quiz.length) return "";
	const attempt = node.progress?.quiz || null;
	const results = attempt?.results || [];
	const pending = results.some((r) => r && r.correct == null);
	const status = node.progress?.quiz_passed ? `<span class="zs-chip ok">${icon("check")}bestanden</span>`
		: attempt ? (pending ? `<span class="zs-chip wait">KI-Bewertung offen</span>` : `<span class="zs-chip bad">noch nicht bestanden</span>`) : "";
	return `<section class="zs-sec zs-quiz"><h3>${lead("help")}Abruf-Check ${status}</h3>` +
		`<p class="hint">Der Lesetext ist ausgeblendet, damit du wirklich aus dem Gedächtnis antwortest. Klicke optional kurz an, wie sicher du dir bist.</p>` +
		`<ol class="zs-qs">${quiz.map((q, i) => questionHtml(q, i, attempt?.answers?.[i], results[i], !!attempt)).join("")}</ol>` +
		`<div class="zs-actions"><button type="button" class="zs-btn primary" data-zsquiz="1">${lead("check")}Antworten prüfen</button>` +
		(pending ? askButton("quiz", "Freitext von der KI bewerten lassen") : "") +
		askButton("more-questions", "Neue Fragen-Varianten ergänzen") + `</div></section>`;
}

function pretestHtml(node) {
	const q = node.pretest;
	if (!q) return "";
	const res = ui.pretestResult;
	const prompt = q.q ? `<div class="zs-q-text md">${U.md(q.q)}</div>` : "";
	let input = "";
	if (q.type === "choice") {
		const multi = (q.correct || []).length > 1;
		input = `<div class="zs-options">${(q.options || []).map((o, k) =>
			`<label class="zs-opt"><input type="${multi ? "checkbox" : "radio"}" name="zspt" value="${k}"><span class="md">${U.md(String(o))}</span></label>`).join("")}</div>`;
	} else if (q.type === "number") {
		input = `<div class="zs-num"><input class="zs-input" name="zspt" inputmode="decimal" autocomplete="off" placeholder="Schätzung / Ergebnis">${q.unit ? `<span class="zs-unit">${esc(q.unit)}</span>` : ""}</div>`;
	} else if (q.type === "cloze") {
		let k = 0;
		const parts = String(q.text || "").split(/\{\{[\s\S]*?\}\}/);
		input = `<div class="zs-cloze">${parts.map((p, idx) => esc(p) + (idx < parts.length - 1 ? `<input class="zs-gap" name="zspt" data-gap="${k++}" autocomplete="off">` : "")).join("")}</div>`;
	} else {
		input = `<textarea class="zs-input" name="zspt" rows="2" placeholder="Was vermutest du? …"></textarea>`;
	}
	const fb = res
		? `<div class="zs-pt-res ${res.correct === true ? "is-ok" : "is-info"}">` +
			`<b>${res.correct === true ? "Volltreffer!" : "Guter Einstieg – genau das klärt die Lektion gleich:"}</b>` +
			(res.expected ? `<div class="zs-expected">Hinweis: <span class="md">${U.md(String(res.expected))}</span></div>` : "") +
			(res.explain ? `<div class="zs-explain md">${U.md(res.explain)}</div>` : "") +
			`<div class="zs-actions"><button type="button" class="zs-btn primary" data-zsphase="read">Jetzt Lektion lesen${icon("chevron-right")}</button></div></div>`
		: `<div class="zs-actions"><button type="button" class="zs-btn primary" data-zspretest="1">${lead("check")}Tipp abgeben</button>` +
			`<button type="button" class="zs-btn quiet" data-zsphase="read">Überspringen &amp; lesen</button></div>`;
	return `<section class="zs-sec zs-pretest" data-zsptbox="1"><div class="zs-eyebrow">${icon("bulb")}Einstiegsfrage (Pre-Test)</div>` +
		`<p class="hint">Kurz raten vor dem Lesen aktiviert Vorwissen – selbst wenn du falsch liegst, bleibt die Erklärung danach deutlich besser hängen.</p>` +
		`${prompt}${input}${fb}</section>`;
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

// Lektion ohne Quiz und Arbeitsblatt: gemeistert nur per „erledigt“ (Kern: is_mastered) – das darf der Nutzer selbst.
function doneHtml(node) {
	if ((node.quiz || []).length || node.worksheet) return "";
	const done = !!node.progress?.done;
	return `<section class="zs-sec"><div class="zs-actions">` +
		(done
			? `<span class="zs-chip ok">${icon("check")}erledigt</span><button type="button" class="zs-btn quiet" data-zsdone="0">Wieder öffnen</button>`
			: `<button type="button" class="zs-btn primary" data-zsdone="1">${lead("check")}Gelesen – als erledigt markieren</button>`) +
		`</div></section>`;
}

function askButton(kind, label) {
	return `<button type="button" class="zs-btn quiet" data-zsask="${esc(kind)}">${lead("sparkles")}${esc(label)}</button>`;
}

function nextCards(kids) {
	if (!kids.length) return "";
	return `<section class="zs-sec zs-next"><h3>${lead("arrow-down")}Wie es weitergeht</h3><div class="zs-next-grid">${kids.map((n) =>
		`<button type="button" class="zs-next-card is-${esc(n.state)}" data-zsnode="${esc(n.id)}">` +
		`<span class="zs-node-meta">${n.year != null ? `<b>${esc(fmtYear(n.year))}</b>` : ""}${n.era ? `<span>${esc(n.era)}</span>` : ""}</span>` +
		`<span class="zs-next-title">${esc(n.title)}</span>${n.summary ? `<span class="zs-next-sum">${esc(n.summary)}</span>` : ""}` +
		`<span class="zs-next-go">${esc(STATE_LABEL[n.state] || "")}${icon("chevron-right")}</span></button>`).join("")}</div></section>`;
}

function lessonHtml(tl, node, entry, v) {
	const seq = orderedNodes(v);
	const pos = seq.findIndex((n) => n.id === node.id);
	const prevNode = pos > 0 ? seq[pos - 1] : null;
	const nextNode = pos >= 0 && pos < seq.length - 1 ? seq[pos + 1] : null;
	const kids = v.edges.filter((e) => e.from === node.id).map((e) => v.nodes.find((n) => n.id === e.to)).filter(Boolean);
	const parents = (node.parents || []).map((id) => v.nodes.find((n) => n.id === id)).filter(Boolean);
	const imgs = (node.images || []).map((img) => ({ ...img, src: imageSrc(img) })).filter((img) => img.src);
	const svg = typeof node.svg === "string" && node.svg.trim().startsWith("<svg") ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(node.svg)}` : "";
	const gallery = imgs.length
		? `<div class="zs-gallery${imgs.length === 1 ? " single" : ""}">${imgs.map((img) =>
			`<figure class="zs-fig"><img src="${esc(img.src)}" alt="${esc(img.caption || "")}" data-zslb="1" data-cap="${esc(img.caption || "")}" title="Klicken zum Vergrößern" loading="lazy" referrerpolicy="no-referrer">${img.caption || img.credit ? `<figcaption>${esc(img.caption || "")}${img.credit ? ` <span class="hint">${esc(img.credit)}</span>` : ""}</figcaption>` : ""}</figure>`).join("")}</div>`
		: "";
	const meta = [node.era ? `<span>${esc(node.era)}</span>` : "",
		node.strand ? `<span class="zs-strand-chip">${esc(node.strand)}</span>` : ""].filter(Boolean).join("");
	const draft = entry?.draft
		? `<div class="zs-draft-box">${icon("pen-tool", "", 22)}<div><b>Diese Lektion ist noch ein Entwurf.</b><p>Prüfe Titel, Jahr und Verbindungen – dann schreibt die KI Story, Bilder und Kontrollfragen.</p>` +
			`<div class="zs-actions"><button type="button" class="zs-btn primary" data-zsask="fill-one">${lead("sparkles")}Ausarbeiten lassen</button><button type="button" class="zs-btn" data-zsedtoggle="1">${lead("pen")}Selbst schreiben</button></div></div></div>`
		: "";
	const prev = parents.length ? `<div class="zs-prev"><span class="hint">Baut auf auf</span>${parents.map((n) => `<button type="button" class="zs-pill is-${esc(n.state)}" data-zsnode="${esc(n.id)}">${esc(n.title)}</button>`).join("")}</div>` : "";
	const nav = `<div class="zs-lesson-nav">` +
		`<button type="button" class="zs-iconbtn" ${prevNode ? `data-zsnode="${esc(prevNode.id)}" title="Vorherige: ${esc(prevNode.title)} (Alt+←)"` : "disabled"} aria-label="Vorherige Lektion">${icon("chevron-left")}</button>` +
		`<span class="zs-nav-pos hint">${pos >= 0 ? `${pos + 1}/${seq.length}` : ""}</span>` +
		`<button type="button" class="zs-iconbtn" ${nextNode ? `data-zsnode="${esc(nextNode.id)}" title="Nächste: ${esc(nextNode.title)} (Alt+→)"` : "disabled"} aria-label="Nächste Lektion">${icon("chevron-right")}</button></div>`;
	const hasPretest = !!node.pretest;
	const hasQuiz = (node.quiz || []).length > 0;
	const phase = ui.phase || (hasPretest && !node.progress?.pretest_done ? "pretest" : "read");
	const phaseBar = !entry?.draft && !ui.editing && (hasPretest || hasQuiz)
		? `<div class="zs-phases" role="tablist">` +
			(hasPretest ? `<button type="button" class="zs-phase${phase === "pretest" ? " is-on" : ""}" data-zsphase="pretest">${lead("bulb")}1. Einstieg</button>` : "") +
			`<button type="button" class="zs-phase${phase === "read" ? " is-on" : ""}" data-zsphase="read">${lead("book-open")}${hasPretest ? "2. " : "1. "}Verstehen</button>` +
			(hasQuiz ? `<button type="button" class="zs-phase${phase === "quiz" ? " is-on" : ""}" data-zsphase="quiz">${lead("help")}${hasPretest ? "3. " : "2. "}Abruf-Check${node.progress?.quiz_passed ? " ✓" : ""}</button>` : "") +
			`</div>`
		: "";
	const freshChip = entry?.state === "mastered" && entry?.freshness
		? `<span class="zs-chip ${entry.memory_state === "weak" ? "bad" : entry.memory_state === "due" || entry.memory_state === "fading" ? "warn" : "ok"}">Frische ${entry.freshness}%</span>`
		: "";
	const readCta = hasQuiz && phase === "read" && !entry?.draft
		? `<div class="zs-phase-cta"><button type="button" class="zs-btn primary" data-zsphase="quiz">${lead("help")}Text schließen &amp; Abruf-Check starten</button></div>`
		: "";
	const phaseContent = phase === "pretest" && hasPretest
		? pretestHtml(node)
		: phase === "quiz" && hasQuiz
			? quizHtml(node) + worksheetHtml(node)
			: draft + gallery +
				(node.body ? `<div class="zs-body md">${U.md(node.body)}</div>` : "") +
				(node.progress?.feedback ? `<div class="zs-teacher">${lead("graduation")}<span>${esc(node.progress.feedback)}</span></div>` : "") +
				readCta +
				(entry?.draft ? "" : (!hasQuiz ? worksheetHtml(node) + doneHtml(node) : "")) +
				sourcesHtml(node.sources) + nextCards(kids);
	return `<header class="zs-lesson-top"><button type="button" class="zs-btn quiet" data-zsback="1">${lead("chevron-left")}${esc(tl.title)}</button>` +
		nav + freshChip +
		`<span class="zs-chip ${entry?.state === "mastered" ? "ok" : entry?.state === "next" ? "next" : ""}">${esc(STATE_LABEL[entry?.state] || "")}</span>` +
		`<button type="button" class="zs-btn quiet" data-zsedtoggle="1" title="Text und Quiz direkt bearbeiten">${lead("pen")}${ui.editing ? "Fertig" : "Inhalt"}</button>` +
		`<button type="button" class="zs-iconbtn" data-zsedit="node" aria-label="Metadaten bearbeiten" title="Titel, Jahr & Verbindungen bearbeiten">${icon("gear")}</button></header>` +
		`<article class="zs-lesson">` +
		`<div class="zs-lesson-hero">` +
		(node.year != null || svg ? `<div class="zs-lesson-head">${node.year != null ? `<div class="zs-lesson-year">${esc(fmtYear(node.year))}</div>` : ""}` +
			(svg ? `<img class="zs-lesson-art" src="${svg}" alt="" data-zslb="1" title="Klicken zum Vergrößern">` : "") + `</div>` : "") +
		(meta ? `<div class="zs-node-meta big">${meta}</div>` : "") +
		`<h1 class="zs-lesson-title">${esc(node.title)}</h1>` +
		(node.summary && !ui.editing ? `<p class="zs-lead">${esc(node.summary)}</p>` : "") + prev + `</div>` +
		phaseBar +
		(ui.editing ? lessonEditorHtml(node) : phaseContent) +
		`</article>`;
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
	const key = tl ? `${tl.id}|${tl.updated}|${node?.id || ""}|${ui.phase || ""}|${ui.pretestResult ? "pt" : ""}|${ui.refresh ? "ref" : ""}|${ui.refreshOutcome ? "ro" : ""}|${ui.editing ? "ed" : ""}|${ui.layout}` : `home|${ZS_STORE.all().map((t) => t.id + t.updated).join(",")}`;
	if (main.dataset.zsKey === key && main.querySelector(".zs-world")) return;
	// Gleiche Übersicht neu aufgebaut (Daten geändert): Scrollstand halten.
	const sameOverview = !!tl && !node && !ui.refresh && main.dataset.zsTl === tl.id && main.dataset.zsLayout === ui.layout && !!main.querySelector(".zs-world.is-graph");
	const scrollPos = sameOverview ? { t: main.scrollTop, l: main.querySelector("[data-zsreel]")?.scrollLeft || 0 } : null;
	// Gleiche Lektion neu aufgebaut (Quiz geprüft, KI hat bewertet): Lesestelle und Eingaben behalten.
	const sameLesson = !!node && main.dataset.zsNode === node.id && !!main.querySelector(".zs-lesson");
	const keep = sameLesson ? { top: main.scrollTop, inputs: snapshotInputs(main) } : null;
	main.dataset.zsKey = key;
	main.dataset.zsNode = node?.id || "";
	main.dataset.zsTl = tl?.id || "";
	main.dataset.zsLayout = node ? "" : ui.layout;
	if (!tl) { main.innerHTML = `<div class="zs-world is-home" data-key="zs">${homeHtml()}</div>`; main.scrollTop = 0; return; }
	const v = ZS_CORE.view(tl);
	const acc = String(tl.theme?.accent || "");
	const accent = /^#[0-9a-f]{3,8}$/i.test(acc) ? `--zs-accent:${acc};--zs-on-accent:${onAccent(acc)};` : "";
	const bodyHtml = ui.refresh
		? refreshHtml(tl, ui.refresh, ui.refreshOutcome)
		: node
			? lessonHtml(tl, node, v.nodes.find((n) => n.id === node.id), v)
			: graphViewHtml(tl, v);
	main.innerHTML = `<div class="zs-world${node || ui.refresh ? " is-lesson" : " is-graph"}" data-key="zs" data-zs="${esc(String(tl.id).replace(/[^a-z0-9_-]/gi, ""))}" style="${accent}">` +
		themeStyle(tl) + bodyHtml + `</div>`;
	if (ui.refresh) {
		U.renderMath?.(main.querySelector(".zs-lesson"));
		main.scrollTop = 0;
		return;
	}
	if (node) {
		if (ui.editing) wireLessonEditor(main, tl, node, { onDone: () => { ui.editing = false; rerender(); } });
		else U.renderMath?.(main.querySelector(".zs-lesson"));
		if (keep && !ui.editing) { restoreInputs(main, keep.inputs); main.scrollTop = keep.top; } else main.scrollTop = 0;
		return;
	}
	main.scrollTop = 0;
	attachOverview(main);
	if (scrollPos) {
		main.scrollTop = scrollPos.t;
		const reel = main.querySelector("[data-zsreel]");
		if (reel) reel.scrollLeft = scrollPos.l;
	} else requestAnimationFrame(() => focusNext(main, main));
}

// Eingaben im Quiz je Feld (Name + Lücke bzw. Wert) – überleben so einen Neuaufbau der Lektion.
function snapshotInputs(root) {
	const out = new Map();
	for (const el of root.querySelectorAll(".zs-qs input, .zs-qs textarea")) {
		if (el.type === "radio" || el.type === "checkbox") out.set(`${el.name}|v${el.value}`, el.checked);
		else out.set(`${el.name}|g${el.dataset.gap || ""}`, el.value);
	}
	return out;
}
function restoreInputs(root, saved) {
	for (const el of root.querySelectorAll(".zs-qs input, .zs-qs textarea")) {
		if (el.type === "radio" || el.type === "checkbox") {
			const v = saved.get(`${el.name}|v${el.value}`);
			if (v !== undefined) el.checked = v;
		} else {
			const v = saved.get(`${el.name}|g${el.dataset.gap || ""}`);
			if (v !== undefined) el.value = v;
		}
	}
}

function treeHtml() {
	if (!ZS_STORE.ready()) { ZS_STORE.load().then(rerender); return `<div class="empty small">Lädt …</div>`; }
	const list = ZS_STORE.all();
	const cur = currentTimeline();
	let html = `<div class="ws-head"><span class="ws-name">${lead("timeline")}KI-Zeitstrahl</span></div>` +
		`<div class="row zs-row${!cur ? " active" : ""}" data-zshome="1"><span class="row-title">${lead("grid")}Alle Zeitstrahlen</span></div>`;
	for (const tl of list) {
		const e = ZS_CORE.listEntry(tl);
		const active = cur && tl.id === cur.id;
		html += `<div class="row zs-row${active && !ui.node ? " active" : ""}" data-zstl="${esc(tl.id)}"><span class="row-title">${esc(tl.title)}</span><span class="hint">${e.mastered}/${e.total}</span></div>`;
		if (!active) continue;
		const v = ZS_CORE.view(tl);
		const nodes = orderedNodes(v);
		if (nodes.length > 5) {
			html += `<div class="zs-tree-filter"><input type="search" data-zstreefilter="1" value="${esc(ui.treeFilter)}" placeholder="Lektionen filtern …" autocomplete="off"></div>`;
		}
		const q = ui.treeFilter.trim().toLowerCase();
		const filtered = q ? nodes.filter((n) => `${n.title} ${n.era || ""} ${n.strand || ""} ${n.year ?? ""}`.toLowerCase().includes(q)) : nodes;
		const hasEra = filtered.some((n) => n.era);
		const hasStrand = !hasEra && filtered.some((n) => n.strand);
		let lastGroup = null;
		for (const n of filtered) {
			const grp = hasEra ? (n.era || "Ohne Epoche") : hasStrand ? (n.strand || "Allgemein") : null;
			if (grp && grp !== lastGroup) {
				html += `<div class="zs-tree-grp">${esc(grp)}</div>`;
				lastGroup = grp;
			}
			const yr = v.kind !== "path" && n.year != null ? `<span class="zs-tree-yr">${esc(fmtYear(n.year))}</span>` : "";
			html += `<div class="row zs-row zs-sub is-${esc(n.state)}${n.draft ? " is-draft" : ""}${ui.node === n.id ? " active" : ""}" data-zsnode="${esc(n.id)}" style="--depth:1"><span class="zs-dot"></span>${yr}<span class="row-title">${esc(n.title)}</span></div>`;
		}
	}
	return html + `<div class="row zs-row zs-new-row" data-zsnew="1"><span class="row-title">${lead("plus")}Neuer Zeitstrahl</span></div>`;
}

// ---------- KI-Kontext & Aufträge ----------
function workspace() {
	const tl = ZS_STORE.ready() ? currentTimeline() : null;
	if (!tl) {
		const list = ZS_STORE.ready() ? ZS_STORE.all().map((t) => t.title) : [];
		return { title: "KI-Zeitstrahl (Übersicht)", content: `Der Nutzer ist in der Übersicht des KI-Zeitstrahls. Zeitstrahlen: ${list.length ? list.join(", ") : "noch keine"}. Werkzeuge: edit_timeline, read_timeline, check_lesson, wikipedia, create_worksheet.` };
	}
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
		case "more-questions": return `Ergänze bitte im Zeitstrahl „${tl.title}“ für die Lektion „${node.title}“ 3–4 frische, abgewandelte Anwendungs-/Transferfragen im quiz-Pool (mit edit_timeline, bestehende Fragen behalten oder erweitern, inkl. kurzer explain-Begründung).`;
		case "build": return skeletonPrompt(tl, { focus: tl.description });
		case "fill-one": return fillPrompt(tl, [node]);
		case "fill": {
			const v = ZS_CORE.view(tl);
			const order = { next: 0, later: 1, mastered: 2 };
			const drafts = v.nodes.filter((n) => n.draft).sort((a, b) => order[a.state] - order[b.state] || a.col - b.col);
			return drafts.length ? fillPrompt(tl, drafts) : "";
		}
		default: return "";
	}
}

async function ask(kind) {
	const tl = ZS_STORE.ready() ? currentTimeline() : null;
	const node = tl && ui.node ? nodeOf(tl, ui.node) : null;
	if (!tl || (["quiz", "worksheet", "make-worksheet", "fill-one", "more-questions"].includes(kind) && !node)) return;
	const text = askPrompt(kind, tl, node);
	if (!text || S.aiBusy) { if (S.aiBusy) U.toast?.("Eine KI-Antwort läuft bereits.", "error"); return; }
	if (kind === "worksheet" && node.progress?.worksheet?.status !== "submitted") {
		const out = ZS_CORE.applyCheck(tl, { timeline: tl.id, node: node.id, worksheet: "submitted" });
		if (!out.error) await ZS_STORE.put(out.timeline);
	}
	await sendAi(text);
}

function collectAnswers(root, node) {
	return (node.quiz || []).map((q, i) => {
		const li = root.querySelector(`[data-zsq="${i}"]`);
		if (!li) return null;
		if (q.type === "choice") return [...li.querySelectorAll(`input[name="zsq-${i}"]:checked`)].map((x) => Number(x.value));
		if (q.type === "cloze") return [...li.querySelectorAll(".zs-gap")].map((x) => x.value);
		const el = li.querySelector(".zs-input");
		return el ? el.value : "";
	});
}

function collectConfidences(root, node) {
	return (node.quiz || []).map((_, i) => root.querySelector(`input[name="conf-q-${i}"]:checked`)?.value || "");
}

async function submitQuiz(root) {
	const tl = currentTimeline();
	const node = tl && nodeOf(tl, ui.node);
	if (!node) return;
	const out = ZS_CORE.recordQuiz(tl, node.id, collectAnswers(root, node), collectConfidences(root, node));
	if (out.error) { U.toast?.(out.error, "error"); return; }
	await ZS_STORE.put(out.timeline);
	const g = out.grade;
	U.toast?.(g.passed ? "Abruf-Check bestanden!" : g.pending_ai?.length ? `${g.auto_correct}/${g.auto_total} automatisch richtig – Freitext prüft die KI.` : `${g.auto_correct}/${g.auto_total} richtig – noch nicht bestanden.`, g.passed ? "success" : undefined);
}

async function submitPretest(root) {
	const tl = currentTimeline();
	const node = tl && nodeOf(tl, ui.node);
	if (!node?.pretest) return;
	const box = root.querySelector("[data-zsptbox]");
	const ans = box ? readInput(box, node.pretest) : "";
	const out = ZS_CORE.recordPretest(tl, node.id, ans);
	if (out.error) { U.toast?.(out.error, "error"); return; }
	ui.pretestResult = { correct: out.correct, expected: out.expected, explain: out.explain };
	await ZS_STORE.put(out.timeline);
	rerender();
}

async function markDone(done) {
	const tl = currentTimeline();
	const node = tl && nodeOf(tl, ui.node);
	if (!node) return;
	const out = ZS_CORE.applyCheck(tl, { timeline: tl.id, node: node.id, done });
	if (out.error) { U.toast?.(out.error, "error"); return; }
	await ZS_STORE.put(out.timeline);
}

/** Öffnet einen Zeitstrahl (null = Übersicht; undefined = aktuellen behalten) und optional eine Lektion. */
function open(tlId, nodeId) {
	if (tlId !== undefined) { ui.tl = tlId; ui.treeFilter = ""; }
	ui.node = nodeId || null;
	ui.editing = false;
	ui.phase = null;
	ui.pretestResult = null;
	ui.refresh = null;
	ui.refreshOutcome = null;
	saveUi();
	if (S.view !== "zeitstrahl") { S.view = "zeitstrahl"; S.sidebarMode = "files"; }
	rerender();
}

function importBackup() {
	const inp = document.createElement("input");
	inp.type = "file";
	inp.accept = ".json,application/json";
	inp.onchange = async () => {
		const file = inp.files?.[0];
		if (!file) return;
		const text = await file.text();
		const res = await ZS_STORE.importJson(text);
		if (res.error) { U.toast?.(res.error, "error"); return; }
		U.toast?.(`Importiert: ${res.added} neu, ${res.updated} aktualisiert.`, "success");
	};
	inp.click();
}

function edit(what) {
	const tl = currentTimeline();
	if (!tl) return;
	if (what === "tl") return openTimelineDialog(tl, { onOpen: (id) => open(id, null) });
	const node = what === "node" ? nodeOf(tl, ui.node) : null;
	if (what === "node" && !node) return;
	openNodeDialog(tl, node, { view: ZS_CORE.view(tl), onSaved: (id) => { if (what === "node" && !id) open(undefined, null); } });
}

// Klicks: eigene Delegation (wie library.js), nur für data-zs*-Ziele.
const TARGETS = "[data-zsnode],[data-zstl],[data-zshome],[data-zsnew],[data-zsedit],[data-zsadd],[data-zsback],[data-zsquiz],[data-zsdone],[data-zsask],[data-zsopen],[data-zslayout],[data-zslb],[data-zsedtoggle],[data-zsimport],[data-zsexport],[data-zsphase],[data-zspretest],[data-zsrefresh],[data-zsrefsubmit],[data-zsweak]";
if (typeof document !== "undefined") {
	document.addEventListener("click", (e) => {
		const t = e.target?.closest?.(TARGETS);
		if (!t || t.closest("#overlay")) return;
		const d = t.dataset;
		if (d.zsopen) {
			e.preventDefault();
			openSourcePreview(d.zsopen);
			return;
		}
		if (d.zslb) {
			e.preventDefault();
			openLightbox(t.getAttribute("src"), d.cap || t.getAttribute("alt") || "");
			return;
		}
		e.preventDefault();
		if (d.zstl) return open(d.zstl, null);
		if (d.zshome) return open(null, null);
		if (d.zsnew) return openOnboarding({ onOpen: (id) => open(id, null) });
		if (d.zsimport) return importBackup();
		if (d.zsexport) {
			const day = new Date().toISOString().slice(0, 10);
			downloadJson(`impala67-zeitstrahlen-${day}.json`, ZS_STORE.exportJson());
			U.toast?.("Backup als JSON gespeichert.", "success");
			return;
		}
		if (d.zsphase) { ui.phase = d.zsphase; rerender(); return; }
		if (d.zspretest) return void submitPretest(t.closest(".zs-world"));
		if (d.zsrefresh) {
			const tl = currentTimeline();
			if (!tl) return;
			const sess = ZS_CORE.buildRefresh(tl, 6);
			if (sess.error) { U.toast?.(sess.error, "error"); return; }
			ui.node = null; ui.refresh = sess; ui.refreshOutcome = null;
			rerender();
			return;
		}
		if (d.zsrefsubmit) {
			const tl = currentTimeline();
			if (!tl || !ui.refresh) return;
			submitRefresh(t.closest(".zs-world"), tl, ui.refresh).then((out) => {
				if (out) { ui.refreshOutcome = out; rerender(); }
			});
			return;
		}
		if (d.zsweak) {
			const tl = currentTimeline();
			const n = tl && nodeOf(tl, d.zsweak);
			if (!n) return;
			void sendAi(`Im Zeitstrahl „${tl.title}“ ist die Lektion „${n.title}“ als Schwachstelle markiert (Fehlkonzept oder wiederholt gescheitert). Lies sie mit read_timeline (node) und erstelle entweder 3–4 gezielte Übungsfragen im quiz-Pool oder eine kurze klärende Zwischenlektion per edit_timeline.`);
			return;
		}
		if (d.zsedtoggle) { ui.editing = !ui.editing; rerender(); return; }
		if (d.zsnode) return open(undefined, d.zsnode);
		if (d.zsback) return open(undefined, null);
		if (d.zsedit) return edit(d.zsedit);
		if (d.zsadd) return edit("new");
		if (d.zslayout) { ui.layout = LAYOUTS.includes(d.zslayout) ? d.zslayout : LAYOUTS[0]; saveUi(); rerender(); return; }
		if (d.zsquiz) return void submitQuiz(t.closest(".zs-world"));
		if (d.zsdone) return void markDone(d.zsdone === "1");
		if (d.zsask) return void ask(d.zsask);
	});
	document.addEventListener("input", (e) => {
		if (!e.target?.matches?.("[data-zstreefilter]")) return;
		ui.treeFilter = e.target.value;
		const pos = e.target.selectionStart;
		rerender();
		const fresh = document.querySelector("[data-zstreefilter]");
		if (fresh) { fresh.focus(); try { fresh.setSelectionRange(pos, pos); } catch {} }
	});
	document.addEventListener("keydown", (e) => {
		if (S.view !== "zeitstrahl" || !ui.node || ui.editing || !e.altKey) return;
		if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
		const tl = currentTimeline();
		if (!tl) return;
		const seq = orderedNodes(ZS_CORE.view(tl));
		const idx = seq.findIndex((n) => n.id === ui.node);
		const target = e.key === "ArrowLeft" ? seq[idx - 1] : seq[idx + 1];
		if (!target) return;
		e.preventDefault();
		open(undefined, target.id);
	});
}

BUS.on("zs:changed", () => { if (S.view === "zeitstrahl" || S.sidebarMode === "files") rerender(); });
BUS.provide("zs:workspace", workspace);

export const ZS = { enabled, render, treeHtml, open };
