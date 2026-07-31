"use strict";

import { S, STATE } from "./state.js";
import { CHATS } from "./chats.js";
import { AI } from "./ai.js";
import { U } from "./util.js";
import { PDFS } from "./pdfs.js";
import { RENDER } from "./render.js";
import { POPOVERS } from "./popovers.js";
import { VOICE } from "./voice.js";

// chat-fullscreen.js — Steuerung für BEIDE Chat-Flächen (Seitenpanel + Chat-Tab).
// Der Dateiname bleibt, weil main.js, app.js und der Service-Worker darauf zeigen.
//
// Aufräumrunde (31. Juli 2026):
//  • EIN Nachschlagen statt "S.chat.find(...) || S.sideChat.find(...)" an fünf Stellen:
//    find(mid) liefert Fläche, Liste, Index und Nachricht.
//  • EIN Zeichenpfad: paint(isSide)/repaint() statt gemischter Prüfungen auf S.view,
//    S.aiActiveChatType und zusätzlichem render() hinterher.
//  • EIN Laufzustand: setBusy() setzt/räumt aiBusy, Draft, Status und Senden-Knopf.
//  • refineMessage: Position wird gegen die AKTUELLE Liste geklemmt, die Nachricht bleibt
//    vollständig erhalten (Änderungskarten, Undo-Daten, Anhänge), Abbruch ist kein Fehler.
//  • Anhänge lassen sich einzeln entfernen — vorher leerte jeder Knopf alle drei.
//  • Chat-Löschen läuft über CHATS.remove statt über eine gekürzte Liste.

// WURZEL des Startabsturzes „Cannot access 'RENDER' before initialization“: render.js hängt in
// einem Import-Ring (render → settings → app → render), und app.js lädt diese Datei. Sie wurde
// dadurch ausgewertet, BEVOR render.js seine Exporte gesetzt hatte — ein Alias zur Auswertungs-
// zeit knallt dann sofort. Direkte Zugriffe wirken erst beim Aufruf und sind damit unabhängig
// von der Ladereihenfolge. Kein Alias hier wieder einführen.

// ---------- Flächen & Zeichnen ----------
const listOf = (isSide) => (isSide ? S.sideChat : S.chat);
const paint = (isSide) => (isSide ? RENDER.renderChat() : RENDER.renderMainChatLog());
const repaint = () => { RENDER.renderChat(); if (S.view === "chat" || S.aiActiveChatType === "full") RENDER.renderMainChatLog(); };
const saveChat = (isSide) => (isSide ? saveSideChat() : saveCurrentChat());

// Nachricht per mid finden — egal in welcher Fläche sie liegt.
function find(mid) {
	if (!mid) return null;
	for (const isSide of [false, true]) {
		const list = listOf(isSide);
		const idx = list.findIndex((x) => x.mid === mid);
		if (idx !== -1) return { isSide, list, idx, msg: list[idx] };
	}
	return null;
}

// Streaming-Renderings auf einen Frame zusammenfassen.
let paintQueued = false;
function schedulePaint(isSide) {
	if (paintQueued) return;
	paintQueued = true;
	requestAnimationFrame(() => { paintQueued = false; paint(isSide); });
}

export function saveCurrentChat() { CHATS.persist(S.chat, "currentChatId"); }
export function saveSideChat() { CHATS.persist(S.sideChat, "sideChatId"); }

// Senden-Knopf ⇄ ⏹-Abbrechen spiegeln (app.js hält ihn beim Tippen über syncComposer aktuell)
function updateSubmitButtons() {
	for (const isSide of [true, false]) {
		const btn = U.el(isSide ? "chatSubmit" : "mainChatSubmit");
		if (!btn) continue;
		const busy = S.aiBusy && S.aiActiveChatType === (isSide ? "side" : "full");
		const inp = U.el(isSide ? "chatInput" : "mainChatInput");
		btn.disabled = busy ? false : !inp?.value.trim();
		btn.textContent = busy ? "⏹" : "↑";
		btn.title = busy ? "Antwort abbrechen" : "Senden";
		btn.classList.toggle("busy", busy);
	}
}

function setBusy(isSide, busy) {
	S.aiBusy = busy;
	S.aiDraft = "";
	S.aiThinkingDraft = "";
	if (busy) {
		S.aiActiveChatType = isSide ? "side" : "full";
		S.aiStatus = "…denkt nach…";
		S.thinkingLiveExpanded = false;
	}
	paint(isSide);
	updateSubmitButtons();
}

