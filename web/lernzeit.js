"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { TELE } from "./telemetrie.js";
import { FACH } from "./fach.js";
import { idlePromptContextKind } from "./lernzeit-context.js";
import { TIER_SVG, TIER_SCHLAF_SVG } from "./lernzeit-tier.js";
import { icon, lead } from "./icons.js";
import { CORE } from "./rust-core.js";

// lernzeit.js — automatische Lernzeit-Erfassung: Segmente je Kontext (Karten, Heft, Notiz,
// KI), Idle-Tierchen, Pausen-Erinnerung und Tagessummen für die Startseite (render.js,
// lernanalyse.js). Das frühere eigene Startseiten-Widget ist entfallen.

export const LERNZEIT = (() => {
	const IDLE_MS = 60000;
	const NOTES_IDLE_MS = 3 * 60000; // Notizen liest man oft länger ohne Eingabe
	const SESSION_GAP_MS = 15 * 60000;
	const TICK_MS = 5000;
	const TIMER_KEY = "impala67_lernzeit_timer_end";
	const TIMER_MIN_KEY = "impala67_lernzeit_timer_minutes";
	const TIMER_PAUSE_KEY = "impala67_lernzeit_timer_paused_left"; // Altlast: nur noch aufräumen
	const GOAL_KEY = "impala67WeekGoalMinutes";

	let lastActivityAt = Date.now();
	let tracker = new CORE.LzSessionTracker();
	let idle = false; // Leerlauf-Pause: endet mit der nächsten Eingabe
	let animal = null; // dezentes Tier am Rand, solange idle (nicht in Notizen)
	let timerEndsAt = Number(localStorage.getItem(TIMER_KEY) || 0);

	let activeStretchMs = 0;
	let lastActiveTickAt = 0;
	let reminderShownForBlock = false;

	function isBreakReminderEnabled() {
		try {
			// Wie `getBreakReminder` in settings.js: standardmäßig aus, gespeichert als „on“/„off“.
			const v = localStorage.getItem("impala67BreakReminder");
			return v === "on" || v === "true" || v === "1";
		} catch {
			return false;
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

	async function openSegment(meta = categoryNow()) {
		if (!meta || away() || idle) return;
		const toPersist = tracker.openSegment(
			Date.now(),
			iso(),
			meta.category,
			meta.sourceId || undefined,
			meta.subject || undefined,
			meta.subjectSource || undefined,
			U.uid
		);
		if (toPersist) await STATE.dispatch("learningSessionUpsert", toPersist);
	}
	// Lernzeit zählt nur, solange das Fenster sichtbar UND im Vordergrund ist (eine nebenbei
	// offene Notiz hinter einem anderen Fenster ist kein Lernen). hasFocus() gilt auch für iframes.
	function away() {
		return document.hidden || (typeof document.hasFocus === "function" && !document.hasFocus());
	}
	// atMs: Ende des Abschnitts — beim Leerlauf rückwirkend die letzte Eingabe.
	async function pauseSegment(atMs = Date.now()) {
		const toPersist = tracker.pauseSegment(atMs, new Date(atMs).toISOString());
		if (toPersist) await STATE.dispatch("learningSessionUpsert", toPersist);
	}
	async function finishSession() {
		const toPersist = tracker.finishSession(Date.now(), iso());
		if (toPersist) await STATE.dispatch("learningSessionUpsert", toPersist);
	}
	async function maybeSplitSegment(meta = categoryNow()) {
		if (!meta || !tracker.hasCurrent) return;
		const toPersist = tracker.maybeSplitSegment(
			Date.now(),
			iso(),
			meta.category,
			meta.sourceId || undefined,
			meta.subject || undefined,
			meta.subjectSource || undefined,
			U.uid
		);
		if (toPersist) await STATE.dispatch("learningSessionUpsert", toPersist);
	}

	// Aktivität melden — EINE Stelle für alle Eingabewege (Maus, Stift, Tastatur und das
	// 🎮 Gamepad aus controller.js, das keine pointer-/keydown-Ereignisse erzeugt). Jede
	// Eingabe beendet eine Leerlauf-Pause: Tier weg, Lernzeit läuft weiter, die Eingabe
	// selbst wirkt ganz normal.
	function poke() {
		lastActivityAt = Date.now();
		if (!idle) return;
		idle = false;
		hideAnimal();
		openSegment(categoryNow());
	}

	function hideAnimal() {
		if (!animal) return;
		animal.closest("#btnAiFab")?.classList.remove("lz-idle");
		animal.remove();
		animal = null;
	}
	// Dezent statt Kasten: ein kleines Impala, bei jeder Pause in einer anderen Pose (abwechselnd).
	// Es fängt keine Eingaben ab und weicht dem KI-Knopf unten rechts aus; die Plakette („badge“)
	// zieht bei sichtbarem KI-Knopf direkt in den Knopf ein.
	const POSES = ["peek", "sleep", "side", "badge"];
	let poseIdx = Math.floor(Math.random() * POSES.length);
	function showAnimal() {
		if (animal || !idlePromptContextKind(S, settingsAreOpen())) return;
		const pose = POSES[poseIdx++ % POSES.length];
		const fab = document.getElementById("btnAiFab");
		const fabShown = !!fab && getComputedStyle(fab).display !== "none";
		const pause = '<span class="lz-tier-pause">' + icon("pause") + "</span>";
		const art = '<span class="lz-tier-art">' + (pose === "sleep" ? TIER_SCHLAF_SVG : TIER_SVG) + "</span>";
		animal = document.createElement("span");
		animal.setAttribute("role", "status");
		animal.setAttribute("aria-label", "Lernzeit pausiert – jede Eingabe setzt sie fort");
		if (pose === "badge" && fabShown) {
			animal.className = "lz-tier lz-tier--infab";
			animal.innerHTML = art + pause;
			fab.classList.add("lz-idle");
			fab.appendChild(animal);
			return;
		}
		animal.id = "lzAnimal";
		animal.className = "lz-tier lz-tier--" + pose + (fabShown ? " lz-tier--fab" : "");
		animal.innerHTML = art + (pose === "badge" ? pause : "") + (pose === "sleep" ? '<i class="lz-z">z</i><i class="lz-z">z</i>' : "");
		document.body.appendChild(animal);
	}

	function showBreakReminderPrompt() {
		const overlay = U.takeOverlay();
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
		const overlay = U.takeOverlay();
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
		poke();
		openSegment(categoryNow());
		TELE.log("timerStart", { minutes: min });
	}

	function tick() {
		const meta = categoryNow();
		if (away()) {
			// Hintergrund oder anderes Fenster vorn: nichts zählen; zurück im Fenster beginnt
			// die Leerlauf-Frist neu.
			lastActiveTickAt = 0;
			lastActivityAt = Date.now();
			idle = false;
			hideAnimal();
			if (tracker.isActive) pauseSegment();
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
			idle = false;
			hideAnimal();
			if (tracker.isActive) pauseSegment();
			else if (tracker.hasCurrent && Date.now() - tracker.pausedAtMs > SESSION_GAP_MS) {
				finishSession();
				activeStretchMs = 0;
				reminderShownForBlock = false;
			}
			return;
		}
		// Beim Wechsel aus Heft/Chat/Kartenlernen darf ein bereits sichtbares Tier
		// nicht in eine normale Notiz oder Verwaltungsansicht mitwandern.
		if (animal && !idlePromptContextKind(S, settingsAreOpen())) hideAnimal();
		if (idle) {
			lastActiveTickAt = 0;
			return;
		}
		const idleLimit = meta.category === "notes" ? NOTES_IDLE_MS : IDLE_MS;
		if (Date.now() - lastActivityAt >= idleLimit) {
			// Rückwirkend ab der letzten Eingabe pausieren: Leerlauf zählt nie als Lernzeit.
			lastActiveTickAt = 0;
			idle = true;
			pauseSegment(lastActivityAt);
			showAnimal();
			return;
		}
		if (tracker.hasCurrent) maybeSplitSegment(meta);
		else openSegment(meta);

		// Pausen-Erinnerung: Aktive, ununterbrochene Lernzeit tracken (40 min)
		if (tracker.isActive) {
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
		return Number(CORE.lzMergedSeconds(sessions || []));
	}
	function currentAsSession() {
		return tracker.currentAsSession(iso());
	}
	function totalsByDay() {
		const sessions = activeSessions();
		const live = currentAsSession();
		return CORE.lzTotalsByDay(sessions, live);
	}
	function totalForDay(key) {
		const totals = totalsByDay();
		return totals[key] || 0;
	}
	function weekStart(offset = 0) {
		const d = new Date();
		d.setHours(0, 0, 0, 0);
		d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
		return d;
	}
	function weekData(offset = 0, totals = null) {
		const t = totals || totalsByDay();
		const raw = CORE.lzWeekData(t, Date.now(), offset);
		const start = weekStart(offset);
		return raw.map((seconds, index) => {
			const d = new Date(start); d.setDate(d.getDate() + index);
			return { d, seconds };
		});
	}
	function streakDays(totals = null) {
		const t = totals || totalsByDay();
		return CORE.lzStreakDays(t, Date.now());
	}
	function weekGoalMinutes() {
		return CORE.lzNormalizeWeekGoal(Number(localStorage.getItem(GOAL_KEY)) || 0);
	}
	function cycleGoal() {
		const next = CORE.lzCycleWeekGoal(weekGoalMinutes());
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


	["pointerdown", "pointermove", "keydown", "wheel", "touchstart"].forEach((type) => window.addEventListener(type, poke, { passive: true }));
	window.addEventListener("focus", () => { lastActivityAt = Date.now(); });
	// Das Settings-Overlay ändert S.view nicht. Auf seine DOM-Änderung reagieren wir
	// deshalb sofort, statt erst bis zum nächsten Fünf-Sekunden-Tick zu warten.
	const overlay = document.getElementById("overlay");
	if (overlay && typeof MutationObserver !== "undefined") {
		new MutationObserver(() => tick()).observe(overlay, { childList: true, attributes: true, attributeFilter: ["hidden"] });
	}
	document.addEventListener("visibilitychange", () => {
		if (document.hidden) {
			idle = false;
			hideAnimal();
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
		mergedSeconds,
		totalForDay,
		totalsByDay,
		weekData,
		streakDays,
		weekGoalMinutes,
		cycleGoal,
		statsForHome,
		openSegment,
		pauseSegment,
		finishSession,
		maybeSplitSegment,
		currentAsSession,
		poke,
		contextChanged,
		startInterval,
	};
})();
