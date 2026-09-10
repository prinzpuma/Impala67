// mcp/store.mjs - Lokale Datenhaltung, Reducer und Tool-Handler für Impala67 MCP-Server
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const DEFAULT_STORAGE_FILE = resolve(__dirname, ".storage.json");

// Bekannte Schulfächer für automatische Fach-Zuordnung
const SUBJECT_KEYWORDS = {
	"Mathematik": ["mathe", "mathematik", "algebra", "geometrie", "analysis", "stochastik", "vektoren", "ableitung", "integral", "gleichung", "kurvendiskussion"],
	"Deutsch": ["deutsch", "literatur", "grammatik", "erörterung", "gedicht", "lyrik", "epik", "dramatik", "sachtext", "interpretation", "aufsatz"],
	"Englisch": ["englisch", "english", "vocab", "vocabulary", "grammar", "comprehension", "tenses"],
	"Physik": ["physik", "physics", "mechanik", "optik", "thermodynamik", "quantenphysik", "magnetismus", "gravitation", "stromkreis", "energie"],
	"Chemie": ["chemie", "chemistry", "anorganik", "organik", "periodensystem", "reaktion", "säuren", "basen", "moleküle", "titration"],
	"Biologie": ["biologie", "bio", "biology", "genetik", "ökologie", "zellbiologie", "evolution", "neurobiologie", "fotosynthese", "dna"],
	"Geschichte": ["geschichte", "history", "weimarer", "mittelalter", "antike", "weltkrieg", "revolution", "kaiserreich"],
	"Geografie": ["geografie", "geographie", "erdkunde", "geography", "klimazonen", "vulkanismus", "plattentektonik", "kartografie"],
	"Informatik": ["informatik", "computer", "programmierung", "python", "javascript", "algorithmen", "datenbanken", "sql", "netzwerke"],
	"Wirtschaft": ["wirtschaft", "bwl", "vwl", "ökonomie", "finanzen", "unternehmen", "marketing", "inflation", "bilanz"],
	"Kunst": ["kunst", "art", "malerei", "skulptur", "farbtheorie", "perspektive", "design"],
	"Musik": ["musik", "music", "harmonielehre", "noten", "akkord", "rhythmus", "partitur"],
	"Religion / Ethik": ["religion", "ethik", "philosophie", "moral", "theologie", "werte"],
	"Französisch": ["französisch", "franzoesisch", "français", "french", "vocabulaire"],
	"Spanisch": ["spanisch", "español", "spanish", "vocabulario"],
	"Latein": ["latein", "latin", "deklination", "konjugation", "vokabeln"],
	"Sport": ["sport", "trainingslehre", "bewegungslehre", "fitness"],
};

/**
 * Ermittelt das Fach einer Notiz anhand von explizitem Feld, Tags, Titel oder Inhalt.
 */
export function detectSubject(page) {
	if (!page) return "Allgemein";
	if (page.subject && String(page.subject).trim()) {
		return String(page.subject).trim();
	}

	// Tags prüfen (z.B. "fach: Physik" oder "Mathematik")
	if (Array.isArray(page.tags)) {
		for (const tag of page.tags) {
			const str = String(tag || "").trim();
			const match = str.match(/^(?:fach|subject)\s*:\s*(.+)$/i);
			if (match && match[1]) return match[1].trim();
			for (const subj of Object.keys(SUBJECT_KEYWORDS)) {
				if (subj.toLowerCase() === str.toLowerCase()) return subj;
			}
		}
	}

	const haystack = `${page.title || ""} ${(page.content || "").slice(0, 1000)}`.toLowerCase();
	for (const [subj, keywords] of Object.entries(SUBJECT_KEYWORDS)) {
		if (keywords.some((kw) => haystack.includes(kw))) {
			return subj;
		}
	}

	return "Allgemein";
}

/**
 * Erstellt den Notiz- und Kartenspeicher.
 */
