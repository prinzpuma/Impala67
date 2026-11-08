"use strict";

import { S, STATE } from "./state.js";
import { PERF_PROFILER } from "./performance-profiler.js";
import { U } from "./util.js";
import { AI } from "./ai.js";
import { TELE } from "./telemetrie.js";
import { ankiSec } from "./anki-stats.js";
import { lead } from "./icons.js";

// lernmuster.js — 📈 Lern-Analyse
// Wertet die gesammelte Telemetrie über den Rust-Kern (core/impala-model/src/analysis.rs) aus
// und zeigt die Ergebnisse im Statistik-Tab.
// 1. Beobachtungen mit Vorsicht interpretieren (Confounder wie Tageszeit/Fach nicht normiert).
// 2. Ehrliche Mindestdatenmengen verlangen, bevor Trends dargestellt werden.

export const ANALYSE = (() => {
	const esc = (s) => U.esc(s);
	const pct = (x) => Math.round(x * 100) + " %";

	// ---------- 1) Sitzungsverlauf × Erfolg (inkl. Timer × FSRS) ----------
	function positionHtml(p) {
		if (p.position.length < 2 && !p.timer.length) return "";
		let timerRows = "";
		if (p.timer.length >= 2) {
			timerRows = "<tr><td>" + lead("timer") + esc(p.timer[0].label) + "</td><td>" + p.timer[0].n + "</td><td>" + pct(p.timer[0].rate) + "</td></tr>" +
				"<tr><td>" + esc(p.timer[1].label) + "</td><td>" + p.timer[1].n + "</td><td>" + pct(p.timer[1].rate) + "</td></tr>";
		}
		return ankiSec("Sitzungsverlauf × Erfolg") +
			'<table class="lib-table"><thead><tr><th>Abschnitt</th><th>Reviews</th><th>richtig</th></tr></thead><tbody>' +
			p.position.map((b) => "<tr><td>" + esc(b.label) + "</td><td>" + b.n + "</td><td>" + pct(b.rate) + "</td></tr>").join("") +
			timerRows + "</tbody></table>" +
			'<div class="anki-note">Beobachtung, keine Regel — Tageszeit, Fach und Schwierigkeit sind nicht herausgerechnet.</div>';
	}

	// ---------- 2) Chronobiologie: Erfolgsquote nach Tageszeit ----------
	function chronoHtml(p) {
		if (!p.hours || !p.hours.length) return "";
		const bars = p.hours.map((x) => {
			const known = x.n >= 8;
			const h = known ? Math.max(4, Math.round(x.rate * 100)) : 0;
			return '<div class="bar-wrap" title="' + x.hour + " Uhr: " + (known ? pct(x.rate) + " richtig (" + x.n + " Reviews)" : "zu wenig Daten") + '"><div class="bar" style="height:' + h + '%"></div><div class="bar-label">' + (x.hour % 6 === 0 ? x.hour : "") + "</div></div>";
		}).join("");
		return ankiSec("Erfolgsquote nach Tageszeit", "Höhe = Anteil richtiger Antworten. Stunden mit unter 8 Reviews bleiben leer. Als Tendenz lesen, nicht als Stundenplan.") +
			'<div class="bar-chart">' + bars + "</div>";
	}

	// ---------- 3) Problemzonen: Lesezeit + Fokus-Verluste pro Seite ----------
	// Alle 15 s wird die sichtbar verbrachte Zeit der offenen Seite aufsummiert;
	// beim Seitenwechsel wandert sie als "dwell"-Event ins Telemetrie-Log (ab 45 s).
	let dwell = null; // { pageId, ms, lost }
	function flushDwell() {
		// Über TELE.log: dort greift auch die Einstellung „Lernanalyse aufzeichnen“ (aus = nichts speichern).
		if (dwell && dwell.ms >= 45000) TELE.log("dwell", { pageId: dwell.pageId, ms: Math.min(dwell.ms, 3600000), lost: dwell.lost });
		dwell = null;
	}
	let dwellTimer = 0;
	function initDwellTimer() {
		if (dwellTimer) return;
		dwellTimer = setInterval(() => {
			const pid = S.view === "page" ? S.currentPageId : null;
			if (!pid || document.hidden) return;
			if (!dwell || dwell.pageId !== pid) { flushDwell(); dwell = { pageId: pid, ms: 0, lost: 0 }; }
			dwell.ms += 15000;
		}, 15000);
	}
	document.addEventListener("visibilitychange", () => { if (document.hidden && dwell) dwell.lost++; });
	window.addEventListener("pagehide", flushDwell);

	function problemHtml(p) {
		if (!p.problems || !p.problems.length) return "";
		const rows = p.problems
			.map((x) => ({ ...x, pg: S.pages[x.pageId] }))
			.filter((x) => x.pg && !x.pg.trashed);
		if (!rows.length) return "";
		return ankiSec("Problemzonen (viel Lesezeit)") +
			'<div class="anki-rows">' + rows.map((x) =>
				'<div class="anki-row"><span><b>' + esc(x.pg.title) + "</b><small>" + x.minutes + " min gelesen · " +
				x.lost + "× App gewechselt" + (x.pg.pdfId ? " · PDF" : "") + "</small></span>" +
				'<button data-anacard="' + esc(x.pageId) + '">＋ Karte</button></div>').join("") + "</div>" +
			'<div class="anki-note">Viel Wiederlesen + häufige App-Wechsel = Kandidat für aktives Abrufen. ＋ legt eine Abruf-Karte im Stapel „Problemzonen“ an.</div>';
	}
	async function cardFromPage(pageId) {
		const pg = S.pages[pageId];
		if (!pg) return;
		let front = "Erkläre die Kernaussagen von „" + pg.title + "“ aus dem Gedächtnis.";
		let back = "Selbst prüfen: Seite öffnen und mit der eigenen Erklärung vergleichen.";
		try {
			const raw = await AI.complete(
				'Erstelle aus dieser Notiz GENAU EINE Karteikarte zur schwierigsten Kernidee. Antworte NUR als JSON {"front":"…","back":"…"}.\n\n' +
				pg.title + "\n\n" + String(pg.content || "").slice(0, 6000),
				"Du bist ein präziser Karteikarten-Autor. Antworte NUR mit gültigem JSON.");
			const j = JSON.parse((raw.match(/\{[\s\S]*\}/) || ["{}"])[0]);
			if (j.front && j.back) { front = j.front; back = j.back; }
		} catch (err) { PERF_PROFILER.error("analyse-card-ai-error", err); /* Fallback-Karte reicht */ }
		await STATE.dispatch("cardCreate", { id: U.uid(), front, back, pageId, deck: "Problemzonen" });
		U.toast("Karte in „Problemzonen“ angelegt.", "success");
	}

	// ---------- 4) Ehrlichkeits-Hinweis + 5) Pausen-Hinweis ----------
	// DRY: telemetrie.js liefert die fertigen Review-Daten (grade, thinkMs, pos)
	// per TELE.onReview — keine eigene Zustandsmaschine über die Lern-Buttons mehr.
	let recent = [], lastHint = 0, lastPause = 0, hintShownThisSession = false;
	TELE.onReview((r) => {
		const now = Date.now();
		if (r.pos === 0) { recent = []; hintShownThisSession = false; } // neue Sitzung
		// Getippte Karten (Feynman) liefern KEINE brauchbare Denkzeit — Note zählt, Zeit nicht.
		recent.push({ grade: r.grade, thinkMs: r.typed ? null : r.thinkMs });
		if (recent.length > 12) recent.shift();
		const helpers = Array.isArray(r.exp) && r.exp.length > 0;
		const gezoegert = !r.typed && !r.distracted && !helpers && r.confidence !== "unsure" && r.confidence !== "guess";
		const med = (typeof TELE.thinkMedian === "function" && TELE.thinkMedian()) || 0;
		const langsam = med ? r.thinkMs > Math.max(25000, med * 4) : r.thinkMs > 45000;
		if (gezoegert && langsam && r.grade >= 3 && !hintShownThisSession && now - lastHint > 600000) {
			hintShownThisSession = true;
			lastHint = now;
			U.toast(Math.round(r.thinkMs / 1000) + " s bis zum Aufdecken und dann „" + (r.grade >= 4 ? "Einfach" : "Gut") + "“? Ehrlich bewerten hilft dem Planer.");
		}
		if (recent.length >= 10 && now - lastPause > 20 * 60000) {
			const half = Math.floor(recent.length / 2);
			const a = recent.slice(0, half), b = recent.slice(half);
			const errRate = (l) => l.filter((x) => x.grade === 1).length / Math.max(1, l.length);
			const think = (l) => {
				const v = l.filter((x) => Number.isFinite(x.thinkMs));
				return v.length >= 3 ? v.reduce((s, x) => s + x.thinkMs, 0) / v.length : 0;
			};
			const ta = think(a), tb = think(b);
			if (errRate(b) >= 0.4 && errRate(b) > errRate(a) + 0.15 && ta && tb && tb > ta * 1.3) {
				lastPause = now;
				U.toast("Fehler und Denkzeit steigen — 5 Minuten Pause bringen hier mehr als Weitermachen.");
			}
		}
	});
	// Der ＋-Karte-Button aus den Problemzonen ist der einzige verbliebene Klick-Handler.
	document.addEventListener("click", (e) => {
		const t = e.target && e.target.closest ? e.target.closest("[data-anacard]") : null;
		if (t) cardFromPage(t.getAttribute("data-anacard"));
	}, true);

	// ---------- 6) Experimente × Bewertung (macht Phase 2 messbar) ----------
	const EXP_ICONS = {
		Feynman: lead("explain"),
		Hinweise: lead("bulb"),
		Variation: lead("shuffle"),
		Quiz: lead("target"),
	};
	function expHtml(p) {
		if (!p.experiments || !p.experiments.length) return "";
		const expRows = p.experiments.filter((x) => x.label !== "ohne Experimente");
		const base = p.experiments.find((x) => x.label === "ohne Experimente");
		return ankiSec("Experimente × Bewertung") +
			'<table class="lib-table"><thead><tr><th>Experiment</th><th>Reviews</th><th>Ø Bewertung</th></tr></thead><tbody>' +
			expRows.map((x) => "<tr><td>" + (EXP_ICONS[x.label] || "") + esc(x.label) + "</td><td>" + x.n + "</td><td>" + x.average.toFixed(2) + "</td></tr>").join("") +
			(base ? "<tr><td>ohne Experimente</td><td>" + base.n + "</td><td>" + base.average.toFixed(2) + "</td></tr>" : "") +
			"</tbody></table>" +
			'<div class="anki-note">Skala: 1 = Nochmal, 2 = Schwer, 3 = Gut, 4 = Einfach. Vorsicht bei der Deutung: Hinweise & Co. laufen eher auf schweren Karten — Unterschiede sind Beobachtungen, keine Wirkungsnachweise.</div>';
	}

	// ---------- Statistik-Tab (render-anki.js hängt das an) ----------
	function statsHtml() {
		const p = STATE.patternData();
		const html = positionHtml(p) + chronoHtml(p) + expHtml(p) + problemHtml(p);
		return '<div class="anki-block">' + ankiSec("Lern-Analyse", "Beobachtungen aus deinem Lernverlauf: Muster zum Prüfen, keine Regeln.") +
			(html || '<div class="anki-note">Noch zu wenig Telemetrie — nach ein paar Lerntagen erscheinen hier Sitzungsverlauf × Erfolg, die Tageszeit-Analyse, Experimente × Bewertung und Problemzonen mit 1-Klick-Kartenerstellung.</div>') +
			"</div>";
	}

	return { statsHtml, initDwellTimer };
})();
