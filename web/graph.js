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
		// 🤖 Gecachte KI-Entitäten als violette Begriff-Knoten einhängen (runEntities füllt den Cache)
		const ki = kiCache();
		if (ki && Array.isArray(ki.entities)) {
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
	}

	// ---------- 🤖 KI-Ausbau (Phase 4): Entitäten · Synthese · Mapping ----------
	const KI_KEY = "impala67GraphKI";
	let lastSynth = null;
	function kiCache() { try { return JSON.parse(localStorage.getItem(KI_KEY) || "null"); } catch (err) { return null; } }
	function panel(html) {
		const el = overlay && overlay.querySelector(".graph-panel");
		if (el) { el.innerHTML = html; el.style.display = html ? "" : "none"; }
	}
	async function runEntities() {
		panel("🤖 KI liest die Notizen und extrahiert Begriffe …");
		try {
			const pages = activePages().sort((a, b) => (b.content || "").length - (a.content || "").length).slice(0, 30);
			const corpus = pages.map((p) => "### " + p.title + "\n" + String(p.content || "").replace(/\s+/g, " ").slice(0, 500)).join("\n\n");
			const raw = await AI.complete(
				"Extrahiere aus diesen Notizen die 10-18 wichtigsten Fachbegriffe (Entitäten) und ihre Beziehungen.\n" +
				'Antworte NUR als JSON: {"entities":[{"name":"...","pages":["Seitentitel"]}],"relations":[{"from":"Begriff","to":"Begriff","label":"kurz"}]}\n' +
				"Verwende bei pages NUR Titel aus der Liste.\n\n" + corpus,
				"Du bist ein präziser Wissensgraph-Extraktor. Antworte NUR mit gültigem JSON.");
			const j = JSON.parse((raw.match(/\{[\s\S]*\}/) || ["{}"])[0]);
			if (!Array.isArray(j.entities) || !j.entities.length) throw new Error("Antwort ohne Entitäten");
			localStorage.setItem(KI_KEY, JSON.stringify({ t: Date.now(), entities: j.entities.slice(0, 20), relations: Array.isArray(j.relations) ? j.relations.slice(0, 40) : [] }));
			build(); ticks = 0;
			const leg = overlay && overlay.querySelector(".graph-legend");
			if (leg) leg.innerHTML = legendHtml();
			panel("🤖 " + j.entities.length + " Begriffe eingehängt (violett). Erneut tippen wiederholt die Extraktion mit aktuellen Notizen.");
		} catch (err) {
			panel("⚠️ Extraktion fehlgeschlagen: " + ((err && err.message) || err) + " — KI-Modell in den ⚙️ Einstellungen prüfen.");
		}
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
	function onDown(e) {
		try { cv.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
		const n = nodeAt(toWorld(e));
		drag = n ? { node: n, moved: false } : { pan: true, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
	}
	function onMove(e) {
		if (!drag) { hover = nodeAt(toWorld(e)); return; }
		if (drag.pan) {
			view.x = drag.vx + (e.clientX - drag.x);
			view.y = drag.vy + (e.clientY - drag.y);
			if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true;
		} else {
			const p = toWorld(e);
			drag.node.x = p[0]; drag.node.y = p[1];
			drag.moved = true;
			ticks = Math.min(ticks, 260); // Layout darf kurz nachfedern
		}
	}
	function onUp() {
		if (drag && !drag.moved && drag.node && drag.node.kind !== "entity") {
			const id = drag.node.id;
			close();
			try { TABS.openPage(id); } catch (err) { if (U.toast) U.toast("Seite konnte nicht geöffnet werden"); }
		}
		drag = null;
	}
	function onWheel(e) {
		e.preventDefault();
		view.k = Math.max(0.15, Math.min(4, view.k * (e.deltaY < 0 ? 1.12 : 0.9)));
	}

	// ---------- Overlay ----------
	function legendHtml() {
		const withCards = nodes.filter((n) => n.heat != null).length;
		return '<span><b style="background:#35a05f"></b>sitzt</span>' +
			'<span><b style="background:#f2a33c"></b>wird wacklig</span>' +
			'<span><b style="background:#e0483e"></b>(über)fällig</span>' +
			'<span><b style="background:#7c8188"></b>keine Karten</span>' +
			(nodes.some((n) => n.kind === "entity") ? '<span><b style="background:#8b7fd6"></b>KI-Begriff</span>' : "") +
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
			'<button type="button" class="graph-ki" data-gki="ent" title="Begriffe & Beziehungen per KI extrahieren">🤖 KI-Analyse</button>' +
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
			if (b.dataset.gz === "fit") { fitView(); return; } // ⌂ Ansicht einpassen
			view.k = Math.max(0.15, Math.min(4, view.k * (b.dataset.gz === "in" ? 1.25 : 0.8)));
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
		cv.addEventListener("pointercancel", () => { drag = null; });
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