"use strict";
import { U } from "./util.js";

// Mobile-Ansichten: nur Struktur und Darstellung. Daten, Persistenz und Aktionen
// bleiben in den kanonischen App-/State-Modulen; die Preview darf deshalb nicht
// wieder zu einer zweiten statischen Demo werden.
const esc = (value) => U.esc(String(value ?? ""));

const ICONS = {
	learn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="3"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
	notes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
	home: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>',
	ai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
	more: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
};

const NAV = [
	["learn", "Lernen", ICONS.learn, ""],
	["notes", "Notizen", ICONS.notes, ""],
	["home", "Home", ICONS.home, "home-btn"],
	["ai", "KI", ICONS.ai, ""],
	["more", "Mehr", ICONS.more, ""],
];

const MORE_ACTIONS = [
	["notebooklm", "🤖", "Gemini Notebook", "Quellen & Synthese"],
	["graph", "🕸️", "Wissensgraph", "Vernetzte Notizen"],
	["library", "📖", "Bibliothek", "PDFs & Dokumente"],
	["lernzeit", "⏱️", "Lernanalyse", "Zeiten & Statistiken"],
	["trash", "🗑️", "Papierkorb", "Gelöschte Inhalte"],
	["settings", "⚙️", "Einstellungen", "Sync, Theme, KI"],
];

function shellHtml() {
	const top =
		'<header id="mTop">' +
			'<div class="mTop-left">' +
				'<button type="button" class="top-back-btn" id="btnTopBack" data-m="back" style="display:none" aria-label="Zurück zur Notizenliste">' +
					'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>' +
					'<span>Notizen</span>' +
				'</button>' +
				'<span id="mTitle">Impala</span>' +
				'<small id="mSub"></small>' +
			'</div>' +
			'<div class="mTop-right">' +
				'<button type="button" class="icon-btn" data-m="search" title="Suche" aria-label="Suche">' +
					'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>' +
				'</button>' +
				'<button type="button" class="pill-action-btn" data-m="new"><span>＋ Neu</span></button>' +
			'</div>' +
		'</header>';

	const nav = '<nav id="mNav" aria-label="Mobile Navigation">' + NAV.map(([id, label, icon, cls]) =>
		`<button type="button" class="nav-btn${cls ? " " + cls : ""}" data-m="${id}" aria-label="${label}">${icon}<span>${label}</span>${id === "learn" ? '<i id="mDue" hidden></i>' : ""}</button>`
	).join("") + "</nav>";

	const more =
		'<div id="mMoreSheet" aria-label="Mehr">' +
			'<div class="mSheet-head"><strong>Mehr</strong><button type="button" data-m="closemore" aria-label="Mehr schließen">✕</button></div>' +
			'<div class="drive-sync-card">' +
				'<div class="drive-sync-left"><span class="drive-dot" aria-hidden="true"></span><div><strong>Synchronisation</strong><small>E2EE Cloudflare & Google Drive</small></div></div>' +
				'<button type="button" class="pill-action-btn" data-maction="settings" data-settings-go="sync">Sync</button>' +
			'</div>' +
			'<div class="section-label">Werkzeuge & Bereiche</div>' +
			'<div class="more-dashboard-grid">' +
				MORE_ACTIONS.map(([id, icon, label, hint]) =>
					`<button type="button" class="more-card" data-maction="${id}"><span class="m-ico">${icon}</span><strong>${label}</strong><small>${hint}</small></button>`
				).join("") +
			'</div>' +
		'</div>';

	return top + nav + more;
}

function statCard(icon, value, label) {
	return `<div class="stat-mini-card"><strong>${esc(icon)} ${esc(value)}</strong><small>${esc(label)}</small></div>`;
}

function recentRow(item) {
	return `<button type="button" class="item-row" data-page="${esc(item.id)}">` +
		`<span class="ico">${esc(item.icon || "📝")}</span>` +
		`<span class="info"><strong>${esc(item.title)}</strong><small>${esc(item.meta || "")}</small></span>` +
		'<span class="item-arrow" aria-hidden="true">›</span></button>';
}

function homeHtml({
	greeting,
	homeName,
	dateLine,
	streakDays = 0,
	todayMinutes = 0,
	due = 0,
	showStats = true,
	showFocus = true,
	showRecent = true,
	recent = [],
	continueHtml = "",
	extraHtml = "",
}) {
	const title = `${greeting || "Guten Tag"}${homeName ? ", " + homeName : ""} 👋`;
	const dueLabel = due === 1 ? "Karte fällig" : "Karten fällig";
	const focus = due
		? `<button type="button" class="hero-focus-card" data-homeaction="cards"><span class="hero-focus-left"><strong>${esc(due)} ${dueLabel}</strong><small>Tägliche FSRS-Wiederholung bereit</small></span><span class="hero-focus-btn">Lernen&nbsp;▶</span></button>`
		: '<div class="hero-focus-card is-empty"><span class="hero-focus-left"><strong>Alles gelernt für heute 🎉</strong><small>Keine fälligen Karten offen</small></span></div>';

	// Deduplizierung: Wenn continueHtml eine Notiz anzeigt, diese aus den letzten Notizen filtern
	const filteredRecent = continueHtml && recent.length > 1 ? recent.slice(1) : (continueHtml ? [] : recent);
	const recentHtml = filteredRecent.length
		? filteredRecent.map(recentRow).join("")
		: (continueHtml ? "" : '<div class="empty-state compact"><b>Noch keine Seiten</b><p>Lege deine erste Notiz an oder öffne die Bibliothek.</p></div>');

	return '<div class="home mobile-home-preview" data-key="home">' +
		`<header class="greet-wrap"><div><h1>${esc(title)}</h1><span class="date-pill">${esc(dateLine || "")}</span></div><button type="button" class="home-customize" data-set="home" title="Homeseite anpassen">⚙</button></header>` +
		(showStats
			? '<div class="stat-pills-row">' +
				statCard("🔥", `${streakDays} ${streakDays === 1 ? "Tag" : "Tage"}`, "Streak") +
				statCard("⏱️", `${todayMinutes} Min`, "Lernzeit") +
				statCard("🃏", String(due), "Fällig") +
			'</div>'
			: "") +
		(showFocus ? focus : "") +
		(continueHtml ? `<section class="mobile-continue">${continueHtml}</section>` : "") +
		(showRecent && recentHtml ? `<section class="mobile-recent"><h2>Zuletzt geöffnet</h2><div class="mobile-item-list">${recentHtml}</div></section>` : "") +
		(extraHtml ? `<div class="mobile-home-extra">${extraHtml}</div>` : "") +
		'</div>';
}

export const MOBILE_VIEW = Object.freeze({ shellHtml, homeHtml });
