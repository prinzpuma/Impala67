"use strict";
import { U } from "./util.js";

// Mobile-Ansichten: reines Darstellungsmodul. Keine Seiteneffekte, kein Zugriff
// auf State, DB oder DOM. Alle Nutzerwerte laufen durch esc(); Daten, Aktionen
// und Events liegen in den zuständigen Modulen (app.js, mobile.js, mobile-notes.js).

const esc = (value) => U.esc(String(value ?? ""));

// Lucide-artige Linien-Icons (24er viewBox), selbst als Pfade geschrieben.
const ICON_BODIES = {
	back: '<polyline points="15 18 9 12 15 6"/>',
	forward: '<polyline points="9 18 15 12 9 6"/>',
	search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
	sparkle: '<path d="M12 3c.5 4.5 2.5 6.5 7 7-4.5.5-6.5 2.5-7 7-.5-4.5-2.5-6.5-7-7 4.5-.5 6.5-2.5 7-7z"/><path d="M19 15.5c.2 1.4.7 1.9 2.1 2.1-1.4.2-1.9.7-2.1 2.1-.2-1.4-.7-1.9-2.1-2.1 1.4-.2 1.9-.7 2.1-2.1z"/>',
	dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
	home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
	notes: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>',
	plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
	cards: '<rect x="3" y="6" width="13" height="15" rx="2"/><path d="M8 3h11a2 2 0 0 1 2 2v12"/>',
	grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
	x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
	library: '<path d="M4 5a2 2 0 0 1 2-2h11v16H6a2 2 0 0 0-2 2z"/><path d="M4 5v16"/><path d="M9 7h6"/>',
	graph: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8.2 7.2 10.6 15.5"/><path d="M15.8 7.2 13.4 15.5"/><path d="M8.5 6h7"/>',
	notebook: '<path d="M5 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5z"/><path d="M5 3v18"/><path d="M9 8h6"/><path d="M9 12h6"/>',
	chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 16v-5"/><path d="M12 16V8"/><path d="M16 16v-3"/>',
	archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>',
	trash: '<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/>',
	settings: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
	sync: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14.5 4.5L20 15"/><path d="M20 20v-5h-5"/>',
};

function icon(name) {
	if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(ICON_BODIES, name)) return "";
	const cls = name === "forward" ? ' class="m-chev"' : "";
	return (
		'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
		'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + cls + ">" +
		ICON_BODIES[name] +
		"</svg>"
	);
}

function shellHtml() {
	return `<header id="mBar" class="m-bar">
  <button type="button" id="mBack" class="m-iconbtn m-back" data-m="back" aria-label="Zurück" hidden>${icon("back")}</button>
  <div class="m-bar-titles">
    <h1 id="mTitle" class="m-title">Start</h1>
    <span id="mSub" class="m-sub" hidden></span>
  </div>
  <div class="m-bar-actions">
    <button type="button" class="m-iconbtn" data-m="search" aria-label="Suchen">${icon("search")}</button>
    <button type="button" class="m-iconbtn" data-m="ai" aria-label="KI-Assistent">${icon("sparkle")}</button>
    <button type="button" id="mPageMenu" class="m-iconbtn" data-m="pagemenu" aria-label="Seitenoptionen" hidden>${icon("dots")}</button>
  </div>
</header>
<nav id="mTabs" class="m-tabs" aria-label="Hauptnavigation">
  <button type="button" class="m-tab" data-m="home">${icon("home")}<span>Start</span></button>
  <button type="button" class="m-tab" data-m="notes">${icon("notes")}<span>Notizen</span></button>
  <button type="button" class="m-tab m-tab-new" data-m="new" aria-label="Neu">${icon("plus")}</button>
  <button type="button" class="m-tab" data-m="learn">${icon("cards")}<span>Lernen</span><i id="mDue" class="m-badge" hidden></i></button>
  <button type="button" class="m-tab" data-m="more">${icon("grid")}<span>Mehr</span></button>
</nav>
<section id="mNotes" class="m-layer" aria-label="Notizen"></section>
<section id="mMore" class="m-layer" aria-label="Mehr"></section>`;
}

function moreRow(action, tint, iconName, title, meta) {
	return `    <button type="button" class="m-row" data-maction="${action}"><span class="m-row-ico m-tint-${tint}">${icon(iconName)}</span><span class="m-row-text"><strong>${title}</strong><small>${meta}</small></span>${icon("forward")}</button>`;
}

