"use strict";
import { U } from "./util.js";
import { DB } from "./db.js";
import { SRS } from "./srs.js";
// state.js — In-Memory-Zustand, aufgebaut durch Abspielen des Event-Logs.
// Jede Änderung ist ein Event: reduce() wendet es an, dispatch() persistiert es.
export const S = {
	pages: {},   // id → { id, title, parentId, content, pdfId, tags, icon, cover, created, updated }
	cards: {},   // id → { id, front, back, pageId, srs, created }
	settings: {
		aiProviders: [
			{ id: "google", name: "Google Gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai", key: "" },
			{ id: "openai", name: "OpenAI", base: "https://api.openai.com/v1", key: "" },
			{ id: "local", name: "Lokal (LM Studio)", base: "http://localhost:1234/v1", key: "" },
		],
		aiProviderId: "local",
		aiModel: "",
		thinkingLevel: "auto", // "auto" | "low" | "medium" | "high" — wird nur an unterstützte APIs übergeben
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
	decks: { Standard: { name: "Standard", created: "" } }, // Karteikarten-Stapel; Unterstapel per "Eltern::Kind"-Namensschema
	workspaces: { default: { id: "default", name: "Privat", created: "" } },
	// Reiner UI-Zustand (nicht persistiert):
	chat: [], // Haupt-Chatverlauf (Vollbild-Tab)
	sideChat: [], // Verlauf für das kleine KI-Seitenpanel
	sideChatId: null, // eigene gespeicherte Chat-Sitzung des Seitenpanels
	aiActiveChatType: "side", // "side" | "full"
	highlightedPageId: null, // Für die Hervorhebung geänderter Blöcke
	highlightedDiff: null, // Diff-Array für die Hervorhebung geänderter Blöcke
	currentPageId: null,
	currentWorkspaceId: "default",
	view: "home", // "home" | "page" | "library" | "chat" | "anki" | "daily" | "trash"
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

	// ---- Stapel-Helfer: ein Stapel-Teilbaum ("Eltern::Kind") + seine Karten ----
	// (dedupliziert die vorher vierfach kopierte Logik der deck*-Events)
	const deckSubtree = (from) => Object.keys(S.decks).filter((n) => n === from || n.startsWith(from + "::"));
	const cardsInDeckTree = (from) => Object.values(S.cards).filter((c) => {
		const d = c.deck || "Standard";
		return d === from || d.startsWith(from + "::");
	});
	function renameDeckTree(from, to) {
		deckSubtree(from).forEach((n) => {
			const nn = to + n.slice(from.length);
			S.decks[nn] = { ...S.decks[n], name: nn };
			delete S.decks[n];
		});
		cardsInDeckTree(from).forEach((c) => { c.deck = to + (c.deck || "Standard").slice(from.length); });
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

	// ---- Geheimnisse (API-Keys, Notion-Token) — pro Gerät in localStorage ----
	// Sie gehören NICHT ins Event-Log: das Log wandert in Exporte + Drive-Sync.
	function loadSecrets() {
		// Fallback auf den alten Schlüssel (Projekt hieß früher "notion") — Keys bleiben so erhalten.
		try { return JSON.parse(localStorage.getItem("impala67.secrets") || localStorage.getItem("notion.secrets") || "{}"); } catch { return {}; }
	}
	function stripSecrets(payload) {
		const sec = loadSecrets();
		const p = { ...payload };
		if ("notionToken" in p) { sec.notionToken = p.notionToken || ""; p.notionToken = ""; }
		if ("corsProxy" in p) { sec.corsProxy = p.corsProxy || ""; p.corsProxy = ""; }
		// FIX (Audit): Desktop-OAuth-Secret gehörte bisher ins Event-Log/Export — wie andere Secrets nur pro Gerät in localStorage.
		if ("driveDesktopClientSecret" in p) { sec.driveDesktopClientSecret = p.driveDesktopClientSecret || ""; p.driveDesktopClientSecret = ""; }
		if (Array.isArray(p.aiProviders)) {
			sec.providerKeys = {};
			p.aiProviders = p.aiProviders.map((pr) => {
				if (pr.key) sec.providerKeys[pr.id] = pr.key;
				return { ...pr, key: "" };
			});
		}
		try { localStorage.setItem("impala67.secrets", JSON.stringify(sec)); } catch (e) { console.warn(e); }
		return p;
	}
	function applySecrets() {
		const sec = loadSecrets();
		if (sec.notionToken) S.settings.notionToken = sec.notionToken;
		if (sec.corsProxy) S.settings.corsProxy = sec.corsProxy;
		if (sec.driveDesktopClientSecret) S.settings.driveDesktopClientSecret = sec.driveDesktopClientSecret;
		(S.settings.aiProviders || []).forEach((pr) => {
			if (sec.providerKeys && sec.providerKeys[pr.id]) pr.key = sec.providerKeys[pr.id];
		});
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
					order: typeof p.order === "number" ? p.order : null,
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
				while (anc && hops++ < 10000) {
					if (anc === p.id) { ok = false; break; }
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
				break;
			case "cardReview": {
				const c = S.cards[p.id];
				const wasNew = !!(c && c.srs && c.srs.state === "new");
				// FIX: fehlende Validierung — ohne srs-Payload den Kartenstand nicht zerstören
				// (c.srs = undefined hätte die Karte bisher klaglos kaputt gemacht).
				if (c && p.srs) {
					c.srs = p.srs;
					// Leech-Erkennung (wie Anki): fällt eine Karte zu oft durch, wird sie
					// markiert und — je nach Stapel-Option — automatisch ausgesetzt.
					const conf = deckConfOf(c.deck);
					if ((p.grade || 0) === 1 && (c.srs.lapses || 0) >= conf.leechThreshold) {
						c.leech = true;
						if (conf.leechAction === "suspend") c.suspended = true;
					}
				}
				// Protokoll für Statistik/Heatmap/Retention + Tageslimits (first = war neue Karte) —
				// bewusst unabhängig davon, ob die Karte noch existiert (Statistik bleibt vollständig).
				S.reviews.push({ cardId: p.id, t: ev.t, grade: p.grade || 0, first: wasNew });
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
					if (S.reviews[i].cardId === p.id) { S.reviews.splice(i, 1); break; }
				}
				break;
			}
			case "cardUpdate": {
				const c = S.cards[p.id];
				if (c) Object.assign(c, p.patch);
				break;
			}
			case "cardDelete":
				delete S.cards[p.id];
				break;
			case "deckCreate":
				// FIX: fehlende Validierung — ohne Namen keinen Stapel anlegen.
				if (!p.name) break;
				S.decks[p.name] = { name: p.name, created: ev.t };
				break;
			case "deckRename":
				// Benennt den Stapel samt aller Unterstapel um und zieht die Karten mit.
				renameDeckTree(p.from, p.to);
				break;
			case "deckDelete":
				// Löscht Stapel + Unterstapel; deren Karten wandern in "Standard" (nichts geht verloren).
				deckSubtree(p.name).forEach((n) => delete S.decks[n]);
				cardsInDeckTree(p.name).forEach((c) => { c.deck = "Standard"; });
				break;
			case "deckMove": {
				// Verschiebt einen Stapel samt Unterstapeln + Karten unter ein neues Eltern-Deck.
				const to = ((p.target || "") ? p.target + "::" : "") + p.from.split("::").pop();
				if (to !== p.from) renameDeckTree(p.from, to);
				break;
			}
			case "deckDuplicate": {
				const from = p.name;
				const prefix = from.includes("::") ? from.slice(0, from.lastIndexOf("::") + 2) : "";
				const to = prefix + from.split("::").pop() + " (Kopie)";
				deckSubtree(from).forEach((n) => {
					const nn = to + n.slice(from.length);
					S.decks[nn] = { name: nn, created: ev.t };
				});
				cardsInDeckTree(from).forEach((c) => {
					const id = U.uid();
					S.cards[id] = { ...c, id, deck: to + (c.deck || "Standard").slice(from.length), srs: SRS.newCard(ev.t), created: ev.t };
				});
				break;
			}
			case "workspaceCreate":
				// FIX: fehlende Validierung — ohne id keinen Workspace anlegen.
				if (!p.id) break;
				S.workspaces[p.id] = { id: p.id, name: p.name || "Workspace", created: ev.t };
				break;
			case "settingsSet":
				Object.assign(S.settings, p);
				break;
		}
	}

	async function dispatchOne(type, payload) {
		if (type === "settingsSet") payload = stripSecrets(payload);
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
		applySecrets(); // Keys liegen pro Gerät in localStorage, nicht im Log
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
			const raw = pg.title + "\n" + pg.content;
			const hay = raw.toLowerCase();
			const idx = hay.indexOf(q);
			if (idx < 0) return null;
			const score = (pg.title.toLowerCase().includes(q) ? 10 : 0) + hay.split(q).length - 1;
			return { page: pg, score, snippet: raw.slice(Math.max(0, idx - 80), idx + 160) };
		}).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 8);
	}

	// Tageslimits (wie Anki): heute bereits gelernte neue Karten bzw. Wiederholungen
	// zählen gegen das Limit des jeweiligen Stapels (aus dem Review-Protokoll).
	function applyDailyLimits(cards) {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const usedNew = {}, usedRev = {};
		(S.reviews || []).forEach((r) => {
			if (new Date(r.t) < today) return;
			const c = S.cards[r.cardId];
			const d = c ? (c.deck || "Standard") : "Standard";
			if (r.first) usedNew[d] = (usedNew[d] || 0) + 1;
			else usedRev[d] = (usedRev[d] || 0) + 1;
		});
		return cards.filter((c) => {
			const d = c.deck || "Standard";
			const conf = deckConfOf(d);
			if (c.srs.state === "new") {
				if ((usedNew[d] || 0) >= conf.newPerDay) return false;
				usedNew[d] = (usedNew[d] || 0) + 1;
			} else {
				if ((usedRev[d] || 0) >= conf.revPerDay) return false;
				usedRev[d] = (usedRev[d] || 0) + 1;
			}
			return true;
		});
	}

	const dueCards = () => applyDailyLimits(Object.values(S.cards)
		.filter((c) => !c.suspended && new Date(c.srs.due) <= new Date())
		.sort((a, b) => a.srs.due.localeCompare(b.srs.due)));

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

	return { onChange: null, reduce, dispatch, load, childrenOf, sortKeyOf, trashedPages, activePages, pageTitles, findPage, searchNotes, dueCards, applyDailyLimits, deckConfOf, backlinksOf, pageHistory };
})();