// ---------- Antwort umformulieren ----------
const REFINE_PROMPTS = {
	longer: "Bitte formuliere deine letzte Antwort ausführlicher und länger, mit mehr Details.",
	shorter: "Bitte formuliere deine letzte Antwort kürzer und knapper, auf das Wesentliche reduziert.",
	same: "Bitte formuliere deine letzte Antwort in etwa gleicher Länge neu — anderer Wortlaut, gleicher Inhalt und Umfang.",
};

export async function refineMessage(mid, mode) {
	if (S.aiBusy) return;
	const hit = find(mid);
	if (!hit || hit.msg.role !== "assistant") return;
	const { isSide, list, idx, msg } = hit;
	const history = list.slice(0, idx)
		.filter((m) => m.role === "user" || m.role === "assistant")
		.map((m) => ({ role: m.role, content: m.content || "" }));
	history.push({ role: "assistant", content: msg.content || "" });

	// Alte Antwort verschwindet sofort; die neue wächst wie eine ganz normale Antwort.
	list.splice(idx, 1);
	setBusy(isSide, true);

	let content = msg.content;
	try {
		content = await AI.refine(history, REFINE_PROMPTS[mode] || REFINE_PROMPTS.same, (text) => {
			S.aiDraft = text;
			schedulePaint(isSide);
		});
	} catch (err) {
		if (err?.name !== "AbortError") U.toast("Anpassen fehlgeschlagen: " + (err?.message || err), "error");
	}
	setBusy(isSide, false);
	// Gegen die AKTUELLE Liste einsetzen: sie kann sich zwischenzeitlich geändert haben.
	// Alle Felder der Originalnachricht bleiben erhalten (Karten, Undo, Anhänge, mid).
	const target = listOf(isSide);
	target.splice(Math.min(idx, target.length), 0, { ...msg, content, reasoningExpanded: false });
	saveChat(isSide);
	repaint();
}

// ---------- Senden (Seitenpanel und Chat-Tab) ----------
export async function sendChatMessage(text, type) {
	const isSide = (type || "side") !== "full";
	const kind = isSide ? "side" : "full";
	const mine = S.pendingAttachmentTarget === kind;
	const pdf = mine && !!S.pendingPdf, txt = mine && !!S.pendingTextFile, img = mine && !!S.pendingImage;
	if ((!text && !pdf && !txt && !img) || S.aiBusy) return;

	setBusy(isSide, true);
	try {
		const fallback = pdf ? "Analysiere das angehängte PDF."
			: txt ? "Fasse die angehängte Datei zusammen."
			: "Beschreibe das angehängte Bild.";
		const answer = await AI.agent(text || fallback, kind, (tool) => {
			S.aiStatus = "⚙ " + tool + "…";
			schedulePaint(isSide);
		});
		// Nur Antworten auf eine Spracheingabe vorlesen — getippte Chats bleiben still.
		if (VOICE.consumeReply()) VOICE.speak(answer);
	} catch (err) {
		// Ein fehlgeschlagener Sprach-Zug darf nicht die nächste Text-Antwort vorlesen.
		VOICE.consumeReply();
		const target = listOf(isSide);
		if (err?.name === "AbortError") {
			// ⏹ über den Senden-Knopf: Teilantwort behalten, kein Fehler-Ton.
			target.push({ mid: U.uid(), role: "assistant", content: (S.aiDraft ? S.aiDraft + "\n\n" : "") + "*(Abgebrochen.)*" });
		} else {
			// Scheitert eine Anfrage MIT Bild, liegt es meist am nicht vision-fähigen Modell.
			const hint = img ? "\n\nℹ️ Die Nachricht enthielt ein Bild. Das gewählte Modell scheint keine Bilder zu unterstützen. Wähle ein Vision-Modell oder sende die Frage ohne Bild erneut." : "";
			target.push({ mid: U.uid(), role: "assistant", content: "⚠️ " + (err?.message || err) + hint });
		}
	}
	setBusy(isSide, false);
	saveChat(isSide);
	repaint();
}

