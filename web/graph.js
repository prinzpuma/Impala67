"use strict";

import { S, STATE } from "./state.js";
import { SRS } from "./srs.js";
import { AI } from "./ai.js";
import { DB } from "./db.js";
import { TABS } from "./tabs.js";
import { U } from "./util.js";

// Kompakter Wissensgraph: Embeddings ordnen Karten, das LLM benennt die
// resultierenden Skills. Fachliche Daten synchronisieren über settingsSet;
// die großen, jederzeit erneuerbaren Vektoren bleiben lokal in IndexedDB.
export const GRAPH = (() => {
	const VERSION = 3;
	const OLD_KEY = "impala67GraphKI";
	const VECTOR_PREFIX = "graph-card:";
	let overlay = null;
	let selectedId = null;
	let mode = "explore";
	let query = "";
	let pendingLink = null;
	let resizeObserver = null;
	let analysing = false;

	const activeCards = () => Object.values(S.cards).filter((c) => c && !c.trashed && String(c.front || "").trim());
	const graph = () => S.settings.knowledgeGraph && S.settings.knowledgeGraph.v === VERSION ? S.settings.knowledgeGraph : null;
	const topDeck = (card) => (String(card.deck || "Allgemein").split("::")[0].trim() || "Allgemein");
	const cardText = (card) => (String(card.front || "") + " — " + String(card.back || "")).replace(/\s+/g, " ").trim().slice(0, 600);

	function hash(text) {
		let h = 2166136261;
		for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
		return (h >>> 0).toString(36);
	}

	const fingerprint = (cards = activeCards()) => hash(cards.map((c) => c.id + "|" + topDeck(c) + "|" + cardText(c)).sort().join("\n"));
	const isStale = (g = graph()) => !!g && (g.sourceFingerprint !== fingerprint() || g.model !== S.settings.embedModel);
	const skillById = (g, id) => (g && g.skills || []).find((skill) => skill.id === id) || null;

	function retrievability(card) {
		if (!card || !card.srs || card.srs.state === "new") return null;
		const dueIn = (new Date(card.srs.due).getTime() - Date.now()) / 864e5;
		const stability = Math.max(.1, Number(card.srs.stability) || .5);
		try { return SRS.retrievability(Math.max(0, stability - dueIn), stability); }
		catch { return null; }
	}

	function mastery(skill) {
		const cards = (skill.cardIds || []).map((id) => S.cards[id]).filter((c) => c && !c.trashed);
		const rated = cards.map((card) => ({ card, r: retrievability(card) })).filter((x) => x.r != null);
		const due = rated.filter((x) => new Date(x.card.srs.due).getTime() <= Date.now()).length;
		const value = rated.length ? rated.reduce((sum, x) => sum + x.r, 0) / rated.length : 0;
		let state = "discover";
		if (rated.length) state = due || value < .7 ? "fragile" : "building";
		if (rated.length >= 3 && !due && value >= .85) state = "mastered";
		return { cards: cards.length, rated: rated.length, due, value, state };
	}

	const stateLabel = (m) => ({ discover: "Entdecken", building: "Im Aufbau", fragile: "Gefährdet", mastered: "Beherrscht" })[m.state];
	const subjectId = (name) => "sub:" + hash(String(name).toLowerCase());

	function parseJson(raw) {
		const hit = String(raw || "").match(/\{[\s\S]*\}/);
		if (!hit) throw new Error("Die KI lieferte kein JSON.");
		return JSON.parse(hit[0]);
	}

	function setStatus(html, busy = false) {
		const box = overlay && overlay.querySelector(".graph-status");
		if (!box) return;
		box.hidden = !html;
		box.innerHTML = html || "";
		box.classList.toggle("busy", busy);
	}

	async function vectorsFor(cards) {
		const all = await DB.allVecs();
		const provider = S.settings.embedProviderId || "";
		const model = S.settings.embedModel;
		const out = new Map();
		const stale = [];
		const activeIds = new Set(cards.map((card) => card.id));
		await Promise.all(Object.keys(all).filter((key) => key.startsWith(VECTOR_PREFIX) && !activeIds.has(key.slice(VECTOR_PREFIX.length))).map((key) => DB.delVec(key)));
		for (const card of cards) {
			const text = cardText(card), contentHash = hash(text);
			const rec = all[VECTOR_PREFIX + card.id];
			if (rec && rec.kind === "knowledge-card" && rec.model === model && rec.provider === provider && rec.hash === contentHash && rec.vec) {
				out.set(card.id, rec.vec instanceof Float32Array ? rec.vec : Float32Array.from(rec.vec));
			} else stale.push({ card, text, contentHash });
		}
		for (let at = 0; at < stale.length; at += 64) {
			const batch = stale.slice(at, at + 64);
			setStatus("<b>Analysiere Karten</b><span>Embeddings " + Math.min(at + batch.length, stale.length) + " / " + stale.length + "</span>", true);
			const vecs = await AI.embed(batch.map((x) => x.text));
			await Promise.all(batch.map((item, i) => {
				const vec = Float32Array.from(vecs[i]);
				out.set(item.card.id, vec);
				return DB.putVec(VECTOR_PREFIX + item.card.id, { kind: "knowledge-card", model, provider, hash: item.contentHash, vec });
			}));
		}
		return out;
	}

	function clusterInWorker(cards, vectors) {
		return new Promise((resolve, reject) => {
			const worker = new Worker(new URL("./graph-worker.js", import.meta.url), { type: "module" });
			const timer = setTimeout(() => { worker.terminate(); reject(new Error("Clustering dauerte zu lange.")); }, 120000);
			worker.onmessage = (event) => {
				clearTimeout(timer); worker.terminate();
				if (!event.data || !event.data.ok) reject(new Error(event.data && event.data.error || "Clustering fehlgeschlagen."));
				else resolve(event.data.groups || []);
			};
			worker.onerror = (event) => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message || "Clustering fehlgeschlagen.")); };
			const bySubject = new Map();
			for (const card of cards) {
				const name = topDeck(card);
				if (!bySubject.has(name)) bySubject.set(name, []);
				bySubject.get(name).push({ id: card.id, vec: vectors.get(card.id) });
			}
			worker.postMessage({ groups: [...bySubject].map(([subject, items]) => ({ subject, items })) });
		});
	}

	function bestOldSkill(old, subject, ids, used) {
		let best = null, score = 0;
		const set = new Set(ids);
		for (const skill of old && old.skills || []) {
			if (used.has(skill.id) || (!skill.customSubject && skill.subjectId !== subjectId(subject))) continue;
			const overlap = (skill.cardIds || []).filter((id) => set.has(id)).length;
			const union = new Set([...(skill.cardIds || []), ...ids]).size || 1;
			if (overlap / union > score) { score = overlap / union; best = skill; }
		}
		return score >= .55 ? best : null;
	}

	async function nameClusters(group, cardsById, old, used) {
		const prepared = group.clusters.map((cluster, index) => {
			const previous = bestOldSkill(old, group.subject, cluster.ids, used);
			if (previous) used.add(previous.id);
			return { cluster, index, previous };
		});
		const unnamed = prepared.filter((x) => !x.previous || !x.previous.customTitle);
		let labels = {};
		if (unnamed.length) {
			setStatus("<b>Strukturiere „" + U.esc(group.subject) + "“</b><span>Die KI benennt " + group.clusters.length + " Skills.</span>", true);
			const body = unnamed.map((entry) => {
				const examples = entry.cluster.ids.slice(0, 4).map((id) => "- " + cardText(cardsById.get(id)).slice(0, 180)).join("\n");
				return "Cluster " + entry.index + ":\n" + examples;
			}).join("\n\n");
			const raw = await AI.complete(
				"Benenne die folgenden Karten-Cluster aus dem Fach „" + group.subject + "“ als konkrete lernbare Skills. " +
				"Ordne nur dann Voraussetzungen zu, wenn sie fachlich zwingend sind.\n\n" + body +
				'\n\nAntworte nur als JSON: {"skills":[{"cluster":0,"title":"1-4 Wörter","description":"ein kurzer Satz","prerequisites":[1]}]}',
				"Du strukturierst Lernstoff knapp, fachlich präzise und ohne erfundene Inhalte. Antworte nur mit gültigem JSON."
			);
			for (const item of parseJson(raw).skills || []) labels[Number(item.cluster)] = item;
		}
		const idAt = prepared.map((entry) => entry.previous && entry.previous.id || "skill:" + hash(group.subject + "|" + entry.cluster.ids.slice().sort().join("|")));
		return prepared.map((entry) => {
			const label = labels[entry.index] || {};
			const previous = entry.previous;
			const title = previous && previous.customTitle ? previous.title : String(label.title || previous && previous.title || "Thema " + (entry.index + 1)).slice(0, 60);
			return {
				id: idAt[entry.index], subjectId: previous && previous.customSubject ? previous.subjectId : subjectId(group.subject), title,
				description: String(label.description || previous && previous.description || "").slice(0, 240),
				cardIds: entry.cluster.ids, pageIds: [...new Set(entry.cluster.ids.map((id) => cardsById.get(id) && cardsById.get(id).pageId).filter(Boolean))],
				prereqIds: [...new Set((label.prerequisites || []).map((i) => idAt[Number(i)]).filter((id) => id && id !== idAt[entry.index]).concat(previous && previous.manualPrereqIds || []))],
				manualPrereqIds: (previous && previous.manualPrereqIds || []).slice(),
				customTitle: !!(previous && previous.customTitle), customSubject: !!(previous && previous.customSubject), center: entry.cluster.center,
			};
		});
	}

	function removeCycles(skills) {
		const byId = new Map(skills.map((skill) => [skill.id, skill]));
		const reaches = (from, target, seen = new Set()) => {
			if (from === target) return true;
			if (seen.has(from)) return false;
			seen.add(from);
			const skill = byId.get(from);
			return !!skill && (skill.prereqIds || []).some((id) => reaches(id, target, seen));
		};
		for (const skill of skills) skill.prereqIds = (skill.prereqIds || []).filter((parent) => byId.has(parent) && parent !== skill.id && !reaches(parent, skill.id));
		return skills;
	}

	function cosine(a, b) {
		let dot = 0, aa = 0, bb = 0;
		const n = Math.min(a.length, b.length);
		for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 96))) { const x = a[i] || 0, y = b[i] || 0; dot += x * y; aa += x * x; bb += y * y; }
		return dot / (Math.sqrt(aa * bb) || 1);
	}

	function bridgesFor(skills, old) {
		const candidates = [];
		for (let i = 0; i < skills.length; i++) for (let j = i + 1; j < skills.length; j++) {
			if (skills[i].subjectId === skills[j].subjectId) continue;
			const score = cosine(skills[i].center || [], skills[j].center || []);
			if (score >= .62) candidates.push({ a: skills[i].id, b: skills[j].id, score });
		}
		candidates.sort((a, b) => b.score - a.score);
		const manual = (old && old.bridges || []).filter((edge) => edge.manual && skillById({ skills }, edge.a) && skillById({ skills }, edge.b));
		return manual.concat(candidates.slice(0, 18).map((edge) => ({ id: "bridge:" + hash([edge.a, edge.b].sort().join("|")), ...edge, manual: false })));
	}

	async function analyse() {
		if (analysing) return;
		if (!S.settings.embedModel) {
			setStatus('<b>Embedding-Modell fehlt</b><span>Für große Sammlungen bitte unter Einstellungen → KI ein Embedding-Modell auswählen.</span>');
			return;
		}
		const cards = activeCards();
		if (cards.length < 4) { setStatus("<b>Noch zu wenig Lernstoff</b><span>Mindestens vier Karteikarten werden benötigt.</span>"); return; }
		analysing = true;
		try {
			const vectors = await vectorsFor(cards);
			setStatus("<b>Ordne Wissen</b><span>Lokales Clustering läuft außerhalb der Oberfläche.</span>", true);
			const groups = await clusterInWorker(cards, vectors);
			const old = graph();
			const cardsById = new Map(cards.map((card) => [card.id, card]));
			const used = new Set(), skills = [];
			for (const group of groups) skills.push(...await nameClusters(group, cardsById, old, used));
			removeCycles(skills);
			const bridges = bridgesFor(skills, old);
			// Zentren sind nur ein Analyse-Zwischenergebnis. Sie zu synchronisieren würde
			// den kleinen Graph-Snapshot um mehrere Megabyte aufblasen.
			const storedSkills = skills.map(({ center, ...skill }) => skill);
			const next = {
				v: VERSION, updated: U.now(), model: S.settings.embedModel, sourceFingerprint: fingerprint(cards),
				subjects: groups.map((group) => ({ id: subjectId(group.subject), name: group.subject })),
				skills: storedSkills, bridges,
			};
			await STATE.dispatch("settingsSet", { knowledgeGraph: next });
			selectedId = null;
			setStatus("<b>Skill-Tree aktualisiert</b><span>" + skills.length + " Skills aus " + cards.length + " Karten.</span>");
			render();
		} catch (error) {
			setStatus("<b>Analyse fehlgeschlagen</b><span>" + U.esc(String(error && error.message || error)) + "</span><button type=\"button\" data-graph-analyse>Erneut versuchen</button>");
		} finally { analysing = false; }
	}

	function levelOf(skill, g, seen = new Set()) {
		if (seen.has(skill.id)) return 0;
		seen.add(skill.id);
		const parents = (skill.prereqIds || []).map((id) => skillById(g, id)).filter(Boolean);
		return parents.length ? 1 + Math.max(...parents.map((parent) => levelOf(parent, g, new Set(seen)))) : 0;
	}

	function recommendation(g) {
		return (g.skills || []).map((skill) => ({ skill, m: mastery(skill) })).sort((a, b) => {
			const score = (x) => x.m.due * 100 + (x.m.state === "fragile" ? 40 : 0) + (x.m.state === "discover" ? 15 : 0) + (1 - x.m.value) * 10;
			return score(b) - score(a);
		})[0] || null;
	}

	function nodeHtml(skill, g, recommended) {
		const m = mastery(skill), selected = skill.id === selectedId;
		const dim = query && !(skill.title + " " + skill.description).toLowerCase().includes(query.toLowerCase());
		return '<button type="button" class="graph-skill state-' + m.state + (selected ? " selected" : "") + (dim ? " dim" : "") + '" data-skill="' + U.esc(skill.id) + '" data-level="' + levelOf(skill, g) + '" style="--progress:' + Math.round(m.value * 100) + '%">' +
			'<span class="graph-skill-ring"></span><span class="graph-skill-copy"><b>' + U.esc(skill.title) + '</b><small>' + stateLabel(m) + ' · ' + m.cards + ' Karten</small></span>' +
			(recommended && recommended.skill.id === skill.id ? '<span class="graph-next">Nächster Schritt</span>' : "") + '</button>';
	}

	function lanesHtml(g) {
		const rec = mode === "learn" ? recommendation(g) : null;
		return (g.subjects || []).map((subject) => {
			const skills = g.skills.filter((skill) => skill.subjectId === subject.id);
			const levels = new Map();
			for (const skill of skills) { const level = levelOf(skill, g); if (!levels.has(level)) levels.set(level, []); levels.get(level).push(skill); }
			const rows = [...levels.entries()].sort((a, b) => b[0] - a[0]).map(([level, list]) => '<div class="graph-level" data-level="' + level + '">' + list.map((skill) => nodeHtml(skill, g, rec)).join("") + '</div>').join("");
			const avg = skills.length ? Math.round(skills.reduce((sum, skill) => sum + mastery(skill).value, 0) / skills.length * 100) : 0;
			return '<section class="graph-lane" data-subject="' + U.esc(subject.id) + '"><header><span>' + U.esc(subject.name) + '</span><small>' + avg + '%</small></header><div class="graph-levels">' + rows + '</div></section>';
		}).join("");
	}

	function inspectorHtml(g) {
		const skill = skillById(g, selectedId);
		if (!skill) return '<div class="graph-inspector-empty"><b>Wissen auswählen</b><span>Tippe auf einen Skill, um Lernstand, Quellen und Verbindungen zu sehen.</span></div>';
		const m = mastery(skill);
		const subject = g.subjects.find((item) => item.id === skill.subjectId);
		const prereqs = (skill.prereqIds || []).map((id) => skillById(g, id)).filter(Boolean);
		const related = (g.bridges || []).filter((edge) => edge.a === skill.id || edge.b === skill.id).map((edge) => ({ edge, skill: skillById(g, edge.a === skill.id ? edge.b : edge.a) })).filter((x) => x.skill);
		let html = '<div class="graph-inspector-head"><span>' + U.esc(subject && subject.name || "") + '</span><button type="button" data-graph-inspector-close aria-label="Details schließen">×</button></div>' +
			'<h2>' + U.esc(skill.title) + '</h2><p>' + U.esc(skill.description || "Von der KI aus deinen Karten abgeleiteter Skill.") + '</p>' +
			'<div class="graph-mastery"><div><b>' + Math.round(m.value * 100) + '%</b><span>' + stateLabel(m) + '</span></div><div><b>' + m.due + '</b><span>jetzt fällig</span></div><div><b>' + m.rated + '/' + m.cards + '</b><span>bewertet</span></div></div>' +
			'<button type="button" class="primary graph-learn" data-graph-learn="' + U.esc(skill.id) + '">In „' + U.esc(subject && subject.name || "Fach") + '“ lernen</button>';
		if (prereqs.length) html += '<h3>Voraussetzungen</h3><div class="graph-relations">' + prereqs.map((item) => '<button data-skill="' + U.esc(item.id) + '">' + U.esc(item.title) + '</button>').join("") + '</div>';
		if (related.length) html += '<h3>Fächerübergreifend</h3><div class="graph-relations">' + related.map((item) => '<button data-skill="' + U.esc(item.skill.id) + '">' + U.esc(item.skill.title) + '</button>').join("") + '</div><button type="button" data-graph-synth="' + U.esc(skill.id) + '">Synthese-Frage erstellen</button>';
		if (mode === "edit") {
			html += '<div class="graph-edit"><h3>Bearbeiten</h3><label>Name<input data-graph-title value="' + U.esc(skill.title) + '"></label>' +
				'<label>Fach<select data-graph-subject>' + g.subjects.map((item) => '<option value="' + U.esc(item.id) + '"' + (item.id === skill.subjectId ? " selected" : "") + '>' + U.esc(item.name) + '</option>').join("") + '</select></label>' +
				'<button type="button" data-graph-save="' + U.esc(skill.id) + '">Änderungen speichern</button>' +
				'<div class="graph-edit-links"><button type="button" data-graph-link="bridge">Fachbrücke hinzufügen</button><button type="button" data-graph-link="prereq">Als Voraussetzung verbinden</button></div></div>';
		}
		return html;
	}

	function render() {
		if (!overlay) return;
		const g = graph();
		const stage = overlay.querySelector(".graph-stage");
		const inspector = overlay.querySelector(".graph-inspector");
		if (!g || !g.skills || !g.skills.length) {
			stage.innerHTML = '<div class="graph-empty"><span>✦</span><h2>Baue deinen Skill-Tree</h2><p>Embeddings ordnen deine Karten; die KI benennt daraus klare, lernbare Fähigkeiten.</p><button type="button" class="primary" data-graph-analyse>Jetzt analysieren</button></div>';
			inspector.innerHTML = "";
			return;
		}
		stage.innerHTML = '<svg class="graph-lines" aria-hidden="true"></svg><div class="graph-lanes">' + lanesHtml(g) + '</div>';
		inspector.innerHTML = inspectorHtml(g);
		overlay.classList.toggle("inspector-open", !!selectedId);
		requestAnimationFrame(drawLines);
	}

	function drawLines() {
		const g = graph(), stage = overlay && overlay.querySelector(".graph-stage"), svg = stage && stage.querySelector(".graph-lines");
		if (!g || !svg) return;
		const base = stage.getBoundingClientRect();
		const node = (id) => stage.querySelector('[data-skill="' + CSS.escape(id) + '"]');
		const path = (a, b, cls) => {
			const ae = node(a), be = node(b); if (!ae || !be) return "";
			const ar = ae.getBoundingClientRect(), br = be.getBoundingClientRect();
			const x1 = ar.left + ar.width / 2 - base.left + stage.scrollLeft, y1 = ar.top + ar.height / 2 - base.top + stage.scrollTop;
			const x2 = br.left + br.width / 2 - base.left + stage.scrollLeft, y2 = br.top + br.height / 2 - base.top + stage.scrollTop;
			const mid = (y1 + y2) / 2;
			return '<path class="' + cls + '" d="M' + x1 + ' ' + y1 + ' C' + x1 + ' ' + mid + ',' + x2 + ' ' + mid + ',' + x2 + ' ' + y2 + '"></path>';
		};
		let html = "";
		for (const skill of g.skills) for (const parent of skill.prereqIds || []) html += path(parent, skill.id, "prereq");
		for (const edge of g.bridges || []) if (mode === "learn" || selectedId === edge.a || selectedId === edge.b) html += path(edge.a, edge.b, "bridge");
		svg.setAttribute("width", Math.max(stage.scrollWidth, stage.clientWidth));
		svg.setAttribute("height", Math.max(stage.scrollHeight, stage.clientHeight));
		svg.innerHTML = html;
	}

	async function saveSkill(id) {
		const g = structuredClone(graph()), skill = skillById(g, id);
		if (!skill) return;
		const title = String((overlay.querySelector("[data-graph-title]") || {}).value || "").trim();
		const subject = String((overlay.querySelector("[data-graph-subject]") || {}).value || "");
		if (title) { skill.title = title.slice(0, 60); skill.customTitle = true; }
		if (g.subjects.some((item) => item.id === subject) && skill.subjectId !== subject) { skill.subjectId = subject; skill.customSubject = true; }
		g.updated = U.now();
		await STATE.dispatch("settingsSet", { knowledgeGraph: g });
		render();
		U.toast("Skill gespeichert", "success");
	}

	async function completeLink(targetId) {
		if (!pendingLink || pendingLink.from === targetId) return;
		const g = structuredClone(graph()), from = skillById(g, pendingLink.from), target = skillById(g, targetId);
		if (!from || !target) return;
		if (pendingLink.type === "prereq") {
			target.prereqIds = [...new Set([...(target.prereqIds || []), from.id])];
			target.manualPrereqIds = [...new Set([...(target.manualPrereqIds || []), from.id])];
		} else {
			const key = [from.id, target.id].sort().join("|");
			if (!(g.bridges || []).some((edge) => [edge.a, edge.b].sort().join("|") === key)) g.bridges.push({ id: "bridge:" + hash(key), a: from.id, b: target.id, manual: true, score: 1 });
		}
		pendingLink = null; g.updated = U.now();
		await STATE.dispatch("settingsSet", { knowledgeGraph: g });
		selectedId = targetId; setStatus("<b>Verbindung gespeichert</b>"); render();
	}

	function learnSkill(id) {
		const g = graph(), skill = skillById(g, id), subject = skill && g.subjects.find((item) => item.id === skill.subjectId);
		if (!skill || !subject) return;
		S.ankiDeck = subject.name === "Standard" ? null : subject.name;
		S.ankiTab = "study"; S.ankiMix = false; S.ankiFeyn = false;
		close(); TABS.openPage("anki:main");
	}

	async function synthesize(id) {
		const g = graph(), skill = skillById(g, id);
		const edge = (g.bridges || []).find((item) => item.a === id || item.b === id);
		const other = edge && skillById(g, edge.a === id ? edge.b : edge.a);
		if (!skill || !other) return;
		setStatus("<b>Erzeuge Synthese-Frage</b><span>„" + U.esc(skill.title) + "“ × „" + U.esc(other.title) + "“</span>", true);
		try {
			const raw = await AI.complete('Formuliere eine anspruchsvolle Abruf- und Transferfrage zwischen „' + skill.title + '“ und „' + other.title + '“ samt knapper Musterantwort. Antworte nur als JSON {"frage":"...","antwort":"..."}.', "Du bist ein präziser Lerncoach.");
			const result = parseJson(raw);
			setStatus('<b>' + U.esc(result.frage || "Synthese-Frage") + '</b><span>' + U.esc(result.antwort || "") + '</span><button type="button" data-graph-save-synth data-front="' + U.esc(result.frage || "") + '" data-back="' + U.esc(result.antwort || "") + '">Als Karte speichern</button>');
		} catch (error) { setStatus("<b>Synthese fehlgeschlagen</b><span>" + U.esc(String(error && error.message || error)) + "</span>"); }
	}

	function onClick(event) {
		const target = event.target.closest && event.target.closest("button, [data-mode]");
		if (!target) return;
		if (target.dataset.graphClose !== undefined) { close(); return; }
		if (target.dataset.graphAnalyse !== undefined) { analyse(); return; }
		if (target.dataset.mode) { mode = target.dataset.mode; pendingLink = null; overlay.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode)); render(); return; }
		if (target.dataset.graphInspectorClose !== undefined) { selectedId = null; render(); return; }
		if (target.dataset.skill) {
			if (pendingLink) { completeLink(target.dataset.skill); return; }
			selectedId = target.dataset.skill; render(); return;
		}
		if (target.dataset.graphLearn) { learnSkill(target.dataset.graphLearn); return; }
		if (target.dataset.graphSave) { saveSkill(target.dataset.graphSave); return; }
		if (target.dataset.graphLink) { pendingLink = { from: selectedId, type: target.dataset.graphLink }; setStatus("<b>Ziel auswählen</b><span>Tippe jetzt auf den Skill, den du verbinden möchtest.</span>"); return; }
		if (target.dataset.graphSynth) { synthesize(target.dataset.graphSynth); return; }
		if (target.dataset.graphSaveSynth !== undefined) {
			STATE.dispatch("cardCreate", { id: U.uid(), front: "🧩 " + target.dataset.front, back: target.dataset.back, deck: "Synthese" }).then(() => setStatus("<b>Synthese-Karte gespeichert</b>"));
		}
	}

	function open() {
		close();
		overlay = document.createElement("div");
		overlay.className = "graph-overlay";
		overlay.innerHTML = '<header class="graph-head"><div class="graph-brand"><span>✦</span><div><h1>Wissensgraph</h1><small>Dein Skill-Tree</small></div></div>' +
			'<nav class="graph-modes" aria-label="Graph-Modus"><button data-mode="explore" class="active">Erkunden</button><button data-mode="learn">Lernen</button><button data-mode="edit">Bearbeiten</button></nav>' +
			'<div class="graph-actions"><label class="graph-search"><span>⌕</span><input type="search" placeholder="Skills suchen" autocomplete="off"></label><button type="button" data-graph-analyse title="Analyse aktualisieren">↻</button><button type="button" data-graph-close aria-label="Schließen">×</button></div></header>' +
			'<div class="graph-status" hidden></div><main class="graph-shell"><div class="graph-stage"></div><aside class="graph-inspector"></aside></main>';
		document.body.appendChild(overlay);
		overlay.addEventListener("click", onClick);
		overlay.querySelector(".graph-search input").addEventListener("input", (event) => { query = event.target.value || ""; render(); });
		overlay.querySelector(".graph-stage").addEventListener("scroll", () => requestAnimationFrame(drawLines), { passive: true });
		resizeObserver = new ResizeObserver(() => requestAnimationFrame(drawLines));
		resizeObserver.observe(overlay.querySelector(".graph-stage"));
		const g = graph();
		if (g && isStale(g)) setStatus('<b>Neue Lerninhalte erkannt</b><span>Der Skill-Tree kann kontrolliert aktualisiert werden.</span><button type="button" data-graph-analyse>Jetzt aktualisieren</button>');
		else if (!g) {
			const old = U.storage.getJson(OLD_KEY, null);
			if (old && old.topics) setStatus("<b>Alter Wissensgraph erkannt</b><span>Die neue Analyse übernimmt deine Karten in den Skill-Tree.</span>");
		}
		render();
	}

	function close() {
		if (resizeObserver) resizeObserver.disconnect();
		resizeObserver = null;
		if (overlay) overlay.remove();
		overlay = null; selectedId = null; pendingLink = null; query = ""; mode = "explore";
	}

	document.addEventListener("click", (event) => { if (event.target.closest && event.target.closest("#btnGraph")) { event.preventDefault(); open(); } }, true);
	document.addEventListener("keydown", (event) => { if (event.key === "Escape" && overlay) { if (selectedId) { selectedId = null; render(); } else close(); } });

	return { open, close, mastery };
})();
