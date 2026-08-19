"use strict";

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
import { SEARCH } from "./search.js";
import { SHORTCUTS } from "./shortcuts.js";
import { CHAT_FULLSCREEN } from "./chat-fullscreen.js";
import { BOOT } from "./boot.js";
import { POPOVERS } from "./popovers.js";
import { HEFT } from "./heft.js?build=169";
import { VOICE } from "./voice.js";
import { MOBILE } from "./mobile.js";
import { LERNZEIT } from "./lernzeit.js";
import { SCHULNOTEN } from "./schulnoten.js";
import { EXP } from "./experimente.js";
import { GRAPH } from "./graph.js";
import { ANALYSE } from "./analyse.js";
import { CONTROLLER } from "./controller.js";
import { CLOUDFLARE_SYNC } from "./sync-cloudflare.js";
import "./pdfpaste.js";

// Übergangsweise für ältere Module und Inline-Handler verfügbar machen.
// Neue Module sollen direkt importieren statt weitere Einträge hier anzulegen.
Object.assign(window, {
	U, DB, SRS, S, STATE, TOOLS, AI, RAG, DRIVE, PDFS, EDITOR, EXTRAS,
	COLLAPSE, CHATS, MOBILE, NOTION_MIGRATOR, SETTINGS, LIBRARY, TABS, SEARCH,
	SHORTCUTS, CHAT_FULLSCREEN, BOOT, POPOVERS, HEFT, VOICE, LERNZEIT,
	SCHULNOTEN, EXP, GRAPH, ANALYSE, CONTROLLER, CLOUDFLARE_SYNC,
	openPage: TABS.openPage,
	openNewTab: TABS.openNewTab,
	closeTab: TABS.closeTab,
	render: RENDER.render,
	renderTopbar: RENDER.renderTopbar,
	renderModelMenu: RENDER.renderModelMenu,
	renderSidebar: RENDER.renderSidebar,
	renderMain: RENDER.renderMain,
	openSettings: SETTINGS.openSettings,
	openReview: RENDER.openReview,
	openCards: RENDER.openCards,
	RENDER_ANKI,
	ankiDecks: RENDER_ANKI.ankiDecks,
	ankiCardsOf: RENDER_ANKI.ankiCardsOf,
	ankiDueOf: RENDER_ANKI.ankiDueOf,
	deckTreeHtml: RENDER_ANKI.deckTreeHtml,
	deckMenuHtml: RENDER_ANKI.deckMenuHtml,
	renderAnki: RENDER_ANKI.renderAnki,
	openCardEditor: RENDER_ANKI.openCardEditor,
	readCardEditorDeck: RENDER_ANKI.readCardEditorDeck,
	wireEvents: APP.wireEvents,
});

// config.local.js bewusst ZULETZT (stand vorher oben): statische Imports laufen
// immer zuerst, das await verzögerte also nur die window-Bindings darunter —
// Startlücke, in der boot.js/Module bereits laufen, window.* aber noch leer ist.
// drive.js liest window.APP_CONFIG erst beim Login → späte Ladung unkritisch.
try {
	await import("./config.local.js");
} catch (e) {
	// Grund mitloggen: fehlende und kaputte Datei sahen vorher identisch aus,
	// ein Syntaxfehler blieb still (Google-Login scheiterte erst viel später).
	console.log("config.local.js nicht geladen:", (e && e.message) || e);
}