// ---------- Nachrichten-Aktionen (Event-Delegation aus app.js) ----------
export function handleReasoningToggle(t) {
	if (t.id === "btnThinkLive") { S.thinkingLiveExpanded = !S.thinkingLiveExpanded; repaint(); return; }
	const hit = find(t.dataset.reasoningtoggle);
	if (!hit) return;
	hit.msg.reasoningExpanded = !hit.msg.reasoningExpanded;
	repaint();
}

export function handleDiffCardToggle(t) {
	// Änderungen werden wie in Notion in einer eigenen Seiten-Vorschau geprüft.
	const hit = find(t.dataset.difftoggle);
	if (hit) RENDER.openChangePreview(hit.msg);
}

export async function handleUndo(t) {
	const hit = find(t.dataset.undo);
	if (!hit || hit.msg.undone) return;
	const m = hit.msg;
	try {
		if (m.created) await STATE.dispatch("pageDelete", { id: m.pageId });
		else await STATE.dispatch("pageUpdate", { id: m.pageId, patch: { title: m.before?.title, content: m.before?.content } });
	} catch (e) {
		// FIX: schlug das Zurücksetzen fehl, galt die Änderung trotzdem als rückgängig.
		U.toast("Rückgängig machen fehlgeschlagen: " + (e?.message || e), "error");
		return;
	}
	m.undone = true;
	saveChat(hit.isSide);
	repaint();
}

export function handleFileDownload(t) {
	const hit = find(t.dataset.filedownload);
	if (hit?.msg.textFile) U.downloadText(hit.msg.textFile.name, hit.msg.textFile.content);
}

export function handleEditUserMessage(t) {
	if (S.aiBusy) { U.toast("Die KI antwortet gerade — bitte kurz warten.", "error"); return; }
	const hit = find(t.dataset.editmsg);
	if (!hit) return;
	const { isSide, list, idx, msg } = hit;
	if (list.slice(idx + 1).some((x) => x.role === "edit" && !x.undone)) {
		U.toast("Diese Nachricht lässt sich erst bearbeiten, wenn die späteren Seitenänderungen rückgängig gemacht wurden — nutze „Rückgängig machen“ bei den Änderungs-Karten weiter unten.", "error");
		return;
	}
	if (isSide) S.sideChat = list.slice(0, idx); else S.chat = list.slice(0, idx);
	RENDER.render();
	// Ziel-Composer nach dem CHAT wählen, nicht nach der Ansicht.
	const inp = U.el(isSide ? "chatInput" : "mainChatInput");
	if (inp) { inp.value = msg.content || ""; inp.focus(); }
	updateSubmitButtons();
}

export function handleAnswerQuestion(t) {
	const hit = find(t.dataset.answerq);
	if (!hit || hit.msg.answered) return;
	const idx = Number(t.dataset.answeridx);
	const options = Array.isArray(hit.msg.options) ? hit.msg.options : [];
	if (!Number.isInteger(idx) || idx < 0 || idx >= options.length) return;
	// Sofort fixieren — verhindert Doppelklicks und leere Wartezustände.
	hit.msg.answered = true;
	hit.msg.answer = options[idx];
	paint(hit.isSide);
	if (!AI.resolveChoice(hit.msg.mid, options[idx])) {
		U.toast("Antwort notiert — der vorherige KI-Lauf ist nicht mehr aktiv.", "error");
	}
}

export function handleRefineToggle(t) {
	S.refineOpenMid = S.refineOpenMid === t.dataset.refinetoggle ? null : t.dataset.refinetoggle;
	repaint();
}

export async function handleRefineSelect(t) {
	// Menü SOFORT schließen, bevor auf die KI gewartet wird.
	S.refineOpenMid = null;
	repaint();
	await refineMessage(t.dataset.refine, t.dataset.mode);
}

// ---------- Modell-Menü ----------
export async function handleModelMenuToggle(t) {
	const anchor = t.id === "btnModelChipFull" ? "full" : "panel";
	const wasOpen = S.modelMenuOpen && S.modelMenuAnchor === anchor;
	POPOVERS.closeAll("model");
	S.modelMenuAnchor = anchor;
	S.modelMenuOpen = !wasOpen;
	S.modelMenuSection = "root";
	S.customModelProviderPick = S.settings.aiProviderId;
	RENDER.renderModelMenu();
	if (!S.modelMenuOpen) return;
	// Bei jedem Öffnen neu abfragen: LM Studio meldet nur die aktuell geladenen Modelle.
	S.modelMenuLoading = true;
	RENDER.renderModelMenu();
	try {
		S.availableModels = await AI.listModels();
	} catch (e) {
		// Ohne diesen Fang blieb das Menü bei Serverfehlern für immer im Ladezustand.
		S.availableModels = [];
		U.toast("Modelle konnten nicht geladen werden: " + (e?.message || e), "error");
	}
	S.modelMenuLoading = false;
	RENDER.renderModelMenu();
	// Thinking-Stufen werden geprüft, nicht aus Modellnamen geraten.
	AI.detectThinkingCapabilities().then(RENDER.renderModelMenu, RENDER.renderModelMenu);
}

