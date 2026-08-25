"use strict";

const ENABLE_KEY = "impala67PerformanceProfiler";
const DATA_KEY = "impala67PerformanceTraceV2";
const LEGACY_DATA_KEY = "impala67PerformanceTrace";
const MAX_RECORDS = 180;
const LAG_INTERVAL_MS = 250;
const LAG_THRESHOLD_MS = 120;
const STALL_FLUSH_MS = 150;
const STALL_MERGE_GAP_MS = 8;
const NOISY_INPUT_EVENTS = new Set([
	"pointerover", "pointerout", "pointerenter", "pointerleave",
	"mouseover", "mouseout", "mouseenter", "mouseleave",
]);

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
let lastContext = null;
let pendingStalls = [];
let stallTimer = 0;

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
		storage()?.removeItem(LEGACY_DATA_KEY);
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

function compactContext(context) {
	const stable = { ...context };
	delete stable.lastAction;
	delete stable.active;
	const delta = {};
	for (const [key, value] of Object.entries(stable)) {
		if (!lastContext || lastContext[key] !== value) delta[key] = value;
	}
	if (context.lastAction && JSON.stringify(context.lastAction) !== JSON.stringify(lastContext?.lastAction)) {
		delta.lastAction = context.lastAction;
	}
	// Laufende Operationen sind zeitabhängig und deshalb keine stabilen Kontextfelder.
	// Nur bei echten Hängern mitspeichern; leere und unveränderte Zustände blähen den Trace auf.
	if (context.active?.length) delta.active = context.active;
	lastContext = { ...stable, lastAction: context.lastAction };
	return delta;
}

function recordAt(kind, durationMs, meta = {}, at = wallTime()) {
	if (!isEnabled()) return;
	const context = compactContext(currentContext());
	const entry = { at, kind, durationMs: round(durationMs), ...safeMeta(meta) };
	if (Object.keys(context).length) entry.context = context;
	records.push(entry);
	if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
	persistSoon();
}

function record(kind, durationMs, meta = {}) { recordAt(kind, durationMs, meta); }

function performanceWallTime(startMs) {
	const origin = typeof performance !== "undefined" && Number.isFinite(performance.timeOrigin)
		? performance.timeOrigin
		: Date.now() - now();
	return new Date(origin + startMs).toISOString();
}

function mergeStall(target, source) {
	target.startMs = Math.min(target.startMs, source.startMs);
	target.endMs = Math.max(target.endMs, source.endMs);
	for (const name of source.sources) target.sources.add(name);
	for (const name of source.eventNames) target.eventNames.add(name);
	for (const id of source.interactionIds) target.interactionIds.add(id);
	target.eventCount += source.eventCount;
	for (const key of ["longTaskMs", "eventLoopLagMs", "inputDurationMs"]) {
		target[key] = Math.max(target[key] || 0, source[key] || 0);
	}
	if ((source.inputDurationMs || 0) >= (target.inputDurationMs || 0) && source.inputName) target.inputName = source.inputName;
}

function flushStalls() {
	clearTimeout(stallTimer);
	stallTimer = 0;
	const stalls = pendingStalls.sort((a, b) => a.startMs - b.startMs);
	pendingStalls = [];
	for (const stall of stalls) {
		const meta = {
			startMs: round(stall.startMs),
			sources: [...stall.sources].sort().join("+"),
			longTaskMs: stall.longTaskMs || undefined,
			eventLoopLagMs: stall.eventLoopLagMs || undefined,
			inputDurationMs: stall.inputDurationMs || undefined,
			inputName: stall.inputName || undefined,
			eventCount: stall.eventCount || undefined,
			interactionCount: stall.interactionIds.size || undefined,
			events: stall.eventNames.size ? [...stall.eventNames].sort().join(",").slice(0, 120) : undefined,
		};
		recordAt("main-thread-stall", stall.endMs - stall.startMs, meta, performanceWallTime(stall.startMs));
	}
}

