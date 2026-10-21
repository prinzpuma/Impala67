"use strict";

import { icon as spriteIcon } from "./icons.js";

// Mobile-Ansichten: reines Darstellungsmodul. Keine Seiteneffekte, kein Zugriff
// auf State, DB oder DOM. Daten, Aktionen und Events liegen in den zuständigen Modulen (app.js, mobile.js, mobile-notes.js).

// Icons kommen aus dem zentralen Sprite (icons.svg); hier nur die mobilen Namen.
const NAMES = { edit: "pen", done: "check", back: "chevron-left", forward: "chevron-right", search: "search", sparkle: "sparkles", dots: "dots", home: "home", notes: "note", plus: "plus", cards: "cards", grid: "grid", x: "x", library: "library", graph: "graph", notebook: "notebook", chart: "chart", archive: "archive", trash: "trash", settings: "sliders", sync: "sync" };

function icon(name) {
	if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(NAMES, name)) return "";
	return spriteIcon(NAMES[name], name === "forward" ? "m-chev" : "");
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
    <button type="button" id="mEditToggle" class="m-iconbtn" data-m="edittoggle" aria-label="Bearbeiten" hidden>${icon("edit")}</button>
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

export const MOBILE_VIEW = Object.freeze({ shellHtml, moreHtml, icon });
