"use strict";
// anki-stats.js — Statistik-Tab der Karteikarten.
// Reine Auswertung: Eingaben sind Kennzahlen aus dem Rust-Kern (STATE.learningStats oder CORE.computeCardStats),
// Ausgabe ist Markup. Styles: styles.css („Statistik“).
import { U } from "./util.js";
import { CORE } from "./rust-core.js";
import { S, STATE } from "./state.js";

const MIN_N = 10; // darunter zeigen wir keine Trefferquote, nur einen Strich — zu wenig Daten

const esc = (s) => U.esc(s);
const pct = (x) => Math.round(x * 100) + " %";
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

// Kennzahl-Karte und Abschnittstitel: auch Übersicht und Archiv (render-anki.js) nutzen diese Form.
export function statHtml({ label, value, note = "", tag = "div", cls = "", valueCls = "", attrs = "" }) {
	return "<" + tag + ' class="anki-stat ' + cls + '"' + (attrs ? " " + attrs : "") + "><small>" + label + '</small><b class="' + valueCls + '">' + value + "</b>" +
		(note ? "<span>" + note + "</span>" : "") + "</" + tag + ">";
}
export function ankiSec(title, note = "") {
	return '<div class="anki-sec"><h2>' + title + "</h2>" + (note ? '<p class="anki-note">' + note + "</p>" : "") + "</div>";
}

// PERF: ein Formatter für alle Balken statt eines neuen pro Aufruf (gleiche Ausgabe).
const SHORT_DATE_FMT = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short" });
const shortDate = (k) => {
	if (!k) return "";
	const [y, m, d] = String(k).split("-").map(Number);
	return Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)
		? SHORT_DATE_FMT.format(new Date(y, m - 1, d))
		: "";
};

// Berechnet Statistik-Kennzahlen: delegiert an STATE.learningStats (bzw. CORE.computeCardStats bei expliziten Karten/Reviews).
export function statsData(options = {}) {
	const { cards, reviews, deck, now = new Date(), thinkMs } = options;
	if (!cards && !reviews && typeof STATE !== "undefined" && typeof STATE.learningStats === "function") {
		return STATE.learningStats(deck, now, thinkMs);
	}
	const t = now instanceof Date ? now : new Date(now);
	const tele = (typeof S !== "undefined" && S?.telemetry) ? S.telemetry : [];
	const res = CORE.computeCardStats(
		JSON.stringify(cards || []),
		JSON.stringify(reviews || []),
		JSON.stringify(tele),
		deck ? String(deck) : null,
		t.getTime(),
		thinkMs != null ? Number(thinkMs) : null
	);
	return JSON.parse(res);
}

// ---------- Markup ----------

function leadText(d) {
	if (!d.reviewsAll) return "Noch keine Wiederholungen — sobald du lernst, füllt sich diese Seite.";
	const lastN = typeof d.last === "number" ? d.last : (d.last?.length || 0);
	if (!lastN) return "In den letzten 30 Tagen hast du nichts wiederholt.";
	let text = "In den letzten 30 Tagen " + plural(lastN, "Wiederholung", "Wiederholungen") + (d.rate !== null && d.rate !== undefined ? ", " + pct(d.rate) + " davon richtig" : "") + ".";
	if (d.trend !== null && d.trend !== undefined && Math.abs(d.trend) >= 3) text += " Das sind " + Math.abs(d.trend) + " Punkte " + (d.trend > 0 ? "mehr" : "weniger") + " als in den 30 Tagen davor.";
	return text;
}

function kpisHtml(d) {
	const lastN = typeof d.last === "number" ? d.last : (d.last?.length || 0);
	const trendNote = d.rate === null || d.rate === undefined ? "ab " + MIN_N + " Abfragen"
		: d.trend === null || d.trend === undefined ? "vorher zu wenig Daten"
			: d.trend === 0 ? "wie in den 30 Tagen davor"
				: (d.trend > 0 ? "↑ " : "↓ ") + Math.abs(d.trend) + " Punkte ggü. davor";
	return statHtml({ label: "Trefferquote", value: d.rate === null || d.rate === undefined ? "—" : pct(d.rate), note: trendNote }) +
		statHtml({ label: "Wiederholungen", value: lastN, note: "Ø " + (d.avg || 0).toFixed(1) + " pro Tag" }) +
		statHtml({ label: "Reife Karten", value: d.reif || 0, note: "Intervall ab 3 Wochen · von " + (d.gelernt || 0) + " gelernten" }) +
		statHtml({ label: "Denkzeit", value: d.thinkMs ? (d.thinkMs / 1000).toFixed(1) + " s" : "—", note: "Median pro Karte" });
}