function moreHtml() {
	return `<div class="m-more">
  <button type="button" class="m-sync-card" data-maction="sync">
    <span class="m-sync-dot" aria-hidden="true"></span>
    <span class="m-row-text"><strong>Synchronisation</strong><small>Ende-zu-Ende verschlüsselt · Cloudflare & Google Drive</small></span>
    ${icon("forward")}
  </button>
  <h2 class="m-section-label">Bereiche</h2>
  <div class="m-group">
${moreRow("library", "blue", "library", "Bibliothek", "PDFs &amp; Dokumente")}
${moreRow("graph", "purple", "graph", "Wissensgraph", "Vernetzte Notizen")}
${moreRow("notebooklm", "green", "notebook", "Gemini Notebook", "Quellen &amp; Synthese")}
${moreRow("lernzeit", "orange", "chart", "Lernanalyse", "Zeiten &amp; Statistiken")}
  </div>
  <h2 class="m-section-label">Ablage</h2>
  <div class="m-group">
${moreRow("archive", "gray", "archive", "Archiv", "Archivierte Notizen &amp; Hefte")}
${moreRow("trash", "red", "trash", "Papierkorb", "Gelöschte Inhalte")}
  </div>
  <h2 class="m-section-label">App</h2>
  <div class="m-group">
${moreRow("settings", "gray", "settings", "Einstellungen", "Design, KI, Konto")}
  </div>
</div>`;
}

function homeHtml(params = {}) {
	const p = params || {};
	const greeting = esc(p.greeting);
	const name = p.homeName ? ", " + esc(p.homeName) : "";
	const due = Number(p.due) || 0;
	const streak = Number(p.streakDays) || 0;
	const minutes = Number(p.todayMinutes) || 0;
	const goal = Number(p.goalPct) || 0;
	const barPct = Math.min(100, Math.max(0, goal));
	const recent = Array.isArray(p.recent) ? p.recent : [];
	const continueHtml = p.continueHtml || "";
	const extraHtml = p.extraHtml || "";

	let html = `<div class="home m-home" data-key="home">
  <header class="m-home-head">
    <div class="m-home-titles">
      <div class="m-home-date">${esc(p.dateLine)}</div>
      <h1>${greeting}${name}</h1>
    </div>
    <button type="button" class="m-iconbtn m-home-set" data-set="home" aria-label="Startseite anpassen">${icon("settings")}</button>
  </header>
`;

	if (p.showFocus) {
		html += due > 0
			? `  <button type="button" class="m-focus is-due" data-homeaction="cards">
    <span class="m-focus-num">${esc(due)}</span>
    <span class="m-focus-text"><strong>${due === 1 ? "Karte fällig" : "Karten fällig"}</strong><small>Jetzt wiederholen</small></span>
    ${icon("forward")}
  </button>
`
			: `  <div class="m-focus is-done">
    <span class="m-focus-text"><strong>Alles erledigt für heute</strong><small>Keine Karten fällig</small></span>
  </div>
`;
	}

	if (p.showStats) {
		html += `  <div class="m-stats">
    <div class="m-stat"><b>${esc(streak)} ${streak === 1 ? "Tag" : "Tage"}</b><small>Streak</small></div>
    <div class="m-stat"><b>${esc(minutes)} Min</b><small>Heute</small></div>
    <button type="button" class="m-stat" data-lz-goal="1"><b>${esc(goal)} %</b><small>Wochenziel</small><span class="m-stat-bar"><i style="width:${barPct}%"></i></span></button>
  </div>
`;
	}

	if (p.showRecent) {
		if (recent.length === 0 && !continueHtml) {
			html += `  <div class="m-empty">
    <strong>Noch keine Notizen</strong>
    <p>Lege deine erste Notiz an, dann erscheint sie hier.</p>
    <button type="button" class="m-pill" data-homeaction="newpage">Erste Notiz anlegen</button>
  </div>
`;
		} else {
			if (continueHtml) {
				html += `  <h2 class="m-section-label">Weitermachen</h2>
  <div class="m-continue">${continueHtml}</div>
`;
			}
			const list = (continueHtml ? recent.slice(1) : recent).slice(0, 5);
			if (list.length > 0) {
				html += `  <h2 class="m-section-label">Zuletzt bearbeitet</h2>
  <div class="m-group">
`;
				for (const r of list) {
					const title = esc(r.title) || "Ohne Titel";
					html += `    <button type="button" class="m-row" data-page="${esc(r.id)}"><span class="m-note-ico">${esc(r.icon)}</span><span class="m-row-text"><strong>${title}</strong><small>${esc(r.meta)}</small></span>${icon("forward")}</button>
`;
				}
				html += `  </div>
`;
			}
		}
		html += `  <button type="button" class="m-link" data-homeaction="library">Alle in der Bibliothek ›</button>
`;
	}

	if (extraHtml) html += `  <div class="m-home-extra">${extraHtml}</div>
`;
	html += `</div>`;
	return html;
}

export const MOBILE_VIEW = Object.freeze({ shellHtml, homeHtml, moreHtml, icon });
