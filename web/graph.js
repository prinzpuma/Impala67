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
	const VERSION = 5;
	const OLD_KEY = "impala67GraphKI";
	const VECTOR_PREFIX = "graph-card:";
	let overlay = null;
	let selectedId = null;
	let mode = "explore";
	let query = "";
	let pendingLink = null;
	let resizeObserver = null;
	let analysing = false;

	const activeCards = () => STATE.activeCards().filter((c) => c && String(c.front || "").trim());
	const graph = () => S.settings.knowledgeGraph && S.settings.knowledgeGraph.v === VERSION ? S.settings.knowledgeGraph : null;
	// Der gespeicherte Graph behält seine Zuordnungen, damit Wiederherstellen ohne
	// Neuanalyse funktioniert. Für die Anzeige werden archivierte Karten und dadurch
	// leere Skills/Verbindungen nur als Projektion ausgeblendet.
	function visibleGraph() {
		const stored = graph();
		if (!stored) return null;
		const skills = (stored.skills || []).map((skill) => ({
			...skill,
			cardIds: (skill.cardIds || []).filter((id) => {
				const card = S.cards[id];
				return card && !card.trashed && !STATE.isCardArchived(card);
			}),
		})).filter((skill) => skill.gap || skill.cardIds.length);
		const skillIds = new Set(skills.map((skill) => skill.id));
		const normalizedSkills = skills.map((skill) => ({
			...skill,
			prereqIds: (skill.prereqIds || []).filter((id) => skillIds.has(id)),
		}));
		const topicIds = new Set(normalizedSkills.map((skill) => skill.topicId));
		const subjectIds = new Set(normalizedSkills.map((skill) => skill.subjectId));
		return {
			...stored,
			skills: normalizedSkills,
			topics: (stored.topics || []).filter((topic) => topicIds.has(topic.id)),
			subjects: (stored.subjects || []).filter((subject) => subjectIds.has(subject.id)),
			bridges: (stored.bridges || []).filter((edge) => skillIds.has(edge.a) && skillIds.has(edge.b)),
		};
	}
	const deckName = (card) => String(card.deck || "Standard").trim() || "Standard";
	const cardText = (card) => (String(card.front || "") + " — " + String(card.back || "")).replace(/\s+/g, " ").trim().slice(0, 600);

	function hash(text) {
		let h = 2166136261;
		for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
		return (h >>> 0).toString(36);
	}

	const fingerprint = (cards = activeCards()) => hash(cards.map((c) => c.id + "|" + deckName(c) + "|" + cardText(c)).sort().join("\n"));
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
		if (skill.gap) return { cards: 0, rated: 0, due: 0, value: 0, state: "gap" };
		const cards = (skill.cardIds || []).map((id) => S.cards[id]).filter((c) => c && !c.trashed && !STATE.isCardArchived(c));
		const rated = cards.map((card) => ({ card, r: retrievability(card) })).filter((x) => x.r != null);
		const due = rated.filter((x) => new Date(x.card.srs.due).getTime() <= Date.now()).length;
		const value = rated.length ? rated.reduce((sum, x) => sum + x.r, 0) / rated.length : 0;
		let state = "discover";
		if (rated.length) state = due || value < .7 ? "fragile" : "building";
		if (rated.length >= 3 && !due && value >= .85) state = "mastered";
		return { cards: cards.length, rated: rated.length, due, value, state };
	}

	const stateLabel = (m) => ({ gap: "Lernlücke", discover: "Noch nicht gelernt", building: "Im Aufbau", fragile: "Auffrischen", mastered: "Gelernt" })[m.state];
	const subjectId = (name) => "sub:" + hash(String(name).toLowerCase());
	const topicId = (subject, name) => "topic:" + hash(String(subject).toLowerCase() + "|" + String(name).toLowerCase());
	function normalizeSubject(value) {
		const raw = String(value || "").trim(), key = raw.toLowerCase();
		return ({ mathe: "Mathematik", math: "Mathematik", mathematics: "Mathematik", bio: "Biologie", geschichte: "Geschichte", history: "Geschichte", info: "Informatik", computer_science: "Informatik" })[key] || raw;
	}
	function normalizeTopic(value, subject) {
		const raw = String(value || "").trim(), key = raw.toLowerCase();
		const aliases = { geo: "Geometrie", geometry: "Geometrie", geometrie: "Geometrie", stoch: "Stochastik", stochastik: "Stochastik", statistik: "Stochastik", probability: "Stochastik", wahrscheinlichkeitsrechnung: "Stochastik", wahrscheinlichkeitstheorie: "Stochastik", analysis: "Analysis", calculus: "Analysis", mathe: "Grundlagen", mathematik: "Grundlagen" };
		return aliases[key] || (raw === subject ? "Grundlagen" : raw);
	}
	const normalizeNodeTitle = (value) => String(value || "").trim().replace(/^wie (man|du)\s+/i, "").replace(/\s+(anwenden|lernen|verstehen|erklären|berechnen|bestimmen|lösen|analysieren|kennen)$/i, "").trim();

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

	function fallbackTaxonomy(deck) {
		const leaf = deck.split("::").pop().trim() || "Grundlagen";
		const value = deck.toLowerCase();
		const rules = [
			[/mathe|analysis|algebra|geometr|\bgeo\b|stochast|statistik|wahrscheinlich|trigonom|integral|differential/, "Mathematik"],
			[/biolog|zell|genetik|ökolog|evolution|anatom/, "Biologie"],
			[/physik|mechanik|elektr|optik|thermodynam/, "Physik"],
			[/chemie|organik|anorganik|reaktion|atom/, "Chemie"],
			[/geschicht|antike|mittelalter|neuzeit|krieg/, "Geschichte"],
			[/informatik|programm|algorithm|datenbank|netzwerk/, "Informatik"],
			[/deutsch|literatur|grammatik|sprache/, "Deutsch"],
			[/englisch|english/, "Englisch"],
		];
		const subject = normalizeSubject((rules.find(([pattern]) => pattern.test(value)) || [null, deck.split("::")[0].trim() || "Allgemeines Wissen"])[1]);
		return { deck, subject, topic: normalizeTopic(leaf, subject) || "Grundlagen" };
	}

	async function taxonomyFor(cards) {
		const byDeck = new Map();
		for (const card of cards) {
			const deck = deckName(card);
			if (!byDeck.has(deck)) byDeck.set(deck, []);
			if (byDeck.get(deck).length < 3) byDeck.get(deck).push(String(card.front || "").replace(/\s+/g, " ").slice(0, 140));
		}
		const decks = [...byDeck.keys()];
		setStatus("<b>Erkenne Fächer und Themen</b><span>Stapel sind nur Hinweise – die KI baut eine allgemeine Taxonomie.</span>", true);
		try {
			const input = decks.map((deck, index) => "D" + index + " [" + deck + "]:\n" + byDeck.get(deck).map((text) => "- " + text).join("\n")).join("\n\n");
			const raw = await AI.complete(
				"Ordne die folgenden Karteikarten-Stapel in eine allgemeine, fachlich sinnvolle Wissenshierarchie ein. " +
				"Das Fach ist breit und standardisiert (z. B. Mathematik, Biologie, Geschichte). Das Thema ist ein Teilgebiet " +
				"(z. B. Analysis, Geometrie, Stochastik). Stapelnamen sind nur Hinweise: nicht jeden Stapel zu einem eigenen Fach machen, " +
				"Abkürzungen normalisieren und verwandte Stapel zusammenführen.\n\n" + input +
				'\n\nAntworte nur als JSON: {"decks":[{"index":0,"subject":"Mathematik","topic":"Analysis"}]}',
				"Du bist ein präziser Lern-Bibliothekar. Verwende kurze deutsche Standardbezeichnungen und antworte nur mit gültigem JSON."
			);
			const result = parseJson(raw), mapped = new Map();
			for (const item of result.decks || []) {
				const index = Number(item.index), deck = decks[index];
				const subject = normalizeSubject(String(item.subject || "").trim().slice(0, 50));
				const topic = normalizeTopic(String(item.topic || "").trim().slice(0, 60), subject);
				if (deck && subject && topic) mapped.set(deck, { deck, subject, topic });
			}
			return new Map(decks.map((deck) => [deck, mapped.get(deck) || fallbackTaxonomy(deck)]));
		} catch (error) {
			console.warn("Graph-Taxonomie: KI-Antwort unbrauchbar, lokale Einordnung wird verwendet.", error);
			return new Map(decks.map((deck) => [deck, fallbackTaxonomy(deck)]));
		}
	}

	function clusterInWorker(cards, vectors, taxonomy) {
		return new Promise((resolve, reject) => {
			const worker = new Worker(new URL("./graph-worker.js", import.meta.url), { type: "module" });
			const timer = setTimeout(() => { worker.terminate(); reject(new Error("Clustering dauerte zu lange.")); }, 120000);
			worker.onmessage = (event) => {
				clearTimeout(timer); worker.terminate();
				if (!event.data || !event.data.ok) reject(new Error(event.data && event.data.error || "Clustering fehlgeschlagen."));
				else resolve(event.data.groups || []);
			};
			worker.onerror = (event) => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message || "Clustering fehlgeschlagen.")); };
			const groups = new Map();
			for (const card of cards) {
				const tax = taxonomy.get(deckName(card)) || fallbackTaxonomy(deckName(card));
				const key = tax.subject + "\u0000" + tax.topic;
				if (!groups.has(key)) groups.set(key, { key, subject: tax.subject, topic: tax.topic, items: [] });
				groups.get(key).items.push({ id: card.id, vec: vectors.get(card.id) });
			}
			worker.postMessage({ groups: [...groups.values()] });
		});
	}

	function bestOldSkill(old, subject, topic, ids, used) {
		let best = null, score = 0;
		const set = new Set(ids);
		for (const skill of old && old.skills || []) {
			const legacy = Number(old && old.v || 0) < VERSION;
			if (used.has(skill.id) || (!legacy && !skill.customSubject && skill.subjectId !== subjectId(subject)) || (!legacy && !skill.customTopic && skill.topicId && skill.topicId !== topicId(subject, topic))) continue;
			const overlap = (skill.cardIds || []).filter((id) => set.has(id)).length;
			const union = new Set([...(skill.cardIds || []), ...ids]).size || 1;
			if (overlap / union > score) { score = overlap / union; best = skill; }
		}
		return score >= .55 ? best : null;
	}

	async function nameClusters(group, cardsById, old, used) {
		const prepared = group.clusters.map((cluster, index) => {
			const previous = bestOldSkill(old, group.subject, group.topic, cluster.ids, used);
			if (previous) used.add(previous.id);
			return { cluster, index, previous };
		});
		const unnamed = prepared.filter((x) => !x.previous || !x.previous.customTitle);
		let labels = {}, gapSpecs = [];
		if (unnamed.length) {
			setStatus("<b>Strukturiere „" + U.esc(group.subject) + " › " + U.esc(group.topic) + "“</b><span>Die KI benennt " + group.clusters.length + " Unterthemen.</span>", true);
			const body = unnamed.map((entry) => {
				const examples = entry.cluster.ids.slice(0, 4).map((id) => "- " + cardText(cardsById.get(id)).slice(0, 180)).join("\n");
				return "Cluster " + entry.index + ":\n" + examples;
			}).join("\n\n");
			const raw = await AI.complete(
				"Benenne die folgenden Karten-Cluster aus „" + group.subject + " › " + group.topic + "“ als fachliche Unterthemen. " +
				"Bestimme für jeden Cluster außerdem das passende Teilgebiet innerhalb von „" + group.subject + "“; der bisherige Themenhinweis „" + group.topic + "“ darf korrigiert werden. " +
				"Der Titel ist eine kurze deutsche Nominalbezeichnung ohne Lernverb, zum Beispiel „Kurvendiskussion“, „Integralrechnung“ oder „Binomialverteilung“ – niemals „… anwenden/lernen/verstehen“. " +
				"Ordne nur zwingende Voraussetzungen zu. Nenne außerdem höchstens zwei fachlich sichere, direkt angrenzende Unterthemen, zu denen im Material offenbar noch keine Karten existieren; keine spekulativen Vollständigkeitslisten.\n\n" + body +
				'\n\nAntworte nur als JSON: {"skills":[{"cluster":0,"topic":"Analysis","title":"Kurvendiskussion","description":"ein kurzer Satz","prerequisites":[1]}],"gaps":[{"topic":"Analysis","title":"Grenzwerte","description":"Warum dieses Unterthema hier fehlt","connectTo":[0]}]}',
				"Du erstellst eine klare Themenlandkarte aus vorhandenem Lernstoff. Verwende kurze deutsche Fachbegriffe und antworte nur mit gültigem JSON."
			);
			const parsed = parseJson(raw);
			for (const item of parsed.skills || []) labels[Number(item.cluster)] = item;
			gapSpecs = Array.isArray(parsed.gaps) ? parsed.gaps.slice(0, 2) : [];
		}
		const idAt = prepared.map((entry) => entry.previous && entry.previous.id || "skill:" + hash(group.subject + "|" + group.topic + "|" + entry.cluster.ids.slice().sort().join("|")));
		return prepared.map((entry) => {
			const label = labels[entry.index] || {};
			const previous = entry.previous;
			const oldTopic = previous && old && (old.topics || []).find((item) => item.id === previous.topicId);
			const topicName = previous && previous.customTopic && oldTopic ? oldTopic.name : normalizeTopic(String(label.topic || group.topic || "Grundlagen").trim().slice(0, 60), group.subject);
			let title = previous && previous.customTitle ? previous.title : normalizeNodeTitle(label.title || previous && previous.title || "").slice(0, 60);
			if (!title || title.toLowerCase() === topicName.toLowerCase()) title = topicName + (entry.index ? " – Vertiefung" : " – Grundlagen");
			const finalSubjectId = previous && previous.customSubject ? previous.subjectId : subjectId(group.subject);
			return {
				id: idAt[entry.index],
				subjectId: finalSubjectId,
				topicId: previous && previous.customTopic ? previous.topicId : topicId(group.subject, topicName), topicName, title,
				description: String(label.description || previous && previous.description || "").slice(0, 240),
				cardIds: entry.cluster.ids, pageIds: [...new Set(entry.cluster.ids.map((id) => cardsById.get(id) && cardsById.get(id).pageId).filter(Boolean))],
				prereqIds: [...new Set((label.prerequisites || []).map((i) => idAt[Number(i)]).filter((id) => id && id !== idAt[entry.index]).concat(previous && previous.manualPrereqIds || []))],
				manualPrereqIds: (previous && previous.manualPrereqIds || []).slice(),
				customTitle: !!(previous && previous.customTitle), customSubject: !!(previous && previous.customSubject), customTopic: !!(previous && previous.customTopic), center: entry.cluster.center,
			};
		}).concat(gapSpecs.map((gap) => {
			const title = normalizeNodeTitle(gap.title).slice(0, 60);
			if (!title) return null;
			const gapTopic = normalizeTopic(String(gap.topic || group.topic || "Grundlagen").trim().slice(0, 60), group.subject);
			return {
				id: "gap:" + hash(group.subject + "|" + gapTopic + "|" + title.toLowerCase()),
				subjectId: subjectId(group.subject), topicId: topicId(group.subject, gapTopic), topicName: gapTopic,
				title, description: String(gap.description || "Für dieses angrenzende Unterthema wurden keine Karten gefunden.").slice(0, 240),
				cardIds: [], pageIds: [], prereqIds: [], manualPrereqIds: [], relatedIds: (gap.connectTo || []).map((i) => idAt[Number(i)]).filter(Boolean),
				gap: true, customTitle: false, customSubject: false, customTopic: false, center: null,
			};
		}).filter(Boolean));
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
			if (!skills[i].center || !skills[j].center) continue;
			const score = cosine(skills[i].center || [], skills[j].center || []);
			if (score >= .62) candidates.push({ a: skills[i].id, b: skills[j].id, score });
		}
		candidates.sort((a, b) => b.score - a.score);
		const manual = (old && old.bridges || []).filter((edge) => edge.manual && skillById({ skills }, edge.a) && skillById({ skills }, edge.b));
		const gaps = skills.filter((skill) => skill.gap).flatMap((skill) => (skill.relatedIds || []).map((id) => ({ id: "bridge:" + hash([skill.id, id].sort().join("|")), a: skill.id, b: id, score: 1, gap: true, manual: false })));
		const degree = new Map(), semantic = [];
		for (const edge of candidates) {
			if ((degree.get(edge.a) || 0) >= 3 || (degree.get(edge.b) || 0) >= 3) continue;
			degree.set(edge.a, (degree.get(edge.a) || 0) + 1); degree.set(edge.b, (degree.get(edge.b) || 0) + 1);
			semantic.push({ id: "bridge:" + hash([edge.a, edge.b].sort().join("|")), ...edge, manual: false });
			if (semantic.length >= Math.min(36, skills.length * 2)) break;
		}
		const seen = new Set();
		return manual.concat(gaps, semantic).filter((edge) => { const key = [edge.a, edge.b].sort().join("|"); if (seen.has(key)) return false; seen.add(key); return true; });
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
			const taxonomy = await taxonomyFor(cards);
			setStatus("<b>Ordne Wissen</b><span>Lokales Clustering läuft außerhalb der Oberfläche.</span>", true);
			const groups = await clusterInWorker(cards, vectors, taxonomy);
			const old = S.settings.knowledgeGraph || null;
			const cardsById = new Map(cards.map((card) => [card.id, card]));
			const used = new Set(); let skills = [];
			for (const group of groups) skills.push(...await nameClusters(group, cardsById, old, used));
			skills = [...new Map(skills.map((skill) => [skill.id, skill])).values()];
			removeCycles(skills);
			const bridges = bridgesFor(skills, old);
			// Zentren sind nur ein Analyse-Zwischenergebnis. Sie zu synchronisieren würde
			// den kleinen Graph-Snapshot um mehrere Megabyte aufblasen.
			const storedSkills = skills.map(({ center, topicName, ...skill }) => skill);
			const subjects = [...new Map(groups.map((group) => [subjectId(group.subject), { id: subjectId(group.subject), name: group.subject }])).values()];
			const topics = [...new Map(skills.map((skill) => [skill.topicId, { id: skill.topicId, subjectId: skill.subjectId, name: skill.topicName || "Grundlagen" }])).values()];
			const next = {
				v: VERSION, updated: U.now(), model: S.settings.embedModel, sourceFingerprint: fingerprint(cards),
				subjects, topics,
				skills: storedSkills, bridges,
			};
			await STATE.dispatch("settingsSet", { knowledgeGraph: next });
			selectedId = null;
			setStatus("<b>Themenlandkarte aktualisiert</b><span>" + skills.filter((skill) => !skill.gap).length + " gelernte Unterthemen · " + skills.filter((skill) => skill.gap).length + " mögliche Lücken · " + cards.length + " Karten.</span>");
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
		const subject = (g.subjects || []).find((item) => item.id === skill.subjectId);
		const topic = (g.topics || []).find((item) => item.id === skill.topicId);
		const dim = query && ![skill.title, skill.description, subject && subject.name, topic && topic.name].join(" ").toLowerCase().includes(query.toLowerCase());
		return '<button type="button" class="graph-skill state-' + m.state + (selected ? " selected" : "") + (dim ? " dim" : "") + '" data-skill="' + U.esc(skill.id) + '" data-level="' + levelOf(skill, g) + '" style="--progress:' + Math.round(m.value * 100) + '%">' +
			'<span class="graph-skill-ring"></span><span class="graph-skill-copy"><b>' + U.esc(skill.title) + '</b><small>' + stateLabel(m) + (skill.gap ? " · keine Karten" : " · " + m.cards + " Karten") + '</small></span>' +
			(recommended && recommended.skill.id === skill.id ? '<span class="graph-next">Nächster Schritt</span>' : "") + '</button>';
	}

	function lanesHtml(g) {
		const rec = mode === "learn" ? recommendation(g) : null;
		return (g.subjects || []).map((subject) => {
			const skills = g.skills.filter((skill) => skill.subjectId === subject.id);
			const topicHtml = (g.topics || []).filter((topic) => topic.subjectId === subject.id).map((topic) => {
				const topicSkills = skills.filter((skill) => skill.topicId === topic.id);
				if (!topicSkills.length) return "";
				const levels = new Map();
				for (const skill of topicSkills) { const level = levelOf(skill, g); if (!levels.has(level)) levels.set(level, []); levels.get(level).push(skill); }
				const rows = [...levels.entries()].sort((a, b) => b[0] - a[0]).map(([level, list]) => '<div class="graph-level" data-level="' + level + '">' + list.map((skill) => nodeHtml(skill, g, rec)).join("") + '</div>').join("");
				const value = Math.round(topicSkills.reduce((sum, skill) => sum + mastery(skill).value, 0) / topicSkills.length * 100);
				return '<section class="graph-topic"><header><b>' + U.esc(topic.name) + '</b><span>' + value + '%</span></header><div class="graph-levels">' + rows + '</div></section>';
			}).join("");
			const avg = skills.length ? Math.round(skills.reduce((sum, skill) => sum + mastery(skill).value, 0) / skills.length * 100) : 0;
			return '<section class="graph-lane" data-subject="' + U.esc(subject.id) + '"><header><span>' + U.esc(subject.name) + '</span><small>' + avg + '%</small></header><div class="graph-topics">' + topicHtml + '</div></section>';
		}).join("");
	}

	function inspectorHtml(g) {
		const skill = skillById(g, selectedId);
		if (!skill) return '<div class="graph-inspector-empty"><b>Unterthema auswählen</b><span>Tippe auf einen Knoten, um Lernstand und fachliche Verbindungen zu sehen.</span></div>';
		const m = mastery(skill);
		const subject = g.subjects.find((item) => item.id === skill.subjectId);
		const topic = (g.topics || []).find((item) => item.id === skill.topicId);
		const prereqs = (skill.prereqIds || []).map((id) => skillById(g, id)).filter(Boolean);
		const related = (g.bridges || []).filter((edge) => edge.a === skill.id || edge.b === skill.id).map((edge) => ({ edge, skill: skillById(g, edge.a === skill.id ? edge.b : edge.a) })).filter((x) => x.skill);
		let html = '<div class="graph-inspector-head"><span>' + U.esc(subject && subject.name || "") + (topic ? " › " + U.esc(topic.name) : "") + '</span><button type="button" data-graph-inspector-close aria-label="Details schließen">×</button></div>' +
			'<h2>' + U.esc(skill.title) + '</h2><p>' + U.esc(skill.description || "Aus deinen Karten abgeleitetes Unterthema.") + '</p>' +
			'<div class="graph-mastery"><div><b>' + Math.round(m.value * 100) + '%</b><span>' + stateLabel(m) + '</span></div><div><b>' + m.due + '</b><span>jetzt fällig</span></div><div><b>' + m.rated + '/' + m.cards + '</b><span>bewertet</span></div></div>' +
			(skill.gap ? '<div class="graph-gap-note">Noch keine Karte deckt dieses Unterthema ab.</div>' : '<button type="button" class="primary graph-learn" data-graph-learn="' + U.esc(skill.id) + '">Zugehörige Karten lernen</button>');
		if (prereqs.length) html += '<h3>Voraussetzungen</h3><div class="graph-relations">' + prereqs.map((item) => '<button data-skill="' + U.esc(item.id) + '">' + U.esc(item.title) + '</button>').join("") + '</div>';
		if (related.length) html += '<h3>Verwandte Unterthemen</h3><div class="graph-relations">' + related.map((item) => '<button data-skill="' + U.esc(item.skill.id) + '">' + U.esc(item.skill.title) + '</button>').join("") + '</div><button type="button" data-graph-synth="' + U.esc(skill.id) + '">Verbindung als Synthese-Frage</button>';
		if (mode === "edit") {
			html += '<div class="graph-edit"><h3>Bearbeiten</h3><label>Name<input data-graph-title value="' + U.esc(skill.title) + '"></label>' +
				'<label>Fach › Thema<select data-graph-topic>' + (g.topics || []).map((item) => { const owner = g.subjects.find((subject2) => subject2.id === item.subjectId); return '<option value="' + U.esc(item.id) + '"' + (item.id === skill.topicId ? " selected" : "") + '>' + U.esc((owner && owner.name || "") + " › " + item.name) + '</option>'; }).join("") + '</select></label>' +
				'<button type="button" data-graph-save="' + U.esc(skill.id) + '">Änderungen speichern</button>' +
				'<div class="graph-edit-links"><button type="button" data-graph-link="bridge">Unterthemen verbinden</button><button type="button" data-graph-link="prereq">Als Voraussetzung verbinden</button></div></div>';
		}
		return html;
	}

	function render() {
		if (!overlay) return;
		const g = visibleGraph();
		const stage = overlay.querySelector(".graph-stage");
		const inspector = overlay.querySelector(".graph-inspector");
		if (!g || !g.skills || !g.skills.length) {
			stage.innerHTML = '<div class="graph-empty"><span>✦</span><h2>Baue deine Themenlandkarte</h2><p>Die KI ordnet deine Karten in Fächer, Teilgebiete und verknüpfte Unterthemen.</p><button type="button" class="primary" data-graph-analyse>Jetzt analysieren</button></div>';
			inspector.innerHTML = "";
			return;
		}
		stage.innerHTML = '<svg class="graph-lines" aria-hidden="true"></svg><div class="graph-lanes">' + lanesHtml(g) + '</div>';
		inspector.innerHTML = inspectorHtml(g);
		overlay.classList.toggle("inspector-open", !!selectedId);
		requestAnimationFrame(drawLines);
	}

	function drawLines() {
		const g = visibleGraph(), stage = overlay && overlay.querySelector(".graph-stage"), svg = stage && stage.querySelector(".graph-lines");
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
		for (const edge of g.bridges || []) if (mode === "learn" || selectedId === edge.a || selectedId === edge.b) html += path(edge.a, edge.b, "bridge" + (edge.gap ? " gap" : ""));
		svg.setAttribute("width", Math.max(stage.scrollWidth, stage.clientWidth));
		svg.setAttribute("height", Math.max(stage.scrollHeight, stage.clientHeight));
		svg.innerHTML = html;
	}

	async function saveSkill(id) {
		const g = structuredClone(graph()), skill = skillById(g, id);
		if (!skill) return;
		const title = String((overlay.querySelector("[data-graph-title]") || {}).value || "").trim();
		const topicIdValue = String((overlay.querySelector("[data-graph-topic]") || {}).value || "");
		if (title) { skill.title = title.slice(0, 60); skill.customTitle = true; }
		const topic = (g.topics || []).find((item) => item.id === topicIdValue);
		if (topic && (skill.topicId !== topic.id || skill.subjectId !== topic.subjectId)) {
			skill.topicId = topic.id; skill.subjectId = topic.subjectId;
			skill.customTopic = true; skill.customSubject = true;
		}
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
		const g = visibleGraph(), skill = skillById(g, id);
		if (!skill) return;
		const counts = new Map();
		for (const cardId of skill.cardIds || []) {
			const card = S.cards[cardId]; if (!card || card.trashed || STATE.isCardArchived(card)) continue;
			const deck = deckName(card); counts.set(deck, (counts.get(deck) || 0) + 1);
		}
		const deck = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
		S.ankiDeck = deck === "Standard" ? null : deck;
		S.ankiTab = "study"; S.ankiMix = false; S.ankiFeyn = false;
		S.reviewCardId = null; S.reviewShowBack = false;
		close(); TABS.openPage("anki:main");
	}

	async function synthesize(id) {
		const g = visibleGraph(), skill = skillById(g, id);
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
		overlay.innerHTML = '<header class="graph-head"><div class="graph-brand"><span>✦</span><div><h1>Wissensgraph</h1><small>Deine Themenlandkarte</small></div></div>' +
			'<nav class="graph-modes" aria-label="Graph-Modus"><button data-mode="explore" class="active">Erkunden</button><button data-mode="learn">Lernen</button><button data-mode="edit">Bearbeiten</button></nav>' +
			'<div class="graph-actions"><label class="graph-search"><span>⌕</span><input type="search" placeholder="Unterthemen suchen" autocomplete="off"></label><button type="button" data-graph-analyse title="Analyse aktualisieren">↻</button><button type="button" data-graph-close aria-label="Schließen">×</button></div></header>' +
			'<div class="graph-status" hidden></div><main class="graph-shell"><div class="graph-stage"></div><aside class="graph-inspector"></aside></main>';
		document.body.appendChild(overlay);
		overlay.addEventListener("click", onClick);
		overlay.querySelector(".graph-search input").addEventListener("input", (event) => { query = event.target.value || ""; render(); });
		overlay.querySelector(".graph-stage").addEventListener("scroll", () => requestAnimationFrame(drawLines), { passive: true });
		resizeObserver = new ResizeObserver(() => requestAnimationFrame(drawLines));
		resizeObserver.observe(overlay.querySelector(".graph-stage"));
		const g = graph();
		if (g && isStale(g)) setStatus('<b>Neue Lerninhalte erkannt</b><span>Die Themenlandkarte kann kontrolliert aktualisiert werden.</span><button type="button" data-graph-analyse>Jetzt aktualisieren</button>');
		else if (!g) {
			const old = U.storage.getJson(OLD_KEY, null);
			if (old && old.topics) setStatus("<b>Alter Wissensgraph erkannt</b><span>Die neue Analyse ordnet deine Karten als verknüpfte Unterthemen.</span>");
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