function bestandHtml(d) {
	if (!d.n) return "";
	const parts = [["neu", "Neu"], ["lernen", "Lernen"], ["wiederholen", "Wiederholen"], ["ausgesetzt", "Ausgesetzt"]];
	const bar = parts.filter(([k]) => d.bestand?.[k]).map(([k, l]) => '<i class="st-' + k + '" style="flex:' + d.bestand[k] + '" title="' + l + ": " + d.bestand[k] + '"></i>').join("");
	const legend = parts.map(([k, l]) => '<span><i class="st-' + k + '"></i>' + l + " <b>" + (d.bestand?.[k] || 0) + "</b></span>").join("");
	return ankiSec("Lernbestand", d.n + " Karten, nach Stand") +
		'<div class="anki-stack">' + bar + '</div><div class="anki-legend">' + legend + "</div>";
}

function activityHtml(d) {
	const series = d.series || [];
	const max = Math.max(1, ...series.map((s) => s.n));
	const bars = series.map((s) => {
		const key = s.date || s.k || "";
		return '<div class="bar-wrap" title="' + shortDate(key) + ": " + s.n + '"><div class="bar" style="height:' + Math.round(s.n / max * 100) + '%"></div><div class="bar-label">' + Number(key.slice(8)) + "</div></div>";
	}).join("");
	const peakKey = d.peak?.date || d.peak?.k || "";
	const note = d.peak?.n ? "Spitze: " + d.peak.n + " am " + shortDate(peakKey) + "." : "";
	return ankiSec("Wiederholungen — letzte 30 Tage", note) + '<div class="bar-chart">' + bars + "</div>";
}

function forecastHtml(d, now = new Date()) {
	if (!d.forecast || !d.forecast.length) return "";
	const t = now instanceof Date ? now : new Date(now);
	const max = Math.max(1, ...d.forecast.map((x) => x.n));
	const bars = d.forecast.map((x, i) => {
		let label = x.label;
		if (!label) {
			const offset = x.dayOffset ?? i;
			if (offset === 0) {
				label = "Heute";
			} else {
				const dayDate = new Date(t.getFullYear(), t.getMonth(), t.getDate() + offset);
				label = dayDate.toLocaleDateString("de-DE", { weekday: "short" });
			}
		}
		return '<div class="bar-wrap" title="' + label + ": " + x.n + '"><div class="bar" style="height:' + Math.round(x.n / max * 100) + '%"></div><div class="bar-label"><b>' + x.n + "</b>" + label + "</div></div>";
	}).join("");
	return ankiSec("Prognose — nächste 7 Tage", "Fällige Karten pro Tag. „Heute“ enthält auch alles Überfällige.") + '<div class="bar-chart forecast">' + bars + "</div>";
}

function decksHtml(d) {
	if (!d.decks || d.decks.length < 2) return "";
	const rows = d.decks.map((r) => {
		const reifPct = r.n ? Math.round(r.reif / r.n * 100) + " %" : "—";
		const rateCell = r.rate === null || r.rate === undefined ? "—" : '<span class="anki-meter"><i style="width:' + Math.round(r.rate * 100) + '%"></i></span>' + pct(r.rate);
		return "<tr><td>" + esc(r.name) + "</td><td>" + r.n + "</td><td>" + r.due + "</td><td>" + reifPct + "</td><td>" + rateCell + "</td></tr>";
	}).join("");
	return ankiSec("Stapel", "Trefferquote der letzten 30 Tage; ab " + MIN_N + " Abfragen pro Stapel.") +
		'<table class="lib-table anki-decks"><thead><tr><th>Stapel</th><th>Karten</th><th>Fällig</th><th>Reif</th><th>Trefferquote</th></tr></thead><tbody>' + rows + "</tbody></table>";
}

