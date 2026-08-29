import test from "node:test";
import assert from "node:assert/strict";

import { createCheckpointScheduler } from "../web/checkpoint-scheduler.js";

function harness(results = [true]) {
	let nextId = 1;
	const timers = new Map(), idle = new Map(), listeners = new Map();
	let runs = 0;
	const target = {
		addEventListener(type, fn) { listeners.set(type, fn); },
		removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
	};
	const scheduler = createCheckpointScheduler(async () => {
		const result = results[Math.min(runs, results.length - 1)];
		runs++;
		return result;
	}, {
		quietMs: 5000,
		maxAttempts: 3,
		activityTarget: target,
		setTimer(fn, delay) { const id = nextId++; timers.set(id, { fn, delay }); return id; },
		clearTimer(id) { timers.delete(id); },
		requestIdle(fn, options) { const id = nextId++; idle.set(id, { fn, options }); return id; },
		cancelIdle(id) { idle.delete(id); },
	});
	const fireTimer = () => { const [id, task] = timers.entries().next().value; timers.delete(id); task.fn(); return task; };
	const fireIdle = async () => { const [id, task] = idle.entries().next().value; idle.delete(id); await task.fn(); return task; };
	return { scheduler, timers, idle, listeners, fireTimer, fireIdle, runs: () => runs };
}

test("Checkpoint wartet fünf Sekunden Ruhe und wird durch Aktivität verschoben", () => {
	const h = harness();
	assert.equal(h.scheduler.schedule(), true);
	assert.equal([...h.timers.values()][0].delay, 5000);
	const firstTimerId = [...h.timers.keys()][0];
	h.listeners.get("keydown")();
	assert.equal(h.timers.has(firstTimerId), false);
	assert.equal(h.timers.size, 1);
	assert.equal(h.scheduler.status().attempts, 0);
});

test("Checkpoint läuft im Idle und entfernt Aktivitäts-Wächter nach Erfolg", async () => {
	const h = harness([true]);
	h.scheduler.schedule();
	const timer = h.fireTimer();
	assert.equal(timer.delay, 5000);
	assert.equal(h.idle.size, 1);
	await h.fireIdle();
	assert.equal(h.runs(), 1);
	assert.deepEqual(h.scheduler.status(), { scheduled: false, attempts: 1, watching: false, stopped: true });
	assert.equal(h.listeners.size, 0);
});

test("Gleichzeitige State-Änderung wird begrenzt erneut versucht", async () => {
	const h = harness([false, true]);
	h.scheduler.schedule();
	h.fireTimer();
	await h.fireIdle();
	assert.equal(h.runs(), 1);
	assert.equal(h.timers.size, 1);
	h.fireTimer();
	await h.fireIdle();
	assert.equal(h.runs(), 2);
	assert.equal(h.scheduler.status().stopped, true);
});
