"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { FACH } from "./fach.js";

// telemetrie.js — Lern-Telemetrie v4 (4. August 2026: Fach + verzögerte Retention)
// Neu in v3 (DRY): TELE.mark(feature) — experimente.js markiert Nutzung pro Karte,
// sie landet als exp-Array im review-Event; TELE.onReview(fn) liefert fertige
// Review-Daten an Abonnenten (analyse.js) statt einer zweiten Zustandsmaschine.
// Grundsätze unverändert:
// 1. Alles läuft über das bestehende Event-Log (STATE.dispatch "teleEvent") und synct über Drive.
// 2. KEINE Hooks in fremden Modulen: ein Capture-Click-Listener beobachtet die
//    data-Attribute des Lernmodus (render-anki.js) — app.js, srs.js & Co. bleiben unangetastet.
// 3. Öffentliche API: TELE.log / TELE.mark / TELE.onReview / TELE.reviewEvents / TELE.passRate /
//    TELE.thinkMedian / TELE.homeInsightsHtml / TELE.exportDump
//    (Nutzer: lernzeit.js, render.js, experimente.js, analyse.js; #btnTeleExport aus settings.js wird weiter HIER behandelt).
//    thinkMedian ist NICHT tot: analyse.js nutzt es als Schwelle für den Ehrlichkeits-Hinweis.
// 4. Telemetrie darf den UI-Fluss NIE stören: fire-and-forget, alle Fehler werden geschluckt.

