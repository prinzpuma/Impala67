"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";

// telemetrie.js — Lern-Telemetrie v3 (21. Juli 2026: Experimente messbar machen)
// Neu in v3 (DRY): TELE.mark(feature) — experimente.js markiert Nutzung pro Karte,
// sie landet als exp-Array im review-Event; TELE.onReview(fn) liefert fertige
// Review-Daten an Abonnenten (analyse.js) statt einer zweiten Zustandsmaschine.
// Grundsätze unverändert:
// 1. Alles läuft über das bestehende Event-Log (STATE.dispatch "teleEvent") und synct über Drive.
// 2. KEINE Hooks in fremden Modulen: ein Capture-Click-Listener beobachtet die
//    data-Attribute des Lernmodus (render-anki.js) — app.js, srs.js & Co. bleiben unangetastet.
// 3. Öffentliche API: TELE.log / TELE.mark / TELE.onReview / TELE.homeInsightsHtml / TELE.exportDump
//    (Nutzer: lernzeit.js, render.js, experimente.js, analyse.js; #btnTeleExport aus settings.js wird weiter HIER behandelt).
// 4. Telemetrie darf den UI-Fluss NIE stören: fire-and-forget, alle Fehler werden geschluckt.

export const TELE = (() => {
	const clamp = (ms) => Math.min(300000, Math.max(0, ms)); // AFK-Schutz: > 5 min sind keine Lernzeit
	// bewusst über localStorage statt Import — vermeidet einen Zyklus mit lernzeit.js
	const timerActive = () => Number(localStorage.getItem("impala67_lernzeit_timer_end") || 0) > Date.now();

	function log(kind, data) {
		if (localStorage.getItem("impala67Telemetry") === "off") return; // Einstellung: Aufzeichnung aus
		try { STATE.dispatch("teleEvent", { id: U.uid(), kind, data: data || {} }).catch(() => {}); }
		catch { /* Telemetrie ist nie kritisch */ }
	}

	// ---------- 🧪 Experiment-Marker + Review-Abonnenten (v3) ----------
	// EIN Ort sammelt, welche Experimente auf der aktuellen Karte benutzt wurden
	// (experimente.js ruft mark()); onGrade hängt sie als exp-Array ans review-Event.
	let expUsed = new Set();
	const mark = (feature) => { if (feature) expUsed.add(String(feature)); };
	// Abonnenten bekommen die fertigen review-Daten (analyse.js: Ehrlichkeits-/Pausen-Hinweise) —
	// DRY: keine zweite Zustandsmaschine über dieselben Buttons in anderen Modulen.
	const reviewSubs = [];
	const onReview = (fn) => { if (typeof fn === "function") reviewSubs.push(fn); };

	// ---------- Lern-Sitzung (Zustandsmaschine über die bestehenden Anki-Buttons) ----------
	let session = null;

	function startSession(deck) {
		if (session) endSession("restart");
		expUsed = new Set();
		session = { startedAt: Date.now(), deck: deck || null, graded: 0,
			frontShownAt: Date.now(), revealedAt: 0, confidence: null, cardHidden: false, hiddenCount: 0 };
		log("studyStart", { deck: deck || null, due: STATE.dueCards ? STATE.dueCards().length : null, timer: timerActive() });
	}
	function endSession(reason) {
		if (!session) return;
		log("studyEnd", { deck: session.deck, graded: session.graded,
			durationMs: Date.now() - session.startedAt, distractions: session.hiddenCount, reason: reason || "leave" });
		session = null;
	}
	function onGrade(cardId, grade) {
		if (!cardId) return;
		const now = Date.now();
		const card = S.cards[cardId] || {};
		const srs = card.srs || {}; // Capture-Phase: srs ist hier noch der Stand VOR der Bewertung
		const base = session || { frontShownAt: now, revealedAt: 0, graded: 0, confidence: null, cardHidden: false };
		const revealed = base.revealedAt || now;
		const d = new Date();
		const data = {
			cardId, deck: card.deck || "Standard", grade: Number(grade) || 0,
			state: srs.state || null, reps: srs.reps || 0, lapses: srs.lapses || 0,
			thinkMs: clamp(revealed - base.frontShownAt), // Denkzeit: Frage → „Antwort zeigen“
			gradeMs: clamp(now - revealed), // Bewertungszeit: „Antwort zeigen“ → Note
			pos: base.graded, // wievielte Karte der Sitzung (Ermüdungs-Analyse)
			hour: d.getHours(), dow: d.getDay(),
			confidence: base.confidence, // "sure" | "unsure" | "guess" | null
			distracted: base.cardHidden, // App während dieser Karte verlassen?
			timer: timerActive(),
			exp: expUsed.size ? [...expUsed] : null, // 🧪 auf dieser Karte benutzte Experimente (TELE.mark)
		};
		log("review", data);
		expUsed = new Set(); // Marker gelten pro Karte
		reviewSubs.forEach((fn) => { try { fn(data); } catch (err) { /* Abonnenten sind nie kritisch */ } });
		if (session) Object.assign(session, { graded: session.graded + 1, frontShownAt: now, revealedAt: 0, confidence: null, cardHidden: false });
	}

	// Capture-Phase: läuft VOR den app.js-Handlern (und damit vor dem Re-Render und
	// vor dem cardReview-Dispatch, der c.srs überschreibt). Reihenfolge = Prüf-Reihenfolge.
	const ACTIONS = {
		"data-ankistudy": (v) => startSession(v || null),
		"data-ankishowback": () => { if (session && !session.revealedAt) session.revealedAt = Date.now(); },
		"data-confidence": (v, t) => {
			if (session) session.confidence = v;
			const row = t.closest(".confidence-row");
			if (row) row.querySelectorAll("[data-confidence]").forEach((b) => b.classList.toggle("active", b === t));
		},
		"data-ankigrade": (v, t) => onGrade(t.getAttribute("data-card"), v),
		"data-ankiundo": () => { if (session && session.graded > 0) session.graded--; log("reviewUndo", {}); },
		"data-ankitab": (v) => { if (session && v !== "study") endSession("nav"); },
	};
	// PERF (Audit 21. Juli): Selektor einmal bauen — dieser Capture-Listener läuft bei
	// JEDEM Klick in der App; der String-Aufbau pro Klick war unnötige Arbeit.
	const ACTION_SELECTOR = Object.keys(ACTIONS).map((a) => `[${a}]`).join(",") + ",#btnTeleExport";
	document.addEventListener("click", (e) => {
		const t = e.target?.closest?.(ACTION_SELECTOR);
		if (!t) return;
		const attr = Object.keys(ACTIONS).find((a) => t.hasAttribute(a));
		if (attr) ACTIONS[attr](t.getAttribute(attr), t);
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
	const median = (list) => {
		if (!list.length) return 0;
		const s = [...list].sort((a, b) => a - b), m = s.length >> 1;
		return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
	};
	const passRate = (list) => list.filter((e) => e.data.grade > 1).length / list.length;
	const pct = (x) => Math.round(x * 100);

	// Insights für die Home-Seite: nur Aussagen mit genug Daten, sonst Hinweis.
	// PERF (Audit 21. Juli): Ergebnis cachen — die Home-Seite rendert bei jedem
	// State-Event (auch Sync-Ticks), und diese Auswertung scannt das gesamte
	// Telemetrie-Log mehrfach. Neu gerechnet wird nur bei neuen Daten oder neuer
	// Stunde (die 7-/30-Tage-Fenster bewegen sich langsamer als eine Stunde).
	let _insightsKey = "", _insightsHtml = "";
	function homeInsightsHtml() {
		const tele = S.telemetry || [];
		const cacheKey = tele.length + ":" + (S.reviews || []).length + ":" + new Date().getHours();
		if (cacheKey === _insightsKey && _insightsHtml) return _insightsHtml;
		const reviews = tele.filter((e) => e.kind === "review" && e.data && e.data.grade > 0);
		const row = (icon, title, sub) => `<div class="insight"><span class="insight-ico">${icon}</span><span><b>${title}</b><small>${sub}</small></span></div>`;
		const out = [];

		// 1) Beste Tageszeit (Erfolgsquote nach Tagesabschnitt, min. 15 Bewertungen)
		const slots = [["morgens (5–11 Uhr)", 5, 11], ["mittags (11–15 Uhr)", 11, 15], ["nachmittags (15–19 Uhr)", 15, 19], ["abends (19–24 Uhr)", 19, 24], ["nachts (0–5 Uhr)", 0, 5]]
			.map(([label, from, to]) => {
				const list = reviews.filter((e) => e.data.hour >= from && e.data.hour < to);
				return { label, n: list.length, rate: list.length ? passRate(list) : 0 };
			}).filter((s) => s.n >= 15).sort((a, b) => b.rate - a.rate);
		if (slots.length >= 2) {
			const best = slots[0], worst = slots.at(-1);
			out.push(row("🌅", `Du lernst ${best.label} am besten`,
				`${pct(best.rate)} % richtig (${best.n} Karten) — ${worst.label} nur ${pct(worst.rate)} %. Lege schwere Stapel in deine starke Zeit.`));
		}

		// 2) Denkzeit (Median) + Trend: letzte 7 Tage vs. davor
		const timed = reviews.filter((e) => Number.isFinite(e.data.thinkMs) && e.data.thinkMs > 0 && e.data.thinkMs < 120000);
		if (timed.length >= 15) {
			const cut7 = new Date(Date.now() - 7 * 864e5).toISOString();
			const med = (list) => median(list.map((e) => e.data.thinkMs));
			const recent = timed.filter((e) => e.t >= cut7), older = timed.filter((e) => e.t < cut7);
			let trend = ".";
			if (recent.length >= 10 && older.length >= 10) {
				const diff = Math.round((med(older) - med(recent)) / Math.max(1, med(older)) * 100);
				trend = diff > 5 ? ` — zuletzt ${diff} % schneller ✅` : diff < -5 ? ` — zuletzt ${-diff} % langsamer.` : " — stabil.";
			}
			out.push(row("⚡", `Denkzeit: ${(med(timed) / 1000).toFixed(1)} s pro Karte (Median)`, "Zeit von Frage bis „Antwort zeigen“" + trend));
		}

		// 3) Kalibrierung: Selbsteinschätzung vs. tatsächlicher Erfolg
		const withConf = reviews.filter((e) => e.data.confidence);
		const confRate = (key) => {
			const list = withConf.filter((e) => e.data.confidence === key);
			return list.length >= 10 ? { n: list.length, rate: passRate(list) } : null;
		};
		const sure = confRate("sure"), guess = confRate("guess");
		if (sure) {
			const p = pct(sure.rate);
			out.push(row("🎯", `Kalibrierung: „Sicher“-Karten stimmen zu ${p} %`,
				p < 85
					? "Du überschätzt dich etwas — bei „Sicher“ sollten ≥ 85 % stimmen. Antwort erst im Kopf formulieren, dann aufdecken."
					: "Deine Selbsteinschätzung ist verlässlich." + (guess ? ` Geratene Karten: ${pct(guess.rate)} % Treffer.` : "")));
		}

		// 4) Ermüdung: Erfolg der ersten 20 Karten vs. Rest der Sitzung
		const early = reviews.filter((e) => e.data.pos < 20), late = reviews.filter((e) => e.data.pos >= 40);
		if (early.length >= 30 && late.length >= 30) {
			const er = passRate(early), lr = passRate(late);
			if (er - lr > 0.08) out.push(row("🪫", `Lange Sitzungen kosten dich ${pct(er - lr)} Punkte`,
				`Ab Karte 40 sinkt deine Quote von ${pct(er)} % auf ${pct(lr)} % — lieber mehrere kurze Blöcke mit Timer.`));
		}

		// 5) Fokus: Ablenkungen pro Lernstunde
		const ends = tele.filter((e) => e.kind === "studyEnd" && e.data && e.data.durationMs > 60000);
		if (ends.length >= 3) {
			const hours = ends.reduce((sum, e) => sum + e.data.durationMs, 0) / 3600000;
			const perHour = ends.reduce((sum, e) => sum + (e.data.distractions || 0), 0) / Math.max(0.1, hours);
			out.push(row("🎧", `Fokus: ${perHour.toFixed(1)} Ablenkungen pro Lernstunde`,
				perHour > 6 ? "Viele App-Wechsel beim Lernen — probiere den Lerntimer mit stummem Gerät." : "Guter Fokus — App-Wechsel während des Lernens sind selten."));
		}

		// 6) Schwierigster Stapel (30 Tage) — nutzt S.reviews und funktioniert damit
		//    auch für die Zeit VOR Einführung der Telemetrie.
		const cut30 = new Date(Date.now() - 30 * 864e5).toISOString();
		const byDeck = {};
		for (const r of S.reviews || []) {
			if (r.t < cut30 || !(r.grade > 0) || r.first) continue;
			const d = (byDeck[r.deck || "Standard"] ??= { n: 0, pass: 0 });
			d.n++;
			if (r.grade > 1) d.pass++;
		}
		const decks = Object.entries(byDeck).filter(([, v]) => v.n >= 15)
			.map(([name, v]) => ({ name, n: v.n, rate: v.pass / v.n })).sort((a, b) => a.rate - b.rate);
		if (decks.length && decks[0].rate < 0.88) {
			const hard = decks[0];
			out.push(row("🧗", "Schwierigster Stapel: " + U.esc(hard.name),
				`${pct(hard.rate)} % Erfolgsquote (${hard.n} Reviews in 30 Tagen) — Karten vereinfachen oder in kleinere Schritte teilen.`));
		}

		_insightsHtml = out.length
			? `<div class="insight-list">${out.join("")}</div>`
			: '<div class="insight empty"><span class="insight-ico">🧠</span><span><b>Noch zu wenig Daten für Insights</b>' +
				'<small>Ab jetzt wird jede Bewertung mit Denkzeit, Tageszeit, Selbsteinschätzung und Fokus protokolliert. Nach ein paar Lerntagen erscheinen hier konkrete Empfehlungen.</small></span></div>';
		_insightsKey = cacheKey;
		return _insightsHtml;
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
				state: c.srs?.state ?? null, reps: c.srs?.reps || 0,
				lapses: c.srs?.lapses || 0, due: c.srs?.due ?? null,
				suspended: !!c.suspended, leech: !!c.leech,
			})),
		};
		U.download(`impala67-lerndaten-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(dump, null, 2));
		U.toast("Lerndaten exportiert.", "success");
	}

	return { log, mark, onReview, homeInsightsHtml, exportDump };
})();