function queueStall(source, startMs, durationMs, meta = {}) {
	if (!isEnabled() || !Number.isFinite(startMs) || !Number.isFinite(durationMs)) return;
	const incoming = {
		startMs,
		endMs: startMs + durationMs,
		sources: new Set([source]),
		eventNames: new Set(meta.eventName ? [meta.eventName] : []),
		interactionIds: new Set(meta.interactionId ? [meta.interactionId] : []),
		eventCount: meta.eventName ? 1 : 0,
		longTaskMs: source === "long-task" ? durationMs : 0,
		eventLoopLagMs: source === "event-loop-lag" ? durationMs : 0,
		inputDurationMs: source === "slow-input" ? durationMs : 0,
		inputName: source === "slow-input" ? meta.eventName : "",
	};
	const overlaps = pendingStalls.filter((stall) => incoming.startMs <= stall.endMs + STALL_MERGE_GAP_MS && incoming.endMs >= stall.startMs - STALL_MERGE_GAP_MS);
	if (overlaps.length) {
		const target = overlaps[0];
		mergeStall(target, incoming);
		for (const extra of overlaps.slice(1)) {
			mergeStall(target, extra);
			pendingStalls.splice(pendingStalls.indexOf(extra), 1);
		}
	} else pendingStalls.push(incoming);
	if (!stallTimer) stallTimer = setTimeout(flushStalls, STALL_FLUSH_MS);
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
					if (type === "event" && NOISY_INPUT_EVENTS.has(entry.name)) continue;
					queueStall(type === "longtask" ? "long-task" : "slow-input", entry.startTime, entry.duration, {
						eventName: type === "event" ? entry.name || type : "",
						interactionId: Number(entry.interactionId) || 0,
					});
				}
			});
			// Keine historischen Einträge: Beim nachträglichen Aktivieren gehören sie nicht
			// zur Diagnose und ihr Callback-Zeitpunkt ergab bisher eine falsche Zeitleiste.
			observer.observe(type === "event" ? { type, durationThreshold: 40 } : { type });
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
		if (lag >= LAG_THRESHOLD_MS && (typeof document === "undefined" || !document.hidden)) queueStall("event-loop-lag", expected, lag);
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
	lastContext = null; // Jeder Profiler-Start beginnt mit einem vollständigen Kontext-Snapshot.
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
	clearTimeout(stallTimer);
	lagTimer = 0;
	stallTimer = 0;
	pendingStalls = [];
	active.clear();
	initialized = false;
}

function setEnabled(enabled) {
	// Ausstehende gebündelte Hänger noch unter aktiviertem Zustand sichern.
	if (!enabled) flush();
	try { storage()?.setItem(ENABLE_KEY, enabled ? "1" : "0"); } catch { /* ignore */ }
	if (enabled) init();
	else stop();
	return isEnabled();
}

function flush() {
	flushStalls();
	clearTimeout(persistTimer);
	persistTimer = 0;
	try { storage()?.setItem(DATA_KEY, JSON.stringify(records.slice(-MAX_RECORDS))); } catch { /* ignore */ }
}

function clear() {
	records = [];
	pendingStalls = [];
	clearTimeout(stallTimer);
	stallTimer = 0;
	lastContext = null;
	try { storage()?.removeItem(DATA_KEY); } catch { /* ignore */ }
	try { storage()?.removeItem(LEGACY_DATA_KEY); } catch { /* ignore */ }
}

function report() {
	flush();
	const memory = typeof performance !== "undefined" && performance.memory ? {
		usedJsHeapMb: round(performance.memory.usedJSHeapSize / 1048576),
		limitJsHeapMb: round(performance.memory.jsHeapSizeLimit / 1048576),
	} : null;
	return JSON.stringify({
		app: "Impala67 performance trace",
		formatVersion: 2,
		contextEncoding: "delta",
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
function status() { return { enabled: isEnabled(), records: records.length + pendingStalls.length, active: active.size }; }

load();
export const PERF_PROFILER = { init, setEnabled, isEnabled, start, run, measure, record, report, clear, flush, status, setContextProvider };
