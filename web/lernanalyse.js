// Lernanalyse der Startseite (PC & Tablet): vier Fragen, je eine Antwort in einem Satz
// plus eine kleine Grafik. Die Berechnung (Wochenziel, Fächer, Tageszeit, Prognose und Kernaussage)
// liegt zentral im Rust-Kern (core/impala-model/src/analysis.rs); dieses Modul rendert das Markup.
import { STATE } from "./state.js";
import { U } from "./util.js";
import { LERNZEIT } from "./lernzeit.js";

const esc = (s) => U.esc(s);
const DAY = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const pct = (x) => Math.round(x * 100);
const MIN_SLOT = 20;

const dayKey = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const startOfDay = (offset = 0) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d; };

function goalChart(g) {
	const W = 280, H = 96, pad = 4, max = Math.max(g.goalMin, g.done + g.pace * g.left) * 1.08 || 1;
	const x = (i) => pad + i * (W - 2 * pad) / 6;
	const y = (v) => H - pad - v / max * (H - 2 * pad);
	let cum = 0;
	const pts = g.days.slice(0, g.today + 1).map((m, i) => { cum += m; return `${x(i).toFixed(1)},${y(cum).toFixed(1)}`; });
	let proj = "";
	if (g.need > 0 && g.today < 6) {
		let c = cum;
		proj = [`${x(g.today).toFixed(1)},${y(c).toFixed(1)}`].concat(Array.from({ length: 6 - g.today }, (_, k) => { c += g.pace; return `${x(g.today + k + 1).toFixed(1)},${y(c).toFixed(1)}`; })).join(" ");
	}
	return `<svg class="la-chart" viewBox="0 0 ${W} ${H + 16}" role="img" aria-label="Lernzeit dieser Woche gegen das Wochenziel">` +
		`<line class="la-goal" x1="${pad}" x2="${W - pad}" y1="${y(g.goalMin).toFixed(1)}" y2="${y(g.goalMin).toFixed(1)}"/>` +
		(proj ? `<polyline class="la-proj" points="${proj}"/>` : "") +
		`<polyline class="la-line" points="${pts.join(" ")}"/>` +
		`<circle class="la-dot" cx="${pts.at(-1).split(",")[0]}" cy="${pts.at(-1).split(",")[1]}" r="3.5"/>` +
		DAY.map((d, i) => `<text x="${x(i).toFixed(1)}" y="${H + 13}" text-anchor="middle"${i === g.today ? ' class="on"' : ""}>${d}</text>`).join("") +
		"</svg>";
}

const studyAttr = (deck) => deck ? `data-ankistudy="${esc(deck)}"` : 'data-homeaction="cards"';

function subjectRows(sub) {
	if (!sub.rows.length) return "";
	return '<div class="la-rows">' + sub.rows.map((r) =>
		`<button class="la-row${r.delta <= -8 ? " down" : ""}" ${studyAttr(r.deck)} title="${esc(r.subject)} lernen"><span>${esc(r.subject)}</span>` +
		`<span class="la-meter"><i style="width:${pct(r.now)}%"></i><b style="left:${pct(r.before)}%" title="vorher ${pct(r.before)} %"></b></span>` +
		`<span class="la-num">${pct(r.now)} %</span><span class="la-delta">${r.delta > 0 ? "+" : ""}${r.delta}</span></button>`).join("") + "</div>";
}

function slotBars(t) {
	return '<div class="la-rows">' + t.slots.map((s) => {
		const ok = s.n >= MIN_SLOT;
		const isBest = t.best && t.best.label === s.label;
		return `<div class="la-row${isBest ? " best" : ""}${ok ? "" : " thin"}"><span title="${s.hint}">${s.label}</span>` +
			`<span class="la-meter"><i style="width:${ok ? pct(s.rate) : 0}%"></i></span>` +
			`<span class="la-num">${ok ? pct(s.rate) + " %" : "–"}</span><span class="la-delta">${s.n}×</span></div>`;
	}).join("") + "</div>";
}

function forecastBars(f) {
	const max = Math.max(...f.counts, 1);
	return '<div class="la-cols">' + f.counts.map((n, i) => {
		const label = (f.labels && f.labels[i]) || (i === 0 ? "Heute" : DAY[(new Date().getDay() + 6 + i) % 7]);
		return `<span class="la-col${i === f.peak ? " peak" : ""}" title="${label}: ${n} fällig"><em>${n || ""}</em><span><i style="height:${n ? Math.max(4, Math.round(n / max * 100)) : 0}%"></i></span>${label}</span>`;
	}).join("") + "</div>";
}

function block(q, a, tone, visual) {
	return `<section class="la-block"><h3>${q}</h3><p class="la-answer ${tone}">${esc(a)}</p>${visual}</section>`;
}

// summary = Kernaussage, body = die vier Fragen. render.js legt beides in den Fold.
// null = noch gar keine Lerndaten: dann zeigt die Startseite keine Analyse statt leerer Kacheln
export function lernanalyseParts(totals = null) {
	const t = totals || LERNZEIT.totalsByDay();
	const goalMin = LERNZEIT.weekGoalMinutes();
	const week = LERNZEIT.weekData(0, t);
	const days = week.map((x) => x.seconds / 60);
	let past = 0;
	for (let i = 1; i <= 14; i++) past += (t[dayKey(startOfDay(-i))] || 0) / 60;
	const pace = past / 14;

	const d = STATE.homeAnalysis(goalMin, days, pace);
	if (!d) return null;

	const summary = `<span class="la-head">${esc(d.headline)}</span>` +
		(d.action ? `<button class="hv-link la-act" ${studyAttr(d.actionDeck)}>${esc(d.action)}</button>` : "") +
		'<span class="la-toggle">Lernanalyse</span>';
	const body = '<div class="la-grid">' +
		block("Schaffe ich das Wochenziel?", d.goal.text, d.goal.tone, goalChart(d.goal)) +
		block("Welche Fächer lassen nach?", d.subjects.text, d.subjects.tone, subjectRows(d.subjects)) +
		block("Wann lerne ich am besten?", d.time.text, d.time.tone, slotBars(d.time)) +
		block("Was kommt auf mich zu?", d.forecast.text, d.forecast.tone, forecastBars(d.forecast)) +
		"</div>";
	return { summary, body };
}
