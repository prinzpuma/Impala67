"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";

// telemetrie.js — Lern-Telemetrie v1 (15. Juli 2026)
// Sammelt vollautomatisch nützliche Signale über das Lernverhalten und macht sie
// als Insights auf der Home-Seite sichtbar. Grundprinzipien:
// 1. Alles läuft über das bestehende Event-Log (STATE.dispatch "teleEvent") und
//    synchronisiert damit wie jede andere Änderung über Drive.
// 2. KEINE Hooks in fremden Modulen nötig: ein Capture-Click-Listener beobachtet
//    die bestehenden data-Attribute des Lernmodus (render-anki.js) — app.js,
//    srs.js & Co. bleiben unangetastet.
// 3. Pro Bewertung werden Denkzeit (Frage → „Antwort zeigen“), Bewertungszeit
//    („Antwort zeigen“ → Note), Sitzungsposition, Tageszeit, Wochentag, Stapel,
//    Selbsteinschätzung (Konfidenz), Ablenkungen und Timer-Status festgehalten —
//    die Basis für alle Auswertungen (beste Lernzeit, Kalibrierung, Fokus, …).
// 4. Telemetrie darf den UI-Fluss NIE stören: fire-and-forget, alle Fehler
//    werden geschluckt.

export const TELE = (() => {
	// ---------- Ereignis-Log ----------
	function log(kind, data) {
		try { STATE.dispatch("teleEvent", { id: U.uid(), kind, data: data || {} }).catch(() => {}); }
		catch { /* Telemetrie ist nie kritisch */ }
	}

	// ---------- Lern-Sitzung (Anki-Study) ----------
	// Zustandsmaschine über die bestehenden Buttons: data-ankistudy startet eine
	// Sitzung, data-ankishowback markiert das Aufdecken, data-ankigrade schließt
	// die Karte ab (und die nächste Front erscheint direkt danach).
	let session = null;

	function timerActive() {
		// bewusst über localStorage statt Import — vermeidet einen Zyklus mit lernzeit.js
		return Number(localStorage.getItem("impala67_lernzeit_timer_end") || 0) > Date.now();
	}
	function startSession(deck) {
		if (session) endSession("restart");
		session = { startedAt: Date.now(), deck: deck || null, graded: 0,
			frontShownAt: Date.now(), revealedAt: 0, confidence: null, cardHidden: false, hiddenCount: 0 };
		log("studyStart", { deck: deck || null, due: (STATE.dueCards ? STATE.dueCards().length : null), timer: timerActive() });
	}
	function endSession(reason) {
		if (!session) return;
		log("studyEnd", { deck: session.deck, graded: session.graded,
			durationMs: Date.now() - session.startedAt, distractions: session.hiddenCount, reason: reason || "leave" });
		session = null;
	}
	function onReveal() {
		if (session && !session.revealedAt) session.revealedAt = Date.now();
	}
	function onGrade(cardId, grade) {
		if (!cardId) return;
		const now = Date.now();
		const card = S.cards[cardId] || {};
		const srs = card.srs || {}; // Capture-Phase: srs ist hier noch der Stand VOR der Bewertung
		const base = session || { frontShownAt: now, revealedAt: 0, graded: 0, confidence: null, cardHidden: false };
		const revealed = base.revealedAt || now;
		const d = new Date();
		log("review", {
			cardId,
			deck: card.deck || "Standard",
			grade: Number(grade) || 0,
			state: srs.state || null,
			reps: srs.reps || 0,
			lapses: srs.lapses || 0,
			// AFK-Schutz: Denk-/Bewertungszeiten über 5 min sind keine Lernzeit
			thinkMs: Math.min(300000, Math.max(0, revealed - base.frontShownAt)),
			gradeMs: Math.min(300000, Math.max(0, now - revealed)),
			pos: base.graded, // wievielte Karte der Sitzung (Ermüdungs-Analyse)
			hour: d.getHours(),
			dow: d.getDay(),
			confidence: base.confidence, // "sure" | "unsure" | "guess" | null
			distracted: base.cardHidden, // App während dieser Karte verlassen?
			timer: timerActive(),
		});
		if (session) {
			session.graded++;
			session.frontShownAt = now;
			session.revealedAt = 0;
			session.confidence = null;
			session.cardHidden = false;
		}
	}

	// Capture-Phase: läuft VOR den app.js-Handlern (und damit vor dem Re-Render
	// und vor dem cardReview-Dispatch, der c.srs überschreibt).
	document.addEventListener("click", (event) => {
		const t = event.target && event.target.closest
			? event.target.closest("[data-ankistudy],[data-ankishowback],[data-ankigrade],[data-confidence],[data-ankitab],[data-ankiundo],#btnTeleExport")
			: null;
		if (!t) return;
		if (t.hasAttribute("data-ankistudy")) startSession(t.getAttribute("data-ankistudy") || null);
		else if (t.hasAttribute("data-ankishowback")) onReveal();
		else if (t.hasAttribute("data-confidence")) {
			if (session) session.confidence = t.getAttribute("data-confidence");
			const row = t.closest(".confidence-row");
			if (row) row.querySelectorAll("[data-confidence]").forEach((b) => b.classList.toggle("active", b === t));
		}
		else if (t.hasAttribute("data-ankigrade")) onGrade(t.getAttribute("data-card"), t.getAttribute("data-ankigrade"));
		else if (t.hasAttribute("data-ankiundo")) { if (session && session.graded > 0) session.graded--; log("reviewUndo", {}); }
		else if (t.hasAttribute("data-ankitab")) { if (session && t.getAttribute("data-ankitab") !== "study") endSession("nav"); }
		else if (t.id === "btnTeleExport") exportDump();
	}, true);

	// Fokus-Verlust: App-Wechsel während Lern-Sitzung oder laufendem Timer.
	document.addEventListener("visibilitychange", () => {
		if (!document.hidden) return;
		if (session) { session.hiddenCount++; session.cardHidden = true; }
		if (session || timerActive()) log("focusLoss", { during: session ? "study" : "timer", view: S.view || null });
	});
	window.addEventListener("pagehide", () => endSession("close"));

	// ---------- Auswertung ----------
	function median(list) {
		if (!list.length) return 0;
		const sorted = list.slice().sort((a, b) => a - b);
		const mid = Math.floor(sorted.length / 2);
		return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
	}

	// Insights für die Home-Seite: nur Aussagen mit genug Daten, sonst Hinweis.
	function homeInsightsHtml() {
		const tele = S.telemetry || [];
		const reviews = tele.filter((e) => e.kind === "review" && e.data && e.data.grade > 0);
		const out = [];
		const row = (icon, title, sub) => '<div class="insight"><span class="insight-ico">' + icon + '</span><span><b>' + title + '</b><small>' + sub + '</small></span></div>';

		// 1) Beste Tageszeit (Erfolgsquote nach Tagesabschnitt, min. 15 Bewertungen)
		const slots = [
			{ label: "morgens (5–11 Uhr)", from: 5, to: 11 },
			{ label: "mittags (11–15 Uhr)", from: 11, to: 15 },
			{ label: "nachmittags (15–19 Uhr)", from: 15, to: 19 },
			{ label: "abends (19–24 Uhr)", from: 19, to: 24 },
			{ label: "nachts (0–5 Uhr)", from: 0, to: 5 },
		].map((slot) => {
			const list = reviews.filter((e) => e.data.hour >= slot.from && e.data.hour < slot.to);
			return { ...slot, n: list.length, rate: list.length ? list.filter((e) => e.data.grade > 1).length / list.length : 0 };
		}).filter((s) => s.n >= 15).sort((a, b) => b.rate - a.rate);
		if (slots.length >= 2) {
			const best = slots[0], worst = slots[slots.length - 1];
			out.push(row("🌅", "Du lernst " + best.label + " am besten",
				Math.round(best.rate * 100) + " % richtig (" + best.n + " Karten) — " + worst.label + " nur " +
				Math.round(worst.rate * 100) + " %. Lege schwere Stapel in deine starke Zeit."));
		}

		// 2) Denkzeit (Median) + Trend: letzte 7 Tage vs. davor
		const timed = reviews.filter((e) => Number.isFinite(e.data.thinkMs) && e.data.thinkMs > 0 && e.data.thinkMs < 120000);
		if (timed.length >= 15) {
			const cut7 = new Date(Date.now() - 7 * 864e5).toISOString();
			const recent = timed.filter((e) => e.t >= cut7).map((e) => e.data.thinkMs);
			const older = timed.filter((e) => e.t < cut7).map((e) => e.data.thinkMs);
			const md = median(timed.map((e) => e.data.thinkMs));
			let trend = ".";
			if (recent.length >= 10 && older.length >= 10) {
				const diff = Math.round((median(older) - median(recent)) / Math.max(1, median(older)) * 100);
				trend = diff > 5 ? " — zuletzt " + diff + " % schneller ✅" : diff < -5 ? " — zuletzt " + Math.abs(diff) + " % langsamer." : " — stabil.";
			}
			out.push(row("⚡", "Denkzeit: " + (md / 1000).toFixed(1) + " s pro Karte (Median)", "Zeit von Frage bis „Antwort zeigen“" + trend));
		}

		// 3) Kalibrierung: Selbsteinschätzung vs. tatsächlicher Erfolg
		const withConf = reviews.filter((e) => e.data.confidence);
		const confRate = (key) => {
			const list = withConf.filter((e) => e.data.confidence === key);
			return list.length >= 10 ? { n: list.length, rate: list.filter((e) => e.data.grade > 1).length / list.length } : null;
		};
		const sure = confRate("sure"), guess = confRate("guess");
		if (sure) {
			const pct = Math.round(sure.rate * 100);
			out.push(row("🎯", "Kalibrierung: „Sicher“-Karten stimmen zu " + pct + " %",
				pct < 85
					? "Du überschätzt dich etwas — bei „Sicher“ sollten ≥ 85 % stimmen. Antwort erst im Kopf formulieren, dann aufdecken."
					: "Deine Selbsteinschätzung ist verlässlich." + (guess ? " Geratene Karten: " + Math.round(guess.rate * 100) + " % Treffer." : "")));
		}

		// 4) Ermüdung: Erfolg der ersten 20 Karten vs. Rest der Sitzung
		const early = reviews.filter((e) => e.data.pos < 20);
		const late = reviews.filter((e) => e.data.pos >= 40);
		if (early.length >= 30 && late.length >= 30) {
			const er = early.filter((e) => e.data.grade > 1).length / early.length;
			const lr = late.filter((e) => e.data.grade > 1).length / late.length;
			if (er - lr > 0.08) out.push(row("🪫", "Lange Sitzungen kosten dich " + Math.round((er - lr) * 100) + " Punkte",
				"Ab Karte 40 sinkt deine Quote von " + Math.round(er * 100) + " % auf " + Math.round(lr * 100) + " % — lieber mehrere kurze Blöcke mit Timer."));
		}

		// 5) Fokus: Ablenkungen pro Lernstunde
		const ends = tele.filter((e) => e.kind === "studyEnd" && e.data && e.data.durationMs > 60000);
		if (ends.length >= 3) {
			const hours = ends.reduce((sum, e) => sum + e.data.durationMs, 0) / 3600000;
			const perHour = ends.reduce((sum, e) => sum + (e.data.distractions || 0), 0) / Math.max(0.1, hours);
			out.push(row("🎧", "Fokus: " + perHour.toFixed(1) + " Ablenkungen pro Lernstunde",
				perHour > 6 ? "Viele App-Wechsel beim Lernen — probiere den Lerntimer mit stummem Gerät." : "Guter Fokus — App-Wechsel während des Lernens sind selten."));
		}

		// 6) Schwierigster Stapel (30 Tage) — nutzt S.reviews und funktioniert damit
		//    auch für die Zeit VOR Einführung der Telemetrie.
		const cut30 = new Date(Date.now() - 30 * 864e5).toISOString();
		const byDeck = {};
		(S.reviews || []).filter((r) => r.t >= cut30 && r.grade > 0 && !r.first).forEach((r) => {
			const d = r.deck || "Standard";
			(byDeck[d] = byDeck[d] || { n: 0, pass: 0 }).n++;
			if (r.grade > 1) byDeck[d].pass++;
		});
		const decks = Object.entries(byDeck).filter(([, v]) => v.n >= 15)
			.map(([name, v]) => ({ name, n: v.n, rate: v.pass / v.n })).sort((a, b) => a.rate - b.rate);
		if (decks.length && decks[0].rate < 0.88) {
			const hard = decks[0];
			out.push(row("🧗", "Schwierigster Stapel: " + U.esc(hard.name),
				Math.round(hard.rate * 100) + " % Erfolgsquote (" + hard.n + " Reviews in 30 Tagen) — Karten vereinfachen oder in kleinere Schritte teilen."));
		}

		if (!out.length) {
			return '<div class="insight empty"><span class="insight-ico">🧠</span><span><b>Noch zu wenig Daten für Insights</b>' +
				'<small>Ab jetzt wird jede Bewertung mit Denkzeit, Tageszeit, Selbsteinschätzung und Fokus protokolliert. Nach ein paar Lerntagen erscheinen hier konkrete Empfehlungen.</small></span></div>';
		}
		return '<div class="insight-list">' + out.join("") + '</div>';
	}

	// ---------- Export (Einstellungen → Backup) ----------
	// Rohdaten als JSON für eigene Auswertungen (Tabellenkalkulation, Python, …).
	function exportDump() {
		const dump = {
			exportedAt: new Date().toISOString(),
			app: "Impala67",
			telemetry: S.telemetry || [],
			reviews: S.reviews || [],
			learningSessions: Object.values(S.learningSessions || {}).filter((s) => s && !s.deleted),
			cards: Object.values(S.cards || {}).filter((c) => c && !c.trashed).map((c) => ({
				id: c.id, deck: c.deck || "Standard",
				state: c.srs ? c.srs.state : null, reps: c.srs ? c.srs.reps : 0,
				lapses: c.srs ? c.srs.lapses : 0, due: c.srs ? c.srs.due : null,
				suspended: !!c.suspended, leech: !!c.leech,
			})),
		};
		U.download("impala67-lerndaten-" + new Date().toISOString().slice(0, 10) + ".json", JSON.stringify(dump, null, 2));
		U.toast("Lerndaten exportiert.", "success");
	}

	return { log, homeInsightsHtml, exportDump };
})();