function hardHtml(d) {
	if (!d.hard || !d.hard.length) return "";
	const rows = d.hard.map((c) => {
		const rawFront = c.front || "";
		const front = String(rawFront).replace(/\{\{c\d+::|\}\}/g, "").replace(/\s+/g, " ").trim();
		const cut = front.length > 110 ? front.slice(0, 109) + "…" : front;
		const lapses = c.lapses ?? c.srs?.lapses ?? 0;
		const stab = c.stability ?? c.srs?.stability ?? 0;
		return '<div class="anki-row"><span><b>' + esc(cut || "Ohne Vorderseite") + "</b><small>" + esc(c.deck || "Standard") + " · " +
			lapses + "× vergessen · Intervall " + Math.max(1, Math.round(stab)) + " T</small></span>" +
			'<button data-ankiedit="' + esc(c.id) + '">Bearbeiten</button></div>';
	}).join("");
	return ankiSec("Schwierigste Karten", "Am häufigsten vergessen. Ein Klick öffnet die Karte zum Bearbeiten.") + '<div class="anki-rows">' + rows + "</div>";
}

function retentionHtml(d) {
	if (!d.retention) return "";
	const row = (label, bucket) => "<tr><td>" + label + "</td><td>" + (bucket?.n || 0) + "</td><td>" + (bucket?.rate === null || bucket?.rate === undefined ? "—" : Math.round(bucket.rate * 100) + " %") + "</td></tr>";
	return ankiSec("Behalten nach Wiederholungsabstand", "Wie oft eine Karte richtig war, wenn sie nach etwa so vielen Tagen wieder auftauchte.") +
		'<table class="lib-table retention-table"><thead><tr><th>Abstand</th><th>Wiederholungen</th><th>Richtig</th></tr></thead><tbody>' +
		row("ca. 1 Tag", d.retention.day1) + row("ca. 3 Tage", d.retention.day3) + row("ca. 7 Tage", d.retention.day7) + row("ca. 14 Tage", d.retention.day14) +
		"</tbody></table>";
}

// GitHub-artige Heatmap: 53 Wochen × 7 Tage, Farbstufe = Wiederholungen pro Tag
function heatmapHtml(d, now = new Date()) {
	const t = now instanceof Date ? now : new Date(now);
	let cells = "";
	if (Array.isArray(d.heatmap) && d.heatmap.length) {
		for (const cell of d.heatmap) {
			cells += '<div class="heat-cell l' + cell.level + '" title="' + cell.date + ": " + cell.n + ' Wiederholungen"></div>';
		}
	} else if (d.perDay) {
		const end = new Date(t.getFullYear(), t.getMonth(), t.getDate());
		const start = new Date(end);
		start.setDate(start.getDate() - 364 - ((end.getDay() + 6) % 7));
		for (let x = new Date(start); x <= end; x.setDate(x.getDate() + 1)) {
			const k = x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
			const n = d.perDay[k] || 0;
			const lvl = n === 0 ? 0 : n < 5 ? 1 : n < 15 ? 2 : n < 30 ? 3 : 4;
			cells += '<div class="heat-cell l' + lvl + '" title="' + k + ": " + n + ' Wiederholungen"></div>';
		}
	}
	const streakCurrent = d.streakCurrent ?? d.streak?.current ?? 0;
	const streakLongest = d.streakLongest ?? d.streak?.longest ?? 0;
	const note = "Serie: " + plural(streakCurrent, "Tag", "Tage") + " aktuell · längste " + plural(streakLongest, "Tag", "Tage") + ".";
	return ankiSec("Aktivität — letzte 12 Monate", note) + '<div class="heatmap-wrap"><div class="heatmap">' + cells + "</div></div>";
}

// Seite zusammensetzen. analyseHtml ist die bestehende Lern-Analyse (lernmuster.js) — Beobachtungen, keine Regeln.
export function statsPageHtml(d, analyseHtml = "", now = new Date()) {
	return '<section class="anki-home"><p class="anki-lead">' + leadText(d) + "</p>" +
		'<div class="anki-stats anki-kpis">' + kpisHtml(d) + "</div></section>" +
		bestandHtml(d) + activityHtml(d) + forecastHtml(d, now) + decksHtml(d) + hardHtml(d) +
		retentionHtml(d) + heatmapHtml(d, now) + analyseHtml;
}
