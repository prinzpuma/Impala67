"use strict";
import { S, STATE } from "./state.js";
import { SRS } from "./srs.js";
import { AI } from "./ai.js";
import { TABS } from "./tabs.js";
import { U } from "./util.js";

// graph.js — 🕸 Wissensgraph v1 (Phase 4, erster Ausbauschritt).
// Knoten = Notiz-Seiten · Kanten = Seitenbaum (parentId) + Titel-Erwähnungen
// (Seite A erwähnt den Titel von Seite B im Inhalt — dieselbe robuste Logik
// wie backlinksOf() in state.js) · Färbung = Ø-FSRS-Abrufbarkeit der Karten
// je Seite (grün = sitzt · orange = wacklig · rot = (über)fällig · grau = ohne
// Karten). v2 (KI-Ausbau, Phase 4): 🤖 Entitäten-/Relationen-Extraktion
// (violette Begriff-Knoten, Cache in localStorage — braucht KEIN Embedding-
// Modell, nur AI.complete), 🧩 Synthese-Fragen zwischen schwach verbundenen
// Clustern und 🧠 Mapping-Karten (fehlende Kanten als FSRS-Karten).
// Muster wie telemetrie.js/experimente.js: eigenes Overlay + eigener Capture-
// Listener auf #btnGraph — app.js und render.js bleiben unangetastet.
export const GRAPH = (() => {
	let overlay = null, cv = null, ctx = null, raf = 0, running = false;
	let nodes = [], edges = [], byId = Object.create(null);
	let view = { x: 0, y: 0, k: 1 };
	let drag = null, hover = null, filter = "", ticks = 0;
	let goal = null; // sanft angesteuerte Zielansicht { x, y, k } — loop() interpoliert dorthin

	// ---------- Daten ----------
	function activePages() {
		return Object.values(S.pages).filter((p) => p && !p.trashed && (p.title || "").trim());
	}
	// Ø-Abrufbarkeit der Karten einer Seite (0..1) oder null ohne bewertete Karten.
	// Verstrichene Zeit wird aus Fälligkeit + Stabilität genähert — reicht für die Heatmap.
	function pageHeat(pageId) {
		const now = Date.now();
		let sum = 0, n = 0;
		Object.values(S.cards).forEach((c) => {
			if (!c || c.trashed || c.pageId !== pageId || !c.srs || c.srs.state === "new") return;
			const dueIn = (new Date(c.srs.due).getTime() - now) / 864e5; // Tage bis fällig (negativ = überfällig)
			const stab = Math.max(0.1, c.srs.stability || 0.5);
			try { sum += SRS.retrievability(Math.max(0, stab - dueIn), stab); n++; } catch (err) { /* egal */ }
		});
		return n ? sum / n : null;
	}
	function heatColor(r) {
		if (r == null) return "#7c8188";
		const stops = [[224, 72, 62], [242, 163, 60], [53, 160, 95]]; // rot → orange → grün
		const t = Math.max(0, Math.min(1, r)) * 2;
		const i = t < 1 ? 0 : 1, f = t - i;
		const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
		return "rgb(" + c.join(",") + ")";
	}
	function build() {
		const pages = activePages();
		byId = Object.create(null);
		nodes = pages.map((p, i) => {
			// Sonnenblumen-Startlayout: gleichmäßig verteilt, keine Startkollisionen
			const golden = i * 2.399963;
			const rad = 40 + 14 * Math.sqrt(i);
			const n = {
				id: p.id, title: p.title, heat: pageHeat(p.id), len: (p.content || "").length,
				x: Math.cos(golden) * rad, y: Math.sin(golden) * rad, vx: 0, vy: 0, deg: 0,
			};
			byId[p.id] = n;
			return n;
		});
		edges = [];
		const seen = new Set();
		const addEdge = (a, b, kind) => {
			if (!a || !b || a === b || !byId[a] || !byId[b]) return;
			const key = a < b ? a + "|" + b : b + "|" + a;
			if (seen.has(key)) return;
			seen.add(key);
			edges.push({ a, b, kind });
			byId[a].deg++; byId[b].deg++;
		};
		pages.forEach((p) => addEdge(p.id, p.parentId, "tree"));
		// Erwähnungs-Kanten: Titel (≥ 4 Zeichen) kommt im Inhalt einer anderen Seite vor.
		// Schutz: bei sehr großen Workspaces nur Hierarchie (der O(n²)-Scan wäre zu teuer).
		if (pages.length <= 500) {
			const lowered = pages.map((p) => ({ id: p.id, c: (p.content || "").toLowerCase() }));
			pages.forEach((p) => {
				const t = (p.title || "").trim().toLowerCase();
				if (t.length < 4) return;
				lowered.forEach((o) => { if (o.id !== p.id && o.c.includes(t)) addEdge(o.id, p.id, "link"); });
			});
		}
		// 🧠 Gecachte KI-THEMEN als Knoten einhängen (runTopics füllt den Cache).
		// Färbung kommt NUR aus den Karteikarten (FSRS-Abrufbarkeit); Seiten-Kanten
		// laufen über Page-IDs statt über den fragilen Titel-Abgleich von v1.
		const ki = kiCache();
		if (ki && Array.isArray(ki.topics)) {
			// 📚 Fächer (= Anki-Stapel) als große Hub-Knoten, die Unterthemen hängen daran
			const faecher = [...new Set(ki.topics.map((tp) => String(tp.fach || "").trim()).filter(Boolean))];
			faecher.forEach((f, i) => {
				const cardIds = ki.topics.filter((tp) => String(tp.fach || "").trim() === f).reduce((a2, tp) => a2.concat(tp.cardIds || []), []);
				const golden = i * 2.399963, rad = 18 + 10 * Math.sqrt(i + 1);
				const n = { id: "fach:" + f, title: f, kind: "fach", heat: topicHeat(cardIds),
					len: 1200 + cardIds.length * 500, cards: cardIds.length,
					x: Math.cos(golden) * rad, y: Math.sin(golden) * rad, vx: 0, vy: 0, deg: 0 };
				byId[n.id] = n; nodes.push(n);
			});
			ki.topics.forEach((tp, i) => {
				const name = String(tp.name || "").trim();
				if (!name || byId["topic:" + name]) return;
				const golden = i * 2.399963, rad = 26 + 12 * Math.sqrt(i + 1);
				const n = { id: "topic:" + name, title: name, kind: "topic", heat: topicHeat(tp.cardIds),
					len: 600 + (tp.cardIds || []).length * 400, cards: (tp.cardIds || []).length, fach: String(tp.fach || "").trim(),
					x: Math.cos(golden) * rad, y: Math.sin(golden) * rad, vx: 0, vy: 0, deg: 0 };
				byId[n.id] = n; nodes.push(n);
				if (n.fach) addEdge(n.id, "fach:" + n.fach, "tree"); // Fach → Unterthema
				(tp.pageIds || []).forEach((pid2) => addEdge(n.id, pid2, "ki"));
			});
			ki.topics.forEach((tp) => (tp.near || []).forEach((o2) => addEdge("topic:" + String(tp.name || "").trim(), "topic:" + String(o2).trim(), "ki")));
		} else if (ki && Array.isArray(ki.entities)) {
			// Alt-Cache (v1-Entitäten) weiter anzeigen, bis die erste Themen-Analyse gelaufen ist
			const titleTo = {};
			pages.forEach((p) => { titleTo[(p.title || "").trim().toLowerCase()] = p.id; });
			ki.entities.forEach((ent, i) => {
				const name = String(ent.name || "").trim();
				if (!name || byId["ent:" + name]) return;
				const golden = i * 2.399963, rad = 30 + 10 * Math.sqrt(i + 1);
				const n = { id: "ent:" + name, title: name, kind: "entity", heat: null, len: 900,
					x: Math.cos(golden) * rad, y: Math.sin(golden) * rad, vx: 0, vy: 0, deg: 0 };
				byId[n.id] = n; nodes.push(n);
				(ent.pages || []).forEach((t) => addEdge(n.id, titleTo[String(t).trim().toLowerCase()], "ki"));
			});
			(ki.relations || []).forEach((r) => addEdge("ent:" + String(r.from || "").trim(), "ent:" + String(r.to || "").trim(), "ki"));
		}
		// 🔗 Vom Nutzer gelöschte Verbindungen dauerhaft herausfiltern
		const hid = hiddenEdges();
		if (hid.size) edges = edges.filter((e2) => !hid.has(e2.a < e2.b ? e2.a + "|" + e2.b : e2.b + "|" + e2.a));
		// 🧠 Themen-Modus: Seiten ohne Themen-Bezug ausblenden (Haken in den 🧠-Optionen),
		// sonst hängen „Willkommen“ & Co. verloren neben den Fächern herum
		if (ki && Array.isArray(ki.topics) && !kiOpts().showPages) {
			const keep = new Set();
			edges.forEach((e2) => {
				if (String(e2.a).indexOf("topic:") === 0 || String(e2.a).indexOf("fach:") === 0) keep.add(e2.b);
				if (String(e2.b).indexOf("topic:") === 0 || String(e2.b).indexOf("fach:") === 0) keep.add(e2.a);
			});
			nodes = nodes.filter((n) => n.kind === "topic" || n.kind === "fach" || keep.has(n.id));
			byId = Object.create(null);
			nodes.forEach((n) => { byId[n.id] = n; });
			edges = edges.filter((e2) => byId[e2.a] && byId[e2.b]);
		}
	}

	// ---------- 🤖 KI-Ausbau (Phase 4): Entitäten · Synthese · Mapping ----------
	const KI_KEY = "impala67GraphKI";
	let lastSynth = null;
	function kiCache() { try { return JSON.parse(localStorage.getItem(KI_KEY) || "null"); } catch (err) { return null; } }
	function panel(html) {
		const el = overlay && overlay.querySelector(".graph-panel");
		if (el) { el.innerHTML = html; el.style.display = html ? "" : "none"; }
	}
	// ---------- 🧠 Themen-Analyse v2 (18. Juli) ----------
	// Warum Themen statt Entitäten: Seitentitel sagen wenig über den Lernstoff.
	// Quelle sind die KARTEIKARTEN (dort steckt der geprüfte Stoff), optional
	// zusätzlich Hefte/Notiz-Seiten. Der Fortschritt (Füllfarbe) kommt IMMER nur
	// aus den Karten (FSRS-Abrufbarkeit). Läuft bewusst nur auf Knopfdruck, damit
	// API-Kosten sichtbar bleiben und man vorher im Chat ein billiges oder lokales
	// Modell wählen kann.
	// Route A (bevorzugt): Embedding-Modell clustert (fast gratis), LLM benennt nur.
	// Route B (Fallback): das LLM gruppiert direkt — ein einziger Call.
	const KI_SRC_KEY = "impala67GraphKISrc";
	function kiOpts() { try { return JSON.parse(localStorage.getItem(KI_SRC_KEY) || "{}"); } catch (err) { return {}; } }
	// 🔗 Vom Nutzer gelöschte Verbindungen — als "a|b"-Schlüssel lokal gemerkt,
	// build() filtert sie bei jedem Aufbau wieder heraus.
	const EDGE_HIDE_KEY = "impala67GraphHiddenEdges";
	function hiddenEdges() { try { return new Set(JSON.parse(localStorage.getItem(EDGE_HIDE_KEY) || "[]")); } catch (err) { return new Set(); } }
	function hideEdge(a, b) {
		const s = hiddenEdges();
		s.add(a < b ? a + "|" + b : b + "|" + a);
		try { localStorage.setItem(EDGE_HIDE_KEY, JSON.stringify([...s])); } catch (err) { /* egal */ }
	}
	// Ø-Abrufbarkeit einer Kartenmenge — gleiche Näherung wie pageHeat().
	function topicHeat(cardIds) {
		const now = Date.now();
		let sum = 0, n = 0;
		(cardIds || []).forEach((id) => {
			const c = S.cards[id];
			if (!c || c.trashed || !c.srs || c.srs.state === "new") return;
			const dueIn = (new Date(c.srs.due).getTime() - now) / 864e5;
			const stab = Math.max(0.1, c.srs.stability || 0.5);
			try { sum += SRS.retrievability(Math.max(0, stab - dueIn), stab); n++; } catch (err) { /* egal */ }
		});
		return n ? sum / n : null;
	}
	// Der 🧠-Knopf zeigt erst die Optionen (Quelle + Kosten-Hinweis) — Start ist explizit.
	function runEntities() {
		const o = kiOpts();
		const hid = hiddenEdges();
		panel("<b>🧠 Themen-Analyse</b> — gruppiert deine Karteikarten pro Fach (= Anki-Stapel) in Unterthemen und färbt sie nach FSRS-Abrufbarkeit." +
			"<small>Ablauf: Es werden ALLE Karten berücksichtigt. Die LLM-Route arbeitet inkrementell — dem Modell werden die bestehenden Themen genannt und nur noch nicht zugeordnete Karten analysiert (in 100er-Blöcken). Die Embedding-Route rechnet immer alles frisch, kostet aber fast nichts. Im Hintergrund passiert nie etwas automatisch.</small>" +
			"<small>Modell (im Chat wählbar): <b>" + U.esc(S.settings.aiModel || "keins gewählt") + "</b>" +
			(S.settings.embedModel ? " · Cluster übernimmt das Embedding-Modell „" + U.esc(S.settings.embedModel) + "“, das LLM benennt sie nur — fast gratis." : " · Tipp: Mit Embedding-Modell (⚙️ Einstellungen) wird die Analyse fast gratis.") + "</small>" +
			'<label style="display:flex;gap:6px;align-items:center;margin:8px 0 0"><input type="checkbox" data-gtophefte' + (o.hefte ? " checked" : "") + "> Hefte & Notiz-Seiten zusätzlich als Themen-Quelle</label>" +
			'<label style="display:flex;gap:6px;align-items:center;margin:4px 0 8px"><input type="checkbox" data-gtoppages' + (o.showPages ? " checked" : "") + "> Auch Seiten ohne Themen-Bezug anzeigen</label>" +
			'<button type="button" data-gtopstart="1">🚀 Starten / aktualisieren</button> ' +
			'<button type="button" data-gtopfull="1">♻️ Komplett neu aufbauen</button>' +
			(hid.size ? ' <button type="button" data-gedgereset="1">🔗 ' + hid.size + " gelöschte Verbindung" + (hid.size === 1 ? "" : "en") + " wiederherstellen</button>" : ""));
		const start = (full) => {
			const cb = overlay.querySelector("[data-gtophefte]");
			const cp = overlay.querySelector("[data-gtoppages]");
			try { localStorage.setItem(KI_SRC_KEY, JSON.stringify({ hefte: !!(cb && cb.checked), showPages: !!(cp && cp.checked) })); } catch (err) { /* egal */ }
			runTopics(!!(cb && cb.checked), full);
		};
		const btn = overlay && overlay.querySelector("[data-gtopstart]");
		if (btn) btn.addEventListener("click", () => start(false));
		const fbtn = overlay && overlay.querySelector("[data-gtopfull]");
		if (fbtn) fbtn.addEventListener("click", () => start(true));
		const rst = overlay && overlay.querySelector("[data-gedgereset]");
		if (rst) rst.addEventListener("click", () => {
			try { localStorage.removeItem(EDGE_HIDE_KEY); } catch (err) { /* egal */ }
			build(); ticks = Math.min(ticks, 200);
			const leg = overlay && overlay.querySelector(".graph-legend");
			if (leg) leg.innerHTML = legendHtml();
			panel("🔗 Alle gelöschten Verbindungen sind wieder da.");
		});
	}
	async function runTopics(useHefte, full) {
		panel("🧠 KI gliedert deine Karteikarten in Fächer & Unterthemen …");
		try {
			const cards = Object.values(S.cards).filter((c) => c && !c.trashed && String(c.front || "").trim());
			if (cards.length < 8) { panel("Zu wenige Karteikarten (mindestens 8) — die Themen-Analyse braucht Lernstoff."); return; }
			const cardTxt = (c) => (String(c.front) + " — " + String(c.back || "")).replace(/\s+/g, " ").slice(0, 240);
			const deckOf = (c) => String(c.deck || "").trim() || "Allgemein";
			const pages = useHefte ? activePages().filter((p) => (p.content || "").length > 80).slice(0, 25) : [];
			let old = null;
			if (!full) { try { old = JSON.parse(localStorage.getItem(KI_KEY) || "null"); } catch (err) { old = null; } }
			const oldTopics = old && Array.isArray(old.topics) ? old.topics : [];
			let topics = null;
			// Embedding-Route: rechnet IMMER alle Karten frisch — Embeddings kosten fast nichts
			if (S.settings.embedModel) topics = await topicsViaEmbeddings(cards, cardTxt, pages, deckOf);
			if (!topics) topics = await topicsViaLlm(cards, cardTxt, pages, deckOf, oldTopics, (msg) => panel(msg));
			if (!topics || !topics.length) throw new Error("keine brauchbaren Themen erhalten");
			topics.forEach((tp) => { if (!tp.fach) { const c0 = S.cards[(tp.cardIds || [])[0]]; tp.fach = (c0 && String(c0.deck || "").trim()) || "Allgemein"; } });
			localStorage.setItem(KI_KEY, JSON.stringify({ t: Date.now(), model: S.settings.aiModel || "", topics }));
			build(); ticks = 0;
			const leg = overlay && overlay.querySelector(".graph-legend");
			if (leg) leg.innerHTML = legendHtml();
			panel("🧠 " + topics.length + " Themen in " + [...new Set(topics.map((tp) => tp.fach))].length + " Fächern — alle " + cards.length + " Karten berücksichtigt. Quelle: Karteikarten" + (useHefte ? " + Hefte/Seiten" : "") + ". Tipp auf Fach/Thema zeigt Details, Tipp auf eine Linie kann sie löschen.");
		} catch (err) {
			panel("⚠️ Themen-Analyse fehlgeschlagen: " + U.esc(String((err && err.message) || err)) + " — Modell im Chat prüfen/wechseln.");
		}
	}
	// Route A: Embeddings clustern (k-Means über Cosinus) — PRO FACH (= Stapel),
	// das LLM benennt die Gruppen nur noch. Querverbindungen entstehen NUR bei
	// wirklich hoher Ähnlichkeit (Cosinus > 0.6) — vorher galt „irgendein nächster
	// Nachbar“, was sinnlose Linien wie Evolution↔Analysis erzwungen hat.
	async function topicsViaEmbeddings(sample, cardTxt, pages, deckOf) {
		try {
			const texts = sample.map(cardTxt).concat(pages.map((p) => p.title + " — " + String(p.content || "").replace(/\s+/g, " ").slice(0, 300)));
			const vecs = [];
			for (let i = 0; i < texts.length; i += 64) vecs.push(...await AI.embed(texts.slice(i, i + 64)));
			const norm = (v) => { const l = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1; return v.map((x) => x / l); };
			const V = vecs.map(norm);
			const dot = (a, b) => { let d = 0; for (let x = 0; x < a.length; x++) d += a[x] * b[x]; return d; };
			// Karten nach Fach (= Stapel) gruppieren und JE FACH clustern
			const byDeck = {};
			sample.forEach((c, i) => { const f = deckOf(c); (byDeck[f] = byDeck[f] || []).push(i); });
			const clusters2 = [];
			Object.keys(byDeck).forEach((f) => {
				const idxs = byDeck[f];
				const k = Math.max(1, Math.min(6, Math.round(Math.sqrt(idxs.length / 3))));
				let centers = Array.from({ length: k }, (_, i) => V[idxs[Math.floor(i * idxs.length / k)]].slice());
				const assign = {};
				for (let it = 0; it < 12; it++) {
					idxs.forEach((ix) => { let best = 0, bs = -2; centers.forEach((c, ci) => { const d = dot(V[ix], c); if (d > bs) { bs = d; best = ci; } }); assign[ix] = best; });
					centers = centers.map((c, ci) => {
						const mine = idxs.filter((ix) => assign[ix] === ci);
						if (!mine.length) return c;
						const m = new Array(c.length).fill(0);
						mine.forEach((ix) => { for (let x = 0; x < V[ix].length; x++) m[x] += V[ix][x]; });
						return norm(m);
					});
				}
				centers.forEach((c, ci) => {
					const mine = idxs.filter((ix) => assign[ix] === ci);
					if (mine.length >= 2) clusters2.push({ fach: f, center: c, cards: mine.map((ix) => sample[ix]), pages: [] });
				});
			});
			if (!clusters2.length) return null;
			// Seiten dem ähnlichsten Thema zuordnen — aber nur bei erkennbarer Nähe
			pages.forEach((p, i) => {
				const v = V[sample.length + i];
				let best = -1, bs = 0.35;
				clusters2.forEach((cl, j) => { const d = dot(v, cl.center); if (d > bs) { bs = d; best = j; } });
				if (best >= 0) clusters2[best].pages.push(p);
			});
			const raw = await AI.complete(
				"Benenne jede Karten-Gruppe mit einem kurzen, eindeutigen Thema (1-3 Wörter).\n\n" +
				clusters2.map((cl, i) => "Gruppe " + i + " (Fach: " + cl.fach + "):\n" + cl.cards.slice(0, 8).map((c) => "- " + cardTxt(c).slice(0, 120)).join("\n")).join("\n\n") +
				'\n\nAntworte NUR als JSON: {"namen":["Thema für Gruppe 0","Thema für Gruppe 1"]}',
				"Du bist ein präziser Lern-Bibliothekar. Antworte NUR mit gültigem JSON.");
			const names = JSON.parse((raw.match(/\{[\s\S]*\}/) || ["{}"])[0]).namen || [];
			const topics = clusters2.map((cl, i) => ({
				name: String(names[i] || "Thema " + (i + 1)).trim(),
				fach: cl.fach,
				cardIds: cl.cards.map((c) => c.id),
				pageIds: cl.pages.map((p) => p.id),
				near: [],
			}));
			// Querverbindung NUR bei wirklich hoher Ähnlichkeit zweier Themen
			clusters2.forEach((cl, i) => {
				clusters2.forEach((o2, j) => {
					if (j <= i) return;
					if (dot(cl.center, o2.center) > 0.6) topics[i].near.push(topics[j].name);
				});
			});
			return topics;
		} catch (err) {
			console.warn("Graph: Embedding-Route fehlgeschlagen — LLM-Fallback", err);
			return null;
		}
	}
	// Route B: das LLM ordnet INKREMENTELL zu — dem Modell werden die bestehenden
	// Themen genannt, analysiert werden nur noch nicht zugeordnete Karten, in
	// 100er-Blöcken, damit auch riesige Sammlungen komplett durchlaufen.
	// Gelöschte Karten werden vorher aus dem alten Stand ausgeputzt.
	async function topicsViaLlm(cards, cardTxt, pages, deckOf, oldTopics, progress) {
		const ids = new Set(cards.map((c) => c.id));
		const topics = (oldTopics || []).map((t) => ({
			name: String(t.name || "").trim(),
			fach: String(t.fach || "").trim(),
			cardIds: (t.cardIds || []).filter((id) => ids.has(id)),
			pageIds: [],
			near: (t.near || []).slice(),
		})).filter((t) => t.name && t.cardIds.length);
		const done = new Set();
		topics.forEach((t) => t.cardIds.forEach((id) => done.add(id)));
		const todo = cards.filter((c) => !done.has(c.id));
		const chunks = Math.max(1, Math.ceil(todo.length / 100));
		for (let ci = 0; ci < chunks; ci++) {
			if (ci === 0 && !todo.length && !pages.length) break; // nichts Neues zu tun
			if (progress && chunks > 1) progress("🧠 Block " + (ci + 1) + " / " + chunks + " — " + todo.length + " neue Karten werden zugeordnet …");
			const chunk = todo.slice(ci * 100, ci * 100 + 100);
			const lines = chunk.map((c, i) => "K" + i + " [Fach: " + deckOf(c) + "]: " + cardTxt(c));
			const plines = ci === 0 ? pages.map((p, i) => "S" + i + ": " + p.title + " — " + String(p.content || "").replace(/\s+/g, " ").slice(0, 300)) : [];
			const tlines = topics.map((t, i) => "T" + i + " [" + (t.fach || "?") + "] " + t.name);
			const raw = await AI.complete(
				(tlines.length ? "Bestehende Themen:\n" + tlines.join("\n") + "\n\n" : "") +
				"Ordne jede Karte einem BESTEHENDEN Thema zu (per T-Index) oder erfinde ein NEUES Unterthema ihres Fachs (unter \"neu\", 1-6 Themen pro Fach, kurze eindeutige Namen mit 1-3 Wörtern).\n\nNeue Karteikarten:\n" + (lines.join("\n") || "(keine)") +
				(plines.length ? "\n\nNotiz-Seiten (nur dem wirklich passenden Thema zuordnen, sonst weglassen):\n" + plines.join("\n") : "") +
				'\n\nAntworte NUR als JSON: {"zu":[{"k":0,"t":2}],"seiten":[{"s":0,"t":1}],"neu":[{"name":"...","fach":"...","karten":[1,3]}]}',
				"Du bist ein präziser Lern-Bibliothekar. Antworte NUR mit gültigem JSON.");
			const j = JSON.parse((raw.match(/\{[\s\S]*\}/) || ["{}"])[0]);
			(Array.isArray(j.neu) ? j.neu : []).forEach((t) => {
				const nt = {
					name: String(t.name || "").trim(),
					fach: String(t.fach || "").trim(),
					cardIds: (Array.isArray(t.karten) ? t.karten : []).map((i) => chunk[i] && chunk[i].id).filter(Boolean),
					pageIds: [],
					near: [],
				};
				if (nt.name && nt.cardIds.length && !topics.some((t2) => t2.name === nt.name && t2.fach === nt.fach)) topics.push(nt);
			});
			(Array.isArray(j.zu) ? j.zu : []).forEach((z) => {
				const c = chunk[z.k], t = topics[z.t];
				if (c && t && t.cardIds.indexOf(c.id) < 0) t.cardIds.push(c.id);
			});
			(Array.isArray(j.seiten) ? j.seiten : []).forEach((z) => {
				const p = pages[z.s], t = topics[z.t];
				if (p && t && t.pageIds.indexOf(p.id) < 0) t.pageIds.push(p.id);
			});
		}
		return topics.filter((t) => t.cardIds.length || t.pageIds.length);
	}
	// Schwach verbundene Cluster über Union-Find; Entitäts-Knoten zählen nicht mit.
	function clusters() {
		const parent = {};
		const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
		nodes.forEach((n) => { parent[n.id] = n.id; });
		edges.forEach((e) => { const a = find(e.a.id || e.a), b = find(e.b.id || e.b); if (a !== b) parent[a] = b; });
		const groups = {};
		nodes.forEach((n) => { if (n.kind === "entity") return; const r = find(n.id); (groups[r] = groups[r] || []).push(n); });
		return Object.values(groups).sort((a, b) => b.length - a.length);
	}
	function weakPair() {
		const gs = clusters();
		const hub = (g) => g.slice().sort((a, b) => (b.deg * 1000 + b.len) - (a.deg * 1000 + a.len))[0];
		if (gs.length >= 2) return [hub(gs[0]), hub(gs[1])];
		// alles hängt zusammen → zwei inhaltsstarke Seiten OHNE direkte Kante
		const cand = (gs[0] || []).slice().sort((a, b) => b.len - a.len).slice(0, 12);
		const key = (a, b) => (a.id < b.id ? a.id + "|" + b.id : b.id + "|" + a.id);
		const linked = new Set(edges.map((e) => key(e.a.id ? e.a : { id: e.a }, e.b.id ? e.b : { id: e.b })));
		for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) {
			if (!linked.has(key(cand[i], cand[j]))) return [cand[i], cand[j]];
		}
		return cand.length >= 2 ? [cand[0], cand[1]] : null;
	}
	async function runSynth() {
		const pair = weakPair();
		if (!pair) { panel("Zu wenige Seiten für eine Synthese-Frage."); return; }
		panel("🧩 KI formuliert eine Synthese-Frage zu „" + U.esc(pair[0].title) + "“ × „" + U.esc(pair[1].title) + "“ …");
		try {
			const txt = (id) => String((S.pages[id] || {}).content || "").slice(0, 1500);
			const raw = await AI.complete(
				'Formuliere EINE anspruchsvolle Synthese-Frage, die beide Themen verbindet, und eine knappe Musterantwort. NUR JSON {"frage":"...","antwort":"..."}.\n\n' +
				"## " + pair[0].title + "\n" + txt(pair[0].id) + "\n\n## " + pair[1].title + "\n" + txt(pair[1].id),
				"Du bist ein Lern-Coach für vernetztes Denken. Antworte NUR mit gültigem JSON.");
			const j = JSON.parse((raw.match(/\{[\s\S]*\}/) || ["{}"])[0]);
			if (!j.frage) throw new Error("keine Frage erhalten");
			lastSynth = { front: "🧩 " + j.frage, back: j.antwort || "", deck: "Synthese" };
			panel("<b>🧩 " + U.esc(j.frage) + "</b>" + (j.antwort ? "<small>" + U.esc(j.antwort) + "</small>" : "") +
				'<button data-gsave="1">Als Karte speichern</button>');
		} catch (err) { panel("⚠️ Synthese fehlgeschlagen: " + ((err && err.message) || err)); }
	}
	async function runMapping() {
		const pair = weakPair();
		if (!pair) { panel("Zu wenige Seiten für eine Mapping-Karte."); return; }
		panel("🧠 KI prüft die fehlende Kante …");
		let back = "Eigene Verbindung formulieren — dann beide Seiten öffnen und vergleichen.";
		try {
			const raw = await AI.complete(
				"Erkläre in 2-3 Sätzen die inhaltliche Verbindung zwischen „" + pair[0].title + "“ und „" + pair[1].title + "“. Nur der Erklärtext.",
				"Du bist ein knapper Fach-Tutor.");
			if (raw && raw.trim()) back = raw.trim().slice(0, 800);
		} catch (err) { /* Fallback-Rückseite reicht */ }
		await STATE.dispatch("cardCreate", { id: U.uid(),
			front: "🕸 Wie hängen „" + pair[0].title + "“ und „" + pair[1].title + "“ zusammen? Nenne die Verbindung in 1–2 Sätzen.",
			back, deck: "Wissensgraph" });
		panel("🧠 Mapping-Karte im Stapel „Wissensgraph“ angelegt — läuft ab jetzt durch den FSRS-Planer.");
	}

	// ---------- Physik: kleiner Force-Layout ohne Bibliothek ----------
	function tick() {
		const rep = 1400, spring = 0.012, springLen = 90, damp = 0.86;
		for (let i = 0; i < nodes.length; i++) {
			const a = nodes[i];
			for (let j = i + 1; j < nodes.length; j++) {
				const b = nodes[j];
				let dx = a.x - b.x, dy = a.y - b.y;
				let d2 = dx * dx + dy * dy;
				if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
				if (d2 > 160000) continue; // weit weg → vernachlässigbar
				const d = Math.sqrt(d2), f = rep / d2;
				dx /= d; dy /= d;
				a.vx += dx * f; a.vy += dy * f;
				b.vx -= dx * f; b.vy -= dy * f;
			}
		}
		edges.forEach((e) => {
			const a = byId[e.a], b = byId[e.b];
			const dx = b.x - a.x, dy = b.y - a.y;
			const d = Math.max(1, Math.hypot(dx, dy));
			const f = (d - springLen) * spring;
			a.vx += (dx / d) * f; a.vy += (dy / d) * f;
			b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
		});
		nodes.forEach((n) => {
			// sanfte Anziehung zur Mitte, damit nichts davonfliegt
			n.vx -= n.x * 0.0015; n.vy -= n.y * 0.0015;
			if (drag && drag.node === n) { n.vx = 0; n.vy = 0; return; }
			n.vx *= damp; n.vy *= damp;
			n.x += n.vx; n.y += n.vy;
		});
		ticks++;
	}

	// ---------- Zeichnen ----------
	const nodeRadius = (n) => 4 + Math.min(10, Math.sqrt(n.len / 400) + n.deg * 0.6);
	function draw() {
		if (!cv) return;
		const dpr = window.devicePixelRatio || 1;
		const W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
		if (cv.width !== W) cv.width = W;
		if (cv.height !== H) cv.height = H;
		ctx.save();
		ctx.clearRect(0, 0, W, H);
		ctx.translate(W / 2 + view.x * dpr, H / 2 + view.y * dpr);
		ctx.scale(view.k * dpr, view.k * dpr);
		const q = filter.trim().toLowerCase();
		edges.forEach((e) => {
			const a = byId[e.a], b = byId[e.b];
			ctx.strokeStyle = e.kind === "tree" ? "rgba(140,150,165,.25)" : e.kind === "ki" ? "rgba(139,127,214,.45)" : "rgba(94,159,232,.4)";
			ctx.lineWidth = 1 / view.k;
			ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
		});
		nodes.forEach((n) => {
			const rr = nodeRadius(n);
			const match = q && n.title.toLowerCase().includes(q);
			ctx.globalAlpha = q && !match ? 0.22 : 1;
			ctx.beginPath();
			ctx.fillStyle = n.kind === "entity" ? "#8b7fd6" : heatColor(n.heat);
			ctx.arc(n.x, n.y, rr, 0, Math.PI * 2);
			ctx.fill();
			if (n.kind === "topic") { ctx.strokeStyle = "#8b7fd6"; ctx.lineWidth = 2.5 / view.k; ctx.stroke(); } // 🧠 Thema: FSRS-Füllung + violetter Ring
			if (n.kind === "fach") { ctx.strokeStyle = "#e8c65a"; ctx.lineWidth = 3.5 / view.k; ctx.stroke(); } // 📚 Fach (= Stapel): goldener Ring
			if (n === hover || match) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5 / view.k; ctx.stroke(); }
			if (view.k > 0.55 || n === hover || match) {
				ctx.fillStyle = "rgba(235,235,235,.85)";
				ctx.font = (11 / view.k) + "px system-ui, sans-serif";
				ctx.fillText(n.title.slice(0, 28), n.x + rr + 3 / view.k, n.y + 3 / view.k);
			}
			ctx.globalAlpha = 1;
		});
		ctx.restore();
	}
	// ⌂ QoL: Ansicht so verschieben/zoomen, dass ALLE Knoten sichtbar sind
	function fitView() {
		if (!cv || !nodes.length) return;
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		nodes.forEach((n) => { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y); });
		const w = Math.max(60, maxX - minX + 120), h = Math.max(60, maxY - minY + 120);
		view.k = Math.max(0.15, Math.min(2.5, Math.min(cv.clientWidth / w, cv.clientHeight / h)));
		view.x = -((minX + maxX) / 2) * view.k;
		view.y = -((minY + maxY) / 2) * view.k;
	}
	function loop() {
		if (!running) return;
		if (ticks < 300) tick(); // Layout beruhigt sich, danach nur noch zeichnen
		// 🎯 Sanfte Zielansicht (＋/−/⌂/Suche) und 🛝 Trägheits-Pan nach dem Wischen
		if (goal) {
			view.x += (goal.x - view.x) * 0.18;
			view.y += (goal.y - view.y) * 0.18;
			view.k += (goal.k - view.k) * 0.18;
			if (Math.abs(goal.x - view.x) < 0.5 && Math.abs(goal.y - view.y) < 0.5 && Math.abs(goal.k - view.k) < 0.004) goal = null;
		} else if (!drag && !pinch && (Math.abs(vel.x) > 0.4 || Math.abs(vel.y) > 0.4)) {
			view.x += vel.x; view.y += vel.y;
			vel.x *= 0.92; vel.y *= 0.92;
		}
		draw();
		raf = requestAnimationFrame(loop);
	}

	// ---------- Interaktion: Pan/Zoom/Ziehen · Tipp öffnet die Seite ----------
	function toWorld(e) {
		const r = cv.getBoundingClientRect();
		return [((e.clientX - r.left) - r.width / 2 - view.x) / view.k, ((e.clientY - r.top) - r.height / 2 - view.y) / view.k];
	}
	function nodeAt(p) {
		for (let i = nodes.length - 1; i >= 0; i--) {
			const n = nodes[i];
			if (Math.hypot(n.x - p[0], n.y - p[1]) <= nodeRadius(n) + 4 / view.k) return n;
		}
		return null;
	}
	// 📱 Gesten v2 (18. Juli): Pinch-Zoom um die Fingermitte, Trägheits-Pan nach dem
	// Wischen, Rad-Zoom auf den Mauszeiger. Buttons/⌂ gleiten sanft über `goal`.
	const pointers = new Map();
	let pinch = null; // { d0, k0 } aktive Zwei-Finger-Geste
	let vel = { x: 0, y: 0 };
	let lastPan = null; // { x, y, t } für die Trägheits-Geschwindigkeit
	function zoomAt(sx, sy, nk) {
		// Der Weltpunkt unter (sx,sy) bleibt beim Zoomen exakt liegen
		const r = cv.getBoundingClientRect();
		nk = Math.max(0.15, Math.min(4, nk));
		const wx = ((sx - r.left) - r.width / 2 - view.x) / view.k;
		const wy = ((sy - r.top) - r.height / 2 - view.y) / view.k;
		view.k = nk;
		view.x = (sx - r.left) - r.width / 2 - wx * nk;
		view.y = (sy - r.top) - r.height / 2 - wy * nk;
		goal = null;
	}
	// Nächste Verbindung am Punkt p (Weltkoordinaten) — für Tipp-auf-Linie
	function edgeAt(p) {
		let best = null, bd = Infinity;
		edges.forEach((e2) => {
			const a = byId[e2.a], b = byId[e2.b];
			if (!a || !b) return;
			const dx = b.x - a.x, dy = b.y - a.y;
			const t = Math.max(0, Math.min(1, ((p[0] - a.x) * dx + (p[1] - a.y) * dy) / (dx * dx + dy * dy || 1)));
			const qx = a.x + dx * t - p[0], qy = a.y + dy * t - p[1];
			const d2 = qx * qx + qy * qy;
			if (d2 < bd) { bd = d2; best = e2; }
		});
		return best && bd <= Math.pow(8 / view.k, 2) ? best : null;
	}
	function onDown(e) {
		try { cv.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		goal = null; vel = { x: 0, y: 0 };
		if (pointers.size === 2) {
			const [a, b] = [...pointers.values()];
			pinch = { d0: Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), k0: view.k };
			drag = null;
			return;
		}
		const n = nodeAt(toWorld(e));
		drag = n ? { node: n, moved: false } : { pan: true, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
		lastPan = { x: e.clientX, y: e.clientY, t: performance.now() };
	}
	function onMove(e) {
		if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (pinch && pointers.size >= 2) {
			const [a, b] = [...pointers.values()];
			const d = Math.max(20, Math.hypot(a.x - b.x, a.y - b.y));
			zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinch.k0 * (d / pinch.d0));
			return;
		}
		if (!drag) { hover = nodeAt(toWorld(e)); return; }
		if (drag.pan) {
			view.x = drag.vx + (e.clientX - drag.x);
			view.y = drag.vy + (e.clientY - drag.y);
			if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true;
			const now = performance.now();
			if (lastPan && now > lastPan.t) {
				const dt = Math.max(8, now - lastPan.t);
				vel = { x: (e.clientX - lastPan.x) / dt * 16, y: (e.clientY - lastPan.y) / dt * 16 };
			}
			lastPan = { x: e.clientX, y: e.clientY, t: now };
		} else {
			const p = toWorld(e);
			drag.node.x = p[0]; drag.node.y = p[1];
			drag.moved = true;
			ticks = Math.min(ticks, 260); // Layout darf kurz nachfedern
		}
	}
	function onUp(e) {
		if (e && pointers.delete(e.pointerId) && pointers.size < 2) pinch = null;
		if (drag && !drag.moved && drag.node) {
			vel = { x: 0, y: 0 };
			if (drag.node.kind === "topic" || drag.node.kind === "fach") {
				// Themen-/Fach-Knoten öffnen keine Seite — sie zeigen ihre Karten-Bilanz
				panel((drag.node.kind === "fach" ? "📚 " : "🧠 ") + "<b>" + U.esc(drag.node.title) + "</b> — " + (drag.node.cards || 0) + " Karten · Abrufbarkeit: " + (drag.node.heat == null ? "noch keine Bewertungen" : Math.round(drag.node.heat * 100) + " %"));
			} else if (drag.node.kind !== "entity") {
				const id = drag.node.id;
				close();
				try { TABS.openPage(id); } catch (err) { if (U.toast) U.toast("Seite konnte nicht geöffnet werden"); }
			}
		} else if (drag && !drag.moved && drag.pan && e) {
			// 🔗 Tipp auf eine Verbindung: anzeigen + löschen; Tipp ins Leere schließt das Panel
			const ed = edgeAt(toWorld(e));
			if (ed) {
				const a = byId[ed.a], b = byId[ed.b];
				panel("🔗 <b>" + U.esc((a && a.title) || "?") + "</b> ↔ <b>" + U.esc((b && b.title) || "?") + "</b> " +
					'<button type="button" data-gedgedel="1">🗑 Verbindung löschen</button>');
				const btn = overlay && overlay.querySelector("[data-gedgedel]");
				if (btn) btn.addEventListener("click", () => {
					hideEdge(ed.a, ed.b);
					edges = edges.filter((e2) => e2 !== ed);
					panel("🔗 Verbindung entfernt — Wiederherstellen geht über den 🧠-Themen-Dialog.");
				});
			} else { panel(""); }
		}
		drag = null;
	}
	function onWheel(e) {
		e.preventDefault();
		zoomAt(e.clientX, e.clientY, view.k * (e.deltaY < 0 ? 1.14 : 0.88));
	}

	// ---------- Overlay ----------
	function legendHtml() {
		const withCards = nodes.filter((n) => n.heat != null).length;
		return '<span><b style="background:#35a05f"></b>sitzt</span>' +
			'<span><b style="background:#f2a33c"></b>wird wacklig</span>' +
			'<span><b style="background:#e0483e"></b>(über)fällig</span>' +
			'<span><b style="background:#7c8188"></b>keine Karten</span>' +
			(nodes.some((n) => n.kind === "entity" || n.kind === "topic") ? '<span><b style="background:#8b7fd6"></b>🧠 KI-Thema (Ring violett, Füllung = FSRS)</span>' : "") +
			(nodes.some((n) => n.kind === "fach") ? '<span><b style="background:#e8c65a"></b>📚 Fach = Anki-Stapel</span>' : "") +
			"<span>" + nodes.length + " Seiten · " + edges.length + " Verbindungen · " + withCards + " mit FSRS-Färbung · Tipp auf einen Knoten öffnet die Seite</span>";
	}
	function open() {
		close();
		build();
		overlay = document.createElement("div");
		overlay.className = "graph-overlay";
		overlay.innerHTML = '<div class="graph-head"><h2>🕸 Wissensgraph</h2>' +
			'<input type="search" placeholder="Seite suchen …" class="graph-search" autocomplete="off">' +
			'<button type="button" class="graph-zoom" data-gz="in" title="Vergrößern">＋</button>' +
			'<button type="button" class="graph-zoom" data-gz="out" title="Verkleinern">−</button>' +
			'<button type="button" class="graph-zoom" data-gz="fit" title="Ansicht einpassen">⌂</button>' +
			'<button type="button" class="graph-ki" data-gki="ent" title="Karteikarten (und optional Hefte) per KI in Themen sortieren">🧠 Themen</button>' +
			'<button type="button" class="graph-ki" data-gki="synth" title="Frage, die zwei schwach verbundene Themen verbindet">🧩 Synthese</button>' +
			'<button type="button" class="graph-ki" data-gki="map" title="Fehlende Verbindung als FSRS-Karte">🧠 Mapping-Karte</button>' +
			'<button type="button" class="graph-close" title="Schließen">✕</button></div>' +
			'<div class="graph-legend">' + legendHtml() + "</div>" +
			'<div class="graph-panel" style="display:none"></div>' +
			'<div class="graph-canvas-wrap"><canvas></canvas></div>';
		document.body.appendChild(overlay);
		cv = overlay.querySelector("canvas");
		ctx = cv.getContext("2d");
		overlay.querySelector(".graph-close").addEventListener("click", close);
		overlay.querySelector(".graph-search").addEventListener("input", (e) => { filter = e.target.value || ""; });
		// ⏎ QoL: Enter in der Suche springt zum ersten Treffer und zoomt heran
		overlay.querySelector(".graph-search").addEventListener("keydown", (e) => {
			if (e.key !== "Enter") return;
			const q = (filter || "").trim().toLowerCase();
			const n = q && nodes.find((n2) => n2.title.toLowerCase().includes(q));
			if (n) { view.k = Math.max(view.k, 1.4); view.x = -n.x * view.k; view.y = -n.y * view.k; }
		});
		overlay.querySelectorAll(".graph-zoom").forEach((b) => b.addEventListener("click", () => {
			if (b.dataset.gz === "fit") { const o = { x: view.x, y: view.y, k: view.k }; fitView(); goal = { x: view.x, y: view.y, k: view.k }; view.x = o.x; view.y = o.y; view.k = o.k; return; } // ⌂ gleitet sanft hin // ⌂ Ansicht einpassen
			const base = goal || view;
			const nk = Math.max(0.15, Math.min(4, base.k * (b.dataset.gz === "in" ? 1.25 : 0.8)));
			goal = { k: nk, x: base.x * (nk / base.k), y: base.y * (nk / base.k) };
		}));
		// 🤖 QoL: beim Öffnen zeigen, wann die letzte KI-Analyse lief
		const ki0 = kiCache();
		if (ki0 && ki0.t) panel("🤖 Letzte KI-Analyse: " + new Date(ki0.t).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) + " Uhr — „🤖 KI-Analyse“ aktualisiert die Begriffe.");
		overlay.addEventListener("click", (e) => {
			const ki = e.target.closest && e.target.closest("[data-gki]");
			if (ki) { const kind = ki.dataset.gki; if (kind === "ent") runEntities(); else if (kind === "synth") runSynth(); else runMapping(); return; }
			const save = e.target.closest && e.target.closest("[data-gsave]");
			if (save && lastSynth) {
				STATE.dispatch("cardCreate", { id: U.uid(), front: lastSynth.front, back: lastSynth.back, deck: lastSynth.deck }).catch(() => {});
				panel("🧩 Synthese-Karte im Stapel „Synthese“ angelegt.");
			}
		});
		cv.addEventListener("pointerdown", onDown);
		cv.addEventListener("pointermove", onMove);
		cv.addEventListener("pointerup", onUp);
		cv.addEventListener("pointercancel", (e) => { pointers.delete(e.pointerId); pinch = null; drag = null; });
		cv.addEventListener("wheel", onWheel, { passive: false });
		view = { x: 0, y: 0, k: 1 };
		ticks = 0; running = true;
		loop();
	}
	function close() {
		running = false;
		if (raf) { cancelAnimationFrame(raf); raf = 0; }
		if (overlay) overlay.remove();
		overlay = null; cv = null; ctx = null; drag = null; hover = null; filter = "";
	}

	// Eigener Capture-Listener (Muster telemetrie.js): kein Eingriff in app.js nötig.
	document.addEventListener("click", (e) => {
		if (e.target && e.target.closest && e.target.closest("#btnGraph")) { e.preventDefault(); open(); }
	}, true);
	document.addEventListener("keydown", (e) => { if (e.key === "Escape" && overlay) close(); });

	return { open, close };
})();