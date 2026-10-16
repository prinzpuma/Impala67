"use strict";

import { BUS } from "./event-bus.js";

const DEFAULT_QUIET_MS = 5000;
const DEFAULT_IDLE_TIMEOUT_MS = 5000;
const DEFAULT_MAX_ATTEMPTS = 3;
const ACTIVITY_EVENTS = ["pointerdown", "pointerup", "pointermove", "touchstart", "touchend", "keydown", "input"];

// Ein großer IndexedDB-put() klont seinen Wert synchron. requestIdleCallback allein
// verhindert deshalb keinen Hänger direkt nach dem Start: Es entscheidet nur, wann
// der Callback beginnt. Diese kleine Regel wartet zusätzlich auf echte Nutzer-Ruhe
// und versucht bei einem gleichzeitigen State-Update begrenzt erneut.
export function createCheckpointScheduler(run, options = {}) {
	if (typeof run !== "function") throw new TypeError("Checkpoint-Callback fehlt.");
	const quietMs = Math.max(0, Number(options.quietMs ?? DEFAULT_QUIET_MS) || 0);
	const idleTimeoutMs = Math.max(0, Number(options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS) || 0);
	const maxAttempts = Math.max(1, Number(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS) || 1);
	const setTimer = options.setTimer || setTimeout;
	const clearTimer = options.clearTimer || clearTimeout;
	const requestIdle = options.requestIdle || (typeof requestIdleCallback === "function" ? requestIdleCallback : null);
	const cancelIdle = options.cancelIdle || (typeof cancelIdleCallback === "function" ? cancelIdleCallback : null);
	const activityTarget = options.activityTarget ?? (typeof document !== "undefined" ? document : null);
	const onError = typeof options.onError === "function" ? options.onError : () => {};

	let timer = 0, idle = 0, attempts = 0, watching = false, stopped = false, running = false, rerun = false;

	const clearPending = () => {
		if (timer) clearTimer(timer);
		if (idle && cancelIdle) cancelIdle(idle);
		timer = 0; idle = 0;
	};
	const unwatch = () => {
		if (!watching || !activityTarget?.removeEventListener) return;
		for (const type of ACTIVITY_EVENTS) activityTarget.removeEventListener(type, arm, true);
		watching = false;
	};
	const stop = () => {
		stopped = true;
		clearPending();
		unwatch();
	};
	// Erledigt (oder aufgegeben): ruhen, bis jemand erneut schedule() ruft — z.B. nach
	// einer Kompaktierung, die den gespeicherten Checkpoint sonst ungültig machen würde.
	const settle = () => {
		clearPending();
		unwatch();
		attempts = 0;
		if (rerun) { rerun = false; arm(); }
	};
	const isWritingActive = () => Boolean(BUS.call("heft:is-writing"));
	const execute = async () => {
		if (isWritingActive()) {
			idle = 0;
			arm();
			return;
		}
		idle = 0;
		attempts++;
		running = true;
		let saved = false;
		try {
			saved = !!(await run());
		} catch (error) { onError(error); }
		finally { running = false; }
		if (saved || attempts >= maxAttempts) return settle();
		rerun = false; // der Wiederholungsversuch sieht den neuen Stand ohnehin
		arm();
	};
	// Nutzeraktivität verschiebt den Termin nur; ein laufendes Speichern wird nicht doppelt gestartet.
	function arm() {
		if (stopped) return false;
		clearPending();
		if (!watching && activityTarget?.addEventListener) {
			for (const type of ACTIVITY_EVENTS) activityTarget.addEventListener(type, arm, true);
			watching = true;
		}
		timer = setTimer(() => {
			timer = 0;
			if (requestIdle) idle = requestIdle(execute, { timeout: idleTimeoutMs });
			else execute();
		}, quietMs);
		return true;
	}
	// Während eines laufenden Speicherns vorgemerkt: Der Lauf hat den neuen Stand evtl. nicht gesehen.
	function schedule() {
		if (stopped) return false;
		if (running) { rerun = true; return true; }
		return arm();
	}

	return { schedule, stop, status: () => ({ scheduled: !!(timer || idle), attempts, watching, stopped }) };
}
