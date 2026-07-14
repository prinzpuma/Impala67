"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";

export const LERNZEIT = (() => {
	const IDLE_MS = 60000;
	const TICK_MS = 5000;
	const TIMER_KEY = "impala67_lernzeit_timer_end";
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

	function tick() {
		if (document.hidden || animal) return;
		if (Date.now() - lastActivityAt >= IDLE_MS) { showAnimal(); return; }
		openSegment();
		maybeSplitSegment();
		if (timerEndsAt && Date.now() >= timerEndsAt) {
			const minutes = Math.max(1, Math.round((Number(localStorage.getItem("impala67_lernzeit_timer_minutes")) || 25)));
			timerEndsAt = 0;
			localStorage.removeItem(TIMER_KEY);
			closeSegment();
			openTimerDone(minutes);
		}
		refreshLive();
	}

	function totalForDay(key) {
		let total = activeSessions().filter((s) => dayKey(s.startedAt) === key).reduce((sum, s) => sum + s.durationSeconds, 0);
		if (key === dayKey() && current) total += Math.max(0, Math.floor((Date.now() - current.startedMs) / 1000));
		return total;
	}
	function groupedToday() {
		const result = { cards: 0, notebook: 0, notes: 0, ai: 0, other: 0 };
		for (const session of activeSessions().filter((s) => dayKey(s.startedAt) === dayKey())) result[session.category] = (result[session.category] || 0) + session.durationSeconds;
		if (current) result[current.category] = (result[current.category] || 0) + Math.max(0, Math.floor((Date.now() - current.startedMs) / 1000));
		return result;
	}
	function sessionsToday() {
		return activeSessions().filter((s) => dayKey(s.startedAt) === dayKey()).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
	}

	function homeWidgetHtml() {
		const today = totalForDay(dayKey());
		const categories = groupedToday();
		let max = 1;
		const week = Array.from({ length: 7 }, (_, index) => {
			const d = new Date(); d.setDate(d.getDate() - (6 - index));
			const seconds = totalForDay(dayKey(d)); max = Math.max(max, seconds);
			return { d, seconds };
		});
		const running = timerEndsAt > Date.now();
		const left = running ? Math.ceil((timerEndsAt - Date.now()) / 60000) : 0;
		const cats = Object.entries(categories).filter(([, seconds]) => seconds > 0).map(([id, seconds]) =>
			'<span class="lz-category">' + CATEGORIES[id].icon + ' ' + CATEGORIES[id].label + ' · ' + fmt(seconds) + '</span>').join("") || '<span class="hint">Aktivität erscheint automatisch beim Lernen.</span>';
		const log = sessionsToday().slice(0, 5).map((s) => '<div class="lz-log-row"><span>' + CATEGORIES[s.category].icon + ' <b>' + CATEGORIES[s.category].label + '</b><small>' + new Date(s.startedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + ' · ' + fmt(s.durationSeconds) + '</small></span><span><button class="mini" data-lz-edit="' + s.id + '">Bearbeiten</button><button class="mini danger" data-lz-delete="' + s.id + '">🗑</button></span></div>').join("") || '<p class="hint lz-empty">Heute noch keine abgeschlossene Lerneinheit.</p>';
		return '<section class="lz-widget" id="lzWidget"><header class="section-head"><div><h2>⏱ Lernzeit</h2><span class="hint">' + (current ? CATEGORIES[current.category].icon + ' läuft gerade: ' + CATEGORIES[current.category].label : 'Bereit für deinen nächsten Lernblock') + '</span></div><b class="lz-total" data-lz-today>' + fmt(today) + '</b></header>' +
			'<div class="lz-summary"><div class="lz-bars">' + week.map(({ d, seconds }) => '<div class="lz-bar-col"><i style="height:' + Math.max(5, Math.round(seconds / max * 100)) + '%"></i><small>' + d.toLocaleDateString("de-DE", { weekday: "short" }) + '</small></div>').join("") + '</div><div class="lz-categories">' + cats + '</div></div>' +
			'<div class="lz-timer-card">' + (running
				? '<div><small>Lerntimer läuft</small><b data-lz-timer-label>Noch ' + left + ' min</b></div><button class="mini" data-lz-stop="1">Beenden</button>'
				: '<div><small>Fokusblock starten</small><b>Wie lange möchtest du lernen?</b></div><div class="lz-timer-actions"><button data-lz-start="25">25 min</button><button data-lz-start="45">45 min</button><button data-lz-start="60">60 min</button><input id="lzCustomMinutes" type="number" min="5" max="240" value="25" aria-label="Eigene Minuten"><button class="mini" data-lz-custom="1">Start</button></div>') + '</div>' +
			'<div class="lz-log-head"><b>Heute</b><button class="mini" data-lz-add="1">＋ Zeit hinzufügen</button></div><div class="lz-log">' + log + '</div></section>';
	}

	function refreshLive() {
		const total = document.querySelector("[data-lz-today]");
		if (total) total.textContent = fmt(totalForDay(dayKey()));
		const label = document.querySelector("[data-lz-timer-label]");
		if (label && timerEndsAt) label.textContent = "Noch " + Math.max(1, Math.ceil((timerEndsAt - Date.now()) / 60000)) + " min";
	}
	function renderHomeWidget() {
		const old = document.getElementById("lzWidget");
		if (old) old.outerHTML = homeWidgetHtml();
	}
	function startTimer(minutes) {
		const min = Math.max(5, Math.min(240, Number(minutes) || 25));
		timerEndsAt = Date.now() + min * 60000;
		localStorage.setItem(TIMER_KEY, String(timerEndsAt));
		localStorage.setItem("impala67_lernzeit_timer_minutes", String(min));
		lastActivityAt = Date.now();
		openSegment();
		renderHomeWidget();
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
		const target = event.target.closest && event.target.closest("[data-lz-start],[data-lz-custom],[data-lz-stop],[data-lz-add],[data-lz-edit],[data-lz-delete],[data-lz-save],[data-lz-close]");
		if (!target) return;
		if (target.dataset.lzStart) startTimer(target.dataset.lzStart);
		else if (target.dataset.lzCustom) startTimer((document.getElementById("lzCustomMinutes") || {}).value);
		else if (target.dataset.lzStop) { timerEndsAt = 0; localStorage.removeItem(TIMER_KEY); await closeSegment(); renderHomeWidget(); }
		else if (target.dataset.lzAdd !== undefined) editModal(null);
		else if (target.dataset.lzEdit) editModal(target.dataset.lzEdit);
		else if (target.dataset.lzDelete) { await STATE.dispatch("learningSessionDelete", { id: target.dataset.lzDelete, updated: iso() }); }
		else if (target.dataset.lzSave !== undefined) { await saveManual(target.dataset.lzSave || null, (document.getElementById("lzEditMinutes") || {}).value, (document.getElementById("lzEditCategory") || {}).value, (document.getElementById("lzEditDay") || {}).value); const o = document.getElementById("overlay"); if (o) { o.hidden = true; o.innerHTML = ""; } }
		else if (target.dataset.lzClose !== undefined) { const o = document.getElementById("overlay"); if (o) { o.hidden = true; o.innerHTML = ""; } }
	});

	const style = document.createElement("style");
	style.id = "lernzeitStyles";
	style.textContent = `#lzAnimal{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:99999;display:grid;justify-items:center;gap:4px;width:min(340px,calc(100vw - 32px));padding:16px;border:1px solid var(--accent-border);border-radius:16px;background:var(--panel-solid);color:var(--text);box-shadow:0 18px 45px var(--shadow);cursor:pointer}#lzAnimal span{font-size:42px}#lzAnimal small{color:var(--text2);font-size:12px}.lz-widget{width:min(980px,100%);margin:22px auto;padding:20px 22px;border:1px solid var(--edge-soft);border-radius:14px;background:var(--surface-subtle)}.lz-total{font-size:24px}.lz-summary{display:flex;gap:22px;align-items:stretch;margin:14px 0}.lz-bars{display:flex;gap:8px;align-items:end;height:86px;min-width:210px;flex:1}.lz-bar-col{height:100%;flex:1;display:flex;flex-direction:column;justify-content:end;align-items:center;gap:5px}.lz-bar-col i{display:block;width:100%;max-width:28px;background:linear-gradient(#7aa2ff,#4d6fff);border-radius:6px 6px 2px 2px}.lz-bar-col small{font-size:10px;color:var(--text2)}.lz-categories{display:flex;flex-wrap:wrap;align-content:center;gap:6px;flex:1}.lz-category{padding:5px 8px;border-radius:7px;background:var(--surface);font-size:12px}.lz-timer-card{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px;border-radius:10px;background:var(--accent-soft);border:1px solid var(--accent-border)}.lz-timer-card small,.lz-timer-card b{display:block}.lz-timer-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.lz-timer-actions input{width:64px}.lz-log-head{display:flex;justify-content:space-between;align-items:center;margin:18px 0 6px}.lz-log-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--edge-soft);font-size:13px}.lz-log-row small{margin-left:8px;color:var(--text2)}.lz-log-row .mini{min-height:25px;padding:2px 6px;font-size:11px}.lz-empty{padding:10px 0}.lz-edit-modal label{display:grid;gap:5px;margin:12px 0;font-size:13px}.lz-done{text-align:center}.lz-done p{margin:10px 0 18px}@media(max-width:700px){.lz-widget{padding:16px}.lz-summary{flex-direction:column}.lz-timer-card{align-items:flex-start;flex-direction:column}.lz-log-row{align-items:flex-start;flex-direction:column}`;
	if (!document.getElementById(style.id)) document.head.appendChild(style);

	setInterval(tick, TICK_MS);
	return { homeWidgetHtml, activeSessions, totalForDay, fmt, startTimer };
})();