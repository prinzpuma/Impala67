"use strict";
import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { EXTRAS } from "./extras.js";
import { RAG } from "./rag.js";
import { NLM } from "./notebooklm.js";
import { HEFT } from "./heft.js";
import { CHATS } from "./chats.js";
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
		t("create_page", "Erstellt eine neue Notiz-Seite. Inhalt ist Markdown; zusätzlich verfügbar: {red}Text{/} bzw. {bg-yellow}Text{/} (Farben gray/red/orange/yellow/green/blue/purple/pink), '> [!blue] Hinweis' für farbige Callouts, ==hervorheben== und ':::columns … :::split … :::end' für Spalten.", {
			title: { type: "string" },
			parent_title: { type: "string", description: "Titel der Elternseite (optional)" },
			content: { type: "string", description: "Markdown-Inhalt (inkl. Impala67-Erweiterungen, LaTeX $…$)" },
		}, ["title"]),
		t("append_to_page", "Hängt Markdown an eine bestehende Seite an (gleiche Formatier-Möglichkeiten wie create_page).", {
			page_title: { type: "string" },
			content: { type: "string" },
		}, ["page_title", "content"]),
		t("write_to_heft", "Schreibt SICHTBAREN Text in ein Handschrift-Heft: fügt eine Text-Box unter dem bisherigen Inhalt ein (bei Platzmangel automatisch neue Heftseite). Nur reiner Text mit Zeilenumbrüchen — kein Markdown/LaTeX (wird auf der Heftseite nicht gerendert). Für Hefte IMMER dieses Tool statt append_to_page.", {
			page_title: { type: "string", description: "Titel des Hefts" },
			text: { type: "string", description: "Reiner Text (\\n für Absätze)" },
			heft_page: { type: "number", description: "Heftseite (1-basiert, optional — Standard: letzte Seite)" },
		}, ["page_title", "text"]),
		t("get_heft_page_image", "Holt eine Heftseite als BILD in den Chat, damit du Handschrift, Skizzen und Diagramme selbst ansehen kannst (Vision). Das Bild kommt direkt nach den Tool-Ergebnissen als eigene Nutzer-Nachricht bei dir an. Ohne page_title wird das gerade geöffnete Heft verwendet. Wenn du Bilder technisch nicht sehen kannst (kein Vision-Modell), sage das ehrlich statt zu raten.", {
			page_title: { type: "string", description: "Titel des Hefts (optional — Standard: gerade geöffnetes Heft)" },
			heft_page: { type: "number", description: "Heftseite (1-basiert, optional — Standard: gerade sichtbare Seite)" },
		}, []),
		t("replace_page_content", "Ersetzt den kompletten Inhalt einer Seite (vorsichtig verwenden). Funktioniert nicht bei Handschrift-Heften.", {
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
		t("get_context", "Liefert den aktuellen App-Kontext: Datum/Uhrzeit, geöffnete Seite (inkl. Inhalt, gekürzt), zuletzt bearbeitete Seiten, Karteikarten-Lernstatus und Seitenanzahl. Zuerst aufrufen, wenn Kontext über die App oder das Lernen nötig ist.", {}, []),
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
		t("send_to_notebooklm", "Bereitet Notiz-Seiten als Quelle für Gemini Notebook (ehemals NotebookLM) vor: kopiert ihre Inhalte in die Zwischenablage und öffnet Gemini Notebook — dort nur noch „Quelle hinzufügen → Kopierter Text“ wählen und einfügen. Nützlich, wenn Lernpodcasts oder Lernvideos zu Seiten erstellt werden sollen.", {
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
		// 🧮 Taschenrechner (18. Juli, spät v3): nutzt die eingebundene math.js-
		// Bibliothek statt eines selbstgeschriebenen Parsers — dadurch Matrizen,
		// komplexe Zahlen, Einheiten und symbolische Ableitungen quasi gratis.
		t("calculate", "Rechnet einen mathematischen Ausdruck EXAKT aus (math.js-Syntax) — nutze dieses Tool für JEDE nicht-triviale Rechnung statt selbst im Kopf zu rechnen. Kann: Grundrechenarten/Potenzen/Wurzeln/Brüche, Trigonometrie & Logarithmus, komplexe Zahlen (2+3i), Einheiten-Umrechnung ('5 km/h to m/s'), Vektoren/Matrizen ('[[1,2],[3,4]] * [[5],[6]]', 'det([[1,2],[3,4]])', 'inv(...)', 'transpose(...)'), symbolische Ableitungen ('derivative(\"x^2*sin(x)\", \"x\")'). Bestimmte Integrale NICHT direkt in math.js-Syntax, sondern als eigene Sonderform: 'integrate(\"sin(x)\", \"x\", 0, pi)' (wird numerisch berechnet, liefert eine Dezimalzahl statt einer Formel).", {
			expression: { type: "string", description: "Ausdruck in math.js-Syntax, z.B. 'sqrt(2)+3^2', '[[1,2],[3,4]]*[[5],[6]]', 'derivative(\"x^2\",\"x\")' oder 'integrate(\"x^2\",\"x\",0,3)'" },
		}, ["expression"]),
		// 🔎 Chatverlauf-Rückwertssuche (18. Juli, spät v3): die KI kann gezielt in
		// FRüHEREN Chats (auch außerhalb des aktuellen Kontextfensters) nach Stichworten
		// oder Dateinamen suchen, statt bei langen Verläufen den Anfang zu "vergessen".
		t("search_chat_history", "Durchsucht ALLE früheren Chat-Verläufe (auch andere Chats, nicht nur den aktuellen) nach einem Stichwort — auch in Namen/Inhalten angehängter Dateien (PDF/Text). Nützlich, wenn eine früher erwähnte Datei, Zahl oder Entscheidung nicht mehr im aktuellen Gesprächsfenster steht.", {
			query: { type: "string", description: "Suchbegriff (Stichwort, Dateiname o.ä.)" },
			limit: { type: "number", description: "Max. Anzahl Treffer (Standard 15, max. 30)" },
		}, ["query"]),
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
				// BUGFIX (15. Juli): Hefte rendern nur den Blob (Striche/Bilder/Texte) —
				// Markdown in pg.content wäre unsichtbar. Deshalb auf sichtbare Text-Box umleiten.
				if (pg.kind === "heft") return await run("write_to_heft", { page_title: a.page_title, text: a.content });
				await STATE.dispatch("pageUpdate", {
					id: pg.id, patch: { content: (pg.content ? pg.content + "\n\n" : "") + a.content },
				});
				return { ok: true, title: pg.title };
			}
			case "write_to_heft": {
				const pg = STATE.findPage(a.page_title);
				if (!pg) return { error: "Seite nicht gefunden: " + a.page_title };
				if (pg.kind !== "heft") return { error: "\"" + pg.title + "\" ist kein Handschrift-Heft — nutze append_to_page." };
				if (typeof HEFT.addText !== "function") return { error: "Heft-Modul ohne addText — heft.js aktualisieren." };
				const opts = {};
				if (a.heft_page != null) opts.pageIndex = Math.max(0, (Number(a.heft_page) || 1) - 1);
				const res = await HEFT.addText(pg.id, a.text, opts);
				if (!res || !res.ok) return { error: "Ins Heft schreiben fehlgeschlagen: " + ((res && res.error) || "unbekannt") };
				return { ok: true, title: pg.title, heftPage: res.pageIndex + 1, addedPage: !!res.addedPage, note: "Sichtbar als Text-Box auf Heftseite " + (res.pageIndex + 1) + " eingefügt." };
			}
			case "replace_page_content": {
				const pg = STATE.findPage(a.page_title);
				if (!pg) return { error: "Seite nicht gefunden: " + a.page_title };
				if (pg.kind === "heft") return { error: "Heft-Inhalte (Striche/Bilder) können nicht ersetzt werden — write_to_heft fügt sichtbaren Text hinzu." };
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
			case "get_context": {
				// Ersetzt die früheren Kontext-Listen im System-Prompt (Prompt-Diät,
				// 15. Juli): die KI ruft diese Daten nur ab, wenn sie sie braucht.
				const now = new Date();
				const cur = S.currentPageId ? S.pages[S.currentPageId] : null;
				const body = cur ? String(cur.content || "") : "";
				const recent = STATE.activePages()
					.slice().sort((x, y) => String(y.updated || "").localeCompare(String(x.updated || ""))).slice(0, 8)
					.map((pg) => ({ title: pg.title, updated: String(pg.updated || "").slice(0, 10) }));
				let study = null;
				try {
					const snap = STATE.studySnapshot(null);
					study = { neu: snap.counts.neu, review: snap.counts.review, learn: snap.counts.learn };
				} catch { /* Lernstatus optional */ }
				return {
					now: now.toLocaleDateString("de-DE", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) + ", " + now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr",
					currentPage: cur ? { title: cur.title, content: body.slice(0, 4000) + (body.length > 4000 ? "\n[… gekürzt — Rest per read_page]" : "") } : null,
					recentPages: recent,
					study,
					pageCount: STATE.activePages().length,
				};
			}
			case "read_page": {
				const pg = STATE.findPage(a.page_title);
				if (!pg) return { error: "Seite nicht gefunden: " + a.page_title };
				if (pg.kind === "heft") {
					// Hefte: pg.content ist leer — lesbar sind erkannte Handschrift + Text-Boxen.
					const meta = (S.heftMeta && S.heftMeta[pg.id]) || {};
					return { title: pg.title, heft: true, pages: meta.pages || 1, content: String(meta.ocrText || "").slice(0, 12000), note: "Handschrift-Heft: content = erkannte Handschrift + getippte Text-Boxen. Sichtbar schreiben nur mit write_to_heft." };
				}
				return { title: pg.title, content: (pg.content || "").slice(0, 12000), hasPdf: !!pg.pdfId };
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
				// Übergibt an notebooklm.js: kopiert die Seiteninhalte und öffnet Gemini Notebook
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
			case "calculate": {
				if (typeof window.math === "undefined" || typeof window.math.evaluate !== "function") return { error: "Mathe-Modul (math.js) nicht geladen — evtl. noch offline/kein Netz beim ersten Start." };
				const expr = String(a.expression || "").trim();
				if (!expr) return { error: "calculate: expression fehlt." };
				try {
					// Sonderform integrate("f(x)", "x", a, b) — math.js kann das nicht nativ,
					// daher hier per Simpson-Regel selbst numerisch lösen.
					const intMatch = expr.match(/^integrate\(\s*(['"])([\s\S]*?)\1\s*,\s*(['"])([\s\S]*?)\3\s*,\s*([\s\S]+?)\s*,\s*([\s\S]+?)\s*\)$/);
					if (intMatch) {
						const [, , fnExpr, , varName, loStr, hiStr] = intMatch;
						const lo = Number(window.math.evaluate(loStr));
						const hi = Number(window.math.evaluate(hiStr));
						if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { error: "integrate: Grenzen konnten nicht ausgewertet werden." };
						const compiled = window.math.compile(fnExpr);
						const N = 500; // gerade Anzahl für Simpson-Regel
						const h = (hi - lo) / N;
						let sum = compiled.evaluate({ [varName]: lo }) + compiled.evaluate({ [varName]: hi });
						for (let i = 1; i < N; i++) sum += compiled.evaluate({ [varName]: lo + i * h }) * (i % 2 === 0 ? 2 : 4);
						const value = (h / 3) * sum;
						return { ok: true, expression: expr, result: window.math.format(value, { precision: 10 }), note: "Numerisch berechnet (Simpson-Regel) — kein symbolisches Ergebnis." };
					}
					const result = window.math.evaluate(expr);
					return { ok: true, expression: expr, result: window.math.format(result, { precision: 12 }) };
				} catch (e) {
					return { error: "Rechenfehler: " + String((e && e.message) || e) };
				}
			}
			case "search_chat_history": {
				const q = String(a.query || "").trim().toLowerCase();
				if (!q) return { error: "search_chat_history: query fehlt." };
				const limit = Math.max(1, Math.min(30, Number(a.limit) || 15));
				const hits = [];
				for (const session of CHATS.load()) {
					for (const m of session.messages || []) {
						if (m.role !== "user" && m.role !== "assistant") continue;
						const parts = [];
						if (typeof m.content === "string" && m.content) parts.push(m.content);
						if (m.textFile) parts.push("[Datei: " + m.textFile.name + "]", String(m.textFile.content || ""));
						if (m.pdfFile) parts.push("[PDF: " + m.pdfFile.name + "]", String(m.pdfFile.content || ""));
						if (m.image) parts.push("[Bild-Anhang]");
						const text = parts.join("\n");
						const idx = text.toLowerCase().indexOf(q);
						if (idx === -1) continue;
						const from = Math.max(0, idx - 60), to = Math.min(text.length, idx + q.length + 60);
						const snippet = (from > 0 ? "…" : "") + text.slice(from, to).replace(/\s+/g, " ").trim() + (to < text.length ? "…" : "");
						hits.push({ chatTitle: session.title || "(ohne Titel)", updated: String(session.updated || "").slice(0, 16).replace("T", " "), role: m.role, snippet });
					}
				}
				hits.sort((x, y) => String(y.updated).localeCompare(String(x.updated)));
				return { results: hits.slice(0, limit), totalMatches: hits.length };
			}
			default:
				return { error: "Unbekanntes Tool: " + name };
		}
	}

	return { defs, run, normalizeAskChoice, findCard, resolveDeckName };
})();