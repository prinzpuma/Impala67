"use strict";
// anki-stats.js — Statistik-Tab der Karteikarten.
// Reine Auswertung: Eingaben sind Karten (S.cards) und Bewertungen (S.reviews), Ausgabe ist Markup.
// Ohne Zugriff auf den Zustand, damit die Zahlen einzeln prüfbar bleiben. Styles: styles.css („Statistik“).
import { U } from "./util.js";
import { TELE } from "./telemetrie.js";

const DAY = 864e5;
const REIF_TAGE = 21; // ab diesem Intervall gilt eine Karte als reif (drei Wochen)
const MIN_N = 10; // darunter zeigen wir keine Trefferquote, nur einen Strich — zu wenig Daten
const WOCHEN = 30; // Vergleichsfenster in Tagen

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

// Lokaler Tagesschlüssel „JJJJ-MM-TT“ — lexikografisch sortierbar
function dayKey(x) {
	const d = new Date(x);
	return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
const utcOf = (k) => { const [y, m, d] = k.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const shortDate = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("de-DE", { day: "numeric", month: "short" }); };

// Behalten zählt nur echte Abfragen: Erstkontakt und Lernschritte sagen noch nichts über das Gedächtnis
const graded = (list) => list.filter((r) => r.grade > 0 && !r.first && !r.learning);
function hitRate(list) {
	const g = graded(list);
	return g.length >= MIN_N ? g.filter((r) => r.grade > 1).length / g.length : null;
}

// Serien: längste Folge von Tagen mit Wiederholungen und die aktuelle (heute oder gestern endend)
function streaks(perDay, now) {
	let longest = 0, run = 0, prev = null;
	for (const k of Object.keys(perDay).sort()) {
		run = prev && (utcOf(k) - utcOf(prev)) / DAY === 1 ? run + 1 : 1;
		longest = Math.max(longest, run);
		prev = k;
	}
	const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	if (!perDay[dayKey(d)]) d.setDate(d.getDate() - 1);
	let current = 0;
	while (perDay[dayKey(d)]) { current++; d.setDate(d.getDate() - 1); }
	return { longest, current };
}

// Alle Kennzahlen dieser Seite — eine Funktion, damit Markup und Logik getrennt bleiben
export function statsData({ cards, reviews, now = new Date(), thinkMs = 0 }) {
	const ago = (r) => (now - new Date(r.t)) / DAY;
	const last = reviews.filter((r) => ago(r) >= 0 && ago(r) < WOCHEN);
	const before = reviews.filter((r) => ago(r) >= WOCHEN && ago(r) < 2 * WOCHEN);
	const rate = hitRate(last);
	const rateBefore = hitRate(before);

	// Lernbestand + Karten je Stapel in einem Durchgang
	const bestand = { neu: 0, lernen: 0, wiederholen: 0, ausgesetzt: 0 };
	const decksMap = {};
	let reif = 0, gelernt = 0, faellig = 0;
	for (const c of cards) {
		const name = c.deck || "Standard";
		const row = decksMap[name] || (decksMap[name] = { name, n: 0, due: 0, reif: 0 });
		row.n++;
		if (c.suspended) { bestand.ausgesetzt++; continue; }
		if (c.srs.state === "new") bestand.neu++;
		else if (c.srs.state === "review") { bestand.wiederholen++; gelernt++; }
		else bestand.lernen++;
		const istReif = c.srs.state === "review" && (c.srs.stability || 0) >= REIF_TAGE;
		if (istReif) { reif++; row.reif++; }
		if (new Date(c.srs.due) <= now) { faellig++; row.due++; }
	}
	const decks = Object.values(decksMap)
		.map((row) => ({ ...row, rate: hitRate(last.filter((r) => r.deck === row.name)) }))
		.sort((a, b) => b.due - a.due || a.name.localeCompare(b.name, "de"));

	// Verlauf: 30 Tage Balken, Prognose für 7 Tage, Serien über alle Zeit
	const perDay = {};
	for (const r of reviews) { const k = dayKey(r.t); perDay[k] = (perDay[k] || 0) + 1; }
	const series = [];
	for (let i = WOCHEN - 1; i >= 0; i--) {
		const k = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
		series.push({ k, n: perDay[k] || 0 });
	}
	const peak = series.reduce((a, b) => (b.n > a.n ? b : a), { k: "", n: 0 });
	const forecast = [];
	for (let i = 0; i < 7; i++) {
		const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
		const d1 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i + 1);
		const from = i === 0 ? new Date(0) : d0; // „Heute“ zählt auch alles Überfällige mit
		const n = cards.filter((c) => !c.suspended && new Date(c.srs.due) >= from && new Date(c.srs.due) < d1).length;
		forecast.push({ label: i === 0 ? "Heute" : d0.toLocaleDateString("de-DE", { weekday: "short" }), n });
	}

	const hard = cards
		.filter((c) => (c.srs.lapses || 0) > 0)
		.sort((a, b) => (b.srs.lapses || 0) - (a.srs.lapses || 0))
		.slice(0, 5);

	return {
		reviewsAll: reviews.length, last, rate, trend: rate !== null && rateBefore !== null ? Math.round((rate - rateBefore) * 100) : null,
		avg: last.length / WOCHEN, bestand, n: cards.length, faellig, reif, gelernt, decks,
		series, peak, forecast, perDay, streak: streaks(perDay, now), hard, thinkMs,
		retention: TELE.retentionStatsForReviews(reviews),
	};
}

