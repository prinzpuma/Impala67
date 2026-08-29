"use strict";

const DEFAULT_QUIET_MS = 5000;
const DEFAULT_IDLE_TIMEOUT_MS = 5000;
const DEFAULT_MAX_ATTEMPTS = 3;
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "input"];

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

	let timer = 0, idle = 0, attempts = 0, watching = false, stopped = false;

	const clearPending = () => {
		if (timer) clearTimer(timer);
		if (idle && cancelIdle) cancelIdle(idle);
		timer = 0; idle = 0;
	};
	const unwatch = () => {
		if (!watching || !activityTarget?.removeEventListener) return;
		for (const type of ACTIVITY_EVENTS) activityTarget.removeEventListener(type, schedule, true);
		watching = false;
	};
	const stop = () => {
		stopped = true;
		clearPending();
		unwatch();
	};
	const execute = async () => {
		idle = 0;
		attempts++;
		try {
			if (await run()) return stop();
		} catch (error) { onError(error); }
		if (attempts >= maxAttempts) return stop();
		schedule();
	};
	function schedule() {
		if (stopped) return false;
		clearPending();
		if (!watching && activityTarget?.addEventListener) {
			for (const type of ACTIVITY_EVENTS) activityTarget.addEventListener(type, schedule, true);
			watching = true;
		}
		timer = setTimer(() => {
			timer = 0;
			if (requestIdle) idle = requestIdle(execute, { timeout: idleTimeoutMs });
			else execute();
		}, quietMs);
		return true;
	}

	return { schedule, stop, status: () => ({ scheduled: !!(timer || idle), attempts, watching, stopped }) };
}
