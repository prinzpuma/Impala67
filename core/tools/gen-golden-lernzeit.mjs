// Generiert lernzeit.json für `cargo test -p impala-model` (core/impala-model/tests/golden/)
// aus der echten JS-Implementierung in web/lernzeit.js und web/home-view.js.
// Ausführen: node core/tools/gen-golden-lernzeit.mjs
process.env.TZ = "UTC";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "../impala-model/tests/golden");
fs.mkdirSync(outDir, { recursive: true });

const dom = new JSDOM('<!doctype html><html><body><div id="overlay"></div></body></html>', { url: "http://localhost/" });
for (const key of ["window", "document", "Element", "Node", "HTMLElement", "MutationObserver", "navigator", "CustomEvent"]) {
	Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });

const { LERNZEIT } = await import("../../web/lernzeit.js");
const { S, STATE } = await import("../../web/state.js");

// 1. mergedSeconds
const mergeCases = [
	{ name: "empty", sessions: [] },
	{
		name: "single_session_with_segment",
		sessions: [
			{
				id: "s1",
				startedAt: "2026-11-01T10:00:00.000Z",
				endedAt: "2026-11-01T10:30:00.000Z",
				durationSeconds: 1800,
				segments: [{ startedAt: "2026-11-01T10:00:00.000Z", endedAt: "2026-11-01T10:30:00.000Z" }],
			},
		],
	},
	{
		name: "two_disjoint_sessions",
		sessions: [
			{
				id: "s1",
				startedAt: "2026-11-01T10:00:00.000Z",
				endedAt: "2026-11-01T10:30:00.000Z",
				durationSeconds: 1800,
				segments: [{ startedAt: "2026-11-01T10:00:00.000Z", endedAt: "2026-11-01T10:30:00.000Z" }],
			},
			{
				id: "s2",
				startedAt: "2026-11-01T11:00:00.000Z",
				endedAt: "2026-11-01T11:15:00.000Z",
				durationSeconds: 900,
				segments: [{ startedAt: "2026-11-01T11:00:00.000Z", endedAt: "2026-11-01T11:15:00.000Z" }],
			},
		],
	},
	{
		name: "overlapping_two_devices",
		sessions: [
			{
				id: "dev_a",
				startedAt: "2026-11-01T14:00:00.000Z",
				endedAt: "2026-11-01T14:40:00.000Z",
				durationSeconds: 2400,
				segments: [{ startedAt: "2026-11-01T14:00:00.000Z", endedAt: "2026-11-01T14:40:00.000Z" }],
			},
			{
				id: "dev_b",
				startedAt: "2026-11-01T14:10:00.000Z",
				endedAt: "2026-11-01T14:50:00.000Z",
				durationSeconds: 2400,
				segments: [{ startedAt: "2026-11-01T14:10:00.000Z", endedAt: "2026-11-01T14:50:00.000Z" }],
			},
		],
	},
	{
		name: "contained_overlap",
		sessions: [
			{
				id: "outer",
				startedAt: "2026-11-01T08:00:00.000Z",
				endedAt: "2026-11-01T09:00:00.000Z",
				durationSeconds: 3600,
				segments: [{ startedAt: "2026-11-01T08:00:00.000Z", endedAt: "2026-11-01T09:00:00.000Z" }],
			},
			{
				id: "inner",
				startedAt: "2026-11-01T08:15:00.000Z",
				endedAt: "2026-11-01T08:45:00.000Z",
				durationSeconds: 1800,
				segments: [{ startedAt: "2026-11-01T08:15:00.000Z", endedAt: "2026-11-01T08:45:00.000Z" }],
			},
		],
	},
	{
		name: "touching_boundaries",
		sessions: [
			{
				id: "s1",
				startedAt: "2026-11-01T12:00:00.000Z",
				endedAt: "2026-11-01T12:30:00.000Z",
				durationSeconds: 1800,
				segments: [{ startedAt: "2026-11-01T12:00:00.000Z", endedAt: "2026-11-01T12:30:00.000Z" }],
			},
			{
				id: "s2",
				startedAt: "2026-11-01T12:30:00.000Z",
				endedAt: "2026-11-01T13:00:00.000Z",
				durationSeconds: 1800,
				segments: [{ startedAt: "2026-11-01T12:30:00.000Z", endedAt: "2026-11-01T13:00:00.000Z" }],
			},
		],
	},
	{
		name: "fallback_without_segments",
		sessions: [
			{
				id: "legacy1",
				startedAt: "2026-11-01T10:00:00.000Z",
				endedAt: "2026-11-01T10:10:00.000Z",
				durationSeconds: 600,
				segments: [],
			},
			{
				id: "legacy2_no_end",
				startedAt: "2026-11-01T10:05:00.000Z",
				durationSeconds: 900,
				segments: null,
			},
		],
	},
	{
		name: "multiple_segments_interleaved",
		sessions: [
			{
				id: "multi1",
				startedAt: "2026-11-01T15:00:00.000Z",
				endedAt: "2026-11-01T16:00:00.000Z",
				durationSeconds: 1800,
				segments: [
					{ startedAt: "2026-11-01T15:00:00.000Z", endedAt: "2026-11-01T15:15:00.000Z" },
					{ startedAt: "2026-11-01T15:30:00.000Z", endedAt: "2026-11-01T15:45:00.000Z" },
				],
			},
			{
				id: "multi2",
				startedAt: "2026-11-01T15:10:00.000Z",
				endedAt: "2026-11-01T15:35:00.000Z",
				durationSeconds: 1500,
				segments: [
					{ startedAt: "2026-11-01T15:10:00.000Z", endedAt: "2026-11-01T15:35:00.000Z" },
				],
			},
		],
	},
];

