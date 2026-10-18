"use strict";

// Klicks im Chat (Denkprozess, Diff-/Undo-Karten, Auswahl, Rückfragen, Anpassen) und im
// Modell-/Quellen-Menü. Aus dem zentralen Klick-Handler in app.js herausgelöst.

import { RENDER } from "./render.js";
import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { SETTINGS } from "./settings.js";
import { CHAT_FULLSCREEN } from "./chat-fullscreen.js";
import { AI } from "./ai.js";

// Spät gebunden ((...a) =>) wegen Modul-Zyklen — wie in app.js.
const renderModelBar = (...a) => RENDER.renderModelBar(...a);
const renderModelMenu = (...a) => RENDER.renderModelMenu(...a);
const $ = (id) => U.el(id);

// true = Klick gehört hierher und ist erledigt.
export async function handleChatClick(t) {
	// Thinking-Prozess (finalisiert) ausklappen. Die LIVE-Box läuft über den
	// pointerdown-Listener oben — hier nur abfangen, damit nichts doppelt feuert.
	if (t.id === "btnThinkLive") return true;
	if (t.dataset.reasoningtoggle) {
		CHAT_FULLSCREEN.handleReasoningToggle(t);
		return true;
	}

	// Edit-Karte: Diff ein-/ausblenden, Rückgängig machen
	if (t.dataset.difftoggle) {
		CHAT_FULLSCREEN.handleDiffCardToggle(t);
		return true;
	}
	if (t.dataset.undo) {
		await CHAT_FULLSCREEN.handleUndo(t);
		return true;
	}

	// Datei-Chip im Chat: geklebten Text als .txt herunterladen
	if (t.dataset.filedownload) {
		CHAT_FULLSCREEN.handleFileDownload(t);
		return true;
	}

	// Modell-Menü: Notion-artige Untermenüs für Modell und Thinking-Stufe.
	if (t.dataset.modelsubmenu) {
		S.modelMenuSection = t.dataset.modelsubmenu;
		renderModelMenu();
		if (S.modelMenuSection === "thinking") {
			AI.detectThinkingCapabilities().then(renderModelMenu, renderModelMenu);
		}
		return true;
	}
	if (t.dataset.thinkingprobe) {
		const store = S.thinkingCapabilities || {};
		const pr = (S.settings.aiProviders || []).find((item) => item.id === S.settings.aiProviderId);
		const key = [S.settings.aiProviderId || "", String((pr && pr.base) || "").replace(/\/+$/, ""), S.settings.aiModel || ""].join("::");
		delete store[key];
		S.thinkingCapabilities = store;
		renderModelMenu();
		AI.detectThinkingCapabilities().then(renderModelMenu, renderModelMenu);
		return true;
	}
	if (t.dataset.modelmenuback) {
		S.modelMenuSection = "root";
		renderModelMenu();
		return true;
	}
	if (t.dataset.thinkingenabled !== undefined) {
		await STATE.dispatch("settingsSet", { thinkingEnabled: t.dataset.thinkingenabled === "1" });
		S.modelMenuSection = "root";
		renderModelMenu();
		return true;
	}

	// Modell wählen (Chat-Dropdown ODER Einstellungen → KI) — Wert "quelleId::modell"
	if (t.dataset.modelset) {
		const raw = t.dataset.modelset;
		const sep = raw.indexOf("::");
		const providerId = sep === -1 ? S.settings.aiProviderId : raw.slice(0, sep);
		const model = sep === -1 ? raw : raw.slice(sep + 2);
		await STATE.dispatch("settingsSet", { aiProviderId: providerId, aiModel: model });
		S.modelMenuOpen = false;
		renderModelBar();
		// Auswahl in offenen KI-Einstellungen sofort als aktiv markieren
		if (typeof SETTINGS.paintSettingsModels === "function") SETTINGS.paintSettingsModels();
		// Jede Auswahl startet die modellbezogene Probe sofort. Das Thinking-
		// Menü zeigt später ausschließlich die bestätigten Stufen dieses Modells.
		AI.detectThinkingCapabilities().then(renderModelBar, renderModelBar);
		SETTINGS.checkAI();
		return true;
	}

	// Verbindung EINER Quelle testen (Einstellungen → KI) — nutzt die aktuellen Feldwerte
	if (t.dataset.provtest) {
		await SETTINGS.handleProviderTest(t);
		return true;
	}
	// Vorgeschlagene Server-URL übernehmen (z. B. fehlendes /v1) und direkt erneut testen
	if (t.dataset.provfixbase) {
		const row = document.querySelector('[data-provrow="' + t.dataset.provfixbase + '"]');
		const baseInput = row && row.querySelector("[data-provbase]");
		if (baseInput) baseInput.value = t.dataset.base || "";
		await SETTINGS.testProviderRow(t.dataset.provfixbase);
		return true;
	}

	// Quelle entfernen (Einstellungen → KI)
	if (t.dataset.provdel) {
		// FIX: erst die aktuellen (ungespeicherten) Feldwerte ALLER Zeilen einsammeln —
		// vorher verwarf das Löschen einer Quelle die offenen Eingaben der anderen.
		const rows = Array.from(document.querySelectorAll("[data-provrow]"));
		const fromDom = rows.map((row) => {
			const val = (sel) => { const el = row.querySelector(sel); return el ? el.value.trim() : ""; };
			return { id: row.dataset.provrow, name: val("[data-provname]") || row.dataset.provrow, base: val("[data-provbase]"), key: val("[data-provkey]") };
		});
		const providers = (fromDom.length ? fromDom : (S.settings.aiProviders || [])).filter((p) => p.id !== t.dataset.provdel);
		const patch = { aiProviders: providers };
		// FIX: war die gelöschte Quelle im Chat aktiv, zeigten aiProviderId/aiModel ins Leere
		// (z. B. aktive Quelle „google" + Modell „local-model" → garantiert keine Verbindung).
		if (S.settings.aiProviderId === t.dataset.provdel) {
			patch.aiProviderId = providers[0] ? providers[0].id : "";
			patch.aiModel = "";
		}
		// FIX: dito für die Embedding-Quelle — zurück auf „automatisch".
		if (S.settings.embedProviderId === t.dataset.provdel) patch.embedProviderId = "";
		RENDER.removeProviderFavorites(t.dataset.provdel);
		await STATE.dispatch("settingsSet", patch);
		SETTINGS.openSettings("ai");
		return true;
	}

	// Quelle für ein eigenes Modell wählen (Chips im Modell-Dropdown) — Eingabe bleibt erhalten
	if (t.dataset.customprov) {
		const keep = ($("customModelInput") || {}).value || "";
		S.customModelProviderPick = t.dataset.customprov;
		renderModelMenu();
		const inp2 = $("customModelInput");
		if (inp2) { inp2.value = keep; inp2.focus(); }
		return true;
	}

	// Eigenes Modell für die gewählte Quelle setzen (unten im Modell-Dropdown)
	if (t.dataset.modelcustomapply) {
		const inp = $("customModelInput");
		const providerId = S.customModelProviderPick || S.settings.aiProviderId;
		const model = inp ? inp.value.trim() : "";
		if (model) {
			await STATE.dispatch("settingsSet", { aiProviderId: providerId, aiModel: model });
			S.modelMenuOpen = false;
			renderModelBar();
			AI.detectThinkingCapabilities().then(renderModelBar, renderModelBar);
			SETTINGS.checkAI();
		}
		return true;
	}

	// Chat-Mehrfachauswahl (Kästchen je Zeile + Kopfzeile der Chat-Liste)
	if (t.dataset.chatsel) { CHAT_FULLSCREEN.handleChatSelectToggle(t); return true; }
	if (t.dataset.chatselall) { CHAT_FULLSCREEN.handleChatSelectAll(); return true; }
	if (t.dataset.chatselnone) { CHAT_FULLSCREEN.handleChatSelectNone(); return true; }
	if (t.dataset.chatdelsel) { await CHAT_FULLSCREEN.handleDeleteSelectedChats(); return true; }

	// KI-Chat aus der Liste löschen
	if (t.dataset.chatdel) {
		await CHAT_FULLSCREEN.handleDeleteChat(t);
		return true;
	}

	// Nutzer-Nachricht nachträglich bearbeiten
	if (t.dataset.editmsg) {
		CHAT_FULLSCREEN.handleEditUserMessage(t);
		return true;
	}

	// Rückfrage-Karte: Option anklicken löst den wartenden Agent-Loop auf
	if (t.dataset.answerq) {
		CHAT_FULLSCREEN.handleAnswerQuestion(t);
		return true;
	}

	// KI-Status-Pille im Chat-Header / Settings: erneut pingen; Offline → Einstellungen
	if (t.dataset.aistatus || t.id === "btnRecheckAI") {
		SETTINGS.checkAI();
		if (t.dataset.aistatus && S.aiOnline === false) SETTINGS.openSettings("ki");
		return true;
	}

	// "✦ Anpassen"-Menü (länger/kürzer) an einer KI-Antwort ein-/ausblenden
	if (t.dataset.refinetoggle) {
		CHAT_FULLSCREEN.handleRefineToggle(t);
		return true;
	}
	if (t.dataset.refine) {
		await CHAT_FULLSCREEN.handleRefineSelect(t);
		return true;
	}

	// Bibliothek: Kachel-/Tabellen-Ansicht umschalten
	return false;
}
