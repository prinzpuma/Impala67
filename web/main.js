"use strict";

// Optional config.local.js laden
try {
	await import("./config.local.js");
} catch (e) {
	console.log("Lokale Konfiguration (config.local.js) nicht geladen oder nicht vorhanden.");
}

import { U } from "./util.js";
import { DB } from "./db.js";
import { SRS } from "./srs.js";
import { S, STATE } from "./state.js";
import { TOOLS } from "./tools.js";
import { AI } from "./ai.js";
import { RAG } from "./rag.js";
import { DRIVE } from "./drive.js";
import { PDFS } from "./pdfs.js";
import { EDITOR } from "./editor.js";
import { RENDER } from "./render.js";
import { RENDER_ANKI } from "./render-anki.js";
import { APP } from "./app.js";
import { NOTION_MIGRATOR } from "./import-notion.js";
import { COLLAPSE } from "./collapse.js";
import { CHATS } from "./chats.js";
import "./updater.js";
import { EXTRAS } from "./extras.js";
import { SETTINGS } from "./settings.js";
import { LIBRARY } from "./library.js";
import { TABS } from "./tabs.js";

// Übergangsweise alle Module an window binden,
// damit alle bestehenden Zugriffe reibungslos funktionieren.
window.U = U;
window.DB = DB;
window.SRS = SRS;
window.S = S;
window.STATE = STATE;
window.TOOLS = TOOLS;
window.AI = AI;
window.RAG = RAG;
window.DRIVE = DRIVE;
window.PDFS = PDFS;
window.EDITOR = EDITOR;
window.EXTRAS = EXTRAS;
window.COLLAPSE = COLLAPSE;
window.CHATS = CHATS;
window.NOTION_MIGRATOR = NOTION_MIGRATOR;
window.SETTINGS = SETTINGS;
window.LIBRARY = LIBRARY;
window.TABS = TABS;

// RENDER-Funktionen an window binden
window.render = RENDER.render;
window.renderTopbar = RENDER.renderTopbar;
window.renderModelMenu = RENDER.renderModelMenu;
window.renderSidebar = RENDER.renderSidebar;
window.renderMain = RENDER.renderMain;
window.openSettings = SETTINGS.openSettings;
window.openReview = RENDER.openReview;
window.openCards = RENDER.openCards;

// RENDER_ANKI-Funktionen an window binden
window.ankiDecks = RENDER_ANKI.ankiDecks;
window.ankiCardsOf = RENDER_ANKI.ankiCardsOf;
window.ankiDueOf = RENDER_ANKI.ankiDueOf;
window.deckTreeHtml = RENDER_ANKI.deckTreeHtml;
window.deckMenuHtml = RENDER_ANKI.deckMenuHtml;
window.renderAnki = RENDER_ANKI.renderAnki;
window.openCardEditor = RENDER_ANKI.openCardEditor;

// APP-Funktionen an window binden
window.seedIfEmpty = APP.seedIfEmpty;
window.wireEvents = APP.wireEvents;
window.purgeOldTrash = APP.purgeOldTrash;
