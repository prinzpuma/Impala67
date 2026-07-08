"use strict";
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
		t("create_flashcard", "Erstellt eine Karteikarte für die Spaced-Repetition-Wiederholung.", {
			front: { type: "string", description: "Frage / Vorderseite" },
			back: { type: "string", description: "Antwort / Rückseite" },
			deck: { type: "string", description: "Zielstapel, Unterstapel per 'Eltern::Kind' (optional, Standard: 'Standard')" },
			page_title: { type: "string", description: "Zugehörige Seite (optional)" },
		}, ["front", "back"]),
		t("create_cloze_card", "Erstellt Lückentext-Karteikarten (Cloze). Lücken im Text als " + CLOZE_HINT + " markieren — pro Lücken-Nummer (c1, c2, …) entsteht eine eigene Karte.", {
			text: { type: "string", description: "Text mit Cloze-Lücken" },
			deck: { type: "string", description: "Zielstapel, Unterstapel per 'Eltern::Kind' (optional)" },
			page_title: { type: "string", description: "Zugehörige Seite (optional)" },
		}, ["text"]),
		t("list_due_cards", "Listet aktuell fällige Karteikarten.", {}, []),
		t("ask_choice", "Stellt der Nutzerin/dem Nutzer eine kurze Rückfrage mit 2-5 anklickbaren Antwortmöglichkeiten, wenn eine Entscheidung nötig ist, bevor du fortfährst. Sparsam einsetzen, nur bei echter Mehrdeutigkeit.", {
			question: { type: "string", description: "Kurze, konkrete Frage" },
			options: { type: "array", items: { type: "string" }, description: "2-5 kurze Antwortoptionen" },
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
			default:
				return { error: "Unbekanntes Tool: " + name };
		}
	}

	return { defs, run };
})();