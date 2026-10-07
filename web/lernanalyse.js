// Lernanalyse der Startseite (PC & Tablet): vier Fragen, je eine Antwort in einem Satz
// plus eine kleine Grafik. Aussagen erscheinen erst mit genug Daten, sonst steht dort,
// was noch fehlt. Zugeklappt zeigt die Startseite nur headline() — die wichtigste Aussage.
import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { TELE } from "./telemetrie.js";
import { LERNZEIT } from "./lernzeit.js";
import { FACH } from "./fach.js";

const esc = (s) => U.esc(s);
const DAY = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const DAY_LONG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const pct = (x) => Math.round(x * 100);
const MIN_SUBJECT = 15; // Wiederholungen je Fach und Zeitraum
const MIN_SLOT = 20; // Wiederholungen je Tageszeit

function dur(min) {
	min = Math.round(min);
	const h = Math.floor(min / 60), m = min % 60;
	return h ? `${h} h${m ? " " + m : ""}` : `${m} Min`;
}
const dayIdx = (d) => (d.getDay() + 6) % 7;
const dayKey = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const startOfDay = (offset = 0) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d; };

// ---------- 1) Schaffe ich das Wochenziel? ----------
function goal(totals) {
	const goalMin = LERNZEIT.weekGoalMinutes();
	const week = LERNZEIT.weekData(0, totals);
	const today = dayIdx(new Date());
	const days = week.map((x) => x.seconds / 60);
	const done = days.reduce((a, b) => a + b, 0);
	// Tempo = Schnitt der letzten 14 vollen Tage
	let past = 0;
	for (let i = 1; i <= 14; i++) past += (totals[dayKey(startOfDay(-i))] || 0) / 60;
	const pace = past / 14;
	const left = 7 - today; // inkl. heute
	const need = Math.max(0, goalMin - done);
	let text, tone = "ok", reachDay = null;
	if (need === 0) text = `Geschafft: ${dur(done)} von ${dur(goalMin)}.`;
	else if (pace > 0 && pace * left >= need) {
		reachDay = Math.min(6, today + Math.ceil(need / pace) - 1);
		text = `Bei deinem Tempo schaffst du es ${reachDay === today ? "heute" : "am " + DAY_LONG[reachDay]}.`;
	} else {
		tone = "warn";
		text = `Es fehlen noch ${dur(need)}, also etwa ${dur(need / left)} pro Tag.`;
	}
	return { goalMin, days, done, today, pace, need, left, text, tone, reachDay };
}

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

// ---------- 2) Welche Fächer lassen nach? (letzte 14 Tage gegen die 14 davor) ----------
function subjects() {
	const now = Date.now(), d14 = 14 * 864e5;
	const cur = TELE.rangeStats(now - d14, now + 1).bySubject;
	const prev = new Map(TELE.rangeStats(now - 2 * d14, now - d14).bySubject.map((s) => [s.subject, s]));
	const rows = cur.filter((s) => s.reviews >= MIN_SUBJECT && (prev.get(s.subject)?.reviews || 0) >= MIN_SUBJECT)
		.map((s) => ({ subject: s.subject, now: s.passRate, before: prev.get(s.subject).passRate, n: s.reviews }))
		.map((s) => ({ ...s, delta: pct(s.now) - pct(s.before) }))
		.sort((a, b) => a.delta - b.delta);
	const worst = rows.find((r) => r.delta <= -8);
	const text = !rows.length
		? `Noch zu wenig Daten: Pro Fach braucht es ${MIN_SUBJECT} Wiederholungen in zwei Wochen hintereinander.`
		: worst ? `${worst.subject} lässt nach: ${pct(worst.now)} % richtig, vorher ${pct(worst.before)} %.`
			: "Kein Fach lässt nach. Alle halten ihr Niveau.";
	return { rows: rows.slice(0, 5), worst, text, tone: worst ? "warn" : "ok" };
}

