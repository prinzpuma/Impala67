// Zufällige, aber realistische Event-Folgen über ALLE Reducer-Event-Typen (deterministisch per
// Seed) für Golden-Files und Messungen von impala-model. Enthält Grenzfälle, die echte Logs
// haben: fehlende/leere Felder, null, Zahlen als Text, verspätete Fremd-Events (älteres t),
// gleiche Zeitstempel, Zyklen im Seitenbaum, Umbenennen von Stapeln auf sich selbst, unbekannte
// Event-Typen (Bilddaten inhaltsadressiert: gleicher Hash = gleiche Daten). Bewusst NICHT: Zahlen als IDs oder Nicht-Objekte als Patch (siehe Bericht).
import { rng } from "./sample-log.mjs";

export function modelEvents(seed, n, opts = {}) {
	const r = rng(seed);
	const chance = (p) => r() < p;
	const int = (k) => Math.floor(r() * k);
	const pick = (arr) => arr[Math.floor(r() * arr.length)];
	const nPages = opts.pages ?? 14;
	const pages = Array.from({ length: nPages }, (_, i) => "p" + i);
	const cards = Array.from({ length: opts.cards ?? 12 }, (_, i) => "c" + i);
	const decks = ["Standard", "Mathe", "Mathe::Analysis", "Mathe::Analysis::Folgen", "Physik", "Bio::Zellen", "10", "2"];
	const folders = ["f0", "f1", "f2", "f3"];
	const chats = ["ch0", "ch1", "ch2"];
	const sessions = ["s0", "s1", "s2"];
	const hashes = ["h0", "h1", "h2", "h3"];
	const heftPages = ["hp0", "hp1", "hp2"];
	const titles = ["Mathe", "Physik", "Analysis", "Ohne Titel", "", "Notizen zu Mathe", "Blatt 3", "⚠ Konflikt: Mathe — Stand 2026-03-01 10:00", "Zellen"];
	const reviewIds = [];
	let clock = Date.UTC(2026, 2, 1, 7, 0, 0) + (opts.offsetMs || 0);
	const events = [];
	const iso = (ms) => new Date(ms).toISOString();
	const late = opts.late ?? 0.05;
	const push = (type, payload) => {
		clock += 1000 + int(opts.stepMs ?? 900_000);
		const roll = r();
		const t = roll < late ? iso(clock - int(3 * 86_400_000)) : roll < late + 0.03 && events.length ? events[events.length - 1].t : iso(clock);
		events.push({ id: `e${seed}-${events.length}`, t, type, payload, seq: events.length + 1 });
	};
	const text = () => Array.from({ length: 1 + int(4) }, () => pick(["Zeile", "Mathe ist schön", "Physik", "", "  Analysis  ", "Folgen und Reihen", "Zellen"]) + " " + int(5)).join("\n");
	const around = (spread) => iso(clock + int(2 * spread) - spread);
	const srs = () => ({
		state: pick(["new", "learning", "review", "relearning", "review"]),
		stability: pick([0, 2.5, 10]), difficulty: pick([5, 6.25]), due: around(2 * 86_400_000),
		reps: int(6), lapses: pick([0, 1, 3, 8, 9]), step: int(2), last: chance(0.5) ? around(86_400_000) : null,
	});
	const point = () => [int(800), int(1100), pick([0.5, 0.25, 1])];
	const stroke = (id) => ({ id: id || "s" + int(30), tool: pick(["pen", "marker", "highlighter"]), color: pick(["#111111", "#d22"]), size: pick([2, 3.5]), pts: Array.from({ length: 1 + int(5) }, point) });
	const image = (id) => ({ id: id || "i" + int(10), ref: pick(hashes), x: int(500), y: int(500), w: 100, h: 80 });
	const textBox = (id) => ({ id: id || "x" + int(10), x: int(500), y: int(500), w: 200, text: pick(["Notiz", "Formel", ""]) });
	const heftOp = () => {
		const p = pick(heftPages);
		switch (int(16)) {
			case 0: return { t: "pg+", page: { id: p, ...(chance(0.6) ? { paper: pick(["lined", "grid", "blank"]) } : {}) }, ...(chance(0.4) ? { at: int(3) } : {}) };
			case 1: return { t: "pg-", p };
			case 2: return { t: "pgo", order: [...heftPages].sort(() => r() - 0.5).slice(0, 1 + int(3)) };
			case 3: return { t: "pgp", p, paper: pick(["grid", "dotted", ""]) };
			case 4: return { t: "ocr", p, text: pick(["Mathe Formel", "", "Zellen teilen"]) };
			case 5: case 6: return { t: "s+", p, o: stroke() };
			case 7: return { t: "s=", p, o: stroke() };
			case 8: return { t: "s-", p, ids: ["s" + int(30), "s" + int(30)] };
			case 9: return { t: "i+", p, o: image() };
			case 10: return { t: "i=", p, o: image() };
			case 11: return { t: "i-", p, ids: ["i" + int(10)] };
			case 12: return { t: "x+", p, o: textBox() };
			case 13: return { t: "x=", p, o: textBox() };
			case 14: return { t: "x-", p, ids: ["x" + int(10)] };
			default: return pick([null, { t: "zz", p }, {}]);
		}
	};
	const providers = () => [
		{ id: "cloudflare", name: "Impala AI", base: "https://x", key: pick(["", "cf-key", null]) },
		{ id: "openai", name: "OpenAI", base: "https://api.openai.com/v1", key: pick(["", "  ", "sk-1", null, undefined]) },
		...(chance(0.3) ? [{ id: "eigen", name: "Eigen", base: "http://e" }] : []),
	];
	const tabs = () => {
		const list = Array.from({ length: int(15) }, () => pick([...pages, "chat:" + pick(chats), "nlm:main", "anki:main", "x:y", 5, pick(pages)]));
		return list;
	};
	const gens = [
		[18, () => push("pageUpdate", chance(0.02) ? pick([null, { id: pick(pages) }]) : {
			id: pick(pages),
			patch: pick([
				{ content: text() }, { content: text() }, { title: pick(titles) }, { content: text(), title: pick(titles) },
				{ trashed: chance(0.5) }, { parentId: chance(0.3) ? null : pick(pages) }, { order: int(100) },
				{ workspaceId: pick(["default", "ws1"]) }, { favorite: true }, { archived: false }, { tags: ["a", "b"] },
				{}, { icon: null }, { kind: "heft" }, { updated: "2020-01-01T00:00:00.000Z" },
			]),
		})],
		[5, () => push("pageCreate", chance(0.03) ? pick([{}, { title: "ohne id" }]) : {
			id: pick(pages),
			title: pick([...titles, undefined]),
			...(chance(0.7) ? { parentId: chance(0.5) ? pick(pages) : null } : {}),
			...(chance(0.8) ? { content: text() } : {}),
			...(chance(0.6) ? { kind: pick(["heft", "notion", "goodnotes"]) } : {}),
			...(chance(0.5) ? { workspaceId: pick(["default", "ws1", ""]) } : {}),
			...(chance(0.3) ? { order: int(1000) } : {}),
			...(chance(0.3) ? { tags: ["x"] } : {}),
			...(chance(0.2) ? { icon: "📘", cover: "c", props: { a: 1 }, daily: "2026-03-01" } : {}),
			...(chance(0.3) ? { gnFolderId: pick(folders), gnOrder: int(9) } : {}),
			...(chance(0.6) ? { created: around(86_400_000) } : {}),
		})],
		[3, () => push("pageMove", { id: pick(pages), ...(chance(0.8) ? { parentId: chance(0.3) ? null : pick(pages) } : {}), ...(chance(0.4) ? { order: int(100) } : {}) })],
		[1, () => push("pageDelete", chance(0.05) ? {} : { id: pick(pages) })],
		[2, () => push("pageTrash", { id: pick(pages) })],
		[2, () => push("pageRestore", { id: pick(pages) })],
		[2, () => push("pageArchive", { id: pick(pages) })],
		[2, () => push("pageUnarchive", { id: pick(pages) })],
		[2, () => push("learningSessionUpsert", {
			id: pick(sessions), startedAt: around(3_600_000), ...(chance(0.7) ? { endedAt: around(3_600_000) } : {}),
			durationSeconds: pick([60, 125.6, "300", -5, "abc", undefined, 59.5]),
			...(chance(0.5) ? { segments: [{ startedAt: around(1e6), endedAt: around(1e6) }, { startedAt: "" }, null, 5] } : {}),
			...(chance(0.5) ? { category: pick(["focus", ""]) } : {}),
			...(chance(0.7) ? { subject: pick([null, "  Mathe  ", "y".repeat(100), ""]) } : {}),
			...(chance(0.5) ? { subjectSource: pick(["manual", null, "z".repeat(30)]) } : {}),
			...(chance(0.3) ? { sourceId: pick(pages) } : {}),
			...(chance(0.7) ? { updated: around(3 * 3_600_000) } : {}),
		})],
		[1, () => push("learningSessionDelete", { id: pick(sessions), ...(chance(0.6) ? { updated: around(3 * 3_600_000) } : {}) })],
		[3, () => push("teleEvent", { ...(chance(0.5) ? { id: "tel" + int(9) } : {}), kind: pick(["review", "studyStart", "", 5]), ...(chance(0.5) ? { data: { a: int(5) } } : {}) })],
		[1, () => push("gradeAdd", { id: "g" + int(4), subject: pick(["Mathe", " Physik ", "", undefined]), grade: pick([1, 2.5, "3", 7, 0, "x", undefined, -1]), ...(chance(0.6) ? { weight: pick([2, 0, "0.1", "abc", 0.5]) } : {}), ...(chance(0.5) ? { date: "2026-02-01" } : {}), ...(chance(0.5) ? { comment: "gut" } : {}) })],
		[1, () => push("gradeDelete", { id: "g" + int(4) })],
		[4, () => push("cardCreate", chance(0.02) ? {} : {
			id: pick(cards), ...(chance(0.9) ? { front: pick(["F", null, "Was ist Mathe?"]) } : {}), back: "B",
			...(chance(0.8) ? { deck: pick([...decks, ""]) } : {}), ...(chance(0.4) ? { pageId: pick(pages) } : {}),
			...(chance(0.2) ? { type: "cloze", cloze: { n: 1 } } : {}), ...(chance(0.5) ? { srs: srs() } : {}),
		})],
		[8, () => {
			const reviewId = chance(0.6) ? "rv" + int(1e6) : undefined;
			if (reviewId) reviewIds.push(reviewId);
			push("cardReview", {
				id: pick(cards), ...(chance(0.95) ? { srs: srs() } : {}), grade: pick([1, 1, 2, 3, 4, undefined]),
				...(chance(0.5) ? { first: pick([null, true, false]) } : {}), ...(chance(0.4) ? { learning: pick([true, false]) } : {}),
				...(reviewId ? { reviewId } : {}), ...(chance(0.3) ? { deck: pick(decks) } : {}),
				...(chance(0.3) ? { subject: pick([" Mathe ", "", "q".repeat(90)]) } : {}), ...(chance(0.2) ? { subjectSource: "auto" } : {}),
				...(chance(0.4) ? { dueAt: around(86_400_000) } : {}), ...(chance(0.3) ? { previousReviewAt: around(86_400_000) } : {}),
				...(chance(0.5) ? { intervalDays: pick([null, 3, "2.5", "x", 0]) } : {}),
			});
		}],
		[2, () => push("cardReviewUndo", { id: pick(cards), ...(chance(0.9) ? { srs: srs() } : {}), unsuspend: chance(0.5), ...(chance(0.5) && reviewIds.length ? { reviewId: pick(reviewIds) } : {}) })],
		[4, () => push("cardUpdate", { id: pick(cards), patch: pick([{ front: "F2" }, { deck: pick(decks) }, { suspended: true }, { suspended: false }, { srs: srs() }, { archived: true }, { extra: [1, 2] }, {}, { trashed: false }]) })],
		[1, () => push("cardArchive", { id: pick(cards) })],
		[1, () => push("cardUnarchive", { id: pick(cards) })],
		[1, () => push("cardTrash", { id: pick(cards) })],
		[1, () => push("cardRestore", { id: pick(cards) })],
		[1, () => push("cardDelete", { id: pick(cards) })],
		[1, () => push("deckCreate", chance(0.1) ? {} : { name: pick([...decks, "Neu"]) })],
		[1, () => push("deckRename", { from: pick(decks), to: pick([...decks, "Neu", "Mathe::Neu", "Ana"]) })],
		[1, () => push("deckReorder", { name: pick(decks), ...(chance(0.8) ? { order: pick([int(10), "3"]) } : {}) })],
		[1, () => push("deckArchive", { name: pick(decks) })],
		[1, () => push("deckUnarchive", { name: pick(decks) })],
		[1, () => push("deckTrash", { name: pick(decks) })],
		[1, () => push("deckRestore", { name: pick(decks) })],
		[0.5, () => push("deckDelete", { name: pick(decks) })],
		[1, () => push("deckMove", { from: pick(decks), ...(chance(0.8) ? { target: pick(["", ...decks]) } : {}) })],
		[0.5, () => push("deckDuplicate", { name: pick(decks) })],
		[0.5, () => push("workspaceCreate", { id: pick(["ws1", "ws2"]), ...(chance(0.5) ? { name: "Uni" } : {}) })],
		[1, () => push("gnFolderCreate", { id: pick(folders), ...(chance(0.5) ? { title: "Ordner" } : {}), ...(chance(0.6) ? { parentId: pick([null, ...folders]) } : {}), ...(chance(0.5) ? { order: int(9) } : {}) })],
		[1, () => push("gnFolderMove", { id: pick(folders), parentId: pick([null, ...folders]), ...(chance(0.5) ? { order: int(9) } : {}) })],
		[1, () => push("gnItemMove", { id: pick(pages), folderId: pick([null, ...folders, "fehlt"]), ...(chance(0.5) ? { order: int(9) } : {}) })],
		[0.5, () => push("gnFolderDelete", { id: pick(folders) })],
		[10, () => push("heftOps", chance(0.03) ? pick([{ pageId: pick(pages) }, { pageId: pick(pages), ops: [] }, { ops: [heftOp()] }]) : { pageId: pick(pages), ops: Array.from({ length: 1 + int(4) }, heftOp) })],
		[1.5, () => push("heftSnap", chance(0.1) ? pick([{ pageId: pick(pages) }, { pageId: pick(pages), doc: {} }]) : {
			pageId: pick(pages),
			doc: { pages: heftPages.slice(0, 1 + int(3)).map((id) => ({ id, ...(chance(0.7) ? { paper: pick(["lined", "grid"]) } : {}), strokes: [stroke("s1"), stroke()], images: chance(0.5) ? [image("i1")] : [], ...(chance(0.5) ? { texts: [textBox("x1")] } : {}), ...(chance(0.5) ? { ocrText: "Mathe Heft" } : {}) })) },
		})],
		[1.5, () => { const hash = pick(hashes); push("heftBlob", chance(0.1) ? { hash } : { hash, data: "data:image/png;base64," + "A".repeat(4 + 7 * hashes.indexOf(hash)) }); }],
		[3, () => push("chatUpsert", {
			id: pick(chats), ...(chance(0.95) ? { messages: [{ role: "user", text: text() }] } : { messages: "x" }),
			...(chance(0.5) ? { title: "Chat" } : {}), ...(chance(0.5) ? { created: around(86_400_000) } : {}),
			...(chance(0.6) ? { updated: around(3_600_000) } : {}),
		})],
		[1, () => push("chatDelete", { id: pick(chats), ...(chance(0.5) ? { deletedAt: around(3_600_000) } : {}) })],
		[1.5, () => push("homeArticleUpsert", {
			id: "a" + int(4), body: pick(["Artikeltext", "", undefined, 5, "Mehr Text"]), day: "2026-03-01",
			...(chance(0.6) ? { created: pick(["", around(86_400_000)]) } : {}), ...(chance(0.5) ? { updated: around(86_400_000) } : {}),
			...(chance(0.3) ? { readAt: around(1e6) } : {}), ...(chance(0.5) ? { topics: ["a", 1, null] } : {}),
			...(chance(0.3) ? { focus: "Mathe" } : {}), ...(chance(0.5) ? { title: "Artikel" } : {}),
			...(chance(0.5) ? { sources: [{ id: "q1", url: "u" }, null, { x: 1 }] } : {}),
		})],
		[3, () => push("uiTreeSet", { ...(chance(0.95) ? { key: pick([...pages, "ws:default", "ws:ws1", "fach:Mathe"]) } : {}), open: chance(0.5) })],
		[3, () => push("uiTabsSet", { tabs: tabs(), ...(chance(0.7) ? { activeTabId: pick([...pages, "nlm:main", "fehlt"]) } : {}) })],
		[3, () => push("settingsSet", pick([
			{ theme: pick(["dark", "light"]) }, { aiProviders: providers() }, { syncSecrets: true }, { notionToken: "tok" }, {},
			{ deckConf: { "*": { newPerDay: pick([2, 3]) }, Mathe: { revPerDay: pick([3, "4"]), leechThreshold: pick([2, 3]), leechAction: pick(["suspend", "tag"]) }, ...(chance(0.5) ? { "Mathe::Analysis": { newPerDay: 1 } } : {}) } },
			{ aiProviders: [{ id: "openai", key: null }] }, { aiModel: "m" + int(3), customInstructions: "kurz" },
		]))],
		[1, () => push(pick(["heftUpdated", "futureThing", "noteLink"]), { id: pick(pages), pageId: pick(pages), x: 1 })],
	];
	const total = gens.reduce((s, [w]) => s + w, 0);
	for (let i = 0; i < n; i++) {
		let x = r() * total;
		for (const [w, g] of gens) {
			x -= w;
			if (x < 0) { g(); break; }
		}
		if (x >= 0) gens[0][1]();
	}
	return events;
}