export const TELE = (() => {
	const clamp = (ms) => Math.min(300000, Math.max(0, ms)); // AFK-Schutz: > 5 min sind keine Lernzeit
	// bewusst über localStorage statt Import — vermeidet einen Zyklus mit lernzeit.js
	const timerActive = () => Number(localStorage.getItem("impala67_lernzeit_timer_end") || 0) > Date.now();

	// ⏱ Persönliche Denkzeit-Basis (25. Juli): Feste Sekunden-Schwellen taugen nichts —
	// 20 s sind bei einer Formel-Karte normal und bei einer Vokabel eine Ewigkeit. Jede
	// Karte wird deshalb mit dem EIGENEN Median verglichen (letzte 300 Bewertungen,
	// ohne getippte Feynman-Karten). Ergebnis wird gecacht — das Log kann groß sein.
	// EIN Median-Helfer für die ganze Datei (war doppelt: hier grob per Index, unten exakt).
	const median = (list) => {
		if (!list.length) return 0;
		const s = [...list].sort((a, b) => a - b), m = s.length >> 1;
		return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
	};
	// Cache-Schlüssel: Länge ALLEIN reicht nicht — Log-Merge (drive.js) und Verdichtung
	// (db.js) können gleich viele Events zurücklassen; die Caches blieben dann stale.
	const logStamp = (list) => list.length + ":" + (list.length ? (list[list.length - 1].t || list[list.length - 1].id || "") : "");

	let _medKey = "", _medVal = 0;
	function thinkMedian() {
		const tele = S.telemetry || [];
		const key = logStamp(tele);
		if (key === _medKey) return _medVal;
		const rs = reviewEvents(); // zurückgenommene Bewertungen sind hier schon draußen
		const vals = [];
		for (let i = rs.length - 1; i >= 0 && vals.length < 300; i--) {
			const e = rs[i];
			if (e.data.typed) continue;
			const ms = e.data.thinkMs;
			if (Number.isFinite(ms) && ms > 400 && ms < 120000) vals.push(ms);
		}
		_medKey = key;
		_medVal = vals.length >= 12 ? median(vals) : 0; // zu wenig eigene Daten → kein Urteil
		return _medVal;
	}
	// Selbsteinschätzung automatisch (25. Juli): „Wie sicher bist du?“ muss niemand mehr
	// anklicken — zügige Antworten saßen sicher, sehr zögerliche waren geraten. Nur wenn
	// genug eigene Daten vorliegen UND die Zeit nicht durch Tippen oder einen App-Wechsel
	// verfälscht ist (im Feynman-Modus misst die Uhr Schreibarbeit, kein Zögern).
	function autoConfidence(thinkMs, ctx) {
		const med = thinkMedian();
		if (!med || !Number.isFinite(thinkMs) || thinkMs <= 0) return null;
		if (ctx && (ctx.typed || ctx.distracted)) return null;
		if (thinkMs <= med * 0.6) return "sure";
		if (thinkMs >= med * 2.5) return "guess";
		if (thinkMs >= med * 1.4) return "unsure";
		return null;
	}

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
		session = { startedAt: Date.now(), deck: deck || null, graded: 0, lastReviewId: null,
			frontShownAt: Date.now(), revealedAt: 0, confidence: null, cardHidden: false, hiddenCount: 0, typed: false };
		log("studyStart", { deck: deck || null, due: STATE.dueCards ? STATE.dueCards().length : null, timer: timerActive() });
	}
	function endSession(reason) {
		if (!session) return;
		log("studyEnd", { deck: session.deck, graded: session.graded,
			durationMs: Date.now() - session.startedAt, distractions: session.hiddenCount, reason: reason || "leave" });
		session = null;
	}
	function previousReview(cardId, now) {
		let previous = null;
		for (const item of S.reviews || []) {
			if (!item || item.cardId !== cardId || item.grade <= 0) continue;
			const t = new Date(item.t).getTime();
			if (Number.isFinite(t) && t < now && (!previous || t > new Date(previous.t).getTime())) previous = item;
		}
		return previous;
	}
	function onGrade(cardId, grade, renderedReviewId) {
		if (!cardId) return;
		const now = Date.now();
		const card = S.cards[cardId] || {};
		const srs = card.srs || {}; // Capture-Phase: srs ist hier noch der Stand VOR der Bewertung
		const previous = previousReview(cardId, now);
		const subject = FACH.card(card);
		const base = session || { frontShownAt: now, revealedAt: 0, graded: 0, confidence: null, cardHidden: false, typed: false };
		const revealed = base.revealedAt || now;
		const d = new Date();
		const thinkMs = clamp(revealed - base.frontShownAt);
		// Getippt/diktiert (Feynman-Erklärfeld) → die Uhr maß Schreibarbeit, keine Denkpause.
		const typed = !!base.typed || !!S.ankiFeyn || expUsed.has("feynman");
		const data = {
			reviewId: renderedReviewId || U.uid(), cardId, subject: subject.name, subjectSource: subject.source,
			deck: card.deck || "Standard", grade: Number(grade) || 0,
			state: srs.state || null, reps: srs.reps || 0, lapses: srs.lapses || 0,
			first: srs.state === "new", learning: srs.state === "learning" || srs.state === "relearning",
			dueAt: srs.due || null, previousReviewAt: previous?.t || null,
			intervalDays: previous ? Math.max(0, (now - new Date(previous.t).getTime()) / 864e5) : null,
			thinkMs, // Denkzeit: Frage → „Antwort zeigen“
			gradeMs: clamp(now - revealed), // Bewertungszeit: „Antwort zeigen“ → Note
			pos: base.graded, // wievielte Karte der Sitzung (Ermüdungs-Analyse)
			hour: d.getHours(), dow: d.getDay(),
			confidence: base.confidence, // "sure" | "unsure" | "guess" | null (manuelle Chips, jetzt optional)
			confidenceAuto: base.confidence ? null : autoConfidence(thinkMs, { typed, distracted: base.cardHidden }), // aus der Antwortzeit erkannt
			typed, // Erklärung getippt/diktiert → Denkzeit NICHT als Zögern lesen
			distracted: base.cardHidden, // App während dieser Karte verlassen?
			timer: timerActive(),
			exp: expUsed.size ? [...expUsed] : null, // 🧪 auf dieser Karte benutzte Experimente (TELE.mark)
		};
		log("review", data);
		expUsed = new Set(); // Marker gelten pro Karte
		reviewSubs.forEach((fn) => { try { fn(data); } catch (err) { /* Abonnenten sind nie kritisch */ } });
		if (session) Object.assign(session, { graded: session.graded + 1, lastReviewId: data.reviewId, frontShownAt: now, revealedAt: 0, confidence: null, cardHidden: false, typed: false });
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
		"data-ankigrade": (v, t) => onGrade(t.getAttribute("data-card"), v, t.getAttribute("data-review-id")),
		"data-ankiundo": () => { if (session && session.graded > 0) session.graded--; log("reviewUndo", { reviewId: session?.lastReviewId || null }); },
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

	// Tippen/Diktieren im Feynman-Erklärfeld markieren — danach ist die gemessene Zeit
	// Schreibzeit und darf weder als Zögern noch als Unsicherheit gedeutet werden.
	document.addEventListener("input", (e) => {
		const t = e.target;
		if (session && t && t.classList && t.classList.contains("exp-answer")) session.typed = true;
	}, true);

	// Fokus-Verlust: App-Wechsel während Lern-Sitzung oder laufendem Timer.
	document.addEventListener("visibilitychange", () => {
		if (!document.hidden) return;
		if (session) { session.hiddenCount++; session.cardHidden = true; }
		if (session || timerActive()) log("focusLoss", { during: session ? "study" : "timer", view: S.view || null });
	});
	window.addEventListener("pagehide", () => endSession("close"));

	// ---------- Auswertung ----------
	// EINE Definition von „gültige Bewertung“ und „Erfolgsquote“ für alle Auswertungen —
	// analyse.js hatte beides nachgebaut, die Quoten konnten dadurch auseinanderlaufen.
	// Ein Undo nimmt die zuletzt gebuchte Bewertung zurück; ihr review-Event bleibt im
	// Log stehen (append-only) und wurde bisher in JEDER Quote weiter mitgezählt.
	const reviewEvents = () => {
		const out = [];
		for (const e of S.telemetry || []) {
			if (!e || !e.data) continue;
			if (e.kind === "review" && e.data.grade > 0) out.push(e);
			else if (e.kind === "reviewUndo") {
				const index = e.data.reviewId ? out.findIndex((item) => item.data.reviewId === e.data.reviewId) : out.length - 1;
				if (index >= 0) out.splice(index, 1);
			} // Fallback für alte Undo-Ereignisse bleibt chronologisch
		}
		return out;
	};
	const passRate = (list) => (list.length ? list.filter((e) => e.data.grade > 1).length / list.length : 0);
	const pct = (x) => Math.round(x * 100);
	const localDayKey = (value) => {
		const d = new Date(value);
		return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
	};
	function reviewSubject(review) {
		if (review?.subject) return String(review.subject).trim().slice(0, 80) || "Allgemein";
		return FACH.card(S.cards[review?.cardId])?.name || FACH.deck(review?.deck).name;
	}
	function reviewRows() {
		const sorted = (S.reviews || []).filter((review) => review && review.grade > 0)
			.slice().sort((a, b) => String(a.t).localeCompare(String(b.t)));
		const previous = new Map();
		return sorted.map((review) => {
			const prev = previous.get(review.cardId);
			const at = new Date(review.t).getTime();
			const storedGap = Number(review.intervalDays);
			const gapDays = Number.isFinite(storedGap) && storedGap >= 0
				? storedGap
				: (prev && Number.isFinite(at - prev.at) ? Math.max(0, (at - prev.at) / 864e5) : null);
			previous.set(review.cardId, { at, t: review.t });
			return { ...review, subject: reviewSubject(review), gapDays };
		});
	}
	function retentionBucket(rows, targetDays) {
		const min = targetDays === 1 ? 0.5 : targetDays * 0.6;
		const max = targetDays === 1 ? 2 : targetDays * 1.6;
		const eligible = rows.filter((row) => !row.first && !row.learning && Number.isFinite(row.gapDays) && row.gapDays >= min && row.gapDays <= max);
		return { n: eligible.length, rate: eligible.length ? eligible.filter((row) => row.grade > 1).length / eligible.length : null };
	}
	function retentionStats(rows) {
		return { day1: retentionBucket(rows, 1), day3: retentionBucket(rows, 3), day7: retentionBucket(rows, 7), day14: retentionBucket(rows, 14) };
	}
	function subjectStats(rows) {
		const groups = {};
		for (const row of rows) (groups[row.subject] ||= []).push(row);
		return Object.entries(groups).map(([subject, list]) => ({
			subject, reviews: list.length,
			passRate: list.length ? list.filter((row) => row.grade > 1).length / list.length : null,
			retention: retentionStats(list),
		})).sort((a, b) => b.reviews - a.reviews);
	}
	function retentionStatsForReviews(reviews) {
		const ids = new Set((reviews || []).map((review) => review && review.id).filter(Boolean));
		return retentionStats(reviewRows().filter((review) => ids.has(review.id)));
	}

	// Kompakte, markup-freie Auswertung für frei wählbare Zeiträume. So können
	// Lernzeit und Karten-Erfolg im selben Dashboard erscheinen, ohne dass
	// render.js dieselbe Telemetrie-Logik erneut implementiert.
	function rangeStats(from, to) {
		const start = new Date(from).getTime(), end = new Date(to).getTime();
		const inRange = (value) => {
			const t = new Date(value).getTime();
			return Number.isFinite(t) && t >= start && t < end;
		};
		// S.reviews reicht weiter zurück als die später eingeführte Telemetrie und
		// entfernt Undos bereits im Reducer. Denkzeit/Fokus kommen ergänzend aus
		// den detailreicheren Telemetrie-Events.
		const rows = reviewRows();
		const reviews = rows.filter((r) => inRange(r.t));
		const detailed = reviewEvents().filter((e) => inRange(e.t));
		const timed = detailed.filter((e) => !e.data.typed && !e.data.distracted && Number.isFinite(e.data.thinkMs) && e.data.thinkMs > 400 && e.data.thinkMs < 120000);
		const byDay = {};
		for (const review of reviews) byDay[localDayKey(review.t)] = (byDay[localDayKey(review.t)] || 0) + 1;
		const focusLosses = (S.telemetry || []).filter((e) => e && e.kind === "focusLoss" && inRange(e.t)).length;
		const timerReviews = detailed.filter((e) => e.data.timer).length;
		return {
			reviews: reviews.length,
			passRate: reviews.length ? reviews.filter((r) => r.grade > 1).length / reviews.length : null,
			medianThinkMs: timed.length ? median(timed.map((e) => e.data.thinkMs)) : null,
			byDay,
			focusLosses,
			timerReviews,
			retention: retentionStats(reviews),
			bySubject: subjectStats(reviews),
		};
	}

	// Insights für die Home-Seite: nur Aussagen mit genug Daten, sonst Hinweis.
	// PERF (Audit 21. Juli): Ergebnis cachen — die Home-Seite rendert bei jedem
	// State-Event (auch Sync-Ticks), und diese Auswertung scannt das gesamte
	// Telemetrie-Log mehrfach. Neu gerechnet wird nur bei neuen Daten oder neuer
	// Stunde (die 7-/30-Tage-Fenster bewegen sich langsamer als eine Stunde).
	let _insightsKey = "", _insightsHtml = "";
	function homeInsightsHtml() {
		const tele = S.telemetry || [];
		const cacheKey = logStamp(tele) + ":" + logStamp(S.reviews || []) + ":" + new Date().getHours();
		if (cacheKey === _insightsKey && _insightsHtml) return _insightsHtml;
		const reviews = reviewEvents();
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

		// 3) Kalibrierung: Einschätzung vs. tatsächlicher Erfolg. Bevorzugt die (jetzt
		// optionalen) Chips; ohne sie zählt die automatisch aus der Antwortzeit erkannte
		// Sicherheit — dann auch mit ehrlicher Formulierung („zügig“ statt „du warst sicher“).
		const manualConf = reviews.filter((e) => e.data.confidence);
		const useAuto = manualConf.filter((e) => e.data.confidence === "sure").length < 10;
		const confKey = useAuto ? "confidenceAuto" : "confidence";
		const withConf = useAuto ? reviews.filter((e) => !e.data.confidence && e.data.confidenceAuto) : manualConf;
		const confRate = (key) => {
			const list = withConf.filter((e) => e.data[confKey] === key);
			return list.length >= 10 ? { n: list.length, rate: passRate(list) } : null;
		};
		const sure = confRate("sure"), guess = confRate("guess");
		if (sure) {
			const p = pct(sure.rate);
			out.push(row("🎯", useAuto
				? `Zügig beantwortete Karten stimmen zu ${p} %`
				: `Kalibrierung: „Sicher“-Karten stimmen zu ${p} %`,
				p < 85
					? (useAuto
						? "Schnell heißt bei dir noch nicht sicher — lieber die Antwort erst vollständig im Kopf formulieren, dann aufdecken."
						: "Du überschätzt dich etwas — bei „Sicher“ sollten ≥ 85 % stimmen. Antwort erst im Kopf formulieren, dann aufdecken.")
					: (useAuto ? "Dein Bauchgefühl passt: schnelle Karten sitzen wirklich." : "Deine Selbsteinschätzung ist verlässlich.") +
						(guess ? ` Lange gezögerte Karten: ${pct(guess.rate)} % Treffer.` : "")));
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

	return { log, mark, onReview, reviewEvents, passRate, thinkMedian, rangeStats, retentionStatsForReviews, homeInsightsHtml, exportDump };
})();
