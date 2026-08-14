"use strict";
import { CHATS } from "./chats.js";
import { COLLAPSE } from "./collapse.js";
import { DB } from "./db.js";
import { EDITOR } from "./editor.js";
import { PDFS } from "./pdfs.js";
import { RENDER_ANKI } from "./render-anki.js";
import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { SETTINGS } from "./settings.js";
import { LIBRARY } from "./library.js";
import { NLM } from "./notebooklm.js";
import { POPOVERS } from "./popovers.js";
import { HEFT } from "./heft.js";
import { LERNZEIT } from "./lernzeit.js";
import { SCHULNOTEN } from "./schulnoten.js";

const esc = (s) => U.esc(s);
const $ = (id) => U.el(id);
const lsGet = (k, fb) => U.storage.getJson(k, fb);
const lsSet = (k, v) => U.storage.setJson(k, v);
function openOverlay(html) {
	const o = $("overlay");
	if (!o) return null;
	o.hidden = false;
	o.innerHTML = html;
	return o;
}

const deckTreeHtml = (...a) => RENDER_ANKI.deckTreeHtml(...a);
const renderAnki = (...a) => RENDER_ANKI.renderAnki(...a);

// Kleine Inline-SVG-Icons für die Chat-UI — statt Emojis, konsistent mit den
// übrigen SVG-Icons der App. stroke: currentColor → färbt sich per CSS mit.
const svgIcon = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICONS = {
	pen: svgIcon('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
	trash: svgIcon('<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>'),
	copy: svgIcon('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
	gear: svgIcon('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M2 12h3M19 12h3M4.9 19.1l2.2-2.2M16.9 7.1l2.2-2.2"/>'),
	think: svgIcon('<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.4 1 2.3h6c0-.9.4-1.8 1-2.3A7 7 0 0 0 12 2Z"/>'),
	lock: svgIcon('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
	arrowUp: svgIcon('<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>'),
	arrowDown: svgIcon('<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>'),
	arrowSame: svgIcon('<path d="M4 12h16"/><path d="m8 8-4 4 4 4"/><path d="m16 8 4 4-4 4"/>'),
};

// Icon: eigenes > Heft > PDF > Fallback (auch von library.js/search.js genutzt)
const pageIconLabel = (pg, fb = "📝") => pg.icon || (pg.kind === "heft" ? "📓" : pg.pdfId ? "📄" : fb);
const pageIconHtml = (pg, fb) => { const i = pageIconLabel(pg, fb); return i ? esc(i) + " " : ""; };

// v14 (25. Juli): inBlockEditor, isEditingBlock, isProtectedFocus, PROTECTED_FOCUS_IDS und der ganze
// _mainRenderPending-Nachhol-Mechanismus sind ersatzlos entfallen. Sie existierten nur,
// weil renderMain() den Hauptbereich per innerHTML komplett neu baute und dabei jeden
// Cursor mitriss. Seit U.morph nur noch Unterschiede angleicht (und fokussierte
// Eingabefelder sowie data-owned-Bereiche gar nicht anfasst), darf jederzeit gerendert
// werden — auch mitten im Tippen. Damit ist auch der Folgefehler weg, dass per Sync
// importierte Daten bis zum nächsten Fokuswechsel unsichtbar blieben.

// render.js — UI-Aufbau im Notion-Stil: Sidebar, Tabs, Seitenkopf, Chat.
function render() {
	// Expliziter render() storniert einen ausstehenden rAF-Render (sonst Doppel-Aufbau)
	if (_renderRaf) { cancelAnimationFrame(_renderRaf); _renderRaf = 0; }
	renderSidebar();
	renderMain();
	renderTabs();
	renderChat();
	// renderMain() → renderFullChat() baut das Vollbild-Log bereits; der zweite Durchlauf
	// pro Frame war reine Doppelarbeit.
	renderPendingChip("side");
	renderPendingChip("full");
	renderStatusDot();
	renderModelBar();
	const due = $("dueCount");
	if (due) due.textContent = STATE.dueCards().length;
}

// PERF: mehrere dispatches pro Frame → EIN Render (rAF-gebündelt)
let _renderRaf = 0;
// Die Navigations-Schnellpfade dürfen nur bei einem reinen Ansichtswechsel laufen.
// Zuvor genügte "aktive Zeile/Tab stimmt": dadurch blieben z.B. umbenannte Seiten,
// ein-/ausgeklappte Zweige oder geänderte Kartenzähler im alten DOM stehen. Revisions-
// zähler halten den O(1)-Pfad schnell, machen ihn aber bei echten Datenänderungen ungültig.
let _sidebarRevision = 1;
let _tabsRevision = 1;
const SIDEBAR_EVENT_PREFIXES = ["page", "workspace", "deck", "card", "chat"];
function invalidateNavigation(type, payload) {
	if (type === "syncImport") { _sidebarRevision++; _tabsRevision++; return; }
	if (type === "uiTreeSet" || SIDEBAR_EVENT_PREFIXES.some((prefix) => type.startsWith(prefix))) {
		_sidebarRevision++;
	}
	if (type === "uiTabsSet" || type.startsWith("page") || type.startsWith("chat")) {
		_tabsRevision++;
	}
}
function scheduleRender() {
	if (_renderRaf) return;
	_renderRaf = requestAnimationFrame(() => { _renderRaf = 0; render(); });
}
// Popover-Zustand (S.pageMenuOpenId, S.topMenu, S.deckMenuOpenName) wird direkt in
// popovers.js gesetzt, nicht per dispatch. Ohne diesen Anstoss blieb ein geschlossenes
// Menü als Geist im DOM stehen, bis irgendein anderes Ereignis ein Render auslöste.
document.addEventListener("popovers:changed", scheduleRender);

function onStateChange(type, ev) {
	const p = ev?.payload || {};
	invalidateNavigation(type, p);
	// Reiner Content-Patch: Editor besitzt die Live-Ansicht.
	if (type === "pageUpdate" && p.patch && Object.keys(p.patch).length === 1 && "content" in p.patch) {
		// viaEditor = eigener Autosave: der Editor-DOM ist bereits aktuell, ein Render wäre
		// reine Arbeit ohne Wirkung. Der frühere isEditingBlock()-Ausschluss ist entfallen —
		// eine EXTERNE Änderung (Drive-Sync) darf jetzt auch sichtbar werden, während getippt
		// wird, weil U.morph den Cursor nicht mehr zerstört.
		if (p.viaEditor) return;
		if (p.id === S.currentPageId && S.view === "page") renderMain();
		return;
	}
	// Heft: Canvas ist die Live-Ansicht — nur die Bibliothek auffrischen, falls offen
	if (type === "heftUpdated") {
		if (S.view === "library") renderMain();
		return;
	}
	// Modell-/Thinking-Umschalter: nur die Modell-Leiste
	if (type === "settingsSet") {
		const keys = Object.keys(p);
		if (keys.length && keys.every((k) => k === "aiModel" || k === "aiProviderId" || k === "thinkingLevel")) {
			renderModelBar();
			return;
		}
	}
	scheduleRender();
}

function renderTopbar() {
	// Genau EINE Pille aktiv; expliziter Chat-Modus hat Vorrang vor Anki
	const mode = S.sidebarMode === "chats" ? "chats" : S.view === "anki" ? "anki" : "files";
	const set = (id, on) => { const b = $(id); if (b) b.classList.toggle("active", on); };
	set("btnHome", mode === "files");
	set("btnChatTab", mode === "chats");
	set("btnAnki", mode === "anki");
	set("btnLibrary", S.view === "library");
	set("btnDaily", S.view === "daily");
}

function aiStatusMeta() {
	if (S.aiOnline === true) return { cls: "online", title: "KI verbunden", label: "KI online" };
	if (S.aiOnline === false) return { cls: "offline", title: "KI nicht erreichbar (Einstellungen → KI prüfen)", label: "KI offline" };
	return { cls: "checking", title: "KI-Status wird geprüft…", label: "KI …" };
}

// KI-Status-Pille nur im Chat (Side-Panel + Vollbild)
function fillAiStatusChip(chip, meta) {
	if (!chip) return;
	chip.hidden = false;
	// PERF: Der Status wechselt selten, die Pille wurde aber bei JEDEM Frame neu geschrieben.
	// Das kostete nicht nur Arbeit, es setzte auch die Blink-Animation des Punktes ständig
	// zurück — „KI wird geprüft“ wirkte dadurch eingefroren. Label und Titel hängen
	// eindeutig an cls, deshalb genügt cls als Kennung.
	if (chip._statusKey === meta.cls) return;
	chip._statusKey = meta.cls;
	chip.className = "ai-status-chip " + meta.cls;
	chip.title = meta.title + " — Klick: erneut prüfen";
	chip.innerHTML = `<span class="dot ${meta.cls}"></span><span class="ai-status-label">${esc(meta.label)}</span>`;
}
function renderStatusDot() {
	const meta = aiStatusMeta();
	// FIX: Side-Chip IMMER befüllen (auch bei body.panel-collapsed) — der DOM muss
	// beim Aufklappen aktuell sein, sonst bleibt die Pille im kleinen Chat leer
	fillAiStatusChip($("aiStatusChip"), meta);
	const fullChip = $("aiStatusChipFull");
	if (fullChip) {
		if (S.view === "chat") fillAiStatusChip(fullChip, meta);
		else fullChip.hidden = true;
	}
	const set = $("aiStatusSettings");
	// dito im Einstellungs-Banner: der „Erneut prüfen“-Knopf wurde bei jedem Frame ersetzt —
	// ein Klick konnte dabei zwischen Drücken und Loslassen verloren gehen.
	if (set && set._statusKey !== meta.cls) {
		set._statusKey = meta.cls;
		set.className = "ai-status-banner " + meta.cls;
		set.innerHTML = `<span class="dot ${meta.cls}"></span><span>${esc(meta.title)}</span><button type="button" id="btnRecheckAI" class="mini">Erneut prüfen</button>`;
	}
}

function currentModelLabel() {
	const cur = S.settings.aiModel || "";
	const pr = (S.settings.aiProviders || []).find((p) => p.id === S.settings.aiProviderId);
	return cur ? (pr ? pr.name + " · " : "") + cur : "Kein Modell";
}

// Beide Auslöser (kleines Panel + großer Chat) bekommen dasselbe Icon/Label
function renderModelBar() {
	const label = currentModelLabel();
	const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="8" x2="20" y2="8"/><circle cx="9" cy="8" r="2.6" fill="currentColor"/><line x1="4" y1="16" x2="20" y2="16"/><circle cx="15" cy="16" r="2.6" fill="currentColor"/></svg>';
	for (const id of ["btnModelChipFull", "btnModelMenu"]) {
		const b = $(id);
		if (!b) continue;
		// Das Icon ist konstant — es bei jedem Frame erneut zu parsen war reine Doppelarbeit.
		if (!b._iconSet) { b.innerHTML = icon; b._iconSet = true; }
		b.title = "Modell: " + label;
	}
	renderModelMenu();
}

function currentThinkingCapability() {
	const pr = (S.settings.aiProviders || []).find((p) => p.id === S.settings.aiProviderId);
	const base = String((pr && pr.base) || "").replace(/\/+$/, "");
	const key = [String(S.settings.aiProviderId || ""), base, String(S.settings.aiModel || "")].join("::");
	return (S.thinkingCapabilities || {})[key] || null;
}

// ★ Modell-Favoriten: "providerId::modelId", bewusst lokal (Quellen-IDs sind gerätespezifisch).
// Wird vom Chat-Dropdown UND den KI-Einstellungen genutzt (exportiert unten).
const MODEL_FAV_KEY = "impala67FavModels";
const favModels = () => new Set(lsGet(MODEL_FAV_KEY, []));
function toggleFavModel(key) {
	const s = favModels();
	s.has(key) ? s.delete(key) : s.add(key);
	lsSet(MODEL_FAV_KEY, [...s]);
}
// Capture: Stern darf nicht gleichzeitig das Modell umschalten
document.addEventListener("click", (e) => {
	const b = e.target && e.target.closest && e.target.closest("[data-modelfav]");
	if (!b) return;
	e.preventDefault();
	e.stopPropagation();
	toggleFavModel(b.dataset.modelfav);
	renderModelMenu();
	// Favoriten-Liste in den offenen KI-Einstellungen live mitziehen
	if (typeof SETTINGS.paintSettingsModels === "function") SETTINGS.paintSettingsModels();
}, true);

function modelMenuInnerHtml() {
	const providers = S.settings.aiProviders || [];
	const curPr = S.settings.aiProviderId || "";
	const curModel = S.settings.aiModel || "";
	const live = S.availableModels || [];
	const section = S.modelMenuSection || "root";
	const back = '<button type="button" class="model-submenu-back" data-modelmenuback="1">‹ Zurück</button>';
	const enabled = S.settings.thinkingEnabled !== false;
	const capability = currentThinkingCapability();
	const thinkingLabel = capability?.error ? "Nicht steuerbar" : enabled ? "Automatisch" : (capability?.offLabel || "Reduziert");
	if (section === "root") {
		// Thinking-Eintrag nie ausblenden — die Unterseite erklärt die Fähigkeit selbst
		return `<button type="button" class="model-submenu-row" data-modelsubmenu="models"><span>Modell</span><small>${esc(currentModelLabel())} ›</small></button>` +
			`<button type="button" class="model-submenu-row" data-modelsubmenu="thinking"><span>Denkaufwand</span><small>${thinkingLabel} ›</small></button>`;
	}
	if (section === "thinking") {
		const cap = capability;
		if (!cap || cap.state === "loading") return back + '<div class="menu-label">Thinking</div><div class="menu-note">API-Fähigkeiten werden geprüft…</div>';
		if (cap.error) return back + '<div class="menu-label">Denkaufwand</div><div class="menu-note">' + esc(cap.error) + "</div>";
		return back + '<div class="menu-label">Denkaufwand</div><div class="menu-note">Das Modell verwendet automatisch eine passende Tiefe; für schnellere Antworten lässt sie sich auf das dokumentierte Minimum begrenzen.</div>' +
			[[true, "Automatisch"], [false, cap.offLabel || "Reduziert"]].map(([v, label]) =>
				`<button type="button" class="menu-item${v === enabled ? " active" : ""}" data-thinkingenabled="${v ? "1" : "0"}"><span class="menu-item-label">${label}</span>${v === enabled ? '<span class="menu-check">✓</span>' : ""}</button>`).join("");
	}
	const head = back + '<div class="menu-label">Verfügbare Modelle</div>';
	const favSet = favModels();
	const opt = (prId, value, active) => {
		const favKey = prId + "::" + value, fav = favSet.has(favKey);
		return `<div class="model-row"><button type="button" class="menu-item${active ? " active" : ""}" data-modelset="${esc(prId)}::${esc(value)}"><span class="menu-item-label">${esc(value)}</span>${active ? '<span class="menu-check">✓</span>' : ""}</button>` +
			`<button type="button" class="model-fav${fav ? " on" : ""}" data-modelfav="${esc(favKey)}" title="${fav ? "Favorit entfernen" : "Als Favorit ganz nach oben pinnen"}">${fav ? "★" : "☆"}</button></div>`;
	};
	const rows = (ms) => ms.map((m) => opt(m.providerId, m.id, m.providerId === curPr && m.id === curModel)).join("");
	// ★ Favoriten quellenübergreifend zuerst
	const favLive = live.filter((m) => favSet.has(m.providerId + "::" + m.id));
	let body = favLive.length ? '<div class="menu-label">★ Favoriten</div>' + rows(favLive) : "";
	for (const pr of providers) {
		const rest = live.filter((m) => m.providerId === pr.id && !favSet.has(pr.id + "::" + m.id));
		if (rest.length) body += `<div class="menu-label">${esc(pr.name || pr.id)}</div>` + rows(rest);
	}
	// Beim ersten Öffnen nicht auf einen ausgeschalteten lokalen Server warten:
	// gespeicherte Auswahl und Presets sind sofort nutzbar, die Live-Liste folgt danach.
	if (!body) {
		const knownProviders = new Set(providers.map((p) => p.id));
		const fallback = [];
		const seen = new Set();
		const add = (m) => {
			const key = m.providerId + "::" + m.id;
			if (m.id && knownProviders.has(m.providerId) && !seen.has(key)) { seen.add(key); fallback.push(m); }
		};
		add({ providerId: curPr, id: curModel });
		for (const preset of AI.MODEL_PRESETS || []) add({ providerId: preset.provider, id: preset.value });
		if (fallback.length) body = '<div class="menu-label">Gespeichert & Vorschläge</div>' + rows(fallback);
	}
	const loading = S.modelMenuLoading ? '<div class="menu-note model-refresh-note">Modelle werden aktualisiert…</div>' : "";
	return head + loading + (body || '<div class="menu-note">Gerade ist kein Modell erreichbar oder geladen.</div>');
}

// EIN Inhalt für beide Dropdown-Container (kleines Panel + großes Chat-Fenster)
function renderModelMenu() {
	const inner = modelMenuInnerHtml();
	for (const id of ["modelMenu", "modelMenuFull"]) {
		const m = $(id);
		if (!m) continue;
		const which = id === "modelMenuFull" ? "full" : "panel";
		const show = S.modelMenuOpen && (S.modelMenuAnchor || "panel") === which;
		m.hidden = !show;
		if (show) {
			m.innerHTML = inner;
			POPOVERS.position($(which === "full" ? "btnModelChipFull" : "btnModelMenu"), m, { prefer: "above", gap: 6 });
		}
	}
}

// ---------- Sidebar (Collapse-Zustand bleibt über Neustarts erhalten) ----------
function wsHeadHtml(ws) {
	const key = "ws:" + ws.id;
	return `<div class="ws-head"><button class="row-chevron ws-chevron${COLLAPSE.isCollapsed(key) ? "" : " open"}" data-collapse="${key}" title="Ein-/Ausklappen">▸</button><span class="ws-name">${esc(ws.name)}</span><button class="mini" data-newpage="${ws.id}" title="Neue Seite in ${esc(ws.name)}">+</button></div>`;
}

// PERF: identisches Markup nicht erneut parsen/layouten — Stringvergleich ist
// um Größenordnungen billiger als innerHTML.
// v14 (25. Juli): Bei Unterschieden wird der Baum jetzt per U.morph ANGEGLICHEN
// statt weggeworfen. Nur wirklich geänderte Knoten fassen wir an; alles andere
// (Fokus, Scroll, offene Menüs, laufende Umbenennungen, positionierte Popover)
// überlebt den Render von selbst. Die Zeilen tragen dafür data-key (s. rowHtml /
// renderTabs), damit Umsortieren/Einfügen keinen Neubau auslöst.
function setHtmlIfChanged(el, html, key = "_lastHtml") {
	if (el[key] === html) return false;
	U.morph(el, html);
	el[key] = html;
	return true;
}

const cssEsc = (s) => (typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(s) : String(s).replace(/["\\]/g, "\\$&"));

// Schnelle O(1)-Abstimmung für aktive Zeile im Seitenbaum/Chatverlauf — vermeidet
// Voll-Rebuild und DOM-Morphing über den gesamten Bestand beim reinen Tabwechsel.
function syncActiveSidebarRow(tree) {
	if (!tree || !tree.firstElementChild) return false;
	const currentMode = tree.dataset.sbmode || "";
	const targetMode = S.sidebarMode === "chats" ? "chats" : (S.view === "anki" ? "anki" : "files");
	if (currentMode !== targetMode) return false;

	if (targetMode === "chats") {
		const targetId = S.currentChatId;
		const curActive = tree.querySelector(".row.active");
		const targetRow = targetId ? tree.querySelector(`.row[data-chat="${cssEsc(targetId)}"]`) : null;
		if (curActive === targetRow) return true;
		if (targetId && !targetRow) return false; // Chat-Zeile in der Sidebar nicht gefunden -> Fallback auf Voll-Render
		if (curActive) curActive.classList.remove("active");
		if (targetRow) targetRow.classList.add("active");
		return true;
	}

	if (targetMode === "files") {
		const targetId = S.view === "page" ? S.currentPageId : null;
		const curActive = tree.querySelector(".row.active");
		const targetRow = targetId ? tree.querySelector(`.row[data-page="${cssEsc(targetId)}"]`) : null;
		if (curActive === targetRow) return true;
		if (targetId && !targetRow) return false; // Seite nicht in der Sidebar (neu/eingeklappt) -> Fallback auf Voll-Render
		if (curActive) curActive.classList.remove("active");
		if (targetRow) targetRow.classList.add("active");
		return true;
	}

	return false;
}

// Schnelle O(1)-Abstimmung für aktiven Tab-Chip und Nav-Buttons.
function syncActiveTabChip(bar) {
	if (!bar || !bar.firstElementChild) return false;
	const chips = [...bar.querySelectorAll(".tabchip[data-tabopen]")];
	if (chips.length !== S.tabs.length) return false;
	for (let i = 0; i < chips.length; i++) {
		if (chips[i].dataset.tabopen !== S.tabs[i]) return false;
	}

	const isChat = String(S.activeTabId).startsWith("chat:");
	const isNlm = S.activeTabId === "nlm:main";
	const isAnki = S.activeTabId === "anki:main";
	const activeViewMatches = (isChat && S.view === "chat") || (isNlm && S.view === "notebooklm") || (isAnki && S.view === "anki") || (!isChat && !isNlm && !isAnki && S.view === "page");
	const targetActiveId = activeViewMatches ? S.activeTabId : null;

	chips.forEach((chip) => {
		const shouldBeActive = targetActiveId != null && chip.dataset.tabopen === targetActiveId;
		chip.classList.toggle("active", shouldBeActive);
	});

	const backBtn = $("btnNavBack");
	if (backBtn) backBtn.disabled = !(S.navIndex > 0);
	const fwdBtn = $("btnNavForward");
	if (fwdBtn) fwdBtn.disabled = !(S.navIndex < S.navHistory.length - 1);
	return true;
}

// "files" = Workspaces mit Seitenbaum, "chats" = Chat-Verlauf
function renderSidebar() {
	renderTopbar();
	const tree = $("tree");
	if (!tree) return;
	// FIX: Hintergrund-Render darf laufendes Umbenennen (Fokus + Text) nicht zerstören;
	// Commit/Abbrechen leert die Flags VOR render() und läuft normal durch
	const ae = document.activeElement;
	if ((S.renamingPageId || S.renamingDeck) && ae && ae.dataset && (ae.dataset.renamename || ae.dataset.deckrenamename)) return;

	const selectionKey = S.chatSelection instanceof Set ? [...S.chatSelection].sort().join(",") : "";
	const sidebarKey = [_sidebarRevision, S.pageMenuOpenId || "", S.deckMenuOpenName || "",
		S.renamingPageId || "", S.renamingDeck || "", selectionKey].join("|");
	if (tree.dataset.renderKey === sidebarKey && syncActiveSidebarRow(tree)) {
		if (S.pageMenuOpenId) {
			const anchor = tree.querySelector(`[data-pagemenu="${S.pageMenuOpenId}"]`);
			const menu = tree.querySelector(".page-menu");
			if (anchor && menu) POPOVERS.position(anchor, menu, { align: "end", gap: 2 });
		}
		return;
	}

	const mode = S.sidebarMode === "chats" ? "chats" : (S.view === "anki" ? "anki" : "files");
	if (S.sidebarMode === "chats") {
		setHtmlIfChanged(tree, chatListHtml());
		tree.dataset.sbmode = mode;
		tree.dataset.renderKey = sidebarKey;
		return;
	}
	if (S.view === "anki") {
		setHtmlIfChanged(tree, deckTreeHtml());
		tree.dataset.sbmode = mode;
		tree.dataset.renderKey = sidebarKey;
		// Offenes ⋯-Menü nach Rebuild fixed neu positionieren, sonst clippt #tree
		if (S.deckMenuOpenName) {
			const name = CSS.escape(S.deckMenuOpenName);
			const anchor = tree.querySelector(`[data-deckmenu="${name}"]`);
			const menu = tree.querySelector(`[data-deckmenu-panel="${name}"]`);
			if (anchor && menu) POPOVERS.position(anchor, menu, { align: "end", gap: 2 });
		}
		return;
	}
	// ★ Favoriten immer oben, dann Workspaces mit Seitenbaum
	const favs = STATE.activePages().filter((p) => p.favorite);
	let html = favs.length ? '<div class="ws-head"><span class="ws-name">★ Favoriten</span></div>' + favs.map((p) => rowHtml(p, 0, p.workspaceId)).join("") : "";
	for (const ws of Object.values(S.workspaces)) {
		html += wsHeadHtml(ws);
		if (!COLLAPSE.isCollapsed("ws:" + ws.id)) html += branchHtml(null, 0, ws.id) || '<div class="empty small">Keine Seiten</div>';
	}
	setHtmlIfChanged(tree, html);
	tree.dataset.sbmode = mode;
	tree.dataset.renderKey = sidebarKey;
	// dito: offenes Seiten-⋯-Menü nach JEDEM Rebuild neu positionieren
	if (S.pageMenuOpenId) {
		const anchor = tree.querySelector(`[data-pagemenu="${S.pageMenuOpenId}"]`);
		const menu = tree.querySelector(".page-menu");
		if (anchor && menu) POPOVERS.position(anchor, menu, { align: "end", gap: 2 });
	}
}

// Chat-Verlauf in der Sidebar (Volltextsuche läuft im Befehls-Menü, Strg+K).
// Mehrfachauswahl: das Kästchen je Zeile wählt aus, die Kopfzeile löscht alles Ausgewählte
// in EINEM Schritt. Die Auswahl liegt zur Laufzeit in S.chatSelection (chat-fullscreen.js).
function chatListHtml() {
	const list = CHATS.load();
	const sel = S.chatSelection instanceof Set ? S.chatSelection : (S.chatSelection = new Set());
	// Ausgewählte Chats, die es nicht mehr gibt (Sync, Löschen auf einem anderen Gerät),
	// dürfen nicht als Karteileiche in der Auswahl hängen bleiben.
	if (sel.size) {
		const alive = new Set(list.map((s) => s.id));
		for (const id of [...sel]) if (!alive.has(id)) sel.delete(id);
	}
	const head = sel.size
		? `<div class="row chat-selbar"><span class="row-title">${sel.size} ausgewählt</span>` +
			`<button class="row-add" data-chatselall="1" title="Alle Chats auswählen">Alle</button>` +
			`<button class="row-add" data-chatselnone="1" title="Auswahl aufheben">✕</button>` +
			`<button class="row-add danger" data-chatdelsel="1" title="Ausgewählte Chats löschen">${ICONS.trash}</button></div>`
		: '<div class="row" data-newchat="1"><span class="row-title">+ Neuer Chat</span></div>';
	return head + list.map((s) => {
		const on = sel.has(s.id);
		return `<div class="row${s.id === S.currentChatId ? " active" : ""}${on ? " selected" : ""}" data-key="chat:${s.id}" data-chat="${s.id}">` +
			`<button class="row-add chat-sel${on ? " on" : ""}" data-chatsel="${s.id}" aria-pressed="${on ? "true" : "false"}" title="${on ? "Abwählen" : "Auswählen"}">${on ? "☑" : "☐"}</button>` +
			`<span class="row-title">${esc(s.title || "Chat")}</span><span class="hint">${U.fmtDate(s.updated || s.created)}</span>` +
			`<button class="row-add" data-chatrename="${s.id}" title="Chat umbenennen">${ICONS.pen}</button>` +
			`<button class="row-add danger" data-chatdel="${s.id}" title="Chat löschen">${ICONS.trash}</button></div>`;
	}).join("");
}

function branchHtml(parentId, depth, wsId) {
	return depth > 8 ? "" : STATE.childrenOf(parentId, wsId).map((pg) => rowHtml(pg, depth, wsId)).join("");
}

function rowHtml(pg, depth, wsId) {
	const active = pg.id === S.currentPageId && S.view === "page" ? " active" : "";
	const hasKids = STATE.childrenOf(pg.id, wsId || pg.workspaceId).length > 0;
	const collapsed = COLLAPSE.isCollapsed(pg.id);
	// Bug-Fix („kommt noch“, 22. Juli): kein draggable="true" mehr — HTML5-DnD wird in
	// iPad startet HTML5-DnD nur per Long-Press. Das Verschieben läuft deshalb über
	// Pointer-Events in app.js (ein Code-Pfad für Maus und Touch).
	// data-key = stabile Identität der Zeile für U.morph: dieselbe Seite behält beim
	// Neu-Rendern ihren DOM-Knoten, auch wenn sie im Baum die Position wechselt.
	return `<div class="row${active}" data-key="pg:${pg.id}" data-page="${pg.id}" style="padding-left:${6 + depth * 16}px">` +
		(hasKids ? `<button class="row-chevron${collapsed ? "" : " open"}" data-collapse="${pg.id}" title="Ein-/Ausklappen">▸</button>` : '<span class="row-chevron spacer"></span>') +
		(S.renamingPageId === pg.id
			? `<input class="row-rename-input" data-renamename="${esc(pg.id)}" value="${esc(pg.title)}" autocomplete="off">`
			: `<span class="row-title">${pageIconHtml(pg, "")}${esc(pg.title)}</span>`) +
		`<button class="row-add" data-pagemenu="${pg.id}" title="Weitere Optionen">⋯</button>` +
		`<button class="row-add" data-addchild="${pg.id}" title="Unterseite anlegen">+</button>` +
		(S.pageMenuOpenId === pg.id ? pageMenuHtml(pg) : "") +
		"</div>" + (hasKids && !collapsed ? branchHtml(pg.id, depth + 1, wsId || pg.workspaceId) : "");
}

// Geteilte Menüpunkte für Seiten-⋯ (Sidebar) und Topbar-⋯
const menuBtn = (attr, id, label, cls = "") => `<button class="menu-item${cls}" data-${attr}="${id}">${label}</button>`;
const dupTplItems = (pg) => menuBtn("pageduplicate", pg.id, "📋 Duplizieren") + menuBtn("pagetemplate", pg.id, "📑 " + (pg.isTemplate ? "Vorlage entfernen" : "Als Vorlage"));
const moveTrashItems = (pg) => menuBtn("pagemove", pg.id, "📦 Verschieben nach…") + menuBtn("pagetrash", pg.id, "🗑 Löschen", " danger");
function pageMenuHtml(pg) {
	return '<div class="page-menu">' + menuBtn("pagerename", pg.id, "✎ Umbenennen") + dupTplItems(pg) +
		menuBtn("pagefav", pg.id, pg.favorite ? "★ Favorit entfernen" : "☆ Zu Favoriten") + moveTrashItems(pg) + "</div>";
}

// ---------- Tab-Leiste (Zurück/Vor + offene Seiten UND Chats) ----------
function renderTabs() {
	const bar = $("tabbar");
	if (!bar) return;
	if (bar.dataset.renderRevision === String(_tabsRevision) && syncActiveTabChip(bar)) return;

	// Chat-Titel einmal laden (nicht pro Tab CHATS.load()) — PERF (Audit 21. Juli):
	// und NUR, wenn überhaupt Chat-Tabs offen sind. Sonst parste jeder einzelne Render
	// den kompletten Chat-Verlauf aus localStorage, obwohl kein Tab ihn braucht.
	const chatById = new Map();
	if (S.tabs.some((id) => id.startsWith("chat:"))) {
		try { CHATS.load().forEach((s) => chatById.set(s.id, s)); } catch { /* ignore */ }
	}
	let html = '<button class="navbtn" id="btnSidebarToggle" title="Linke Spalte ein-/ausklappen">☰</button>' +
		`<button class="navbtn" id="btnNavBack" ${S.navIndex > 0 ? "" : "disabled"} title="Zurück">‹</button>` +
		`<button class="navbtn" id="btnNavForward" ${S.navIndex < S.navHistory.length - 1 ? "" : "disabled"} title="Vor">›</button>` +
		'<div class="tabstrip">';
	html += S.tabs.map((id) => {
		const isChat = id.startsWith("chat:"), isNlm = id === "nlm:main", isAnki = id === "anki:main";
		let title;
		if (isChat) title = "✦ " + esc(chatById.get(id.slice(5))?.title || "Chat"); // ✦ = KI-Markenzeichen wie Home/FAB
		else if (isNlm) title = "📓 Gemini Notebook";
		else if (isAnki) title = "🃏 Karteikarten"; // eigener Tab seit 23. Juli — gleiche Mechanik wie nlm:main
		else {
			const pg = S.pages[id];
			if (!pg) return "";
			title = pageIconHtml(pg) + esc(pg.title);
		}
		const active = id === S.activeTabId && ((isChat && S.view === "chat") || (isNlm && S.view === "notebooklm") || (isAnki && S.view === "anki") || (!isChat && !isNlm && !isAnki && S.view === "page")) ? " active" : "";
		return `<div class="tabchip${active}" data-key="tab:${id}" data-tabopen="${id}"><span class="tabchip-title">${title}</span><button class="tabchip-x" data-tabclose="${id}" title="Schließen">✕</button></div>`;
	}).join("");
	// „+“ öffnet einen neuen Tab (Navigation ersetzt sonst den aktuellen)
	html += '<button class="tabchip tabchip-new" id="btnTabNew" data-tabnew="1" title="Neuen Tab öffnen">+</button></div>';
	setHtmlIfChanged(bar, html);
	bar.dataset.renderRevision = String(_tabsRevision);
}

function renderMain() {
	const main = $("main");
	if (!main) return;
	const pg = S.currentPageId ? S.pages[S.currentPageId] : null;
	// PERF/iPad: Bühnen-Zustände explizit am Body spiegeln. Die bisherigen
	// body:has(...)-Selektoren mussten bei praktisch jeder DOM-Änderung den ganzen
	// App-Baum neu prüfen (besonders teuer in Safari beim Tippen und Chat-Streaming).
	// Klassen sind O(1), werden vor dem DOM-Abgleich gesetzt und verhindern außerdem
	// einen kurzen Zwischenzustand beim Wechsel in Heft- oder Lernansichten.
	document.body.classList.toggle("heft-open", S.view === "page" && pg?.kind === "heft");
	document.body.classList.toggle("anki-view-open", S.view === "anki");
	document.body.classList.toggle("anki-study-open", S.view === "anki" && S.ankiTab === "study");
	// Die Lernzeiterfassung reagiert sofort auf Ansichtswechsel. So verschwindet
	// die Idle-Frage beim Verlassen eines Lernkontexts ohne den nächsten Tick abzuwarten.
	if (LERNZEIT.contextChanged) LERNZEIT.contextChanged();
	// Vollbild-Chats vor einem Ansichtswechsel aus dem Dokument nehmen statt sie
	// durch innerHTML zerstoeren zu lassen. So bleiben Log, Lesestelle und Entwurf.
	parkFullChat(main, S.view === "chat" ? String(S.currentChatId || "") : null);
	// Offenes Heft schließen, sobald die Ansicht es nicht mehr zeigt (speichert implizit)
	if (HEFT.activeId && (S.view !== "page" || S.currentPageId !== HEFT.activeId)) HEFT.unmount();
	const views = { library: (m) => LIBRARY.renderLibrary(m), anki: renderAnki, noten: (m) => SCHULNOTEN.render(m), daily: renderDaily, trash: renderTrash, chat: renderFullChat, notebooklm: (m) => NLM.renderPane(m) };
	if (views[S.view]) {
		// Fremde Renderer verwalten #main selbst. Ihr DOM darf nie mit einem alten
		// Seitenshell-Cache verwechselt werden, wenn man später zur Seite zurückkehrt.
		main._lastPageShellHtml = null;
		return void views[S.view](main);
	}
	if (S.view === "home" || !pg) {
		main._lastPageShellHtml = null;
		return void renderHome(main);
	}

	// Heft = Fokusmodus: nur die globale Tab-Leiste über der Papierfläche.
	// FIX: dasselbe gemountete Heft NIE remounten — sonst verlieren Hintergrund-
	// Renders Scroll/Zoom/Undo und die Ansicht springt auf eine andere Seite
	if (pg.kind === "heft") {
		main._lastPageShellHtml = null;
		if (HEFT.activeId === pg.id && main.querySelector("#heftStage")) return;
		// data-owned: der Canvas gehört HEFT — U.morph fasst diesen Teilbaum nie an.
		main.innerHTML = `<div id="heftStage" class="heft-stage" data-owned="1" aria-label="${esc(pg.title)}"></div>`;
		const stage = $("heftStage");
		if (stage) HEFT.mount(stage, pg.id);
		return;
	}

	// EINE durchgehend editierbare Ansicht (Block-Editor immer aktiv).
	// v14: angleichen statt neu bauen. Die frühere Scroll-Rettung über
	// main.dataset.scrollPageId entfällt — .page-scroll wird gar nicht mehr ersetzt und
	// behält seinen Scrollstand deshalb von selbst. data-key trennt die Ansichten sauber:
	// beim Wechsel Home ↔ Seite wird nicht versucht, fremde Container umzudeuten.
	const pageShellHtml =
		'<div class="page-chrome" data-key="pagechrome"><div class="page-topbar">' + breadcrumbHtml(pg) + topbarActionsHtml(pg) + "</div></div>" +
		'<div class="page-scroll" data-key="pagescroll"><div class="page-meta">' +
			(pg.coverImg || pg.cover
				? `<div class="page-cover ${pg.coverImg ? "has-img" : "cover-" + pg.cover}" data-key="cover:${esc(pg.coverImg || pg.cover || "")}"${pg.coverImg ? ` data-coverimg="${esc(pg.coverImg)}"` : ""}><div class="cover-btns"><button data-coverpick="1">Cover ändern</button><button data-coverremove="1">Entfernen</button></div></div>`
				: "") +
			'<div class="page-heading">' +
				`<button class="page-icon" data-iconpick="1" title="Icon ändern">${pageIconLabel(pg)}</button>` +
				(!pg.cover && !pg.coverImg ? '<button class="addcover-btn" data-coverpick="1">+ Cover</button>' : "") +
			"</div>" +
			// Mehrzeilig wachsender Titel (ein <input> würde lange Namen abschneiden)
			`<textarea id="pageTitle" rows="1" autocomplete="off" aria-label="Seitentitel">${esc(pg.title)}</textarea>` +
			backlinksChipHtml(pg) +
		"</div>" +
		(pg.db ? dbTableHtml(pg) : "") +
		// data-owned: der Block-Editor besitzt seinen DOM selbst (Cursor, Auswahl) —
		// U.morph lässt ihn unangetastet.
		'<div class="editor-wrap"><div id="blockEditor" class="block-editor" data-owned="1"></div></div></div>' +
		// src="about:blank" verhindert Chromes "Unsafe attempt to load URL file://..."
		(S.pdfOpen && pg.pdfId ? '<iframe id="pdfFrame" class="pdf-frame" data-key="pdfframe" data-owned="1" src="about:blank" title="PDF"></iframe>' : "");
	// Hintergrund-Updates erzeugen für die offene Seite meist exakt dasselbe Markup.
	// Dann weder HTML erneut parsen noch den DOM-Baum durchlaufen; Editor, Fokus,
	// Scroll und eingebettete Medien bleiben komplett unberührt.
	setHtmlIfChanged(main, pageShellHtml, "_lastPageShellHtml");
	hydrateCovers(main);
	// Titelhöhe an den Inhalt koppeln. WICHTIG: Das <textarea> überlebt den Render jetzt —
	// der Listener darf deshalb nur EINMAL pro Element hängen, sonst sammeln sich mit
	// jedem Render weitere Kopien an.
	const titleInput = $("pageTitle");
	if (titleInput) {
		const fitTitle = () => {
			titleInput._fitValue = titleInput.value;
			titleInput.style.height = "auto";
			titleInput.style.height = Math.max(44, titleInput.scrollHeight) + "px";
		};
		if (!titleInput._fitWired) {
			titleInput._fitWired = true;
			titleInput.addEventListener("input", fitTitle);
			// Panel, Dichte, Split-View und Rotation ändern die verfügbare Breite. Ein
			// ResizeObserver passt dann gezielt an, statt bei jedem Render Layout zu messen.
			if (typeof ResizeObserver === "function") {
				titleInput._fitObserver = new ResizeObserver(() => requestAnimationFrame(fitTitle));
				titleInput._fitObserver.observe(titleInput);
			}
		}
		if (titleInput._fitValue !== titleInput.value) fitTitle();
	}
	const beHost = $("blockEditor");
	if (beHost) EDITOR.mount(beHost, pg.id);
	if (S.pdfOpen && pg.pdfId) PDFS.urlFor(pg.pdfId).then((u) => {
		const f = $("pdfFrame");
		// Dieselbe src erneut zu setzen lädt ein iframe in Safari/Chromium wirklich neu.
		// Hintergrund-Updates dürfen deshalb ein bereits sichtbares PDF nicht flackern lassen.
		if (f && u && f.getAttribute("src") !== u) f.setAttribute("src", u);
	});
}

// Topbar rechts: Teilen, Favoriten-Stern, ⋯ (Stern/Menüpunkte via app.js, Auf/Zu via extras.js)
function topbarActionsHtml(pg) {
	return '<div class="topbar-actions">' +
		`<span class="topbar-wrap"><button class="topbar-btn" data-sharemenu="1" title="Exportieren & Teilen">↗ Teilen</button>${S.topMenu === "share" ? shareMenuHtml(pg) : ""}</span>` +
		`<button class="topbar-btn${pg.favorite ? " fav-active" : ""}" data-pagefav="${pg.id}" title="${pg.favorite ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen"}">${pg.favorite ? "★" : "☆"}</button>` +
		`<span class="topbar-wrap"><button class="topbar-btn" data-morepagemenu="1" title="Weitere Optionen">⋯</button>${S.topMenu === "more" ? moreMenuHtml(pg) : ""}</span></div>`;
}

function shareMenuHtml(pg) {
	return '<div class="page-menu top-menu">' + menuBtn("exportpdf", pg.id, "🖨 Als PDF exportieren / drucken") +
		menuBtn("exportmd", pg.id, "⬇ Als Markdown (.md) speichern") + menuBtn("copylink", pg.id, "🔗 Internen Link kopieren") + "</div>";
}

function moreMenuHtml(pg) {
	const marks = ((pg.content || "").match(/==[^=\n]+==/g) || []).length + ((pg.content || "").match(/\{\{c\d+::/g) || []).length;
	return '<div class="page-menu top-menu">' +
		'<button class="menu-item" data-editundo="1">↩ Rückgängig <span class="menu-hint">Strg+Z</span></button>' +
		'<button class="menu-item" data-editredo="1">↪ Wiederholen <span class="menu-hint">Strg+Y</span></button>' +
		'<div class="menu-sep"></div>' +
		'<button class="menu-item" id="btnHistory">🕘 Verlauf</button>' +
		(pg.pdfId ? '<button class="menu-item" id="btnOpenPdf">' + (S.pdfOpen ? "📄 PDF schließen" : "📄 PDF anzeigen") + "</button>" : "") +
		'<button class="menu-item" data-iconpick="1">😀 Icon ändern</button>' +
		'<button class="menu-item" data-coverpick="1">🖼 Cover ändern</button>' +
		(marks ? menuBtn("cardsfromhl", pg.id, `🃏 Karten aus Markierungen (${marks})`) : "") +
		dupTplItems(pg) + moveTrashItems(pg) + "</div>";
}

// „↙ N Rückverweise“ unter dem Titel — Klick klappt die Liste auf
function backlinksChipHtml(pg) {
	const links = STATE.backlinksOf(pg.id);
	if (!links.length) return "";
	return `<div class="backlinks-row"><button class="backlinks-chip" data-backlinks="1">↙ ${links.length} Rückverweise</button>` +
		(S.backlinksOpen ? '<div class="backlinks">' + links.slice(0, 20).map((l) => `<span class="crumb" data-page="${l.id}">${pageIconHtml(l)}${esc(l.title)}</span>`).join("") + "</div>" : "") + "</div>";
}

// Datenbank-Seite (pg.db): Unterseiten als editierbare Tabelle; Zell-Änderungen
// laufen als pageUpdate-Event (Verlauf/Diff/Sync greifen)
function dbTableHtml(pg) {
	const cols = ((pg.db && pg.db.schema) || []).filter((c) => c.type !== "title");
	const RO = { formula: 1, rollup: 1, created_time: 1, last_edited_time: 1, created_by: 1, last_edited_by: 1, people: 1, relation: 1, files: 1, button: 1, unique_id: 1, verification: 1 };
	return '<div class="db-view md"><table class="db-table"><thead><tr><th>Name</th>' +
		cols.map((c) => `<th title='${esc(c.type || "text")}'>${esc(c.name)}</th>`).join("") + "</tr></thead><tbody>" +
		STATE.childrenOf(pg.id, pg.workspaceId).map((r) => `<tr><td><span class="crumb" data-page="${r.id}">${pageIconHtml(r)}${esc(r.title)}</span></td>` +
			cols.map((c) => {
				const v = esc((r.props || {})[c.name] || "");
				return RO[c.type] ? `<td><span class="hint">${v}</span></td>` : `<td><input class="db-cell" data-dbrow="${r.id}" data-dbcol="${esc(c.name)}" value="${v}"></td>`;
			}).join("") + "</tr>").join("") +
		`</tbody></table><div class="row-btns" style="margin:8px 0 14px"><button class="mini" data-dbnewrow="${pg.id}">+ Neue Zeile</button></div></div>`;
}

// Breadcrumb: Workspace › Eltern › aktuelle Seite
function ancestorsOf(pg) {
	const chain = [];
	for (let cur = S.pages[pg.parentId]; cur; cur = S.pages[cur.parentId]) chain.unshift(cur);
	return chain;
}

function breadcrumbHtml(pg) {
	const ws = S.workspaces[pg.workspaceId] || { name: "Privat" };
	return `<div class="breadcrumb"><span class="crumb" data-crumbws="1">${esc(ws.name)}</span>` +
		ancestorsOf(pg).map((a) => `<span class="crumb-sep">/</span><span class="crumb" data-page="${a.id}">${esc(a.title)}</span>`).join("") +
		`<span class="crumb-sep">/</span><span class="crumb current">${esc(pg.title)}</span></div>`;
}

// ---- Sync-Konflikte: Pending-Liste + Lösungs-Popup mit Diff -----
const CONFLICT_KEY = "impala67_pending_conflicts";
const RESOLVED_CONFLICT_KEY = "impala67_resolved_conflicts";
const DATETIME_OPTS = { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" };
const loadResolvedConflictIds = () => new Set(lsGet(RESOLVED_CONFLICT_KEY, []));
function markConflictResolved(conflictPageId) {
	if (!conflictPageId) return;
	// nur lokale UI-Quittierung; klein halten (kein wachsender LocalStorage)
	lsSet(RESOLVED_CONFLICT_KEY, [...loadResolvedConflictIds().add(conflictPageId)].slice(-200));
}
const isConflictPage = (p) => !!(p && !loadResolvedConflictIds().has(p.id) && ((p.id || "").startsWith("conflictpg-") || (p.title || "").startsWith("⚠ Konflikt")));
const loadPendingConflicts = () => lsGet(CONFLICT_KEY, []);
function savePendingConflicts(list) {
	if (!list || !list.length) { U.storage.remove(CONFLICT_KEY); return; }
	// Bug-1-Fix: localContent/remoteContent können die localStorage-Quota sprengen.
	// Fallback: ohne Textfelder speichern — beim Öffnen des Dialogs werden sie aus
	// S.pages rekonstruiert (solange die Sitzung läuft ist das verlustfrei).
	if (U.storage.setJson(CONFLICT_KEY, list)) return;
	const slim = list.map(({ localContent, remoteContent, loserContent, ...rest }) => rest);
	U.storage.setJson(CONFLICT_KEY, slim);
}
function mergePendingConflicts(details) {
	const map = new Map(loadPendingConflicts().map((c) => [c.conflictPageId || c.pageId, c]));
	for (const c of details || []) map.set(c.conflictPageId || c.pageId, c);
	savePendingConflicts([...map.values()]);
}
function fmtConflictTime(iso) {
	try { return new Date(iso).toLocaleString("de-DE", DATETIME_OPTS); } catch { return iso || "?"; }
}
function legacyConflictItems() {
	return STATE.activePages().filter(isConflictPage).map((p) => ({
		pageId: null,
		title: (p.title || "").replace(/^⚠ Konflikt:\s*/, "").split(" — Stand")[0],
		reason: "Unterlegener Stand einer früheren Sync-Kollision. Der Gegen-Stand ist nicht mehr rekonstruierbar — deshalb zeigt die Ansicht nur diese gerettete Kopie.",
		// FIX (25. Juli): remoteContent war "" — der Zeilenvergleich markierte dadurch den
		// KOMPLETTEN Text als „nur auf diesem Gerät vorhanden“ und suggerierte, die Gegenseite
		// sei leer. null = zweiter Stand unbekannt; die Ansicht zeigt dann bewusst keinen Diff.
		localContent: p.content || "", remoteContent: null,
		localTime: p.updated, remoteTime: null,
		winner: "remote", loserContent: p.content || "", loserTime: p.updated,
		conflictPageId: p.id, eventId: null, legacy: true,
	}));
}
// Popup zeigt IMMER beide Stände: Hefte als Blob-Vorschau der ersten Seite,
// Lösch-Konflikte als „gelöscht“ gegen die gerettete Kopie
const conflictPaneHead = (label, time) => `<header><b>${label}</b>${time ? `<small>${esc(fmtConflictTime(time))}</small>` : ""}</header>`;
function buildSpecialComparisonHtml(c) {
	const notePane = (side, label, time, note) => `<section class="conflict-pane ${side}">${conflictPaneHead(label, time)}<div class="conflict-pane-body"><div class="conflict-empty">${esc(note)}</div></div></section>`;
	const textPane = (side, label, time, text) => `<section class="conflict-pane ${side}">${conflictPaneHead(label, time)}<div class="conflict-pane-body"><pre class="conflict-fulltext">${esc(text) || "(Kein Text vorhanden.)"}</pre></div></section>`;
	// Alt-Konflikte (aus der Zeit vor den gespeicherten Details): es existiert nur noch die
	// gerettete Kopie. Ein Zwei-Spalten-Diff wäre hier eine Falschaussage — lieber ehrlich
	// EINE Spalte zeigen und dazuschreiben, warum es keinen Vergleich gibt.
	if (c.legacy) {
		return '<div class="conflict-compare conflict-compare-single">' +
			textPane("remote", "Geretteter Stand (Konfliktkopie)", c.loserTime, c.loserContent || c.localContent || "") +
			'</div><p class="conflict-key">Zu diesem älteren Konflikt ist nur noch die gerettete Kopie vorhanden — der Gegen-Stand lässt sich nicht mehr rekonstruieren. Prüfe den Text und entscheide, ob du ihn behältst.</p>';
	}
	// v8 (25. Juli): Heft-Striche liegen als Ereignisse im Log, nicht mehr als
	// binärer Blob. Zwei Geräte können dieselbe Heft-Seite deshalb gar nicht mehr
	// überschreiben — es gibt keine Heft-Konfliktkopie und folglich auch keine
	// Canvas-Gegenüberstellung mehr. Der ganze Zweig ist ersatzlos entfallen.
	if (c.conflictType === "delete-change") {
		const kept = textPane("remote", "✏️ Geänderter Stand (gerettete Kopie)", c.changedAt, ((S.pages[c.conflictPageId] || {}).content || ""));
		return '<div class="conflict-compare">' +
			notePane("local", "🗑 Gelöscht", c.deletedAt, "Die Seite wurde auf einem Gerät endgültig gelöscht. Beim Zusammenführen gewinnt das Löschen — der andere Stand wurde als Kopie gerettet (rechts).") +
			kept + "</div>";
	}
	return '<div class="conflict-no-compare"><b>Kein Textvergleich möglich</b><span>Die Änderung betrifft den Seitenstatus, nicht zwei Textfassungen. Öffne die gerettete Kopie und entscheide anschließend, was erhalten bleiben soll.</span></div>';
}
// ---- Zeilenvergleich: erst zuschneiden, dann ausrichten -------------------------
// U.diffLines steigt oberhalb von 400 Zeilen in einen groben Modus aus (die O(n*m)-Matrix
// würde sonst explodieren). Genau bei langen Seiten verschwand deshalb bisher JEDE
// Markierung, obwohl typischerweise nur ein einziger Absatz abweicht. Vorschaltung:
// identischen Anfang und identisches Ende abschneiden und nur die abweichende Mitte diffen.
// Erst wenn auch die Mitte größer als 400 Zeilen ist, gibt es wirklich kein Ergebnis.
const DIFF_MAX_MIDDLE = 400;
function conflictDiff(left, right) {
	const A = String(left ?? "").split("\n"), B = String(right ?? "").split("\n");
	let pre = 0;
	while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
	let post = 0;
	while (post < A.length - pre && post < B.length - pre && A[A.length - 1 - post] === B[B.length - 1 - post]) post++;
	const midA = A.slice(pre, A.length - post), midB = B.slice(pre, B.length - post);
	if (midA.length > DIFF_MAX_MIDDLE || midB.length > DIFF_MAX_MIDDLE) return null;
	const same = (text) => ({ type: "same", text });
	const out = A.slice(0, pre).map(same);
	// Leere Seite bewusst selbst behandeln: U.diffLines("", x) erzeugt sonst eine
	// Geister-Leerzeile, weil "".split("\n") ein Array mit einem leeren String liefert.
	if (!midA.length && midB.length) out.push(...midB.map((text) => ({ type: "add", text })));
	else if (!midB.length && midA.length) out.push(...midA.map((text) => ({ type: "del", text })));
	else if (midA.length) out.push(...U.diffLines(midA.join("\n"), midB.join("\n")));
	out.push(...A.slice(A.length - post).map(same));
	return out;
}

// Beide Spalten zeilengenau ausrichten. Vorher filterte jede Spalte unabhängig (links
// same+del, rechts same+add) — die Spalten hatten dadurch unterschiedlich viele Zeilen,
// „gleiche“ Zeilen standen auf verschiedenen Höhen und nichts war mehr vergleichbar.
// Jetzt bilden gelöschte und hinzugefügte Zeilen eines Blocks Paare; die kürzere Seite
// bekommt Leerzeilen. Lange unveränderte Strecken werden eingeklappt, damit man bei einer
// 2000-Zeilen-Seite nicht ewig an Identischem vorbeiscrollt.
const COLLAPSE_AFTER = 8, COLLAPSE_KEEP = 3;
function alignDiffRows(diff) {
	const rows = [];
	let dels = [], adds = [];
	const flush = () => {
		const n = Math.max(dels.length, adds.length);
		for (let k = 0; k < n; k++) rows.push({ left: dels[k] ?? null, right: adds[k] ?? null, changed: true, start: k === 0 });
		dels = []; adds = [];
	};
	for (const d of diff) {
		if (d.type === "del") dels.push(d.text);
		else if (d.type === "add") adds.push(d.text);
		else { flush(); rows.push({ left: d.text, right: d.text, changed: false }); }
	}
	flush();
	const out = [];
	for (let i = 0; i < rows.length; i++) {
		if (rows[i].changed) { out.push(rows[i]); continue; }
		let j = i;
		while (j < rows.length && !rows[j].changed) j++;
		const run = j - i;
		if (run <= COLLAPSE_AFTER) out.push(...rows.slice(i, j));
		else {
			out.push(...rows.slice(i, i + COLLAPSE_KEEP), { gap: run - 2 * COLLAPSE_KEEP }, ...rows.slice(j - COLLAPSE_KEEP, j));
		}
		i = j - 1;
	}
	return out;
}

const diffCell = (text, cls, marker) => text === null
	? '<div class="conflict-line filler" style="opacity:.3">&nbsp;</div>'
	: `<div class="conflict-line ${cls}"><span class="conflict-line-marker">${marker}</span>${esc(text) || "&nbsp;"}</div>`;
// EINE Tabelle mit zwei Spalten statt zwei getrennter Blöcke: die Ausrichtung hält dann
// auch bei umbrechenden Zeilen, und es gibt nur EINEN Scrollbereich — die Spalten können
// gar nicht mehr auseinanderlaufen. data-changeidx markiert den Beginn jedes Änderungsblocks
// (Sprungziel für „Nächste Änderung“).
function diffTableHtml(rows) {
	let changes = 0;
	const cellStyle = ' style="width:50%;vertical-align:top;padding:0 6px"';
	const body = rows.map((r) => {
		if (r.gap) return `<tr class="conflict-gap"><td colspan="2" style="text-align:center;opacity:.55;padding:6px 0">··· ${r.gap} unveränderte Zeilen ···</td></tr>`;
		const attr = r.changed && r.start ? ` data-changeidx="${changes++}"` : "";
		return `<tr${attr}><td${cellStyle}>` + diffCell(r.left, r.changed ? "local-only" : "same", r.changed ? "−" : "") +
			`</td><td${cellStyle}>` + diffCell(r.right, r.changed ? "remote-only" : "same", r.changed ? "+" : "") + "</td></tr>";
	}).join("");
	return { html: '<table class="conflict-diff-table" style="width:100%;table-layout:fixed;border-collapse:collapse">' + body + "</table>", changes };
}

function openConflictResolver(index) {
	let items = loadPendingConflicts();
	if (!items.length) items = legacyConflictItems();
	if (!items.length) return void U.toast("Keine offenen Konflikte.", "success");
	const i = Math.max(0, Math.min(Number(index) || 0, items.length - 1));
	let c = items[i];
	// Bug-1-Fix: Textfelder können fehlen, wenn localStorage-Quota beim Speichern überschritten wurde.
	// Rekonstruktion aus dem Live-Zustand: Konfliktkopie (conflictPageId) enthält den Verlierer-Stand,
	// die Original-Seite (pageId) enthält den Gewinner-Stand.
	if (!c.conflictType && !c.localContent && !c.remoteContent && c.pageId && c.conflictPageId) {
		const winnerPg = S.pages[c.pageId];
		const loserPg = S.pages[c.conflictPageId];
		if (winnerPg || loserPg) {
			const winnerContent = (winnerPg || {}).content || "";
			const loserContent = (loserPg || {}).content || "";
			c = { ...c,
				localContent: c.winner === "remote" ? loserContent : winnerContent,
				remoteContent: c.winner === "remote" ? winnerContent : loserContent,
				// FIX (25. Juli): loserContent wurde hier NIE mitrekonstruiert. „Stattdessen anderen
				// Stand übernehmen“ schickte dann patch.content = undefined und leerte die Seite.
				// Trat nur bei sehr großen Seiten auf — genau dort, wo der Quota-Fallback greift.
				loserContent: c.loserContent || loserContent,
			};
		}
	}
	// FIX (25. Juli): das rekonstruierte Objekt MUSS zurück in die Liste. resolveConflict liest
	// später S.conflictResolveList[i] — vorher wurde die Liste VOR der Rekonstruktion gesetzt,
	// die Reparatur landete also nur in einer lokalen Variablen und war beim Klick wieder weg.
	items[i] = c;
	S.conflictResolveIndex = i;
	S.conflictResolveList = items;
	const left = c.localContent || "", right = c.remoteContent || "";
	const hasTextComparison = !c.conflictType && !c.legacy && (!!left || !!right);
	const diff = hasTextComparison ? conflictDiff(left, right) : null;
	const table = diff ? diffTableHtml(alignDiffRows(diff)) : null;
	const winnerLabel = c.winner === "local" ? "Dieses Gerät" : "Drive / anderes Gerät";
	const conflictSummary = c.reason || (c.conflictType === "delete-change"
		? "Auf einem Gerät wurde die Seite gelöscht, während sie auf dem anderen Gerät noch geändert oder verschoben wurde. Die App kann diese beiden Aktionen nicht automatisch zusammenführen."
		: "Diese Seite wurde nach der letzten erfolgreichen Synchronisierung zweimal unabhängig geändert: auf diesem Gerät am " + fmtConflictTime(c.localTime) + " und in Drive am " + fmtConflictTime(c.remoteTime) + ". Deshalb kann die App nicht sicher entscheiden, welchen Text du behalten möchtest.");
	const headCell = (label, time) => `<th style="width:50%;text-align:left;padding:6px"><b>${label}</b>${time ? `<br><small>${esc(fmtConflictTime(time))}</small>` : ""}</th>`;
	const fullPane = (side, label, time, text) => `<section class="conflict-pane ${side}"><header><b>${label}</b><small>${esc(fmtConflictTime(time))}</small></header><div class="conflict-pane-body"><pre class="conflict-fulltext">${esc(text) || "(Kein Text vorhanden.)"}</pre></div></section>`;
	let comparisonHtml;
	if (!hasTextComparison) comparisonHtml = buildSpecialComparisonHtml(c);
	else if (table) {
		comparisonHtml = '<div class="conflict-compare conflict-compare-aligned">' +
			'<table style="width:100%;table-layout:fixed;border-collapse:collapse"><thead><tr>' +
			headCell("Dieses Gerät", c.localTime) + headCell("Drive / anderes Gerät", c.remoteTime) + "</tr></thead></table>" +
			'<div class="conflict-pane-body conflict-diff-scroll" id="conflictDiffScroll" style="max-height:46vh;overflow:auto">' +
			table.html + "</div></div>" +
			'<p class="conflict-key"><span>− Nur dieses Gerät</span><span>+ Nur Drive / anderes Gerät</span><span>Unmarkiert: gleich</span>' +
			(table.changes ? `<button type="button" class="mini" data-conflictdiffnext="1">↓ Nächste Änderung (${table.changes})</button>` : "") + "</p>";
	} else {
		comparisonHtml = '<div class="conflict-compare">' +
			fullPane("local", "Dieses Gerät", c.localTime, left) + fullPane("remote", "Drive / anderes Gerät", c.remoteTime, right) +
			'</div><p class="conflict-key">Sehr große Seite: Die beiden Fassungen unterscheiden sich auf über 400 Zeilen — eine zeilenweise Markierung wäre hier zu langsam. Beide Volltexte stehen nebeneinander.</p>';
	}
	// Blättern zwischen mehreren Konflikten: der Zähler „1 von N“ stand vorher da, ohne dass
	// man irgendwohin blättern konnte — man musste jeden Konflikt entscheiden, um den nächsten
	// überhaupt zu sehen. Jetzt ‹ / › plus „Später entscheiden“.
	const navHtml = items.length > 1
		? `<span class="conflict-nav"><button type="button" class="mini" data-conflictnav="-1" title="Vorheriger Konflikt">‹</button>` +
			`<span class="hint">${i + 1} von ${items.length}</span>` +
			`<button type="button" class="mini" data-conflictnav="1" title="Nächster Konflikt">›</button></span>`
		: "";
	openOverlay('<div class="modal conflict-modal">' +
		'<button class="modal-x" id="btnCloseOverlay" title="Schließen">✕</button>' +
		'<header class="conflict-head"><span class="conflict-icon">⚠</span><span><b>Synchronisation braucht eine Entscheidung' +
		`</b><small>“${esc(c.title || "Seite")}”</small></span>` + navHtml + "</header>" +
		'<div class="conflict-reason"><b>Warum sehe ich das?</b> ' + esc(conflictSummary) +
		(c.legacy ? "" : `<br><span class="hint">Die App empfiehlt: <b>${esc(winnerLabel)}</b> behalten, weil dieser Stand den neueren Zeitstempel hat.</span>`) +
		"</div>" + comparisonHtml +
		'<div class="conflict-actions"><button class="primary" data-conflictresolve="keep-winner">Empfehlung übernehmen</button>' +
		(c.pageId && !c.legacy ? '<button data-conflictresolve="use-loser">Stattdessen anderen Stand übernehmen</button>' : "") +
		(items.length > 1 ? '<button data-conflictnav="1">Später entscheiden ›</button>' : "") +
		"</div></div>");
}

// ‹ / › zwischen Konflikten und Sprung zur nächsten Änderung. Capture-Phase wie beim
// Modell-Stern, damit die Klicks nicht vorher in der allgemeinen Overlay-Delegation landen.
document.addEventListener("click", (e) => {
	const nav = e.target && e.target.closest && e.target.closest("[data-conflictnav]");
	if (nav && !nav.disabled) {
		e.preventDefault();
		e.stopPropagation();
		const list = S.conflictResolveList || loadPendingConflicts();
		if (!list.length) return;
		const step = Number(nav.dataset.conflictnav) || 0;
		openConflictResolver((((S.conflictResolveIndex || 0) + step) % list.length + list.length) % list.length);
		return;
	}
	const jump = e.target && e.target.closest && e.target.closest("[data-conflictdiffnext]");
	if (!jump) return;
	e.preventDefault();
	e.stopPropagation();
	const box = $("conflictDiffScroll");
	if (!box) return;
	const marks = [...box.querySelectorAll("[data-changeidx]")];
	if (!marks.length) return;
	// Nächste Änderung unterhalb der aktuellen Position — sonst wieder von vorne (Rundlauf).
	const boxTop = box.getBoundingClientRect().top;
	const next = marks.find((m) => m.getBoundingClientRect().top - boxTop > 8) || marks[0];
	box.scrollTo({ top: Math.max(0, box.scrollTop + next.getBoundingClientRect().top - boxTop - 40), behavior: "smooth" });
}, true);
async function resolveConflict(action) {
	const list = S.conflictResolveList || loadPendingConflicts();
	const i = S.conflictResolveIndex || 0;
	const conf = list[i];
	if (!conf) return;
	if (action === "use-loser" && conf.pageId) {
		// v8: Heft-Konflikte existieren nicht mehr (Striche liegen als Ereignisse im Log) —
		// der frühere Blob-Kopier-Zweig war seither unerreichbar und ist entfallen.
		if (conf.conflictType === "delete-change") {
			// Gerettete Kopie: Titel/Workspace/Elternordner aus dem Payload zurück (nicht Root)
			await STATE.dispatch("pageUpdate", { id: conf.conflictPageId, patch: { title: conf.title, parentId: conf.parentId || null, workspaceId: conf.workspaceId || "default" } });
		} else {
			await STATE.dispatch("pageUpdate", { id: conf.pageId, patch: { content: conf.loserContent } });
		}
	}
	if (conf.conflictPageId && S.pages[conf.conflictPageId] &&
		(action === "keep-winner" || (action === "use-loser" && conf.conflictType !== "delete-change"))) {
		await STATE.dispatch("pageTrash", { id: conf.conflictPageId });
	}
	// Pending bereinigen + Kopie lokal quittieren (sonst kommt derselbe Banner/Dialog
	// bei „Beide behalten“ nach dem nächsten Start wieder)
	markConflictResolved(conf.conflictPageId);
	const next = loadPendingConflicts().filter((x) => (x.conflictPageId || x.pageId) !== (conf.conflictPageId || conf.pageId));
	savePendingConflicts(next);
	if (next.length) { openConflictResolver(Math.min(i, next.length - 1)); render(); return; }
	const o = $("overlay");
	if (o) { o.hidden = true; o.innerHTML = ""; }
	U.toast("Konflikt erledigt.", "success");
	render();
}

// Home v4: persönliches Dashboard aus schaltbaren Bereichen. Sichtbarkeit und
// Reihenfolge kommen aus SETTINGS.homeLayout() (Einstellungen → Home) — die
// Bereichs-ids hier und in SETTINGS.HOME_SECTIONS sind identisch (EINE Quelle).
// Neu: Begrüßung mit Namen, ✨ „Für dich heute“ (Tipps aus den Lerndaten),
// 🃏 Stapel-Überblick (Klick lernt den Stapel) und ★ Favoriten.
const HOME_FOLD_KEY = "impala67HomeFolds";
const homeFolds = () => lsGet(HOME_FOLD_KEY, {}) || {};
const homeFoldOpen = (id, fb) => { const f = homeFolds(); return f[id] === undefined ? fb : !!f[id]; };
const homeFold = (id, summary, body, fbOpen) => `<details class="home-fold" data-fold="${id}"${homeFoldOpen(id, fbOpen) ? " open" : ""}><summary>${summary}</summary><div class="home-fold-body">${body}</div></details>`;
// <details>-Zustand persistieren — "toggle" blubbert nicht → Capture-Phase
document.addEventListener("toggle", (e) => {
	const el = e.target;
	if (!el || !el.matches || !el.matches("details[data-fold]")) return;
	lsSet(HOME_FOLD_KEY, { ...homeFolds(), [el.getAttribute("data-fold")]: el.open });
}, true);
function renderHome(main) {
	// Scroll-Anker: jedes Re-Render (Fold, Pins, Sync…) hüpfte sonst nach oben.
	// Zentral in util.js (U.scrollAnchor) — bewusst als Funktion übergeben, weil
	// .home beim Rebuild ersetzt werden kann und dann neu gesucht werden muss.
	const restoreScroll = U.scrollAnchor(() => main.querySelector(".home") || main);
	const pages = STATE.activePages();
	const conflictCount = Math.max(loadPendingConflicts().length, pages.filter(isConflictPage).length);
	const recent = pages.filter((p) => !isConflictPage(p)).slice().sort((a, b) => ((b.updated || "") < (a.updated || "") ? -1 : (b.updated || "") > (a.updated || "") ? 1 : 0)).slice(0, 6);
	const chats = CHATS.load().slice().sort((a, b) => ((b.updated || b.created || "") < (a.updated || a.created || "") ? -1 : (b.updated || b.created || "") > (a.updated || a.created || "") ? 1 : 0));
	const dueCards = STATE.dueCards();
	const due = dueCards.length;
	const homeStudy = STATE.studySnapshot(null).counts;
	// Backup-Empfehlungen bewusst entfernt („kommt noch“, 22. Juli): kein Backup-Pill
	// und kein Backup-Tipp mehr — Backups laufen weiter über Einstellungen → Backup.
	const daily = pages.find((p) => p.daily === localDayKey(new Date()));
	const dailyLine = daily ? ((daily.content || "").split("\n").find((l) => l.trim()) || "").replace(/^#+\s*/, "").slice(0, 48) : "";
	const hour = new Date().getHours();
	const greeting = hour < 5 ? "Gute Nacht" : hour < 11 ? "Guten Morgen" : hour < 18 ? "Guten Tag" : "Guten Abend";
	const dateLine = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
	const cardCount = ((STATE.activeCards && STATE.activeCards()) || Object.values(S.cards).filter((c) => !c.trashed)).length;
	const lzTotals = (LERNZEIT.totalsByDay && LERNZEIT.totalsByDay()) || null;
	const lz = (LERNZEIT.statsForHome && (lzTotals ? LERNZEIT.statsForHome(lzTotals) : LERNZEIT.statsForHome())) || { goalPct: 0 };
	// 7-Tage-Trend für die persönlichen Hinweise. Rückwärts-Durchlauf mit Frühabbruch
	// über den Review-Log; die ausführliche Wochenanalyse lebt zentral in lernzeit.js.
	const iso = (days) => new Date(Date.now() - days * 864e5).toISOString();
	const cut14 = iso(14), cut7 = iso(7);
	const win = { cur7: [0, 0], prev7: [0, 0] };
	const bump = (w, ok) => { w[0]++; if (ok) w[1]++; };
	const revs = S.reviews || [];
	for (let i = revs.length - 1; i >= 0; i--) {
		const r = revs[i];
		if (r.t < cut14) break;
		if (!(r.grade > 0)) continue;
		const ok = r.grade > 1;
		if (r.t >= cut7) bump(win.cur7, ok);
		else bump(win.prev7, ok);
	}
	const rate = (w) => w[1] / w[0];
	const trend = win.cur7[0] >= 10 && win.prev7[0] >= 10 ? rate(win.cur7) - rate(win.prev7) : null;
	// 🃏 fällige Karten je Wurzel-Stapel + ★-Seiten (Bereiche „Stapel“ / „Favoriten“)
	const dueByDeck = {};
	for (const c of dueCards) {
		const root = (c.deck || "Standard").split("::")[0];
		dueByDeck[root] = (dueByDeck[root] || 0) + 1;
	}
	const favPages = pages.filter((p) => p.favorite && !isConflictPage(p));
	const homeName = ((S.settings || {}).homeUserName || "").trim();

	const conflictBanner = conflictCount
		? `<div class="conflict-banner"><div class="conflict-banner-copy"><b>⚠ ${conflictCount} Sync-Konflikt${conflictCount === 1 ? "" : "e"}</b><span>Gleiche Seite auf mehreren Geräten geändert — Diff prüfen & lösen.</span></div><button data-conflictopen="0">Jetzt lösen</button></div>`
		: "";

	// Kompakte „Heute“-Leiste statt großer Widget-Kacheln
	const pill = (cls, attr, title, ico, b, small) => `<button class="home-pill${cls}" ${attr} title="${title}"><span class="home-pill-ico">${ico}</span><span class="home-pill-body"><b>${b}</b><small>${small}</small></span></button>`;
	const todayPills = '<div class="home-today">' +
		pill("", 'data-homeaction="daily"', "Daily Note", "📅", "Daily", esc(dailyLine || (daily ? "Öffnen" : "Heute anlegen"))) +
		pill(homeStudy.total ? " attention" : "", 'data-homeaction="cards"', "Karteikarten", "🃏", "Karteikarten", homeStudy.neu + " neu · " + homeStudy.review + " fällig · " + homeStudy.learn + " lernen") +
		pill("", 'data-noten-open="1"', "Schulnoten öffnen", "🎓", "Noten", "Eintragen & Schnitt ansehen") +
		"</div>";

	const continueBlock = recent[0]
		? `<button class="home-continue" data-page="${recent[0].id}"><span class="recent-icon">${esc(pageIconLabel(recent[0]))}</span><span class="recent-copy"><small>Weitermachen</small><b>${esc(recent[0].title)}</b><small>Zuletzt · ${U.fmtDate(recent[0].updated)}</small></span><span class="recent-arrow">›</span></button>`
		: '<button class="home-continue muted" data-homeaction="newpage"><span class="recent-icon">✦</span><span class="recent-copy"><small>Start</small><b>Erste Seite anlegen</b><small>Workspace ist noch leer</small></span><span class="recent-arrow">›</span></button>';

	const listRow = (attr, ico, b, small) => `<button class="home-list-row" ${attr}><span class="recent-icon sm">${ico}</span><b>${b}</b><small>${small}</small><i>›</i></button>`;
	const recentPages = recent.length
		? '<div class="home-list">' + recent.map((pg) => listRow(`data-page="${pg.id}"`, esc(pageIconLabel(pg)), esc(pg.title), U.fmtDate(pg.updated))).join("") + "</div>"
		: '<div class="empty-state compact"><b>Noch keine Seiten</b><p>Leg die erste an oder öffne die Bibliothek.</p><button data-homeaction="newpage">Neue Seite</button></div>';
	const recentChats = chats.slice(0, 3).map((c) => listRow(`data-chat="${c.id}"`, "✦", esc(c.title || "Chat"), U.fmtDate(c.updated || c.created))).join("");

	// ✨ „Für dich heute“ — wählt aus allen lokalen Daten (Lernzeit, Streak, Reviews,
	// Problemkarten, Backup-Alter, Daily) die 3 dringlichsten Hinweise; Reihenfolge = Priorität
	const leeches = Object.values(S.cards).filter((c) => !c.trashed && !c.suspended && ((c.srs || {}).lapses || 0) >= 4).length;
	const tips = [];
	if (lz.todaySeconds === 0 && lz.streakDays > 0 && hour >= 15) tips.push(['data-homeaction="cards"', "🔥", `${lz.streakDays}-Tage-Streak in Gefahr`, "Heute noch nichts gelernt — schon 5 Minuten zählen."]);
	if (due > 0) tips.push(['data-homeaction="cards"', "🃏", due > 20 ? `${due} Karten warten` : `Nur ${due} Karte${due === 1 ? "" : "n"} offen`, due > 20 ? "Früh anfangen entzerrt den Tag." : "Eine kurze Runde und du bist durch."]);
	if (trend !== null && trend <= -0.05) tips.push(['data-homeaction="cards"', "📉", "Erfolgsquote sinkt", `${Math.round(rate(win.cur7) * 100)} % diese Woche (davor ${Math.round(rate(win.prev7) * 100)} %) — kleinere Portionen, dafür täglich.`]);
	if (leeches >= 3) tips.push(['data-homeaction="cards"', "🧗", `${leeches} hartnäckige Karten`, "Mindestens 4-mal vergessen — umformulieren oder aufteilen hilft."]);
	if (!daily && hour >= 17) tips.push(['data-homeaction="daily"', "📅", "Noch keine Daily Note", "Ein kurzer Tagesrückblick festigt das Gelernte."]);
	if (trend !== null && trend >= 0.05) tips.push(['data-homeaction="cards"', "📈", "Erfolgsquote steigt", `${Math.round(rate(win.cur7) * 100)} % richtig diese Woche — dranbleiben!`]);
	if (!tips.length) tips.push(['data-homeaction="library"', "✅", "Alles im grünen Bereich", "Nichts Dringendes — guter Moment zum Vertiefen oder Aufräumen."]);
	const forYou = '<div class="home-list">' + tips.slice(0, 3).map((tp) => listRow(tp[0], tp[1], tp[2], tp[3])).join("") + "</div>";

	// 🃏 Stapel-Überblick (Klick = diesen Stapel lernen) und ★ Favoriten
	const deckNames = Object.keys(dueByDeck).sort((a, b) => dueByDeck[b] - dueByDeck[a]).slice(0, 6);
	const deckRows = deckNames.length
		? '<div class="home-list">' + deckNames.map((d) => listRow(`data-ankistudy="${esc(d)}"`, "🃏", esc(d), dueByDeck[d] + " fällig — jetzt lernen")).join("") + "</div>"
		: '<div class="empty-state compact"><b>Nichts fällig</b><p>Alle Stapel sind für den Moment gelernt. 🎉</p></div>';
	const favRows = favPages.length
		? '<div class="home-list">' + favPages.slice(0, 6).map((pg) => listRow(`data-page="${pg.id}"`, esc(pageIconLabel(pg, "★")), esc(pg.title), U.fmtDate(pg.updated))).join("") + "</div>"
		: '<div class="empty-state compact"><b>Noch keine Favoriten</b><p>Der ☆-Stern oben rechts auf einer Seite pinnt sie hierher.</p></div>';

	// Bereichs-Bausteine — ids identisch mit SETTINGS.HOME_SECTIONS (Einstellungen → Home)
	const SECTION_HTML = {
		foryou: homeFold("foryou", '✨ Für dich heute <span class="fold-meta">aus deinen Lerndaten</span>', forYou, true),
		continue: '<section class="home-section home-section-continue">' + continueBlock + "</section>",
		today: todayPills,
		insights: LERNZEIT.homeWidgetHtml(lzTotals, lz),
		decks: homeFold("decks", `🃏 Stapel <span class="fold-meta">${due} fällig</span>`, deckRows, true),
		favorites: homeFold("favorites", `★ Favoriten <span class="fold-meta">${favPages.length}</span>`, favRows, true),
		recent: homeFold("recent", `📄 Zuletzt <span class="fold-meta">${pages.length} Seiten</span>`, recentPages + '<div class="fold-foot"><button class="mini" data-homeaction="library">Bibliothek öffnen ›</button></div>', true),
		chats: recentChats ? homeFold("chats", `✦ Chats <span class="fold-meta">${chats.length}</span>`, '<div class="home-list">' + recentChats + '</div><div class="fold-foot"><button class="mini" data-homeaction="chats">Alle Chats ›</button></div>', false) : "",
	};
	// Jeder Bereich lässt sich direkt vom Homescreen ausblenden (✕): Folds tragen das ✕
	// in der Summary, alle übrigen Bereiche bekommen einen Hover-Wrapper mit ✕-Button.
	const sectionsHtml = SETTINGS.homeLayout().filter((e) => e.on).map((e) => SECTION_HTML[e.id] || "").join("");
	const homeHtml = '<div class="home home-v2 home-slim" data-key="home">' +
		`<header class="home-hero"><div><h1>${greeting}${homeName ? ", " + esc(homeName) : ""} 👋</h1><p class="home-meta">${dateLine}</p><div class="home-hero-meta">` +
			`<span class="home-chip">📄 <b>${pages.length}</b> Seiten</span><span class="home-chip">🃏 <b>${cardCount}</b> Karten</span><span class="home-chip">✦ <b>${chats.length}</b> Chats</span>` +
			`<span class="home-chip${lz.goalPct < 100 ? " warn" : ""}">🎯 Wochenziel <b>${lz.goalPct} %</b></span>` +
		'</div></div><button class="home-customize" data-set="home" title="Homeseite anpassen (Bereiche & Begrüßung)">⚙</button></header>' +
		conflictBanner +
		'<div class="quick-actions"><button data-homeaction="newpage">+ Neue Seite</button></div>' +
		sectionsHtml + "</div>";
	// PERF: nur neu aufbauen, wenn sich das Markup wirklich geändert hat.
	// v14: angleichen statt ersetzen — offene <details>, Scroll und Hover bleiben
	// dadurch von allein erhalten (der zentrale Scroll-Anker unten greift nur noch,
	// wenn der Bereich komplett neu entsteht).
	if (main._lastHomeHtml === homeHtml && main.querySelector(".home")) return;
	U.morph(main, homeHtml);
	main._lastHomeHtml = homeHtml;
	restoreScroll();
}

// Papierkorb: Seiten, Stapel, Karten — Soft-Delete mit Wiederherstellen / Endgültig löschen
const trashRow = (kind, id, title, hint) =>
	`<div class="trash-row"><span class="row-title">${title}</span><span class="hint">${hint}</span>` +
	`<button data-${kind}restore="${id}">↩ Wiederherstellen</button><button data-${kind}purge="${id}" class="danger">🗑 Endgültig löschen</button></div>`;
function renderTrash(main) {
	const pages = STATE.trashedPages();
	const decks = (STATE.trashedDeckRoots && STATE.trashedDeckRoots()) || [];
	const cards = (STATE.orphanTrashedCards && STATE.orphanTrashedCards()) || [];
	let html = '<div class="library"><div class="lib-head"><div><h1>🗑 Papierkorb</h1><p class="hint">Seiten, Stapel und Karten — wiederherstellbar, bis du sie endgültig löschst.</p></div><button class="danger" data-trashclear="1">Papierkorb leeren</button></div>';
	if (!pages.length && !decks.length && !cards.length) {
		U.morph(main, html + '<p class="hint">Der Papierkorb ist leer.</p></div>');
		return;
	}
	const head = (label) => `<div class="ws-head"><span class="ws-name">${label}</span></div>`;
	html += '<div class="trash-list">';
	if (pages.length) html += head("Seiten") + pages.map((pg) => trashRow("page", pg.id, pageIconHtml(pg) + esc(pg.title), "gelöscht " + U.fmtDate(pg.trashedAt || pg.updated))).join("");
	if (decks.length) html += head("Stapel") + decks.map((name) => {
		const n = Object.values(S.cards).filter((c) => c.trashed && ((c.deck || "Standard") === name || (c.deck || "Standard").startsWith(name + "::"))).length;
		return trashRow("deck", esc(name), "🃏 " + esc(name) + (n ? ` · ${n} Karte(n)` : ""), "gelöscht " + U.fmtDate((S.decks[name] || {}).trashedAt || ""));
	}).join("");
	if (cards.length) html += head("Karten") + cards.map((c) => {
		const front = (c.front || "").replace(/\s+/g, " ").trim();
		return trashRow("card", c.id, "🃏 " + esc((front.length > 60 ? front.slice(0, 60) + "…" : front) || "(leere Vorderseite)"), esc(c.deck || "Standard") + " · gelöscht " + U.fmtDate(c.trashedAt || ""));
	}).join("");
	// U.morph statt innerHTML (Regel aus util.js): Scrollstand und Hover bleiben erhalten,
	// wenn eine Zeile wiederhergestellt oder endgültig gelöscht wird.
	U.morph(main, html + "</div></div>");
}

// Cover/Bilder nach dem Rendern nachladen (innerHTML kann kein async)
// Object-URLs kommen aus DB.blobUrl — ein Cache für die ganze App (siehe db.js).
function hydrateCovers(root) {
	(root || document).querySelectorAll("[data-coverimg]").forEach(async (el) => {
		if (el.dataset.coverHydrated) return;
		el.dataset.coverHydrated = "1";
		// data-owned: das Hintergrundbild steckt in einem style-Attribut, das im erzeugten
		// Markup nicht vorkommt — ohne diesen Schutz würde U.morph es beim nächsten Render
		// wieder entfernen und das Cover wäre weiß. Ein ANDERES Cover hat ein anderes
		// data-key und bekommt darum trotzdem ein frisches Element.
		el.dataset.owned = "1";
		const u = await DB.blobUrl(el.dataset.coverimg, "image/jpeg");
		if (u) el.style.backgroundImage = `url('${u}')`;
	});
}
function hydrateImages(root) {
	(root || document).querySelectorAll('img[src^="img:"]').forEach(async (img) => {
		const u = await DB.blobUrl(img.getAttribute("src"), "image/png");
		if (u) img.src = u;
	});
}

// Lokaler Tages-Schlüssel "YYYY-MM-DD" (bewusst NICHT toISOString — Zeitzone!)
function localDayKey(x) {
	const d = new Date(x);
	return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// Daily Notes (📅): Monatskalender, jeder Tag eine eigene Seite
function renderDaily(main) {
	const now = new Date();
	const cur = S.dailyMonth ? new Date(S.dailyMonth + "-01T12:00:00") : new Date(now.getFullYear(), now.getMonth(), 1);
	const y = cur.getFullYear(), mo = cur.getMonth();
	const todayKey = localDayKey(now);
	const notes = {};
	STATE.activePages().forEach((p) => { if (p.daily) notes[p.daily] = p; });
	const startOffset = (new Date(y, mo, 1).getDay() + 6) % 7; // Montag = 0
	let cells = '<div class="cal-day other"></div>'.repeat(startOffset);
	for (let d = 1, days = new Date(y, mo + 1, 0).getDate(); d <= days; d++) {
		const key = y + "-" + String(mo + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
		const pg = notes[key];
		const snippet = pg ? ((pg.content || "").split("\n").find((l) => l.trim()) || "") : "";
		cells += `<div class="cal-day${key === todayKey ? " today" : ""}${pg ? " has-note" : ""}" data-dailyday="${key}" title="${key}"><span class="cal-num">${d}</span>${pg ? `<span class="cal-snippet">${esc(snippet.slice(0, 70))}</span>` : ""}</div>`;
	}
	U.morph(main, '<div class="library daily"><div class="lib-head"><h1>📅 Daily Notes</h1>' +
		'<div class="mode-btns"><button data-dailynav="-1" title="Voriger Monat">‹</button><button id="btnDailyToday">Heute</button><button data-dailynav="1" title="Nächster Monat">›</button></div>' +
		`<span class="hint">${cur.toLocaleDateString("de-DE", { month: "long", year: "numeric" })} — Tag anklicken öffnet (oder erstellt) die Tagesseite</span></div>` +
		'<div class="cal-grid cal-head-row">' + ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((d) => `<div class="cal-dow">${d}</div>`).join("") + "</div>" +
		'<div class="cal-grid">' + cells + "</div></div>");
}

// Anlege-Dialog: Notion-Seite oder GoodNotes-Heft, Vorlagen darunter
function openTemplatePicker() {
	const tpls = STATE.activePages().filter((p) => p.isTemplate);
	openOverlay(modal(
		"<h3>Neu anlegen</h3>" +
		'<div class="newpage-cards">' +
			'<button type="button" class="newpage-card" data-tplblank="1"><span class="newpage-visual is-notion" aria-hidden="true"><i></i><i></i><i></i></span><b>Notion-Seite</b><small>Blöcke · Markdown · Verlinkungen</small></button>' +
			'<button type="button" class="newpage-card" data-tplheft="1"><span class="newpage-visual is-heft" aria-hidden="true"><span></span></span><b>GoodNotes-Heft</b><small>Papier · Stift · Seiten</small></button>' +
		"</div>" +
		(tpls.length ? '<p class="hint">Oder aus einer Vorlage:</p>' : "") +
		tpls.map((p) => `<button class="tpl-opt" data-tpluse="${p.id}">${p.icon ? esc(p.icon) + " " : (p.kind === "heft" ? "📓 " : "📑 ")}${esc(p.title)}</button>`).join("") +
		'<div class="modal-actions"><button id="btnCloseOverlay">Abbrechen</button></div>'
	));
}

// Verlauf: Versionsliste (Event-Log) links, Vorschau rechts; Wiederherstellen
// erzeugt ein NEUES Event — der Verlauf bleibt vollständig
function renderHistoryModal() {
	const vs = S.histVersions || [];
	const idx = Math.max(0, Math.min(S.histIndex, vs.length - 1));
	const v = vs[idx];
	const items = vs.map((x, i) => ({ x, i })).reverse().slice(0, 50).map(({ x, i }) =>
		`<button class="hist-item${i === idx ? " active" : ""}" data-histversion="${i}">${new Date(x.t).toLocaleString("de-DE", DATETIME_OPTS)}${i === vs.length - 1 ? ' <span class="hint">aktuell</span>' : ""}</button>`).join("");
	const o = openOverlay('<div class="modal hist-modal">' +
		'<button class="modal-x" id="btnCloseOverlay" title="Schließen">✕</button>' +
		'<div class="hist-list"><h3>🕘 Verlauf</h3>' + (items || '<p class="hint">Keine Versionen</p>') + "</div>" +
		`<div class="hist-preview"><h3>${esc(v ? v.title : "")}</h3><div class="md hist-md">${v ? U.md(v.content) : ""}</div>` +
		`<div class="modal-actions"><button id="btnHistRestore" ${!v || idx === vs.length - 1 ? "disabled" : ""}>↩ Diese Version wiederherstellen</button></div></div></div>`);
	const pv = o && o.querySelector(".hist-md");
	if (pv) { U.renderMath(pv); U.highlightCode(pv); hydrateImages(pv); }
}

// ---------- Chat: Nachrichten, Thinking (live + final), Edit-Karten, Datei-Chips ----------
// locked = darunter stehen nicht rückgängig gemachte Edits. Wird EINMAL pro Durchlauf aus der
// Liste bestimmt statt pro Blase — vorher findIndex + slice je Nachricht, also quadratisch.
function userMsgHtml(m, locked) {
	return '<div class="msg user">' +
		`<button class="msg-edit${locked ? " locked" : ""}" data-editmsg="${m.mid}" title="${locked ? "Erst spätere Änderungen rückgängig machen" : "Bearbeiten"}">${locked ? ICONS.lock : ICONS.pen}</button>` +
		(m.content ? esc(m.content) : "") +
		(m.image ? `<img class="msg-img" src="${m.image}" alt="Anhang">` : "") +
		(m.textFile ? fileChipHtml(m) : "") +
		(m.pdfFile ? `<div class="file-chip"><span>📄 ${esc(m.pdfFile.name)} · ${m.pdfFile.pages || "?"} Seiten</span></div>` : "") +
		"</div>";
}

// Lange geklebte Texte als .txt-Karte (Modell bekommt den Inhalt trotzdem als Kontext)
const fileChipHtml = (m) => `<div class="file-chip"><span>📄 ${esc(m.textFile.name)} · ${m.textFile.size} Zeichen</span><button data-filedownload="${m.mid}">Herunterladen</button></div>`;

// Werkzeug-Karte je Tool-Aufruf („Hat … verwendet“)
const TOOL_LABELS = {
	inspect: "App-Daten gelesen", change: "Änderungen ausgeführt", view_heft_page: "Heftseite angesehen",
	read_page: "Seite gelesen", search_notes: "Notizen durchsucht", semantic_search: "Semantische Suche",
	create_page: "Seite erstellt", append_to_page: "Seite ergänzt", replace_page_content: "Seite überschrieben",
	create_flashcard: "Karteikarte erstellt", create_cloze_card: "Cloze-Karten erstellt", move_page: "Seite verschoben",
	list_pages: "Seiten aufgelistet", list_due_cards: "Fällige Karten", send_to_notebooklm: "An NotebookLM",
	ask_choice: "Rückfrage gestellt", delete_page: "Seite gelöscht", delete_flashcard: "Karte gelöscht", delete_deck: "Stapel gelöscht",
	// 26. Juli: Karten-Verwaltung, Hefte und Werkzeuge zeigten bisher nur ihren rohen
	// Tool-Namen im Chip (z.B. „move_flashcards“) — jetzt alle mit Klartext-Beschriftung.
	create_flashcards: "Karteikarten erstellt", delete_flashcards: "Karten gelöscht", list_flashcards: "Karten durchgesehen",
	list_decks: "Stapel aufgelistet", create_deck: "Stapel angelegt", rename_deck: "Stapel umbenannt", move_deck: "Stapel verschoben",
	move_flashcards: "Karten verschoben", update_flashcard: "Karte überarbeitet", suspend_flashcards: "Karten pausiert",
	reset_card_progress: "Lernfortschritt zurückgesetzt", get_context: "Kontext geholt",
	write_to_heft: "Ins Heft geschrieben", get_heft_page_image: "Heftseite angesehen",
	search_chat_history: "Frühere Chats durchsucht", calculate: "Gerechnet", request_tools: "Werkzeuge freigeschaltet",
};
const toolChipHtml = (m) => `<div class="tool-chip${m.error ? " err" : ""}" title="Werkzeug: ${esc(m.name)}">${ICONS.gear} ${esc(TOOL_LABELS[m.name] || m.name)}${m.detail ? ` <span class="tool-detail">· ${esc(m.detail)}</span>` : ""}${m.error ? " — Fehler" : ""}</div>`;

// Markup EINER fertigen Nachricht (der Live-Entwurf läuft getrennt)
function msgHtml(m, locked) {
	return m.role === "edit" ? editCardHtml(m)
		: m.role === "question" ? questionCardHtml(m)
		: m.role === "tool" ? toolChipHtml(m)
		: m.role === "assistant" ? assistantMsgHtml(m)
		: userMsgHtml(m, locked);
}

function chatLiveParts(historyList) {
	if (!S.aiBusy) return { think: "", rest: "" };
	// Maßgeblich ist der CHAT-TYP, nicht die Identität des Arrays: lädt man während einer
	// laufenden Antwort einen anderen Chat, ist S.sideChat ein NEUES Array — die
	// „Denkt nach“-Box verschwand dadurch mitten im Denken, obwohl die KI weiterlief.
	const type = historyList === S.chat ? "full" : "side";
	if ((S.aiActiveChatType || "side") !== type) return { think: "", rest: "" };
	const activeList = historyList;
	// Offene ask_choice-Karte IST der Wartezustand — keine zweite busy-Zeile
	const waitingChoice = activeList.some((m) => m.role === "question" && !m.answered);
	// Think-Box UND Draft parallel — sonst wirkt geleaktes Reasoning wie die Antwort
	const think = S.aiThinkingDraft ? thinkingLiveHtml() : "";
	const rest = S.aiDraft ? '<div class="msg assistant busy"><div class="md">' + U.md(S.aiDraft) + "</div></div>"
		: (!S.aiThinkingDraft && !waitingChoice ? '<div class="msg assistant busy">' + esc(S.aiStatus || "…") + "</div>" : "");
	return { think, rest };
}

// PERF-WURZEL: Der Verlauf wird nachrichtenweise abgeglichen. Vorher entschied EIN Hash über
// den ganzen Verlauf, ob das komplette Protokoll neu gebaut wird — jede fertige Nachricht,
// jedes Undo und jede beantwortete Rückfrage warf ALLE Blasen weg und ließ KaTeX/Highlighting
// über den ganzen Chat erneut laufen. Der Hash selbst lief zudem bei JEDEM Streaming-Frame über
// alle Felder aller Nachrichten (inkl. Bild-Data-URLs), zweimal (Panel + Vollbild).
// Jetzt: je Blase ein kurzer Kennwert aus genau den Werten, die ihr Aussehen bestimmen —
// konstanter Aufwand pro Nachricht, Neuaufbau nur dort, wo sich wirklich etwas geändert hat.
// Lange Texte gehen über Länge + Anfang + Ende ein (Bild-Data-URLs nie ganz).
const brief = (v) => { const s = v == null ? "" : String(v); return s.length > 128 ? s.length + s.slice(0, 64) + s.slice(-64) : s; };
const midOf = (m, i) => String(m.mid ?? "i" + i);
const rowKeyOf = (m, i, locked) => [
	midOf(m, i), m.role, brief(m.content), brief(m.reasoning), brief(m.image), brief(m.summary),
	m.undone ? 1 : 0, m.answered ? 1 : 0, m.answer || "", m.reasoningExpanded ? 1 : 0,
	m.error ? 1 : 0, m.detail || "", m.name || "", m.pageTitle || "",
	(m.textFile || m.pdfFile || {}).name || "", locked ? 1 : 0,
	// FIX: Das „Anpassen“-Menü hängt an S.refineOpenMid, nicht an der Nachricht — es floss nirgends
	// in den Vergleich ein. Der Klick blieb wirkungslos, bis zufällig etwas anderes neu baute.
	S.refineOpenMid === m.mid ? 1 : 0,
].join("");

const enhance = (nodes) => nodes.forEach((n) => { if (n.nodeType === Node.ELEMENT_NODE) { U.renderMath(n); U.highlightCode(n); } });
// Baut eine Blase und setzt sie vor `before` ein. Formel-/Code-Satz nur über diese Knoten.
function buildRow(m, locked, before) {
	const tpl = document.createElement("template");
	tpl.innerHTML = msgHtml(m, locked);
	const nodes = [...tpl.content.childNodes];
	before.before(tpl.content);
	enhance(nodes);
	return nodes;
}

// Gleicht die fertigen Nachrichten vor `end` an `list` an. Rückgabe: wurde etwas verändert?
function chatStaticPlan(log, list) {
	const rows = log._chatRows || (log._chatRows = []);
	// Ab dem letzten offenen Edit ist Bearbeiten gesperrt — einmal bestimmt statt pro Blase gesucht
	let lastOpenEdit = -1;
	for (let i = 0; i < list.length; i++) if (list[i].role === "edit" && !list[i].undone) lastOpenEdit = i;
	if (rows.length !== list.length) return { dirty: true, lastOpenEdit };
	for (let i = 0; i < list.length; i++) {
		const locked = i < lastOpenEdit;
		if (rows[i].mid !== midOf(list[i], i) || rows[i].key !== rowKeyOf(list[i], i, locked)) return { dirty: true, lastOpenEdit };
	}
	return { dirty: false, lastOpenEdit };
}

function syncChatStatic(log, list, end, lastOpenEdit) {
	const rows = log._chatRows || (log._chatRows = []);
	let dirty = false, i = 0;
	for (; i < rows.length && i < list.length; i++) {
		const locked = i < lastOpenEdit;
		const key = rowKeyOf(list[i], i, locked);
		if (rows[i].key === key) continue;
		// Andere Nachricht an dieser Stelle = Liste ab hier umgebaut: Rest verwerfen statt patchen
		if (rows[i].mid !== midOf(list[i], i)) break;
		const nodes = buildRow(list[i], locked, rows[i].nodes[0]);
		rows[i].nodes.forEach((n) => n.remove());
		rows[i] = { mid: midOf(list[i], i), key, nodes };
		dirty = true;
	}
	for (let k = rows.length - 1; k >= i; k--) { rows[k].nodes.forEach((n) => n.remove()); rows.pop(); dirty = true; }
	for (; i < list.length; i++) {
		const locked = i < lastOpenEdit;
		rows.push({ mid: midOf(list[i], i), key: rowKeyOf(list[i], i, locked), nodes: buildRow(list[i], locked, end) });
		dirty = true;
	}
	return dirty;
}

function renderChatLog(log, historyList) {
	// FIX (26. Juli): Scroll-Position VOR jeder DOM-Änderung merken. Beim Neuaufbau werden alle
	// fertigen Nachrichten entfernt und neu eingesetzt — dabei schrumpft scrollHeight kurz auf
	// (fast) 0 und der Browser klemmt scrollTop auf 0. Genau das war der Sprung nach oben,
	// sobald man eine Rückfrage/Löschbestätigung beantwortet hat (answered → neue Signatur →
	// Rebuild): der Chat stand plötzlich am Anfang und der Gedankengang schien verschwunden.
	// Zentral gelöst in util.js: U.scrollAnchor merkt Position UND "stand am Ende"
	// und zieht beides über die nächsten Frames nach (Bilder/LaTeX brauchen Frames).
	historyList ||= [];
	let staticEnd = log._chatStaticEnd, live = log._chatLive;
	// Fertige Nachrichten bleiben direkte Kinder (CSS/Event-Delegation); nur der
	// Live-Bereich bekommt einen unsichtbaren Container als Patch-Ziel
	if (!staticEnd || !live || staticEnd.parentNode !== log || live.parentNode !== log) {
		staticEnd = document.createComment("chat-static-end");
		live = document.createElement("div");
		live.className = "chat-live";
		live.style.display = "contents";
		log.replaceChildren(staticEnd, live);
		log._chatStaticEnd = staticEnd;
		log._chatLive = live;
		log._chatRows = [];
	}
	// FIX: Live-Bereich nicht mehr pro Streaming-Delta per innerHTML ersetzen —
	// Klicks zwischen Mousedown/-up gingen verloren, die Think-Box ließ sich nie
	// aufklappen. Think und Draft getrennt patchen, Toggle bleibt stabil im DOM
	const liveParts = chatLiveParts(historyList);
	let thinkHost = live._thinkHost, restHost = live._restHost;
	if (!thinkHost || !restHost || thinkHost.parentNode !== live || restHost.parentNode !== live) {
		thinkHost = document.createElement("div");
		thinkHost.style.display = "contents";
		restHost = document.createElement("div");
		restHost.style.display = "contents";
		live.replaceChildren(thinkHost, restHost);
		live._thinkHost = thinkHost;
		live._restHost = restHost;
		thinkHost._structure = null;
		restHost._chatHtml = null;
	}
	const staticPlan = chatStaticPlan(log, historyList);
	const thinkStructure = liveParts.think ? "think:" + (S.thinkingLiveExpanded ? "1" : "0") : "";
	const currentThinkBody = thinkHost.querySelector(".think-body");
	const nextThinkText = liveParts.think ? (S.thinkingLiveExpanded ? S.aiThinkingDraft : U.lastLines(S.aiThinkingDraft, 2)) : "";
	const liveDirty = thinkHost._structure !== thinkStructure
		|| (!!liveParts.think && currentThinkBody?.textContent !== nextThinkText)
		|| restHost._chatHtml !== liveParts.rest;
	// Unveränderte Logs sind beim Tabwechsel der Normalfall. Dann keine
	// Layout-Messung und kein Scroll-Nachziehen über mehrere Animationsframes.
	if (!staticPlan.dirty && !liveDirty) return;
	const restoreScroll = U.scrollAnchor(log, { bottomPad: 160 });
	const wasNearBottom = restoreScroll.atBottom;
	if (staticPlan.dirty && syncChatStatic(log, historyList, staticEnd, staticPlan.lastOpenEdit) && !wasNearBottom) restoreScroll();
	if (thinkHost._structure !== thinkStructure) {
		thinkHost.innerHTML = liveParts.think;
		thinkHost._structure = thinkStructure;
	} else if (liveParts.think) {
		const body = thinkHost.querySelector(".think-body");
		const thinkText = S.thinkingLiveExpanded ? S.aiThinkingDraft : U.lastLines(S.aiThinkingDraft, 2);
		if (body && body.textContent !== thinkText) {
			body.textContent = thinkText;
			if (S.thinkingLiveExpanded) body.scrollTop = body.scrollHeight; // am neuesten Gedanken bleiben
		}
	}
	if (restHost._chatHtml !== liveParts.rest) {
		restHost.innerHTML = liveParts.rest;
		restHost._chatHtml = liveParts.rest;
		U.renderMath(restHost);
		U.highlightCode(restHost);
	}
	// Ans Ende folgen — außer der Nutzer hat hochgescrollt, um nachzulesen. Maßgeblich ist
	// die Position VOR dem Rebuild (danach wäre sie durch das Neu-Einsetzen verfälscht).
	if (wasNearBottom || !log._chatAutoScrolled) { log.scrollTop = log.scrollHeight; log._chatAutoScrolled = true; }
	else restoreScroll();
}

// Rückfrage-Karte (ask_choice): Frage + Options-Zeilen, nach Klick nur die Antwort
function questionCardHtml(m) {
	if (m.answered) {
		return `<div class="msg assistant question-card answered"><div class="q-label">Rückfrage</div><div class="q-text">${esc(m.question)}</div><div class="q-picked"><span class="q-check">✓</span> <b>${esc(m.answer)}</b></div></div>`;
	}
	const opts = Array.isArray(m.options) ? m.options : [];
	return `<div class="msg assistant question-card pending" data-qmid="${esc(m.mid)}"><div class="q-label">Rückfrage</div><div class="q-text">${esc(m.question)}</div><div class="q-options">` +
		opts.map((o, i) => `<button type="button" class="q-opt" data-answerq="${esc(m.mid)}" data-answeridx="${i}"><span class="q-opt-label">${esc(o)}</span></button>`).join("") + "</div></div>";
}

// Seitenkontext ist einfach ein weiterer Anhang-Chip: gleiches Markup, gleiche Klassen
// und dasselbe ✕ wie Bild/PDF/Textdatei. „Entfernt“ hält nur, bis die Seite neu
// geöffnet wird (tabs.js setzt S.sideContextOff zurück) — nichts wird gespeichert.
// EIN Bauplan für beide Composer: ai.js schickt die geöffnete Seite seit dem 27. Juli in
// JEDEM Chat mit, angezeigt wurde das aber nur im Seitenpanel — im Vollbild-Chat sah man
// nie, dass Kontext mitgeht (Roadmap-Bug „Seitenkontext wird visuell nicht mitgeschickt“).
function contextChipHtml() {
	const pg = S.currentPageId ? S.pages[S.currentPageId] : null;
	// Im Karteikarten-Bereich schickt ai.js bewusst KEINEN Seitenkontext — ein Chip wäre gelogen.
	if (!pg || S.view === "anki" || S.sideContextOff === pg.id) return "";
	// Gleiche Auflösung wie in ai.js: Heft direkt offen ODER via HEFT.activeId eingebettet.
	// Sonst zeigte der Chip 📄 + Titel der Elternseite, obwohl eine Heft-Seite als Bild reist.
	const heft = pg.kind === "heft" ? pg : (HEFT.activeId ? S.pages[HEFT.activeId] : null);
	const isHeft = !!(heft && heft.kind === "heft");
	const title = (isHeft ? heft.title : pg.title) || "Unbenannte Seite";
	// FIX: Der Chip behauptete immer „wird mitgesendet“, obwohl ai.js den Seitentext kappt.
	// Bei langen Seiten wirkte es dadurch, als würde Kontext verschluckt. Jetzt steht dort,
	// wie viel wirklich mitging (ai.js legt das nach jeder Anfrage in S.pageCtxInfo ab).
	const info = S.pageCtxInfo && S.pageCtxInfo.id === pg.id ? S.pageCtxInfo : null;
	const k = (n) => (n >= 1000 ? Math.round(n / 1000) + "k" : String(n));
	const meta = isHeft
		? "Heft · Seite " + ((HEFT.activeIndex || 0) + 1) + " wird als Bild mitgesendet"
		: info && info.sent < info.total
			? "Seitenkontext · Anfang mitgesendet (" + k(info.sent) + " von " + k(info.total) + " Zeichen) — Rest auf Nachfrage"
			: "Seitenkontext · wird mitgesendet";
	return `<span class="chip-ico">${isHeft ? "📓" : "📄"}</span><span class="chip-body"><b>${esc(title)}</b><small>${esc(meta)}</small></span><button class="chip-x" data-removecontext="1" title="Seitenkontext entfernen">✕</button>`;
}

function renderSideContextChip() {
	const chip = $("sideContextChip");
	if (!chip) return;
	const html = contextChipHtml();
	chip.hidden = !html;
	chip.innerHTML = html;
}

// Verlauf-Dropdown im Seitenchat — bewusst KEINE eigene Chat-Liste: dieselbe
// CHATS.load()-Quelle wie die Sidebar, nur als kleines Menü am Uhr-Knopf. Die Auswahl
// führt den alten Chat IM PANEL weiter (data-sidechat, app.js).
function renderChatHistMenu() {
	const m = $("chatHistMenu");
	if (!m) return;
	m.hidden = !S.chatHistOpen;
	if (!S.chatHistOpen) return;
	const list = CHATS.load();
	m.innerHTML = list.length
		? list.map((s) => `<div class="row${s.id === S.sideChatId ? " active" : ""}" data-sidechat="${esc(s.id)}"><span class="row-title">${esc(s.title || "Chat")}</span><span class="hint">${U.fmtDate(s.updated || s.created)}</span></div>`).join("")
		: '<div class="menu-note">Noch keine gespeicherten Chats.</div>';
	POPOVERS.position($("btnChatHist"), m, { align: "end", gap: 6 });
	if (!m._wired) { // einmalig: Klick daneben schließt das Menü
		m._wired = true;
		document.addEventListener("click", (e) => {
			const t = e.target instanceof Element ? e.target : null;
			if (!S.chatHistOpen || (t && (m.contains(t) || t.closest("#btnChatHist")))) return;
			S.chatHistOpen = false;
			m.hidden = true;
		});
	}
}

function renderChat() {
	renderSideContextChip();
	renderChatHistMenu();
	const log = $("chatLog");
	if (log) renderChatLog(log, S.sideChat);
}

// Ganze Chat-Ansicht statt nur des Logs behalten: Header, Composer, Entwurf und
// Nachrichten sind eine Einheit. Maximal sechs geparkte DOM-Bäume begrenzen RAM.
const CHATVIEW_CACHE = new Map(); // chatId → .chat-full-wrap
function cacheChatView(wrap) {
	if (!wrap) return;
	const key = String(wrap.dataset.chatid || "");
	CHATVIEW_CACHE.delete(key);
	CHATVIEW_CACHE.set(key, wrap);
	for (const oldKey of CHATVIEW_CACHE.keys()) {
		if (CHATVIEW_CACHE.size <= 6) break;
		CHATVIEW_CACHE.delete(oldKey);
	}
}
function parkFullChat(main, keepKey) {
	const wrap = main.querySelector(":scope > .chat-full-wrap");
	if (!wrap || wrap.dataset.chatid === keepKey) return;
	wrap.remove();
	cacheChatView(wrap);
}
function takeChatView(key) {
	const wrap = CHATVIEW_CACHE.get(key);
	if (!wrap) return null;
	CHATVIEW_CACHE.delete(key);
	return wrap;
}

// Vollbild-Chat im Hauptbereich — gleiche Bausteine wie das Seitenpanel.
// FIX: bestehendes Chat-Fenster WIEDERVERWENDEN statt pro Hintergrund-Render neu
// bauen — sonst riss ein frisches #mainChatLog die Ansicht per Auto-Scroll nach
// unten und getippter Text im Eingabefeld ging verloren
function renderFullChat(main) {
	const s = S.currentChatId ? CHATS.load().find((x) => x.id === S.currentChatId) : null;
	const title = (s && s.title) || "Neuer Chat";
	const empty = !S.chat.length;
	const chatKey = String(S.currentChatId || "");
	parkFullChat(main, chatKey);
	let oldWrap = main.querySelector(":scope > .chat-full-wrap");
	if (!oldWrap) {
		oldWrap = takeChatView(chatKey);
		if (oldWrap) main.replaceChildren(oldWrap);
	}
	if (oldWrap && oldWrap.dataset.chatid === String(S.currentChatId || "")) {
		const h1 = oldWrap.querySelector(".chat-full-head h1");
		const wantTitle = "✦ " + title;
		if (h1 && h1.textContent !== wantTitle) h1.textContent = wantTitle;
		if (!empty) {
			oldWrap.querySelector(".chat-empty-hint")?.remove();
			oldWrap.querySelector(".chat-suggests")?.remove();
		}
		renderMainChatLog();
		renderPendingChip("full");
		return;
	}
	main.innerHTML =
		`<div class="chat-full-wrap" data-chatid="${esc(String(S.currentChatId || ""))}">` +
			'<div class="chat-full-head"><button type="button" class="ai-status-chip" id="aiStatusChipFull" title="KI-Status" data-aistatus="1"></button>' +
			`<h1>✦ ${esc(title)}</h1></div>` +
			// Schnellstart-Chips setzen einen Prompt-Anfang ins Eingabefeld (kein Auto-Senden)
			(empty ? '<p class="hint chat-empty-hint">Stell deine erste Frage — die Antwort erscheint hier groß, LaTeX und Code werden live gerendert.</p>' +
				'<div class="chat-suggests">' +
				'<button type="button" data-chatsuggest="Erkläre mir Schritt für Schritt: ">💡 Erkläre mir…</button>' +
				'<button type="button" data-chatsuggest="Erstelle Karteikarten zu: ">🃏 Karteikarten zu…</button>' +
				'<button type="button" data-chatsuggest="Fasse kompakt zusammen: ">📄 Fasse zusammen…</button>' +
				'<button type="button" data-chatsuggest="Stell mir 5 Prüfungsfragen zu: ">🎯 Quiz mich zu…</button></div>' : "") +
			'<div id="mainChatLog" class="chat-log-full"></div>' +
			'<form id="mainChatForm" class="chat-form-full"><div id="mainPendingChip" hidden></div>' +
				'<div class="composer-body"><textarea id="mainChatInput" rows="1" placeholder="Frag deinen KI-Coach…"></textarea></div>' +
				'<div class="composer-actions"><div class="composer-actions-left">' +
					'<button type="button" id="btnAttachFull" title="Fotos und Dateien hinzufügen">+</button>' +
					'<button type="button" id="btnModelChipFull" class="composer-tool" title="Modell wählen"></button>' +
				'</div><button id="mainChatSubmit" type="submit" title="Senden" disabled>↑</button></div>' +
				'<div id="modelMenuFull" class="model-menu" hidden></div></form></div>';
	renderMainChatLog();
	renderPendingChip("full");
	renderStatusDot();
	const inp = $("mainChatInput");
	if (empty && inp) inp.focus();
}

function renderMainChatLog() {
	const log = $("mainChatLog");
	if (log) renderChatLog(log, S.chat);
}

// EINE "Gedankengang"-Box für live UND finalisiert (gleiche Struktur/Optik)
function thinkBoxHtml(opts) {
	const expanded = !!opts.expanded;
	return `<div class="think-box${opts.live ? " live" : ""}${expanded ? " expanded" : opts.live ? " peek" : ""}">` +
		`<button type="button" class="think-toggle" ${opts.toggleAttr} aria-expanded="${expanded ? "true" : "false"}">` +
			`<span class="think-icon">${ICONS.think}</span><span class="think-label">${esc(opts.label)}</span><span class="think-chevron">▸</span></button>` +
		`<div class="think-body-wrap"><div class="think-body">${esc(opts.text || "")}</div></div></div>`;
}

// Live: Mini-Vorschau mit den letzten 2 Zeilen, ausklappbar
const thinkingLiveHtml = () => thinkBoxHtml({
	text: S.thinkingLiveExpanded ? S.aiThinkingDraft : U.lastLines(S.aiThinkingDraft, 2),
	expanded: !!S.thinkingLiveExpanded, live: true, label: "Denkt nach…", toggleAttr: 'id="btnThinkLive"',
});

function assistantMsgHtml(m) {
	const think = m.reasoning ? thinkBoxHtml({ text: m.reasoning, expanded: !!m.reasoningExpanded, live: false, label: "Gedankengang", toggleAttr: `data-reasoningtoggle="${m.mid}"` }) : "";
	const refine = S.refineOpenMid === m.mid
		? `<div class="refine-menu"><button data-refine="${m.mid}" data-mode="longer">${ICONS.arrowUp} Länger</button><button data-refine="${m.mid}" data-mode="same">${ICONS.arrowSame} Gleich</button><button data-refine="${m.mid}" data-mode="shorter">${ICONS.arrowDown} Kürzer</button></div>`
		: "";
	return think + '<div class="msg assistant"><div class="md">' + U.md(m.content) + "</div>" +
		`<div class="msg-tools"><button class="msg-tool-btn" data-copymsg="${m.mid}" title="Antwort in die Zwischenablage kopieren">${ICONS.copy} Kopieren</button>` +
		`<button class="msg-tool-btn" data-refinetoggle="${m.mid}" title="Antwort anpassen">✦ Anpassen</button>${refine}</div></div>`;
}

function editCardHtml(m) {
	if (m.undo) return `<div class="edit-card${m.undone ? " undone" : ""}"><div class="edit-title">${esc(m.summary || "KI-Änderungen")}</div>` +
		`<div class="edit-actions-row"><span class="edit-subtitle">${m.undone ? "Rückgängig gemacht" : "Atomar gespeichert"}</span>` +
		`<button class="btn-undo-icon" data-undo="${m.mid}" ${m.undone ? "disabled" : ""} title="Gesamte KI-Aktion rückgängig machen">↺</button></div></div>`;
	const title = m.pageTitle || "Unbenannt";
	const label = m.created ? "Hat erstellt" : "Hat geändert";
	const icon = m.after?.icon || S.pages[m.pageId]?.icon || "📄";
	return `<div class="edit-card${m.undone ? " undone" : ""}"><div class="edit-title">${esc(m.summary || (label + " " + title))}</div>` +
		`<div class="edit-actions-row"><button class="btn-show-changes" data-difftoggle="${m.mid}">Änderungen anzeigen</button>` +
		`<button class="btn-undo-icon" data-undo="${m.mid}" ${m.undone ? "disabled" : ""} title="Rückgängig machen">↺</button></div>` +
		`<div class="edit-subtitle">${label}</div><div class="edit-files-list"><div class="edit-file-item">${esc(icon)} ${esc(title)}</div></div></div>`;
}

// Seitenartige Diff-Vorschau: grün/rot markierte Blöcke statt Code-Diff
function changePageBodyHtml(beforeContent, afterContent) {
	const before = String(beforeContent || ""), after = String(afterContent || "");
	if (!before && after) return '<div class="change-page-body md highlight-page-add">' + U.md(after) + "</div>";
	if (!after && before) return '<div class="change-page-body md highlight-page-del">' + U.md(before) + "</div>";
	const diff = typeof U.diffLines === "function" ? U.diffLines(before, after) : [];
	if (!diff.length) return '<div class="change-page-body md">' + U.md(after) + "</div>";
	const chunks = [];
	let buf = [], kind = "same";
	const flush = () => {
		if (!buf.length) return;
		chunks.push(`<div class="change-block ${kind} md">` + U.md(buf.join("\n")) + "</div>");
		buf = [];
	};
	diff.forEach((d) => {
		const t = d.type === "add" || d.type === "del" ? d.type : "same";
		if (t !== kind) { flush(); kind = t; }
		buf.push(d.text);
	});
	flush();
	return '<div class="change-page-body">' + chunks.join("") + "</div>";
}

function openChangePreview(m) {
	const o = $("overlay");
	if (!o || !m) return;
	const before = m.before || {}, after = m.after || {};
	const title = after.title || m.pageTitle || before.title || "Unbenannte Seite";
	const icon = after.icon || S.pages[m.pageId]?.icon || "📄";
	o.hidden = false;
	o.classList.add("change-overlay");
	o.innerHTML =
		'<div class="change-page-flyout" role="dialog" aria-label="Änderungsvorschau">' +
			'<button class="modal-x" id="btnCloseOverlay" title="Schließen">✕</button>' +
			`<div class="change-page-toolbar"><span class="change-page-badge">${m.created ? "Neu" : "Geändert"} · KI</span>` +
			`<span class="hint">${m.created ? "Seite erstellt" : "Seite geändert"}</span>` +
			`<button class="btn-undo-change" data-undo="${m.mid}" ${m.undone ? "disabled" : ""}>↺ Rückgängig</button>` +
			(m.pageId ? `<button type="button" class="mini" data-openchangepage="${esc(m.pageId)}">Seite öffnen</button>` : "") + "</div>" +
			`<article class="change-page-sheet"><div class="change-page-heading"><span class="change-page-icon">${esc(icon)}</span><h1 class="change-page-title">${esc(title)}</h1></div>` +
			changePageBodyHtml(before.content, after.content) + "</article>" +
			'<div class="change-page-legend"><span class="leg add">+ hinzugefügt</span><span class="leg del">− entfernt</span><span class="leg same">unverändert</span></div></div>';
	const sheet = o.querySelector(".change-page-sheet");
	if (sheet) { U.renderMath(sheet); U.highlightCode(sheet); hydrateImages(sheet); }
	const close = () => { o.hidden = true; o.classList.remove("change-overlay"); o.innerHTML = ""; };
	// „Seite öffnen“: Vorschau schließen und navigieren
	o.querySelector("[data-openchangepage]")?.addEventListener("click", (e) => {
		const id = e.currentTarget.dataset.openchangepage;
		close();
		if (typeof window.openPage === "function") window.openPage(id);
		else if (S.pages[id]) { S.currentPageId = id; S.view = "page"; render(); }
	});
	// Klick auf den Overlay-Hintergrund schließt
	const onBg = (e) => { if (e.target === o) { close(); o.removeEventListener("click", onBg); } };
	o.addEventListener("click", onBg);
}

function renderPendingChip(type) {
	const chip = $(type === "full" ? "mainPendingChip" : "pendingChip");
	if (!chip) return;
	let html = "";
	if (S.pendingAttachmentTarget === type) {
		// EIN Markup für alle Anhang-Arten (Bild/Text/PDF): Icon · Titel · Meta · ✕
		const att = (ico, name, meta, btnAttr) =>
			`<span class="chip-ico">${ico}</span><span class="chip-body"><b>${esc(name)}</b><small>${esc(meta)}</small></span><button class="chip-x" ${btnAttr} title="Anhang entfernen">✕</button>`;
		if (S.pendingImage) html = att(`<img src="${S.pendingImage}" alt="">`, "Bild", "wird mitgesendet", 'data-removeattachment="1"');
		else if (S.pendingTextFile) html = att("📄", S.pendingTextFile.name, S.pendingTextFile.size + " Zeichen · wird als Datei angehängt", 'id="btnRemoveTextFile"');
		else if (S.pendingPdf) html = att("📄", S.pendingPdf.name, (S.pendingPdf.pages || "?") + " Seiten · wird als PDF-Kontext angehängt", 'id="btnRemovePdf"');
	}
	// Der Vollbild-Chat hat kein eigenes Kontext-Element (das 📄-Chip lebte nur im Panel) —
	// er hängt hier mit dran. Zwei Chips gleichzeitig: jeder in seiner eigenen Hülle, damit
	// die Anhang-Optik unverändert bleibt.
	const ctx = type === "full" ? contextChipHtml() : "";
	if (ctx && html) {
		chip.hidden = false;
		chip.classList.remove("attach-chip");
		chip.innerHTML = `<div class="attach-chip">${ctx}</div><div class="attach-chip">${html}</div>`;
		return;
	}
	const single = html || ctx;
	chip.hidden = !single;
	chip.classList.toggle("attach-chip", !!single);
	chip.innerHTML = single;
}

// ---------- Modals ----------
function modal(inner) {
	return '<div class="modal">' + inner + "</div>";
}
const closeAction = '<div class="modal-actions"><button id="btnCloseOverlay">Schließen</button></div>';

function openIconPicker() {
	if (!S.currentPageId) return;
	const icons = ["📝", "📘", "📕", "📙", "📗", "🧪", "🧮", "⚡", "🧢", "📐", "🔬", "💡", "🎯", "📊", "🗂", "📎", "✅", "⭐", "🔥", "🎓", "🧠", "📚", "🛠", "🚀"];
	openOverlay(modal(
		"<h3>Icon wählen</h3>" +
		'<div class="icon-grid">' + icons.map((i) => `<button class="icon-opt" data-iconset="${i}">${i}</button>`).join("") + "</div>" +
		'<div class="modal-actions"><button data-iconset="">Entfernen</button><button id="btnCloseOverlay">Schließen</button></div>'
	));
}

function openCoverPicker() {
	if (!S.currentPageId) return;
	openOverlay(modal(
		"<h3>Cover wählen</h3>" +
		'<div class="cover-grid">' + ["sunset", "ocean", "forest", "grape", "mono"].map((c) => `<button class="cover-swatch cover-${c}" data-coverset="${c}"></button>`).join("") + "</div>" +
		'<p class="hint">Oder ein eigenes Bild als Deckblatt (wird lokal gespeichert):</p>' +
		'<div class="row-btns"><button id="btnCoverUpload">🖼 Eigenes Bild wählen</button></div>' +
		'<div class="modal-actions"><button data-coverset="">Entfernen</button><button id="btnCloseOverlay">Schließen</button></div>'
	));
}

function openReview() {
	const snap = STATE.studySnapshot(null);
	if (snap.done) {
		return void openOverlay(modal("<h3>Gratulation! 🎉</h3>" +
			'<p class="hint">Dieser Stapel ist für heute fertig — keine fälligen Karten und keine offenen Lernschritte mehr.</p>' + closeAction));
	}
	// Wie Anki: statische Meldung, kein Live-Countdown. „Erneut prüfen“ baut neu auf
	// OHNE reviewShowBack — sonst zeigte eine inzwischen fällige Karte direkt die Rückseite
	if (snap.finishedForNow && snap.learnWaiting && snap.learnWaiting.length) {
		return void openOverlay(modal("<h3>Geschafft! 🎉</h3>" +
			`<p class="hint">Du hast diesen Stapel für den Moment fertig gelernt. ${snap.learnWaiting.length} Lernkarte(n) sind später heute wieder dran.</p>` +
			'<div class="modal-actions"><button id="btnReviewRefresh">Erneut prüfen</button><button id="btnCloseOverlay">Später</button></div>'));
	}
	const c = snap.dueNow[0];
	// FIX: leere dueNow-Queue crashte hier vorher (undefined.front)
	if (!c) return void openOverlay(modal("<h3>Gratulation! 🎉</h3>" + '<p class="hint">Gerade ist keine Karte fällig.</p>' + closeAction));
	const cnt = snap.counts;
	openOverlay(modal(
		`<h3>${cnt.neu} neu · ${cnt.learn} lernen · ${cnt.review} wdh.</h3>` +
		'<div class="card-face md">' + U.md(c.front) + "</div>" +
		(S.reviewShowBack
			? '<div class="card-face back md">' + U.md(c.back) + '</div><div class="grades">' +
				[[1, "Nochmal"], [2, "Schwer"], [3, "Gut"], [4, "Einfach"]].map(([g, l]) => `<button data-grade="${g}" data-card="${c.id}">${l}</button>`).join("") + "</div>"
			: '<div class="modal-actions"><button id="btnShowBack">Antwort zeigen</button></div>') +
		`<div class="modal-actions review-tools"><button data-ankiedit="${c.id}" title="Karte bearbeiten">✎ Bearbeiten</button>` +
		`<button data-reviewsuspend="${c.id}" title="Karte aussetzen (zählt nicht mehr als fällig)">⏸ Aussetzen</button>` +
		'<button id="btnCloseOverlay">Beenden</button></div>'
	));
}

function openCards() {
	const cards = Object.values(S.cards).filter((c) => !c.trashed).sort((a, b) => (a.srs.due < b.srs.due ? -1 : a.srs.due > b.srs.due ? 1 : 0));
	const rows = cards.map((c) =>
		`<div class="card-row"><textarea data-front="${c.id}" rows="2">${esc(c.front)}</textarea><textarea data-back="${c.id}" rows="2">${esc(c.back)}</textarea>` +
		`<div class="card-meta"><span>fällig: ${U.fmtDate(c.srs.due)} · Wdh. ${c.srs.reps || 0}</span>` +
		`<span><button data-cardsave="${c.id}">Speichern</button> <button data-carddel="${c.id}" class="danger">Löschen</button></span></div></div>`).join("");
	openOverlay(modal(`<h3>Karten verwalten (${cards.length})</h3>` +
		'<div class="cards-list">' + (rows || '<p class="hint">Noch keine Karten.</p>') + "</div>" + closeAction));
}

export const RENDER = {
	render, onStateChange, scheduleRender,
	renderTopbar, renderModelMenu, renderModelBar, renderStatusDot,
	renderSidebar, renderTabs, renderMain, renderHistoryModal,
	renderChat, renderMainChatLog, renderPendingChip, openChangePreview,
	openTemplatePicker, openReview, openCards, openIconPicker, openCoverPicker,
	hydrateImages, hydrateCovers, localDayKey, modal, ancestorsOf,
	loadPendingConflicts, savePendingConflicts, mergePendingConflicts, openConflictResolver, resolveConflict,
	pageIconLabel, pageIconHtml,
	favModels, toggleFavModel, // Modell-Favoriten (Chat + Einstellungen → KI)
	openSettings: (...a) => SETTINGS.openSettings(...a),
	renderLibrary: (...a) => LIBRARY.renderLibrary(...a),
	libCardHtml: (...a) => LIBRARY.libCardHtml(...a),
};
