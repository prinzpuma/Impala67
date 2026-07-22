"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { AI } from "./ai.js";
import { TELE } from "./telemetrie.js";

// analyse.js — 📈 Lern-Analyse (Phase 3 aus „kommt noch", 17. Juli 2026)
// Wertet die seit Phase 0 gesammelte Telemetrie (telemetrie.js) aus und zeigt
// die Ergebnisse unten im Statistik-Tab. Grundsätze:
// 1. Alles sind BEOBACHTUNGEN, keine Regeln — Confounder (Tageszeit, Fach,
//    Kartenschwierigkeit) stecken ungefiltert mit drin, darum vorsichtige Sprache.
// 2. Mindestdatenmengen: ohne genug Reviews erscheint ein ehrlicher Hinweis statt Statistik-Theater.
// 3. Keine Eingriffe in srs.js/app.js — render-anki.js hängt nur
//    window.ANALYSE.statsHtml() an die Statistik.
// 4. DRY (Refactor 21. Juli 2026): Review-Daten kommen fertig aus telemetrie.js
//    (TELE.onReview) — die frühere zweite Zustandsmaschine über dieselben
//    Lern-Buttons ist ersatzlos entfernt.

export const ANALYSE = (() => {
	const reviews = () => (S.telemetry || []).filter((e) => e.kind === "review" && e.data && e.data.grade > 0);
	const rate = (list) => (list.length ? list.filter((e) => e.data.grade > 1).length / list.length : 0);
	const pct = (x) => Math.round(x * 100) + " %";

	// ---------- 1) Sitzungsverlauf × Erfolg (inkl. Timer × FSRS) ----------
	function positionHtml() {
		const rs = reviews();
		const buckets = [
			{ label: "Karte 1–10", from: 0, to: 10 },
			{ label: "Karte 11–25", from: 10, to: 25 },
			{ label: "Karte 26–40", from: 25, to: 40 },
			{ label: "Karte 41+", from: 40, to: 1e9 },
		].map((b) => { const list = rs.filter((e) => e.data.pos >= b.from && e.data.pos < b.to); return { ...b, n: list.length, rate: rate(list) }; })
			.filter((b) => b.n >= 12);
		const timerOn = rs.filter((e) => e.data.timer === true);
		const timerOff = rs.filter((e) => e.data.timer === false);
		let timerRows = "";
		if (timerOn.length >= 15 && timerOff.length >= 15) {
			timerRows = "<tr><td>⏱ mit Lerntimer</td><td>" + timerOn.length + "</td><td>" + pct(rate(timerOn)) + "</td></tr>" +
				"<tr><td>ohne Timer</td><td>" + timerOff.length + "</td><td>" + pct(rate(timerOff)) + "</td></tr>";
		}
		if (buckets.length < 2 && !timerRows) return "";
		return "<h4>Sitzungsverlauf × Erfolg</h4>" +
			'<table class="lib-table"><thead><tr><th>Abschnitt</th><th>Reviews</th><th>richtig</th></tr></thead><tbody>' +
			buckets.map((b) => "<tr><td>" + b.label + "</td><td>" + b.n + "</td><td>" + pct(b.rate) + "</td></tr>").join("") +
			timerRows + "</tbody></table>" +
			'<div class="ana-note">Beobachtung, keine Regel — Tageszeit, Fach und Schwierigkeit sind nicht herausgerechnet.</div>';
	}

	// ---------- 2) Chronobiologie: Erfolgsquote nach Tageszeit ----------
	function chronoHtml() {
		const rs = reviews();
		if (rs.length < 60) return "";
		const hours = [];
		for (let h = 0; h < 24; h++) {
			const list = rs.filter((e) => e.data.hour === h);
			hours.push({ h, n: list.length, rate: rate(list) });
		}
		if (hours.filter((x) => x.n >= 8).length < 3) return "";
		const cells = hours.map((x) => {
			const known = x.n >= 8;
			const bg = known ? "hsl(" + Math.round(x.rate * 120) + " 55% 42%)" : "var(--bg2, #2a2d33)";
			return '<div class="ana-hour" style="background:' + bg + '" title="' + x.h + " Uhr: " +
				(known ? pct(x.rate) + " richtig (" + x.n + " Reviews)" : "zu wenig Daten") + '">' +
				(x.h % 6 === 0 ? "<span>" + x.h + "</span>" : "") + "</div>";
		}).join("");
		return "<h4>Erfolgsquote nach Tageszeit</h4>" +
			'<div class="ana-chrono">' + cells + "</div>" +
			'<div class="ana-note">Grün = hohe Quote, Rot = niedrige, Grau = unter 8 Reviews. n=1-Daten sind verrauscht — als Tendenz lesen, nicht als Stundenplan.</div>';
	}

	// ---------- 3) Problemzonen: Lesezeit + Fokus-Verluste pro Seite ----------
	// Alle 15 s wird die sichtbar verbrachte Zeit der offenen Seite aufsummiert;
	// beim Seitenwechsel wandert sie als "dwell"-Event ins Telemetrie-Log (ab 45 s).
	let dwell = null; // { pageId, ms, lost }
	function flushDwell() {
		if (dwell && dwell.ms >= 45000) {
			try { STATE.dispatch("teleEvent", { id: U.uid(), kind: "dwell", data: { pageId: dwell.pageId, ms: Math.min(dwell.ms, 3600000), lost: dwell.lost } }).catch(() => {}); }
			catch (err) { /* Telemetrie ist nie kritisch */ }
		}
		dwell = null;
	}
	setInterval(() => {
		const pid = S.view === "page" ? S.currentPageId : null;
		if (!pid || document.hidden) return;
		if (!dwell || dwell.pageId !== pid) { flushDwell(); dwell = { pageId: pid, ms: 0, lost: 0 }; }
		dwell.ms += 15000;
	}, 15000);
	document.addEventListener("visibilitychange", () => { if (document.hidden && dwell) dwell.lost++; });
	window.addEventListener("pagehide", flushDwell);

	function problemHtml() {
		const byPage = {};
		(S.telemetry || []).filter((e) => e.kind === "dwell" && e.data).forEach((e) => {
			const b = (byPage[e.data.pageId] = byPage[e.data.pageId] || { ms: 0, lost: 0 });
			b.ms += e.data.ms || 0; b.lost += e.data.lost || 0;
		});
		const rows = Object.entries(byPage)
			.map(([id, v]) => ({ id, ...v, pg: S.pages[id] }))
			.filter((x) => x.pg && !x.pg.trashed && x.ms >= 5 * 60000)
			.sort((a, b) => (b.ms + b.lost * 60000) - (a.ms + a.lost * 60000)).slice(0, 5);
		if (!rows.length) return "";
		return "<h4>Problemzonen (viel Lesezeit)</h4>" +
			'<div class="ana-problems">' + rows.map((x) =>
				'<div class="ana-problem"><span><b>' + U.esc(x.pg.title) + "</b><small>" + Math.round(x.ms / 60000) + " min gelesen · " +
				x.lost + "× App gewechselt" + (x.pg.pdfId ? " · PDF" : "") + "</small></span>" +
				'<button data-anacard="' + x.id + '">＋ Karte</button></div>').join("") + "</div>" +
			'<div class="ana-note">Viel Wiederlesen + häufige App-Wechsel = Kandidat für aktives Abrufen. ＋ legt eine Abruf-Karte im Stapel „Problemzonen“ an.</div>';
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
		} catch (err) { /* Fallback-Karte reicht */ }
		await STATE.dispatch("cardCreate", { id: U.uid(), front, back, pageId, deck: "Problemzonen" });
		U.toast("Karte in „Problemzonen“ angelegt.", "success");
	}

	// ---------- 4) Ehrlichkeits-Hinweis + 5) Pausen-Hinweis ----------
	// DRY: telemetrie.js liefert die fertigen Review-Daten (grade, thinkMs, pos)
	// per TELE.onReview — keine eigene Zustandsmaschine über die Lern-Buttons mehr.
	let recent = [], lastHint = 0, lastPause = 0;
	TELE.onReview((r) => {
		const now = Date.now();
		if (r.pos === 0) recent = []; // neue Sitzung
		recent.push({ grade: r.grade, thinkMs: r.thinkMs });
		if (recent.length > 12) recent.shift();
		// 4) Latenz als Ehrlichkeits-Signal: lange gezögert, aber „Gut/Einfach“?
		//    Nur ein dezenter Hinweis — NIE ein automatisches Herabstufen.
		if (r.grade >= 3 && r.thinkMs > 20000 && now - lastHint > 120000) {
			lastHint = now;
			U.toast("🤔 " + Math.round(r.thinkMs / 1000) + " s überlegt und dann „Gut“? Ehrlich bewerten hilft dem Planer.");
		}
		// 5) Pausen-Hinweis statt „Aufmerksamkeits-Prädiktion“: steigen Fehlerquote
		//    UND Denkzeit innerhalb der Sitzung, wird EINMAL eine Pause vorgeschlagen.
		if (recent.length >= 10 && now - lastPause > 20 * 60000) {
			const half = Math.floor(recent.length / 2);
			const a = recent.slice(0, half), b = recent.slice(half);
			const errRate = (l) => l.filter((x) => x.grade === 1).length / Math.max(1, l.length);
			const think = (l) => l.reduce((s, x) => s + x.thinkMs, 0) / Math.max(1, l.length);
			if (errRate(b) >= 0.4 && errRate(b) > errRate(a) + 0.15 && think(b) > think(a) * 1.3) {
				lastPause = now;
				U.toast("🪫 Fehler und Denkzeit steigen — 5 Minuten Pause bringen hier mehr als Weitermachen.");
			}
		}
	});
	// Der ＋-Karte-Button aus den Problemzonen ist der einzige verbliebene Klick-Handler.
	document.addEventListener("click", (e) => {
		const t = e.target && e.target.closest ? e.target.closest("[data-anacard]") : null;
		if (t) cardFromPage(t.getAttribute("data-anacard"));
	}, true);

	// ---------- 6) Experimente × Erfolg (macht Phase 2 messbar) ----------
	// Reviews, bei denen ein Karten-Experiment benutzt wurde (exp-Array aus
	// telemetrie.js v3), gegen die Basisquote. Mindestdatenmengen wie überall.
	const EXP_NAMES = { feynman: "🧑‍🏫 Feynman", scaffolding: "💡 Hinweise", variation: "🔀 Variation", mc: "🎯 Quiz" };
	function expHtml() {
		const rs = reviews();
		const base = rs.filter((e) => !Array.isArray(e.data.exp) || !e.data.exp.length);
		const rows = Object.entries(EXP_NAMES)
			.map(([key, label]) => { const list = rs.filter((e) => Array.isArray(e.data.exp) && e.data.exp.includes(key)); return { label, n: list.length, rate: rate(list) }; })
			.filter((x) => x.n >= 15);
		if (!rows.length || base.length < 30) return "";
		return "<h4>Experimente × Erfolg</h4>" +
			'<table class="lib-table"><thead><tr><th>Experiment</th><th>Reviews</th><th>richtig</th></tr></thead><tbody>' +
			rows.map((x) => "<tr><td>" + x.label + "</td><td>" + x.n + "</td><td>" + pct(x.rate) + "</td></tr>").join("") +
			"<tr><td>ohne Experimente</td><td>" + base.length + "</td><td>" + pct(rate(base)) + "</td></tr></tbody></table>" +
			'<div class="ana-note">Vorsicht bei der Deutung: Hinweise & Co. laufen eher auf schweren Karten — Unterschiede sind Beobachtungen, keine Wirkungsnachweise.</div>';
	}

	// ---------- Statistik-Tab (render-anki.js hängt das an) ----------
	function statsHtml() {
		const html = positionHtml() + chronoHtml() + expHtml() + problemHtml();
		return '<div class="ana-block"><h3>📈 Lern-Analyse (Beobachtungen)</h3>' +
			(html || '<div class="ana-note">Noch zu wenig Telemetrie — nach ein paar Lerntagen erscheinen hier Sitzungsverlauf × Erfolg, die Tageszeit-Analyse, Experimente × Erfolg und Problemzonen mit 1-Klick-Kartenerstellung.</div>') +
			"</div>";
	}

	return { statsHtml };
})();