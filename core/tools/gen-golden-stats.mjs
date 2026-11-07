// gen-golden-stats.mjs — Erzeugt golden/stats.json für `cargo test -p impala-model`
// aus der JS-Implementierung in web/anki-stats.js und web/telemetrie.js.

process.env.TZ = "UTC";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "../impala-model/tests/golden");
fs.mkdirSync(outDir, { recursive: true });

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
for (const key of ["window", "document", "Element", "Node", "HTMLElement", "MutationObserver", "navigator", "CustomEvent"]) {
	Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });

globalThis.__mockS = { reviews: [], cards: {}, telemetry: [] };
globalThis.__mockSTATE = {
	deckInTree(name, root) {
		if (!root || name === root) return true;
		return name.startsWith(root + "::");
	},
};

const hooks = `
export async function resolve(spec, ctx, next) {
	if (/(?:^|\\/)(db|state)\\.js$/.test(spec)) {
		return { url: "data:text/javascript," + encodeURIComponent("export const DB = { isOpen: () => false }; export const S = new Proxy({}, { get: (_, p) => globalThis.__mockS[p] }); export const STATE = globalThis.__mockSTATE;"), shortCircuit: true };
	}
	return next(spec, ctx);
}`;
register("data:text/javascript," + encodeURIComponent(hooks));

const { statsData } = await import("../../web/anki-stats.js");
const { TELE } = await import("../../web/telemetrie.js");

