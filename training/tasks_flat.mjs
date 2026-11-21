// Trainings-Aufgaben für das Teacher-Rejection-Sampling (flache Werkzeuge aus tool_defs_flat.json).
// Bewusst ANDERE Fragen/Themen als tools/ai-bench/scenarios.mjs, um Test-Leak zu vermeiden.
// Jede Aufgabe wird in der isolierten Spielwiese über den echten Rust-Agenten (CORE.AiRun) ausgeführt.

import {
	calledTool, countCreatedCards, hasChange, hasChangeWhere, hasTool, hasToolWhere, matchText, nonEmpty, noToolErrors, noTools,
} from "./task_helpers.mjs";
import { V4_TASKS } from "./tasks_v4/index.mjs";

const V3_TASKS = [
	// =========================================================================
	// 1. Lesen, Suchen & Kontext (list_pages, read_pages, search, get_context, search_chats)
	// =========================================================================
	{
		id: "flat-list-dgl-vl",
		mode: "mcp",
		turns: [
			{
				text: "Welche Vorlesungen gibt es im Ordner „📖 Vorlesungen“ unter Differentialgleichungen, und worum geht es laut der Seite „12 · Runge-Kutta-Verfahren“ im Kern?",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("list_pages")(r) &&
					hasTool("read_pages")(r) &&
					matchText(/runge.?kutta|rk4|schritt/i)(r),
			},
			{
				text: "Schau dir auch noch „13 · Zeitschrittkontrolle“ an und fasse in 3 Stichpunkten den Unterschied zu „12 · Runge-Kutta-Verfahren“ zusammen.",
				check: (r) => noToolErrors(r) && hasTool("read_pages")(r) && nonEmpty(60)(r),
			},
		],
	},
	{
		id: "flat-read-fkp-bragg",
		mode: "app",
		workspacePage: "Festkörperphysik",
		turns: [
			{
				text: "Lies die Seite „Strukturaufklärung – Bragg, reziprokes Gitter & Beugungsmethoden“ und erkläre mir knapp die Bragg-Bedingung als LaTeX-Formel.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					matchText(/2\s*d\s*\\?sin|bragg/i)(r) &&
					matchText(/\$/)(r),
			},
		],
	},
	{
		id: "flat-read-window-offset",
		mode: "mcp",
		turns: [
			{
				text: "Suche in meinen Notizen nach „Miller-Indizes“ und lies die passende Seite dazu. Wie werden Ebenen- und Richtungsindizes in Kristallen notiert?",
				check: (r) =>
					noToolErrors(r) &&
					(hasTool("search")(r) || hasTool("read_pages")(r)) &&
					matchText(/\(h\s*k\s*l\)|\[u\s*v\s*w\]|miller/i)(r),
			},
		],
	},
	{
		id: "flat-read-long-find-offset",
		mode: "app",
		workspacePage: "Festkörperphysik",
		turns: [
			{
				text: "Die Seite „Struktur der Kristalle – Gitter, Basis & Miller-Indizes“ ist lang. Springe per `read_pages` mit `find` gezielt zur Stelle „Miller“ und erkläre in 3 Sätzen, wie man Miller-Indizes bestimmt.",
				check: (r) =>
					noToolErrors(r) &&
					hasToolWhere("read_pages", (a) => Boolean(a.find) || (typeof a.offset === "number" && a.offset > 0))(r) &&
					matchText(/reziprok|achsenabschnitt|miller|\(h\s*k\s*l\)/i)(r),
			},
			{
				text: "Lies jetzt mit `offset` (oder einem weiteren `find`) noch einen anderen Abschnitt derselben Seite über Bravais-Gitter bzw. Elementarzellen und nenne zwei Beispiele daraus.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					nonEmpty(60)(r),
			},
		],
	},
	{
		id: "flat-read-multi-pages-compare",
		mode: "mcp",
		turns: [
			{
				text: "Lies „4 · Die pn-Diode“ und „Lab 1 · Dioden“ zusammen ein und stelle knapp gegenüber, was Theorie-Vorlesung vs. Praktikum jeweils betonen.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					matchText(/diode|praktikum|kennlinie|sperr|durchlass/i)(r) &&
					nonEmpty(80)(r),
			},
			{
				text: "Nimm noch „5 · Diodenschaltungen – Lastgerade, Z-Diode, Gleichrichter“ dazu und nenne drei dort behandelte Schaltungsanwendungen.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					matchText(/gleichrichter|z-?diode|lastgerade|stabilis/i)(r),
			},
		],
	},
	{
		id: "flat-list-pages-chemie",
		mode: "mcp",
		turns: [
			{
				text: "Liste alle Seiten unter „Allgemeine und Anorganische Chemie“ auf und gib mir eine knappe Übersicht der vorhandenen Module.",
				check: (r) =>
					noToolErrors(r) &&
					hasToolWhere("list_pages", (a) => /chemie/i.test(String(a.parent || "")) || !a.parent)(r) &&
					matchText(/atombau|pse|bindung/i)(r),
			},
			{
				text: "Filtere mit `list_pages` (`query`) nach „Bindung“ und lies die Seite „4 · Chemische Bindung I“. Welche Bindungstypen werden eingeführt?",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("list_pages")(r) &&
					hasTool("read_pages")(r) &&
					matchText(/ionen|kovalent|metall|bindung/i)(r),
			},
		],
	},
	{
		id: "flat-list-pages-archived",
		mode: "mcp",
		turns: [
			{
				text: "Lege unter „Todo in der App“ eine kleine Testnotiz „Notiz · Archivcheck“ mit dem Text „Erledigt“ an und archiviere sie anschließend.",
				check: (r) =>
					noToolErrors(r) &&
					hasChange("page.create")(r) &&
					hasChange("page.archive")(r),
			},
			{
				text: "Prüfe über `list_pages` mit `archived: true`, ob „Notiz · Archivcheck“ im Archiv gelistet wird.",
				check: (r) =>
					noToolErrors(r) &&
					hasToolWhere("list_pages", (a) => a.archived === true)(r) &&
					matchText(/archivcheck/i)(r),
			},
			{
				text: "Hole „Notiz · Archivcheck“ wieder aus dem Archiv zurück.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("organize_pages")(r) &&
					hasChange("page.unarchive")(r),
			},
		],
	},
	{
		id: "flat-search-mosfet-amp",
		mode: "mcp",
		turns: [
			{
				text: "Durchsuche meine Notizen nach „aktive Lasten“ oder „MOSFET-Verstärker“ und nenne mir die wichtigsten Kenngrößen aus der passenden Vorlesungsseite.",
				check: (r) => noToolErrors(r) && hasTool("search")(r) && hasTool("read_pages")(r) && nonEmpty(80)(r),
			},
		],
	},
	{
		id: "flat-search-semantic-chemie",
		mode: "app",
		turns: [
			{
				text: "Was steht in meinen Notizen zum Thema „Allgemeine und Anorganische Chemie“? Suche nach dem Ordner bzw. der Fachseite und gib mir eine kurze Übersicht.",
				check: (r) =>
					noToolErrors(r) &&
					(hasTool("search")(r) || hasTool("list_pages")(r) || hasTool("read_pages")(r)) &&
					nonEmpty(60)(r),
			},
		],
	},
	{
		id: "flat-search-semantic-mechanik",
		mode: "app",
		workspacePage: "Kontinuumsmechanik",
		turns: [
			{
				text: "Nutze die Bedeutungssuche (`search` mit `semantic: true`) zum Thema „Auflagerkräfte und statische Bestimmtheit“, lies den besten Treffer nach und fasse die Kernaussage zusammen.",
				check: (r) =>
					noToolErrors(r) &&
					hasToolWhere("search", (a) => a.semantic === true)(r) &&
					hasTool("read_pages")(r) &&
					matchText(/lager|bestimmt|freiheitsgrad|gleichgewicht/i)(r),
			},
			{
				text: "Vergleiche das kurz mit „3 · Allgemeine Kraftsysteme, Drehmoment & Kräftepaar“.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					matchText(/moment|kräftepaar|drehmoment/i)(r),
			},
		],
	},
	{
		id: "flat-search-keyword-chemie-pse",
		mode: "mcp",
		turns: [
			{
				text: "Suche in meinen Notizen nach „Elektronegativität“ und lies die Seite „3 · Trends im PSE“. Wie verlaufen Elektronegativität und Atomradius im Periodensystem?",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("search")(r) &&
					hasTool("read_pages")(r) &&
					matchText(/elektronegativit|radius|periode|gruppe/i)(r),
			},
			{
				text: "Verknüpfe das anhand von „4 · Chemische Bindung I“ damit, wie $\\Delta \\mathrm{EN}$ den Bindungstyp beeinflusst.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					matchText(/polar|kovalent|ionen/i)(r),
			},
		],
	},
	{
		id: "flat-get-context",
		mode: "app",
		workspacePage: "Elektronik – Bauelemente und analoge Schaltungen",
		turns: [
			{
				text: "Prüfe mit get_context, welche Seite gerade geöffnet ist und wie mein aktueller Lernstand aussieht. Antworte in zwei knappen Sätzen.",
				check: (r) => noToolErrors(r) && hasTool("get_context")(r) && nonEmpty(30)(r),
			},
		],
	},
	{
		id: "flat-app-open-page-opv",
		mode: "app",
		workspacePage: "15 · Operationsverstärker",
		turns: [
			{
				text: "Fasse mir die Eigenschaften eines idealen Operationsverstärkers von dieser geöffneten Seite in 4 kurzen Stichpunkten mit LaTeX zusammen.",
				check: (r) =>
					noToolErrors(r) &&
					matchText(/\$/)(r) &&
					matchText(/verstärkung|eingang|ideal|strom|spannung/i)(r) &&
					nonEmpty(70)(r),
			},
			{
				text: "Erstelle dazu 3 atomare Karteikarten im Stapel „Elektronik::OPV“ (Formeln als LaTeX).",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("create_cards")(r) &&
					countCreatedCards(r) === 3 &&
					hasChangeWhere("card.create", (c) => /elektronik::opv/i.test(String(c.deck || "")))(r),
			},
		],
	},
	{
		id: "flat-search-chats-and-due",
		mode: "app",
		turns: [
			{
				text: "Schau nach, welche Karteikarten heute fällig sind (list_cards mit due=true), und suche außerdem mit search_chats nach früheren Gesprächen über „Klausur“.",
				check: (r) => noToolErrors(r) && hasTool("list_cards")(r) && hasTool("search_chats")(r) && nonEmpty(30)(r),
			},
		],
	},
	{
		id: "flat-search-chats-followup",
		mode: "app",
		workspacePage: "Differentialgleichungen",
		turns: [
			{
				text: "Suche mit `search_chats` nach früheren Chats zum Thema „Differentialgleichung“ oder „Übungsblatt“ und berichte kurz, was du findest (oder sag ehrlich, falls es keine Treffer gibt).",
				check: (r) => noToolErrors(r) && hasTool("search_chats")(r) && nonEmpty(25)(r),
			},
			{
				text: "Prüfe zusätzlich per `get_context`, wie viele Karten heute insgesamt zu lernen bzw. zu wiederholen sind.",
				check: (r) => noToolErrors(r) && hasTool("get_context")(r) && nonEmpty(25)(r),
			},
		],
	},

	// =========================================================================
	// 2. Seiten erstellen (create_pages: normal, props, heft: true, Batch)
	// =========================================================================
	{
		id: "flat-create-page-with-props",
		mode: "app",
		workspacePage: "Differentialgleichungen",
		turns: [
			{
				text: "Lege im Ordner „📖 Vorlesungen“ unter „Differentialgleichungen“ eine neue Lernzettel-Seite namens „Spickzettel · Numerische DGLs“ an. Nimm die Kernideen aus „11 · Numerik: Euler-Integration“ und „12 · Runge-Kutta-Verfahren“ mit LaTeX-Formeln auf.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					hasTool("create_pages")(r) &&
					hasChange("page.create")(r) &&
					matchText(/spickzettel/i)(r),
			},
		],
	},
	{
		id: "flat-create-page-inspect-props",
		mode: "app",
		workspacePage: "Festkörperphysik",
		turns: [
			{
				text: "Lies „Festkörperphysik“ und „Struktur der Kristalle – Gitter, Basis & Miller-Indizes“ kurz an und prüfe, ob ein Verzeichnis mit Spalten (`columns`) vorliegt.",
				check: (r) => noToolErrors(r) && hasTool("read_pages")(r) && nonEmpty(35)(r),
			},
			{
				text: "Lies „Bindungsverhältnisse“ und erstelle unter „Festkörperphysik“ eine neue Seite „Zusammenfassung · Bindungstypen“ mit LaTeX-Formeln. Falls „Festkörperphysik“ Spalten definiert, fülle passende `props` aus (sonst ohne `props`).",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					hasTool("create_pages")(r) &&
					hasChangeWhere("page.create", (c) => /bindungstypen/i.test(String(c.title || "")))(r),
			},
		],
	},
	{
		id: "flat-create-multi-pages-batch",
		mode: "mcp",
		turns: [
			{
				text: "Lies „2 · Grundbegriffe, Kräfte & Zentralkraftsystem“ und „4 · Lager, Lagerreaktionen & Statische Bestimmtheit“ und lege anschließend unter „Kontinuumsmechanik“ in einem Schritt zwei Merkblätter an: „Merkblatt · Zentralkraftsystem“ und „Merkblatt · Lagerreaktionen“.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					hasTool("create_pages")(r) &&
					r.changes.filter((c) => c.op === "page.create").length >= 2,
			},
			{
				text: "Hänge an „Merkblatt · Lagerreaktionen“ noch eine 2-Punkte-Checkliste zur Prüfung der statischen Bestimmtheit an, ohne bestehenden Text zu überschreiben.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("edit_page")(r) &&
					(hasChange("page.append")(r) || hasChange("page.patch")(r)) &&
					!hasChange("page.replace")(r),
			},
		],
	},
	{
		id: "flat-create-heft",
		mode: "mcp",
		turns: [
			{
				text: "Erstelle ein neues Handschrift-Heft mit dem Titel „Übungsblatt · Wärmeleitung Probe“ im Ordner „📝 Übungen“ unter „Differentialgleichungen“.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("create_pages")(r) &&
					hasChangeWhere("page.create", (c) => c.heft === true)(r),
			},
			{
				text: "Schreibe auf Seite 1 dieses neuen Hefts eine kurze Aufgaben-Textbox zur 1D-Wärmeleitungsgleichung.",
				check: (r) => noToolErrors(r) && hasTool("write_to_heft")(r) && hasChange("heft.append")(r),
			},
		],
	},
	{
		id: "flat-create-heft-with-multipage-text",
		mode: "app",
		workspacePage: "Elektronik – Bauelemente und analoge Schaltungen",
		turns: [
			{
				text: "Lege im Ordner „🧪 Praktikum“ unter „Elektronik – Bauelemente und analoge Schaltungen“ ein neues Handschrift-Heft namens „Rechenheft · Dioden-Übung“ an.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("create_pages")(r) &&
					hasChangeWhere("page.create", (c) => c.heft === true && /dioden/i.test(String(c.title || "")))(r),
			},
			{
				text: "Schreibe auf Seite 1 von „Rechenheft · Dioden-Übung“ eine Aufgaben-Textbox für eine Z-Diode als Spannungsstabilisierung.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("write_to_heft")(r) &&
					hasChange("heft.append")(r),
			},
			{
				text: "Schreibe auf Seite 2 desselben Hefts eine Lösungs-Checkliste als zweite Textbox.",
				check: (r) =>
					noToolErrors(r) &&
					hasToolWhere("write_to_heft", (a) => Number(a.page) === 2)(r) &&
					hasChange("heft.append")(r),
			},
		],
	},
	{
		id: "flat-create-page-cmos-summary",
		mode: "app",
		workspacePage: "20 · CMOS-Grundlagen – der Inverter",
		turns: [
			{
				text: "Erstelle auf Basis der geöffneten Seite eine kompakte Zusammenfassung „Lernzettel · CMOS-Inverter“ direkt unter „Elektronik – Bauelemente und analoge Schaltungen“ (Pull-Up/Pull-Down-Netzwerk und Schaltschwelle mit LaTeX).",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("create_pages")(r) &&
					hasChangeWhere("page.create", (c) => /cmos-inverter/i.test(String(c.title || "")))(r),
			},
			{
				text: "Erzeuge aus diesem Thema 3 kurze Karteikarten im Stapel „Elektronik::Digitaltechnik::CMOS“.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("create_cards")(r) &&
					countCreatedCards(r) === 3 &&
					hasChangeWhere("card.create", (c) => /cmos/i.test(String(c.deck || "")))(r),
			},
		],
	},
	{
		id: "flat-create-page-fourier-laplace",
		mode: "mcp",
		turns: [
			{
				text: "Lies „9 · Fourier-Methoden“ und „10 · Laplace-Transformation“ und lege unter „Differentialgleichungen“ eine Vergleichsseite „Vergleich · Fourier vs Laplace“ mit einer Markdown-Tabelle an.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					hasTool("create_pages")(r) &&
					hasChange("page.create")(r),
			},
			{
				text: "Hänge an „Vergleich · Fourier vs Laplace“ noch zwei exemplarische Transformationspaare in LaTeX an.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("edit_page")(r) &&
					(hasChange("page.append")(r) || hasChange("page.patch")(r)) &&
					!hasChange("page.replace")(r),
			},
		],
	},
	{
		id: "flat-create-page-chemie-atombau",
		mode: "app",
		workspacePage: "Allgemeine und Anorganische Chemie",
		turns: [
			{
				text: "Lies „1 · Intro Chemie & Atombau I“ und „2 · Atombau II“ und lege unter „Allgemeine und Anorganische Chemie“ die Seite „Quantum-Zahlen · Übersicht“ zu den vier Quantenzahlen $(n, l, m_l, m_s)$ an.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					hasChange("page.create")(r),
			},
			{
				text: "Benenne die Seite in sauberes Deutsch um: „Quantenzahlen · Übersicht“.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("edit_page")(r) &&
					hasChangeWhere("page.rename", (c) => /quantenzahlen/i.test(String(c.to || "")))(r),
			},
		],
	},

	// =========================================================================
	// 3. Seiten bearbeiten & organisieren (edit_page, organize_pages, write_to_heft)
	// =========================================================================
	{
		id: "flat-edit-page-append-and-patch",
		mode: "app",
		turns: [
			{
				text: "Lies die Seite „1 · Einführung in Differentialgleichungen“ unter Differentialgleichungen und hänge am Ende einen kurzen Merkkasten (Callout `> [!blue] Merkhilfe`) zur Ordnung und Linearität einer DGL an, ohne bestehenden Text zu löschen.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					hasTool("edit_page")(r) &&
					(hasChange("page.append")(r) || hasChange("page.patch")(r)) &&
					!hasChange("page.replace")(r),
			},
			{
				text: "Ändere auf dieser Seite jetzt nicht den Text, sondern füge nur noch eine kurze Kontrollfrage am Ende der Merkhilfe per chirurgischem `edits`-Patch hinzu.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("edit_page")(r) &&
					hasChange("page.patch")(r) &&
					!hasChange("page.replace")(r),
			},
		],
	},
	{
		id: "flat-edit-page-create-then-rename-move",
		mode: "mcp",
		turns: [
			{
				text: "Erstelle eine neue Test-Notiz „Entwurf Magnetismus“ direkt unter „Festkörperphysik“ mit 3 Stichpunkten aus der Seite „Magnetismus“.",
				check: (r) => noToolErrors(r) && hasTool("read_pages")(r) && hasTool("create_pages")(r) && hasChange("page.create")(r),
			},
			{
				text: "Benenne „Entwurf Magnetismus“ in „Kurznotiz · Magnetismus“ um und verschiebe sie in den Ordner „📖 Vorlesungen“ unter „Festkörperphysik“.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("edit_page")(r) &&
					hasChange("page.rename")(r) &&
					hasChange("page.move")(r),
			},
		],
	},
	{
		id: "flat-edit-page-surgical-patch-multi",
		mode: "app",
		workspacePage: "Differentialgleichungen",
		turns: [
			{
				text: "Erstelle unter „Differentialgleichungen“ eine Testseite „Notiz · DGL-Testseite“ mit zwei Abschnitten: `## Ordnung` (Satz: „Die Ordnung ist die höchste Ableitung.“) und `## Beispiele` (Beispiel: `$y' + 2y = 0$`).",
				check: (r) =>
					noToolErrors(r) &&
					hasChangeWhere("page.create", (c) => /dgl-testseite/i.test(String(c.title || "")))(r),
			},
			{
				text: "Ersetze in „Notiz · DGL-Testseite“ gezielt per `edits` nur den Satz „Die Ordnung ist die höchste Ableitung.“ durch „Die Ordnung entspricht der höchsten vorkommenden Ableitung $y^{(n)}$.“ – ohne den Abschnitt `## Beispiele` anzufassen.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("edit_page")(r) &&
					hasChange("page.patch")(r) &&
					!hasChange("page.replace")(r),
			},
			{
				text: "Hänge per `append` noch den Abschnitt `## Randbedingungen` mit einem kurzen Beispielsatz an.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("edit_page")(r) &&
					hasChange("page.append")(r) &&
					!hasChange("page.replace")(r),
			},
		],
	},
	{
		id: "flat-edit-page-rename-and-move-same-call",
		mode: "mcp",
		turns: [
			{
				text: "Lege unter „Todo in der App“ eine kleine Entwurfsnotiz „Entwurf · BJT-Kleinsignal“ an und fasse darin 2 Kerngrößen aus „9 · BJT-Verstärker 1 – Emitter- & Basisschaltung“ zusammen.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					hasChange("page.create")(r),
			},
			{
				text: "Verschiebe „Entwurf · BJT-Kleinsignal“ in den Ordner „📖 Vorlesungen“ unter „Elektronik – Bauelemente und analoge Schaltungen“ und benenne sie dabei in „Kleinsignalmodell · BJT“ um.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("edit_page")(r) &&
					hasChange("page.move")(r) &&
					hasChange("page.rename")(r),
			},
		],
	},
	{
		id: "flat-edit-page-props-check",
		mode: "app",
		workspacePage: "Elektronik – Bauelemente und analoge Schaltungen",
		turns: [
			{
				text: "Lies „Elektronik – Bauelemente und analoge Schaltungen“ und „4 · Die pn-Diode“, um zu prüfen, welche Ordnerstruktur und eventuellen Tabellenspalten (`columns` / `props`) dort verwendet werden.",
				check: (r) => noToolErrors(r) && hasTool("read_pages")(r) && nonEmpty(30)(r),
			},
			{
				text: "Lege im selben Elternordner wie „4 · Die pn-Diode“ eine Kurznotiz „Spickzettel · Diode“ an (mit passenden `props`, falls der Elternordner Spalten hat), und korrigiere oder ergänze anschließend eine Angabe darauf mit `edit_page`.",
				check: (r) =>
					noToolErrors(r) &&
					hasChange("page.create")(r) &&
					hasTool("edit_page")(r) &&
					!hasChange("page.replace")(r),
			},
		],
	},
	{
		id: "flat-organize-archive-unarchive",
		mode: "mcp",
		turns: [
			{
				text: "Erstelle eine leere Notiz „Alte Checkliste“ unter „Todo in der App“ und archiviere sie direkt im nächsten Schritt.",
				check: (r) =>
					noToolErrors(r) &&
					hasChange("page.create")(r) &&
					hasTool("organize_pages")(r) &&
					hasChange("page.archive")(r),
			},
			{
				text: "Hole „Alte Checkliste“ wieder aus dem Archiv zurück.",
				check: (r) => noToolErrors(r) && hasTool("organize_pages")(r) && hasChange("page.unarchive")(r),
			},
		],
	},
	{
		id: "flat-organize-trash-confirmed",
		mode: "mcp",
		turns: [
			{
				text: "Lege unter „Todo in der App“ eine vorübergehende Notiz „Temp · Löschtest“ mit dem Inhalt „Nur zum Testen“ an.",
				check: (r) => noToolErrors(r) && hasChange("page.create")(r),
			},
			{
				text: "Wirf „Temp · Löschtest“ jetzt wieder in den Papierkorb (`organize_pages` mit `trash`).",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("organize_pages")(r) &&
					hasChange("page.trash")(r),
			},
		],
	},
	{
		id: "flat-organize-trash-cancelled",
		mode: "mcp",
		answers: ["Abbrechen"],
		turns: [
			{
				text: "Erstelle unter „Todo in der App“ eine Notiz „Wichtig · Nicht löschen“ mit dem Text „Wichtige Klausurhinweise“.",
				check: (r) => noToolErrors(r) && hasChange("page.create")(r),
			},
			{
				text: "Verschiebe „Wichtig · Nicht löschen“ in den Papierkorb.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("organize_pages")(r) &&
					!hasChange("page.trash")(r) &&
					matchText(/abgebrochen|nicht gelöscht|behalten|nicht in den papierkorb/i)(r),
			},
		],
	},
	{
		id: "flat-write-to-heft-existing-new",
		mode: "app",
		workspacePage: "Differentialgleichungen",
		turns: [
			{
				text: "Erstelle im Ordner „📝 Übungen“ unter „Differentialgleichungen“ ein neues Handschrift-Heft „Übungsheft · Laplace“.",
				check: (r) =>
					noToolErrors(r) &&
					hasChangeWhere("page.create", (c) => c.heft === true)(r),
			},
			{
				text: "Schreibe auf Seite 1 eine Aufgabe zur Rücktransformation von $F(s) = \\frac{1}{s(s+2)}$ und auf Seite 2 den Hinweis zur Partialbruchzerlegung.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("write_to_heft")(r) &&
					hasChange("heft.append")(r),
			},
		],
	},
	{
		id: "flat-edit-page-course-correction",
		mode: "app",
		workspacePage: "Kontinuumsmechanik",
		turns: [
			{
				text: "Lies „1 · Einführung & Motivation“ und erstelle unter „Kontinuumsmechanik“ eine Notiz „Notiz · Statik“ mit drei nummerierten Stichpunkten.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					hasChange("page.create")(r),
			},
			{
				text: "Korrektur: Entferne in „Notiz · Statik“ den dritten Punkt wieder und füge per `edits` oder `append` stattdessen die drei 2D-Gleichgewichtsbedingungen $\\sum F_x = 0$, $\\sum F_y = 0$, $\\sum M = 0$ ein.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("edit_page")(r) &&
					(hasChange("page.patch")(r) || hasChange("page.append")(r)) &&
					!hasChange("page.replace")(r),
			},
			{
				text: "Benenne die Seite abschließend in „Grundlagen · Statik 2D“ um.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("edit_page")(r) &&
					hasChangeWhere("page.rename", (c) => /statik 2d/i.test(String(c.to || "")))(r),
			},
		],
	},

	// =========================================================================
	// 4. Karteikarten & Stapel (list_decks, list_cards, create_cards, edit_cards, edit_deck)
	// =========================================================================
	{
		id: "flat-cards-list-and-create",
		mode: "app",
		turns: [
			{
				text: "Welche Karteikarten-Stapel gibt es aktuell und wie viele Karten liegen jeweils darin?",
				check: (r) => noToolErrors(r) && hasTool("list_decks")(r) && matchText(/eidp|mathe/i)(r),
			},
			{
				text: "Erstelle basierend auf der Seite „4 · Die pn-Diode“ genau 4 präzise Karteikarten im Unterstapel „Elektronik::Bauelemente::pn-Diode“. Jede Karte ein Fakt, Formeln als LaTeX.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					hasTool("create_cards")(r) &&
					countCreatedCards(r) === 4 &&
					r.changes
						.filter((c) => c.op === "card.create")
						.every((c) => /elektronik::bauelemente::pn-diode/i.test(String(c.deck || ""))),
			},
		],
	},
	{
		id: "flat-cards-edit-and-deck",
		mode: "mcp",
		turns: [
			{
				text: "Lege einen neuen Kartenstapel „FüPhysik::Übung“ an und erstelle darin 2 Karten zur Bragg-Gleichung und zu Miller-Indizes.",
				check: (r) => noToolErrors(r) && hasTool("create_cards")(r) && hasChange("card.create")(r),
			},
			{
				text: "Benenne den Stapel „FüPhysik::Übung“ in „FKP::Grundlagen“ um und suche darin per list_cards nach „Bragg“.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("edit_deck")(r) &&
					hasChange("deck.rename")(r) &&
					hasTool("list_cards")(r),
			},
		],
	},
	{
		id: "flat-cards-suspend-update",
		mode: "mcp",
		turns: [
			{
				text: "Schau dir mit list_cards die Karten im Stapel „DGL::Übungsblatt 2::Mathe“ (Limit 5) an und nenne mir die erste Frage.",
				check: (r) => noToolErrors(r) && hasTool("list_cards")(r) && nonEmpty(30)(r),
			},
			{
				text: "Pausiere (suspend) genau diese erste Karte per edit_cards.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("edit_cards")(r) &&
					hasChangeWhere("card.suspend", (c) => c.suspended === true)(r),
			},
		],
	},
	{
		id: "flat-cards-suspend-then-unsuspend",
		mode: "mcp",
		turns: [
			{
				text: "Zeige mir bis zu 5 Karten aus dem Stapel „DGL::KaTeX & Mathe-Syntax“ und gib mir die Vorderseite der ersten Karte an.",
				check: (r) => noToolErrors(r) && hasTool("list_cards")(r) && nonEmpty(25)(r),
			},
			{
				text: "Pausiere (`suspend`) genau diese erste Karte mit `edit_cards`.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("edit_cards")(r) &&
					hasChangeWhere("card.suspend", (c) => c.suspended === true)(r),
			},
			{
				text: "Hebe die Pause (`unsuspend`) für dieselbe Karte wieder auf.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("edit_cards")(r) &&
					hasChangeWhere("card.suspend", (c) => c.suspended === false)(r),
			},
		],
	},
	{
		id: "flat-cards-update-and-move",
		mode: "app",
		turns: [
			{
				text: "Erstelle im Stapel „Probe::Elektrotechnik“ 2 Karteikarten zum Ohmschen Gesetz und zur Kirchhoffschen Knotenregel.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("create_cards")(r) &&
					countCreatedCards(r) === 2,
			},
			{
				text: "Verbessere die Rückseite der Karte zum Ohmschen Gesetz per `edit_cards` (`update`), sodass sie auch die Leistungsgleichung $P = U \\cdot I = I^2 R$ nennt.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("edit_cards")(r) &&
					hasChange("card.update")(r),
			},
			{
				text: "Verschiebe diese aktualisierte Karte per `edit_cards` (`move`) in einen neuen Stapel „Probe::ET-Formeln“.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("edit_cards")(r) &&
					hasChangeWhere("card.move", (c) => /et-formeln/i.test(String(c.to || "")))(r),
			},
		],
	},
	{
		id: "flat-cards-reset-progress",
		mode: "mcp",
		turns: [
			{
				text: "Lies mit `list_cards` die Karten im Stapel „Electronics::Praktikum 1“ (Limit 6) aus und nenne mir die erste Frage.",
				check: (r) => noToolErrors(r) && hasTool("list_cards")(r) && nonEmpty(25)(r),
			},
			{
				text: "Setze den Lernfortschritt genau dieser ersten Karte per `edit_cards` (`reset`) zurück.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("edit_cards")(r) &&
					hasChange("card.reset")(r),
			},
		],
	},
	{
		id: "flat-cards-trash-confirmed",
		mode: "mcp",
		turns: [
			{
				text: "Erstelle im Teststapel „Teststapel::Wegwerfen“ zwei kurze Karteikarten (z. B. zur Einheitsmatrix und zur Determinante).",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("create_cards")(r) &&
					countCreatedCards(r) === 2,
			},
			{
				text: "Lösche gezielt die Karte zur Determinante per `edit_cards` (`trash`), die andere soll bleiben.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("edit_cards")(r) &&
					hasChange("card.trash")(r),
			},
		],
	},
	{
		id: "flat-deck-create-rename-move-trash",
		mode: "mcp",
		turns: [
			{
				text: "Erstelle mit `edit_deck` zwei leere Stapel: „TempDeck::Alt“ und „TempDeck::Ziel“.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("edit_deck")(r) &&
					r.changes.filter((c) => c.op === "deck.create").length >= 2,
			},
			{
				text: "Benenne „TempDeck::Alt“ in „TempDeck::Umbenannt“ um und verschiebe ihn danach unter den Elternstapel „TempDeck::Ziel“.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("edit_deck")(r) &&
					hasChange("deck.rename")(r) &&
					hasChange("deck.move")(r),
			},
			{
				text: "Lösche den Stapel „TempDeck::Ziel“ (samt Unterstapel) per `edit_deck` (`trash`).",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("edit_deck")(r) &&
					hasChange("deck.trash")(r),
			},
		],
	},
	{
		id: "flat-cards-from-page-chemie",
		mode: "app",
		workspacePage: "3 · Trends im PSE",
		turns: [
			{
				text: "Erstelle basierend auf „3 · Trends im PSE“ genau 4 präzise Karteikarten im Stapel „Chemie::PSE“ (jeweils 1 Fakt pro Karte, mit LaTeX wo passend).",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("create_cards")(r) &&
					countCreatedCards(r) === 4 &&
					hasChangeWhere("card.create", (c) => /chemie::pse/i.test(String(c.deck || "")))(r),
			},
			{
				text: "Ergänze bei einer dieser Karten per `edit_cards` (`update`) auf der Rückseite ein kurzes Elementbeispiel (z. B. Fluor oder Caesium).",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("edit_cards")(r) &&
					hasChange("card.update")(r),
			},
		],
	},
	{
		id: "flat-cards-from-page-eidp-inspect",
		mode: "mcp",
		turns: [
			{
				text: "Liste alle Karteikarten-Stapel auf und schau dir dann die Karten in „DGL::Übungsblatt 2::Programmieren“ an.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("list_decks")(r) &&
					hasTool("list_cards")(r) &&
					nonEmpty(40)(r),
			},
			{
				text: "Erstelle in „DGL::Übungsblatt 2::Programmieren“ 2 ergänzende Karteikarten zur Stabilität von Euler vs. RK4 bei expliziten Zeitschrittverfahren.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("create_cards")(r) &&
					countCreatedCards(r) === 2 &&
					hasChangeWhere("card.create", (c) => /programmieren/i.test(String(c.deck || "")))(r),
			},
		],
	},
	{
		id: "flat-cards-query-across-decks",
		mode: "app",
		turns: [
			{
				text: "Suche über `list_cards` mit `query` nach Karten, die „Mathe“ oder „Integral“ bzw. „Ableitung“ enthalten (z. B. im Stapel „Mathe 2::Spickzettel (Komplett)“, Limit 10), und fasse 3 Fundstellen kurz zusammen.",
				check: (r) => noToolErrors(r) && hasTool("list_cards")(r) && nonEmpty(40)(r),
			},
			{
				text: "Lege im neuen Stapel „Mathe 2::Eigene Ergänzung“ eine zusätzliche Karteikarte zur partiellen Integration $\\int u v'\\,dx$ an.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("create_cards")(r) &&
					countCreatedCards(r) >= 1 &&
					hasChange("card.create")(r),
			},
		],
	},
	{
		id: "flat-cards-due-review-coach",
		mode: "app",
		turns: [
			{
				text: "Prüfe meine Stapel (`list_decks`) und welche Karten heute fällig sind (`list_cards` mit `due: true`).",
				check: (r) => noToolErrors(r) && hasTool("list_decks")(r) && hasTool("list_cards")(r),
			},
			{
				text: "Gib mir auf Basis dieser Zahlen einen realistischen 20-Minuten-Lernplan für heute.",
				check: (r) => noToolErrors(r) && nonEmpty(80)(r),
			},
		],
	},
	{
		id: "flat-cards-trash-cancelled",
		mode: "mcp",
		answers: ["Abbrechen"],
		turns: [
			{
				text: "Erstelle 1 Karteikarte im Stapel „Sicherheit::Keep“ zur Fourierreihe.",
				check: (r) => noToolErrors(r) && hasChange("card.create")(r),
			},
			{
				text: "Lösche den ganzen Stapel „Sicherheit::Keep“ per `edit_deck` (`trash`).",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("edit_deck")(r) &&
					!hasChange("deck.trash")(r) &&
					matchText(/abgebrochen|nicht gelöscht|behalten/i)(r),
			},
		],
	},
	{
		id: "flat-cards-batch-from-bjt",
		mode: "app",
		workspacePage: "6 · Der Bipolartransistor",
		turns: [
			{
				text: "Erstelle genau 5 knappe, atomare Karteikarten (1 Fakt pro Karte, Formeln als LaTeX) im Stapel „Elektronik::BJT“ basierend auf „6 · Der Bipolartransistor“.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("create_cards")(r) &&
					countCreatedCards(r) === 5 &&
					hasChangeWhere("card.create", (c) => /elektronik::bjt/i.test(String(c.deck || "")))(r),
			},
		],
	},

	// =========================================================================
	// 5. Rechnen (calculate)
	// =========================================================================
	{
		id: "flat-calc-physics-math",
		mode: "app",
		turns: [
			{
				text: "Berechne mit dem calculate-Werkzeug die Eigenfrequenz f0 eines Feder-Masse-Systems mit m = 0.25 kg und k = 160 N/m sowie das bestimmte Integral von x^2 * exp(-x) von 0 bis 3. Gib die gerundeten Werte an.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("calculate")(r) &&
					matchText(/4(?:[,.]|\{,\})0[23]|25(?:[,.]|\{,\})2|f_?0/i)(r) &&
					matchText(/1(?:[,.]|\{,\})15/)(r),
			},
		],
	},
	{
		id: "flat-calc-circuit",
		mode: "mcp",
		turns: [
			{
				text: "Berechne exakt mit calculate für einen Spannungsteiler mit R1 = 47000 Ohm, R2 = 15000 Ohm und Uin = 12 V die Leerlaufspannung U2 und den Innenwiderstand Rth.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("calculate")(r) &&
					matchText(/2(?:[,.]|\{,\})90/)(r) &&
					matchText(/1137\d|11(?:[,.]|\{,\})37\s*k/i)(r),
			},
		],
	},
	{
		id: "flat-calc-damped-oscillator",
		mode: "app",
		workspacePage: "3 · Der gedämpfte harmonische Oszillator",
		turns: [
			{
				text: "Berechne mit `calculate` für einen gedämpften harmonischen Oszillator mit $m = 0.5\\,\\text{kg}$, $k = 50\\,\\text{N/m}$ und $c = 2\\,\\text{Ns/m}$ die ungedämpfte Kreisfrequenz $\\omega_0$, das Lehrsche Dämpfungsmaß $\\zeta$ und die gedämpfte Kreisfrequenz $\\omega_d$.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("calculate")(r) &&
					matchText(/\b10\b/)(r) &&
					matchText(/0(?:[,.]|\{,\})2/)(r) &&
					matchText(/9(?:[,.]|\{,\})79|9(?:[,.]|\{,\})80/)(r),
			},
			{
				text: "Lege aus diesem Zahlenbeispiel eine kurze Notiz „Rechenbeispiel · Gedämpfter Oszillator“ unter „Differentialgleichungen/📝 Übungen“ an.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("create_pages")(r) &&
					hasChange("page.create")(r),
			},
		],
	},
	{
		id: "flat-calc-integrate-rms",
		mode: "mcp",
		turns: [
			{
				text: "Berechne mit `calculate` (per `integrate`) einmal den Effektivwert $U_{\\mathrm{eff}} = \\sqrt{\\frac{1}{2} \\int_0^2 (5 \\sin(\\pi t))^2\\,dt}$ und zusätzlich das Integral $\\int_0^2 t e^{-t/2}\\,dt$.",
				check: (r) =>
					noToolErrors(r) &&
					hasToolWhere("calculate", (a) => /integrate/i.test(String(a.expression || "")))(r) &&
					matchText(/3(?:[,.]|\{,\})53|3(?:[,.]|\{,\})54/)(r) &&
					matchText(/1(?:[,.]|\{,\})05|1(?:[,.]|\{,\})06/)(r),
			},
		],
	},
	{
		id: "flat-calc-mosfet-operating-point",
		mode: "app",
		workspacePage: "12 · Der MOSFET",
		turns: [
			{
				text: "Rechne mit `calculate` für einen n-MOSFET in Sättigung ($k_n = 0.002\\,\\mathrm{A/V^2}$, $U_{GS} = 3.5\\,\\mathrm{V}$, $U_{th} = 1.2\\,\\mathrm{V}$) den Drainstrom $I_D = \\frac{1}{2} k_n (U_{GS}-U_{th})^2$ und die Steilheit $g_m = k_n (U_{GS}-U_{th})$ aus.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("calculate")(r) &&
					matchText(/5(?:[,.]|\{,\})29|0(?:[,.]|\{,\})00529/)(r) &&
					matchText(/4(?:[,.]|\{,\})6|0(?:[,.]|\{,\})0046/)(r),
			},
			{
				text: "Speichere dieses Rechenbeispiel als 1 Karteikarte im Stapel „Elektronik::MOSFET“ ab.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("create_cards")(r) &&
					countCreatedCards(r) === 1,
			},
		],
	},
	{
		id: "flat-calc-bragg-angle",
		mode: "app",
		workspacePage: "Strukturaufklärung – Bragg, reziprokes Gitter & Beugungsmethoden",
		turns: [
			{
				text: "Berechne mit `calculate` den Beugungswinkel $\\theta$ (in Grad) erster Ordnung ($n=1$) für Cu-$K_\\alpha$-Strahlung ($\\lambda = 0.15418\\,\\mathrm{nm}$) an Netzebenen mit Abstand $d = 0.204\\,\\mathrm{nm}$.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("calculate")(r) &&
					matchText(/22(?:[,.]|\{,\})2/)(r),
			},
		],
	},
	{
		id: "flat-calc-chemie-ph-and-molar",
		mode: "mcp",
		turns: [
			{
				text: "Berechne mit `calculate` den pH-Wert einer $0.015\\,\\mathrm{M}$ starken einprotonigen Säure und die Masse von $0.25\\,\\mathrm{mol}$ $\\mathrm{H_2SO_4}$ ($M = 98.08\\,\\mathrm{g/mol}$).",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("calculate")(r) &&
					matchText(/1(?:[,.]|\{,\})82/)(r) &&
					matchText(/24(?:[,.]|\{,\})52/)(r),
			},
		],
	},

	// =========================================================================
	// 6. Arbeitsblätter (create_worksheet: alle 8 Bausteine, Farben, bestehendes Heft)
	// =========================================================================
	{
		id: "flat-create-worksheet",
		mode: "app",
		workspacePage: "Differentialgleichungen",
		turns: [
			{
				text: "Erstelle mir mit create_worksheet ein kurzes 15-Minuten-Arbeitsblatt „Kurzcheck · Harmonischer Oszillator“ im Ordner „📝 Übungen“ unter Differentialgleichungen. Nutze einen `merksatz`, eine `rechenbox`, einen `lueckentext` und einen `kurzcheck`, mit Lösungsblatt.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("create_worksheet")(r) &&
					matchText(/arbeitsblatt|harmonisch|oszillator/i)(r),
			},
		],
	},
	{
		id: "flat-worksheet-elektronik-zuordnung-fehlersuche",
		mode: "mcp",
		turns: [
			{
				text: "Lies „5 · Diodenschaltungen – Lastgerade, Z-Diode, Gleichrichter“ und erstelle im Ordner „Elektronik – Bauelemente und analoge Schaltungen/🧪 Praktikum“ ein DIN-A4-Arbeitsblatt „Übungsblatt · Diodenschaltungen“ (Akzent `teal`, mit Lösungsblatt). Verwende die Bausteine `merksatz`, `zuordnung`, `fehlersuche` und `rechenbox`.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					hasToolWhere("create_worksheet", (a) => Array.isArray(a.blocks) && a.blocks.length >= 4 && a.include_solutions === true)(r),
			},
			{
				text: "Nenne mir kurz die enthaltenen Aufgabenblöcke des neuen Arbeitsblatts.",
				check: (r) => noToolErrors(r) && nonEmpty(40)(r),
			},
		],
	},
	{
		id: "flat-worksheet-fkp-matrix-twocol",
		mode: "app",
		workspacePage: "Festkörperphysik",
		turns: [
			{
				text: "Lies „Bindungsverhältnisse“ und erzeuge unter „Festkörperphysik“ ein Arbeitsblatt „Vergleichsblatt · Bindungen im Festkörper“ (Akzent `purple`, ohne Lösungsblatt) mit `two_col`, `matrix`, `lueckentext` und `kurzcheck`.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					hasToolWhere("create_worksheet", (a) => Array.isArray(a.blocks) && a.blocks.length >= 4)(r),
			},
		],
	},
	{
		id: "flat-worksheet-mechanik-existing-heft",
		mode: "mcp",
		turns: [
			{
				text: "Erstelle ein leeres Handschrift-Heft „Arbeitsheft · Statik“ direkt unter „Kontinuumsmechanik“.",
				check: (r) =>
					noToolErrors(r) &&
					hasChangeWhere("page.create", (c) => c.heft === true && /arbeitsheft/i.test(String(c.title || "")))(r),
			},
			{
				text: "Füge jetzt in genau dieses bestehende Heft „Arbeitsheft · Statik“ (`heft`-Parameter von `create_worksheet`) ein Arbeitsblatt basierend auf „4 · Lager, Lagerreaktionen & Statische Bestimmtheit“ mit `merksatz`, `rechenbox` und `kurzcheck` ein.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					hasToolWhere("create_worksheet", (a) => /arbeitsheft/i.test(String(a.heft || "")))(r),
			},
		],
	},
	{
		id: "flat-worksheet-chemie-atombau",
		mode: "app",
		workspacePage: "Allgemeine und Anorganische Chemie",
		turns: [
			{
				text: "Lies „2 · Atombau II“ sowie „3 · Trends im PSE“ und erstelle unter „Allgemeine und Anorganische Chemie“ ein 20-Minuten-Arbeitsblatt „Kurztraining · Atombau & PSE“ (Akzent `amber`, `include_solutions: true`) mit `merksatz`, `zuordnung`, `matrix` und `lueckentext`.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					hasToolWhere("create_worksheet", (a) => a.accent === "amber" && Array.isArray(a.blocks) && a.blocks.length >= 4)(r),
			},
		],
	},
	{
		id: "flat-worksheet-eidp-fehlersuche",
		mode: "mcp",
		turns: [
			{
				text: "Schau dir mit `list_cards` die Stapel „DGL::Übungsblatt 2::Mathe“ und „DGL::Übungsblatt 2::Programmieren“ an (jeweils Limit 5).",
				check: (r) => noToolErrors(r) && hasTool("list_cards")(r) && nonEmpty(30)(r),
			},
			{
				text: "Erstelle daraus unter „Differentialgleichungen/📝 Übungen“ ein Arbeitsblatt „Klausurtraining · DGL Mathe & Numerik“ (Akzent `rose`, mit Lösungsblatt) mit `fehlersuche`, `two_col`, `rechenbox` und `kurzcheck`.",
				check: (r) =>
					noToolErrors(r) &&
					hasToolWhere("create_worksheet", (a) => Array.isArray(a.blocks) && a.blocks.length >= 4)(r),
			},
		],
	},
	{
		id: "flat-worksheet-dgl-numerik",
		mode: "app",
		workspacePage: "11 · Numerik: Euler-Integration",
		turns: [
			{
				text: "Erstelle im Ordner „Differentialgleichungen/📝 Übungen“ ein 25-Minuten-Arbeitsblatt „Numerik-Check · Euler vs RK4“ (Akzent `blue`, mit Lösungsblatt) anhand von „11 · Numerik: Euler-Integration“ und „12 · Runge-Kutta-Verfahren“ mit `merksatz`, `two_col`, `rechenbox` und `matrix`.",
				check: (r) =>
					noToolErrors(r) &&
					hasToolWhere("create_worksheet", (a) => a.include_solutions === true && Array.isArray(a.blocks) && a.blocks.length >= 4)(r),
			},
		],
	},

	// =========================================================================
	// 7. Rückfragen & Mehrdeutigkeit (ask_choice)
	// =========================================================================
	{
		id: "flat-ask-choice-ambiguous-folder",
		mode: "mcp",
		answers: ["Differentialgleichungen"],
		turns: [
			{
				text: "Ich will eine neue Notiz „Formelsammlung kurz“ in einem meiner Ordner „📖 Vorlesungen“ speichern. Frag mich zuerst per ask_choice, welches Fach ich meine, und erstelle die Seite erst nach meiner Auswahl.",
				check: (r) => noToolErrors(r) && hasTool("ask_choice")(r) && hasChange("page.create")(r),
			},
		],
	},
	{
		id: "flat-ask-choice-ambiguous-uebungen",
		mode: "mcp",
		answers: ["Festkörperphysik"],
		turns: [
			{
				text: "Lege ein neues Handschrift-Heft „Kurztest · Kristallgitter“ in einem meiner Ordner „📝 Übungen“ an. Da es mehrere „📝 Übungen“-Ordner gibt, kläre per `ask_choice` zuerst das Fach und lege das Heft erst danach dort an.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("ask_choice")(r) &&
					hasChangeWhere("page.create", (c) => c.heft === true)(r),
			},
			{
				text: "Schreibe auf Seite 1 dieses neuen Hefts eine kurze Einstiegsfrage zu Bravais-Gittern und Millerschen Indizes.",
				check: (r) => noToolErrors(r) && hasTool("write_to_heft")(r) && hasChange("heft.append")(r),
			},
		],
	},
	{
		id: "flat-ask-choice-before-trash",
		mode: "app",
		workspacePage: "Todo in der App",
		answers: ["Archiv"],
		turns: [
			{
				text: "Erstelle unter „Todo in der App“ eine Notiz „Alter Plan · 2025“ mit dem Text „Semesterplan Alt“.",
				check: (r) => noToolErrors(r) && hasChange("page.create")(r),
			},
			{
				text: "Räume „Alter Plan · 2025“ auf, aber frag mich vorher per `ask_choice`, ob ich sie lieber archivieren oder in den Papierkorb werfen möchte, und führe dann meine Wahl aus.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("ask_choice")(r) &&
					(hasChange("page.archive")(r) || hasChange("page.trash")(r)),
			},
		],
	},
	{
		id: "flat-ask-choice-format-note-vs-cards",
		mode: "app",
		workspacePage: "9 · Fourier-Methoden",
		answers: ["Karteikarten"],
		turns: [
			{
				text: "Ich möchte den Stoff von „9 · Fourier-Methoden“ lernen – bin aber unsicher, ob als Notiz „Fourier · Merkblatt“ unter „Differentialgleichungen“ oder als 3 Karteikarten in „DGL::Fourier“. Frag mich per `ask_choice` und lege dann direkt das Gewählte an.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("ask_choice")(r) &&
					(hasChange("card.create")(r) || hasChange("page.create")(r)),
			},
		],
	},
	{
		id: "flat-ask-choice-heft-vs-worksheet",
		mode: "mcp",
		answers: ["Arbeitsblatt"],
		turns: [
			{
				text: "Bereite mir zu „Lab 4 · Operationsverstärker“ Übungsmaterial vor – entweder als leeres Handschrift-Heft oder als fertiges `create_worksheet`-Arbeitsblatt unter „Elektronik – Bauelemente und analoge Schaltungen“. Frag mich vorher per `ask_choice` und erstelle es dann.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("ask_choice")(r) &&
					(hasTool("create_worksheet")(r) || hasChange("page.create")(r)),
			},
		],
	},
	{
		id: "flat-ask-choice-which-deck",
		mode: "mcp",
		answers: ["Mathe 2"],
		turns: [
			{
				text: "Schau nach, welche „Mathe 2“-Stapel existieren, frag mich dann per `ask_choice`, in welchen davon ich eine neue Karte zur mehrdimensionalen Kettenregel legen möchte, und erstelle die Karte danach.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("list_decks")(r) &&
					hasTool("ask_choice")(r) &&
					hasChange("card.create")(r),
			},
		],
	},

	// =========================================================================
	// 8. Negativfälle, Ehrlichkeit & Disziplin (keine Halluzinationen / kein Replace / noTools)
	// =========================================================================
	{
		id: "flat-missing-page-honesty",
		mode: "mcp",
		turns: [
			{
				text: "Schau bitte in meiner Seite „Quantenchromodynamik Vorlesung 9“ nach, welche Hausaufgabe dort steht. Wenn es die Seite nicht gibt, erfinde nichts, sondern sag es ehrlich.",
				check: (r) =>
					(calledTool("search")(r) || calledTool("list_pages")(r) || calledTool("read_pages")(r)) &&
					matchText(/nicht|keine|existiert nicht|nicht gefunden/i)(r) &&
					!hasChange("page.create")(r),
			},
		],
	},
	{
		id: "flat-missing-deck-and-card-honesty",
		mode: "mcp",
		turns: [
			{
				text: "Prüfe, ob ich einen Karteikarten-Stapel „Astrophysik::Schwarze Löcher“ habe und wie viele Karten darin liegen. Lege nichts Neues an, falls er fehlt.",
				check: (r) =>
					(calledTool("list_decks")(r) || calledTool("list_cards")(r)) &&
					!hasChange("deck.create")(r) &&
					!hasChange("card.create")(r) &&
					matchText(/nicht|kein|existiert nicht|nicht gefunden/i)(r),
			},
		],
	},
	{
		id: "flat-missing-fact-on-real-page",
		mode: "app",
		workspacePage: "Lab 2 · Bipolartransistoren",
		turns: [
			{
				text: "Steht in „Lab 2 · Bipolartransistoren“ die genaue Seriennummer eines Tektronix-Oszilloskops vom 14.03.1997? Prüfe die Seite und antworte strikt ehrlich.",
				check: (r) =>
					noToolErrors(r) &&
					!hasChange("page.patch")(r) &&
					!hasChange("page.append")(r) &&
					matchText(/nicht|keine|kein|weder|fehlt|steht nicht|wird nicht/i)(r),
			},
		],
	},
	{
		id: "flat-no-tool-knowledge-latex",
		mode: "app",
		turns: [
			{
				text: "Erkläre mir kurz ohne in meinen Notizen zu suchen den Unterschied zwischen einer linearen und einer nichtlinearen Differentialgleichung an zwei kurzen Beispielen in LaTeX.",
				check: (r) => noTools(r) && matchText(/\$/)(r) && matchText(/superposition|linear/i)(r) && nonEmpty(100)(r),
			},
		],
	},
	{
		id: "flat-no-tool-knowledge-chemie",
		mode: "mcp",
		turns: [
			{
				text: "Erkläre mir ohne in meinen Notizen nachzusehen das Pauli-Prinzip und die Hundsche Regel anhand der Elektronenkonfiguration von Stickstoff in LaTeX.",
				check: (r) =>
					noTools(r) &&
					matchText(/pauli|hund/i)(r) &&
					matchText(/1s|2s|2p/i)(r) &&
					nonEmpty(90)(r),
			},
		],
	},
	{
		id: "flat-no-tool-knowledge-et",
		mode: "app",
		turns: [
			{
				text: "Ohne Werkzeuge und ohne Notizsuche: Erkläre mir kurz den Unterschied zwischen Gegenkopplung und Mitkopplung beim Operationsverstärker und gib die Verstärkungsformel des invertierenden Verstärkers in LaTeX an.",
				check: (r) =>
					noTools(r) &&
					matchText(/\$/)(r) &&
					matchText(/gegenkopplung|mitkopplung/i)(r) &&
					nonEmpty(90)(r),
			},
		],
	},
	{
		id: "flat-no-tool-knowledge-python",
		mode: "mcp",
		turns: [
			{
				text: "Erkläre ohne Notiz- oder Kartensuche kompakt an einem kleinen Python-Codebeispiel, was Endrekursion von normaler Rekursion unterscheidet.",
				check: (r) =>
					noTools(r) &&
					matchText(/endrekursion|tail|akkumulator|def /i)(r) &&
					nonEmpty(90)(r),
			},
		],
	},
	{
		id: "flat-discipline-no-replace-on-patch",
		mode: "app",
		workspacePage: "Elektronik – Bauelemente und analoge Schaltungen",
		turns: [
			{
				text: "Erstelle unter „Elektronik – Bauelemente und analoge Schaltungen“ eine Seite „Schaltungsnotiz · Filter“ mit 4 Abschnitten (`## Tiefpass`, `## Hochpass`, `## Bandpass`, `## Grenzfrequenz`) und jeweils einem kurzen Satz plus Platzhalterformel `$f_g = ?$` beim Tiefpass.",
				check: (r) =>
					noToolErrors(r) &&
					hasChangeWhere("page.create", (c) => /filter/i.test(String(c.title || "")))(r),
			},
			{
				text: "Ersetze auf „Schaltungsnotiz · Filter“ nur den Platzhalter `$f_g = ?$` durch `$f_g = \\frac{1}{2\\pi R C}$`, ohne die übrigen Abschnitte neu zu schreiben (`edits` statt `content`).",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("edit_page")(r) &&
					hasChange("page.patch")(r) &&
					!hasChange("page.replace")(r),
			},
		],
	},
	{
		id: "flat-discipline-existing-page-no-recreate",
		mode: "mcp",
		turns: [
			{
				text: "Prüfe, ob die Seite „0 · Organisatorisches“ unter „Allgemeine und Anorganische Chemie“ bereits existiert, und lies ihren Inhalt.",
				check: (r) =>
					noToolErrors(r) &&
					(hasTool("read_pages")(r) || hasTool("list_pages")(r)) &&
					!hasChange("page.create")(r),
			},
			{
				text: "Hänge an diese bestehende Seite „0 · Organisatorisches“ ganz unten die kurze Erinnerung `## Laborhinweis\\n- Kittel und Schutzbrille mitbringen.` an – lege auf keinen Fall eine doppelte Seite an und überschreibe nichts.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("edit_page")(r) &&
					(hasChange("page.append")(r) || hasChange("page.patch")(r)) &&
					!hasChange("page.create")(r) &&
					!hasChange("page.replace")(r),
			},
		],
	},
	{
		id: "flat-discipline-heft-needs-write-to-heft",
		mode: "mcp",
		turns: [
			{
				text: "Erstelle unter „Elektronik – Bauelemente und analoge Schaltungen“ ein neues Handschrift-Heft „Skizzenheft · Kirchhoff“.",
				check: (r) =>
					noToolErrors(r) &&
					hasChangeWhere("page.create", (c) => c.heft === true)(r),
			},
			{
				text: "Schreibe die sichtbare Merkbox „Maschenregel: Summe aller Spannungen im geschlossenen Umlauf ist 0.“ auf Seite 1 dieses Hefts.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("write_to_heft")(r) &&
					hasChange("heft.append")(r) &&
					!hasChange("page.patch")(r) &&
					!hasChange("page.replace")(r),
			},
		],
	},
	{
		id: "flat-discipline-read-before-edit",
		mode: "mcp",
		turns: [
			{
				text: "Lies „1 · Einführung & Motivation“ unter Kontinuumsmechanik zuerst vollständig nach.",
				check: (r) => noToolErrors(r) && hasTool("read_pages")(r) && nonEmpty(40)(r),
			},
			{
				text: "Hänge am Ende von „1 · Einführung & Motivation“ einen zweizeiligen Callout `> [!teal] Fazit` an, ohne bestehenden Inhalt zu ersetzen.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("edit_page")(r) &&
					(hasChange("page.append")(r) || hasChange("page.patch")(r)) &&
					!hasChange("page.replace")(r),
			},
		],
	},
	{
		id: "flat-multi-turn-cross-tool-workflow",
		mode: "app",
		workspacePage: "Differentialgleichungen",
		turns: [
			{
				text: "Lies „10 · Laplace-Transformation“ nach und erkläre die Ableitungsregel $\\mathcal{L}\\{f'(t)\\}$ in zwei Sätzen.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("read_pages")(r) &&
					matchText(/laplace|s\s*F\(s\)|f\(0\)/i)(r),
			},
			{
				text: "Berechne mit `calculate` den Wert von $F(s) = \\frac{1}{s^2 + 4}$ bei $s = 3$ sowie das Integral $\\int_0^4 e^{-2t}\\,dt$.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("calculate")(r) &&
					matchText(/0(?:[,.]|\{,\})0769|1\/13/)(r) &&
					matchText(/0(?:[,.]|\{,\})499|0(?:[,.]|\{,\})50/)(r),
			},
			{
				text: "Erstelle 3 prägnante Karteikarten zur Laplace-Transformation im Stapel „DGL::Laplace“.",
				check: (r) =>
					noToolErrors(r) &&
					hasTool("create_cards")(r) &&
					countCreatedCards(r) === 3 &&
					hasChangeWhere("card.create", (c) => /laplace/i.test(String(c.deck || "")))(r),
			},
		],
	},
];

export const TASKS = [...V3_TASKS, ...V4_TASKS];
