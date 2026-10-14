"use strict";
// Tipp „Performance-Modus“: Ruckelt die App auf diesem Gerät in zwei Sitzungen spürbar,
// schlägt sie den Modus einmal vor. Gemessen wird die Zeit von Klick/Taste bis zum
// nächsten Bild — das klappt auch in Safari, wo es keine Long-Task-Messung gibt.
// Nach „Einschalten“ oder „Nein danke“ kommt der Tipp auf diesem Gerät nie wieder.
import { U } from "./util.js";

const KEY = "impala67.perfHint";
const MOTION_KEY = "impala67Motion";
const SLOW_MS = 200;             // ab hier fühlt sich eine Eingabe hakelig an
const SLOW_PER_SESSION = 3;      // so viele Ruckler machen eine Sitzung „ruckelig“
const LAGGY_SESSIONS = 2;        // so viele ruckelige Sitzungen braucht der Tipp
const WINDOW_MS = 14 * 864e5;    // … innerhalb von 14 Tagen
const WARMUP_MS = 8000;          // Start und erster Sync zählen nicht
const SHOW_MS = 12000;
const INPUTS = ["click", "keydown"];

const get = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const set = (key, value) => { try { localStorage.setItem(key, value); } catch { /* ignore */ } };
const readState = () => { try { return JSON.parse(get(KEY)) || {}; } catch { return {}; } };
const writeState = (value) => set(KEY, JSON.stringify(value));
const perfModeOn = () => get(MOTION_KEY) === "reduced";

function init() {
	if (readState().done || perfModeOn()) return;
	let slow = 0, pending = false, shownAt = 0;
	// Ein verstecktes Fenster liefert keine Bilder — Eingaben davor nicht als Ruckler werten.
	document.addEventListener("visibilitychange", () => { if (!document.hidden) shownAt = performance.now(); });
	const onInput = (e) => {
		const now = performance.now();
		if (pending || document.hidden || now < WARMUP_MS) return;
		pending = true;
		const at = e.timeStamp > 0 && e.timeStamp <= now ? e.timeStamp : now;
		requestAnimationFrame(() => {
			pending = false;
			if (document.hidden || shownAt > at || performance.now() - at < SLOW_MS) return;
			if (++slow === SLOW_PER_SESSION) sessionLagged();
		});
	};
	INPUTS.forEach((type) => addEventListener(type, onInput, { capture: true, passive: true }));

	function sessionLagged() {
		INPUTS.forEach((type) => removeEventListener(type, onInput, { capture: true }));
		const now = Date.now(), state = readState();
		const lagged = (Array.isArray(state.lagged) ? state.lagged : []).filter((t) => now - t < WINDOW_MS).concat(now);
		writeState({ ...state, lagged });
		if (lagged.length >= LAGGY_SESSIONS && !perfModeOn()) show();
	}
}

function show() {
	let wrap = document.getElementById("toasts");
	if (!wrap) {
		wrap = document.createElement("div");
		wrap.id = "toasts";
		document.body.appendChild(wrap);
	}
	const t = document.createElement("div");
	t.className = "toast perf-hint";
	t.innerHTML = "<div>Die App ruckelt auf diesem Gerät öfter. Performance-Modus einschalten? Weniger Animationen und Effekte, dafür flüssiger.</div>" +
		'<div class="toast-actions"><button type="button" data-perfhint="no">Nein danke</button><button type="button" class="primary" data-perfhint="on">Einschalten</button></div>';
	const close = () => { t.classList.add("hide"); setTimeout(() => t.remove(), 350); };
	const timer = setTimeout(close, SHOW_MS);
	t.addEventListener("click", (e) => {
		const choice = e.target.closest?.("[data-perfhint]")?.dataset.perfhint;
		if (!choice) return;
		clearTimeout(timer);
		close();
		writeState({ ...readState(), done: true });
		if (choice !== "on") return;
		set(MOTION_KEY, "reduced");
		document.body.classList.add("perf-mode");
		U.toast("Performance-Modus ist an — änderbar unter Einstellungen › Darstellung.", "success");
	});
	wrap.appendChild(t);
}

init();