// Häufigster Wurzel-Stapel eines Fachs — damit „Biologie lernen“ genau Biologie startet
function deckFor(subject) {
	const count = {};
	for (const c of STATE.activeCards()) {
		if (FACH.card(c)?.name !== subject) continue;
		const root = (c.deck || "Standard").split("::")[0];
		count[root] = (count[root] || 0) + 1;
	}
	return Object.keys(count).sort((a, b) => count[b] - count[a])[0] || null;
}
const studyAttr = (deck) => deck ? `data-ankistudy="${esc(deck)}"` : 'data-homeaction="cards"';

function subjectRows(sub) {
	if (!sub.rows.length) return "";
	return '<div class="la-rows">' + sub.rows.map((r) =>
		`<button class="la-row${r.delta <= -8 ? " down" : ""}" ${studyAttr(deckFor(r.subject))} title="${esc(r.subject)} lernen"><span>${esc(r.subject)}</span>` +
		`<span class="la-meter"><i style="width:${pct(r.now)}%"></i><b style="left:${pct(r.before)}%" title="vorher ${pct(r.before)} %"></b></span>` +
		`<span class="la-num">${pct(r.now)} %</span><span class="la-delta">${r.delta > 0 ? "+" : ""}${r.delta}</span></button>`).join("") + "</div>";
}

// ---------- 3) Wann lerne ich am besten? (letzte 8 Wochen) ----------
const SLOTS = [
	{ label: "Morgens", hint: "5–12 Uhr", test: (h) => h >= 5 && h < 12 },
	{ label: "Mittags", hint: "12–17 Uhr", test: (h) => h >= 12 && h < 17 },
	{ label: "Abends", hint: "17–22 Uhr", test: (h) => h >= 17 && h < 22 },
	{ label: "Nachts", hint: "22–5 Uhr", test: (h) => h >= 22 || h < 5 },
];
function bestTime() {
	const cut = new Date(Date.now() - 56 * 864e5).toISOString();
	const slots = SLOTS.map((s) => ({ ...s, n: 0, ok: 0 }));
	for (const r of S.reviews || []) {
		if (!r || !(r.grade > 0) || r.t < cut) continue;
		const slot = slots.find((s) => s.test(new Date(r.t).getHours()));
		slot.n++; if (r.grade > 1) slot.ok++;
	}
	for (const s of slots) s.rate = s.n ? s.ok / s.n : null;
	const valid = slots.filter((s) => s.n >= MIN_SLOT).sort((a, b) => b.rate - a.rate);
	const best = valid.length >= 2 && pct(valid[0].rate) - pct(valid.at(-1).rate) >= 5 ? valid[0] : null;
	const text = valid.length < 2
		? `Noch zu wenig Daten: Es braucht je ${MIN_SLOT} Wiederholungen zu zwei Tageszeiten.`
		: best ? `${best.label} bist du am stärksten: ${pct(best.rate)} % richtig, ${valid.at(-1).label.toLowerCase()} nur ${pct(valid.at(-1).rate)} %.`
			: "Die Tageszeit macht bei dir kaum einen Unterschied.";
	return { slots, best, text, tone: "ok" };
}

function slotBars(t) {
	return '<div class="la-rows">' + t.slots.map((s) => {
		const ok = s.n >= MIN_SLOT;
		return `<div class="la-row${t.best === s ? " best" : ""}${ok ? "" : " thin"}"><span title="${s.hint}">${s.label}</span>` +
			`<span class="la-meter"><i style="width:${ok ? pct(s.rate) : 0}%"></i></span>` +
			`<span class="la-num">${ok ? pct(s.rate) + " %" : "–"}</span><span class="la-delta">${s.n}×</span></div>`;
	}).join("") + "</div>";
}