// ---------- Markup ----------

function leadText(d) {
	if (!d.reviewsAll) return "Noch keine Wiederholungen — sobald du lernst, füllt sich diese Seite.";
	if (!d.last.length) return "In den letzten 30 Tagen hast du nichts wiederholt.";
	let text = "In den letzten 30 Tagen " + plural(d.last.length, "Wiederholung", "Wiederholungen") + (d.rate !== null ? ", " + pct(d.rate) + " davon richtig" : "") + ".";
	if (d.trend !== null && Math.abs(d.trend) >= 3) text += " Das sind " + Math.abs(d.trend) + " Punkte " + (d.trend > 0 ? "mehr" : "weniger") + " als in den 30 Tagen davor.";
	return text;
}

function kpisHtml(d) {
	const trendNote = d.rate === null ? "ab " + MIN_N + " Abfragen"
		: d.trend === null ? "vorher zu wenig Daten"
			: d.trend === 0 ? "wie in den 30 Tagen davor"
				: (d.trend > 0 ? "↑ " : "↓ ") + Math.abs(d.trend) + " Punkte ggü. davor";
	return statHtml({ label: "Trefferquote", value: d.rate === null ? "—" : pct(d.rate), note: trendNote }) +
		statHtml({ label: "Wiederholungen", value: d.last.length, note: "Ø " + d.avg.toFixed(1) + " pro Tag" }) +
		statHtml({ label: "Reife Karten", value: d.reif, note: "Intervall ab 3 Wochen · von " + d.gelernt + " gelernten" }) +
		statHtml({ label: "Denkzeit", value: d.thinkMs ? (d.thinkMs / 1000).toFixed(1) + " s" : "—", note: "Median pro Karte" });
}

function bestandHtml(d) {
	if (!d.n) return "";
	const parts = [["neu", "Neu"], ["lernen", "Lernen"], ["wiederholen", "Wiederholen"], ["ausgesetzt", "Ausgesetzt"]];
	const bar = parts.filter(([k]) => d.bestand[k]).map(([k, l]) => '<i class="st-' + k + '" style="flex:' + d.bestand[k] + '" title="' + l + ": " + d.bestand[k] + '"></i>').join("");
	const legend = parts.map(([k, l]) => '<span><i class="st-' + k + '"></i>' + l + " <b>" + d.bestand[k] + "</b></span>").join("");
	return ankiSec("Lernbestand", d.n + " Karten, nach Stand") +
		'<div class="anki-stack">' + bar + '</div><div class="anki-legend">' + legend + "</div>";
}

function activityHtml(d) {
	const max = Math.max(1, ...d.series.map((s) => s.n));
	const bars = d.series.map((s) => '<div class="bar-wrap" title="' + shortDate(s.k) + ": " + s.n + '"><div class="bar" style="height:' + Math.round(s.n / max * 100) + '%"></div><div class="bar-label">' + Number(s.k.slice(8)) + "</div></div>").join("");
	const note = d.peak.n ? "Spitze: " + d.peak.n + " am " + shortDate(d.peak.k) + "." : "";
	return ankiSec("Wiederholungen — letzte 30 Tage", note) + '<div class="bar-chart">' + bars + "</div>";
}

function forecastHtml(d) {
	const max = Math.max(1, ...d.forecast.map((x) => x.n));
	const bars = d.forecast.map((x) => '<div class="bar-wrap" title="' + x.label + ": " + x.n + '"><div class="bar" style="height:' + Math.round(x.n / max * 100) + '%"></div><div class="bar-label"><b>' + x.n + "</b>" + x.label + "</div></div>").join("");
	return ankiSec("Prognose — nächste 7 Tage", "Fällige Karten pro Tag. „Heute“ enthält auch alles Überfällige.") + '<div class="bar-chart forecast">' + bars + "</div>";
}

