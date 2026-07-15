"use strict";
import { U } from "./util.js";
import { DB } from "./db.js";
import { SRS } from "./srs.js";
// state.js — In-Memory-Zustand, aufgebaut durch Abspielen des Event-Logs.
// Jede Änderung ist ein Event: reduce() wendet es an, dispatch() persistiert es.
export const S = {
	pages: {},   // id → { id, title, parentId, content, pdfId, tags, icon, cover, created, updated }
	cards: {},   // id → { id, front, back, pageId, srs, created }
	grades: {},  // id → { id, subject, grade, weight, date, comment, created }
	learningSessions: {}, // id → { id, startedAt, endedAt, durationSeconds, category, sourceId, updated, deleted? }
	chatSessions: {}, // id → { id, title, messages, created, updated, deleted? } — Drive-synchronisiert
	settings: {
		aiProviders: [
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
		driveClientId: "100283147644-1ra4er2dc5r85k3mefd521hbm1ek3qpf.apps.googleusercontent.com",
		customInstructions: "",
		notionToken: "", // Notion-Integrationstoken für Import + Zwei-Wege-Sync
		notionPageId: "", // Wurzelseite in Notion, unter der lokale neue Seiten entstehen
		notionMap: {}, // lokale Seiten-ID → Notion-Seiten-ID (für lokal erstellte Seiten)
		notionMeta: {}, // Sync-Gedächtnis je Notion-Seite: { r: Remote-Stand, l: lokaler Stand } beim letzten Abgleich — verhindert Ping-Pong-Übertragungen
		notionLastSync: "", // Zeitstempel des letzten Zwei-Wege-Syncs
		corsProxy: "", // eigener CORS-Proxy für den Notion-Sync (leer = öffentlicher corsproxy.io)
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
	highlightedPageId: null, // Für die Hervorhebung geänderter Blöcke
	highlightedDiff: null, // Diff-Array für die Hervorhebung geänderter Blöcke
	currentPageId: null,
	currentWorkspaceId: "default",
	view: "home", // "home" | "page" | "library" | "chat" | "anki" | "noten" | "daily" | "trash"
	chatFull: false,
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
	heftMeta: {}, // GoodNotes-Hefte: pageId → { rev, pages, bytes, updated } — Inhalt liegt als Blob heft:<pageId> in IndexedDB
};

export const STATE = (() => {
	// PERF (10. Juli): Parent→Kinder-Index für childrenOf (Sidebar-Baum war O(n²)).
	// Vor reduce deklariert, damit Invalidierung im Hot Path greift.
	let _childIdx = null;
	function bustChildIdx() { _childIdx = null; }

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

	// ---- Stapel-Helfer: ein Stapel-Teilbaum ("Eltern::Kind") + seine Karten ----
	// (dedupliziert die vorher vierfach kopierte Logik der deck*-Events)
	const deckSubtree = (from) => Object.keys(S.decks).filter((n) => n === from || n.startsWith(from + "::"));
	// includeTrashed: Rename/Move/Purge brauchen alle Karten; Lernen/UI nur aktive.
	const cardsInDeckTree = (from, opts) => Object.values(S.cards).filter((c) => {
		if (!(opts && opts.includeTrashed) && c.trashed) return false;
		const d = c.deck || "Standard";
		return d === from || d.startsWith(from + "::");
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

	// ---- Zugangsdaten im persönlichen Drive-Sync ----------------------------
	// Auf ausdrücklichen Wunsch gehören API-Keys, Notion-Token, CORS-Proxy und
	// Desktop-OAuth-Konfiguration in den verschlüsselungslosen, aber privaten
	// appDataFolder des eigenen Google-Kontos. Sie werden daher wie alle anderen
	// settingsSet-Daten im Event-Log gespeichert und auf andere Geräte repliziert.
	// Die alte localStorage-Ablage bleibt nur als einmalige Migrationsquelle.
	function loadLegacySecrets() {
		try { return JSON.parse(localStorage.getItem("impala67.secrets") || localStorage.getItem("notion.secrets") || "{}"); } catch { return {}; }
	}
	function stripSecrets(payload) { return { ...payload }; }
	function applySecrets() { /* Credentials kommen jetzt direkt aus dem Event-Log. */ }
	async function migrateLegacySecretsToSync() {
		const sec = loadLegacySecrets();
		const patch = {};
		if (sec.notionToken && !S.settings.notionToken) patch.notionToken = sec.notionToken;
		if (sec.corsProxy && !S.settings.corsProxy) patch.corsProxy = sec.corsProxy;
		if (sec.driveDesktopClientSecret && !S.settings.driveDesktopClientSecret) patch.driveDesktopClientSecret = sec.driveDesktopClientSecret;
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

	function reduce(ev) {
		const p = ev.payload || {};
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
				Object.assign(pg, p.patch);
				pg.updated = ev.t;
				break;
			}
			case "pageMove": {
				bustChildIdx();
				const pg = S.pages[p.id];
				if (!pg) break;
				// Zyklus-Schutz: eine Seite darf nie unter sich selbst oder einen eigenen
				// Nachfahren wandern (führte zu Endlos-Rekursion, z.B. beim Papierkorb).
				let anc = p.parentId, ok = true, hops = 0;
				while (anc) {
					if (anc === p.id) { ok = false; break; }
					// Defensiv: bricht die Ahnen-Suche wegen eines Zyklus in Alt-Daten am
					// Hops-Limit ab, den Move ABLEHNEN — vorher blieb ok = true und der
					// Move wurde trotz nicht prüfbarer Hierarchie angewendet.
					if (++hops > 10000) { ok = false; break; }
					anc = (S.pages[anc] || {}).parentId || null;
				}
				if (ok) pg.parentId = p.parentId || null;
				// Manuelle Sortierung per Drag & Drop: order wird beim Verschieben mitgesetzt
				if (ok && typeof p.order === "number") pg.order = p.order;
				break;
			}
			case "pageDelete":
				bustChildIdx();
				Object.values(S.pages).forEach((pg) => {
					if (pg.parentId === p.id) pg.parentId = null; // Kinder wandern auf Root
				});
				delete S.heftMeta[p.id]; // Heft-Metadaten mit aufräumen
				delete S.pages[p.id];
				break;
			case "pageTrash":
				bustChildIdx();
				// Wie in Notion: die ganze Unterseiten-Struktur wandert zusammen in den Papierkorb.
				collectSubtree(p.id).forEach((id) => {
					const pg = S.pages[id];
					if (pg) { pg.trashed = true; pg.trashedAt = ev.t; }
				});
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
					category: p.category || "other",
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
					grade: p.grade || 0, first: wasNew, learning: wasLearning });
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
				if (target === p.from || target.startsWith(p.from + "::")) break;
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
					const id = U.uid();
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
					order: typeof p.order === "number" ? p.order : Date.now(),
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
			case "heftUpdated":
				// GoodNotes-Heft gespeichert: nur Metadaten im Log (Badges, Bibliothek, Sync) —
				// die Striche selbst liegen als EIN Blob heft:<pageId> in IndexedDB.
				if (!p.pageId) break;
				S.heftMeta[p.pageId] = { rev: p.rev || 1, pages: p.pages || 1, bytes: p.bytes || 0, ocrText: p.ocrText || "", updated: ev.t };
				if (S.pages[p.pageId]) S.pages[p.pageId].updated = ev.t;
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
				// Seiten, NotebookLM UND Chats sind synchronisierte Tabs. Ein Chat-Tab
				// ist nur gültig, wenn seine (ebenfalls synchronisierte) Sitzung existiert.
				const seen = new Set();
				S.tabs = (Array.isArray(p.tabs) ? p.tabs : []).filter((id) => {
					if (typeof id !== "string" || seen.has(id)) return false;
					seen.add(id);
					if (id.startsWith("chat:")) {
						const chat = S.chatSessions[id.slice(5)];
						return !!(chat && !chat.deleted);
					}
					return !!(S.pages[id] && !S.pages[id].trashed) || id === "nlm:main";
				}).slice(-12);
				S.activeTabId = S.tabs.includes(p.activeTabId) ? p.activeTabId : (S.tabs[S.tabs.length - 1] || null);
				break;
			}
			case "settingsSet":
				Object.assign(S.settings, p);
				break;
		}
	}

	async function dispatchOne(type, payload) {
		if (type === "settingsSet") payload = stripSecrets(payload);
		for (const fn of _dispatchHooks.before) {
			try { fn(type, payload); } catch (e) { console.warn("dispatch-Hook (before):", e); }
		}
		const ev = { id: U.uid(), t: U.now(), type, payload };
		// Erst persistieren, dann anwenden — sonst zeigt die UI bei einem
		// Speicherfehler (z.B. Quota voll) Änderungen, die nie gespeichert wurden.
		try {
			await DB.addEvent(ev);
		} catch (e) {
			alert("Speichern fehlgeschlagen (Speicherplatz voll?): " + (e && e.message ? e.message : e));
			throw e;
		}
		reduce(ev);
		if (type === "settingsSet") applySecrets();
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

	// Gemeinsamer Helfer für load()/pageHistory(): Event-Log laden und deterministisch
	// sortieren (vorher in beiden Funktionen fast identisch dupliziert).
	async function loadSortedEvents() {
		const evs = await DB.allEvents();
		// Deterministisch: nach Zeitstempel, dann lokaler Sequenz
		evs.sort((a, b) => a.t.localeCompare(b.t) || (a.seq || 0) - (b.seq || 0));
		return evs;
	}

	async function load() {
		const evs = await loadSortedEvents();
		evs.forEach(reduce);
		applySecrets(); // Kompatibilitäts-Hook; Zugangsdaten liegen im Event-Log.
	}

	// Sammelt eine Seite und alle ihre Nachfahren (für Papierkorb: die ganze
	// Unterseiten-Struktur wandert gemeinsam rein bzw. wieder raus).
	// PERF (10. Juli): baut EINMAL eine Eltern→Kinder-Liste über alle Seiten auf,
	// statt bei jedem rekursiven Schritt erneut komplett über S.pages zu scannen
	// (vorher O(n²) im Worst Case bei tiefen/breiten Bäumen). Iterativ mit einem
	// Stack statt Rekursion, Zyklen-Schutz wie zuvor über ein Set.
	function collectSubtree(id) {
		const byParent = new Map();
		for (const pg of Object.values(S.pages)) {
			const key = pg.parentId || null;
			let kids = byParent.get(key);
			if (!kids) { kids = []; byParent.set(key, kids); }
			kids.push(pg.id);
		}
		const result = [];
		const visited = new Set();
		const stack = [id];
		while (stack.length) {
			const cur = stack.pop();
			if (visited.has(cur)) continue; // Sicherheitsnetz gegen Zyklen in Alt-Daten
			visited.add(cur);
			result.push(cur);
			const kids = byParent.get(cur);
			if (kids) stack.push(...kids);
		}
		return result;
	}

	// Sidebar-Reihenfolge: explizit gesetzte order (per Drag & Drop) hat Vorrang,
	// sonst Erstellzeit — so bleiben Alt-Daten stabil sortiert wie bisher.
	const sortKeyOf = (pg) => (typeof pg.order === "number" ? pg.order : (Date.parse(pg.created) || 0));
	// PERF (10. Juli): childrenOf war O(n) pro Aufruf → Sidebar-Baum O(n²).
	// Parent→Kinder-Index (_childIdx / bustChildIdx am IIFE-Kopf).
	function ensureChildIdx() {
		if (_childIdx) return _childIdx;
		const m = new Map();
		for (const pg of Object.values(S.pages)) {
			if (pg.trashed) continue;
			const k = (pg.workspaceId || "default") + "\0" + (pg.parentId || "");
			let arr = m.get(k);
			if (!arr) { arr = []; m.set(k, arr); }
			arr.push(pg);
		}
		for (const arr of m.values()) {
			arr.sort((a, b) => sortKeyOf(a) - sortKeyOf(b) || a.created.localeCompare(b.created));
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
		.sort((a, b) => (b.trashedAt || "").localeCompare(a.trashedAt || ""));

	// Alle NICHT im Papierkorb liegenden Seiten — zentrale Quelle für Home,
	// Bibliothek, KI-Systemprompt und Tools, damit Papierkorb-Seiten nirgends durchsickern.
	const activePages = () => Object.values(S.pages).filter((pg) => !pg.trashed);

	// Karteikarten: Soft-Delete analog zu Seiten (trashed / trashedAt).
	const activeCards = () => Object.values(S.cards).filter((c) => !c.trashed);
	const trashedCards = () => Object.values(S.cards)
		.filter((c) => c.trashed)
		.sort((a, b) => (b.trashedAt || "").localeCompare(a.trashedAt || ""));
	// Nur Wurzel eines gelöschten Stapel-Teilbaums (Unterstapel stecken drin).
	const trashedDeckRoots = () => {
		const names = Object.keys(S.decks).filter((n) => S.decks[n] && S.decks[n].trashed);
		return names
			.filter((n) => !names.some((p) => p !== n && n.startsWith(p + "::")))
			.sort((a, b) => (S.decks[b].trashedAt || "").localeCompare(S.decks[a].trashedAt || ""));
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
			const t = pg.title.toLowerCase();
			if (t === q) return pg;
			if (!partial && t.includes(q)) partial = pg;
		}
		return partial;
	}

	function searchNotes(query) {
		const q = String(query).toLowerCase();
		if (!q) return [];
		return activePages().map((pg) => {
			// FIX: "title + \n + content" wurde vorher zweimal berechnet (einmal für hay,
			// einmal für raw) — jetzt nur noch einmal.
			// Bei Heften ergänzt der lokal gespeicherte Handschrift-Index die normale
			// Seitensuche. Das Ergebnis bleibt eine reguläre Seiten-Fundstelle.
			const raw = pg.title + "\n" + pg.content + "\n" + ((S.heftMeta[pg.id] && S.heftMeta[pg.id].ocrText) || "");
			const hay = raw.toLowerCase();
			const idx = hay.indexOf(q);
			if (idx < 0) return null;
			const score = (pg.title.toLowerCase().includes(q) ? 10 : 0) + hay.split(q).length - 1;
			return { page: pg, score, snippet: raw.slice(Math.max(0, idx - 80), idx + 160) };
		}).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 8);
	}

	// Tageslimits (wie Anki): heute bereits gelernte neue Karten bzw. Wiederholungen
	// zählen gegen das Limit des jeweiligen Stapels (aus dem Review-Protokoll).
	// Learning/Relearning zählen NICHT gegen new/rev-Limits — sonst endet die
	// Session nach einem Durchlauf, obwohl Minuten-Lernschritte noch offen sind.
	function applyDailyLimits(cards) {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const usedNew = {}, usedRev = {};
		(S.reviews || []).forEach((r) => {
			if (new Date(r.t) < today) return;
			if (r.learning) return; // Lern-/Relearning-Schritte verbrauchen kein Review-Limit.
			const d = r.deck || ((S.cards[r.cardId] || {}).deck) || "Standard";
			if (r.first) usedNew[d] = (usedNew[d] || 0) + 1;
			else usedRev[d] = (usedRev[d] || 0) + 1;
		});
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

	function studySnapshot(deck, now = new Date()) {
		const t = now instanceof Date ? now : new Date(now);
		const eod = endOfLocalDay(t);
		const aheadUntil = new Date(t.getTime() + LEARN_AHEAD_MS);
		const inDeck = (c) => {
			if (!c || c.trashed || c.suspended || !c.srs) return false;
			if (!deck) return true;
			const d = c.deck || "Standard";
			return d === deck || d.startsWith(deck + "::");
		};
		const byDue = (a, b) => a.srs.due.localeCompare(b.srs.due);
		const all = Object.values(S.cards).filter(inDeck);

		// Intraday learning: due vor Tagesende und (typisch) Minuten-Schritte
		const learnAll = all.filter((c) => isLearnState(c.srs.state));
		const learnDueNow = learnAll.filter((c) => new Date(c.srs.due) <= t).sort(byDue);
		// Noch nicht fällig, aber innerhalb Learn-Ahead (nur wenn sonst nichts zu tun)
		const learnAhead = learnAll
			.filter((c) => {
				const d = new Date(c.srs.due);
				return d > t && d <= aheadUntil && d < eod;
			})
			.sort(byDue);
		// Später heute (nach Learn-Ahead) — Session „finished for now“, nicht „alles morgen“
		const learnLaterToday = learnAll
			.filter((c) => {
				const d = new Date(c.srs.due);
				return d > aheadUntil && d < eod;
			})
			.sort(byDue);

		const reviewsRaw = all.filter((c) => c.srs.state === "review" && new Date(c.srs.due) <= t).sort(byDue);
		const newRaw = all.filter((c) => c.srs.state === "new" && new Date(c.srs.due) <= t).sort(byDue);

		// Tagesverbrauch aus Review-Log (wie Anki: first = new)
		const dayStart = new Date(t.getFullYear(), t.getMonth(), t.getDate());
		const usedNew = {}, usedRev = {};
		(S.reviews || []).forEach((r) => {
			if (new Date(r.t) < dayStart) return;
			if (r.learning) return; // Lern-/Relearning-Schritte verbrauchen kein Review-Limit.
			const d = r.deck || ((S.cards[r.cardId] || {}).deck) || "Standard";
			if (r.first) usedNew[d] = (usedNew[d] || 0) + 1;
			else usedRev[d] = (usedRev[d] || 0) + 1;
		});
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

		// Normale Queue: Learning jetzt → Reviews → New (Learning nie limitiert)
		let dueNow = learnDueNow.concat(limitedRev).concat(limitedNew);
		// Learn-Ahead nur wenn sonst die Queue leer wäre (Anki-Default 20 Min)
		if (!dueNow.length && learnAhead.length) dueNow = learnAhead.slice();

		const nextLearnAt = (() => {
			const pool = learnAll
				.filter((c) => new Date(c.srs.due) > t && new Date(c.srs.due) < eod)
				.sort(byDue);
			return pool.length ? new Date(pool[0].srs.due) : null;
		})();

		// verfügbar jetzt (inkl. Learn-Ahead) — „finished for now" wenn leer
		const available = dueNow.length > 0;
		const learnWaiting = learnAll
			.filter((c) => new Date(c.srs.due) > t && new Date(c.srs.due) < eod)
			.sort(byDue);

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

	const dueCards = () => studySnapshot(null).dueNow;

	// Backlinks: Seiten, die die Zielseite per Titel erwähnen — bewusst einfacher
	// Volltext-Scan, reicht für lokale Datenmengen völlig aus.
	function backlinksOf(pageId) {
		const target = S.pages[pageId];
		if (!target || !target.title || target.title === "Ohne Titel") return [];
		const t = target.title.toLowerCase();
		return activePages().filter((pg) => pg.id !== pageId && (pg.content || "").toLowerCase().includes(t));
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

	return { onChange: null, reduce, dispatch, onBeforeDispatch, onAfterDispatch, load, migrateLegacySecretsToSync, childrenOf, sortKeyOf, trashedPages, activePages, activeCards, trashedCards, trashedDeckRoots, orphanTrashedCards, pageTitles, findPage, searchNotes, dueCards, applyDailyLimits, studySnapshot, endOfLocalDay, isLearnState, deckConfOf, backlinksOf, pageHistory };
})();