function dayKey(x) {
	const d = new Date(x);
	return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function computeHeatmap(d, now) {
	const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const start = new Date(end);
	start.setDate(start.getDate() - 364 - ((end.getDay() + 6) % 7));
	const cells = [];
	for (let x = new Date(start); x <= end; x.setDate(x.getDate() + 1)) {
		const k = dayKey(x);
		const n = d.perDay[k] || 0;
		const level = n === 0 ? 0 : n < 5 ? 1 : n < 15 ? 2 : n < 30 ? 3 : 4;
		cells.push({ date: k, n, level });
	}
	return cells;
}

// PRNG
function prng(seed) {
	let s = seed % 2147483647;
	if (s <= 0) s += 2147483646;
	return () => {
		s = (s * 16807) % 2147483647;
		return (s - 1) / 2147483646;
	};
}

const cases = [];

// Fall 1: Leer
{
	const now = new Date("2026-03-01T12:00:00.000Z");
	globalThis.__mockS = { reviews: [], cards: {}, telemetry: [] };
	const res = statsData({ cards: [], reviews: [], now, thinkMs: 0 });
	const hm = computeHeatmap(res, now);
	cases.push({
		name: "empty",
		now: now.toISOString(),
		deck: null,
		tzOffsetMinutes: 0,
		cards: [],
		reviews: [],
		telemetry: [],
		expected: {
			reviewsAll: res.reviewsAll,
			last: res.last.length,
			rate: res.rate,
			trend: res.trend,
			avg: res.avg,
			bestand: res.bestand,
			n: res.n,
			faellig: res.faellig,
			reif: res.reif,
			gelernt: res.gelernt,
			decks: res.decks,
			series: res.series.map((s) => ({ date: s.k, n: s.n })),
			peak: { date: res.peak.k, n: res.peak.n },
			forecast: res.forecast.map((f, i) => ({ dayOffset: i, n: f.n })),
			streakCurrent: res.streak.current,
			streakLongest: res.streak.longest,
			hard: [],
			thinkMs: 0,
			retention: res.retention,
			heatmap: hm,
			perDay: res.perDay,
		},
	});
}

// Fall 2: Wenige Karten und Reviews (< 10 Reviews)
{
	const now = new Date("2026-03-15T10:00:00.000Z");
	const cards = [
		{ id: "c1", front: "Frage 1", deck: "Standard", srs: { state: "new", due: "2026-03-15T08:00:00.000Z" } },
		{ id: "c2", front: "Frage 2", deck: "Standard", srs: { state: "review", stability: 25, lapses: 2, due: "2026-03-14T08:00:00.000Z" } },
		{ id: "c3", front: "Frage 3", deck: "Standard", srs: { state: "learning", stability: 5, due: "2026-03-16T08:00:00.000Z" } },
		{ id: "c4", front: "Frage 4", deck: "Standard", suspended: true, srs: { state: "review", stability: 30, due: "2026-03-10T08:00:00.000Z" } },
	];
	const reviews = [
		{ id: "r1", cardId: "c2", deck: "Standard", t: "2026-03-10T12:00:00.000Z", grade: 3, first: false, learning: false, intervalDays: 3 },
		{ id: "r2", cardId: "c2", deck: "Standard", t: "2026-03-14T12:00:00.000Z", grade: 4, first: false, learning: false, intervalDays: 4 },
		{ id: "r3", cardId: "c3", deck: "Standard", t: "2026-03-15T09:00:00.000Z", grade: 2, first: false, learning: true, intervalDays: 1 },
	];
	const cardsMap = {};
	for (const c of cards) cardsMap[c.id] = c;
	globalThis.__mockS = { reviews, cards: cardsMap, telemetry: [] };
	const res = statsData({ cards, reviews, now, thinkMs: 2500 });
	const hm = computeHeatmap(res, now);
	cases.push({
		name: "few_cards_and_reviews",
		now: now.toISOString(),
		deck: null,
		tzOffsetMinutes: 0,
		cards,
		reviews,
		telemetry: [],
		expected: {
			reviewsAll: res.reviewsAll,
			last: res.last.length,
			rate: res.rate,
			trend: res.trend,
			avg: res.avg,
			bestand: res.bestand,
			n: res.n,
			faellig: res.faellig,
			reif: res.reif,
			gelernt: res.gelernt,
			decks: res.decks,
			series: res.series.map((s) => ({ date: s.k, n: s.n })),
			peak: { date: res.peak.k, n: res.peak.n },
			forecast: res.forecast.map((f, i) => ({ dayOffset: i, n: f.n })),
			streakCurrent: res.streak.current,
			streakLongest: res.streak.longest,
			hard: res.hard.map((c) => ({ id: c.id, front: c.front, deck: c.deck || "Standard", lapses: c.srs.lapses || 0, stability: c.srs.stability || 0 })),
			thinkMs: 2500,
			retention: res.retention,
			heatmap: hm,
			perDay: res.perDay,
		},
	});
}

// Fall 3: Reichhaltiger Datensatz mit mehreren Decks, Telemetrie und Retention
{
	const rand = prng(12345);
	const now = new Date("2026-04-10T14:30:00.000Z");
	const decks = ["Standard", "Mathe", "Mathe::Analysis", "Physik", "Bio"];
	const cards = [];
	for (let i = 0; i < 40; i++) {
		const deck = decks[Math.floor(rand() * decks.length)];
		const suspended = rand() < 0.1;
		const state = rand() < 0.25 ? "new" : rand() < 0.4 ? "learning" : "review";
		const stability = state === "review" ? 1 + rand() * 40 : rand() * 5;
		const lapses = Math.floor(rand() * 8);
		// due: zwischen now - 5 Tagen und now + 10 Tagen
		const dueOffsetDays = Math.floor(rand() * 15) - 5;
		const due = new Date(now.getTime() + dueOffsetDays * 86_400_000).toISOString();
		cards.push({
			id: "c" + i,
			front: `Karte ${i} Vorderseite {{c1::Lücke}} mit etwas Text`,
			deck,
			suspended,
			srs: { state, stability, lapses, due },
		});
	}

	const reviews = [];
	let revId = 0;
	// Reviews über die letzten 70 Tage verteilen
	for (let dayAgo = 70; dayAgo >= 0; dayAgo--) {
		const count = Math.floor(rand() * 4); // 0..3 Reviews an diesem Tag
		for (let j = 0; j < count; j++) {
			const card = cards[Math.floor(rand() * cards.length)];
			const t = new Date(now.getTime() - dayAgo * 86_400_000 + j * 3_600_000).toISOString();
			const grade = Math.floor(rand() * 4) + 1; // 1..4
			const first = rand() < 0.1;
			const learning = rand() < 0.15;
			const intervalDays = [1, 2.8, 3.2, 6.8, 7.5, 13.5, 14.2, 21][Math.floor(rand() * 8)];
			reviews.push({
				id: "r" + (++revId),
				cardId: card.id,
				deck: card.deck,
				t,
				grade,
				first,
				learning,
				intervalDays,
			});
		}
	}

	// Telemetrie: 20 review events mit thinkMs
	const telemetry = [];
	for (let i = 0; i < 25; i++) {
		telemetry.push({
			id: "tel" + i,
			kind: "review",
			t: new Date(now.getTime() - i * 3_600_000).toISOString(),
			data: {
				grade: 3,
				thinkMs: 1000 + Math.floor(rand() * 4000),
				typed: false,
			},
		});
	}
	// Undo-Event
	telemetry.push({
		id: "tel_undo",
		kind: "reviewUndo",
		t: new Date(now.getTime() - 2_000_000).toISOString(),
		data: { reviewId: "tel24" },
	});

	const cardsMap = {};
	for (const c of cards) cardsMap[c.id] = c;
	globalThis.__mockS = { reviews, cards: cardsMap, telemetry };

	const thinkMs = TELE.thinkMedian();

	// Test 3a: Alle Decks
	{
		const res = statsData({ cards, reviews, now, thinkMs });
		const hm = computeHeatmap(res, now);
		cases.push({
			name: "rich_dataset_all_decks",
			now: now.toISOString(),
			deck: null,
			tzOffsetMinutes: 0,
			cards,
			reviews,
			telemetry,
			expected: {
				reviewsAll: res.reviewsAll,
				last: res.last.length,
				rate: res.rate,
				trend: res.trend,
				avg: res.avg,
				bestand: res.bestand,
				n: res.n,
				faellig: res.faellig,
				reif: res.reif,
				gelernt: res.gelernt,
				decks: res.decks,
				series: res.series.map((s) => ({ date: s.k, n: s.n })),
				peak: { date: res.peak.k, n: res.peak.n },
				forecast: res.forecast.map((f, i) => ({ dayOffset: i, n: f.n })),
				streakCurrent: res.streak.current,
				streakLongest: res.streak.longest,
				hard: res.hard.map((c) => ({ id: c.id, front: c.front, deck: c.deck || "Standard", lapses: c.srs.lapses || 0, stability: c.srs.stability || 0 })),
				thinkMs,
				retention: res.retention,
				heatmap: hm,
				perDay: res.perDay,
			},
		});
	}

	// Test 3b: Gefiltert auf Deck "Mathe" (inkl. "Mathe::Analysis")
	{
		const matheCards = cards.filter((c) => c.deck === "Mathe" || c.deck === "Mathe::Analysis");
		const matheReviews = reviews.filter((r) => r.deck === "Mathe" || r.deck === "Mathe::Analysis");
		const res = statsData({ cards: matheCards, reviews: matheReviews, now, thinkMs });
		const hm = computeHeatmap(res, now);
		cases.push({
			name: "rich_dataset_mathe_deck",
			now: now.toISOString(),
			deck: "Mathe",
			tzOffsetMinutes: 0,
			cards,
			reviews,
			telemetry,
			expected: {
				reviewsAll: res.reviewsAll,
				last: res.last.length,
				rate: res.rate,
				trend: res.trend,
				avg: res.avg,
				bestand: res.bestand,
				n: res.n,
				faellig: res.faellig,
				reif: res.reif,
				gelernt: res.gelernt,
				decks: res.decks,
				series: res.series.map((s) => ({ date: s.k, n: s.n })),
				peak: { date: res.peak.k, n: res.peak.n },
				forecast: res.forecast.map((f, i) => ({ dayOffset: i, n: f.n })),
				streakCurrent: res.streak.current,
				streakLongest: res.streak.longest,
				hard: res.hard.map((c) => ({ id: c.id, front: c.front, deck: c.deck || "Standard", lapses: c.srs.lapses || 0, stability: c.srs.stability || 0 })),
				thinkMs,
				retention: res.retention,
				heatmap: hm,
				perDay: res.perDay,
			},
		});
	}
}

// Fall 4: Schaltjahr 2028
{
	const now = new Date("2028-02-29T12:00:00.000Z");
	const cards = [
		{ id: "c1", front: "Schaltjahr", deck: "Standard", srs: { state: "review", stability: 25, lapses: 1, due: "2028-02-29T08:00:00.000Z" } },
		{ id: "c2", front: "März", deck: "Standard", srs: { state: "new", due: "2028-03-01T08:00:00.000Z" } },
	];
	const reviews = [
		{ id: "r1", cardId: "c1", deck: "Standard", t: "2028-02-28T10:00:00.000Z", grade: 3, first: false, learning: false, intervalDays: 1 },
		{ id: "r2", cardId: "c1", deck: "Standard", t: "2028-02-29T10:00:00.000Z", grade: 3, first: false, learning: false, intervalDays: 1 },
	];
	const cardsMap = {};
	for (const c of cards) cardsMap[c.id] = c;
	globalThis.__mockS = { reviews, cards: cardsMap, telemetry: [] };
	const res = statsData({ cards, reviews, now, thinkMs: 0 });
	const hm = computeHeatmap(res, now);
	cases.push({
		name: "leap_year_2028",
		now: now.toISOString(),
		deck: null,
		tzOffsetMinutes: 0,
		cards,
		reviews,
		telemetry: [],
		expected: {
			reviewsAll: res.reviewsAll,
			last: res.last.length,
			rate: res.rate,
			trend: res.trend,
			avg: res.avg,
			bestand: res.bestand,
			n: res.n,
			faellig: res.faellig,
			reif: res.reif,
			gelernt: res.gelernt,
			decks: res.decks,
			series: res.series.map((s) => ({ date: s.k, n: s.n })),
			peak: { date: res.peak.k, n: res.peak.n },
			forecast: res.forecast.map((f, i) => ({ dayOffset: i, n: f.n })),
			streakCurrent: res.streak.current,
			streakLongest: res.streak.longest,
			hard: res.hard.map((c) => ({ id: c.id, front: c.front, deck: c.deck || "Standard", lapses: c.srs.lapses || 0, stability: c.srs.stability || 0 })),
			thinkMs: 0,
			retention: res.retention,
			heatmap: hm,
			perDay: res.perDay,
		},
	});
}

const outFile = path.join(outDir, "stats.json");
fs.writeFileSync(outFile, JSON.stringify(cases, null, 2), "utf8");
console.log(`Golden-File geschrieben nach ${outFile} (${cases.length} Fälle, ${(fs.statSync(outFile).size / 1024).toFixed(1)} KB)`);