function decksHtml(d) {
	if (d.decks.length < 2) return "";
	const rows = d.decks.map((r) => {
		const reifPct = r.n ? Math.round(r.reif / r.n * 100) + " %" : "—";
		const rateCell = r.rate === null ? "—" : '<span class="anki-meter"><i style="width:' + Math.round(r.rate * 100) + '%"></i></span>' + pct(r.rate);
		return "<tr><td>" + esc(r.name) + "</td><td>" + r.n + "</td><td>" + r.due + "</td><td>" + reifPct + "</td><td>" + rateCell + "</td></tr>";
	}).join("");
	return ankiSec("Stapel", "Trefferquote der letzten 30 Tage; ab " + MIN_N + " Abfragen pro Stapel.") +
		'<table class="lib-table anki-decks"><thead><tr><th>Stapel</th><th>Karten</th><th>Fällig</th><th>Reif</th><th>Trefferquote</th></tr></thead><tbody>' + rows + "</tbody></table>";
}

function hardHtml(d) {
	if (!d.hard.length) return "";
	const rows = d.hard.map((c) => {
		const front = String(c.front || "").replace(/\{\{c\d+::|\}\}/g, "").replace(/\s+/g, " ").trim();
		const cut = front.length > 110 ? front.slice(0, 109) + "…" : front;
		return '<div class="anki-row"><span><b>' + esc(cut || "Ohne Vorderseite") + "</b><small>" + esc(c.deck || "Standard") + " · " +
			c.srs.lapses + "× vergessen · Intervall " + Math.max(1, Math.round(c.srs.stability || 0)) + " T</small></span>" +
			'<button data-ankiedit="' + esc(c.id) + '">Bearbeiten</button></div>';
	}).join("");
	return ankiSec("Schwierigste Karten", "Am häufigsten vergessen. Ein Klick öffnet die Karte zum Bearbeiten.") + '<div class="anki-rows">' + rows + "</div>";
}

function retentionHtml(d) {
	const row = (label, bucket) => "<tr><td>" + label + "</td><td>" + bucket.n + "</td><td>" + (bucket.rate === null ? "—" : Math.round(bucket.rate * 100) + " %") + "</td></tr>";
	return ankiSec("Behalten nach Wiederholungsabstand", "Wie oft eine Karte richtig war, wenn sie nach etwa so vielen Tagen wieder auftauchte.") +
		'<table class="lib-table retention-table"><thead><tr><th>Abstand</th><th>Wiederholungen</th><th>Richtig</th></tr></thead><tbody>' +
		row("ca. 1 Tag", d.retention.day1) + row("ca. 3 Tage", d.retention.day3) + row("ca. 7 Tage", d.retention.day7) + row("ca. 14 Tage", d.retention.day14) +
		"</tbody></table>";
}

// GitHub-artige Heatmap: 53 Wochen × 7 Tage, Farbstufe = Wiederholungen pro Tag
function heatmapHtml(d, now) {
	const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const start = new Date(end);
	start.setDate(start.getDate() - 364 - ((end.getDay() + 6) % 7)); // auf Montag ausrichten
	let cells = "";
	for (let x = new Date(start); x <= end; x.setDate(x.getDate() + 1)) {
		const k = dayKey(x);
		const n = d.perDay[k] || 0;
		const lvl = n === 0 ? 0 : n < 5 ? 1 : n < 15 ? 2 : n < 30 ? 3 : 4;
		cells += '<div class="heat-cell l' + lvl + '" title="' + k + ": " + n + ' Wiederholungen"></div>';
	}
	const note = "Serie: " + plural(d.streak.current, "Tag", "Tage") + " aktuell · längste " + plural(d.streak.longest, "Tag", "Tage") + ".";
	return ankiSec("Aktivität — letzte 12 Monate", note) + '<div class="heatmap-wrap"><div class="heatmap">' + cells + "</div></div>";
}

// Seite zusammensetzen. analyseHtml ist die bestehende Lern-Analyse (analyse.js) — Beobachtungen, keine Regeln.
export function statsPageHtml(d, analyseHtml = "", now = new Date()) {
	return '<section class="anki-home"><p class="anki-lead">' + leadText(d) + "</p>" +
		'<div class="anki-stats anki-kpis">' + kpisHtml(d) + "</div></section>" +
		bestandHtml(d) + activityHtml(d) + forecastHtml(d) + decksHtml(d) + hardHtml(d) +
		retentionHtml(d) + heatmapHtml(d, now) + analyseHtml;
}