export function createStore(opts = {}) {
	const storagePath = opts.storagePath || DEFAULT_STORAGE_FILE;

	const state = {
		pages: {},
		cards: {},
		heftDocs: {},
		events: [],
		meta: {
			lastSyncedSeq: 0,
			lastUploadedSeq: 0,
			generation: 0,
		},
	};

	function loadFromDisk() {
		if (!existsSync(storagePath)) return;
		try {
			const raw = readFileSync(storagePath, "utf8");
			const data = JSON.parse(raw);
			if (data && typeof data === "object") {
				if (data.pages) state.pages = data.pages;
				if (data.cards) state.cards = data.cards;
				if (data.heftDocs) state.heftDocs = data.heftDocs;
				if (Array.isArray(data.events)) state.events = data.events;
				if (data.meta) Object.assign(state.meta, data.meta);
			}
		} catch (err) {
			console.error("[impala-mcp-store] Fehler beim Laden von .storage.json:", err.message);
		}
	}

	function saveToDisk() {
		try {
			writeFileSync(storagePath, JSON.stringify(state, null, 2), "utf8");
		} catch (err) {
			console.error("[impala-mcp-store] Fehler beim Speichern in .storage.json:", err.message);
		}
	}

	function reduce(ev) {
		if (!ev || typeof ev !== "object") return;
		const p = ev.payload || {};
		const t = ev.t || new Date().toISOString();

		switch (ev.type) {
			case "pageCreate": {
				if (!p.id) break;
				const kind = p.kind === "heft" ? "heft" : "notion";
				state.pages[p.id] = {
					id: p.id,
					title: p.title || "Ohne Titel",
					parentId: p.parentId || null,
					content: p.content || "",
					kind,
					subject: p.subject || null,
					tags: Array.isArray(p.tags) ? p.tags : [],
					created: p.created || t,
					updated: p.updated || t,
					trashed: false,
				};
				if (kind === "heft" && !state.heftDocs[p.id]) {
					state.heftDocs[p.id] = {
						pages: [
							{
								id: `${p.id}-p1`,
								paper: "lined",
								strokes: [],
								images: [],
								texts: p.content ? [{ id: crypto.randomUUID(), text: p.content, x: 20, y: 50 }] : [],
								ocrText: p.content || "",
							},
						],
					};
				}
				break;
			}
			case "pageUpdate": {
				const pg = state.pages[p.id];
				if (!pg) break;
				const patch = p.patch || {};
				Object.assign(pg, patch);
				pg.updated = t;
				break;
			}
			case "pageMove": {
				const pg = state.pages[p.id];
				if (!pg) break;
				pg.parentId = p.parentId || null;
				pg.updated = t;
				break;
			}
			case "pageTrash": {
				const pg = state.pages[p.id];
				if (!pg) break;
				pg.trashed = true;
				pg.trashedAt = t;
				break;
			}
			case "pageRestore": {
				const pg = state.pages[p.id];
				if (!pg) break;
				pg.trashed = false;
				delete pg.trashedAt;
				break;
			}
			case "pageDelete": {
				delete state.pages[p.id];
				delete state.heftDocs[p.id];
				break;
			}
			case "cardCreate": {
				if (!p.id) break;
				state.cards[p.id] = {
					id: p.id,
					front: p.front || "",
					back: p.back || "",
					deck: p.deck || "Standard",
					pageId: p.pageId || null,
					state: (p.srs && p.srs.state) || "new",
					created: p.created || t,
					trashed: false,
				};
				break;
			}
			case "cardUpdate": {
				const c = state.cards[p.id];
				if (!c) break;
				if (p.patch) Object.assign(c, p.patch);
				break;
			}
			case "cardTrash": {
				const c = state.cards[p.id];
				if (!c) break;
				c.trashed = true;
				c.trashedAt = t;
				break;
			}
			case "cardRestore": {
				const c = state.cards[p.id];
				if (!c) break;
				c.trashed = false;
				delete c.trashedAt;
				break;
			}
			case "cardDelete": {
				delete state.cards[p.id];
				break;
			}
			case "heftOps": {
				const doc = state.heftDocs[p.pageId];
				if (!doc || !Array.isArray(p.ops)) break;
				const pages = doc.pages || [];
				for (const op of p.ops) {
					if (!op) continue;
					if (op.t === "pg+") {
						pages.splice(op.at ?? pages.length, 0, {
							id: op.page?.id || crypto.randomUUID(),
							paper: op.page?.paper || "lined",
							strokes: [],
							images: [],
							texts: [],
							ocrText: "",
						});
					} else if (op.t === "pg-") {
						const idx = pages.findIndex((pg) => pg.id === op.p);
						if (idx !== -1) pages.splice(idx, 1);
					} else if (op.t === "ocr") {
						const pg = pages.find((page) => page.id === op.p) || pages[0];
						if (pg) pg.ocrText = String(op.text || "");
					} else if (op.t === "x+") {
						const pg = pages.find((page) => page.id === op.p) || pages[0];
						if (pg) {
							if (!pg.texts) pg.texts = [];
							pg.texts.push(op.o);
						}
					} else if (op.t === "s+") {
						const pg = pages.find((page) => page.id === op.p) || pages[0];
						if (pg) {
							if (!pg.strokes) pg.strokes = [];
							pg.strokes.push(op.o);
						}
					}
				}
				break;
			}
			case "heftSnap": {
				if (p.pageId && p.doc) {
					state.heftDocs[p.pageId] = p.doc;
				}
				break;
			}
		}
	}

	function applyEvent(ev, shouldPersist = true) {
		state.events.push(ev);
		reduce(ev);
		if (shouldPersist) saveToDisk();
	}

	function findPage(idOrTitle) {
		if (!idOrTitle) return null;
		const query = String(idOrTitle).trim();
		if (state.pages[query] && !state.pages[query].trashed) return state.pages[query];

		const lower = query.toLowerCase();
		const all = Object.values(state.pages).filter((p) => !p.trashed);

		// Exakter Titel-Treffer
		const exact = all.find((p) => (p.title || "").toLowerCase() === lower);
		if (exact) return exact;

		// Beginnt mit
		const starts = all.find((p) => (p.title || "").toLowerCase().startsWith(lower));
		if (starts) return starts;

		// Enthält
		return all.find((p) => (p.title || "").toLowerCase().includes(lower)) || null;
	}

	function extractHeftText(pageId) {
		const doc = state.heftDocs[pageId];
		if (!doc || !Array.isArray(doc.pages)) return "";
		const parts = [];
		for (let i = 0; i < doc.pages.length; i++) {
			const pg = doc.pages[i];
			const pageParts = [];
			if (pg.ocrText && pg.ocrText.trim()) {
				pageParts.push(pg.ocrText.trim());
			}
			if (Array.isArray(pg.texts)) {
				for (const item of pg.texts) {
					if (item?.text && String(item.text).trim()) {
						pageParts.push(String(item.text).trim());
					}
				}
			}
			if (pageParts.length) {
				parts.push(`--- Seite ${i + 1} ---\n${pageParts.join("\n")}`);
			}
		}
		return parts.join("\n\n");
	}

	// Initial laden
	loadFromDisk();

	return {
		getState: () => state,
		saveToDisk,
		applyEvent,

		/**
		 * Wendet eine Liste von Remote-Events aus dem Cloudflare-Sync an.
		 */
		applyRemoteEvents(remoteEvents, newMaxSeq, generation) {
			let applied = 0;
			const knownIds = new Set(state.events.map((e) => e.id));
			for (const ev of remoteEvents || []) {
				if (!ev?.id || knownIds.has(ev.id)) continue;
				knownIds.add(ev.id);
				state.events.push(ev);
				reduce(ev);
				applied++;
			}
			if (newMaxSeq) state.meta.lastSyncedSeq = newMaxSeq;
			if (generation) state.meta.generation = generation;
			if (applied > 0 || newMaxSeq) saveToDisk();
			return applied;
		},

		// ==========================================
		// MCP Tool Handler
		// ==========================================

		/**
		 * impala_list_pages
		 */
		listPages({ query, kind, subject, limit = 50 } = {}) {
			let pool = Object.values(state.pages).filter((p) => !p.trashed);

			if (kind && kind !== "all") {
				pool = pool.filter((p) => (p.kind === "heft" ? "heft" : "notion") === kind);
			}

			if (subject) {
				const sQuery = String(subject).trim().toLowerCase();
				pool = pool.filter((p) => detectSubject(p).toLowerCase() === sQuery);
			}

			if (query) {
				const q = String(query).trim().toLowerCase();
				pool = pool.filter((p) => {
					const title = (p.title || "").toLowerCase();
					const content = (p.content || "").toLowerCase();
					const subj = detectSubject(p).toLowerCase();
					return title.includes(q) || content.includes(q) || subj.includes(q);
				});
			}

			pool.sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")));

			const count = Math.max(1, Math.min(200, Number(limit) || 50));
			const results = pool.slice(0, count).map((p) => ({
				id: p.id,
				title: p.title || "Ohne Titel",
				kind: p.kind === "heft" ? "heft" : "notion",
				subject: detectSubject(p),
				parentId: p.parentId || null,
				updated: p.updated || p.created || null,
				created: p.created || null,
			}));

			return {
				total: pool.length,
				count: results.length,
				pages: results,
			};
		},

		/**
		 * impala_get_page
		 */
		getPage({ id, title } = {}) {
			const pg = findPage(id || title);
			if (!pg) {
				return { error: `Notiz nicht gefunden: ${id || title || "(keine Angabe)"}` };
			}

			const subject = detectSubject(pg);

			if (pg.kind === "heft") {
				const text = extractHeftText(pg.id);
				const doc = state.heftDocs[pg.id];
				return {
					id: pg.id,
					title: pg.title,
					kind: "heft",
					subject,
					content: text,
					heftPages: doc?.pages?.length || 1,
					note: "Handschrift-Heft: content enthält extrahierten Text & OCR. Vektorstriche bleiben geschützt.",
					updated: pg.updated,
					created: pg.created,
					tags: pg.tags || [],
				};
			}

			return {
				id: pg.id,
				title: pg.title,
				kind: "notion",
				subject,
				content: pg.content || "",
				updated: pg.updated,
				created: pg.created,
				tags: pg.tags || [],
			};
		},

		/**
		 * impala_create_page
		 */
		createPage({ title, content = "", subject, parent_title, parentId, kind = "notion" } = {}) {
			const cleanTitle = String(title || "").trim();
			if (!cleanTitle) return { error: "create_page: title ist ein Pflichtfeld." };

			let parent = null;
			if (parentId || parent_title) {
				parent = findPage(parentId || parent_title);
				if (!parent) return { error: `Übergeordnete Seite nicht gefunden: ${parentId || parent_title}` };
			}

			const id = crypto.randomUUID();
			const now = new Date().toISOString();
			const isHeft = kind === "heft";

			const event = {
				id: crypto.randomUUID(),
				t: now,
				type: "pageCreate",
				payload: {
					id,
					title: cleanTitle,
					content: isHeft ? "" : String(content || ""),
					kind: isHeft ? "heft" : "notion",
					subject: subject ? String(subject).trim() : null,
					parentId: parent ? parent.id : null,
					created: now,
				},
			};

			applyEvent(event);

			// Bei Heften ggf. anfänglichen Text als Textbox einfügen
			if (isHeft && content && String(content).trim()) {
				const textOpEvent = {
					id: crypto.randomUUID(),
					t: now,
					type: "heftOps",
					payload: {
						pageId: id,
						ops: [
							{
								t: "x+",
								p: `${id}-p1`,
								o: { id: crypto.randomUUID(), text: String(content).trim(), x: 20, y: 50 },
							},
							{
								t: "ocr",
								p: `${id}-p1`,
								text: String(content).trim(),
							},
						],
					},
				};
				applyEvent(textOpEvent);
			}

			return {
				ok: true,
				id,
				title: cleanTitle,
				kind: isHeft ? "heft" : "notion",
				subject: detectSubject(state.pages[id]),
				parentId: parent ? parent.id : null,
				createdEvent: event,
			};
		},

		/**
		 * impala_update_page
		 */
		updatePage({ id, title, new_title, content, append_content, subject } = {}) {
			const pg = findPage(id || title);
			if (!pg) return { error: `Notiz nicht gefunden: ${id || title || "(keine Angabe)"}` };

			const now = new Date().toISOString();
			const eventsToEmit = [];

			const patch = {};
			if (new_title && String(new_title).trim()) patch.title = String(new_title).trim();
			if (subject !== undefined) patch.subject = String(subject || "").trim() || null;

			if (pg.kind === "heft") {
				// HEFT-SCHUTZ: Vektorstriche niemals überschreiben!
				const textToAdd = append_content || (content !== undefined ? content : null);
				if (textToAdd && String(textToAdd).trim()) {
					const doc = state.heftDocs[pg.id] || { pages: [{ id: `${pg.id}-p1` }] };
					const firstPageId = doc.pages?.[0]?.id || `${pg.id}-p1`;
					const heftEvent = {
						id: crypto.randomUUID(),
						t: now,
						type: "heftOps",
						payload: {
							pageId: pg.id,
							ops: [
								{
									t: "x+",
									p: firstPageId,
									o: { id: crypto.randomUUID(), text: String(textToAdd).trim(), x: 20, y: 50 },
								},
							],
						},
					};
					eventsToEmit.push(heftEvent);
					applyEvent(heftEvent);
				}
			} else {
				// Normales Markdown-Dokument
				if (append_content) {
					const existing = pg.content || "";
					patch.content = (existing ? existing + "\n\n" : "") + String(append_content).trim();
				} else if (content !== undefined) {
					patch.content = String(content || "");
				}
			}

			if (Object.keys(patch).length) {
				const updateEvent = {
					id: crypto.randomUUID(),
					t: now,
					type: "pageUpdate",
					payload: { id: pg.id, patch },
				};
				eventsToEmit.push(updateEvent);
				applyEvent(updateEvent);
			}

			return {
				ok: true,
				id: pg.id,
				title: pg.title,
				kind: pg.kind,
				subject: detectSubject(pg),
				updatedEvents: eventsToEmit,
			};
		},

		/**
		 * impala_search
		 */
		search({ query, limit = 20 } = {}) {
			const q = String(query || "").trim().toLowerCase();
			if (!q) return { results: [], totalMatches: 0 };

			const results = [];

			// 1. Notizen durchsuchen
			for (const p of Object.values(state.pages)) {
				if (p.trashed) continue;
				const title = p.title || "";
				const content = p.kind === "heft" ? extractHeftText(p.id) : (p.content || "");
				const subj = detectSubject(p);

				const titleMatch = title.toLowerCase().includes(q);
				const contentMatch = content.toLowerCase().includes(q);
				const subjMatch = subj.toLowerCase().includes(q);

				if (titleMatch || contentMatch || subjMatch) {
					let snippet = "";
					if (contentMatch) {
						const idx = content.toLowerCase().indexOf(q);
						const start = Math.max(0, idx - 40);
						const end = Math.min(content.length, idx + q.length + 60);
						snippet = (start > 0 ? "…" : "") + content.slice(start, end).replace(/\s+/g, " ") + (end < content.length ? "…" : "");
					} else {
						snippet = content.slice(0, 100).replace(/\s+/g, " ");
					}

					results.push({
						type: "page",
						id: p.id,
						title,
						kind: p.kind === "heft" ? "heft" : "notion",
						subject: subj,
						snippet,
					});
				}
			}

			// 2. Karteikarten durchsuchen
			for (const c of Object.values(state.cards)) {
				if (c.trashed) continue;
				const front = c.front || "";
				const back = c.back || "";
				if (front.toLowerCase().includes(q) || back.toLowerCase().includes(q)) {
					results.push({
						type: "flashcard",
						id: c.id,
						deck: c.deck || "Standard",
						front,
						back,
						snippet: `${front} → ${back}`,
					});
				}
			}

			const max = Math.max(1, Math.min(100, Number(limit) || 20));
			return {
				query: q,
				totalMatches: results.length,
				results: results.slice(0, max),
			};
		},

		/**
		 * impala_list_flashcards
		 */
		listFlashcards({ deck, query, limit = 50 } = {}) {
			let pool = Object.values(state.cards).filter((c) => !c.trashed);

			if (deck) {
				const d = String(deck).trim().toLowerCase();
				pool = pool.filter((c) => (c.deck || "Standard").toLowerCase().includes(d));
			}

			if (query) {
				const q = String(query).trim().toLowerCase();
				pool = pool.filter((c) => (c.front || "").toLowerCase().includes(q) || (c.back || "").toLowerCase().includes(q));
			}

			const max = Math.max(1, Math.min(200, Number(limit) || 50));
			const cards = pool.slice(0, max).map((c) => ({
				id: c.id,
				front: c.front,
				back: c.back,
				deck: c.deck || "Standard",
				state: c.state || "new",
				created: c.created || null,
			}));

			return {
				total: pool.length,
				count: cards.length,
				cards,
			};
		},

		/**
		 * impala_create_flashcard
		 */
		createFlashcard({ front, back, deck = "Standard", page_title } = {}) {
			const cleanFront = String(front || "").trim();
			const cleanBack = String(back || "").trim();
			if (!cleanFront || !cleanBack) {
				return { error: "create_flashcard: front und back dürfen nicht leer sein." };
			}

			let page = null;
			if (page_title) {
				page = findPage(page_title);
			}

			const id = crypto.randomUUID();
			const now = new Date().toISOString();
			const cleanDeck = String(deck || "Standard").trim() || "Standard";

			const event = {
				id: crypto.randomUUID(),
				t: now,
				type: "cardCreate",
				payload: {
					id,
					front: cleanFront,
					back: cleanBack,
					deck: cleanDeck,
					pageId: page ? page.id : null,
					created: now,
				},
			};

			applyEvent(event);

			return {
				ok: true,
				id,
				front: cleanFront,
				back: cleanBack,
				deck: cleanDeck,
				pageId: page ? page.id : null,
				createdEvent: event,
			};
		},
	};
}
