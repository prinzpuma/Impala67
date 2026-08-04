"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { TELE } from "./telemetrie.js";

// lernzeit.js — Lernzeit v4 (4. August 2026)
// v4: Home-Analyse mit Woche/Tag-Schalter, Fachdimension, Tagesverlauf und
// Vergleichskennzahlen. Die Erfassungs-Engine (automatische Segmente, Idle-Tier,
// Kategorie-Split) bleibt local-first und rückwärtskompatibel.

export const LERNZEIT = (() => {
	const IDLE_MS = 60000;
	const TICK_MS = 5000;
	const TIMER_KEY = "impala67_lernzeit_timer_end";
	const TIMER_MIN_KEY = "impala67_lernzeit_timer_minutes";
	const TIMER_PAUSE_KEY = "impala67_lernzeit_timer_paused_left";
	const GOAL_KEY = "impala67WeekGoalMinutes";
	const FOLD_KEY = "impala67LzFolds";
	const CATEGORIES = {
		cards: { icon: "🃏", label: "Karteikarten" },
		notebook: { icon: "📓", label: "Hefte" },
		notes: { icon: "📝", label: "Notizen" },
		ai: { icon: "✦", label: "KI" },
		other: { icon: "⏱", label: "Sonstiges" },
	};
	const ANIMALS = ["🦊", "🐹", "🦉", "🐢", "🐨", "🐸", "🐼"];

	let lastActivityAt = Date.now();
	let current = null;
	let animal = null;
	let timerEndsAt = Number(localStorage.getItem(TIMER_KEY) || 0);
	let timerPausedLeft = Number(localStorage.getItem(TIMER_PAUSE_KEY) || 0);
	let weekOffset = 0;
	let monthOffset = 0;
	let analysisMode = "week";

	function iso() { return new Date().toISOString(); }
	function dayKey(value) {
		const d = new Date(value || Date.now());
		return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
	}
	function fmt(seconds) {
		const total = Math.max(0, Math.round(seconds || 0));
		const h = Math.floor(total / 3600);
		const m = Math.floor((total % 3600) / 60);
		return h ? h + " h " + String(m).padStart(2, "0") + " min" : m + " min";
	}
	function activeSessions() {
		return Object.values(S.learningSessions || {}).filter((item) => item && !item.deleted && item.durationSeconds > 0);
	}
	function cleanSubject(value) {
		return String(value || "").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
	}
	function pageSubject(page) {
		if (!page) return "Allgemein";
		if (page.subject) return cleanSubject(page.subject);
		const tag = Array.isArray(page.tags) ? page.tags.find((item) => cleanSubject(item)) : "";
		if (tag) return cleanSubject(tag);
		let root = page, hops = 0;
		while (root.parentId && S.pages[root.parentId] && hops++ < 100) root = S.pages[root.parentId];
		const title = cleanSubject(root.title);
		if (title && !/^(daily notes?|notizen?|willkommen|start)$/i.test(title)) return title;
		const workspace = cleanSubject(S.workspaces[page.workspaceId || "default"]?.name);
		return workspace && workspace.toLowerCase() !== "privat" ? workspace : "Notizen";
	}
	function subjectNow() {
		const page = S.currentPageId && S.pages[S.currentPageId];
		if (S.view === "anki" && S.ankiTab === "study") {
			const deck = cleanSubject(S.ankiDeck || "").split("::")[0];
			return deck || "Karteikarten";
		}
		if (page) return pageSubject(page);
		if (S.aiBusy) return "KI / Allgemein";
		return "Allgemein";
	}
	function categoryNow() {
		if (S.aiBusy) return { category: "ai", sourceId: S.currentChatId || null, subject: subjectNow() };
		if (S.view === "anki" && S.ankiTab === "study") return { category: "cards", sourceId: S.ankiDeck || null, subject: subjectNow() };
		const page = S.currentPageId && S.pages[S.currentPageId];
		if (page && page.kind === "heft" && S.view === "page") return { category: "notebook", sourceId: page.id, subject: subjectNow() };
		const active = document.activeElement;
		if (page && active && (active.id === "pageTitle" || active.isContentEditable || (active.closest && active.closest(".block-editor")))) {
			return { category: "notes", sourceId: page.id, subject: subjectNow() };
		}
		return { category: "other", sourceId: null, subject: subjectNow() };
	}

	function openSegment() {
		if (current) return;
		const meta = categoryNow();
		current = { id: U.uid(), startedAt: iso(), startedMs: Date.now(), category: meta.category, sourceId: meta.sourceId, subject: meta.subject };
	}
	async function closeSegment() {
		if (!current) return;
		const finished = current;
		current = null;
		const durationSeconds = Math.round((Date.now() - finished.startedMs) / 1000);
		if (durationSeconds < 5) return;
		await STATE.dispatch("learningSessionUpsert", {
			id: finished.id,
			startedAt: finished.startedAt,
			endedAt: iso(),
			durationSeconds,
			category: finished.category,
			sourceId: finished.sourceId,
			subject: finished.subject,
			updated: iso(),
		});
	}
	function maybeSplitSegment() {
		if (!current) return;
		const next = categoryNow();
		if (next.category === current.category && next.sourceId === current.sourceId && next.subject === current.subject) return;
		closeSegment().then(openSegment);
	}

	// Aktivität melden — EINE Stelle für alle Eingabewege. 🐛 Fix (27. Juli): Ein Gamepad
	// erzeugt KEINE pointer-/keydown-Ereignisse. Die Erfassung hielt das Abfragen mit dem
	// 🎮 Controller deshalb für Leerlauf, schob „Lernst du noch?“ mitten ins Bild — und
	// weggeklickt bekam man es mit dem Pad auch nicht, weil das Tierchen nur auf
	// pointerenter/click hört. Rückgabe: true, wenn das Tierchen dadurch verschwunden ist
	// (dann war die Eingabe nur ein Aufwecken und soll nichts weiter auslösen).
	function poke() {
		lastActivityAt = Date.now();
		if (!animal) return false;
		animal.remove();
		animal = null;
		openSegment();
		refreshLive();
		return true;
	}

	function showAnimal() {
		if (animal) return;
		closeSegment();
		animal = document.createElement("button");
		animal.type = "button";
		animal.id = "lzAnimal";
		animal.innerHTML = '<span>' + ANIMALS[Math.floor(Math.random() * ANIMALS.length)] + '</span><b>Lernst du noch?</b><small>Berühre mich oder fahre darüber, um die Lernzeit fortzusetzen.</small>';
		const resume = () => poke();
		animal.addEventListener("pointerenter", resume, { once: true });
		animal.addEventListener("click", resume, { once: true });
		document.body.appendChild(animal);
	}

	function openTimerDone(minutes) {
		const overlay = document.getElementById("overlay");
		if (!overlay) { U.toast("⏰ Lernblock geschafft — " + minutes + " Minuten.", "success"); return; }
		overlay.hidden = false;
		overlay.innerHTML = '<div class="modal lz-done"><h3>🎉 Lernblock geschafft</h3><p><b>' + minutes + ' Minuten</b> fokussiert gelernt. Gute Arbeit!</p><div class="modal-actions"><button data-lz-start="5">5 Min weiter</button><button data-lz-close="1">Pause machen</button></div></div>';
	}

	// ---------- Timer (v3: mit Pause/Fortsetzen + Fortschritt) ----------
	function timerRunning() { return timerEndsAt > Date.now(); }
	function timerPaused() { return !timerRunning() && timerPausedLeft > 0; }
	function timerTotalMin() { return Math.max(1, Math.round(Number(localStorage.getItem(TIMER_MIN_KEY)) || 25)); }
	function startTimer(minutes) {
		const min = Math.max(5, Math.min(240, Number(minutes) || 25));
		timerEndsAt = Date.now() + min * 60000;
		timerPausedLeft = 0;
		localStorage.setItem(TIMER_KEY, String(timerEndsAt));
		localStorage.setItem(TIMER_MIN_KEY, String(min));
		localStorage.removeItem(TIMER_PAUSE_KEY);
		lastActivityAt = Date.now();
		openSegment();
		TELE.log("timerStart", { minutes: min });
		renderHomeWidget();
	}
	function pauseTimer() {
		if (!timerRunning()) return;
		timerPausedLeft = Math.max(1000, timerEndsAt - Date.now());
		timerEndsAt = 0;
		localStorage.removeItem(TIMER_KEY);
		localStorage.setItem(TIMER_PAUSE_KEY, String(timerPausedLeft));
		TELE.log("timerPause", { leftMs: timerPausedLeft });
		renderHomeWidget();
	}
	function resumeTimer() {
		if (!timerPaused()) return;
		timerEndsAt = Date.now() + timerPausedLeft;
		timerPausedLeft = 0;
		localStorage.setItem(TIMER_KEY, String(timerEndsAt));
		localStorage.removeItem(TIMER_PAUSE_KEY);
		lastActivityAt = Date.now();
		openSegment();
		TELE.log("timerResume", {});
		renderHomeWidget();
	}
	async function stopTimer() {
		const leftMs = timerRunning() ? timerEndsAt - Date.now() : timerPausedLeft;
		TELE.log("timerStop", { plannedMin: timerTotalMin(), leftMs: Math.max(0, leftMs) });
		timerEndsAt = 0;
		timerPausedLeft = 0;
		localStorage.removeItem(TIMER_KEY);
		localStorage.removeItem(TIMER_PAUSE_KEY);
		await closeSegment();
		renderHomeWidget();
	}

	function tick() {
		if (document.hidden || animal) return;
		if (Date.now() - lastActivityAt >= IDLE_MS) { showAnimal(); return; }
		openSegment();
		maybeSplitSegment();
		if (timerEndsAt && Date.now() >= timerEndsAt) {
			const minutes = timerTotalMin();
			timerEndsAt = 0;
			timerPausedLeft = 0;
			localStorage.removeItem(TIMER_KEY);
			localStorage.removeItem(TIMER_PAUSE_KEY);
			TELE.log("timerDone", { minutes });
			closeSegment();
			openTimerDone(minutes);
		}
		refreshLive();
	}

	// ---------- Auswertung ----------
	// 🩹 FIX (18. Juli 2026): Zwei Geräte gleichzeitig → Zeit wurde DOPPELT gezählt.
	// Ursache: Jedes Gerät schreibt eigene Segmente ins Event-Log; nach dem
	// Drive-Sync liegen beide nebeneinander, und die Auswertung hat alle
	// durationSeconds stumpf addiert. Jetzt: Intervall-VEREINIGUNG — zeitlich
	// überlappende Segmente zählen nur einmal (Wanduhr-Zeit statt Summe).
	function mergedSeconds(sessions) {
		const intervals = sessions.map((s) => {
			const start = new Date(s.startedAt).getTime();
			const end = s.endedAt ? new Date(s.endedAt).getTime() : start + (s.durationSeconds || 0) * 1000;
			return [start, Math.max(start, end)];
		}).filter(([start]) => Number.isFinite(start)).sort((a, b) => a[0] - b[0]);
		let total = 0;
		let curStart = null;
		let curEnd = null;
		for (const [start, end] of intervals) {
			if (curEnd === null || start > curEnd) {
				if (curEnd !== null) total += curEnd - curStart;
				curStart = start;
				curEnd = end;
			} else if (end > curEnd) {
				curEnd = end;
			}
		}
		if (curEnd !== null) total += curEnd - curStart;
		return Math.round(total / 1000);
	}
	// Laufendes Segment als Pseudo-Session — nimmt an der Vereinigung teil,
	// damit auch LIVE nichts doppelt zählt, wenn das andere Gerät gerade synct.
	function currentAsSession() {
		if (!current) return null;
		return { startedAt: current.startedAt, endedAt: iso(), durationSeconds: Math.max(0, Math.floor((Date.now() - current.startedMs) / 1000)), category: current.category, subject: current.subject };
	}
	function sessionSubject(session) {
		if (session.subject) return cleanSubject(session.subject);
		if (session.category === "cards") return cleanSubject(String(session.sourceId || "").split("::")[0]) || "Karteikarten";
		const page = session.sourceId && S.pages[session.sourceId];
		return pageSubject(page);
	}
	function totalForDay(key) {
		const list = activeSessions().filter((s) => dayKey(s.startedAt) === key);
		const live = key === dayKey() ? currentAsSession() : null;
		if (live) list.push(live);
		return mergedSeconds(list);
	}
	function totalsByDay() {
		const grouped = {};
		const sessions = activeSessions();
		const live = currentAsSession();
		if (live) sessions.push(live);
		for (const session of sessions) (grouped[dayKey(session.startedAt)] ||= []).push(session);
		const totals = {};
		for (const [key, list] of Object.entries(grouped)) totals[key] = mergedSeconds(list);
		return totals;
	}
	function groupedSubjects(from, to) {
		const start = from.getTime(), end = to.getTime(), groups = {};
		const sessions = sessionsInRange(from, to);
		const live = currentAsSession();
		if (live && Date.now() >= start && Date.now() < end) sessions.push(live);
		for (const session of sessions) (groups[sessionSubject(session)] ||= []).push(session);
		return Object.entries(groups).map(([subject, list]) => ({ subject, seconds: mergedSeconds(list), sessions: list.length }))
			.sort((a, b) => b.seconds - a.seconds);
	}
	function sessionsInRange(from, to) {
		const start = from.getTime(), end = to.getTime();
		return activeSessions().filter((s) => {
			const t = new Date(s.startedAt).getTime();
			return Number.isFinite(t) && t >= start && t < end;
		}).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
	}
	function weekStart(offset = 0) {
		const d = new Date();
		d.setHours(0, 0, 0, 0);
		d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
		return d;
	}
	function weekData(offset = 0, totals = null) {
		const start = weekStart(offset);
		return Array.from({ length: 7 }, (_, index) => {
			const d = new Date(start); d.setDate(d.getDate() + index);
			return { d, seconds: totals ? (totals[dayKey(d)] || 0) : totalForDay(dayKey(d)) };
		});
	}
	function weekRange(offset = 0) {
		const from = weekStart(offset), to = new Date(from);
		to.setDate(to.getDate() + 7);
		return { from, to };
	}
	function monthStart(offset = 0) {
		const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(1); d.setMonth(d.getMonth() + offset);
		return d;
	}
	function monthRange(offset = 0) {
		const from = monthStart(offset), to = new Date(from); to.setMonth(to.getMonth() + 1);
		return { from, to };
	}
	function monthDays(offset = 0, totals = null) {
		const from = monthStart(offset), to = monthRange(offset).to, days = [];
		for (const d = new Date(from); d < to; d.setDate(d.getDate() + 1)) {
			const copy = new Date(d);
			days.push({ d: copy, seconds: totals ? (totals[dayKey(copy)] || 0) : totalForDay(dayKey(copy)) });
		}
		return days;
	}
	function monthStats(offset = 0, totals = null) {
		const { from, to } = monthRange(offset), days = monthDays(offset, totals);
		const seconds = days.reduce((sum, item) => sum + item.seconds, 0);
		const previous = monthDays(offset - 1, totals).reduce((sum, item) => sum + item.seconds, 0);
		return {
			from, to, days, seconds, previousSeconds: previous,
			activeDays: days.filter((item) => item.seconds >= 300).length,
			averageSeconds: days.filter((item) => item.seconds >= 300).length ? Math.round(seconds / days.filter((item) => item.seconds >= 300).length) : 0,
			reviews: TELE.rangeStats(from, to),
			previousReviews: TELE.rangeStats(monthRange(offset - 1).from, from),
		};
	}
	function monthCalendar(days, reviews) {
		const leading = (days[0].d.getDay() + 6) % 7;
		const max = Math.max(1, ...days.map((item) => item.seconds));
		const head = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((label) => '<span>' + label + '</span>').join("");
		const cells = Array.from({ length: leading }, () => '<i class="lz-month-empty"></i>').join("") + days.map((item) => {
			const level = item.seconds ? Math.max(1, Math.ceil(item.seconds / max * 4)) : 0;
			const reviewCount = reviews.byDay[dayKey(item.d)] || 0;
			return '<div class="lz-month-day lvl-' + level + (dayKey(item.d) === dayKey() ? ' today' : '') + '" title="' + dateLabel(item.d, { weekday: "long", day: "numeric", month: "long" }) + ' · ' + fmt(item.seconds) + (reviewCount ? ' · ' + reviewCount + ' Reviews' : '') + '"><b>' + item.d.getDate() + '</b><i style="height:' + (item.seconds ? Math.max(4, Math.round(item.seconds / max * 100)) : 2) + '%"></i><small>' + (reviewCount || '') + '</small></div>';
		}).join("");
		return '<div class="lz-month-calendar"><div class="lz-month-weekdays">' + head + '</div><div class="lz-month-grid">' + cells + '</div></div>';
	}
	function dateLabel(date, options) { return date.toLocaleDateString("de-DE", options); }
	function rangeTitle(from, to, mode) {
		if (mode === "month") return dateLabel(from, { month: "long", year: "numeric" });
		const end = new Date(to); end.setDate(end.getDate() - 1);
		return dateLabel(from, { day: "2-digit", month: "short" }) + " – " + dateLabel(end, { day: "2-digit", month: "short", year: "numeric" });
	}
	function weekStats(offset = 0, totals = null) {
		const goal = weekGoalMinutes();
		const days = weekData(offset, totals);
		const seconds = days.reduce((sum, x) => sum + x.seconds, 0);
		const previousSeconds = weekData(offset - 1, totals).reduce((sum, x) => sum + x.seconds, 0);
		const activeDays = days.filter((x) => x.seconds >= 5 * 60).length;
		const bestDay = days.reduce((best, item) => item.seconds > best.seconds ? item : best, days[0]);
		const { from, to } = weekRange(offset);
		return {
			from, to, days, seconds, previousSeconds, activeDays, bestDay,
			averageSeconds: activeDays ? Math.round(seconds / activeDays) : 0,
			goalMinutes: goal,
			goalPct: Math.round(seconds / 60 / goal * 100),
			reviews: TELE.rangeStats(from, to),
			previousReviews: TELE.rangeStats(weekRange(offset - 1).from, from),
		};
	}
	// Streak: aufeinanderfolgende Tage mit ≥ 5 min Lernzeit. Ein noch „leerer“
	// heutiger Tag bricht die Serie nicht — sie zählt dann ab gestern.
	function streakDays(totals = null) {
		const MIN = 5 * 60;
		let streak = 0;
		for (let i = 0; i < 365; i++) {
			const d = new Date(); d.setDate(d.getDate() - i);
			const seconds = totals ? (totals[dayKey(d)] || 0) : totalForDay(dayKey(d));
			if (seconds >= MIN) streak++;
			else if (i === 0) continue;
			else break;
		}
		return streak;
	}
	function weekGoalMinutes() { return Math.max(30, Number(localStorage.getItem(GOAL_KEY)) || 300); }
	function cycleGoal() {
		const presets = [120, 300, 480, 720];
		const next = presets[(presets.indexOf(weekGoalMinutes()) + 1 + presets.length) % presets.length];
		localStorage.setItem(GOAL_KEY, String(next));
		TELE.log("goalChange", { minutes: next });
		renderHomeWidget();
		U.toast("🎯 Wochenziel: " + Math.round(next / 60 * 10) / 10 + " h", "success");
	}
	// Kennzahlen für die Home-Seite (render.js) — eine Quelle für alle Widgets.
	function statsForHome(totals = totalsByDay()) {
		const goal = weekGoalMinutes();
		const week = weekData(0, totals);
		const weekSeconds = week.reduce((sum, x) => sum + x.seconds, 0);
		return {
			todaySeconds: totals[dayKey()] || 0,
			streakDays: streakDays(totals),
			goalPct: Math.round(weekSeconds / 60 / goal * 100),
		};
	}

	// ---------- Ausklappbare Widget-Bereiche (Zustand wird gemerkt) ----------
	function folds() {
		try { return JSON.parse(localStorage.getItem(FOLD_KEY) || "{}") || {}; } catch { return {}; }
	}
	function foldOpen(id, fallback) {
		const f = folds();
		return f[id] === undefined ? fallback : !!f[id];
	}
	document.addEventListener("toggle", (event) => {
		const el = event.target;
		if (!el || !el.matches || !el.matches("details[data-lzfold]")) return;
		const f = folds();
		f[el.getAttribute("data-lzfold")] = el.open;
		localStorage.setItem(FOLD_KEY, JSON.stringify(f));
	}, true);
	function fold(id, summary, body, fallbackOpen) {
		return '<details class="lz-fold" data-lzfold="' + id + '"' + (foldOpen(id, fallbackOpen) ? " open" : "") +
			'><summary>' + summary + '</summary><div class="lz-fold-body">' + body + '</div></details>';
	}

	// ---------- Widget ----------
	function timerCardHtml() {
		if (timerRunning()) {
			const totalMs = timerTotalMin() * 60000;
			const leftMs = Math.max(0, timerEndsAt - Date.now());
			const pctDone = Math.min(100, Math.max(0, Math.round((1 - leftMs / totalMs) * 100)));
			return '<div class="lz-timer-card running"><div class="lz-timer-info"><small>Lerntimer läuft — ' + timerTotalMin() + ' min geplant</small>' +
				'<b data-lz-timer-label>Noch ' + Math.max(1, Math.ceil(leftMs / 60000)) + ' min</b>' +
				'<div class="lz-progress"><i data-lz-timer-bar style="width:' + pctDone + '%"></i></div></div>' +
				'<div class="lz-timer-actions"><button data-lz-pause="1">⏸ Pause</button><button class="mini" data-lz-stop="1">Beenden</button></div></div>';
		}
		if (timerPaused()) {
			return '<div class="lz-timer-card paused"><div class="lz-timer-info"><small>Timer pausiert</small><b>Noch ' + Math.max(1, Math.ceil(timerPausedLeft / 60000)) + ' min übrig</b></div>' +
				'<div class="lz-timer-actions"><button class="primary" data-lz-resume="1">▶ Weiter</button><button class="mini" data-lz-stop="1">Beenden</button></div></div>';
		}
		return '<div class="lz-timer-card"><div class="lz-timer-info"><small>Fokusblock starten</small><b>Wie lange möchtest du lernen?</b></div>' +
			'<div class="lz-timer-actions"><button data-lz-start="15">15</button><button data-lz-start="25">25</button><button data-lz-start="45">45</button><button data-lz-start="60">60</button>' +
			'<input id="lzCustomMinutes" type="number" min="5" max="240" value="25" aria-label="Eigene Minuten"><button class="mini primary" data-lz-custom="1">Start</button></div></div>';
	}
	function homeWidgetHtml() {
		const mode = analysisMode;
		const range = mode === "month" ? monthRange(monthOffset) : weekRange(weekOffset);
		const totals = totalsByDay(), homeStats = statsForHome(totals);
		const selected = mode === "month" ? monthStats(monthOffset, totals) : weekStats(weekOffset, totals);
		const sessions = sessionsInRange(range.from, range.to);
		const seconds = selected.seconds;
		const previousSeconds = selected.previousSeconds;
		const deltaPct = previousSeconds ? Math.round((seconds - previousSeconds) / previousSeconds * 100) : null;
		const deltaText = deltaPct === null ? "Noch kein Vergleich" : (deltaPct >= 0 ? "+" : "") + deltaPct + " % zum vorherigen Zeitraum";
		const reviews = selected.reviews;
		const previousReviews = selected.previousReviews;
		const reviewRate = reviews.passRate === null ? null : Math.round(reviews.passRate * 100);
		const previousRate = previousReviews.passRate === null ? null : Math.round(previousReviews.passRate * 100);
		const reviewDelta = reviewRate === null || previousRate === null ? "Noch kein Vergleich" : (reviewRate - previousRate >= 0 ? "+" : "") + (reviewRate - previousRate) + " Punkte zum vorherigen Zeitraum";
		const subjects = groupedSubjects(range.from, range.to);
		const maxSubject = Math.max(1, ...subjects.map((item) => item.seconds));
		const subjectRows = subjects.slice(0, 12).map((item, index) => '<div class="lz-subject-row"><span class="lz-subject-rank">' + (index + 1) + '</span><div><b>' + U.esc(item.subject) + '</b><small>' + item.sessions + ' Einheit' + (item.sessions === 1 ? '' : 'en') + '</small></div><div class="lz-subject-track"><i style="width:' + Math.max(4, Math.round(item.seconds / maxSubject * 100)) + '%"></i></div><strong>' + fmt(item.seconds) + '</strong></div>').join("") || '<p class="hint lz-empty">Noch kein Fach in diesem Zeitraum erfasst.</p>';
		const chart = mode === "month" ? monthCalendar(selected.days, reviews) : selected.days.map(({ d, seconds: daySeconds }) => {
			const dayReviews = reviews.byDay[dayKey(d)] || 0, height = daySeconds ? Math.max(6, Math.round(daySeconds / Math.max(1, ...selected.days.map((x) => x.seconds)) * 100)) : 2;
			return '<div class="lz-bar-col' + (dayKey(d) === dayKey() ? ' today' : '') + (daySeconds ? '' : ' empty') + '" title="' + fmt(daySeconds) + ' · ' + dayReviews + ' Reviews"><span>' + (daySeconds ? fmt(daySeconds) : '—') + '</span><i style="height:' + height + '%"></i><small>' + d.toLocaleDateString('de-DE', { weekday: 'short' }) + '<b>' + d.getDate() + '</b></small><em>' + (dayReviews ? dayReviews + ' Karten' : '&nbsp;') + '</em></div>';
		}).join("");
		const periodTitle = rangeTitle(range.from, range.to, mode);
		const relative = mode === "month" ? (monthOffset === 0 ? "Dieser Monat" : monthOffset === -1 ? "Letzter Monat" : 'Vor ' + Math.abs(monthOffset) + ' Monaten') : (weekOffset === 0 ? "Diese Woche" : weekOffset === -1 ? "Letzte Woche" : 'Vor ' + Math.abs(weekOffset) + ' Wochen');
		const activeDays = selected.activeDays;
		const goalPct = mode === "month" ? Math.round(seconds / 60 / (weekGoalMinutes() * 4.345) * 100) : selected.goalPct;
		const recommendations = [];
		if (!seconds && !reviews.reviews) recommendations.push(["🌱", "Noch keine Lernzeit", "Starte einen Fokusblock oder füge eine Einheit hinzu. Der Zeitraum bleibt vollständig nachvollziehbar."]);
		else {
			if (deltaPct !== null) recommendations.push([deltaPct >= 0 ? "📈" : "↘", deltaPct >= 10 ? "Mehr Lernzeit" : deltaPct <= -20 ? "Weniger Lernzeit" : "Stabiler Umfang", deltaText + "."]);
			if (mode === "week") recommendations.push([activeDays >= 4 ? "✅" : "🗓", activeDays + ' aktive' + (activeDays === 1 ? 'r' : '') + ' Lerntag' + (activeDays === 1 ? '' : 'e'), activeDays >= 4 ? 'Gute Verteilung über die Woche.' : 'Kürzere Einheiten an mehreren Tagen helfen beim Behalten.']);
			else if (subjects.length > 1) recommendations.push(["🔀", subjects.length + " Fächer im Monat", "Deine Lernzeit verteilt sich auf mehrere Lernkontexte."]);
			if (reviewRate !== null) recommendations.push([reviewRate >= 85 ? "🎯" : "🧠", reviewRate + " % Erfolgsquote", reviewRate >= 85 ? "Die Karten sitzen. Behalte diesen Rhythmus bei." : "Schwierige Karten in kleinere, klarere Schritte zerlegen."]);
		}
		const recHtml = recommendations.slice(0, 3).map(([icon, title, sub]) => '<div class="lz-recommendation"><span>' + icon + '</span><div><b>' + title + '</b><small>' + sub + '</small></div></div>').join("");
		const log = sessions.slice(0, 12).map((session) => {
			const meta = CATEGORIES[session.category] || CATEGORIES.other;
			return '<div class="lz-log-row"><span>' + meta.icon + ' <b>' + U.esc(sessionSubject(session)) + '</b><small>' + meta.label + ' · ' + new Date(session.startedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' · ' + fmt(session.durationSeconds) + '</small></span><span><button class="mini" data-lz-edit="' + session.id + '">Bearbeiten</button><button class="mini danger" data-lz-delete="' + session.id + '">🗑</button></span></div>';
		}).join("") || '<p class="hint lz-empty">Keine abgeschlossene Einheit in diesem Zeitraum.</p>';
		const isCurrent = mode === "month" ? monthOffset === 0 : weekOffset === 0;
		const navLabel = mode === "month" ? "Monate" : "Wochen";
		return '<section class="lz-widget" id="lzWidget"><header class="lz-dashboard-head"><div><span class="lz-eyebrow">Lernanalyse</span><h2>' + relative + '</h2><p>' + periodTitle + '</p></div>' +
			'<div class="lz-dashboard-actions"><div class="lz-view-switch" role="tablist" aria-label="Analysezeitraum"><button data-lz-mode="week" role="tab" aria-selected="' + (mode === 'week') + '" class="' + (mode === 'week' ? 'active' : '') + '">Woche</button><button data-lz-mode="month" role="tab" aria-selected="' + (mode === 'month') + '" class="' + (mode === 'month' ? 'active' : '') + '">Monat</button></div><div class="lz-week-nav"><button data-lz-period="-1" aria-label="Vorherige ' + navLabel + '">←</button><button data-lz-todayperiod="1"' + (isCurrent ? ' disabled' : '') + '>Heute</button><button data-lz-period="1" aria-label="Nächste ' + navLabel + '"' + (isCurrent ? ' disabled' : '') + '>→</button></div></div></header>' +
			'<div class="lz-summary"><div class="lz-summary-main"><small>Gesamte Lernzeit</small><b>' + fmt(seconds) + '</b><span class="' + (deltaPct !== null && deltaPct < 0 ? 'down' : '') + '">' + deltaText + '</span><div class="lz-goal"><span>🎯 ' + Math.min(100, goalPct) + ' % vom ' + (mode === 'week' ? 'Wochenziel' : 'Monatsziel') + '</span><button class="mini" data-lz-goal="1">Ziel ändern</button></div><div class="lz-progress lz-goal-bar"><i style="width:' + Math.min(100, goalPct) + '%"></i></div></div>' +
			'<div class="lz-kpi-grid"><div><small>Aktive Tage</small><b>' + activeDays + '<em>' + (mode === 'week' ? '/7' : '/' + selected.days.length) + '</em></b><span>mindestens 5 Minuten</span></div><div><small>Fächer</small><b>' + subjects.length + '</b><span>' + (subjects[0] ? U.esc(subjects[0].subject) + ' am stärksten' : 'Noch ohne Zuordnung') + '</span></div><div><small>Reviews</small><b>' + reviews.reviews + '</b><span>' + (reviewRate === null ? 'Noch keine Quote' : reviewRate + ' % richtig') + '</span></div><div><small>Streak</small><b>🔥 ' + homeStats.streakDays + '</b><span>' + (homeStats.streakDays === 1 ? 'Tag in Folge' : 'Tage in Folge') + '</span></div></div></div>' +
			timerCardHtml() +
			'<div class="lz-panel lz-week-chart"><div class="lz-panel-head"><div><b>' + (mode === 'week' ? 'Lernrhythmus der Woche' : 'Lernkalender des Monats') + '</b><small>' + (mode === 'week' ? 'Lernzeit und Karten pro Tag' : 'Jeder Tag zeigt Intensität und Reviews') + '</small></div><span>' + sessions.length + ' Einheit' + (sessions.length === 1 ? '' : 'en') + '</span></div><div class="' + (mode === 'month' ? 'lz-month-wrap' : 'lz-bars') + '">' + chart + '</div></div>' +
			'<div class="lz-analysis-grid"><div class="lz-panel lz-subjects"><div class="lz-panel-head"><div><b>Fächer & Lernkontexte</b><small>Automatisch aus Stapeln, Seiten und Workspaces</small></div><span>' + subjects.length + ' erkannt</span></div>' + subjectRows + '</div>' +
			'<div class="lz-panel"><div class="lz-panel-head"><div><b>Kartenqualität</b><small>Leistung im gewählten Zeitraum</small></div></div><div class="lz-review-summary"><div><b>' + (reviewRate === null ? '—' : reviewRate + ' %') + '</b><small>Erfolgsquote</small></div><div><b>' + (reviews.medianThinkMs === null ? '—' : (reviews.medianThinkMs / 1000).toFixed(1) + ' s') + '</b><small>mittlere Denkzeit</small></div><div><b>' + reviews.focusLosses + '</b><small>Unterbrechungen</small></div></div><p>' + reviewDelta + (reviews.timerReviews ? ' · ' + reviews.timerReviews + ' Reviews mit Lerntimer' : '') + '</p></div></div>' +
			'<div class="lz-panel lz-insights"><div class="lz-panel-head"><div><b>Deine nächsten Schritte</b><small>Aus Lernzeit, Fächern und Lernerfolg gemeinsam abgeleitet</small></div></div><div class="lz-recommendations">' + recHtml + '</div>' + fold("patterns", "🧠 Langzeitmuster aus allen Lerndaten", TELE.homeInsightsHtml(), false) + '</div>' +
			fold("log", "📝 Einheiten in diesem Zeitraum", '<div class="lz-log-head"><b>' + sessions.length + ' Einheit' + (sessions.length === 1 ? '' : 'en') + '</b><button class="mini" data-lz-add="1">+ Zeit hinzufügen</button></div><div class="lz-log">' + log + '</div>', false) + '</section>';
	}

	function refreshLive() {
		const total = document.querySelector("[data-lz-today]");
		if (total) total.textContent = fmt(totalForDay(dayKey()));
		const label = document.querySelector("[data-lz-timer-label]");
		if (label && timerEndsAt) label.textContent = "Noch " + Math.max(1, Math.ceil((timerEndsAt - Date.now()) / 60000)) + " min";
		const bar = document.querySelector("[data-lz-timer-bar]");
		if (bar && timerEndsAt) {
			const totalMs = timerTotalMin() * 60000;
			bar.style.width = Math.min(100, Math.max(0, Math.round((1 - (timerEndsAt - Date.now()) / totalMs) * 100))) + "%";
		}
	}
	function renderHomeWidget() {
		const old = document.getElementById("lzWidget");
		if (old) old.outerHTML = homeWidgetHtml();
	}
	async function saveManual(id, minutes, category, date, subject) {
		const old = id && S.learningSessions[id];
		const durationSeconds = Math.max(60, Math.round(Number(minutes) * 60));
		// Manuelle Korrekturen können bewusst einem beliebigen Kalendertag
		// zugeordnet werden. Mittagszeit verhindert Zeitzonen-Sprünge am Tagesrand.
		const startedAt = new Date((date || dayKey(old && old.startedAt)) + "T12:00:00").toISOString();
		const endedAt = new Date(new Date(startedAt).getTime() + durationSeconds * 1000).toISOString();
		await STATE.dispatch("learningSessionUpsert", {
			id: id || U.uid(), startedAt, endedAt, durationSeconds,
			category: CATEGORIES[category] ? category : "other",
			subject: cleanSubject(subject || (old && old.subject) || (old && sessionSubject(old)) || subjectNow()) || "Allgemein",
			sourceId: old ? old.sourceId : null, updated: iso(),
		});
	}
	function editModal(id) {
		const old = id ? S.learningSessions[id] : null;
		const overlay = document.getElementById("overlay");
		if (!overlay) return;
		const options = Object.entries(CATEGORIES).map(([key, value]) => '<option value="' + key + '"' + ((old ? old.category : "other") === key ? " selected" : "") + '>' + value.icon + ' ' + value.label + '</option>').join("");
		const subject = old ? sessionSubject(old) : subjectNow();
		overlay.hidden = false;
		overlay.innerHTML = '<div class="modal lz-edit-modal"><button class="modal-x" data-lz-close="1">✕</button><h3>' + (old ? 'Lerneinheit bearbeiten' : 'Zeit hinzufügen') + '</h3><label>Tag<input id="lzEditDay" type="date" value="' + dayKey(old && old.startedAt) + '"></label><label>Minuten<input id="lzEditMinutes" type="number" min="1" max="1440" value="' + (old ? Math.round(old.durationSeconds / 60) : 25) + '"></label><label>Fach<input id="lzEditSubject" maxlength="80" value="' + U.esc(subject) + '" placeholder="z. B. Mathematik"></label><label>Aktivität<select id="lzEditCategory">' + options + '</select></label><div class="modal-actions"><button data-lz-close="1">Abbrechen</button><button class="primary" data-lz-save="' + (id || '') + '">Speichern</button></div></div>';
	}

	["pointerdown", "pointermove", "keydown", "wheel", "touchstart"].forEach((type) => window.addEventListener(type, () => { if (!animal) lastActivityAt = Date.now(); }, { passive: true }));
	document.addEventListener("visibilitychange", () => { if (document.hidden) closeSegment(); else lastActivityAt = Date.now(); });
	window.addEventListener("pagehide", () => { closeSegment(); });
	document.addEventListener("click", async (event) => {
		const source = event && event.target;
		const target = source && source.nodeType === 1 && source.closest ? source.closest("[data-lz-start],[data-lz-custom],[data-lz-stop],[data-lz-pause],[data-lz-resume],[data-lz-goal],[data-lz-add],[data-lz-edit],[data-lz-delete],[data-lz-save],[data-lz-close],[data-lz-mode],[data-lz-period],[data-lz-todayperiod]") : null;
		if (!target) return;
		if (target.dataset.lzStart) startTimer(target.dataset.lzStart);
		else if (target.dataset.lzCustom) startTimer((document.getElementById("lzCustomMinutes") || {}).value);
		else if (target.dataset.lzPause) pauseTimer();
		else if (target.dataset.lzResume) resumeTimer();
		else if (target.dataset.lzGoal) cycleGoal();
		else if (target.dataset.lzMode) { analysisMode = target.dataset.lzMode === "month" ? "month" : "week"; renderHomeWidget(); }
		else if (target.dataset.lzPeriod) { const delta = Number(target.dataset.lzPeriod) || 0; if (analysisMode === "month") monthOffset = Math.min(0, monthOffset + delta); else weekOffset = Math.min(0, weekOffset + delta); renderHomeWidget(); }
		else if (target.dataset.lzTodayperiod) { if (analysisMode === "month") monthOffset = 0; else weekOffset = 0; renderHomeWidget(); }
		else if (target.dataset.lzStop) { await stopTimer(); }
		else if (target.dataset.lzAdd !== undefined) editModal(null);
		else if (target.dataset.lzEdit) editModal(target.dataset.lzEdit);
		else if (target.dataset.lzDelete) { await STATE.dispatch("learningSessionDelete", { id: target.dataset.lzDelete, updated: iso() }); renderHomeWidget(); }
		else if (target.dataset.lzSave !== undefined) { await saveManual(target.dataset.lzSave || null, (document.getElementById("lzEditMinutes") || {}).value, (document.getElementById("lzEditCategory") || {}).value, (document.getElementById("lzEditDay") || {}).value, (document.getElementById("lzEditSubject") || {}).value); const o = document.getElementById("overlay"); if (o) { o.hidden = true; o.innerHTML = ""; } renderHomeWidget(); }
		else if (target.dataset.lzClose !== undefined) { const o = document.getElementById("overlay"); if (o) { o.hidden = true; o.innerHTML = ""; } }
	});

	// 🩹 FIX (19. Juli): Alle .lz-*-Styles (Widget, Timer, Folds, #lzAnimal)
	// leben jetzt fest in styles.css. Das früher hier zur Laufzeit injizierte
	// <style id="lernzeitStyles"> war auf manchen Geräten nicht (mehr) aktiv —
	// das Home-Widget erschien dann komplett ungestylt.

	let tickTimer = 0;
	function startInterval() {
		if (tickTimer) return;
		tickTimer = setInterval(tick, TICK_MS);
	}
	function stopInterval() {
		if (tickTimer) {
			clearInterval(tickTimer);
			tickTimer = 0;
		}
	}

	return { homeWidgetHtml, activeSessions, totalForDay, fmt, startTimer, statsForHome, poke, startInterval, stopInterval };
})();