// ---------- 4) Was kommt auf mich zu? (fällige Wiederholungen der nächsten 7 Tage) ----------
function forecast() {
	const ends = Array.from({ length: 7 }, (_, i) => startOfDay(i + 1).toISOString());
	const counts = Array(7).fill(0);
	for (const c of STATE.activeCards()) {
		const srs = c.srs;
		if (!srs || c.suspended || srs.state === "new" || !srs.due) continue;
		const i = ends.findIndex((end) => srs.due < end);
		if (i >= 0) counts[i]++;
	}
	const avg = counts.reduce((a, b) => a + b, 0) / 7;
	let peak = -1;
	for (let i = 1; i < 7; i++) if (counts[i] >= 30 && counts[i] >= 1.8 * Math.max(avg, 1) && (peak < 0 || counts[i] > counts[peak])) peak = i;
	const name = (i) => i === 1 ? "Morgen" : "Am " + DAY_LONG[dayIdx(startOfDay(i))];
	const total = counts.reduce((a, b) => a + b, 0);
	const text = !total ? "In den nächsten 7 Tagen wird nichts fällig."
		: peak > 0 ? `${name(peak)} werden ${counts[peak]} Karten fällig. Heute ein paar vorzuziehen entzerrt das.`
			: `Ruhige Woche: im Schnitt ${Math.round(avg)} Karten pro Tag.`;
	return { counts, peak, text, tone: peak > 0 ? "warn" : "ok" };
}

function forecastBars(f) {
	const max = Math.max(...f.counts, 1);
	return '<div class="la-cols">' + f.counts.map((n, i) => {
		const label = i === 0 ? "Heute" : DAY[dayIdx(startOfDay(i))];
		return `<span class="la-col${i === f.peak ? " peak" : ""}" title="${label}: ${n} fällig"><em>${n || ""}</em><span><i style="height:${n ? Math.max(4, Math.round(n / max * 100)) : 0}%"></i></span>${label}</span>`;
	}).join("") + "</div>";
}

// ---------- Zusammenbau ----------
function compute() {
	const totals = LERNZEIT.totalsByDay();
	return { g: goal(totals), sub: subjects(), time: bestTime(), fc: forecast() };
}

// Wichtigste Aussage für den zugeklappten Zustand: Warnung vor Prognose vor Lob.
function pick({ g, sub, time, fc }) {
	if (sub.worst) return { text: sub.text, action: sub.worst.subject + " lernen", attr: studyAttr(deckFor(sub.worst.subject)) };
	if (fc.peak > 0) return { text: fc.text, action: "Jetzt lernen" };
	if (g.tone === "warn" && g.today >= 2) return { text: "Wochenziel: " + g.text, action: "Jetzt lernen" };
	if (g.need === 0 || g.reachDay !== null) return { text: "Wochenziel: " + g.text };
	if (time.best) return { text: time.text };
	return { text: "Sobald du ein paar Tage gelernt hast, steht hier, was gut läuft und wo es hakt." };
}

function block(q, a, tone, visual) {
	return `<section class="la-block"><h3>${q}</h3><p class="la-answer ${tone}">${esc(a)}</p>${visual}</section>`;
}

// summary = Kernaussage, body = die vier Fragen. render.js legt beides in den Fold.
// null = noch gar keine Lerndaten: dann zeigt die Startseite keine Analyse statt leerer Kacheln
export function lernanalyseParts() {
	const learned = (S.reviews || []).some((r) => r && r.grade > 0) || Object.values(S.learningSessions || {}).some((x) => x && !x.deleted && x.durationSeconds > 0);
	if (!learned) return null;
	const d = compute();
	const top = pick(d);
	const summary = `<span class="la-head">${esc(top.text)}</span>` +
		(top.action ? `<button class="hv-link la-act" ${top.attr || 'data-homeaction="cards"'}>${esc(top.action)}</button>` : "") +
		'<span class="la-toggle">Lernanalyse</span>';
	const body = '<div class="la-grid">' +
		block("Schaffe ich das Wochenziel?", d.g.text, d.g.tone, goalChart(d.g)) +
		block("Welche Fächer lassen nach?", d.sub.text, d.sub.tone, subjectRows(d.sub)) +
		block("Wann lerne ich am besten?", d.time.text, d.time.tone, slotBars(d.time)) +
		block("Was kommt auf mich zu?", d.fc.text, d.fc.tone, forecastBars(d.fc)) +
		"</div>";
	return { summary, body };
}
