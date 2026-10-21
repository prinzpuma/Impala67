"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { TELE } from "./telemetrie.js";
import { FACH } from "./fach.js";
import { idlePromptContextKind } from "./lernzeit-context.js";
import { icon, lead } from "./icons.js";

// lernzeit.js — automatische Lernzeit-Erfassung: Segmente je Kontext (Karten, Heft, Notiz,
// KI), Idle-Tierchen, Pausen-Erinnerung und Tagessummen für die Startseite (render.js,
// lernanalyse.js). Das frühere eigene Startseiten-Widget ist entfallen.

export const LERNZEIT = (() => {
	const IDLE_MS = 60000;
	const SESSION_GAP_MS = 15 * 60000;
	const TICK_MS = 5000;
	const TIMER_KEY = "impala67_lernzeit_timer_end";
	const TIMER_MIN_KEY = "impala67_lernzeit_timer_minutes";
	const TIMER_PAUSE_KEY = "impala67_lernzeit_timer_paused_left"; // Altlast: nur noch aufräumen
	const GOAL_KEY = "impala67WeekGoalMinutes";

	let lastActivityAt = Date.now();
	let current = null;
	let animal = null;
	let timerEndsAt = Number(localStorage.getItem(TIMER_KEY) || 0);

	let activeStretchMs = 0;
	let lastActiveTickAt = 0;
	let reminderShownForBlock = false;

	function isBreakReminderEnabled() {
		try {
			return localStorage.getItem("impala67BreakReminder") !== "0";
		} catch {
			return true;
		}
	}

	function iso() { return new Date().toISOString(); }
	function dayKey(value) {
		const d = new Date(value || Date.now());
		return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
	}
	function activeSessions() {
		return Object.values(S.learningSessions || {}).filter((item) => item && !item.deleted && item.durationSeconds > 0);
	}
	function subjectNowMeta() {
		const page = S.currentPageId && S.pages[S.currentPageId];
		if (S.view === "anki" && S.ankiTab === "study") {
			return FACH.context({ deck: S.ankiDeck, pageId: page?.id });
		}
		if (page) return FACH.page(page);
		if (S.aiBusy) return { name: "KI / Allgemein", source: "ai" };
		return { name: FACH.DEFAULT_SUBJECT, source: "fallback" };
	}
	function settingsAreOpen() {
		const overlay = document.getElementById("overlay");
		return !!(overlay && !overlay.hidden && overlay.querySelector(".settings-modal-v2"));
	}
	function categoryNow() {
		const subject = subjectNowMeta();
		// Einstellungen über einer Lernansicht dürfen weder Lernzeit sammeln noch
		// die Idle-Frage zeigen; S.view selbst bleibt beim Öffnen unverändert.
		if (settingsAreOpen()) return null;
		if (S.view === "chat") return { category: "ai", sourceId: S.currentChatId || null, subject: subject.name, subjectSource: subject.source };
		if (S.view === "anki" && S.ankiTab === "study") return { category: "cards", sourceId: S.ankiDeck || null, subject: subject.name, subjectSource: subject.source };
		const page = S.currentPageId && S.pages[S.currentPageId];
		if (page && page.kind === "heft" && S.view === "page") return { category: "notebook", sourceId: page.id, subject: subject.name, subjectSource: subject.source };
		if (page && S.view === "page") return { category: "notes", sourceId: page.id, subject: subject.name, subjectSource: subject.source };
		return null;
	}

	function sameContext(meta, session = current) {
		return !!(meta && session && meta.category === session.category && meta.sourceId === session.sourceId && meta.subject === session.subject);
	}
	function segmentsDuration(segments) {
		return Math.round((segments || []).reduce((total, segment) => {
			const start = new Date(segment.startedAt).getTime();
			const end = new Date(segment.endedAt).getTime();
			return total + (Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0);
		}, 0) / 1000);
	}
	function openSegment(meta = categoryNow()) {
		if (!meta || document.hidden || animal) return;
		const now = Date.now();
		if (current?.activeStartedMs && sameContext(meta)) return;
		if (current && !current.activeStartedMs && sameContext(meta) && now - current.pausedAt <= SESSION_GAP_MS) {
			current.activeStartedMs = now;
			current.activeStartedAt = iso();
			current.pausedAt = 0;
			return;
		}
		if (current) finishSession();
		current = { id: U.uid(), startedAt: iso(), activeStartedAt: iso(), activeStartedMs: now, pausedAt: 0, segments: [], category: meta.category, sourceId: meta.sourceId, subject: meta.subject, subjectSource: meta.subjectSource };
	}
	async function persistCurrent() {
		if (!current || !current.segments.length) return;
		const durationSeconds = segmentsDuration(current.segments);
		if (durationSeconds < 1) return;
		const endedAt = current.segments[current.segments.length - 1].endedAt;
		await STATE.dispatch("learningSessionUpsert", {
			id: current.id,
			startedAt: current.startedAt,
			endedAt,
			durationSeconds,
			segments: current.segments,
			category: current.category,
			sourceId: current.sourceId,
			subject: current.subject,
			subjectSource: current.subjectSource,
			updated: iso(),
		});
	}
	function pauseSegment() {
		if (!current || !current.activeStartedMs) return Promise.resolve();
		const endedAt = iso();
		current.segments.push({ startedAt: current.activeStartedAt, endedAt });
		current.activeStartedAt = null;
		current.activeStartedMs = 0;
		current.pausedAt = Date.now();
		return persistCurrent();
	}
	function finishSession() {
		if (!current) return Promise.resolve();
		const finished = current;
		const pending = pauseSegment();
		if (current === finished) current = null;
		return pending;
	}
	function maybeSplitSegment(meta = categoryNow()) {
		if (!current) return;
		if (sameContext(meta)) return;
		finishSession().then(() => openSegment(meta));
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
		openSegment(categoryNow());
		return true;
	}

	function showAnimal() {
		if (animal || !categoryNow() || !idlePromptContextKind(S, settingsAreOpen())) return;
		pauseSegment();
		animal = document.createElement("button");
		animal.type = "button";
		animal.id = "lzAnimal";
		animal.innerHTML = '<span>' + icon("hand") + '</span><b>Lernst du noch?</b><small>Berühre mich oder fahre darüber, um die Lernzeit fortzusetzen.</small>';
		const resume = () => poke();
		animal.addEventListener("pointerenter", resume, { once: true });
		animal.addEventListener("click", resume, { once: true });
		document.body.appendChild(animal);
	}

	function showBreakReminderPrompt() {
		const overlay = document.getElementById("overlay");
		if (!overlay) return;
		overlay.hidden = false;
		overlay.innerHTML = '<div class="modal lz-break-modal"><h3>' + lead("coffee") + 'Zeit für eine kurze Pause?</h3>' +
			'<p>Du lernst schon <b>40 Minuten</b> am Stück. Eine 5-minütige Pause hilft deinem Gehirn, das Gelernte zu festigen.</p>' +
			'<div class="modal-actions">' +
			'<button class="primary" data-lz-break="5">5 Min Pause</button>' +
			'<button data-lz-break="dismiss">Weiterlernen</button>' +
			'</div></div>';
	}

	function openTimerDone(minutes) {
		const overlay = document.getElementById("overlay");
		if (!overlay) { U.toast("Lernblock geschafft — " + minutes + " Minuten.", "success"); return; }
		overlay.hidden = false;
		overlay.innerHTML = '<div class="modal lz-done"><h3>' + lead("party") + 'Lernblock geschafft</h3><p><b>' + minutes + ' Minuten</b> fokussiert gelernt. Gute Arbeit!</p><div class="modal-actions"><button data-lz-start="5">5 Min weiter</button><button data-lz-close="1">Pause machen</button></div></div>';
	}

	// ---------- Timer (v3: mit Pause/Fortsetzen + Fortschritt) ----------
	function timerTotalMin() { return Math.max(1, Math.round(Number(localStorage.getItem(TIMER_MIN_KEY)) || 25)); }
	function startTimer(minutes) {
		const min = Math.max(5, Math.min(240, Number(minutes) || 25));
		timerEndsAt = Date.now() + min * 60000;
		localStorage.setItem(TIMER_KEY, String(timerEndsAt));
		localStorage.setItem(TIMER_MIN_KEY, String(min));
		localStorage.removeItem(TIMER_PAUSE_KEY);
		lastActivityAt = Date.now();
		openSegment(categoryNow());
		TELE.log("timerStart", { minutes: min });
	}

	function tick() {
		const meta = categoryNow();
		if (document.hidden) {
			lastActiveTickAt = 0;
			return;
		}
		if (timerEndsAt && Date.now() >= timerEndsAt) {
			const minutes = timerTotalMin();
			timerEndsAt = 0;
			localStorage.removeItem(TIMER_KEY);
			localStorage.removeItem(TIMER_PAUSE_KEY);
			TELE.log("timerDone", { minutes });
			pauseSegment();
			openTimerDone(minutes);
		}
		if (!meta) {
			lastActiveTickAt = 0;
			if (animal) { animal.remove(); animal = null; }
			if (current?.activeStartedMs) pauseSegment();
			else if (current && Date.now() - current.pausedAt > SESSION_GAP_MS) {
				finishSession();
				activeStretchMs = 0;
				reminderShownForBlock = false;
			}
			return;
		}
		// Beim Wechsel aus Heft/Chat/Kartenlernen darf ein bereits sichtbares Tier
		// nicht in eine normale Notiz oder Verwaltungsansicht mitwandern.
		if (animal && !idlePromptContextKind(S, settingsAreOpen())) {
			animal.remove();
			animal = null;
			lastActivityAt = Date.now();
		}
		if (animal) {
			lastActiveTickAt = 0;
			return;
		}
		if (Date.now() - lastActivityAt >= IDLE_MS) {
			lastActiveTickAt = 0;
			showAnimal();
			return;
		}
		if (current && !sameContext(meta)) maybeSplitSegment(meta);
		else openSegment(meta);

		// Pausen-Erinnerung: Aktive, ununterbrochene Lernzeit tracken (40 min)
		if (current && current.activeStartedMs) {
			const now = Date.now();
			if (lastActiveTickAt) {
				const delta = Math.min(now - lastActiveTickAt, TICK_MS * 3);
				activeStretchMs += delta;
			}
			lastActiveTickAt = now;
			if (activeStretchMs >= 40 * 60000 && !reminderShownForBlock && isBreakReminderEnabled()) {
				reminderShownForBlock = true;
				showBreakReminderPrompt();
			}
		} else {
			lastActiveTickAt = 0;
		}
	}

	// ---------- Auswertung ----------
	// 🩹 FIX (18. Juli 2026): Zwei Geräte gleichzeitig → Zeit wurde DOPPELT gezählt.
	// Ursache: Jedes Gerät schreibt eigene Segmente ins Event-Log; nach dem
	// Drive-Sync liegen beide nebeneinander, und die Auswertung hat alle
	// durationSeconds stumpf addiert. Jetzt: Intervall-VEREINIGUNG — zeitlich
	// überlappende Segmente zählen nur einmal (Wanduhr-Zeit statt Summe).
	function mergedSeconds(sessions) {
		const intervals = sessions.flatMap((s) => {
			if (Array.isArray(s.segments) && s.segments.length) {
				return s.segments.map((segment) => [new Date(segment.startedAt).getTime(), new Date(segment.endedAt).getTime()]);
			}
			const start = new Date(s.startedAt).getTime();
			const end = s.endedAt ? new Date(s.endedAt).getTime() : start + (s.durationSeconds || 0) * 1000;
			return [[start, Math.max(start, end)]];
		}).filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end >= start).sort((a, b) => a[0] - b[0]);
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
		const segments = current.segments.slice();
		if (current.activeStartedMs) segments.push({ startedAt: current.activeStartedAt, endedAt: iso() });
		if (!segments.length) return null;
		return { id: current.id, startedAt: current.startedAt, endedAt: segments[segments.length - 1].endedAt, durationSeconds: segmentsDuration(segments), segments, category: current.category, subject: current.subject };
	}
	function addLiveSession(sessions) {
		const live = currentAsSession();
		if (!live) return sessions;
		return sessions.filter((session) => session.id !== live.id).concat(live);
	}
	function totalForDay(key) {
		const list = addLiveSession(activeSessions()).filter((s) => dayKey(s.startedAt) === key);
		return mergedSeconds(list);
	}
	// PERF: totalsByDay lief bei jedem Startseiten-Render mehrfach über ALLE Sitzungen
	// (Tausende, ~11 ms je Aufruf). state.js ersetzt eine Sitzung bei jeder Änderung durch
	// ein neues Objekt; ein Identitätsvergleich der Liste genügt deshalb als Cache-Schlüssel.
	let closedTotalsCache = { sessions: [], grouped: {}, totals: {} };
	function closedTotals() {
		const sessions = activeSessions(), cached = closedTotalsCache;
		if (sessions.length === cached.sessions.length && sessions.every((s, i) => s === cached.sessions[i])) return cached;
		const grouped = {}, totals = {};
		for (const session of sessions) (grouped[dayKey(session.startedAt)] ||= []).push(session);
		for (const [key, list] of Object.entries(grouped)) totals[key] = mergedSeconds(list);
		return (closedTotalsCache = { sessions, grouped, totals });
	}
	// Nur die Tage der laufenden Sitzung neu rechnen; ihre gespeicherte Vorversion fällt raus.
	function totalsByDay() {
		const { sessions, grouped, totals } = closedTotals();
		const result = { ...totals }, live = currentAsSession();
		if (!live) return result;
		const liveKey = dayKey(live.startedAt), days = new Set([liveKey]);
		for (const session of sessions) if (session.id === live.id) days.add(dayKey(session.startedAt));
		for (const key of days) {
			const list = (grouped[key] || []).filter((session) => session.id !== live.id);
			if (key === liveKey) list.push(live);
			if (list.length) result[key] = mergedSeconds(list);
			else delete result[key];
		}
		return result;
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
		if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("lz:goal-changed", { detail: { minutes: next } }));
		U.toast("Wochenziel: " + Math.round(next / 60 * 10) / 10 + " h", "success");
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


	["pointerdown", "pointermove", "keydown", "wheel", "touchstart"].forEach((type) => window.addEventListener(type, () => { if (!animal) lastActivityAt = Date.now(); }, { passive: true }));
	// Das Settings-Overlay ändert S.view nicht. Auf seine DOM-Änderung reagieren wir
	// deshalb sofort, statt erst bis zum nächsten Fünf-Sekunden-Tick zu warten.
	const overlay = document.getElementById("overlay");
	if (overlay && typeof MutationObserver !== "undefined") {
		new MutationObserver(() => tick()).observe(overlay, { childList: true, attributes: true, attributeFilter: ["hidden"] });
	}
	document.addEventListener("visibilitychange", () => {
		if (document.hidden) {
			if (animal) { animal.remove(); animal = null; }
			pauseSegment();
		} else {
			lastActivityAt = Date.now();
			openSegment(categoryNow());
		}
	});
	window.addEventListener("pagehide", () => { finishSession(); });
	document.addEventListener("click", (event) => {
		const source = event && event.target;
		const target = source && source.nodeType === 1 && source.closest ? source.closest("[data-lz-start],[data-lz-goal],[data-lz-close],[data-lz-break]") : null;
		if (!target) return;
		if (target.dataset.lzBreak) {
			const action = target.dataset.lzBreak;
			U.closeOverlay();
			if (action === "5") {
				pauseSegment();
				activeStretchMs = 0;
				reminderShownForBlock = false;
				lastActiveTickAt = 0;
				U.toast("5 Minuten Pause — Zeit zum Durchatmen!", "info");
			} else {
				reminderShownForBlock = true;
			}
		}
		else if (target.dataset.lzStart) {
			startTimer(target.dataset.lzStart);
			// Der Verlängern-Button sitzt im Abschluss-Overlay. Nach dem Neustart des
			// Timers darf dieses die App nicht weiter blockieren.
			if (target.closest("#overlay")) U.closeOverlay();
		}
		else if (target.dataset.lzGoal) cycleGoal();
		else if (target.dataset.lzClose !== undefined) U.closeOverlay();
	});

	let tickTimer = 0;
	function startInterval() {
		if (tickTimer) return;
		tickTimer = setInterval(tick, TICK_MS);
	}
	function contextChanged() {
		tick();
	}

	return {
		totalsByDay,
		weekData,
		weekGoalMinutes,
		statsForHome,
		poke,
		contextChanged,
		startInterval,
	};
})();