// ---------- Chats löschen (einzeln und mehrere auf einmal) ----------
// Die Auswahl lebt nur zur Laufzeit in S.chatSelection und wird nie gespeichert.
const selection = () => (S.chatSelection instanceof Set ? S.chatSelection : (S.chatSelection = new Set()));

// Alle Spuren eines gelöschten Chats aus der Oberfläche nehmen.
function forgetChat(id) {
	const tabId = "chat:" + id;
	S.tabs = S.tabs.filter((x) => x !== tabId);
	if (S.activeTabId === tabId) { S.view = "home"; S.activeTabId = null; }
	if (S.currentChatId === id) { S.chat = []; S.currentChatId = null; }
	// War es der Seitenpanel-Chat, hätte der nächste saveSideChat() ihn wiederbelebt.
	if (S.sideChatId === id) { S.sideChat = []; S.sideChatId = null; }
	selection().delete(id);
}

// Einen Chat löschen, in dem gerade geantwortet wird, würde den laufenden Lauf ins Leere schreiben.
const chatIsBusy = (ids) => S.aiBusy && ids.some((id) => id === S.currentChatId || id === S.sideChatId);

export function handleChatSelectToggle(t) {
	const id = t.dataset.chatsel;
	if (!id) return;
	const sel = selection();
	if (sel.has(id)) sel.delete(id); else sel.add(id);
	RENDER.renderSidebar();
}

export function handleChatSelectAll() {
	const sel = selection();
	for (const s of CHATS.load()) sel.add(s.id);
	RENDER.renderSidebar();
}

export function handleChatSelectNone() {
	selection().clear();
	RENDER.renderSidebar();
}

export async function handleDeleteChat(t) {
	const id = t.dataset.chatdel;
	if (!id) return;
	if (chatIsBusy([id])) { U.toast("Die KI antwortet in diesem Chat noch — bitte kurz warten.", "error"); return; }
	const title = CHATS.get(id)?.title || "Chat";
	const ok = await U.confirm('„' + title + '“ wirklich löschen? Das kann nicht rückgängig gemacht werden.', {
		title: "Chat löschen", ok: "Löschen", danger: true,
	});
	if (!ok) return;
	CHATS.remove(id);
	forgetChat(id);
	RENDER.render();
}

export async function handleDeleteSelectedChats() {
	const ids = [...selection()];
	if (!ids.length) return;
	if (chatIsBusy(ids)) { U.toast("Die KI antwortet in einem der Chats noch — bitte kurz warten.", "error"); return; }
	const ok = await U.confirm(ids.length === 1
		? "Den ausgewählten Chat wirklich löschen? Das kann nicht rückgängig gemacht werden."
		: ids.length + " Chats wirklich löschen? Das kann nicht rückgängig gemacht werden.", {
		title: "Chats löschen", ok: "Löschen", danger: true,
	});
	if (!ok) return;
	CHATS.removeMany(ids);
	ids.forEach(forgetChat);
	selection().clear();
	U.toast(ids.length + (ids.length === 1 ? " Chat gelöscht." : " Chats gelöscht."), "success");
	RENDER.render();
}

// ---------- Anhänge ----------
const SLOTS = { image: "pendingImage", file: "pendingTextFile", pdf: "pendingPdf" };
const ALL_SLOTS = Object.values(SLOTS);

function paintChips() { RENDER.renderPendingChip("side"); RENDER.renderPendingChip("full"); }

// Ohne bekannte Art wird alles geleert (alter Sammel-Knopf bleibt damit gültig).
export function handleRemoveAttachment(kind) {
	const slots = SLOTS[kind] ? [SLOTS[kind]] : ALL_SLOTS;
	for (const slot of slots) S[slot] = null;
	if (!ALL_SLOTS.some((slot) => S[slot])) S.pendingAttachmentTarget = null;
	paintChips();
}
export const handleRemoveImage = () => handleRemoveAttachment("image");
export const handleRemoveTextFile = () => handleRemoveAttachment("file");
export const handleRemovePdf = () => handleRemoveAttachment("pdf");

