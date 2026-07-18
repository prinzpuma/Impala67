"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { TELE } from "./telemetrie.js";

// lernzeit.js — Lernzeit v3 (15. Juli 2026)
// v3: Home-Widget komplett neu — ausklappbare Bereiche (Woche, Aktivität,
// Protokoll) mit gemerktem Zustand, prominente Timer-Karte mit Pause/Fortsetzen
// und Fortschrittsbalken, Wochenziel mit Zielbalken, Tages-Streak und
// Telemetrie-Anbindung (telemetrie.js). Die Erfassungs-Engine (automatische
// Segmente, Idle-Tier, Kategorie-Split) ist unverändert aus v2 übernommen.

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
	function categoryNow() {
		if (S.aiBusy) return { category: "ai", sourceId: S.currentChatId || null };
		if (S.view === "anki" && S.ankiTab === "study") return { category: "cards", sourceId: S.ankiDeck || null };
		const page = S.currentPageId && S.pages[S.currentPageId];
		if (page && page.kind === "heft" && S.view === "page") return { category: "notebook", sourceId: page.id };
		const active = document.activeElement;
		if (page && active && (active.id === "pageTitle" || active.isContentEditable || (active.closest && active.closest(".block-editor")))) {
			return { category: "notes", sourceId: page.id };
		}
		return { category: "other", sourceId: null };
	}

	function openSegment() {
		if (current) return;
		const meta = categoryNow();
		current = { id: U.uid(), startedAt: iso(), startedMs: Date.now(), category: meta.category, sourceId: meta.sourceId };
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
			updated: iso(),
		});
	}
	function maybeSplitSegment() {
		if (!current) return;
		const next = categoryNow();
		if (next.category === current.category && next.sourceId === current.sourceId) return;
		closeSegment().then(openSegment);
	}

	function showAnimal() {
		if (animal) return;
		closeSegment();
		animal = document.createElement("button");
		animal.type = "button";
		animal.id = "lzAnimal";
		animal.innerHTML = '<span>' + ANIMALS[Math.floor(Math.random() * ANIMALS.length)] + '</span><b>Lernst du noch?</b><small>Berühre mich oder fahre darüber, um die Lernzeit fortzusetzen.</small>';
		const resume = () => {
			animal.remove();
			animal = null;
			lastActivityAt = Date.now();
			refreshLive();
		};
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
		return { startedAt: current.startedAt, endedAt: iso(), durationSeconds: Math.max(0, Math.floor((Date.now() - current.startedMs) / 1000)), category: current.category };
	}
	function totalForDay(key) {
		const list = activeSessions().filter((s) => dayKey(s.startedAt) === key);
		const live = key === dayKey() ? currentAsSession() : null;
		if (live) list.push(live);
		return mergedSeconds(list);
	}
	function groupedToday() {
		const byCategory = {};
		const today = activeSessions().filter((s) => dayKey(s.startedAt) === dayKey());
		const live = currentAsSession();
		if (live) today.push(live);
		for (const session of today) (byCategory[session.category] = byCategory[session.category] || []).push(session);
		const result = { cards: 0, notebook: 0, notes: 0, ai: 0, other: 0 };
		for (const key of Object.keys(byCategory)) result[key] = mergedSeconds(byCategory[key]);
		return result;
	}
	function sessionsToday() {
		return activeSessions().filter((s) => dayKey(s.startedAt) === dayKey()).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
	}
	function weekData() {
		return Array.from({ length: 7 }, (_, index) => {
			const d = new Date(); d.setDate(d.getDate() - (6 - index));
			return { d, seconds: totalForDay(dayKey(d)) };
		});
	}
	// Streak: aufeinanderfolgende Tage mit ≥ 5 min Lernzeit. Ein noch „leerer“
	// heutiger Tag bricht die Serie nicht — sie zählt dann ab gestern.
	function streakDays() {
		const MIN = 5 * 60;
		let streak = 0;
		for (let i = 0; i < 365; i++) {
			const d = new Date(); d.setDate(d.getDate() - i);
			if (totalForDay(dayKey(d)) >= MIN) streak++;
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
	function statsForHome() {
		const goal = weekGoalMinutes();
		const week = weekData();
		const weekSeconds = week.reduce((sum, x) => sum + x.seconds, 0);
		return {
			todaySeconds: totalForDay(dayKey()),
			weekSeconds,
			weekDays: week,
			streakDays: streakDays(),
			weekGoalMinutes: goal,
			goalPct: Math.round(weekSeconds / 60 / goal * 100),
			categoriesToday: groupedToday(),
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
		const stats = statsForHome();
		const max = Math.max(1, ...stats.weekDays.map((x) => x.seconds));
		const bars = stats.weekDays.map(({ d, seconds }, index) =>
			'<div class="lz-bar-col' + (index === 6 ? ' today' : '') + '" title="' + fmt(seconds) + '"><i style="height:' + Math.max(5, Math.round(seconds / max * 100)) + '%"></i><small>' + d.toLocaleDateString("de-DE", { weekday: "short" }) + '</small></div>').join("");
		const goalPct = Math.min(100, stats.goalPct);
		const weekBody = '<div class="lz-bars">' + bars + '</div>' +
			'<div class="lz-goal"><span>🎯 Wochenziel: <b>' + fmt(stats.weekSeconds) + '</b> von ' + Math.round(stats.weekGoalMinutes / 60 * 10) / 10 + ' h (' + stats.goalPct + ' %)</span>' +
			'<button class="mini" data-lz-goal="1" title="Ziel ändern: 2 h → 5 h → 8 h → 12 h">Ziel ändern</button></div>' +
			'<div class="lz-progress lz-goal-bar"><i style="width:' + goalPct + '%"></i></div>';
		const categories = stats.categoriesToday;
		const catTotal = Math.max(1, Object.values(categories).reduce((a, b) => a + b, 0));
		const catRows = Object.entries(categories).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([id, s]) =>
			'<div class="lz-cat-row"><span>' + CATEGORIES[id].icon + ' ' + CATEGORIES[id].label + '</span><div class="lz-progress"><i style="width:' + Math.round(s / catTotal * 100) + '%"></i></div><small>' + fmt(s) + '</small></div>').join("") ||
			'<p class="hint lz-empty">Aktivität erscheint automatisch beim Lernen — Karteikarten, Hefte, Notizen und KI werden getrennt gezählt.</p>';
		const log = sessionsToday().slice(0, 8).map((s) => '<div class="lz-log-row"><span>' + CATEGORIES[s.category].icon + ' <b>' + CATEGORIES[s.category].label + '</b><small>' + new Date(s.startedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + ' · ' + fmt(s.durationSeconds) + '</small></span><span><button class="mini" data-lz-edit="' + s.id + '">Bearbeiten</button><button class="mini danger" data-lz-delete="' + s.id + '">🗑</button></span></div>').join("") || '<p class="hint lz-empty">Heute noch keine abgeschlossene Lerneinheit.</p>';
		const logBody = '<div class="lz-log-head"><b>' + sessionsToday().length + ' Einheit(en) heute</b><button class="mini" data-lz-add="1">+ Zeit hinzufügen</button></div><div class="lz-log">' + log + '</div>';
		return '<section class="lz-widget" id="lzWidget"><header class="section-head"><div><h2>⏱ Lernzeit</h2><span class="hint">' +
			(current ? CATEGORIES[current.category].icon + ' läuft gerade: ' + CATEGORIES[current.category].label : (timerPaused() ? '⏸ Timer pausiert' : 'Bereit für deinen nächsten Lernblock')) + '</span></div>' +
			'<div class="lz-head-right"><b class="lz-total" data-lz-today>' + fmt(stats.todaySeconds) + '</b><small>🔥 ' + stats.streakDays + (stats.streakDays === 1 ? ' Tag' : ' Tage') + ' Streak</small></div></header>' +
			timerCardHtml() +
			fold("week", "📊 Diese Woche", weekBody, true) +
			fold("cats", "🧭 Aktivität heute", catRows, false) +
			fold("log", "📝 Protokoll heute", logBody, false) +
			'</section>';
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
	async function saveManual(id, minutes, category, date) {
		const old = id && S.learningSessions[id];
		const durationSeconds = Math.max(60, Math.round(Number(minutes) * 60));
		// Manuelle Korrekturen können bewusst einem beliebigen Kalendertag
		// zugeordnet werden. Mittagszeit verhindert Zeitzonen-Sprünge am Tagesrand.
		const startedAt = new Date((date || dayKey(old && old.startedAt)) + "T12:00:00").toISOString();
		const endedAt = new Date(new Date(startedAt).getTime() + durationSeconds * 1000).toISOString();
		await STATE.dispatch("learningSessionUpsert", {
			id: id || U.uid(), startedAt, endedAt, durationSeconds,
			category: CATEGORIES[category] ? category : "other",
			sourceId: old ? old.sourceId : null, updated: iso(),
		});
	}
	function editModal(id) {
		const old = id ? S.learningSessions[id] : null;
		const overlay = document.getElementById("overlay");
		if (!overlay) return;
		const options = Object.entries(CATEGORIES).map(([key, value]) => '<option value="' + key + '"' + ((old ? old.category : "other") === key ? " selected" : "") + '>' + value.icon + ' ' + value.label + '</option>').join("");
		overlay.hidden = false;
		overlay.innerHTML = '<div class="modal lz-edit-modal"><button class="modal-x" data-lz-close="1">✕</button><h3>' + (old ? 'Lerneinheit bearbeiten' : 'Zeit hinzufügen') + '</h3><label>Tag<input id="lzEditDay" type="date" value="' + dayKey(old && old.startedAt) + '"></label><label>Minuten<input id="lzEditMinutes" type="number" min="1" max="1440" value="' + (old ? Math.round(old.durationSeconds / 60) : 25) + '"></label><label>Aktivität<select id="lzEditCategory">' + options + '</select></label><div class="modal-actions"><button data-lz-close="1">Abbrechen</button><button class="primary" data-lz-save="' + (id || '') + '">Speichern</button></div></div>';
	}

	["pointerdown", "pointermove", "keydown", "wheel", "touchstart"].forEach((type) => window.addEventListener(type, () => { if (!animal) lastActivityAt = Date.now(); }, { passive: true }));
	document.addEventListener("visibilitychange", () => { if (document.hidden) closeSegment(); else lastActivityAt = Date.now(); });
	window.addEventListener("pagehide", () => { closeSegment(); });
	document.addEventListener("click", async (event) => {
		const target = event.target.closest && event.target.closest("[data-lz-start],[data-lz-custom],[data-lz-stop],[data-lz-pause],[data-lz-resume],[data-lz-goal],[data-lz-add],[data-lz-edit],[data-lz-delete],[data-lz-save],[data-lz-close]");
		if (!target) return;
		if (target.dataset.lzStart) startTimer(target.dataset.lzStart);
		else if (target.dataset.lzCustom) startTimer((document.getElementById("lzCustomMinutes") || {}).value);
		else if (target.dataset.lzPause) pauseTimer();
		else if (target.dataset.lzResume) resumeTimer();
		else if (target.dataset.lzGoal) cycleGoal();
		else if (target.dataset.lzStop) { await stopTimer(); }
		else if (target.dataset.lzAdd !== undefined) editModal(null);
		else if (target.dataset.lzEdit) editModal(target.dataset.lzEdit);
		else if (target.dataset.lzDelete) { await STATE.dispatch("learningSessionDelete", { id: target.dataset.lzDelete, updated: iso() }); renderHomeWidget(); }
		else if (target.dataset.lzSave !== undefined) { await saveManual(target.dataset.lzSave || null, (document.getElementById("lzEditMinutes") || {}).value, (document.getElementById("lzEditCategory") || {}).value, (document.getElementById("lzEditDay") || {}).value); const o = document.getElementById("overlay"); if (o) { o.hidden = true; o.innerHTML = ""; } renderHomeWidget(); }
		else if (target.dataset.lzClose !== undefined) { const o = document.getElementById("overlay"); if (o) { o.hidden = true; o.innerHTML = ""; } }
	});

	// 🩹 FIX (19. Juli): Alle .lz-*-Styles (Widget, Timer, Folds, #lzAnimal)
	// leben jetzt fest in styles.css. Das früher hier zur Laufzeit injizierte
	// <style id="lernzeitStyles"> war auf manchen Geräten nicht (mehr) aktiv —
	// das Home-Widget erschien dann komplett ungestylt.

	setInterval(tick, TICK_MS);
	return { homeWidgetHtml, activeSessions, totalForDay, fmt, startTimer, statsForHome };
})();