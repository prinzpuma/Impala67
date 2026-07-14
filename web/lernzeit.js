"use strict";
import { U } from "./util.js";

// lernzeit.js — Lernzeit-Tracker (NEU, 14. Juli 2026, aus „kommt noch"):
// - Zählt aktive Lernzeit in 5-s-Schritten, solange die App sichtbar ist und
//   der Nutzer aktiv ist (Maus/Tastatur/Touch/Stift).
// - Nach 60 s ohne Eingabe taucht ein Tier auf und fragt „Lernst du noch?" —
//   erst Berühren/Anklicken/Darüberfahren des Tiers lässt die Zeit weiterlaufen.
// - Optionaler Lerntimer (Minuten-Ziel) mit Erinnerung bei Ablauf.
// - Startseiten-Widget: Heute-Zeit, 7-Tage-Balken, Wochen-Summe, Timer und
//   motivierende Worte (siehe render.js → renderHome).
// Speicherung bewusst in localStorage (Gerätestatistik, NICHT im Event-Log).
export const LERNZEIT = (() => {
	const DAYS_KEY = "impala67_lernzeit_days";         // { "YYYY-MM-DD": Sekunden }
	const SETTINGS_KEY = "impala67_lernzeit_settings"; // { timerMinutes }
	const TIMER_KEY = "impala67_lernzeit_timer_end";   // Epoch-ms des Timer-Endes
	const IDLE_MS = 60000; // 1 Minute ohne Eingabe → Tier fragt nach
	const TICK_MS = 5000;  // Zählschritt

	const ANIMALS = ["🦊", "🐹", "🦉", "🐢", "🐨", "🐸", "🐼"];
	const MOTIVATION = [
		"Dranbleiben — jede Minute zählt!",
		"Kleine Schritte, großes Ziel. 💪",
		"Konstanz schlägt Talent.",
		"Heute gelernt, morgen gekonnt.",
		"Elektrodynamik wartet nicht — du schaffst das! 🧲",
		"Fokus an, Zweifel aus.",
		"Erst das Lernen, dann das Chillen. 😌",
	];

	function loadJson(key, fallback) {
		try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
	}
	let days = loadJson(DAYS_KEY, {});
	let settings = loadJson(SETTINGS_KEY, { timerMinutes: 25 });
	let timerEndsAt = Number(localStorage.getItem(TIMER_KEY) || 0);
	let lastActivity = Date.now();
	let animalEl = null;

	function dayKey(offset) {
		const d = new Date();
		d.setDate(d.getDate() - (offset || 0));
		return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
	}
	function todaySeconds() { return days[dayKey(0)] || 0; }
	function addSeconds(sec) {
		const k = dayKey(0);
		days[k] = (days[k] || 0) + sec;
		// Alte Einträge begrenzen (rollierende ~90 Tage) — localStorage klein halten.
		const keys = Object.keys(days).sort();
		while (keys.length > 90) delete days[keys.shift()];
		localStorage.setItem(DAYS_KEY, JSON.stringify(days));
	}
	function fmt(sec) {
		sec = Math.round(sec || 0);
		const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
		if (h) return h + " h " + m + " min";
		if (m) return m + " min";
		return sec > 0 ? "unter 1 min" : "0 min";
	}

	// ---------- Anwesenheits-Tier ----------
	function showAnimal() {
		if (animalEl) return;
		const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
		animalEl = document.createElement("div");
		animalEl.id = "lzAnimal";
		animalEl.setAttribute("role", "dialog");
		animalEl.innerHTML =
			'<span class="lz-animal-emoji">' + animal + "</span>" +
			"<b>Lernst du noch?</b>" +
			"<small>Tier berühren oder mit der Maus darüberfahren — dann läuft deine Lernzeit weiter.</small>";
		const resume = () => { hideAnimal(); lastActivity = Date.now(); refreshHomeWidget(); };
		animalEl.addEventListener("pointerenter", resume);
		animalEl.addEventListener("click", resume);
		animalEl.addEventListener("touchstart", resume, { passive: true });
		document.body.appendChild(animalEl);
	}
	function hideAnimal() {
		if (animalEl) { animalEl.remove(); animalEl = null; }
	}

	// Allgemeine Aktivität hält den Tracker wach — aber NUR solange das Tier nicht
	// sichtbar ist: Ist es einmal da, zählt ausschließlich die bewusste Berührung
	// des Tiers als „ich lerne noch" (sonst würde jede zufällige Mausbewegung genügen).
	const onActivity = () => { if (!animalEl) lastActivity = Date.now(); };
	["pointerdown", "pointermove", "keydown", "wheel", "touchstart"].forEach((t) =>
		window.addEventListener(t, onActivity, { passive: true }));

	// ---------- Zähl-Schleife ----------
	setInterval(() => {
		if (document.hidden) return; // Hintergrund-Tab zählt nie
		if (animalEl) return;        // wartet auf Bestätigung — Zeit zählt nicht
		if (Date.now() - lastActivity >= IDLE_MS) { showAnimal(); return; }
		addSeconds(TICK_MS / 1000);
		if (timerEndsAt && Date.now() >= timerEndsAt) {
			timerEndsAt = 0;
			localStorage.removeItem(TIMER_KEY);
			U.toast("⏰ Lerntimer fertig — starke Leistung! Zeit für eine Pause.", "success");
		}
		refreshHomeWidget();
	}, TICK_MS);

	// ---------- Startseiten-Widget ----------
	function motivation() {
		const t = todaySeconds();
		if (t >= 2 * 3600) return "Über 2 Stunden heute — du bist nicht zu stoppen! 🚀";
		if (t >= 3600) return "Schon über eine Stunde — stark! 🔥";
		return MOTIVATION[new Date().getDate() % MOTIVATION.length];
	}
	function homeWidgetHtml() {
		let max = 1, week = 0;
		const bars = [];
		for (let i = 6; i >= 0; i--) {
			const s = days[dayKey(i)] || 0;
			week += s;
			if (s > max) max = s;
			bars.push({ i, s });
		}
		const barHtml = bars.map(({ i, s }) => {
			const d = new Date();
			d.setDate(d.getDate() - i);
			const label = d.toLocaleDateString("de-DE", { weekday: "short" });
			return '<div class="lz-bar-col" title="' + label + ": " + fmt(s) + '">' +
				'<div class="lz-bar"><i style="height:' + Math.max(4, Math.round((s / max) * 100)) + '%"></i></div>' +
				"<small>" + label + "</small></div>";
		}).join("");
		const running = timerEndsAt && Date.now() < timerEndsAt;
		const remaining = running ? Math.max(1, Math.ceil((timerEndsAt - Date.now()) / 60000)) : 0;
		return '<div class="lz-widget" id="lzWidget">' +
			'<div class="section-head"><h2>⏱ Lernzeit</h2><span class="hint lz-motivation">' + U.esc(motivation()) + "</span></div>" +
			'<div class="lz-body">' +
				'<div class="lz-today"><b>' + fmt(todaySeconds()) + "</b><small>heute · " + fmt(week) + " diese Woche</small></div>" +
				'<div class="lz-bars">' + barHtml + "</div>" +
			"</div>" +
			'<div class="lz-timer">' +
				(running
					? "<span>⏳ Lerntimer: noch ~" + remaining + " min</span><button class=\"mini\" data-lz-timerstop=\"1\">Stoppen</button>"
					: '<label>Lerntimer <input id="lzTimerMinutes" type="number" min="5" max="240" step="5" value="' + (settings.timerMinutes || 25) + '"> min</label><button class="mini" data-lz-timerstart="1">▶ Start</button>') +
			"</div></div>";
	}
	// Aktualisiert das Widget in-place (nur wenn die Startseite es gerade zeigt) —
	// bewusst KEIN render(): ein Full-Render alle 5 s würde Menüs/Fokus stören.
	function refreshHomeWidget() {
		const host = document.getElementById("lzWidget");
		if (host) host.outerHTML = homeWidgetHtml();
	}

	// Timer-Buttons (delegiert — das Widget wird bei jedem Home-Render neu erzeugt)
	document.addEventListener("click", (e) => {
		if (e.target.closest && e.target.closest("[data-lz-timerstart]")) {
			const inp = document.getElementById("lzTimerMinutes");
			const min = Math.min(240, Math.max(1, Number(inp && inp.value) || settings.timerMinutes || 25));
			settings.timerMinutes = min;
			localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
			timerEndsAt = Date.now() + min * 60000;
			localStorage.setItem(TIMER_KEY, String(timerEndsAt));
			U.toast("Lerntimer: " + min + " Minuten — los geht's! 💪", "success");
			refreshHomeWidget();
		} else if (e.target.closest && e.target.closest("[data-lz-timerstop]")) {
			timerEndsAt = 0;
			localStorage.removeItem(TIMER_KEY);
			refreshHomeWidget();
		}
	});

	// Styles bringt das Modul selbst mit (kein Eingriff in styles.css nötig).
	const style = document.createElement("style");
	style.id = "lernzeitStyles";
	style.textContent = [
		"#lzAnimal{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:99999;",
		"display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px 22px;border-radius:16px;",
		"background:var(--panel,#15171c);border:1px solid var(--line,#2a2d34);box-shadow:0 12px 40px rgba(0,0,0,.45);",
		"cursor:pointer;text-align:center;max-width:min(90vw,340px);animation:lzBounce 1.6s ease-in-out infinite}",
		"#lzAnimal .lz-animal-emoji{font-size:42px;line-height:1}",
		"#lzAnimal b{font-size:15px}#lzAnimal small{opacity:.7;font-size:12px}",
		"@keyframes lzBounce{0%,100%{transform:translateX(-50%) translateY(0)}50%{transform:translateX(-50%) translateY(-7px)}}",
		".lz-widget{display:flex;flex-direction:column;gap:10px}",
		".lz-body{display:flex;align-items:flex-end;gap:18px;flex-wrap:wrap}",
		".lz-today b{font-size:26px;display:block}.lz-today small{opacity:.65}",
		".lz-bars{display:flex;gap:8px;align-items:flex-end;flex:1;min-width:180px}",
		".lz-bar-col{display:flex;flex-direction:column;align-items:center;gap:3px;flex:1}",
		".lz-bar{height:56px;width:100%;max-width:26px;display:flex;align-items:flex-end;background:rgba(127,127,127,.12);border-radius:6px;overflow:hidden}",
		".lz-bar i{display:block;width:100%;background:linear-gradient(180deg,#7aa2ff,#4c6fff);border-radius:6px 6px 0 0}",
		".lz-bar-col small{font-size:10px;opacity:.6}",
		".lz-timer{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:13px}",
		".lz-timer input{width:64px}",
		".lz-motivation{margin-left:auto}",
	].join("");
	document.head.appendChild(style);

	return { homeWidgetHtml, todaySeconds, fmt };
})();