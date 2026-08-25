"use strict";
import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { SRS } from "./srs.js";
import { EXTRAS } from "./extras.js";
import { RAG } from "./rag.js";
import { NLM } from "./notebooklm.js";
import { HEFT } from "./heft.js";
import { CHATS } from "./chats.js";
import { OPTIONAL_MODULE_URLS } from "./optional-modules.js";
// tools.js — Die Werkzeuge der KI (OpenAI-Function-Calling-Format).
// Darüber kann die KI Seiten lesen/anlegen/ändern und Karteikarten erstellen.
// Beschreibungs-Diät (31. Juli): Die Liste geht bei JEDER Anfrage und in JEDEM Agent-Schritt
// vollständig mit. Erzähltext, Wiederholungen und Bestätigungs-Prosa (die App erzwingt die
// Bestätigung ohnehin im Code) sind raus — nur noch, was das Modell zur Wahl des Werkzeugs braucht.
export const TOOLS = (() => {
	const t = (name, description, properties, required) => ({
		type: "function",
		function: { name, description, parameters: { type: "object", properties, required } },
	});

	// Cloze-Beispielsyntax zusammengesetzt, damit die doppelt geschweiften Klammern
	// nirgends mit Template-/Platzhalter-Systemen kollidieren.
	const CLOZE_HINT = "{" + "{c1::Antwort}" + "}";

	// 🃏 Karten-Design-Spezifikation (22. Juli): kompaktes Standardformat für alle neuen Karten,
	// damit die Lern-Ansicht ruhig und einheitlich aussieht (weniger Markdown-Wildwuchs).
	// Hängt an DREI Beschreibungen — jede Zeile zählt dreifach, daher knapp.
	const CARD_RULES = " Format: Vorderseite = eine konkrete Frage (8–20 Wörter). Rückseite = Kernantwort in 1–2 Zeilen, optional max. 4 Stichpunkte; keine Überschrift ‚Antwort:', keine Skript-Absätze. LaTeX für Formeln. Eine Karte = ein Fakt.";

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
	// EINE Teilbaum-Regel und EIN Textfilter statt je vier bzw. zwei Kopien (findCard,
	// selectCards, cardsOfDeck, list_flashcards) — die Kopien drifteten sonst auseinander.
	const inDeck = (c, deck) => STATE.deckInTree(c.deck || "Standard", deck);
	const textHit = (c, q) => (c.front || "").toLowerCase().includes(q) || (c.back || "").toLowerCase().includes(q);

	function findCard(front, deck) {
		if (!front) return null;
		const q = String(front).trim().toLowerCase();
		if (!q) return null;
		const pool = deck ? STATE.activeCards().filter((c) => inDeck(c, deck)) : STATE.activeCards();
		let starts = null, partial = null;
		for (const c of pool) {
			const t = (c.front || "").toLowerCase();
			if (t === q) return c;
			if (!starts && t.startsWith(q)) starts = c;
			if (!partial && t.includes(q)) partial = c;
		}
		return starts || partial;
	}

	// Stapelnamen case-insensitive auflösen. deckMatches() liefert ALLE Kandidaten
	// (exakter Treffer schlägt Teiltreffer) und ignoriert Papierkorb-Stapel.
	function deckMatches(name) {
		const q = String(name || "").trim().toLowerCase();
		if (!q) return [];
		const names = Object.keys(S.decks).filter((n) => S.decks[n] && !S.decks[n].trashed);
		const exact = names.find((n) => n.toLowerCase() === q);
		return exact ? [exact] : names.filter((n) => n.toLowerCase().includes(q));
	}
	// TOT: resolveDeckName entfernt — kein Aufrufer (weder hier noch in ai.js/render/app);
	// alles mit Folgen läuft über resolveDeckStrict, alles andere direkt über deckMatches.
	// Für alles mit Folgen (löschen, umbenennen, verschieben, zurücksetzen) NIE raten:
	// „Mathe“ traf bisher stillschweigend „Mathematik 2“. Bei mehreren Kandidaten
	// bricht der Aufruf mit einer klaren Rückfrage ab.
	function resolveDeckStrict(name) {
		const hits = deckMatches(name);
		if (!hits.length) return { error: "Stapel nicht gefunden: " + String(name || "").trim() };
		if (hits.length > 1) return { error: "Mehrdeutiger Stapelname „" + String(name).trim() + "“ — gemeint ist einer von: " + hits.slice(0, 5).join(" | ") + ". Bitte mit ask_choice nachfragen und den vollständigen Namen verwenden." };
		return { deck: hits[0] };
	}

	// Karten-Auswahl für die Verwaltungs-Tools (verschieben, pausieren, zurücksetzen):
	// entweder konkrete Karten (front/fronts) oder ein Filter aus Stapel + Suchtext.
	// Liefert { cards } oder { error } — nie eine stille Teilauswahl bei Tippfehlern.
	// opts.allowAll: nur das Auflisten darf ohne Filter alles zeigen — alles mit Folgen
	// (löschen, verschieben, pausieren, zurücksetzen) braucht weiter eine echte Auswahl.
	function selectCards(a, opts) {
		const { max = 200, allowAll = false } = opts || {};
		const wanted = (Array.isArray(a.fronts) ? a.fronts : []).concat(a.front ? [a.front] : []).filter(Boolean);
		const seen = new Set();
		const out = [];
		const add = (c) => { if (c && !seen.has(c.id)) { seen.add(c.id); out.push(c); } };
		const deckArg = a.deck || a.from_deck;
		let deckName = null;
		if (deckArg) {
			const hit = resolveDeckStrict(deckArg);
			if (hit.error) return hit;
			deckName = hit.deck;
		}
		if (wanted.length) {
			const missing = [];
			for (const f of wanted) {
				const c = findCard(f, deckName);
				if (c) add(c); else missing.push(String(f));
			}
			if (missing.length) return { error: "Karte(n) nicht gefunden: " + missing.join(" | ") };
		} else {
			if (!deckName && !a.query && !allowAll) return { error: "Auswahl fehlt — bitte front/fronts, deck bzw. from_deck und/oder query angeben." };
			let pool = STATE.activeCards();
			if (deckName) pool = pool.filter((c) => inDeck(c, deckName));
			if (a.query) {
				const q = String(a.query).trim().toLowerCase();
				if (q) pool = pool.filter((c) => textHit(c, q));
			}
			pool.forEach(add);
		}
		const limit = Math.max(1, Math.min(max, Number(a.limit) || max));
		// Wird die Auswahl gekappt, MUSS das sichtbar sein — sonst meldet ein Massen-Werkzeug
		// „fertig“, während der Rest unbemerkt liegen bleibt.
		const cards = out.slice(0, limit);
		return { cards, total: out.length, truncated: out.length > cards.length, limit, deck: deckName };
	}

	// Zielstapel sicherstellen: Eintrag anlegen bzw. aus dem Papierkorb zurückholen.
	// Bewusst EXAKTER Namensvergleich (nicht das unscharfe resolveDeckName) — sonst
	// landet ein neuer Stapel „Mathe 2“ stillschweigend im bestehenden „Mathe“.
	async function ensureDeck(name) {
		const clean = String(name || "").trim().replace(/^:+|:+$/g, "").trim();
		if (!clean) return null;
		const exact = Object.keys(S.decks).find((n) => n.toLowerCase() === clean.toLowerCase());
		if (exact) {
			if (S.decks[exact].trashed) await STATE.dispatch("deckRestore", { name: exact });
			return exact;
		}
		await STATE.dispatch("deckCreate", { name: clean });
		return clean;
	}

	// Zielnamen freimachen: Ein Stapel gleichen Namens im PAPIERKORB blockierte bisher
	// mit „gibt es bereits“ — oder schlimmer: Karten wären in einen gelöschten Stapel
	// gewandert und aus der Ansicht verschwunden. Liefert eine Fehlermeldung oder "".
	async function freeDeckSlot(name) {
		const existing = S.decks[name];
		if (!existing) return "";
		if (!existing.trashed) return "Es gibt bereits einen Stapel „" + name + "“ — bitte anderen Namen wählen.";
		await STATE.dispatch("deckRestore", { name });
		return "";
	}

	// Karten eines Stapel-Teilbaums (aktiv, ohne Papierkorb).
	const cardsOfDeck = (deck) => STATE.activeCards().filter((c) => inDeck(c, deck));

	// Volltext-Treffer gedeckelt: ai.js kappt Tool-Ergebnisse hart bei 6000 Zeichen — eine
	// unbegrenzte Trefferliste kam beim Modell als abgeschnittenes, unlesbares JSON an.
	function keywordHits(query) {
		const all = STATE.searchNotes(query) || [];
		return {
			results: all.slice(0, 20).map((r) => ({ title: r.page.title, snippet: r.snippet })),
			totalMatches: all.length,
			...(all.length > 20 ? { note: "Nur die 20 besten Treffer — bei Bedarf genauer suchen." } : {}),
		};
	}

	const legacyDefs = false ? [
		t("create_page", "Erstellt eine neue Notiz-Seite. Inhalt ist Markdown; zusätzlich verfügbar: {red}Text{/} bzw. {bg-yellow}Text{/} (Farben gray/red/orange/yellow/green/blue/purple/pink), '> [!blue] Hinweis' für farbige Callouts, ==hervorheben== und ':::columns … :::split … :::end' für Spalten.", {
			title: { type: "string" },
			parent_title: { type: "string", description: "Titel der Elternseite (optional)" },
			content: { type: "string", description: "Markdown-Inhalt (inkl. Impala67-Erweiterungen, LaTeX $…$)" },
		}, ["title"]),
		t("append_to_page", "Hängt Markdown an eine bestehende Seite an (gleiche Formatier-Möglichkeiten wie create_page).", {
			page_title: { type: "string" },
			content: { type: "string" },
		}, ["page_title", "content"]),
		t("write_to_heft", "Schreibt sichtbaren Text als Text-Box in ein Handschrift-Heft (nur reiner Text, kein Markdown/LaTeX). Für Hefte immer dieses Tool statt append_to_page.", {
			page_title: { type: "string", description: "Titel des Hefts" },
			text: { type: "string", description: "Reiner Text (\\n für Absätze)" },
			heft_page: { type: "number", description: "Heftseite (1-basiert, optional — Standard: letzte Seite)" },
		}, ["page_title", "text"]),
		t("get_heft_page_image", "Holt eine Heftseite als Bild (Vision); ohne page_title das gerade geöffnete Heft. Kannst du Bilder nicht sehen, sage es ehrlich statt zu raten.", {
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
		t("delete_page", "Verschiebt eine Seite samt Unterseiten in den Papierkorb (wiederherstellbar; die App erzwingt eine Bestätigung). Bei mehrdeutigem Titel zuerst ask_choice.", {
			page_title: { type: "string", description: "Titel der zu löschenden Seite" },
		}, ["page_title"]),
		t("delete_flashcard", "Verschiebt EINE Karte in den Papierkorb (wiederherstellbar; Bestätigung erzwingt die App). Für mehrere Karten delete_flashcards.", {
			front: { type: "string", description: "Text bzw. Anfang der Vorderseite zur Identifikation der Karte" },
			deck: { type: "string", description: "Stapel zur Eingrenzung, falls mehrere Karten ähnlichen Text haben (optional)" },
		}, ["front"]),
		// 26. Juli: Mehrere Karten auf einmal löschen — vorher musste die KI delete_flashcard
		// für JEDE Karte einzeln aufrufen (je mit eigener Bestätigung) und war nach wenigen
		// Karten am Schritt-Limit.
		t("delete_flashcards", "Verschiebt MEHRERE Karten in den Papierkorb; Auswahl über fronts und/oder deck + query (mind. eine Angabe). Zum Korrigieren oder Umsortieren stattdessen update_flashcard bzw. move_flashcards.", {
			fronts: { type: "array", items: { type: "string" }, description: "Vorderseiten-Texte der zu löschenden Karten (optional)" },
			deck: { type: "string", description: "Alle Karten dieses Stapels inkl. Unterstapel (optional)" },
			query: { type: "string", description: "Nur Karten, deren Vorder- oder Rückseite diesen Text enthält (optional)" },
			limit: { type: "number", description: "Sicherheitsgrenze für Filter-Auswahlen (Standard/Max. 200)" },
		}, []),
		t("delete_deck", "Verschiebt einen Stapel samt Unterstapeln und Karten in den Papierkorb (wiederherstellbar; Bestätigung erzwingt die App).", {
			deck: { type: "string", description: "Name des Stapels, Unterstapel per 'Eltern::Kind'" },
		}, ["deck"]),
		t("get_context", "App-Kontext: geöffnete Seite (Inhalt gekürzt), aktuell sichtbare Lernkarte, zuletzt bearbeitete Seiten, Lernstand, Seitenanzahl.", {}, []),
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
		t("create_flashcard", "Erstellt EINE Karteikarte für die Spaced-Repetition-Wiederholung. Beide Seiten sind Markdown." + CARD_RULES + " Für mehrere Karten create_flashcards verwenden.", {
			front: { type: "string", description: "Frage / Vorderseite (Markdown)" },
			back: { type: "string", description: "Antwort / Rückseite (Markdown — Kernantwort zuerst, kurz halten)" },
			deck: { type: "string", description: "Zielstapel, Unterstapel per 'Eltern::Kind' (optional, Standard: 'Standard')" },
			page_title: { type: "string", description: "Zugehörige Seite (optional)" },
		}, ["front", "back"]),
		t("create_flashcards", "Erstellt MEHRERE Karteikarten auf einmal — bevorzugt gegenüber vielen einzelnen create_flashcard-Aufrufen. Beide Seiten sind Markdown." + CARD_RULES, {
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
		t("list_flashcards", "Listet Karten mit Vorder- UND Rückseite, optional gefiltert nach Stapel und/oder Suchtext (nicht auf fällige beschränkt).", {
			deck: { type: "string", description: "Nur Karten aus diesem Stapel (inkl. Unterstapel), optional" },
			query: { type: "string", description: "Nur Karten, deren Vorder- oder Rückseite diesen Text enthält (Groß-/Kleinschreibung egal), optional" },
			limit: { type: "number", description: "Max. Anzahl Karten (Standard 30, max. 100)" },
		}, []),
		// 🗂 Karten-Verwaltung (25. Juli): Die KI konnte Karten bisher nur anlegen, auflisten und
		// löschen — verschieben, umbenennen, korrigieren, pausieren und zurücksetzen fehlten,
		// obwohl das Event-Log (cardUpdate, deckRename, deckMove, deckCreate) das längst kann.
		t("list_decks", "Listet alle Stapel mit Kartenzahl, pausierten Karten und heutigem Lernstand. Vor Anlegen, Umbenennen oder Verschieben zuerst aufrufen.", {}, []),
		t("create_deck", "Legt einen leeren Karteikarten-Stapel an. Unterstapel per 'Eltern::Kind'.", {
			name: { type: "string", description: "Name des neuen Stapels" },
		}, ["name"]),
		t("rename_deck", "Benennt einen Stapel um. Unterstapel und ALLE enthaltenen Karten wandern automatisch mit.", {
			deck: { type: "string", description: "Bisheriger Name" },
			new_name: { type: "string", description: "Neuer vollständiger Name (Unterstapel per 'Eltern::Kind')" },
		}, ["deck", "new_name"]),
		t("move_deck", "Hängt einen Stapel samt Unterstapeln und Karten unter einen anderen Eltern-Stapel — oder auf die oberste Ebene.", {
			deck: { type: "string", description: "Zu verschiebender Stapel" },
			new_parent: { type: "string", description: "Ziel-Elternstapel; leer lassen für oberste Ebene" },
		}, ["deck"]),
		t("move_flashcards", "Verschiebt Karten in einen anderen Stapel (wird bei Bedarf angelegt); Auswahl über fronts oder from_deck und/oder query. Lernfortschritt bleibt erhalten.", {
			to_deck: { type: "string", description: "Zielstapel, Unterstapel per 'Eltern::Kind'" },
			fronts: { type: "array", items: { type: "string" }, description: "Vorderseiten-Texte der zu verschiebenden Karten (optional)" },
			from_deck: { type: "string", description: "Alle Karten aus diesem Stapel inkl. Unterstapel (optional)" },
			query: { type: "string", description: "Nur Karten, deren Vorder- oder Rückseite diesen Text enthält (optional)" },
			limit: { type: "number", description: "Sicherheitsgrenze für Filter-Auswahlen (Standard/Max. 200)" },
		}, ["to_deck"]),
		t("update_flashcard", "Ändert Vorderseite, Rückseite und/oder Stapel EINER Karte; der Lernfortschritt bleibt erhalten." + CARD_RULES, {
			front: { type: "string", description: "Text bzw. Anfang der bisherigen Vorderseite zur Identifikation" },
			deck: { type: "string", description: "Stapel zur Eingrenzung, falls mehrere Karten ähnlich beginnen (optional)" },
			new_front: { type: "string", description: "Neue Vorderseite (optional)" },
			new_back: { type: "string", description: "Neue Rückseite (optional)" },
			new_deck: { type: "string", description: "Neuer Stapel (optional)" },
		}, ["front"]),
		t("suspend_flashcards", "Pausiert Karten oder hebt die Pause auf; Auswahl über fronts, deck und/oder query.", {
			suspended: { type: "boolean", description: "true = pausieren, false = Pause aufheben" },
			fronts: { type: "array", items: { type: "string" }, description: "Konkrete Karten (optional)" },
			deck: { type: "string", description: "Alle Karten dieses Stapels inkl. Unterstapel (optional)" },
			query: { type: "string", description: "Textfilter über Vorder-/Rückseite (optional)" },
			limit: { type: "number", description: "Sicherheitsgrenze (Standard/Max. 200)" },
		}, ["suspended"]),
		t("reset_card_progress", "Setzt den Lernfortschritt zurück — Karten gelten wieder als neu (Bestätigung erzwingt die App). Die Statistik bleibt erhalten.", {
			front: { type: "string", description: "Einzelne Karte über ihre Vorderseite (optional)" },
			deck: { type: "string", description: "Alle Karten dieses Stapels inkl. Unterstapel (optional) — entweder front oder deck angeben" },
		}, []),
		t("send_to_notebooklm", "Kopiert Seiteninhalte als Quelle für Gemini Notebook und öffnet es (für Lernpodcasts oder -videos).", {
			page_titles: { type: "array", items: { type: "string" }, description: "Titel der Seiten (leer = aktuelle Seite)" },
		}, []),
		t("ask_choice", "EINE kurze Rückfrage mit 2–5 anklickbaren Optionen, NUR bei echter Mehrdeutigkeit. Keine Ja/Nein- oder Meta-Fragen; Optionen vollständig und sofort nutzbar.",
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
		t("calculate", "Rechnet exakt (math.js-Syntax) — für JEDE nicht-triviale Rechnung statt Kopfrechnen: Terme, Trigonometrie, komplexe Zahlen, Einheiten ('5 km/h to m/s'), Matrizen, 'derivative(\"x^2\",\"x\")'. Bestimmte Integrale nur als Sonderform 'integrate(\"sin(x)\",\"x\",0,pi)' (numerisch).", {
			expression: { type: "string", description: "Ausdruck in math.js-Syntax, z.B. 'sqrt(2)+3^2', '[[1,2],[3,4]]*[[5],[6]]', 'derivative(\"x^2\",\"x\")' oder 'integrate(\"x^2\",\"x\",0,3)'" },
		}, ["expression"]),
		// 🔎 Chatverlauf-Rückwertssuche (18. Juli, spät v3): die KI kann gezielt in
		// FRüHEREN Chats (auch außerhalb des aktuellen Kontextfensters) nach Stichworten
		// oder Dateinamen suchen, statt bei langen Verläufen den Anfang zu "vergessen".
		t("search_chat_history", "Durchsucht ALLE früheren Chats inkl. angehängter Dateien nach einem Stichwort — für alles außerhalb des aktuellen Gesprächsfensters.", {
			query: { type: "string", description: "Suchbegriff (Stichwort, Dateiname o.ä.)" },
			limit: { type: "number", description: "Max. Anzahl Treffer (Standard 15, max. 30)" },
		}, ["query"]),
	] : null;

	// Kleine, aufgabenorientierte Oberfläche für das Modell. Die historisch gewachsenen
	// Einzel-Handler bleiben intern erhalten; dadurch bleiben Datenformat und Sync kompatibel,
	// ohne bei jeder Anfrage dutzende Schemas an das Modell zu schicken.
	const defs = [
		t("inspect", "Liest App-Daten. Mehrere Seiten oder Karten in einem Aufruf abrufen.", {
			kind: { type: "string", enum: ["context", "pages", "page", "decks", "cards", "due", "search", "chats"] },
			titles: { type: "array", items: { type: "string" }, description: "Seitentitel für kind=page" },
			query: { type: "string" }, deck: { type: "string" }, limit: { type: "number" },
			semantic: { type: "boolean", description: "Semantische statt Stichwortsuche" },
		}, ["kind"]),
		t("change", "Führt mehrere Änderungen in einer atomaren, vollständig rückgängig machbaren Aktion aus. Reihenfolge der operations wird beachtet.", {
			operations: { type: "array", items: { type: "object", properties: {
				op: { type: "string", enum: ["page.create", "page.append", "page.replace", "page.rename", "page.move", "page.trash", "heft.append", "card.create", "card.update", "card.move", "card.trash", "card.suspend", "card.reset", "deck.create", "deck.rename", "deck.move", "deck.trash"] },
				title: { type: "string" }, parent: { type: "string" }, content: { type: "string" }, text: { type: "string" }, page: { type: "number" },
				front: { type: "string" }, fronts: { type: "array", items: { type: "string" } }, back: { type: "string" }, new_front: { type: "string" }, new_back: { type: "string" },
				cards: { type: "array", items: { type: "object", properties: { front: { type: "string" }, back: { type: "string" } }, required: ["front", "back"] } },
				deck: { type: "string" }, to: { type: "string" }, query: { type: "string" }, suspended: { type: "boolean" }, limit: { type: "number" },
			}, required: ["op"] }, minItems: 1 },
		}, ["operations"]),
		t("view_heft_page", "Lädt eine Handschrift-Heftseite als Bild für die visuelle Analyse.", {
			title: { type: "string" }, page: { type: "number" },
		}, []),
		t("ask_choice", "Stellt nur bei echter Mehrdeutigkeit eine kurze anklickbare Rückfrage.", {
			question: { type: "string" }, options: { type: "array", items: { type: "string" } },
		}, ["question", "options"]),
		t("calculate", "Berechnet einen math.js-Ausdruck exakt; integrate(\"f(x)\",\"x\",a,b) numerisch.", {
			expression: { type: "string" },
		}, ["expression"]),
		t("send_to_notebooklm", "Übergibt Seiten als Quellen an Gemini Notebook.", {
			page_titles: { type: "array", items: { type: "string" } },
		}, []),
	];

	const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
	function splitTopLevelArgs(source) {
		const args = []; let start = 0, depth = 0, quote = "", escaped = false;
		for (let i = 0; i < source.length; i++) {
			const ch = source[i];
			if (quote) {
				if (escaped) escaped = false;
				else if (ch === "\\") escaped = true;
				else if (ch === quote) quote = "";
			} else if (ch === "\"" || ch === "'") quote = ch;
			else if (ch === "(" || ch === "[" || ch === "{") depth++;
			else if (ch === ")" || ch === "]" || ch === "}") depth--;
			else if (ch === "," && depth === 0) { args.push(source.slice(start, i).trim()); start = i + 1; }
		}
		args.push(source.slice(start).trim());
		return args;
	}
	const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
	function managedSnapshot(operations) {
		// Heft-Dokumente können zehntausende Stiftpunkte und Bilder enthalten. Nur das
		// tatsächlich beschriebene Heft kopieren; Seiten/Karten/Stapel bleiben kompakt.
		const heftDocs = {}, heftTargets = new Set();
		for (const op of operations || []) {
			if (op?.op !== "heft.append") continue;
			const page = STATE.findPage(op.title);
			if (!page) continue;
			heftTargets.add(page.id);
			if (S.heftDocs[page.id]) heftDocs[page.id] = clone(S.heftDocs[page.id]);
		}
		return { pages: clone(S.pages), cards: clone(S.cards), decks: clone(S.decks), heftDocs, heftTargets };
	}
	function changedRecords(before, after) {
		const out = [];
		for (const id of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
			if (!same(before?.[id], after?.[id])) out.push({ id, before: clone(before?.[id] ?? null), after: clone(after?.[id] ?? null) });
		}
		return out;
	}
	function undoSet(before) {
		const heftAfter = {};
		for (const id of before.heftTargets) if (S.heftDocs[id]) heftAfter[id] = S.heftDocs[id];
		return {
			pages: changedRecords(before.pages, S.pages), cards: changedRecords(before.cards, S.cards),
			decks: changedRecords(before.decks, S.decks), heftDocs: changedRecords(before.heftDocs, heftAfter),
		};
	}
	function attachUndo(result, undo) {
		Object.defineProperty(result, "_undo", { value: undo, enumerable: false });
		return result;
	}
	async function undo(changeSet) {
		if (!changeSet) throw new Error("Undo-Daten fehlen.");
		for (const key of ["pages", "cards", "decks", "heftDocs"]) {
			for (const x of changeSet[key] || []) {
				if (!same(S[key]?.[x.id] ?? null, x.after ?? null)) throw new Error("Die betroffenen Daten wurden nach der KI-Aktion erneut geändert. Mache zuerst spätere Änderungen rückgängig.");
			}
		}
		// Alte Stapel zuerst zurückbringen, damit Karten nie auf nicht vorhandene Ziele zeigen.
		for (const x of changeSet.decks || []) if (x.before && !S.decks[x.id]) await STATE.dispatch("deckCreate", { name: x.id });
		for (const x of changeSet.pages || []) {
			if (!x.before) continue;
			if (!S.pages[x.id]) await STATE.dispatch("pageCreate", clone(x.before));
			const patch = clone(x.before); delete patch.id; delete patch.created; delete patch.updated;
			await STATE.dispatch("pageUpdate", { id: x.id, patch });
			await STATE.dispatch(x.before.trashed ? "pageTrash" : "pageRestore", { id: x.id });
		}
		for (const x of changeSet.cards || []) {
			if (!x.before) continue;
			if (!S.cards[x.id]) await STATE.dispatch("cardCreate", clone(x.before));
			const patch = clone(x.before); delete patch.id; delete patch.created; delete patch.trashed; delete patch.trashedAt;
			await STATE.dispatch("cardUpdate", { id: x.id, patch });
			await STATE.dispatch(x.before.trashed ? "cardTrash" : "cardRestore", { id: x.id });
		}
		for (const x of changeSet.cards || []) if (!x.before && S.cards[x.id]) await STATE.dispatch("cardDelete", { id: x.id });
		for (const x of changeSet.pages || []) if (!x.before && S.pages[x.id]) await STATE.dispatch("pageDelete", { id: x.id });
		for (const x of changeSet.decks || []) if (!x.before && S.decks[x.id]) await STATE.dispatch("deckDelete", { name: x.id });
		for (const x of changeSet.decks || []) {
			if (!x.before) continue;
			if (typeof x.before.order === "number") await STATE.dispatch("deckReorder", { name: x.id, order: x.before.order });
			await STATE.dispatch(x.before.trashed ? "deckTrash" : "deckRestore", { name: x.id });
		}
		for (const x of changeSet.heftDocs || []) {
			if (typeof HEFT.restoreDoc !== "function") throw new Error("Heft-Wiederherstellung ist nicht verfügbar.");
			await HEFT.restoreDoc(x.id, { pages: clone(x.before?.pages || []) });
		}
		return { ok: true };
	}

	const hasField = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key) && value[key] !== null && value[key] !== undefined;
	const hasText = (value, ...keys) => keys.some((key) => hasField(value, key) && String(value[key]).trim());
	function normalizeChangeOperation(raw) {
		const op = raw && typeof raw === "object" ? { ...raw } : {};
		const nestedCard = op.card && typeof op.card === "object" && !Array.isArray(op.card) ? op.card : null;
		if (nestedCard) {
			if (!hasField(op, "op") && hasField(nestedCard, "op")) op.op = nestedCard.op;
			for (const key of ["front", "back", "new_front", "new_back", "deck", "to", "new_deck", "fronts", "query", "suspended", "limit"]) {
				if (!hasField(op, key) && hasField(nestedCard, key)) op[key] = nestedCard[key];
			}
		}
		return op;
	}
	function validateChangeOperation(op) {
		const name = op?.op;
		if (!name) return "op fehlt";
		switch (name) {
			case "page.create": return hasText(op, "title") ? "" : "title fehlt";
			case "page.append":
			case "page.replace": return hasText(op, "title") && (hasField(op, "content") || hasField(op, "text")) ? "" : "title oder content fehlt";
			case "page.rename": return hasText(op, "title") && hasText(op, "to") ? "" : "title oder neuer Name fehlt";
			case "page.move": return hasText(op, "title") ? "" : "title fehlt";
			case "page.trash": return hasText(op, "title") ? "" : "title fehlt";
			case "heft.append": return hasText(op, "title") && hasText(op, "text", "content") ? "" : "Hefttitel oder Text fehlt";
			case "card.create": return Array.isArray(op.cards) ? (op.cards.length && op.cards.every((card) => hasText(card, "front") && hasField(card, "back") ? true : false) ? "" : "Karten brauchen front und back") : (hasText(op, "front") && hasField(op, "back") ? "" : "front oder back fehlt");
			case "card.update": return hasText(op, "front", "query") && (hasField(op, "new_front") || hasField(op, "new_back") || hasField(op, "back") || hasField(op, "to")) ? "" : "Karte oder neue Werte fehlen";
			case "card.move":
				if (!hasText(op, "to")) return "Zielstapel fehlt";
				return hasText(op, "front", "fronts", "deck", "query") ? "" : "Karten-Auswahl fehlt";
			case "card.trash":
			case "card.suspend": return hasText(op, "front", "fronts", "deck", "query") ? "" : "Karten-Auswahl fehlt";
			case "card.reset": return hasText(op, "front") ? "" : "front fehlt";
			case "deck.create": return hasText(op, "deck", "title") ? "" : "Stapelname fehlt";
			case "deck.rename": return hasText(op, "deck") && hasText(op, "to") ? "" : "Stapel oder neuer Name fehlt";
			case "deck.move": return hasText(op, "deck") && hasField(op, "to") ? "" : "Stapel oder Ziel fehlt";
			case "deck.trash": return hasText(op, "deck") ? "" : "Stapel fehlt";
			default: return "";
		}
	}

	const OP_TO_TOOL = {
		"page.create": (o) => ["create_page", { title: o.title, parent_title: o.parent, content: o.content ?? o.text ?? "" }],
		"page.append": (o) => ["append_to_page", { page_title: o.title, content: o.content ?? o.text }],
		"page.replace": (o) => ["replace_page_content", { page_title: o.title, content: o.content ?? o.text }],
		"page.rename": (o) => ["rename_page", { page_title: o.title, new_title: o.to }],
		"page.move": (o) => ["move_page", { page_title: o.title, new_parent_title: o.parent }],
		"page.trash": (o) => ["delete_page", { page_title: o.title }],
		"heft.append": (o) => ["write_to_heft", { page_title: o.title, text: o.text ?? o.content, heft_page: o.page }],
		"card.create": (o) => [o.cards ? "create_flashcards" : "create_flashcard", o.cards ? { cards: o.cards, deck: o.deck, page_title: o.title } : { front: o.front, back: o.back, deck: o.deck, page_title: o.title }],
		"card.update": (o) => ["update_flashcard", { front: o.front || o.query, deck: o.deck, new_front: o.new_front, new_back: o.new_back ?? o.back, new_deck: o.to }],
		"card.move": (o) => ["move_flashcards", { fronts: o.fronts || (o.front ? [o.front] : undefined), from_deck: o.deck, query: o.query, to_deck: o.to, limit: o.limit }],
		"card.trash": (o) => ["delete_flashcards", { fronts: o.fronts || (o.front ? [o.front] : undefined), deck: o.deck, query: o.query, limit: o.limit }],
		"card.suspend": (o) => ["suspend_flashcards", { fronts: o.fronts || (o.front ? [o.front] : undefined), deck: o.deck, query: o.query, suspended: o.suspended, limit: o.limit }],
		"card.reset": (o) => ["reset_card_progress", { front: o.front, deck: o.deck }],
		"deck.create": (o) => ["create_deck", { name: o.deck || o.title }],
		"deck.rename": (o) => ["rename_deck", { deck: o.deck, new_name: o.to }],
		"deck.move": (o) => ["move_deck", { deck: o.deck, new_parent: o.to }],
		"deck.trash": (o) => ["delete_deck", { deck: o.deck }],
	};

	async function run(name, a) {
		a = a || {};
		switch (name) {
			case "inspect": {
				const limit = Math.max(1, Math.min(100, Number(a.limit) || 30));
				switch (a.kind) {
					case "context": return run("get_context", {});
					case "pages": return run("list_pages", {});
					case "page": {
						const titles = Array.isArray(a.titles) ? a.titles.slice(0, 12) : [];
						if (!titles.length) return { error: "inspect: titles fehlt für kind=page." };
						const pages = [];
						for (const title of titles) pages.push(await run("read_page", { page_title: title }));
						return { pages };
					}
					case "decks": return run("list_decks", {});
					case "cards": return run("list_flashcards", { deck: a.deck, query: a.query, limit });
					case "due": return run("list_due_cards", {});
					case "search": return run(a.semantic ? "semantic_search" : "search_notes", { query: a.query });
					case "chats": return run("search_chat_history", { query: a.query, limit });
					default: return { error: "inspect: unbekanntes kind." };
				}
			}
			case "change": {
				const operations = Array.isArray(a.operations) ? a.operations.map(normalizeChangeOperation) : [];
				if (!operations.length) return { error: "change: operations fehlt." };
				if (operations.length > 100) return { error: "change: maximal 100 Operationen pro Aktion." };
				const before = managedSnapshot(operations), results = [];
				for (let i = 0; i < operations.length; i++) {
					const op = operations[i] || {}, make = OP_TO_TOOL[op.op];
					if (!make) {
						await undo(undoSet(before));
						return { error: `change: unbekannte Operation an Position ${i + 1}: ${op.op || "(leer)"}. Nichts geändert.` };
					}
					const validation = validateChangeOperation(op);
					if (validation) {
						await undo(undoSet(before));
						return { error: `Operation ${i + 1} (${op.op}) unvollständig: ${validation}. Nichts geändert.` };
					}
					const [tool, args] = make(op);
					let result;
					try { result = await run(tool, args); }
					catch (error) { result = { error: String(error?.message || error) }; }
					if (result?.error) {
						await undo(undoSet(before));
						return { error: `Operation ${i + 1} (${op.op}) fehlgeschlagen: ${result.error}. Alle vorherigen Änderungen wurden zurückgenommen.` };
					}
					results.push({ op: op.op, ...result });
				}
				const changes = undoSet(before);
				const count = changes.pages.length + changes.cards.length + changes.decks.length + changes.heftDocs.length;
				return attachUndo({ ok: true, operations: results.length, changedObjects: count, results }, changes);
			}
			case "create_page": {
				const title = String(a.title || "").trim();
				if (!title) return { error: "create_page: title fehlt." };
				// Eine angegebene Elternseite MUSS es geben — vorher landete die Seite bei einem
				// Tippfehler kommentarlos ganz oben, während move_page in derselben Lage meckert.
				const parent = a.parent_title ? STATE.findPage(a.parent_title) : null;
				if (a.parent_title && !parent) return { error: "Elternseite nicht gefunden: " + a.parent_title };
				const id = U.uid();
				await STATE.dispatch("pageCreate", {
					id, title, parentId: parent ? parent.id : null, content: a.content || "",
					workspaceId: S.currentWorkspaceId,
				});
				// id MITGEBEN: ai.js baut daraus die Änderungs-Karte. Ohne sie wurde die Seite nur
				// über den Titel gesucht — bei Namensgleichheit die falsche (Diff/Rückgängig kaputt).
				return { ok: true, id, title, parent: parent ? parent.title : null };
			}
			case "append_to_page": {
				const pg = STATE.findPage(a.page_title);
				if (!pg) return { error: "Seite nicht gefunden: " + a.page_title };
				const content = String(a.content ?? "").trim();
				if (!content) return { error: "append_to_page: content fehlt." };
				// BUGFIX (15. Juli): Hefte rendern nur den Blob (Striche/Bilder/Texte) —
				// Markdown in pg.content wäre unsichtbar. Deshalb auf sichtbare Text-Box umleiten.
				if (pg.kind === "heft") return await run("write_to_heft", { page_title: a.page_title, text: content });
				await STATE.dispatch("pageUpdate", {
					id: pg.id, patch: { content: (pg.content ? pg.content + "\n\n" : "") + content },
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
			case "rename_page": {
				const pg = STATE.findPage(a.page_title), title = String(a.new_title || "").trim();
				if (!pg) return { error: "Seite nicht gefunden: " + a.page_title };
				if (!title) return { error: "rename_page: new_title fehlt." };
				await STATE.dispatch("pageUpdate", { id: pg.id, patch: { title } });
				return { ok: true, from: a.page_title, title };
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
				// EIN Baum-Durchlauf für Zählung UND Tab-Schließen (pageTrash markiert den ganzen Baum).
				const trashIds = STATE.pageSubtreeIds(pg.id);
				const subtreeExtra = trashIds.size - 1;
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
			case "delete_flashcards": {
				// Bestätigung erzwingt ai.js. ids = exakte Auswahl, die in der Bestätigung stand
				// (eindeutig, auch wenn zwei Karten denselben Vorderseiten-Text haben).
				let cards, leftOver = 0;
				if (Array.isArray(a.ids) && a.ids.length) {
					cards = a.ids.map((id) => S.cards[id]).filter((c) => c && !c.trashed);
					if (!cards.length) return { error: "Die vorgemerkten Karten gibt es nicht mehr." };
				} else {
					const sel = selectCards(a);
					if (sel.error) return sel;
					if (!sel.cards.length) return { error: "Keine passenden Karten gefunden." };
					cards = sel.cards;
					leftOver = sel.total - sel.cards.length;
				}
				for (const c of cards) await STATE.dispatch("cardTrash", { id: c.id });
				return {
					ok: true, trashed: cards.length,
					decks: [...new Set(cards.map((c) => c.deck || "Standard"))],
					examples: cards.slice(0, 5).map((c) => String(c.front || "").replace(/\s+/g, " ").slice(0, 60)),
					// Ehrlich bleiben, wenn die Sicherheitsgrenze zugeschlagen hat.
					...(leftOver > 0 ? { notDeleted: leftOver, hinweis: "Sicherheitsgrenze erreicht — " + leftOver + " weitere Treffer wurden NICHT gelöscht. Für den Rest erneut aufrufen." } : {}),
					note: "Im Papierkorb — wiederherstellbar.",
				};
			}
			case "delete_deck": {
				const hit = resolveDeckStrict(a.deck);
				if (hit.error) return hit;
				const match = hit.deck;
				const n = cardsOfDeck(match).length; // gleiche Teilbaum-Regel wie überall sonst
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
				// Bug-Fix („kommt noch“, 23. Juli): automatischer Kontext für die Karte, die
				// gerade auf dem Bildschirm offen ist. Gleiche Karten-Logik wie die Lern-
				// Ansicht (render-anki.js): nach dem Aufdecken zählt die festgepinnte Karte
				// (S.reviewCardId), sonst die vorderste Karte der aktuellen Queue.
				let currentCard = null;
				try {
					if (S.view === "anki" && (S.ankiTab || "decks") === "study") {
						const c = (S.reviewShowBack && S.cards[S.reviewCardId]) || STATE.studySnapshot(S.ankiDeck).dueNow[0] || null;
						if (c) currentCard = {
							front: c.front,
							back: c.back,
							deck: c.deck || "Standard",
							state: c.srs.state,
							reps: c.srs.reps || 0,
							lapses: c.srs.lapses || 0,
							revealed: !!S.reviewShowBack,
							note: S.reviewShowBack
								? "Die Rückseite ist bereits aufgedeckt."
								: "Die Rückseite ist noch NICHT aufgedeckt — die Antwort nicht verraten, außer der Nutzer bittet ausdrücklich darum.",
						};
					}
				} catch { /* Karten-Kontext optional */ }
				return {
					now: now.toLocaleDateString("de-DE", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) + ", " + now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr",
					currentPage: cur ? { title: cur.title, content: body.slice(0, 4000) + (body.length > 4000 ? "\n[… gekürzt — Rest per read_page]" : "") } : null,
					currentCard,
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
			case "list_pages": {
				// Nur aktive Seiten — Papierkorb-Inhalte sind für die KI unsichtbar.
				// FIX: gab ALLE Seiten zurück. ai.js kappt Tool-Ergebnisse hart bei 6000 Zeichen —
				// beim Modell kam abgeschnittenes, unlesbares JSON an. Jetzt zuletzt bearbeitete
				// zuerst, harte Obergrenze, ehrliche Gesamtzahl statt stiller Kappung.
				const all = STATE.activePages().slice().sort((x, y) => String(y.updated || "").localeCompare(String(x.updated || "")));
				// 100 Einträge lagen bereits über der 6000-Zeichen-Grenze in ai.js — die Liste kam beim
				// Modell abgeschnitten an. 60 passen sicher hinein, der Rest läuft über die Suche.
				return {
					pages: all.slice(0, 60).map((pg) => ({
						title: pg.title,
						parent: pg.parentId ? (S.pages[pg.parentId] || {}).title || null : null,
						hasPdf: !!pg.pdfId,
					})),
					total: all.length,
					...(all.length > 60 ? { note: "Nur die 60 zuletzt bearbeiteten Seiten — für den Rest search_notes oder semantic_search nutzen." } : {}),
				};
			}
			case "search_notes":
				return keywordHits(a.query);
			case "semantic_search": {
				const hits = await RAG.search(a.query);
				// Gleiche gedeckelte Trefferform wie search_notes statt einer zweiten Kopie.
				if (hits === null) return { info: "Kein Embedding-Modell konfiguriert — Stichwortsuche verwendet.", ...keywordHits(a.query) };
				return { results: hits };
			}
			case "create_flashcard": {
				// FIX: leere Vorder-/Rückseite legte eine unbrauchbare Karte an — create_flashcards
				// filtert solche Einträge längst, hier fehlte dieselbe Prüfung.
				if (!String(a.front || "").trim() || !String(a.back || "").trim()) return { error: "create_flashcard: front und back dürfen nicht leer sein." };
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
			case "list_due_cards": {
				// Ohne Stapel und Gesamtzahl konnte das Modell nicht sagen, WO die Karten liegen,
				// und hielt die gekappten 20 für alles.
				const due = STATE.dueCards();
				return {
					due: due.slice(0, 20).map((c) => ({ front: c.front, deck: c.deck || "Standard", due: c.srs.due })),
					totalDue: due.length,
				};
			}
			case "list_flashcards": {
				// EINE Auswahl-Logik (selectCards) statt einer zweiten Kopie aus Stapel-Auflösung,
				// Textfilter und Limit — die beiden Kopien drifteten sonst auseinander.
				const sel = selectCards({ deck: a.deck, query: a.query, limit: Number(a.limit) || 30 }, { max: 100, allowAll: true });
				if (sel.error) return sel;
				return {
					cards: sel.cards.map((c) => ({
						front: c.front, back: c.back, deck: c.deck || "Standard",
						state: (c.srs && c.srs.state) || "new", due: (c.srs && c.srs.due) || null, suspended: !!c.suspended,
					})),
					totalMatches: sel.total,
					// Gekappte Liste ehrlich melden, sonst hält das Modell die Auswahl für vollständig.
					...(sel.truncated ? { note: "Nur " + sel.cards.length + " von " + sel.total + " Treffern — mit deck/query eingrenzen oder limit erhöhen (max. 100)." } : {}),
				};
			}
			case "list_decks": {
				const names = Object.keys(S.decks).filter((n) => S.decks[n] && !S.decks[n].trashed).sort((x, y) => x.localeCompare(y));
				// EIN Durchlauf über die Karten statt drei Filterläufe JE Stapel; der Teilbaum
				// ergibt sich direkt aus dem Namenspfad („Eltern::Kind“).
				const direct = new Map(), tree = new Map(), paused = new Map();
				const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);
				for (const c of STATE.activeCards()) {
					const d = c.deck || "Standard";
					bump(direct, d);
					const parts = d.split("::");
					for (let i = 1; i <= parts.length; i++) {
						const n = parts.slice(0, i).join("::");
						bump(tree, n);
						if (c.suspended) bump(paused, n);
					}
				}
				// Der Tages-Lernstand ist pro Stapel eine eigene Berechnung — bei sehr vielen
				// Stapeln war genau das der teuerste Aufruf im ganzen Werkzeugkasten.
				const withToday = names.length <= 25;
				return {
					decks: names.map((n) => {
						let today = null;
						if (withToday) {
							try {
								const cnt = STATE.studySnapshot(n).counts;
								today = { neu: cnt.neu, lernen: cnt.learn, wiederholen: cnt.review };
							} catch { /* Lernstand optional */ }
						}
						return {
							name: n,
							cards: direct.get(n) || 0,
							cardsInclSubdecks: tree.get(n) || 0,
							suspended: paused.get(n) || 0,
							today,
						};
					}),
					...(withToday ? {} : { note: "Tages-Lernstand bei sehr vielen Stapeln ausgelassen — bei Bedarf get_context oder list_due_cards nutzen." }),
				};
			}
			case "create_deck": {
				const name = String(a.name || "").trim();
				if (!name) return { error: "create_deck: name fehlt." };
				const existed = Object.keys(S.decks).some((n) => n.toLowerCase() === name.toLowerCase() && !S.decks[n].trashed);
				const deck = await ensureDeck(name);
				return { ok: true, deck, note: existed ? "Stapel gab es bereits — unverändert." : "Neu angelegt." };
			}
			case "rename_deck": {
				const src = resolveDeckStrict(a.deck);
				if (src.error) return src;
				const from = src.deck;
				const to = String(a.new_name || "").trim().replace(/^:+|:+$/g, "").trim();
				if (!to) return { error: "rename_deck: new_name fehlt." };
				if (to === from) return { ok: true, deck: from, note: "Name unverändert." };
				// Zyklus: der neue Pfad darf nicht innerhalb des Stapels selbst liegen.
				if (STATE.deckInTree(to, from)) return { error: "Der neue Name liegt innerhalb des Stapels selbst — das ergäbe einen Zyklus." };
				const clash = await freeDeckSlot(to);
				if (clash) return { error: clash };
				const n = cardsOfDeck(from).length;
				await STATE.dispatch("deckRename", { from, to });
				return { ok: true, from, to, cards: n, note: "Unterstapel und Karten sind mitgewandert." };
			}
			case "move_deck": {
				const src = resolveDeckStrict(a.deck);
				if (src.error) return src;
				const from = src.deck;
				let target = "";
				if (String(a.new_parent || "").trim()) {
					const dst = resolveDeckStrict(a.new_parent);
					if (dst.error) return { error: "Ziel-" + dst.error.charAt(0).toLowerCase() + dst.error.slice(1) };
					target = dst.deck;
					if (STATE.deckInTree(target, from)) return { error: "Ein Stapel kann nicht in sich selbst oder einen eigenen Unterstapel wandern." };
				}
				const to = (target ? target + "::" : "") + from.split("::").pop();
				if (to === from) return { ok: true, deck: from, note: "Der Stapel liegt bereits dort." };
				const clash = await freeDeckSlot(to);
				if (clash) return { error: "Am Zielort: " + clash };
				await STATE.dispatch("deckMove", { from, target });
				return { ok: true, from, to };
			}
			case "move_flashcards": {
				if (!String(a.to_deck || "").trim()) return { error: "move_flashcards: to_deck fehlt." };
				const sel = selectCards(a);
				if (sel.error) return sel;
				if (!sel.cards.length) return { error: "Keine passenden Karten gefunden." };
				const deck = await ensureDeck(a.to_deck);
				if (!deck) return { error: "move_flashcards: to_deck ist leer." };
				let moved = 0;
				for (const c of sel.cards) {
					if ((c.deck || "Standard") === deck) continue;
					await STATE.dispatch("cardUpdate", { id: c.id, patch: { deck } });
					moved++;
				}
				return {
					ok: true, deck, moved, alreadyThere: sel.cards.length - moved,
					examples: sel.cards.slice(0, 5).map((c) => String(c.front || "").slice(0, 60)),
					note: "Lernfortschritt der Karten bleibt erhalten.",
				};
			}
			case "update_flashcard": {
				const c = findCard(a.front, a.deck);
				if (!c) return { error: "Karte nicht gefunden: " + a.front };
				const patch = {};
				if (String(a.new_front || "").trim()) patch.front = String(a.new_front);
				if (String(a.new_back || "").trim()) patch.back = String(a.new_back);
				if (String(a.new_deck || "").trim()) patch.deck = await ensureDeck(a.new_deck);
				if (!Object.keys(patch).length) return { error: "update_flashcard: nichts zu ändern — new_front, new_back oder new_deck angeben." };
				await STATE.dispatch("cardUpdate", { id: c.id, patch });
				return {
					ok: true, changed: Object.keys(patch),
					front: patch.front || c.front, back: patch.back || c.back, deck: patch.deck || c.deck || "Standard",
					note: "Lernfortschritt bleibt erhalten.",
				};
			}
			case "suspend_flashcards": {
				if (typeof a.suspended !== "boolean") return { error: "suspend_flashcards: suspended (true/false) fehlt." };
				const sel = selectCards(a);
				if (sel.error) return sel;
				if (!sel.cards.length) return { error: "Keine passenden Karten gefunden." };
				let changed = 0;
				for (const c of sel.cards) {
					if (!!c.suspended === a.suspended) continue;
					await STATE.dispatch("cardUpdate", { id: c.id, patch: { suspended: a.suspended } });
					changed++;
				}
				return { ok: true, suspended: a.suspended, changed, unchanged: sel.cards.length - changed };
			}
			case "reset_card_progress": {
				// Bestätigung erzwingt ai.js (wie bei den Lösch-Tools) — hier nur die Aktion selbst.
				const sel = selectCards(a);
				if (sel.error) return sel;
				if (!sel.cards.length) return { error: "Keine passenden Karten gefunden." };
				const now = U.now();
				for (const c of sel.cards) {
					await STATE.dispatch("cardUpdate", { id: c.id, patch: { srs: SRS.newCard(now), leech: false, suspended: false } });
				}
				return { ok: true, reset: sel.cards.length, note: "Die Karten stehen wieder als „neu“ in der Warteschlange. Das Wiederholungs-Protokoll (Statistik/Heatmap) bleibt erhalten." };
			}
			case "send_to_notebooklm": {
				// Übergibt an notebooklm.js: kopiert die Seiteninhalte und öffnet Gemini Notebook.
				// Das passiert am Ende einer KI-Antwort, also OHNE direkten Klick — Browser
				// verweigern das Kopieren dann gern. Dieser Fehler darf nicht still verschwinden.
				try {
					return (await NLM.sendPages(a.page_titles || [])) || { ok: true };
				} catch (e) {
					return { error: "Übergabe an Gemini Notebook fehlgeschlagen: " + String((e && e.message) || e) + ". Häufigste Ursache: Die Zwischenablage ist ohne direkten Klick gesperrt — Inhalte bitte manuell kopieren." };
				}
			}
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
				if (typeof window.math === "undefined" || typeof window.math.evaluate !== "function") {
					try {
						await U.loadScript(OPTIONAL_MODULE_URLS.math, "math");
					} catch {
						return { error: "Mathe-Modul (math.js) konnte nicht geladen werden. Internetverbindung für den Erstabruf erforderlich." };
					}
				}
				if (typeof window.math === "undefined" || typeof window.math.evaluate !== "function") return { error: "Mathe-Modul (math.js) nicht geladen — evtl. noch offline/kein Netz beim ersten Start." };
				const expr = String(a.expression || "").trim();
				if (!expr) return { error: "calculate: expression fehlt." };
				try {
					// Sonderform integrate("f(x)", "x", a, b) — math.js kann das nicht nativ,
					// daher hier per Simpson-Regel selbst numerisch lösen.
					const intBody = expr.match(/^integrate\(([\s\S]*)\)$/);
					const intArgs = intBody ? splitTopLevelArgs(intBody[1]) : [];
					if (intArgs.length === 4 && /^(['"])[\s\S]*\1$/.test(intArgs[0]) && /^(['"])[\s\S]*\1$/.test(intArgs[1])) {
						const fnExpr = intArgs[0].slice(1, -1), varName = intArgs[1].slice(1, -1), loStr = intArgs[2], hiStr = intArgs[3];
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
				// PERF-WURZEL: Vorher wurde je Nachricht ein Gesamttext aus Datei- UND PDF-Volltexten
				// zusammengebaut und komplett kleingeschrieben — pro Suche viele Megabyte Kopien,
				// währenddessen stand die Oberfläche. Zudem sammelte die Suche ALLE Treffer und
				// sortierte sie, um dann 15 zu behalten (bei einem Häufigkeitswort zehntausende).
				// Jetzt Teil für Teil prüfen, Treffer nur bis zum Deckel sammeln — CHATS.load() liefert
				// die Sitzungen bereits absteigend nach Änderung, die Sortierung entfällt damit.
				const hits = [];
				let totalMatches = 0;
				for (const session of CHATS.load()) {
					for (const m of session.messages || []) {
						if (m.role !== "user" && m.role !== "assistant") continue;
						const parts = [];
						if (typeof m.content === "string" && m.content) parts.push(m.content);
						if (m.textFile) parts.push("[Datei: " + m.textFile.name + "]\n" + String(m.textFile.content || ""));
						if (m.pdfFile) parts.push("[PDF: " + m.pdfFile.name + "]\n" + String(m.pdfFile.content || ""));
						if (m.image) parts.push("[Bild-Anhang]");
						let idx = -1;
						const text = parts.find((p) => (idx = p.toLowerCase().indexOf(q)) !== -1);
						if (!text) continue;
						totalMatches++;
						if (hits.length >= limit) continue;
						const from = Math.max(0, idx - 60), to = Math.min(text.length, idx + q.length + 60);
						const snippet = (from > 0 ? "…" : "") + text.slice(from, to).replace(/\s+/g, " ").trim() + (to < text.length ? "…" : "");
						hits.push({ chatId: session.id, chatTitle: session.title || "(ohne Titel)", updated: String(session.updated || "").slice(0, 16).replace("T", " "), role: m.role, snippet });
					}
				}
				return { results: hits, totalMatches };
			}
			default:
				return { error: "Unbekanntes Tool: " + name };
		}
	}

	// cardsOfDeck/subtreeIds nach außen: ai.js baut damit seine Bestätigungstexte, statt
	// dieselben Baum-Regeln ein zweites Mal zu formulieren (drifteten sonst auseinander).
	return { defs, run, undo, normalizeAskChoice, findCard, resolveDeckStrict, deckMatches, selectCards, cardsOfDeck, subtreeIds: STATE.pageSubtreeIds };
})();
