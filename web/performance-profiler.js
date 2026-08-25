"use strict";

const ENABLE_KEY = "impala67PerformanceProfiler";
const DATA_KEY = "impala67PerformanceTrace";
const MAX_RECORDS = 180;
const LAG_INTERVAL_MS = 250;
const LAG_THRESHOLD_MS = 120;

let records = [];
let active = new Map();
let observers = [];
let lagTimer = 0;
let persistTimer = 0;
let initialized = false;
let actionsInstalled = false;
let pagehideInstalled = false;
let contextProvider = null;
let lastAction = null;
let nextOperationId = 1;

const storage = () => typeof localStorage !== "undefined" ? localStorage : null;
const now = () => typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
const wallTime = () => new Date().toISOString();
const round = (value) => Math.round(Number(value || 0) * 10) / 10;

function isEnabled() {
	try { return storage()?.getItem(ENABLE_KEY) === "1"; } catch { return false; }
}

function safeMeta(meta) {
	if (!meta || typeof meta !== "object") return {};
	const out = {};
	for (const [key, value] of Object.entries(meta)) {
		if (value == null || typeof value === "boolean" || typeof value === "number") out[key] = value;
		else if (typeof value === "string") out[key] = value.slice(0, 120);
	}
	return out;
}

function load() {
	try {
		const saved = JSON.parse(storage()?.getItem(DATA_KEY) || "[]");
		records = Array.isArray(saved) ? saved.slice(-MAX_RECORDS) : [];
	} catch { records = []; }
}

function persistSoon() {
	if (persistTimer || !isEnabled()) return;
	persistTimer = setTimeout(() => {
		persistTimer = 0;
		const write = () => {
			try { storage()?.setItem(DATA_KEY, JSON.stringify(records.slice(-MAX_RECORDS))); } catch { /* Diagnose darf die App nie stören. */ }
		};
		if (typeof requestIdleCallback === "function") requestIdleCallback(write, { timeout: 1500 });
		else write();
	}, 3000);
}

function currentContext() {
	let app = {};
	try { app = safeMeta(contextProvider?.() || {}); } catch { /* optional */ }
	const current = now();
	for (const [id, entry] of active) if (current - entry.started > 300000) active.delete(id);
	return {
		...app,
		online: typeof navigator === "undefined" ? null : navigator.onLine,
		visibility: typeof document === "undefined" ? "unknown" : document.visibilityState,
		lastAction,
		active: [...active.values()].map((entry) => ({ name: entry.name, ageMs: round(current - entry.started) })).slice(-8),
	};
}

function record(kind, durationMs, meta = {}) {
	if (!isEnabled()) return;
	records.push({ at: wallTime(), kind, durationMs: round(durationMs), ...safeMeta(meta), context: currentContext() });
	if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
	persistSoon();
}

function start(name, meta = {}, minMs = 25) {
	if (!isEnabled()) return () => 0;
	const id = nextOperationId++;
	const started = now();
	active.set(id, { name: String(name), started });
	let finished = false;
	return (extra = {}) => {
		if (finished) return 0;
		finished = true;
		active.delete(id);
		const duration = now() - started;
		if (duration >= minMs) record("operation", duration, { name, ...safeMeta(meta), ...safeMeta(extra) });
		return duration;
	};
}

async function run(name, fn, meta = {}, minMs = 25) {
	const finish = start(name, meta, minMs);
	try { return await fn(); }
	catch (error) { finish({ failed: true, errorName: error?.name || "Error" }); throw error; }
	finally { finish(); }
}

function measure(name, fn, meta = {}, minMs = 16) {
	const finish = start(name, meta, minMs);
	try { return fn(); }
	catch (error) { finish({ failed: true, errorName: error?.name || "Error" }); throw error; }
	finally { finish(); }
}

function watchLongTasks() {
	if (typeof PerformanceObserver === "undefined") return;
	const supported = PerformanceObserver.supportedEntryTypes || [];
	for (const type of ["longtask", "event"]) {
		if (!supported.includes(type)) continue;
		try {
			const observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					if (type === "event" && entry.duration < 80) continue;
					record(type === "longtask" ? "long-task" : "slow-input", entry.duration, {
						name: entry.name || type,
						startMs: round(entry.startTime),
					});
				}
			});
			observer.observe(type === "event" ? { type, buffered: true, durationThreshold: 40 } : { type, buffered: true });
			observers.push(observer);
		} catch { /* Browser unterstützt den Entry-Typ nur teilweise. */ }
	}
}

function watchEventLoop() {
	let expected = now() + LAG_INTERVAL_MS;
	const tick = () => {
		if (!isEnabled()) return;
		const current = now();
		const lag = current - expected;
		if (lag >= LAG_THRESHOLD_MS && (typeof document === "undefined" || !document.hidden)) record("event-loop-lag", lag);
		expected = current + LAG_INTERVAL_MS;
		lagTimer = setTimeout(tick, LAG_INTERVAL_MS);
	};
	lagTimer = setTimeout(tick, LAG_INTERVAL_MS);
}

function watchActions() {
	if (actionsInstalled || typeof document === "undefined") return;
	actionsInstalled = true;
	const remember = (event) => {
		const target = event.target;
		lastAction = { type: event.type, tag: target?.tagName || "", id: String(target?.id || "").slice(0, 60), at: wallTime() };
	};
	document.addEventListener("pointerdown", remember, true);
	document.addEventListener("keydown", remember, true);
}

function init() {
	if (initialized || !isEnabled()) return;
	initialized = true;
	load();
	watchLongTasks();
	watchEventLoop();
	watchActions();
	record("profiler-start", 0);
	if (!pagehideInstalled && typeof window !== "undefined") {
		pagehideInstalled = true;
		window.addEventListener("pagehide", flush);
	}
}

function stop() {
	for (const observer of observers) observer.disconnect();
	observers = [];
	clearTimeout(lagTimer);
	lagTimer = 0;
	active.clear();
	initialized = false;
}

function setEnabled(enabled) {
	try { storage()?.setItem(ENABLE_KEY, enabled ? "1" : "0"); } catch { /* ignore */ }
	if (enabled) init();
	else { flush(); stop(); }
	return isEnabled();
}

function flush() {
	clearTimeout(persistTimer);
	persistTimer = 0;
	try { storage()?.setItem(DATA_KEY, JSON.stringify(records.slice(-MAX_RECORDS))); } catch { /* ignore */ }
}

function clear() {
	records = [];
	try { storage()?.removeItem(DATA_KEY); } catch { /* ignore */ }
}

function report() {
	flush();
	const memory = typeof performance !== "undefined" && performance.memory ? {
		usedJsHeapMb: round(performance.memory.usedJSHeapSize / 1048576),
		limitJsHeapMb: round(performance.memory.jsHeapSizeLimit / 1048576),
	} : null;
	return JSON.stringify({
		app: "Impala67 performance trace",
		exportedAt: wallTime(),
		version: typeof window !== "undefined" ? (window.APP_VERSION || "unknown") : "unknown",
		environment: {
			userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
			hardwareConcurrency: typeof navigator !== "undefined" ? navigator.hardwareConcurrency || null : null,
			deviceMemoryGb: typeof navigator !== "undefined" ? navigator.deviceMemory || null : null,
			memory,
		},
		records,
	}, null, 2);
}

function setContextProvider(provider) { contextProvider = typeof provider === "function" ? provider : null; }
function status() { return { enabled: isEnabled(), records: records.length, active: active.size }; }

load();
export const PERF_PROFILER = { init, setEnabled, isEnabled, start, run, measure, record, report, clear, flush, status, setContextProvider };
