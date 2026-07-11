"use strict";
import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { EXTRAS } from "./extras.js";
import { RAG } from "./rag.js";
import { NLM } from "./notebooklm.js";
// tools.js — Die Werkzeuge der KI (OpenAI-Function-Calling-Format).
// Darüber kann die KI Seiten lesen/anlegen/ändern und Karteikarten erstellen.
export const TOOLS = (() => {
	const t = (name, description, properties, required) => ({
		type: "function",
		function: { name, description, parameters: { type: "object", properties, required } },
	});

	// Cloze-Beispielsyntax zusammengesetzt, damit die doppelt geschweiften Klammern
	// nirgends mit Template-/Platzhalter-Systemen kollidieren.
	const CLOZE_HINT = "{" + "{c1::Antwort}" + "}";

	// ask_choice: Argumente säubern/validieren (vom Agent-Loop vor der UI genutzt).
	// - leere/doppelte Optionen raus
	// - max. 5, min. 2
	// - Frage Pflicht
	function normalizeAskChoice(a) {
		a = a || {};
		const question = String(a.question || "").trim();
		const raw = Array.isArray(a.options) ? a.options : [];
		const seen = new Set();
		const options = [];
		for (const o of raw) {
			const s = String(o == null ? "" : o).trim();
			if (!s) continue;
			const key = s.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			options.push(s);
			if (options.length >= 5) break;
		}
		if (!question) return { error: "ask_choice: Frage fehlt." };
		if (options.length < 2) {
			return { error: "ask_choice: mindestens 2 kurze Optionen nötig (max. 5)." };
		}
		return { question, options };
	}

	// Karte anhand des Vorderseiten-Texts finden (analog zu STATE.findPage) — exakter
	// Treffer zuerst, sonst "beginnt mit", sonst "enthält". Optional auf einen Stapel
	// (inkl. Unterstapel) eingegrenzt.
	function findCard(front, deck) {
		if (!front) return null;
		const q = String(front).trim().toLowerCase();
		if (!q) return null;
		const pool = STATE.activeCards().filter((c) => {
			if (!deck) return true;
			const d = c.deck || "Standard";
			return d === deck || d.startsWith(deck + "::");
		});
		let starts = null, partial = null;
		for (const c of pool) {
			const t = (c.front || "").toLowerCase();
			if (t === q) return c;
			if (!starts && t.startsWith(q)) starts = c;
			if (!partial && t.includes(q)) partial = c;
		}
		return starts || partial;
	}

	// Stapelnamen case-insensitive auflösen (exakt, sonst "enthält") — analog zu findCard.
	function resolveDeckName(name) {
		if (!name) return null;
		const q = String(name).trim().toLowerCase();
		if (!q) return null;
		const names = Object.keys(S.decks);
		return names.find((n) => n.toLowerCase() === q) || names.find((n) => n.toLowerCase().includes(q)) || null;
	}

	const defs = [
		t("create_page", "Erstellt eine neue Notiz-Seite.", {
			title: { type: "string" },
			parent_title: { type: "string", description: "Titel der Elternseite (optional)" },
			content: { type: "string", description: "Markdown-Inhalt" },
		}, ["title"]),
		t("append_to_page", "Hängt Markdown an eine bestehende Seite an.", {
			page_title: { type: "string" },
			content: { type: "string" },
		}, ["page_title", "content"]),
		t("replace_page_content", "Ersetzt den kompletten Inhalt einer Seite (vorsichtig verwenden).", {
			page_title: { type: "string" },
			content: { type: "string" },
		}, ["page_title", "content"]),
		t("move_page", "Verschiebt eine Seite unter eine andere Elternseite.", {
			page_title: { type: "string" },
			new_parent_title: { type: "string", description: "Leer lassen für oberste Ebene" },
		}, ["page_title"]),
		t("delete_page", "Verschiebt eine Seite (inkl. aller Unterseiten) in den Papierkorb. Wiederherstellbar. Im Chat erscheint zwingend eine Bestätigung — erst nach Klick auf „Ja, löschen“ wird gelöscht. Nie raten: bei mehrdeutigen Titeln zuerst ask_choice.", {
			page_title: { type: "string", description: "Titel der zu löschenden Seite" },
		}, ["page_title"]),
		t("delete_flashcard", "Verschiebt EINE Karteikarte in den Papierkorb. Wiederherstellbar. Im Chat erscheint zwingend eine Bestätigung — erst nach Klick auf „Ja, löschen“ wird gelöscht. Nie raten: bei mehrdeutigem Text zuerst ask_choice.", {
			front: { type: "string", description: "Text bzw. Anfang der Vorderseite zur Identifikation der Karte" },
			deck: { type: "string", description: "Stapel zur Eingrenzung, falls mehrere Karten ähnlichen Text haben (optional)" },
		}, ["front"]),
		t("delete_deck", "Verschiebt einen Karteikarten-Stapel (inkl. Unterstapel und ALLER enthaltenen Karten) in den Papierkorb. Wiederherstellbar. Im Chat erscheint zwingend eine Bestätigung — erst nach Klick auf „Ja, löschen“ wird gelöscht. Nie raten: bei mehrdeutigen Namen zuerst ask_choice.", {
			deck: { type: "string", description: "Name des Stapels, Unterstapel per 'Eltern::Kind'" },
		}, ["deck"]),
		t("read_page", "Liest den Inhalt einer Seite.", {
			page_title: { type: "string" },
		}, ["page_title"]),
		t("list_pages", "Listet alle Seiten mit Elternseite.", {}, []),
		t("search_notes", "Volltextsuche über alle Notizen.", {
			query: { type: "string" },
		}, ["query"]),
		t("semantic_search", "Semantische Suche über alle Notizen (Embeddings; besser für inhaltliche Fragen).", {
			query: { type: "string" },
		}, ["query"]),
		t("create_flashcard", "Erstellt EINE Karteikarte für die Spaced-Repetition-Wiederholung. Beide Seiten sind volles Markdown — nutze aktiv LaTeX ($…$), Codeblöcke, Tabellen und Mermaid-Diagramme (```mermaid), wenn das das Verständnis verbessert (Abläufe, Hierarchien, Vergleiche). Regeln für gute Karten: eine Karte = ein Fakt (Minimum Information Principle), Vorderseite = eine konkrete Frage, Rückseite kurz + optional Beispiel/Diagramm. Für mehrere Karten create_flashcards verwenden.", {
			front: { type: "string", description: "Frage / Vorderseite (Markdown)" },
			back: { type: "string", description: "Antwort / Rückseite (Markdown, gern mit Formel, Codeblock oder Mermaid-Diagramm)" },
			deck: { type: "string", description: "Zielstapel, Unterstapel per 'Eltern::Kind' (optional, Standard: 'Standard')" },
			page_title: { type: "string", description: "Zugehörige Seite (optional)" },
		}, ["front", "back"]),
		t("create_flashcards", "Erstellt MEHRERE Karteikarten auf einmal — bevorzugt gegenüber vielen einzelnen create_flashcard-Aufrufen. Gleiche Markdown-Möglichkeiten und Qualitätsregeln wie create_flashcard (LaTeX, Codeblöcke, Tabellen, Mermaid-Diagramme; eine Karte = ein Fakt).", {
			cards: {
				type: "array",
				items: { type: "object", properties: { front: { type: "string" }, back: { type: "string" } }, required: ["front", "back"] },
				description: "Liste der Karten (front + back, jeweils Markdown)",
			},
			deck: { type: "string", description: "Zielstapel für alle Karten, Unterstapel per 'Eltern::Kind' (optional)" },
			page_title: { type: "string", description: "Zugehörige Seite (optional)" },
		}, ["cards"]),
		t("create_cloze_card", "Erstellt Lückentext-Karteikarten (Cloze). Lücken im Text als " + CLOZE_HINT + " markieren — pro Lücken-Nummer (c1, c2, …) entsteht eine eigene Karte.", {
			text: { type: "string", description: "Text mit Cloze-Lücken" },
			deck: { type: "string", description: "Zielstapel, Unterstapel per 'Eltern::Kind' (optional)" },
			page_title: { type: "string", description: "Zugehörige Seite (optional)" },
		}, ["text"]),
		t("list_due_cards", "Listet aktuell fällige Karteikarten.", {}, []),
		t("send_to_notebooklm", "Bereitet Notiz-Seiten als NotebookLM-Quelle vor: kopiert ihre Inhalte in die Zwischenablage und öffnet NotebookLM — dort nur noch „Quelle hinzufügen → Kopierter Text“ wählen und einfügen. Nützlich, wenn Lernpodcasts oder Lernvideos zu Seiten erstellt werden sollen.", {
			page_titles: { type: "array", items: { type: "string" }, description: "Titel der Seiten (leer = aktuelle Seite)" },
		}, []),
		t("ask_choice", "Stellt EINE kurze Rückfrage mit 2–5 anklickbaren Optionen und wartet auf die Auswahl. NUR bei echter Mehrdeutigkeit (z.B. mehrere passende Seiten). Keine Ja/Nein-Floskeln, keine Meta-Fragen. Optionen müssen vollständig und sofort nutzbar sein (keine Platzhalter).",
			{
				question: { type: "string", description: "Eine kurze, konkrete Frage (1 Satz)" },
				options: {
					type: "array",
					items: { type: "string" },
					minItems: 2,
					maxItems: 5,
					description: "2–5 kurze, eindeutige Antwortoptionen",
				},
			}, ["question", "options"]),
	];

	async function run(name, a) {
		a = a || {};
		switch (name) {
			case "create_page": {
				const parent = a.parent_title ? STATE.findPage(a.parent_title) : null;
				const id = U.uid();
				await STATE.dispatch("pageCreate", {
					id, title: a.title, parentId: parent ? parent.id : null, content: a.content || "",
					workspaceId: S.currentWorkspaceId,
				});
				return { ok: true, title: a.title, parent: parent ? parent.title : null };
			}
			case "append_to_page": {
				const pg = STATE.findPage(a.page_title);
				if (!pg) return { error: "Seite nicht gefunden: " + a.page_title };
				await STATE.dispatch("pageUpdate", {
					id: pg.id, patch: { content: (pg.content ? pg.content + "\n\n" : "") + a.content },
				});
				return { ok: true, title: pg.title };
			}
			case "replace_page_content": {
				const pg = STATE.findPage(a.page_title);
				if (!pg) return { error: "Seite nicht gefunden: " + a.page_title };
				await STATE.dispatch("pageUpdate", { id: pg.id, patch: { content: a.content || "" } });
				return { ok: true, title: pg.title };
			}
			case "move_page": {
				const pg = STATE.findPage(a.page_title);
				if (!pg) return { error: "Seite nicht gefunden: " + a.page_title };
				const parent = a.new_parent_title ? STATE.findPage(a.new_parent_title) : null;
				if (a.new_parent_title && !parent) return { error: "Elternseite nicht gefunden: " + a.new_parent_title };
				for (let anc = parent; anc; anc = anc.parentId ? S.pages[anc.parentId] : null) {
					if (anc.id === pg.id) return { error: "Zyklus: Die Zielseite liegt innerhalb der zu verschiebenden Seite." };
				}
				await STATE.dispatch("pageMove", { id: pg.id, parentId: parent ? parent.id : null });
				return { ok: true, title: pg.title, parent: parent ? parent.title : null };
			}
			case "delete_page": {
				// Soft-Delete wie in der UI: pageTrash (Unterbaum mit). Bestätigung
				// erzwingt ai.js vor dem Aufruf von run() — hier nur die Aktion selbst.
				const pg = STATE.findPage(a.page_title);
				if (!pg) return { error: "Seite nicht gefunden: " + a.page_title };
				// collectSubtree via aktiver Kinder-Zählung (pageTrash markiert den ganzen Baum)
				const countKids = (id) => {
					let n = 0;
					for (const p of Object.values(S.pages)) {
						if (!p.trashed && p.parentId === id) n += 1 + countKids(p.id);
					}
					return n;
				};
				const subtreeExtra = countKids(pg.id);
				// Offene Tabs der Seite + Nachfahren schließen (wie app.js pagetrash)
				const trashIds = new Set([pg.id]);
				(function collect(pid) {
					for (const p of Object.values(S.pages)) {
						if (!p.trashed && p.parentId === pid && !trashIds.has(p.id)) {
							trashIds.add(p.id);
							collect(p.id);
						}
					}
				})(pg.id);
				S.tabs = (S.tabs || []).filter((tid) => !trashIds.has(tid));
				if (S.currentPageId && trashIds.has(S.currentPageId)) {
					S.currentPageId = null;
					if (S.view === "page") S.view = "home";
				}
				await STATE.dispatch("pageTrash", { id: pg.id });
				return {
					ok: true,
					title: pg.title,
					trashed: true,
					subpages: subtreeExtra,
					note: "Im Papierkorb — wiederherstellbar. Endgültiges Löschen nur manuell im Papierkorb.",
				};
			}
			case "delete_flashcard": {
				// Bestätigung erzwingt ai.js (wie bei delete_page) — hier nur die Aktion selbst.
				const c = findCard(a.front, a.deck);
				if (!c) return { error: "Karte nicht gefunden: " + a.front };
				await STATE.dispatch("cardTrash", { id: c.id });
				return { ok: true, front: c.front, trashed: true, note: "Im Papierkorb — wiederherstellbar." };
			}
			case "delete_deck": {
				const match = resolveDeckName(a.deck);
				if (!match) return { error: "Stapel nicht gefunden: " + a.deck };
				const n = Object.values(S.cards).filter((c) => {
					if (c.trashed) return false;
					const d = c.deck || "Standard";
					return d === match || d.startsWith(match + "::");
				}).length;
				await STATE.dispatch("deckTrash", { name: match });
				return { ok: true, deck: match, trashed: true, cards: n, note: "Im Papierkorb — wiederherstellbar." };
			}
			case "read_page": {
				const pg = STATE.findPage(a.page_title);
				return pg
					? { title: pg.title, content: (pg.content || "").slice(0, 12000), hasPdf: !!pg.pdfId }
					: { error: "Seite nicht gefunden: " + a.page_title };
			}
			case "list_pages":
				// Nur aktive Seiten — Papierkorb-Inhalte sind für die KI unsichtbar
				return {
					pages: STATE.activePages().map((pg) => ({
						title: pg.title,
						parent: pg.parentId ? (S.pages[pg.parentId] || {}).title || null : null,
						hasPdf: !!pg.pdfId,
					})),
				};
			case "search_notes":
				return {
					results: STATE.searchNotes(a.query).map((r) => ({
						title: r.page.title, snippet: r.snippet,
					})),
				};
			case "semantic_search": {
				const hits = await RAG.search(a.query);
				if (hits === null) {
					return {
						info: "Kein Embedding-Modell konfiguriert — Stichwortsuche verwendet.",
						results: STATE.searchNotes(a.query).map((r) => ({ title: r.page.title, snippet: r.snippet })),
					};
				}
				return { results: hits };
			}
			case "create_flashcard": {
				const pg = a.page_title
					? STATE.findPage(a.page_title)
					: (S.currentPageId ? S.pages[S.currentPageId] : null);
				const id = U.uid();
				await STATE.dispatch("cardCreate", {
					id, front: a.front, back: a.back, pageId: pg ? pg.id : null,
					deck: a.deck || undefined,
				});
				return { ok: true, front: a.front, deck: a.deck || "Standard" };
			}
			case "create_flashcards": {
				const list = Array.isArray(a.cards) ? a.cards.filter((c) => c && c.front && c.back) : [];
				if (!list.length) return { error: "create_flashcards: cards-Liste ist leer oder unvollständig (front + back nötig)." };
				const pg = a.page_title
					? STATE.findPage(a.page_title)
					: (S.currentPageId ? S.pages[S.currentPageId] : null);
				// Sequentiell dispatchen — dispatch() ist ohnehin serialisiert (state.js)
				for (const c of list) {
					await STATE.dispatch("cardCreate", {
						id: U.uid(), front: String(c.front), back: String(c.back),
						pageId: pg ? pg.id : null, deck: a.deck || undefined,
					});
				}
				return { ok: true, cards: list.length, deck: a.deck || "Standard" };
			}
			case "create_cloze_card": {
				if (typeof EXTRAS === "undefined") return { error: "Cloze-Modul (extras.js) nicht geladen." };
				const pg = a.page_title
					? STATE.findPage(a.page_title)
					: (S.currentPageId ? S.pages[S.currentPageId] : null);
				const n = await EXTRAS.createClozeCards(a.text || "", a.deck || undefined, pg ? pg.id : null);
				if (!n) return { error: "Keine Cloze-Lücken gefunden — Lücken als " + CLOZE_HINT + " markieren." };
				return { ok: true, cards: n, deck: a.deck || "Standard" };
			}
			case "list_due_cards":
				return {
					due: STATE.dueCards().slice(0, 20).map((c) => ({ front: c.front, due: c.srs.due })),
				};
			case "send_to_notebooklm":
				// Übergibt an notebooklm.js: kopiert die Seiteninhalte und öffnet NotebookLM
				return await NLM.sendPages(a.page_titles || []);
			case "ask_choice": {
				// Die echte UI/Pause lebt im Agent-Loop (ai.js). run() validiert nur und
				// macht klar, dass ein direkter Aufruf nicht die interaktive Karte öffnet.
				const norm = normalizeAskChoice(a);
				if (norm.error) return norm;
				return {
					error: "ask_choice muss interaktiv im Chat beantwortet werden (Agent-Loop).",
					question: norm.question,
					options: norm.options,
				};
			}
			default:
				return { error: "Unbekanntes Tool: " + name };
		}
	}

	return { defs, run, normalizeAskChoice, findCard, resolveDeckName };
})();