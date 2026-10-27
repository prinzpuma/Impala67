// Erzeugt realistische Event-Logs (deterministisch per Seed) für Golden-Files und Messungen.
// Abgebildet ist, was ein echtes Log enthält: viele Inhalts-Patches je Seite, Heft-Striche mit
// Bildern, Karten, Einstellungen, UI-Zustand, Chats, Tagesartikel, Telemetrie, verspätete
// Fremd-Events (älteres t, neue seq) und Wire-Events ohne seq – plus lose geformte Altdaten.

export function rng(seed) {
	let s = seed >>> 0 || 1;
	return () => {
		s ^= s << 13; s >>>= 0;
		s ^= s >>> 17;
		s ^= s << 5; s >>>= 0;
		return s / 0x100000000;
	};
}

const T0 = Date.UTC(2025, 0, 1);

export function sampleLog(seed, n, { contentSize = 40 } = {}) {
	const r = rng(seed);
	const pick = (arr) => arr[Math.floor(r() * arr.length)];
	const int = (k) => Math.floor(r() * k);
	const text = (len) => "x".repeat(Math.max(1, Math.round(len * (0.5 + r()))));
	const pages = Array.from({ length: 4 + int(Math.max(4, n / 60)) }, (_, i) => "p" + seed + "-" + i);
	const cards = Array.from({ length: 3 + int(Math.max(3, n / 80)) }, (_, i) => "c" + seed + "-" + i);
	const chats = Array.from({ length: 2 + int(6) }, (_, i) => "chat-" + i);
	const hashes = Array.from({ length: 3 + int(10) }, (_, i) => "h" + seed.toString(16) + i.toString(16).padStart(8, "0"));
	let clock = T0 + int(1e9), seq = 0, articles = 0;
	const events = [];
	const iso = (ms) => new Date(ms).toISOString();
	const push = (type, payload, extra = {}) => {
		clock += 1 + int(r() < 0.1 ? 3_600_000 : 60_000);
		// Verspätetes Fremd-Event: älterer Zeitstempel, aber neue lokale seq.
		const late = r() < 0.06;
		const t = late ? iso(clock - int(86_400_000 * 5)) : r() < 0.01 && events.length ? events[events.length - 1].t : iso(clock);
		const ev = { id: "e" + seed + "-" + events.length, t, type, payload, ...extra };
		if (r() < 0.05) delete ev.seq; else ev.seq = ++seq;
		if (late) { ev._remote = true; ev._remoteSource = pick(["cloudflare", "drive"]); }
		events.push(ev);
	};
	const stroke = () => ({ id: "s" + int(1e6), pts: Array.from({ length: 4 + int(8) }, () => int(1000)), w: 2 });
	for (let i = 0; i < n; i++) {
		const roll = r();
		if (roll < 0.30) {
			const id = pick(pages), kind = r();
			const patch = kind < 0.6 ? { content: text(contentSize) }
				: kind < 0.75 ? { title: "Titel " + int(50) }
				: kind < 0.85 ? { content: text(contentSize), title: "T" + int(9), updated: iso(clock) }
				: kind < 0.92 ? { trashed: r() < 0.5 }
				: kind < 0.96 ? {}
				: { content: null, tags: ["a"] };
			push("pageUpdate", r() < 0.01 ? null : r() < 0.01 ? { id } : { id, patch });
		} else if (roll < 0.34) push("pageCreate", { id: pick(pages), title: "Neu", kind: pick(["note", "heft"]) });
		else if (roll < 0.36) push("pageDelete", r() < 0.05 ? null : { id: pick(pages) });
		else if (roll < 0.42) push("cardUpdate", { id: pick(cards), patch: pick([{ front: "f" + int(9) }, { back: "b" + int(9) }, { front: "f", back: "b" }, { due: iso(clock), ease: 2.5 }, { content: "nicht geschützt" }]) });
		else if (roll < 0.44) push("cardCreate", { id: pick(cards), deck: "d1", front: "f", back: "b" });
		else if (roll < 0.45) push("cardDelete", { id: pick(cards) });
		else if (roll < 0.48) push("cardReview", { id: pick(cards), grade: 1 + int(4) });
		else if (roll < 0.52) push("settingsSet", pick([{ theme: pick(["dark", "light"]) }, { aiModel: "m" + int(3) }, { theme: "dark", fontSize: 14 }, {}, { syncSecrets: false }]));
		else if (roll < 0.56) push("uiTabsSet", { tabs: [pick(pages), "chat:" + pick(chats)], active: 0 });
		else if (roll < 0.61) push("uiTreeSet", r() < 0.05 ? { open: true } : { key: pick(["root", "fach:Mathe", "fach:Physik", ...pages.slice(0, 5)]), open: r() < 0.5 });
		else if (roll < 0.65) {
			const updated = r() < 0.15 ? undefined : r() < 0.3 && events.length ? events[int(events.length)].t : iso(clock - int(3_600_000));
			push("chatUpsert", r() < 0.03 ? { title: "ohne id" } : { id: pick(chats), title: "Chat", created: iso(T0), updated, messages: [{ role: "user", text: text(contentSize / 2) }] });
		} else if (roll < 0.69) {
			const id = r() < 0.7 ? "art-" + articles++ : "art-" + int(Math.max(1, articles));
			const created = r() < 0.1 ? "" : r() < 0.2 ? iso(T0 + 86_400_000 * int(5)) : iso(clock - int(86_400_000));
			push("homeArticleUpsert", r() < 0.02 ? {} : { id, day: created.slice(0, 10), created, updated: r() < 0.3 ? iso(clock) : undefined, body: text(contentSize) });
		} else if (roll < 0.79) {
			const ops = Array.from({ length: 1 + int(4) }, () => r() < 0.7 ? { t: "s+", pg: 0, o: stroke() }
				: r() < 0.7 ? { t: "i+", pg: 0, o: { id: "i" + int(1e4), ref: pick(hashes), x: 0, y: 0 } }
				: r() < 0.5 ? { t: "s-", pg: 0, ids: ["s1"] } : null);
			push("heftOps", { pageId: pick(pages), ops });
		} else if (roll < 0.82) {
			const doc = { pages: Array.from({ length: 1 + int(3) }, () => ({ strokes: [stroke(), stroke()], images: r() < 0.6 ? [{ id: "i1", ref: pick(hashes) }, r() < 0.2 ? { id: "i2", src: "data:" } : null] : [] })) };
			push("heftSnap", { pageId: pick(pages), doc });
		} else if (roll < 0.86) push("heftBlob", { hash: pick(hashes), data: "data:image/png;base64," + text(contentSize) });
		else if (roll < 0.95) push("teleEvent", { name: pick(["open", "search", "ai"]), ms: int(500) });
		else push(pick(["learningSessionUpsert", "gradeAdd", "deckCreate", "pageMove", "chatDelete"]), { id: "x" + int(20), v: int(9) });
	}
	return events;
}
