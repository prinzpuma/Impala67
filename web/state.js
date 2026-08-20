"use strict";
import { U } from "./util.js";
import { DB } from "./db.js";
import { SRS } from "./srs.js";
import { SETTINGS_SYNC } from "./settings-sync.js";
// state.js — In-Memory-Zustand, aufgebaut durch Abspielen des Event-Logs.
// Jede Änderung ist ein Event: reduce() wendet es an, dispatch() persistiert es.
export const S = {
	pages: {},   // id → { id, title, parentId, content, pdfId, tags, icon, cover, notionId, created, updated }
	cards: {},   // id → { id, front, back, pageId, srs, created }
	grades: {},  // id → { id, subject, grade, weight, date, comment, created }
	learningSessions: {}, // id → { id, startedAt, endedAt, durationSeconds, category, subject, subjectSource, sourceId, updated, deleted? }
	chatSessions: {}, // id → { id, title, messages, created, updated, deleted? } — Drive-synchronisiert
	settings: {
		aiProviders: [
			{ id: "cloudflare", name: "Cloudflare (Groq)", base: "https://impala67-sync.joshuagayer1.workers.dev", key: "" },
			{ id: "google", name: "Google Gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai", key: "" },
			{ id: "openai", name: "OpenAI", base: "https://api.openai.com/v1", key: "" },
			{ id: "local", name: "Lokal (LM Studio)", base: "http://localhost:1234/v1", key: "" },
		],
		aiProviderId: "local",
		aiModel: "",
		// Thinking ist standardmäßig aktiv. Die UI bietet bewusst nur Ein/Aus;
		// Provider wählen ihre dokumentierte Standardtiefe selbst.
		thinkingEnabled: true,
		thinkingLevel: "auto", // Altwert für bestehende Exporte; wird nicht mehr in der UI gesteuert
		embedModel: "",
		// Quelle für /embeddings — unabhängig von der im Chat aktiven Quelle wählbar (⚙️ → KI).
		// "" = automatisch (aktive Chat-Quelle als Fallback, siehe ai.js embedProvider()).
		embedProviderId: "",
		driveClientId: "100283147644-1ra4er2dc5r85k3mefd521hbm1ek3qpf.apps.googleusercontent.com",
		driveAutoSyncMinutes: 30,
		driveSyncAfterChange: false,
		customInstructions: "",
		// Bestehende Installationen bleiben kompatibel: Tokens werden weiterhin
		// synchronisiert, bis der Nutzer dies bewusst ausschaltet.
		syncSecrets: true,
		notionToken: "", // Notion-Integrationstoken für Import + Zwei-Wege-Sync
		notionPageId: "", // Wurzelseite in Notion, unter der lokale neue Seiten entstehen
		notionMap: {}, // lokale Seiten-ID → Notion-Seiten-ID (für lokal erstellte Seiten)
		notionMeta: {}, // Sync-Gedächtnis je Notion-Seite: { r: Remote-Stand, l: lokaler Stand } beim letzten Abgleich — verhindert Ping-Pong-Übertragungen
		notionLastSync: "", // Zeitstempel des letzten Zwei-Wege-Syncs
		corsProxy: "", // optionaler eigener Notion-Proxy (leer = authentifizierter Impala67-Worker)
		deckConf: {}, // Stapel-Optionen: Tageslimits + Leech-Verhalten je Stapel ("*" = Standardwerte)
	},
	// „Standard“ ist der Default-Name für Karten ohne Stapel — löschbar wie jeder andere Stapel
	// (deckDelete entfernt Eintrag + Karten; neu angelegte Karten ohne Stapel legen ihn ggf. wieder an).
	decks: { Standard: { name: "Standard", created: "" } }, // Karteikarten-Stapel; Unterstapel per "Eltern::Kind"-Namensschema
	workspaces: { default: { id: "default", name: "Privat", created: "" } },
	// Eigenständiger GoodNotes-Dateibaum. Bewusst NICHT aus Notion-Workspaces
	// abgeleitet: Ordner, Reihenfolge und Verschachtelung bleiben ausschließlich
	// in der GoodNotes-Ansicht und tauchen nie im Notion-Baum auf.
	gnFolders: {}, // id → { id, title, parentId, order, created, updated }
	// Seiten sind ohne Eintrag eingeklappt; Workspaces dagegen ausgeklappt.
	// Ein explizit geschlossener Workspace wird mit false gespeichert.
	treeOpen: {},
	chat: [], // Haupt-Chatverlauf (Vollbild-Tab)
	sideChat: [], // Verlauf für das kleine KI-Seitenpanel
	sideChatId: null, // eigene gespeicherte Chat-Sitzung des Seitenpanels
	aiActiveChatType: "side", // "side" | "full"
	aiActiveChatId: null, // laufende Antwort bleibt an ihre Sitzung gebunden, auch nach Navigation
	highlightedPageId: null, // Für die Hervorhebung geänderter Blöcke
	highlightedDiff: null, // Diff-Array für die Hervorhebung geänderter Blöcke
	currentPageId: null,
	currentWorkspaceId: "default",
	view: "home", // "home" | "page" | "library" | "chat" | "anki" | "noten" | "daily" | "trash"
	pendingImage: null,
	pendingAttachmentTarget: null, // "side" | "full" — Chat, dem der ausgewählte Anhang gehört
	attachTarget: "side", // zuletzt geöffneter Datei-Dialog; erst nach Dateiauswahl wird der Anhang zugeordnet
	settingsSection: "ki",
	sidebarMode: "files", // "files" | "chats"
	currentChatId: null,
	tabs: [], // offene Seiten- oder Chat-IDs (Präfix "chat:" für Chats)
	activeTabId: null,
	navHistory: [], // für Zurück/Vor
	navIndex: -1,
	aiThinkingDraft: "", // aktuell gestreamter Denkprozess (Reasoning-Modelle)
	thinkingLiveExpanded: false,
	pdfOpen: false,
	aiBusy: false,
	aiStatus: "",
	aiDraft: "",
	aiOnline: null, // null = unbekannt, true/false = Ping-Ergebnis
	reviewShowBack: false,
	reviewCardId: null, // Karte bleibt von der Frage bis zur Bewertung fest angeheftet
	notionToken: "",
	notionPageId: "",
	pendingTextFile: null, // { name, content, size } — langer geklebter Text, wird als .txt-Anhang statt Fließtext gesendet
	pendingPdf: null, // { name, content, size, pages } — PDF-Anhang für den aktuellen Chat, wird nicht automatisch als Seite gespeichert
	driveUserEmail: null, // gesetzt nach erfolgreichem Google-Login (nur für die aktuelle Sitzung)
	availableModels: [], // vom Server abgefragte Modell-Liste (ephemer, nicht persistiert)
	modelMenuOpen: false,
	modelMenuAnchor: "panel", // welches Chat-Fenster das Modell-Dropdown geöffnet hat: "panel" | "full"
	modelMenuLoading: false, // true, solange listModels() die Quellen abfragt
	modelMenuSection: "root", // "root" | "models" | "thinking"
	customModelProviderPick: null, // im Dropdown gewählte Quelle für ein eigenes Modell
	editingMsgId: null, // mid einer Nutzer-Nachricht, die gerade bearbeitet wird
	refineOpenMid: null, // mid einer Assistenten-Antwort, deren "Anpassen"-Menü offen ist
	libMode: "notion", // Bibliothek-Ansicht: "notion" (Dokumente/Seitenbaum) | "hefte" (GoodNotes-Regal) | "nlm" (NotebookLM-Mediathek)
	nlmLibFilter: "all", // NotebookLM-Mediathek-Filter: "all" | "inbox" | "audio" | "video" | "mindmap" | "slides"
	libView: "grid", // Bibliothek: "grid" (GoodNotes-Kacheln) | "table"
	libFolder: null, // aktueller Ordner der Kachel-Ansicht: null = Wurzel (Workspaces), sonst { wsId, pageId|null }
	libSort: "updated", // Tabellen-Sortierung: "title" | "updated" | "created"
	libSortDir: -1, // 1 = aufsteigend, -1 = absteigend
	libFilter: "", // Filtertext der Bibliothek (Titel + Tags)
	pageMenuOpenId: null, // ID der Seite, deren ⋯-Menü in der Sidebar gerade offen ist
	histVersions: null, // geladene Versionen für den Seitenverlauf-Dialog
	histIndex: 0, // aktuell ausgewählte Version im Verlauf
	histPageId: null, // Seite, deren Verlauf gerade offen ist
	pendingNewPage: null, // { wsId, parentId } während der Vorlagen-Auswahl
	ankiTab: "decks", // Karteikarten-Bereich: "decks" | "browser" | "stats" | "study"
	ankiDeck: null, // aktuell gewählter Stapel (null = alle)
	ankiSort: "due", // Browser-Sortierung: "front" | "deck" | "state" | "due" | "interval" | "reps" | "lapses" | "created"
	ankiSortDir: 1, // 1 = aufsteigend, -1 = absteigend
	ankiSearch: "", // Suchtext im Karten-Browser
	ankiBrowserLimit: 200, // Karten-Browser: max. gerenderte Zeilen („mehr anzeigen“ erhöht)
	dailyMonth: null, // "YYYY-MM" im Daily-Notes-Kalender (null = aktueller Monat)
	reviews: [], // Wiederholungs-Protokoll { cardId, t, grade } — aus dem Event-Log rekonstruiert
	telemetry: [], // Lern-Telemetrie (telemetrie.js): { id, t, kind, data } — aus dem Event-Log rekonstruiert, synct wie alles über Drive
	// GoodNotes-Hefte (v8, 25. Juli 2026): Der Inhalt liegt NICHT mehr als Blob
	// neben dem Log, sondern IM Log. Jeder Strich ist ein Event (heftOps), heftDocs
	// ist das Ergebnis des Abspielens. Damit gilt für Hefte exakt dasselbe wie für
	// Seiten und Karten: ein Transportweg, eine Reihenfolge, automatische
	// Zusammenführung. Es gibt keine Heft-Dateien in Drive und keinen Müllsammler mehr.
	heftDocs: {}, // pageId → { v:2, rev, pages: [{ id, paper, strokes, images, texts, ocrText }] }
	heftMeta: {}, // pageId → { rev, pages, bytes, ocrText, updated } — aus heftDocs abgeleitet (Badges, Suche, Bibliothek)
	// Bilder, Scans und PDF-Seiten liegen NICHT mehr im Heft-Dokument, sondern hier:
	// hash → dataURL. Das Heft merkt sich nur noch { id, ref: hash, x, y, w, h }.
	// Grund: ein Foto ist schnell 1–3 MB. Steckte es im Heft-Dokument, wanderte es bei
	// JEDEM Verschieben, Skalieren und in JEDEM Snapshot komplett neu durchs Event-Log.
	// Jetzt wird es genau EINMAL geschrieben (heftBlob) und danach nur noch referenziert.
	heftBlobs: {}, // hash → dataURL (unveränderlich; identische Bilder teilen sich einen Eintrag)
};