const mergedResults = mergeCases.map((c) => ({
	name: c.name,
	sessions: c.sessions,
	expectedSeconds: LERNZEIT.mergedSeconds(c.sessions),
}));

// 2. streakDays
const streakCases = [
	{ name: "empty", totals: {}, expectedStreak: 0 },
	{
		name: "today_and_yesterday_active",
		totals: { "2026-11-04": 600, "2026-11-03": 500, "2026-11-02": 400 },
		referenceDate: "2026-11-04",
	},
	{
		name: "today_empty_yesterday_active",
		totals: { "2026-11-04": 100, "2026-11-03": 600, "2026-11-02": 700 },
		referenceDate: "2026-11-04",
	},
	{
		name: "gap_two_days_ago",
		totals: { "2026-11-04": 600, "2026-11-03": 100, "2026-11-02": 800 },
		referenceDate: "2026-11-04",
	},
	{
		name: "today_zero_yesterday_zero",
		totals: { "2026-11-04": 0, "2026-11-03": 0, "2026-11-02": 800 },
		referenceDate: "2026-11-04",
	},
];

// Helper to calculate streak with custom reference date
function calcStreakForDate(totals, refDateStr) {
	const MIN = 5 * 60;
	let streak = 0;
	const ref = new Date(refDateStr + "T12:00:00.000Z");
	for (let i = 0; i < 365; i++) {
		const d = new Date(ref);
		d.setDate(d.getDate() - i);
		const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
		const seconds = totals[key] || 0;
		if (seconds >= MIN) streak++;
		else if (i === 0) continue;
		else break;
	}
	return streak;
}

const streakResults = streakCases.map((c) => ({
	name: c.name,
	totals: c.totals,
	referenceDate: c.referenceDate || "2026-11-04",
	expectedStreak: calcStreakForDate(c.totals, c.referenceDate || "2026-11-04"),
}));

// 3. weekData
function calcWeekForDate(totals, refDateStr, offset = 0) {
	const d = new Date(refDateStr + "T12:00:00.000Z");
	d.setHours(0, 0, 0, 0);
	d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
	return Array.from({ length: 7 }, (_, index) => {
		const cur = new Date(d);
		cur.setDate(cur.getDate() + index);
		const key = cur.getFullYear() + "-" + String(cur.getMonth() + 1).padStart(2, "0") + "-" + String(cur.getDate()).padStart(2, "0");
		return { date: key, seconds: totals[key] || 0 };
	});
}