// Es hängt immer genau EIN Anhang an der nächsten Nachricht — der Chip zeigt auch nur einen.
function setAttachment(slot, value, target) {
	for (const s of ALL_SLOTS) S[s] = null;
	S[slot] = value;
	S.pendingAttachmentTarget = target;
	paintChips();
}

const targetOf = (id) => (id === "mainChatInput" || id === "btnAttachFull" ? "full" : "side");

const readDataUrl = (file) => new Promise((res, rej) => {
	const r = new FileReader();
	r.onload = () => res(r.result);
	r.onerror = () => rej(r.error || new Error("Datei konnte nicht gelesen werden."));
	r.readAsDataURL(file);
});

// FIX: Menü unsichtbar vermessen und je nach Platz über/unter dem Knopf platzieren.
export function handleAttachMenuToggle(t) {
	const m = U.el("attachMenu");
	if (!m) return;
	S.attachTarget = targetOf(t.id);
	POPOVERS.toggleElement(m, t, { prefer: "above", gap: 4 });
}

export async function handleFilePdfChange(e) {
	const file = e.target.files?.[0];
	e.target.value = "";
	if (!file) return;
	try {
		// PDFs sind reine Chat-Anhänge: Text wird lokal extrahiert und erst mit der
		// nächsten Nachricht übergeben. Es entsteht keine Seite und kein Verlaufseintrag.
		const out = await PDFS.extractText(await U.readAsBuffer(file));
		setAttachment("pendingPdf", { name: file.name, content: out.text, size: file.size, pages: out.numPages }, S.attachTarget || "side");
	} catch (err) {
		U.toast("PDF konnte nicht gelesen werden: " + (err?.message || err), "error");
	}
}

export async function handleFileImgChange(e) {
	const file = e.target.files?.[0];
	e.target.value = "";
	if (!file) return;
	try {
		setAttachment("pendingImage", await readDataUrl(file), S.attachTarget || "side");
	} catch (err) {
		U.toast("Bild konnte nicht gelesen werden: " + (err?.message || err), "error");
	}
}

export function handlePaste(e) {
	if (e.target.id !== "chatInput" && e.target.id !== "mainChatInput") return;
	const target = targetOf(e.target.id);
	const items = e.clipboardData ? [...e.clipboardData.items] : [];
	// 🖼️ Bilder aus der Zwischenablage (Screenshot, kopiertes Foto) landen als Anhang.
	const imgItem = items.find((it) => it.kind === "file" && it.type.startsWith("image/"));
	if (imgItem) {
		const file = imgItem.getAsFile();
		if (!file) return;
		e.preventDefault();
		readDataUrl(file)
			.then((data) => setAttachment("pendingImage", data, target))
			.catch((err) => U.toast("Bild konnte nicht gelesen werden: " + (err?.message || err), "error"));
		return;
	}
	// Sehr lange Einfügungen werden zum Datei-Anhang statt den Composer zu fluten.
	const text = e.clipboardData ? e.clipboardData.getData("text/plain") || "" : "";
	if (text.length > 600 || text.split("\n").length > 15) {
		e.preventDefault();
		setAttachment("pendingTextFile", { name: "geklebter-text.txt", content: text, size: text.length }, target);
	}
}

export const CHAT_FULLSCREEN = {
	saveCurrentChat,
	saveSideChat,
	refineMessage,
	sendChatMessage,
	updateSubmitButtons,
	handleReasoningToggle,
	handleDiffCardToggle,
	handleUndo,
	handleFileDownload,
	handleModelMenuToggle,
	handleDeleteChat,
	handleDeleteSelectedChats,
	handleChatSelectToggle,
	handleChatSelectAll,
	handleChatSelectNone,
	handleEditUserMessage,
	handleAnswerQuestion,
	handleRefineToggle,
	handleRefineSelect,
	handleAttachMenuToggle,
	handleRemoveAttachment,
	handleRemoveImage,
	handleRemoveTextFile,
	handleRemovePdf,
	handleFilePdfChange,
	handleFileImgChange,
	handlePaste,
};