export const STATE = (() => {
	// PERF (10. Juli): Parent→Kinder-Index für childrenOf (Sidebar-Baum war O(n²)).
	// Vor reduce deklariert, damit Invalidierung im Hot Path greift.
	let _childIdx = null;
	// EINE Quelle für „wer hängt unter wem“: Eltern→Kinder über ALLE Seiten (inkl.
	// Papierkorb). Vorher existierte die gleiche Auswertung zweimal — gecacht in
	// ensureChildIdx (nur aktive, sortiert) und ein zweites Mal in collectSubtree, das
	// den Index bei JEDEM Aufruf komplett neu baute (Trash/Restore ganzer Bäume).
	let _parentIdx = null;
	function bustChildIdx() { _childIdx = null; _parentIdx = null; }
	function ensureParentIdx() {
		if (_parentIdx) return _parentIdx;
		const m = new Map();
		for (const pg of Object.values(S.pages)) {
			const k = pg.parentId || "";
			let arr = m.get(k);
			if (!arr) { arr = []; m.set(k, arr); }
			arr.push(pg);
		}
		_parentIdx = m;
		return m;
	}

	// PERF (18. Juli): Memoization für backlinksOf() und studySnapshot()/dueCards().
	// Beide liefen bei JEDEM Page-/Full-Render komplett neu (Volltext-Scan über alle
	// Seiten bzw. kompletter Queue-Aufbau über alle Karten) — spürbar bei großen
	// Workspaces. Invalidierung über Revisionszähler in reduce(); studySnapshot
	// bekommt zusätzlich eine kurze Zeitschranke (2 s), weil Fälligkeiten zeitabhängig
	// sind. Ergebnis und Verhalten bleiben identisch, nur Doppelarbeit entfällt.
	let _pageRev = 0;            // zählt alle seitenrelevanten Events
	let _cardRev = 0;            // zählt Karten-/Stapel-/Review-/Settings-Events
	const _backlinkCache = { rev: -1, map: new Map() };
	const _snapCache = { rev: -1, t: 0, map: new Map() };

	// Race-Condition-Fix (10. Juli): serialisiert dispatch()-Aufrufe. Zwei parallele
	// dispatch()-Aufrufe persistierten bisher unabhängig voneinander — je nachdem,
	// welches DB.addEvent() zuerst fertig wurde, konnte reduce() in der falschen
	// Reihenfolge laufen. Jetzt läuft höchstens ein dispatch() gleichzeitig, streng
	// in Aufrufreihenfolge; ein Fehlschlag blockiert nachfolgende Aufrufe nicht.
	let _dispatchChain = Promise.resolve();

	// Offizieller Hook-Mechanismus statt Monkeypatching (extras.js überschrieb bisher
	// STATE.dispatch — fragil, weil von der Modul-Ladereihenfolge abhängig).
	// before-Hooks laufen VOR dem Persistieren (z.B. Undo-Snapshot des alten Stands),
	// after-Hooks NACH reduce()+onChange (z.B. Event an andere Tabs funken).
	// Hook-Fehler werden geloggt, brechen dispatch aber nie ab.
	const _dispatchHooks = { before: [], after: [] };
	const onBeforeDispatch = (fn) => { _dispatchHooks.before.push(fn); };
	const onAfterDispatch = (fn) => { _dispatchHooks.after.push(fn); };

	// Importierte Fremd-Events laufen nicht durch dispatch(), sondern direkt durch
	// reduce() (drive.js replayImported). Wer auf eingetroffene Fremdänderungen
	// reagieren muss — z.B. ein offenes Heft, das sofort die Striche des anderen
	// Geräts zeigen soll — hängt sich hier ein.
	const _remoteHooks = [];
	const onRemoteApplied = (fn) => { _remoteHooks.push(fn); };
	const emitRemoteApplied = (types) => {
		for (const fn of _remoteHooks) {
			try { fn(types || []); } catch (e) { console.warn("remote-Hook:", e); }
		}
	};
	const sortEvents = (events) => (Array.isArray(events) ? events.slice() : [])
		.sort((a, b) => (String(a?.t || "") < String(b?.t || "") ? -1 : String(a?.t || "") > String(b?.t || "") ? 1 : 0) || (a?.seq || 0) - (b?.seq || 0));
	// EIN Pfad fuer bereits persistierte Fremd-Events (Drive und BroadcastChannel):
	// Uhr nachziehen, Zustand anwenden, UI invalidieren und Live-Module informieren.
	function applyRemoteEvents(events) {
		const list = sortEvents(events);
		if (!list.length) return list;
		for (const ev of list) {
			U.observeTime(ev.t);
			reduce(ev);
		}
		if (typeof STATE.onChange === "function") STATE.onChange("syncImport", { payload: { count: list.length } });
		emitRemoteApplied(new Set(list.map((ev) => ev.type)));
		return list;
	}
	// Eine Regel fuer Seiten-Zugehoerigkeit und Zyklus-Schutz. Bei bereits korrupten
	// Alt-Daten lehnen Aufrufer den Vorgang nach dem Hops-Limit sicherheitshalber ab.
	function pageInTree(pageId, rootId) {
		let id = pageId, hops = 0;
		while (id) {
			if (id === rootId) return true;
			if (++hops > 10000) return true;
			id = (S.pages[id] || {}).parentId || null;
		}
		return false;
	}

	// ---- Stapel-Helfer: ein Stapel-Teilbaum ("Eltern::Kind") + seine Karten ----
	// Eine fachliche Regel fuer Reducer, UI, Lernqueue und KI-Werkzeuge.
	const deckInTree = (deck, root) => !!root && (deck === root || String(deck || "").startsWith(root + "::"));
	const deckSubtree = (from) => Object.keys(S.decks).filter((n) => deckInTree(n, from));
	// includeTrashed: Rename/Move/Purge brauchen alle Karten; Lernen/UI nur aktive.
	const cardsInDeckTree = (from, opts) => Object.values(S.cards).filter((c) => {
		if (!(opts && opts.includeTrashed) && c.trashed) return false;
		return deckInTree(c.deck || "Standard", from);
	});
	function renameDeckTree(from, to) {
		deckSubtree(from).forEach((n) => {
			const nn = to + n.slice(from.length);
			S.decks[nn] = { ...S.decks[n], name: nn };
			delete S.decks[n];
		});
		cardsInDeckTree(from, { includeTrashed: true }).forEach((c) => {
			c.deck = to + (c.deck || "Standard").slice(from.length);
		});
	}

	// ---- Stapel-Optionen: Tageslimits + Leech-Verhalten (wie Anki, pro Stapel) ----
	const DECK_DEFAULTS = { newPerDay: 20, revPerDay: 200, leechThreshold: 8, leechAction: "suspend" };
	function deckConfOf(deck) {
		const all = (S.settings && S.settings.deckConf) || {};
		let d = deck || "Standard";
		// Vererbung: "Mathe::Analysis" fällt auf "Mathe" zurück, dann auf "*" bzw. Standardwerte
		while (d) {
			if (all[d]) return { ...DECK_DEFAULTS, ...(all["*"] || {}), ...all[d] };
			d = d.includes("::") ? d.slice(0, d.lastIndexOf("::")) : "";
		}
		return { ...DECK_DEFAULTS, ...(all["*"] || {}) };
	}

	// ---- Zugangsdaten und optionaler persönlicher Drive-Sync -----------------
	// API-Keys und Notion-Token bleiben für die Laufzeit lokal verfügbar. Ob ihre
	// settingsSet-Events über den privaten, unverschlüsselten appDataFolder auf
	// andere Geräte gelangen, steuert S.settings.syncSecrets.
	// Die alte localStorage-Ablage bleibt nur als einmalige Migrationsquelle.
	function loadLegacySecrets() {
		try { return JSON.parse(localStorage.getItem("impala67.secrets") || localStorage.getItem("notion.secrets") || "{}"); } catch { return {}; }
	}
	async function migrateLegacySecretsToSync() {
		const sec = loadLegacySecrets();
		const patch = {};
		if (sec.notionToken && !S.settings.notionToken) patch.notionToken = sec.notionToken;
		if (sec.corsProxy && !S.settings.corsProxy) patch.corsProxy = sec.corsProxy;
		const keys = sec.providerKeys || {};
		let providersChanged = false;
		const providers = (S.settings.aiProviders || []).map((pr) => {
			if (!pr.key && keys[pr.id]) { providersChanged = true; return { ...pr, key: keys[pr.id] }; }
			return pr;
		});
		if (providersChanged) patch.aiProviders = providers;
		if (Object.keys(patch).length) await dispatch("settingsSet", patch);
		// Nach erfolgreicher Übernahme nicht mehr lokal überlagern; die Werte liegen
		// ab jetzt im synchronisierten Event-Log und damit im persönlichen Drive.
		if (Object.keys(patch).length) {
			localStorage.removeItem("impala67.secrets");
			localStorage.removeItem("notion.secrets");
		}
	}

	// ---- Hefte als Event-Log (v8) ------------------------------------------
	// Striche sind Events. Der gesamte Zusammenführungs-Trick steckt in der Form
	// der Operationen: Hinzufügen ist idempotent (gleiche ID = einmal), Entfernen
	// ist idempotent (fehlt schon = nichts zu tun), Ersetzen ist
	// Last-Write-Wins über die Log-Reihenfolge. Dadurch führen zwei Geräte, die
	// gleichzeitig im selben Heft zeichnen, ihre Striche automatisch zusammen —
	// ohne Konflikt, ohne Gewinner, ohne Verlierer-Kopie.
	const heftNewPage = (id, paper) => ({ id, paper: paper || "lined", strokes: [], images: [], texts: [], ocrText: "" });
	const heftPageOf = (doc, key) => doc.pages.find((pg) => pg.id === key) || null;
	const heftById = (list, id) => list.findIndex((x) => x && x.id === id);

	function heftDocOf(pageId) {
		let d = S.heftDocs[pageId];
		if (!d) { d = { v: 2, rev: 0, pages: [] }; S.heftDocs[pageId] = d; }
		return d;
	}

	// Grobe Größenschätzung für Badges/Bibliothek. Bewusst billig gerechnet statt
	// per JSON.stringify — die Zahl ist reine Anzeige, kein Sync-Kriterium mehr.
	function heftBytes(doc) {
		let n = 0;
		for (const pg of doc.pages) {
			for (const s of pg.strokes) n += 40 + (s.pts ? s.pts.length * 14 : 60);
			for (const im of pg.images) n += (im.ref ? (S.heftBlobs[im.ref] || "").length : (im.src ? im.src.length : 0)) + 60;
			for (const tx of pg.texts) n += (tx.text ? tx.text.length : 0) + 60;
		}
		return n;
	}

	function heftSyncMeta(pageId, t) {
		const doc = heftDocOf(pageId);
		doc.rev++;
		let ocrText = "";
		for (let i = 0; i < doc.pages.length; i++) {
			const txt = doc.pages[i].ocrText;
			if (txt) ocrText = ocrText ? ocrText + "\n" + txt : txt;
		}
		const meta = {
			rev: doc.rev,
			pages: doc.pages.length,
			ocrText,
			updated: t,
		};
		// PERF-WURZEL: Die Größenschätzung lief über ALLE Seiten, Striche und Punkte des Hefts —
		// und zwar bei JEDEM einzelnen Strich. Der Aufwand pro Strich wuchs damit mit dem Heft
		// mit: auf vollen Seiten spürbares Ruckeln beim Schreiben. Die Zahl ist reine Anzeige
		// (Badges, Bibliothek) und wird jetzt erst berechnet, wenn sie wirklich gelesen wird —
		// dann immer vom aktuellen Dokument, auch nach einer Verdichtung (heftSnap).
		Object.defineProperty(meta, "bytes", {
			get: () => heftBytes(heftDocOf(pageId)),
			enumerable: true,
			configurable: true,
		});
		S.heftMeta[pageId] = meta;
		if (S.pages[pageId]) S.pages[pageId].updated = t;
	}

	function applyHeftOps(pageId, ops) {
		const doc = heftDocOf(pageId);
		for (const op of ops) {
			if (!op || !op.t) continue;
			const pg = op.p ? heftPageOf(doc, op.p) : null;
			switch (op.t) {
				case "pg+": {
					// Zwei Geräte hängen gleichzeitig eine Seite an: beide bleiben erhalten,
					// die Reihenfolge ergibt sich aus der Log-Reihenfolge.
					if (!op.page || !op.page.id || heftPageOf(doc, op.page.id)) break;
					const at = Math.max(0, Math.min(typeof op.at === "number" ? op.at : doc.pages.length, doc.pages.length));
					doc.pages.splice(at, 0, heftNewPage(op.page.id, op.page.paper));
					break;
				}
				case "pg-": {
					const i = doc.pages.findIndex((x) => x.id === op.p);
					if (i >= 0) doc.pages.splice(i, 1);
					break;
				}
				case "pgo": {
					// Reihenfolge umsortieren. Unbekannte Seiten (vom anderen Gerät neu)
					// hängen hinten an, statt verloren zu gehen.
					const order = Array.isArray(op.order) ? op.order : [];
					const rank = (id) => { const i = order.indexOf(id); return i < 0 ? 1e9 : i; };
					doc.pages = doc.pages.map((pg2, i) => [pg2, i]).sort((a, b) => rank(a[0].id) - rank(b[0].id) || a[1] - b[1]).map((x) => x[0]);
					break;
				}
				case "pgp": if (pg) pg.paper = op.paper || "lined"; break;
				case "ocr": if (pg) pg.ocrText = op.text || ""; break;
				case "s+": if (pg && op.o && op.o.id && heftById(pg.strokes, op.o.id) < 0) pg.strokes.push(op.o); break;
				case "s=": if (pg && op.o && op.o.id) { const i = heftById(pg.strokes, op.o.id); if (i >= 0) pg.strokes[i] = op.o; else pg.strokes.push(op.o); } break;
				case "s-": if (pg) { const k = new Set(op.ids || []); pg.strokes = pg.strokes.filter((s) => !k.has(s.id)); } break;
				case "i+": if (pg && op.o && op.o.id && heftById(pg.images, op.o.id) < 0) pg.images.push(op.o); break;
				case "i=": if (pg && op.o && op.o.id) { const i = heftById(pg.images, op.o.id); if (i >= 0) pg.images[i] = op.o; else pg.images.push(op.o); } break;
				case "i-": if (pg) { const k = new Set(op.ids || []); pg.images = pg.images.filter((x) => !k.has(x.id)); } break;
				case "x+": if (pg && op.o && op.o.id && heftById(pg.texts, op.o.id) < 0) pg.texts.push(op.o); break;
				case "x=": if (pg && op.o && op.o.id) { const i = heftById(pg.texts, op.o.id); if (i >= 0) pg.texts[i] = op.o; else pg.texts.push(op.o); } break;
				case "x-": if (pg) { const k = new Set(op.ids || []); pg.texts = pg.texts.filter((x) => !k.has(x.id)); } break;
			}
		}
	}

	// Vektoren liegen bewusst außerhalb des Event-Logs, müssen beim endgültigen
	// Seitenlöschen aber genauso aus dem lokalen Derived-Store verschwinden.
	function deletePageVector(pageId) {
		if (!pageId) return;
		try {
			const pending = DB.delVec(pageId);
			if (pending && typeof pending.catch === "function") pending.catch((err) => console.warn("Seitenvektor konnte nicht gelöscht werden:", err));
		} catch (err) {
			// Direkte Reducer-Replays in Tests können vor DB.open() stattfinden.
			if (!String(err?.message || err).includes("DB.open")) console.warn("Seitenvektor konnte nicht gelöscht werden:", err);
		}
	}

	function reduce(ev) {
		const p = ev.payload || {};
		// PERF (18. Juli): Cache-Invalidierung für die Memoization oben — jedes
		// relevante Event macht die betroffenen Caches ungültig, sonst ändert sich nichts.
		// FIX: Heft-Events zählten nicht als Seitenänderung. Der Handschrift-Text (ocrText) steckt
		// aber im Suchindex der Seite — nach dem Schreiben im Heft fand die Suche den neuen Text
		// erst, wenn irgendwann zufällig ein anderes Seiten-Event vorbeikam.
		if (ev.type.startsWith("page") || ev.type.startsWith("heft")) _pageRev++;
		if (ev.type.startsWith("card") || ev.type.startsWith("deck") || ev.type === "settingsSet") _cardRev++;
		switch (ev.type) {
			case "pageCreate":
				// FIX: fehlende Validierung — ohne id konnte eine "undefined"-Seite entstehen.
				if (!p.id) break;
				bustChildIdx();
				S.pages[p.id] = {
					id: p.id, title: p.title || "Ohne Titel", parentId: p.parentId || null,
					content: p.content || "", pdfId: p.pdfId || null, tags: p.tags || [],
					workspaceId: p.workspaceId || "default",
					icon: p.icon || null, cover: p.cover || null, coverImg: p.coverImg || null,
					daily: p.daily || null, dailyRoot: p.dailyRoot || null,
					db: p.db || null, props: p.props || null,
					// Verknüpfung mit der Notion-Seite (import-notion.js). Sie hängt bewusst
					// an der Seite selbst statt in settings.notionMap: so reist sie mit der
					// Seite durchs Event-Log, statt in einem globalen Objekt zu liegen, das
					// bei jedem Sync komplett neu geschrieben wird.
					notionId: p.notionId || null,
					// Seitentyp: "notion" (Block-Editor) oder "heft" (GoodNotes-Notizbuch).
					// Alt-Seiten ohne kind bleiben automatisch Notion-Seiten.
					kind: p.kind === "heft" ? "heft" : "notion",
					order: typeof p.order === "number" ? p.order : null,
					// Eigene GoodNotes-Ablage, getrennt von parentId/order des Notion-Baums.
					gnFolderId: p.gnFolderId || null,
					gnOrder: typeof p.gnOrder === "number" ? p.gnOrder : null,
					created: ev.t, updated: ev.t,
				};
				break;
			case "pageUpdate": {
				const pg = S.pages[p.id];
				if (!pg) break;
				// Strukturrelevant nur bei parent/order/workspace/trash — content-only spart Index-Rebuild
				const patch = p.patch || {};
				if ("parentId" in patch || "order" in patch || "workspaceId" in patch || "trashed" in patch || "title" in patch)
					bustChildIdx();
				Object.assign(pg, patch); // geprüfte Kopie von oben statt erneut p.patch (konnte undefined sein)
				pg.updated = ev.t;
				break;
			}
			case "pageMove": {
				bustChildIdx();
				const pg = S.pages[p.id];
				if (!pg) break;
				// Zyklus-Schutz: eine Seite darf nie unter sich selbst oder einen eigenen
				// Nachfahren wandern (führte zu Endlos-Rekursion, z.B. beim Papierkorb).
				const ok = !pageInTree(p.parentId, p.id);
				if (ok) pg.parentId = p.parentId || null;
				// Manuelle Sortierung per Drag & Drop: order wird beim Verschieben mitgesetzt
				if (ok && typeof p.order === "number") pg.order = p.order;
				break;
			}
			case "pageDelete":
				bustChildIdx();
				closePageTabs([p.id]);
				deletePageVector(p.id);
				Object.values(S.pages).forEach((pg) => {
					if (pg.parentId === p.id) pg.parentId = null; // Kinder wandern auf Root
				});
				delete S.heftMeta[p.id]; // Heft-Metadaten mit aufräumen
				delete S.heftDocs[p.id]; // Heft-Inhalt mit aufräumen
				delete S.pages[p.id];
				break;
			case "pageTrash":
				bustChildIdx();
				// Wie in Notion: die ganze Unterseiten-Struktur wandert zusammen in den Papierkorb.
				const trashedIds = collectSubtree(p.id);
				trashedIds.forEach((id) => {
					const pg = S.pages[id];
					if (pg) { pg.trashed = true; pg.trashedAt = ev.t; }
				});
				closePageTabs(trashedIds);
				break;
			case "pageRestore":
				bustChildIdx();
				collectSubtree(p.id).forEach((id) => {
					const pg = S.pages[id];
					if (pg) { pg.trashed = false; delete pg.trashedAt; }
				});
				break;
			case "learningSessionUpsert": {
				if (!p.id || !Number.isFinite(Number(p.durationSeconds))) break;
				const current = S.learningSessions[p.id];
				const updated = p.updated || ev.t;
				if (current && String(current.updated || "") > String(updated)) break;
				S.learningSessions[p.id] = {
					id: p.id,
					startedAt: p.startedAt || ev.t,
					endedAt: p.endedAt || ev.t,
					durationSeconds: Math.max(0, Math.round(Number(p.durationSeconds))),
					// Neuere Einheiten können mehrere aktive Abschnitte enthalten. Die
					// Lücken dazwischen gehören logisch zur Einheit, zählen aber nicht.
					segments: Array.isArray(p.segments) ? p.segments.map((segment) => ({
						startedAt: String(segment && segment.startedAt || ""),
						endedAt: String(segment && segment.endedAt || ""),
					})).filter((segment) => segment.startedAt && segment.endedAt) : [],
					category: p.category || "other",
					subject: p.subject !== undefined ? (p.subject ? String(p.subject).trim().slice(0, 80) : null) : (current && current.subject) || null,
					subjectSource: p.subjectSource !== undefined ? (p.subjectSource ? String(p.subjectSource).trim().slice(0, 24) : null) : (current && current.subjectSource) || null,
					sourceId: p.sourceId || null,
					updated,
					deleted: false,
				};
				break;
			}
			case "learningSessionDelete": {
				if (!p.id) break;
				const current = S.learningSessions[p.id] || { id: p.id };
				const updated = p.updated || ev.t;
				if (String(current.updated || "") > String(updated)) break;
				S.learningSessions[p.id] = { ...current, deleted: true, updated };
				break;
			}
			case "teleEvent": {
				// Lern-Telemetrie (telemetrie.js): bewusst EIN generischer Ereignistyp —
				// die Bedeutung steckt in kind/data (review, studyStart/End, focusLoss,
				// timer*, …). Läuft über das Event-Log und synchronisiert damit wie jede
				// andere Änderung automatisch über Drive.
				if (!p.kind) break;
				S.telemetry.push({ id: p.id || ev.id, t: ev.t, kind: String(p.kind), data: p.data || {} });
				break;
			}
			case "gradeAdd":
				if (!p.id || !p.subject || !Number.isFinite(Number(p.grade))) break;
				S.grades[p.id] = {
					id: p.id,
					subject: String(p.subject).trim(),
					grade: Math.min(6, Math.max(1, Number(p.grade))),
					weight: Math.max(0.25, Number(p.weight) || 1),
					date: p.date || ev.t.slice(0, 10),
					comment: p.comment || "",
					created: ev.t,
				};
				break;
			case "gradeDelete":
				if (S.grades[p.id]) S.grades[p.id].deleted = true;
				break;
			case "cardCreate":
				// FIX: fehlende Validierung — analog zu pageCreate.
				if (!p.id) break;
				S.cards[p.id] = {
					id: p.id, front: p.front, back: p.back, pageId: p.pageId || null,
					deck: p.deck || "Standard", suspended: false,
					type: p.type || "basic", cloze: p.cloze || null, // "cloze" = aus Lückentext erzeugt
					srs: p.srs || SRS.newCard(ev.t), created: ev.t,
				};
				if (p.deck && !S.decks[p.deck]) S.decks[p.deck] = { name: p.deck, created: ev.t };
				// FIX: lag der Ziel-Stapel im Papierkorb, landete die neue Karte unsichtbar darin
				// (Stapel-Liste zeigt ihn nicht, die Lern-Queue schon) — Stapel reaktivieren.
				else if (p.deck && S.decks[p.deck].trashed) {
					S.decks[p.deck].trashed = false;
					delete S.decks[p.deck].trashedAt;
				}
				break;
			case "cardReview": {
				const c = S.cards[p.id];
				// Verwaiste, verspätet importierte Reviews dürfen weder Statistik noch
				// Tageslimits verändern. Ohne Karte ist kein gültiges Review anwendbar.
				if (!c || !p.srs) break;
				const wasNew = p.first != null ? !!p.first : c.srs.state === "new";
				const wasLearning = p.learning != null ? !!p.learning : (c.srs.state === "learning" || c.srs.state === "relearning");
				c.srs = p.srs;
				const conf = deckConfOf(c.deck);
				if ((p.grade || 0) === 1 && (c.srs.lapses || 0) >= conf.leechThreshold) {
					c.leech = true;
					if (conf.leechAction === "suspend") c.suspended = true;
				}
				// Deck und Art werden beim Ereignis eingefroren: spätere Deck-Moves dürfen
				// historische Limits, Heatmap und Retention nicht rückwirkend umhängen.
				S.reviews.push({ id: p.reviewId || ev.id, cardId: p.id, deck: p.deck || c.deck || "Standard", t: ev.t,
					grade: p.grade || 0, first: wasNew, learning: wasLearning,
					subject: p.subject ? String(p.subject).trim().slice(0, 80) : null,
					subjectSource: p.subjectSource ? String(p.subjectSource).trim().slice(0, 24) : null,
					dueAt: p.dueAt || null, previousReviewAt: p.previousReviewAt || null,
					intervalDays: p.intervalDays !== null && p.intervalDays !== undefined && Number.isFinite(Number(p.intervalDays)) ? Number(p.intervalDays) : null });
				break;
			}
			case "cardReviewUndo": {
				// Kompensations-Event (Log bleibt append-only): stellt den srs-Stand vor der
				// letzten Bewertung wieder her und entfernt den Protokoll-Eintrag.
				const c = S.cards[p.id];
				// FIX: fehlende Validierung — ohne srs-Payload keine Undo-Anwendung.
				if (!c || !p.srs) break;
				c.srs = p.srs;
				if ((c.srs.lapses || 0) < deckConfOf(c.deck).leechThreshold) c.leech = false;
				if (p.unsuspend) c.suspended = false;
				for (let i = S.reviews.length - 1; i >= 0; i--) {
					if ((p.reviewId && S.reviews[i].id === p.reviewId) || (!p.reviewId && S.reviews[i].cardId === p.id)) { S.reviews.splice(i, 1); break; }
				}
				break;
			}
			case "cardUpdate": {
				const c = S.cards[p.id];
				if (c) Object.assign(c, p.patch);
				break;
			}
			case "cardTrash": {
				// Soft-Delete wie bei Seiten: Karte bleibt im Log, landet im Papierkorb.
				const c = S.cards[p.id];
				if (!c) break;
				c.trashed = true;
				c.trashedAt = ev.t;
				break;
			}
			case "cardRestore": {
				const c = S.cards[p.id];
				if (!c) break;
				c.trashed = false;
				delete c.trashedAt;
				// Stapel-Eintrag ggf. wiederherstellen, falls er mitgelöscht war
				const d = c.deck || "Standard";
				if (d && !S.decks[d]) S.decks[d] = { name: d, created: ev.t };
				else if (S.decks[d] && S.decks[d].trashed) {
					S.decks[d].trashed = false;
					delete S.decks[d].trashedAt;
				}
				break;
			}
			case "cardDelete":
				// Endgültig löschen (nur aus dem Papierkorb)
				delete S.cards[p.id];
				break;
			case "deckCreate":
				// FIX: fehlende Validierung — ohne Namen keinen Stapel anlegen.
				if (!p.name) break;
				S.decks[p.name] = { name: p.name, created: ev.t };
				break;
			case "deckRename":
				// Benennt den Stapel samt aller Unterstapel um und zieht die Karten mit
				// (inkl. papierkorb-Karten, damit sie dem Stapel treu bleiben).
				renameDeckTree(p.from, p.to);
				break;
			case "deckReorder":
				// Manuelle Stapel-Reihenfolge (Drag & Drop in der linken Spalte, 22. Juli).
				// Seiten haben pageMove+order — Stapel bekommen ihr order am Deck-Eintrag.
				if (!p.name || typeof p.order !== "number") break;
				if (!S.decks[p.name]) S.decks[p.name] = { name: p.name, created: ev.t };
				S.decks[p.name].order = p.order;
				break;
			case "deckTrash":
				// Soft-Delete: Stapel + Karten des Teilbaums → Papierkorb (wiederherstellbar).
				// Auch „Standard“ ist trash-fähig. Review-Protokoll bleibt erhalten.
				if (!p.name) break;
				cardsInDeckTree(p.name, { includeTrashed: true }).forEach((c) => {
					c.trashed = true;
					c.trashedAt = ev.t;
				});
				deckSubtree(p.name).forEach((n) => {
					if (!S.decks[n]) S.decks[n] = { name: n, created: ev.t };
					S.decks[n].trashed = true;
					S.decks[n].trashedAt = ev.t;
				});
				break;
			case "deckRestore":
				// Stapel + seine Karten aus dem Papierkorb zurückholen.
				if (!p.name) break;
				deckSubtree(p.name).forEach((n) => {
					if (!S.decks[n]) return;
					S.decks[n].trashed = false;
					delete S.decks[n].trashedAt;
				});
				cardsInDeckTree(p.name, { includeTrashed: true }).forEach((c) => {
					c.trashed = false;
					delete c.trashedAt;
				});
				break;
			case "deckDelete":
				// Endgültig: Stapel + Karten des Teilbaums unwiderruflich entfernen
				// (Papierkorb → „Endgültig löschen“). Alt-Events deckDelete bleiben hard-delete.
				if (!p.name) break;
				cardsInDeckTree(p.name, { includeTrashed: true }).forEach((c) => { delete S.cards[c.id]; });
				deckSubtree(p.name).forEach((n) => delete S.decks[n]);
				break;
			case "deckMove": {
				// Verschiebt einen Stapel samt Unterstapeln + Karten unter ein neues Eltern-Deck.
				// FIX: fehlende Validierung + Zyklus-Schutz — ein Stapel darf nicht in sich selbst
				// oder einen eigenen Unterstapel wandern (zerlegte vorher den Stapel-Baum).
				if (!p.from) break;
				const target = p.target || "";
				if (deckInTree(target, p.from)) break;
				const to = (target ? target + "::" : "") + p.from.split("::").pop();
				if (to !== p.from) renameDeckTree(p.from, to);
				break;
			}
			case "deckDuplicate": {
				const from = p.name;
				const prefix = from.includes("::") ? from.slice(0, from.lastIndexOf("::") + 2) : "";
				const to = prefix + from.split("::").pop() + " (Kopie)";
				deckSubtree(from).forEach((n) => {
					if (S.decks[n] && S.decks[n].trashed) return; // Papierkorb-Stapel nicht duplizieren
					const nn = to + n.slice(from.length);
					S.decks[nn] = { name: nn, created: ev.t };
				});
				cardsInDeckTree(from).forEach((c) => {
					// Reducer-Ausgabe muss auf jedem Sync-Gerät identisch sein. Zufalls-IDs
					// beim Replay desselben Events erzeugten sonst mehrere Kartenkopien.
					const id = ev.id + ":copy:" + c.id;
					S.cards[id] = { ...c, id, deck: to + (c.deck || "Standard").slice(from.length), srs: SRS.newCard(ev.t), created: ev.t, trashed: false };
					delete S.cards[id].trashedAt;
				});
				break;
			}
			case "workspaceCreate":
				// FIX: fehlende Validierung — ohne id keinen Workspace anlegen.
				if (!p.id) break;
				S.workspaces[p.id] = { id: p.id, name: p.name || "Workspace", created: ev.t };
				break;
			case "gnFolderCreate":
				if (!p.id) break;
				S.gnFolders[p.id] = {
					id: p.id, title: p.title || "Neuer Ordner", parentId: p.parentId || null,
					order: typeof p.order === "number" ? p.order : (Date.parse(ev.t) || 0),
					created: ev.t, updated: ev.t,
				};
				break;
			case "gnFolderMove": {
				const folder = S.gnFolders[p.id];
				if (!folder) break;
				// Kein Ordner darf in sich selbst oder einen eigenen Nachfahren fallen.
				let cur = p.parentId || null, valid = true, hops = 0;
				while (cur) {
					if (cur === p.id || ++hops > 10000) { valid = false; break; }
					cur = (S.gnFolders[cur] || {}).parentId || null;
				}
				if (!valid) break;
				folder.parentId = p.parentId || null;
				if (typeof p.order === "number") folder.order = p.order;
				folder.updated = ev.t;
				break;
			}
			case "gnItemMove": {
				const pg = S.pages[p.id];
				if (!pg || pg.kind !== "heft") break;
				// Nur Hefte leben im GoodNotes-Dateibaum; Notion-Seiten bleiben unberührt.
				if (p.folderId && !S.gnFolders[p.folderId]) break;
				pg.gnFolderId = p.folderId || null;
				if (typeof p.order === "number") pg.gnOrder = p.order;
				pg.updated = ev.t;
				break;
			}
			case "gnFolderDelete": {
				const folder = S.gnFolders[p.id];
				if (!folder) break;
				// Löschen entfernt nur den Ordner selbst. Direkte Hefte und Unterordner
				// landen eine Ebene höher – weder GoodNotes-Inhalt noch Notion-Seiten gehen verloren.
				const parentId = folder.parentId || null;
				Object.values(S.gnFolders).forEach((f) => { if (f.parentId === folder.id) f.parentId = parentId; });
				Object.values(S.pages).forEach((pg) => { if (pg.gnFolderId === folder.id) pg.gnFolderId = parentId; });
				delete S.gnFolders[folder.id];
				break;
			}
			case "heftOps":
				// Der Normalfall: eine Handvoll Striche, Radierungen oder Seitenänderungen.
				if (!p.pageId || !Array.isArray(p.ops) || !p.ops.length) break;
				applyHeftOps(p.pageId, p.ops);
				heftSyncMeta(p.pageId, ev.t);
				break;
			case "heftSnap":
				// Verdichtung: ersetzt den kompletten Heft-Zustand. Wird periodisch
				// geschrieben, damit db.js alle älteren heftOps desselben Hefts
				// wegwerfen kann und das Log nicht unbegrenzt wächst.
				if (!p.pageId || !p.doc || !Array.isArray(p.doc.pages)) break;
				S.heftDocs[p.pageId] = {
					v: 2, rev: 0,
					pages: p.doc.pages.map((pg) => ({
						id: pg.id, paper: pg.paper || "lined",
						strokes: Array.isArray(pg.strokes) ? pg.strokes : [],
						images: Array.isArray(pg.images) ? pg.images : [],
						texts: Array.isArray(pg.texts) ? pg.texts : [],
						ocrText: pg.ocrText || "",
					})),
				};
				heftSyncMeta(p.pageId, ev.t);
				break;
			case "heftBlob":
				// Unveränderliche Bilddaten, adressiert über ihren Inhalts-Hash. Kommt derselbe
				// Hash zweimal an (zwei Geräte fügen dasselbe Bild ein), gewinnt einfach der
				// erste — der Inhalt ist per Definition identisch. Kein Konflikt möglich.
				if (!p.hash || !p.data || S.heftBlobs[p.hash]) break;
				S.heftBlobs[p.hash] = p.data;
				break;
			case "chatUpsert": {
				if (!p.id || !Array.isArray(p.messages)) break;
				const current = S.chatSessions[p.id];
				const updated = p.updated || ev.t;
				// Last-write-wins pro Chat. So überschreibt ein älterer Import weder
				// eine neuere Nachricht noch einen späteren Löschvorgang.
				if (current && String(current.deletedAt || current.updated || "") > String(updated)) break;
				S.chatSessions[p.id] = {
					id: p.id,
					title: p.title || "",
					messages: p.messages,
					created: p.created || ev.t,
					updated,
					deleted: false,
				};
				break;
			}
			case "chatDelete": {
				if (!p.id) break;
				const current = S.chatSessions[p.id] || { id: p.id };
				const deletedAt = p.deletedAt || ev.t;
				if (String(current.updated || current.deletedAt || "") > String(deletedAt)) break;
				S.chatSessions[p.id] = { ...current, deleted: true, deletedAt };
				break;
			}
			case "uiTreeSet":
				// Operation statt Gesamtsnapshot: Öffnen verschiedener Äste auf zwei
				// Offline-Geräten wird beim Log-Merge nicht gegenseitig überschrieben.
				if (!p.key) break;
				if (p.open) S.treeOpen[p.key] = true;
				else if (String(p.key).startsWith("ws:")) S.treeOpen[p.key] = false;
				else delete S.treeOpen[p.key];
				break;
			case "uiTabsSet": {
				// Seiten, NotebookLM, Karteikarten (anki:main) UND Chats sind synchronisierte Tabs. Ein Chat-Tab
				// ist nur gültig, wenn seine (ebenfalls synchronisierte) Sitzung existiert.
				const seen = new Set();
				S.tabs = (Array.isArray(p.tabs) ? p.tabs : []).filter((id) => {
					if (typeof id !== "string" || seen.has(id)) return false;
					seen.add(id);
					if (id.startsWith("chat:")) {
						const chat = S.chatSessions[id.slice(5)];
						return !!(chat && !chat.deleted);
					}
					return !!(S.pages[id] && !S.pages[id].trashed) || id === "nlm:main" || id === "anki:main";
				}).slice(-12);
				S.activeTabId = S.tabs.includes(p.activeTabId) ? p.activeTabId : (S.tabs[S.tabs.length - 1] || null);
				break;
			}
			case "settingsSet":
				Object.assign(S.settings, SETTINGS_SYNC.mergePatch(S.settings, p));
				break;
		}
	}

	async function dispatchOne(type, payload) {
		// Eigene Kopie: das Payload landet im append-only Log und darf sich nicht mehr
		// ändern, wenn der Aufrufer sein Objekt danach weiterbenutzt. (Die früheren
		// Haken stripSecrets/applySecrets waren seit dem Umzug der Zugangsdaten ins
		// Event-Log reine No-Ops — irreführend und ersatzlos entfallen.)
		if (type === "settingsSet") payload = { ...payload };
		for (const fn of _dispatchHooks.before) {
			try { fn(type, payload); } catch (e) { console.warn("dispatch-Hook (before):", e); }
		}
		const ev = { id: U.uid(), t: U.now(), type, payload };
		// Erst persistieren, dann anwenden — sonst zeigt die UI bei einem
		// Speicherfehler (z.B. Quota voll) Änderungen, die nie gespeichert wurden.
		try {
			await DB.addEvent(ev);
		} catch (e) {
			// Toast statt blockierendem alert() + konkrete Speicher-Diagnose,
			// damit „Speicherplatz voll?“ keine Vermutung bleiben muss.
			let quota = "";
			try {
				const est = await navigator.storage?.estimate?.();
				if (est?.quota) quota = " — Speicher: " + Math.round((est.usage || 0) / 1048576) + " von " + Math.round(est.quota / 1048576) + " MB belegt";
			} catch { /* Diagnose ist optional */ }
			U.toast("Speichern fehlgeschlagen" + quota + ": " + (e && e.message ? e.message : e), "error");
			throw e;
		}
		reduce(ev);
		// boot.js setzt einmalig: STATE.onChange = () => RENDER.render();
		if (typeof STATE.onChange === "function") STATE.onChange(type, ev);
		for (const fn of _dispatchHooks.after) {
			try { fn(ev); } catch (e) { console.warn("dispatch-Hook (after):", e); }
		}
		return ev;
	}

	// FIX (Race Condition): dispatch() serialisiert jetzt alle Aufrufe über eine
	// Kette (_dispatchChain), statt sie parallel persistieren zu lassen. Vorher
	// konnten zwei fast gleichzeitige dispatch()-Aufrufe ihre DB.addEvent() in
	// beliebiger Reihenfolge abschließen und reduce() dadurch außer der Reihe
	// anwenden — der In-Memory-Zustand konnte dann von dem abweichen, was ein
	// erneutes load() aus dem (nach Zeitstempel sortierten) Log rekonstruiert.
	// Jeder Aufrufer erhält weiterhin sein eigenes Promise mit Ergebnis/Fehler;
	// ein Fehlschlag blockiert nicht die nachfolgenden dispatch()-Aufrufe.
	function dispatch(type, payload) {
		const run = _dispatchChain.then(() => dispatchOne(type, payload));
		_dispatchChain = run.then(() => undefined, () => undefined);
		return run;
	}

	let _loadedSeq = 0;
	let _loadedTime = "";
	const getLoadedSeq = () => _loadedSeq;
	const getLoadedTime = () => _loadedTime;

	// Gemeinsamer Helfer für load()/pageHistory(): Event-Log laden und deterministisch
	// sortieren (vorher in beiden Funktionen fast identisch dupliziert).
	async function loadSortedEvents() {
		return sortEvents(await DB.allEvents());
	}

	async function load() {
		const evs = await loadSortedEvents();
		_loadedSeq = evs.reduce((m, ev) => Math.max(m, Number(ev?.seq || 0)), 0);
		_loadedTime = evs.length ? evs[evs.length - 1].t : "";
		// Hybride logische Uhr (siehe util.js): nach einem Neustart steht _lastNowMs auf 0.
		// Ohne diesen Anstoß könnte die erste Bearbeitung nach dem Start einen Zeitstempel
		// bekommen, der VOR einem bereits importierten fremden Stand liegt — und im Replay
		// damit ausgerechnet gegen den Stand verlieren, den sie ablösen soll.
		if (evs.length) U.observeTime(evs[evs.length - 1].t);
		evs.forEach(reduce);
		return { maxSeq: _loadedSeq, maxTime: _loadedTime, count: evs.length };
	}

	// Sammelt eine Seite und alle ihre Nachfahren (für Papierkorb: die ganze
	// Unterseiten-Struktur wandert gemeinsam rein bzw. wieder raus).
	// Iterativ mit Stack (kein Rekursionsüberlauf), Zyklen-Schutz über ein Set.
	// Der Eltern→Kinder-Index kommt jetzt aus ensureParentIdx() und wird zwischen
	// Aufrufen behalten — vorher O(alle Seiten) pro Trash-/Restore-Aufruf.
	function collectSubtree(id) {
		const byParent = ensureParentIdx();
		const result = [];
		const visited = new Set();
		const stack = [id];
		while (stack.length) {
			const cur = stack.pop();
			if (visited.has(cur)) continue; // Sicherheitsnetz gegen Zyklen in Alt-Daten
			visited.add(cur);
			result.push(cur);
			for (const kid of byParent.get(cur) || []) stack.push(kid.id);
		}
		return result;
	}
	const pageSubtreeIds = (id) => new Set(collectSubtree(id));
	function closePageTabs(ids) {
		const gone = ids instanceof Set ? ids : new Set(ids || []);
		if (!gone.size) return;
		S.tabs = (S.tabs || []).filter((id) => !gone.has(id));
		if (gone.has(S.activeTabId)) S.activeTabId = null;
		if (gone.has(S.currentPageId)) {
			S.currentPageId = null;
			if (S.view === "page") S.view = "home";
		}
	}

	// Sidebar-Reihenfolge: explizit gesetzte order (per Drag & Drop) hat Vorrang,
	// sonst Erstellzeit — so bleiben Alt-Daten stabil sortiert wie bisher.
	const sortKeyOf = (pg) => (typeof pg.order === "number" ? pg.order : (Date.parse(pg.created) || 0));
	// PERF (10. Juli): childrenOf war O(n) pro Aufruf → Sidebar-Baum O(n²).
	// Parent→Kinder-Index (_childIdx / bustChildIdx am IIFE-Kopf).
	// Sichtbarer Baum = Papierkorb-Filter + Sortierung ÜBER dem gemeinsamen Eltern-Index.
	function ensureChildIdx() {
		if (_childIdx) return _childIdx;
		const m = new Map();
		for (const [parentId, kids] of ensureParentIdx()) {
			for (const pg of kids) {
				if (pg.trashed) continue;
				const k = (pg.workspaceId || "default") + "\0" + parentId;
				let arr = m.get(k);
				if (!arr) { arr = []; m.set(k, arr); }
				arr.push(pg);
			}
		}
		for (const arr of m.values()) {
			arr.sort((a, b) => sortKeyOf(a) - sortKeyOf(b) || (a.created < b.created ? -1 : a.created > b.created ? 1 : 0));
		}
		_childIdx = m;
		return m;
	}
	const childrenOf = (id, wsId) => {
		const k = (wsId || S.currentWorkspaceId || "default") + "\0" + (id || "");
		return (ensureChildIdx().get(k) || []).slice();
	};

	const trashedPages = () => Object.values(S.pages)
		.filter((pg) => pg.trashed)
		.sort((a, b) => ((b.trashedAt || "") < (a.trashedAt || "") ? -1 : (b.trashedAt || "") > (a.trashedAt || "") ? 1 : 0));

	// Alle NICHT im Papierkorb liegenden Seiten — zentrale Quelle für Home,
	// Bibliothek, KI-Systemprompt und Tools, damit Papierkorb-Seiten nirgends durchsickern.
	const activePages = () => Object.values(S.pages).filter((pg) => !pg.trashed);

	// Karteikarten: Soft-Delete analog zu Seiten (trashed / trashedAt).
	const activeCards = () => Object.values(S.cards).filter((c) => !c.trashed);
	const trashedCards = () => Object.values(S.cards)
		.filter((c) => c.trashed)
		.sort((a, b) => ((b.trashedAt || "") < (a.trashedAt || "") ? -1 : (b.trashedAt || "") > (a.trashedAt || "") ? 1 : 0));
	// Nur Wurzel eines gelöschten Stapel-Teilbaums (Unterstapel stecken drin).
	const trashedDeckRoots = () => {
		const names = Object.keys(S.decks).filter((n) => S.decks[n] && S.decks[n].trashed);
		return names
			.filter((n) => !names.some((p) => p !== n && deckInTree(n, p)))
			.sort((a, b) => ((S.decks[b].trashedAt || "") < (S.decks[a].trashedAt || "") ? -1 : (S.decks[b].trashedAt || "") > (S.decks[a].trashedAt || "") ? 1 : 0));
	};
	// Einzelkarten im Papierkorb, die NICHT schon über einen gelöschten Stapel abgedeckt sind.
	const orphanTrashedCards = () => trashedCards().filter((c) => {
		const d = c.deck || "Standard";
		const parts = d.split("::");
		for (let i = parts.length; i >= 1; i--) {
			const path = parts.slice(0, i).join("::");
			if (S.decks[path] && S.decks[path].trashed) return false;
		}
		return true;
	});

	const pageTitles = () => activePages().map((pg) => pg.title);

	// PERF: EIN Durchlauf statt zweier separater .find()-Durchläufe (Exakt- und
	// Teilstring-Treffer), inklusive nur je einmal berechnetem toLowerCase() pro Seite.
	function findPage(title) {
		if (!title) return null;
		const q = String(title).toLowerCase();
		let partial = null;
		for (const pg of activePages()) {
			const t = String(pg.title || "").toLowerCase();
			if (t === q) return pg;
			if (!partial && t.includes(q)) partial = pg;
		}
		return partial;
	}

	// PERF: Der Heuhaufen (Titel + Inhalt + Handschrift-Index, einmal kleingeschrieben)
	// wird granular pro Seite mit Versionsstempel gecacht — Bearbeiten einer Seite
	// invalidiert nur diese eine Seite statt des gesamten Arbeitsbereichs.
	const _hayMap = new Map();
	function haystackOf(pg) {
		let e = _hayMap.get(pg.id);
		const heftOcr = (S.heftMeta[pg.id] && S.heftMeta[pg.id].ocrText) || "";
		if (!e || e.updated !== pg.updated || e.ocr !== heftOcr) {
			// Bei Heften ergänzt der lokale Handschrift-Index die normale Seitensuche.
			const raw = pg.title + "\n" + pg.content + (heftOcr ? "\n" + heftOcr : "");
			// contentLc: nur der Inhalt klein — genau das braucht backlinksOf, das es
			// vorher pro Aufruf für ALLE Seiten neu erzeugt hat.
			e = { updated: pg.updated, ocr: heftOcr, raw, hay: raw.toLowerCase(), title: (pg.title || "").toLowerCase(), contentLc: (pg.content || "").toLowerCase() };
			_hayMap.set(pg.id, e);
		}
		return e;
	}

	function searchNotes(query) {
		const q = String(query).toLowerCase();
		if (!q) return [];
		return activePages().map((pg) => {
			const { raw, hay, title } = haystackOf(pg);
			const idx = hay.indexOf(q);
			if (idx < 0) return null;
			const score = (title.includes(q) ? 10 : 0) + hay.split(q).length - 1;
			return { page: pg, score, snippet: raw.slice(Math.max(0, idx - 80), idx + 160) };
		}).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 8);
	}

	// Tageslimits (wie Anki): heute bereits gelernte neue Karten bzw. Wiederholungen
	// zählen gegen das Limit des jeweiligen Stapels (aus dem Review-Protokoll).
	// Learning/Relearning zählen NICHT gegen new/rev-Limits — sonst endet die
	// Session nach einem Durchlauf, obwohl Minuten-Lernschritte noch offen sind.
	// DRY: Tagesverbrauch (heute gelernte neue Karten/Reviews je Stapel) aus dem
	// Review-Protokoll — war vorher in applyDailyLimits UND computeStudySnapshot
	// identisch dupliziert (jede Regeländerung musste zweimal gemacht werden).
	// Learning/Relearning-Schritte verbrauchen kein Limit (wie Anki).
	function dailyUsageSince(dayStart) {
		const usedNew = {}, usedRev = {};
		// PERF: Rückwärts-Iteration mit Frühabbruch — S.reviews ist chronologisch sortiert.
		// Bei zehntausenden Reviews werden nur die heutigen Einträge geprüft statt des gesamten Verlaufs.
		const cut = dayStart.toISOString();
		const revs = S.reviews || [];
		for (let i = revs.length - 1; i >= 0; i--) {
			const r = revs[i];
			// Importierte Reviews werden beim Replay nicht zwingend chronologisch
			// angehängt. Deshalb darf ein alter Eintrag den Scan nicht abbrechen.
			if (r.t < cut) continue;
			if (r.learning) continue;
			const d = r.deck || ((S.cards[r.cardId] || {}).deck) || "Standard";
			if (r.first) usedNew[d] = (usedNew[d] || 0) + 1;
			else usedRev[d] = (usedRev[d] || 0) + 1;
		}
		return { usedNew, usedRev };
	}

	function applyDailyLimits(cards) {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const { usedNew, usedRev } = dailyUsageSince(today);
		return cards.filter((c) => {
			const st = (c.srs && c.srs.state) || "new";
			if (st === "learning" || st === "relearning") return true;
			const d = c.deck || "Standard";
			const conf = deckConfOf(d);
			if (st === "new") {
				if ((usedNew[d] || 0) >= conf.newPerDay) return false;
				usedNew[d] = (usedNew[d] || 0) + 1;
			} else {
				if ((usedRev[d] || 0) >= conf.revPerDay) return false;
				usedRev[d] = (usedRev[d] || 0) + 1;
			}
			return true;
		});
	}

	// Lokales Tagesende (nächste Mitternacht) — Lernkarten mit due davor zählen noch „heute“.
	function endOfLocalDay(now = new Date()) {
		return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
	}

	function isLearnState(state) {
		return state === "learning" || state === "relearning";
	}

	// Anki-Queue (v3-ähnlich, docs.ankiweb.net):
	// 1) Intraday Learning fällig jetzt (zeitkritisch, kein Review-Limit)
	// 2) Reviews fällig (Tageslimit)
	// 3) New (Tageslimit; standardmäßig blockiert wenn Review-Limit voll)
	// Learn-Ahead: wenn sonst nichts da ist, Learning bis 20 Min vorziehen.
	// „Fertig jetzt“ = keine verfügbare Karte; spätere Learning-Karten heute bleiben geplant.
	const LEARN_AHEAD_MS = 20 * 60e3;
	// Overlearning-Sperre: frisch bewertete Karten erst wieder zeigen, wenn sie wirklich
	// fällig sind (kein vorgezogenes Learn-Ahead-Drillen direkt nach der Bewertung).
	const OVERLEARN_LOCK_MS = 10 * 60e3;

	// PERF (18. Juli): studySnapshot memoiziert — der komplette Queue-Aufbau (Filter,
	// Sortierungen, Tageslimits über alle Karten + Reviews) lief bei jedem Render neu
	// (Home-Widget, Anki-Ansicht, Badges). Cache gilt bis zum nächsten Karten-/Stapel-/
	// Review-/Settings-Event, maximal 2 Sekunden (Fälligkeiten sind zeitabhängig).
	// Aufrufe mit explizitem now umgehen den Cache vollständig (z.B. Tests/Statistik).
	function studySnapshot(deck, now) {
		if (now !== undefined) return computeStudySnapshot(deck, now);
		const key = (deck || "") + "|" + (S.ankiMix ? 1 : 0) + "|" + (localStorage.getItem("impala67Overlearn") || "");
		const t = Date.now();
		if (_snapCache.rev !== _cardRev || t - _snapCache.t > 2000) {
			_snapCache.map.clear();
			_snapCache.rev = _cardRev;
			_snapCache.t = t;
		}
		let snap = _snapCache.map.get(key);
		if (!snap) {
			snap = computeStudySnapshot(deck);
			_snapCache.map.set(key, snap);
		}
		return snap;
	}

	function computeStudySnapshot(deck, now = new Date()) {
		const t = now instanceof Date ? now : new Date(now);
		const eod = endOfLocalDay(t);
		const aheadUntil = new Date(t.getTime() + LEARN_AHEAD_MS);
		// PERF: Fälligkeiten sind ISO-UTC-Strings. Die Schranken EINMAL als String bilden und
		// direkt vergleichen — vorher entstand pro Karte und pro Filterdurchlauf ein new Date().
		const tIso = t.toISOString(), eodIso = eod.toISOString(), aheadIso = aheadUntil.toISOString();
		const inDeck = (c) => {
			if (!c || c.trashed || c.suspended || !c.srs) return false;
			if (!deck) return true;
			const d = c.deck || "Standard";
			return deckInTree(d, deck);
		};
		const byDue = (a, b) => (a.srs.due < b.srs.due ? -1 : a.srs.due > b.srs.due ? 1 : 0);
		const all = Object.values(S.cards).filter(inDeck);

		// Intraday learning: due vor Tagesende und (typisch) Minuten-Schritte
		const learnAll = all.filter((c) => isLearnState(c.srs.state));
		const learnDueNow = learnAll.filter((c) => c.srs.due <= tIso).sort(byDue);
		// Alles, was heute noch offen ist — EINMAL ermittelt. Learn-Ahead und „später heute“
		// sind nur zwei Fenster derselben Liste (vorher drei getrennte Durchläufe, plus ein
		// vierter identischer weiter unten für nextLearnAt).
		const learnWaiting = learnAll.filter((c) => c.srs.due > tIso && c.srs.due < eodIso).sort(byDue);
		const learnAhead = learnWaiting.filter((c) => c.srs.due <= aheadIso);
		// Später heute (nach Learn-Ahead) — Session „finished for now“, nicht „alles morgen“
		const learnLaterToday = learnWaiting.filter((c) => c.srs.due > aheadIso);

		const reviewsRaw = all.filter((c) => c.srs.state === "review" && c.srs.due <= tIso).sort(byDue);
		const newRaw = all.filter((c) => c.srs.state === "new" && c.srs.due <= tIso).sort(byDue);

		// Tagesverbrauch aus Review-Log (wie Anki: first = new) — DRY: dailyUsageSince()
		const dayStart = new Date(t.getFullYear(), t.getMonth(), t.getDate());
		const { usedNew, usedRev } = dailyUsageSince(dayStart);
		const takeLimited = (list, kind) => {
			const out = [];
			for (const c of list) {
				const d = c.deck || "Standard";
				const conf = deckConfOf(d);
				if (kind === "new") {
					// Anki default: New blockiert wenn Review-Limit erreicht
					if ((usedRev[d] || 0) >= conf.revPerDay) continue;
					if ((usedNew[d] || 0) >= conf.newPerDay) continue;
					usedNew[d] = (usedNew[d] || 0) + 1;
				} else {
					if ((usedRev[d] || 0) >= conf.revPerDay) continue;
					usedRev[d] = (usedRev[d] || 0) + 1;
				}
				out.push(c);
			}
			return out;
		};
		const limitedRev = takeLimited(reviewsRaw, "rev");
		const limitedNew = takeLimited(newRaw, "new");

		// Overlearning-Sperre: frisch bewertete Karten (< 10 Min) nicht vorzeitig per
		// Learn-Ahead zeigen — sofortiges Nochmal-Drillen füttert nur das Kurzzeit-
		// gedächtnis („Illusion of Competence“). Wirklich fällige Karten sperrt das nie.
		// PERF: Rückwärts-Iteration mit Frühabbruch
		const lockCutIso = new Date(t.getTime() - OVERLEARN_LOCK_MS).toISOString();
		const freshRated = new Set();
		const revs = S.reviews || [];
		for (let i = revs.length - 1; i >= 0; i--) {
			const r = revs[i];
			if (r.t <= lockCutIso) break;
			freshRated.add(r.cardId);
		}
		const lockOn = localStorage.getItem("impala67Overlearn") !== "off"; // Einstellung: Overlearning-Sperre
		const aheadFree = lockOn ? learnAhead.filter((c) => !freshRated.has(c.id)) : learnAhead.slice();
		const lockedAhead = learnAhead.length - aheadFree.length;

		// Interleaved Practice („Gemischt lernen“): Reviews+New stapelübergreifend
		// deterministisch mischen (Hash aus Karten-ID + Tag → stabil über Re-Render,
		// Tastatur und Klick sehen dieselbe Karte).
		let revNew = limitedRev.concat(limitedNew);
		if (S.ankiMix) {
			const day = t.toISOString().slice(0, 10);
			const mixKey = (id) => {
				let h = 0;
				const str = id + day;
				for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
				return h;
			};
			revNew = revNew.slice().sort((a, b) => mixKey(a.id) - mixKey(b.id));
		}

		// Normale Queue: Learning jetzt → Reviews → New (Learning nie limitiert)
		let dueNow = learnDueNow.concat(revNew);
		// Learn-Ahead nur wenn sonst die Queue leer wäre (Anki-Default 20 Min)
		if (!dueNow.length && aheadFree.length) dueNow = aheadFree.slice();

		// learnWaiting ist bereits nach Fälligkeit sortiert — der erste Eintrag IST der nächste.
		const nextLearnAt = learnWaiting.length ? new Date(learnWaiting[0].srs.due) : null;

		// verfügbar jetzt (inkl. Learn-Ahead) — „finished for now" wenn leer
		const available = dueNow.length > 0;

		return {
			dueNow,
			learnDue: learnDueNow,
			learnWaiting,
			learnLaterToday,
			reviewsDue: limitedRev,
			newDue: limitedNew,
			counts: {
				// Anki-Übersicht: New | Learning | Review (Learning = alle offenen Lernschritte heute)
				learn: learnDueNow.length + learnWaiting.length,
				learnNow: learnDueNow.length,
				learnWaiting: learnWaiting.length,
				review: limitedRev.length,
				neu: limitedNew.length,
				total: dueNow.length + (available ? 0 : learnWaiting.length),
			},
			nextLearnAt,
			lockedAhead,
			// done = wirklich nichts mehr heute (auch keine späteren Lernschritte)
			done: !available && learnWaiting.length === 0,
			// finishedForNow = Anki „finished this deck for now" (später heute noch Learning)
			finishedForNow: !available,
			available,
			now: t,
			endOfDay: eod,
			learnAheadMs: LEARN_AHEAD_MS,
		};
	}

	// .slice(): Aufrufer dürfen das Ergebnis verändern, ohne den Cache zu beschädigen.
	const dueCards = () => studySnapshot(null).dueNow.slice();

	// Backlinks: Seiten, die die Zielseite per Titel erwähnen — bewusst einfacher
	// Volltext-Scan, reicht für lokale Datenmengen völlig aus.
	function backlinksOf(pageId) {
		const target = S.pages[pageId];
		if (!target || !target.title || target.title === "Ohne Titel") return [];
		// PERF (18. Juli): memoiziert bis zum nächsten seitenrelevanten Event —
		// vorher lief der Volltext-Scan über ALLE Seiten bei jedem Render erneut.
		if (_backlinkCache.rev !== _pageRev) { _backlinkCache.map.clear(); _backlinkCache.rev = _pageRev; }
		const cached = _backlinkCache.map.get(pageId);
		if (cached) return cached.slice();
		const t = target.title.toLowerCase();
		// PERF: kleingeschriebener Inhalt aus dem Haystack-Cache (gleiche Invalidierung
		// über _pageRev) — Suche und Backlinks teilen sich ab jetzt EINEN Textindex.
		const result = activePages().filter((pg) => pg.id !== pageId && haystackOf(pg).contentLc.includes(t));
		_backlinkCache.map.set(pageId, result);
		return result.slice();
	}

	// Seitenverlauf: rekonstruiert alle früheren Versionen einer Seite aus dem
	// Event-Log (Titel-/Inhaltsänderungen). Das Log ist append-only — der Verlauf
	// ist also vollständig, ohne dass extra Snapshots gespeichert werden müssen.
	async function pageHistory(pageId) {
		const evs = await loadSortedEvents();
		const versions = [];
		let cur = null;
		for (const ev of evs) {
			const p = ev.payload || {};
			if (ev.type === "pageCreate" && p.id === pageId) {
				cur = { title: p.title || "Ohne Titel", content: p.content || "" };
				versions.push({ t: ev.t, title: cur.title, content: cur.content });
			} else if (ev.type === "pageUpdate" && p.id === pageId && cur) {
				const patch = p.patch || {};
				if ("title" in patch || "content" in patch) {
					cur = {
						title: patch.title !== undefined ? patch.title : cur.title,
						content: patch.content !== undefined ? patch.content : cur.content,
					};
					versions.push({ t: ev.t, title: cur.title, content: cur.content });
				}
			}
		}
		return versions;
	}

	return { onChange: null, reduce, dispatch, applyRemoteEvents, onBeforeDispatch, onAfterDispatch, onRemoteApplied, load, loadedSeq: getLoadedSeq, loadedTime: getLoadedTime, snapshotInfo: () => ({ maxSeq: _loadedSeq, maxTime: _loadedTime }), migrateLegacySecretsToSync, childrenOf, pageSubtreeIds, pageInTree, deckInTree, sortKeyOf, trashedPages, activePages, activeCards, trashedCards, trashedDeckRoots, orphanTrashedCards, pageTitles, findPage, searchNotes, dueCards, applyDailyLimits, studySnapshot, endOfLocalDay, isLearnState, deckConfOf, backlinksOf, pageHistory };
})();