const sampleTotals = {
	"2026-11-02": 1200, // Mo
	"2026-11-03": 1800, // Di
	"2026-11-04": 600,  // Mi
	"2026-11-05": 0,    // Do
	"2026-11-06": 2400, // Fr
	"2026-11-07": 900,  // Sa
	"2026-11-08": 300,  // So
	"2026-10-30": 500,  // Vorwoche
};

const weekResults = [
	{ name: "current_week", refDate: "2026-11-04", offset: 0, days: calcWeekForDate(sampleTotals, "2026-11-04", 0) },
	{ name: "prev_week", refDate: "2026-11-04", offset: -1, days: calcWeekForDate(sampleTotals, "2026-11-04", -1) },
	{ name: "next_week", refDate: "2026-11-04", offset: 1, days: calcWeekForDate(sampleTotals, "2026-11-04", 1) },
];

// 4. weekGoal & cycle
const goalCases = [
	{ input: 0, normalized: 300 },
	{ input: 20, normalized: 300 },
	{ input: 30, normalized: 30 },
	{ input: 120, normalized: 120 },
	{ input: 300, normalized: 300 },
	{ input: 480, normalized: 480 },
	{ input: 720, normalized: 720 },
];

const presets = [120, 300, 480, 720];
function jsCycle(stored) {
	const current = Math.max(30, Number(stored) || 300);
	const next = presets[(presets.indexOf(current) + 1 + presets.length) % presets.length];
	return next;
}

const cycleResults = [120, 300, 480, 720, 50, 0, 999].map((input) => ({
	input,
	next: jsCycle(input),
}));

// 5. home_nudge
function jsNudge(streak, todaySeconds, weekMin, goalMin, hour) {
	const todayMin = Math.round((todaySeconds || 0) / 60);
	const left = goalMin - weekMin;
	if (streak && !todayMin && hour >= 14) {
		return { kind: "streakAtRisk", streakDays: streak };
	}
	if (left > 0 && left <= 60) {
		return { kind: "goalInReach", minutesLeft: left };
	}
	if (left <= 0 && weekMin > 0) {
		return { kind: "goalReached" };
	}
	if (todayMin > 0) {
		return { kind: "todayProgress", minutes: todayMin };
	}
	return { kind: "none" };
}

const nudgeCases = [
	{ streak: 5, todaySeconds: 0, weekMin: 100, goalMin: 300, hour: 15, expected: { kind: "streakAtRisk", streakDays: 5 } },
	{ streak: 5, todaySeconds: 0, weekMin: 100, goalMin: 300, hour: 13, expected: { kind: "none" } },
	{ streak: 0, todaySeconds: 0, weekMin: 270, goalMin: 300, hour: 11, expected: { kind: "goalInReach", minutesLeft: 30 } },
	{ streak: 0, todaySeconds: 0, weekMin: 300, goalMin: 300, hour: 11, expected: { kind: "goalReached" } },
	{ streak: 0, todaySeconds: 0, weekMin: 350, goalMin: 300, hour: 11, expected: { kind: "goalReached" } },
	{ streak: 0, todaySeconds: 1500, weekMin: 100, goalMin: 300, hour: 11, expected: { kind: "todayProgress", minutes: 25 } },
	{ streak: 0, todaySeconds: 0, weekMin: 50, goalMin: 300, hour: 10, expected: { kind: "none" } },
];

const nudgeResults = nudgeCases.map((c) => ({
	...c,
	result: jsNudge(c.streak, c.todaySeconds, c.weekMin, c.goalMin, c.hour),
}));

// Complete Golden Data
const goldenData = {
	merged: mergedResults,
	streaks: streakResults,
	weeks: weekResults,
	cycle: cycleResults,
	nudges: nudgeResults,
};

const jsonPath = path.join(outDir, "lernzeit.json");
fs.writeFileSync(jsonPath, JSON.stringify(goldenData, null, 2) + "\n", "utf8");
console.log("Wrote " + jsonPath + " (" + Buffer.byteLength(JSON.stringify(goldenData)) + " bytes)");
